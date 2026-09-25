/**
 * The scanner's two trips through the DOM: a photo's bytes into a working
 * RGBA raster, and a finished scan's pixels back out as JPEG or PNG bytes.
 * Everything between — detection, straightening, filters — is pure
 * (`src/canvas/homography.ts`, `page-detect.ts`, `scan-filters.ts`).
 *
 * ## Memory on an iPad
 *
 * A 12 MP camera photo is 48 MB as RGBA. It is decoded once, drawn down to
 * {@link WORK_LONG_SIDE} px (≈ 20 MB) and the decoded bitmap is closed
 * straight away; the sheet keeps only that working raster and a small copy
 * for live previews, and drops both when it closes. Every canvas made here
 * is zeroed before it goes (`releaseCanvas`): iOS holds a canvas's backing
 * store until then, whatever the garbage collector thinks.
 *
 * ## Orientation
 *
 * Camera photos are stored sideways with an EXIF orientation tag.
 * `createImageBitmap(…, { imageOrientation: "from-image" })` asks for the tag
 * to be applied; where that is missing or fails, the `<img>` path the image
 * import uses (`decodeToCanvas`) applies it the way every other Obsidian
 * view shows a photo. The sheet's Rotate button is the answer for anything
 * both get wrong — the preview shows exactly the pixels that will be saved.
 */

import { JPEG_QUALITY, fitLongSide, halvingSteps } from "../canvas/image-raster";
import type { ScanFilter } from "../canvas/scan-filters";
import { type RgbaImage, flattenOnWhite } from "../canvas/scan-raster";
import {
  type DecodedImage,
  type PreparedImage,
  decodeToCanvas,
  imageMimeOf,
  releaseCanvas,
} from "./image-import";

/**
 * Long side of the raster the sheet works on, px. The output is at most
 * 2048 px and the page rarely fills the photo, so 2560 keeps the straightened
 * page at about one photo pixel per output pixel without holding all 12 MP.
 */
export const WORK_LONG_SIDE = 2560;

/**
 * A Black & white scan is saved as PNG — measured on a synthetic 1313 × 1899
 * page: 34 KB as PNG against 192 KB as JPEG at 0.85, and lossless (no
 * ringing round the letters). Only if a PNG comes out bigger than this, as a
 * speckled photo region might, is JPEG tried too and the smaller kept.
 * Colour and Greyscale are always JPEG (there PNG measured 5–17× larger).
 */
const BW_PNG_BUDGET = 400 * 1024;

/** A finished photo scan, encoded and ready to save. `savedPath` is set once it is in the vault. */
export interface EncodedScan extends PreparedImage {
  kind: "image";
  savedPath?: string;
}

/**
 * A PDF picked in the scan sheet (the Files app's own Scan Documents makes
 * these), with its page sizes, ready to save as it is.
 */
export interface PdfScan {
  kind: "pdf";
  bytes: ArrayBuffer;
  /** The picked file's name, for the attachment's. */
  name: string;
  pages: Array<{ width: number; height: number }>;
  savedPath?: string;
}

/** Anything the sheet hands the host to add, in order. */
export type ScanItem = EncodedScan | PdfScan;

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas unavailable");
  return ctx;
}

/** A detached canvas of the given size. */
export function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = createEl("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  return canvas;
}

/** Draw `source` down to `target`, halving on the way so text does not shimmer. */
function drawStepwise(
  source: CanvasImageSource,
  width: number,
  height: number,
  target: { width: number; height: number },
): HTMLCanvasElement {
  let from: CanvasImageSource = source;
  let previous: HTMLCanvasElement | null = null;
  for (const step of halvingSteps({ width, height }, target)) {
    const canvas = makeCanvas(step.width, step.height);
    const ctx = context(canvas);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(from, 0, 0, canvas.width, canvas.height);
    if (previous) releaseCanvas(previous);
    previous = canvas;
    from = canvas;
  }
  if (!previous) throw new Error("Nothing to decode");
  return previous;
}

async function decodeWithBitmap(blob: Blob): Promise<HTMLCanvasElement | null> {
  if (typeof createImageBitmap !== "function") return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    return null; // Not decodable this way (SVG, an old engine): try <img>.
  }
  try {
    const target = fitLongSide(bitmap.width, bitmap.height, WORK_LONG_SIDE);
    return drawStepwise(bitmap, bitmap.width, bitmap.height, target);
  } finally {
    bitmap.close();
  }
}

/** A canvas's pixels as an {@link RgbaImage} (a copy; the canvas can go). */
export function readPixels(canvas: HTMLCanvasElement): RgbaImage {
  const data = context(canvas).getImageData(0, 0, canvas.width, canvas.height);
  return { width: data.width, height: data.height, data: data.data };
}

/**
 * Decode a photo into the sheet's working raster: upright, at most
 * {@link WORK_LONG_SIDE} px on its long side, flattened onto white. Rejects
 * when the bytes are not a picture this platform can decode.
 */
export async function decodePhoto(bytes: ArrayBuffer, mime: string): Promise<RgbaImage> {
  const type = imageMimeOf(bytes, mime);
  let canvas = await decodeWithBitmap(new Blob([bytes], { type }));
  if (!canvas) {
    const decoded: DecodedImage = await decodeToCanvas(bytes, type, (w, h) =>
      fitLongSide(w, h, WORK_LONG_SIDE),
    );
    canvas = decoded.canvas;
  }
  try {
    const img = readPixels(canvas);
    flattenOnWhite(img);
    return img;
  } finally {
    releaseCanvas(canvas);
  }
}

/** Put `img` on `canvas`, resizing the canvas to fit it exactly. */
export function paint(canvas: HTMLCanvasElement, img: RgbaImage): void {
  if (canvas.width !== img.width) canvas.width = img.width;
  if (canvas.height !== img.height) canvas.height = img.height;
  context(canvas).putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
}

function encode(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("The scan could not be encoded"));
          return;
        }
        blob.arrayBuffer().then(resolve, reject);
      },
      mime,
      quality,
    );
  });
}

/** Encode a finished, filtered scan for saving (see {@link BW_PNG_BUDGET} for the formats). */
export async function encodeScan(img: RgbaImage, filter: ScanFilter): Promise<EncodedScan> {
  const canvas = makeCanvas(img.width, img.height);
  try {
    paint(canvas, img);
    const { width, height } = img;
    const jpeg = async (): Promise<EncodedScan> => ({
      kind: "image",
      bytes: await encode(canvas, "image/jpeg", JPEG_QUALITY),
      mime: "image/jpeg",
      ext: "jpg",
      width,
      height,
    });
    if (filter !== "bw") return await jpeg();
    const png: EncodedScan = {
      kind: "image",
      bytes: await encode(canvas, "image/png"),
      mime: "image/png",
      ext: "png",
      width,
      height,
    };
    if (png.bytes.byteLength <= BW_PNG_BUDGET) return png;
    const alternative = await jpeg();
    return alternative.bytes.byteLength < png.bytes.byteLength ? alternative : png;
  } finally {
    releaseCanvas(canvas);
  }
}
