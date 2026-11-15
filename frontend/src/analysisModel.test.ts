import { describe, expect, it } from "vitest";
import { checkMark, DEFAULT_OPEN, dur, FACT_CLS, lastSwing, liveWords, PERMISSION_GROUPS, STAGE_MARK, structureLine } from "./analysisModel";
import type { Setup } from "./types";
import { base } from "./test/helpers";

const setup = (over: Partial<Setup> = {}): Setup => ({ ...structuredClone(base.trading!.setups[0]!), ...over });

describe("dur: a duration as the page says it", () => {
  it("is seconds up to two minutes, then minutes up to two hours, then hours with a decimal", () => {
    expect([dur(0), dur(45), dur(119.4), dur(120), dur(3600), dur(7199), dur(7200), dur(9000)]).toEqual(["0 s", "45 s", "119 s", "2 min", "60 min", "120 min", "2.0 h", "2.5 h"]);
  });
  it("is a dash for what is not known, never a zero", () => {
    expect([dur(null), dur(undefined)]).toEqual(["–", "–"]);
  });
});

describe("checkMark", () => {
  it("is ✓ in green for a check that holds, ✗ in amber for one that does not, and ? in grey for one that could not be judged", () => {
    expect(checkMark({ name: "a", text: "", ok: true })).toEqual({ mark: "✓", klass: "up" });
    expect(checkMark({ name: "a", text: "", ok: false })).toEqual({ mark: "✗", klass: "flat" });
    expect(checkMark({ name: "a", text: "", ok: null })).toEqual({ mark: "?", klass: "mut" });
  });
  it("is grey whatever its mark when it is only reported, not a condition", () => {
    expect(checkMark({ name: "a", text: "", ok: true, info: true })).toEqual({ mark: "✓", klass: "mut" });
    expect(checkMark({ name: "a", text: "", ok: false, info: true })).toEqual({ mark: "✗", klass: "mut" });
  });
});

describe("structureLine: the structure behind a permission, in real prices", () => {
  const st = { exhaustion_extreme: 24100.5, higher_low: 24120, lower_high: 24300, higher_high: 24350.25, prior_high: 24400, leg: 150.04, confirmed_at: 1793942400 };
  it("names the bullish view's prices for a CE", () => {
    expect(structureLine(st, "CE")).toBe("exhaustion low 24100.50 · 15M higher low 24120.00 · lower high before it 24300.00 · 15M higher high 24350.25 · prior high 24400.00 · leg 150.0 pts · confirmed 10:50");
  });
  it("reads the same prices the other way up for a PE", () => {
    expect(structureLine(st, "PE")).toBe("exhaustion high 24100.50 · 15M lower high 24120.00 · higher low before it 24300.00 · 15M lower low 24350.25 · prior low 24400.00 · leg 150.0 pts · confirmed 10:50");
  });
  it("uses the bullish names for a side it does not know, and shows a price it does not have as a dash", () => {
    expect(structureLine({ ...st, prior_high: null, leg: null }, "XX")).toContain("prior high – · leg – pts");
    expect(structureLine({ ...st, prior_high: null, leg: null }, "XX")).toMatch(/^exhaustion low /);
  });
});

describe("small tables", () => {
  it("opens at the start what the decision is made of and the tables read most, and not the rest", () => {
    expect([...DEFAULT_OPEN]).toEqual(["a-strat", "a-tech", "a-struct", "a-levels", "a-setups", "a-health"]);
  });
  it("marks each start-up stage with its own sign and colour", () => {
    expect(STAGE_MARK).toEqual({ done: ["✓", "up"], active: ["…", "flat"], retrying: ["↻", "flat"], pending: ["○", "neu"], failed: ["✗", "down"], warn: ["!", "flat"] });
  });
  it("groups the permission's checks in the order the permission is decided", () => {
    expect(PERMISSION_GROUPS.map(([g]) => g)).toEqual(["established", "weakening", "structure"]);
  });
  it("colours the regime states: trends green or red, a pause or pullback or breakout amber", () => {
    expect([FACT_CLS.bullish, FACT_CLS.bearish, FACT_CLS.up, FACT_CLS.down, FACT_CLS.yes, FACT_CLS.breakout, FACT_CLS.range_bound, FACT_CLS.trend_pause, FACT_CLS.pullback]).toEqual(["up", "down", "up", "down", "flat", "flat", "flat", "flat", "flat"]);
    expect(FACT_CLS.none).toBeUndefined(); // (a state this table does not know is shown grey, by the caller)
  });
});

describe("lastSwing", () => {
  const sw = [{ start: 1, kind: "L", price: 10 }, { start: 2, kind: "H", price: 20 }, { start: 3, kind: "L", price: 12 }, { start: 4, kind: "H", price: 22 }, { start: 5, kind: "L", price: 14 }];
  it("is the latest swing of the kind asked for", () => {
    expect(lastSwing(sw, "H")).toEqual({ start: 4, kind: "H", price: 22 });
    expect(lastSwing(sw, "L")).toEqual({ start: 5, kind: "L", price: 14 });
  });
  it("is nothing when there is none, and does not reorder the list it was given", () => {
    expect(lastSwing([], "H")).toBeUndefined();
    const copy = structuredClone(sw);
    lastSwing(sw, "H");
    expect(sw).toEqual(copy);
  });
});

describe("liveWords: what a setup's state means for entering now", () => {
  it("says a stale page's setup is last known, whatever it was", () => {
    expect(liveWords(setup({ stage: "READY_TO_ACT" }), true)).toEqual({ klass: "flat", text: "last known (STALE): not actionable" });
  });
  it("says a ready setup is actionable, and a blocked one is not", () => {
    expect(liveWords(setup({ stage: "READY_TO_ACT" }), false)).toEqual({ klass: "up", text: "actionable now" });
    expect(liveWords(setup({ stage: "BLOCKED" }), false)).toEqual({ klass: "flat", text: "not actionable: see the blockers" });
  });
  it("says a confirmed setup that is not ready is not actionable, and why in the price's own words", () => {
    expect(liveWords(setup({ stage: "CONFIRMED", status: "CONFIRMED", price_state: "above_entry_area" }), false)).toEqual({ klass: "flat", text: "not actionable: above entry area" });
    expect(liveWords(setup({ stage: "CONFIRMED", status: "CONFIRMED", price_state: null }), false)).toEqual({ klass: "flat", text: "not actionable: conditions" });
  });
  it("says nothing for a setup that is only waiting", () => {
    expect(liveWords(setup({ stage: "WAITING_FOR_CONFIRMATION", status: "WAITING_FOR_CONFIRMATION" }), false)).toBeNull();
    expect(liveWords(setup({ stage: "DETECTED", status: "DETECTED" }), false)).toBeNull();
  });
});
