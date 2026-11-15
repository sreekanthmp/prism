import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlertEvent } from "./alertEvents";
import type { TradesApi } from "./tradesApi";
import { NO_TRADE_LOG } from "./tradesModel";
import { aTrade, fakeApi, limitReached, ok, refused, tradesBase, tradesVariant } from "./test/helpers";
import { VOID_QUESTION, useTrades } from "./useTrades";

// The trades you logged: asked for once, a notebook you write to, and the day's loss limit said once.

const mount = (api: TradesApi, raise: (l: AlertEvent[], t: number | null) => void = () => undefined, now: () => number | null = () => 1000, strict = false) =>
  renderHook(() => useTrades(api, raise, now), strict ? { wrapper: StrictMode } : undefined);
const settle = () => act(async () => { await Promise.resolve(); });
const type = (h: ReturnType<typeof mount>, fields: Record<string, string>) => act(() => { for (const [k, v] of Object.entries(fields)) h.result.current.setField(k as "instrument", v); });
const FILLED = { instrument: "NIFTY 24500 CE", qty: "65", price: "101.5", setup_id: "trend_pullback:bull:1", note: "first" };

beforeEach(() => {
  vi.stubGlobal("confirm", vi.fn(() => true));
});
afterEach(() => vi.unstubAllGlobals());

describe("asking for the trades", () => {
  it("is done once, as the page starts, and the answer is the page's", async () => {
    const api = fakeApi();
    const h = mount(api);
    expect(h.result.current.data).toBeNull();
    await waitFor(() => expect(h.result.current.data).toEqual(tradesBase));
    expect(api.summary).toHaveBeenCalledTimes(1);
    h.rerender();
    expect(api.summary).toHaveBeenCalledTimes(1);
  });

  it("once under React's strict mode too, and the answer is shown, not an abort (the development build starts the page twice)", async () => {
    const api = fakeApi();
    const h = mount(api, undefined, undefined, true);
    await waitFor(() => expect(h.result.current.data).toEqual(tradesBase));
    expect(api.summary).toHaveBeenCalledTimes(1);
    expect(h.result.current.error).toBeNull();
  });

  it("a server that cannot answer is asked once and never in a loop; Retry asks again", async () => {
    const api = fakeApi({ summary: vi.fn(async () => ok(tradesBase)).mockRejectedValueOnce(new TypeError("Failed to fetch")) });
    const h = mount(api);
    await waitFor(() => expect(h.result.current.error).toBe("TypeError: Failed to fetch"));
    expect(h.result.current.data).toBeNull();
    await settle();
    expect(api.summary).toHaveBeenCalledTimes(1);
    act(() => h.result.current.retry());
    expect(h.result.current.error).toBeNull(); // (asking again clears the complaint)
    await waitFor(() => expect(h.result.current.data).toEqual(tradesBase));
    expect(api.summary).toHaveBeenCalledTimes(2);
  });

  it("a server that has no trade log is said, not shown as an empty notebook", async () => {
    const h = mount(fakeApi({ summary: vi.fn(async () => refused(404, { detail: "Not Found" })) }));
    await waitFor(() => expect(h.result.current.data).toEqual({ available: false, reason: NO_TRADE_LOG, trades: [], open: [] }));
  });

  it("a second ask while the first is out does not go to the server", async () => {
    let release: (a: ReturnType<typeof ok>) => void = () => undefined;
    const api = fakeApi({ summary: vi.fn(() => new Promise<ReturnType<typeof ok>>((r) => { release = r; })) });
    const h = mount(api);
    act(() => h.result.current.retry());
    act(() => h.result.current.retry());
    expect(api.summary).toHaveBeenCalledTimes(1);
    await act(async () => release(ok(tradesBase)));
    expect(h.result.current.data).toEqual(tradesBase);
  });

  it("a page that is left while the ask is out is not an error (the answer is ignored)", async () => {
    let release: (a: ReturnType<typeof ok>) => void = () => undefined;
    const h = mount(fakeApi({ summary: vi.fn(() => new Promise<ReturnType<typeof ok>>((r) => { release = r; })) }));
    h.unmount();
    await act(async () => release(ok(tradesBase)));
    expect(h.result.current.data).toBeNull();
  });
});

describe("logging a trade", () => {
  it("sends what was typed, applies the summary the server answered with, clears the numbers and keeps the instrument and the side", async () => {
    const answer = tradesVariant((t) => { t.realised = 0; });
    const api = fakeApi({ log: vi.fn(async () => ok({ ok: true, trade: aTrade(), summary: answer })) });
    const h = mount(api);
    await settle();
    type(h, { ...FILLED, side: "SELL" });
    await act(async () => { await h.result.current.log(); });
    expect(api.log).toHaveBeenCalledWith({ instrument: "NIFTY 24500 CE", side: "SELL", qty: "65", price: "101.5", setup_id: "trend_pullback:bull:1", note: "first" });
    expect(h.result.current.data).toBe(answer);
    expect(h.result.current.message).toEqual({ text: "logged", bad: false });
    expect(h.result.current.form).toEqual({ instrument: "NIFTY 24500 CE", side: "SELL", qty: "", price: "", setup_id: "", note: "" });
  });

  it("says it is logging while the request is out", async () => {
    let release: (a: ReturnType<typeof ok>) => void = () => undefined;
    const api = fakeApi({ log: vi.fn(() => new Promise<ReturnType<typeof ok>>((r) => { release = r; })) });
    const h = mount(api);
    await settle();
    let done: Promise<void> = Promise.resolve();
    act(() => { done = h.result.current.log(); });
    expect(h.result.current.message).toEqual({ text: "logging…", bad: false });
    await act(async () => { release(ok({ ok: true, summary: tradesBase })); await done; });
    expect(h.result.current.message?.text).toBe("logged");
  });

  it("a second click while the first is out does not log the trade twice", async () => {
    let release: (a: ReturnType<typeof ok>) => void = () => undefined;
    const api = fakeApi({ log: vi.fn(async () => ok({ ok: true, summary: tradesBase })).mockImplementationOnce(() => new Promise<ReturnType<typeof ok>>((r) => { release = r; })) });
    const h = mount(api);
    await settle();
    let first: Promise<void> = Promise.resolve();
    act(() => { first = h.result.current.log(); });
    await act(async () => { await h.result.current.log(); }); // (the second click)
    expect(api.log).toHaveBeenCalledTimes(1);
    await act(async () => { release(ok({ ok: true, summary: tradesBase })); await first; });
    await act(async () => { await h.result.current.log(); }); // (after the first is done, the next trade can be logged)
    expect(api.log).toHaveBeenCalledTimes(2);
  });

  it("a refused trade says why, in red, and changes nothing (what was typed stays)", async () => {
    const api = fakeApi({ log: vi.fn(async () => refused(422, { detail: "nothing to sell: NIFTY 24500 CE has 0 unit(s) open and the sell is for 65" })) });
    const h = mount(api);
    await settle();
    type(h, FILLED);
    const before = h.result.current.data;
    await act(async () => { await h.result.current.log(); });
    expect(h.result.current.message).toEqual({ text: "not logged: nothing to sell: NIFTY 24500 CE has 0 unit(s) open and the sell is for 65", bad: true });
    expect(h.result.current.data).toBe(before);
    expect(h.result.current.form.qty).toBe("65");
  });

  it("a validation list from the server is shown, not hidden", async () => {
    const api = fakeApi({ log: vi.fn(async () => refused(422, { detail: [{ loc: ["body"], msg: "bad" }] })) });
    const h = mount(api);
    await settle();
    await act(async () => { await h.result.current.log(); });
    expect(h.result.current.message?.text).toContain("bad");
    expect(h.result.current.message?.bad).toBe(true);
  });

  it("a server that does not know the route says to restart Prism", async () => {
    const api = fakeApi({ log: vi.fn(async () => refused(404, { detail: "Not Found" })) });
    const h = mount(api);
    await settle();
    await act(async () => { await h.result.current.log(); });
    expect(h.result.current.message).toEqual({ text: NO_TRADE_LOG, bad: true });
  });

  it("a network failure is said and nothing is cleared", async () => {
    const api = fakeApi({ log: vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")) });
    const h = mount(api);
    await settle();
    type(h, FILLED);
    await act(async () => { await h.result.current.log(); });
    expect(h.result.current.message).toEqual({ text: "not logged: TypeError: Failed to fetch", bad: true });
    expect(h.result.current.form.price).toBe("101.5");
  });

  it("an answer with no summary was written all the same: the trades are read again, and it is said", async () => {
    const api = fakeApi({ log: vi.fn(async () => ok({ ok: true })) });
    const h = mount(api);
    await settle();
    type(h, FILLED);
    await act(async () => { await h.result.current.log(); });
    expect(h.result.current.message).toEqual({ text: "logged, but Prism's answer was not what this page expects: the trades were read again", bad: true });
    expect(api.summary).toHaveBeenCalledTimes(2);
    expect(h.result.current.form.price).toBe("101.5"); // (not cleared: it is not known that it was taken)
  });

  it("what is typed is the page's: it is kept as it was typed", () => {
    const h = mount(fakeApi());
    type(h, { instrument: "A" });
    type(h, { qty: "1" });
    expect(h.result.current.form).toEqual({ instrument: "A", side: "BUY", qty: "1", price: "", setup_id: "", note: "" });
  });
});

describe("voiding a trade", () => {
  it("asks first, then has the server cancel that trade and applies the answer", async () => {
    const after = tradesVariant((t) => { t.trades = t.trades.slice(0, 1); });
    const api = fakeApi({ voidTrade: vi.fn(async () => ok({ ok: true, summary: after })) });
    const h = mount(api);
    await settle();
    await act(async () => { await h.result.current.voidTrade("t2"); });
    expect(confirm).toHaveBeenCalledWith("Void this trade? The file keeps it and adds a line that cancels it; this cannot be undone.");
    expect(VOID_QUESTION).toBe("Void this trade? The file keeps it and adds a line that cancels it; this cannot be undone.");
    expect(api.voidTrade).toHaveBeenCalledWith("t2");
    expect(h.result.current.data).toBe(after);
    expect(h.result.current.message).toEqual({ text: "voided", bad: false });
  });

  it("a trade is not voided when the reader says no", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    const api = fakeApi();
    const h = mount(api);
    await settle();
    await act(async () => { await h.result.current.voidTrade("t2"); });
    expect(api.voidTrade).not.toHaveBeenCalled();
    expect(h.result.current.message).toBeNull();
  });

  it("goes ahead where the browser cannot ask", async () => {
    vi.stubGlobal("confirm", undefined);
    const api = fakeApi();
    const h = mount(api);
    await settle();
    await act(async () => { await h.result.current.voidTrade("t2"); });
    expect(api.voidTrade).toHaveBeenCalledTimes(1);
  });

  it("a refused void says why", async () => {
    const api = fakeApi({ voidTrade: vi.fn(async () => refused(422, { detail: "a later sell depends on this buy: void the sell first" })) });
    const h = mount(api);
    await settle();
    await act(async () => { await h.result.current.voidTrade("t1"); });
    expect(h.result.current.message).toEqual({ text: "not voided: a later sell depends on this buy: void the sell first", bad: true });
  });

  it("a network failure while voiding is said", async () => {
    const api = fakeApi({ voidTrade: vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")) });
    const h = mount(api);
    await settle();
    await act(async () => { await h.result.current.voidTrade("t1"); });
    expect(h.result.current.message).toEqual({ text: "not voided: TypeError: Failed to fetch", bad: true });
  });

  it("a second void while the first is out does not go to the server", async () => {
    let release: (a: ReturnType<typeof ok>) => void = () => undefined;
    const api = fakeApi({ voidTrade: vi.fn(() => new Promise<ReturnType<typeof ok>>((r) => { release = r; })) });
    const h = mount(api);
    await settle();
    let first: Promise<void> = Promise.resolve();
    act(() => { first = h.result.current.voidTrade("t1"); });
    await act(async () => { await h.result.current.voidTrade("t1"); });
    expect(api.voidTrade).toHaveBeenCalledTimes(1);
    await act(async () => { release(ok({ ok: true, summary: tradesBase })); await first; });
  });
});

describe("the daily loss limit", () => {
  const under = tradesVariant((t) => { t.realised = -4000; t.lost_today = 4000; t.daily_loss_used_pct = 80; });
  const lost = limitReached();
  const logs = (...summaries: unknown[]) => {
    const log = vi.fn();
    for (const s of summaries) log.mockResolvedValueOnce(ok({ ok: true, summary: s }));
    return fakeApi({ summary: vi.fn(async () => ok(under)), log });
  };

  it("logging the trade that reaches it raises one warning, with the time of the last snapshot", async () => {
    const raise = vi.fn();
    const h = mount(logs(lost), raise, () => 1234);
    await settle();
    await act(async () => { await h.result.current.log(); });
    expect(raise).toHaveBeenCalledTimes(1);
    expect(raise).toHaveBeenCalledWith([{ level: "warn", key: "daily-loss", title: "Your daily loss limit is reached", text: "Rs 5,200 lost of Rs 5,000: your own limit says stop for the day." }], 1234);
  });

  it("not a second time while it is still reached", async () => {
    const raise = vi.fn();
    const h = mount(logs(lost, lost), raise);
    await settle();
    await act(async () => { await h.result.current.log(); });
    await act(async () => { await h.result.current.log(); });
    expect(raise).toHaveBeenCalledTimes(1);
  });

  it("again after it has been left and reached again", async () => {
    const raise = vi.fn();
    const h = mount(logs(lost, under, lost), raise);
    await settle();
    for (let i = 0; i < 3; i++) await act(async () => { await h.result.current.log(); });
    expect(raise).toHaveBeenCalledTimes(2);
  });

  it("a limit that is not reached raises nothing", async () => {
    const raise = vi.fn();
    const h = mount(logs(under), raise);
    await settle();
    await act(async () => { await h.result.current.log(); });
    expect(raise).not.toHaveBeenCalled();
  });

  it("a limit already reached when the page starts is not said (it is on the alert line), only the first trade that leaves it reached is", async () => {
    const raise = vi.fn();
    const api = fakeApi({ summary: vi.fn(async () => ok(lost)), log: vi.fn(async () => ok({ ok: true, summary: lost })) });
    const h = mount(api, raise);
    await settle();
    expect(raise).not.toHaveBeenCalled();
    await act(async () => { await h.result.current.log(); });
    expect(raise).toHaveBeenCalledTimes(1);
  });

  it("voiding the trade that reached it, and so leaving it, lets it be said again", async () => {
    const raise = vi.fn();
    const api = fakeApi({
      summary: vi.fn(async () => ok(under)),
      log: vi.fn(async () => ok({ ok: true, summary: lost })),
      voidTrade: vi.fn(async () => ok({ ok: true, summary: under })),
    });
    const h = mount(api, raise);
    await settle();
    await act(async () => { await h.result.current.log(); });
    await act(async () => { await h.result.current.voidTrade("t1"); });
    await act(async () => { await h.result.current.log(); });
    expect(raise).toHaveBeenCalledTimes(2);
  });

  it("is not said before there is a snapshot to stamp it with, and then it can still be said", async () => {
    const raise = vi.fn();
    let t: number | null = null;
    const h = mount(logs(lost, lost), raise, () => t);
    await settle();
    await act(async () => { await h.result.current.log(); });
    expect(raise).not.toHaveBeenCalled();
    t = 99;
    await act(async () => { await h.result.current.log(); });
    expect(raise).toHaveBeenCalledWith(expect.anything(), 99);
  });

  it("a trade log that is not available has no limit to reach", async () => {
    const raise = vi.fn();
    const api = fakeApi({ log: vi.fn(async () => ok({ ok: true, summary: { available: false, reason: "x", trades: [] } })) });
    const h = mount(api, raise);
    await settle();
    await act(async () => { await h.result.current.log(); });
    expect(raise).not.toHaveBeenCalled();
    expect(h.result.current.message).toEqual({ text: "logged", bad: false });
  });
});
