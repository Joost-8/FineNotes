/**
 * A copied picture on the **system** clipboard (0.5) — the bonus beside the
 * plugin's own clipboard (`src/model/clipboard.ts`), which is what Cut, Copy
 * and Paste inside notebooks use. Only a lone picture can travel this way:
 * other apps have no idea what a stroke is.
 *
 * Best effort by design. Where the platform has no asynchronous clipboard, or
 * refuses the write (iPadOS WebKit allows it only inside a user gesture, and
 * only for PNG), nothing happens and nothing is reported: the plugin's own
 * clipboard has the picture either way.
 */

import type { App } from "obsidian";
import type { ImageElement } from "../model/document";
import { cropSourceRect } from "../canvas/image-crop";
import { MAX_IMAGE_LONG_SIDE, fitLongSide, mimeForExtension } from "../canvas/image-raster";
import { decodeToCanvas, releaseCanvas } from "./image-import";

/**
 * Put a placed picture on the system clipboard as a PNG, cropped and
 * mirrored as it shows (not turned: a rotation belongs to the page, not to
 * the picture).
 * Must be called inside the user's gesture: the clipboard item is handed
 * over at once with a promise of the pixels, which WebKit accepts while the
 * gesture lasts and Chromium accepts anyway.
 */
export function copyPictureToSystemClipboard(app: App, image: ImageElement): void {
  const clip = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  if (!clip || typeof clip.write !== "function" || typeof ClipboardItem === "undefined") return;
  const png = pictureAsPng(app, image);
  // Nobody else may be left holding a rejection.
  png.catch(() => undefined);
  try {
    const item = new ClipboardItem({ "image/png": png });
    clip.write([item]).catch(() => undefined);
  } catch {
    // An engine that refuses a promise inside a ClipboardItem: skip.
  }
}

/**
 * Put a PNG on the system clipboard (the lasso's Screenshot): resolves to
 * whether it got there. As above, call it inside the user's gesture with
 * the promise of the pixels, not after awaiting them.
 */
export async function writePngToClipboard(png: Promise<Blob>): Promise<boolean> {
  const clip = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  png.catch(() => undefined);
  if (!clip || typeof clip.write !== "function" || typeof ClipboardItem === "undefined") {
    return false;
  }
  try {
    await clip.write([new ClipboardItem({ "image/png": png })]);
    return true;
  } catch {
    return false;
  }
}

/** The picture's pixels (at most 2048 px long), its crop and flips applied, as PNG. */
async function pictureAsPng(app: App, image: ImageElement): Promise<Blob> {
  const file = app.vault.getFileByPath(image.path);
  if (!file) throw new Error(`Missing image — ${image.path}`);
  const bytes = await app.vault.readBinary(file);
  const decoded = await decodeToCanvas(bytes, mimeForExtension(file.extension) ?? "", (w, h) =>
    fitLongSide(w, h, MAX_IMAGE_LONG_SIDE),
  );
  let canvas = decoded.canvas;
  const flipX = image.flipX === true;
  const flipY = image.flipY === true;
  if (image.crop || flipX || flipY) {
    const src = image.crop
      ? cropSourceRect(image.crop, canvas.width, canvas.height)
      : { sx: 0, sy: 0, sw: canvas.width, sh: canvas.height };
    const cropped = createEl("canvas");
    cropped.width = Math.max(1, Math.round(src.sw));
    cropped.height = Math.max(1, Math.round(src.sh));
    const ctx = cropped.getContext("2d");
    if (ctx) {
      ctx.translate(flipX ? cropped.width : 0, flipY ? cropped.height : 0);
      ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
      ctx.drawImage(canvas, src.sx, src.sy, src.sw, src.sh, 0, 0, cropped.width, cropped.height);
    }
    releaseCanvas(canvas);
    canvas = cropped;
  }
  try {
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("The picture could not be encoded"))),
        "image/png",
      );
    });
  } finally {
    releaseCanvas(canvas);
  }
}
