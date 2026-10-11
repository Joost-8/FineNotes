/**
 * `src/canvas/writing-lines.ts` and `writingLines` in `backdrop.ts`: where a
 * template's lines are, and which line a piece of ink sits on.
 */

import { describe, expect, it } from "vitest";
import { LIGHT_PAPER, drawSynthetic, writingLines } from "../../src/canvas/backdrop";
import {
  type LineBlock,
  assignLines,
  blockAt,
  boxGap,
  evenBlock,
  lineAt,
  lineBand,
  lineOfBounds,
  ruleBand,
  sameLines,
} from "../../src/canvas/writing-lines";
import {
  type Bounds,
  COVER_RULINGS,
  type PageGeometry,
  RULINGS,
  type Ruling,
} from "../../src/model/document";
import { asCanvasContext, fakeContext, segments } from "./fake-canvas";

const A4: PageGeometry = { width: 1024, height: 1448 };
const LANDSCAPE: PageGeometry = { width: 1448, height: 1024 };

const LINED: Ruling[] = [
  "ruled-narrow",
  "ruled-wide",
  "lined",
  "legal",
  "cornell",
  "single-column",
  "three-column",
  "two-column",
  "margin-left",
  "margin-right",
  "single-column-mix",
  "todos",
  "title-date",
  "handwriting",
  "meeting-notes",
];

function drawnRules(kind: Ruling, g: PageGeometry, spacing?: number) {
  const ctx = fakeContext();
  drawSynthetic(asCanvasContext(ctx), { kind, spacing }, g, LIGHT_PAPER);
  return segments(ctx.ops).filter((s) => s.y0 === s.y1);
}

const box = (minX: number, minY: number, maxX: number, maxY: number): Bounds => ({
  minX,
  minY,
  maxX,
  maxY,
});

describe("writingLines", () => {
  for (const g of [A4, LANDSCAPE]) {
    for (const kind of LINED) {
      for (const spacing of [undefined, 33]) {
        it(`${kind} at ${g.width}x${g.height}, spacing ${spacing ?? "default"}: every line is a drawn rule`, () => {
          const blocks = writingLines({ kind, spacing }, g);
          expect(blocks.length).toBeGreaterThan(0);
          const rules = drawnRules(kind, g, spacing);
          for (const block of blocks) {
            expect(block.baselines.length).toBeGreaterThan(0);
            expect(block.pitch).toBeGreaterThan(0);
            for (const y of block.baselines) {
              const drawn = rules.some(
                (r) =>
                  r.y0 === Math.round(y) + 0.5 &&
                  Math.min(r.x0, r.x1) <= block.x0 + 0.5 &&
                  Math.max(r.x0, r.x1) >= block.x1 - 0.5,
              );
              expect(drawn, `${kind}: no rule at y=${y} across ${block.x0}..${block.x1}`).toBe(
                true,
              );
            }
            // Inside the page, top to bottom, evenly spaced within the block.
            expect(block.x0).toBeGreaterThanOrEqual(0);
            expect(block.x1).toBeLessThanOrEqual(g.width);
            for (let i = 1; i < block.baselines.length; i++) {
              expect(block.baselines[i] - block.baselines[i - 1]).toBeCloseTo(block.pitch, 6);
            }
            expect(block.baselines.at(-1)).toBeLessThan(g.height);
          }
        });
      }
    }
  }

  it("a plain ruled page has a line on every rule it draws", () => {
    const blocks = writingLines({ kind: "ruled-wide" }, A4);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].baselines).toHaveLength(drawnRules("ruled-wide", A4).length);
    expect(blocks[0].baselines.slice(0, 3)).toEqual([40, 80, 120]);
  });

  it("columns are separate blocks", () => {
    expect(writingLines({ kind: "three-column" }, A4)).toHaveLength(3);
    expect(writingLines({ kind: "two-column" }, A4)).toHaveLength(2);
    const cornell = writingLines({ kind: "cornell" }, A4);
    expect(cornell).toHaveLength(3);
    expect(cornell[2].baselines[0]).toBeGreaterThan(A4.height * 0.8);
    expect(cornell[0].baselines.at(-1)).toBeLessThanOrEqual(A4.height * 0.8);
  });

  it("headers are blocks of their own, so body lines never reach into them", () => {
    const titled = writingLines({ kind: "title-date" }, A4);
    expect(titled.map((b) => b.baselines.length).slice(0, 2)).toEqual([1, 1]);
    expect(titled[2].baselines[0]).toBe(160);
  });

  it("templates without lines to write on have none", () => {
    const none = RULINGS.filter((kind) => !LINED.includes(kind));
    expect(none).toEqual(expect.arrayContaining(["blank", "dotted", "squared", "music"]));
    for (const kind of [...none, ...COVER_RULINGS]) {
      expect(writingLines({ kind }, A4), kind).toEqual([]);
    }
    expect(writingLines({ kind: "pdf", path: "a.pdf", page: 1 }, A4)).toEqual([]);
  });

  it("an unknown or inherited ruling name has no lines and does not throw", () => {
    expect(writingLines({ kind: "toString" as Ruling }, A4)).toEqual([]);
    expect(writingLines({ kind: "from-the-future" as Ruling }, A4)).toEqual([]);
  });

  it("a page too short for any line has none", () => {
    expect(writingLines({ kind: "todos" }, { width: 400, height: 100 })).toEqual([]);
  });
});

/** A ruled-wide page: pitch 40, lines at 40, 80, 120, … across the page. */
const RULED: LineBlock[] = writingLines({ kind: "ruled-wide" }, A4);
const COLUMNS: LineBlock[] = writingLines({ kind: "two-column" }, A4);

describe("which line ink sits on", () => {
  it("a band runs from three quarters of a pitch above its rule to a quarter below", () => {
    expect(lineBand(RULED[0], 2)).toEqual({ top: 90, bottom: 130 });
  });

  it("a word's body sits on the rule below it", () => {
    // x-height writing just above the rule at 120 (line 2).
    expect(lineOfBounds(RULED, box(100, 104, 160, 119))).toEqual({ block: 0, line: 2 });
  });

  it("a descender and a capital stay on their own line", () => {
    // A "g": body above 120, tail 14 px below it.
    expect(lineOfBounds(RULED, box(100, 104, 112, 134))).toEqual({ block: 0, line: 2 });
    // A capital "T" reaching almost a whole pitch above the rule.
    expect(lineOfBounds(RULED, box(100, 82, 120, 120))).toEqual({ block: 0, line: 2 });
  });

  it("a flat stroke goes by where it lies", () => {
    expect(lineOfBounds(RULED, box(100, 110, 300, 110))).toEqual({ block: 0, line: 2 });
  });

  it("ink outside every block has no line", () => {
    const titled = writingLines({ kind: "title-date" }, A4);
    // In the header band, but not on the title or date fields.
    expect(lineOfBounds(titled, box(4, 100, 20, 110))).toBeNull();
    expect(lineOfBounds(RULED, box(100, -50, 120, -20))).toBeNull();
    expect(lineAt(RULED, 2000, 100)).toBeNull();
    expect(lineAt([], 10, 10)).toBeNull();
  });

  it("the block is the one holding the ink's centre", () => {
    expect(lineOfBounds(COLUMNS, box(600, 104, 700, 119))).toEqual({ block: 1, line: 2 });
    expect(blockAt(COLUMNS, 100, 110)).toBe(0);
    expect(blockAt(COLUMNS, 100, 99999)).toBe(-1);
  });

  it("lineAt clamps to the block's first and last line", () => {
    expect(lineAt(RULED, 50, 11)).toEqual({ block: 0, line: 0 });
    const last = RULED[0].baselines.length - 1;
    expect(lineAt(RULED, 50, RULED[0].baselines[last] + 9)).toEqual({ block: 0, line: last });
  });

  it("an i's dot high above the x-height follows its letter", () => {
    const stem = box(100, 106, 103, 120); // the i, on the rule at 120
    const dot = box(100, 86, 103, 89); // 31 px up: alone it reads as line 1
    expect(lineOfBounds(RULED, dot)).toEqual({ block: 0, line: 1 });
    expect(assignLines(RULED, [stem, dot])).toEqual([
      { block: 0, line: 2 },
      { block: 0, line: 2 },
    ]);
  });

  it("a comma hanging below the rule follows the word before it", () => {
    const word = box(100, 104, 160, 120);
    const comma = box(162, 127, 166, 136); // below the rule: alone it is line 3
    expect(lineOfBounds(RULED, comma)).toEqual({ block: 0, line: 3 });
    expect(assignLines(RULED, [word, comma])[1]).toEqual({ block: 0, line: 2 });
  });

  it("a mark with no writing near keeps its own line", () => {
    const word = box(100, 104, 160, 120);
    const farDot = box(600, 300, 603, 303);
    expect(assignLines(RULED, [word, farDot])[1]).toEqual(lineOfBounds(RULED, farDot));
  });

  it("a mark only follows writing in its own block", () => {
    const left = box(400, 104, 508, 120); // block 0, ends at the column edge
    const dot = box(515, 86, 518, 89); // block 1
    expect(assignLines(COLUMNS, [left, dot])[1]?.block).toBe(1);
  });

  it("ink off every line stays off", () => {
    expect(assignLines(RULED, [box(100, -60, 104, -56)])).toEqual([null]);
  });

  // Joost's recording (2026-10-11): writing on the first line reached above
  // its band, and the T's crossbar and the i's dots stayed behind when space
  // was inserted.
  it("the tops of first-line writing are on the first line", () => {
    const stem = box(100, 12, 104, 40); // a T on the first rule, at 40
    const bar = box(90, 4, 116, 8); // its crossbar, above the band (10..50)
    const dot = box(130, 2, 133, 5); // an i's dot, higher still
    expect(lineOfBounds(RULED, bar)).toEqual({ block: 0, line: 0 });
    expect(assignLines(RULED, [stem, bar, dot])).toEqual([
      { block: 0, line: 0 },
      { block: 0, line: 0 },
      { block: 0, line: 0 },
    ]);
  });

  it("a crossbar in the band above follows the letter it crosses", () => {
    const stem = box(100, 84, 104, 120); // a T on the rule at 120 (line 2)
    const bar = box(90, 82, 116, 87); // wholly in line 1's band
    expect(lineOfBounds(RULED, bar)).toEqual({ block: 0, line: 1 });
    expect(assignLines(RULED, [stem, bar])[1]).toEqual({ block: 0, line: 2 });
  });

  it("a flat stroke touching nothing keeps its own line", () => {
    const word = box(100, 104, 160, 120); // line 2
    const dash = box(100, 84, 200, 86); // line 1, 18 px above the word
    expect(assignLines(RULED, [word, dash])[1]).toEqual({ block: 0, line: 1 });
  });

  it("a highlight runs from rule to rule", () => {
    expect(ruleBand(RULED[0], 2)).toEqual({ top: 80, bottom: 120 });
  });
});

describe("helpers", () => {
  it("evenBlock stops before its limit and refuses a zero step", () => {
    expect(evenBlock(0, 10, 40, 40, 160).baselines).toEqual([40, 80, 120]);
    expect(evenBlock(0, 10, 40, 0, 160).baselines).toEqual([]);
  });

  it("boxGap is zero for touching boxes and the corner distance otherwise", () => {
    expect(boxGap(box(0, 0, 10, 10), box(10, 5, 20, 8))).toBe(0);
    expect(boxGap(box(0, 0, 10, 10), box(13, 14, 20, 20))).toBe(5);
  });

  it("sameLines compares the whole layout", () => {
    const a = writingLines({ kind: "ruled-wide" }, A4);
    expect(sameLines(a, writingLines({ kind: "lined" }, A4))).toBe(true);
    expect(sameLines(a, writingLines({ kind: "ruled-narrow" }, A4))).toBe(false);
    expect(sameLines(a, writingLines({ kind: "ruled-wide" }, LANDSCAPE))).toBe(false);
    expect(sameLines(a, writingLines({ kind: "two-column" }, A4))).toBe(false);
    expect(sameLines(a, writingLines({ kind: "margin-left" }, A4))).toBe(false);
  });
});
