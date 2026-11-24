/**
 * Where known text written in the writer's hand goes on a page: a corrected
 * word in place of the old one, typed text flowed into lines, a calculation's
 * answer after its "=". The writing itself comes from the writer model
 * (`view/neaten.ts`, `writeKnown`): each line in model units, its words
 * stood level (`rows.levelledStrokes`).
 *
 * Sizes are the model's calibration (`layout.MODEL_X_HEIGHT`), not each
 * line's own measure: on the real model a single word measured 2.2 times its
 * true size and whole lines 0.9 to 1.6 (gen/write_in_hand_check.mts), while
 * the calibration matched the writer's own letters (20 px against 20.2).
 *
 * PURE: no DOM, no Obsidian.
 */

import { ASKED_LEVEL_SLOPE, type LineGeometry, measureLines } from "../../ink/tidy";
import type { PageInk } from "../hwr/lines";
import { MODEL_X_HEIGHT } from "./layout";
import { median } from "./rows";
import type { WrittenStroke } from "./rows";

/** The pressure written ink is given when the writer's own is not known. */
export const KNOWN_PRESSURE = 0.5;
/** The most characters the model is given as one line (its training lines were about this long). */
export const MAX_LINE_CHARS = 40;
/**
 * The least distance between written lines, in x-heights: closer, an
 * ascender meets the descender above it (a practice sheet measured 2.2).
 */
export const MIN_LINE_PITCH = 3;
/**
 * A written line of this many words or more is sized by its own measure too;
 * a shorter one's measure is noise (a single word read 2.2 times its size).
 */
export const MEASURED_WORDS = 3;
/** How far a line's own measure may move it from the calibrated size. */
export const LINE_SPREAD = 1.3;

/** One written word: strokes of x, y, pressure in page px, x from its left edge, y from its baseline (down). */
export interface WrittenWord {
  strokes: number[][];
  width: number;
}

/** Characters the model may lack, written as the ones it has. */
const PLAIN: ReadonlyMap<string, string> = new Map([
  ["“", '"'],
  ["”", '"'],
  ["„", '"'],
  ["«", '"'],
  ["»", '"'],
  ["‘", "'"],
  ["’", "'"],
  ["‚", "'"],
  ["–", "-"],
  ["—", "-"],
  ["−", "-"],
  ["…", "..."],
  [" ", " "],
  ["\t", " "],
]);

/**
 * `text` in characters the model writes: typographic quotes, dashes and
 * ellipses as plain ones, runs of spaces as one, each line trimmed. `missing`
 * lists the characters still not writable, once each, in order.
 */
export function writableText(
  text: string,
  writes: (ch: string) => boolean,
): { text: string; missing: string[] } {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) =>
      Array.from(line)
        .map((ch) => PLAIN.get(ch) ?? ch)
        .join("")
        .replace(/ {2,}/g, " ")
        .trim(),
    );
  const out = lines.join("\n");
  const missing: string[] = [];
  for (const ch of out) {
    if (ch === "\n" || ch === " " || writes(ch) || missing.includes(ch)) continue;
    missing.push(ch);
  }
  return { text: out, missing };
}

/**
 * A Markdown text box's text as it reads, without its marks: headings and
 * quotes lose their `#` and `>`, a task's box goes (its dash stays, as a
 * bullet is written), bold, italic, strike and code lose their marks, a link
 * is its words (a wiki link its alias, else its target).
 */
export function plainMarkdown(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/^\s*>\s?/, "")
        .replace(/^(\s*[-*+])\s+\[[ xX]\]\s+/, "$1 ")
        .replace(/^(\s*)[*+](\s+)/, "$1-$2")
        .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
        .replace(/\[\[([^\]]+)\]\]/g, "$1")
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/(\*\*|__)(.+?)\1/g, "$2")
        .replace(/~~(.+?)~~/g, "$1")
        .replace(/==(.+?)==/g, "$1")
        .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,;:!?]|$)/g, "$1$2")
        .replace(/`([^`]+)`/g, "$1"),
    )
    .join("\n");
}

/**
 * A line of text cut, at spaces, into pieces of at most `max` characters,
 * each written as one line by the model. A word longer than `max` is a
 * piece of its own.
 */
export function chunkLine(line: string, max = MAX_LINE_CHARS): string[] {
  const out: string[] = [];
  let cur = "";
  for (const word of line.split(" ").filter((w) => w !== "")) {
    if (cur && cur.length + 1 + word.length > max) {
      out.push(cur);
      cur = word;
    } else cur = cur ? `${cur} ${word}` : word;
  }
  if (cur) out.push(cur);
  return out;
}

/** Every `step`-th value from `at` of a flat x, y, … array. */
function every(pts: ArrayLike<number>, at: number, step: number): number[] {
  const out: number[] = [];
  for (let i = at; i < pts.length; i += step) out.push(pts[i]);
  return out;
}

/** A written line in page px (y down) at the model's calibrated size for `xHeight`. */
function scaledLine(line: readonly WrittenStroke[], xHeight: number): PageInk[] {
  const unit = xHeight / MODEL_X_HEIGHT;
  return line.map((s, j) => {
    const pts: number[] = [];
    for (let i = 0; i + 1 < s.pts.length; i += 2)
      pts.push(s.pts[i] * unit, -s.pts[i + 1] * unit, KNOWN_PRESSURE);
    return { id: `k${j}`, tool: "pen", shape: null, t0: j, pts };
  });
}

/** The baseline fit of the line most of these strokes are on. */
function fitOf(strokes: readonly PageInk[]): LineGeometry | null {
  const fits = measureLines(strokes, ASKED_LEVEL_SLOPE);
  if (fits.length === 0) return null;
  return [...fits].sort((a, b) => b.strokes.length - a.strokes.length)[0];
}

/**
 * Written lines cut into words, each sized to the writer's `xHeight` and
 * stood on its own baseline (x from its left edge, y from the baseline).
 * The size is the model's calibration; a line of {@link MEASURED_WORDS} words
 * or more is evened out toward `xHeight` by its own measure, within
 * {@link LINE_SPREAD} (the model writes one line a third smaller than the
 * next). The line's fit gives the baseline.
 * Strokes the alignment gave no word (-1) go with the word before them.
 */
export function wordsOfLines(
  lines: readonly (readonly WrittenStroke[])[],
  xHeight: number,
  pressure = KNOWN_PRESSURE,
): WrittenWord[][] {
  const scaled = lines.map((line) => scaledLine(line, xHeight));
  const fits = scaled.map((made) => (made.length ? fitOf(made) : null));
  return lines.map((line, li) => {
    const made = scaled[li];
    if (made.length === 0) return [];
    const fit = fits[li];
    const words = new Set(line.map((s) => s.word).filter((w) => w >= 0)).size;
    const f =
      fit && fit.xHeight > 0 && words >= MEASURED_WORDS
        ? Math.min(LINE_SPREAD, Math.max(1 / LINE_SPREAD, xHeight / fit.xHeight))
        : 1;
    const lowest = Math.max(...made.flatMap((s) => every(s.pts, 1, 3)));
    const base = (x: number): number => (fit ? fit.slope * x + fit.level : lowest);
    // Strokes by word; a stroke of no word joins the word before it (or the first).
    const groups = new Map<number, number[][]>();
    let last = -1;
    line.forEach((s, j) => {
      const word = s.word >= 0 ? s.word : last >= 0 ? last : 0;
      if (s.word >= 0) last = s.word;
      const pts: number[] = [];
      const p = made[j].pts;
      for (let i = 0; i + 1 < p.length; i += 3) pts.push(p[i], p[i + 1] - base(p[i]), pressure);
      const list = groups.get(word) ?? [];
      list.push(pts);
      groups.set(word, list);
    });
    return [...groups.keys()]
      .sort((a, b) => a - b)
      .map((w) => {
        const strokes = groups.get(w) as number[][];
        const xs = strokes.flatMap((s) => every(s, 0, 3));
        const x0 = Math.min(...xs);
        const sized = strokes.map((s) =>
          s.map((v, i) => (i % 3 === 0 ? (v - x0) * f : i % 3 === 1 ? v * f : v)),
        );
        return { strokes: sized, width: (Math.max(...xs) - x0) * f };
      });
  });
}

/** Where flowed text may go on a page, page px. */
export interface FlowFrame {
  left: number;
  right: number;
  /** The first line's baseline. */
  top: number;
  /** Distance between baselines. */
  pitch: number;
  /** The lowest baseline allowed. */
  bottom: number;
  /** The writer's gap between words. */
  gap: number;
  /** Ruled paper: the rules' ys, which baselines are set on instead of `pitch` steps. */
  rules?: readonly number[];
  /**
   * Ink already on the page (boxes x0, y0, x1, y1): a line whose band, `up`
   * above and `down` below its baseline across the frame, meets one is
   * skipped, so written lines never land on it.
   */
  taken?: readonly { x0: number; y0: number; x1: number; y1: number }[];
  reach?: { up: number; down: number };
}

/** Text flowed into a frame: its strokes, the baselines used, and the words that did not fit. */
export interface Flowed {
  strokes: number[][];
  lines: number;
  /** Words left out below `bottom`. */
  left: number;
}

/**
 * Words flowed into `frame` as text is: each paragraph (a list of words; an
 * empty one is a blank line) starts on a new line, a word goes to the next
 * line when it would pass `right`, the writer's gap between words. On ruled
 * paper the lines are the rules at or below `top`. A word wider than the
 * frame has a line of its own. Lines never overlap: each is one step below
 * the last.
 */
export function flowWords(
  paragraphs: readonly (readonly WrittenWord[])[],
  frame: FlowFrame,
): Flowed {
  const rules = frame.rules
    ? [...frame.rules].filter((y) => y >= frame.top - 0.5).sort((a, b) => a - b)
    : null;
  const slotY = (n: number): number =>
    rules ? (rules[n] ?? Infinity) : frame.top + n * frame.pitch;
  const reach = frame.reach ?? { up: 0, down: 0 };
  const free = (y: number): boolean =>
    !(frame.taken ?? []).some(
      (b) =>
        b.x1 >= frame.left && b.x0 <= frame.right && b.y1 >= y - reach.up && b.y0 <= y + reach.down,
    );
  // The n-th line's slot: the first free one after the last line's.
  let slot = -1;
  const nextSlot = (): void => {
    slot++;
    while (slotY(slot) <= frame.bottom && !free(slotY(slot))) slot++;
  };
  nextSlot();
  const strokes: number[][] = [];
  let line = 0;
  let x = frame.left;
  let used = false;
  let left = 0;
  const total = paragraphs.reduce((n, p) => n + p.length, 0);
  let placed = 0;
  outer: for (const [pi, words] of paragraphs.entries()) {
    if (pi > 0) {
      line++;
      nextSlot();
      x = frame.left;
      used = false;
    }
    for (const word of words) {
      if (used && x + frame.gap + word.width > frame.right) {
        line++;
        nextSlot();
        x = frame.left;
        used = false;
      }
      const y = slotY(slot);
      if (!(y <= frame.bottom)) break outer;
      const at = used ? x + frame.gap : x;
      for (const s of word.strokes)
        strokes.push(s.map((v, i) => (i % 3 === 0 ? v + at : i % 3 === 1 ? v + y : v)));
      x = at + word.width;
      used = true;
      placed++;
    }
  }
  left = total - placed;
  return { strokes, lines: strokes.length ? line + 1 : 0, left };
}

/** A word on a page and its line: what a rewrite of it needs. */
export interface WordPlace {
  /** The line's baseline (y = slope * x + level) and x-height. */
  slope: number;
  level: number;
  xHeight: number;
  /** The word's own ink's left and right edge. */
  x0: number;
  x1: number;
  /** Strokes after it on the same line, which move with its new width. */
  after: string[];
}

/**
 * The line the word made of `wordIds` is on, among `strokes` (the page's
 * writing), and the strokes after it on that line. Null when the word is on
 * no measurable line.
 */
export function placeOfWord(
  strokes: readonly PageInk[],
  wordIds: ReadonlySet<string>,
): WordPlace | null {
  const own = strokes.filter((s) => wordIds.has(s.id));
  if (own.length === 0) return null;
  const xs = own.flatMap((s) => every(s.pts, 0, 3));
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const lines = measureLines(strokes, ASKED_LEVEL_SLOPE);
  let best: LineGeometry | null = null;
  let most = 0;
  for (const line of lines) {
    const n = line.strokes.filter((id) => wordIds.has(id)).length;
    if (n > most) {
      most = n;
      best = line;
    }
  }
  const byId = new Map(strokes.map((s) => [s.id, s]));
  if (!best) {
    // A word alone (too short to be a line): its own ink, level.
    const fit = fitOf(own);
    if (!fit) return null;
    return { slope: 0, level: fit.level, xHeight: fit.xHeight, x0, x1, after: [] };
  }
  const after = best.strokes.filter((id) => {
    if (wordIds.has(id)) return false;
    const sx = every(byId.get(id)?.pts ?? [], 0, 3);
    return sx.length > 0 && 0.5 * (Math.min(...sx) + Math.max(...sx)) > x1;
  });
  return { slope: best.slope, level: best.level, xHeight: best.xHeight, x0, x1, after };
}

/**
 * A written word put where the old one was: from its left edge, on the
 * line's baseline (sloped with it). `shift` is how far the strokes after it
 * move so the gap after the word stays as it was.
 */
export function placeWord(
  word: WrittenWord,
  at: WordPlace,
): { strokes: number[][]; shift: number } {
  const strokes = word.strokes.map((s) =>
    s.map((v, i, all) => {
      if (i % 3 === 0) return v + at.x0;
      if (i % 3 === 1) {
        const x = all[i - 1] + at.x0;
        return at.slope * x + at.level + v;
      }
      return v;
    }),
  );
  return { strokes, shift: at.x0 + word.width - at.x1 };
}

/**
 * A written number (one line from the model, model units) as an answer
 * after "=": from `at.x`, its figures `at.height` tall on `at.baseline`,
 * page px, one array of x, y, pressure per stroke. The figures' height is
 * measured on the strokes at least 40 % of the written ink's height (marks
 * such as "." "," "-" are smaller); their feet are its baseline.
 */
export function placeAnswer(
  line: readonly WrittenStroke[],
  at: { x: number; baseline: number; height: number },
  pressure = KNOWN_PRESSURE,
): number[][] {
  const strokes = line.map((s) => ({ xs: every(s.pts, 0, 2), ys: every(s.pts, 1, 2) }));
  const all = strokes.flatMap((s) => s.ys);
  if (all.length === 0) return [];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const tall = strokes.filter(
    (s) => s.ys.length > 0 && Math.max(...s.ys) - Math.min(...s.ys) >= 0.4 * (hi - lo),
  );
  const feet = median(tall.map((s) => Math.min(...s.ys)));
  const top = Math.max(...tall.flatMap((s) => s.ys));
  const scale = top - feet > 0 ? at.height / (top - feet) : 1;
  const x0 = Math.min(...strokes.flatMap((s) => s.xs));
  return strokes
    .filter((s) => s.xs.length > 0)
    .map((s) => {
      const pts: number[] = [];
      for (let i = 0; i < s.xs.length; i++)
        pts.push(at.x + (s.xs[i] - x0) * scale, at.baseline - (s.ys[i] - feet) * scale, pressure);
      // A single point is a dot: give it a second, so it draws.
      if (pts.length === 3) pts.push(pts[0] + 0.01, pts[1], pressure);
      return pts;
    });
}

/** Whether an answer may be written by the writer model: plain numbers only, never symbolic maths. */
export function numericAnswer(text: string): boolean {
  return /^-?\$?[0-9][0-9.,]*%?$/.test(text) || /^-?\$?\.[0-9]+%?$/.test(text);
}
