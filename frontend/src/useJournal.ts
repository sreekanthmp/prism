import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJournal, type JournalFetcher } from "./journalApi";
import { journalKey } from "./journalModel";
import type { JournalAnswer, Snapshot } from "./types";

export interface JournalState {
  data: JournalAnswer | null; // the last answer: it stays while a later ask fails
  error: string | null;
}

/**
 * Today's decision journal. It is read when the Journal tab is first opened, and read again only when the decision's headline changes or a setup event is added (the page does not poll), and when the
 * reader asks (`refresh`). One read at a time: a change that comes while a read is out is read as soon as that one is done, so it is not lost. A failed read keeps the last answer and says so. The
 * state is the page's, so leaving the tab and coming back finds the journal as it was.
 */
export function useJournal(snapshot: Snapshot | null, active: boolean, fetcher: JournalFetcher = fetchJournal): { state: JournalState; refresh: () => void } {
  const [state, setState] = useState<JournalState>({ data: null, error: null });
  const loading = useRef(false);
  const again = useRef(false);
  const lastKey = useRef<string | null>(null);
  const gone = useRef(false);
  const ctrl = useRef<AbortController | null>(null);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;

  const load = useCallback(async () => {
    if (loading.current) {
      again.current = true;
      return;
    }
    loading.current = true;
    ctrl.current = new AbortController();
    try {
      const data = await fetchRef.current(ctrl.current.signal);
      setState({ data, error: null });
    } catch (e) {
      setState((s) => ({ data: s.data, error: String(e) }));
    }
    loading.current = false;
    if (again.current && !gone.current) {
      again.current = false;
      void load();
    }
  }, []);

  useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
      ctrl.current?.abort();
    };
  }, []);

  const key = active && snapshot ? journalKey(snapshot.trading) : "";
  useEffect(() => {
    if (!active || !snapshot) return;
    if (key !== lastKey.current) {
      lastKey.current = key;
      void load();
    }
  }, [active, snapshot, key, load]);

  return { state, refresh: () => void load() };
}
