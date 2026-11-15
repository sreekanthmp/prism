import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChartFetcher } from "./chartApi";
import type { ChartData, ChartTimeframe } from "./chartTypes";
import { CHART_POLL_MS, CHART_RETRY_MS, useChart } from "./useChart";
import { chartBase, chartVariant } from "./test/helpers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const flush = () => act(async () => { await Promise.resolve(); });

/** A fetcher the test answers by hand: every ask is kept, with the signal it came with. */
function manual() {
  const asks: { tf: ChartTimeframe; limit: number; signal: AbortSignal; ok: (d: ChartData) => void; fail: (e: Error) => void }[] = [];
  const fetcher: ChartFetcher = (tf, limit, signal) => new Promise((ok, fail) => { asks.push({ tf, limit, signal, ok, fail }); });
  return { asks, fetcher };
}
const answer = (tf: string) => chartVariant((c) => { c.timeframe = tf; });

describe("useChart", () => {
  it("is loading, asks once for the timeframe and limit it was given, then has the answer", async () => {
    const m = manual();
    const { result } = renderHook(() => useChart("5m", 300, false, m.fetcher));
    expect(result.current).toEqual({ status: "loading", data: null, error: null });
    expect(m.asks).toHaveLength(1);
    expect([m.asks[0]!.tf, m.asks[0]!.limit]).toEqual(["5m", 300]);
    await act(async () => m.asks[0]!.ok(chartBase));
    expect(result.current).toEqual({ status: "ready", data: chartBase, error: null });
  });

  it("asks again CHART_POLL_MS after the last answer, not before, and one at a time", async () => {
    const m = manual();
    renderHook(() => useChart("5m", 300, false, m.fetcher));
    await act(async () => m.asks[0]!.ok(chartBase));
    await tick(CHART_POLL_MS - 1);
    expect(m.asks).toHaveLength(1);
    await tick(1);
    expect(m.asks).toHaveLength(2);
    await tick(CHART_POLL_MS * 5); // the second ask has not answered: nothing is piled on top of it
    expect(m.asks).toHaveLength(2);
    await act(async () => m.asks[1]!.ok(chartBase));
    await tick(CHART_POLL_MS);
    expect(m.asks).toHaveLength(3);
  });

  it("a failed ask is said, asked again after CHART_RETRY_MS, and the error goes when it works", async () => {
    const m = manual();
    const { result } = renderHook(() => useChart("5m", 300, false, m.fetcher));
    await act(async () => m.asks[0]!.fail(new Error("Prism answered 500")));
    expect(result.current).toEqual({ status: "error", data: null, error: "Prism answered 500" });
    await tick(CHART_RETRY_MS - 1);
    expect(m.asks).toHaveLength(1);
    await tick(1);
    expect(m.asks).toHaveLength(2);
    await act(async () => m.asks[1]!.ok(chartBase));
    expect(result.current).toEqual({ status: "ready", data: chartBase, error: null });
  });

  it("keeps the last good answer when a later ask fails, and says the ask failed", async () => {
    const m = manual();
    const { result } = renderHook(() => useChart("5m", 300, false, m.fetcher));
    await act(async () => m.asks[0]!.ok(chartBase));
    await tick(CHART_POLL_MS);
    await act(async () => m.asks[1]!.fail(new Error("network down")));
    expect(result.current).toEqual({ status: "ready", data: chartBase, error: "network down" });
    await tick(CHART_RETRY_MS);
    await act(async () => m.asks[2]!.ok(chartBase));
    expect(result.current.error).toBeNull();
  });

  it("an error that is not an Error is still said", async () => {
    const fetcher: ChartFetcher = () => Promise.reject("plain text");
    const { result } = renderHook(() => useChart("5m", 300, false, fetcher));
    await flush();
    expect(result.current.error).toBe("plain text");
  });

  it("a change of timeframe starts from nothing, abandons the old ask, and ignores its late answer", async () => {
    const m = manual();
    const { result, rerender } = renderHook(({ tf }) => useChart(tf, 300, false, m.fetcher), { initialProps: { tf: "5m" as ChartTimeframe } });
    await act(async () => m.asks[0]!.ok(chartBase));
    expect(result.current.data?.timeframe).toBe("5m");
    rerender({ tf: "15m" });
    await flush();
    expect(result.current).toEqual({ status: "loading", data: null, error: null }); // the 5M candles are not left under the 15M name
    expect(m.asks).toHaveLength(2);
    expect(m.asks[1]!.tf).toBe("15m");
    await tick(CHART_POLL_MS); // (the 5M poll was cancelled with its timer: only the new ask is out)
    expect(m.asks).toHaveLength(2);
    await act(async () => m.asks[1]!.ok(answer("15m")));
    expect(result.current.data?.timeframe).toBe("15m");
  });

  it("an old ask that is still out when the timeframe changes is aborted, and its answer, when it comes, is not shown", async () => {
    const m = manual();
    const { result, rerender } = renderHook(({ tf }) => useChart(tf, 300, false, m.fetcher), { initialProps: { tf: "5m" as ChartTimeframe } });
    rerender({ tf: "1h" });
    await flush();
    expect(m.asks[0]!.signal.aborted).toBe(true);
    expect(m.asks[1]!.signal.aborted).toBe(false);
    await act(async () => m.asks[0]!.ok(answer("5m"))); // too late
    expect(result.current).toEqual({ status: "loading", data: null, error: null });
    await tick(CHART_POLL_MS * 2);
    expect(m.asks).toHaveLength(2); // and the late answer did not start a poll of the old timeframe
  });

  it("an old ask that FAILS after the timeframe changed is not an error of this chart, and is not asked again", async () => {
    const m = manual();
    const { result, rerender } = renderHook(({ tf }) => useChart(tf, 300, false, m.fetcher), { initialProps: { tf: "5m" as ChartTimeframe } });
    rerender({ tf: "1h" });
    await flush();
    await act(async () => m.asks[0]!.fail(new Error("aborted")));
    expect(result.current).toEqual({ status: "loading", data: null, error: null });
    await tick(CHART_RETRY_MS * 2);
    expect(m.asks).toHaveLength(2); // (only the 1H ask exists: the old one did not schedule a retry)
  });

  it("asks every 3 seconds, and again after 5 when an ask failed: the numbers, not the constants", () => {
    expect([CHART_POLL_MS, CHART_RETRY_MS]).toEqual([3000, 5000]);
  });

  it("a change of the limit starts again too", async () => {
    const m = manual();
    const { rerender } = renderHook(({ limit }) => useChart("5m", limit, false, m.fetcher), { initialProps: { limit: 300 } });
    rerender({ limit: 120 });
    await flush();
    expect(m.asks.map((a) => a.limit)).toEqual([300, 120]);
  });

  it("asks nothing while paused, keeps what it has, and asks again when the pause ends", async () => {
    const m = manual();
    const { result, rerender } = renderHook(({ paused }) => useChart("5m", 300, paused, m.fetcher), { initialProps: { paused: true } });
    await tick(CHART_POLL_MS * 3);
    expect(m.asks).toHaveLength(0);
    expect(result.current.status).toBe("loading");
    rerender({ paused: false });
    expect(m.asks).toHaveLength(1);
    await act(async () => m.asks[0]!.ok(chartBase));
    rerender({ paused: true });
    await tick(CHART_POLL_MS * 3);
    expect(m.asks).toHaveLength(1); // (the poll timer was cleared with the pause)
    expect(result.current.data).toEqual(chartBase); // what was drawn stays, for the page to dim
    rerender({ paused: false });
    expect(m.asks).toHaveLength(2);
  });

  it("an ask in flight when the pause begins is aborted and its answer is not used", async () => {
    const m = manual();
    const { result, rerender } = renderHook(({ paused }) => useChart("5m", 300, paused, m.fetcher), { initialProps: { paused: false } });
    rerender({ paused: true });
    expect(m.asks[0]!.signal.aborted).toBe(true);
    await act(async () => m.asks[0]!.ok(chartBase));
    expect(result.current.data).toBeNull();
  });

  it("an answer for another timeframe than the one asked is an error, not drawn", async () => {
    const m = manual();
    const { result } = renderHook(() => useChart("15m", 300, false, m.fetcher));
    await act(async () => m.asks[0]!.ok(chartBase)); // the 5M answer
    expect(result.current).toEqual({ status: "error", data: null, error: "Prism answered for 5m, not 15m" });
  });

  it("leaving the page stops everything: the ask in flight is aborted and nothing is asked again", async () => {
    const m = manual();
    const { unmount } = renderHook(() => useChart("5m", 300, false, m.fetcher));
    await act(async () => m.asks[0]!.ok(chartBase));
    await tick(CHART_POLL_MS);
    expect(m.asks).toHaveLength(2);
    unmount();
    expect(m.asks[1]!.signal.aborted).toBe(true);
    await tick(CHART_POLL_MS * 10);
    expect(m.asks).toHaveLength(2);
  });

  it("does not move when the fetcher it is given is the same one, however often the page redraws", async () => {
    const m = manual();
    const { rerender } = renderHook(() => useChart("5m", 300, false, m.fetcher));
    for (let i = 0; i < 5; i++) rerender();
    await flush();
    expect(m.asks).toHaveLength(1);
  });
});
