import { describe, expect, it } from "vitest";
import { parseChart } from "./chartTypes";
import { chartBase, chartVariant } from "./test/helpers";

// The page refuses an answer it cannot draw. The real answer (the engine's own, from the fixture) is accepted whole.
describe("parseChart", () => {
  it("accepts the engine's own answer, unchanged", () => {
    expect(parseChart(structuredClone(chartBase))).toEqual(chartBase);
  });

  it("accepts the answer of a chart with nothing to draw yet", () => {
    const none = { available: false, timeframe: "5m", seconds: 300, as_of: 1, reason: "Historical data is still loading (waiting for the history).", candles: [], forming: null, setups: [] };
    expect(parseChart(none)).toEqual(none);
  });

  it.each([
    ["not an object", 5],
    ["an array", []],
    ["null", null],
    ["no 'available'", () => chartVariant((c) => { delete (c as unknown as Record<string, unknown>).available; })],
    ["no timeframe", () => chartVariant((c) => { delete (c as unknown as Record<string, unknown>).timeframe; })],
    ["as_of that is not a number", () => chartVariant((c) => { (c as unknown as Record<string, unknown>).as_of = "now"; })],
    ["candles that are not a list", () => chartVariant((c) => { (c as unknown as Record<string, unknown>).candles = {}; })],
    ["a candle with a price that is NaN", () => chartVariant((c) => { (c.candles[3] as unknown as Record<string, unknown>).high = Number.NaN; })],
    ["a candle with a price that is a string", () => chartVariant((c) => { (c.candles[3] as unknown as Record<string, unknown>).close = "24000"; })],
    ["a candle with no time", () => chartVariant((c) => { delete (c.candles[3] as unknown as Record<string, unknown>).time; })],
    ["a candle with a date that is not text", () => chartVariant((c) => { (c.candles[3] as unknown as Record<string, unknown>).date = 5; })],
    ["a forming candle with no partial flag", () => chartVariant((c) => { c.forming = { ...(c.candles[0] as object), ticks: 1 } as never; })],
    ["no forming key at all", () => chartVariant((c) => { delete (c as unknown as Record<string, unknown>).forming; })],
    ["an EMA point that is not a number", () => chartVariant((c) => { (c.ema20?.[2] as unknown as Record<string, unknown>).value = null; })],
    ["a swing with no kind", () => chartVariant((c) => { delete (c.swings?.[0] as unknown as Record<string, unknown>).kind; })],
    ["a setup with a trigger that is text", () => chartVariant((c) => { (c.setups[0] as unknown as Record<string, unknown>).trigger = "24281"; })],
    ["a setup with a zone of one number", () => chartVariant((c) => { (c.setups[0] as unknown as Record<string, unknown>).zone = [1, "x"]; })],
    ["a setup with a target price that is NaN", () => chartVariant((c) => { (c.setups[0]?.targets[0] as unknown as Record<string, unknown>).price = Number.NaN; })],
    ["a setup that is not in focus or out of focus", () => chartVariant((c) => { delete (c.setups[0] as unknown as Record<string, unknown>).focus; })],
    ["a level with no touches", () => chartVariant((c) => { if (c.levels) c.levels.support = [{ price: 1 } as never]; })],
    ["a previous day with a high that is text", () => chartVariant((c) => { (c.levels?.previous_day as unknown as Record<string, unknown>).pdh = "x"; })],
    ["warnings that are not text", () => chartVariant((c) => { (c as unknown as Record<string, unknown>).warnings = [1]; })],
    ["notes that are not a list", () => chartVariant((c) => { (c as unknown as Record<string, unknown>).notes = "x"; })],
  ])("refuses an answer with %s", (_name, make) => {
    expect(parseChart(typeof make === "function" ? make() : make)).toBeNull();
  });
});
