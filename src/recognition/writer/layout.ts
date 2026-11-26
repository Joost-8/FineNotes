/**
 * Where a written line goes on the page (Neaten): research/handwriting-rig/
 * gen/neaten_demo.mts, which the 2026-11-24 demo settled in five runs.
 *
 * Each line is written in the model's units (`rows.levelledStrokes`, words
 * already stood level). Its size makes the rewritten words as wide, together,
 * as the writer's own were (a line with no such width falls back to Tidy's
 * x-height measure), held within 20 % of the factor the other lines got. It
 * stands at the original line's left edge, on the height the writer's line has at its
 * middle (moved only to clear the ink above and below it). Then its words are
 * laid out left to right with the word gap the writer left on that line; a
 * word that is not rewritten keeps the writer's own strokes, moved along the
 * line and onto its level. Nothing goes past the page's right edge: the gaps
 * narrow first, then the rightmost written words go back to the writer's ink. Tidy runs over the result afterwards (the caller's step).
 *
 * PURE: no DOM, no Obsidian.
 */

import { ASKED_LEVEL_SLOPE, type HandProfile, measureLines } from "../../ink/tidy";
import type { PageInk } from "../hwr/lines";
import { median } from "./rows";
import type { WrittenStroke } from "./rows";

/** The model's x-height in its own units, as calibrated on real ink (gen/geo_model_test.py). */
export const MODEL_X_HEIGHT = 0.389;
/** How far a line's size may stray from the other lines' (the demo's 20 %). */
export const SIZE_SPREAD = 1.2;
/** A piece of a word's ink this far (in word gaps) from the rest of it is not part of it. */
export const BODY_GAP = 0.5;
/** ... and never nearer than this (in x-heights): a gap between letters of one word. */
export const LETTER_REACH = 0.9;
/** How far the word gaps of a line may narrow (as a share of its own) before a written word goes back to ink. */
export const MIN_GAP_SHARE = 0.5;

/**
 * A word's own run of ink along the line: its strokes grouped where their x
 * ranges come within `reach` of each other, and the group with the most
 * points kept. The word ink of a reading can hold pieces from elsewhere on
 * the line (punctuation the text left out goes to a neighbour).
 */
export function bodyOf(
  ids: readonly string[],
  byId: ReadonlyMap<string, PageInk>,
  reach: number,
): string[] {
  const spans = ids
    .map((id) => {
      const x = every(byId.get(id)?.pts ?? [], 0);
      return { id, x0: Math.min(...x), x1: Math.max(...x), n: x.length };
    })
    .filter((s) => s.n > 0)
    .sort((a, b) => a.x0 - b.x0);
  const groups: { ids: string[]; x1: number; n: number }[] = [];
  for (const s of spans) {
    const last = groups[groups.length - 1];
    if (last && s.x0 - last.x1 <= reach) {
      last.ids.push(s.id);
      last.x1 = Math.max(last.x1, s.x1);
      last.n += s.n;
    } else groups.push({ ids: [s.id], x1: s.x1, n: s.n });
  }
  if (groups.length <= 1) return [...ids];
  const body = new Set(groups.reduce((a, b) => (b.n > a.n ? b : a)).ids);
  return ids.filter((id) => body.has(id));
}

/** One line to put back: the writer's strokes, its words, and what was written. */
export interface LineToPlace<S extends PageInk> {
  /** The line's own strokes, page px. */
  strokes: readonly S[];
  /** Each word of the text, as the ids of the strokes it was read from. */
  words: readonly (readonly string[])[];
  /** Per word: rewritten (true) or kept as written. */
  rewrite: readonly boolean[];
  /** Per word: answered by the writer on a card; such a word is the last to go back to ink at the page's edge. */
  answered?: readonly boolean[];
  /** The written line, model units (x right, y up), each stroke with its word. */
  written: readonly WrittenStroke[];
  /**
   * The x-heights to match (`x-height.ts`): the writer's on this line (page
   * px), the written line's (model units), and the least the model writes
   * legibly at (page px). With both measures the new words are written at
   * the writer's x-height, or at `least` when theirs is smaller.
   */
  xHeight?: { ink: number | null; written: number | null; least: number };
  /**
   * The page's other ink near this line (`clearanceFor`): the y (page px, down) of the lowest
   * ink above it and the highest below it. The level line stands where the written words
   * clear both. Absent, or null on a side: nothing to keep clear of there.
   */
  clear?: Clearance;
}

/** The y of the lowest foreign ink above a line and of the highest below it (page px, y down). */
export interface Clearance {
  above: number | null;
  below: number | null;
}

/** A box, page px, y down. */
export interface InkBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** The room the written words keep from other ink (x-heights). */
export const CLEAR_PAD = 0.25;

/**
 * What is above and below a line. `line` is the line's own box, `others` the boxes of ink
 * that is not part of it (nor of another line being placed), `baseline` the line's baseline
 * under its middle, `xHeight` the hand's. Only ink within the line's x-range, padded by an
 * x-height each side, counts. The line's body is its x-height band; a box is above when it
 * ends over the band's middle and reaches clearly over the band, below when it starts under
 * that middle and reaches clearly under the baseline. So ink that dips into the band still
 * counts (under the low end of a climbing line the line above sits lower than the band at
 * its middle), and a mark lying in the band (a full stop the line did not take) does not.
 */
export function clearanceOf(
  line: InkBox,
  others: readonly InkBox[],
  baseline: number,
  xHeight: number,
): Clearance {
  let above: number | null = null;
  let below: number | null = null;
  for (const b of others) {
    if (b.x1 < line.x0 - xHeight || b.x0 > line.x1 + xHeight) continue;
    const mid = baseline - 0.5 * xHeight;
    if (b.y1 <= mid && b.y0 < baseline - 1.25 * xHeight)
      above = above === null ? b.y1 : Math.max(above, b.y1);
    else if (b.y0 >= mid && b.y1 > baseline + 0.25 * xHeight)
      below = below === null ? b.y0 : Math.min(below, b.y0);
  }
  return { above, below };
}

/** `clearanceOf` for a line's strokes and the page's other strokes (the caller leaves out those in lines being placed). */
export function clearanceFor(
  line: readonly PageInk[],
  others: readonly PageInk[],
  xHeight: number,
): Clearance | undefined {
  const box = (s: PageInk): InkBox | null => {
    if (s.pts.length < 3) return null;
    const xs = every(s.pts, 0);
    const ys = every(s.pts, 1);
    return {
      x0: Math.min(...xs),
      x1: Math.max(...xs),
      y0: Math.min(...ys),
      y1: Math.max(...ys),
    };
  };
  const mine = line.map(box).filter((b): b is InkBox => b !== null);
  const home = homeOf(line);
  if (mine.length === 0 || !home) return undefined;
  const lineBox = {
    x0: Math.min(...mine.map((b) => b.x0)),
    x1: Math.max(...mine.map((b) => b.x1)),
    y0: 0,
    y1: 0,
  };
  const baseline = home.slope * 0.5 * (lineBox.x0 + lineBox.x1) + home.level;
  return clearanceOf(
    lineBox,
    others.map(box).filter((b): b is InkBox => b !== null),
    baseline,
    xHeight,
  );
}

/**
 * Where the level baseline `base` (the writer's own, at the middle of its line) moves to so
 * the written band (`top` above it, `depth` below it) keeps `pad` from the ink above and
 * below. Both sides known and one too close: the band is centred between them (when it
 * does not fit, the shortage is shared equally). One side: just far enough. Never outside
 * `range`, the writer's own baseline at the line's two ends.
 */
export function clearBaseline(
  base: number,
  band: { top: number; depth: number },
  clear: Clearance,
  pad: number,
  range: readonly [number, number],
): number {
  const { above, below } = clear;
  const tight = (y: number): boolean =>
    (above !== null && y - band.top < above + pad) ||
    (below !== null && y + band.depth > below - pad);
  let y = base;
  if (tight(y)) {
    if (above !== null && below !== null) y = 0.5 * (above + below + band.top - band.depth);
    else if (above !== null) y = above + pad + band.top;
    else if (below !== null) y = below - pad - band.depth;
  }
  return Math.min(Math.max(range[0], range[1]), Math.max(Math.min(range[0], range[1]), y));
}

/** A line put back. */
export interface PlacedLine {
  /** New strokes: x, y, pressure triples, page px; `word` is the word they write. */
  added: { pts: number[]; word: number }[];
  /** The writer's strokes that stay, and how far each moves: along the line, and up or down onto it. */
  kept: Map<string, { dx: number; dy: number }>;
  /** The writer's strokes the new ones replace. */
  removed: string[];
}

/** Every `step`-th value from `at`: a stroke's xs (at 0) or ys (at 1). */
function every(pts: ArrayLike<number>, at: number): number[] {
  const out: number[] = [];
  for (let i = at; i < pts.length; i += 3) out.push(pts[i]);
  return out;
}
const xsOf = (pts: ArrayLike<number>): number[] => every(pts, 0);

/** The baseline fit of the line most of these strokes are on. */
function homeOf(
  strokes: readonly PageInk[],
): { slope: number; level: number; xHeight: number } | null {
  // Found as Beautify finds them: a line climbing up to the asked slope is one line, not pieces.
  const fits = measureLines(strokes, ASKED_LEVEL_SLOPE);
  if (fits.length === 0) return null;
  return [...fits].sort((a, b) => b.strokes.length - a.strokes.length)[0];
}

function median3(pts: ArrayLike<number>, at: number): number {
  const v = every(pts, at);
  return v.length ? median(v) : 0.5;
}

/**
 * Put the lines back. `profile` is the writer's hand on this page (Tidy's
 * `measureHand`). A line with nothing rewritten is returned unchanged.
 * `pageWidth` (page px) is the edge nothing may be pushed past.
 */
export function placeLines<S extends PageInk>(
  lines: readonly LineToPlace<S>[],
  profile: HandProfile,
  pageWidth?: number,
): PlacedLine[] {
  const unit = profile.xHeight / MODEL_X_HEIGHT;
  const gap = profile.wordGap * profile.xHeight;
  // Model units to page px (y down), before sizing.
  const scaled = lines.map((line) =>
    line.written.map((s, j) => {
      const pts: number[] = [];
      for (let i = 0; i + 1 < s.pts.length; i += 2)
        pts.push(s.pts[i] * unit, -s.pts[i + 1] * unit, 0.5);
      return { id: `w${j}`, tool: "pen", shape: null, t0: j, pts, word: s.word };
    }),
  );
  const fits = scaled.map((made) => (made.length ? homeOf(made) : null));
  // Each word's own run of ink: pieces the reading gave it from elsewhere on the line
  // (the commas of "March, April, May," given to "June") are loose ink instead. A gap
  // inside a word is at most about a letter wide, whatever this page's word gap measures
  // (one short line measures a word gap of half an x-height: 24 November, Joost's iPad).
  const reach = Math.max(BODY_GAP * gap, LETTER_REACH * profile.xHeight);
  const bodies = lines.map((line) => {
    const byId = new Map(line.strokes.map((s) => [s.id, s]));
    return line.words.map((ids) => bodyOf(ids, byId, reach));
  });
  // Size: the written words take the room the writer's own took (their widths summed).
  // A height measure fails on a hand with tall t's and long loops: it read Joost's
  // x-height as 20 px where his letters are 12, and the words came out half again too big.
  const raw = lines.map((line, li) => {
    const byId = new Map(line.strokes.map((s) => [s.id, s]));
    let his = 0;
    let made = 0;
    line.words.forEach((_, w) => {
      if (!line.rewrite[w]) return;
      const own = bodies[li][w].flatMap((id) => xsOf(byId.get(id)?.pts ?? []));
      const out = scaled[li].filter((s) => s.word === w).flatMap((s) => xsOf(s.pts));
      if (own.length === 0 || out.length === 0) return;
      his += Math.max(...own) - Math.min(...own);
      made += Math.max(...out) - Math.min(...out);
    });
    if (his > 0 && made > 0) return his / made;
    const fit = fits[li];
    return fit && fit.xHeight > 0 ? profile.xHeight / fit.xHeight : null;
  });
  const known = raw.filter((f): f is number => f !== null);
  const pageF = known.length ? median(known) : 1;
  // Best of all, the size of the writer's own words: their x-height on this line, measured
  // on x-height letters only (Joost, 25 November), and never under what the model writes
  // legibly. Exact, so not held to the other lines.
  const exact = lines.map((line) => {
    const x = line.xHeight;
    if (!x || x.ink === null || x.written === null || x.written <= 0) return null;
    return Math.max(x.ink, x.least) / (x.written * unit);
  });
  return lines.map((line, li) => {
    const made = scaled[li];
    const still = (): PlacedLine => ({
      added: [],
      kept: new Map(line.strokes.map((s) => [s.id, { dx: 0, dy: 0 }])),
      removed: [],
    });
    if (!line.rewrite.some(Boolean) || made.length === 0) return still();
    const f =
      exact[li] ?? Math.min(pageF * SIZE_SPREAD, Math.max(pageF / SIZE_SPREAD, raw[li] ?? pageF));
    const fit = fits[li];
    const home = homeOf(line.strokes);
    const allX = line.strokes.flatMap((s) => xsOf(s.pts));
    const left = Math.min(...allX);
    // The level line stands at the height the writer's line has at its middle (at its left end
    // a climbing line is lowest, and the level line landed on the page's next line of ink:
    // Beautify on "I'm the captain", 26 November), moved only to clear the ink above and
    // below the line (`line.clear`), and never outside the line's own climb.
    const right = Math.max(...allX);
    const middle = 0.5 * (left + right);
    let baseY = home
      ? home.slope * middle + home.level
      : Math.max(...line.strokes.flatMap((s) => every(s.pts, 1)));
    if (home && line.clear) {
      let top = 0;
      let depth = 0;
      for (const s of made.filter((m) => line.rewrite[m.word]))
        for (let i = 0; i < s.pts.length; i += 3) {
          const rel = (s.pts[i + 1] - (fit ? fit.slope * s.pts[i] + fit.level : 0)) * f;
          top = Math.max(top, -rel);
          depth = Math.max(depth, rel);
        }
      baseY = clearBaseline(baseY, { top, depth }, line.clear, CLEAR_PAD * profile.xHeight, [
        home.slope * left + home.level,
        home.slope * right + home.level,
      ]);
    }
    // A kept word stands on the written words' level line: lifted by where the writer's own
    // line was under its middle ("B-214." stayed above a tilted line, 25 November).
    const lift = (mid: number): number => (home ? baseY - (home.slope * mid + home.level) : 0);
    const gl = Math.min(...made.flatMap((s) => xsOf(s.pts)));
    const pressure = median(line.strokes.map((s) => median3(s.pts, 2)));
    // The written words, sized and stood on the writer's baseline.
    const placed = made.map((s) => {
      const pts: number[] = [];
      for (let i = 0; i < s.pts.length; i += 3) {
        const x = s.pts[i];
        const y = s.pts[i + 1];
        const base = fit ? fit.slope * x + fit.level : 0;
        pts.push(left + (x - gl) * f, baseY + (y - base) * f, pressure);
      }
      return { pts, word: s.word };
    });
    // Words left to right, each as one unit: written strokes, or the writer's own.
    const byId = new Map(line.strokes.map((s) => [s.id, s]));
    const words = bodies[li];
    // The word gap of this line as the writer left it (between their own words), else the page's.
    const spans = words.flatMap((ids) => {
      const xs = ids.flatMap((id) => xsOf(byId.get(id)?.pts ?? []));
      return xs.length ? [{ x0: Math.min(...xs), x1: Math.max(...xs) }] : [];
    });
    const gaps = spans
      .slice(1)
      .map((s, i) => s.x0 - spans[i].x1)
      .filter((g) => g > 0);
    const lineGap = gaps.length ? median(gaps) : gap;
    // Nothing goes past the page's edge (less an x-height), unless the writer's own line did.
    const limit =
      pageWidth === undefined ? Infinity : Math.max(pageWidth - profile.xHeight, Math.max(...allX));
    const rewrite = [...line.rewrite];
    const arrange = (share: number) => {
      const units: { word: number; written: boolean; x0: number; x1: number }[] = [];
      words.forEach((ids, w) => {
        const xs = rewrite[w]
          ? placed.filter((s) => s.word === w).flatMap((s) => xsOf(s.pts))
          : ids.flatMap((id) => xsOf(byId.get(id)?.pts ?? []));
        if (xs.length)
          units.push({ word: w, written: rewrite[w], x0: Math.min(...xs), x1: Math.max(...xs) });
      });
      // Between two kept words the writer's own gap stays: the reading may split one written
      // word in two ("prepen dS"), and a word gap opened there would split it on the page.
      const shift = new Map<number, number>();
      let right = -Infinity;
      let prev: (typeof units)[number] | null = null;
      for (const u of units) {
        const space = prev && !prev.written && !u.written ? u.x0 - prev.x1 : lineGap * share;
        const s = right === -Infinity ? left - u.x0 : right + space - u.x0;
        shift.set(u.word, s);
        right = u.x1 + s;
        prev = u;
      }
      return { units, shift, right };
    };
    // Written words wider than the writer's push the line right. Past the page's edge, the
    // gaps narrow (to half); past it still, the rightmost written word goes back to the
    // writer's own ink (one they answered on a card last), until the line fits.
    let laid = arrange(1);
    while (laid.right > limit) {
      const tight = arrange(MIN_GAP_SHARE);
      if (tight.right <= limit) {
        const wide = laid.right - tight.right;
        const share = wide > 0 ? 1 - ((1 - MIN_GAP_SHARE) * (laid.right - limit)) / wide : 1;
        laid = arrange(Math.max(MIN_GAP_SHARE, Math.min(1, share)));
        break;
      }
      // Words the writer answered on a card go back last.
      let last = -1;
      for (let w = rewrite.length - 1; w >= 0 && last < 0; w--) {
        if (rewrite[w] && !line.answered?.[w]) last = w;
      }
      if (last < 0) last = rewrite.lastIndexOf(true);
      if (last < 0) break;
      rewrite[last] = false;
      laid = arrange(1);
    }
    if (!rewrite.some(Boolean)) return still();
    const { units, shift } = laid;
    const added = placed
      .filter((s) => s.word >= 0 && rewrite[s.word] && shift.has(s.word))
      .map((s) => {
        const dx = shift.get(s.word) as number;
        return { pts: s.pts.map((v, i) => (i % 3 === 0 ? v + dx : v)), word: s.word };
      });
    const rewritten = new Set(words.flatMap((ids, w) => (rewrite[w] ? ids : [])));
    const kept = new Map<string, { dx: number; dy: number }>();
    const midOf = (ids: readonly string[]): number => {
      const xs = ids.flatMap((id) => xsOf(byId.get(id)?.pts ?? []));
      return xs.length ? 0.5 * (Math.min(...xs) + Math.max(...xs)) : left;
    };
    words.forEach((ids, w) => {
      if (rewrite[w]) return;
      const move = { dx: shift.get(w) ?? 0, dy: lift(midOf(ids)) };
      for (const id of ids) kept.set(id, move);
    });
    // Ink the reading gave no word (a comma, a stray dot) moves with the word to its left,
    // keeping its distance from that word's end (the first word's start, before it).
    const ends = words.flatMap((ids, w) => {
      const own = ids.flatMap((id) => xsOf(byId.get(id)?.pts ?? []));
      const unit = units.find((u) => u.word === w);
      if (!own.length || !unit) return [];
      const s = shift.get(w) ?? 0;
      return [{ x0: Math.min(...own), x1: Math.max(...own), n0: unit.x0 + s, n1: unit.x1 + s }];
    });
    for (const s of line.strokes) {
      if (rewritten.has(s.id) || kept.has(s.id)) continue;
      const x = xsOf(s.pts);
      const mid = x.length ? 0.5 * (Math.min(...x) + Math.max(...x)) : 0;
      const before = ends.filter((e) => e.x1 <= mid).sort((a, b) => b.x1 - a.x1)[0];
      const after = ends.filter((e) => e.x1 > mid).sort((a, b) => a.x0 - b.x0)[0];
      const dx = before ? before.n1 - before.x1 : after ? after.n0 - after.x0 : 0;
      kept.set(s.id, { dx, dy: lift(mid) });
    }
    return { added, kept, removed: [...rewritten] };
  });
}
