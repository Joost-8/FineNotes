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
  it("offers the highlighter as well as the three pens", () => {
    expect(PEN_MENU_TYPES.map((spec) => spec.id)).toEqual([
      "fountain",
      "ball",
      "brush",
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
    expect(calls).toEqual([
      "color(#fab005)",
      "size(5)",
      "tool(highlighter)",
      "pressure(false)",
      "type(highlighter)",
      "build",
    ]);
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
