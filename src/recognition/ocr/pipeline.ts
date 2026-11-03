/**
 * Reading one page image: detect the text lines (tiled, DBNet), put them in
 * reading order, recognise each (SVTR, CTC), and turn the characters'
 * positions into words with boxes in the page's points.
 *
 * The neural networks are behind {@link OcrBackend}: the worker
 * (ocr/worker.ts) runs them with onnxruntime-web, and the tests and the
 * accuracy check run this same code with whatever backend they have. Nothing
 * here touches the DOM, and each tensor is dropped as soon as it was used.
 *
 * PURE: no DOM, no Obsidian, no onnxruntime.
 */

import { type CropLine, ctcDecode, wordsOf } from "./ctc-words";
import { type TextBox, findTextBoxes } from "./db";
import { type DetTile, planTiles, stitchProbability, tileTensor } from "./det";
import type { OcrLine, OcrPage, OcrWord } from "./ocr-words";
import { readingOrder } from "./reading-order";
import { REC_STRIDE, type RecCrop, batchByWidth, batchTensor, cropLine, cropWidth } from "./rec";

/** The two networks. Tensors are `float32`; the backend owns nothing it is handed. */
export interface OcrBackend {
  /** `tensor` is `3 x height x width` (batch of one); resolves to the `height x width` probability map. */
  detect(tensor: Float32Array, width: number, height: number): Promise<Float32Array>;
  /** `data` is `n x 3 x 48 x width`; resolves to `n x steps x classes` probabilities. */
  recognize(
    data: Float32Array,
    n: number,
    width: number,
  ): Promise<{ probs: Float32Array; steps: number; classes: number }>;
}

/** An image to read: RGBA bytes. */
export interface OcrImage {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export class OcrCancelled extends Error {
  constructor() {
    super("OCR cancelled");
    this.name = "OcrCancelled";
  }
}

export interface ReadOptions {
  /** Pixels per point of the page (the raster's scale). */
  scale: number;
  /** The page in points, at scale 1. */
  pageWidth: number;
  pageHeight: number;
  alphabet: readonly string[];
  /** Asked between steps; true stops the page with {@link OcrCancelled}. */
  cancelled?: () => boolean;
  /** Called with a short note when a step finishes (timings, for the accuracy check). */
  onStep?: (step: string, ms: number) => void;
}

/** The page's text boxes, in reading order. */
export async function detectBoxes(
  image: OcrImage,
  backend: OcrBackend,
  options: Pick<ReadOptions, "cancelled" | "onStep"> = {},
): Promise<TextBox[]> {
  const { width, height } = image;
  const map = new Float32Array(width * height);
  const t0 = Date.now();
  for (const tile of planTiles(width, height)) {
    if (options.cancelled?.()) throw new OcrCancelled();
    await detectTile(image, tile, map, backend);
  }
  options.onStep?.("detect", Date.now() - t0);
  const t1 = Date.now();
  const boxes = readingOrder(findTextBoxes(map, width, height));
  options.onStep?.("boxes", Date.now() - t1);
  return boxes;
}

async function detectTile(
  image: OcrImage,
  tile: DetTile,
  map: Float32Array,
  backend: OcrBackend,
): Promise<void> {
  const tensor = tileTensor(image.data, image.width, tile);
  const prob = await backend.detect(tensor, tile.padW, tile.padH);
  stitchProbability(map, image.width, tile, prob);
}

/** Read the page image: its lines of words, with confidences, in reading order. */
export async function readPage(
  image: OcrImage,
  backend: OcrBackend,
  options: ReadOptions,
): Promise<OcrPage> {
  const boxes = await detectBoxes(image, backend, options);
  const t0 = Date.now();
  const lines: (OcrLine | undefined)[] = new Array<OcrLine | undefined>(boxes.length);
  const widths = boxes.map((b) => cropWidth(b));
  for (const batch of batchByWidth(widths)) {
    if (options.cancelled?.()) throw new OcrCancelled();
    const crops: RecCrop[] = batch.map((i) =>
      cropLine(image.data, image.width, image.height, boxes[i], i),
    );
    const input = batchTensor(crops);
    const out = await backend.recognize(input.data, crops.length, input.width);
    if (out.classes !== options.alphabet.length) {
      throw new Error(
        `the recogniser has ${out.classes} classes, its dictionary ${options.alphabet.length}`,
      );
    }
    crops.forEach((crop, n) => {
      const steps = Math.min(out.steps, Math.ceil(crop.width / REC_STRIDE));
      const rows = out.probs.subarray(
        n * out.steps * out.classes,
        (n + 1) * out.steps * out.classes,
      );
      const chars = ctcDecode(rows, steps, out.classes, options.alphabet);
      const line = wordsOf(chars, crop.width);
      lines[crop.index] = pageLine(line, boxes[crop.index], crop.width, options.scale);
    });
  }
  options.onStep?.("recognise", Date.now() - t0);
  return {
    imageWidth: image.width,
    imageHeight: image.height,
    pageWidth: options.pageWidth,
    pageHeight: options.pageHeight,
    lines: lines.filter((l): l is OcrLine => l !== undefined && l.words.length > 0),
  };
}

/** A recognised crop's words as boxes in the page's points. */
function pageLine(line: CropLine, box: TextBox, cropW: number, scale: number): OcrLine | undefined {
  if (line.words.length === 0) return undefined;
  const cos = Math.cos(box.angle);
  const sin = Math.sin(box.angle);
  const words: OcrWord[] = line.words.map((w) => {
    const u0 = (w.x0 / cropW) * box.w - box.w / 2;
    const u1 = (w.x1 / cropW) * box.w - box.w / 2;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const u of [u0, u1]) {
      for (const v of [-box.h / 2, box.h / 2]) {
        const x = box.cx + u * cos - v * sin;
        const y = box.cy + u * sin + v * cos;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
    return {
      text: w.text,
      box: [x0 / scale, y0 / scale, x1 / scale, y1 / scale],
      conf: round(w.conf),
      min: round(w.min),
    };
  });
  return { conf: round(line.conf), words };
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
