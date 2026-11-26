import { describe, expect, it } from "vitest";
import { HOLD_CANCELLED_MS, HOLD_SLOP, HoldPress } from "../../src/view/hold-press";

describe("HoldPress", () => {
  it("a touch held still is a hold, and the long press's menu right after is the hold's", () => {
    const press = new HoldPress();
    press.down(1, 100, 100, "A", 0);
    press.move(1, 104, 103);
    expect(press.fire(350)).toBe("A");
    expect(press.justHeld(900)).toBe(true);
    expect(press.justHeld(1200)).toBe(false);
  });

  it("moving past the slop, lifting, or a second finger is no hold", () => {
    const press = new HoldPress();
    press.down(1, 0, 0, "A", 0);
    press.move(1, HOLD_SLOP + 1, 0);
    expect(press.fire(350)).toBeNull();
    press.down(1, 0, 0, "A", 0);
    press.end();
    expect(press.fire(350)).toBeNull();
  });

  it("another touch's move does not cancel the press", () => {
    const press = new HoldPress();
    press.down(1, 0, 0, "A", 0);
    press.move(2, 50, 50);
    expect(press.fire(350)).toBe("A");
  });

  it("a still touch the platform cancels is a hold once it has rested", () => {
    const press = new HoldPress();
    press.down(1, 0, 0, "A", 0);
    expect(press.cancelled(HOLD_CANCELLED_MS - 1)).toBeNull();
    press.down(1, 0, 0, "A", 0);
    expect(press.cancelled(HOLD_CANCELLED_MS)).toBe("A");
    expect(press.fire(400)).toBeNull();
  });

  it("no hold, no swallowed menu", () => {
    expect(new HoldPress().justHeld(0)).toBe(false);
  });
});
