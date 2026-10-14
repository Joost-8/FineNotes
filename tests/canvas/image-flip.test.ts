/**
 * Flipped pictures in the crop maths (`src/canvas/image-crop.ts`), the knob
 * that turns a lasso selection (`sweptTurn`, `src/canvas/lasso.ts`), and
 * where a source pixel lands on the page for a cropped, flipped and turned
 * picture: a recrop must never move what stays visible.
 */

import { describe, expect, it } from "vitest";
import {
  FULL_CROP,
  cropResult,
  mirrorCrop,
  shownCrop,
  uncroppedBox,
} from "../../src/canvas/image-crop";
import { fromImageLocal, sweptTurn } from "../../src/canvas/image-geometry";
import { boundsCentre, hitSelectionKnob, selectionKnobPoint } from "../../src/canvas/lasso";
import { cropOf } from "../../src/canvas/image-crop";
import type { ImageCrop, ImageElement } from "../../src/model/document";

const DEG = Math.PI / 180;

/**
 * Where source fraction (u, v) of the file is drawn on the page, the way
 * `drawPlacedImage` and the painter draw it: the crop stretched over the
 * box, mirrored in the box's own frame, turned about its centre.
 */
function sourceToPage(image: ImageElement, u: number, v: number): { x: number; y: number } {
  const c = cropOf(image);
  let lx = ((u - c.x) / c.w - 0.5) * image.w;
  let ly = ((v - c.y) / c.h - 0.5) * image.h;
  if (image.flipX) lx = -lx;
  if (image.flipY) ly = -ly;
  return fromImageLocal(image, { x: lx, y: ly });
}

function picture(extra: Partial<ImageElement> = {}): ImageElement {
  return { id: "i1", path: "a.png", x: 0, y: 0, w: 50, h: 100, ...extra };
}

describe("mirrorCrop and shownCrop", () => {
  it("mirror a crop inside the picture, and undo themselves", () => {
    const crop: ImageCrop = { x: 0.1, y: 0.2, w: 0.3, h: 0.5 };
    const m = mirrorCrop(crop, true, true);
    expect(m.x).toBeCloseTo(0.6, 12);
    expect(m.y).toBeCloseTo(0.3, 12);
    expect([m.w, m.h]).toEqual([0.3, 0.5]);
    const back = mirrorCrop(m, true, true);
    expect(back.x).toBeCloseTo(0.1, 12);
    expect(back.y).toBeCloseTo(0.2, 12);
    expect(mirrorCrop(crop, false, false)).toEqual(crop);
  });

  it("an unflipped picture shows its own crop; a flipped one the mirrored crop", () => {
    const crop: ImageCrop = { x: 0, y: 0, w: 0.5, h: 1 };
    expect(shownCrop({ crop })).toEqual(crop);
    expect(shownCrop({ crop, flipX: true })).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 });
    expect(shownCrop({ flipY: true })).toEqual(FULL_CROP);
  });
});

describe("cropping a flipped picture", () => {
  it("places the whole picture so the shown part sits on the box, mirrored", () => {
    // The left half of the file, mirrored: as drawn, the whole picture
    // shows that half on its right, so it reaches out to the left.
    const image = picture({ crop: { x: 0, y: 0, w: 0.5, h: 1 }, flipX: true });
    const full = uncroppedBox(image);
    expect(full.x).toBeCloseTo(-50, 9);
    expect(full.w).toBeCloseTo(100, 9);
    expect([full.y, full.h]).toEqual([0, 100]);
  });

  it("stores the crop in fractions of the file, and a reset stores none", () => {
    const image = picture({ crop: { x: 0, y: 0, w: 0.5, h: 1 }, flipX: true });
    const same = cropResult(image, shownCrop(image));
    expect(same.crop?.x).toBeCloseTo(0, 9);
    expect(same.crop?.w).toBeCloseTo(0.5, 9);
    expect(same.x).toBeCloseTo(0, 9);
    const whole = cropResult(image, FULL_CROP);
    expect(whole.crop).toBeUndefined();
    expect(whole.x).toBeCloseTo(-50, 9);
  });

  it("never moves what stays visible, flipped either way, at any turn", () => {
    const crops: ImageCrop[] = [
      { x: 0.2, y: 0.25, w: 0.5, h: 0.5 },
      { x: 0.3, y: 0.3, w: 0.2, h: 0.6 },
      { x: 0, y: 0, w: 1, h: 1 },
    ];
    for (const flips of [
      { flipX: true as const },
      { flipY: true as const },
      { flipX: true as const, flipY: true as const },
    ]) {
      for (const rotation of [0, 30 * DEG, -110 * DEG]) {
        const image = picture({
          x: 40,
          y: 70,
          crop: { x: 0.1, y: 0.2, w: 0.6, h: 0.7 },
          rotation,
          ...flips,
        });
        // A point of the file inside every crop below.
        const at = sourceToPage(image, 0.4, 0.5);
        for (const next of crops) {
          const result = cropResult(image, next);
          const recropped: ImageElement = { ...image, ...result };
          if (!result.crop) delete recropped.crop;
          const moved = sourceToPage(recropped, 0.4, 0.5);
          expect(moved.x).toBeCloseTo(at.x, 6);
          expect(moved.y).toBeCloseTo(at.y, 6);
        }
      }
    }
  });

  it("a crop chosen on the drawn picture keeps the side the user saw", () => {
    // Flipped left to right: keeping the left half as drawn keeps the
    // right half of the file.
    const image = picture({ w: 100, flipX: true });
    const result = cropResult(image, { x: 0, y: 0, w: 0.5, h: 1 });
    expect(result.crop?.x).toBeCloseTo(0.5, 9);
    expect(result.x).toBeCloseTo(0, 9);
    expect(result.w).toBeCloseTo(50, 9);
  });
});

describe("sweptTurn", () => {
  const c = { x: 0, y: 0 };

  it("is the angle swept about the centre, clockwise with y down", () => {
    expect(sweptTurn(c, { x: 10, y: 0 }, { x: 10, y: 10 })).toBeCloseTo(Math.PI / 4, 9);
    expect(sweptTurn(c, { x: 0, y: 10 }, { x: 10, y: 10 })).toBeCloseTo(-Math.PI / 4, 9);
  });

  it("snaps onto quarter turns within 4 degrees, and is zero on the centre", () => {
    const near = { x: Math.cos(93 * DEG) * 10, y: Math.sin(93 * DEG) * 10 };
    expect(sweptTurn(c, { x: 10, y: 0 }, near)).toBeCloseTo(Math.PI / 2, 9);
    const far = { x: Math.cos(80 * DEG) * 10, y: Math.sin(80 * DEG) * 10 };
    expect(sweptTurn(c, { x: 10, y: 0 }, far)).toBeCloseTo(80 * DEG, 9);
    expect(sweptTurn(c, { x: 3, y: 0 }, { x: 0, y: 0 })).toBe(0);
    expect(sweptTurn(c, c, { x: 3, y: 0 })).toBe(0);
  });

  it("stays within a half turn either way across the -π / π seam", () => {
    const a = sweptTurn(c, { x: -10, y: 1 }, { x: -10, y: -1 });
    expect(Math.abs(a)).toBeLessThan(0.3);
  });
});

describe("the selection's rotate knob", () => {
  const frame = { minX: 0, minY: 0, maxX: 100, maxY: 60 };

  it("hangs below the middle of the frame's bottom edge", () => {
    expect(selectionKnobPoint(frame, 44)).toEqual({ x: 50, y: 104 });
    expect(boundsCentre(frame)).toEqual({ x: 50, y: 30 });
  });

  it("answers across its radius and nowhere else", () => {
    expect(hitSelectionKnob(frame, { x: 50, y: 104 }, 44, 22)).toBe(true);
    expect(hitSelectionKnob(frame, { x: 65, y: 118 }, 44, 22)).toBe(true);
    expect(hitSelectionKnob(frame, { x: 50, y: 60 }, 44, 22)).toBe(false);
    expect(hitSelectionKnob(frame, { x: 100, y: 104 }, 44, 22)).toBe(false);
  });
});
