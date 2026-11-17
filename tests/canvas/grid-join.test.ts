/**
 * Squared, dotted and lined paper on joined pages: the pattern runs on over
 * the join (`gridPhase`, `patternStart`), instead of a strip plus a whole
 * square where two pages meet.
 */

import { describe, expect, it } from "vitest";
import { LIGHT_PAPER, drawSynthetic, patternStart } from "../../src/canvas/backdrop";
import { gridPhase } from "../../src/canvas/page-join";
import { layoutPages } from "../../src/canvas/page-layout";
import { type Page, type SyntheticBackdrop, blankPage } from "../../src/model/document";
import { asCanvasContext, fakeContext } from "./fake-canvas";

function pages(n: number, width = 1024, height = 1448): Page[] {
  return Array.from({ length: n }, (_, i) => {
    const page = blankPage(`p${i + 1}`);
    page.geometry = { width, height };
    return page;
  });
}

/** The y of every line drawn left to right, layout px, over the joined stack. */
function stackYs(backdrop: SyntheticBackdrop, joined: boolean): number[] {
  const layout = layoutPages(pages(3), { joined });
  const ys: number[] = [];
  for (const box of layout.boxes) {
    const ctx = fakeContext();
    const phase = gridPhase(layout, box.index);
    drawSynthetic(
      asCanvasContext(ctx),
      backdrop,
      { width: box.width, height: box.height },
      LIGHT_PAPER,
      1,
      undefined,
      phase,
    );
    for (let i = 0; i + 1 < ctx.ops.length; i++) {
      const a = ctx.ops[i];
      const b = ctx.ops[i + 1];
      if (a.op === "moveTo" && b.op === "lineTo" && a.y === b.y && a.x !== b.x) {
        ys.push(box.y + a.y);
      }
    }
  }
  return ys.sort((a, b) => a - b);
}

function gaps(ys: number[]): number[] {
  return ys.slice(1).map((y, i) => Math.round(y - ys[i]));
}

describe("patternStart", () => {
  it("starts one pitch in on a page of its own and on the first page", () => {
    expect(patternStart(28, undefined)).toBe(28);
    expect(patternStart(28, 0)).toBe(28);
  });
  it("continues the run's pattern on a later page", () => {
    // 1448 = 51 * 28 + 20: the next line lies 8 px into page two.
    expect(patternStart(28, 1448)).toBe(8);
    // A page that is a whole number of squares: the line on the join is drawn.
    expect(patternStart(28, 1400)).toBe(0);
  });
});

describe("gridPhase", () => {
  it("is the page's offset from the first page, only when joined", () => {
    const joined = layoutPages(pages(2), { joined: true });
    expect(gridPhase(joined, 0)).toEqual({ x: 0, y: 0 });
    expect(gridPhase(joined, 1)).toEqual({ x: 0, y: 1448 });
    expect(gridPhase(layoutPages(pages(2)), 1)).toBeUndefined();
  });
});

describe("squared paper on joined pages", () => {
  it("keeps every square the same size over the join", () => {
    for (const kind of ["squared", "ruled-narrow"] as const) {
      const ys = stackYs({ kind }, true);
      expect(new Set(gaps(ys))).toEqual(new Set([28]));
    }
  });
});
