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
import { ChartTab, defaultPrefs, type ChartPrefs } from "./ChartTab";

// The canvas is replaced by a recorder: these tests are about WHAT the tab tells the chart to draw (and when it redraws and when it only moves the last bar). How it looks in a real browser is
// tested in tests/test_chart_browser.py, in Chrome.
const rec = vi.hoisted(() => {
  class FakeSeries {
    data: { time: unknown; [k: string]: unknown }[] = [];
    updates: { time: unknown; [k: string]: unknown }[] = [];
    setDataCalls = 0;
    lines: { price: number; color: string; lineWidth: number; lineStyle: number; title: string; removed: boolean }[] = [];
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
    expect(chartNow().range).toEqual({ from: 0, to: 64 }); // (the answer has fewer bars than the 120 a new chart shows)
    expect(chartNow().applied.at(-1)).toEqual({ timeScale: { timeVisible: true } });
  });

  it("draws the EMAs and the swings from the answer, in the dashboard's colours", async () => {
    await mount(serve());
    const [e20, e50] = chartNow().lineSeries;
    expect(e20!.data).toHaveLength(60);
    expect(e50!.data).toHaveLength(60);
    expect(e20!.data[59]).toEqual({ time: chartBase.ema20![59]!.time + IST_SHIFT, value: chartBase.ema20![59]!.value });
    expect([e20!.options.color, e50!.options.color]).toEqual(["#c792ea", "#4dd0e1"]); // (not the blue of a trigger, nor the amber of a level)
    const m = chartNow().candles.markers;
    expect(m).toHaveLength(chartBase.swings!.length);
    expect(m.filter((x) => x.text === "H").every((x) => x.position === "aboveBar" && x.color === RED)).toBe(true);
    expect(m.filter((x) => x.text === "L").every((x) => x.position === "belowBar" && x.color === GREEN)).toBe(true);
  });

  it("draws the previous day's levels and the setup's trigger, entry area, invalidation and target, each in its own look", async () => {
    await mount(serve());
    expect(live()).toEqual(["PDH", "PDL", "PDC", "Open", "CE trigger", "CE entry area", "CE entry area", "CE invalidation", "CE target 1"]);
    const by = (t: string) => chartNow().candles.live.find((l) => l.title === t)!;
    const s = chartBase.setups[0]!;
    expect(by("CE trigger")).toMatchObject({ price: s.trigger, color: "#5aa9ff", lineStyle: 2, lineWidth: 2 }); // dashed blue, thick: it is the decision's setup
    expect(by("CE invalidation")).toMatchObject({ price: s.invalidation, color: RED, lineStyle: 0 }); // solid red
    expect(by("CE target 1")).toMatchObject({ price: s.targets[0]!.price, color: GREEN, lineStyle: 2 });
    expect(by("PDH")).toMatchObject({ price: chartBase.levels!.previous_day!.pdh, color: "#f5b942", lineStyle: 1, lineWidth: 1 });
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
    expect(box.querySelector("h3")?.textContent).toBe("Prism's setups on this chart · decision: BUY CE");
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
    expect(live()).toEqual(["PDH", "PDL", "PDC", "Open"]);
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
    await toggle("Swings");
    expect(chartNow().candles.markers).toEqual([]);
    await toggle("Setups");
    expect(live()).toEqual(["PDH", "PDL", "PDC", "Open"]);
    await toggle("Levels");
    expect(live()).toEqual([]);
    await toggle("Setups");
    expect(live()).toEqual(["CE trigger", "CE entry area", "CE entry area", "CE invalidation", "CE target 1"]);
    expect(rec.log.charts).toHaveLength(1); // none of this made another chart
    expect(chartNow().candles.setDataCalls).toBe(1); // and none of it redrew the candles
  });

  it("a choice is handed to the page whole: the timeframe with the boxes as they were, a box with the timeframe as it was", async () => {
    const seen: ChartPrefs[] = [];
    const f = serve((tf) => chartVariant((c) => { c.timeframe = tf; }));
    const start: ChartPrefs = { timeframe: "15m", on: { ema20: false, ema50: true, swings: false, levels: true, setups: false, decisions: true } }; // (nothing here is the default)
    render(<ChartTab prefs={start} onPrefs={(p) => seen.push(p)} paused={false} fetcher={f} />);
    await act(async () => {});
    act(() => { fireEvent.click(screen.getByRole("button", { name: "1H" })); });
    act(() => { fireEvent.click(screen.getByRole("checkbox", { name: "Swings" })); });
    expect(seen).toEqual([{ timeframe: "1h", on: start.on }, { timeframe: "15m", on: { ...start.on, swings: true } }]);
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
    expect(chartNow().range).toEqual({ from: 0, to: 64 }); // (set once, when the chart was made)
  });

  it("a line that has not moved is left alone and one that has is moved, not drawn twice", async () => {
    const moved = chartVariant((c) => { c.setups[0]!.invalidation = 24260.5; });
    const answers = [chartBase, moved];
    const f = serve();
    f.mockImplementation(async () => answers.shift() ?? moved);
    await mount(f);
    const lines = chartNow().candles.lines;
    expect(lines).toHaveLength(9);
    await tick(CHART_POLL_MS);
    expect(lines).toHaveLength(10); // one line was made again: the invalidation
    expect(lines.filter((l) => l.removed).map((l) => l.title)).toEqual(["CE invalidation"]);
    expect(live().filter((t) => t === "CE invalidation")).toHaveLength(1);
    expect(chartNow().candles.live.find((l) => l.title === "CE invalidation")!.price).toBe(24260.5);
    await tick(CHART_POLL_MS);
    expect(lines).toHaveLength(10); // and the same answer again changes nothing
  });

  it("a setup that has ended loses its lines on the next answer", async () => {
    const answers = [chartBase, chartVariant((c) => { c.setups = []; })];
    const f = serve();
    f.mockImplementation(async () => answers.shift() ?? chartBase);
    await mount(f);
    expect(live()).toHaveLength(9);
    await tick(CHART_POLL_MS);
    expect(live()).toEqual(["PDH", "PDL", "PDC", "Open"]);
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
    await toggle("Swings");
    await act(async () => { screen.getByRole("tab", { name: "Journal" }).click(); });
    expect(screen.queryByTestId("chart-tab")).toBeNull();
    expect(rec.log.charts.every((c) => c.removed)).toBe(true); // the canvas goes with the tab
    const calls = f.mock.calls.length;
    await tick(CHART_POLL_MS * 4);
    expect(f.mock.calls.length).toBe(calls); // and nothing is asked while it is away
    await act(async () => { screen.getByRole("tab", { name: "Chart" }).click(); });
    expect(screen.getByRole("button", { name: "1H" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByRole("checkbox", { name: "Swings" }) as HTMLInputElement).checked).toBe(false);
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
    expect(t).toContain("Nearest level under: PDH 24270.55 (14.5 below)");
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
    await mount(serve(), { decisions: journalBase.decisions });
    expect(circles()).toEqual([
      { time: 1793941800 + IST_SHIFT, position: "belowBar", shape: "circle", text: "", size: 0.8, color: AMBER },
      { time: 1793942100 + IST_SHIFT, position: "belowBar", shape: "circle", text: "", size: 0.8, color: AMBER },
    ]);
    const times = chartNow().candles.markers.map((m) => m.time as number);
    expect(times).toEqual([...times].sort((a, b) => a - b)); // (swings and decisions together, oldest first)
    expect(chartNow().candles.markers.filter((m) => m.text === "H" || m.text === "L").length).toBeGreaterThan(0); // (the swings are still there)
  });

  it("a BUY CE is a green arrow under the candle it came on, once that candle has formed", async () => {
    await mount(serve(() => withForming), { decisions: journalBase.decisions });
    const buy = chartNow().candles.markers.find((m) => m.text === "BUY CE");
    expect(buy).toEqual({ time: 1793942700 + IST_SHIFT, position: "belowBar", shape: "arrowUp", text: "BUY CE", size: 1.2, color: GREEN });
    expect(circles()).toHaveLength(2);
  });

  it("the 'Decisions' box takes them away and gives them back, and only them", async () => {
    await mount(serve(() => withForming), { decisions: journalBase.decisions });
    const swings = () => chartNow().candles.markers.filter((m) => m.text === "H" || m.text === "L").length;
    const was = swings();
    await toggle("Decisions");
    expect(chartNow().candles.markers.filter((m) => m.shape === "circle" || m.text === "BUY CE")).toEqual([]);
    expect(swings()).toBe(was);
    await toggle("Decisions");
    expect(chartNow().candles.markers.filter((m) => m.shape === "circle" || m.text === "BUY CE")).toHaveLength(3);
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
    for (const said of ["How to read this chart", "EMA 20", "EMA 50", "H and L arrows", "BUY CE", "BUY PE", "amber dot for WAIT", "grey dot for NO TRADE", "today's journal", "PDH, PDL, PDC", "S1, S2", "×", "trigger", "entry area", "invalidation", "targets", "The line under the legend", "Hover each one", "none of this tells you to buy or sell"]) {
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
    expect(text("chart-detail")).toContain("over: R1 ×4 24310.00 (25.0 above)");
    expect(text("chart-detail")).toContain("Nearest level under: PDH 24270.55");
  });

  it("hands the chart its markers oldest first even when a decision came before a later swing", async () => {
    const early = [{ ...journalBase.decisions[0]!, time: 1793940300, action: "WAIT", headline: "WAIT: early" }]; // 10:05: after the swing high of 10:00 and before the swing low of 10:40
    await mount(serve(), { decisions: early });
    const times = chartNow().candles.markers.map((m) => m.time as number);
    expect(chartNow().candles.markers.some((m) => m.shape === "circle")).toBe(true);
    expect(chartNow().candles.markers.length).toBeGreaterThan(1);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});
