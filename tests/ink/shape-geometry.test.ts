/**
 * Tests for `src/ink/shape-geometry.ts`: the Shape tool's presets, the
 * hold-and-adjust transform, and how a clean shape is drawn (its exact
 * centreline, stroked — never perfect-freehand's outline).
 */

import { describe, expect, it } from "vitest";
import {
  ARROW_HEAD_DEG,
  CONNECTOR_PRESETS,
  SHAPE_PRESETS,
  STAR_ASPECT,
  STAR_INNER_RATIO,
  arrowPoints,
  isClosedKind,
  isConnectorPreset,
  isShapeMode,
  pentagramPoints,
  presetGeometry,
  shapePivot,
  starPoints,
  transformShape,
} from "../../src/ink/shape-geometry";
import { recognizeShape } from "../../src/ink/shape-recognizer";
import { centrelinePath, inkPath, penOptions } from "../../src/ink/freehand";

function xy(pts: number[]): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i + 2 < pts.length; i += 3) out.push({ x: pts[i], y: pts[i + 1] });
  return out;
}

function bounds(pts: number[]): { minX: number; minY: number; maxX: number; maxY: number } {
  const p = xy(pts);
  return {
    minX: Math.min(...p.map((q) => q.x)),
    minY: Math.min(...p.map((q) => q.y)),
    maxX: Math.max(...p.map((q) => q.x)),
    maxY: Math.max(...p.map((q) => q.y)),
  };
}

describe("presetGeometry", () => {
  const from = { x: 100, y: 50 };
  const to = { x: 300, y: 170 };

  it.each(SHAPE_PRESETS)("fills the dragged box exactly for %s", (preset) => {
    const pts = presetGeometry(preset, from, to, 0.5);
    expect(pts.length % 3).toBe(0);
    const b = bounds(pts);
    expect(b.minX).toBeCloseTo(100, 1);
    expect(b.maxX).toBeCloseTo(300, 1);
    expect(b.minY).toBeCloseTo(50, 1);
    expect(b.maxY).toBeCloseTo(170, 1);
  });

  it.each(SHAPE_PRESETS)("closes %s on its first point", (preset) => {
    const p = xy(presetGeometry(preset, from, to, 0.5));
    expect(p[p.length - 1].x).toBeCloseTo(p[0].x, 2);
    expect(p[p.length - 1].y).toBeCloseTo(p[0].y, 2);
  });

  it("does not care which corner the drag started from", () => {
    expect(presetGeometry("rect", to, from, 0.5)).toEqual(presetGeometry("rect", from, to, 0.5));
  });

  it("puts the triangle's apex at top centre, as GoodNotes does", () => {
    const [apex] = xy(presetGeometry("triangle", from, to, 0.5));
    expect(apex).toEqual({ x: 200, y: 50 });
  });

  it("returns nothing for a degenerate or non-finite box", () => {
    expect(presetGeometry("rect", from, { x: 100, y: 200 }, 0.5)).toEqual([]);
    expect(presetGeometry("ellipse", from, { x: NaN, y: 200 }, 0.5)).toEqual([]);
  });

  it("recognises its own presets as the shape they are", () => {
    // A placed preset re-read by hold-to-snap must not turn into something else.
    expect(recognizeShape(presetGeometry("rect", from, to, 0.5))?.kind).toBe("rect");
    expect(recognizeShape(presetGeometry("ellipse", from, to, 0.5))?.kind).toBe("ellipse");
    expect(recognizeShape(presetGeometry("ellipse", from, { x: 220, y: 170 }, 0.5))?.kind).toBe(
      "circle",
    );
    const poly = { polygons: true };
    expect(recognizeShape(presetGeometry("triangle", from, to, 0.5), poly)?.kind).toBe("triangle");
    expect(
      recognizeShape(presetGeometry("diamond", { x: 0, y: 0 }, { x: 200, y: 200 }, 0.5), poly)
        ?.kind,
    ).toBe("diamond");
    // The star is stretched to its box, so only a box of the star's own
    // proportions stays regular enough to re-read as one.
    expect(recognizeShape(presetGeometry("star", from, { x: 290, y: 230 }, 0.5))?.kind).toBe(
      "star",
    );
    expect(recognizeShape(presetGeometry("line", from, to, 0.5))?.kind).toBe("line");
    expect(recognizeShape(presetGeometry("arrow", from, to, 0.5))?.kind).toBe("arrow");
  });

  it("puts the star's top tip at top centre, as the other presets are drawn", () => {
    const [tip] = xy(presetGeometry("star", from, to, 0.5));
    expect(tip.x).toBeCloseTo(200, 1);
    expect(tip.y).toBeCloseTo(50, 1);
    expect(presetGeometry("star", from, to, 0.5)).toHaveLength(11 * 3);
  });
});

describe("connector presets", () => {
  const from = { x: 300, y: 200 };
  const to = { x: 100, y: 80 };

  it("keep the direction of the drag: a line runs from the press to the lift", () => {
    expect(presetGeometry("line", from, to, 0.5)).toEqual([300, 200, 0.5, 100, 80, 0.5]);
  });

  it("put an arrow's head where the pen lifted, in the contract's six-point layout", () => {
    const p = xy(presetGeometry("arrow", from, to, 0.5));
    expect(p).toHaveLength(6);
    expect(p[0]).toEqual(from);
    expect(p[1]).toEqual(to);
    expect(p[2]).toEqual(to);
    expect(p[4]).toEqual(to);
    // Both barbs trail back toward the tail, on either side of the shaft.
    for (const barb of [p[3], p[5]]) {
      expect(Math.hypot(barb.x - from.x, barb.y - from.y)).toBeLessThan(
        Math.hypot(to.x - from.x, to.y - from.y),
      );
    }
  });

  it("return nothing when the press and the lift coincide, or are not finite", () => {
    expect(presetGeometry("line", from, from, 0.5)).toEqual([]);
    expect(presetGeometry("arrow", from, { x: NaN, y: 0 }, 0.5)).toEqual([]);
  });
});

describe("star, pentagram and arrow emitters", () => {
  it("starPoints alternates tip and notch and closes on its first vertex", () => {
    const p = starPoints(0, 0, 100, 40, -Math.PI / 2);
    expect(p).toHaveLength(11);
    p.slice(0, 10).forEach((q, i) => expect(Math.hypot(q.x, q.y)).toBeCloseTo(i % 2 ? 40 : 100, 6));
    expect(p[10].x).toBeCloseTo(p[0].x, 9);
    expect(p[0].y).toBeCloseTo(-100, 9);
  });

  it("starPoints can start on a notch and run either way", () => {
    const fwd = starPoints(0, 0, 100, 40, 0, 1, 1);
    const back = starPoints(0, 0, 100, 40, 0, 1, -1);
    expect(Math.hypot(fwd[0].x, fwd[0].y)).toBeCloseTo(40, 6);
    expect(fwd[0].x).toBeCloseTo(back[0].x, 9);
    expect(fwd[1].x).toBeCloseTo(back[9].x, 9);
    expect(fwd[1].y).toBeCloseTo(back[9].y, 9);
  });

  it("the preset star's notches sit where a pentagram's lines cross", () => {
    expect(STAR_INNER_RATIO).toBeCloseTo(0.382, 3);
  });

  it("a star box of STAR_ASPECT proportions holds a regular star (the tapped default)", () => {
    const p = xy(presetGeometry("star", { x: 0, y: 0 }, { x: 160, y: 160 * STAR_ASPECT }, 0.5));
    const tips = p.slice(0, 10).filter((_, i) => i % 2 === 0);
    const c = {
      x: p.slice(0, 10).reduce((s, q) => s + q.x, 0) / 10,
      y: p.slice(0, 10).reduce((s, q) => s + q.y, 0) / 10,
    };
    const radii = tips.map((q) => Math.hypot(q.x - c.x, q.y - c.y));
    expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(0.05);
  });

  it("pentagramPoints steps across the star, 144° at a time", () => {
    const p = pentagramPoints(0, 0, 100, 0, 0, 1);
    expect(p).toHaveLength(6);
    for (let i = 0; i < 5; i++) {
      const a = Math.atan2(p[i].y, p[i].x);
      const b = Math.atan2(p[i + 1].y, p[i + 1].x);
      let step = ((b - a) * 180) / Math.PI;
      while (step < 0) step += 360;
      expect(step).toBeCloseTo(144, 6);
    }
    expect(p[5].x).toBeCloseTo(p[0].x, 9);
  });

  it("arrowPoints sizes the head from the shaft, within a readable clamp", () => {
    const barbOf = (len: number): number => {
      const p = arrowPoints({ x: 0, y: 0 }, { x: len, y: 0 });
      return Math.hypot(p[3].x - len, p[3].y);
    };
    expect(barbOf(100)).toBeCloseTo(18, 6);
    expect(barbOf(40)).toBeCloseTo(12, 6);
    expect(barbOf(20)).toBeCloseTo(9, 6);
    expect(barbOf(1000)).toBeCloseTo(40, 6);
    const p = arrowPoints({ x: 0, y: 0 }, { x: 100, y: 0 });
    expect((Math.atan2(Math.abs(p[3].y), 100 - p[3].x) * 180) / Math.PI).toBeCloseTo(
      ARROW_HEAD_DEG,
      6,
    );
    expect(arrowPoints({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual([]);
  });
});

describe("isShapeMode / isClosedKind", () => {
  it("accepts auto, every preset, the connectors and the table, nothing else", () => {
    expect(isShapeMode("auto")).toBe(true);
    for (const preset of SHAPE_PRESETS) expect(isShapeMode(preset)).toBe(true);
    // The connectors joined the Shape tool on 2026-09-22 (they were left out
    // when it was first built from the GoodNotes reference), and so did tables.
    for (const preset of CONNECTOR_PRESETS) expect(isShapeMode(preset)).toBe(true);
    expect(isShapeMode("table")).toBe(true);
    expect(isShapeMode("circle")).toBe(false);
    expect(isShapeMode("polygon")).toBe(false);
    expect(isShapeMode(undefined)).toBe(false);
    expect(isShapeMode("toString")).toBe(false);
  });

  it("tells a connector from a box preset", () => {
    expect(isConnectorPreset("line")).toBe(true);
    expect(isConnectorPreset("arrow")).toBe(true);
    expect(isConnectorPreset("rect")).toBe(false);
    expect(isConnectorPreset("table")).toBe(false);
    expect(isConnectorPreset("auto")).toBe(false);
  });

  it("treats lines and arrows as open, everything else as closed", () => {
    expect(isClosedKind("line")).toBe(false);
    expect(isClosedKind("arrow")).toBe(false);
    expect(isClosedKind("triangle")).toBe(true);
    expect(isClosedKind("ellipse")).toBe(true);
  });
});

describe("shapePivot", () => {
  it("pivots an open shape on its first point", () => {
    expect(shapePivot("line", [10, 20, 0.5, 90, 60, 0.5])).toEqual({ x: 10, y: 20 });
  });

  it("pivots a closed shape on its bounding-box centre", () => {
    const pts = presetGeometry("rect", { x: 0, y: 0 }, { x: 100, y: 40 }, 0.5);
    expect(shapePivot("rect", pts)).toEqual({ x: 50, y: 20 });
  });

  it("returns null for no points or non-finite ones", () => {
    expect(shapePivot("rect", [])).toBeNull();
    expect(shapePivot("rect", [NaN, 0, 0.5, 1, 1, 0.5])).toBeNull();
  });
});

describe("transformShape", () => {
  const line = [0, 0, 0.5, 100, 0, 0.5];

  it("makes a line's far end follow the pen", () => {
    const out = transformShape(line, { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 150 });
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0);
    expect(out[3]).toBeCloseTo(0, 2);
    expect(out[4]).toBeCloseTo(150, 2);
  });

  it("scales a closed shape about its centre", () => {
    const rect = presetGeometry("rect", { x: 0, y: 0 }, { x: 100, y: 100 }, 0.5);
    const pivot = shapePivot("rect", rect)!;
    const out = transformShape(rect, pivot, { x: 100, y: 100 }, { x: 150, y: 150 });
    const b = bounds(out);
    expect(b.minX).toBeCloseTo(-50, 1);
    expect(b.maxX).toBeCloseTo(150, 1);
  });

  it("leaves pressure alone and does not write past a ragged tail", () => {
    const ragged = [...line, 7];
    const out = transformShape(ragged, { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 });
    expect(out).toHaveLength(ragged.length);
    expect(out[2]).toBe(0.5);
    expect(out[6]).toBe(7);
  });

  it("does nothing when the pen started on the pivot", () => {
    expect(transformShape(line, { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 80, y: 80 })).toEqual(line);
  });
});

describe("shape rendering", () => {
  // Regressions: five far-apart vertices through perfect-freehand's
  // streamline came out as a lopsided quad well inside the true box; with
  // streamline off, its corner handling still notched or bevelled every
  // corner, plain to see at 5x zoom. A shape is now its exact centreline.
  it("draws a snapped rectangle through its exact corners, stroked at the pen's width", () => {
    const rect = presetGeometry("rect", { x: 0, y: 0 }, { x: 200, y: 120 }, 0.5);
    const ink = inkPath(rect, penOptions(3, false), true, true)!;
    expect(ink.stroke).toBe(3);
    expect(ink.d).toBe("M 0.00 0.00 L 200.00 0.00 L 200.00 120.00 L 0.00 120.00 L 0.00 0.00 Z");
  });

  it("leaves an open shape open, and draws a lone point as a dot", () => {
    expect(centrelinePath([0, 0, 0.5, 10, 5, 0.5])).toBe("M 0.00 0.00 L 10.00 5.00");
    expect(centrelinePath([4, 4, 0.5])).toBe("M 4.00 4.00 L 4.00 4.00");
    expect(centrelinePath([])).toBe("");
  });

  it("still outlines handwriting, filled", () => {
    const ink = inkPath([0, 0, 0.5, 10, 2, 0.5, 20, 0, 0.5], penOptions(3, true))!;
    expect(ink.stroke).toBeNull();
    expect(ink.d.startsWith("M")).toBe(true);
    expect(ink.d).toContain("Q");
    expect(inkPath([], penOptions(3, true))).toBeNull();
  });
});
