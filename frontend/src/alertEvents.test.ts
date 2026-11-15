import { describe, expect, it } from "vitest";
import {
  ALERT_MODES, ALERT_SHOW_S, BASE_TITLE, DEFAULT_MODE, LOG_MAX, MODE_KEY, REARM, TONES, alertChanges, emptyMemo, linkLost, nextMode, noAlerts, parseMode, raised, reaction, recentAlerts, sideWord, titleFor,
  type AlertEvent, type LoggedAlert,
} from "./alertEvents";
import type { Setup, Snapshot } from "./types";
import { base, EVIL, variant } from "./test/helpers";

// What raises an alert, from two snapshots. Ported from the current dashboard's own tests (tests/test_alerts.py), which hold the same rules for that page.

const setup = base.trading!.setups[0]!;
const staged = (stage: string, over: Partial<Setup> = {}): Snapshot => variant((s) => { Object.assign(s.trading!.setups[0]!, { stage, ...over }); });
const at = (s: Snapshot, seconds: number): Snapshot => ({ ...s, server_time: s.server_time + seconds });
const readiness = (ready: boolean, state = "READY", summary = "data complete and trusted") => variant((s) => { Object.assign(s.health.readiness!, { ready, state, summary }); });
const feed = (state: string, live = true) => variant((s) => { s.connection.state = state; s.health.live = live; });
const noSetups = () => variant((s) => { s.trading!.setups = []; });

/** The snapshots one after the other, as the page meets them: every event they raise, in order. */
function play(snaps: Snapshot[]) {
  let prev: Snapshot | null = null;
  let memo = emptyMemo();
  const events: AlertEvent[] = [];
  for (const s of snaps) {
    const r = alertChanges(prev, s, memo);
    memo = r.memo;
    events.push(...r.events);
    prev = s;
  }
  return { events, memo };
}
const titles = (events: AlertEvent[]) => events.map((e) => e.title);

describe("the first snapshot and the ones that change nothing", () => {
  it("the first snapshot is a baseline, even when a setup is already ready", () => {
    expect(base.trading!.setups[0]!.stage).toBe("READY_TO_ACT");
    expect(play([base]).events).toEqual([]);
  });
  it("an unchanged snapshot raises nothing", () => {
    expect(play([base, base, base]).events).toEqual([]);
  });
  it("stages that were never ready raise nothing when they change or end", () => {
    const run = [staged("DETECTED"), staged("WAITING_FOR_CONFIRMATION"), staged("CONFIRMED"), staged("BLOCKED"), staged("INVALIDATED"), noSetups()];
    expect(play(run).events).toEqual([]);
  });
  it("with nothing to compare, or nothing new, there is nothing to say (and nothing throws)", () => {
    expect(alertChanges(base, null).events).toEqual([]);
    expect(alertChanges(base, undefined).events).toEqual([]);
    expect(alertChanges(null, base).events).toEqual([]);
    expect(alertChanges(undefined, undefined).events).toEqual([]);
  });
});

describe("a setup becomes ready", () => {
  it("raises the urgent alert and says what and where", () => {
    const { events } = play([staged("CONFIRMED"), base]);
    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect(e.level).toBe("act");
    expect(e.key).toBe("ready:" + setup.id);
    expect(e.title).toBe("CE setup ready: Trend Pullback");
    expect(e.text).toBe(`setup ${setup.id}: entry area 24281.00 – 24287.06, trigger 24281.00, invalidation 24270.48. You decide and place any order yourself.`);
  });
  it("says PE setup for a put setup, and the side as it is for anything else", () => {
    expect(titles(play([staged("CONFIRMED", { direction: "PE" }), staged("READY_TO_ACT", { direction: "PE" })]).events)).toEqual(["PE setup ready: Trend Pullback"]);
    expect([sideWord("CE"), sideWord("PE"), sideWord("X")]).toEqual(["CE setup", "PE setup", "X"]);
  });
  it("a setup that appears already ready is announced", () => {
    expect(titles(play([noSetups(), base]).events)).toEqual(["CE setup ready: Trend Pullback"]);
  });
  it("two setups ready at once are two alerts", () => {
    const other = { ...structuredClone(setup), id: "breakout_retest:bull:1793940300", strategy_name: "Breakout and Retest" };
    const first = staged("CONFIRMED");
    first.trading!.setups.push({ ...structuredClone(other), stage: "CONFIRMED" });
    const second = variant((s) => { s.trading!.setups.push(structuredClone(other)); });
    expect(titles(play([first, second]).events)).toEqual(["CE setup ready: Trend Pullback", "CE setup ready: Breakout and Retest"]);
  });
  it("is silent about an entry area that is only left (it is on the page; it is news only if the setup then ends or is blocked)", () => {
    expect(play([base, at(staged("CONFIRMED"), 5), at(staged("CONFIRMED"), 600)]).events).toEqual([]);
  });
});

describe("a ready setup stops being ready", () => {
  const cases: [string, Partial<Setup>, string][] = [
    ["BLOCKED", { blockers: ["5M candles missing 10:25-11:20 (inside the last 12 candles)"] }, "something blocks entry now: 5M candles missing 10:25-11:20 (inside the last 12 candles)."],
    ["BLOCKED", { blockers: [] }, "something blocks entry now."],
    ["INVALIDATED", {}, "it is now invalidated."],
    ["MISSED", {}, "it is now missed."],
    ["EXPIRED", {}, "it is now expired."],
    ["WAITING_FOR_CONFIRMATION", {}, "it is now waiting for confirmation."],
  ];
  it.each(cases)("%s %j: a warning that says why", (after, over, said) => {
    const { events } = play([base, staged(after, over)]);
    expect(events).toEqual([{ level: "warn", key: "ended:" + setup.id, title: "CE setup no longer ready: Trend Pullback", text: `setup ${setup.id}: ${said}` }]);
  });
  it("one that is gone altogether has ended", () => {
    expect(play([base, noSetups()]).events[0]?.text).toBe(`setup ${setup.id}: it has ended.`);
  });
  it("one that goes ready and then ends is two alerts, in the order they happened", () => {
    expect(titles(play([staged("CONFIRMED"), base, staged("INVALIDATED")]).events)).toEqual(["CE setup ready: Trend Pullback", "CE setup no longer ready: Trend Pullback"]);
  });
  it("an ended setup is always news: it cannot flicker back", () => {
    expect(titles(play([base, at(noSetups(), 5)]).events)).toEqual(["CE setup no longer ready: Trend Pullback"]);
  });
});

describe("a flickering entry area is one piece of news, not twenty (the real journal of 2026-11-11 flickered about 20 times in 7 minutes)", () => {
  it("a setup flickering in and out of the entry area raises one alert", () => {
    const snaps = Array.from({ length: 41 }, (_, i) => at(i % 2 ? base : staged("CONFIRMED"), i * 5)); // 40 changes in 200 s
    const { events } = play(snaps);
    expect(titles(events)).toEqual(["CE setup ready: Trend Pullback"]);
  });
  it("a setup that was ready when the page opened and then flickers raises nothing", () => {
    expect(play([base, at(staged("CONFIRMED"), 5), at(base, 10), at(staged("CONFIRMED"), 15), at(base, 20)]).events).toEqual([]);
  });
  it("a setup that comes back after 300 s (five minutes) is news again, and one that comes back after 299 s is not", () => {
    expect(REARM).toBe(300);
    const out = [staged("CONFIRMED"), at(base, 10), at(staged("CONFIRMED"), 20)];
    expect(play([...out, at(base, 10 + 299)]).events.filter((e) => e.level === "act")).toHaveLength(1);
    expect(play([...out, at(base, 10 + 300)]).events.filter((e) => e.level === "act")).toHaveLength(2);
  });
  it("a setup that stays ready for hours is announced once", () => {
    expect(play([staged("CONFIRMED"), ...Array.from({ length: 199 }, (_, i) => at(base, 60 * (i + 1)))]).events).toHaveLength(1);
  });
  it(`a setup blocked again and again is one warning for each ${REARM} s`, () => {
    const blocked = staged("BLOCKED", { blockers: ["the feed is not trusted"] });
    const run = [base, at(blocked, 5), at(base, 10), at(blocked, 15), at(base, 20), at(blocked, 25)];
    expect(play(run).events.filter((e) => e.key.startsWith("ended:"))).toHaveLength(1);
    expect(play([...run, at(base, 400), at(blocked, 405)]).events.filter((e) => e.key.startsWith("ended:"))).toHaveLength(2);
  });
});

describe("the data stops being trustworthy", () => {
  const bad = readiness(false, "RECOVERING_GAPS", "recovering missing candles: 5M 12 missing (10:25-11:20)");
  it("Prism no longer ready is a warning, and ready again is only noted", () => {
    const { events } = play([base, bad, base]);
    expect(events).toEqual([
      { level: "warn", key: "readiness", title: "Prism is NOT READY", text: "RECOVERING GAPS: recovering missing candles: 5M 12 missing (10:25-11:20). Decisions are blocked." },
      { level: "info", key: "readiness", title: "Prism is ready again", text: "data complete and trusted" },
    ]);
  });
  it(`flapping between ready and not ready is one warning for each ${REARM} s`, () => {
    const run = [base, at(bad, 5), at(base, 10), at(bad, 15)];
    expect(play(run).events.filter((e) => e.level === "warn")).toHaveLength(1);
    expect(play([...run, at(base, 400), at(bad, 405)]).events.filter((e) => e.level === "warn")).toHaveLength(2);
  });
  it("a page opened while Prism is not ready does not announce it", () => {
    const loading = readiness(false, "HISTORICAL_LOADING", "x");
    expect(play([loading, loading]).events).toEqual([]);
  });
  it("losing the live feed while the market is open is a warning", () => {
    expect(play([base, feed("disconnected")]).events).toEqual([{ level: "warn", key: "feed", title: "Live feed lost", text: "the feed is disconnected: no decision is current until it is back." }]);
  });
  it("a feed in a state with an underscore is spelled with spaces", () => {
    expect(play([base, feed("auth_failed")]).events[0]?.text).toBe("the feed is auth failed: no decision is current until it is back.");
  });
  it(`a feed that drops, comes back and drops is one warning for each ${REARM} s`, () => {
    expect(play([base, at(feed("disconnected"), 5), at(base, 10), at(feed("disconnected"), 15)]).events).toHaveLength(1);
    expect(play([base, at(feed("disconnected"), 5), at(base, 10), at(feed("disconnected"), 5 + 300)]).events).toHaveLength(2);
  });
  it("a feed that is down while the market is closed raises nothing, and one that was never connected is not lost", () => {
    expect(play([feed("connected", false), feed("disconnected", false)]).events).toEqual([]);
    expect(play([feed("connecting"), feed("disconnected")]).events).toEqual([]);
  });
});

describe("what the page remembers", () => {
  it("is returned, and the memo that was passed in is not changed", () => {
    const memo = emptyMemo();
    const r = alertChanges(null, base, memo);
    expect(memo).toEqual({ ready: {}, said: {} });
    expect(r.memo.ready).toEqual({ [setup.id]: base.server_time }); // (a setup ready at the first snapshot is remembered: a flicker right after opening the page is not news)
  });
  it("remembers when a warning was said", () => {
    const r = play([base, staged("BLOCKED"), feed("disconnected")]);
    expect(Object.keys(r.memo.said)).toEqual(["blocked:" + setup.id, "feed"]);
  });
});

describe("snapshots that lack things do not break it", () => {
  it("no trading section, no readiness, no setups list", () => {
    const odd = variant((s) => { s.trading = null; delete s.health.readiness; });
    expect(() => play([base, odd, base])).not.toThrow();
    const noList = variant((s) => { (s.trading as unknown as { setups: unknown }).setups = null; });
    expect(play([base, noList]).events).toEqual([expect.objectContaining({ title: "CE setup no longer ready: Trend Pullback", text: `setup ${setup.id}: it has ended.` })]);
  });
  it("a setup with no id is not a setup (it cannot be told from another)", () => {
    const anon = variant((s) => { (s.trading!.setups[0] as unknown as { id: unknown }).id = null; });
    expect(play([staged("CONFIRMED"), anon]).events).toEqual([]);
  });
  it("what a snapshot says is only ever text", () => {
    const { events } = play([staged("CONFIRMED", { id: EVIL, strategy_name: EVIL }), staged("READY_TO_ACT", { id: EVIL, strategy_name: EVIL })]);
    expect(events[0]?.title).toBe(`CE setup ready: ${EVIL}`);
  });
});

describe("the log and the count", () => {
  const ev = (key: string, level: AlertEvent["level"] = "act"): AlertEvent => ({ level, key, title: key, text: key });
  it("an empty list changes nothing (the very same state)", () => {
    expect(raised(noAlerts, [], 1)).toBe(noAlerts);
  });
  it("puts what was raised in front, newest first, stamped with the server time, and counts it as not yet seen", () => {
    const one = raised(noAlerts, [ev("a")], 100);
    const two = raised(one, [ev("b"), ev("c")], 200);
    expect(two.log.map((x) => [x.key, x.t])).toEqual([["c", 200], ["b", 200], ["a", 100]]); // (of two raised together, the last is the newest)
    expect(two.unseen).toBe(3);
    expect(noAlerts).toEqual({ log: [], unseen: 0 });
  });
  it("keeps the last 20, and the count goes on", () => {
    expect(LOG_MAX).toBe(20);
    const many = raised(noAlerts, Array.from({ length: 30 }, (_, i) => ev("k" + i)), 1);
    expect(many.log).toHaveLength(20);
    expect(many.log[0]?.key).toBe("k29");
    expect(many.unseen).toBe(30);
  });
  it("a link that is lost says when the last snapshot was", () => {
    expect(linkLost(base.server_time)).toEqual({ level: "warn", key: "link", title: "Lost the link to Prism", text: "the page is showing the snapshot made at 10:55:06 IST: nothing on it is current." });
  });
});

describe("what the one alert line shows of the events", () => {
  const entry = (key: string, t: number | null): LoggedAlert => ({ level: "act", key, title: key, text: key, t });
  it("only the setups that became ready or ended, never the readiness, the feed, the link or the loss limit (they are lines of their own)", () => {
    const log = ["ready:a", "ended:b", "readiness", "feed", "link", "daily-loss", "blocked:x", "unready:c", "notended:d"].map((k) => entry(k, 1000)); // (the key must START with ready: or ended:)
    expect(recentAlerts(log, 1000).map((x) => x.key)).toEqual(["ready:a", "ended:b"]);
  });
  it("for 600 s (ten minutes), and not a second longer", () => {
    expect(ALERT_SHOW_S).toBe(600);
    const log = [entry("ready:a", 1000)];
    expect(recentAlerts(log, 1600)).toHaveLength(1);
    expect(recentAlerts(log, 1601)).toHaveLength(0);
  });
  it("at most five, the newest", () => {
    const log = Array.from({ length: 8 }, (_, i) => entry("ready:" + i, 1000));
    expect(recentAlerts(log, 1000).map((x) => x.key)).toEqual(["ready:0", "ready:1", "ready:2", "ready:3", "ready:4"]);
  });
  it("none without a time to measure from, and none that were never stamped", () => {
    expect(recentAlerts([entry("ready:a", 1000)], null)).toEqual([]);
    expect(recentAlerts([entry("ready:a", 1000)], undefined)).toEqual([]);
    expect(recentAlerts([entry("ready:a", null)], 1000)).toEqual([]);
    expect(recentAlerts([entry("ready:a", null)], 100)).toEqual([]); // (an unstamped event is not "0 seconds ago": it is not on the line at all)
  });
});

describe("the three modes and what each does", () => {
  const list = (...levels: AlertEvent["level"][]): AlertEvent[] => levels.map((level, i) => ({ level, key: "k" + i, title: "t" + i, text: "x" }));
  it("sound + popup, sound, off, and the default is sound", () => {
    expect([...ALERT_MODES]).toEqual(["sound + popup", "sound", "off"]);
    expect(DEFAULT_MODE).toBe("sound");
    expect(MODE_KEY).toBe("prism-alert-mode");
  });
  it("the button goes round the three", () => {
    expect(nextMode("sound")).toBe("off");
    expect(nextMode("off")).toBe("sound + popup");
    expect(nextMode("sound + popup")).toBe("sound");
  });
  it("a saved mode is the one the page starts in, and junk is ignored", () => {
    expect(["off", "sound + popup", "sound"].map(parseMode)).toEqual(["off", "sound + popup", "sound"]);
    for (const junk of ["loud", "", null, undefined, 3, "SOUND"]) expect(parseMode(junk), String(junk)).toBe("sound");
  });
  it("off makes no sound and no popup", () => {
    expect(reaction("off", list("act", "warn"))).toEqual({ sound: null, popups: [] });
  });
  it("sound makes one sound, the most urgent, however many things changed, and no popup", () => {
    expect(reaction("sound", list("warn", "act", "warn"))).toEqual({ sound: "act", popups: [] });
    expect(reaction("sound", list("warn", "warn"))).toEqual({ sound: "warn", popups: [] });
  });
  it("sound + popup makes a popup for each that is not only noted", () => {
    const r = reaction("sound + popup", list("act", "info", "warn"));
    expect(r.sound).toBe("act");
    expect(r.popups.map((p) => p.key)).toEqual(["k0", "k2"]);
  });
  it("news that is only noted makes no sound and no popup", () => {
    expect(reaction("sound + popup", list("info"))).toEqual({ sound: null, popups: [] });
  });
  it("nothing raised, nothing done", () => {
    expect(reaction("sound + popup", [])).toEqual({ sound: null, popups: [] });
  });
  it("the tones are the current dashboard's", () => {
    expect(TONES).toEqual({
      act: [[880, 0], [1175, 0.2], [880, 0.4], [1175, 0.6]],
      warn: [[520, 0], [390, 0.22]],
      info: [[660, 0]],
    });
  });
});

describe("the title", () => {
  it("carries the count of what has not been seen", () => {
    expect(BASE_TITLE).toBe("Prism");
    expect([0, 1, 12].map(titleFor)).toEqual(["Prism", "(1) Prism", "(12) Prism"]);
  });
});
