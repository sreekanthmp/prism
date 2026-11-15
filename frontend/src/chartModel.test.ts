import { describe, expect, it } from "vitest";
import { allOn, barTime, candleBars, diffBars, IST_SHIFT, legendFor, lineData, overlays, setupLine, swingMarkers, timeOf, type Bar, type Bars, type Toggles } from "./chartModel";
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
  const all = overlays(chartBase, allOn);
  const by = (key: string) => all.find((o) => o.key === key);

  it("are the previous day's three levels, the session open, and the setup's trigger, entry area, invalidation and target", () => {
    const s = setupOf(chartBase);
    const pd = chartBase.levels!.previous_day!;
    expect(all.map((o) => o.key)).toEqual(["pdh", "pdl", "pdc", "open", `${s.id}|trigger`, `${s.id}|zone-lo`, `${s.id}|zone-hi`, `${s.id}|invalidation`, `${s.id}|target1`]);
    expect([by("pdh")?.price, by("pdl")?.price, by("pdc")?.price, by("open")?.price]).toEqual([pd.pdh, pd.pdl, pd.pdc, chartBase.levels!.session_open]);
    expect(by(`${s.id}|trigger`)).toMatchObject({ price: s.trigger, role: "trigger", title: "CE trigger", focus: true });
    expect(by(`${s.id}|zone-lo`)).toMatchObject({ price: Math.min(...s.zone!), role: "zone", title: "CE entry area" });
    expect(by(`${s.id}|zone-hi`)).toMatchObject({ price: Math.max(...s.zone!), role: "zone" });
    expect(by(`${s.id}|invalidation`)).toMatchObject({ price: s.invalidation, role: "invalidation", title: "CE invalidation" });
    expect(by(`${s.id}|target1`)).toMatchObject({ price: s.targets[0]!.price, role: "target", title: "CE target 1" });
  });

  it("every one is drawn at a number, and the entry area is low first however the zone came", () => {
    expect(all.every((o) => Number.isFinite(o.price))).toBe(true);
    const flipped = chartVariant((c) => { c.setups[0]!.zone = [30, 20]; });
    const z = overlays(flipped, allOn).filter((o) => o.role === "zone").map((o) => o.price);
    expect(z).toEqual([20, 30]);
  });

  it("'Levels' off takes away the previous day, the open and the support and resistance, and only those", () => {
    expect(overlays(chartBase, off("levels")).map((o) => o.role)).toEqual(["trigger", "zone", "zone", "invalidation", "target"]);
  });

  it("'Setups' off takes away the setup's lines, and only those", () => {
    expect(overlays(chartBase, off("setups")).map((o) => o.key)).toEqual(["pdh", "pdl", "pdc", "open"]);
    expect(overlays(chartBase, off("setups", "levels"))).toEqual([]);
  });

  it("the nearest support and resistance are numbered from the price outwards, with how often they were touched", () => {
    const c = chartVariant((x) => { x.levels!.support = [{ price: 24200, touches: 3 }, { price: 24150, touches: 2 }]; x.levels!.resistance = [{ price: 24400, touches: 4 }]; });
    const lv = overlays(c, off("setups")).filter((o) => o.role === "support" || o.role === "resistance");
    expect(lv.map((o) => [o.key, o.price, o.title])).toEqual([["s0", 24200, "S1 ×3"], ["s1", 24150, "S2 ×2"], ["r0", 24400, "R1 ×4"]]);
  });

  it("a setup with no trigger, no zone or no target has no line for it, and a missing previous day or open has none", () => {
    const c = chartVariant((x) => {
      const s = setupOf(x);
      s.trigger = null; s.zone = null; s.targets = []; x.levels!.previous_day = null; x.levels!.session_open = null;
    });
    expect(overlays(c, allOn).map((o) => o.role)).toEqual(["invalidation"]);
    expect(overlays(chartVariant((x) => { x.setups = []; }), off("levels"))).toEqual([]);
  });

  it("a setup that is not the decision's is drawn too, and is not in focus; PE lines say PE", () => {
    const c = chartVariant((x) => { const s = structuredClone(setupOf(x)); s.id = "other:bear:1"; s.direction = "PE"; s.focus = false; x.setups.push(s); });
    const o = overlays(c, allOn).filter((x) => x.key.startsWith("other:bear:1|"));
    expect(o.length).toBe(5);
    expect(o.every((x) => !x.focus && x.title.startsWith("PE "))).toBe(true);
  });

  it("two setups never share a line (their keys differ)", () => {
    const c = chartVariant((x) => { const s = structuredClone(setupOf(x)); s.id = "other:bear:1"; x.setups.push(s); });
    const keys = overlays(c, allOn).map((o) => o.key);
    expect(new Set(keys).size).toBe(keys.length);
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
