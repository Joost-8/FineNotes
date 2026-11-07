import { describe, expect, it } from "vitest";
import { NAME_FONT_FLOOR, fittedNameSize } from "../../src/view/card-name-fit";

describe("fittedNameSize", () => {
  it("leaves a name whose longest word fits", () => {
    expect(fittedNameSize(12.8, 80, 80)).toBe(12.8);
    expect(fittedNameSize(12.8, 80, 60)).toBe(12.8);
  });

  it("shrinks a name until its longest word fits the card", () => {
    // "kleurovergang": about 95 px at 12.8 px on an 80 px card.
    const size = fittedNameSize(12.8, 80, 95);
    expect(size).toBeLessThan(12.8);
    expect((95 * size) / 12.8).toBeLessThanOrEqual(80);
    // Not much smaller than it needs to be.
    expect((95 * size) / 12.8).toBeGreaterThan(78);
  });

  it("stops at the floor however long the word", () => {
    expect(fittedNameSize(12.8, 80, 400)).toBe(NAME_FONT_FLOOR);
    expect(fittedNameSize(12.8, 80, 400, 9)).toBe(9);
  });

  it("never grows a name, even when the floor is above its size", () => {
    expect(fittedNameSize(9, 80, 100)).toBe(9);
  });

  it("leaves a name it cannot measure", () => {
    expect(fittedNameSize(12.8, 0, 95)).toBe(12.8);
    expect(fittedNameSize(0, 80, 95)).toBe(0);
    expect(fittedNameSize(Number.NaN, 80, 95)).toBeNaN();
    expect(fittedNameSize(12.8, 80, Number.NaN)).toBe(12.8);
  });
});
