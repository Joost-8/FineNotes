/**
 * Snippets in the notebook view (`InkView.startSnippet`, `hoverSnippet`,
 * `dropSnippet`, `openSlide`): an area lassoed on a PDF's tab is drawn as a
 * picture, the drag resting on the Notes tab shows the notes, the drop
 * places the picture linked to its slide as one undo step, and the link
 * opens the slide again. The view is built from its prototype, with the
 * surface, the strip and the attachment as recorders.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetFakes } from "./fake-obsidian";
import type * as ImageImportModule from "../../src/view/image-import";

vi.mock("obsidian", () => import("./fake-obsidian"));
vi.mock("../../src/view/image-import", async (original) => ({
  ...(await original<typeof ImageImportModule>()),
  saveImageAttachment: vi.fn((_app: unknown, _prepared: unknown, name: string) =>
    Promise.resolve({ path: `Algo/${name}.png` }),
  ),
}));

const { InkView } = await import("../../src/view/ink-view");
const { saveImageAttachment } = await import("../../src/view/image-import");
const { blankPage, emptyDocument } = await import("../../src/model/document");
const { attachPdf, besideDocument, findBeside } = await import("../../src/model/beside-pdfs");
const { NOTES_TAB } = await import("../../src/model/pdf-tabs-list");
const { SNIPPET_FLIP_MS, SNIPPET_PAGE_MARGIN } = await import("../../src/model/snippet");
const { InsertImage } = await import("../../src/model/commands");

type Doc = ReturnType<typeof emptyDocument>;

interface Session {
  doc: Doc;
  fixedPages: boolean;
}

interface Inside {
  activeTab: string;
  showTab(id: string): void;
  startSnippet(index: number, area: object, viewScale: number): Promise<Blob | null> | null;
  hoverSnippet(x: number, y: number): void;
  dropSnippet(drop: { pageIndex: number; x: number; y: number } | null): Promise<void>;
  openSlide(slide: { tab: string; page: number }): void;
}

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
  const toolState = { tool: "pen" };
  const notes: Session = { doc, fixedPages: false };
  let active: Session = notes;
  const applied: unknown[] = [];
  const surface = recorder({
    get activeSession() {
      return active;
    },
    get document() {
      return active.doc;
    },
    currentPage: 0,
    createSession: (d: Doc, o: { fixedPages?: boolean }) => ({
      doc: d,
      fixedPages: o.fixedPages === true,
    }),
    showSession: (s: Session) => {
      active = s;
    },
    applyCommand: (command: unknown) => applied.push(command),
    goToPage: vi.fn(),
    selectImage: vi.fn(),
    showReadingView: vi.fn(() => true),
  });
  let overNotes = false;
  const strip = recorder({
    render: vi.fn(),
    setDropTarget: vi.fn(),
    tabAt: () => (overNotes ? NOTES_TAB : null),
  });
  const cropPicture = vi.fn(() => Promise.resolve(new Blob(["png"], { type: "image/png" })));
  const file = { path: "Algo/Algo.notebook.md", parent: null };
  const view = Object.assign(Object.create(InkView.prototype) as object, {
    doc,
    surface,
    toolbar: recorder({}),
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
    snippet: null,
    snippetTimer: 0,
    toolState,
    encoder: recorder({}),
    saveRequest: vi.fn(),
    guard: { locked: false },
    file,
    loadedPath: file.path,
    restoredPath: null,
    plugin: recorder({ settings: {} }),
    contentEl: recorder({}),
    cropPicture,
    app: {
      vault: { getAbstractFileByPath: () => ({}) },
      loadLocalStorage: () => null,
      saveLocalStorage: () => undefined,
    },
  });
  return {
    view: view as unknown as Inside,
    doc,
    surface,
    strip,
    applied,
    cropPicture,
    over: (on: boolean) => {
      overNotes = on;
    },
  };
}

let clock = 1000;

beforeEach(() => {
  resetFakes();
  clock = 1000;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  vi.stubGlobal("window", { setTimeout: () => 0, clearTimeout: () => undefined });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("a snippet's drag", () => {
  it("draws the lassoed area of the slide, and nothing on the notes", () => {
    const { view, cropPicture } = setup();
    expect(view.startSnippet(0, { minX: 0, minY: 0, maxX: 100, maxY: 50 }, 2)).toBeNull();
    view.showTab("b1");
    const picture = view.startSnippet(2, { minX: 100, minY: 50, maxX: 300, maxY: 150 }, 2.5);
    expect(picture).not.toBeNull();
    const [page, crop] = cropPicture.mock.lastCall as unknown as [
      { id: string },
      { x: number; scale: number },
    ];
    expect(page.id).toBe(besideDocument(findBeside(setup().doc, "b1")!).pages[2].id);
    expect(crop).toMatchObject({ x: 100, y: 50, width: 200, height: 100, scale: 2.5 });
  });

  it("lights the Notes tab while it rests there, and shows the notes after a moment", () => {
    const { view, strip, over } = setup();
    view.showTab("b1");
    view.startSnippet(0, { minX: 0, minY: 0, maxX: 100, maxY: 50 }, 2);
    view.hoverSnippet(400, 300);
    expect(strip.setDropTarget).toHaveBeenLastCalledWith(null);
    over(true);
    view.hoverSnippet(40, 10);
    expect(strip.setDropTarget).toHaveBeenLastCalledWith(NOTES_TAB);
    expect(view.activeTab).toBe("b1");
    clock += SNIPPET_FLIP_MS;
    view.hoverSnippet(41, 10);
    expect(view.activeTab).toBe(NOTES_TAB);
    expect(strip.setDropTarget).toHaveBeenLastCalledWith(null);
  });

  it("lands on the notes as a picture linked to its slide, centred where it was let go, its share of the slide's width", async () => {
    const { view, doc, applied, surface } = setup();
    view.showTab("b1");
    view.startSnippet(3, { minX: 100, minY: 50, maxX: 300, maxY: 150 }, 2);
    view.showTab(NOTES_TAB);
    await view.dropSnippet({ pageIndex: 1, x: 500, y: 600 });
    expect(applied).toHaveLength(1);
    const command = applied[0] as InstanceType<typeof InsertImage>;
    expect(command).toBeInstanceOf(InsertImage);
    command.apply(doc);
    const image = doc.pages[1].images[0];
    expect(image).toMatchObject({
      path: "Algo/W3 Hashing slide 4.png",
      slide: { tab: "b1", page: 3 },
    });
    // A quarter of the 800 px slide: a quarter of the notes page inside its margins.
    const usable = doc.pages[1].geometry.width * (1 - 2 * SNIPPET_PAGE_MARGIN);
    expect(image.w).toBeCloseTo(usable / 4);
    expect(image.h).toBeCloseTo(usable / 8);
    expect(image.x + image.w / 2).toBeCloseTo(500);
    expect(image.y + image.h / 2).toBeCloseTo(600);
    expect(surface.selectImage).toHaveBeenCalledWith(doc.pages[1].id, image.id);
    const [, prepared] = vi.mocked(saveImageAttachment).mock.lastCall!;
    expect(prepared).toMatchObject({ mime: "image/png", width: 400, height: 200 });
  });

  it("changes nothing when it went nowhere, or is let go on the slide's own tab", async () => {
    const { view, applied } = setup();
    view.showTab("b1");
    view.startSnippet(0, { minX: 0, minY: 0, maxX: 100, maxY: 50 }, 2);
    await view.dropSnippet({ pageIndex: 0, x: 10, y: 10 });
    view.startSnippet(0, { minX: 0, minY: 0, maxX: 100, maxY: 50 }, 2);
    view.showTab(NOTES_TAB);
    await view.dropSnippet(null);
    expect(applied).toHaveLength(0);
  });
});

describe("a snippet's link", () => {
  it("opens the slide on its tab, a closed tab again too", () => {
    const { view, doc, surface } = setup();
    findBeside(doc, "b1")!.hidden = true;
    view.openSlide({ tab: "b1", page: 2 });
    expect(view.activeTab).toBe("b1");
    expect(surface.goToPage).toHaveBeenCalledWith(2);
  });

  it("does nothing for a tab the notebook no longer has", () => {
    const { view, surface } = setup();
    view.openSlide({ tab: "b9", page: 0 });
    expect(view.activeTab).toBe(NOTES_TAB);
    expect(surface.goToPage).not.toHaveBeenCalled();
  });
});
