import type { Snapshot } from "./types";

// The page is in one of three states, and every redraw knows which. This is the contract of the current dashboard, kept exactly:
//   loading  no snapshot has arrived yet
//   live     the last snapshot is recent (the server pushes at least one a second)
//   stale    a snapshot was shown, and the link is lost or has gone silent: what is on screen is the LAST snapshot, kept for inspection, and never a current decision. A snapshot that arrives
//            makes the page live again, drawn from that snapshot alone: nothing stale is carried over.

export type Conn = "loading" | "live" | "stale";

/** Silence for this long makes a page that was live stale. One timer, started again by every snapshot: this is not polling. */
export const SILENT_MS = 5000;
/** Seconds between attempts to connect again, in milliseconds. */
export const RECONNECT_MS = 2000;

export interface ConnectionState {
  conn: Conn;
  snapshot: Snapshot | null; // the last snapshot that arrived (shown dimmed while stale)
  tries: number; // connection attempts made while there is still no snapshot to show: "cannot be reached (attempt N)"
}

export const initialState: ConnectionState = { conn: "loading", snapshot: null, tries: 0 };

export type Action = { type: "attempt" } | { type: "snapshot"; snapshot: Snapshot } | { type: "lost" };

export function reduce(state: ConnectionState, action: Action): ConnectionState {
  switch (action.type) {
    case "attempt":
      return state.snapshot ? state : { ...state, tries: state.tries + 1 }; // only counted while the page has nothing to show
    case "snapshot":
      return { conn: "live", snapshot: action.snapshot, tries: 0 };
    case "lost": // the socket closed or went silent
      if (!state.snapshot) return { ...state, conn: "loading" };
      return state.conn === "stale" ? state : { ...state, conn: "stale" };
  }
}
