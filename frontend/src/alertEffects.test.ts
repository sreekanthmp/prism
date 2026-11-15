import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODE_KEY, type AlertEvent } from "./alertEvents";

// What the browser is asked to do for an alert: a sound, a popup, a remembered choice. Each may be missing or may fail; none may stop the page.

type Osc = { type: string; frequency: { value: number }; connect: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };
class FakeAudio {
  static all: FakeAudio[] = [];
  static suspended = false;
  static resumeFails = false;
  static oscillatorFails = false;
  state = FakeAudio.suspended ? "suspended" : "running";
  currentTime = 10;
  destination = { is: "speakers" };
  oscillators: Osc[] = [];
  gains: { gain: { value: number }; connect: ReturnType<typeof vi.fn> }[] = [];
  resumed = 0;
  constructor() {
    FakeAudio.all.push(this);
  }
  resume() {
    this.resumed++;
    return FakeAudio.resumeFails ? Promise.reject(new Error("no")) : Promise.resolve();
  }
  createOscillator(): Osc {
    if (FakeAudio.oscillatorFails) throw new Error("no oscillator");
    const o: Osc = { type: "", frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
    this.oscillators.push(o);
    return o;
  }
  createGain() {
    const g = { gain: { value: 0 }, connect: vi.fn() };
    this.gains.push(g);
    return g;
  }
}

class FakeNote {
  static made: { title: string; options: NotificationOptions }[] = [];
  static permission: string = "granted";
  static asked = 0;
  static askFails = false;
  static constructFails = false;
  constructor(title: string, options: NotificationOptions) {
    if (FakeNote.constructFails) throw new Error("no popups");
    FakeNote.made.push({ title, options });
  }
  static requestPermission() {
    FakeNote.asked++;
    return FakeNote.askFails ? Promise.reject(new Error("no")) : Promise.resolve("granted");
  }
}

const event = (level: AlertEvent["level"]): AlertEvent => ({ level, key: "ready:x", title: "CE setup ready: Trend Pullback", text: "setup x: look now" });
/** A fresh copy of the module: the sound device is made on first use and kept, so each test starts without one. */
const load = async () => {
  vi.resetModules();
  return import("./alertEffects");
};

beforeEach(() => {
  FakeAudio.all = [];
  FakeAudio.suspended = FakeAudio.resumeFails = FakeAudio.oscillatorFails = false;
  FakeNote.made = [];
  FakeNote.permission = "granted";
  FakeNote.asked = 0;
  FakeNote.askFails = FakeNote.constructFails = false;
  vi.stubGlobal("AudioContext", FakeAudio);
  vi.stubGlobal("Notification", Object.assign(FakeNote, { permission: "granted" }));
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the sound", () => {
  it("is the tones of the kind, each 0.15 s long, a sine at a low volume, started at its own moment", async () => {
    const { beep } = await load();
    beep("act");
    const a = FakeAudio.all[0]!;
    expect(a.oscillators.map((o) => [o.type, o.frequency.value])).toEqual([["sine", 880], ["sine", 1175], ["sine", 880], ["sine", 1175]]);
    expect(a.oscillators.map((o) => o.start.mock.calls[0]?.[0])).toEqual([10, 10.2, 10.4, 10.6]);
    expect(a.oscillators.map((o) => o.stop.mock.calls[0]?.[0])).toEqual([10.15, 10.35, 10.55, 10.75]);
    expect(a.gains.map((g) => g.gain.value)).toEqual([0.2, 0.2, 0.2, 0.2]);
    expect(a.oscillators.every((o) => o.connect.mock.calls.length === 1)).toBe(true);
    expect(a.gains.every((g) => g.connect.mock.calls[0]?.[0] === a.destination)).toBe(true);
  });
  it("warn is two tones and info is one", async () => {
    const { beep } = await load();
    beep("warn");
    beep("info");
    expect(FakeAudio.all[0]!.oscillators.map((o) => o.frequency.value)).toEqual([520, 390, 660]);
  });
  it("uses one sound device for the life of the page", async () => {
    const { beep, unlockSound } = await load();
    beep("info");
    beep("info");
    unlockSound();
    expect(FakeAudio.all).toHaveLength(1);
  });
  it("a click wakes a device the browser held back, and a device that cannot be woken is not an error", async () => {
    FakeAudio.suspended = true;
    const { unlockSound } = await load();
    unlockSound();
    expect(FakeAudio.all[0]!.resumed).toBe(1);
    FakeAudio.resumeFails = true;
    expect(() => unlockSound()).not.toThrow();
    await Promise.resolve(); // (the failed wake-up is swallowed: a rejection nobody handles would fail this test)
  });
  it("a running device is not woken again", async () => {
    const { unlockSound } = await load();
    unlockSound();
    unlockSound();
    expect(FakeAudio.all[0]!.resumed).toBe(0);
  });
  it("falls back to the older name of the device", async () => {
    vi.stubGlobal("AudioContext", undefined);
    vi.stubGlobal("webkitAudioContext", FakeAudio);
    (window as unknown as { webkitAudioContext: unknown }).webkitAudioContext = FakeAudio;
    const { beep } = await load();
    beep("info");
    expect(FakeAudio.all).toHaveLength(1);
    delete (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext;
  });
  it("with no sound device there is no sound and no error", async () => {
    vi.stubGlobal("AudioContext", undefined);
    const { beep, unlockSound } = await load();
    expect(unlockSound()).toBeNull();
    expect(() => beep("act")).not.toThrow();
  });
  it("a device that cannot be made, or cannot play, is not an error", async () => {
    vi.stubGlobal("AudioContext", class { constructor() { throw new Error("blocked"); } });
    const first = await load();
    expect(first.unlockSound()).toBeNull();
    expect(() => first.beep("act")).not.toThrow();
    vi.stubGlobal("AudioContext", FakeAudio);
    FakeAudio.oscillatorFails = true;
    const second = await load();
    expect(() => second.beep("act")).not.toThrow();
  });
});

describe("the popup", () => {
  it("carries the title, the text and a tag, and an urgent one stays until it is dismissed", async () => {
    const { popup } = await load();
    popup(event("act"));
    expect(FakeNote.made).toEqual([{ title: "CE setup ready: Trend Pullback", options: { body: "setup x: look now", tag: "ready:x", requireInteraction: true } }]);
  });
  it("a warning does not stay on the screen", async () => {
    const { popup } = await load();
    popup(event("warn"));
    expect(FakeNote.made[0]?.options.requireInteraction).toBe(false);
  });
  it("is shown only when the browser has allowed it", async () => {
    const { popup } = await load();
    for (const permission of ["default", "denied"]) {
      FakeNote.permission = permission;
      popup(event("act"));
    }
    expect(FakeNote.made).toEqual([]);
  });
  it("with no popups in the browser, or ones that fail, nothing happens", async () => {
    const { popup } = await load();
    FakeNote.constructFails = true;
    expect(() => popup(event("act"))).not.toThrow();
    vi.stubGlobal("Notification", undefined);
    expect(() => popup(event("act"))).not.toThrow();
  });
});

describe("asking for permission", () => {
  it("is asked while the reader has not decided, and not again once they have", async () => {
    const { askPopupPermission } = await load();
    FakeNote.permission = "default";
    askPopupPermission();
    expect(FakeNote.asked).toBe(1);
    for (const permission of ["granted", "denied"]) {
      FakeNote.permission = permission;
      askPopupPermission();
    }
    expect(FakeNote.asked).toBe(1);
  });
  it("a refused or failing request is not an error, and neither is a browser with no popups", async () => {
    const { askPopupPermission } = await load();
    FakeNote.permission = "default";
    FakeNote.askFails = true;
    expect(() => askPopupPermission()).not.toThrow();
    await Promise.resolve();
    vi.stubGlobal("Notification", undefined);
    expect(() => askPopupPermission()).not.toThrow();
  });
});

describe("the remembered mode", () => {
  it("is saved under the name the current dashboard uses and read back", async () => {
    const { readMode, saveMode } = await load();
    expect(readMode()).toBe("sound"); // nothing saved: the default
    saveMode("off");
    expect(localStorage.getItem(MODE_KEY)).toBe("off");
    expect(readMode()).toBe("off");
    saveMode("sound + popup");
    expect(readMode()).toBe("sound + popup");
  });
  it("a value that is not a mode is ignored", async () => {
    const { readMode } = await load();
    localStorage.setItem(MODE_KEY, "loud");
    expect(readMode()).toBe("sound");
  });
  it("with no storage (a private window) the default stands and saving is not an error", async () => {
    const { readMode, saveMode } = await load();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("no storage");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("no storage");
    });
    expect(readMode()).toBe("sound");
    expect(() => saveMode("off")).not.toThrow();
  });
});
