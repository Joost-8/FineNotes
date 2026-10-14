/** `src/input/pen-modifiers.ts` — what keys and stylus buttons make a press do (FineNotes#25). */

import { describe, expect, it } from "vitest";
import {
  BARREL_ACTIONS,
  type PressContext,
  type PressInput,
  ZOOM_DOUBLING_PX,
  barrelActionOf,
  dragZoom,
  pressOverride,
  stylusButtonDown,
} from "../../src/input/pen-modifiers";

function press(over: Partial<PressInput> = {}): PressInput {
  return {
    pointerType: "pen",
    button: 0,
    buttons: 1,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...over,
  };
}

const PC: PressContext = { mac: false, barrel: "erase", onPage: true };
const MAC: PressContext = { mac: true, barrel: "erase", onPage: true };

describe("pressOverride: keys", () => {
  it("leaves a plain press to the tool", () => {
    expect(pressOverride(press(), PC)).toBeNull();
    expect(pressOverride(press({ pointerType: "mouse" }), PC)).toBeNull();
  });

  it("erases with Shift, lassos with Ctrl, zooms with Alt", () => {
    expect(pressOverride(press({ shiftKey: true }), PC)).toBe("eraser");
    expect(pressOverride(press({ ctrlKey: true }), PC)).toBe("select");
    expect(pressOverride(press({ altKey: true }), PC)).toBe("zoom");
    expect(pressOverride(press({ pointerType: "mouse", shiftKey: true }), PC)).toBe("eraser");
  });

  it("lassos with Cmd on a Mac, where Ctrl-click is the right click", () => {
    expect(pressOverride(press({ metaKey: true }), MAC)).toBe("select");
    expect(pressOverride(press({ ctrlKey: true }), MAC)).toBeNull();
    expect(pressOverride(press({ metaKey: true }), PC)).toBeNull();
  });

  it("means one thing for a chord: Alt, then Cmd/Ctrl, then Shift", () => {
    expect(pressOverride(press({ altKey: true, ctrlKey: true, shiftKey: true }), PC)).toBe("zoom");
    expect(pressOverride(press({ ctrlKey: true, shiftKey: true }), PC)).toBe("select");
  });

  it("never overrides a finger", () => {
    expect(pressOverride(press({ pointerType: "touch", shiftKey: true }), PC)).toBeNull();
    expect(pressOverride(press({ pointerType: "touch" }), { ...PC, onPage: false })).toBeNull();
  });
});

describe("pressOverride: beside the pages", () => {
  it("moves the page with a pen or mouse pressed in the margin or gutter", () => {
    const margin = { ...PC, onPage: false };
    expect(pressOverride(press(), margin)).toBe("pan");
    expect(pressOverride(press({ pointerType: "mouse" }), margin)).toBe("pan");
  });

  it("lets a held key win there too", () => {
    expect(pressOverride(press({ altKey: true }), { ...PC, onPage: false })).toBe("zoom");
  });
});

describe("pressOverride: stylus buttons", () => {
  it("erases with the eraser end, by its button bit or its button number", () => {
    expect(pressOverride(press({ buttons: 32 }), PC)).toBe("eraser");
    expect(pressOverride(press({ buttons: 33 }), { ...PC, barrel: "pan" })).toBe("eraser");
    expect(pressOverride(press({ button: 5, buttons: 0 }), PC)).toBe("eraser");
  });

  it("does what the barrel is set to, over any key", () => {
    const barrel = press({ buttons: 3, altKey: true });
    expect(pressOverride(barrel, { ...PC, barrel: "erase" })).toBe("eraser");
    expect(pressOverride(barrel, { ...PC, barrel: "lasso" })).toBe("select");
    expect(pressOverride(barrel, { ...PC, barrel: "pan" })).toBe("pan");
    expect(pressOverride(press({ button: 2, buttons: 2 }), PC)).toBe("eraser");
  });

  it("writes on with a barrel set to nothing, and ignores the button pressed while hovering", () => {
    const none = { ...PC, barrel: "none" as const };
    expect(pressOverride(press({ buttons: 3 }), none)).toBeNull();
    expect(pressOverride(press({ button: 2, buttons: 2 }), none)).toBe("ignore");
  });

  it("reads no barrel on a mouse: its right button is the page's menu", () => {
    expect(pressOverride(press({ pointerType: "mouse", buttons: 2 }), PC)).toBeNull();
    expect(stylusButtonDown(press({ pointerType: "mouse", buttons: 2 }))).toBe(false);
  });

  it("knows when a stylus button is down, to keep its right-click menu away", () => {
    expect(stylusButtonDown(press({ buttons: 3 }))).toBe(true);
    expect(stylusButtonDown(press({ buttons: 32 }))).toBe(true);
    expect(stylusButtonDown(press())).toBe(false);
  });
});

describe("barrelActionOf", () => {
  it("reads a stored setting, erase when it is not one", () => {
    for (const action of BARREL_ACTIONS) expect(barrelActionOf(action)).toBe(action);
    expect(barrelActionOf("zoom")).toBe("erase");
    expect(barrelActionOf(undefined)).toBe("erase");
  });
});

describe("dragZoom", () => {
  it("doubles the zoom for every 150 px drawn up, and halves it for 150 px down", () => {
    expect(dragZoom(1, -ZOOM_DOUBLING_PX, 0.5, 8)).toBeCloseTo(2);
    expect(dragZoom(2, ZOOM_DOUBLING_PX, 0.5, 8)).toBeCloseTo(1);
    expect(dragZoom(1.5, 0, 0.5, 8)).toBe(1.5);
  });

  it("is continuous in between", () => {
    const a = dragZoom(1, -10, 0.5, 8);
    const b = dragZoom(1, -11, 0.5, 8);
    expect(b).toBeGreaterThan(a);
    expect(b - a).toBeLessThan(0.01);
  });

  it("stays within the zoom limits", () => {
    expect(dragZoom(1, -10_000, 0.5, 8)).toBe(8);
    expect(dragZoom(1, 10_000, 0.5, 8)).toBe(0.5);
    expect(dragZoom(1, Number.NaN, 0.5, 8)).toBe(1);
  });
});
