/**
 * `src/view/file-moves.ts` — the vault side of #14: renames are logged, open
 * notebooks are told to relink, and closed ink notes pointing at a moved
 * file are rewritten so the change reaches other devices.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App, TAbstractFile, TFile } from "obsidian";
import { FileMoveTracker, RELINK_DELAY_MS } from "../../src/view/file-moves";
import { blankPage, emptyDocument } from "../../src/model/document";
import { buildInkFile, parseInkFile } from "../../src/model/serialize";

/** A vault of paths and texts, with just what the tracker calls. */
function fakeVault(files: Record<string, string>) {
  const storage = new Map<string, unknown>();
  const writes: string[] = [];
  const fileAt = (path: string) =>
    ({ path, name: path.split("/").pop(), extension: path.split(".").pop() }) as TFile;
  const app = {
    loadLocalStorage: (key: string) => storage.get(key) ?? null,
    saveLocalStorage: (key: string, value: unknown) => storage.set(key, value),
    vault: {
      getAbstractFileByPath: (path: string) => (path in files ? fileAt(path) : null),
      getMarkdownFiles: () =>
        Object.keys(files)
          .filter((p) => p.endsWith(".md"))
          .map(fileAt),
      cachedRead: (file: TFile) => Promise.resolve(files[file.path]),
      process: (file: TFile, fn: (data: string) => string) => {
        const next = fn(files[file.path]);
        if (next !== files[file.path]) writes.push(file.path);
        files[file.path] = next;
        return Promise.resolve(next);
      },
    },
  } as unknown as App;
  /** Move a file in the vault and report it, as Obsidian does. */
  const move = (tracker: FileMoveTracker, from: string, to: string) => {
    files[to] = files[from];
    delete files[from];
    tracker.renamed(fileAt(to) as TAbstractFile, from);
  };
  return { app, files, writes, move };
}

function noteWithPdf(path: string): string {
  const doc = emptyDocument();
  const page = blankPage("p2");
  page.backdrop = { kind: "pdf", path, page: 0 };
  doc.pages.push(page);
  return buildInkFile("# Notes", doc);
}

function pdfPathIn(text: string): string | undefined {
  const backdrop = parseInkFile(text).doc?.pages[1].backdrop;
  return backdrop?.kind === "pdf" ? backdrop.path : undefined;
}

describe("FileMoveTracker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function setUp(files: Record<string, string>, open: string[] = []) {
    const vault = fakeVault(files);
    const relinkOpen = vi.fn();
    const tracker = new FileMoveTracker(vault.app, {
      isInkFile: (file) => file.path.endsWith(".notebook.md"),
      openNotePaths: () => new Set(open),
      relinkOpen,
      paperWidth: () => 800,
    });
    return { ...vault, tracker, relinkOpen };
  }

  it("rewrites a closed notebook that points at the moved PDF", async () => {
    const { tracker, files, writes, move, relinkOpen } = setUp({
      "Lecture.pdf": "%PDF",
      "Notes.notebook.md": noteWithPdf("Lecture.pdf"),
      "Other.notebook.md": noteWithPdf("Elsewhere.pdf"),
    });
    move(tracker, "Lecture.pdf", "Courses/Lecture.pdf");
    expect(tracker.relink("Lecture.pdf")).toBe("Courses/Lecture.pdf");
    await vi.advanceTimersByTimeAsync(RELINK_DELAY_MS);
    await tracker.flush();
    expect(relinkOpen).toHaveBeenCalledTimes(1);
    expect(pdfPathIn(files["Notes.notebook.md"])).toBe("Courses/Lecture.pdf");
    expect(parseInkFile(files["Notes.notebook.md"]).body.trim()).toBe("# Notes");
    // Nothing else is written, not even a note with a dead path of its own.
    expect(writes).toEqual(["Notes.notebook.md"]);
  });

  it("leaves an open notebook to its view", async () => {
    const { tracker, files, writes, move, relinkOpen } = setUp(
      { "a.pdf": "%PDF", "Open.notebook.md": noteWithPdf("a.pdf") },
      ["Open.notebook.md"],
    );
    move(tracker, "a.pdf", "b.pdf");
    await vi.advanceTimersByTimeAsync(RELINK_DELAY_MS);
    await tracker.flush();
    expect(relinkOpen).toHaveBeenCalled();
    expect(writes).toEqual([]);
    expect(pdfPathIn(files["Open.notebook.md"])).toBe("a.pdf");
  });

  it("follows a folder rename, and logs it once", () => {
    const { tracker, files, app } = setUp({ "In/a.pdf": "%PDF" });
    files["Out/a.pdf"] = files["In/a.pdf"];
    delete files["In/a.pdf"];
    files["Out"] = "";
    tracker.renamed({ path: "Out" } as TAbstractFile, "In");
    // Obsidian may report each file inside too; the folder's move covers it.
    tracker.renamed(
      { path: "Out/a.pdf", extension: "pdf" } as unknown as TAbstractFile,
      "In/a.pdf",
    );
    expect(tracker.relink("In/a.pdf")).toBe("Out/a.pdf");
    expect(tracker.log()).toEqual([{ from: "In", to: "Out" }]);
    // The log lives in this vault's local storage.
    expect(app.loadLocalStorage("goodobsidian:moved-files")).toBe(
      JSON.stringify([{ from: "In", to: "Out" }]),
    );
  });

  it("does nothing more when only a notebook was renamed", async () => {
    const { tracker, move, relinkOpen } = setUp({ "A.notebook.md": noteWithPdf("a.pdf") });
    move(tracker, "A.notebook.md", "B.notebook.md");
    await vi.advanceTimersByTimeAsync(RELINK_DELAY_MS);
    expect(relinkOpen).not.toHaveBeenCalled();
  });

  it("starts a fresh log when the stored one is unreadable", () => {
    const { tracker, app } = setUp({});
    app.saveLocalStorage("goodobsidian:moved-files", "{not json");
    expect(tracker.log()).toEqual([]);
  });
});
