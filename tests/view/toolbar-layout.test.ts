/**
 * `src/view/toolbar-layout.ts`: which items the tool bar shows and which wait
 * in its accessories menu.
 */

import { describe, expect, it } from "vitest";
import {
  ALWAYS_SHOWN,
  BAR_ITEMS,
  BAR_ITEM_LABELS,
  DEFAULT_BAR,
  dropIndex,
  hiddenItems,
  hideItem,
  moveItem,
  normalizeBar,
  sameBar,
  showItem,
} from "../../src/view/toolbar-layout";

describe("normalizeBar", () => {
  it("gives the default bar for anything that is not a list", () => {
    for (const raw of [undefined, null, "pen", 3, { pen: true }]) {
      expect(normalizeBar(raw)).toEqual(DEFAULT_BAR);
    }
  });

  it("keeps known items once, in their order", () => {
    expect(normalizeBar(["pen", "ruler", "nope", "ruler", 7, "select"])).toEqual([
      "pen",
      "ruler",
      "select",
    ]);
  });

  it("puts the pen back first when it went missing", () => {
    expect(normalizeBar(["eraser"])).toEqual(["pen", "eraser"]);
    expect(normalizeBar([])).toEqual(["pen"]);
  });

  it("does not hand back the default itself", () => {
    const bar = normalizeBar(undefined);
    bar.push("ruler");
    expect(DEFAULT_BAR).not.toContain("ruler");
  });
});

describe("the default bar", () => {
  it("leaves the hand, magnifier, Only stylus mode, stickers and the rest to the menu", () => {
    expect(hiddenItems(DEFAULT_BAR)).toEqual([
      "pan",
      "zoom",
      "stylus",
      "sticker",
      "sticky",
      "ruler",
      "record",
    ]);
  });

  it("names every item", () => {
    for (const id of BAR_ITEMS) expect(BAR_ITEM_LABELS[id].length).toBeGreaterThan(0);
  });
});

describe("hiding and showing", () => {
  it("hides an item, and lists it among the hidden in catalogue order", () => {
    const bar = hideItem(DEFAULT_BAR, "eraser");
    expect(bar).not.toContain("eraser");
    expect(hiddenItems(bar)).toEqual([
      "eraser",
      "pan",
      "zoom",
      "stylus",
      "sticker",
      "sticky",
      "ruler",
      "record",
    ]);
  });

  it("never hides the pen", () => {
    expect(hideItem(DEFAULT_BAR, ALWAYS_SHOWN)).toEqual(DEFAULT_BAR);
  });

  it("shows a hidden item at the right end, once", () => {
    expect(showItem(DEFAULT_BAR, "sticky").at(-1)).toBe("sticky");
    expect(showItem(DEFAULT_BAR, "pen")).toEqual(DEFAULT_BAR);
  });
});

describe("moveItem", () => {
  it("moves an item left and right", () => {
    expect(moveItem(["a", "b", "c"] as never, 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"] as never, 2, 0)).toEqual(["c", "a", "b"]);
  });

  it("clamps both ends into the list, and copes with an empty one", () => {
    expect(moveItem(["a", "b", "c"] as never, -4, 9)).toEqual(["b", "c", "a"]);
    expect(moveItem([], 0, 1)).toEqual([]);
  });
});

describe("dropIndex", () => {
  it("is the row the dragged row's middle is over, inside the list", () => {
    expect(dropIndex(10, 44, 5)).toBe(0);
    expect(dropIndex(100, 44, 5)).toBe(2);
    expect(dropIndex(-30, 44, 5)).toBe(0);
    expect(dropIndex(999, 44, 5)).toBe(4);
    expect(dropIndex(50, 0, 5)).toBe(0);
  });
});

describe("sameBar", () => {
  it("compares items and order", () => {
    expect(sameBar(["pen", "select"], ["pen", "select"])).toBe(true);
    expect(sameBar(["pen", "select"], ["select", "pen"])).toBe(false);
    expect(sameBar(["pen"], ["pen", "select"])).toBe(false);
  });
});
