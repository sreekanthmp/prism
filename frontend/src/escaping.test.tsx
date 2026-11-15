import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { base, chartBase, FakeSocket, fakeApi, fakeFactory, journalBase, limitReached, ok, riskBase, tradesBase } from "./test/helpers";

// Every string the server can send is drawn as TEXT, on every tab, in every place the page draws it. The source guard forbids innerHTML and the like; this holds it from the other side: markup is put at the
// end of EVERY string of every answer the page is given (the snapshot, the chart, the journal, the trades, the calculator), and what the page then holds must contain no element, no attribute and no handler
// that came from it. (It replaces the test that did this for the page the dashboard replaced, in every one of its 14 states.)

const EVIL = '"><img src=x onerror=alert(1)><script>alert(2)</script><svg onload=alert(3)>';

/** A copy of an answer with the markup put at the end of every string in it (the keys of an object stay: they are the page's own names). */
function poison<T>(x: T): T {
  if (typeof x === "string") return (x + EVIL) as T;
  if (Array.isArray(x)) return x.map(poison) as T;
  if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, poison(v)])) as T;
  return x;
}

const THREATS = "img, script, iframe, object, embed, link, svg, [onerror], [onload], [onclick], [onmouseover], [srcdoc], [href^='javascript']";
const URL = "ws://prism.test/ws";
const send = (data: unknown) => act(() => { FakeSocket.last.send(data); });
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

/** What on the page did not come from the page's own code: any element or attribute that can run something or load something. The chart's own canvas and the library's markup are not in jsdom. */
const threats = () => [...document.querySelectorAll(THREATS)].map((e) => e.outerHTML.slice(0, 120));

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.reset();
  vi.stubGlobal("confirm", vi.fn(() => true));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("what the server says is text, whatever it says", () => {
  it("on every tab, with the markup at the end of every string of every answer", async () => {
    const api = fakeApi({
      summary: vi.fn(async () => ok(poison(limitReached()))),
      risk: vi.fn(async () => ok(poison(riskBase))),
      log: vi.fn(async () => ok({ ok: true, summary: poison(tradesBase) })),
    });
    const fetchChart = vi.fn(async () => poison(chartBase));
    const fetchJournal = vi.fn(async () => poison(journalBase));
    render(<App url={URL} createSocket={fakeFactory} api={api} fetchChart={fetchChart} fetchJournal={fetchJournal} />);
    await flush();
    send(poison(base));
    await flush();
    expect(document.body.textContent).toContain("<img src=x onerror=alert(1)>"); // (the page DID draw the strings: as text)
    expect(threats()).toEqual([]);
    for (const name of ["Chart", "Options", "Analysis", "Journal", "Trades", "Overview"]) {
      act(() => screen.getByRole("tab", { name }).click());
      await flush();
      send(poison(base));
      await flush();
      expect(threats(), name).toEqual([]);
    }
    expect(document.querySelectorAll("*[style*='expression']")).toHaveLength(0);
  }, 30000); // (it draws every tab, with every string poisoned: slow when the whole suite runs at once)

  it("in the notebook, the forms and the calculator, when they are used", async () => {
    const api = fakeApi({
      summary: vi.fn(async () => ok(poison(tradesBase))),
      risk: vi.fn(async () => ok(poison(riskBase))),
      log: vi.fn(async () => ({ ok: false, status: 422, body: { detail: EVIL } })),
      voidTrade: vi.fn(async () => ({ ok: false, status: 422, body: { detail: EVIL } })),
    });
    render(<App url={URL} createSocket={fakeFactory} api={api} />);
    await flush();
    send(base);
    act(() => screen.getByRole("tab", { name: "Trades" }).click());
    await flush();
    for (const id of ["t-log", "t-calc"]) {
      await act(async () => { document.getElementById(id)!.click(); await Promise.resolve(); });
    }
    await act(async () => { (document.querySelector("button.voidbtn") as HTMLElement).click(); await Promise.resolve(); });
    expect(document.getElementById("t-msg")?.textContent).toContain(EVIL); // (the refusal's words, as text)
    expect(document.getElementById("trades-body")?.textContent).toContain("<img src=x"); // (what the notebook holds, as text)
    expect(threats()).toEqual([]);
  });

  it("in the one alert line and its list, for a setup alert whose words are markup", async () => {
    render(<App url={URL} createSocket={fakeFactory} api={fakeApi()} />);
    await flush();
    const staged = (stage: string) => {
      const s = poison(structuredClone(base));
      Object.assign(s.trading!.setups[0]!, { stage });
      return s;
    };
    send(staged("CONFIRMED"));
    send(staged("READY_TO_ACT"));
    await flush();
    expect(document.querySelector("[data-testid=alert-line]")?.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(threats()).toEqual([]);
  });

  it("the keys that a server names are text too (a count by reason, a count by timeframe)", async () => {
    render(<App url={URL} createSocket={fakeFactory} api={fakeApi()} />);
    await flush();
    const s = structuredClone(base);
    s.connection.ticks_rejected = { [EVIL]: 3 };
    if (s.health.readiness) s.health.readiness.candles = { missing_today: { [EVIL]: 2 }, missing_in_decision_window: { [EVIL]: 1 }, unavailable_after_retries: 0 };
    send(s);
    await flush();
    for (const name of ["Analysis", "Overview"]) {
      act(() => screen.getByRole("tab", { name }).click());
      await flush();
      send(s);
      await flush();
    }
    expect(threats()).toEqual([]);
  });
});
