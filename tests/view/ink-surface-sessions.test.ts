/**
 * `InkSurface.showSession`: several documents on one surface, each with its
 * own undo history and view, swapped without dropping the tile cache.
 *
 * No DOM: the surface is built from the class's prototype with only the
 * state the swap reads, and its collaborators (renderer, scroller, layout)
 * are recorders, as in `ink-surface.test.ts`.
 */

import { describe, expect, it, vi } from "vitest";
import { layoutPages } from "../../src/canvas/page-layout";
import { AddPage } from "../../src/model/commands";
import { type InkDocument, blankPage, emptyDocument } from "../../src/model/document";
import { History } from "../../src/model/history";
import { IdSequence } from "../../src/view/id-sequence";
import { StrokeIndex } from "../../src/view/stroke-index";
import type { SurfaceSession } from "../../src/view/surface-session";

vi.mock("obsidian", () => ({
  Notice: class {},
  Platform: {},
  setIcon: () => {},
}));

const { InkSurface } = await import("../../src/view/ink-surface");

type State = Record<string, unknown>;

function run<T = unknown>(surface: State, method: string, ...args: unknown[]): T {
  const fn = (InkSurface.prototype as unknown as Record<string, (...a: unknown[]) => T>)[method];
  return fn.apply(surface, args);
}

function docOf(...ids: string[]): InkDocument {
  const doc = emptyDocument();
  doc.pages = ids.map((id) => blankPage(id));
  return doc;
}

/** A surface showing `doc` as its first session, with recorders around it. */
function rig(doc: InkDocument) {
  const calls: string[] = [];
  const renderer = {
    invalidateAll: vi.fn(() => calls.push("invalidateAll")),
    invalidatePage: vi.fn((id: string) => calls.push(`invalidatePage:${id}`)),
    setLayout: vi.fn(),
    setPreviewWindow: vi.fn(),
    repaintAll: vi.fn(),
    setWarmViewports: vi.fn(),
  };
  let position = { x: 0, y: 0 };
  const scroller = {
    get position() {
      return position;
    },
    setPosition: (x: number, y: number) => {
      position = { x, y };
    },
    stop: () => {},
  };
  const history = new History();
  const strokeIds = new IdSequence("s");
  const textBoxIds = new IdSequence("t");
  const strokeIndex = new StrokeIndex();
  const linkSuggestions = new Map();
  const wordFlags = new Map();
  const shown: Array<[boolean, boolean]> = [];
  const surface: State = Object.assign(Object.create(InkSurface.prototype) as object, {
    doc,
    history,
    strokeIds,
    textBoxIds,
    strokeIndex,
    linkSuggestions,
    wordFlags,
    tileOwners: new Map(),
    toolState: { tool: "pen" },
    renderer,
    scroller,
    callbacks: {
      onSessionChange: (s: SurfaceSession) => calls.push(`session:${s.doc.pages[0].id}`),
    },
    mirroredStep: null,
    zoomBox: null,
    zoomPositionHistory: [],
    userZoom: 1,
    minZoom: 1,
    baseScale: 1,
    zoomInitialised: true,
    pageIndex: 0,
    heldPage: null,
    direction: "vertical",
    joined: false,
    board: false,
    boardRef: null,
    boardLaidOut: null,
    boardDrawn: null,
    boardHold: null,
    boardShift: { x: 0, y: 0 },
    rowSlot: 0,
    rowGap: Number.NaN,
    pageLayout: layoutPages(doc.pages),
    viewport: { scrollY: 0, scale: 1, width: 800 },
    offsetX: 0,
    cssW: 800,
    cssH: 600,
    // Collaborators the swap calls, recorded.
    endExplore: () => calls.push("endExplore"),
    endWetStroke: () => calls.push("endWetStroke"),
    stopPress: () => {},
    cancelImageDrag: () => {},
    cancelGroupDrag: () => {},
    endCrop: () => {},
    dropSelection: () => calls.push("dropSelection"),
    eraseReset: () => calls.push("eraseReset"),
    dropTextBoxViews: () => calls.push("dropTextBoxViews"),
    hideOffPage: () => {},
    hideTextCopy: () => {},
    setSearchHits: () => calls.push("setSearchHits"),
    setFadedStrokes: () => {},
    setActiveWordFlag: () => {},
    ensurePaperSize: () => {},
    boardPreviewWindow: () => null,
    layout: () => calls.push("layout"),
    flashChrome: () => calls.push("flashChrome"),
    reportStatus: () => {},
    syncHistory(this: State) {
      const h = this.history as History;
      shown.push([h.canUndo(), h.canRedo()]);
    },
  });
  surface.session = {
    doc,
    history,
    strokeIds,
    textBoxIds,
    strokeIndex,
    fixedPages: false,
    view: null,
    indexed: true,
    mirroredStep: null,
    linkSuggestions,
    wordFlags,
  } satisfies SurfaceSession;
  history.onChange = () => (surface.syncHistory as () => void).call(surface);
  return { surface, calls, renderer, shown };
}

/** The session shown, as the `activeSession` getter reads it. */
const active = (surface: State): SurfaceSession => surface.session as SurfaceSession;

describe("showSession", () => {
  it("keeps each session's history apart across a swap and back", () => {
    const notes = docOf("p1");
    const { surface, shown } = rig(notes);
    const a = active(surface);
    (surface.history as History).push(notes, new AddPage(1, blankPage("p2")));
    expect(notes.pages.map((p) => p.id)).toEqual(["p1", "p2"]);

    const pdf = docOf("x1", "x2");
    const b = run<SurfaceSession>(surface, "createSession", pdf, { fixedPages: true });
    expect(b.fixedPages).toBe(true);
    // Room for both sessions' tiles to stay warm.
    expect(
      (surface.renderer as { setWarmViewports: ReturnType<typeof vi.fn> }).setWarmViewports,
    ).toHaveBeenCalled();
    // The slides either side are made whole ahead (the first has none before it).
    Object.assign(surface, { session: b, doc: pdf, pageIndex: 0, direction: "vertical" });
    expect(run(surface, "pagesToTurnTo")).toEqual([1]);
    Object.assign(surface, { session: a, doc: notes, pageIndex: 0 });
    run(surface, "showSession", b);
    expect(surface.doc).toBe(pdf);
    expect(surface.history).toBe(b.history);
    expect(shown.at(-1)).toEqual([false, false]);
    expect(b.history.canUndo()).toBe(false);
    // An edit in the PDF's session lands in its own history only.
    (surface.history as History).push(pdf, new AddPage(2, blankPage("x3")));
    expect(a.history.canUndo()).toBe(true);
    expect(b.history.canUndo()).toBe(true);

    run(surface, "showSession", a);
    expect(surface.doc).toBe(notes);
    expect(surface.history).toBe(a.history);
    expect(shown.at(-1)).toEqual([true, false]);
    // A's undo takes back A's step, and leaves B's document alone.
    (surface.history as History).undo(surface.doc as InkDocument);
    expect(notes.pages.map((p) => p.id)).toEqual(["p1"]);
    expect(pdf.pages.map((p) => p.id)).toEqual(["x1", "x2", "x3"]);
    expect(b.history.canUndo()).toBe(true);
    // Only the shown session's history reports to the host.
    expect(b.history.onChange).toBeNull();
    expect(a.history.onChange).not.toBeNull();
  });

  it("restores each session's view, opens a new one fresh", () => {
    const { surface } = rig(docOf("p1", "p2", "p3"));
    const a = active(surface);
    Object.assign(surface, { userZoom: 2.5, pageIndex: 2, heldPage: 2 });
    (surface.scroller as { setPosition: (x: number, y: number) => void }).setPosition(30, 1800);

    const b = run<SurfaceSession>(surface, "createSession", docOf("x1"));
    run(surface, "showSession", b);
    expect(surface.pageIndex).toBe(0);
    expect(surface.zoomInitialised).toBe(false);
    expect((surface.scroller as { position: unknown }).position).toEqual({ x: 0, y: 0 });
    expect(b.indexed).toBe(true);
    Object.assign(surface, { userZoom: 1.2, zoomInitialised: true });

    run(surface, "showSession", a);
    expect(surface.userZoom).toBe(2.5);
    expect(surface.pageIndex).toBe(2);
    expect(surface.heldPage).toBe(2);
    expect((surface.scroller as { position: unknown }).position).toEqual({ x: 30, y: 1800 });

    run(surface, "showSession", b);
    expect(surface.userZoom).toBe(1.2);
    expect(surface.pageIndex).toBe(0);
  });

  it("notes on page 5, a PDF's tab, and back: page 5 at the same scroll and zoom", () => {
    const { surface } = rig(docOf("p1", "p2", "p3", "p4", "p5", "p6"));
    const notes = active(surface);
    Object.assign(surface, { userZoom: 1.4, pageIndex: 4, heldPage: null });
    const scroller = surface.scroller as {
      position: { x: number; y: number };
      setPosition: (x: number, y: number) => void;
    };
    scroller.setPosition(12, 4321);
    const pdf = run<SurfaceSession>(surface, "createSession", docOf("x1", "x2", "x3"), {
      fixedPages: true,
    });
    run(surface, "showSession", pdf);
    // Read on the slides meanwhile.
    Object.assign(surface, { userZoom: 2, pageIndex: 2 });
    scroller.setPosition(0, 900);
    run(surface, "showSession", notes);
    expect(surface.pageIndex).toBe(4);
    expect(surface.userZoom).toBe(1.4);
    expect(scroller.position).toEqual({ x: 12, y: 4321 });
  });

  it("ends what was under way and keeps the tiles", () => {
    const { surface, calls, renderer } = rig(docOf("p1"));
    const b = run<SurfaceSession>(surface, "createSession", docOf("x1"));
    calls.length = 0;
    run(surface, "showSession", b);
    expect(calls).toContain("dropSelection");
    expect(calls).toContain("eraseReset");
    expect(calls).toContain("endWetStroke");
    expect(calls).toContain("dropTextBoxViews");
    expect(calls).toContain("layout");
    expect(calls).toContain("session:x1");
    expect(calls).not.toContain("flashChrome");
    expect(renderer.invalidateAll).not.toHaveBeenCalled();
    // The new session's page has no tiles of its own yet: whatever is cached under its id goes.
    expect(renderer.invalidatePage.mock.calls).toEqual([["x1"]]);
    // Showing the session shown already does nothing.
    calls.length = 0;
    run(surface, "showSession", b);
    expect(calls).toEqual([]);
  });

  it("drops the tiles of a page id two documents share, and only those", () => {
    const { surface, renderer } = rig(docOf("p1", "p2"));
    const a = active(surface);
    const b = run<SurfaceSession>(surface, "createSession", docOf("x1", "p2"));
    run(surface, "showSession", b);
    renderer.invalidatePage.mockClear();
    run(surface, "showSession", a);
    expect(renderer.invalidatePage.mock.calls).toEqual([["p2"]]);
    renderer.invalidatePage.mockClear();
    run(surface, "showSession", b);
    expect(renderer.invalidatePage.mock.calls).toEqual([["p2"]]);
  });

  it("carries link suggestions and word flags with their session", () => {
    const { surface } = rig(docOf("p1"));
    const a = active(surface);
    (surface.wordFlags as Map<string, unknown>).set("p1", [["s1"]]);
    const b = run<SurfaceSession>(surface, "createSession", docOf("x1"));
    run(surface, "showSession", b);
    expect((surface.wordFlags as Map<string, unknown>).size).toBe(0);
    run(surface, "showSession", a);
    expect((surface.wordFlags as Map<string, unknown>).get("p1")).toEqual([["s1"]]);
  });
});

describe("setDocument", () => {
  it("still clears the history and the whole tile cache", () => {
    const doc = docOf("p1");
    const { surface, calls, renderer } = rig(doc);
    Object.assign(surface, { closeZoomBox: () => {} });
    (surface.history as History).push(doc, new AddPage(1, blankPage("p2")));
    const reloaded = docOf("p1");
    run(surface, "setDocument", reloaded);
    expect((surface.history as History).canUndo()).toBe(false);
    expect(renderer.invalidateAll).toHaveBeenCalledTimes(1);
    expect(calls).toContain("flashChrome");
    expect(active(surface).doc).toBe(reloaded);
    expect(surface.doc).toBe(reloaded);
  });
});
