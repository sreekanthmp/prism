import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJournal } from "./journalApi";
import { journalBase, journalVariant } from "./test/helpers";

afterEach(() => vi.unstubAllGlobals());

function serve(body: unknown, init: { ok?: boolean; status?: number; json?: () => Promise<unknown> } = {}) {
  const f = vi.fn(async () => ({ ok: init.ok ?? true, status: init.status ?? 200, json: init.json ?? (async () => body) }));
  vi.stubGlobal("fetch", f);
  return f;
}
const ask = () => fetchJournal(new AbortController().signal);

describe("fetchJournal", () => {
  it("is a GET of /api/journal with the caller's signal, and nothing else", async () => {
    const f = serve(journalBase);
    const ctrl = new AbortController();
    expect(await fetchJournal(ctrl.signal)).toEqual(journalBase);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/journal");
    expect(init).toEqual({ signal: ctrl.signal, cache: "no-store" }); // no method, no body, no header: a plain read
  });
  it("hands on a journal that says it is not available, with its reason", async () => {
    const none = { available: false, reason: "no decision journal is configured", decisions: [], events: [], file: null };
    expect(await (serve(none), ask())).toEqual(none);
  });
  it("says an older server has no journal endpoint, rather than showing an empty journal", async () => {
    const expected = { available: false, reason: "this Prism server has no journal endpoint yet (restart Prism to load the current version)", decisions: [], events: [], file: null, records: 0 };
    serve({ detail: "Not Found" }, { ok: false, status: 404 });
    expect(await ask()).toEqual(expected);
    serve({ detail: "Not Found" }); // (a 200 that says nothing of 'available' is not a journal either)
    expect(await ask()).toEqual(expected);
    serve("not an object");
    expect(await ask()).toEqual(expected);
    serve(null);
    expect(await ask()).toEqual(expected);
  });
  it("says an error is an error even when its body looks like a journal, and does not look inside a journal that says it is not available", async () => {
    const expected = { available: false, reason: "this Prism server has no journal endpoint yet (restart Prism to load the current version)", decisions: [], events: [], file: null, records: 0 };
    serve(journalBase, { ok: false, status: 500 });
    expect(await ask()).toEqual(expected);
    const none = { available: false, reason: "no decision journal is configured" }; // (it carries no lists: it says it has no journal)
    serve(none);
    expect(await ask()).toEqual(none);
  });
  it("refuses an answer that says it has a journal and is not shaped like one", async () => {
    serve({ ...journalBase, decisions: "none" });
    await expect(ask()).rejects.toThrow("not what this page expects");
    serve({ ...journalBase, events: {} });
    await expect(ask()).rejects.toThrow("not what this page expects");
    serve(journalVariant((j) => { delete (j.decisions[0] as unknown as Record<string, unknown>).reasons; }));
    await expect(ask()).rejects.toThrow("not what this page expects");
    serve(journalVariant((j) => { (j.decisions[1] as unknown as Record<string, unknown>).against = null; }));
    await expect(ask()).rejects.toThrow("not what this page expects");
  });
  it("passes on what is not JSON and what the network does", async () => {
    serve(null, { json: async () => { throw new SyntaxError("Unexpected token <"); } });
    await expect(ask()).rejects.toThrow("Unexpected token <");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(ask()).rejects.toThrow("Failed to fetch");
  });
});
