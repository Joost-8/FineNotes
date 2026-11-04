/**
 * `src/view/toolbar-layout.ts`: where every button of the tool bar is, in
 * its three zones, the More tools menu, or out of sight.
 */

import { describe, expect, it } from "vitest";
import {
  BAR_ITEMS,
  BAR_ITEM_ICONS,
  BAR_ITEM_LABELS,
  PINNED,
  ZONES,
  barItemOfTool,
  barItems,
  defaultLayout,
  effectsOfOffItems,
  isItemOff,
  isPinned,
  menuItems,
  migrateLayout,
  moveTo,
  normalizeLayout,
  offItems,
  placeOf,
  sameLayout,
  slotAt,
  stepItem,
} from "../../src/view/toolbar-layout";

describe("the default layout", () => {
  it("is the bar as it was built before it could be customized", () => {
    expect(defaultLayout()).toEqual({
      start: ["home", "thumbnails", "search", "ai", "calculator", "undo", "redo"],
      middle: ["select", "pen", "eraser", "text", "shape", "image", "pdf", "accessories"],
      end: ["fullscreen", "addPage", "share", "more", "settings"],
      off: [],
    });
  });

  it("leaves the hand, magnifier, Stylus only, stickers and the rest to More tools", () => {
    expect(menuItems(defaultLayout())).toEqual([
      "pan",
      "zoom",
      "stylus",
      "sticker",
      "sticky",
      "ruler",
      "tape",
      "record",
      "fill",
    ]);
  });

  it("names every button and gives it an icon", () => {
    for (const id of BAR_ITEMS) {
      expect(BAR_ITEM_LABELS[id].length).toBeGreaterThan(0);
      expect(BAR_ITEM_ICONS[id].length).toBeGreaterThan(0);
    }
  });

  it("pins the pen, the toolbox and ⋯", () => {
    expect(Object.keys(PINNED).sort()).toEqual(["accessories", "more", "pen"]);
    expect(isPinned("pen")).toBe(true);
    expect(isPinned("undo")).toBe(false);
  });

  it("is a fresh copy each time", () => {
    const a = defaultLayout();
    a.start.push("pan");
    expect(defaultLayout().start).not.toContain("pan");
  });
});

describe("normalizeLayout", () => {
  it("gives the default layout for anything that is not an object", () => {
    for (const raw of [undefined, null, "pen", 3, ["pen"]]) {
      expect(normalizeLayout(raw)).toEqual(defaultLayout());
    }
  });

  it("keeps known buttons once across the zones, in their order", () => {
    const layout = normalizeLayout({
      start: ["undo", "nope", 7, "undo", "search"],
      middle: ["pen", "search", "eraser", "accessories"],
      end: ["more"],
      off: [],
    });
    expect(layout.start).toEqual(["undo", "search"]);
    expect(layout.middle).toEqual(["pen", "eraser", "accessories"]);
    expect(layout.end).toEqual(["more"]);
  });

  it("puts a lost pinned button back: the pen first in the middle, ⋯ last in the end", () => {
    const layout = normalizeLayout({ start: [], middle: ["eraser"], end: ["share"], off: ["pen"] });
    expect(layout.middle).toEqual(["pen", "eraser", "accessories"]);
    expect(layout.end).toEqual(["share", "more"]);
    expect(layout.off).toEqual([]);
  });

  it("keeps off in catalogue order, never a button on the bar", () => {
    const layout = normalizeLayout({
      start: ["undo"],
      middle: ["pen", "accessories"],
      end: ["more"],
      off: ["record", "undo", "pan", "record"],
    });
    expect(layout.off).toEqual(["pan", "record"]);
  });

  it("reads its own output back unchanged", () => {
    const layout = moveTo(defaultLayout(), "calculator", { zone: "middle", index: 3 });
    expect(normalizeLayout(JSON.parse(JSON.stringify(layout)))).toEqual(layout);
  });
});

describe("migrateLayout: the settings of 2.7 and before", () => {
  it("reads a default 2.7 vault as the default layout", () => {
    expect(migrateLayout(["select", "pen", "eraser", "text", "shape", "image", "pdf"], [])).toEqual(
      defaultLayout(),
    );
  });

  it("is the default layout for a vault that never customized anything", () => {
    expect(migrateLayout(undefined, undefined)).toEqual(defaultLayout());
  });

  it("keeps the tools a vault put on the bar, and what it hid", () => {
    const layout = migrateLayout(["pen", "sticky", "select", "ruler"], ["pan", "record"]);
    expect(layout.middle).toEqual(["pen", "sticky", "select", "ruler", "accessories"]);
    expect(layout.off).toEqual(["pan", "record"]);
    expect(layout.start).toEqual(defaultLayout().start);
    expect(layout.end).toEqual(defaultLayout().end);
  });

  it("moves the calculator out of the start when it was among the tools, in More tools or hidden", () => {
    const among = migrateLayout(["pen", "calculator"], []);
    expect(among.middle).toContain("calculator");
    expect(among.start).not.toContain("calculator");
    expect(placeOf(migrateLayout(["pen"], [], []), "calculator")).toBe("menu");
    expect(placeOf(migrateLayout(["pen"], ["calculator"], []), "calculator")).toBe("off");
    expect(placeOf(migrateLayout(["pen"], [], ["calculator"]), "calculator")).toBe("start");
  });
});

describe("places", () => {
  it("says where each button is", () => {
    const layout = defaultLayout();
    expect(placeOf(layout, "search")).toBe("start");
    expect(placeOf(layout, "pen")).toBe("middle");
    expect(placeOf(layout, "share")).toBe("end");
    expect(placeOf(layout, "pan")).toBe("menu");
    expect(placeOf(moveTo(layout, "pan", "off"), "pan")).toBe("off");
    expect(barItems(layout)).toHaveLength(20);
  });
});

describe("moveTo", () => {
  it("drops a button at a place in any zone, counting the zone without it", () => {
    const layout = moveTo(defaultLayout(), "calculator", { zone: "middle", index: 3 });
    expect(layout.middle.slice(0, 5)).toEqual(["select", "pen", "eraser", "calculator", "text"]);
    expect(layout.start).not.toContain("calculator");
    const back = moveTo(layout, "calculator", { zone: "middle", index: 1 });
    expect(back.middle.slice(0, 3)).toEqual(["select", "calculator", "pen"]);
  });

  it("clamps the index into the zone", () => {
    expect(moveTo(defaultLayout(), "pan", { zone: "end", index: 99 }).end.at(-1)).toBe("pan");
    expect(moveTo(defaultLayout(), "pan", { zone: "end", index: -4 }).end[0]).toBe("pan");
  });

  it("moves any button, undo and settings too, into More tools or out of sight, and back", () => {
    const menu = moveTo(defaultLayout(), "undo", "menu");
    expect(menuItems(menu)).toContain("undo");
    const off = moveTo(menu, "settings", "off");
    expect(offItems(off)).toEqual(["settings"]);
    expect(placeOf(moveTo(off, "settings", { zone: "end", index: 4 }), "settings")).toBe("end");
  });

  it("keeps a pinned button on the bar, though it can move along it", () => {
    for (const id of ["pen", "accessories", "more"] as const) {
      expect(moveTo(defaultLayout(), id, "off")).toEqual(defaultLayout());
      expect(moveTo(defaultLayout(), id, "menu")).toEqual(defaultLayout());
    }
    expect(placeOf(moveTo(defaultLayout(), "pen", { zone: "start", index: 0 }), "pen")).toBe(
      "start",
    );
  });

  it("does not change the layout it was given", () => {
    const layout = defaultLayout();
    moveTo(layout, "pan", { zone: "start", index: 0 });
    expect(layout).toEqual(defaultLayout());
  });
});

describe("stepItem: one place along the bar, as an arrow key moves it", () => {
  it("moves within a zone", () => {
    const layout = stepItem(defaultLayout(), "eraser", -1);
    expect(layout.middle.slice(0, 3)).toEqual(["select", "eraser", "pen"]);
    expect(stepItem(layout, "eraser", 1)).toEqual(defaultLayout());
  });

  it("crosses into the next zone at a zone's end, at its near end", () => {
    const left = stepItem(defaultLayout(), "select", -1);
    expect(left.start.at(-1)).toBe("select");
    const right = stepItem(defaultLayout(), "redo", 1);
    expect(right.middle[0]).toBe("redo");
    expect(stepItem(defaultLayout(), "accessories", 1).end[0]).toBe("accessories");
  });

  it("stops at the bar's two ends, and leaves buttons off the bar alone", () => {
    expect(stepItem(defaultLayout(), "home", -1)).toEqual(defaultLayout());
    expect(stepItem(defaultLayout(), "settings", 1)).toEqual(defaultLayout());
    expect(stepItem(defaultLayout(), "pan", 1)).toEqual(defaultLayout());
  });
});

describe("slotAt", () => {
  it("counts the buttons whose middles the drop passed", () => {
    expect(slotAt([10, 50, 90], 0)).toBe(0);
    expect(slotAt([10, 50, 90], 30)).toBe(1);
    expect(slotAt([10, 50, 90], 95)).toBe(3);
    expect(slotAt([], 40)).toBe(0);
  });
});

describe("sameLayout", () => {
  it("compares every zone, its order, and what is off", () => {
    expect(sameLayout(defaultLayout(), defaultLayout())).toBe(true);
    expect(sameLayout(defaultLayout(), stepItem(defaultLayout(), "eraser", -1))).toBe(false);
    expect(sameLayout(defaultLayout(), moveTo(defaultLayout(), "pan", "off"))).toBe(false);
    expect(ZONES).toEqual(["start", "middle", "end"]);
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
  const withOff = (off: string[]) => ({ ...defaultLayout(), off }) as never;

  it("ends every effect whose item is off", () => {
    expect(
      effectsOfOffItems(withOff(["eraser", "stylus", "ruler", "record", "sticky"]), everything),
    ).toEqual({ pen: true, onlyStylus: true, ruler: true, recording: true, sticky: true });
  });

  it("keeps what an item in the menu or on the bar turned on: its button still shows it", () => {
    expect(effectsOfOffItems(defaultLayout(), everything)).toEqual(none);
  });

  it("ends nothing that is not on, and never takes the pen away", () => {
    expect(effectsOfOffItems(withOff(["stylus", "ruler", "record", "sticky"]), nothing)).toEqual(
      none,
    );
    const allOff = withOff(BAR_ITEMS.filter((id) => id !== "pen"));
    expect(effectsOfOffItems(allOff, { ...nothing, tool: "highlighter" }).pen).toBe(false);
    expect(effectsOfOffItems(allOff, { ...nothing, tool: "laser" }).pen).toBe(false);
  });

  it("knows each tool's item, and which items are off", () => {
    expect(barItemOfTool("select")).toBe("select");
    expect(barItemOfTool("zoom")).toBe("zoom");
    expect(barItemOfTool("highlighter")).toBe("pen");
    expect(barItemOfTool("nonsense")).toBeNull();
    expect(isItemOff(withOff(["stylus"]), "stylus")).toBe(true);
    expect(isItemOff(withOff(["stylus"]), "ruler")).toBe(false);
  });
});
