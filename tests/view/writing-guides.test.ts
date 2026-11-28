import { expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/settings-data";
import type { WritingGuideStyle } from "../../src/model/writing-guides";

vi.mock("obsidian", () => import("./fake-obsidian"));

const { bindWritingGuides } = await import("../../src/view/writing-guides");
const { Toolbar } = await import("../../src/view/toolbar");

function bind(settings: typeof DEFAULT_SETTINGS, path: string, save = vi.fn()) {
  const shown: Array<WritingGuideStyle | null> = [];
  const changed = vi.fn();
  const binding = bindWritingGuides({
    settings,
    save,
    path: () => path,
    apply: (style) => shown.push(style),
    changed,
  });
  return { binding, shown, changed, save };
}

it("keeps guides per notebook: turning one on leaves another off", () => {
  const settings = { ...DEFAULT_SETTINGS };
  const a = bind(settings, "A.md");
  const b = bind(settings, "B.md");
  expect(a.shown).toEqual([null]);

  a.binding.toggle();
  expect(a.binding.on()).toBe(true);
  expect(b.binding.on()).toBe(false);
  expect(a.shown.at(-1)).not.toBeNull();
  // B heard nothing: only views of A follow A.
  expect(b.shown).toEqual([null]);
  expect(a.save).toHaveBeenCalledOnce();
});

it("follows every view of one notebook (its view and its inline blocks)", () => {
  const settings = { ...DEFAULT_SETTINGS };
  const view = bind(settings, "A.md");
  const block = bind(settings, "A.md");
  view.binding.toggle();
  expect(block.binding.on()).toBe(true);
  expect(block.shown.at(-1)).not.toBeNull();
  expect(block.changed).toHaveBeenCalledTimes(2);
  block.binding.dispose();
  view.binding.toggle();
  expect(block.changed).toHaveBeenCalledTimes(2);
});

it("a new notebook starts in the look chosen last", () => {
  const settings = { ...DEFAULT_SETTINGS };
  const a = bind(settings, "A.md");
  settings.writingGuideNotebooks = { "A.md": { on: true, spacing: 64 } };
  a.binding.toggle();
  a.binding.toggle();
  expect(a.shown.at(-1)?.spacing).toBe(64);

  const b = bind(settings, "B.md");
  b.binding.toggle();
  expect(b.shown.at(-1)?.spacing).toBe(64);
});

it("shows a notebook's guides once its file loads, after binding with none (the view opens first)", () => {
  const settings = { ...DEFAULT_SETTINGS, writingGuideNotebooks: { "A.md": { on: true } } };
  let path: string | null = null;
  const shown: Array<WritingGuideStyle | null> = [];
  const binding = bindWritingGuides({
    settings,
    save: vi.fn(),
    path: () => path,
    apply: (style) => shown.push(style),
    changed: vi.fn(),
  });
  expect(shown).toEqual([null]);
  path = "A.md";
  binding.sync();
  expect(binding.on()).toBe(true);
  expect(shown.at(-1)).not.toBeNull();
  // Another file in the same tab: its own guides, not A's.
  path = "B.md";
  binding.sync();
  expect(shown.at(-1)).toBeNull();
});

it("opens the guides popover from the right caret strip when horizontal and bottom strip when upright", () => {
  interface MiniEl {
    classes: Set<string>;
    listeners: Map<string, Array<(e: unknown) => void>>;
    createEl: () => MiniEl;
    createSpan: () => MiniEl;
    setAttr: () => void;
    setAttribute: () => void;
    addClass: (c: string) => void;
    hasClass: (c: string) => boolean;
    addEventListener: (t: string, fn: (e: unknown) => void) => void;
    querySelector: () => null;
    empty: () => void;
    setText: () => void;
    getBoundingClientRect: () => DOMRect;
    click: (e: { detail: number; clientX: number; clientY: number }) => void;
  }
  const makeEl = (): MiniEl => {
    const classes = new Set<string>();
    const listeners = new Map<string, Array<(e: unknown) => void>>();
    const el: MiniEl = {
      classes,
      listeners,
      createEl: () => makeEl(),
      createSpan: () => makeEl(),
      setAttr: () => undefined,
      setAttribute: () => undefined,
      addClass: (c) => {
        classes.add(c);
      },
      hasClass: (c) => classes.has(c),
      addEventListener: (t, fn) => {
        const list = listeners.get(t) ?? [];
        list.push(fn);
        listeners.set(t, list);
      },
      querySelector: () => null,
      empty: () => undefined,
      setText: () => undefined,
      getBoundingClientRect: () =>
        ({ left: 0, top: 0, right: 58, bottom: 58, width: 58, height: 58 }) as DOMRect,
      click: (e) => {
        for (const fn of listeners.get("click") ?? []) fn(e);
      },
    };
    return el;
  };

  type FakeBar = Record<string, unknown>;
  const makeBar = (barDock: "top" | "bottom" | "left" | "right") => {
    const onWritingGuides = vi.fn();
    const toggleGuidesPopover = vi.fn();
    const closePopover = vi.fn();
    const bar: FakeBar = Object.assign(Object.create(Toolbar.prototype), {
      barDock,
      callbacks: { onWritingGuides },
      toggleGuidesPopover,
      closePopover,
      fold: vi.fn(),
    });
    const parent = makeEl();
    const button = (
      Toolbar.prototype as unknown as {
        addGuidesButton(p: unknown): MiniEl;
      }
    ).addGuidesButton.call(bar, parent);
    return { button, onWritingGuides, toggleGuidesPopover, closePopover };
  };

  // Horizontal (top): while on, right edge opens popover; left/body toggles off.
  const horiz = makeBar("top");
  horiz.button.addClass("is-on");
  horiz.button.click({ detail: 1, clientX: 52, clientY: 20 });
  expect(horiz.toggleGuidesPopover).toHaveBeenCalledOnce();
  expect(horiz.onWritingGuides).not.toHaveBeenCalled();

  horiz.button.click({ detail: 1, clientX: 20, clientY: 20 });
  expect(horiz.onWritingGuides).toHaveBeenCalledOnce();

  // Upright (left): while on, bottom strip opens popover; upper/right area toggles off.
  const upright = makeBar("left");
  upright.button.addClass("is-on");
  upright.button.click({ detail: 1, clientX: 20, clientY: 52 });
  expect(upright.toggleGuidesPopover).toHaveBeenCalledOnce();
  expect(upright.onWritingGuides).not.toHaveBeenCalled();

  upright.button.click({ detail: 1, clientX: 52, clientY: 20 });
  expect(upright.onWritingGuides).toHaveBeenCalledOnce();

  // Keyboard activation (detail === 0) always toggles guides instead of opening popover.
  upright.button.click({ detail: 0, clientX: 20, clientY: 52 });
  expect(upright.onWritingGuides).toHaveBeenCalledTimes(2);
  expect(upright.toggleGuidesPopover).toHaveBeenCalledOnce();
});
