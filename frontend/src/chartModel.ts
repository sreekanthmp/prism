import type { ChartData, ChartSetup, LinePoint, Moment, Swing } from "./chartTypes";
import { DASH, fmtT, n1, n2 } from "./format";
import type { JournalRow } from "./types";

// Everything the chart draws is worked out here, as plain data, so it can be tested without a canvas. The component that owns the canvas (components/PriceChart.tsx) only hands it over.

export const IST_SHIFT = 19800; // IST is UTC+05:30 all year. The chart library draws times as UTC, so every time is moved on by this much and its labels then read IST, on any PC.

/** A time as the chart takes it: epoch seconds moved to IST, or for a daily candle its IST calendar day. */
export type ChartTime = number | string;
export const timeOf = (m: Moment): ChartTime => m.date ?? m.time + IST_SHIFT;

export interface Bar {
  time: ChartTime;
  open: number;
  high: number;
  low: number;
  close: number;
}
export interface Bars {
  timeframe: string;
  bars: Bar[];
  forming: boolean; // the last bar is the candle still forming
}

/** The closed candles, then the one forming (only if it is newer than the last closed one), as chart bars: the times strictly ascending and none twice, whatever the answer held. */
export function candleBars(data: ChartData): Bars {
  const bars: Bar[] = [];
  let lastTime = -Infinity;
  const add = (c: ChartData["candles"][number]) => {
    if (!(c.time > lastTime)) return; // out of order or twice: the chart refuses such data, so it is never handed over
    lastTime = c.time;
    bars.push({ time: timeOf(c), open: c.open, high: c.high, low: c.low, close: c.close });
  };
  for (const c of data.candles) add(c);
  const before = bars.length;
  if (data.forming) add(data.forming);
  return { timeframe: data.timeframe, bars, forming: bars.length > before };
}

export type Change = { kind: "reset" } | { kind: "update"; bars: Bar[] };
const same = (a: Bar, b: Bar) => a.time === b.time && a.open === b.open && a.high === b.high && a.low === b.low && a.close === b.close;

/**
 * How the chart gets from what it shows to what the answer now says. Normally the answer only adds a bar or moves the last one: those are `update`s, so the viewer's zoom and scroll stay as they
 * are. Anything else (nothing shown yet, another timeframe, fewer bars, a bar before the last one that is not what it was) is a `reset`, and the whole series is set again.
 */
export function diffBars(prev: Bars | null, next: Bars): Change {
  if (!prev || prev.timeframe !== next.timeframe || prev.bars.length === 0) return { kind: "reset" };
  const last = prev.bars[prev.bars.length - 1] as Bar;
  const at = next.bars.findIndex((b) => b.time === last.time);
  if (at === -1) return { kind: "reset" }; // the bar the chart ended on is no longer there (a forming candle that is gone, a window that moved on)
  for (let i = 0; i < at; i++) {
    const was = prev.bars[prev.bars.length - 1 - (at - i)]; // the bar the chart has where the answer has bar i, counted back from the last one
    const now = next.bars[i];
    if (!was || !now || !same(was, now)) return { kind: "reset" }; // an earlier bar is not what it was (the history was refreshed), or the answer reaches further back than the chart: draw it all again
  }
  return { kind: "update", bars: next.bars.slice(at) };
}

export const lineData = (points: LinePoint[] | undefined): { time: ChartTime; value: number }[] => {
  const out: { time: ChartTime; value: number }[] = [];
  let last = -Infinity;
  for (const p of points ?? []) {
    if (!(p.time > last)) continue;
    last = p.time;
    out.push({ time: timeOf(p), value: p.value });
  }
  return out;
};

export interface Marker {
  time: ChartTime;
  position: "aboveBar" | "belowBar";
  shape: "arrowDown" | "arrowUp";
  role: "swingHigh" | "swingLow";
  text: string;
}
/** A swing high is marked above its candle, a swing low below it. Only a swing on a candle that is drawn is marked. */
export function swingMarkers(swings: Swing[] | undefined, bars: Bar[]): Marker[] {
  const drawn = new Set(bars.map((b) => b.time));
  const out: Marker[] = [];
  for (const s of swings ?? []) {
    const time = timeOf(s);
    if (!drawn.has(time)) continue;
    out.push(s.kind === "H" ? { time, position: "aboveBar", shape: "arrowDown", role: "swingHigh", text: "H" } : { time, position: "belowBar", shape: "arrowUp", role: "swingLow", text: "L" });
  }
  return out;
}

export interface Toggles {
  ema20: boolean;
  ema50: boolean;
  swings: boolean;
  levels: boolean;
  setups: boolean;
  decisions: boolean; // where Prism's decision changed today (from the journal)
}
export const TOGGLES: { id: keyof Toggles; label: string }[] = [
  { id: "ema20", label: "EMA 20" },
  { id: "ema50", label: "EMA 50" },
  { id: "swings", label: "Swings" },
  { id: "levels", label: "Levels" },
  { id: "setups", label: "Setups" },
  { id: "decisions", label: "Decisions" },
];
export const allOn: Toggles = { ema20: true, ema50: true, swings: true, levels: true, setups: true, decisions: true };

export type Role = "trigger" | "zone" | "invalidation" | "target" | "previous" | "open" | "support" | "resistance";
export interface Overlay {
  key: string; // the same line keeps its key from one answer to the next, so it is moved, not drawn twice
  price: number;
  role: Role;
  title: string;
  focus: boolean;
}
const fin = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);

/** The horizontal lines: the previous day's high, low and close, the session open, the nearest support and resistance (all under "Levels"), and each live setup's trigger, entry area, invalidation and targets. */
export function overlays(data: ChartData, on: Toggles): Overlay[] {
  const out: Overlay[] = [];
  const lv = data.levels;
  if (on.levels && lv) {
    const pd = lv.previous_day;
    if (pd) {
      out.push({ key: "pdh", price: pd.pdh, role: "previous", title: "PDH", focus: false }, { key: "pdl", price: pd.pdl, role: "previous", title: "PDL", focus: false }, { key: "pdc", price: pd.pdc, role: "previous", title: "PDC", focus: false });
    }
    if (fin(lv.session_open)) out.push({ key: "open", price: lv.session_open, role: "open", title: "Open", focus: false });
    lv.support.forEach((l, i) => out.push({ key: `s${i}`, price: l.price, role: "support", title: `S${i + 1} ×${l.touches}`, focus: false }));
    lv.resistance.forEach((l, i) => out.push({ key: `r${i}`, price: l.price, role: "resistance", title: `R${i + 1} ×${l.touches}`, focus: false }));
  }
  if (on.setups) {
    for (const s of data.setups) {
      const d = s.direction;
      if (fin(s.trigger)) out.push({ key: `${s.id}|trigger`, price: s.trigger, role: "trigger", title: `${d} trigger`, focus: s.focus });
      if (s.zone && s.zone.length === 2 && s.zone.every(fin)) {
        const [a, b] = s.zone as [number, number];
        out.push({ key: `${s.id}|zone-lo`, price: Math.min(a, b), role: "zone", title: `${d} entry area`, focus: s.focus }, { key: `${s.id}|zone-hi`, price: Math.max(a, b), role: "zone", title: `${d} entry area`, focus: s.focus });
      }
      if (fin(s.invalidation)) out.push({ key: `${s.id}|invalidation`, price: s.invalidation, role: "invalidation", title: `${d} invalidation`, focus: s.focus });
      s.targets.forEach((t, i) => {
        if (fin(t.price)) out.push({ key: `${s.id}|target${t.n ?? i + 1}`, price: t.price, role: "target", title: `${d} target ${t.n ?? i + 1}`, focus: s.focus });
      });
    }
  }
  return out;
}

// -- where Prism's decision changed (from today's journal) --------------------------------------------------------------------------------------------------
export interface DecisionMarker {
  time: ChartTime;
  position: "aboveBar" | "belowBar";
  shape: "arrowUp" | "arrowDown" | "circle";
  tone: "ok" | "bad" | "warn" | "mut"; // the dashboard's own colours: BUY CE green, BUY PE red, WAIT amber, anything else grey
  text: string;
  size: number;
  action: string;
}

/** The bar a moment falls in: the last one that began at or before it, if the moment is before that bar ends. Bars are ascending; the moment is in the chart's own (IST-moved) seconds. */
function barAt(bars: Bar[], at: number, seconds: number): Bar | null {
  for (let i = bars.length - 1; i >= 0; i--) {
    const b = bars[i] as Bar;
    if (typeof b.time !== "number") return null; // a daily chart has no time of day to put a decision at
    if (b.time <= at) return at < b.time + seconds ? b : null;
  }
  return null;
}

function markerOf(time: ChartTime, action: string): DecisionMarker {
  if (action === "BUY CE") return { time, position: "belowBar", shape: "arrowUp", tone: "ok", text: "BUY CE", size: 1.2, action };
  if (action === "BUY PE") return { time, position: "aboveBar", shape: "arrowDown", tone: "bad", text: "BUY PE", size: 1.2, action };
  if (action === "WAIT") return { time, position: "belowBar", shape: "circle", tone: "warn", text: "", size: 0.8, action };
  return { time, position: "belowBar", shape: "circle", tone: "mut", text: "", size: 0.6, action }; // NO TRADE and anything else
}

/**
 * Where Prism's decision CHANGED, on the candle it changed in: a BUY CE as a green arrow under it, a BUY PE as a red arrow over it, a WAIT as an amber dot, anything else (NO TRADE) as a grey dot. Only a
 * decision on a candle that is drawn is marked, one candle never carries the same decision twice, and the daily chart has none (the journal is kept for the day). Oldest first, as the chart wants them.
 */
export function decisionMarkers(rows: JournalRow[] | null | undefined, bars: Bar[], seconds: number): DecisionMarker[] {
  const out: DecisionMarker[] = [];
  const seen = new Set<string>();
  for (const r of rows ?? []) {
    if (!fin(r.time) || !r.action) continue;
    const bar = barAt(bars, r.time + IST_SHIFT, seconds);
    if (!bar) continue;
    const key = `${bar.time}|${r.action}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(markerOf(bar.time, r.action));
  }
  return out.sort((a, b) => (a.time as number) - (b.time as number));
}

// -- what one candle says (the line under the legend) ---------------------------------------------------------------------------------------------------
export interface LevelRef {
  label: string; // S1 ×7, PDH, Open ...
  price: string;
  where: string; // 59.2 below / 25.9 above / at the close
}
export interface Detail {
  range: string; // 12.40 pts
  atr: string | null; // 0.7× the ATR(14) of 17.5
  body: string; // closed up 8.20
  ema20: string | null;
  ema50: string | null;
  below: LevelRef | null;
  above: LevelRef | null;
  decisions: string[]; // BUY CE at 10:55: Trend Pullback setup confirmed
}

const LEVEL_ROLES: Role[] = ["previous", "open", "support", "resistance"];

/**
 * What the candle under the mouse (or the latest one) says beyond its four prices: how big it was (in points and in the ATR), whether it closed up or down and by how much, where it closed against the two
 * EMAs, the nearest level under it and over it (the previous day's high, low and close, the session open, the support and the resistance), and what Prism's decision said on it. All of it worked out from
 * what Prism already sent; nothing here is a signal.
 */
export function detailFor(data: ChartData, bars: Bar[], index: number, rows?: JournalRow[] | null): Detail | null {
  const b = bars[index];
  if (!b) return null;
  const range = b.high - b.low;
  const atr = data.facts?.atr14_intraday;
  const body = b.close - b.open;
  const close = b.close;
  const against = (value: number | undefined): string | null => {
    if (value === undefined) return null;
    const d = close - value;
    return `${n2(value)} (the close is ${Math.abs(d) < 0.005 ? "on it" : `${n2(Math.abs(d))} ${d > 0 ? "above" : "below"}`})`;
  };
  const at = (points: LinePoint[] | undefined) => lineData(points).find((p) => p.time === b.time)?.value;
  const refs = overlays(data, { ...allOn, setups: false }).filter((o) => LEVEL_ROLES.includes(o.role));
  const ref = (o: Overlay | undefined): LevelRef | null => {
    if (!o) return null;
    const d = o.price - close;
    return { label: o.title, price: n2(o.price), where: Math.abs(d) < 0.005 ? "at the close" : `${n1(Math.abs(d))} ${d > 0 ? "above" : "below"}` };
  };
  const below = refs.filter((o) => o.price <= close).sort((x, y) => y.price - x.price)[0];
  const above = refs.filter((o) => o.price > close).sort((x, y) => x.price - y.price)[0];
  const said = typeof b.time === "number" ? (rows ?? []).filter((r) => fin(r.time) && r.action && barAt([b], r.time + IST_SHIFT, data.seconds)).sort((x, y) => x.time - y.time) : [];
  return {
    range: `${n2(range)} pts`,
    atr: fin(atr) && atr > 0 ? `${(range / atr).toFixed(1)}× the ATR(14) of ${n1(atr)}` : null,
    body: body > 0 ? `closed up ${n2(body)}` : body < 0 ? `closed down ${n2(-body)}` : "had no body (open = close)",
    ema20: against(at(data.ema20)),
    ema50: against(at(data.ema50)),
    below: ref(below),
    above: ref(above),
    decisions: said.map((r) => `${r.action} at ${fmtT(r.time, false)}${r.headline ? `: ${r.headline}` : ""}`),
  };
}

/** What each number under the chart means, in plain words (their tooltips, and the guide). They are the usual meanings of the indicators, said short; they promise nothing about what price will do. */
export const FACT_HELP = {
  trend: "Prism's own reading of the direction on this timeframe: bullish, bearish or sideways.",
  adx: "ADX: how strong the trend is, whichever way it points. Under about 20 there is little or no trend; over about 25 there is a clear one.",
  rsi: "RSI: momentum from 0 to 100. Above about 70 price has run up fast; below about 30 it has fallen fast.",
  atr: "ATR(14): the average size of a candle over the last 14, in index points. A yardstick for how far a normal move goes.",
  ema20: "EMA 20: an average of the last 20 closes that weights the latest most (the fast one, drawn in purple). Price above it leans up.",
  ema50: "EMA 50: the same over 50 closes (the slow one, drawn in teal). The fast one above the slow one leans up.",
} as const;

// -- what is said in words, under and over the chart --------------------------------------------------------------------------------------------------
/** A bar's time as the legend says it: `06/11 10:50` for an intraday candle, the day for a daily one. Times are already moved to IST, so they are read as UTC. */
export function barTime(t: ChartTime): string {
  if (typeof t === "string") return t.split("-").reverse().join("/");
  return new Date(t * 1000).toLocaleString("en-GB", { timeZone: "UTC", hour12: false, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(",", "");
}

export interface Legend {
  when: string;
  open: string;
  high: string;
  low: string;
  close: string;
  change: string; // against the candle before it
  tone: "up" | "down" | "neu";
}
/** The legend line for one bar: its prices and its move from the bar before. */
export function legendFor(bars: Bar[], index: number): Legend | null {
  const b = bars[index];
  if (!b) return null;
  const prev = bars[index - 1];
  const move = prev ? b.close - prev.close : null;
  const pct = prev && prev.close !== 0 && move !== null ? (move / prev.close) * 100 : null;
  return {
    when: barTime(b.time), open: n2(b.open), high: n2(b.high), low: n2(b.low), close: n2(b.close),
    change: move === null || pct === null ? DASH : `${move > 0 ? "+" : ""}${n2(move)} (${pct > 0 ? "+" : ""}${pct.toFixed(2)}%)`,
    tone: move === null || move === 0 ? "neu" : move > 0 ? "up" : "down",
  };
}

export interface SetupLine {
  id: string;
  focus: boolean;
  head: string; // CE · Trend Pullback
  stage: string;
  prices: string[]; // Trigger 24,999.00 · Entry area ...
}
const px = n2; // prices are written as the header writes them: 24287.00
/** A live setup in words and numbers, the same ones its lines on the chart are drawn at. */
export function setupLine(s: ChartSetup): SetupLine {
  const zone = s.zone && s.zone.length === 2 ? `${px(Math.min(...s.zone))}–${px(Math.max(...s.zone))}` : DASH;
  const targets = s.targets.filter((t) => fin(t.price)).map((t) => `Target ${t.n ?? ""} ${px(t.price)}${t.label ? ` (${t.label})` : ""}`.replace("  ", " "));
  return {
    id: s.id,
    focus: s.focus,
    head: `${s.direction} · ${s.strategy_name}`,
    stage: s.stage_text ?? s.status,
    prices: [`Trigger ${px(s.trigger)}`, `Entry area ${zone}`, `Invalidation ${px(s.invalidation)}`, ...(targets.length ? targets : ["No target named"])],
  };
}
