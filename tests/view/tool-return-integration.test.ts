import { describe, expect, it, vi } from "vitest";
import type { ActiveTool } from "../../src/view/toolbar";
vi.mock("obsidian", () => import("./fake-obsidian"));
const { Toolbar } = await import("../../src/view/toolbar");
const { InkSurface } = await import("../../src/view/ink-surface");
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
  });
  return s;
}
describe("secondary tool integration", () => {
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
      run(s, "finishToolGesture", {}, {});
      expect(up).toHaveBeenCalledOnce();
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
      expect(s.toolState.tool).toBe(tool === "shape" ? "pen" : "eraser");
    }
  });
  it("keeps a lasso session until the outside click, even after its selection was deleted", () => {
    const s = surface("select");
    expect(run(s, "completeToolUse", "gesture")).toBeUndefined();
    expect(s.toolState.tool).toBe("select");
    expect(run(s, "dismissUsedSelection")).toBe(true);
    expect(s.toolState.tool).toBe("pen");
    expect(s.selectionToolUsed).toBe(false);
    expect(s.activePage).toBeNull();
    expect(run(s, "dismissUsedSelection")).toBe(false);
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
