import { describe, expect, it } from "vitest";
import { POINT_STRIDE, type Stroke, type TextBoxElement } from "../../src/model/document";
import {
  LABEL_MARGIN,
  grownToFit,
  holdsBox,
  holdsStroke,
  insideShape,
  labelArea,
  labelFrame,
  labelOf,
  shapeBox,
  takesLabel,
} from "../../src/model/shape-label";
import { copyElements } from "../../src/model/selection-commands";

/** A closed outline through `corners`, its first point repeated at the end. */
function closed(corners: Array<[number, number]>): number[] {
  return [...corners, corners[0]].flatMap(([x, y]) => [x, y, 0.5]);
}

function shape(
  kind: Stroke["shape"],
  corners: Array<[number, number]>,
  extra: Partial<Stroke> = {},
): Stroke {
  return {
    id: "s1",
    color: "#2f9e44",
    size: 2,
    tool: "pen",
    shape: kind,
    pts: closed(corners),
    ...extra,
  };
}

const square = (): Stroke =>
  shape("rect", [
    [100, 100],
    [300, 100],
    [300, 200],
    [100, 200],
  ]);

function ellipse(cx: number, cy: number, rx: number, ry: number): Stroke {
  const corners: Array<[number, number]> = [];
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    corners.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return shape("ellipse", corners);
}

const ink = (id: string, pts: Array<[number, number]>): Stroke => ({
  id,
  color: "#000000",
  size: 2,
  tool: "pen",
  pts: pts.flatMap(([x, y]) => [x, y, 0.5]),
});

function box(extra: Partial<TextBoxElement> = {}): TextBoxElement {
  return { id: "t1", x: 0, y: 0, w: 100, text: "Hi", color: "#000000", fontSize: 22, ...extra };
}

describe("which shapes take text", () => {
  it("takes closed shapes with an inside, and nothing open, freehand or on a note", () => {
    expect(takesLabel(square())).toBe(true);
    expect(takesLabel(ellipse(0, 0, 50, 30))).toBe(true);
    expect(takesLabel({ ...square(), shape: "line" })).toBe(false);
    expect(takesLabel({ ...square(), shape: undefined })).toBe(false);
    expect(takesLabel({ ...square(), onSticky: "i1" })).toBe(false);
    expect(takesLabel({ ...square(), tool: "highlighter" })).toBe(false);
    // An eraser's piece of a rectangle is no longer closed.
    expect(takesLabel({ ...square(), pts: square().pts.slice(0, 3 * POINT_STRIDE) })).toBe(false);
  });
});

describe("where the text wraps", () => {
  it("fills a rectangle less a margin, centred", () => {
    const area = labelArea(square());
    const margin = LABEL_MARGIN + 1;
    expect(area).toEqual({
      x: 100 + margin,
      y: 100 + margin,
      w: 200 - 2 * margin,
      h: 100 - 2 * margin,
    });
  });

  it("keeps to the rectangle inscribed in an ellipse, centred on it", () => {
    const area = labelArea(ellipse(200, 150, 100, 50));
    expect(area).not.toBeNull();
    if (!area) return;
    expect(area.x + area.w / 2).toBeCloseTo(200, 0);
    expect(area.y + area.h / 2).toBeCloseTo(150, 0);
    // Every corner of the area lies inside the ellipse.
    for (const [x, y] of [
      [area.x, area.y],
      [area.x + area.w, area.y + area.h],
    ]) {
      expect(((x - 200) / 100) ** 2 + ((y - 150) / 50) ** 2).toBeLessThan(1);
    }
  });

  it("sits low in a triangle, where it is wide", () => {
    const tri = shape("triangle", [
      [200, 100],
      [300, 300],
      [100, 300],
    ]);
    const area = labelArea(tri);
    expect(area && area.y + area.h / 2).toBeGreaterThan(200);
  });

  it("centres the text's height in the area", () => {
    expect(labelFrame({ x: 10, y: 20, w: 80, h: 100 }, 40)).toEqual({ x: 10, y: 50, w: 80 });
  });
});

describe("a shape grows to hold its text", () => {
  it("stretches downwards from its top until the text fits, and never shrinks", () => {
    const s = square();
    const area = labelArea(s);
    if (!area) throw new Error("no area");
    expect(grownToFit(s, area.h - 5)).toBeNull();
    const pts = grownToFit(s, area.h + 60);
    expect(pts).not.toBeNull();
    if (!pts) return;
    expect(pts).not.toBe(s.pts);
    const grown = { ...s, pts };
    const b = shapeBox(grown);
    expect(b?.minY).toBe(100);
    expect(b?.minX).toBe(100);
    expect(b?.maxX).toBe(300);
    expect(labelArea(grown)?.h).toBeGreaterThanOrEqual(area.h + 60 - 0.01);
  });
});

describe("what a shape holds", () => {
  it("finds points inside the outline", () => {
    const s = square();
    expect(insideShape(s, 150, 150)).toBe(true);
    expect(insideShape(s, 350, 150)).toBe(false);
  });

  it("holds ink written inside it, whichever came first, and not ink that crosses out", () => {
    const s = square();
    const word = ink("w", [
      [120, 140],
      [160, 150],
      [200, 160],
    ]);
    const across = ink("x", [
      [120, 150],
      [250, 150],
      [400, 150],
      [500, 150],
    ]);
    expect(holdsStroke(s, word)).toBe(true);
    expect(holdsStroke(s, across)).toBe(false);
    expect(holdsStroke(s, s)).toBe(false);
  });

  it("holds its own text, and a box whose middle is inside it", () => {
    const s = square();
    expect(holdsBox(s, box({ onShape: "s1", x: 900, y: 900 }), 20)).toBe(true);
    expect(holdsBox(s, box({ x: 130, y: 130, w: 60 }), 20)).toBe(true);
    expect(holdsBox(s, box({ x: 400, y: 130, w: 60 }), 20)).toBe(false);
  });

  it("finds a shape's text, never a mirror of it", () => {
    const own = box({ onShape: "s1" });
    const mirror = box({ id: "t2", onShape: "s1", join: "p0/t1" });
    expect(labelOf([mirror, own], "s1")).toBe(own);
    expect(labelOf([mirror], "s1")).toBeUndefined();
  });
});

describe("copies", () => {
  it("ties a copied shape's text to the copy, and a text copied alone to no shape", () => {
    const s = square();
    const label = box({ onShape: "s1" });
    let n = 0;
    const ids = {
      stroke: () => `s${++n + 10}`,
      image: () => "i9",
      textBox: () => `t${++n + 10}`,
      table: () => "g9",
      graph: () => "f9",
    };
    const both = copyElements({ strokes: [s], images: [], textBoxes: [label] }, ids, 10, 10);
    expect(both.textBoxes[0].onShape).toBe(both.strokes[0].id);
    const alone = copyElements({ strokes: [], images: [], textBoxes: [label] }, ids, 10, 10);
    expect(alone.textBoxes[0].onShape).toBeUndefined();
  });
});
