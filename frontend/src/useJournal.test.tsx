import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { JournalFetcher } from "./journalApi";
import type { JournalAnswer, Snapshot } from "./types";
import { base, journalBase, journalVariant, variant } from "./test/helpers";
import { useJournal } from "./useJournal";

/** A fetcher the test answers by hand: every ask is kept, with the signal it came with. */
function manual() {
  const asks: { signal: AbortSignal; ok: (j: JournalAnswer) => void; fail: (e: Error) => void }[] = [];
  const fetcher: JournalFetcher = (signal) => new Promise((ok, fail) => { asks.push({ signal, ok, fail }); });
  return { asks, fetcher };
}
const flush = () => act(async () => { await Promise.resolve(); });
const answer = (m: ReturnType<typeof manual>, i: number, j: JournalAnswer = journalBase) => act(async () => m.asks[i]!.ok(j));
const headline = (h: string): Snapshot => variant((s) => { s.trading!.decision.headline = h; });
const render = (m: ReturnType<typeof manual>, snapshot: Snapshot | null, active: boolean) => renderHook((p: { snapshot: Snapshot | null; active: boolean }) => useJournal(p.snapshot, p.active, m.fetcher), { initialProps: { snapshot, active } });

describe("useJournal", () => {
  it("reads nothing before the tab is open, and nothing before there is a snapshot", async () => {
    const m = manual();
    const { rerender, result } = render(m, base, false);
    await flush();
    expect(m.asks).toHaveLength(0);
    expect(result.current.state).toEqual({ data: null, error: null });
    rerender({ snapshot: null, active: true });
    await flush();
    expect(m.asks).toHaveLength(0);
  });

  it("reads once when the tab is opened, and has the answer", async () => {
    const m = manual();
    const { rerender, result } = render(m, base, false);
    rerender({ snapshot: base, active: true });
    expect(m.asks).toHaveLength(1);
    await answer(m, 0);
    expect(result.current.state).toEqual({ data: journalBase, error: null });
  });

  it("reads again when the decision changes or a setup event is added, and not for anything else", async () => {
    const m = manual();
    const { rerender } = render(m, base, true);
    await answer(m, 0);
    rerender({ snapshot: variant((s) => { s.server_time += 3; s.instruments[0]!.ltp = 24300; }), active: true }); // the page updates once a second
    await flush();
    expect(m.asks).toHaveLength(1);
    rerender({ snapshot: headline("WAIT: something else"), active: true });
    expect(m.asks).toHaveLength(2);
    await answer(m, 1);
    rerender({ snapshot: variant((s) => { s.trading!.decision.headline = "WAIT: something else"; s.trading!.events.unshift({ ...s.trading!.events[0]!, seq: 7 }); }), active: true });
    expect(m.asks).toHaveLength(3);
    await answer(m, 2);
    rerender({ snapshot: variant((s) => { s.trading!.decision.headline = "WAIT: something else"; s.trading!.events.unshift({ ...s.trading!.events[0]!, seq: 7 }); s.server_time += 1; }), active: true });
    await flush();
    expect(m.asks).toHaveLength(3);
  });

  it("reads one at a time, and reads a change that came while a read was out as soon as that read is done, once", async () => {
    const m = manual();
    const { rerender, result } = render(m, base, true);
    rerender({ snapshot: headline("one"), active: true });
    rerender({ snapshot: headline("two"), active: true });
    rerender({ snapshot: headline("three"), active: true });
    expect(m.asks).toHaveLength(1); // the first is still out
    await answer(m, 0);
    expect(m.asks).toHaveLength(2); // the changes that came meanwhile are read once, now
    const later = journalVariant((j) => { j.records = 9; });
    await answer(m, 1, later);
    expect(m.asks).toHaveLength(2);
    expect(result.current.state.data?.records).toBe(9);
  });

  it("says a failed read, keeps the last answer, and the next good read clears the failure", async () => {
    const m = manual();
    const { rerender, result } = render(m, base, true);
    await act(async () => m.asks[0]!.fail(new Error("network down")));
    expect(result.current.state).toEqual({ data: null, error: "Error: network down" });
    rerender({ snapshot: headline("x"), active: true });
    await answer(m, 1);
    expect(result.current.state).toEqual({ data: journalBase, error: null });
    rerender({ snapshot: headline("y"), active: true });
    await act(async () => m.asks[2]!.fail(new Error("again")));
    expect(result.current.state).toEqual({ data: journalBase, error: "Error: again" }); // what was read stays
  });

  it("reads when the reader asks, whatever the key, and a second ask while one is out is read once afterwards", async () => {
    const m = manual();
    const { result } = render(m, base, true);
    await answer(m, 0);
    act(() => result.current.refresh());
    expect(m.asks).toHaveLength(2);
    act(() => { result.current.refresh(); result.current.refresh(); });
    expect(m.asks).toHaveLength(2);
    await answer(m, 1);
    expect(m.asks).toHaveLength(3);
    await answer(m, 2);
    expect(m.asks).toHaveLength(3);
  });

  it("reads nothing while another tab is open, reads what changed when the tab is opened again, and keeps the journal as it was", async () => {
    const m = manual();
    const { rerender, result } = render(m, base, true);
    await answer(m, 0);
    rerender({ snapshot: base, active: false });
    rerender({ snapshot: headline("changed meanwhile"), active: false });
    await flush();
    expect(m.asks).toHaveLength(1);
    expect(result.current.state.data).toEqual(journalBase); // the page's journal is still there
    rerender({ snapshot: headline("changed meanwhile"), active: true });
    expect(m.asks).toHaveLength(2); // opened again: what changed since is read
    await answer(m, 1);
    rerender({ snapshot: headline("changed meanwhile"), active: false });
    rerender({ snapshot: headline("changed meanwhile"), active: true });
    await flush();
    expect(m.asks).toHaveLength(2); // opened again with nothing changed: nothing to read
  });

  it("is not stopped by a snapshot it cannot read", async () => {
    const m = manual();
    const bad = variant((s) => { (s.trading as unknown as Record<string, unknown>).decision = undefined; });
    expect(() => render(m, bad, true)).not.toThrow();
    expect(m.asks).toHaveLength(1);
  });

  it("leaving the page aborts the read that is out and ignores its answer", async () => {
    const m = manual();
    const { result, unmount } = render(m, base, true);
    unmount();
    expect(m.asks[0]!.signal.aborted).toBe(true);
    await answer(m, 0);
    expect(result.current.state).toEqual({ data: null, error: null });
  });
});
