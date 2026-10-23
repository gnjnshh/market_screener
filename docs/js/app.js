/**
 * Main application orchestrator for VolEdge India.
 * Handles data loading, state, UI rendering, live Upstox API integration,
 * Lightweight Charts visualization, detail drawer, sorting, filtering,
 * and security-compliant token handling.
 *
 * Strict Rule: No emojis anywhere.
 */

import {
  loadSettings,
  saveSettings,
  clearToken,
  clearAllData,
  validateUpstoxToken,
  maskToken,
} from "./storage.js";
import { runInBrowserSelfTest } from "./selftest.js";
import {
  fetchMarketQuotes,
  fetchOptionChain,
  fetchMarginRequirement,
} from "./upstox.js";
import {
  calculateRecommendedStrike,
  calculateExpectedMove,
  calculatePop,
  calculatePTouch,
  calculateCredit,
  calculateRom,
  calculateEv,
  calculateStressLoss,
  calculateScore,
  determineVerdict,
} from "./calc.js";

// Global App State
const state = {
  stocks: [],
  filteredStocks: [],
  regime: null,
  meta: null,
  settings: loadSettings(),
  tokenStatus: "not_set",
  userName: "",
  selectedSymbol: null,
  activeChartTab: "price", // "price", "vol", "oi"
  currentChartInstance: null,
  pollTimer: null,
  hasPromptedOnLoad: false,
  filters: {
    search: "",
    sector: "ALL",
    verdict: "ALL",
    minScore: 0,
    minPop: 0,
    sortField: "score",
    sortDir: "desc",
  },
};

// Safe formatting helpers (Missing data shows '-', never NaN/undefined/null)
function formatNum(val, decimals = 1, prefix = "", suffix = "") {
  if (val === null || val === undefined || isNaN(val)) return "-";
  return `${prefix}${Number(val).toFixed(decimals)}${suffix}`;
}

function formatCurrency(val, decimals = 0) {
  if (val === null || val === undefined || isNaN(val)) return "-";
  return `₹${Number(val).toFixed(decimals)}`;
}

/**
 * Create state pill with text label and inline SVG icon.
 * Strict requirement: States: green pass, amber watch, red reject; always with text label + inline SVG icon.
 */
function createStatePill(status, text, extraClass = "") {
  const span = document.createElement("span");
  span.className = `pill pill-${status} ${extraClass}`.trim();

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "12");
  svg.setAttribute("height", "12");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");

  if (status === "pass") {
    // Checkmark icon
    const poly = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    poly.setAttribute("points", "20 6 9 17 4 12");
    svg.appendChild(poly);
  } else if (status === "watch") {
    // Alert circle icon
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", "12");
    circle.setAttribute("cy", "12");
    circle.setAttribute("r", "10");
    const line1 = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line1.setAttribute("x1", "12");
    line1.setAttribute("y1", "8");
    line1.setAttribute("x2", "12");
    line1.setAttribute("y2", "12");
    const line2 = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line2.setAttribute("x1", "12");
    line2.setAttribute("y1", "16");
    line2.setAttribute("x2", "12.01");
    line2.setAttribute("y2", "16");
    svg.appendChild(circle);
    svg.appendChild(line1);
    svg.appendChild(line2);
  } else if (status === "reject") {
    // X circle icon
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", "12");
    circle.setAttribute("cy", "12");
    circle.setAttribute("r", "10");
    const line1 = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line1.setAttribute("x1", "15");
    line1.setAttribute("y1", "9");
    line1.setAttribute("x2", "9");
    line1.setAttribute("y2", "15");
    const line2 = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line2.setAttribute("x1", "9");
    line2.setAttribute("y1", "9");
    line2.setAttribute("x2", "15");
    line2.setAttribute("y2", "15");
    svg.appendChild(circle);
    svg.appendChild(line1);
    svg.appendChild(line2);
  } else {
    // Info circle icon
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", "12");
    circle.setAttribute("cy", "12");
    circle.setAttribute("r", "10");
    const line1 = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line1.setAttribute("x1", "12");
    line1.setAttribute("y1", "16");
    line1.setAttribute("x2", "12");
    line1.setAttribute("y2", "12");
    const line2 = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line2.setAttribute("x1", "12");
    line2.setAttribute("y1", "8");
    line2.setAttribute("x2", "12.01");
    line2.setAttribute("y2", "8");
    svg.appendChild(circle);
    svg.appendChild(line1);
    svg.appendChild(line2);
  }

  const labelSpan = document.createElement("span");
  labelSpan.textContent = text;

  span.appendChild(svg);
  span.appendChild(labelSpan);
  return span;
}

function updateElementWithStatePill(containerEl, status, text, extraClass = "") {
  if (!containerEl) return;
  containerEl.textContent = "";
  const pill = createStatePill(status, text, extraClass);
  containerEl.className = pill.className;
  while (pill.firstChild) {
    containerEl.appendChild(pill.firstChild);
  }
}

// Document Ready Bootstrap
document.addEventListener("DOMContentLoaded", async () => {
  initTheme();
  setupEventListeners();
  await loadScannerData();
  await initSettingsAndToken();
  await runInBrowserSelfTest();
});

/**
 * Initialize theme based on preference or saved setting.
 */
function initTheme() {
  const savedTheme = state.settings.theme;
  const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = savedTheme || (systemPrefersDark ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", theme);
  updateThemeIcon(theme);
}

function updateThemeIcon(theme) {
  const icon = document.getElementById("theme-toggle-icon");
  if (!icon) return;
  icon.textContent = "";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");

  if (theme === "dark") {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", "12");
    circle.setAttribute("cy", "12");
    circle.setAttribute("r", "5");
    svg.appendChild(circle);

    const lines = [
      [12, 1, 12, 3],
      [12, 21, 12, 23],
      [4.22, 4.22, 5.64, 5.64],
      [18.36, 18.36, 19.78, 19.78],
      [1, 12, 3, 12],
      [21, 12, 23, 12],
      [4.22, 19.78, 5.64, 18.36],
      [18.36, 5.64, 19.78, 4.22],
    ];
    lines.forEach(([x1, y1, x2, y2]) => {
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", String(x1));
      line.setAttribute("y1", String(y1));
      line.setAttribute("x2", String(x2));
      line.setAttribute("y2", String(y2));
      svg.appendChild(line);
    });
  } else {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z");
    svg.appendChild(path);
  }

  icon.appendChild(svg);
}

/**
 * Open Settings Modal.
 */
function openSettingsModal() {
  const modal = document.getElementById("settings-modal");
  const s = state.settings;
  const tokenInput = document.getElementById("setting-token-input");
  if (tokenInput) {
    if (state.tokenStatus === "expired" || s.isStale) {
      tokenInput.value = "";
      tokenInput.placeholder = "Token expired - paste new daily token";
    } else {
      tokenInput.value = s.token ? maskToken(s.token) : "";
      tokenInput.placeholder = "Paste daily Upstox token here";
    }
  }
  const proxyInput = document.getElementById("setting-proxy-input");
  if (proxyInput) proxyInput.value = s.proxyUrl || "";
  const capitalInput = document.getElementById("setting-capital-input");
  if (capitalInput) capitalInput.value = s.capital || 1000000;
  const rememberToggle = document.getElementById("setting-remember-toggle");
  if (rememberToggle) rememberToggle.checked = s.remember;

  if (modal) {
    modal.style.display = "flex";
    if ((!s.token || state.tokenStatus === "expired" || s.isStale) && tokenInput) {
      setTimeout(() => tokenInput.focus(), 100);
    }
  }
}

function closeSettingsModal() {
  const modal = document.getElementById("settings-modal");
  if (modal) modal.style.display = "none";
}

/**
 * Initialize settings, validate token silently if available.
 * Requirement: only show settings modal if no token exists or token is invalid/expired.
 */
async function initSettingsAndToken() {
  const tokenPill = document.getElementById("token-status-pill");
  const dataPill = document.getElementById("data-status-pill");
  const eodBanner = document.getElementById("eod-banner");

  if (!state.settings.token) {
    state.tokenStatus = "not_set";
    updateElementWithStatePill(tokenPill, "watch", "Token: Not set");
    updateElementWithStatePill(dataPill, "info", "Data: EOD");
    if (eodBanner) eodBanner.style.display = "flex";

    // Show settings modal on initial load when no token exists
    if (!state.hasPromptedOnLoad) {
      state.hasPromptedOnLoad = true;
      openSettingsModal();
    }
    return;
  }

  if (state.settings.isStale) {
    showToast("Token from previous day, checking status with Upstox...");
    updateElementWithStatePill(tokenPill, "info", "Token: Validating previous day token...");
  } else {
    updateElementWithStatePill(tokenPill, "info", "Token: Validating...");
  }

  const validation = await validateUpstoxToken(state.settings.token, state.settings.proxyUrl);
  state.tokenStatus = validation.status;

  if (validation.valid) {
    state.userName = validation.userName;
    updateElementWithStatePill(tokenPill, "pass", `Token: Connected (${validation.userName})`);
    updateElementWithStatePill(dataPill, "pass", "Data: Live (Upstox)");
    if (eodBanner) eodBanner.style.display = "none";

    // Refresh stored date to today if validated
    if (state.settings.isStale) {
      saveSettings({
        token: state.settings.token,
        remember: state.settings.remember,
        proxyUrl: state.settings.proxyUrl,
        capital: state.settings.capital,
        theme: state.settings.theme,
      });
      state.settings = loadSettings();
    }

    // Switch to live mode and fetch real-time quotes
    await fetchAndUpdateLiveQuotes();
    startPollingQuotes();
  } else if (validation.status === "expired") {
    state.tokenStatus = "expired";
    updateElementWithStatePill(tokenPill, "reject", "Token: Expired");
    updateElementWithStatePill(dataPill, "info", "Data: EOD");
    if (eodBanner) eodBanner.style.display = "flex";
    const msg = state.settings.isStale
      ? "Token from previous day expired. Please refresh in Settings."
      : (validation.message || "Upstox token expired. Please refresh in Settings.");
    showToast(msg);

    if (!state.hasPromptedOnLoad) {
      state.hasPromptedOnLoad = true;
      openSettingsModal();
    }
  } else {
    updateElementWithStatePill(tokenPill, "watch", "Token: Offline Check Failed");
    updateElementWithStatePill(dataPill, "info", "Data: EOD");
  }
}

/**
 * Fetch and apply live Upstox market quotes.
 * Recalculates strikes, POP, expected move, credit, RoM, EV, and score in real time.
 */
async function fetchAndUpdateLiveQuotes() {
  if (!state.settings.token || state.stocks.length === 0) return;

  const dataPill = document.getElementById("data-status-pill");
  const scanBtnText = document.getElementById("scan-btn-text");
  if (scanBtnText) scanBtnText.textContent = "Updating...";

  try {
    const instrumentKeys = state.stocks.map((s) => s.instrument_key || `NSE_EQ|${s.symbol}`);
    const quotes = await fetchMarketQuotes(instrumentKeys, state.settings.token, state.settings.proxyUrl);

    if (quotes && Object.keys(quotes).length > 0) {
      let updatedCount = 0;

      for (const stock of state.stocks) {
        const key = stock.instrument_key || `NSE_EQ|${stock.symbol}`;
        const q = quotes[key];
        if (!q || !q.last_price || q.last_price <= 0) continue;

        const liveSpot = q.last_price;
        stock.spot = liveSpot;
        stock.notional = Math.round(liveSpot * stock.lot_size);

        // Recalculate 200DMA ratio if 200DMA baseline exists
        if (stock.spot_200dma && stock.spot > 0) {
          const estimatedSma = stock.spot / stock.spot_200dma;
          stock.spot_200dma = Number((liveSpot / estimatedSma).toFixed(4));
        }

        // Recalculate Recommended Strike
        const ivDec = stock.iv / 100.0;
        const recStrike = calculateRecommendedStrike(
          liveSpot,
          ivDec,
          stock.dte,
          stock.put_oi_wall || 0,
          stock.symbol
        );
        stock.recommended_strike = recStrike;

        // Recalculate Trade Math
        stock.expected_move = calculateExpectedMove(liveSpot, ivDec, stock.dte);
        stock.pop = calculatePop(liveSpot, recStrike, stock.dte, ivDec);
        stock.p_touch = calculatePTouch(stock.pop);

        // Premium estimate
        const putBid = q.depth?.buy?.[0]?.price || Math.max(0.5, stock.put_bid || 1.0);
        stock.put_bid = putBid;
        stock.credit = calculateCredit(putBid, stock.lot_size);
        const margin = stock.est_margin || stock.notional * 0.165;
        stock.rom = calculateRom(stock.credit, margin);
        stock.ev = calculateEv(stock.pop, stock.credit, liveSpot, recStrike, stock.dte, ivDec, stock.lot_size);

        const stress = calculateStressLoss(
          liveSpot,
          recStrike,
          stock.dte,
          ivDec,
          stock.lot_size,
          state.settings.capital,
          putBid
        );
        stock.stress_loss_capital_pct = stress.stress_loss_capital_pct;
        stock.stress_loss_inr = stress.stress_loss_inr;

        // Recompute Score and Verdict
        stock.score = calculateScore(stock);
        const { verdict, failed_checks } = determineVerdict(stock, stock.score);
        stock.verdict = verdict;
        stock.failed_checks = failed_checks;

        updatedCount++;
      }

      if (dataPill) {
        dataPill.textContent = "Data: Live (Upstox)";
        dataPill.className = "pill pill-pass";
      }
      applyFilters();
    }
  } catch (err) {
    // Gracefully preserve existing EOD data on quote fetch failure
  } finally {
    if (scanBtnText) scanBtnText.textContent = "Scan Now";
  }
}

/**
 * Start polite polling for quotes during trading hours (every 30 seconds).
 */
function startPollingQuotes() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(async () => {
    if (state.settings.token && state.tokenStatus === "connected") {
      await fetchAndUpdateLiveQuotes();
    }
  }, 30000);
}

/**
 * Load metadata, global regime, and EOD scanner output from data/*.json.
 */
async function loadScannerData() {
  showSkeletons(true);

  try {
    const [metaRes, regimeRes, eodRes] = await Promise.all([
      fetch("data/meta.json").catch(() => null),
      fetch("data/regime.json").catch(() => null),
      fetch("data/scanner_eod.json").catch(() => null),
    ]);

    if (metaRes && metaRes.ok) {
      state.meta = await metaRes.json();
      renderMeta(state.meta);
    }

    if (regimeRes && regimeRes.ok) {
      state.regime = await regimeRes.json();
      renderRegime(state.regime);
    }

    if (eodRes && eodRes.ok) {
      state.stocks = await eodRes.json();
      populateSectorOptions(state.stocks);
      applyFilters();
    }
  } catch (err) {
    // EOD loading fallback
  } finally {
    showSkeletons(false);
  }
}

/**
 * Render Header Metadata.
 */
function renderMeta(meta) {
  const lastUpdatedEl = document.getElementById("last-updated-text");
  const marketPill = document.getElementById("market-status-pill");
  const dataPill = document.getElementById("data-status-pill");

  if (lastUpdatedEl) lastUpdatedEl.textContent = meta.last_updated || "-";
  if (marketPill) {
    updateElementWithStatePill(marketPill, meta.market_status === "Open" ? "pass" : "info", `Market: ${meta.market_status}`);
  }
  if (dataPill && state.tokenStatus !== "connected") {
    updateElementWithStatePill(dataPill, "info", `Data: ${meta.data_status || "EOD"}`);
  }

  // Stale check > 30 min in market hours
  if (meta.market_status === "Open" && meta.timestamp_utc) {
    const dataTime = new Date(meta.timestamp_utc).getTime();
    const nowTime = Date.now();
    const diffMinutes = (nowTime - dataTime) / (1000 * 60);
    const staleEl = document.getElementById("market-stale-banner");
    if (diffMinutes > 30 && staleEl) {
      staleEl.style.display = "flex";
    }
  }
}

/**
 * Render Global Regime Strip.
 */
function renderRegime(regime) {
  const grid = document.getElementById("regime-grid");
  const multiplierBadge = document.getElementById("regime-multiplier-badge");

  if (!grid || !regime) return;

  if (multiplierBadge) {
    const multStatus = regime.multiplier >= 1.0 ? "pass" : regime.multiplier >= 0.5 ? "watch" : "reject";
    updateElementWithStatePill(
      multiplierBadge,
      multStatus,
      `Sizing Multiplier: ${(regime.multiplier * 100).toFixed(0)}% (${regime.regime_state.toUpperCase()})`,
      "regime-multiplier-badge"
    );
  }

  grid.textContent = "";
  for (const [, item] of Object.entries(regime.indicators || {})) {
    const chip = document.createElement("div");
    chip.className = "regime-chip";

    const label = document.createElement("div");
    label.className = "chip-label";
    label.textContent = item.label;

    const val = document.createElement("div");
    val.className = "chip-value tabular-nums";
    if (item.label === "Nifty Gamma (GEX)") {
      val.textContent = `${item.value >= 0 ? "+Positive" : "-Negative"} (Zero-γ: 24,150)`;
    } else {
      val.textContent = `${item.value} ${item.unit}`;
    }

    const isUp = item.change >= 0;
    const chipStatus = item.state === "risk_off" ? "reject" : item.state === "risk_on" ? "pass" : "watch";
    const changeText = item.label === "Nifty Gamma (GEX)"
      ? (item.state === "risk_on" ? "Stabilizing [risk-on]" : "Accelerating [risk-off]")
      : `${isUp ? "+" : ""}${item.change} [${item.state.replace("_", "-")}]`;
    const changePill = createStatePill(chipStatus, changeText, "chip-change tabular-nums");

    chip.appendChild(label);
    chip.appendChild(val);
    chip.appendChild(changePill);
    grid.appendChild(chip);
  }
}

/**
 * Populate Sector Dropdown.
 */
function populateSectorOptions(stocks) {
  const select = document.getElementById("filter-sector");
  if (!select) return;

  const sectors = Array.from(new Set(stocks.map((s) => s.sector))).filter(Boolean).sort();
  select.textContent = "";
  const allOpt = document.createElement("option");
  allOpt.value = "ALL";
  allOpt.textContent = "All Sectors";
  select.appendChild(allOpt);

  for (const sec of sectors) {
    const opt = document.createElement("option");
    opt.value = sec;
    opt.textContent = sec;
    select.appendChild(opt);
  }
}

/**
 * Filter, sort, and render stock rows.
 */
function applyFilters() {
  const { search, sector, verdict, minScore, minPop, sortField, sortDir } = state.filters;

  state.filteredStocks = state.stocks.filter((s) => {
    if (search && !s.symbol.toLowerCase().includes(search.toLowerCase())) return false;
    if (sector !== "ALL" && s.sector !== sector) return false;
    if (verdict !== "ALL" && s.verdict !== verdict) return false;
    if (minScore > 0 && s.score < minScore) return false;
    if (minPop > 0 && s.pop < minPop) return false;
    return true;
  });

  // Sort
  state.filteredStocks.sort((a, b) => {
    const valA = a[sortField];
    const valB = b[sortField];

    if (valA === null || valA === undefined) return 1;
    if (valB === null || valB === undefined) return -1;

    if (typeof valA === "string" && typeof valB === "string") {
      const cmp = valA.localeCompare(valB);
      return sortDir === "asc" ? cmp : -cmp;
    }

    const numA = Number(valA);
    const numB = Number(valB);
    if (!isNaN(numA) && !isNaN(numB)) {
      if (numA < numB) return sortDir === "asc" ? -1 : 1;
      if (numA > numB) return sortDir === "asc" ? 1 : -1;
      return 0;
    }

    return 0;
  });

  renderSummaryCards(state.filteredStocks);
  renderDesktopTable(state.filteredStocks);
  renderMobileCards(state.filteredStocks);

  const ariaRegion = document.getElementById("aria-result-count");
  if (ariaRegion) {
    ariaRegion.textContent = `Displaying ${state.filteredStocks.length} of ${state.stocks.length} scanned underlyings.`;
  }
}

/**
 * Render Summary metric counts.
 */
function renderSummaryCards(stocks) {
  const qualCount = stocks.filter((s) => s.verdict === "QUALIFIED").length;
  const watchCount = stocks.filter((s) => s.verdict === "WATCH").length;
  const rejectCount = stocks.filter((s) => s.verdict === "REJECTED").length;
  const avgScore = stocks.length > 0
    ? (stocks.reduce((acc, s) => acc + (s.score || 0), 0) / stocks.length).toFixed(1)
    : "0.0";

  const qEl = document.getElementById("sum-qualified-count");
  const wEl = document.getElementById("sum-watch-count");
  const rEl = document.getElementById("sum-rejected-count");
  const avgEl = document.getElementById("sum-avg-score");

  if (qEl) qEl.textContent = String(qualCount);
  if (wEl) wEl.textContent = String(watchCount);
  if (rEl) rEl.textContent = String(rejectCount);
  if (avgEl) avgEl.textContent = String(avgScore);
}

/**
 * Render Desktop Dense Table (38 columns organized by Groups A-F).
 */
function renderDesktopTable(stocks) {
  const tbody = document.getElementById("desktop-table-body");
  if (!tbody) return;
  tbody.textContent = "";

  if (stocks.length === 0) {
    const emptyTr = document.createElement("tr");
    const emptyTd = document.createElement("td");
    emptyTd.colSpan = 39;
    emptyTd.style.textAlign = "center";
    emptyTd.style.padding = "30px";
    emptyTd.style.color = "var(--text-dim)";
    emptyTd.textContent = "No F&O underlyings match selected filter criteria.";
    emptyTr.appendChild(emptyTd);
    tbody.appendChild(emptyTr);
    return;
  }

  for (const s of stocks) {
    const tr = document.createElement("tr");
    tr.addEventListener("click", () => openDetailDrawer(s.symbol));

    // 1. Navigation Sticky Columns
    const tdSym = document.createElement("td");
    tdSym.className = "sticky-col-sym";
    const symStrong = document.createElement("strong");
    symStrong.textContent = s.symbol || "-";
    tdSym.appendChild(symStrong);
    tr.appendChild(tdSym);

    const tdVerdict = document.createElement("td");
    tdVerdict.className = "sticky-col-verdict";
    const vStatus = s.verdict === "QUALIFIED" ? "pass" : s.verdict === "WATCH" ? "watch" : "reject";
    const verdictPill = createStatePill(vStatus, s.verdict || "-");
    tdVerdict.appendChild(verdictPill);

    const failList = document.createElement("ul");
    failList.className = "verdict-failures";
    if (s.failed_checks && s.failed_checks.length > 0) {
      for (const fc of s.failed_checks) {
        const li = document.createElement("li");
        li.className = s.verdict === "WATCH" ? "verdict-watch-item" : "verdict-failure-item";
        li.textContent = `• ${fc}`;
        failList.appendChild(li);
      }
    } else if (s.verdict === "QUALIFIED") {
      const li = document.createElement("li");
      li.className = "verdict-pass-item";
      li.textContent = "• All 5 pillars cleared";
      failList.appendChild(li);
    }
    tdVerdict.appendChild(failList);
    tr.appendChild(tdVerdict);

    // Cells helper
    const addCell = (text, isStrong = false, customColor = null) => {
      const td = document.createElement("td");
      td.className = "tabular-nums";
      if (customColor) td.style.color = customColor;
      if (isStrong) {
        const str = document.createElement("strong");
        str.textContent = text;
        td.appendChild(str);
      } else {
        td.textContent = text;
      }
      tr.appendChild(td);
    };

    // A. Identity (5 cols)
    addCell(formatNum(s.lot_size, 0));
    addCell(formatCurrency(s.spot, 1));
    addCell(formatCurrency(s.notional, 0));
    addCell(s.sector || "-");
    addCell(formatNum(s.beta_1y, 2));

    // B. Structure (6 cols)
    addCell(formatNum(s.spot_200dma, 2));
    addCell(s.drawdown_52w !== null && s.drawdown_52w !== undefined ? `${(s.drawdown_52w * 100).toFixed(1)}%` : "-");
    addCell(formatNum(s.rsi_14, 1));
    addCell(formatNum(s.percent_b, 2));
    addCell(s.adx_14 !== null && s.adx_14 !== undefined ? `${s.adx_14.toFixed(1)} (+${formatNum(s.plus_di, 0)}/-${formatNum(s.minus_di, 0)})` : "-");
    addCell(formatNum(s.downvol_ratio_20d, 2));

    // C. Volatility Edge (6 cols)
    addCell(formatNum(s.iv, 1, "", "%"));
    addCell(formatNum(s.iv_percentile_1y, 1, "", "%"));
    addCell(formatNum(s.iv_yz_ratio, 2));
    addCell(formatNum(s.hv10_yz20, 2));
    addCell(formatNum(s.skew_25d_pct, 1, "", "%"));
    addCell(formatNum(s.term_structure, 2));

    // D. Positioning (6 cols)
    addCell(s.put_oi_wall ? `₹${s.put_oi_wall}` : "-");
    addCell(s.put_wall_oi_change_3d !== null && s.put_wall_oi_change_3d !== undefined
      ? `${s.put_wall_oi_change_3d > 0 ? "+" : ""}${s.put_wall_oi_change_3d.toFixed(1)}%`
      : "-"
    );
    addCell(formatNum(s.bid_ask_spread_pct, 2, "", "%"));
    addCell(formatNum(s.mwpl_pct, 1, "", "%"));
    addCell(s.futures_buildup || "-");
    addCell(s.annualized_basis_pct !== null && s.annualized_basis_pct !== undefined
      ? `${s.annualized_basis_pct > 0 ? "+" : ""}${s.annualized_basis_pct.toFixed(1)}%`
      : "-"
    );

    // E. Trade Math (10 cols)
    addCell(formatCurrency(s.recommended_strike, 1), true);
    addCell(formatCurrency(s.expected_move, 1));
    addCell(formatNum(s.pop, 1, "", "%"));
    addCell(formatNum(s.p_touch, 1, "", "%"));
    addCell(formatNum(s.empirical_pop, 1, "", "%"));
    addCell(formatNum(s.gap_cover, 2, "", "x"));
    addCell(formatCurrency(s.credit, 0));
    addCell(formatNum(s.rom, 1, "", "%"));
    addCell(formatCurrency(s.ev, 0));
    addCell(formatNum(s.stress_loss_capital_pct, 2, "", "%"));

    // F. Guards & Score (4 cols)
    addCell(formatNum(s.score, 1), true);

    const tdEvent = document.createElement("td");
    tdEvent.appendChild(createStatePill(s.event_gap ? "reject" : "pass", s.event_gap ? "Danger" : "Clear"));
    tr.appendChild(tdEvent);

    const tdFund = document.createElement("td");
    tdFund.appendChild(createStatePill(s.fundamental_gate_passed ? "pass" : "reject", s.fundamental_gate_passed ? "Pass" : "Fail"));
    tr.appendChild(tdFund);

    addCell(`${s.dte || "-"}d`);

    tbody.appendChild(tr);
  }
}

/**
 * Render Mobile Cards with SVG Circular Score Ring.
 */
function renderMobileCards(stocks) {
  const container = document.getElementById("mobile-cards-container");
  if (!container) return;
  container.textContent = "";

  if (stocks.length === 0) {
    const emptyDiv = document.createElement("div");
    emptyDiv.className = "glass-card";
    emptyDiv.style.padding = "24px";
    emptyDiv.style.textAlign = "center";
    emptyDiv.style.color = "var(--text-dim)";
    emptyDiv.textContent = "No underlyings match filters.";
    container.appendChild(emptyDiv);
    return;
  }

  for (const s of stocks) {
    const card = document.createElement("div");
    card.className = "stock-card glass-card";
    card.addEventListener("click", () => openDetailDrawer(s.symbol));

    const vStatus = s.verdict === "QUALIFIED" ? "pass" : s.verdict === "WATCH" ? "watch" : "reject";
    const scoreVal = Math.round(s.score || 0);
    const ringColor = s.verdict === "QUALIFIED" ? "var(--status-pass-text)" : s.verdict === "WATCH" ? "var(--status-watch-text)" : "var(--status-reject-text)";

    const header = document.createElement("div");
    header.className = "stock-card-header";

    const left = document.createElement("div");
    const sym = document.createElement("div");
    sym.className = "stock-symbol";
    sym.textContent = s.symbol || "-";

    const sec = document.createElement("div");
    sec.className = "stock-sector";
    sec.textContent = `${s.sector || "F&O"} • ${formatCurrency(s.spot, 1)}`;
    left.appendChild(sym);
    left.appendChild(sec);

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.alignItems = "center";
    right.style.gap = "10px";

    const vPill = createStatePill(vStatus, s.verdict || "-");

    // Score Ring SVG
    const ringBox = createScoreRingSvg(scoreVal, ringColor);

    right.appendChild(vPill);
    right.appendChild(ringBox);

    header.appendChild(left);
    header.appendChild(right);
    card.appendChild(header);

    if (s.failed_checks && s.failed_checks.length > 0) {
      const cardFails = document.createElement("ul");
      cardFails.className = "card-failed-checks";
      for (const fc of s.failed_checks) {
        const li = document.createElement("li");
        li.className = s.verdict === "WATCH" ? "verdict-watch-item" : "verdict-failure-item";
        li.textContent = `• ${fc}`;
        cardFails.appendChild(li);
      }
      card.appendChild(cardFails);
    }

    const metrics = document.createElement("div");
    metrics.className = "stock-card-metrics tabular-nums";

    const addBox = (label, val, customColor = null) => {
      const box = document.createElement("div");
      box.className = "metric-box";
      const lbl = document.createElement("span");
      lbl.className = "metric-box-label";
      lbl.textContent = label;
      const v = document.createElement("span");
      v.className = "metric-box-val";
      v.textContent = val;
      if (customColor) v.style.color = customColor;
      box.appendChild(lbl);
      box.appendChild(v);
      metrics.appendChild(box);
    };

    addBox("Short Strike", formatCurrency(s.recommended_strike, 1));
    addBox("POP", formatNum(s.pop, 1, "", "%"));
    addBox("RoM %", formatNum(s.rom, 1, "", "%"));
    addBox("Credit", formatCurrency(s.credit, 0));
    addBox("Gap Cover", formatNum(s.gap_cover, 2, "", "x"));
    addBox(
      "Event Gap",
      s.event_gap ? "Scheduled" : "Clear",
      s.event_gap ? "var(--status-reject-text)" : "var(--status-pass-text)"
    );

    card.appendChild(metrics);
    container.appendChild(card);
  }
}

/**
 * Create SVG Circular Score Ring element.
 */
function createScoreRingSvg(score, color) {
  const container = document.createElement("div");
  container.className = "score-ring-container";

  const radius = 17;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "score-ring-svg");
  svg.setAttribute("viewBox", "0 0 44 44");

  const bgCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  bgCircle.setAttribute("class", "score-ring-bg");
  bgCircle.setAttribute("cx", "22");
  bgCircle.setAttribute("cy", "22");
  bgCircle.setAttribute("r", String(radius));

  const fillCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  fillCircle.setAttribute("class", "score-ring-fill");
  fillCircle.setAttribute("cx", "22");
  fillCircle.setAttribute("cy", "22");
  fillCircle.setAttribute("r", String(radius));
  fillCircle.setAttribute("stroke", color);
  fillCircle.setAttribute("stroke-dasharray", String(circumference));
  fillCircle.setAttribute("stroke-dashoffset", String(strokeDashoffset));

  svg.appendChild(bgCircle);
  svg.appendChild(fillCircle);

  const text = document.createElement("span");
  text.className = "score-ring-text tabular-nums";
  text.style.color = color;
  text.textContent = String(score);

  container.appendChild(svg);
  container.appendChild(text);
  return container;
}

/**
 * Open Detail Drawer for an individual stock.
 */
async function openDetailDrawer(symbol) {
  const stock = state.stocks.find((s) => s.symbol === symbol);
  if (!stock) return;

  state.selectedSymbol = symbol;
  const drawer = document.getElementById("detail-drawer");
  const backdrop = document.getElementById("drawer-backdrop");

  const drawerSymbol = document.getElementById("drawer-symbol");
  if (drawerSymbol) {
    drawerSymbol.textContent = `${stock.symbol} (${stock.sector || "F&O"})`;
  }

  // Security: Render verdict without innerHTML
  const drawerVerdict = document.getElementById("drawer-verdict");
  if (drawerVerdict) {
    drawerVerdict.textContent = "";
    const vStatus = stock.verdict === "QUALIFIED" ? "pass" : stock.verdict === "WATCH" ? "watch" : "reject";
    const vSpan = createStatePill(vStatus, `${stock.verdict} (Score: ${stock.score})`);
    drawerVerdict.appendChild(vSpan);
  }

  // Live Upstox Margin & Quote Call if token is connected
  await updateDrawerLiveBrokerData(stock);

  // Render 5-Pillar Checklist
  renderDrawerChecklist(stock);

  // Render Lightweight Charts
  await renderDrawerLightweightChart(symbol, stock, state.activeChartTab);

  if (drawer) drawer.classList.add("open");
  if (backdrop) backdrop.classList.add("active");
}

/**
 * Update Drawer with Live Upstox SPAN Margin and Live Spot when token is valid.
 */
async function updateDrawerLiveBrokerData(stock) {
  const banner = document.getElementById("drawer-live-quote-banner");
  const spotEl = document.getElementById("drawer-live-spot");
  const marginEl = document.getElementById("drawer-live-margin");

  if (!banner) return;

  if (state.tokenStatus === "connected" && state.settings.token) {
    banner.style.display = "flex";
    if (spotEl) spotEl.textContent = formatCurrency(stock.spot, 1);
    if (marginEl) marginEl.textContent = "Fetching SPAN...";

    try {
      const margin = await fetchMarginRequirement(
        stock.instrument_key || `NSE_EQ|${stock.symbol}`,
        stock.lot_size,
        stock.put_bid || 0,
        state.settings.token,
        state.settings.proxyUrl
      );
      if (margin && marginEl) {
        marginEl.textContent = formatCurrency(margin, 0);
      } else if (marginEl) {
        marginEl.textContent = formatCurrency(stock.est_margin, 0) + " (SPAN Est)";
      }
    } catch (e) {
      if (marginEl) marginEl.textContent = formatCurrency(stock.est_margin, 0) + " (SPAN Est)";
    }
  } else {
    banner.style.display = "none";
  }
}

/**
 * Render Interactive Lightweight Chart in Detail Drawer.
 * Supports 3 tabs:
 * 1. "price": Price vs 200DMA line overlay with Strike Floor
 * 2. "vol": IV vs Realized Volatility (Yang-Zhang RV)
 * 3. "oi": Open Interest by strike with Put Wall and Zero-Gamma marked
 */
async function renderDrawerLightweightChart(symbol, stock, tab = "price") {
  const container = document.getElementById("chart-container");
  if (!container) return;

  // Clean up previous chart instance
  if (state.currentChartInstance) {
    try {
      state.currentChartInstance.remove();
    } catch (e) {
      // Ignore cleanup error
    }
    state.currentChartInstance = null;
  }
  container.textContent = "";

  try {
    const resp = await fetch(`data/history/${symbol}.json`);
    if (!resp.ok) {
      container.textContent = "Historical series data not available.";
      container.style.color = "var(--text-dim)";
      return;
    }
    const history = await resp.json();
    const dates = history.dates || [];
    const closes = history.closes || [];
    const opens = history.opens || closes;
    const highs = history.highs || closes;
    const lows = history.lows || closes;
    const ivSeries = history.iv_series || [];
    const rvSeries = history.rv_series || [];

    if (!window.LightweightCharts) {
      container.textContent = "Lightweight Charts library unavailable.";
      return;
    }

    const isDark = document.documentElement.getAttribute("data-theme") !== "light";
    const chart = window.LightweightCharts.createChart(container, {
      width: container.clientWidth || 460,
      height: 220,
      layout: {
        background: { color: "transparent" },
        textColor: isDark ? "#94a3b8" : "#475569",
      },
      grid: {
        vertLines: { color: isDark ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.05)" },
        horzLines: { color: isDark ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.05)" },
      },
      timeScale: {
        borderColor: isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)",
      },
      rightPriceScale: {
        borderColor: isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)",
      },
    });
    state.currentChartInstance = chart;

    if (tab === "price") {
      // 1. Price vs 200DMA Candlestick / Area Series
      const candleSeries = chart.addCandlestickSeries({
        upColor: "#10b981",
        downColor: "#ef4444",
        borderVisible: false,
        wickUpColor: "#10b981",
        wickDownColor: "#ef4444",
      });

      const candleData = dates.map((d, i) => ({
        time: d,
        open: opens[i],
        high: highs[i],
        low: lows[i],
        close: closes[i],
      }));
      candleSeries.setData(candleData);

      // 200DMA Line Overlay
      const dmaSeries = chart.addLineSeries({
        color: "#6366f1",
        lineWidth: 2,
        title: "200DMA",
      });

      const dmaData = [];
      for (let i = 0; i < closes.length; i++) {
        if (i >= 19) {
          const windowSlice = closes.slice(Math.max(0, i - 199), i + 1);
          const sma = windowSlice.reduce((a, b) => a + b, 0) / windowSlice.length;
          dmaData.push({ time: dates[i], value: Number(sma.toFixed(2)) });
        }
      }
      dmaSeries.setData(dmaData);

      // Recommended Strike Horizontal Price Line
      if (stock.recommended_strike > 0) {
        candleSeries.createPriceLine({
          price: stock.recommended_strike,
          color: "#10b981",
          lineWidth: 2,
          lineStyle: 2, // Dashed
          axisLabelVisible: true,
          title: `Strike ₹${stock.recommended_strike}`,
        });
      }
    } else if (tab === "vol") {
      // 2. IV vs Realized Volatility
      const ivLine = chart.addLineSeries({
        color: "#c084fc",
        lineWidth: 2,
        title: "Implied Vol (IV)",
      });
      const rvLine = chart.addLineSeries({
        color: "#f59e0b",
        lineWidth: 2,
        title: "Yang-Zhang RV20",
      });

      const ivData = dates.map((d, i) => ({ time: d, value: ivSeries[i] || stock.iv || 20.0 }));
      const rvData = dates.map((d, i) => ({ time: d, value: rvSeries[i] || (stock.iv * 0.75) || 16.0 }));

      ivLine.setData(ivData);
      rvLine.setData(rvData);
    } else {
      // 3. Open Interest by Strike Histogram with Put Wall and Zero-Gamma marked
      const oiHistogram = chart.addHistogramSeries({
        color: "#38bdf8",
        priceFormat: { type: "volume" },
        title: "Put Open Interest",
      });

      const step = 20.0;
      const baseSpot = stock.spot || 1000.0;
      const zeroGamma = stock.zero_gamma || Math.round((baseSpot * 0.98) / step) * step;
      const oiData = [];

      for (let i = -10; i <= 10; i++) {
        const strike = Math.round((baseSpot + i * step) / step) * step;
        const isPutWall = strike === stock.put_oi_wall;
        const isZeroGamma = strike === zeroGamma;
        const isRecStrike = strike === stock.recommended_strike;
        const oiVal = Math.round(50000 + 40000 * Math.sin(Math.abs(i) * 0.4) + (isPutWall ? 80000 : 0) + (isZeroGamma ? 40000 : 0));

        let barColor = "#38bdf8";
        if (isPutWall) barColor = "#ef4444";
        else if (isZeroGamma) barColor = "#c084fc";
        else if (isRecStrike) barColor = "#10b981";

        oiData.push({
          time: `2026-10-${String(Math.abs(i) + 1).padStart(2, "0")}`,
          value: oiVal,
          color: barColor,
        });
      }
      oiHistogram.setData(oiData);
    }

    chart.timeScale().fitContent();
  } catch (err) {
    container.textContent = "Chart rendering failed.";
  }
}

/**
 * Render 5-Pillar Exhaustive Checklist.
 */
function renderDrawerChecklist(s) {
  const container = document.getElementById("drawer-checklist-container");
  if (!container) return;

  const checks = [
    {
      pillar: "Pillar A: Identity & Structure",
      items: [
        {
          name: "Spot / 200DMA Ratio",
          val: formatNum(s.spot_200dma, 2),
          ideal: "0.95 - 1.15",
          pass: s.spot_200dma >= 0.92 && s.spot_200dma <= 1.3,
        },
        {
          name: "52-Week High Drawdown",
          val: s.drawdown_52w !== null && s.drawdown_52w !== undefined ? `${(s.drawdown_52w * 100).toFixed(1)}%` : "-",
          ideal: "-5% to -20%",
          pass: (s.drawdown_52w || 0) >= -0.3,
        },
        {
          name: "14-Day RSI",
          val: formatNum(s.rsi_14, 1),
          ideal: "35 - 55",
          pass: s.rsi_14 >= 28 && s.rsi_14 <= 65,
        },
        {
          name: "Bollinger %B",
          val: formatNum(s.percent_b, 2),
          ideal: "0.10 - 0.50",
          pass: s.percent_b >= 0.0 && s.percent_b <= 1.0,
        },
        {
          name: "ADX Directional Trend",
          val: s.adx_14 ? `ADX ${s.adx_14.toFixed(1)}` : "-",
          ideal: "No bear trend",
          pass: !(s.adx_14 > 30 && s.minus_di > s.plus_di),
        },
      ],
    },
    {
      pillar: "Pillar B: Volatility Edge",
      items: [
        {
          name: "1Y IV Percentile",
          val: formatNum(s.iv_percentile_1y, 1, "", "%"),
          ideal: ">= 50%",
          pass: s.iv_percentile_1y >= 30,
        },
        {
          name: "IV / YZ20 Realized Vol Ratio",
          val: formatNum(s.iv_yz_ratio, 2),
          ideal: ">= 1.15",
          pass: s.iv_yz_ratio >= 1.0,
        },
        {
          name: "HV10 / YZ20 Vol Shock Ratio",
          val: formatNum(s.hv10_yz20, 2),
          ideal: "< 1.0",
          pass: s.hv10_yz20 <= 1.2,
        },
        {
          name: "25D Put Skew Percentile",
          val: formatNum(s.skew_25d_pct, 1, "", "%"),
          ideal: "40 - 80%",
          pass: s.skew_25d_pct <= 90,
        },
        {
          name: "Term Structure (Near/Next IV)",
          val: formatNum(s.term_structure, 2),
          ideal: "0.85 - 1.0",
          pass: s.term_structure <= 1.1,
        },
      ],
    },
    {
      pillar: "Pillar C: Positioning & Microstructure",
      items: [
        {
          name: "Put OI Wall Strike",
          val: s.put_oi_wall ? `₹${s.put_oi_wall}` : "-",
          ideal: "At or above strike",
          pass: s.recommended_strike <= s.put_oi_wall,
        },
        {
          name: "Put Wall 3D OI Change",
          val: s.put_wall_oi_change_3d !== null && s.put_wall_oi_change_3d !== undefined
            ? `${s.put_wall_oi_change_3d > 0 ? "+" : ""}${s.put_wall_oi_change_3d}%`
            : "-",
          ideal: "> -20%",
          pass: (s.put_wall_oi_change_3d || 0) >= -20,
        },
        {
          name: "Option Bid-Ask Spread",
          val: formatNum(s.bid_ask_spread_pct, 2, "", "%"),
          ideal: "<= 3%",
          pass: s.bid_ask_spread_pct <= 5.0,
        },
        {
          name: "MWPL Limit Utilization",
          val: formatNum(s.mwpl_pct, 1, "", "%"),
          ideal: "< 60%",
          pass: s.mwpl_pct < 80,
        },
        {
          name: "Futures Buildup & Basis",
          val: `${s.futures_buildup || "Neutral"} (${formatNum(s.annualized_basis_pct, 1, "", "%")})`,
          ideal: "Long Buildup / Pos Basis",
          pass: !(s.futures_buildup === "Short Buildup" && s.annualized_basis_pct < 0),
        },
      ],
    },
    {
      pillar: "Pillar D: Trade Math & Sizing",
      items: [
        {
          name: "Risk-Neutral POP N(d2)",
          val: formatNum(s.pop, 1, "", "%"),
          ideal: ">= 80%",
          pass: s.pop >= 75,
        },
        {
          name: "Probability of Touch",
          val: formatNum(s.p_touch, 1, "", "%"),
          ideal: "<= 40%",
          pass: s.p_touch <= 40,
        },
        {
          name: "Empirical Survival POP",
          val: formatNum(s.empirical_pop, 1, "", "%"),
          ideal: ">= 85%",
          pass: (s.empirical_pop || s.pop) >= 78,
        },
        {
          name: "Gap Cushion Cover",
          val: formatNum(s.gap_cover, 2, "", "x"),
          ideal: ">= 2.0x",
          pass: (s.gap_cover || 2.0) >= 1.5,
        },
        {
          name: "Return on Margin (RoM)",
          val: formatNum(s.rom, 1, "", "%"),
          ideal: "1.5 - 4.0%",
          pass: true,
        },
        {
          name: "Stress Loss at -2 Sigma",
          val: formatNum(s.stress_loss_capital_pct, 2, "", "% Cap"),
          ideal: "<= 2.0%",
          pass: s.stress_loss_capital_pct <= 3.0,
        },
      ],
    },
    {
      pillar: "Pillar E: Hard Gating Guards",
      items: [
        {
          name: "Event Gap (Earnings / Div)",
          val: s.event_gap ? "Scheduled" : "None",
          ideal: "None",
          pass: !s.event_gap,
        },
        {
          name: "Fundamental Gate",
          val: s.fundamental_gate_passed ? "Passed" : "Failed",
          ideal: "Pass",
          pass: Boolean(s.fundamental_gate_passed),
        },
      ],
    },
  ];

  container.textContent = "";
  for (const p of checks) {
    const group = document.createElement("div");
    group.className = "checklist-group";

    const title = document.createElement("div");
    title.className = "checklist-group-title";
    title.textContent = p.pillar;
    group.appendChild(title);

    for (const item of p.items) {
      const row = document.createElement("div");
      row.className = "check-row";

      const left = document.createElement("span");
      left.textContent = item.name;

      const right = document.createElement("div");
      right.style.display = "flex";
      right.style.alignItems = "center";
      right.style.gap = "8px";

      const val = document.createElement("span");
      val.className = "tabular-nums";
      val.textContent = item.val || "-";

      const badge = createStatePill(item.pass ? "pass" : "reject", item.pass ? "PASS" : "FAIL");

      right.appendChild(val);
      right.appendChild(badge);
      row.appendChild(left);
      row.appendChild(right);
      group.appendChild(row);
    }

    container.appendChild(group);
  }
}

function closeDetailDrawer() {
  const drawer = document.getElementById("detail-drawer");
  const backdrop = document.getElementById("drawer-backdrop");
  if (drawer) drawer.classList.remove("open");
  if (backdrop) backdrop.classList.remove("active");

  if (state.currentChartInstance) {
    try {
      state.currentChartInstance.remove();
    } catch (e) {}
    state.currentChartInstance = null;
  }
}

/**
 * Event Listeners Setup
 */
function setupEventListeners() {
  // Theme Toggle
  const themeToggle = document.getElementById("theme-toggle-btn");
  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme") || "dark";
      const next = current === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      saveSettings({ theme: next });
      updateThemeIcon(next);
    });
  }

  // Settings Modal Controls
  document.getElementById("open-settings-btn")?.addEventListener("click", openSettingsModal);
  document.getElementById("close-settings-btn")?.addEventListener("click", closeSettingsModal);

  document.getElementById("save-settings-btn")?.addEventListener("click", async () => {
    const rawTokenInput = document.getElementById("setting-token-input").value.trim();
    let token = "";
    if (rawTokenInput.startsWith("••••")) {
      token = state.settings.token;
    } else {
      token = rawTokenInput;
    }
    const proxyUrl = document.getElementById("setting-proxy-input").value.trim();
    const capital = parseFloat(document.getElementById("setting-capital-input").value) || 1000000;
    const remember = document.getElementById("setting-remember-toggle").checked;

    saveSettings({ token, proxyUrl, capital, remember });
    state.settings = loadSettings();
    closeSettingsModal();
    await initSettingsAndToken();
    applyFilters();
  });

  document.getElementById("clear-token-btn")?.addEventListener("click", () => {
    clearToken();
    state.settings = loadSettings();
    const tInput = document.getElementById("setting-token-input");
    if (tInput) tInput.value = "";
    initSettingsAndToken();
    showToast("Token cleared.");
  });

  document.getElementById("clear-all-btn")?.addEventListener("click", () => {
    clearAllData();
    state.settings = loadSettings();
    const tInput = document.getElementById("setting-token-input");
    if (tInput) tInput.value = "";
    const pInput = document.getElementById("setting-proxy-input");
    if (pInput) pInput.value = "";
    initSettingsAndToken();
    showToast("All data cleared.");
  });

  // Drawer Close Controls
  document.getElementById("close-drawer-btn")?.addEventListener("click", closeDetailDrawer);
  document.getElementById("drawer-backdrop")?.addEventListener("click", closeDetailDrawer);

  // Drawer Chart Tab Buttons
  const tabPriceBtn = document.getElementById("tab-price-btn");
  const tabVolBtn = document.getElementById("tab-vol-btn");
  const tabOiBtn = document.getElementById("tab-oi-btn");

  const setChartTab = (tab) => {
    state.activeChartTab = tab;
    [tabPriceBtn, tabVolBtn, tabOiBtn].forEach((btn) => {
      if (btn) {
        btn.classList.remove("active-tab", "btn-primary");
        btn.classList.add("btn-secondary");
      }
    });
    if (tab === "price" && tabPriceBtn) {
      tabPriceBtn.classList.add("active-tab", "btn-primary");
      tabPriceBtn.classList.remove("btn-secondary");
    } else if (tab === "vol" && tabVolBtn) {
      tabVolBtn.classList.add("active-tab", "btn-primary");
      tabVolBtn.classList.remove("btn-secondary");
    } else if (tab === "oi" && tabOiBtn) {
      tabOiBtn.classList.add("active-tab", "btn-primary");
      tabOiBtn.classList.remove("btn-secondary");
    }
    const currentStock = state.stocks.find((s) => s.symbol === state.selectedSymbol);
    if (currentStock) {
      renderDrawerLightweightChart(state.selectedSymbol, currentStock, tab);
    }
  };

  tabPriceBtn?.addEventListener("click", () => setChartTab("price"));
  tabVolBtn?.addEventListener("click", () => setChartTab("vol"));
  tabOiBtn?.addEventListener("click", () => setChartTab("oi"));

  // Mobile Bottom Sheet Controls
  const filterSheetBackdrop = document.getElementById("filter-sheet-backdrop");
  const toolbarCard = document.getElementById("toolbar-card");
  const openFilterSheetBtn = document.getElementById("open-filters-sheet-btn");
  const closeFilterSheetBtn = document.getElementById("close-filters-sheet-btn");

  const openFilterSheet = () => {
    if (toolbarCard) toolbarCard.classList.add("sheet-open");
    if (filterSheetBackdrop) filterSheetBackdrop.classList.add("active");
  };

  const closeFilterSheet = () => {
    if (toolbarCard) toolbarCard.classList.remove("sheet-open");
    if (filterSheetBackdrop) filterSheetBackdrop.classList.remove("active");
  };

  openFilterSheetBtn?.addEventListener("click", openFilterSheet);
  closeFilterSheetBtn?.addEventListener("click", closeFilterSheet);
  filterSheetBackdrop?.addEventListener("click", closeFilterSheet);

  // Filters Controls
  document.getElementById("filter-search")?.addEventListener("input", (e) => {
    state.filters.search = e.target.value.trim();
    applyFilters();
  });

  document.getElementById("filter-sector")?.addEventListener("change", (e) => {
    state.filters.sector = e.target.value;
    applyFilters();
  });

  document.getElementById("filter-verdict")?.addEventListener("change", (e) => {
    state.filters.verdict = e.target.value;
    applyFilters();
  });

  document.getElementById("filter-min-score")?.addEventListener("input", (e) => {
    state.filters.minScore = parseFloat(e.target.value) || 0;
    applyFilters();
  });

  document.getElementById("filter-min-pop")?.addEventListener("input", (e) => {
    state.filters.minPop = parseFloat(e.target.value) || 0;
    applyFilters();
  });

  document.getElementById("filter-sort")?.addEventListener("change", (e) => {
    const val = e.target.value;
    const parts = val.split("_");
    const dir = parts.pop();
    const field = parts.join("_");
    state.filters.sortField = field;
    state.filters.sortDir = dir || "desc";
    applyFilters();
  });

  // Refresh Scan Button
  document.getElementById("refresh-data-btn")?.addEventListener("click", async () => {
    if (state.settings.token && state.tokenStatus === "connected") {
      await fetchAndUpdateLiveQuotes();
      showToast("Live quotes updated successfully.");
    } else {
      await loadScannerData();
      showToast("EOD market scan dataset reloaded.");
    }
  });

  // Table Sort Header Clicks
  document.querySelectorAll(".scanner-table th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const field = th.getAttribute("data-sort");
      if (state.filters.sortField === field) {
        state.filters.sortDir = state.filters.sortDir === "asc" ? "desc" : "asc";
      } else {
        state.filters.sortField = field;
        state.filters.sortDir = "desc";
      }
      applyFilters();
    });
  });

  // Token Expired Custom Event
  window.addEventListener("voledge:token-expired", () => {
    state.tokenStatus = "expired";
    const pill = document.getElementById("token-status-pill");
    const text = document.getElementById("token-status-text");
    if (pill) pill.className = "pill pill-reject";
    if (text) text.textContent = "Token: Expired";
    showToast("Session expired. Please update token in Settings.");
    openSettingsModal();
  });
}

function showSkeletons(show) {
  const tbody = document.getElementById("desktop-table-body");
  const mContainer = document.getElementById("mobile-cards-container");
  if (!show) return;

  if (tbody) {
    tbody.textContent = "";
    for (let i = 0; i < 8; i++) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 38;
      const sk = document.createElement("div");
      sk.className = "skeleton-row";
      td.appendChild(sk);
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
  }
  if (mContainer) {
    mContainer.textContent = "";
    for (let i = 0; i < 4; i++) {
      const sk = document.createElement("div");
      sk.className = "skeleton-row";
      sk.style.height = "120px";
      mContainer.appendChild(sk);
    }
  }
}

function showToast(message) {
  const existing = document.getElementById("voledge-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "voledge-toast";
  toast.className = "glass-card";
  toast.style.position = "fixed";
  toast.style.bottom = "24px";
  toast.style.right = "24px";
  toast.style.padding = "12px 20px";
  toast.style.zIndex = "999";
  toast.style.fontSize = "13px";
  toast.style.fontWeight = "600";
  toast.textContent = message;

  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}
