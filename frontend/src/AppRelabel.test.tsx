import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { base, chartBase, FakeSocket, fakeApi, fakeFactory, journalBase, variant } from "./test/helpers";

// The engine's action values (BUY CE, BUY PE) are never drawn as words. This walks every tab, on the real snapshot of a BUY CE and on a BUY PE, and fails if "BUY CE" or "BUY PE" is on any of them.
const URL = "ws://prism.test/ws";
const send = (data: unknown) => act(() => { FakeSocket.last.send(data); });
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const tab = (name: string) => act(() => screen.getByRole("tab", { name }).click());
const TABS = ["Overview", "Chart", "Options", "Analysis", "Journal", "Trades"];

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.reset();
  location.hash = "";
});
afterEach(() => vi.useRealTimers());

const pe = variant((s) => {
  const t = s.trading!;
  t.decision.action = "BUY PE";
  t.decision.headline = "BUY PE: Trend Pullback setup confirmed";
  t.setups[0]!.direction = "PE";
  if (s.options?.decision) { s.options.decision.action = "BUY PE"; s.options.decision.headline = "BUY PE: Trend Pullback setup confirmed"; }
});

describe("no tab says BUY CE or BUY PE", () => {
  it.each([["a BUY CE", base, "CE"], ["a BUY PE", pe, "PE"]])("on every tab, for %s", async (_name, snapshot, side) => {
    const journal = { ...journalBase, decisions: journalBase.decisions.map((d) => ({ ...d, action: side === "PE" ? "BUY PE" : d.action, headline: (d.headline ?? "").replace("BUY CE", `BUY ${side}`) })) };
    render(<App url={URL} createSocket={fakeFactory} api={fakeApi()} fetchChart={async () => chartBase} fetchJournal={async () => journal} />);
    await flush();
    send(snapshot);
    await flush();
    for (const name of TABS) {
      await tab(name);
      await flush();
      send(snapshot);
      await flush();
      expect(document.body.textContent, name).not.toMatch(/BUY (CE|PE)/);
    }
    await tab("Overview");
    expect(document.querySelector("#decision .dtxt")?.textContent).toBe(`${side} SETUP`);
    expect(document.querySelector("#decision .dhead")?.textContent).toBe(`${side} setup ready: Trend Pullback setup confirmed`);
  }, 30000);

  it("and the Trades tab still says BUY and SELL for the trades you made: they are your own order sides, not Prism's decision", async () => {
    render(<App url={URL} createSocket={fakeFactory} api={fakeApi()} />);
    await flush();
    send(base);
    await tab("Trades");
    await flush();
    const sides = [...document.querySelectorAll("#t-side option")].map((o) => o.textContent);
    expect(sides).toEqual(["BUY", "SELL"]);
    expect(document.getElementById("trades-body")?.textContent).toContain("BUY");
  });
});
