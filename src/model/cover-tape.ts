/**
 * Cover tape: opaque strips laid over part of a page, as in Goodnotes' tape
 * and Samsung Notes' cover, to hide answers while studying or to keep
 * something out of sight. A tap on a strip shows what is under it; another
 * covers it again.
 *
 * A tape is a stroke with `tool: "tape"` (contracts/api.md §2): its first and
 * last points are the middle of its two ends, and its `size` is its height,
 * page px. A straight tape has those two points only; a freehand tape has
 * more, and is a band `size` tall along the path through them, its ends cut
 * square (`isFreehandTape`). Being a stroke, it is selected, moved, turned,
 * resized, coloured, copied, erased and undone as ink is, and mirrored over
 * a join. It is
 * painted over everything else on the page, as a strip of paper over it.
 *
 * Whether a tape is revealed is never stored: it lives in the view, for this
 * session on this device. The file always holds tapes covered, so a shared,
 * synced or exported notebook stays covered, and so does every render made
 * from the document alone (thumbnails, PDF export, the AI's page image).
 *
 * PURE: no DOM, no Obsidian.
 */

import { levelLine } from "../ink/level-line";
import type { Stroke } from "./document";

/** Samples are `[x, y, pressure]` triples. */
const STRIDE = 3;

/** The tape's heights the pill offers, page px (an A4 page is 1024 wide). */
export const TAPE_HEIGHTS: readonly number[] = [22, 40, 72];

/** A new tape's height when none was picked. */
export const DEFAULT_TAPE_HEIGHT = 40;

/** The tape colours the pill offers: masking tape first. */
export const TAPE_COLORS: readonly string[] = [
  "#e6d3a3",
  "#f2c14e",
  "#f4a6b8",
  "#8fc9e8",
  "#9ad3a8",
  "#b9b4ad",
];

/** A new tape's colour when none was picked: masking tape. */
export const DEFAULT_TAPE_COLOR = TAPE_COLORS[0];

/** A drag shorter than this, page px at fit zoom, lays no tape (it was a tap). */
export const MIN_TAPE_LENGTH = 8;

/** How far a freehand tape's stored path may stray from the drag, page px at fit zoom. */
export const FREEHAND_TAPE_TOLERANCE = 0.5;

/** Whether a stroke is a cover tape. */
export function isTape(stroke: { tool: string }): boolean {
  return stroke.tool === "tape";
}

/** A point, page px. */
export interface TapePt {
  x: number;
  y: number;
}

/** How a new tape is laid: a straight strip from end to end, or along the drag. */
export type TapeMode = "straight" | "freehand";

/** A stored tape mode, straight for anything else. */
export function tapeModeOf(mode: unknown): TapeMode {
  return mode === "freehand" ? "freehand" : "straight";
}

/** The whole, finite points of `pts`, in order. */
function pathOf(pts: readonly number[]): TapePt[] {
  const out: TapePt[] = [];
  const usable = pts.length - (pts.length % STRIDE);
  for (let i = 0; i < usable; i += STRIDE) {
    const x = pts[i];
    const y = pts[i + 1];
    if (Number.isFinite(x) && Number.isFinite(y)) out.push({ x, y });
  }
  return out;
}

/** Whether a tape follows a drawn path: more than its two end points. */
export function isFreehandTape(pts: readonly number[]): boolean {
  return Math.floor(pts.length / STRIDE) > 2;
}

/**
 * The path a freehand tape follows, no two points on one spot; null for a
 * straight tape, or one with fewer than two distinct points (drawn as a
 * straight tape).
 */
export function tapePath(pts: readonly number[]): TapePt[] | null {
  if (!isFreehandTape(pts)) return null;
  const path: TapePt[] = [];
  for (const p of pathOf(pts)) {
    const last = path[path.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1e-6) path.push(p);
  }
  return path.length >= 2 ? path : null;
}

/** The unit normal of each segment of `path` (one fewer than its points). */
function segmentNormals(path: readonly TapePt[]): TapePt[] {
  const out: TapePt[] = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const dx = path[i + 1].x - path[i].x;
    const dy = path[i + 1].y - path[i].y;
    const length = Math.hypot(dx, dy) || 1;
    out.push({ x: -dy / length, y: dx / length });
  }
  return out;
}

/** The furthest a corner of a freehand tape's outline reaches, in half heights. */
const MAX_MITER = 2;

/**
 * Each point of a freehand path moved `offset` page px across it (negative:
 * to its left): an edge of the band. With `miter` a corner reaches out to
 * where the two edges meet (capped), for an outline; without it each point
 * stays `offset` from the path, so a line through them stays inside the
 * band, for fibres.
 */
export function offsetPath(path: readonly TapePt[], offset: number, miter: boolean): TapePt[] {
  const normals = segmentNormals(path);
  return path.map((p, i) => {
    const before = normals[Math.max(0, i - 1)];
    const after = normals[Math.min(normals.length - 1, i)];
    let nx = before.x + after.x;
    let ny = before.y + after.y;
    const length = Math.hypot(nx, ny);
    if (length < 1e-6) {
      nx = after.x;
      ny = after.y;
    } else {
      nx /= length;
      ny /= length;
    }
    const cos = nx * after.x + ny * after.y;
    const reach = miter ? offset / Math.max(1 / MAX_MITER, cos) : offset;
    return { x: p.x + nx * reach, y: p.y + ny * reach };
  });
}

/**
 * A tape's outline, page px: a straight tape's four corners
 * (`tapeCorners`), or round a freehand tape's band, its left edge forward
 * and its right edge back. Null when it has no points or no height.
 */
export function tapePolygon(pts: readonly number[], size: number): TapePt[] | null {
  const path = tapePath(pts);
  if (!path) return tapeCorners(pts, size);
  if (!(size > 0)) return null;
  const left = offsetPath(path, -size / 2, true);
  const right = offsetPath(path, size / 2, true);
  return [...left, ...right.reverse()];
}

/** Distance from `p` to segment `a`–`b`, and where along it `p` falls (0 at `a`, 1 at `b`). */
function toSegment(
  p: TapePt,
  a: TapePt,
  b: TapePt,
): { distance: number; t: number; length: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  const t = length < 1e-9 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / (length * length);
  const c = Math.max(0, Math.min(1, t));
  return { distance: Math.hypot(p.x - (a.x + dx * c), p.y - (a.y + dy * c)), t, length };
}

/** Whether `p` is within `reach` of a freehand path, its ends cut square (`slack` past them at most). */
function onPath(path: readonly TapePt[], p: TapePt, reach: number, slack: number): boolean {
  const last = path.length - 2;
  for (let i = 0; i <= last; i++) {
    const { distance, t, length } = toSegment(p, path[i], path[i + 1]);
    if (distance > reach) continue;
    const past = length > 0 ? slack / length : 0;
    if (i === 0 && t < -past) continue;
    if (i === last && t > 1 + past) continue;
    return true;
  }
  return false;
}

/** Ramer–Douglas–Peucker: the points of `path` that keep it within `tolerance`. */
function simplify(path: readonly TapePt[], tolerance: number): TapePt[] {
  const keep = new Uint8Array(path.length);
  keep[0] = 1;
  keep[path.length - 1] = 1;
  const stack: [number, number][] = [[0, path.length - 1]];
  while (stack.length > 0) {
    const [from, to] = stack.pop() as [number, number];
    let worst = -1;
    let far = 0;
    for (let i = from + 1; i < to; i++) {
      const { distance } = toSegment(path[i], path[from], path[to]);
      if (distance > far) {
        far = distance;
        worst = i;
      }
    }
    if (worst >= 0 && far > tolerance) {
      keep[worst] = 1;
      stack.push([from, worst], [worst, to]);
    }
  }
  return path.filter((_, i) => keep[i] === 1);
}

/** How far a pen-down or lift hook may run, page px at fit zoom. */
export const FREEHAND_TAPE_HOOK = 24;

/** A hook is cut only where the path turns at least this much, degrees. */
const HOOK_TURN = 50;

/** How smooth a freehand tape's path is: the averaging reach, in tape heights. */
export const FREEHAND_TAPE_SMOOTHING = 0.6;

/** Distances along `path` from its start, one per point. */
function along(path: readonly TapePt[]): number[] {
  const out = [0];
  for (let i = 1; i < path.length; i++) {
    out.push(out[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
  }
  return out;
}

/** The angle between two directions, degrees (0 to 180). */
function turnBetween(ax: number, ay: number, bx: number, by: number): number {
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (la < 1e-9 || lb < 1e-9) return 0;
  const cos = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * `path` without the hook the pen makes as it lands: the sharpest turn
 * within `budget` page px of the start (and no further than a sixth of the
 * path), cut there when it turns at least `HOOK_TURN`. The direction after
 * the turn is read over another `budget`, so a gentle curve is no hook.
 */
function trimStartHook(path: readonly TapePt[], budget: number): TapePt[] {
  if (path.length < 3 || !(budget > 0)) return path.slice();
  const dist = along(path);
  const total = dist[dist.length - 1];
  const reach = Math.min(budget, total / 6);
  let best = 0;
  let cut = -1;
  for (let k = 1; k < path.length - 1 && dist[k] <= reach; k++) {
    if (dist[k] < 1e-6) continue;
    let j = k + 1;
    while (j < path.length - 1 && dist[j] - dist[k] < budget) j++;
    const turn = turnBetween(
      path[k].x - path[0].x,
      path[k].y - path[0].y,
      path[j].x - path[k].x,
      path[j].y - path[k].y,
    );
    if (turn > best) {
      best = turn;
      cut = k;
    }
  }
  return best >= HOOK_TURN && cut > 0 ? path.slice(cut) : path.slice();
}

/** `path` resampled every `step` page px along it, its two ends kept. */
function resample(path: readonly TapePt[], step: number): TapePt[] {
  const dist = along(path);
  const total = dist[dist.length - 1];
  const count = Math.max(1, Math.round(total / step));
  const out: TapePt[] = [];
  let seg = 0;
  for (let n = 0; n <= count; n++) {
    const d = (total * n) / count;
    while (seg < path.length - 2 && dist[seg + 1] < d) seg++;
    const span = dist[seg + 1] - dist[seg];
    const t = span > 1e-9 ? (d - dist[seg]) / span : 0;
    out.push({
      x: path[seg].x + (path[seg + 1].x - path[seg].x) * t,
      y: path[seg].y + (path[seg + 1].y - path[seg].y) * t,
    });
  }
  return out;
}

/**
 * Evenly spaced points averaged over a Gaussian window of `half` points
 * either side. Past an end the path is mirrored through that end point, so
 * the end stays where it is and the window stays full width up to it (a
 * window narrowed at the ends would keep the wobble there).
 */
function averaged(path: readonly TapePt[], half: number): TapePt[] {
  const last = path.length - 1;
  const h = Math.min(half, last);
  if (h < 1) return path.slice();
  const at = (j: number): TapePt => {
    if (j < 0) return { x: 2 * path[0].x - path[-j].x, y: 2 * path[0].y - path[-j].y };
    if (j > last) {
      const m = 2 * last - j;
      return { x: 2 * path[last].x - path[m].x, y: 2 * path[last].y - path[m].y };
    }
    return path[j];
  };
  const sigma = h / 2;
  const weights: number[] = [];
  let total = 0;
  for (let k = -h; k <= h; k++) {
    const w = Math.exp(-(k * k) / (2 * sigma * sigma));
    weights.push(w);
    total += w;
  }
  return path.map((p, i) => {
    if (i === 0 || i === last) return p;
    let x = 0;
    let y = 0;
    for (let k = -h; k <= h; k++) {
      const q = at(i + k);
      x += q.x * weights[k + h];
      y += q.y * weights[k + h];
    }
    return { x: x / total, y: y / total };
  });
}

/** How a freehand tape's drag is cleaned before it is stored. */
export interface TapeSmoothing {
  /** The averaging reach, page px: wobbles shorter than this become a curve. */
  radius: number;
  /** How far a pen-down (and, with `lift`, lift) hook may run, page px. */
  hook: number;
  /** Whether the end is finished too: false while the pen is still down. */
  lift: boolean;
}

/**
 * A drag's path with its hooks cut (`smooth.hook`) and its wobble averaged
 * into a smooth curve (`smooth.radius`), its ends kept in place.
 */
export function smoothTapePath(path: readonly TapePt[], smooth: TapeSmoothing): TapePt[] {
  let out = trimStartHook(path, smooth.hook);
  if (smooth.lift) out = trimStartHook(out.slice().reverse(), smooth.hook).reverse();
  if (out.length < 3 || !(smooth.radius > 0)) return out;
  const step = Math.max(0.25, smooth.radius / 6);
  const even = resample(out, step);
  const half = Math.round(smooth.radius / step);
  return averaged(averaged(even, half), half);
}

/**
 * The points of a freehand tape drawn through `samples` (page px): with
 * `smooth`, its hooks cut and its wobble made a smooth curve; then
 * simplified to `tolerance` page px (0: every point), at the neutral
 * pressure a tape keeps.
 * Null when the path is shorter than `minLength`: a tap lays no tape. A path
 * that simplifies to one straight line is a straight tape.
 */
export function freehandTapePoints(
  samples: readonly TapePt[],
  tolerance: number,
  minLength = MIN_TAPE_LENGTH,
  smooth?: TapeSmoothing,
): number[] | null {
  const path = samples.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  let length = 0;
  for (let i = 1; i < path.length; i++) {
    length += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  }
  if (path.length < 2 || !(length >= minLength)) return null;
  const clean = smooth ? smoothTapePath(path, smooth) : path;
  const kept = tolerance > 0 ? simplify(clean, tolerance) : clean;
  const out: number[] = [];
  for (const p of kept) out.push(round2(p.x), round2(p.y), 0.5);
  return out;
}

/** The middles of a tape's two ends: its first and last points. Null for no points. */
export function tapeEnds(pts: readonly number[]): { a: TapePt; b: TapePt } | null {
  const usable = pts.length - (pts.length % STRIDE);
  if (usable < STRIDE) return null;
  const a = { x: pts[0], y: pts[1] };
  const b = { x: pts[usable - STRIDE], y: pts[usable - STRIDE + 1] };
  if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return null;
  return { a, b };
}

/**
 * A tape's four corners, round the strip from `a`'s left: the band from `a`
 * to `b`, `size` tall. A tape with both ends on one point (a tap, or ink
 * squeezed flat) is a square `size` a side, so it still covers something
 * and can still be found. Null when it has no points or no height.
 */
export function tapeCorners(pts: readonly number[], size: number): TapePt[] | null {
  const ends = tapeEnds(pts);
  if (!ends || !(size > 0)) return null;
  let { a, b } = ends;
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  let length = Math.hypot(dx, dy);
  if (length < 1e-6) {
    a = { x: a.x - size / 2, y: a.y };
    b = { x: a.x + size, y: a.y };
    dx = size;
    dy = 0;
    length = size;
  }
  const nx = (-dy / length) * (size / 2);
  const ny = (dx / length) * (size / 2);
  return [
    { x: a.x - nx, y: a.y - ny },
    { x: b.x - nx, y: b.y - ny },
    { x: b.x + nx, y: b.y + ny },
    { x: a.x + nx, y: a.y + ny },
  ];
}

/**
 * Whether page point (`x`, `y`) is on the tape, or within `tolerance` page
 * px of it: inside its band, measured along and across it.
 */
export function tapeContains(
  stroke: Pick<Stroke, "pts" | "size">,
  x: number,
  y: number,
  tolerance = 0,
): boolean {
  const path = tapePath(stroke.pts);
  if (path)
    return stroke.size > 0 && onPath(path, { x, y }, stroke.size / 2 + tolerance, tolerance);
  const ends = tapeEnds(stroke.pts);
  if (!ends || !(stroke.size > 0)) return false;
  const { a, b } = ends;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  const half = stroke.size / 2;
  if (length < 1e-6) {
    return Math.abs(x - a.x) <= half + tolerance && Math.abs(y - a.y) <= half + tolerance;
  }
  const ux = dx / length;
  const uy = dy / length;
  const along = (x - a.x) * ux + (y - a.y) * uy;
  const across = -(x - a.x) * uy + (y - a.y) * ux;
  return along >= -tolerance && along <= length + tolerance && Math.abs(across) <= half + tolerance;
}

/** The tape on top at (`x`, `y`): the last one in the list whose band holds it. */
export function topTapeAt<T extends Pick<Stroke, "tool" | "pts" | "size">>(
  strokes: readonly T[],
  x: number,
  y: number,
  tolerance = 0,
): T | null {
  for (let i = strokes.length - 1; i >= 0; i--) {
    const stroke = strokes[i];
    if (isTape(stroke) && tapeContains(stroke, x, y, tolerance)) return stroke;
  }
  return null;
}

/**
 * The points of a tape dragged from `from` to `to`: its two ends, made level
 * or upright when nearly so (`ink/level-line`, `maxRise` page px), at the
 * neutral pressure a tape keeps. Null when the drag is shorter than
 * `minLength`: a tap lays no tape.
 */
export function tapePoints(
  from: TapePt,
  to: TapePt,
  maxRise: number,
  minLength = MIN_TAPE_LENGTH,
): number[] | null {
  if (![from.x, from.y, to.x, to.y].every(Number.isFinite)) return null;
  if (Math.hypot(to.x - from.x, to.y - from.y) < minLength) return null;
  return levelLine([from.x, from.y, 0.5, to.x, to.y, 0.5], "start", maxRise);
}

/**
 * `strokes` with the tapes after everything else, each group in its own
 * order: the order a page is painted in, a tape over all the ink. The list
 * itself when it has no tape that needs to move.
 */
export function tapesLast<T extends { tool: string }>(strokes: readonly T[]): readonly T[] {
  let seenTape = false;
  let needsMove = false;
  for (const stroke of strokes) {
    if (isTape(stroke)) seenTape = true;
    else if (seenTape) {
      needsMove = true;
      break;
    }
  }
  if (!needsMove) return strokes;
  return [...strokes.filter((s) => !isTape(s)), ...strokes.filter(isTape)];
}

/** `revealed` with tape `id` shown if it was covered, covered if it was shown. */
export function toggleRevealed(revealed: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(revealed);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Whether every tape among `strokes` is revealed in `revealed` (false when there is none). */
export function allRevealed(
  strokes: readonly Pick<Stroke, "id" | "tool">[],
  revealed: ReadonlySet<string>,
): boolean {
  let any = false;
  for (const stroke of strokes) {
    if (!isTape(stroke)) continue;
    any = true;
    if (!revealed.has(stroke.id)) return false;
  }
  return any;
}

/** A rectangle, page px. */
export interface TapeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How far the clip's outer edge reaches round a box, CSS px: past its handles and shadow. */
const CLIP_REACH = 100000;

/**
 * A CSS `clip-path` that cuts the covered tapes among `strokes` out of a
 * text box at `box` (page px), drawn at `scale` CSS px a page px from its
 * top-left corner: a typed box under a tape is hidden where the tape lies,
 * as ink is. `shown` says which tapes the view shows through. "" when no
 * covered tape reaches the box. One polygon, even-odd: the outer square,
 * then each tape, joined by edges walked both ways (they cancel). Where two
 * tapes overlap on a box the overlap shows through.
 */
export function tapeClipPath<T extends Pick<Stroke, "tool" | "pts" | "size">>(
  strokes: readonly T[],
  box: TapeRect,
  scale: number,
  shown: (tape: T) => boolean = () => false,
): string {
  const R = CLIP_REACH;
  const px = (p: TapePt): string =>
    `${((p.x - box.x) * scale).toFixed(1)}px ${((p.y - box.y) * scale).toFixed(1)}px`;
  const outer = `${-R}px ${-R}px`;
  const points = [outer, `${R}px ${-R}px`, `${R}px ${R}px`, `${-R}px ${R}px`, outer];
  let cut = false;
  for (const stroke of strokes) {
    if (!isTape(stroke) || shown(stroke)) continue;
    const corners = tapePolygon(stroke.pts, stroke.size);
    if (!corners) continue;
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    if (
      Math.max(...xs) <= box.x ||
      Math.min(...xs) >= box.x + box.w ||
      Math.max(...ys) <= box.y ||
      Math.min(...ys) >= box.y + box.h
    )
      continue;
    cut = true;
    for (const corner of corners) points.push(px(corner));
    points.push(px(corners[0]), outer);
  }
  return cut ? `polygon(evenodd, ${points.join(", ")})` : "";
}

/** The thinnest tape the slider lays, page px (about 1.4 mm). */
export const MIN_TAPE_HEIGHT = 8;

/** The widest tape the slider lays, page px (about 3.4 cm): a whole paragraph. */
export const MAX_TAPE_HEIGHT = 200;

/**
 * A stored tape height, kept as asked within the slider's range (FineNotes#211),
 * to whole page px; the default for nonsense. The pill's three heights are
 * presets on that range, not the only heights.
 */
export function tapeHeightOf(size: unknown): number {
  if (typeof size !== "number" || !Number.isFinite(size) || !(size > 0)) {
    return DEFAULT_TAPE_HEIGHT;
  }
  return Math.min(MAX_TAPE_HEIGHT, Math.max(MIN_TAPE_HEIGHT, Math.round(size)));
}

/** A stored tape colour if it is `#rrggbb`, else masking tape. */
export function tapeColorOf(color: unknown): string {
  return typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color)
    ? color.toLowerCase()
    : DEFAULT_TAPE_COLOR;
}

/** A tape's side handles: its two ends, and the middles of its long edges. */
export type TapeHandle = "start" | "end" | "top" | "bottom";

export const TAPE_HANDLES: readonly TapeHandle[] = ["start", "end", "top", "bottom"];

/**
 * A tape's ends, its unit direction from `a` to `b`, and the unit normal
 * (`top` is on its minus side). A tape with both ends on one point is the
 * level square `tapeCorners` draws, its ends on the square's sides.
 */
function tapeAxes(
  pts: readonly number[],
  size: number,
): {
  a: TapePt;
  b: TapePt;
  ux: number;
  uy: number;
  nx: number;
  ny: number;
} | null {
  const ends = tapeEnds(pts);
  if (!ends) return null;
  const { a, b } = ends;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length < 1e-6) {
    const half = size / 2;
    return {
      a: { x: a.x - half, y: a.y },
      b: { x: a.x + half, y: a.y },
      ux: 1,
      uy: 0,
      nx: 0,
      ny: 1,
    };
  }
  const ux = (b.x - a.x) / length;
  const uy = (b.y - a.y) / length;
  return { a, b, ux, uy, nx: -uy, ny: ux };
}

/**
 * The bounds of a tape's band, page px: a straight tape's four corners, a
 * freehand tape's path with half its height round it. Null when it has none.
 */
export function tapeBounds(
  pts: readonly number[],
  size: number,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const path = tapePath(pts);
  if (path) {
    if (!(size > 0)) return null;
    const half = size / 2;
    return {
      minX: Math.min(...path.map((p) => p.x)) - half,
      minY: Math.min(...path.map((p) => p.y)) - half,
      maxX: Math.max(...path.map((p) => p.x)) + half,
      maxY: Math.max(...path.map((p) => p.y)) + half,
    };
  }
  const corners = tapeCorners(pts, size);
  if (!corners) return null;
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

/**
 * Where each of a tape's side handles sits, page px: on the middle of each
 * end and of each long edge, `out` further out, so on a level tape they land
 * on the middles of its selection frame's sides. Null for a freehand tape:
 * it has no straight sides, and resizes as ink does.
 */
export function tapeHandles(
  pts: readonly number[],
  size: number,
  out = 0,
): Record<TapeHandle, TapePt> | null {
  if (isFreehandTape(pts)) return null;
  const axes = tapeAxes(pts, size);
  if (!axes || !(size > 0)) return null;
  const { a, b, ux, uy, nx, ny } = axes;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const side = size / 2 + out;
  return {
    start: { x: a.x - ux * out, y: a.y - uy * out },
    end: { x: b.x + ux * out, y: b.y + uy * out },
    top: { x: mid.x - nx * side, y: mid.y - ny * side },
    bottom: { x: mid.x + nx * side, y: mid.y + ny * side },
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * A tape with one side handle dragged to `to`, page px: an end slides along
 * the tape (the other end stays), a long edge moves across it (the other
 * edge stays), so the tape gets longer or taller without the other changing
 * and without turning. Never shorter than `minLength` nor thinner than
 * `minSize`. Null when the tape has no points or no height, or is freehand.
 */
export function stretchTape(
  pts: readonly number[],
  size: number,
  handle: TapeHandle,
  to: TapePt,
  minLength: number,
  minSize: number,
): { pts: number[]; size: number } | null {
  if (isFreehandTape(pts)) return null;
  const axes = tapeAxes(pts, size);
  if (!axes || !(size > 0) || !Number.isFinite(to.x) || !Number.isFinite(to.y)) return null;
  let { a, b } = axes;
  const { ux, uy, nx, ny } = axes;
  let height = size;
  if (handle === "end" || handle === "start") {
    // Measured from the end that stays, along the tape.
    const along =
      handle === "end"
        ? (to.x - a.x) * ux + (to.y - a.y) * uy
        : (b.x - to.x) * ux + (b.y - to.y) * uy;
    const next = Math.max(minLength, along);
    if (handle === "end") b = { x: a.x + ux * next, y: a.y + uy * next };
    else a = { x: b.x - ux * next, y: b.y - uy * next };
  } else {
    // Across the tape from its middle line: `top` lies on the minus side.
    const across = (to.x - a.x) * nx + (to.y - a.y) * ny;
    const fixed = handle === "top" ? size / 2 : -size / 2;
    // Past the edge that stays, it stops at the floor rather than turning over.
    height = Math.max(minSize, handle === "top" ? fixed - across : across - fixed);
    // The edge that stays, and the middle line half the new height from it.
    const shift = handle === "top" ? fixed - height / 2 : fixed + height / 2;
    a = { x: a.x + nx * shift, y: a.y + ny * shift };
    b = { x: b.x + nx * shift, y: b.y + ny * shift };
  }
  const usable = pts.length - (pts.length % STRIDE);
  const pa = pts[2];
  const pb = pts[usable - 1];
  return {
    pts: [round2(a.x), round2(a.y), pa, round2(b.x), round2(b.y), pb],
    size: round2(height),
  };
}
