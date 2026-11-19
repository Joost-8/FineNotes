/**
 * PDF tabs in the notebook view (`InkView.showTab` and friends): a PDF's tab
 * is a session of its own on the surface, the notes' tool comes back with
 * the notes, marks written on a tab go into the notebook before a save, a
 * closed tab hands over to its neighbour, and what belongs to the notes is
 * refused on a tab. The view is built from its prototype, with the surface,
 * the bar and the panels as recorders.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notices, resetFakes } from "./fake-obsidian";

vi.mock("obsidian", () => import("./fake-obsidian"));

/** A PDF's outline as pdf.js would give it: every PDF here has the same. */
const readPdfOutline = vi.fn(async () => [
  { title: "Hashing", depth: 1, page: 0 },
  { title: "Chaining", depth: 2, page: 1 },
  { title: "Probing", depth: 2, page: 1, y: 0.6 },
]);
vi.mock("../../src/view/pdf-outline", () => ({ readPdfOutline }));

const { InkView } = await import("../../src/view/ink-view");
const { blankPage, emptyDocument } = await import("../../src/model/document");
const { attachPdf, besidePageId, findBeside } = await import("../../src/model/beside-pdfs");
const { NOTES_TAB, LAST_TABS_KEY } = await import("../../src/model/pdf-tabs-list");
const { contentsEntries } = await import("../../src/model/contents");

interface Session {
  doc: ReturnType<typeof emptyDocument>;
  fixedPages: boolean;
}

/** The members a test reaches that TypeScript keeps private. */
interface Inside {
  doc: ReturnType<typeof emptyDocument>;
  activeTab: string;
  toolState: { tool: string };
  showTab(id: string): void;
  closeTab(id: string): void;
  saveTabView(): void;
  syncTabMarks(): void;
  refuseOnPdfTab(): boolean;
  exportablePages(): { pages: unknown[] };
  attachMeasured(path: string, sizes: Array<{ width: number; height: number }>): boolean;
}

/** Anything not given: a recorder that returns nothing. */
function recorder<T extends object>(known: T): T {
  return new Proxy(known, {
    get(target, key) {
      if (key in target) return (target as Record<string | symbol, unknown>)[key];
      if (typeof key === "symbol" || key === "then") return undefined;
      const fn = vi.fn();
      (target as Record<string, unknown>)[key] = fn;
      return fn;
    },
  });
}

function setup() {
  const doc = emptyDocument();
  doc.pages.push(blankPage("p2"));
  attachPdf(doc, "Algo/W3 Hashing.pdf", [[800, 450, 4]]);
  attachPdf(doc, "Algo/Exercises 3.pdf", [[800, 450, 2]]);
  const toolState = { tool: "text" };
  const notes: Session = { doc, fixedPages: false };
  let active: Session = notes;
  const shown: Session[] = [];
  const surface = recorder({
    get activeSession() {
      return active;
    },
    get document() {
      return active.doc;
    },
    currentPage: 0,
    createSession: (d: Session["doc"], o: { fixedPages?: boolean }) => ({
      doc: d,
      fixedPages: o.fixedPages === true,
    }),
    showSession: (s: Session) => {
      active = s;
      shown.push(s);
      if (s.fixedPages && toolState.tool === "text") toolState.tool = "pen";
    },
    setTool: (tool: string) => {
      toolState.tool = tool;
    },
    readingView: () => ({ page: 2, zoom: 1.5004, x: 10.4, y: 20.6 }),
    showReadingView: vi.fn(() => true),
  });
  const strip = recorder({ render: vi.fn() });
  const toolbar = recorder({ setPdfTab: vi.fn() });
  const encoder = recorder({ touch: vi.fn() });
  const saveRequest = vi.fn();
  const storage = new Map<string, unknown>();
  const file = { path: "Algo/Algo.notebook.md", parent: null };
  const view = Object.assign(Object.create(InkView.prototype) as object, {
    doc,
    surface,
    toolbar,
    sidebar: recorder({}),
    pdfTabs: strip,
    pdfTabsPopover: null,
    morePanel: null,
    pdfText: null,
    notesSession: notes,
    tabSessions: new Map(),
    activeTab: NOTES_TAB,
    notesTool: null,
    tabViewTimer: 0,
    pdfTabNoticeAt: 0,
    toolState,
    encoder,
    saveRequest,
    guard: { locked: false },
    file,
    loadedPath: file.path,
    restoredPath: null,
    plugin: recorder({ settings: {} }),
    contentEl: recorder({}),
    app: {
      vault: {
        getAbstractFileByPath: (p: string) => (p.includes("Exercises") ? null : {}),
        getFileByPath: (p: string) => (p.includes("Exercises") ? null : { path: p }),
        readBinary: async () => new ArrayBuffer(8),
      },
      loadLocalStorage: (key: string) => storage.get(key) ?? null,
      saveLocalStorage: (key: string, value: unknown) => storage.set(key, value),
    },
  });
  return {
    view: view as unknown as Inside,
    doc,
    notes,
    shown,
    surface,
    strip,
    toolbar,
    encoder,
    saveRequest,
    storage,
    sidebar: (view as { sidebar: { setPdfTab: ReturnType<typeof vi.fn> } }).sidebar,
  };
}

beforeEach(() => {
  resetFakes();
  vi.stubGlobal("window", { setTimeout: () => 0, clearTimeout: () => undefined });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("switching tabs", () => {
  it("shows a PDF's tab as a session of its own with fixed pages, and its few tools", () => {
    const { view, shown, toolbar, strip, storage } = setup();
    view.showTab("b1");
    expect(view.activeTab).toBe("b1");
    const session = shown.at(-1)!;
    expect(session.fixedPages).toBe(true);
    expect(session.doc.pages).toHaveLength(4);
    expect(session.doc.pages[0].id).toBe(besidePageId("b1", 0));
    expect(toolbar.setPdfTab).toHaveBeenLastCalledWith(true);
    // The strip raises the tab, and marks the missing file grey.
    const [tabs, active, visible] = strip.render.mock.lastCall as [
      Array<{ id: string; missing: boolean }>,
      string,
      boolean,
    ];
    expect(active).toBe("b1");
    expect(visible).toBe(true);
    expect(tabs.map((tab) => [tab.id, tab.missing])).toEqual([
      ["b1", false],
      ["b2", true],
    ]);
    // This device remembers the tab, not the file.
    expect(JSON.parse(storage.get(LAST_TABS_KEY) as string)).toEqual({
      "Algo/Algo.notebook.md": "b1",
    });
  });

  it("gives the notes their tool back, and keeps each tab's session", () => {
    const { view, shown, notes, toolbar } = setup();
    view.showTab("b1");
    expect(view.toolState.tool).toBe("pen");
    const first = shown.at(-1);
    view.showTab(NOTES_TAB);
    expect(shown.at(-1)).toBe(notes);
    expect(view.toolState.tool).toBe("text");
    expect(toolbar.setPdfTab).toHaveBeenLastCalledWith(false);
    view.showTab("b1");
    expect(shown.at(-1)).toBe(first);
  });

  it("reopens a closed tab from the + list", () => {
    const { view, doc } = setup();
    findBeside(doc, "b2")!.hidden = true;
    view.showTab("b2");
    expect(findBeside(doc, "b2")!.hidden).toBeUndefined();
    expect(view.activeTab).toBe("b2");
  });

  it("closing the tab shown hands over to its neighbour, and keeps the PDF attached", () => {
    const { view, doc } = setup();
    view.showTab("b2");
    view.closeTab("b2");
    expect(view.activeTab).toBe("b1");
    expect(findBeside(doc, "b2")!.hidden).toBe(true);
    view.closeTab("b1");
    expect(view.activeTab).toBe(NOTES_TAB);
    expect(doc.beside).toHaveLength(2);
  });
});

describe("what a tab keeps", () => {
  it("takes ink written on a slide into the notebook before a save", () => {
    const { view, doc, shown } = setup();
    view.showTab("b1");
    const slide = shown.at(-1)!.doc.pages[2];
    slide.strokes.push({ id: "s1", points: [1, 2, 0.5], color: "#000", width: 2 } as never);
    view.syncTabMarks();
    expect(findBeside(doc, "b1")!.marks).toEqual([slide]);
  });

  it("remembers where the tab is read, rounded, without an undo step", () => {
    const { view, doc, encoder, saveRequest } = setup();
    view.showTab("b1");
    view.saveTabView();
    expect(findBeside(doc, "b1")!.view).toEqual({ page: 2, zoom: 1.5, x: 10, y: 21 });
    expect(encoder.touch).toHaveBeenCalled();
    expect(saveRequest).toHaveBeenCalled();
  });

  it("goes back to where a tab was left the first time it is shown", () => {
    const { view, doc, surface } = setup();
    findBeside(doc, "b1")!.view = { page: 3, zoom: 2, x: 0, y: 40 };
    view.showTab("b1");
    expect(surface.showReadingView).toHaveBeenCalledWith({ page: 3, zoom: 2, x: 0, y: 40 });
  });

  it("attaches a measured PDF and shows it as a tab", () => {
    const { view, doc } = setup();
    expect(view.attachMeasured("Algo/W4.pdf", [{ width: 960, height: 540 }])).toBe(true);
    const beside = doc.beside!.at(-1)!;
    expect(beside.path).toBe("Algo/W4.pdf");
    // Sized as Import PDF sizes its pages: the short side is the paper's.
    expect(beside.sizes[0][2]).toBe(1);
    expect(beside.sizes[0][0]).toBeGreaterThan(beside.sizes[0][1]);
    expect(view.activeTab).toBe(beside.id);
  });
});

describe("the notes' own", () => {
  it("refuses notes-only work on a PDF's tab, once in a while", () => {
    const { view } = setup();
    expect(view.refuseOnPdfTab()).toBe(false);
    view.showTab("b1");
    expect(view.refuseOnPdfTab()).toBe(true);
    expect(view.refuseOnPdfTab()).toBe(true);
    expect(notices).toHaveLength(1);
  });

  it("exports the notes, whatever tab is shown", () => {
    const { view, doc } = setup();
    view.showTab("b1");
    expect(view.exportablePages()).toBe(doc);
  });
});

describe("no jumping between notes and slides", () => {
  it("a tab shows where it was left, whatever notes page it is opened from", () => {
    const { view, doc, surface } = setup();
    (surface as { currentPage: number }).currentPage = 1;
    findBeside(doc, "b1")!.view = { page: 1, zoom: 2, x: 5, y: 40 };
    view.showTab("b1");
    expect(surface.showReadingView).toHaveBeenCalledWith({ page: 1, zoom: 2, x: 5, y: 40 });
  });

  it("a session already shown is not moved when shown again", () => {
    const { view, surface } = setup();
    view.showTab("b1");
    view.showTab(NOTES_TAB);
    view.showTab("b1");
    expect(
      (surface as unknown as { goToPage: { mock: { calls: unknown[][] } } }).goToPage.mock.calls,
    ).toEqual([]);
  });

  it("writing on the notes after reading a slide records nothing on the page", () => {
    const { view, doc, surface } = setup();
    view.showTab("b1");
    (surface as { currentPage: number }).currentPage = 2;
    view.showTab(NOTES_TAB);
    expect(Object.keys(doc.pages[0])).not.toContain("follows");
    expect(
      (surface as unknown as { goToPage: { mock: { calls: unknown[][] } } }).goToPage.mock.calls,
    ).toEqual([]);
  });
});

describe("a PDF tab's contents", () => {
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  type Entry = { title: string; index: number; level: number };
  const lastOutline = (fn: ReturnType<typeof vi.fn>): [boolean, Entry[] | undefined] =>
    fn.mock.calls.at(-1) as [boolean, Entry[] | undefined];

  beforeEach(() => readPdfOutline.mockClear());

  it("are the PDF's own outline, nested, read once per PDF", async () => {
    const { view, sidebar } = setup();
    view.showTab("b1");
    await flush();
    const [on, entries] = lastOutline(sidebar.setPdfTab);
    expect(on).toBe(true);
    expect(entries!.map((e) => [e.title, e.index, e.level])).toEqual([
      ["Hashing", 0, 1],
      ["Chaining", 1, 2],
      ["Probing", 1, 2],
    ]);
    view.showTab(NOTES_TAB);
    expect(lastOutline(sidebar.setPdfTab)[0]).toBe(false);
    view.showTab("b1");
    expect(lastOutline(sidebar.setPdfTab)[1]).toHaveLength(3);
    expect(readPdfOutline).toHaveBeenCalledTimes(1);
  });

  it("never go into the notebook's own contents", async () => {
    const { view, doc } = setup();
    view.showTab("b1");
    await flush();
    expect(contentsEntries(doc)).toEqual([]);
  });

  it("keeping a PDF beside the notes adds nothing to the notebook's contents", async () => {
    const { view, doc } = setup();
    expect(view.attachMeasured("Algo/W4.pdf", [{ width: 960, height: 540 }])).toBe(true);
    await flush();
    expect(contentsEntries(doc)).toEqual([]);
    expect(doc.pages.every((page) => page.title === undefined)).toBe(true);
  });

  it("a PDF that is missing shows no outline", async () => {
    const { view, sidebar } = setup();
    view.showTab("b2");
    await flush();
    expect(lastOutline(sidebar.setPdfTab)).toEqual([true, []]);
  });
});
