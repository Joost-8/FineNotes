import { describe, expect, it } from "vitest";
import {
  PALM_CONTACT_PX,
  PALM_UNDO_MS,
  PALM_UNDO_PX,
  PEN_GRACE_MS,
  type PointerContext,
  classify,
  roleOf,
  undoesPalm,
} from "../../src/input/palm-rejection";

/** A touch with no stroke open, the pen long gone, and no contact size. */
const idle: PointerContext = { strokeOpen: false, sincePen: Infinity, contact: 0 };

describe("roleOf", () => {
  it("lets everything that is not a finger draw, whatever else is going on", () => {
    for (const type of ["pen", "mouse", "", "stylus"]) {
      expect(roleOf(type, idle)).toBe("draw");
      expect(roleOf(type, { strokeOpen: true, sincePen: 0, contact: 500 })).toBe("draw");
    }
  });

  it("takes a finger for a gesture between strokes", () => {
    expect(roleOf("touch", idle)).toBe("finger");
  });

  it("takes a finger that lands during a stroke for the writing hand's palm", () => {
    expect(classify("touch", { ...idle, strokeOpen: true })).toEqual({
      role: "ignore",
      reason: "stroke",
    });
  });

  it("takes a touch just after the pen for the palm, and a later one for a finger (2026-09-30)", () => {
    expect(classify("touch", { ...idle, sincePen: 0 })).toEqual({ role: "ignore", reason: "pen" });
    expect(roleOf("touch", { ...idle, sincePen: PEN_GRACE_MS - 1 })).toBe("ignore");
    expect(roleOf("touch", { ...idle, sincePen: PEN_GRACE_MS })).toBe("finger");
    // Timestamps from another clock (negative) prove nothing.
    expect(roleOf("touch", { ...idle, sincePen: -5 })).toBe("finger");
  });

  it("takes a touch wider than a fingertip for the palm, where contact is reported", () => {
    expect(classify("touch", { ...idle, contact: PALM_CONTACT_PX + 1 })).toEqual({
      role: "ignore",
      reason: "contact",
    });
    expect(roleOf("touch", { ...idle, contact: PALM_CONTACT_PX })).toBe("finger");
    // WebKit reports 1 x 1 where it does not measure.
    expect(roleOf("touch", { ...idle, contact: 1 })).toBe("finger");
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
