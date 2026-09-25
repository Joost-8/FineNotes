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
  endpointWarning,
  paperWidthFrom,
  parseColorList,
  shownValue,
  storeShownValue,
} from "../../src/settings-data";

/**
 * What a fresh install writes, key for key and in this order. `twoFileStorage`
 * (false) followed `recognitionProviderId` until 2026-09: nothing read it, so
 * it went; vaults that have it keep it, as they keep any key (below).
 */
const FRESH_INSTALL = {
  pressureEnabled: true,
  drawAndHold: true,
  defaultTool: "pen",
  customColors: [],
  defaultColor: "#1a1a1a",
  defaultSize: 3,
  eraserMode: "standard",
  eraserSize: 24,
  eraserFilter: "all",
  lassoMode: "freehand",
  lassoFilter: { handwriting: true, images: true, shapes: true, arrows: true, textBoxes: true },
  highlighterAlpha: 0.4,
  paperWidth: 1024,
  newNotebookFolder: "",
  lastNotebookChoices: null,
  recognitionProviderId: "manual",
  desynchronizedCanvas: true,
  debugHud: false,
  scribbleNoticeShown: false,
  lastSeenVersion: "",
  llmVendor: "anthropic",
  llmModel: "",
  llmApiKey: "",
  llmBaseUrl: "",
  llmCustomApiKey: "",
  apiKeys: {},
  imageVendor: "same",
  imageModel: "",
  imageAspect: "square",
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
  recentColors: [],
};

/**
 * A long-used vault's file: every key away from its default, the pre-0.5
 * plaintext keys still there, and keys this build no longer knows.
 */
const USED_VAULT = {
  pressureEnabled: false,
  drawAndHold: false,
  defaultTool: "highlighter",
  customColors: ["#ff8800", "#0ca"],
  defaultColor: "#2255aa",
  defaultSize: 5,
  eraserMode: "stroke",
  eraserSize: 40,
  eraserFilter: "highlighter",
  lassoMode: "rectangle",
  lassoFilter: { handwriting: true, images: false, shapes: true, arrows: false, textBoxes: true },
  highlighterAlpha: 0.55,
  paperWidth: 1400,
  newNotebookFolder: "School/Notebooks",
  lastNotebookChoices: { type: "notebook", cover: "plain", paper: "dotted", size: "a4" },
  recognitionProviderId: "llm-byok",
  twoFileStorage: true,
  desynchronizedCanvas: false,
  debugHud: true,
  scribbleNoticeShown: true,
  lastSeenVersion: "0.8.1",
  llmVendor: "custom",
  llmModel: "llava:13b",
  llmApiKey: "sk-ant-legacy",
  llmBaseUrl: "http://nas.local:11434/v1",
  llmCustomApiKey: "local-secret",
  apiKeys: { openai: "sk-proj-1", google: "AIza-2" },
  imageVendor: "google",
  imageModel: "gemini-2.5-flash-image",
  imageAspect: "landscape",
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
  recentColors: ["#123456", "#abcdef"],
  experimentalFutureFlag: 7,
};

/** What `main.ts` does on load, then what `saveData` writes. */
function loadAndSave(saved: unknown): unknown {
  return JSON.parse(JSON.stringify(Object.assign({}, DEFAULT_SETTINGS, saved)));
}

describe("data.json", () => {
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
    const old = { pressureEnabled: false, defaultColor: "#333333", paperWidth: 900 };
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
    expect(shownValue(settings, "pressureEnabled")).toBe(true);
    expect(shownValue(settings, "toString")).toBe(Object.prototype.toString);
    storeShownValue(settings, "constructor", "x");
    expect(shownValue(settings, "constructor")).toBe("x");
  });

  it("rebuilds the tab only for the keys that add or remove rows", () => {
    for (const key of ["recognitionProviderId", "llmVendor", "imageVendor"]) {
      expect(changesTabLayout(key)).toBe(true);
    }
    for (const key of ["llmModel", "llmBaseUrl", "debugHud", "paperWidth", "defaultTool"]) {
      expect(changesTabLayout(key)).toBe(false);
    }
  });
});
