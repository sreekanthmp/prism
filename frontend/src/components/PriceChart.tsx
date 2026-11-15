import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  LineSeries,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
} from "lightweight-charts";
import { useEffect, useRef } from "react";
import { candleBars, diffBars, lineData, overlays, swingMarkers, type Bar, type Bars, type DecisionMarker, type Role, type Toggles } from "../chartModel";
import type { ChartData } from "../chartTypes";

/** The colours are the dashboard's own (styles.css): read from there, so the chart and the page are one palette. The fallbacks are the same values. */
export function palette() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return { panel: v("--panel", "#14181e"), line: v("--line", "#272f3a"), fg: v("--fg", "#d9dee5"), mut: v("--mut", "#8b95a4"), ok: v("--ok", "#3ddc84"), bad: v("--bad", "#ff6b6b"), warn: v("--warn", "#f5b942"), acc: v("--acc", "#5aa9ff"), ema20: v("--ema20", "#c792ea"), ema50: v("--ema50", "#4dd0e1") };
}
type Palette = ReturnType<typeof palette>;

const STYLE: Record<Role, { color: keyof Palette; style: LineStyle; width: 1 | 2 }> = {
  trigger: { color: "acc", style: LineStyle.Dashed, width: 1 },
  zone: { color: "ok", style: LineStyle.Dotted, width: 1 },
  invalidation: { color: "bad", style: LineStyle.Solid, width: 1 },
  target: { color: "ok", style: LineStyle.Dashed, width: 1 },
  previous: { color: "warn", style: LineStyle.Dotted, width: 1 },
  open: { color: "mut", style: LineStyle.Dotted, width: 1 },
  support: { color: "mut", style: LineStyle.SparseDotted, width: 1 },
  resistance: { color: "mut", style: LineStyle.SparseDotted, width: 1 },
};
const VISIBLE_BARS = 120; // a new chart shows the latest bars, not all of them: a few hundred candles side by side are too thin to read

/** What a test or a caller can reach of the chart (the library's own handle). */
export interface ChartHandle {
  chart: IChartApi;
}

/**
 * The canvas. It is created once, and then only told what changed: a new bar or a moved last bar is an `update` (so the viewer's zoom and scroll stay where they put them), anything else is a
 * full `setData`, and a horizontal line that has not moved is left alone. It draws what `chartModel` worked out and works out nothing itself.
 */
export function PriceChart({ data, on, decisions = [], onHover, onReady }: { data: ChartData; on: Toggles; decisions?: DecisionMarker[]; onHover: (index: number | null) => void; onReady?: (h: ChartHandle) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const live = useRef<{
    chart: IChartApi;
    candles: ISeriesApi<"Candlestick">;
    ema20: ISeriesApi<"Line">;
    ema50: ISeriesApi<"Line">;
    markers: ISeriesMarkersPluginApi<Time>;
    shown: Bars | null;
    lines: Map<string, { line: IPriceLine; sig: string }>;
    colors: Palette;
  } | null>(null);
  const hover = useRef(onHover);
  hover.current = onHover;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const colors = palette();
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: colors.panel }, textColor: colors.mut, fontSize: 12 },
      grid: { vertLines: { color: colors.line }, horzLines: { color: colors.line } },
      rightPriceScale: { borderColor: colors.line },
      timeScale: { borderColor: colors.line, timeVisible: true, secondsVisible: false },
      crosshair: { mode: CrosshairMode.Normal },
    });
    const candles = chart.addSeries(CandlestickSeries, { upColor: colors.ok, downColor: colors.bad, wickUpColor: colors.ok, wickDownColor: colors.bad, borderVisible: false });
    const line = (color: string) => chart.addSeries(LineSeries, { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    const ema20 = line(colors.ema20);
    const ema50 = line(colors.ema50);
    const markers = createSeriesMarkers(candles, []);
    const state = { chart, candles, ema20, ema50, markers, shown: null as Bars | null, lines: new Map<string, { line: IPriceLine; sig: string }>(), colors };
    live.current = state;
    chart.subscribeCrosshairMove((p) => {
      const t = p.time;
      const bars = state.shown?.bars;
      if (t === undefined || !bars) return hover.current(null);
      const i = bars.findIndex((b) => b.time === t);
      hover.current(i === -1 ? null : i);
    });
    onReady?.({ chart });
    return () => {
      live.current = null;
      chart.remove();
    };
    // the canvas is made once for the life of the component; what it shows follows the data below
  }, []);

  useEffect(() => {
    const c = live.current;
    if (!c) return;
    const next = candleBars(data);
    const daily = data.timeframe === "1d";
    c.chart.applyOptions({ timeScale: { timeVisible: !daily } });
    const change = diffBars(c.shown, next);
    const asSeries = (b: Bar) => ({ ...b, time: b.time as Time });
    if (change.kind === "reset") {
      c.candles.setData(next.bars.map(asSeries));
      const n = next.bars.length;
      if (n > 0) c.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - VISIBLE_BARS), to: n + 4 });
    } else {
      for (const b of change.bars) c.candles.update(asSeries(b));
    }
    c.shown = next;
    c.ema20.setData(on.ema20 ? lineData(data.ema20).map((p) => ({ ...p, time: p.time as Time })) : []);
    c.ema50.setData(on.ema50 ? lineData(data.ema50).map((p) => ({ ...p, time: p.time as Time })) : []);
    const swings = on.swings
      ? swingMarkers(data.swings, next.bars).map((m) => ({ time: m.time as Time, position: m.position, shape: m.shape, text: m.text, size: 0.7, color: m.role === "swingHigh" ? c.colors.bad : c.colors.ok }))
      : [];
    const said = on.decisions ? decisions.map((d) => ({ time: d.time as Time, position: d.position, shape: d.shape, text: d.text, size: d.size, color: c.colors[d.tone] })) : [];
    c.markers.setMarkers([...swings, ...said].sort((a, b) => (a.time as number) - (b.time as number))); // (the chart wants its markers oldest first)

    const want = new Map(overlays(data, on).map((o) => [o.key, o]));
    for (const [key, have] of c.lines) {
      if (!want.has(key)) {
        c.candles.removePriceLine(have.line);
        c.lines.delete(key);
      }
    }
    for (const [key, o] of want) {
      const look = STYLE[o.role];
      const width = o.focus ? 2 : look.width;
      const sig = `${o.price}|${o.title}|${o.role}|${width}`;
      const have = c.lines.get(key);
      if (have?.sig === sig) continue; // the line is where it was: left alone
      if (have) c.candles.removePriceLine(have.line);
      c.lines.set(key, { sig, line: c.candles.createPriceLine({ price: o.price, color: c.colors[look.color], lineWidth: width, lineStyle: look.style, axisLabelVisible: true, title: o.title }) });
    }
  }, [data, on, decisions]);

  return <div ref={box} className="chart-box" data-testid="chart-box" />;
}
