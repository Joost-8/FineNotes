/**
 * A vault kept in memory, with Obsidian's moves, copies and trash and the
 * vault events they fire: enough of `App` for the library's file actions
 * and the plugin's tracking of them. Use with `vi.mock("obsidian", () =>
 * import("./fake-obsidian"))`.
 */
import { TFile, TFolder } from "./fake-obsidian";

export class MemoryFolder extends TFolder {
  children: (TFile | MemoryFolder)[] = [];
  readonly name: string;
  constructor(path: string) {
    super(path);
    this.name = path.split("/").pop() ?? path;
  }
}

type Node = TFile | MemoryFolder;
type Handler = (...args: unknown[]) => void;

const parentOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));

/** Paths ending in "/" are empty folders; the rest are files, their folders made as needed. */
export function memoryVault(paths: string[]) {
  const nodes = new Map<string, Node>();
  const texts = new Map<string, string>();
  const handlers = new Map<string, Handler[]>();
  const trashed: string[] = [];
  const emit = (name: string, ...args: unknown[]) => {
    for (const handler of handlers.get(name) ?? []) handler(...args);
  };
  const attach = (node: Node) => {
    const parent = parentOf(node.path);
    if (parent) folder(parent).children.push(node);
    (node as { parent: unknown }).parent = parent ? nodes.get(parent) : null;
  };
  const folder = (path: string): MemoryFolder => {
    const found = nodes.get(path);
    if (found instanceof MemoryFolder) return found;
    const made = new MemoryFolder(path);
    nodes.set(path, made);
    attach(made);
    return made;
  };
  const file = (path: string, text = ""): TFile => {
    const made = new TFile(path);
    nodes.set(path, made);
    texts.set(path, text);
    attach(made);
    return made;
  };
  for (const path of paths) {
    if (path.endsWith("/")) folder(path.slice(0, -1));
    else file(path);
  }
  const detach = (node: Node) => {
    const parent = nodes.get(parentOf(node.path));
    if (parent instanceof MemoryFolder) parent.children = parent.children.filter((c) => c !== node);
  };
  const below = (path: string) =>
    [...nodes.keys()].filter((p) => p === path || p.startsWith(`${path}/`)).sort();

  const app = {
    vault: {
      on(name: string, handler: Handler) {
        handlers.set(name, [...(handlers.get(name) ?? []), handler]);
        return { name };
      },
      getFiles: () => [...nodes.values()].filter((n): n is TFile => n instanceof TFile),
      getMarkdownFiles: () =>
        [...nodes.values()].filter((n): n is TFile => n instanceof TFile && n.extension === "md"),
      getAbstractFileByPath: (path: string) => nodes.get(path) ?? null,
      getFileByPath: (path: string) => {
        const n = nodes.get(path);
        return n instanceof TFile ? n : null;
      },
      getFolderByPath: (path: string) => {
        const n = nodes.get(path);
        return n instanceof MemoryFolder ? n : null;
      },
      createFolder: async (path: string) => {
        if (nodes.has(path)) throw new Error(`exists: ${path}`);
        emit("create", folder(path));
      },
      copy: async (from: TFile, to: string) => {
        if (nodes.has(to)) throw new Error(`exists: ${to}`);
        if (!nodes.has(parentOf(to)) && parentOf(to)) throw new Error(`no folder: ${to}`);
        const made = file(to, texts.get(from.path));
        emit("create", made);
        return made;
      },
      cachedRead: async (f: TFile) => texts.get(f.path) ?? "",
      read: async (f: TFile) => texts.get(f.path) ?? "",
    },
    fileManager: {
      renameFile: async (node: Node, to: string) => {
        if (nodes.has(to)) throw new Error(`exists: ${to}`);
        const from = node.path;
        detach(node);
        const moved: [Node, string][] = [];
        for (const path of below(from)) {
          const old = nodes.get(path)!;
          nodes.delete(path);
          const at = to + path.slice(from.length);
          const copy = old instanceof MemoryFolder ? new MemoryFolder(at) : new TFile(at);
          nodes.set(at, copy);
          if (texts.has(path)) texts.set(at, texts.get(path)!);
          moved.push([copy, path]);
        }
        for (const [n] of moved) {
          if (n instanceof MemoryFolder) n.children = [];
        }
        for (const [n] of moved) attach(n);
        // Obsidian renames the thing and everything below it, the thing first.
        for (const [n, old] of moved) emit("rename", n, old);
      },
      trashFile: async (node: Node) => {
        detach(node);
        const gone = below(node.path).map((path) => nodes.get(path)!);
        for (const n of gone) nodes.delete(n.path);
        trashed.push(node.path);
        // Obsidian reports what was inside first, then the thing itself.
        for (const n of gone.reverse()) emit("delete", n);
      },
    },
  };
  return {
    app,
    trashed,
    /** Fire a vault event, as a sync or another view would. */
    emit,
    /** Every file, sorted. */
    files: () => [...nodes.keys()].filter((p) => nodes.get(p) instanceof TFile).sort(),
    /** Every folder, sorted. */
    folders: () => [...nodes.keys()].filter((p) => nodes.get(p) instanceof MemoryFolder).sort(),
  };
}
