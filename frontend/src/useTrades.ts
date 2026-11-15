import { useCallback, useEffect, useRef, useState } from "react";
import type { AlertEvent } from "./alertEvents";
import { tradesApi, type TradesApi } from "./tradesApi";
import { NO_TRADE_LOG, afterLogging, blankTrade, detailText, isSummary, lossLimitAlert, summaryOf, tradePayload } from "./tradesModel";
import type { TradeInput, TradesSummary } from "./types";

export interface TradesMessage {
  text: string;
  bad: boolean;
}
export interface TradesState {
  data: TradesSummary | null; // the last answer: it stays while a later ask fails
  error: string | null; // why the first ask did not get an answer (a network failure)
  message: TradesMessage | null; // the line under the form: logging…, logged, not logged: <why>
  form: TradeInput;
  setField: (field: keyof TradeInput, value: string) => void;
  retry: () => void;
  log: () => Promise<void>;
  voidTrade: (id: string) => Promise<void>;
}

export const VOID_QUESTION = "Void this trade? The file keeps it and adds a line that cancels it; this cannot be undone.";

/**
 * The trades you logged. They are asked for ONCE, as the page starts (so a loss limit already reached is on the page whichever tab is open); after that only what you log or void changes them, and
 * a server that cannot answer is not asked again in a loop: only Retry asks again. What is typed in the form is the page's, so leaving the tab and coming back finds it as it was.
 * `raise` tells the alerts (the daily loss limit), `now` is the server time of the last snapshot (null before the first).
 */
export function useTrades(api: TradesApi = tradesApi, raise: (list: AlertEvent[], t: number | null) => void = () => undefined, now: () => number | null = () => null): TradesState {
  const [data, setData] = useState<TradesSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<TradesMessage | null>(null);
  const [form, setForm] = useState<TradeInput>(blankTrade);
  const loading = useRef(false);
  const writing = useRef(false);
  const said = useRef(false); // the loss limit has been said and has not been left since
  const apiRef = useRef(api);
  apiRef.current = api;
  const raiseRef = useRef(raise);
  raiseRef.current = raise;
  const nowRef = useRef(now);
  nowRef.current = now;
  const formRef = useRef(form);
  formRef.current = form;

  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      setData(summaryOf(await apiRef.current.summary())); // a server started before this existed answers 404: that is said, not shown as an empty notebook
    } catch (e) {
      setError(String(e));
    }
    loading.current = false;
  }, []);

  // Once, as the page starts. (Under React's strict mode the page is started twice in development: the second ask finds the first still out and does not go. Nothing is aborted when the page is left: the
  // answer of a page that is gone is ignored by React, and an abort here would have the first of those two asks end in an error.)
  useEffect(() => {
    void load();
  }, [load]);

  // After a write: the loss limit is said once when it has been reached, and again only after it has been left and reached again. (Not after the first ask: it is on the page as an alert line.)
  const noteLimit = useCallback((d: TradesSummary) => {
    const t = nowRef.current();
    if (d.available && d.daily_loss_reached && !said.current && t != null) {
      said.current = true;
      raiseRef.current([lossLimitAlert(d)], t);
    }
    if (d.available && !d.daily_loss_reached) said.current = false;
  }, []);

  // The server's answer to a write carries the new summary. One that does not (it was written all the same) is read again, and said.
  const applied = useCallback(
    (summary: unknown, done: string): boolean => {
      if (!isSummary(summary)) {
        setMessage({ text: `${done}, but Prism's answer was not what this page expects: the trades were read again`, bad: true });
        void load();
        return false;
      }
      setData(summary);
      setError(null);
      setMessage({ text: done, bad: false });
      noteLimit(summary);
      return true;
    },
    [load, noteLimit],
  );

  const log = useCallback(async () => {
    if (writing.current) return; // a second click while the first is out would log the trade twice
    writing.current = true;
    setMessage({ text: "logging…", bad: false });
    try {
      const r = await apiRef.current.log(tradePayload(formRef.current));
      if (!r.ok) {
        setMessage({ text: r.status === 404 ? NO_TRADE_LOG : "not logged: " + detailText(r.body), bad: true });
        return;
      }
      if (applied((r.body as { summary?: unknown } | null)?.summary, "logged")) setForm(afterLogging);
    } catch (e) {
      setMessage({ text: "not logged: " + String(e), bad: true });
    } finally {
      writing.current = false;
    }
  }, [applied]);

  const voidTrade = useCallback(
    async (id: string) => {
      if (typeof confirm === "function" && !confirm(VOID_QUESTION)) return;
      if (writing.current) return;
      writing.current = true;
      try {
        const r = await apiRef.current.voidTrade(id);
        if (!r.ok) {
          setMessage({ text: "not voided: " + detailText(r.body), bad: true });
          return;
        }
        applied((r.body as { summary?: unknown } | null)?.summary, "voided");
      } catch (e) {
        setMessage({ text: "not voided: " + String(e), bad: true });
      } finally {
        writing.current = false;
      }
    },
    [applied],
  );

  const retry = useCallback(() => {
    setError(null);
    void load();
  }, [load]);

  const setField = useCallback((field: keyof TradeInput, value: string) => setForm((f) => ({ ...f, [field]: value })), []);

  return { data, error, message, form, setField, retry, log, voidTrade };
}
