import { describe, expect, it } from "vitest";
import { autoChecks, doneFor, GROUPS, MANUAL, NO_TICKS, STATUS_CLS, STATUS_ICON, STATUS_WORD, tally, toggleTick, type Check } from "./checklistModel";
import { base, variant } from "./test/helpers";
import type { Setup, Snapshot, Trading } from "./types";

// The checklist is the real snapshot of the engine (a BUY CE world at 10:55 on 06 Nov 2026), read question by question. Every expectation below is typed by hand from what that snapshot says, not
// taken from the code under test.
const T = (s: Snapshot): Trading => s.trading!;
const X = (s: Snapshot): Setup => T(s).setups[0]!;
const all = (s: Snapshot, stale = false): Check[] => autoChecks(s, T(s), stale);
const row = (s: Snapshot, id: string): [string, string] => {
  const c = all(s).find((k) => k.id === id);
  if (!c) throw new Error("no check " + id);
  return [c.status, c.text];
};

describe("the real BUY CE world", () => {
  it("answers thirteen questions, in the order a trader asks them", () => {
    expect(all(base).map((c) => [c.id, c.group, c.status, c.text])).toEqual([
      ["session", "day", "pass", "morning: entries allowed"],
      ["data", "day", "pass", "feed connected · data trusted · NIFTY price 1 s old"],
      ["volatility", "day", "pass", "normal"],
      ["regime", "day", "pass", "Bullish trend (1H ADX 100.0): 1H bullish, 15M bullish"],
      ["setup", "setup", "pass", "Trend Pullback CE: READY: in the entry area"],
      ["trend", "setup", "pass", "1H bullish · 15M bullish"],
      ["confirmed", "setup", "pass", "trigger 24281.00, confirmed 10:55"],
      ["area", "setup", "pass", "inside the entry zone 24281.00 – 24287.06"],
      ["clear", "setup", "pass", "no blocker"],
      ["cautions", "setup", "warn", "15M RSI 73.9: momentum is already stretched in this direction"],
      ["levels", "setup", "pass", "invalidation 24270.48 (10.5 pts of risk) · target 1 24308.00 (27.0 pts, 2.6R) · index points, not option premium"],
      ["decision", "setup", "pass", "Prism says CE setup ready"],
      ["contract", "option", "pass", "CE 24200 · ITM · spread 0.24% · 4 day(s) to expiry"],
    ]);
  });

  it("sends only the option question to the Options tab", () => {
    expect(all(base).filter((c) => c.goto).map((c) => [c.id, c.goto])).toEqual([["contract", "options"]]);
  });

  it("is 12 met and one caution", () => {
    expect(tally(all(base))).toEqual({ met: 12, caution: 1, notMet: 0, open: 0, total: 13 });
  });

  it("has the three groups, in order, with every check in one of them", () => {
    expect(GROUPS).toEqual([
      { id: "day", title: "The day and the data" },
      { id: "setup", title: "The setup" },
      { id: "option", title: "The option" },
    ]);
    expect(all(base).every((c) => GROUPS.some((g) => g.id === c.group))).toBe(true);
  });

  it("says a status as a word, an icon and a colour, each different, so it is never colour alone", () => {
    expect(STATUS_WORD).toEqual({ pass: "met", warn: "caution", fail: "not met", na: "not yet", unknown: "unknown" });
    expect(STATUS_ICON).toEqual({ pass: "✓", warn: "!", fail: "✗", na: "–", unknown: "?" });
    expect(STATUS_CLS).toEqual({ pass: "up", warn: "flat", fail: "down", na: "mut", unknown: "mut" });
  });
});

describe("the day: entries are allowed now", () => {
  const phase = (over: Partial<NonNullable<Trading["session"]>>) => variant((s) => { Object.assign(T(s).session!, over); });
  it("is not met when no entries are allowed, in the session's own words", () => {
    expect(row(phase({ phase: "opening", entries_allowed: false, note: "opening range forming: no entries before 09:30" }), "session")).toEqual(["fail", "opening range forming: no entries before 09:30"]);
  });
  it("says the phase when the session has no words of its own", () => {
    expect(row(phase({ phase: "late_session", entries_allowed: false, note: "" }), "session")).toEqual(["fail", "late session: no new entries"]);
  });
  it("is a caution in the midday window, where the confirmation is stricter", () => {
    expect(row(phase({ phase: "midday", strict: true, note: "midday low-activity window: stricter confirmation" }), "session")).toEqual(["warn", "midday low-activity window: stricter confirmation"]);
    expect(row(phase({ phase: "midday", strict: true, note: "" }), "session")).toEqual(["warn", "midday: stricter confirmation"]);
  });
  it("is unknown when the snapshot has no session", () => {
    expect(row(variant((s) => { T(s).session = null; }), "session")).toEqual(["unknown", "no session information"]);
  });
});

describe("the data is current and trusted", () => {
  it("is not met when the market is closed (and that is said before anything else)", () => {
    const s = variant((x) => { x.health.live = false; x.connection.state = "disconnected"; x.health.trusted = false; });
    expect(row(s, "data")).toEqual(["fail", "the market is closed"]);
  });
  it("is not met when the feed is not connected", () => {
    expect(row(variant((x) => { x.connection.state = "disconnected"; }), "data")).toEqual(["fail", "the feed is disconnected"]);
  });
  it("is not met when Prism does not trust the data: the first issue, or the plain fact", () => {
    expect(row(variant((x) => { x.health.trusted = false; x.health.issues = ["the NIFTY ticks are 40 s old", "another"]; }), "data")).toEqual(["fail", "the NIFTY ticks are 40 s old"]);
    expect(row(variant((x) => { x.health.trusted = false; x.health.issues = []; }), "data")).toEqual(["fail", "Prism does not trust the data"]);
  });
  it("is not met when the candles are incomplete", () => {
    expect(row(variant((s) => { T(s).data = { ok: false, issues: ["the 5M candle of 10:50 is missing"] }; }), "data")).toEqual(["fail", "the 5M candle of 10:50 is missing"]);
    expect(row(variant((s) => { T(s).data = { ok: false }; }), "data")).toEqual(["fail", "the candles are incomplete"]);
  });
  it("is not met when the computer's clock is not trusted", () => {
    expect(row(variant((s) => { s.health.time = { trusted: false, reason: "the PC clock is 9 s ahead" }; }), "data")).toEqual(["fail", "the PC clock is 9 s ahead"]);
    expect(row(variant((s) => { s.health.time = { trusted: false }; }), "data")).toEqual(["fail", "the computer's clock is not trusted"]);
  });
  it("is not met when the NIFTY price is stale or missing", () => {
    expect(row(variant((s) => { s.instruments.find((i) => i.role === "SPOT")!.status = "stale"; }), "data")).toEqual(["fail", "the NIFTY price is stale"]);
    expect(row(variant((s) => { s.instruments = s.instruments.filter((i) => i.role !== "SPOT"); }), "data")).toEqual(["fail", "the NIFTY price is missing"]);
  });
  it("is a caution when Prism trusts the data but has warnings, and says how many and the first", () => {
    expect(row(variant((s) => { s.health.warnings = ["2 candles were recovered", "the history is a day old"]; }), "data")).toEqual(["warn", "2 warning(s): 2 candles were recovered"]);
  });
});

describe("volatility is not extreme", () => {
  const vol = (v: string) => variant((s) => { T(s).market!.volatility = v; });
  it("says normal and low as met, high as a caution, anything else as unknown", () => {
    expect(row(vol("normal"), "volatility")).toEqual(["pass", "normal"]);
    expect(row(vol("low"), "volatility")).toEqual(["pass", "low: a quiet market, small moves"]);
    expect(row(vol("high"), "volatility")).toEqual(["warn", "high: bigger swings than usual (Prism stops only at extreme)"]);
    expect(row(vol("unknown"), "volatility")).toEqual(["unknown", "volatility is unknown"]);
  });
  it("is not met when Prism itself stays out for volatility", () => {
    expect(row(variant((s) => { T(s).decision.headline = "NO TRADE: volatility is unusually high"; }), "volatility")).toEqual(["fail", "volatility is unusually high: Prism stays out"]);
  });
  it("is unknown without a market summary", () => {
    expect(row(variant((s) => { T(s).market = null; }), "volatility")).toEqual(["unknown", "no market summary"]);
  });
});

describe("the market is not conflicting or unclear", () => {
  const reg = (r: string, text: string) => variant((s) => { T(s).market!.regime = r; T(s).market!.text = text; });
  it("is not met for a conflicting or an unclear market, in Prism's words", () => {
    expect(row(reg("conflicting", "1H is bullish but 15M is bearish: conflicting timeframes."), "regime")).toEqual(["fail", "1H is bullish but 15M is bearish: conflicting timeframes."]);
    expect(row(reg("unclear", "Not enough completed candles to classify the market"), "regime")).toEqual(["fail", "Not enough completed candles to classify the market"]);
  });
  it("is a caution when a counter-trend setup holds a granted permission", () => {
    const s = reg("conflicting", "1H is bullish but 15M is bearish.");
    T(s).counter_trend = [{ needed: true, granted: true, reason: "granted", side: "CE", setup_id: X(s).id }];
    expect(row(s, "regime")).toEqual(["warn", "1H is bullish but 15M is bearish. (a counter-trend setup holds a granted permission)"]);
  });
  it("is not lifted by a permission that was denied or belongs to another setup", () => {
    const s = reg("conflicting", "conflicting");
    T(s).counter_trend = [{ needed: true, granted: false, reason: "denied", side: "CE", setup_id: X(s).id }, { needed: true, granted: true, reason: "granted", side: "PE", setup_id: "another" }];
    expect(row(s, "regime")[0]).toBe("fail");
  });
  it("is met for a trend, a range and a developing market, and unknown without a summary", () => {
    for (const r of ["trend_up", "trend_down", "range", "developing"]) expect(row(reg(r, "text of " + r), "regime")).toEqual(["pass", "text of " + r]);
    expect(row(variant((s) => { T(s).market = null; }), "regime")).toEqual(["unknown", "no market summary"]);
  });
});

describe("with no live setup", () => {
  const none = variant((s) => {
    T(s).setups = [];
    T(s).decision = { ...T(s).decision, action: "WAIT", headline: "WAIT: the market is tradable but there is no setup yet", setup_id: null, strategy: null, strategy_name: null };
    T(s).explain = null;
  });
  it("says there is none, and leaves every question about a setup as not yet", () => {
    expect(row(none, "setup")).toEqual(["fail", "no live setup: WAIT: the market is tradable but there is no setup yet"]);
    for (const id of ["trend", "confirmed", "area", "clear", "cautions", "levels"]) expect(row(none, id), id).toEqual(["na", "needs a live setup"]);
    expect(row(none, "decision")).toEqual(["fail", "WAIT: the market is tradable but there is no setup yet"]);
  });
  it("still answers the day's questions", () => {
    expect(row(none, "session")[0]).toBe("pass");
    expect(row(none, "data")[0]).toBe("pass");
  });
  it("asks about the option only once a setup is ready", () => {
    expect(all(none).find((c) => c.id === "contract")).toEqual({ id: "contract", group: "option", label: "A suitable option contract is offered", status: "na", text: "checked once a setup is ready", goto: "options" });
  });
});

describe("the 1H and 15M do not run against the side", () => {
  const tf = (h: string, m: string, dir = "CE") => variant((s) => { s.analysis!.timeframes!["1h"]!.trend = h; s.analysis!.timeframes!["15m"]!.trend = m; X(s).direction = dir; });
  it("is not met when either runs against a call, or against a put", () => {
    expect(row(tf("bearish", "bullish"), "trend")).toEqual(["fail", "1H bearish · 15M bullish: runs against a call"]);
    expect(row(tf("bullish", "bearish"), "trend")).toEqual(["fail", "1H bullish · 15M bearish: runs against a call"]);
    expect(row(tf("bullish", "bullish", "PE"), "trend")).toEqual(["fail", "1H bullish · 15M bullish: runs against a put"]);
  });
  it("is met when neither runs against the side, even if one is sideways", () => {
    expect(row(tf("sideways", "bullish"), "trend")).toEqual(["pass", "1H sideways · 15M bullish"]);
    expect(row(tf("bearish", "sideways", "PE"), "trend")).toEqual(["pass", "1H bearish · 15M sideways"]);
  });
  it("is a caution when a counter-trend permission allows it", () => {
    const s = tf("bearish", "bearish");
    T(s).counter_trend = [{ needed: true, granted: true, reason: "granted", side: "CE", setup_id: X(s).id }];
    expect(row(s, "trend")).toEqual(["warn", "1H bearish · 15M bearish: against the call, allowed only by the counter-trend permission"]);
  });
  it("is unknown when a trend is not known or the analysis is not available", () => {
    expect(row(tf("unknown", "bullish"), "trend")).toEqual(["unknown", "the 1H or 15M trend is not available"]);
    expect(row(tf("bullish", "unknown"), "trend")).toEqual(["unknown", "the 1H or 15M trend is not available"]);
    expect(row(variant((s) => { s.analysis = { available: false }; }), "trend")).toEqual(["unknown", "the 1H or 15M trend is not available"]);
  });
});

describe("a completed 5M candle closed beyond the trigger", () => {
  const sx = (over: Partial<Setup>) => variant((s) => { Object.assign(X(s), over); });
  it("is not met until the candle has closed, and says what Prism is waiting for", () => {
    expect(row(sx({ candle_confirmed: false, confirmed_at: null, confirm_text: "a completed 5M candle must close above 24281.00" }), "confirmed")).toEqual(["fail", "a completed 5M candle must close above 24281.00"]);
    expect(row(sx({ candle_confirmed: false, confirmed_at: null, confirm_text: "" }), "confirmed")).toEqual(["fail", "waiting for a completed 5M candle to close beyond the trigger"]);
  });
  it("is met by the candle, or by the time it was confirmed", () => {
    expect(row(sx({ candle_confirmed: true, confirmed_at: null }), "confirmed")).toEqual(["pass", "trigger 24281.00"]);
    expect(row(sx({ candle_confirmed: false, confirmed_at: 1793942100 }), "confirmed")).toEqual(["pass", "trigger 24281.00, confirmed 10:45"]);
  });
});

describe("price is in the entry area, not past it", () => {
  const ps = (price_state: string | null, over: Partial<Setup> = {}) => variant((s) => { Object.assign(X(s), { price_state, ...over }); });
  it("is not yet before the setup is confirmed", () => {
    expect(row(ps(null, { candle_confirmed: false, confirmed_at: null }), "area")).toEqual(["na", "applies once the setup is confirmed"]);
  });
  it("says each way price can be out of the area, in Prism's own words", () => {
    expect(row(ps("extended"), "area")).toEqual(["fail", "price is already beyond the entry area: do not chase"]);
    expect(row(ps("below_trigger"), "area")).toEqual(["fail", "price has moved back through the trigger 24281.00"]);
    expect(row(ps("above_trigger"), "area")).toEqual(["fail", "price has moved back through the trigger 24281.00"]);
    expect(row(ps("through_invalidation"), "area")).toEqual(["fail", "price is through the invalidation level 24270.48"]);
  });
  it("is unknown when Prism does not know where price is", () => {
    expect(row(ps(null), "area")).toEqual(["unknown", "the price position is not known"]);
  });
});

describe("nothing blocks entry, and no caution argues against it", () => {
  it("is not met with a blocker: the first, and how many more", () => {
    expect(row(variant((s) => { X(s).blockers = ["only 18.0 pts to the next level"]; }), "clear")).toEqual(["fail", "only 18.0 pts to the next level"]);
    expect(row(variant((s) => { X(s).blockers = ["the room rule", "the risk is too wide", "a third"]; }), "clear")).toEqual(["fail", "the room rule (+2 more)"]);
  });
  it("lists the cautions Prism holds against the setup: the first and how many more, or none", () => {
    expect(row(variant((s) => { X(s).against = ["a", "b"]; }), "cautions")).toEqual(["warn", "a (+1 more)"]);
    expect(row(variant((s) => { X(s).against = []; }), "cautions")).toEqual(["pass", "Prism lists none"]);
  });
});

describe("the invalidation and a target are known", () => {
  const plan = (p: unknown) => variant((s) => { X(s).plan = p as Setup["plan"]; });
  it("is not met without an invalidation level", () => {
    expect(row(variant((s) => { X(s).invalidation = null; }), "levels")).toEqual(["fail", "Prism gave no invalidation level"]);
  });
  it("is a caution when no target was detected, and still says the invalidation", () => {
    expect(row(plan({ entry_reference: 24281, risk_points: 10.5, targets: [], note: "no level" }), "levels")).toEqual(["warn", "invalidation 24270.48 (10.5 pts of risk) · no target level was detected"]);
    expect(row(plan({}), "levels")).toEqual(["warn", "invalidation 24270.48 · no target level was detected"]);
  });
  it("leaves the ratio out when Prism gives none, and says the first target only", () => {
    const p = { entry_reference: 24281, risk_points: 10.5, targets: [{ n: 1, price: 24308, label: "a", distance: 27, reward_risk: null }, { n: 2, price: 24340, label: "b", distance: 59, reward_risk: 5.6 }], note: "" };
    expect(row(plan(p), "levels")).toEqual(["pass", "invalidation 24270.48 (10.5 pts of risk) · target 1 24308.00 (27.0 pts) · index points, not option premium"]);
  });
});

describe("Prism says this setup is ready", () => {
  it("is not met when Prism says WAIT or NO TRADE, and says why", () => {
    expect(row(variant((s) => { T(s).decision.action = "WAIT"; T(s).decision.headline = "WAIT: Trend Pullback (CE) is confirmed but blocked"; }), "decision")).toEqual(["fail", "Prism says WAIT: WAIT: Trend Pullback (CE) is confirmed but blocked"]);
  });
  it("is not met when the BUY is for the other side", () => {
    expect(row(variant((s) => { T(s).decision.action = "BUY PE"; }), "decision")).toEqual(["fail", "Prism says PE setup ready: CE setup ready: Trend Pullback setup confirmed"]);
  });
  it("is not met when the BUY names a setup the page does not hold: the setup read is the explained one, not the one bought", () => {
    expect(row(variant((s) => { T(s).decision.setup_id = "gone:bull:1"; }), "decision")).toEqual(["fail", "Prism says CE setup ready: CE setup ready: Trend Pullback setup confirmed"]);
  });
  it("is met for the setup the decision names, whichever setup comes first in the list", () => {
    const s = variant((x) => {
      const second = { ...structuredClone(X(x)), id: "ema_trend_continuation:bull:1", strategy: "ema_trend_continuation", strategy_name: "EMA Trend Continuation" };
      T(x).setups = [X(x), second];
      T(x).decision.setup_id = second.id;
    });
    expect(row(s, "decision")).toEqual(["pass", "Prism says CE setup ready"]);
    expect(row(s, "setup")).toEqual(["pass", "EMA Trend Continuation CE: READY: in the entry area"]); // (the checks read the setup the decision is about)
  });
});

describe("a suitable option contract is offered", () => {
  const opt = (change: (o: NonNullable<Snapshot["options"]>) => void) => variant((s) => { change(s.options!); });
  const cont = (s: Snapshot) => s.options!.selection!.contract!;
  it("is unknown without option quotes", () => {
    expect(row(variant((s) => { delete s.options; }), "contract")).toEqual(["unknown", "no option quotes yet"]);
    expect(row(opt((o) => { o.available = false; }), "contract")).toEqual(["unknown", "no option quotes yet"]);
  });
  it("is not met when no suitable contract is offered, in the selection's own words", () => {
    expect(row(opt((o) => { o.selection!.actionable = false; o.selection!.notice = "No suitable contract: every CE is ruled out"; }), "contract")).toEqual(["fail", "no suitable contract: No suitable contract: every CE is ruled out"]);
    expect(row(opt((o) => { o.selection!.actionable = false; o.selection!.notice = ""; o.selection!.why = ["the spread is too wide"]; }), "contract")).toEqual(["fail", "no suitable contract: the spread is too wide"]);
    expect(row(opt((o) => { o.selection!.actionable = false; o.selection!.notice = ""; o.selection!.why = []; }), "contract")).toEqual(["fail", "no suitable contract: no option trade"]);
  });
  it("is not met when the quote is not fresh, or a finding rules the contract out", () => {
    expect(row(variant((s) => { cont(s).freshness = "stale"; }), "contract")).toEqual(["fail", "CE 24200: the quote is stale"]);
    expect(row(variant((s) => { cont(s).blocking = true; }), "contract")).toEqual(["fail", "CE 24200: a finding rules it out"]);
  });
  it("is a caution with a warning on the contract (the first), or on an expiry day", () => {
    expect(row(variant((s) => { cont(s).flags = [{ severity: "warn", code: "spread_high", text: "spread 1.20% is over 1%" }, { severity: "warn", code: "x", text: "second" }]; }), "contract")).toEqual(["warn", "CE 24200 · ITM · spread 0.24% · 4 day(s) to expiry · spread 1.20% is over 1%"]);
    expect(row(variant((s) => { cont(s).expiry_day = true; cont(s).days_to_expiry = 0; }), "contract")).toEqual(["warn", "CE 24200 · ITM · spread 0.24% · 0 day(s) to expiry · expiry day: time decay is fast"]);
  });
  it("says a dash for a spread or a moneyness it does not have", () => {
    expect(row(variant((s) => { cont(s).spread_pct = null; cont(s).moneyness = null; }), "contract")).toEqual(["pass", "CE 24200 · – · spread – · 4 day(s) to expiry"]);
  });
});

describe("on a page that has lost its link", () => {
  it("answers nothing: every row is unknown, with the same reason, and none is a met check", () => {
    const rows = all(base, true);
    expect(rows).toHaveLength(13);
    expect(rows.map((c) => [c.status, c.text])).toEqual(Array.from({ length: 13 }, () => ["unknown", "not current: the page lost its link to Prism"]));
    expect(rows.map((c) => c.id)).toEqual(all(base).map((c) => c.id));
    expect(tally(rows)).toEqual({ met: 0, caution: 0, notMet: 0, open: 13, total: 13 });
  });
});

describe("the tally", () => {
  it("counts each status once, and not yet and unknown together as open", () => {
    const k = (status: Check["status"]): Check => ({ id: "x", group: "day", label: "x", status, text: "" });
    expect(tally([k("pass"), k("pass"), k("warn"), k("fail"), k("fail"), k("fail"), k("na"), k("unknown")])).toEqual({ met: 2, caution: 1, notMet: 3, open: 2, total: 8 });
    expect(tally([])).toEqual({ met: 0, caution: 0, notMet: 0, open: 0, total: 0 });
  });
});

describe("what Prism cannot see is left to the reader", () => {
  it("names five things, the ones the answers above say Prism does not show or know", () => {
    expect(MANUAL.map((m) => m.id)).toEqual(["chain", "greeks", "stop", "limit", "plan"]);
    expect(MANUAL.map((m) => m.goto ?? null)).toEqual([null, null, "trades", "trades", null]);
    expect(MANUAL.map((m) => m.label)).toEqual([
      "I looked at the option chain on my broker",
      "I checked delta, theta and IV of the contract I will buy",
      "I chose my stop premium and my lot size",
      "I am inside my daily loss limit and my trade count",
      "This is a setup I planned for, not FOMO or revenge",
    ]);
  });
});

describe("the ticks", () => {
  it("start with nothing, and a tick toggles one item for one setup", () => {
    const a = toggleTick(NO_TICKS, "s1", "chain");
    expect(doneFor(a, "s1")).toEqual(["chain"]);
    const b = toggleTick(a, "s1", "greeks");
    expect(doneFor(b, "s1")).toEqual(["chain", "greeks"]);
    expect(doneFor(toggleTick(b, "s1", "chain"), "s1")).toEqual(["greeks"]);
  });
  it("belong to the setup: another setup, or none, starts clean, and a tick on the new setup does not bring the old ones back", () => {
    const a = toggleTick(toggleTick(NO_TICKS, "s1", "chain"), "s1", "stop");
    expect(doneFor(a, "s2")).toEqual([]);
    expect(doneFor(a, "")).toEqual([]);
    expect(doneFor(toggleTick(a, "s2", "plan"), "s2")).toEqual(["plan"]);
    expect(doneFor(toggleTick(a, "s2", "plan"), "s1")).toEqual([]);
  });
  it("cannot be made when there is no setup", () => {
    expect(toggleTick(NO_TICKS, "", "chain")).toBe(NO_TICKS);
    expect(doneFor({ key: "", done: ["chain"] }, "")).toEqual([]);
  });
  it("never change the state they were given", () => {
    const a = toggleTick(NO_TICKS, "s1", "chain");
    const before = JSON.stringify(a);
    toggleTick(a, "s1", "greeks");
    toggleTick(a, "s1", "chain");
    toggleTick(a, "s2", "stop");
    expect(JSON.stringify(a)).toBe(before);
    expect(JSON.stringify(NO_TICKS)).toBe('{"key":"","done":[]}');
  });
});
