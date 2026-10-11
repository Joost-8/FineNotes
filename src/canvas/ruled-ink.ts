/**
 * The ruled tools' choices on one page: what the ruled eraser takes, and
 * which ink a ruled selection holds. Both work on whole pieces of ink by the
 * line they sit on (`writing-lines.ts`), which is what lets a pass of the
 * eraser take a word with its comma and its i's dot.
 *
 * PURE: no DOM. Page px throughout.
 */

import { type Bounds, type Stroke, strokeBounds } from "../model/document";
import { type EraserFilter, eraserTakes } from "../ink/stroke-eraser";
import { strokeHitByPoint } from "./hit-test";
import { type LineBlock, type LineRef, assignLines, lineAt, lineBand } from "./writing-lines";

/**
 * On a page whose lines run from the left edge, the strip that counts as
 * its margin, as a share of the page's width.
 */
export const MARGIN_SHARE = 0.04;

/**
 * Ink taller than this many pitches is a drawing, not writing: the ruled
 * eraser takes it only where it touches it, never for passing its line.
 */
export const DRAWING_PITCHES = 2;

/** Where the page's margin ends: the leftmost line's start, or a thin strip. */
export function marginEdge(blocks: readonly LineBlock[], width: number): number {
  const left = Math.min(...blocks.map((b) => b.x0));
  return Number.isFinite(left) && left > 0 ? left : width * MARGIN_SHARE;
}

/** A piece of ink, with its bounds and the line it sits on (null: on none). */
export interface LinedItem<T> {
  item: T;
  bounds: Bounds;
  line: LineRef | null;
}

/** Every item with its line, worked out together so marks follow their writing. */
export function linedItems<T>(
  blocks: readonly LineBlock[],
  items: readonly T[],
  boundsOf: (item: T) => Bounds | null,
): LinedItem<T>[] {
  const known: { item: T; bounds: Bounds }[] = [];
  for (const item of items) {
    const bounds = boundsOf(item);
    if (bounds) known.push({ item, bounds });
  }
  const lines = assignLines(
    blocks,
    known.map((k) => k.bounds),
  );
  return known.map((k, i) => ({ ...k, line: lines[i] }));
}

const lineKey = (ref: LineRef): string => `${ref.block}:${ref.line}`;

/**
 * The ruled eraser over one page, for one pass. A dab on a line takes every
 * stroke on that line whose width it passes over, whatever its height: dots
 * above and commas below go with their words. Ink on no line, and drawings
 * taller than {@link DRAWING_PITCHES} lines, go only where the eraser
 * touches them. A pass that starts in the margin
 * erases whole lines, across every column.
 */
export class RuledEraser {
  /** Whether this pass started in the margin, and so erases whole lines. */
  readonly wholeLines: boolean;
  private readonly byLine = new Map<string, LinedItem<Stroke>[]>();
  private readonly unlined: LinedItem<Stroke>[] = [];
  private readonly taken = new Set<string>();

  constructor(
    private readonly blocks: readonly LineBlock[],
    strokes: readonly Stroke[],
    start: { x: number; y: number },
    width: number,
    filter: EraserFilter = "all",
  ) {
    this.wholeLines = start.x < marginEdge(blocks, width);
    for (const lined of linedItems(blocks, strokes, strokeBounds)) {
      if (!eraserTakes(lined.item, filter)) continue;
      const pitch = lined.line ? blocks[lined.line.block].pitch : 0;
      if (lined.line === null || lined.bounds.maxY - lined.bounds.minY > pitch * DRAWING_PITCHES) {
        this.unlined.push(lined);
        continue;
      }
      const key = lineKey(lined.line);
      const list = this.byLine.get(key);
      if (list) list.push(lined);
      else this.byLine.set(key, [lined]);
    }
  }

  /** The ids of strokes a dab at `at` takes that no earlier dab took. */
  dab(at: { x: number; y: number }, radius: number): string[] {
    const out: string[] = [];
    const take = (stroke: Stroke): void => {
      if (this.taken.has(stroke.id)) return;
      this.taken.add(stroke.id);
      out.push(stroke.id);
    };
    if (this.wholeLines) {
      for (const ref of this.linesAcross(at.y)) {
        for (const lined of this.byLine.get(lineKey(ref)) ?? []) take(lined.item);
      }
      return out;
    }
    const ref = lineAt(this.blocks, at.x, at.y);
    if (ref) {
      for (const lined of this.byLine.get(lineKey(ref)) ?? []) {
        const b = lined.bounds;
        if (at.x >= b.minX - radius && at.x <= b.maxX + radius) take(lined.item);
      }
    }
    for (const lined of this.unlined) {
      if (strokeHitByPoint(lined.item, at.x, at.y, radius)) take(lined.item);
    }
    return out;
  }

  /** The line at height `y` in every block that has one there. */
  private linesAcross(y: number): LineRef[] {
    const out: LineRef[] = [];
    this.blocks.forEach((block, i) => {
      for (let line = 0; line < block.baselines.length; line++) {
        const band = lineBand(block, line);
        if (y >= band.top && y < band.bottom) out.push({ block: i, line });
      }
    });
    return out;
  }
}
