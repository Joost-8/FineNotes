/**
 * The plugin's `data.json`: which keys it holds, what a fresh install writes,
 * and that a user's saved file survives a load and a save unchanged. The
 * keys and their stored shapes are a file format — every vault that ever ran
 * the plugin has one — so this file pins them literally, including the order
 * a fresh install writes them in.
 *
 * Loading is `Object.assign({}, DEFAULT_SETTINGS, saved)` (Obsidian's sample
 * plugin idiom, in `main.ts`), and saving writes the object back as JSON;
 * `loadAndSave` below does both.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  PAPER_WIDTH_RANGE,
  changesTabLayout,
  appearanceChoiceOf,
  endpointWarning,
  openSectionsOf,
  pagesAreDark,
  paperWidthFrom,
  parseColorList,
  returnToPenOf,
  sectionOpen,
  shownPaperTheme,
  shownValue,
  storeAppearanceChoice,
  storeReturnToPen,
  storeShownValue,
  withSection,
} from "../../src/settings-data";
import { DARK_PAPER, LIGHT_PAPER } from "../../src/canvas/backdrop";

/**
 * What a fresh install writes, key for key and in this order. `twoFileStorage`
 * (false) followed `recognitionProviderId` until 2026-09: nothing read it, so
 * it went; vaults that have it keep it, as they keep any key (below).
 */
const FRESH_INSTALL = {
  drawAndHold: true,
  defaultTool: "pen",
  customColors: [],
  defaultColor: "#1a1a1a",
  defaultSize: 3,
  eraserMode: "standard",
  eraserSize: 24,
  eraserFilter: "all",
  lassoMode: "freehand",
  lassoFilter: {
    handwriting: true,
    images: true,
    shapes: true,
    arrows: true,
    textBoxes: true,
    tables: true,
    graphs: true,
  },
  highlighterAlpha: 0.4,
  paperWidth: 1024,
  newNotebookFolder: "",
  lastNotebookChoices: null,
  lastNotebookTemplate: null,
  recognitionProviderId: "manual",
  desynchronizedCanvas: true,
  debugHud: false,
  scribbleNoticeShown: false,
  lastSeenVersion: "",
  checkForUpdates: true,
  updateReminders: true,
  llmVendor: "anthropic",
  llmModel: "",
  llmApiKey: "",
  llmBaseUrl: "",
  llmCustomApiKey: "",
  apiKeys: {},
  imageVendor: "same",
  imageModel: "",
  imageAspect: "square",
  askSaveChats: false,
  askLayout: "window",
  cloudConsentGiven: false,
  customConsentGiven: false,
  autoRecognize: false,
  textStyle: { color: "#1a1a1a", fontSize: 22 },
  textToolPinned: false,
  textDragSize: false,
  textHintShown: 0,
  textHintDismissed: false,
  penAutoShape: false,
  penGestures: { scribbleErase: true, scribbleErasesAll: false, circleLasso: true },
  shapeColor: "#000000",
  stickerFolder: "FineNotes assets/Stickers",
  imagesFolder: "",
  recordingsFolder: "",
  transcriptsFolder: "",
  chatsFolder: "",
  exportsFolder: "",
  templateFolder: "FineNotes assets/Templates",
  templateGalleryUrl: "",
  recentColors: [],
  pressureWidth: false,
  returnToPenOnReselect: false,
  returnToPenAfterUse: false,
  fingerTapUndo: true,
  handwritingOnDevice: true,
  replayInk: true,
  checkHandwrittenWords: false,
  calcNotes: true,
  speechModel: "whisper-base",
  speechLanguage: "auto",
  notebookOwnFolder: true,
  showNewNotebookInContextMenu: true,
  showNewNotebookInExplorer: false,
  folderNotebooks: true,
  pageAppearance: "light",
  invertPdfPages: true,

  savedPens: [
    { type: "ball", color: "#1971c2", size: 2 },
    { type: "ball", color: "#e03131", size: 2 },
    { type: "ball", color: "#2f9e44", size: 2 },
    { type: "fountain", color: "#1971c2", size: 5 },
    { type: "fountain", color: "#1a1a1a", size: 3 },
    { type: "ball", color: "#1a1a1a", size: 1.22 },
    { type: "brush", color: "#9c36b5", size: 3 },
    { type: "highlighter", color: "#fab005", size: 5 },
  ],
  toolbarItems: ["select", "pen", "eraser", "text", "shape", "image", "pdf"],
  barrelButton: "erase",
  penCursor: "ink",
  straightHighlighter: true,
  onlyStylusMode: false,
  settingsOpen: [],
  scribbleTipDismissed: false,
};

/**
 * A long-used vault's file: every key away from its default, the pre-0.5
 * plaintext keys still there, and keys this build no longer knows.
 */
const USED_VAULT = {
  drawAndHold: false,
  defaultTool: "highlighter",
  customColors: ["#ff8800", "#0ca"],
  defaultColor: "#2255aa",
  defaultSize: 5,
  eraserMode: "stroke",
  eraserSize: 40,
  eraserFilter: "highlighter",
  lassoMode: "rectangle",
  lassoFilter: {
    handwriting: true,
    images: false,
    shapes: true,
    arrows: false,
    textBoxes: true,
    tables: false,
    graphs: false,
  },
  highlighterAlpha: 0.55,
  paperWidth: 1400,
  newNotebookFolder: "School/Notebooks",
  returnToPenOnReselect: true,
  returnToPenAfterUse: true,
  fingerTapUndo: false,
  handwritingOnDevice: false,
  replayInk: false,
  checkHandwrittenWords: true,
  calcNotes: false,
  speechModel: "whisper-tiny",
  speechLanguage: "nl",
  notebookOwnFolder: false,
  showNewNotebookInContextMenu: false,
  showNewNotebookInExplorer: false,
  folderNotebooks: false,
  lastNotebookChoices: { type: "notebook", cover: "plain", paper: "dotted", size: "a4" },
  lastNotebookTemplate: { path: "FineNotes templates/Papers/Planner.pdf", page: 0 },
  recognitionProviderId: "llm-byok",
  twoFileStorage: true,
  desynchronizedCanvas: false,
  debugHud: true,
  scribbleNoticeShown: true,
  lastSeenVersion: "0.8.1",
  checkForUpdates: false,
  updateReminders: false,
  llmVendor: "custom",
  llmModel: "llava:13b",
  llmApiKey: "sk-ant-legacy",
  llmBaseUrl: "http://nas.local:11434/v1",
  llmCustomApiKey: "local-secret",
  apiKeys: { openai: "sk-proj-1", google: "AIza-2" },
  imageVendor: "google",
  imageModel: "gemini-2.5-flash-image",
  imageAspect: "landscape",
  askSaveChats: true,
  askLayout: "sidebar",
  cloudConsentGiven: true,
  customConsentGiven: true,
  autoRecognize: true,
  textStyle: { color: "#aa0000", fontSize: 30, bold: true, font: "serif" },
  textToolPinned: true,
  textDragSize: true,
  textHintShown: 3,
  textHintDismissed: true,
  penAutoShape: true,
  penGestures: { scribbleErase: false, scribbleErasesAll: true, circleLasso: false },
  shapeColor: "#0066ff",
  stickerFolder: "Art/Stickers",
  imagesFolder: "Art/Pictures",
  recordingsFolder: "",
  transcriptsFolder: "",
  chatsFolder: "",
  exportsFolder: "",
  templateFolder: "Shared/Templates",
  templateGalleryUrl: "https://example.org/index.json",
  recentColors: ["#123456", "#abcdef"],
  pressureWidth: true,
  pageAppearance: "system",
  invertPdfPages: false,

  savedPens: [{ type: "brush", color: "#336699", size: 4.5 }],
  toolbarItems: ["pen", "sticky", "select", "ruler"],
  lastPen: { type: "highlighter", color: "#fab005", size: 8 },
  barrelButton: "pan",
  penCursor: "crosshair",
  straightHighlighter: false,
  onlyStylusMode: true,
  settingsOpen: ["writing", "ai"],
  scribbleTipDismissed: true,
  experimentalFutureFlag: 7,
};

/** What `main.ts` does on load, then what `saveData` writes. */
function loadAndSave(saved: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(Object.assign({}, DEFAULT_SETTINGS, saved)));
}

describe("data.json", () => {
  it("enables the notebook context menu for older settings and preserves an opt-out", () => {
    expect(loadAndSave({}).showNewNotebookInContextMenu).toBe(true);
    expect(loadAndSave({}).showNewNotebookInExplorer).toBe(false);
    expect(loadAndSave({ showNewNotebookInExplorer: false }).showNewNotebookInExplorer).toBe(false);
    expect(loadAndSave({ showNewNotebookInExplorer: true }).showNewNotebookInExplorer).toBe(true);
    expect(loadAndSave({ showNewNotebookInContextMenu: false }).showNewNotebookInContextMenu).toBe(
      false,
    );
  });
  it("a fresh install writes exactly these keys and values, in this order", () => {
    expect(Object.keys(DEFAULT_SETTINGS)).toEqual(Object.keys(FRESH_INSTALL));
    expect(JSON.parse(JSON.stringify(DEFAULT_SETTINGS))).toEqual(FRESH_INSTALL);
    expect(loadAndSave(null)).toEqual(FRESH_INSTALL);
  });

  it("a used vault's file survives a load and a save, every key and value", () => {
    const written = loadAndSave(USED_VAULT) as Record<string, unknown>;
    expect(written).toEqual(USED_VAULT);
    for (const key of Object.keys(FRESH_INSTALL)) expect(written).toHaveProperty([key]);
  });

  it("keeps the pre-0.5 plaintext keys readable, for the key-store migration", () => {
    const written = loadAndSave(USED_VAULT) as Record<string, unknown>;
    expect(written.llmApiKey).toBe("sk-ant-legacy");
    expect(written.llmCustomApiKey).toBe("local-secret");
    expect(typeof DEFAULT_SETTINGS.llmApiKey).toBe("string");
    expect(typeof DEFAULT_SETTINGS.llmCustomApiKey).toBe("string");
  });

  it("gives a file from before a key existed that key's default", () => {
    const old = { drawAndHold: false, defaultColor: "#333333", paperWidth: 900 };
    const written = loadAndSave(old) as Record<string, unknown>;
    expect(written).toEqual({ ...FRESH_INSTALL, ...old });
  });

  it("stores the per-tool records as copies, so no host can edit a shared default", async () => {
    const { DEFAULT_LASSO_FILTER } = await import("../../src/canvas/lasso");
    const { DEFAULT_TEXT_STYLE } = await import("../../src/model/text-style");
    const { DEFAULT_PEN_GESTURES } = await import("../../src/ink/pen-gestures");
    expect(DEFAULT_SETTINGS.lassoFilter).not.toBe(DEFAULT_LASSO_FILTER);
    expect(DEFAULT_SETTINGS.textStyle).not.toBe(DEFAULT_TEXT_STYLE);
    expect(DEFAULT_SETTINGS.penGestures).not.toBe(DEFAULT_PEN_GESTURES);
    const { DEFAULT_SAVED_PENS } = await import("../../src/model/saved-pens");
    expect(DEFAULT_SETTINGS.savedPens).not.toBe(DEFAULT_SAVED_PENS);
    expect(DEFAULT_SETTINGS.savedPens[0]).not.toBe(DEFAULT_SAVED_PENS[0]);
  });
});

describe("dark pages", () => {
  it("are off by default, on when chosen, and follow Obsidian's theme when asked", () => {
    expect(DEFAULT_SETTINGS.pageAppearance).toBe("light");
    expect(pagesAreDark("light", true)).toBe(false);
    expect(pagesAreDark("dark", false)).toBe(true);
    expect(pagesAreDark("system", true)).toBe(true);
    expect(pagesAreDark("system", false)).toBe(false);
  });

  it("read anything they do not know as light", () => {
    for (const value of [undefined, null, "Dark", "auto", 1, true]) {
      expect(pagesAreDark(value, true)).toBe(false);
    }
  });

  it("give the paper theme, keeping PDFs only when PDF inversion is off", () => {
    expect(shownPaperTheme(DEFAULT_SETTINGS, true)).toBe(LIGHT_PAPER);
    const dark = { pageAppearance: "dark", invertPdfPages: true } as const;
    expect(shownPaperTheme(dark, false)).toBe(DARK_PAPER);
    const keep = shownPaperTheme({ ...dark, invertPdfPages: false }, false);
    expect(keep.night && keep.keepPdf).toBe(true);
    // The same theme object each time, so a view can tell nothing changed.
    expect(shownPaperTheme({ ...dark, invertPdfPages: false }, false)).toBe(keep);
  });
});

describe("paperWidthFrom", () => {
  it("takes whole pixels inside the range, reading leading digits as parseInt does", () => {
    expect(PAPER_WIDTH_RANGE).toEqual({ min: 320, max: 4096 });
    expect(paperWidthFrom("320")).toBe(320);
    expect(paperWidthFrom("4096")).toBe(4096);
    expect(paperWidthFrom(" 1024")).toBe(1024);
    expect(paperWidthFrom("1400px")).toBe(1400);
    expect(paperWidthFrom("800.9")).toBe(800);
  });

  it("refuses anything else", () => {
    for (const text of ["319", "4097", "-500", "", "wide", "px1024", "1e5"]) {
      expect(paperWidthFrom(text)).toBeNull();
    }
  });
});

describe("endpointWarning", () => {
  it("says nothing about an empty field or an HTTPS server", () => {
    expect(endpointWarning("")).toBeNull();
    expect(endpointWarning("https://box.tailnet.ts.net/v1")).toBeNull();
  });

  it("flags a URL no request can be made from", () => {
    expect(endpointWarning("localhost:11434")).toBe("incomplete");
    expect(endpointWarning("not a url")).toBe("incomplete");
  });

  it("flags plain HTTP, which phones and tablets tend to refuse", () => {
    expect(endpointWarning("http://localhost:11434/v1")).toBe("plain-http");
  });
});

describe("control values", () => {
  it("parses a colour list, keeping only #rgb and #rrggbb", () => {
    expect(parseColorList("#ff8800, #0CA,#12, #1234, #12345678, blue, ,#abcdef")).toEqual([
      "#ff8800",
      "#0CA",
      "#abcdef",
    ]);
    expect(parseColorList("")).toEqual([]);
  });

  it("shows and stores the converted keys in their controls' units", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    storeShownValue(settings, "highlighterAlpha", 55);
    storeShownValue(settings, "defaultSize", "5");
    storeShownValue(settings, "customColors", "#111111, nope, #222");
    storeShownValue(settings, "llmModel", "  gpt-4o \t");
    storeShownValue(settings, "imageModel", "\nimagen ");
    expect(settings).toMatchObject({
      highlighterAlpha: 0.55,
      defaultSize: 5,
      customColors: ["#111111", "#222"],
      llmModel: "gpt-4o",
      imageModel: "imagen",
    });
    expect(shownValue(settings, "highlighterAlpha")).toBe(55);
    expect(shownValue(settings, "defaultSize")).toBe("5");
    expect(shownValue(settings, "customColors")).toBe("#111111, #222");
    expect(shownValue(settings, "llmModel")).toBe("gpt-4o");
  });

  it("passes every other key through untouched, inherited names included", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    storeShownValue(settings, "defaultTool", "eraser");
    expect(shownValue(settings, "defaultTool")).toBe("eraser");
    expect(shownValue(settings, "pressureWidth")).toBe(false);
    expect(shownValue(settings, "toString")).toBe(Object.prototype.toString);
    storeShownValue(settings, "constructor", "x");
    expect(shownValue(settings, "constructor")).toBe("x");
  });

  it("rebuilds the tab only for the keys that add or remove rows", () => {
    // pressureWidth shows or hides its warning.
    for (const key of ["recognitionProviderId", "llmVendor", "imageVendor", "pressureWidth"]) {
      expect(changesTabLayout(key)).toBe(true);
    }
    for (const key of [
      "llmModel",
      "llmBaseUrl",
      "debugHud",
      "paperWidth",
      "defaultTool",
      "onlyStylusMode",
    ]) {
      expect(changesTabLayout(key)).toBe(false);
    }
  });
});

describe("settings sections", () => {
  it("opens none on a fresh install", () => {
    expect(openSectionsOf(undefined)).toEqual([]);
    expect(openSectionsOf(DEFAULT_SETTINGS.settingsOpen)).toEqual([]);
    expect(sectionOpen(undefined, "writing")).toBe(false);
  });

  it("reads a hand-edited value without trusting it", () => {
    expect(openSectionsOf("pens")).toEqual([]);
    expect(openSectionsOf(null)).toEqual([]);
    // Unknown ids go; known ones come back in the tab's order, once each.
    expect(openSectionsOf(["ai", "nope", "pens", "ai", 7, "toString", "shortcuts"])).toEqual([
      "pens",
      "ai",
    ]);
  });

  it("opens and folds one section, leaving the others", () => {
    const open = withSection(["pens"], "advanced", true);
    expect(open).toEqual(["pens", "advanced"]);
    expect(withSection(open, "pens", false)).toEqual(["advanced"]);
    expect(withSection(open, "advanced", true)).toEqual(["pens", "advanced"]);
    expect(withSection(["pens"], "toString" as never, true)).toEqual(["pens"]);
  });

  it("keeps one open at a time on a tablet, the first of several synced from a computer", () => {
    expect(withSection(["pens", "ai"], "pages", true, true)).toEqual(["pages"]);
    expect(withSection(["pages"], "pages", false, true)).toEqual([]);
    expect(sectionOpen(["pens", "ai"], "pens", true)).toBe(true);
    expect(sectionOpen(["pens", "ai"], "ai", true)).toBe(false);
    expect(sectionOpen(["pens", "ai"], "ai")).toBe(true);
  });
});

describe("choices that set two switches", () => {
  it("reads and writes Back to the pen as both return switches", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    expect(returnToPenOf(settings)).toBe("never");
    for (const [choice, reselect, afterUse] of [
      ["reselect", true, false],
      ["after-use", false, true],
      ["both", true, true],
      ["never", false, false],
    ] as const) {
      storeReturnToPen(settings, choice);
      expect([settings.returnToPenOnReselect, settings.returnToPenAfterUse]).toEqual([
        reselect,
        afterUse,
      ]);
      expect(returnToPenOf(settings)).toBe(choice);
    }
    storeReturnToPen(settings, "nonsense");
    expect(returnToPenOf(settings)).toBe("never");
  });

  it("reads and writes Page appearance with the PDF choice folded in", () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    expect(appearanceChoiceOf(settings)).toBe("light");
    for (const [choice, appearance, invert] of [
      ["dark", "dark", true],
      ["dark-pdf-light", "dark", false],
      ["system", "system", true],
      ["system-pdf-light", "system", false],
    ] as const) {
      storeAppearanceChoice(settings, choice);
      expect([settings.pageAppearance, settings.invertPdfPages]).toEqual([appearance, invert]);
      expect(appearanceChoiceOf(settings)).toBe(choice);
    }
    // Light leaves the PDF switch for the next dark choice; light shows as light either way.
    storeAppearanceChoice(settings, "light");
    expect([settings.pageAppearance, settings.invertPdfPages]).toEqual(["light", false]);
    expect(appearanceChoiceOf(settings)).toBe("light");
    expect(appearanceChoiceOf({ pageAppearance: "sepia" as never, invertPdfPages: false })).toBe(
      "light",
    );
  });
});
