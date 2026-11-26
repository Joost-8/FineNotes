/**
 * A written line made straight without redrawing a letter (Beautify).
 *
 * The writer model copies a hand and already evens its letter sizes and
 * spacing; what it leaves is words running up or down, letters bobbing on
 * the line and letters leaning unevenly (research log, 25 November 2026).
 * Two passes take those out, each moving whole pieces of ink by one affine
 * change, so the letter shapes stay the writer's:
 *
 * - **Words.** A word whose feet run up or down is turned flat about the
 *   middle of its feet, and every word is set on the line's level. Always
 *   done in full.
 * - **Units.** A unit is the ink written without lifting the pen, together
 *   with every other stroke of the same letters (a t's bar, an i's dot). Each
 *   is lifted or lowered toward its word's foot line and leaned toward the
 *   line's own median lean, a share `strength` of the way (Beautify's
 *   neatness slider). Joined letters are one unit, so a joined hand has a
 *   unit a word and this pass leaves it as the first made it.
 *
 * Pen-up moves between the pieces take up the difference; no stroke is
 * bent, scaled or parted from its letter. A line too short to measure (under
 * two letters with ink) comes back as it was.
 *
 * A port of research/handwriting-rig/gen/pretty.py (`straighten` with
 * "level" and "tilt", `straighten_letters`, `_rebuild`), checked against its
 * rows on four written lines (tests/recognition/writer/fixtures/straighten.json).
 *
 * PURE: no DOM, no Obsidian.
 */

import {
  type Letter,
  POINTS,
  byWord,
  centreOf,
  charsOf,
  feetOf,
  hasStem,
  isFoot,
  isStemLetter,
  lettersOf,
  slopeOf,
  xHeightOf,
} from "./evenness";
import { ROW, type Rows, curvePoints, isUp, median } from "./rows";

/** A word is never turned by more than this (rise over run). */
export const WORD_TILT = 0.25;
/** A unit is never lifted or lowered by more than this many x-heights. */
export const UNIT_LIFT = 0.4;
/** ... nor leaned by more than this (tangent). */
export const UNIT_LEAN = 0.3;

/** One piece's change: `p -> a (p - o) + o + shift`, with `a` as [xx, xy, yx, yy]. */
interface Frame {
  a: [number, number, number, number];
  ox: number;
  oy: number;
  dx: number;
  dy: number;
}

const clip = (v: number, limit: number): number => Math.min(limit, Math.max(-limit, v));

/**
 * The rows after every frame went through its own change. `frame[i]` is the
 * frame of inked row i. A pen-up move ends where the next inked row's frame
 * puts that point, so frames stay whole and the moves between them take up
 * the difference.
 */
function rebuild(r: Rows, frame: Int32Array, frames: Map<number, Frame>): Float32Array {
  const { start, end } = curvePoints(r, 1);
  const known = [...frames.keys()].sort((a, b) => a - b);
  const near = (w: number): Frame => {
    const hit = frames.get(w);
    if (hit) return hit;
    let best = known[0];
    for (const k of known) if (Math.abs(k - w) < Math.abs(best - w)) best = k;
    return frames.get(best) as Frame;
  };
  const place = (x: number, y: number, w: number): [number, number] => {
    const f = near(w);
    const px = x - f.ox;
    const py = y - f.oy;
    return [f.a[0] * px + f.a[1] * py + f.ox + f.dx, f.a[2] * px + f.a[3] * py + f.oy + f.dy];
  };
  // The frame of the next inked row, for each row.
  const next = new Int32Array(r.n).fill(-1);
  let after = -1;
  for (let i = r.n - 1; i >= 0; i--) {
    if (!isUp(r.x, i)) after = frame[i];
    next[i] = after;
  }
  const out = Float32Array.from(r.x);
  let prev = isUp(r.x, 0) ? (next[0] >= 0 ? next[0] : known[0]) : frame[0];
  let [posX, posY] = place(start[0], start[1], prev);
  for (let i = 0; i < r.n; i++) {
    const o = i * ROW;
    let dx: number;
    let dy: number;
    if (isUp(r.x, i)) {
      const [tx, ty] = place(end[i * 2], end[i * 2 + 1], next[i] >= 0 ? next[i] : prev);
      dx = tx - posX;
      dy = ty - posY;
      // A pen-up row is a straight move: arms at a third (`rows.calm`).
      out[o] = dx;
      out[o + 1] = dy;
      out[o + 2] = dx / 3;
      out[o + 3] = dy / 3;
      out[o + 4] = -dx / 3;
      out[o + 5] = -dy / 3;
    } else {
      prev = frame[i];
      const { a } = near(prev);
      dx = a[0] * r.x[o] + a[1] * r.x[o + 1];
      dy = a[2] * r.x[o] + a[3] * r.x[o + 1];
      for (const q of [0, 2, 4]) {
        out[o + q] = a[0] * r.x[o + q] + a[1] * r.x[o + q + 1];
        out[o + q + 1] = a[2] * r.x[o + q] + a[3] * r.x[o + q + 1];
      }
    }
    posX += dx;
    posY += dy;
  }
  return out;
}

/** The word of the text each character is in; a space belongs to the word before it. */
function wordsAt(text: string): number[] {
  let spaces = 0;
  return charsOf(text).map((c) => (c === " " ? spaces++ : spaces));
}

/** Every word turned flat and set on the line's level. */
function straightenWords(r: Rows, char: ArrayLike<number>, text: string): Float32Array | null {
  const letters = lettersOf(r, char, text);
  if (letters.length < 2) return null;
  const { xh } = xHeightOf(letters);
  const { pts } = curvePoints(r, POINTS);
  const at = wordsAt(text);
  const frame = new Int32Array(r.n);
  for (let i = 0; i < r.n; i++) frame[i] = at[Math.min(Math.max(char[i], 0), at.length - 1)] ?? 0;
  const words = byWord(letters);
  const lineFeet = feetOf(letters);
  const level = lineFeet.length ? median(lineFeet.map((q) => q.y0)) : 0;
  const frames = new Map<number, Frame>();
  const standing = new Map<number, boolean>();
  for (const [w, v] of words) {
    const feet = feetOf(v);
    const foot = feet.length ? median(feet.map((q) => q.y0)) : null;
    let tilt = 0;
    if (feet.length >= 3) {
      const fx = feet.map(centreOf);
      if (Math.max(...fx) - Math.min(...fx) >= 1.5 * xh) {
        tilt = clip(
          slopeOf(
            fx,
            feet.map((q) => q.y0),
          ),
          WORD_TILT,
        );
      }
    }
    // The word turns about the middle of its feet, so turning it flat does not lift or lower it.
    const ox = feet.length
      ? feet.reduce((s, q) => s + centreOf(q), 0) / feet.length
      : Math.min(...v.map((q) => q.x0));
    const oy = foot ?? Math.min(...v.map((q) => q.y0));
    frames.set(w, { a: [1, 0, -tilt, 1], ox, oy, dx: 0, dy: 0 });
    standing.set(w, foot !== null);
  }
  // Where each word goes: its gap to the word before kept, its foot on the line's level.
  let before: { newEnd: number; oldEnd: number } | null = null;
  let lastLift = 0;
  for (const w of [...words.keys()].sort((a, b) => a - b)) {
    const f = frames.get(w) as Frame;
    const v = words.get(w) as Letter[];
    // The change keeps every x, so the word's extent along the line is its ink's.
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < r.n; i++) {
      if (frame[i] !== w || isUp(r.x, i)) continue;
      for (let j = 0; j < POINTS; j++) {
        const x = pts[(i * POINTS + j) * 2];
        lo = Math.min(lo, x);
        hi = Math.max(hi, x);
      }
    }
    const oldStart = Math.min(...v.map((q) => q.x0));
    const oldEnd = Math.max(...v.map((q) => q.x1));
    const want = before ? before.newEnd + (oldStart - before.oldEnd) : oldStart;
    if (standing.get(w)) lastLift = level - f.oy;
    f.dx = want - lo;
    f.dy = lastLift;
    before = { newEnd: hi + f.dx, oldEnd };
  }
  return rebuild(r, frame, frames);
}

/** Every pen-lift unit lifted toward its word's foot line and leaned toward the line's lean, a share of the way. */
function straightenUnits(
  r: Rows,
  char: ArrayLike<number>,
  text: string,
  strength: number,
): Float32Array | null {
  const letters = lettersOf(r, char, text);
  if (letters.length < 2) return null;
  const { xh } = xHeightOf(letters);
  // Units: inked rows joined when they follow each other without a lift, or belong to one character.
  const parent = Int32Array.from({ length: r.n }, (_, i) => i);
  const find = (i: number): number => {
    let at = i;
    while (parent[at] !== at) {
      parent[at] = parent[parent[at]];
      at = parent[at];
    }
    return at;
  };
  const firstRow = new Map<number, number>();
  for (let i = 0; i < r.n; i++) {
    if (isUp(r.x, i)) continue;
    if (i > 0 && !isUp(r.x, i - 1)) parent[find(i)] = find(i - 1);
    const first = firstRow.get(char[i]);
    if (first === undefined) firstRow.set(char[i], i);
    else parent[find(i)] = find(first);
  }
  const unit = new Int32Array(r.n).fill(-1);
  for (let i = 0; i < r.n; i++) if (!isUp(r.x, i)) unit[i] = find(i);
  const inUnit = new Map<number, Letter[]>();
  for (const q of letters) {
    const u = unit[firstRow.get(q.i) as number];
    const list = inUnit.get(u);
    if (list) list.push(q);
    else inUnit.set(u, [q]);
  }
  const wordFoot = new Map<number, number>();
  for (const [w, v] of byWord(letters)) {
    const feet = feetOf(v);
    if (feet.length >= 2) wordFoot.set(w, median(feet.map((q) => q.y0)));
  }
  const stems = letters.filter((q) => hasStem(q, xh)).map((q) => q.lean / q.vlen);
  const leanTo = stems.length ? median(stems) : null;
  const frames = new Map<number, Frame>();
  for (const u of new Set(unit)) {
    if (u < 0) continue;
    const v = inUnit.get(u) ?? [];
    // A unit of only f z J Q (or g j p q y) is not lifted: where its bottom should be is not known.
    const feet = v.filter(isFoot).map((q) => q.y0);
    const foot = feet.length ? median(feet) : v.length ? Math.min(...v.map((q) => q.y0)) : 0;
    const cx = v.length
      ? 0.5 * (Math.min(...v.map((q) => q.x0)) + Math.max(...v.map((q) => q.x1)))
      : 0;
    let lift = 0;
    let lean = 0;
    const target = v.length ? wordFoot.get(v[0].word) : undefined;
    if (feet.length && target !== undefined)
      lift = clip((target - foot) * strength, UNIT_LIFT * xh);
    if (leanTo !== null) {
      const upright = v.filter(isStemLetter);
      const vlen = upright.reduce((s, q) => s + q.vlen, 0);
      if (vlen >= 0.8 * xh) {
        const own = upright.reduce((s, q) => s + q.lean, 0) / vlen;
        lean = clip((leanTo - own) * strength, UNIT_LEAN);
      }
    }
    frames.set(u, { a: [1, lean, 0, 1], ox: cx, oy: foot, dx: 0, dy: lift });
  }
  return frames.size ? rebuild(r, unit, frames) : null;
}

/**
 * The written line `r` of `text` made straight (`char`: the character of the
 * text each row was written for): words flat and level in full, then every
 * pen-lift unit a share `strength` (0 to 1) of the way to its word's foot
 * line and to the line's lean. The same object when the line is too short
 * to measure or has no alignment.
 */
export function straighten<R extends Rows>(
  r: R,
  char: ArrayLike<number> | null,
  text: string,
  strength: number,
): R {
  if (char === null || char.length !== r.n || r.n === 0) return r;
  const words = straightenWords(r, char, text);
  if (!words) return r;
  let out: R = { ...r, x: words };
  if (strength > 0) {
    const units = straightenUnits(out, char, text, Math.min(1, strength));
    if (units) out = { ...out, x: units };
  }
  return out;
}
