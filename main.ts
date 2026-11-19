// GTA VI trophy earn-rate forecast, make.fun gta6-trophy-rarity-forecast-01.
//
// TypeScript, Node 22, stdlib only: run as `node main.ts`.  Reads every
// input/*.in (MAKEFUN_INPUT_DIR, default /input) and writes out/<id>.out
// (MAKEFUN_OUTPUT_DIR, default /output) as {"trophies":[{"id":n,"q":[...]}]}.
//
// Physics: Exophase refreshes dilute rates by growing players_tracked while
// earned counts stay fixed.  On the logit scale a future rate is
//
//     logit(rate_target) = logit(rate_last) - b * ln(G)
//
// with b ~ 1 for rare trophies (pure dilution) and a partial repayment for
// common ones (new tracked players earn some trophies too).  ln(G), the growth
// of ln(players_tracked) over the horizon, is extrapolated from the history's
// refresh plateaus with a damped exponential (tau ~ 3 days); a flat launch
// night falls back to a pending-first-refresh prior (median x5, log-sd 0.55)
// with pure dilution.  Quantiles are read off a normal on the logit scale.

import * as fs from "node:fs";
import * as path from "node:path";

const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
const Z = [-1.645, -0.674, 0.0, 0.674, 1.645];
const DAY = 86400.0;

// Priors and spreads.
const PENDING_LN_G = Math.log(5.0); // pending first refresh: median x5
const PENDING_SIG_G = 0.60; // log-sd of that prior
const TAU_DAYS = 3.0; // damping time constant of tracked-player growth
const SIG_RW = 0.35; // logit random-walk spread per sqrt(day)
const SIG_LAG = 0.35; // page lags the target by a refresh slot or two
const SIG_B = 0.90; // multiplicative uncertainty on fitted growth, per ln(G)
const B_WEEK = 1.0; // fraction of dilution still standing at the horizon
const REPAY_MAX = 0.10; // dilution repaid by new earners on a common trophy
const REPAY_LO = 0.005; // repayment ramps in between these shares...
const REPAY_HI = 0.6; // ...of players
const GRAN = 0.3; // earned-count granularity, logit sd per sqrt(count)

type HistEntry = {
  at: string;
  players_tracked?: number;
  rates?: (number | null)[];
  [k: string]: unknown;
};

function clampPct(x: number): number {
  return Math.min(99.99, Math.max(0.01, x));
}

function logit(pct: number): number {
  const p = clampPct(pct);
  return Math.log(p / (100.0 - p));
}

function invLogit(x: number): number {
  if (x >= 40.0) return 100.0;
  if (x <= -40.0) return 0.0;
  return 100.0 / (1.0 + Math.exp(-x));
}

function parseTs(s: string): number {
  s = s.trim();
  if (s.endsWith("Z")) s = s.slice(0, -1);
  let frac = 0.0;
  if (s.includes(".")) {
    const i = s.indexOf(".");
    frac = parseFloat("0." + s.slice(i + 1));
    s = s.slice(0, i);
  }
  // Naive datetime is UTC; force the Z so Date.parse treats it as UTC.
  return Date.parse(s + "Z") / 1000.0 + frac;
}

function plateaus(history: HistEntry[]): HistEntry[] {
  const out: HistEntry[] = [];
  let key: string | null = null;
  for (const h of history) {
    const k = JSON.stringify([h.players_tracked, h.rates ?? []]);
    if (k !== key) {
      out.push(h);
      key = k;
    } else {
      out[out.length - 1] = h;
    }
  }
  return out;
}

function fitLine(points: [number, number][]): [number, number, number] {
  const n = points.length;
  let mx = 0.0;
  let my = 0.0;
  for (const p of points) {
    mx += p[0];
    my += p[1];
  }
  mx /= n;
  my /= n;
  let sxx = 0.0;
  for (const p of points) sxx += (p[0] - mx) ** 2;
  if (sxx <= 0) return [0.0, my, 0.0];
  let slope = 0.0;
  for (const p of points) slope += (p[0] - mx) * (p[1] - my);
  slope /= sxx;
  let resid = 0.0;
  if (n > 2) {
    let ss = 0.0;
    for (const p of points) {
      const e = p[1] - (my + slope * (p[0] - mx));
      ss += e * e;
    }
    resid = Math.sqrt(ss / (n - 2));
  }
  return [slope, my, resid];
}

function growth(
  history: HistEntry[],
  horizonDays: number
): [number, number, boolean] {
  const pts: [number, number][] = [];
  for (const h of plateaus(history)) {
    const p = h.players_tracked;
    if (p && p > 0) pts.push([parseTs(h.at), Math.log(p)]);
  }
  if (pts.length >= 2 && pts[pts.length - 1][1] - pts[0][1] >= 0.02) {
    const tEnd = pts[pts.length - 1][0];
    let window = pts.filter((q) => tEnd - q[0] <= 1.5 * DAY);
    if (window.length < 3) window = pts.length > 10 ? pts.slice(-10) : pts;
    const [slope, , resid] = fitLine(window);
    const gDay = Math.max(0.0, slope * DAY);
    const h = Math.max(horizonDays, 1e-4);
    let lnG = gDay * TAU_DAYS * (1.0 - Math.exp(-h / TAU_DAYS));
    lnG = Math.min(lnG, Math.log(200.0));
    const sig = Math.sqrt(
      SIG_RW ** 2 * horizonDays + resid ** 2 + 0.25 ** 2
    );
    return [lnG, sig, true];
  }
  const scale = Math.min(1.0, horizonDays / 0.0625);
  return [
    PENDING_LN_G * scale,
    PENDING_SIG_G + 0.15 * Math.sqrt(Math.max(scale, 0.0)),
    false,
  ];
}

function round4(x: number): number {
  const scaled = x * 10000.0;
  let whole = Math.floor(scaled);
  if (scaled - whole >= 0.5) whole += 1;
  return whole / 10000.0;
}

function forecastRows(c: {
  history: HistEntry[];
  horizon_minutes: number;
  trophies: { id: number }[];
}): number[][] {
  const history = c.history;
  const last = history[history.length - 1];
  const players = last.players_tracked || 1;
  const horizonDays = Number(c.horizon_minutes) / 1440.0;
  const [lnG, sigG, isTrend] = growth(history, horizonDays);
  const sigmaG = Math.sqrt(sigG ** 2 + (isTrend ? (SIG_B * lnG) ** 2 : 0.0));
  const rows: number[][] = [];
  for (let idx = 0; idx < c.trophies.length; idx++) {
    const rates = last.rates ?? [];
    const rate = idx < rates.length ? rates[idx] : null;
    if (rate === null || rate === undefined) {
      rows.push([0.01, 0.01, 0.01, 0.02, 0.06]);
      continue;
    }
    if (rate >= 99.995) {
      rows.push([99.5, 99.9, 100.0, 100.0, 100.0]);
      continue;
    }
    if (rate <= 0.0) {
      rows.push([0.01, 0.01, 0.01, 0.02, 0.05]);
      continue;
    }
    const frac = rate / 100.0;
    const repay =
      REPAY_MAX *
      Math.min(1.0, Math.max(0.0, (frac - REPAY_LO) / (REPAY_HI - REPAY_LO)));
    const b = B_WEEK * (1.0 - repay);
    const centre = logit(rate) - b * lnG;
    const count = Math.max(frac * players, 0.5);
    const gran = Math.min(0.4, GRAN / Math.sqrt(count));
    const sigma = Math.sqrt(sigmaG ** 2 + SIG_LAG ** 2 + gran ** 2);
    rows.push(Z.map((z) => clampPct(invLogit(centre + z * sigma))));
  }
  return rows;
}

function forecastCase(c: any, name: string): { trophies: { id: number; q: number[] }[] } {
  if (JSON.stringify(c.levels) !== JSON.stringify(LEVELS)) {
    throw new Error(`${name}: unexpected levels ${JSON.stringify(c.levels)}`);
  }
  if (!c.history || c.history.length === 0) {
    throw new Error(`${name}: empty history`);
  }
  const rows = forecastRows(c);
  return {
    trophies: c.trophies.map((trophy: { id: number }, i: number) => ({
      id: trophy.id,
      q: rows[i].map(round4),
    })),
  };
}

function main(): void {
  const inputDir = process.env.MAKEFUN_INPUT_DIR || "/input";
  const outputDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
  fs.mkdirSync(outputDir, { recursive: true });
  const files = fs
    .readdirSync(inputDir)
    .filter((f) => f.endsWith(".in"))
    .sort();
  for (const f of files) {
    const caseObj = JSON.parse(fs.readFileSync(path.join(inputDir, f), "utf-8"));
    const out = forecastCase(caseObj, f);
    const stem = f.slice(0, -3);
    fs.writeFileSync(path.join(outputDir, stem + ".out"), JSON.stringify(out) + "\n");
  }
}

main();
