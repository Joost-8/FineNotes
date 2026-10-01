import { describe, expect, it } from "vitest";
import { REJOIN_MS, REJOIN_PX, rejoinsStroke } from "../../src/input/pen-rejoin";

describe("rejoinsStroke", () => {
  it("carries on the pieces of Joost's flickering '2' (2026-10-01)", () => {
    // Pen-downs 4-30 ms apart, 0.4-2.5 page px from the last piece's end.
    for (const [ms, d] of [
      [4, 0.9],
      [15, 0.4],
      [28, 2.1],
      [32, 1.7],
    ]) {
      expect(rejoinsStroke(ms, d, REJOIN_PX)).toBe(true);
    }
  });

  it("starts a new stroke when the pen was lifted for longer", () => {
    expect(rejoinsStroke(REJOIN_MS, 0, REJOIN_PX)).toBe(true);
    expect(rejoinsStroke(REJOIN_MS + 1, 0, REJOIN_PX)).toBe(false);
    // An i's dot, a full stop: lifted and set down again, however close.
    expect(rejoinsStroke(150, 3, REJOIN_PX)).toBe(false);
  });

  it("starts a new stroke where the pen lands away from the lift", () => {
    expect(rejoinsStroke(10, REJOIN_PX, REJOIN_PX)).toBe(true);
    expect(rejoinsStroke(10, REJOIN_PX + 0.1, REJOIN_PX)).toBe(false);
  });

  it("measures the distance in the caller's units", () => {
    // At 4x zoom 16 screen px are 4 page px.
    expect(rejoinsStroke(10, 3, REJOIN_PX / 4)).toBe(true);
    expect(rejoinsStroke(10, 6, REJOIN_PX / 4)).toBe(false);
  });

  it("never rejoins on a clock that ran backwards or a reading that is not a number", () => {
    expect(rejoinsStroke(-1, 0, REJOIN_PX)).toBe(false);
    expect(rejoinsStroke(Number.NaN, 0, REJOIN_PX)).toBe(false);
    expect(rejoinsStroke(10, Number.NaN, REJOIN_PX)).toBe(false);
  });
});
