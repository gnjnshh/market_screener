"""
Pillar evaluation, hard guard checks, score calculation, and verdict determination for VolEdge India.
Scoring weights (sum = 100):
- Empirical + RN POP: 25
- VRP + IV pct: 20
- Gap cover + stress: 15
- Put wall + build-up: 15
- Structure: 15
- Liquidity: 10
Fundamentals are an gating guard only.
"""

from typing import Dict, List, Any, Optional, Tuple
from scanner.config import (
    SCORING_WEIGHTS,
    SCORE_THRESHOLDS,
    THRESHOLDS,
    SECTOR_MEDIAN_ROE,
    STOCK_SECTOR_MAP,
)


def evaluate_fundamental_gate(
    symbol: str,
    roe: Optional[float],
    ttm_pat_yoy_pct: Optional[float],
    consecutive_pat_decline_quarters: int = 0
) -> Tuple[bool, List[str]]:
    """
    Evaluate Fundamental Gate:
    1. ROE minus sector median > 0
    2. TTM PAT YoY >= 10%
    3. Reject if 2 straight quarters of PAT decline
    Returns (passed, list_of_reasons).
    """
    reasons: List[str] = []
    sector = STOCK_SECTOR_MAP.get(symbol.upper(), "Default")
    median_roe = SECTOR_MEDIAN_ROE.get(sector, SECTOR_MEDIAN_ROE["Default"])

    if roe is not None and roe <= median_roe:
        reasons.append(f"ROE {roe:.1f}% is below sector median {median_roe:.1f}% for {sector}")

    if ttm_pat_yoy_pct is not None and ttm_pat_yoy_pct < 10.0:
        reasons.append(f"TTM PAT YoY growth {ttm_pat_yoy_pct:.1f}% is below 10.0% threshold")

    if consecutive_pat_decline_quarters >= 2:
        reasons.append(f"Reported {consecutive_pat_decline_quarters} consecutive quarters of PAT decline")

    passed = len(reasons) == 0
    return passed, reasons


def check_hard_guards(stock_data: Dict[str, Any]) -> List[str]:
    """
    Check all hard rejection guards across the 5 pillars.
    Returns list of failed guard descriptions (empty if all pass).
    """
    failed: List[str] = []

    # 1. Structure Guards
    spot_200 = stock_data.get("spot_200dma")
    if spot_200 is not None:
        if spot_200 < THRESHOLDS["spot_200dma"]["reject_min"]:
            failed.append(f"Spot/200DMA is {spot_200:.2f} (below {THRESHOLDS['spot_200dma']['reject_min']} floor)")
        elif spot_200 > THRESHOLDS["spot_200dma"]["reject_max"]:
            failed.append(f"Spot/200DMA is {spot_200:.2f} (overextended above {THRESHOLDS['spot_200dma']['reject_max']})")

    dd_52w = stock_data.get("drawdown_52w")
    if dd_52w is not None and dd_52w < THRESHOLDS["drawdown_52w"]["reject_min"]:
        failed.append(f"52W Drawdown is {dd_52w * 100:.1f}% (severe breakdown beyond -30%)")

    rsi = stock_data.get("rsi_14")
    if rsi is not None:
        if rsi < THRESHOLDS["rsi_14"]["reject_min"]:
            failed.append(f"RSI(14) is {rsi:.1f} (falling knife below 28.0)")
        elif rsi > THRESHOLDS["rsi_14"]["reject_max"]:
            failed.append(f"RSI(14) is {rsi:.1f} (overbought above 65.0)")

    adx = stock_data.get("adx_14")
    plus_di = stock_data.get("plus_di")
    minus_di = stock_data.get("minus_di")
    if adx is not None and plus_di is not None and minus_di is not None:
        if adx > THRESHOLDS["adx_14"]["reject_threshold"] and minus_di > plus_di:
            failed.append(f"ADX is {adx:.1f} with -DI ({minus_di:.1f}) > +DI ({plus_di:.1f}) (active bear trend)")

    downvol = stock_data.get("downvol_ratio_20d")
    rising_delivery = stock_data.get("rising_delivery", False)
    if downvol is not None and downvol > THRESHOLDS["downvol_ratio_20d"]["reject_max"] and rising_delivery:
        failed.append(f"DownVol ratio is {downvol:.2f} with rising delivery volume (institutional distribution)")

    # 2. Volatility Guards
    iv_pct = stock_data.get("iv_percentile_1y")
    if iv_pct is not None and iv_pct < THRESHOLDS["iv_percentile_1y"]["reject_min"]:
        failed.append(f"1Y IV Percentile is {iv_pct:.1f}% (below 30% edge threshold)")

    iv_yz = stock_data.get("iv_yz_ratio")
    if iv_yz is not None and iv_yz < THRESHOLDS["iv_yz_ratio"]["reject_min"]:
        failed.append(f"IV/YZ20 ratio is {iv_yz:.2f} (negative VRP below 1.0)")

    hv10_yz20 = stock_data.get("hv10_yz20")
    if hv10_yz20 is not None and hv10_yz20 > THRESHOLDS["hv10_yz20"]["reject_max"]:
        failed.append(f"HV10/YZ20 ratio is {hv10_yz20:.2f} (short-term volatility shock above 1.2)")

    skew_pct = stock_data.get("skew_25d_pct")
    if skew_pct is not None and skew_pct > THRESHOLDS["skew_25d_pct"]["reject_max"]:
        failed.append(f"25D Put Skew percentile is {skew_pct:.1f}% (extreme downside panic above 90%)")

    term_struct = stock_data.get("term_structure")
    if term_struct is not None and term_struct > THRESHOLDS["term_structure"]["reject_max"]:
        failed.append(f"Term Structure Near/Next IV is {term_struct:.2f} (backwardation above 1.10)")

    # 3. Positioning Guards
    oi_change_3d = stock_data.get("put_wall_oi_change_3d")
    if oi_change_3d is not None and oi_change_3d < THRESHOLDS["put_wall_oi_change_3d"]["reject_min"]:
        failed.append(f"Put Wall OI collapsed by {abs(oi_change_3d):.1f}% over 3 days (support breakdown)")

    spread = stock_data.get("bid_ask_spread_pct")
    if spread is not None and spread > THRESHOLDS["bid_ask_spread_pct"]["reject_max"]:
        failed.append(f"Option bid-ask spread is {spread:.2f}% (illiquid, above 5%)")

    mwpl = stock_data.get("mwpl_pct")
    if mwpl is not None and mwpl >= THRESHOLDS["mwpl_pct"]["reject_max"]:
        failed.append(f"MWPL utilization is {mwpl:.1f}% (danger of F&O ban, >= 80%)")

    buildup = stock_data.get("futures_buildup", "")
    basis = stock_data.get("annualized_basis_pct")
    if buildup == "Short Buildup" and basis is not None and basis < 0.0:
        failed.append("Futures show Short Buildup with negative annualized basis")

    # 4. Trade Math Guards
    pop = stock_data.get("pop")
    if pop is not None and pop < THRESHOLDS["pop"]["reject_min"]:
        failed.append(f"Risk-neutral POP is {pop:.1f}% (below 75% minimum)")

    emp_pop = stock_data.get("empirical_pop")
    if emp_pop is not None and emp_pop < THRESHOLDS["empirical_pop"]["reject_min"]:
        failed.append(f"Empirical POP is {emp_pop:.1f}% (below 78% historical threshold)")

    gap_cover = stock_data.get("gap_cover")
    if gap_cover is not None and gap_cover < THRESHOLDS["gap_cover"]["reject_min"]:
        failed.append(f"Gap Cover is {gap_cover:.2f}x (cushion fails 1.5x 5th-pct overnight gap)")

    stress_pct = stock_data.get("stress_loss_capital_pct")
    if stress_pct is not None and stress_pct > THRESHOLDS["stress_loss_capital_pct"]["reject_max"]:
        failed.append(f"Stress loss is {stress_pct:.2f}% of capital (exceeds 3.0% maximum risk)")

    # 5. Event Gap Guard
    if stock_data.get("event_gap", False):
        failed.append("Corporate earnings, dividend, or board meeting scheduled prior to expiry")

    # 6. Fundamental Gate Guard
    fund_passed = stock_data.get("fundamental_gate_passed", True)
    if not fund_passed:
        fund_reasons = stock_data.get("fundamental_reasons", [])
        if fund_reasons:
            failed.extend(fund_reasons)
        else:
            failed.append("Failed fundamental quality gate")

    return failed


def calculate_score(stock_data: Dict[str, Any]) -> float:
    """
    Calculate composite score (0-100) based on quantitative scoring weights:
    - Empirical + RN POP (25 pts)
    - VRP + IV pct (20 pts)
    - Gap cover + stress (15 pts)
    - Put wall + build-up (15 pts)
    - Structure (15 pts)
    - Liquidity (10 pts)
    Total = 100. Mirrored exactly in calc.js.
    """
    total_score = 0.0

    # 1. Empirical + RN POP (Weight: 25)
    # RN POP: 75% -> 0 pts, 90%+ -> 12.5 pts
    pop = stock_data.get("pop", 75.0)
    if pop is not None:
        rn_pts = max(0.0, min(12.5, (pop - 75.0) / (90.0 - 75.0) * 12.5))
    else:
        rn_pts = 0.0

    # Empirical POP: 78% -> 0 pts, 92%+ -> 12.5 pts
    emp_pop = stock_data.get("empirical_pop", 78.0)
    if emp_pop is not None:
        emp_pts = max(0.0, min(12.5, (emp_pop - 78.0) / (92.0 - 78.0) * 12.5))
    else:
        emp_pts = 0.0
    total_score += (rn_pts + emp_pts)

    # 2. VRP + IV pct (Weight: 20)
    # VRP (IV / YZ20): 1.0 -> 0 pts, 1.30+ -> 10 pts
    iv_yz = stock_data.get("iv_yz_ratio", 1.0)
    if iv_yz is not None:
        vrp_pts = max(0.0, min(10.0, (iv_yz - 1.0) / (1.30 - 1.0) * 10.0))
    else:
        vrp_pts = 0.0

    # IV Percentile: 30% -> 0 pts, 80%+ -> 10 pts
    iv_pct = stock_data.get("iv_percentile_1y", 30.0)
    if iv_pct is not None:
        ivp_pts = max(0.0, min(10.0, (iv_pct - 30.0) / (80.0 - 30.0) * 10.0))
    else:
        ivp_pts = 0.0
    total_score += (vrp_pts + ivp_pts)

    # 3. Gap cover + stress (Weight: 15)
    # Gap cover: 1.5 -> 0 pts, 3.0+ -> 7.5 pts
    gap_cover = stock_data.get("gap_cover", 1.5)
    if gap_cover is not None:
        gc_pts = max(0.0, min(7.5, (gap_cover - 1.5) / (3.0 - 1.5) * 7.5))
    else:
        gc_pts = 0.0

    # Stress loss: 3.0% capital -> 0 pts, <= 1.0% capital -> 7.5 pts
    stress_pct = stock_data.get("stress_loss_capital_pct", 3.0)
    if stress_pct is not None:
        stress_pts = max(0.0, min(7.5, (3.0 - stress_pct) / (3.0 - 1.0) * 7.5))
    else:
        stress_pts = 0.0
    total_score += (gc_pts + stress_pts)

    # 4. Put wall + build-up (Weight: 15)
    # Put wall 3D change: -20% -> 0 pts, +15%+ -> 7.5 pts
    oi_change = stock_data.get("put_wall_oi_change_3d", 0.0)
    if oi_change is not None:
        oi_pts = max(0.0, min(7.5, (oi_change - (-20.0)) / (15.0 - (-20.0)) * 7.5))
    else:
        oi_pts = 3.5

    # Futures build-up & basis (7.5 pts)
    buildup = stock_data.get("futures_buildup", "Neutral")
    basis = stock_data.get("annualized_basis_pct", 0.0)
    if buildup == "Long Buildup" and (basis is None or basis >= 0.0):
        fb_pts = 7.5
    elif buildup == "Short Covering":
        fb_pts = 5.5
    elif buildup == "Neutral":
        fb_pts = 4.0
    elif buildup == "Long Unwinding":
        fb_pts = 2.5
    else:  # Short Buildup
        fb_pts = 0.0
    total_score += (oi_pts + fb_pts)

    # 5. Structure (Weight: 15)
    # Spot/200DMA: 0.95 - 1.15 optimal (5 pts)
    spot_200 = stock_data.get("spot_200dma", 1.0)
    if spot_200 is not None:
        if 0.95 <= spot_200 <= 1.15:
            s200_pts = 5.0
        elif 0.92 <= spot_200 < 0.95:
            s200_pts = (spot_200 - 0.92) / (0.95 - 0.92) * 5.0
        elif 1.15 < spot_200 <= 1.30:
            s200_pts = (1.30 - spot_200) / (1.30 - 1.15) * 5.0
        else:
            s200_pts = 0.0
    else:
        s200_pts = 2.5

    # Drawdown 52W: -5% to -20% ideal (5 pts)
    dd = stock_data.get("drawdown_52w", -0.10)
    if dd is not None:
        if -0.20 <= dd <= -0.05:
            dd_pts = 5.0
        elif -0.30 <= dd < -0.20:
            dd_pts = (dd - (-0.30)) / (-0.20 - (-0.30)) * 5.0
        elif -0.05 < dd <= 0.0:
            dd_pts = 4.0
        else:
            dd_pts = 0.0
    else:
        dd_pts = 2.5

    # RSI14 & %B (5 pts): RSI in 35-55 and %B in 0.10-0.50
    rsi = stock_data.get("rsi_14", 45.0)
    pct_b = stock_data.get("percent_b", 0.30)
    rsi_pts = 2.5
    if rsi is not None:
        if 35.0 <= rsi <= 55.0:
            rsi_pts = 2.5
        elif 28.0 <= rsi < 35.0:
            rsi_pts = (rsi - 28.0) / (35.0 - 28.0) * 2.5
        elif 55.0 < rsi <= 65.0:
            rsi_pts = (65.0 - rsi) / (65.0 - 55.0) * 2.5
        else:
            rsi_pts = 0.0

    b_pts = 2.5
    if pct_b is not None:
        if 0.10 <= pct_b <= 0.50:
            b_pts = 2.5
        elif 0.0 <= pct_b < 0.10:
            b_pts = (pct_b / 0.10) * 2.5
        elif 0.50 < pct_b <= 1.0:
            b_pts = ((1.0 - pct_b) / 0.50) * 2.5
        else:
            b_pts = 0.0
    total_score += (s200_pts + dd_pts + rsi_pts + b_pts)

    # 6. Liquidity (Weight: 10)
    # Bid-ask spread: <= 1.0% -> 5 pts, 5.0% -> 0 pts
    spread = stock_data.get("bid_ask_spread_pct", 2.0)
    if spread is not None:
        spread_pts = max(0.0, min(5.0, (5.0 - spread) / (5.0 - 1.0) * 5.0))
    else:
        spread_pts = 2.5

    # MWPL: <= 40% -> 5 pts, 80% -> 0 pts
    mwpl = stock_data.get("mwpl_pct", 50.0)
    if mwpl is not None:
        mwpl_pts = max(0.0, min(5.0, (80.0 - mwpl) / (80.0 - 40.0) * 5.0))
    else:
        mwpl_pts = 2.5
    total_score += (spread_pts + mwpl_pts)

    return round(max(0.0, min(100.0, total_score)), 1)


def determine_verdict(stock_data: Dict[str, Any], score: float) -> Tuple[str, List[str]]:
    """
    Determine final verdict: QUALIFIED / WATCH / REJECTED.
    A stock failing ANY hard guard is strictly REJECTED regardless of score.
    Otherwise:
    - Score >= 72 -> QUALIFIED
    - Score >= 60 -> WATCH
    - Score < 60  -> REJECTED
    """
    failed_guards = check_hard_guards(stock_data)

    if failed_guards:
        return "REJECTED", failed_guards

    if score >= SCORE_THRESHOLDS["qualified"]:
        return "QUALIFIED", []
    elif score >= SCORE_THRESHOLDS["watch"]:
        return "WATCH", ["Score is in watchlist zone (60-71)"]
    else:
        return "REJECTED", [f"Composite score ({score:.1f}) is below 60.0 threshold"]
