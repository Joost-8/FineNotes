import { describe, expect, it, vi } from "vitest";
import {
  inlineLayoutFrom,
  mergeInlineLayout,
  normalizeLayout,
  type ToolbarLayout,
} from "../../src/view/toolbar-layout";

vi.mock("obsidian", () => import("./fake-obsidian"));
vi.mock("../../CHANGELOG.md", () => ({ default: "" }));

const { default: GoodObsidianPlugin } = await import("../../src/main");

describe("inline toolbar layout merging and preset persistence", () => {
  it("keeps pinned pen slots alongside inline items in inlineLayoutFrom", () => {
    const savedPens = new Set(["pen1"]);
    const raw: ToolbarLayout = {
      start: ["thumbnails", "undo", "redo"],
      middle: ["pen", "pen:fountain", "saved:pen1", "eraser", "record"],
      end: ["calculator", "guides"],
      off: ["accessories"],
    };
    const inline = inlineLayoutFrom(raw, savedPens);
    expect(inline.start).toEqual(["undo", "redo"]);
    expect(inline.middle).toContain("pen");
    expect(inline.middle).toContain("pen:fountain");
    expect(inline.middle).toContain("saved:pen1");
    expect(inline.middle).toContain("eraser");
    expect(inline.middle).not.toContain("record");
    expect(inline.end).toEqual(["guides"]);
  });

  it("preserves notebook-only buttons across unchanged and edited zones", () => {
    const full: ToolbarLayout = {
      start: ["thumbnails", "undo", "redo", "home", "guides"],
      middle: ["pen", "eraser", "record", "shape"],
      end: ["calculator", "ruler"],
      off: ["search"],
    };
    // User reordered `middle`, leaving `start` and `end` untouched.
    const edited: ToolbarLayout = {
      start: ["undo", "redo", "guides"],
      middle: ["shape", "pen", "eraser"],
      end: ["ruler"],
      off: [],
    };
    const merged = mergeInlineLayout(full, edited);
    // Unchanged `start` keeps `thumbnails` and `home` in their exact positions.
    expect(merged.start).toEqual(["thumbnails", "undo", "redo", "home", "guides"]);
    // Edited `middle` replaces inline slots in place while keeping `record` in position.
    expect(merged.middle).toEqual(["shape", "pen", "record", "eraser"]);
    // Unchanged `end` keeps `calculator` in place.
    expect(merged.end).toEqual(["calculator", "ruler"]);
    expect(merged.off).toEqual(["search"]);
  });

  it("saves to the explicitly targeted preset without clobbering the active preset", () => {
    const essentials = normalizeLayout({
      start: ["undo", "redo"],
      middle: ["pen", "eraser"],
      end: ["calculator"],
      off: [],
    });
    const own = normalizeLayout({
      start: ["undo"],
      middle: ["pen"],
      end: ["guides"],
      off: [],
    });
    const updatedEssentials = normalizeLayout({
      start: ["undo", "redo"],
      middle: ["eraser", "pen"],
      end: ["calculator"],
      off: [],
    });

    const setToolbarItems = vi.fn();
    const fakePlugin = {
      pillRow: false, // Active preset is now "own" (docked options turned off elsewhere).
      settings: {
        toolbarPreset: "essentials",
        toolbarEssentials: essentials,
        toolbarLayout: own,
        onlyStylusMode: false,
      },
      saveSettings: vi.fn(() => Promise.resolve()),
      openNotebooks: () => [{ setToolbarItems }],
      setOnlyStylusMode: vi.fn(() => Promise.resolve()),
    };

    // Stale inline editor mounted under "essentials" saves back to "essentials".
    GoodObsidianPlugin.prototype.saveToolbarLayout.call(
      fakePlugin,
      updatedEssentials,
      "essentials",
    );

    expect(fakePlugin.settings.toolbarEssentials).toEqual(updatedEssentials);
    expect(fakePlugin.settings.toolbarLayout).toEqual(own);
    // Active preset differs from saved target, so open notebooks are not overwritten.
    expect(setToolbarItems).not.toHaveBeenCalled();
  });

  it("does not restore an intentionally tucked default Pen on unrelated inline edits", () => {
    const full = normalizeLayout({
      start: ["undo", "redo"],
      middle: ["pen:fountain", "eraser", "shape"],
      end: ["guides"],
      off: ["pen"],
    });
    const inline = inlineLayoutFrom(full, new Set());
    expect(inline.middle).not.toContain("pen");
    expect(inline.off).toContain("pen");

    // Unrelated inline edit (reorders eraser and shape).
    const edited: ToolbarLayout = {
      ...inline,
      middle: ["pen:fountain", "shape", "eraser"],
    };
    const merged = mergeInlineLayout(full, edited);
    expect(merged.middle).not.toContain("pen");
    expect(merged.off).toContain("pen");
  });
});
