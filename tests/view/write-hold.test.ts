import { describe, expect, it } from "vitest";
import { MAX_SAVE_HOLD_MS, QUIET_MS, WriteHold } from "../../src/view/write-hold";

describe("WriteHold", () => {
  it("is quiet before the pen ever comes down", () => {
    const hold = new WriteHold();
    expect(hold.writing(0)).toBe(false);
    expect(hold.quietIn(0)).toBe(0);
    expect(hold.holdSave(0)).toBe(false);
    expect(hold.savePending).toBe(false);
  });

  it("puts a save off while the pen is down and just after it lifts", () => {
    const hold = new WriteHold();
    hold.penDown(0);
    expect(hold.writing(10)).toBe(true);
    expect(hold.holdSave(10)).toBe(true);
    expect(hold.savePending).toBe(true);
    hold.penUp(100);
    expect(hold.quietIn(100)).toBe(QUIET_MS);
    expect(hold.holdSave(100 + QUIET_MS - 1)).toBe(true);
    expect(hold.quietIn(100 + QUIET_MS)).toBe(0);
    expect(hold.holdSave(100 + QUIET_MS)).toBe(false);
    expect(hold.savePending).toBe(false);
  });

  it("never saves with the pen down", () => {
    const hold = new WriteHold();
    hold.penDown(0);
    expect(hold.holdSave(0)).toBe(true);
    expect(hold.holdSave(MAX_SAVE_HOLD_MS - 1)).toBe(true);
    expect(hold.overdue(MAX_SAVE_HOLD_MS - 1)).toBe(false);
    expect(hold.quietIn(1000)).toBe(MAX_SAVE_HOLD_MS - 1000);
  });

  it("takes a pen down for too long for a lift that never arrived", () => {
    const hold = new WriteHold();
    hold.penDown(0);
    hold.holdSave(0);
    expect(hold.writing(MAX_SAVE_HOLD_MS)).toBe(false);
    expect(hold.quietIn(MAX_SAVE_HOLD_MS)).toBe(0);
    expect(hold.overdue(MAX_SAVE_HOLD_MS)).toBe(true);
    expect(hold.holdSave(MAX_SAVE_HOLD_MS)).toBe(false);
  });

  it("makes an overdue save at the next lift, between strokes", () => {
    const hold = new WriteHold();
    hold.penDown(0);
    hold.holdSave(0);
    hold.penUp(MAX_SAVE_HOLD_MS - 100);
    expect(hold.overdue(MAX_SAVE_HOLD_MS - 100)).toBe(false);
    hold.penDown(MAX_SAVE_HOLD_MS - 50);
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
