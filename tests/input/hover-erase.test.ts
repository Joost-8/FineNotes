/**
 * `src/input/hover-erase.ts`: erase on hover (discussion #209). A pass opens
 * once the pen travels with the side button held in the air, goes on while
 * it is held, and ends when it is let go, the pen lands, or it comes back
 * elsewhere after a pause.
 */

import { describe, expect, it } from "vitest";
import {
  HOVER_ERASE_SLOP_PX,
  HOVER_GAP_MS,
  HOVER_JUMP_PX,
  HoverErase,
  PEN_LOG_LENGTH,
  PenLog,
} from "../../src/input/hover-erase";

function at(x: number, t: number, barrel = true, enabled = true) {
  return { x, y: 0, t, barrel, enabled };
}

describe("erase on hover", () => {
  it("does nothing without the button", () => {
    const h = new HoverErase();
    expect(h.step(at(0, 0, false))).toEqual({ kind: "idle" });
    expect(h.step(at(100, 10, false))).toEqual({ kind: "idle" });
    expect(h.open).toBe(false);
  });

  it("does nothing while the setting is off, the button held or not", () => {
    const h = new HoverErase();
    expect(h.step(at(0, 0, true, false))).toEqual({ kind: "idle" });
    expect(h.step(at(100, 10, true, false))).toEqual({ kind: "idle" });
  });

  it("waits for the pen to travel, so a click erases nothing", () => {
    const h = new HoverErase();
    expect(h.step(at(0, 0))).toEqual({ kind: "wait" });
    expect(h.step(at(HOVER_ERASE_SLOP_PX, 50))).toEqual({ kind: "wait" });
    expect(h.step(at(0, 100, false))).toEqual({ kind: "idle" });
    expect(h.open).toBe(false);
  });

  it("opens a pass from where the button was seen, and goes on", () => {
    const h = new HoverErase();
    h.step(at(5, 0));
    expect(h.step(at(5 + HOVER_ERASE_SLOP_PX + 1, 16))).toEqual({
      kind: "start",
      from: { x: 5, y: 0, t: 0 },
    });
    expect(h.open).toBe(true);
    expect(h.step(at(40, 32))).toEqual({ kind: "move" });
    expect(h.step(at(60, 48))).toEqual({ kind: "move" });
  });

  it("ends the pass where it last was when the button is let go", () => {
    const h = new HoverErase();
    h.step(at(0, 0));
    h.step(at(30, 16));
    h.step(at(50, 32));
    expect(h.step(at(52, 48, false))).toEqual({ kind: "end", at: { x: 50, y: 0, t: 32 } });
    expect(h.open).toBe(false);
    expect(h.step(at(60, 64, false))).toEqual({ kind: "idle" });
  });

  it("ends the pass when the setting goes off mid-pass", () => {
    const h = new HoverErase();
    h.step(at(0, 0));
    h.step(at(30, 16));
    expect(h.step(at(40, 32, true, false)).kind).toBe("end");
  });

  it("keeps a slow pass going when the pen pauses in place", () => {
    const h = new HoverErase();
    h.step(at(0, 0));
    h.step(at(30, 16));
    expect(h.step(at(35, 16 + HOVER_GAP_MS * 3)).kind).toBe("move");
  });

  it("starts afresh when the pen comes back elsewhere after a pause", () => {
    const h = new HoverErase();
    h.step(at(0, 0));
    h.step(at(30, 16));
    const back = 16 + HOVER_GAP_MS + 1;
    expect(h.step(at(30 + HOVER_JUMP_PX + 1, back))).toEqual({
      kind: "restart",
      at: { x: 30, y: 0, t: 16 },
    });
    expect(h.open).toBe(false);
    // The new pass counts its travel from where the pen came back.
    expect(h.step(at(30 + HOVER_JUMP_PX + 5, back + 16)).kind).toBe("wait");
    expect(h.step(at(30 + HOVER_JUMP_PX + 30, back + 32)).kind).toBe("start");
  });

  it("counts a button held still a long while from where it is now", () => {
    const h = new HoverErase();
    h.step(at(0, 0));
    expect(h.step(at(HOVER_ERASE_SLOP_PX + 5, HOVER_GAP_MS * 4 + 1)).kind).toBe("wait");
    expect(h.step(at(HOVER_ERASE_SLOP_PX + 10, HOVER_GAP_MS * 4 + 20)).kind).toBe("wait");
  });

  it("stops an open pass at its last point, and nothing when none is open", () => {
    const h = new HoverErase();
    expect(h.stop()).toBeNull();
    h.step(at(0, 0));
    expect(h.stop()).toBeNull();
    h.step(at(0, 0));
    h.step(at(30, 16));
    expect(h.stop()).toEqual({ x: 30, y: 0, t: 16 });
    expect(h.open).toBe(false);
    // The anchor went too: travel counts afresh.
    expect(h.step(at(31, 20)).kind).toBe("wait");
  });
});

describe("the pen log", () => {
  const ev = (buttons: number, t: number, pressure = 0, button = -1) => ({
    buttons,
    button,
    pressure,
    timeStamp: t,
  });

  it("keeps each event's buttons, pressure and time from the first", () => {
    const log = new PenLog();
    log.note("pointermove", ev(0, 1000));
    log.note("pointermove", ev(1, 1016), "wait");
    log.note("pointerdown", ev(1, 1100, 0.456, 0));
    log.note("pointerleave", ev(0, 1200, Number.NaN));
    expect(log.report()).toEqual([
      { e: "move", bs: 0, b: -1, p: 0, t: 0 },
      { e: "move", bs: 1, b: -1, p: 0, t: 16, h: "wait" },
      { e: "down", bs: 1, b: 0, p: 0.46, t: 100 },
      { e: "leave", bs: 0, b: -1, p: 0, t: 200 },
    ]);
  });

  it("folds a run of like hovering moves into one with a count", () => {
    const log = new PenLog();
    log.note("pointermove", ev(1, 0), "move");
    log.note("pointermove", ev(1, 10), "move");
    log.note("pointermove", ev(1, 20), "move");
    log.note("pointermove", ev(1, 30, 0.5), "move");
    log.note("pointermove", ev(0, 40), "end");
    const r = log.report();
    expect(r).toHaveLength(3);
    expect(r[0]).toMatchObject({ e: "move", n: 3 });
    expect(r[1]).toMatchObject({ p: 0.5 });
    expect(r[2]).toMatchObject({ h: "end" });
  });

  it("keeps only the latest entries", () => {
    const log = new PenLog();
    for (let i = 0; i < PEN_LOG_LENGTH + 5; i++) log.note("pointerdown", ev(i, i));
    const r = log.report();
    expect(r).toHaveLength(PEN_LOG_LENGTH);
    expect(r[0].bs).toBe(5);
  });
});
