/**
 * Upstox Developer API client for VolEdge India (Browser ES Module).
 * Supports direct browser requests (CORS enabled) or optional Cloudflare Worker proxy.
 * Features rate limiting, batching, exponential backoff on 429/5xx, and strict security.
 *
 * Security: NEVER logs tokens to console.
 */

const DEFAULT_API_BASE = "https://api.upstox.com";

function getBaseUrl(proxyUrl = "") {
  return proxyUrl ? proxyUrl.trim().replace(/\/+$/, "") : DEFAULT_API_BASE;
}

/**
 * Execute HTTP request with exponential backoff on 429 and 5xx errors.
 */
async function fetchWithBackoff(url, options = {}, maxRetries = 3) {
  let attempt = 0;
  let delay = 1000;

  while (attempt < maxRetries) {
    try {
      const response = await fetch(url, options);

      if (response.status === 401) {
        // Token expired or invalid
        window.dispatchEvent(new CustomEvent("voledge:token-expired"));
        return response;
      }

      if (response.status === 429 || (response.status >= 500 && response.status <= 504)) {
        attempt++;
        if (attempt >= maxRetries) return response;
        await new Promise((r) => setTimeout(r, delay));
        delay *= 2;
        continue;
      }

      return response;
    } catch (err) {
      attempt++;
      if (attempt >= maxRetries) throw err;
      await new Promise((r) => setTimeout(r, delay));
      delay *= 2;
    }
  }

  throw new Error("Maximum retry attempts reached");
}

/**
 * Fetch market quotes in batches (max 50 instruments per request).
 */
export async function fetchMarketQuotes(instrumentKeys, token, proxyUrl = "") {
  if (!token || !instrumentKeys || instrumentKeys.length === 0) return {};

  const base = getBaseUrl(proxyUrl);
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
  };

  const results = {};
  const batchSize = 50;

  for (let i = 0; i < instrumentKeys.length; i += batchSize) {
    const batch = instrumentKeys.slice(i, i + batchSize);
    const url = `${base}/v2/market-quote/quotes?instrument_key=${encodeURIComponent(batch.join(","))}`;

    try {
      const resp = await fetchWithBackoff(url, { method: "GET", headers });
      if (resp.status === 200) {
        const json = await resp.json();
        Object.assign(results, json.data || {});
      }
    } catch (e) {
      // Graceful batch degradation
    }

    if (i + batchSize < instrumentKeys.length) {
      // Courteous rate-limiting delay between batches
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return results;
}

/**
 * Fetch option chain for underlying instrument.
 */
export async function fetchOptionChain(instrumentKey, expiryDate, token, proxyUrl = "") {
  if (!token || !instrumentKey || !expiryDate) return null;

  const base = getBaseUrl(proxyUrl);
  const url = `${base}/v2/option/chain?instrument_key=${encodeURIComponent(instrumentKey)}&expiry_date=${encodeURIComponent(expiryDate)}`;

  try {
    const resp = await fetchWithBackoff(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (resp.status === 200) {
      const json = await resp.json();
      return json.data || [];
    }
  } catch (e) {
    // Return null on failure
  }

  return null;
}

/**
 * Fetch historical candles.
 * Endpoint: /v2/historical-candle/{instrumentKey}/{interval}/{toDate}/{fromDate}
 */
export async function fetchHistoricalCandles(instrumentKey, interval, toDate, fromDate, token, proxyUrl = "") {
  if (!token || !instrumentKey) return null;

  const base = getBaseUrl(proxyUrl);
  const url = `${base}/v2/historical-candle/${encodeURIComponent(instrumentKey)}/${interval}/${toDate}/${fromDate}`;

  try {
    const resp = await fetchWithBackoff(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (resp.status === 200) {
      const json = await resp.json();
      const candles = json.data?.candles || [];
      // Upstox candles are newest-first; reverse to chronological order
      candles.reverse();
      return candles;
    }
  } catch (e) {
    // Return null on error
  }

  return null;
}

/**
 * Compute real-time SPAN margin requirement for a Short Put trade.
 * Endpoint: POST /v2/charges/margin
 */
export async function fetchMarginRequirement(instrumentKey, quantity, price, token, proxyUrl = "") {
  if (!token || !instrumentKey || quantity <= 0) return null;

  const base = getBaseUrl(proxyUrl);
  const url = `${base}/v2/charges/margin`;

  const payload = {
    instruments: [
      {
        instrument_key: instrumentKey,
        quantity: quantity,
        transaction_type: "SELL",
        product: "D", // Delivery / Normal F&O
        price: price || 0,
      },
    ],
  };

  try {
    const resp = await fetchWithBackoff(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (resp.status === 200) {
      const json = await resp.json();
      const margins = json.data?.margins || [];
      if (margins.length > 0) {
        return margins[0].total_margin || margins[0].span_margin || null;
      }
    }
  } catch (e) {
    // Fall back to SPAN proxy
  }

  return null;
}
