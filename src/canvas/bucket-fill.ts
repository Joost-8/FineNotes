/**
 * Bucket fill: the region of a page enclosed by ink round a tapped point,
 * as an outline polygon in page px.
 *
 * The page's ink is rasterised into a grid of at most `maxCells` cells (so
 * memory and time are bounded whatever the page holds), the ink is widened
 * by the gap tolerance so small gaps in a hand-drawn outline close, the
 * region round the tap is flooded, grown back by the same amount over the
 * paper (not over the ink), tucked one cell under the ink, and its outer
 * boundary traced and simplified. Holes are ignored: writing inside the
 * outline stays on top of the fill, which is drawn behind the ink.
 *
 * A region that reaches the page's edge is not closed, and is refused.
 *
 * PURE: no DOM, no Obsidian.
 */

/** One stroke as the fill sees it: its centreline and the radius of its ink, page px. */
export interface FillInk {
  /** x, y, pressure, x, y, pressure, …, page px. */
  pts: readonly number[];
  radius: number;
}

export interface FillRequest {
  /** The page's size, page px. */
  width: number;
  height: number;
  ink: readonly FillInk[];
  /** The tap, page px. */
  x: number;
  y: number;
  /** Gaps in the outline up to this wide close, page px (0: only a closed outline holds). */
  gap: number;
  /** The grid's size cap, cells. */
  maxCells?: number;
  /** At most this many cells per page px. */
  maxScale?: number;
  /** The outline's vertex cap. */
  maxPoints?: number;
}

export type FillResult =
  | {
      ok: true;
      /** The outline, flat `[x, y, …]` in page px, closed (the last point is the first). */
      outline: number[];
      /** The region's area, page px². */
      area: number;
    }
  | {
      ok: false;
      /** `ink`: the tap is on ink. `open`: the region reaches the page's edge. */
      reason: "ink" | "open";
    };

/** About 1 MB of mask, 4 MB of queue: safe on a 4 GB iPad, quick on a laptop. */
export const FILL_MAX_CELLS = 1_000_000;
/** Finer than one cell per page px buys nothing a page px of ink can show. */
export const FILL_MAX_SCALE = 1;
/** An outline past this many points is simplified harder. */
export const FILL_MAX_POINTS = 2000;

const STRIDE = 3;

/** A grid over the page: `scale` cells per page px. */
export interface FillGrid {
  w: number;
  h: number;
  scale: number;
}

/** The grid for a page of `width` × `height` page px, within the caps. */
export function fillGrid(
  width: number,
  height: number,
  maxCells = FILL_MAX_CELLS,
  maxScale = FILL_MAX_SCALE,
): FillGrid | null {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width * height)) return null;
  const scale = Math.min(maxScale, Math.sqrt(maxCells / (width * height)));
  const w = Math.max(1, Math.ceil(width * scale));
  const h = Math.max(1, Math.ceil(height * scale));
  if (w * h > maxCells * 1.01 + w + h) return null;
  return { w, h, scale };
}

/**
 * Mark every cell the ink touches (1), conservatively: a cell whose centre
 * lies within the ink's radius plus half a cell's diagonal of a segment, so
 * a thin diagonal line still blocks a 4-connected flood.
 */
export function rasterInk(grid: FillGrid, ink: readonly FillInk[]): Uint8Array {
  const { w, h, scale } = grid;
  const mask = new Uint8Array(w * h);
  const slack = Math.SQRT1_2;
  for (const line of ink) {
    const r = Math.max(0, line.radius) * scale + slack;
    const pts = line.pts;
    const usable = pts.length - (pts.length % STRIDE);
    if (usable < STRIDE) continue;
    let px = pts[0] * scale;
    let py = pts[1] * scale;
    if (!Number.isFinite(px + py)) continue;
    if (usable === STRIDE) stamp(mask, w, h, px, py, px, py, r);
    for (let i = STRIDE; i < usable; i += STRIDE) {
      const x = pts[i] * scale;
      const y = pts[i + 1] * scale;
      if (!Number.isFinite(x + y)) continue;
      stamp(mask, w, h, px, py, x, y, r);
      px = x;
      py = y;
    }
  }
  return mask;
}

/** Mark the cells whose centres lie within `r` of segment a→b (cell units). */
function stamp(
  mask: Uint8Array,
  w: number,
  h: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  r: number,
): void {
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r));
  const x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + r));
  const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r));
  const y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by) + r));
  if (x0 > x1 || y0 > y1) return;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const r2 = r * r;
  for (let j = y0; j <= y1; j++) {
    const cy = j + 0.5;
    for (let i = x0; i <= x1; i++) {
      const cx = i + 0.5;
      let t = len2 > 0 ? ((cx - ax) * dx + (cy - ay) * dy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = ax + t * dx - cx;
      const ey = ay + t * dy - cy;
      if (ex * ex + ey * ey <= r2) mask[j * w + i] = 1;
    }
  }
}

/**
 * Each cell's distance to the nearest ink cell, in thirds of a cell (a 3-4
 * chamfer: 3 across an edge, 4 across a corner), capped at 65535.
 */
export function inkDistance(grid: FillGrid, mask: Uint8Array): Uint16Array {
  const { w, h } = grid;
  const far = 65535;
  const d = new Uint16Array(w * h);
  for (let k = 0; k < d.length; k++) d[k] = mask[k] ? 0 : far;
  const min = (a: number, b: number): number => (b < a ? b : a);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      let v = d[k];
      if (v === 0) continue;
      if (i > 0) v = min(v, d[k - 1] + 3);
      if (j > 0) {
        v = min(v, d[k - w] + 3);
        if (i > 0) v = min(v, d[k - w - 1] + 4);
        if (i < w - 1) v = min(v, d[k - w + 1] + 4);
      }
      d[k] = min(v, far);
    }
  }
  for (let j = h - 1; j >= 0; j--) {
    for (let i = w - 1; i >= 0; i--) {
      const k = j * w + i;
      let v = d[k];
      if (v === 0) continue;
      if (i < w - 1) v = min(v, d[k + 1] + 3);
      if (j < h - 1) {
        v = min(v, d[k + w] + 3);
        if (i < w - 1) v = min(v, d[k + w + 1] + 4);
        if (i > 0) v = min(v, d[k + w - 1] + 4);
      }
      d[k] = min(v, far);
    }
  }
  return d;
}

/**
 * Flood the free cells (`free[k]` true) 4-connected from `start`; the
 * region as a mask, and whether it touched the grid's edge.
 */
export function flood(
  grid: FillGrid,
  free: (k: number) => boolean,
  start: number,
): { region: Uint8Array; open: boolean; cells: number } {
  const { w, h } = grid;
  const region = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  let open = false;
  region[start] = 1;
  queue[tail++] = start;
  while (head < tail) {
    const k = queue[head++];
    const i = k % w;
    const j = (k - i) / w;
    if (i === 0 || j === 0 || i === w - 1 || j === h - 1) open = true;
    if (i > 0 && !region[k - 1] && free(k - 1)) {
      region[k - 1] = 1;
      queue[tail++] = k - 1;
    }
    if (i < w - 1 && !region[k + 1] && free(k + 1)) {
      region[k + 1] = 1;
      queue[tail++] = k + 1;
    }
    if (j > 0 && !region[k - w] && free(k - w)) {
      region[k - w] = 1;
      queue[tail++] = k - w;
    }
    if (j < h - 1 && !region[k + w] && free(k + w)) {
      region[k + w] = 1;
      queue[tail++] = k + w;
    }
  }
  return { region, open, cells: tail };
}

/**
 * Grow `region` by `steps` cells, only into cells `into` allows; in place.
 * Steps alternate edge and corner neighbours, so the growth is round
 * (an octagon) rather than square.
 */
export function grow(
  grid: FillGrid,
  region: Uint8Array,
  steps: number,
  into: (k: number) => boolean,
): void {
  const { w, h } = grid;
  const edgeOf = (k: number): boolean => {
    const i = k % w;
    return (
      (i > 0 && !region[k - 1]) ||
      (i < w - 1 && !region[k + 1]) ||
      (k >= w && !region[k - w]) ||
      (k + w < region.length && !region[k + w])
    );
  };
  let frontier: number[] = [];
  for (let k = 0; k < region.length; k++) if (region[k] && edgeOf(k)) frontier.push(k);
  for (let s = 0; s < steps && frontier.length > 0; s++) {
    const corners = s % 2 === 1;
    const next: number[] = [];
    for (const k of frontier) {
      const i = k % w;
      const j = (k - i) / w;
      for (let dj = -1; dj <= 1; dj++) {
        const y = j + dj;
        if (y < 0 || y >= h) continue;
        for (let di = -1; di <= 1; di++) {
          if (!corners && di !== 0 && dj !== 0) continue;
          const x = i + di;
          if (x < 0 || x >= w) continue;
          const n = y * w + x;
          if (region[n] || !into(n)) continue;
          region[n] = 1;
          next.push(n);
        }
      }
    }
    frontier = next;
  }
}

const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

/**
 * The outer boundary of the region's component holding its first cell in
 * raster order, as the corners of the cell edges it runs along, flat
 * `[x, y, …]` in cell units (not closed: the last corner leads back to the
 * first). Diagonal neighbours count as joined. Empty for an empty region.
 */
export function traceOutline(grid: FillGrid, region: Uint8Array): number[] {
  const { w, h } = grid;
  let first = -1;
  for (let k = 0; k < region.length; k++) {
    if (region[k]) {
      first = k;
      break;
    }
  }
  if (first < 0) return [];
  const inside = (i: number, j: number): boolean =>
    i >= 0 && j >= 0 && i < w && j < h && region[j * w + i] === 1;
  const sx = first % w;
  const sy = (first - sx) / w;
  let x = sx;
  let y = sy;
  let d = 0;
  const out: number[] = [];
  const cap = 4 * (w + 1) * (h + 1) + 8;
  for (let step = 0; step < cap; step++) {
    // The cells ahead on the left and on the right of the edge about to be walked.
    let li: number, lj: number, ri: number, rj: number;
    if (d === 0) [li, lj, ri, rj] = [x, y - 1, x, y];
    else if (d === 1) [li, lj, ri, rj] = [x, y, x - 1, y];
    else if (d === 2) [li, lj, ri, rj] = [x - 1, y, x - 1, y - 1];
    else [li, lj, ri, rj] = [x - 1, y - 1, x, y - 1];
    const before = d;
    if (inside(li, lj)) d = (d + 3) % 4;
    else if (!inside(ri, rj)) d = (d + 1) % 4;
    if (step > 0 && x === sx && y === sy && d === 0) break;
    if (step === 0 || d !== before) out.push(x, y);
    x += DX[d];
    y += DY[d];
  }
  return out;
}

/**
 * A closed polygon (flat `[x, y, …]`, not repeating its first point)
 * simplified by Ramer-Douglas-Peucker at `tolerance`. Iterative, so a long
 * outline cannot overflow the stack.
 */
export function simplifyClosed(xy: readonly number[], tolerance: number): number[] {
  const n = Math.floor(xy.length / 2);
  if (n <= 3) return xy.slice(0, n * 2);
  // Split at the vertex farthest from the first, so both halves are open polylines.
  let far = 0;
  let best = -1;
  for (let i = 1; i < n; i++) {
    const d = (xy[2 * i] - xy[0]) ** 2 + (xy[2 * i + 1] - xy[1]) ** 2;
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const keep = new Uint8Array(n + 1);
  keep[0] = 1;
  keep[far] = 1;
  keep[n] = 1;
  const at = (i: number): number => (i === n ? 0 : i);
  const stack: Array<[number, number]> = [
    [0, far],
    [far, n],
  ];
  const tol2 = tolerance * tolerance;
  while (stack.length > 0) {
    const [a, b] = stack.pop() as [number, number];
    if (b - a < 2) continue;
    const ax = xy[2 * at(a)];
    const ay = xy[2 * at(a) + 1];
    const dx = xy[2 * at(b)] - ax;
    const dy = xy[2 * at(b) + 1] - ay;
    const len2 = dx * dx + dy * dy;
    let worst = -1;
    let index = -1;
    for (let i = a + 1; i < b; i++) {
      const px = xy[2 * i] - ax;
      const py = xy[2 * i + 1] - ay;
      const d =
        len2 > 0 ? (px * dy - py * dx) ** 2 / len2 : px * px + py * py;
      if (d > worst) {
        worst = d;
        index = i;
      }
    }
    if (worst > tol2) {
      keep[index] = 1;
      stack.push([a, index], [index, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(xy[2 * i], xy[2 * i + 1]);
  return out;
}

/** A polygon's area (flat `[x, y, …]`, either way round). */
export function polygonArea(xy: readonly number[]): number {
  const n = Math.floor(xy.length / 2);
  let twice = 0;
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    twice += xy[2 * j] * xy[2 * i + 1] - xy[2 * i] * xy[2 * j + 1];
  }
  return Math.abs(twice) / 2;
}

/** Whether (x, y) lies inside polygon `xy` (flat, even-odd). */
export function insidePolygon(xy: readonly number[], x: number, y: number): boolean {
  const n = Math.floor(xy.length / 2);
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    const yi = xy[2 * i + 1];
    const yj = xy[2 * j + 1];
    if (yi > y !== yj > y) {
      const cross = xy[2 * i] + ((y - yi) / (yj - yi)) * (xy[2 * j] - xy[2 * i]);
      if (x < cross) inside = !inside;
    }
  }
  return inside;
}

/** The region round (x, y) enclosed by the ink, or why there is none. */
export function bucketFill(req: FillRequest): FillResult {
  const grid = fillGrid(req.width, req.height, req.maxCells, req.maxScale);
  if (!grid || !Number.isFinite(req.x + req.y)) return { ok: false, reason: "open" };
  const { w, h, scale } = grid;
  const ti = Math.floor(req.x * scale);
  const tj = Math.floor(req.y * scale);
  if (ti < 0 || tj < 0 || ti >= w || tj >= h) return { ok: false, reason: "open" };
  const mask = rasterInk(grid, req.ink);
  const dist = inkDistance(grid, mask);
  // Free: farther from the ink than half the gap, so a gap that narrow closes.
  const reach = Math.max(0, req.gap / 2) * scale;
  const limit = Math.round(reach * 3);
  const free = (k: number): boolean => dist[k] > limit;
  if (mask[tj * w + ti]) return { ok: false, reason: "ink" };
  // A tap just inside the widened ink starts from the nearest free cell beside it.
  const start = nearestFree(grid, free, ti, tj, Math.ceil(reach) + 1);
  if (start < 0) return { ok: false, reason: "ink" };
  const filled = flood(grid, free, start);
  if (filled.open) return { ok: false, reason: "open" };
  const region = filled.region;
  // Back out over the paper the widening took, then one cell under the ink.
  grow(grid, region, Math.ceil(reach), (k) => mask[k] === 0);
  grow(grid, region, 2, () => true);
  let cells = 0;
  for (let k = 0; k < region.length; k++) cells += region[k];
  const corners = traceOutline(grid, region);
  const maxPoints = req.maxPoints ?? FILL_MAX_POINTS;
  let tolerance = 0.75;
  let simple = simplifyClosed(corners, tolerance);
  while (simple.length / 2 > maxPoints && tolerance < 64) {
    tolerance *= 2;
    simple = simplifyClosed(corners, tolerance);
  }
  if (simple.length < 6) return { ok: false, reason: "ink" };
  const outline: number[] = [];
  for (let i = 0; i < simple.length; i += 2) outline.push(simple[i] / scale, simple[i + 1] / scale);
  outline.push(outline[0], outline[1]);
  return { ok: true, outline, area: cells / (scale * scale) };
}

/** The free cell nearest (i, j) within `radius` cells (a square spiral), or -1. */
function nearestFree(
  grid: FillGrid,
  free: (k: number) => boolean,
  i: number,
  j: number,
  radius: number,
): number {
  const { w, h } = grid;
  let best = -1;
  let bestD = Infinity;
  for (let dj = -radius; dj <= radius; dj++) {
    const y = j + dj;
    if (y < 0 || y >= h) continue;
    for (let di = -radius; di <= radius; di++) {
      const x = i + di;
      if (x < 0 || x >= w) continue;
      const d = di * di + dj * dj;
      if (d < bestD && d <= radius * radius && free(y * w + x)) {
        bestD = d;
        best = y * w + x;
      }
    }
  }
  return best;
}
