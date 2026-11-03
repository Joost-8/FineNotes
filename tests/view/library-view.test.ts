/**
 * The library view's reading of notebooks, without its DOM: a LibraryView
 * built on a vault in memory, its private parts reached through a cast.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TFile as FakeFile } from "./fake-obsidian";

vi.mock("obsidian", () => import("./fake-obsidian"));

const { WorkspaceLeaf } = await import("./fake-obsidian");
const { LibraryView } = await import("../../src/view/library-view");
const { memoryVault } = await import("./memory-vault");

interface Inside {
  entries(): { path: string; title: string }[];
  reads: Map<string, { mtime: number; entry: { pages: number } }>;
  readStale(): Promise<void>;
}

function viewOn(paths: string[]) {
  const vault = memoryVault(paths);
  const app = { ...vault.app, loadLocalStorage: () => null };
  // The plugin's isInkFile, by name only: these fakes have no frontmatter.
  const host = {
    isInkFile: (file: FakeFile) => /.(notebook|page|practice|ink).md$/i.test(file.name),
  };
  const view = new LibraryView(new WorkspaceLeaf(app) as never, host as never);
  return { vault, app, view, inside: view as unknown as Inside };
}

beforeEach(() => vi.stubGlobal("window", globalThis));
afterEach(() => vi.unstubAllGlobals());

describe("reading notebooks", () => {
  it("reads again what changed while a read was under way, rather than dropping the change", async () => {
    const { app, inside } = viewOn(["A.notebook.md", "B.notebook.md"]);
    const read = app.vault.cachedRead;
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const asked: string[] = [];
    app.vault.cachedRead = async (file: FakeFile) => {
      asked.push(file.path);
      if (file.path === "B.notebook.md" && asked.length <= 2) await held;
      return read(file);
    };
    const first = inside.readStale();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(asked).toContain("B.notebook.md");
    // A vault event while B is being read: B changed again.
    const b = app.vault.getFileByPath("B.notebook.md")!;
    (b.stat as { mtime: number }).mtime = 50;
    const second = inside.readStale();
    release();
    await Promise.all([first, second]);
    expect(inside.reads.get("B.notebook.md")?.mtime).toBe(50);
    expect(asked.filter((p) => p === "B.notebook.md")).toHaveLength(2);
  });
});

describe("what the library lists", () => {
  it("lists every kind of notebook, but not practice sheets or the inbox", () => {
    const { inside } = viewOn([
      "Physics.notebook.md",
      "Sketch.page.md",
      "Old notes.ink.md",
      "Plain note.md",
      "FineNotes assets/Handwriting sheets/Handwriting practice 1.practice.md",
      "FineNotes inbox/Scan.notebook.md",
    ]);
    expect(
      inside
        .entries()
        .map((e) => e.title)
        .sort(),
    ).toEqual(["Old notes", "Physics", "Sketch"]);
  });
});
