/**
 * Finding the page in a photo, so the scan sheet can open with its corner
 * handles already on it. Pure — no DOM — and deliberately small: the photo
 * is shrunk to {@link DETECT_SIZE} px, and the page is taken to be the
 * largest bright, solid, convex four-sided region in it — a sheet of paper on
 * a desk, which is what people scan.
 *
 * 1. Shrink, take luma, blur (two passes of a 5 × 5 box: close to Gaussian).
 * 2. Threshold at Otsu's level — and at two levels either side of it, since a
 *    shadow across the page can drop part of the paper below the first.
 * 3. Keep the largest bright connected region and fill its holes (the ink).
 * 4. Its convex hull, and the four hull vertices enclosing the most area.
 * 5. Refine: fit a line to the region's boundary along the middle of each
 *    side and intersect neighbouring lines, which restores a corner that a
 *    thumb or a fold clipped off.
 * 6. Score how page-like the result is (see {@link scoreCandidate}) and keep
 *    the best candidate if it clears {@link MIN_CONFIDENCE}.
 *
 * When nothing clears it — a white page on a white desk, a photo of
 * something else — the sheet starts from {@link insetQuad} instead, and the
 * user drags the corners. A wrong guess costs a drag; a missing one costs
 * four, so the bar is set for "rarely wrong", not "always finds something".
 */

import { type Quad, cornerAngles, isConvexQuad, orderQuad, polygonArea } from "./homography";
import { type Point, type RgbaImage, downscaleRgba, lumaOf } from "./scan-raster";

/** Long side the photo is shrunk to before looking for the page, px. */
export const DETECT_SIZE = 256;
/** Below this the detection is not trusted and the inset rectangle is used. */
export const MIN_CONFIDENCE = 0.5;
/** How far in from the photo's edges the fallback corners sit, as a fraction of each side. */
export const FALLBACK_INSET = 0.06;

export interface PageDetection {
  /** Corners in the input photo's pixel space. */
  quad: Quad;
  /** 0..1; see {@link scoreCandidate}. */
  confidence: number;
}

/** The fallback corners: a rectangle `fraction` in from each edge of a `width × height` photo. */
export function insetQuad(width: number, height: number, fraction = FALLBACK_INSET): Quad {
  const dx = width * fraction;
  const dy = height * fraction;
  return [
    { x: dx, y: dy },
    { x: width - dx, y: dy },
    { x: width - dx, y: height - dy },
    { x: dx, y: height - dy },
  ];
}

/**
 * Box blur of radius `r` (a `(2r+1)²` window), edges clamped, by running
 * sums in each direction — O(1) per pixel whatever the radius.
 */
export function boxBlur(src: Uint8Array, width: number, height: number, r: number): Uint8Array {
  const tmp = new Float32Array(width * height);
  const out = new Uint8Array(width * height);
  const span = 2 * r + 1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[row + Math.min(width - 1, Math.max(0, k))];
    for (let x = 0; x < width; x++) {
      tmp[row + x] = sum / span;
      sum += src[row + Math.min(width - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += tmp[Math.min(height - 1, Math.max(0, k)) * width + x];
    for (let y = 0; y < height; y++) {
      out[y * width + x] = Math.round(sum / span);
      sum += tmp[Math.min(height - 1, y + r + 1) * width + x] - tmp[Math.max(0, y - r) * width + x];
    }
  }
  return out;
}

export interface OtsuResult {
  /** Pixels strictly above this are the bright class. */
  threshold: number;
  /** Mean of the dark and the bright class. */
  darkMean: number;
  brightMean: number;
  /** Between-class over total variance, 0..1: how two-toned the picture is. */
  separability: number;
}

/** Otsu's threshold for an 8-bit picture: the split that best separates two tones. */
export function otsu(values: Uint8Array): OtsuResult {
  const hist = new Float64Array(256);
  for (let i = 0; i < values.length; i++) hist[values[i]]++;
  const total = values.length;
  let sumAll = 0;
  for (let v = 0; v < 256; v++) sumAll += v * hist[v];
  const mean = sumAll / total;
  let varTotal = 0;
  for (let v = 0; v < 256; v++) varTotal += hist[v] * (v - mean) ** 2;
  varTotal /= total;

  let best = { threshold: 127, between: -1, darkMean: 0, brightMean: 255 };
  let wDark = 0;
  let sumDark = 0;
  for (let t = 0; t < 255; t++) {
    wDark += hist[t];
    sumDark += t * hist[t];
    const wBright = total - wDark;
    if (wDark === 0 || wBright === 0) continue;
    const mDark = sumDark / wDark;
    const mBright = (sumAll - sumDark) / wBright;
    const between = (wDark / total) * (wBright / total) * (mDark - mBright) ** 2;
    if (between > best.between) {
      best = { threshold: t, between, darkMean: mDark, brightMean: mBright };
    }
  }
  return {
    threshold: best.threshold,
    darkMean: best.darkMean,
    brightMean: best.brightMean,
    separability: varTotal > 0 ? Math.max(0, best.between) / varTotal : 0,
  };
}

/**
 * The largest 4-connected region of set pixels in `mask`, as a 0/1 mask of
 * its own, with its pixel count. An empty mask gives an empty region.
 */
export function largestRegion(
  mask: Uint8Array,
  width: number,
  height: number,
): { region: Uint8Array; area: number } {
  const label = new Int32Array(width * height);
  const stack = new Int32Array(width * height);
  let bestLabel = 0;
  let bestArea = 0;
  let next = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || label[start]) continue;
    next++;
    let area = 0;
    let top = 0;
    stack[top++] = start;
    label[start] = next;
    while (top > 0) {
      const i = stack[--top];
      area++;
      const x = i % width;
      if (x > 0 && mask[i - 1] && !label[i - 1]) {
        label[i - 1] = next;
        stack[top++] = i - 1;
      }
      if (x < width - 1 && mask[i + 1] && !label[i + 1]) {
        label[i + 1] = next;
        stack[top++] = i + 1;
      }
      if (i >= width && mask[i - width] && !label[i - width]) {
        label[i - width] = next;
        stack[top++] = i - width;
      }
      if (i + width < mask.length && mask[i + width] && !label[i + width]) {
        label[i + width] = next;
        stack[top++] = i + width;
      }
    }
    if (area > bestArea) {
      bestArea = area;
      bestLabel = next;
    }
  }
  const region = new Uint8Array(width * height);
  if (bestLabel) for (let i = 0; i < region.length; i++) region[i] = label[i] === bestLabel ? 1 : 0;
  return { region, area: bestArea };
}

/**
 * `region` with its holes filled: everything the outside cannot reach
 * without crossing the region. On a page the holes are the writing.
 */
export function fillHoles(region: Uint8Array, width: number, height: number): Uint8Array {
  const outside = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  let top = 0;
  const seed = (i: number): void => {
    if (!region[i] && !outside[i]) {
      outside[i] = 1;
      stack[top++] = i;
    }
  };
  for (let x = 0; x < width; x++) {
    seed(x);
    seed((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    seed(y * width);
    seed(y * width + width - 1);
  }
  while (top > 0) {
    const i = stack[--top];
    const x = i % width;
    if (x > 0) seed(i - 1);
    if (x < width - 1) seed(i + 1);
    if (i >= width) seed(i - width);
    if (i + width < region.length) seed(i + width);
  }
  const filled = new Uint8Array(width * height);
  for (let i = 0; i < filled.length; i++) filled[i] = outside[i] ? 0 : 1;
  return filled;
}

/**
 * Points on a region's outline: the outer edges of the first and last pixel
 * of every row and every column. Their convex hull is the region's hull, and
 * between them they sample all four sides of a page densely.
 */
export function outlinePoints(region: Uint8Array, width: number, height: number): Point[] {
  const points: Point[] = [];
  for (let y = 0; y < height; y++) {
    let first = -1;
    let last = -1;
    for (let x = 0; x < width; x++) {
      if (!region[y * width + x]) continue;
      if (first < 0) first = x;
      last = x;
    }
    if (first >= 0) points.push({ x: first, y: y + 0.5 }, { x: last + 1, y: y + 0.5 });
  }
  for (let x = 0; x < width; x++) {
    let first = -1;
    let last = -1;
    for (let y = 0; y < height; y++) {
      if (!region[y * width + x]) continue;
      if (first < 0) first = y;
      last = y;
    }
    if (first >= 0) points.push({ x: x + 0.5, y: first }, { x: x + 0.5, y: last + 1 });
  }
  return points;
}

function turn(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** Convex hull (Andrew's monotone chain), without collinear points. */
export function convexHull(points: readonly Point[]): Point[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && turn(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && turn(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Cut a convex polygon down to `keep` corners, each time dropping the corner
 * whose triangle with its neighbours has the least area (Visvalingam–Whyatt).
 */
export function simplifyHull(hull: readonly Point[], keep: number): Point[] {
  const pts = [...hull];
  while (pts.length > Math.max(3, keep)) {
    let drop = 0;
    let least = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length];
      const b = pts[(i + 1) % pts.length];
      const area = Math.abs(turn(a, pts[i], b));
      if (area < least) {
        least = area;
        drop = i;
      }
    }
    pts.splice(drop, 1);
  }
  return pts;
}

/** Hull size above which {@link maxAreaQuad} simplifies first (it is cubic). */
const MAX_HULL_FOR_QUAD = 48;

/**
 * The four hull vertices that enclose the most area: for every diagonal
 * `i–k`, the vertex furthest from it on each side. On a page whose corners
 * the blur has rounded, these are the points furthest out on each rounded
 * corner — much closer to the true corners than a greedy simplification,
 * which tends to cut a rounded corner off along a chord. `null` for fewer
 * than four points.
 */
export function maxAreaQuad(hull: readonly Point[]): Point[] | null {
  if (hull.length < 4) return null;
  const pts = hull.length > MAX_HULL_FOR_QUAD ? simplifyHull(hull, MAX_HULL_FOR_QUAD) : [...hull];
  const n = pts.length;
  let best: Point[] | null = null;
  let bestArea = -1;
  for (let i = 0; i < n; i++) {
    for (let k = i + 2; k < n; k++) {
      if (i === 0 && k === n - 1) continue;
      let left = 0;
      let j = -1;
      for (let m = i + 1; m < k; m++) {
        const a = Math.abs(turn(pts[i], pts[m], pts[k]));
        if (a > left) {
          left = a;
          j = m;
        }
      }
      let right = 0;
      let l = -1;
      for (let m = k + 1; m < n + i; m++) {
        const a = Math.abs(turn(pts[k], pts[m % n], pts[i]));
        if (a > right) {
          right = a;
          l = m % n;
        }
      }
      if (j < 0 || l < 0 || left + right <= bestArea) continue;
      bestArea = left + right;
      best = [pts[i], pts[j], pts[k], pts[l]];
    }
  }
  return best;
}

interface Line {
  /** A point on the line and its unit direction. */
  px: number;
  py: number;
  dx: number;
  dy: number;
}

/** Total-least-squares line through `points` (their principal axis). */
function fitLine(points: readonly Point[]): Line | null {
  if (points.length < 2) return null;
  let cx = 0;
  let cy = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
  }
  cx /= points.length;
  cy /= points.length;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of points) {
    const x = p.x - cx;
    const y = p.y - cy;
    sxx += x * x;
    sxy += x * y;
    syy += y * y;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { px: cx, py: cy, dx: Math.cos(angle), dy: Math.sin(angle) };
}

function intersect(a: Line, b: Line): Point | null {
  const det = a.dx * b.dy - a.dy * b.dx;
  if (Math.abs(det) < 1e-6) return null;
  const t = ((b.px - a.px) * b.dy - (b.py - a.py) * b.dx) / det;
  return { x: a.px + t * a.dx, y: a.py + t * a.dy };
}

/**
 * Move each corner of `quad` to where the region's actual sides meet: a line
 * is fitted to the outline points along the middle 70 % of each side (within
 * 5 % of the side's length of it), and neighbouring lines are intersected. A
 * corner that moves further than 12 % of the diagonal, or a result that is
 * not convex, keeps the original. Run it twice: the second pass starts from
 * sides that already lie along the edges, so it gathers all their points.
 */
export function refineQuad(quad: Quad, outline: readonly Point[]): Quad {
  const diag = Math.hypot(quad[2].x - quad[0].x, quad[2].y - quad[0].y);
  const lines: Array<Line | null> = [];
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) return quad;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const near = Math.max(2, len * 0.05);
    const along = outline.filter((p) => {
      const t = ((p.x - a.x) * ux + (p.y - a.y) * uy) / len;
      const d = Math.abs((p.x - a.x) * -uy + (p.y - a.y) * ux);
      return t >= 0.15 && t <= 0.85 && d <= near;
    });
    lines.push(along.length >= 5 ? fitLine(along) : null);
  }
  const out: Point[] = [];
  for (let i = 0; i < 4; i++) {
    const before = lines[(i + 3) % 4];
    const after = lines[i];
    const p = before && after ? intersect(before, after) : null;
    const moved = p ? Math.hypot(p.x - quad[i].x, p.y - quad[i].y) : Infinity;
    out.push(p && moved <= diag * 0.12 ? p : quad[i]);
  }
  const refined = orderQuad(out);
  return isConvexQuad(refined) ? refined : quad;
}

/** The parts of a candidate's score, each 0..1 (1 = page-like). */
export interface CandidateScore {
  /** The quad covers a sensible share of the photo: not a speck, not the whole frame. */
  area: number;
  /** The filled region matches the quad (a page is solid and four-sided). */
  fill: number;
  /** Paper is clearly brighter than what surrounds it. */
  contrast: number;
  /** No corner is sharper than a photographed rectangle can look. */
  angles: number;
  /** The photo is two-toned enough for a threshold to mean anything. */
  separability: number;
}

/** The `q` quantile of `count` values tallied in a 256-bin histogram. */
function histogramQuantile(hist: Uint32Array, count: number, q: number): number {
  let seen = 0;
  for (let v = 0; v < 256; v++) {
    seen += hist[v];
    if (seen >= count * q) return v;
  }
  return 255;
}

const ramp = (v: number, lo: number, hi: number): number =>
  Math.max(0, Math.min(1, (v - lo) / (hi - lo)));

/**
 * How page-like a candidate is: the smallest of its {@link CandidateScore}
 * parts, so any one failing criterion is enough to reject it.
 */
export function scoreCandidate(score: CandidateScore): number {
  return Math.min(score.area, score.fill, score.contrast, score.angles, score.separability);
}

/** Try one threshold: the best quad it yields, scored, in the small picture's space. */
function candidateAt(
  blurred: Uint8Array,
  width: number,
  height: number,
  threshold: number,
  separability: number,
): PageDetection | null {
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) mask[i] = blurred[i] > threshold ? 1 : 0;
  const { region, area } = largestRegion(mask, width, height);
  if (area < width * height * 0.02) return null;
  const filled = fillHoles(region, width, height);
  const outline = outlinePoints(filled, width, height);
  const corners = maxAreaQuad(convexHull(outline));
  if (!corners) return null;
  let quad = orderQuad(corners);
  if (!isConvexQuad(quad)) return null;
  quad = refineQuad(refineQuad(quad, outline), outline);

  // The page's upper quartile against the surroundings' median: the writing
  // (blurred into the paper around it) would drag a mean or median down.
  const inside = new Uint32Array(256);
  const outside = new Uint32Array(256);
  let filledArea = 0;
  for (let i = 0; i < filled.length; i++) {
    if (filled[i]) {
      filledArea++;
      inside[blurred[i]]++;
    } else {
      outside[blurred[i]]++;
    }
  }
  const outsideArea = filled.length - filledArea;
  const quadArea = Math.abs(polygonArea(quad));
  const areaFraction = quadArea / (width * height);
  const fillRatio = filledArea / Math.max(1, quadArea);
  // With (almost) nothing outside the region there is no background to
  // compare against; the area score rejects that case anyway.
  const contrast =
    outsideArea > filled.length * 0.02
      ? histogramQuantile(inside, filledArea, 0.75) - histogramQuantile(outside, outsideArea, 0.5)
      : 0;
  const score: CandidateScore = {
    area: Math.min(ramp(areaFraction, 0.04, 0.1), 1 - ramp(areaFraction, 0.93, 0.97)),
    fill: 1 - ramp(Math.abs(1 - fillRatio), 0.04, 0.14),
    contrast: ramp(contrast, 10, 30),
    angles: ramp(Math.min(...cornerAngles(quad)), 30, 45),
    separability: ramp(separability, 0.35, 0.6),
  };
  return { quad, confidence: scoreCandidate(score) };
}

/**
 * Look for the page in `photo`. Returns its corners in `photo`'s pixel space
 * with a confidence, or `null` when no candidate reached a quad at all. The
 * caller decides what confidence to trust ({@link MIN_CONFIDENCE}).
 */
export function detectPage(photo: RgbaImage): PageDetection | null {
  const small = downscaleRgba(photo, DETECT_SIZE);
  const w = small.width;
  const h = small.height;
  if (w < 8 || h < 8) return null;
  const blurred = boxBlur(boxBlur(lumaOf(small), w, h, 2), w, h, 2);
  const split = otsu(blurred);
  const thresholds = [
    split.threshold,
    Math.round(split.threshold - (split.threshold - split.darkMean) / 3),
    Math.round(split.threshold + (split.brightMean - split.threshold) / 3),
  ];
  let best: PageDetection | null = null;
  for (const t of thresholds) {
    const candidate = candidateAt(blurred, w, h, t, split.separability);
    if (candidate && (!best || candidate.confidence > best.confidence)) best = candidate;
  }
  if (!best) return null;
  const sx = photo.width / w;
  const sy = photo.height / h;
  const quad = best.quad.map((p) => ({
    x: Math.max(0, Math.min(photo.width, p.x * sx)),
    y: Math.max(0, Math.min(photo.height, p.y * sy)),
  }));
  return { quad: orderQuad(quad), confidence: best.confidence };
}

/**
 * The corners the scan sheet opens with: the detected page when it is
 * trusted, otherwise {@link insetQuad}.
 */
export function initialCorners(photo: RgbaImage): { quad: Quad; detected: boolean } {
  const found = detectPage(photo);
  if (found && found.confidence >= MIN_CONFIDENCE) return { quad: found.quad, detected: true };
  return { quad: insetQuad(photo.width, photo.height), detected: false };
}
