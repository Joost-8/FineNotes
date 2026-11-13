/**
 * FineNotes#210 / #211: a preset keeps the width it was given. Before, the
 * slider changed only the width in hand, and the pill put that width in its
 * last slot, so to the user "the slider only changes the last preset".
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("../fakes/obsidian"));

const { Toolbar } = await import("../../src/view/toolbar");

interface Bar {
  pickWidthPreset(slot: number): void;
  editWidth(width: number): void;
  resetWidthPresets(): void;
  chosenWidthSlot(): number | null;
  widthPresets(): number[];
  pickEraserPreset(slot: number): void;
  editEraserSize(size: number): void;
  resetEraserPresets(): void;
  chosenEraserSlot(): number | null;
  eraserPresets(): number[];
  applySavedPen(pen: { type: string; color: string; size: number }): void;
  choosePenType(spec: unknown): void;
}

function toolbar(state: Record<string, unknown> = {}) {
  const saved: { widths: unknown[]; erasers: unknown[] } = { widths: [], erasers: [] };
  const full: Record<string, unknown> = {
    tool: "pen",
    penType: "ball",
    color: "#000000",
    size: 3,
    pressureEnabled: false,
    ...state,
  };
  const bar = Object.assign(Object.create(Toolbar.prototype) as object, {
    state: full,
    practice: false,
    drawingTool: "pen",
    optionsTool: "pen",
    optionsVisible: true,
    tuckedTools: new Set(),
    widthSlot: null,
    eraserSlot: null,
    options: {},
    callbacks: {
      onColorChange: () => undefined,
      onSizeChange: () => undefined,
      onToolChange: () => undefined,
      onPressureToggle: () => undefined,
      onPenTypeChange: () => undefined,
      pressureAllowed: () => true,
      onWidthPresets: (p: unknown) => saved.widths.push(structuredClone(p)),
      onEraserPresets: (p: unknown) => saved.erasers.push(structuredClone(p)),
    },
    buildOptions: () => undefined,
    syncActive: () => undefined,
  }) as unknown as Bar;
  return { bar, state: full, saved };
}

describe("pen width presets", () => {
  it("changes the picked preset with the slider and keeps the others", () => {
    const { bar, state, saved } = toolbar();
    bar.pickWidthPreset(0);
    bar.editWidth(2.5);
    expect(bar.widthPresets()).toEqual([2.5, 3, 5]);
    bar.pickWidthPreset(1);
    expect(state.size).toBe(3);
    bar.editWidth(4);
    expect(bar.widthPresets()).toEqual([2.5, 4, 5]);
    // Picking the first again brings its own width back.
    bar.pickWidthPreset(0);
    expect(state.size).toBe(2.5);
    expect(saved.widths.at(-1)).toEqual({ ball: [2.5, 4, 5] });
  });

  it("keeps each pen type's presets apart", () => {
    const { bar, state } = toolbar();
    bar.pickWidthPreset(2);
    bar.editWidth(8);
    state.penType = "fountain";
    expect(bar.widthPresets()).toEqual([2, 3, 5]);
    state.penType = "ball";
    expect(bar.widthPresets()).toEqual([2, 3, 8]);
  });

  it("follows a drag of the slider step by step on the same preset", () => {
    const { bar } = toolbar();
    bar.pickWidthPreset(1);
    for (const width of [3.5, 4, 4.5, 5, 5.5]) bar.editWidth(width);
    // Passing 5 (the third preset's width) does not move the edit to it.
    expect(bar.widthPresets()).toEqual([2, 5.5, 5]);
  });

  it("changes no preset for a width none holds (a saved pen's)", () => {
    const { bar, state, saved } = toolbar();
    bar.applySavedPen({ type: "ball", color: "#000000", size: 7 });
    expect(bar.chosenWidthSlot()).toBeNull();
    bar.editWidth(9);
    expect(state.size).toBe(9);
    expect(bar.widthPresets()).toEqual([2, 3, 5]);
    expect(saved.widths).toEqual([]);
  });

  it("chooses the preset a saved pen's width matches", () => {
    const { bar } = toolbar();
    bar.applySavedPen({ type: "ball", color: "#000000", size: 5 });
    expect(bar.chosenWidthSlot()).toBe(2);
  });

  it("resets the pen type's presets and writes with the chosen one's default", () => {
    const { bar, state } = toolbar({
      widthPresets: { ball: [1, 6, 9], fountain: [4, 4, 4] },
    });
    bar.pickWidthPreset(1);
    bar.resetWidthPresets();
    expect(bar.widthPresets()).toEqual([2, 3, 5]);
    expect(state.size).toBe(3);
    expect(state.widthPresets).toEqual({ fountain: [4, 4, 4] });
  });

  it("tells two presets with the same width apart by the last pick", () => {
    const { bar } = toolbar({ widthPresets: { ball: [3, 3, 5] } });
    bar.pickWidthPreset(1);
    bar.editWidth(4);
    expect(bar.widthPresets()).toEqual([3, 4, 5]);
  });
});

describe("eraser presets", () => {
  it("changes the picked size and keeps the others", () => {
    const { bar, state, saved } = toolbar({ tool: "eraser" });
    bar.pickEraserPreset(2);
    bar.editEraserSize(80);
    expect(bar.eraserPresets()).toEqual([10, 24, 80]);
    bar.pickEraserPreset(0);
    expect(state.eraserSize).toBe(10);
    bar.pickEraserPreset(2);
    expect(state.eraserSize).toBe(80);
    expect(saved.erasers.at(-1)).toEqual([10, 24, 80]);
  });

  it("resets to the default sizes", () => {
    const { bar, state } = toolbar({ tool: "eraser", eraserPresets: [6, 30, 100], eraserSize: 30 });
    expect(bar.chosenEraserSlot()).toBe(1);
    bar.resetEraserPresets();
    expect(bar.eraserPresets()).toEqual([10, 24, 48]);
    expect(state.eraserSize).toBe(24);
  });
});
