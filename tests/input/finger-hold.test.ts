import { describe, expect, it } from "vitest";
import {
  CANCEL_HOLD_FLOOR_MS,
  FINGER_HOLD_MS,
  FINGER_HOLD_SLOP_PX,
  FingerHold,
  PALM_CONTACT_PX,
  PEN_QUIET_MS,
} from "../../src/input/finger-hold";

/** A finger that landed at (100, 200) at t = 10 000 ms. */
function held(): FingerHold {
  const hold = new FingerHold();
  hold.begin(100, 200, 10_000);
  return hold;
}

const DUE = 10_000 + FINGER_HOLD_MS;

describe("FingerHold", () => {
  it("opens the menu for one finger held still, long after the pen", () => {
    const hold = held();
    expect(hold.active).toBe(true);
    expect(hold.origin).toEqual({ x: 100, y: 200 });
    expect(hold.verdict({ t: DUE, lastPenAt: null, touches: 1 })).toBeNull();
    expect(hold.verdict({ t: DUE, lastPenAt: DUE - PEN_QUIET_MS, touches: 1 })).toBeNull();
  });

  it("stops watching once the verdict is given", () => {
    const hold = held();
    hold.verdict({ t: DUE, lastPenAt: null, touches: 1 });
    expect(hold.active).toBe(false);
    expect(hold.origin).toBeNull();
  });

  it("keeps a finger that drifts within the slop, on screen", () => {
    const hold = held();
    expect(hold.move(100 + FINGER_HOLD_SLOP_PX, 200)).toBe(true);
    expect(hold.move(100 + 5, 200 + 6)).toBe(true);
    expect(hold.active).toBe(true);
  });

  it("lets go of a finger that moves past the slop: a pan", () => {
    const hold = held();
    expect(hold.move(100 + FINGER_HOLD_SLOP_PX + 0.5, 200)).toBe(false);
    expect(hold.active).toBe(false);
    // Coming back does not restart it.
    expect(hold.move(100, 200)).toBe(false);
  });

  it("refuses while a second finger is down: a pinch", () => {
    expect(held().verdict({ t: DUE, lastPenAt: null, touches: 2 })).toBe("fingers");
  });

  it("refuses the writing hand: the pen was busy just before, or hovers", () => {
    // The hand landed between two words; the pen lifted 200 ms before.
    expect(held().verdict({ t: DUE, lastPenAt: 10_000 - 200, touches: 1 })).toBe("pen");
    // A hovering Pencil while the finger held.
    expect(held().verdict({ t: DUE, lastPenAt: DUE - 16, touches: 1 })).toBe("pen");
    expect(held().verdict({ t: DUE, lastPenAt: DUE - PEN_QUIET_MS + 1, touches: 1 })).toBe("pen");
  });

  it("refuses a contact wider than a fingertip, where one is reported", () => {
    const palm = held();
    palm.noteContact(30, PALM_CONTACT_PX + 1);
    expect(palm.verdict({ t: DUE, lastPenAt: null, touches: 1 })).toBe("palm");

    const fingertip = held();
    fingertip.noteContact(PALM_CONTACT_PX, 40);
    fingertip.noteContact(1, 1);
    expect(fingertip.verdict({ t: DUE, lastPenAt: null, touches: 1 })).toBeNull();

    // No reading at all (NaN, 0) is no palm.
    const unknown = held();
    unknown.noteContact(Number.NaN, 0);
    expect(unknown.verdict({ t: DUE, lastPenAt: null, touches: 1 })).toBeNull();
  });

  it("forgets the last finger's contact when a new one lands", () => {
    const hold = held();
    hold.noteContact(200, 200);
    hold.begin(0, 0, 20_000);
    expect(hold.verdict({ t: 20_000 + FINGER_HOLD_MS, lastPenAt: null, touches: 1 })).toBeNull();
  });

  it("names the pinch before the pen and the pen before the palm", () => {
    const hold = held();
    hold.noteContact(500, 500);
    expect(hold.verdict({ t: DUE, lastPenAt: DUE, touches: 3 })).toBe("fingers");
    const again = held();
    again.noteContact(500, 500);
    expect(again.verdict({ t: DUE, lastPenAt: DUE, touches: 1 })).toBe("pen");
  });

  it("takes WebKit's cancel of a finger held still for the hold it interrupted", () => {
    const hold = held();
    expect(hold.cancelIsHold(10_000 + CANCEL_HOLD_FLOOR_MS)).toBe(true);
    expect(hold.cancelIsHold(10_000 + CANCEL_HOLD_FLOOR_MS - 1)).toBe(false);
  });

  it("takes no cancel for a hold once the finger has moved off, or was never watched", () => {
    const hold = held();
    hold.move(300, 300);
    expect(hold.cancelIsHold(DUE)).toBe(false);
    expect(new FingerHold().cancelIsHold(DUE)).toBe(false);
  });

  it("ends the watch on request", () => {
    const hold = held();
    hold.end();
    expect(hold.active).toBe(false);
    expect(hold.move(100, 200)).toBe(false);
  });
});
