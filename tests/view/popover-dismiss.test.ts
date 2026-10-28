/**
 * `src/view/popover-dismiss.ts`: the press that closes a tool bar popover
 * writes nothing on the page.
 */

import { describe, expect, it } from "vitest";
import { closingPressStops } from "../../src/view/popover-dismiss";

describe("the press that closes a popover", () => {
  it("stops there on the page when a pen or the mouse's main button would write", () => {
    expect(closingPressStops({ pointerType: "pen", button: 0 }, true)).toBe(true);
    // The side button pressed in the air: the click that closes the pen menu.
    expect(closingPressStops({ pointerType: "pen", button: 2 }, true)).toBe(true);
    expect(closingPressStops({ pointerType: "mouse", button: 0 }, true)).toBe(true);
  });

  it("goes on for a finger, the right mouse button, and anywhere but the page", () => {
    expect(closingPressStops({ pointerType: "touch", button: 0 }, true)).toBe(false);
    expect(closingPressStops({ pointerType: "mouse", button: 2 }, true)).toBe(false);
    expect(closingPressStops({ pointerType: "pen", button: 0 }, false)).toBe(false);
    expect(closingPressStops({ pointerType: "mouse", button: 0 }, false)).toBe(false);
  });
});
