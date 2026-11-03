/**
 * The text detector's input: a page image cut into tiles the detector can
 * hold in a phone's memory, each normalised into a channel-first tensor, and
 * the tiles' probability maps stitched back into one map the size of the page.
 *
 * Tiles keep the image's own pixels (no resizing, so small print stays
 * readable); a side of a tile is a multiple of 32, as DBNet needs, padded
 * with white past the image's edge. Neighbouring tiles overlap, and where
 * they do the map keeps the larger probability, so a line of text across a
 * seam is still one blob.
 *
 * PURE: no DOM, no Obsidian, no onnxruntime.
 */

/** The longest side of a tile, a multiple of 32: bounds the detector's memory (measured: 1280 took 270 MB more than 800 on an A4 page). */
export const DET_TILE_SIDE = 800;
/** How far neighbouring tiles overlap, px. */
export const DET_TILE_OVERLAP = 96;
const MULTIPLE = 32;

/** ImageNet's mean and standard deviation, in the order the detector was trained on (BGR). */
const MEAN = [0.485, 0.456, 0.406] as const;
const STD = [0.229, 0.224, 0.225] as const;

/** A tile: the part of the image it shows, and the (padded) size of its tensor. */
export interface DetTile {
  x: number;
  y: number;
  /** The image pixels it covers. */
  w: number;
  h: number;
  /** Its tensor's size: `w` and `h` rounded up to a multiple of 32. */
  padW: number;
  padH: number;
}

export function roundUp32(n: number): number {
  return Math.max(MULTIPLE, Math.ceil(n / MULTIPLE) * MULTIPLE);
}

/** Starts and length of the tiles along one axis of `length` px. */
function axisTiles(length: number, side: number, overlap: number): { at: number; len: number }[] {
  if (length <= side) return [{ at: 0, len: length }];
  const n = Math.ceil((length - overlap) / (side - overlap));
  const len = Math.ceil((length + (n - 1) * overlap) / n);
  const out: { at: number; len: number }[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ at: n === 1 ? 0 : Math.round(((length - len) * i) / (n - 1)), len });
  }
  return out;
}

/** The tiles that cover a `width` x `height` image, in reading order. */
export function planTiles(
  width: number,
  height: number,
  side = DET_TILE_SIDE,
  overlap = DET_TILE_OVERLAP,
): DetTile[] {
  const xs = axisTiles(width, side, overlap);
  const ys = axisTiles(height, side, overlap);
  const tiles: DetTile[] = [];
  for (const y of ys) {
    for (const x of xs) {
      tiles.push({
        x: x.at,
        y: y.at,
        w: x.len,
        h: y.len,
        padW: roundUp32(x.len),
        padH: roundUp32(y.len),
      });
    }
  }
  return tiles;
}

/**
 * The tile's tensor, `3 x padH x padW`: RGBA bytes of the whole image in,
 * channels in BGR order (as PaddleOCR reads images) scaled to 0..1 and
 * normalised with ImageNet's mean and deviation; padding is white.
 */
export function tileTensor(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  tile: DetTile,
  out?: Float32Array,
): Float32Array {
  const plane = tile.padW * tile.padH;
  const data = out && out.length >= 3 * plane ? out : new Float32Array(3 * plane);
  const white = [0, 1, 2].map((c) => (1 - MEAN[c]) / STD[c]);
  for (let c = 0; c < 3; c++) data.fill(white[c], c * plane, (c + 1) * plane);
  for (let y = 0; y < tile.h; y++) {
    let src = ((tile.y + y) * width + tile.x) * 4;
    let dst = y * tile.padW;
    for (let x = 0; x < tile.w; x++, src += 4, dst++) {
      // BGR: channel 0 is blue (byte 2 of RGBA).
      data[dst] = (rgba[src + 2] / 255 - MEAN[0]) / STD[0];
      data[plane + dst] = (rgba[src + 1] / 255 - MEAN[1]) / STD[1];
      data[2 * plane + dst] = (rgba[src] / 255 - MEAN[2]) / STD[2];
    }
  }
  return data;
}

/** Put a tile's probability map (`padW x padH`) into the page-sized `map`, keeping the larger value. */
export function stitchProbability(
  map: Float32Array,
  width: number,
  tile: DetTile,
  prob: ArrayLike<number>,
): void {
  for (let y = 0; y < tile.h; y++) {
    let src = y * tile.padW;
    let dst = (tile.y + y) * width + tile.x;
    for (let x = 0; x < tile.w; x++, src++, dst++) {
      if (prob[src] > map[dst]) map[dst] = prob[src];
    }
  }
}

/** The resolution a page is rasterised at for OCR, dots per inch (a point is 1/72 inch) ... */
export const OCR_DPI = 170;
/** ... unless its longer side would come out longer than this, px: bounds memory on a phone. */
export const OCR_MAX_EDGE = 2200;

/** Pixels per point to rasterise a page of `width` x `height` points at for OCR. */
export function rasterScale(width: number, height: number): number {
  const longest = Math.max(width, height);
  const scale = OCR_DPI / 72;
  return longest > 0 ? Math.min(scale, OCR_MAX_EDGE / longest) : scale;
}
