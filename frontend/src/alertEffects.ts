import { DEFAULT_MODE, MODE_KEY, TONES, parseMode, type AlertEvent, type AlertMode, type Level } from "./alertEvents";

// What the browser is asked to do for an alert: a sound, a popup, and a remembered choice. All three may be missing (no sound device, popups blocked or unsupported, a private window with no storage):
// every one of them is tried, and a failure is silent, because the log and the one alert line still say it.

let audio: AudioContext | null = null;

type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext };

/** The sound device, made on first use. A browser lets a page play a sound only after the reader has clicked on it, so the first click calls this (a suspended device is resumed). */
export function unlockSound(): AudioContext | null {
  try {
    const AC = window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
    if (!AC) return null;
    audio ??= new AC();
    if (audio.state === "suspended") {
      const resumed: Promise<void> | undefined = audio.resume();
      if (resumed && typeof resumed.catch === "function") resumed.catch(() => undefined);
    }
    return audio;
  } catch {
    return null;
  }
}

/** One sound: the tones of that kind, each for 0.15 s, at a low volume. */
export function beep(kind: Level): void {
  const A = unlockSound();
  if (!A) return;
  try {
    for (const [hz, at] of TONES[kind]) {
      const o = A.createOscillator();
      const g = A.createGain();
      o.type = "sine";
      o.frequency.value = hz;
      g.gain.value = 0.2;
      o.connect(g);
      g.connect(A.destination);
      o.start(A.currentTime + at);
      o.stop(A.currentTime + at + 0.15);
    }
  } catch {
    /* the log still shows it */
  }
}

/** A popup, when the browser has been allowed to show them. An urgent one stays on the screen until it is dismissed. */
export function popup(c: AlertEvent): void {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification(c.title, { body: c.text, tag: c.key, requireInteraction: c.level === "act" });
  } catch {
    /* the log still shows it */
  }
}

/** Asked when popups are chosen, and only while the reader has not decided yet. */
export function askPopupPermission(): void {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      const asked: Promise<unknown> | undefined = Notification.requestPermission();
      if (asked && typeof asked.catch === "function") asked.catch(() => undefined);
    }
  } catch {
    /* no popups then */
  }
}

/** The mode the reader chose last time (the current dashboard keeps it under the same name, so the choice carries from one to the other). Anything else, or no storage: the default. */
export function readMode(): AlertMode {
  try {
    return parseMode(localStorage.getItem(MODE_KEY));
  } catch {
    return DEFAULT_MODE;
  }
}

export function saveMode(m: AlertMode): void {
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {
    /* the choice lasts until the page is closed */
  }
}
