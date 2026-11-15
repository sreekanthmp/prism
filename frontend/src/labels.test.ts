import { describe, expect, it } from "vitest";
import { actionSaid, actionWord, isSetupAction, NOTE, NOTE_WHY, plain } from "./labels";

// The words the dashboard uses for the engine's action values. The values themselves are not changed (the journal and the tools read them): these tests hold the words.

describe("which actions mean 'the rules were met'", () => {
  it("are the engine's BUY CE and BUY PE, and nothing else", () => {
    expect(["BUY CE", "BUY PE"].map(isSetupAction)).toEqual([true, true]);
    for (const x of ["WAIT", "NO TRADE", "BUY", "BUY XX", "BUY CE ", " BUY CE", "buy ce", "", null, undefined, "SELL CE"]) expect(isSetupAction(x), String(x)).toBe(false);
  });
});

describe("the word for an action", () => {
  it("says CE SETUP and PE SETUP for the two that were called BUY, and leaves every other word as it is", () => {
    expect([actionWord("BUY CE"), actionWord("BUY PE"), actionWord("WAIT"), actionWord("NO TRADE"), actionWord("SOMETHING NEW")]).toEqual(["CE SETUP", "PE SETUP", "WAIT", "NO TRADE", "SOMETHING NEW"]);
  });
  it("says a dash for no action at all, as the page always has", () => {
    expect([actionWord(null), actionWord(undefined), actionWord("")]).toEqual(["–", "–", "–"]);
  });
  it("never says BUY: an instruction is not what the engine means", () => {
    for (const a of ["BUY CE", "BUY PE"]) expect(actionWord(a)).not.toMatch(/BUY/);
  });
});

describe("a sentence the engine wrote", () => {
  it("has its BUY CE / BUY PE said as 'CE setup ready' / 'PE setup ready', wherever they come", () => {
    expect(plain("BUY CE: Trend Pullback setup confirmed")).toBe("CE setup ready: Trend Pullback setup confirmed");
    expect(plain("BUY PE: Breakout and Retest setup confirmed")).toBe("PE setup ready: Breakout and Retest setup confirmed");
    expect(plain("was BUY CE at 10:55, then BUY PE")).toBe("was CE setup ready at 10:55, then PE setup ready");
  });
  it("leaves everything else as it is, including a word that only looks like it", () => {
    for (const s of ["WAIT: Trend Pullback (CE) is developing", "NO TRADE: late session", "BUY CEILING", "REBUY CE", "a BUY", "BUY", "SELL CE", ""]) expect(plain(s), s).toBe(s);
  });
  it("says an action inside a sentence the same way", () => {
    expect([actionSaid("BUY CE"), actionSaid("BUY PE"), actionSaid("WAIT"), actionSaid(null)]).toEqual(["CE setup ready", "PE setup ready", "WAIT", "–"]);
  });
});

describe("the note beside a ready setup", () => {
  it("says what it is, and what it stands on", () => {
    expect(NOTE).toBe("rules met · not a recommendation · no measured edge");
    expect(NOTE_WHY).toBe(
      "Prism's rules were met for this setup. That is not a recommendation to trade. In a replay of this engine over 700 days of NIFTY candles (643 such setups; audit of 15 Nov 2026) the average result was about zero before costs and negative after them, no better than random entries (docs/system-audit.md).",
    );
  });
});
