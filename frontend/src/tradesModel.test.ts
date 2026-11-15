import { describe, expect, it } from "vitest";
import { NO_CALCULATOR, NO_TRADE_LOG, afterLogging, blankRisk, blankTrade, detailText, isSummary, lossLimitAlert, riskOf, riskQuery, rs, summaryOf, tradePayload } from "./tradesModel";
import { limitReached, ok, refused, riskBase, tradesBase } from "./test/helpers";

describe("rupees", () => {
  it("are rounded and grouped the Indian way", () => {
    expect(rs(1300)).toBe("Rs 1,300");
    expect(rs(123456.6)).toBe("Rs 1,23,457");
    expect(rs(0)).toBe("Rs 0");
    expect(rs(-5200)).toBe("Rs -5,200");
  });
  it("an unknown amount is a dash, never a zero", () => {
    expect(rs(null)).toBe("–");
    expect(rs(undefined)).toBe("–");
  });
});

describe("what a refusal says", () => {
  it("the server's own sentence when it sent one", () => {
    expect(detailText({ detail: "nothing to sell: NIFTY 24500 CE has 0 unit(s) open and the sell is for 65" })).toBe("nothing to sell: NIFTY 24500 CE has 0 unit(s) open and the sell is for 65");
  });
  it("otherwise the whole of what it sent, and 'no answer' when it sent nothing", () => {
    expect(detailText({ detail: [{ loc: ["body"], msg: "bad" }] })).toBe('[{"loc":["body"],"msg":"bad"}]');
    expect(detailText({ other: 1 })).toBe('{"other":1}');
    expect(detailText(null)).toBe('"no answer"');
    expect(detailText(undefined)).toBe('"no answer"');
  });
});

describe("the answer to asking for the trades", () => {
  it("is the summary when that is what came", () => {
    expect(summaryOf(ok(tradesBase))).toBe(tradesBase);
  });
  it("a trade file that does not add up is said, not drawn as numbers", () => {
    const bad = { available: false, reason: "the trade file does not add up", trades: [], file: "x" };
    expect(summaryOf(ok(bad))).toBe(bad);
  });
  it("a server that has no trade log (it answers 404) says to restart Prism, not an empty notebook", () => {
    expect(summaryOf(refused(404, { detail: "Not Found" }))).toEqual({ available: false, reason: NO_TRADE_LOG, trades: [], open: [] });
    expect(NO_TRADE_LOG).toBe("this Prism server has no trade log yet (restart Prism to load the current version)");
  });
  it("any other refusal says why, and an answer that is not a summary is a refusal too", () => {
    expect(summaryOf(refused(500, { detail: "boom" }))).toEqual({ available: false, reason: "boom", trades: [], open: [] });
    expect(summaryOf(ok({ detail: "Not Found" }))).toMatchObject({ available: false, reason: "Not Found" });
    expect(summaryOf(ok(null))).toMatchObject({ available: false });
    expect(summaryOf(ok([1, 2]))).toMatchObject({ available: false });
  });
  it("a refusal whose body happens to look like a summary is still a refusal", () => {
    expect(summaryOf(refused(500, tradesBase))).toEqual({ available: false, reason: JSON.stringify(tradesBase), trades: [], open: [] });
  });
  it("a summary is an object that says whether the log is available", () => {
    expect(isSummary(tradesBase)).toBe(true);
    expect(isSummary({ available: false })).toBe(true);
    expect([null, undefined, 3, "x", [], {}, { available: "yes" }].map(isSummary)).toEqual([false, false, false, false, false, false, false]);
  });
});

describe("what logging sends", () => {
  it("each field as typed, trimmed, and BUY when no side is chosen", () => {
    expect(tradePayload({ instrument: "  NIFTY 24500 CE  ", side: "SELL", qty: " 65", price: "101.5 ", setup_id: " x:bull:1 ", note: " first " })).toEqual({
      instrument: "NIFTY 24500 CE", side: "SELL", qty: "65", price: "101.5", setup_id: "x:bull:1", note: "first",
    });
    expect(tradePayload({ ...blankTrade, side: "  " }).side).toBe("BUY");
  });
  it("the form is empty to start with and the side is BUY", () => {
    expect(blankTrade).toEqual({ instrument: "", side: "BUY", qty: "", price: "", setup_id: "", note: "" });
  });
  it("after a trade is logged the numbers, the note and the setup are cleared, and the instrument and the side stay", () => {
    expect(afterLogging({ instrument: "NIFTY 24500 CE", side: "SELL", qty: "65", price: "101.5", setup_id: "x", note: "n" })).toEqual({ instrument: "NIFTY 24500 CE", side: "SELL", qty: "", price: "", setup_id: "", note: "" });
  });
});

describe("what the calculator asks", () => {
  it("only what was filled in, in this order", () => {
    expect(riskQuery({ ...blankRisk, entry: "100", stop: "80", lot: "65" })).toBe("entry=100&stop=80&lot=65");
    expect(riskQuery({ entry: "100", stop: "80", lot: "65", capital: "200000", risk_pct: "1.5", max_loss: "9000" })).toBe("entry=100&stop=80&lot=65&capital=200000&risk_pct=1.5&max_loss=9000");
    expect(riskQuery({ ...blankRisk, max_loss: " 9000 ", entry: " 100" })).toBe("entry=100&max_loss=9000");
    expect(riskQuery(blankRisk)).toBe("");
  });
});

describe("what the calculator says", () => {
  it("the answer, when it is one", () => {
    expect(riskOf(ok(riskBase))).toEqual({ answer: riskBase });
  });
  it("an answer missing any one of what the page needs is an error, never drawn", () => {
    for (const field of ["lot_size", "loss_per_lot", "outlay_per_lot", "warnings"]) {
      const answer: Record<string, unknown> = { ...riskBase };
      delete answer[field];
      expect(riskOf(ok(answer)), field).toEqual({ error: "Prism's answer is not what this page expects" });
    }
  });
  it("an answer that is not one is an error, never drawn", () => {
    expect(riskOf(ok({ lots: 1 }))).toEqual({ error: "Prism's answer is not what this page expects" });
    expect(riskOf(ok(null))).toEqual({ error: "Prism's answer is not what this page expects" });
    expect(riskOf(ok({ ...riskBase, warnings: "none" }))).toEqual({ error: "Prism's answer is not what this page expects" });
  });
  it("an old server with no calculator says to restart Prism", () => {
    expect(riskOf(refused(404, { detail: "Not Found" }))).toEqual({ error: NO_CALCULATOR });
    expect(NO_CALCULATOR).toBe("this Prism server has no calculator yet (restart Prism to load the current version)");
  });
  it("numbers that are missing are asked for in plain words, and any other refusal is the server's sentence", () => {
    expect(riskOf(refused(422, { detail: [{ loc: ["query", "entry"], msg: "field required" }] }))).toEqual({ error: "fill in the entry premium, the stop premium and the lot size (numbers)" });
    expect(riskOf(refused(422, { detail: "the stop premium must be below the entry premium" }))).toEqual({ error: "the stop premium must be below the entry premium" });
    expect(riskOf(refused(500, null))).toEqual({ error: '"no answer"' });
  });
});

describe("the loss limit alert", () => {
  it("says how much of the limit is lost and that the limit is the reader's own", () => {
    expect(lossLimitAlert(limitReached())).toEqual({
      level: "warn",
      key: "daily-loss",
      title: "Your daily loss limit is reached",
      text: "Rs 5,200 lost of Rs 5,000: your own limit says stop for the day.",
    });
  });
});
