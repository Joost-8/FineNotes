import { expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/settings-data";
import type { WritingGuideStyle } from "../../src/model/writing-guides";

vi.mock("obsidian", () => import("./fake-obsidian"));

const { bindWritingGuides } = await import("../../src/view/writing-guides");

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
