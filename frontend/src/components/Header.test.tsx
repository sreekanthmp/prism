import { cleanup, fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Conn } from "../connection";
import type { Snapshot } from "../types";
import { base, EVIL, variant } from "../test/helpers";
import { Header } from "./Header";

const show = (snapshot: Snapshot | null, conn: Conn = "live", tries = 0) => {
  cleanup(); // one header at a time, as on the page: the same ids in two headers make a selector find the first one's element
  const { container } = render(<Header conn={conn} snapshot={snapshot} tries={tries} mode="sound" onMode={() => undefined} />);
  const q = (sel: string) => container.querySelector(sel) as HTMLElement;
  const text = (sel: string) => q(sel)?.textContent ?? "";
  return { container, q, text, chip: (id: string) => ({ text: text(`#${id}`), kind: q(`#${id}`)?.className.replace("chip ", "") }) };
};
const ready = (state: string, isReady: boolean, preMarket = false, summary = "why") =>
  variant((s) => { s.health.readiness = { state, ready: isReady, decisions_permitted: isReady, summary, pre_market: preMarket }; });

describe("the header of a live page", () => {
  it("shows the NIFTY price, its move from the previous close and how old the tick is, on two separate clocks", () => {
    const h = show(base);
    expect(h.text("#spot")).toBe("24287.00");
    expect(h.text("#spot-chg")).toBe("▲ +37.00 (+0.15%)");
    expect(h.q("#spot-chg span")?.className).toBe("up");
    expect(h.q("#spot-chg span")?.getAttribute("title")).toBe("against the previous session's close: 24250.00 (2026-11-05)");
    expect(h.text("#spot-age")).toBe("NIFTY tick received 1 s ago · exchange time 2 s old");
    expect(h.q("#spot")?.className).toBe("spot");
  });

  it("says the system, the market, the feed and the data in four chips", () => {
    const h = show(base);
    expect(h.chip("c-market")).toEqual({ text: "MARKET OPEN", kind: "ok" });
    expect(h.chip("c-feed")).toEqual({ text: "FEED CONNECTED", kind: "ok" });
    expect(h.chip("c-data")).toEqual({ text: "DATA TRUSTED", kind: "ok" });
    expect(h.chip("c-ready")).toEqual({ text: "SYSTEM READY", kind: "ok" });
    expect(h.q("#c-ready").title).toBe("data complete and trusted");
    expect(h.container.querySelector("#c-link")).toBeNull();
  });

  it("says the last tick, the ticks and the reconnects, and the server's clock", () => {
    const h = show(base);
    expect(h.text("#hsum")).toBe(`last tick 10:55:05 · ticks ${base.connection.ticks_accepted} ok / 0 rejected · reconnects 0`);
    expect(h.text("#clock")).toBe("06/11/2026, 10:55:06 IST");
  });

  it("counts every rejected tick and every data issue", () => {
    const h = show(variant((s) => { s.connection.ticks_rejected = { malformed: 2, stale: 3 }; s.health.issues = ["a", "b"]; }));
    expect(h.text("#hsum")).toContain("/ 5 rejected");
    expect(h.text("#hsum")).toContain("· 2 data issue(s)");
  });

  it("before the open, a ready system says it is ready for the open", () => {
    expect(show(ready("READY", true, true)).chip("c-ready")).toEqual({ text: "READY FOR OPEN", kind: "ok" });
  });

  it.each([["INITIALIZING", "warn"], ["HISTORICAL_LOADING", "warn"], ["RECOVERING_GAPS", "warn"], ["DEGRADED", "warn"], ["FAILED", "bad"]])("a system that is %s is NOT READY, in %s", (state, kind) => {
    const h = show(ready(state, false, false, "the reason"));
    expect(h.chip("c-ready")).toEqual({ text: `NOT READY: ${state.replace("_", " ")}`, kind });
    expect(h.q("#c-ready").title).toBe("the reason");
  });

  it("a snapshot with no readiness says it is waiting, not that it is ready", () => {
    const h = show(variant((s) => { delete s.health.readiness; }));
    expect(h.chip("c-ready")).toEqual({ text: "WAITING", kind: "neu" });
  });

  it("a closed market is not a live one: no verdict on the data, and the price is called what it is", () => {
    const h = show(variant((s) => { s.health.live = false; }));
    expect(h.chip("c-market")).toEqual({ text: "MARKET CLOSED", kind: "neu" });
    expect(h.chip("c-data")).toEqual({ text: "DATA NOT LIVE", kind: "neu" });
    expect(h.text("#spot-age")).toBe("market closed: the last price received, not live");
  });

  it("data that is not trusted while the market is open is a red chip", () => {
    expect(show(variant((s) => { s.health.trusted = false; })).chip("c-data")).toEqual({ text: "DATA NOT TRUSTED", kind: "bad" });
  });

  it.each([["connected", "ok"], ["starting", "warn"], ["connecting", "warn"], ["disconnected", "bad"], ["auth_failed", "bad"], ["config_error", "bad"]])("a feed that is %s is %s", (state, kind) => {
    const h = show(variant((s) => { s.connection.state = state; s.health.feed.reason = "the reason"; }));
    expect(h.chip("c-feed")).toEqual({ text: `FEED ${state.replace("_", " ").toUpperCase()}`, kind });
    expect(h.q("#c-feed").title).toBe("the reason");
  });

  it("an old price never looks live: a stale tick is red and says how old it is", () => {
    const h = show(variant((s) => { const i = s.instruments.find((x) => x.role === "SPOT"); if (i) { i.status = "stale"; i.age = 30; } }));
    expect(h.q("#spot")?.className).toBe("spot stale");
    expect(h.text("#spot-age")).toContain("STALE: last NIFTY tick 30 s ago (received)");
  });

  it("an exchange time that is unknown is said to be unknown, and one that is stale says so", () => {
    const unknown = show(variant((s) => { const h = s.health.instruments.find((x) => x.role === "SPOT"); if (h) { h.exchange_status = "unknown"; h.exchange_reason = "the feed sent no exchange time"; } }));
    expect(unknown.text("#spot-age")).toBe("NIFTY tick received 1 s ago · exchange time unknown");
    expect(unknown.q("#spot-age b")?.title).toBe("the feed sent no exchange time");
    const stale = show(variant((s) => { const h = s.health.instruments.find((x) => x.role === "SPOT"); if (h) { h.exchange_status = "stale"; h.exchange_age = 90; h.exchange_reason = "older than 20 s"; } }));
    expect(stale.text("#spot-age")).toBe("NIFTY tick received 1 s ago · exchange time 90 s old: STALE");
    const none = show(variant((s) => { const h = s.health.instruments.find((x) => x.role === "SPOT"); if (h) { h.exchange_age = null; } }));
    expect(none.text("#spot-age")).toBe("NIFTY tick received 1 s ago · exchange time –");
  });

  it("no NIFTY tick yet is said, not drawn as an age of zero", () => {
    const h = show(variant((s) => { const i = s.instruments.find((x) => x.role === "SPOT"); if (i) { i.age = null; i.ltp = null; } }));
    expect(h.text("#spot-age")).toBe("no NIFTY tick yet");
    expect(h.text("#spot")).toBe("–");
    expect(h.text("#spot-chg")).toBe(""); // no price, so no move to show
  });

  it("the move from the previous close: down, level, unknown and missing", () => {
    const move = (change: unknown) => show(variant((s) => { if (s.trading?.market) s.trading.market.change = change as never; }));
    const down = move({ available: true, points: -12.5, percent: -0.05, basis: "the previous session's close", previous_close: 24300, previous_close_date: "2026-11-05" });
    expect(down.text("#spot-chg")).toBe("▼ -12.50 (-0.05%)");
    expect(down.q("#spot-chg span")?.className).toBe("down");
    expect(move({ available: true, points: 0, percent: 0, basis: "x", previous_close: 1 }).text("#spot-chg")).toBe("◆ 0.00 (0.00%)");
    const unknown = move({ available: false, why: "no previous close is stored" });
    expect(unknown.text("#spot-chg")).toBe("change unknown");
    expect(unknown.q("#spot-chg span")?.title).toBe("no previous close is stored");
    expect(move(null).text("#spot-chg")).toBe("– vs prev close");
  });

  it("says a dash for whatever the server did not know, never 0, NaN, null or undefined", () => {
    const h = show(variant((s) => {
      s.connection.last_tick_received = null;
      const i = s.instruments.find((x) => x.role === "SPOT");
      if (i) i.ltp = null;
      s.trading = null;
    }));
    const all = h.container.textContent ?? "";
    expect(h.text("#hsum")).toContain("last tick –");
    for (const bad of ["undefined", "NaN", "null", "Infinity"]) expect(all).not.toContain(bad);
  });
});

describe("the header of a stale page: the last snapshot, and no verdict on the present", () => {
  const stale = () => show(base, "stale");
  it("turns the four chips to UNKNOWN, with the reason, and shows the lost link", () => {
    const h = stale();
    for (const [id, word] of [["c-market", "MARKET"], ["c-feed", "FEED"], ["c-data", "DATA"], ["c-ready", "SYSTEM"]] as const) expect(h.chip(id)).toEqual({ text: `${word} UNKNOWN`, kind: "neu" });
    expect(h.q("#c-market").title).toBe("the dashboard has lost its link to Prism; the last snapshot was made at 10:55:06 IST");
    expect(h.chip("c-link")).toEqual({ text: "DASHBOARD LINK LOST: reconnecting", kind: "bad" });
  });

  it("says since when, and that it is not current, instead of a tick age", () => {
    const h = stale();
    expect(h.text("#spot-age")).toBe("STALE since 10:55: not current");
    expect(h.text("#hsum")).toBe("last snapshot 10:55:06 IST · not current");
    expect(h.text("#clock")).toBe("last snapshot 06/11/2026, 10:55:06 IST");
  });

  it("dims the price, mutes the move and says the move is as of the last snapshot", () => {
    const h = stale();
    expect(h.q("#spot")?.className).toBe("spot dim");
    expect(h.text("#spot")).toBe("24287.00");
    expect(h.q("#spot-chg span")?.className).toBe("mut");
    expect(h.q("#spot-chg span")?.title).toContain("as of the last snapshot");
  });

  it("says nothing that sounds like a live verdict", () => {
    const text = stale().container.textContent ?? "";
    for (const live of ["OPEN", "TRUSTED", "CONNECTED", "READY", "received", "exchange time", "fresh", "ticks"]) expect(text).not.toContain(live);
  });
});

describe("the header before the first snapshot", () => {
  it("says it is connecting and waiting, and draws no placeholder as data", () => {
    const h = show(null, "loading", 1);
    expect(h.text("#spot")).toBe("–");
    expect(h.q("#spot")?.className).toBe("spot dim");
    expect(h.text("#spot-age")).toBe("Connecting to Prism and waiting for the first snapshot.");
    expect([h.chip("c-market").text, h.chip("c-feed").text, h.chip("c-data").text, h.chip("c-ready").text]).toEqual(["CONNECTING", "FEED …", "DATA …", "WAITING"]);
    expect(h.container.querySelector("#c-link")).toBeNull();
  });

  it("says so again, with the count, when the server cannot be reached", () => {
    const h = show(null, "loading", 2);
    expect(h.text("#spot-age")).toBe("Prism cannot be reached (attempt 2): retrying every 2 s.");
    expect(h.chip("c-link").text).toBe("DASHBOARD LINK LOST: reconnecting");
    expect(show(null, "loading", 9).text("#spot-age")).toContain("attempt 9");
  });
});

describe("everything the server says is text", () => {
  it("is not parsed as markup, in a chip, a title or the price line", () => {
    const h = show(variant((s) => {
      s.health.feed.reason = EVIL;
      s.health.readiness = { state: "DEGRADED", ready: false, decisions_permitted: false, summary: EVIL, pre_market: false };
      s.connection.state = EVIL;
      const x = s.health.instruments.find((i) => i.role === "SPOT");
      if (x) { x.exchange_status = "unknown"; x.exchange_reason = EVIL; }
      if (s.trading?.market) s.trading.market.change = { available: false, why: EVIL };
    }));
    expect(h.container.querySelector("img")).toBeNull();
    expect(h.container.innerHTML).not.toContain("<img");
    expect(h.q("#c-ready").title).toBe(EVIL); // kept as the literal text
    expect(h.text("#c-feed")).toContain(EVIL.toUpperCase().replace(/_/g, " "));
  });
});

describe("the alert mode button", () => {
  const button = (mode: "sound + popup" | "sound" | "off", snapshot: Snapshot | null = base, conn: Conn = "live", onMode = () => undefined) => {
    cleanup();
    const { container } = render(<Header conn={conn} snapshot={snapshot} tries={0} mode={mode} onMode={onMode} />);
    return container.querySelector("#alert-mode") as HTMLButtonElement;
  };

  it("says the mode, with the bell, and what the alerts are for", () => {
    const b = button("sound");
    expect(b.textContent).toBe("🔔 sound");
    expect(b.className).toBe("alertmode");
    expect(b.type).toBe("button");
    expect(b.title).toBe("Alerts: a sound (and a popup) when a setup becomes ready or stops being ready, or when Prism is not ready or the feed is lost. Click to change.");
  });

  it("is dimmed when the alerts are off", () => {
    expect(button("off").className).toBe("alertmode off");
    expect(button("off").textContent).toBe("🔔 off");
    expect(button("sound + popup").textContent).toBe("🔔 sound + popup");
    expect(button("sound + popup").className).toBe("alertmode");
  });

  it("is there before the first snapshot, in a live header and in a stale one, between the summary and the clock", () => {
    for (const [snapshot, conn] of [[null, "loading"], [base, "live"], [base, "stale"]] as const) {
      const b = button("sound", snapshot, conn);
      expect(b, conn).not.toBeNull();
      expect(b.previousElementSibling?.id, conn).toBe("hsum");
      expect(b.nextElementSibling?.id, conn).toBe("clock");
    }
  });

  it("a click asks to change the mode", () => {
    let clicked = 0;
    fireEvent.click(button("sound", base, "live", () => { clicked++; }));
    expect(clicked).toBe(1);
  });
});
