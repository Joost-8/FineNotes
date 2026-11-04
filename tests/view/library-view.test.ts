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
  watchVault(): void;
  stale: boolean;
  entries(): { path: string; title: string }[];
  reads: Map<string, { mtime: number; entry: { pages: number } }>;
  readStale(): Promise<void>;
}

function viewOn(paths: string[]) {
  const vault = memoryVault(paths);
  const leafHandlers: ((leaf: unknown) => void)[] = [];
  const workspace = {
    on: (_name: string, handler: (leaf: unknown) => void) => leafHandlers.push(handler),
    /** The user taps a tab. */
    activate: (leaf: unknown) => leafHandlers.forEach((handler) => handler(leaf)),
  };
  const app = { ...vault.app, workspace, loadLocalStorage: () => null };
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

describe("a Home tab in the background", () => {
  it("reads nothing while hidden, and catches up when it is shown", async () => {
    const { app, vault, view, inside } = viewOn(["A.notebook.md"]);
    await inside.readStale();
    let shown = false;
    Object.assign(view, { containerEl: { isShown: () => shown } });
    inside.watchVault();
    const read = app.vault.cachedRead;
    const asked: string[] = [];
    app.vault.cachedRead = async (file: FakeFile) => {
      asked.push(file.path);
      return read(file);
    };
    const a = app.vault.getFileByPath("A.notebook.md")!;
    // Written in, a stroke at a time, while the library waits in another tab.
    for (let mtime = 1; mtime <= 3; mtime++) {
      (a.stat as { mtime: number }).mtime = mtime;
      vault.emit("modify", a);
    }
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(asked).toEqual([]);
    expect(inside.stale).toBe(true);
    shown = true;
    app.workspace.activate(view.leaf);
    await inside.readStale();
    expect(asked).toEqual(["A.notebook.md"]);
    expect(inside.reads.get("A.notebook.md")?.mtime).toBe(3);
    expect(inside.stale).toBe(false);
  });

  it("reads a change at once when it is the tab on screen", async () => {
    const { app, vault, view, inside } = viewOn(["A.notebook.md"]);
    await inside.readStale();
    Object.assign(view, { containerEl: { isShown: () => true } });
    inside.watchVault();
    const a = app.vault.getFileByPath("A.notebook.md")!;
    (a.stat as { mtime: number }).mtime = 7;
    vault.emit("modify", a);
    await new Promise((resolve) => setTimeout(resolve, 450));
    await inside.readStale();
    expect(inside.reads.get("A.notebook.md")?.mtime).toBe(7);
  });
});
