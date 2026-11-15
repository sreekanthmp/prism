import { describe, expect, it } from "vitest";
import { allOn, barTime, candleBars, declutter, diffBars, IST_SHIFT, legendFor, levelLines, lineData, overlays, sameToggles, setupLine, simpleOn, swingMarkers, timeOf, TOGGLES, type Bar, type Bars, type Toggles } from "./chartModel";
import type { ChartData } from "./chartTypes";
import { chartBase, chartVariant } from "./test/helpers";

const last = chartBase.candles[chartBase.candles.length - 1]!; // 10:50 IST, the candle the BUY CE confirmed on
const off = (...names: (keyof Toggles)[]): Toggles => ({ ...allOn, ...Object.fromEntries(names.map((n) => [n, false])) });
const bar = (time: number, close = 100, over: Partial<Bar> = {}): Bar => ({ time, open: close - 1, high: close + 1, low: close - 2, close, ...over });
const bars = (timeframe: string, ...bs: Bar[]): Bars => ({ timeframe, bars: bs, forming: false });
const setupOf = (c: ChartData) => c.setups[0]!;

describe("times", () => {
  it("are moved to IST, so a chart that draws UTC reads the exchange's clock on any PC", () => {
    expect(IST_SHIFT).toBe(5.5 * 3600);
    expect(timeOf({ time: 1_700_000_000 })).toBe(1_700_000_000 + 19800);
    expect(barTime(timeOf(last))).toBe("06/11 10:50"); // the candle the fixture says completed at 10:55 started at 10:50 IST (the test PC is in New York)
  });

  it("are the IST calendar day for a daily candle", () => {
    expect(timeOf({ time: 1_700_000_000, date: "2026-11-05" })).toBe("2026-11-05");
    expect(barTime("2026-11-05")).toBe("05/11/2026");
  });
});

describe("candleBars", () => {
  it("is every candle of the answer, in order, as a bar with the same prices", () => {
    const b = candleBars(chartBase);
    expect(b.timeframe).toBe("5m");
    expect(b.bars).toHaveLength(60);
    expect(b.forming).toBe(false);
    expect(b.bars[59]).toEqual({ time: last.time + IST_SHIFT, open: last.open, high: last.high, low: last.low, close: last.close });
  });

  it("puts the candle still forming last, when it is newer, and says so", () => {
    const c = chartVariant((x) => { x.forming = { time: last.time + 300, open: 1, high: 3, low: 0.5, close: 2, partial: false, ticks: 7 }; });
    const b = candleBars(c);
    expect(b.bars).toHaveLength(61);
    expect(b.forming).toBe(true);
    expect(b.bars[60]).toEqual({ time: last.time + 300 + IST_SHIFT, open: 1, high: 3, low: 0.5, close: 2 });
  });

  it("does not draw a forming candle that is not newer than the last closed one", () => {
    for (const at of [last.time, last.time - 300]) {
      const b = candleBars(chartVariant((x) => { x.forming = { time: at, open: 1, high: 3, low: 0.5, close: 2, partial: true, ticks: 1 }; }));
      expect(b.bars).toHaveLength(60);
      expect(b.forming).toBe(false);
    }
  });

  it("never hands over a time out of order or twice (the chart throws on one)", () => {
    const c = chartVariant((x) => {
      const dup = structuredClone(x.candles[10]!);
      x.candles.splice(11, 0, dup); // the same time twice
      x.candles.splice(20, 0, structuredClone(x.candles[2]!)); // an old time, late
    });
    const times = candleBars(c).bars.map((b) => b.time as number);
    expect(times).toHaveLength(60);
    expect(times).toEqual([...new Set(times)].sort((a, b) => a - b));
  });

  it("draws a daily candle on its day", () => {
    const c = chartVariant((x) => {
      x.timeframe = "1d";
      x.candles = x.candles.slice(0, 3).map((k, i) => ({ ...k, date: `2026-11-0${i + 1}` }));
      x.forming = null;
    });
    expect(candleBars(c).bars.map((b) => b.time)).toEqual(["2026-11-01", "2026-11-02", "2026-11-03"]);
  });

  it("has nothing to draw for an answer with no candles", () => {
    expect(candleBars(chartVariant((x) => { x.candles = []; x.forming = null; })).bars).toEqual([]);
  });
});

describe("diffBars: how the chart gets from what it shows to what the answer says", () => {
  const A = bars("5m", bar(1), bar(2), bar(3));
  it("starts with a reset when nothing is shown, or what is shown has no bars", () => {
    expect(diffBars(null, A)).toEqual({ kind: "reset" });
    expect(diffBars(bars("5m"), A)).toEqual({ kind: "reset" });
  });

  it("resets for another timeframe, even when the times happen to match", () => {
    expect(diffBars(A, { ...A, timeframe: "15m" })).toEqual({ kind: "reset" });
  });

  it("only updates the last bar when the same candle has moved (the zoom stays where the viewer left it)", () => {
    const moved = bars("5m", bar(1), bar(2), bar(3, 105));
    expect(diffBars(A, moved)).toEqual({ kind: "update", bars: [bar(3, 105)] });
    expect(diffBars(A, A)).toEqual({ kind: "update", bars: [bar(3)] }); // nothing changed: the same bar again, which changes nothing
  });

  it("updates with the new bars when candles were added after the last one", () => {
    expect(diffBars(A, bars("5m", bar(1), bar(2), bar(3), bar(4), bar(5)))).toEqual({ kind: "update", bars: [bar(3), bar(4), bar(5)] });
  });

  it("updates when the window moved on by one (the oldest bar dropped off the answer)", () => {
    expect(diffBars(A, bars("5m", bar(2), bar(3), bar(4)))).toEqual({ kind: "update", bars: [bar(3), bar(4)] });
  });

  it("follows a forming candle that completes: the same time, now final, and a new forming one after it", () => {
    const withForming = bars("5m", bar(1), bar(2), bar(3));
    const next = bars("5m", bar(1), bar(2), bar(3, 101), bar(4, 102));
    expect(diffBars(withForming, next)).toEqual({ kind: "update", bars: [bar(3, 101), bar(4, 102)] });
  });

  it("resets when the bar the chart ended on is gone (a forming candle that is no longer there)", () => {
    expect(diffBars(A, bars("5m", bar(1), bar(2)))).toEqual({ kind: "reset" });
    expect(diffBars(A, bars("5m", bar(10), bar(11)))).toEqual({ kind: "reset" }); // a window that moved far on
  });

  it("resets when an earlier bar is not what it was (the history was refreshed)", () => {
    expect(diffBars(A, bars("5m", bar(1), bar(2, 150), bar(3)))).toEqual({ kind: "reset" });
    expect(diffBars(A, bars("5m", bar(1, 150), bar(2), bar(3)))).toEqual({ kind: "reset" });
  });

  it("resets when the answer reaches further back than the chart does", () => {
    expect(diffBars(A, bars("5m", bar(0), bar(1), bar(2), bar(3)))).toEqual({ kind: "reset" });
  });
});

describe("lines and markers", () => {
  it("an EMA line is the answer's points with the same times as the bars", () => {
    const l = lineData(chartBase.ema20);
    expect(l).toHaveLength(60);
    expect(l[59]).toEqual({ time: last.time + IST_SHIFT, value: chartBase.ema20![59]!.value });
    expect(lineData(undefined)).toEqual([]);
  });

  it("an EMA line never has a time out of order or twice", () => {
    expect(lineData([{ time: 5, value: 1 }, { time: 5, value: 2 }, { time: 4, value: 3 }, { time: 6, value: 4 }]).map((p) => p.value)).toEqual([1, 4]);
  });

  it("a swing high is marked above its candle and a swing low below it", () => {
    const b = candleBars(chartBase).bars;
    const m = swingMarkers(chartBase.swings, b);
    expect(m).toHaveLength(chartBase.swings!.length);
    expect(m.length).toBeGreaterThan(0);
    for (const [i, s] of chartBase.swings!.entries()) {
      expect(m[i]).toMatchObject(s.kind === "H" ? { position: "aboveBar", shape: "arrowDown", role: "swingHigh", text: "H" } : { position: "belowBar", shape: "arrowUp", role: "swingLow", text: "L" });
      expect(m[i]!.time).toBe(s.time + IST_SHIFT);
    }
  });

  it("a swing on a candle that is not drawn is not marked", () => {
    expect(swingMarkers([{ time: 1, kind: "H", price: 5 }], candleBars(chartBase).bars)).toEqual([]);
    expect(swingMarkers(undefined, [])).toEqual([]);
  });
});

describe("overlays: the horizontal lines", () => {
  // The real answer: price 24285.00, the previous day's high 24270.55, low 24080.25 and close 24250.00, and a session that opened exactly at that close. The ATR is 6.06, so two labels closer than 4.55 are drawn as one.
  const distinct = (c: ChartData) => { c.levels!.session_open = 24260; }; // 10 from the close: a line of its own
  const spread = chartVariant((x) => {
    distinct(x);
    x.levels!.support = [{ price: 24230, touches: 3 }, { price: 24200, touches: 1 }, { price: 24150, touches: 4 }];
    x.levels!.resistance = [{ price: 24310, touches: 4 }, { price: 24350, touches: 2 }];
  });
  const noSetups = (...names: (keyof Toggles)[]): Toggles => off("setups", ...names);
  const keys = (c: ChartData, on: Toggles) => overlays(c, on).map((o) => o.key);

  it("are the previous day's high, low and close and the session's open, named in words, and the setup's trigger, entry area, invalidation and target", () => {
    const c = chartVariant(distinct);
    const all = overlays(c, allOn);
    const by = (key: string) => all.find((o) => o.key === key);
    const s = setupOf(c);
    const pd = c.levels!.previous_day!;
    expect(all.map((o) => o.key)).toEqual(["pdh", "pdl", "pdc", "open", `${s.id}|trigger`, `${s.id}|zone-lo`, `${s.id}|zone-hi`, `${s.id}|invalidation`, `${s.id}|target1`]);
    expect([by("pdh"), by("pdl"), by("pdc"), by("open")].map((o) => [o?.price, o?.role, o?.title])).toEqual([
      [pd.pdh, "previous", "Prev day high"], [pd.pdl, "previous", "Prev day low"], [pd.pdc, "previous", "Prev day close"], [24260, "open", "Today's open"],
    ]);
    expect(by(`${s.id}|trigger`)).toMatchObject({ price: s.trigger, role: "trigger", title: "CE trigger", focus: true });
    expect(by(`${s.id}|zone-lo`)).toMatchObject({ price: Math.min(...s.zone!), role: "zone", title: "CE entry area" });
    expect(by(`${s.id}|zone-hi`)).toMatchObject({ price: Math.max(...s.zone!), role: "zone" });
    expect(by(`${s.id}|invalidation`)).toMatchObject({ price: s.invalidation, role: "invalidation", title: "CE invalidation" });
    expect(by(`${s.id}|target1`)).toMatchObject({ price: s.targets[0]!.price, role: "target", title: "CE target 1" });
  });

  it("a session that opened at the previous close has one line for both, named for both", () => {
    const o = overlays(chartBase, noSetups());
    expect(o.map((x) => [x.key, x.price, x.title])).toEqual([["pdh", 24270.55, "Prev day high"], ["pdl", 24080.25, "Prev day low"], ["pdc", 24250, "Prev day close + Today's open"]]);
  });

  it("every one is drawn at a number, and the entry area is low first however the zone came", () => {
    expect(overlays(chartBase, allOn).every((o) => Number.isFinite(o.price))).toBe(true);
    const flipped = chartVariant((c) => { c.setups[0]!.zone = [30, 20]; });
    expect(overlays(flipped, allOn).filter((o) => o.role === "zone").map((o) => o.price)).toEqual([20, 30]);
  });

  it("'Key levels' puts the four of the two days and the nearest support and resistance on the chart, 'More levels' the rest", () => {
    expect(keys(spread, noSetups())).toEqual(["pdh", "pdl", "pdc", "open", "s0", "s1", "s2", "r0", "r1"]); // (both)
    expect(keys(spread, noSetups("moreLevels"))).toEqual(["pdh", "pdl", "pdc", "open", "s0", "r0"]); // the nearest support at or under 24285.00 is 24230, the nearest resistance over it is 24310
    expect(keys(spread, noSetups("levels"))).toEqual(["s1", "s2", "r1"]);
    expect(keys(spread, noSetups("levels", "moreLevels"))).toEqual([]);
  });

  it("names a support and a resistance with how often price turned there: '1 touch', '3 touches'", () => {
    const o = overlays(spread, noSetups());
    expect(o.filter((x) => x.role === "support" || x.role === "resistance").map((x) => [x.key, x.price, x.title])).toEqual([
      ["s0", 24230, "Support · 3 touches"], ["s1", 24200, "Support · 1 touch"], ["s2", 24150, "Support · 4 touches"], ["r0", 24310, "Resistance · 4 touches"], ["r1", 24350, "Resistance · 2 touches"],
    ]);
  });

  it("the key support and resistance go by the price, not by where the server listed them", () => {
    const c = chartVariant((x) => { distinct(x); x.levels!.support = [{ price: 24150, touches: 4 }, { price: 24230, touches: 3 }, { price: 24200, touches: 1 }]; x.levels!.resistance = [{ price: 24350, touches: 2 }, { price: 24310, touches: 4 }]; });
    expect(keys(c, noSetups("moreLevels"))).toEqual(["pdh", "pdl", "pdc", "open", "s1", "r1"]);
  });

  it("a level price has crossed is not the nearest any more: a support over the price, a resistance under it, are not the key ones; one exactly at the price is a support, not a resistance", () => {
    const crossed = chartVariant((x) => { distinct(x); x.levels!.support = [{ price: 24300, touches: 2 }, { price: 24230, touches: 3 }]; x.levels!.resistance = [{ price: 24270, touches: 1 }, { price: 24310, touches: 2 }]; });
    expect(keys(crossed, noSetups("moreLevels")).filter((k) => /^[sr]/.test(k))).toEqual(["s1", "r1"]);
    const at = chartVariant((x) => { distinct(x); x.levels!.support = [{ price: 24285, touches: 2 }]; x.levels!.resistance = [{ price: 24285, touches: 1 }, { price: 24310, touches: 2 }]; });
    expect(keys(at, noSetups("moreLevels")).filter((k) => /^[sr]/.test(k))).toEqual(["s0", "r1"]);
  });

  it("with no support at or under the price (or no resistance over it) there is no key one: it is a 'More levels' line", () => {
    const c = chartVariant((x) => { distinct(x); x.levels!.support = [{ price: 24300, touches: 2 }]; x.levels!.resistance = [{ price: 24270, touches: 1 }]; });
    expect(keys(c, noSetups("moreLevels")).filter((k) => /^[sr]/.test(k))).toEqual([]);
    expect(keys(c, noSetups("levels"))).toEqual(["s0", "r0"]);
  });

  it("the price is the answer's, else the forming candle's close, else the last candle's: and with none the first of each is the key one", () => {
    const own = (price: number | null, close: number | null) => chartVariant((x) => {
      distinct(x);
      x.levels!.support = [{ price: 24330, touches: 5 }, { price: 24230, touches: 3 }];
      x.levels!.resistance = [{ price: 24310, touches: 4 }, { price: 24350, touches: 2 }];
      x.price = price;
      x.forming = close === null ? null : { time: 1793942700, open: 24320, high: 24322, low: 24319, close, partial: false, ticks: 2 };
    });
    const rows = (c: ChartData) => keys(c, noSetups("moreLevels")).filter((k) => /^[sr]/.test(k));
    expect(rows(own(24340, 24320))).toEqual(["s0", "r1"]); // the answer's price, 24340: under it 24330, over it 24350
    expect(rows(own(null, 24320))).toEqual(["s1", "r1"]); // no price: the forming candle's close, 24320: the highest support at or under it is 24230, the lowest resistance over it is 24350 (24310 is under it now)
    expect(rows(own(null, null))).toEqual(["s1", "r0"]); // no price and nothing forming: the last closed candle's close, 24285: under it 24230, over it 24310
  });

  it("with no price at all the nearest ones as the server listed them are the key ones", () => {
    const c = chartVariant((x) => { distinct(x); x.price = null; x.forming = null; x.candles = []; x.levels!.support = [{ price: 24230, touches: 3 }, { price: 24200, touches: 1 }]; x.levels!.resistance = [{ price: 24310, touches: 4 }, { price: 24350, touches: 2 }]; });
    expect(keys(c, noSetups("moreLevels")).filter((k) => /^[sr]/.test(k))).toEqual(["s0", "r0"]);
  });

  it("'Key levels' and 'More levels' off take away the levels and only those; 'Setup lines' off the setup's lines and only those", () => {
    expect(overlays(chartBase, off("levels", "moreLevels")).map((o) => o.role)).toEqual(["trigger", "zone", "zone", "invalidation", "target"]);
    expect(overlays(chartBase, off("setups")).map((o) => o.key)).toEqual(["pdh", "pdl", "pdc"]);
    expect(overlays(chartBase, off("setups", "levels", "moreLevels"))).toEqual([]);
  });

  it("a setup with no trigger, no zone or no target has no line for it, and a missing previous day or open has none", () => {
    const c = chartVariant((x) => {
      const s = setupOf(x);
      s.trigger = null; s.zone = null; s.targets = []; x.levels!.previous_day = null; x.levels!.session_open = null;
    });
    expect(overlays(c, allOn).map((o) => o.role)).toEqual(["invalidation"]);
    expect(overlays(chartVariant((x) => { x.setups = []; }), off("levels", "moreLevels"))).toEqual([]);
    expect(overlays(chartVariant((x) => { delete x.levels; }), noSetups())).toEqual([]);
  });

  it("a setup that is not the decision's is drawn too, and is not in focus; PE lines say PE", () => {
    const c = chartVariant((x) => { const s = structuredClone(setupOf(x)); s.id = "other:bear:1"; s.direction = "PE"; s.focus = false; x.setups.push(s); });
    const o = overlays(c, allOn).filter((x) => x.key.startsWith("other:bear:1|"));
    expect(o.length).toBe(5);
    expect(o.every((x) => !x.focus && x.title.startsWith("PE "))).toBe(true);
  });

  it("two setups never share a line (their keys differ)", () => {
    const c = chartVariant((x) => { const s = structuredClone(setupOf(x)); s.id = "other:bear:1"; x.setups.push(s); });
    const k = overlays(c, allOn).map((o) => o.key);
    expect(new Set(k).size).toBe(k.length);
  });

  it("a setup's line is never merged into a level: a trigger on the previous day's high is drawn as well as it", () => {
    const c = chartVariant((x) => { distinct(x); setupOf(x).trigger = 24270.55; });
    expect(keys(c, allOn)).toContain("pdh");
    expect(keys(c, allOn)).toContain(`${setupOf(c).id}|trigger`);
  });
});

describe("levels that sit close together are drawn once", () => {
  // the gap is three quarters of the ATR: 0.75 x 6.0628 = 4.547 points (and, with no ATR, a twentieth of a per cent of the price: 24285 x 0.0005 = 12.14)
  const near = (support: number, over: (c: ChartData) => void = () => {}) => chartVariant((x) => { x.levels!.session_open = 24260; x.levels!.support = [{ price: support, touches: 2 }]; x.levels!.resistance = []; over(x); });
  const lines = (c: ChartData) => overlays(c, off("setups")).map((o) => [o.key, o.title]);

  it("a support within the gap of the previous close is drawn under the previous close, named for both", () => {
    expect(lines(near(24254.5))).toContainEqual(["pdc", "Prev day close + Support"]);
    expect(lines(near(24254.5)).map((l) => l[0])).not.toContain("s0");
  });

  it("the gap is 4.55 points: 4.5 away is one line, 4.6 away is two", () => {
    expect(lines(near(24254.5)).map((l) => l[0])).not.toContain("s0"); // 4.5 under the close
    expect(lines(near(24254.6)).map((l) => l[0])).toContain("s0"); // 4.6 under the close... which is also 5.4 under the next one up
    expect(lines(near(24245.5)).map((l) => l[0])).not.toContain("s0"); // 4.5 over the close
    expect(lines(near(24245.4)).map((l) => l[0])).toContain("s0"); // 4.6 over the close
  });

  it("two levels exactly a gap apart are two lines: only closer ones are drawn as one", () => {
    const exact = (support: number) => near(support, (x) => { x.facts!.atr14_intraday = 8; }); // the gap is 0.75 x 8 = 6 points
    expect(lines(exact(24244)).map((l) => l[0])).toContain("s0"); // exactly 6 under the close: its own line
    expect(lines(exact(24244.1)).map((l) => l[0])).not.toContain("s0"); // 5.9 under it: drawn once
  });

  it("an ATR of nothing is no ATR: the gap is the twentieth of a per cent of the price, not no gap at all", () => {
    const zero = (support: number) => near(support, (x) => { x.facts!.atr14_intraday = 0; });
    expect(lines(zero(24238)).map((l) => l[0])).not.toContain("s0"); // 12 under the close: drawn once
    expect(lines(zero(24237.8)).map((l) => l[0])).toContain("s0"); // 12.2 under it: its own line
  });

  it("with no ATR the gap is a twentieth of a per cent of the price: 12.1 points", () => {
    const noAtr = (support: number) => near(support, (x) => { x.facts = null; });
    expect(lines(noAtr(24238)).map((l) => l[0])).not.toContain("s0"); // 12 under the close
    expect(lines(noAtr(24237.8)).map((l) => l[0])).toContain("s0"); // 12.2 under it
  });

  it("the most important of a group keeps its line: the previous high and low, then the close, then the open, then the key support and resistance, then the others", () => {
    const l = (key: string, price: number, core: boolean, name: string) => ({ key, price, role: "support" as const, title: name, focus: false, core, name });
    expect(declutter([l("s5", 100, false, "Support"), l("pdc", 102, true, "Prev day close")], 5)).toEqual([{ key: "pdc", price: 102, role: "support", focus: false, title: "Prev day close + Support" }]);
    expect(declutter([l("open", 100, true, "Today's open"), l("pdc", 102, true, "Prev day close")], 5).map((o) => o.title)).toEqual(["Prev day close + Today's open"]);
    expect(declutter([l("s1", 100, false, "Support"), l("s0", 102, true, "Support")], 5).map((o) => o.key)).toEqual(["s0"]); // the key one over the other
    expect(declutter([l("s1", 100, false, "Support"), l("s2", 102, false, "Support")], 5).map((o) => o.key)).toEqual(["s1"]); // equals: the one listed first
    expect(declutter([l("pdh", 102, true, "Prev day high"), l("pdc", 100, true, "Prev day close")], 5).map((o) => o.title)).toEqual(["Prev day high + Prev day close"]); // the high before the close
  });

  it("a group is named once for each kind it holds, and the lines keep the order they came in", () => {
    const c = chartVariant((x) => { x.levels!.session_open = 24260; x.levels!.support = [{ price: 24251, touches: 2 }, { price: 24248, touches: 5 }]; x.levels!.resistance = [{ price: 24310, touches: 4 }]; });
    expect(lines(c)).toEqual([["pdh", "Prev day high"], ["pdl", "Prev day low"], ["pdc", "Prev day close + Support"], ["open", "Today's open"], ["r0", "Resistance · 4 touches"]]);
  });

  it("the nearest level in the line under the legend does not go by what is merged: it names every one", () => {
    const names = levelLines(near(24254.5)).map((x) => x.key);
    expect(names).toEqual(["pdh", "pdl", "pdc", "open", "s0"]);
    expect(levelLines(chartVariant((x) => { delete x.levels; }))).toEqual([]);
  });
});

describe("what is on the chart to begin with", () => {
  it("is the candles, the two averages, the key levels, the setup's lines and where the decision changed: not the swings, not the other levels", () => {
    expect(simpleOn).toEqual({ ema20: true, ema50: true, levels: true, moreLevels: false, setups: true, swings: false, decisions: true });
    expect(allOn).toEqual({ ema20: true, ema50: true, levels: true, moreLevels: true, setups: true, swings: true, decisions: true });
  });

  it("has a box for each, in the order they are drawn, each with a plain-words hover text", () => {
    expect(TOGGLES.map((x) => [x.id, x.label])).toEqual([
      ["ema20", "EMA 20"], ["ema50", "EMA 50"], ["levels", "Key levels"], ["moreLevels", "More levels"], ["setups", "Setup lines"], ["swings", "Swings"], ["decisions", "Decisions"],
    ]);
    expect(TOGGLES.every((x) => x.hint.length > 40)).toBe(true);
    expect(TOGGLES.find((x) => x.id === "swings")?.hint).toContain("off to begin with");
    expect(TOGGLES.find((x) => x.id === "moreLevels")?.hint).toContain("off to begin with");
  });

  it("tells one view from another box by box", () => {
    expect(sameToggles(simpleOn, simpleOn)).toBe(true);
    expect(sameToggles(simpleOn, allOn)).toBe(false);
    expect(sameToggles({ ...simpleOn, swings: true }, allOn)).toBe(false);
    expect(sameToggles({ ...allOn }, allOn)).toBe(true);
    for (const k of Object.keys(allOn) as (keyof Toggles)[]) expect(sameToggles({ ...simpleOn, [k]: !simpleOn[k] }, simpleOn), k).toBe(false);
  });
});

describe("the legend", () => {
  const two = [bar(1, 100), bar(2, 101.5), bar(3, 99), bar(4, 99)];
  it("says a bar's prices with two decimals and its time", () => {
    const l = legendFor(candleBars(chartBase).bars, 59)!;
    expect(l).toMatchObject({ when: "06/11 10:50", open: last.open.toFixed(2), high: last.high.toFixed(2), low: last.low.toFixed(2), close: last.close.toFixed(2) });
  });

  it("gives the move from the bar before, in points and per cent, up in green and down in red", () => {
    expect(legendFor(two, 1)).toMatchObject({ change: "+1.50 (+1.50%)", tone: "up" });
    expect(legendFor(two, 2)).toMatchObject({ change: "-2.50 (-2.46%)", tone: "down" });
    expect(legendFor(two, 3)).toMatchObject({ change: "0.00 (0.00%)", tone: "neu" });
  });

  it("has no move for the first bar and says so, not zero", () => {
    expect(legendFor(two, 0)).toMatchObject({ change: "–", tone: "neu" });
  });

  it("has nothing to say about a bar that does not exist", () => {
    expect(legendFor(two, 9)).toBeNull();
    expect(legendFor([], 0)).toBeNull();
  });
});

describe("setupLine: the setup in words and numbers", () => {
  it("says the numbers its lines are drawn at", () => {
    const s = setupOf(chartBase);
    const l = setupLine(s);
    expect(l).toMatchObject({ id: s.id, focus: true, head: "CE · Trend Pullback", stage: "confirmed, price is in the entry area and nothing blocks entry" });
    expect(l.prices).toEqual([
      `Trigger ${s.trigger!.toFixed(2)}`,
      `Entry area ${Math.min(...s.zone!).toFixed(2)}–${Math.max(...s.zone!).toFixed(2)}`,
      `Invalidation ${s.invalidation!.toFixed(2)}`,
      `Target 1 ${s.targets[0]!.price!.toFixed(2)} (prior high (where this pullback started))`,
    ]);
  });

  it("says plainly when no target is named, and shows an unknown number as a dash", () => {
    const c = chartVariant((x) => { const s = setupOf(x); s.targets = []; s.trigger = null; s.zone = null; s.stage_text = null; });
    const l = setupLine(setupOf(c));
    expect(l.prices).toEqual(["Trigger –", "Entry area –", `Invalidation ${setupOf(c).invalidation!.toFixed(2)}`, "No target named"]);
    expect(l.stage).toBe("CONFIRMED"); // with no words from the server, the status
  });
});
