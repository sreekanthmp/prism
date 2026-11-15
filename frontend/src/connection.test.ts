import { describe, expect, it } from "vitest";
import { initialState, RECONNECT_MS, reduce, SILENT_MS, type ConnectionState } from "./connection";
import { base, variant } from "./test/helpers";

const live = reduce(initialState, { type: "snapshot", snapshot: base });

describe("the loading / live / stale contract", () => {
  it("keeps the current dashboard's two timings: stale after 5 s of silence, reconnect after 2 s", () => {
    expect(SILENT_MS).toBe(5000);
    expect(RECONNECT_MS).toBe(2000);
  });

  it("starts loading with nothing to show", () => {
    expect(initialState).toEqual({ conn: "loading", snapshot: null, tries: 0 });
  });

  it("counts connection attempts only while there is still no snapshot", () => {
    let s: ConnectionState = initialState;
    for (let i = 1; i <= 3; i++) {
      s = reduce(s, { type: "attempt" });
      expect(s.tries).toBe(i);
    }
    expect(reduce(live, { type: "attempt" })).toBe(live); // with a snapshot on screen a reconnect is not "cannot be reached"
  });

  it("a snapshot makes the page live and forgets the attempts", () => {
    const s = reduce({ ...initialState, tries: 4 }, { type: "snapshot", snapshot: base });
    expect(s).toEqual({ conn: "live", snapshot: base, tries: 0 });
  });

  it("a lost link with no snapshot is still loading, not stale", () => {
    const s = reduce({ ...initialState, tries: 2 }, { type: "lost" });
    expect(s).toEqual({ conn: "loading", snapshot: null, tries: 2 });
  });

  it("a lost link after a snapshot is stale, and keeps that snapshot for inspection", () => {
    const s = reduce(live, { type: "lost" });
    expect(s.conn).toBe("stale");
    expect(s.snapshot).toBe(base);
  });

  it("losing it again changes nothing", () => {
    const stale = reduce(live, { type: "lost" });
    expect(reduce(stale, { type: "lost" })).toBe(stale);
  });

  it("the next snapshot makes it live again from that snapshot alone", () => {
    const stale = reduce(live, { type: "lost" });
    const fresh = variant((s) => {
      s.server_time += 30;
    });
    const s = reduce(stale, { type: "snapshot", snapshot: fresh });
    expect(s).toEqual({ conn: "live", snapshot: fresh, tries: 0 });
    expect(s.snapshot).not.toBe(base); // nothing of the old one is carried over
  });
});
