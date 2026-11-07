/**
 * `src/view/toolbar-edit.ts` — Customize toolbar's Style and Colours rows:
 * one chip per look, the one worn checked, and a tap on another wears it.
 */

import { describe, expect, it, vi } from "vitest";
vi.mock("obsidian", () => import("./fake-obsidian"));
const { ToolbarEditor } = await import("../../src/view/toolbar-edit");
const { LOOK_PALETTES, LOOK_STYLES } = await import("../../src/model/look");

/** Just enough of an element for `lookShelf`. */
interface FakeEl {
  classes: Set<string>;
  attrs: Record<string, string>;
  children: FakeEl[];
  click?: () => void;
  createDiv(o?: { cls?: string; text?: string }): FakeEl;
  createSpan(o?: { cls?: string; text?: string }): FakeEl;
  createEl(tag: string, o?: { cls?: string; text?: string }): FakeEl;
  setAttribute(name: string, value: string): void;
  toggleClass(cls: string, on: boolean): void;
  addEventListener(type: string, handler: () => void): void;
}

function fakeEl(cls = ""): FakeEl {
  const el: FakeEl = {
    classes: new Set(cls.split(" ").filter(Boolean)),
    attrs: {},
    children: [],
    createDiv: (o) => add(o?.cls),
    createSpan: (o) => add(o?.cls),
    createEl: (_tag, o) => add(o?.cls),
    setAttribute: (name, value) => (el.attrs[name] = value),
    toggleClass: (c, on) => (on ? el.classes.add(c) : el.classes.delete(c)),
    addEventListener: (type, handler) => {
      if (type === "click") el.click = handler;
    },
  };
  const add = (c?: string): FakeEl => {
    const child = fakeEl(c);
    el.children.push(child);
    return child;
  };
  return el;
}

interface LookShelfHost {
  tray: FakeEl;
  lookShelf<T extends string>(
    name: string,
    ids: readonly T[],
    current: T,
    draw: (id: T, chip: FakeEl) => void,
    pick: (id: T) => void,
  ): void;
}

function shelfOf<T extends string>(ids: readonly T[], current: T) {
  const editor = Object.create(ToolbarEditor.prototype) as LookShelfHost;
  editor.tray = fakeEl();
  const picked: T[] = [];
  const drawn: T[] = [];
  editor.lookShelf(
    "Style",
    ids,
    current,
    (id) => drawn.push(id),
    (id) => picked.push(id),
  );
  const shelf = editor.tray.children[0];
  const chips = shelf.children[1].children;
  return { shelf, chips, picked, drawn };
}

describe("Customize toolbar's look rows", () => {
  it("draw a chip for every style, the one worn checked", () => {
    const { shelf, chips, drawn } = shelfOf(LOOK_STYLES, "soft");
    expect(shelf.classes.has("is-look")).toBe(true);
    expect(drawn).toEqual([...LOOK_STYLES]);
    const checked = chips.filter((c) => c.attrs["aria-checked"] === "true");
    expect(checked).toHaveLength(1);
    expect(chips[LOOK_STYLES.indexOf("soft")].classes.has("is-active")).toBe(true);
    expect(chips.every((c) => c.attrs.role === "radio")).toBe(true);
  });

  it("wear another look on a tap, and do nothing for the one worn", () => {
    const { chips, picked } = shelfOf(LOOK_PALETTES, "obsidian");
    chips[0].click?.();
    chips[LOOK_PALETTES.indexOf("nord")].click?.();
    expect(picked).toEqual(["nord"]);
  });
});
