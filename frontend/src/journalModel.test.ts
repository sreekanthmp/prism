import { describe, expect, it } from "vitest";
import { actionClass, ENDED, endedEvents, JOURNAL_OPEN, journalKey, lifecycles, neededPermissions, SHOWN_DECISIONS } from "./journalModel";
import type { JournalRow, SetupEvent } from "./types";
import { base, journalBase, variant } from "./test/helpers";

const ev = (seq: number, id: string, status: string, over: Partial<SetupEvent> = {}): SetupEvent => ({ seq, id, time: 1_000 + seq, direction: "CE", strategy_name: "Trend Pullback", status, text: `${status}: x`, ...over });

describe("small tables", () => {
  it("opens at the start the decision history and the lifecycle, and no more", () => {
    expect([...JOURNAL_OPEN]).toEqual(["j-decisions", "j-lifecycle"]);
    expect(SHOWN_DECISIONS).toBe(150);
    expect(ENDED).toEqual(["EXPIRED", "INVALIDATED", "MISSED"]);
  });
  it("colours a decision: BUY CE green, BUY PE red, WAIT amber, anything else grey", () => {
    expect([actionClass("BUY CE"), actionClass("BUY PE"), actionClass("WAIT"), actionClass("NO TRADE"), actionClass(null), actionClass(undefined), actionClass("BUY CE ")]).toEqual(["up", "down", "flat", "neu", "neu", "neu", "neu"]);
  });
});

describe("journalKey: what the journal is read again for", () => {
  it("is the decision's headline, how many setup events there are, and the newest one's number", () => {
    expect(journalKey(base.trading)).toBe("BUY CE: Trend Pullback setup confirmed|3|2");
  });
  it("changes when the headline changes, when an event is added, and when the newest event is another one", () => {
    const k = journalKey(base.trading);
    expect(journalKey(variant((s) => { s.trading!.decision.headline = "WAIT: something"; }).trading)).not.toBe(k);
    expect(journalKey(variant((s) => { s.trading!.events.unshift({ ...s.trading!.events[0]!, seq: 3 }); }).trading)).not.toBe(k);
    expect(journalKey(variant((s) => { s.trading!.events[0]!.seq = 9; }).trading)).not.toBe(k);
  });
  it("does not change with anything else: the price, the time, the other panels", () => {
    const k = journalKey(base.trading);
    expect(journalKey(variant((s) => { s.server_time += 5; s.instruments[0]!.ltp = 1; s.trading!.market!.volatility = "high"; }).trading)).toBe(k);
  });
  it("is empty with no decision, with no events, and for a snapshot it cannot read", () => {
    expect(journalKey(null)).toBe("");
    expect(journalKey(undefined)).toBe("");
    expect(journalKey(variant((s) => { s.trading!.events = []; }).trading)).toBe("BUY CE: Trend Pullback setup confirmed|0|");
    expect(journalKey(variant((s) => { (s.trading as unknown as Record<string, unknown>).decision = undefined; }).trading)).toBe("");
  });
});

describe("lifecycles: one line for each setup", () => {
  it("gathers a setup's events, oldest first, with the latest as where it stands", () => {
    const l = lifecycles(journalBase.events);
    expect(l).toHaveLength(1);
    expect(l[0]!.id).toBe("trend_pullback:bull:1793940000");
    expect(l[0]!.list.map((e) => e.status)).toEqual(["DETECTED", "WAITING_FOR_CONFIRMATION", "CONFIRMED"]);
    expect(l[0]!.last.status).toBe("CONFIRMED");
  });
  it("lists the setup that started last first, whatever happened to the others since", () => {
    const events = [ev(5, "b", "CONFIRMED"), ev(4, "a", "EXPIRED"), ev(3, "b", "DETECTED"), ev(2, "a", "CONFIRMED"), ev(1, "a", "DETECTED")]; // newest first
    expect(lifecycles(events).map((l) => l.id)).toEqual(["b", "a"]);
    expect(lifecycles(events).map((l) => l.list.map((e) => e.status))).toEqual([["DETECTED", "CONFIRMED"], ["DETECTED", "CONFIRMED", "EXPIRED"]]);
    expect(lifecycles(events).map((l) => l.last.status)).toEqual(["CONFIRMED", "EXPIRED"]);
  });
  it("does not change the list it was given, and is empty for none", () => {
    const events = [ev(2, "a", "CONFIRMED"), ev(1, "a", "DETECTED")];
    const copy = structuredClone(events);
    lifecycles(events);
    expect(events).toEqual(copy);
    expect(lifecycles([])).toEqual([]);
  });
});

describe("endedEvents", () => {
  it("are the events that ended a setup: expired, invalidated or missed", () => {
    const events = [ev(4, "a", "MISSED"), ev(3, "a", "CONFIRMED"), ev(2, "b", "INVALIDATED"), ev(1, "c", "EXPIRED"), ev(0, "d", "DETECTED")];
    expect(endedEvents(events).map((e) => e.status)).toEqual(["MISSED", "INVALIDATED", "EXPIRED"]);
    expect(endedEvents([])).toEqual([]);
  });
});

describe("neededPermissions", () => {
  const row = (ct: JournalRow["counter_trend"]): JournalRow => ({ ...structuredClone(journalBase.decisions[0]!), counter_trend: ct });
  it("are the counter-trend permissions that were needed when the decision was made", () => {
    const p = { strategy_name: "TER", side: "PE", granted: false, reason: "r" };
    expect(neededPermissions(row([{ ...p, needed: true }, { ...p, needed: false, side: "CE" }])).map((c) => c.side)).toEqual(["PE"]);
    expect(neededPermissions(row([]))).toEqual([]);
    expect(neededPermissions({ ...row([]), counter_trend: undefined as never })).toEqual([]); // (an older record has none)
  });
});
