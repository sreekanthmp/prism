import { describe, expect, it } from "vitest";
import { contractOffer, flagIcon, num0, quoteAges, ruledOut } from "./optionsModel";
import type { OptionContract, Options, Trading } from "./types";
import { base, variant } from "./test/helpers";

const trading = (change: (t: Trading) => void = () => {}): Trading => variant((s) => change(s.trading!)).trading!;
const options = (change: (o: Options) => void = () => {}): Options => {
  const o = structuredClone(base.options!);
  change(o);
  return o;
};
const contract = (over: Partial<OptionContract> = {}): OptionContract => ({ ...structuredClone(base.options!.contracts![0]!), ...over });

describe("num0: a quantity in the Indian grouping", () => {
  it("groups the last three digits, then every two", () => {
    expect([num0(2000000), num0(3000000), num0(12345), num0(999), num0(1234567.0), num0(0)]).toEqual(["20,00,000", "30,00,000", "12,345", "999", "12,34,567", "0"]);
  });
  it("shows what is unknown as a dash, never a zero", () => {
    expect([num0(null), num0(undefined)]).toEqual(["–", "–"]);
  });
});

describe("contractOffer says everything about the offer, and only a BUY the options agree with is one", () => {
  it("is a CE on offer when the decision, the options' decision and the contract all say CE", () => {
    const o = options();
    expect(contractOffer(trading(), o)).toEqual({ final: "BUY CE", side: "CE", agree: true, ok: true, contract: o.selection!.contract, conflict: false });
  });
  it("is a PE on offer for a BUY PE", () => {
    const t = trading((x) => { x.decision.action = "BUY PE"; });
    const o = options((x) => { x.decision = { action: "BUY PE" }; x.selection!.kind = "PE"; x.selection!.contract = contract({ kind: "PE" }); });
    expect(contractOffer(t, o)).toMatchObject({ side: "PE", ok: true, conflict: false });
  });
  it("is a conflict when the options data offers a contract and the decision does not call for it", () => {
    const wait = trading((x) => { x.decision.action = "WAIT"; });
    expect(contractOffer(wait, options())).toMatchObject({ final: "WAIT", side: null, agree: false, ok: false, contract: null, conflict: true });
    const other = options((x) => { x.decision = { action: "BUY PE" }; });
    expect(contractOffer(trading(), other)).toMatchObject({ final: "BUY CE", side: "CE", agree: false, ok: false, conflict: true }); // the two payloads disagree
  });
  it("is no conflict when the selection is not actionable", () => {
    const t = trading((x) => { x.decision.action = "WAIT"; });
    expect(contractOffer(t, options((x) => { x.selection!.actionable = false; })).conflict).toBe(false);
    expect(contractOffer(trading(), options((x) => { x.selection!.actionable = false; }))).toMatchObject({ ok: false, conflict: false });
  });
  it("knows nothing of a decision that is not there", () => {
    expect(contractOffer(null, options())).toMatchObject({ final: null, side: null, agree: false, ok: false, contract: null });
    expect(contractOffer(trading(), options((x) => { delete x.selection; }))).toMatchObject({ ok: false, conflict: false });
  });
});

describe("quote ages and flags", () => {
  it("says the age on both clocks, and 'unknown' when the exchange's time is", () => {
    expect(quoteAges(contract({ receipt_age: 1, exchange_age: 3 }))).toBe("1 s / 3 s");
    expect(quoteAges(contract({ receipt_age: 200, exchange_age: 500 }))).toBe("3 min / 8 min");
    expect(quoteAges(contract({ receipt_age: 1, exchange_age: 3, exchange_status: "unknown" }))).toBe("1 s / unknown");
    expect(quoteAges(contract({ receipt_age: null, exchange_age: null }))).toBe("– / –");
  });
  it("marks an Avoid with a stop sign and anything else with a warning", () => {
    expect([flagIcon({ severity: "avoid", code: "x", text: "" }), flagIcon({ severity: "warn", code: "x", text: "" }), flagIcon({ severity: "info", code: "x", text: "" })]).toEqual(["⛔", "⚠", "⚠"]);
  });
});

describe("ruledOut", () => {
  const flagged = (over: Partial<OptionContract>) => contract({ blocking: true, flags: [{ severity: "avoid", code: "wide_spread", text: "spread 4%" }], ...over });
  it("lists only the blocked contracts of this side, nearest the money first and then by expiry", () => {
    const o = options((x) => {
      x.contracts = [
        flagged({ token: "a", kind: "CE", steps_from_atm: 3, expiry: "2026-11-10" }), flagged({ token: "b", kind: "CE", steps_from_atm: 1, expiry: "2026-11-17" }), flagged({ token: "c", kind: "CE", steps_from_atm: 1, expiry: "2026-11-10" }),
        flagged({ token: "d", kind: "PE", steps_from_atm: 0 }), contract({ token: "e", kind: "CE", steps_from_atm: 0, blocking: false }), flagged({ token: "f", kind: "CE", steps_from_atm: null }),
      ];
    });
    const r = ruledOut(o, "CE");
    expect(r.mine.map((c) => c.token)).toEqual(["a", "b", "c", "e", "f"]);
    expect(r.bad.map((c) => c.token)).toEqual(["c", "b", "a", "f"]); // 1 (11-10), 1 (11-17), 3, and a contract with no distance last
    expect(ruledOut(o, "PE").bad.map((c) => c.token)).toEqual(["d"]);
  });
  it("lists none when there are none", () => {
    expect(ruledOut(options(), "CE").bad).toEqual([]);
    expect(ruledOut({ available: true }, "CE")).toEqual({ mine: [], bad: [] });
  });
});
