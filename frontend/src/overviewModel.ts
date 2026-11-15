import { age, n1, n2 } from "./format";
import { contractOffer } from "./optionsModel";
import type { AtrNote, Options, OptionContract, RegimeFact, Setup, StrategyMonitor, Trading } from "./types";

// What the Overview says, worked out as plain data. The rules and the wording are the current dashboard's (app/static/index.html), word for word: the React Overview is proven to say the same
// thing in every pinned state (tests/test_overview_browser.py), so nothing here is a new opinion. Nothing is computed from the market: the setups, their stages and the decision are the backend's.

export const LABEL: Record<string, string> = { "1h": "1H", "15m": "15M", "5m": "5M", "1m": "1M" };
export const cls = (t: string | null | undefined): string => (t === "bullish" ? "up" : t === "bearish" ? "down" : "neu");
export const arrow = (t: string | null | undefined): string => (t === "bullish" ? "▲" : t === "bearish" ? "▼" : "◆");
export const zone = (z: number[] | null | undefined): string => (z && z.length === 2 ? `${n2(z[0])} – ${n2(z[1])}` : "–");
export const AGE = age;

export const ACTION_CLS: Record<string, string> = { "BUY CE": "buy-ce", "BUY PE": "buy-pe", WAIT: "wait", "NO TRADE": "no-trade" };
const STAGE_TXT: Record<string, string> = {
  DETECTED: "detected", WAITING_FOR_CONFIRMATION: "waiting for a confirming candle", BLOCKED: "confirmed, but BLOCKED", CONFIRMED: "confirmed, price not in the entry area",
  READY_TO_ACT: "READY: in the entry area", INVALIDATED: "invalidated", EXPIRED: "expired", MISSED: "missed",
}; // fmt: skip
const STATE_SHORT: Record<string, string> = {
  DETECTED: "detected", WAITING_FOR_CONFIRMATION: "waiting", BLOCKED: "blocked", CONFIRMED: "confirmed", READY_TO_ACT: "ready", INVALIDATED: "invalidated", EXPIRED: "expired", MISSED: "missed",
}; // fmt: skip
export const FRESH_CLS: Record<string, string> = { fresh: "up", stale: "down", unknown: "flat", "no data": "down", "market closed": "mut" };
export const STRUCT: Record<string, string> = { HH_HL: "HH·HL", LH_LL: "LH·LL", mixed: "mixed", insufficient: "–" };

/** A stage in words. On a stale page a setup that was ready is said to have been, not to be. */
export const stageWord = (stage: string, stale: boolean): string => (stale && stage === "READY_TO_ACT" ? "was in the entry area (not current)" : (STAGE_TXT[stage] ?? stage));
export const stateWord = (state: string, stale: boolean): string => (stale && state === "READY_TO_ACT" ? "was ready" : (STATE_SHORT[state] ?? String(state).replace(/_/g, " ").toLowerCase()));

/** The setup the decision is about (or, failing that, the one the explanation is about). */
export function liveSetup(t: Trading): Setup | null {
  const d = t.decision;
  const ex = t.explain;
  return t.setups.find((x) => x.id === d.setup_id) ?? t.setups.find((x) => x.id === ex?.setup) ?? null;
}

export const atrNote = (a: AtrNote | null | undefined): string =>
  a && a.used != null ? n1(a.used) + (a.with_gap != null && Math.abs(a.with_gap - a.used) > 0.05 * a.used ? ` (${n1(a.with_gap)} with the overnight gap)` : "") : "–";

/** A long event description is shown as a short summary with its full text one click away: nothing is cut without a way to read it. */
export function eventConcise(text: string): [string, boolean] {
  const s = String(text).replace(/^[A-Z_]+:\s*/, ""); // the status is already in its own column
  if (s.length <= 110) return [s, false];
  const cut = s.slice(0, 110);
  const i = cut.lastIndexOf(" ");
  return [(i > 70 ? cut.slice(0, i) : cut) + "…", true];
}

// -- the strategy monitor ---------------------------------------------------------------------------------------------------------------------------------
export interface Monitor {
  live: Setup[]; // the decision's setup first
  conflicts: string[];
  idle: StrategyMonitor[];
  watching: number;
}
export function monitor(t: Trading): Monitor {
  const d = t.decision;
  const live = [...t.setups].sort((p, q) => Number(q.id === d.setup_id) - Number(p.id === d.setup_id));
  const strong = live.filter((x) => x.status === "WAITING_FOR_CONFIRMATION" || x.status === "CONFIRMED");
  const conflicts: string[] = [];
  if (new Set(strong.map((x) => x.direction)).size > 1) conflicts.push(`a call and a put setup are both live (${strong.map((x) => x.direction + " " + x.strategy_name).join(", ")}): neither is taken`);
  for (const r of d.against ?? []) if (/^ignored /.test(r)) conflicts.push(r);
  const idle = t.strategies.filter((z) => !(z.setups ?? []).length);
  return { live, conflicts, idle, watching: idle.filter((z) => z.active).length };
}
/** The first thing that blocks entry, or the setup's own stage text: cautions and the rest are under the strategy in Analysis. */
export const whyOf = (x: Setup): string => (x.blockers && x.blockers[0]) || x.stage_text || "";

// -- the six regime facts ---------------------------------------------------------------------------------------------------------------------------------
export const FACT_SHORT: Record<string, string> = {
  strong_trend: "Strong trend", weakening_trend: "Weakening trend", compression: "Compression", volatility_expansion: "Expansion", extended: "Extension", pause: "Range / pause / pullback",
}; // fmt: skip
export const FACT_ORDER = ["strong_trend", "weakening_trend", "compression", "volatility_expansion", "extended", "pause"] as const;
const FACT_CLS: Record<string, string> = { bullish: "up", bearish: "down", up: "up", down: "down", yes: "flat", breakout: "flat", range_bound: "flat", trend_pause: "flat", pullback: "flat" };
export interface FactCell {
  key: string;
  klass: string;
  title: string;
  name: string;
  word: string;
  why: string;
  unknown: boolean;
}
/** One fact as it is: held (named), none (muted), or UNKNOWN (amber, dashed, with the reason). Unknown is never drawn as none, as a negative condition or as a quiet market. */
export function factCell(key: string, f: RegimeFact | null | undefined): FactCell {
  const st = f && f.state ? f.state : "unknown";
  const unknown = st === "unknown";
  const none = st === "none" || st === "no";
  const word = unknown ? "unknown" : none ? "none" : st.replace(/_/g, " ");
  const why = f && f.summary ? f.summary : "no regime data has been received";
  const name = FACT_SHORT[key] ?? key;
  return { key, klass: unknown ? "unk" : none ? "mut" : (FACT_CLS[st] ?? "flat"), title: `${name}: ${word} — ${why}`, name, word, why, unknown };
}

// -- the option contract on offer, and the health of the option feed -------------------------------------------------------------------------------------------
// (the rule that says whether a contract is on offer is shared with the Options tab: optionsModel.ts)
export { contractOffer };

export interface OptionHealth {
  kind: "none" | "closed" | "counts";
  total: number;
  fresh: number;
  stale: number;
  unknown: number;
  noData: number;
  freshClass: string;
  selected: OptionContract | null;
}
export function optionHealth(o: Options | undefined, t: Trading | null): OptionHealth {
  const empty = { total: 0, fresh: 0, stale: 0, unknown: 0, noData: 0, freshClass: "neu", selected: null };
  if (!o || !o.available) return { kind: "none", ...empty };
  const contracts = o.contracts ?? [];
  const n: Record<string, number> = { fresh: 0, stale: 0, unknown: 0, "no data": 0, "market closed": 0 };
  for (const c of contracts) n[c.freshness] = (n[c.freshness] ?? 0) + 1;
  const bad = (n.stale ?? 0) + (n.unknown ?? 0);
  const selected = contractOffer(t, o).contract;
  if (n["market closed"] === contracts.length) return { kind: "closed", ...empty, total: contracts.length };
  return { kind: "counts", total: contracts.length, fresh: n.fresh ?? 0, stale: n.stale ?? 0, unknown: n.unknown ?? 0, noData: n["no data"] ?? 0, freshClass: n.fresh ? (bad ? "flat" : "up") : "neu", selected };
}

