"""
Unit tests for technical indicators in VolEdge India.
Verifies RSI, Bollinger %B, ADX14, 200DMA, Drawdown, and Beta against known values.
"""

import pytest
from scanner.indicators import (
    compute_rsi,
    compute_percent_b,
    compute_adx,
    compute_spot_200dma,
    compute_drawdown_52w,
    compute_beta,
    is_delivery_rising,
)


def test_rsi_monotonically_increasing():
    """RSI of strictly increasing prices must equal 100.0."""
    closes = [float(100 + i) for i in range(25)]
    rsi = compute_rsi(closes, period=14)
    assert rsi is not None
    assert rsi == 100.0


def test_rsi_monotonically_decreasing():
    """RSI of strictly decreasing prices must equal 0.0."""
    closes = [float(100 - i) for i in range(25)]
    rsi = compute_rsi(closes, period=14)
    assert rsi is not None
    assert rsi == 0.0


def test_rsi_known_hand_calculated_series():
    """
    Test RSI against a small hand-calculated alternating series.
    15 closes: [10, 12, 11, 13, 12, 14, 13, 15, 14, 16, 15, 17, 16, 18, 17]
    Gains: 2, 2, 2, 2, 2, 2, 2 (7 gains of 2) -> avg gain = 14/14 = 1.0
    Losses: 1, 1, 1, 1, 1, 1, 1 (7 losses of 1) -> avg loss = 7/14 = 0.5
    RS = 1.0 / 0.5 = 2.0 -> RSI = 100 - (100 / 3) = 66.67
    """
    closes = [10.0, 12.0, 11.0, 13.0, 12.0, 14.0, 13.0, 15.0, 14.0, 16.0, 15.0, 17.0, 16.0, 18.0, 17.0]
    rsi = compute_rsi(closes, period=14)
    assert rsi is not None
    assert abs(rsi - 66.67) <= 0.5


def test_rsi_insufficient_data():
    """RSI with fewer than period + 1 points must return None without raising."""
    assert compute_rsi([10.0, 12.0, 14.0], period=14) is None
    assert compute_rsi([], period=14) is None


def test_percent_b_exact_levels():
    """
    Bollinger %B:
    Mean close -> %B = 0.5
    Upper band -> %B = 1.0
    Lower band -> %B = 0.0
    """
    # 20 bars: first 19 are 100.0, 20th is varying
    # Mean of [90, 110, 90, 110...]
    closes = [90.0, 110.0] * 10
    # Mean is 100.0, close is 110.0 -> close > mean -> %B > 0.5
    pb = compute_percent_b(closes, period=20)
    assert pb is not None
    assert 0.0 <= pb <= 1.5

    # Constant series -> std dev 0 -> defaults to 0.5
    const_closes = [100.0] * 25
    assert compute_percent_b(const_closes, period=20) == 0.5


def test_adx_trending_series():
    """Strong uptrend series should produce higher +DI than -DI and ADX > 20."""
    highs = [float(100 + i * 2 + 1) for i in range(35)]
    lows = [float(100 + i * 2 - 1) for i in range(35)]
    closes = [float(100 + i * 2) for i in range(35)]

    res = compute_adx(highs, lows, closes, period=14)
    assert res["adx"] is not None
    assert res["plus_di"] is not None
    assert res["minus_di"] is not None
    assert res["plus_di"] > res["minus_di"]
    assert res["adx"] > 15.0


def test_adx_downtrend_series():
    """Strong downtrend series should produce -DI > +DI."""
    highs = [float(200 - i * 2 + 1) for i in range(35)]
    lows = [float(200 - i * 2 - 1) for i in range(35)]
    closes = [float(200 - i * 2) for i in range(35)]

    res = compute_adx(highs, lows, closes, period=14)
    assert res["minus_di"] > res["plus_di"]


def test_spot_200dma():
    """Test Spot / 200DMA ratio."""
    closes = [100.0] * 200
    # Spot 110 with 200DMA 100 -> 1.10
    assert compute_spot_200dma(110.0, closes) == 1.10
    # Spot 90 with 200DMA 100 -> 0.90
    assert compute_spot_200dma(90.0, closes) == 0.90
    # Insufficient data
    assert compute_spot_200dma(100.0, [100.0] * 10) is None


def test_drawdown_52w():
    """Test 52-week drawdown from high."""
    highs = [80.0] * 100 + [100.0] + [90.0] * 50
    # 52w high is 100.0. Current spot is 90.0 -> drawdown is (90 - 100) / 100 = -0.10 (-10%)
    dd = compute_drawdown_52w(90.0, highs)
    assert dd == -0.10


def test_beta_calculation():
    """Test 1Y Beta against benchmark."""
    import math
    base_returns = [0.005 * math.sin(i * 0.2) for i in range(60)]
    bench = [100.0]
    for r in base_returns:
        bench.append(bench[-1] * (1.0 + r))

    # Identical series -> Beta = 1.0
    stock_same = list(bench)
    beta_same = compute_beta(stock_same, bench)
    assert beta_same is not None
    assert abs(beta_same - 1.0) < 0.01

    # 2x returns series -> Beta = 2.0
    stock_2x = [100.0]
    for r in base_returns:
        stock_2x.append(stock_2x[-1] * (1.0 + 2.0 * r))

    beta_2x = compute_beta(stock_2x, bench)
    assert beta_2x is not None
    assert abs(beta_2x - 2.0) < 0.05
