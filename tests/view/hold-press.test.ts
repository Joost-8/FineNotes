import { describe, expect, it } from "vitest";
import { HOLD_SLOP, HoldPress } from "../../src/view/hold-press";

describe("HoldPress", () => {
  it("a finger held still is a hold, and the lift's click is the hold's once", () => {
    const press = new HoldPress();
    expect(press.down(1, "touch", 100, 100, "A")).toBe(true);
    press.move(1, 104, 103);
    expect(press.fire(1000)).toBe("A");
    expect(press.justHeld(1100)).toBe(true);
    expect(press.takeClick(1200)).toBe(true);
    expect(press.justHeld(1300)).toBe(false);
    expect(press.takeClick(1300)).toBe(false);
  });

  it("the Pencil holds too; a mouse never does", () => {
    const press = new HoldPress();
    expect(press.down(1, "pen", 0, 0, "A")).toBe(true);
    expect(press.down(2, "mouse", 0, 0, "B")).toBe(false);
    expect(press.fire(10)).toBeNull();
  });

  it("moving past the slop, or lifting, is no hold", () => {
    const press = new HoldPress();
    press.down(1, "touch", 0, 0, "A");
    press.move(1, HOLD_SLOP + 1, 0);
    expect(press.fire(10)).toBeNull();
    press.down(1, "touch", 0, 0, "A");
    press.end();
    expect(press.fire(10)).toBeNull();
  });

  it("another finger's move does not cancel the press", () => {
    const press = new HoldPress();
    press.down(1, "touch", 0, 0, "A");
    press.move(2, 50, 50);
    expect(press.fire(10)).toBe("A");
  });

  it("a tap long after a hold is a tap", () => {
    const press = new HoldPress();
    press.down(1, "touch", 0, 0, "A");
    press.fire(0);
    expect(press.takeClick(5000)).toBe(false);
    expect(new HoldPress().takeClick(0)).toBe(false);
  });
});
