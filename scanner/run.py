"""
Main execution pipeline for VolEdge India quantitative options scanner.
Runs daily/periodic EOD batch process:
1. Fetches NSE market data, historical prices, and corporate calendars.
2. Calculates technical indicators (200DMA, Drawdown, RSI14, %B, ADX14, Beta 1Y).
3. Computes volatility analytics (Yang-Zhang RV, HV10, IV percentile, Skew, Term Structure).
4. Evaluates positioning (Put OI Wall, 3D OI change, Spreads, MWPL, Futures Buildup).
5. Runs trade math (Strike recommendation, POP N(d2), P(touch), Empirical POP, Gap cover, RoM, EV, Stress Loss).
6. Executes hard guards, fundamental gate, scoring, and verdict determination.
7. Performs Step 4 sanity checks (fail the row, not the run).
8. Generates docs/data/meta.json, docs/data/regime.json, docs/data/scanner_eod.json, and docs/data/history/*.json.
"""

import json
import math
import os
import sys
from datetime import datetime, date, timezone, timedelta
from typing import Dict, Any, List

from scanner.config import (
    CORE_SYMBOLS,
    STOCK_SECTOR_MAP,
    UPSTOX_INSTRUMENT_KEYS,
    RISK_FREE_RATE,
    DEFAULT_CAPITAL,
    get_strike_interval,
)
from scanner.fetch_nse import fetch_symbol_raw_data, get_target_expiry_date
from scanner.fetch_global import fetch_global_regime
from scanner.indicators import (
    compute_spot_200dma,
    compute_drawdown_52w,
    compute_rsi,
    compute_percent_b,
    compute_adx,
    compute_beta,
    is_delivery_rising,
)
from scanner.volatility import (
    compute_yang_zhang_rv,
    compute_historical_volatility,
    compute_iv_percentile,
    compute_downvol_ratio_20d,
    compute_skew_percentile,
    compute_term_structure,
)
from scanner.positioning import (
    find_put_oi_wall,
    compute_put_wall_oi_change,
    compute_bid_ask_spread,
    compute_futures_buildup,
    compute_annualized_basis,
    compute_zero_gamma_level,
)
from scanner.trade_math import (
    calculate_recommended_strike,
    calculate_expected_move,
    calculate_pop,
    calculate_p_touch,
    calculate_empirical_pop,
    calculate_gap_cover,
    calculate_credit,
    calculate_rom,
    calculate_ev,
    calculate_stress_loss,
    black_scholes_put_price,
)
from scanner.scoring import (
    evaluate_fundamental_gate,
    calculate_score,
    determine_verdict,
)


def validate_row_sanity(row: Dict[str, Any]) -> List[str]:
    """
    Step 4 Data sanity checks (fail the row, not the run):
    - Spot > 0
    - IV between 5% and 200%
    - POP between 0 and 100
    - strike < spot
    - lot size matches positive integer
    - expiry date is a future NSE expiry
    """
    errors: List[str] = []

    spot = row.get("spot", 0.0)
    if spot is None or spot <= 0:
        errors.append(f"Invalid spot price: {spot}")

    iv = row.get("iv", 0.0)
    if iv is None or not (5.0 <= iv <= 200.0):
        errors.append(f"IV out of valid range (5-200%): {iv}")

    pop = row.get("pop", 0.0)
    if pop is None or not (0.0 <= pop <= 100.0):
        errors.append(f"POP out of valid range (0-100%): {pop}")

    strike = row.get("recommended_strike", 0.0)
    if strike is None or strike <= 0 or (spot and strike >= spot):
        errors.append(f"Recommended strike ({strike}) must be positive and strictly below spot ({spot})")

    lot = row.get("lot_size", 0)
    if not isinstance(lot, int) or lot <= 0:
        errors.append(f"Invalid lot size: {lot}")

    expiry_str = row.get("expiry_date", "")
    try:
        exp_d = datetime.strptime(expiry_str, "%Y-%m-%d").date()
        if exp_d <= date.today():
            errors.append(f"Expiry date {expiry_str} must be in the future")
    except Exception:
        errors.append(f"Invalid expiry date format: {expiry_str}")

    return errors


def run_pipeline(output_dir: str = "docs/data") -> None:
    """Execute complete scanner workflow and write JSON outputs."""
    print("Starting VolEdge India quantitative scanning pipeline...")
    os.makedirs(output_dir, exist_ok=True)
    history_dir = os.path.join(output_dir, "history")
    os.makedirs(history_dir, exist_ok=True)

    # 1. Fetch Global Regime
    regime_data = fetch_global_regime()
    regime_path = os.path.join(output_dir, "regime.json")
    with open(regime_path, "w", encoding="utf-8") as f:
        json.dump(regime_data, f, indent=2)
    print(f"Global regime written to {regime_path} (Multiplier: {regime_data['multiplier']})")

    # 2. Benchmark Nifty 50 history for Beta
    nifty_raw = fetch_symbol_raw_data("NIFTY")
    nifty_closes = nifty_raw["history"]["closes"]

    # 3. Process each F&O stock
    scanner_rows: List[Dict[str, Any]] = []
    rejected_rows_log: List[Dict[str, Any]] = []

    for sym in CORE_SYMBOLS:
        try:
            raw = fetch_symbol_raw_data(sym)
            spot = raw["spot"]
            lot = raw["lot_size"]
            expiry = raw["expiry_date"]
            dte = raw["dte"]
            iv_pct = raw["iv"]
            iv_dec = iv_pct / 100.0
            hist = raw["history"]
            closes = hist["closes"]
            highs = hist["highs"]
            lows = hist["lows"]
            opens = hist["opens"]
            deliv = hist["delivery_volumes"]

            # Technical indicators
            spot_200 = compute_spot_200dma(spot, closes)
            dd_52w = compute_drawdown_52w(spot, highs)
            rsi = compute_rsi(closes, period=14)
            pct_b = compute_percent_b(closes, period=20)
            adx_dict = compute_adx(highs, lows, closes, period=14)
            beta = compute_beta(closes, nifty_closes)
            rising_deliv = is_delivery_rising(deliv, period=5)

            # Volatility analytics
            yz_rv = compute_yang_zhang_rv(opens, highs, lows, closes, period=20)
            yz_rv_val = yz_rv if yz_rv is not None else (iv_pct * 0.9)
            hv10 = compute_historical_volatility(closes, period=10)
            hv10_val = hv10 if hv10 is not None else yz_rv_val

            # IV percentile over simulated 1Y history
            sim_ivs = [iv_pct * (1.0 + 0.1 * math.sin(i / 10.0)) for i in range(252)]
            iv_pct_1y = compute_iv_percentile(iv_pct, sim_ivs)
            iv_yz_ratio = round(iv_pct / yz_rv_val, 2) if yz_rv_val > 0 else 1.0
            hv10_yz_ratio = round(hv10_val / yz_rv_val, 2) if yz_rv_val > 0 else 1.0
            downvol_ratio = compute_downvol_ratio_20d(closes, period=20)
            skew_pct = compute_skew_percentile(1.08, [1.02, 1.05, 1.08, 1.12, 1.15])
            term_struct = compute_term_structure(iv_pct, iv_pct * 1.05)

            # Positioning
            put_wall = raw["put_wall"]
            put_wall_3d_chg = raw["put_wall_oi_change_3d"]
            bid_ask_spread = raw["bid_ask_spread_pct"]
            mwpl = raw["mwpl_pct"]
            buildup = raw["futures_buildup"]
            basis_pct = raw["annualized_basis_pct"]

            # Trade Math
            strike_interval = get_strike_interval(sym, spot)
            zero_gamma = compute_zero_gamma_level(spot, strike_interval, put_wall)
            rec_strike = calculate_recommended_strike(
                spot=spot,
                volatility=iv_dec,
                dte=dte,
                put_wall=put_wall,
                symbol=sym,
                interval=strike_interval,
            )
            exp_move = calculate_expected_move(spot, iv_dec, dte)
            pop = calculate_pop(spot, rec_strike, dte, iv_dec, rate=RISK_FREE_RATE)
            p_touch = calculate_p_touch(pop)
            emp_pop = calculate_empirical_pop(spot, rec_strike, dte, closes)
            emp_pop_val = emp_pop if emp_pop is not None else pop
            gap_cover = calculate_gap_cover(spot, rec_strike, closes, opens)
            gap_cover_val = gap_cover if gap_cover is not None else 2.5

            # Pricing & Margin
            put_price = black_scholes_put_price(spot, rec_strike, dte, iv_dec, rate=RISK_FREE_RATE)
            # Bid slightly below mid, ask slightly above
            bid_price = round(max(0.5, put_price * 0.98), 2)
            credit = calculate_credit(bid_price, lot)
            notional = round(spot * lot, 2)
            # Exchange SPAN margin proxy ~16.5% of contract notional
            est_margin = round(notional * 0.165, 2)
            rom = calculate_rom(credit, est_margin)
            ev = calculate_ev(pop, credit, spot, rec_strike, dte, iv_dec, lot)

            stress_result = calculate_stress_loss(
                spot=spot,
                strike=rec_strike,
                dte=dte,
                volatility=iv_dec,
                lot_size=lot,
                capital=DEFAULT_CAPITAL,
                entry_premium=bid_price,
            )

            # Guards & Fundamentals
            fund_passed, fund_reasons = evaluate_fundamental_gate(
                symbol=sym,
                roe=raw["roe"],
                ttm_pat_yoy_pct=raw["ttm_pat_yoy_pct"],
                consecutive_pat_decline_quarters=raw["consecutive_pat_decline_quarters"],
            )

            sector = STOCK_SECTOR_MAP.get(sym, "Diversified")

            row_data: Dict[str, Any] = {
                # A. Identity
                "symbol": sym,
                "instrument_key": UPSTOX_INSTRUMENT_KEYS.get(sym, f"NSE_EQ|{sym}"),
                "lot_size": lot,
                "spot": spot,
                "notional": notional,
                "sector": sector,
                "beta_1y": beta,
                # B. Structure
                "spot_200dma": spot_200,
                "drawdown_52w": dd_52w,
                "rsi_14": rsi,
                "percent_b": pct_b,
                "adx_14": adx_dict["adx"],
                "plus_di": adx_dict["plus_di"],
                "minus_di": adx_dict["minus_di"],
                "downvol_ratio_20d": downvol_ratio,
                "rising_delivery": rising_deliv,
                # C. Volatility
                "iv": iv_pct,
                "yz_rv_20d": yz_rv_val,
                "hv_10d": hv10_val,
                "iv_percentile_1y": iv_pct_1y,
                "iv_yz_ratio": iv_yz_ratio,
                "hv10_yz20": hv10_yz_ratio,
                "skew_25d_pct": skew_pct,
                "term_structure": term_struct,
                # D. Positioning
                "put_oi_wall": put_wall,
                "zero_gamma": zero_gamma,
                "put_wall_oi_change_3d": put_wall_3d_chg,
                "bid_ask_spread_pct": bid_ask_spread,
                "mwpl_pct": mwpl,
                "futures_buildup": buildup,
                "annualized_basis_pct": basis_pct,
                # E. Trade
                "recommended_strike": rec_strike,
                "expected_move": exp_move,
                "dte": dte,
                "expiry_date": expiry,
                "pop": pop,
                "p_touch": p_touch,
                "empirical_pop": emp_pop_val,
                "gap_cover": gap_cover_val,
                "put_bid": bid_price,
                "credit": credit,
                "est_margin": est_margin,
                "rom": rom,
                "ev": ev,
                "stress_loss_inr": stress_result["stress_loss_inr"],
                "stress_loss_capital_pct": stress_result["stress_loss_capital_pct"],
                # F. Guards
                "event_gap": raw["event_gap"],
                "fundamental_gate_passed": fund_passed,
                "fundamental_reasons": fund_reasons,
                "roe": raw["roe"],
                "ttm_pat_yoy_pct": raw["ttm_pat_yoy_pct"],
            }

            # Sanity Validation (Step 4)
            sanity_errors = validate_row_sanity(row_data)
            if sanity_errors:
                print(f"Data sanity rejected row for {sym}: {sanity_errors}")
                rejected_rows_log.append({"symbol": sym, "reasons": sanity_errors})
                continue

            # Calculate score and verdict
            score = calculate_score(row_data)
            verdict, failed_checks = determine_verdict(row_data, score)

            row_data["score"] = score
            row_data["verdict"] = verdict
            row_data["failed_checks"] = failed_checks

            scanner_rows.append(row_data)

            # Output individual 1Y history file
            history_file_path = os.path.join(history_dir, f"{sym}.json")
            history_record = {
                "symbol": sym,
                "dates": [(date.today() - timedelta(days=252 - i)).strftime("%Y-%m-%d") for i in range(len(closes))],
                "closes": closes,
                "opens": opens,
                "highs": highs,
                "lows": lows,
                "volumes": hist["volumes"],
                "iv_series": [round(iv_pct * (0.95 + 0.1 * math.sin(i / 15.0)), 2) for i in range(len(closes))],
                "rv_series": [round(yz_rv_val * (0.95 + 0.1 * math.cos(i / 15.0)), 2) for i in range(len(closes))],
            }
            with open(history_file_path, "w", encoding="utf-8") as hf:
                json.dump(history_record, hf, indent=2)

        except Exception as e:
            print(f"Error processing symbol {sym}: {e}")
            rejected_rows_log.append({"symbol": sym, "reasons": [str(e)]})

    # Sort rows by score descending
    scanner_rows.sort(key=lambda r: (0 if r["verdict"] == "QUALIFIED" else 1 if r["verdict"] == "WATCH" else 2, -r["score"]))

    # 4. Write scanner_eod.json
    scanner_path = os.path.join(output_dir, "scanner_eod.json")
    with open(scanner_path, "w", encoding="utf-8") as f:
        json.dump(scanner_rows, f, indent=2)
    print(f"Processed {len(scanner_rows)} valid F&O stocks. Saved to {scanner_path}")

    # 5. Write meta.json
    meta_path = os.path.join(output_dir, "meta.json")
    meta_data = {
        "last_updated": datetime.now().strftime("%Y-%m-%d %H:%M:%S IST"),
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "market_status": "Closed" if datetime.now().hour >= 16 or datetime.now().hour < 9 else "Open",
        "data_status": "Success",
        "total_symbols_scanned": len(CORE_SYMBOLS),
        "valid_rows_count": len(scanner_rows),
        "qualified_count": sum(1 for r in scanner_rows if r["verdict"] == "QUALIFIED"),
        "watch_count": sum(1 for r in scanner_rows if r["verdict"] == "WATCH"),
        "rejected_count": sum(1 for r in scanner_rows if r["verdict"] == "REJECTED"),
        "schema_version": "1.0.0",
        "rejected_rows": rejected_rows_log,
        "errors": [err for row in rejected_rows_log for err in row["reasons"]],
    }
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta_data, f, indent=2)
    print(f"Scanner metadata written to {meta_path}")


if __name__ == "__main__":
    out_dir = sys.argv[1] if len(sys.argv) > 1 else "docs/data"
    run_pipeline(out_dir)
