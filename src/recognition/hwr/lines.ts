/**
 * A page's writing split into lines and words: the port of `segment` in
 * research/handwriting-rig/ink.py (with `bands_by_time`, `merge_rows`,
 * `bands_by_height` and `words_in_bands`), so the recogniser reads the same
 * lines the rig measured.
 *
 * - Writing is pen ink that is not a snapped shape, without underlines,
 *   rules and diagram strokes (judged against the page's x-height).
 * - Lines: when every stroke has a start time, by following the pen (a
 *   stroke stays on the current line until the pen jumps back left or leaves
 *   the line's band), then rows the pen order split are joined; without
 *   times, by vertical overlap with each line's core band.
 * - Words: horizontal gaps wider than a threshold chosen per page, in
 *   x-heights. The recogniser reads whole lines; words are for later.
 *
 * PURE: no DOM, no Obsidian.
 */

import { median, npMean, percentileSorted, sorted } from "./numeric";

/** A page stroke as the recogniser needs it (a subset of the model's `Stroke`). */
export interface PageInk {
  readonly id: string;
  readonly tool: string;
  readonly shape?: string | null;
  readonly t0?: number | null;
  /** x, y, pressure, … in page space, y down. */
  readonly pts: ArrayLike<number>;
}

/** `[x0, y0, x1, y1]`. */
export type Box = [number, number, number, number];

export interface InkWord<S extends PageInk = PageInk> {
  strokes: S[];
  box: Box;
}

export interface InkLine<S extends PageInk = PageInk> {
  words: InkWord<S>[];
  box: Box;
  xHeight: number;
}

export interface PageLines<S extends PageInk = PageInk> {
  lines: InkLine<S>[];
  /** The word gap used, in x-heights. */
  wordGap: number;
}

interface Item<S> {
  s: S;
  box: Box;
}

function boxOf(pts: ArrayLike<number>): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i + 1 < pts.length; i += 3) {
    const x = pts[i];
    const y = pts[i + 1];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

function union(boxes: readonly Box[]): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b[0]);
    y0 = Math.min(y0, b[1]);
    x1 = Math.max(x1, b[2]);
    y1 = Math.max(y1, b[3]);
  }
  return [x0, y0, x1, y1];
}

/** Median height of the strokes taller than 1.5 px (dots left out), or 10. */
function xHeightOf(items: readonly Item<unknown>[]): number {
  const hs = items.map((it) => it.box[3] - it.box[1]).filter((h) => h > 1.5);
  return hs.length ? median(hs) : 10;
}

/** An underline or rule (long and flat), or a diagram stroke (much taller than writing). */
function isDrawing(box: Box, xh: number): boolean {
  const w = box[2] - box[0];
  const h = box[3] - box[1];
  return (w > 8 * xh && h < 0.8 * xh) || h > 4.5 * xh || (w > 4.5 * xh && h > 3 * xh);
}

const centreY = (b: Box): number => (b[1] + b[3]) / 2;
const centreX = (b: Box): number => (b[0] + b[2]) / 2;

/** The line's vertical centre near `x`: the median centre of its strokes within 6 x-heights. */
function localCy(line: readonly Item<unknown>[], x: number, xh: number): number {
  let near = line
    .filter((it) => Math.abs(centreX(it.box) - x) < 6 * xh)
    .map((it) => centreY(it.box));
  if (near.length === 0) near = line.slice(-5).map((it) => centreY(it.box));
  return median(near);
}

/**
 * Lines by following the pen. Each line's left and right edges are kept up to
 * date as strokes join it (the reference recomputes them; the result is the
 * same, without the quadratic cost on a full page).
 */
function bandsByTime<S extends PageInk>(items: readonly Item<S>[], xh: number): Item<S>[][] {
  const lines: Item<S>[][] = [];
  const left: number[] = [];
  const right: number[] = [];
  const join = (k: number, it: Item<S>): void => {
    lines[k].push(it);
    left[k] = Math.min(left[k], it.box[0]);
    right[k] = Math.max(right[k], it.box[2]);
  };
  let cur = -1;
  const byTime = [...items].sort((a, b) => (a.s.t0 as number) - (b.s.t0 as number));
  for (const it of byTime) {
    const [x0, , x1] = it.box;
    const xc = (x0 + x1) / 2;
    const cy = centreY(it.box);
    if (
      cur >= 0 &&
      x0 > right[cur] - 3 * xh &&
      Math.abs(cy - localCy(lines[cur], xc, xh)) < 1.0 * xh
    ) {
      join(cur, it);
      continue;
    }
    let best = -1;
    let bestD = 0.8 * xh;
    for (let k = 0; k < lines.length; k++) {
      if (left[k] - 2 * xh <= xc && xc <= right[k] + 6 * xh) {
        const d = Math.abs(cy - localCy(lines[k], xc, xh));
        if (d < bestD) {
          best = k;
          bestD = d;
        }
      }
    }
    if (best >= 0) {
      join(best, it);
      cur = best;
    } else {
      lines.push([it]);
      left.push(x0);
      right.push(x1);
      cur = lines.length - 1;
    }
  }
  return mergeRows(lines, left, right, xh);
}

/**
 * Join pieces of one row the pen order split (a bullet dash, a colon, a late
 * word): horizontally close, and their bands meet where they are nearest.
 * `left` and `right` are each line's edges, kept as lines merge.
 *
 * Each step joins the closest pair (the first in row-major order on a tie),
 * as the reference does by scanning every pair. Scanning every pair after
 * every join cost seconds on a page of scattered strokes (28 s for 2,000 on
 * a laptop; FineNotes#22), so each row keeps its closest partner, and a join
 * recomputes only the rows it touched. The joins, and so the lines, are the
 * same.
 */
function mergeRows<S>(
  input: Item<S>[][],
  left: number[],
  right: number[],
  xh: number,
): Item<S>[][] {
  const lines = input.map((l) => [...l]);
  const x0s = [...left];
  const x1s = [...right];
  const n = lines.length;
  // Rows keep their index; a joined row is no longer alive. Index order is
  // the reference's list order, since a join never reorders the rest.
  const alive = new Array<boolean>(n).fill(true);
  const bestDy = new Float64Array(n).fill(Infinity);
  const bestJ = new Int32Array(n).fill(-1);
  /** How far row j's band is from row i's where they are nearest; Infinity when they may not join. */
  const distance = (i: number, j: number): number => {
    const ax0 = x0s[i];
    const ax1 = x1s[i];
    const bx0 = x0s[j];
    const bx1 = x1s[j];
    const gap = Math.max(bx0 - ax1, ax0 - bx1);
    if (gap > 6 * xh) return Infinity;
    const ax = Math.min(Math.max(bx0, ax0), ax1);
    const bx = Math.min(Math.max(ax0, bx0), bx1);
    const b = lines[j];
    const dy = Math.abs(localCy(lines[i], ax, xh) - localCy(b, bx, xh));
    const small = b.length <= 3 && bx1 - bx0 < 3 * xh;
    const limit = (small ? 1.6 : 1.2) * xh;
    return dy < limit ? dy : Infinity;
  };
  /** Row i's closest partner, the first one on a tie. */
  const findBest = (i: number): void => {
    bestDy[i] = Infinity;
    bestJ[i] = -1;
    for (let j = 0; j < n; j++) {
      if (j === i || !alive[j]) continue;
      const d = distance(i, j);
      if (d < bestDy[i]) {
        bestDy[i] = d;
        bestJ[i] = j;
      }
    }
  };
  for (let i = 0; i < n; i++) findBest(i);
  for (;;) {
    let i = -1;
    for (let k = 0; k < n; k++) if (alive[k] && bestDy[k] < (i < 0 ? Infinity : bestDy[i])) i = k;
    if (i < 0) return lines.filter((_, k) => alive[k]);
    const j = bestJ[i];
    lines[i].push(...lines[j]);
    x0s[i] = Math.min(x0s[i], x0s[j]);
    x1s[i] = Math.max(x1s[i], x1s[j]);
    alive[j] = false;
    findBest(i);
    for (let k = 0; k < n; k++) {
      if (k === i || !alive[k]) continue;
      if (bestJ[k] === j) {
        findBest(k);
        continue;
      }
      const d = distance(k, i);
      if (bestJ[k] === i) {
        // Row i changed under its partners: still the closest only if no farther.
        if (d <= bestDy[k]) bestDy[k] = d;
        else findBest(k);
      } else if (d < bestDy[k] || (d === bestDy[k] && d < Infinity && i < bestJ[k])) {
        bestDy[k] = d;
        bestJ[k] = i;
      }
    }
  }
}

/** Without times: by vertical centre, each stroke joins the line whose core band it overlaps most. */
function bandsByHeight<S>(items: readonly Item<S>[], xh: number, lineOverlap: number): Item<S>[][] {
  const bands: Item<S>[][] = [];
  const bandBox: Box[] = [];
  for (const it of [...items].sort((a, b) => centreY(a.box) - centreY(b.box))) {
    const [x0, y0, x1, y1] = it.box;
    let best = -1;
    let bestOv = 0;
    bandBox.forEach((bb, i) => {
      const centre = (bb[1] + bb[3]) / 2;
      const core0 = centre - xh * 0.9;
      const core1 = centre + xh * 0.9;
      const ov = Math.min(y1, core1) - Math.max(y0, core0);
      const rel = ov / Math.max(1e-6, Math.min(y1 - y0, core1 - core0) || 1);
      if (rel > bestOv) {
        best = i;
        bestOv = rel;
      }
    });
    if (best >= 0 && bestOv >= lineOverlap) {
      bands[best].push(it);
      const b = bandBox[best];
      bandBox[best] = [
        Math.min(b[0], x0),
        Math.min(b[1], y0),
        Math.max(b[2], x1),
        Math.max(b[3], y1),
      ];
    } else {
      bands.push([it]);
      bandBox.push([x0, y0, x1, y1]);
    }
  }
  return bands;
}

function wordsInBands<S extends PageInk>(bands: Item<S>[][], wordGap: number): InkLine<S>[] {
  const startCy = (band: Item<S>[]): number => {
    let first = band[0];
    for (const it of band) if (it.box[0] < first.box[0]) first = it;
    return centreY(first.box);
  };
  const lines: InkLine<S>[] = [];
  for (const band of [...bands].sort((a, b) => startCy(a) - startCy(b))) {
    const lxh = xHeightOf(band);
    const groups: Item<S>[][] = [];
    let right = -Infinity;
    for (const it of [...band].sort((a, b) => a.box[0] - b.box[0])) {
      if (groups.length && it.box[0] - right <= wordGap * lxh) groups[groups.length - 1].push(it);
      else groups.push([it]);
      right = Math.max(...groups[groups.length - 1].map((g) => g.box[2]));
    }
    const words = groups.map((g) => ({
      strokes: g.map((x) => x.s),
      box: union(g.map((x) => x.box)),
    }));
    lines.push({ words, box: union(words.map((w) => w.box)), xHeight: lxh });
  }
  return lines;
}

/** Horizontal gaps between consecutive strokes of each line, in x-heights. */
function gapsOf(lines: readonly InkLine<PageInk>[]): number[] {
  const out: number[] = [];
  for (const line of lines) {
    const boxes = line.words.flatMap((w) => w.strokes.map((s) => boxOf(s.pts)));
    boxes.sort((a, b) => a[0] - b[0]);
    let right = -Infinity;
    for (const b of boxes) {
      if (right > -Infinity) out.push((b[0] - right) / line.xHeight);
      right = Math.max(right, b[2]);
    }
  }
  return out;
}

/**
 * Split stroke gaps into letter gaps and word gaps: two-means in log space,
 * threshold at the geometric midpoint of the two centres, clamped.
 */
export function autoWordGap(rawGaps: readonly number[], lo = 0.6, hi = 2.0): number {
  const g = rawGaps.filter((x) => x > 0.05).map((x) => Math.log(Math.min(Math.max(x, 0.05), 20)));
  if (g.length < 8) return 1.0;
  const s = sorted(g);
  let a = percentileSorted(s, 25);
  let b = percentileSorted(s, 85);
  for (let i = 0; i < 30; i++) {
    const cut = (a + b) / 2;
    const left = g.filter((v) => v <= cut);
    const right = g.filter((v) => v > cut);
    if (left.length === 0 || right.length === 0) break;
    a = npMean(left);
    b = npMean(right);
  }
  return Math.min(Math.max(Math.exp((a + b) / 2), lo), hi);
}

/** Pen strokes that could be writing: no highlighter, no snapped shapes, with points. */
function writingStrokes<S extends PageInk>(strokes: readonly S[]): Item<S>[] {
  return strokes
    .filter((s) => s.tool === "pen" && s.shape == null && s.pts.length >= 3)
    .map((s) => ({ s, box: boxOf(s.pts) }));
}

/** The page's writing in line bands (neither in reading order nor split into words yet). */
function bandsOf<S extends PageInk>(strokes: readonly S[], lineOverlap: number): Item<S>[][] {
  const all = writingStrokes(strokes);
  if (all.length === 0) return [];
  const xh = xHeightOf(all);
  const items = all.filter((it) => !isDrawing(it.box, xh));
  if (items.length === 0) return [];
  return items.every((it) => it.s.t0 != null)
    ? bandsByTime(items, xh)
    : bandsByHeight(items, xh, lineOverlap);
}

/**
 * `ink.segment`: the page's lines in reading order, each with its words.
 * `wordGap` (x-heights) is chosen from the page's own gaps unless given.
 * (The reference finds the bands twice, once to measure the gaps; they are
 * the same both times, so here they are found once.)
 */
export function segmentPage<S extends PageInk>(
  strokes: readonly S[],
  options: { wordGap?: number; lineOverlap?: number } = {},
): PageLines<S> {
  const bands = bandsOf(strokes, options.lineOverlap ?? 0.35);
  const wordGap = options.wordGap ?? autoWordGap(gapsOf(wordsInBands(bands, 1e9)));
  return { lines: wordsInBands(bands, wordGap), wordGap };
}

/** A line's strokes, word by word (the order the rig hands to `prepare_v2`). */
export function lineStrokes<S extends PageInk>(line: InkLine<S>): S[] {
  return line.words.flatMap((w) => w.strokes);
}
