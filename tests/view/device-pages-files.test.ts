/**
 * A moved notebook's page folder following it (#274): two callers (the
 * view and the plugin's rename handler) ask for one move at once.
 */
import { describe, expect, it, vi } from "vitest";
import { TFolder } from "./fake-obsidian";

vi.mock("obsidian", () => import("./fake-obsidian"));

const { movePagesFolder } = await import("../../src/view/device-pages-files");

/** A vault of folder paths whose renames take a moment, as Obsidian's do. */
function vaultOf(paths: string[]) {
  const folders = new Set(paths);
  const folder = (path: string) =>
    Object.assign(new TFolder(path), {
      children: [...folders].filter(
        (p) => p.startsWith(`${path}/`) && !p.slice(path.length + 1).includes("/"),
      ),
    });
  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => (folders.has(path) ? folder(path) : null),
      createFolder: async (path: string) => {
        await new Promise((r) => setTimeout(r, 5));
        if (folders.has(path)) throw new Error("Folder already exists.");
        folders.add(path);
      },
    },
    fileManager: {
      renameFile: async (from: { path: string }, to: string) => {
        await new Promise((r) => setTimeout(r, 10));
        if (!folders.has(from.path)) throw new Error("gone");
        if (folders.has(to)) throw new Error("Destination file already exists!");
        for (const path of [...folders]) {
          if (path === from.path || path.startsWith(`${from.path}/`)) {
            folders.delete(path);
            folders.add(to + path.slice(from.path.length));
          }
        }
      },
      trashFile: async (file: { path: string }) => {
        folders.delete(file.path);
      },
    },
  };
  return { app, folders };
}

describe("a notebook's page folder following it (#274)", () => {
  it("moves once to exactly its new place, however many ask at once", async () => {
    const { app, folders } = vaultOf(["Changes", "Changes/Pages", "Changes/Pages/n7k2", "Moved"]);
    await Promise.all([
      movePagesFolder(app as never, "Changes/A.notebook.md", "Moved/A.notebook.md", "n7k2"),
      movePagesFolder(app as never, "Changes/A.notebook.md", "Moved/A.notebook.md", "n7k2"),
    ]);
    expect([...folders].sort()).toEqual(["Changes", "Moved", "Moved/Pages", "Moved/Pages/n7k2"]);
  });

  it("leaves another notebook's pages, and the Pages folder they are in", async () => {
    const { app, folders } = vaultOf(["U", "U/Pages", "U/Pages/n7k2", "U/Pages/q3x9", "V"]);
    await movePagesFolder(app as never, "U/A.notebook.md", "V/A.notebook.md", "n7k2");
    expect([...folders].sort()).toEqual([
      "U",
      "U/Pages",
      "U/Pages/q3x9",
      "V",
      "V/Pages",
      "V/Pages/n7k2",
    ]);
  });
});
