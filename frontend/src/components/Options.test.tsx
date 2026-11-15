import { act, cleanup, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../App";
import { base, EVIL, FakeSocket, fakeFactory, variant } from "../test/helpers";
import type { OptionContract, Snapshot } from "../types";
import { OptionsTab } from "./Options";

// The current dashboard's Options tab and this one are compared in a real browser, in each of the 14 pinned states (tests/test_options_browser.py). These tests are the branches one by one, on the real
// snapshot of the engine: a BUY CE at 10:55 on 06 Nov 2026 with CE 24200 (10 Nov) selected, two alternatives, 14 CE and 14 PE contracts, and nothing ruled out.
const el = (id: string) => document.getElementById(id) as HTMLElement;
const text = (id: string) => el(id).textContent;
const show = (s: Snapshot | null, stale = false) => {
  cleanup();
  render(<OptionsTab snapshot={s} stale={stale} />);
};
const opt = (s: Snapshot) => s.options!;
const sel = (s: Snapshot) => opt(s).selection!.contract!;
const rows = () => [...el("opt-table").querySelectorAll("tr")].slice(1);
const cells = (tr: Element) => [...tr.children].map((c) => c.textContent);
const card = () => el("opt-sel").firstElementChild as HTMLElement;
const blocked = (c: OptionContract, text = "spread 4.20% of the mid is over the 3% maximum") => { c.blocking = true; c.flags = [{ severity: "avoid", code: "wide_spread", text }]; };

describe("before there is a snapshot, or an analysis", () => {
  it("is a dash and empty panels before the first snapshot", () => {
    show(null);
    expect(text("opt-head")).toBe("–");
    expect(el("opt-sel").children).toHaveLength(0);
    expect(el("opt-table").children).toHaveLength(0);
    expect([text("opt-exp"), text("opt-win"), text("opt-info")]).toEqual(["", "", ""]);
    expect(text("opt-head")).not.toContain("Phase 3");
  });
  it("says why there is no analysis, in the engine's words, and leaves the panels empty", () => {
    show(variant((s) => { s.options = { available: false, reason: "no option contracts are selected yet" }; }));
    expect(text("opt-head")).toBe("no option contracts are selected yet");
    expect(el("opt-sel").children).toHaveLength(0);
    expect(el("opt-table").children).toHaveLength(0);
    expect(text("opt-info")).toBe(""); // (no 'informational' line: nothing is being shown)
  });
  it("says it is not available yet when it gives no reason, or there is no options payload at all", () => {
    show(variant((s) => { s.options = { available: false }; }));
    expect(text("opt-head")).toBe("options analysis not available yet");
    show(variant((s) => { delete s.options; }));
    expect(text("opt-head")).toBe("options analysis not available yet");
    show(variant((s) => { delete opt(s).selection; }));
    expect(text("opt-head")).toBe("options analysis not available yet"); // (an analysis with no selection cannot be drawn: it is not drawn)
  });
});

describe("the header bar", () => {
  it("says the spot and its age, the decision, the option side, the headline and who made it", () => {
    show(base);
    expect([...el("opt-head").children].map((c) => c.textContent)).toEqual(["NIFTY spot 24287.00 1 s old", "Phase 3 decision BUY CE", "Option side CE", "BUY CE: Trend Pullback setup confirmed", "From Trend Pullback setup trend_pullback:bull:1793940000"]);
    expect(el("opt-head").querySelector("b")?.className).toBe(""); // (a fresh price is not in red)
    expect(el("opt-head").querySelector("[title]")?.getAttribute("title")).toBe("the setup the decision is about");
  });
  it("says a stale price in red and says STALE, but only while the market is open", () => {
    show(variant((s) => { opt(s).spot_fresh = false; }));
    expect(el("opt-head").querySelector("b")?.className).toBe("stale");
    expect(el("opt-head").children[0]?.textContent).toBe("NIFTY spot 24287.00 1 s old — STALE");
    show(variant((s) => { opt(s).spot_fresh = false; opt(s).live = false; }));
    expect(el("opt-head").children[0]?.textContent).toBe("NIFTY spot 24287.00 1 s old"); // a closed market has no stale price
  });
  it("says there is no tick, and shows an unknown price as a dash", () => {
    show(variant((s) => { opt(s).spot_age = null; opt(s).spot = null; }));
    expect(el("opt-head").children[0]?.textContent).toBe("NIFTY spot – no tick");
  });
  it("says the option side is none unless a BUY that the options agree with", () => {
    show(variant((s) => { s.trading!.decision.action = "WAIT"; opt(s).decision!.action = "WAIT"; }));
    expect(el("opt-head").children[2]?.textContent).toBe("Option side none");
    show(variant((s) => { opt(s).decision!.action = "BUY PE"; }));
    expect(el("opt-head").children[1]?.textContent).toBe("Phase 3 decision BUY PE"); // (the options payload's own decision)
    expect(el("opt-head").children[2]?.textContent).toBe("Option side none"); // ... which the final decision does not match
  });
  it("names a setup in view, and says it is not a BUY when it is not", () => {
    show(variant((s) => { opt(s).decision!.action = "WAIT"; s.trading!.decision.action = "WAIT"; }));
    const from = el("opt-head").children[4]!;
    expect(from.className).toBe("mut");
    expect(from.textContent).toBe("Setup in view (not a BUY, so no contract): Trend Pullback setup trend_pullback:bull:1793940000");
  });
  it("calls a decision a BUY only when it begins with BUY", () => {
    show(variant((s) => { opt(s).decision!.action = "NOT A BUY"; }));
    expect(el("opt-head").children[4]?.textContent).toMatch(/^Setup in view \(not a BUY, so no contract\)/);
    show(variant((s) => { opt(s).decision!.action = "BUY PE"; }));
    expect(el("opt-head").children[4]?.textContent).toMatch(/^From Trend Pullback/);
  });
  it("leaves out what is not there: no strategy, no setup, no headline, no 'also'", () => {
    show(variant((s) => { Object.assign(opt(s).decision!, { strategy_name: null, setup_id: null, headline: null, also: [] }); }));
    expect([...el("opt-head").children].map((c) => c.textContent)).toEqual(["NIFTY spot 24287.00 1 s old", "Phase 3 decision BUY CE", "Option side CE", ""]);
    show(variant((s) => { opt(s).decision!.setup_id = null; opt(s).decision!.also = ["Range Bounce", "Breakout and Retest"]; }));
    expect(el("opt-head").children[4]?.textContent).toBe("From Trend Pullback");
    expect(el("opt-head").children[5]?.textContent).toBe("also matches: Range Bounce, Breakout and Retest");
    show(variant((s) => { opt(s).decision!.action = null; }));
    expect(el("opt-head").children[1]?.textContent).toBe("Phase 3 decision –");
  });
});

describe("the selected contract", () => {
  it("is a card in green for a call, with its heading, its identity and its origin", () => {
    show(base);
    expect(card().className).toBe("panel card ce");
    expect(card().querySelector("h3")?.textContent).toBe("Selected contract the market data does not rule it out; this is not a recommendation or a prediction");
    expect(card().querySelector(".selhead .big")?.textContent).toBe("CE 24200");
    expect(card().querySelector(".selhead .big")?.className).toBe("big up");
    expect([...card().querySelectorAll(".selhead > span")].slice(1).map((c) => c.textContent)).toEqual(["ITM · 2 strike(s) from ATM · -87 pts from the spot", "expiry 2026-11-10 (4 day(s))", "NIFTY10NOV202624200CE"]);
    expect(text("opt-info")).toBe(""); // a selected contract is not 'informational' 
    expect(card().querySelector(".origin")?.textContent).toBe("Chosen for BUY CE from Trend Pullback trend_pullback · setup trend_pullback:bull:1793940000 · also matches: none");
    expect([...card().querySelectorAll(".origin code")].map((c) => c.textContent)).toEqual(["trend_pullback", "trend_pullback:bull:1793940000"]);
  });
  it("says its origin as the decision carries it: a missing strategy ID, a missing setup, and who else agrees", () => {
    const origin = () => card().querySelector(".origin")!;
    show(variant((s) => { opt(s).decision!.strategy = null; }));
    expect(origin().textContent).toBe("Chosen for BUY CE from Trend Pullback · setup trend_pullback:bull:1793940000 · also matches: none");
    expect([...origin().querySelectorAll("code")].map((c) => c.textContent)).toEqual(["trend_pullback:bull:1793940000"]); // (no empty code box for a strategy ID that is not there)
    show(variant((s) => { opt(s).decision!.setup_id = null; }));
    expect(origin().textContent).toBe("Chosen for BUY CE from Trend Pullback trend_pullback · setup – · also matches: none");
    expect(origin().querySelectorAll("code")).toHaveLength(1);
    show(variant((s) => { opt(s).decision!.also = ["Range Bounce", "Breakout and Retest"]; }));
    expect(origin().textContent).toMatch(/also matches: Range Bounce, Breakout and Retest$/);
    expect(origin().querySelector("b:last-child")?.textContent).toBe("Range Bounce, Breakout and Retest");
    show(variant((s) => { opt(s).decision!.strategy_name = null; }));
    expect(origin().textContent).toMatch(/^Chosen for BUY CE from – /);
  });
  it("is red for a put", () => {
    show(variant((s) => { s.trading!.decision.action = "BUY PE"; opt(s).decision!.action = "BUY PE"; opt(s).selection!.kind = "PE"; sel(s).kind = "PE"; }));
    expect(card().className).toBe("panel card pe");
    expect(card().querySelector(".selhead .big")?.className).toBe("big down");
    expect(card().querySelector(".selhead .big")?.textContent).toBe("PE 24200");
  });
  it("says the quote in twelve labelled numbers, in the Indian grouping", () => {
    show(base);
    expect([...card().querySelectorAll(".kv.six > div")].map((d) => d.textContent)).toEqual([
      "LTP127.65", "Bid × units127.50 × 600", "Ask × units127.80 × 600", "Spread0.30 (0.24% of mid)", "Lot size1 lot = 75 units", "Prev close–", "Day volume (units)20,00,000", "Open interest (units)30,00,000",
      "FreshnessFRESH", "Quote age: received1 s", "Quote age: exchange time3 s", "Last-trade age21 s",
    ]);
    const b = (label: string) => [...card().querySelectorAll(".kv.six > div")].find((d) => d.firstElementChild?.textContent === label)!.querySelector("b")!;
    expect(b("Freshness").className).toBe("up");
    expect(b("Quote age: exchange time").className).toBe(""); // a fresh exchange time is not amber
    expect(b("Quote age: received").getAttribute("title")).toBe("how long ago Prism received the last message for this contract");
    expect(b("Quote age: exchange time").getAttribute("title")).toBe("the exchange's own time for the quote: a message received a moment ago can carry an old one");
    expect(b("Last-trade age").getAttribute("title")).toBe("shown only: a last trade says nothing about the order book");
    expect(b("LTP").hasAttribute("title")).toBe(false);
  });
  it("says the previous close with its change, a missing spread as a dash, and an unknown lot size", () => {
    show(variant((s) => { Object.assign(sel(s), { prev_close: 120, change: 7.65, spread: null, spread_pct: null, lot_size: null, bid_qty: null }); }));
    const d = (label: string) => [...card().querySelectorAll(".kv.six > div")].find((x) => x.firstElementChild?.textContent === label)!.textContent;
    expect(d("Prev close")).toBe("Prev close120.00 (+7.65)");
    expect(d("Spread")).toBe("Spread–");
    expect(d("Lot size")).toBe("Lot size1 lot = – units");
    expect(d("Bid × units")).toBe("Bid × units127.50 × –");
    show(variant((s) => { Object.assign(sel(s), { prev_close: 120, change: 0 }); }));
    expect([...card().querySelectorAll(".kv.six > div")].find((x) => x.firstElementChild?.textContent === "Prev close")!.textContent).toBe("Prev close120.00 (+0.00)");
    show(variant((s) => { Object.assign(sel(s), { prev_close: 120, change: -3.2 }); }));
    expect([...card().querySelectorAll(".kv.six > div")].find((x) => x.firstElementChild?.textContent === "Prev close")!.textContent).toBe("Prev close120.00 (-3.20)");
  });
  it("is amber when the exchange's time is stale or unknown, and says so", () => {
    show(variant((s) => { Object.assign(sel(s), { exchange_status: "stale", exchange_age: 95, freshness: "stale" }); }));
    const exch = [...card().querySelectorAll(".kv.six > div")].find((x) => x.firstElementChild?.textContent === "Quote age: exchange time")!;
    expect(exch.textContent).toBe("Quote age: exchange time95 s");
    expect(exch.querySelector("b")?.className).toBe("flat");
    expect([...card().querySelectorAll(".kv.six > div")].find((x) => x.firstElementChild?.textContent === "Freshness")!.querySelector("b")?.className).toBe("down");
    show(variant((s) => { Object.assign(sel(s), { exchange_status: "unknown", exchange_reason: "no exchange time on the message" }); }));
    expect([...card().querySelectorAll(".kv.six > div")].find((x) => x.firstElementChild?.textContent === "Quote age: exchange time")!.textContent).toBe("Quote age: exchange timeunknown");
    expect(card().querySelector(".fresh-strip")?.textContent).toBe("quote FRESH · receipt age 1 s · exchange-time age unknown (no exchange time on the message) · last-trade age 21 s");
  });
  it("says the strike's distance with its sign and no decimals, and a missing one as a dash", () => {
    const span = () => card().querySelectorAll(".selhead > span")[1]!.textContent;
    show(variant((s) => { sel(s).distance_points = 49.6; }));
    expect(span()).toBe("ITM · 2 strike(s) from ATM · +50 pts from the spot");
    show(variant((s) => { sel(s).distance_points = 0; sel(s).steps_from_atm = 0; sel(s).moneyness = "ATM"; }));
    expect(span()).toBe("ATM · +0 pts from the spot"); // (at the money: no 'strikes from ATM')
    show(variant((s) => { sel(s).distance_points = null; sel(s).moneyness = null; }));
    expect(span()).toBe("– · 2 strike(s) from ATM · – pts from the spot".replace(" pts from the spot", "").replace("– · 2 strike(s) from ATM · –", "– · 2 strike(s) from ATM · –"));
  });
  it("says in bold when it expires today", () => {
    show(variant((s) => { Object.assign(sel(s), { expiry_day: true, days_to_expiry: 0 }); }));
    const e = card().querySelectorAll(".selhead > span")[2]!;
    expect(e.textContent).toBe("expiry 2026-11-10 (0 day(s), EXPIRES TODAY)");
    expect(e.querySelector("b.sev-warn")?.textContent).toBe("EXPIRES TODAY");
  });
  it("says its findings in full, with a stop sign for an Avoid, or that there are none", () => {
    show(base);
    expect(card().textContent).toContain("No suitability warnings.");
    expect(card().textContent).not.toContain("Suitability findings");
    show(variant((s) => { sel(s).flags = [{ severity: "warn", code: "far_from_atm", text: "3 strikes from ATM" }, { severity: "avoid", code: "x", text: "an avoid" }]; }));
    expect(card().textContent).toContain("Suitability findings (a Warn is shown and does not block; an Avoid would have kept this contract from being selected)");
    expect([...card().querySelectorAll(":scope > .why")].slice(0, 2).map((d) => [d.className, d.textContent])).toEqual([["why sev-warn", "⚠ 3 strikes from ATM"], ["why sev-avoid", "⛔ an avoid"]]);
  });
  it("says why it was chosen, in the engine's words", () => {
    show(base);
    expect([...card().querySelectorAll(":scope > .why.mut")].map((d) => d.textContent)).toEqual([
      "14 of 14 CE contracts have no blocking problem",
      "it has the fewest warnings (0); of the 10 with that many, it has the tightest spread (0.24% of the mid)",
      "ITM, 2 strike(s) from ATM, expiry 2026-11-10 (4 day(s))",
      "this order (fewest warnings, then tightest spread, then nearest the money) is a convention, not a score, and says nothing about profit",
    ]);
  });
  it("says it is a stale page's last selection, as history", () => {
    show(base, true);
    expect(card().querySelector("h3")?.textContent).toBe("Last selected contract STALE since 10:55: not current, not actionable");
    expect(card().querySelector("h3 .stale")?.textContent).toBe("STALE since 10:55: not current, not actionable");
    expect(card().querySelector(".origin")?.textContent).toMatch(/^Last chosen for BUY CE from Trend Pullback/);
    expect(card().querySelector("h3")?.textContent).not.toContain("not a recommendation");
  });
});

describe("the alternatives", () => {
  it("are a table in the engine's order, each with its quote and its warnings", () => {
    show(base);
    const t = card().querySelector(".scroll table")!;
    expect([...t.querySelectorAll("th")].map((h) => h.textContent)).toEqual(["Contract", "Expiry", "LTP", "Bid × Ask", "Spread", "Volume (units)", "OI (units)", "Quote age: received / exchange", "Warnings"]);
    expect(t.querySelector("th[title]")?.getAttribute("title")).toBe("received by Prism / the exchange's own time for the quote");
    expect([...t.querySelectorAll("tr")].slice(1).map((r) => cells(r))).toEqual([
      ["CE 24200", "2026-11-17", "127.65", "127.50 × 127.80", "0.24%", "20,00,000", "30,00,000", "1 s / 3 s", "none"],
      ["CE 24250", "2026-11-10", "80.15", "80.00 × 80.30", "0.37%", "20,00,000", "30,00,000", "1 s / 3 s", "none"],
    ]);
    expect(card().textContent).toContain("Alternatives next in the same order; each has no blocking finding");
  });
  it("name only the warnings an alternative has, each with its text as a tooltip", () => {
    show(variant((s) => { const a = opt(s).selection!.alternatives[0]!; a.warnings = 2; a.flags = [{ severity: "warn", code: "far_from_atm", text: "3 strikes from ATM" }, { severity: "avoid", code: "wide_spread", text: "not drawn here" }, { severity: "warn", code: "low_volume", text: "volume is low" }]; a.spread_pct = null; }));
    const r = card().querySelectorAll(".scroll tr")[1]!;
    expect(cells(r)[8]).toBe("⚠ far from atm · ⚠ low volume");
    expect([...r.querySelectorAll("span[title]")].map((x) => x.getAttribute("title"))).toEqual(["3 strikes from ATM", "volume is low"]);
    expect(cells(r)[4]).toBe("–");
  });
  it("say there are none when there are none", () => {
    show(variant((s) => { opt(s).selection!.alternatives = []; }));
    expect(card().querySelector(".scroll")).toBeNull();
    expect(card().textContent).toContain("No alternative contracts.");
  });
});

describe("the contracts ruled out", () => {
  it("are one closed line with the reasons beneath, nearest the money first", () => {
    show(variant((s) => {
      const ce = opt(s).contracts!.filter((c) => c.kind === "CE");
      blocked(ce[0]!, "spread 4.20% is over the 3% maximum"); // 24150, 3 strikes out
      blocked(ce[5]!, "no bid"); // nearer
      ce[5]!.steps_from_atm = 0;
    }));
    const d = card().querySelector("details.more") as HTMLDetailsElement;
    expect(d.open).toBe(false);
    expect(d.querySelector("summary")?.textContent).toBe("2 of 14 CE contracts ruled out (Avoid): why");
    const lines = [...d.querySelectorAll(".why.sev-avoid")].map((x) => x.textContent);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^⛔ NIFTY\S+CE .+ · strike \d+: no bid$/);
    expect(lines[1]).toMatch(/: spread 4.20% is over the 3% maximum$/);
  });
  it("say that none is, when none is", () => {
    show(base);
    expect(card().querySelector("details.more")).toBeNull();
    expect(card().textContent).toContain("No CE contract is ruled out.");
  });
  it("name each Avoid finding and leave the Warns out", () => {
    show(variant((s) => { const c = opt(s).contracts!.filter((x) => x.kind === "CE")[0]!; c.blocking = true; c.flags = [{ severity: "avoid", code: "a", text: "first" }, { severity: "warn", code: "b", text: "warned" }, { severity: "avoid", code: "c", text: "second" }]; }));
    expect(card().querySelector(".why.sev-avoid")?.textContent).toMatch(/: first; second$/);
  });
});

describe("no contract selected", () => {
  const wait = (s: Snapshot) => { s.trading!.decision.action = "WAIT"; s.trading!.decision.headline = "WAIT: setup blocked"; opt(s).decision!.action = "WAIT"; opt(s).decision!.headline = "WAIT: setup blocked"; opt(s).selection!.actionable = false; opt(s).selection!.contract = null; opt(s).selection!.kind = null; opt(s).selection!.notice = "no contract: the decision is not a BUY"; };
  it("is informational for a decision that is not a BUY, and says the whole page below is not actionable", () => {
    show(variant(wait));
    expect(card().className).toBe("panel card");
    expect(card().querySelector("h3")?.textContent).toBe("No contract selected informational: only a BUY CE / BUY PE decision selects a contract");
    expect(card().children[1]?.textContent).toBe("no contract: the decision is not a BUY");
    expect(card().children[2]?.textContent).toBe("Final decision: WAIT — WAIT: setup blocked. Everything below is for information only: nothing in it is selected, and none of it is actionable.");
    expect(card().querySelector("details")).toBeNull();
    expect(text("opt-info")).toBe(" — informational: no contract is selected");
  });
  it("says the decision is not available when there is none", () => {
    show(variant((s) => { wait(s); s.trading!.decision.action = ""; opt(s).decision = { action: null }; }));
    expect(card().children[2]?.textContent).toContain("Final decision: not available. Everything below");
  });
  it("says a conflict: the options data offers a contract the decision does not call for", () => {
    show(variant((s) => { s.trading!.decision.action = "WAIT"; }));
    const w = card().querySelector(".warnbox")!;
    expect(w.textContent).toBe("⚠ The options data offers a contract, but the final decision is WAIT (the options payload says BUY CE): no contract is shown as selected.");
    expect(card().children[2]?.textContent).toBe("no options selection: the final decision does not call for a contract");
    expect(card().textContent).not.toContain("Chosen for");
    expect(el("opt-sel").textContent).not.toContain("CE 24200 ITM");
  });
  it("says a conflict without 'the options payload says' when both payloads say the same, and offers no reasons to a decision that is not a BUY", () => {
    show(variant((s) => { s.trading!.decision.action = "WAIT"; opt(s).decision!.action = "WAIT"; })); // both say WAIT, and the options data still offers a contract
    expect(card().querySelector(".warnbox")?.textContent).toBe("⚠ The options data offers a contract, but the final decision is WAIT: no contract is shown as selected.");
    expect(card().querySelector("details")).toBeNull();
    expect(card().textContent).not.toContain("ruled out");
  });
  it("says a conflict between the two payloads, and one with no decision", () => {
    show(variant((s) => { opt(s).decision!.action = "BUY PE"; }));
    expect(card().querySelector(".warnbox")?.textContent).toBe("⚠ The options data offers a contract, but the final decision is BUY CE (the options payload says BUY PE): no contract is shown as selected.");
    expect(card().textContent).not.toContain("ruled out"); // (the two payloads disagree: no list of reasons for a side that nobody asked for)
    expect(card().querySelector("details")).toBeNull();
    show(variant((s) => { s.trading = null; }));
    expect(card().querySelector(".warnbox")?.textContent).toBe("⚠ The options data offers a contract, but the final decision is not available: no contract is shown as selected.");
    show(variant((s) => { s.trading!.decision.action = "WAIT"; opt(s).decision = { action: null }; }));
    expect(card().querySelector(".warnbox")?.textContent).toContain("(the options payload says nothing)");
  });
  it("is not informational for a BUY: the reasons for there being no contract are open, and the notice says why", () => {
    show(variant((s) => {
      opt(s).selection!.actionable = false; opt(s).selection!.contract = null; opt(s).selection!.notice = "no suitable CE contract: every one is ruled out";
      for (const c of opt(s).contracts!.filter((x) => x.kind === "CE")) blocked(c);
    }));
    expect(card().querySelector("h3")?.textContent).toBe("No contract selected ");
    expect(card().querySelector(".mut")?.textContent).toBe("");
    expect(card().children[1]?.textContent).toBe("no suitable CE contract: every one is ruled out");
    expect(card().querySelector(".mut + .mut, :scope > .mut")?.textContent ?? "").not.toContain("Final decision");
    const d = card().querySelector("details.more") as HTMLDetailsElement;
    expect(d.open).toBe(true);
    expect(d.querySelector("summary")?.textContent).toBe("14 of 14 CE contracts ruled out (Avoid): why");
    expect(text("opt-info")).toBe(" — informational: no contract is selected");
  });
  it("says there is nothing to rule out when a BUY has no contract and nothing was ruled out", () => {
    show(variant((s) => { opt(s).selection!.actionable = false; opt(s).selection!.contract = null; opt(s).selection!.notice = "nothing to offer"; }));
    expect(card().textContent).toContain("No CE contract is ruled out.");
  });
});

describe("the expiries and the watched window", () => {
  it("say each expiry and its days", () => {
    show(base);
    expect([...el("opt-exp").children].map((d) => d.textContent)).toEqual(["Expiry 2026-11-10: 4 day(s)", "Expiry 2026-11-17: 11 day(s)"]);
  });
  it("warn on the day of expiry that time decay is fastest, and near it that decay accelerates", () => {
    show(variant((s) => { opt(s).expiries![0]!.expiry_day = true; opt(s).expiries![0]!.days_to_expiry = 0; opt(s).expiries![1]!.decay_warning = true; }));
    const [a, b] = [...el("opt-exp").children];
    expect(a?.textContent).toBe("Expiry 2026-11-10: 0 day(s) — EXPIRY DAY: time decay is fastest; premiums can fall quickly even if NIFTY does not move");
    expect(a?.querySelector("b.sev-warn")).not.toBeNull();
    expect(b?.textContent).toBe("Expiry 2026-11-17: 11 day(s) — time decay accelerates close to expiry");
    expect(b?.querySelector("span.sev-warn")).not.toBeNull();
    show(variant((s) => { opt(s).expiries![0]!.expiry_day = true; opt(s).expiries![0]!.decay_warning = true; }));
    expect(el("opt-exp").children[0]?.textContent).toContain("EXPIRY DAY"); // (the day itself says the stronger thing)
    expect(el("opt-exp").children[0]?.textContent).not.toContain("accelerates");
  });
  it("says what is watched, the thresholds and that they are placeholders", () => {
    show(base);
    expect(text("opt-win")).toBe("Watching 28 option contracts around ATM 24300 (first expiry 2026-11-10); the strikes follow the spot. Not re-centred since selection. Thresholds (OPTIONS_* variables): spread warn 1% / max 3%, min volume 1,00,000 units, a quote received more than 30 s ago, or whose exchange time is more than 30 s old, is stale. They are placeholders to tune.");
  });
  it("says when it was re-centred, and has nothing to say with no window", () => {
    show(variant((s) => { opt(s).window!.events = [{ time: 1793942000, reason: "the spot moved 90 points" }, { time: 1793942400, reason: "the spot moved 60 points" }]; }));
    expect(text("opt-win")).toContain("Last re-centred: 10:43:20 the spot moved 90 points · 10:50:00 the spot moved 60 points Thresholds");
    expect(text("opt-win")).not.toContain("Not re-centred");
    show(variant((s) => { opt(s).window = null; }));
    expect(text("opt-win")).toBe("");
  });
});

describe("the comparison table", () => {
  it("lists only the side of a BUY, the selected contract in bold and the rest as they are", () => {
    show(base);
    expect(rows()).toHaveLength(14);
    expect(rows().every((r) => cells(r)[1] === "CE")).toBe(true);
    expect(rows().filter((r) => r.className === "opt-sel")).toHaveLength(1);
    expect(cells(rows().find((r) => r.className === "opt-sel")!).slice(0, 10)).toEqual(["2026-11-10 (4d)", "CE", "24200", "ITM 2", "127.65", "127.50 × 600", "127.80 × 600", "0.30 (0.24%)", "20,00,000", "30,00,000"]);
    expect([...el("opt-table").querySelectorAll("th")].map((h) => h.textContent)).toEqual([
      "Expiry", "Side", "Strike", "Class", "LTP", "Bid × units", "Ask × units", "Spread", "Volume (units)", "Open interest (units)", "Freshness: receipt / exchange / last trade", "Findings",
    ]);
    expect(el("opt-table").querySelectorAll("th[title]")).toHaveLength(3);
  });
  it("lists both sides when no contract is selected", () => {
    show(variant((s) => { s.trading!.decision.action = "WAIT"; }));
    expect(rows()).toHaveLength(28);
    expect(new Set(rows().map((r) => cells(r)[1]))).toEqual(new Set(["CE", "PE"]));
    expect(rows().filter((r) => r.className === "opt-sel")).toHaveLength(0);
  });
  it("greys a contract that was ruled out", () => {
    show(variant((s) => { blocked(opt(s).contracts![3]!); }));
    expect(rows().filter((r) => r.className === "opt-avoid")).toHaveLength(1);
    expect(rows().filter((r) => r.className === "").length).toBe(rows().length - 2); // the selected one, the ruled-out one, and the rest plain
  });
  it("says the freshness on three clocks and the findings in one word each", () => {
    show(base);
    const first = rows()[0]!;
    expect(cells(first)[10]).toBe("FRESHreceipt 1 s · exchange 3 s · trade 21 s");
    expect(first.querySelector("td.wrap b")?.className).toBe("up");
    expect(first.querySelector("td.wrap br")).not.toBeNull();
    expect(cells(first)[11]).toBe("⚠ far from atm");
    expect(first.querySelector("td:last-child span")?.getAttribute("title")).toMatch(/^3 strikes from ATM \(ITM/);
    expect(cells(rows().find((r) => r.className === "opt-sel")!)[11]).toBe(""); // no findings: nothing
  });
  it("says a stale or unknown quote as it is", () => {
    show(variant((s) => { Object.assign(opt(s).contracts![0]!, { freshness: "stale", exchange_status: "unknown", receipt_age: 95, last_trade_age: null }); }));
    expect(cells(rows()[0]!)[10]).toBe("STALEreceipt 95 s · exchange unknown · trade –");
    expect(rows()[0]!.querySelector("td.wrap b")?.className).toBe("down");
  });
  it("shows a missing spread and a missing class as dashes", () => {
    show(variant((s) => { Object.assign(opt(s).contracts![0]!, { spread: null, spread_pct: null, moneyness: null, steps_from_atm: null, bid: null, ask: null, volume: null, oi: null }); }));
    expect(cells(rows()[0]!).slice(3, 10)).toEqual(["–", "175.15", "– × 600", "– × 600", "–", "–", "–"]); // (class, LTP, bid, ask, spread, volume, open interest: the LTP is still there)
  });
});

describe("what a server says is only ever text", () => {
  it("is not turned into markup anywhere on the tab", () => {
    show(variant((s) => {
      opt(s).reason = EVIL;
      Object.assign(opt(s).decision!, { headline: EVIL, strategy_name: EVIL, setup_id: EVIL, strategy: EVIL, also: [EVIL] });
      Object.assign(sel(s), { symbol: EVIL, moneyness: EVIL, expiry: EVIL, flags: [{ severity: "warn", code: "x", text: EVIL }] });
      opt(s).selection!.why = [EVIL];
      opt(s).selection!.notice = EVIL;
      opt(s).expiries![0]!.expiry = EVIL;
      opt(s).window!.primary = EVIL;
      opt(s).window!.events = [{ time: 1793942000, reason: EVIL }];
      opt(s).contracts![0]!.flags = [{ severity: "warn", code: "x", text: EVIL }];
    }));
    expect(document.querySelector("img")).toBeNull();
    expect(el("opt-sel").textContent).toContain(EVIL);
    expect(text("opt-win")).toContain(EVIL);
    show(variant((s) => { opt(s).available = false; opt(s).reason = EVIL; }));
    expect(text("opt-head")).toBe(EVIL);
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("the Options tab in the dashboard", () => {
  const mount = (hash: string) => {
    cleanup();
    FakeSocket.reset();
    location.hash = hash;
    render(<App url="ws://prism.test/ws" createSocket={fakeFactory} />);
  };
  it("is opened by #options, draws from the snapshot as it arrives, and is stale with the page", () => {
    mount("#options");
    expect(text("opt-head")).toBe("–");
    act(() => { FakeSocket.last.send(base); });
    expect(card().className).toBe("panel card ce");
    expect(card().querySelector("h3")?.textContent).toMatch(/^Selected contract/);
    act(() => { FakeSocket.last.drop(); });
    expect(card().querySelector("h3")?.textContent).toMatch(/^Last selected contract STALE since 10:55/);
    expect(document.getElementById("main")?.className).toBe("staled");
  });
  it("says a payload it cannot draw in words, and keeps the page", () => {
    mount("#options");
    const quiet = (e: ErrorEvent) => e.preventDefault();
    window.addEventListener("error", quiet);
    const spy = console.error;
    console.error = () => {};
    act(() => { FakeSocket.last.send(variant((s) => { (opt(s).selection as unknown as { why: unknown }).why = undefined; })); });
    expect(document.getElementById("jserr")?.textContent).toMatch(/^Dashboard display error in options: /);
    expect(document.getElementById("c-market")?.textContent).toBe("MARKET OPEN");
    act(() => { FakeSocket.last.send(base); });
    expect(document.getElementById("jserr")).toBeNull();
    console.error = spy;
    window.removeEventListener("error", quiet);
  });
});
