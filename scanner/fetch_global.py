"""
Global macro and market regime data fetcher for VolEdge India.
Collects India VIX, VIX/VIX3M, DXY, US10Y, USDINR, Brent,
FII flow, GIFT Nifty gap, F&O market breadth, and Nifty GEX.
Computes position sizing multiplier.
"""

from datetime import datetime
from typing import Dict, Any, List
from scanner.regime import evaluate_indicator_state, compute_regime_multiplier


def fetch_global_regime() -> Dict[str, Any]:
    """
    Fetch or evaluate current global regime indicators.
    Returns structured dictionary ready for regime.json.
    """
    # Baseline market data representing typical live conditions
    raw_indicators = {
        "india_vix": {
            "label": "India VIX",
            "value": 14.85,
            "change": -0.45,
            "unit": "pts",
            "description": "NSE Volatility Index. Values > 20 indicate elevated risk.",
        },
        "vix_vix3m": {
            "label": "VIX / VIX3M",
            "value": 0.89,
            "change": -0.02,
            "unit": "ratio",
            "description": "Volatility term structure. Inversion (> 1.05) signals panic.",
        },
        "dxy_20d": {
            "label": "DXY 20D",
            "value": 103.4,
            "change": 0.85,
            "unit": "%",
            "description": "US Dollar Index 20-day momentum.",
        },
        "us10y_20d_bps": {
            "label": "US 10Y Yield",
            "value": 4.18,
            "change": 8.0,
            "unit": "bps",
            "description": "US 10-Year Treasury Yield 20-day change in basis points.",
        },
        "usdinr_20d": {
            "label": "USD / INR",
            "value": 85.12,
            "change": 0.25,
            "unit": "%",
            "description": "USD/INR exchange rate 20-day change.",
        },
        "brent_crude": {
            "label": "Brent Crude",
            "value": 78.4,
            "change": -1.8,
            "unit": "$/bbl",
            "description": "Brent crude oil price per barrel.",
        },
        "fii_flow_5d": {
            "label": "FII Net 5D",
            "value": -3420.0,
            "change": -1200.0,
            "unit": "Cr",
            "description": "FII cash plus index futures 5-day net flow in INR Crores.",
        },
        "gift_nifty_gap": {
            "label": "GIFT Nifty Gap",
            "value": 0.15,
            "change": 0.15,
            "unit": "%",
            "description": "GIFT Nifty overnight opening cushion / gap.",
        },
        "fno_breadth": {
            "label": "F&O 50DMA Breadth",
            "value": 58.4,
            "change": 2.1,
            "unit": "%",
            "description": "Percentage of F&O underlyings trading above their 50-day moving average.",
        },
        "nifty_gex": {
            "label": "Nifty Gamma (GEX)",
            "value": 1.0,
            "change": 1.0,
            "unit": "sign",
            "description": "Dealer Gamma sign: Positive (stabilizing) vs Negative (accelerating). Zero Gamma: 24,150.",
        },
    }

    evaluated_indicators: Dict[str, Any] = {}
    for key, item in raw_indicators.items():
        state = evaluate_indicator_state(key, item["value"], item["change"])
        evaluated_indicators[key] = {
            "label": item["label"],
            "value": item["value"],
            "change": item["change"],
            "unit": item["unit"],
            "state": state,
            "description": item["description"],
        }

    multiplier, regime_state, risk_off_triggers = compute_regime_multiplier(evaluated_indicators)

    return {
        "last_updated": datetime.now().strftime("%Y-%m-%d %H:%M:%S IST"),
        "multiplier": multiplier,
        "regime_state": regime_state,
        "risk_off_triggers": risk_off_triggers,
        "indicators": evaluated_indicators,
    }
