import { describe, expect, it } from "vitest";
import { cancelsStylusTouch, hasStylusTouch } from "../../src/input/stylus-touch";

const pencil = { touchType: "stylus" };
const finger = { touchType: "direct" };

describe("the Pencil's touch events", () => {
  it("finds the stylus among the changed touches", () => {
    expect(hasStylusTouch([pencil])).toBe(true);
    expect(hasStylusTouch([finger, pencil])).toBe(true);
    expect(hasStylusTouch([finger])).toBe(false);
    // A browser without touchType (Chromium, Android) reports no stylus.
    expect(hasStylusTouch([{}])).toBe(false);
    expect(hasStylusTouch([])).toBe(false);
  });

  it("cancels the stylus landing and moving, never its lift or a finger", () => {
    expect(cancelsStylusTouch("touchstart", [pencil])).toBe(true);
    expect(cancelsStylusTouch("touchmove", [pencil])).toBe(true);
    expect(cancelsStylusTouch("touchend", [pencil])).toBe(false);
    expect(cancelsStylusTouch("touchcancel", [pencil])).toBe(false);
    expect(cancelsStylusTouch("touchstart", [finger])).toBe(false);
    expect(cancelsStylusTouch("touchmove", [finger])).toBe(false);
  });
});
