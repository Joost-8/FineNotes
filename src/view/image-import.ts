/**
 * Getting a picture's bytes into the vault: decoding, downscaling and
 * re-encoding a picked photo, saving it where the user keeps attachments, and
 * the hidden file input the Photos and camera entries open.
 *
 * Every decision here — the size limit, the format, the file name, the
 * dot-folder guard — is made by `src/canvas/image-raster.ts`, which is pure
 * and tested. This file only carries those decisions out with the DOM and the
 * vault.
 *
 * Decoding goes through an `<img>` fed a `blob:` URL of the file's bytes,
 * never through `vault.getResourcePath`: a blob URL is same-origin, so a
 * canvas that draws it stays readable (the transparency scan below needs
 * that, and so will anything that later exports a page). `<img>` rather than
 * `createImageBitmap` because it decodes SVG too, and applies a photo's EXIF
 * orientation the way every other Obsidian view shows it.
 */

import { type App, type TFile, normalizePath } from "obsidian";
import {
  MAX_IMAGE_LONG_SIDE,
  attachmentBaseName,
  availablePath,
  extensionForMime,
  fitLongSide,
  halvingSteps,
  hasTransparentPixel,
  isHiddenPath,
  mayHaveTransparency,
  normalizeMime,
  parentFolder,
  planImageEncode,
  pngMayHaveAlpha,
  sniffImageMime,
} from "../canvas/image-raster";

/** A picture ready to be saved: its bytes, format and pixel size. */
export interface PreparedImage {
  bytes: ArrayBuffer;
  mime: string;
  ext: string;
  width: number;
  height: number;
}

/** Size assumed for a picture that reports none (an SVG with only a viewBox). */
const FALLBACK_SIZE = 1024;

interface LoadedImage {
  img: HTMLImageElement;
  width: number;
  height: number;
  /** Drop the blob URL. Call once the image has been drawn. */
  release(): void;
}

/** Give a canvas's backing store back now; iOS holds canvas memory until then. */
export function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

/** The MIME type to trust for some bytes: what they say they are, else the label. */
export function imageMimeOf(bytes: ArrayBuffer, label: string): string {
  return (
    sniffImageMime(new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 512))) ??
    normalizeMime(label)
  );
}

async function loadImage(bytes: ArrayBuffer, mime: string): Promise<LoadedImage> {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  // Obsidian's global createEl makes a detached element, which is all a
  // decode target needs (the plugin-review lint rejects document.createElement).
  const img = createEl("img");
  img.decoding = "async";
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("The picture could not be decoded"));
      img.src = url;
    });
    // onload alone can leave the decode to the first draw, on the main thread.
    if (typeof img.decode === "function") await img.decode().catch(() => undefined);
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  return {
    img,
    width: img.naturalWidth || FALLBACK_SIZE,
    height: img.naturalHeight || FALLBACK_SIZE,
    release: () => {
      URL.revokeObjectURL(url);
      img.removeAttribute("src");
    },
  };
}

/**
 * Draw `source` into a new canvas of `target` size. A raster is halved step
 * by step on the way down (one big jump samples too few source pixels and
 * shimmers); a vector is drawn at its target size directly.
 */
function scaleInto(
  source: CanvasImageSource,
  width: number,
  height: number,
  target: { width: number; height: number },
  stepwise: boolean,
): HTMLCanvasElement {
  const steps = stepwise ? halvingSteps({ width, height }, target) : [target];
  let from: CanvasImageSource = source;
  let previous: HTMLCanvasElement | null = null;
  for (const step of steps) {
    const canvas = createEl("canvas");
    canvas.width = Math.max(1, step.width);
    canvas.height = Math.max(1, step.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      if (previous) releaseCanvas(previous);
      throw new Error("Canvas unavailable for decoding a picture");
    }
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

/** A decoded picture at a chosen size, plus the size it came in at. */
export interface DecodedImage {
  canvas: HTMLCanvasElement;
  naturalWidth: number;
  naturalHeight: number;
}

/**
 * Decode `bytes` and draw them into a canvas of the size `sizeFor` picks from
 * the picture's natural size. Rejects when the bytes are not a picture this
 * platform can decode.
 */
export async function decodeToCanvas(
  bytes: ArrayBuffer,
  mime: string,
  sizeFor: (width: number, height: number) => { width: number; height: number },
): Promise<DecodedImage> {
  const type = imageMimeOf(bytes, mime);
  const loaded = await loadImage(bytes, type);
  try {
    const target = sizeFor(loaded.width, loaded.height);
    const canvas = scaleInto(
      loaded.img,
      loaded.width,
      loaded.height,
      target,
      type !== "image/svg+xml",
    );
    return { canvas, naturalWidth: loaded.width, naturalHeight: loaded.height };
  } finally {
    loaded.release();
  }
}

/** A picture's natural size, without keeping anything decoded. */
export async function measureImage(
  bytes: ArrayBuffer,
  mime: string,
): Promise<{ width: number; height: number }> {
  const loaded = await loadImage(bytes, imageMimeOf(bytes, mime));
  loaded.release();
  return { width: loaded.width, height: loaded.height };
}

function canvasHasTransparency(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext("2d");
  if (!ctx) return true;
  try {
    return hasTransparentPixel(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
  } catch {
    // A canvas that cannot be read back is treated as transparent: PNG is
    // the safe answer, since JPEG would paint the see-through parts black.
    return true;
  }
}

/** Paint white under everything: JPEG has no alpha and shows transparent pixels as black. */
function flattenOnWhite(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.save();
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("The picture could not be encoded"))),
      mime,
      quality,
    );
  });
}

/**
 * Make a picked picture fit for a synced notebook (`planImageEncode` has the
 * rules): at most {@link MAX_IMAGE_LONG_SIDE} px on its long side, JPEG at
 * 0.85 unless it has transparency (then PNG), GIF and SVG untouched, and an
 * already-small JPEG, PNG or WebP left byte for byte as it came.
 */
export async function prepareImageBytes(
  bytes: ArrayBuffer,
  mime: string,
  maxLongSide = MAX_IMAGE_LONG_SIDE,
): Promise<PreparedImage> {
  const type = imageMimeOf(bytes, mime);
  const loaded = await loadImage(bytes, type);
  let canvas: HTMLCanvasElement | null = null;
  try {
    const { width, height } = loaded;
    if (type === "image/gif" || type === "image/svg+xml") {
      return { bytes, mime: type, ext: extensionForMime(type), width, height };
    }
    const fit = fitLongSide(width, height, maxLongSide);
    canvas = scaleInto(loaded.img, width, height, fit, true);
    const transparent =
      mayHaveTransparency(type) &&
      (type !== "image/png" || pngMayHaveAlpha(new Uint8Array(bytes))) &&
      canvasHasTransparency(canvas);
    const plan = planImageEncode(
      { mime: type, byteLength: bytes.byteLength, width, height, transparent },
      maxLongSide,
    );
    if (plan.kind === "keep") return { bytes, mime: plan.mime, ext: plan.ext, width, height };

    if (plan.mime === "image/jpeg") flattenOnWhite(canvas);
    const encoded = await (await canvasToBlob(canvas, plan.mime, plan.quality)).arrayBuffer();
    // A same-size re-encode that saves nothing is not worth the quality it costs.
    const unscaled = fit.width === width && fit.height === height;
    if (
      unscaled &&
      (type === "image/png" || type === "image/webp") &&
      encoded.byteLength >= bytes.byteLength
    ) {
      return { bytes, mime: type, ext: extensionForMime(type), width, height };
    }
    return {
      bytes: encoded,
      mime: plan.mime,
      ext: plan.ext,
      width: plan.width,
      height: plan.height,
    };
  } finally {
    if (canvas) releaseCanvas(canvas);
    loaded.release();
  }
}

/**
 * Save a prepared picture as an attachment of the note at `notePath`: in
 * `folder` when the note chose one (its settings button), otherwise where
 * the user's "Default location for new attachments" says — through
 * `fileManager.getAvailablePathForAttachment`, which also picks a free name.
 *
 * One exception: a location inside a dot-folder (`.attachments/`, say) is
 * refused, because Obsidian does not index dot-folders and the picture could
 * never be found to draw it. It then goes next to the note instead.
 */
export async function saveImageAttachment(
  app: App,
  prepared: PreparedImage,
  suggestedName: string,
  notePath: string,
  folder?: string,
): Promise<TFile> {
  const base = attachmentBaseName(suggestedName, new Date());
  const exists = (candidate: string): boolean =>
    app.vault.getAbstractFileByPath(normalizePath(candidate)) !== null;
  let path = normalizePath(
    folder
      ? availablePath(folder, base, prepared.ext, exists)
      : await app.fileManager.getAvailablePathForAttachment(`${base}.${prepared.ext}`, notePath),
  );
  if (isHiddenPath(path)) {
    path = normalizePath(availablePath(parentFolder(notePath), base, prepared.ext, exists));
  }
  const parent = parentFolder(path);
  if (parent && !app.vault.getFolderByPath(parent)) {
    try {
      await app.vault.createFolder(parent);
    } catch {
      // Created meanwhile (or by getAvailablePathForAttachment itself).
    }
  }
  return app.vault.createBinary(path, prepared.bytes);
}

/**
 * Open the system picker for one picture: the photo library, or with
 * `capture` the camera. Resolves with the chosen file, or `null` on cancel.
 *
 * Must be called synchronously from the user's tap: iPadOS only opens a
 * picker for a `click()` made inside a user gesture. The input is appended to
 * `host` (some WebKit versions ignore a detached one), hidden by moving it off
 * screen rather than with `display: none` (which older iOS refused to open),
 * and removed once it reports. Whether Obsidian's iPad app lets the picker
 * through at all is unverified; "From vault" is the path that always works.
 *
 * `accept` widens what may be picked (scanning also takes a PDF).
 */
export function pickImageFile(
  host: HTMLElement,
  capture: boolean,
  accept = "image/*",
): Promise<File | null> {
  const input = host.createEl("input", {
    cls: "goodobsidian-file-input",
    attr: { type: "file", accept, "aria-hidden": "true", tabindex: "-1" },
  });
  if (capture) input.setAttribute("capture", "environment");
  return new Promise((resolve) => {
    let settled = false;
    const finish = (file: File | null): void => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file);
    };
    input.addEventListener("change", () => finish(input.files?.[0] ?? null));
    // `cancel` is recent (Safari 16.4); without it a dismissed picker leaves
    // the hidden input behind until the view closes, which is harmless.
    input.addEventListener("cancel", () => finish(null));
    input.click();
  });
}
