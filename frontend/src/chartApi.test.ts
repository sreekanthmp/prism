import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchChart } from "./chartApi";
import { chartBase, chartVariant } from "./test/helpers";

afterEach(() => vi.unstubAllGlobals());

function serve(body: unknown, init: { ok?: boolean; status?: number; json?: () => Promise<unknown> } = {}) {
  const f = vi.fn(async () => ({ ok: init.ok ?? true, status: init.status ?? 200, json: init.json ?? (async () => body) }));
  vi.stubGlobal("fetch", f);
  return f;
}

describe("fetchChart", () => {
  it("is a GET of /api/chart for the timeframe and limit, with the caller's signal, and nothing else", async () => {
    const f = serve(chartBase);
    const ctrl = new AbortController();
    const got = await fetchChart("5m", 300, ctrl.signal);
    expect(got).toEqual(chartBase);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/chart?timeframe=5m&limit=300");
    expect(init).toEqual({ signal: ctrl.signal, cache: "no-store" }); // no method, no body, no header: a plain read
  });

  it("asks for what it was given", async () => {
    const f = serve(chartVariant((c) => { c.timeframe = "1d"; }));
    await fetchChart("1d", 120, new AbortController().signal);
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe("/api/chart?timeframe=1d&limit=120");
  });

  it("says what Prism answered when it did not answer 200", async () => {
    serve({}, { ok: false, status: 503 });
    await expect(fetchChart("5m", 300, new AbortController().signal)).rejects.toThrow("Prism answered 503");
  });

  it("refuses an answer that is not what the page expects, rather than drawing it", async () => {
    serve({ available: true, timeframe: "5m", as_of: 1, candles: [{ time: 1, open: Number.NaN, high: 1, low: 1, close: 1 }], forming: null, setups: [] });
    await expect(fetchChart("5m", 300, new AbortController().signal)).rejects.toThrow("not what this page expects");
    serve("not an object");
    await expect(fetchChart("5m", 300, new AbortController().signal)).rejects.toThrow("not what this page expects");
  });

  it("passes on an answer that is not JSON as the failure it is", async () => {
    serve(null, { json: async () => { throw new SyntaxError("Unexpected token <"); } });
    await expect(fetchChart("5m", 300, new AbortController().signal)).rejects.toThrow("Unexpected token <");
  });

  it("passes on a network failure and an abort", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(fetchChart("5m", 300, new AbortController().signal)).rejects.toThrow("Failed to fetch");
  });
});
