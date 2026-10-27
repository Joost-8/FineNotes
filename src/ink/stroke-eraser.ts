/**
 * The "standard" (partial) eraser: cut the part of a stroke that lies under a
 * circular eraser and keep what is left, possibly as several pieces.
 *
 * Pure: no DOM, no Obsidian. The whole-stroke eraser needs none of this — it
 * only asks {@link strokeHitByPoint} whether a stroke was touched at all.
 *
 * The cut is exact rather than sampled: each polyline segment is clipped
 * against the circle analytically, and the entry/exit points are interpolated
 * (pressure included). Sampling would leave ragged ends on long straight
 * segments, which hold-to-snap produces by construction — a snapped line is
 * two points.
 */

import { type Stroke, POINT_STRIDE } from "../model/document";

/**
 * Pieces shorter than this (page px of polyline length) are dropped. A sliver
 * would render as a lone round dot — the cap of a stroke that is not there.
 */
export const MIN_PIECE_LENGTH = 1;

/**
 * What the eraser may touch (0.5). GoodNotes' "Erase highlighter only" lets a
 * highlight be rubbed out without the writing under it; "pen only" is the
 * converse, for cleaning up writing over a highlight. At most one is on, so
 * the setting is one value; `all` is both off. Keyed on `stroke.tool`: a
 * shape or a table is pen ink. The eraser never erases images or text boxes.
 */
export type EraserFilter = "all" | "highlighter" | "pen";

export const ERASER_FILTERS: readonly EraserFilter[] = ["all", "highlighter", "pen"];

/** A stored eraser filter, or `all` when plugin data holds anything else. */
export function eraserFilterOf(raw: unknown): EraserFilter {
  return raw === "highlighter" || raw === "pen" ? raw : "all";
}

/** Whether the eraser, set to `filter`, erases this stroke at all. */
export function eraserTakes(stroke: Pick<Stroke, "tool">, filter: EraserFilter): boolean {
  if (filter === "highlighter") return stroke.tool === "highlighter";
  if (filter === "pen") return stroke.tool !== "highlighter";
  return true;
}

/**
 * Erase a circle from one stroke.
 *
 * The radius is widened by half the stroke's width. A cut end is drawn with a
 * round cap reaching `size / 2` back past the last point, so clipping the
 * centreline at `radius + size / 2` puts the *visible* edge on the eraser's
 * edge; clipping at `radius` would leave the cap poking into the erased area.
 *
 * @returns `null` when the eraser misses the stroke entirely (so the caller can
 *          keep the original object), otherwise the surviving pieces as flat
 *          `[x, y, p, …]` arrays — an empty array when nothing survives.
 */
export function eraseCircleFromPoints(
  pts: readonly number[],
  strokeSize: number,
  cx: number,
  cy: number,
  radius: number,
): number[][] | null {
  // Iterate whole points only: a ragged array from disk must not read past
  // its end (see CLAUDE.md, "Stride-stepping loops must guard every write").
  const usable = pts.length - (pts.length % POINT_STRIDE);
  const n = usable / POINT_STRIDE;
  if (n === 0) return null;

  const r = radius + Math.max(0, strokeSize) / 2;
  const r2 = r * r;

  if (n === 1) {
    const dx = pts[0] - cx;
    const dy = pts[1] - cy;
    return dx * dx + dy * dy <= r2 ? [] : null;
  }

  // Broad phase: skip the per-segment maths when the circle is nowhere near.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < usable; i += POINT_STRIDE) {
    minX = Math.min(minX, pts[i]);
    maxX = Math.max(maxX, pts[i]);
    minY = Math.min(minY, pts[i + 1]);
    maxY = Math.max(maxY, pts[i + 1]);
  }
  if (cx < minX - r || cx > maxX + r || cy < minY - r || cy > maxY + r) return null;

  const pieces: number[][] = [];
  let current: number[] = [];
  let touched = false;

  const pushPoint = (i: number): void => {
    current.push(pts[i], pts[i + 1], pts[i + 2]);
  };
  const pushLerp = (a: number, b: number, t: number): void => {
    current.push(
      pts[a] + (pts[b] - pts[a]) * t,
      pts[a + 1] + (pts[b + 1] - pts[a + 1]) * t,
      pts[a + 2] + (pts[b + 2] - pts[a + 2]) * t,
    );
  };
  const closePiece = (): void => {
    if (current.length >= 2 * POINT_STRIDE) pieces.push(current);
    current = [];
  };

  {
    const dx = pts[0] - cx;
    const dy = pts[1] - cy;
    if (dx * dx + dy * dy > r2) pushPoint(0);
    else touched = true;
  }

  for (let a = 0; a + POINT_STRIDE < usable; a += POINT_STRIDE) {
    const b = a + POINT_STRIDE;
    // Solve |A + t(B - A) - C|² = r² for t.
    const dx = pts[b] - pts[a];
    const dy = pts[b + 1] - pts[a + 1];
    const fx = pts[a] - cx;
    const fy = pts[a + 1] - cy;
    const qa = dx * dx + dy * dy;
    const qb = 2 * (fx * dx + fy * dy);
    const qc = fx * fx + fy * fy - r2;

    let lo = 1;
    let hi = 0;
    if (qa === 0) {
      // A repeated point: inside iff A is.
      if (qc <= 0) {
        lo = 0;
        hi = 1;
      }
    } else {
      const disc = qb * qb - 4 * qa * qc;
      if (disc > 0) {
        const s = Math.sqrt(disc);
        lo = Math.max(0, (-qb - s) / (2 * qa));
        hi = Math.min(1, (-qb + s) / (2 * qa));
      }
    }

    if (!(lo < hi)) {
      // The segment misses the circle (or only grazes it).
      if (current.length === 0) pushPoint(a);
      pushPoint(b);
      continue;
    }

    touched = true;
    if (lo > 0) pushLerp(a, b, lo);
    closePiece();
    if (hi < 1) {
      pushLerp(a, b, hi);
      pushPoint(b);
    }
  }
  closePiece();

  if (!touched) return null;
  return pieces.filter((piece) => polylineLength(piece) >= MIN_PIECE_LENGTH);
}

/**
 * {@link eraseCircleFromPoints} for a whole stroke. Each surviving piece keeps
 * the stroke's style, `t0` and `shape`, and gets an id from `nextId`.
 *
 * Keeping `shape` is what keeps a piece straight. The pieces of a shape or
 * a table are still clean geometry — a few far-apart vertices — and without
 * the tag the renderer draws them as handwriting, whose streamline pulls
 * each vertex back toward the last: the two arms of a cut rectangle's
 * corner came out as one curve. The kind stays too, so "Select shapes only"
 * still picks up what is left of one. (A piece does not follow its kind's
 * point layout in contracts/api.md; nothing reads the layout off a stored
 * stroke.)
 */
export function eraseCircleFromStroke(
  stroke: Stroke,
  cx: number,
  cy: number,
  radius: number,
  nextId: () => string,
): Stroke[] | null {
  const pieces = eraseCircleFromPoints(stroke.pts, stroke.size, cx, cy, radius);
  return pieces === null ? null : pieces.map((pts) => pieceOf(stroke, pts, nextId));
}

/** A rectangle the ruled eraser has taken: a stretch of one line's band. */
export interface EraseRect {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Cut every rectangle in `rects` out of one polyline: what the ruled eraser
 * does to a highlight, a shape or a stroke across several lines, so only the
 * part on the lines it erases goes. The rectangles widen sideways by half
 * the stroke's width, as the circle does, so a cut end's round cap stops at
 * the rectangle's edge. Not up and down: a band's edge is the next line's
 * edge, and a highlight along a rule would be cut from both lines.
 *
 * @returns `null` when no rectangle touches the polyline, otherwise the
 *          surviving pieces, an empty array when nothing survives.
 */
export function eraseRectsFromPoints(
  pts: readonly number[],
  strokeSize: number,
  rects: readonly EraseRect[],
): number[][] | null {
  const usable = pts.length - (pts.length % POINT_STRIDE);
  const n = usable / POINT_STRIDE;
  if (n === 0 || rects.length === 0) return null;
  const pad = Math.max(0, strokeSize) / 2;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < usable; i += POINT_STRIDE) {
    minX = Math.min(minX, pts[i]);
    maxX = Math.max(maxX, pts[i]);
    minY = Math.min(minY, pts[i + 1]);
    maxY = Math.max(maxY, pts[i + 1]);
  }
  // Broad phase: only the rectangles that reach the polyline's bounds.
  const near = rects
    .map((r) => ({ minX: r.minX - pad, maxX: r.maxX + pad, minY: r.minY, maxY: r.maxY }))
    .filter((r) => r.minX <= maxX && r.maxX >= minX && r.minY <= maxY && r.maxY >= minY);
  if (near.length === 0) return null;

  if (n === 1) {
    return near.some((r) => inside(r, pts[0], pts[1])) ? [] : null;
  }

  const pieces: number[][] = [];
  let current: number[] = [];
  let touched = false;
  const push = (a: number, b: number, t: number): void => {
    if (t <= 0) current.push(pts[a], pts[a + 1], pts[a + 2]);
    else if (t >= 1) current.push(pts[b], pts[b + 1], pts[b + 2]);
    else {
      current.push(
        pts[a] + (pts[b] - pts[a]) * t,
        pts[a + 1] + (pts[b + 1] - pts[a + 1]) * t,
        pts[a + 2] + (pts[b + 2] - pts[a + 2]) * t,
      );
    }
  };
  const closePiece = (): void => {
    if (current.length >= 2 * POINT_STRIDE) pieces.push(current);
    current = [];
  };

  for (let a = 0; a + POINT_STRIDE < usable; a += POINT_STRIDE) {
    const b = a + POINT_STRIDE;
    const spans = insideSpans(near, pts[a], pts[a + 1], pts[b], pts[b + 1]);
    if (spans.length === 0) {
      if (current.length === 0) push(a, b, 0);
      push(a, b, 1);
      continue;
    }
    touched = true;
    // `t` walks the segment: outside from `t` to each span's start.
    let t = 0;
    for (const [lo, hi] of spans) {
      if (lo > t) {
        if (current.length === 0) push(a, b, t);
        push(a, b, lo);
      }
      closePiece();
      t = hi;
    }
    if (t < 1) {
      push(a, b, t);
      push(a, b, 1);
    }
  }
  closePiece();

  if (!touched) return null;
  return pieces.filter((piece) => polylineLength(piece) >= MIN_PIECE_LENGTH);
}

/**
 * {@link eraseRectsFromPoints} for a whole stroke, each piece keeping the
 * stroke's style and `shape` as {@link eraseCircleFromStroke}'s do.
 */
export function eraseRectsFromStroke(
  stroke: Stroke,
  rects: readonly EraseRect[],
  nextId: () => string,
): Stroke[] | null {
  const pieces = eraseRectsFromPoints(stroke.pts, stroke.size, rects);
  return pieces === null ? null : pieces.map((pts) => pieceOf(stroke, pts, nextId));
}

/** A surviving piece of `stroke`, drawn as it was. */
function pieceOf(stroke: Stroke, pts: number[], nextId: () => string): Stroke {
  const piece: Stroke = {
    id: nextId(),
    color: stroke.color,
    size: stroke.size,
    tool: stroke.tool,
    pts,
  };
  if (stroke.t0 !== undefined) piece.t0 = stroke.t0;
  if (stroke.shape !== undefined) piece.shape = stroke.shape;
  // A piece is drawn as its shape was: dashed, its corners as round. Not
  // filled (a piece is open) and without heads (its ends are new).
  if (stroke.dash !== undefined) piece.dash = stroke.dash;
  if (stroke.radius !== undefined) piece.radius = stroke.radius;
  // A piece of a note's ink stays on the note.
  if (stroke.onSticky !== undefined) piece.onSticky = stroke.onSticky;
  // A piece of calligraphy keeps its flat nib. A shape is drawn at one width.
  if (stroke.nib !== undefined && stroke.shape === undefined) piece.nib = stroke.nib;
  return piece;
}

function inside(r: EraseRect, x: number, y: number): boolean {
  return x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY;
}

/**
 * Where segment A→B lies inside any of the rectangles, as sorted, merged
 * spans of its parameter t in [0, 1] (Liang-Barsky per rectangle). A span
 * that only grazes a corner (zero length) counts as outside, as the circle's
 * graze does; a segment of zero length is inside wholly or not at all.
 */
function insideSpans(
  rects: readonly EraseRect[],
  ax: number,
  ay: number,
  bx: number,
  by: number,
): Array<[number, number]> {
  const dx = bx - ax;
  const dy = by - ay;
  const spans: Array<[number, number]> = [];
  for (const r of rects) {
    if (dx === 0 && dy === 0) {
      if (inside(r, ax, ay)) return [[0, 1]];
      continue;
    }
    let lo = 0;
    let hi = 1;
    for (const [d, from, min, max] of [
      [dx, ax, r.minX, r.maxX],
      [dy, ay, r.minY, r.maxY],
    ]) {
      if (d === 0) {
        if (from < min || from > max) hi = -1;
        continue;
      }
      const t1 = (min - from) / d;
      const t2 = (max - from) / d;
      lo = Math.max(lo, Math.min(t1, t2));
      hi = Math.min(hi, Math.max(t1, t2));
    }
    if (lo < hi) spans.push([lo, hi]);
  }
  spans.sort((p, q) => p[0] - q[0]);
  const merged: Array<[number, number]> = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push([span[0], span[1]]);
  }
  return merged;
}

function polylineLength(pts: readonly number[]): number {
  let length = 0;
  for (let i = POINT_STRIDE; i + 1 < pts.length; i += POINT_STRIDE) {
    length += Math.hypot(pts[i] - pts[i - POINT_STRIDE], pts[i + 1] - pts[i + 1 - POINT_STRIDE]);
  }
  return length;
}
