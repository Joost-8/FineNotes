/**
 * GoodNotes 6's pen gestures, less the geometry of the scribble (that is
 * `scribble.ts`): the switches, and the loop Circle to Lasso reads.
 *
 * Pure: no DOM, no Obsidian.
 *
 * - **Scribble to erase**: scribble over writing with the pen to erase it.
 * - **Erase shapes and highlighter**: the scribble takes shapes, tables and
 *   highlighter ink too, not only handwriting.
 * - **Circle to lasso**: draw a loop round something with the pen, then hold
 *   the pen on the loop; the loop goes and what it enclosed is selected, to
 *   be moved at once. The hold is what makes it safe: a loop drawn round a
 *   word to mark it stays ink unless it is held.
 */

import { POINT_STRIDE } from "../model/document";

export interface PenGestures {
  scribbleErase: boolean;
  /** "Erase shapes and highlighter": only while {@link scribbleErase} is on. */
  scribbleErasesAll: boolean;
  circleLasso: boolean;
}

/** GoodNotes' defaults, less the extra reach of the scribble: handwriting only. */
export const DEFAULT_PEN_GESTURES: Readonly<PenGestures> = {
  scribbleErase: true,
  scribbleErasesAll: false,
  circleLasso: true,
};

/** The switches from anything read off disk; a missing or bad one is its default. */
export function penGesturesOf(raw: unknown): PenGestures {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const flag = (key: keyof PenGestures): boolean => {
    const value = o[key];
    return typeof value === "boolean" ? value : DEFAULT_PEN_GESTURES[key];
  };
  return {
    scribbleErase: flag("scribbleErase"),
    scribbleErasesAll: flag("scribbleErasesAll"),
    circleLasso: flag("circleLasso"),
  };
}

/**
 * A loop's gap may be this share of its bounding box's diagonal, or the
 * caller's tolerance, whichever is larger. Looser than the shape
 * recogniser's 10 %: nothing happens to a loop until the pen is held on it.
 */
export const LOOP_GAP_SHARE = 0.2;
/** A loop's enclosed area, over its bounding box's: a circle is 0.79, a triangle 0.5. */
export const LOOP_MIN_FILL = 0.15;
/**
 * And over its diagonal squared, so a sliver does not pass as a loop: a line
 * drawn and gone back over 2 px aside fills half its thin box. A 10:1 oval
 * round a line of writing is 0.08.
 */
export const LOOP_MIN_AREA = 0.02;

/**
 * The loop a stroke draws round something, as a flat `[x, y, …]` polygon,
 * or `null` when it does not close on itself. The stroke must come back to
 * where it started (within `closeTolerance` page px, or a share of its size
 * for a large loop); a tail past that point, where the pen overshot, is left
 * off. A retraced line or a zigzag encloses too little to count.
 */
export function gestureLoopOf(pts: readonly number[], closeTolerance: number): number[] | null {
  const usable = pts.length - (pts.length % POINT_STRIDE);
  const xy: number[] = [];
  for (let i = 0; i < usable; i += POINT_STRIDE) {
    const x = pts[i];
    const y = pts[i + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const m = xy.length;
    if (m > 0 && xy[m - 2] === x && xy[m - 1] === y) continue;
    xy.push(x, y);
  }
  const n = xy.length / 2;
  if (n < 3) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const along = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, xy[2 * i]);
    maxX = Math.max(maxX, xy[2 * i]);
    minY = Math.min(minY, xy[2 * i + 1]);
    maxY = Math.max(maxY, xy[2 * i + 1]);
    if (i > 0) {
      along[i] =
        along[i - 1] + Math.hypot(xy[2 * i] - xy[2 * i - 2], xy[2 * i + 1] - xy[2 * i - 1]);
    }
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const diagonal = Math.hypot(w, h);
  if (!(diagonal > 0)) return null;

  // Where the second half of the stroke comes closest to its start.
  const half = along[n - 1] / 2;
  let end = -1;
  let gap = Infinity;
  for (let i = n - 1; i > 0 && along[i] >= half; i--) {
    const d = Math.hypot(xy[2 * i] - xy[0], xy[2 * i + 1] - xy[1]);
    if (d < gap) {
      gap = d;
      end = i;
    }
  }
  if (end < 2 || gap > Math.max(closeTolerance, LOOP_GAP_SHARE * diagonal)) return null;
  const loop = xy.slice(0, 2 * (end + 1));

  let twiceArea = 0;
  for (let i = 0, j = loop.length - 2; i < loop.length; j = i, i += 2) {
    twiceArea += loop[j] * loop[i + 1] - loop[i] * loop[j + 1];
  }
  const area = Math.abs(twiceArea) / 2;
  if (area < LOOP_MIN_FILL * w * h || area < LOOP_MIN_AREA * diagonal * diagonal) return null;
  return loop;
}
