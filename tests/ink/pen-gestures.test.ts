/**
 * `src/ink/pen-gestures.ts` — the gesture switches, and the loop Circle to
 * Lasso reads off a stroke.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_PEN_GESTURES, gestureLoopOf, penGesturesOf } from "../../src/ink/pen-gestures";
import { presetGeometry } from "../../src/ink/shape-geometry";
import { type Pt, arc, pencilInk, segment } from "./ink-synth";
import realPencil from "./fixtures/real-pencil-ipad.json";

const TOLERANCE = 24;

/** A circle from `startDeg` going `sweepDeg` round, as ideal points. */
function circle(cx: number, cy: number, r: number, startDeg: number, sweepDeg: number): Pt[] {
  const pts: Pt[] = [];
  const steps = Math.max(8, Math.round(Math.abs(sweepDeg) / 4));
  for (let i = 0; i <= steps; i++) {
    const t = ((startDeg + (sweepDeg * i) / steps) * Math.PI) / 180;
    pts.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
  }
  return pts;
}

describe("penGesturesOf", () => {
  it("is GoodNotes' defaults for anything missing or wrong", () => {
    expect(penGesturesOf(undefined)).toEqual(DEFAULT_PEN_GESTURES);
    expect(penGesturesOf(null)).toEqual(DEFAULT_PEN_GESTURES);
    expect(penGesturesOf("on")).toEqual(DEFAULT_PEN_GESTURES);
    expect(penGesturesOf({ scribbleErase: "yes", circleLasso: 1 })).toEqual(DEFAULT_PEN_GESTURES);
    expect(DEFAULT_PEN_GESTURES).toEqual({
      scribbleErase: true,
      scribbleErasesAll: false,
      circleLasso: true,
    });
  });

  it("keeps every switch that is a boolean", () => {
    expect(
      penGesturesOf({ scribbleErase: false, scribbleErasesAll: true, circleLasso: false }),
    ).toEqual({ scribbleErase: false, scribbleErasesAll: true, circleLasso: false });
    expect(penGesturesOf({ circleLasso: false })).toEqual({
      ...DEFAULT_PEN_GESTURES,
      circleLasso: false,
    });
  });

  it("returns a fresh object, never the defaults themselves", () => {
    const a = penGesturesOf(undefined);
    a.circleLasso = false;
    expect(DEFAULT_PEN_GESTURES.circleLasso).toBe(true);
  });
});

describe("gestureLoopOf", () => {
  it("reads a hand-drawn circle as a loop", () => {
    for (const seed of [1, 2, 3]) {
      const loop = gestureLoopOf(pencilInk(circle(200, 200, 80, 0, 360), seed), TOLERANCE);
      expect(loop, `seed ${seed}`).not.toBeNull();
    }
  });

  it("closes a gap of up to a fifth of the loop's diagonal", () => {
    // 330° round an 80 px circle leaves a ~41 px gap; the diagonal is ~226.
    expect(gestureLoopOf(pencilInk(circle(200, 200, 80, 0, 330), 1), TOLERANCE)).not.toBeNull();
    // 250° leaves ~130 px: an open arc.
    expect(gestureLoopOf(pencilInk(circle(200, 200, 80, 0, 250), 1), TOLERANCE)).toBeNull();
  });

  it("leaves off a tail where the pen overshot its start", () => {
    const ink = pencilInk(circle(200, 200, 80, 0, 420), 1);
    const loop = gestureLoopOf(ink, TOLERANCE);
    expect(loop).not.toBeNull();
    // The loop ends near the start, not 60° past it.
    const n = loop?.length ?? 0;
    const end = { x: loop?.[n - 2] ?? 0, y: loop?.[n - 1] ?? 0 };
    expect(Math.hypot(end.x - ink[0], end.y - ink[1])).toBeLessThan(TOLERANCE);
    expect(n / 2).toBeLessThan(ink.length / 3);
  });

  it("reads snapped shapes' clean closed polygons", () => {
    for (const preset of ["rect", "ellipse", "triangle", "star"] as const) {
      const pts = presetGeometry(preset, { x: 100, y: 100 }, { x: 260, y: 220 }, 0.5);
      expect(gestureLoopOf(pts, TOLERANCE), preset).not.toBeNull();
    }
  });

  it("reads the real Pencil loops on file", () => {
    const strokes = (realPencil as { strokes: Array<{ closed?: boolean; points: number[][] }> })
      .strokes;
    const closed = strokes.filter((s) => s.closed);
    expect(closed.length).toBeGreaterThan(3);
    for (const s of closed) {
      const pts = s.points.flatMap(([x, y]) => [x, y, 0.5]);
      expect(gestureLoopOf(pts, TOLERANCE)).not.toBeNull();
    }
  });

  it("refuses what does not enclose: a line, a line gone back over, a zigzag", () => {
    expect(gestureLoopOf(pencilInk(segment(0, 0, 200, 0), 1), TOLERANCE)).toBeNull();
    const retrace = [...segment(0, 0, 200, 0), ...segment(200, 0, 0, 2)];
    expect(gestureLoopOf(pencilInk(retrace, 1), TOLERANCE)).toBeNull();
    const zig: Pt[] = [];
    for (let i = 0; i < 8; i++) zig.push({ x: i % 2 ? 60 : 0, y: i * 4 });
    zig.push({ x: 0, y: 0 });
    expect(gestureLoopOf(pencilInk(zig, 1), TOLERANCE)).toBeNull();
  });

  it("refuses an arc, and anything too short to enclose", () => {
    expect(gestureLoopOf(pencilInk(arc(100, 100, 50, 0, 180, 40), 1), TOLERANCE)).toBeNull();
    expect(gestureLoopOf([], TOLERANCE)).toBeNull();
    expect(gestureLoopOf([0, 0, 0.5, 10, 0, 0.5], TOLERANCE)).toBeNull();
    expect(gestureLoopOf([5, 5, 0.5, 5, 5, 0.5, 5, 5, 0.5, 5, 5, 0.5], TOLERANCE)).toBeNull();
  });

  it("reads whole points only, skipping ones that are not numbers", () => {
    const ink = pencilInk(circle(200, 200, 80, 0, 360), 1);
    const holed = [...ink, 4];
    holed[9] = Number.NaN;
    expect(gestureLoopOf(holed, TOLERANCE)).not.toBeNull();
  });
});
