import { age } from "./format";
import type { OptionContract, OptionFlag, Options, Trading } from "./types";

// What the Options tab says, as plain data. The rules and the words are the current dashboard's (app/static/index.html), carried over word for word: the React tab is proven to say the same thing in every
// pinned state (tests/test_options_browser.py). Nothing here selects a contract or judges a quote: the selection, the findings and the ordering are the backend's.

export const AGE = age;
/** A quantity in units, in the Indian grouping the exchange uses (20,00,000). */
export const num0 = (v: number | null | undefined): string => (v == null ? "–" : Number(v).toLocaleString("en-IN"));
export const FRESH_CLS: Record<string, string> = { fresh: "up", stale: "down", unknown: "flat", "no data": "down", "market closed": "mut" };

export interface Offer {
  final: string | null; // the FINAL decision (the trading payload's)
  side: "CE" | "PE" | null;
  agree: boolean; // the options payload carries the same decision
  ok: boolean;
  contract: OptionContract | null;
  conflict: boolean; // the options data offers a contract that the decision does not call for
}
/**
 * A contract is on offer ONLY when the final decision (the trading payload's) is BUY CE / BUY PE, the options payload carries the same decision, and its selection is a contract of that side.
 * Anything else is "No contract selected": a contract is never shown as selected because the options data says so alone.
 */
export function contractOffer(t: Trading | null | undefined, o: Options): Offer {
  const d = o.decision ?? { action: null };
  const s = o.selection;
  const final = t && t.decision ? t.decision.action : null;
  const side = /^BUY (CE|PE)$/.test(final ?? "") ? ((final as string).slice(-2) as "CE" | "PE") : null;
  const agree = !!t && d.action === final;
  const ok = !!(side && agree && s?.actionable && s.contract && s.kind === side && s.contract.kind === side);
  return { final, side, agree, ok, contract: ok ? (s?.contract ?? null) : null, conflict: !ok && !!s?.actionable };
}

/** How old a quote is on its two clocks: when Prism received it, and the exchange's own time for it. */
export const quoteAges = (c: OptionContract): string => `${AGE(c.receipt_age)} / ${c.exchange_status === "unknown" ? "unknown" : AGE(c.exchange_age)}`;

export const flagIcon = (f: OptionFlag): string => (f.severity === "avoid" ? "⛔" : "⚠");

/** The contracts of one side that were ruled out (every Avoid finding), nearest the money first and then by expiry: the backend's own order. */
export function ruledOut(o: Options, side: string): { mine: OptionContract[]; bad: OptionContract[] } {
  const mine = (o.contracts ?? []).filter((c) => c.kind === side);
  const bad = mine.filter((c) => c.blocking).sort((a, b) => (a.steps_from_atm ?? 99) - (b.steps_from_atm ?? 99) || String(a.expiry).localeCompare(String(b.expiry)));
  return { mine, bad };
}
