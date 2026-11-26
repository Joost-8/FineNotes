import { describe, expect, it } from "vitest";
import {
  type HandwriteSettings,
  blockTarget,
  cleanHandwriteSettings,
  followHandwriteNotebook,
  handwriteBlocksOf,
} from "../../src/model/handwrite-blocks";

const settings = (extra: Partial<HandwriteSettings> = {}): HandwriteSettings => ({
  handwriteBlocks: "note",
  handwriteBlocksChosen: true,
  handwriteNotebook: "",
  ...extra,
});

const vault =
  (...paths: string[]) =>
  (path: string) =>
    paths.includes(path);

describe("where a new block goes (Joost, 2026-11-26)", () => {
  it("asks once, the first time", () => {
    const first = settings({ handwriteBlocksChosen: false });
    expect(blockTarget(first, { choose: false, linked: null, exists: vault() })).toEqual({
      kind: "first-use",
    });
    // Even the choose command asks the first-use question first.
    expect(blockTarget(first, { choose: true, linked: null, exists: vault() }).kind).toBe(
      "first-use",
    );
  });

  it("one notebook per note: the one the note uses, else the note's own", () => {
    const s = settings();
    expect(
      blockTarget(s, { choose: false, linked: "A/Lecture.notebook.md", exists: vault() }),
    ).toEqual({
      kind: "notebook",
      path: "A/Lecture.notebook.md",
    });
    expect(blockTarget(s, { choose: false, linked: null, exists: vault() })).toEqual({
      kind: "note",
    });
  });

  it("ask each time: the picker, every time", () => {
    const s = settings({ handwriteBlocks: "ask" });
    expect(blockTarget(s, { choose: false, linked: "X.notebook.md", exists: vault() })).toEqual({
      kind: "pick",
    });
  });

  it("one notebook for everything: that notebook, whatever the note uses", () => {
    const s = settings({ handwriteBlocks: "one", handwriteNotebook: "All.notebook.md" });
    const exists = vault("All.notebook.md");
    expect(blockTarget(s, { choose: false, linked: "X.notebook.md", exists })).toEqual({
      kind: "notebook",
      path: "All.notebook.md",
    });
  });

  it("one notebook for everything, gone or never chosen: said, not silent", () => {
    const gone = settings({ handwriteBlocks: "one", handwriteNotebook: "All.notebook.md" });
    expect(blockTarget(gone, { choose: false, linked: null, exists: vault() })).toEqual({
      kind: "fixed-missing",
    });
    const none = settings({ handwriteBlocks: "one" });
    expect(blockTarget(none, { choose: false, linked: null, exists: vault() }).kind).toBe(
      "fixed-missing",
    );
  });

  it("the choose command picks in every mode", () => {
    for (const mode of ["note", "ask", "one"] as const) {
      const s = settings({ handwriteBlocks: mode, handwriteNotebook: "All.notebook.md" });
      expect(
        blockTarget(s, { choose: true, linked: null, exists: vault("All.notebook.md") }),
      ).toEqual({
        kind: "pick",
      });
    }
  });
});

describe("the stored choice", () => {
  it("reads anything unknown as one notebook per note, and not yet asked", () => {
    expect(handwriteBlocksOf("bogus")).toBe("note");
    expect(cleanHandwriteSettings({})).toEqual({
      handwriteBlocks: "note",
      handwriteBlocksChosen: false,
      handwriteNotebook: "",
    });
    expect(
      cleanHandwriteSettings({
        handwriteBlocks: "one",
        handwriteBlocksChosen: true,
        handwriteNotebook: "All.notebook.md",
      }),
    ).toEqual({
      handwriteBlocks: "one",
      handwriteBlocksChosen: true,
      handwriteNotebook: "All.notebook.md",
    });
    expect(cleanHandwriteSettings({ handwriteBlocksChosen: "yes", handwriteNotebook: 3 })).toEqual({
      handwriteBlocks: "note",
      handwriteBlocksChosen: false,
      handwriteNotebook: "",
    });
  });

  it("follows the fixed notebook when it is renamed or moved", () => {
    const s = settings({ handwriteBlocks: "one", handwriteNotebook: "All.notebook.md" });
    expect(followHandwriteNotebook(s, "Other.notebook.md", "B.notebook.md")).toBe(false);
    expect(followHandwriteNotebook(s, "All.notebook.md", "Notes/Everything.notebook.md")).toBe(
      true,
    );
    expect(s.handwriteNotebook).toBe("Notes/Everything.notebook.md");
    const exists = vault("Notes/Everything.notebook.md");
    expect(blockTarget(s, { choose: false, linked: null, exists }).kind).toBe("notebook");
  });
});
