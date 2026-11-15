import type { AlertEvent } from "./alertEvents";
import type { Answer } from "./tradesApi";
import type { RiskAnswer, TradeInput, TradesAvailable, TradesSummary } from "./types";

// The rules of the Trades tab: what is typed becomes the request, what Prism answers becomes what is said. A notebook and a calculator: neither places an order nor reads an account.

/** Rupees, rounded, in the Indian grouping. Unknown is a dash, never a zero. */
export const rs = (v: number | null | undefined): string => (v == null ? "–" : "Rs " + Math.round(v).toLocaleString("en-IN"));

/** What a refusal says: the server's own sentence when it sent one, otherwise the whole of what it sent. */
export function detailText(body: unknown): string {
  const b = body as { detail?: unknown } | null | undefined;
  return b && typeof b.detail === "string" ? b.detail : JSON.stringify((b && b.detail) || b || "no answer");
}

export const NO_TRADE_LOG = "this Prism server has no trade log yet (restart Prism to load the current version)";
export const NO_CALCULATOR = "this Prism server has no calculator yet (restart Prism to load the current version)";

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** A summary of the trades, if that is what the body is (an older server answers {"detail": "Not Found"}). */
export const isSummary = (x: unknown): x is TradesSummary => isObject(x) && typeof x.available === "boolean";

/** What is on the tab for an answer: the summary, or (for a server that has no trade log, or one that refused) a notice that says why, never an empty notebook. */
export function summaryOf(a: Answer): TradesSummary {
  if (a.ok && isSummary(a.body)) return a.body;
  return { available: false, reason: a.status === 404 ? NO_TRADE_LOG : detailText(a.body), trades: [], open: [] };
}

export const blankTrade: TradeInput = { instrument: "", side: "BUY", qty: "", price: "", setup_id: "", note: "" };

/** What logging sends: each field as typed (trimmed), the side BUY when none is chosen. The server checks it and says why when it is not a trade. */
export function tradePayload(f: TradeInput): TradeInput {
  return { instrument: f.instrument.trim(), side: f.side.trim() || "BUY", qty: f.qty.trim(), price: f.price.trim(), setup_id: f.setup_id.trim(), note: f.note.trim() };
}

/** After a trade is logged the quantity, the price, the note and the setup (which belongs to that one trade: the next, a sell for one, is not tagged with it) are cleared; the instrument and the side stay. */
export const afterLogging = (f: TradeInput): TradeInput => ({ ...f, qty: "", price: "", note: "", setup_id: "" });

export interface RiskForm {
  entry: string;
  stop: string;
  lot: string;
  capital: string;
  risk_pct: string;
  max_loss: string;
}
export const blankRisk: RiskForm = { entry: "", stop: "", lot: "", capital: "", risk_pct: "", max_loss: "" };

/** Only what was filled in is asked: the server's own limits apply to the rest. */
export function riskQuery(f: RiskForm): string {
  const q = new URLSearchParams();
  for (const k of ["entry", "stop", "lot", "capital", "risk_pct", "max_loss"] as const) {
    const v = f[k].trim();
    if (v !== "") q.set(k, v);
  }
  return q.toString();
}

/** What the calculator shows for an answer: the lots, or the words that say why not. */
export type RiskOut = { answer: RiskAnswer } | { error: string };

const isRisk = (x: unknown): x is RiskAnswer => isObject(x) && typeof x.lot_size === "number" && typeof x.loss_per_lot === "number" && typeof x.outlay_per_lot === "number" && Array.isArray(x.warnings);

export function riskOf(a: Answer): RiskOut {
  if (a.ok) return isRisk(a.body) ? { answer: a.body } : { error: "Prism's answer is not what this page expects" };
  if (a.status === 404) return { error: NO_CALCULATOR };
  const detail = (a.body as { detail?: unknown } | null)?.detail;
  if (a.status === 422 && Array.isArray(detail)) return { error: "fill in the entry premium, the stop premium and the lot size (numbers)" };
  return { error: detailText(a.body) };
}

/** The alert for a daily loss limit that has been reached: said once, again only after it has been left and reached again. */
export function lossLimitAlert(d: TradesAvailable): AlertEvent {
  return {
    level: "warn",
    key: "daily-loss",
    title: "Your daily loss limit is reached",
    text: `${rs(d.lost_today)} lost of ${rs(d.limits?.max_daily_loss)}: your own limit says stop for the day.`,
  };
}
