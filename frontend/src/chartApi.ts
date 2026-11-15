import { parseChart, type ChartData, type ChartTimeframe } from "./chartTypes";

/** What asks Prism for the chart (a test hands in its own). */
export type ChartFetcher = (timeframe: ChartTimeframe, limit: number, signal: AbortSignal) => Promise<ChartData>;

/**
 * The only request this page makes of its own, and it only READS: GET /api/chart, which answers from memory (no database, no broker, nothing evaluated, nothing journalled). An answer that is not
 * what this page expects is an error, said as one: it is never drawn.
 */
export const fetchChart: ChartFetcher = async (timeframe, limit, signal) => {
  const r = await fetch(`/api/chart?timeframe=${encodeURIComponent(timeframe)}&limit=${encodeURIComponent(String(limit))}`, { signal, cache: "no-store" });
  if (!r.ok) throw new Error(`Prism answered ${r.status}`);
  const data = parseChart(await r.json());
  if (!data) throw new Error("Prism's chart answer is not what this page expects");
  return data;
};
