/**
 * The x-height of handwriting, measured on its x-height letters only (a, c,
 * e, m, n, o, r, s, u, v, w, x, z): Beautify writes each rewritten word at
 * the x-height of the writer's own on that line (Joost, 25 November: "keep
 * it to the size of the text, or bigger if the model needs it").
 *
 * A measure over all the ink fails on a hand with tall t's and long loops:
 * Tidy's measure and Grape's core both read Joost's x-height as about 20 px
 * where his small letters are 12. Here only ink tied to an x-height letter
 * counts: on the writer's side the strokes Grape read as such letters and
 * nothing else, on the model's side the curves it wrote for them.
 *
 * PURE: no DOM, no Obsidian.
 */

import { POINTS_PER_CURVE, type Rows, curvePoints, isUp, median } from "./rows";

/** Letters with neither an ascender nor a descender, nor a dot. */
export const X_LETTERS: ReadonlySet<string> = new Set("acemnorsuvwxz");

/** Fewest letters (or strokes) a measure is trusted on. */
const MIN_SAMPLES = 2;

/**
 * The least x-height, in pen widths, the model's letters stay legible at:
 * below it the curves of an a or an e run into each other under the pen.
 */
export const LEAST_X_PER_PEN = 3;

/** The least x-height (page px) to write at with a pen `width` page px wide. */
export function leastXHeight(width: number): number {
  return Number.isFinite(width) && width > 0 ? LEAST_X_PER_PEN * width : 0;
}

/**
 * The writer's x-height in page px: the median height of the strokes that
 * Grape read as x-height letters only (a stroke shared with a t or a g is
 * left out). `chars` index into `strokes`, as a line reading's do. Null
 * when fewer than two such strokes are found.
 */
export function inkXHeight(
  strokes: readonly { pts: ArrayLike<number> }[],
  chars: readonly { char: string; strokes: readonly number[] }[],
): number | null {
  const letters = new Map<number, string[]>();
  for (const c of chars) {
    for (const i of c.strokes) letters.set(i, [...(letters.get(i) ?? []), c.char]);
  }
  const heights: number[] = [];
  for (const [i, of] of letters) {
    if (!of.every((ch) => X_LETTERS.has(ch))) continue;
    const pts = strokes[i]?.pts;
    if (!pts || pts.length < 6) continue;
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 1; k < pts.length; k += 3) {
      lo = Math.min(lo, pts[k]);
      hi = Math.max(hi, pts[k]);
    }
    if (hi > lo) heights.push(hi - lo);
  }
  return heights.length >= MIN_SAMPLES ? median(heights) : null;
}

/**
 * A written line's x-height in the model's units: the median height of the
 * curves it wrote for each x-height letter of `text` (`char`: the letter of
 * the text each row was written for). Null with fewer than two such letters.
 */
export function writtenXHeight(r: Rows, char: ArrayLike<number>, text: string): number | null {
  if (char.length !== r.n) return null;
  const { pts } = curvePoints(r, POINTS_PER_CURVE);
  const lo = new Map<number, number>();
  const hi = new Map<number, number>();
  for (let row = 0; row < r.n; row++) {
    const i = char[row];
    if (!X_LETTERS.has(text[i]) || isUp(r.x, row)) continue;
    for (let j = 0; j < POINTS_PER_CURVE; j++) {
      const y = pts[(row * POINTS_PER_CURVE + j) * 2 + 1];
      lo.set(i, Math.min(lo.get(i) ?? Infinity, y));
      hi.set(i, Math.max(hi.get(i) ?? -Infinity, y));
    }
  }
  const heights = [...lo.keys()]
    .map((i) => (hi.get(i) as number) - (lo.get(i) as number))
    .filter((h) => h > 0);
  return heights.length >= MIN_SAMPLES ? median(heights) : null;
}
