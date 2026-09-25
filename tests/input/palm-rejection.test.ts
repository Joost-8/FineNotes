import { describe, expect, it } from "vitest";
import { roleOf } from "../../src/input/palm-rejection";

describe("roleOf", () => {
  it("lets everything that is not a finger draw, stroke open or not", () => {
    for (const type of ["pen", "mouse", "", "stylus"]) {
      expect(roleOf(type, false)).toBe("draw");
      expect(roleOf(type, true)).toBe("draw");
    }
  });

  it("takes a finger for a gesture between strokes", () => {
    expect(roleOf("touch", false)).toBe("finger");
  });

  it("takes a finger that lands during a stroke for the writing hand's palm", () => {
    expect(roleOf("touch", true)).toBe("ignore");
  });
});
