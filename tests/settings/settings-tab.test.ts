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
vi.mock("../../src/view/folder-suggest", () => ({
  FolderInputSuggest: class {
    constructor(_app: unknown, inputEl: unknown, onPick: (path: string) => void) {
      dialogs.folderSuggests.push({ inputEl, onPick });
    }
  },
}));

const { ExtraButtonComponent, FakeEl, Platform, Setting } = await import("../fakes/obsidian");
const { DEFAULT_SETTINGS, GoodObsidianSettingTab, shortcutList } =
  await import("../../src/settings");
const { SIZES } = await import("../../src/constants");
const { DEFAULT_MODELS, LLM_PROVIDER_ID, VENDOR_LABELS, VENDORS } =
  await import("../../src/recognition/llm-request");
const { DEFAULT_IMAGE_MODELS, imageUnsupportedReason } =
  await import("../../src/recognition/ai-image");
const { providerLabel } = await import("../../src/recognition/registry");
const { MANUAL_PROVIDER_ID } = await import("../../src/recognition/manual");

type Settings = typeof DEFAULT_SETTINGS;
type FakeSetting = InstanceType<typeof Setting>;

// --- A fake plugin ------------------------------------------------------------

function makePlugin(overrides: Partial<Settings> = {}, keys: Record<string, string> = {}) {
  const calls: string[] = [];
  const settings: Settings = { ...structuredClone(DEFAULT_SETTINGS), ...overrides };
  const plugin = {
    settings,
    calls,
    keys: { secure: true },
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
    setPenCursor: vi.fn((on: boolean) => {
      calls.push(`penCursor:${on}`);
      settings.penCursor = on;
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
  return def.control ? `${def.control.type}:${def.control.key}` : def.render ? "render" : "none";
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
const SUPPORT = "Support and diagnostics";
const COMMUNITY = "Feedback and community";
const WRITING = "Writing and tools";
const PAGES = "Pages and notebooks";
const HANDWRITING = "Handwriting";
const ADVANCED = "Advanced";
const PENS = "Pens and shortcuts";

beforeEach(() => {
  dialogs.keyModals.length = 0;
  dialogs.confirms.length = 0;
  dialogs.confirmAnswer = true;
  dialogs.folderSuggests.length = 0;
  Platform.isIosApp = false;
  Platform.isTablet = false;
});

// --- Layout ------------------------------------------------------------------

describe("the rows", () => {
  it("come in this order, grouped under these headings", () => {
    const { tab } = makeTab(makePlugin());
    const label = VENDORS.anthropic.label;
    expect(rows(tab).map((r) => [r.heading, r.def.name || "(block)", kind(r.def)])).toEqual([
      ["", "(block)", "render"],
      [WRITING, "Draw and hold to make shapes", "toggle:drawAndHold"],
      [WRITING, "Select active tool again to return to pen", "toggle:returnToPenOnReselect"],
      [WRITING, "Return to pen after one use", "toggle:returnToPenAfterUse"],
      [WRITING, "Double-tap with fingers to undo and redo", "toggle:fingerTapUndo"],
      [WRITING, "Default tool", "dropdown:defaultTool"],
      [WRITING, "Default stroke size", "dropdown:defaultSize"],
      [WRITING, "Default ink color", "color:defaultColor"],
      [WRITING, "Custom colors", "text:customColors"],
      [WRITING, "Highlighter opacity", "slider:highlighterAlpha"],
      [PENS, "Saved pens", "render"],
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => [PENS, `Saved pen ${n}`, "render"]),
      [PENS, "Save the pen in hand", "render"],
      [PENS, "Straighten highlighter strokes", "toggle:straightHighlighter"],
      [PENS, "Stylus side button", "dropdown:barrelButton"],
      [PENS, "Crosshair cursor", "toggle:penCursor"],
      [PENS, "Keyboard and stylus shortcuts", "render"],
      [PAGES, "Page appearance", "dropdown:pageAppearance"],
      [PAGES, "Dark PDF pages", "toggle:invertPdfPages"],
      [PAGES, "Paper width", "render"],
      [PAGES, "(block)", "render"],
      [PAGES, "Default folder for new notebooks", "render"],
      [PAGES, "Show New notebook in right-click menu", "toggle:showNewNotebookInContextMenu"],
      [PAGES, "Show New notebook in file explorer bar", "toggle:showNewNotebookInExplorer"],
      [HANDWRITING, "Read handwriting on this device (beta)", "toggle:handwritingOnDevice"],
      [HANDWRITING, "Learn my handwriting", "render"],
      [AI, "Set up an AI service", "render"],
      [AI, "AI service", "dropdown:llmVendor"],
      [AI, "Endpoint URL", "render"],
      [AI, "(block)", "render"],
      [AI, "(block)", "render"],
      [AI, "Connect OpenRouter", "render"],
      [AI, "AI model", "text:llmModel"],
      [AI, `${label} API key`, "render"],
      [AI, "(block)", "render"],
      [AI, "Image generation", "dropdown:imageVendor"],
      [AI, "(block)", "render"],
      [AI, "Image model", "text:imageModel"],
      [AI, `${label} API key for images`, "render"],
      [AI, "Handwriting recognition", "dropdown:recognitionProviderId"],
      [AI, "Recognize automatically", "toggle:autoRecognize"],
      [ADVANCED, "Desynchronized canvas", "toggle:desynchronizedCanvas"],
      [ADVANCED, "Pressure-sensitive pens (advanced)", "toggle:pressureWidth"],
      [ADVANCED, "(block)", "render"],
      [ADVANCED, "Handwriting model file", "text:hwrModelPath"],
      [SUPPORT, "Input debug overlay", "toggle:debugHud"],
      [COMMUNITY, "Ideas and questions", "render"],
      [COMMUNITY, "Report a bug", "render"],
      [COMMUNITY, "Follow FineNotes", "render"],
    ]);
  });

  it("keeps blocks out of search and gives every shown row a description", () => {
    for (const vendor of ["anthropic", "custom", "openrouter", "google"] as const) {
      const { tab } = makeTab(makePlugin({ llmVendor: vendor, imageVendor: "openai" }));
      for (const { def } of rows(tab)) {
        if (def.name === "") {
          expect(def.searchable).toBe(false);
          expect(def.render).toBeTypeOf("function");
        } else if (shown(def)) {
          expect(def.desc, def.name).toBeTruthy();
        }
      }
    }
  });

  it("offers these extra search words", () => {
    const { tab } = makeTab(makePlugin());
    const aliases = Object.fromEntries(
      rows(tab)
        .filter((r) => r.def.name !== "")
        .map((r) => [r.def.name, r.def.aliases ?? []]),
    );
    const label = VENDORS.anthropic.label;
    expect(aliases).toEqual({
      "Draw and hold to make shapes": ["shape recognition", "straighten", "snap"],
      "Select active tool again to return to pen": ["tool", "eraser", "lasso", "text", "shape"],
      "Return to pen after one use": ["tool", "eraser", "lasso", "text", "shape"],
      "Double-tap with fingers to undo and redo": ["undo", "redo", "gesture", "fingers", "tap"],
      "Desynchronized canvas": ["latency", "glitch", "artifacts"],
      "Pressure-sensitive pens (advanced)": [
        "pressure sensitivity",
        "stylus",
        "Apple Pencil",
        "fountain pen",
        "brush pen",
      ],
      "Page appearance": ["dark mode", "night mode", "invert", "theme"],
      "Dark PDF pages": ["dark mode", "invert", "slides"],
      "Paper width": ["canvas size", "page width"],
      "Default folder for new notebooks": ["folder", "location", "new notebook", "new page"],
      "Show New notebook in right-click menu": ["context menu", "file explorer", "new notebook"],
      "Show New notebook in file explorer bar": ["toolbar", "file explorer", "new notebook"],
      "Default ink color": ["pen color"],
      "Default tool": [],
      "Default stroke size": ["pen size", "line width"],
      "Highlighter opacity": ["transparency", "alpha"],
      "Custom colors": ["palette"],
      "Saved pens": ["favorite pens", "presets"],
      ...Object.fromEntries(
        [1, 2, 3, 4, 5, 6, 7, 8].map((n) => [
          `Saved pen ${n}`,
          ["favorite pen", "preset", "number key"],
        ]),
      ),
      "Save the pen in hand": ["favorite pen", "preset"],
      "Straighten highlighter strokes": ["highlighter", "straight", "line"],
      "Stylus side button": ["barrel button", "pen tablet", "wacom", "stylus"],
      "Crosshair cursor": ["cursor", "pointer"],
      "Keyboard and stylus shortcuts": ["hotkeys", "keys", "modifier"],
      "Read handwriting on this device (beta)": ["handwriting", "recognition", "search", "offline"],
      "Learn my handwriting": ["handwriting", "practice", "fine-tune", "personal", "recognition"],
      "Handwriting model file": ["handwriting", "recognition", "model"],
      "Handwriting recognition": ["OCR", "handwriting to text"],
      "Recognize automatically": ["auto recognition"],
      "Set up an AI service": ["API key", "AI", "transcribe"],
      "AI service": ["Anthropic", "Claude", "OpenAI", "GPT", "Gemini", "OpenRouter", "Cloud AI"],
      "Endpoint URL": ["self-hosted", "local server"],
      "Connect OpenRouter": [],
      "AI model": [],
      [`${label} API key`]: ["token", "secret", "API key"],
      "Image generation": ["generate image", "picture", "DALL-E", "GPT Image", "Nano Banana"],
      "Image model": [],
      [`${label} API key for images`]: ["image key"],
      "Input debug overlay": ["diagnostics", "HUD", "troubleshooting"],
      "Ideas and questions": ["feedback", "idea", "question", "suggestion", "community"],
      "Report a bug": ["bug", "issue", "problem", "GitHub"],
      "Follow FineNotes": ["social", "X", "Twitter", "Instagram", "TikTok", "YouTube"],
    });
  });

  it("offers these choices", () => {
    const { tab } = makeTab(makePlugin());
    const all = rows(tab);
    expect(named(all, "Default tool").control?.options).toEqual({
      pen: "Pen",
      highlighter: "Highlighter",
      eraser: "Eraser",
      select: "Select",
    });
    const sizes = named(all, "Default stroke size").control?.options ?? {};
    expect(Object.entries(sizes)).toEqual(SIZES.map((s) => [String(s), String(s)]));
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
    expect(named(all, "Custom colors").control?.placeholder).toBe("#ff8800, #00ccaa");
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
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `Saved pen ${n}`),
  "Save the pen in hand",
  "Straighten highlighter strokes",
  "Stylus side button",
  "Crosshair cursor",
  "Keyboard and stylus shortcuts",
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
    const toggle = "Pressure-sensitive pens (advanced)";
    expect(off[off.indexOf(toggle) + 1]).toBe("Handwriting model file");
    expect(on[on.indexOf(toggle) + 1]).toMatch(/^\(block \d+\)$/);
  });

  it("by default: no iPad tip, and the AI group folded into one row", () => {
    expect(visibleNames(makePlugin(), false)).toEqual([
      "Draw and hold to make shapes",
      "Select active tool again to return to pen",
      "Return to pen after one use",
      "Double-tap with fingers to undo and redo",
      "Default tool",
      "Default stroke size",
      "Default ink color",
      "Custom colors",
      "Highlighter opacity",
      ...PEN_ROWS,
      // "Dark PDF pages" shows with dark pages only.
      "Page appearance",
      "Paper width",
      "Default folder for new notebooks",
      "Show New notebook in right-click menu",
      "Show New notebook in file explorer bar",
      "Read handwriting on this device (beta)",
      "Learn my handwriting",
      "Set up an AI service",
      "Desynchronized canvas",
      "Pressure-sensitive pens (advanced)",
      "Handwriting model file",
      "Input debug overlay",
      "Ideas and questions",
      "Report a bug",
      "Follow FineNotes",
    ]);
  });

  it("opens the AI group on Show: Manual recognition, Claude, keys in the keychain", () => {
    const label = VENDORS.anthropic.label;
    const names = visibleNames(makePlugin());
    const from = names.indexOf("Set up an AI service");
    expect(names.slice(from, names.indexOf("Desynchronized canvas"))).toEqual([
      "Set up an AI service",
      "AI service",
      "AI model",
      `${label} API key`,
      "Image generation",
      // Claude makes no pictures: the callout saying so.
      `(block ${29 + PEN_ROWS.length})`,
      "Handwriting recognition",
    ]);
  });

  it("shows the AI group without asking once a key is set up", () => {
    const plugin = makePlugin({}, { anthropic: "sk-test" });
    const names = visibleNames(plugin, false);
    expect(names).not.toContain("Set up an AI service");
    expect(names).toContain("AI service");
    expect(names).toContain("Handwriting recognition");
  });

  it("shows the Scribble tip on an iPad only", () => {
    Platform.isIosApp = true;
    Platform.isTablet = true;
    const { tab } = makeTab(makePlugin());
    const tip = rows(tab)[0].def;
    expect(shown(tip)).toBe(true);
    expect(renderRow(tip).settingEl.textContent).toMatch(/Scribble/);
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

  it.each(["returnToPenOnReselect", "returnToPenAfterUse"] as const)(
    "persists %s independently, disabled by default",
    async (key) => {
      const plugin = makePlugin();
      const { tab } = makeTab(plugin);
      expect(plugin.settings[key]).toBe(false);
      await tab.setControlValue(key, true);
      expect(plugin.settings[key]).toBe(true);
      const other =
        key === "returnToPenOnReselect" ? "returnToPenAfterUse" : "returnToPenOnReselect";
      expect(plugin.settings[other]).toBe(false);
      expect(plugin.saveSettings).toHaveBeenCalledOnce();
    },
  );

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
    await tab.setControlValue("drawAndHold", false);
    await tab.setControlValue("defaultColor", "#123456");
    expect(plugin.settings.defaultSize).toBe(4);
    expect(plugin.settings.highlighterAlpha).toBe(0.4);
    expect(plugin.settings.customColors).toEqual(["#ff8800", "#00CCAA", "#abc"]);
    expect(plugin.settings.llmModel).toBe("claude-haiku-4-5");
    expect(plugin.settings.imageModel).toBe("gpt-image-1");
    expect(plugin.settings.drawAndHold).toBe(false);
    expect(plugin.settings.defaultColor).toBe("#123456");
    expect(plugin.saveSettings).toHaveBeenCalledTimes(7);
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
  it("saves a whole number from 320 to 4096 and flags anything else", async () => {
    const plugin = makePlugin({ paperWidth: 1024 });
    const { tab, fake } = makeTab(plugin);
    const all = rows(tab);
    const setting = renderRow(named(all, "Paper width"));
    const callout = blockAfter(all, "Paper width");
    const field = setting.texts[0];
    expect(field.value).toBe("1024");
    expect(shown(callout)).toBe(false);

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
    let refreshes = 0;
    for (const [typed, stored, flagged] of cases) {
      await field.type(typed);
      expect([typed, plugin.settings.paperWidth, shown(callout)]).toEqual([typed, stored, flagged]);
      expect(fake.domRefreshes).toBe(++refreshes);
    }
    expect(plugin.saveSettings).toHaveBeenCalledTimes(4);

    const text = renderRow(callout).settingEl.textContent;
    expect(text).toContain("320");
    expect(text).toContain("4096");
  });

  it("forgets a bad entry when the tab is drawn again", async () => {
    const { tab } = makeTab(makePlugin());
    const all = rows(tab);
    await renderRow(named(all, "Paper width")).texts[0].type("99999");
    expect(shown(blockAfter(all, "Paper width"))).toBe(true);
    renderRow(named(all, "Paper width"));
    expect(shown(blockAfter(all, "Paper width"))).toBe(false);
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
    const setting = renderRow(named(rows(makeTab(plugin).tab), "Default folder for new notebooks"));
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

  it("says where each key is kept and where it goes", () => {
    const all = rows(makeTab(makePlugin({ imageVendor: "openai" })).tab);
    expect(named(all, "Anthropic (Claude) API key").desc).toBe(
      "Your own key. Kept in Obsidian's keychain (Settings → Keychain), outside this vault's files; " +
        "sent only to Anthropic (Claude), and only when you start an AI action.",
    );
    const insecure = makePlugin({ imageVendor: "openai" });
    insecure.keys.secure = false;
    expect(named(rows(makeTab(insecure).tab), "OpenAI (GPT) API key for images").desc).toBe(
      "Your own OpenAI (GPT) key, used only to generate images. Stored in this vault's plugin data; " +
        "sent only to OpenAI (GPT).",
    );
    expect(
      named(rows(makeTab(makePlugin({ llmVendor: "custom" })).tab), "Endpoint API key").desc,
    ).toBe(
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

describe("the support footer", () => {
  it("links to Discussions, the bug report and FineNotes' accounts", async () => {
    const opened: string[] = [];
    vi.stubGlobal("window", { open: (url: string) => opened.push(url) });
    try {
      const all = rows(makeTab(makePlugin()).tab);
      for (const name of ["Ideas and questions", "Report a bug", "Follow FineNotes"]) {
        for (const button of renderRow(named(all, name)).buttons) await button.click();
      }
      expect(opened).toEqual([
        "https://github.com/Joost-8/FineNotes/discussions",
        "https://github.com/Joost-8/FineNotes/issues/new/choose",
        "https://x.com/finenotes_",
        "https://www.instagram.com/finenotesobsidian/",
        "https://www.tiktok.com/@finenotesobsidian",
        "https://www.youtube.com/@FineNotesAtObsidian",
      ]);
      expect(renderRow(named(all, "Follow FineNotes")).buttons.map((b) => b.text)).toEqual([
        "X",
        "Instagram",
        "TikTok",
        "YouTube",
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
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
  it("edits a saved pen's type, colour and width where it is", async () => {
    const plugin = makePlugin();
    const all = rows(makeTab(plugin).tab);
    const setting = renderRow(named(all, "Saved pen 2"));
    expect(setting.dropdowns[0].value).toBe("ball");
    expect(Object.keys(setting.dropdowns[0].options)).toEqual([
      "fountain",
      "ball",
      "brush",
      "highlighter",
    ]);
    expect(setting.colors[0].value).toBe("#e03131");
    expect(setting.texts[0].value).toBe("0.41");

    await setting.colors[0].pick("#00AA00");
    expect(plugin.settings.savedPens[1].color).toBe("#00aa00");
    expect(setting.find("goodobsidian-saved-pen-swatch")?.style.backgroundColor).toBe("#00aa00");
    // Typed widths are saved as they become widths; the tab is not rebuilt under the field.
    await setting.texts[0].type("1");
    expect(plugin.settings.savedPens[1].size).toBe(4.88);
    await setting.texts[0].type("9");
    expect(plugin.settings.savedPens[1].size).toBe(4.88);
    expect(setting.texts[0].inputEl.hasClass("is-invalid")).toBe(true);
    expect(plugin.calls).not.toContain("update");
    await setting.dropdowns[0].pick("highlighter");
    expect(plugin.settings.savedPens[1].type).toBe("highlighter");
    expect(plugin.calls).toContain("update");
  });

  it("moves and deletes saved pens, and keeps the ends' arrows off", async () => {
    const plugin = makePlugin();
    const all = rows(makeTab(plugin).tab);
    const first = renderRow(named(all, "Saved pen 1"));
    const last = renderRow(named(all, "Saved pen 8"));
    expect(first.extras.map((b) => [b.icon, b.disabled])).toEqual([
      ["arrow-up", true],
      ["arrow-down", false],
      ["trash-2", false],
    ]);
    expect(last.extras[1].disabled).toBe(true);
    const [blue, red] = plugin.settings.savedPens;
    await first.extras[1].click();
    expect(plugin.settings.savedPens.slice(0, 2)).toEqual([red, blue]);
    await first.extras[2].click();
    expect(plugin.settings.savedPens).toHaveLength(7);
    expect(plugin.settings.savedPens[0]).toEqual(blue);
  });

  it("saves the pen in hand once, and restores the defaults", async () => {
    const lastPen = { type: "brush" as const, color: "#123456", size: 4 };
    const plugin = makePlugin({ lastPen });
    const all = rows(makeTab(plugin).tab);
    expect(named(all, "Save the pen in hand").desc).toContain("Brush pen");
    const save = renderRow(named(all, "Save the pen in hand"));
    // Eight are saved already: full.
    expect(save.button("Save pen").disabled).toBe(true);
    plugin.settings.savedPens = plugin.settings.savedPens.slice(0, 3);
    const room = renderRow(named(rows(makeTab(plugin).tab), "Save the pen in hand"));
    expect(room.button("Save pen").disabled).toBe(false);
    await room.button("Save pen").click();
    expect(plugin.settings.savedPens[3]).toEqual(lastPen);
    expect(named(rows(makeTab(plugin).tab), "Save the pen in hand").desc).toContain("saved");
    const restore = renderRow(named(all, "Saved pens"));
    await restore.button("Restore defaults").click();
    expect(plugin.settings.savedPens).toHaveLength(8);
  });

  it("asks for a pen first when none was written with", () => {
    const all = rows(makeTab(makePlugin()).tab);
    expect(named(all, "Save the pen in hand").desc).toMatch(/first/);
    const save = renderRow(named(all, "Save the pen in hand"));
    expect(save.button("Save pen").disabled).toBe(true);
  });

  it("offers the barrel's four choices, and the cursor only on a computer", () => {
    const all = rows(makeTab(makePlugin()).tab);
    expect(Object.keys(named(all, "Stylus side button").control?.options ?? {})).toEqual([
      "erase",
      "lasso",
      "pan",
      "none",
    ]);
    expect(shown(named(all, "Crosshair cursor"))).toBe(true);
    Platform.isMobile = true;
    try {
      expect(shown(named(rows(makeTab(makePlugin()).tab), "Crosshair cursor"))).toBe(false);
    } finally {
      Platform.isMobile = false;
    }
  });

  it("hands the cursor switch to the plugin, which updates every notebook", async () => {
    const plugin = makePlugin();
    await makeTab(plugin).tab.setControlValue("penCursor", false);
    expect(plugin.calls).toEqual(["penCursor:false"]);
  });

  it("lists the shortcuts in groups, each key a key cap, Ctrl or ⌘ by platform", () => {
    const pc = renderRow(named(rows(makeTab(makePlugin()).tab), "Keyboard and stylus shortcuts"));
    const list = pc.find("goodobsidian-shortcuts");
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
    const ipad = renderRow(named(rows(makeTab(makePlugin()).tab), "Keyboard and stylus shortcuts"));
    const redo = ipad
      .find("goodobsidian-shortcuts")
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

  it("folds the shortcut list at first, and remembers it open", () => {
    const plugin = makePlugin();
    const row = renderRow(named(rows(makeTab(plugin).tab), "Keyboard and stylus shortcuts"));
    expect(row.settingEl.hasClass("is-folded")).toBe(true);
    const chevron = row.extras[0].extraSettingsEl;
    expect(chevron.attrs["aria-expanded"]).toBe("false");

    // Reading the list is not folding it.
    row.find("goodobsidian-shortcut-action")?.dispatch("click");
    chevron.dispatch("click");
    expect(row.settingEl.hasClass("is-folded")).toBe(false);
    expect(chevron.attrs["aria-expanded"]).toBe("true");
    expect(plugin.settings.foldedSettingsSections).toEqual(["pens"]);
    expect(plugin.calls).toEqual(["save"]);
    row.find("goodobsidian-shortcut-action")?.dispatch("click");
    expect(row.settingEl.hasClass("is-folded")).toBe(false);

    // Opened again later, it is open.
    const again = renderRow(named(rows(makeTab(plugin).tab), "Keyboard and stylus shortcuts"));
    expect(again.settingEl.hasClass("is-folded")).toBe(false);
    // The keyboard folds it from the chevron.
    const key = again.extras[0].extraSettingsEl.dispatch("keydown", { key: "Enter" });
    expect(key.defaultPrevented).toBe(true);
    expect(again.settingEl.hasClass("is-folded")).toBe(true);
    expect(plugin.settings.foldedSettingsSections).toEqual(["pens", "shortcuts"]);
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

describe("folding sections", () => {
  it("folds Pens and shortcuts only, at first", () => {
    const { tab } = makeTab(makePlugin(), false);
    expect(groups(tab).map((g) => [g.heading, g.cls])).toEqual([
      [WRITING, "goodobsidian-section"],
      [PENS, "goodobsidian-section is-folded"],
      [PAGES, "goodobsidian-section"],
      [HANDWRITING, "goodobsidian-section"],
      [AI, "goodobsidian-section"],
      [ADVANCED, "goodobsidian-section"],
      [SUPPORT, "goodobsidian-section"],
      [COMMUNITY, "goodobsidian-section"],
    ]);
    const shownHeadings = new Set(unfoldedRows(tab).map((r) => r.heading));
    expect(shownHeadings.has(PENS)).toBe(false);
    expect(shownHeadings.has(WRITING) && shownHeadings.has(COMMUNITY)).toBe(true);
    expect(unfoldedRows(tab).filter((r) => r.heading === WRITING)).toHaveLength(9);
  });

  it("shows the rows of the sections that are open", () => {
    const plugin = makePlugin({
      foldedSettingsSections: ["writing", "pages", "handwriting", "ai", "advanced", "support"],
    });
    const headings = unfoldedRows(makeTab(plugin, false).tab).map((r) => r.heading);
    expect([...new Set(headings)]).toEqual([PENS, COMMUNITY]);
    expect(headings.filter((h) => h === PENS)).toHaveLength(14);
  });

  it("keeps a folded section's rows, so search still finds them", () => {
    const folded = makeTab(
      makePlugin({
        foldedSettingsSections: [
          "writing",
          "pens",
          "shortcuts",
          "pages",
          "handwriting",
          "ai",
          "advanced",
          "support",
          "community",
        ],
      }),
    ).tab;
    const open = makeTab(makePlugin({ foldedSettingsSections: [] })).tab;
    const names = (tab: InstanceType<typeof GoodObsidianSettingTab>) =>
      rows(tab)
        .filter((r) => shown(r.def) && r.def.searchable !== false)
        .map((r) => r.def.name);
    expect(names(folded)).toEqual(names(open));
    expect(names(folded)).toContain("Keyboard and stylus shortcuts");
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
    expect(plugin.settings.foldedSettingsSections).toEqual(["shortcuts"]);
    expect(plugin.calls).toEqual(["save"]);

    // Reopening the settings (or Obsidian) draws it open.
    const reopened = makeTab(plugin, false).tab;
    expect(groups(reopened)[1].cls).toBe("goodobsidian-section");
    expect(unfoldedRows(reopened).some((r) => r.def.name === "Stylus side button")).toBe(true);

    const writing = drawGroup(groups(reopened)[0]);
    writing.header.find("setting-item-name")?.dispatch("click");
    expect(writing.groupEl.hasClass("is-folded")).toBe(true);
    expect(plugin.settings.foldedSettingsSections).toEqual(["writing", "shortcuts"]);
    // Space on the chevron, as on any button.
    const space = writing.chevron?.dispatch("keydown", { key: " " });
    expect(space?.defaultPrevented).toBe(true);
    expect(writing.groupEl.hasClass("is-folded")).toBe(false);
    expect(plugin.settings.foldedSettingsSections).toEqual(["shortcuts"]);
    writing.chevron?.dispatch("keydown", { key: "a" });
    expect(writing.groupEl.hasClass("is-folded")).toBe(false);
  });
});
