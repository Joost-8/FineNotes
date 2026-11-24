/**
 * Tidy handwriting without reading it.
 *
 * The ink is never recognised and never redrawn, scaled or sheared: every
 * point of a line goes through one smooth change of place, the same for all
 * the ink at that spot along the line. So a tidied line says what it said, in
 * the letters the writer made; a misread cannot change a word, and no dot,
 * bar or letter can part from what stands next to it.
 *
 * Along a line, the change follows the **baseline**: where the letters
 * stand, measured at knots an x-height apart from where the pen turns at the
 * feet of letters. The line is set level (or, on ruled paper, on the nearest
 * rule), and where the baseline wanders the ink follows it back.
 *
 * Between lines: lines that start together are set on one margin (a page can
 * have several: its text, a list's dashes), and lines written at a steady
 * distance are set at exactly that distance. A line is never moved into its
 * neighbour: where a change would crowd the line above or under it, the line
 * first steps away a little, and else makes only as much of the change as
 * there is room for.
 *
 * Measuring and moving is repeated until nothing moves (see `ROUNDS`), so ink
 * that was tidied is left as it is when tidied again.
 *
 * Within strokes ({@link TidyOptions.strokes}): the tremor of a pen on glass
 * is smoothed, never by more than a small share of a letter and never across
 * a corner, and a stroke meant as a straight bar (a dash, a crossbar, an
 * underline) is drawn straight.
 *
 * Measured and left as written:
 *
 * - **The lean.** It is part of a {@link HandProfile} (what a generator needs
 *   to write in this hand), but it is not corrected: on real pages a lean
 *   could not be measured steadily enough along a line, and a round of
 *   shearing changed what the next round measured.
 * - **Size.** Along a line it could not be told from the mix of tall and
 *   small letters, and evening it made real pages less even.
 * - **Gaps** between letters and words: the groups of strokes with a gap
 *   between them are often single letters in a printed hand, so evening the
 *   gaps would pull words apart.
 *
 * Left alone entirely: anything that is not clearly a line of running text.
 * That is a line too short to have a baseline, lines side by side at one
 * height (columns, the cells of a table), a line a tall stroke runs through
 * (a table's rule), a line with an equals sign or with ink stacked above ink
 * (a formula, a fraction, an index), and a line steeper than
 * {@link MAX_LEVEL_SLOPE}. A line too short for its tilt to be measured only
 * moves as a whole. Strokes that are not writing (an underline, a highlight)
 * follow the one line they lie on.
 *
 * PURE: no DOM, no Obsidian.
 */

import { robustLine } from "../recognition/hwr/features";
import { type InkLine, type PageInk, segmentPage, withStrokeTimes } from "../recognition/hwr/lines";
import { fitLine, median } from "../recognition/hwr/numeric";

/** A writer's usual hand, measured from their ink. */
export interface HandProfile {
  /** tan of the lean from upright; positive leans right. */
  slant: number;
  /**
   * The usual gap between words, in x-heights: the wider of the two kinds of
   * gap between groups of strokes (in a printed hand the narrower kind is the
   * gap between letters).
   */
  wordGap: number;
  /** The x-height, page px. */
  xHeight: number;
  /** The usual distance between the baselines of lines written under each other, in x-heights; 0 when unknown. */
  linePitch: number;
  /** Lines the numbers rest on. */
  lines: number;
}

/** How uneven writing is, by the pass's own measures; every number is 0 for perfectly even ink. */
export interface Neatness {
  /** The baseline's wander within lines: RMS distance from a straight line, in x-heights. */
  baseline: number;
  /** Lines off level: mean absolute tilt, degrees. */
  tilt: number;
  /** Slant along lines: RMS difference of tan from the line's own. */
  slant: number;
  /** Lines off their common margin: RMS, in x-heights. */
  margin: number;
  /** Lines off an even spacing: RMS, in x-heights. */
  pitch: number;
  /** Lines of running text, and all pieces of ink in lines. */
  lines: number;
  pieces: number;
}

/** A run of evenly spaced rules across one x-range (a `LineBlock`), page px, y down. */
export interface RuleBlock {
  x0: number;
  x1: number;
  pitch: number;
  /** Each rule's y, top to bottom: handwriting sits just above it. */
  baselines: readonly number[];
}

export interface TidyOptions {
  /** 0 changes nothing, 1 is the full correction. Default {@link DEFAULT_STRENGTH}. */
  strength?: number;
  /** The writer's hand; measured from the strokes given when absent. */
  profile?: HandProfile | null;
  /** Ruled paper: the page's blocks of rules (`writingLines` in canvas/writing-lines.ts). */
  rules?: readonly RuleBlock[] | null;
  /** Smooth tremor and straighten bars inside strokes. Default true. */
  strokes?: boolean;
}

export interface TidyResult {
  /** New points for every stroke that moved, by stroke id; same length as before. */
  pts: Map<string, number[]>;
  before: Neatness;
  after: Neatness;
}

export const DEFAULT_STRENGTH = 1;
/** A line steeper than this (tan, about 10 degrees) is written at an angle on purpose: not levelled. */
export const MAX_LEVEL_SLOPE = 0.18;
/** How far along a line, in x-heights, ink is gathered to say where the baseline is, and what the lean is. */
const BASE_WINDOW = 12;
const SLANT_WINDOW = 30;
/** What makes a line running text: its width and its widest gap in x-heights, and the share of it under ink. */
const MIN_LINE_WIDTH = 5;
const MAX_LINE_GAP = 6;
const MIN_COVER = 0.4;
/** A baseline is followed no further than this from its straight line, in x-heights. */
const MAX_WANDER = 0.5;
/** A line at least this many x-heights wide has a tilt worth measuring. */
const LEVEL_WIDTH = 8;
/** How far beside a line, in x-heights, a stray piece may lie and still be part of it. */
const STRAY_REACH = 2.5;
/**
 * How far above a line's baseline, in x-heights, a small stroke written amid that line's
 * strokes may stand and be its dot or bar. Higher up it is on the line above: a full stop
 * put there later, while the pen was on this line.
 */
const AMID_ABOVE = 2.2;
/** An underline or highlight follows a line whose ink lies along at least this share of it. */
const FOLLOW_COVER = 0.3;
/** Lines starting within this many x-heights of their margin are set on it; lines share a margin when their starts are no further apart than the link. */
const MARGIN_REACH = 1.0;
const MARGIN_LINK = 0.6;
/** Lines whose spacing is within this share of the usual one are evenly spaced lines. */
const PITCH_BAND = 0.22;
/** Corrections smaller than these are not made: a baseline, a margin or a line spacing off by this share of an x-height. */
const DEAD = { baseline: 0.04, margin: 0.06, pitch: 0.04 } as const;
/** Two lines are never brought nearer than this (x-heights), or nearer than they were when that was less. */
const LINE_CLEARANCE = 0.5;
/** A line may step this far (x-heights) away from a neighbour its levelling would crowd. */
const MAX_PUSH = 0.6;
/** Room two lines may lose all the same, in x-heights: ascenders and descenders of neighbours often touch already. */
const CLEARANCE_SLACK = 0.08;
/** A turn of the pen counts when it is at least this share of an x-height tall. */
const TURN = 0.15;
/** Tremor: the most a point is moved, as a share of an x-height, and the turn (degrees) that makes a corner. */
const SMOOTH_REACH = 0.06;
const CORNER_DEG = 40;
/** A bar is straightened when it bows no more than this share of an x-height. */
const BAR_SAG = 0.25;
/** Share of each correction applied at full strength. */
/**
 * Measuring and moving is repeated until a round moves nothing further than
 * this share of an x-height, at most {@link ROUNDS} times: what a round
 * measures (a line's tilt, where its baseline wanders) is a little off while
 * the other is still wrong, and tidying must leave ink that tidying again
 * would not move.
 */
const SETTLED = 0.03;
const ROUNDS = 4;
const PULL = { baseline: 1, level: 1, margin: 1, pitch: 1, bar: 1 } as const;

type Box = [number, number, number, number];

interface Piece<S extends PageInk> {
  strokes: S[];
  box: Box;
  cx: number;
}

interface LineFit<S extends PageInk> {
  /** Left to right. */
  pieces: Piece<S>[];
  box: Box;
  /** The straight baseline: y = slope * x + level. */
  slope: number;
  level: number;
  /** x-height, page px. */
  core: number;
  /** Where along the line (x) the baseline and the lean are measured: evenly spaced, about an x-height apart. */
  knots: number[];
  /** Per knot: how far the baseline is from the straight one there (page px, y down). */
  off: number[];
  /** Per knot: the lean there (tan), or null when it cannot be told. */
  slant: (number | null)[];
  /** The line's own lean, or null. */
  lean: number | null;
  /** Whether this is a line of running text; nothing else is moved. */
  based: boolean;
  /** Whether it is long enough for its tilt, wander and lean to be measured; a shorter line only moves as a whole. */
  long: boolean;
}

function boxOfPts(pts: ArrayLike<number>): Box {
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

function unionOf(boxes: readonly Box[]): Box {
  const out: Box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const b of boxes) {
    out[0] = Math.min(out[0], b[0]);
    out[1] = Math.min(out[1], b[1]);
    out[2] = Math.max(out[2], b[2]);
    out[3] = Math.max(out[3], b[3]);
  }
  return out;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const rms = (v: readonly number[]): number =>
  v.length ? Math.sqrt(v.reduce((a, b) => a + b * b, 0) / v.length) : 0;

/**
 * Where the pen turns in a stroke: letter bottoms (y down, so the turns at a
 * largest y) and tops, each at least `delta` tall, a stroke's two ends
 * included. A straight stem gives its top and its foot; a flat bar (a dash, a
 * crossbar) and a dot give nothing, since they turn by less than `delta`.
 */
function turns(
  pts: ArrayLike<number>,
  delta: number,
  bx: number[],
  by: number[],
  tx: number[],
  ty: number[],
): void {
  const n = Math.floor(pts.length / 3);
  if (n === 0) return;
  const y = (i: number): number => pts[i * 3 + 1];
  const bottom = (i: number): void => {
    bx.push(pts[i * 3]);
    by.push(y(i));
  };
  const top = (i: number): void => {
    tx.push(pts[i * 3]);
    ty.push(y(i));
  };
  let minV = y(0);
  let minI = 0;
  let maxV = y(0);
  let maxI = 0;
  // 0 until the pen has gone `delta` one way; then 1 while it heads down the page, -1 while up.
  let heading = 0;
  for (let i = 1; i < n; i++) {
    const v = y(i);
    if (v > maxV) {
      maxV = v;
      maxI = i;
    }
    if (v < minV) {
      minV = v;
      minI = i;
    }
    if (heading !== -1 && v < maxV - delta) {
      if (heading === 0 && minI < maxI && maxV - minV >= delta) top(minI);
      bottom(maxI);
      heading = -1;
      minV = v;
      minI = i;
    } else if (heading !== 1 && v > minV + delta) {
      if (heading === 0 && maxI < minI && maxV - minV >= delta) bottom(maxI);
      top(minI);
      heading = 1;
      maxV = v;
      maxI = i;
    }
  }
  if (heading === 1) bottom(maxI);
  else if (heading === -1) top(minI);
  else if (maxV - minV >= delta) {
    bottom(maxI);
    top(minI);
  }
}

/** The value most of `values` sit at: their median, taken again over those within `reach` of it. */
function cluster(values: readonly number[], reach: number): number {
  const mid = median(values);
  const near = values.filter((v) => Math.abs(v - mid) <= reach);
  return near.length ? median(near) : mid;
}

/**
 * The line's x-height from where its ink is densest (the recogniser's own
 * estimate), page px. Heights are taken off a line of slope `slope`, or a
 * climbing line would count its climb as height.
 */
function lineCore(strokes: readonly PageInk[], fallback: number, slope: number): number {
  const ys: number[] = [];
  const weights: number[] = [];
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of strokes) {
    const n = Math.floor(s.pts.length / 3);
    let prev = 0;
    for (let i = 0; i < n; i++) {
      const y = s.pts[i * 3 + 1] - slope * s.pts[i * 3];
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
      if (i > 0) {
        const length = Math.hypot(
          s.pts[i * 3] - s.pts[(i - 1) * 3],
          s.pts[i * 3 + 1] - s.pts[(i - 1) * 3 + 1],
        );
        if (length > 0) {
          ys.push((y + prev) / 2);
          weights.push(length);
        }
      }
      prev = y;
    }
  }
  const full = hi - lo;
  if (ys.length < 8 || !(full > 0)) return fallback;
  const order = ys.map((_, i) => i).sort((a, b) => ys[a] - ys[b]);
  const total = weights.reduce((a, b) => a + b, 0);
  const at = (q: number): number => {
    let acc = 0;
    for (const i of order) {
      acc += weights[i];
      if (acc >= q * total) return ys[i];
    }
    return ys[order[order.length - 1]];
  };
  const core = (at(0.8) - at(0.2)) / 0.6;
  return core >= 0.2 * full && core <= 0.9 * full ? core : 0.45 * full;
}

/** `values[i]` at `xs[i]`, each replaced by the weighted mean of its neighbours (a bell of width `sigma`). */
function smooth(xs: readonly number[], values: readonly number[], sigma: number): number[] {
  return xs.map((x) => {
    let sum = 0;
    let weight = 0;
    for (let j = 0; j < xs.length; j++) {
      const w = Math.exp(-0.5 * ((xs[j] - x) / sigma) ** 2);
      sum += w * values[j];
      weight += w;
    }
    return sum / weight;
  });
}

/** Whether a stroke is a flat bar: at least `ratio` times as wide as tall, and at least `min` wide. */
const isBar = (b: Box, min: number, ratio = 2.5): boolean =>
  b[2] - b[0] >= min && b[2] - b[0] >= ratio * (b[3] - b[1]);

/**
 * Whether a line holds maths: an equals sign (two flat bars one above the
 * other with no stem through them, which a capital E has), or ink stacked
 * above other ink along a good part of it (an index, a limit, a fraction).
 */
function looksLikeMaths(
  strokes: readonly PageInk[],
  core: number,
  x0: number,
  x1: number,
): boolean {
  const boxes = strokes.map((s) => boxOfPts(s.pts));
  const bars = boxes.filter((b) => isBar(b, 0.5 * core));
  for (let i = 0; i < bars.length; i++) {
    for (let j = i + 1; j < bars.length; j++) {
      const a = bars[i];
      const b = bars[j];
      const overlap = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
      const apart = Math.abs((a[1] + a[3]) / 2 - (b[1] + b[3]) / 2);
      if (overlap < 0.5 * Math.min(a[2] - a[0], b[2] - b[0])) continue;
      if (apart < 0.12 * core || apart > 0.9 * core) continue;
      const left = Math.min(a[0], b[0]) - 0.1 * core;
      const right = Math.max(a[2], b[2]) + 0.1 * core;
      const stem = boxes.some(
        (s) => s[3] - s[1] > 0.6 * core && s[2] > left && s[0] < right && s !== a && s !== b,
      );
      if (!stem) return true;
    }
  }
  // Stacking: columns of x where two strokes of some size lie one clear above the other.
  const sized = boxes.filter((b) => Math.max(b[2] - b[0], b[3] - b[1]) > 0.3 * core);
  const step = 0.25 * core;
  const columns = Math.max(1, Math.ceil((x1 - x0) / step));
  let stacked = 0;
  for (let c = 0; c < columns; c++) {
    const x = x0 + (c + 0.5) * step;
    const here = sized.filter((b) => b[0] <= x && b[2] >= x).sort((a, b) => a[1] - b[1]);
    for (let k = 1; k < here.length; k++) {
      if (here[k][1] - here[k - 1][3] > 0.1 * core) {
        stacked++;
        break;
      }
    }
  }
  return stacked >= 0.12 * columns && stacked * step >= 1.5 * core;
}

/**
 * The lean of pen movement: the commonest direction of downstrokes (tan), or
 * null with too little of them. With `around` (a lean already known for the
 * whole line), the mean direction of the downstrokes within 15 degrees of it:
 * a stretch of a line then cannot pick another kind of stroke (the diagonals
 * of v, w and x) as its lean.
 */
function leanOf(
  tans: readonly number[],
  weights: readonly number[],
  least: number,
  around?: number,
): number | null {
  if (around !== undefined) {
    const mid = (Math.atan(around) * 180) / Math.PI;
    let sum = 0;
    let weight = 0;
    for (let i = 0; i < tans.length; i++) {
      if (Math.abs((Math.atan(tans[i]) * 180) / Math.PI - mid) <= 15) {
        sum += tans[i] * weights[i];
        weight += weights[i];
      }
    }
    return weight >= least ? sum / weight : null;
  }
  const BINS = 27; // 5 degrees each, from -67.5 to +67.5 (chords reach about 55 either way)
  const hist = new Float64Array(BINS);
  let total = 0;
  for (let i = 0; i < tans.length; i++) {
    const deg = (Math.atan(tans[i]) * 180) / Math.PI;
    const bin = Math.floor((deg + 67.5) / 5);
    if (bin < 0 || bin >= BINS) continue;
    hist[bin] += weights[i];
    total += weights[i];
  }
  if (total < least) return null;
  let best = 0;
  let bestV = -1;
  for (let b = 0; b < BINS; b++) {
    const v = (hist[b - 1] ?? 0) + 2 * hist[b] + (hist[b + 1] ?? 0);
    if (v > bestV) {
      bestV = v;
      best = b;
    }
  }
  // The weighted mean direction around the commonest one.
  let sum = 0;
  let weight = 0;
  for (let i = 0; i < tans.length; i++) {
    const deg = (Math.atan(tans[i]) * 180) / Math.PI;
    if (Math.abs(deg - (best * 5 - 65)) <= 10) {
      sum += tans[i] * weights[i];
      weight += weights[i];
    }
  }
  return weight > 0 ? sum / weight : null;
}

function fitLineOf<S extends PageInk>(line: InkLine<S>): LineFit<S> | null {
  // Pieces left to right; pieces that overlap along x are one piece (a crossbar
  // folded in later lies over its letter and must move with it).
  const pieces: Piece<S>[] = [];
  for (const w of [...line.words].sort((a, b) => a.box[0] - b.box[0])) {
    const last = pieces[pieces.length - 1];
    if (last && w.box[0] <= last.box[2]) {
      last.strokes.push(...w.strokes);
      last.box = unionOf([last.box, w.box]);
      last.cx = (last.box[0] + last.box[2]) / 2;
    } else {
      pieces.push({ strokes: [...w.strokes], box: [...w.box], cx: (w.box[0] + w.box[2]) / 2 });
    }
  }
  if (pieces.length === 0) return null;
  const all = pieces.flatMap((p) => p.strokes);
  const box = unionOf(pieces.map((p) => p.box));
  const delta = TURN * Math.max(line.xHeight, 1e-6);
  const chord = 0.3 * Math.max(line.xHeight, 1e-6);
  const bx: number[] = [];
  const by: number[] = [];
  const tx: number[] = [];
  const ty: number[] = [];
  // Downstrokes, for the lean: where, tan, and how long.
  const sx: number[] = [];
  const st: number[] = [];
  const sw: number[] = [];
  for (const s of all) {
    turns(s.pts, delta, bx, by, tx, ty);
    // Chords a good part of a letter long: points lie on a grid of hundredths (or of
    // whole px on older iPads), and the direction between two neighbours is mostly that grid.
    const n = Math.floor(s.pts.length / 3);
    let from = 0;
    for (let i = 1; i < n; i++) {
      const dx = s.pts[i * 3] - s.pts[from * 3];
      const dy = s.pts[i * 3 + 1] - s.pts[from * 3 + 1];
      const length = Math.hypot(dx, dy);
      if (length < chord) continue;
      if (dy > 0 && dy > 0.7 * Math.abs(dx)) {
        sx.push((s.pts[i * 3] + s.pts[from * 3]) / 2);
        st.push(-dx / dy);
        sw.push(length);
      }
      from = i;
    }
  }
  const width = box[2] - box[0];
  // A first slope, only to measure heights along the line.
  const rough = bx.length >= 5 && width > 0 ? robustLine(bx, by)[0] : 0;
  const core = lineCore(all, line.xHeight, Math.abs(rough) <= 0.6 ? rough : 0);
  if (!(core > 0)) return null;
  // Running text only: wide enough, with ink along most of it and no gap wide
  // enough to be a column. A table row, a lone formula or a label is left alone.
  let covered = 0;
  let widestGap = 0;
  let right = -Infinity;
  for (const p of pieces) {
    if (right > -Infinity) widestGap = Math.max(widestGap, p.box[0] - right);
    covered += Math.max(0, p.box[2] - Math.max(p.box[0], right));
    right = Math.max(right, p.box[2]);
  }
  const based =
    width >= MIN_LINE_WIDTH * core &&
    bx.length >= 8 &&
    covered >= MIN_COVER * width &&
    widestGap <= MAX_LINE_GAP * core &&
    !looksLikeMaths(all, core, box[0], box[2]);
  // The baseline and the lean are measured at knots along the line, an x-height apart.
  const knots: number[] = [];
  const count = Math.max(2, Math.round(width / core) + 1);
  for (let k = 0; k < count; k++) knots.push(box[0] + (width * k) / (count - 1));
  const flat = knots.map(() => 0);
  const unknown = knots.map((): number | null => null);
  if (!based) {
    const level = bx.length ? median(by) : (box[1] + box[3]) / 2;
    return {
      pieces,
      box,
      slope: 0,
      level,
      core,
      knots,
      off: flat,
      slant: unknown,
      lean: null,
      based,
      long: false,
    };
  }
  let [slope, level] = robustLine(bx, by);
  if (Math.abs(slope) > 0.6) [slope, level] = [0, median(by)];
  const lean = leanOf(st, sw, 6 * core);
  if (width < LEVEL_WIDTH * core || bx.length < 12) {
    // Too short for its tilt to be told from its letters: taken as level.
    return {
      pieces,
      box,
      slope: 0,
      level: median(by),
      core,
      knots,
      off: flat,
      slant: unknown,
      lean,
      based,
      long: false,
    };
  }
  // The baseline at each knot: where the letter bottoms around it stand
  // (descenders hang below and dots sit above; the bottoms in between agree).
  const residual = bx.map((x, i) => by[i] - (slope * x + level));
  const rawOff = knots.map((x) => {
    let reach = (BASE_WINDOW / 2) * core;
    for (let tries = 0; tries < 3; tries++, reach *= 1.6) {
      const near = residual.filter((_, i) => Math.abs(bx[i] - x) <= reach);
      if (near.length >= 8) return cluster(near, 0.35 * core);
    }
    return 0;
  });
  const off = smooth(knots, rawOff, 3 * core).map((v) =>
    clamp(v, -MAX_WANDER * core, MAX_WANDER * core),
  );
  // The straight baseline again, through the smooth one.
  const [a, b] = fitLine(
    knots,
    knots.map((x, i) => slope * x + level + off[i]),
  );
  if (Math.abs(a) <= 0.6) {
    for (let i = 0; i < off.length; i++) off[i] += slope * knots[i] + level - (a * knots[i] + b);
    [slope, level] = [a, b];
  }
  const rawSlant = knots.map((x) => {
    const reach = (SLANT_WINDOW / 2) * core;
    const tans: number[] = [];
    const weights: number[] = [];
    for (let i = 0; i < sx.length; i++) {
      if (Math.abs(sx[i] - x) <= reach) {
        tans.push(st[i]);
        weights.push(sw[i]);
      }
    }
    return lean === null ? null : leanOf(tans, weights, 4 * core, lean);
  });
  const known = rawSlant.map((v) => v ?? lean ?? 0);
  const smoothed = smooth(knots, known, 6 * core);
  const slant = rawSlant.map((v, i) => (v === null || lean === null ? null : smoothed[i]));
  return { pieces, box, slope, level, core, knots, off, slant, lean, based, long: true };
}

/**
 * The line finder follows the pen, so a word added later, a comma that hangs
 * low or a word written a little high can land in the wrong line, or in a
 * short "line" of its own. Left there it would stay behind, or go the wrong
 * way, when its real line is levelled. So every piece is given to the line of
 * running text whose letters it is nearest, with three things kept in mind:
 * a piece is never part of a line begun after the piece was written; it must
 * lie beside that line's ink, no further than a wide word gap (a table cell
 * across the page is not part of a line), or further only when it was written
 * straight after that line's ink, as the next word is; and its own line wins a
 * near tie.
 */
function regroup<S extends PageInk>(lines: readonly InkLine<S>[]): InkLine<S>[] {
  const fits = lines.map((l) => fitLineOf(l));
  const hosts = fits.flatMap((f, i) => (f && f.based ? [i] : []));
  if (hosts.length === 0) return [...lines];
  // Each stroke's line, and the stroke written just before it.
  const lineOf = new Map<string, number>();
  const timed: { id: string; t0: number }[] = [];
  lines.forEach((l, i) => {
    for (const w of l.words) {
      for (const s of w.strokes) {
        lineOf.set(s.id, i);
        if (s.t0 != null) timed.push({ id: s.id, t0: s.t0 });
      }
    }
  });
  timed.sort((a, b) => a.t0 - b.t0);
  const before = new Map<string, string>();
  const next = new Map<string, string>();
  for (let k = 1; k < timed.length; k++) {
    before.set(timed[k].id, timed[k - 1].id);
    next.set(timed[k - 1].id, timed[k].id);
  }
  /** The first of `strokes` to be written (or the last), or null when one has no time. */
  const endStroke = (strokes: readonly S[], last: boolean): S | null => {
    let end: S | null = null;
    for (const s of strokes) {
      if (s.t0 == null) return null;
      if (!end || (last ? s.t0 > (end.t0 as number) : s.t0 < (end.t0 as number))) end = s;
    }
    return end;
  };
  /** When line `h` was begun, not counting the strokes of `skip`. */
  const begun = (h: number, skip: ReadonlySet<string>): number | null => {
    let first = Infinity;
    for (const w of lines[h].words) {
      for (const s of w.strokes) {
        if (skip.has(s.id)) continue;
        if (s.t0 == null) return null;
        first = Math.min(first, s.t0);
      }
    }
    return first < Infinity ? first : null;
  };
  /** How far a piece is from a host's small letters, in x-heights; Infinity when it cannot be part of it. */
  const distance = (h: number, box: Box, reach: number, above: number): number => {
    const host = fits[h] as LineFit<S>;
    const cx = (box[0] + box[2]) / 2;
    const cy = (box[1] + box[3]) / 2;
    if (box[2] < host.box[0] - reach * host.core || box[0] > host.box[2] + reach * host.core) {
      return Infinity;
    }
    const base = host.slope * cx + host.level;
    // From the ascenders' tops (`above`) to where a comma's tail ends.
    if (cy < base - above * host.core || cy > base + 1.25 * host.core) return Infinity;
    return Math.max(0, cy - base, base - host.core - cy) / host.core;
  };
  const words = lines.map((): InkLine<S>["words"] => []);
  lines.forEach((line, i) => {
    for (const w of line.words) {
      const ids = new Set(w.strokes.map((s) => s.id));
      const first = endStroke(w.strokes, false);
      const last = endStroke(w.strokes, true);
      const written = first ? (first.t0 as number) : null;
      // The line whose ink was written just before this piece: the pen went on from there.
      const prevId = first ? before.get(first.id) : undefined;
      const cameFrom = prevId === undefined || ids.has(prevId) ? -1 : (lineOf.get(prevId) ?? -1);
      // Written between two strokes of one line, the piece is that line's: a dot or a
      // bar is put on its letter before the pen goes on, wherever between the lines it lands.
      const nextId = last ? next.get(last.id) : undefined;
      const wentTo = nextId === undefined || ids.has(nextId) ? -1 : (lineOf.get(nextId) ?? -1);
      const amid = cameFrom === wentTo ? cameFrom : -1;
      let best = i;
      let bestD = Infinity;
      for (const h of hosts) {
        // Another line begun after this piece was written cannot be where it was put.
        const start = h === i ? null : begun(h, ids);
        if (written !== null && start !== null && written < start) continue;
        const reach = h === cameFrom || h === i ? MAX_LINE_GAP : STRAY_REACH;
        // A dot the pen put down amid a line's writing may sit higher than one found by place alone.
        const d =
          distance(h, w.box, reach, h === amid ? AMID_ABOVE : 1.9) -
          (h === i ? 0.15 : 0) -
          (h === amid ? 0.75 : 0);
        if (d < bestD) {
          bestD = d;
          best = h;
        }
      }
      words[best].push(w);
    }
  });
  const out: InkLine<S>[] = [];
  lines.forEach((line, i) => {
    if (words[i].length === 0) return;
    out.push({ words: words[i], box: unionOf(words[i].map((w) => w.box)), xHeight: line.xHeight });
  });
  return out;
}

/** A line's baseline at `x` (page y). */
const baseAt = (line: LineFit<PageInk>, x: number): number => line.slope * x + line.level;

/** The middle height (page y) of a line's ink between `x0` and `x1`, or null when it has none there. */
function inkHeight(line: LineFit<PageInk>, x0: number, x1: number): number | null {
  const ys: number[] = [];
  for (const piece of line.pieces) {
    if (piece.box[2] < x0 || piece.box[0] > x1) continue;
    for (const s of piece.strokes) {
      for (let i = 0; i + 1 < s.pts.length; i += 3) {
        if (s.pts[i] >= x0 && s.pts[i] <= x1) ys.push(s.pts[i + 1]);
      }
    }
  }
  return ys.length ? median(ys) : null;
}

/**
 * The gap between two lines along x (negative when they overlap), and whether
 * their ink stands at one height where they meet. The ink itself is compared,
 * a few x-heights either side of the meeting point: a baseline carried past a
 * short line's end says little.
 */
function beside(a: LineFit<PageInk>, b: LineFit<PageInk>): { gap: number; level: boolean } {
  const gap = Math.max(a.box[0], b.box[0]) - Math.min(a.box[2], b.box[2]);
  const core = Math.max(a.core, b.core);
  // No ink of the two at one height at all: one is above the other.
  if (a.box[1] > b.box[3] || b.box[1] > a.box[3]) return { gap, level: false };
  const x = (Math.max(a.box[0], b.box[0]) + Math.min(a.box[2], b.box[2])) / 2;
  const reach = Math.abs(gap) / 2 + 3 * core;
  const ya = inkHeight(a, x - reach, x + reach);
  const yb = inkHeight(b, x - reach, x + reach);
  return { gap, level: ya !== null && yb !== null && Math.abs(ya - yb) <= 0.5 * core };
}

function fitLines<S extends PageInk>(strokes: readonly S[]): LineFit<S>[] {
  const page = segmentPage(withStrokeTimes(strokes), { rows: true });
  const found = regroup(page.lines);
  let out: LineFit<S>[] = [];
  for (const line of found) {
    const fit = fitLineOf(line);
    if (fit) out.push(fit);
  }
  // Two stretches of writing at one height where they meet, no further apart than a
  // wide word gap, are one line: a line the pen came back to, or one that climbs so
  // much that it was taken for two. Tidied apart, they would part in the middle of a word.
  for (let again = true; again;) {
    again = false;
    for (let i = 0; i < out.length && !again; i++) {
      for (let j = i + 1; j < out.length && !again; j++) {
        const a = out[i];
        const b = out[j];
        if (!(a.based || b.based)) continue;
        const { gap, level } = beside(a, b);
        const core = Math.max(a.core, b.core);
        if (gap > MAX_LINE_GAP * core || !level) continue;
        if (Math.max(a.core, b.core) > 1.6 * Math.min(a.core, b.core)) continue;
        const words = [...a.pieces, ...b.pieces].map((piece) => ({
          strokes: piece.strokes,
          box: piece.box,
        }));
        const joined = fitLineOf({
          words,
          box: unionOf([a.box, b.box]),
          xHeight: (a.core + b.core) / 2,
        });
        if (!joined) continue;
        out = out.filter((_, k) => k !== i && k !== j);
        out.push(joined);
        again = true;
      }
    }
  }
  // What still stands side by side at one height is columns, or cells of a table: left alone.
  const columns = new Set<number>();
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      if (!(out[i].based || out[j].based)) continue;
      const { gap, level } = beside(out[i], out[j]);
      if (gap > 0 && level) columns.add(i).add(j);
    }
  }
  const leave = (fit: LineFit<S>): void => {
    fit.based = false;
    fit.long = false;
    fit.slope = 0;
    fit.off.fill(0);
    fit.slant.fill(null);
    fit.lean = null;
  };
  for (const i of columns) leave(out[i]);
  // A line a tall stroke runs through (a table's column rule, a diagram's
  // side) is a row of cells or labels, not running text: it is left alone.
  const written = new Set(
    page.lines.flatMap((l) => l.words.flatMap((w) => w.strokes.map((s) => s.id))),
  );
  const tall = strokes
    .filter((s) => !written.has(s.id) && s.pts.length >= 6)
    .map((s) => boxOfPts(s.pts));
  for (const fit of out) {
    if (!fit.based) continue;
    const crossed = tall.some((b) => {
      const cx = (b[0] + b[2]) / 2;
      const base = fit.slope * cx + fit.level;
      // Much taller than the writing, and through at least half the band of its small letters.
      const through = Math.min(b[3], base) - Math.max(b[1], base - fit.core);
      return (
        b[3] - b[1] >= 2.5 * fit.core &&
        cx > fit.box[0] &&
        cx < fit.box[2] &&
        through >= 0.5 * fit.core
      );
    });
    if (crossed) leave(fit);
  }
  return out;
}

/** Where a line's baseline is at its middle (page y), and where it starts. */
const middleOf = (line: LineFit<PageInk>): number => {
  const x = median(line.pieces.map((p) => p.cx));
  return line.slope * x + line.level;
};
const startOf = (line: LineFit<PageInk>): number => line.box[0];

/** The gaps between a page's lines that look like one line under the next: (index above, index below, distance). */
function pitchesOf(lines: readonly LineFit<PageInk>[]): { a: number; b: number; d: number }[] {
  const order = lines
    .map((l, i) => ({ i, y: middleOf(l) }))
    .filter((o) => lines[o.i].based)
    .sort((p, q) => p.y - q.y);
  const out: { a: number; b: number; d: number }[] = [];
  for (let k = 1; k < order.length; k++) {
    const above = lines[order[k - 1].i];
    const below = lines[order[k].i];
    const overlap = Math.min(above.box[2], below.box[2]) - Math.max(above.box[0], below.box[0]);
    const d = order[k].y - order[k - 1].y;
    if (overlap > 0 && d > 0.8 * Math.max(above.core, below.core)) {
      out.push({ a: order[k - 1].i, b: order[k].i, d });
    }
  }
  return out;
}

/**
 * The usual gap between words, in x-heights. Gaps between a line's pieces
 * come in two kinds; the wider kind is the word gap (two-means on the log of
 * the gaps). With too few gaps, or only one kind, their median.
 */
function wordGapOf(lines: readonly LineFit<PageInk>[]): number {
  const gaps: number[] = [];
  for (const line of lines) {
    if (!line.based) continue;
    for (let i = 1; i < line.pieces.length; i++) {
      const g = (line.pieces[i].box[0] - line.pieces[i - 1].box[2]) / line.core;
      if (g > 0.03) gaps.push(Math.log(g));
    }
  }
  if (gaps.length === 0) return 1;
  if (gaps.length < 8) return Math.exp(median(gaps));
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  let lo = sortedGaps[Math.floor(0.25 * (sortedGaps.length - 1))];
  let hi = sortedGaps[Math.floor(0.85 * (sortedGaps.length - 1))];
  for (let i = 0; i < 30; i++) {
    const cut = (lo + hi) / 2;
    const low = gaps.filter((v) => v <= cut);
    const high = gaps.filter((v) => v > cut);
    if (low.length === 0 || high.length === 0) break;
    lo = low.reduce((a, b) => a + b, 0) / low.length;
    hi = high.reduce((a, b) => a + b, 0) / high.length;
  }
  return Math.exp(hi);
}

function profileOf(lines: readonly LineFit<PageInk>[]): HandProfile | null {
  if (lines.length === 0) return null;
  const core = median(lines.map((l) => l.core));
  const leans = lines.flatMap((l) => (l.lean === null ? [] : [l.lean]));
  const pitches = pitchesOf(lines).map((p) => p.d);
  return {
    slant: leans.length ? median(leans) : 0,
    wordGap: wordGapOf(lines),
    xHeight: core,
    linePitch: pitches.length >= 2 ? median(pitches) / core : 0,
    lines: lines.length,
  };
}

/** The writer's usual slant, x-height, word gap and line spacing in this ink; null when it holds no writing. */
export function measureHand(strokes: readonly PageInk[]): HandProfile | null {
  return profileOf(fitLines(strokes));
}

/** A line of running text: where it runs and where its letters stand. */
export interface LineGeometry {
  /** Its ink's left and right edge (page px). */
  x0: number;
  x1: number;
  /** The baseline: y = slope * x + level (page px, y down). A line too short to tell is level. */
  slope: number;
  level: number;
  /** The line's x-height, page px. */
  xHeight: number;
  /** The ids of its strokes. */
  strokes: string[];
}

/**
 * The lines of running text in this ink, top to bottom. What is needed to set
 * written ink into a line: scale it to the line's x-height and stand it on
 * the baseline.
 */
export function measureLines(strokes: readonly PageInk[]): LineGeometry[] {
  return fitLines(strokes)
    .filter((line) => line.based)
    .map((line) => ({
      x0: line.box[0],
      x1: line.box[2],
      slope: line.slope,
      level: line.level,
      xHeight: line.core,
      strokes: line.pieces.flatMap((p) => p.strokes.map((s) => s.id)),
    }))
    .sort((a, b) => a.slope * a.x0 + a.level - (b.slope * b.x0 + b.level));
}

/**
 * The ids of the strokes on the same line of running text as `strokeId`, for
 * tidying the line a held word is on (the press menu). Null when the stroke
 * is on no such line: a formula, a table, a lone mark, a line too short to
 * have a baseline.
 */
export function lineOfStroke(strokes: readonly PageInk[], strokeId: string): string[] | null {
  for (const line of fitLines(strokes)) {
    const ids = line.pieces.flatMap((p) => p.strokes.map((s) => s.id));
    if (ids.includes(strokeId)) return line.based ? ids : null;
  }
  return null;
}

/**
 * How much of a correction is made for something `off` from where it belongs,
 * when nothing is corrected past `reach`: all of it up to half of `reach`,
 * then less and less. A rule that stops dead at its reach would decide
 * differently for two inks a hair apart; this one moves them alike.
 */
const taper = (off: number, reach: number): number => clamp((reach - off) / (reach / 2), 0, 1);

/** Per line, how far it is to be moved toward the common margin and toward an even spacing (page px). */
function layoutOf(
  lines: readonly LineFit<PageInk>[],
  profile: HandProfile | null,
  whole = false,
): { margin: (number | null)[]; pitch: number[] } {
  // `whole`: how far off each line is, for measuring; else how far it is moved (tapered).
  const part = (off: number, reach: number): number => (whole ? 1 : taper(off, reach));
  const starts = lines.map(startOf);
  const full = lines.flatMap((l, i) => (l.based ? [starts[i]] : []));
  // Margins: groups of at least three lines that start near each other (the text's
  // margin, and that of a list's dashes), each set on its group's middle.
  const core = full.length ? median(lines.flatMap((l) => (l.based ? [l.core] : []))) : 1;
  const order = lines.flatMap((l, i) => (l.based ? [i] : [])).sort((a, b) => starts[a] - starts[b]);
  const margin = lines.map((): number | null => null);
  for (let from = 0; from < order.length;) {
    let to = from + 1;
    while (to < order.length && starts[order[to]] - starts[order[to - 1]] <= MARGIN_LINK * core)
      to++;
    if (to - from >= 3) {
      const group = order.slice(from, to);
      const common = median(group.map((i) => starts[i]));
      for (const i of group) {
        const off = Math.abs(starts[i] - common);
        if (off <= MARGIN_REACH * lines[i].core) {
          margin[i] = (common - starts[i]) * part(off, MARGIN_REACH * lines[i].core);
        }
      }
    }
    from = to;
  }
  // Runs of lines written at the usual distance are set at exactly one distance:
  // a least-squares line through (place in the run, baseline).
  const pitch = lines.map(() => 0);
  const links = pitchesOf(lines);
  const usual =
    profile && profile.linePitch > 0
      ? profile.linePitch * profile.xHeight
      : links.length
        ? median(links.map((l) => l.d))
        : 0;
  if (links.length >= 2 && usual > 0) {
    let run: number[] = [];
    const flush = (): void => {
      if (run.length >= 3) {
        const ys = run.map((i) => middleOf(lines[i]));
        const ks = run.map((_, k) => k);
        const [a, b] = fitLine(ks, ys);
        if (Math.abs(a - usual) <= PITCH_BAND * usual) {
          // The least even gap of the run says how surely these are evenly spaced lines.
          let sure = 1;
          for (let k = 1; k < ys.length; k++) {
            sure = Math.min(sure, part(Math.abs(ys[k] - ys[k - 1] - usual), PITCH_BAND * usual));
          }
          run.forEach((i, k) => (pitch[i] = sure * (a * k + b - ys[k])));
        }
      }
      run = [];
    };
    for (const link of links) {
      const even = Math.abs(link.d - usual) <= PITCH_BAND * usual;
      if (even && run.length && run[run.length - 1] === link.a) run.push(link.b);
      else {
        flush();
        if (even) run = [link.a, link.b];
      }
    }
    flush();
  }
  return { margin, pitch };
}

function neatnessOf(lines: readonly LineFit<PageInk>[]): Neatness {
  const off: number[] = [];
  const tilt: number[] = [];
  const slant: number[] = [];
  let pieces = 0;
  let based = 0;
  for (const line of lines) {
    pieces += line.pieces.length;
    if (!line.based) continue;
    based++;
    if (!line.long) continue;
    tilt.push(Math.abs((Math.atan(line.slope) * 180) / Math.PI));
    for (const v of line.off) off.push(v / line.core);
    for (const v of line.slant) if (v !== null && line.lean !== null) slant.push(v - line.lean);
  }
  const layout = layoutOf(lines, null, true);
  const core = lines.length ? median(lines.map((l) => l.core)) : 1;
  return {
    baseline: rms(off),
    tilt: tilt.length ? tilt.reduce((a, b) => a + b, 0) / tilt.length : 0,
    slant: rms(slant),
    margin: rms(layout.margin.flatMap((m) => (m === null ? [] : [m / core]))),
    pitch: rms(layout.pitch.map((p) => p / core)),
    lines: based,
    pieces,
  };
}

/** How uneven this writing is (see {@link Neatness}). */
export function neatness(strokes: readonly PageInk[]): Neatness {
  return neatnessOf(fitLines(strokes));
}

/** A value measured at evenly spaced `knots`, at `x`: between two knots, in between; past the ends, the end's. */
function along(knots: readonly number[], values: readonly number[], x: number): number {
  const last = knots.length - 1;
  const width = knots[last] - knots[0];
  if (!(width > 0)) return values[0];
  const f = clamp(((x - knots[0]) / width) * last, 0, last);
  const i = Math.min(last - 1, Math.floor(f));
  return values[i] + (f - i) * (values[i + 1] - values[i]);
}

/**
 * One line's change. Every point of its ink goes through the same smooth
 * change, whatever stroke or letter it is part of, so nothing in a line can
 * part from what stands next to it.
 */
interface LineMove {
  /** False when the line is left exactly as it is. */
  moves: boolean;
  knots: readonly number[];
  /** Per knot: how far the ink there goes down the page. */
  dy: number[];
  /** The slope taken out, about `pivot`. */
  turn: number;
  pivot: number;
  dx: number;
}

function movedPts(pts: ArrayLike<number>, m: LineMove): number[] {
  const out = Array.from(pts);
  if (!m.moves) return out;
  // Whole points only: a ragged tail is left as it is.
  for (let i = 0; i + 2 < out.length; i += 3) {
    const x = out[i];
    const y = out[i + 1];
    const py = y + along(m.knots, m.dy, x) - m.turn * (x - m.pivot);
    out[i] = Math.round((x + m.dx) * 100) / 100;
    out[i + 1] = Math.round(py * 100) / 100;
  }
  return out;
}

/** Whether a stroke really moved: by more than the hundredth of a page px points are stored at. */
function differs(next: readonly number[], pts: ArrayLike<number>): boolean {
  for (let i = 0; i < next.length; i++) if (Math.abs(next[i] - pts[i]) > 0.0051) return true;
  return false;
}

/**
 * The change that tidies one line. `give` (0 to 1) says how much of its change of height and tilt the line may make,
 * for when all of it would bring the line too near a neighbour.
 */
function moveFor(
  line: LineFit<PageInk>,
  strength: number,
  rules: TidyOptions["rules"],
  lineDx: number,
  lineDy: number,
  give: number,
  push: number,
): LineMove {
  const flat = line.knots.map(() => 0);
  const pivot = median(line.pieces.map((p) => p.cx));
  if (!line.based) {
    return { moves: false, knots: line.knots, dy: flat, turn: 0, pivot, dx: 0 };
  }
  const levelled = line.long && Math.abs(line.slope) <= MAX_LEVEL_SLOPE;
  const turn = levelled ? strength * PULL.level * give * line.slope : 0;
  const middle = line.slope * pivot + line.level;
  let shift = lineDy;
  if (rules && (levelled || !line.long)) {
    // The nearest rule of the block the line is written in, when the line is clearly on one.
    for (const block of rules) {
      if (pivot < block.x0 || pivot > block.x1 || !(block.pitch > 0)) continue;
      let rule: number | null = null;
      for (const y of block.baselines) {
        if (rule === null || Math.abs(y - middle) < Math.abs(rule - middle)) rule = y;
      }
      if (rule !== null && Math.abs(rule - middle) <= 0.4 * block.pitch) shift = rule - middle;
      break;
    }
  }
  // Nothing is corrected that is already as good as it can be measured.
  const wandering = line.off.some((v) => Math.abs(v) > DEAD.baseline * line.core);
  return {
    moves: true,
    knots: line.knots,
    dy: line.off.map(
      (v) => give * ((wandering ? -strength * PULL.baseline * v : 0) + strength * shift) + push,
    ),
    turn,
    pivot,
    dx: lineDx,
  };
}

/** The least room between two lines' ink where their pieces stand over each other, or within `beside` of that (negative when they overlap). */
function roomBetween(upper: readonly Box[], lower: readonly Box[], beside: number): number {
  let room = Infinity;
  for (const a of upper) {
    for (const b of lower) {
      // Ink a little to the side counts too: a word under the end of another crowds it.
      if (Math.min(a[2], b[2]) - Math.max(a[0], b[0]) <= -beside) continue;
      room = Math.min(room, b[1] - a[3]);
    }
  }
  return room;
}

/** A stroke's points with pen tremor smoothed: no point moves more than `reach`, corners and ends stay. */
function smoothed(pts: readonly number[], reach: number): number[] {
  const n = Math.floor(pts.length / 3);
  if (n < 5) return [...pts];
  const out = [...pts];
  const x = (i: number): number => pts[i * 3];
  const y = (i: number): number => pts[i * 3 + 1];
  // Corners: where the path turns sharply, looking a few points either way.
  const fixed = new Uint8Array(n);
  fixed[0] = fixed[n - 1] = 1;
  const cos = Math.cos((CORNER_DEG * Math.PI) / 180);
  for (let i = 2; i < n - 2; i++) {
    const ax = x(i) - x(i - 2);
    const ay = y(i) - y(i - 2);
    const bx = x(i + 2) - x(i);
    const by = y(i + 2) - y(i);
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la > 0 && lb > 0 && (ax * bx + ay * by) / (la * lb) < cos) {
      fixed[i - 1] = fixed[i] = fixed[i + 1] = 1;
    }
  }
  for (let i = 1; i < n - 1; i++) {
    if (fixed[i]) continue;
    const l = fixed[i - 1] ? i : i - 1;
    const r = fixed[i + 1] ? i : i + 1;
    const l2 = l > 0 && !fixed[l] && !fixed[l - 1] ? l - 1 : l;
    const r2 = r < n - 1 && !fixed[r] && !fixed[r + 1] ? r + 1 : r;
    let sx = (x(l2) + 4 * x(l) + 6 * x(i) + 4 * x(r) + x(r2)) / 16;
    let sy = (y(l2) + 4 * y(l) + 6 * y(i) + 4 * y(r) + y(r2)) / 16;
    const d = Math.hypot(sx - x(i), sy - y(i));
    if (d > reach) {
      sx = x(i) + ((sx - x(i)) * reach) / d;
      sy = y(i) + ((sy - y(i)) * reach) / d;
    }
    out[i * 3] = Math.round(sx * 100) / 100;
    out[i * 3 + 1] = Math.round(sy * 100) / 100;
  }
  return out;
}

/**
 * A stroke meant as a straight bar (a dash, a crossbar, an underline) drawn
 * straight, or null when it is not one: it must be long for its height, hardly
 * longer than its chord, near level, and bend one way only (an "s" laid flat,
 * a tilde or a "2" bends both ways and stays as it is).
 */
function straightBar(pts: readonly number[], core: number, pull: number): number[] | null {
  const n = Math.floor(pts.length / 3);
  if (n < 3) return null;
  const b = boxOfPts(pts);
  const w = b[2] - b[0];
  const h = b[3] - b[1];
  if (w < 0.5 * core || w < 5 * Math.max(h, 1e-6)) return null;
  const x0 = pts[0];
  const y0 = pts[1];
  const x1 = pts[(n - 1) * 3];
  const y1 = pts[(n - 1) * 3 + 1];
  const chord = Math.hypot(x1 - x0, y1 - y0);
  if (chord < 0.9 * w || Math.abs(y1 - y0) > 0.2 * Math.abs(x1 - x0)) return null;
  let length = 0;
  let above = 0;
  let below = 0;
  for (let i = 1; i < n; i++) {
    length += Math.hypot(pts[i * 3] - pts[(i - 1) * 3], pts[i * 3 + 1] - pts[(i - 1) * 3 + 1]);
    // Signed distance from the chord.
    const d = ((pts[i * 3] - x0) * (y1 - y0) - (pts[i * 3 + 1] - y0) * (x1 - x0)) / chord;
    above = Math.max(above, d);
    below = Math.max(below, -d);
  }
  if (length > 1.07 * chord) return null;
  if (above > 0.06 * core && below > 0.06 * core) return null;
  // A bow this deep is drawn on purpose.
  if (Math.max(above, below) > BAR_SAG * core) return null;
  const out = [...pts];
  for (let i = 1; i < n - 1; i++) {
    const t = clamp(
      ((pts[i * 3] - x0) * (x1 - x0) + (pts[i * 3 + 1] - y0) * (y1 - y0)) / (chord * chord),
      0,
      1,
    );
    out[i * 3] = Math.round((pts[i * 3] + pull * (x0 + t * (x1 - x0) - pts[i * 3])) * 100) / 100;
    out[i * 3 + 1] =
      Math.round((pts[i * 3 + 1] + pull * (y0 + t * (y1 - y0) - pts[i * 3 + 1])) * 100) / 100;
  }
  return out;
}

/** One round: where every stroke of `strokes` goes, and which strokes that are not writing went with a line. */
function tidyRound<S extends PageInk>(
  strokes: readonly S[],
  lines: readonly LineFit<S>[],
  profile: HandProfile,
  strength: number,
  options: TidyOptions,
  slack: number,
): { pts: Map<string, number[]>; followers: Map<string, number> } {
  const pts = new Map<string, number[]>();
  const followers = new Map<string, number>();
  const layout = layoutOf(lines, options.rules ? null : profile);
  const lineDx = lines.map((line, li) => {
    const m = layout.margin[li] ?? 0;
    return Math.abs(m) > DEAD.margin * line.core ? strength * PULL.margin * m : 0;
  });
  const lineDy = lines.map((line, li) =>
    options.rules || !line.based || Math.abs(layout.pitch[li]) <= DEAD.pitch * line.core
      ? 0
      : clamp(PULL.pitch * layout.pitch[li], -0.45 * line.core, 0.45 * line.core),
  );
  // Every line's change; then a line that would come too near a neighbour changes
  // height and tilt only as far as it can without that. Of two lines that clash,
  // the one that would travel furthest gives way first.
  const give = lines.map(() => 1);
  const push = lines.map(() => 0);
  const moveOf = (li: number): LineMove =>
    moveFor(lines[li], strength, options.rules ?? null, lineDx[li], lineDy[li], give[li], push[li]);
  const boxesAfter = (li: number): Box[] => {
    const move = moveOf(li);
    return lines[li].pieces.map((p) =>
      unionOf(p.strokes.map((s) => boxOfPts(movedPts(s.pts, move)))),
    );
  };
  const boxesBefore = lines.map((l) => l.pieces.map((p) => p.box));
  const pairs: [number, number][] = [];
  for (let a = 0; a < lines.length; a++) {
    for (let b = 0; b < lines.length; b++) {
      if (a === b || !(lines[a].based || lines[b].based)) continue;
      if (lines[a].box[1] > lines[b].box[1]) continue;
      if (lines[b].box[1] - lines[a].box[3] > 3 * Math.max(lines[a].core, lines[b].core)) continue;
      if (Math.min(lines[a].box[2], lines[b].box[2]) <= Math.max(lines[a].box[0], lines[b].box[0]))
        continue;
      pairs.push([a, b]);
    }
  }
  const travel = lines.map((line, li) => {
    if (!line.based) return 0;
    const half = Math.max(line.box[2] - line.box[0], 0) / 2;
    return Math.abs(line.slope) * half + Math.abs(lineDy[li]) + Math.max(...line.off.map(Math.abs));
  });
  const side = pairs.map(([a, b]) => Math.max(lines[a].core, lines[b].core));
  const least = pairs.map(([a, b], k) => {
    const room = roomBetween(boxesBefore[a], boxesBefore[b], side[k]);
    return Math.min(room, LINE_CLEARANCE * side[k]) - slack * side[k];
  });
  const after = lines.map((_, li) => boxesAfter(li));
  const short = (k: number): number =>
    least[k] - roomBetween(after[pairs[k][0]], after[pairs[k][1]], side[k]);
  const clash = (k: number): boolean => short(k) > 0;
  const clashes = (li: number): boolean =>
    pairs.some(([a, b], k) => (a === li || b === li) && clash(k));
  for (let round = 0; round <= 2 * lines.length; round++) {
    let worst = -1;
    pairs.forEach((pair, k) => {
      if (!clash(k)) return;
      for (const li of pair) {
        if (give[li] > 0 && travel[li] > 0 && (worst < 0 || travel[li] > travel[worst])) worst = li;
      }
    });
    if (worst < 0) break;
    const set = (g: number): void => {
      give[worst] = g;
      after[worst] = boxesAfter(worst);
    };
    // First the whole change, a step away from the one neighbour it would crowd.
    let down = 0;
    let up = 0;
    pairs.forEach(([a, b], k) => {
      if (a !== worst && b !== worst) return;
      if (b === worst) down = Math.max(down, short(k));
      else up = Math.max(up, short(k));
    });
    const step = down > 0 && up <= 0 ? down : up > 0 && down <= 0 ? -up : 0;
    if (step !== 0 && push[worst] === 0 && Math.abs(step) <= MAX_PUSH * lines[worst].core) {
      push[worst] = step + Math.sign(step) * 0.05;
      after[worst] = boxesAfter(worst);
      if (!clashes(worst)) continue;
      push[worst] = 0;
      after[worst] = boxesAfter(worst);
    }
    // Else the most of its change the line can make; none when the clash is not its doing.
    let lo = 0;
    let hi = give[worst];
    set(0);
    if (clashes(worst)) continue;
    for (let step = 0; step < 5; step++) {
      const mid = (lo + hi) / 2;
      set(mid);
      if (clashes(worst)) hi = mid;
      else lo = mid;
    }
    set(lo);
  }
  const placed: { box: Box; line: number }[] = [];
  const inLines = new Set<string>();
  const moves = lines.map((_, li) => moveOf(li));
  lines.forEach((line, li) => {
    for (const piece of line.pieces) {
      for (const s of piece.strokes) {
        inLines.add(s.id);
        if (!line.based) continue;
        const next = movedPts(s.pts, moves[li]);
        if (differs(next, s.pts)) pts.set(s.id, next);
      }
      if (line.based) placed.push({ box: piece.box, line: li });
    }
  });

  // What is not writing (an underline, a highlight) follows the line it lies
  // on: one tidied line, under most of its length. A rule across a table, or a
  // frame round several lines, lies on no one line and stays.
  const reach = 0.6 * profile.xHeight;
  for (const s of strokes) {
    if (inLines.has(s.id) || s.pts.length < 3) continue;
    const b = boxOfPts(s.pts);
    const byLine = new Map<number, number>();
    for (const p of placed) {
      const overlap = Math.min(b[2], p.box[2]) - Math.max(b[0], p.box[0]);
      if (overlap <= 0 || b[1] > p.box[3] + reach || b[3] < p.box[1] - reach) continue;
      byLine.set(p.line, (byLine.get(p.line) ?? 0) + overlap);
    }
    if (byLine.size !== 1) continue;
    const [[host, weight]] = [...byLine.entries()];
    if (weight < FOLLOW_COVER * Math.max(b[2] - b[0], 1e-6)) continue;
    // On the line or just under it: a rule above a line belongs to what is above.
    const cx = (b[0] + b[2]) / 2;
    const cy = (b[1] + b[3]) / 2;
    const base = baseAt(lines[host], cx);
    if (cy < base - 1.2 * lines[host].core || cy > base + 1.3 * lines[host].core) continue;
    // Moved as the line's ink is moved at each x, so an underline under a line
    // that was levelled comes out level too.
    followers.set(s.id, lines[host].core);
    const next = movedPts(s.pts, moves[host]);
    if (differs(next, s.pts)) pts.set(s.id, next);
  }
  return { pts, followers };
}

/**
 * Tidy `strokes` (a selection, a line, a page). Returns new points for the
 * strokes that changed; nothing else about a stroke changes.
 */
export function tidyInk<S extends PageInk>(
  strokes: readonly S[],
  options: TidyOptions = {},
): TidyResult {
  const strength = clamp(options.strength ?? DEFAULT_STRENGTH, 0, 1);
  let lines = fitLines(strokes);
  const before = neatnessOf(lines);
  const profile = options.profile ?? profileOf(lines);
  if (strength === 0 || !profile || lines.length === 0) {
    return { pts: new Map<string, number[]>(), before, after: before };
  }
  // The ink as it stands after each round; a part strength is one round, or it would add up to the whole.
  let now: S[] = [...strokes];
  const followers = new Map<string, number>();
  const rounds = strength === 1 ? ROUNDS : 1;
  for (let round = 0; round < rounds; round++) {
    // Room between lines may be lost once, in the first round; later rounds only settle.
    const step = tidyRound(
      now,
      lines,
      profile,
      strength,
      options,
      round === 0 ? CLEARANCE_SLACK : 0.02,
    );
    for (const [id, core] of step.followers) followers.set(id, core);
    if (step.pts.size === 0) break;
    let far = 0;
    now = now.map((s) => {
      const next = step.pts.get(s.id);
      if (!next) return s;
      for (let i = 0; i + 1 < next.length; i += 3) {
        far = Math.max(far, Math.hypot(next[i] - s.pts[i], next[i + 1] - s.pts[i + 1]));
      }
      return { ...s, pts: next };
    });
    lines = fitLines(now);
    if (far < SETTLED * profile.xHeight) break;
  }
  const after = neatnessOf(lines);
  // Inside strokes, once, on the ink where it now stands.
  const inside = new Map<string, number[]>();
  if (options.strokes !== false) {
    for (const line of lines) {
      if (!line.based) continue;
      for (const piece of line.pieces) {
        for (const s of piece.strokes) {
          const kept = Array.from(s.pts);
          inside.set(
            s.id,
            straightBar(kept, line.core, strength * PULL.bar) ??
              smoothed(kept, SMOOTH_REACH * line.core),
          );
        }
      }
    }
    for (const s of now) {
      const core = followers.get(s.id);
      if (core === undefined || inside.has(s.id)) continue;
      const bar = straightBar(Array.from(s.pts), core, strength * PULL.bar);
      if (bar) inside.set(s.id, bar);
    }
  }
  const pts = new Map<string, number[]>();
  strokes.forEach((s, i) => {
    const next = inside.get(s.id) ?? (now[i].pts === s.pts ? null : Array.from(now[i].pts));
    if (next && differs(next, s.pts)) pts.set(s.id, next);
  });
  return { pts, before, after };
}
