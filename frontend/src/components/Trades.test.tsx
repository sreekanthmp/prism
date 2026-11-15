import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Snapshot } from "../types";
import { useRisk } from "../useRisk";
import { useTrades } from "../useTrades";
import type { TradesApi } from "../tradesApi";
import { aTrade, base, EVIL, fakeApi, limitReached, ok, refused, riskBase, tradesBase, tradesVariant, variant } from "../test/helpers";
import { TradesTab } from "./Trades";

// The Trades tab as the page draws it: a notebook of the reader's own trades and a size calculator. Prism places no order and reads no account.

function Harness({ api, snapshot }: { api: TradesApi; snapshot: Snapshot | null }) {
  const trades = useTrades(api);
  const risk = useRisk(api);
  return <TradesTab snapshot={snapshot} trades={trades} risk={risk} />;
}
const words = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
async function open(api: TradesApi = fakeApi(), snapshot: Snapshot | null = base) {
  cleanup();
  const r = render(<Harness api={api} snapshot={snapshot} />);
  await act(async () => { await Promise.resolve(); });
  const q = <T extends HTMLElement = HTMLElement>(sel: string) => r.container.querySelector(sel) as T;
  const body = () => words(q("#trades-body").textContent);
  const set = (id: string, value: string) => fireEvent.change(q(`#${id}`), { target: { value } });
  const click = async (sel: string) => { await act(async () => { fireEvent.click(q(sel)); await Promise.resolve(); }); };
  return { ...r, q, body, set, click, rerender: (s: Snapshot | null) => r.rerender(<Harness api={api} snapshot={s} />) };
}

beforeEach(() => {
  vi.stubGlobal("confirm", vi.fn(() => true));
});
afterEach(() => vi.unstubAllGlobals());

describe("the notebook of today's trades", () => {
  it("says what was done, what is open, the result and where the day stands against the loss limit", async () => {
    const t = await open();
    const text = t.body();
    expect(text).toContain("Today's trades trades-2026-11-06.jsonl");
    expect(text).toContain("Realised Rs 1,950");
    expect(text).toContain("Loss limit for the day Rs 5,000 (0% used)");
    expect(text).toContain("Open NIFTY 24500 CE 17NOV 125 @ 97.20");
    expect(t.q(".tstat b").className).toBe("up"); // (a gain is green)
    expect(t.q(".tstat span span").className).toBe("mut"); // (0% of the limit is used: grey)
    expect(t.q(".badbox")).toBeNull(); // (the limit is not reached: no red box)
  });

  it("what Prism said, when it said nothing: a dash, and no price", async () => {
    const t = await open(fakeApi({ summary: vi.fn(async () => ok(tradesVariant((s) => { s.trades = [aTrade({ prism: { action: null, setup_id: null, price: null }, followed: null })]; }))) }));
    const cell = t.container.querySelectorAll("table.t tr")[1]!.children[7]!;
    expect(words(cell.textContent)).toBe("–");
    expect(cell.querySelector("span")).toBeNull();
  });

  it("a table with a row for each trade: what was bought, how much of it was sold, what the sold part made, what Prism said and whether the buy followed it", async () => {
    const t = await open();
    const heads = [...t.container.querySelectorAll("table.t th")].map((th) => th.textContent);
    expect(heads).toEqual(["Time", "Side", "Instrument", "Qty", "Price", "Sold", "Result", "Prism said", "Note", ""]);
    const rows = [...t.container.querySelectorAll("table.t tr")].slice(1).map((r) => [...r.children].map((c) => words(c.textContent)));
    expect(rows).toEqual([
      ["10:40:00", "BUY", "NIFTY 24500 CE 17NOV", "150", "100.50", "100", "Rs 1,950", "CE SETUP at 24281.00 · followed Prism: yes: the setup you named", "first lot trend_pullback:bull:1793940000", "void"],
      ["10:50:00", "BUY", "NIFTY 24500 CE 17NOV", "75", "95.00", "0", "", "WAIT at 24262.50 · followed Prism: no", "", "void"],
      ["10:55:00", "SELL", "NIFTY 24500 CE 17NOV", "100", "120.00", "", "Rs 1,950", "", "took part off", "void"],
    ]);
  });

  it("the Result column adds up to the realised figure: a buy shows what its sold part made in grey, a sell the result of what it closed", async () => {
    const t = await open();
    expect(t.q("tbody").innerHTML.split("Rs 1,950").length - 1).toBe(2); // (the buy's grey part and the sell's result)
    expect(t.body().split("Rs 1,950").length - 1).toBe(3); // (and the realised figure above)
    expect(t.q('span[title="what the part of this buy that has been sold made"]').textContent).toBe("Rs 1,950");
    expect(t.q('span[title="what the part of this buy that has been sold made"]').className).toBe("mut");
    expect(t.body()).toContain("adds up to the realised figure");
    expect(t.body()).toContain("arithmetic on the prices you typed");
  });

  it("colours the sides, the results and the follow-up", async () => {
    const t = await open();
    const rows = [...t.container.querySelectorAll("table.t tr")].slice(1);
    expect(rows.map((r) => r.querySelector("b")?.className)).toEqual(["up", "up", "down"]); // BUY, BUY, SELL
    expect(rows.map((r) => r.children[6]?.className)).toEqual(["up", "", "up"]);
    expect(rows[0]?.querySelector(".up:not(b):not(td)")?.textContent).toBe("· followed Prism: yes: the setup you named");
    expect(rows[1]?.querySelector(".flat")?.textContent).toBe("· followed Prism: no");
    expect(rows.map((r) => r.querySelector("td.l.mut")?.className)).toEqual(["l mut", "l mut", "l mut"]);
  });

  it("a loss is red", async () => {
    const t = await open(fakeApi({ summary: vi.fn(async () => ok(tradesVariant((s) => { s.realised = -1000; s.trades[2]!.pnl = -1000; }))) }));
    expect(t.q(".tstat b").className).toBe("down");
    expect(t.container.querySelectorAll("table.t tr")[3]?.children[6]?.className).toBe("down");
  });

  it("no trade yet and no limit set", async () => {
    const t = await open(fakeApi({ summary: vi.fn(async () => ok(tradesVariant((s) => { s.trades = []; s.open = []; s.realised = 0; s.limits = { capital: null, per_trade_pct: null, per_trade_loss: null, max_daily_loss: null }; s.daily_loss_used_pct = null; }))) }));
    expect(t.body()).toContain("no trade logged today");
    expect(t.body()).toContain("Loss limit for the day not set");
    expect(t.body()).not.toContain("% used");
    expect(t.body()).toContain("Open nothing");
    expect(t.q("table")).toBeNull();
    expect(t.q(".tstat b").className).toBe(""); // (nothing realised: no colour)
  });

  it("the share of the loss limit used is grey, amber from 75 %, and red when it is reached", async () => {
    const used = async (pct: number, reached = false) => (await open(fakeApi({ summary: vi.fn(async () => ok(tradesVariant((s) => { s.daily_loss_used_pct = pct; s.daily_loss_reached = reached; s.lost_today = pct * 50; }))) }))).q(".tstat span span").className;
    expect(await used(74.9)).toBe("mut");
    expect(await used(75)).toBe("flat");
    expect(await used(99)).toBe("flat");
    expect(await used(104, true)).toBe("down");
  });

  it("a limit that is reached is said in red, with the amount, and that the limit is the reader's own", async () => {
    const t = await open(fakeApi({ summary: vi.fn(async () => ok(limitReached())) }));
    expect(t.q(".badbox").textContent).toBe("⛔ You have reached your own loss limit for the day (Rs 5,200 of Rs 5,000). Prism's decisions are unchanged: this limit is yours.");
    expect(t.body()).toContain("(104% used)");
    expect(t.q(".tstat span span").className).toBe("down");
  });

  it("says loading until the first answer, and shows nothing before the first snapshot", async () => {
    cleanup();
    const never = fakeApi({ summary: vi.fn(() => new Promise<never>(() => undefined)) });
    const r = render(<Harness api={never} snapshot={base} />);
    expect(words(r.container.querySelector("#trades-body")?.textContent)).toBe("loading…");
    cleanup();
    const none = await open(fakeApi(), null);
    expect(none.q("#trades-body").innerHTML).toBe(""); // (the forms are there; the notebook waits for the page)
    expect(none.q("#t-log")).not.toBeNull();
  });

  it("a server that cannot answer says so, with a button that asks again", async () => {
    const api = fakeApi({ summary: vi.fn(async () => ok(tradesBase)).mockRejectedValueOnce(new TypeError("Failed to fetch")) });
    const t = await open(api);
    expect(t.body()).toBe("could not load the trades: TypeError: Failed to fetch Retry");
    expect(t.q(".warnbox").className).toBe("warnbox");
    await t.click("#t-refresh");
    expect(api.summary).toHaveBeenCalledTimes(2);
    expect(t.body()).toContain("Today's trades");
    expect(t.q("#t-refresh")).toBeNull();
  });

  it("a trade log that is not available says why, and has no numbers", async () => {
    const t = await open(fakeApi({ summary: vi.fn(async () => ok({ available: false, reason: "the trade file does not add up (a sell with nothing to sell): it was edited by hand?", trades: [], file: "x" })) }));
    expect(t.body()).toBe("the trade file does not add up (a sell with nothing to sell): it was edited by hand?");
    const bare = await open(fakeApi({ summary: vi.fn(async () => ok({ available: false, trades: [] })) }));
    expect(bare.body()).toBe("the trade log is not available");
  });

  it("an old server with no trade log says to restart Prism", async () => {
    const t = await open(fakeApi({ summary: vi.fn(async () => refused(404, { detail: "Not Found" })) }));
    expect(t.body()).toBe("this Prism server has no trade log yet (restart Prism to load the current version)");
  });

  it("everything the server says is text", async () => {
    const t = await open(fakeApi({
      summary: vi.fn(async () => ok(tradesVariant((s) => {
        s.file = EVIL;
        s.basis = EVIL;
        s.open = [{ instrument: EVIL, qty: 1, average_price: 1 }];
        s.trades = [aTrade({ instrument: EVIL, note: EVIL, setup_id: EVIL, followed: EVIL, prism: { action: EVIL, setup_id: null, price: 1 } })];
      }))),
    }));
    expect(t.container.querySelector("img")).toBeNull();
    expect(t.q("#trades-body").textContent).toContain(EVIL);
    const failed = await open(fakeApi({ summary: vi.fn(async () => ok({ available: false, reason: EVIL, trades: [] })) }));
    expect(failed.container.querySelector("img")).toBeNull();
  });

  it("the id of a trade is only ever an attribute value", async () => {
    const t = await open(fakeApi({ summary: vi.fn(async () => ok(tradesVariant((s) => { s.trades = [aTrade({ id: 't1" onclick="x' })]; }))) }));
    const b = t.q("button.voidbtn");
    expect(b.getAttribute("data-void")).toBe('t1" onclick="x');
    expect(b.getAttribute("onclick")).toBeNull();
  });
});

describe("logging a trade", () => {
  it("has the form there is: the instrument, the side, the quantity, the price, an optional setup and note", async () => {
    const t = await open();
    expect(["t-instr", "t-side", "t-qty", "t-price", "t-setup", "t-note"].map((id) => t.q(id.startsWith("t-side") ? "#t-side" : `#${id}`).tagName)).toEqual(["INPUT", "SELECT", "INPUT", "INPUT", "INPUT", "INPUT"]);
    expect([...t.q("#t-side").querySelectorAll("option")].map((o) => o.textContent)).toEqual(["BUY", "SELL"]);
    expect(t.q<HTMLInputElement>("#t-instr").placeholder).toBe("NIFTY 24500 CE 17NOV");
    expect(t.q<HTMLInputElement>("#t-instr").maxLength).toBe(60);
    expect(t.q<HTMLInputElement>("#t-setup").maxLength).toBe(120);
    expect(t.q<HTMLInputElement>("#t-note").maxLength).toBe(300);
    expect(t.q("#t-use-setup").textContent).toBe("Use Prism's setup");
    expect(t.q("#t-log").textContent).toBe("Log trade");
    expect(t.q("#t-msg").textContent).toBe("");
    expect(t.container.querySelector("form")).toBeNull(); // (Enter in a field logs nothing: only the button does)
  });

  it("sends exactly what was typed, shows the summary the server answered with, clears the numbers and keeps the instrument", async () => {
    const answer = tradesVariant((s) => { s.open = [{ instrument: "NIFTY 24500 CE", qty: 65, average_price: 101.5 }]; });
    const api = fakeApi({ log: vi.fn(async () => ok({ ok: true, trade: aTrade(), summary: answer })) });
    const t = await open(api);
    t.set("t-instr", "NIFTY 24500 CE");
    t.set("t-qty", "65");
    t.set("t-price", "101.5");
    t.set("t-setup", "trend_pullback:bull:1");
    t.set("t-note", "first");
    await t.click("#t-log");
    expect(api.log).toHaveBeenCalledWith({ instrument: "NIFTY 24500 CE", side: "BUY", qty: "65", price: "101.5", setup_id: "trend_pullback:bull:1", note: "first" });
    expect(t.q("#t-msg").textContent).toBe("logged");
    expect(t.q("#t-msg").className).toBe("");
    expect(t.body()).toContain("Open NIFTY 24500 CE 65 @ 101.50");
    expect(["t-instr", "t-qty", "t-price", "t-note", "t-setup"].map((id) => t.q<HTMLInputElement>(`#${id}`).value)).toEqual(["NIFTY 24500 CE", "", "", "", ""]);
  });

  it("a SELL is logged as a SELL", async () => {
    const api = fakeApi();
    const t = await open(api);
    t.set("t-side", "SELL");
    await t.click("#t-log");
    expect(api.log.mock.calls[0]?.[0].side).toBe("SELL");
  });

  it("a refused trade says why in red and changes nothing", async () => {
    const api = fakeApi({ log: vi.fn(async () => refused(422, { detail: "nothing to sell: NIFTY 24500 CE has 0 unit(s) open and the sell is for 65" })) });
    const t = await open(api);
    t.set("t-qty", "65");
    await t.click("#t-log");
    expect(t.q("#t-msg").textContent).toBe("not logged: nothing to sell: NIFTY 24500 CE has 0 unit(s) open and the sell is for 65");
    expect(t.q("#t-msg").className).toBe("err");
    expect(t.q<HTMLInputElement>("#t-qty").value).toBe("65");
    expect(t.body()).toContain("Realised Rs 1,950");
  });

  it("what the server says in a refusal is text", async () => {
    const t = await open(fakeApi({ log: vi.fn(async () => refused(422, { detail: EVIL })) }));
    await t.click("#t-log");
    expect(t.q("#t-msg").textContent).toBe("not logged: " + EVIL);
    expect(t.container.querySelector("img")).toBeNull();
  });

  it("Use Prism's setup fills in the setup the decision is about, and nothing when it is about none", async () => {
    const t = await open();
    await t.click("#t-use-setup");
    expect(t.q<HTMLInputElement>("#t-setup").value).toBe(base.trading!.decision.setup_id);
    expect(t.q<HTMLInputElement>("#t-setup").value).toBeTruthy();
    const none = await open(fakeApi(), variant((s) => { s.trading!.decision.setup_id = null; }));
    none.set("t-setup", "mine");
    await none.click("#t-use-setup");
    expect(none.q<HTMLInputElement>("#t-setup").value).toBe("mine"); // (it fills in what Prism has, and leaves what you typed when Prism has nothing)
  });

  it("what is typed is kept while the snapshots arrive", async () => {
    const t = await open();
    t.set("t-instr", "NIFTY 24500 CE");
    t.set("t-note", "hello");
    t.rerender(variant((s) => { s.server_time += 1; }));
    expect(t.q<HTMLInputElement>("#t-instr").value).toBe("NIFTY 24500 CE");
    expect(t.q<HTMLInputElement>("#t-note").value).toBe("hello");
  });
});

describe("voiding a trade", () => {
  it("asks the server to cancel that trade and shows the answer", async () => {
    const after = tradesVariant((s) => { s.trades = s.trades.slice(0, 2); });
    const api = fakeApi({ voidTrade: vi.fn(async () => ok({ ok: true, summary: after })) });
    const t = await open(api);
    const ids = [...t.container.querySelectorAll("button.voidbtn")].map((b) => b.getAttribute("data-void"));
    expect(ids).toEqual(tradesBase.trades.map((x) => x.id));
    await act(async () => { fireEvent.click(t.container.querySelectorAll("button.voidbtn")[2]!); await Promise.resolve(); });
    expect(api.voidTrade).toHaveBeenCalledWith(ids[2]);
    expect(t.q("#t-msg").textContent).toBe("voided");
    expect(t.container.querySelectorAll("button.voidbtn")).toHaveLength(2);
    expect(t.q("button.voidbtn").title).toBe("cancel this trade (the file is only added to: a line that cancels it)");
  });

  it("a refused void says why", async () => {
    const api = fakeApi({ voidTrade: vi.fn(async () => refused(422, { detail: "a later sell depends on this buy: void the sell first" })) });
    const t = await open(api);
    await act(async () => { fireEvent.click(t.q("button.voidbtn")); await Promise.resolve(); });
    expect(t.q("#t-msg").textContent).toBe("not voided: a later sell depends on this buy: void the sell first");
    expect(t.q("#t-msg").className).toBe("err");
  });
});

describe("the size calculator", () => {
  const filled = async (api: TradesApi = fakeApi()) => {
    const t = await open(api);
    t.set("r-entry", "100");
    t.set("r-stop", "80");
    return t;
  };

  it("has the fields there are, and shows nothing until Calculate is clicked", async () => {
    const t = await open();
    expect([...t.container.querySelectorAll(".panel:last-child label")].map((l) => words(l.textContent))).toEqual(["Entry premium", "Stop premium (yours)", "Lot size (units)", "Capital (optional)", "Risk % (optional)", "Day's max loss (optional)"]);
    expect(t.q("#risk-out").innerHTML).toBe("");
  });

  it("sends only what was filled in, and shows the lots, the limit that decides, and what the numbers leave out", async () => {
    const api = fakeApi();
    const t = await filled(api);
    await t.click("#t-calc");
    expect(api.risk).toHaveBeenCalledWith("entry=100&stop=80&lot=75"); // (the lot size of the contracts being watched)
    const out = words(t.q("#risk-out").textContent);
    expect(out).toContain("1 lot (75 units): loss at the stop Rs 1,500, premium outlay Rs 7,500 (7.5% of capital). Decided by your per-trade limit (Rs 2,000).");
    expect(out).toContain("One lot (75 units) loses Rs 1,500 at your stop (100.00 to 80.00) and costs Rs 7,500 to buy. By limit: per-trade 1 lot(s), today 3 lot(s).");
    expect(out).toContain("The loss at the stop ignores slippage, a gap through it, brokerage and tax. You decide.");
  });

  it("the overrides are sent when filled in", async () => {
    const api = fakeApi();
    const t = await filled(api);
    t.set("r-capital", "200000");
    t.set("r-pct", "1.5");
    t.set("r-max", "9000");
    await t.click("#t-calc");
    expect(api.risk).toHaveBeenCalledWith("entry=100&stop=80&lot=75&capital=200000&risk_pct=1.5&max_loss=9000");
  });

  it("the daily limit can be the one that decides, and no lot is said as 0 lots", async () => {
    const answer = { ...riskBase, binding: "lots_by_daily_limit", left_today: 1100, lots: 0, quantity: 0, loss_at_stop: 0, outlay: 0, outlay_pct_of_capital: 0, warnings: ["not even one lot fits: one lot loses Rs 1,500 at that stop, more than what is left of today's loss limit allows"] };
    const t = await filled(fakeApi({ risk: vi.fn(async () => ok(answer)) }));
    await t.click("#t-calc");
    const out = words(t.q("#risk-out").textContent);
    expect(out).toContain("0 lots (0 units)");
    expect(out).toContain("Decided by what is left of today's loss limit (Rs 1,100)");
    expect(out).toContain("⚠ not even one lot fits");
    expect(t.q("#risk-out .flat").textContent).toContain("⚠ not even one lot fits");
  });

  it("with no limit set it gives the loss for one lot and says how to set one", async () => {
    const bare = { ...riskBase, lots: null, quantity: null, loss_at_stop: null, outlay: null, outlay_pct_of_capital: null, binding: null, per_trade_loss: null, max_daily_loss: null, lots_by_trade_limit: null, lots_by_daily_limit: null, left_today: null, warnings: ["no limit is set: set RISK_CAPITAL and RISK_PER_TRADE_PCT"] };
    const t = await filled(fakeApi({ risk: vi.fn(async () => ok(bare)) }));
    await t.click("#t-calc");
    const out = words(t.q("#risk-out").textContent);
    expect(out).toBe("One lot (75 units) loses Rs 1,500 at your stop (100.00 to 80.00) and costs Rs 7,500 to buy.⚠ no limit is set: set RISK_CAPITAL and RISK_PER_TRADE_PCT"); // (two lines of the page: the text of one runs into the next)
  });

  it("neither limit set for one of the two says 'not set' for that one, and one lot is '1 lot' and not '1 lots'", async () => {
    const t = await filled(fakeApi({ risk: vi.fn(async () => ok({ ...riskBase, lots_by_daily_limit: null, outlay_pct_of_capital: null })) }));
    await t.click("#t-calc");
    const out = words(t.q("#risk-out").textContent);
    expect(out).toContain("1 lot (75 units)");
    expect(out).not.toContain("1 lots");
    expect(out).toContain("today not set");
    expect(out).not.toContain("% of capital");
    const perTrade = await filled(fakeApi({ risk: vi.fn(async () => ok({ ...riskBase, lots_by_trade_limit: null })) }));
    await perTrade.click("#t-calc");
    expect(words(perTrade.q("#risk-out").textContent)).toContain("per-trade not set, today 3 lot(s)");
    const two = await filled(fakeApi({ risk: vi.fn(async () => ok({ ...riskBase, lots: 2, quantity: 150 })) }));
    await two.click("#t-calc");
    expect(words(two.q("#risk-out").textContent)).toContain("2 lots (150 units)");
  });

  it("a refusal is shown in plain words, in red", async () => {
    const t = await filled(fakeApi({ risk: vi.fn(async () => refused(422, { detail: "the stop premium must be below the entry premium" })) }));
    await t.click("#t-calc");
    expect(t.q("#risk-out .err").textContent).toBe("the stop premium must be below the entry premium");
    const missing = await open(fakeApi({ risk: vi.fn(async () => refused(422, { detail: [{ loc: ["query", "entry"], msg: "field required" }] })) }));
    await missing.click("#t-calc");
    expect(missing.q("#risk-out .err").textContent).toBe("fill in the entry premium, the stop premium and the lot size (numbers)");
    const old = await open(fakeApi({ risk: vi.fn(async () => refused(404, { detail: "Not Found" })) }));
    await old.click("#t-calc");
    expect(old.q("#risk-out .err").textContent).toBe("this Prism server has no calculator yet (restart Prism to load the current version)");
  });

  it("what the server says is text", async () => {
    const t = await filled(fakeApi({ risk: vi.fn(async () => ok({ ...riskBase, warnings: [EVIL] })) }));
    await t.click("#t-calc");
    expect(t.container.querySelector("img")).toBeNull();
    expect(t.q("#risk-out").textContent).toContain(EVIL);
    const bad = await filled(fakeApi({ risk: vi.fn(async () => refused(422, { detail: EVIL })) }));
    await bad.click("#t-calc");
    expect(bad.container.querySelector("img")).toBeNull();
  });

  it("an answer that is not a calculation is an error, never drawn", async () => {
    const t = await filled(fakeApi({ risk: vi.fn(async () => ok({ lots: 1 })) }));
    await t.click("#t-calc");
    expect(t.q("#risk-out .err").textContent).toBe("Prism's answer is not what this page expects");
  });
});

describe("the lot size", () => {
  const lot = (t: Awaited<ReturnType<typeof open>>) => t.q<HTMLInputElement>("#r-lot").value;
  it("is filled in from the contracts being watched", async () => {
    expect(lot(await open())).toBe("75");
  });
  it("is left as it was typed", async () => {
    const t = await open();
    t.set("r-lot", "50");
    t.rerender(variant((s) => { s.server_time += 1; }));
    expect(lot(t)).toBe("50");
  });
  it("is filled in again by the next snapshot when it was emptied", async () => {
    const t = await open();
    t.set("r-lot", "");
    expect(lot(t)).toBe("");
    t.rerender(variant((s) => { s.server_time += 1; }));
    expect(lot(t)).toBe("75");
  });
  it("is not invented when no contract has one, and waits for the first snapshot", async () => {
    const none = variant((s) => { for (const i of s.instruments) i.lot_size = null; });
    expect(lot(await open(fakeApi(), none))).toBe("");
    expect(lot(await open(fakeApi(), null))).toBe("");
  });
});

describe("the tab keeps what the reader typed when it is drawn again from scratch", () => {
  it("(the page owns the forms)", async () => {
    const api = fakeApi();
    function Page({ show }: { show: boolean }) {
      const trades = useTrades(api);
      const risk = useRisk(api);
      return show ? <TradesTab snapshot={base} trades={trades} risk={risk} /> : null;
    }
    cleanup();
    const r = render(<Page show />);
    fireEvent.change(r.container.querySelector("#t-note")!, { target: { value: "kept" } });
    fireEvent.change(r.container.querySelector("#r-entry")!, { target: { value: "100" } });
    r.rerender(<Page show={false} />);
    expect(r.container.querySelector("#t-note")).toBeNull();
    r.rerender(<Page show />);
    await waitFor(() => expect(r.container.querySelector<HTMLInputElement>("#t-note")?.value).toBe("kept"));
    expect(r.container.querySelector<HTMLInputElement>("#r-entry")?.value).toBe("100");
  });
});
