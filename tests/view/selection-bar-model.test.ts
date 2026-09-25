/**
 * `src/view/selection-bar-model.ts` — what the selection's action bar and
 * its "…" menu show, and where the bar floats.
 */

import { describe, expect, it } from "vitest";
import {
  type SelectionAction,
  actionsKey,
  barItems,
  isEnabled,
  menuLayout,
  placeFloating,
} from "../../src/view/selection-bar-model";

function action(id: string, extra: Partial<SelectionAction> = {}): SelectionAction {
  return { id, icon: id, label: id, group: "edit", ...extra };
}

const ids = (items: ReadonlyArray<{ kind: string; action?: SelectionAction }>): string[] =>
  items.map((item) => (item.kind === "action" ? (item.action?.id ?? "?") : item.kind));

describe("barItems", () => {
  it("shows today's bar: Duplicate, Delete, then …", () => {
    const items = barItems([
      action("duplicate", { bar: true }),
      action("delete", { bar: true, destructive: true }),
      action("colour", { group: "style", swatches: { colors: [], current: null, pick: () => {} } }),
    ]);
    expect(ids(items)).toEqual(["duplicate", "delete", "more"]);
  });

  it("puts a divider between groups, in first-seen order, and none around empty groups", () => {
    const items = barItems([
      action("crop", { group: "image", bar: true }),
      action("copy", { group: "clipboard", menu: "row" }),
      action("cut", { group: "edit", bar: true }),
      action("delete", { group: "edit", bar: true }),
      action("front", { group: "order", bar: true, menu: "tile" }),
    ]);
    expect(ids(items)).toEqual(["crop", "divider", "cut", "delete", "divider", "front", "more"]);
  });

  it("leaves out … when nothing goes in the menu", () => {
    expect(ids(barItems([action("delete", { bar: true, menu: "none" })]))).toEqual(["delete"]);
    expect(barItems([])).toEqual([]);
  });

  it("never puts a swatch row in the bar", () => {
    const swatches = { colors: ["#000"], current: null, pick: () => {} };
    expect(ids(barItems([action("colour", { bar: true, swatches, menu: "none" })]))).toEqual([]);
  });
});

describe("menuLayout", () => {
  it("puts tiles across the top and rows below, grouped by dividers", () => {
    const swatches = { colors: ["#000"], current: null, pick: () => {} };
    const layout = menuLayout([
      action("cut", { group: "a", menu: "tile" }),
      action("front", { group: "a", menu: "tile" }),
      action("copy", { group: "b" }),
      action("duplicate", { group: "b", bar: true }),
      action("delete", { group: "b", bar: true, menu: "none" }),
      action("colour", { group: "c", swatches }),
      action("lock", { group: "d", enabled: false }),
    ]);
    expect(layout.tiles.map((a) => a.id)).toEqual(["cut", "front"]);
    expect(ids(layout.rows)).toEqual(["copy", "duplicate", "divider", "colour", "divider", "lock"]);
  });

  it("groups a row by its menu group when it has one (a picture's bar and menu)", () => {
    const actions = [
      action("crop", { group: "image", bar: true, menu: "none" }),
      action("cut", { bar: true, menu: "tile" }),
      action("front", { menu: "tile" }),
      action("copy"),
      action("duplicate", { bar: true }),
      action("lock"),
      action("crop-image", { group: "crop" }),
      action("delete", { bar: true, destructive: true, menuGroup: "delete" }),
    ];
    expect(ids(barItems(actions))).toEqual([
      "crop",
      "divider",
      "cut",
      "duplicate",
      "delete",
      "more",
    ]);
    const layout = menuLayout(actions);
    expect(layout.tiles.map((a) => a.id)).toEqual(["cut", "front"]);
    expect(ids(layout.rows)).toEqual([
      "copy",
      "duplicate",
      "lock",
      "divider",
      "crop-image",
      "divider",
      "delete",
    ]);
    const moved = actions.map((a) => (a.id === "delete" ? { ...a, menuGroup: undefined } : a));
    expect(actionsKey(moved)).not.toBe(actionsKey(actions));
  });

  it("keeps swatches out of the tile strip", () => {
    const swatches = { colors: ["#000"], current: null, pick: () => {} };
    expect(menuLayout([action("colour", { menu: "tile", swatches })]).tiles).toEqual([]);
  });
});

describe("actionsKey", () => {
  it("changes when anything drawn changes, and only then", () => {
    const run = (): void => {};
    const a = [action("delete", { bar: true, run })];
    expect(actionsKey(a)).toBe(actionsKey([action("delete", { bar: true, run: () => {} })]));
    expect(actionsKey(a)).not.toBe(actionsKey([action("delete", { bar: true, enabled: false })]));
    expect(actionsKey(a)).not.toBe(actionsKey([action("delete", { bar: false })]));
    const pick = (): void => {};
    const red = [action("colour", { swatches: { colors: ["#f00"], current: "#f00", pick } })];
    const none = [action("colour", { swatches: { colors: ["#f00"], current: null, pick } })];
    expect(actionsKey(red)).not.toBe(actionsKey(none));
  });

  it("reads enabled as on unless it is false", () => {
    expect(isEnabled(action("a"))).toBe(true);
    expect(isEnabled(action("a", { enabled: true }))).toBe(true);
    expect(isEnabled(action("a", { enabled: false }))).toBe(false);
  });
});

describe("placeFloating", () => {
  const visible = { minX: 0, minY: 0, maxX: 1000, maxY: 800 };
  const size = { w: 200, h: 50 };
  const opts = { gap: 10, margin: 8 };

  it("floats centred above the anchor", () => {
    const at = placeFloating({ minX: 400, minY: 300, maxX: 600, maxY: 400 }, size, visible, opts);
    expect(at).toEqual({ x: 400, y: 240, below: false });
  });

  it("keeps clear of a handle above the anchor", () => {
    const at = placeFloating({ minX: 400, minY: 300, maxX: 600, maxY: 400 }, size, visible, {
      ...opts,
      clearAbove: 60,
    });
    expect(at.y).toBe(180);
  });

  it("flips below when there is no room above", () => {
    const at = placeFloating({ minX: 400, minY: 40, maxX: 600, maxY: 400 }, size, visible, {
      ...opts,
      clearBelow: 5,
    });
    expect(at).toEqual({ x: 400, y: 415, below: true });
  });

  it("pins itself on screen when the anchor fills it", () => {
    const at = placeFloating(
      { minX: -50, minY: -100, maxX: 1200, maxY: 1000 },
      size,
      visible,
      opts,
    );
    expect(at).toEqual({ x: 475, y: 8, below: false });
  });

  it("slides sideways to stay on screen", () => {
    expect(placeFloating({ minX: 0, minY: 300, maxX: 20, maxY: 320 }, size, visible, opts).x).toBe(
      8,
    );
    expect(
      placeFloating({ minX: 980, minY: 300, maxX: 1000, maxY: 320 }, size, visible, opts).x,
    ).toBe(792);
    // Wider than the screen: pinned to the left margin.
    expect(
      placeFloating(
        { minX: 400, minY: 300, maxX: 600, maxY: 320 },
        { w: 2000, h: 50 },
        visible,
        opts,
      ).x,
    ).toBe(8);
  });

  it("can prefer below, as a menu dropping from its button does", () => {
    const anchor = { minX: 480, minY: 100, maxX: 520, maxY: 140 };
    const menu = { w: 240, h: 300 };
    expect(placeFloating(anchor, menu, visible, { ...opts, prefer: "below" })).toEqual({
      x: 380,
      y: 150,
      below: true,
    });
    const low = { minX: 480, minY: 600, maxX: 520, maxY: 640 };
    expect(placeFloating(low, menu, visible, { ...opts, prefer: "below" })).toEqual({
      x: 380,
      y: 290,
      below: false,
    });
    // No room either side: pinned inside, still on the preferred side.
    const tall = { w: 240, h: 700 };
    expect(placeFloating(low, tall, visible, { ...opts, prefer: "below" })).toEqual({
      x: 380,
      y: 92,
      below: true,
    });
  });
});
