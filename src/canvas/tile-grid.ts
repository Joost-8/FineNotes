/**
 * Page tiles: the geometry and the cache policy behind scrolling at the
 * display's frame rate. Pure — no canvas here; the renderer owns the bitmaps.
 *
 * ## Why tiles
 *
 * Repainting every visible stroke on every scroll frame cost ~30 fps on an
 * iPad and grew with the page. Instead each page is rasterised once, at the
 * settled zoom, into fixed-size tiles that the scroll path merely blits. A
 * tile is small enough (512 device px square, 1 MB) that a missing one can
 * be rasterised inside a frame, so a fling never has to show a blank hole,
 * and a byte budget with LRU eviction keeps the whole cache bounded whatever
 * the zoom or the page count.
 *
 * A **level** is the number of device pixels per page pixel a tile was
 * rasterised at (`devicePixelRatio * viewScale`). Tiles are only drawn 1:1
 * at their own level; while a pinch is in flight they are scaled, and once
 * the zoom settles they are rasterised afresh.
 */

/** Tile edge, in device px. */
export const TILE_SIZE = 512;
/** Longest side of a page's low-resolution preview, in device px. */
export const PREVIEW_MAX_SIDE = 1024;

/** One tile's place in a page's raster, in device px at that level. */
export interface TileRect {
  col: number;
  row: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Levels are floats; keys need them stable to the same 1e-4. */
export function quantiseLevel(level: number): number {
  return Math.round(level * 1e4) / 1e4;
}

/** Size of a page's raster at `level`, in device px. */
export function rasterSize(
  pageWidth: number,
  pageHeight: number,
  level: number,
): { w: number; h: number } {
  return { w: Math.ceil(pageWidth * level), h: Math.ceil(pageHeight * level) };
}

/**
 * The tiles overlapping the device-px rectangle `[x0, x1) x [y0, y1)` of a
 * page's raster. Edge tiles are cut to the raster, so nothing is allocated
 * for pixels no page has.
 */
export function tilesCovering(
  pageWidth: number,
  pageHeight: number,
  level: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  tile = TILE_SIZE,
): TileRect[] {
  const { w, h } = rasterSize(pageWidth, pageHeight, level);
  const left = Math.max(0, x0);
  const top = Math.max(0, y0);
  const right = Math.min(w, x1);
  const bottom = Math.min(h, y1);
  if (!(right > left) || !(bottom > top)) return [];
  const c0 = Math.floor(left / tile);
  const c1 = Math.min(Math.ceil(w / tile), Math.ceil(right / tile)) - 1;
  const r0 = Math.floor(top / tile);
  const r1 = Math.min(Math.ceil(h / tile), Math.ceil(bottom / tile)) - 1;
  const out: TileRect[] = [];
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      out.push({
        col,
        row,
        x: col * tile,
        y: row * tile,
        w: Math.min(tile, w - col * tile),
        h: Math.min(tile, h - row * tile),
      });
    }
  }
  return out;
}

/** The tiles a page-space rectangle (padded by `pad` page px) touches. */
export function tilesForBounds(
  pageWidth: number,
  pageHeight: number,
  level: number,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  pad = 0,
  tile = TILE_SIZE,
): TileRect[] {
  return tilesCovering(
    pageWidth,
    pageHeight,
    level,
    Math.floor((bounds.minX - pad) * level),
    Math.floor((bounds.minY - pad) * level),
    Math.ceil((bounds.maxX + pad) * level),
    Math.ceil((bounds.maxY + pad) * level),
    tile,
  );
}

export function tileKey(pageId: string, level: number, col: number, row: number): string {
  return `${pageId}@${quantiseLevel(level)}:${col},${row}`;
}

/** Device px per page px for a page's preview: its longest side is {@link PREVIEW_MAX_SIDE}. */
export function previewScale(
  pageWidth: number,
  pageHeight: number,
  maxSide = PREVIEW_MAX_SIDE,
): number {
  const longest = Math.max(pageWidth, pageHeight);
  if (!(longest > 0)) return 1;
  return Math.min(1, maxSide / longest);
}

/**
 * Least-recently-used cache with a byte budget. `get` counts as a use;
 * `peek` does not. Inserting evicts the oldest entries until the new one
 * fits, so the cache never holds more than `budget` bytes (a single entry
 * larger than the budget is admitted alone).
 */
export class ByteLru<V> {
  private readonly map = new Map<string, { value: V; bytes: number }>();
  private total = 0;

  constructor(
    private budget: number,
    private readonly onEvict?: (value: V, key: string) => void,
  ) {}

  get bytes(): number {
    return this.total;
  }

  get limit(): number {
    return this.budget;
  }

  /** Change the budget; a smaller one evicts at once. */
  setBudget(bytes: number): void {
    this.budget = Math.max(0, bytes);
    while (this.map.size > 0 && this.total > this.budget) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.delete(oldest);
    }
  }

  /** Whether `bytes` more would fit without evicting anything. */
  fits(bytes: number): boolean {
    return this.total + bytes <= this.budget;
  }

  get size(): number {
    return this.map.size;
  }

  get(key: string): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  peek(key: string): V | undefined {
    return this.map.get(key)?.value;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  set(key: string, value: V, bytes: number): void {
    this.delete(key);
    while (this.map.size > 0 && this.total + bytes > this.budget) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.delete(oldest);
    }
    this.map.set(key, { value, bytes });
    this.total += bytes;
  }

  delete(key: string): boolean {
    const entry = this.map.get(key);
    if (!entry) return false;
    this.map.delete(key);
    this.total -= entry.bytes;
    this.onEvict?.(entry.value, key);
    return true;
  }

  /** Remove every entry the predicate accepts. Returns how many went. */
  deleteWhere(predicate: (value: V, key: string) => boolean): number {
    let n = 0;
    for (const [key, entry] of [...this.map]) {
      if (predicate(entry.value, key) && this.delete(key)) n++;
    }
    return n;
  }

  clear(): void {
    for (const key of [...this.map.keys()]) this.delete(key);
  }

  values(): IterableIterator<V> {
    const entries = this.map.values();
    return (function* () {
      for (const entry of entries) yield entry.value;
    })();
  }
}
