// Formatting, as the current dashboard does it. Times are the exchange's: IST, whatever the PC's own zone. An unknown value is a dash, never "0", "NaN" or "undefined".

const IST = "Asia/Kolkata";
const finite = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

export const DASH = "–";

/** HH:MM:SS (or HH:MM) IST from epoch seconds. */
export function fmtT(s: number | null | undefined, seconds = true): string {
  if (!finite(s)) return DASH;
  return new Date(s * 1000).toLocaleTimeString("en-GB", { timeZone: IST, hour12: false, hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}) });
}

/** dd/mm/yyyy, HH:MM:SS IST from epoch seconds. */
export function fmtD(s: number | null | undefined): string {
  if (!finite(s)) return DASH;
  return new Date(s * 1000).toLocaleString("en-GB", { timeZone: IST, hour12: false });
}

/** 06 Nov, 10:55 IST from epoch seconds: a candle's day and minute. */
export function fmtDT(s: number | null | undefined): string {
  if (!finite(s)) return DASH;
  return new Date(s * 1000).toLocaleString("en-GB", { timeZone: IST, hour12: false, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export const n2 = (v: number | null | undefined): string => (finite(v) ? v.toFixed(2) : DASH);
export const n1 = (v: number | null | undefined): string => (finite(v) ? v.toFixed(1) : DASH);

/** An age in seconds as the page says it: `45 s` up to two minutes, then minutes. */
export function age(a: number | null | undefined): string {
  if (!finite(a)) return DASH;
  return a < 120 ? `${a.toFixed(0)} s` : `${(a / 60).toFixed(0)} min`;
}

/** `STATE_NAME` -> `STATE NAME` */
export const words = (s: string): string => String(s).replace(/_/g, " ");
