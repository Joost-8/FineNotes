/**
 * Cover tape: opaque strips laid over part of a page, as in Goodnotes' tape
 * and Samsung Notes' cover, to hide answers while studying or to keep
 * something out of sight. A tap on a strip shows what is under it; another
 * covers it again.
 *
 * A tape is a stroke with `tool: "tape"` (contracts/api.md §2): its first and
 * last points are the middle of its two ends, and its `size` is its height,
 * page px. Being a stroke, it is selected, moved, turned, resized, coloured,
 * copied, erased and undone as ink is, and mirrored over a join. It is
 * painted over everything else on the page, as a strip of paper over it.
 *
 * A tape left open (`open`) is saved so: it opens open on every device, and
 * a PDF export or a thumbnail shows what is under it. Opening and closing is
 * never an undo step. A covered tape hides typed text boxes under it too.
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

/** Whether a stroke is a cover tape. */
export function isTape(stroke: { tool: string }): boolean {
  return stroke.tool === "tape";
}

/** A point, page px. */
export interface TapePt {
  x: number;
  y: number;
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

/** Whether `stroke` is a cover tape left open: shown through, saved so. */
export function isOpenTape(stroke: Pick<Stroke, "tool" | "open">): boolean {
  return isTape(stroke) && stroke.open === true;
}

/** Whether every tape among `strokes` is open (false when there is none). */
export function allOpen(strokes: readonly Pick<Stroke, "tool" | "open">[]): boolean {
  let any = false;
  for (const stroke of strokes) {
    if (!isTape(stroke)) continue;
    any = true;
    if (stroke.open !== true) return false;
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
 * as ink is. "" when no covered tape reaches the box. One polygon, even-odd:
 * the outer square, then each tape, joined by edges walked both ways (they
 * cancel). Where two tapes overlap on a box the overlap shows through.
 */
export function tapeClipPath(
  strokes: readonly Pick<Stroke, "tool" | "open" | "pts" | "size">[],
  box: TapeRect,
  scale: number,
): string {
  const R = CLIP_REACH;
  const px = (p: TapePt): string =>
    `${((p.x - box.x) * scale).toFixed(1)}px ${((p.y - box.y) * scale).toFixed(1)}px`;
  const outer = `${-R}px ${-R}px`;
  const points = [outer, `${R}px ${-R}px`, `${R}px ${R}px`, `${-R}px ${R}px`, outer];
  let cut = false;
  for (const stroke of strokes) {
    if (!isTape(stroke) || stroke.open === true) continue;
    const corners = tapeCorners(stroke.pts, stroke.size);
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

/** The tape height closest to `size` among {@link TAPE_HEIGHTS}; the default for nonsense. */
export function tapeHeightOf(size: unknown): number {
  if (typeof size !== "number" || !(size > 0)) return DEFAULT_TAPE_HEIGHT;
  let best = TAPE_HEIGHTS[0];
  for (const height of TAPE_HEIGHTS) {
    if (Math.abs(height - size) < Math.abs(best - size)) best = height;
  }
  return best;
}

/** A stored tape colour if it is `#rrggbb`, else masking tape. */
export function tapeColorOf(color: unknown): string {
  return typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color)
    ? color.toLowerCase()
    : DEFAULT_TAPE_COLOR;
}
