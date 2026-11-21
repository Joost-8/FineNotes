import { describe, expect, it } from "vitest";
import {
  LOST_LIFT_MS,
  MAX_SAVE_HOLD_MS,
  QUIET_MS,
  SAVE_QUIET_MS,
  WriteHold,
} from "../../src/view/write-hold";

describe("WriteHold", () => {
  it("is quiet before the pen ever comes down", () => {
    const hold = new WriteHold();
    expect(hold.writing(0)).toBe(false);
    expect(hold.quietIn(0)).toBe(0);
    expect(hold.saveQuietIn(0)).toBe(0);
    expect(hold.holdSave(0)).toBe(false);
    expect(hold.savePending).toBe(false);
  });

  it("puts a save off while the pen is down and until it has rested", () => {
    const hold = new WriteHold();
    hold.penDown(0);
    expect(hold.writing(10)).toBe(true);
    expect(hold.holdSave(10)).toBe(true);
    expect(hold.savePending).toBe(true);
    hold.penUp(100);
    expect(hold.saveQuietIn(100)).toBe(SAVE_QUIET_MS);
    expect(hold.holdSave(100 + SAVE_QUIET_MS - 1)).toBe(true);
    expect(hold.saveQuietIn(100 + SAVE_QUIET_MS)).toBe(0);
    expect(hold.holdSave(100 + SAVE_QUIET_MS)).toBe(false);
    expect(hold.savePending).toBe(false);
  });

  it("lets PDF pages render after a short pause, while the save waits longer (#274)", () => {
    expect(SAVE_QUIET_MS).toBeGreaterThan(QUIET_MS);
    const hold = new WriteHold();
    hold.penDown(0);
    hold.holdSave(0);
    hold.penUp(100);
    expect(hold.quietIn(100)).toBe(QUIET_MS);
    expect(hold.writing(100 + QUIET_MS)).toBe(false);
    expect(hold.quietIn(100 + QUIET_MS)).toBe(0);
    expect(hold.holdSave(100 + QUIET_MS)).toBe(true);
    expect(hold.saveQuietIn(100 + QUIET_MS)).toBe(SAVE_QUIET_MS - QUIET_MS);
  });

  it("never saves with the pen down", () => {
    const hold = new WriteHold();
    hold.penDown(0);
    expect(hold.holdSave(0)).toBe(true);
    expect(hold.holdSave(LOST_LIFT_MS - 1)).toBe(true);
    expect(hold.overdue(LOST_LIFT_MS - 1)).toBe(false);
    expect(hold.quietIn(1000)).toBe(LOST_LIFT_MS - 1000);
    expect(hold.saveQuietIn(1000)).toBe(LOST_LIFT_MS - 1000);
  });

  it("takes a pen down for too long for a lift that never arrived", () => {
    const hold = new WriteHold();
    hold.penDown(0);
    hold.holdSave(0);
    expect(hold.writing(LOST_LIFT_MS)).toBe(false);
    expect(hold.quietIn(LOST_LIFT_MS)).toBe(0);
    expect(hold.saveQuietIn(LOST_LIFT_MS)).toBe(0);
    expect(hold.holdSave(LOST_LIFT_MS)).toBe(false);
  });

  it("makes an overdue save at the next lift, between strokes", () => {
    const hold = new WriteHold();
    let t = 0;
    hold.penDown(t);
    hold.holdSave(t);
    // Writing without a rest: a stroke every 2 s, never up for SAVE_QUIET_MS.
    while (t + 2000 < MAX_SAVE_HOLD_MS) {
      hold.penUp(t + 1000);
      expect(hold.overdue(t + 1000)).toBe(false);
      expect(hold.holdSave(t + 1000)).toBe(true);
      t += 2000;
      hold.penDown(t);
    }
    hold.penUp(MAX_SAVE_HOLD_MS + 50);
    expect(hold.overdue(MAX_SAVE_HOLD_MS + 50)).toBe(true);
    expect(hold.holdSave(MAX_SAVE_HOLD_MS + 50)).toBe(false);
    expect(hold.savePending).toBe(false);
  });

  it("forgets a waiting save once it is made", () => {
    const hold = new WriteHold();
    hold.penDown(0);
    hold.holdSave(0);
    hold.saved();
    expect(hold.savePending).toBe(false);
    expect(hold.overdue(MAX_SAVE_HOLD_MS * 2)).toBe(false);
  });
});
