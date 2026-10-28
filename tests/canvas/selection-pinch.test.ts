/**
 * `src/canvas/selection-pinch.ts` — two fingers scale, turn and carry a lasso
 * selection, previewed as one motion and committed as one undo step.
 */

import { describe, expect, it } from "vitest";
import {
  PINCH_SCALE_SLOP,
  type PinchMotion,
  type SelectionPinch,
  clampPinch,
  isStill,
  pinchCommand,
  pinchFrame,
  pinchMotion,
  pinchOnSelection,
  pinchPoint,
  startPinch,
  stepPinch,
} from "../../src/canvas/selection-pinch";
import {
  type InkDocument,
  type Stroke,
  type TextBoxElement,
  blankPage,
  emptyDocument,
} from "../../src/model/document";
import type { Pt } from "../../src/canvas/lasso";

const SLOP = 8;
const deg = (d: number): number => (d * Math.PI) / 180;

/** The pinch two fingers make from (a0, b0) to (a1, b1), as `FingerGesture` reports it. */
function fingers(a0: Pt, b0: Pt, a1: Pt, b1: Pt, base?: Pt): SelectionPinch {
  const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const spread = (a: Pt, b: Pt): number => Math.hypot(b.x - a.x, b.y - a.y);
  const heading = (a: Pt, b: Pt): number => Math.atan2(b.y - a.y, b.x - a.x);
  return stepPinch(
    startPinch(mid(a0, b0), base),
    {
      scaleFactor: spread(a1, b1) / spread(a0, b0),
      rotation: heading(a1, b1) - heading(a0, b0),
      centre: mid(a1, b1),
    },
    SLOP,
  );
}

function expectPoint(actual: Pt, expected: Pt): void {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
}

describe("a pinch of a selection", () => {
  it("keeps what lay under each finger under it: scale, turn and move at once", () => {
    // Fingers 100 px apart turn 30° and spread to 150 px, and the pair moves.
    const a0 = { x: 100, y: 200 };
    const b0 = { x: 200, y: 200 };
    const c = Math.cos(deg(30));
    const s = Math.sin(deg(30));
    const a1 = { x: 170, y: 260 };
    const b1 = { x: 170 + 150 * c, y: 260 + 150 * s };
    const motion = pinchMotion(fingers(a0, b0, a1, b1), 0.1, 10);
    expect(motion.k).toBeCloseTo(1.5);
    expect(motion.angle).toBeCloseTo(deg(30));
    expectPoint(pinchPoint(motion, a0), a1);
    expectPoint(pinchPoint(motion, b0), b1);
  });

  it("carries on from a move a finger had already made", () => {
    // The selection was dragged 40 px right before the second finger came.
    const base = { x: 40, y: 0 };
    const pinch = fingers(
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 80, y: 100 },
      { x: 220, y: 100 },
      base,
    );
    const motion = pinchMotion(pinch, 0.1, 10);
    // What the fingers landed on sits 40 px left of them in the document.
    expectPoint(pinchPoint(motion, { x: 60, y: 100 }), { x: 80, y: 100 });
    expectPoint(pinchPoint(motion, { x: 160, y: 100 }), { x: 220, y: 100 });
  });

  it("does nothing until the fingers scale, turn or move it enough", () => {
    const still = startPinch({ x: 50, y: 50 });
    expect(isStill(pinchMotion(still, 0.1, 10))).toBe(true);
    // Jitter of fingers landing: 2 % wider, 3° round, 5 px across.
    const jitter = stepPinch(
      still,
      { scaleFactor: 1.02, rotation: deg(3), centre: { x: 55, y: 50 } },
      SLOP,
    );
    expect(jitter.engaged).toBe(false);
    expect(isStill(pinchMotion(jitter, 0.1, 10))).toBe(true);
    // Each of the three alone is enough, and it stays engaged.
    const steps = [
      { scaleFactor: 1 + PINCH_SCALE_SLOP, rotation: 0, centre: { x: 50, y: 50 } },
      { scaleFactor: 1, rotation: deg(7), centre: { x: 50, y: 50 } },
      { scaleFactor: 1, rotation: 0, centre: { x: 50, y: 58 } },
    ];
    for (const step of steps) {
      const on = stepPinch(still, step, SLOP);
      expect(on.engaged).toBe(true);
      const back = stepPinch(on, { scaleFactor: 1, rotation: 0, centre: { x: 50, y: 50 } }, SLOP);
      expect(back.engaged).toBe(true);
    }
    // Not yet engaged, a pinch that began on a moved selection keeps that move.
    expect(pinchMotion(startPinch({ x: 0, y: 0 }, { x: 5, y: 6 }), 0.1, 10)).toMatchObject({
      k: 1,
      angle: 0,
      dx: 5,
      dy: 6,
    });
  });

  it("holds the scale within its limits and snaps the turn onto quarter turns", () => {
    const big = stepPinch(
      startPinch({ x: 0, y: 0 }),
      { scaleFactor: 8, rotation: deg(93), centre: { x: 0, y: 0 } },
      SLOP,
    );
    const m = pinchMotion(big, 0.5, 3);
    expect(m.k).toBe(3);
    expect(m.angle).toBeCloseTo(Math.PI / 2, 12);
    expect(pinchMotion(big, 0.5, 3, 0).angle).toBeCloseTo(deg(93));
    const small = stepPinch(
      big,
      { scaleFactor: 1 / 100, rotation: 0, centre: { x: 0, y: 0 } },
      SLOP,
    );
    expect(pinchMotion(small, 0.5, 3).k).toBe(0.5);
    // A full turn and a bit reads as the bit.
    const round = stepPinch(
      big,
      { scaleFactor: 1, rotation: deg(280), centre: { x: 0, y: 0 } },
      SLOP,
    );
    expect(pinchMotion(round, 0.5, 3).angle).toBeCloseTo(deg(13));
  });

  it("ignores a report that is not a number", () => {
    const p = startPinch({ x: 1, y: 2 });
    const bad = [
      { scaleFactor: NaN, rotation: 0, centre: { x: 1, y: 2 } },
      { scaleFactor: 0, rotation: 0, centre: { x: 1, y: 2 } },
      { scaleFactor: 1, rotation: Infinity, centre: { x: 1, y: 2 } },
      { scaleFactor: 1, rotation: 0, centre: { x: NaN, y: 2 } },
    ];
    for (const step of bad) expect(stepPinch(p, step, SLOP)).toBe(p);
  });
});

describe("the frame during a pinch", () => {
  it("is the bounds scaled and centred where their middle went, turned about its own middle", () => {
    const bounds = { minX: 100, minY: 100, maxX: 300, maxY: 200 };
    const motion: PinchMotion = {
      anchor: { x: 150, y: 120 },
      k: 2,
      angle: deg(40),
      dx: 30,
      dy: -10,
    };
    const frame = pinchFrame(bounds, motion);
    expect(frame.maxX - frame.minX).toBeCloseTo(400);
    expect(frame.maxY - frame.minY).toBeCloseTo(200);
    // Turning the frame's corner about the frame's middle lands it where the
    // bounds' corner goes, which is how the dashed frame is drawn (CSS rotate).
    const mid = { x: (frame.minX + frame.maxX) / 2, y: (frame.minY + frame.maxY) / 2 };
    const c = Math.cos(motion.angle);
    const s = Math.sin(motion.angle);
    const x = frame.minX - mid.x;
    const y = frame.minY - mid.y;
    expectPoint(
      { x: mid.x + x * c - y * s, y: mid.y + x * s + y * c },
      pinchPoint(motion, { x: 100, y: 100 }),
    );
  });

  it("keeps the selection's middle on the page", () => {
    const bounds = { minX: 100, minY: 100, maxX: 200, maxY: 200 };
    const page = { width: 800, height: 1000 };
    const motion: PinchMotion = { anchor: { x: 150, y: 150 }, k: 1, angle: 0, dx: -500, dy: 2000 };
    const held = clampPinch(motion, bounds, page);
    expectPoint(pinchPoint(held, { x: 150, y: 150 }), { x: 0, y: 1000 });
    // Within the page, nothing changes.
    const inside = { ...motion, dx: 20, dy: 30 };
    expect(clampPinch(inside, bounds, page)).toEqual(inside);
  });
});

describe("where two fingers pinch the selection, not the page", () => {
  const frame = { minX: 100, minY: 100, maxX: 140, maxY: 120 };
  it("on the frame, or near it, round a small shape", () => {
    expect(pinchOnSelection(frame, { x: 120, y: 110 }, 0)).toBe(true);
    expect(pinchOnSelection(frame, { x: 150, y: 110 }, 0)).toBe(false);
    expect(pinchOnSelection(frame, { x: 150, y: 110 }, 12)).toBe(true);
    expect(pinchOnSelection(frame, { x: 120, y: 140 }, 12)).toBe(false);
  });
});

describe("committing a pinch", () => {
  function doc(): { d: InkDocument; stroke: Stroke; box: TextBoxElement } {
    const d = emptyDocument();
    const page = blankPage("p1");
    const stroke: Stroke = {
      id: "s1",
      color: "#000",
      size: 2,
      tool: "pen",
      pts: [100.1, 100.3, 0.5, 200.7, 150.9, 0.6, 180.2, 220.4, 0.7],
    };
    const box: TextBoxElement = {
      id: "t1",
      x: 300,
      y: 100,
      w: 100,
      h: 40,
      text: "hi",
      color: "#000",
      fontSize: 20,
    };
    page.strokes.push(stroke);
    page.textBoxes.push(box);
    d.pages = [page];
    return { d, stroke, box };
  }

  it("puts every point where the preview drew it, and undo restores the file exactly", () => {
    const { d, stroke, box } = doc();
    const before = JSON.stringify(d);
    const pts = stroke.pts;
    const motion: PinchMotion = {
      anchor: { x: 150, y: 160 },
      k: 1.7,
      angle: deg(35),
      dx: 40,
      dy: -25,
    };
    const command = pinchCommand("p1", { strokes: [stroke], images: [], textBoxes: [box] }, motion);
    expect(command?.label).toBe("Rotate selection");
    command?.apply(d);
    // A fresh array: the path cache keys on its identity.
    expect(stroke.pts).not.toBe(pts);
    for (let i = 0; i < pts.length; i += 3) {
      expectPoint(
        { x: stroke.pts[i], y: stroke.pts[i + 1] },
        pinchPoint(motion, { x: pts[i], y: pts[i + 1] }),
      );
      expect(stroke.pts[i + 2]).toBe(pts[i + 2]);
    }
    expect(stroke.size).toBeCloseTo(3.4);
    // A text box stays upright: its middle goes round, its frame and font scale.
    expectPoint(
      { x: box.x + box.w / 2, y: box.y + (box.h ?? 0) / 2 },
      pinchPoint(motion, { x: 350, y: 120 }),
    );
    expect(box.fontSize).toBe(34);
    command?.invert(d);
    expect(JSON.stringify(d)).toBe(before);
  });

  it("is only the parts the pinch used, and nothing for a pinch that did nothing", () => {
    const { stroke } = doc();
    const sel = { strokes: [stroke], images: [], textBoxes: [] };
    const at = { x: 0, y: 0 };
    expect(pinchCommand("p1", sel, { anchor: at, k: 1, angle: 0, dx: 0, dy: 0 })).toBeNull();
    expect(pinchCommand("p1", sel, { anchor: at, k: 1, angle: 0, dx: 3, dy: 0 })?.label).toBe(
      "Move selection",
    );
    expect(pinchCommand("p1", sel, { anchor: at, k: 2, angle: 0, dx: 0, dy: 0 })?.label).toBe(
      "Resize selection",
    );
    expect(pinchCommand("p1", sel, { anchor: at, k: 2, angle: 0, dx: 3, dy: 0 })?.label).toBe(
      "Resize selection",
    );
  });
});
