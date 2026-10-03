import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REJOIN_MS } from "../../src/input/pen-rejoin";
import type { ActiveTool } from "../../src/view/toolbar";
vi.mock("obsidian", () => import("./fake-obsidian"));
const { Toolbar } = await import("../../src/view/toolbar");
const { InkSurface } = await import("../../src/view/ink-surface");
const { PointerController } = await import("../../src/input/pointer-controller");
type Fake = Record<string, unknown> & {
  state: { tool: ActiveTool };
  toolState: { tool: ActiveTool; textPinned: boolean };
  callbacks: {
    returnToPenAfterUse: () => boolean;
    returnToPenOnReselect: () => boolean;
    onToolChange: ReturnType<typeof vi.fn>;
  };
  editingTextView: () => object | null;
  gestureOf: () => unknown;
};
const run = (obj: Fake, method: string, ...args: unknown[]) =>
  (obj[method] as (...args: unknown[]) => unknown).apply(obj, args);
function surface(tool: ActiveTool, once = true) {
  const toolState = { tool, textPinned: false };
  const s: Fake = Object.assign(Object.create(InkSurface.prototype), {
    toolState,
    toolSeen: tool,
    selectionToolUsed: true,
    activePage: {},
    callbacks: {
      returnToPenAfterUse: () => once,
      returnToPenOnReselect: () => true,
      onToolChange: vi.fn(),
    },
    surfaceEl: { toggleClass: vi.fn() },
    dropSelection: vi.fn(),
    syncLockBadges: vi.fn(),
    releaseHeldText: vi.fn(),
    hideTextHint: vi.fn(),
    blurTextBox: vi.fn(),
    editingTextView: () => null,
    // A selection is on screen until a test takes it away.
    liveSelection: () => ({}),
    liveImageSelection: () => null,
  });
  return s;
}
describe("secondary tool integration", () => {
  // An eraser stroke's or shape's return waits out the rejoin window (a timer).
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    vi.stubGlobal("window", globalThis);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it.each(["eraser", "select", "text", "shape"] as ActiveTool[])(
    "toolbar toggles active %s only when enabled",
    (tool) => {
      for (const enabled of [false, true]) {
        const s: Fake = Object.assign(Object.create(Toolbar.prototype), {
          state: { tool },
          optionsVisible: true,
          callbacks: { returnToPenOnReselect: () => enabled, onToolChange: vi.fn() },
          toggleLassoPopover: vi.fn(),
          closePopover: vi.fn(),
          showOptions: vi.fn(),
          buildOptions: vi.fn(),
          syncActive: vi.fn(),
        });
        run(s, "tapTool", tool, {});
        expect(s.state.tool).toBe(enabled ? "pen" : tool);
        if (enabled) expect(s.callbacks.onToolChange).toHaveBeenCalledWith("pen");
        else expect(s.callbacks.onToolChange).not.toHaveBeenCalled();
      }
    },
  );
  it.each(["eraser", "select", "text", "shape"] as ActiveTool[])(
    "keyboard reselects %s consistently",
    (tool) => {
      const s = surface(tool);
      Object.assign(s, {
        cropping: null,
        actionBar: { isMenuOpen: false },
        liveImageSelection: () => null,
        liveSelection: () => null,
        direction: "vertical",
        scroller: { bounds: { maxY: 1 } },
      });
      const keys = { eraser: "e", select: "v", text: "t", shape: "s", pen: "p", highlighter: "h" };
      run(s, "handleKeyDown", { key: keys[tool], target: null, preventDefault: vi.fn() });
      expect(s.toolState.tool).toBe("pen");
      expect(s.callbacks.onToolChange).toHaveBeenCalledWith("pen");
    },
  );
  it.each(["eraser", "shape", "select", "text", "pen", "highlighter"] as ActiveTool[])(
    "finishes %s before returning, preserving text and lasso sessions",
    (tool) => {
      const s = surface(tool);
      const up = vi.fn(() => expect(s.toolState.tool).toBe(tool));
      const cancel = vi.fn();
      s.gestureOf = () => ({ up, cancel });
      run(s, "finishToolGesture", {}, { x: 0, y: 0 });
      expect(up).toHaveBeenCalledOnce();
      // Not at the lift: a flicker of the Pencil's contact is a lift too.
      expect(s.toolState.tool).toBe(tool);
      vi.advanceTimersByTime(REJOIN_MS);
      expect(s.toolState.tool).toBe(["eraser", "shape"].includes(tool) ? "pen" : tool);
    },
  );
  it("ignores empty gestures, rolls back cancelled erasing, keeps cancelled shapes", () => {
    for (const tool of ["eraser", "shape"] as ActiveTool[]) {
      const s = surface(tool);
      const up = vi.fn(),
        cancel = vi.fn();
      s.gestureOf = () => ({ up, cancel });
      run(s, "finishToolGesture", null, {});
      expect(up).not.toHaveBeenCalled();
      run(s, "finishToolGesture", null, null);
      expect(s.toolState.tool).toBe(tool);
      run(s, "finishToolGesture", {}, null);
      vi.advanceTimersByTime(REJOIN_MS);
      expect(s.toolState.tool).toBe(tool === "shape" ? "pen" : "eraser");
    }
  });
  it("keeps a lasso session until the outside click", () => {
    const s = surface("select");
    expect(run(s, "completeToolUse", "gesture")).toBeUndefined();
    expect(s.toolState.tool).toBe("select");
    expect(run(s, "dismissUsedSelection")).toBe(true);
    expect(s.toolState.tool).toBe("pen");
    expect(s.selectionToolUsed).toBe(false);
    expect(s.activePage).toBeNull();
    expect(run(s, "dismissUsedSelection")).toBe(false);
  });
  it("does not swallow the next press once the selection is gone by other means", () => {
    // Delete, Cut or Undo took the selection away: nothing is left to dismiss,
    // so the press is the lasso's, as the toolbar still shows.
    const s = surface("select");
    s.liveSelection = () => null;
    expect(run(s, "dismissUsedSelection")).toBe(false);
    expect(s.toolState.tool).toBe("select");
    expect(s.selectionToolUsed).toBe(false);
    expect(s.callbacks.onToolChange).not.toHaveBeenCalled();
    // A picture selected alone still counts as on screen.
    const image = surface("select");
    image.liveSelection = () => null;
    image.liveImageSelection = () => ({});
    expect(run(image, "dismissUsedSelection")).toBe(true);
    expect(image.toolState.tool).toBe("pen");
  });
  it("keeps unused and disabled lassos and does not start ink on the outside click", () => {
    const s = surface("select");
    s.selectionToolUsed = false;
    expect(run(s, "dismissUsedSelection")).toBe(false);
    s.selectionToolUsed = true;
    s.callbacks.returnToPenAfterUse = () => false;
    expect(run(s, "dismissUsedSelection")).toBe(false);
    s.callbacks.returnToPenAfterUse = () => true;
    s.gestureOf = vi.fn();
    run(s, "penDown", {});
    expect(s.toolState.tool).toBe("pen");
    expect(s.gestureOf).not.toHaveBeenCalled();
  });
  it("returns text to pen after editing, overrides pin only when enabled, and preserves legacy handback", () => {
    const s = surface("text");
    s.toolState.textPinned = true;
    s.toolBeforeText = "eraser";
    s.editingTextView = () => ({});
    run(s, "handBackFromText");
    expect(s.toolState.tool).toBe("text");
    s.editingTextView = () => null;
    run(s, "handBackFromText");
    expect(s.toolState.tool).toBe("pen");
    const old = surface("text", false);
    old.toolBeforeText = "eraser";
    old.toolState.textPinned = true;
    run(old, "handBackFromText");
    expect(old.toolState.tool).toBe("text");
    old.toolState.textPinned = false;
    run(old, "handBackFromText");
    expect(old.toolState.tool).toBe("eraser");
  });
  it("returns after text blur rather than requiring a second outside tap when enabled", () => {
    for (const enabled of [false, true]) {
      const s = surface("text", enabled);
      const view = { pageId: "p1", id: "t1" };
      s.heldText = view;
      s.releaseTextEditingClass = vi.fn();
      s.removeIfEmpty = vi.fn();
      s.liveTextBox = () => ({});
      run(s, "endTextEditing", view);
      expect(s.toolState.tool).toBe(enabled ? "pen" : "text");
    }
  });
  it("finger outside taps dismiss the used lasso and selection callbacks arm it", () => {
    const s = surface("select");
    s.lasso = null;
    s.imageDrag = null;
    s.groupDrag = null;
    run(s, "onFingerTap", 10, 10);
    expect(s.toolState.tool).toBe("pen");
    s.toolState.tool = "select";
    s.selectionToolUsed = false;
    s.endCrop = vi.fn();
    s.clearSelection = vi.fn();
    s.cancelImageDrag = vi.fn();
    s.syncImageOverlay = vi.fn();
    run(s, "setImageSelection", "p1", { id: "i1" });
    expect(s.selectionToolUsed).toBe(true);
    s.selectionToolUsed = false;
    run(s, "setImageSelection", "p1", { id: "i2", locked: true });
    expect(s.selectionToolUsed).toBe(false);
    s.deselectImage = vi.fn();
    s.syncSelectionOverlay = vi.fn();
    run(s, "select", "p1", { strokes: [{}], images: [], textBoxes: [] });
    expect(s.selectionToolUsed).toBe(true);
    s.selectionToolUsed = false;
    run(s, "select", "p1", { strokes: [], images: [], textBoxes: [] });
    expect(s.selectionToolUsed).toBe(false);
  });
  it("keeps lasso options reachable when repeated selection returns to pen", () => {
    for (const enabled of [false, true]) {
      const button = {};
      const s: Fake = Object.assign(Object.create(Toolbar.prototype), {
        callbacks: { returnToPenOnReselect: () => enabled },
        optionsEl: {},
        barButton: vi.fn((_parent, _icon, label, click) => {
          expect(label).toBe("Lasso options");
          click(button);
        }),
        toggleLassoPopover: vi.fn(),
      });
      run(s, "buildSelectOptions");
      if (enabled) expect(s.toggleLassoPopover).toHaveBeenCalledWith(button);
      else expect(s.barButton).not.toHaveBeenCalled();
    }
  });
  it("reads settings live, including both switches independently", () => {
    const s = surface("eraser", false);
    run(s, "completeToolUse", "gesture");
    expect(s.toolState.tool).toBe("eraser");
    s.callbacks.returnToPenAfterUse = () => true;
    run(s, "completeToolUse", "gesture");
    expect(s.toolState.tool).toBe("pen");
  });
});

// --- A flicker of the Pencil's contact mid-use ----------------------------------------

/** The element the controller listens on: listeners only, capture recorded nowhere. */
class Overlay {
  readonly listeners = new Map<string, (event: unknown) => void>();
  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, listener);
  }
  removeEventListener(): void {}
  setPointerCapture(): void {}
  hasPointerCapture(): boolean {
    return false;
  }
  releasePointerCapture(): void {}
}

/**
 * A surface fed by a real `PointerController`, its callbacks routed as the
 * surface's own `pointerCallbacks` route them (pen-down, the tool's moves,
 * `finishToolGesture` on lift or cancel). The tools' gestures only record
 * which tool each pen-down reached; everything that decides the tool is real.
 */
function penRig(tool: ActiveTool) {
  const s = surface(tool);
  const page = { index: 0, id: "p1", x: 0, y: 0, width: 1000, height: 1400 };
  const downs: string[] = [];
  const gesture = (name: string) => ({
    down: () => downs.push(`${name}@${s.toolState.tool}`),
    move: vi.fn(),
    up: vi.fn(),
    cancel: vi.fn(),
  });
  Object.assign(s, {
    selectionToolUsed: false,
    activePage: null,
    clock: () => 0,
    cropping: null,
    heldText: null,
    userZoom: 1,
    pageLayout: { boxes: [page] },
    deselectImage: vi.fn(),
    clearSelection: vi.fn(),
    eraserGesture: gesture("eraser"),
    inkGesture: gesture("ink"),
    lassoGesture: gesture("lasso"),
    textGesture: gesture("text"),
  });
  const el = new Overlay();
  const controller = new PointerController(el as unknown as HTMLElement, (x, y) => ({ x, y }), {
    onStart: (sample) => run(s, "penDown", sample),
    onMove: (samples) =>
      (run(s, "gestureOf", s.toolState.tool) as { move: (...a: unknown[]) => void }).move(
        s.activePage,
        samples,
      ),
    onEnd: (sample) => run(s, "finishToolGesture", s.activePage, sample),
    onCancel: () => run(s, "finishToolGesture", s.activePage, null),
  });
  controller.attach();
  const fire = (type: string, x: number, y: number) =>
    el.listeners.get(type)?.({
      pointerId: 3,
      pointerType: "pen",
      clientX: x,
      clientY: y,
      pressure: 0.3,
      tiltX: 0,
      tiltY: 0,
      timeStamp: performance.now(),
      preventDefault: () => {},
    });
  /** Down at the first point, a move a frame to each next, up at the last. */
  const contact = (pts: [number, number][]) => {
    fire("pointerdown", ...pts[0]);
    for (const p of pts.slice(1)) {
      vi.advanceTimersByTime(16);
      fire("pointermove", ...p);
    }
    vi.advanceTimersByTime(16);
    fire("pointerup", ...pts[pts.length - 1]);
  };
  return { s, downs, contact };
}

describe("a Pencil flicker in the middle of a use", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    vi.stubGlobal("window", globalThis);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each(["eraser", "shape"] as ActiveTool[])(
    "keeps the %s through up -> down 20 ms later, 2 px away, then returns",
    (tool) => {
      const { s, downs, contact } = penRig(tool);
      contact([
        [100, 100],
        [140, 100],
        [180, 100],
      ]);
      vi.advanceTimersByTime(20);
      contact([
        [182, 101],
        [220, 140],
        [260, 180],
      ]);
      const name = tool === "eraser" ? "eraser" : "ink";
      // Both halves reached the same tool: no ink from an eraser, no pen piece of a shape.
      expect(downs).toEqual([`${name}@${tool}`, `${name}@${tool}`]);
      expect(s.toolState.tool).toBe(tool);
      vi.advanceTimersByTime(REJOIN_MS - 1);
      expect(s.toolState.tool).toBe(tool);
      vi.advanceTimersByTime(1);
      expect(s.toolState.tool).toBe("pen");
      expect(s.callbacks.onToolChange).toHaveBeenCalledOnce();
    },
  );

  it("returns at once for a quick pen-down somewhere else, which then writes", () => {
    const { s, downs, contact } = penRig("eraser");
    contact([
      [100, 100],
      [180, 100],
    ]);
    vi.advanceTimersByTime(20);
    contact([
      [600, 900],
      [640, 900],
    ]);
    expect(downs).toEqual(["eraser@eraser", "ink@pen"]);
    vi.advanceTimersByTime(REJOIN_MS * 2);
    expect(s.callbacks.onToolChange).toHaveBeenCalledOnce();
  });

  it("returns after the window for a pen-down that comes later, even in the same place", () => {
    const { s, downs, contact } = penRig("eraser");
    contact([
      [100, 100],
      [180, 100],
    ]);
    vi.advanceTimersByTime(REJOIN_MS + 30);
    expect(s.toolState.tool).toBe("pen");
    contact([
      [181, 100],
      [220, 100],
    ]);
    expect(downs).toEqual(["eraser@eraser", "ink@pen"]);
  });

  it("lets a tool picked during the window win over the return", () => {
    const { s, contact } = penRig("eraser");
    contact([
      [100, 100],
      [180, 100],
    ]);
    s.toolState.tool = "select";
    run(s, "setTool", "select");
    vi.advanceTimersByTime(REJOIN_MS * 2);
    expect(s.toolState.tool).toBe("select");
    expect(s.callbacks.onToolChange).not.toHaveBeenCalled();
  });

  it("switches nothing with the setting off", () => {
    const { s, contact } = penRig("eraser");
    s.callbacks.returnToPenAfterUse = () => false;
    contact([
      [100, 100],
      [180, 100],
    ]);
    vi.advanceTimersByTime(REJOIN_MS * 2);
    expect(s.toolState.tool).toBe("eraser");
  });
});
