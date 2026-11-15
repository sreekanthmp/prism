import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { askPopupPermission, beep, popup, readMode, saveMode, unlockSound } from "./alertEffects";
import { alertChanges, emptyMemo, linkLost, nextMode, noAlerts, raised, reaction, titleFor, type AlertEvent, type AlertMode, type AlertState } from "./alertEvents";
import type { ConnectionListeners } from "./useConnection";

export interface Alerts {
  state: AlertState; // the log (newest first) and the count not yet seen
  mode: AlertMode;
  cycleMode: () => void; // sound + popup -> sound -> off -> ...
  clear: () => void; // empties the log and the count
  raise: (list: AlertEvent[], t: number | null) => void; // for an alert that does not come from a snapshot (the daily loss limit)
  listeners: ConnectionListeners; // what the connection tells: every snapshot, and a link that was live and is lost
}

/**
 * Being told when something needs you. Every snapshot is compared with the one before it as it arrives (the connection tells this hook, so none is skipped however busy the page is); what is worth
 * saying goes in the log, makes ONE sound however many things changed, and a popup for each when popups are chosen; the count of those not yet seen is in the page's title until the reader is
 * back (focus, or any click). The mode (sound + popup / sound / off) is the reader's and is remembered.
 */
export function useAlerts(): Alerts {
  const [state, setState] = useState<AlertState>(noAlerts);
  const [mode, setMode] = useState<AlertMode>(readMode);
  const modeRef = useRef(mode);
  const prev = useRef<Parameters<typeof alertChanges>[0]>(null);
  const memo = useRef(emptyMemo());

  const raise = useCallback((list: AlertEvent[], t: number | null) => {
    setState((s) => raised(s, list, t));
    const r = reaction(modeRef.current, list);
    if (r.sound) beep(r.sound);
    for (const c of r.popups) popup(c);
  }, []);

  const listeners = useMemo<ConnectionListeners>(
    () => ({
      onSnapshot: (snap) => {
        const r = alertChanges(prev.current, snap, memo.current); // `prev` is still the snapshot before this one
        memo.current = r.memo;
        prev.current = snap;
        raise(r.events, snap.server_time);
      },
      onLost: (last) => raise([linkLost(last.server_time)], last.server_time),
    }),
    [raise],
  );

  const markSeen = useCallback(() => setState((s) => (s.unseen ? { ...s, unseen: 0 } : s)), []);
  const clear = useCallback(() => setState(noAlerts), []);
  const cycleMode = useCallback(() => {
    const next = nextMode(modeRef.current);
    modeRef.current = next;
    setMode(next);
    saveMode(next);
    if (next === "sound + popup") askPopupPermission();
    if (next !== "off") beep("info"); // so you hear that it works
  }, []);

  useEffect(() => {
    document.title = titleFor(state.unseen);
  }, [state.unseen]);

  useEffect(() => {
    const here = () => markSeen();
    const click = () => {
      unlockSound(); // the first click on the page is what lets the browser play a sound
      markSeen();
    };
    const visible = () => {
      if (!document.hidden) markSeen();
    };
    window.addEventListener("focus", here);
    document.addEventListener("visibilitychange", visible);
    document.addEventListener("click", click);
    return () => {
      window.removeEventListener("focus", here);
      document.removeEventListener("visibilitychange", visible);
      document.removeEventListener("click", click);
    };
  }, [markSeen]);

  return { state, mode, cycleMode, clear, raise, listeners };
}
