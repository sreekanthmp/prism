import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Profiler, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { RECONNECT_MS } from "../connection";
import type { ChartFetcher } from "../chartApi";
import { IST_SHIFT } from "../chartModel";
import type { ChartData } from "../chartTypes";
import type { JournalRow } from "../types";
import { CHART_RETRY_MS, CHART_POLL_MS } from "../useChart";
import { base, chartBase, chartVariant, EVIL, FakeSocket, fakeApi, fakeFactory, journalBase } from "../test/helpers";
import { allOn } from "../chartModel";
import { ChartTab, defaultPrefs, type ChartPrefs } from "./ChartTab";

// The canvas is replaced by a recorder: these tests are about WHAT the tab tells the chart to draw (and when it redraws and when it only moves the last bar). How it looks in a real browser is
// tested in tests/test_chart_browser.py, in Chrome.
const rec = vi.hoisted(() => {
  class FakeSeries {
    data: { time: unknown; [k: string]: unknown }[] = [];
    updates: { time: unknown; [k: string]: unknown }[] = [];
    setDataCalls = 0;
    lines: { price: number; color: string; axisLabelColor: string; lineWidth: number; lineStyle: number; title: string; removed: boolean }[] = [];
    markers: { time: unknown; position: string; shape: string; text: string; color: string }[] = [];
    constructor(public kind: string, public options: Record<string, unknown>) {}
    setData(d: never[]) { this.data = d; this.setDataCalls++; }
    update(b: never) { this.updates.push(b); }
    createPriceLine(o: Record<string, unknown>) { const l = { ...o, removed: false } as FakeSeries["lines"][number]; this.lines.push(l); return l; }
    removePriceLine(l: FakeSeries["lines"][number]) { l.removed = true; }
    get live() { return this.lines.filter((l) => !l.removed); }
  }
  class FakeChart {
    series: FakeSeries[] = [];
    applied: Record<string, unknown>[] = [];
    range: { from: number; to: number } | null = null;
    removed = false;
    crosshair: ((p: { time?: unknown }) => void) | null = null;
    constructor(public options: Record<string, unknown>) {}
    addSeries(def: { kind: string }, options: Record<string, unknown>) { const s = new FakeSeries(def.kind, options); this.series.push(s); return s; }
    applyOptions(o: Record<string, unknown>) { this.applied.push(o); }
    timeScale() { return { setVisibleLogicalRange: (r: { from: number; to: number }) => { this.range = r; } }; }
    subscribeCrosshairMove(fn: (p: { time?: unknown }) => void) { this.crosshair = fn; }
    remove() { this.removed = true; }
    get candles() { return this.series.find((s) => s.kind === "candles")!; }
    get lineSeries() { return this.series.filter((s) => s.kind === "line"); }
  }
  const log = { charts: [] as FakeChart[], markers: new Map<FakeSeries, FakeSeries["markers"]>() };
  return { FakeSeries, FakeChart, log };
});

vi.mock("lightweight-charts", () => ({
  createChart: (_el: unknown, options: Record<string, unknown>) => { const c = new rec.FakeChart(options); rec.log.charts.push(c); return c; },
  createSeriesMarkers: (series: InstanceType<typeof rec.FakeSeries>, markers: never[]) => {
    series.markers = markers;
    return { setMarkers: (m: never[]) => { series.markers = m; } };
  },
  CandlestickSeries: { kind: "candles" },
  LineSeries: { kind: "line" },
  ColorType: { Solid: "solid" },
  CrosshairMode: { Normal: 0 },
  LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3, SparseDotted: 4 },
}));

const chartNow = () => rec.log.charts[rec.log.charts.length - 1]!;
const everything: ChartPrefs = { ...defaultPrefs, on: allOn }; // (every box on: the swings and the other levels too)
const live = () => chartNow().candles.live.map((l) => l.title);
const GREEN = "#3ddc84";
const RED = "#ff6b6b";

/** A fetcher the test answers: by default every ask is answered at once with what `reply` gives for that timeframe. */
function serve(reply: (tf: string) => ChartData | Error = () => chartBase) {
  const f = vi.fn<ChartFetcher>(async (tf) => { const r = reply(tf); if (r instanceof Error) throw r; return r; });
  return f;
}
function Host({ fetcher, paused = false, start = defaultPrefs, decisions }: { fetcher: ChartFetcher; paused?: boolean; start?: ChartPrefs; decisions?: JournalRow[] | null }) {
  const [p, setP] = useState(start); // (the page keeps the choices: here, this stand-in for it)
  return <ChartTab prefs={p} onPrefs={setP} paused={paused} fetcher={fetcher} decisions={decisions} />;
}
const mount = async (fetcher: ChartFetcher, props: { paused?: boolean; start?: ChartPrefs; decisions?: JournalRow[] | null } = {}) => {
  const r = render(<Host fetcher={fetcher} {...props} />);
  await act(async () => {});
  return r;
};
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const press = (name: string) => act(() => { fireEvent.click(screen.getByRole("button", { name })); });
const toggle = (name: string) => act(() => { fireEvent.click(screen.getByRole("checkbox", { name })); });

beforeEach(() => { vi.useFakeTimers(); rec.log.charts.length = 0; });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("the Chart tab", () => {
  it("asks for the 5M candles first, says it is loading, and then draws them", async () => {
    let answer: (d: ChartData) => void = () => {};
    const f = vi.fn<ChartFetcher>(() => new Promise((ok) => { answer = ok; }));
    render(<Host fetcher={f} />);
    expect(screen.getByTestId("chart-status").textContent).toBe("Loading the 5M candles from Prism…");
    expect(rec.log.charts).toHaveLength(0);
    expect(f).toHaveBeenCalledWith("5m", 300, expect.any(AbortSignal));
    await act(async () => answer(chartBase));
    expect(screen.queryByTestId("chart-status")).toBeNull();
    expect(rec.log.charts).toHaveLength(1);
    expect(screen.getByRole("button", { name: "5M" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("gives the chart the market's candles with their times moved to IST, and shows the latest few, not all", async () => {
    await mount(serve());
    const c = chartNow().candles;
    expect(c.setDataCalls).toBe(1);
    expect(c.data).toHaveLength(60);
    const last = chartBase.candles[59]!;
    expect(c.data[59]).toEqual({ time: last.time + IST_SHIFT, open: last.open, high: last.high, low: last.low, close: last.close });
    expect(chartNow().range).toEqual({ from: 0, to: 74 }); // (60 bars, fewer than the 120 a new chart shows, and 14 bars of room on the right, where the lines' labels sit)
    expect(chartNow().applied.at(-1)).toEqual({ timeScale: { timeVisible: true } });
  });

  it("draws the two EMAs from the answer, in the dashboard's colours, and no swing arrow to begin with", async () => {
    await mount(serve());
    const [e20, e50] = chartNow().lineSeries;
    expect(e20!.data).toHaveLength(60);
    expect(e50!.data).toHaveLength(60);
    expect(e20!.data[59]).toEqual({ time: chartBase.ema20![59]!.time + IST_SHIFT, value: chartBase.ema20![59]!.value });
    expect([e20!.options.color, e50!.options.color]).toEqual(["#c792ea", "#4dd0e1"]); // (not the blue of a trigger, nor the amber of a level)
    expect(chartNow().candles.markers).toEqual([]); // (the swings are a lot of arrows: they are one click away)
  });

  it("draws every swing from the answer when the box is on: an H over the candle in red, an L under it in green", async () => {
    await mount(serve(), { start: everything });
    const m = chartNow().candles.markers;
    expect(m).toHaveLength(chartBase.swings!.length);
    expect(m.filter((x) => x.text === "H").every((x) => x.position === "aboveBar" && x.color === RED)).toBe(true);
    expect(m.filter((x) => x.text === "L").every((x) => x.position === "belowBar" && x.color === GREEN)).toBe(true);
  });

  it("draws the previous day's levels and the setup's trigger, entry area, invalidation and target, each in its own look (the session opened at the previous close: one line, named for both)", async () => {
    await mount(serve());
    expect(live()).toEqual(["Prev day high", "Prev day low", "Prev day close + Today's open", "CE trigger", "CE entry area", "CE entry area", "CE invalidation", "CE target 1"]);
    const by = (t: string) => chartNow().candles.live.find((l) => l.title === t)!;
    const s = chartBase.setups[0]!;
    expect(by("CE trigger")).toMatchObject({ price: s.trigger, color: "#5aa9ff", lineStyle: 2, lineWidth: 2 }); // dashed blue, thick: it is the decision's setup
    expect(by("CE invalidation")).toMatchObject({ price: s.invalidation, color: RED, lineStyle: 0 }); // solid red
    expect(by("CE target 1")).toMatchObject({ price: s.targets[0]!.price, color: GREEN, lineStyle: 2 });
    expect(by("Prev day high")).toMatchObject({ price: chartBase.levels!.previous_day!.pdh, color: "#f5b942", axisLabelColor: "#f5b942", lineStyle: 1, lineWidth: 1 }); // amber, dotted
  });

  it("draws a support as a faded green dashed line and a resistance as a faded red one, with their labels at full colour, and the open in grey", async () => {
    const c = chartVariant((x) => {
      x.levels!.session_open = 24260;
      x.levels!.support = [{ price: 24230, touches: 3 }];
      x.levels!.resistance = [{ price: 24310, touches: 1 }];
    });
    await mount(serve(() => c));
    const by = (t: string) => chartNow().candles.live.find((l) => l.title === t)!;
    expect(by("Support · 3 touches")).toMatchObject({ price: 24230, color: "#3ddc8499", axisLabelColor: "#3ddc84", lineStyle: 3, lineWidth: 1 }); // 0x99 is 60 per cent
    expect(by("Resistance · 1 touch")).toMatchObject({ price: 24310, color: "#ff6b6b99", axisLabelColor: "#ff6b6b", lineStyle: 3, lineWidth: 1 });
    expect(by("Today's open")).toMatchObject({ price: 24260, color: "#8b95a4", axisLabelColor: "#8b95a4", lineStyle: 1 }); // grey, dotted
    expect(live().slice(0, 6)).toEqual(["Prev day high", "Prev day low", "Prev day close", "Today's open", "Support · 3 touches", "Resistance · 1 touch"]);
  });

  it("writes the legend for the latest candle, and for the one under the cursor while the cursor is on one", async () => {
    await mount(serve());
    const last = chartBase.candles[59]!;
    const prev = chartBase.candles[58]!;
    const text = () => screen.getByTestId("chart-legend").textContent!;
    expect(text()).toContain("NIFTY 50 · 5M · 06/11 10:50");
    expect(text()).toContain(`O ${last.open.toFixed(2)} H ${last.high.toFixed(2)} L ${last.low.toFixed(2)} C ${last.close.toFixed(2)}`);
    expect(text()).toContain(`${last.close - prev.close > 0 ? "+" : ""}${(last.close - prev.close).toFixed(2)}`);
    act(() => chartNow().crosshair!({ time: chartBase.candles[10]!.time + IST_SHIFT }));
    const hover = chartBase.candles[10]!;
    expect(text()).toContain(`O ${hover.open.toFixed(2)}`);
    expect(text()).toContain("05/11 13:00"); // candle 10 of the 60 is Thursday's 45th: 09:15 + 225 minutes
    act(() => chartNow().crosshair!({ time: undefined }));
    expect(text()).toContain(`O ${last.open.toFixed(2)}`);
    act(() => chartNow().crosshair!({ time: 12345 })); // a time that is not a bar
    expect(text()).toContain(`O ${last.open.toFixed(2)}`);
  });

  it("writes the setups out in words and numbers under the chart, the decision's one marked", async () => {
    await mount(serve());
    const box = screen.getByTestId("chart-setups");
    const s = chartBase.setups[0]!;
    expect(box.querySelector("h3")?.textContent).toBe("Prism's setups on this chart · decision: CE SETUP");
    const item = box.querySelector("li")!;
    expect(item).toBeVisible();
    expect(item.className).toBe("ce focus");
    expect(item.textContent).toContain("CE · Trend Pullback");
    expect(item.textContent).toContain("the decision's setup");
    expect(item.textContent).toContain("confirmed, price is in the entry area and nothing blocks entry");
    expect(item.textContent).toContain(`Trigger ${s.trigger!.toFixed(2)}`);
    expect(item.textContent).toContain(`Invalidation ${s.invalidation!.toFixed(2)}`);
    expect(item.textContent).toContain(`Target 1 ${s.targets[0]!.price!.toFixed(2)}`);
  });

  it("says plainly that no setup is live when there is none, and draws no setup line", async () => {
    await mount(serve(() => chartVariant((c) => { c.setups = []; c.decision = { action: "WAIT", setup_id: null }; })));
    expect(screen.getByTestId("chart-setups").textContent).toContain("No setup is live.");
    expect(screen.getByTestId("chart-setups").querySelector("h3")?.textContent).toBe("Prism's setups on this chart · decision: WAIT");
    expect(live()).toEqual(["Prev day high", "Prev day low", "Prev day close + Today's open"]);
  });

  it("says the indicators Prism has for this timeframe, and why there are none on the daily chart", async () => {
    await mount(serve());
    const f = chartBase.facts!;
    expect(screen.getByTestId("chart-facts").textContent).toBe(`Trend ${f.trend}ADX ${f.adx!.toFixed(1)}RSI ${f.rsi14!.toFixed(1)}ATR(14) ${f.atr14_intraday!.toFixed(1)}EMA 20 ${f.ema20!.toFixed(2)}EMA 50 ${f.ema50!.toFixed(2)}`);
    cleanup();
    await mount(serve(() => chartVariant((c) => { c.timeframe = "1d"; c.facts = null; c.candles = c.candles.map((k, i) => ({ ...k, date: `2026-10-${String(i + 1).padStart(2, "0")}` })); })), { start: { ...defaultPrefs, timeframe: "1d" } });
    expect(screen.getByText(/Prism reads no trend from daily candles/)).toBeTruthy();
  });

  // -- the viewer's choices ----------------------------------------------------------------------------------------------------------------------------
  it("a click on another timeframe asks for it, shows nothing of the old one meanwhile, and draws the new one on a new chart", async () => {
    const f = serve((tf) => chartVariant((c) => { c.timeframe = tf; }));
    await mount(f);
    const first = chartNow();
    let answer: (d: ChartData) => void = () => {};
    f.mockImplementationOnce(() => new Promise((ok) => { answer = ok; }));
    await press("15M");
    expect(f).toHaveBeenLastCalledWith("15m", 300, expect.any(AbortSignal));
    expect(screen.getByTestId("chart-status").textContent).toBe("Loading the 15M candles from Prism…");
    expect(first.removed).toBe(true);
    expect(screen.getByRole("button", { name: "15M" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "5M" }).getAttribute("aria-pressed")).toBe("false");
    await act(async () => answer(chartVariant((c) => { c.timeframe = "15m"; })));
    expect(rec.log.charts).toHaveLength(2);
    expect(screen.getByTestId("chart-legend").textContent).toContain("· 15M ·");
  });

  it("a cursor that was on a candle of the old timeframe is not on a candle of the new one", async () => {
    const f = serve((tf) => chartVariant((c) => { c.timeframe = tf; }));
    await mount(f);
    act(() => chartNow().crosshair!({ time: chartBase.candles[10]!.time + IST_SHIFT }));
    expect(screen.getByTestId("chart-legend").textContent).toContain("05/11 13:00");
    await press("15M"); // the chart is gone with its cursor: nothing says the cursor left it
    const last = chartBase.candles[59]!;
    expect(screen.getByTestId("chart-legend").textContent).toContain(`O ${last.open.toFixed(2)}`); // the newest candle, not candle number 10
    expect(screen.getByTestId("chart-legend").textContent).not.toContain("05/11 13:00");
  });

  it("never shows the candles of the old timeframe under the name of the new one, not even for one draw", async () => {
    const f = serve((tf) => chartVariant((c) => { c.timeframe = tf; }));
    const drawn: string[] = [];
    const watch = () => drawn.push(document.querySelector("[data-testid=chart-legend]")?.textContent ?? "");
    render(<Profiler id="chart" onRender={watch}><Host fetcher={f} /></Profiler>); // (called after every draw of the page, with the page as drawn)
    await act(async () => {});
    drawn.length = 0;
    let answer: (d: ChartData) => void = () => {};
    f.mockImplementationOnce(() => new Promise((ok) => { answer = ok; }));
    await press("15M");
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.filter((t) => t.includes("· 15M") && t.includes("O "))).toEqual([]); // no draw has 15M in its name and the numbers of 5M
    await act(async () => answer(chartVariant((c) => { c.timeframe = "15m"; })));
    expect(drawn.at(-1)).toContain("· 15M ·");
  });

  it.each([["1M", "1m", 375], ["5M", "5m", 300], ["15M", "15m", 300], ["1H", "1h", 200], ["1D", "1d", 120]])("the %s button asks for %s with %d candles", async (label, tf, limit) => {
    const f = serve((t) => chartVariant((c) => { c.timeframe = t; }));
    await mount(f, { start: { ...defaultPrefs, timeframe: tf === "5m" ? "15m" : "5m" } });
    await press(label!);
    expect(f).toHaveBeenLastCalledWith(tf, limit, expect.any(AbortSignal));
  });

  it("the daily chart is drawn on its days, with no time of day", async () => {
    const daily = chartVariant((c) => { c.timeframe = "1d"; c.candles = c.candles.slice(0, 5).map((k, i) => ({ ...k, date: `2026-11-0${i + 1}` })); c.ema20 = []; c.ema50 = []; c.swings = []; c.forming = null; });
    await mount(serve(() => daily), { start: { ...defaultPrefs, timeframe: "1d" } });
    expect(chartNow().candles.data.map((b) => b.time)).toEqual(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]);
    expect(chartNow().applied.at(-1)).toEqual({ timeScale: { timeVisible: false } });
    expect(screen.getByTestId("chart-legend").textContent).toContain("05/11/2026");
  });

  it("each box under 'On the chart' takes its own lines away and gives them back", async () => {
    await mount(serve());
    const [e20, e50] = chartNow().lineSeries;
    await toggle("EMA 20");
    expect([e20!.data.length, e50!.data.length]).toEqual([0, 60]);
    await toggle("EMA 20");
    expect(e20!.data).toHaveLength(60);
    await toggle("EMA 50");
    expect(e50!.data).toHaveLength(0);
    await toggle("Swings"); // (off to begin with)
    expect(chartNow().candles.markers).toHaveLength(chartBase.swings!.length);
    await toggle("Swings");
    expect(chartNow().candles.markers).toEqual([]);
    await toggle("Setup lines");
    expect(live()).toEqual(["Prev day high", "Prev day low", "Prev day close + Today's open"]);
    await toggle("Key levels");
    expect(live()).toEqual([]);
    await toggle("Setup lines");
    expect(live()).toEqual(["CE trigger", "CE entry area", "CE entry area", "CE invalidation", "CE target 1"]);
    expect(rec.log.charts).toHaveLength(1); // none of this made another chart
    expect(chartNow().candles.setDataCalls).toBe(1); // and none of it redrew the candles
  });

  it("'More levels' puts every other support and resistance on the chart and takes them away again, and 'Key levels' keeps its own", async () => {
    const c = chartVariant((x) => {
      x.levels!.session_open = 24260;
      x.levels!.support = [{ price: 24230, touches: 3 }, { price: 24200, touches: 1 }];
      x.levels!.resistance = [{ price: 24310, touches: 4 }, { price: 24350, touches: 2 }];
    });
    await mount(serve(() => c));
    const levels = () => live().filter((x) => !x.startsWith("CE ")).sort(); // (the recorder lists a line when it was made: the chart does not care about the order)
    const sorted = (...names: string[]) => [...names].sort();
    expect(levels()).toEqual(sorted("Prev day high", "Prev day low", "Prev day close", "Today's open", "Support · 3 touches", "Resistance · 4 touches"));
    await toggle("More levels");
    expect(levels()).toEqual(sorted("Prev day high", "Prev day low", "Prev day close", "Today's open", "Support · 3 touches", "Support · 1 touch", "Resistance · 4 touches", "Resistance · 2 touches"));
    await toggle("Key levels");
    expect(levels()).toEqual(sorted("Support · 1 touch", "Resistance · 2 touches"));
    await toggle("More levels");
    expect(levels()).toEqual([]);
  });

  it("a choice is handed to the page whole: the timeframe with the boxes as they were, a box with the timeframe as it was", async () => {
    const seen: ChartPrefs[] = [];
    const f = serve((tf) => chartVariant((c) => { c.timeframe = tf; }));
    const start: ChartPrefs = { timeframe: "15m", on: { ema20: false, ema50: true, levels: false, moreLevels: true, setups: false, swings: true, decisions: false } }; // (nothing here is the default)
    render(<ChartTab prefs={start} onPrefs={(p) => seen.push(p)} paused={false} fetcher={f} />);
    await act(async () => {});
    act(() => { fireEvent.click(screen.getByRole("button", { name: "1H" })); });
    act(() => { fireEvent.click(screen.getByRole("checkbox", { name: "Swings" })); });
    expect(seen).toEqual([{ timeframe: "1h", on: start.on }, { timeframe: "15m", on: { ...start.on, swings: false } }]);
  });

  // -- live updates ------------------------------------------------------------------------------------------------------------------------------------
  it("a new answer moves the last bar and adds the new ones without redrawing the chart, so the viewer's zoom stays", async () => {
    const answers = [chartBase, chartVariant((c) => {
      const k = c.candles[59]!;
      c.forming = { time: k.time + 300, open: k.close, high: k.close + 2, low: k.close - 1, close: k.close + 1, partial: false, ticks: 5 };
    })];
    const f = serve();
    f.mockImplementation(async () => answers.shift() ?? chartBase);
    await mount(f);
    const c = chartNow().candles;
    expect(c.setDataCalls).toBe(1);
    await tick(CHART_POLL_MS);
    expect(c.setDataCalls).toBe(1); // not set again: the viewer's scroll and zoom are untouched
    expect(c.updates.map((b) => b.time)).toEqual([chartBase.candles[59]!.time + IST_SHIFT, chartBase.candles[59]!.time + 300 + IST_SHIFT]);
    expect(screen.getByTestId("chart-legend").textContent).toContain("forming");
    expect(chartNow().range).toEqual({ from: 0, to: 74 }); // (set once, when the chart was made)
  });

  it("a line that has not moved is left alone and one that has is moved, not drawn twice", async () => {
    const moved = chartVariant((c) => { c.setups[0]!.invalidation = 24260.5; });
    const answers = [chartBase, moved];
    const f = serve();
    f.mockImplementation(async () => answers.shift() ?? moved);
    await mount(f);
    const lines = chartNow().candles.lines;
    expect(lines).toHaveLength(8);
    await tick(CHART_POLL_MS);
    expect(lines).toHaveLength(9); // one line was made again: the invalidation
    expect(lines.filter((l) => l.removed).map((l) => l.title)).toEqual(["CE invalidation"]);
    expect(live().filter((t) => t === "CE invalidation")).toHaveLength(1);
    expect(chartNow().candles.live.find((l) => l.title === "CE invalidation")!.price).toBe(24260.5);
    await tick(CHART_POLL_MS);
    expect(lines).toHaveLength(9); // and the same answer again changes nothing
  });

  it("a setup that has ended loses its lines on the next answer", async () => {
    const answers = [chartBase, chartVariant((c) => { c.setups = []; })];
    const f = serve();
    f.mockImplementation(async () => answers.shift() ?? chartBase);
    await mount(f);
    expect(live()).toHaveLength(8);
    await tick(CHART_POLL_MS);
    expect(live()).toEqual(["Prev day high", "Prev day low", "Prev day close + Today's open"]);
  });

  it("a history that was refreshed (an earlier candle is different) is drawn again in full", async () => {
    const f = serve();
    const changed = chartVariant((c) => { c.candles[20]!.high += 5; });
    const answers = [chartBase, changed];
    f.mockImplementation(async () => answers.shift() ?? changed);
    await mount(f);
    await tick(CHART_POLL_MS);
    expect(chartNow().candles.setDataCalls).toBe(2);
  });

  // -- what cannot be drawn ----------------------------------------------------------------------------------------------------------------------------
  it("says why there is nothing to draw, makes no chart, and keeps asking", async () => {
    const f = serve(() => ({ available: false, timeframe: "5m", seconds: 300, as_of: chartBase.as_of, reason: "Historical data is still loading (waiting for the history).", candles: [], forming: null, setups: [] }));
    await mount(f);
    expect(screen.getByTestId("chart-status").textContent).toBe("Nothing to draw yet: Historical data is still loading (waiting for the history).");
    expect(rec.log.charts).toHaveLength(0);
    expect(screen.queryByTestId("chart-setups")).toBeNull();
    await tick(CHART_POLL_MS);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("says when Prism cannot be asked, and asks again", async () => {
    const f = serve(() => new Error("Prism answered 500"));
    await mount(f);
    expect(screen.getByTestId("chart-status").textContent).toBe("Prism's chart data could not be read: Prism answered 500. Trying again every 5 s.");
    await tick(CHART_RETRY_MS);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("when an ask fails after candles were drawn, the candles stay and the failure is said above them", async () => {
    const f = serve();
    let failing = false;
    f.mockImplementation(async () => { if (failing) throw new Error("network down"); failing = true; return chartBase; }); // the first ask works, the next ones do not
    await mount(f);
    await tick(CHART_POLL_MS);
    expect(rec.log.charts).toHaveLength(1);
    expect(chartNow().removed).toBe(false);
    expect(screen.getByTestId("chart-error").textContent).toBe("The last update failed (network down). Showing the candles as of 10:55:05; trying again in 5 s.");
    failing = false; // the next ask works
    await tick(CHART_RETRY_MS);
    expect(screen.queryByTestId("chart-error")).toBeNull();
  });

  it("asks nothing while the link to Prism is down, and says so when it has nothing to show", async () => {
    const f = serve();
    await mount(f, { paused: true });
    expect(f).not.toHaveBeenCalled();
    expect(screen.getByTestId("chart-status").textContent).toBe("The link to Prism is down: there is nothing to draw until it is back.");
  });

  it("shows what Prism says as text, never as markup", async () => {
    await mount(serve(() => chartVariant((c) => {
      c.warnings = [EVIL];
      c.notes = [EVIL];
      c.setups[0]!.strategy_name = EVIL;
      c.setups[0]!.stage_text = EVIL;
    })));
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByTestId("chart-warnings").textContent).toBe(EVIL);
    expect(screen.getByTestId("chart-notes").textContent).toBe(EVIL);
    expect(screen.getByTestId("chart-setups").textContent).toContain(EVIL);
  });

  it("shows the answer's warnings and notes, and the credit for the chart library", async () => {
    await mount(serve(() => chartVariant((c) => { c.warnings = ["1H and 15M data are incomplete."]; c.notes = ["Prism holds 60 5m candles, and that is all there is to draw."]; })));
    expect(screen.getByTestId("chart-warnings").textContent).toBe("1H and 15M data are incomplete.");
    expect(screen.getByTestId("chart-notes").textContent).toBe("Prism holds 60 5m candles, and that is all there is to draw.");
    expect(document.body.textContent).toContain("Chart by TradingView Lightweight Charts™");
  });

  it("makes the chart once for the life of the tab and removes it with the tab", async () => {
    const f = serve();
    await mount(f);
    await tick(CHART_POLL_MS * 4);
    expect(rec.log.charts).toHaveLength(1);
    cleanup();
    expect(rec.log.charts[0]!.removed).toBe(true);
    await tick(CHART_POLL_MS * 4);
    expect(f.mock.calls.length).toBeLessThanOrEqual(5); // (nothing is asked once the tab is gone)
    const calls = f.mock.calls.length;
    await tick(CHART_POLL_MS * 4);
    expect(f.mock.calls.length).toBe(calls);
  });
});

// -- in the dashboard -------------------------------------------------------------------------------------------------------------------------------
describe("the Chart tab in the dashboard", () => {
  const mountApp = async (f: ChartFetcher, hash = "#chart") => {
    location.hash = hash;
    FakeSocket.reset();
    const r = render(<App url="ws://prism.test/ws" createSocket={fakeFactory} fetchChart={f} />);
    await act(async () => {});
    act(() => { FakeSocket.last.send(base); });
    await act(async () => {});
    return r;
  };
  afterEach(() => { location.hash = ""; });

  it("is opened by #chart, asks for the chart and for nothing else, and the other tabs ask for nothing", async () => {
    const f = serve();
    await mountApp(f, "#overview");
    await tick(CHART_POLL_MS);
    act(() => { FakeSocket.last.send(base); }); // (a snapshot every few seconds, as the server sends them: the page stays live)
    await tick(CHART_POLL_MS);
    expect(f).not.toHaveBeenCalled();
    expect(rec.log.charts).toHaveLength(0);
    await act(async () => { screen.getByRole("tab", { name: "Chart" }).click(); });
    expect(f).toHaveBeenCalledTimes(1);
    expect(rec.log.charts).toHaveLength(1);
    expect(screen.getByTestId("chart-tab")).toBeTruthy();
    expect(screen.queryByTestId("placeholder")).toBeNull();
  });

  it("stops asking when the link to Prism is lost, keeps the last chart on the screen dimmed, and asks again when the link is back", async () => {
    const f = serve();
    await mountApp(f);
    expect(f).toHaveBeenCalledTimes(1);
    act(() => { FakeSocket.last.drop(); });
    expect(document.getElementById("main")?.className).toBe("staled");
    expect(document.querySelector(".stalebar")).not.toBeNull();
    await tick(CHART_POLL_MS * 4);
    expect(f).toHaveBeenCalledTimes(1); // nothing is asked of a Prism the page cannot reach
    expect(chartNow().removed).toBe(false); // what was drawn stays for the viewer to look at
    await tick(RECONNECT_MS);
    act(() => { FakeSocket.last.send(base); });
    await act(async () => {});
    expect(document.querySelector(".stalebar")).toBeNull();
    expect(f.mock.calls.length).toBeGreaterThan(1);
  });

  it("keeps the viewer's choices while another tab is open", async () => {
    const f = serve((tf) => chartVariant((c) => { c.timeframe = tf; }));
    await mountApp(f);
    await press("1H");
    await toggle("Swings"); // (on: it is off to begin with)
    await act(async () => { screen.getByRole("tab", { name: "Journal" }).click(); });
    expect(screen.queryByTestId("chart-tab")).toBeNull();
    expect(rec.log.charts.every((c) => c.removed)).toBe(true); // the canvas goes with the tab
    const calls = f.mock.calls.length;
    await tick(CHART_POLL_MS * 4);
    expect(f.mock.calls.length).toBe(calls); // and nothing is asked while it is away
    await act(async () => { screen.getByRole("tab", { name: "Chart" }).click(); });
    expect(screen.getByRole("button", { name: "1H" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByRole("checkbox", { name: "Swings" }) as HTMLInputElement).checked).toBe(true); // (the choice is kept)
    expect(f).toHaveBeenLastCalledWith("1h", 200, expect.any(AbortSignal));
  });
});

// -- what the tab says beyond the candles ---------------------------------------------------------------------------------------------------------------
describe("what the Chart tab says beyond the candles", () => {
  const AMBER = "#f5b942";
  const text = (id: string) => (screen.getByTestId(id).textContent ?? "").replace(/\s+/g, " ");
  const withForming = chartVariant((c) => { c.forming = { time: 1793942700, open: 24285, high: 24287, low: 24284, close: 24286, partial: false, ticks: 4 }; });
  const circles = () => chartNow().candles.markers.filter((m) => m.shape === "circle");

  it("says what the latest candle says, under the legend, as the candle's own numbers", async () => {
    await mount(serve());
    const t = text("chart-detail");
    expect(t).toContain("Size 8.00 pts (1.3× the ATR(14) of 6.1)");
    expect(t).toContain("It closed up 6.50");
    expect(t).toContain("EMA 20 24279.15 (the close is 5.85 above)");
    expect(t).toContain("EMA 50 24250.00 (the close is 35.00 above)");
    expect(t).toContain("Nearest level under: Prev day high 24270.55 (14.5 below)");
    expect(t).not.toContain("over:"); // (nothing over this candle)
  });

  it("follows the mouse to another candle, and goes back to the latest when the mouse leaves", async () => {
    await mount(serve());
    act(() => { chartNow().crosshair!({ time: 1793942100 + IST_SHIFT }); });
    expect(text("chart-detail")).toContain("Size 3.00 pts");
    expect(text("chart-detail")).toContain("It closed down 0.50");
    expect(text("chart-legend")).toContain("10:45");
    act(() => { chartNow().crosshair!({}); });
    expect(text("chart-detail")).toContain("Size 8.00 pts");
  });

  it("says what Prism said on the candle under the mouse, and nothing on one it said nothing on", async () => {
    await mount(serve(), { decisions: journalBase.decisions });
    expect(text("chart-detail")).not.toContain("Prism said");
    act(() => { chartNow().crosshair!({ time: 1793942100 + IST_SHIFT }); });
    expect(text("chart-detail")).toContain("Prism said WAIT at 10:45: WAIT: Trend Pullback (CE) is developing");
  });

  it("marks where the decision changed on the candles: an amber dot for each WAIT, in time order among the swings", async () => {
    await mount(serve(), { decisions: journalBase.decisions, start: everything });
    expect(circles()).toEqual([
      { time: 1793941800 + IST_SHIFT, position: "belowBar", shape: "circle", text: "", size: 0.8, color: AMBER },
      { time: 1793942100 + IST_SHIFT, position: "belowBar", shape: "circle", text: "", size: 0.8, color: AMBER },
    ]);
    const times = chartNow().candles.markers.map((m) => m.time as number);
    expect(times).toEqual([...times].sort((a, b) => a - b)); // (swings and decisions together, oldest first)
    expect(chartNow().candles.markers.filter((m) => m.text === "H" || m.text === "L").length).toBeGreaterThan(0); // (the swings are still there)
  });

  it("a CE setup is a green arrow under the candle it came on, once that candle has formed", async () => {
    await mount(serve(() => withForming), { decisions: journalBase.decisions });
    const buy = chartNow().candles.markers.find((m) => m.text === "CE setup");
    expect(buy).toEqual({ time: 1793942700 + IST_SHIFT, position: "belowBar", shape: "arrowUp", text: "CE setup", size: 1.2, color: GREEN });
    expect(circles()).toHaveLength(2);
  });

  it("the 'Decisions' box takes them away and gives them back, and only them", async () => {
    await mount(serve(() => withForming), { decisions: journalBase.decisions, start: everything });
    const swings = () => chartNow().candles.markers.filter((m) => m.text === "H" || m.text === "L").length;
    const was = swings();
    await toggle("Decisions");
    expect(chartNow().candles.markers.filter((m) => m.shape === "circle" || m.text === "CE setup")).toEqual([]);
    expect(swings()).toBe(was);
    await toggle("Decisions");
    expect(chartNow().candles.markers.filter((m) => m.shape === "circle" || m.text === "CE setup")).toHaveLength(3);
    await toggle("Swings");
    expect(swings()).toBe(0);
    expect(circles()).toHaveLength(2); // (the swings box does not touch them)
    expect(rec.log.charts).toHaveLength(1);
  });

  it("with no journal there is none to mark, and the page still draws", async () => {
    await mount(serve(), { decisions: null });
    expect(circles()).toEqual([]);
    expect(screen.getByTestId("chart-detail")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Decisions" })).toBeTruthy();
  });

  it("has a guide to every line, arrow and number, and says it is not advice", async () => {
    await mount(serve());
    const g = text("chart-guide");
    for (const said of ["How to read this chart", "EMA 20", "EMA 50", "Swings (off to begin with)", "CE setup", "PE setup", "amber dot for WAIT", "grey dot for NO TRADE", "today's journal", "Key levels.", "Prev day high, low and close", "Today's open", "Support (a floor", "Resistance (a ceiling", "3 touches", "drawn once", "More levels (off to begin with)", "Everything", "Simple", "trigger", "entry area", "invalidation", "targets", "The line under the legend", "Hover each one", "none of this tells you to buy or sell"]) {
      expect(g, said).toContain(said);
    }
    expect(screen.getByTestId("chart-guide").tagName).toBe("DETAILS");
    expect((screen.getByTestId("chart-guide") as HTMLDetailsElement).open).toBe(false); // (it is there to be opened, not in the way)
  });

  it("says what each number under the chart is, on hover", async () => {
    await mount(serve());
    const strip = screen.getByTestId("chart-facts");
    const title = (start: string) => ([...strip.querySelectorAll("span")].find((s) => (s.textContent ?? "").startsWith(start)) as HTMLElement).title;
    expect(title("Trend")).toBe("Prism's own reading of the direction on this timeframe: bullish, bearish or sideways.");
    expect(title("ADX")).toContain("how strong the trend is");
    expect(title("RSI")).toContain("momentum from 0 to 100");
    expect(title("ATR")).toContain("average size of a candle");
    expect(title("EMA 20")).toContain("last 20 closes");
    expect(title("EMA 50")).toContain("over 50 closes");
  });

  it("everything a journal says on a decision is text", async () => {
    const evil = journalBase.decisions.map((d) => ({ ...d, headline: EVIL, action: "WAIT" }));
    await mount(serve(), { decisions: evil });
    act(() => { chartNow().crosshair!({ time: 1793942100 + IST_SHIFT }); });
    expect(screen.getByTestId("chart-detail").textContent).toContain(EVIL);
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("the Chart tab and the journal, in the dashboard", () => {
  const journal = () => vi.fn(async () => journalBase);
  const open = async (hash: string, fj: ReturnType<typeof journal>) => {
    location.hash = hash;
    FakeSocket.reset();
    const r = render(<App url="ws://prism.test/ws" createSocket={fakeFactory} fetchChart={serve()} fetchJournal={fj} api={fakeApi()} />);
    await act(async () => {});
    act(() => { FakeSocket.last.send(base); });
    await act(async () => {});
    return r;
  };
  afterEach(() => { location.hash = ""; });

  it("reads the journal when the Chart tab is opened (once), and marks where the decision changed", async () => {
    const fj = journal();
    await open("#chart", fj);
    await act(async () => {});
    expect(fj).toHaveBeenCalledTimes(1);
    expect(chartNow().candles.markers.filter((m) => m.shape === "circle")).toHaveLength(2);
    await tick(CHART_POLL_MS * 2);
    act(() => { FakeSocket.last.send(base); });
    expect(fj).toHaveBeenCalledTimes(1); // (snapshots and polls are not a reason to read it again)
  });

  it("reads nothing of the journal while another tab is open, and when the tab is left and entered again with nothing changed", async () => {
    const fj = journal();
    await open("#overview", fj);
    expect(fj).not.toHaveBeenCalled();
    await act(async () => { screen.getByRole("tab", { name: "Chart" }).click(); });
    await act(async () => {});
    expect(fj).toHaveBeenCalledTimes(1);
    await act(async () => { screen.getByRole("tab", { name: "Journal" }).click(); });
    await act(async () => { screen.getByRole("tab", { name: "Chart" }).click(); });
    await act(async () => {});
    expect(fj).toHaveBeenCalledTimes(1); // (the journal the page has is the journal)
  });

  it("a journal that could not be read leaves the chart as it was, with nothing marked", async () => {
    const fj = vi.fn(async () => { throw new Error("no journal"); });
    await open("#chart", fj as unknown as ReturnType<typeof journal>);
    await act(async () => {});
    expect(chartNow().candles.markers.filter((m) => m.shape === "circle")).toEqual([]);
    expect(screen.getByTestId("chart-detail")).toBeTruthy();
    expect(chartNow().removed).toBe(false);
  });
});


describe("the chart's markers and the line under the legend, in more detail", () => {
  const text = (id: string) => (screen.getByTestId(id).textContent ?? "").replace(/\s+/g, " ");

  it("says the nearest level over the candle as well as the one under it", async () => {
    const c = chartVariant((x) => { x.levels!.resistance = [{ price: 24310, touches: 4 }]; });
    await mount(serve(() => c));
    expect(text("chart-detail")).toContain("over: Resistance · 4 touches 24310.00 (25.0 above)");
    expect(text("chart-detail")).toContain("Nearest level under: Prev day high 24270.55");
  });

  it("hands the chart its markers oldest first even when a decision came before a later swing", async () => {
    const early = [{ ...journalBase.decisions[0]!, time: 1793940300, action: "WAIT", headline: "WAIT: early" }]; // 10:05: after the swing high of 10:00 and before the swing low of 10:40
    await mount(serve(), { decisions: early, start: everything });
    const times = chartNow().candles.markers.map((m) => m.time as number);
    expect(chartNow().candles.markers.some((m) => m.shape === "circle")).toBe(true);
    expect(chartNow().candles.markers.length).toBeGreaterThan(1);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});


describe("the simple view, the key, and the one click to everything", () => {
  const rich = chartVariant((x) => {
    x.levels!.session_open = 24260;
    x.levels!.support = [{ price: 24230, touches: 3 }, { price: 24200, touches: 1 }, { price: 24150, touches: 4 }];
    x.levels!.resistance = [{ price: 24310, touches: 4 }, { price: 24350, touches: 2 }];
  });
  const ticked = () => ["EMA 20", "EMA 50", "Key levels", "More levels", "Setup lines", "Swings", "Decisions"].map((n) => (screen.getByRole("checkbox", { name: n }) as HTMLInputElement).checked);
  const pressed = (n: string) => screen.getByRole("button", { name: n }).getAttribute("aria-pressed");
  const levels = () => live().filter((x) => !x.startsWith("CE "));

  it("starts simple: the averages, the key levels, the setup's lines and the decisions, with no swing and no other level", async () => {
    await mount(serve(() => rich));
    expect(ticked()).toEqual([true, true, true, false, true, false, true]);
    expect(levels()).toEqual(["Prev day high", "Prev day low", "Prev day close", "Today's open", "Support · 3 touches", "Resistance · 4 touches"]); // six lines, not nine
    expect(live().filter((x) => x.startsWith("CE "))).toHaveLength(5);
    expect(chartNow().candles.markers).toEqual([]);
    expect([pressed("Simple"), pressed("Everything")]).toEqual(["true", "false"]);
  });

  it("'Everything' puts back the swings and the other levels, and 'Simple' takes them away again, in one click each", async () => {
    await mount(serve(() => rich));
    await press("Everything");
    expect(ticked()).toEqual([true, true, true, true, true, true, true]);
    expect(levels()).toHaveLength(9);
    expect(chartNow().candles.markers).toHaveLength(chartBase.swings!.length);
    expect([pressed("Simple"), pressed("Everything")]).toEqual(["false", "true"]);
    await press("Simple");
    expect(ticked()).toEqual([true, true, true, false, true, false, true]);
    expect(levels()).toHaveLength(6);
    expect(chartNow().candles.markers).toEqual([]);
    expect([pressed("Simple"), pressed("Everything")]).toEqual(["true", "false"]);
    expect(rec.log.charts).toHaveLength(1); // (no new chart, and the candles were not set again)
    expect(chartNow().candles.setDataCalls).toBe(1);
  });

  it("with a box changed by hand it is neither view, and says so by pressing neither button", async () => {
    await mount(serve(() => rich));
    await toggle("Swings");
    expect([pressed("Simple"), pressed("Everything")]).toEqual(["false", "false"]);
    await toggle("Swings");
    expect([pressed("Simple"), pressed("Everything")]).toEqual(["true", "false"]);
  });

  it("keeps the timeframe when the view changes", async () => {
    const f = serve((tf) => chartVariant((c) => { c.timeframe = tf; }));
    await mount(f);
    await press("1H");
    await press("Everything");
    expect(screen.getByRole("button", { name: "1H" }).getAttribute("aria-pressed")).toBe("true");
    await press("Simple");
    expect(screen.getByRole("button", { name: "1H" }).getAttribute("aria-pressed")).toBe("true"); // (either way)
    expect(screen.getByRole("button", { name: "5M" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("says in words, on hover, what each box puts on the chart, and where the view buttons lead", async () => {
    await mount(serve());
    const hint = (n: string) => (screen.getByRole("checkbox", { name: n }).closest("label") as HTMLElement).title;
    expect(hint("Key levels")).toBe("Yesterday's high, low and close, today's open, and the nearest support below the price and resistance above it. Levels that sit close together are drawn once.");
    expect(hint("More levels")).toBe("Every other support and resistance Prism found. A lot of lines, so it is off to begin with.");
    expect(hint("Swings")).toBe("An H at every confirmed swing high and an L at every swing low today. A lot of arrows, so it is off to begin with.");
    expect(hint("Setup lines")).toBe("While Prism has a live setup: its trigger, entry area, invalidation and targets.");
    expect(hint("Decisions")).toBe("Where Prism's decision changed today: CE setup, PE setup, WAIT, NO TRADE.");
    expect(hint("EMA 20")).toBe("The fast moving average of the close (purple). Price above it leans up.");
    expect(hint("EMA 50")).toBe("The slow moving average of the close (teal). The fast one above the slow one leans up.");
    expect((screen.getByRole("group", { name: "View" })).title).toContain("Simple: the candles, the two averages, the key levels, the setup's lines and where the decision changed. Everything: also the swing arrows and every other support and resistance.");
  });

  it("draws next to each box a sample of the line it switches, in that line's own colour, dashes and fade: the boxes are the key", async () => {
    await mount(serve());
    const samples = (n: string) => [...(screen.getByRole("checkbox", { name: n }).closest("label") as HTMLElement).querySelectorAll(".ksw")].map((e) => (e as HTMLElement).getAttribute("style") ?? "");
    const look = (css: string, border: string, opacity?: string) => `border-top-color: ${css}; border-top-style: ${border};${opacity ? ` opacity: ${opacity};` : ""}`.replace(/;$/, ";");
    expect(samples("EMA 20")).toEqual(["border-top-color: var(--ema20);"]);
    expect(samples("EMA 50")).toEqual(["border-top-color: var(--ema50);"]);
    expect(samples("Key levels")).toEqual([look("var(--warn)", "dotted", "1"), look("var(--mut)", "dotted", "1"), look("var(--ok)", "dashed", "0.6"), look("var(--bad)", "dashed", "0.6")]); // amber dotted, grey dotted, faded green dashed, faded red dashed
    expect(samples("More levels")).toEqual([look("var(--ok)", "dashed", "0.6"), look("var(--bad)", "dashed", "0.6")]);
    expect(samples("Setup lines")).toEqual([look("var(--acc)", "dashed", "1"), look("var(--bad)", "solid", "1"), look("var(--ok)", "dashed", "1")]); // the trigger, the invalidation, the target
    expect(samples("Swings")).toEqual([]);
    expect((screen.getByRole("checkbox", { name: "Swings" }).closest("label") as HTMLElement).querySelectorAll(".kmk").length).toBe(2); // an arrow down and an arrow up
    expect((screen.getByRole("checkbox", { name: "Decisions" }).closest("label") as HTMLElement).querySelectorAll(".kmk").length).toBe(1); // a dot
  });

  it("names every box by its words alone: the samples are not part of its name", async () => {
    await mount(serve());
    const labels = [...document.querySelectorAll("[aria-label='On the chart'] label")].map((l) => (l.textContent ?? "").trim());
    expect(labels).toEqual(["EMA 20", "EMA 50", "Key levels", "More levels", "Setup lines", "Swings", "Decisions"]);
  });

  it("keeps every level label short enough to sit in the room on the right of the chart", async () => {
    await mount(serve(() => rich), { start: everything });
    for (const l of chartNow().candles.live) expect(l.title.length, l.title).toBeLessThanOrEqual(30);
  });
});
