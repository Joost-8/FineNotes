/**
 * DBNet's post-processing: the detector's probability map in, text lines out.
 *
 * The map is thresholded, its connected blobs found, each blob fitted with a
 * rectangle along its own direction (a page scanned a degree or two crooked
 * still reads), scored by the mean probability of its pixels, and grown by
 * the "unclip" distance the network was trained to need. Blobs that lean
 * more than {@link MAX_TILT} (rotated or vertical text, which the page's
 * text layer leaves out too), that are tiny or unsure, are dropped.
 *
 * PURE: no DOM, no Obsidian, no onnxruntime.
 */

/** DBNet's binarisation threshold. */
export const DB_THRESHOLD = 0.3;
/** A blob whose mean probability is below this is not text. */
export const DB_BOX_SCORE = 0.6;
/** How far a box is grown: distance = area * ratio / perimeter. */
export const DB_UNCLIP_RATIO = 1.5;
/** Lines leaning more than this (radians, about 15 degrees) are rotated text and dropped. */
export const MAX_TILT = 0.26;
/** A blob shorter than this (px) in its short side is noise. */
const MIN_SIDE = 3;
/** After growing, a box with a shorter side than this (px) is too small to read. */
const MIN_GROWN_SIDE = 6;
/** A blob of fewer pixels than this is noise. */
const MIN_PIXELS = 12;
/** Blobs less elongated than this have no direction of their own: they stay upright. */
const MIN_ELONGATION = 2;

/** A line of text: a rectangle `w` x `h` centred on (`cx`, `cy`), `w` along `angle` (radians). */
export interface TextBox {
  cx: number;
  cy: number;
  w: number;
  h: number;
  angle: number;
  /** Mean probability of the blob. */
  score: number;
}

/** Why a blob was not made a text line (for diagnostics and tests). */
export type DbRejection = "pixels" | "score" | "side" | "vertical" | "tilt" | "grown";

export interface DbOptions {
  threshold?: number;
  boxScore?: number;
  unclipRatio?: number;
  /** Called with each blob that was left out, and why; its box in pixels `[x0, y0, x1, y1]`. */
  onReject?: (why: DbRejection, bounds: [number, number, number, number], score: number) => void;
}

/**
 * The text lines in a probability map of `width` x `height`, in no
 * particular order (see reading-order.ts).
 */
export function findTextBoxes(
  prob: ArrayLike<number>,
  width: number,
  height: number,
  options: DbOptions = {},
): TextBox[] {
  const threshold = options.threshold ?? DB_THRESHOLD;
  const minScore = options.boxScore ?? DB_BOX_SCORE;
  const ratio = options.unclipRatio ?? DB_UNCLIP_RATIO;
  const reject = options.onReject;
  const size = width * height;
  const seen = new Uint8Array(size);
  const queue = new Int32Array(size);
  const boxes: TextBox[] = [];
  for (let start = 0; start < size; start++) {
    if (seen[start] || !(prob[start] > threshold)) continue;
    // Breadth-first over the blob (8-connected); its pixels end up in queue[0..n).
    let head = 0;
    let n = 0;
    queue[n++] = start;
    seen[start] = 1;
    let sum = 0;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    while (head < n) {
      const p = queue[head++];
      const y = (p / width) | 0;
      const x = p - y * width;
      sum += prob[p];
      sx += x;
      sy += y;
      sxx += x * x;
      syy += y * y;
      sxy += x * y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const q = ny * width + nx;
          if (seen[q] || !(prob[q] > threshold)) continue;
          seen[q] = 1;
          queue[n++] = q;
        }
      }
    }
    if (n < MIN_PIXELS) {
      reject?.("pixels", blobBounds(queue, n, width), sum / n);
      continue;
    }
    if (sum / n < minScore) {
      reject?.("score", blobBounds(queue, n, width), sum / n);
      continue;
    }
    const mx = sx / n;
    const my = sy / n;
    const vxx = sxx / n - mx * mx;
    const vyy = syy / n - my * my;
    const vxy = sxy / n - mx * my;
    let angle = 0.5 * Math.atan2(2 * vxy, vxx - vyy);
    // Extents along the blob's own axes.
    let cos = Math.cos(angle);
    let sin = Math.sin(angle);
    let box = extents(queue, n, width, cos, sin);
    if (box.w < MIN_SIDE || box.h < MIN_SIDE) {
      reject?.("side", blobBounds(queue, n, width), sum / n);
      continue;
    }
    if (box.w < box.h * MIN_ELONGATION && box.h < box.w * MIN_ELONGATION) {
      angle = 0;
      cos = 1;
      sin = 0;
      box = extents(queue, n, width, cos, sin);
    } else if (box.h > box.w) {
      // Text runs along the long side: a tall blob is vertical text.
      reject?.("vertical", blobBounds(queue, n, width), sum / n);
      continue;
    }
    if (Math.abs(angle) > MAX_TILT) {
      reject?.("tilt", blobBounds(queue, n, width), sum / n);
      continue;
    }
    const d = (box.w * box.h * ratio) / (2 * (box.w + box.h));
    const w = box.w + 2 * d;
    const h = box.h + 2 * d;
    if (Math.min(w, h) < MIN_GROWN_SIDE) {
      reject?.("grown", blobBounds(queue, n, width), sum / n);
      continue;
    }
    boxes.push({
      cx: box.u * cos - box.v * sin,
      cy: box.u * sin + box.v * cos,
      w,
      h,
      angle,
      score: sum / n,
    });
  }
  return boxes;
}

/** The pixel bounds of a blob, `[x0, y0, x1, y1]` (far edges). */
function blobBounds(queue: Int32Array, n: number, width: number): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const y = (queue[i] / width) | 0;
    const x = queue[i] - y * width;
    if (x < x0) x0 = x;
    if (x + 1 > x1) x1 = x + 1;
    if (y < y0) y0 = y;
    if (y + 1 > y1) y1 = y + 1;
  }
  return [x0, y0, x1, y1];
}

/** The blob's size along the axes (`cos`, `sin`) and (-`sin`, `cos`), and its centre in that frame. */
function extents(
  queue: Int32Array,
  n: number,
  width: number,
  cos: number,
  sin: number,
): { w: number; h: number; u: number; v: number } {
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const p = queue[i];
    const py = (p / width) | 0;
    // The pixel's centre, in the same edge-based coordinates the boxes are used in.
    const x = p - py * width + 0.5;
    const y = py + 0.5;
    const u = x * cos + y * sin;
    const v = -x * sin + y * cos;
    if (u < u0) u0 = u;
    if (u > u1) u1 = u;
    if (v < v0) v0 = v;
    if (v > v1) v1 = v;
  }
  // Pixels have size: the box runs to their far edges. The centre is of pixel centres' box.
  return { w: u1 - u0 + 1, h: v1 - v0 + 1, u: (u0 + u1) / 2, v: (v0 + v1) / 2 };
}

/** The axis-aligned bounds of a box: `[x0, y0, x1, y1]`. */
export function boxBounds(box: TextBox): [number, number, number, number] {
  const cos = Math.abs(Math.cos(box.angle));
  const sin = Math.abs(Math.sin(box.angle));
  const hw = (box.w * cos + box.h * sin) / 2;
  const hh = (box.w * sin + box.h * cos) / 2;
  return [box.cx - hw, box.cy - hh, box.cx + hw, box.cy + hh];
}
