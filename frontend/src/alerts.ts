import type { LoggedAlert } from "./alertEvents";
import { words } from "./format";
import { rs } from "./tradesModel";
import type { Health, TradesSummary } from "./types";

// The one alert line. Every alert, but ONE line on the page: the count, the most serious one and "(+N more)"; the full list opens on a click and floats over the page, so the layout never
// jumps. These are the alerts that say what is wrong right now (the state of Prism and of the data); the events (a setup became ready ...) join the same line in the stage that builds them.

export type Severity = "bad" | "warn" | "act";
export interface AlertItem {
  sev: Severity;
  head: string; // may be empty: the text then says it all
  text: string;
}

/** What is wrong right now, from the health section of a snapshot. Empty when nothing is. */
export function stateAlerts(h: Health): AlertItem[] {
  const items: AlertItem[] = [];
  const rd = h.readiness;
  if (rd && !rd.ready) items.push({ sev: rd.state === "FAILED" ? "bad" : "warn", head: `NOT READY · ${words(rd.state)}`, text: `${rd.summary}. Decisions are blocked until the data is complete and trusted.` });
  for (const w of h.issues ?? []) items.push({ sev: "bad", head: "Data not trusted", text: `${w}. No setup can be ready until this is fixed.` });
  for (const w of h.warnings ?? []) items.push({ sev: "warn", head: "", text: w });
  return items;
}

/**
 * Everything the one alert line says, in the order it says it: what is wrong with the system and the data right now, your own daily loss limit when you have reached it, and the setups that
 * became ready or ended in the last ten minutes. A page that has lost its link says nothing about the market (the stale notice is the alert, and an alert is a verdict on the present); your own
 * loss limit is a fact about your trades and stays. Before the first snapshot there is no line.
 */
export function lineItems(o: { health: Health | null; stale: boolean; trades: TradesSummary | null; events: LoggedAlert[] }): AlertItem[] {
  if (!o.health) return [];
  const items = o.stale ? [] : stateAlerts(o.health);
  const d = o.trades;
  if (d && d.available && d.daily_loss_reached)
    items.push({
      sev: "bad",
      head: "Your daily loss limit is reached",
      text: `${rs(d.lost_today)} lost of ${rs(d.limits?.max_daily_loss)}. Prism's decisions are unchanged: this limit is yours, and it says stop for the day`,
    });
  if (!o.stale) for (const x of o.events) items.push({ sev: x.level === "act" ? "act" : "warn", head: x.title, text: x.text });
  return items;
}

const RANK: Record<Severity, number> = { bad: 3, act: 2, warn: 1 };

/** The most serious severity among the items, and the first item of that severity (which the one line leads with). */
export function worstOf(items: AlertItem[]): { worst: Severity; lead: AlertItem } | null {
  const first = items[0];
  if (!first) return null;
  let lead = first;
  for (const i of items) if (RANK[i.sev] > RANK[lead.sev]) lead = i;
  return { worst: lead.sev, lead };
}

export const ICON: Record<Severity, string> = { bad: "⛔", act: "🔔", warn: "⚠" };
