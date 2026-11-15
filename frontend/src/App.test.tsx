import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { RECONNECT_MS, SILENT_MS } from "./connection";
import { base, EVIL, FakeSocket, fakeApi, fakeFactory, variant } from "./test/helpers";

const URL = "ws://prism.test/ws";
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const send = (data: unknown) => act(() => { FakeSocket.last.send(data); });
const drop = () => act(() => { FakeSocket.last.drop(); });
const mount = () => render(<App url={URL} createSocket={fakeFactory} api={fakeApi()} />);
const chip = (id: string) => document.getElementById(id)?.textContent;
const notReady = (summary = "recovering missing candles") =>
  variant((s) => { s.health.readiness = { state: "RECOVERING_GAPS", ready: false, decisions_permitted: false, summary, pre_market: false }; });

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.reset();
});
afterEach(() => vi.useRealTimers());

describe("the dashboard", () => {
  it("is loading before the first snapshot: it says so, shows no data and makes no claim", () => {
    mount();
    expect(chip("c-market")).toBe("CONNECTING");
    expect(document.getElementById("spot")?.textContent).toBe("–");
    expect(document.getElementById("decision")?.textContent).toBe("LOADING — Connecting to Prism and waiting for the first snapshot. No decision is available yet; nothing on this page is a decision.");
    expect(document.getElementById("ctx")?.textContent).toBe("waiting for data");
    expect(document.querySelector("[data-testid=alert-line]")).toBeNull();
    expect(document.querySelector(".stalebar")).toBeNull();
  });

  it("is live with the first snapshot: the header says what the snapshot says", () => {
    mount();
    send(base);
    expect(chip("c-market")).toBe("MARKET OPEN");
    expect(chip("c-ready")).toBe("SYSTEM READY");
    expect(document.getElementById("spot")?.textContent).toBe("24287.00");
    expect(document.querySelector("[data-testid=alert-line]")).toBeNull(); // a ready system has nothing to alert
    expect(document.querySelector(".stalebar")).toBeNull();
    expect(document.getElementById("main")?.className).toBe("");
  });

  it("puts a system that is not ready on the one alert line", () => {
    mount();
    send(notReady());
    const line = screen.getByTestId("alert-line");
    expect(line.querySelector("summary")?.textContent).toBe("⚠ 1 alert: NOT READY · RECOVERING GAPS ▾ details");
    expect(chip("c-ready")).toBe("NOT READY: RECOVERING GAPS");
    send(base); // ready again: the line is gone
    expect(document.querySelector("[data-testid=alert-line]")).toBeNull();
  });

  it("when the link is lost it is STALE: the last snapshot, dimmed, no verdict, not actionable", () => {
    mount();
    send(base);
    drop();
    expect(document.querySelector(".stalebar")?.textContent).toContain("STALE since 10:55 — NOT ACTIONABLE");
    expect(document.getElementById("main")?.className).toBe("staled");
    expect(["c-market", "c-feed", "c-data", "c-ready"].map(chip)).toEqual(["MARKET UNKNOWN", "FEED UNKNOWN", "DATA UNKNOWN", "SYSTEM UNKNOWN"]);
    expect(document.getElementById("spot")?.textContent).toBe("24287.00"); // the last price stays, dimmed, for inspection
    expect(document.getElementById("spot")?.className).toBe("spot dim");
    expect(chip("c-link")).toBe("DASHBOARD LINK LOST: reconnecting");
  });

  it("a stale page makes no alert about the present, even when the last snapshot had some", () => {
    mount();
    send(notReady());
    expect(screen.getByTestId("alert-line")).toBeTruthy();
    drop();
    expect(document.querySelector("[data-testid=alert-line]")).toBeNull();
  });

  it("is stale when the link goes silent too, and live again with the next snapshot, drawn from that alone", () => {
    mount();
    send(base);
    advance(SILENT_MS);
    expect(document.querySelector(".stalebar")).not.toBeNull();
    send(variant((s) => {
      const i = s.instruments.find((x) => x.role === "SPOT");
      if (i) i.ltp = 24301.5;
      s.health.trusted = false;
      s.server_time += 120;
    }));
    expect(document.querySelector(".stalebar")).toBeNull();
    expect(document.getElementById("main")?.className).toBe("");
    expect(document.getElementById("spot")?.textContent).toBe("24301.50");
    expect(chip("c-data")).toBe("DATA NOT TRUSTED"); // not the old snapshot's "trusted"
    expect(chip("c-link")).toBeUndefined();
  });

  it("recovers from a dropped link by reconnecting once, after the pause", () => {
    mount();
    send(base);
    drop();
    advance(RECONNECT_MS);
    expect(FakeSocket.all).toHaveLength(2);
    send(variant((s) => { s.server_time += 5; }));
    expect(chip("c-market")).toBe("MARKET OPEN");
    expect(FakeSocket.all).toHaveLength(2);
  });

  it("uses one socket for its whole life, whichever tab is open", () => {
    mount();
    send(base);
    for (const name of ["Chart", "Options", "Analysis", "Journal", "Trades", "Overview"]) {
      act(() => screen.getByRole("tab", { name }).click());
      send(base);
    }
    expect(FakeSocket.all).toHaveLength(1);
  });

  it("shows one panel at a time, and every tab is built: no placeholder is left", () => {
    mount();
    send(base);
    const panels = [...document.querySelectorAll<HTMLElement>("section.tab")];
    expect(panels).toHaveLength(6);
    expect(panels.filter((p) => !p.hidden).map((p) => p.id)).toEqual(["tab-overview"]);
    for (const [name, id] of [["Chart", "tab-chart"], ["Options", "tab-options"], ["Analysis", "tab-analysis"], ["Journal", "tab-journal"], ["Trades", "tab-trades"]] as const) {
      act(() => screen.getByRole("tab", { name }).click());
      expect(panels.filter((p) => !p.hidden).map((p) => p.id)).toEqual([id]);
      expect(document.querySelector("[data-testid=placeholder]")).toBeNull();
    }
    expect(document.getElementById("trades-body")).not.toBeNull(); // the last one opened is the Trades tab: its forms and its notebook
    expect(document.getElementById("t-log")?.textContent).toBe("Log trade");
  });

  it("shows what a server says as text", () => {
    mount();
    send(notReady(EVIL));
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByTestId("alert-line").textContent).toContain(EVIL);
  });

  it("keeps working when a snapshot lacks what the later tabs will need", () => {
    mount();
    send(variant((s) => { s.trading = null; delete s.health.readiness; }));
    expect(chip("c-ready")).toBe("WAITING");
    expect(document.getElementById("spot")?.textContent).toBe("24287.00");
  });
});
