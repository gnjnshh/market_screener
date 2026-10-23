/**
 * Storage and settings manager for VolEdge India.
 * Handles Upstox token persistence, masking, expiry checking,
 * JWT decoding for 1-year Analytics Tokens and daily OAuth tokens,
 * and security isolation (localStorage vs sessionStorage).
 *
 * Security:
 * - NEVER logs tokens to the console.
 * - Stores token only in client browser storage.
 */

const STORAGE_KEYS = {
  TOKEN: "voledge_upstox_token",
  TOKEN_DATE: "voledge_token_date",
  REMEMBER: "voledge_remember_token",
  PROXY_URL: "voledge_proxy_url",
  CAPITAL: "voledge_capital",
  THEME: "voledge_theme",
};

/**
 * Get current date string in YYYY-MM-DD format (IST).
 * Upstox market trading day follows Indian Standard Time (Asia/Kolkata).
 */
export function getTodayDateString() {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch (e) {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
}

/**
 * Parse JWT token payload safely in browser.
 * Upstox tokens (both 1-year Analytics Tokens and daily OAuth tokens) are JWTs.
 * Extracts exp (UNIX expiration timestamp in seconds).
 */
export function parseJwt(token) {
  if (!token) return null;
  try {
    const clean = token.trim().replace(/^Bearer\s+/i, "");
    const parts = clean.split(".");
    if (parts.length < 2) return null;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(jsonPayload);
  } catch (e) {
    return null;
  }
}

/**
 * Mask access token showing only the last 4 characters.
 */
export function maskToken(token) {
  if (!token) return "";
  const trimmed = token.trim().replace(/^Bearer\s+/i, "");
  if (trimmed.length <= 4) return trimmed;
  const last4 = trimmed.slice(-4);
  return `••••••••••••${last4}`;
}

/**
 * Load settings and token from localStorage or sessionStorage.
 * Accurately determines expiration for both 1-year Analytics Tokens and 1-day OAuth tokens.
 */
export function loadSettings() {
  const remember = localStorage.getItem(STORAGE_KEYS.REMEMBER) === "true";
  const store = remember ? localStorage : sessionStorage;

  let token = store.getItem(STORAGE_KEYS.TOKEN) || localStorage.getItem(STORAGE_KEYS.TOKEN) || sessionStorage.getItem(STORAGE_KEYS.TOKEN) || "";
  let tokenDate = store.getItem(STORAGE_KEYS.TOKEN_DATE) || localStorage.getItem(STORAGE_KEYS.TOKEN_DATE) || sessionStorage.getItem(STORAGE_KEYS.TOKEN_DATE) || "";
  const proxyUrl = localStorage.getItem(STORAGE_KEYS.PROXY_URL) || "";
  const capitalStr = localStorage.getItem(STORAGE_KEYS.CAPITAL) || "1000000";
  const capital = parseFloat(capitalStr) || 1000000.0;
  const theme = localStorage.getItem(STORAGE_KEYS.THEME) || "dark";

  // Auto-purge legacy mock test tokens from previous selftest runs
  if (token === "MOCK_EXPIRED_TOKEN") {
    clearToken();
    token = "";
    tokenDate = "";
  }

  // Check token expiration:
  // 1. If token is a JWT (like Upstox Analytics Tokens or daily OAuth tokens), check actual cryptographic exp!
  let isStale = false;
  if (token) {
    const payload = parseJwt(token);
    if (payload && typeof payload.exp === "number") {
      // Expired ONLY if current system time has passed the exp timestamp
      isStale = Date.now() >= payload.exp * 1000;
    } else if (tokenDate) {
      // Fallback for non-JWT tokens: check daily trading day expiration
      isStale = tokenDate < getTodayDateString();
    }
  }

  return {
    token: token.trim().replace(/^Bearer\s+/i, ""),
    tokenDate,
    remember,
    proxyUrl: proxyUrl.trim(),
    capital,
    theme,
    isStale,
  };
}

/**
 * Save settings and token according to 'remember' preference.
 * When saving, stamps today's date in IST so active tokens are never trapped in stale status.
 */
export function saveSettings({ token, remember, proxyUrl, capital, theme }) {
  // Always store non-sensitive config in localStorage
  localStorage.setItem(STORAGE_KEYS.REMEMBER, remember ? "true" : "false");
  if (proxyUrl !== undefined) localStorage.setItem(STORAGE_KEYS.PROXY_URL, (proxyUrl || "").trim());
  if (capital !== undefined) localStorage.setItem(STORAGE_KEYS.CAPITAL, String(capital || 1000000.0));
  if (theme !== undefined) localStorage.setItem(STORAGE_KEYS.THEME, theme || "dark");

  const todayStr = getTodayDateString();

  if (token !== undefined) {
    // Sanitize token: remove leading "Bearer " prefix if user pasted it
    const cleanToken = (token || "").trim().replace(/^Bearer\s+/i, "");
    if (cleanToken) {
      if (remember) {
        sessionStorage.removeItem(STORAGE_KEYS.TOKEN);
        sessionStorage.removeItem(STORAGE_KEYS.TOKEN_DATE);
        localStorage.setItem(STORAGE_KEYS.TOKEN, cleanToken);
        localStorage.setItem(STORAGE_KEYS.TOKEN_DATE, todayStr);
      } else {
        localStorage.removeItem(STORAGE_KEYS.TOKEN);
        localStorage.removeItem(STORAGE_KEYS.TOKEN_DATE);
        sessionStorage.setItem(STORAGE_KEYS.TOKEN, cleanToken);
        sessionStorage.setItem(STORAGE_KEYS.TOKEN_DATE, todayStr);
      }
    } else {
      clearToken();
    }
  }
}

/**
 * Clear token only, keeping other settings intact.
 */
export function clearToken() {
  localStorage.removeItem(STORAGE_KEYS.TOKEN);
  localStorage.removeItem(STORAGE_KEYS.TOKEN_DATE);
  sessionStorage.removeItem(STORAGE_KEYS.TOKEN);
  sessionStorage.removeItem(STORAGE_KEYS.TOKEN_DATE);
}

/**
 * Clear all stored data and settings.
 */
export function clearAllData() {
  for (const key of Object.values(STORAGE_KEYS)) {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  }
}

/**
 * Validate Upstox token.
 * Supports both:
 * 1. Interactive / Trading OAuth Tokens (via /v2/user/profile)
 * 2. Analytics Tokens / Market Data Feed Tokens (via /v2/market-quote/quotes)
 */
export async function validateUpstoxToken(token, proxyUrl = "") {
  if (!token) {
    return { status: "not_set", label: "Not set", valid: false };
  }

  const cleanToken = token.trim().replace(/^Bearer\s+/i, "");

  // If token is a JWT, check exp timestamp first
  const payload = parseJwt(cleanToken);
  if (payload && typeof payload.exp === "number") {
    if (Date.now() >= payload.exp * 1000) {
      const expDate = new Date(payload.exp * 1000).toLocaleDateString();
      return {
        status: "expired",
        label: "Expired",
        valid: false,
        message: `Token expired on ${expDate}. Please generate a new token.`,
      };
    }
  }

  const base = proxyUrl ? proxyUrl.replace(/\/+$/, "") : "https://api.upstox.com";

  // Check 1: User Profile Endpoint (succeeds for Interactive Trading OAuth tokens)
  try {
    const profileResp = await fetch(`${base}/v2/user/profile`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${cleanToken}`,
      },
    });

    if (profileResp.status === 200) {
      const data = await profileResp.json();
      const userName = data?.data?.user_name || "User";
      return {
        status: "connected",
        label: "Connected",
        valid: true,
        userName,
        tokenType: "Interactive",
      };
    }
  } catch (e) {
    // Continue to check market quote endpoint
  }

  // Check 2: Market Quote Endpoint (succeeds for Analytics Tokens & Market Data Feed Tokens)
  try {
    const quoteResp = await fetch(`${base}/v2/market-quote/quotes?instrument_key=NSE_INDEX%7CNifty%2050`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${cleanToken}`,
      },
    });

    if (quoteResp.status === 200) {
      return {
        status: "connected",
        label: "Connected",
        valid: true,
        userName: "Analytics Token",
        tokenType: "Analytics",
      };
    }

    if (quoteResp.status === 401) {
      let detail = "Token has expired or is invalid.";
      try {
        const errJson = await quoteResp.json();
        if (errJson?.errors?.[0]?.message) {
          detail = errJson.errors[0].message;
        }
      } catch (e) {}
      return {
        status: "expired",
        label: "Expired",
        valid: false,
        message: detail,
      };
    } else {
      return {
        status: "error",
        label: "Check Failed",
        valid: false,
        message: `HTTP error ${quoteResp.status}`,
      };
    }
  } catch (err) {
    return {
      status: "error",
      label: "Network Error",
      valid: false,
      message: err.message || "Failed to reach Upstox endpoint",
    };
  }
}
