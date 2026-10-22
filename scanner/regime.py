"""
Global macro and market regime analytics for VolEdge India.
Tracks:
- India VIX + 5D change
- VIX / VIX3M ratio
- DXY 20D %
- US 10Y 20D bps
- USD/INR 20D %
- Brent Crude
- FII Cash + Index Futures 5D net
- GIFT Nifty gap %
- F&O Breadth (% above 50DMA)
- Nifty Gamma Exposure (GEX sign and Zero-Gamma level)

Calculates Position Multiplier:
- 0.0 if India VIX > 25.0 or VIX/VIX3M > 1.05
- 0.5 if 3+ indicators are risk_off
- 1.0 otherwise (risk_on / neutral)
"""

from typing import Dict, Any, List, Tuple


def evaluate_indicator_state(name: str, value: float, change: float) -> str:
    """Classify indicator into risk_on, neutral, or risk_off."""
    if name == "india_vix":
        if value > 20.0 or change > 3.0:
            return "risk_off"
        elif value < 15.0 and change <= 0.0:
            return "risk_on"
        return "neutral"

    if name == "vix_vix3m":
        if value > 1.02:
            return "risk_off"
        elif value < 0.92:
            return "risk_on"
        return "neutral"

    if name == "dxy_20d":
        # Dollar strengthening is risk_off for EM equities
        if change > 2.0:
            return "risk_off"
        elif change < -1.0:
            return "risk_on"
        return "neutral"

    if name == "us10y_20d_bps":
        if change > 25.0:
            return "risk_off"
        elif change < -10.0:
            return "risk_on"
        return "neutral"

    if name == "usdinr_20d":
        # Rupee depreciation is risk_off
        if change > 1.5:
            return "risk_off"
        elif change < -0.5:
            return "risk_on"
        return "neutral"

    if name == "brent_crude":
        if value > 90.0 or change > 8.0:
            return "risk_off"
        elif value < 75.0:
            return "risk_on"
        return "neutral"

    if name == "fii_flow_5d":
        # FII net buying in crores
        if value < -10000.0:
            return "risk_off"
        elif value > 5000.0:
            return "risk_on"
        return "neutral"

    if name == "gift_nifty_gap":
        if value < -1.0:
            return "risk_off"
        elif value > 0.3:
            return "risk_on"
        return "neutral"

    if name == "fno_breadth":
        # % of F&O universe above 50DMA
        if value < 40.0:
            return "risk_off"
        elif value > 60.0:
            return "risk_on"
        return "neutral"

    if name == "nifty_gex":
        # Negative GEX promotes volatility acceleration
        if change < 0.0:
            return "risk_off"
        return "risk_on"

    return "neutral"


def compute_regime_multiplier(regime_data: Dict[str, Any]) -> Tuple[float, str, List[str]]:
    """
    Compute global regime multiplier (0.0, 0.5, 1.0).
    Rule:
    - Multiplier 0.0 if India VIX > 25.0 or VIX/VIX3M > 1.05 (Circuit / Severe Stress)
    - Multiplier 0.5 if 3 or more indicators are in 'risk_off' state
    - Multiplier 1.0 otherwise (risk_on / normal)
    """
    vix = regime_data.get("india_vix", {}).get("value", 15.0)
    vix_ratio = regime_data.get("vix_vix3m", {}).get("value", 0.90)

    risk_off_triggers: List[str] = []

    # Hard shutdown conditions
    if vix > 25.0:
        return 0.0, "risk_off", [f"India VIX ({vix:.1f}) exceeds extreme risk threshold (25.0)"]
    if vix_ratio > 1.05:
        return 0.0, "risk_off", [f"VIX/VIX3M ratio ({vix_ratio:.2f}) indicates backwardation shock (> 1.05)"]

    for key, item in regime_data.items():
        if isinstance(item, dict) and item.get("state") == "risk_off":
            desc = item.get("label", key)
            risk_off_triggers.append(f"{desc} is in risk-off state")

    if len(risk_off_triggers) >= 3:
        return 0.5, "cautious", risk_off_triggers

    return 1.0, "risk_on", []
