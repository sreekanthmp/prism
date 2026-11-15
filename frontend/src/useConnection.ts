import { useEffect, useReducer, useRef } from "react";
import { initialState, reduce, RECONNECT_MS, SILENT_MS, type ConnectionState } from "./connection";
import { isSnapshot, type Snapshot } from "./types";

/** What else wants to know, as it happens (the alerts): every snapshot, in order, the moment it arrives; and a page that was live becoming stale, once for each loss. A listener that fails is logged and does
 *  not take the connection down with it. */
export interface ConnectionListeners {
  onSnapshot?: (snapshot: Snapshot) => void;
  onLost?: (last: Snapshot) => void;
}

/** The part of a WebSocket the dashboard uses (so a test can hand in a fake). */
export interface SocketLike {
  onopen: ((e: unknown) => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: ((e: unknown) => void) | null;
  onerror: ((e: unknown) => void) | null;
  close(): void;
}
export type SocketFactory = (url: string) => SocketLike;

export const defaultUrl = (): string => `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`;
const realSocket: SocketFactory = (url) => new WebSocket(url) as unknown as SocketLike;

/**
 * Exactly one connection for the life of the page, however often it redraws. Every snapshot makes the page live and starts the silence timer again; a closed socket or SILENT_MS of silence makes
 * it stale; a closed socket is opened again after RECONNECT_MS. A message that is not a snapshot is noise: it does not make the page live and does not reset the silence timer.
 * Leaving the page closes the socket and clears every timer, and nothing reconnects afterwards.
 */
export function useConnection(url: string = defaultUrl(), createSocket: SocketFactory = realSocket, listeners?: ConnectionListeners): ConnectionState {
  const [state, dispatch] = useReducer(reduce, initialState);
  const told = useRef(listeners);
  told.current = listeners;

  useEffect(() => {
    let socket: SocketLike | null = null;
    let silence: ReturnType<typeof setTimeout> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let gone = false;
    let last: Snapshot | null = null; // the last snapshot, and whether the page already knows it is stale: what the reducer also keeps, so a loss is told once
    let stale = false;
    const tell = (what: () => void) => {
      try {
        what();
      } catch (e) {
        console.error("alerts", e);
      }
    };
    const lose = () => {
      dispatch({ type: "lost" });
      if (last && !stale) {
        stale = true;
        const l = last;
        tell(() => told.current?.onLost?.(l));
      }
    };

    const connect = () => {
      if (gone || socket) return;
      dispatch({ type: "attempt" });
      let s: SocketLike;
      try {
        s = createSocket(url);
      } catch {
        retry = setTimeout(connect, RECONNECT_MS); // the browser refused to open it: try again, as for a closed one
        return;
      }
      socket = s;
      s.onmessage = (e) => {
        if (gone || socket !== s) return;
        let data: unknown;
        try {
          data = JSON.parse(String(e.data));
        } catch {
          return; // not JSON: noise
        }
        if (!isSnapshot(data)) return; // not a snapshot: noise
        clearTimeout(silence);
        silence = setTimeout(lose, SILENT_MS);
        last = data;
        stale = false;
        tell(() => told.current?.onSnapshot?.(data)); // (the one before it is still what the listener holds)
        dispatch({ type: "snapshot", snapshot: data });
      };
      s.onclose = () => {
        if (socket !== s) return;
        socket = null;
        clearTimeout(silence);
        if (gone) return;
        lose();
        retry = setTimeout(connect, RECONNECT_MS);
      };
      s.onerror = () => undefined; // a failed connection is followed by a close, which is where it is handled
    };

    connect();
    return () => {
      gone = true;
      clearTimeout(silence);
      clearTimeout(retry);
      const s = socket;
      socket = null;
      if (s) {
        s.onmessage = s.onclose = s.onerror = s.onopen = null;
        s.close();
      }
    };
  }, [url, createSocket]);

  return state;
}
