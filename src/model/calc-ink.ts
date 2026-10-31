/**
 * Calculation notes, the ink side: whether the stroke just drawn finished an
 * "=", which strokes are the sum before it, and where the answer goes.
 *
 * The line is found by where the ink is, never by when it was written: on
 * ruled paper by the page's writing lines (`canvas/writing-lines.ts`), on
 * other paper by a band around the "=". A sum written slowly, or finished
 * after a pause, is still one line.
 *
 * PURE: no DOM. Page px throughout.
 */

import { type LineBlock, assignLines, lineOfBounds } from "../canvas/writing-lines";
import { type Bounds, POINT_STRIDE, type Stroke, strokeBounds } from "./document";

/** An "=" drawn as two strokes, and the box around both. */
export interface EqualsSign {
  strokes: [Stroke, Stroke];
  bounds: Bounds;
}

/** Where an answer is written: its left edge, the baseline it sits on, and its digits' height. */
export interface AnswerPlace {
  x: number;
  baseline: number;
  height: number;
}

/** Ink a sum is written in: pen strokes, not highlighter, cover tape or snapped shapes. */
export function isSumInk(stroke: Stroke): boolean {
  return stroke.tool === "pen" && !stroke.shape;
}

function pathLength(stroke: Stroke): number {
  const p = stroke.pts;
  let length = 0;
  for (let i = POINT_STRIDE; i + 1 < p.length; i += POINT_STRIDE) {
    length += Math.hypot(p[i] - p[i - POINT_STRIDE], p[i + 1] - p[i + 1 - POINT_STRIDE]);
  }
  return length;
}

/**
 * A dash: flat, nearly straight, longer than a dot. The path may be half as
 * long again as the dash is wide: Pencil ink has a hook where it lands.
 */
function isDash(stroke: Stroke, box: Bounds): boolean {
  const w = box.maxX - box.minX;
  const h = box.maxY - box.minY;
  return w > 1 && h <= Math.max(0.4 * w, 1.5) && pathLength(stroke) <= 1.5 * w;
}

/**
 * The "=" the last two sum strokes make, or null. Both are dashes of about
 * the same length, one above the other, overlapping across most of the
 * shorter one, and apart by less than their length (a fraction bar over a
 * minus is further). Judged only by shape, so it holds at any zoom.
 */
export function equalsAtEnd(strokes: readonly Stroke[]): EqualsSign | null {
  const ink = strokes.filter(isSumInk);
  if (ink.length < 2) return null;
  const a = ink[ink.length - 2];
  const b = ink[ink.length - 1];
  const ba = strokeBounds(a);
  const bb = strokeBounds(b);
  if (!ba || !bb || !isDash(a, ba) || !isDash(b, bb)) return null;
  const wa = ba.maxX - ba.minX;
  const wb = bb.maxX - bb.minX;
  if (Math.max(wa, wb) > 2.2 * Math.min(wa, wb)) return null;
  const overlap = Math.min(ba.maxX, bb.maxX) - Math.max(ba.minX, bb.minX);
  if (overlap < 0.5 * Math.min(wa, wb)) return null;
  const mean = (wa + wb) / 2;
  const gap = Math.abs((ba.minY + ba.maxY) / 2 - (bb.minY + bb.maxY) / 2);
  const tallest = Math.max(ba.maxY - ba.minY, bb.maxY - bb.minY);
  if (gap < 0.12 * mean || gap > 1.0 * mean || gap <= tallest * 0.8) return null;
  const top = (ba.minY + ba.maxY) / 2 <= (bb.minY + bb.maxY) / 2 ? a : b;
  return {
    strokes: top === a ? [a, b] : [b, a],
    bounds: {
      minX: Math.min(ba.minX, bb.minX),
      minY: Math.min(ba.minY, bb.minY),
      maxX: Math.max(ba.maxX, bb.maxX),
      maxY: Math.max(ba.maxY, bb.maxY),
    },
  };
}

/**
 * The strokes of the sum that ends at `eq`: the ink on its line (by the
 * page's writing lines when it is on one, else in a band around the "="),
 * left of it, reached from it without a gap wider than about two digits.
 * The "=" itself is included, last.
 */
export function sumStrokes(
  strokes: readonly Stroke[],
  eq: EqualsSign,
  blocks: readonly LineBlock[],
): Stroke[] {
  const eqIds = new Set(eq.strokes.map((s) => s.id));
  const ink = strokes.filter((s) => isSumInk(s) && !eqIds.has(s.id));
  const boxes = ink.map((s) => strokeBounds(s));
  const eqW = eq.bounds.maxX - eq.bounds.minX;
  const eqRef = blocks.length > 0 ? lineOfBounds(blocks, eq.bounds) : null;
  let onLine: boolean[];
  let gapLimit: number;
  if (eqRef) {
    const refs = assignLines(
      blocks,
      boxes.map((b) => b ?? { minX: 0, minY: -1e9, maxX: 0, maxY: -1e9 }),
    );
    onLine = refs.map((r) => r !== null && r.block === eqRef.block && r.line === eqRef.line);
    gapLimit = Math.max(blocks[eqRef.block].pitch * 2, eqW * 3);
  } else {
    const cy = (eq.bounds.minY + eq.bounds.maxY) / 2;
    const reach = Math.max(eqW * 1.2, (eq.bounds.maxY - eq.bounds.minY) * 2);
    onLine = boxes.map((b) => b !== null && Math.abs((b.minY + b.maxY) / 2 - cy) <= reach);
    gapLimit = eqW * 3;
  }
  // Left of the "=" (a little overlap allowed), nearest first.
  const candidates = ink
    .map((stroke, i) => ({ stroke, box: boxes[i] }))
    .filter(
      (c, i): c is { stroke: Stroke; box: Bounds } =>
        onLine[i] && c.box !== null && c.box.maxX <= eq.bounds.minX + eqW * 0.5,
    )
    .sort((p, q) => q.box.maxX - p.box.maxX);
  let left = eq.bounds.minX;
  const kept: Stroke[] = [];
  for (const c of candidates) {
    if (c.box.maxX < left - gapLimit) break;
    kept.push(c.stroke);
    left = Math.min(left, c.box.minX);
  }
  // In the page's order (the order they were written in), then the "=".
  const order = new Map(strokes.map((s, i) => [s.id, i]));
  kept.sort((p, q) => (order.get(p.id) ?? 0) - (order.get(q.id) ?? 0));
  return [...kept, ...eq.strokes];
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** The space between the "=" and the answer, in digit heights (as a hand leaves it). */
const ANSWER_GAP = 0.42;

/**
 * Where the answer goes: after the "=", a little under half a digit away,
 * on the baseline the sum's digits sit on, as tall as they are. Digits are
 * the sum's tall strokes (at least three quarters of the tallest ones);
 * with none, the "=" sets the size.
 */
export function answerPlace(sum: readonly Stroke[], eq: EqualsSign): AnswerPlace {
  const eqIds = new Set(eq.strokes.map((s) => s.id));
  const boxes = sum
    .filter((s) => !eqIds.has(s.id))
    .map((s) => strokeBounds(s))
    .filter((b): b is Bounds => b !== null);
  const heights = boxes.map((b) => b.maxY - b.minY);
  const eqW = eq.bounds.maxX - eq.bounds.minX;
  if (heights.length > 0) {
    const tallest = [...heights].sort((a, b) => b - a)[Math.min(1, heights.length - 1)];
    const tall = boxes.filter((b) => b.maxY - b.minY >= 0.75 * tallest);
    const height = median(tall.map((b) => b.maxY - b.minY));
    if (height > 0) {
      return {
        x: eq.bounds.maxX + height * ANSWER_GAP,
        baseline: median(tall.map((b) => b.maxY)),
        height,
      };
    }
  }
  const height = Math.max(eqW * 1.6, 4);
  const cy = (eq.bounds.minY + eq.bounds.maxY) / 2;
  return { x: eq.bounds.maxX + height * ANSWER_GAP, baseline: cy + height * 0.45, height };
}
