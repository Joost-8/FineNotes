/**
 * Words Beautify leaves in the writer's own ink instead of writing them.
 *
 * Beautify writes every word Grape read that was not asked about, and the
 * read-back only checks the model's writing against Grape's own reading, so a
 * misread word is rewritten as a different word. Measured on 1,022 labelled
 * words of donated handwriting: 26 % of one-character words and 37 % of words
 * with a sureness under 0.5 were wrong among those that would be written,
 * against 13.6 % overall. Raised exponents are 2-D layout that neither the
 * reader nor the writer holds. So a word keeps the writer's ink when it is
 *
 * - "lone": one letter or digit at most (unless the writer asked for exactly
 *   that word);
 * - "raised": its ink ends in small raised ink, an exponent;
 * - "unsure": Grape's sureness of it is under `WRITE_UNASKED_FROM`.
 *
 * A word the writer answered about is never kept for these reasons.
 *
 * PURE: no DOM, no Obsidian.
 */

/** One stroke's bounding box, page px, y down. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A word the writer did not answer is written only when Grape's sureness of it (`wordSureness`) is at least this. */
export const WRITE_UNASKED_FROM = 0.5;

export type OwnInkReason = "lone" | "raised" | "unsure";

export interface OwnInkWord {
  text: string;
  sure: number;
  answered: boolean;
  raised: boolean;
}

/** Letters and digits in a word. */
function countAlnum(text: string): number {
  return (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
}

/** Why a word keeps the writer's ink, or null when it may be written. */
export function ownInkReason(
  word: OwnInkWord,
  options: { alone?: boolean } = {},
): OwnInkReason | null {
  if (word.answered) return null;
  if (!options.alone && countAlnum(word.text) <= 1) return "lone";
  if (word.raised) return "raised";
  if (word.sure < WRITE_UNASKED_FROM) return "unsure";
  return null;
}

/** `rewrite` with every word that has a reason set false. */
export function keepOwnInk(
  words: readonly OwnInkWord[],
  rewrite: readonly boolean[],
  options: { alone?: boolean } = {},
): boolean[] {
  return rewrite.map((r, i) => r && (!words[i] || ownInkReason(words[i], options) === null));
}

/** Whether a read word may end in an exponent: not after a closing quote, apostrophe, asterisk or degree sign. */
export function mayHoldExponent(text: string): boolean {
  const bare = text.replace(/[.,;:!?)]+$/u, "");
  return !/['"’”*°]$/u.test(bare);
}

/** The box of a stroke's points (x, y, pressure triples); null when it has none. */
export function strokeBox(pts: ArrayLike<number>): Box | null {
  if (pts.length < 3) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i + 1 < pts.length; i += 3) {
    x0 = Math.min(x0, pts[i]);
    x1 = Math.max(x1, pts[i]);
    y0 = Math.min(y0, pts[i + 1]);
    y1 = Math.max(y1, pts[i + 1]);
  }
  return { x0, y0, x1, y1 };
}

function joint(boxes: readonly Box[]): Box {
  return {
    x0: Math.min(...boxes.map((b) => b.x0)),
    y0: Math.min(...boxes.map((b) => b.y0)),
    x1: Math.max(...boxes.map((b) => b.x1)),
    y1: Math.max(...boxes.map((b) => b.y1)),
  };
}

/** Bottom edge of a raised stroke, in x-heights above the line, at least. */
const RAISED_FROM = 0.55;
/** An exponent's joint box: height between these (x-heights), at least `RAISED_WIDE` wide. */
const RAISED_TALL_MIN = 0.3;
const RAISED_TALL_MAX = 1.0;
const RAISED_WIDE = 0.25;
/** The raised ink may start this far left of the body's right edge (x-heights). */
const RAISED_OVERLAP = 0.5;
/** The body's top is at least this high above the line (x-heights). */
const BODY_TOP = 0.8;

/**
 * Whether a word's ink ends in small raised ink (an exponent). `strokes` are
 * the word's stroke boxes, `baseline(x)` the line's foot line (page y at x),
 * `xHeight` the line's x-height. R, the strokes whose bottom is at least 0.55
 * x-heights above the line, must be 0.3 to 1.0 x-heights tall and 0.25 wide as
 * a whole, start in the right half of the word and no further left than the
 * rest's right edge less half an x-height; the rest must rise 0.8 x-heights.
 */
export function raisedTail(
  strokes: readonly Box[],
  baseline: (x: number) => number,
  xHeight: number,
): boolean {
  if (!(xHeight > 0) || strokes.length < 2) return false;
  const above = (b: Box, y: number): number => (baseline((b.x0 + b.x1) / 2) - y) / xHeight;
  const raised = strokes.filter((b) => above(b, b.y1) >= RAISED_FROM);
  const body = strokes.filter((b) => above(b, b.y1) < RAISED_FROM);
  if (raised.length === 0 || body.length === 0) return false;
  const r = joint(raised);
  const b = joint(body);
  const all = joint(strokes);
  const tall = (r.y1 - r.y0) / xHeight;
  if (tall < RAISED_TALL_MIN || tall > RAISED_TALL_MAX) return false;
  if ((r.x1 - r.x0) / xHeight < RAISED_WIDE) return false;
  if (r.x0 < b.x1 - RAISED_OVERLAP * xHeight) return false;
  if (r.x0 < all.x0 + (all.x1 - all.x0) / 2) return false;
  return above(b, b.y0) >= BODY_TOP;
}

/** A line as Beautify holds it, for `ownInkRewrite`. */
export interface OwnInkLine {
  read: readonly string[];
  /** Each word's stroke ids. */
  words: readonly (readonly string[])[];
  sure: readonly number[];
  answered?: readonly boolean[];
  rewrite: readonly boolean[];
  xHeight: number | null;
}

/** Which words of a line end in raised ink; all false without an x-height or a line. */
export function raisedWords(
  line: Pick<OwnInkLine, "read" | "words" | "xHeight">,
  boxes: ReadonlyMap<string, Box>,
  baseline: ((x: number) => number) | null,
): boolean[] {
  return line.read.map((text, i) => {
    if (!baseline || !line.xHeight || !mayHoldExponent(text)) return false;
    const ink = (line.words[i] ?? []).flatMap((id) => boxes.get(id) ?? []);
    return raisedTail(ink, baseline, line.xHeight);
  });
}

/** The line's `rewrite` with the words that keep the writer's ink set false. */
export function ownInkRewrite(
  line: OwnInkLine,
  boxes: ReadonlyMap<string, Box>,
  baseline: ((x: number) => number) | null,
  options: { alone?: boolean } = {},
): boolean[] {
  const raised = raisedWords(line, boxes, baseline);
  const words = line.read.map((text, i) => ({
    text,
    sure: line.sure[i] ?? 0,
    answered: line.answered?.[i] ?? false,
    raised: raised[i],
  }));
  return keepOwnInk(words, line.rewrite, options);
}
