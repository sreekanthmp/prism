import { useEffect, useReducer } from "react";
import { fetchChart, type ChartFetcher } from "./chartApi";
import type { ChartData, ChartTimeframe } from "./chartTypes";

export const CHART_POLL_MS = 3000; // a new candle and the forming one: a read of memory on this computer, cheap
export const CHART_RETRY_MS = 5000; // after an answer that failed

export interface ChartState {
  status: "loading" | "ready" | "error";
  data: ChartData | null; // the last good answer: it stays while a later ask fails, and says so
  error: string | null;
}
type Action = { type: "reset" } | { type: "ok"; data: ChartData } | { type: "fail"; error: string };
const initial: ChartState = { status: "loading", data: null, error: null };

function reduce(s: ChartState, a: Action): ChartState {
  switch (a.type) {
    case "reset":
      return initial; // another timeframe: the candles of the old one are never shown under the new one's name
    case "ok":
      return { status: "ready", data: a.data, error: null };
    case "fail":
      return { status: s.data ? "ready" : "error", data: s.data, error: a.error };
  }
}

/**
 * The chart's data for one timeframe, asked again every CHART_POLL_MS. One request at a time (the next is asked only after the last has answered), a failed one is asked again after CHART_RETRY_MS
 * with the last good answer kept and the error said, a change of timeframe starts from nothing and abandons the old request, and `paused` (the link to Prism is lost) asks nothing. An answer for
 * another timeframe than the one asked is an error. Leaving the page stops everything.
 */
export function useChart(timeframe: ChartTimeframe, limit: number, paused: boolean, fetcher: ChartFetcher = fetchChart): ChartState {
  const [state, dispatch] = useReducer(reduce, initial);

  useEffect(() => {
    dispatch({ type: "reset" });
  }, [timeframe, limit, fetcher]);

  useEffect(() => {
    if (paused) return;
    let gone = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ctrl = new AbortController();
    const ask = async () => {
      try {
        const data = await fetcher(timeframe, limit, ctrl.signal);
        if (gone) return;
        if (data.timeframe !== timeframe) throw new Error(`Prism answered for ${data.timeframe}, not ${timeframe}`);
        dispatch({ type: "ok", data });
        timer = setTimeout(ask, CHART_POLL_MS);
      } catch (e) {
        if (gone) return;
        dispatch({ type: "fail", error: e instanceof Error ? e.message : String(e) });
        timer = setTimeout(ask, CHART_RETRY_MS);
      }
    };
    void ask();
    return () => {
      gone = true;
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [timeframe, limit, paused, fetcher]);

  return state;
}
