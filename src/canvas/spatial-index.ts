/**
 * The broad phase of hit testing: which strokes on a page could be near a
 * point or a box, without looking at every stroke on it. Pure: no DOM.
 *
 * The page is cut into square cells. A stroke is listed in every cell its
 * bounding box reaches, and a query gathers the strokes listed in the cells
 * its own box reaches — so it may return strokes a cell away from the query,
 * and callers confirm each one with an exact test (`hit-test.ts`, the lasso).
 *
 * The order of a result is part of the contract: cells row by row, top to
 * bottom and left to right, and within a cell the order the strokes went in.
 * The standard eraser numbers the pieces it cuts in that order.
 */

import { type Bounds, type Stroke, strokeBounds } from "../model/document";

/** Cell side, in page px: a few words of handwriting. */
const CELL_SIZE = 256;

/** The block of cells a box reaches, first and last row and column included. */
interface CellBlock {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export class SpatialIndex {
  /** Row, then column, to the ids listed in that cell, in the order they were listed. */
  private readonly rows = new Map<number, Map<number, Set<string>>>();
  /** The cells each id was listed in, so that it can be taken out again. */
  private readonly listed = new Map<string, CellBlock>();

  constructor(private readonly cell = CELL_SIZE) {}

  /** List a stroke under its bounding box. A stroke without a whole point is not listed. */
  insert(stroke: Stroke): void {
    const box = strokeBounds(stroke);
    if (!box) return;
    const block = this.blockOf(box);
    this.listed.set(stroke.id, block);
    for (let row = block.top; row <= block.bottom; row++) {
      const columns = this.rows.get(row) ?? new Map<number, Set<string>>();
      this.rows.set(row, columns);
      for (let col = block.left; col <= block.right; col++) {
        const ids = columns.get(col) ?? new Set<string>();
        columns.set(col, ids.add(stroke.id));
      }
    }
  }

  /** Take a stroke out. An id that was never listed is ignored. */
  remove(strokeId: string): void {
    const block = this.listed.get(strokeId);
    if (!block) return;
    this.listed.delete(strokeId);
    for (let row = block.top; row <= block.bottom; row++) {
      const columns = this.rows.get(row);
      if (!columns) continue;
      for (let col = block.left; col <= block.right; col++) {
        const ids = columns.get(col);
        if (!ids) continue;
        ids.delete(strokeId);
        if (ids.size === 0) columns.delete(col);
      }
      if (columns.size === 0) this.rows.delete(row);
    }
  }

  /** The strokes listed in the cells `box` reaches, each once, in the order above. */
  queryBounds(box: Bounds): Set<string> {
    return this.gather(this.blockOf(box));
  }

  /** The strokes that could be within `reach` of (x, y): a query of the square around it. */
  queryPoint(x: number, y: number, reach = 0): Set<string> {
    const [x0, x1, y0, y1] = [x - reach, x + reach, y - reach, y + reach];
    return this.gather(this.blockOf({ minX: x0, minY: y0, maxX: x1, maxY: y1 }));
  }

  /** Forget everything, then list a page's strokes in order. */
  rebuild(page: readonly Stroke[]): void {
    this.clear();
    page.forEach((stroke) => this.insert(stroke));
  }

  /** Forget every stroke. */
  clear(): void {
    this.listed.clear();
    this.rows.clear();
  }

  private gather(block: CellBlock): Set<string> {
    const found = new Set<string>();
    for (let row = block.top; row <= block.bottom; row++) {
      const columns = this.rows.get(row);
      if (!columns) continue;
      for (let col = block.left; col <= block.right; col++) {
        const ids = columns.get(col);
        if (ids) for (const id of ids) found.add(id);
      }
    }
    return found;
  }

  private blockOf(box: Bounds): CellBlock {
    const at = (v: number): number => Math.floor(v / this.cell);
    return { top: at(box.minY), left: at(box.minX), bottom: at(box.maxY), right: at(box.maxX) };
  }
}
