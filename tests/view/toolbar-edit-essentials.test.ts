/**
 * `src/view/toolbar-edit.ts` — New pen tried while Essentials is on marks
 * the Essentials switch and says why, since Essentials keeps the bar's
 * layout and no pen button can be added.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("obsidian", () => import("./fake-obsidian"));
const { ToolbarEditor } = await import("../../src/view/toolbar-edit");

interface Switch {
  classes: Set<string>;
  attrs: Record<string, string>;
  offsetWidth: number;
  addClass(c: string): void;
  removeClass(c: string): void;
  setAttribute(name: string, value: string): void;
}

function fakeSwitch(): Switch {
  const el: Switch = {
    classes: new Set(),
    attrs: {},
    offsetWidth: 0,
    addClass: (c) => el.classes.add(c),
    removeClass: (c) => el.classes.delete(c),
    setAttribute: (name, value) => (el.attrs[name] = value),
  };
  return el;
}

interface Host {
  presetSwitch: Switch | null;
  markPresetBlocksPen(): void;
}

afterEach(() => vi.unstubAllGlobals());

describe("New pen while Essentials is on", () => {
  it("marks the Essentials switch, says why, and nudges it once", () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { setTimeout: (f: () => void, ms: number) => setTimeout(f, ms) });
    const editor = Object.create(ToolbarEditor.prototype) as Host;
    const sw = fakeSwitch();
    editor.presetSwitch = sw;
    editor.markPresetBlocksPen();
    expect(sw.classes.has("is-blocking")).toBe(true);
    expect(sw.classes.has("is-nudged")).toBe(true);
    expect(sw.attrs["aria-label"]).toBe("Turn off Essentials to add a pen");
    vi.advanceTimersByTime(600);
    expect(sw.classes.has("is-nudged")).toBe(false);
    expect(sw.classes.has("is-blocking")).toBe(true);
    vi.useRealTimers();
  });

  it("does nothing without an Essentials switch", () => {
    const editor = Object.create(ToolbarEditor.prototype) as Host;
    editor.presetSwitch = null;
    expect(() => editor.markPresetBlocksPen()).not.toThrow();
  });
});
