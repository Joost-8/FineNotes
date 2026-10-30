import { describe, expect, it } from "vitest";
import { pagesAhead } from "../../src/canvas/look-ahead";
import type { PageBox } from "../../src/canvas/page-layout";

/** A column of A4 notebook pages (1024 x 1448 page px) with 24 px between them. */
const column: PageBox[] = Array.from({ length: 65 }, (_, index) => ({
  index,
  id: `p${index}`,
  x: 0,
  y: index * (1448 + 24),
  width: 1024,
  height: 1448,
}));
const ids = (boxes: PageBox[]) => boxes.map((box) => box.index);

describe("the pages a scroll shows next (FineNotes#80)", () => {
  // At 55% on an iPad, a 1180 CSS px tall view is 2770 layout px: about two pages.
  const view = { minX: -400, minY: 10 * 1472 + 100, maxX: 1500, maxY: 10 * 1472 + 2870 };

  it("lists the pages within one and a half screens, none on screen", () => {
    const near = ids(pagesAhead(column, view, { x: 0, y: 0 }));
    // Pages 10 and 11 are on screen.
    for (const index of [10, 11]) expect(near).not.toContain(index);
    // 4155 layout px either way: pages 7-9 above, 12-14 below.
    expect([...near].sort((a, b) => a - b)).toEqual([7, 8, 9, 12, 13, 14]);
  });

  it("puts the ones the view moves towards first", () => {
    // Page 12 is 74 px below the view, page 9 124 px above, page 13 1546 below.
    expect(ids(pagesAhead(column, view, { x: 0, y: 40 })).slice(0, 3)).toEqual([12, 9, 13]);
    expect(ids(pagesAhead(column, view, { x: 0, y: -40 })).slice(0, 3)).toEqual([9, 12, 8]);
    // Further ahead beats as far behind.
    const down = ids(pagesAhead(column, view, { x: 0, y: 40 }));
    expect(down.indexOf(13)).toBeLessThan(down.indexOf(8));
    const up = ids(pagesAhead(column, view, { x: 0, y: -40 }));
    expect(up.indexOf(8)).toBeLessThan(up.indexOf(13));
  });

  it("works across for pages in a row", () => {
    const row: PageBox[] = column.slice(0, 8).map((box, i) => ({ ...box, x: i * 1048, y: 0 }));
    const near = pagesAhead(
      row,
      { minX: 3 * 1048, minY: 0, maxX: 4 * 1048 - 24, maxY: 1448 },
      {
        x: 30,
        y: 0,
      },
    );
    // Page 4 starts 24 px right of the view; page 2 ends 24 px left of it.
    expect(ids(near).slice(0, 2)).toEqual([4, 2]);
    expect(ids(near)).not.toContain(3);
  });

  it("asks for nothing for an empty or meaningless view", () => {
    expect(pagesAhead(column, { minX: 0, minY: 0, maxX: 0, maxY: 100 }, { x: 0, y: 0 })).toEqual(
      [],
    );
    expect(pagesAhead(column, { minX: 0, minY: NaN, maxX: 10, maxY: 100 }, { x: 0, y: 0 })).toEqual(
      [],
    );
  });
});
