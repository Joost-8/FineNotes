/**
 * `src/canvas/image-crop.ts` — cropping a placed picture without moving the
 * part that stays visible, at any rotation, and crops the loader keeps.
 */

import { describe, expect, it } from "vitest";
import {
  FULL_CROP,
  MIN_CROP_FRACTION,
  clampCrop,
  cropOf,
  cropResult,
  cropSourceRect,
  croppedBox,
  dragCrop,
  isFullCrop,
  minCropFractions,
  pictureFraction,
  pictureLongSide,
  sameCrop,
  uncroppedBox,
} from "../../src/canvas/image-crop";
import { MIN_IMAGE_SIDE, fromImageLocal, imageCorners } from "../../src/canvas/image-geometry";
import type { ImageTransform } from "../../src/model/commands";
import type { ImageCrop } from "../../src/model/document";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";
import { emptyDocument } from "../../src/model/document";

const DEG = Math.PI / 180;

function box(x: number, y: number, w: number, h: number, rotation?: number): ImageTransform {
  return rotation === undefined ? { x, y, w, h } : { x, y, w, h, rotation };
}

function closePts(a: Array<{ x: number; y: number }>, b: Array<{ x: number; y: number }>): void {
  expect(a).toHaveLength(b.length);
  a.forEach((p, i) => {
    expect(p.x).toBeCloseTo(b[i].x, 6);
    expect(p.y).toBeCloseTo(b[i].y, 6);
  });
}

/** The page point where a fraction (u, v) of the whole picture lands. */
function pictureAt(full: ImageTransform, u: number, v: number): { x: number; y: number } {
  return fromImageLocal(full, { x: (u - 0.5) * full.w, y: (v - 0.5) * full.h });
}

describe("cropOf and friends", () => {
  it("reads an absent or unloadable crop as the whole picture", () => {
    expect(cropOf({})).toEqual(FULL_CROP);
    expect(cropOf({ crop: { x: -0.1, y: 0, w: 0.5, h: 0.5 } })).toEqual(FULL_CROP);
    expect(cropOf({ crop: { x: 0.6, y: 0, w: 0.5, h: 0.5 } })).toEqual(FULL_CROP);
    expect(cropOf({ crop: { x: 0, y: 0, w: 0.001, h: 0.5 } })).toEqual(FULL_CROP);
    expect(cropOf({ crop: { x: Number.NaN, y: 0, w: 0.5, h: 0.5 } })).toEqual(FULL_CROP);
    expect(cropOf({ crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.5 } })).toEqual({
      x: 0.1,
      y: 0.2,
      w: 0.5,
      h: 0.5,
    });
  });

  it("knows the whole picture when it sees it", () => {
    expect(isFullCrop(FULL_CROP)).toBe(true);
    expect(isFullCrop({ x: 0, y: 0, w: 1 - 1e-12, h: 1 })).toBe(true);
    expect(isFullCrop({ x: 0.1, y: 0, w: 0.9, h: 1 })).toBe(false);
    expect(sameCrop({ x: 0.1, y: 0, w: 0.9, h: 1 }, { x: 0.1, y: 0, w: 0.9, h: 1 })).toBe(true);
    expect(sameCrop({ x: 0.1, y: 0, w: 0.9, h: 1 }, { x: 0.2, y: 0, w: 0.8, h: 1 })).toBe(false);
  });

  it("clamps a crop into one the loader keeps exactly", () => {
    // The corner stays; the side is shortened to the room left.
    const c = clampCrop({ x: 0.7, y: -0.2, w: 0.5, h: 2 });
    expect(c.x).toBe(0.7);
    expect(c.y).toBe(0);
    expect(c.w).toBeCloseTo(0.3);
    expect(c.h).toBe(1);
    const tiny = clampCrop({ x: 0.2, y: 0.2, w: 0, h: Number.NaN });
    expect(tiny.w).toBe(MIN_CROP_FRACTION);
    expect(tiny.h).toBeCloseTo(0.8);
    // Never past the right edge by a rounding error.
    const r = clampCrop({ x: 0.1, y: 0.7, w: 0.9, h: 0.3 });
    expect(r.x + r.w).toBeLessThanOrEqual(1);
    expect(r.y + r.h).toBeLessThanOrEqual(1);
  });
});

describe("cropSourceRect", () => {
  it("maps the crop onto the decoded bitmap, whatever its size", () => {
    const crop: ImageCrop = { x: 0.25, y: 0.5, w: 0.5, h: 0.25 };
    expect(cropSourceRect(crop, 1024, 768)).toEqual({ sx: 256, sy: 384, sw: 512, sh: 192 });
    expect(cropSourceRect(crop, 256, 192)).toEqual({ sx: 64, sy: 96, sw: 128, sh: 48 });
  });

  it("keeps the source rectangle inside the bitmap", () => {
    const r = cropSourceRect({ x: 0.5, y: 0, w: 0.5 + 1e-10, h: 1 }, 100, 50);
    expect(r.sx + r.sw).toBeLessThanOrEqual(100);
    expect(cropSourceRect(FULL_CROP, 0, 0)).toEqual({ sx: 0, sy: 0, sw: 0, sh: 0 });
  });
});

describe("uncropped and cropped boxes", () => {
  it("is the element's own box when there is no crop", () => {
    expect(uncroppedBox({ ...box(10, 20, 100, 50, 0.3), crop: undefined })).toEqual(
      box(10, 20, 100, 50, 0.3),
    );
  });

  it("recovers the whole picture from a cropped, unrotated element", () => {
    // A 400 x 200 picture at (100, 100); its right half, top half shown.
    const image = { ...box(300, 100, 200, 100), crop: { x: 0.5, y: 0, w: 0.5, h: 0.5 } };
    const full = uncroppedBox(image);
    expect(full.x).toBeCloseTo(100);
    expect(full.y).toBeCloseTo(100);
    expect(full.w).toBeCloseTo(400);
    expect(full.h).toBeCloseTo(200);
  });

  it("round-trips: the crop of the whole picture is the element, at any rotation", () => {
    for (const degrees of [0, 17, 90, 180, -135]) {
      const image = {
        ...box(120, 80, 150, 60, degrees === 0 ? undefined : degrees * DEG),
        crop: { x: 0.1, y: 0.3, w: 0.6, h: 0.5 },
      };
      const full = uncroppedBox(image);
      closePts(imageCorners(croppedBox(full, image.crop)), imageCorners(image));
    }
  });

  it("puts the crop rectangle of the whole picture exactly on the element", () => {
    const crop = { x: 0.2, y: 0.1, w: 0.5, h: 0.7 };
    const image = { ...box(50, 60, 100, 140, 33 * DEG), crop };
    const full = uncroppedBox(image);
    closePts(
      [
        pictureAt(full, crop.x, crop.y),
        pictureAt(full, crop.x + crop.w, crop.y),
        pictureAt(full, crop.x + crop.w, crop.y + crop.h),
        pictureAt(full, crop.x, crop.y + crop.h),
      ],
      imageCorners(image),
    );
  });
});

describe("cropResult", () => {
  it("keeps what stays visible exactly where it was, rotated or not", () => {
    for (const degrees of [0, 25, 90, -70, 180]) {
      const rotation = degrees === 0 ? undefined : degrees * DEG;
      const image = box(200, 150, 300, 200, rotation);
      const full = uncroppedBox(image);
      const crop = { x: 0.25, y: 0.1, w: 0.5, h: 0.6 };
      const result = cropResult(image, crop);
      expect(result.crop).toEqual(crop);
      // The new box's corners are the picture points at the crop's corners.
      closePts(imageCorners({ ...result, rotation }), [
        pictureAt(full, 0.25, 0.1),
        pictureAt(full, 0.75, 0.1),
        pictureAt(full, 0.75, 0.7),
        pictureAt(full, 0.25, 0.7),
      ]);
    }
  });

  it("re-crops from the whole picture, not from the part shown", () => {
    const image = { ...box(0, 0, 100, 100), crop: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 } };
    // Widen back out to the right half of the picture.
    const result = cropResult(image, { x: 0.5, y: 0, w: 0.5, h: 1 });
    expect(result).toEqual({ x: 0, y: -100, w: 100, h: 200, crop: { x: 0.5, y: 0, w: 0.5, h: 1 } });
  });

  it("drops the key for the whole picture: a reset restores the original box", () => {
    const original = box(40, 40, 400, 300, 12 * DEG);
    const cropped = {
      ...cropResult(original, { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }),
      rotation: 12 * DEG,
    };
    const reset = cropResult(cropped, FULL_CROP);
    expect("crop" in reset).toBe(false);
    expect(reset.x).toBeCloseTo(40);
    expect(reset.y).toBeCloseTo(40);
    expect(reset.w).toBeCloseTo(400);
    expect(reset.h).toBeCloseTo(300);
  });

  it("makes crops that survive a save and a reload unchanged", () => {
    const doc = emptyDocument();
    const cropped = cropResult(box(10, 10, 300, 300), { x: 0.1, y: 0.7, w: 0.9, h: 0.3 });
    doc.pages[0].images.push({ id: "i1", path: "a.png", ...cropped });
    const back = decodeDocument(encodeDocument(doc));
    expect(back.pages[0].images[0].crop).toEqual(cropped.crop);
  });
});

describe("dragging the crop frame", () => {
  const start: ImageCrop = { x: 0.2, y: 0.2, w: 0.6, h: 0.6 };
  const min = { u: 0.1, v: 0.1 };

  it("moves the sides a handle names, and only those", () => {
    const nw = dragCrop(start, "nw", -0.1, 0.05, min);
    expect(nw.x).toBeCloseTo(0.1);
    expect(nw.y).toBeCloseTo(0.25);
    expect(nw.x + nw.w).toBeCloseTo(0.8);
    expect(nw.y + nw.h).toBeCloseTo(0.8);
    const e = dragCrop(start, "e", 0.1, 0.3, min);
    expect(e).toEqual({ x: 0.2, y: 0.2, w: expect.closeTo(0.7, 9) as number, h: 0.6 });
    const s = dragCrop(start, "s", 0.3, -0.2, min);
    expect(s.h).toBeCloseTo(0.4);
    expect(s.x).toBe(0.2);
  });

  it("stops each side at the picture's edge and short of the opposite side", () => {
    const out = dragCrop(start, "se", 5, 5, min);
    expect(out).toEqual({ x: 0.2, y: 0.2, w: expect.closeTo(0.8, 9) as number, h: 0.8 });
    const crossed = dragCrop(start, "w", 5, 0, min);
    expect(crossed.w).toBeCloseTo(0.1);
    expect(crossed.x + crossed.w).toBeCloseTo(0.8);
    const tooFar = dragCrop(start, "n", 0, -5, min);
    expect(tooFar.y).toBe(0);
  });

  it("slides the whole frame, keeping its size, until it meets the edge", () => {
    const moved = dragCrop(start, "body", 0.1, -0.5, min);
    expect(moved.x).toBeCloseTo(0.3);
    expect(moved.y).toBe(0);
    expect(moved.w).toBeCloseTo(0.6);
    expect(moved.h).toBeCloseTo(0.6);
  });

  it("ignores the knob and non-finite moves", () => {
    expect(dragCrop(start, "rotate", 0.3, 0.3, min)).toEqual(start);
    expect(dragCrop(start, "e", Number.NaN, 0, min)).toEqual(start);
  });

  it("keeps a minimum frame that is at least the loader's floor", () => {
    expect(minCropFractions({ w: 480, h: 240 })).toEqual({
      u: MIN_IMAGE_SIDE / 480,
      v: MIN_IMAGE_SIDE / 240,
    });
    expect(minCropFractions({ w: 1e6, h: 10 })).toEqual({ u: MIN_CROP_FRACTION, v: 1 });
    expect(minCropFractions({ w: 0, h: 100 }).u).toBe(1);
  });

  it("reads page points as fractions of the whole picture", () => {
    const full = box(100, 100, 200, 100, 90 * DEG);
    const f = pictureFraction(full, pictureAt(full, 0.25, 0.75));
    expect(f.u).toBeCloseTo(0.25);
    expect(f.v).toBeCloseTo(0.75);
    expect(pictureFraction(box(0, 0, 0, 0), { x: 5, y: 5 })).toEqual({ u: 0.5, v: 0.5 });
  });
});

describe("pictureLongSide", () => {
  it("is the whole picture's long side as drawn", () => {
    expect(pictureLongSide({ w: 100, h: 50 })).toBe(100);
    expect(pictureLongSide({ w: 100, h: 50, crop: { x: 0, y: 0, w: 0.25, h: 1 } })).toBe(400);
  });
});
