/**
 * A finger tap on a picture with a pen in hand picks the lasso and selects
 * the picture (`InkSurface.fingerPicksPicture`); a pen type keeps its own
 * width in the toolbar (`Toolbar.choosePenType`, `setWidth`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveTool } from "../../src/view/toolbar";
vi.mock("obsidian", () => import("./fake-obsidian"));
const { InkSurface, Toolbar, PEN_TYPES } = await (async () => {
  const surface = await import("../../src/view/ink-surface");
  const toolbar = await import("../../src/view/toolbar");
  return { InkSurface: surface.InkSurface, Toolbar: toolbar.Toolbar, PEN_TYPES: toolbar.PEN_TYPES };
})();

type Fake = Record<string, unknown>;
const run = (obj: Fake, method: string, ...args: unknown[]): unknown =>
  (obj[method] as (...args: unknown[]) => unknown).apply(obj, args);

const picture = { id: "i1", path: "a.png", x: 100, y: 100, w: 200, h: 100 };

function surface(tool: ActiveTool, practice: object | null = null) {
  const s: Fake = Object.assign(Object.create(InkSurface.prototype), {
    toolState: { tool },
    practice,
    callbacks: { onToolChange: vi.fn() },
    setTool: vi.fn((next: ActiveTool) => {
      (s.toolState as { tool: ActiveTool }).tool = next;
    }),
    setImageSelection: vi.fn(),
  });
  return s;
}

describe("a finger tap on a picture", () => {
  it.each(["pen", "highlighter", "eraser", "shape"] as ActiveTool[])(
    "with the %s in hand picks the lasso and selects it",
    (tool) => {
      const s = surface(tool);
      const page = { id: "p1", images: [picture] };
      expect(run(s, "fingerPicksPicture", page, { x: 150, y: 150 })).toBe(true);
      expect(s.setTool).toHaveBeenCalledWith("select");
      expect(
        (s.callbacks as { onToolChange: ReturnType<typeof vi.fn> }).onToolChange,
      ).toHaveBeenCalledWith("select");
      expect(s.setImageSelection).toHaveBeenCalledWith("p1", picture);
    },
  );

  it("does nothing beside a picture, on a locked one, with the Text tool or in a practice file", () => {
    const page = { id: "p1", images: [picture] };
    const locked = { id: "p1", images: [{ ...picture, locked: true }] };
    const cases: Array<[Fake, object, { x: number; y: number }]> = [
      [surface("pen"), page, { x: 50, y: 50 }],
      [surface("pen"), locked, { x: 150, y: 150 }],
      [surface("text"), page, { x: 150, y: 150 }],
      [surface("pen", { device: "ipad" }), page, { x: 150, y: 150 }],
    ];
    for (const [s, p, at] of cases) {
      expect(run(s, "fingerPicksPicture", p, at)).toBe(false);
      expect(s.setTool).not.toHaveBeenCalled();
      expect(s.setImageSelection).not.toHaveBeenCalled();
    }
  });

  it("takes the topmost unlocked picture where two overlap", () => {
    const s = surface("pen");
    const top = { ...picture, id: "i2", x: 120 };
    const page = { id: "p1", images: [picture, top] };
    run(s, "fingerPicksPicture", page, { x: 150, y: 150 });
    expect(s.setImageSelection).toHaveBeenCalledWith("p1", top);
  });
});

describe("the toolbar keeps a width per pen type", () => {
  function toolbar() {
    const callbacks = {
      onPenInks: vi.fn(),
      onPenColors: vi.fn(),
      onColorChange: vi.fn(),
      onSizeChange: vi.fn(),
      onToolChange: vi.fn(),
      onPressureToggle: vi.fn(),
      pressureAllowed: () => false,
    };
    const t: Fake = Object.assign(Object.create(Toolbar.prototype), {
      state: { tool: "pen", penType: "fountain", color: "#1a1a1a", size: 2 },
      callbacks,
      buildOptions: vi.fn(),
      syncActive: vi.fn(),
    });
    return { t, callbacks };
  }
  const spec = (id: string) => PEN_TYPES.find((p) => p.id === id)!;

  it("brings each pen's width back when it is picked again", () => {
    const { t, callbacks } = toolbar();
    const state = t.state as { size: number; penType: string; tool: string };
    run(t, "choosePenType", spec("highlighter"));
    // Never used: the highlighter starts at the width in hand.
    expect(state.size).toBe(2);
    run(t, "setWidth", 6);
    run(t, "choosePenType", spec("fountain"));
    expect(state.size).toBe(2);
    expect(callbacks.onSizeChange).toHaveBeenLastCalledWith(2);
    run(t, "choosePenType", spec("highlighter"));
    expect(state.size).toBe(6);
    // The inks the host saves carry the widths.
    const inks = callbacks.onPenInks.mock.calls.at(-1)?.[0] as Record<string, { size?: number }>;
    expect(inks.fountain.size).toBe(2);
    expect(inks.highlighter.size).toBe(6);
  });
});

describe("a finger tap on a text box", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const textBox = {
    id: "t1",
    x: 100,
    y: 100,
    w: 200,
    h: 50,
    text: "hi",
    color: "#1a1a1a",
    fontSize: 18,
  };
  function holdable(tool: ActiveTool, extra: Fake = {}) {
    const classes = new Set<string>();
    const view = {
      pageId: "p1",
      id: "t1",
      root: {
        addClass: (c: string) => void classes.add(c),
        removeClass: (...cs: string[]) => cs.forEach((c) => classes.delete(c)),
        ownerDocument: { defaultView: null },
      },
      input: { value: "hi" },
    };
    const s = surface(tool);
    Object.assign(s, {
      heldText: null,
      textBoxInputs: new Map([["p1:t1", view]]),
      textBoxFrameOf: () => ({ x: 100, y: 100, w: 200, h: 50 }),
      liveTextBox: () => textBox,
      editingTextView: () => null,
      clearSelection: vi.fn(),
      deselectImage: vi.fn(),
      ...extra,
    });
    (s.callbacks as Fake).onTextEditing = vi.fn();
    return { s, view, classes };
  }
  const page = { id: "p1", textBoxes: [textBox], images: [] };

  it.each(["pen", "highlighter", "eraser", "shape"] as ActiveTool[])(
    "with the %s in hand picks the lasso and holds the box, without the keyboard",
    (tool) => {
      const { s, view, classes } = holdable(tool);
      expect(run(s, "fingerHoldsTextBox", page, { x: 150, y: 120 })).toBe(true);
      expect(s.setTool).toHaveBeenCalledWith("select");
      expect((s.callbacks as Fake).onToolChange).toHaveBeenCalledWith("select");
      // The tool in hand comes back when the box is let go.
      expect(s.heldReturnTool).toBe(tool);
      expect(s.heldText).toBe(view);
      expect(classes.has("is-held")).toBe(true);
      // The pill shows the box's style; nothing focused it.
      expect((s.callbacks as Fake).onTextEditing).toHaveBeenCalledWith(
        expect.objectContaining({ color: "#1a1a1a", fontSize: 18 }),
      );
    },
  );

  it("does nothing beside the box, with the Text tool, in a practice file or on a locked page", () => {
    const cases: Array<[Fake, { x: number; y: number }]> = [
      [holdable("pen").s, { x: 50, y: 50 }],
      [holdable("text").s, { x: 150, y: 120 }],
      [holdable("pen", { practice: { device: "ipad" } }).s, { x: 150, y: 120 }],
    ];
    const locked = holdable("pen").s;
    (locked.callbacks as Fake).isLocked = () => true;
    cases.push([locked, { x: 150, y: 120 }]);
    for (const [s, at] of cases) {
      expect(run(s, "fingerHoldsTextBox", page, at)).toBe(false);
      expect(s.setTool).not.toHaveBeenCalled();
      expect(s.heldText).toBeNull();
    }
  });

  it("the held box takes taps itself only once the tap that held it is over", () => {
    const { s, classes } = holdable("pen");
    run(s, "fingerHoldsTextBox", page, { x: 150, y: 120 });
    expect(classes.has("is-tappable")).toBe(false);
    vi.advanceTimersByTime(400);
    expect(classes.has("is-tappable")).toBe(true);
  });

  it("a tap on the held box types in it; a tap beside lets go and brings the tool back", () => {
    const { s, view } = holdable("select");
    s.heldText = view;
    s.heldReturnTool = "pen";
    s.focusTextBox = vi.fn();
    expect(run(s, "tapWithHeldText", page, { x: 150, y: 120 })).toBe(true);
    expect(s.focusTextBox).toHaveBeenCalledWith(view.input);
    expect(run(s, "tapWithHeldText", page, { x: 500, y: 500 })).toBe(true);
    expect(s.heldText).toBeNull();
    expect(s.setTool).toHaveBeenLastCalledWith("pen");
    expect((s.callbacks as Fake).onToolChange).toHaveBeenLastCalledWith("pen");
    // Nothing held: the lasso's own tap goes on.
    expect(run(s, "tapWithHeldText", page, { x: 150, y: 120 })).toBe(false);
  });

  it("with the lasso, a tap on a box holds it with its options, not a group selection", () => {
    const { s, view, classes } = holdable("select");
    s.pageAt = () => page;
    Object.defineProperty(s, "unitScale", { value: 1 });
    s.toolState = { tool: "select", lassoFilter: undefined };
    s.select = vi.fn();
    run(s, "tapSelect", { index: 0 }, { x: 150, y: 120 }, 4);
    expect(s.heldText).toBe(view);
    expect(s.heldReturnTool).toBeNull();
    expect(classes.has("is-held")).toBe(true);
    expect(s.select).not.toHaveBeenCalled();
  });

  it("typing with the lasso: hiding the keyboard keeps the box selected", () => {
    const { s, view, classes } = holdable("select");
    s.heldReturnTool = "pen";
    Object.assign(s, {
      releaseTextEditingClass: vi.fn(),
      removeIfEmpty: vi.fn(),
      handBackFromText: vi.fn(),
    });
    run(s, "endTextEditing", view);
    expect(s.heldText).toBe(view);
    expect(s.heldReturnTool).toBe("pen");
    expect(classes.has("is-held") && classes.has("is-tappable")).toBe(true);
    expect(s.handBackFromText).not.toHaveBeenCalled();
  });

  it("typing with the lasso: a tap beside ends it, lets go and brings the tool back", () => {
    const { s, view } = holdable("select");
    const blur = vi.fn();
    (view as unknown as { input: { blur: () => void } }).input.blur = blur;
    s.editingTextView = () => view;
    s.heldReturnTool = "highlighter";
    expect(run(s, "tapWithHeldText", page, { x: 600, y: 600 })).toBe(true);
    expect(blur).toHaveBeenCalled();
    expect(s.setTool).toHaveBeenLastCalledWith("highlighter");
    // A tap on the box being typed in is the box's own (the caret).
    (s.toolState as { tool: ActiveTool }).tool = "select";
    s.editingTextView = () => view;
    s.focusTextBox = vi.fn();
    expect(run(s, "tapWithHeldText", page, { x: 150, y: 120 })).toBe(true);
    expect(s.focusTextBox).not.toHaveBeenCalled();
  });

  it("a held box scrolled entirely out of sight loses its frame for good, but stays parked", () => {
    const { s, view, classes } = holdable("select");
    const rect = (top: number) => ({
      top,
      bottom: top + 40,
      left: 100,
      right: 300,
      width: 200,
      height: 40,
    });
    let boxTop = 400;
    (view.root as unknown as { getBoundingClientRect: () => unknown }).getBoundingClientRect = () =>
      rect(boxTop);
    s.surfaceEl = {
      getBoundingClientRect: () => ({ top: 120, bottom: 800, left: 0, right: 1180 }),
    };
    s.heldText = view;
    s.heldReturnTool = "pen";
    classes.add("is-held");
    // Still showing, even by a sliver: nothing happens.
    boxTop = 790;
    run(s, "dropTextOutOfSight");
    expect(s.heldText).toBe(view);
    // Gone below the page: the frame goes, the tool stays, the box is parked.
    boxTop = 805;
    run(s, "dropTextOutOfSight");
    expect(s.heldText).toBeNull();
    expect(classes.has("is-held")).toBe(false);
    expect(s.setTool).not.toHaveBeenCalled();
    expect(s.parkedText).toMatchObject({ view, tool: "select", returnTool: "pen" });
    // Scrolled back: nothing comes back by itself.
    boxTop = 400;
    run(s, "dropTextOutOfSight");
    expect(s.heldText).toBeNull();
  });

  it("a tap on the parked box types in it at once; a tap elsewhere forgets it", () => {
    const { s, view } = holdable("select");
    s.focusTextBox = vi.fn();
    s.parkedText = { view, tool: "select", returnTool: "pen" };
    expect(run(s, "tapParkedText", page, { x: 150, y: 120 })).toBe(true);
    expect(s.focusTextBox).toHaveBeenCalledWith(view.input);
    expect(s.heldReturnTool).toBe("pen");
    expect(s.parkedText).toBeNull();
    // Elsewhere: forgotten, and the tool before the lasso comes back.
    s.parkedText = { view, tool: "select", returnTool: "pen" };
    expect(run(s, "tapParkedText", page, { x: 600, y: 600 })).toBe(true);
    expect(s.parkedText).toBeNull();
    expect(s.setTool).toHaveBeenLastCalledWith("pen");
    // Nothing parked: the lasso's own tap goes on.
    expect(run(s, "tapParkedText", page, { x: 150, y: 120 })).toBe(false);
  });

  it("another tool forgets the parked box, so a tap selects first again", () => {
    const { s, view } = holdable("select");
    s.focusTextBox = vi.fn();
    s.parkedText = { view, tool: "pen", returnTool: null };
    // Parked with the pen in hand, tapped with the lasso: the tool changed.
    expect(run(s, "tapParkedText", page, { x: 150, y: 120 })).toBe(false);
    expect(s.focusTextBox).not.toHaveBeenCalled();
    expect(s.parkedText).toBeNull();
  });

  it("a box being typed in that leaves the screen ends the typing too", () => {
    const { s, view } = holdable("select");
    const blur = vi.fn();
    (view as unknown as { input: { blur: () => void } }).input.blur = blur;
    (view.root as unknown as { getBoundingClientRect: () => unknown }).getBoundingClientRect =
      () => ({
        top: -200,
        bottom: -160,
        left: 100,
        right: 300,
        width: 200,
        height: 40,
      });
    s.surfaceEl = {
      getBoundingClientRect: () => ({ top: 120, bottom: 800, left: 0, right: 1180 }),
    };
    s.editingTextView = () => view;
    run(s, "dropTextOutOfSight");
    expect(blur).toHaveBeenCalled();
  });

  it("a held box is what the pill styles, and letting go hands the pill back", () => {
    const { s, view } = holdable("text");
    s.heldText = view;
    s.pushTextCommand = vi.fn();
    s.syncTextBoxes = vi.fn();
    s.changed = vi.fn();
    expect(run(s, "applyTextStyle", { bold: true })).toBe(true);
    expect(s.pushTextCommand).toHaveBeenCalledWith("p1:t1", expect.anything());
    run(s, "releaseHeldText");
    expect(s.heldText).toBeNull();
    expect((s.callbacks as Fake).onTextEditing).toHaveBeenLastCalledWith(null);
  });
});
