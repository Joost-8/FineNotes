/**
 * `src/canvas/ruled-ink.ts`: the ruled eraser's choices.
 */

import { describe, expect, it } from "vitest";
import { writingLines } from "../../src/canvas/backdrop";
import {
  RuledEraser,
  inLineSpan,
  lineSpan,
  linedItems,
  marginEdge,
  ruledCuts,
  spanOutline,
} from "../../src/canvas/ruled-ink";
import { eraseRectsFromStroke } from "../../src/ink/stroke-eraser";
import type { PageGeometry, Stroke } from "../../src/model/document";

/** Fresh piece ids. */
function ids(): () => string {
  let n = 0;
  return () => `piece-${n++}`;
}

/** Each piece's first and last x, rounded. */
function xs(pieces: Stroke[] | null): number[][] {
  return (pieces ?? []).map((p) => [Math.round(p.pts[0]), Math.round(p.pts[p.pts.length - 3])]);
}

/** Each piece's first and last y, rounded. */
function ys(pieces: Stroke[] | null): number[][] {
  return (pieces ?? []).map((p) => [Math.round(p.pts[1]), Math.round(p.pts[p.pts.length - 2])]);
}

const A4: PageGeometry = { width: 1024, height: 1448 };
const RULED = writingLines({ kind: "ruled-wide" }, A4); // rules at 40, 80, 120, …
const COLUMNS = writingLines({ kind: "two-column" }, A4);

/** A stroke through the given points, at pressure 0.5. */
function ink(id: string, points: Array<[number, number]>, tool: Stroke["tool"] = "pen"): Stroke {
  return { id, color: "#000", size: 2, tool, pts: points.flatMap(([x, y]) => [x, y, 0.5]) };
}

/** A word on the rule at `base`, from x0 to x1: x-height writing just above it. */
const word = (id: string, x0: number, x1: number, base: number): Stroke =>
  ink(id, [
    [x0, base - 2],
    [(x0 + x1) / 2, base - 14],
    [x1, base - 2],
  ]);

// Line 2 (rule at 120): "dolor, sit" with a comma and an i-dot.
const DOLOR = word("dolor", 100, 160, 120);
const COMMA = ink("comma", [
  [163, 121],
  [161, 133],
]);
const SIT = word("sit", 180, 220, 120);
const DOT = ink("dot", [
  [200, 89],
  [201, 90],
]);
// Line 3 (rule at 160), with a descender reaching up into line 2's band? No:
// a capital on line 3 whose top pokes into line 2's band.
const CAPITAL = ink("capital", [
  [120, 160],
  [120, 124],
  [140, 124],
]);
// A sketch on no line: a big loop across several lines.
const SKETCH = ink("sketch", [
  [600, 100],
  [800, 100],
  [800, 400],
  [600, 400],
  [600, 100],
]);
const PAGE = [DOLOR, COMMA, SIT, DOT, CAPITAL, SKETCH];

describe("marginEdge", () => {
  it("is where the lines start, or a thin strip on a page ruled to the edge", () => {
    expect(marginEdge(RULED, A4.width)).toBeCloseTo(A4.width * 0.04);
    expect(marginEdge(writingLines({ kind: "legal" }, A4), A4.width)).toBeCloseTo(
      A4.width * 0.08 + 6,
    );
    expect(marginEdge([], A4.width)).toBeCloseTo(A4.width * 0.04);
  });
});

describe("linedItems", () => {
  it("puts the comma and the dot on their word's line, and the sketch on none", () => {
    const lines = new Map(
      linedItems(RULED, PAGE, (s) => {
        const xs = s.pts.filter((_, i) => i % 3 === 0);
        const ys = s.pts.filter((_, i) => i % 3 === 1);
        return {
          minX: Math.min(...xs),
          maxX: Math.max(...xs),
          minY: Math.min(...ys),
          maxY: Math.max(...ys),
        };
      }).map((l) => [l.item.id, l.line]),
    );
    expect(lines.get("comma")).toEqual({ block: 0, line: 2 });
    expect(lines.get("dot")).toEqual({ block: 0, line: 2 });
    expect(lines.get("capital")).toEqual({ block: 0, line: 3 });
    // The sketch's centre is at y=250, on line 6; it spans several lines but
    // still has one. A sketch has no line only off every block.
    expect(lines.get("sketch")).not.toBeNull();
  });

  it("skips items without bounds", () => {
    expect(linedItems(RULED, [ink("empty", [])], () => null)).toEqual([]);
  });
});

describe("RuledEraser", () => {
  it("a pass along a line takes its words with their comma and dot", () => {
    const eraser = new RuledEraser(RULED, PAGE, { x: 95, y: 112 }, A4.width);
    expect(eraser.wholeLines).toBe(false);
    const taken = [95, 120, 140, 160, 175, 200, 220].flatMap(
      (x) => eraser.dab({ x, y: 112 }, 6).taken,
    );
    expect(taken.sort()).toEqual(["comma", "dolor", "dot", "sit"]);
  });

  it("leaves the line below alone, even where its ink reaches up into the pass", () => {
    const eraser = new RuledEraser(RULED, PAGE, { x: 120, y: 126 }, A4.width);
    // y=126 is in line 2's band; the capital pokes up to 124 but sits on line 3.
    expect(eraser.dab({ x: 130, y: 126 }, 6).taken).toEqual(["dolor"]);
  });

  it("takes only as far along the line as the pass reaches", () => {
    const eraser = new RuledEraser(RULED, PAGE, { x: 100, y: 112 }, A4.width);
    expect(eraser.dab({ x: 110, y: 112 }, 4).taken).toEqual(["dolor"]);
    expect(eraser.dab({ x: 150, y: 112 }, 4).taken).toEqual([]);
  });

  it("takes each stroke once", () => {
    const eraser = new RuledEraser(RULED, PAGE, { x: 120, y: 112 }, A4.width);
    expect(eraser.dab({ x: 120, y: 112 }, 4).taken).toEqual(["dolor"]);
    expect(eraser.dab({ x: 121, y: 112 }, 4).taken).toEqual([]);
  });

  it("cuts a stroke across several lines to the line under the eraser", () => {
    const tall = ink("tall", [
      [700, 50],
      [700, 700],
    ]);
    const eraser = new RuledEraser(RULED, [tall], { x: 300, y: 112 }, A4.width);
    // A dab on its line but away from it reaches it nowhere.
    const away = eraser.dab({ x: 300, y: 112 }, 4);
    expect(away).toEqual({ taken: [], cut: [] });
    // On it: only line 2's band (90..130) goes; above and below stay.
    expect(eraser.dab({ x: 700, y: 112 }, 4)).toEqual({ taken: [], cut: ["tall"] });
    expect(ys(eraseRectsFromStroke(tall, eraser.regions(), ids()))).toEqual([
      [50, 90],
      [130, 700],
    ]);
  });

  it("ink on no line still goes whole where the eraser touches it", () => {
    const offPage = ink("off", [
      [300, -80],
      [320, -60],
    ]);
    const unlined = new RuledEraser(RULED, [offPage], { x: 300, y: 112 }, A4.width);
    expect(unlined.dab({ x: 310, y: -70 }, 4).taken).toEqual(["off"]);
    expect(unlined.dab({ x: 500, y: -70 }, 4).taken).toEqual([]);
  });

  it("a drawing over several lines loses only what lies under the pass", () => {
    // SKETCH's box spans 600..800 by 100..400; line 6's band is 250..290.
    const eraser = new RuledEraser(RULED, PAGE, { x: 650, y: 270 }, A4.width);
    expect(eraser.dab({ x: 700, y: 270 }, 4).taken).toEqual([]);
    // Inside its box, but no ink there: nothing to cut.
    expect(eraseRectsFromStroke(SKETCH, eraser.regions(), ids())).toBeNull();
    expect(eraser.dab({ x: 800, y: 270 }, 4)).toEqual({ taken: [], cut: ["sketch"] });
    const pieces = eraseRectsFromStroke(SKETCH, eraser.regions(), ids());
    // The loop is cut once, on its right side, across line 6.
    expect(pieces).toHaveLength(2);
    expect(ys(pieces)).toEqual([
      [100, 250],
      [290, 100],
    ]);
  });

  it("cuts a straightened highlight to the stretch erased, and keeps it straight", () => {
    const hl: Stroke = {
      ...ink(
        "hl",
        [
          [100, 110],
          [500, 110],
        ],
        "highlighter",
      ),
      size: 20,
      shape: "line",
    };
    const eraser = new RuledEraser(RULED, [hl], { x: 300, y: 112 }, A4.width);
    expect(eraser.dab({ x: 300, y: 112 }, 4)).toEqual({ taken: [], cut: ["hl"] });
    const pieces = eraseRectsFromStroke(hl, eraser.regions(), ids()) ?? [];
    // The eraser's 296..304, widened by the highlight's round caps (10).
    expect(xs(pieces)).toEqual([
      [100, 286],
      [314, 500],
    ]);
    expect(pieces.every((p) => p.shape === "line" && p.tool === "highlighter")).toBe(true);
  });

  it("a highlight under an erased word loses just the word's stretch", () => {
    const hl = {
      ...ink(
        "hl",
        [80, 120, 160, 240, 400].map((x) => [x, 108]),
        "highlighter",
      ),
      size: 20,
    };
    const eraser = new RuledEraser(RULED, [DOLOR, hl], { x: 120, y: 112 }, A4.width);
    const dab = eraser.dab({ x: 120, y: 112 }, 4);
    expect(dab.taken).toEqual(["dolor"]);
    expect(dab.cut).toEqual(["hl"]);
    // DOLOR runs 100..160: the highlight goes from 90 to 170.
    expect(xs(eraseRectsFromStroke(hl, eraser.regions(), ids()))).toEqual([
      [80, 90],
      [170, 400],
    ]);
  });

  it("takes a word that only sits across two lines whole", () => {
    const block = RULED[0];
    const bounds = { minX: 0, maxX: 50, minY: 100, maxY: 140 }; // 30 in line 2, 10 in line 3
    expect(ruledCuts(block, word("w", 0, 50, 120), bounds)).toBe(false);
    expect(ruledCuts(block, word("w", 0, 50, 120), { ...bounds, maxY: 155 })).toBe(true);
    expect(ruledCuts(block, { ...word("w", 0, 50, 120), shape: "rect" }, bounds)).toBe(true);
  });

  it("a pass from the margin erases whole lines, in every column", () => {
    const left = word("left", 100, 300, 120);
    const right = word("right", 600, 800, 120);
    const below = word("below", 100, 300, 160);
    const eraser = new RuledEraser(COLUMNS, [left, right, below], { x: 10, y: 112 }, A4.width);
    expect(eraser.wholeLines).toBe(true);
    expect(eraser.dab({ x: 10, y: 112 }, 4).taken.sort()).toEqual(["left", "right"]);
    expect(eraser.dab({ x: 10, y: 152 }, 4).taken).toEqual(["below"]);
    expect(eraser.dab({ x: 10, y: -500 }, 4).taken).toEqual([]);
  });

  it("a pass from the margin cuts a highlight off its line, gutter and all", () => {
    const across = {
      ...ink(
        "across",
        [
          [60, 110],
          [960, 110],
        ],
        "highlighter",
      ),
      size: 20,
    };
    const next = {
      ...ink(
        "next",
        [
          [60, 150],
          [960, 150],
        ],
        "highlighter",
      ),
      size: 20,
    };
    const eraser = new RuledEraser(COLUMNS, [across, next], { x: 10, y: 112 }, A4.width);
    expect(eraser.dab({ x: 10, y: 112 }, 4)).toEqual({ taken: [], cut: ["across"] });
    expect(eraseRectsFromStroke(across, eraser.regions(), ids())).toEqual([]);
    expect(eraseRectsFromStroke(next, eraser.regions(), ids())).toBeNull();
  });

  it("passes over strokes the filter keeps", () => {
    const mark = ink(
      "mark",
      [
        [100, 110],
        [200, 110],
      ],
      "highlighter",
    );
    const pen = new RuledEraser(RULED, [DOLOR, mark], { x: 120, y: 112 }, A4.width, "pen");
    expect(pen.dab({ x: 150, y: 112 }, 4)).toEqual({ taken: ["dolor"], cut: [] });
    const marker = new RuledEraser(
      RULED,
      [DOLOR, mark],
      { x: 120, y: 112 },
      A4.width,
      "highlighter",
    );
    expect(marker.dab({ x: 150, y: 112 }, 4)).toEqual({ taken: [], cut: ["mark"] });
  });
});

describe("ruled selection", () => {
  const BLOCK = RULED[0];

  it("runs from the pen-down to the pen, ordered like text", () => {
    expect(lineSpan(RULED, { x: 300, y: 112 }, { x: 200, y: 190 })).toEqual({
      block: 0,
      from: { line: 2, x: 300 },
      to: { line: 4, x: 200 },
    });
    // Dragged backwards: the ends swap.
    expect(lineSpan(RULED, { x: 200, y: 190 }, { x: 300, y: 112 })).toEqual({
      block: 0,
      from: { line: 2, x: 300 },
      to: { line: 4, x: 200 },
    });
    expect(lineSpan(RULED, { x: 300, y: 112 }, { x: 100, y: 112 })?.from).toEqual({
      line: 2,
      x: 100,
    });
  });

  it("holds the far end to the pen-down's block", () => {
    const span = lineSpan(COLUMNS, { x: 100, y: 112 }, { x: 900, y: -400 });
    expect(span).toEqual({ block: 0, from: { line: 0, x: 512 }, to: { line: 2, x: 100 } });
  });

  it("is nothing when the pen went down on no line", () => {
    expect(lineSpan(RULED, { x: 100, y: -50 }, { x: 200, y: 200 })).toBeNull();
  });

  it("holds ink by its line and the x of its centre", () => {
    const span = lineSpan(RULED, { x: 150, y: 112 }, { x: 200, y: 190 })!;
    const at = (line: number, x0: number, x1: number) => ({
      ref: { block: 0, line },
      bounds: { minX: x0, maxX: x1, minY: 0, maxY: 0 },
    });
    const holds = (line: number, x0: number, x1: number): boolean => {
      const { ref, bounds } = at(line, x0, x1);
      return inLineSpan(span, ref, bounds);
    };
    expect(holds(2, 100, 140)).toBe(false); // before the start on the first line
    expect(holds(2, 140, 200)).toBe(true); // centre past the start
    expect(holds(3, 0, 40)).toBe(true); // a whole line in between
    expect(holds(4, 150, 240)).toBe(true); // centre before the end
    expect(holds(4, 200, 260)).toBe(false); // centre past the end
    expect(holds(1, 300, 320)).toBe(false);
    expect(holds(5, 0, 10)).toBe(false);
    expect(inLineSpan(span, null, { minX: 0, maxX: 1, minY: 0, maxY: 0 })).toBe(false);
    expect(inLineSpan(span, { block: 1, line: 3 }, { minX: 0, maxX: 1, minY: 0, maxY: 0 })).toBe(
      false,
    );
  });

  it("outlines one line as a box, several as a staircase", () => {
    const one = lineSpan(RULED, { x: 100, y: 112 }, { x: 200, y: 112 })!;
    expect(spanOutline(BLOCK, one)).toEqual([100, 80, 200, 80, 200, 120, 100, 120]);
    const three = lineSpan(RULED, { x: 300, y: 112 }, { x: 200, y: 190 })!;
    const loop = spanOutline(BLOCK, three);
    expect(loop).toHaveLength(16);
    expect(loop.slice(0, 4)).toEqual([300, 80, A4.width, 80]);
    expect(Math.max(...loop.filter((_, i) => i % 2 === 1))).toBe(200);
  });
});
