import { describe, expect, it } from "vitest";
import type { LoggedAlert } from "./alertEvents";
import { ICON, lineItems, stateAlerts, worstOf, type AlertItem } from "./alerts";
import { base, limitReached, tradesBase, tradesVariant, variant } from "./test/helpers";

describe("what is wrong right now", () => {
  it("says nothing about a system that is ready, with trusted data", () => {
    expect(stateAlerts(base.health)).toEqual([]);
  });

  it("a system that is not ready is one warning that says why and that decisions are blocked", () => {
    const h = variant((s) => {
      s.health.readiness = { state: "RECOVERING_GAPS", ready: false, decisions_permitted: false, summary: "recovering missing candles: 5M 12 missing (10:25-11:20)", pre_market: false };
    }).health;
    expect(stateAlerts(h)).toEqual([
      { sev: "warn", head: "NOT READY · RECOVERING GAPS", text: "recovering missing candles: 5M 12 missing (10:25-11:20). Decisions are blocked until the data is complete and trusted." },
    ]);
  });

  it("a failed start is a serious one, and only a failed start", () => {
    const sev = (state: string) =>
      stateAlerts(variant((s) => { s.health.readiness = { state, ready: false, decisions_permitted: false, summary: "x", pre_market: false }; }).health)[0]?.sev;
    expect(sev("FAILED")).toBe("bad");
    for (const state of ["INITIALIZING", "HISTORICAL_LOADING", "RECOVERING_GAPS", "DEGRADED"]) expect(sev(state)).toBe("warn");
  });

  it("each data issue is a serious alert that says no BUY is possible, each warning a plain one", () => {
    const h = variant((s) => {
      s.health.issues = ["5M candles missing 10:25-11:20", "the clock cannot be trusted"];
      s.health.warnings = ["the option quote for NIFTY 24500 CE is 40 s old"];
    }).health;
    expect(stateAlerts(h)).toEqual([
      { sev: "bad", head: "Data not trusted", text: "5M candles missing 10:25-11:20. No BUY decision is possible until this is fixed." },
      { sev: "bad", head: "Data not trusted", text: "the clock cannot be trusted. No BUY decision is possible until this is fixed." },
      { sev: "warn", head: "", text: "the option quote for NIFTY 24500 CE is 40 s old" },
    ]);
  });

  it("lists them in the order readiness, issues, warnings", () => {
    const h = variant((s) => {
      s.health.warnings = ["w"];
      s.health.issues = ["i"];
      s.health.readiness = { state: "DEGRADED", ready: false, decisions_permitted: false, summary: "s", pre_market: false };
    }).health;
    expect(stateAlerts(h).map((a) => a.head || a.text)).toEqual(["NOT READY · DEGRADED", "Data not trusted", "w"]);
  });

  it("copes with a health section that has no readiness, issues or warnings", () => {
    const h = variant((s) => {
      delete s.health.readiness;
    }).health;
    expect(stateAlerts({ ...h, issues: undefined as unknown as string[], warnings: undefined as unknown as string[] })).toEqual([]);
  });
});

describe("the most serious alert leads the one line", () => {
  const a = (sev: AlertItem["sev"], text: string): AlertItem => ({ sev, head: "", text });
  it("is nothing for nothing", () => expect(worstOf([])).toBeNull());
  it("takes the first of the highest severity", () => {
    expect(worstOf([a("warn", "1"), a("bad", "2"), a("bad", "3")])).toEqual({ worst: "bad", lead: a("bad", "2") });
    expect(worstOf([a("warn", "1"), a("warn", "2")])).toEqual({ worst: "warn", lead: a("warn", "1") });
  });
  it("ranks a ready setup above a warning and below a failure", () => {
    expect(worstOf([a("warn", "1"), a("act", "2")])?.worst).toBe("act");
    expect(worstOf([a("act", "1"), a("bad", "2")])?.worst).toBe("bad");
  });
  it("has an icon for each", () => expect(Object.keys(ICON).sort()).toEqual(["act", "bad", "warn"]));
});

describe("everything the one line says", () => {
  const events = (...keys: [string, "act" | "warn" | "info"][]): LoggedAlert[] => keys.map(([key, level]) => ({ key, level, title: "t " + key, text: "x " + key, t: 1 }));
  const reached = limitReached();
  const none = (): Parameters<typeof lineItems>[0] => ({ health: base.health, stale: false, trades: null, events: [] });

  it("is nothing before the first snapshot, whatever the trades say", () => {
    expect(lineItems({ ...none(), health: null, trades: reached, events: events(["ready:a", "act"]) })).toEqual([]);
  });
  it("is nothing for a system that is ready, trades inside the limit and no events", () => {
    expect(lineItems({ ...none(), trades: tradesBase })).toEqual([]);
  });
  it("says what is wrong, then the loss limit, then the setups, in that order", () => {
    const sick = variant((s) => { Object.assign(s.health.readiness!, { ready: false, state: "RECOVERING_GAPS", summary: "recovering" }); });
    const items = lineItems({ health: sick.health, stale: false, trades: reached, events: events(["ready:a", "act"], ["ended:b", "warn"]) });
    expect(items.map((i) => [i.sev, i.head])).toEqual([["warn", "NOT READY · RECOVERING GAPS"], ["bad", "Your daily loss limit is reached"], ["act", "t ready:a"], ["warn", "t ended:b"]]);
  });
  it("the loss limit says how much, and that it is the reader's own", () => {
    const [i] = lineItems({ ...none(), trades: reached });
    expect(i).toEqual({ sev: "bad", head: "Your daily loss limit is reached", text: "Rs 5,200 lost of Rs 5,000. Prism's decisions are unchanged: this limit is yours, and it says stop for the day" });
  });
  it("a limit that is not reached, and a trade log that is not available, say nothing", () => {
    expect(lineItems({ ...none(), trades: tradesVariant((t) => { t.daily_loss_used_pct = 99; }) })).toEqual([]);
    expect(lineItems({ ...none(), trades: { available: false, trades: [], reason: "x" } })).toEqual([]);
  });
  it("a page that has lost its link says nothing about the market, nothing of the setups, but still the reader's own loss limit", () => {
    const sick = variant((s) => { Object.assign(s.health.readiness!, { ready: false, state: "FAILED", summary: "x" }); });
    const items = lineItems({ health: sick.health, stale: true, trades: reached, events: events(["ready:a", "act"]) });
    expect(items.map((i) => i.head)).toEqual(["Your daily loss limit is reached"]);
  });
  it("a setup alert is green and anything else that is an event is a warning", () => {
    expect(lineItems({ ...none(), events: events(["ready:a", "act"], ["ended:b", "warn"], ["ended:c", "info"]) }).map((i) => i.sev)).toEqual(["act", "warn", "warn"]);
  });
});
