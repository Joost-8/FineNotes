/**
 * `src/view/ink-surface.ts` — characterisation of the parts of the surface
 * that can run without a DOM: the keyboard shortcuts, the pointer lines of
 * the diagnostics HUD, stroke ids and the per-page stroke index behind the
 * eraser, and the wait for a pane that has no size yet.
 *
 * There is no DOM in this suite, so each test builds a surface from the
 * class's prototype and gives it only the state the code under test reads;
 * collaborators it would call (undo, the action bar, the scroller…) are
 * recorders. The adapters at the top of each section are the only place
 * that knows how the surface keeps that state.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { PointerDebugRecord } from "../../src/input/pointer-controller";
import { History } from "../../src/model/history";
import { type InkDocument, type Page, type Stroke, blankPage } from "../../src/model/document";
import { IdSequence, highestIdNumber, strokeIdsOf } from "../../src/view/id-sequence";
import { PointerHud } from "../../src/view/pointer-hud";
import { StrokeIndex } from "../../src/view/stroke-index";
import { SizeWait } from "../../src/view/surface-size";

vi.mock("obsidian", () => ({
  Notice: class {},
  Platform: {},
  setIcon: () => {},
}));

const { InkSurface } = await import("../../src/view/ink-surface");

/** The number new stroke ids count on from. */
const maxStrokeId = (doc: InkDocument): number => highestIdNumber(strokeIdsOf(doc), "s");

type State = Record<string, unknown>;

/** A surface with the class's methods and only the given state. */
function surfaceWith(state: State): State {
  return Object.assign(Object.create(InkSurface.prototype) as object, state) as State;
}

/** Run one of the surface's own methods (private ones too) on `surface`. */
function run<T = unknown>(surface: State, method: string, ...args: unknown[]): T {
  const fn = (InkSurface.prototype as unknown as Record<string, (...a: unknown[]) => T>)[method];
  return fn.apply(surface, args);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// --- Documents -------------------------------------------------------------------

/** A straight stroke from (x0, y) to (x1, y), three samples. */
function line(id: string, x0: number, x1: number, y: number, tool: Stroke["tool"] = "pen"): Stroke {
  const mid = (x0 + x1) / 2;
  return { id, color: "#000000", size: 2, tool, pts: [x0, y, 0.5, mid, y, 0.5, x1, y, 0.5] };
}

function page(id: string, strokes: Stroke[]): Page {
  const p = blankPage(id);
  p.strokes = strokes;
  return p;
}

function documentOf(...pages: Page[]): InkDocument {
  return { version: 3, view: { scrollY: 0, zoom: 1 }, pages } as unknown as InkDocument;
}

/** Where page `index` sits in layout space; only `index` and `id` matter here. */
function boxOf(doc: InkDocument, index: number): State {
  const p = doc.pages[index];
  return {
    index,
    id: p.id,
    x: 0,
    y: index * 2000,
    width: p.geometry.width,
    height: p.geometry.height,
  };
}

// --- Stroke ids ------------------------------------------------------------------

describe("stroke ids", () => {
  it("seeds from the highest s<N> id, not from the number of strokes", () => {
    const doc = documentOf(
      page("p1", [line("s1", 0, 10, 0), line("s10", 0, 10, 20)]),
      page("p2", [line("s4", 0, 10, 0)]),
    );
    expect(maxStrokeId(doc)).toBe(10);
  });

  it("is 0 for a document without strokes", () => {
    expect(maxStrokeId(documentOf(page("p1", [])))).toBe(0);
  });

  it("ignores ids that are not s followed by digits", () => {
    const doc = documentOf(
      page("p1", [
        line("x99", 0, 10, 0),
        line("s", 0, 10, 0),
        line("S50", 0, 10, 0),
        line("s12a", 0, 10, 0),
        line("s-40", 0, 10, 0),
        line("t70", 0, 10, 0),
        line("s3", 0, 10, 0),
      ]),
    );
    expect(maxStrokeId(doc)).toBe(3);
  });

  it("reads leading zeros as the number they spell", () => {
    expect(maxStrokeId(documentOf(page("p1", [line("s007", 0, 10, 0)])))).toBe(7);
  });
});

// --- Keyboard --------------------------------------------------------------------

interface Mods {
  meta?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

/** What is on screen when the key goes down. */
interface KeyScene {
  cropping?: boolean;
  editingText?: boolean;
  menuOpen?: boolean;
  imageSelected?: boolean;
  groupSelected?: boolean;
  pressMenu?: boolean;
  /** Pages run across… */
  row?: boolean;
  /** …and the page fits the pane top to bottom. */
  rowFits?: boolean;
  /** Cmd/Ctrl + the key is taken by the clipboard. */
  clipboardTakes?: boolean;
}

interface Pressed {
  taken: boolean;
  prevented: boolean;
  calls: string[];
}

function press(
  key: string,
  mods: Mods = {},
  scene: KeyScene = {},
  target: unknown = null,
): Pressed {
  const calls: string[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]): void => {
      calls.push(args.length > 0 ? `${name}(${args.map(String).join(",")})` : name);
    };
  const surface = surfaceWith({
    cropping: scene.cropping ? {} : null,
    pressMenu: scene.pressMenu ? {} : null,
    direction: scene.row ? "horizontal" : "vertical",
    scroller: { bounds: { minX: 0, minY: 0, maxX: 0, maxY: scene.rowFits ? 0 : 400 } },
    actionBar: { isMenuOpen: scene.menuOpen === true, closeMenu: record("closeMenu") },
    callbacks: { onChange: () => {}, onToolChange: record("onToolChange") },
    editingTextView: () => (scene.editingText ? {} : null),
    clipboardKey: (event: KeyboardEvent) => {
      calls.push(`clipboard(${event.key})`);
      return scene.clipboardTakes === true;
    },
    liveImageSelection: () => (scene.imageSelected ? {} : null),
    liveSelection: () => (scene.groupSelected ? {} : null),
    undo: record("undo"),
    redo: record("redo"),
    endCrop: record("endCrop"),
    deleteSelectedImage: record("deleteSelectedImage"),
    deselectImage: record("deselectImage"),
    deleteSelection: record("deleteSelection"),
    clearSelection: record("clearSelection"),
    nextPage: record("nextPage"),
    previousPage: record("previousPage"),
    scrollStep: record("scrollStep"),
    setTool: record("setTool"),
  });
  let prevented = false;
  const event = {
    key,
    metaKey: mods.meta === true,
    ctrlKey: mods.ctrl === true,
    shiftKey: mods.shift === true,
    altKey: mods.alt === true,
    target,
    preventDefault: () => {
      prevented = true;
    },
  };
  const taken = run<boolean>(surface, "handleKeyDown", event);
  return { taken, prevented, calls };
}

const TAKEN = { taken: true, prevented: true };
const TAKEN_QUIETLY = { taken: true, prevented: false };
const PASSED = { taken: false, prevented: false, calls: [] };

describe("handleKeyDown", () => {
  it("undoes with Cmd+Z or Ctrl+Z and redoes with Shift added", () => {
    expect(press("z", { meta: true })).toEqual({ ...TAKEN, calls: ["undo"] });
    expect(press("z", { ctrl: true })).toEqual({ ...TAKEN, calls: ["undo"] });
    expect(press("Z", { meta: true, shift: true })).toEqual({ ...TAKEN, calls: ["redo"] });
    expect(press("Z", { ctrl: true, shift: true })).toEqual({ ...TAKEN, calls: ["redo"] });
  });

  it("undoes even with a selection, a menu or a crop open", () => {
    const busy = { cropping: true, menuOpen: true, imageSelected: true, groupSelected: true };
    expect(press("z", { meta: true }, busy)).toEqual({ ...TAKEN, calls: ["undo"] });
  });

  it("leaves every key alone while a field has the focus", () => {
    expect(press("z", { meta: true }, {}, { tagName: "TEXTAREA" })).toEqual(PASSED);
    expect(press("p", {}, {}, { tagName: "INPUT" })).toEqual(PASSED);
    expect(press("Delete", {}, { groupSelected: true }, { tagName: "SELECT" })).toEqual(PASSED);
    expect(press("e", {}, {}, { tagName: "DIV", isContentEditable: true })).toEqual(PASSED);
  });

  it("does not mistake a plain element for a field", () => {
    expect(press("p", {}, {}, { tagName: "DIV", isContentEditable: false })).toEqual({
      ...TAKEN_QUIETLY,
      calls: ["setTool(pen)", "onToolChange(pen)"],
    });
  });

  it("switches tools with their letters, either case", () => {
    const tools: Array<[string, string]> = [
      ["p", "pen"],
      ["h", "highlighter"],
      ["e", "eraser"],
      ["v", "select"],
      ["s", "shape"],
      ["t", "text"],
      ["P", "pen"],
      ["E", "eraser"],
    ];
    for (const [key, tool] of tools) {
      expect(press(key)).toEqual({
        ...TAKEN_QUIETLY,
        calls: [`setTool(${tool})`, `onToolChange(${tool})`],
      });
    }
  });

  it("ignores tool letters with Alt, and offers them to the clipboard with Cmd", () => {
    expect(press("p", { alt: true })).toEqual(PASSED);
    expect(press("p", { meta: true })).toEqual({
      taken: false,
      prevented: false,
      calls: ["clipboard(p)"],
    });
    expect(press("p", { ctrl: true, alt: true })).toEqual(PASSED);
  });

  it("passes keys it has no use for", () => {
    for (const key of ["x", "Tab", "Enter", " ", "1", "ArrowLeft", "Escape", "Delete"]) {
      expect(press(key)).toEqual(PASSED);
    }
  });

  it("in crop mode: Enter keeps the crop, Escape drops it, Delete does nothing", () => {
    const crop = { cropping: true, imageSelected: true };
    expect(press("Enter", {}, crop)).toEqual({ ...TAKEN, calls: ["endCrop(true)"] });
    expect(press("Escape", {}, crop)).toEqual({ ...TAKEN, calls: ["endCrop(false)"] });
    expect(press("Delete", {}, crop)).toEqual({ ...TAKEN_QUIETLY, calls: [] });
    expect(press("Backspace", {}, crop)).toEqual({ ...TAKEN_QUIETLY, calls: [] });
  });

  it("in crop mode still takes other keys the usual way", () => {
    expect(press("p", {}, { cropping: true })).toEqual({
      ...TAKEN_QUIETLY,
      calls: ["setTool(pen)", "onToolChange(pen)"],
    });
    expect(press("PageDown", {}, { cropping: true })).toEqual({ ...TAKEN, calls: ["nextPage"] });
  });

  it("offers Cmd/Ctrl + a key to the clipboard, unless Alt or Shift is held or text is edited", () => {
    expect(press("c", { meta: true }, { clipboardTakes: true })).toEqual({
      ...TAKEN_QUIETLY,
      calls: ["clipboard(c)"],
    });
    expect(press("v", { ctrl: true }, { clipboardTakes: true })).toEqual({
      ...TAKEN_QUIETLY,
      calls: ["clipboard(v)"],
    });
    expect(press("c", { meta: true, alt: true }, { clipboardTakes: true })).toEqual(PASSED);
    expect(press("c", { meta: true, shift: true }, { clipboardTakes: true })).toEqual(PASSED);
    expect(press("c", { meta: true }, { clipboardTakes: true, editingText: true })).toEqual(PASSED);
  });

  it("goes on past a clipboard that refused the key", () => {
    expect(press("c", { meta: true })).toEqual({
      taken: false,
      prevented: false,
      calls: ["clipboard(c)"],
    });
    expect(press("Delete", { meta: true }, { groupSelected: true })).toEqual({
      ...TAKEN,
      calls: ["clipboard(Delete)", "deleteSelection"],
    });
  });

  it("offers the clipboard its key while a crop is open (the clipboard refuses it there)", () => {
    expect(press("c", { meta: true }, { cropping: true })).toEqual({
      taken: false,
      prevented: false,
      calls: ["clipboard(c)"],
    });
  });

  it("closes the selection's menu with Escape before anything else", () => {
    const scene = { menuOpen: true, imageSelected: true, groupSelected: true, pressMenu: true };
    expect(press("Escape", {}, scene)).toEqual({ ...TAKEN_QUIETLY, calls: ["closeMenu"] });
  });

  it("deletes or lets go of a selected picture", () => {
    const image = { imageSelected: true, groupSelected: true };
    expect(press("Delete", {}, image)).toEqual({ ...TAKEN, calls: ["deleteSelectedImage"] });
    expect(press("Backspace", {}, image)).toEqual({ ...TAKEN, calls: ["deleteSelectedImage"] });
    expect(press("Escape", {}, image)).toEqual({ ...TAKEN_QUIETLY, calls: ["deselectImage"] });
  });

  it("deletes or lets go of a lasso selection", () => {
    const group = { groupSelected: true, pressMenu: true };
    expect(press("Delete", {}, group)).toEqual({ ...TAKEN, calls: ["deleteSelection"] });
    expect(press("Backspace", {}, group)).toEqual({ ...TAKEN, calls: ["deleteSelection"] });
    expect(press("Escape", {}, group)).toEqual({ ...TAKEN_QUIETLY, calls: ["clearSelection"] });
  });

  it("closes a tap-and-hold bar with Escape, and leaves Delete alone there", () => {
    expect(press("Escape", {}, { pressMenu: true })).toEqual({
      ...TAKEN_QUIETLY,
      calls: ["clearSelection"],
    });
    expect(press("Delete", {}, { pressMenu: true })).toEqual(PASSED);
  });

  it("turns pages with Page Down and Page Up, without modifiers", () => {
    expect(press("PageDown")).toEqual({ ...TAKEN, calls: ["nextPage"] });
    expect(press("PageUp")).toEqual({ ...TAKEN, calls: ["previousPage"] });
    expect(press("PageDown", { alt: true })).toEqual(PASSED);
    expect(press("PageUp", { meta: true })).toEqual({
      taken: false,
      prevented: false,
      calls: ["clipboard(PageUp)"],
    });
  });

  it("scrolls a step with the arrow keys", () => {
    expect(press("ArrowDown")).toEqual({ ...TAKEN, calls: ["scrollStep(150)"] });
    expect(press("ArrowUp")).toEqual({ ...TAKEN, calls: ["scrollStep(-150)"] });
    expect(press("ArrowDown", { alt: true })).toEqual(PASSED);
    // A row whose page is taller than the pane still has somewhere to scroll.
    expect(press("ArrowDown", {}, { row: true })).toEqual({ ...TAKEN, calls: ["scrollStep(150)"] });
  });

  it("turns the page with the arrow keys on a row that fits the pane", () => {
    const fits = { row: true, rowFits: true };
    expect(press("ArrowDown", {}, fits)).toEqual({ ...TAKEN, calls: ["nextPage"] });
    expect(press("ArrowUp", {}, fits)).toEqual({ ...TAKEN, calls: ["previousPage"] });
    // A column never turns, whatever its scroll range.
    expect(press("ArrowDown", {}, { rowFits: true })).toEqual({
      ...TAKEN,
      calls: ["scrollStep(150)"],
    });
  });
});

// --- Diagnostics HUD -------------------------------------------------------------

/** A down, three moves and an up, as one pen stroke reports them. */
function strokeRecords(t: number): Array<Partial<PointerDebugRecord>> {
  return [
    { type: "down", pressure: 0.3, timeStamp: t },
    { type: "move", pressure: 0.5, coalesced: 3, timeStamp: t + 8 },
    { type: "move", pressure: 0.8, coalesced: 2, timeStamp: t + 24.6 },
    { type: "move", pressure: 0.6, coalesced: 1, timeStamp: t + 30 },
    { type: "up", pressure: 0, timeStamp: t + 40 },
  ];
}

interface Hud {
  record(partial: Partial<PointerDebugRecord>): void;
  mark(label: string): void;
  setDebug(on: boolean): void;
  text(): string;
  hidden(): boolean;
}

function hud(debug = true): Hud {
  let text = "";
  let hidden = !debug;
  const doc = documentOf(page("p1", [line("s1", 0, 10, 0), line("s2", 0, 10, 20)]), page("p2", []));
  const pointerHud = new PointerHud();
  const surface = surfaceWith({
    debug,
    hud: pointerHud,
    hudFrame: 0,
    hudLastVerdict: "-",
    hudEl: {
      setText: (value: string) => {
        text = value;
      },
      toggleClass: (cls: string, on: boolean) => {
        if (cls === "is-hidden") hidden = on;
      },
    },
    doc,
    pageIndex: 1,
    trackPointer: () => {},
    scheduleHud: () => {},
    hudGeometry: () => "GEOMETRY",
  });
  return {
    record: (partial) =>
      run(surface, "onPointerEvent", {
        type: "move",
        pointerType: "pen",
        pointerId: 1,
        pressure: 0,
        coalesced: 0,
        timeStamp: 0,
        ...partial,
      }),
    mark: (label) => pointerHud.mark(label),
    setDebug: (on) => run(surface, "setDebug", on),
    text: () => {
      run(surface, "renderHud");
      return text;
    },
    hidden: () => hidden,
  };
}

describe("the HUD's pointer lines", () => {
  it("starts empty", () => {
    expect(hud().text()).toBe(
      "\ncur mv=0 pts=0 gap=0ms maxP=0.00\nΣ dn=0 up=0 cx=0 commit=2\nshape -\n- p=0.00 page=2\nGEOMETRY",
    );
  });

  it("logs a stroke: its events, its moves and samples, the longest gap and top pressure", () => {
    const h = hud();
    for (const r of strokeRecords(100)) h.record(r);
    expect(h.text()).toBe(
      "dn m·3 up\ncur mv=3 pts=6 gap=17ms maxP=0.80\nΣ dn=1 up=1 cx=0 commit=2\nshape -\npen p=0.00 page=2\nGEOMETRY",
    );
  });

  it("counts the gap from pen-down to the first move", () => {
    const h = hud();
    h.record({ type: "down", timeStamp: 1000 });
    h.record({ type: "move", timeStamp: 1052.4, coalesced: 1, pressure: 0.2 });
    expect(h.text().split("\n")[1]).toBe("cur mv=1 pts=1 gap=52ms maxP=0.20");
  });

  it("starts each stroke's numbers afresh and keeps the totals", () => {
    const h = hud();
    for (const r of strokeRecords(0)) h.record(r);
    h.record({ type: "down", pointerType: "touch", pressure: 0.4, timeStamp: 500 });
    h.record({ type: "move", pointerType: "touch", pressure: 0.1, coalesced: 4, timeStamp: 505 });
    h.record({ type: "cancel", pointerType: "touch", pressure: 0.1, timeStamp: 510 });
    expect(h.text()).toBe(
      "dn m·3 up dn m·1 cx\ncur mv=1 pts=4 gap=5ms maxP=0.10\nΣ dn=2 up=1 cx=1 commit=2\nshape -\ntouch p=0.10 page=2\nGEOMETRY",
    );
  });

  it("keeps the last 30 entries of the log", () => {
    const h = hud();
    for (let i = 0; i < 12; i++) for (const r of strokeRecords(i * 100)) h.record(r);
    const log = h.text().split("\n")[0].split(" ");
    expect(log).toHaveLength(30);
    expect(log.slice(0, 3)).toEqual(["dn", "m·3", "up"]);
    expect(h.text().split("\n")[2]).toBe("Σ dn=12 up=12 cx=0 commit=2");
  });

  it("puts markers in the log, and a move after one starts a new run", () => {
    const h = hud();
    h.record({ type: "down", timeStamp: 0 });
    h.record({ type: "move", timeStamp: 5, coalesced: 1 });
    h.mark("hold");
    h.record({ type: "move", timeStamp: 10, coalesced: 1 });
    h.record({ type: "move", timeStamp: 15, coalesced: 1 });
    h.mark("snap?");
    expect(h.text().split("\n")[0]).toBe("dn m·1 hold m·2 snap?");
  });

  it("switched on, clears the log and the totals but not the stroke's numbers", () => {
    const h = hud();
    for (const r of strokeRecords(0)) h.record(r);
    h.setDebug(true);
    expect(h.hidden()).toBe(false);
    expect(h.text()).toBe(
      "\ncur mv=3 pts=6 gap=17ms maxP=0.80\nΣ dn=0 up=0 cx=0 commit=2\nshape -\npen p=0.00 page=2\nGEOMETRY",
    );
  });

  it("switched off, hides and counts nothing more", () => {
    const h = hud();
    h.setDebug(false);
    expect(h.hidden()).toBe(true);
    for (const r of strokeRecords(0)) h.record(r);
    h.setDebug(true);
    expect(h.text()).toBe(
      "\ncur mv=0 pts=0 gap=0ms maxP=0.00\nΣ dn=0 up=0 cx=0 commit=2\nshape -\n- p=0.00 page=2\nGEOMETRY",
    );
  });
});

// --- The stroke index behind the eraser and taps ----------------------------------

interface Ink {
  doc: InkDocument;
  surface: State;
  changes: string[];
  history: History;
  /** One whole-stroke eraser dab; true when it marked something new. */
  dab(pageIndex: number, x: number, y: number, radius?: number, filter?: string): boolean;
  /** One standard (partial) eraser dab. */
  cut(pageIndex: number, x: number, y: number, radius?: number): boolean;
  /** The eraser lifted on page `pageIndex`. */
  lift(pageIndex: number): void;
  /** Commit a finished stroke on page `pageIndex`. */
  commit(pageIndex: number, stroke: Stroke): void;
  /** The topmost stroke within `tolerance` of a point. */
  strokeAt(pageIndex: number, x: number, y: number, tolerance?: number): Stroke | null;
  clear(pageIndex: number): boolean;
  /** Undo in the model and re-read the document, as the surface's undo does. */
  undo(): void;
  pieces(): Map<string, Stroke[]>;
  marked(): Set<string>;
}

function ink(doc: InkDocument): Ink {
  const changes: string[] = [];
  const history = new History();
  const strokeIndex = new StrokeIndex();
  const strokeIds = new IdSequence("s");
  strokeIds.restart(strokeIdsOf(doc));
  const surface = surfaceWith({
    doc,
    strokeIndex,
    strokeIds,
    eraseIds: new Set(),
    erasePieces: new Map(),
    eraseDirty: new Set(),
    eraseLast: null,
    erasePreview: null,
    eraserCursorEl: { addClass: () => {} },
    activePage: null,
    renderer: null,
    history,
    penDownAt: null,
    pageIndex: 0,
    toolState: { pressureEnabled: true },
    callbacks: {
      onChange: () => changes.push("change"),
      onStatus: () => changes.push("status"),
    },
    clearSelection: () => changes.push("clearSelection"),
  });
  const reread = (): void => {
    strokeIndex.rebuild(doc.pages);
  };
  reread();
  return {
    doc,
    surface,
    changes,
    history,
    dab: (pageIndex, x, y, radius = 4, filter = "all") =>
      run<boolean>(surface, "eraseWholeAt", doc.pages[pageIndex], { x, y }, radius, filter),
    cut: (pageIndex, x, y, radius = 4) =>
      run<boolean>(surface, "erasePartialAt", doc.pages[pageIndex], { x, y }, radius, "all"),
    lift: (pageIndex) => {
      surface.activePage = boxOf(doc, pageIndex);
      run(surface, "eraseCommit");
    },
    commit: (pageIndex, stroke) =>
      run(surface, "commitStroke", boxOf(doc, pageIndex), doc.pages[pageIndex], stroke),
    strokeAt: (pageIndex, x, y, tolerance = 2) =>
      run<Stroke | null>(surface, "strokeAt", doc.pages[pageIndex], { x, y }, tolerance),
    clear: (pageIndex) => {
      surface.pageIndex = pageIndex;
      return run<boolean>(surface, "clearStrokes");
    },
    undo: () => {
      history.undo(doc);
      reread();
    },
    pieces: () => surface.erasePieces as Map<string, Stroke[]>,
    marked: () => surface.eraseIds as Set<string>,
  };
}

/** Two pages with strokes at the same page coordinates, and a highlighter. */
function twoPages(): InkDocument {
  return documentOf(
    page("p1", [
      line("s1", 10, 110, 10),
      line("s2", 10, 110, 100),
      line("s3", 10, 110, 200, "highlighter"),
    ]),
    page("p2", [line("s4", 10, 110, 10), line("s5", 10, 110, 100)]),
  );
}

const ids = (p: Page): string[] => p.strokes.map((s) => s.id);

describe("whole-stroke erase", () => {
  it("marks each stroke the eraser touches once, on its own page only", () => {
    const w = ink(twoPages());
    expect(w.dab(0, 50, 11)).toBe(true);
    expect(w.dab(0, 60, 9)).toBe(false);
    expect([...w.marked()]).toEqual(["s1"]);
    expect(w.dab(0, 50, 50)).toBe(false);
  });

  it("passes over strokes the filter keeps", () => {
    const w = ink(twoPages());
    expect(w.dab(0, 50, 200, 4, "pen")).toBe(false);
    expect(w.dab(0, 50, 10, 4, "highlighter")).toBe(false);
    expect(w.dab(0, 50, 200, 4, "highlighter")).toBe(true);
    expect([...w.marked()]).toEqual(["s3"]);
  });

  it("takes the marked strokes off their page as one undo step, and out of the index", () => {
    const w = ink(twoPages());
    w.dab(0, 50, 10);
    w.dab(0, 50, 100);
    w.lift(0);
    expect(ids(w.doc.pages[0])).toEqual(["s3"]);
    expect(ids(w.doc.pages[1])).toEqual(["s4", "s5"]);
    expect(w.changes).toEqual(["status", "change"]);
    expect(w.marked().size).toBe(0);
    expect(w.dab(0, 50, 10)).toBe(false);
    expect(w.strokeAt(0, 50, 100)).toBeNull();
    // The other page's stroke at the same coordinates is untouched.
    expect(w.dab(1, 50, 10)).toBe(true);
    w.undo();
    expect(ids(w.doc.pages[0])).toEqual(["s1", "s2", "s3"]);
  });

  it("removes strokes marked on several pages in one step", () => {
    const w = ink(twoPages());
    (w.surface.eraseIds as Set<string>).add("s2").add("s4");
    w.lift(0);
    expect(ids(w.doc.pages[0])).toEqual(["s1", "s3"]);
    expect(ids(w.doc.pages[1])).toEqual(["s5"]);
    w.undo();
    expect(ids(w.doc.pages[0])).toEqual(["s1", "s2", "s3"]);
    expect(ids(w.doc.pages[1])).toEqual(["s4", "s5"]);
  });

  it("records nothing when nothing was marked, or only ids no page holds", () => {
    const w = ink(twoPages());
    w.lift(0);
    (w.surface.eraseIds as Set<string>).add("s99");
    w.lift(0);
    expect(w.history.canUndo()).toBe(false);
    expect(w.changes).toEqual([]);
  });
});

describe("partial erase", () => {
  it("cuts a stroke into pieces with fresh ids above every id in the document", () => {
    const w = ink(twoPages());
    expect(w.cut(0, 60, 10)).toBe(true);
    const pieces = w.pieces().get("s1") ?? [];
    expect(pieces.map((p) => p.id)).toEqual(["s6", "s7"]);
    // The document is untouched until the eraser lifts.
    expect(ids(w.doc.pages[0])).toEqual(["s1", "s2", "s3"]);
  });

  it("replaces the originals on lift, and the index then holds the pieces", () => {
    const w = ink(twoPages());
    w.cut(0, 60, 10);
    w.lift(0);
    expect(ids(w.doc.pages[0])).toEqual(["s6", "s7", "s2", "s3"]);
    expect(w.changes).toEqual(["status", "change"]);
    expect(w.strokeAt(0, 20, 10)?.id).toBe("s6");
    expect(w.strokeAt(0, 100, 10)?.id).toBe("s7");
    expect(w.strokeAt(0, 60, 10)).toBeNull();
    w.undo();
    expect(ids(w.doc.pages[0])).toEqual(["s1", "s2", "s3"]);
    expect(w.strokeAt(0, 60, 10)?.id).toBe("s1");
  });
});

describe("committing a stroke", () => {
  it("adds it to its page and to the index at once", () => {
    const w = ink(twoPages());
    w.commit(1, line("s6", 10, 110, 300));
    expect(ids(w.doc.pages[1])).toEqual(["s4", "s5", "s6"]);
    expect(w.changes).toEqual(["status", "change"]);
    expect(w.strokeAt(1, 50, 300)?.id).toBe("s6");
    expect(w.strokeAt(0, 50, 300)).toBeNull();
  });
});

describe("strokeAt", () => {
  it("finds the topmost stroke near a point", () => {
    const doc = twoPages();
    doc.pages[0].strokes.push(line("s9", 40, 80, 10));
    const w = ink(doc);
    expect(w.strokeAt(0, 50, 10)?.id).toBe("s9");
    expect(w.strokeAt(0, 100, 10)?.id).toBe("s1");
    expect(w.strokeAt(0, 50, 30)).toBeNull();
  });

  it("reaches as far as half the stroke's width plus the tolerance", () => {
    const w = ink(twoPages());
    // Size 2: 1 px of ink either side of the centreline, then 2 px of slack.
    expect(w.strokeAt(0, 50, 13)?.id).toBe("s1");
    expect(w.strokeAt(0, 50, 13.5)).toBeNull();
  });
});

describe("clearStrokes", () => {
  it("empties the page being read in one step, and only that page", () => {
    const w = ink(twoPages());
    expect(w.clear(1)).toBe(true);
    expect(ids(w.doc.pages[1])).toEqual([]);
    expect(ids(w.doc.pages[0])).toEqual(["s1", "s2", "s3"]);
    expect(w.changes).toEqual(["clearSelection", "status", "change"]);
    expect(w.dab(1, 50, 10)).toBe(false);
    expect(w.dab(0, 50, 10)).toBe(true);
    w.undo();
    expect(ids(w.doc.pages[1])).toEqual(["s4", "s5"]);
  });

  it("does nothing on a page without strokes", () => {
    const w = ink(documentOf(page("p1", []), page("p2", [line("s1", 0, 10, 0)])));
    expect(w.clear(0)).toBe(false);
    expect(w.history.canUndo()).toBe(false);
    expect(w.changes).toEqual([]);
  });
});

// --- Layout: a pane with no size yet ------------------------------------------------

interface Pane {
  surface: State;
  frames: Array<() => void>;
  resized: Array<[number, number, number]>;
  /** Run queued frames until none is left; how many ran. */
  drain(): number;
}

function pane(width: number, height: number, devicePixelRatio?: number): Pane {
  const frames: Array<() => void> = [];
  const resized: Array<[number, number, number]> = [];
  vi.stubGlobal("window", {
    devicePixelRatio,
    requestAnimationFrame: (fn: () => void) => frames.push(fn),
  });
  vi.stubGlobal("document", { body: { hasClass: () => false } });
  const doc = documentOf(page("p1", []));
  const surface = surfaceWith({
    renderer: {
      setLayout: () => {},
      resize: (w: number, h: number, dpr: number) => resized.push([w, h, dpr]),
    },
    surfaceEl: { clientWidth: width, clientHeight: height },
    sizeWait: new SizeWait(),
    hudLayouts: 0,
    debug: false,
    doc,
    direction: "vertical",
    pageIndex: 0,
    pinch: null,
    zoomInitialised: true,
    baseScale: 1,
    userZoom: 1,
    minZoom: 1,
    scroller: { position: { x: 0, y: 0 }, setPosition: () => {} },
    updateZoomFloor: () => {},
    ensurePaperSize: () => {},
    syncViewport: () => {},
    settleIfIdle: () => {},
    renderAll: () => {},
    schedulePrefetch: () => {},
  });
  return {
    surface,
    frames,
    resized,
    drain: () => {
      let ran = 0;
      while (frames.length > 0) {
        frames.shift()?.();
        ran++;
      }
      return ran;
    },
  };
}

describe("layout", () => {
  it("tries again for 60 frames while the pane has no size, then leaves it to the observer", () => {
    const p = pane(0, 0);
    run(p.surface, "layout");
    expect(p.drain()).toBe(60);
    expect(p.resized).toEqual([]);
  });

  it("counts a pane with only one side as having no size", () => {
    const wide = pane(800, 0);
    run(wide.surface, "layout");
    expect(wide.drain()).toBe(60);
    const tall = pane(0, 600);
    run(tall.surface, "layout");
    expect(tall.drain()).toBe(60);
  });

  it("gets its full budget back once the pane has been measured", () => {
    const p = pane(0, 0);
    run(p.surface, "layout");
    for (let i = 0; i < 10; i++) p.frames.shift()?.();
    p.frames.length = 0;
    p.surface.surfaceEl = { clientWidth: 800, clientHeight: 600 };
    run(p.surface, "layout");
    expect(p.resized).toHaveLength(1);
    p.surface.surfaceEl = { clientWidth: 0, clientHeight: 0 };
    run(p.surface, "layout");
    expect(p.drain()).toBe(60);
  });

  it("does nothing once destroyed", () => {
    const p = pane(0, 0);
    p.surface.renderer = null;
    run(p.surface, "layout");
    expect(p.frames).toHaveLength(0);
  });

  it("backs the canvases at the device pixel ratio, at most 3", () => {
    const cases: Array<[number | undefined, number]> = [
      [1, 1],
      [2, 2],
      [2.5, 2.5],
      [3, 3],
      [4, 3],
      [0, 1],
      [undefined, 1],
    ];
    for (const [dpr, expected] of cases) {
      const p = pane(800, 600, dpr);
      run(p.surface, "layout");
      expect(p.resized).toEqual([[800, 600, expected]]);
    }
  });
});
