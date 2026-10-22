/**
 * Storage and settings manager for VolEdge India.
 * Handles Upstox token persistence, masking, expiry checking,
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
 * Get current date string in YYYY-MM-DD format (IST / local).
 */
export function getTodayDateString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Mask access token showing only the last 4 characters.
 */
export function maskToken(token) {
  if (!token) return "";
  const trimmed = token.trim();
  if (trimmed.length <= 4) return trimmed;
  const last4 = trimmed.slice(-4);
  return `••••••••••••${last4}`;
}

/**
 * Load settings and token from localStorage or sessionStorage.
 */
export function loadSettings() {
  const remember = localStorage.getItem(STORAGE_KEYS.REMEMBER) === "true";
  const store = remember ? localStorage : sessionStorage;

  const token = store.getItem(STORAGE_KEYS.TOKEN) || localStorage.getItem(STORAGE_KEYS.TOKEN) || sessionStorage.getItem(STORAGE_KEYS.TOKEN) || "";
  const tokenDate = store.getItem(STORAGE_KEYS.TOKEN_DATE) || localStorage.getItem(STORAGE_KEYS.TOKEN_DATE) || sessionStorage.getItem(STORAGE_KEYS.TOKEN_DATE) || "";
  const proxyUrl = localStorage.getItem(STORAGE_KEYS.PROXY_URL) || "";
  const capitalStr = localStorage.getItem(STORAGE_KEYS.CAPITAL) || "1000000";
  const capital = parseFloat(capitalStr) || 1000000.0;
  const theme = localStorage.getItem(STORAGE_KEYS.THEME) || "dark";

  const isStale = Boolean(token && tokenDate && tokenDate < getTodayDateString());

  return {
    token: token.trim(),
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
 */
export function saveSettings({ token, remember, proxyUrl, capital, theme }) {
  // Always store non-sensitive config in localStorage
  localStorage.setItem(STORAGE_KEYS.REMEMBER, remember ? "true" : "false");
  if (proxyUrl !== undefined) localStorage.setItem(STORAGE_KEYS.PROXY_URL, (proxyUrl || "").trim());
  if (capital !== undefined) localStorage.setItem(STORAGE_KEYS.CAPITAL, String(capital || 1000000.0));
  if (theme !== undefined) localStorage.setItem(STORAGE_KEYS.THEME, theme || "dark");

  const todayStr = getTodayDateString();

  if (token) {
    const cleanToken = token.trim();
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
 * Validate Upstox token using the lightweight user profile endpoint.
 */
export async function validateUpstoxToken(token, proxyUrl = "") {
  if (!token) {
    return { status: "not_set", label: "Not set", valid: false };
  }

  const base = proxyUrl ? proxyUrl.replace(/\/+$/, "") : "https://api.upstox.com";
  const url = `${base}/v2/user/profile`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.status === 200) {
      const data = await response.json();
      const userName = data?.data?.user_name || "User";
      return {
        status: "connected",
        label: "Connected",
        valid: true,
        userName,
      };
    } else if (response.status === 401) {
      return {
        status: "expired",
        label: "Expired",
        valid: false,
        message: "Token has expired or is invalid.",
      };
    } else {
      return {
        status: "error",
        label: "Check Failed",
        valid: false,
        message: `HTTP error ${response.status}`,
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
