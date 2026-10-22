"""
Trade mathematics and quantitative options analytics for VolEdge India.
Includes Black-Scholes put pricing, risk-neutral POP N(d2), P(touch),
expected move, strike snapping, empirical POP, gap cover, credit, RoM,
EV, and stress testing.
"""

import math
from typing import List, Dict, Optional, Tuple
from scanner.config import RISK_FREE_RATE, DEFAULT_CAPITAL, get_strike_interval


def norm_cdf(x: float) -> float:
    """Standard normal cumulative distribution function N(x)."""
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def black_scholes_put_price(
    spot: float,
    strike: float,
    dte: float,
    volatility: float,
    rate: float = RISK_FREE_RATE,
    dividend_yield: float = 0.0
) -> float:
    """
    Compute Black-Scholes European put option price.
    Volatility is annualized in decimal (e.g. 0.20 for 20%).
    DTE is in days (converted to T = dte / 365.0).
    """
    if spot <= 0 or strike <= 0 or volatility <= 0 or dte <= 0:
        return max(0.0, strike - spot)

    t = dte / 365.0
    vol_sqrt_t = volatility * math.sqrt(t)

    d1 = (math.log(spot / strike) + (rate - dividend_yield + 0.5 * volatility ** 2) * t) / vol_sqrt_t
    d2 = d1 - vol_sqrt_t

    put_price = (
        strike * math.exp(-rate * t) * norm_cdf(-d2)
        - spot * math.exp(-dividend_yield * t) * norm_cdf(-d1)
    )
    return max(0.0, put_price)


def calculate_d1_d2(
    spot: float,
    strike: float,
    dte: float,
    volatility: float,
    rate: float = RISK_FREE_RATE,
    dividend_yield: float = 0.0
) -> Tuple[float, float]:
    """Calculate d1 and d2 for Black-Scholes formula."""
    if spot <= 0 or strike <= 0 or volatility <= 0 or dte <= 0:
        return 0.0, 0.0
    t = dte / 365.0
    vol_sqrt_t = volatility * math.sqrt(t)
    d1 = (math.log(spot / strike) + (rate - dividend_yield + 0.5 * volatility ** 2) * t) / vol_sqrt_t
    d2 = d1 - vol_sqrt_t
    return d1, d2


def calculate_pop(
    spot: float,
    strike: float,
    dte: float,
    volatility: float,
    rate: float = RISK_FREE_RATE,
    dividend_yield: float = 0.0
) -> float:
    """
    Compute risk-neutral Probability of Expiring Worthless (POP) for a short put:
    POP = P(S_T >= K) = N(d2).
    Returns percentage between 0.0 and 100.0.
    """
    if spot <= 0 or strike <= 0 or dte <= 0:
        return 100.0 if spot >= strike else 0.0
    if volatility <= 0:
        return 100.0 if spot >= strike else 0.0

    _, d2 = calculate_d1_d2(spot, strike, dte, volatility, rate, dividend_yield)
    pop = norm_cdf(d2) * 100.0
    return round(pop, 2)


def calculate_p_touch(pop: float) -> float:
    """
    Compute Probability of Touching the short strike prior to expiry:
    P(touch) ~ 2 * (1 - POP).
    Returns percentage between 0.0 and 100.0.
    """
    p_touch = 2.0 * (100.0 - pop)
    return round(max(0.0, min(100.0, p_touch)), 2)


def calculate_expected_move(spot: float, volatility: float, dte: float) -> float:
    """
    Compute 1-standard deviation expected move: S * sigma * sqrt(T).
    Volatility in decimal.
    """
    if spot <= 0 or volatility <= 0 or dte <= 0:
        return 0.0
    t = dte / 365.0
    em = spot * volatility * math.sqrt(t)
    return round(em, 2)


def calculate_recommended_strike(
    spot: float,
    volatility: float,
    dte: float,
    put_wall: float = 0.0,
    symbol: str = "",
    interval: Optional[float] = None
) -> float:
    """
    Compute recommended strike:
    Highest listed NSE strike <= min(put_wall, spot * exp(-1.25 * sigma * sqrt(T))).
    Snaps downward to listed NSE strike interval.
    Never exceeds put_wall (if put_wall > 0) and always strictly below spot.
    """
    if spot <= 0:
        return 0.0

    t = max(dte, 1.0) / 365.0
    effective_vol = max(volatility, 0.05)
    raw_target = spot * math.exp(-1.25 * effective_vol * math.sqrt(t))

    if put_wall > 0:
        target = min(put_wall, raw_target)
    else:
        target = raw_target

    if interval is None or interval <= 0:
        interval = get_strike_interval(symbol, spot)

    # Snap downwards to listed strike interval
    snapped = math.floor(target / interval) * interval

    # If snapped strike equals or exceeds spot, step down at least one interval
    if snapped >= spot:
        snapped = math.floor((spot - 1e-4) / interval) * interval

    # Ensure never above put_wall
    if put_wall > 0 and snapped > put_wall:
        snapped = math.floor(put_wall / interval) * interval

    return round(snapped, 2)


def calculate_empirical_pop(
    spot: float,
    strike: float,
    dte: int,
    historical_closes: List[float]
) -> Optional[float]:
    """
    Compute 3-5Y historical empirical survival probability:
    Percentage of rolling windows of duration DTE where price did not close
    below spot * (strike / spot).
    """
    if len(historical_closes) < (dte + 30) or spot <= 0 or strike <= 0:
        return None

    cushion_ratio = strike / spot
    window_count = 0
    survived_count = 0

    for i in range(len(historical_closes) - dte):
        entry_price = historical_closes[i]
        exit_price = historical_closes[i + dte]
        if entry_price <= 0:
            continue
        window_count += 1
        threshold = entry_price * cushion_ratio
        if exit_price >= threshold:
            survived_count += 1

    if window_count == 0:
        return None

    emp_pop = (survived_count / window_count) * 100.0
    return round(emp_pop, 2)


def calculate_gap_cover(
    spot: float,
    strike: float,
    historical_closes: List[float],
    historical_opens: Optional[List[float]] = None
) -> Optional[float]:
    """
    Compute Gap Cover = Cushion / abs(5th percentile overnight gap).
    Cushion = (Spot - Strike) / Spot.
    """
    if spot <= 0 or strike <= 0 or len(historical_closes) < 30:
        return None

    cushion = (spot - strike) / spot
    if cushion <= 0:
        return 0.0

    # Calculate overnight gaps
    gaps: List[float] = []
    if historical_opens and len(historical_opens) == len(historical_closes):
        for i in range(1, len(historical_closes)):
            prev_c = historical_closes[i - 1]
            curr_o = historical_opens[i]
            if prev_c > 0 and curr_o > 0:
                gaps.append((curr_o - prev_c) / prev_c)
    else:
        for i in range(1, len(historical_closes)):
            prev_c = historical_closes[i - 1]
            curr_c = historical_closes[i]
            if prev_c > 0 and curr_c > 0:
                gaps.append((curr_c - prev_c) / prev_c)

    if not gaps:
        return None

    gaps.sort()
    # 5th percentile worst gap (downside)
    idx = max(0, int(len(gaps) * 0.05))
    gap_5th = abs(gaps[idx])

    if gap_5th < 0.005:
        gap_5th = 0.005  # minimum floor 0.5%

    gap_cover = cushion / gap_5th
    return round(gap_cover, 2)


def calculate_credit(premium: float, lot_size: int) -> float:
    """Gross option premium retained on worthless expiry."""
    return round(max(0.0, premium) * lot_size, 2)


def calculate_rom(credit: float, margin: float) -> Optional[float]:
    """
    Calculate Return on Margin (RoM %): (Credit / Margin) * 100.
    """
    if margin <= 0:
        return None
    rom = (credit / margin) * 100.0
    return round(rom, 2)


def calculate_ev(
    pop: float,
    credit: float,
    spot: float,
    strike: float,
    dte: float,
    volatility: float,
    lot_size: int
) -> float:
    """
    Calculate Expected Value of short put trade:
    EV = (POP/100 * Credit) - ((1 - POP/100) * Expected Loss at Expiry).
    Uses conditional expectation under Black-Scholes lognormal model.
    """
    if credit <= 0 or spot <= 0 or strike <= 0 or dte <= 0:
        return 0.0

    p_win = pop / 100.0
    p_loss = 1.0 - p_win

    # Model theoretical put price
    model_put = black_scholes_put_price(spot, strike, dte, volatility)
    # Total risk-neutral expected payout of short put is Credit - Model_Put * Lot
    ev = credit - (model_put * lot_size)
    return round(ev, 2)


def calculate_stress_loss(
    spot: float,
    strike: float,
    dte: float,
    volatility: float,
    lot_size: int,
    capital: float = DEFAULT_CAPITAL,
    entry_premium: float = 0.0
) -> Dict[str, float]:
    """
    Compute stress loss at -2 sigma gap with IV +10 percentage points (+0.10):
    Stress spot = spot * (1 - 2 * sigma * sqrt(1/252))
    Stress IV = volatility + 0.10
    Returns dict with 'stress_loss_inr' and 'stress_loss_capital_pct'.
    """
    if spot <= 0 or strike <= 0 or dte <= 0 or volatility <= 0:
        return {"stress_loss_inr": 0.0, "stress_loss_capital_pct": 0.0}

    # -2 sigma overnight gap
    sigma_1d = volatility * math.sqrt(1.0 / 252.0)
    stress_spot = spot * max(0.5, (1.0 - (2.0 * sigma_1d)))
    stress_vol = volatility + 0.10
    stress_dte = max(dte - 1.0, 0.1)

    stressed_put_price = black_scholes_put_price(stress_spot, strike, stress_dte, stress_vol)
    current_put_price = entry_premium if entry_premium > 0 else black_scholes_put_price(spot, strike, dte, volatility)

    loss_per_share = max(0.0, stressed_put_price - current_put_price)
    total_stress_loss = loss_per_share * lot_size
    stress_loss_capital_pct = (total_stress_loss / max(capital, 1.0)) * 100.0

    return {
        "stress_loss_inr": round(total_stress_loss, 2),
        "stress_loss_capital_pct": round(stress_loss_capital_pct, 2),
    }
