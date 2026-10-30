/**
 * The settings tab as Obsidian 1.13 drives it: the definitions it returns
 * (which rows, in what order, when each is shown), the conversions between
 * what a control shows and what `data.json` stores, and the rows it renders
 * itself (paper width, endpoint URL, notebook folder, API keys, OpenRouter).
 *
 * Wording is deliberately not pinned, apart from the words a row cannot do
 * without (the paper-width limits, a vendor's default model).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetState, ModelAsset } from "../../src/downloads/model-manifest";

vi.mock("obsidian", () => import("../fakes/obsidian"));

const dialogs = vi.hoisted(() => ({
  keyModals: [] as Array<{
    title: string;
    placeholder: string;
    where: string;
    onSave: (key: string) => void;
  }>,
  confirms: [] as Array<{ title: string; message: string; cta: string }>,
  confirmAnswer: true,
  folderSuggests: [] as Array<{ inputEl: unknown; onPick: (path: string) => void }>,
  penModals: [] as Array<{
    pen: { type: string; color: string; size: number };
    index: number | null;
    pens: readonly unknown[];
    highlighterAlpha: number;
    onCustomColor?: (color: string) => void;
    onSave: (pen: { type: string; color: string; size: number }) => void;
  }>,
}));

vi.mock("../../src/ui/api-key-modal", () => ({
  ApiKeyModal: class {
    constructor(_app: unknown, options: (typeof dialogs.keyModals)[number]) {
      dialogs.keyModals.push(options);
    }
    open(): void {}
  },
}));
vi.mock("../../src/ui/confirm-modal", () => ({
  ConfirmModal: {
    confirm: (_app: unknown, options: (typeof dialogs.confirms)[number]) => {
      dialogs.confirms.push(options);
      return Promise.resolve(dialogs.confirmAnswer);
    },
  },
}));
vi.mock("../../src/view/saved-pen-modal", () => ({
  SavedPenModal: class {
    constructor(_app: unknown, options: (typeof dialogs.penModals)[number]) {
      dialogs.penModals.push(options);
    }
    open(): void {}
  },
}));
vi.mock("../../src/view/folder-suggest", () => ({
  FolderInputSuggest: class {
    constructor(_app: unknown, inputEl: unknown, onPick: (path: string) => void) {
      dialogs.folderSuggests.push({ inputEl, onPick });
    }
  },
}));

const { ExtraButtonComponent, FakeEl, Menu, Modal, Platform, Setting } =
  await import("../fakes/obsidian");
const { DEFAULT_SETTINGS, GoodObsidianSettingTab, addInfo, shortcutList } =
  await import("../../src/settings");
const { SIZES } = await import("../../src/constants");
const { DEFAULT_MODELS, LLM_PROVIDER_ID, VENDOR_LABELS, VENDORS } =
  await import("../../src/recognition/llm-request");
const { DEFAULT_IMAGE_MODELS, imageUnsupportedReason } =
  await import("../../src/recognition/ai-image");
const { providerLabel } = await import("../../src/recognition/registry");
const { MANUAL_PROVIDER_ID } = await import("../../src/recognition/manual");
const { GRAPE_MODEL } = await import("../../src/recognition/hwr/grape-model");
const { speechAsset } = await import("../../src/audio/speech-models");
const { savedPenLabel } = await import("../../src/model/saved-pens");
const { SYMBOL_SET } = await import("../../src/recognition/practice");

type Settings = typeof DEFAULT_SETTINGS;
type FakeSetting = InstanceType<typeof Setting>;

// --- A fake plugin ------------------------------------------------------------

/** A downloaded file's store, holding one state and logging what is asked of it. */
function fakeStore(asset: ModelAsset, calls: string[]) {
  const listeners = new Set<() => void>();
  const store = {
    asset,
    state: { kind: "ready" } as AssetState,
    set(state: AssetState) {
      store.state = state;
      for (const l of listeners) l();
    },
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    check: vi.fn(() => Promise.resolve(store.state)),
    download: vi.fn(() => {
      calls.push(`${asset.id}:download`);
      return Promise.resolve(true);
    }),
    redownload: vi.fn(() => {
      calls.push(`${asset.id}:redownload`);
      return Promise.resolve(true);
    }),
    remove: vi.fn(() => {
      calls.push(`${asset.id}:remove`);
      return Promise.resolve();
    }),
  };
  return store;
}

function makePlugin(overrides: Partial<Settings> = {}, keys: Record<string, string> = {}) {
  const calls: string[] = [];
  const settings: Settings = { ...structuredClone(DEFAULT_SETTINGS), ...overrides };
  const grapeStore = fakeStore(GRAPE_MODEL, calls);
  const speechStore = fakeStore(speechAsset("whisper-base"), calls);
  /** The vault the learning rows look in: practice files and model files by path. */
  const files = new Map<string, string>();
  const learnerListeners = new Set<() => void>();
  const plugin = {
    settings,
    calls,
    keys: { secure: true },
    // No newer FineNotes known (update-notice.ts), unless a test says one is out.
    updates: {
      available: null as string | null,
      changed: vi.fn(),
      check: vi.fn(() => Promise.resolve()),
    },
    providers: new Map<string, unknown>([
      [MANUAL_PROVIDER_ID, {}],
      [LLM_PROVIDER_ID, {}],
    ]),
    saveSettings: vi.fn(() => {
      calls.push("save");
      return Promise.resolve();
    }),
    setDebugHud: vi.fn((on: boolean) => {
      calls.push(`debugHud:${on}`);
      settings.debugHud = on;
      return Promise.resolve();
    }),
    setPressureWidth: vi.fn((on: boolean) => {
      calls.push(`pressureWidth:${on}`);
      settings.pressureWidth = on;
      return Promise.resolve();
    }),
    files,
    models: { all: () => [grapeStore, speechStore] },
    speech: { store: () => speechStore },
    grape: {
      model: grapeStore,
      id: "grape-2",
      offer: vi.fn((how: string) => calls.push(`grape:offer:${how}`)),
    },
    // The reader: what model is loaded (none yet), and loading one.
    handwriting: {
      info: null as object | null,
      model: vi.fn(() => {
        calls.push("hwr:load");
        return Promise.resolve({});
      }),
    },
    learner: {
      progress: null as { step: number; steps: number; startedAt: number } | null,
      start: vi.fn(() => calls.push("learn")),
      stop: vi.fn(() => calls.push("stop")),
      subscribe: (l: () => void) => {
        learnerListeners.add(l);
        return () => learnerListeners.delete(l);
      },
    },
    learningHost: () => ({
      app: {
        vault: {
          getMarkdownFiles: () => [],
          getFileByPath: () => null,
          adapter: {
            exists: (path: string) => Promise.resolve(files.has(path)),
            stat: (path: string) =>
              Promise.resolve(
                files.has(path) ? { type: "file", size: files.get(path)?.length ?? 0 } : null,
              ),
            remove: (path: string) => {
              calls.push(`rm:${path}`);
              files.delete(path);
              return Promise.resolve();
            },
            rename: (from: string, to: string) => {
              files.set(to, files.get(from) ?? "");
              files.delete(from);
              return Promise.resolve();
            },
          },
        },
      },
      pluginDir: "plug",
      settings,
      baseId: "grape-2",
      saveSettings: () => {
        calls.push("save");
        return Promise.resolve();
      },
      reloadReader: () => calls.push("reload"),
      openNotebook: () => null,
      createPracticeFile: (set: number) => {
        calls.push(`practice:${set}`);
        return Promise.resolve(null);
      },
    }),
    closeSettings: vi.fn(() => calls.push("closeSettings")),
    modelReleased: vi.fn((id: string) => calls.push(`released:${id}`)),
    cancelOpenRouterConnect: vi.fn(() => calls.push("cancelConnect")),
    startOpenRouterConnect: vi.fn(() => {
      calls.push("startConnect");
      return Promise.resolve();
    }),
    apiKeyFor: (slot: string) => keys[slot] ?? "",
    aiSetup: () => ({
      vendor: settings.llmVendor,
      baseUrl: settings.llmBaseUrl,
      imageVendor: settings.imageVendor,
      hasKey: (slot: string) => (keys[slot] ?? "") !== "",
    }),
    storeApiKey: vi.fn((slot: string, key: string) => {
      calls.push(`store:${slot}:${key}`);
      keys[slot] = key;
      return true;
    }),
    removeApiKey: vi.fn((slot: string) => {
      calls.push(`remove:${slot}`);
      delete keys[slot];
    }),
    saveSavedPens: vi.fn((pens: Settings["savedPens"]) => {
      calls.push(`pens:${pens.length}`);
      settings.savedPens = pens.map((pen) => ({ ...pen }));
    }),
    setPenCursor: vi.fn((style: Settings["penCursor"]) => {
      calls.push(`penCursor:${style}`);
      settings.penCursor = style;
      return Promise.resolve();
    }),
  };
  return plugin;
}

type Plugin = ReturnType<typeof makePlugin>;

/** The tab, with its AI group opened (as Show does) unless `aiOpen` is false. */
function makeTab(plugin: Plugin, aiOpen = true) {
  const tab = new GoodObsidianSettingTab({} as never, plugin as never);
  (tab as unknown as { aiOpen: boolean }).aiOpen = aiOpen;
  const fake = tab as unknown as { updates: number; domRefreshes: number };
  const origUpdate = (tab as unknown as { update: () => void }).update.bind(tab);
  (tab as unknown as { update: () => void }).update = () => {
    plugin.calls.push("update");
    origUpdate();
  };
  return { tab, fake };
}

// --- Walking the definitions as Obsidian does --------------------------------

interface Def {
  name: string;
  desc?: string;
  aliases?: string[];
  searchable?: boolean | (() => boolean);
  visible?: boolean | (() => boolean);
  control?: {
    type: string;
    key: string;
    options?: Record<string, string>;
    placeholder?: string;
    min?: number;
    max?: number;
    step?: number;
  };
  render?: (setting: FakeSetting, group: unknown) => unknown;
  action?: (el: unknown, index: number) => unknown;
}

interface Row {
  heading: string;
  def: Def;
}

function rows(tab: InstanceType<typeof GoodObsidianSettingTab>): Row[] {
  const out: Row[] = [];
  for (const item of tab.getSettingDefinitions() as unknown[]) {
    const group = item as { type?: string; heading?: string; items?: Def[] };
    if (group.type === "group") {
      for (const def of group.items ?? []) out.push({ heading: group.heading ?? "", def });
    } else out.push({ heading: "", def: item as Def });
  }
  return out;
}

function shown(def: Def): boolean {
  const v = def.visible;
  return v === undefined ? true : typeof v === "function" ? v() : v;
}

function kind(def: Def): string {
  if (def.control) return `${def.control.type}:${def.control.key}`;
  return def.render ? "render" : def.action ? "action" : "none";
}

/** Render one row as Obsidian does: name and description first, then `render`. */
function renderRow(def: Def): FakeSetting {
  const setting = new Setting();
  setting.setName(def.name);
  if (def.desc) setting.setDesc(def.desc);
  def.render?.(setting, {});
  return setting;
}

function named(all: Row[], name: string): Def {
  const row = all.find((r) => r.def.name === name);
  if (!row) throw new Error(`no row "${name}"`);
  return row.def;
}

/** The unnamed block that directly follows the row called `name`. */
function blockAfter(all: Row[], name: string, skip = 0): Def {
  const at = all.findIndex((r) => r.def.name === name);
  const def = all[at + 1 + skip]?.def;
  if (at < 0 || !def || def.name !== "") throw new Error(`no block after "${name}"`);
  return def;
}

const AI = "AI with your own key";
/** One row per default saved pen, named as the pen. */
const DEFAULT_PEN_NAMES = DEFAULT_SETTINGS.savedPens.map((pen) => savedPenLabel(pen));
const MODELS = "Models on this device";
const WRITING = "Writing";
const PAGES = "Pages and notebooks";
const ADVANCED = "Advanced";
const PENS = "Pens and shortcuts";
const FOOTER = "Feedback and community";

beforeEach(() => {
  // The pen icons are SVG made in the row's document: a stand-in document.
  vi.stubGlobal("activeDocument", {
    body: { hasClass: () => false },
    createElementNS: (_ns: string, tag: string) => new FakeEl(tag),
  });
  dialogs.keyModals.length = 0;
  dialogs.confirms.length = 0;
  dialogs.confirmAnswer = true;
  dialogs.folderSuggests.length = 0;
  dialogs.penModals.length = 0;
  Platform.isIosApp = false;
  Platform.isTablet = false;
});

// --- Layout ------------------------------------------------------------------

/** "Models on this device", top to bottom. */
const MODEL_ROWS = [
  ["(block)", "render"],
  ["Voice · Whisper base", "render"],
  ["Size and language", "render"],
  ["Handwriting · Grape 2.0", "render"],
  ["Read handwriting on this device (beta)", "toggle:handwritingOnDevice"],
  ["Underline words it may have misread", "toggle:checkHandwrittenWords"],
  ["Calculate lines that end in =", "toggle:calcNotes"],
  ["Your handwriting model", "render"],
  ["Read with my model", "toggle:useLearnedHandwriting"],
  ["Learn your handwriting", "render"],
] as const;

/** The longest one line a row may say under its name; the rest goes behind its ⓘ. */
const ONE_LINE = 60;

describe("the rows", () => {
  it("come in this order, grouped under these headings", () => {
    const { tab } = makeTab(makePlugin());
    const label = VENDORS.anthropic.label;
    expect(rows(tab).map((r) => [r.heading, r.def.name || "(block)", kind(r.def)])).toEqual([
      ["", "(block)", "render"],
      [WRITING, "Start with", "render"],
      [WRITING, "Two-finger double-tap to undo", "toggle:fingerTapUndo"],
      [WRITING, "More", "action"],
      [WRITING, "Hide pen options while writing", "toggle:tuckPenOptionsOnWrite"],
      [WRITING, "Drag to size text boxes", "toggle:textDragSize"],
      [WRITING, "Custom colors", "render"],
      [WRITING, "Highlighter opacity", "slider:highlighterAlpha"],
      [WRITING, "Straighten highlighter strokes", "toggle:straightHighlighter"],
      [WRITING, "Snapping mode", "dropdown:snapMode"],
      [WRITING, "Snapping curvature tolerance", "slider:snapCurvatureThreshold"],
      [PENS, "Saved pens", "render"],
      ...DEFAULT_PEN_NAMES.map((name) => [PENS, name, "render"]),
      [PENS, "Stylus side button", "dropdown:barrelButton"],
      [PENS, "Side button click", "dropdown:stylusButtonClick"],
      [PENS, "Cursor over the page", "dropdown:penCursor"],
      [PENS, "Keyboard shortcuts", "render"],
      [PAGES, "Page appearance", "render"],
      [PAGES, "Paper width", "render"],
      [PAGES, "More", "action"],
      [PAGES, "New notebooks go in", "render"],
      [PAGES, "Each notebook gets its own folder", "toggle:notebookOwnFolder"],
      [PAGES, "Stickers folder", "text:stickerFolder"],
      [PAGES, "Templates folder", "text:templateFolder"],
      [PAGES, "Template gallery", "text:templateGalleryUrl"],
      [PAGES, "New notebook in the right-click menu", "toggle:showNewNotebookInContextMenu"],
      [PAGES, "New notebook button in the file explorer", "toggle:showNewNotebookInExplorer"],
      [PAGES, "Show notebook folders as notebooks", "toggle:folderNotebooks"],
      ...MODEL_ROWS.map(([name, kind]) => [MODELS, name, kind]),
      [AI, "Set up an AI service", "render"],
      [AI, "AI service", "dropdown:llmVendor"],
      [AI, "Endpoint URL", "render"],
      [AI, "(block)", "render"],
      [AI, "(block)", "render"],
      [AI, "Connect OpenRouter", "render"],
      [AI, "AI model", "text:llmModel"],
      [AI, `${label} API key`, "render"],
      [AI, "(block)", "render"],
      [AI, "Handwriting recognition", "dropdown:recognitionProviderId"],
      [AI, "Recognize automatically", "toggle:autoRecognize"],
      [AI, "More", "action"],
      [AI, "Image generation", "dropdown:imageVendor"],
      [AI, "(block)", "render"],
      [AI, "Image model", "text:imageModel"],
      [AI, `${label} API key for images`, "render"],
      [ADVANCED, "Pressure-sensitive pens", "toggle:pressureWidth"],
      [ADVANCED, "(block)", "render"],
      [ADVANCED, "Desynchronized canvas", "toggle:desynchronizedCanvas"],
      [ADVANCED, "Updates", "dropdown:checkForUpdates"],
      [ADVANCED, "Input debug overlay", "toggle:debugHud"],
      [ADVANCED, "Handwriting model file", "text:hwrModelPath"],
      [ADVANCED, "More", "action"],
      [ADVANCED, "Folder for pictures and PDFs", "text:imagesFolder"],
      [ADVANCED, "Folder for recordings", "text:recordingsFolder"],
      [ADVANCED, "Folder for recording transcripts", "text:transcriptsFolder"],
      [ADVANCED, "Folder for AI chats", "text:chatsFolder"],
      [ADVANCED, "Folder for PDF exports", "text:exportsFolder"],
      ["", FOOTER, "render"],
    ]);
  });

  it("says at most one short line under a row, the rest behind its ⓘ", () => {
    for (const vendor of ["anthropic", "custom", "openrouter", "google"] as const) {
      const { tab } = makeTab(makePlugin({ llmVendor: vendor, imageVendor: "openai" }));
      for (const { def } of rows(tab)) {
        if (def.name === "") {
          expect(def.searchable).toBe(false);
          expect(def.render).toBeTypeOf("function");
        }
        if (def.name === "More") {
          // Obsidian's own tappable row, kept out of search.
          expect(def.searchable).toBe(false);
          expect(def.action).toBeTypeOf("function");
        }
        if (typeof def.desc === "string") {
          expect(def.desc.length, def.name).toBeLessThanOrEqual(ONE_LINE);
        }
      }
    }
    // Rows whose name says it all have no line at all, and an ⓘ for the rest.
    const { tab } = makeTab(makePlugin());
    const all = rows(tab);
    expect(named(all, "Hide pen options while writing").desc).toBeUndefined();
    expect(tab.infoOf("Hide pen options while writing")).toMatch(/second tap on the pen/);
    expect(tab.infoOf("Page appearance")).toMatch(/PDFs as they are/);
    expect(tab.infoOf("Folder for recordings")).toMatch(/^Audio recorded .* own folder/);
    expect(tab.infoOf("Start with")).toBeUndefined();
  });

  it("finds every merged or renamed setting by its old words", () => {
    const { tab } = makeTab(makePlugin());
    const words = (name: string) => named(rows(tab), name).aliases ?? [];
    expect(words("Start with")).toEqual(
      expect.arrayContaining(["default tool", "default stroke size", "default ink color"]),
    );
    expect(words("Page appearance")).toEqual(
      expect.arrayContaining(["dark mode", "dark PDF pages"]),
    );
    expect(words("New notebooks go in")).toContain("default folder for new notebooks");
    expect(words("Saved pens")).toEqual(expect.arrayContaining(["number key", "restore defaults"]));
    expect(words("Size and language")).toEqual(
      expect.arrayContaining(["voice model size", "spoken language"]),
    );
    expect(words("Your handwriting model")).toEqual(
      expect.arrayContaining([
        "learned handwriting model",
        "go back to the previous learned model",
        "delete my learned model",
      ]),
    );
    expect(words("Learn your handwriting")).toEqual(
      expect.arrayContaining(["write the practice sheets", "learn my handwriting"]),
    );
    expect(words("Input debug overlay")).toContain("support");
    expect(words(FOOTER)).toEqual(
      expect.arrayContaining(["feedback", "report a bug", "Instagram", "YouTube"]),
    );
  });

  it("offers these choices", () => {
    const { tab } = makeTab(makePlugin());
    const all = rows(tab);
    const start = renderRow(named(all, "Start with"));
    expect(start.dropdowns[0].options).toEqual({
      pen: "Pen",
      highlighter: "Highlighter",
      eraser: "Eraser",
      select: "Select",
    });
    expect(Object.entries(start.dropdowns[1].options)).toEqual(
      SIZES.map((s) => [String(s), String(s)]),
    );
    expect(start.colors).toHaveLength(1);
    expect(Object.keys(renderRow(named(all, "Page appearance")).dropdowns[0].options)).toEqual([
      "light",
      "dark",
      "dark-pdf-light",
      "system",
      "system-pdf-light",
    ]);
    expect(named(all, "Handwriting recognition").control?.options).toEqual({
      [MANUAL_PROVIDER_ID]: providerLabel(MANUAL_PROVIDER_ID),
      [LLM_PROVIDER_ID]: providerLabel(LLM_PROVIDER_ID),
    });
    expect(named(all, "AI service").control?.options).toEqual(VENDOR_LABELS);
    expect(Object.entries(named(all, "Image generation").control?.options ?? {})).toEqual([
      ["same", "Same as the AI service"],
      ["openai", "OpenAI (GPT Image)"],
      ["google", "Google (Gemini)"],
      ["openrouter", "OpenRouter"],
    ]);
    const slider = named(all, "Highlighter opacity").control;
    expect([slider?.min, slider?.max, slider?.step]).toEqual([10, 100, 5]);
  });

  it("names the vendor's default model where a model can be typed", () => {
    for (const vendor of ["anthropic", "openai", "google", "openrouter", "custom"] as const) {
      const { tab } = makeTab(makePlugin({ llmVendor: vendor }));
      const model = named(rows(tab), "AI model");
      expect(model.control?.placeholder).toBe(DEFAULT_MODELS[vendor]);
      expect(model.desc).toContain(DEFAULT_MODELS[vendor]);
    }
    for (const vendor of ["openai", "google", "openrouter"] as const) {
      const { tab } = makeTab(makePlugin({ imageVendor: vendor }));
      const model = named(rows(tab), "Image model");
      expect(model.control?.placeholder).toBe(DEFAULT_IMAGE_MODELS[vendor]);
      expect(model.desc).toContain(DEFAULT_IMAGE_MODELS[vendor]);
    }
  });
});

// --- Visibility --------------------------------------------------------------

/** The "Pens and shortcuts" rows a fresh install shows, on a computer. */
const PEN_ROWS = [
  "Saved pens",
  ...DEFAULT_PEN_NAMES,
  "Stylus side button",
  "Side button click",
  "Cursor over the page",
  "Keyboard shortcuts",
];

/** The rows of "Models on this device" shown by default: nothing learned yet. */
const DEFAULT_MODEL_ROWS = [
  "Voice · Whisper base",
  "Size and language",
  "Handwriting · Grape 2.0",
  "Read handwriting on this device (beta)",
  "Underline words it may have misread",
  "Calculate lines that end in =",
  "Your handwriting model",
  "Learn your handwriting",
];

describe("which rows show", () => {
  /** The rows shown; `aiOpen`: the AI group opened, as Show does when no key is set up. */
  function visibleNames(plugin: Plugin, aiOpen = true): string[] {
    const { tab } = makeTab(plugin, aiOpen);
    const all = rows(tab);
    return all.map((r, i) => (shown(r.def) ? r.def.name || `(block ${i})` : "")).filter(Boolean);
  }

  it("warns about pressure only while it is on", () => {
    const off = visibleNames(makePlugin());
    const on = visibleNames(makePlugin({ pressureWidth: true }));
    const toggle = "Pressure-sensitive pens";
    expect(off[off.indexOf(toggle) + 1]).toBe("Desynchronized canvas");
    expect(on[on.indexOf(toggle) + 1]).toMatch(/^\(block \d+\)$/);
  });

  it("by default: no iPad tip, and the AI group folded into one row", () => {
    expect(visibleNames(makePlugin(), false)).toEqual([
      "Start with",
      "Two-finger double-tap to undo",
      "More",
      "Hide pen options while writing",
      "Drag to size text boxes",
      "Custom colors",
      "Highlighter opacity",
      "Straighten highlighter strokes",
      "Snapping mode",
      "Snapping curvature tolerance",
      ...PEN_ROWS,
      "Page appearance",
      "Paper width",
      "More",
      "New notebooks go in",
      "Each notebook gets its own folder",
      "Stickers folder",
      "Templates folder",
      "Template gallery",
      "New notebook in the right-click menu",
      "New notebook button in the file explorer",
      "Show notebook folders as notebooks",
      // The models' introduction.
      "(block 35)",
      ...DEFAULT_MODEL_ROWS,
      "Set up an AI service",
      "Pressure-sensitive pens",
      "Desynchronized canvas",
      "Updates",
      "Input debug overlay",
      "Handwriting model file",
      "More",
      "Folder for pictures and PDFs",
      "Folder for recordings",
      "Folder for recording transcripts",
      "Folder for AI chats",
      "Folder for PDF exports",
      FOOTER,
    ]);
  });

  it("opens the AI group on Show: Manual recognition, Claude, keys in the keychain", () => {
    const label = VENDORS.anthropic.label;
    const names = visibleNames(makePlugin());
    const from = names.indexOf("Set up an AI service");
    expect(names.slice(from, names.indexOf("Pressure-sensitive pens"))).toEqual([
      "Set up an AI service",
      "AI service",
      "AI model",
      `${label} API key`,
      "Handwriting recognition",
      "More",
      "Image generation",
      // Claude makes no pictures: the callout saying so.
      expect.stringMatching(/^\(block \d+\)$/),
    ]);
  });

  it("shows the AI group without asking once a key is set up", () => {
    const plugin = makePlugin({}, { anthropic: "sk-test" });
    const names = visibleNames(plugin, false);
    expect(names).not.toContain("Set up an AI service");
    expect(names).toContain("AI service");
    expect(names).toContain("Handwriting recognition");
  });

  it("says a newer FineNotes is out, above everything, with Obsidian's Update a tap away", () => {
    const quiet = rows(makeTab(makePlugin()).tab);
    expect(
      quiet.some((r) => r.def.name === "" && /is out/.test(renderRow(r.def).settingEl.textContent)),
    ).toBe(false);
    const plugin = makePlugin();
    plugin.updates.available = "2.4.2";
    const drawn = renderRow(rows(makeTab(plugin).tab)[0].def);
    expect(drawn.settingEl.find("goodobsidian-callout-title")?.textContent).toMatch(
      /^FineNotes 2\.4\.2 is out/,
    );
    const opened: string[] = [];
    vi.stubGlobal("window", { open: (url: string) => opened.push(url) });
    try {
      drawn.settingEl.find("mod-cta")?.dispatch("click");
    } finally {
      vi.unstubAllGlobals();
    }
    expect(opened).toEqual(["obsidian://show-plugin?id=finenotes"]);
  });

  it("switching update checks tells the marks at once, and checks when switched on", async () => {
    const plugin = makePlugin();
    const { tab } = makeTab(plugin);
    expect(tab.getControlValue("checkForUpdates")).toBe("remind");
    await tab.setControlValue("checkForUpdates", "off");
    expect(plugin.settings.checkForUpdates).toBe(false);
    expect(tab.getControlValue("checkForUpdates")).toBe("off");
    expect(plugin.updates.changed).toHaveBeenCalledTimes(1);
    expect(plugin.updates.check).not.toHaveBeenCalled();
    await tab.setControlValue("checkForUpdates", "remind");
    expect(plugin.settings.checkForUpdates).toBe(true);
    expect(plugin.settings.updateReminders).toBe(true);
    expect(plugin.updates.check).toHaveBeenCalledTimes(1);
    expect(plugin.calls).toContain("save");
  });

  it('"Dot on the gear" keeps checking and stops the pop-up; the choice reads back', async () => {
    const plugin = makePlugin();
    const { tab } = makeTab(plugin);
    await tab.setControlValue("checkForUpdates", "dot");
    expect(plugin.settings.checkForUpdates).toBe(true);
    expect(plugin.settings.updateReminders).toBe(false);
    expect(tab.getControlValue("checkForUpdates")).toBe("dot");
    expect(plugin.updates.changed).toHaveBeenCalledTimes(1);
  });

  it("shows the Scribble tip on an iPad only, in one line, until it is dismissed", () => {
    Platform.isIosApp = true;
    Platform.isTablet = true;
    const plugin = makePlugin();
    const { tab, fake } = makeTab(plugin);
    const tip = rows(tab)[0].def;
    expect(shown(tip)).toBe(true);
    const drawn = renderRow(tip);
    expect(drawn.find("goodobsidian-callout-title")?.text).toMatch(/Scribble/);
    // The how is behind the ⓘ, hidden until it is tapped.
    const how = drawn.find("goodobsidian-info-text");
    expect(how?.hasClass("is-hidden")).toBe(true);
    drawn.find("goodobsidian-info")?.dispatch("click");
    expect(how?.hasClass("is-hidden")).toBe(false);
    expect(how?.text).toMatch(/Apple Pencil → Scribble/);
    drawn.find("goodobsidian-callout-close")?.dispatch("click");
    expect(plugin.settings.scribbleTipDismissed).toBe(true);
    expect(plugin.calls).toContain("save");
    expect(fake.domRefreshes).toBe(1);
    expect(shown(tip)).toBe(false);
    Platform.isTablet = false;
    expect(shown(rows(makeTab(makePlugin()).tab)[0].def)).toBe(false);
  });

  it("offers automatic recognition only with Cloud AI", () => {
    const plugin = makePlugin({ recognitionProviderId: LLM_PROVIDER_ID });
    expect(visibleNames(plugin)).toContain("Recognize automatically");
  });

  it("shows the endpoint rows for a custom endpoint, and checks its URL as it is typed", () => {
    const plugin = makePlugin({ llmVendor: "custom" });
    const { tab } = makeTab(plugin);
    const all = rows(tab);
    expect(shown(named(all, "Endpoint URL"))).toBe(true);
    expect(named(all, "Endpoint API key")).toBeDefined();
    const invalid = blockAfter(all, "Endpoint URL");
    const plainHttp = blockAfter(all, "Endpoint URL", 1);

    // Evaluated again on every refreshDomState, without new definitions.
    const cases: Array<[string, boolean, boolean]> = [
      ["", false, false],
      ["localhost:11434", true, false],
      ["http://nas.local:11434/v1", false, true],
      ["https://box.tailnet.ts.net/v1", false, false],
    ];
    for (const [url, bad, http] of cases) {
      plugin.settings.llmBaseUrl = url;
      expect([url, shown(invalid), shown(plainHttp)]).toEqual([url, bad, http]);
    }
    expect(renderRow(invalid).find("goodobsidian-callout")).toBeDefined();
    expect(renderRow(plainHttp).settingEl.textContent).toMatch(/HTTPS/);
  });

  it("hides the endpoint rows and their warnings for a cloud vendor", () => {
    const plugin = makePlugin({ llmVendor: "openai", llmBaseUrl: "http://x.local/v1" });
    const all = rows(makeTab(plugin).tab);
    expect(shown(named(all, "Endpoint URL"))).toBe(false);
    expect(shown(blockAfter(all, "Endpoint URL"))).toBe(false);
    expect(shown(blockAfter(all, "Endpoint URL", 1))).toBe(false);
  });

  it("offers the OpenRouter connect only for OpenRouter", () => {
    expect(visibleNames(makePlugin({ llmVendor: "openrouter" }))).toContain("Connect OpenRouter");
    expect(visibleNames(makePlugin({ llmVendor: "openai" }))).not.toContain("Connect OpenRouter");
  });

  it("warns when there is no keychain", () => {
    const plugin = makePlugin();
    plugin.keys.secure = false;
    const all = rows(makeTab(plugin).tab);
    const warning = blockAfter(all, `${VENDORS.anthropic.label} API key`);
    expect(shown(warning)).toBe(true);
    expect(renderRow(warning).settingEl.textContent).toMatch(/keychain/i);
  });

  it("explains why the chosen image vendor cannot make pictures", () => {
    const all = rows(makeTab(makePlugin()).tab);
    const why = blockAfter(all, "Image generation");
    expect(shown(why)).toBe(true);
    const callout = renderRow(why).find("goodobsidian-callout");
    expect(callout?.find("goodobsidian-callout-title")?.text).toBe(
      `${imageUnsupportedReason("anthropic")}.`,
    );
    expect(callout?.children).toHaveLength(1);
    expect(shown(named(all, "Image model"))).toBe(false);
  });

  it("asks for a separate image key only when pictures come from another vendor", () => {
    const same = rows(makeTab(makePlugin({ llmVendor: "openai" })).tab);
    expect(shown(named(same, "Image model"))).toBe(true);
    expect(shown(named(same, `${VENDORS.openai.label} API key for images`))).toBe(false);
    expect(shown(blockAfter(same, "Image generation"))).toBe(false);

    const other = rows(makeTab(makePlugin({ imageVendor: "google" })).tab);
    expect(shown(named(other, `${VENDORS.google.label} API key for images`))).toBe(true);
  });
});

// --- Values -------------------------------------------------------------------

describe("control values", () => {
  it("shows stored values in the controls' own units", () => {
    const plugin = makePlugin({
      defaultSize: 5,
      highlighterAlpha: 0.35,
      customColors: ["#ff8800", "#0ca"],
      defaultColor: "#223344",
      defaultTool: "eraser",
    });
    const { tab } = makeTab(plugin);
    expect(tab.getControlValue("defaultSize")).toBe("5");
    expect(tab.getControlValue("highlighterAlpha")).toBe(35);
    expect(tab.getControlValue("customColors")).toBe("#ff8800, #0ca");
    expect(tab.getControlValue("defaultColor")).toBe("#223344");
    expect(tab.getControlValue("defaultTool")).toBe("eraser");
    expect(tab.getControlValue("pressureWidth")).toBe(false);
  });

  it("sets the appearance and the PDF switch from Page appearance, and redraws notebooks", async () => {
    const plugin = Object.assign(makePlugin({ pageAppearance: "dark", invertPdfPages: false }), {
      applyPageAppearance: vi.fn(() => Promise.resolve()),
    });
    const row = renderRow(named(rows(makeTab(plugin).tab), "Page appearance"));
    expect(row.dropdowns[0].value).toBe("dark-pdf-light");
    await row.dropdowns[0].pick("system");
    expect([plugin.settings.pageAppearance, plugin.settings.invertPdfPages]).toEqual([
      "system",
      true,
    ]);
    expect(plugin.applyPageAppearance).toHaveBeenCalledOnce();
  });

  it("sets the tool, width and colour a note starts with from Start with", async () => {
    const plugin = makePlugin({ defaultSize: 5, defaultColor: "#223344" });
    const row = renderRow(named(rows(makeTab(plugin).tab), "Start with"));
    expect([row.dropdowns[0].value, row.dropdowns[1].value, row.colors[0].value]).toEqual([
      "pen",
      "5",
      "#223344",
    ]);
    await row.dropdowns[0].pick("highlighter");
    await row.dropdowns[1].pick("8");
    await row.colors[0].pick("#112233");
    expect([plugin.settings.defaultTool, plugin.settings.defaultSize]).toEqual(["highlighter", 8]);
    expect(plugin.settings.defaultColor).toBe("#112233");
  });

  it.each(["showNewNotebookInContextMenu", "showNewNotebookInExplorer"] as const)(
    "saves %s without requiring a restart",
    async (key) => {
      const plugin = makePlugin();
      const { tab } = makeTab(plugin);
      expect(plugin.settings[key]).toBe(key === "showNewNotebookInContextMenu");
      await tab.setControlValue(key, !plugin.settings[key]);
      expect(plugin.settings[key]).toBe(key === "showNewNotebookInExplorer");
      expect(plugin.saveSettings).toHaveBeenCalledOnce();
    },
  );

  it("stores what a control sets in data.json's units", async () => {
    const plugin = makePlugin();
    const { tab } = makeTab(plugin);
    await tab.setControlValue("defaultSize", "4");
    await tab.setControlValue("highlighterAlpha", 40);
    await tab.setControlValue("customColors", " #ff8800,#00CCAA , #abc,red, #12345, #1234567,,");
    await tab.setControlValue("llmModel", "  claude-haiku-4-5 ");
    await tab.setControlValue("imageModel", " gpt-image-1\n");
    await tab.setControlValue("defaultColor", "#123456");
    expect(plugin.settings.defaultSize).toBe(4);
    expect(plugin.settings.highlighterAlpha).toBe(0.4);
    expect(plugin.settings.customColors).toEqual(["#ff8800", "#00CCAA", "#abc"]);
    expect(plugin.settings.llmModel).toBe("claude-haiku-4-5");
    expect(plugin.settings.imageModel).toBe("gpt-image-1");
    expect(plugin.settings.defaultColor).toBe("#123456");
    expect(plugin.saveSettings).toHaveBeenCalledTimes(6);
    expect(plugin.calls).not.toContain("update");
  });

  it("clears the custom colours with an empty field", async () => {
    const plugin = makePlugin({ customColors: ["#ff8800"] });
    await makeTab(plugin).tab.setControlValue("customColors", "");
    expect(plugin.settings.customColors).toEqual([]);
  });

  it("rebuilds the tab after the keys that change which rows exist", async () => {
    for (const [key, value] of [
      ["recognitionProviderId", LLM_PROVIDER_ID],
      ["imageVendor", "google"],
    ] as const) {
      const plugin = makePlugin();
      await makeTab(plugin).tab.setControlValue(key, value);
      expect(plugin.settings[key]).toBe(value);
      expect(plugin.calls).toEqual(["save", "update"]);
    }
  });

  it("cancels an OpenRouter connect in progress when the AI service changes", async () => {
    const plugin = makePlugin();
    await makeTab(plugin).tab.setControlValue("llmVendor", "google");
    expect(plugin.settings.llmVendor).toBe("google");
    expect(plugin.calls).toEqual(["cancelConnect", "save", "update"]);
  });

  it("hands the debug overlay to the plugin, which saves it itself", async () => {
    const plugin = makePlugin();
    await makeTab(plugin).tab.setControlValue("debugHud", true);
    expect(plugin.setDebugHud).toHaveBeenCalledWith(true);
    expect(plugin.calls).toEqual(["debugHud:true"]);
  });

  it("hands pressure to the plugin, which redraws open notebooks, and shows the warning", async () => {
    const plugin = makePlugin();
    await makeTab(plugin).tab.setControlValue("pressureWidth", true);
    expect(plugin.setPressureWidth).toHaveBeenCalledWith(true);
    expect(plugin.calls).toEqual(["pressureWidth:true", "update"]);
  });
});

// --- Rows the tab renders itself -------------------------------------------------

describe("paper width", () => {
  it("saves a whole number from 320 to 4096 and says in one red line why anything else is not", async () => {
    const plugin = makePlugin({ paperWidth: 1024 });
    const { tab } = makeTab(plugin);
    const setting = renderRow(named(rows(tab), "Paper width"));
    const error = setting.find("goodobsidian-field-error");
    const field = setting.texts[0];
    expect(field.value).toBe("1024");
    expect(error?.hasClass("is-hidden")).toBe(true);
    expect(error?.text).toContain("320");
    expect(error?.text).toContain("4096");

    const cases: Array<[string, number, boolean]> = [
      ["5000", 1024, true],
      ["319", 1024, true],
      ["abc", 1024, true],
      ["", 1024, true],
      ["320", 320, false],
      ["4096", 4096, false],
      ["1400px", 1400, false],
      ["800.9", 800, false],
    ];
    for (const [typed, stored, flagged] of cases) {
      await field.type(typed);
      expect([typed, plugin.settings.paperWidth, !error?.hasClass("is-hidden")]).toEqual([
        typed,
        stored,
        flagged,
      ]);
      expect(field.inputEl.hasClass("is-invalid")).toBe(flagged);
    }
    expect(plugin.saveSettings).toHaveBeenCalledTimes(4);
  });

  it("forgets a bad entry when the tab is drawn again", async () => {
    const all = rows(makeTab(makePlugin()).tab);
    await renderRow(named(all, "Paper width")).texts[0].type("99999");
    const again = renderRow(named(all, "Paper width"));
    expect(again.find("goodobsidian-field-error")?.hasClass("is-hidden")).toBe(true);
  });
});

describe("custom colors", () => {
  it("keeps the hex colours, marks the rest, and shows what was kept once left", async () => {
    const plugin = makePlugin({ customColors: ["#0ca"] });
    const field = renderRow(named(rows(makeTab(plugin).tab), "Custom colors")).texts[0];
    expect([field.value, field.placeholder]).toEqual(["#0ca", "#ff8800, #00ccaa"]);
    await field.type("#ff8800, red, #12345");
    expect(plugin.settings.customColors).toEqual(["#ff8800"]);
    expect(field.inputEl.hasClass("is-invalid")).toBe(true);
    await field.type("#ff8800, #00ccaa, ");
    expect(plugin.settings.customColors).toEqual(["#ff8800", "#00ccaa"]);
    expect(field.inputEl.hasClass("is-invalid")).toBe(false);
    await field.type("#ff8800, nope");
    field.inputEl.dispatch("blur");
    expect(field.value).toBe("#ff8800");
    expect(field.inputEl.hasClass("is-invalid")).toBe(false);
  });
});

describe("endpoint URL", () => {
  it("stores the URL trimmed and re-checks the warnings", async () => {
    const plugin = makePlugin({ llmVendor: "custom", llmBaseUrl: "http://old/v1" });
    const { tab, fake } = makeTab(plugin);
    const setting = renderRow(named(rows(tab), "Endpoint URL"));
    const field = setting.texts[0];
    expect(field.value).toBe("http://old/v1");
    expect(field.placeholder).toBe("http://localhost:11434/v1");
    expect(setting.settingEl.hasClass("goodobsidian-wide-text")).toBe(true);
    await field.type("  https://box.ts.net/v1 ");
    expect(plugin.settings.llmBaseUrl).toBe("https://box.ts.net/v1");
    expect(fake.domRefreshes).toBe(1);
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
  });
});

describe("default folder for new notebooks", () => {
  it("stores a cleaned-up path, typed or picked", async () => {
    const plugin = makePlugin({ newNotebookFolder: "School" });
    const setting = renderRow(named(rows(makeTab(plugin).tab), "New notebooks go in"));
    const field = setting.texts[0];
    expect(field.value).toBe("School");
    expect(field.placeholder).toBe("Folder of the open note");
    await field.type(" School\\ Notes / ./");
    expect(plugin.settings.newNotebookFolder).toBe("School/Notes");

    expect(dialogs.folderSuggests).toHaveLength(1);
    expect(dialogs.folderSuggests[0].inputEl).toBe(field.inputEl);
    dialogs.folderSuggests[0].onPick("Journal/2026");
    expect(plugin.settings.newNotebookFolder).toBe("Journal/2026");
    expect(plugin.saveSettings).toHaveBeenCalledTimes(2);
  });
});

describe("OpenRouter connect", () => {
  it("connects, or reconnects when a key is already there", async () => {
    for (const [keys, text] of [
      [{}, "Connect OpenRouter"],
      [{ openrouter: "sk-or-1" }, "Reconnect"],
    ] as const) {
      const plugin = makePlugin({ llmVendor: "openrouter" }, { ...keys });
      const setting = renderRow(named(rows(makeTab(plugin).tab), "Connect OpenRouter"));
      expect(setting.buttons).toHaveLength(1);
      expect(setting.buttons[0].text).toBe(text);
      expect(setting.buttons[0].cta).toBe(true);
      await setting.buttons[0].click();
      expect(plugin.startOpenRouterConnect).toHaveBeenCalledTimes(1);
    }
  });
});

describe("API key rows", () => {
  function keyRow(plugin: Plugin, name: string): FakeSetting {
    return renderRow(named(rows(makeTab(plugin).tab), name));
  }

  it("says whether a key is set, never what it is", () => {
    const set = keyRow(
      makePlugin({}, { anthropic: "sk-ant-secret" }),
      "Anthropic (Claude) API key",
    );
    const status = set.find("goodobsidian-key-status");
    expect([status?.text, status?.hasClass("is-set")]).toEqual(["Set", true]);
    expect(set.buttons.map((b) => [b.text, b.cta])).toEqual([
      ["Replace", false],
      ["Remove", false],
    ]);
    expect(set.settingEl.textContent).not.toContain("sk-ant-secret");

    const unset = keyRow(makePlugin(), "Anthropic (Claude) API key");
    const none = unset.find("goodobsidian-key-status");
    expect([none?.text, none?.hasClass("is-set")]).toEqual(["Not set", false]);
    expect(unset.buttons.map((b) => [b.text, b.cta])).toEqual([["Add key", true]]);

    const custom = keyRow(makePlugin({ llmVendor: "custom" }), "Endpoint API key");
    expect(custom.find("goodobsidian-key-status")?.text).toBe("Not set (optional)");
    expect(custom.buttons.map((b) => [b.text, b.cta])).toEqual([["Add key", false]]);
  });

  it("says where each key is kept and where it goes, behind the row's ⓘ", () => {
    const { tab } = makeTab(makePlugin({ imageVendor: "openai" }));
    rows(tab);
    expect(tab.infoOf("Anthropic (Claude) API key")).toBe(
      "Your own key. Kept in Obsidian's keychain (Settings → Keychain), outside this vault's files; " +
        "sent only to Anthropic (Claude), and only when you start an AI action.",
    );
    const insecure = makePlugin({ imageVendor: "openai" });
    insecure.keys.secure = false;
    const insecureTab = makeTab(insecure).tab;
    rows(insecureTab);
    expect(insecureTab.infoOf("OpenAI (GPT) API key for images")).toBe(
      "Your own OpenAI (GPT) key, used only to generate images. Stored in this vault's plugin data; " +
        "sent only to OpenAI (GPT).",
    );
    const custom = makeTab(makePlugin({ llmVendor: "custom" })).tab;
    rows(custom);
    expect(custom.infoOf("Endpoint API key")).toBe(
      "Optional — most self-hosted servers don't need one. Kept apart from your cloud keys and sent " +
        "only to your endpoint.",
    );
  });

  it("adds a cloud key, cancelling a connect in progress, and redraws", async () => {
    const plugin = makePlugin();
    await keyRow(plugin, "Anthropic (Claude) API key").button("Add key").click();
    expect(dialogs.keyModals).toHaveLength(1);
    const modal = dialogs.keyModals[0];
    expect(modal.title).toBe("Anthropic (Claude) API key");
    expect(modal.placeholder).toBe("sk-…");
    expect(modal.where).toBe(
      "Saved in Obsidian's keychain on this device, not in the vault's files.",
    );
    modal.onSave("sk-ant-new");
    expect(plugin.calls).toEqual(["cancelConnect", "store:anthropic:sk-ant-new", "update"]);
  });

  it("adds an endpoint key without touching the OpenRouter connect", async () => {
    const plugin = makePlugin({ llmVendor: "custom" });
    plugin.keys.secure = false;
    await keyRow(plugin, "Endpoint API key").button("Add key").click();
    const modal = dialogs.keyModals[0];
    expect(modal.title).toBe("Endpoint API key");
    expect(modal.placeholder).toBe("(usually empty)");
    expect(modal.where).toBe("Saved in this vault's plugin data.");
    modal.onSave("local");
    expect(plugin.calls).toEqual(["store:custom:local", "update"]);
  });

  it("replaces a key through the same dialog", async () => {
    const plugin = makePlugin({ imageVendor: "google" }, { google: "AIza-old" });
    await keyRow(plugin, "Google (Gemini) API key for images").button("Replace").click();
    expect(dialogs.keyModals[0].title).toBe("Google (Gemini) API key");
  });

  it("removes a key only after confirming", async () => {
    const plugin = makePlugin({}, { anthropic: "sk-ant-1" });
    dialogs.confirmAnswer = false;
    await keyRow(plugin, "Anthropic (Claude) API key").button("Remove").click();
    expect(plugin.calls).toEqual([]);
    expect(dialogs.confirms[0]).toEqual({
      title: "Remove the Anthropic (Claude) key?",
      message: "AI features that need it stop working on this device until you add a key again.",
      cta: "Remove",
    });

    dialogs.confirmAnswer = true;
    await keyRow(plugin, "Anthropic (Claude) API key").button("Remove").click();
    expect(plugin.calls).toEqual(["remove:anthropic", "update"]);

    const custom = makePlugin({ llmVendor: "custom" }, { custom: "x" });
    await keyRow(custom, "Endpoint API key").button("Remove").click();
    expect(dialogs.confirms[2].title).toBe("Remove the endpoint key?");
  });
});

describe("the feedback footer", () => {
  it("links to Discussions, the bug report, Sponsors and FineNotes' accounts, in one line", () => {
    const opened: string[] = [];
    vi.stubGlobal("window", { open: (url: string) => opened.push(url) });
    try {
      const footer = renderRow(named(rows(makeTab(makePlugin()).tab), FOOTER));
      expect(footer.settingEl.hasClass("goodobsidian-settings-footer")).toBe(true);
      const links = footer.settingEl.findAll("goodobsidian-footer-link");
      expect(links.map((l) => l.textContent)).toEqual([
        "Ideas and questions",
        "Report a bug",
        "",
        "X",
        "Instagram",
        "TikTok",
        "YouTube",
      ]);
      // The heart has no word; its name is its tooltip.
      expect(links[2].attrs["aria-label"]).toBe("Support FineNotes");
      for (const link of links) link.dispatch("click");
      expect(opened).toEqual([
        "https://github.com/Joost-8/FineNotes/discussions",
        "https://github.com/Joost-8/FineNotes/issues/new/choose",
        "https://github.com/sponsors/Joost-8",
        "https://x.com/finenotes_",
        "https://www.instagram.com/finenotesobsidian/",
        "https://www.tiktok.com/@finenotesobsidian",
        "https://www.youtube.com/@FineNotesAtObsidian",
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("marks the list it sits in, which styles.css takes the box off", () => {
    const list = new FakeEl("div", "setting-items");
    const setting = new Setting(list);
    named(rows(makeTab(makePlugin()).tab), FOOTER).render?.(setting as never, {} as never);
    expect(list.hasClass("goodobsidian-footer-items")).toBe(true);
  });
});

describe("the ⓘ after a row's name", () => {
  it("opens the row's longer explanation in place, and closes it again", () => {
    const row = new Setting();
    row.setName("Hold to make shapes");
    addInfo(row.settingEl as never, "Draw a rough line and keep the pen still.");
    addInfo(row.settingEl as never, "twice");
    const buttons = row.settingEl.findAll("goodobsidian-info");
    expect(buttons).toHaveLength(1);
    expect(buttons[0].parent).toBe(row.nameEl);
    expect(buttons[0].attrs).toMatchObject({ role: "button", "aria-expanded": "false" });
    const text = row.infoEl.find("goodobsidian-info-text");
    expect(text?.hasClass("is-hidden")).toBe(true);
    // A tap on it is not a tap on the row (a toggle row would flip).
    let rowTapped = false;
    row.settingEl.addEventListener("click", () => (rowTapped = true));
    const tap = buttons[0].dispatch("click");
    expect(tap.defaultPrevented).toBe(true);
    expect(rowTapped).toBe(false);
    expect(text?.hasClass("is-hidden")).toBe(false);
    expect(buttons[0].attrs["aria-expanded"]).toBe("true");
    buttons[0].dispatch("keydown", { key: "Enter" });
    expect(text?.hasClass("is-hidden")).toBe(true);
  });
});

describe("callout blocks", () => {
  it("replace the whole row with a titled callout", () => {
    const plugin = makePlugin({ llmVendor: "custom", llmBaseUrl: "nope" });
    const all = rows(makeTab(plugin).tab);
    const setting = renderRow(blockAfter(all, "Endpoint URL"));
    expect(setting.settingEl.hasClass("goodobsidian-plain-row")).toBe(true);
    expect(setting.find("setting-item-name")).toBeUndefined();
    const callout = setting.find("goodobsidian-callout");
    expect(callout?.find("goodobsidian-callout-title")?.text).toBeTruthy();
    expect(callout?.children).toHaveLength(2);
  });
});

describe("refresh", () => {
  it("asks Obsidian to rebuild the tab", () => {
    const plugin = makePlugin();
    makeTab(plugin).tab.refresh();
    expect(plugin.calls).toEqual(["update"]);
  });
});

describe("pens and shortcuts (FineNotes#24, #25)", () => {
  /** The rows of the saved pens, drawn: one per pen, after "Saved pens". */
  function penRows(plugin: Plugin) {
    const all = rows(makeTab(plugin).tab).filter((r) => r.heading === PENS);
    const from = all.findIndex((r) => r.def.name === "Saved pens");
    const count = plugin.settings.savedPens.length;
    return all.slice(from + 1, from + 1 + count).map((r) => renderRow(r.def));
  }

  it("lists each saved pen as a row: its key, its icon and its stroke in its ink, its name as its label", () => {
    const plugin = makePlugin();
    const pens = penRows(plugin);
    expect(pens).toHaveLength(8);
    const pen = plugin.settings.savedPens[1];
    const mark = pens[1].nameEl.find("goodobsidian-saved-pen-mark");
    // The mark is all the name shows: the words are its label and tooltip.
    expect(pens[1].nameEl.children).toEqual([mark]);
    expect(pens[1].nameEl.text).toBe("");
    expect(mark?.tag).toBe("button");
    expect(mark?.attrs["aria-label"]).toBe(`Pen 2: ${savedPenLabel(pen)}`);
    expect(mark?.find("goodobsidian-saved-pen-key")?.text).toBe("2");
    const glyph = mark?.children.find((c) => c.tag === "svg");
    const painted = (glyph?.children ?? []).flatMap((part) => Object.values(part.attrs));
    expect(painted).toContain(pen.color);
    const stroke = mark?.find("goodobsidian-pen-sample")?.children[0]?.children[0];
    expect(stroke?.tag).toBe("path");
    expect(Object.values(stroke?.attrs ?? {})).toContain(pen.color);
    expect(named(rows(makeTab(plugin).tab), savedPenLabel(pen))).toBeDefined();
  });

  it("draws the highlighter's stroke at the page's highlighter opacity", () => {
    const plugin = makePlugin();
    plugin.settings.highlighterAlpha = 0.3;
    const at = plugin.settings.savedPens.findIndex((pen) => pen.type === "highlighter");
    const mark = penRows(plugin)[at].nameEl.find("goodobsidian-saved-pen-mark");
    const paper = mark?.find("goodobsidian-pen-sample");
    expect(paper?.hasClass("is-highlighter")).toBe(true);
    expect(paper?.children[0]?.children[0]?.attrs.opacity).toBe("0.3");
  });

  it("adds a pen with + beside Saved pens, while there is room", () => {
    const plugin = makePlugin();
    plugin.settings.savedPens = plugin.settings.savedPens.slice(0, 2);
    plugin.settings.lastPen = { type: "brush", color: "#e03131", size: 3 };
    const row = renderRow(named(rows(makeTab(plugin).tab), "Saved pens"));
    expect(row.descEl.text).toBe("");
    expect(row.extras.map((b) => b.icon)).toEqual(["plus", "rotate-ccw"]);
    row.extras[0].click();
    const dialog = dialogs.penModals.at(-1);
    expect(dialog?.index).toBeNull();
    expect(dialog?.pen).toEqual(plugin.settings.lastPen);
    dialog?.onSave({ type: "calligraphy", color: "#2f9e44", size: 4 });
    expect(plugin.settings.savedPens).toHaveLength(3);
    expect(plugin.settings.savedPens[2]).toEqual({
      type: "calligraphy",
      color: "#2f9e44",
      size: 4,
    });
    expect(plugin.calls).toContain("update");
  });

  it("offers no + when eight are saved", () => {
    const plugin = makePlugin();
    const row = renderRow(named(rows(makeTab(plugin).tab), "Saved pens"));
    expect(row.extras[0].disabled).toBe(true);
    row.extras[0].click();
    expect(dialogs.penModals).toHaveLength(0);
  });

  it("changes a pen from a tap on its row, and refuses one that is saved already", () => {
    const plugin = makePlugin();
    const [, second, third] = plugin.settings.savedPens;
    const pens = penRows(plugin);
    pens[2].nameEl.find("goodobsidian-saved-pen-mark")?.dispatch("click");
    const dialog = dialogs.penModals.at(-1);
    expect(dialog?.index).toBe(2);
    expect(dialog?.pen).toEqual(third);
    dialog?.onSave({ ...second });
    expect(plugin.settings.savedPens[2]).toEqual(third);
    dialog?.onSave({ ...third, size: 5 });
    expect(plugin.settings.savedPens[2]).toEqual({ ...third, size: 5 });
    expect(plugin.settings.savedPens).toHaveLength(8);
  });

  it("remembers a custom colour made in the pen dialog", () => {
    const plugin = makePlugin();
    penRows(plugin)[0].infoEl.dispatch("click");
    dialogs.penModals.at(-1)?.onCustomColor?.("#123456");
    expect(plugin.settings.recentColors[0]).toBe("#123456");
    expect(plugin.calls).toContain("save");
  });

  it("deletes a pen from its row", async () => {
    const plugin = makePlugin();
    const [first, second] = plugin.settings.savedPens;
    const pens = penRows(plugin);
    expect(pens[0].extras.map((b) => b.icon)).toEqual(["trash-2"]);
    await pens[0].extras[0].click();
    expect(plugin.settings.savedPens).toHaveLength(7);
    expect(plugin.settings.savedPens[0]).toEqual(second);
    expect(plugin.settings.savedPens).not.toContainEqual(first);
    expect(plugin.calls).toContain("update");
  });

  it("draws a row again in place without a second icon", () => {
    const plugin = makePlugin();
    const all = rows(makeTab(plugin).tab);
    const def = named(all, savedPenLabel(plugin.settings.savedPens[0]));
    const setting = renderRow(def);
    def.render?.(setting, {});
    expect(setting.nameEl.findAll("goodobsidian-saved-pen-mark")).toHaveLength(1);
  });

  it("restores the default pens only after asking", async () => {
    const plugin = makePlugin();
    plugin.settings.savedPens = plugin.settings.savedPens.slice(0, 4);
    const row = renderRow(named(rows(makeTab(plugin).tab), "Saved pens"));
    expect(row.extras[1].icon).toBe("rotate-ccw");
    dialogs.confirmAnswer = false;
    await row.extras[1].click();
    expect(plugin.settings.savedPens).toHaveLength(4);
    expect(dialogs.confirms.at(-1)?.title).toBe("Restore the default pens?");
    dialogs.confirmAnswer = true;
    await row.extras[1].click();
    expect(plugin.settings.savedPens).toHaveLength(8);
  });

  it("offers the barrel's four choices, its click's two but not on an iPad, and the cursor's three only on a computer", () => {
    const all = rows(makeTab(makePlugin()).tab);
    expect(Object.keys(named(all, "Stylus side button").control?.options ?? {})).toEqual([
      "erase",
      "lasso",
      "pan",
      "none",
    ]);
    expect(named(all, "Side button click").control?.options).toEqual({
      "pen-menu": "Open the pen menu",
      none: "Nothing",
    });
    expect(shown(named(all, "Side button click"))).toBe(true);
    Platform.isIosApp = true;
    expect(shown(named(rows(makeTab(makePlugin()).tab), "Side button click"))).toBe(false);
    expect(shown(named(rows(makeTab(makePlugin()).tab), "Stylus side button"))).toBe(true);
    Platform.isIosApp = false;
    const cursor = named(all, "Cursor over the page");
    expect(cursor.control?.options).toEqual({
      ink: "Ink dot",
      crosshair: "Crosshair",
      arrow: "Arrow",
    });
    expect(cursor.aliases).toEqual(expect.arrayContaining(["cursor", "pointer", "crosshair"]));
    expect(shown(cursor)).toBe(true);
    Platform.isMobile = true;
    try {
      expect(shown(named(rows(makeTab(makePlugin()).tab), "Cursor over the page"))).toBe(false);
    } finally {
      Platform.isMobile = false;
    }
  });

  it("hands the cursor switch to the plugin, which updates every notebook", async () => {
    const plugin = makePlugin();
    await makeTab(plugin).tab.setControlValue("penCursor", "crosshair");
    await makeTab(plugin).tab.setControlValue("penCursor", "arrow");
    expect(plugin.calls).toEqual(["penCursor:crosshair", "penCursor:arrow"]);
  });

  /** Open the shortcut sheet from its row; the sheet's list. */
  function shortcutSheet() {
    const row = renderRow(named(rows(makeTab(makePlugin()).tab), "Keyboard shortcuts"));
    void row.button("Show all").click();
    const modal = Modal.made.at(-1);
    expect(modal?.isOpen).toBe(true);
    return modal?.contentEl.find("goodobsidian-shortcuts");
  }

  it("lists the shortcuts on their own sheet, each key a key cap, Ctrl or ⌘ by platform", () => {
    const list = shortcutSheet();
    expect(list?.findAll("goodobsidian-shortcut-group-title").map((el) => el.text)).toEqual([
      "Tools",
      "Pens",
      "Selection and editing",
      "View and zoom",
      "Stylus",
    ]);
    const line = (action: string) => {
      const found = list
        ?.findAll("goodobsidian-shortcut")
        .find((el) => el.find("goodobsidian-shortcut-action")?.text === action);
      if (!found) throw new Error(`no shortcut "${action}"`);
      return found;
    };
    const caps = (action: string) =>
      line(action)
        .findAll("goodobsidian-key")
        .map((el) => el.text);
    expect(caps("Redo")).toEqual(["Ctrl", "Shift", "Z"]);
    expect(line("Redo").find("goodobsidian-shortcut-keys")?.textContent).toBe("Ctrl+Shift+Z");
    expect(caps("Pen")).toEqual(["P", "W"]);
    expect(line("Pen").find("goodobsidian-shortcut-sep")?.text).toBe("or");
    expect(line("Saved pens 1 to 8").find("goodobsidian-shortcut-sep")?.text).toBe("–");
    expect(line("Move the page").find("goodobsidian-shortcut-gesture")?.text).toBe("+ drag");
    expect(caps("Erase")).toEqual([]);

    Platform.isIosApp = true;
    const redo = shortcutSheet()
      ?.findAll("goodobsidian-shortcut")
      .find((el) => el.find("goodobsidian-shortcut-action")?.text === "Redo");
    expect(redo?.findAll("goodobsidian-key").map((el) => [el.text, el.attrs.title])).toEqual([
      ["⌘", "Command"],
      ["⇧", "Shift"],
      ["Z", undefined],
    ]);
    // Glyphs sit side by side, as in Obsidian's Hotkeys tab: no "+" between them.
    expect(redo?.findAll("goodobsidian-shortcut-plus")).toEqual([]);
  });

  it("writes each shortcut as Obsidian prints a hotkey", () => {
    const pc = Object.fromEntries(shortcutList(false).map(([keys, action]) => [action, keys]));
    const mac = Object.fromEntries(shortcutList(true).map(([keys, action]) => [action, keys]));
    expect(pc.Pen).toBe("P or W");
    expect(pc["Saved pens 1 to 8"]).toBe("1 – 8");
    expect(pc.Redo).toBe("Ctrl + Shift + Z");
    expect(mac.Redo).toBe("⌘ ⇧ Z");
    expect(pc["Zoom in or out about the pen"]).toBe("Alt + write up or down");
    expect(mac["Zoom in or out about the pen"]).toBe("⌥ + write up or down");
    expect(pc["Lasso select"]).toBe("Ctrl + write");
    expect(pc.Erase).toBe("Write with the eraser end");
    expect(pc["Show or hide this list"]).toBe("?");
    expect(shortcutList(false)).toHaveLength(19);
  });
});

// --- Folding sections ----------------------------------------------------------

interface GroupDef {
  type: string;
  heading?: string;
  cls?: string;
  items?: Def[];
  extraButtons?: Array<(button: unknown) => unknown>;
}

function groups(tab: InstanceType<typeof GoodObsidianSettingTab>): GroupDef[] {
  return (tab.getSettingDefinitions() as GroupDef[]).filter((item) => item.type === "group");
}

/** Draw a group's header as Obsidian does: its classes, the header row, the extra buttons. */
function drawGroup(def: GroupDef) {
  const groupEl = new FakeEl("div", `setting-group ${def.cls ?? ""}`);
  const header = groupEl.createDiv("setting-item setting-item-heading");
  header.createDiv({ cls: "setting-item-name", text: def.heading ?? "" });
  const control = header.createDiv("setting-item-control");
  const buttons = (def.extraButtons ?? []).map((build) => {
    const button = new ExtraButtonComponent(control);
    build(button);
    return button;
  });
  return { groupEl, header, chevron: buttons[0]?.extraSettingsEl };
}

/** The rows a person sees: those of the sections not folded, and rows outside any. */
function unfoldedRows(tab: InstanceType<typeof GoodObsidianSettingTab>): Row[] {
  const out: Row[] = [];
  for (const item of tab.getSettingDefinitions() as GroupDef[]) {
    if (item.type !== "group") out.push({ heading: "", def: item as unknown as Def });
    else if (!(item.cls ?? "").split(" ").includes("is-folded")) {
      for (const def of item.items ?? []) out.push({ heading: item.heading ?? "", def });
    }
  }
  return out.filter((row) => shown(row.def));
}

const HEADINGS = [WRITING, PENS, PAGES, MODELS, AI, ADVANCED];

describe("folding sections", () => {
  it("folds every section at first, leaving only their headers and the footer", () => {
    const { tab } = makeTab(makePlugin(), false);
    expect(groups(tab).map((g) => [g.heading, g.cls])).toEqual(
      HEADINGS.map((h) => [h, "goodobsidian-section is-folded"]),
    );
    expect(unfoldedRows(tab).map((r) => r.def.name)).toEqual([FOOTER]);
  });

  it("shows the rows of the sections that are open", () => {
    const plugin = makePlugin({ settingsOpen: ["pens", "advanced"] });
    const headings = unfoldedRows(makeTab(plugin, false).tab).map((r) => r.heading);
    expect([...new Set(headings)]).toEqual([PENS, ADVANCED, ""]);
    expect(headings.filter((h) => h === PENS)).toHaveLength(13);
  });

  it("keeps a folded section's rows, so search still finds them", () => {
    const folded = makeTab(makePlugin()).tab;
    const open = makeTab(makePlugin({ settingsOpen: [...HEADINGS.keys()].map(String) })).tab;
    const names = (tab: InstanceType<typeof GoodObsidianSettingTab>) =>
      rows(tab)
        .filter((r) => shown(r.def) && r.def.searchable !== false)
        .map((r) => r.def.name);
    expect(names(folded)).toEqual(names(open));
    expect(names(folded)).toContain("Folder for recordings");
  });

  it("puts the section's icon before its heading and its state beside the chevron", async () => {
    const plugin = makePlugin({ defaultTool: "highlighter", defaultSize: 5, paperWidth: 900 });
    const { tab } = makeTab(plugin, false);
    const drawn = groups(tab).map(drawGroup);
    const [writing, pens, pages, models, ai, advanced] = drawn;
    expect(writing.header.find("goodobsidian-section-icon")?.attrs["data-icon"]).toBe("pencil");
    expect(
      writing.header.find("setting-item-name")?.children[0].hasClass("goodobsidian-section-icon"),
    ).toBe(true);
    const status = (g: (typeof drawn)[number]) =>
      g.header.find("goodobsidian-section-status")?.textContent;
    expect(status(writing)).toBe("Highlighter · 4.1 mm");
    expect(writing.header.find("goodobsidian-status-swatch")?.style.backgroundColor).toBe(
      plugin.settings.defaultColor,
    );
    expect(status(pens)).toBe("8 saved");
    expect(status(pages)).toBe("Light · 900 px");
    expect(status(models)).toBe("VoiceHandwriting");
    expect(models.header.findAll("goodobsidian-status-part").map((p) => [...p.classes])).toEqual([
      ["goodobsidian-status-part", "is-ready"],
      ["goodobsidian-status-part", "is-ready"],
    ]);
    expect(status(ai)).toBe("Not set up");
    expect(status(advanced)).toBe("");
    // The state follows a change made in the tab.
    await tab.setControlValue("defaultSize", "8");
    expect(status(writing)).toBe("Highlighter · 6.6 mm");
  });

  it("folds and unfolds from the header, and remembers it", () => {
    const plugin = makePlugin();
    const { tab } = makeTab(plugin, false);
    const pens = drawGroup(groups(tab)[1]);
    expect(pens.groupEl.hasClass("is-folded")).toBe(true);
    expect(pens.header.hasClass("goodobsidian-fold-header")).toBe(true);
    expect(pens.chevron?.attrs).toMatchObject({
      role: "button",
      "aria-expanded": "false",
      "aria-label": `Unfold ${PENS}`,
    });

    // A tap anywhere on the header, the chevron included, is one toggle.
    pens.chevron?.dispatch("click");
    expect(pens.groupEl.hasClass("is-folded")).toBe(false);
    expect(pens.chevron?.attrs["aria-expanded"]).toBe("true");
    expect(plugin.settings.settingsOpen).toEqual(["pens"]);
    expect(plugin.calls).toEqual(["save"]);

    // Reopening the settings (or Obsidian) draws it open.
    const reopened = makeTab(plugin, false).tab;
    expect(groups(reopened)[1].cls).toBe("goodobsidian-section");
    expect(unfoldedRows(reopened).some((r) => r.def.name === "Stylus side button")).toBe(true);

    // On a computer several stay open.
    const writing = drawGroup(groups(reopened)[0]);
    writing.header.find("setting-item-name")?.dispatch("click");
    expect(writing.groupEl.hasClass("is-folded")).toBe(false);
    expect(plugin.settings.settingsOpen).toEqual(["writing", "pens"]);
    // Space on the chevron, as on any button.
    const space = writing.chevron?.dispatch("keydown", { key: " " });
    expect(space?.defaultPrevented).toBe(true);
    expect(writing.groupEl.hasClass("is-folded")).toBe(true);
    expect(plugin.settings.settingsOpen).toEqual(["pens"]);
    writing.chevron?.dispatch("keydown", { key: "a" });
    expect(writing.groupEl.hasClass("is-folded")).toBe(true);
  });

  it("keeps one section open at a time on an iPad", () => {
    Platform.isMobile = true;
    try {
      const plugin = makePlugin({ settingsOpen: ["pens", "pages"] });
      const { tab } = makeTab(plugin, false);
      // Of two open on a computer and synced, the iPad shows the first.
      expect(groups(tab).map((g) => g.cls?.includes("is-folded"))).toEqual([
        true,
        false,
        true,
        true,
        true,
        true,
      ]);
      const [writing, pens] = groups(tab).map(drawGroup);
      writing.chevron?.dispatch("click");
      expect(writing.groupEl.hasClass("is-folded")).toBe(false);
      expect(pens.groupEl.hasClass("is-folded")).toBe(true);
      expect(writing.header.scrolledIntoView).toBe(1);
      expect(plugin.settings.settingsOpen).toEqual(["writing"]);
    } finally {
      Platform.isMobile = false;
    }
  });

  it("hides the rows after More until it is tapped, and keeps it open while the settings are", () => {
    const plugin = makePlugin({ settingsOpen: ["writing"] });
    const { tab } = makeTab(plugin, false);
    expect(groups(tab)[0].cls).toBe("goodobsidian-section");
    const writing = drawGroup(groups(tab)[0]);
    // Obsidian draws More as an action row and runs its action on a tap.
    const row = writing.groupEl.createDiv("setting-items").createDiv("setting-item mod-action");
    const tap = () => named(rows(tab), "More").action?.(row, 4);
    tap();
    expect(writing.groupEl.hasClass("is-more-open")).toBe(true);
    // Drawn again (a value changed), the section keeps its More open.
    expect(groups(tab)[0].cls).toBe("goodobsidian-section is-more-open");
    tap();
    expect(writing.groupEl.hasClass("is-more-open")).toBe(false);
    expect(groups(tab)[0].cls).toBe("goodobsidian-section");
    // Closing the settings forgets it.
    tap();
    tab.hide();
    expect(groups(tab)[0].cls).toBe("goodobsidian-section");
  });
});

describe("Models on this device", () => {
  /** The buttons the row shows now (the fake keeps every one ever added). */
  const current = (setting: FakeSetting) =>
    setting.buttons.filter((b) => setting.controlEl.children.includes(b.buttonEl));
  const menuButtons = (setting: FakeSetting) =>
    setting.extras.filter((b) => setting.controlEl.children.includes(b.extraSettingsEl));
  const GRAPE = "Handwriting · Grape 2.0";
  const VOICE = "Voice · Whisper base";
  const status = (setting: FakeSetting) =>
    setting.descEl.find("goodobsidian-model-status")?.textContent ?? "";

  it("says in one line whether each model is here and how big it is; what it is for is behind ⓘ", () => {
    const plugin = makePlugin();
    plugin.speech.store().state = { kind: "missing" };
    const { tab } = makeTab(plugin);
    const all = rows(tab);
    const grape = renderRow(named(all, GRAPE));
    expect(grape.descEl.textContent).toBe("Version 2.0, 5.7 MB, on this device.");
    expect(grape.descEl.find("goodobsidian-model-status")?.hasClass("is-ready")).toBe(true);
    expect(tab.infoOf(GRAPE)).toMatch(/^Grape \(handwriting recognizer model\) reads/);
    const voice = renderRow(named(all, VOICE));
    expect(status(voice)).toBe("Not downloaded yet (83.4 MB).");
    expect(voice.descEl.find("goodobsidian-model-status")?.hasClass("is-missing")).toBe(true);
    expect(tab.infoOf(VOICE)).toMatch(/^Whisper \(speech recognizer model\) turns recordings/);
  });

  it("puts Re-download and Remove of a downloaded model in its ⋯", async () => {
    const plugin = makePlugin();
    const setting = renderRow(named(rows(makeTab(plugin).tab), GRAPE));
    expect(current(setting)).toHaveLength(0);
    const [more] = menuButtons(setting);
    expect(more.icon).toBe("more-horizontal");
    await more.click();
    const menu = Menu.shown.at(-1);
    expect(menu?.items.map((i) => [i.title, i.warning])).toEqual([
      ["Re-download", false],
      ["Remove", true],
    ]);
    await menu?.pick("Remove");
    expect(plugin.calls).toEqual(expect.arrayContaining(["released:grape-2", "grape-2:remove"]));
    await menu?.pick("Re-download");
    expect(plugin.calls).toContain("grape-2:redownload");
  });

  it("offers the download when a model is missing, and again after a failure", async () => {
    const plugin = makePlugin();
    plugin.grape.model.state = { kind: "missing" };
    const { tab } = makeTab(plugin);
    const row = named(rows(tab), GRAPE);
    let setting = renderRow(row);
    expect(status(setting)).toBe("Not downloaded yet (5.7 MB).");
    expect(current(setting).map((b) => [b.text, b.cta])).toEqual([["Download", true]]);
    expect(menuButtons(setting)).toHaveLength(0);
    await current(setting)[0].click();
    expect(plugin.calls).toContain("grape-2:download");
    plugin.grape.model.state = { kind: "failed", reason: "offline", detail: "" };
    setting = renderRow(row);
    expect(status(setting)).toBe("Downloads when you're online.");
    expect(current(setting).map((b) => b.text)).toEqual(["Try again"]);
  });

  it("shows no buttons while a download runs", () => {
    const plugin = makePlugin();
    plugin.grape.model.state = { kind: "downloading", received: 0, total: 0 };
    const setting = renderRow(named(rows(makeTab(plugin).tab), GRAPE));
    expect(current(setting)).toHaveLength(0);
    expect(menuButtons(setting)).toHaveLength(0);
    expect(status(setting)).toMatch(/^Downloading/);
  });

  it("sets the voice model's size and language side by side", async () => {
    const plugin = makePlugin();
    const row = renderRow(named(rows(makeTab(plugin).tab), "Size and language"));
    expect(row.dropdowns[0].value).toBe("whisper-base");
    expect(row.dropdowns[0].options["whisper-tiny"]).toMatch(/^Whisper tiny \(/);
    expect(row.dropdowns[1].value).toBe("auto");
    await row.dropdowns[1].pick("nl");
    expect(plugin.settings.speechLanguage).toBe("nl");
    await row.dropdowns[0].pick("whisper-tiny");
    expect(plugin.settings.speechModel).toBe("whisper-tiny");
    expect(plugin.calls).toContain("update");
  });

  it("lists a model of another feature at the end", () => {
    const plugin = makePlugin();
    const other = fakeStore({ ...GRAPE_MODEL, id: "other", label: "Other model" }, plugin.calls);
    plugin.models.all = () => [plugin.grape.model, plugin.speech.store(), other];
    const names = rows(makeTab(plugin).tab)
      .filter((r) => r.heading === MODELS)
      .map((r) => r.def.name);
    expect(names).toEqual([
      ...MODEL_ROWS.map(([name]) => (name === "(block)" ? "" : name)),
      "Other model",
    ]);
  });

  it("calculates by default, with no model check and no warning under it", () => {
    const plugin = makePlugin();
    expect(plugin.settings.calcNotes).toBe(true);
    const all = rows(makeTab(plugin).tab);
    const at = all.findIndex((r) => r.def.name === "Calculate lines that end in =");
    expect(shown(all[at].def)).toBe(true);
    expect(all[at + 1].def.name).toBe("Your handwriting model");
  });

  it("offers Grape when reading or underlining is switched on", async () => {
    const plugin = makePlugin({ handwritingOnDevice: false });
    const { tab } = makeTab(plugin);
    await tab.setControlValue("handwritingOnDevice", true);
    await tab.setControlValue("checkHandwrittenWords", true);
    await tab.setControlValue("checkHandwrittenWords", false);
    expect(plugin.calls.filter((c) => c.startsWith("grape:offer"))).toEqual([
      "grape:offer:ask",
      "grape:offer:ask",
    ]);
  });
});

describe("the learned handwriting model", () => {
  const MODEL = "plug/handwriting/grape-2/personal.bin";
  const PREVIOUS = "plug/handwriting/grape-2/personal-prev.bin";
  const LEARNED = "Your handwriting model";
  const LEARN = "Learn your handwriting";
  const record = {
    learnedAt: "2026-10-21T20:00:00.000Z",
    lines: 240,
    tested: 60,
    before: 9.8,
    after: 4.1,
  };
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  /** The tab after its learning rows have looked in the vault once. */
  async function loaded(plugin: Plugin) {
    const made = makeTab(plugin);
    renderRow(named(rows(made.tab), LEARNED));
    await flush();
    return made;
  }
  const visible = (tab: InstanceType<typeof GoodObsidianSettingTab>) =>
    rows(tab)
      .filter((r) => r.heading === MODELS && shown(r.def))
      .map((r) => r.def.name);

  /** The learned model's ⋯ menu, opened; undefined when the row has none. */
  async function learnedMenu(tab: InstanceType<typeof GoodObsidianSettingTab>) {
    const row = renderRow(named(rows(tab), LEARNED));
    const more = row.extras[0];
    if (!more) return undefined;
    await more.click();
    return Menu.shown.at(-1);
  }

  it("invites a first learning, with nothing to switch, undo or delete", async () => {
    const { tab } = await loaded(makePlugin());
    expect(visible(tab)).not.toContain("Read with my model");
    const head = renderRow(named(rows(tab), LEARNED));
    expect(head.descEl.textContent).toBe("Not learned yet");
    expect(await learnedMenu(tab)).toBeUndefined();
    const learn = renderRow(named(rows(tab), LEARN));
    expect(learn.descEl.text).toBe("0 of 3 sheets · 0 lines");
    expect(learn.buttons.map((b) => [b.text, b.cta])).toEqual([
      ["Write sheet 1", true],
      ["Learn now", false],
    ]);
    expect(learn.buttons[1].disabled).toBe(true);
    expect(tab.infoOf(LEARN)).toMatch(/Copy at least 10 lines first \(0 so far\)/);
  });

  it("offers the symbol sheet beside the text sheets, before either is written", async () => {
    const plugin = makePlugin();
    const { tab } = await loaded(plugin);
    const learn = renderRow(named(rows(tab), LEARN));
    const chips = learn.settingEl.findAll("goodobsidian-sheet-chip");
    expect(chips.map((c) => c.textContent)).toEqual(["Symbols"]);
    chips[0].dispatch("click");
    await flush();
    expect(plugin.calls).toContain("closeSettings");
    expect(plugin.calls).toContain(`practice:${SYMBOL_SET}`);
  });

  it("describes a learned model in one line: in use, and how much better it reads", async () => {
    const plugin = makePlugin({ grape2Model: record });
    plugin.files.set(MODEL, "abcd");
    const { tab } = await loaded(plugin);
    const head = renderRow(named(rows(tab), LEARNED));
    expect(head.descEl.textContent).toBe("In use · 9.8 % → 4.1 % · 1 KB");
    expect(tab.infoOf(LEARNED)).toContain("learned 21 Oct 2026 from 240 of your lines");
    expect(tab.infoOf(LEARNED)).toContain("58 % fewer mistakes.");
    expect(visible(tab)).toContain("Read with my model");
    expect((await learnedMenu(tab))?.items.map((i) => i.title)).toEqual(["Delete…"]);
  });

  it("switches to Grape alone without touching the file", async () => {
    const plugin = makePlugin({ grape2Model: record });
    plugin.files.set(MODEL, "abcd");
    const { tab } = await loaded(plugin);
    await tab.setControlValue("useLearnedHandwriting", false);
    expect(plugin.settings.useLearnedHandwriting).toBe(false);
    expect(plugin.files.has(MODEL)).toBe(true);
    expect(plugin.settings.grape2Model).toBe(record);
    expect(plugin.calls.filter((c) => c.startsWith("rm:"))).toEqual([]);
    const head = renderRow(named(rows(tab), LEARNED));
    expect(head.descEl.textContent).toContain("Off · Grape alone");
  });

  it("deletes only after a confirmation that says what goes", async () => {
    const plugin = makePlugin({ grape2Model: record });
    plugin.files.set(MODEL, "abcd");
    plugin.files.set(PREVIOUS, "old");
    const { tab } = await loaded(plugin);
    const menu = await learnedMenu(tab);
    expect(menu?.items.map((i) => [i.title, i.warning])).toEqual([
      ["Go back to the previous model", false],
      ["Delete…", true],
    ]);
    dialogs.confirmAnswer = false;
    await menu?.pick("Delete…");
    await flush();
    expect(dialogs.confirms.at(-1)).toMatchObject({
      title: "Delete your learned handwriting model?",
      cta: "Delete",
      warning: true,
    });
    expect(dialogs.confirms.at(-1)?.message).toMatch(/Its file and the one before it are deleted/);
    expect(plugin.files.has(MODEL)).toBe(true);
    dialogs.confirmAnswer = true;
    await menu?.pick("Delete…");
    await flush();
    expect(plugin.files.size).toBe(0);
    expect(plugin.settings.grape2Model).toBeUndefined();
  });

  it("goes back to the previous model, keeping the current one to swap back", async () => {
    const older = { ...record, learnedAt: "2026-10-13", after: 6.2 };
    const plugin = makePlugin({ grape2Model: record, grape2ModelPrevious: older });
    plugin.files.set(MODEL, "new");
    plugin.files.set(PREVIOUS, "old");
    const { tab } = await loaded(plugin);
    rows(tab);
    expect(tab.infoOf(LEARNED)).toMatch(/learned 13 Oct 2026 .* 6.2 %/);
    await (await learnedMenu(tab))?.pick("Go back to the previous model");
    await flush();
    expect(plugin.files.get(MODEL)).toBe("old");
    expect(plugin.files.get(PREVIOUS)).toBe("new");
    expect(plugin.settings.grape2Model).toBe(older);
  });
});
