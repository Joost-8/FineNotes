/**
 * How the renderer hands placed images to an `ImagePainter`: in page space,
 * turned about their centre, above the backdrop. The renderer needs no
 * Obsidian import, so the free functions load under Node; a recording
 * context stands in for canvas.
 */

import { describe, expect, it } from "vitest";
import { type ImagePainter, drawPlacedImage, renderPageThumbnail } from "../../src/canvas/renderer";
import { type ImageElement, blankPage } from "../../src/model/document";

type Call = [string, ...unknown[]];

/** A 2D context that records every method call, in order. */
function recorder(log: Call[]): CanvasRenderingContext2D {
  const state: Record<string | symbol, unknown> = {};
  return new Proxy(state, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return (...args: unknown[]) => void log.push([String(prop), ...args]);
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

function painterInto(log: Call[]): ImagePainter {
  return {
    paintImage: (_ctx, image, deviceScale) => void log.push(["paintImage", image.id, deviceScale]),
  };
}

const img = (extra: Partial<ImageElement> = {}): ImageElement => ({
  id: "i1",
  path: "a.png",
  x: 100,
  y: 200,
  w: 300,
  h: 100,
  ...extra,
});

describe("drawPlacedImage", () => {
  it("moves to the image's centre, turns, and hands over its unrotated box", () => {
    const log: Call[] = [];
    drawPlacedImage(recorder(log), img({ rotation: 0.5 }), painterInto(log), 2);
    expect(log).toEqual([
      ["save"],
      ["translate", 250, 250],
      ["rotate", 0.5],
      ["translate", -150, -50],
      ["paintImage", "i1", 2],
      ["restore"],
    ]);
  });

  it("does not rotate an unrotated image", () => {
    const log: Call[] = [];
    drawPlacedImage(recorder(log), img(), painterInto(log), 1);
    expect(log.some(([name]) => name === "rotate")).toBe(false);
    expect(log.filter(([name]) => name === "paintImage")).toHaveLength(1);
  });

  it("skips an image with no area", () => {
    const log: Call[] = [];
    drawPlacedImage(recorder(log), img({ w: 0 }), painterInto(log), 1);
    expect(log).toEqual([]);
  });
});

describe("renderPageThumbnail", () => {
  it("paints images over the backdrop, at the thumbnail's scale", () => {
    const log: Call[] = [];
    const ctx = recorder(log);
    const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
    const page = { ...blankPage("p1"), images: [img(), img({ id: "i2" })] };
    const backdrop = { paint: () => void log.push(["backdrop"]) };
    renderPageThumbnail(canvas, page, backdrop, 128, 2, {
      usePressure: false,
      images: painterInto(log),
    });
    const order = log
      .map(([name, ...args]) => (name === "paintImage" ? `${name}:${String(args[0])}` : name))
      .filter((name) => name === "backdrop" || name.startsWith("paintImage"));
    expect(order).toEqual(["backdrop", "paintImage:i1", "paintImage:i2"]);
    const scale = log.find(([name]) => name === "paintImage")?.[2];
    expect(scale).toBeCloseTo((128 / page.geometry.width) * 2);
  });

  it("leaves images out without a painter", () => {
    const log: Call[] = [];
    const ctx = recorder(log);
    const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
    const page = { ...blankPage("p1"), images: [img()] };
    renderPageThumbnail(canvas, page, { paint: () => undefined }, 128, 1, { usePressure: false });
    expect(log.some(([name]) => name === "translate")).toBe(false);
  });
});
