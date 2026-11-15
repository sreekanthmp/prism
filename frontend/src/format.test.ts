import { describe, expect, it } from "vitest";
import { age, DASH, fmtD, fmtT, n1, n2, words } from "./format";

const T = 1793942706; // 06 Nov 2026 10:55:06 IST (05:25:06 UTC)

describe("formatting", () => {
  it("shows times in IST, whatever the PC's own zone", () => {
    expect(fmtT(T)).toBe("10:55:06");
    expect(fmtT(T, false)).toBe("10:55");
    expect(fmtD(T)).toBe("06/11/2026, 10:55:06");
    expect(fmtT(T - 5 * 3600 - 25 * 60 - 6)).toBe("05:30:00"); // midnight UTC is 05:30 IST
  });

  it("says a dash for what is unknown, never 0, NaN or undefined", () => {
    for (const bad of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(fmtT(bad)).toBe(DASH);
      expect(fmtD(bad)).toBe(DASH);
      expect(n2(bad)).toBe(DASH);
      expect(n1(bad)).toBe(DASH);
      expect(age(bad)).toBe(DASH);
    }
  });

  it("keeps a real zero", () => {
    expect(n2(0)).toBe("0.00");
    expect(n1(0)).toBe("0.0");
    expect(age(0)).toBe("0 s");
    expect(fmtT(0)).toBe("05:30:00");
  });

  it("rounds prices to two places and the one-place ones to one", () => {
    expect(n2(24287)).toBe("24287.00");
    expect(n2(24287.456)).toBe("24287.46");
    expect(n1(12.34)).toBe("12.3");
  });

  it("says an age in seconds up to two minutes and in minutes after", () => {
    expect(age(1)).toBe("1 s");
    expect(age(119.4)).toBe("119 s");
    expect(age(120)).toBe("2 min");
    expect(age(3600)).toBe("60 min");
  });

  it("turns state names into words", () => {
    expect(words("RECOVERING_GAPS")).toBe("RECOVERING GAPS");
    expect(words("auth_failed")).toBe("auth failed");
  });
});
