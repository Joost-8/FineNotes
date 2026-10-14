/**
 * A finger tap on a picture with a pen in hand picks the lasso and selects
 * the picture (`InkSurface.fingerPicksPicture`); a pen type keeps its own
 * width in the toolbar (`Toolbar.choosePenType`, `setWidth`).
 */

import { describe, expect, it, vi } from "vitest";
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
