"""
Configuration parameters, thresholds, and mappings for VolEdge India.
Provides scoring weights, guard thresholds, sector classifications,
and listed NSE strike intervals.
"""

from typing import Dict, Any, List

# Risk-free interest rate (annualized, 91D T-Bill / RBI benchmark)
RISK_FREE_RATE: float = 0.065

# Default capital for stress testing and sizing (in INR)
DEFAULT_CAPITAL: float = 1_000_000.0

# Scoring weights (must sum to 100)
# Mirrored in js/calc.js
SCORING_WEIGHTS: Dict[str, float] = {
    "empirical_rn_pop": 25.0,
    "vrp_iv_pct": 20.0,
    "gap_cover_stress": 15.0,
    "put_wall_buildup": 15.0,
    "structure": 15.0,
    "liquidity": 10.0,
}

# Score qualification thresholds
SCORE_THRESHOLDS = {
    "qualified": 72.0,
    "watch": 60.0,
}

# Guard and metric thresholds
THRESHOLDS: Dict[str, Any] = {
    # Structure
    "spot_200dma": {
        "ideal_min": 0.95,
        "ideal_max": 1.15,
        "reject_min": 0.92,
        "reject_max": 1.30,
    },
    "drawdown_52w": {
        "ideal_min": -0.20,
        "ideal_max": -0.05,
        "reject_min": -0.30,
    },
    "rsi_14": {
        "ideal_min": 35.0,
        "ideal_max": 55.0,
        "reject_min": 28.0,
        "reject_max": 65.0,
    },
    "percent_b": {
        "ideal_min": 0.10,
        "ideal_max": 0.50,
    },
    "adx_14": {
        "reject_threshold": 30.0,
    },
    "downvol_ratio_20d": {
        "ideal_max": 1.0,
        "reject_max": 1.3,
    },
    # Volatility
    "iv_percentile_1y": {
        "ideal_min": 50.0,
        "reject_min": 30.0,
    },
    "iv_yz_ratio": {
        "ideal_min": 1.15,
        "reject_min": 1.0,
    },
    "hv10_yz20": {
        "ideal_max": 1.0,
        "reject_max": 1.2,
    },
    "skew_25d_pct": {
        "ideal_min": 40.0,
        "ideal_max": 80.0,
        "reject_max": 90.0,
    },
    "term_structure": {
        "ideal_min": 0.85,
        "ideal_max": 1.0,
        "reject_max": 1.10,
    },
    # Positioning
    "put_wall_oi_change_3d": {
        "reject_min": -20.0,
    },
    "bid_ask_spread_pct": {
        "ideal_max": 3.0,
        "reject_max": 5.0,
    },
    "mwpl_pct": {
        "ideal_max": 60.0,
        "reject_max": 80.0,
    },
    # Trade Math
    "pop": {
        "ideal_min": 80.0,
        "reject_min": 75.0,
    },
    "p_touch": {
        "ideal_max": 40.0,
    },
    "empirical_pop": {
        "ideal_min": 85.0,
        "reject_min": 78.0,
    },
    "gap_cover": {
        "ideal_min": 2.0,
        "reject_min": 1.5,
    },
    "rom": {
        "ideal_min": 1.5,
        "ideal_max": 4.0,
    },
    "stress_loss_capital_pct": {
        "ideal_max": 2.0,
        "reject_max": 3.0,
    },
}

# Listed strike intervals for major liquid NSE F&O underlyings
KNOWN_STRIKE_INTERVALS: Dict[str, float] = {
    "NIFTY": 50.0,
    "BANKNIFTY": 100.0,
    "FINNIFTY": 50.0,
    "MIDCPNIFTY": 25.0,
    "RELIANCE": 20.0,
    "TCS": 50.0,
    "INFY": 20.0,
    "HDFCBANK": 10.0,
    "ICICIBANK": 10.0,
    "SBIN": 5.0,
    "BHARTIARTL": 10.0,
    "ITC": 5.0,
    "KOTAKBANK": 20.0,
    "LT": 50.0,
    "HINDUNILVR": 20.0,
    "AXISBANK": 10.0,
    "BAJFINANCE": 50.0,
    "MARUTI": 100.0,
    "ASIANPAINT": 20.0,
    "TATAMOTORS": 10.0,
    "SUNPHARMA": 10.0,
    "TITAN": 20.0,
    "WIPRO": 5.0,
    "HCLTECH": 20.0,
    "NTPC": 2.5,
    "POWERGRID": 2.5,
    "ONGC": 2.5,
    "COALINDIA": 2.5,
    "TATASTEEL": 2.5,
    "JSWSTEEL": 10.0,
    "HINDALCO": 10.0,
    "ADANIENT": 50.0,
    "ADANIPORTS": 10.0,
    "BAJAJFINSV": 20.0,
    "ULTRACEMCO": 100.0,
    "GRASIM": 20.0,
    "CIPLA": 10.0,
    "DRREDDY": 50.0,
    "DIVISLAB": 50.0,
    "APOLLOHOSP": 50.0,
    "EICHERMOT": 50.0,
    "BPCL": 5.0,
    "HEROMOTOCO": 50.0,
    "BRITANNIA": 50.0,
    "NESTLEIND": 20.0,
    "TECHM": 20.0,
    "INDUSINDBK": 10.0,
    "M&M": 20.0,
    "SHRIRAMFIN": 20.0,
    "CHOLAFIN": 10.0,
}

# Default strike step resolution function by price level
def get_strike_interval(symbol: str, spot: float) -> float:
    """Return the NSE strike interval for a symbol or price."""
    sym = symbol.upper()
    if sym in KNOWN_STRIKE_INTERVALS:
        return KNOWN_STRIKE_INTERVALS[sym]
    if spot < 150:
        return 2.5
    elif spot < 350:
        return 5.0
    elif spot < 750:
        return 10.0
    elif spot < 1500:
        return 20.0
    elif spot < 4000:
        return 50.0
    else:
        return 100.0


# Sector classification mapping for F&O universe
STOCK_SECTOR_MAP: Dict[str, str] = {
    "RELIANCE": "Energy",
    "TCS": "IT",
    "INFY": "IT",
    "HDFCBANK": "Banking",
    "ICICIBANK": "Banking",
    "SBIN": "Banking",
    "BHARTIARTL": "Telecom",
    "ITC": "FMCG",
    "KOTAKBANK": "Banking",
    "LT": "Infrastructure",
    "HINDUNILVR": "FMCG",
    "AXISBANK": "Banking",
    "BAJFINANCE": "Financial Services",
    "MARUTI": "Auto",
    "ASIANPAINT": "Consumer",
    "TATAMOTORS": "Auto",
    "SUNPHARMA": "Pharma",
    "TITAN": "Consumer",
    "WIPRO": "IT",
    "HCLTECH": "IT",
    "NTPC": "Power",
    "POWERGRID": "Power",
    "ONGC": "Energy",
    "COALINDIA": "Metals & Mining",
    "TATASTEEL": "Metals & Mining",
    "JSWSTEEL": "Metals & Mining",
    "HINDALCO": "Metals & Mining",
    "ADANIENT": "Metals & Mining",
    "ADANIPORTS": "Infrastructure",
    "BAJAJFINSV": "Financial Services",
    "ULTRACEMCO": "Materials",
    "GRASIM": "Materials",
    "CIPLA": "Pharma",
    "DRREDDY": "Pharma",
    "DIVISLAB": "Pharma",
    "APOLLOHOSP": "Healthcare",
    "EICHERMOT": "Auto",
    "BPCL": "Energy",
    "HEROMOTOCO": "Auto",
    "BRITANNIA": "FMCG",
    "NESTLEIND": "FMCG",
    "TECHM": "IT",
    "INDUSINDBK": "Banking",
    "M&M": "Auto",
    "SHRIRAMFIN": "Financial Services",
    "CHOLAFIN": "Financial Services",
}

# Benchmark Sector ROE Medians for Fundamental Gate
SECTOR_MEDIAN_ROE: Dict[str, float] = {
    "Banking": 14.5,
    "Financial Services": 16.0,
    "IT": 24.0,
    "Energy": 13.0,
    "FMCG": 22.0,
    "Auto": 17.5,
    "Pharma": 15.0,
    "Healthcare": 14.0,
    "Metals & Mining": 12.0,
    "Infrastructure": 11.5,
    "Consumer": 18.0,
    "Power": 12.0,
    "Materials": 11.0,
    "Telecom": 8.0,
    "Default": 12.0,
}

# Standard universe list for scanning
CORE_SYMBOLS: List[str] = [
    "RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK",
    "SBIN", "BHARTIARTL", "ITC", "KOTAKBANK", "LT",
    "HINDUNILVR", "AXISBANK", "BAJFINANCE", "MARUTI", "ASIANPAINT",
    "TATAMOTORS", "SUNPHARMA", "TITAN", "WIPRO", "HCLTECH",
    "NTPC", "POWERGRID", "ONGC", "COALINDIA", "TATASTEEL",
    "JSWSTEEL", "HINDALCO", "ADANIENT", "ADANIPORTS", "BAJAJFINSV",
    "ULTRACEMCO", "GRASIM", "CIPLA", "DRREDDY", "DIVISLAB",
    "APOLLOHOSP", "EICHERMOT", "BPCL", "HEROMOTOCO", "BRITANNIA",
    "TECHM", "INDUSINDBK", "M&M", "SHRIRAMFIN", "CHOLAFIN"
]

# Upstox NSE_EQ Instrument Keys for Core Symbols
UPSTOX_INSTRUMENT_KEYS: Dict[str, str] = {
    "RELIANCE": "NSE_EQ|INE002A01018",
    "TCS": "NSE_EQ|INE467B01029",
    "INFY": "NSE_EQ|INE009A01021",
    "HDFCBANK": "NSE_EQ|INE040A01034",
    "ICICIBANK": "NSE_EQ|INE090A01021",
    "SBIN": "NSE_EQ|INE062A01020",
    "BHARTIARTL": "NSE_EQ|INE397D01024",
    "ITC": "NSE_EQ|INE154A01025",
    "KOTAKBANK": "NSE_EQ|INE237A01036",
    "LT": "NSE_EQ|INE018A01030",
    "HINDUNILVR": "NSE_EQ|INE030A01027",
    "AXISBANK": "NSE_EQ|INE238A01034",
    "BAJFINANCE": "NSE_EQ|INE296A01032",
    "MARUTI": "NSE_EQ|INE585B01010",
    "ASIANPAINT": "NSE_EQ|INE021A01026",
    "TATAMOTORS": "NSE_EQ|INE155A01022",
    "SUNPHARMA": "NSE_EQ|INE044A01036",
    "TITAN": "NSE_EQ|INE280A01028",
    "WIPRO": "NSE_EQ|INE075A01022",
    "HCLTECH": "NSE_EQ|INE860A01027",
    "NTPC": "NSE_EQ|INE733E01010",
    "POWERGRID": "NSE_EQ|INE752E01010",
    "ONGC": "NSE_EQ|INE213A01029",
    "COALINDIA": "NSE_EQ|INE522F01014",
    "TATASTEEL": "NSE_EQ|INE081A01020",
    "JSWSTEEL": "NSE_EQ|INE019A01038",
    "HINDALCO": "NSE_EQ|INE038A01020",
    "ADANIENT": "NSE_EQ|INE423A01024",
    "ADANIPORTS": "NSE_EQ|INE742F01042",
    "BAJAJFINSV": "NSE_EQ|INE918I01026",
    "ULTRACEMCO": "NSE_EQ|INE481G01011",
    "GRASIM": "NSE_EQ|INE047A01021",
    "CIPLA": "NSE_EQ|INE059A01026",
    "DRREDDY": "NSE_EQ|INE089A01031",
    "DIVISLAB": "NSE_EQ|INE361B01024",
    "APOLLOHOSP": "NSE_EQ|INE437A01024",
    "EICHERMOT": "NSE_EQ|INE066A01021",
    "BPCL": "NSE_EQ|INE029A01011",
    "HEROMOTOCO": "NSE_EQ|INE158A01026",
    "BRITANNIA": "NSE_EQ|INE216A01030",
    "NESTLEIND": "NSE_EQ|INE239A01024",
    "TECHM": "NSE_EQ|INE669C01036",
    "INDUSINDBK": "NSE_EQ|INE095A01012",
    "M&M": "NSE_EQ|INE101A01026",
    "SHRIRAMFIN": "NSE_EQ|INE721A01013",
    "CHOLAFIN": "NSE_EQ|INE121A01024",
}

