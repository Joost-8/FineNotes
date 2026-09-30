import { describe, expect, it } from "vitest";
import { PALM_UNDO_MS, PALM_UNDO_PX, roleOf, undoesPalm } from "../../src/input/palm-rejection";

describe("roleOf", () => {
  it("lets everything that is not a finger draw, stroke open or not", () => {
    for (const type of ["pen", "mouse", "", "stylus"]) {
      expect(roleOf(type, false)).toBe("draw");
      expect(roleOf(type, true)).toBe("draw");
    }
  });

  it("takes a finger for a gesture between strokes, however soon after the pen", () => {
    expect(roleOf("touch", false)).toBe("finger");
  });

  it("takes a finger that lands during a stroke for the writing hand's palm", () => {
    expect(roleOf("touch", true)).toBe("ignore");
  });
});

describe("undoesPalm", () => {
  it("undoes a scroll the pen interrupts soon after it began, however far", () => {
    expect(undoesPalm(0, 0)).toBe(true);
    expect(undoesPalm(PALM_UNDO_MS, 5000)).toBe(true);
  });

  it("undoes a short scroll however long the palm rested", () => {
    expect(undoesPalm(60_000, PALM_UNDO_PX)).toBe(true);
  });

  it("keeps a long, far scroll: the finger was scrolling, and the pen came after", () => {
    expect(undoesPalm(PALM_UNDO_MS + 1, PALM_UNDO_PX + 1)).toBe(false);
  });
});
