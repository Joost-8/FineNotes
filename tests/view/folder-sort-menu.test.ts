/**
 * The Folders library's sort menu: the sort kinds, a separator and the
 * direction, with no highlighted "Sort by" row above them (in Obsidian a
 * label row looks like an option).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Menu, WorkspaceLeaf, resetFakes } from "./fake-obsidian";
import { container, makeWorld } from "./folder-world";
import type { StubEl } from "./stub-dom";
import { installDomGlobals } from "./stub-dom";

vi.mock("obsidian", () => import("./fake-obsidian"));
// The menu is placed and closed by Obsidian; here it is just handed over.
const shown = vi.hoisted(() => ({ menus: [] as unknown[] }));
vi.mock("../../src/view/folder-sidebar/context-menu", async (original) => ({
  ...(await original<object>()),
  showMenu: (menu: unknown) => void shown.menus.push(menu),
}));

const { FolderSidebarController } = await import("../../src/view/folder-sidebar/controller");
const { FolderLibraryView } = await import("../../src/view/folder-sidebar/folder-library-view");

beforeEach(() => {
  resetFakes();
  shown.menus.length = 0;
  installDomGlobals(vi.stubGlobal.bind(vi));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the Folders library's sort menu", () => {
  it("has no label row, and starts with Created Date", async () => {
    const world = makeWorld(["a.md", "b.md"]);
    const controller = new FolderSidebarController({
      app: world.app as never,
      owner: world.owner as never,
      pluginDir: ".obsidian/plugins/finenotes",
      host: world.host,
      data: () => world.data,
      save: () => Promise.resolve(),
    });
    const view = new FolderLibraryView(
      new WorkspaceLeaf(world.app) as never,
      controller,
    ) as unknown as {
      contentEl: StubEl;
      setState(s: unknown, r: unknown): Promise<void>;
      open(p: StubEl): Promise<void>;
    };
    await view.setState({ folder: "" }, {} as never);
    await view.open(container());
    const sortButton = view.contentEl
      .querySelectorAll(".fl-toolbar .fl-text-button")
      .find((b) => b.getAttribute("aria-haspopup") === "menu");
    sortButton?.click();
    const menu = shown.menus[0] as Menu;
    expect(menu).toBeInstanceOf(Menu);
    expect(menu.rows.some((row) => row?.isLabel)).toBe(false);
    expect(menu.rows.map((row) => row?.title ?? "---")).toEqual([
      "Created Date",
      "Modified Date",
      "Name",
      "---",
      "Newest First",
      "Oldest First",
    ]);
    expect(menu.rows[0]?.checked).toBe(true);
  });
});
