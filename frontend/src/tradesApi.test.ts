import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tradesApi } from "./tradesApi";
import { tradesBase } from "./test/helpers";

// The four requests there are, to the four addresses there are: what is sent, and what is made of what comes back.

const reply = (status: number, body: unknown, json = true) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => {
    if (!json) throw new SyntaxError("not json");
    return body;
  },
});
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => reply(200, tradesBase));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());
const sent = () => fetchMock.mock.calls.map((c) => ({ url: c[0] as string, init: c[1] as RequestInit }));

describe("reading the trades", () => {
  it("is a GET of /api/trades that is never answered from a cache, and sends nothing", async () => {
    const a = await tradesApi.summary();
    expect(a).toEqual({ ok: true, status: 200, body: tradesBase });
    const { url, init } = sent()[0]!;
    expect(url).toBe("/api/trades");
    expect(init).toEqual({ method: "GET", cache: "no-store" });
    expect(init.body).toBeUndefined();
    expect(init.headers).toBeUndefined();
  });
});

describe("logging a trade", () => {
  it("is a POST of /api/trades with the trade as JSON, and nothing else", async () => {
    const trade = { instrument: "NIFTY 24500 CE", side: "BUY", qty: "65", price: "101.5", setup_id: "x:bull:1", note: "first" };
    await tradesApi.log(trade);
    const { url, init } = sent()[0]!;
    expect(url).toBe("/api/trades");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual(trade);
    expect(Object.keys(init).sort()).toEqual(["body", "headers", "method"]);
  });
  it("is a refusal with its status and body, not an exception", async () => {
    fetchMock.mockResolvedValueOnce(reply(422, { detail: "nothing to sell" }));
    expect(await tradesApi.log({ instrument: "x", side: "SELL", qty: "1", price: "1", setup_id: "", note: "" })).toEqual({ ok: false, status: 422, body: { detail: "nothing to sell" } });
  });
  it("a network failure is an exception for the caller to say", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(tradesApi.log({ instrument: "x", side: "BUY", qty: "1", price: "1", setup_id: "", note: "" })).rejects.toThrow("Failed to fetch");
  });
});

describe("voiding a trade", () => {
  it("is a POST of /api/trades/<id>/void with no body, the id encoded into the address", async () => {
    await tradesApi.voidTrade("a/b c?");
    const { url, init } = sent()[0]!;
    expect(url).toBe("/api/trades/a%2Fb%20c%3F/void");
    expect(init).toEqual({ method: "POST" });
  });
  it("an ordinary id is left as it is", async () => {
    await tradesApi.voidTrade("t1793941800000-1");
    expect(sent()[0]?.url).toBe("/api/trades/t1793941800000-1/void");
  });
});

describe("sizing a trade", () => {
  it("is a GET of /api/risk with the query it is given, never answered from a cache", async () => {
    await tradesApi.risk("entry=100&stop=80&lot=65");
    const { url, init } = sent()[0]!;
    expect(url).toBe("/api/risk?entry=100&stop=80&lot=65");
    expect(init).toEqual({ method: "GET", cache: "no-store" });
  });
});

describe("an answer that is not JSON", () => {
  it("has a null body: the status says it", async () => {
    fetchMock.mockResolvedValueOnce(reply(502, null, false));
    expect(await tradesApi.summary()).toEqual({ ok: false, status: 502, body: null });
  });
});
