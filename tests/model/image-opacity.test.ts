/**
 * A see-through picture: `ImageElement.opacity`, how it is read and saved,
 * the command that sets it, and how it is painted.
 */

import { describe, expect, it } from "vitest";
import { drawPlacedImage } from "../../src/canvas/renderer";
import {
  type ImageElement,
  MIN_IMAGE_OPACITY,
  blankPage,
  emptyDocument,
  readImageOpacity,
} from "../../src/model/document";
import { IMAGE_OPACITIES, SetImageOpacity } from "../../src/model/image-commands";
import { decodeDocument, encodeDocument } from "../../src/model/serialize";

const picture = (extra: Partial<ImageElement> = {}): ImageElement => ({
  id: "i1",
  path: "pic.png",
  x: 10,
  y: 10,
  w: 100,
  h: 80,
  ...extra,
});

describe("readImageOpacity", () => {
  it("keeps a real opacity below 1, and nothing else", () => {
    expect(readImageOpacity(0.5)).toBe(0.5);
    expect(readImageOpacity(MIN_IMAGE_OPACITY)).toBe(MIN_IMAGE_OPACITY);
    expect(readImageOpacity(1)).toBeUndefined();
    expect(readImageOpacity(1.5)).toBeUndefined();
    expect(readImageOpacity(0.01)).toBeUndefined();
    expect(readImageOpacity(Number.NaN)).toBeUndefined();
    expect(readImageOpacity("0.5")).toBeUndefined();
  });

  it("offers opaque first, and only opacities it keeps", () => {
    expect(IMAGE_OPACITIES[0]).toBe(1);
    for (const o of IMAGE_OPACITIES.slice(1)) expect(readImageOpacity(o)).toBe(o);
  });
});

describe("a see-through picture saved and loaded", () => {
  it("keeps its opacity, and an opaque one stays without the key", () => {
    const doc = emptyDocument();
    doc.pages = [
      {
        ...blankPage("p1", { width: 400, height: 400 }),
        images: [picture({ opacity: 0.5 }), picture({ id: "i2" })],
      },
    ];
    const [half, full] = decodeDocument(encodeDocument(doc)).pages[0].images;
    expect(half.opacity).toBe(0.5);
    expect("opacity" in full).toBe(false);
  });
});

describe("SetImageOpacity", () => {
  it("sets it, deletes the key for opaque, and undo puts back exactly what was", () => {
    const image = picture();
    const doc = emptyDocument();
    doc.pages = [{ ...blankPage("p1", { width: 400, height: 400 }), images: [image] }];
    const before = JSON.stringify(image);
    const half = new SetImageOpacity("p1", image, 0.5);
    half.apply(doc);
    expect(image.opacity).toBe(0.5);
    const opaque = new SetImageOpacity("p1", image, 1);
    opaque.apply(doc);
    expect("opacity" in image).toBe(false);
    opaque.invert(doc);
    half.invert(doc);
    expect(JSON.stringify(image)).toBe(before);
  });
});

describe("painting a see-through picture", () => {
  it("draws it at its opacity, inside whatever alpha is already in force", () => {
    const alphas: number[] = [];
    let alpha = 0.8;
    const ctx = {
      save: () => undefined,
      restore: () => undefined,
      translate: () => undefined,
      rotate: () => undefined,
      scale: () => undefined,
      get globalAlpha() {
        return alpha;
      },
      set globalAlpha(v: number) {
        alpha = v;
      },
    } as unknown as CanvasRenderingContext2D;
    const painter = { paintImage: () => void alphas.push(alpha) };
    drawPlacedImage(ctx, picture({ opacity: 0.5 }), painter, 1);
    expect(alphas[0]).toBeCloseTo(0.4);
  });
});
