/**
 * The ruled tools' choices on one page: what the ruled eraser takes, and
 * which ink a ruled selection holds. Both work on whole pieces of ink by the
 * line they sit on (`writing-lines.ts`), which is what lets a pass of the
 * eraser take a word with its comma and its i's dot.
 *
 * PURE: no DOM. Page px throughout.
 */

import { type Bounds, type Stroke, strokeBounds } from "../model/document";
import { type EraseRect, type EraserFilter, eraserTakes } from "../ink/stroke-eraser";
import { strokeHitByPoint } from "./hit-test";
import {
  type LineBlock,
  type LineRef,
  assignLines,
  lineAt,
  lineBand,
  ruleBand,
} from "./writing-lines";

/**
 * On a page whose lines run from the left edge, the strip that counts as
 * its margin, as a share of the page's width.
 */
export const MARGIN_SHARE = 0.04;

/**
 * Ink taller than this many pitches is a drawing, not writing: insert space
 * leaves it where it is.
 */
export const DRAWING_PITCHES = 2;

/**
 * Whether the ruled eraser cuts this ink instead of taking it whole: a
 * highlight, a shape, or ink across more than one line (it reaches more than
 * half a pitch into a second line's band). A word is at most about a pitch
 * tall, so it lies at most half in each of two bands and is taken whole.
 */
export function ruledCuts(block: LineBlock, stroke: Stroke, bounds: Bounds): boolean {
  if (stroke.tool === "highlighter" || stroke.shape !== undefined) return true;
  const overlaps = block.baselines.map((_, line) => {
    const band = lineBand(block, line);
    return Math.max(0, Math.min(bounds.maxY, band.bottom) - Math.max(bounds.minY, band.top));
  });
  overlaps.sort((a, b) => b - a);
  return (overlaps[1] ?? 0) > block.pitch / 2;
}

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

/** What one dab of the ruled eraser did. */
export interface RuledDab {
  /** Strokes it takes whole that no earlier dab took. */
  taken: string[];
  /** Strokes to cut by {@link RuledEraser.regions}, which this dab grew where they lie. */
  cut: string[];
}

/** A line's erased stretches so far: its band, and merged x-spans along it. */
interface LineRegion {
  top: number;
  bottom: number;
  spans: Array<[number, number]>;
}

/**
 * The ruled eraser over one page, for one pass. A dab on a line takes every
 * stroke on that line whose width it passes over, whatever its height: dots
 * above and commas below go with their words. A pass that starts in the
 * margin erases whole lines, across every column.
 *
 * Ink that is not a word ({@link ruledCuts}: a highlight, a shape, a stroke
 * across lines) is cut instead: only its part inside the erased stretch of
 * the line goes, the stretch being the band under the pass and under the
 * words it took. A highlight loses only what lay under the erased words.
 * Ink on no line at all goes whole, where the eraser touches it.
 */
export class RuledEraser {
  /** Whether this pass started in the margin, and so erases whole lines. */
  readonly wholeLines: boolean;
  private readonly byLine = new Map<string, LinedItem<Stroke>[]>();
  private readonly unlined: LinedItem<Stroke>[] = [];
  private readonly cuttable: LinedItem<Stroke>[] = [];
  private readonly taken = new Set<string>();
  private readonly erased = new Map<string, LineRegion>();

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
      if (lined.line === null) {
        this.unlined.push(lined);
        continue;
      }
      if (ruledCuts(blocks[lined.line.block], lined.item, lined.bounds)) {
        this.cuttable.push(lined);
        continue;
      }
      const key = lineKey(lined.line);
      const list = this.byLine.get(key);
      if (list) list.push(lined);
      else this.byLine.set(key, [lined]);
    }
  }

  /** What a dab at `at` takes whole, and which strokes it cuts further. */
  dab(at: { x: number; y: number }, radius: number): RuledDab {
    const taken: string[] = [];
    const cut = new Set<string>();
    const take = (stroke: Stroke): void => {
      if (this.taken.has(stroke.id)) return;
      this.taken.add(stroke.id);
      taken.push(stroke.id);
    };
    const erase = (ref: LineRef, lo: number, hi: number): void => {
      for (const id of this.eraseStretch(ref, lo, hi)) cut.add(id);
    };
    if (this.wholeLines) {
      for (const ref of this.linesAcross(at.y)) {
        for (const lined of this.byLine.get(lineKey(ref)) ?? []) take(lined.item);
        // The whole line, margins and gutters too: a highlight started in
        // the margin goes with its line.
        erase(ref, -Infinity, Infinity);
      }
      return { taken, cut: [...cut] };
    }
    const ref = lineAt(this.blocks, at.x, at.y);
    if (ref) {
      erase(ref, at.x - radius, at.x + radius);
      for (const lined of this.byLine.get(lineKey(ref)) ?? []) {
        const b = lined.bounds;
        if (this.taken.has(lined.item.id) || at.x < b.minX - radius || at.x > b.maxX + radius) {
          continue;
        }
        take(lined.item);
        // What lay under the word goes with it: its highlight.
        erase(ref, b.minX, b.maxX);
      }
    }
    for (const lined of this.unlined) {
      if (strokeHitByPoint(lined.item, at.x, at.y, radius)) take(lined.item);
    }
    return { taken, cut: [...cut] };
  }

  /** Every stretch of line this pass has erased, as rectangles to cut ink by. */
  regions(): EraseRect[] {
    const out: EraseRect[] = [];
    for (const region of this.erased.values()) {
      for (const [minX, maxX] of region.spans) {
        out.push({ minX, maxX, minY: region.top, maxY: region.bottom });
      }
    }
    return out;
  }

  /**
   * Add `lo..hi` of line `ref` to the erased stretches, and return the
   * cuttable strokes that reach it, unless it was all erased already.
   */
  private eraseStretch(ref: LineRef, lo: number, hi: number): string[] {
    const key = lineKey(ref);
    let region = this.erased.get(key);
    if (!region) {
      const band = lineBand(this.blocks[ref.block], ref.line);
      region = { top: band.top, bottom: band.bottom, spans: [] };
      this.erased.set(key, region);
    }
    if (region.spans.some(([a, b]) => a <= lo && b >= hi)) return [];
    const spans: Array<[number, number]> = [...region.spans, [lo, hi]];
    spans.sort((p, q) => p[0] - q[0]);
    region.spans = [];
    for (const span of spans) {
      const last = region.spans[region.spans.length - 1];
      if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
      else region.spans.push([span[0], span[1]]);
    }
    const { top, bottom } = region;
    return this.cuttable
      .filter(({ item, bounds }) => {
        const pad = item.size / 2;
        return (
          bounds.minX - pad <= hi &&
          bounds.maxX + pad >= lo &&
          bounds.minY <= bottom &&
          bounds.maxY >= top
        );
      })
      .map(({ item }) => item.id);
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

/** One end of a ruled selection: a line, and how far along it. */
export interface LineMark {
  line: number;
  x: number;
}

/** A ruled selection: from one point to another in one block, as text is selected. */
export interface LineSpan {
  block: number;
  from: LineMark;
  to: LineMark;
}

/**
 * The span from where the pen went down to where it is: the block under the
 * pen-down (none, when it went down on no line), with the other end held to
 * that block. Ordered top to bottom, then left to right.
 */
export function lineSpan(
  blocks: readonly LineBlock[],
  a: { x: number; y: number },
  b: { x: number; y: number },
): LineSpan | null {
  const start = lineAt(blocks, a.x, a.y);
  if (!start) return null;
  const block = blocks[start.block];
  const first = lineBand(block, 0).top;
  const line = Math.min(
    block.baselines.length - 1,
    Math.max(0, Math.floor((b.y - first) / block.pitch)),
  );
  const x = Math.min(block.x1, Math.max(block.x0, b.x));
  const p: LineMark = { line: start.line, x: a.x };
  const q: LineMark = { line, x };
  const forward = q.line > p.line || (q.line === p.line && q.x >= p.x);
  return { block: start.block, from: forward ? p : q, to: forward ? q : p };
}

/** Whether ink on line `ref`, with these bounds, lies in the span: its centre, by line and x. */
export function inLineSpan(span: LineSpan, ref: LineRef | null, bounds: Bounds): boolean {
  if (!ref || ref.block !== span.block) return false;
  if (ref.line < span.from.line || ref.line > span.to.line) return false;
  const cx = (bounds.minX + bounds.maxX) / 2;
  if (ref.line === span.from.line && cx < span.from.x) return false;
  if (ref.line === span.to.line && cx > span.to.x) return false;
  return true;
}

/**
 * The outline of a span, as a closed loop of page points `[x, y, …]`: the
 * staircase a text selection makes, from the first line's start mark to the
 * block's right edge, down whole lines, and back along the last line to
 * its end mark.
 */
export function spanOutline(block: LineBlock, span: LineSpan): number[] {
  // Rule to rule, as the paper shows the lines.
  const top = ruleBand(block, span.from.line).top;
  const firstBottom = ruleBand(block, span.from.line).bottom;
  const lastTop = ruleBand(block, span.to.line).top;
  const bottom = ruleBand(block, span.to.line).bottom;
  const { x0, x1 } = block;
  if (span.from.line === span.to.line) {
    return [span.from.x, top, span.to.x, top, span.to.x, bottom, span.from.x, bottom];
  }
  return [
    span.from.x,
    top,
    x1,
    top,
    x1,
    lastTop,
    span.to.x,
    lastTop,
    span.to.x,
    bottom,
    x0,
    bottom,
    x0,
    firstBottom,
    span.from.x,
    firstBottom,
  ];
}
