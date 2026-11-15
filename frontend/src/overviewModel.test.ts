import { describe, expect, it } from "vitest";
import { arrow, atrNote, cls, contractOffer, eventConcise, factCell, liveSetup, monitor, optionHealth, stageWord, stateWord, whyOf, zone } from "./overviewModel";
import type { Options, Setup, Trading } from "./types";
import { base, variant } from "./test/helpers";

const trading = (change: (t: Trading) => void = () => {}): Trading => variant((s) => change(s.trading!)).trading!;
const setupCopy = (t: Trading, over: Partial<Setup>): Setup => ({ ...structuredClone(t.setups[0]!), ...over });
const options = (change: (o: Options) => void = () => {}): Options => {
  const o = structuredClone(base.options!);
  change(o);
  return o;
};

describe("small words", () => {
  it("a trend is green, red or grey, with its arrow", () => {
    expect([cls("bullish"), cls("bearish"), cls("sideways"), cls(undefined)]).toEqual(["up", "down", "neu", "neu"]);
    expect([arrow("bullish"), arrow("bearish"), arrow("sideways"), arrow(null)]).toEqual(["▲", "▼", "◆", "◆"]);
  });
  it("a zone is two prices, and a missing one is a dash", () => {
    expect(zone([24281, 24287.0628])).toBe("24281.00 – 24287.06");
    expect([zone(null), zone(undefined), zone([1])]).toEqual(["–", "–", "–"]);
  });
  it("a stage is in words, and on a stale page a ready setup is said to have been", () => {
    expect(stageWord("READY_TO_ACT", false)).toBe("READY: in the entry area");
    expect(stageWord("READY_TO_ACT", true)).toBe("was in the entry area (not current)");
    expect(stageWord("BLOCKED", true)).toBe("confirmed, but BLOCKED");
    expect(stageWord("SOMETHING_NEW", false)).toBe("SOMETHING_NEW"); // (an unknown stage is shown as it is, not hidden)
    expect(stateWord("READY_TO_ACT", false)).toBe("ready");
    expect(stateWord("READY_TO_ACT", true)).toBe("was ready");
    expect(stateWord("WAITING_FOR_CONFIRMATION", false)).toBe("waiting");
    expect(stateWord("NO SETUP", false)).toBe("no setup");
    expect(stateWord("SOME_NEW_STATE", false)).toBe("some new state");
  });
  it("an ATR names the overnight gap only when it makes a difference of more than 5%", () => {
    expect(atrNote({ used: 6.06, with_gap: 6.06 })).toBe("6.1");
    expect(atrNote({ used: 10, with_gap: 10.4 })).toBe("10.0");
    expect(atrNote({ used: 10, with_gap: 10.6 })).toBe("10.0 (10.6 with the overnight gap)");
    expect(atrNote({ used: 10, with_gap: null })).toBe("10.0");
    expect([atrNote({ used: null, with_gap: 3 }), atrNote(null), atrNote(undefined)]).toEqual(["–", "–", "–"]);
  });
});

describe("liveSetup", () => {
  it("is the setup the decision names", () => {
    const t = trading((x) => { x.setups.unshift(setupCopy(x, { id: "other:bear:1", direction: "PE" })); });
    expect(liveSetup(t)?.id).toBe(t.decision.setup_id);
  });
  it("is the one the explanation is about when the decision names none", () => {
    const t = trading((x) => { x.decision.setup_id = null; });
    expect(liveSetup(t)?.id).toBe(t.explain?.setup);
  });
  it("is none when neither names one", () => {
    expect(liveSetup(trading((x) => { x.decision.setup_id = null; x.explain = null; }))).toBeNull();
    expect(liveSetup(trading((x) => { x.setups = []; }))).toBeNull();
  });
});

describe("eventConcise", () => {
  it("takes the status off the front, because the status has its own column", () => {
    expect(eventConcise("CONFIRMED: trigger 24,281.00")).toEqual(["trigger 24,281.00", false]);
    expect(eventConcise("trigger 24,281.00")).toEqual(["trigger 24,281.00", false]);
  });
  it("leaves a text of 110 characters whole and shortens a longer one at a word, with the rest one click away", () => {
    const hundred10 = "a".repeat(110);
    expect(eventConcise(hundred10)).toEqual([hundred10, false]);
    const words = Array.from({ length: 30 }, (_, i) => `word${i}`).join(" "); // 200+ characters of words
    const [short, more] = eventConcise(words);
    expect(more).toBe(true);
    expect(short.endsWith("…") && short.length <= 111 && !short.slice(0, -1).endsWith(" ")).toBe(true);
    expect(words.startsWith(short.slice(0, -1))).toBe(true);
    expect(words.charAt(short.length - 1)).toBe(" "); // it was cut at a space
  });
  it("cuts a text just over 110 characters, not 120", () => {
    const text = Array.from({ length: 14 }, (_, i) => `word${String(i).padStart(2, "0")}`).join(" "); // 6 characters a word and a space: 97 characters, then 8 more words
    const hundred15 = (text + " " + "z".repeat(40)).slice(0, 115);
    expect(hundred15).toHaveLength(115);
    expect(eventConcise(hundred15)[1]).toBe(true);
  });
  it("cuts a text with no space near the end where it is", () => {
    const [short, more] = eventConcise("x".repeat(200));
    expect([short, more]).toEqual(["x".repeat(110) + "…", true]);
    const early = "short " + "y".repeat(150); // the only space is before character 70: not a place to cut
    expect(eventConcise(early)[0]).toBe(early.slice(0, 110) + "…");
  });
});

describe("monitor", () => {
  it("lists the decision's setup first, and the strategies without a setup apart", () => {
    const t = trading((x) => { x.setups.unshift(setupCopy(x, { id: "other:bear:1", strategy: "failed_breakout", strategy_name: "Failed Breakout", direction: "PE", status: "DETECTED" })); });
    const m = monitor(t);
    expect(m.live.map((x) => x.id)).toEqual([t.decision.setup_id, "other:bear:1"]);
    expect(m.idle.map((z) => z.id)).toEqual(t.strategies.filter((z) => !z.setups.length).map((z) => z.id));
    expect(m.watching).toBe(m.idle.filter((z) => z.active).length);
    expect(m.watching).toBeGreaterThan(0);
    expect(m.watching).toBeLessThan(m.idle.length); // (some are not suited to the market)
  });
  it("says once when a call and a put setup are both live, and only for the ones that are waiting or confirmed", () => {
    const both = trading((x) => { x.setups.push(setupCopy(x, { id: "o:bear:1", strategy_name: "Range Bounce", direction: "PE", status: "WAITING_FOR_CONFIRMATION" })); });
    expect(monitor(both).conflicts).toEqual(["a call and a put setup are both live (CE Trend Pullback, PE Range Bounce): neither is taken"]);
    const detected = trading((x) => { x.setups.push(setupCopy(x, { id: "o:bear:1", direction: "PE", status: "DETECTED" })); });
    expect(monitor(detected).conflicts).toEqual([]); // a setup that was only detected is not a conflict yet
    const same = trading((x) => { x.setups.push(setupCopy(x, { id: "o:bull:1", direction: "CE", status: "CONFIRMED" })); });
    expect(monitor(same).conflicts).toEqual([]); // two calls agree
  });
  it("carries the decision's 'ignored' reasons as conflicts, and nothing else of its reasons", () => {
    const t = trading((x) => { x.decision.against = ["ignored a put setup: the 1H runs against it", "15M RSI 73.9: stretched"]; });
    expect(monitor(t).conflicts).toEqual(["ignored a put setup: the 1H runs against it"]);
  });
  it("names the first blocker of a setup, or else its own words", () => {
    const t = trading();
    expect(whyOf(t.setups[0]!)).toBe("confirmed, price is in the entry area and nothing blocks entry");
    expect(whyOf(setupCopy(t, { blockers: ["only 18.0 pts to the next level", "second"] }))).toBe("only 18.0 pts to the next level");
    expect(whyOf(setupCopy(t, { blockers: [], stage_text: "" }))).toBe("");
  });
});

describe("factCell", () => {
  const fact = (state: string, summary = "why") => ({ state, summary, checks: [] });
  it("a held fact is named in its colour, with what it was made from in the tooltip", () => {
    expect(factCell("strong_trend", fact("bullish", "ADX 100"))).toMatchObject({ klass: "up", word: "bullish", name: "Strong trend", title: "Strong trend: bullish — ADX 100", unknown: false });
    expect(factCell("strong_trend", fact("bearish")).klass).toBe("down");
    expect(factCell("pause", fact("pullback")).klass).toBe("flat");
    expect(factCell("extended", fact("down")).klass).toBe("down");
    expect(factCell("compression", fact("something_new")).klass).toBe("flat"); // (a state this page does not know is a held fact in amber, not hidden)
    expect(factCell("pause", fact("range_bound")).word).toBe("range bound");
  });
  it("'none' and 'no' are muted: nothing holds", () => {
    expect(factCell("compression", fact("none"))).toMatchObject({ klass: "mut", word: "none", unknown: false });
    expect(factCell("compression", fact("no"))).toMatchObject({ klass: "mut", word: "none", unknown: false });
  });
  it("unknown is its own thing and is never drawn as none", () => {
    for (const f of [null, undefined, fact(""), fact("unknown", "")]) expect(factCell("extended", f)).toMatchObject({ klass: "unk", word: "unknown", unknown: true });
    expect(factCell("extended", null).why).toBe("no regime data has been received");
    expect(factCell("extended", fact("unknown", "needs 30 candles")).why).toBe("needs 30 candles");
  });
});

describe("contractOffer: a contract is named only when the final decision calls for it", () => {
  const t = trading(); // BUY CE
  it("is the selected contract when the decision, the options' decision and the contract all say CE", () => {
    expect(contractOffer(t, options()).contract?.strike).toBe(24200);
  });
  it.each([
    ["the final decision is not a BUY", (x: Trading) => { x.decision.action = "WAIT"; }, () => {}],
    ["the final decision is the other side", (x: Trading) => { x.decision.action = "BUY PE"; }, () => {}],
    ["the options carry another decision", () => {}, (o: Options) => { o.decision = { action: "BUY PE" }; }],
    ["the selection is not actionable", () => {}, (o: Options) => { o.selection!.actionable = false; }],
    ["the selection is of the other side", () => {}, (o: Options) => { o.selection!.kind = "PE"; }],
    ["the contract is of the other side", () => {}, (o: Options) => { o.selection!.contract!.kind = "PE"; }],
    ["there is no contract", () => {}, (o: Options) => { o.selection!.contract = null; }],
    ["there is no selection", () => {}, (o: Options) => { delete o.selection; }],
    ["the decision is not a BUY though it names a side", (x: Trading) => { x.decision.action = "SELL CE"; }, (o: Options) => { o.decision = { action: "SELL CE" }; }],
  ])("is none when %s", (_name, changeT, changeO) => {
    expect(contractOffer(trading(changeT), options(changeO)).contract).toBeNull();
  });
  it("is none when there is no decision at all", () => {
    expect(contractOffer(null, options()).contract).toBeNull();
  });
});

describe("optionHealth", () => {
  const withFreshness = (...states: string[]) => options((o) => { o.contracts = states.map((freshness, i) => ({ ...structuredClone(base.options!.contracts![0]!), kind: "CE", strike: 24000 + i, freshness })); o.selection!.contract = null; });
  it("says there are no option quotes before there are", () => {
    expect(optionHealth(undefined, trading()).kind).toBe("none");
    expect(optionHealth({ available: false }, trading()).kind).toBe("none");
  });
  it("counts the contracts by freshness and names the selected one", () => {
    const h = optionHealth(options(), trading());
    expect(h).toMatchObject({ kind: "counts", total: 28, fresh: 28, stale: 0, unknown: 0, noData: 0, freshClass: "up" });
    expect(h.selected?.strike).toBe(24200);
  });
  it("is amber when some are stale or unknown, grey when none is fresh", () => {
    expect(optionHealth(withFreshness("fresh", "stale", "fresh"), trading())).toMatchObject({ fresh: 2, stale: 1, freshClass: "flat", selected: null });
    expect(optionHealth(withFreshness("fresh", "unknown"), trading())).toMatchObject({ fresh: 1, unknown: 1, freshClass: "flat" });
    expect(optionHealth(withFreshness("fresh", "no data", "no data"), trading())).toMatchObject({ fresh: 1, noData: 2, freshClass: "up" }); // (no data is counted but is not 'stale' or 'unknown')
    expect(optionHealth(withFreshness("stale", "stale"), trading())).toMatchObject({ fresh: 0, freshClass: "neu" });
  });
  it("is 'market closed' only when every contract says so", () => {
    expect(optionHealth(withFreshness("market closed", "market closed"), trading())).toMatchObject({ kind: "closed", total: 2 });
    expect(optionHealth(withFreshness("market closed", "fresh"), trading()).kind).toBe("counts");
  });
});
