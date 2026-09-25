import { describe, expect, it } from "vitest";
import {
  type ImageCorner,
  type ImageEdge,
  EDGE_HANDLE_ROOM,
  HANDLE_HIT_RADIUS_PX,
  IMAGE_CORNERS,
  IMAGE_EDGES,
  MIN_IMAGE_SIDE,
  ROTATE_HANDLE_OFFSET_PX,
  dragImageHandle,
  edgeHandlesFit,
  fromImageLocal,
  handleSigns,
  imageHandlePoint,
  isCorner,
  offeredHandles,
  stretchImage,
  hitImagePart,
  imageBounds,
  imageCentre,
  imageCorner,
  imageCorners,
  moveImage,
  normalizeAngle,
  pointInImage,
  resizeImage,
  rotateHandlePoint,
  rotateImage,
  rotationOf,
  sameTransform,
  snapAngle,
  toImageLocal,
  topImageAt,
  transformOf,
  withRotation,
} from "../../src/canvas/image-geometry";
import type { ImageTransform } from "../../src/model/commands";

const DEG = Math.PI / 180;

function box(x: number, y: number, w: number, h: number, rotation?: number): ImageTransform {
  return rotation === undefined ? { x, y, w, h } : { x, y, w, h, rotation };
}

function close(a: { x: number; y: number }, b: { x: number; y: number }, digits = 6): void {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
}

describe("angles", () => {
  it("reads an absent or non-finite rotation as none", () => {
    expect(rotationOf(box(0, 0, 10, 10))).toBe(0);
    expect(rotationOf(box(0, 0, 10, 10, Number.NaN))).toBe(0);
    expect(rotationOf(box(0, 0, 10, 10, 0.5))).toBe(0.5);
  });

  it("wraps into (-π, π]", () => {
    expect(normalizeAngle((3 * Math.PI) / 2)).toBeCloseTo(-Math.PI / 2);
    expect(normalizeAngle(-Math.PI)).toBeCloseTo(Math.PI);
    expect(normalizeAngle(Math.PI)).toBeCloseTo(Math.PI);
    expect(normalizeAngle(4 * Math.PI + 0.25)).toBeCloseTo(0.25);
    expect(normalizeAngle(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("snaps onto a quarter turn only within the tolerance", () => {
    expect(snapAngle(88 * DEG)).toBeCloseTo(Math.PI / 2);
    expect(snapAngle(-2 * DEG)).toBeCloseTo(0);
    expect(snapAngle(80 * DEG)).toBeCloseTo(80 * DEG);
    expect(snapAngle(182 * DEG)).toBeCloseTo(Math.PI);
    expect(snapAngle(10 * DEG, 12)).toBeCloseTo(0);
  });

  it("keeps 'no rotation' absent rather than 0", () => {
    expect(withRotation(box(1, 2, 3, 4), 0)).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect("rotation" in withRotation(box(1, 2, 3, 4), 2 * Math.PI)).toBe(false);
    expect(withRotation(box(1, 2, 3, 4), 2 * Math.PI + 0.1).rotation).toBeCloseTo(0.1);
  });

  it("transformOf drops everything but the geometry", () => {
    const image = { id: "i1", path: "a.png", x: 1, y: 2, w: 3, h: 4, rotation: 0 };
    expect(transformOf(image)).toEqual({ x: 1, y: 2, w: 3, h: 4 });
  });

  it("compares boxes to a tolerance, angles modulo a turn", () => {
    expect(sameTransform(box(0, 0, 10, 10), box(0, 0, 10, 10, 2 * Math.PI))).toBe(true);
    expect(sameTransform(box(0, 0, 10, 10), box(0, 0, 10, 10, 0.01))).toBe(false);
    expect(sameTransform(box(0, 0, 10, 10), box(0.1, 0, 10, 10))).toBe(false);
    expect(sameTransform(box(0, 0, 10, 10), box(0, 0, 10, 10.5))).toBe(false);
  });
});

describe("the rotated rectangle", () => {
  it("round-trips a point through the image's own frame", () => {
    const b = box(30, 40, 120, 60, 0.7);
    const p = { x: 55, y: 99 };
    close(fromImageLocal(b, toImageLocal(b, p)), p);
    close(toImageLocal(b, imageCentre(b)), { x: 0, y: 0 });
  });

  it("puts the unrotated corners on the box", () => {
    const b = box(10, 20, 100, 50);
    expect(imageCorners(b)).toEqual([
      { x: 10, y: 20 },
      { x: 110, y: 20 },
      { x: 110, y: 70 },
      { x: 10, y: 70 },
    ]);
  });

  it("turns clockwise with y down, like canvas and CSS", () => {
    // A quarter turn clockwise carries the top-left corner to the top-right.
    const b = box(0, 0, 100, 50, Math.PI / 2);
    close(imageCorner(b, "nw"), { x: 75, y: -25 });
    close(imageCorner(b, "se"), { x: 25, y: 75 });
  });

  it("bounds a rotated box by its corners", () => {
    const quarter = imageBounds(box(0, 0, 100, 50, Math.PI / 2));
    expect(quarter.minX).toBeCloseTo(25);
    expect(quarter.maxX).toBeCloseTo(75);
    expect(quarter.minY).toBeCloseTo(-25);
    expect(quarter.maxY).toBeCloseTo(75);
    const diamond = imageBounds(box(0, 0, 100, 100, Math.PI / 4));
    expect(diamond.maxX - diamond.minX).toBeCloseTo(100 * Math.SQRT2);
    expect(imageBounds(box(5, 6, 7, 8))).toEqual({ minX: 5, minY: 6, maxX: 12, maxY: 14 });
  });

  it("tests points against the rotated box, not its bounds", () => {
    const diamond = box(0, 0, 100, 100, Math.PI / 4);
    // Inside the axis-aligned bounds, outside the turned square.
    expect(pointInImage(diamond, { x: -15, y: -15 })).toBe(false);
    expect(pointInImage(diamond, { x: 50, y: -15 })).toBe(true);
    expect(pointInImage(diamond, { x: 50, y: 50 })).toBe(true);
    expect(pointInImage(box(0, 0, 10, 10), { x: 12, y: 5 })).toBe(false);
    expect(pointInImage(box(0, 0, 10, 10), { x: 12, y: 5 }, 3)).toBe(true);
  });

  it("finds the topmost image, the last one painted", () => {
    const under = { id: "a", ...box(0, 0, 100, 100) };
    const over = { id: "b", ...box(50, 50, 100, 100) };
    expect(topImageAt([under, over], { x: 75, y: 75 })?.id).toBe("b");
    expect(topImageAt([under, over], { x: 25, y: 25 })?.id).toBe("a");
    expect(topImageAt([under, over], { x: 400, y: 400 })).toBeNull();
    expect(topImageAt([under], { x: 103, y: 50 }, 4)?.id).toBe("a");
  });
});

describe("handles", () => {
  const b = box(100, 100, 200, 100);

  it("places the rotate knob below the bottom edge, turning with the image", () => {
    close(rotateHandlePoint(b, 36), { x: 200, y: 236 });
    // Turned a quarter clockwise, "below" points left.
    close(rotateHandlePoint(box(0, 0, 100, 50, Math.PI / 2), 36), { x: 50 - 25 - 36, y: 25 });
  });

  it("answers the rotate knob first", () => {
    expect(hitImagePart(b, { x: 205, y: 240 }, 22, 36)).toBe("rotate");
  });

  it("has no knob to answer when the offset is null (the crop frame)", () => {
    expect(hitImagePart(b, { x: 200, y: 236 }, 22, null)).toBeNull();
    expect(hitImagePart(b, { x: 200, y: 150 }, 22, null)).toBe("body");
  });

  it("keeps the knob target clear of the bottom edge handle at the default offset", () => {
    const r = HANDLE_HIT_RADIUS_PX;
    const knob = rotateHandlePoint(b, ROTATE_HANDLE_OFFSET_PX);
    const s = imageHandlePoint(b, "s");
    expect(Math.hypot(knob.x - s.x, knob.y - s.y)).toBeGreaterThanOrEqual(2 * r);
    // Just below the bottom edge's middle: the edge handle, not the knob.
    expect(hitImagePart(b, { x: 200, y: 215 }, r, ROTATE_HANDLE_OFFSET_PX)).toBe("s");
    expect(hitImagePart(b, { x: 200, y: 250 }, r, ROTATE_HANDLE_OFFSET_PX)).toBe("rotate");
  });

  it("answers a corner across its whole radius outside the image", () => {
    expect(hitImagePart(b, { x: 90, y: 92 }, 22, 36)).toBe("nw");
    expect(hitImagePart(b, { x: 312, y: 88 }, 22, 36)).toBe("ne");
    expect(hitImagePart(b, { x: 315, y: 210 }, 22, 36)).toBe("se");
    expect(hitImagePart(b, { x: 85, y: 212 }, 22, 36)).toBe("sw");
  });

  it("answers the body in the middle and nothing far away", () => {
    expect(hitImagePart(b, { x: 200, y: 150 }, 22, 36)).toBe("body");
    expect(hitImagePart(b, { x: 150, y: 110 }, 22, 36)).toBe("body");
    expect(hitImagePart(b, { x: 500, y: 500 }, 22, 36)).toBeNull();
  });

  it("keeps the middle of a small image grabbable", () => {
    const small = box(0, 0, 40, 40);
    // Near a corner, inside its outer quarter: the corner.
    expect(hitImagePart(small, { x: 8, y: 8 }, 22, 36)).toBe("nw");
    // Within reach of the corner but nearer the middle: the body.
    expect(hitImagePart(small, { x: 15, y: 15 }, 22, 36)).toBe("body");
    expect(hitImagePart(small, { x: 20, y: 20 }, 22, 36)).toBe("body");
  });

  it("hit-tests the handles of a rotated image where they are drawn", () => {
    const turned = box(0, 0, 100, 50, Math.PI / 2);
    const nw = imageCorner(turned, "nw");
    expect(hitImagePart(turned, { x: nw.x + 3, y: nw.y - 3 }, 22, 36)).toBe("nw");
    const knob = rotateHandlePoint(turned, 36);
    expect(hitImagePart(turned, knob, 22, 36)).toBe("rotate");
    expect(hitImagePart(turned, imageCentre(turned), 22, 36)).toBe("body");
  });

  it("answers the middle of each edge with its edge handle", () => {
    const big = box(0, 0, 300, 200);
    expect(hitImagePart(big, { x: 150, y: -5 }, 22, null)).toBe("n");
    expect(hitImagePart(big, { x: 305, y: 100 }, 22, null)).toBe("e");
    expect(hitImagePart(big, { x: 150, y: 210 }, 22, null)).toBe("s");
    expect(hitImagePart(big, { x: -12, y: 100 }, 22, null)).toBe("w");
    // Inside, an edge only claims the strip along it.
    expect(hitImagePart(big, { x: 150, y: 15 }, 22, null)).toBe("n");
    expect(hitImagePart(big, { x: 150, y: 30 }, 22, null)).toBe("body");
  });

  it("gives a press between a corner and an edge handle to the nearer one", () => {
    const tight = box(0, 0, 70, 70);
    expect(hitImagePart(tight, { x: 12, y: -2 }, 22, null)).toBe("nw");
    expect(hitImagePart(tight, { x: 30, y: -2 }, 22, null)).toBe("n");
  });

  it("offers edge handles only on edges long enough for them", () => {
    const r = 22;
    expect(edgeHandlesFit(box(0, 0, 3 * r, 3 * r - 1), r)).toEqual({ ns: true, ew: false });
    expect(EDGE_HANDLE_ROOM).toBe(3);
    const narrow = box(0, 0, 40, 200);
    expect(offeredHandles(narrow, r)).toEqual(["nw", "ne", "se", "sw", "e", "w"]);
    expect(offeredHandles(box(0, 0, 200, 200), r)).toEqual([
      "nw",
      "ne",
      "se",
      "sw",
      "n",
      "s",
      "e",
      "w",
    ]);
    // Where no edge handle is offered, its spot is the body (or a corner).
    expect(hitImagePart(narrow, { x: 20, y: 5 }, r, null)).not.toBe("n");
  });

  it("places each handle where it is drawn, on a rotated box too", () => {
    close(imageHandlePoint(b, "n"), { x: 200, y: 100 });
    close(imageHandlePoint(b, "e"), { x: 300, y: 150 });
    close(imageHandlePoint(b, "se"), imageCorner(b, "se"));
    const turned = box(0, 0, 100, 50, Math.PI / 2);
    // A quarter clockwise, the top edge faces right.
    close(imageHandlePoint(turned, "n"), { x: 75, y: 25 });
    expect(handleSigns("w")).toEqual([-1, 0]);
    expect(isCorner("ne")).toBe(true);
    expect(isCorner("e")).toBe(false);
  });
});

describe("stretch", () => {
  it("stretches in one direction only, the opposite edge staying put", () => {
    const start = box(100, 100, 200, 100);
    expect(stretchImage(start, "e", { x: 400, y: 170 })).toEqual(box(100, 100, 300, 100));
    expect(stretchImage(start, "w", { x: 50, y: 120 })).toEqual(box(50, 100, 250, 100));
    expect(stretchImage(start, "n", { x: 900, y: 40 })).toEqual(box(100, 40, 200, 160));
    expect(stretchImage(start, "s", { x: 0, y: 150 })).toEqual(box(100, 100, 200, 50));
  });

  it("keeps the opposite edge fixed at any rotation, for every edge", () => {
    const opposite: Record<ImageEdge, ImageEdge> = { n: "s", e: "w", s: "n", w: "e" };
    for (const degrees of [0, 30, 90, 135, -60, 180]) {
      const start = box(200, 300, 160, 90, degrees === 0 ? undefined : degrees * DEG);
      for (const edge of IMAGE_EDGES) {
        const anchor = imageHandlePoint(start, opposite[edge]);
        const grabbed = imageHandlePoint(start, edge);
        const pointer = {
          x: anchor.x + (grabbed.x - anchor.x) * 1.5,
          y: anchor.y + (grabbed.y - anchor.y) * 1.5,
        };
        const r = stretchImage(start, edge, pointer);
        close(imageHandlePoint(r, opposite[edge]), anchor, 5);
        close(imageHandlePoint(r, edge), pointer, 5);
        const [sx] = handleSigns(edge);
        expect(r.w).toBeCloseTo(sx !== 0 ? 240 : 160);
        expect(r.h).toBeCloseTo(sx !== 0 ? 90 : 135);
        expect(rotationOf(r)).toBeCloseTo(rotationOf(start));
      }
    }
  });

  it("ignores the pen straying along the edge", () => {
    const start = box(0, 0, 100, 50, 30 * DEG);
    const e = imageHandlePoint(start, "e");
    const along = { x: e.x - Math.sin(30 * DEG) * 40, y: e.y + Math.cos(30 * DEG) * 40 };
    const r = stretchImage(start, "e", along);
    expect(r.w).toBeCloseTo(100);
    expect(r.h).toBeCloseTo(50);
  });

  it("stops at the minimum size instead of flipping", () => {
    const r = stretchImage(box(0, 0, 100, 50), "e", { x: -300, y: 25 });
    expect(r.w).toBeCloseTo(MIN_IMAGE_SIDE);
    expect(r.x).toBeCloseTo(0);
    expect(r.h).toBe(50);
  });

  it("leaves a degenerate box alone", () => {
    expect(stretchImage(box(1, 2, 0, 5), "e", { x: 50, y: 50 })).toEqual(box(1, 2, 0, 5));
  });

  it("routes a corner to the aspect-keeping resize and an edge to the stretch", () => {
    const start = box(0, 0, 100, 50);
    expect(dragImageHandle(start, "se", { x: 200, y: 100 })).toEqual(
      resizeImage(start, "se", { x: 200, y: 100 }),
    );
    expect(dragImageHandle(start, "s", { x: 200, y: 100 })).toEqual(box(0, 0, 100, 100));
  });
});

describe("move", () => {
  it("translates, keeping the rotation", () => {
    expect(moveImage(box(10, 10, 50, 50, 0.3), 5, -5)).toEqual(box(15, 5, 50, 50, 0.3));
  });

  it("lets an image hang off the page, but not past its centre", () => {
    const page = { width: 1000, height: 1400 };
    const moved = moveImage(box(900, 100, 100, 100), 400, 0, page);
    expect(moved.x + moved.w / 2).toBe(1000);
    const up = moveImage(box(100, 20, 100, 100), 0, -500, page);
    expect(up.y + up.h / 2).toBe(0);
    expect(moveImage(box(100, 100, 100, 100), 50, 50, page)).toEqual(box(150, 150, 100, 100));
  });
});

describe("resize", () => {
  it("scales from the opposite corner, keeping the aspect", () => {
    expect(resizeImage(box(0, 0, 100, 50), "se", { x: 200, y: 100 })).toEqual(box(0, 0, 200, 100));
    const grown = resizeImage(box(0, 0, 100, 50), "nw", { x: -100, y: -50 });
    expect(grown.w).toBeCloseTo(200);
    expect(grown.h).toBeCloseTo(100);
    close(grown, { x: -100, y: -50 });
  });

  it("follows a pen that strays off the diagonal smoothly", () => {
    const r = resizeImage(box(0, 0, 100, 100), "se", { x: 200, y: 100 });
    expect(r.w).toBeCloseTo(150);
    expect(r.h).toBeCloseTo(150);
  });

  it("stops at the minimum size instead of flipping", () => {
    const r = resizeImage(box(0, 0, 100, 50), "se", { x: -80, y: -80 });
    expect(Math.min(r.w, r.h)).toBeCloseTo(MIN_IMAGE_SIDE);
    expect(r.w / r.h).toBeCloseTo(2);
    close(r, { x: 0, y: 0 });
  });

  it("keeps the opposite corner fixed at any rotation, for every corner", () => {
    const opposite: Record<ImageCorner, ImageCorner> = { nw: "se", ne: "sw", se: "nw", sw: "ne" };
    for (const degrees of [0, 30, 90, 135, -60, 180]) {
      const start = box(200, 300, 160, 90, degrees === 0 ? undefined : degrees * DEG);
      for (const corner of IMAGE_CORNERS) {
        const anchor = imageCorner(start, opposite[corner]);
        const dragged = imageCorner(start, corner);
        // Drag the corner 1.5x as far from its anchor, along the diagonal.
        const pointer = {
          x: anchor.x + (dragged.x - anchor.x) * 1.5,
          y: anchor.y + (dragged.y - anchor.y) * 1.5,
        };
        const r = resizeImage(start, corner, pointer);
        close(imageCorner(r, opposite[corner]), anchor, 5);
        close(imageCorner(r, corner), pointer, 5);
        expect(r.w).toBeCloseTo(240);
        expect(r.h).toBeCloseTo(135);
        expect(rotationOf(r)).toBeCloseTo(rotationOf(start));
      }
    }
  });

  it("resizes a quarter-turned image along its own edges", () => {
    const start = box(0, 0, 100, 50, Math.PI / 2);
    const r = resizeImage(start, "se", { x: -25, y: 175 });
    expect(r.w).toBeCloseTo(200);
    expect(r.h).toBeCloseTo(100);
    close(imageCentre(r), { x: 25, y: 75 });
  });

  it("leaves a degenerate box alone", () => {
    expect(resizeImage(box(1, 2, 0, 5), "se", { x: 50, y: 50 })).toEqual(box(1, 2, 0, 5));
  });
});

describe("rotate", () => {
  const start = box(0, 0, 100, 50);

  it("turns by the angle swept about the centre", () => {
    const r = rotateImage(start, { x: 150, y: 25 }, { x: 50, y: 125 });
    expect(r.rotation).toBeCloseTo(Math.PI / 2);
    expect(r.x).toBe(0);
    expect(r.w).toBe(100);
  });

  it("adds to an existing rotation", () => {
    const r = rotateImage(
      box(0, 0, 100, 50, 0.2),
      { x: 150, y: 25 },
      { x: 50 + 100 * Math.cos(0.3), y: 25 + 100 * Math.sin(0.3) },
    );
    expect(r.rotation).toBeCloseTo(0.5);
  });

  it("snaps near a quarter turn and drops the key at none", () => {
    const near = rotateImage(
      start,
      { x: 150, y: 25 },
      { x: 50 + Math.cos(88 * DEG) * 100, y: 25 + Math.sin(88 * DEG) * 100 },
    );
    expect(near.rotation).toBeCloseTo(Math.PI / 2);
    const back = rotateImage(box(0, 0, 100, 50, 2 * DEG), { x: 150, y: 25 }, { x: 150, y: 25 });
    expect("rotation" in back).toBe(false);
  });

  it("ignores a pointer on the centre", () => {
    expect(rotateImage(start, { x: 150, y: 25 }, { x: 50, y: 25 })).toEqual(start);
    expect(rotateImage(start, { x: 50, y: 25 }, { x: 80, y: 90 })).toEqual(start);
  });
});
