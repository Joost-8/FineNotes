/**
 * Straightening a photographed page: the projective transform (homography)
 * between four corners and a rectangle, the size of that rectangle, and the
 * perspective warp itself. Pure — no DOM — and tested against known
 * transforms.
 *
 * Coordinates are continuous pixel space: (0, 0) is the top-left edge of the
 * top-left pixel, and pixel `(i, j)` has its centre at `(i + ½, j + ½)`. A
 * quad is always ordered top-left, top-right, bottom-right, bottom-left
 * ({@link orderQuad} puts four loose points in that order).
 *
 * ## The page's aspect ratio
 *
 * The obvious estimate — the longer of each pair of opposite edges — is
 * right for a photo taken straight on and wrong for a tilted one: the far
 * edge is foreshortened, so an A4 page shot at 30° comes out ~15 % too
 * short. {@link estimateAspect} recovers the true ratio from the quad itself
 * (Zhang & He, "Whiteboard scanning and image enhancement", 2007): the two
 * vanishing points of a rectangle's sides fix the camera's focal length, and
 * with that the rectangle's proportions.
 */

import { type Point, type RgbaImage, createRgba } from "./scan-raster";

export type { Point } from "./scan-raster";

/** Four corners: top-left, top-right, bottom-right, bottom-left. */
export type Quad = readonly [Point, Point, Point, Point];

/** A 3 × 3 matrix, row-major, as a flat array of nine numbers. */
export type Mat3 = readonly number[];

/** Longest side of a straightened scan, px (the same cap as every picture: image-raster.ts). */
export const MAX_SCAN_LONG_SIDE = 2048;

/**
 * Solve `A x = b` for square `A` by Gaussian elimination with partial
 * pivoting. Returns `null` when `A` is singular (or nearly: a pivot below
 * 1e-12 of the largest entry). `A` and `b` are not modified.
 */
export function solveLinear(
  a: readonly (readonly number[])[],
  b: readonly number[],
): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  let scale = 0;
  for (const row of m) for (let j = 0; j < n; j++) scale = Math.max(scale, Math.abs(row[j]));
  if (!(scale > 0)) return null;
  const eps = scale * 1e-12;

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    }
    if (!(Math.abs(m[pivot][col]) > eps)) return null;
    if (pivot !== col) [m[pivot], m[col]] = [m[col], m[pivot]];
    const p = m[col][col];
    for (let r = col + 1; r < n; r++) {
      const f = m[r][col] / p;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let sum = m[r][n];
    for (let c = r + 1; c < n; c++) sum -= m[r][c] * x[c];
    x[r] = sum / m[r][r];
  }
  return x.every(Number.isFinite) ? x : null;
}

/** `a · b` for 3 × 3 matrices. */
export function multiplyMat3(a: Mat3, b: Mat3): number[] {
  const out = new Array<number>(9).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return out;
}

/** The determinant of a 3 × 3 matrix. */
export function detMat3(m: Mat3): number {
  const [a, b, c, d, e, f, g, h, i] = m;
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

/** The inverse of a 3 × 3 matrix, or `null` when it is singular. */
export function invertMat3(m: Mat3): number[] | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = detMat3(m);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-18) return null;
  const k = 1 / det;
  return [
    A * k,
    -(b * i - c * h) * k,
    (b * f - c * e) * k,
    B * k,
    (a * i - c * g) * k,
    -(a * f - c * d) * k,
    C * k,
    -(a * h - b * g) * k,
    (a * e - b * d) * k,
  ];
}

/** Map a point through homography `h`. Non-finite when it maps to infinity. */
export function applyHomography(h: Mat3, x: number, y: number): Point {
  const w = h[6] * x + h[7] * y + h[8];
  return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w };
}

/**
 * Hartley normalisation: the similarity that moves four points' centroid to
 * the origin and their mean distance from it to √2. Solving in these
 * coordinates keeps the 8 × 8 system well conditioned whether the points are
 * 20 px or 4000 px apart.
 */
function normaliser(points: readonly Point[]): number[] {
  let cx = 0;
  let cy = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
  }
  cx /= points.length;
  cy /= points.length;
  let d = 0;
  for (const p of points) d += Math.hypot(p.x - cx, p.y - cy);
  d /= points.length;
  const s = d > 0 ? Math.SQRT2 / d : 1;
  return [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1];
}

/**
 * The homography mapping each corner of `from` onto the matching corner of
 * `to`, normalised so its last entry is 1. `null` when no such map exists —
 * three of either quad's corners on one line, or two on one point.
 */
export function homographyFromQuads(from: Quad, to: Quad): number[] | null {
  const tf = normaliser(from);
  const tt = normaliser(to);
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const p = applyHomography(tf, from[i].x, from[i].y);
    const q = applyHomography(tt, to[i].x, to[i].y);
    a.push([p.x, p.y, 1, 0, 0, 0, -q.x * p.x, -q.x * p.y]);
    b.push(q.x);
    a.push([0, 0, 0, p.x, p.y, 1, -q.y * p.x, -q.y * p.y]);
    b.push(q.y);
  }
  const x = solveLinear(a, b);
  if (!x) return null;
  const hn = [...x, 1];
  // Three corners on a line still give the 8 × 8 system a solution — a
  // singular matrix that folds the plane onto that line. In normalised
  // coordinates a real homography's determinant is of order one.
  if (!(Math.abs(detMat3(hn)) > 1e-9)) return null;
  const ttInv = invertMat3(tt);
  if (!ttInv) return null;
  const h = multiplyMat3(multiplyMat3(ttInv, hn), tf);
  const k = h[8];
  if (!Number.isFinite(k) || Math.abs(k) < 1e-15) return null;
  const out = h.map((v) => v / k);
  return out.every(Number.isFinite) ? out : null;
}

/** Signed area of a polygon (shoelace); positive when clockwise on screen (y down). */
export function polygonArea(points: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    sum += p.x * q.y - q.x * p.y;
  }
  return sum / 2;
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/**
 * Whether `q` is a strictly convex quadrilateral: every turn the same way,
 * none of them flat. A bow-tie (two corners dragged past each other) or a
 * dart (one corner pushed inside) fails, and so do three corners on a line.
 */
export function isConvexQuad(q: readonly Point[]): boolean {
  if (q.length !== 4) return false;
  const scale = Math.max(
    1e-9,
    ...q.map((p, i) => Math.hypot(q[(i + 1) % 4].x - p.x, q[(i + 1) % 4].y - p.y)),
  );
  const eps = scale * scale * 1e-4;
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const c = cross(q[i], q[(i + 1) % 4], q[(i + 2) % 4]);
    if (!Number.isFinite(c) || Math.abs(c) <= eps) return false;
    const s = Math.sign(c);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/**
 * Four loose points as a quad in reading order — top-left, top-right,
 * bottom-right, bottom-left — by angle around their centroid, starting from
 * the one nearest the top-left. Dragging one corner handle past another
 * therefore never produces a bow-tie; the points simply swap roles.
 */
export function orderQuad(points: readonly Point[]): Quad {
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  // Clockwise on screen (y down) is increasing atan2 angle.
  const sorted = [...points]
    .slice(0, 4)
    .sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  let first = 0;
  for (let i = 1; i < 4; i++) {
    if (sorted[i].x + sorted[i].y < sorted[first].x + sorted[first].y) first = i;
  }
  const at = (k: number): Point => ({ ...sorted[(first + k) % 4] });
  return [at(0), at(1), at(2), at(3)];
}

/** The interior angle at each corner of `q`, degrees. */
export function cornerAngles(q: Quad): number[] {
  return q.map((p, i) => {
    const a = q[(i + 3) % 4];
    const b = q[(i + 1) % 4];
    const v1x = a.x - p.x;
    const v1y = a.y - p.y;
    const v2x = b.x - p.x;
    const v2y = b.y - p.y;
    const cos = (v1x * v2x + v1y * v2y) / (Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y));
    return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
  });
}

/** Smallest area, as a fraction of the photo, that a scan quad may have. */
export const MIN_QUAD_AREA_FRACTION = 0.005;

/**
 * Whether `q` can be straightened: convex, not a sliver (every corner at
 * least 10°), and not tiny against the `width × height` photo it sits on.
 */
export function isUsableQuad(q: Quad, width: number, height: number): boolean {
  if (!isConvexQuad(q)) return false;
  if (Math.abs(polygonArea(q)) < MIN_QUAD_AREA_FRACTION * width * height) return false;
  return cornerAngles(q).every((a) => a >= 10);
}

function dist(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Width over height of the quad's rectangle, read off its edges (see the module notes). */
export function edgeAspect(q: Quad): number {
  const w = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2;
  const h = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
  return h > 0 ? w / h : 1;
}

/**
 * Focal length assumed when a photo does not reveal its own, as a multiple of
 * the photo's long side: an iPhone or iPad main camera (26–29 mm equivalent)
 * sits at 0.72–0.8.
 */
export const TYPICAL_FOCAL = 0.8;

/**
 * How far each of the rectangle's directions must lean out of the photo's
 * plane (roughly the tangent of its tilt, ≈ 3.5°) before its vanishing point
 * is trusted to measure the focal length.
 */
const MIN_RECEDE = 0.06;

/**
 * The true width-over-height of the rectangle photographed as `q`, from the
 * camera geometry (Zhang & He, see the module notes), assuming square pixels
 * and a principal point at the centre of the `width × height` photo.
 *
 * The focal length is measured from the quad's two vanishing points when
 * both are finite and the result is plausible for a camera. A keystone —
 * the phone tilted about one axis only, the commonest way to photograph a
 * page — has one pair of sides parallel and so only one vanishing point,
 * and a nearly frontal shot has none; then {@link TYPICAL_FOCAL} stands in.
 * The aspect is not very sensitive to that guess, and on a frontal shot the
 * focal length cancels out altogether.
 *
 * Returns the plain edge estimate when the geometry is degenerate or the two
 * estimates disagree wildly (a corner dragged somewhere odd).
 */
export function estimateAspect(q: Quad, width: number, height: number): number {
  const fallback = edgeAspect(q);
  const u0 = width / 2;
  const v0 = height / 2;
  // m1..m4 = TL, TR, BL, BR, homogeneous, relative to the principal point,
  // which keeps the arithmetic small and the formula below free of u0, v0.
  const m = [q[0], q[1], q[3], q[2]].map((p) => [p.x - u0, p.y - v0, 1]);
  const crossV = (a: number[], b: number[]): number[] => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const dot = (a: number[], b: number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const [m1, m2, m3, m4] = m;
  const c14 = crossV(m1, m4);
  const k2 = dot(c14, m3) / dot(crossV(m2, m4), m3);
  const k3 = dot(c14, m2) / dot(crossV(m3, m4), m2);
  // n2, n3: the images of the rectangle's width and height directions.
  const n2 = [k2 * m2[0] - m1[0], k2 * m2[1] - m1[1], k2 * m2[2] - m1[2]];
  const n3 = [k3 * m3[0] - m1[0], k3 * m3[1] - m1[1], k3 * m3[2] - m1[2]];
  if (![...n2, ...n3].every(Number.isFinite)) return fallback;

  const size = Math.max(width, height);
  let f2 = (TYPICAL_FOCAL * size) ** 2;
  // f² = −(n21 n31 + n22 n32) / (n23 n33) with the principal point at the
  // origin — but only once both directions really recede. On a keystone
  // n23 is zero up to rounding (~1e-16), the ratio is noise over noise, and
  // noise lands inside any plausibility band as readily as outside it, so
  // each direction must first lean at least MIN_RECEDE out of the photo's
  // plane. After that, phone and laptop cameras sit near 0.7–1.3 × the long
  // side; outside a generous band around that is still not a measurement.
  const recede = (n: number[]): number => (Math.abs(n[2]) * size) / Math.hypot(n[0], n[1]);
  if (recede(n2) > MIN_RECEDE && recede(n3) > MIN_RECEDE) {
    const measured = -(n2[0] * n3[0] + n2[1] * n3[1]) / (n2[2] * n3[2]);
    if (measured > (0.35 * size) ** 2 && measured < (4 * size) ** 2) f2 = measured;
  }
  const norm = (n: number[]): number => (n[0] * n[0] + n[1] * n[1]) / f2 + n[2] * n[2];
  const aspect = Math.sqrt(norm(n2) / norm(n3));
  if (!Number.isFinite(aspect) || aspect <= 0) return fallback;
  if (aspect > fallback * 1.6 || aspect < fallback / 1.6) return fallback;
  return aspect;
}

/**
 * The pixel size to straighten `q` into: the page's aspect from
 * {@link estimateAspect}, at about the resolution the photo holds for it
 * (the longer of each pair of opposite edges — never invented detail), and
 * at most `maxLongSide` on its long side.
 */
export function scanOutputSize(
  q: Quad,
  width: number,
  height: number,
  maxLongSide = MAX_SCAN_LONG_SIDE,
): { width: number; height: number } {
  const aspect = estimateAspect(q, width, height);
  const w0 = Math.max(dist(q[0], q[1]), dist(q[3], q[2]));
  const h0 = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
  let w = Math.max(w0, h0 * aspect, 1);
  let h = w / aspect;
  const k = Math.min(1, maxLongSide / Math.max(w, h));
  w *= k;
  h *= k;
  return { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) };
}

export interface WarpOptions {
  /**
   * RGBA for output pixels whose source lies outside the photo. Absent: the
   * nearest edge pixel is repeated, which is right for a scan (its corners
   * are kept on the photo) and wrong for a magnifier near the edge.
   */
  background?: readonly [number, number, number, number];
}

/**
 * Straighten the part of `src` inside `quad` into a `width × height`
 * rectangle: every output pixel is mapped back into the photo through the
 * homography and sampled bilinearly. `null` when `quad` has no homography.
 *
 * Fast enough for 2048 px on an iPad: the projective numerators and
 * denominator are linear along a row, so each pixel costs three additions
 * and one division to map, and nothing is allocated per pixel.
 */
export function warpPerspective(
  src: RgbaImage,
  quad: Quad,
  width: number,
  height: number,
  options: WarpOptions = {},
): RgbaImage | null {
  const out = createRgba(width, height);
  const ow = out.width;
  const oh = out.height;
  const rect: Quad = [
    { x: 0, y: 0 },
    { x: ow, y: 0 },
    { x: ow, y: oh },
    { x: 0, y: oh },
  ];
  const h = homographyFromQuads(rect, quad);
  if (!h) return null;
  const sw = src.width;
  const sh = src.height;
  const s = src.data;
  const d = out.data;
  const bg = options.background;
  const maxX = sw - 1;
  const maxY = sh - 1;

  let o = 0;
  for (let y = 0; y < oh; y++) {
    const py = y + 0.5;
    let X = h[0] * 0.5 + h[1] * py + h[2];
    let Y = h[3] * 0.5 + h[4] * py + h[5];
    let W = h[6] * 0.5 + h[7] * py + h[8];
    for (let x = 0; x < ow; x++, o += 4) {
      // Continuous source position, shifted so integer = pixel centre.
      let u = X / W - 0.5;
      let v = Y / W - 0.5;
      X += h[0];
      Y += h[3];
      W += h[6];
      if (bg && (!(u >= -0.5 && u <= sw - 0.5) || !(v >= -0.5 && v <= sh - 0.5))) {
        d[o] = bg[0];
        d[o + 1] = bg[1];
        d[o + 2] = bg[2];
        d[o + 3] = bg[3];
        continue;
      }
      // Clamp to the photo (also turns a NaN from a point at infinity into 0).
      // No `+ 0.5` on the writes below: a Uint8ClampedArray rounds by itself.
      u = u > 0 ? (u < maxX ? u : maxX) : 0;
      v = v > 0 ? (v < maxY ? v : maxY) : 0;
      const x0 = u | 0;
      const y0 = v | 0;
      const fx = u - x0;
      const fy = v - y0;
      const x1 = x0 < maxX ? 4 : 0;
      const y1 = y0 < maxY ? sw * 4 : 0;
      const p = (y0 * sw + x0) * 4;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      for (let c = 0; c < 4; c++) {
        d[o + c] =
          s[p + c] * w00 + s[p + x1 + c] * w10 + s[p + y1 + c] * w01 + s[p + x1 + y1 + c] * w11;
      }
    }
  }
  return out;
}
