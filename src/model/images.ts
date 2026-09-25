/**
 * Placing images on a page: fresh ids, where a new picture lands, and what a
 * duplicate looks like. Pure — no DOM, no Obsidian. The mutation itself is
 * always the existing `InsertImage` command (contracts/api.md §6, rule 3), so
 * a placed image undoes with the ink.
 */

import type { Bounds, ImageElement, InkDocument, PageGeometry } from "./document";

/** A new picture fits inside this fraction of the page's width and height. */
export const IMAGE_PLACE_FRACTION = 0.6;
/** A tiny picture is scaled up to at least this long side, page px, to be grabbable. */
export const IMAGE_MIN_PLACE_SIDE = 48;
/** How far down and right a duplicate lands from its original, page px. */
export const DUPLICATE_OFFSET = 24;

/**
 * The next free `i<N>` image id. Image ids are unique across the whole
 * document, as stroke and text-box ids are (see `duplicatePageAfter`), and are
 * seeded from the maximum rather than the count so a deleted image's id is
 * never minted again while its undo is still on the stack.
 */
export function nextImageId(doc: InkDocument): string {
  let max = 0;
  for (const page of doc.pages) {
    for (const image of page.images) {
      const match = /^i(\d+)$/.exec(image.id);
      if (match) max = Math.max(max, Number(match[1]));
    }
  }
  return `i${max + 1}`;
}

/**
 * Where a picture of natural size `natural` lands on a page: fitted inside
 * {@link IMAGE_PLACE_FRACTION} of the page (never enlarged past its own pixel
 * size, except that a tiny one grows to {@link IMAGE_MIN_PLACE_SIDE}), aspect
 * kept, centred in the part of the page that is on screen (`visible`, page
 * space), and kept on the page.
 *
 * A picture with no usable natural size (an SVG without dimensions) is placed
 * square.
 */
export function placeImageBox(
  natural: { width: number; height: number },
  page: PageGeometry,
  visible?: Bounds | null,
  fraction = IMAGE_PLACE_FRACTION,
): { x: number; y: number; w: number; h: number } {
  const valid = natural.width > 0 && natural.height > 0;
  const nw = valid && Number.isFinite(natural.width) ? natural.width : 1;
  const nh = valid && Number.isFinite(natural.height) ? natural.height : 1;
  const maxW = Math.max(1, page.width * fraction);
  const maxH = Math.max(1, page.height * fraction);
  const fit = Math.min(maxW / nw, maxH / nh);
  let k = valid ? Math.min(1, fit) : fit;
  if (Math.max(nw, nh) * k < IMAGE_MIN_PLACE_SIDE) {
    k = Math.min(IMAGE_MIN_PLACE_SIDE / Math.max(nw, nh), fit);
  }
  const w = nw * k;
  const h = nh * k;

  const area = clipToPage(visible ?? null, page);
  const cx = (area.minX + area.maxX) / 2;
  const cy = (area.minY + area.maxY) / 2;
  return {
    x: clamp(cx - w / 2, 0, Math.max(0, page.width - w)),
    y: clamp(cy - h / 2, 0, Math.max(0, page.height - h)),
    w,
    h,
  };
}

/** A new image element with a fresh id. */
export function newImageElement(
  doc: InkDocument,
  path: string,
  box: { x: number; y: number; w: number; h: number; rotation?: number },
): ImageElement {
  const image: ImageElement = {
    id: nextImageId(doc),
    path,
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
  };
  if (typeof box.rotation === "number" && box.rotation !== 0 && Number.isFinite(box.rotation)) {
    image.rotation = box.rotation;
  }
  return image;
}

/**
 * A copy of `image` with a fresh id, nudged down and right so it reads as a
 * second picture, and kept on the page where it fits. Both share one file:
 * a duplicate never copies the attachment. The copy shows the same part of
 * the picture (its crop); it is never locked.
 */
export function duplicateImage(
  doc: InkDocument,
  page: PageGeometry,
  image: ImageElement,
): ImageElement {
  const x = clamp(
    image.x + DUPLICATE_OFFSET,
    Math.min(0, image.x),
    Math.max(image.x, page.width - image.w),
  );
  const y = clamp(
    image.y + DUPLICATE_OFFSET,
    Math.min(0, image.y),
    Math.max(image.y, page.height - image.h),
  );
  const copy = newImageElement(doc, image.path, { ...image, x, y });
  if (image.crop) copy.crop = { ...image.crop };
  return copy;
}

/** The visible band clipped to the page; the whole page when it misses it. */
function clipToPage(visible: Bounds | null, page: PageGeometry): Bounds {
  const whole = { minX: 0, minY: 0, maxX: page.width, maxY: page.height };
  if (!visible) return whole;
  const clipped = {
    minX: Math.max(0, visible.minX),
    minY: Math.max(0, visible.minY),
    maxX: Math.min(page.width, visible.maxX),
    maxY: Math.min(page.height, visible.maxY),
  };
  return clipped.maxX > clipped.minX && clipped.maxY > clipped.minY ? clipped : whole;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
