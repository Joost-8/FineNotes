/**
 * The grid of sharp PDF tiles for a page that needs detail. Pure.
 *
 * Where a page's whole-page image cannot be as sharp as the ink tiles
 * (`needsDetail`), it is drawn sharp in square tiles of `PDF_TILE_PX` device
 * px at the view's level, rendered by pdf.js in a worker
 * (`view/pdf-worker.ts`) so they can be asked for while the view moves. The
 * grid is fixed per level, so a tile's key never changes as the view moves,
 * and tiles already cached are reused wherever they fall.
 */

import type { Bounds, PageGeometry } from "../model/document";
import { TILE_SIZE, tilesTouching } from "./tile-grid";

/**
 * A PDF tile's side, in device px: two ink tiles (`TILE_SIZE`), so each one
 * covers exactly 2 x 2 of them. pdf.js runs every drawing operation of the
 * page for each tile, clipped, so a tile's cost hardly depends on its size:
 * with pdf.js in Chromium, a 2698 x 1458 px iPad view of an A4 study sheet
 * at 4 px per point took 18 tiles and 318 ms at 512 px, 6 tiles and 162 ms
 * at 1024 (642 and 226 ms with the CPU slowed 4x, as on an old iPad).
 */
export const PDF_TILE_PX = 2 * TILE_SIZE;

export interface PdfTile {
  col: number;
  row: number;
  /** Page-space area, cut at the page's edges. */
  region: Bounds;
  /** Whether it shows on screen now; the others are rendered ahead. */
  visible: boolean;
}

/** Bytes of the PDF tiles a screen of `w` x `h` device px can show at once. */
export function screenDetailBytes(w: number, h: number): number {
  return tilesTouching(w, h, PDF_TILE_PX) * PDF_TILE_PX * PDF_TILE_PX * 4;
}

/** What the PDF cache keeps, in bytes (`PdfMemoryBudget` in `view/pdf-backdrop.ts`). */
export interface DetailBudget {
  soft: number;
  hard: number;
  keepDetail: number;
}

/**
 * `base` grown to a screen of `w` x `h` device px, for a device with memory
 * to spare (FineNotes#298). The fixed budget was set for an iPad screen; on
 * an Android tablet's 3200 x 2000 px the tiles on screen and the row ahead
 * took most of it, and the 32 MB of detail kept behind the view held fewer
 * tiles than one screen: a zoomed-in pan back and forth rendered 106 of 142
 * tiles again. Here a screen and a half of tiles is kept behind the view,
 * the soft budget grows by as much (it trims what was not drawn just now),
 * and the hard one holds that and a screen and a half more in view. Never
 * below `base`.
 */
export function roomierPdfBudget(base: DetailBudget, w: number, h: number): DetailBudget {
  const screen = screenDetailBytes(w, h);
  const keepDetail = Math.max(base.keepDetail, 1.5 * screen);
  const soft = base.soft + (keepDetail - base.keepDetail);
  return { soft, hard: Math.max(base.hard, soft + 1.5 * screen), keepDetail };
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
