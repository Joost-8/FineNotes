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

import { type LineBlock, type LineRef, assignLines, lineOfBounds } from "../canvas/writing-lines";
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

/** A stroke's length along its path. */
export function pathLength(stroke: Stroke): number {
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
export function isDash(stroke: Stroke, box: Bounds): boolean {
  const w = box.maxX - box.minX;
  const h = box.maxY - box.minY;
  return w > 1 && h <= Math.max(0.4 * w, 1.5) && pathLength(stroke) <= 1.5 * w;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * The height of a sum's digits: the median of its tall strokes (at least
 * three quarters of the second tallest, so one long stroke does not set it).
 * 0 when nothing has height.
 */
export function digitHeight(boxes: readonly Bounds[]): number {
  const heights = boxes.map((b) => b.maxY - b.minY).filter((h) => h > 0);
  if (heights.length === 0) return 0;
  const sorted = [...heights].sort((a, b) => b - a);
  const tallest = sorted[Math.min(1, sorted.length - 1)];
  return median(heights.filter((h) => h >= 0.75 * tallest));
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
  return equalsOf(ink[ink.length - 2], ink[ink.length - 1]);
}

/**
 * A dash in an "=" written in passing: it may lean more than a lone one
 * (measured on real lines). Only for {@link equalsAfter}, whose line must then
 * be read with exactly one "=" in it, so a stray pair costs one reading.
 */
function isLooseDash(stroke: Stroke, box: Bounds): boolean {
  const w = box.maxX - box.minX;
  const h = box.maxY - box.minY;
  return w > 1 && h <= Math.max(0.65 * w, 1.5) && pathLength(stroke) <= 1.6 * w;
}

/** The "=" two strokes make, or null (see {@link equalsAtEnd}). */
function equalsOf(a: Stroke, b: Stroke, loose = false): EqualsSign | null {
  const ba = strokeBounds(a);
  const bb = strokeBounds(b);
  if (!ba || !bb) return null;
  const dash = loose ? isLooseDash : isDash;
  if (!dash(a, ba) || !dash(b, bb)) return null;
  const wa = ba.maxX - ba.minX;
  const wb = bb.maxX - bb.minX;
  if (Math.max(wa, wb) > (loose ? 3.3 : 2.2) * Math.min(wa, wb)) return null;
  const overlap = Math.min(ba.maxX, bb.maxX) - Math.max(ba.minX, bb.minX);
  if (overlap < 0.5 * Math.min(wa, wb)) return null;
  const mean = (wa + wb) / 2;
  const gap = Math.abs((ba.minY + ba.maxY) / 2 - (bb.minY + bb.maxY) / 2);
  const tallest = Math.max(ba.maxY - ba.minY, bb.maxY - bb.minY);
  if (gap < 0.12 * mean || gap > (loose ? 1.8 : 1.0) * mean || gap <= tallest * 0.8) return null;
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

/** How many strokes may follow an "=" for the line still to count as that "="'s. */
const MAX_AFTER_EQUALS = 40;

/** An "=" with ink written after it on its line ("x + 5 = 7"), and that ink. */
export interface EqualsWithRest {
  eq: EqualsSign;
  /** The strokes written after the "=", in the order they were written. */
  after: Stroke[];
}

/**
 * The latest "=" the page's last ink follows on one line: every stroke since
 * it lies right of it, on its line, with no gap wider than the sum's own
 * (as in {@link sumStrokes}). Null when the last ink is the "=" itself, or
 * belongs to something else.
 */
export function equalsAfter(
  strokes: readonly Stroke[],
  blocks: readonly LineBlock[],
): EqualsWithRest | null {
  const ink = strokes.filter(isSumInk);
  const stop = Math.max(1, ink.length - 1 - MAX_AFTER_EQUALS);
  for (let i = ink.length - 2; i >= stop; i--) {
    const eq = equalsOf(ink[i - 1], ink[i], true);
    if (!eq) continue;
    const after = ink.slice(i + 1);
    return followsOnLine(eq, after, blocks) ? { eq, after } : null;
  }
  return null;
}

/** Whether all of `after` lies right of `eq`, on its line, one stretch of ink. */
function followsOnLine(
  eq: EqualsSign,
  after: readonly Stroke[],
  blocks: readonly LineBlock[],
): boolean {
  const boxes = after.map((s) => strokeBounds(s));
  if (boxes.some((b) => b === null)) return false;
  const known = boxes as Bounds[];
  const eqW = eq.bounds.maxX - eq.bounds.minX;
  const eqRef = blocks.length > 0 ? lineOfBounds(blocks, eq.bounds) : null;
  let gapLimit = eqW * 3;
  if (eqRef) {
    const refs = assignLines(blocks, known);
    const pitch = blocks[eqRef.block].pitch;
    const cy = (eq.bounds.minY + eq.bounds.maxY) / 2;
    const same = (r: LineRef | null, b: Bounds): boolean =>
      (r !== null && r.block === eqRef.block && r.line === eqRef.line) || levelWith(b, cy, pitch);
    if (known.some((b, i) => !same(refs[i], b))) return false;
    gapLimit = Math.max(pitch * 2, gapLimit);
  } else {
    const cy = (eq.bounds.minY + eq.bounds.maxY) / 2;
    const reach = Math.max(eqW * 1.2, (eq.bounds.maxY - eq.bounds.minY) * 2);
    if (known.some((b) => Math.abs((b.minY + b.maxY) / 2 - cy) > reach)) return false;
  }
  if (known.some((b) => b.minX < eq.bounds.maxX - eqW * 0.5)) return false;
  let right = eq.bounds.maxX;
  for (const box of [...known].sort((p, q) => p.minX - q.minX)) {
    if (box.minX > right + gapLimit) return false;
    right = Math.max(right, box.maxX);
  }
  return true;
}

/** Share of a ruled line's pitch ink may sit from the "=" and still be on its line (a raised power does). */
const LEVEL_SHARE = 0.8;

/** Whether `box` has its middle within reach of `cy` on paper ruled at `pitch`. */
function levelWith(box: Bounds | null, cy: number, pitch: number): boolean {
  return box !== null && Math.abs((box.minY + box.maxY) / 2 - cy) <= LEVEL_SHARE * pitch;
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
    // Handwriting crosses the rules: ink level with the "=" is on its line too.
    const pitch = blocks[eqRef.block].pitch;
    const cy = (eq.bounds.minY + eq.bounds.maxY) / 2;
    onLine = refs.map(
      (r, i) =>
        (r !== null && r.block === eqRef.block && r.line === eqRef.line) ||
        levelWith(boxes[i], cy, pitch),
    );
    gapLimit = Math.max(pitch * 2, eqW * 3);
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
  pullFractionSides(ink, boxes, kept, { minX: left, maxX: eq.bounds.minX }, eqW * 1.6);
  // In the page's order (the order they were written in), then the "=".
  const order = new Map(strokes.map((s, i) => [s.id, i]));
  kept.sort((p, q) => (order.get(p.id) ?? 0) - (order.get(q.id) ?? 0));
  return [...kept, ...eq.strokes];
}

/**
 * A fraction may lie partly off the sum's line: on ruled paper its bar sits
 * on the rule and its denominator under it; on blank paper a tall numerator
 * may reach beyond the band around the "=". So every dash at least half a
 * digit wide, between the sum's left end and the "=" and within a digit of
 * its ink, is a bar when there is ink just over it and just under it
 * (inside its width, within a digit): the bar and both sides are taken, so
 * `calc-layout.ts` sees the whole fraction. A minus has nothing over and
 * under it and takes nothing from the lines around it. Adds to `kept`.
 */
function pullFractionSides(
  ink: readonly Stroke[],
  boxes: readonly (Bounds | null)[],
  kept: Stroke[],
  span: { minX: number; maxX: number },
  fallbackDigit: number,
): void {
  const keptIds = new Set(kept.map((s) => s.id));
  const keptBoxes = kept.flatMap((s) => {
    const b = strokeBounds(s);
    return b ? [{ s, b }] : [];
  });
  // With only the bar on the line (both sides beyond the band), the "=" gives the size.
  const digit =
    digitHeight(keptBoxes.filter(({ s, b }) => !isDash(s, b)).map(({ b }) => b)) || fallbackDigit;
  if (digit <= 0 || keptBoxes.length === 0) return;
  const top = Math.min(...keptBoxes.map(({ b }) => b.minY)) - digit;
  const bottom = Math.max(...keptBoxes.map(({ b }) => b.maxY)) + digit;
  ink.forEach((bar, j) => {
    const box = boxes[j];
    if (!box || !isDash(bar, box) || box.maxX - box.minX < 0.5 * digit) return;
    const w = box.maxX - box.minX;
    const y = (box.minY + box.maxY) / 2;
    const cx = (box.minX + box.maxX) / 2;
    if (cx < span.minX - digit || cx > span.maxX || y < top || y > bottom) return;
    const over: Stroke[] = [];
    const under: Stroke[] = [];
    ink.forEach((s, i) => {
      const b = boxes[i];
      if (!b || s === bar) return;
      const x = (b.minX + b.maxX) / 2;
      if (x < box.minX - 0.1 * w || x > box.maxX + 0.1 * w) return;
      if (b.maxY - b.minY > 2.5 * digit) return;
      const mid = (b.minY + b.maxY) / 2;
      if (mid < y && b.maxY <= y + 0.2 * digit && b.maxY >= y - digit) over.push(s);
      else if (mid > y && b.minY >= y - 0.2 * digit && b.minY <= y + digit) under.push(s);
    });
    if (over.length === 0 || under.length === 0) return;
    // The small marks of a side lie further from the bar than its digits'
    // feet: a raised dot, the bar of a crossed 7 (FineNotes#178, "7·2 over
    // 3" with a short "=" read as 72 over 3). Whatever lies inside a side,
    // between its far edge and the bar, is that side's too.
    const overTop = Math.min(...over.map((s) => strokeBounds(s)?.minY ?? y));
    const underBottom = Math.max(...under.map((s) => strokeBounds(s)?.maxY ?? y));
    ink.forEach((s, i) => {
      const b = boxes[i];
      if (!b || s === bar || over.includes(s) || under.includes(s)) return;
      const x = (b.minX + b.maxX) / 2;
      if (x < box.minX - 0.1 * w || x > box.maxX + 0.1 * w) return;
      if (b.maxY <= y && b.minY >= overTop) over.push(s);
      else if (b.minY >= y && b.maxY <= underBottom) under.push(s);
    });
    for (const s of [bar, ...over, ...under]) {
      if (keptIds.has(s.id)) continue;
      keptIds.add(s.id);
      kept.push(s);
    }
  });
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
      // Ink on two levels (a fraction): the answer sits level with the "=".
      const bottoms = tall.map((b) => b.maxY);
      if (Math.max(...bottoms) - Math.min(...bottoms) > height) {
        const cy = (eq.bounds.minY + eq.bounds.maxY) / 2;
        return { x: eq.bounds.maxX + height * ANSWER_GAP, baseline: cy + height / 2, height };
      }
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

/** Where the answer to a whole equation goes: after the line's last ink, a little apart. */
export function answerPlaceAfter(place: AnswerPlace, after: readonly Stroke[]): AnswerPlace {
  const right = Math.max(...after.map((s) => strokeBounds(s)?.maxX ?? -Infinity));
  return Number.isFinite(right) ? { ...place, x: right + place.height * 1.4 } : place;
}

/** Room kept between a graph and the page's edge, page px. */
const GRAPH_MARGIN = 12;

/**
 * Where a graph of a written function goes: under its line, level with the
 * line's left end, and inside the page.
 */
export function graphPlaceUnder(
  line: Bounds,
  size: { w: number; h: number },
  page: { width: number; height: number },
): { x: number; y: number } {
  const inside = (value: number, room: number): number =>
    Math.max(GRAPH_MARGIN, Math.min(value, room - GRAPH_MARGIN));
  return {
    x: inside(line.minX, page.width - size.w),
    y: inside(line.maxY + GRAPH_MARGIN, page.height - size.h),
  };
}
