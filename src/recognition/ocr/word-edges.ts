/**
 * Snapping the words of a recognised line to the ink they were read from.
 *
 * CTC says roughly where each character is (its peak), not where its glyph
 * ends, so a word's extent from the characters alone is off by a fraction of
 * a character at both ends. The crop itself shows the truth: printed words
 * are separated by columns with no ink. Between two words the widest
 * ink-free gap is their boundary; the first word starts, and the last ends,
 * where the ink of its first and last character does. Where the crop shows
 * nothing clear (low contrast, noise, a scribble) the estimate stays.
 *
 * PURE: no DOM, no Obsidian.
 */

import type { CropLine } from "./ctc-words";
import { REC_HEIGHT } from "./rec";

/** Rows of the crop looked at: not its very edge, where the next line may reach in. */
const ROW_FROM = 3;
const ROW_TO = REC_HEIGHT - 3;
/** A crop whose ink and paper differ by less than this (in -1..1 units) is not snapped. */
const MIN_CONTRAST = 0.5;
/** An edge is moved at most this many character pitches from where the characters put it. */
const MAX_MOVE = 1.5;
/** An ink-free gap narrower than this (px) is not a word gap. */
const MIN_GAP = 2;
/** Words are widened by this on the outside, px: the glyphs' side bearings. */
const BEARING = 1;

/**
 * Which columns of the crop (`3 x REC_HEIGHT x width`, -1..1, BGR planes; the
 * first is used) hold ink, or null when it has too little contrast to say.
 */
export function inkColumns(data: Float32Array, width: number): Uint8Array | null {
  const mins = new Float32Array(width);
  let lo = Infinity;
  const column = new Float32Array(width * (ROW_TO - ROW_FROM));
  let n = 0;
  for (let x = 0; x < width; x++) {
    let min = Infinity;
    for (let y = ROW_FROM; y < ROW_TO; y++) {
      const v = data[y * width + x];
      column[n++] = v;
      if (v < min) min = v;
    }
    mins[x] = min;
    if (min < lo) lo = min;
  }
  // Paper: the bulk of the crop's values.
  column.sort();
  const hi = column[Math.floor(column.length * 0.8)];
  if (hi - lo < MIN_CONTRAST) return null;
  const mid = (hi + lo) / 2;
  const ink = new Uint8Array(width);
  for (let x = 0; x < width; x++) ink[x] = mins[x] < mid ? 1 : 0;
  return ink;
}

/** The ink-free runs `[from, to)` of `ink` inside `[a, b)`. */
function gaps(ink: Uint8Array, a: number, b: number): [number, number][] {
  const out: [number, number][] = [];
  let from = -1;
  for (let x = Math.max(0, a); x <= Math.min(ink.length, b); x++) {
    const free = x < Math.min(ink.length, b) && ink[x] === 0;
    if (free && from < 0) from = x;
    if (!free && from >= 0) {
      out.push([from, x]);
      from = -1;
    }
  }
  return out;
}

/** The edge of the ink run that holds, or is nearest, column `at`: its left end (`dir` -1) or right end (+1). */
function inkEdge(ink: Uint8Array, at: number, dir: -1 | 1, reach: number): number | null {
  const width = ink.length;
  let x = Math.min(width - 1, Math.max(0, Math.round(at)));
  let found = ink[x] === 1;
  for (let step = 1; !found && step <= reach; step++) {
    for (const c of [x - step, x + step]) {
      if (c >= 0 && c < width && ink[c] === 1) {
        x = c;
        found = true;
        break;
      }
    }
  }
  if (!found) return null;
  while (x + dir >= 0 && x + dir < width && ink[x + dir] === 1) x += dir;
  return dir < 0 ? x : x + 1;
}

/**
 * `line`'s words with their extents moved to the ink of `crop`. `pitch` is
 * the line's character pitch in px (it bounds how far an edge moves).
 */
export function snapWords(
  line: CropLine,
  data: Float32Array,
  width: number,
  pitch: number,
): CropLine {
  const ink = inkColumns(data, width);
  if (!ink || line.words.length === 0) return line;
  const words = line.words.map((w) => ({ ...w }));
  const limit = MAX_MOVE * pitch;
  const move = (was: number, to: number | null): number =>
    to !== null && Math.abs(to - was) <= limit ? to : was;
  // Between neighbours: the widest ink-free gap between their characters.
  for (let i = 1; i < words.length; i++) {
    const a = words[i - 1];
    const b = words[i];
    const from = a.last ?? a.x1 - pitch / 2;
    const to = b.first ?? b.x0 + pitch / 2;
    const best = gaps(ink, Math.floor(from), Math.ceil(to))
      .filter(([g0, g1]) => g1 - g0 >= MIN_GAP)
      .sort((p, q) => q[1] - q[0] - (p[1] - p[0]))[0];
    if (!best) continue;
    a.x1 = move(a.x1, best[0] + BEARING);
    b.x0 = move(b.x0, best[1] - BEARING);
    if (a.x1 > b.x0) a.x1 = b.x0 = (a.x1 + b.x0) / 2;
  }
  const first = words[0];
  const last = words[words.length - 1];
  const left = inkEdge(ink, first.first ?? first.x0 + pitch / 2, -1, pitch);
  if (left !== null && Math.abs(left - first.x0) <= limit) first.x0 = Math.max(0, left - BEARING);
  const right = inkEdge(ink, last.last ?? last.x1 - pitch / 2, 1, pitch);
  if (right !== null && Math.abs(right - last.x1) <= limit)
    last.x1 = Math.min(width, right + BEARING);
  for (const w of words) {
    if (!(w.x1 > w.x0)) return line;
  }
  return { ...line, words };
}
