/**
 * How ink looks, as polylines the canvas strokes with round caps and joins.
 * Pure: numbers in, {@link InkRun}s out; the renderer makes the `Path2D`s.
 *
 * Handwriting is traced by {@link InkTracer}: the pen's points are smoothed
 * by a quadratic curve through the midpoints between them, and the curve is
 * drawn as a line of the pen's width. The tracer only ever appends: a point
 * the pen adds settles the curve up to halfway to it, and nothing before that
 * moves again. That is what writing in Goodnotes feels like, and what the old
 * outline (perfect-freehand) could not do: it re-derived the whole tail on
 * every frame (a lagging streamline, the last 3 px skipped, one point of
 * look-ahead, a start cap that turned as the stroke grew), so ink already on
 * the page bent into new curves while the pen went on. Against Goodnotes it
 * redrew 38% of what it drew, where Goodnotes redraws 1.5% (Joost's
 * recordings, 2026-09-30).
 *
 * The canvas's own stroke draws the line, which is one shape however the
 * line crosses itself. Tracing the outline here instead, as a union of
 * overlapping pieces, left hairline cracks where the browser's anti-aliasing
 * met the pieces' edges (4-10x the old outline's count, measured). A pen
 * with pressure draws in runs, each of one width: a new run starts where the
 * width has moved {@link WIDTH_STEP} from its run's.
 *
 * A clean shape is not smoothed: it is its exact centreline at the nib's width.
 */

import { POINT_STRIDE } from "../model/document";

/** How a pen draws. */
export interface PenOptions {
  /** The nib's width in page px: the line's width at pressure 0.5. */
  size: number;
  /** How far pressure thins or thickens the line, 0..1; 0 keeps one width. */
  thinning: number;
}

/**
 * The pen at nib width `size`. With pressure the line is
 * `size × (1 − 0.6 × (1 − 2p))` wide: 0.4 of the nib at no pressure, the
 * nib at 0.5, 1.6 of it at full. Without, one width. (These are the widths
 * notes have been drawn at since the first release.)
 */
export function penOptions(size: number, pressure: boolean): PenOptions {
  return { size, thinning: pressure ? 0.6 : 0 };
}

/** Half the line's width at `pressure` (0..1; anything else reads as 0.5). */
export function radiusAt(pressure: number, pen: PenOptions): number {
  const p = Number.isFinite(pressure) ? Math.min(1, Math.max(0, pressure)) : 0.5;
  return Math.max(0.01, pen.size * (0.5 - pen.thinning * (0.5 - p)));
}

/**
 * A stretch of ink drawn at one width: a polyline the canvas strokes with
 * round caps and joins. One point draws a round dot.
 */
export interface InkRun {
  /** Line width, page px. */
  width: number;
  /** The polyline, flat `[x, y, …]`. */
  pts: number[];
  /** Join the end back to the start (a closed shape's first corner). */
  closed?: boolean;
}

/**
 * A stored stroke as runs: handwriting traced as it was written, a shape
 * (`shape`) along its exact centreline at the nib's width. Empty for no points.
 */
export function inkRuns(pts: readonly number[], pen: PenOptions, shape = false): InkRun[] {
  if (shape) return centrelineRuns(pts, pen.size);
  const tracer = new InkTracer(pen);
  for (let i = 0; i + POINT_STRIDE <= pts.length; i += POINT_STRIDE) {
    tracer.push(pts[i], pts[i + 1], pts[i + 2]);
  }
  return tracer.runs();
}

/**
 * The pen's points as runs, built as the pen moves. `push` adds a kept point
 * and settles whatever it can; `runs` returns the settled runs followed by
 * the part still waiting for the next point, the straight half segment to
 * the last point. Nothing settled ever changes, and pushing every point
 * then calling `runs()` gives the stroke exactly as it was drawn wet.
 *
 * Nothing is drawn ahead of the pen. WebKit's predicted samples reach
 * 40-50 screen px ahead and are wrong at every turn: drawn, they made the
 * tip swing into hooks and needles and take them back a frame later. Even
 * cut to 3 screen px along the pen's heading they left 6% of the ink
 * redrawn, against 1.7% without them and Goodnotes' 1.5% (measured on
 * synthetic handwriting, 2026-09-30).
 */
export class InkTracer {
  private pushed = 0;
  private prev: Dab | null = null;
  private last: Dab | null = null;
  private readonly chain = new RunChain();

  constructor(private readonly pen: PenOptions) {}

  /** How many points have been pushed. */
  get length(): number {
    return this.pushed;
  }

  push(x: number, y: number, pressure: number): void {
    this.pushed++;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const dab: Dab = { x, y, r: radiusAt(pressure, this.pen) };
    const { prev, last } = this;
    if (last && Math.hypot(x - last.x, y - last.y) < SAME_POINT) {
      // The pen pressed harder where it stood: a wider dot there, and the
      // line goes on from the wider point.
      if (dab.r > last.r) {
        this.chain.add(dab);
        this.last = dab;
      }
      return;
    }
    if (!last) {
      this.chain.add(dab);
    } else if (!prev) {
      // The first half segment, from the first point to the midpoint, is straight.
      this.chain.add(midpoint(last, dab));
    } else {
      this.curve(midpoint(prev, last), last, midpoint(last, dab));
    }
    this.prev = last;
    this.last = dab;
  }

  /**
   * The runs as they stand: the settled ones, then the straight half segment
   * to the last point. Settled runs are shared, not copied: read them, keep
   * nothing.
   */
  runs(): InkRun[] {
    if (!this.last) return [];
    const chain = this.chain.copy();
    if (this.prev) chain.add(this.last);
    return chain.runs;
  }

  /** The settled runs alone, copied: what no later point can change. */
  settled(): InkRun[] {
    return this.chain.runs.map((run) => ({ width: run.width, pts: [...run.pts] }));
  }

  /**
   * The quadratic from `a` bending at `c` to `b`, cut into as few straight
   * pieces as keep the line within {@link TOLERANCE} of the curve: a piece
   * strays by a quarter of the curve's bow over the pieces squared.
   */
  private curve(a: Dab, c: Dab, b: Dab): void {
    const bow = Math.hypot(c.x - (a.x + b.x) / 2, c.y - (a.y + b.y) / 2) / 2;
    const pieces = Math.min(MAX_PIECES, Math.max(1, Math.ceil(Math.sqrt(bow / TOLERANCE))));
    for (let i = 1; i <= pieces; i++) {
      const t = i / pieces;
      const u = 1 - t;
      const wa = u * u;
      const wc = 2 * u * t;
      const wb = t * t;
      this.chain.add({
        x: wa * a.x + wc * c.x + wb * b.x,
        y: wa * a.y + wc * c.y + wb * b.y,
        r: wa * a.r + wc * c.r + wb * b.r,
      });
    }
  }
}

/** How far the traced line may stray from the smoothed curve, page px: 0.1 screen px at 5x. */
export const TOLERANCE = 0.02;

/**
 * A run of a pressure pen keeps its width while the true width stays within
 * this fraction of it (and at least {@link WIDTH_STEP_MIN} page px): a step
 * of a few hundredths of a px where one run meets the next, which is not to
 * be seen at any zoom the page allows.
 */
export const WIDTH_STEP = 0.02;
const WIDTH_STEP_MIN = 0.01;

/**
 * At most this many pieces for one curve between two points: enough to keep
 * the tolerance for a bow of 80 px, which no two samples of a pen make.
 */
const MAX_PIECES = 64;

/** Two points closer than this (page px) are one. */
const SAME_POINT = 1e-6;

/** A point of the smoothed centreline, with the line's half width there. */
interface Dab {
  x: number;
  y: number;
  r: number;
}

/** The centreline so far, cut into runs of one width. The last run is open. */
class RunChain {
  runs: InkRun[] = [];
  /** The open run's half width. */
  private r = 0;
  /** The last point added, and the half width the line had there. */
  private lastX = Number.NaN;
  private lastY = Number.NaN;
  private lastR = 0;

  /** A chain that shares the settled runs and has its own copy of the open one. */
  copy(): RunChain {
    const copy = new RunChain();
    const open = this.runs[this.runs.length - 1];
    copy.runs = open ? [...this.runs.slice(0, -1), { width: open.width, pts: [...open.pts] }] : [];
    copy.r = this.r;
    copy.lastX = this.lastX;
    copy.lastY = this.lastY;
    copy.lastR = this.lastR;
    return copy;
  }

  add({ x, y, r }: Dab): void {
    const open = this.runs[this.runs.length - 1];
    if (!open) {
      this.runs.push({ width: 2 * r, pts: [x, y] });
      this.r = r;
    } else if (Math.hypot(x - this.lastX, y - this.lastY) < SAME_POINT) {
      // Wider where it stands: a dot of the new width; narrower: nothing to add.
      if (r > this.r + this.step()) {
        this.runs.push({ width: 2 * r, pts: [x, y] });
        this.r = r;
        this.lastR = r;
      }
      return;
    } else {
      // Where the width moves more than a step, the segment is cut where it
      // crosses each step, so no two runs differ by much more than one.
      const cuts = Math.min(64, Math.max(1, Math.ceil(Math.abs(r - this.lastR) / this.step())));
      let fromX = this.lastX;
      let fromY = this.lastY;
      for (let i = 1; i <= cuts; i++) {
        const t = i / cuts;
        const px = this.lastX + (x - this.lastX) * t;
        const py = this.lastY + (y - this.lastY) * t;
        const pr = this.lastR + (r - this.lastR) * t;
        if (Math.abs(pr - this.r) <= this.step()) {
          this.runs[this.runs.length - 1].pts.push(px, py);
        } else {
          // A new width starts where the last run ends, so the two join (round caps).
          this.runs.push({ width: 2 * pr, pts: [fromX, fromY, px, py] });
          this.r = pr;
        }
        fromX = px;
        fromY = py;
      }
    }
    this.lastX = x;
    this.lastY = y;
    this.lastR = r;
  }

  /** How far the width may drift from the open run's before a new run starts (half widths). */
  private step(): number {
    return Math.max(WIDTH_STEP_MIN, WIDTH_STEP * this.r);
  }
}

function midpoint(a: Dab, b: Dab): Dab {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, r: (a.r + b.r) / 2 };
}

/**
 * A shape's centreline as one run at `width`, closed when it ends where it
 * began (so a rectangle's first corner is joined, not capped twice). Empty
 * for no points.
 */
function centrelineRuns(pts: readonly number[], width: number): InkRun[] {
  const n = Math.floor(pts.length / POINT_STRIDE);
  if (n === 0) return [];
  const xy: number[] = [];
  for (let i = 0; i < n; i++) xy.push(pts[i * 3], pts[i * 3 + 1]);
  const closed =
    n > 2 &&
    Math.abs(pts[0] - pts[(n - 1) * 3]) < 1e-6 &&
    Math.abs(pts[1] - pts[(n - 1) * 3 + 1]) < 1e-6;
  return [closed ? { width, pts: xy, closed } : { width, pts: xy }];
}

/** Where a path goes: `Path2D` has these three, and so does {@link SvgPath}. */
export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
}

/**
 * Trace a run's polyline into `sink`. A single point traces a zero-length
 * line, which a round cap draws as a dot.
 */
export function traceRun(sink: PathSink, run: InkRun): void {
  const { pts } = run;
  if (pts.length < 2) return;
  sink.moveTo(pts[0], pts[1]);
  for (let i = 2; i + 1 < pts.length; i += 2) sink.lineTo(pts[i], pts[i + 1]);
  if (pts.length < 4) sink.lineTo(pts[0], pts[1]);
  if (run.closed) sink.closePath();
}

/** A {@link PathSink} that writes SVG path data, two decimals a number. */
export class SvgPath implements PathSink {
  private readonly parts: string[] = [];

  moveTo(x: number, y: number): void {
    this.parts.push(`M ${x.toFixed(2)} ${y.toFixed(2)}`);
  }

  lineTo(x: number, y: number): void {
    this.parts.push(`L ${x.toFixed(2)} ${y.toFixed(2)}`);
  }

  closePath(): void {
    this.parts.push("Z");
  }

  toString(): string {
    return this.parts.join(" ");
  }
}

/** A shape's centreline as SVG path data; empty for no points. */
export function centrelinePath(pts: readonly number[]): string {
  const svg = new SvgPath();
  for (const run of centrelineRuns(pts, 1)) traceRun(svg, run);
  return svg.toString();
}
