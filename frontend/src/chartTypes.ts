// What GET /api/chart answers (app/chart.py). Typed from the real payload: `src/test/fixtures/chart.json` is the engine's own answer (tests/make_frontend_fixture.py), and `npm run typecheck`
// fails when a field used here is not what the fixture has. Anything the server may not know is `| null`: an unknown value is drawn as unknown, never as a zero.

export const CHART_TIMEFRAMES = [
  { id: "1m", label: "1M", limit: 375 }, // one session of 1M candles
  { id: "5m", label: "5M", limit: 300 },
  { id: "15m", label: "15M", limit: 300 },
  { id: "1h", label: "1H", limit: 200 },
  { id: "1d", label: "1D", limit: 120 },
] as const;
export type ChartTimeframe = (typeof CHART_TIMEFRAMES)[number]["id"];

/** A moment on the chart: epoch seconds, and for a daily candle also the IST calendar day it sits on. */
export interface Moment {
  time: number;
  date?: string;
}
export interface ChartCandle extends Moment {
  open: number;
  high: number;
  low: number;
  close: number;
}
export interface FormingCandle extends ChartCandle {
  partial: boolean; // Prism started in the middle of it, or a gap overlapped it: it may not have seen every tick
  ticks: number;
}
export interface LinePoint extends Moment {
  value: number;
}
export interface Swing extends Moment {
  kind: string; // "H" (a swing high) or "L" (a swing low)
  price: number;
}
export interface Level {
  price: number;
  touches: number;
}
export interface PreviousDay {
  date: string;
  pdh: number;
  pdl: number;
  pdc: number;
  stale: boolean;
  note: string | null;
}
export interface ChartFacts {
  trend: string; // bullish | bearish | sideways | unknown
  adx: number | null;
  rsi14: number | null;
  atr14_intraday: number | null;
  ema20: number | null;
  ema50: number | null;
  bars: number;
  warm: boolean;
}
export interface ChartLevels {
  previous_day: PreviousDay | null;
  session_open: number | null;
  session_date: string | null;
  support: Level[];
  resistance: Level[];
}
export interface ChartTarget {
  n: number | null;
  price: number | null;
  label: string | null;
}
export interface ChartSetup {
  id: string;
  strategy: string;
  strategy_name: string;
  direction: string; // CE | PE
  side: string; // bull | bear
  status: string;
  stage: string | null;
  stage_text: string | null;
  actionable: boolean;
  trigger: number | null;
  zone: number[] | null;
  invalidation: number | null;
  detected_at: number | null;
  confirmed_at: number | null;
  targets: ChartTarget[];
  focus: boolean; // the setup the decision is about
}
export interface ChartData {
  available: boolean;
  timeframe: string;
  seconds: number;
  as_of: number;
  reason?: string; // why there is nothing to draw
  session_date?: string | null;
  price?: number | null;
  reliable?: boolean;
  warnings?: string[];
  notes?: string[];
  candles: ChartCandle[];
  forming: FormingCandle | null;
  ema20?: LinePoint[];
  ema50?: LinePoint[];
  swings?: Swing[];
  facts?: ChartFacts | null;
  levels?: ChartLevels;
  setups: ChartSetup[];
  decision?: { action: string | null; setup_id: string | null };
  window?: { returned: number; held: number; limit: number; first: number | null; last: number | null };
}

type Rec = Record<string, unknown>;
const isObj = (x: unknown): x is Rec => typeof x === "object" && x !== null && !Array.isArray(x);
const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const nullableNum = (x: unknown): boolean => x === null || x === undefined || num(x);
const strings = (x: unknown): boolean => Array.isArray(x) && x.every((s) => typeof s === "string");
const moment = (x: unknown): x is Rec => isObj(x) && num(x.time) && (x.date === undefined || typeof x.date === "string");
const candle = (x: unknown): x is Rec => moment(x) && num(x.open) && num(x.high) && num(x.low) && num(x.close);
const forming = (x: unknown): boolean => x === null || (candle(x) && typeof x.partial === "boolean");
const points = (x: unknown): boolean => x === undefined || (Array.isArray(x) && x.every((p) => moment(p) && num(p.value)));
const swings = (x: unknown): boolean => x === undefined || (Array.isArray(x) && x.every((p) => moment(p) && num(p.price) && typeof p.kind === "string"));
const target = (x: unknown): boolean => isObj(x) && nullableNum(x.price);
const setup = (x: unknown): boolean =>
  isObj(x) && typeof x.id === "string" && typeof x.strategy_name === "string" && typeof x.direction === "string" && typeof x.status === "string" && typeof x.focus === "boolean" &&
  nullableNum(x.trigger) && nullableNum(x.invalidation) && (x.zone === null || (Array.isArray(x.zone) && x.zone.every(num))) && Array.isArray(x.targets) && x.targets.every(target);
const levelList = (x: unknown): boolean => Array.isArray(x) && x.every((l) => isObj(l) && num(l.price) && num(l.touches));
const previousDay = (x: unknown): boolean => x === null || (isObj(x) && num(x.pdh) && num(x.pdl) && num(x.pdc) && typeof x.date === "string");
const levels = (x: unknown): boolean => x === undefined || (isObj(x) && levelList(x.support) && levelList(x.resistance) && nullableNum(x.session_open) && previousDay(x.previous_day));

/** The answer if it is what this page expects, otherwise null. Every number that is drawn is checked to be a number: the chart library throws on one that is not, and a throw would blank the tab. */
export function parseChart(x: unknown): ChartData | null {
  if (!isObj(x) || typeof x.available !== "boolean" || typeof x.timeframe !== "string" || !num(x.as_of)) return null;
  if (!Array.isArray(x.candles) || !x.candles.every(candle) || !Array.isArray(x.setups) || !x.setups.every(setup) || !forming(x.forming)) return null;
  if (!points(x.ema20) || !points(x.ema50) || !swings(x.swings) || !levels(x.levels)) return null;
  if ((x.warnings !== undefined && !strings(x.warnings)) || (x.notes !== undefined && !strings(x.notes))) return null;
  return x as unknown as ChartData;
}
