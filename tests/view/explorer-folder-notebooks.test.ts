import { describe, expect, it, vi } from "vitest";
vi.mock("obsidian", () => import("./fake-obsidian"));
const { TFile, TFolder } = await import("./fake-obsidian");
const { ExplorerFolderNotebooks, notebookOf } =
  await import("../../src/view/explorer-folder-notebooks");

type Child = InstanceType<typeof TFile> | InstanceType<typeof TFolder>;

function folder(path: string, children: Child[] = []) {
  return Object.assign(new TFolder(path), {
    name: path.slice(path.lastIndexOf("/") + 1),
    children,
  });
}

/** Obsidian's explorer, as far as the wrapper reads it: folders first. */
class Explorer {
  sorts = 0;
  getSortedFolderItems(dir: { children: Child[] }): unknown {
    return dir.children.map((file) => ({ file }));
  }
  requestSort(): void {
    this.sorts++;
  }
}

const names = (items: unknown) =>
  (items as Array<{ file: { path: string } }>).map((item) => item.file.path);
const host = { folder: () => null, open: () => {} };

describe("ExplorerFolderNotebooks", () => {
  const note = new TFile("Physics/Physics.notebook.md");
  const images = folder("Physics/Images");
  const physics = folder("Physics", [images, note]);

  it("finds a folder's own notebook", () => {
    // The fakes carry only what the code reads.
    const asFolder = (value: unknown) => value as Parameters<typeof notebookOf>[0];
    expect(notebookOf(asFolder(physics))).toBe(note);
    expect(notebookOf(asFolder(images))).toBeNull();
    expect(notebookOf(null)).toBeNull();
  });

  it("hides the notebook inside its own folder, and gives the listing back", () => {
    const view = new Explorer();
    const explorer = new ExplorerFolderNotebooks(host);
    explorer.sync([view], true);
    explorer.sync([view], true);
    expect(names(view.getSortedFolderItems(physics))).toEqual(["Physics/Images"]);
    // A folder that is not a notebook's lists everything.
    const other = folder("Notes", [new TFile("Notes/Physics.notebook.md")]);
    expect(names(view.getSortedFolderItems(other))).toEqual(["Notes/Physics.notebook.md"]);
    expect(view.sorts).toBe(1);
    explorer.sync([view], false);
    expect(Object.prototype.hasOwnProperty.call(view, "getSortedFolderItems")).toBe(false);
    expect(names(view.getSortedFolderItems(physics))).toEqual([
      "Physics/Images",
      "Physics/Physics.notebook.md",
    ]);
    expect(view.sorts).toBe(2);
  });

  it("leaves an explorer without the methods it relies on alone", () => {
    const odd = { getSortedFolderItems: () => "not a list" };
    new ExplorerFolderNotebooks(host).sync([odd, null, {}], true);
    expect(odd.getSortedFolderItems()).toBe("not a list");
  });
});
