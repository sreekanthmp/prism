import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { base, FakeSocket, fakeApi, fakeFactory, variant } from "./test/helpers";

// The checklist's boxes live in the App, above the tabs: a visit to the Options tab (to look at the contract) or to the Trades tab (to size the trade) must not lose what the reader ticked.
const URL = "ws://prism.test/ws";
const send = (data: unknown) => act(() => { FakeSocket.last.send(data); });
const drop = () => act(() => { FakeSocket.last.drop(); });
const tab = (name: string) => act(() => screen.getByRole("tab", { name }).click());
const box = (id: string) => document.getElementById(`pt-m-${id}`) as HTMLInputElement;
const summary = () => screen.getByTestId("pretrade-summary").textContent;
const mount = () => render(<App url={URL} createSocket={fakeFactory} api={fakeApi()} />);

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.reset();
  location.hash = "";
});
afterEach(() => vi.useRealTimers());

describe("the checklist in the dashboard", () => {
  it("is on the Overview with the first snapshot, and not before it", () => {
    mount();
    expect(document.getElementById("pretrade")).toBeNull();
    send(base);
    expect(summary()).toBe("12 of 13 met · 1 caution — yours: 0 of 5 ticked");
  });

  it("keeps the reader's ticks across a visit to another tab and back", () => {
    mount();
    send(base);
    fireEvent.click(box("chain"));
    fireEvent.click(box("stop"));
    for (const name of ["Options", "Trades", "Chart"]) {
      tab(name);
      expect(document.getElementById("pretrade"), name).toBeNull(); // (the Overview is not drawn while another tab is open)
    }
    tab("Overview");
    expect(box("chain").checked).toBe(true);
    expect(box("stop").checked).toBe(true);
    expect(box("greeks").checked).toBe(false);
    expect(summary()).toBe("12 of 13 met · 1 caution — yours: 2 of 5 ticked");
  });

  it("keeps them as the snapshots arrive, and clears them when the live setup is another one", () => {
    mount();
    send(base);
    fireEvent.click(box("plan"));
    send(base);
    send(base);
    expect(box("plan").checked).toBe(true);
    send(variant((s) => { s.trading!.setups[0]!.id = "ema_trend_continuation:bull:1"; s.trading!.decision.setup_id = "ema_trend_continuation:bull:1"; }));
    expect(box("plan").checked).toBe(false);
    expect(summary()).toBe("12 of 13 met · 1 caution — yours: 0 of 5 ticked");
  });

  it("answers nothing when the link is lost, and still holds what was ticked", () => {
    mount();
    send(base);
    fireEvent.click(box("limit"));
    drop();
    expect(summary()).toBe("not current: the page lost its link to Prism");
    expect(box("limit").checked).toBe(true);
    expect([...document.querySelectorAll("[data-check]")].every((r) => r.getAttribute("data-status") === "unknown")).toBe(true);
  });

  it("sends the reader to the Options tab, and the Trades tab, from its links", () => {
    mount();
    send(base);
    act(() => document.querySelector<HTMLButtonElement>("[data-check=contract] button.linkbtn")!.click());
    expect(screen.getByRole("tab", { name: "Options" }).getAttribute("aria-selected")).toBe("true");
    tab("Overview");
    act(() => document.querySelector<HTMLButtonElement>("[data-manual=stop] button.linkbtn")!.click());
    expect(screen.getByRole("tab", { name: "Trades" }).getAttribute("aria-selected")).toBe("true");
  });
});
