// The parts of Prism's snapshot (what /api/state and the WebSocket send) that the dashboard reads. Typed from the real payload: `src/test/fixtures/snapshot.json` is the engine's own output, and
// `npm run typecheck` fails when a field used here is not what the fixture has. A section the dashboard does not read yet is `unknown`: it is typed when the stage that draws it is built.
// Anything the server may not know is `| null`: an unknown value is shown as unknown, never as a zero.

export interface Connection {
  state: string; // starting | connecting | connected | disconnected | auth_failed | config_error
  since: number | null;
  reconnects: number;
  last_tick_received: number | null;
  ticks_accepted: number;
  ticks_rejected: Record<string, number>;
  spot_age: number | null;
  attempt: number;
  reason: string | null;
}

export interface Candle {
  start: number;
  end?: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  ticks?: number; // a candle that has completed in the analysis carries no tick count
  partial?: boolean;
  source: string; // live | history | db | aggregated
}
export interface InstrumentRow {
  role: string; // SPOT, ATM_CE, ...
  token: string;
  symbol: string;
  expiry?: string | null;
  strike?: number | null;
  lot_size: number | null;
  ltp: number | null;
  volume?: number | null;
  age: number | null; // seconds since Prism RECEIVED the last tick
  status: string; // fresh | stale | no data | market closed
  exchange_time: number | null;
  received_time: number | null;
  candles?: Partial<Record<string, { current: Candle | null; last_closed: Candle | null }>>; // the instruments whose candles are charted (NIFTY and the at-the-money pair); the rest have none
}

export interface HealthInstrument {
  role: string;
  symbol?: string;
  limit?: number;
  exchange_time?: number | null;
  received_time?: number | null;
  age: number | null;
  receipt_age: number | null;
  status: string;
  exchange_age: number | null; // seconds since the EXCHANGE's own time on the last tick: a different clock, never mixed with the receipt age
  exchange_status: string; // fresh | stale | unknown
  exchange_reason: string | null;
}

export interface StartupStage {
  label: string;
  status: string; // done | active | retrying | pending | failed | warn
  detail: string | null;
}
export interface Readiness {
  state: string; // INITIALIZING | HISTORICAL_LOADING | RECOVERING_GAPS | READY | DEGRADED | FAILED
  ready: boolean;
  decisions_permitted: boolean;
  summary: string;
  pre_market: boolean;
  stages?: StartupStage[];
  history?: { attempts: number; max_attempts: number; error: string | null; last_success: number | null; next_try_in: number | null; error_kind: string | null };
  candles?: { missing_today: Record<string, number>; missing_in_decision_window: Record<string, number>; unavailable_after_retries: number };
}
export interface HealthEvent {
  time: number;
  kind: string;
  message?: string | null;
  reason?: string | null;
  attempt?: number | null;
}
export interface Recovery {
  requests?: number;
  recovered?: number;
  failures?: number;
  deferred?: number;
  last_error?: string | null;
  api_requests?: number;
  refusals?: number;
  cooling_down?: boolean;
  cooldown_seconds?: number;
  refusal_error?: string | null;
  pending_candles?: number;
  history_refreshing?: boolean;
}
export interface Validation {
  date: string;
  status: string;
  file?: string | null;
  lines?: string[];
}
export interface Diagnostics {
  uptime_seconds: number | null;
  instance: { pid: number } | null;
  last_recovery_attempt: number | null;
  last_spot_tick_age: number | null;
  reconnects: number;
  background_tasks: string[];
}

export interface Health {
  live: boolean; // the market is open
  trusted: boolean;
  issues: string[];
  warnings: string[];
  instruments: HealthInstrument[];
  feed: { state: string; reason: string | null; attempt?: number; events?: HealthEvent[] };
  time?: { trusted: boolean; reason?: string | null; events?: HealthEvent[] } | null;
  recovery?: Recovery;
  validation?: Validation | null;
  diagnostics?: Diagnostics | null;
  readiness?: Readiness;
}

export interface MarketChange {
  available: boolean;
  why?: string;
  points?: number;
  percent?: number;
  basis?: string;
  previous_close?: number;
  previous_close_date?: string | null;
}

// -- the decision (snapshot.trading), as the Overview reads it ---------------------------------------------------------------------------------------------
export interface Decision {
  action: string; // BUY CE | BUY PE | WAIT | NO TRADE
  headline: string;
  reasons: string[];
  against: string[];
  setup_id: string | null;
  strategy: string | null;
  strategy_name: string | null;
  also: string[];
}
export interface Explain {
  setup: string | null;
  side: string | null;
  stage: string | null;
  actionable: boolean;
  summary: string;
  happened: string[];
  now: string[];
  next: string[];
  invalidation: string | null;
  blocking: string[];
  supports: string[];
  disagrees: string[];
  neutral: string[];
  note: string;
}
export interface Session {
  phase: string;
  entries_allowed: boolean;
  opening_range: { high: number; low: number; complete: boolean } | null;
}
export interface RegimeCheck {
  name: string;
  text: string;
  ok: boolean | null; // true holds, false does not, null could not be judged
  info?: boolean;
  group?: string;
}
export interface RegimeFact {
  state: string;
  summary: string;
  checks: RegimeCheck[];
}
export interface RegimeFacts {
  available: boolean;
  why: string | null;
  as_of: number;
  facts: Record<string, RegimeFact>;
}
export interface AtrNote {
  used: number | null;
  with_gap: number | null;
}
export interface Market {
  direction: string; // bullish | bearish | sideways ...
  regime: string;
  text: string;
  volatility: string;
  gap: { points: number; percent: number } | null;
  atr: { "5m": AtrNote; "15m": AtrNote } | null;
  regime_facts: RegimeFacts | null;
  change?: MarketChange | null;
}
export interface PlanTarget {
  n: number;
  price: number;
  label: string;
  distance: number;
  reward_risk: number | null;
}
export interface Plan {
  entry_reference: number;
  risk_points: number;
  targets: PlanTarget[];
  note: string;
}
export interface QualityNote {
  name: string;
  text: string;
  ok: boolean;
}
export interface Structure {
  [key: string]: number | null;
}
export interface CounterTrendRecord {
  needed: boolean;
  granted: boolean;
  reason: string;
  structure: Structure | null;
}
export interface Setup {
  candle_confirmed?: boolean;
  id: string;
  strategy: string;
  strategy_name: string;
  direction: string; // CE | PE
  status: string;
  stage: string;
  stage_text: string;
  detected_at: number;
  status_since: number;
  confirmed_at: number | null;
  level: number | null;
  level_label: string;
  trigger: number | null;
  zone: number[] | null;
  invalidation: number | null;
  resumed: boolean;
  confirm_text: string;
  note: string;
  reasons: string[];
  against: string[];
  blockers: string[];
  quality: QualityNote[];
  support: number[];
  resistance: number[];
  price_state: string | null;
  plan?: Plan | Record<string, never>;
  counter_trend?: CounterTrendRecord;
}
export interface StrategySide {
  side: string;
  scanned?: boolean;
  applicable: boolean;
  state: string;
  note: string;
  setup_id?: string | null;
}
export interface StrategyMonitor {
  id: string;
  name: string;
  active: boolean;
  why?: string;
  setups: string[];
  sides: StrategySide[];
}
export interface SetupEvent {
  seq: number;
  id: string; // the setup the event is about
  time: number;
  direction: string;
  strategy_name: string;
  status: string;
  text: string;
}
export interface CounterTrend {
  needed: boolean;
  granted: boolean;
  reason: string;
  side: string;
  strategy?: string;
  strategy_name?: string;
  setup_id?: string | null;
  checks?: RegimeCheck[];
  structure?: Structure | null;
}
export interface Trading {
  available: boolean;
  decision: Decision;
  explain?: Explain | null;
  market: Market | null;
  session: Session | null;
  counter_trend: CounterTrend[];
  strategies: StrategyMonitor[];
  setups: Setup[];
  recent: Setup[];
  events: SetupEvent[];
  data: { ok: boolean; issues?: string[]; price_age?: number | null } | null;
}

// -- the market analysis (snapshot.analysis) ----------------------------------------------------------------------------------------------------------------
export interface TfAnalysis {
  trend: string;
  adx: number | null;
  rsi14: number | null;
  warm: boolean;
  ema20?: number | null;
  ema50?: number | null;
  plus_di?: number | null;
  minus_di?: number | null;
  atr14?: number | null;
  breakout?: string | null;
  consolidation?: { high: number; low: number; bars?: number } | null;
  structure?: { pattern: string; recent_swings?: { start: number; kind: string; price: number }[] } | null;
  last_completed?: Candle | null;
  missing?: { latest_session_missing: number; missing: number };
}
export interface Analysis {
  available: boolean;
  warnings?: string[];
  reliable?: boolean;
  timeframes?: Record<string, TfAnalysis>;
  condition?: { trend: string; volatility: string; alignment: { label: string; text: string }; reasons: string[] };
  levels?: { support: { price: number; touches: number }[]; resistance: { price: number; touches: number }[] };
  reference?: {
    session_date: string | null;
    session_open: number | null;
    vwap: number | null;
    vwap_note: string | null;
    session_avg_price: number | null;
    previous_day: { date: string; pdh: number; pdl: number; pdc: number; stale?: boolean } | null;
  };
  forming?: Record<string, Candle | null>;
  history?: {
    state?: string;
    error?: string | null;
    stale?: boolean;
    loaded_at?: number | null;
    as_of_date?: string | null;
    coverage?: Record<string, { bars: number; first: number; last: number }>;
  };
}

// -- the option contracts (snapshot.options): the Overview reads how many are fresh and whether one is offered; the Options tab reads everything -------------------------------
export interface OptionFlag {
  severity: string; // warn | avoid
  code: string;
  text: string;
}
export interface OptionContract {
  token: string;
  symbol: string;
  kind: string; // CE | PE
  strike: number;
  expiry: string;
  days_to_expiry: number;
  expiry_day: boolean;
  lot_size: number | null;
  steps_from_atm: number | null;
  moneyness: string | null;
  distance_points: number | null;
  ltp: number | null;
  bid: number | null;
  ask: number | null;
  bid_qty: number | null;
  ask_qty: number | null;
  spread: number | null;
  spread_pct: number | null;
  volume: number | null;
  oi: number | null;
  prev_close: number | null;
  change: number | null;
  receipt_age: number | null;
  exchange_age: number | null;
  exchange_status: string; // fresh | stale | unknown
  exchange_reason: string | null;
  last_trade_age: number | null;
  freshness: string; // fresh | stale | unknown | no data | market closed
  flags: OptionFlag[];
  blocking: boolean;
  warnings: number;
}
export interface OptionExpiry {
  expiry: string;
  days_to_expiry: number;
  expiry_day: boolean;
  decay_warning: boolean;
}
export interface OptionsDecision {
  action: string | null;
  headline?: string | null;
  strategy?: string | null;
  strategy_name?: string | null;
  setup_id?: string | null;
  also?: string[];
}
export interface OptionsSelection {
  actionable: boolean;
  kind: string | null;
  contract: OptionContract | null;
  alternatives: OptionContract[];
  why: string[];
  notice: string;
}
export interface OptionsWindow {
  primary: string;
  center: number;
  contracts: number;
  events: { time: number; reason: string }[];
}
export interface OptionsSettings {
  warn_spread_pct: number;
  max_spread_pct: number;
  min_volume: number;
  quote_stale_seconds: number;
  exchange_stale_seconds: number;
}
export interface Options {
  available: boolean;
  reason?: string; // why there is no analysis
  spot?: number | null;
  spot_age?: number | null;
  spot_fresh?: boolean;
  live?: boolean;
  contracts?: OptionContract[];
  expiries?: OptionExpiry[];
  decision?: OptionsDecision;
  selection?: OptionsSelection;
  window?: OptionsWindow | null;
  settings?: OptionsSettings;
}

export interface Snapshot {
  server_time: number; // epoch seconds, the server's clock
  connection: Connection;
  health: Health;
  instruments: InstrumentRow[];
  trading: Trading | null;
  contracts_selected_on?: string | null;
  analysis?: Analysis;
  options?: Options;
  gaps?: { start: number; end?: number | null; ended_by?: string | null; reason: string }[];
  errors?: { time: number; message: string }[];
}

/** A message from the server is a snapshot only if it has the three things every part of the page stands on; anything else is noise and does not make the page live. */
export function isSnapshot(x: unknown): x is Snapshot {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  const obj = (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v);
  return typeof o.server_time === "number" && Number.isFinite(o.server_time) && obj(o.connection) && obj(o.health) && Array.isArray(o.instruments);
}

// -- today's decision journal (GET /api/journal) ------------------------------------------------------------------------------------------------------------
export interface JournalRow {
  time: number;
  reason: string | null; // changed | start | restart ...
  price: number | null;
  action: string | null;
  headline: string | null;
  strategy_name: string | null;
  reasons: string[];
  against: string[];
  direction: string | null;
  regime: string | null;
  options: string | null; // the option contract chosen for a BUY
  counter_trend: { strategy_name: string | null; side: string; needed: boolean; granted: boolean; reason: string }[];
  regime_active: string[];
}
export interface JournalAnswer {
  available: boolean;
  reason?: string; // why there is no journal
  file: string | null;
  records: number;
  decisions: JournalRow[]; // newest first
  events: SetupEvent[]; // newest first
  bad_lines?: number;
  unreadable_records?: number;
}

// -- the trades you logged (GET and POST /api/trades) and the size calculator (GET /api/risk) -----------------------------------------------------------------
export interface TradeLimits {
  capital: number | null;
  per_trade_pct: number | null;
  per_trade_loss: number | null;
  max_daily_loss: number | null;
}
export interface TradePrism {
  action: string | null;
  setup_id: string | null;
  strategy?: string | null;
  price: number | null;
}
export interface TradeRow {
  v: number; // the record's version
  kind: string; // trade
  id: string;
  t: number;
  time?: string;
  instrument: string;
  side: string; // BUY | SELL
  qty: number;
  price: number;
  setup_id: string | null;
  note: string | null;
  prism: TradePrism | null; // what Prism's decision said when a BUY was logged
  matched: number; // of a BUY: how much of it has been sold
  pnl: number | null; // of a SELL: what it closed
  lot_pnl: number | null; // of a BUY: what the sold part of it made
  followed: string | null; // of a BUY: did the buy follow Prism's decision (yes / yes: the setup you named / no)
}
export interface OpenPosition {
  instrument: string;
  qty: number;
  average_price: number;
}
export interface TradesAvailable {
  available: true;
  file: string;
  trades: TradeRow[];
  voided?: string[];
  open: OpenPosition[];
  realised: number;
  lost_today: number;
  limits: TradeLimits | null;
  daily_loss_used_pct: number | null;
  daily_loss_reached: boolean;
  basis: string;
}
export interface TradesUnavailable {
  available: false;
  reason?: string;
  file?: string;
  trades: TradeRow[];
  open?: OpenPosition[];
}
export type TradesSummary = TradesAvailable | TradesUnavailable;

/** The trade to log: what is typed in the form, as text (the server checks it and says why when it is not a trade). */
export interface TradeInput {
  instrument: string;
  side: string;
  qty: string;
  price: string;
  setup_id: string;
  note: string;
}

export interface RiskAnswer {
  entry: number;
  stop: number;
  lot_size: number;
  loss_per_unit: number;
  loss_per_lot: number;
  outlay_per_lot: number;
  per_trade_loss: number | null;
  max_daily_loss: number | null;
  lost_today: number;
  left_today: number | null;
  lots_by_trade_limit: number | null;
  lots_by_daily_limit: number | null;
  lots: number | null;
  quantity: number | null;
  loss_at_stop: number | null;
  outlay: number | null;
  outlay_pct_of_capital: number | null;
  binding: string | null; // lots_by_trade_limit | lots_by_daily_limit
  warnings: string[];
}
