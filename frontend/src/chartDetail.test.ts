import { describe, expect, it } from "vitest";
import { allOn, candleBars, decisionMarkers, detailFor, FACT_HELP, IST_SHIFT, TOGGLES, type Bar } from "./chartModel";
import type { JournalRow } from "./types";
import { chartBase, chartVariant, journalBase } from "./test/helpers";

// What the chart says beyond its candles: where Prism's decision changed (from today's journal), and what one candle says (the line under the legend). Worked out from the real answers of the engine.

const T = 1793942100; // the 5M candle that began at 10:45 IST on 06 Nov 2026
const bar = (start: number, over: Partial<Bar> = {}): Bar => ({ time: start + IST_SHIFT, open: 100, high: 110, low: 90, close: 105, ...over });
const bars = [bar(T - 300), bar(T), bar(T + 300)]; // 10:40, 10:45, 10:50
const row = (time: number, action: string | null, over: Partial<JournalRow> = {}): JournalRow => ({ ...journalBase.decisions[0]!, time, action, headline: `${action}: why`, ...over });

describe("where the decision changed", () => {
  it("a CE setup is a green arrow under its candle, a PE setup a red one over it, a WAIT an amber dot and anything else a grey dot", () => {
    const m = decisionMarkers([row(T + 10, "BUY CE"), row(T + 320, "BUY PE"), row(T - 280, "WAIT"), row(T + 20, "NO TRADE")], bars, 300);
    expect(m).toEqual([
      { time: T - 300 + IST_SHIFT, position: "belowBar", shape: "circle", tone: "warn", text: "", size: 0.8, action: "WAIT" },
      { time: T + IST_SHIFT, position: "belowBar", shape: "arrowUp", tone: "ok", text: "CE setup", size: 1.2, action: "BUY CE" },
      { time: T + IST_SHIFT, position: "belowBar", shape: "circle", tone: "mut", text: "", size: 0.6, action: "NO TRADE" },
      { time: T + 300 + IST_SHIFT, position: "aboveBar", shape: "arrowDown", tone: "bad", text: "PE setup", size: 1.2, action: "BUY PE" },
    ]);
  });

  it("a decision is on the candle it fell in: the first second of a candle is in it, the last second is, the next one is in the next", () => {
    const at = (t: number) => decisionMarkers([row(t, "WAIT")], bars, 300).map((m) => m.time);
    expect(at(T)).toEqual([T + IST_SHIFT]);
    expect(at(T + 299.9)).toEqual([T + IST_SHIFT]);
    expect(at(T + 300)).toEqual([T + 300 + IST_SHIFT]);
  });

  it("works from the candle's own length: an hour candle that began at 09:15 holds a decision at 10:00", () => {
    const nine15 = 1793934300; // 09:15 IST
    const hours = [bar(nine15 - 3600), bar(nine15)];
    expect(decisionMarkers([row(nine15 + 2700, "BUY CE")], hours, 3600).map((m) => m.time)).toEqual([nine15 + IST_SHIFT]);
    expect(decisionMarkers([row(nine15 + 3600, "BUY CE")], hours, 3600)).toEqual([]); // (the next hour is not drawn)
  });

  it("only a decision on a candle that is drawn is marked: before the first one, and after the last one's end, there is none", () => {
    expect(decisionMarkers([row(T - 301 - 300, "WAIT")], bars, 300)).toEqual([]);
    expect(decisionMarkers([row(T + 600, "WAIT")], bars, 300)).toEqual([]);
    expect(decisionMarkers([row(T + 599, "WAIT")], bars, 300)).toHaveLength(1);
  });

  it("a candle carries a decision once, but a WAIT and a BUY on one candle are both kept", () => {
    const m = decisionMarkers([row(T + 5, "WAIT"), row(T + 90, "WAIT"), row(T + 200, "BUY CE")], bars, 300);
    expect(m.map((x) => x.action)).toEqual(["WAIT", "BUY CE"]);
  });

  it("is oldest first whatever order the journal came in (it is newest first)", () => {
    const m = decisionMarkers([row(T + 310, "BUY CE"), row(T + 10, "WAIT"), row(T - 290, "NO TRADE")], bars, 300);
    expect(m.map((x) => x.action)).toEqual(["NO TRADE", "WAIT", "BUY CE"]);
  });

  it("a row with no time, no action or a time that is not a number is skipped", () => {
    expect(decisionMarkers([row(NaN, "WAIT"), row(T, null), { ...row(T, "WAIT"), time: null as unknown as number }, row(T, "")], bars, 300)).toEqual([]);
  });

  it("no journal, an empty one, or the daily chart: no marker", () => {
    expect(decisionMarkers(null, bars, 300)).toEqual([]);
    expect(decisionMarkers(undefined, bars, 300)).toEqual([]);
    expect(decisionMarkers([], bars, 300)).toEqual([]);
    const daily: Bar[] = [{ time: "2026-11-06", open: 1, high: 2, low: 0, close: 1 }];
    expect(decisionMarkers([row(T, "BUY CE")], daily, 86400)).toEqual([]);
  });

  it("works on the real journal and the real chart: the two WAITs are on their candles (the BUY is on the candle that has not formed yet)", () => {
    const b = candleBars(chartBase).bars;
    const m = decisionMarkers(journalBase.decisions, b, chartBase.seconds);
    expect(m.map((x) => [x.action, x.time])).toEqual([["WAIT", 1793941800 + IST_SHIFT], ["WAIT", 1793942100 + IST_SHIFT]]);
    const forming = chartVariant((c) => { c.forming = { time: 1793942700, open: 24285, high: 24287, low: 24284, close: 24286, partial: false, ticks: 4 }; });
    const withIt = decisionMarkers(journalBase.decisions, candleBars(forming).bars, forming.seconds);
    expect(withIt.map((x) => [x.action, x.text, x.shape])).toEqual([["WAIT", "", "circle"], ["WAIT", "", "circle"], ["BUY CE", "CE setup", "arrowUp"]]);
  });

  it("is a box under 'On the chart', on by default", () => {
    expect(TOGGLES.map((t) => t.label)).toEqual(["EMA 20", "EMA 50", "Key levels", "More levels", "Setup lines", "Swings", "Decisions"]);
    expect(allOn.decisions).toBe(true);
  });
});

describe("what one candle says", () => {
  const all = candleBars(chartBase).bars;
  const last = all.length - 1;

  it("its size in points and in the ATR, how it closed, where it closed against the two EMAs, and the nearest level under it", () => {
    const d = detailFor(chartBase, all, last)!;
    expect(d.range).toBe("8.00 pts");
    expect(d.atr).toBe("1.3× the ATR(14) of 6.1"); // 8.00 / 6.06
    expect(d.body).toBe("closed up 6.50");
    expect(d.ema20).toBe("24279.15 (the close is 5.85 above)");
    expect(d.ema50).toBe("24250.00 (the close is 35.00 above)");
    expect(d.below).toEqual({ label: "Prev day high", price: "24270.55", where: "14.5 below" }); // the nearest of the previous day's high, low and close and the open
    expect(d.above).toBeNull(); // nothing over it
    expect(d.decisions).toEqual([]);
  });

  it("the candle before it, with its own numbers", () => {
    const d = detailFor(chartBase, all, last - 1)!;
    expect(d.range).toBe("3.00 pts");
    expect(d.body).toBe("closed down 0.50");
    expect(d.ema20).toBe("24278.54 (the close is 0.04 below)");
    expect(d.below?.label).toBe("Prev day high");
  });

  it("a candle that is not there says nothing", () => {
    expect(detailFor(chartBase, all, all.length)).toBeNull();
    expect(detailFor(chartBase, all, -1)).toBeNull();
    expect(detailFor(chartBase, [], 0)).toBeNull();
  });

  it("a candle that closed on a level is 'at the close', and the nearest level over and under are told apart", () => {
    const c = chartVariant((x) => { x.levels!.support = [{ price: 24300, touches: 3 }]; x.levels!.resistance = [{ price: 24285, touches: 2 }]; });
    const d = detailFor(c, candleBars(c).bars, last)!;
    expect(d.below).toEqual({ label: "Resistance · 2 touches", price: "24285.00", where: "at the close" }); // (the level the candle closed on is not over it)
    expect(d.above).toEqual({ label: "Support · 3 touches", price: "24300.00", where: "15.0 above" });
  });

  it("the nearest of several: the closest under and the closest over, by the support and resistance as well as the previous day", () => {
    const c = chartVariant((x) => {
      x.levels!.support = [{ price: 24280, touches: 7 }, { price: 24100, touches: 2 }];
      x.levels!.resistance = [{ price: 24310, touches: 4 }, { price: 24400, touches: 1 }];
    });
    const d = detailFor(c, candleBars(c).bars, last)!;
    expect([d.below?.label, d.below?.where]).toEqual(["Support · 7 touches", "5.0 below"]);
    expect([d.above?.label, d.above?.where]).toEqual(["Resistance · 4 touches", "25.0 above"]);
  });

  it("the session's open is a level too: when it is the nearest under, it is the one said", () => {
    const c = chartVariant((x) => { x.levels!.session_open = 24280; });
    expect(detailFor(c, candleBars(c).bars, last)!.below).toEqual({ label: "Today's open", price: "24280.00", where: "5.0 below" });
  });

  it("a level a few tenths away is that far away, not 'at the close'", () => {
    const c = chartVariant((x) => { x.levels!.resistance = [{ price: 24285.3, touches: 2 }]; x.levels!.support = [{ price: 24284.7, touches: 5 }]; });
    const d = detailFor(c, candleBars(c).bars, last)!;
    expect(d.above).toEqual({ label: "Resistance · 2 touches", price: "24285.30", where: "0.3 above" });
    expect(d.below).toEqual({ label: "Support · 5 touches", price: "24284.70", where: "0.3 below" }); // (these two sit 0.6 apart, and are drawn as one on the chart: but the nearest is the nearest)
  });

  it("a close a few tenths from an EMA is that far from it, not 'on it'", () => {
    const c = chartVariant((x) => { x.candles[59]!.close = x.ema20![59]!.value + 0.3; });
    expect(detailFor(c, candleBars(c).bars, last)!.ema20).toContain("the close is 0.30 above");
  });

  it("with no levels at all there is nothing under or over", () => {
    const c = chartVariant((x) => { delete x.levels; });
    const d = detailFor(c, candleBars(c).bars, last)!;
    expect([d.below, d.above]).toEqual([null, null]);
  });

  it("no ATR, a zero ATR or no facts (the daily chart): no size in ATRs", () => {
    for (const atr of [null, 0]) {
      const c = chartVariant((x) => { x.facts!.atr14_intraday = atr; });
      expect(detailFor(c, candleBars(c).bars, last)!.atr).toBeNull();
    }
    const daily = chartVariant((x) => { x.facts = null; });
    expect(detailFor(daily, candleBars(daily).bars, last)!.atr).toBeNull();
  });

  it("no EMA at that candle (it has not started, or is switched off in the answer): that part is not said", () => {
    const c = chartVariant((x) => { x.ema20 = x.ema20!.slice(0, 10); delete x.ema50; });
    const d = detailFor(c, candleBars(c).bars, last)!;
    expect([d.ema20, d.ema50]).toEqual([null, null]);
  });

  it("a candle that closed where it opened has no body, and one that closed on an EMA says so", () => {
    const flat = chartVariant((x) => { const k = x.candles[59]!; k.open = k.close; });
    expect(detailFor(flat, candleBars(flat).bars, last)!.body).toBe("had no body (open = close)");
    const onIt = chartVariant((x) => { x.candles[59]!.close = x.ema20![59]!.value; });
    expect(detailFor(onIt, candleBars(onIt).bars, last)!.ema20).toContain("the close is on it");
  });

  it("what Prism said on that candle, with the time and the headline, oldest first; what it said on other candles is not here", () => {
    const rows = [row(1793942705, "BUY CE", { headline: "BUY CE: Trend Pullback setup confirmed" }), row(1793942105, "WAIT", { headline: "WAIT: Trend Pullback (CE) is developing" }), row(1793942140, "NO TRADE", { headline: "" })];
    const d = detailFor(chartBase, all, last - 1, rows)!; // the 10:45 candle
    expect(d.decisions).toEqual(["WAIT at 10:45: WAIT: Trend Pullback (CE) is developing", "NO TRADE at 10:45"]);
    expect(detailFor(chartBase, all, last, rows)!.decisions).toEqual([]); // (the 10:50 candle: the BUY came after it)
  });

  it("is the same for a forming candle as for a closed one", () => {
    const c = chartVariant((x) => { x.forming = { time: 1793942700, open: 24285, high: 24287, low: 24284, close: 24286, partial: false, ticks: 4 }; });
    const b = candleBars(c).bars;
    const d = detailFor(c, b, b.length - 1, [row(1793942705, "BUY CE", { headline: "BUY CE: Trend Pullback setup confirmed" })])!;
    expect(d.range).toBe("3.00 pts");
    expect(d.decisions).toEqual(["CE setup ready at 10:55: CE setup ready: Trend Pullback setup confirmed"]);
  });

  it("the daily chart has no decisions to say", () => {
    const b: Bar[] = [{ time: "2026-11-06", open: 1, high: 3, low: 0, close: 2 }];
    const c = chartVariant((x) => { x.timeframe = "1d"; x.seconds = 86400; x.facts = null; });
    expect(detailFor(c, b, 0, [row(T, "WAIT")])!.decisions).toEqual([]);
  });
});

describe("what each number under the chart means", () => {
  it("is said in plain words, for each of them", () => {
    expect(Object.keys(FACT_HELP)).toEqual(["trend", "adx", "rsi", "atr", "ema20", "ema50"]);
    expect(FACT_HELP.adx).toBe("ADX: how strong the trend is, whichever way it points. Under about 20 there is little or no trend; over about 25 there is a clear one.");
    expect(FACT_HELP.rsi).toContain("Above about 70");
    expect(FACT_HELP.rsi).toContain("below about 30");
    expect(FACT_HELP.atr).toBe("ATR(14): the average size of a candle over the last 14, in index points. A yardstick for how far a normal move goes.");
    expect(FACT_HELP.ema20).toContain("purple");
    expect(FACT_HELP.ema50).toContain("teal");
    for (const text of Object.values(FACT_HELP)) expect(text).not.toMatch(/buy|sell|will|guarantee/i); // it says what a number is, and promises nothing about price
  });
});
