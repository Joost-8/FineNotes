/**
 * The text recogniser's input: each detected line cropped out of the page
 * image (turned upright if it leans a little), scaled to the height the
 * recogniser reads, normalised, and batched with lines of about the same
 * width so little padding is read.
 *
 * Also the recogniser's alphabet, from PaddleOCR's dictionary file.
 *
 * PURE: no DOM, no Obsidian, no onnxruntime.
 */

import type { TextBox } from "./db";

/** The height the recogniser reads, px. */
export const REC_HEIGHT = 48;
/** The widest crop, px (a wider line is squeezed): bounds a batch's memory. */
export const REC_MAX_WIDTH = 3200;
/** The recogniser downsamples its input's width by this much: one time step per 8 px. */
export const REC_STRIDE = 8;
/** A batch takes this many lines at most (the memory of a batch grows with it) ... */
export const REC_BATCH = 4;
/** ... and its widest crop is at most this much wider than its narrowest. */
const BATCH_WIDTH_RATIO = 1.35;

/** A line cropped to the recogniser's height: `3 x REC_HEIGHT x width`, BGR, -1..1. */
export interface RecCrop {
  /** The index of its box in the page's list. */
  index: number;
  width: number;
  data: Float32Array;
}

/** The width a box is cropped to: its aspect ratio at {@link REC_HEIGHT}, multiple of 8, capped. */
export function cropWidth(box: Pick<TextBox, "w" | "h">): number {
  const ideal = Math.ceil((REC_HEIGHT * box.w) / Math.max(1, box.h));
  return Math.min(
    REC_MAX_WIDTH,
    Math.max(REC_STRIDE * 2, Math.ceil(ideal / REC_STRIDE) * REC_STRIDE),
  );
}

/**
 * Crop `box` out of the RGBA image, upright, at the recogniser's height
 * (bilinear; white outside the page), as a tensor.
 */
export function cropLine(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  box: TextBox,
  index: number,
): RecCrop {
  const w = cropWidth(box);
  const plane = REC_HEIGHT * w;
  const data = new Float32Array(3 * plane);
  const cos = Math.cos(box.angle);
  const sin = Math.sin(box.angle);
  const sx = box.w / w;
  const sy = box.h / REC_HEIGHT;
  for (let y = 0; y < REC_HEIGHT; y++) {
    const v = (y + 0.5) * sy - box.h / 2;
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) * sx - box.w / 2;
      // The source point, minus a half pixel so pixel centres sit on integers.
      const px = box.cx + u * cos - v * sin - 0.5;
      const py = box.cy + u * sin + v * cos - 0.5;
      const x0 = Math.floor(px);
      const y0 = Math.floor(py);
      const fx = px - x0;
      const fy = py - y0;
      const o = y * w + x;
      for (let c = 0; c < 3; c++) {
        // BGR: c = 0 is the blue byte.
        const ch = 2 - c;
        const a = sample(rgba, width, height, x0, y0, ch);
        const b = sample(rgba, width, height, x0 + 1, y0, ch);
        const d = sample(rgba, width, height, x0, y0 + 1, ch);
        const e = sample(rgba, width, height, x0 + 1, y0 + 1, ch);
        const value = (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
        data[c * plane + o] = (value / 255 - 0.5) / 0.5;
      }
    }
  }
  return { index, width: w, data };
}

function sample(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  channel: number,
): number {
  if (x < 0 || y < 0 || x >= width || y >= height) return 255;
  return rgba[(y * width + x) * 4 + channel];
}

/** Group crops of similar width into batches (widest last), each at most {@link REC_BATCH} crops. */
export function batchByWidth(widths: readonly number[]): number[][] {
  const order = widths.map((_, i) => i).sort((a, b) => widths[a] - widths[b]);
  const batches: number[][] = [];
  let batch: number[] = [];
  for (const i of order) {
    if (
      batch.length > 0 &&
      (batch.length >= REC_BATCH || widths[i] > widths[batch[0]] * BATCH_WIDTH_RATIO)
    ) {
      batches.push(batch);
      batch = [];
    }
    batch.push(i);
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

/**
 * The batch's tensor, `n x 3 x REC_HEIGHT x maxWidth`: each crop at the left
 * of its row, zero (the middle of -1..1) after its end, as PaddleOCR pads.
 */
export function batchTensor(crops: readonly RecCrop[]): { data: Float32Array; width: number } {
  const width = crops.reduce((m, c) => Math.max(m, c.width), 0);
  const plane = REC_HEIGHT * width;
  const data = new Float32Array(crops.length * 3 * plane);
  crops.forEach((crop, n) => {
    for (let c = 0; c < 3; c++) {
      for (let y = 0; y < REC_HEIGHT; y++) {
        const from = c * REC_HEIGHT * crop.width + y * crop.width;
        data.set(
          crop.data.subarray(from, from + crop.width),
          n * 3 * plane + c * plane + y * width,
        );
      }
    }
  });
  return { data, width };
}

/**
 * The recogniser's classes from its dictionary file: class `k` is line `k`
 * (split on "\n" only: a line may be a character other splitters treat as a
 * break). Line 0 is a placeholder for the CTC blank, class 0, and the last
 * line is the space. Checked against the real model's output: its 18385
 * classes are this file's 18385 lines.
 */
export function alphabetFrom(dictionary: string): string[] {
  const lines = dictionary.split("\n");
  // A file ending in a line break has one empty line too many.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  lines[0] = "";
  return lines;
}
