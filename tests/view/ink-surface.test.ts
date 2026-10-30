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
import { type InkRun, type InkTracer, inkRuns, penOptions } from "../../src/ink/freehand";
import { StrokeBuilder } from "../../src/ink/stroke-builder";
import { layoutPages } from "../../src/canvas/page-layout";
import { History } from "../../src/model/history";
import { type ShortcutTable, shortcutTable, withShortcut } from "../../src/model/shortcut-bindings";
import { type InkDocument, type Page, type Stroke, blankPage } from "../../src/model/document";
import { IdSequence, highestIdNumber, strokeIdsOf } from "../../src/view/id-sequence";
import { PointerHud } from "../../src/view/pointer-hud";
import { StrokeIndex } from "../../src/view/stroke-index";
import { SizeWait } from "../../src/view/surface-size";
import { type SelectionAction, menuLayout } from "../../src/view/selection-bar-model";

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

describe("wheel zoom", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function wheelPane(zoom = 2) {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    const applyZoom = vi.fn((next: number) => {
      surface.userZoom = next;
    });
    const scrollBy = vi.fn();
    const frame = vi.fn();
    const surface = surfaceWith({
      userZoom: zoom,
      minZoom: 0.8,
      cssH: 800,
      wheelZoomTimer: 0,
      direction: "vertical",
      applyZoom,
      scroller: { bounds: { maxY: 200 }, scrollBy },
      flashChrome: vi.fn(),
      requestFrame: frame,
    });
    function wheel(flags: Partial<WheelEvent> = {}) {
      const event = {
        deltaX: 0,
        deltaY: -120,
        deltaMode: 0,
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        clientX: 417,
        clientY: 287,
        preventDefault: vi.fn(),
        ...flags,
      };
      run(surface, "onWheel", event);
      return event;
    }
    return { surface, applyZoom, scrollBy, frame, wheel };
  }

  it.each([0, 1, 2])(
    "normalizes delta mode %s before bounding zoom, anchored to the pointer",
    (mode) => {
      const p = wheelPane();
      const event = p.wheel({ deltaMode: mode, deltaY: mode === 0 ? -120 : -3 });
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(p.applyZoom).toHaveBeenLastCalledWith(2 * 1.15, 417, 287);
      expect(p.scrollBy).not.toHaveBeenCalled();
      p.wheel({ deltaMode: mode, deltaY: mode === 0 ? 120 : 3 });
      expect(p.surface.userZoom).toBeCloseTo(2, 12);
    },
  );

  it("uses the same gentle step for Cmd and preserves small trackpad deltas", () => {
    const p = wheelPane();
    p.wheel({ ctrlKey: false, metaKey: true });
    expect(p.surface.userZoom).toBeCloseTo(2 * 1.15, 12);
    p.wheel({ deltaY: -2.5 });
    expect(p.surface.userZoom).toBeCloseTo(2 * 1.15 * Math.exp(0.025), 12);
  });

  it("retains the existing minimum and maximum through many wheel steps", () => {
    const p = wheelPane(0.8);
    p.wheel();
    expect(p.surface.userZoom).toBeCloseTo(0.8 * 1.15, 12);
    for (let i = 0; i < 50; i++) p.wheel();
    expect(p.surface.userZoom).toBe(8);
    p.wheel({ deltaY: 120 });
    expect(p.surface.userZoom).toBeCloseTo(8 / 1.15, 12);
    for (let i = 0; i < 50; i++) p.wheel({ deltaY: 120 });
    expect(p.surface.userZoom).toBe(0.8);
  });

  it("waits until 160 ms after the last wheel event before settling detail", () => {
    const p = wheelPane();
    p.wheel();
    vi.advanceTimersByTime(100);
    p.wheel();
    vi.advanceTimersByTime(159);
    expect(p.frame).not.toHaveBeenCalled();
    expect(p.surface.wheelZoomTimer).not.toBe(0);
    vi.advanceTimersByTime(1);
    expect(p.frame).toHaveBeenCalledOnce();
    expect(p.surface.wheelZoomTimer).toBe(0);
  });

  it.each([0, 1, 2])("leaves ordinary scrolling unchanged for delta mode %s", (mode) => {
    const p = wheelPane();
    p.wheel({ ctrlKey: false, deltaMode: mode, deltaX: 2, deltaY: 3 });
    const unit = mode === 0 ? 1 : mode === 1 ? 16 : 800;
    expect(p.scrollBy).toHaveBeenCalledWith(2 * unit, 3 * unit);
    expect(p.applyZoom).not.toHaveBeenCalled();
  });
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
    toolState: { tool: "pen" },
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
    setHand: record("setHand"),
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
    expect(press("y", { ctrl: true })).toEqual({ ...TAKEN, calls: ["redo"] });
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
    for (const key of ["x", "Tab", "Enter", "9", "ArrowLeft", "Escape", "Delete"]) {
      expect(press(key)).toEqual(PASSED);
    }
  });

  it("holds the hand with space, except on a button or in a text box (FineNotes#7)", () => {
    expect(press(" ")).toEqual({ ...TAKEN, calls: ["setHand(true)"] });
    expect(press(" ", {}, { editingText: true })).toEqual(PASSED);
    const button = { closest: (selector: string) => (selector.includes("button") ? {} : null) };
    expect(press(" ", {}, {}, button)).toEqual(PASSED);
  });

  it("lets go of the hand when space comes up, and only then", () => {
    const classes = new Set<string>();
    const scrollEl = {
      toggleClass: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)),
      addClass: (name: string) => classes.add(name),
      removeClass: (name: string) => classes.delete(name),
    };
    const surface = surfaceWith({ handHeld: false, scrollEl });
    run(surface, "setHand", true);
    expect(classes.has("is-hand")).toBe(true);
    run(surface, "handleKeyUp", { key: "x" });
    expect(surface.handHeld).toBe(true);
    classes.add("is-hand-dragging");
    run(surface, "handleKeyUp", { key: " " });
    expect(surface.handHeld).toBe(false);
    expect([...classes]).toEqual([]);
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

// --- The user's shortcut table ----------------------------------------------------

/** A key press on a surface that reads `table` instead of `keyOutcome`. */
function tablePress(key: string, mods: Mods, table: ShortcutTable) {
  const calls: string[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]): void => {
      calls.push(args.length > 0 ? `${name}(${args.map(String).join(",")})` : name);
    };
  const surface = surfaceWith({
    toolState: { tool: "pen" },
    callbacks: {
      onChange: () => {},
      onToolChange: record("onToolChange"),
      shortcuts: () => table,
      onShortcutAction: record("onShortcutAction"),
    },
    editingTextView: () => null,
    clipboardKey: () => false,
    liveImageSelection: () => null,
    liveSelection: () => null,
    undo: record("undo"),
    redo: record("redo"),
    deleteSelection: record("deleteSelection"),
    nextPage: record("nextPage"),
    previousPage: record("previousPage"),
    zoomIn: record("zoomIn"),
    zoomOut: record("zoomOut"),
    resetView: record("resetView"),
    paste: record("paste"),
    copySelection: record("copySelection"),
    hasSelection: () => true,
    setTool: record("setTool"),
    setHand: record("setHand"),
  });
  let prevented = false;
  const event = {
    key,
    metaKey: mods.meta === true,
    ctrlKey: mods.ctrl === true,
    shiftKey: mods.shift === true,
    altKey: mods.alt === true,
    target: null,
    preventDefault: () => {
      prevented = true;
    },
  };
  const taken = run<boolean>(surface, "handleKeyDown", event);
  return { taken, prevented, calls, surface };
}

const noKeys = { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };

const keyOf = (value: string, ...mods: Array<"Mod" | "Alt" | "Shift">) => ({
  type: "key" as const,
  key: value,
  mods,
});

describe("the user's shortcut table", () => {
  it("runs a row's action from its recorded key", () => {
    const table = shortcutTable(withShortcut({}, "edit.undo", keyOf("u"), "press"));
    expect(tablePress("u", {}, table)).toMatchObject({
      taken: true,
      prevented: false,
      calls: ["undo"],
    });
    // The key Undo no longer uses is taken away, not handed to the built-in one.
    expect(tablePress("z", { meta: true }, table)).toMatchObject({
      taken: true,
      prevented: true,
      calls: [],
    });
  });

  it("switches a tool from a recorded key, as its letter did", () => {
    const table = shortcutTable(withShortcut({}, "tool.eraser", keyOf("k"), "press"));
    expect(tablePress("k", {}, table)).toMatchObject({
      taken: true,
      prevented: false,
      calls: ["setTool(eraser)", "onToolChange(eraser)"],
    });
    expect(tablePress("e", {}, table)).toMatchObject({ taken: true, prevented: true, calls: [] });
  });

  /**
   * A surface whose `setTool` really puts the tool in hand, so a test reads
   * what a press would then draw with: its gesture and its ink.
   */
  function holding(table: ShortcutTable) {
    const calls: string[] = [];
    const toolState = { tool: "pen", color: "#112233", shapeColor: "#ff0000" };
    const surface = surfaceWith({
      toolState,
      practice: null,
      pressing: false,
      pendingHeldTool: null,
      heldShortcut: null,
      pressTool: null,
      callbacks: {
        onChange: () => {},
        onToolChange: (tool: string) => calls.push(`onToolChange(${tool})`),
        shortcuts: () => table,
      },
      editingTextView: () => null,
      setTool: (tool: string) => {
        calls.push(`setTool(${tool})`);
        toolState.tool = tool;
      },
      setHand: (on: boolean) => calls.push(`setHand(${on})`),
    });
    const key = (type: "keydown" | "keyup", value: string, mods: Mods = {}) => {
      const event = {
        key: value,
        metaKey: mods.meta === true,
        ctrlKey: mods.ctrl === true,
        shiftKey: mods.shift === true,
        altKey: mods.alt === true,
        target: null,
        preventDefault: () => {},
      };
      if (type === "keydown") run(surface, "handleKeyDown", event);
      else run(surface, "handleKeyUp", event);
    };
    return { surface, toolState, calls, key };
  }

  it("holds the highlighter: its gesture and its ink while the key is down, the pen after", () => {
    const { surface, toolState, calls, key } = holding(
      shortcutTable(withShortcut({}, "tool.highlighter", keyOf("r"), "hold")),
    );
    key("keydown", "r");
    expect(toolState.tool).toBe("highlighter");
    expect(run(surface, "gestureTool")).toBe("highlighter");
    // The stroke a press now commits is highlighter ink, not the pen's.
    expect(run<{ tool: string }>(surface, "currentStyle").tool).toBe("highlighter");
    key("keydown", "r"); // the key repeating changes nothing
    key("keyup", "r");
    expect(toolState.tool).toBe("pen");
    expect(run<{ tool: string }>(surface, "currentStyle").tool).toBe("pen");
    expect(calls).toEqual([
      "setTool(highlighter)",
      "onToolChange(highlighter)",
      "setTool(pen)",
      "onToolChange(pen)",
    ]);
  });

  it("holds Shapes with the Shape tool's own colour", () => {
    const { surface, key } = holding(
      shortcutTable(withShortcut({}, "tool.shape", keyOf("r"), "hold")),
    );
    key("keydown", "r");
    expect(run(surface, "gestureTool")).toBe("shape");
    expect(run(surface, "strokeColor")).toBe("#ff0000");
  });

  it("holds the eraser: a press erases, and the pen comes back on the key-up", () => {
    const { surface, toolState, key } = holding(
      shortcutTable(withShortcut({}, "tool.eraser", keyOf("r"), "hold")),
    );
    key("keydown", "r");
    expect(surface.heldShortcut).toEqual({
      key: "r",
      pointerId: null,
      bit: 0,
      mod: false,
      tool: "eraser",
      back: "pen",
    });
    expect(run(surface, "gestureTool")).toBe("eraser");
    key("keyup", "r");
    expect(surface.heldShortcut).toBeNull();
    expect(toolState.tool).toBe("pen");
  });

  it("waits for the pen to lift before switching either way", () => {
    const { surface, toolState, key } = holding(
      shortcutTable(withShortcut({}, "tool.highlighter", keyOf("r"), "hold")),
    );
    surface.pressing = true;
    key("keydown", "r");
    // The stroke under way stays the pen's to the end.
    expect(toolState.tool).toBe("pen");
    run(surface, "pressEnded");
    expect(toolState.tool).toBe("highlighter");
    surface.pressing = true;
    key("keyup", "r");
    expect(toolState.tool).toBe("highlighter");
    run(surface, "pressEnded");
    expect(toolState.tool).toBe("pen");
  });

  it("lets go of a tool held with Cmd when Cmd comes up, as Apple sends no other key-up", () => {
    const { surface, toolState, key } = holding(
      shortcutTable(withShortcut({}, "tool.select", keyOf("j", "Mod"), "hold")),
    );
    key("keydown", "j", { meta: true });
    expect(toolState.tool).toBe("select");
    key("keyup", "Meta");
    expect(surface.heldShortcut).toBeNull();
    expect(toolState.tool).toBe("pen");
  });

  it("keeps the tool already in hand when its own key is held", () => {
    const { surface, calls, key } = holding(
      shortcutTable(withShortcut({}, "tool.pen", keyOf("r"), "hold")),
    );
    key("keydown", "r");
    key("keyup", "r");
    expect(surface.heldShortcut).toBeNull();
    expect(calls).toEqual([]);
  });

  it("lets go of a held tool when the window loses focus", () => {
    const table = shortcutTable(withShortcut({}, "tool.pan", keyOf("k"), "hold"));
    const pressed = tablePress("k", {}, table);
    expect(pressed.calls).toEqual(["setHand(true)"]);
    run(pressed.surface, "releaseHeldShortcuts");
    expect(pressed.surface.heldShortcut).toBeNull();
    expect(pressed.calls).toEqual(["setHand(true)", "setHand(false)"]);
  });

  it("does nothing at all for two rows that share an input", () => {
    const table = shortcutTable(withShortcut({}, "edit.undo", keyOf("p"), "press"));
    // P is the pen's; W is the pen's other key. Both are paused together.
    expect(tablePress("p", {}, table)).toMatchObject({ taken: true, prevented: true, calls: [] });
    expect(tablePress("w", {}, table)).toMatchObject({ taken: true, prevented: true, calls: [] });
  });

  it("takes away the built-in keys of a row the user cleared", () => {
    const table = shortcutTable(withShortcut({}, "tool.pen", null, "press"));
    expect(tablePress("p", {}, table)).toMatchObject({ taken: true, prevented: true, calls: [] });
    expect(tablePress("w", {}, table)).toMatchObject({ taken: true, prevented: true, calls: [] });
  });

  it("lets a recorded context row act without the screen's Delete, Copy or Paste", () => {
    const table = shortcutTable(withShortcut({}, "edit.copy", keyOf("k", "Mod"), "press"));
    expect(tablePress("k", { meta: true }, table)).toMatchObject({
      taken: true,
      prevented: true,
      calls: ["copySelection"],
    });
  });

  it("leaves the pen's side button to its own setting, lending only what has a gesture", () => {
    const barrel = { pointerType: "pen", button: 2, buttons: 2, ...noKeys };
    const surface = surfaceWith({
      practice: null,
      cellEdit: null,
      editingTextView: () => null,
      heldShortcut: null,
      callbacks: { shortcuts: () => shortcutTable(), barrelAction: () => "lasso" },
    });
    expect(run(surface, "pressOverrideOf", barrel)).toBe("select");
    // Set to move the page, the press route pans it; the stroke path borrows nothing.
    surface.callbacks = { shortcuts: () => shortcutTable(), barrelAction: () => "pan" };
    expect(run(surface, "pressOverrideOf", barrel)).toBeNull();
  });
});

describe("buttons in the user's shortcut table", () => {
  const right = { type: "button" as const, button: 2, mods: [] };
  const side = { ...right, pen: true };

  /** A window that keeps its listeners, so a test can send the pointer's later events. */
  function fakeWindow() {
    const listeners = new Map<string, Set<(event: unknown) => void>>();
    return {
      addEventListener: (type: string, handler: (event: unknown) => void) => {
        const set = listeners.get(type) ?? new Set();
        set.add(handler);
        listeners.set(type, set);
      },
      removeEventListener: (type: string, handler: (event: unknown) => void) => {
        listeners.get(type)?.delete(handler);
      },
      emit: (type: string, event: unknown) => {
        for (const handler of [...(listeners.get(type) ?? [])]) handler(event);
      },
      get listening() {
        return [...listeners.values()].reduce((sum, set) => sum + set.size, 0);
      },
    };
  }

  function buttons(table: ShortcutTable, barrel = "erase") {
    const calls: string[] = [];
    const win = fakeWindow();
    const toolState = { tool: "pen", color: "#112233" };
    const surface = surfaceWith({
      toolState,
      practice: null,
      pressing: false,
      pendingHeldTool: null,
      heldShortcut: null,
      pressTool: null,
      cellEdit: null,
      heldText: null,
      stylusMenuUntil: 0,
      buttonShortcutUntil: 0,
      disposers: [],
      surfaceEl: { ownerDocument: { defaultView: win } },
      callbacks: {
        onChange: () => {},
        onToolChange: (tool: string) => calls.push(`onToolChange(${tool})`),
        onStylusClick: () => calls.push("onStylusClick"),
        stylusClick: () => "pen-menu",
        shortcuts: () => table,
        barrelAction: () => barrel,
      },
      editingTextView: () => null,
      undo: () => calls.push("undo"),
      setTool: (tool: string) => {
        calls.push(`setTool(${tool})`);
        toolState.tool = tool;
      },
      setHand: (on: boolean) => calls.push(`setHand(${on})`),
    });
    const press = (pointerType: string, button: number, held: number, pointerId = 1) => {
      const event = {
        pointerType,
        button,
        buttons: held,
        pointerId,
        ...noKeys,
        prevented: false,
        stopped: false,
        preventDefault() {
          this.prevented = true;
        },
        stopImmediatePropagation() {
          this.stopped = true;
        },
      };
      run(surface, "onButtonPress", event);
      return event;
    };
    return { surface, toolState, calls, win, press };
  }

  it("runs a row from a right click, draws nothing and opens no menu", () => {
    const { surface, calls, press } = buttons(
      shortcutTable(withShortcut({}, "edit.undo", right, "press")),
    );
    const event = press("mouse", 2, 2);
    expect(calls).toEqual(["undo"]);
    expect(event.prevented).toBe(true);
    expect(event.stopped).toBe(true);
    // The page's own right click menu stays shut.
    expect(surface.stylusMenuUntil).toBeGreaterThan(0);
  });

  it("leaves a press with no button bound, a left click or the pen's tip alone", () => {
    const { calls, press } = buttons(shortcutTable(withShortcut({}, "edit.undo", right, "press")));
    for (const event of [press("mouse", 0, 1), press("pen", 0, 1), press("touch", 0, 1)]) {
      expect(event.prevented).toBe(false);
      expect(event.stopped).toBe(false);
    }
    const middle = press("mouse", 1, 4);
    expect(middle.stopped).toBe(false);
    expect(calls).toEqual([]);
  });

  it("holds the highlighter on the side button: the touching pen writes it, the pen after", () => {
    const { surface, toolState, calls, win, press } = buttons(
      shortcutTable(withShortcut({}, "tool.highlighter", side, "hold")),
    );
    // The pen touches down with its side button held (a driver reporting button 0).
    const event = press("pen", 0, 3, 7);
    expect(event.stopped).toBe(false);
    expect(toolState.tool).toBe("highlighter");
    // The side button's own setting (erase) lends nothing over it.
    expect(run(surface, "pressOverrideOf", event)).toBeNull();
    // Still held while the pen moves with the button down; another pointer is no matter.
    win.emit("pointermove", { type: "pointermove", pointerId: 7, buttons: 3 });
    win.emit("pointerup", { type: "pointerup", pointerId: 9, buttons: 0 });
    expect(toolState.tool).toBe("highlighter");
    // Letting the button go gives the pen back, and nothing is left listening.
    win.emit("pointermove", { type: "pointermove", pointerId: 7, buttons: 1 });
    expect(toolState.tool).toBe("pen");
    expect(surface.heldShortcut).toBeNull();
    expect(win.listening).toBe(0);
    expect(calls).toEqual([
      "setTool(highlighter)",
      "onToolChange(highlighter)",
      "setTool(pen)",
      "onToolChange(pen)",
    ]);
  });

  it("lends a held tool on a right button until it comes up", () => {
    const { toolState, win, press } = buttons(
      shortcutTable(withShortcut({}, "tool.eraser", right, "hold")),
    );
    const event = press("mouse", 2, 2, 3);
    expect(event.prevented).toBe(true);
    expect(toolState.tool).toBe("eraser");
    win.emit("pointerup", { type: "pointerup", pointerId: 3, buttons: 0 });
    expect(toolState.tool).toBe("pen");
  });

  it("does nothing for a button two rows share", () => {
    const table = shortcutTable(
      withShortcut(withShortcut({}, "edit.undo", right, "press"), "tool.eraser", side, "press"),
    );
    const { calls, press } = buttons(table);
    const event = press("pen", 2, 2);
    expect(calls).toEqual([]);
    expect(event.stopped).toBe(true);
  });

  it("runs a side button's click in the air instead of the pen menu, once", () => {
    const bound = buttons(shortcutTable(withShortcut({}, "edit.undo", side, "press")));
    run(bound.surface, "stylusClicked", 10, 20);
    expect(bound.calls).toEqual(["undo"]);
    // Its press already ran it: the click that follows is no second run.
    bound.press("pen", 2, 2);
    run(bound.surface, "stylusClicked", 10, 20);
    expect(bound.calls).toEqual(["undo", "undo"]);
    // Nobody recorded it: the pen menu, as before.
    const free = buttons(shortcutTable());
    run(free.surface, "stylusClicked", 10, 20);
    expect(free.calls).toEqual(["onStylusClick"]);
  });

  it("listens for the side button's click when it is bound, whatever the click setting says", () => {
    const { surface } = buttons(shortcutTable(withShortcut({}, "edit.undo", side, "press")));
    surface.callbacks = { ...(surface.callbacks as object), stylusClick: () => "none" };
    expect(run(surface, "stylusClickWanted")).toBe(true);
    surface.callbacks = { ...(surface.callbacks as object), shortcuts: () => shortcutTable() };
    expect(run(surface, "stylusClickWanted")).toBe(false);
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
      "\ncur mv=0 pts=0 gap=0ms maxP=0.00\nΣ dn=0 up=0 cx=0 commit=2\nshape -\n- p=0.00 page=2\ntilt - src=none\nGEOMETRY",
    );
  });

  it("logs a stroke: its events, its moves and samples, the longest gap and top pressure", () => {
    const h = hud();
    for (const r of strokeRecords(100)) h.record(r);
    expect(h.text()).toBe(
      "dn m·3 up\ncur mv=3 pts=6 gap=17ms maxP=0.80\nΣ dn=1 up=1 cx=0 commit=2\nshape -\npen p=0.00 page=2\ntilt - src=none\nGEOMETRY",
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
      "dn m·3 up dn m·1 cx\ncur mv=1 pts=4 gap=5ms maxP=0.10\nΣ dn=2 up=1 cx=1 commit=2\nshape -\ntouch p=0.10 page=2\ntilt - src=none\nGEOMETRY",
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
      "\ncur mv=3 pts=6 gap=17ms maxP=0.80\nΣ dn=0 up=0 cx=0 commit=2\nshape -\npen p=0.00 page=2\ntilt - src=none\nGEOMETRY",
    );
  });

  it("switched off, hides and counts nothing more", () => {
    const h = hud();
    h.setDebug(false);
    expect(h.hidden()).toBe(true);
    for (const r of strokeRecords(0)) h.record(r);
    h.setDebug(true);
    expect(h.text()).toBe(
      "\ncur mv=0 pts=0 gap=0ms maxP=0.00\nΣ dn=0 up=0 cx=0 commit=2\nshape -\n- p=0.00 page=2\ntilt - src=none\nGEOMETRY",
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
    eraseGrey: false,
    eraseGreyCuts: new Map(),
    eraseDirty: new Set(),
    eraseLast: null,
    erasePreview: new Map(),
    eraseRuled: new Map(),
    eraseMirrors: null,
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

  it("re-reads only the pages it erased on, and has them right in the index", () => {
    const w = ink(twoPages());
    const index = w.surface.strokeIndex as StrokeIndex;
    const rebuild = vi.spyOn(index, "rebuild");
    (w.surface.eraseIds as Set<string>).add("s2").add("s4");
    w.lift(0);
    expect(rebuild).not.toHaveBeenCalled();
    expect(w.strokeAt(0, 50, 100)).toBeNull();
    expect(w.strokeAt(1, 50, 10)).toBeNull();
    expect(w.strokeAt(1, 50, 100)?.id).toBe("s5");
    expect(w.strokeAt(0, 50, 10)?.id).toBe("s1");
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

describe("ruled erase", () => {
  /** Page 1 ruled wide (rules at 40, 80, 120 …): "dolor," on line 2, "below" on line 3. */
  function ruledInk(kind: "ruled-wide" | "blank" = "ruled-wide", extra: Stroke[] = []) {
    const doc = documentOf(
      page("p1", [
        line("dolor", 100, 160, 115),
        {
          id: "comma",
          color: "#000000",
          size: 2,
          tool: "pen",
          pts: [163, 121, 0.5, 161, 133, 0.5],
        },
        line("below", 100, 160, 155),
        ...extra,
      ]),
    );
    doc.pages[0].backdrop = { kind };
    const w = ink(doc);
    const flashes: string[] = [];
    Object.assign(w.surface, { flashReadout: (t: string) => flashes.push(t) });
    let ruled: unknown = null;
    const start = (x: number, y: number): void => {
      ruled = run(w.surface, "ruledFor", doc.pages[0], { x, y }, "all", true);
    };
    const dab = (x: number, y: number): boolean =>
      run<boolean>(w.surface, "eraseRuledAt", doc.pages[0], ruled, { x, y }, 4);
    const pass = (): unknown => (w.surface.eraseRuled as Map<string, unknown>).get(doc.pages[0].id);
    return { ...w, flashes, start, dab, pass };
  }

  it("takes the word with its comma, and leaves the next line, in one undo step", () => {
    const w = ruledInk();
    w.start(100, 112);
    for (const x of [100, 130, 160, 165]) w.dab(x, 112);
    expect([...w.marked()].sort()).toEqual(["comma", "dolor"]);
    w.lift(0);
    expect(ids(w.doc.pages[0])).toEqual(["below"]);
    w.undo();
    expect(ids(w.doc.pages[0])).toEqual(["dolor", "comma", "below"]);
  });

  it("cuts a straightened highlight to the erased word, in the same undo step", () => {
    const highlight: Stroke = {
      id: "hl",
      color: "#ffd43b",
      size: 20,
      tool: "highlighter",
      shape: "line",
      pts: [90, 110, 0.5, 400, 110, 0.5],
    };
    const w = ruledInk("ruled-wide", [highlight]);
    w.start(100, 112);
    for (const x of [100, 130, 165]) w.dab(x, 112);
    // The word goes whole; the highlight is not marked, only cut.
    expect([...w.marked()].sort()).toEqual(["comma", "dolor"]);
    const pieces = w.pieces().get("hl") ?? [];
    // What lay under the pass and "dolor," (96..169) goes, and 10 more for
    // the band's round cap.
    expect(pieces.map((p) => [p.pts[0], p.pts[p.pts.length - 3]])).toEqual([[179, 400]]);
    expect(pieces[0].shape).toBe("line");
    w.lift(0);
    expect(ids(w.doc.pages[0])).toEqual(["below", pieces[0].id]);
    w.undo();
    expect(ids(w.doc.pages[0])).toEqual(["dolor", "comma", "below", "hl"]);
  });

  it("on a page without lines, says so and leaves the pass to the standard eraser", () => {
    const w = ruledInk("blank");
    w.start(100, 112);
    expect(w.pass()).toBeNull();
    expect(w.flashes).toEqual(["No lines on this page: erasing normally"]);
  });

  it("forgets the pass when the eraser lifts", () => {
    const w = ruledInk();
    w.start(100, 112);
    expect(w.pass()).not.toBeNull();
    w.lift(0);
    expect(w.pass()).toBeUndefined();
  });

  it("greyed, draws the cut stretch grey beside what survives, and commits only that", () => {
    const highlight: Stroke = {
      id: "hl",
      color: "#ffd43b",
      size: 20,
      tool: "highlighter",
      shape: "line",
      pts: [90, 110, 0.5, 400, 110, 0.5],
    };
    const w = ruledInk("ruled-wide", [highlight]);
    w.surface.eraseGrey = true;
    w.start(100, 112);
    for (const x of [100, 130, 165]) w.dab(x, 112);
    const cuts = w.surface.eraseGreyCuts as Map<string, Stroke[]>;
    const grey = cuts.get("hl") ?? [];
    // The grey stretch is what the cut takes, from the highlight's own end at
    // 90 up to where the survivor's round end begins: 179 less half its width.
    expect(grey.map((p) => [p.id, p.pts[0], p.pts[p.pts.length - 3]])).toEqual([
      ["hl~erasing0", 90, 169],
    ]);
    const survivor = (w.pieces().get("hl") ?? [])[0];

    // What the renderer is handed: the words and the stretch grey, nothing hidden.
    const calls: unknown[][] = [];
    w.surface.renderer = { renderDocument: (...args: unknown[]) => calls.push(args) };
    run(w.surface, "renderDry");
    const [, , hidden, , replaced, , , greyed] = calls[0] as [
      unknown,
      unknown,
      unknown,
      unknown,
      Map<string, Stroke[]>,
      unknown,
      unknown,
      Set<string>,
    ];
    expect(hidden).toBeUndefined();
    expect(replaced.get("hl")?.map((p) => p.id)).toEqual(["hl~erasing0", survivor.id]);
    expect([...greyed].sort()).toEqual(["comma", "dolor", "hl~erasing0"]);

    w.lift(0);
    expect(ids(w.doc.pages[0])).toEqual(["below", survivor.id]);
    expect((w.surface.eraseGreyCuts as Map<string, Stroke[]>).size).toBe(0);
  });

  it("not greyed, hides the words and draws only what survives", () => {
    const w = ruledInk();
    w.start(100, 112);
    for (const x of [100, 130, 165]) w.dab(x, 112);
    const calls: unknown[][] = [];
    w.surface.renderer = { renderDocument: (...args: unknown[]) => calls.push(args) };
    run(w.surface, "renderDry");
    expect([...(calls[0][2] as Set<string>)].sort()).toEqual(["comma", "dolor"]);
    expect(calls[0][7]).toBeUndefined();
  });
});

describe("selecting by line", () => {
  it("takes ink by its line, commas with their words, and pictures and text boxes by their frames", async () => {
    const { writingLines } = await import("../../src/canvas/backdrop");
    const { lineSpan } = await import("../../src/canvas/ruled-ink");
    const p = page("p1", [
      line("before", 20, 80, 115), // line 2, left of the start
      line("dolor", 100, 160, 115), // line 2
      { id: "comma", color: "#000000", size: 2, tool: "pen", pts: [163, 121, 0.5, 161, 133, 0.5] },
      line("whole", 20, 900, 155), // line 3
      line("after", 300, 400, 195), // line 4, past the end
    ]);
    p.backdrop = { kind: "ruled-wide" };
    p.images = [{ id: "i1", path: "a.png", x: 30, y: 168, w: 40, h: 30 }]; // line 4, centre 50
    p.textBoxes = [{ id: "t1", x: 500, y: 92, w: 80, text: "x", color: "#000", fontSize: 16 }];
    const blocks = writingLines(p.backdrop, p.geometry);
    let picked: { strokes: Stroke[]; images: unknown[]; textBoxes: unknown[] } | null = null;
    const surface = surfaceWith({
      toolState: { tool: "select" },
      pageAt: () => p,
      textBoxFrameOf: () => ({ x: 500, y: 92, w: 80, h: 24 }),
      select: (_id: string, els: typeof picked) => (picked = els),
    });
    const span = lineSpan(blocks, { x: 90, y: 112 }, { x: 250, y: 190 });
    run(surface, "selectOnLines", { index: 0 }, blocks, span);
    expect(picked!.strokes.map((s) => s.id)).toEqual(["dolor", "comma", "whole"]);
    expect(picked!.images).toHaveLength(1);
    expect(picked!.textBoxes).toHaveLength(1);
  });
});

describe("insert space from the margin", () => {
  async function marginDrag(dy: number, inkAbove = false) {
    const { writingLines } = await import("../../src/canvas/backdrop");
    const p = page("p1", [
      ...(inkAbove ? [line("above", 100, 160, 75)] : []),
      line("at", 100, 160, 115),
      line("below", 100, 160, 195),
    ]);
    p.backdrop = { kind: "ruled-wide" };
    const doc = documentOf(p);
    const applied: unknown[] = [];
    const flashes: string[] = [];
    const surface = surfaceWith({
      doc,
      pressTimer: 0,
      renderer: null,
      activePage: null,
      pageAt: () => p,
      textBoxFrameOf: () => ({ x: 0, y: 0, w: 0, h: 0 }),
      flashReadout: (t: string) => flashes.push(t),
      applyCommand: (c: { apply(d: InkDocument): void }) => {
        applied.push(c);
        c.apply(doc);
      },
    });
    surface.lasso = {
      box: { index: 0 },
      mode: "lines",
      origin: { x: 10, y: 112 },
      to: { x: 10, y: 112 + dy },
      held: false,
      lines: writingLines(p.backdrop, p.geometry),
      space: { target: { block: 0, line: 2 }, count: 0, plan: null, text: "" },
    };
    run(surface, "dragSpace", surface.lasso, (surface.lasso as State).space);
    run(surface, "selectEnd");
    return { p, applied, flashes };
  }

  it("a drag of two lines moves the line and what is below it down by two", async () => {
    const { p, applied, flashes } = await marginDrag(78);
    expect(applied).toHaveLength(1);
    expect(p.strokes.map((s) => s.pts[1])).toEqual([195, 275]);
    expect(flashes.at(-1)).toBe("Insert 2 lines");
  });

  it("a drag up closes the empty lines above, as many as there are", async () => {
    const { p, applied, flashes } = await marginDrag(-120);
    expect(applied).toHaveLength(1);
    expect(p.strokes.map((s) => s.pts[1])).toEqual([35, 115]);
    expect(flashes.at(-1)).toBe("Remove 2 lines");
  });

  it("a drag up right under ink removes nothing, and says so", async () => {
    const { applied, flashes } = await marginDrag(-40, true);
    expect(applied).toHaveLength(0);
    expect(flashes.at(-1)).toBe("No empty lines to remove here");
  });

  it("a drag that ends where it began does nothing", async () => {
    const { applied } = await marginDrag(5);
    expect(applied).toHaveLength(0);
  });
});

describe("spaceReadout", () => {
  it("says what the drag will do", async () => {
    const { spaceReadout } = await import("../../src/view/ink-surface");
    const plan = { command: null, moved: 1, spilled: 0, addedPages: 0 };
    expect(spaceReadout({ ...plan, lines: 1 })).toBe("Insert 1 line");
    expect(spaceReadout({ ...plan, lines: -3 })).toBe("Remove 3 lines");
    expect(spaceReadout({ ...plan, lines: 2, spilled: 2, addedPages: 1 })).toBe(
      "Insert 2 lines · some ink moves to the next page · adds a page",
    );
    expect(spaceReadout({ ...plan, lines: 2, spilled: 2, addedPages: 2 })).toContain("adds pages");
  });
});

describe("Add to contents on a selection", () => {
  it("offers the heading's left and middle to the host, and lets the selection go", () => {
    const p = page("p1", [line("h", 100, 300, 115)]);
    const doc = documentOf(blankPage("p0"), p);
    const added: unknown[] = [];
    let cleared = 0;
    const surface = surfaceWith({
      doc,
      palette: [],
      toolState: {},
      callbacks: { onAddSection: (...args: unknown[]) => added.push(args) },
      groupBounds: () => ({ minX: 100, minY: 105, maxX: 300, maxY: 125 }),
      pasteAction: () => ({ id: "paste", icon: "", label: "Paste", group: "edit" }),
      clearSelection: () => cleared++,
    });
    const sel = { pageId: "p1", strokes: p.strokes, images: [], textBoxes: [] };
    const actions = run<Array<{ id: string; run?: () => void }>>(surface, "groupActions", sel);
    const add = actions.find((a) => a.id === "contents");
    add?.run?.();
    expect(added).toEqual([[1, { x: 100, y: 115 }, ["h"]]]);
    expect(cleared).toBe(1);
  });

  it("sits above Link to under Turn into, with Comment after it, and Delete last", () => {
    const p = page("p1", [line("h", 100, 300, 115)]);
    const comments: unknown[] = [];
    const surface = surfaceWith({
      doc: documentOf(p),
      palette: [],
      toolState: {},
      callbacks: {
        onAddSection: () => undefined,
        onLinkStrokes: () => undefined,
        onAddComment: (...args: unknown[]) => comments.push(args),
      },
      groupBounds: () => ({ minX: 100, minY: 105, maxX: 300, maxY: 125 }),
      pasteAction: () => ({ id: "paste", icon: "", label: "Paste", group: "edit" }),
      shapeStyleActions: () => [],
      clearSelection: () => undefined,
    });
    const sel = { pageId: "p1", strokes: p.strokes, images: [], textBoxes: [] };
    const actions = run<SelectionAction[]>(surface, "groupActions", sel);
    const { rows } = menuLayout(actions);
    const turn = rows.find((r) => r.kind === "submenu");
    const into = turn?.kind === "submenu" ? turn.actions.map((a) => a.id) : [];
    expect(into.indexOf("contents")).toBeLessThan(into.indexOf("link"));
    expect(into.indexOf("link")).toBeLessThan(into.indexOf("comment"));
    // The flips are one segmented row with the style; Delete is the menu's foot.
    const flip = rows.find((r) => r.kind === "segments" && r.label === "Flip");
    expect(flip?.kind === "segments" && flip.actions.map((a) => a.id)).toEqual([
      "flip-x",
      "flip-y",
    ]);
    const last = rows[rows.length - 1];
    expect(last.kind === "action" && last.action.id).toBe("delete");
    // A comment is pinned at the selection's top-right corner.
    actions.find((a) => a.id === "comment")?.run?.();
    expect(comments).toEqual([[0, { x: 300, y: 105 }]]);
  });

  it("is not offered when the host takes no sections", () => {
    const p = page("p1", [line("h", 100, 300, 115)]);
    const surface = surfaceWith({
      doc: documentOf(p),
      palette: [],
      toolState: {},
      callbacks: {},
      groupBounds: () => ({ minX: 100, minY: 105, maxX: 300, maxY: 125 }),
      pasteAction: () => ({ id: "paste", icon: "", label: "Paste", group: "edit" }),
    });
    const sel = { pageId: "p1", strokes: p.strokes, images: [], textBoxes: [] };
    const actions = run<Array<{ id: string }>>(surface, "groupActions", sel);
    expect(actions.some((a) => a.id === "contents")).toBe(false);
  });
});

describe("Turn into › Text (FineNotes#42)", () => {
  function menuSurface(callbacks: State, sel: State): SelectionAction[] {
    const surface = surfaceWith({
      doc: documentOf(page("p1", sel.strokes as Stroke[])),
      palette: [],
      toolState: {},
      callbacks,
      groupBounds: () => ({ minX: 100, minY: 105, maxX: 300, maxY: 125 }),
      pasteAction: () => ({ id: "paste", icon: "", label: "Paste", group: "edit" }),
      shapeStyleActions: () => [],
      clearSelection: () => undefined,
    });
    return run<SelectionAction[]>(surface, "groupActions", sel);
  }

  it("is first under Turn into, and hands the ink to the host", () => {
    const asked: unknown[] = [];
    const strokes = [line("a", 100, 300, 115), line("b", 100, 300, 140)];
    const sel = { pageId: "p1", strokes, images: [], textBoxes: [] };
    const actions = menuSurface(
      {
        onTurnIntoText: (...args: unknown[]) => asked.push(args),
        onMakeTask: () => undefined,
        onLinkStrokes: () => undefined,
      },
      sel,
    );
    const turn = menuLayout(actions).rows.find((r) => r.kind === "submenu");
    const into = turn?.kind === "submenu" ? turn.actions : [];
    expect(into[0]).toMatchObject({ id: "to-text", icon: "type", label: "Text" });
    into[0].run?.();
    expect(asked).toEqual([[0, ["a", "b"]]]);
  });

  it("is not offered for a selection without ink", () => {
    const box = { id: "t1", x: 0, y: 0, w: 80, text: "hi", color: "#000", fontSize: 22 };
    const sel = { pageId: "p1", strokes: [], images: [], textBoxes: [box] };
    const actions = menuSurface({ onTurnIntoText: () => undefined }, sel);
    expect(actions.some((a) => a.id === "to-text")).toBe(false);
  });

  it("replaces the ink with a selected box in its colour, and undo brings the ink back", () => {
    const blue = { ...line("a", 100, 300, 115), color: "#1d4ed8" };
    const p = page("p1", [line("k", 0, 50, 10), blue]);
    const doc = documentOf(p);
    const history = new History();
    const selected: unknown[] = [];
    const ids = new IdSequence("t");
    const surface = surfaceWith({
      doc,
      history,
      textBoxIds: ids,
      toolState: { textStyle: { color: "#000000", fontSize: 22 } },
      callbacks: {},
      applyCommand: (command: Parameters<History["push"]>[1]) => history.push(doc, command),
      syncTextBoxes: () => undefined,
      select: (...args: unknown[]) => selected.push(args),
    });
    expect(run(surface, "turnInkIntoText", p, ["a"], "  hello ")).toBe(true);
    expect(p.strokes.map((s) => s.id)).toEqual(["k"]);
    expect(p.textBoxes).toHaveLength(1);
    expect(p.textBoxes[0]).toMatchObject({ text: "hello", color: "#1d4ed8", fit: true });
    expect(selected).toEqual([["p1", { strokes: [], images: [], textBoxes: [p.textBoxes[0]] }]]);
    history.undo(doc);
    expect(p.strokes).toEqual([line("k", 0, 50, 10), blue]);
    expect(p.textBoxes).toEqual([]);
    // Blank text, or ink no longer there, changes nothing.
    expect(run(surface, "turnInkIntoText", p, ["a"], " \n ")).toBe(false);
    expect(run(surface, "turnInkIntoText", p, ["gone"], "x")).toBe(false);
    expect(p.textBoxes).toEqual([]);
  });

  it("finds the lasso's ink for the command, and nothing without ink", () => {
    const p = page("p1", [line("a", 100, 300, 115)]);
    let selection: State | null = { pageId: "p1", strokes: p.strokes, images: [], textBoxes: [] };
    const surface = surfaceWith({
      doc: documentOf(blankPage("p0"), p),
      liveSelection: () => selection,
    });
    expect(run(surface, "selectedInk")).toMatchObject({ index: 1, strokeIds: ["a"] });
    selection = { pageId: "p1", strokes: [], images: [], textBoxes: [] };
    expect(run(surface, "selectedInk")).toBeNull();
    selection = null;
    expect(run(surface, "selectedInk")).toBeNull();
  });
});

describe("handwritten links", () => {
  function linked() {
    const p = page("p1", [line("fir", 100, 200, 115), line("rest", 300, 400, 115)]);
    p.links = [{ id: "l1", strokes: ["fir"], target: "Signals#FIR" }];
    const doc = documentOf(p);
    const asked: unknown[] = [];
    const opened: string[] = [];
    const applied: Array<{ apply(d: InkDocument): void }> = [];
    const offered: unknown[] = [];
    const surface = surfaceWith({
      doc,
      baseScale: 1,
      userZoom: 1,
      linkSuggestions: new Map(),
      wordFlags: new Map(),
      callbacks: {
        onLinkStrokes: (...args: unknown[]) => asked.push(args),
        onOpenLink: (target: string) => opened.push(target),
        onSuggestedLink: (...args: unknown[]) => offered.push(args),
      },
      clearSelection: () => {},
      applyCommand: (c: { apply(d: InkDocument): void }) => {
        applied.push(c);
        c.apply(doc);
      },
    });
    const actions = (ids: string[]) =>
      run<Array<{ id: string; label: string; run?: () => void }>>(
        surface,
        "linkActions",
        {
          pageId: "p1",
          strokes: p.strokes.filter((s) => ids.includes(s.id)),
          images: [],
          textBoxes: [],
        },
        0,
      );
    return { p, doc, surface, asked, opened, applied, offered, actions };
  }

  it("offers Link to… for unlinked ink", () => {
    const l = linked();
    const acts = l.actions(["rest"]);
    expect(acts.map((a) => a.label)).toEqual(["Link to…"]);
    acts[0].run?.();
    expect(l.asked).toEqual([[0, ["rest"], null]]);
  });

  it("offers Change, Open and Remove for linked ink", () => {
    const l = linked();
    const acts = l.actions(["fir"]);
    expect(acts.map((a) => a.label)).toEqual(["Change link", "Open link", "Remove link"]);
    acts[0].run?.();
    expect(l.asked).toEqual([[0, ["fir"], "Signals#FIR"]]);
    acts[1].run?.();
    expect(l.opened).toEqual(["Signals#FIR"]);
    acts[2].run?.();
    expect(l.p.links).toBeUndefined();
  });

  it("offers nothing without a host to ask, or without ink", () => {
    const l = linked();
    l.surface.callbacks = {};
    expect(l.actions(["fir"])).toEqual([]);
    const k = linked();
    expect(k.actions([])).toEqual([]);
  });

  it("a finger tap on linked ink, or just under it, opens the link; elsewhere it does not", () => {
    const l = linked();
    const tap = (x: number, y: number) => run<boolean>(l.surface, "openLinkAt", l.p, { x, y }, 6);
    expect(tap(150, 115)).toBe(true);
    expect(tap(150, 125)).toBe(true); // the underline
    expect(tap(350, 115)).toBe(false);
    expect(tap(150, 300)).toBe(false);
    expect(l.opened).toEqual(["Signals#FIR", "Signals#FIR"]);
  });

  it("a finger tap on a [[link]] written by hand offers to link it; linked ink is no longer offered", () => {
    const l = linked();
    run(l.surface, "setLinkSuggestions", "p1", [
      { target: "Systems", strokeIds: ["rest"] },
      { target: "Signals", strokeIds: ["fir"] }, // already linked: not offered
    ]);
    const tap = (x: number, y: number) => run<boolean>(l.surface, "openLinkAt", l.p, { x, y }, 6);
    expect(tap(350, 115)).toBe(true);
    expect(l.offered).toEqual([[0, ["rest"], "Systems"]]);
    expect(tap(150, 115)).toBe(true); // the real link opens, as before
    expect(l.opened).toEqual(["Signals#FIR"]);
    run(l.surface, "setLinkSuggestions", "p1", []);
    expect(tap(350, 115)).toBe(false);
  });
});

describe("erasing a linked word", () => {
  function linkedInk() {
    const doc = twoPages();
    doc.pages[0].links = [{ id: "l1", strokes: ["s1", "s2"], target: "Signals" }];
    return ink(doc);
  }

  it("whole-stroke mode takes every stroke of the link", () => {
    const w = linkedInk();
    expect(w.dab(0, 50, 11)).toBe(true);
    expect([...w.marked()].sort()).toEqual(["s1", "s2"]);
    w.lift(0);
    expect(ids(w.doc.pages[0])).toEqual(["s3"]);
    w.undo();
    expect(ids(w.doc.pages[0])).toEqual(["s1", "s2", "s3"]);
  });

  it("standard mode never cuts it: touching it takes all of it", () => {
    const w = linkedInk();
    expect(w.cut(0, 60, 10)).toBe(true);
    expect(w.pieces().size).toBe(0);
    expect([...w.marked()].sort()).toEqual(["s1", "s2"]);
    expect(w.cut(0, 60, 50)).toBe(false); // nowhere near any ink
  });

  it("a pass that cuts plain ink and takes a linked word is one undo step", () => {
    const w = linkedInk();
    w.cut(0, 60, 200); // the highlighter, not linked: cut
    w.cut(0, 60, 10); // the link: taken whole
    expect([...w.pieces().keys()]).toEqual(["s3"]);
    w.lift(0);
    expect(ids(w.doc.pages[0]).filter((id) => ["s1", "s2"].includes(id))).toEqual([]);
    expect(w.history.canUndo()).toBe(true);
    w.undo();
    expect(ids(w.doc.pages[0])).toEqual(["s1", "s2", "s3"]);
    expect(w.history.canUndo()).toBe(false);
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
    surfaceEl: {
      clientWidth: width,
      clientHeight: height,
      ownerDocument: { visibilityState: "visible" },
    },
    sizeWait: new SizeWait(),
    hudLayouts: 0,
    debug: false,
    callbacks: {},
    reportedSizeScale: null,
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
    p.surface.surfaceEl = { clientWidth: 800, clientHeight: 600, ownerDocument: document };
    run(p.surface, "layout");
    expect(p.resized).toHaveLength(1);
    p.surface.surfaceEl = { clientWidth: 0, clientHeight: 0, ownerDocument: document };
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

// --- The wet stroke (2026-09-30) ---------------------------------------------------

describe("the wet stroke", () => {
  /** A surface in the middle of a stroke, and every set of runs it hands the renderer. */
  function writing(pressure: boolean) {
    const drawn: InkRun[][] = [];
    const builder = new StrokeBuilder({ minDistance: 1, pressureEnabled: pressure });
    const surface = surfaceWith({
      wetFrame: 7,
      wetTracer: null,
      wetRevision: -1,
      builder,
      activePage: { index: 0 },
      snap: null,
      renderer: { renderWetRuns: (_page: number, runs: InkRun[]) => drawn.push(runs) },
      currentStyle: () => ({ color: "#000", size: 3, tool: "pen", usePressure: pressure }),
    });
    const frame = (): InkRun[] => {
      run(surface, "drawWet");
      return drawn[drawn.length - 1];
    };
    return { builder, surface, frame };
  }

  it("draws what the pen kept, and nothing ahead of it", () => {
    const { builder, frame } = writing(false);
    builder.add({ x: 0, y: 0, pressure: 0.5 });
    builder.add({ x: 5, y: 0, pressure: 0.5 });
    // Straight to the pen's last point: the half segment still waits for the next.
    expect(frame()).toEqual([{ width: 3, pts: [0, 0, 2.5, 0, 5, 0] }]);
  });

  it("traces each kept point once, and a finished stroke looks as it did wet", () => {
    const { builder, surface, frame } = writing(true);
    const pts = [0, 0, 0.3, 4, 1, 0.35, 8, 3, 0.45, 12, 2, 0.4, 16, 5, 0.3];
    for (let i = 0; i < pts.length; i += 3) {
      builder.add({ x: pts[i], y: pts[i + 1], pressure: pts[i + 2] });
      frame();
    }
    const tracer = surface.wetTracer as InkTracer;
    expect(tracer.length).toBe(5);
    expect(frame()).toEqual(inkRuns(builder.points(), penOptions(3, true)));
  });

  it("traces the stroke afresh when the first pressure reading rewrites its start", () => {
    const { builder, surface, frame } = writing(true);
    builder.add({ x: 0, y: 0, pressure: 0 }); // no reading yet: the fallback
    frame();
    const first = surface.wetTracer;
    builder.add({ x: 5, y: 0, pressure: 0.2 }); // fills in the point before it
    const runs = frame();
    expect(surface.wetTracer).not.toBe(first);
    expect(runs).toEqual(inkRuns(builder.points(), penOptions(3, true)));
    expect(runs[0].width).toBeCloseTo(2 * 3 * (0.5 - 0.6 * 0.3), 9);
  });
});

describe("a stroke's first pressure", () => {
  function opts(pressureEnabled: boolean, penPressure: number | null): Record<string, unknown> {
    const surface = surfaceWith({
      penPressure,
      toolState: { pressureEnabled },
      atFitZoom: (v: number) => v,
    });
    return run(surface, "builderOpts");
  }

  it("is the last stroke's median until the pen reads its own", () => {
    expect(opts(true, 0.23).fallbackPressure).toBe(0.23);
    expect(opts(true, null).fallbackPressure).toBe(0.5);
    expect(opts(false, 0.23).fallbackPressure).toBe(0.5);
  });
});

describe("smoothing a pen whose positions arrive rounded (FineNotes#1)", () => {
  function opts(rounded: boolean, coalesced: boolean): Record<string, unknown> {
    const surface = surfaceWith({
      penPressure: null,
      toolState: { pressureEnabled: false },
      atFitZoom: (v: number) => v,
      pointerInput: { strokeRounded: rounded },
      coalescedInput: coalesced,
    });
    return run(surface, "builderOpts");
  }

  it("smooths from both sides, and keeps densify where samples are sparse", () => {
    expect(opts(true, false)).toMatchObject({ smoothing: "centred", densify: true });
    expect(opts(true, true)).toMatchObject({ smoothing: "centred", densify: false });
  });

  it("leaves a pen with exact positions alone", () => {
    expect(opts(false, false)).toMatchObject({ smoothing: "off", densify: true });
    expect(opts(false, true)).toMatchObject({ smoothing: "off", densify: false });
  });
});

// --- A Pencil whose contact flickered (2026-10-01) ---------------------------------

// --- Writing over the join of joined pages (discussion #51) ------------------------

describe("commitStroke with the pages joined", () => {
  function joined() {
    const doc = documentOf(page("p1", []), page("p2", []));
    const w = ink(doc);
    const layout = layoutPages(doc.pages, { joined: true });
    Object.assign(w.surface, {
      joined: true,
      board: false,
      pageLayout: layout,
      mirroredStep: null,
    });
    // As the surface keeps it: mirrors out of the index while joined.
    (w.surface.strokeIndex as StrokeIndex).skip = (s) => s.join !== undefined;
    const commit = (stroke: Stroke): unknown =>
      run(w.surface, "commitStroke", layout.boxes[0], doc.pages[0], stroke);
    return { w, doc, layout, commit };
  }

  it("mirrors a stroke over the join on the next page, in its space, in the same undo step", () => {
    const { w, doc, layout, commit } = joined();
    const height = layout.boxes[0].height;
    // Ids come from the surface's sequence, as a drawn stroke's do.
    const id = (w.surface.strokeIds as IdSequence).next();
    const stroke: Stroke = {
      id,
      color: "#000000",
      size: 2,
      tool: "pen",
      pts: [100, height - 50, 0.5, 120, height + 40, 0.5],
      samples: [1, 2, 3, 4],
    };
    commit(stroke);
    const [own] = doc.pages[0].strokes;
    const [mirror] = doc.pages[1].strokes;
    expect(own.join).toBeUndefined();
    expect(mirror.join).toBe(`p1/${id}`);
    expect(mirror.id).toBe(`p1/${id}@p2`);
    expect(mirror.pts).toEqual([100, -50, 0.5, 120, 40, 0.5]);
    expect(mirror.samples).toBeUndefined();
    // No tool acts on a mirror: the index leaves it out.
    expect(w.strokeAt(1, 120, 40)).toBeNull();
    expect(w.history.canUndo()).toBe(true);
    w.undo();
    expect(w.history.canUndo()).toBe(false);
    expect(doc.pages[0].strokes).toEqual([]);
    expect(doc.pages[1].strokes).toEqual([]);
  });

  it("leaves a stroke inside its page alone, and so does a notebook with its pages apart", () => {
    const { w, doc, commit } = joined();
    commit(line("s1", 10, 110, 100));
    expect(doc.pages[0].strokes[0].join).toBeUndefined();
    expect(doc.pages[1].strokes).toEqual([]);
    w.surface.joined = false;
    commit({ ...line("s2", 10, 110, 100), pts: [100, 1400, 0.5, 100, 1500, 0.5] });
    expect(doc.pages[1].strokes).toEqual([]);
  });

  it("a stroke written on a sticky note stays on the note", () => {
    const { doc, layout, commit } = joined();
    const height = layout.boxes[0].height;
    commit({
      ...line("s1", 0, 0, 0),
      pts: [100, height - 5, 0.5, 100, height + 5, 0.5],
      onSticky: "n1",
    });
    expect(doc.pages[1].strokes).toEqual([]);
  });
});

describe("the eraser and the lasso over a join", () => {
  /** Two joined pages; a line from page 1 over the join, mirrored on page 2. */
  function overJoin() {
    const doc = documentOf(page("p1", []), page("p2", []));
    const w = ink(doc);
    const layout = layoutPages(doc.pages, { joined: true });
    Object.assign(w.surface, {
      joined: true,
      board: false,
      pageLayout: layout,
      mirroredStep: null,
      showEraserCursor: () => {},
    });
    (w.surface.strokeIndex as StrokeIndex).skip = (s) => s.join !== undefined;
    const [a, b] = layout.boxes;
    const id = (w.surface.strokeIds as IdSequence).next();
    const owner: Stroke = {
      id,
      color: "#000000",
      size: 2,
      tool: "pen",
      pts: [100, a.height - 60, 0.5, 100, a.height + 60, 0.5],
    };
    run(w.surface, "commitStroke", a, doc.pages[0], owner);
    return { w, doc, a, b, id };
  }

  it("the whole-stroke eraser on the next page takes the owner, and the mirror goes with it", () => {
    const { w, doc, b } = overJoin();
    expect(doc.pages[1].strokes).toHaveLength(1);
    w.surface.toolState = { tool: "eraser", eraserMode: "stroke" };
    w.surface.activePage = b;
    run(w.surface, "eraseAt", b, { x: 100, y: 30 });
    run(w.surface, "eraseCommit");
    expect(doc.pages[0].strokes).toEqual([]);
    expect(doc.pages[1].strokes).toEqual([]);
    w.undo();
    expect(doc.pages[0].strokes).toHaveLength(1);
    expect(doc.pages[1].strokes).toHaveLength(1);
  });

  it("the standard eraser on the next page cuts the owner, and the mirror follows", () => {
    const { w, doc, b } = overJoin();
    w.surface.toolState = { tool: "eraser", eraserMode: "standard" };
    w.surface.activePage = b;
    run(w.surface, "eraseAt", b, { x: 100, y: 30 });
    run(w.surface, "eraseCommit");
    // Two pieces on page 1, both still reaching over the join (the cut is
    // below it), each mirrored on page 2; the erased stretch is on neither.
    const pieces = doc.pages[0].strokes;
    expect(pieces).toHaveLength(2);
    expect(doc.pages[1].strokes.map((s) => s.join)).toEqual(pieces.map((p) => `p1/${p.id}`));
  });

  it("a lasso on the next page picks up the owner onto its page, taken back when unused", () => {
    const { w, doc, b, id } = overJoin();
    w.surface.toolState = { tool: "select" };
    Object.assign(w.surface, {
      select: (pageId: string, lists: { strokes: Stroke[] }) => {
        w.surface.selection = { pageId, ...lists };
      },
      selection: null,
      textBoxFrameOf: () => ({ x: 0, y: 0, w: 0, h: 0 }),
      tableFrameOf: () => ({ x: 0, y: 0, w: 0, h: 0 }),
      syncTextBoxes: () => {},
      renderer: { invalidateAll: () => {}, invalidateRegion: () => {} },
      clearSelection: () => run(w.surface, "dropPickUp"),
      renderDry: () => true,
    });
    run(w.surface, "selectInside", b, [50, -100, 150, -100, 150, 100, 50, 100]);
    const sel = w.surface.selection as { pageId: string; strokes: Stroke[] };
    expect(sel.pageId).toBe("p2");
    expect(sel.strokes.map((s) => s.id)).toEqual([id]);
    expect(doc.pages[1].strokes.find((s) => s.id === id)?.pts).toEqual([
      100, -60, 0.5, 100, 60, 0.5,
    ]);
    // Its mirror now lies on page 1, where the line starts.
    expect(doc.pages[0].strokes.map((s) => s.join)).toEqual([`p2/${id}`]);
    run(w.surface, "dropPickUp");
    expect(doc.pages[0].strokes.map((s) => s.id)).toEqual([id]);
    expect(w.history.latest?.label).toBe("Add stroke");
  });
});

describe("resumeLifted", () => {
  /** A page with one stroke just committed, lifted at (40, 10) a moment ago. */
  function lifted(liftedMsAgo = 10, style: Partial<Stroke> = {}) {
    const w = ink(documentOf(page("p1", [line("s1", 10, 110, 100)])));
    const builder = new StrokeBuilder({ minDistance: 1, pressureEnabled: false });
    builder.add({ x: 10, y: 10, pressure: 0 });
    builder.addFinal({ x: 40, y: 10, pressure: 0 });
    const stroke: Stroke = { ...line("s2", 10, 40, 10), ...style };
    const command = run(w.surface, "commitStroke", boxOf(w.doc, 0), w.doc.pages[0], stroke);
    Object.assign(w.surface, {
      lastLift: {
        t: performance.now() - liftedMsAgo,
        boxIndex: 0,
        pageId: "p1",
        x: 40,
        y: 10,
        builder,
        stroke,
        command,
        penDownAt: 1234,
      },
      penDownAt: 9999,
      circleLoop: null,
      offPageCommand: null,
      debug: false,
      diagSums: { rejoins: 0 },
      userZoom: 1,
      atFitZoom: (v: number) => v,
      currentStyle: () => ({ color: "#000000", size: 2, tool: "pen" }),
    });
    const resume = (x: number, y: number): StrokeBuilder | null =>
      run(w.surface, "resumeLifted", boxOf(w.doc, 0), { x, y });
    return { w, builder, resume };
  }

  it("takes the piece back off the page and hands on its points", () => {
    const { w, builder, resume } = lifted();
    expect(resume(41, 11)).toBe(builder);
    expect(ids(w.doc.pages[0])).toEqual(["s1"]);
    expect(w.strokeAt(0, 25, 10)).toBeNull();
    // As if the piece had never been a step of its own: undo reaches past it.
    expect(w.history.canRedo()).toBe(false);
    // The whole stroke keeps the time its first piece went down.
    expect(w.surface.penDownAt).toBe(1234);
    expect((w.surface.diagSums as { rejoins: number }).rejoins).toBe(1);
    expect(w.surface.lastLift).toBeNull();
  });

  it("leaves a stroke alone when the pen was off the glass for longer", () => {
    const { w, resume } = lifted(200);
    expect(resume(40, 10)).toBeNull();
    expect(ids(w.doc.pages[0])).toEqual(["s1", "s2"]);
  });

  it("leaves a stroke alone when the pen lands away from where it lifted", () => {
    const { w, resume } = lifted();
    expect(resume(80, 10)).toBeNull();
    expect(ids(w.doc.pages[0])).toEqual(["s1", "s2"]);
  });

  it("leaves a stroke alone when the pen changed in between", () => {
    const { w, resume } = lifted(10, { color: "#ff0000" });
    expect(resume(40, 10)).toBeNull();
    expect(ids(w.doc.pages[0])).toEqual(["s1", "s2"]);
  });

  it("leaves a stroke alone once anything else was done after it", () => {
    const { w, resume } = lifted();
    w.commit(0, line("s3", 10, 110, 300));
    expect(resume(40, 10)).toBeNull();
    expect(ids(w.doc.pages[0])).toEqual(["s1", "s2", "s3"]);
  });
});

// --- The palm's scroll, undone when the pen lands (2026-09-30) --------------------

describe("undoPalm", () => {
  function scene(undo: State | null, at: { x: number; y: number }, zoom = 1) {
    const calls: string[] = [];
    let position = { ...at };
    const surface = surfaceWith({
      palmUndo: undo,
      userZoom: zoom,
      zoomAnim: { from: 1, to: 2 },
      debug: false,
      diagSums: { palmUndo: 0 },
      scroller: {
        get position() {
          return position;
        },
        setPosition: (x: number, y: number) => {
          position = { x, y };
          calls.push(`setPosition ${x},${y}`);
        },
      },
      applyZoom: (z: number, cx: number, cy: number) => calls.push(`applyZoom ${z} at ${cx},${cy}`),
      syncViewport: () => calls.push("syncViewport"),
    });
    return { surface, calls, position: () => position };
  }

  it("puts the page back where it was when the touch landed", () => {
    const s = scene(
      { t: performance.now(), x: 0, y: 400, zoom: 1, cx: 5, cy: 6 },
      { x: 0, y: 460 },
    );
    run(s.surface, "undoPalm");
    expect(s.calls).toEqual(["setPosition 0,400", "syncViewport"]);
    expect(s.surface.palmUndo).toBeNull();
    expect(s.surface.zoomAnim).toBeNull();
    expect((s.surface.diagSums as { palmUndo: number }).palmUndo).toBe(1);
  });

  it("undoes a palm's pinch too", () => {
    const s = scene(
      { t: performance.now(), x: 0, y: 400, zoom: 1, cx: 5, cy: 6 },
      { x: 0, y: 400 },
      1.3,
    );
    run(s.surface, "undoPalm");
    expect(s.calls).toEqual(["applyZoom 1 at 5,6", "setPosition 0,400", "syncViewport"]);
  });

  it("leaves a long, far scroll alone: that finger was scrolling", () => {
    const s = scene(
      { t: performance.now() - 5000, x: 0, y: 0, zoom: 1, cx: 0, cy: 0 },
      { x: 0, y: 900 },
    );
    run(s.surface, "undoPalm");
    expect(s.calls).toEqual([]);
    expect(s.surface.palmUndo).toBeNull();
  });

  it("does nothing when the page never moved, or there was no gesture", () => {
    const still = scene(
      { t: performance.now(), x: 0, y: 10, zoom: 1, cx: 0, cy: 0 },
      { x: 0, y: 10 },
    );
    run(still.surface, "undoPalm");
    expect(still.calls).toEqual([]);
    const none = scene(null, { x: 0, y: 10 });
    run(none.surface, "undoPalm");
    expect(none.calls).toEqual([]);
  });
});

describe("pens and shortcuts (FineNotes#25)", () => {
  function keySurface(practice: object | null = null) {
    const calls: string[] = [];
    const page = blankPage("p0");
    const surface = surfaceWith({
      toolState: { tool: "pen" },
      practice,
      doc: { pages: [page] },
      pageIndex: 0,
      callbacks: { onSavedPen: (n: number) => calls.push(`savedPen(${n})`) },
      select: (id: string) => calls.push(`select(${id})`),
    });
    return { surface, calls };
  }

  it("hands a number key's saved pen to the host, except in a practice file", () => {
    const { surface, calls } = keySurface();
    run(surface, "runKeyAction", { savedPen: 3 });
    expect(calls).toEqual(["savedPen(3)"]);
    const practice = keySurface({ device: "ipad" });
    run(practice.surface, "runKeyAction", { savedPen: 3 });
    expect(practice.calls).toEqual([]);
  });

  it("selects everything on the page being read with Cmd/Ctrl+A", () => {
    const { surface, calls } = keySurface();
    run(surface, "runKeyAction", "select-all");
    expect(calls).toEqual(["select(p0)"]);
    const practice = keySurface({ device: "ipad" });
    run(practice.surface, "runKeyAction", "select-all");
    expect(practice.calls).toEqual([]);
  });

  function routed(state: State = {}) {
    return surfaceWith({
      surfaceEl: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
      offsetX: 0,
      viewport: { scrollY: 0 },
      baseScale: 1,
      userZoom: 1,
      pageLayout: { boxes: [], width: 100, height: 100, gap: 0 },
      callbacks: {},
      editingTextView: () => null,
      heldText: null,
      stylusMenuUntil: 0,
      penPanning: false,
      ...state,
    });
  }

  const pen = (over: Record<string, unknown> = {}) => ({
    pointerType: "pen",
    button: 0,
    buttons: 1,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    clientX: 50,
    clientY: 50,
    ...over,
  });

  it("moves the page from beside the pages, and draws on them", () => {
    const margin = routed();
    expect(run(margin, "pressRoute", pen())).toBe("pan");
    expect(margin.penPanning).toBe(true);
    const typing = routed({ editingTextView: () => ({}) });
    expect(run(typing, "pressRoute", pen())).toBe("draw");
  });

  it("moves the page with the hand tool wherever the pen lands; a lent tool still wins", () => {
    const hand = routed({ toolState: { tool: "pan" } });
    expect(run(hand, "pressRoute", pen())).toBe("pan");
    expect(hand.penPanning).toBe(true);
    const lent = routed({ toolState: { tool: "pan" } });
    expect(run(lent, "pressRoute", pen({ shiftKey: true }))).toBe("draw");
  });

  it("ignores a barrel set to nothing pressed while hovering, and keeps its menu away", () => {
    const surface = routed({ callbacks: { barrelAction: () => "none" } });
    expect(run(surface, "pressRoute", pen({ button: 2, buttons: 2 }))).toBe("ignore");
    expect(surface.stylusMenuUntil).toBeGreaterThan(0);
  });

  it("lends the eraser or the lasso for one press, never while typing", () => {
    const surface = routed({ practice: null });
    expect(run(surface, "pressOverrideOf", pen({ shiftKey: true }))).toBe("eraser");
    expect(run(surface, "pressOverrideOf", pen({ ctrlKey: true }))).toBe("select");
    expect(run(surface, "pressOverrideOf", pen({ altKey: true }))).toBe("zoom");
    expect(run(surface, "pressOverrideOf", pen())).toBeNull();
    const practice = routed({ practice: { device: "ipad" } });
    expect(run(practice, "pressOverrideOf", pen({ ctrlKey: true }))).toBeNull();
    const typing = routed({ editingTextView: () => ({}) });
    expect(run(typing, "pressOverrideOf", pen({ shiftKey: true }))).toBeNull();
  });

  it("runs a lent tool's gesture and does not count it as a use of the tool in hand", () => {
    const calls: string[] = [];
    const gesture = { up: () => calls.push("up"), cancel: () => calls.push("cancel") };
    const surface = surfaceWith({
      toolState: { tool: "pen" },
      pressTool: "eraser",
      gestureOf: (tool: string) => {
        calls.push(`gesture(${tool})`);
        return gesture;
      },
      deferToolUse: () => calls.push("defer"),
    });
    expect(run(surface, "gestureTool")).toBe("eraser");
    run(surface, "finishToolGesture", {}, { x: 0, y: 0 });
    expect(calls).toEqual(["gesture(eraser)", "up"]);
    expect(surface.pressTool).toBeNull();
    expect(run(surface, "gestureTool")).toBe("pen");
    run(surface, "finishToolGesture", {}, { x: 0, y: 0 });
    expect(calls.slice(2)).toEqual(["gesture(pen)", "up", "defer"]);
  });

  it("zooms with an Alt-drag about where the pen came down, within the limits", () => {
    const applyZoom = vi.fn((zoom: number) => {
      surface.userZoom = zoom;
    });
    const surface = routed({
      minZoom: 0.5,
      zoomAnim: null,
      zoomDrag: null,
      direction: "vertical",
      applyZoom,
      snapRowAfterZoom: false,
      settleRowAfterZoom: vi.fn(),
      requestFrame: vi.fn(),
    });
    run(surface, "startZoomDrag", { x: 40, y: 300 });
    expect(surface.zoomDrag).toEqual({
      from: 1,
      x: 40,
      y: 300,
      moved: false,
      tapZoom: false,
    });
    run(surface, "moveZoomDrag", { x: 40, y: 150 });
    expect(applyZoom).toHaveBeenLastCalledWith(2, 40, 300);
    expect(run(surface, "endZoomDrag")).toBe(true);
    expect(surface.zoomDrag).toBeNull();
    expect(run(surface, "endZoomDrag")).toBe(false);
  });

  it("zooms a step in where the magnifier was tapped, unless the pen moved", () => {
    const applyZoom = vi.fn((zoom: number) => {
      surface.userZoom = zoom;
    });
    const surface = routed({
      minZoom: 0.5,
      zoomAnim: null,
      zoomDrag: null,
      direction: "vertical",
      applyZoom,
      snapRowAfterZoom: false,
      settleRowAfterZoom: vi.fn(),
      requestFrame: vi.fn(),
    });
    run(surface, "startZoomDrag", { x: 40, y: 300 }, true);
    run(surface, "endZoomDrag", { x: 41, y: 301 });
    expect(applyZoom).toHaveBeenLastCalledWith(1.25, 41, 301);

    applyZoom.mockClear();
    run(surface, "startZoomDrag", { x: 40, y: 300 }, true);
    run(surface, "moveZoomDrag", { x: 40, y: 260 });
    run(surface, "endZoomDrag", { x: 40, y: 260 });
    // The drag zoomed; its lift adds no tap step.
    expect(applyZoom).toHaveBeenCalledOnce();
    expect(applyZoom.mock.calls[0][0]).toBeGreaterThan(1.25);
  });

  it("shows the crosshair for the pens only, and only when it is picked", () => {
    const classes = new Map<string, boolean>();
    const surface = surfaceWith({
      toolState: { tool: "pen" },
      surfaceEl: {
        toggleClass: (name: string, on: boolean) => classes.set(name, on),
        removeClass: (name: string) => classes.set(name, false),
      },
    });
    run(surface, "setPenCursor", "crosshair");
    expect(classes.get("is-pen-cursor")).toBe(true);
    expect(classes.get("is-ink-cursor")).toBe(false);
    (surface.toolState as { tool: string }).tool = "eraser";
    run(surface, "syncPenCursor");
    expect(classes.get("is-pen-cursor")).toBe(false);
    (surface.toolState as { tool: string }).tool = "laser";
    run(surface, "syncPenCursor");
    expect(classes.get("is-laser")).toBe(true);
    run(surface, "setPenCursor", "arrow");
    expect(classes.get("is-pen-cursor")).toBe(false);
    expect(classes.get("is-ink-cursor")).toBe(false);
  });

  describe("the ink cursor (FineNotes#27)", () => {
    function inkSurface(state: State = {}) {
      const classes = new Map<string, boolean>();
      const props: Array<Record<string, string>> = [];
      const surface = surfaceWith({
        toolState: { tool: "pen", penType: "ball", color: "#2563eb", size: 4 },
        doc: { pages: [{ backdrop: { kind: "blank" } }] },
        pageIndex: 0,
        paper: { night: false, paper: "#ffffff" },
        baseScale: 2,
        userZoom: 1,
        pinch: null,
        renderer: { highlighterAlpha: 0.4 },
        surfaceEl: {
          toggleClass: (name: string, on: boolean) => classes.set(name, on),
          removeClass: (name: string) => classes.set(name, false),
          setCssProps: (p: Record<string, string>) => props.push(p),
        },
        ...state,
      });
      return { surface, classes, props };
    }

    it("sets the pen's own cursor and its drawing dot as properties", () => {
      const { surface, classes, props } = inkSurface();
      run(surface, "setPenCursor", "ink");
      expect(classes.get("is-ink-cursor")).toBe(true);
      expect(classes.get("is-pen-cursor")).toBe(false);
      expect(props).toHaveLength(1);
      const hover = props[0]["--goodobsidian-pen-cursor"];
      const down = props[0]["--goodobsidian-pen-cursor-drawing"];
      expect(hover).toMatch(/^url\("data:image\/svg\+xml,.*"\) \d+ \d+, crosshair$/);
      expect(decodeURIComponent(hover)).toContain("fill='#2563eb'");
      expect(decodeURIComponent(down)).toContain("r='1'");
    });

    it("draws again only when the tool, colour, width or zoom changes it", () => {
      const { surface, props } = inkSurface();
      run(surface, "setPenCursor", "ink");
      run(surface, "refreshPenCursor");
      run(surface, "syncInkCursor");
      expect(props).toHaveLength(1);
      (surface.toolState as { color: string }).color = "#e03131";
      run(surface, "refreshPenCursor");
      expect(props).toHaveLength(2);
      surface.userZoom = 3;
      run(surface, "syncInkCursor");
      expect(props).toHaveLength(3);
      // Not mid-pinch: the cursor is drawn once the pinch ends.
      surface.pinch = { raw: 4, centerX: 0, centerY: 0 };
      surface.userZoom = 4;
      run(surface, "syncInkCursor");
      expect(props).toHaveLength(3);
      surface.pinch = null;
      run(surface, "syncInkCursor");
      expect(props).toHaveLength(4);
      (surface.toolState as { tool: string }).tool = "laser";
      run(surface, "syncPenCursor");
      expect(props).toHaveLength(5);
      expect(decodeURIComponent(props[4]["--goodobsidian-pen-cursor"])).toContain("#ff3b30");
    });

    it("shows the ink as a dark page shows it", () => {
      const { surface, props } = inkSurface({
        toolState: { tool: "pen", penType: "ball", color: "#1a1a1a", size: 4 },
        paper: { night: true, paper: "#383838", keepPdf: false },
      });
      run(surface, "setPenCursor", "ink");
      const svg = decodeURIComponent(props[0]["--goodobsidian-pen-cursor"]);
      expect(svg).not.toContain("fill='#1a1a1a'");
    });

    it("draws nothing for the eraser, nor with another style", () => {
      const eraser = inkSurface({ toolState: { tool: "eraser" } });
      run(eraser.surface, "setPenCursor", "ink");
      expect(eraser.classes.get("is-ink-cursor")).toBe(false);
      expect(eraser.props).toHaveLength(0);
      const crosshair = inkSurface();
      run(crosshair.surface, "setPenCursor", "crosshair");
      expect(crosshair.props).toHaveLength(0);
    });

    it("marks the page while the pen is down, with the ink cursor only", () => {
      const { surface, classes } = inkSurface();
      run(surface, "setPenCursor", "ink");
      run(surface, "markDrawing", true);
      expect(classes.get("is-drawing")).toBe(true);
      run(surface, "markDrawing", false);
      expect(classes.get("is-drawing")).toBe(false);
      run(surface, "markDrawing", true);
      run(surface, "setPenCursor", "arrow");
      expect(classes.get("is-drawing")).toBe(false);
      run(surface, "markDrawing", true);
      expect(classes.get("is-drawing")).toBe(false);
    });
  });
});

describe("ink pressure", () => {
  it("draws the pages' ink by the pressure setting, not by the pen in hand", () => {
    const frames: string[] = [];
    const s = surfaceWith({
      toolState: { pressureEnabled: true },
      inkPressure: true,
      tilesPressure: true,
      requestFrame: () => frames.push("frame"),
    });
    // Picking the ball pen: new strokes record no pressure; the ink already
    // on the page is not redrawn.
    run(s, "setPressure", false);
    expect(s.toolState).toEqual({ pressureEnabled: false });
    expect(s.inkPressure).toBe(true);
    expect(frames).toEqual([]);
    // The setting switched off: every stroke is traced again, evenly.
    run(s, "setInkPressure", false);
    expect(s.inkPressure).toBe(false);
    expect(frames).toEqual(["frame"]);
    run(s, "setInkPressure", false);
    expect(frames).toEqual(["frame"]);
  });
});

describe("size preview scales", () => {
  it("pen widths and the eraser both grow with the zoom: their sizes are the paper's", () => {
    const s = surfaceWith({ baseScale: 0.8, userZoom: 2.5 });
    expect(run(s, "sizePreviewScales")).toMatchObject({ pen: 2, eraser: 2 });
  });

  it("erases the same patch of paper at every zoom", () => {
    const at = (userZoom: number) =>
      run(
        surfaceWith({ baseScale: 0.8, userZoom, toolState: { tool: "eraser", eraserSize: 24 } }),
        "eraserSize",
      );
    expect(at(1)).toBe(at(5));
  });

  it("tells the host once each time they change, so the toolbar's marks follow", () => {
    const told = vi.fn();
    const s = surfaceWith({
      baseScale: 1,
      userZoom: 1,
      reportedSizeScale: null,
      callbacks: { onSizeScale: told },
    });
    run(s, "reportSizeScale");
    run(s, "reportSizeScale");
    expect(told).toHaveBeenCalledTimes(1);
    s.userZoom = 3;
    run(s, "reportSizeScale");
    run(s, "reportSizeScale");
    expect(told).toHaveBeenCalledTimes(2);
    // A pane of another width moves the eraser's scale alone.
    s.baseScale = 1.2;
    run(s, "reportSizeScale");
    expect(told).toHaveBeenCalledTimes(3);
  });
});
