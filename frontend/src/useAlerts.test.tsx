import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fx from "./alertEffects";
import type { AlertMode } from "./alertEvents";
import { base, variant } from "./test/helpers";
import type { Setup, Snapshot } from "./types";
import { useAlerts } from "./useAlerts";

vi.mock("./alertEffects", () => ({ beep: vi.fn(), popup: vi.fn(), askPopupPermission: vi.fn(), readMode: vi.fn(() => "sound"), saveMode: vi.fn(), unlockSound: vi.fn() }));

const setup = base.trading!.setups[0]!;
const staged = (stage: string, over: Partial<Setup> = {}): Snapshot => variant((s) => { Object.assign(s.trading!.setups[0]!, { stage, ...over }); });
const mount = (mode: AlertMode = "sound", strict = false) => {
  vi.mocked(fx.readMode).mockReturnValue(mode);
  return renderHook(() => useAlerts(), strict ? { wrapper: StrictMode } : undefined);
};
/** The connection tells the alerts of each snapshot as it arrives. */
const tell = (h: ReturnType<typeof mount>, ...snaps: Snapshot[]) => act(() => { for (const s of snaps) h.result.current.listeners.onSnapshot?.(s); });
const ready = () => [staged("CONFIRMED"), base] as const;

beforeEach(() => {
  vi.clearAllMocks();
  document.title = "Prism";
});
afterEach(() => {
  Object.defineProperty(document, "hidden", { value: false, configurable: true });
});

describe("the alerts a snapshot raises", () => {
  it("the first snapshot raises nothing: no log, no sound, no count in the title", () => {
    const h = mount();
    tell(h, base);
    expect(h.result.current.state).toEqual({ log: [], unseen: 0 });
    expect(fx.beep).not.toHaveBeenCalled();
    expect(document.title).toBe("Prism");
  });

  it("a setup that becomes ready is logged, sounds once, and is counted in the title", () => {
    const h = mount();
    tell(h, ...ready());
    expect(h.result.current.state.log.map((x) => [x.level, x.key, x.title, x.t])).toEqual([["act", "ready:" + setup.id, "CE setup ready: Trend Pullback", base.server_time]]);
    expect(fx.beep).toHaveBeenCalledTimes(1);
    expect(fx.beep).toHaveBeenCalledWith("act");
    expect(fx.popup).not.toHaveBeenCalled(); // (the default is a sound only)
    expect(document.title).toBe("(1) Prism");
  });

  it("is told of every snapshot, not only the last of those that arrived together", () => {
    const h = mount();
    tell(h, staged("CONFIRMED"), base, staged("INVALIDATED")); // ready and ended between two redraws: both are news
    expect(h.result.current.state.log.map((x) => x.title)).toEqual(["CE setup no longer ready: Trend Pullback", "CE setup ready: Trend Pullback"]);
    expect(fx.beep).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fx.beep).mock.calls.map((c) => c[0])).toEqual(["act", "warn"]);
  });

  it("one sound for a snapshot however many things changed, and a popup for each when popups are on", () => {
    const h = mount("sound + popup");
    const other = { ...structuredClone(setup), id: "breakout_retest:bull:1793940300", strategy_name: "Breakout and Retest" };
    const first = staged("CONFIRMED");
    first.trading!.setups.push({ ...structuredClone(other), stage: "CONFIRMED" });
    const second = variant((s) => { s.trading!.setups.push(structuredClone(other)); });
    tell(h, first, second);
    expect(fx.beep).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fx.popup).mock.calls.map((c) => c[0].title)).toEqual(["CE setup ready: Trend Pullback", "CE setup ready: Breakout and Retest"]);
    expect(document.title).toBe("(2) Prism");
  });

  it("off keeps the log and the count but makes no sound and no popup", () => {
    const h = mount("off");
    tell(h, ...ready());
    expect(h.result.current.state.log).toHaveLength(1);
    expect(document.title).toBe("(1) Prism");
    expect(fx.beep).not.toHaveBeenCalled();
    expect(fx.popup).not.toHaveBeenCalled();
  });

  it("news that is only noted (ready again) is logged and counted but makes no sound", () => {
    const h = mount();
    const not = variant((s) => { Object.assign(s.health.readiness!, { ready: false, state: "RECOVERING_GAPS" }); });
    tell(h, base, not);
    vi.mocked(fx.beep).mockClear();
    tell(h, variant((s) => { s.server_time = not.server_time + 1; }));
    expect(h.result.current.state.log[0]?.title).toBe("Prism is ready again");
    expect(fx.beep).not.toHaveBeenCalled();
  });

  it("a link that is lost is a warning, told once", () => {
    const h = mount();
    tell(h, base);
    act(() => h.result.current.listeners.onLost?.(base));
    expect(h.result.current.state.log.map((x) => [x.key, x.level, x.t])).toEqual([["link", "warn", base.server_time]]);
    expect(fx.beep).toHaveBeenCalledWith("warn");
  });

  it("an alert that is not about a snapshot (your loss limit) is raised the same way, with the time it is given", () => {
    const h = mount();
    act(() => h.result.current.raise([{ level: "warn", key: "daily-loss", title: "Your daily loss limit is reached", text: "x" }], 123));
    expect(h.result.current.state.log[0]).toMatchObject({ key: "daily-loss", t: 123 });
    expect(fx.beep).toHaveBeenCalledWith("warn");
    act(() => h.result.current.raise([], 5));
    expect(h.result.current.state.log).toHaveLength(1);
  });

  it("makes each sound once under React's strict mode too", () => {
    const h = mount("sound", true);
    tell(h, ...ready());
    expect(fx.beep).toHaveBeenCalledTimes(1);
    expect(h.result.current.state.log).toHaveLength(1);
  });

  it("remembers between snapshots (a setup that flickers in and out of its entry area is one alert, not four)", () => {
    const h = mount();
    const at = (s: Snapshot, n: number): Snapshot => ({ ...s, server_time: s.server_time + n });
    tell(h, staged("CONFIRMED"), base, at(staged("CONFIRMED"), 5), at(base, 10), at(staged("CONFIRMED"), 15), at(base, 20));
    expect(h.result.current.state.log.map((x) => x.title)).toEqual(["CE setup ready: Trend Pullback"]);
    expect(fx.beep).toHaveBeenCalledTimes(1);
  });

  it("hands the connection the same listeners however often the page is redrawn", () => {
    const h = mount();
    const first = h.result.current.listeners;
    h.rerender();
    tell(h, base);
    expect(h.result.current.listeners).toBe(first);
  });
});

describe("seen", () => {
  const unseen = (h: ReturnType<typeof mount>) => h.result.current.state.unseen;
  it("a click anywhere on the page clears the count (the log stays) and wakes the sound", () => {
    const h = mount();
    tell(h, ...ready());
    expect(unseen(h)).toBe(1);
    act(() => { document.body.click(); });
    expect(unseen(h)).toBe(0);
    expect(document.title).toBe("Prism");
    expect(h.result.current.state.log).toHaveLength(1);
    expect(fx.unlockSound).toHaveBeenCalledTimes(1);
  });

  it("coming back to the window, or to the tab, clears it; a tab that is hidden does not", () => {
    const h = mount();
    tell(h, ...ready());
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(unseen(h)).toBe(1);
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(unseen(h)).toBe(0);
    tell(h, staged("INVALIDATED")); // (the setup that was ready ends)
    expect(unseen(h)).toBe(1);
    act(() => { window.dispatchEvent(new Event("focus")); });
    expect(unseen(h)).toBe(0);
  });

  it("the count goes on from the next alert", () => {
    const h = mount();
    tell(h, ...ready());
    act(() => { document.body.click(); });
    tell(h, staged("INVALIDATED"));
    expect(unseen(h)).toBe(1);
    expect(document.title).toBe("(1) Prism");
  });

  it("clear empties the log and the count", () => {
    const h = mount();
    tell(h, ...ready());
    act(() => h.result.current.clear());
    expect(h.result.current.state).toEqual({ log: [], unseen: 0 });
    expect(document.title).toBe("Prism");
  });

  it("stops listening to the page when it is gone: each of the three listeners it added is taken away", () => {
    const onWindow = vi.spyOn(window, "removeEventListener");
    const onDocument = vi.spyOn(document, "removeEventListener");
    const h = mount();
    h.unmount();
    expect(onWindow.mock.calls.map((c) => c[0])).toContain("focus");
    expect(onDocument.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(["visibilitychange", "click"]));
    document.body.click();
    expect(fx.unlockSound).not.toHaveBeenCalled();
    onWindow.mockRestore();
    onDocument.mockRestore();
  });
});

describe("the mode", () => {
  it("starts in the one that was saved", () => {
    expect(mount("off").result.current.mode).toBe("off");
    expect(mount("sound + popup").result.current.mode).toBe("sound + popup");
  });

  it("the button goes round: off, sound + popup (asks the browser once and plays a test tone), sound (a test tone)", () => {
    const h = mount("sound");
    act(() => h.result.current.cycleMode());
    expect(h.result.current.mode).toBe("off");
    expect(fx.saveMode).toHaveBeenLastCalledWith("off");
    expect(fx.beep).not.toHaveBeenCalled();
    expect(fx.askPopupPermission).not.toHaveBeenCalled();
    act(() => h.result.current.cycleMode());
    expect(h.result.current.mode).toBe("sound + popup");
    expect(fx.saveMode).toHaveBeenLastCalledWith("sound + popup");
    expect(fx.askPopupPermission).toHaveBeenCalledTimes(1);
    expect(fx.beep).toHaveBeenLastCalledWith("info");
    act(() => h.result.current.cycleMode());
    expect(h.result.current.mode).toBe("sound");
    expect(fx.askPopupPermission).toHaveBeenCalledTimes(1);
    expect(fx.beep).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fx.saveMode).mock.calls.map((c) => c[0])).toEqual(["off", "sound + popup", "sound"]);
  });

  it("two clicks before the page is redrawn are two steps", () => {
    const h = mount("sound");
    act(() => { h.result.current.cycleMode(); h.result.current.cycleMode(); });
    expect(h.result.current.mode).toBe("sound + popup");
  });

  it("what raises an alert uses the mode the reader has chosen now", () => {
    const h = mount("sound");
    act(() => h.result.current.cycleMode()); // off
    vi.mocked(fx.beep).mockClear();
    tell(h, ...ready());
    expect(fx.beep).not.toHaveBeenCalled();
    act(() => h.result.current.cycleMode()); // sound + popup
    vi.mocked(fx.beep).mockClear();
    tell(h, staged("INVALIDATED"));
    expect(fx.beep).toHaveBeenCalledWith("warn");
    expect(vi.mocked(fx.popup).mock.calls.map((c) => c[0].title)).toEqual(["CE setup no longer ready: Trend Pullback"]);
  });
});
