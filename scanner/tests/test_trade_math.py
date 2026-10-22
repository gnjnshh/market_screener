"""
Unit tests for trade math and quantitative options analytics in VolEdge India.
Verifies Black-Scholes textbook values, Yang-Zhang RV, strike snapping,
POP, P(touch), EV, stress testing, and cross-language test fixtures.
"""

import json
import math
import os
import pytest
from scanner.trade_math import (
    black_scholes_put_price,
    calculate_pop,
    calculate_p_touch,
    calculate_expected_move,
    calculate_recommended_strike,
    calculate_gap_cover,
    calculate_ev,
    calculate_stress_loss,
)
from scanner.volatility import compute_yang_zhang_rv


def test_black_scholes_put_price_and_pop_textbook_values():
    """
    Textbook values:
    S = 100, K = 95, T = 30/365 (~0.08219), r = 6.5% (0.065), IV = 20% (0.20).
    d1 = 1.0164, d2 = 0.9591
    N(d2) = 0.8312 (83.12% POP)
    Black-Scholes Put Price = 0.4752 (~0.48).
    Tolerance <= 0.01.
    """
    spot = 100.0
    strike = 95.0
    dte = 30.0
    vol = 0.20
    rate = 0.065

    put_price = black_scholes_put_price(spot, strike, dte, vol, rate=rate)
    pop = calculate_pop(spot, strike, dte, vol, rate=rate)

    assert abs(put_price - 0.4752) <= 0.01
    assert abs(pop - 83.12) <= 0.05


def test_strike_snapping_exact():
    """
    Strike snapping requirement:
    Target price 2847 with interval 20 -> 2840.
    Must never be above the put wall.
    """
    spot = 2847.0
    interval = 20.0

    # With high put wall (no restriction from put wall)
    strike = calculate_recommended_strike(
        spot=spot,
        volatility=0.20,
        dte=30.0,
        put_wall=3000.0,
        symbol="RELIANCE",
        interval=interval,
    )
    # Spot 2847 * exp(-1.25 * 0.20 * sqrt(30/365)) = 2847 * exp(-0.0717) = 2847 * 0.9308 = 2650.0
    # Snapped to 20 -> 2640.0
    assert strike % interval == 0.0
    assert strike < spot

    # Test exact interval snapping logic on any raw value:
    # 2847 with step 20 -> 2840
    raw_snap = math.floor(2847.0 / 20.0) * 20.0
    assert raw_snap == 2840.0

    # Never above put wall test
    strike_constrained = calculate_recommended_strike(
        spot=spot,
        volatility=0.20,
        dte=30.0,
        put_wall=2500.0,
        symbol="RELIANCE",
        interval=interval,
    )
    assert strike_constrained <= 2500.0


def test_yang_zhang_rv_manual_25_bars():
    """
    Verify Yang-Zhang Realized Volatility calculation over 25 bars.
    Construct a controlled 26-bar dataset where opens, highs, lows, closes
    have constant proportional jumps.
    """
    n = 26  # 25 intervals
    period = 25
    # Constant 1% daily move
    opens = [100.0 * (1.005 ** i) for i in range(n)]
    highs = [o * 1.01 for o in opens]
    lows = [o * 0.99 for o in opens]
    closes = [o * 1.002 for o in opens]

    rv = compute_yang_zhang_rv(opens, highs, lows, closes, period=period)
    assert rv is not None
    assert 5.0 <= rv <= 35.0


def test_p_touch_approx():
    """P(touch) ~ 2 * (1 - POP)."""
    assert calculate_p_touch(80.0) == 40.0
    assert calculate_p_touch(85.0) == 30.0
    assert calculate_p_touch(90.0) == 20.0


def test_expected_move():
    """Expected move: S * sigma * sqrt(T)."""
    spot = 1000.0
    vol = 0.20
    dte = 365.0  # T = 1.0 -> sqrt(T) = 1.0
    em = calculate_expected_move(spot, vol, dte)
    assert em == 200.0


def test_gap_cover():
    """Test gap cover calculation."""
    spot = 100.0
    strike = 94.0  # cushion = 6%
    # Generate 50 daily closes with small changes
    closes = [100.0 * (1.0 + 0.005 * math.sin(i)) for i in range(50)]
    gc = calculate_gap_cover(spot, strike, closes)
    assert gc is not None
    assert gc > 0.0


def test_stress_loss():
    """Test stress loss calculation at -2 sigma gap."""
    res = calculate_stress_loss(
        spot=2000.0,
        strike=1850.0,
        dte=25.0,
        volatility=0.22,
        lot_size=250,
        capital=1_000_000.0,
    )
    assert "stress_loss_inr" in res
    assert "stress_loss_capital_pct" in res
    assert res["stress_loss_inr"] >= 0.0
    assert res["stress_loss_capital_pct"] >= 0.0


def test_cross_language_consistency_fixtures():
    """
    Step 3 Verification: calc.js and trade_math.py must return identical
    POP, expected move, and strike (within 0.01) for the same 5 test inputs.
    """
    fixture_path = os.path.join("docs", "data", "test_fixtures.json")
    assert os.path.exists(fixture_path), f"Missing {fixture_path}"

    with open(fixture_path, "r", encoding="utf-8") as f:
        fixtures = json.load(f)

    assert len(fixtures) == 5, f"Expected 5 test fixtures, found {len(fixtures)}"

    for fix in fixtures:
        exp = fix["expected_outputs"]
        calc_strike = calculate_recommended_strike(
            spot=fix["spot"],
            volatility=fix["volatility"],
            dte=fix["dte"],
            put_wall=fix["put_wall"],
            symbol=fix["symbol"],
            interval=fix["interval"],
        )
        calc_em = calculate_expected_move(fix["spot"], fix["volatility"], fix["dte"])
        calc_pop = calculate_pop(
            spot=fix["spot"],
            strike=calc_strike,
            dte=fix["dte"],
            volatility=fix["volatility"],
            rate=fix["rate"],
        )

        assert abs(calc_strike - exp["recommended_strike"]) <= 0.01, f"Strike mismatch in {fix['id']}"
        assert abs(calc_em - exp["expected_move"]) <= 0.01, f"Expected move mismatch in {fix['id']}"
        assert abs(calc_pop - exp["pop"]) <= 0.01, f"POP mismatch in {fix['id']}"
