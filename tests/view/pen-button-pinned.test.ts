/**
 * The pen's own button beside pens pinned to the bar (FineNotes#211): it
 * keeps its own pen, shows it, and gives it back at a tap, whatever the
 * pinned pen is. A pinned highlighter used to stay in hand: the tap only
 * tucked its options away, and after another tool the pen's button drew a
 * second highlighter.
 */

import { describe, expect, it, vi } from "vitest";
import type { SavedPen } from "../../src/model/saved-pens";
import type { ActiveTool } from "../../src/view/toolbar";
import { type ToolbarLayout, defaultLayout, normalizeLayout } from "../../src/view/toolbar-layout";
vi.mock("obsidian", () => import("./fake-obsidian"));
const { Toolbar } = await import("../../src/view/toolbar");

type Fake = Record<string, unknown> & {
  state: { tool: ActiveTool; penType: string; color: string; size: number };
  handButton: string | null;
  applySavedPen: ReturnType<typeof vi.fn>;
  showOptions: ReturnType<typeof vi.fn>;
};
const run = (obj: Fake, method: string, ...args: unknown[]): unknown =>
  (obj[method] as (...args: unknown[]) => unknown).apply(obj, args);

const FOUNTAIN: SavedPen = { type: "fountain", color: "#1a1a1a", size: 3 };
const MARKER: SavedPen = { id: "hl", type: "highlighter", color: "#fab005", size: 20 };
const BALL: SavedPen = { id: "bp", type: "ball", color: "#2f9e44", size: 2 };

/** The default bar with `slots` right after the pen's button. */
function withSlots(...slots: string[]): ToolbarLayout {
  const layout = defaultLayout();
  const at = layout.middle.indexOf("pen") + 1;
  layout.middle.splice(at, 0, ...(slots as ToolbarLayout["middle"]));
  return normalizeLayout(layout);
}

/** A bar with `slot` pinned and `inHand` as the pen the state holds. */
function bar(
  slot: string,
  tool: ActiveTool,
  inHand: SavedPen,
  over: Record<string, unknown> = {},
): Fake {
  return Object.assign(Object.create(Toolbar.prototype), {
    state: {
      tool,
      penType: inHand.type,
      color: inHand.color,
      size: inHand.size,
      penInks: { fountain: { color: "#1971c2", size: 4 } },
    },
    layoutNow: withSlots(slot),
    // The pinned pen's button was the last pen button tapped.
    handButton: slot,
    mainPen: FOUNTAIN,
    penButtonRecent: [],
    practice: false,
    drawingTool: "pen",
    optionsVisible: true,
    tuckedTools: new Set(),
    tuckedByStroke: false,
    optionsTool: tool,
    callbacks: {
      returnToPenOnReselect: () => false,
      onToolChange: vi.fn(),
      savedPens: () => [MARKER, BALL],
    },
    closePopover: vi.fn(),
    showOptions: vi.fn(),
    buildOptions: vi.fn(),
    syncActive: vi.fn(),
    applySavedPen: vi.fn(),
    ...over,
  }) as Fake;
}

describe("the pen's own button beside a pinned pen", () => {
  it("gives its own pen back after a pinned highlighter", () => {
    const b = bar("saved:hl", "highlighter", MARKER);
    run(b, "tapTool", "pen", {});
    expect(b.applySavedPen).toHaveBeenCalledWith(FOUNTAIN);
    expect(b.handButton).toBe("main");
    // It did not just tuck the pinned pen's options away.
    expect(b.showOptions).not.toHaveBeenCalled();
  });

  it("gives its own pen back after a pinned highlighter and another tool", () => {
    const b = bar("saved:hl", "eraser", MARKER);
    run(b, "tapTool", "pen", {});
    expect(b.applySavedPen).toHaveBeenCalledWith(FOUNTAIN);
    expect(b.state.tool).toBe("eraser"); // `applySavedPen` (a stub here) switches the tool
    expect(b.handButton).toBe("main");
  });

  it.each([
    ["a pinned saved pen", "saved:bp", BALL],
    ["a pinned pen type", "pen:ball", BALL],
    ["a pinned highlighter type", "pen:highlighter", MARKER],
  ])("gives its own pen back after %s, and is then the button in hand", (_name, slot, pen) => {
    const b = bar(slot, pen.type === "highlighter" ? "highlighter" : "pen", pen);
    run(b, "tapTool", "pen", {});
    expect(b.applySavedPen).toHaveBeenCalledWith(FOUNTAIN);
    expect(b.handButton).toBe("main");
    expect(run(b, "penSlotInHand")).toBeNull();
  });

  it("shows its own pen while a pinned pen writes, and after another tool is picked", () => {
    for (const tool of ["highlighter", "eraser", "text"] as ActiveTool[]) {
      expect(run(bar("saved:hl", tool, MARKER), "penButtonPen")).toEqual(FOUNTAIN);
    }
    // Its own pen in hand: the button shows the state, nothing kept.
    const own = bar("saved:hl", "pen", FOUNTAIN, { handButton: "main" });
    expect(run(own, "penButtonPen")).toBeNull();
  });

  it("has a pen to give in a notebook opened with the pinned pen in hand", () => {
    // Nothing tapped yet and no pen kept: another type, in that type's own ink.
    const fresh = { handButton: null, mainPen: null };
    for (const tool of ["highlighter", "eraser"] as ActiveTool[]) {
      const b = bar("saved:hl", tool, MARKER, fresh);
      expect(run(b, "penButtonPen")).toEqual({ type: "fountain", color: "#1971c2", size: 4 });
      run(b, "tapTool", "pen", {});
      expect(b.applySavedPen).toHaveBeenCalledWith({ type: "fountain", color: "#1971c2", size: 4 });
    }
  });

  it("does not take the pinned pen for its own", () => {
    // Opening a notebook draws the bar once before its layout and saved pens
    // are known, and that draw kept the pen in hand as the pen's own (seen in
    // the Android rig): the pen's button then gave the pinned pen itself.
    const b = bar("saved:hl", "highlighter", MARKER, { handButton: null, mainPen: { ...MARKER } });
    expect(run(b, "penButtonPen")).toEqual({ type: "fountain", color: "#1971c2", size: 4 });
  });

  it("does not give back a pen whose type has since got a button of its own", () => {
    const layout = withSlots("saved:hl", "pen:fountain");
    const b = bar("saved:hl", "highlighter", MARKER, { layoutNow: layout });
    const own = run(b, "penButtonPen") as SavedPen;
    expect(own.type).not.toBe("fountain");
    expect(own.type).not.toBe("highlighter");
  });

  it("keeps the highlighter out of a practice sheet", () => {
    const own: SavedPen = { type: "highlighter", color: "#ffd43b", size: 12 };
    const b = bar("saved:bp", "pen", BALL, { mainPen: own, practice: true });
    run(b, "tapTool", "pen", {});
    expect(b.applySavedPen).not.toHaveBeenCalled();
    expect(b.handButton).toBe("saved:bp");
  });

  it("still shows or tucks away its options when its own pen is in hand", () => {
    for (const [tool, pen] of [
      ["pen", FOUNTAIN],
      ["highlighter", { type: "highlighter", color: "#ffd43b", size: 12 } as SavedPen],
    ] as [ActiveTool, SavedPen][]) {
      const b = bar("saved:hl", tool, pen, { handButton: "main", mainPen: pen });
      run(b, "tapTool", "pen", {});
      expect(b.applySavedPen).not.toHaveBeenCalled();
      expect(b.showOptions).toHaveBeenCalledWith(false);
      expect(b.state.tool).toBe(tool);
    }
  });
});
