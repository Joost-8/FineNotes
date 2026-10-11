/**
 * The lines a page is written on, and which line each piece of ink sits on.
 *
 * The ruled tools (ruled erase, ruled select, insert space) work in lines,
 * not in page px. A template that has lines to write on says where they are
 * in `WRITING_LINES` beside the ruling table (`backdrop.ts`), and a test holds
 * every line to a rule its painter draws; anything else (blank, grids,
 * planners, music, covers, PDF pages) has none, and the tools fall back to
 * their plain versions there. Lines are always read from the page's current
 * template, never stored, so switching templates cannot leave stale lines.
 *
 * A page's lines come in blocks: a run of evenly spaced lines across one
 * x-range (a column, a header field, the summary band of a Cornell page).
 * Insert space moves ink within one block.
 *
 * PURE: no DOM. Page px throughout.
 */

import type { Bounds } from "../model/document";

/** A run of evenly spaced lines across one x-range. */
export interface LineBlock {
  x0: number;
  x1: number;
  /** Distance between two lines; the band a line owns is this tall. */
  pitch: number;
  /** Each line's rule, top to bottom: handwriting sits just above it. */
  baselines: number[];
}

/** Where a line is: its block and its index in the block. */
export interface LineRef {
  block: number;
  line: number;
}

/**
 * The share of a pitch below a rule that still belongs to the line above it:
 * descenders, commas and the tails of g and y.
 */
export const DESCENDER_SHARE = 0.25;

/**
 * Ink smaller than this share of a pitch both ways is a mark (a dot, a comma,
 * an accent) and takes the line of the writing nearest it.
 */
export const MARK_SHARE = 0.3;

/**
 * Lines every `step` from `first` while below `until`, across `x0..x1`.
 * The loop is the painters' own (`y += step`), so baselines match the drawn
 * rules exactly.
 */
export function evenBlock(
  x0: number,
  x1: number,
  first: number,
  step: number,
  until: number,
  pitch = step,
): LineBlock {
  const baselines: number[] = [];
  if (step > 0) for (let y = first; y < until; y += step) baselines.push(y);
  return { x0, x1, pitch, baselines };
}

/** The band of page y a line owns: the pitch above its rule, shifted down by the descender share. */
export function lineBand(block: LineBlock, line: number): { top: number; bottom: number } {
  const base = block.baselines[line];
  const shift = block.pitch * DESCENDER_SHARE;
  return { top: base - block.pitch + shift, bottom: base + shift };
}

/** The block whose x-range holds `x` and whose bands hold `y`, or -1. */
export function blockAt(blocks: readonly LineBlock[], x: number, y: number): number {
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const n = b.baselines.length;
    if (n === 0 || x < b.x0 || x > b.x1) continue;
    if (y >= lineBand(b, 0).top && y <= lineBand(b, n - 1).bottom) return i;
  }
  return -1;
}

/** The line at a point, or null off every block. */
export function lineAt(blocks: readonly LineBlock[], x: number, y: number): LineRef | null {
  const block = blockAt(blocks, x, y);
  if (block < 0) return null;
  const b = blocks[block];
  // Evenly spaced: the band index is arithmetic, clamped to the block.
  const first = lineBand(b, 0).top;
  const line = Math.min(b.baselines.length - 1, Math.max(0, Math.floor((y - first) / b.pitch)));
  return { block, line };
}

/**
 * The line a piece of ink sits on, from its bounds alone: the block holding
 * its centre, and the line whose band it overlaps most (ties go to the upper
 * line). A box too flat to overlap anything takes the band holding its centre.
 */
export function lineOfBounds(blocks: readonly LineBlock[], bounds: Bounds): LineRef | null {
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const block = blockAt(blocks, cx, cy);
  if (block < 0) return null;
  const b = blocks[block];
  if (bounds.maxY - bounds.minY < 1) return lineAt(blocks, cx, cy);
  let best = -1;
  let bestOverlap = 0;
  for (let i = 0; i < b.baselines.length; i++) {
    const band = lineBand(b, i);
    const overlap = Math.min(bounds.maxY, band.bottom) - Math.max(bounds.minY, band.top);
    if (overlap > bestOverlap) {
      best = i;
      bestOverlap = overlap;
    }
  }
  return best < 0 ? lineAt(blocks, cx, cy) : { block, line: best };
}

/** Whether a box is a mark (a dot, a comma) by the pitch of the block it is in. */
function isMark(blocks: readonly LineBlock[], ref: LineRef, bounds: Bounds): boolean {
  const limit = blocks[ref.block].pitch * MARK_SHARE;
  return bounds.maxX - bounds.minX < limit && bounds.maxY - bounds.minY < limit;
}

/**
 * The line of each piece of ink on a page, given all of them at once, so a
 * mark can follow its writing: an i's dot high above the x-height, a comma
 * hanging below the rule. A mark takes the line of the nearest piece that is
 * not a mark, in the same block and within a pitch of it; with none near, it
 * keeps its own.
 */
export function assignLines(
  blocks: readonly LineBlock[],
  items: readonly Bounds[],
): (LineRef | null)[] {
  const refs = items.map((bounds) => lineOfBounds(blocks, bounds));
  const marks = refs.map((ref, i) => ref !== null && isMark(blocks, ref, items[i]));
  return refs.map((ref, i) => {
    if (ref === null || !marks[i]) return ref;
    const reach = blocks[ref.block].pitch;
    let nearest: LineRef | null = null;
    let nearestGap = Infinity;
    refs.forEach((other, j) => {
      if (other === null || marks[j] || other.block !== ref.block) return;
      const gap = boxGap(items[i], items[j]);
      if (gap <= reach && gap < nearestGap) {
        nearest = other;
        nearestGap = gap;
      }
    });
    return nearest ?? ref;
  });
}

/** Distance between two boxes; 0 when they touch or overlap. */
export function boxGap(a: Bounds, b: Bounds): number {
  const dx = Math.max(0, a.minX - b.maxX, b.minX - a.maxX);
  const dy = Math.max(0, a.minY - b.maxY, b.minY - a.maxY);
  return Math.hypot(dx, dy);
}

/** Two pages' lines are the same layout: same blocks, pitches and lines. */
export function sameLines(a: readonly LineBlock[], b: readonly LineBlock[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (block, i) =>
        block.x0 === b[i].x0 &&
        block.x1 === b[i].x1 &&
        block.pitch === b[i].pitch &&
        block.baselines.length === b[i].baselines.length &&
        block.baselines.every((y, j) => y === b[i].baselines[j]),
    )
  );
}
