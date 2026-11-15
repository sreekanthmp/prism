import type { JournalRow, SetupEvent, Trading } from "./types";

// What the Journal tab says, as plain data. The wording and the rules are the current dashboard's (app/static/index.html), carried over word for word: the React tab is proven to say the same thing in every
// pinned state (tests/test_journal_browser.py). It only lays out what the journal recorded: the decisions and the setup events are the backend's.

/** The sections open when the page opens, besides the Analysis tab's: the history of decisions and the lifecycle of the setups. */
export const JOURNAL_OPEN: readonly string[] = ["j-decisions", "j-lifecycle"];
export const SHOWN_DECISIONS = 150; // the latest this many are drawn, and the rest are counted

/** A decision's colour: BUY CE green, BUY PE red, WAIT amber, anything else grey. */
export const actionClass = (action: string | null | undefined): string => (action === "BUY CE" ? "up" : action === "BUY PE" ? "down" : action === "WAIT" ? "flat" : "neu");

/** What the journal is re-read for: when the decision's headline changes, or a setup event is added. (Not on a timer.) */
export function journalKey(t: Trading | null | undefined): string {
  try {
    return t ? t.decision.headline + "|" + t.events.length + "|" + (t.events[0] ? t.events[0].seq : "") : "";
  } catch {
    return ""; // a snapshot this page cannot read is for the tab's own guard to say; it is not a reason to lose the page
  }
}

export interface Lifecycle {
  id: string;
  list: SetupEvent[]; // oldest first
  last: SetupEvent;
}
/** One line for each setup, newest first: every status it went through, in order, and where it stands now. `events` is newest first, as the journal and the live feed give them. */
export function lifecycles(events: SetupEvent[]): Lifecycle[] {
  const byId = new Map<string, SetupEvent[]>();
  for (const e of [...events].reverse()) {
    const list = byId.get(e.id);
    if (list) list.push(e);
    else byId.set(e.id, [e]);
  }
  return [...byId.entries()].reverse().map(([id, list]) => ({ id, list, last: list[list.length - 1] as SetupEvent }));
}

export const ENDED = ["EXPIRED", "INVALIDATED", "MISSED"];
export const endedEvents = (events: SetupEvent[]): SetupEvent[] => events.filter((e) => ENDED.includes(e.status));

/** The counter-trend permissions that were needed when a decision was made. */
export const neededPermissions = (x: JournalRow) => (x.counter_trend ?? []).filter((c) => c.needed);
