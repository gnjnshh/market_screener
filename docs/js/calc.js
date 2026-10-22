/**
 * Quantitative options calculation engine for VolEdge India (JavaScript ES Module).
 * Cross-language parity with scanner/trade_math.py and scanner/scoring.py.
 */

export const RISK_FREE_RATE = 0.065;
export const DEFAULT_CAPITAL = 1000000.0;

export const SCORING_WEIGHTS = {
  empirical_rn_pop: 25.0,
  vrp_iv_pct: 20.0,
  gap_cover_stress: 15.0,
  put_wall_buildup: 15.0,
  structure: 15.0,
  liquidity: 10.0,
};

export const KNOWN_STRIKE_INTERVALS = {
  NIFTY: 50.0,
  BANKNIFTY: 100.0,
  FINNIFTY: 50.0,
  MIDCPNIFTY: 25.0,
  RELIANCE: 20.0,
  TCS: 50.0,
  INFY: 20.0,
  HDFCBANK: 10.0,
  ICICIBANK: 10.0,
  SBIN: 5.0,
  BHARTIARTL: 10.0,
  ITC: 5.0,
  KOTAKBANK: 20.0,
  LT: 50.0,
  HINDUNILVR: 20.0,
  AXISBANK: 10.0,
  BAJFINANCE: 50.0,
  MARUTI: 100.0,
  ASIANPAINT: 20.0,
  TATAMOTORS: 10.0,
  SUNPHARMA: 10.0,
  TITAN: 20.0,
  WIPRO: 5.0,
  HCLTECH: 20.0,
  NTPC: 2.5,
  POWERGRID: 2.5,
  ONGC: 2.5,
  COALINDIA: 2.5,
  TATASTEEL: 2.5,
  JSWSTEEL: 10.0,
  HINDALCO: 10.0,
  ADANIENT: 50.0,
  ADANIPORTS: 10.0,
  BAJAJFINSV: 20.0,
  ULTRACEMCO: 100.0,
  GRASIM: 20.0,
  CIPLA: 10.0,
  DRREDDY: 50.0,
  DIVISLAB: 50.0,
  APOLLOHOSP: 50.0,
  EICHERMOT: 50.0,
  BPCL: 5.0,
  HEROMOTOCO: 50.0,
  BRITANNIA: 50.0,
  TECHM: 20.0,
  INDUSINDBK: 10.0,
  "M&M": 20.0,
  SHRIRAMFIN: 20.0,
  CHOLAFIN: 10.0,
};

export function getStrikeInterval(symbol = "", spot = 0.0) {
  const sym = symbol.toUpperCase();
  if (KNOWN_STRIKE_INTERVALS[sym]) {
    return KNOWN_STRIKE_INTERVALS[sym];
  }
  if (spot < 150) return 2.5;
  if (spot < 350) return 5.0;
  if (spot < 750) return 10.0;
  if (spot < 1500) return 20.0;
  if (spot < 4000) return 50.0;
  return 100.0;
}

/**
 * High-precision error function erf(x) (Abramowitz & Stegun 7.1.26).
 */
export function erf(x) {
  const sign = x >= 0 ? 1 : -1;
  const absX = Math.abs(x);
  const p = 0.3275911;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;

  const t = 1.0 / (1.0 + p * absX);
  const poly = ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t;
  return sign * (1.0 - poly * Math.exp(-absX * absX));
}

/**
 * Standard Normal Cumulative Distribution Function N(x).
 */
export function normCdf(x) {
  return 0.5 * (1.0 + erf(x / Math.SQRT2));
}

/**
 * Black-Scholes European put option price.
 */
export function blackScholesPutPrice(spot, strike, dte, volatility, rate = RISK_FREE_RATE, dividendYield = 0.0) {
  if (spot <= 0 || strike <= 0 || volatility <= 0 || dte <= 0) {
    return Math.max(0.0, strike - spot);
  }
  const t = dte / 365.0;
  const volSqrtT = volatility * Math.sqrt(t);
  const d1 = (Math.log(spot / strike) + (rate - dividendYield + 0.5 * volatility * volatility) * t) / volSqrtT;
  const d2 = d1 - volSqrtT;

  const putPrice = strike * Math.exp(-rate * t) * normCdf(-d2) - spot * Math.exp(-dividendYield * t) * normCdf(-d1);
  return Math.max(0.0, putPrice);
}

/**
 * Probability of Expiring Worthless (POP): N(d2).
 */
export function calculatePop(spot, strike, dte, volatility, rate = RISK_FREE_RATE, dividendYield = 0.0) {
  if (spot <= 0 || strike <= 0 || dte <= 0) {
    return spot >= strike ? 100.0 : 0.0;
  }
  if (volatility <= 0) {
    return spot >= strike ? 100.0 : 0.0;
  }
  const t = dte / 365.0;
  const volSqrtT = volatility * Math.sqrt(t);
  const d1 = (Math.log(spot / strike) + (rate - dividendYield + 0.5 * volatility * volatility) * t) / volSqrtT;
  const d2 = d1 - volSqrtT;
  const pop = normCdf(d2) * 100.0;
  return Number(pop.toFixed(2));
}

/**
 * Probability of Touch: 2 * (1 - POP).
 */
export function calculatePTouch(pop) {
  const pt = 2.0 * (100.0 - pop);
  return Number(Math.max(0.0, Math.min(100.0, pt)).toFixed(2));
}

/**
 * 1-SD Expected Move: S * sigma * sqrt(T).
 */
export function calculateExpectedMove(spot, volatility, dte) {
  if (spot <= 0 || volatility <= 0 || dte <= 0) return 0.0;
  const t = dte / 365.0;
  const em = spot * volatility * Math.sqrt(t);
  return Number(em.toFixed(2));
}

/**
 * Recommended strike calculation with downward interval snapping and put wall cap.
 */
export function calculateRecommendedStrike(spot, volatility, dte, putWall = 0.0, symbol = "", interval = null) {
  if (spot <= 0) return 0.0;

  const t = Math.max(dte, 1.0) / 365.0;
  const effectiveVol = Math.max(volatility, 0.05);
  const rawTarget = spot * Math.exp(-1.25 * effectiveVol * Math.sqrt(t));

  const target = putWall > 0 ? Math.min(putWall, rawTarget) : rawTarget;
  const step = interval && interval > 0 ? interval : getStrikeInterval(symbol, spot);

  let snapped = Math.floor(target / step) * step;

  if (snapped >= spot) {
    snapped = Math.floor((spot - 1e-4) / step) * step;
  }

  if (putWall > 0 && snapped > putWall) {
    snapped = Math.floor(putWall / step) * step;
  }

  return Number(snapped.toFixed(2));
}

export function calculateCredit(premium, lotSize) {
  return Number((Math.max(0.0, premium) * lotSize).toFixed(2));
}

export function calculateRom(credit, margin) {
  if (!margin || margin <= 0) return null;
  return Number(((credit / margin) * 100.0).toFixed(2));
}

export function calculateEv(pop, credit, spot, strike, dte, volatility, lotSize) {
  if (credit <= 0 || spot <= 0 || strike <= 0 || dte <= 0) return 0.0;
  const modelPut = blackScholesPutPrice(spot, strike, dte, volatility);
  const ev = credit - modelPut * lotSize;
  return Number(ev.toFixed(2));
}

export function calculateStressLoss(spot, strike, dte, volatility, lotSize, capital = DEFAULT_CAPITAL, entryPremium = 0.0) {
  if (spot <= 0 || strike <= 0 || dte <= 0 || volatility <= 0) {
    return { stress_loss_inr: 0.0, stress_loss_capital_pct: 0.0 };
  }
  const sigma1d = volatility * Math.sqrt(1.0 / 252.0);
  const stressSpot = spot * Math.max(0.5, 1.0 - 2.0 * sigma1d);
  const stressVol = volatility + 0.1;
  const stressDte = Math.max(dte - 1.0, 0.1);

  const stressedPut = blackScholesPutPrice(stressSpot, strike, stressDte, stressVol);
  const currentPut = entryPremium > 0 ? entryPremium : blackScholesPutPrice(spot, strike, dte, volatility);

  const lossPerShare = Math.max(0.0, stressedPut - currentPut);
  const totalLoss = lossPerShare * lotSize;
  const capPct = (totalLoss / Math.max(capital, 1.0)) * 100.0;

  return {
    stress_loss_inr: Number(totalLoss.toFixed(2)),
    stress_loss_capital_pct: Number(capPct.toFixed(2)),
  };
}

export function calculateScore(d) {
  let total = 0.0;

  // 1. POP (25 pts)
  const pop = d.pop ?? 75.0;
  const rnPts = Math.max(0.0, Math.min(12.5, ((pop - 75.0) / 15.0) * 12.5));
  const empPop = d.empirical_pop ?? 78.0;
  const empPts = Math.max(0.0, Math.min(12.5, ((empPop - 78.0) / 14.0) * 12.5));
  total += rnPts + empPts;

  // 2. VRP (20 pts)
  const ivYz = d.iv_yz_ratio ?? 1.0;
  const vrpPts = Math.max(0.0, Math.min(10.0, ((ivYz - 1.0) / 0.3) * 10.0));
  const ivPct = d.iv_percentile_1y ?? 30.0;
  const ivpPts = Math.max(0.0, Math.min(10.0, ((ivPct - 30.0) / 50.0) * 10.0));
  total += vrpPts + ivpPts;

  // 3. Gap Cover & Stress (15 pts)
  const gc = d.gap_cover ?? 1.5;
  const gcPts = Math.max(0.0, Math.min(7.5, ((gc - 1.5) / 1.5) * 7.5));
  const stress = d.stress_loss_capital_pct ?? 3.0;
  const stressPts = Math.max(0.0, Math.min(7.5, ((3.0 - stress) / 2.0) * 7.5));
  total += gcPts + stressPts;

  // 4. Put wall + buildup (15 pts)
  const oiChg = d.put_wall_oi_change_3d ?? 0.0;
  const oiPts = Math.max(0.0, Math.min(7.5, ((oiChg - -20.0) / 35.0) * 7.5));
  let fbPts = 4.0;
  const bld = d.futures_buildup ?? "Neutral";
  const basis = d.annualized_basis_pct ?? 0.0;
  if (bld === "Long Buildup" && basis >= 0.0) fbPts = 7.5;
  else if (bld === "Short Covering") fbPts = 5.5;
  else if (bld === "Neutral") fbPts = 4.0;
  else if (bld === "Long Unwinding") fbPts = 2.5;
  else fbPts = 0.0;
  total += oiPts + fbPts;

  // 5. Structure (15 pts)
  const s200 = d.spot_200dma ?? 1.0;
  let s200Pts = 2.5;
  if (s200 >= 0.95 && s200 <= 1.15) s200Pts = 5.0;
  else if (s200 >= 0.92 && s200 < 0.95) s200Pts = ((s200 - 0.92) / 0.03) * 5.0;
  else if (s200 > 1.15 && s200 <= 1.3) s200Pts = ((1.3 - s200) / 0.15) * 5.0;
  else s200Pts = 0.0;

  const dd = d.drawdown_52w ?? -0.1;
  let ddPts = 2.5;
  if (dd >= -0.2 && dd <= -0.05) ddPts = 5.0;
  else if (dd >= -0.3 && dd < -0.2) ddPts = ((dd - -0.3) / 0.1) * 5.0;
  else if (dd > -0.05 && dd <= 0.0) ddPts = 4.0;
  else ddPts = 0.0;

  const rsi = d.rsi_14 ?? 45.0;
  let rsiPts = 2.5;
  if (rsi >= 35.0 && rsi <= 55.0) rsiPts = 2.5;
  else if (rsi >= 28.0 && rsi < 35.0) rsiPts = ((rsi - 28.0) / 7.0) * 2.5;
  else if (rsi > 55.0 && rsi <= 65.0) rsiPts = ((65.0 - rsi) / 10.0) * 2.5;
  else rsiPts = 0.0;

  const pctB = d.percent_b ?? 0.3;
  let bPts = 2.5;
  if (pctB >= 0.1 && pctB <= 0.5) bPts = 2.5;
  else if (pctB >= 0.0 && pctB < 0.1) bPts = (pctB / 0.1) * 2.5;
  else if (pctB > 0.5 && pctB <= 1.0) bPts = ((1.0 - pctB) / 0.5) * 2.5;
  else bPts = 0.0;

  total += s200Pts + ddPts + rsiPts + bPts;

  // 6. Liquidity (10 pts)
  const spread = d.bid_ask_spread_pct ?? 2.0;
  const spreadPts = Math.max(0.0, Math.min(5.0, ((5.0 - spread) / 4.0) * 5.0));
  const mwpl = d.mwpl_pct ?? 50.0;
  const mwplPts = Math.max(0.0, Math.min(5.0, ((80.0 - mwpl) / 40.0) * 5.0));
  total += spreadPts + mwplPts;

  return Number(Math.max(0.0, Math.min(100.0, total)).toFixed(1));
}

export function determineVerdict(d, score) {
  const failed = [];

  // Guards
  if (d.spot_200dma !== undefined && d.spot_200dma !== null) {
    if (d.spot_200dma < 0.92) failed.push(`Spot/200DMA is ${d.spot_200dma.toFixed(2)} (below 0.92 floor)`);
    else if (d.spot_200dma > 1.3) failed.push(`Spot/200DMA is ${d.spot_200dma.toFixed(2)} (overextended above 1.30)`);
  }
  if (d.drawdown_52w !== undefined && d.drawdown_52w !== null && d.drawdown_52w < -0.3) {
    failed.push(`52W Drawdown is ${(d.drawdown_52w * 100).toFixed(1)}% (severe breakdown beyond -30%)`);
  }
  if (d.rsi_14 !== undefined && d.rsi_14 !== null) {
    if (d.rsi_14 < 28.0) failed.push(`RSI(14) is ${d.rsi_14.toFixed(1)} (falling knife below 28.0)`);
    else if (d.rsi_14 > 65.0) failed.push(`RSI(14) is ${d.rsi_14.toFixed(1)} (overbought above 65.0)`);
  }
  if (d.adx_14 !== undefined && d.plus_di !== undefined && d.minus_di !== undefined) {
    if (d.adx_14 > 30.0 && d.minus_di > d.plus_di) {
      failed.push(`ADX is ${d.adx_14.toFixed(1)} with -DI (${d.minus_di.toFixed(1)}) > +DI (${d.plus_di.toFixed(1)}) (active bear trend)`);
    }
  }
  if (d.downvol_ratio_20d !== undefined && d.downvol_ratio_20d > 1.3 && d.rising_delivery) {
    failed.push(`DownVol ratio is ${d.downvol_ratio_20d.toFixed(2)} with rising delivery volume`);
  }
  if (d.iv_percentile_1y !== undefined && d.iv_percentile_1y < 30.0) {
    failed.push(`1Y IV Percentile is ${d.iv_percentile_1y.toFixed(1)}% (below 30% edge threshold)`);
  }
  if (d.iv_yz_ratio !== undefined && d.iv_yz_ratio < 1.0) {
    failed.push(`IV/YZ20 ratio is ${d.iv_yz_ratio.toFixed(2)} (negative VRP below 1.0)`);
  }
  if (d.hv10_yz20 !== undefined && d.hv10_yz20 > 1.2) {
    failed.push(`HV10/YZ20 ratio is ${d.hv10_yz20.toFixed(2)} (short-term volatility shock above 1.2)`);
  }
  if (d.skew_25d_pct !== undefined && d.skew_25d_pct > 90.0) {
    failed.push(`25D Put Skew percentile is ${d.skew_25d_pct.toFixed(1)}% (extreme downside panic)`);
  }
  if (d.term_structure !== undefined && d.term_structure > 1.1) {
    failed.push(`Term Structure is ${d.term_structure.toFixed(2)} (backwardation above 1.10)`);
  }
  if (d.put_wall_oi_change_3d !== undefined && d.put_wall_oi_change_3d < -20.0) {
    failed.push(`Put Wall OI collapsed by ${Math.abs(d.put_wall_oi_change_3d).toFixed(1)}% over 3 days`);
  }
  if (d.bid_ask_spread_pct !== undefined && d.bid_ask_spread_pct > 5.0) {
    failed.push(`Option bid-ask spread is ${d.bid_ask_spread_pct.toFixed(2)}% (illiquid, above 5%)`);
  }
  if (d.mwpl_pct !== undefined && d.mwpl_pct >= 80.0) {
    failed.push(`MWPL utilization is ${d.mwpl_pct.toFixed(1)}% (danger of F&O ban)`);
  }
  if (d.futures_buildup === "Short Buildup" && d.annualized_basis_pct !== undefined && d.annualized_basis_pct < 0.0) {
    failed.push("Futures show Short Buildup with negative annualized basis");
  }
  if (d.pop !== undefined && d.pop < 75.0) {
    failed.push(`Risk-neutral POP is ${d.pop.toFixed(1)}% (below 75% minimum)`);
  }
  if (d.empirical_pop !== undefined && d.empirical_pop < 78.0) {
    failed.push(`Empirical POP is ${d.empirical_pop.toFixed(1)}% (below 78% historical threshold)`);
  }
  if (d.gap_cover !== undefined && d.gap_cover < 1.5) {
    failed.push(`Gap Cover is ${d.gap_cover.toFixed(2)}x (cushion fails 1.5x 5th-pct overnight gap)`);
  }
  if (d.stress_loss_capital_pct !== undefined && d.stress_loss_capital_pct > 3.0) {
    failed.push(`Stress loss is ${d.stress_loss_capital_pct.toFixed(2)}% of capital (exceeds 3.0% maximum risk)`);
  }
  if (d.event_gap) {
    failed.push("Corporate earnings, dividend, or board meeting scheduled prior to expiry");
  }
  if (d.fundamental_gate_passed === false) {
    if (d.fundamental_reasons && d.fundamental_reasons.length > 0) {
      failed.push(...d.fundamental_reasons);
    } else {
      failed.push("Failed fundamental quality gate");
    }
  }

  if (failed.length > 0) {
    return { verdict: "REJECTED", failed_checks: failed };
  }

  if (score >= 72.0) {
    return { verdict: "QUALIFIED", failed_checks: [] };
  } else if (score >= 60.0) {
    return { verdict: "WATCH", failed_checks: ["Score is in watchlist zone (60-71)"] };
  } else {
    return { verdict: "REJECTED", failed_checks: [`Composite score (${score.toFixed(1)}) is below 60.0 threshold`] };
  }
}
