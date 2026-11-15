import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { base, EVIL, FakeSocket, fakeFactory, variant } from "../test/helpers";
import type { Setup, Snapshot } from "../types";
import { NOTE, NOTE_WHY } from "../labels";
import { Overview } from "./Overview";
import { TABS } from "./Tabs";

// The current dashboard's Overview and this one are compared in a real browser, in each of the 14 pinned states (tests/test_overview_browser.py). These tests are the branches one by one, on the real
// snapshot of the engine (tests/make_frontend_fixture.py): a BUY CE at 10:55 on 06 Nov 2026, with its trigger, entry area, invalidation and one target.
const text = (id: string) => document.getElementById(id)?.textContent ?? null;
const el = (id: string) => document.getElementById(id) as HTMLElement;
const show = (s: Snapshot | null, props: { tries?: number; stale?: boolean; onGoto?: (t: string, strategy?: string) => void } = {}) => {
  cleanup();
  const onGoto = props.onGoto ?? vi.fn();
  render(<Overview snapshot={s} tries={props.tries ?? 0} stale={props.stale ?? false} onGoto={onGoto as never} />);
  return onGoto;
};
const t = (s: Snapshot) => s.trading!;
const copy = (over: Partial<Setup>, s: Snapshot) => ({ ...structuredClone(t(s).setups[0]!), ...over });

describe("before there is a decision", () => {
  it("says it is loading, says why, and says no panel is a decision", () => {
    show(null);
    expect(el("decision").className).toBe("decision loading");
    expect(text("decision")).toBe("LOADING — Connecting to Prism and waiting for the first snapshot. No decision is available yet; nothing on this page is a decision.");
    for (const id of ["tfrow", "ctx", "setup", "strat", "rg", "dhs", "ev3"]) expect(text(id)).toBe("waiting for data");
    expect(document.getElementById("howto")).toBeNull();
  });
  it("says the page cannot reach Prism from the second try on", () => {
    show(null, { tries: 1 });
    expect(text("decision")).toContain("Connecting to Prism and waiting for the first snapshot.");
    show(null, { tries: 3 });
    expect(text("decision")).toContain("Prism cannot be reached (attempt 3): retrying every 2 s.");
    expect(text("decision")).not.toContain("Connecting");
  });
  it("says so when the snapshot has no decision, and still offers the how-to", () => {
    show(variant((s) => { s.trading = null; }));
    expect(text("decision")).toBe("Trading decision not available yet.");
    expect(el("howto")).toBeTruthy();
  });
});

describe("the decision", () => {
  it("is CE SETUP in green, with who made it, and says the entry is eligible", () => {
    show(base);
    expect(el("decision").className).toBe("decision buy-ce");
    expect(el("decision").querySelector(".dtxt")?.textContent).toBe("CE SETUP");
    expect(el("decision").querySelector(".dsub")?.textContent).toBe("morning · entries allowed");
    expect(el("decision").querySelector(".dhead")?.textContent).toBe("CE setup ready: Trend Pullback setup confirmed");
    expect(el("decision").querySelector(".dblock")).toBeNull(); // nothing blocks entry
    const did = el("decision").querySelector(".did")!;
    expect(did.textContent).toBe("StrategyTrend PullbackStrategy IDtrend_pullbackSetup IDtrend_pullback:bull:1793940000Agreesnone");
    expect([...did.querySelectorAll("code")].map((c) => c.title)).toEqual(["trend_pullback", "trend_pullback:bull:1793940000"]);
    expect(el("decision").querySelector(".go > span")?.textContent).toBe("Entry eligible (actionable now)");
    expect(el("decision").querySelector(".go > span b")?.className).toBe("up");
  });

  it.each([["BUY PE", "buy-pe", "PE SETUP"], ["WAIT", "wait", "WAIT"], ["NO TRADE", "no-trade", "NO TRADE"], ["SOMETHING NEW", "no-trade", "SOMETHING NEW"]])("%s has the colour %s and is said as %s", (action, klass, word) => {
    show(variant((s) => { t(s).decision.action = action; }));
    expect(el("decision").className).toBe(`decision ${klass}`);
    expect(el("decision").querySelector(".dtxt")?.textContent).toBe(word);
  });

  it("says 'not eligible' in amber when the setup cannot be entered", () => {
    show(variant((s) => { t(s).explain!.actionable = false; }));
    expect(el("decision").querySelector(".go > span")?.textContent).toBe("Entry not eligible");
    expect(el("decision").querySelector(".go > span b")?.className).toBe("flat");
    show(variant((s) => { t(s).explain = null; }));
    expect(el("decision").querySelector(".go > span")?.textContent).toBe("Entry not eligible"); // no explanation: not eligible, never assumed eligible
  });

  it("says what blocks entry: the first two reasons, leaving out one the headline already says", () => {
    show(variant((s) => { t(s).decision.headline = "WAIT: setup blocked"; t(s).explain!.blocking = ["only 18.0 pts to the next level", "volatility is too high", "a third one", "setup blocked"]; }));
    const b = el("decision").querySelector(".dblock")!;
    expect(b.textContent).toBe("⏸ Blocks entry: only 18.0 pts to the next level · volatility is too high");
    expect(b.getAttribute("title")).toBe("only 18.0 pts to the next level · volatility is too high");
    show(variant((s) => { t(s).decision.headline = "WAIT: only 18.0 pts to the next level"; t(s).explain!.blocking = ["only 18.0 pts to the next level"]; }));
    expect(el("decision").querySelector(".dblock")).toBeNull(); // (the headline already says it)
  });

  it("says the session phase in words, and 'no new entries' when there are none", () => {
    show(variant((s) => { t(s).session!.phase = "late_session"; t(s).session!.entries_allowed = false; }));
    expect(el("decision").querySelector(".dsub")?.textContent).toBe("late session · no new entries");
    show(variant((s) => { t(s).session = null; }));
    expect(el("decision").querySelector(".dsub")?.textContent).toBe("–");
  });

  it("names the strategies that agree, and a decision with no strategy or setup says so with dashes", () => {
    show(variant((s) => { t(s).decision.also = ["Breakout and Retest", "Range Bounce"]; }));
    const agrees = el("decision").querySelector(".did b[title]:not(code)")!;
    expect(agrees.textContent).toBe("Breakout and Retest, Range Bounce");
    expect(agrees.getAttribute("title")).toBe("Breakout and Retest · Range Bounce");
    show(variant((s) => { Object.assign(t(s).decision, { strategy: null, strategy_name: null, setup_id: null }); }));
    expect(el("decision").querySelector(".did")?.textContent).toBe("StrategynoneStrategy ID–Setup ID–Agreesnone");
    expect(el("decision").querySelectorAll("code")).toHaveLength(0);
  });

  it("is STALE on a page that lost its link: the last decision as history, not as a decision, and nothing eligible", () => {
    show(base, { stale: true });
    expect(el("decision").className).toBe("decision stale");
    expect(el("decision").querySelector(".dtxt")?.textContent).toBe("STALE");
    expect(el("decision").querySelector(".dsub")?.textContent).toBe("last decision: CE SETUP");
    expect(el("decision").querySelector(".dhead")?.textContent).toBe("STALE since 10:55 — NOT ACTIONABLE");
    expect(el("decision").querySelector(".dblock")?.textContent).toBe("Last known, not current: CE setup ready: Trend Pullback setup confirmed");
    expect(el("decision").querySelector(".go > span")?.textContent).toBe("Entry not eligible: STALE");
    expect(el("decision").querySelector(".popbody .warnbox")?.textContent).toBe("The last snapshot (made 10:55:06 IST): not a current decision.");
    expect(document.body.textContent).not.toContain("eligible (actionable now)");
    expect(document.body.textContent).not.toContain("READY: in the entry area");
    expect(text("setup")).toContain("was in the entry area (not current)");
    expect(text("strat")).toContain("was ready");
    expect(text("setup")).toContain("last known: ");
    expect(text("dhs")).toBe("Data healthunknown: the page lost its link to Prism (last snapshot 10:55:06 IST); nothing here is current" + "Feedunknown" + "NIFTY spotunknown" + "Candlesunknown" + "Clockunknown");
  });
});

describe("the explanation", () => {
  const pop = () => el("decision").querySelector(".popbody")!;
  it("is a plain-words account of the setup, the reasons for and against, and the plan", () => {
    show(base);
    expect(el("decision").querySelector("details.pop > summary")?.textContent).toBe("Explain this decision ▾");
    const body = pop().textContent!;
    expect(body).toContain("A decision is what the rules say about the NIFTY index; it is not a recommendation to trade. It uses completed candles only; a forming candle never confirms a setup.");
    expect(body).toContain("In plain words (about the setup this decision refers to)");
    expect(body).toContain("What happened: detected 10:40 · the confirming 5M candle completed 10:55 and closed beyond 24,281.00");
    expect(body).toContain("What is happening now: confirmed, price is in the entry area and nothing blocks entry · price 24,287.00 is inside the entry area 24,281.00-24,287.06");
    expect(body).toContain("What has to happen next: the entry area is 24,281.00-24,287.06 while price holds 24,270.48; beyond the area it is chasing");
    expect(body).toContain("What ends it: a completed 5M candle closing below 24,270.48 ends this setup (other rules in the setup card)");
    expect(body).not.toContain("What blocks entry:"); // (nothing does: the line is not drawn)
    expect(body).toContain("Timeframes: 1H bullish, 15M bullish, 5M bullish, 1M bullish agree · none disagree · none neutral (only the 1H and 15M decide whether a side is allowed; 5M and 1M are information)");
    expect(body).toContain("+ 1H bullish (ADX 100.0); 15M bullish with HH_HL structure");
    expect(body).toContain("− 15M RSI 73.9: momentum is already stretched in this direction");
    expect(body).toContain("Setup expiry and invalidation");
    expect(body).toContain("To confirm: ");
    expect(body).toContain("Invalidation 24270.48 · a completed 5M candle closing below 24,270.48 ends this setup");
    expect(body).toContain("Underlying plan, index points from the trigger 24281.00: risk 10.5 pts · T1 24308.00 (prior high (where this pullback started)) +27.0 pts = 2.57× the risk (only one level was detected beyond the trigger, so there is no second target) — index points, not option premium");
  });
  it("is closed until it is opened, and says 'no live setup' with no setup", () => {
    show(variant((s) => { t(s).setups = []; t(s).decision.setup_id = null; t(s).explain!.setup = null; t(s).explain!.invalidation = null; }));
    expect((el("decision").querySelector("details.pop") as HTMLDetailsElement).open).toBe(false);
    expect(pop().textContent).toContain("In plain words (no live setup)");
    expect(pop().textContent).not.toContain("Setup expiry and invalidation");
    expect(pop().textContent).not.toContain("What ends it:"); // (nothing does: the line is not drawn)
  });
  it("has no account at all when the engine gave none, and does not claim candles were used when the analysis is not available", () => {
    show(variant((s) => { t(s).explain = null; t(s).available = false; }));
    expect(pop().querySelector(".card")).toBeNull();
    expect(pop().textContent).toContain("it is not a recommendation to trade. ");
    expect(pop().textContent).not.toContain("completed candles only");
  });
  it("lists what blocks entry, and the 'also matches' line", () => {
    show(variant((s) => { t(s).explain!.blocking = ["room is short", "volatility"]; t(s).decision.also = ["Range Bounce"]; }));
    expect(pop().textContent).toContain("What blocks entry: room is short · volatility");
    expect(pop().textContent).toContain("also matches: Range Bounce");
  });
  it("a plan with no target says why, and has no ' · ' before it", () => {
    show(variant((s) => { const p = t(s).setups[0]!.plan as { targets: unknown[]; note: string }; p.targets = []; p.note = "no level was detected beyond the trigger"; }));
    expect(pop().textContent).toContain("risk 10.5 pts (no level was detected beyond the trigger) — index points, not option premium");
    expect(pop().textContent).not.toContain("risk 10.5 pts ·");
  });
  it("two targets are told one after the other, and an unknown reward is a dash", () => {
    show(variant((s) => { const p = t(s).setups[0]!.plan as { targets: { n: number; price: number; label: string; distance: number; reward_risk: number | null }[]; note: string }; p.targets.push({ n: 2, price: 24340, label: "level", distance: 59, reward_risk: null }); p.note = ""; }));
    expect(pop().textContent).toContain("risk 10.5 pts · T1 24308.00 (prior high (where this pullback started)) +27.0 pts = 2.57× the risk · T2 24340.00 (level) +59.0 pts = –× the risk — index points, not option premium");
  });
  it("a setup with no plan has no plan line", () => {
    show(variant((s) => { t(s).setups[0]!.plan = {}; }));
    expect(pop().textContent).not.toContain("Underlying plan");
  });
});

describe("the four timeframes", () => {
  it("says each one's trend, ADX, RSI and structure, and which decide the side", () => {
    show(base);
    const row = el("tfrow");
    expect(row.querySelector(".tfgrp.gate .tfcap")?.textContent).toBe("Decides the allowed side");
    expect(row.querySelector(".tfgrp.info .tfcap")?.textContent).toBe("Information only");
    expect([...row.querySelectorAll(".tf")].map((x) => x.textContent)).toEqual([
      "1H▲ bullishADX 100.0 · RSI 96.8 · –", // (the 1H has too few swings to say a structure)
      "15M▲ bullishADX 70.7 · RSI 73.9 · HH·HL",
      "5M▲ bullishADX 47.7 · RSI 60.9 · HH·HL",
      "1M▲ bullishADX 35.7 · RSI 52.5 · HH·HL",
    ]);
    expect(row.querySelector(".tfgrp.gate")?.getAttribute("title")).toBe("only the 1H and 15M decide whether a side is allowed; 5M and 1M are information");
    expect(row.querySelector(".tfal b")?.textContent).toBe("aligned bullish");
    expect(row.querySelector(".tfal b")?.className).toBe("up");
    expect(row.querySelector(".tfal small")?.textContent).toBe("1H and 15M are both bullish: higher-timeframe bullish alignment (trend continuation).");
  });
  it("is red for a bearish trend, and says a timeframe is warming up when it is", () => {
    show(variant((s) => { s.analysis!.timeframes!["5m"]!.trend = "bearish"; s.analysis!.timeframes!["1m"]!.warm = false; s.analysis!.timeframes!["1m"]!.trend = "sideways"; }));
    const tfs = [...el("tfrow").querySelectorAll(".tf")];
    expect(tfs[2]?.textContent).toBe("5M▼ bearishADX 47.7 · RSI 60.9 · HH·HL");
    expect(tfs[2]?.querySelector("b")?.className).toBe("down");
    expect(tfs[3]?.textContent).toBe("1M◆ sidewaysADX 35.7 · RSI 52.5 · HH·HL · warming up");
    expect(tfs[3]?.querySelector("b")?.className).toBe("neu");
  });
  it("colours the alignment: aligned green, conflicting amber, anything else grey", () => {
    for (const [label, klass] of [["aligned_bearish", "up"], ["conflicting", "flat"], ["mixed", "neu"]] as const) {
      show(variant((s) => { s.analysis!.condition!.alignment = { label, text: "words" }; }));
      expect(el("tfrow").querySelector(".tfal b")?.className).toBe(klass);
      expect(el("tfrow").querySelector(".tfal b")?.textContent).toBe(label.replace("_", " "));
    }
  });
  it("trusts the analysis's own word that it is not available, whatever else it carries", () => {
    show(variant((s) => { s.analysis!.available = false; }));
    expect([...el("tfrow").querySelectorAll(".tf")].map((x) => x.textContent)).toEqual(["1H–not available", "15M–not available", "5M–not available", "1M–not available"]);
    expect(el("tfrow").querySelector(".tfal b")?.textContent).toBe("–");
    show(variant((s) => { s.analysis!.available = false; s.analysis!.levels = { support: [{ price: 24200, touches: 3 }], resistance: [{ price: 24400, touches: 2 }] }; }));
    expect([...el("ctx").children].slice(6).map((d) => d.textContent)).toEqual(["Support–", "Resistance–", "Prev day H / L / C–"]);
  });
  it("says 'not available' for every timeframe when the analysis is not", () => {
    show(variant((s) => { s.analysis = { available: false }; }));
    expect([...el("tfrow").querySelectorAll(".tf")].map((x) => x.textContent)).toEqual(["1H–not available", "15M–not available", "5M–not available", "1M–not available"]);
    expect(el("tfrow").querySelector(".tfal b")?.textContent).toBe("–");
    expect(el("tfrow").querySelector(".tfal small")?.textContent).toBe("only the 1H and 15M decide which side is allowed; 5M and 1M are information");
    show(variant((s) => { delete s.analysis; }));
    expect(el("tfrow").querySelectorAll(".tf b.neu")).toHaveLength(4);
  });
});

describe("market context", () => {
  it("says the market, the volatility, the ATRs, the opening range, the gap and the previous day", () => {
    show(base);
    const rows = [...el("ctx").children].map((d) => d.textContent);
    expect(rows).toEqual([
      "Market direction▲ bullish", "Conditiontrend up", "Volatilitynormal", "ATR 5M · 15M6.1 · 13.2", "Opening range24249.50–24264.50", "Open vs prev close+0 pts (0.00%)",
      "Support–", "Resistance–", "Prev day H / L / C24270.55 / 24080.25 / 24250.00",
    ]);
    expect(el("ctx").querySelector("b")?.className).toBe("up");
  });
  it("lists the two nearest support and resistance levels, green and red", () => {
    show(variant((s) => { s.analysis!.levels = { support: [{ price: 24200, touches: 3 }, { price: 24150, touches: 2 }, { price: 24100, touches: 2 }], resistance: [{ price: 24400.5, touches: 4 }] }; }));
    const rows = [...el("ctx").children];
    expect(rows[6]?.textContent).toBe("Support24200.00 / 24150.00");
    expect(rows[6]?.querySelector("span.up")).not.toBeNull();
    expect(rows[7]?.textContent).toBe("Resistance24400.50");
    expect(rows[7]?.querySelector("span.down")).not.toBeNull();
  });
  it("says a previous day that was not refreshed is stale, in amber, and the opening range is forming", () => {
    show(variant((s) => { s.analysis!.reference!.previous_day!.stale = true; t(s).session!.opening_range!.complete = false; }));
    const pd = [...el("ctx").children][8]!;
    expect(pd.textContent).toBe("Prev day H / L / C24270.55 / 24080.25 / 24250.00 (stale)");
    expect(pd.querySelector("b")?.className).toBe("flat");
    expect(pd.querySelector("b")?.getAttribute("title")).toBe("previous day high / low / close (stale: not refreshed for today)");
    expect([...el("ctx").children][4]?.textContent).toBe("Opening range24249.50–24264.50 (forming)");
  });
  it("gives a gap its sign and no decimals on the points", () => {
    show(variant((s) => { t(s).market!.gap = { points: -37.4, percent: -0.154 }; }));
    expect([...el("ctx").children][5]?.textContent).toBe("Open vs prev close-37 pts (-0.15%)");
    show(variant((s) => { t(s).market!.gap = { points: 12.6, percent: 0.05 }; }));
    expect([...el("ctx").children][5]?.textContent).toBe("Open vs prev close+13 pts (0.05%)");
  });
  it("shows a dash for everything it does not know, never a zero", () => {
    show(variant((s) => { t(s).market = null; t(s).session = null; delete s.analysis; }));
    expect([...el("ctx").children].map((d) => d.textContent)).toEqual([
      "Market direction–", "Condition–", "Volatility–", "ATR 5M · 15M–", "Opening range–", "Open vs prev close–", "Support–", "Resistance–", "Prev day H / L / C–",
    ]);
  });
  it("gives a tooltip only where there is something to say", () => {
    show(variant((s) => { t(s).market!.text = ""; }));
    const b = (i: number) => el("ctx").children[i]!.querySelector("b")!;
    expect(b(0).getAttribute("title")).toBe("the direction of the market as a whole, from the 1H and 15M");
    expect(b(1).hasAttribute("title")).toBe(false);
    expect(b(2).hasAttribute("title")).toBe(false);
  });
});

describe("the current setup", () => {
  it("says the side, the stage, when it was detected and confirmed, the three prices and what ends it", () => {
    show(base);
    expect([...el("setup").children].map((d) => d.textContent)).toEqual([
      "Setup side▲ CE (call)", "StageREADY: in the entry area", "Detected · confirmed10:40 · 10:55", "Trigger24281.00", "Entry zone24281.00 – 24287.06", "Invalidation24270.48",
      "Expiry · what ends it (Prism's own wording)confirmed, price is in the entry area and nothing blocks entry · the entry area is 24,281.00-24,287.06 while price holds 24,270.48; beyond the area it is chasing · a completed 5M candle closing below 24,270.48 ends this setup (other rules in the setup card)",
    ]);
    expect(el("setup").children[0]?.querySelector("b")?.className).toBe("up");
    expect(el("setup").children[2]?.querySelector("b")?.className).toBe("up"); // confirmed
    expect(el("setup-h").textContent).toBe("Current setup");
  });
  it("says a put is a put, and a setup not yet confirmed has 'not yet' in amber", () => {
    show(variant((s) => { Object.assign(t(s).setups[0]!, { direction: "PE", confirmed_at: null, stage: "WAITING_FOR_CONFIRMATION", status: "WAITING_FOR_CONFIRMATION" }); }));
    expect(el("setup").children[0]?.textContent).toBe("Setup side▼ PE (put)");
    expect(el("setup").children[0]?.querySelector("b")?.className).toBe("down");
    expect(el("setup").children[1]?.textContent).toBe("Stagewaiting for a confirming candle");
    expect(el("setup").children[2]?.textContent).toBe("Detected · confirmed10:40 · not yet");
    expect(el("setup").children[2]?.querySelector("b")?.className).toBe("flat");
  });
  it("names the strategy in the heading only when the decision names none", () => {
    show(variant((s) => { t(s).decision.strategy = null; }));
    expect(el("setup-h").textContent).toBe("Current setup Trend Pullback (the decision names no strategy)");
    expect(el("setup-h").querySelector("span")?.getAttribute("title")).toBe("trend_pullback:bull:1793940000");
  });
  it("says 'no live setup', and whether earlier events exist", () => {
    show(variant((s) => { t(s).setups = []; t(s).decision.setup_id = null; t(s).explain = null; }));
    expect(text("setup")).toBe("No live setup. Setup events earlier today: see Recent events and the Journal.");
    show(variant((s) => { t(s).setups = []; t(s).events = []; t(s).recent = []; t(s).decision.setup_id = null; t(s).explain = null; }));
    expect(text("setup")).toBe("No live setup. None has been announced today.");
    show(variant((s) => { t(s).setups = []; t(s).events = []; t(s).recent = [copy({}, base)]; t(s).decision.setup_id = null; t(s).explain = null; }));
    expect(text("setup")).toContain("Setup events earlier today");
  });
  it("says what ends a setup that the explanation is not about with the stage text alone", () => {
    show(variant((s) => { t(s).explain!.setup = "another:setup:1"; }));
    expect(el("setup").querySelector(".wide b")?.textContent).toBe("confirmed, price is in the entry area and nothing blocks entry");
  });
});

describe("the strategy monitor", () => {
  it("has a row for the strategy with a live setup, and the other nine in one closed line", () => {
    show(base);
    const rows = [...el("strat").querySelectorAll(":scope > table.strat tr")];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toBe("Trend PullbackCEreadyconfirmed, price is in the entry area and nothing blocks entrydetail →");
    expect(rows[0]?.querySelector("td")?.getAttribute("title")).toBe("trend_pullback · trend_pullback:bull:1793940000");
    expect(rows[0]?.querySelector("td.dir")?.className).toBe("dir up");
    expect(rows[0]?.querySelector("td.dir")?.getAttribute("title")).toBe("call");
    const more = el("strat").querySelector("details.more") as HTMLDetailsElement;
    expect(more.open).toBe(false);
    expect(more.querySelector("summary")?.textContent).toBe("9 without a setup: 7 watching, 2 not suited to the market");
    const idle = [...more.querySelectorAll("tr")].map((r) => r.textContent);
    expect(idle).toHaveLength(9);
    expect(idle[0]).toBe("Breakout and RetestCE no setup PE inactivedetail →");
    expect(idle[1]).toBe("Range ReversalCE inactive PE inactivedetail →");
    expect(more.querySelectorAll(".pillst.mut").length).toBeGreaterThan(5); // the sides that do not apply are grey
  });
  it("goes to the Analysis tab for a strategy, and for all of them", () => {
    const go = show(base);
    fireEvent.click(screen.getAllByRole("button", { name: "detail →" })[0]!);
    expect(go).toHaveBeenLastCalledWith("analysis", "trend_pullback");
    fireEvent.click(screen.getAllByRole("button", { name: "detail →" })[1]!);
    expect(go).toHaveBeenLastCalledWith("analysis", "breakout_retest");
    fireEvent.click(screen.getByRole("button", { name: "All ten strategies →" }));
    expect(go).toHaveBeenLastCalledWith("analysis", "");
  });
  it("lists the decision's setup first, and says when a call and a put are both live", () => {
    const s = variant((x) => {
      t(x).setups.unshift(copy({ id: "range_bounce:bear:9", strategy: "range_bounce", strategy_name: "Range Bounce", direction: "PE", status: "WAITING_FOR_CONFIRMATION", stage: "WAITING_FOR_CONFIRMATION", blockers: ["only 18.0 pts to the next level"] }, base));
    });
    show(s);
    const rows = [...el("strat").querySelectorAll(":scope > table.strat tr")];
    expect(rows.map((r) => r.querySelector("td")?.textContent)).toEqual(["Trend Pullback", "Range Bounce"]);
    expect(rows[1]?.textContent).toBe("Range BouncePEwaitingonly 18.0 pts to the next leveldetail →");
    expect(rows[1]?.querySelector("td.dir")?.className).toBe("dir down");
    expect(el("strat").querySelector(".conf")?.textContent).toBe("⚠ a call and a put setup are both live (CE Trend Pullback, PE Range Bounce): neither is taken");
  });
  it("shows two conflicts and counts the rest", () => {
    show(variant((x) => { t(x).decision.against = ["ignored a: one", "ignored b: two", "ignored c: three", "ignored d: four"]; }));
    expect([...el("strat").querySelectorAll(".conf")].map((c) => c.textContent)).toEqual(["⚠ ignored a: one", "⚠ ignored b: two", "⚠ +2 more: see the decision's reasons"]);
    expect(el("strat").querySelector(".conf")?.getAttribute("title")).toBe("ignored a: one");
  });
  it("says so when no strategy has a setup, and when there is no strategy data at all", () => {
    show(variant((x) => { t(x).setups = []; for (const z of t(x).strategies) z.setups = []; }));
    expect(el("strat").textContent).toContain("No strategy has a live setup.");
    expect(el("strat").querySelector("details.more summary")?.textContent).toBe("10 without a setup: 8 watching, 2 not suited to the market");
    show(variant((x) => { t(x).strategies = []; t(x).setups = []; }));
    expect(text("strat")).toBe("no strategy data");
  });
  it("has no 'without a setup' line when every strategy has one", () => {
    show(variant((x) => { for (const z of t(x).strategies) z.setups = ["x"]; }));
    expect(el("strat").querySelector("details.more")).toBeNull();
  });
});

describe("the regime", () => {
  it("shows all six facts, each as it is", () => {
    show(base);
    expect([...el("rg").querySelectorAll(".rgc")].map((c) => [c.className, c.textContent])).toEqual([
      ["rgc up", "Strong trendbullish"], ["rgc mut", "Weakening trendnone"], ["rgc mut", "Compressionnone"], ["rgc mut", "Expansionnone"], ["rgc mut", "Extensionnone"], ["rgc flat", "Range / pause / pullbackpullback"],
    ]);
    expect(el("rg").querySelector(".rgc")?.getAttribute("title")).toMatch(/^Strong trend: bullish — /);
    expect(el("rg").querySelector(".rgnote")?.textContent).toBe("Counter-trend permission: PE denied denied: weakening continuation (regime fact: 0 of 6 weakening checks hold (needs 2))");
    expect(el("rg").querySelector(".rgnote")?.getAttribute("title")).toBe("PE: denied: weakening continuation (regime fact: 0 of 6 weakening checks hold (needs 2))");
    expect(el("rg").querySelector(".rgnote b.flat")?.textContent).toBe("denied");
  });
  it("says a granted permission in green, and says nothing of one that is not needed", () => {
    show(variant((x) => { t(x).counter_trend = [{ needed: true, granted: true, reason: "an established trend", side: "PE" }, { needed: true, granted: false, reason: "no structure", side: "CE" }, { needed: false, granted: false, reason: "not needed", side: "CE" }]; }));
    const note = el("rg").querySelector(".rgnote")!;
    expect(note.textContent).toBe("Counter-trend permission: PE granted an established trend · CE denied no structure");
    expect(note.querySelector("b.up")?.textContent).toBe("granted");
    show(variant((x) => { t(x).counter_trend = [{ needed: false, granted: false, reason: "not needed", side: "CE" }]; }));
    expect(el("rg").querySelector(".rgnote")).toBeNull();
  });
  it("says every fact is unknown, once, when the regime layer cannot be trusted, and shows none of what it carries", () => {
    show(variant((x) => { t(x).market!.regime_facts!.available = false; t(x).market!.regime_facts!.why = "the 15M data is incomplete"; }));
    expect([...el("rg").querySelectorAll(".rgc")].map((c) => c.className)).toEqual(Array(6).fill("rgc unk"));
    expect(el("rg").querySelectorAll(".rgc small")).toHaveLength(0); // the reason is said once, beneath, not six times
    expect(el("rg").querySelector(".rgnote")?.textContent).toBe("⚠ Regime facts unavailable: the 15M data is incomplete. Every fact is unknown; nothing is assumed.");
    expect(el("rg").querySelector(".rgnote")?.getAttribute("title")).toBe("the 15M data is incomplete");
    expect(el("rg").textContent).not.toContain("bullish");
  });
  it("says it has not been received when there are no regime facts at all", () => {
    show(variant((x) => { t(x).market!.regime_facts = null; }));
    expect(el("rg").querySelector(".rgnote")?.textContent).toBe("Regime facts: not received yet. Every fact is unknown.");
    expect(el("rg").querySelectorAll(".rgc.unk")).toHaveLength(6);
    show(variant((x) => { t(x).market = null; }));
    expect(el("rg").querySelectorAll(".rgc.unk")).toHaveLength(6);
  });
  it("gives an unknown fact its own reason when the layer is usable", () => {
    show(variant((x) => { t(x).market!.regime_facts!.facts.extended = { state: "unknown", summary: "needs 30 candles", checks: [] }; }));
    const c = [...el("rg").querySelectorAll(".rgc")][4]!;
    expect(c.className).toBe("rgc unk");
    expect(c.querySelector("small")?.textContent).toBe("needs 30 candles");
    expect(c.getAttribute("title")).toBe("Extension: unknown — needs 30 candles");
  });
});

describe("data health", () => {
  it("says the feed, the NIFTY tick on its two clocks, the candles, the clock and the option feed", () => {
    show(base);
    expect([...el("dhs").children].map((d) => d.textContent)).toEqual([
      "Feedconnected", "NIFTY spotfresh · received 1 s · exchange 2 s", "Candlescomplete", "Clocknot checked", "Option feed28 / 28 fresh · 0 stale · 0 unknown · 0 no data · selected CE 24200: FRESH",
    ]);
    expect([...el("dhs").querySelectorAll(":scope > div:not(.span2) b")].map((b) => b.className)).toEqual(["up", "up", "up", "mut"]);
    expect(el("dhs").children[1]?.querySelector("b")?.getAttribute("title")).toBe("receipt age and exchange-time age are different clocks");
  });
  it("is red or amber when the feed is down or connecting, and counts reconnects", () => {
    show(variant((s) => { s.connection.state = "disconnected"; s.connection.reconnects = 2; s.health.feed.reason = "the broker closed the connection"; }));
    expect(el("dhs").children[0]?.textContent).toBe("Feeddisconnected · 2 reconnect(s)");
    expect(el("dhs").children[0]?.querySelector("b")?.className).toBe("down");
    expect(el("dhs").children[0]?.querySelector("b")?.getAttribute("title")).toBe("the broker closed the connection");
    show(variant((s) => { s.connection.state = "connecting"; }));
    expect(el("dhs").children[0]?.querySelector("b")?.className).toBe("flat");
  });
  it("is red when the NIFTY tick is stale, grey when the market is closed, and says when there is no tick", () => {
    show(variant((s) => { s.instruments.find((i) => i.role === "SPOT")!.status = "stale"; s.instruments.find((i) => i.role === "SPOT")!.age = 95; }));
    expect(el("dhs").children[1]?.textContent).toBe("NIFTY spotstale · received 95 s · exchange 2 s");
    expect(el("dhs").children[1]?.querySelector("b")?.className).toBe("down");
    show(variant((s) => { s.health.instruments.find((i) => i.role === "SPOT")!.exchange_status = "stale"; }));
    expect(el("dhs").children[1]?.textContent).toBe("NIFTY spotfresh · received 1 s · exchange 2 s STALE");
    expect(el("dhs").children[1]?.querySelector("b")?.className).toBe("down");
    show(variant((s) => { s.health.live = false; }));
    expect(el("dhs").children[1]?.querySelector("b")?.className).toBe("mut");
    show(variant((s) => { s.instruments.find((i) => i.role === "SPOT")!.age = null; }));
    expect(el("dhs").children[1]?.textContent).toBe("NIFTY spotno tick yet");
    show(variant((s) => { s.health.instruments.find((i) => i.role === "SPOT")!.exchange_status = "unknown"; }));
    expect(el("dhs").children[1]?.textContent).toBe("NIFTY spotfresh · received 1 s · exchange unknown");
    show(variant((s) => { s.health.instruments.find((i) => i.role === "SPOT")!.exchange_age = null; }));
    expect(el("dhs").children[1]?.textContent).toBe("NIFTY spotfresh · received 1 s · exchange –");
  });
  it("says the candles are incomplete, with the reasons in the tooltip, and the clock is not trusted", () => {
    show(variant((s) => { t(s).data = { ok: false, issues: ["1M: 3 missing", "5M: 1 missing"] }; s.health.time = { trusted: false, reason: "the PC clock drifted 4 s" }; }));
    expect(el("dhs").children[2]?.textContent).toBe("Candlesincomplete");
    expect(el("dhs").children[2]?.querySelector("b")?.className).toBe("flat");
    expect(el("dhs").children[2]?.querySelector("b")?.getAttribute("title")).toBe("1M: 3 missing; 5M: 1 missing");
    expect(el("dhs").children[3]?.textContent).toBe("ClockNOT trusted");
    expect(el("dhs").children[3]?.querySelector("b")?.className).toBe("down");
    expect(el("dhs").children[3]?.querySelector("b")?.getAttribute("title")).toBe("the PC clock drifted 4 s");
    show(variant((s) => { s.health.time = { trusted: true }; t(s).data = null; }));
    expect(el("dhs").children[3]?.textContent).toBe("Clocktrusted");
    expect(el("dhs").children[3]?.querySelector("b")?.className).toBe("up");
    expect(el("dhs").children[2]?.textContent).toBe("Candles–");
  });
  it("says the option feed as it is: none yet, closed, partly stale, and the selected contract", () => {
    const opt = () => el("dhs").querySelector(".span2 b")!;
    show(variant((s) => { s.options = { available: false }; }));
    expect(opt().textContent).toBe("no option quotes yet");
    show(variant((s) => { delete s.options; }));
    expect(opt().textContent).toBe("no option quotes yet");
    show(variant((s) => { for (const c of s.options!.contracts!) c.freshness = "market closed"; }));
    expect(opt().textContent).toBe("market closed · 28 contracts, quotes are not live");
    show(variant((s) => { s.options!.contracts![0]!.freshness = "stale"; s.options!.contracts![1]!.freshness = "unknown"; s.options!.contracts![2]!.freshness = "no data"; }));
    expect(opt().textContent).toBe("25 / 28 fresh · 1 stale · 1 unknown · 1 no data · selected CE 24200: FRESH");
    expect(opt().querySelector("b")?.className).toBe("flat");
    show(variant((s) => { t(s).decision.action = "WAIT"; }));
    expect(opt().textContent).toBe("28 / 28 fresh · 0 stale · 0 unknown · 0 no data"); // a contract is named only when the decision calls for it
  });
});

describe("recent events", () => {
  it("shows the latest three, one row each: time, side, strategy, status, summary", () => {
    show(base);
    const rows = [...el("ev3").querySelectorAll(".evrow")];
    expect(rows.map((r) => r.textContent)).toEqual([
      "10:55CETrend Pullbackconfirmedtrigger 24,281.00 (confirming candle completed 10:55)", "10:45CETrend Pullbackwaiting for confirmationtrigger 24,281.00", "10:40CETrend Pullbackdetectedleg origin 24,249.45",
    ]);
    expect(rows[0]?.querySelector("b")?.className).toBe("up");
    expect(rows[0]?.querySelector(".st")?.className).toBe("st st-CONFIRMED");
    expect(el("ev3").querySelectorAll("details")).toHaveLength(0); // none is long
  });
  it("shows only the latest three of many, and a put in red", () => {
    show(variant((s) => { for (let i = 3; i < 8; i++) t(s).events.push({ ...structuredClone(t(s).events[0]!), seq: 10 + i, direction: "PE", text: `DETECTED: older ${i}` }); }));
    expect(el("ev3").querySelectorAll(".evrow")).toHaveLength(3);
    show(variant((s) => { t(s).events[0]!.direction = "PE"; }));
    expect(el("ev3").querySelector(".evrow b")?.className).toBe("down");
  });
  it("a long description is a summary with the whole text one click away", () => {
    const long = "CONFIRMED: " + "the confirming candle closed beyond the trigger with a body of 1.1x ATR and the buyers' evidence ".repeat(3).trim();
    show(variant((s) => { t(s).events[0]!.text = long; }));
    const d = el("ev3").querySelector("details.evd") as HTMLDetailsElement;
    expect(d.open).toBe(false);
    expect(d.querySelector("summary.evrow")?.textContent).toMatch(/… ▸ full description$/);
    expect(d.querySelector(".evfull")?.textContent).toBe(long); // the whole text, with its status, as the server said it
    expect(el("ev3").querySelectorAll(":scope > .evrow, :scope > details")).toHaveLength(3);
  });
  it("says so when there are no events, and goes to the journal", () => {
    show(variant((s) => { t(s).events = []; }));
    expect(text("ev3")).toBe("no setup events today");
    const go = show(base);
    fireEvent.click(screen.getByRole("button", { name: "Full journal →" }));
    expect(go).toHaveBeenCalledWith("journal");
  });
});

describe("what a server says is only ever text", () => {
  it("is not turned into markup anywhere on the page", () => {
    show(variant((s) => {
      const tr = t(s);
      Object.assign(tr.decision, { headline: EVIL, strategy_name: EVIL, reasons: [EVIL], against: [EVIL, "ignored " + EVIL], also: [EVIL] });
      Object.assign(tr.explain!, { happened: [EVIL], now: [EVIL], next: [EVIL], invalidation: EVIL, blocking: [EVIL], note: EVIL });
      Object.assign(tr.setups[0]!, { stage_text: EVIL, confirm_text: EVIL, strategy_name: EVIL, blockers: [EVIL] });
      tr.events[0]!.text = EVIL; tr.events[0]!.strategy_name = EVIL;
      tr.market!.regime_facts!.facts.extended = { state: "unknown", summary: EVIL, checks: [] };
      tr.counter_trend = [{ needed: true, granted: false, reason: EVIL, side: "PE" }];
      s.health.feed.reason = EVIL;
      s.analysis!.condition!.alignment.text = EVIL;
    }));
    expect(document.querySelector("img")).toBeNull();
    expect(document.body.innerHTML).not.toContain("<img");
    expect(el("decision").querySelector(".dhead")?.textContent).toBe(EVIL);
    expect(text("ev3")).toContain(EVIL);
  });
});

describe("the note beside a ready setup", () => {
  const note = () => document.querySelector("[data-testid=decision-note]") as HTMLElement | null;

  it("says the rules were met and nothing more, and what that stands on when the mouse is on it", () => {
    show(base);
    expect(note()?.textContent).toBe(NOTE);
    expect(note()?.textContent).toBe("rules met · not a recommendation · no measured edge");
    expect(note()?.title).toBe(NOTE_WHY);
    expect(note()?.title).toContain("no better than random entries");
  });

  it("sits beside the headline, not in it: the headline is the engine's words, said plainly", () => {
    show(base);
    const line = note()!.parentElement!;
    expect(line.className).toBe("dline");
    expect([...line.children].map((c) => c.className)).toEqual(["dhead", "dnote"]);
    expect(line.querySelector(".dhead")?.textContent).toBe("CE setup ready: Trend Pullback setup confirmed");
  });

  it("is there for a put setup too", () => {
    show(variant((s) => { t(s).decision.action = "BUY PE"; t(s).decision.headline = "BUY PE: Trend Pullback setup confirmed"; }));
    expect(el("decision").querySelector(".dtxt")?.textContent).toBe("PE SETUP");
    expect(note()?.textContent).toBe(NOTE);
  });

  it.each(["WAIT", "NO TRADE", "SOMETHING NEW"])("is not there for %s: nothing was met", (action) => {
    show(variant((s) => { t(s).decision.action = action; t(s).decision.headline = `${action}: why`; }));
    expect(note()).toBeNull();
  });

  it("is not there on a page that lost its link: the last decision is history, and says no more than it did", () => {
    show(base, { stale: true });
    expect(note()).toBeNull();
    expect(el("decision").querySelector(".dtxt")?.textContent).toBe("STALE");
  });
});

describe("the how-to", () => {
  const howto = () => el("howto") as HTMLDetailsElement;
  const steps = () => [...howto().querySelectorAll(".howto > .hstep")].map((d) => d.textContent ?? "");
  const notes = () => [...howto().querySelectorAll(".howto > .hnote")].map((d) => d.textContent ?? "");

  it("is there, closed, with seven numbered steps and three short notes, in one column", () => {
    show(base);
    expect(howto().open).toBe(false);
    expect(howto().querySelector("summary")?.textContent).toBe("How to use this page 7 quick steps before a manual trade");
    expect([...howto().querySelectorAll(".howto > .hstep > b:first-child")].map((b) => b.textContent)).toEqual([
      "1. Check the data.", "2. Read the decision.", '3. Check "Entry".', "4. Check the trend.", "5. Know your exit.", "6. Pick the option.", "7. Use the checklist.",
    ]); // fmt: skip
    expect(howto().querySelectorAll(".howto > div")).toHaveLength(10); // (nothing else is in it)
  });

  it("says each step in plain words", () => {
    show(base);
    expect(steps()).toEqual([
      "1. Check the data. The top bar must be green: MARKET OPEN, FEED CONNECTED, DATA TRUSTED. If anything is red, grey or STALE, do not trade from this screen.",
      "2. Read the decision. CE SETUP or PE SETUP means the rules were met: not a recommendation, and no measured edge. WAIT or NO TRADE means stay out; the line beside it says why.",
      '3. Check "Entry". It must say "eligible". "Not eligible" means wait.',
      "4. Check the trend. The 1H and 15M should agree with the trade: up for a call, down for a put.",
      "5. Know your exit. Current setup shows the trigger, the entry zone and the invalidation. If price closes past the invalidation, the idea is wrong. Choose your own stop and size.",
      "6. Pick the option. For a ready setup only: open the Options tab. The contract should be FRESH with a tight spread.",
      '7. Use the checklist. The Checklist button beside "Explain this decision" gathers all this, plus five things only you can check.',
    ]); // fmt: skip
    expect(notes()).toEqual([
      "Then you decide. Prism places no orders: trade in Angel One yourself, then review the day in the Journal.",
      "🔔 in the header plays a sound when a setup becomes ready (click the page once first: the browser needs it).",
      "Trades tab: log your own trades and size them from your stop. Prism sees no account.",
    ]); // fmt: skip
  });

  it("is short: no step is a wall of text, and the whole is under two thirds of what it was", () => {
    show(base);
    for (const s of steps()) expect(s.length, s).toBeLessThanOrEqual(180);
    expect(steps().join("").length + notes().join("").length).toBeLessThanOrEqual(1312); // (two thirds of the 1,969 characters of the nine blocks it replaced)
  });

  it("names the checklist that is really on the page, and the button the notes name", () => {
    show(base);
    expect(document.querySelector("#decision #pretrade > summary")?.textContent).toMatch(/^Checklist /);
    expect(document.querySelector("#decision details.pop:not(#pretrade) > summary")?.textContent).toBe("Explain this decision ▾");
    for (const label of ["Options", "Trades", "Journal", "Analysis"]) expect(TABS.map((t) => t.label)).toContain(label); // (the tabs the steps send the reader to exist, by those names)
  });
});

describe("a tab that fails to draw", () => {
  const mount = () => {
    cleanup();
    FakeSocket.reset();
    location.hash = "#overview";
    render(<App url="ws://prism.test/ws" createSocket={fakeFactory} />);
  };
  it("says so in words and keeps the header, the tabs and the stale notice, and draws again with the next good snapshot", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const quiet = (e: ErrorEvent) => e.preventDefault(); // (React reports a caught render error to the window as well: the browser would log it, and that is not what is under test)
    window.addEventListener("error", quiet);
    mount();
    act(() => { FakeSocket.last.send(variant((s) => { (t(s) as unknown as Record<string, unknown>).decision = undefined; })); });
    expect(document.getElementById("jserr")?.textContent).toMatch(/^Dashboard display error in overview: /);
    expect(document.getElementById("c-market")?.textContent).toBe("MARKET OPEN"); // the header is still there, and live
    expect(screen.getByRole("tab", { name: "Overview" })).toBeTruthy();
    expect(document.getElementById("decision")).toBeNull();
    act(() => { FakeSocket.last.send(base); });
    expect(document.getElementById("jserr")).toBeNull();
    expect(el("decision").className).toBe("decision buy-ce");
    window.removeEventListener("error", quiet);
    spy.mockRestore();
  });
});

describe("the Overview in the dashboard", () => {
  it("is drawn from the snapshot as it arrives, and a stale page shows the last snapshot as history", () => {
    cleanup();
    FakeSocket.reset();
    location.hash = "";
    render(<App url="ws://prism.test/ws" createSocket={fakeFactory} />);
    expect(el("decision").className).toBe("decision loading");
    act(() => { FakeSocket.last.send(base); });
    expect(el("decision").className).toBe("decision buy-ce");
    act(() => { FakeSocket.last.drop(); });
    expect(el("decision").className).toBe("decision stale");
    expect(document.getElementById("main")?.className).toBe("staled");
  });
  it("its links open the tab they name", () => {
    cleanup();
    FakeSocket.reset();
    location.hash = "";
    render(<App url="ws://prism.test/ws" createSocket={fakeFactory} />);
    act(() => { FakeSocket.last.send(base); });
    fireEvent.click(screen.getByRole("button", { name: "Full journal →" }));
    expect(location.hash).toBe("#journal");
    expect(screen.getByRole("tab", { name: "Journal" }).getAttribute("aria-selected")).toBe("true");
  });
});
