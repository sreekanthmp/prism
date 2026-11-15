import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useMemo, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_OPEN } from "../analysisModel";
import { App } from "../App";
import type { JournalFetcher } from "../journalApi";
import { JOURNAL_OPEN } from "../journalModel";
import { base, EVIL, FakeSocket, fakeFactory, journalBase, journalVariant, variant } from "../test/helpers";
import type { JournalAnswer, JournalRow, Snapshot } from "../types";
import type { OpenState } from "./AnalysisStrategies";
import { JournalTab } from "./Journal";

// The current dashboard's Journal tab and this one are compared in a real browser, in each of the 14 pinned states, with the real /api/journal of each (tests/test_journal_browser.py). These tests are the
// branches one by one, on the real answer of the engine: today's journal of the BUY CE world, three decisions (WAIT 10:40, WAIT 10:45, BUY CE 10:55) and the three events of one Trend Pullback setup.
const body = () => document.getElementById("journal-body") as HTMLElement;
const sec = (k: string) => body().querySelector(`details.sec[data-key="${k}"]`) as HTMLDetailsElement;
const secText = (k: string) => sec(k).querySelector(".secbody")!.textContent!;
const rows = (k: string) => [...sec(k).querySelectorAll("tr")].slice(1);
const cells = (tr: Element) => [...tr.children].map((c) => c.textContent);
const bar = () => body().querySelector(".bar")!;
const row = (over: Partial<JournalRow> = {}): JournalRow => ({ ...structuredClone(journalBase.decisions[0]!), ...over });

function Host({ s, j, error = null, onRefresh = () => {} }: { s: Snapshot | null; j: JournalAnswer | null; error?: string | null; onRefresh?: () => void }) {
  const [open, setOpen] = useState(() => new Set([...DEFAULT_OPEN, ...JOURNAL_OPEN]));
  const os = useMemo<OpenState>(
    () => ({ isOpen: (k) => open.has(k), setOpen: (k, o) => setOpen((p) => (p.has(k) === o ? p : o ? new Set(p).add(k) : new Set([...p].filter((x) => x !== k)))) }),
    [open],
  );
  return <JournalTab snapshot={s} journal={j} error={error} onRefresh={onRefresh} os={os} />;
}
const show = (s: Snapshot | null, j: JournalAnswer | null, props: { error?: string | null; onRefresh?: () => void } = {}) => {
  cleanup();
  render(<Host s={s} j={j} {...props} />);
};

describe("before there is a snapshot, and before there is a journal", () => {
  it("is empty before the first snapshot", () => {
    show(null, null);
    expect(body().children).toHaveLength(0);
  });
  it("says it is loading, and has the live events to show meanwhile", () => {
    show(base, null);
    expect([...bar().children].map((c) => c.textContent)).toEqual(["Today's decision journal", "loading…", "Refresh"]);
    expect(sec("j-decisions")).toBeNull(); // (no decision history without the journal)
    expect(rows("j-lifecycle")).toHaveLength(1); // the setup's life, from the live events of the snapshot
    expect(secText("j-events")).toContain("CONFIRMED: trigger 24,281.00");
  });
  it("says why it could not be read, in the failure's own words, while it has nothing else", () => {
    show(base, null, { error: "TypeError: Failed to fetch" });
    expect(bar().children[1]?.textContent).toBe("could not load: TypeError: Failed to fetch");
    show(base, journalBase, { error: "TypeError: Failed to fetch" });
    expect(bar().children[1]?.textContent).toBe("decision changes, setup lifecycle and explanations, newest first"); // (a journal that was read stays, whatever a later read did)
  });
  it("says there is no journal, with the reason, and shows the live events only", () => {
    show(base, { available: false, reason: "no decision journal is configured", file: null, records: 0, decisions: [], events: [] });
    expect(bar().children[1]?.textContent).toBe("no decision journal is configured: showing the live events only");
    expect(bar().children[0]?.textContent).toBe("Today's decision journal");
    expect(sec("j-decisions")).toBeNull();
    expect(rows("j-events")).toHaveLength(3); // the three live events of the snapshot
  });
  it("shows the journal's own events, not the live ones, once it is there", () => {
    const j = journalVariant((x) => { x.events = [{ ...x.events[0]!, text: "FROM THE FILE" }]; });
    show(base, j);
    expect(secText("j-events")).toContain("FROM THE FILE");
    expect(rows("j-events")).toHaveLength(1);
    expect(sec("j-events").querySelector("summary .mut")?.textContent).toBe("1 events");
  });
});

describe("the bar", () => {
  it("says the file and how many records it holds, what the tab shows, and has a Refresh button", () => {
    show(base, journalBase);
    expect([...bar().children].map((c) => c.textContent)).toEqual(["Today's decision journal (decisions-2026-11-06.jsonl, 4 records)", "decision changes, setup lifecycle and explanations, newest first", "Refresh"]);
    expect(bar().querySelector("button")?.id).toBe("j-refresh");
    expect(bar().querySelector("button")?.className).toBe("linkbtn");
  });
  it("asks for the journal again when Refresh is clicked", () => {
    const onRefresh = vi.fn();
    show(base, journalBase, { onRefresh });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
  it("says in amber how many lines of the file could not be read, and only for a journal that was read", () => {
    show(base, journalVariant((j) => { j.bad_lines = 2; j.unreadable_records = 1; }));
    const w = bar().querySelector(".flat")!;
    expect(w.textContent).toBe("⚠ 3 line(s) of the file could not be read and are not shown");
    expect(w.getAttribute("title")).toBe("the file holds lines that are not records (a write cut short by a crash?): the review command says which, with --verify");
    show(base, journalVariant((j) => { j.bad_lines = 1; }));
    expect(bar().querySelector(".flat")?.textContent).toMatch(/^⚠ 1 line\(s\)/);
    show(base, journalVariant((j) => { j.unreadable_records = 4; }));
    expect(bar().querySelector(".flat")?.textContent).toMatch(/^⚠ 4 line\(s\)/);
    show(base, journalBase);
    expect(bar().querySelector(".flat")).toBeNull();
    show(base, { available: false, reason: "x", file: null, records: 0, decisions: [], events: [], bad_lines: 5 });
    expect(bar().querySelector(".flat")).toBeNull(); // (no journal: nothing to say of its lines)
  });
  it("leaves out the file when it has none", () => {
    show(base, journalVariant((j) => { j.file = null; }));
    expect(bar().children[0]?.textContent).toBe("Today's decision journal");
  });
});

describe("the decision history", () => {
  it("is a table, newest first: time, decision and why it was written, price, market, strategy, and the reasons", () => {
    show(base, journalBase);
    expect([...sec("j-decisions").querySelectorAll("th")].map((h) => h.textContent)).toEqual(["Time", "Decision", "NIFTY", "Market", "Strategy", "Why"]);
    const r = rows("j-decisions");
    expect(r).toHaveLength(3);
    expect(cells(r[0]!).slice(0, 5)).toEqual(["10:55:05", "BUY CE changed", "24285.00", "bullish trend up", "Trend Pullback"]);
    expect(cells(r[1]!).slice(0, 2)).toEqual(["10:45:05", "WAIT changed"]);
    expect(cells(r[2]!).slice(0, 2)).toEqual(["10:40:05", "WAIT start"]);
    expect(sec("j-decisions").querySelector("summary .mut")?.textContent).toBe("each change of decision, with the reasons for and against");
  });
  it("colours the decision: BUY CE green, WAIT amber, and the market by its direction", () => {
    show(base, journalBase);
    const r = rows("j-decisions");
    expect(r[0]!.querySelector("b")?.className).toBe("up");
    expect(r[1]!.querySelector("b")?.className).toBe("flat");
    expect(r[0]!.children[3]?.className).toBe("l up");
    show(base, journalVariant((j) => { j.decisions = [row({ action: "BUY PE", direction: "bearish" }), row({ action: "NO TRADE", direction: "sideways" }), row({ action: null, direction: null, strategy_name: null })]; }));
    expect(rows("j-decisions").map((x) => x.querySelector("b")?.className)).toEqual(["down", "neu", "neu"]);
    expect(rows("j-decisions").map((x) => x.children[3]?.className)).toEqual(["l down", "l neu", "l neu"]);
    expect(cells(rows("j-decisions")[2]!).slice(0, 5)).toEqual(["10:55:05", "– changed", "24285.00", "– trend up", "–"]); // (no decision, no direction, no strategy: dashes)
  });
  it("says the headline, the reasons for in green and against in amber, and the permission and the regime facts", () => {
    show(base, journalBase);
    const why = rows("j-decisions")[0]!.children[5]!;
    expect(why.querySelector("b")?.textContent).toBe("BUY CE: Trend Pullback setup confirmed");
    expect([...why.querySelectorAll(":scope > .up")].map((d) => d.textContent)).toEqual([
      "+ 1H bullish (ADX 100.0); 15M bullish with HH_HL structure",
      "+ pulled back 36.0 pts (2.7x ATR15) from the 24,308.00 high to 24,272.00, at previous day high 24,270.55",
      "+ the pullback holds above the leg's origin 24,249.45, so the bullish structure is intact",
      "+ bullish rejection candle at 10:40 (lower wick 56% of its range)",
    ]);
    expect([...why.querySelectorAll(":scope > .flat")].map((d) => d.textContent)).toEqual(["− 15M RSI 73.9: momentum is already stretched in this direction"]);
    expect([...why.querySelectorAll(":scope > .mut")].map((d) => d.textContent)).toEqual([
      "⚑ counter-trend PE denied: denied: weakening continuation (regime fact: 0 of 6 weakening checks hold (needs 2))",
      "regime: strong trend: bullish · range / pause / pullback / breakout: pullback",
    ]);
  });
  it("says the option contract chosen for a BUY, and a granted permission, and only the permissions that were needed", () => {
    show(base, journalVariant((j) => {
      j.decisions[0]!.options = "NIFTY10NOV202624200CE";
      j.decisions[0]!.counter_trend = [{ strategy_name: "TER", side: "PE", needed: true, granted: true, reason: "an established trend" }, { strategy_name: "TER", side: "CE", needed: false, granted: false, reason: "not needed" }];
      j.decisions[0]!.regime_active = [];
    }));
    const why = rows("j-decisions")[0]!.children[5]!;
    expect(why.querySelector("b + .mut")?.textContent).toBe("· option NIFTY10NOV202624200CE");
    expect([...why.querySelectorAll(":scope > div.mut")].map((d) => d.textContent)).toEqual(["⚑ counter-trend PE granted: an established trend"]);
  });
  it("says an older record that has no permissions and no regime facts without them", () => {
    show(base, journalVariant((j) => { delete (j.decisions[0] as unknown as Record<string, unknown>).counter_trend; delete (j.decisions[0] as unknown as Record<string, unknown>).regime_active; }));
    expect(rows("j-decisions")[0]!.children[5]!.querySelectorAll(":scope > div.mut")).toHaveLength(0);
  });
  it("draws the latest 150 and says how many there are, and says when there is none", () => {
    show(base, journalVariant((j) => { j.decisions = Array.from({ length: 151 }, (_, i) => row({ time: 1793942705 - i, headline: `decision ${i}` })); }));
    expect(rows("j-decisions")).toHaveLength(150);
    expect(cells(rows("j-decisions")[149]!)[5]).toContain("decision 149");
    expect(secText("j-decisions")).toContain("showing the latest 150 of 151");
    show(base, journalVariant((j) => { j.decisions = Array.from({ length: 150 }, () => row()); }));
    expect(secText("j-decisions")).not.toContain("showing the latest");
    show(base, journalVariant((j) => { j.decisions = []; }));
    expect(rows("j-decisions")).toHaveLength(0);
    expect(secText("j-decisions")).toContain("no decision has been recorded today");
    show(base, journalBase);
    expect(secText("j-decisions")).not.toContain("no decision has been recorded");
  });
});

describe("the lifecycle of the setups", () => {
  it("is one line for each setup: every status with its time, where it stands now, and its latest note", () => {
    show(base, journalBase);
    expect([...sec("j-lifecycle").querySelectorAll("th")].map((h) => h.textContent)).toEqual(["Setup", "Strategy", "Lifecycle", "Now", "Latest note"]);
    expect(rows("j-lifecycle")).toHaveLength(1);
    expect(cells(rows("j-lifecycle")[0]!)).toEqual(["CE", "Trend Pullback", "detected 10:40 → waiting_for_confirmation 10:45 → confirmed 10:55", "confirmed", "CONFIRMED: trigger 24,281.00 (confirming candle completed 10:55)"]);
    expect(rows("j-lifecycle")[0]!.children[0]?.className).toBe("l up");
    expect([...rows("j-lifecycle")[0]!.querySelectorAll(".st")].map((s) => s.className)).toEqual(["st st-DETECTED", "st st-WAITING_FOR_CONFIRMATION", "st st-CONFIRMED", "st st-CONFIRMED"]);
    expect(sec("j-lifecycle").querySelector("summary .mut")?.textContent).toBe("from detection to confirmation, expiry or invalidation");
  });
  it("lists the setup that started last first, a put in red", () => {
    show(base, journalVariant((j) => {
      const mk = (seq: number, id: string, status: string, direction: string) => ({ ...j.events[0]!, seq, id, status, direction, strategy_name: direction === "PE" ? "Range Bounce" : "Trend Pullback", text: `${status}: ${id}`, time: 1793942000 + seq });
      j.events = [mk(5, "b", "INVALIDATED", "PE"), mk(4, "b", "DETECTED", "PE"), mk(3, "a", "CONFIRMED", "CE"), mk(2, "a", "DETECTED", "CE")];
    }));
    expect(rows("j-lifecycle").map((r) => cells(r)[1])).toEqual(["Range Bounce", "Trend Pullback"]);
    expect(rows("j-lifecycle")[0]!.children[0]?.className).toBe("l down");
    expect(cells(rows("j-lifecycle")[0]!)[3]).toBe("invalidated");
  });
  it("says no setup was announced, when none was", () => {
    show(base, journalVariant((j) => { j.events = []; }));
    expect(secText("j-lifecycle")).toBe("no setup has been announced today");
    expect(sec("j-lifecycle").querySelector("table")).toBeNull();
  });
});

describe("the setups that ended, and every event", () => {
  it("say none today, and how many", () => {
    show(base, journalBase);
    expect(secText("j-ended")).toBe("none today");
    expect(sec("j-ended").querySelector("summary .mut")?.textContent).toBe("0 today");
  });
  it("name each setup that expired, was invalidated or was missed, with its time, side and note", () => {
    show(base, journalVariant((j) => { j.events = [{ ...j.events[0]!, seq: 4, status: "MISSED", direction: "PE", strategy_name: "Range Bounce", text: "MISSED: price left the entry area", time: 1793942705 }, { ...j.events[0]!, seq: 3, status: "EXPIRED", text: "EXPIRED: no confirmation within 30 minutes", time: 1793942400 }, ...j.events]; }));
    const lines = [...sec("j-ended").querySelectorAll(".secbody > div")].map((d) => d.textContent);
    expect(lines).toEqual(["10:55 PE Range Bounce missed — MISSED: price left the entry area", "10:50 CE Trend Pullback expired — EXPIRED: no confirmation within 30 minutes"]);
    expect(sec("j-ended").querySelector("b")?.className).toBe("down");
    expect(sec("j-ended").querySelector("summary .mut")?.textContent).toBe("2 today");
  });
  it("list every event with its time to the second, side, strategy, status and what happened", () => {
    show(base, journalBase);
    expect([...sec("j-events").querySelectorAll("th")].map((h) => h.textContent)).toEqual(["Time", "Setup", "Strategy", "Status", "What happened"]);
    expect(rows("j-events").map((r) => cells(r))).toEqual([
      ["10:55:05", "CE", "Trend Pullback", "confirmed", "CONFIRMED: trigger 24,281.00 (confirming candle completed 10:55)"],
      ["10:45:05", "CE", "Trend Pullback", "waiting_for_confirmation", "WAITING_FOR_CONFIRMATION: trigger 24,281.00"],
      ["10:40:05", "CE", "Trend Pullback", "detected", "DETECTED: leg origin 24,249.45"],
    ]);
    expect(sec("j-events").querySelector("summary .mut")?.textContent).toBe("3 events");
  });
  it("colour the side: a call green and a put red", () => {
    show(base, journalVariant((j) => { j.events = [{ ...j.events[0]!, seq: 4, direction: "PE", strategy_name: "Range Bounce" }, ...j.events]; }));
    expect(rows("j-events").map((r) => [r.children[1]?.textContent, r.children[1]?.className])).toEqual([["PE", "l down"], ["CE", "l up"], ["CE", "l up"], ["CE", "l up"]]);
  });
  it("say there are no events", () => {
    show(base, journalVariant((j) => { j.events = []; }));
    expect(secText("j-events")).toBe("no events today");
    expect(sec("j-events").querySelector("summary .mut")?.textContent).toBe("0 events");
  });
});

describe("the decision as it stands, and the trades", () => {
  it("explains the current decision in plain words, with its reasons for and against", () => {
    show(base, journalBase);
    const t = secText("j-explain");
    expect(t).toContain("In plain words (about the setup this decision refers to)");
    expect(t).toContain("BUY CE: Trend Pullback setup confirmed");
    expect(t).toContain("+ 1H bullish (ADX 100.0); 15M bullish with HH_HL structure");
    expect(t).toContain("− 15M RSI 73.9: momentum is already stretched in this direction");
    expect(sec("j-explain").querySelector("summary .mut")?.textContent).toBe("the plain-words explanation of the current decision");
    expect([...sec("j-explain").querySelectorAll(".secbody > .why.up")].map((d) => d.textContent)).toHaveLength(4); // the reasons for are green...
    expect([...sec("j-explain").querySelectorAll(".secbody > .why.flat")].map((d) => d.textContent)).toEqual(["− 15M RSI 73.9: momentum is already stretched in this direction"]); // ...and the one against is amber
  });
  it("has no account when the engine gave none, and no explanation at all with no decision", () => {
    show(variant((s) => { s.trading!.explain = null; }), journalBase);
    expect(sec("j-explain").querySelector(".card")).toBeNull();
    expect(secText("j-explain")).toContain("BUY CE: Trend Pullback setup confirmed");
    show(variant((s) => { s.trading = null; }), journalBase);
    expect(sec("j-explain")).toBeNull();
    expect(rows("j-events")).toHaveLength(3); // (the journal's events do not need the decision)
  });
  it("says Prism records no trades", () => {
    show(base, journalBase);
    expect(secText("j-trades")).toBe("Prism does not record trades: it places no orders and has no trade log, so there is nothing to show here. The journal above is the record of what Prism said and why.");
    expect(sec("j-trades").querySelector("summary .mut")?.textContent).toBe("none");
  });
});

describe("the sections", () => {
  it("are in the order the tab reads, and only the history of decisions and the lifecycle are open at the start", () => {
    show(base, journalBase);
    expect([...body().querySelectorAll(":scope > details.sec")].map((d) => d.getAttribute("data-key"))).toEqual(["j-decisions", "j-lifecycle", "j-ended", "j-events", "j-explain", "j-trades"]);
    expect([...body().querySelectorAll<HTMLDetailsElement>(":scope > details.sec")].filter((d) => d.open).map((d) => d.getAttribute("data-key"))).toEqual(["j-decisions", "j-lifecycle"]);
    expect([...body().querySelectorAll(":scope > details.sec > summary")].map((s) => s.firstChild?.textContent)).toEqual([
      "Decision history", "Setup lifecycle history", "Expired and invalidated setups", "Full strategy events", "Decision explanation (now)", "Manually recorded trades",
    ]);
  });
});

describe("what a server says is only ever text", () => {
  it("is not turned into markup anywhere on the tab", () => {
    show(variant((s) => { s.trading!.decision.headline = EVIL; s.trading!.decision.reasons = [EVIL]; s.trading!.decision.against = [EVIL]; s.trading!.explain!.note = EVIL; }), journalVariant((j) => {
      j.file = EVIL; j.reason = EVIL;
      Object.assign(j.decisions[0]!, { headline: EVIL, reasons: [EVIL], against: [EVIL], reason: EVIL, regime: EVIL, options: EVIL, strategy_name: EVIL, regime_active: [EVIL], counter_trend: [{ strategy_name: EVIL, side: EVIL, needed: true, granted: false, reason: EVIL }] });
      Object.assign(j.events[0]!, { text: EVIL, strategy_name: EVIL, status: "CONFIRMED" });
    }));
    expect(document.querySelector("img")).toBeNull();
    expect(body().innerHTML).not.toContain("<img");
    expect(body().textContent).toContain(EVIL);
    show(base, { available: false, reason: EVIL, file: null, records: 0, decisions: [], events: [] });
    expect(bar().children[1]?.textContent).toBe(EVIL + ": showing the live events only");
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("the Journal tab in the dashboard", () => {
  const mount = (hash: string, fetchJournal: JournalFetcher) => {
    cleanup();
    FakeSocket.reset();
    location.hash = hash;
    render(<App url="ws://prism.test/ws" createSocket={fakeFactory} fetchJournal={fetchJournal} />);
    act(() => { FakeSocket.last.send(base); });
  };
  const fetcher = (j: JournalAnswer = journalBase) => vi.fn<JournalFetcher>(async () => j);
  const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

  it("reads the journal when it is opened, and not before", async () => {
    const f = fetcher();
    mount("#overview", f);
    await settle();
    expect(f).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "Journal" }));
    await settle();
    expect(f).toHaveBeenCalledTimes(1);
    expect(bar().children[0]?.textContent).toBe("Today's decision journal (decisions-2026-11-06.jsonl, 4 records)");
    expect(rows("j-decisions")).toHaveLength(3);
  });
  it("is opened by #journal, is read once, and again when the decision or an event changes: not for each snapshot", async () => {
    const f = fetcher();
    mount("#journal", f);
    await settle();
    expect(f).toHaveBeenCalledTimes(1);
    act(() => { FakeSocket.last.send(variant((s) => { s.server_time += 1; })); });
    act(() => { FakeSocket.last.send(variant((s) => { s.server_time += 2; })); });
    await settle();
    expect(f).toHaveBeenCalledTimes(1);
    act(() => { FakeSocket.last.send(variant((s) => { s.trading!.decision.headline = "WAIT: something else"; })); });
    await settle();
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("reads again when the reader clicks Refresh", async () => {
    const f = fetcher();
    mount("#journal", f);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await settle();
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("keeps the journal while another tab is open, and what the reader opened", async () => {
    const f = fetcher();
    mount("#journal", f);
    await settle();
    fireEvent.click(sec("j-events").querySelector("summary")!);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    fireEvent.click(screen.getByRole("tab", { name: "Journal" }));
    expect(rows("j-decisions")).toHaveLength(3); // there at once, as it was read
    expect(sec("j-events").open).toBe(true);
    await settle();
    expect(f).toHaveBeenCalledTimes(1); // and nothing was read again: nothing changed
  });
  it("says it could not read the journal, and shows the live events while it has none", async () => {
    const f = vi.fn<JournalFetcher>(async () => { throw new TypeError("Failed to fetch"); });
    mount("#journal", f);
    await settle();
    expect(bar().children[1]?.textContent).toBe("could not load: TypeError: Failed to fetch");
    expect(rows("j-lifecycle")).toHaveLength(1);
  });
  it("is stale with the page: the last journal and the last snapshot, dimmed", async () => {
    mount("#journal", fetcher());
    await settle();
    act(() => { FakeSocket.last.drop(); });
    expect(document.getElementById("main")?.className).toBe("staled");
    expect(rows("j-decisions")).toHaveLength(3);
  });
  it("opens at the start the decision history and the lifecycle, and nothing else of the journal", async () => {
    mount("#journal", fetcher());
    await settle();
    expect([...body().querySelectorAll<HTMLDetailsElement>(":scope > details.sec")].filter((d) => d.open).map((d) => d.getAttribute("data-key"))).toEqual(["j-decisions", "j-lifecycle"]);
  });
  it("draws the journal again with the next snapshot after it could not be drawn", async () => {
    const quiet = (e: ErrorEvent) => e.preventDefault();
    window.addEventListener("error", quiet);
    const spy = console.error;
    console.error = () => {};
    const bad = journalVariant((j) => { (j.decisions[0] as unknown as Record<string, unknown>).regime_active = "x"; (j.decisions[0] as unknown as Record<string, unknown>).counter_trend = [null]; });
    const f = vi.fn<JournalFetcher>().mockResolvedValueOnce(bad).mockResolvedValue(journalBase); // the first answer cannot be drawn, the next can
    mount("#journal", f);
    await settle();
    expect(document.getElementById("jserr")?.textContent).toMatch(/^Dashboard display error in journal: /);
    act(() => { FakeSocket.last.send(variant((s) => { s.trading!.decision.headline = "WAIT: something else"; })); }); // a change: the journal is read again, and a snapshot is a new draw
    await settle();
    expect(document.getElementById("jserr")).toBeNull();
    expect(rows("j-decisions")).toHaveLength(3);
    console.error = spy;
    window.removeEventListener("error", quiet);
  });
  it("draws the tab again with the next snapshot after a snapshot it could not draw, whatever the journal says", async () => {
    const quiet = (e: ErrorEvent) => e.preventDefault();
    window.addEventListener("error", quiet);
    const spy = console.error;
    console.error = () => {};
    mount("#journal", fetcher());
    await settle();
    expect(rows("j-decisions")).toHaveLength(3);
    act(() => { FakeSocket.last.send(variant((s) => { (s.trading as unknown as Record<string, unknown>).decision = { ...s.trading!.decision, reasons: undefined }; })); });
    expect(document.getElementById("jserr")?.textContent).toMatch(/^Dashboard display error in journal: /);
    act(() => { FakeSocket.last.send(base); }); // the journal itself did not change: the next snapshot is a new draw
    expect(document.getElementById("jserr")).toBeNull();
    expect(rows("j-decisions")).toHaveLength(3);
    console.error = spy;
    window.removeEventListener("error", quiet);
  });
  it("says a journal it cannot draw in words, and keeps the page", async () => {
    const quiet = (e: ErrorEvent) => e.preventDefault();
    window.addEventListener("error", quiet);
    const spy = console.error;
    console.error = () => {};
    mount("#journal", fetcher(journalVariant((j) => { (j.decisions[0] as unknown as Record<string, unknown>).regime_active = "x"; (j.decisions[0] as unknown as Record<string, unknown>).counter_trend = [null]; })));
    await settle();
    expect(document.getElementById("jserr")?.textContent).toMatch(/^Dashboard display error in journal: /);
    expect(document.getElementById("c-market")?.textContent).toBe("MARKET OPEN");
    console.error = spy;
    window.removeEventListener("error", quiet);
  });
});
