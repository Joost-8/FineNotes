/**
 * `src/view/toolbar-layout.ts`: which items the tool bar shows, which wait
 * in its accessories menu, and which are not shown at all.
 */

import { describe, expect, it } from "vitest";
import {
  ALWAYS_SHOWN,
  BAR_ITEMS,
  BAR_ITEM_LABELS,
  DEFAULT_BAR,
  barItemOfTool,
  defaultLayout,
  effectsOfOffItems,
  isItemOff,
  dropIndex,
  hiddenItems,
  menuItems,
  moveItem,
  normalizeBar,
  normalizeLayout,
  placeItem,
  placeOf,
  sameBar,
  sameLayout,
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
  it("leaves the hand, magnifier, Stylus-only mode, stickers and the rest to the menu", () => {
    expect(hiddenItems(DEFAULT_BAR)).toEqual([
      "pan",
      "zoom",
      "stylus",
      "sticker",
      "sticky",
      "ruler",
      "record",
      "fill",
    ]);
  });

  it("names every item", () => {
    for (const id of BAR_ITEMS) expect(BAR_ITEM_LABELS[id].length).toBeGreaterThan(0);
  });
});

describe("normalizeLayout", () => {
  it("reads a layout stored before items could be off: every hidden item is in the menu", () => {
    const layout = normalizeLayout(["pen", "sticky", "select", "ruler"], undefined);
    expect(layout).toEqual({ bar: ["pen", "sticky", "select", "ruler"], off: [] });
    expect(menuItems(layout)).toEqual(hiddenItems(layout.bar));
    expect(placeOf(layout, "eraser")).toBe("menu");
  });

  it("is the default layout for a new install", () => {
    expect(normalizeLayout(undefined, undefined)).toEqual(defaultLayout());
    expect(defaultLayout()).toEqual({ bar: DEFAULT_BAR, off: [] });
  });

  it("drops unknown items, repeats, the pen and items on the bar from off", () => {
    const layout = normalizeLayout(
      ["pen", "eraser"],
      ["record", "nope", 7, "pen", "eraser", "pan", "record"],
    );
    expect(layout.off).toEqual(["pan", "record"]);
  });

  it("keeps off in catalogue order, and copes with a damaged value", () => {
    expect(normalizeLayout(DEFAULT_BAR, ["record", "zoom"]).off).toEqual(["zoom", "record"]);
    expect(normalizeLayout(DEFAULT_BAR, "record").off).toEqual([]);
  });
});

describe("three places", () => {
  it("starts the hand, magnifier and Stylus only in the menu", () => {
    const layout = defaultLayout();
    for (const id of ["pan", "zoom", "stylus"] as const) expect(placeOf(layout, id)).toBe("menu");
    expect(placeOf(layout, "pen")).toBe("bar");
  });

  it("moves an item from the bar to the menu, and lists it in catalogue order", () => {
    const layout = placeItem(defaultLayout(), "eraser", "menu");
    expect(layout.bar).not.toContain("eraser");
    expect(menuItems(layout)).toEqual([
      "eraser",
      "pan",
      "zoom",
      "stylus",
      "sticker",
      "sticky",
      "ruler",
      "record",
      "fill",
    ]);
  });

  it("takes an item out of the menu without putting it on the bar", () => {
    const layout = placeItem(defaultLayout(), "record", "off");
    expect(placeOf(layout, "record")).toBe("off");
    expect(menuItems(layout)).not.toContain("record");
    expect(layout.bar).toEqual(DEFAULT_BAR);
  });

  it("puts an item on the bar at its right end, from the menu or from off", () => {
    expect(placeItem(defaultLayout(), "sticky", "bar").bar.at(-1)).toBe("sticky");
    const off = placeItem(defaultLayout(), "zoom", "off");
    const shown = placeItem(off, "zoom", "bar");
    expect(shown.bar.at(-1)).toBe("zoom");
    expect(shown.off).toEqual([]);
  });

  it("takes an item off the bar straight to off", () => {
    const layout = placeItem(defaultLayout(), "pdf", "off");
    expect(layout.bar).not.toContain("pdf");
    expect(layout.off).toEqual(["pdf"]);
  });

  it("never moves the pen, and leaves an item already in place where it is", () => {
    expect(placeItem(defaultLayout(), ALWAYS_SHOWN, "off")).toEqual(defaultLayout());
    expect(placeItem(defaultLayout(), ALWAYS_SHOWN, "menu")).toEqual(defaultLayout());
    const moved = moveItem(DEFAULT_BAR, 0, 3);
    expect(placeItem({ bar: moved, off: [] }, "select", "bar").bar).toEqual(moved);
  });

  it("does not change the layout it was given", () => {
    const layout = defaultLayout();
    placeItem(layout, "pan", "bar");
    placeItem(layout, "eraser", "off");
    expect(layout).toEqual(defaultLayout());
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

describe("sameLayout", () => {
  it("compares the bar and what is off", () => {
    expect(sameLayout(defaultLayout(), defaultLayout())).toBe(true);
    expect(sameLayout(defaultLayout(), placeItem(defaultLayout(), "record", "off"))).toBe(false);
    expect(sameLayout(defaultLayout(), placeItem(defaultLayout(), "record", "bar"))).toBe(false);
  });
});

describe("an item shown nowhere has nothing left on", () => {
  const nothing = {
    tool: "pen",
    onlyStylus: false,
    rulerOut: false,
    recording: false,
    stickyArmed: false,
  };
  const everything = {
    tool: "eraser",
    onlyStylus: true,
    rulerOut: true,
    recording: true,
    stickyArmed: true,
  };
  const none = { pen: false, onlyStylus: false, ruler: false, recording: false, sticky: false };

  it("ends every effect whose item is off", () => {
    const layout = {
      bar: ["pen"],
      off: ["eraser", "stylus", "ruler", "record", "sticky"],
    } as never;
    expect(effectsOfOffItems(layout, everything)).toEqual({
      pen: true,
      onlyStylus: true,
      ruler: true,
      recording: true,
      sticky: true,
    });
  });

  it("keeps what an item in the menu or on the bar turned on: its button still shows it", () => {
    // Nothing off: the menu and the bar both still reach every item.
    expect(effectsOfOffItems(defaultLayout(), everything)).toEqual(none);
    expect(effectsOfOffItems({ bar: ["pen", "eraser"], off: [] }, everything)).toEqual(none);
  });

  it("ends nothing that is not on, and never takes the pen away", () => {
    const layout = { bar: ["pen"], off: ["stylus", "ruler", "record", "sticky"] } as never;
    expect(effectsOfOffItems(layout, nothing)).toEqual(none);
    // The highlighter and the laser are the pen's, which is never off.
    const allOff = { bar: ["pen"], off: BAR_ITEMS.filter((id) => id !== "pen") } as never;
    expect(effectsOfOffItems(allOff, { ...nothing, tool: "highlighter" }).pen).toBe(false);
    expect(effectsOfOffItems(allOff, { ...nothing, tool: "laser" }).pen).toBe(false);
  });

  it("knows each tool's item, and which items are off", () => {
    expect(barItemOfTool("select")).toBe("select");
    expect(barItemOfTool("zoom")).toBe("zoom");
    expect(barItemOfTool("highlighter")).toBe("pen");
    expect(barItemOfTool("nonsense")).toBeNull();
    const layout = { bar: ["pen"], off: ["stylus"] } as never;
    expect(isItemOff(layout, "stylus")).toBe(true);
    expect(isItemOff(layout, "ruler")).toBe(false);
  });
});
