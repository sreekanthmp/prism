import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TradesApi } from "./tradesApi";
import { NO_CALCULATOR } from "./tradesModel";
import { fakeApi, ok, refused, riskBase } from "./test/helpers";
import { useRisk } from "./useRisk";

const mount = (api: TradesApi) => renderHook(() => useRisk(api));
const fill = (h: ReturnType<typeof mount>, fields: Record<string, string>) => act(() => { for (const [k, v] of Object.entries(fields)) h.result.current.setField(k as "entry", v); });

describe("the size calculator", () => {
  it("asks nothing until Calculate is clicked, and then only what was filled in", async () => {
    const api = fakeApi();
    const h = mount(api);
    expect(api.risk).not.toHaveBeenCalled();
    fill(h, { entry: "100", stop: "80", lot: "65" });
    await act(async () => { await h.result.current.calc(); });
    expect(api.risk).toHaveBeenCalledTimes(1);
    expect(api.risk).toHaveBeenCalledWith("entry=100&stop=80&lot=65");
    expect(h.result.current.out).toEqual({ answer: riskBase });
  });

  it("sends the overrides when they were filled in", async () => {
    const api = fakeApi();
    const h = mount(api);
    fill(h, { entry: "100", stop: "80", lot: "65", capital: "200000", risk_pct: "1.5", max_loss: "9000" });
    await act(async () => { await h.result.current.calc(); });
    expect(api.risk).toHaveBeenCalledWith("entry=100&stop=80&lot=65&capital=200000&risk_pct=1.5&max_loss=9000");
  });

  it("what is typed and what it said are kept (they are the page's)", async () => {
    const h = mount(fakeApi());
    fill(h, { entry: "100" });
    await act(async () => { await h.result.current.calc(); });
    h.rerender();
    expect(h.result.current.form.entry).toBe("100");
    expect(h.result.current.out).not.toBeNull();
  });

  it("a refusal is the server's own words; missing numbers are asked for plainly; an old server says to restart", async () => {
    const h = mount(fakeApi({ risk: vi.fn().mockResolvedValueOnce(refused(422, { detail: "the stop premium must be below the entry premium" })).mockResolvedValueOnce(refused(422, { detail: [{ loc: ["query", "entry"] }] })).mockResolvedValueOnce(refused(404, { detail: "Not Found" })) }));
    await act(async () => { await h.result.current.calc(); });
    expect(h.result.current.out).toEqual({ error: "the stop premium must be below the entry premium" });
    await act(async () => { await h.result.current.calc(); });
    expect(h.result.current.out).toEqual({ error: "fill in the entry premium, the stop premium and the lot size (numbers)" });
    await act(async () => { await h.result.current.calc(); });
    expect(h.result.current.out).toEqual({ error: NO_CALCULATOR });
  });

  it("a network failure is said in its own words", async () => {
    const h = mount(fakeApi({ risk: vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")) }));
    await act(async () => { await h.result.current.calc(); });
    expect(h.result.current.out).toEqual({ error: "TypeError: Failed to fetch" });
  });

  it("the latest question is the one that is shown, whichever answer comes back last", async () => {
    const waiting: ((a: ReturnType<typeof ok>) => void)[] = [];
    const api = fakeApi({ risk: vi.fn(() => new Promise<ReturnType<typeof ok>>((r) => { waiting.push(r); })) });
    const h = mount(api);
    let a: Promise<void> = Promise.resolve();
    let b: Promise<void> = Promise.resolve();
    act(() => { a = h.result.current.calc(); });
    act(() => { b = h.result.current.calc(); });
    await act(async () => { waiting[1]?.(ok({ ...riskBase, lots: 2 })); await b; }); // the second question is answered first
    await act(async () => { waiting[0]?.(ok({ ...riskBase, lots: 9 })); await a; }); // the first, late: it is not what was last asked
    expect(h.result.current.out).toEqual({ answer: { ...riskBase, lots: 2 } });
  });
});
