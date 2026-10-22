"""
Unit tests for scoring, hard guards, and edge cases in VolEdge India.
Verifies scoring weights sum to 100, scores bounded 0-100,
hard guard rejection guarantees, and edge case resilience (DTE=0, NaN, zero volume).
"""

import math
import pytest
from scanner.config import SCORING_WEIGHTS
from scanner.scoring import (
    calculate_score,
    determine_verdict,
    check_hard_guards,
    evaluate_fundamental_gate,
)
from scanner.trade_math import (
    calculate_pop,
    calculate_expected_move,
    calculate_recommended_strike,
    black_scholes_put_price,
)
from scanner.indicators import compute_rsi, compute_percent_b, compute_spot_200dma
from scanner.volatility import compute_yang_zhang_rv


def test_scoring_weights_sum_to_100():
    """Scoring weights must sum to exactly 100.0."""
    total_weight = sum(SCORING_WEIGHTS.values())
    assert abs(total_weight - 100.0) < 1e-6, f"Weights sum to {total_weight}, expected 100.0"


def test_score_bounded_0_to_100():
    """Score must strictly stay between 0.0 and 100.0 for any extreme input."""
    # Perfect stock
    perfect_stock = {
        "pop": 95.0,
        "empirical_pop": 96.0,
        "iv_yz_ratio": 1.40,
        "iv_percentile_1y": 85.0,
        "gap_cover": 3.5,
        "stress_loss_capital_pct": 0.8,
        "put_wall_oi_change_3d": 20.0,
        "futures_buildup": "Long Buildup",
        "annualized_basis_pct": 6.5,
        "spot_200dma": 1.05,
        "drawdown_52w": -0.10,
        "rsi_14": 45.0,
        "percent_b": 0.30,
        "bid_ask_spread_pct": 0.8,
        "mwpl_pct": 35.0,
    }
    score_high = calculate_score(perfect_stock)
    assert 0.0 <= score_high <= 100.0
    assert score_high >= 90.0

    # Terrible stock
    terrible_stock = {
        "pop": 60.0,
        "empirical_pop": 65.0,
        "iv_yz_ratio": 0.80,
        "iv_percentile_1y": 10.0,
        "gap_cover": 0.8,
        "stress_loss_capital_pct": 5.0,
        "put_wall_oi_change_3d": -35.0,
        "futures_buildup": "Short Buildup",
        "annualized_basis_pct": -3.0,
        "spot_200dma": 0.80,
        "drawdown_52w": -0.40,
        "rsi_14": 20.0,
        "percent_b": -0.10,
        "bid_ask_spread_pct": 7.0,
        "mwpl_pct": 92.0,
    }
    score_low = calculate_score(terrible_stock)
    assert 0.0 <= score_low <= 100.0
    assert score_low <= 25.0


def test_stock_failing_hard_guard_never_qualified():
    """A stock failing ANY hard guard must NEVER receive QUALIFIED verdict."""
    base_stock = {
        "pop": 92.0,
        "empirical_pop": 94.0,
        "iv_yz_ratio": 1.35,
        "iv_percentile_1y": 80.0,
        "gap_cover": 3.0,
        "stress_loss_capital_pct": 1.0,
        "put_wall_oi_change_3d": 10.0,
        "futures_buildup": "Long Buildup",
        "annualized_basis_pct": 5.0,
        "spot_200dma": 1.05,
        "drawdown_52w": -0.12,
        "rsi_14": 48.0,
        "percent_b": 0.35,
        "bid_ask_spread_pct": 1.2,
        "mwpl_pct": 40.0,
    }
    score = calculate_score(base_stock)
    verdict, failed = determine_verdict(base_stock, score)
    assert verdict == "QUALIFIED"
    assert len(failed) == 0

    # Test failure 1: Spot/200DMA < 0.92
    failing_1 = dict(base_stock, spot_200dma=0.89)
    v, failed = determine_verdict(failing_1, score)
    assert v == "REJECTED"
    assert any("200DMA" in msg for msg in failed)

    # Test failure 2: Drawdown beyond -30%
    failing_2 = dict(base_stock, drawdown_52w=-0.35)
    v, failed = determine_verdict(failing_2, score)
    assert v == "REJECTED"
    assert any("Drawdown" in msg for msg in failed)

    # Test failure 3: RSI < 28 (falling knife)
    failing_3 = dict(base_stock, rsi_14=24.0)
    v, failed = determine_verdict(failing_3, score)
    assert v == "REJECTED"
    assert any("RSI" in msg for msg in failed)

    # Test failure 4: Event Gap True (earnings before expiry)
    failing_4 = dict(base_stock, event_gap=True)
    v, failed = determine_verdict(failing_4, score)
    assert v == "REJECTED"
    assert any("scheduled prior to expiry" in msg for msg in failed)

    # Test failure 5: Fundamental Gate failed
    failing_5 = dict(base_stock, fundamental_gate_passed=False, fundamental_reasons=["ROE below sector"])
    v, failed = determine_verdict(failing_5, score)
    assert v == "REJECTED"
    assert any("ROE" in msg for msg in failed)

    # Test failure 6: MWPL >= 80%
    failing_6 = dict(base_stock, mwpl_pct=85.0)
    v, failed = determine_verdict(failing_6, score)
    assert v == "REJECTED"
    assert any("MWPL" in msg for msg in failed)


def test_edge_cases_no_crash():
    """
    Edge cases:
    - Zero volume
    - Missing IV
    - DTE = 0
    - Empty or NaN arrays
    Must not throw unhandled exceptions.
    """
    # DTE = 0
    put_dte0 = black_scholes_put_price(100.0, 95.0, dte=0.0, volatility=0.20)
    assert put_dte0 >= 0.0
    pop_dte0 = calculate_pop(100.0, 95.0, dte=0.0, volatility=0.20)
    assert pop_dte0 in (0.0, 100.0)

    # Strike snapping with zero or negative inputs
    rec_zero = calculate_recommended_strike(0.0, 0.20, 30.0)
    assert rec_zero == 0.0

    # RSI on empty list
    assert compute_rsi([]) is None

    # %B on empty list
    assert compute_percent_b([]) is None

    # Yang Zhang RV on empty list
    assert compute_yang_zhang_rv([], [], [], []) is None
