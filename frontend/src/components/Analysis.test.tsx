import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useMemo, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_OPEN } from "../analysisModel";
import { App } from "../App";
import { base, EVIL, FakeSocket, fakeFactory, variant } from "../test/helpers";
import type { Setup, Snapshot } from "../types";
import { AnalysisTab, type Focus } from "./Analysis";
import type { OpenState } from "./AnalysisStrategies";

// The current dashboard's Analysis tab and this one are compared in a real browser, in each of the 14 pinned states (tests/test_analysis_browser.py). These tests are the branches one by one, on the real
// snapshot of the engine: a BUY CE at 10:55 on 06 Nov 2026, with the Trend Pullback setup confirmed, ten strategies, one counter-trend permission (denied) and a healthy feed.
const body = () => document.getElementById("analysis-body") as HTMLElement;
const sec = (k: string) => body().querySelector(`details.sec[data-key="${k}"]`) as HTMLDetailsElement;
const sd = (id: string) => body().querySelector(`details.sd[data-key="sd-${id}"]`) as HTMLDetailsElement;
const secText = (k: string) => sec(k).querySelector(".secbody")!.textContent!;
const t = (s: Snapshot) => s.trading!;
const copy = (over: Partial<Setup>): Setup => ({ ...structuredClone(base.trading!.setups[0]!), ...over });

function Host({ s, stale = false, start, focus = null, onFocused = () => {}, seen }: { s: Snapshot | null; stale?: boolean; start?: string[]; focus?: Focus | null; onFocused?: () => void; seen?: Set<string> }) {
  const [open, setOpen] = useState(() => new Set(start ?? DEFAULT_OPEN));
  const own = useMemo(() => seen ?? new Set<string>(), [seen]);
  const os = useMemo<OpenState>(
    () => ({
      isOpen: (k) => open.has(k),
      setOpen: (k, o) => setOpen((p) => (p.has(k) === o ? p : o ? new Set(p).add(k) : new Set([...p].filter((x) => x !== k)))),
    }),
    [open],
  );
  return <AnalysisTab snapshot={s} stale={stale} os={os} seen={own} focus={focus} onFocused={onFocused} />;
}
/** jsdom reports a section opening or closing a moment after the click, as a browser does: the page keeps what it hears. */
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const show = (s: Snapshot | null, props: Omit<Parameters<typeof Host>[0], "s"> = {}) => {
  cleanup();
  return render(<Host s={s} {...props} />);
};

describe("before there is a snapshot, or an analysis", () => {
  it("is empty before the first snapshot", () => {
    show(null);
    expect(body().children).toHaveLength(0);
  });
  it("says the analysis is not available yet, with the state of the history, and shows its warnings", () => {
    show(variant((s) => { s.analysis = { available: false, history: { state: "loading" }, warnings: ["Historical data is still loading (waiting for the history)."] }; }));
    expect([...body().children].slice(0, 2).map((c) => [c.className, c.textContent])).toEqual([["warnbox", "⚠ Historical data is still loading (waiting for the history)."], ["panel mut", "Analysis not available yet (loading)."]]);
    expect(body().querySelector(":scope > .bar")).toBeNull();
    expect(sec("a-tech")).toBeNull(); // (no indicator tables without an analysis)
    expect(sec("a-health")).not.toBeNull(); // (the health of the data is always there)
  });
  it("says the state the history is in, whatever it is", () => {
    show(variant((s) => { s.analysis = { available: false, history: { state: "error", error: "Angel One refused" } }; }));
    expect(body().querySelector(".panel.mut")?.textContent).toBe("Analysis not available yet (error).");
  });
  it("says 'loading' when the analysis gives no state, and still draws what the decision is made of", () => {
    show(variant((s) => { s.analysis = { available: false }; }));
    expect(body().querySelector(".panel.mut")?.textContent).toBe("Analysis not available yet (loading).");
    expect(sec("a-strat")).not.toBeNull();
    show(variant((s) => { delete s.analysis; }));
    expect(body().querySelector(".panel.mut")?.textContent).toBe("Analysis not available yet (loading).");
  });
  it("has no regime, permission or strategy sections when there is no decision", () => {
    show(variant((s) => { s.trading = null; }));
    expect(sec("a-strat")).toBeNull();
    expect(sec("a-regime")).toBeNull();
    expect(sec("a-tech")).not.toBeNull();
    expect(sec("a-levels").textContent).toContain("Opening range: not available"); // (the opening range comes from the decision's session)
  });
});

describe("the bar", () => {
  it("says the direction, the volatility, how the timeframes agree, and that the data is complete", () => {
    show(base);
    const bar = body().querySelector(".bar")!;
    expect([...bar.children].map((c) => c.textContent)).toEqual(["Direction ▲ BULLISH", "Volatility normal", "Timeframes aligned bullish", "completed candles only; the forming candle is shown separately", "data complete"]);
    expect(bar.querySelector("b")?.className).toBe("up");
    expect(bar.children[2]?.getAttribute("title")).toBe("1H and 15M are both bullish: higher-timeframe bullish alignment (trend continuation).");
    expect(bar.lastElementChild?.className).toBe("up");
  });
  it("says in amber when the data is not complete, and a bearish direction in red", () => {
    show(variant((s) => { s.analysis!.reliable = false; s.analysis!.condition!.trend = "bearish"; s.analysis!.warnings = ["1M is missing 2 candles"]; }));
    expect(body().querySelector(".bar")?.lastElementChild?.textContent).toBe("⚠ incomplete data — see warnings");
    expect(body().querySelector(".bar")?.lastElementChild?.className).toBe("flat");
    expect(body().querySelector(".bar b")?.textContent).toBe("▼ BEARISH");
    expect(body().querySelector(".bar b")?.className).toBe("down");
    expect(body().firstElementChild?.textContent).toBe("⚠ 1M is missing 2 candles");
  });
});

describe("the sections", () => {
  it("are in the order the decision is made, and the tables read less often come after", () => {
    show(base);
    expect([...body().querySelectorAll(":scope > details.sec")].map((d) => d.getAttribute("data-key"))).toEqual([
      "a-regime", "a-ct", "a-strat", "a-setups", "a-tech", "a-struct", "a-levels", "a-candles", "a-health", "a-contracts", "a-gaps",
    ]);
    expect([...body().querySelectorAll(":scope > details.sec > summary")].map((s) => s.firstChild?.textContent)).toEqual([
      "Market regime facts", "Counter-trend permission", "Strategy analysis: all ten strategies", "Ended setups", "Technical analysis: 1H · 15M · 5M · 1M", "Market structure", "Support, resistance and reference levels",
      "Candle information", "Data health detail", "Instruments and contracts", "Data gaps and errors",
    ]);
    expect(sec("a-gaps").querySelector("summary .mut")).toBeNull(); // (the last has no hint)
    expect(sec("a-strat").querySelector("summary .mut")?.textContent).toBe("each side on its own: state, trigger, entry zone, invalidation, expiry, evidence, blockers");
  });
  it("does not show a 'Confirmation, invalidation and blockers' section: the current dashboard builds it and discards it, and so does this", () => {
    show(base);
    expect(sec("a-confirm")).toBeNull();
    expect(body().textContent).not.toContain("Confirmation, invalidation and blockers");
  });
  it("opens at the start the sections the current dashboard opens, and the strategy that holds a live setup", () => {
    show(base);
    expect([...body().querySelectorAll("details")].filter((d) => d.open).map((d) => d.getAttribute("data-key"))).toEqual(["a-strat", "sd-trend_pullback", "a-setups", "a-tech", "a-struct", "a-levels", "a-health"]);
  });
  it("is the page's to open and close: a click is kept, and the others are left alone", async () => {
    show(base);
    fireEvent.click(sec("a-regime").querySelector("summary")!);
    fireEvent.click(sec("a-tech").querySelector("summary")!);
    await settle();
    expect(sec("a-regime").open).toBe(true);
    expect(sec("a-tech").open).toBe(false);
    expect(sec("a-struct").open).toBe(true);
  });
});

describe("the regime facts", () => {
  it("are six cards, each with its state in its colour and the checks it was made from", () => {
    show(base);
    const cards = [...sec("a-regime").querySelectorAll(".card")];
    expect(cards.map((c) => c.firstElementChild?.firstElementChild?.textContent)).toEqual(["Strong trend", "Weakening trend", "Compression", "Volatility expansion", "Extended market", "Range / pause / pullback / breakout"]);
    expect(cards.map((c) => c.querySelectorAll("div > b")[1]?.className)).toEqual(["up", "mut", "mut", "mut", "mut", "flat"]);
    expect(secText("a-regime")).toContain("What kind of market this is, with the evidence. These sit beside the Condition above and never change it; none is a signal and there is no score. As of the 15M candle ending 10:45.");
    expect(cards[0]?.querySelector(".why.up")?.textContent).toBe("✓ 1H and 15M both bullish: 1H bullish, 15M bullish");
    expect(cards[1]?.querySelector(".why.flat")?.textContent).toMatch(/^✗ ADX falling: /);
    expect(cards[3]?.querySelector(".why.mut")?.textContent).toMatch(/^\? strong directional candle: /);
  });
  it("say a check that is only reported is not a condition", () => {
    show(variant((s) => { t(s).market!.regime_facts!.facts.extended!.checks = [{ name: "round number", text: "24,300 is near", ok: true, info: true }]; }));
    const c = [...sec("a-regime").querySelectorAll(".card")][4]!;
    expect(c.querySelector(".why")?.className).toBe("why mut");
    expect(c.querySelector(".why")?.textContent).toBe("✓ round number: 24,300 is near (reported, not a condition)");
  });
  it("say the layer is unavailable, with the reason, and show none of its states", () => {
    show(variant((s) => { t(s).market!.regime_facts!.available = false; t(s).market!.regime_facts!.why = "the 15M data is incomplete"; }));
    expect(sec("a-regime").querySelector(".warnbox")?.textContent).toBe("⚠ Regime facts unavailable: the 15M data is incomplete. Every fact is unknown, and nothing is assumed.");
    expect(sec("a-regime").querySelectorAll(".card")).toHaveLength(0);
  });
  it("say they are not available yet when there are none", () => {
    show(variant((s) => { t(s).market!.regime_facts = null; }));
    expect(secText("a-regime")).toBe("The regime facts are not available yet.");
    show(variant((s) => { t(s).market = null; }));
    expect(secText("a-regime")).toBe("The regime facts are not available yet.");
  });
  it("show a state the page does not know in grey, and a held one in its name without underscores", () => {
    show(variant((s) => { t(s).market!.regime_facts!.facts.pause!.state = "range_bound"; t(s).market!.regime_facts!.facts.compression!.state = "something_new"; }));
    const heads = [...sec("a-regime").querySelectorAll(".card > div:first-child")];
    expect(heads[5]?.textContent).toMatch(/^Range \/ pause \/ pullback \/ breakout — range bound /);
    expect(heads[5]?.querySelectorAll("b")[1]?.className).toBe("flat");
    expect(heads[2]?.querySelectorAll("b")[1]?.className).toBe("mut");
  });
});

describe("the counter-trend permission", () => {
  it("says what it is, and for each side that needs a decision whether it was granted, and the checks in their groups", () => {
    show(base);
    const text = secText("a-ct");
    expect(text).toContain("Only Trend Exhaustion Reversal may trade against the 1H or 15M trend, and only after a confirmed 15M structural reversal; a 5M break is still required, and every other check still applies. Granted or denied, it is recorded here and in the journal.");
    const card = sec("a-ct").querySelector(".card")!;
    expect(card.className).toBe("card pe");
    expect(card.firstElementChild?.textContent).toBe("PE · Trend Exhaustion Reversal — counter-trend permission DENIED needed: the 1H or 15M trend runs against PE");
    expect(card.firstElementChild?.querySelector("b.flat")?.textContent).toBe("DENIED");
    expect(card.textContent).toContain("denied: weakening continuation (regime fact: 0 of 6 weakening checks hold (needs 2))");
    expect([...card.querySelectorAll(":scope > div > b")].map((b) => b.textContent)).toEqual(["PE", "DENIED", "1. an established trend (or an extension)", "2. the continuation is weakening", "3. a confirmed 15M structural change"]);
    expect(card.querySelectorAll(".why")).toHaveLength(7 + 1); // seven checks, and the line that says there is no confirmed structure
    expect(card.textContent).toContain("no confirmed 15M structural change yet");
  });
  it("says granted in green, not needed in other words, the structure in real prices, and the setup it permitted", () => {
    show(variant((s) => {
      Object.assign(t(s).counter_trend[0]!, { granted: true, needed: false, setup_id: "trend_exhaustion_reversal:bear:5", structure: { exhaustion_extreme: 24300, higher_low: 24100, lower_high: 24280, higher_high: 24320, prior_high: 24330, leg: 80, confirmed_at: 1793942400 } });
    }));
    const card = sec("a-ct").querySelector(".card")!;
    expect(card.firstElementChild?.querySelector("b.up")?.textContent).toBe("GRANTED");
    expect(card.firstElementChild?.textContent).toContain("not needed: neither the 1H nor the 15M trend runs against PE");
    expect(card.textContent).toContain("Structural evidence (real prices)");
    expect(card.textContent).toContain("exhaustion high 24300.00 · 15M lower high 24100.00 · higher low before it 24280.00 · 15M lower low 24320.00 · prior low 24330.00 · leg 80.0 pts · confirmed 10:50");
    expect(card.textContent).toContain("the setup it permitted: trend_exhaustion_reversal:bear:5");
    expect(card.textContent).not.toContain("no confirmed 15M structural change yet");
  });
  it("leaves out a group that has no checks, and says there is nothing to decide when there is no permission", () => {
    show(variant((s) => { t(s).counter_trend[0]!.checks = t(s).counter_trend[0]!.checks!.filter((c) => c.group !== "weakening"); }));
    expect(sec("a-ct").textContent).not.toContain("2. the continuation is weakening");
    show(variant((s) => { t(s).counter_trend = []; }));
    expect(sec("a-ct").querySelector(".card")).toBeNull();
    expect(secText("a-ct")).toContain("Nothing to decide: there is no established trend or extension to reverse.");
  });
});

describe("the strategies", () => {
  it("are all ten, each a line with its sides' states and what suits it", () => {
    show(base);
    const all = [...sec("a-strat").querySelectorAll("details.sd")];
    expect(all).toHaveLength(10);
    const first = all[0]!;
    expect(first.querySelector(".nm")?.textContent).toBe("Trend Pullback");
    expect(first.querySelector("summary > span:nth-child(2)")?.textContent).toBe("CE confirmed PE inactive");
    expect(first.querySelector(".sn")?.textContent).toBe("suits the market (CE side): Bullish trend (1H ADX 100.0): 1H bullish, 15M bullish");
    expect(first.querySelector(".sn")?.getAttribute("title")).toBe(first.querySelector(".sn")?.textContent);
    expect([...first.querySelectorAll("summary .pillst")].map((p) => p.className)).toEqual(["pillst ", "pillst mut"]); // the side that does not apply is grey
    expect(all[9]?.querySelector(".nm")?.textContent).toBe("Trend Exhaustion Reversal");
    expect(secText("a-strat")).toContain("Every strategy, each side on its own: a strategy that holds a live setup opens by itself. The CE and PE reasons are never merged.");
  });
  it("say, inside, what suits the market, the strategy's id, and each side on its own", () => {
    show(base);
    const body_ = sd("breakout_retest").querySelector(".sdbody")!;
    expect(body_.firstElementChild?.textContent).toBe("Market conditions: suits the market (CE side): Bullish trend (1H ADX 100.0): 1H bullish, 15M bullish · id breakout_retest".replace(/suits the market.*?: 1H bullish, 15M bullish/, body_.firstElementChild!.textContent!.replace("Market conditions: ", "").replace(/ · id breakout_retest$/, "")));
    expect(body_.firstElementChild?.textContent).toMatch(/^Market conditions: .+ · id breakout_retest$/);
    expect([...body_.querySelectorAll(".side")].map((x) => x.className)).toEqual(["side ce", "side pe"]);
    expect([...body_.querySelectorAll(".side")].map((x) => x.firstElementChild?.textContent)).toEqual(["CE (call)", "PE (put)"]);
  });
  it("say a side with no setup: 'no setup', or why it is not applicable, or that it was not scanned", () => {
    show(variant((s) => {
      const z = t(s).strategies.find((x) => x.id === "breakout_retest")!;
      z.sides[0]!.note = ""; z.sides[0]!.scanned = true; z.sides[1]!.note = "1H is bullish: only a bearish 1H trend"; z.sides[1]!.applicable = false;
    }));
    const sides = [...sd("breakout_retest").querySelectorAll(".side")];
    expect(sides[0]?.querySelector(":scope > div")?.className).toBe("mut");
    expect(sides[0]?.querySelector(":scope > div")?.textContent).toBe("no setup");
    expect(sides[1]?.querySelector(":scope > .why.flat")?.textContent).toBe("not applicable: 1H is bullish: only a bearish 1H trend");
    show(variant((s) => { const z = t(s).strategies.find((x) => x.id === "breakout_retest")!; z.sides[0]!.note = "volatility is low"; z.sides[0]!.applicable = true; }));
    expect(sd("breakout_retest").querySelector(".side .why.flat")?.textContent).toBe("no setup: volatility is low");
    show(variant((s) => { const z = t(s).strategies.find((x) => x.id === "breakout_retest")!; z.sides[0]!.note = ""; z.sides[0]!.scanned = false; }));
    expect(sd("breakout_retest").querySelector(".side .mut")?.textContent).toBe("not scanned: the market is closed or has not opened");
  });
  it("give a side only its own live setup: the side that does not apply says why, not the other side's setup", () => {
    show(base);
    const sides = [...sd("trend_pullback").querySelectorAll(".side")];
    expect(sides[0]?.textContent).toContain("Entry area 24281.00");
    expect(sides[1]?.textContent).toBe("PE (put) inactiveno setup: 1H is bullish: pullbacks are only taken with a bearish 1H trend".replace("no setup:", "not applicable:"));
    expect(sides[1]?.textContent).not.toContain("Entry area");
  });
  it("say the last setup that ended today on a side", () => {
    show(variant((s) => { t(s).recent = [copy({ id: "br:bull:1", strategy: "breakout_retest", strategy_name: "Breakout and Retest", direction: "CE", status: "INVALIDATED", note: "a completed 5M candle closed below 24,270" })]; }));
    const line = sd("breakout_retest").querySelector(".side .why.mut")!;
    expect(line.textContent).toBe("last ended today: invalidated — a completed 5M candle closed below 24,270");
    expect(line.querySelector(".st")?.className).toBe("st st-INVALIDATED");
    expect([...sd("breakout_retest").querySelectorAll(".side")][1]?.textContent).not.toContain("last ended"); // (the other side did not end)
  });
  it("end with the decision: its headline, reasons for and against, who agrees, the market in words and the context", () => {
    show(variant((s) => { t(s).decision.also = ["Range Bounce"]; }));
    const text = secText("a-strat");
    expect(text).toContain("CE setup ready: Trend Pullback setup confirmed");
    expect(text).toContain("+ 1H bullish (ADX 100.0); 15M bullish with HH_HL structure");
    expect(text).toContain("− 15M RSI 73.9: momentum is already stretched in this direction");
    expect(text).toContain("also matches: Range Bounce");
    expect(text).toContain(t(base).market!.text);
    expect(text).toContain("opened +0 pts (0.00%) from the previous close · candle size ATR5 6.1, ATR15 13.2 · data complete · price age 1.0 s");
  });
  it("say nobody agrees by saying nothing", () => {
    show(base);
    expect(secText("a-strat")).not.toContain("also matches");
  });
  it("say incomplete data in amber, an unknown price age as a dash, and leave out a context that is not there", () => {
    show(variant((s) => { t(s).data = { ok: false, issues: ["x"], price_age: null }; t(s).market!.gap = null; t(s).market!.atr = null; }));
    const ctx = sec("a-strat").querySelector(".secbody > div:last-child")!;
    expect(ctx.textContent).toBe("data incomplete · price age –");
    expect(ctx.querySelector("b.flat")?.textContent).toBe("incomplete");
    show(variant((s) => { t(s).data = null; t(s).market = null; }));
    expect(secText("a-strat")).not.toContain("price age");
    expect([...sec("a-strat").querySelectorAll(".secbody > div")].filter((d) => d.textContent === "")).toHaveLength(0); // (no empty line is left where the context was)
  });
  it("say there is no strategy data when there is none", () => {
    show(variant((s) => { t(s).strategies = []; }));
    expect(secText("a-strat")).toContain("no strategy data");
    expect(sec("a-strat").querySelectorAll("details.sd")).toHaveLength(0);
  });
});

describe("a strategy's live setup", () => {
  const card = () => sd("trend_pullback").querySelector(".side.ce > div:not(.mut):not(.why)")!;
  it("says its stage, when it was detected and confirmed, and that it is actionable now", () => {
    show(base);
    const x = sd("trend_pullback").querySelector(".side.ce")!;
    expect(x.firstElementChild?.textContent).toBe("CE (call)");
    expect(x.querySelector(":scope > div > div:first-child")?.textContent).toBe("READY: in the entry area detected 10:40 · confirmed 10:55 · this status since 10:55 — actionable now");
    expect(x.querySelector(":scope > div > div:first-child b")?.className).toBe("up");
    expect(x.querySelector(":scope > div > div:first-child .st")?.className).toBe("st st-READY_TO_ACT");
    expect(card()).toBeTruthy();
  });
  it("says its prices, its plan in index points, its wording, what confirms it and why, with the checks and what is against it", () => {
    show(base);
    const text = sd("trend_pullback").querySelector(".side.ce")!.textContent!;
    expect(text).toContain("Entry area 24281.00 – 24287.06 · trigger 24281.00 · invalidation 24270.48 · leg origin 24249.45 (support 24270.55, 24264.50)");
    expect(text).toContain("Underlying plan, index points from the trigger 24281.00: risk 10.5 pts · T1 24308.00");
    expect(text).toContain("Expiry · status (Prism's wording): confirmed, price is in the entry area and nothing blocks entry");
    expect(text).toContain("To confirm: ");
    expect(text).toContain("+ 1H bullish (ADX 100.0); 15M bullish with HH_HL structure");
    expect(text).toContain("✓ Entry location: invalidation 10.5 pts away");
    expect(text).toContain("− 15M RSI 73.9: momentum is already stretched in this direction");
    expect(sd("trend_pullback").querySelectorAll(".side.ce .why.mut")).toHaveLength(5); // (the five quality checks that hold are grey)
  });
  it("says no level when the setup sits at none", () => {
    show(variant((s) => { t(s).setups[0]!.level = null; }));
    const line = [...sd("trend_pullback").querySelectorAll(".side.ce > div > div")].find((d) => d.textContent!.includes("invalidation"))!;
    expect(line.textContent).toBe("Entry area 24281.00 – 24287.06 · trigger 24281.00 · invalidation 24270.48 (support 24270.55, 24264.50)");
  });
  it("says a watch area before it is confirmed, no trigger when there is none, and the level it sits at", () => {
    show(variant((s) => { Object.assign(t(s).setups[0]!, { status: "WAITING_FOR_CONFIRMATION", stage: "WAITING_FOR_CONFIRMATION", trigger: null, support: [24200.5], resistance: [24400, 24450] }); }));
    const line = [...sd("trend_pullback").querySelectorAll(".side.ce > div > div")].find((d) => d.textContent!.includes("invalidation"))!;
    expect(line.textContent).toBe("Watch area 24281.00 – 24287.06 · invalidation 24270.48 · leg origin 24249.45 (support 24200.50 · resistance 24400.00, 24450.00)");
    expect(line.textContent).not.toContain("trigger");
  });
  it.each([
    ["READY_TO_ACT", "CONFIRMED", null, "actionable now", "up"],
    ["BLOCKED", "WAITING_FOR_CONFIRMATION", null, "not actionable: see the blockers", "flat"],
    ["CONFIRMED", "CONFIRMED", "above_entry_area", "not actionable: above entry area", "flat"],
  ])("says a %s setup is: %s", (stage, status, priceState, words, klass) => {
    show(variant((s) => { Object.assign(t(s).setups[0]!, { stage, status, price_state: priceState }); }));
    const live = sd("trend_pullback").querySelector(".side.ce > div > div:first-child b")!;
    expect(live.textContent).toBe(words);
    expect(live.className).toBe(klass);
  });
  it("says nothing of its state when it is only waiting, and says it was resumed after a restart", () => {
    show(variant((s) => { Object.assign(t(s).setups[0]!, { status: "WAITING_FOR_CONFIRMATION", stage: "WAITING_FOR_CONFIRMATION", confirmed_at: null, resumed: true }); }));
    const first = sd("trend_pullback").querySelector(".side.ce > div > div:first-child")!;
    expect(first.textContent).toBe("waiting for a confirming candle detected 10:40 · this status since 10:55 · resumed after a restart");
    expect(first.querySelector("b")).toBeNull();
  });
  it("says a stale page's setup is last known, and a ready one was in the entry area", () => {
    const ready = variant((s) => { t(s).strategies.find((z) => z.id === "trend_pullback")!.sides[0]!.state = "READY_TO_ACT"; });
    show(ready, { stale: true });
    const first = sd("trend_pullback").querySelector(".side.ce > div > div:first-child")!;
    expect(first.textContent).toContain("was in the entry area (not current)");
    expect(first.textContent).toContain("— last known (STALE): not actionable");
    expect(sd("trend_pullback").querySelector("summary")?.textContent).toContain("CE was ready"); // (a side that was ready is said to have been)
    show(ready);
    expect(sd("trend_pullback").querySelector("summary")?.textContent).toContain("CE ready");
  });
  it("says what blocks it, a note, and the counter-trend permission it was given with its structure", () => {
    show(variant((s) => {
      Object.assign(t(s).setups[0]!, { blockers: ["only 18.0 pts to the next level"], note: "resumed from the journal", quality: [{ name: "Room", ok: false, text: "short of room" }], counter_trend: { needed: true, granted: true, reason: "an established trend", structure: { exhaustion_extreme: 24300, higher_low: 24100, lower_high: 24280, higher_high: 24320, prior_high: 24330, leg: 80, confirmed_at: 1793942400 } } });
    }));
    const x = sd("trend_pullback").querySelector(".side.ce")!;
    expect(x.querySelector(".why.flat")?.textContent).toBe("⚠ Room: short of room");
    expect([...x.querySelectorAll(".why.flat")].map((d) => d.textContent)).toEqual(["⚠ Room: short of room", "⏸ only 18.0 pts to the next level", "− 15M RSI 73.9: momentum is already stretched in this direction"]);
    expect(x.textContent).toContain("⚑ Counter-trend permission granted: an established trend");
    expect(x.textContent).toContain("exhaustion low 24300.00 · 15M higher low 24100.00");
    expect(x.querySelector(".why.up:not(:first-of-type)")).not.toBeNull();
    expect(x.textContent).toContain("resumed from the journal");
    show(variant((s) => { Object.assign(t(s).setups[0]!, { counter_trend: { needed: true, granted: false, reason: "no structure", structure: null } }); }));
    expect(sd("trend_pullback").textContent).toContain("⚑ Counter-trend permission denied: no structure");
  });
});

describe("the reversal evidence of the counter-trend strategy", () => {
  const ev = () => sd("trend_exhaustion_reversal").querySelector(".side:not(.ce):not(.pe)")!;
  it("says the weakening trend with its checks, the permission and the 5M confirmation", () => {
    show(base);
    const e = ev();
    expect(e.textContent).toContain("Reversal evidence (Trend Exhaustion Reversal)");
    expect(e.textContent).toContain("Weakening trend (regime fact: none — 0 of 6 weakening checks hold (needs 2))");
    expect(e.querySelectorAll(".why")).toHaveLength(6 + 1 + 3 + 1); // six weakening checks, the permission's line, the three of its seven checks that do not hold, and "nothing to confirm yet"
  });
  it("lists the permission's checks that do not hold, not the ones that do", () => {
    show(base);
    const e = ev();
    expect(e.textContent).toContain("PE: permission DENIED — denied: weakening continuation (regime fact: 0 of 6 weakening checks hold (needs 2))");
    const denied = [...e.querySelectorAll(".why.flat")].map((d) => d.textContent!);
    expect(denied.filter((x) => x.startsWith("✗ structure turned"))).toHaveLength(1);
    expect(denied.some((x) => x.startsWith("✗ weakening continuation"))).toBe(true);
    expect(e.textContent).not.toContain("✓ an established trend"); // (a check that holds is not listed here)
  });
  it("says there is nothing to confirm yet when there is no setup", () => {
    show(base);
    expect(ev().textContent).toContain("5M confirmation5M confirmation: nothing to confirm yet: no setup exists until the 15M structural change has been confirmed");
  });
  it("says a setup's 5M confirmation: not yet, with what confirms it, or done", () => {
    show(variant((s) => { t(s).setups.push(copy({ id: "trend_exhaustion_reversal:bear:7", strategy: "trend_exhaustion_reversal", strategy_name: "Trend Exhaustion Reversal", direction: "PE", candle_confirmed: false, confirm_text: "a completed 5M candle closing below 24,250" })); }));
    expect(ev().textContent).toContain("PE · 5M confirmation: not yet: a completed 5M candle closing below 24,250");
    expect(ev().querySelector(".why.mut:last-child")?.textContent).toMatch(/^PE · 5M confirmation: not yet/);
    show(variant((s) => { t(s).setups.push(copy({ id: "trend_exhaustion_reversal:bear:7", strategy: "trend_exhaustion_reversal", direction: "PE", candle_confirmed: true })); }));
    expect(ev().textContent).toContain("PE · 5M confirmation: a completed 5M candle has closed through the trigger");
    expect(ev().querySelector(".why.up:last-child")).not.toBeNull();
  });
  it("says there is nothing to decide with no permission, and that the weakening trend is not available", () => {
    show(variant((s) => { t(s).counter_trend = []; t(s).market!.regime_facts = null; }));
    expect(ev().textContent).toContain("nothing to decide: there is no established trend or extension to reverse");
    expect(ev().textContent).toContain("Weakening trend (regime fact: unknown)");
    expect(ev().textContent).toContain("not available");
  });
  it("shows a permission's structure, in real prices, after its checks", () => {
    show(variant((s) => { t(s).counter_trend[0]!.structure = { exhaustion_extreme: 24300, higher_low: 24100, lower_high: 24280, higher_high: 24320, prior_high: 24330, leg: 80, confirmed_at: 1793942400 }; }));
    expect(ev().textContent).toContain("exhaustion high 24300.00");
  });
  it("lists only its own strategy's permissions, not another's", () => {
    show(variant((s) => { t(s).counter_trend.push({ needed: true, granted: true, reason: "another strategy's permission", side: "CE", strategy: "some_other_strategy", strategy_name: "Some Other", checks: [], structure: null }); }));
    expect(ev().textContent).not.toContain("another strategy's permission");
    expect(sec("a-ct").textContent).toContain("another strategy's permission"); // (the permission section lists every one)
  });
  it("is only for that strategy", () => {
    show(base);
    expect(sd("trend_pullback").textContent).not.toContain("Reversal evidence");
    expect(body().textContent!.match(/Reversal evidence/g)).toHaveLength(1);
  });
});

describe("ended setups", () => {
  it("say none today, or each with its side, strategy, how it ended and why", () => {
    show(base);
    expect(secText("a-setups")).toBe("none today");
    show(variant((s) => { t(s).recent = [copy({ direction: "PE", strategy_name: "Range Bounce", status: "EXPIRED", note: "no confirmation within 30 minutes" }), copy({ status: "INVALIDATED", note: "closed below" })]; }));
    expect([...sec("a-setups").querySelectorAll(".secbody > div")].map((d) => d.textContent)).toEqual(["PE Range Bounce: expired — no confirmation within 30 minutes", "CE Trend Pullback: invalidated — closed below"]);
  });
});

describe("the indicator tables", () => {
  it("give each timeframe's trend, averages, momentum, directional strength, ATR and breakout", () => {
    show(base);
    const rows = [...sec("a-tech").querySelectorAll("tr")].slice(1).map((r) => [...r.children].map((c) => c.textContent));
    expect(rows).toEqual([
      ["1H", "▲ bullish", "24049.81", "23649.32", "96.8", "100.0", "76.6", "0.0", "36.11", "–"],
      ["15M", "▲ bullish", "24237.38", "24128.47", "73.9", "70.7", "61.3", "18.9", "13.19", "–"],
      ["5M", "▲ bullish", "24279.15", "24250.00", "60.9", "47.7", "40.2", "27.8", "6.06", "–"],
      ["1M", "▲ bullish", "24282.05", "24283.88", "52.5", "35.7", "30.9", "27.5", "3.21", "–"],
    ]);
    expect(sec("a-tech").querySelector("tr:nth-child(2) td.l")?.className).toBe("l up");
    expect(secText("a-tech")).toContain("1H and 15M are both bullish: higher-timeframe bullish alignment (trend continuation).");
    expect(sec("a-tech").querySelector(".secbody > .mut")?.querySelectorAll("br")).toHaveLength(7); // eight reasons, one under the other
  });
  it("say a timeframe is warming up, a bearish one in red, and a breakout", () => {
    show(variant((s) => { Object.assign(s.analysis!.timeframes!["5m"]!, { warm: false, trend: "bearish", breakout: "breakdown" }); }));
    const r = [...sec("a-tech").querySelectorAll("tr")][3]!;
    expect(r.children[1]?.textContent).toBe("▼ bearish (warming up)");
    expect(r.children[1]?.className).toBe("l down");
    expect(r.children[9]?.textContent).toBe("breakdown");
  });
  it("show a value it does not have as a dash, never a zero", () => {
    show(variant((s) => { Object.assign(s.analysis!.timeframes!["1m"]!, { ema20: null, rsi14: null, adx: null, atr14: null }); }));
    expect([...[...sec("a-tech").querySelectorAll("tr")][4]!.children].map((c) => c.textContent).slice(2, 9)).toEqual(["–", "24283.88", "–", "–", "30.9", "27.5", "–"]);
  });
});

describe("market structure", () => {
  it("says each timeframe's pattern in words, its last swing high and low with their time, and its range", () => {
    show(base);
    const rows = [...sec("a-struct").querySelectorAll("tr")].slice(1).map((r) => [...r.children].map((c) => c.textContent));
    expect(rows.map((r) => r[1])).toEqual(["not enough swings", "higher highs, higher lows", "higher highs, higher lows", "higher highs, higher lows · range"]);
    expect(rows[3]?.[4]).toBe("24277.50 – 24286.00");
    expect(rows[0]?.[4]).toBe("–");
    expect(rows[1]?.[2]).toMatch(/^24308\.00 \(\d\d \w{3}, \d\d:\d\d\)$/);
    expect(rows[1]?.[3]).toMatch(/^24249\.45 \(06 Nov, 10:?\d?\d?:?\d*\)$|^24249\.45 \(\d\d \w{3}, \d\d:\d\d\)$/);
    expect(sec("a-struct").querySelectorAll(".secbody > .mut")).toHaveLength(3);
    expect(secText("a-struct")).toMatch(/15M recent swings: low 24109\.45 · high 24200\.55/);
  });
  it("says a swing it does not have as a dash, and a pattern it does not know as it is", () => {
    show(variant((s) => { s.analysis!.timeframes!["5m"]!.structure = { pattern: "triangle", recent_swings: [] }; s.analysis!.timeframes!["1h"]!.structure = null; }));
    const rows = [...sec("a-struct").querySelectorAll("tr")].slice(1).map((r) => [...r.children].map((c) => c.textContent));
    expect(rows[2]).toEqual(["5M", "triangle", "–", "–", "–"]);
    expect(rows[0]?.slice(1)).toEqual(["–", "–", "–", "–"]);
    expect(secText("a-struct")).toContain("5M recent swings: –");
  });
});

describe("the levels", () => {
  it("say the previous day, the opening range, the session with the average price (not a VWAP), and the nearest levels", () => {
    show(base);
    const rows = [...sec("a-levels").querySelectorAll(".lv > div")].map((d) => d.textContent);
    expect(rows).toEqual([
      "Previous day (2026-11-05): PDH 24270.55 · PDL 24080.25 · PDC 24250.00",
      "Opening range: 24249.50 – 24264.50",
      "Session 2026-11-06: open 24250.00 · VWAP not available (No traded volume for this instrument (NIFTY is an index): VWAP is not available) · session average price (not a VWAP) 24280.88",
      "Resistance – \u00a0·\u00a0 Support –",
    ]);
  });
  it("say the previous day is stale, the opening range is forming, and give a VWAP when there is one", () => {
    show(variant((s) => { s.analysis!.reference!.previous_day!.stale = true; s.analysis!.reference!.vwap = 24281.5; t(s).session!.opening_range!.complete = false; s.analysis!.levels = { support: [{ price: 24200, touches: 3 }, { price: 24150, touches: 2 }], resistance: [{ price: 24400, touches: 4 }] }; }));
    const rows = [...sec("a-levels").querySelectorAll(".lv > div")].map((d) => d.textContent);
    expect(rows[0]).toBe("Previous day (2026-11-05, stale): PDH 24270.55 · PDL 24080.25 · PDC 24250.00");
    expect(sec("a-levels").querySelector(".flat")?.textContent).toBe("stale");
    expect(rows[1]).toBe("Opening range: 24249.50 – 24264.50 (forming)");
    expect(rows[2]).toBe("Session 2026-11-06: open 24250.00 · VWAP 24281.50");
    expect(rows[3]).toBe("Resistance 24400.00 (x4) \u00a0·\u00a0 Support 24200.00 (x3), 24150.00 (x2)");
  });
  it("say what is not available, and a note when there is no volume note", () => {
    show(variant((s) => { s.analysis!.reference!.previous_day = null; t(s).session!.opening_range = null; s.analysis!.reference!.session_date = null; s.analysis!.reference!.vwap_note = null; }));
    const rows = [...sec("a-levels").querySelectorAll(".lv > div")].map((d) => d.textContent);
    expect(rows[0]).toBe("Previous day: not available");
    expect(rows[1]).toBe("Opening range: not available");
    expect(rows[2]).toContain("Session –: open 24250.00 · VWAP not available (no volume)");
  });
});

describe("candle information", () => {
  it("says each timeframe's last completed and forming candle, and what is missing", () => {
    show(base);
    const rows = [...sec("a-candles").querySelectorAll(".scroll")[0]!.querySelectorAll("tr")].slice(1).map((r) => [...r.children].map((c) => c.textContent));
    expect(rows.map((r) => [r[0], r[1], r[2]])).toEqual([["1H", "bullish", "0 / 0"], ["15M", "bullish", "0 / 0"], ["5M", "bullish", "0 / 0"], ["1M", "bullish", "0 / 0"]]);
    expect(rows[2]?.[3]).toMatch(/^06 Nov, 10:50 C 24285\.00$/);
    expect(rows[2]?.[4]).toMatch(/^06 Nov, 10:55 C 24287\.00 \(partial\)$/);
    expect(sec("a-candles").querySelector("td.mut")?.textContent).toBe("0 / 0");
  });
  it("says missing candles in amber, a missing candle as a dash, and a forming candle that is whole without 'partial'", () => {
    show(variant((s) => { s.analysis!.timeframes!["15m"]!.missing = { latest_session_missing: 2, missing: 5 }; s.analysis!.timeframes!["15m"]!.last_completed = null; s.analysis!.forming!["5m"]!.partial = false; s.analysis!.forming!["1m"] = null; }));
    const rows = [...sec("a-candles").querySelectorAll(".scroll")[0]!.querySelectorAll("tr")].slice(1);
    expect(rows[1]?.children[2]?.textContent).toBe("2 / 5");
    expect(rows[1]?.children[2]?.className).toBe("partial");
    expect(rows[1]?.children[3]?.textContent).toBe("–");
    expect(rows[2]?.children[4]?.textContent).not.toContain("partial");
    expect(rows[3]?.children[4]?.textContent).toBe("–");
  });
  it("lists the live candles of the charted instruments only, current and last closed", () => {
    show(base);
    const rows = [...sec("a-candles").querySelectorAll(".scroll")[1]!.querySelectorAll("tr")].slice(1).map((r) => [...r.children].map((c) => c.textContent));
    expect(rows).toHaveLength(20); // the NIFTY spot and the four at-the-money options, each in four timeframes: the other strikes are analysed in Options
    expect(rows.map((r) => [r[0], r[1]]).slice(0, 4)).toEqual([["SPOT", "1m"], ["SPOT", "5m"], ["SPOT", "15m"], ["SPOT", "1h"]]);
    expect([...new Set(rows.map((r) => r[0]))].sort()).toEqual(["ATM_CE", "ATM_PE", "ITM_CE", "ITM_PE", "SPOT"]);
    expect(rows[1]?.[2]).toBe("10:55 partial");
    expect(rows[1]?.slice(3, 9)).toEqual(["24287.00", "24287.00", "24287.00", "24287.00", "–", "1"]);
    expect(rows[1]?.[9]).toBe("–"); // (nothing has completed on the live feed yet: the closed candles are the history's)
    expect(sec("a-candles").querySelector("span.partial[title]")?.getAttribute("title")).toBe("partial: data gap or app started mid-candle");
  });
  it("says there is no candle yet, a last closed candle that is partial or from history, and a missing one", () => {
    show(variant((s) => {
      const c = s.instruments[0]!.candles!;
      c["1m"]!.current = null; c["5m"]!.last_closed = { ...c["5m"]!.last_closed!, partial: true }; c["15m"]!.last_closed = { ...c["15m"]!.last_closed!, source: "history" }; c["1h"]!.last_closed = null;
    }));
    const rows = [...sec("a-candles").querySelectorAll(".scroll")[1]!.querySelectorAll("tr")].slice(1);
    expect(rows[0]?.querySelector("td.mut[colspan]")?.textContent).toBe("no candle yet");
    expect(rows[1]?.lastElementChild?.textContent).toMatch(/ partial$/);
    expect(rows[2]?.lastElementChild?.textContent).toMatch(/\(hist\)$/);
    expect(rows[3]?.lastElementChild?.textContent).toBe("–");
    expect(rows[3]?.lastElementChild?.className).toBe("mut l");
  });
  it("says what history Prism holds, when it was refreshed, its coverage, and when something is wrong with it", () => {
    show(base);
    const lv = sec("a-candles").querySelector(".lv.mut")!;
    expect([...lv.children].map((d) => d.textContent)).toEqual([
      "Historical data: ready",
      expect.stringMatching(/^Last successful refresh: 06\/11\/2026, 10:55:05 IST \(for session 2026-11-06\)$/),
      expect.stringMatching(/^Coverage: 1M 10600 candles \(.+ → .+\) · 5M 2120 candles .+ · 15M 706 candles .+ · 1D 29 candles .+$/),
    ]);
    show(variant((s) => { Object.assign(s.analysis!.history!, { state: "error", error: "Angel One refused", stale: true, loaded_at: null, coverage: {} }); }));
    const lv2 = sec("a-candles").querySelector(".lv.mut")!;
    expect(lv2.children[0]?.textContent).toBe("Historical data: error — Angel One refused");
    expect(lv2.children[0]?.querySelector(".flat")?.textContent).toBe("Angel One refused");
    expect(lv2.children[1]?.textContent).toBe("Last successful refresh: none yet — not refreshed for today's session");
    expect(lv2.children[2]?.textContent).toBe("Coverage: –");
  });
});

describe("the health detail", () => {
  it("says the start-up state, each stage with its mark, and the numbers an operator needs", () => {
    show(base);
    const h = sec("a-health");
    expect([...h.querySelector(".bar")!.children].map((c) => c.textContent)).toEqual(["READY", "data complete and trusted", "Decisions permitted yes"]);
    expect(h.querySelector(".bar b")?.className).toBe("up");
    const rows = [...h.querySelectorAll(".scroll")[0]!.querySelectorAll("tr")].slice(1).map((r) => [...r.children].map((c) => c.textContent));
    expect(rows).toHaveLength(8);
    expect(rows[0]).toEqual(["Configuration", "✓ done", "credentials present"]);
    expect(rows[7]).toEqual(["Live feed", "✓ done", "connected, NIFTY tick 1 s ago"]);
    expect([...h.querySelectorAll(".kv.four > div")].map((d) => d.textContent)).toEqual([
      "Uptime100 min", "Process–", "History refresh0 / 28 attempts", "Last successful refresh06/11/2026, 10:55:05", "Next retry–", "Missing todaynone", "In decision windownone",
      "Last recovery attemptnone", "Unavailable after retries0", "Background tasksnone", "Reconnects0", "Last NIFTY tick1 s ago",
    ]);
  });
  it("is amber for a start-up that is not ready, red for one that failed, and says decisions are not permitted", () => {
    show(variant((s) => { Object.assign(s.health.readiness!, { state: "RECOVERING_GAPS", ready: false, decisions_permitted: false, summary: "recovering missing candles" }); }));
    const bar = sec("a-health").querySelector(".bar")!;
    expect(bar.querySelector("b")?.textContent).toBe("RECOVERING GAPS");
    expect(bar.querySelector("b")?.className).toBe("flat");
    expect(bar.lastElementChild?.querySelector("b")?.textContent).toBe("no");
    expect(bar.lastElementChild?.querySelector("b")?.className).toBe("flat");
    show(variant((s) => { Object.assign(s.health.readiness!, { state: "FAILED", ready: false }); }));
    expect(sec("a-health").querySelector(".bar b")?.className).toBe("down");
  });
  it("marks each kind of stage, and a stage it does not know with a question mark", () => {
    show(variant((s) => { s.health.readiness!.stages = [{ label: "a", status: "active", detail: null }, { label: "b", status: "retrying", detail: "try 2" }, { label: "c", status: "pending", detail: "" }, { label: "d", status: "failed", detail: "no" }, { label: "e", status: "warn", detail: "slow" }, { label: "f", status: "odd", detail: "?" }]; }));
    const rows = [...sec("a-health").querySelectorAll(".scroll")[0]!.querySelectorAll("tr")].slice(1);
    expect(rows.map((r) => r.children[1]?.textContent)).toEqual(["… active", "↻ retrying", "○ pending", "✗ failed", "! warn", "? odd"]);
    expect(rows.map((r) => r.children[1]?.className)).toEqual(["l flat", "l flat", "l neu", "l down", "l flat", "l "]);
    expect(rows[0]?.children[2]?.textContent).toBe("");
  });
  it("says a limit of attempts it does not know as a dash", () => {
    show(variant((s) => { s.health.readiness!.history!.max_attempts = 0; }));
    const d = [...sec("a-health").querySelectorAll(".kv.four > div")].find((x) => x.firstElementChild?.textContent === "History refresh")!;
    expect(d.textContent).toBe("History refresh0 / – attempts");
  });
  it("says a connected feed has nothing to explain: its reason and attempt are for a feed that is down", () => {
    show(variant((s) => { Object.assign(s.health.feed, { reason: "an old reason", attempt: 4 }); }));
    expect(secText("a-health")).toContain("Feed: connected · ticks ok");
    expect(secText("a-health")).not.toContain("an old reason");
    expect(secText("a-health")).not.toContain("(attempt 4)");
  });
  it("says the history refresh, the missing candles and the recovery in colour, and the process", () => {
    show(variant((s) => {
      Object.assign(s.health.readiness!.history!, { attempts: 3, error: "rate limited", error_kind: "rate_limit", next_try_in: 150, last_success: null });
      Object.assign(s.health.readiness!.candles!, { missing_today: { "1m": 3 }, missing_in_decision_window: { "5m": 1, "15m": 2 }, unavailable_after_retries: 2 });
      Object.assign(s.health.diagnostics!, { instance: { pid: 4242 }, last_recovery_attempt: 1793942400, background_tasks: ["history", "validation"], reconnects: 2, last_spot_tick_age: 400, uptime_seconds: 30 });
    }));
    const d = Object.fromEntries([...sec("a-health").querySelectorAll(".kv.four > div")].map((x) => [x.firstElementChild!.textContent, x.querySelector("b")!]));
    expect(d["History refresh"]?.textContent).toBe("3 / 28 attempts");
    expect(d["History refresh"]?.getAttribute("title")).toBe("rate limited");
    expect(d["Last successful refresh"]?.textContent).toBe("none yet");
    expect(d["Next retry"]?.textContent).toBe("3 min");
    expect(d["Next retry"]?.getAttribute("title")).toBe("last failure: rate_limit");
    expect([d["Missing today"]?.textContent, d["Missing today"]?.className]).toEqual(["1M 3", "flat"]);
    expect([d["In decision window"]?.textContent, d["In decision window"]?.className, d["In decision window"]?.getAttribute("title")]).toEqual(["5M 1, 15M 2", "down", "5M and 15M candles Phase 3 needs complete"]);
    expect([d["Unavailable after retries"]?.textContent, d["Unavailable after retries"]?.className]).toEqual(["2", "down"]);
    expect(d.Process?.textContent).toBe("4242");
    expect(d.Process?.getAttribute("title")).toBe("the one Prism running on this PC");
    expect([d["Background tasks"]?.textContent, d.Reconnects?.textContent, d["Last NIFTY tick"]?.textContent, d.Uptime?.textContent, d["Last recovery attempt"]?.textContent]).toEqual(["history, validation", "2", "7 min ago", "30 s", "10:50:00"]);
  });
  it("says nothing it does not know: no diagnostics, no readiness", () => {
    show(variant((s) => { s.health.diagnostics = null; }));
    expect([...sec("a-health").querySelectorAll(".kv.four > div")].map((d) => d.textContent).filter((x) => /^(Uptime|Process|Background tasks|Reconnects)/.test(x!))).toEqual(["Uptime–", "Process–", "Background tasks–", "Reconnects–"]);
    show(variant((s) => { delete s.health.readiness; }));
    expect(sec("a-health").querySelector(".bar")).toBeNull();
    expect(sec("a-health").querySelector(".kv.four")).toBeNull();
  });
  it("lists each instrument by its own ticks, with its limit and its two clocks", () => {
    show(base);
    const rows = [...sec("a-health").querySelectorAll(".scroll")[sec("a-health").querySelectorAll(".scroll").length - 1]!.querySelectorAll("tr")].slice(1).map((r) => [...r.children].map((c) => c.textContent));
    expect(rows).toHaveLength(29);
    expect(rows[0]).toEqual(["SPOT", "Nifty 50", "fresh", "1 s", "20 s", "10:55:04", "10:55:05"]);
    expect(rows[1]?.[4]).toBe("30 s");
    expect([...sec("a-health").querySelectorAll("tr")].find((r) => r.children[0]?.textContent === "SPOT" && r.children[2]?.className)?.children[2]?.className).toBe("l up");
    expect(secText("a-health")).toContain("Each instrument is judged by its own ticks: option quotes never make the NIFTY spot look fresh. Spot limit is the strategy's price age; option quotes are shown only (no decision uses them yet).");
  });
  it("says the feed, the ticks and the clock", () => {
    show(base);
    expect(secText("a-health")).toContain("Feed: connected · ticks ok 29 · rejected 0 · reconnects 0 · last tick (any instrument) 10:55:05");
    expect(secText("a-health")).toContain("Clock: not checked");
    expect([...sec("a-health").querySelectorAll(".lv > div > .mut")].map((x) => x.textContent)).toContain("not checked");
  });
  it("says why the feed is down, in which attempt, the ticks it rejected, and its latest events one under the other", () => {
    show(variant((s) => {
      s.connection.state = "disconnected"; s.connection.ticks_rejected = { duplicate: 2, out_of_order: 1 };
      Object.assign(s.health.feed, { state: "disconnected", reason: "the broker closed the connection", attempt: 3, events: [{ time: 1793942400, kind: "reconnect", message: "trying again", attempt: 2 }, { time: 1793942460, kind: "disconnect", reason: "closed" }] });
    }));
    expect(secText("a-health")).toContain("Feed: disconnected — the broker closed the connection (attempt 3) · ticks ok 29 · rejected duplicate:2 out_of_order:1 ·");
    const ev = [...sec("a-health").querySelectorAll(".lv > .mut")].find((d) => d.textContent!.includes("reconnect:"))!;
    expect(ev.textContent).toBe("10:50:00 reconnect: trying again (attempt 2)10:51:00 disconnect: closed");
    expect(ev.querySelectorAll("br")).toHaveLength(1);
  });
  it("says the clock is trusted, or is not and why, with its events", () => {
    show(variant((s) => { s.health.time = { trusted: true, events: [] }; }));
    const clock = () => [...sec("a-health").querySelectorAll(".lv > div")].find((d) => d.textContent!.startsWith("Clock:"))!;
    expect(clock().textContent).toBe("Clock: trusted");
    expect(clock().querySelector(".up")?.textContent).toBe("trusted");
    show(variant((s) => { s.health.time = { trusted: false, reason: "the PC clock drifted 4 s", events: [{ time: 1793942400, kind: "drift", message: "4.1 s" }] }; }));
    expect(secText("a-health")).toContain("Clock: NOT trusted: the PC clock drifted 4 s");
    expect(sec("a-health").querySelector("b.stale")?.textContent).toBe("NOT trusted: the PC clock drifted 4 s");
    expect(secText("a-health")).toContain("10:50:00 drift: 4.1 s");
  });
  it("says the candle recovery, the Angel One limiter and the official-candle check", () => {
    show(base);
    expect(secText("a-health")).toContain("Candle recovery (NIFTY spot only): 0 candle(s) recovered in 0 request(s), 0 failed, 0 still pending");
    expect(secText("a-health")).toContain("Angel One candle API: 0 request(s) through the shared limiter, 0 refused for rate");
    expect(secText("a-health")).toContain("Official-candle check: runs once after the close (about 15:40) when live candles exist");
    show(variant((s) => {
      Object.assign(s.health.recovery!, { recovered: 4, requests: 6, failures: 2, pending_candles: 1, history_refreshing: true, deferred: 3, last_error: "timeout", api_requests: 12, refusals: 2, cooling_down: true, cooldown_seconds: 74.6, refusal_error: "exceeding access rate" });
      s.health.validation = { date: "2026-11-06", status: "MATCHED", file: "validation-2026-11-06.json", lines: ["1M: 375 of 375 match", "5M: 75 of 75 match"] };
    }));
    expect(secText("a-health")).toContain("Candle recovery (NIFTY spot only): 4 candle(s) recovered in 6 request(s), 2 failed, 1 still pending · history refresh running · stood aside 3× · last failure: timeout");
    expect(secText("a-health")).toContain("Angel One candle API: 12 request(s) through the shared limiter, 2 refused for rate — cooling down 75 s · last refusal: exceeding access rate");
    expect(sec("a-health").querySelector("b.flat")?.textContent).toBe("cooling down 75 s");
    expect(secText("a-health")).toContain("Official-candle check: 2026-11-06 MATCHED (validation-2026-11-06.json)1M: 375 of 375 match5M: 75 of 75 match");
  });
});

describe("instruments, gaps and errors", () => {
  it("list each instrument with its expiry, strike, quote, ages and times, and a dash for what it has not", () => {
    show(base);
    const rows = [...sec("a-contracts").querySelectorAll("tr")].slice(1).map((r) => [...r.children].map((c) => c.textContent));
    expect(rows).toHaveLength(29);
    expect(rows[0]).toEqual(["SPOT", "Nifty 50", "–", "–", "24287.00", "fresh", "1 s", "–", "10:55:04", "10:55:05"]);
    expect(rows[1]?.slice(0, 5)).toEqual(["OPT", "NIFTY10NOV202624150CE", "2026-11-10", "24150", "175.15"]);
    expect(rows[1]?.[7]).toBe("2000000"); // (the raw number, as the current dashboard shows it)
    expect([...sec("a-contracts").querySelectorAll("tr")][1]?.children[5]?.className).toBe("up");
  });
  it("say none when there are no gaps and no errors", () => {
    show(base);
    expect(secText("a-gaps")).toBe("GapsnoneErrorsnone");
  });
  it("say each gap with its length, one that is ongoing, and one that ended some other way", () => {
    show(variant((s) => { s.gaps = [{ start: 1793942400, end: 1793942460, reason: "no ticks for 60 s" }, { start: 1793942500, reason: "feed down" }, { start: 1793942600, ended_by: "history", reason: "recovered" }]; }));
    expect(sec("a-gaps").querySelector(".mut")?.textContent).toBe("Gaps10:50:00 → 10:51:00 (60s) · no ticks for 60 s10:51:40 → ongoing · feed down10:53:20 → history · recovered");
    expect(sec("a-gaps").querySelector(".mut")?.querySelectorAll("br")).toHaveLength(3);
  });
  it("say the errors, newest first", () => {
    show(variant((s) => { s.errors = [{ time: 1793942400, message: "first" }, { time: 1793942460, message: "second" }]; }));
    const e = sec("a-gaps").querySelectorAll(".mut")[1]!;
    expect(e.textContent).toBe("Errors10:51:00 second10:50:00 first");
    expect(e.querySelector(".err")?.textContent).toBe("10:51:00");
  });
});

describe("what a server says is only ever text", () => {
  it("is not turned into markup anywhere on the tab", () => {
    show(variant((s) => {
      s.analysis!.warnings = [EVIL];
      s.analysis!.condition!.reasons = [EVIL]; s.analysis!.condition!.alignment.text = EVIL; s.analysis!.history!.error = EVIL;
      const tr = t(s);
      Object.assign(tr.decision, { headline: EVIL, reasons: [EVIL], against: [EVIL], also: [EVIL] });
      tr.market!.text = EVIL; tr.market!.regime_facts!.facts.extended = { state: "none", summary: EVIL, checks: [{ name: EVIL, text: EVIL, ok: null }] };
      tr.counter_trend[0]!.reason = EVIL; tr.counter_trend[0]!.checks![0]!.text = EVIL;
      tr.strategies[1]!.why = EVIL; tr.strategies[1]!.sides[0]!.note = EVIL; tr.strategies[1]!.name = EVIL;
      Object.assign(tr.setups[0]!, { stage_text: EVIL, confirm_text: EVIL, blockers: [EVIL], note: EVIL, level_label: EVIL, quality: [{ name: EVIL, text: EVIL, ok: false }] });
      tr.recent = [copy({ note: EVIL, strategy_name: EVIL })];
      s.health.readiness!.summary = EVIL; s.health.readiness!.stages![0]!.detail = EVIL; s.health.feed.reason = EVIL; s.health.feed.state = EVIL;
      s.health.validation = { date: EVIL, status: EVIL, file: EVIL, lines: [EVIL] };
      s.gaps = [{ start: 1793942400, reason: EVIL, ended_by: EVIL }]; s.errors = [{ time: 1793942400, message: EVIL }];
      s.instruments[1]!.symbol = EVIL; s.health.instruments[0]!.symbol = EVIL;
    }));
    expect(document.querySelector("img")).toBeNull();
    expect(body().innerHTML).not.toContain("<img");
    expect(body().textContent).toContain(EVIL);
  });
});

describe("a strategy that holds a live setup opens by itself, once", () => {
  it("opens when the setup appears, and is then the reader's: closed by the reader, it stays closed", async () => {
    const seen = new Set<string>();
    const idle = variant((s) => { t(s).setups = []; t(s).strategies.find((z) => z.id === "trend_pullback")!.setups = []; });
    const { rerender } = show(idle, { seen });
    expect(sd("trend_pullback").open).toBe(false);
    rerender(<Host s={base} seen={seen} />);
    expect(sd("trend_pullback").open).toBe(true); // it holds a live setup now: it opens by itself
    fireEvent.click(sd("trend_pullback").querySelector("summary")!);
    await settle();
    expect(sd("trend_pullback").open).toBe(false);
    rerender(<Host s={variant((s) => { t(s).decision.headline = "changed"; })} seen={seen} />);
    expect(sd("trend_pullback").open).toBe(false); // the next snapshot does not open it again
    expect(sd("breakout_retest").open).toBe(false); // and a strategy with no setup was never opened
  });
  it("does not open the strategies that hold none", () => {
    show(base);
    expect([...body().querySelectorAll<HTMLDetailsElement>("details.sd")].filter((d) => d.open).map((d) => d.getAttribute("data-key"))).toEqual(["sd-trend_pullback"]);
  });
});

describe("a strategy brought into view", () => {
  beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });
  afterEach(() => { delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView; });
  it("is scrolled to, once, and the page is told it was", () => {
    const onFocused = vi.fn();
    show(base, { focus: { key: "sd-trend_pullback", n: 1 }, onFocused });
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    expect((Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.contexts[0]).toBe(sd("trend_pullback"));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    expect(onFocused).toHaveBeenCalledTimes(1);
  });
  it("is not scrolled to when there is nothing asked for, or what is asked for is not there", () => {
    const onFocused = vi.fn();
    show(base, { focus: null, onFocused });
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    show(base, { focus: { key: "sd-nothing", n: 1 }, onFocused });
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(onFocused).toHaveBeenCalledTimes(1);
  });
});

describe("the Analysis tab in the dashboard", () => {
  const mount = (hash: string) => {
    cleanup();
    FakeSocket.reset();
    location.hash = hash;
    Element.prototype.scrollIntoView = vi.fn();
    render(<App url="ws://prism.test/ws" createSocket={fakeFactory} />);
    act(() => { FakeSocket.last.send(base); });
  };
  afterEach(() => { delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView; });
  it("is opened by #analysis and is stale with the page", () => {
    mount("#analysis");
    expect(sec("a-strat")).not.toBeNull();
    expect(body().querySelector(".bar")?.textContent).toContain("Direction ▲ BULLISH");
    act(() => { FakeSocket.last.drop(); });
    expect(sd("trend_pullback").textContent).toContain("was in the entry area (not current)");
    expect(document.getElementById("main")?.className).toBe("staled");
  });
  it("is reached from the Overview's strategy links: the section and the strategy open, and the strategy is brought into view", () => {
    mount("#overview");
    fireEvent.click(screen.getAllByRole("button", { name: "detail →" })[1]!); // the first of the strategies without a setup
    expect(location.hash).toBe("#analysis");
    expect(sec("a-strat").open).toBe(true);
    expect(sd("breakout_retest").open).toBe(true);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    expect((Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.contexts[0]).toBe(sd("breakout_retest"));
  });
  it("is reached from 'All ten strategies' with the section open and nothing scrolled to", async () => {
    mount("#analysis");
    fireEvent.click(sec("a-strat").querySelector("summary")!); // the reader closes the section
    await settle();
    expect(sec("a-strat").open).toBe(false);
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    fireEvent.click(screen.getByRole("button", { name: "All ten strategies →" }));
    expect(sec("a-strat").open).toBe(true);
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
  it("keeps what the reader opened while another tab is open", async () => {
    mount("#analysis");
    fireEvent.click(sec("a-regime").querySelector("summary")!);
    fireEvent.click(sec("a-tech").querySelector("summary")!);
    await settle();
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    expect(document.getElementById("analysis-body")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Analysis" }));
    expect(sec("a-regime").open).toBe(true);
    expect(sec("a-tech").open).toBe(false);
    expect(sec("a-health").open).toBe(true);
  });
  it("opens the section again when a link to a strategy is followed after the reader closed it", async () => {
    mount("#analysis");
    fireEvent.click(sec("a-strat").querySelector("summary")!);
    await settle();
    expect(sec("a-strat").open).toBe(false);
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    fireEvent.click(screen.getAllByRole("button", { name: "detail →" })[1]!);
    expect(sec("a-strat").open).toBe(true);
    expect(sd("breakout_retest").open).toBe(true);
  });
  it("keeps a strategy the reader closed closed: while snapshots arrive and while another tab is open", async () => {
    mount("#analysis");
    expect(sd("trend_pullback").open).toBe(true); // it holds the live setup, so it opened by itself, once
    fireEvent.click(sd("trend_pullback").querySelector("summary")!);
    await settle();
    expect(sd("trend_pullback").open).toBe(false);
    act(() => { FakeSocket.last.send(base); });
    await settle();
    expect(sd("trend_pullback").open).toBe(false); // the next snapshot does not open it again
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    fireEvent.click(screen.getByRole("tab", { name: "Analysis" }));
    expect(sd("trend_pullback").open).toBe(false); // and neither does coming back to the tab
  });
  it("says a payload it cannot draw in words, and keeps the page", () => {
    cleanup();
    FakeSocket.reset();
    location.hash = "#analysis";
    render(<App url="ws://prism.test/ws" createSocket={fakeFactory} />);
    const quiet = (e: ErrorEvent) => e.preventDefault();
    window.addEventListener("error", quiet);
    const spy = console.error;
    console.error = () => {};
    act(() => { FakeSocket.last.send(variant((s) => { (s.trading as unknown as { strategies: unknown }).strategies = undefined; })); });
    expect(document.getElementById("jserr")?.textContent).toMatch(/^Dashboard display error in analysis: /);
    expect(document.getElementById("c-market")?.textContent).toBe("MARKET OPEN");
    act(() => { FakeSocket.last.send(base); });
    expect(document.getElementById("jserr")).toBeNull();
    console.error = spy;
    window.removeEventListener("error", quiet);
  });
});
