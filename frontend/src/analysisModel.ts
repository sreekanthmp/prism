import { n1, n2, fmtT } from "./format";
import type { RegimeCheck, Setup, Structure } from "./types";

// What the Analysis tab says, as plain data and word tables. The wording is the current dashboard's (app/static/index.html), carried over word for word: the React tab is proven to say the same thing in
// every pinned state (tests/test_analysis_browser.py). Nothing here is calculated from the market: every number and every verdict is the backend's.

export const TF_ORDER = ["1h", "15m", "5m", "1m"] as const;
export const TFS = ["1m", "5m", "15m", "1h"] as const; // the order the live candles are listed in
export const PATTERN: Record<string, string> = { HH_HL: "higher highs, higher lows", LH_LL: "lower highs, lower lows", mixed: "mixed swings", insufficient: "not enough swings" };
export const SIDE_LONG: Record<string, string> = { CE: "CE (call)", PE: "PE (put)" };
export const STATUS_CLS: Record<string, string> = { fresh: "up", stale: "down", "no data": "down", "market closed": "mut" };

/** The sections that are open when the page opens: what the decision is made of, then the tables read less often. The reader's own choice is kept after that. */
export const DEFAULT_OPEN: readonly string[] = ["a-strat", "a-tech", "a-struct", "a-levels", "a-setups", "a-health"];

export const STAGE_MARK: Record<string, [string, string]> = { done: ["✓", "up"], active: ["…", "flat"], retrying: ["↻", "flat"], pending: ["○", "neu"], failed: ["✗", "down"], warn: ["!", "flat"] };
/** A duration in seconds as the page says it: seconds, then minutes, then hours. */
export const dur = (sec: number | null | undefined): string => (sec == null ? "–" : sec < 120 ? sec.toFixed(0) + " s" : sec < 7200 ? (sec / 60).toFixed(0) + " min" : (sec / 3600).toFixed(1) + " h");

// -- the regime facts, with the checks each was made from ----------------------------------------------------------------------------------------------
export const FACT_NAME: Record<string, string> = {
  strong_trend: "Strong trend", weakening_trend: "Weakening trend", compression: "Compression", volatility_expansion: "Volatility expansion", extended: "Extended market", pause: "Range / pause / pullback / breakout",
}; // fmt: skip
export const FACT_CLS: Record<string, string> = { bullish: "up", bearish: "down", up: "up", down: "down", yes: "flat", breakout: "flat", range_bound: "flat", trend_pause: "flat", pullback: "flat" };
/** A check: ✓ holds, ✗ does not, ? could not be judged; a check that is only reported is muted. */
export function checkMark(c: RegimeCheck): { mark: string; klass: string } {
  const g: [string, string] = c.ok === true ? ["✓", "up"] : c.ok === false ? ["✗", "flat"] : ["?", "mut"];
  return { mark: g[0], klass: c.info ? "mut" : g[1] };
}

// -- the structure behind a counter-trend permission, in real prices. The record uses the bullish view's names; for a PE (a bullish trend exhausting) they read the other way up. -------------
const STRUCT_LABELS: Record<string, [string, string][]> = {
  CE: [["exhaustion_extreme", "exhaustion low"], ["higher_low", "15M higher low"], ["lower_high", "lower high before it"], ["higher_high", "15M higher high"], ["prior_high", "prior high"]],
  PE: [["exhaustion_extreme", "exhaustion high"], ["higher_low", "15M lower high"], ["lower_high", "higher low before it"], ["higher_high", "15M lower low"], ["prior_high", "prior low"]],
}; // fmt: skip
export function structureLine(st: Structure, side: string): string {
  const labels = STRUCT_LABELS[side] ?? (STRUCT_LABELS.CE as [string, string][]);
  return `${labels.map(([k, name]) => `${name} ${n2(st[k])}`).join(" · ")} · leg ${n1(st.leg)} pts · confirmed ${fmtT(st.confirmed_at, false)}`;
}

export const PERMISSION_GROUPS: [string, string][] = [
  ["established", "1. an established trend (or an extension)"],
  ["weakening", "2. the continuation is weakening"],
  ["structure", "3. a confirmed 15M structural change"],
];

/** The latest swing of one kind (H or L) from a timeframe's recent swings. */
export const lastSwing = (swings: { start: number; kind: string; price: number }[], kind: string) => [...swings].reverse().find((x) => x.kind === kind);

/** The words under a setup's live state on the strategy's own page. */
export function liveWords(x: Setup, stale: boolean): { klass: string; text: string } | null {
  if (stale) return { klass: "flat", text: "last known (STALE): not actionable" };
  if (x.stage === "READY_TO_ACT") return { klass: "up", text: "actionable now" };
  if (x.stage === "BLOCKED") return { klass: "flat", text: "not actionable: see the blockers" };
  if (x.status === "CONFIRMED") return { klass: "flat", text: "not actionable: " + ((x.price_state ?? "").replace(/_/g, " ") || "conditions") };
  return null;
}
