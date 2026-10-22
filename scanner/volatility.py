"""
Volatility analytics for VolEdge India.
Includes Yang-Zhang 20D Realized Volatility, Close-to-Close HV10,
IV Percentile 1Y, IV/YZ20 ratio, HV10/YZ20 ratio, DownVol ratio 20D,
25D Put Skew percentile, and Term Structure.
"""

import math
from typing import List, Optional


def compute_yang_zhang_rv(
    opens: List[float],
    highs: List[float],
    lows: List[float],
    closes: List[float],
    period: int = 20
) -> Optional[float]:
    """
    Compute Yang-Zhang (2000) historical volatility estimator.
    Combines overnight jumps, open-to-close, and Rogers-Satchell variance.
    Returns annualized volatility in percentage points (e.g. 21.5 for 21.5%).
    Requires at least (period + 1) bars.
    """
    n = len(closes)
    if n <= period or len(opens) != n or len(highs) != n or len(lows) != n:
        return None

    # Take the last period + 1 bars
    sub_o = opens[-(period + 1):]
    sub_h = highs[-(period + 1):]
    sub_l = lows[-(period + 1):]
    sub_c = closes[-(period + 1):]

    # Overnight jumps: u_t = ln(O_t / C_{t-1}) for t = 1..period
    u = [
        math.log(sub_o[t] / sub_c[t - 1])
        for t in range(1, period + 1)
        if sub_o[t] > 0 and sub_c[t - 1] > 0
    ]
    if len(u) < period:
        return None

    u_mean = sum(u) / period
    var_o = sum((x - u_mean) ** 2 for x in u) / (period - 1)

    # Open-to-close jumps: c_t = ln(C_t / O_t) for t = 1..period
    c = [
        math.log(sub_c[t] / sub_o[t])
        for t in range(1, period + 1)
        if sub_c[t] > 0 and sub_o[t] > 0
    ]
    if len(c) < period:
        return None

    c_mean = sum(c) / period
    var_c = sum((x - c_mean) ** 2 for x in c) / (period - 1)

    # Rogers-Satchell variance
    rs_terms: List[float] = []
    for t in range(1, period + 1):
        o_t, h_t, l_t, c_t = sub_o[t], sub_h[t], sub_l[t], sub_c[t]
        if o_t > 0 and h_t > 0 and l_t > 0 and c_t > 0:
            term = (
                math.log(h_t / c_t) * math.log(h_t / o_t) +
                math.log(l_t / c_t) * math.log(l_t / o_t)
            )
            rs_terms.append(term)

    if len(rs_terms) < period:
        return None

    var_rs = sum(rs_terms) / period

    k = 0.34 / (1.34 + (period + 1.0) / (period - 1.0))
    var_yz = var_o + (k * var_c) + ((1.0 - k) * var_rs)

    if var_yz < 0.0:
        var_yz = 0.0

    annualized_rv = math.sqrt(var_yz * 252.0) * 100.0
    return round(annualized_rv, 2)


def compute_historical_volatility(closes: List[float], period: int = 10) -> Optional[float]:
    """
    Compute Close-to-Close Historical Volatility (annualized %) over specified period.
    """
    if len(closes) <= period:
        return None

    sub_c = closes[-(period + 1):]
    returns = [
        math.log(sub_c[i] / sub_c[i - 1])
        for i in range(1, len(sub_c))
        if sub_c[i - 1] > 0 and sub_c[i] > 0
    ]
    if len(returns) < period:
        return None

    mean_r = sum(returns) / period
    var_r = sum((x - mean_r) ** 2 for x in returns) / (period - 1)

    annualized_hv = math.sqrt(var_r * 252.0) * 100.0
    return round(annualized_hv, 2)


def compute_iv_percentile(current_iv: float, historical_ivs: List[float]) -> Optional[float]:
    """
    Compute 1-year IV Percentile (0 to 100).
    Represents percentage of days in the past year where IV was lower than current_iv.
    """
    if not historical_ivs or current_iv <= 0:
        return None
    valid_ivs = [x for x in historical_ivs if x > 0]
    if not valid_ivs:
        return None

    count_below = sum(1 for x in valid_ivs if x < current_iv)
    percentile = (count_below / len(valid_ivs)) * 100.0
    return round(percentile, 1)


def compute_downvol_ratio_20d(closes: List[float], period: int = 20) -> Optional[float]:
    """
    Compute 20-day DownVol ratio: ratio of downside standard deviation to upside standard deviation.
    A value <= 1.0 means upside moves have larger variance than downside moves (bullish / quiet).
    A value > 1.3 flags elevated downside selling pressure.
    """
    if len(closes) <= period:
        return None

    sub_c = closes[-(period + 1):]
    returns = [
        (sub_c[i] - sub_c[i - 1]) / sub_c[i - 1]
        for i in range(1, len(sub_c))
        if sub_c[i - 1] > 0
    ]

    down_returns = [r for r in returns if r < 0.0]
    up_returns = [r for r in returns if r > 0.0]

    if not down_returns:
        return 0.0
    if not up_returns:
        return 2.5

    down_ss = sum(r ** 2 for r in down_returns) / len(down_returns)
    up_ss = sum(r ** 2 for r in up_returns) / len(up_returns)

    if up_ss <= 1e-10:
        return 2.5

    ratio = math.sqrt(down_ss / up_ss)
    return round(ratio, 2)


def compute_skew_percentile(current_skew: float, historical_skews: List[float]) -> Optional[float]:
    """
    Compute 25D put skew percentile (0 to 100).
    Skew is defined as 25D Put IV / ATM IV.
    """
    if not historical_skews or current_skew <= 0:
        return 50.0
    valid = [s for s in historical_skews if s > 0]
    if not valid:
        return 50.0
    count_below = sum(1 for s in valid if s < current_skew)
    return round((count_below / len(valid)) * 100.0, 1)


def compute_term_structure(near_iv: float, next_iv: float) -> Optional[float]:
    """
    Compute term structure ratio: Near-month IV / Next-month IV.
    Normal contango in options is < 1.0; backwardation (stress/event) is > 1.10.
    """
    if near_iv <= 0 or next_iv <= 0:
        return None
    return round(near_iv / next_iv, 3)
