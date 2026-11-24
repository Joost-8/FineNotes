/**
 * Where a written line goes on the page (Neaten): research/handwriting-rig/
 * gen/neaten_demo.mts, which the 2026-11-24 demo settled in five runs.
 *
 * Each line is written in the model's units (`rows.levelledStrokes`, words
 * already stood level). Its size makes the rewritten words as wide, together,
 * as the writer's own were (a line with no such width falls back to Tidy's
 * x-height measure), held within 20 % of the factor the other lines got. It
 * stands at the original line's left edge on its baseline. Then its words are
 * laid out left to right with the word gap the writer left on that line; a
 * word that is not rewritten keeps the writer's own strokes, moved only along
 * the line. Tidy runs over the result afterwards (the caller's step).
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
  /** The written line, model units (x right, y up), each stroke with its word. */
  written: readonly WrittenStroke[];
}

/** A line put back. */
export interface PlacedLine {
  /** New strokes: x, y, pressure triples, page px; `word` is the word they write. */
  added: { pts: number[]; word: number }[];
  /** The writer's strokes that stay, and how far each moves along the line. */
  kept: Map<string, number>;
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
 */
export function placeLines<S extends PageInk>(
  lines: readonly LineToPlace<S>[],
  profile: HandProfile,
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
  return lines.map((line, li) => {
    const made = scaled[li];
    if (!line.rewrite.some(Boolean) || made.length === 0) {
      return { added: [], kept: new Map(line.strokes.map((s) => [s.id, 0])), removed: [] };
    }
    const f = Math.min(pageF * SIZE_SPREAD, Math.max(pageF / SIZE_SPREAD, raw[li] ?? pageF));
    const fit = fits[li];
    const home = homeOf(line.strokes);
    const allX = line.strokes.flatMap((s) => xsOf(s.pts));
    const left = Math.min(...allX);
    const baseY = home
      ? home.slope * left + home.level
      : Math.max(...line.strokes.flatMap((s) => every(s.pts, 1)));
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
    const units: { word: number; written: boolean; x0: number; x1: number }[] = [];
    words.forEach((ids, w) => {
      const xs = line.rewrite[w]
        ? placed.filter((s) => s.word === w).flatMap((s) => xsOf(s.pts))
        : ids.flatMap((id) => xsOf(byId.get(id)?.pts ?? []));
      if (xs.length)
        units.push({ word: w, written: line.rewrite[w], x0: Math.min(...xs), x1: Math.max(...xs) });
    });
    // Between two kept words the writer's own gap stays: the reading may split one written
    // word in two ("prepen dS"), and a word gap opened there would split it on the page.
    const shift = new Map<number, number>();
    let right = -Infinity;
    let prev: (typeof units)[number] | null = null;
    for (const u of units) {
      const space = prev && !prev.written && !u.written ? u.x0 - prev.x1 : lineGap;
      const s = right === -Infinity ? left - u.x0 : right + space - u.x0;
      shift.set(u.word, s);
      right = u.x1 + s;
      prev = u;
    }
    const added = placed
      .filter((s) => s.word >= 0 && line.rewrite[s.word] && shift.has(s.word))
      .map((s) => {
        const dx = shift.get(s.word) as number;
        return { pts: s.pts.map((v, i) => (i % 3 === 0 ? v + dx : v)), word: s.word };
      });
    const rewritten = new Set(words.flatMap((ids, w) => (line.rewrite[w] ? ids : [])));
    const kept = new Map<string, number>();
    words.forEach((ids, w) => {
      if (line.rewrite[w]) return;
      for (const id of ids) kept.set(id, shift.get(w) ?? 0);
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
      const left = ends.filter((e) => e.x1 <= mid).sort((a, b) => b.x1 - a.x1)[0];
      const right = ends.filter((e) => e.x1 > mid).sort((a, b) => a.x0 - b.x0)[0];
      kept.set(s.id, left ? left.n1 - left.x1 : right ? right.n0 - right.x0 : 0);
    }
    return { added, kept, removed: [...rewritten] };
  });
}
