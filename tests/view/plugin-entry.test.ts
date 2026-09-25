/**
 * The plugin entry (`src/main.ts`) as Obsidian sees it: what `onload`
 * registers, which view a file opens in, how saved settings load, and the
 * one-off notices and flows that live there (What's new, the Scribble tip,
 * consent before recognition, OpenRouter's one-click connect, the debug
 * overlay). Obsidian is the stand-in from `fake-obsidian.ts`; the dialogs and
 * the network are replaced where a test needs to answer for the user.
 *
 * Written to pin the behaviour of the entry as it stood at 0.9.0, before it
 * was rewritten, so that the rewrite is held to it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type FakeCommand,
  MarkdownView,
  Platform,
  TFile,
  WorkspaceLeaf,
  notices,
  resetFakes,
  viewStateCalls,
} from "./fake-obsidian";

const CHANGELOG = [
  "# Changelog",
  "",
  "## [Unreleased]",
  "",
  "- Not out yet.",
  "",
  "## [0.9.0] - 2026-09-25",
  "",
  "- Nine.",
  "",
  "## [0.8.1] - 2026-09-24",
  "",
  "- Eight point one.",
  "",
  "## [0.8.0] - 2026-09-23",
  "",
  "- Eight.",
  "",
].join("\n");

const hooks = vi.hoisted(() => ({
  whatsNew: [] as string[],
  confirmAnswer: true,
  confirms: 0,
  post: null as null | ((url: string, headers: unknown, body: unknown) => Promise<unknown>),
  posts: [] as { url: string; headers: unknown; body: unknown }[],
}));

vi.mock("obsidian", () => import("./fake-obsidian"));
vi.mock("../../CHANGELOG.md", () => ({ default: CHANGELOG }));
vi.mock("../../src/ui/whats-new-modal", () => ({
  WhatsNewModal: class {
    constructor(
      _app: unknown,
      private readonly markdown: string,
    ) {}
    open(): void {
      hooks.whatsNew.push(this.markdown);
    }
  },
}));
vi.mock("../../src/ui/confirm-modal", () => ({
  ConfirmModal: {
    confirm: (): Promise<boolean> => {
      hooks.confirms++;
      return Promise.resolve(hooks.confirmAnswer);
    },
  },
}));
vi.mock("../../src/recognition/http", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  postJson: (url: string, headers: unknown, body: unknown): Promise<unknown> => {
    hooks.posts.push({ url, headers, body });
    if (!hooks.post) return Promise.reject(new Error("no network"));
    return hooks.post(url, headers, body);
  },
}));

const { default: GoodObsidianPlugin } = await import("../../src/main");
const { InkView } = await import("../../src/view/ink-view");
const { DEFAULT_SETTINGS } = await import("../../src/settings");
const { codeChallenge } = await import("../../src/recognition/openrouter-auth");

type Plugin = InstanceType<typeof GoodObsidianPlugin>;

/** The plugin as the fake base class exposes it, for reading what it registered. */
interface Registered {
  commands: FakeCommand[];
  views: Map<string, unknown>;
  protocolHandlers: Map<string, (params: Record<string, string>) => unknown>;
  ribbon: { icon: string; title: string }[];
  stored: unknown;
  saved: Record<string, unknown>[];
  unload(): void;
}

const INK = "goodobsidian-view";
const VERSION = "0.9.0";

// --- A fake app -----------------------------------------------------------------

interface FakeApp {
  workspace: {
    leaves: WorkspaceLeaf[];
    active: unknown;
    trigger(name: string): void;
    fireLayoutReady(): void;
  };
  addFile(path: string, frontmatter?: Record<string, unknown>): TFile;
  secrets: Map<string, string>;
}

function fakeApp(keychain = true): FakeApp & Record<string, unknown> {
  const files = new Map<string, TFile>();
  const frontmatter = new Map<string, Record<string, unknown>>();
  const handlers = new Map<string, (() => void)[]>();
  const ready: (() => void)[] = [];
  const secrets = new Map<string, string>();
  const workspace = {
    leaves: [] as WorkspaceLeaf[],
    active: null as unknown,
    on(name: string, callback: () => void) {
      handlers.set(name, [...(handlers.get(name) ?? []), callback]);
      return { name };
    },
    trigger(name: string) {
      for (const callback of handlers.get(name) ?? []) callback();
    },
    onLayoutReady(callback: () => void) {
      ready.push(callback);
    },
    fireLayoutReady() {
      for (const callback of ready) callback();
    },
    getLeavesOfType(type: string) {
      return workspace.leaves.filter((leaf) => leaf.getViewState().type === type);
    },
    getActiveViewOfType(type: abstract new (...args: never[]) => unknown) {
      return workspace.active instanceof type ? workspace.active : null;
    },
    getActiveFile: () => null,
  };
  return {
    workspace,
    vault: {
      getAbstractFileByPath: (path: string) => files.get(path) ?? null,
      getFileByPath: (path: string) => files.get(path) ?? null,
    },
    metadataCache: {
      getFileCache: (file: TFile) => {
        const fm = frontmatter.get(file.path);
        return fm ? { frontmatter: fm } : null;
      },
    },
    secretStorage: keychain
      ? {
          getSecret: (id: string) => secrets.get(id) ?? null,
          setSecret: (id: string, value: string) => {
            if (value) secrets.set(id, value);
            else secrets.delete(id);
          },
        }
      : undefined,
    secrets,
    addFile(path: string, fm?: Record<string, unknown>) {
      const file = new TFile(path);
      files.set(path, file);
      if (fm) frontmatter.set(path, fm);
      return file;
    },
  };
}

let app: ReturnType<typeof fakeApp>;
let plugin: Plugin;
let registered: Registered;
let opened: string[];

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function load(stored: unknown = null, version = VERSION, keychain = true): Promise<void> {
  app = fakeApp(keychain);
  plugin = new GoodObsidianPlugin(
    app as never,
    {
      id: "goodobsidian",
      name: "GoodObsidian",
      version,
    } as never,
  );
  registered = plugin as unknown as Registered;
  registered.stored = stored;
  await plugin.onload();
}

function command(id: string): FakeCommand {
  const found = registered.commands.find((c) => c.id === id);
  if (!found) throw new Error(`no command ${id}`);
  return found;
}

/** Whether a command is offered right now (the palette's "checking" call). */
function offered(id: string): boolean {
  const c = command(id);
  return c.checkCallback ? c.checkCallback(true) === true : true;
}

function run(id: string): void {
  const c = command(id);
  if (c.checkCallback) c.checkCallback(false);
  else c.callback?.();
}

/** An ink view without its DOM: an `InkView` whose members the test sets. */
function inkView(members: Record<string, unknown> = {}): InstanceType<typeof InkView> {
  const view = Object.create(InkView.prototype) as InstanceType<typeof InkView>;
  for (const [key, value] of Object.entries(members)) {
    Object.defineProperty(view, key, { value, writable: true, configurable: true });
  }
  return view;
}

function markdownLeaf(file: TFile | null, extra: Record<string, unknown> = {}): WorkspaceLeaf {
  const leaf = new WorkspaceLeaf(app);
  const view = new MarkdownView(leaf);
  view.file = file;
  leaf.view = view;
  leaf.state = { type: "markdown", state: { file: file?.path, mode: "preview" }, ...extra };
  app.workspace.leaves.push(leaf);
  return leaf;
}

function inkLeaf(file: TFile, members: Record<string, unknown> = {}): WorkspaceLeaf {
  const leaf = new WorkspaceLeaf(app);
  leaf.view = inkView({ file, leaf, ...members });
  leaf.state = { type: INK, state: { file: file.path }, active: true };
  app.workspace.leaves.push(leaf);
  return leaf;
}

const openWindow = vi.fn();

beforeEach(() => {
  resetFakes();
  hooks.whatsNew.length = 0;
  hooks.confirmAnswer = true;
  hooks.confirms = 0;
  hooks.post = null;
  hooks.posts.length = 0;
  opened = hooks.whatsNew;
  openWindow.mockReset();
  vi.stubGlobal("window", Object.assign(Object.create(globalThis) as object, { open: openWindow }));
});

afterEach(() => {
  registered?.unload();
  vi.unstubAllGlobals();
});

// --- What onload registers ----------------------------------------------------------

describe("registration", () => {
  it("keeps every command id users may have bound a hotkey to", async () => {
    await load();
    expect(registered.commands.map((c) => c.id).sort()).toEqual(
      [
        "convert-to-notebook",
        "copy-page-link",
        "copy-shape-diagnostics",
        "create-handwriting-note",
        "create-notebook-with-last-settings",
        "export-pdf",
        "fit-reset-view",
        "recognize-handwriting",
        "scan-document",
        "search-notebook",
        "toggle-canvas-markdown-view",
        "toggle-input-debug-overlay",
        "toggle-text-layer",
        "view-changelog",
        "zoom-in",
        "zoom-out",
      ].sort(),
    );
    for (const c of registered.commands) expect(c.name.trim()).not.toBe("");
  });

  it("registers the notebook view, the ribbon button and the OpenRouter callback", async () => {
    await load();
    expect([...registered.views.keys()]).toEqual([INK]);
    expect(registered.ribbon.map((r) => r.icon)).toEqual(["notebook-pen"]);
    expect(registered.ribbon[0].title).toBe("New notebook");
    expect([...registered.protocolHandlers.keys()]).toEqual(["goodobsidian-openrouter"]);
  });

  it("builds an InkView for a leaf", async () => {
    await load();
    const factory = registered.views.get(INK) as (leaf: WorkspaceLeaf) => unknown;
    expect(factory(new WorkspaceLeaf(app))).toBeInstanceOf(InkView);
  });
});

// --- Commands that act on the open notebook -------------------------------------------

describe("notebook commands", () => {
  const simple: [string, string][] = [
    ["scan-document", "scanDocument"],
    ["search-notebook", "openSearch"],
    ["copy-page-link", "copyPageLink"],
    ["export-pdf", "exportPdf"],
    ["toggle-text-layer", "toggleTextPanel"],
    ["fit-reset-view", "resetView"],
    ["zoom-in", "zoomIn"],
    ["zoom-out", "zoomOut"],
  ];

  it.each(simple)("%s is offered only in a notebook, and calls %s", async (id, method) => {
    await load();
    expect(offered(id)).toBe(false);
    app.workspace.active = new MarkdownView();
    expect(offered(id)).toBe(false);
    const spy = vi.fn(() => Promise.resolve());
    app.workspace.active = inkView({ [method]: spy });
    expect(offered(id)).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    run(id);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("convert-to-notebook is offered only on a single page", async () => {
    await load();
    const convert = vi.fn();
    app.workspace.active = inkView({ isSinglePage: false, convertToNotebook: convert });
    expect(offered("convert-to-notebook")).toBe(false);
    app.workspace.active = inkView({ isSinglePage: true, convertToNotebook: convert });
    expect(offered("convert-to-notebook")).toBe(true);
    expect(convert).not.toHaveBeenCalled();
    run("convert-to-notebook");
    expect(convert).toHaveBeenCalledTimes(1);
  });

  it("recognize-handwriting runs the selected provider on the notebook", async () => {
    await load();
    const recognize = vi.fn(() => Promise.resolve());
    app.workspace.active = inkView({ recognize });
    expect(offered("recognize-handwriting")).toBe(true);
    run("recognize-handwriting");
    await flush();
    expect(recognize).toHaveBeenCalledTimes(1);
    const [provider, auto] = recognize.mock.calls[0] as unknown as [{ id: string }, boolean];
    expect(provider.id).toBe("manual");
    expect(auto).toBe(false);
  });

  it("view-changelog opens every released section", async () => {
    await load();
    run("view-changelog");
    expect(opened).toHaveLength(1);
    expect(opened[0]).toContain("Nine.");
    expect(opened[0]).toContain("Eight.");
    expect(opened[0]).not.toContain("Not out yet.");
  });
});

// --- Which view a file opens in -------------------------------------------------------

describe("view routing on open", () => {
  it.each([
    ["Physics.notebook.md"],
    ["Sketch.page.md"],
    ["Old.ink.md"],
    ["Loud.NOTEBOOK.md"],
    ["Folder/Deep/Physics.notebook.md"],
  ])("opens %s in the notebook view", async (path) => {
    await load();
    app.addFile(path);
    const leaf = new WorkspaceLeaf(app);
    const asked = { type: "markdown", state: { file: path, mode: "source" }, active: true };
    const eState = { focus: true };
    await leaf.setViewState(asked, eState);
    expect(viewStateCalls).toHaveLength(1);
    expect(viewStateCalls[0].state).toEqual({ ...asked, type: INK });
    expect(viewStateCalls[0].eState).toBe(eState);
    // The caller's object is left alone.
    expect(asked.type).toBe("markdown");
  });

  it.each([
    [{ goodobsidian: true }, INK],
    [{ inkedmark: true }, INK],
    [{ goodobsidian: "true" }, "markdown"],
    [{ goodobsidian: false }, "markdown"],
    [{ inkedmark: 1 }, "markdown"],
    [{ tags: ["x"] }, "markdown"],
  ])("a plain .md file with frontmatter %j opens as %s", async (fm, type) => {
    await load();
    app.addFile("Note.md", fm);
    await new WorkspaceLeaf(app).setViewState({ type: "markdown", state: { file: "Note.md" } });
    expect(viewStateCalls[0].state.type).toBe(type);
  });

  it("leaves other files, other types and odd states alone", async () => {
    await load();
    app.addFile("Plain.md");
    app.addFile("Drawing.notebook.canvas");
    app.addFile("Physics.notebook.md");
    const states = [
      { type: "markdown", state: { file: "Plain.md" } },
      { type: "markdown", state: { file: "Drawing.notebook.canvas" } },
      { type: "markdown", state: { file: "Missing.notebook.md" } },
      { type: "markdown", state: {} },
      { type: "markdown" },
      { type: "markdown", state: { file: 7 } },
      { type: "pdf", state: { file: "Physics.notebook.md" } },
      { type: INK, state: { file: "Physics.notebook.md" } },
      { type: "empty", state: {} },
    ];
    for (const state of states) await new WorkspaceLeaf(app).setViewState(state);
    expect(viewStateCalls.map((c) => c.state)).toEqual(states);
  });

  it("puts the original setViewState back on unload", async () => {
    const original = WorkspaceLeaf.prototype.setViewState.bind(WorkspaceLeaf.prototype);
    const before = Object.getOwnPropertyDescriptor(WorkspaceLeaf.prototype, "setViewState");
    await load();
    expect(Object.getOwnPropertyDescriptor(WorkspaceLeaf.prototype, "setViewState")).not.toEqual(
      before,
    );
    registered.unload();
    expect(Object.getOwnPropertyDescriptor(WorkspaceLeaf.prototype, "setViewState")).toEqual(
      before,
    );
    app.addFile("Physics.notebook.md");
    await new WorkspaceLeaf(app).setViewState({
      type: "markdown",
      state: { file: "Physics.notebook.md" },
    });
    expect(viewStateCalls[0].state.type).toBe("markdown");
    expect(typeof original).toBe("function");
  });
});

describe("view routing of open leaves", () => {
  it("switches markdown leaves that show ink files when the layout changes", async () => {
    await load();
    const ink = app.addFile("Physics.notebook.md");
    const flagged = app.addFile("Flagged.md", { goodobsidian: true });
    const plain = app.addFile("Plain.md");
    const inkLeafA = markdownLeaf(ink, { active: true, pinned: true });
    const flaggedLeaf = markdownLeaf(flagged);
    markdownLeaf(plain);
    markdownLeaf(null);
    const other = new WorkspaceLeaf(app);
    other.view = {};
    other.state = { type: "markdown", state: { file: ink.path } };
    app.workspace.leaves.push(other);

    app.workspace.trigger("layout-change");
    await flush();

    expect(viewStateCalls.map((c) => c.leaf)).toEqual([inkLeafA, flaggedLeaf]);
    expect(viewStateCalls[0].state).toEqual({
      type: INK,
      state: { file: ink.path, mode: "source" },
      active: true,
      pinned: true,
    });
    expect(viewStateCalls[1].state).toEqual({
      type: INK,
      state: { file: flagged.path, mode: "source" },
    });
  });

  it("does the same once the layout is ready", async () => {
    await load();
    const leaf = markdownLeaf(app.addFile("Physics.notebook.md"));
    app.workspace.fireLayoutReady();
    await flush();
    expect(viewStateCalls.map((c) => c.leaf)).toEqual([leaf]);
    expect(viewStateCalls[0].state.type).toBe(INK);
  });
});

describe("toggling between the notebook and markdown", () => {
  it("is offered for a notebook, and for markdown showing an ink file", async () => {
    await load();
    expect(offered("toggle-canvas-markdown-view")).toBe(false);
    const file = app.addFile("Physics.notebook.md");
    app.workspace.active = inkView({ file });
    expect(offered("toggle-canvas-markdown-view")).toBe(true);
    app.workspace.active = inkView({ file: null });
    expect(offered("toggle-canvas-markdown-view")).toBe(false);
    const md = new MarkdownView();
    md.file = file;
    app.workspace.active = md;
    expect(offered("toggle-canvas-markdown-view")).toBe(true);
    md.file = app.addFile("Plain.md");
    expect(offered("toggle-canvas-markdown-view")).toBe(false);
    md.file = null;
    expect(offered("toggle-canvas-markdown-view")).toBe(false);
    expect(viewStateCalls).toHaveLength(0);
  });

  it("goes to markdown, stays there, and comes back", async () => {
    await load();
    const file = app.addFile("Physics.notebook.md");
    const leaf = inkLeaf(file);
    leaf.state = { type: INK, state: { file: file.path, scroll: 3 }, active: true };
    app.workspace.active = leaf.view;

    run("toggle-canvas-markdown-view");
    await flush();
    expect(viewStateCalls).toHaveLength(1);
    expect(viewStateCalls[0].leaf).toBe(leaf);
    expect(viewStateCalls[0].state).toEqual({
      type: "markdown",
      state: { file: file.path, scroll: 3, mode: "source" },
      active: true,
    });

    // The layout change that follows does not flip it straight back...
    const md = new MarkdownView(leaf);
    md.file = file;
    leaf.view = md;
    app.workspace.trigger("layout-change");
    await flush();
    expect(viewStateCalls).toHaveLength(1);
    // ...nor does opening the same file elsewhere.
    await new WorkspaceLeaf(app).setViewState({ type: "markdown", state: { file: file.path } });
    expect(viewStateCalls[1].state.type).toBe("markdown");

    // And back.
    app.workspace.active = md;
    run("toggle-canvas-markdown-view");
    await flush();
    expect(viewStateCalls[2].leaf).toBe(leaf);
    expect(viewStateCalls[2].state).toEqual({
      type: INK,
      state: { file: file.path, scroll: 3, mode: "source" },
      active: true,
    });
    // From now on the file opens as a notebook again.
    await new WorkspaceLeaf(app).setViewState({ type: "markdown", state: { file: file.path } });
    expect(viewStateCalls[3].state.type).toBe(INK);
  });
});

// --- Settings --------------------------------------------------------------------------

describe("loading settings", () => {
  it("starts from the defaults when nothing is saved", async () => {
    await load(null);
    expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
    expect(plugin.settings).not.toBe(DEFAULT_SETTINGS);
    plugin.settings.apiKeys.openai = "x";
    expect(DEFAULT_SETTINGS.apiKeys).toEqual({});
  });

  it("lays saved values over the defaults, one level deep", async () => {
    await load({ defaultSize: 8, lassoFilter: { ink: false }, futureSetting: 42 });
    expect(plugin.settings.defaultSize).toBe(8);
    expect(plugin.settings.pressureEnabled).toBe(DEFAULT_SETTINGS.pressureEnabled);
    expect(plugin.settings.lassoFilter).toEqual({ ink: false });
    expect((plugin.settings as unknown as Record<string, unknown>).futureSetting).toBe(42);
  });

  it("keeps a saved key record, and replaces one that is not a record", async () => {
    await load({ apiKeys: { openai: "sk-1" } }, VERSION, false);
    expect(plugin.settings.apiKeys).toEqual({ openai: "sk-1" });
    expect(plugin.keys.secure).toBe(false);
    expect(plugin.keys.get("openai")).toBe("sk-1");
    registered.unload();
    await load({ apiKeys: "sk-1" }, VERSION, false);
    expect(plugin.settings.apiKeys).toEqual({});
    registered.unload();
    await load({ apiKeys: null }, VERSION, false);
    expect(plugin.settings.apiKeys).toEqual({});
  });

  it("moves plain-text keys into the keychain, and says so", async () => {
    await load({ apiKeys: { openai: "sk-1" }, lastSeenVersion: VERSION });
    expect(plugin.keys.secure).toBe(true);
    expect(plugin.keys.get("openai")).toBe("sk-1");
    expect(plugin.settings.apiKeys).toEqual({});
    expect(registered.saved.at(-1)?.apiKeys).toEqual({});
    expect(notices).toHaveLength(1);
    expect(notices[0].message).toMatch(/keychain/i);
  });

  it("keeps an unassigned pre-0.5 key working for the selected cloud vendor only", async () => {
    await load({ llmApiKey: "  legacy  ", llmVendor: "anthropic", lastSeenVersion: VERSION });
    // Whether it moved or stayed, the selected vendor reads it and no other does.
    expect(plugin.apiKeyFor("anthropic")).toBe("legacy");
    expect(plugin.apiKeyFor("custom")).toBe("");
  });

  it("lands a removed recognition provider on Manual and drops its settings", async () => {
    await load({
      recognitionProviderId: "trocr-local",
      experimentalTrocr: true,
      trocrModel: "base",
      lastSeenVersion: VERSION,
    });
    expect(plugin.settings.recognitionProviderId).toBe("manual");
    const loaded = plugin.settings as unknown as Record<string, unknown>;
    expect("experimentalTrocr" in loaded).toBe(false);
    expect("trocrModel" in loaded).toBe(false);
    await plugin.saveSettings();
    expect(registered.saved.at(-1)).not.toHaveProperty("trocrModel");
  });

  it("keeps the cloud AI provider", async () => {
    await load({ recognitionProviderId: "llm-byok" });
    expect(plugin.settings.recognitionProviderId).toBe("llm-byok");
    expect(plugin.activeProvider().id).toBe("llm-byok");
  });
});

describe("settings after a change of plugin id", () => {
  const OLD_FILE = ".obsidian/plugins/goodobsidian/data.json";
  let reads: string[];

  /** Load under `id`, with `oldFile` as the old folder's data.json (null: none). */
  async function loadAs(id: string, oldFile: string | null, own: unknown = null): Promise<void> {
    reads = [];
    app = fakeApp();
    Object.assign(app.vault as object, {
      configDir: ".obsidian",
      adapter: {
        exists: (path: string) => Promise.resolve(path === OLD_FILE && oldFile !== null),
        read: (path: string) => {
          reads.push(path);
          return oldFile === null ? Promise.reject(new Error("missing")) : Promise.resolve(oldFile);
        },
      },
    });
    plugin = new GoodObsidianPlugin(
      app as never,
      { id, name: "Renamed", version: VERSION } as never,
    );
    registered = plugin as unknown as Registered;
    registered.stored = own;
    await plugin.onload();
  }

  it("carries the old id's settings over once, into the new folder", async () => {
    await loadAs("inkbook", JSON.stringify({ defaultSize: 8, lastSeenVersion: VERSION }));
    expect(plugin.settings.defaultSize).toBe(8);
    expect(registered.saved[0]).toMatchObject({ defaultSize: 8 });
    expect(reads).toEqual([OLD_FILE]);
  });

  it("prefers the new folder's own settings", async () => {
    await loadAs("inkbook", JSON.stringify({ defaultSize: 8 }), { defaultSize: 5 });
    expect(plugin.settings.defaultSize).toBe(5);
    expect(reads).toEqual([]);
  });

  it("never looks for itself under the old id", async () => {
    await loadAs("goodobsidian", JSON.stringify({ defaultSize: 8 }));
    expect(plugin.settings.defaultSize).toBe(DEFAULT_SETTINGS.defaultSize);
    expect(reads).toEqual([]);
  });

  it.each([["not json"], ["[1, 2]"], ["null"]])("starts from the defaults on %j", async (text) => {
    await loadAs("inkbook", text);
    expect(plugin.settings.defaultSize).toBe(DEFAULT_SETTINGS.defaultSize);
  });

  it("starts from the defaults when there is no old folder", async () => {
    await loadAs("inkbook", null);
    expect(plugin.settings).toMatchObject({ defaultSize: DEFAULT_SETTINGS.defaultSize });
    expect(reads).toEqual([]);
  });
});

// --- What's new --------------------------------------------------------------------------

describe("What's new", () => {
  it("stays silent on a fresh install, and remembers the version", async () => {
    await load(null);
    app.workspace.fireLayoutReady();
    await flush();
    expect(opened).toEqual([]);
    expect(registered.saved.at(-1)?.lastSeenVersion).toBe(VERSION);
  });

  it("shows what came since the last version seen", async () => {
    await load({ lastSeenVersion: "0.8.0" });
    app.workspace.fireLayoutReady();
    await flush();
    expect(opened).toHaveLength(1);
    expect(opened[0]).toContain("Nine.");
    expect(opened[0]).toContain("Eight point one.");
    expect(opened[0]).not.toContain("Eight.\n");
    expect(registered.saved.at(-1)?.lastSeenVersion).toBe(VERSION);
  });

  it("shows only the newest section when the last version is unknown", async () => {
    await load({ defaultSize: 3 });
    app.workspace.fireLayoutReady();
    await flush();
    expect(opened).toHaveLength(1);
    expect(opened[0]).toContain("Nine.");
    expect(opened[0]).not.toContain("Eight");
  });

  it("does nothing when the version is the one already seen", async () => {
    await load({ lastSeenVersion: VERSION });
    app.workspace.fireLayoutReady();
    await flush();
    expect(opened).toEqual([]);
    expect(registered.saved).toEqual([]);
  });

  it("records a downgrade without showing anything", async () => {
    await load({ lastSeenVersion: "1.2.0" });
    app.workspace.fireLayoutReady();
    await flush();
    expect(opened).toEqual([]);
    expect(registered.saved.at(-1)?.lastSeenVersion).toBe(VERSION);
  });
});

// --- The Scribble tip ------------------------------------------------------------------

describe("the Scribble notice", () => {
  it("shows once, on an iPad, and stays until dismissed", async () => {
    await load({ lastSeenVersion: VERSION });
    Object.assign(Platform, { isIosApp: true, isTablet: true, isMobile: true });
    await plugin.maybeShowScribbleNotice();
    expect(notices).toHaveLength(1);
    expect(notices[0].timeout).toBe(0);
    expect(notices[0].message).toMatch(/Scribble/);
    expect(plugin.settings.scribbleNoticeShown).toBe(true);
    expect(registered.saved.at(-1)?.scribbleNoticeShown).toBe(true);
    await plugin.maybeShowScribbleNotice();
    expect(notices).toHaveLength(1);
  });

  it("is not shown on an iPhone or a desktop, and not again after a sync", async () => {
    await load({ lastSeenVersion: VERSION });
    Object.assign(Platform, { isIosApp: true, isTablet: false, isPhone: true });
    await plugin.maybeShowScribbleNotice();
    Object.assign(Platform, { isIosApp: false, isTablet: true });
    await plugin.maybeShowScribbleNotice();
    expect(notices).toEqual([]);
    expect(registered.saved).toEqual([]);
    registered.unload();
    await load({ lastSeenVersion: VERSION, scribbleNoticeShown: true });
    Object.assign(Platform, { isIosApp: true, isTablet: true });
    await plugin.maybeShowScribbleNotice();
    expect(notices).toEqual([]);
  });
});

// --- Consent before recognition -----------------------------------------------------------

describe("running recognition", () => {
  function target() {
    return { recognize: vi.fn((_provider: unknown, _auto?: boolean) => Promise.resolve()) };
  }

  it("runs Manual straight away, asking nothing", async () => {
    await load({ lastSeenVersion: VERSION });
    const t = target();
    await plugin.runRecognition(t, true);
    expect(hooks.confirms).toBe(0);
    expect(t.recognize).toHaveBeenCalledWith(expect.objectContaining({ id: "manual" }), true);
  });

  it("never asks from a background run, and skips it without consent", async () => {
    await load({ lastSeenVersion: VERSION, recognitionProviderId: "llm-byok" });
    const t = target();
    await plugin.runRecognition(t, true);
    expect(hooks.confirms).toBe(0);
    expect(t.recognize).not.toHaveBeenCalled();
  });

  it("asks once before the first cloud run, and remembers a yes", async () => {
    await load({ lastSeenVersion: VERSION, recognitionProviderId: "llm-byok" });
    const t = target();
    await plugin.runRecognition(t);
    expect(hooks.confirms).toBe(1);
    expect(t.recognize).toHaveBeenCalledWith(expect.objectContaining({ id: "llm-byok" }), false);
    expect(plugin.settings.cloudConsentGiven).toBe(true);
    expect(registered.saved.at(-1)?.cloudConsentGiven).toBe(true);
    await plugin.runRecognition(t, true);
    expect(hooks.confirms).toBe(1);
    expect(t.recognize).toHaveBeenCalledTimes(2);
  });

  it("does nothing on a no", async () => {
    await load({ lastSeenVersion: VERSION, recognitionProviderId: "llm-byok" });
    hooks.confirmAnswer = false;
    const t = target();
    await plugin.runRecognition(t);
    expect(hooks.confirms).toBe(1);
    expect(t.recognize).not.toHaveBeenCalled();
    expect(plugin.settings.cloudConsentGiven).toBe(false);
  });

  it("treats the custom endpoint as a separate destination", async () => {
    await load({
      lastSeenVersion: VERSION,
      recognitionProviderId: "llm-byok",
      llmVendor: "custom",
      cloudConsentGiven: true,
    });
    const t = target();
    await plugin.runRecognition(t, true);
    expect(t.recognize).not.toHaveBeenCalled();
    await plugin.runRecognition(t);
    expect(hooks.confirms).toBe(1);
    expect(plugin.settings.customConsentGiven).toBe(true);
    expect(t.recognize).toHaveBeenCalledTimes(1);
  });
});

// --- OpenRouter's one-click connect ------------------------------------------------------

describe("OpenRouter connect", () => {
  function challengeOf(url: string): string {
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://openrouter.ai/auth");
    expect(parsed.searchParams.get("callback_url")).toBe("obsidian://goodobsidian-openrouter");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    return parsed.searchParams.get("code_challenge") ?? "";
  }

  async function connect(): Promise<string> {
    await plugin.startOpenRouterConnect();
    const url = openWindow.mock.calls.at(-1)?.[0] as string;
    return challengeOf(url);
  }

  function callback(params: Record<string, string>): Promise<void> {
    const handler = registered.protocolHandlers.get("goodobsidian-openrouter");
    if (!handler) throw new Error("no handler");
    handler(params);
    return flush();
  }

  it("reuses the same challenge until it is used or cancelled", async () => {
    await load({ lastSeenVersion: VERSION });
    const first = await connect();
    expect(first).not.toBe("");
    expect(await connect()).toBe(first);
    plugin.cancelOpenRouterConnect();
    expect(await connect()).not.toBe(first);
  });

  it("trades the code for a key, stores it and selects OpenRouter", async () => {
    await load({ lastSeenVersion: VERSION, llmVendor: "anthropic" });
    const challenge = await connect();
    hooks.post = () => Promise.resolve({ status: 200, json: { key: "sk-or-v1-abc" } });
    await callback({ action: "goodobsidian-openrouter", code: "one-time" });

    expect(hooks.posts).toHaveLength(1);
    const sent = hooks.posts[0];
    expect(sent.url).toBe("https://openrouter.ai/api/v1/auth/keys");
    const body = sent.body as Record<string, string>;
    expect(body.code).toBe("one-time");
    expect(body.code_challenge_method).toBe("S256");
    expect(await codeChallenge(body.code_verifier)).toBe(challenge);

    expect(plugin.keys.get("openrouter")).toBe("sk-or-v1-abc");
    expect(plugin.settings.llmVendor).toBe("openrouter");
    expect(registered.saved.at(-1)?.llmVendor).toBe("openrouter");
    expect(notices.at(-1)?.message).toMatch(/connected/i);

    // The verifier is spent: a replayed redirect finds nothing pending.
    await callback({ code: "one-time" });
    expect(hooks.posts).toHaveLength(1);
  });

  it("refreshes the settings tab when it is on screen", async () => {
    await load({ lastSeenVersion: VERSION });
    const tab = (plugin as unknown as { settingTabs: { containerEl: { isConnected: boolean } }[] })
      .settingTabs[0] as { containerEl: { isConnected: boolean }; refresh: () => void };
    const refresh = vi.fn();
    tab.refresh = refresh;
    await connect();
    hooks.post = () => Promise.resolve({ status: 200, json: { key: "k1" } });
    await callback({ code: "c" });
    expect(refresh).not.toHaveBeenCalled();
    tab.containerEl.isConnected = true;
    await connect();
    await callback({ code: "c" });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("gives up with a notice when there is no code or nothing pending", async () => {
    await load({ lastSeenVersion: VERSION });
    await callback({});
    expect(notices).toHaveLength(1);
    await callback({ code: "c" });
    expect(notices).toHaveLength(2);
    expect(hooks.posts).toEqual([]);
    // No code does not spend a pending verifier.
    const challenge = await connect();
    await callback({});
    expect(await connect()).toBe(challenge);
  });

  it.each([
    ["the network fails", () => Promise.reject(new Error("offline"))],
    ["the server refuses", () => Promise.resolve({ status: 401, json: {} })],
    ["no key comes back", () => Promise.resolve({ status: 200, json: { nope: 1 } })],
    ["the body is unreadable", () => Promise.resolve({ status: 200, json: null })],
  ])("stores nothing when %s", async (_what, reply) => {
    await load({ lastSeenVersion: VERSION, llmVendor: "anthropic" });
    await connect();
    hooks.post = reply as never;
    await callback({ code: "c" });
    expect(plugin.keys.get("openrouter")).toBe("");
    expect(plugin.settings.llmVendor).toBe("anthropic");
    expect(notices).toHaveLength(1);
    // The attempt spent the verifier either way.
    await callback({ code: "c" });
    expect(hooks.posts).toHaveLength(1);
  });

  it("says which status the exchange failed with", async () => {
    await load({ lastSeenVersion: VERSION });
    await connect();
    hooks.post = () => Promise.resolve({ status: 503, json: {} });
    await callback({ code: "c" });
    expect(notices[0].message).toContain("503");
  });
});

// --- The debug overlay ---------------------------------------------------------------------

describe("the input debug overlay", () => {
  it("switches every open notebook, saves, and says so from the command", async () => {
    await load({ lastSeenVersion: VERSION });
    const a = vi.fn();
    const b = vi.fn();
    inkLeaf(app.addFile("A.notebook.md"), { setDebug: a });
    inkLeaf(app.addFile("B.notebook.md"), { setDebug: b });
    markdownLeaf(app.addFile("Plain.md"));

    run("toggle-input-debug-overlay");
    await flush();
    expect(plugin.settings.debugHud).toBe(true);
    expect(registered.saved.at(-1)?.debugHud).toBe(true);
    expect(a).toHaveBeenCalledWith(true);
    expect(b).toHaveBeenCalledWith(true);
    expect(notices).toHaveLength(1);

    await plugin.setDebugHud(false);
    expect(a).toHaveBeenLastCalledWith(false);
    expect(plugin.settings.debugHud).toBe(false);
    expect(notices).toHaveLength(1);
  });
});
