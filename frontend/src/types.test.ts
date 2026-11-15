import { describe, expect, it } from "vitest";
import { isSnapshot } from "./types";
import { base } from "./test/helpers";

describe("what counts as a snapshot", () => {
  it("is the real one", () => expect(isSnapshot(base)).toBe(true));

  it("is not nothing, a string, a number or a list", () => {
    for (const x of [null, undefined, "snapshot", 42, true, [], [base]]) expect(isSnapshot(x)).toBe(false);
  });

  it("needs every one of the four things the page stands on", () => {
    for (const key of ["server_time", "connection", "health", "instruments"] as const) {
      const { [key]: _gone, ...rest } = base;
      expect(isSnapshot(rest), key).toBe(false);
    }
  });

  it("needs a real time: a number, and one that is not NaN or infinite", () => {
    for (const t of ["1793942706", null, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, {}]) expect(isSnapshot({ ...base, server_time: t }), String(t)).toBe(false);
    expect(isSnapshot({ ...base, server_time: 0 })).toBe(true);
  });

  it("needs connection and health to be objects, not lists, strings or nothing", () => {
    for (const key of ["connection", "health"] as const) for (const v of [[], "x", 1, null]) expect(isSnapshot({ ...base, [key]: v }), `${key} = ${JSON.stringify(v)}`).toBe(false);
  });

  it("needs the instruments to be a list", () => {
    for (const v of [{}, "x", null, 3]) expect(isSnapshot({ ...base, instruments: v })).toBe(false);
    expect(isSnapshot({ ...base, instruments: [] })).toBe(true);
  });
});
