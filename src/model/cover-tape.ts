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

/** The bounds of a tape's band, page px: its four corners, no caps. Null when it has none. */
export function tapeBounds(
  pts: readonly number[],
  size: number,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
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
 * on the middles of its selection frame's sides.
 */
export function tapeHandles(
  pts: readonly number[],
  size: number,
  out = 0,
): Record<TapeHandle, TapePt> | null {
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
 * `minSize`. Null when the tape has no points or no height.
 */
export function stretchTape(
  pts: readonly number[],
  size: number,
  handle: TapeHandle,
  to: TapePt,
  minLength: number,
  minSize: number,
): { pts: number[]; size: number } | null {
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
