/**
 * `src/view/toolbar.ts` — a switch row in a popover flips on every tap and
 * shows it, also in a popover that does not redraw after a change (the
 * table picker's Header row).
 */

import { describe, expect, it, vi } from "vitest";
vi.mock("obsidian", () => import("./fake-obsidian"));
const { Toolbar } = await import("../../src/view/toolbar");

/** Just enough of an element for `switchRow`. */
function fakeRow() {
  const classes = new Set<string>();
  const attrs: Record<string, string> = {};
  let click: (() => void) | undefined;
  const span = { createSpan: () => span };
  const row = {
    createSpan: () => span,
    toggleClass: (cls: string, on: boolean) => (on ? classes.add(cls) : classes.delete(cls)),
    setAttribute: (name: string, value: string) => (attrs[name] = value),
    addEventListener: (_type: string, handler: () => void) => (click = handler),
  };
  return {
    parent: { createEl: () => row },
    tap: () => click?.(),
    on: () => classes.has("is-on"),
    attrs,
  };
}

describe("switch rows", () => {
  it("flip and show it on each tap, without the popover redrawing", () => {
    const toolbar = Object.create(Toolbar.prototype) as {
      switchRow(
        parent: unknown,
        label: string,
        on: boolean,
        change: (on: boolean) => void,
      ): unknown;
    };
    const el = fakeRow();
    const changes: boolean[] = [];
    toolbar.switchRow(el.parent, "Header row", false, (on) => changes.push(on));
    expect(el.on()).toBe(false);
    el.tap();
    expect(el.on()).toBe(true);
    expect(el.attrs["aria-checked"]).toBe("true");
    el.tap();
    expect(el.on()).toBe(false);
    expect(el.attrs["aria-checked"]).toBe("false");
    expect(changes).toEqual([true, false]);
  });
});
