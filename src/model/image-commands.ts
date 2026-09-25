/**
 * Commands on one placed picture (0.5): bring it to the front or send it to
 * the back among the page's pictures, lock or unlock it, and crop it. Each is
 * one undo step. Pure, like the rest of `src/model/`.
 *
 * The picture is held by identity, falling back to its id only if the object
 * is gone: ids are only unique per file, and a hand-edited or merged note can
 * repeat one (CLAUDE.md, "Resolve an inverse by identity, not by a key that
 * can repeat"). Every inverse restores the element's exact previous state —
 * the same keys, in the same order, absent ones absent — so an undo leaves
 * the document `JSON.stringify`-identical (contracts/api.md §3): `locked` and
 * `crop` are deleted, never set to `false` or `undefined`.
 *
 * Pictures stack in `page.images` order, bottom first, and every picture is
 * drawn under the ink and the text boxes; "front" and "back" only reorder the
 * pictures among themselves.
 */

import type { Command } from "./commands";
import {
  type ImageCrop,
  type ImageElement,
  type InkDocument,
  type Page,
  pageById,
} from "./document";

/** Where a picture can be moved in its page's stack. */
export type ImageLayer = "front" | "back";

/** The picture itself if it is still on `page`, else the first with its id, else `null`. */
function findImage(page: Page, image: ImageElement): ImageElement | null {
  if (page.images.includes(image)) return image;
  return page.images.find((candidate) => candidate.id === image.id) ?? null;
}

/** A shallow copy of an element's own keys, in their order. */
function snapshot(image: ImageElement): ImageElement {
  return { ...image };
}

/** Put an element back to a snapshot: the same keys, in the same order, and no others. */
function restore(image: ImageElement, saved: ImageElement): void {
  const target = image as unknown as Record<string, unknown>;
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(image, saved);
}

/**
 * Whether a picture can go any further `to` the front or back of its page's
 * pictures — false when it is already there, or alone, or not on the page.
 */
export function canReorderImage(page: Page, image: ImageElement, to: ImageLayer): boolean {
  const index = page.images.indexOf(image);
  if (index < 0) return false;
  return to === "front" ? index < page.images.length - 1 : index > 0;
}

/**
 * Bring a picture to the front of the page's pictures, or send it to the
 * back. Undo puts it back at exactly the place it had, so the order of every
 * other picture is restored with it.
 */
export class ReorderImage implements Command {
  readonly label: string;
  /** Where the picture was before, and the object moved; `null` when nothing moved. */
  private moved: { image: ImageElement; index: number } | null = null;

  constructor(
    readonly pageId: string,
    private readonly image: ImageElement,
    private readonly to: ImageLayer,
  ) {
    this.label = to === "front" ? "Bring to front" : "Send to back";
  }

  apply(doc: InkDocument): void {
    this.moved = null;
    const page = pageById(doc, this.pageId);
    const image = page ? findImage(page, this.image) : null;
    if (!page || !image) return;
    const index = page.images.indexOf(image);
    page.images.splice(index, 1);
    if (this.to === "front") page.images.push(image);
    else page.images.unshift(image);
    this.moved = { image, index };
  }

  invert(doc: InkDocument): void {
    const page = pageById(doc, this.pageId);
    const moved = this.moved;
    if (!page || !moved) return;
    const at = page.images.indexOf(moved.image);
    if (at < 0) return;
    page.images.splice(at, 1);
    page.images.splice(Math.min(moved.index, page.images.length), 0, moved.image);
    this.moved = null;
  }
}

/**
 * Lock a picture (`locked: true`) or unlock it (the key deleted). A locked
 * picture cannot be selected, moved or erased until it is unlocked.
 */
export class SetImageLocked implements Command {
  readonly label: string;
  private previous: { image: ImageElement; saved: ImageElement } | null = null;

  constructor(
    readonly pageId: string,
    private readonly image: ImageElement,
    private readonly locked: boolean,
  ) {
    this.label = locked ? "Lock image" : "Unlock image";
  }

  apply(doc: InkDocument): void {
    this.previous = null;
    const page = pageById(doc, this.pageId);
    const image = page ? findImage(page, this.image) : null;
    if (!image) return;
    this.previous = { image, saved: snapshot(image) };
    if (this.locked) image.locked = true;
    else delete image.locked;
  }

  invert(doc: InkDocument): void {
    const previous = this.previous;
    if (!previous || !pageById(doc, this.pageId)) return;
    restore(previous.image, previous.saved);
    this.previous = null;
  }
}

/** A picture's box and crop after cropping; `crop` absent means the whole picture. */
export interface ImageCropGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
  crop?: ImageCrop;
}

/**
 * Crop a picture: set its visible box and the part of the source it shows
 * (`src/canvas/image-crop.ts` computes both, so the part that stays visible
 * does not move). An absent `crop` shows the whole picture again, and the key
 * is deleted. The file is never touched; the rotation is left as it is.
 */
export class CropImage implements Command {
  readonly label = "Crop image";
  private readonly next: ImageCropGeometry;
  private previous: { image: ImageElement; saved: ImageElement } | null = null;

  constructor(
    readonly pageId: string,
    private readonly image: ImageElement,
    next: ImageCropGeometry,
  ) {
    this.next = { x: next.x, y: next.y, w: next.w, h: next.h };
    if (next.crop) this.next.crop = { ...next.crop };
  }

  apply(doc: InkDocument): void {
    this.previous = null;
    const page = pageById(doc, this.pageId);
    const image = page ? findImage(page, this.image) : null;
    if (!image) return;
    this.previous = { image, saved: snapshot(image) };
    image.x = this.next.x;
    image.y = this.next.y;
    image.w = this.next.w;
    image.h = this.next.h;
    if (this.next.crop) image.crop = { ...this.next.crop };
    else delete image.crop;
  }

  invert(doc: InkDocument): void {
    const previous = this.previous;
    if (!previous || !pageById(doc, this.pageId)) return;
    restore(previous.image, previous.saved);
    this.previous = null;
  }
}
