/**
 * Which part of a stroke being written changed since the last frame, and
 * which of its ink lies in that part: what lets a frame clear and repaint a
 * small rectangle instead of the whole layer (FineNotes#201). PURE.
 *
 * The tracer's settled runs only grow (`InkTracer`), so a {@link RunMark}
 * taken on one frame still names the same point on the next.
 */

import type { InkRun } from "./freehand";

/** A box in the runs' own space. */
export interface RunBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** A place in a list of runs: how many runs it has, and how many numbers the last one holds. */
export interface RunMark {
  runs: number;
  open: number;
}

/** The end of `runs` as they stand. */
export function markOf(runs: readonly InkRun[]): RunMark {
  const last = runs[runs.length - 1];
  return { runs: runs.length, open: last ? last.pts.length : 0 };
}

/**
 * How far a run's ink reaches from its centreline: half its width. A chisel
 * tip is `width` tall and narrower across (`ink/chisel`), so that holds it.
 */
function reachOf(run: InkRun): number {
  return run.width / 2;
}

/**
 * The box of the ink that comes after `mark`: the points added since, joined
 * to the point before them, each widened by its run's reach. With no mark,
 * the box of all of it. Null when there is nothing to bound.
 */
export function boundsSince(runs: readonly InkRun[], mark: RunMark | null): RunBox | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const first = mark ? Math.max(0, mark.runs - 1) : 0;
  for (let r = first; r < runs.length; r++) {
    const run = runs[r];
    const reach = reachOf(run);
    // The marked run goes on from its last point.
    const from = mark && r === first ? Math.max(0, mark.open - 2) : 0;
    for (let i = from - (from % 2); i + 1 < run.pts.length; i += 2) {
      const x = run.pts[i];
      const y = run.pts[i + 1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x - reach < minX) minX = x - reach;
      if (y - reach < minY) minY = y - reach;
      if (x + reach > maxX) maxX = x + reach;
      if (y + reach > maxY) maxY = y + reach;
    }
  }
  return minX <= maxX && minY <= maxY ? { minX, minY, maxX, maxY } : null;
}

/** The box round both; either may be null. */
export function unionBox(a: RunBox | null, b: RunBox | null): RunBox | null {
  if (!a) return b;
  if (!b) return a;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/**
 * The stretches of `run` whose ink can touch `box`, as point-index pairs
 * `[first, last, first, last, …]` (a point is two numbers of `pts`), each a
 * stretch of consecutive points. A segment counts when its own box, widened
 * by the run's reach, overlaps `box`. A closed run and a dot count whole or
 * not at all. A chisel run is cut like any other: the tip sweeps each
 * segment by itself, so a stretch of it draws what the whole run draws there.
 */
export function stretchesWithin(run: InkRun, box: RunBox): number[] {
  const { pts } = run;
  const count = Math.floor(pts.length / 2);
  if (count === 0) return [];
  const reach = reachOf(run);
  const touches = (ax: number, ay: number, bx: number, by: number): boolean =>
    Math.min(ax, bx) - reach <= box.maxX &&
    Math.max(ax, bx) + reach >= box.minX &&
    Math.min(ay, by) - reach <= box.maxY &&
    Math.max(ay, by) + reach >= box.minY;
  if (count === 1) return touches(pts[0], pts[1], pts[0], pts[1]) ? [0, 0] : [];
  if (run.closed) {
    for (let i = 0; i + 1 < count; i++) {
      if (touches(pts[2 * i], pts[2 * i + 1], pts[2 * i + 2], pts[2 * i + 3])) return [0, count - 1];
    }
    return [];
  }
  const out: number[] = [];
  let start = -1;
  for (let i = 0; i + 1 < count; i++) {
    const hit = touches(pts[2 * i], pts[2 * i + 1], pts[2 * i + 2], pts[2 * i + 3]);
    if (hit && start < 0) start = i;
    if (!hit && start >= 0) {
      out.push(start, i);
      start = -1;
    }
  }
  if (start >= 0) out.push(start, count - 1);
  return out;
}
