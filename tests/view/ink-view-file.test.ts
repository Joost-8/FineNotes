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
import { TFile, TFolder, WorkspaceLeaf, notices, resetFakes } from "./fake-obsidian";
import { AUTO_RECOGNIZE_IDLE_MS, AUTO_RECOGNIZE_LEAVE_MS } from "../../src/constants";

vi.mock("obsidian", () => import("./fake-obsidian"));

/** The typing dialog, as the view last opened it: its page, its text, and Save. */
let typing: { page: number; text: string; submit: (text: string) => void } | null = null;
vi.mock("../../src/view/transcript-modal", () => ({
  TranscriptModal: class {
    constructor(_app: unknown, page: number, text: string, submit: (text: string) => void) {
      typing = { page, text, submit };
    }
    open(): void {}
  },
}));

const { InkView } = await import("../../src/view/ink-view");
const { DEFAULT_SETTINGS } = await import("../../src/settings");
const { buildInkFile, parseInkFile } = await import("../../src/model/serialize");
const { blankPage, emptyDocument } = await import("../../src/model/document");
const { readTextSection, writeTextSection } = await import("../../src/recognition/text-layer");
const transcripts = await import("../../src/recognition/page-transcripts");
const { pageKeys, updatePageTranscripts } = transcripts;
const { encodeDocument } = await import("../../src/model/serialize");
const { VENDORS } = await import("../../src/recognition/llm-request");
const { StartupLog } = await import("../../src/view/startup-log");
const dotIds = await import("../../src/model/dot-ids");
const { MAX_SAVE_HOLD_MS, QUIET_MS, SAVE_QUIET_MS } = await import("../../src/view/write-hold");

type View = InstanceType<typeof InkView>;

/** The members a test reaches that TypeScript keeps private. */
interface Inside {
  saveRequests: number;
  doc: { recognizedHash?: string; pages: { id: string; strokes: unknown[] }[] };
  surface: unknown;
  scheduleAutoTranscription(changed?: readonly string[]): void;
  transcription: unknown;
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
    autoTranscriptionWait: vi.fn(() => 0),
    autoTranscriptionFailed: vi.fn(() => true),
    transcriptionWorked: vi.fn(),
    // As the plugin keeps them: pages left waiting, by notebook path.
    waiting: new Map<string, string[]>(),
    keepWaitingPages(path: string, ids: readonly string[]) {
      if (ids.length > 0) this.waiting.set(path, [...ids]);
      else this.waiting.delete(path);
    },
    takeWaitingPages(path: string): string[] {
      const ids = this.waiting.get(path) ?? [];
      this.waiting.delete(path);
      return ids;
    },
    activeProvider: () => ({ id: "llm-byok", requiresNetwork: true }),
    maybeShowScribbleNotice: () => Promise.resolve(),
    // Files moved while the note was closed (#14): `moves` is what the log knows.
    moves: {} as Record<string, string>,
    fileMoves: {
      log: () => Object.entries(plugin.moves).map(([from, to]) => ({ from, to })),
      relink: (path: string) => plugin.moves[path],
    },
    startup: new StartupLog(() => 0),
  };
}

let plugin: ReturnType<typeof fakePlugin>;

function openView(bytesOnDisk: number | null = 100, settings: Record<string, unknown> = {}): View {
  plugin = fakePlugin(settings);
  // An empty vault: a path the note holds is found nowhere, nearby or not.
  const app = { vault: { getAbstractFileByPath: () => null } };
  const view = new InkView(new WorkspaceLeaf(app) as never, plugin as never);
  if (bytesOnDisk !== null) {
    (view as unknown as { file: TFile }).file = new TFile("Physics.notebook.md", bytesOnDisk);
  }
  return view;
}

/**
 * Two notes that read back the same: the same body and notebook. A view
 * compresses a fresh notebook at its quicker save level, so only what it
 * decodes to is pinned; a note saved unchanged is pinned byte for byte by
 * "saves the note rebuilt from what it read".
 */
function expectSameNote(actual: string, expected: string): void {
  const a = parseInkFile(actual, 1024);
  const b = parseInkFile(expected, 1024);
  expect(a.body).toBe(b.body);
  expect(a.doc).toEqual(b.doc);
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
    expectSameNote(
      view.getViewData(),
      buildInkFile("---\ngoodobsidian: true\n---\nJust prose.\n", emptyDocument(1024)),
    );
    expect(notices).toEqual([]);
  });

  it("uses the paper width setting for that fresh notebook", () => {
    const view = openView(100, { paperWidth: 800 });
    view.setViewData("Just prose.\n", true);
    expectSameNote(view.getViewData(), buildInkFile("Just prose.\n", emptyDocument(800)));
  });

  it("treats an empty read of an empty file as an empty note", () => {
    const view = openView(0);
    view.setViewData("", true);
    expectSameNote(view.getViewData(), buildInkFile("", emptyDocument(1024)));
    expect(notices).toEqual([]);
  });

  it("treats an empty read as empty when there is no file to compare", () => {
    const view = openView(null);
    view.setViewData("", true);
    expectSameNote(view.getViewData(), buildInkFile("", emptyDocument(1024)));
  });
});

describe("files that moved while the note was closed (#14)", () => {
  function noteWithPdf(path: string): string {
    const doc = emptyDocument(1024);
    const page = blankPage("p2");
    page.backdrop = { kind: "pdf", path, page: 0 };
    doc.pages.push(page);
    return buildInkFile("# Physics", doc);
  }
  const pdfOf = (text: string) => parseInkFile(text, 1024).doc?.pages[1].backdrop;

  it("are relinked on load, and the note is saved", () => {
    const view = openView();
    plugin.moves["Lecture.pdf"] = "Courses/Lecture.pdf";
    const saves = inside(view).saveRequests;
    view.setViewData(noteWithPdf("Lecture.pdf"), true);
    expect(pdfOf(view.getViewData())).toEqual({
      kind: "pdf",
      path: "Courses/Lecture.pdf",
      page: 0,
    });
    expect(inside(view).saveRequests).toBeGreaterThan(saves);
  });

  it("leave a note alone when nothing it points at moved", () => {
    const view = openView();
    plugin.moves["Other.pdf"] = "Courses/Other.pdf";
    const saves = inside(view).saveRequests;
    const text = noteWithPdf("Lecture.pdf");
    view.setViewData(text, true);
    expect(view.getViewData()).toBe(text);
    expect(inside(view).saveRequests).toBe(saves);
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

  // FineNotes#246: a held read is not always what is on disk (Obsidian may
  // have merged a synced file into the view's text), so echoing it is not
  // safe: nothing may reach Obsidian's save while a load is held.
  it("never saves while held, closing included", async () => {
    const proto = Object.getPrototypeOf(InkView.prototype) as { save: () => Promise<void> };
    const save = vi.spyOn(proto, "save").mockImplementation(() => Promise.resolve());
    try {
      const view = openView();
      view.setViewData("Prose.\n\n%%goodobsidian\nv2:@@@@\n%%\n", true);
      await view.save();
      await view.save(true);
      expect(save).not.toHaveBeenCalled();
    } finally {
      save.mockRestore();
    }
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
    expectSameNote(view.getViewData(), buildInkFile("Prose.\n", emptyDocument(1024)));
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

describe("a change on disk (FineNotes#246)", () => {
  // Obsidian patches a file changed on disk into a plain-text view's unsaved
  // text (diff-match-patch). Two ink blocks merged that way are one that decodes
  // to nothing, and the guard then held (and echoed) the mix.
  it("is never merged into the view's text: the notebook is not plain text", () => {
    const view = openView();
    expect((view as unknown as { isPlaintext: boolean }).isPlaintext).toBe(false);
  });
});

describe("the file read again while open (FineNotes#273)", () => {
  // Obsidian hands a non-plain-text view the file as it is on disk, which
  // replaced every stroke written since the last save, and the undo history.
  interface Reloads {
    diskReloads: { own: number; empty: number; merged: number; carried: number; replaced: number };
  }

  /** Write a stroke on the first page, as a pen lift does: changed, save asked for. */
  function write(view: View, id: string): void {
    inside(view).doc.pages[0].strokes.push({
      id,
      tool: "pen",
      color: "#1a1a1a",
      size: 3,
      pts: [50, 60, 0.5, 70, 80, 0.5],
    } as never);
    view.requestSave();
  }

  function strokeIds(text: string): string[][] {
    return parseInkFile(text, 1024).doc!.pages.map((page) => page.strokes.map((s) => s.id));
  }

  it("keeps unsaved ink when the read is a text the view already had", () => {
    const view = openView();
    const text = notebookFile();
    view.setViewData(text, true);
    write(view, "s2");
    view.setViewData(text, false);
    expect(strokeIds(view.getViewData())).toEqual([["s1", "s2"]]);
    expect((view as unknown as Reloads).diskReloads.own).toBe(1);
  });

  it("carries unsaved ink onto a change made elsewhere", () => {
    const view = openView();
    const text = notebookFile();
    view.setViewData(text, true);
    write(view, "s2");
    const theirs = parseInkFile(text, 1024);
    theirs.doc!.pages[0].strokes.push({ ...theirs.doc!.pages[0].strokes[0], id: "r1" });
    theirs.doc!.pages.push(blankPage("p2"));
    const saves = inside(view).saveRequests;
    view.setViewData(buildInkFile(theirs.body, theirs.doc!), false);
    expect(strokeIds(view.getViewData())).toEqual([["s1", "s2", "r1"], []]);
    expect(inside(view).saveRequests).toBeGreaterThan(saves);
    expect((view as unknown as Reloads).diskReloads).toMatchObject({ merged: 1, carried: 1 });
  });

  it("takes a change made elsewhere as it is when nothing is unsaved", () => {
    const view = openView();
    const text = notebookFile();
    view.setViewData(text, true);
    const theirs = parseInkFile(text, 1024);
    theirs.doc!.pages[0].strokes.push({ ...theirs.doc!.pages[0].strokes[0], id: "r1" });
    const changed = buildInkFile(theirs.body, theirs.doc!);
    view.setViewData(changed, false);
    expect(strokeIds(view.getViewData())).toEqual([["s1", "r1"]]);
    expect((view as unknown as Reloads).diskReloads.replaced).toBe(1);
  });

  it("keeps saved ink that an older copy from elsewhere lacks, and saves it again", () => {
    const view = openView();
    const text = notebookFile();
    view.setViewData(text, true);
    const older = parseInkFile(text, 1024);
    older.doc!.pages[0].strokes = [];
    const saves = inside(view).saveRequests;
    view.setViewData(buildInkFile(older.body, older.doc!), false);
    expect(strokeIds(view.getViewData())).toEqual([["s1"]]);
    expect(inside(view).saveRequests).toBeGreaterThan(saves);
    expect((view as unknown as Reloads).diskReloads.merged).toBe(1);
  });

  it("keeps the notebook through an empty read while the file is being written", () => {
    // A copy over the file empties it, then fills it: seen in the real-Obsidian
    // rig, where the empty read blanked the notebook and the next merge had no base.
    const view = openView();
    const text = notebookFile();
    view.setViewData(text, true);
    const saves = inside(view).saveRequests;
    view.setViewData("", false);
    expect(strokeIds(view.getViewData())).toEqual([["s1"]]);
    expect(inside(view).saveRequests).toBe(saves);
    // Then the filled file: an older copy from elsewhere, which lacks s1.
    const older = parseInkFile(text, 1024);
    older.doc!.pages[0].strokes = [];
    view.setViewData(buildInkFile(`${older.body}\nOther device.`, older.doc!), false);
    expect(strokeIds(view.getViewData())).toEqual([["s1"]]);
    expect((view as unknown as Reloads).diskReloads).toMatchObject({ empty: 1, merged: 1 });
  });

  it("opens another file as it is", () => {
    const view = openView();
    view.setViewData(notebookFile(), true);
    write(view, "s2");
    (view as unknown as { file: TFile }).file = new TFile("Other.notebook.md", 100);
    view.setViewData(notebookFile(), true);
    expect(strokeIds(view.getViewData())).toEqual([["s1"]]);
  });
});

describe("clear()", () => {
  it("forgets the note, so an unloaded view saves an empty notebook", () => {
    const view = openView();
    view.setViewData(notebookFile(), true);
    view.clear();
    expectSameNote(view.getViewData(), buildInkFile("", emptyDocument(1024)));
  });
});

describe("automatic transcription", () => {
  const IDLE = AUTO_RECOGNIZE_IDLE_MS;
  function armed(settings: Record<string, unknown>): View {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    const view = openView(100, settings);
    view.setViewData(notebookFile(), true);
    return view;
  }

  it("runs once the ink has been idle for 5 minutes", () => {
    const view = armed({ autoRecognize: true, cloudConsentGiven: true });
    inside(view).scheduleAutoTranscription([]);
    vi.advanceTimersByTime(IDLE - 1);
    expect(plugin.runRecognition).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(plugin.runRecognition).toHaveBeenCalledWith(view, true);
  });

  it("starts the wait again on every change", () => {
    const view = armed({ autoRecognize: true, cloudConsentGiven: true });
    inside(view).scheduleAutoTranscription([]);
    vi.advanceTimersByTime(IDLE - 10_000);
    inside(view).scheduleAutoTranscription([]);
    vi.advanceTimersByTime(IDLE - 10_000);
    expect(plugin.runRecognition).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(plugin.runRecognition).toHaveBeenCalledTimes(1);
  });

  it("runs for the user's own endpoint once that is agreed to", () => {
    const view = armed({ autoRecognize: true, llmVendor: "custom", customConsentGiven: true });
    inside(view).scheduleAutoTranscription([]);
    vi.advanceTimersByTime(IDLE);
    expect(plugin.runRecognition).toHaveBeenCalledWith(view, true);
  });

  it.each([
    [{ autoRecognize: false, cloudConsentGiven: true }],
    [{ autoRecognize: true, cloudConsentGiven: false }],
    [{ autoRecognize: true, cloudConsentGiven: false, customConsentGiven: true }],
    [{ autoRecognize: true, llmVendor: "custom", cloudConsentGiven: true }],
  ])("does not run with %j", (settings) => {
    const view = armed(settings);
    inside(view).scheduleAutoTranscription([]);
    vi.advanceTimersByTime(2 * IDLE);
    expect(plugin.runRecognition).not.toHaveBeenCalled();
  });

  it("does not run for a provider that stays on the device", () => {
    const view = armed({ autoRecognize: true, cloudConsentGiven: true });
    plugin.activeProvider = () => ({ id: "manual", requiresNetwork: false });
    inside(view).scheduleAutoTranscription([]);
    vi.advanceTimersByTime(2 * IDLE);
    expect(plugin.runRecognition).not.toHaveBeenCalled();
  });

  it("a change with the setting off cancels a pending run", () => {
    const view = armed({ autoRecognize: true, cloudConsentGiven: true });
    inside(view).scheduleAutoTranscription([]);
    plugin.settings.autoRecognize = false;
    inside(view).scheduleAutoTranscription([]);
    vi.advanceTimersByTime(2 * IDLE);
    expect(plugin.runRecognition).not.toHaveBeenCalled();
  });
  /** What the sidebar's Files tab lists under Transcripts. */
  const sidebarViews = (view: View) => {
    const { pageTranscriptViews } = transcripts;
    return pageTranscriptViews(
      readTextSection((view as unknown as { noteBody: string }).noteBody),
      pageKeys(inside(view).doc.pages),
    );
  };

  describe("which pages it reads (FineNotes#265 review)", () => {
    /** A notebook of three inked pages, the view on the first. */
    function threePages(): View {
      vi.useFakeTimers();
      vi.stubGlobal("window", globalThis);
      const view = openView(100, { autoRecognize: true, cloudConsentGiven: true });
      const doc = emptyDocument(1024);
      doc.pages.push(blankPage("p2"), blankPage("p3"));
      doc.pages.forEach((page, i) =>
        page.strokes.push({
          id: `s${i}`,
          tool: "pen",
          color: "#000",
          size: 3,
          pts: [10, 20, 0.5, 30, 40, 0.5],
        } as never),
      );
      view.setViewData(`# T\n\n%%goodobsidian\n${encodeDocument(doc)}\n%%\n`, true);
      inside(view).surface = { currentPage: 0 };
      // As if on screen: a closed note stops a run after its first page.
      (view as unknown as { mounted: boolean }).mounted = true;
      return view;
    }
    const reader = () => ({
      id: "llm-byok",
      requiresNetwork: true,
      recognize: vi.fn((req: { strokes: { id: string }[] }) =>
        Promise.resolve({ text: `read ${req.strokes.map((s) => s.id).join()}` }),
      ),
    });

    it("reads the page written on, not the page in view", async () => {
      const view = threePages();
      const ids = inside(view).doc.pages.map((p) => p.id);
      inside(view).scheduleAutoTranscription([ids[2]]);
      const provider = reader();
      await view.recognize(provider as never, true);
      expect(provider.recognize).toHaveBeenCalledTimes(1);
      expect(provider.recognize.mock.calls[0][0].strokes[0].id).toBe("s2");
      // Written under the third page's heading.
      expect(view.getViewData()).toMatch(
        /### Page 3\n<!--goodobsidian-page [^>]*-->\n<!--goodobsidian-meta [^>]*-->\nread s2/,
      );
      // Taken: the next quiet moment has nothing left to read.
      await view.recognize(provider as never, true);
      expect(provider.recognize).toHaveBeenCalledTimes(1);
    });

    it("keeps the pages waiting while another run is going, and runs again after", async () => {
      const view = threePages();
      const ids = inside(view).doc.pages.map((p) => p.id);
      inside(view).scheduleAutoTranscription([ids[1]]);
      vi.advanceTimersByTime(IDLE);
      expect(plugin.runRecognition).toHaveBeenCalledTimes(1);
      inside(view).transcription = { cancelled: false };
      const provider = reader();
      await view.recognize(provider as never, true);
      expect(provider.recognize).not.toHaveBeenCalled();
      vi.advanceTimersByTime(IDLE);
      expect(plugin.runRecognition).toHaveBeenCalledTimes(2);
      inside(view).transcription = null;
      await view.recognize(provider as never, true);
      expect(provider.recognize).toHaveBeenCalledTimes(1);
      expect(provider.recognize.mock.calls[0][0].strokes[0].id).toBe("s1");
    });

    it("says a failure once, then waits before trying the page again", async () => {
      const view = threePages();
      const ids = inside(view).doc.pages.map((p) => p.id);
      inside(view).scheduleAutoTranscription([ids[1]]);
      const provider = {
        id: "llm-byok",
        requiresNetwork: true,
        recognize: vi.fn(() => Promise.reject(new Error("HTTP 429"))),
      };
      const before = notices.length;
      // As the plugin does: a failure starts the wait.
      plugin.autoTranscriptionFailed.mockImplementation(() => {
        plugin.autoTranscriptionWait.mockReturnValue(10 * 60_000);
        return true;
      });
      await view.recognize(provider as never, true);
      plugin.autoTranscriptionWait.mockReturnValue(0);
      expect(plugin.autoTranscriptionFailed).toHaveBeenCalledTimes(1);
      expect(notices).toHaveLength(before + 1);
      expect(String(notices[before].message)).toMatch(/tries again in 10 minutes/);
      // The page waits out the pause, longer than the usual wait.
      vi.advanceTimersByTime(10 * 60_000 - 1);
      expect(plugin.runRecognition).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(plugin.runRecognition).toHaveBeenCalledTimes(1);
      // The next failure in a row is not shown again.
      plugin.autoTranscriptionFailed.mockImplementation(() => false);
      await view.recognize(provider as never, true);
      expect(provider.recognize).toHaveBeenCalledTimes(2);
      expect(notices).toHaveLength(before + 1);
      expect(plugin.transcriptionWorked).not.toHaveBeenCalled();
    });

    it("does not send while a failure's wait is running", async () => {
      const view = threePages();
      inside(view).scheduleAutoTranscription([inside(view).doc.pages[0].id]);
      plugin.autoTranscriptionWait.mockReturnValue(5 * 60_000);
      const provider = reader();
      await view.recognize(provider as never, true);
      expect(provider.recognize).not.toHaveBeenCalled();
      plugin.autoTranscriptionWait.mockReturnValue(0);
      vi.advanceTimersByTime(5 * 60_000);
      expect(plugin.runRecognition).toHaveBeenCalledTimes(1);
      await view.recognize(provider as never, true);
      expect(provider.recognize).toHaveBeenCalledTimes(1);
      expect(plugin.transcriptionWorked).toHaveBeenCalledTimes(1);
    });

    it("reads a page written on a few seconds after it is left, not after the long wait", () => {
      const view = threePages();
      const ids = inside(view).doc.pages.map((p) => p.id);
      const shown = (index: number) =>
        (view as unknown as { pageShown(i: number): void }).pageShown(index);
      shown(0);
      inside(view).scheduleAutoTranscription([ids[0]]);
      // Leaving a page nobody wrote on changes nothing.
      shown(0);
      vi.advanceTimersByTime(AUTO_RECOGNIZE_LEAVE_MS);
      expect(plugin.runRecognition).not.toHaveBeenCalled();
      shown(1);
      vi.advanceTimersByTime(AUTO_RECOGNIZE_LEAVE_MS - 1);
      expect(plugin.runRecognition).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(plugin.runRecognition).toHaveBeenCalledTimes(1);
    });

    it("keeps waiting pages for their notebook when the view opens another, and reads them on return", async () => {
      const view = threePages();
      const ids = inside(view).doc.pages.map((p) => p.id);
      inside(view).scheduleAutoTranscription([ids[2]]);
      const notebook = view.getViewData();
      const own = (view as unknown as { file: TFile }).file;
      // Off screen: the fake surface cannot show another document.
      (view as unknown as { mounted: boolean }).mounted = false;
      (view as unknown as { file: TFile }).file = new TFile("Other.notebook.md", 100);
      view.setViewData(notebookFile(), true);
      expect(plugin.waiting.get("Physics.notebook.md")).toEqual([ids[2]]);
      vi.advanceTimersByTime(IDLE);
      expect(plugin.runRecognition).not.toHaveBeenCalled();
      (view as unknown as { file: TFile }).file = own;
      view.setViewData(notebook, true);
      vi.advanceTimersByTime(AUTO_RECOGNIZE_LEAVE_MS);
      expect(plugin.runRecognition).toHaveBeenCalledTimes(1);
      const provider = reader();
      await view.recognize(provider as never, true);
      expect(provider.recognize.mock.calls[0][0].strokes[0].id).toBe("s2");
    });

    it("leaves the text view shut, and says the transcript is in the Files tab", async () => {
      const view = threePages();
      const provider = reader();
      await view.transcribe(provider as never, "notebook");
      expect(provider.recognize).toHaveBeenCalledTimes(3);
      expect((view as unknown as { textPanelOpen: boolean }).textPanelOpen).toBe(false);
      expect(String(notices[notices.length - 1].message)).toMatch(/Files tab, under Transcripts/);
    });

    it("keeps a transcript typed by hand, and puts the new one beside it to compare", async () => {
      const view = threePages();
      typing = null;
      view.typePageTranscript(0);
      expect(typing).toMatchObject({ page: 1, text: "" });
      typing!.submit("my own words");
      const provider = reader();
      // The page changed since: transcribing it again finds the typed text.
      (inside(view).doc.pages[0] as unknown as { strokes: unknown[] }).strokes.push({
        id: "x",
        tool: "pen",
        color: "#000",
        size: 3,
        pts: [1, 2, 0.5, 3, 4, 0.5],
      } as never);
      await view.transcribe(provider as never, "page");
      expect(String(notices[notices.length - 1].message)).toMatch(/your own transcript/);
      const views = sidebarViews(view);
      expect(views[0]).toMatchObject({ text: "my own words", source: "typed" });
      expect(views[0].pending).toMatch(/^read s0/);
      // Choosing the new one in the Files tab makes it the page's.
      (view as unknown as { transcriptAction(k: string, a: string): void }).transcriptAction(
        views[0].key,
        "use-new",
      );
      expect(sidebarViews(view)[0]).toMatchObject({ source: "ai" });
      expect(sidebarViews(view)[0].pending).toBeUndefined();
      // Edit opens the dialog on the page's text as it is now.
      (view as unknown as { transcriptAction(k: string, a: string): void }).transcriptAction(
        views[0].key,
        "edit",
      );
      expect(typing).toMatchObject({ page: 1, text: sidebarViews(view)[0].text });
    });

    it("opens the typing dialog for Manual, and for Transcribe this page without an AI", async () => {
      const view = threePages();
      typing = null;
      await view.transcribe({ id: "manual", requiresNetwork: false } as never, "notebook");
      expect(typing).toMatchObject({ page: 1 });
      typing = null;
      (plugin as unknown as { aiSetup: () => unknown }).aiSetup = () => ({
        vendor: "anthropic",
        baseUrl: "",
        imageVendor: "same",
        hasKey: () => false,
      });
      await view.transcribePageNow();
      expect(typing).toMatchObject({ page: 1 });
    });

    it("sends three pages at a time and comes back for the rest", async () => {
      const view = threePages();
      const doc = inside(view).doc as unknown as { pages: unknown[] };
      for (const id of ["p4", "p5"]) {
        const page = blankPage(id);
        page.strokes.push({
          id: `s-${id}`,
          tool: "pen",
          color: "#000",
          size: 3,
          pts: [1, 2, 0.5, 3, 4, 0.5],
        } as never);
        doc.pages.push(page);
      }
      inside(view).scheduleAutoTranscription(inside(view).doc.pages.map((p) => p.id));
      const provider = reader();
      await view.recognize(provider as never, true);
      expect(provider.recognize).toHaveBeenCalledTimes(3);
      vi.advanceTimersByTime(IDLE);
      expect(plugin.runRecognition).toHaveBeenCalledTimes(1);
      await view.recognize(provider as never, true);
      expect(provider.recognize).toHaveBeenCalledTimes(5);
    });
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

describe("saving while the pen writes", () => {
  // FineNotes#1: a save mid-stroke stalls the main thread, and on iPadOS 17
  // the pen's movement during the stall is drawn as a straight line.
  let clock = 0;
  let saves = 0;

  beforeEach(() => {
    vi.useFakeTimers();
    clock = 0;
    saves = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const proto = Object.getPrototypeOf(InkView.prototype) as { save: () => Promise<void> };
    vi.spyOn(proto, "save").mockImplementation(() => {
      saves++;
      return Promise.resolve();
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function pen(view: View): (down: boolean) => void {
    return (down) => (view as unknown as { penActivity(d: boolean): void }).penActivity(down);
  }

  it("saves at once when the pen is not writing", async () => {
    const view = openView();
    await view.save();
    expect(saves).toBe(1);
  });

  it("puts a save off until the pen has rested, past the PDF's short pause (#274)", async () => {
    const view = openView();
    const set = pen(view);
    set(true);
    await view.save();
    expect(saves).toBe(0);
    clock = 500;
    set(false);
    await view.save();
    expect(saves).toBe(0);
    // The pen's short quiet: PDF pages may render, the save still waits.
    clock = 500 + QUIET_MS;
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    expect(saves).toBe(0);
    clock = 500 + SAVE_QUIET_MS;
    await vi.advanceTimersByTimeAsync(SAVE_QUIET_MS - QUIET_MS);
    expect(saves).toBe(1);
  });

  it("makes a save Obsidian asks for after the pen's timer has run", async () => {
    const view = openView();
    const set = pen(view);
    set(true);
    clock = 100;
    set(false);
    clock = 100 + QUIET_MS;
    await vi.advanceTimersByTimeAsync(QUIET_MS);
    // Obsidian's own 2 s timer lands now: held, and looked at again later.
    await view.save();
    expect(saves).toBe(0);
    clock = 100 + SAVE_QUIET_MS;
    await vi.advanceTimersByTimeAsync(SAVE_QUIET_MS - QUIET_MS);
    expect(saves).toBe(1);
  });

  it("does not make the waiting save if the pen comes back down in time", async () => {
    const view = openView();
    const set = pen(view);
    set(true);
    await view.save();
    clock = 100;
    set(false);
    await vi.advanceTimersByTimeAsync(400);
    clock = 500;
    set(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(saves).toBe(0);
  });

  it("makes a long-waiting save at a lift, between strokes", async () => {
    const view = openView();
    const set = pen(view);
    set(true);
    await view.save();
    // Writing on with never a long enough rest: a stroke every 2 s.
    for (clock = 1000; clock < MAX_SAVE_HOLD_MS; clock += 1000) {
      set(clock % 2000 === 0);
      expect(saves).toBe(0);
    }
    clock = MAX_SAVE_HOLD_MS;
    set(true);
    clock = MAX_SAVE_HOLD_MS + 50;
    set(false);
    // The save starts at the lift; it reaches Obsidian a few promise steps on.
    await vi.advanceTimersByTimeAsync(0);
    expect(saves).toBe(1);
  });

  it("lets go if the pen's lift never arrives", async () => {
    const view = openView();
    pen(view)(true);
    await view.save();
    expect(saves).toBe(0);
    clock = 20_000;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(saves).toBe(1);
  });

  it("never holds a save that clears the view", async () => {
    const view = openView();
    pen(view)(true);
    await view.save(true);
    expect(saves).toBe(1);
  });
});

describe("a notebook kept as one file per page per device (#274)", () => {
  const NOTEBOOK = "Physics/Physics.notebook.md";
  const FOLDER = "Physics/Pages/n7k2q9ab";
  const BODY = "# Physics\n\nMy prose.";
  const ME = "me111111";

  /**
   * A view over a vault holding `files` by path; a folder lists the files
   * in it, and writes land in `files`. This install's device id is ME.
   */
  function openOver(files: Map<string, string>, path = NOTEBOOK): View {
    plugin = fakePlugin();
    const folders = new Set<string>();
    const folderAt = (at: string): TFolder | null => {
      const children = [...files.keys()]
        .filter((p) => p.startsWith(`${at}/`) && !p.slice(at.length + 1).includes("/"))
        .map((p) => new TFile(p));
      const isFolder = [...files.keys()].some((p) => p.startsWith(`${at}/`)) || folders.has(at);
      return isFolder ? Object.assign(new TFolder(at), { children }) : null;
    };
    const app = {
      vault: {
        getAbstractFileByPath: (p: string) => (files.has(p) ? new TFile(p) : folderAt(p)),
        read: (file: TFile) => Promise.resolve(files.get(file.path) ?? ""),
        create: (p: string, text: string) => {
          files.set(p, text);
          return Promise.resolve(new TFile(p));
        },
        modify: (file: TFile, text: string) => {
          files.set(file.path, text);
          return Promise.resolve();
        },
        createFolder: (p: string) => {
          folders.add(p);
          return Promise.resolve();
        },
        getAllLoadedFiles: () => [],
      },
      loadLocalStorage: (key: string) => (key === "finenotes-device-id" ? ME : null),
      saveLocalStorage: () => undefined,
    };
    const view = new InkView(new WorkspaceLeaf(app) as never, plugin as never);
    (view as unknown as { file: TFile }).file = new TFile(path, 100);
    return view;
  }

  /** A three-page notebook in the layout; device a1 wrote a stroke on p2. */
  async function threePages(): Promise<{ notebook: string; files: Map<string, string> }> {
    const { encodeDocumentWith, inkFileText } = await import("../../src/model/serialize");
    const { pageFileText } = await import("../../src/model/device-pages");
    const { deflateToBase64 } = await import("../../src/model/compress");
    const doc = emptyDocument(1024);
    doc.pages = [blankPage("p1"), blankPage("p2"), blankPage("p3")];
    const page = {
      dev: "a1",
      page: "p2",
      rev: 1,
      vv: { a1: 1 },
      strokes: [
        { id: "a1.1", d: "a1.1", tool: "pen", color: "#1a1a1a", size: 3, pts: [1, 2, 128] },
      ],
    };
    const files = new Map([
      [`${FOLDER}/p2.a1.md`, pageFileText(`v2:${deflateToBase64(JSON.stringify(page))}`)],
    ]);
    return {
      notebook: inkFileText(
        BODY,
        encodeDocumentWith(doc, ["device-pages"]).replace(
          "+device-pages:",
          "+device-pages=n7k2q9ab:",
        ),
      ),
      files,
    };
  }

  const settle = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  const pagesOf = (view: View) =>
    (inside(view).doc as unknown as { pages: { id: string; strokes: { id: string }[] }[] }).pages;
  const addStroke = (view: View, page: number): void => {
    const doc = inside(view).doc as unknown as { pages: { strokes: unknown[] }[] };
    doc.pages[page].strokes.push({
      id: dotIds.mintedId(doc) ?? "no-clock",
      tool: "pen",
      color: "#1a1a1a",
      size: 3,
      pts: [10, 20, 0.5, 30, 40, 0.5],
    });
    // As an edit does: it asks for a save.
    (view as unknown as { requestSave(): void }).requestSave();
  };

  it("shows its pages joined from their files, and can be written", async () => {
    const { notebook, files } = await threePages();
    const view = openOver(files);
    view.setViewData(notebook, true);
    await settle();
    expect(pagesOf(view).map((page) => page.id)).toEqual(["p1", "p2", "p3"]);
    expect(pagesOf(view)[1].strokes.map((s) => s.id)).toEqual(["a1.1"]);
    expect(inside(view).isProtected()).toBe(false);
    expect(notices).toHaveLength(0);
    // The notebook file is written as it was read: the note and the legacy notebook.
    expect(view.getViewData()).toBe(notebook);
  });

  it("saves only this device's file for the page changed, and its meta", async () => {
    const { notebook, files } = await threePages();
    const view = openOver(files);
    view.setViewData(notebook, true);
    await settle();
    addStroke(view, 2);
    await view.save();
    await settle();
    expect([...files.keys()].sort()).toEqual([
      `${FOLDER}/_meta.${ME}.md`,
      `${FOLDER}/p2.a1.md`,
      `${FOLDER}/p3.${ME}.md`,
    ]);
    expect(view.getViewData()).toBe(notebook);
    // Nothing more changed: nothing more is written.
    const before = new Map(files);
    await view.save();
    await settle();
    expect(files).toEqual(before);
    // Its ids are dots of this device.
    expect(pagesOf(view)[2].strokes[0].id.startsWith(`${ME}.`)).toBe(true);
  });

  it("takes its pages along when it is moved while open, and saves there", async () => {
    const { notebook, files } = await threePages();
    const view = openOver(files);
    const app = (view as unknown as { app: Record<string, unknown> }).app;
    // Obsidian's rename of a folder: every file under it moves.
    app.fileManager = {
      renameFile: (from: { path: string }, to: string) => {
        for (const [path, text] of [...files]) {
          if (path.startsWith(`${from.path}/`)) {
            files.delete(path);
            files.set(to + path.slice(from.path.length), text);
          }
        }
        return Promise.resolve();
      },
      trashFile: () => Promise.resolve(),
    };
    view.setViewData(notebook, true);
    await settle();
    const moved = new TFile("Course/Physics.notebook.md", 100);
    (view as unknown as { file: TFile }).file = moved;
    await view.onRename(moved as never);
    await settle();
    addStroke(view, 2);
    await view.save();
    await settle();
    const paths = [...files.keys()].sort();
    expect(paths).toEqual([
      "Course/Pages/n7k2q9ab/_meta.me111111.md",
      "Course/Pages/n7k2q9ab/p2.a1.md",
      "Course/Pages/n7k2q9ab/p3.me111111.md",
    ]);
    // Obsidian also tells the view of other files renamed (its page files moving
    // along): those move nothing (in the rig they nested `Pages/Pages/…`).
    await view.onRename(new TFile("Course/Pages/n7k2q9ab/p2.a1.md") as never);
    await settle();
    expect([...files.keys()].sort()).toEqual(paths);
  });

  it("keeps showing another device's page while its file is being written whole", async () => {
    vi.useFakeTimers();
    const { notebook, files } = await threePages();
    const view = openOver(files);
    view.setViewData(notebook, true);
    await vi.advanceTimersByTimeAsync(0);
    await settle();
    expect(pagesOf(view)[1].strokes).toHaveLength(1);
    const changed = (path: string): void =>
      (view as unknown as { devicePageChanged(path: string): void }).devicePageChanged(path);
    // A sync writes the file empty first, then fills it (the empty-read trap, #273).
    const full = files.get(`${FOLDER}/p2.a1.md`) ?? "";
    for (const partial of ["", full.slice(0, full.length / 2)]) {
      files.set(`${FOLDER}/p2.a1.md`, partial);
      changed(`${FOLDER}/p2.a1.md`);
      await vi.advanceTimersByTimeAsync(1000);
      await settle();
      expect(pagesOf(view)[1].strokes.map((s) => s.id)).toEqual(["a1.1"]);
      expect(inside(view).isProtected()).toBe(false);
    }
  });

  it("reads another device's file again when it changes, and never its own", async () => {
    vi.useFakeTimers();
    const { notebook, files } = await threePages();
    const late = files.get(`${FOLDER}/p2.a1.md`) ?? "";
    files.delete(`${FOLDER}/p2.a1.md`);
    const view = openOver(files);
    view.setViewData(notebook, true);
    await settle();
    expect(pagesOf(view)[1].strokes).toHaveLength(0);
    const changed = (path: string): void =>
      (view as unknown as { devicePageChanged(path: string): void }).devicePageChanged(path);
    const doc = inside(view).doc;
    changed(`${FOLDER}/p2.${ME}.md`);
    changed("Physics/Pages/q3x9/p2.a1.md");
    await vi.advanceTimersByTimeAsync(1000);
    expect(inside(view).doc).toBe(doc);
    files.set(`${FOLDER}/p2.a1.md`, late);
    changed(`${FOLDER}/p2.a1.md`);
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(pagesOf(view)[1].strokes).toHaveLength(1);
  });

  it("takes no edits and writes nothing while a page is still syncing", async () => {
    const { notebook, files } = await threePages();
    const { metaFileText, payloadHash } = await import("../../src/model/device-pages");
    const { deflateToBase64 } = await import("../../src/model/compress");
    // a1's meta names a file for p3 that has not arrived.
    const meta = { dev: "a1", vv: { a1: 2 }, files: { p3: { rev: 1, hash: payloadHash("x") } } };
    files.set(`${FOLDER}/_meta.a1.md`, metaFileText(`v2:${deflateToBase64(JSON.stringify(meta))}`));
    const view = openOver(files);
    view.setViewData(notebook, true);
    await settle();
    expect(notices.map((n) => n.message)).toEqual([expect.stringContaining("syncing")]);
    expect(inside(view).isProtected()).toBe(true);
    addStroke(view, 0);
    await view.save();
    await settle();
    expect([...files.keys()].some((path) => path.includes(ME))).toBe(false);
  });

  it("moves a one-file notebook to the layout at its first save", async () => {
    const files = new Map<string, string>();
    const view = openOver(files, "Physics.notebook.md");
    const one = notebookFile();
    view.setViewData(one, true);
    addStroke(view, 0);
    await view.save();
    await settle();
    const text = view.getViewData();
    const parsed = parseInkFile(text, 1024);
    expect(parsed.doc).toBeNull();
    // The payload read, relabelled, not encoded again.
    const before = parseInkFile(one, 1024).payload ?? "";
    expect(parsed.payload?.replace(/^v2\+device-pages=[a-z0-9]{8}:/, "v2:")).toBe(before);
    // Only the label changed: the note is as it was, the id in the label.
    expect(parsed.body).toBe(parseInkFile(one, 1024).body);
    expect(parsed.payload).toMatch(/^v2\+device-pages=[a-z0-9]{8}:/);
    // The stroke made before that save is this device's, in its page file.
    const names = [...files.keys()].map((path) => path.replace(/^Pages\/[a-z0-9]+\//, ""));
    expect(names).toEqual([`p1.${ME}.md`, `_meta.${ME}.md`]);
    expect(pagesOf(view)[0].strokes.map((s) => s.id)).toEqual(["s1", `${ME}.1`]);
  });

  it("makes the same notebook file on two devices moving it at once", async () => {
    const one = notebookFile();
    const texts: string[] = [];
    for (const device of ["laptop11", "ipad2222"]) {
      const files = new Map<string, string>();
      const view = openOver(files, "Physics.notebook.md");
      const app = (view as unknown as { app: { loadLocalStorage: (k: string) => unknown } }).app;
      app.loadLocalStorage = (key) => (key === "finenotes-device-id" ? device : null);
      view.setViewData(one, true);
      addStroke(view, 0);
      await view.save();
      await settle();
      texts.push(view.getViewData());
      expect(pagesOf(view)[0].strokes.map((s) => s.id)).toEqual(["s1", `${device}.1`]);
    }
    expect(texts[1]).toBe(texts[0]);
  });

  it("without an id in its frontmatter is held as a load it cannot read", async () => {
    const { notebook, files } = await threePages();
    const view = openOver(files);
    const noId = notebook.replace("+device-pages=n7k2q9ab:", "+device-pages:");
    view.setViewData(noId, true);
    await settle();
    expect(notices.map((n) => n.message)).toEqual([expect.stringContaining("did not load")]);
    expect(pagesOf(view)).toHaveLength(1);
    expect(inside(view).isProtected()).toBe(true);
    expect(view.getViewData()).toBe(noId);
  });
});
