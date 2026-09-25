import { describe, expect, it, vi } from "vitest";
import { MARKDOWN_VIEW_TYPE, ViewRouter, isInkNote, showAs } from "../../src/view/view-routing";
import { VIEW_TYPE_INK } from "../../src/constants";

const none = (): null => null;

describe("isInkNote", () => {
  it.each([
    ["Physics.notebook.md"],
    ["Sketch.page.md"],
    ["Old.ink.md"],
    ["LOUD.Notebook.MD"],
    [".notebook.md"],
  ])("knows %s by its name", (name) => {
    const frontmatter = vi.fn(none);
    expect(isInkNote("md", name, frontmatter)).toBe(true);
    expect(frontmatter).not.toHaveBeenCalled();
  });

  it("needs a Markdown file", () => {
    expect(isInkNote("canvas", "Physics.notebook.canvas", () => ({ goodobsidian: true }))).toBe(
      false,
    );
    expect(isInkNote("MD", "Physics.notebook.MD", none)).toBe(false);
    expect(isInkNote("pdf", "Physics.notebook.md.pdf", none)).toBe(false);
  });

  it.each([
    [{ goodobsidian: true }, true],
    [{ inkedmark: true }, true],
    [{ goodobsidian: false, inkedmark: true }, true],
    [{ goodobsidian: "true" }, false],
    [{ goodobsidian: 1 }, false],
    [{ inkedmark: "yes" }, false],
    [{ title: "x" }, false],
    [{}, false],
    [null, false],
    [undefined, false],
  ])("reads the frontmatter claim %j as %s", (claims, expected) => {
    expect(isInkNote("md", "Note.md", () => claims)).toBe(expected);
  });
});

describe("showAs", () => {
  it("keeps the leaf's state and sets the file and source mode", () => {
    const current = {
      type: VIEW_TYPE_INK,
      state: { file: "Old.md", scroll: 12, mode: "preview" },
      active: true,
      pinned: true,
    };
    expect(showAs(current, MARKDOWN_VIEW_TYPE, "New.notebook.md")).toEqual({
      type: MARKDOWN_VIEW_TYPE,
      state: { file: "New.notebook.md", scroll: 12, mode: "source" },
      active: true,
      pinned: true,
    });
    expect(current.state.file).toBe("Old.md");
  });

  it("works for a leaf with no state yet", () => {
    expect(showAs({ type: "empty" }, VIEW_TYPE_INK, "A.page.md")).toEqual({
      type: VIEW_TYPE_INK,
      state: { file: "A.page.md", mode: "source" },
    });
  });
});

describe("ViewRouter", () => {
  const ink = new Set(["A.notebook.md", "Flagged.md"]);
  const isInk = (path: string): boolean => ink.has(path);

  it("opens an ink note's Markdown request in the notebook view", () => {
    const router = new ViewRouter();
    expect(router.typeToOpen(MARKDOWN_VIEW_TYPE, "A.notebook.md", isInk)).toBe(VIEW_TYPE_INK);
    expect(router.typeToOpen(MARKDOWN_VIEW_TYPE, "Flagged.md", isInk)).toBe(VIEW_TYPE_INK);
  });

  it("leaves every other request as it is, without looking the file up", () => {
    const router = new ViewRouter();
    const lookup = vi.fn(isInk);
    expect(router.typeToOpen(MARKDOWN_VIEW_TYPE, "Plain.md", lookup)).toBe(MARKDOWN_VIEW_TYPE);
    expect(lookup).toHaveBeenCalledTimes(1);
    lookup.mockClear();
    for (const [type, file] of [
      ["pdf", "A.notebook.md"],
      [VIEW_TYPE_INK, "A.notebook.md"],
      ["empty", undefined],
      [MARKDOWN_VIEW_TYPE, undefined],
      [MARKDOWN_VIEW_TYPE, 42],
      [MARKDOWN_VIEW_TYPE, null],
    ] as const) {
      expect(router.typeToOpen(type, file, lookup)).toBe(type);
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  it("keeps a note in Markdown once the user switched it, until switched back", () => {
    const router = new ViewRouter();
    expect(router.toggle("A.notebook.md", true)).toBe(MARKDOWN_VIEW_TYPE);
    const lookup = vi.fn(isInk);
    expect(router.typeToOpen(MARKDOWN_VIEW_TYPE, "A.notebook.md", lookup)).toBe(MARKDOWN_VIEW_TYPE);
    expect(router.wantsNotebook("A.notebook.md", () => true)).toBe(false);
    expect(lookup).not.toHaveBeenCalled();
    // Other notes are not affected.
    expect(router.typeToOpen(MARKDOWN_VIEW_TYPE, "Flagged.md", isInk)).toBe(VIEW_TYPE_INK);

    expect(router.toggle("A.notebook.md", false)).toBe(VIEW_TYPE_INK);
    expect(router.typeToOpen(MARKDOWN_VIEW_TYPE, "A.notebook.md", isInk)).toBe(VIEW_TYPE_INK);
  });

  it("switching back a note that was never kept is harmless", () => {
    const router = new ViewRouter();
    expect(router.toggle("Flagged.md", false)).toBe(VIEW_TYPE_INK);
    expect(router.wantsNotebook("Flagged.md", () => true)).toBe(true);
  });

  it("asks whether a note is ink only when it matters", () => {
    const router = new ViewRouter();
    expect(router.wantsNotebook("Plain.md", () => false)).toBe(false);
    expect(router.wantsNotebook("A.notebook.md", () => true)).toBe(true);
  });
});
