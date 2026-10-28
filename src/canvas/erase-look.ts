/**
 * How ink the Whole stroke or By line eraser is taking is drawn until the
 * pen lifts, with "Grey out while erasing" on (discussion #51, as Notability
 * does): in one faded grey, whatever its colour, so what will go shows
 * before it goes. Off, the eraser hides that ink instead.
 *
 * **PURE.** The grey is a stored colour like any ink's: a night page shows
 * it through `./night` while it is painted, so it reads on dark pages too
 * (the ledger's "A theme stored on a shared painter leaks").
 */

import { type EraseRect, insideSpans } from "../ink/stroke-eraser";
import { POINT_STRIDE, type Stroke } from "../model/document";

/** The grey ink being erased is drawn in: about 2.6:1 on white paper, 4.7:1 on night paper. */
export const ERASING_GREY = "#a0a0a0";

/**
 * Whether an erase in `mode` greys what it takes, with the switch `on`:
 * Whole stroke always, By line only on a page with lines (`lined`; without
 * them it erases as the standard eraser does), and never the standard
 * eraser, which shows its cut as it goes.
 */
export function erasesGrey(mode: string, lined: boolean, on: boolean): boolean {
  return on && (mode === "stroke" || (mode === "ruled" && lined));
}

/**
 * The stroke as it is drawn while being erased: in {@link ERASING_GREY},
 * its tool kept (a highlighter stays a translucent band), and a shape's
 * fill grey too, at the fill's own opacity. The stroke itself is untouched.
 */
export function erasingLook<T extends { color: string; fill?: string }>(stroke: T): T {
  const look = { ...stroke, color: ERASING_GREY };
  // A fill is `#rrggbb` or `#rrggbbaa` (`model/shape-style`); the alpha stays.
  if (stroke.fill !== undefined) look.fill = ERASING_GREY + stroke.fill.slice(7, 9);
  return look;
}

/**
 * The stretches of a polyline that the By line eraser's rectangles cut away:
 * the complement of `eraseRectsFromPoints`' pieces, with the same sideways
 * widening by half the stroke's width, so drawn grey they fill exactly the
 * gap the cut leaves. Each stretch has at least two points; a one-point
 * polyline inside a rectangle is returned as it is.
 */
export function erasedStretches(
  pts: readonly number[],
  strokeSize: number,
  rects: readonly EraseRect[],
): number[][] {
  const usable = pts.length - (pts.length % POINT_STRIDE);
  if (usable === 0 || rects.length === 0) return [];
  const pad = Math.max(0, strokeSize) / 2;
  const near = rects.map((r) => ({ ...r, minX: r.minX - pad, maxX: r.maxX + pad }));
  if (usable === POINT_STRIDE) {
    const [x, y] = pts;
    const hit = near.some((r) => x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY);
    return hit ? [pts.slice(0, POINT_STRIDE)] : [];
  }
  const out: number[][] = [];
  let current: number[] = [];
  const close = (): void => {
    if (current.length >= 2 * POINT_STRIDE) out.push(current);
    current = [];
  };
  const push = (a: number, b: number, t: number): void => {
    for (let k = 0; k < POINT_STRIDE; k++) current.push(pts[a + k] + (pts[b + k] - pts[a + k]) * t);
  };
  for (let a = 0; a + POINT_STRIDE < usable; a += POINT_STRIDE) {
    const b = a + POINT_STRIDE;
    const spans = insideSpans(near, pts[a], pts[a + 1], pts[b], pts[b + 1]);
    if (spans.length === 0) close();
    for (const [lo, hi] of spans) {
      // A stretch carries on from the last segment only if it ran to its end.
      if (lo > 0) close();
      if (current.length === 0) push(a, b, lo);
      push(a, b, hi);
      if (hi < 1) close();
    }
  }
  close();
  return out;
}

/**
 * {@link erasedStretches} as strokes in the cut stroke's style, to be drawn
 * grey beside its surviving pieces. Their ids are the stroke's own with a
 * suffix: they are never stored, so they take nothing from the id sequence.
 * Open pieces, so no fill and no arrowheads, as the surviving pieces.
 *
 * Where a stretch meets a surviving piece it is shortened by half the
 * stroke's width: the piece's round end already reaches that far into the
 * gap, and two translucent ends over each other (a highlighter's) would
 * print a darker dot at every joint.
 */
export function erasedPieces(stroke: Stroke, rects: readonly EraseRect[]): Stroke[] {
  const [x0, y0] = stroke.pts;
  const last = stroke.pts.length - (stroke.pts.length % POINT_STRIDE) - POINT_STRIDE;
  const [x1, y1] = [stroke.pts[last], stroke.pts[last + 1]];
  const half = stroke.size / 2;
  const stretches: number[][] = [];
  for (const stretch of erasedStretches(stroke.pts, stroke.size, rects)) {
    const end = stretch.length - POINT_STRIDE;
    // A stretch that holds the stroke's own end keeps its round cap there.
    const head = same(stretch[0], stretch[1], x0, y0) ? 0 : half;
    const tail = same(stretch[end], stretch[end + 1], x1, y1) ? 0 : half;
    const pts = stretch.length > POINT_STRIDE ? trimmed(stretch, head, tail) : stretch;
    if (pts) stretches.push(pts);
  }
  return stretches.map((pts, i) => {
    const piece: Stroke = {
      id: `${stroke.id}~erasing${i}`,
      color: stroke.color,
      size: stroke.size,
      tool: stroke.tool,
      pts,
    };
    // As the surviving pieces: calligraphy keeps its flat nib, a shape does not.
    if (stroke.nib !== undefined && stroke.shape === undefined) piece.nib = stroke.nib;
    if (stroke.shape !== undefined) piece.shape = stroke.shape;
    if (stroke.dash !== undefined) piece.dash = stroke.dash;
    if (stroke.radius !== undefined) piece.radius = stroke.radius;
    return piece;
  });
}

function same(ax: number, ay: number, bx: number, by: number): boolean {
  return Math.abs(ax - bx) < 1e-6 && Math.abs(ay - by) < 1e-6;
}

/** `pts` with `head` page px of its length cut off the start and `tail` off the end; null when none is left. */
function trimmed(pts: readonly number[], head: number, tail: number): number[] | null {
  const n = pts.length / POINT_STRIDE;
  const along = [0];
  for (let i = 1; i < n; i++) {
    const a = (i - 1) * POINT_STRIDE;
    const b = i * POINT_STRIDE;
    along.push(along[i - 1] + Math.hypot(pts[b] - pts[a], pts[b + 1] - pts[a + 1]));
  }
  const from = head;
  const to = along[n - 1] - tail;
  if (to <= from) return null;
  const at = (s: number): number[] => {
    let i = 0;
    while (i < n - 2 && along[i + 1] < s) i++;
    const span = along[i + 1] - along[i];
    const t = span > 0 ? (s - along[i]) / span : 0;
    const a = i * POINT_STRIDE;
    const b = a + POINT_STRIDE;
    return Array.from(
      { length: POINT_STRIDE },
      (_, k) => pts[a + k] + (pts[b + k] - pts[a + k]) * t,
    );
  };
  const out = at(from);
  for (let i = 1; i < n - 1; i++) {
    if (along[i] > from && along[i] < to)
      out.push(...pts.slice(i * POINT_STRIDE, (i + 1) * POINT_STRIDE));
  }
  out.push(...at(to));
  return out;
}
