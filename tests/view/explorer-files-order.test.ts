import { describe, expect, it, vi } from "vitest";
vi.mock("obsidian", () => import("./fake-obsidian"));
const { TFile, TFolder } = await import("./fake-obsidian");
const { ExplorerFilesOrder } = await import("../../src/view/explorer-files-order");

/** Obsidian's order: folders first, then files. */
class Explorer {
  sorts = 0;
  constructor(private readonly items: unknown[]) {}
  getSortedFolderItems(_folder: unknown): unknown {
    return this.items;
  }
  requestSort(): void {
    this.sorts++;
  }
}

const folder = (name: string) => ({ file: Object.assign(new TFolder(name), { name }) });
const file = (name: string) => ({ file: new TFile(name) });
const names = (items: unknown) =>
  (items as Array<{ file: { path: string } }>).map((item) => item.file.path);

describe("ExplorerFilesOrder", () => {
  const items = [folder("Physics files"), file("Physics.notebook.md"), file("Zoo.md")];

  it("lists a files folder under its notebook, sorts once, and undoes it all", () => {
    const view = new Explorer(items);
    const order = new ExplorerFilesOrder();
    order.sync([view], true);
    order.sync([view], true);
    expect(names(view.getSortedFolderItems(null))).toEqual([
      "Physics.notebook.md",
      "Physics files",
      "Zoo.md",
    ]);
    expect(view.sorts).toBe(1);
    order.destroy();
    expect(Object.prototype.hasOwnProperty.call(view, "getSortedFolderItems")).toBe(false);
    expect(names(view.getSortedFolderItems(null))[0]).toBe("Physics files");
    expect(view.sorts).toBe(2);
  });

  it("turned off, gives Obsidian's order back", () => {
    const view = new Explorer(items);
    const order = new ExplorerFilesOrder();
    order.sync([view], true);
    order.sync([view], false);
    expect(names(view.getSortedFolderItems(null))[0]).toBe("Physics files");
  });

  it("leaves an explorer without the methods it relies on alone", () => {
    const odd = { getSortedFolderItems: () => "not a list" };
    const order = new ExplorerFilesOrder();
    order.sync([odd, null, {}], true);
    expect(odd.getSortedFolderItems()).toBe("not a list");
    const view = new Explorer(items);
    view.getSortedFolderItems = () => "still not a list";
    order.sync([view], true);
    expect(view.getSortedFolderItems(null)).toBe("still not a list");
  });
});
