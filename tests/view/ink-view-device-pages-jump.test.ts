import { describe, expect, it, vi } from "vitest";
import { blankPage, emptyDocument } from "../../src/model/document";

vi.mock("obsidian", () => import("./fake-obsidian"));

const { InkView } = await import("../../src/view/ink-view");

type FakeInkView = Record<string, unknown>;

function makeDoc(pageCount: number) {
  const doc = emptyDocument();
  doc.pages = Array.from({ length: pageCount }, (_, i) => blankPage(`p${i + 1}`));
  return doc;
}

function makeView(path: string, initialPages = 1) {
  const goToPage = vi.fn();
  const doc = makeDoc(initialPages);
  const surface = {
    document: doc,
    surfaceEl: { clientHeight: 800 },
    goToPage,
    flashPage: vi.fn(),
  };
  const view: FakeInkView = Object.assign(Object.create(InkView.prototype), {
    mounted: true,
    file: { path },
    loadedPath: path,
    restoredPath: path,
    doc,
    surface,
    plugin: { settings: { paperWidth: 800 } },
    devicePages: null,
    devicePagesRead: 0,
    devicePagesLoading: false,
    devicePagesPartial: false,
    devicePagesNoticed: null,
    pendingSubpath: null,
    pendingPageIndex: null,
    pendingPageId: null,
    pendingSearch: null,
    pendingHighlightPage: false,
    knownText: null,
    ownTexts: { forget: vi.fn() },
    saver: { stop: vi.fn() },
    companion: { changed: vi.fn() },
    audio: null,
    recordLastPage: vi.fn(),
    relinkDoc: vi.fn(() => 0),
    requestSave: vi.fn(),
    showDocument: vi.fn(function (this: FakeInkView) {
      (this.surface as { document: unknown }).document = this.doc;
    }),
    matchPdfResolution: vi.fn(),
    blankNotebook: () => makeDoc(1),
  });
  return { view, goToPage };
}

describe("InkView DevicePages pending page jumps", () => {
  it("defers a pageIndex jump queued during readDevicePages until pages finish loading", async () => {
    const { view, goToPage } = makeView("Welcome.notebook.md", 1);
    let resolveFiles!: (m: Map<string, string>) => void;
    const fullDoc = makeDoc(10);
    view.devicePages = {
      path: "Welcome.notebook.md",
      readFiles: () => new Promise<Map<string, string>>((r) => (resolveFiles = r)),
      load: () => ({ doc: fullDoc, newer: [], syncing: false }),
    };

    const reading = (
      InkView.prototype as unknown as { readDevicePages(): Promise<void> }
    ).readDevicePages.call(view);
    expect(view.devicePagesLoading).toBe(true);

    // Ephemeral state arrives while readFiles() is still in flight.
    InkView.prototype.setEphemeralState.call(view, { pageIndex: 6 });
    expect(goToPage).not.toHaveBeenCalled();
    expect(view.pendingPageIndex).toBe(6);

    resolveFiles(new Map());
    await reading;

    expect(view.devicePagesLoading).toBe(false);
    expect(goToPage).toHaveBeenCalledWith(6);
    expect(view.pendingPageIndex).toBeNull();
  });

  it("preserves a pageIndex jump arriving after a partial syncing read until the complete read", async () => {
    const { view, goToPage } = makeView("Welcome.notebook.md", 1);
    const partialDoc = makeDoc(2);
    const fullDoc = makeDoc(10);
    let syncing = true;
    view.devicePages = {
      path: "Welcome.notebook.md",
      readFiles: () => Promise.resolve(new Map()),
      load: () => ({ doc: syncing ? partialDoc : fullDoc, newer: [], syncing }),
    };

    const read = () =>
      (InkView.prototype as unknown as { readDevicePages(): Promise<void> }).readDevicePages.call(
        view,
      );

    // First read is partial (syncing).
    await read();
    expect(view.devicePagesPartial).toBe(true);

    // User clicks page 7 after the partial read arrived.
    InkView.prototype.setEphemeralState.call(view, { pageIndex: 6 });
    expect(goToPage).not.toHaveBeenCalled();
    expect(view.pendingPageIndex).toBe(6);

    // Complete read arrives and applies the deferred jump.
    syncing = false;
    await read();
    expect(view.devicePagesPartial).toBe(false);
    expect(goToPage).toHaveBeenCalledWith(6);
    expect(view.pendingPageIndex).toBeNull();
  });

  it("clears deferred navigation on clear() so switching notebooks never leaks a jump", () => {
    const { view, goToPage } = makeView("A.notebook.md", 1);
    view.devicePagesLoading = true;
    InkView.prototype.setEphemeralState.call(view, { pageIndex: 4, subpath: "#Page 5" });
    expect(view.pendingSubpath).toBe("#Page 5");

    InkView.prototype.clear.call(view);

    expect(view.devicePagesLoading).toBe(false);
    expect(view.devicePagesPartial).toBe(false);
    expect(view.pendingPageIndex).toBeNull();
    expect(view.pendingSubpath).toBeNull();
    expect(view.pendingPageId).toBeNull();
    expect(view.pendingSearch).toBeNull();
    expect(view.pendingHighlightPage).toBe(false);
    expect(goToPage).not.toHaveBeenCalled();
  });

  it("replaces an earlier deferred subpath when a newer pageIndex request arrives during sync", async () => {
    const { view, goToPage } = makeView("Welcome.notebook.md", 1);
    const partialDoc = makeDoc(2);
    const fullDoc = makeDoc(12);
    let syncing = true;
    view.devicePages = {
      path: "Welcome.notebook.md",
      readFiles: () => Promise.resolve(new Map()),
      load: () => ({ doc: syncing ? partialDoc : fullDoc, newer: [], syncing }),
    };

    const read = () =>
      (InkView.prototype as unknown as { readDevicePages(): Promise<void> }).readDevicePages.call(
        view,
      );

    await read();
    // Earlier link (#Page 4) arrives while still syncing.
    InkView.prototype.setEphemeralState.call(view, { subpath: "#Page 4" });
    expect(view.pendingSubpath).toBe("#Page 4");

    // Later thumbnail click (page 9 -> index 8) arrives before sync completes.
    InkView.prototype.setEphemeralState.call(view, { pageIndex: 8 });
    expect(view.pendingSubpath).toBeNull();
    expect(view.pendingPageIndex).toBe(8);

    syncing = false;
    await read();
    expect(goToPage).toHaveBeenCalledWith(8);
  });
});
