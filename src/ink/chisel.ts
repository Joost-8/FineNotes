/**
 * A highlighter's flat chisel tip, as a real chisel marker held upright
 * draws it: the line is swept by an upright rectangle, as tall as the line's
 * width and {@link CHISEL_ASPECT} of that wide. A level highlight is then a
 * band of one height with square ends, however the hand wavered along it,
 * and an upright one is a narrower line, as with the marker.
 *
 * The sweep of a rectangle along a straight piece is the convex hull of the
 * rectangle at both ends, so a polyline's sweep is one such hull per piece.
 * They overlap where pieces meet (both hold the rectangle there), so filled
 * together, or one after another in one colour, they leave no seam. The
 * highlighter is drawn opaque into a scratch canvas and laid down once
 * (`paintOnce` in `canvas/renderer.ts`), so the overlaps never darken.
 *
 * The rectangle keeps to the page's axes, not to the stroke's direction.
 * Pure: numbers in, polygons out.
 */

/** The tip's width as a share of its height: a broad chisel's edge, held upright. */
export const CHISEL_ASPECT = 0.5;

/** Two points closer than this (page px) are one. */
const SAME_POINT = 1e-6;

/**
 * The polygons a chisel tip `height` tall sweeps along the polyline `xy`
 * (flat `[x, y, …]`), each a convex hull as flat `[x, y, …]`, all wound
 * the same way (so a nonzero fill is their union). One point gives the tip's
 * rectangle; none, nothing. Points that are not finite are skipped.
 */
export function chiselPolygons(xy: readonly number[], height: number): number[][] {
  const h = Number.isFinite(height) && height > 0 ? height / 2 : 0;
  const w = h * CHISEL_ASPECT;
  const polygons: number[][] = [];
  let lastX = Number.NaN;
  let lastY = Number.NaN;
  let pieces = 0;
  for (let i = 0; i + 1 < xy.length; i += 2) {
    const x = xy[i];
    const y = xy[i + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (Number.isNaN(lastX)) {
      lastX = x;
      lastY = y;
      continue;
    }
    if (Math.abs(x - lastX) < SAME_POINT && Math.abs(y - lastY) < SAME_POINT) continue;
    polygons.push(sweep(lastX, lastY, x, y, w, h));
    pieces++;
    lastX = x;
    lastY = y;
  }
  if (pieces === 0 && !Number.isNaN(lastX)) polygons.push(rectangle(lastX, lastY, w, h));
  return polygons;
}

/** The tip's rectangle at `x, y`: half widths `w` across and `h` up and down. */
function rectangle(x: number, y: number, w: number, h: number): number[] {
  return [x - w, y - h, x - w, y + h, x + w, y + h, x + w, y - h];
}

/** The rectangle swept from `ax, ay` to `bx, by`: the hull of the rectangle at both ends. */
function sweep(ax: number, ay: number, bx: number, by: number, w: number, h: number): number[] {
  return hull([...rectangle(ax, ay, w, h), ...rectangle(bx, by, w, h)]);
}

/**
 * The convex hull of flat points, by Andrew's monotone chain, always wound
 * the same way; collinear points are left out.
 */
function hull(flat: readonly number[]): number[] {
  const points: Array<[number, number]> = [];
  for (let i = 0; i + 1 < flat.length; i += 2) points.push([flat[i], flat[i + 1]]);
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Array<[number, number]> = [];
  for (const p of points) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Array<[number, number]> = [];
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  const out: number[] = [];
  for (const [x, y] of [...lower, ...upper]) out.push(x, y);
  return out;
}
