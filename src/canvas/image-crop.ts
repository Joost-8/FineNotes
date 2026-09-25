/**
 * Cropping a placed picture (0.5): what part of the source a crop shows, the
 * whole picture a cropped element was cut from, and how a crop frame's
 * handles move. Pure — no DOM, no canvas, no Obsidian.
 *
 * A crop never touches the file. `ImageElement.crop` names the part of the
 * source that shows, in fractions of its natural width and height; the
 * element's own box (`x, y, w, h`, rotated about its centre) is **that
 * visible part**, so hit-testing, the selection frame, the lasso and the
 * tiles all go on using the element's box and need no special case. What
 * changes is only the source rectangle the painter draws from.
 *
 * The **whole picture** is therefore implied: `w / crop.w` wide, `h / crop.h`
 * tall, placed so that its crop rectangle sits exactly on the element's box,
 * turned by the same rotation about the same frame. Cropping again, or
 * resetting, works on that whole picture and derives the new visible box from
 * it — which is why the part that stays visible never moves on the page, at
 * any rotation.
 */

import type { ImageCrop } from "../model/document";
import type { ImageTransform } from "../model/commands";
import {
  type ImagePart,
  MIN_IMAGE_SIDE,
  type Pt,
  fromImageLocal,
  imageCentre,
  rotationOf,
  toImageLocal,
  withRotation,
} from "./image-geometry";

/** The whole picture: what an absent crop means. */
export const FULL_CROP: Readonly<ImageCrop> = { x: 0, y: 0, w: 1, h: 1 };

/**
 * Smallest crop side, as a fraction of the picture — the loader's own floor
 * (serialize.ts drops anything thinner), so a crop made here always reloads.
 */
export const MIN_CROP_FRACTION = 0.01;

/** Fractions this close to an edge count as on it. */
const EPS = 1e-9;

/** An element that may carry a crop. */
export type CroppableBox = ImageTransform & { crop?: ImageCrop };

/**
 * The crop an element shows: its own when it is a real sub-rectangle of the
 * picture, else the whole picture. Mirrors the loader's rules, so a crop
 * that could not have been loaded is never drawn either.
 */
export function cropOf(image: { crop?: ImageCrop }): ImageCrop {
  const c = image.crop;
  if (!c) return { ...FULL_CROP };
  const values = [c.x, c.y, c.w, c.h];
  if (!values.every((v) => typeof v === "number" && Number.isFinite(v))) return { ...FULL_CROP };
  if (c.x < 0 || c.y < 0 || c.w < MIN_CROP_FRACTION || c.h < MIN_CROP_FRACTION) {
    return { ...FULL_CROP };
  }
  if (c.x + c.w > 1 + EPS || c.y + c.h > 1 + EPS) return { ...FULL_CROP };
  return { x: c.x, y: c.y, w: Math.min(c.w, 1 - c.x), h: Math.min(c.h, 1 - c.y) };
}

/** Whether a crop shows the whole picture — which is stored as no crop at all. */
export function isFullCrop(crop: ImageCrop): boolean {
  return crop.x <= EPS && crop.y <= EPS && crop.x + crop.w >= 1 - EPS && crop.y + crop.h >= 1 - EPS;
}

/** Whether two crops are the same rectangle, to within `eps`. */
export function sameCrop(a: ImageCrop, b: ImageCrop, eps = 1e-6): boolean {
  return (
    Math.abs(a.x - b.x) <= eps &&
    Math.abs(a.y - b.y) <= eps &&
    Math.abs(a.w - b.w) <= eps &&
    Math.abs(a.h - b.h) <= eps
  );
}

/**
 * Tidy a crop so the loader keeps it exactly as made: its corner inside the
 * picture, each side at least {@link MIN_CROP_FRACTION}, and `x + w` never
 * past 1 — not even by a rounding error, or the loader would drop it and the
 * picture would reload uncropped. The corner is kept; a side too long for
 * the room left is shortened.
 */
export function clampCrop(crop: ImageCrop): ImageCrop {
  const fin = (v: number, fallback: number): number => (Number.isFinite(v) ? v : fallback);
  const x = clamp(fin(crop.x, 0), 0, 1 - MIN_CROP_FRACTION);
  const y = clamp(fin(crop.y, 0), 0, 1 - MIN_CROP_FRACTION);
  const w = clamp(fin(crop.w, 1), MIN_CROP_FRACTION, 1 - x);
  const h = clamp(fin(crop.h, 1), MIN_CROP_FRACTION, 1 - y);
  return { x, y, w, h };
}

/**
 * The part of a decoded bitmap `width × height` that a crop shows, for
 * `drawImage`'s source rectangle. Kept inside the bitmap: older WebKit draws
 * nothing at all for a source rectangle that reaches past the image.
 */
export function cropSourceRect(
  crop: ImageCrop,
  width: number,
  height: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const c = cropOf({ crop });
  const W = Math.max(0, width);
  const H = Math.max(0, height);
  const sx = clamp(c.x * W, 0, W);
  const sy = clamp(c.y * H, 0, H);
  return { sx, sy, sw: clamp(c.w * W, 0, W - sx), sh: clamp(c.h * H, 0, H - sy) };
}

/**
 * The whole picture an element was cut from, as a box in page space: its
 * crop undone, same rotation. For an uncropped element, its own box.
 */
export function uncroppedBox(image: CroppableBox): ImageTransform {
  const crop = cropOf(image);
  const angle = rotationOf(image);
  if (isFullCrop(crop)) return withRotation(image, angle);
  const W = image.w / crop.w;
  const H = image.h / crop.h;
  // Where the visible part's centre sits in the whole picture's own frame.
  const ox = (crop.x + crop.w / 2 - 0.5) * W;
  const oy = (crop.y + crop.h / 2 - 0.5) * H;
  const c = imageCentre(image);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const fx = c.x - (ox * cos - oy * sin);
  const fy = c.y - (ox * sin + oy * cos);
  return withRotation({ x: fx - W / 2, y: fy - H / 2, w: W, h: H }, angle);
}

/** The visible box a crop of the whole picture `full` leaves, in page space. */
export function croppedBox(full: ImageTransform, crop: ImageCrop): ImageTransform {
  const c = cropOf({ crop });
  const w = full.w * c.w;
  const h = full.h * c.h;
  const centre = fromImageLocal(full, {
    x: (c.x + c.w / 2 - 0.5) * full.w,
    y: (c.y + c.h / 2 - 0.5) * full.h,
  });
  return withRotation({ x: centre.x - w / 2, y: centre.y - h / 2, w, h }, rotationOf(full));
}

/** An element's geometry and crop after a (re)crop; `crop` absent for the whole picture. */
export interface CropResult {
  x: number;
  y: number;
  w: number;
  h: number;
  crop?: ImageCrop;
}

/**
 * What cropping `image` to `crop` (fractions of the *whole* picture) makes
 * of it: the visible box, and the crop to store — none when the crop is the
 * whole picture, so a reset leaves no key behind. The part that stays
 * visible does not move on the page; the rotation is untouched.
 */
export function cropResult(image: CroppableBox, crop: ImageCrop): CropResult {
  const full = uncroppedBox(image);
  const clean = clampCrop(crop);
  const whole = isFullCrop(clean);
  const box = whole ? full : croppedBox(full, clean);
  const out: CropResult = { x: box.x, y: box.y, w: box.w, h: box.h };
  if (!whole) out.crop = clean;
  return out;
}

/**
 * The smallest crop, as fractions of the whole picture `full`, that still
 * leaves `minSide` page px visible each way (never under the loader's floor,
 * never over the whole picture).
 */
export function minCropFractions(
  full: { w: number; h: number },
  minSide = MIN_IMAGE_SIDE,
): { u: number; v: number } {
  const of = (side: number): number =>
    side > 0 ? clamp(Math.max(0, minSide) / side, MIN_CROP_FRACTION, 1) : 1;
  return { u: of(full.w), v: of(full.h) };
}

/** A page point in the whole picture's frame, as fractions across it (0..1 inside). */
export function pictureFraction(full: ImageTransform, p: Pt): { u: number; v: number } {
  const local = toImageLocal(full, p);
  return {
    u: full.w > 0 ? local.x / full.w + 0.5 : 0.5,
    v: full.h > 0 ? local.y / full.h + 0.5 : 0.5,
  };
}

/**
 * Move a crop frame's handle — a corner or an edge — or, for `body`, the
 * whole frame, by (du, dv) fractions of the picture. Each moved side stops at
 * the picture's edge and `min` short of its opposite side; a moved frame
 * slides until it meets the picture's edge, keeping its size. Anything else
 * (`rotate`) changes nothing.
 */
export function dragCrop(
  start: ImageCrop,
  part: ImagePart,
  du: number,
  dv: number,
  min: { u: number; v: number },
): ImageCrop {
  const s = cropOf({ crop: start });
  const u = Number.isFinite(du) ? du : 0;
  const v = Number.isFinite(dv) ? dv : 0;
  if (part === "rotate" || (u === 0 && v === 0)) return s;
  if (part === "body") {
    const x = clamp(s.x + u, 0, 1 - s.w);
    const y = clamp(s.y + v, 0, 1 - s.h);
    return clampCrop({ x, y, w: s.w, h: s.h });
  }
  const side = (
    lo: number,
    size: number,
    d: number,
    movesLo: boolean,
    movesHi: boolean,
    m: number,
  ): [number, number] => {
    const hi = lo + size;
    const nlo = movesLo ? clamp(lo + d, 0, Math.max(0, hi - m)) : lo;
    const nhi = movesHi ? clamp(hi + d, Math.min(1, nlo + m), 1) : hi;
    // A side that did not move keeps its exact length: `hi - lo` is not
    // always `size` again in floating point.
    return nlo === lo && nhi === hi ? [lo, size] : [nlo, nhi - nlo];
  };
  const mu = clamp(min.u, MIN_CROP_FRACTION, 1);
  const mv = clamp(min.v, MIN_CROP_FRACTION, 1);
  const [x, w] = side(s.x, s.w, u, part.includes("w"), part.includes("e"), mu);
  const [y, h] = side(s.y, s.h, v, part.includes("n"), part.includes("s"), mv);
  return clampCrop({ x, y, w, h });
}

/**
 * The long side, in page px, of the whole picture as an element draws it:
 * what a decode must cover so the cropped part is as sharp as an uncropped
 * picture of the same size would be.
 */
export function pictureLongSide(image: { w: number; h: number; crop?: ImageCrop }): number {
  const crop = cropOf(image);
  return Math.max(image.w / crop.w, image.h / crop.h);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
