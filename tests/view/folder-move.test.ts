/**
 * Moving FineNotes' templates and stickers into FineNotes assets on start
 * (main.ts `moveOwnFolders`), against a vault kept in memory.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("./fake-obsidian"));
vi.mock("../../CHANGELOG.md", () => ({ default: "" }));

const { TFile, TFolder } = await import("./fake-obsidian");
const { default: GoodObsidianPlugin } = await import("../../src/main");
const { DEFAULT_SETTINGS } = await import("../../src/settings");

type Node = InstanceType<typeof TFile> | Folder;
class Folder extends TFolder {
  children: Node[] = [];
  name: string;
  constructor(path: string) {
    super(path);
    this.name = path.split("/").pop() ?? path;
  }
}

/** A vault of folders and files by path, with Obsidian's moves. */
function fakeVault(paths: string[]) {
  const nodes = new Map<string, Node>();
  const parentOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));
  const folder = (path: string): Folder => {
    const found = nodes.get(path);
    if (found instanceof Folder) return found;
    const made = new Folder(path);
    nodes.set(path, made);
    const parent = parentOf(path);
    if (parent) folder(parent).children.push(made);
    return made;
  };
  for (const path of paths) {
    if (path.endsWith("/")) folder(path.slice(0, -1));
    else {
      const file = new TFile(path);
      nodes.set(path, file);
      if (parentOf(path)) folder(parentOf(path)).children.push(file);
    }
  }
  const detach = (node: Node) => {
    const parent = nodes.get(parentOf(node.path));
    if (parent instanceof Folder) parent.children = parent.children.filter((c) => c !== node);
  };
  const rename = (node: Node, to: string) => {
    detach(node);
    const from = node.path;
    for (const [path, n] of [...nodes]) {
      if (path === from || path.startsWith(`${from}/`)) {
        nodes.delete(path);
        const moved = to + path.slice(from.length);
        const copy =
          n instanceof Folder
            ? Object.assign(new Folder(moved), { children: [] })
            : new TFile(moved);
        nodes.set(moved, copy);
      }
    }
    // Rebuild children of everything under `to`.
    for (const [path, n] of nodes) {
      if (n instanceof Folder && (path === to || path.startsWith(`${to}/`))) n.children = [];
    }
    for (const [path, n] of nodes) {
      if (path.startsWith(`${to}/`)) (nodes.get(parentOf(path)) as Folder).children.push(n);
    }
    const parent = nodes.get(parentOf(to));
    if (parent instanceof Folder) parent.children.push(nodes.get(to)!);
  };
  const app = {
    vault: {
      getFolderByPath: (path: string) => {
        const n = nodes.get(path);
        return n instanceof Folder ? n : null;
      },
      getAbstractFileByPath: (path: string) => nodes.get(path) ?? null,
      createFolder: async (path: string) => void folder(path),
      adapter: { exists: async () => false },
    },
    fileManager: {
      renameFile: async (node: Node, to: string) => rename(node, to),
      trashFile: async (node: Node) => {
        detach(node);
        nodes.delete(node.path);
      },
    },
  };
  return {
    app,
    paths: () => [...nodes.keys()].filter((p) => nodes.get(p) instanceof TFile).sort(),
  };
}

function pluginWith(app: unknown, settings: Record<string, unknown>) {
  const plugin = Object.create(GoodObsidianPlugin.prototype) as Record<string, unknown>;
  let saves = 0;
  Object.assign(plugin, {
    app,
    manifest: { id: "finenotes", dir: "plug" },
    settings: { ...DEFAULT_SETTINGS, ...settings },
    saveSettings: async () => void saves++,
    wordCheck: { reload: async () => undefined },
  });
  const move = () => (plugin.moveOwnFolders as () => Promise<void>).call(plugin);
  return { plugin, move, saves: () => saves };
}

describe("moving FineNotes' folders into FineNotes assets", () => {
  it("moves the old default folders, the setting, and the template the dialog remembers", async () => {
    const { app, paths } = fakeVault([
      "FineNotes templates/Planner.finetemplate",
      "FineNotes templates/Papers/Grid.pdf",
      "FineNotes stickers/My stickers/Star.svg",
      "Notes/Keep.md",
    ]);
    const { plugin, move, saves } = pluginWith(app, {
      templateFolder: "FineNotes templates",
      stickerFolder: "FineNotes stickers",
      lastNotebookTemplate: { path: "FineNotes templates/Papers/Grid.pdf", page: 2 },
    });
    await move();
    expect(paths()).toEqual([
      "FineNotes assets/Stickers/My stickers/Star.svg",
      "FineNotes assets/Templates/Papers/Grid.pdf",
      "FineNotes assets/Templates/Planner.finetemplate",
      "Notes/Keep.md",
    ]);
    const settings = plugin.settings as Record<string, unknown>;
    expect(settings.templateFolder).toBe("FineNotes assets/Templates");
    expect(settings.stickerFolder).toBe("FineNotes assets/Stickers");
    expect(settings.lastNotebookTemplate).toEqual({
      path: "FineNotes assets/Templates/Papers/Grid.pdf",
      page: 2,
    });
    expect(saves()).toBe(1);
    // A second start finds nothing to do.
    await move();
    expect(saves()).toBe(1);
  });

  it("merges an old folder sync brought back into the new one, leaving a clash where it is", async () => {
    const { app, paths } = fakeVault([
      "FineNotes assets/Templates/Planner.finetemplate",
      "FineNotes templates/Planner.finetemplate",
      "FineNotes templates/Weekly.finetemplate",
    ]);
    const { move } = pluginWith(app, {
      templateFolder: "FineNotes assets/Templates",
      stickerFolder: "Art",
    });
    await move();
    expect(paths()).toEqual([
      "FineNotes assets/Templates/Planner.finetemplate",
      "FineNotes assets/Templates/Weekly.finetemplate",
      "FineNotes templates/Planner.finetemplate",
    ]);
  });

  it("leaves a folder the user chose", async () => {
    const { app, paths } = fakeVault(["Planners/A.finetemplate", "FineNotes stickers/x/y.svg"]);
    const { plugin, move } = pluginWith(app, {
      templateFolder: "Planners",
      stickerFolder: "FineNotes stickers",
    });
    await move();
    expect(paths()).toEqual(["FineNotes assets/Stickers/x/y.svg", "Planners/A.finetemplate"]);
    expect((plugin.settings as Record<string, unknown>).templateFolder).toBe("Planners");
  });
});
