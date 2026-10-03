/**
 * The grid of sharp PDF tiles for a deeply zoomed page. Pure.
 *
 * Above `PDF_DETAIL_ZOOM` a PDF page is drawn sharp in square tiles of
 * `PDF_TILE_PX` device px at the view's level, rendered by pdf.js in a
 * worker (`view/pdf-worker.ts`) so they can be asked for while the view
 * moves. The grid is fixed per level, so a tile's key never changes as the
 * view moves, and tiles already cached are reused wherever they fall.
 */

import type { Bounds, PageGeometry } from "../model/document";

/** A PDF tile's side, in device px (the ink tiles' size too). */
export const PDF_TILE_PX = 512;

export interface PdfTile {
  col: number;
  row: number;
  /** Page-space area, cut at the page's edges. */
  region: Bounds;
  /** Whether it shows on screen now; the others are rendered ahead. */
  visible: boolean;
}

/** A tile's side in page px at `level` device px per page px. */
export function tileSide(level: number): number {
  return PDF_TILE_PX / level;
}

/** Tile (`col`, `row`)'s page-space area at `level`, cut at the page's edges. */
export function tileRegion(
  geometry: PageGeometry,
  level: number,
  col: number,
  row: number,
): Bounds {
  const side = tileSide(level);
  return {
    minX: col * side,
    minY: row * side,
    maxX: Math.min(geometry.width, (col + 1) * side),
    maxY: Math.min(geometry.height, (row + 1) * side),
  };
}

/**
 * The tiles to have for a view of `visible` (page space) at `level`: those on
 * screen, then a ring of `ring` tiles around them, each group nearest the
 * middle of the view first. `ahead` (page px, the way the view moves) makes
 * the ring reach one tile further that way. Off the page, nothing.
 */
export function tilesFor(
  geometry: PageGeometry,
  visible: Bounds,
  level: number,
  ring = 1,
  ahead: { x: number; y: number } = { x: 0, y: 0 },
): PdfTile[] {
  if (
    !(level > 0) ||
    ![visible.minX, visible.minY, visible.maxX, visible.maxY, level].every(Number.isFinite)
  )
    return [];
  const view = {
    minX: Math.max(0, visible.minX),
    minY: Math.max(0, visible.minY),
    maxX: Math.min(geometry.width, visible.maxX),
    maxY: Math.min(geometry.height, visible.maxY),
  };
  if (!(view.maxX > view.minX && view.maxY > view.minY)) return [];
  const side = tileSide(level);
  const lastCol = Math.ceil(geometry.width / side) - 1;
  const lastRow = Math.ceil(geometry.height / side) - 1;
  const first = (v: number) => Math.floor(v / side);
  const last = (v: number) => Math.ceil(v / side) - 1;
  const shown = {
    c0: first(view.minX),
    c1: last(view.maxX),
    r0: first(view.minY),
    r1: last(view.maxY),
  };
  const reach = {
    c0: Math.max(0, shown.c0 - ring - (ahead.x < 0 ? 1 : 0)),
    c1: Math.min(lastCol, shown.c1 + ring + (ahead.x > 0 ? 1 : 0)),
    r0: Math.max(0, shown.r0 - ring - (ahead.y < 0 ? 1 : 0)),
    r1: Math.min(lastRow, shown.r1 + ring + (ahead.y > 0 ? 1 : 0)),
  };
  const cx = (view.minX + view.maxX) / 2;
  const cy = (view.minY + view.maxY) / 2;
  const tiles: Array<PdfTile & { distance: number }> = [];
  for (let row = reach.r0; row <= reach.r1; row++) {
    for (let col = reach.c0; col <= reach.c1; col++) {
      const region = tileRegion(geometry, level, col, row);
      const visibleTile = col >= shown.c0 && col <= shown.c1 && row >= shown.r0 && row <= shown.r1;
      const dx = (region.minX + region.maxX) / 2 - cx;
      const dy = (region.minY + region.maxY) / 2 - cy;
      tiles.push({ col, row, region, visible: visibleTile, distance: dx * dx + dy * dy });
    }
  }
  tiles.sort((a, b) => Number(b.visible) - Number(a.visible) || a.distance - b.distance);
  return tiles.map(({ distance: _distance, ...tile }) => tile);
}
