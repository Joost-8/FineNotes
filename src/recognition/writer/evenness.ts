/**
 * How even a written line looks, measured from its curve rows and the
 * character each row was written for: the letters' feet against their word,
 * the spread of the small letters' heights, of the lean, of the gaps between
 * letters and between words. In x-heights and degrees; lower is more even.
 *
 * Beautify uses it for two things: between two tries a reader reads equally
 * well, the more even one is kept (`repair.neatenLine`), and `straighten.ts`
 * reads the same letters to know where a word stands and how it leans.
 *
 * {@link unevenness} is one number: the mean of the five parts, each over
 * what ordinary writers' own lines measure ({@link EVENNESS_SCALE}), so 1.0
 * is an ordinary writer's line. It knows nothing of letter shapes: a line of
 * even scribble scores well, so it only ever breaks a tie the reader left.
 *
 * A port of research/handwriting-rig/gen/pretty.py (`letters_of`,
 * `x_height`, `feet_of`, `measure`, `ugly`), checked against its numbers on
 * four written lines (tests/recognition/writer/fixtures/straighten.json).
 *
 * PURE: no DOM, no Obsidian.
 */

import { type Rows, curvePoints, isUp, median } from "./rows";

/** Points taken along each curve. */
export const POINTS = 8;
/** The model's x-height in curve units, for a line with no small letter to measure. */
export const FALLBACK_X_HEIGHT = 0.39;
/** The parts of {@link unevenness}. */
export const EVENNESS_PARTS = ["base", "size", "slant", "spacing", "gap"] as const;
/**
 * What the own ink of 72 writers the model never saw measures (283 lines;
 * research log, 25 November 2026): the unit of each part.
 */
export const EVENNESS_SCALE: Record<(typeof EVENNESS_PARTS)[number], number> = {
  base: 0.221,
  size: 0.311,
  slant: 5.878,
  spacing: 0.574,
  gap: 0.223,
};

/** Small letters whose height is the x-height. */
const X_LETTERS = new Set("acemnorsuvwxz");
/** Letters that go under the line. */
const DESCENDERS = new Set("gjpqy");
/** Letters under the line in many joined hands: a foot only when a word has no other. */
const MAY_DESCEND = new Set("fzJQ");
/** Letters with an upright stroke: the lean is read from these, not from the diagonals of k v w x y z. */
const STEMS = new Set("bdfhijlmnprtquBDFHIJLPRTU1");

/** One character of the text that has ink. */
export interface Letter {
  /** Its place in the text (code points). */
  i: number;
  c: string;
  /** The word of the text it is in. */
  word: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Length of its near-upright ink. */
  vlen: number;
  /** That ink's run to the right while going up: `lean / vlen` is the tangent of the lean. */
  lean: number;
}

/** The text's characters (code points), as the model counts them. */
export function charsOf(text: string): string[] {
  return Array.from(text);
}

function isAlnum(c: string): boolean {
  return /^[\p{L}\p{N}]$/u.test(c);
}

/** Every character with ink: its box, its word, and how its upright ink leans. */
export function lettersOf(r: Rows, char: ArrayLike<number>, text: string): Letter[] {
  const { pts } = curvePoints(r, POINTS);
  const rowsOf = new Map<number, number[]>();
  for (let row = 0; row < r.n; row++) {
    if (isUp(r.x, row)) continue;
    const list = rowsOf.get(char[row]);
    if (list) list.push(row);
    else rowsOf.set(char[row], [row]);
  }
  const out: Letter[] = [];
  let word = 0;
  charsOf(text).forEach((c, i) => {
    if (c === " ") {
      word++;
      return;
    }
    const rows = rowsOf.get(i);
    if (!rows) return;
    const q: Letter = {
      i,
      c,
      word,
      x0: Infinity,
      x1: -Infinity,
      y0: Infinity,
      y1: -Infinity,
      vlen: 0,
      lean: 0,
    };
    for (const row of rows) {
      for (let j = 0; j < POINTS; j++) {
        const o = (row * POINTS + j) * 2;
        const x = pts[o];
        const y = pts[o + 1];
        q.x0 = Math.min(q.x0, x);
        q.x1 = Math.max(q.x1, x);
        q.y0 = Math.min(q.y0, y);
        q.y1 = Math.max(q.y1, y);
        if (j === 0) continue;
        const dx = x - pts[o - 2];
        const dy = y - pts[o - 1];
        if (Math.abs(dy) > Math.abs(dx)) {
          q.vlen += Math.abs(dy);
          q.lean += dx * Math.sign(dy);
        }
      }
    }
    out.push(q);
  });
  return out;
}

/** The line's x-height, and whether it was measured (two small letters or more). */
export function xHeightOf(letters: readonly Letter[]): { xh: number; known: boolean } {
  const h = letters.filter((q) => X_LETTERS.has(q.c)).map((q) => q.y1 - q.y0);
  return h.length >= 2
    ? { xh: Math.max(0.05, median(h)), known: true }
    : { xh: FALLBACK_X_HEIGHT, known: false };
}

/** Whether the letter's bottom says where its word stands, whatever the hand. */
export function isFoot(q: Letter): boolean {
  return isAlnum(q.c) && !DESCENDERS.has(q.c) && !MAY_DESCEND.has(q.c);
}

/** The letters whose bottoms say where a word (or a line) stands: those that never go under the line, else f z J Q. */
export function feetOf(letters: readonly Letter[]): Letter[] {
  const strict = letters.filter(isFoot);
  return strict.length ? strict : letters.filter((q) => MAY_DESCEND.has(q.c));
}

/** Whether the letter has an upright stroke long enough to read its lean from. */
export function hasStem(q: Letter, xh: number): boolean {
  return STEMS.has(q.c) && q.vlen >= 0.8 * xh;
}

/** Whether the letter is one whose upright ink counts toward a word's or a unit's lean. */
export function isStemLetter(q: Letter): boolean {
  return STEMS.has(q.c);
}

/** The middle of a letter along the line. */
export function centreOf(q: Letter): number {
  return 0.5 * (q.x0 + q.x1);
}

/** The letters by word, words in the order they are written. */
export function byWord(letters: readonly Letter[]): Map<number, Letter[]> {
  const words = new Map<number, Letter[]>();
  for (const q of letters) {
    const list = words.get(q.word);
    if (list) list.push(q);
    else words.set(q.word, [q]);
  }
  return words;
}

/** The slope of the least-squares line through the points (0 when they stand over one x). */
export function slopeOf(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) * (xs[i] - mx);
  }
  return sxx > 0 ? sxy / sxx : 0;
}

function mean(v: readonly number[]): number {
  let s = 0;
  for (const x of v) s += x;
  return s / v.length;
}

/** numpy's `std`: of the whole, not of a sample. */
function spread(v: readonly number[]): number {
  const m = mean(v);
  return Math.sqrt(mean(v.map((x) => (x - m) * (x - m))));
}

const degrees = (tangent: number): number => (Math.atan(tangent) * 180) / Math.PI;

/** A line's evenness; a part the line is too short to show is NaN. */
export interface Evenness {
  /** Words above or below the line through the words (Beautify's levelling removes it; not in the one number). */
  step: number;
  /** Letters' feet against their own word's foot. */
  base: number;
  /** A word's feet running up or down, in degrees (mostly inside `base`; not in the one number). */
  tilt: number;
  /** Spread of the small letters' heights (std of log height). */
  size: number;
  /** Spread of the letters' lean, in degrees. */
  slant: number;
  /** Spread of the gaps between neighbouring letters of a word. */
  spacing: number;
  /** Spread of the gaps between words (std / mean). */
  gap: number;
}

/** How even the written line `r` of `text` is (`char`: the character of the text each row was written for). */
export function evennessOf(r: Rows, char: ArrayLike<number>, text: string): Evenness {
  const m: Evenness = {
    step: NaN,
    base: NaN,
    tilt: NaN,
    size: NaN,
    slant: NaN,
    spacing: NaN,
    gap: NaN,
  };
  const letters = lettersOf(r, char, text);
  if (letters.length < 3) return m;
  const { xh } = xHeightOf(letters);
  const words = byWord(letters);
  // Words against the line, letters against their word.
  const standing = [...words]
    .map(([w, v]) => ({ w, feet: feetOf(v) }))
    .filter((s) => s.feet.length);
  const foot = new Map(standing.map((s) => [s.w, median(s.feet.map((q) => q.y0))]));
  const off: number[] = [];
  for (const s of standing) {
    if (s.feet.length < 2) continue;
    for (const q of s.feet) off.push(q.y0 - (foot.get(s.w) as number));
  }
  if (off.length >= 3) m.base = Math.sqrt(mean(off.map((v) => v * v))) / xh;
  if (standing.length >= 3) {
    const cx = standing.map((s) => mean(s.feet.map(centreOf)));
    const cy = standing.map((s) => foot.get(s.w) as number);
    const a = slopeOf(cx, cy);
    const b = mean(cy) - a * mean(cx);
    m.step = spread(cy.map((y, i) => y - (a * cx[i] + b))) / xh;
  }
  const tilts: number[] = [];
  for (const s of standing) {
    const fx = s.feet.map(centreOf);
    if (s.feet.length >= 3 && Math.max(...fx) - Math.min(...fx) >= 1.5 * xh) {
      tilts.push(
        Math.abs(
          degrees(
            slopeOf(
              fx,
              s.feet.map((q) => q.y0),
            ),
          ),
        ),
      );
    }
  }
  if (tilts.length) m.tilt = mean(tilts);
  const heights = letters.filter((q) => X_LETTERS.has(q.c) && q.y1 > q.y0).map((q) => q.y1 - q.y0);
  if (heights.length >= 3) m.size = spread(heights.map(Math.log));
  const leans = letters.filter((q) => hasStem(q, xh)).map((q) => degrees(q.lean / q.vlen));
  if (leans.length >= 3) m.slant = spread(leans);
  const between: number[] = [];
  for (const v of words.values()) {
    const inked = v.filter((q) => isAlnum(q.c));
    for (let i = 1; i < inked.length; i++) {
      if (inked[i].i === inked[i - 1].i + 1) between.push((inked[i].x0 - inked[i - 1].x1) / xh);
    }
  }
  if (between.length >= 3) m.spacing = spread(between);
  const order = [...words.keys()].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < order.length; i++) {
    const a = words.get(order[i - 1]) as Letter[];
    const b = words.get(order[i]) as Letter[];
    gaps.push((Math.min(...b.map((q) => q.x0)) - Math.max(...a.map((q) => q.x1))) / xh);
  }
  if (gaps.length >= 2 && mean(gaps) > 0.1) m.gap = spread(gaps) / mean(gaps);
  return m;
}

/**
 * One number for a line: 1.0 is an ordinary writer's own line, lower is more
 * even. NaN when under two parts show (a line of a word or two).
 */
export function unevenness(m: Evenness): number {
  const v = EVENNESS_PARTS.map((k) => m[k] / EVENNESS_SCALE[k]).filter(Number.isFinite);
  return v.length >= 2 ? mean(v) : NaN;
}

/** What {@link roughness} gives a line too short to measure: every try of it ties. */
export const UNMEASURED = 9;

/**
 * A written line's {@link unevenness} as a number that always compares: what
 * picks between two tries a reader reads equally well (`repair.neatenLine`).
 */
export function roughness(r: Rows, char: ArrayLike<number>, text: string): number {
  const u = unevenness(evennessOf(r, char, text));
  return Number.isFinite(u) ? u : UNMEASURED;
}
