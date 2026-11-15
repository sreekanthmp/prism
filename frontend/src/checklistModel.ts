import { age, fmtT, n1, n2 } from "./format";
import { contractOffer, liveSetup, stageWord, zone } from "./overviewModel";
import type { Plan, Setup, Snapshot, Trading } from "./types";
import type { TabId } from "./components/Tabs";

// The pre-trade checklist (after the cutover). It is the questions a manual trader asks before a trade, each answered from what Prism already says, and the questions Prism cannot answer left to be
// ticked by hand. Nothing here is computed from the market: every answer is one of the backend's own fields, read as yes / caution / no / not yet / unknown. It is a checklist, not a signal: a
// page of green rows is not an instruction, and Prism places no orders.

export type Status = "pass" | "warn" | "fail" | "na" | "unknown";
export type GroupId = "day" | "setup" | "option";
export interface Check {
  id: string;
  group: GroupId;
  label: string;
  status: Status;
  text: string; // what Prism says, in a line
  goto?: TabId; // where the detail is
}

export const GROUPS: { id: GroupId; title: string }[] = [
  { id: "day", title: "The day and the data" },
  { id: "setup", title: "The setup" },
  { id: "option", title: "The option" },
];
export const STATUS_WORD: Record<Status, string> = { pass: "met", warn: "caution", fail: "not met", na: "not yet", unknown: "unknown" };
export const STATUS_ICON: Record<Status, string> = { pass: "✓", warn: "!", fail: "✗", na: "–", unknown: "?" };
export const STATUS_CLS: Record<Status, string> = { pass: "up", warn: "flat", fail: "down", na: "mut", unknown: "mut" };

const NOT_CURRENT = "not current: the page lost its link to Prism";
const NEEDS_SETUP = "needs a live setup";

const mk = (id: string, group: GroupId, label: string, status: Status, text: string, goto?: TabId): Check => ({ id, group, label, status, text, ...(goto ? { goto } : {}) });
const more = (list: string[]): string => (list.length > 1 ? ` (+${list.length - 1} more)` : "");
const isConfirmed = (x: Setup): boolean => x.candle_confirmed === true || x.confirmed_at != null;
/** Does a counter-trend strategy hold a granted permission for this setup? Only then may a setup run against the 1H or 15M trend. */
const permitted = (t: Trading, x: Setup): boolean => t.counter_trend.some((c) => c.granted && c.setup_id === x.id);

// -- the day and the data ----------------------------------------------------------------------------------------------------------------------------------
function session(t: Trading): Check {
  const label = "Entries are allowed now";
  const se = t.session;
  if (!se) return mk("session", "day", label, "unknown", "no session information");
  const phase = se.phase.replace(/_/g, " ");
  if (!se.entries_allowed) return mk("session", "day", label, "fail", se.note || `${phase}: no new entries`);
  if (se.strict) return mk("session", "day", label, "warn", se.note || `${phase}: stricter confirmation`);
  return mk("session", "day", label, "pass", `${phase}: entries allowed`);
}

function data(s: Snapshot, t: Trading): Check {
  const label = "The data is current and trusted";
  const h = s.health;
  const spot = s.instruments.find((i) => i.role === "SPOT");
  const no = (why: string) => mk("data", "day", label, "fail", why);
  if (!h.live) return no("the market is closed");
  if (s.connection.state !== "connected") return no(`the feed is ${s.connection.state}`);
  if (!h.trusted) return no(h.issues[0] || "Prism does not trust the data");
  if (t.data && !t.data.ok) return no((t.data.issues ?? [])[0] || "the candles are incomplete");
  if (h.time && !h.time.trusted) return no(h.time.reason || "the computer's clock is not trusted");
  if (!spot || spot.status !== "fresh") return no(`the NIFTY price is ${spot ? spot.status : "missing"}`);
  if (h.warnings.length) return mk("data", "day", label, "warn", `${h.warnings.length} warning(s): ${h.warnings[0]}`);
  return mk("data", "day", label, "pass", `feed connected · data trusted · NIFTY price ${age(spot.age)} old`);
}

function volatility(t: Trading): Check {
  const label = "Volatility is not extreme";
  const m = t.market;
  if (!m) return mk("volatility", "day", label, "unknown", "no market summary");
  if (/^NO TRADE: volatility/i.test(t.decision.headline)) return mk("volatility", "day", label, "fail", "volatility is unusually high: Prism stays out");
  if (m.volatility === "normal") return mk("volatility", "day", label, "pass", "normal");
  if (m.volatility === "low") return mk("volatility", "day", label, "pass", "low: a quiet market, small moves");
  if (m.volatility === "high") return mk("volatility", "day", label, "warn", "high: bigger swings than usual (Prism stops only at extreme)");
  return mk("volatility", "day", label, "unknown", `volatility is ${m.volatility}`);
}

function regime(t: Trading, x: Setup | null): Check {
  const label = "The market is not conflicting or unclear";
  const m = t.market;
  if (!m) return mk("regime", "day", label, "unknown", "no market summary");
  if (m.regime === "conflicting" || m.regime === "unclear") {
    return x && permitted(t, x) ? mk("regime", "day", label, "warn", `${m.text} (a counter-trend setup holds a granted permission)`) : mk("regime", "day", label, "fail", m.text);
  }
  return mk("regime", "day", label, "pass", m.text);
}

// -- the setup ---------------------------------------------------------------------------------------------------------------------------------------------
function setupChecks(s: Snapshot, t: Trading, x: Setup | null): Check[] {
  const g = "setup";
  const need = (id: string, label: string) => mk(id, g, label, "na", NEEDS_SETUP);
  const call = x?.direction === "CE" ? "call" : "put";
  const out: Check[] = [];

  out.push(x ? mk("setup", g, "A setup is live", "pass", `${x.strategy_name} ${x.direction}: ${stageWord(x.stage, false)}`) : mk("setup", g, "A setup is live", "fail", `no live setup: ${t.decision.headline}`));

  // the 1H and 15M must not run against the side (only a counter-trend permission lifts it)
  const tl = "The 1H and 15M do not run against the side";
  if (!x) out.push(need("trend", tl));
  else {
    const tf = s.analysis?.available ? s.analysis.timeframes : undefined;
    const h1 = tf?.["1h"]?.trend;
    const m15 = tf?.["15m"]?.trend;
    const text = `1H ${h1} · 15M ${m15}`;
    const against = x.direction === "CE" ? "bearish" : "bullish";
    if (!h1 || !m15 || h1 === "unknown" || m15 === "unknown") out.push(mk("trend", g, tl, "unknown", "the 1H or 15M trend is not available"));
    else if (h1 === against || m15 === against) out.push(permitted(t, x) ? mk("trend", g, tl, "warn", `${text}: against the ${call}, allowed only by the counter-trend permission`) : mk("trend", g, tl, "fail", `${text}: runs against a ${call}`));
    else out.push(mk("trend", g, tl, "pass", text));
  }

  const cl = "A completed 5M candle closed beyond the trigger";
  if (!x) out.push(need("confirmed", cl));
  else if (isConfirmed(x)) out.push(mk("confirmed", g, cl, "pass", `trigger ${n2(x.trigger)}${x.confirmed_at != null ? `, confirmed ${fmtT(x.confirmed_at, false)}` : ""}`));
  else out.push(mk("confirmed", g, cl, "fail", x.confirm_text || "waiting for a completed 5M candle to close beyond the trigger"));

  const al = "Price is in the entry area, not past it";
  if (!x) out.push(need("area", al));
  else if (!isConfirmed(x)) out.push(mk("area", g, al, "na", "applies once the setup is confirmed"));
  else if (x.price_state === "in_entry_area") out.push(mk("area", g, al, "pass", `inside the entry zone ${zone(x.zone)}`));
  else if (x.price_state === "extended") out.push(mk("area", g, al, "fail", "price is already beyond the entry area: do not chase"));
  else if (x.price_state === "below_trigger" || x.price_state === "above_trigger") out.push(mk("area", g, al, "fail", `price has moved back through the trigger ${n2(x.trigger)}`));
  else if (x.price_state === "through_invalidation") out.push(mk("area", g, al, "fail", `price is through the invalidation level ${n2(x.invalidation)}`));
  else out.push(mk("area", g, al, "unknown", "the price position is not known"));

  const bl = "Nothing blocks entry";
  if (!x) out.push(need("clear", bl));
  else if (x.blockers.length) out.push(mk("clear", g, bl, "fail", `${x.blockers[0]}${more(x.blockers)}`));
  else out.push(mk("clear", g, bl, "pass", "no blocker"));

  const cu = "No caution argues against it";
  if (!x) out.push(need("cautions", cu));
  else if (x.against.length) out.push(mk("cautions", g, cu, "warn", `${x.against[0]}${more(x.against)}`));
  else out.push(mk("cautions", g, cu, "pass", "Prism lists none"));

  const lv = "The invalidation and a target are known";
  if (!x) out.push(need("levels", lv));
  else if (x.invalidation == null) out.push(mk("levels", g, lv, "fail", "Prism gave no invalidation level"));
  else {
    const plan = x.plan as Plan | undefined; // (a setup with no plan carries {})
    const tg = plan?.targets?.[0];
    const risk = plan?.risk_points;
    const inv = `invalidation ${n2(x.invalidation)}${risk != null ? ` (${n1(risk)} pts of risk)` : ""}`;
    out.push(
      tg
        ? mk("levels", g, lv, "pass", `${inv} · target 1 ${n2(tg.price)} (${n1(tg.distance)} pts${tg.reward_risk != null ? `, ${n1(tg.reward_risk)}R` : ""}) · index points, not option premium`)
        : mk("levels", g, lv, "warn", `${inv} · no target level was detected`),
    );
  }

  const dl = "Prism's decision is a BUY for this setup";
  const action = t.decision.action;
  if (!x) out.push(mk("decision", g, dl, "fail", t.decision.headline));
  else if (action === `BUY ${x.direction}` && t.decision.setup_id === x.id) out.push(mk("decision", g, dl, "pass", `Prism says ${action}`));
  else out.push(mk("decision", g, dl, "fail", `Prism says ${action}: ${t.decision.headline}`));
  return out;
}

// -- the option --------------------------------------------------------------------------------------------------------------------------------------------
function contract(s: Snapshot, t: Trading): Check {
  const label = "A suitable option contract is offered";
  if (!/^BUY (CE|PE)$/.test(t.decision.action)) return mk("contract", "option", label, "na", "checked once Prism says BUY CE or BUY PE", "options");
  const o = s.options;
  if (!o || !o.available) return mk("contract", "option", label, "unknown", "no option quotes yet", "options");
  const offer = contractOffer(t, o);
  const c = offer.contract;
  if (!c) return mk("contract", "option", label, "fail", `no suitable contract: ${o.selection?.notice || (o.selection?.why ?? [])[0] || "no option trade"}`, "options");
  if (c.freshness !== "fresh" || c.blocking) return mk("contract", "option", label, "fail", `${c.kind} ${c.strike}: ${c.freshness === "fresh" ? "a finding rules it out" : `the quote is ${c.freshness}`}`, "options");
  const desc = `${c.kind} ${c.strike} · ${c.moneyness ?? "–"} · spread ${c.spread_pct != null ? n2(c.spread_pct) + "%" : "–"} · ${c.days_to_expiry} day(s) to expiry`;
  const warns = c.flags.filter((f) => f.severity === "warn");
  if (warns.length || c.expiry_day) return mk("contract", "option", label, "warn", `${desc} · ${warns[0]?.text ?? "expiry day: time decay is fast"}`, "options");
  return mk("contract", "option", label, "pass", desc, "options");
}

/** Every question Prism can answer. On a page that has lost its link nothing is current, so nothing is answered. */
export function autoChecks(s: Snapshot, t: Trading, stale: boolean): Check[] {
  const x = liveSetup(t);
  const list = [session(t), data(s, t), volatility(t), regime(t, x), ...setupChecks(s, t, x), contract(s, t)];
  return stale ? list.map((c) => ({ ...c, status: "unknown" as const, text: NOT_CURRENT })) : list;
}

export interface Tally {
  met: number;
  caution: number;
  notMet: number;
  open: number; // not yet, or unknown
  total: number;
}
export function tally(checks: Check[]): Tally {
  const n = (st: Status[]) => checks.filter((c) => st.includes(c.status)).length;
  return { met: n(["pass"]), caution: n(["warn"]), notMet: n(["fail"]), open: n(["na", "unknown"]), total: checks.length };
}

// -- what Prism cannot see: ticked by the reader, for the setup that is live ------------------------------------------------------------------------------
export interface Manual {
  id: string;
  label: string;
  hint: string;
  goto?: TabId;
}
export const MANUAL: Manual[] = [
  { id: "chain", label: "I looked at the option chain on my broker", hint: "open interest, the change in it, and where call and put OI pile up: Prism does not show the chain" },
  { id: "greeks", label: "I checked delta, theta and IV of the contract I will buy", hint: "Prism does not compute the Greeks; near expiry, time decay is fast" },
  { id: "stop", label: "I chose my stop premium and my lot size", hint: "the Trades tab sizes a trade from your own stop and your own limits", goto: "trades" },
  { id: "limit", label: "I am inside my daily loss limit and my trade count", hint: "the Trades tab shows today's result against your limit", goto: "trades" },
  { id: "plan", label: "This is a setup I planned for, not FOMO or revenge", hint: "a rule you set before the session, not a mood" },
];

/** What is ticked, and for which setup. A tick is about one setup: a different setup (or none) starts clean. */
export interface Ticks {
  key: string;
  done: readonly string[];
}
export const NO_TICKS: Ticks = { key: "", done: [] };
export const doneFor = (t: Ticks, key: string): readonly string[] => (key !== "" && t.key === key ? t.done : []);
export function toggleTick(t: Ticks, key: string, item: string): Ticks {
  if (key === "") return t; // there is no setup to tick for
  const done = doneFor(t, key);
  return { key, done: done.includes(item) ? done.filter((d) => d !== item) : [...done, item] };
}
