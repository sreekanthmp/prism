import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fx from "./alertEffects";
import { App } from "./App";
import { RECONNECT_MS, SILENT_MS } from "./connection";
import { base, FakeSocket, fakeApi, fakeFactory, limitReached, ok, tradesBase, variant } from "./test/helpers";
import type { Setup } from "./types";

// The dashboard as a whole, being told when something needs you (the alerts) and keeping the reader's own trades on every tab.

vi.mock("./alertEffects", () => ({ beep: vi.fn(), popup: vi.fn(), askPopupPermission: vi.fn(), readMode: vi.fn(() => "sound"), saveMode: vi.fn(), unlockSound: vi.fn() }));

const URL = "ws://prism.test/ws";
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const send = (data: unknown) => act(() => { FakeSocket.last.send(data); });
const drop = () => act(() => { FakeSocket.last.drop(); });
const mount = (api = fakeApi()) => render(<App url={URL} createSocket={fakeFactory} api={api} />);
const flush = () => act(async () => { await Promise.resolve(); });
const chip = (id: string) => document.getElementById(id)?.textContent;
const staged = (stage: string, over: Partial<Setup> = {}) => variant((s) => { Object.assign(s.trading!.setups[0]!, { stage, ...over }); });
const notReady = () => variant((s) => { s.health.readiness = { state: "RECOVERING_GAPS", ready: false, decisions_permitted: false, summary: "recovering missing candles", pre_market: false }; });
const lineText = () => document.querySelector("[data-testid=alert-line] summary")?.textContent;
const tab = (name: string) => act(() => screen.getByRole("tab", { name }).click());

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.reset();
  vi.clearAllMocks();
  vi.mocked(fx.readMode).mockReturnValue("sound");
  document.title = "Prism";
});
afterEach(() => vi.useRealTimers());

describe("being told when something needs you", () => {
  it("a setup that becomes ready is one green line, a sound and a count in the title; a click is the reader being back, and the line stays", () => {
    mount();
    send(staged("CONFIRMED"));
    expect(document.querySelector("[data-testid=alert-line]")).toBeNull();
    expect(fx.beep).not.toHaveBeenCalled(); // (the first snapshot is a baseline)
    send(base);
    expect(screen.getByTestId("alert-line").className).toBe("alerts act");
    expect(lineText()).toBe("🔔 1 alert: BUY CE ready: Trend Pullback ▾ details");
    expect(fx.beep).toHaveBeenCalledTimes(1);
    expect(fx.beep).toHaveBeenCalledWith("act");
    expect(document.title).toBe("(1) Prism");
    act(() => { document.body.click(); });
    expect(document.title).toBe("Prism");
    expect(lineText()).toBe("🔔 1 alert: BUY CE ready: Trend Pullback ▾ details");
    expect(screen.getByTestId("alert-line").textContent).toContain("You decide and place any order yourself.");
  });

  it("the setup alerts leave the line after ten minutes, and the count of what was not seen stays", () => {
    mount();
    send(staged("CONFIRMED"));
    send(base);
    send(variant((s) => { s.server_time += 600; }));
    expect(lineText()).toContain("1 alert");
    send(variant((s) => { s.server_time += 601; }));
    expect(document.querySelector("[data-testid=alert-line]")).toBeNull();
    expect(document.title).toBe("(1) Prism");
  });

  it("'clear the setup alerts' empties the line and the count", () => {
    mount();
    send(staged("CONFIRMED"));
    send(base);
    expect(document.getElementById("alert-clear")?.textContent).toBe("clear the setup alerts");
    act(() => { fireEvent.click(document.getElementById("alert-clear")!); });
    expect(document.querySelector("[data-testid=alert-line]")).toBeNull();
    expect(document.title).toBe("Prism");
  });

  it("a system that stops being ready is a state alert and a sound, and ready again is only noted", () => {
    mount();
    send(base);
    send(notReady());
    expect(fx.beep).toHaveBeenCalledWith("warn");
    expect(lineText()).toContain("NOT READY");
    vi.mocked(fx.beep).mockClear();
    send(variant((s) => { s.server_time += 1; }));
    expect(document.querySelector("[data-testid=alert-line]")).toBeNull();
    expect(fx.beep).not.toHaveBeenCalled();
    expect(document.title).toBe("(2) Prism"); // (the warning and the news that it is ready again)
  });

  it("the header has the mode button, and it goes round the three modes, saving the choice", () => {
    mount();
    const button = () => document.getElementById("alert-mode") as HTMLButtonElement;
    expect(button().textContent).toBe("🔔 sound");
    act(() => button().click());
    expect(button().textContent).toBe("🔔 off");
    expect(button().className).toBe("alertmode off");
    act(() => button().click());
    expect(button().textContent).toBe("🔔 sound + popup");
    expect(fx.askPopupPermission).toHaveBeenCalledTimes(1);
    act(() => button().click());
    expect(button().textContent).toBe("🔔 sound");
    expect(vi.mocked(fx.saveMode).mock.calls.map((c) => c[0])).toEqual(["off", "sound + popup", "sound"]);
  });

  it("starts in the mode that was saved, and off is only the sound and the popup: the line and the count still say it", () => {
    vi.mocked(fx.readMode).mockReturnValue("off");
    mount();
    expect(document.getElementById("alert-mode")?.textContent).toBe("🔔 off");
    send(staged("CONFIRMED"));
    send(base);
    expect(fx.beep).not.toHaveBeenCalled();
    expect(lineText()).toContain("BUY CE ready");
    expect(document.title).toBe("(1) Prism");
  });

  it("a link that is lost is one warning, and what changed while it was lost is announced when it comes back", () => {
    mount();
    send(staged("CONFIRMED"));
    drop();
    expect(vi.mocked(fx.beep).mock.calls.map((c) => c[0])).toEqual(["warn"]);
    advance(SILENT_MS * 2); // (silence on top of a closed socket is the same loss)
    expect(fx.beep).toHaveBeenCalledTimes(1);
    advance(RECONNECT_MS);
    send(base); // the setup became ready while the page could not see
    expect(vi.mocked(fx.beep).mock.calls.map((c) => c[0])).toEqual(["warn", "act"]);
    expect(lineText()).toContain("BUY CE ready");
  });

  it("a page that has lost its link says nothing about setups or the market, though the alerts are counted", () => {
    mount();
    send(staged("CONFIRMED"));
    send(base);
    expect(screen.getByTestId("alert-line")).toBeTruthy();
    drop();
    expect(document.querySelector("[data-testid=alert-line]")).toBeNull(); // (the stale notice is the alert)
    expect(document.title).toBe("(2) Prism"); // (the ready setup, and the lost link)
  });

  it("an alert that fails cannot take the page down", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(fx.beep).mockImplementation(() => {
      throw new Error("no speakers");
    });
    mount();
    send(staged("CONFIRMED"));
    send(base);
    expect(chip("c-market")).toBe("MARKET OPEN");
    expect(document.getElementById("spot")?.textContent).toBe("24287.00");
    log.mockRestore();
  });
});

describe("your own trades, on every tab", () => {
  it("are asked for once, as the page starts, and not again for the tabs, the snapshots or the redraws", async () => {
    const api = fakeApi();
    mount(api);
    await flush();
    expect(api.summary).toHaveBeenCalledTimes(1); // (before the first snapshot)
    send(base);
    for (const name of ["Chart", "Options", "Analysis", "Journal", "Trades", "Overview", "Trades"]) {
      tab(name);
      send(variant((s) => { s.server_time += 1; }));
    }
    await flush();
    expect(api.summary).toHaveBeenCalledTimes(1);
    expect(document.getElementById("trades-body")?.textContent).toContain("Realised Rs 1,950");
  }, 30000); // (it draws every tab, the chart's among them: slow when the whole suite runs at once)

  it("a loss limit already reached is on every tab from the start, in red, with no sound", async () => {
    mount(fakeApi({ summary: vi.fn(async () => ok(limitReached())) }));
    await flush();
    send(base);
    expect(screen.getByTestId("alert-line").className).toBe("alerts bad");
    expect(lineText()).toBe("⛔ 1 alert: Your daily loss limit is reached ▾ details");
    expect(screen.getByTestId("alert-line").textContent).toContain("Rs 5,200 lost of Rs 5,000. Prism's decisions are unchanged: this limit is yours, and it says stop for the day");
    tab("Journal");
    expect(lineText()).toContain("Your daily loss limit is reached");
    expect(fx.beep).not.toHaveBeenCalled();
    expect(document.title).toBe("Prism");
  });

  it("logging the trade that leaves the limit reached raises one warning, with a sound, and not a second time", async () => {
    const api = fakeApi({ summary: vi.fn(async () => ok(tradesBase)), log: vi.fn(async () => ok({ ok: true, summary: limitReached() })) });
    mount(api);
    await flush();
    send(base);
    tab("Trades");
    expect(lineText()).toBeUndefined();
    await act(async () => { fireEvent.click(document.getElementById("t-log")!); await Promise.resolve(); });
    expect(lineText()).toContain("Your daily loss limit is reached");
    expect(vi.mocked(fx.beep).mock.calls.map((c) => c[0])).toEqual(["warn"]);
    expect(document.title).toBe("(1) Prism");
    await act(async () => { fireEvent.click(document.getElementById("t-log")!); await Promise.resolve(); });
    expect(fx.beep).toHaveBeenCalledTimes(1);
  });

  it("a stale page still shows the reader's own loss limit, and nothing else", async () => {
    mount(fakeApi({ summary: vi.fn(async () => ok(limitReached())) }));
    await flush();
    send(notReady());
    expect(lineText()).toContain("2 alerts");
    drop();
    expect(lineText()).toBe("⛔ 1 alert: Your daily loss limit is reached ▾ details");
  });

  it("a stale page offers no 'clear the setup alerts': the setup alerts are not on its line", async () => {
    mount(fakeApi({ summary: vi.fn(async () => ok(limitReached())) }));
    await flush();
    send(staged("CONFIRMED"));
    send(base);
    expect(lineText()).toContain("2 alerts");
    expect(document.getElementById("alert-clear")).not.toBeNull();
    drop();
    expect(lineText()).toContain("1 alert:");
    expect(document.getElementById("alert-clear")).toBeNull();
  });

  it("the calculator asks the server the page was given, with what was filled in", async () => {
    const api = fakeApi();
    mount(api);
    await flush();
    send(base);
    tab("Trades");
    fireEvent.change(document.getElementById("r-entry")!, { target: { value: "100" } });
    fireEvent.change(document.getElementById("r-stop")!, { target: { value: "80" } });
    await act(async () => { fireEvent.click(document.getElementById("t-calc")!); await Promise.resolve(); });
    expect(api.risk).toHaveBeenCalledWith("entry=100&stop=80&lot=75");
    expect(document.getElementById("risk-out")?.textContent).toContain("1 lot (75 units)");
  });

  it("what was typed in the forms is kept when the tab is left and entered again", async () => {
    mount();
    await flush();
    send(base);
    tab("Trades");
    fireEvent.change(document.getElementById("t-note")!, { target: { value: "kept" } });
    fireEvent.change(document.getElementById("r-entry")!, { target: { value: "100" } });
    tab("Overview");
    expect(document.getElementById("t-note")).toBeNull();
    tab("Trades");
    expect((document.getElementById("t-note") as HTMLInputElement).value).toBe("kept");
    expect((document.getElementById("r-entry") as HTMLInputElement).value).toBe("100");
  });

  it("a Trades tab that cannot be drawn says so and keeps the header and the tabs", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broken = { ...tradesBase, trades: null } as unknown as typeof tradesBase;
    mount(fakeApi({ summary: vi.fn(async () => ok(broken)) }));
    await flush();
    send(base);
    tab("Trades");
    expect(chip("c-market")).toBe("MARKET OPEN");
    expect(screen.getByRole("tab", { name: "Overview" })).toBeTruthy();
    expect(document.getElementById("tab-trades")?.querySelector("#t-log")).toBeNull(); // (the guard replaced the tab)
    expect(document.getElementById("tab-trades")?.textContent).toContain("trades");
    log.mockRestore();
  });
});
