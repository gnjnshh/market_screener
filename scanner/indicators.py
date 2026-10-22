"""
Technical indicators for VolEdge India.
Includes 200DMA ratio, 52W drawdown, RSI14, Bollinger %B, ADX14 (+DI/-DI),
1Y Beta, and delivery volume trend.
"""

import math
from typing import List, Dict, Optional, Any


def compute_spot_200dma(spot: float, closes: List[float]) -> Optional[float]:
    """Compute Spot / 200-day Simple Moving Average."""
    if not closes or len(closes) < 20:
        return None
    # Use available closes up to 200
    window = closes[-200:]
    sma = sum(window) / len(window)
    if sma <= 0:
        return None
    return round(spot / sma, 4)


def compute_drawdown_52w(spot: float, highs: List[float]) -> Optional[float]:
    """Compute drawdown from 52-week (252 trading days) high."""
    if not highs:
        return None
    window = highs[-252:]
    high_52w = max(window)
    if high_52w <= 0:
        return None
    return round((spot - high_52w) / high_52w, 4)


def compute_rsi(closes: List[float], period: int = 14) -> Optional[float]:
    """
    Compute Relative Strength Index using Wilder's smoothed moving average.
    Returns value between 0.0 and 100.0, or None if insufficient data.
    """
    if not closes or len(closes) <= period:
        return None

    # Calculate price changes
    deltas = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    if len(deltas) < period:
        return None

    # First average gain and loss (simple mean)
    gains = [max(d, 0.0) for d in deltas[:period]]
    losses = [max(-d, 0.0) for d in deltas[:period]]

    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period

    # Wilder's smoothing for subsequent periods
    for d in deltas[period:]:
        gain = max(d, 0.0)
        loss = max(-d, 0.0)
        avg_gain = (avg_gain * (period - 1) + gain) / period
        avg_loss = (avg_loss * (period - 1) + loss) / period

    if avg_loss == 0.0:
        return 100.0
    if avg_gain == 0.0:
        return 0.0

    rs = avg_gain / avg_loss
    rsi = 100.0 - (100.0 / (1.0 + rs))
    return round(rsi, 2)


def compute_percent_b(closes: List[float], period: int = 20, num_std: float = 2.0) -> Optional[float]:
    """
    Compute Bollinger Bands %B = (Close - LowerBand) / (UpperBand - LowerBand).
    Returns None if insufficient data or zero standard deviation.
    """
    if not closes or len(closes) < period:
        return None

    window = closes[-period:]
    mean = sum(window) / period
    variance = sum((x - mean) ** 2 for x in window) / (period - 1)
    std = math.sqrt(variance)

    if std <= 1e-8:
        return 0.5

    upper_band = mean + (num_std * std)
    lower_band = mean - (num_std * std)
    bandwidth = upper_band - lower_band

    if bandwidth <= 1e-8:
        return 0.5

    current_close = closes[-1]
    percent_b = (current_close - lower_band) / bandwidth
    return round(percent_b, 4)


def compute_adx(
    highs: List[float],
    lows: List[float],
    closes: List[float],
    period: int = 14
) -> Dict[str, Optional[float]]:
    """
    Compute Wilder's Average Directional Index (ADX) along with +DI and -DI.
    Returns dict with keys: 'adx', 'plus_di', 'minus_di'.
    """
    default_result: Dict[str, Optional[float]] = {"adx": None, "plus_di": None, "minus_di": None}
    n = len(closes)
    if n < period * 2 or len(highs) != n or len(lows) != n:
        return default_result

    # Compute TR, +DM, -DM
    tr_list: List[float] = []
    plus_dm_list: List[float] = []
    minus_dm_list: List[float] = []

    for i in range(1, n):
        h = highs[i]
        l = lows[i]
        prev_c = closes[i - 1]
        prev_h = highs[i - 1]
        prev_l = lows[i - 1]

        # True Range
        tr = max(h - l, abs(h - prev_c), abs(l - prev_c))
        tr_list.append(tr)

        # Directional Movement
        up_move = h - prev_h
        down_move = prev_l - l

        if up_move > down_move and up_move > 0:
            plus_dm_list.append(up_move)
        else:
            plus_dm_list.append(0.0)

        if down_move > up_move and down_move > 0:
            minus_dm_list.append(down_move)
        else:
            minus_dm_list.append(0.0)

    if len(tr_list) < period:
        return default_result

    # Initial sums for Wilder smoothing
    smoothed_tr = sum(tr_list[:period])
    smoothed_plus_dm = sum(plus_dm_list[:period])
    smoothed_minus_dm = sum(minus_dm_list[:period])

    dx_list: List[float] = []

    def get_di(plus_dm_val: float, minus_dm_val: float, tr_val: float):
        if tr_val <= 1e-8:
            return 0.0, 0.0
        p_di = (plus_dm_val / tr_val) * 100.0
        m_di = (minus_dm_val / tr_val) * 100.0
        return p_di, m_di

    p_di, m_di = get_di(smoothed_plus_dm, smoothed_minus_dm, smoothed_tr)
    sum_di = p_di + m_di
    dx = (abs(p_di - m_di) / sum_di * 100.0) if sum_di > 1e-8 else 0.0
    dx_list.append(dx)

    for i in range(period, len(tr_list)):
        smoothed_tr = smoothed_tr - (smoothed_tr / period) + tr_list[i]
        smoothed_plus_dm = smoothed_plus_dm - (smoothed_plus_dm / period) + plus_dm_list[i]
        smoothed_minus_dm = smoothed_minus_dm - (smoothed_minus_dm / period) + minus_dm_list[i]

        p_di, m_di = get_di(smoothed_plus_dm, smoothed_minus_dm, smoothed_tr)
        sum_di = p_di + m_di
        dx = (abs(p_di - m_di) / sum_di * 100.0) if sum_di > 1e-8 else 0.0
        dx_list.append(dx)

    if len(dx_list) < period:
        return {"adx": round(dx_list[-1], 2), "plus_di": round(p_di, 2), "minus_di": round(m_di, 2)}

    # Wilder smooth of DX to obtain ADX
    adx = sum(dx_list[:period]) / period
    for dx_val in dx_list[period:]:
        adx = (adx * (period - 1) + dx_val) / period

    return {
        "adx": round(adx, 2),
        "plus_di": round(p_di, 2),
        "minus_di": round(m_di, 2),
    }


def compute_beta(stock_closes: List[float], benchmark_closes: List[float]) -> Optional[float]:
    """
    Compute 1Y Beta against benchmark (Nifty 50) using daily returns.
    Beta = Cov(R_stock, R_bench) / Var(R_bench).
    """
    if len(stock_closes) < 30 or len(benchmark_closes) < 30:
        return None

    min_len = min(len(stock_closes), len(benchmark_closes), 252)
    s_closes = stock_closes[-min_len:]
    b_closes = benchmark_closes[-min_len:]

    r_stock = [
        (s_closes[i] - s_closes[i - 1]) / s_closes[i - 1]
        for i in range(1, len(s_closes))
        if s_closes[i - 1] > 0
    ]
    r_bench = [
        (b_closes[i] - b_closes[i - 1]) / b_closes[i - 1]
        for i in range(1, len(b_closes))
        if b_closes[i - 1] > 0
    ]

    n = min(len(r_stock), len(r_bench))
    if n < 20:
        return None

    r_s = r_stock[-n:]
    r_b = r_bench[-n:]

    mean_s = sum(r_s) / n
    mean_b = sum(r_b) / n

    cov = sum((r_s[i] - mean_s) * (r_b[i] - mean_b) for i in range(n)) / (n - 1)
    var_b = sum((r_b[i] - mean_b) ** 2 for i in range(n)) / (n - 1)

    if var_b <= 1e-10:
        return 1.0

    return round(cov / var_b, 3)


def is_delivery_rising(delivery_vols: List[float], period: int = 5) -> bool:
    """Return True if delivery volume over the last 5 days shows an upward trend."""
    if not delivery_vols or len(delivery_vols) < period:
        return False
    recent = delivery_vols[-period:]
    # Check if recent average exceeds prior average or slope is positive
    if len(delivery_vols) >= period * 2:
        prior = delivery_vols[-2 * period : -period]
        prior_avg = sum(prior) / len(prior)
        recent_avg = sum(recent) / len(recent)
        return recent_avg > prior_avg * 1.15
    return recent[-1] > recent[0]
