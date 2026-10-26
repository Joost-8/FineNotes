/**
 * `src/input/stylus-click.ts`: a click of the pen's side button in the air,
 * heard through a press of its own, hovering moves or `contextmenu`, and
 * counted once.
 */

import { describe, expect, it } from "vitest";
import {
  CLICK_MAX_MS,
  CLICK_REPEAT_MS,
  CLICK_SLOP_PX,
  type PenReading,
  StylusClicks,
  isAirPress,
  stylusClickActionOf,
} from "../../src/input/stylus-click";

/** A pen at (x, 0), with these buttons down, at time t. */
function pen(buttons: number, t: number, x = 0, button = -1): PenReading {
  return { pointerType: "pen", button, buttons, clientX: x, clientY: 0, timeStamp: t };
}

const AIR = 2; // the barrel, not touching
const WRITING = 1;
const BOTH = 3;

describe("the setting", () => {
  it("is the pen menu unless it says nothing", () => {
    expect(stylusClickActionOf("none")).toBe("none");
    expect(stylusClickActionOf("pen-menu")).toBe("pen-menu");
    expect(stylusClickActionOf(undefined)).toBe("pen-menu");
    expect(stylusClickActionOf("erase")).toBe("pen-menu");
  });
});

describe("a press of the side button in the air", () => {
  it("is the barrel down on a pen not touching, by its bit or its button", () => {
    expect(isAirPress(pen(AIR, 0, 0, 2))).toBe(true);
    expect(isAirPress(pen(0, 0, 0, 2))).toBe(true);
    expect(isAirPress(pen(BOTH, 0, 0, 0))).toBe(false);
    expect(isAirPress(pen(WRITING, 0, 0, 0))).toBe(false);
    // The eraser end is no side button.
    expect(isAirPress(pen(32, 0, 0, 5))).toBe(false);
    expect(isAirPress(pen(AIR | 32, 0, 0, 2))).toBe(false);
    // A mouse's right button is the mouse's.
    expect(isAirPress({ ...pen(AIR, 0, 0, 2), pointerType: "mouse" })).toBe(false);
  });

  it("let go soon and near is a click", () => {
    const clicks = new StylusClicks();
    expect(clicks.down(pen(AIR, 100, 0, 2))).toBe(true);
    expect(clicks.held(pen(AIR, 150, 3))).toBe("wait");
    expect(clicks.heldUp(pen(0, 400, 4, 2))).toBe(true);
  });

  it("is a stroke once it touches down, or travels, held however long", () => {
    const clicks = new StylusClicks();
    clicks.down(pen(AIR, 0, 0, 2));
    expect(clicks.held(pen(BOTH, 5000))).toBe("stroke");
    expect(clicks.heldUp(pen(0, 5100))).toBe(false);

    clicks.down(pen(AIR, 6000, 0, 2));
    expect(clicks.held(pen(AIR, 6050, CLICK_SLOP_PX + 1))).toBe("stroke");
  });

  it("is no click held too long, or let go too far off", () => {
    const clicks = new StylusClicks();
    clicks.down(pen(AIR, 0, 0, 2));
    expect(clicks.heldUp(pen(0, CLICK_MAX_MS + 1))).toBe(false);
    clicks.down(pen(AIR, 10_000, 0, 2));
    expect(clicks.heldUp(pen(0, 10_100, CLICK_SLOP_PX + 1))).toBe(false);
  });

  it("let go with a move rather than a pointerup is a click too, or over", () => {
    const clicks = new StylusClicks();
    clicks.down(pen(AIR, 0, 0, 2));
    expect(clicks.held(pen(0, 200))).toBe("click");
    clicks.down(pen(AIR, 5000, 0, 2));
    expect(clicks.held(pen(0, 5000 + CLICK_MAX_MS + 1))).toBe("over");
  });

  it("is not watched for once another press comes", () => {
    const clicks = new StylusClicks();
    clicks.down(pen(AIR, 0, 0, 2));
    expect(clicks.down(pen(BOTH, 10, 0, 0))).toBe(false);
    expect(clicks.heldUp(pen(0, 20))).toBe(false);
  });
});

describe("hovering moves", () => {
  it("the bit coming and going in the air is a click", () => {
    const clicks = new StylusClicks();
    expect(clicks.hover(pen(0, 0))).toBe(false);
    expect(clicks.hover(pen(AIR, 10))).toBe(false);
    expect(clicks.hover(pen(AIR, 60, 4))).toBe(false);
    expect(clicks.hover(pen(0, 200, 5))).toBe(true);
    expect(clicks.hover(pen(0, 220, 5))).toBe(false);
  });

  it("not when the pen touched down, travelled, or the press was a pointer's own", () => {
    const clicks = new StylusClicks();
    clicks.hover(pen(AIR, 0));
    clicks.hover(pen(BOTH, 50));
    expect(clicks.hover(pen(0, 100))).toBe(false);

    clicks.hover(pen(AIR, 1000));
    clicks.hover(pen(AIR, 1050, CLICK_SLOP_PX + 1));
    expect(clicks.hover(pen(0, 1100, CLICK_SLOP_PX + 1))).toBe(false);

    // A press this page never heard of (a popover took its pointerdown): its
    // moves have the bit, its pointerup ends the watch, and the moves after
    // it are no click.
    clicks.hover(pen(AIR, 2000));
    clicks.lifted();
    expect(clicks.hover(pen(0, 2100))).toBe(false);
  });
});

describe("contextmenu from the pen", () => {
  it("is a click when the pointer events saw no button", () => {
    const clicks = new StylusClicks();
    expect(clicks.menu(100)).toBe(true);
    // A second one at once is the same click.
    expect(clicks.menu(100 + CLICK_REPEAT_MS - 1)).toBe(false);
    expect(clicks.menu(100 + CLICK_REPEAT_MS + 1)).toBe(true);
  });

  it("is none while a press is watched, and none just after the press made the click", () => {
    const clicks = new StylusClicks();
    clicks.down(pen(AIR, 0, 0, 2));
    expect(clicks.menu(50)).toBe(false);
    expect(clicks.heldUp(pen(0, 100))).toBe(true);
    expect(clicks.menu(120)).toBe(false);
    expect(clicks.menu(100 + CLICK_MAX_MS + 1)).toBe(true);
  });

  it("keeps the press from making a second click right after it", () => {
    const clicks = new StylusClicks();
    expect(clicks.menu(0)).toBe(true);
    clicks.down(pen(AIR, 10, 0, 2));
    expect(clicks.heldUp(pen(0, 400))).toBe(false);
  });
});

describe("one report's clicks", () => {
  it("count each click, once a bounce's time has passed", () => {
    const clicks = new StylusClicks();
    clicks.down(pen(AIR, 0, 0, 2));
    expect(clicks.heldUp(pen(0, 50))).toBe(true);
    clicks.down(pen(AIR, 60, 0, 2));
    expect(clicks.heldUp(pen(0, 100))).toBe(false);
    clicks.down(pen(AIR, 600, 0, 2));
    expect(clicks.heldUp(pen(0, 700))).toBe(true);
  });

  it("forget a press under way on reset", () => {
    const clicks = new StylusClicks();
    clicks.down(pen(AIR, 0, 0, 2));
    clicks.reset();
    expect(clicks.heldUp(pen(0, 50))).toBe(false);
    expect(clicks.held(pen(AIR, 60))).toBe("over");
  });
});
