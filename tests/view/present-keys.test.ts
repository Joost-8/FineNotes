import { describe, expect, it } from "vitest";
import { isTap, presentCount, presentStep } from "../../src/view/present-keys";

const press = (key: string, mods: Partial<Record<string, boolean>> = {}) => ({
  key,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mods,
});

describe("Present mode keys", () => {
  it("turns on with what a clicker and a slide show send", () => {
    for (const key of ["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"]) {
      expect(presentStep(press(key)), key).toBe("next");
    }
  });

  it("turns back, and Shift+Space goes back", () => {
    for (const key of ["ArrowLeft", "ArrowUp", "PageUp", "Backspace"]) {
      expect(presentStep(press(key)), key).toBe("previous");
    }
    expect(presentStep(press(" ", { shiftKey: true }))).toBe("previous");
  });

  it("goes to the ends, and Escape leaves", () => {
    expect(presentStep(press("Home"))).toBe("first");
    expect(presentStep(press("End"))).toBe("last");
    expect(presentStep(press("Escape"))).toBe("leave");
  });

  it("leaves tool keys and shortcuts to the notebook", () => {
    expect(presentStep(press("p"))).toBeNull();
    expect(presentStep(press("e"))).toBeNull();
    expect(presentStep(press("ArrowRight", { ctrlKey: true }))).toBeNull();
    expect(presentStep(press("z", { metaKey: true }))).toBeNull();
    expect(presentStep(press("ArrowRight", { altKey: true }))).toBeNull();
  });

  it("counts pages from one, inside the notebook", () => {
    expect(presentCount(0, 12)).toBe("1 / 12");
    expect(presentCount(11, 12)).toBe("12 / 12");
    expect(presentCount(40, 12)).toBe("12 / 12");
    expect(presentCount(0, 0)).toBe("1 / 1");
  });

  it("shows the bar for a tap, not for pointing with the laser", () => {
    const down = { id: 1, x: 100, y: 100, t: 1000 };
    const up = (x: number, y: number, t: number, pointerId = 1) => ({
      pointerId,
      clientX: x,
      clientY: y,
      timeStamp: t,
    });
    expect(isTap(down, up(103, 101, 1120))).toBe(true);
    // A laser stroke moves, a held point lasts.
    expect(isTap(down, up(160, 100, 1150))).toBe(false);
    expect(isTap(down, up(100, 100, 1800))).toBe(false);
    // Another finger's lift is not this press.
    expect(isTap(down, up(100, 100, 1100, 2))).toBe(false);
  });
});
