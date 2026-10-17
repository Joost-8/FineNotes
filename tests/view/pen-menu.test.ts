/**
 * The pen-type menu is the only way to the highlighter without a keyboard:
 * the toolbar has no highlighter button, as in GoodNotes, where the
 * highlighter is a pen type. From 0.1.2 to 1.0.0 the menu showed only the
 * three pens, and the highlighter could not be picked on an iPad.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("./fake-obsidian"));

const { PEN_MENU_TYPES, penTypeFor } = await import("../../src/view/toolbar");

describe("the pen-type menu", () => {
  it("offers the highlighter as well as the four pens", () => {
    expect(PEN_MENU_TYPES.map((spec) => spec.id)).toEqual([
      "fountain",
      "ball",
      "brush",
      "calligraphy",
      "highlighter",
    ]);
  });

  it("switches to the highlighter tool when the highlighter is chosen", () => {
    const highlighter = PEN_MENU_TYPES.find((spec) => spec.id === "highlighter");
    expect(highlighter).toMatchObject({ tool: "highlighter", label: "Highlighter" });
  });

  it("keeps the pen button's type in step with the highlighter tool", () => {
    expect(penTypeFor({ tool: "highlighter" } as never).id).toBe("highlighter");
    expect(penTypeFor({ tool: "pen" } as never).id).toBe("fountain");
  });
});

describe("saved pens on the toolbar (FineNotes#24, #25)", () => {
  async function toolbar(tool: string, practice = false) {
    const { Toolbar } = await import("../../src/view/toolbar");
    const calls: string[] = [];
    const state = { tool, color: "#000000", size: 3, pressureEnabled: false } as Record<
      string,
      unknown
    >;
    const bar = Object.assign(Object.create(Toolbar.prototype) as object, {
      state,
      practice,
      drawingTool: "pen",
      optionsTool: tool,
      optionsVisible: true,
      tuckedTools: new Set(),
      callbacks: {
        onColorChange: (c: string) => calls.push(`color(${c})`),
        onSizeChange: (s: number) => calls.push(`size(${s})`),
        onToolChange: (t: string) => calls.push(`tool(${t})`),
        onPressureToggle: (on: boolean) => calls.push(`pressure(${on})`),
        onPenTypeChange: (spec: { id: string }) => calls.push(`type(${spec.id})`),
        pressureAllowed: () => true,
      },
      buildOptions: () => calls.push("build"),
      syncActive: () => undefined,
    }) as unknown as InstanceType<typeof Toolbar>;
    return { bar, state, calls };
  }

  it("writes with a saved pen: its type, colour and width, leaving the eraser for it", async () => {
    const { bar, state, calls } = await toolbar("eraser");
    bar.applySavedPen({ type: "highlighter", color: "#fab005", size: 5 });
    expect(state).toMatchObject({
      tool: "highlighter",
      penType: "highlighter",
      color: "#fab005",
      size: 5,
      pressureEnabled: false,
    });
    // The type first (a highlighter never used starts yellow), then the saved
    // pen's own colour and width over it.
    expect(calls).toEqual([
      "color(#fab005)",
      "tool(highlighter)",
      "pressure(false)",
      "type(highlighter)",
      "build",
      "color(#fab005)",
      "size(5)",
      "build",
    ]);
    // The highlighter keeps the saved pen's width as its own, with the colour.
    expect((state.penInks as Record<string, unknown>).highlighter).toEqual({
      color: "#fab005",
      size: 5,
    });
  });

  it("gives each pen type its own colour and row, and brings them back", async () => {
    const { bar, state } = await toolbar("pen");
    const { PEN_TYPES } = await import("../../src/view/toolbar");
    const spec = (id: string) => PEN_TYPES.find((type) => type.id === id)!;
    const choose = (id: string) =>
      (bar as unknown as { choosePenType: (s: unknown) => void }).choosePenType(spec(id));
    state.penType = "fountain";
    state.color = "#1971c2";
    state.penColors = ["#1971c2", "#e03131"];
    choose("brush");
    // Never used, the brush starts with the fountain pen's ink.
    expect(state.color).toBe("#1971c2");
    state.color = "#9c36b5";
    state.penColors = ["#9c36b5"];
    choose("fountain");
    expect(state).toMatchObject({ color: "#1971c2", penColors: ["#1971c2", "#e03131"] });
    choose("brush");
    expect(state).toMatchObject({ color: "#9c36b5", penColors: ["#9c36b5"] });
    // The highlighter starts yellow and keeps its own from then on.
    choose("highlighter");
    expect(state.color).toBe("#fab005");
  });

  it("repaints the open pen menu's icons in each pen's colour", async () => {
    const { bar, state } = await toolbar("pen");
    const replaced: string[] = [];
    const row = (id: string) => ({
      isConnected: true,
      querySelector: () => ({ replaceWith: () => replaced.push(id) }),
      toggleClass: () => undefined,
    });
    Object.assign(bar, {
      popoverKind: "pens",
      penMenuRows: new Map([
        ["fountain", row("fountain")],
        ["highlighter", row("highlighter")],
      ]),
      toolButtons: new Map(),
      colorSwatches: new Map(),
      widthButtons: new Map(),
      eraserSizeButtons: new Map(),
      penTypeButtons: new Map(),
      shapeButtons: new Map(),
    });
    state.penType = "fountain";
    // Just enough of a document to build the icons.
    const element = (): unknown => ({ setAttribute: () => undefined, append: () => undefined });
    vi.stubGlobal("activeDocument", {
      createElementNS: element,
      body: { hasClass: () => false },
    });
    const { Toolbar } = await import("../../src/view/toolbar");
    Toolbar.prototype.syncActive.call(bar);
    vi.unstubAllGlobals();
    expect(replaced).toEqual(["fountain", "highlighter"]);
  });

  it("keeps the pressure for a pressure pen, and refuses the highlighter in a practice file", async () => {
    const { bar, state } = await toolbar("pen");
    bar.applySavedPen({ type: "fountain", color: "#1971c2", size: 5 });
    expect(state).toMatchObject({ tool: "pen", penType: "fountain", pressureEnabled: true });
    const practice = await toolbar("pen", true);
    practice.bar.applySavedPen({ type: "highlighter", color: "#fab005", size: 5 });
    expect(practice.calls).toEqual([]);
  });

  it("names the pen in hand as a saved pen would hold it", async () => {
    const { penOfState } = await import("../../src/view/toolbar");
    expect(penOfState({ tool: "highlighter", color: "#ff0000", size: 8 } as never)).toEqual({
      type: "highlighter",
      color: "#ff0000",
      size: 8,
    });
  });
});
