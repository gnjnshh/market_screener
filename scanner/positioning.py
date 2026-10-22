"""
Positioning and market microstructure analytics for VolEdge India.
Includes Put OI Wall detection, 3D OI change, Bid-Ask spread %,
MWPL %, Futures 5D build-up classification, and Annualized Basis.
"""

from typing import List, Dict, Optional, Any


def find_put_oi_wall(strikes: List[float], put_ois: List[int]) -> Dict[str, Any]:
    """
    Identify the Put Open Interest Wall (the strike with the highest Put OI).
    Returns dict with 'strike' and 'oi'.
    """
    if not strikes or not put_ois or len(strikes) != len(put_ois):
        return {"strike": 0.0, "oi": 0}

    max_oi = -1
    best_strike = 0.0
    for s, oi in zip(strikes, put_ois):
        if oi > max_oi:
            max_oi = oi
            best_strike = s

    return {"strike": best_strike, "oi": max_oi}


def compute_put_wall_oi_change(current_oi: int, prior_oi_3d: int) -> Optional[float]:
    """
    Compute 3-day percentage change in Put Wall Open Interest.
    Returns percentage change (e.g., -25.5 for a 25.5% drop).
    """
    if prior_oi_3d <= 0:
        return 0.0 if current_oi > 0 else None
    pct_change = ((current_oi - prior_oi_3d) / prior_oi_3d) * 100.0
    return round(pct_change, 2)


def compute_bid_ask_spread(bid: float, ask: float) -> Optional[float]:
    """
    Compute percentage bid-ask spread at strike: (ask - bid) / mid * 100.
    """
    if bid < 0 or ask < 0 or ask < bid:
        return None
    mid = (ask + bid) / 2.0
    if mid <= 1e-6:
        return None
    spread_pct = ((ask - bid) / mid) * 100.0
    return round(spread_pct, 2)


def compute_futures_buildup(price_change_5d: float, oi_change_5d: float) -> str:
    """
    Classify 5-day Futures build-up:
    - Long Buildup: Price Up, OI Up
    - Short Buildup: Price Down, OI Up
    - Short Covering: Price Up, OI Down
    - Long Unwinding: Price Down, OI Down
    - Neutral: negligible changes
    """
    p_thresh = 0.25  # 0.25% change
    oi_thresh = 1.0   # 1.0% change

    if abs(price_change_5d) < p_thresh and abs(oi_change_5d) < oi_thresh:
        return "Neutral"

    if price_change_5d >= 0:
        if oi_change_5d >= 0:
            return "Long Buildup"
        else:
            return "Short Covering"
    else:
        if oi_change_5d >= 0:
            return "Short Buildup"
        else:
            return "Long Unwinding"


def compute_annualized_basis(futures_price: float, spot_price: float, dte: int) -> Optional[float]:
    """
    Compute annualized futures basis % = ((Futures - Spot) / Spot) * (365 / DTE) * 100.
    """
    if spot_price <= 0 or futures_price <= 0:
        return None
    effective_dte = max(dte, 1)
    basis_pct = ((futures_price - spot_price) / spot_price) * (365.0 / effective_dte) * 100.0
    return round(basis_pct, 2)
