/**
 * The notebook view's file handling, without its DOM: what it saves after a
 * load, and the protection that stops a bad read from being saved over a
 * good file. A note read back empty while its file is not (an iCloud
 * placeholder, a sync caught half-way), or whose ink block will not decode,
 * must be written back byte for byte, and the note must refuse edits until
 * a clean load. This only happens for real on the iPad, so it is pinned here.
 *
 * Also: automatic transcription's idle timer, and "Clear page" dropping only
 * that page's transcription. Written against the view as it stood at 0.9.0,
 * before it was rewritten.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmVendor } from "../../src/recognition/llm-request";
import { TFile, WorkspaceLeaf, notices, resetFakes } from "./fake-obsidian";

vi.mock("obsidian", () => import("./fake-obsidian"));

const { InkView } = await import("../../src/view/ink-view");
const { DEFAULT_SETTINGS } = await import("../../src/settings");
const { buildInkFile, parseInkFile } = await import("../../src/model/serialize");
const { blankPage, emptyDocument } = await import("../../src/model/document");
const { readTextSection, writeTextSection } = await import("../../src/recognition/text-layer");
const { pageKeys, updatePageTranscripts } = await import("../../src/recognition/page-transcripts");
const { encodeDocument } = await import("../../src/model/serialize");
const { VENDORS } = await import("../../src/recognition/llm-request");

type View = InstanceType<typeof InkView>;

/** The members a test reaches that TypeScript keeps private. */
interface Inside {
  saveRequests: number;
  doc: { recognizedHash?: string; pages: { id: string }[] };
  surface: unknown;
  scheduleAutoTranscription(): void;
  clearPage(): void;
  isProtected(): boolean;
}

function fakePlugin(settings: Record<string, unknown> = {}) {
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  return {
    settings: merged,
    manifest: { id: "goodobsidian", name: "GoodObsidian", version: "0.9.0" },
    // The real rule, from GoodObsidianPlugin.consentedTo.
    consentedTo: (vendor: LlmVendor) =>
      VENDORS[vendor].userEndpoint ? merged.customConsentGiven : merged.cloudConsentGiven,
    runRecognition: vi.fn(() => Promise.resolve()),
    activeProvider: () => ({ id: "llm-byok", requiresNetwork: true }),
    maybeShowScribbleNotice: () => Promise.resolve(),
  };
}

let plugin: ReturnType<typeof fakePlugin>;

function openView(bytesOnDisk: number | null = 100, settings: Record<string, unknown> = {}): View {
  plugin = fakePlugin(settings);
  const view = new InkView(new WorkspaceLeaf({}) as never, plugin as never);
  if (bytesOnDisk !== null) {
    (view as unknown as { file: TFile }).file = new TFile("Physics.notebook.md", bytesOnDisk);
  }
  return view;
}

function inside(view: View): Inside {
  return view as unknown as Inside;
}

function notebookFile(body = "# Physics\n\nMy prose.\n"): string {
  const doc = emptyDocument(1024);
  doc.pages[0].strokes.push({
    id: "s1",
    tool: "pen",
    color: "#1a1a1a",
    size: 3,
    pts: [10, 20, 0.5, 30, 40, 0.5],
  } as never);
  return buildInkFile(body, doc);
}

beforeEach(() => {
  resetFakes();
  vi.stubGlobal("window", globalThis);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a clean load", () => {
  it("saves the note rebuilt from what it read", () => {
    const view = openView();
    const text = notebookFile();
    view.setViewData(text, true);
    const parsed = parseInkFile(text, 1024);
    expect(view.getViewData()).toBe(buildInkFile(parsed.body, parsed.doc!));
    expect(notices).toEqual([]);
    expect(inside(view).isProtected()).toBe(false);
  });

  it("gives a note without an ink block a fresh notebook", () => {
    const view = openView();
    view.setViewData("---\ngoodobsidian: true\n---\nJust prose.\n", true);
    expect(view.getViewData()).toBe(
      buildInkFile("---\ngoodobsidian: true\n---\nJust prose.\n", emptyDocument(1024)),
    );
    expect(notices).toEqual([]);
  });

  it("uses the paper width setting for that fresh notebook", () => {
    const view = openView(100, { paperWidth: 800 });
    view.setViewData("Just prose.\n", true);
    expect(view.getViewData()).toBe(buildInkFile("Just prose.\n", emptyDocument(800)));
  });

  it("treats an empty read of an empty file as an empty note", () => {
    const view = openView(0);
    view.setViewData("", true);
    expect(view.getViewData()).toBe(buildInkFile("", emptyDocument(1024)));
    expect(notices).toEqual([]);
  });

  it("treats an empty read as empty when there is no file to compare", () => {
    const view = openView(null);
    view.setViewData("", true);
    expect(view.getViewData()).toBe(buildInkFile("", emptyDocument(1024)));
  });
});

describe("a load that cannot be trusted", () => {
  const good = notebookFile();
  const block = good.slice(good.indexOf("%%goodobsidian"));
  const suspect: [string, string, number][] = [
    ["an empty read of a file with bytes on disk", "", 100],
    ["a whitespace-only read of a file with bytes on disk", " \n\t\n", 100],
    ["a byte-order mark alone", "﻿", 100],
    ["an ink block that does not decode", "Prose.\n\n%%goodobsidian\nv2:@@@@\n%%\n", 100],
    ["a legacy ink block that does not decode", "Prose.\n\n%%inkedmark\nv2:@@@@\n%%\n", 100],
    ["an ink block cut off by a partial sync", good.slice(0, good.length - 12), 100],
    ["a block from a newer format", "%%goodobsidian\nv9:AAAA\n%%\n", 100],
    [
      "an unreadable block even when the file size is unknown",
      `${block}x`.replace("v2:", "v2:!"),
      0,
    ],
  ];

  it.each(suspect)("%s is saved back exactly as read", (_what, text, size) => {
    const view = openView(size);
    view.setViewData(text, true);
    expect(view.getViewData()).toBe(text);
    expect(inside(view).isProtected()).toBe(true);
    expect(notices.length).toBeGreaterThanOrEqual(1);
  });

  it("says so once on load", () => {
    const view = openView();
    view.setViewData("", true);
    expect(notices).toHaveLength(1);
    expect(notices[0].timeout).toBe(10000);
  });

  it("refuses to transcribe, quietly when in the background", async () => {
    const view = openView();
    view.setViewData("", true);
    const provider = { id: "llm-byok", requiresNetwork: true, recognize: vi.fn() };
    const before = notices.length;
    await view.transcribe(provider as never, "notebook", true);
    expect(notices).toHaveLength(before);
    await view.transcribe(provider as never, "notebook");
    expect(notices).toHaveLength(before + 1);
    expect(provider.recognize).not.toHaveBeenCalled();
  });

  it("refuses pictures", async () => {
    const view = openView();
    view.setViewData("", true);
    expect(await view.insertImageBytes(new ArrayBuffer(4), "image/png", "x.png")).toBeNull();
  });

  it("lifts once the file loads cleanly", () => {
    const view = openView();
    view.setViewData("", true);
    const text = notebookFile();
    view.setViewData(text, true);
    const parsed = parseInkFile(text, 1024);
    expect(view.getViewData()).toBe(buildInkFile(parsed.body, parsed.doc!));
    expect(inside(view).isProtected()).toBe(false);
  });

  it("holds through clear(), until the next load", () => {
    const view = openView();
    view.setViewData("", true);
    view.clear();
    expect(view.getViewData()).toBe("");
    view.setViewData("Prose.\n", true);
    expect(view.getViewData()).toBe(buildInkFile("Prose.\n", emptyDocument(1024)));
  });

  it("does not mistake a marker-free note for a broken one", () => {
    const view = openView();
    view.setViewData("I wrote %%GoodObsidian%% in my prose.\n", true);
    expect(inside(view).isProtected()).toBe(false);
    expect(notices).toEqual([]);
  });

  it("reads a good block even with the marker named again in the prose", () => {
    const view = openView();
    const text = notebookFile("About the %%goodobsidian block.\n");
    view.setViewData(text, true);
    expect(inside(view).isProtected()).toBe(false);
  });
});

describe("clear()", () => {
  it("forgets the note, so an unloaded view saves an empty notebook", () => {
    const view = openView();
    view.setViewData(notebookFile(), true);
    view.clear();
    expect(view.getViewData()).toBe(buildInkFile("", emptyDocument(1024)));
  });
});

describe("automatic transcription", () => {
  function armed(settings: Record<string, unknown>): View {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    const view = openView(100, settings);
    view.setViewData(notebookFile(), true);
    return view;
  }

  it("runs once the ink has been idle for 30 s", () => {
    const view = armed({ autoRecognize: true, cloudConsentGiven: true });
    inside(view).scheduleAutoTranscription();
    vi.advanceTimersByTime(29_999);
    expect(plugin.runRecognition).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(plugin.runRecognition).toHaveBeenCalledWith(view, true);
  });

  it("starts the wait again on every change", () => {
    const view = armed({ autoRecognize: true, cloudConsentGiven: true });
    inside(view).scheduleAutoTranscription();
    vi.advanceTimersByTime(20_000);
    inside(view).scheduleAutoTranscription();
    vi.advanceTimersByTime(20_000);
    expect(plugin.runRecognition).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(plugin.runRecognition).toHaveBeenCalledTimes(1);
  });

  it("runs for the user's own endpoint once that is agreed to", () => {
    const view = armed({ autoRecognize: true, llmVendor: "custom", customConsentGiven: true });
    inside(view).scheduleAutoTranscription();
    vi.advanceTimersByTime(30_000);
    expect(plugin.runRecognition).toHaveBeenCalledWith(view, true);
  });

  it.each([
    [{ autoRecognize: false, cloudConsentGiven: true }],
    [{ autoRecognize: true, cloudConsentGiven: false }],
    [{ autoRecognize: true, cloudConsentGiven: false, customConsentGiven: true }],
    [{ autoRecognize: true, llmVendor: "custom", cloudConsentGiven: true }],
  ])("does not run with %j", (settings) => {
    const view = armed(settings);
    inside(view).scheduleAutoTranscription();
    vi.advanceTimersByTime(60_000);
    expect(plugin.runRecognition).not.toHaveBeenCalled();
  });

  it("does not run for a provider that stays on the device", () => {
    const view = armed({ autoRecognize: true, cloudConsentGiven: true });
    plugin.activeProvider = () => ({ id: "manual", requiresNetwork: false });
    inside(view).scheduleAutoTranscription();
    vi.advanceTimersByTime(60_000);
    expect(plugin.runRecognition).not.toHaveBeenCalled();
  });

  it("a change with the setting off cancels a pending run", () => {
    const view = armed({ autoRecognize: true, cloudConsentGiven: true });
    inside(view).scheduleAutoTranscription();
    plugin.settings.autoRecognize = false;
    inside(view).scheduleAutoTranscription();
    vi.advanceTimersByTime(60_000);
    expect(plugin.runRecognition).not.toHaveBeenCalled();
  });
});

describe("clearing a page", () => {
  function twoPageNote(): string {
    const doc = emptyDocument(1024);
    doc.pages.push(blankPage("p2"));
    doc.recognizedHash = "old";
    const keys = pageKeys(doc.pages);
    const section = updatePageTranscripts(null, keys, [
      { key: keys[0], text: "first page words", hash: "h1" },
      { key: keys[1], text: "second page words", hash: "h2" },
    ]);
    const body = writeTextSection("# Title\n\nMy own prose.\n", section);
    return `${body}\n\n%%goodobsidian\n${encodeDocument(doc)}\n%%\n`;
  }

  it("drops only that page's transcription, and the old whole-note hash", () => {
    const view = openView();
    view.setViewData(twoPageNote(), true);
    const surfaceClear = vi.fn(() => true);
    inside(view).surface = { clearStrokes: surfaceClear, currentPage: 0 };
    const saves = inside(view).saveRequests;
    inside(view).clearPage();
    expect(surfaceClear).toHaveBeenCalledTimes(1);
    const saved = parseInkFile(view.getViewData(), 1024);
    const section = readTextSection(saved.body) ?? "";
    expect(section).not.toContain("first page words");
    expect(section).toContain("second page words");
    expect(saved.body).toContain("My own prose.");
    expect(saved.doc?.recognizedHash).toBeUndefined();
    expect(inside(view).saveRequests).toBeGreaterThan(saves);
  });

  it("does nothing when the page had nothing to clear", () => {
    const view = openView();
    const text = twoPageNote();
    view.setViewData(text, true);
    inside(view).surface = { clearStrokes: () => false, currentPage: 0 };
    const saves = inside(view).saveRequests;
    inside(view).clearPage();
    expect(inside(view).saveRequests).toBe(saves);
    expect(parseInkFile(view.getViewData(), 1024).doc?.recognizedHash).toBe("old");
  });

  it("leaves a note without a transcription section without one", () => {
    const view = openView();
    view.setViewData(notebookFile("Prose only.\n"), true);
    inside(view).surface = { clearStrokes: () => true, currentPage: 0 };
    inside(view).clearPage();
    const saved = parseInkFile(view.getViewData(), 1024);
    expect(readTextSection(saved.body)).toBeNull();
    expect(saved.body.trim()).toBe("Prose only.");
  });
});
