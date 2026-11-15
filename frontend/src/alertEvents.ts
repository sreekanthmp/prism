import { fmtT, n2 } from "./format";
import { zone } from "./overviewModel";
import type { Setup, Snapshot } from "./types";

// Being told when something needs you, instead of having to watch. What raises an alert is decided here, from two snapshots, so it can be checked without a browser. The first snapshot is the
// baseline and raises nothing, and a page showing stale data raises nothing (a snapshot has to arrive). "Ready" is Prism's own READY_TO_ACT stage (confirmed, in the entry area, nothing blocking).
// Prism places no orders: an alert only says look now.

export type Level = "act" | "warn" | "info";
export interface AlertEvent {
  level: Level;
  key: string;
  title: string;
  text: string;
}
/** An alert as the page keeps it: when it was raised (the server's clock) beside what it said. */
export interface LoggedAlert extends AlertEvent {
  t: number | null;
}

/** What the page remembers between snapshots: when each setup was last ready, and when each warning was last raised. */
export interface AlertMemo {
  ready: Record<string, number>;
  said: Record<string, number>;
}
export const emptyMemo = (): AlertMemo => ({ ready: {}, said: {} });

// A setup's entry area flickers: in the real journal of 2026-11-11 one setup went READY_TO_ACT <-> CONFIRMED about 20 times in 7 minutes as price crossed its trigger. That is one piece of news, not
// twenty: a setup that comes back to ready within REARM seconds of having been ready is the same entry area flickering, and a setup leaving the entry area (CONFIRMED) is not an alert at all (it is on
// the page; it becomes one only if the setup then ends or is blocked).
export const REARM = 300;
/** How long an event stays on the one alert line (it stays in the log). */
export const ALERT_SHOW_S = 600;
export const LINE_MAX = 5;
export const LOG_MAX = 20;

export const sideWord = (d: string): string => (d === "CE" ? "CE setup" : d === "PE" ? "PE setup" : String(d));
const spell = (s: unknown): string => String(s).replace(/_/g, " ");

function setupsById(s: Snapshot | null | undefined): Map<string, Setup> {
  const m = new Map<string, Setup>();
  const list: unknown = s?.trading?.setups;
  if (Array.isArray(list)) for (const x of list as Setup[]) if (x && x.id != null) m.set(String(x.id), x);
  return m;
}

/**
 * What a new snapshot makes worth saying, from the one before it (null for the first: a baseline raises nothing). `memo` is what the page remembers between snapshots; the memo that goes on is
 * returned, the one passed in is not changed.
 */
export function alertChanges(prev: Snapshot | null | undefined, cur: Snapshot | null | undefined, memo: AlertMemo = emptyMemo()): { events: AlertEvent[]; memo: AlertMemo } {
  if (!cur) return { events: [], memo };
  const next: AlertMemo = { ready: { ...memo.ready }, said: { ...memo.said } };
  const stamp = cur.server_time;
  const out: AlertEvent[] = [];
  const a = setupsById(prev);
  const b = setupsById(cur);
  const due = (table: Record<string, number>, key: string): boolean => table[key] == null || stamp == null || stamp - (table[key] as number) >= REARM;
  const readyBefore = { ...next.ready }; // (when each was last ready, before this snapshot)
  for (const [id, x] of b) if (x.stage === "READY_TO_ACT") next.ready[id] = stamp; // recorded even for the first snapshot, so a flicker right after opening the page is not news either
  if (!prev) return { events: [], memo: next };

  for (const [id, x] of b) {
    if (x.stage === "READY_TO_ACT" && a.get(id)?.stage !== "READY_TO_ACT" && due(readyBefore, id))
      out.push({
        level: "act",
        key: "ready:" + id,
        title: `${sideWord(x.direction)} ready: ${x.strategy_name}`,
        text: `setup ${id}: entry area ${zone(x.zone)}, trigger ${n2(x.trigger)}, invalidation ${n2(x.invalidation)}. You decide and place any order yourself.`,
      });
  }
  for (const [id, x] of a) {
    const y = b.get(id);
    if (x.stage !== "READY_TO_ACT" || (y && (y.stage === "READY_TO_ACT" || y.stage === "CONFIRMED"))) continue;
    if (y && y.stage === "BLOCKED") {
      if (!due(next.said, "blocked:" + id)) continue; // (an ended setup cannot come back, so only a block can repeat)
      next.said["blocked:" + id] = stamp;
    }
    const first = y?.blockers?.[0];
    const why = !y ? "it has ended" : y.stage === "BLOCKED" ? `something blocks entry now${first ? ": " + first : ""}` : `it is now ${spell(y.stage).toLowerCase()}`;
    out.push({ level: "warn", key: "ended:" + id, title: `${sideWord(x.direction)} no longer ready: ${x.strategy_name}`, text: `setup ${id}: ${why}.` });
  }
  const ra = prev.health?.readiness;
  const rb = cur.health?.readiness;
  if (ra && rb && ra.ready && !rb.ready && due(next.said, "readiness")) {
    next.said.readiness = stamp;
    out.push({ level: "warn", key: "readiness", title: "Prism is NOT READY", text: `${spell(rb.state)}: ${rb.summary}. Decisions are blocked.` });
  }
  if (ra && rb && !ra.ready && rb.ready) out.push({ level: "info", key: "readiness", title: "Prism is ready again", text: String(rb.summary) });
  const fa = prev.connection?.state;
  const fb = cur.connection?.state;
  if (fa === "connected" && fb && fb !== "connected" && cur.health?.live && due(next.said, "feed")) {
    next.said.feed = stamp;
    out.push({ level: "warn", key: "feed", title: "Live feed lost", text: `the feed is ${spell(fb)}: no decision is current until it is back.` });
  }
  return { events: out, memo: next };
}

/** The alert for a link that is lost: raised once, when the page turns stale (`at`: the server time of the last snapshot it holds). */
export const linkLost = (at: number): AlertEvent => ({
  level: "warn",
  key: "link",
  title: "Lost the link to Prism",
  text: `the page is showing the snapshot made at ${fmtT(at)} IST: nothing on it is current.`,
});

/** Newest first, as many as the page keeps; the count of the ones not yet seen goes on counting whatever the log keeps. */
export interface AlertState {
  log: LoggedAlert[];
  unseen: number;
}
export const noAlerts: AlertState = { log: [], unseen: 0 };

export function raised(state: AlertState, list: AlertEvent[], t: number | null): AlertState {
  if (!list.length) return state;
  const added = list.map((c): LoggedAlert => ({ t, ...c })).reverse(); // (each one went in at the front: the last of the list is the newest)
  return { log: [...added, ...state.log].slice(0, LOG_MAX), unseen: state.unseen + list.length };
}

/** The events the one alert line shows: the setups that became ready or ended in the last ten minutes (at most five). The readiness, the feed, the link and the loss limit are alert lines of their own
 *  while they last, so they are not repeated here; every event stays in the log (the sound, the popup and the title count come from it). */
export function recentAlerts(log: LoggedAlert[], now: number | null | undefined): LoggedAlert[] {
  return log.filter((x) => /^(ready|ended):/.test(x.key || "") && now != null && x.t != null && now - x.t <= ALERT_SHOW_S).slice(0, LINE_MAX);
}

// -- the three modes, and what each does -------------------------------------------------------------------------------------------------------------
export const ALERT_MODES = ["sound + popup", "sound", "off"] as const;
export type AlertMode = (typeof ALERT_MODES)[number];
export const DEFAULT_MODE: AlertMode = "sound";
export const MODE_KEY = "prism-alert-mode";
export const MODE_TITLE = "Alerts: a sound (and a popup) when a setup becomes ready or stops being ready, or when Prism is not ready or the feed is lost. Click to change.";

export const parseMode = (saved: unknown): AlertMode => (ALERT_MODES as readonly unknown[]).includes(saved) ? (saved as AlertMode) : DEFAULT_MODE;
export const nextMode = (m: AlertMode): AlertMode => ALERT_MODES[(ALERT_MODES.indexOf(m) + 1) % ALERT_MODES.length] as AlertMode;

/** The tones of a sound: [Hz, seconds after the start]. */
export const TONES: Record<Level, [number, number][]> = {
  act: [[880, 0], [1175, 0.2], [880, 0.4], [1175, 0.6]],
  warn: [[520, 0], [390, 0.22]],
  info: [[660, 0]],
};

/** What a set of alerts raised at once does, in a mode: ONE sound however many things changed (none for news that is only noted), and a popup for each that is not only noted. */
export function reaction(mode: AlertMode, list: AlertEvent[]): { sound: Level | null; popups: AlertEvent[] } {
  if (mode === "off" || !list.length) return { sound: null, popups: [] }; // the log and the title still say it; only the sound and the popup are off
  const top: Level = list.some((c) => c.level === "act") ? "act" : list.some((c) => c.level === "warn") ? "warn" : "info";
  return { sound: top !== "info" ? top : null, popups: mode === "sound + popup" ? list.filter((c) => c.level !== "info") : [] };
}

export const BASE_TITLE = "Prism";
export const titleFor = (unseen: number): string => (unseen ? `(${unseen}) ` : "") + BASE_TITLE;
