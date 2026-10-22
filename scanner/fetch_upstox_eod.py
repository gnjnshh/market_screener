"""
Optional secret-based Upstox EOD Data Fetcher for VolEdge India.
Activated only if GitHub Secret UPSTOX_ACCESS_TOKEN is present in the environment.
Fetches daily candles and market quotes via Upstox API v2/v3.
Never prints, logs, or stores access tokens.
"""

import os
import time
from typing import Dict, Any, Optional, List
import requests

UPSTOX_API_BASE = "https://api.upstox.com"


def get_upstox_token() -> Optional[str]:
    """Retrieve token from environment safely without logging it."""
    token = os.environ.get("UPSTOX_ACCESS_TOKEN", "").strip()
    return token if token else None


def fetch_upstox_market_quotes(instrument_keys: List[str], token: str) -> Optional[Dict[str, Any]]:
    """
    Fetch market quotes in batches from Upstox API v2.
    Respects rate limits with exponential backoff on 429/5xx.
    """
    if not token or not instrument_keys:
        return None

    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {token}",
    }

    results: Dict[str, Any] = {}
    batch_size = 50

    for i in range(0, len(instrument_keys), batch_size):
        batch = instrument_keys[i : i + batch_size]
        url = f"{UPSTOX_API_BASE}/v2/market-quote/quotes"
        params = {"instrument_key": ",".join(batch)}

        max_retries = 3
        backoff = 1.0

        for attempt in range(max_retries):
            try:
                resp = requests.get(url, headers=headers, params=params, timeout=10)
                if resp.status_code == 200:
                    data = resp.json().get("data", {})
                    results.update(data)
                    break
                elif resp.status_code in (429, 500, 502, 503, 504):
                    time.sleep(backoff)
                    backoff *= 2.0
                else:
                    break
            except Exception:
                time.sleep(backoff)
                backoff *= 2.0

        # Small courteous delay between batches
        time.sleep(0.2)

    return results


def fetch_upstox_historical_eod(
    instrument_key: str,
    from_date: str,
    to_date: str,
    token: str
) -> Optional[List[Dict[str, Any]]]:
    """
    Fetch historical daily candles for an instrument from Upstox.
    Endpoint: /v2/historical-candle/{instrumentKey}/day/{toDate}/{fromDate}
    """
    if not token or not instrument_key:
        return None

    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {token}",
    }

    url = f"{UPSTOX_API_BASE}/v2/historical-candle/{instrument_key}/day/{to_date}/{from_date}"

    try:
        resp = requests.get(url, headers=headers, timeout=10)
        if resp.status_code == 200:
            candles = resp.json().get("data", {}).get("candles", [])
            # Candles format: [timestamp, open, high, low, close, volume, open_interest]
            # Upstox returns newest candle first; reverse for chronological order
            candles.reverse()
            return candles
    except Exception:
        pass

    return None
