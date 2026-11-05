/**
 * A vault, a workspace and a Folders sidebar controller in memory, for the
 * tests of the Folders views: folders and files by path, Obsidian's events,
 * renames and trash, and a left split whose tabs can be counted.
 */
import { vi } from "vitest";
import { Component, TFile, WorkspaceLeaf } from "./fake-obsidian";
import { MemoryFolder } from "./memory-vault";
import { StubEl } from "./stub-dom";
import type { FolderSidebarData } from "../../src/model/folder-sidebar-data";
import { defaultFolderSidebarData } from "../../src/model/folder-sidebar-data";

type Handler = (...args: unknown[]) => void;

export interface World {
  app: Record<string, unknown> & {
    vault: Record<string, unknown>;
    workspace: Record<string, unknown> & { leaves: WorkspaceLeaf[] };
  };
  root: MemoryFolder;
  data: FolderSidebarData;
  /** Everything passed to the controller's `save`. */
  saves: number;
  host: {
    openNewNotebookDialog: ReturnType<typeof vi.fn<(folder: string) => void>>;
    openImportNotebook: ReturnType<typeof vi.fn<(folder: string) => void>>;
  };
  /** Rename a folder or file in the vault, as Obsidian does: the thing first, then what is below it. */
  rename(from: string, to: string): void;
  owner: Component;
  node(path: string): MemoryFolder | TFile | null;
  /** Fire a vault event. */
  emit(name: string, ...args: unknown[]): void;
  /** Fire a workspace event. */
  trigger(name: string, ...args: unknown[]): void;
  /** The renames and trashings the app was asked for. */
  renamed: [string, string][];
  trashed: string[];
  createdFolders: string[];
  leftSplit: { collapsed: boolean; expand: () => void; collapse: () => void };
  /** The left split's tab group: which tab is in front, and how it was brought there. */
  tabs: { selected: WorkspaceLeaf | null; selectTab: ReturnType<typeof vi.fn> };
  /** Workspace calls that would expand the sidebar or take focus. */
  revealLeaf: ReturnType<typeof vi.fn>;
  setActiveLeaf: ReturnType<typeof vi.fn>;
}

const parentOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf("/")));

/** Paths ending in "/" are empty folders; the rest are files. */
export function makeWorld(
  paths: string[],
  data: FolderSidebarData = defaultFolderSidebarData(),
): World {
  const root = new MemoryFolder("/");
  const nodes = new Map<string, MemoryFolder | TFile>();
  const vaultHandlers = new Map<string, Handler[]>();
  const workspaceHandlers = new Map<string, Handler[]>();
  const leaves: WorkspaceLeaf[] = [];
  const renamed: [string, string][] = [];
  const trashed: string[] = [];
  const createdFolders: string[] = [];

  const attach = (node: MemoryFolder | TFile): void => {
    const parentPath = parentOf(node.path);
    const parent = parentPath ? (nodes.get(parentPath) as MemoryFolder) : root;
    parent.children.push(node);
    (node as { parent: unknown }).parent = parent;
  };
  const folder = (path: string): MemoryFolder => {
    const found = nodes.get(path);
    if (found instanceof MemoryFolder) return found;
    const parentPath = parentOf(path);
    if (parentPath) folder(parentPath);
    const made = new MemoryFolder(path);
    nodes.set(path, made);
    attach(made);
    return made;
  };
  const file = (path: string): TFile => {
    if (parentOf(path)) folder(parentOf(path));
    const made = new TFile(path);
    nodes.set(path, made);
    attach(made);
    return made;
  };
  for (const path of paths) {
    if (path.endsWith("/")) folder(path.slice(0, -1));
    else file(path);
  }

  const emit = (name: string, ...args: unknown[]): void => {
    for (const handler of vaultHandlers.get(name) ?? []) handler(...args);
  };
  const trigger = (name: string, ...args: unknown[]): void => {
    for (const handler of workspaceHandlers.get(name) ?? []) handler(...args);
  };
  const leftSplit = { collapsed: false, expand: vi.fn(), collapse: vi.fn() };
  const tabs: World["tabs"] = {
    selected: null,
    selectTab: vi.fn((leaf: WorkspaceLeaf) => {
      tabs.selected = leaf;
    }),
  };
  const revealLeaf = vi.fn(() => Promise.resolve());
  const setActiveLeaf = vi.fn();
  /** A new tab, in the workspace at once; detaching it takes it out, as Obsidian does. */
  const newLeaf = (): WorkspaceLeaf => {
    const leaf = new WorkspaceLeaf(app);
    const detached = leaf.detach.bind(leaf);
    leaf.detach = () => {
      const at = leaves.indexOf(leaf);
      if (at >= 0) leaves.splice(at, 1);
      detached();
    };
    (leaf as { parent?: unknown }).parent = tabs;
    leaves.push(leaf);
    return leaf;
  };

  const app = {
    vault: {
      configDir: ".obsidian",
      on(name: string, handler: Handler) {
        vaultHandlers.set(name, [...(vaultHandlers.get(name) ?? []), handler]);
        return { name };
      },
      getRoot: () => root,
      getName: () => "My Vault",
      getAbstractFileByPath: (path: string) =>
        path === "" || path === "/" ? root : (nodes.get(path) ?? null),
      getFiles: () => [...nodes.values()].filter((node): node is TFile => node instanceof TFile),
      createFolder: (path: string) => {
        if (nodes.has(path)) return Promise.reject(new Error("Folder already exists."));
        createdFolders.push(path);
        emit("create", folder(path));
        return Promise.resolve();
      },
      cachedRead: () => Promise.resolve(""),
      getResourcePath: (f: TFile) => `app://${f.path}`,
      adapter: { exists: () => Promise.resolve(false) },
    },
    metadataCache: {
      getFileCache: () => null,
      getFirstLinkpathDest: () => null,
    },
    fileManager: {
      renameFile: (node: MemoryFolder | TFile, to: string) => {
        if (nodes.has(to)) return Promise.reject(new Error("Destination file already exists!"));
        renamed.push([node.path, to]);
        return Promise.resolve();
      },
      trashFile: (node: MemoryFolder | TFile) => {
        trashed.push(node.path);
        return Promise.resolve();
      },
    },
    workspace: {
      leaves,
      leftSplit,
      on(name: string, handler: Handler) {
        workspaceHandlers.set(name, [...(workspaceHandlers.get(name) ?? []), handler]);
        return { name };
      },
      getLeavesOfType: (type: string) => leaves.filter((leaf) => leaf.getViewState().type === type),
      getActiveViewOfType: () => null,
      getLeaf: () => newLeaf(),
      getLeftLeaf: () => newLeaf(),
      detachLeavesOfType(type: string) {
        for (const leaf of leaves.filter((each) => each.getViewState().type === type))
          leaf.detach();
      },
      revealLeaf,
      setActiveLeaf,
    },
  } as unknown as World["app"];

  return {
    app,
    root,
    data,
    saves: 0,
    host: {
      openNewNotebookDialog: vi.fn<(folder: string) => void>(),
      openImportNotebook: vi.fn<(folder: string) => void>(),
    },
    rename(from: string, to: string) {
      const moved = [...nodes.keys()].filter((p) => p === from || p.startsWith(`${from}/`)).sort();
      const top = nodes.get(from) as MemoryFolder | TFile;
      const oldParent = ((top as { parent?: unknown }).parent ?? root) as MemoryFolder;
      oldParent.children.splice(oldParent.children.indexOf(top), 1);
      const changed: [MemoryFolder | TFile, string][] = [];
      for (const path of moved) {
        const node = nodes.get(path) as MemoryFolder | TFile;
        nodes.delete(path);
        const now = to + path.slice(from.length);
        Object.assign(node, { path: now, name: now.slice(now.lastIndexOf("/") + 1) });
        nodes.set(now, node);
        changed.push([node, path]);
      }
      attach(top);
      for (const [node, old] of changed) emit("rename", node, old);
    },
    owner: new Component(),
    node: (path) => nodes.get(path) ?? null,
    emit,
    trigger,
    renamed,
    trashed,
    createdFolders,
    leftSplit,
    tabs,
    revealLeaf,
    setActiveLeaf,
  };
}

/** The container a view is opened in: attached to the page. */
export function container(): StubEl {
  const el = new StubEl("div", "workspace-leaf-container");
  el.attached = true;
  return el;
}
