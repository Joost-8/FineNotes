/**
 * The pen type row is the only way to the highlighter without a keyboard:
 * the toolbar has no highlighter button, as in GoodNotes, where the
 * highlighter is a pen type. From 0.1.2 to 1.0.0 the pen menu showed only
 * the three pens, and the highlighter could not be picked on an iPad.
 */
import { describe, expect, it, vi } from "vitest";
import type { FakeEl } from "../fakes/obsidian";

vi.mock("obsidian", () => import("../fakes/obsidian"));

const { Toolbar, penRowTypes, penTypeFor } = await import("../../src/view/toolbar");
const { FakeEl: Element } = await import("../fakes/obsidian");

describe("the pen type row", () => {
  it("offers the highlighter as well as the four pens", () => {
    expect(penRowTypes({} as never).map((spec) => spec.id)).toEqual([
      "fountain",
      "ball",
      "brush",
      "calligraphy",
      "highlighter",
    ]);
  });

  it("shows them in the order the user put them in, and every one", () => {
    const state = { penTypeOrder: ["highlighter", "brush"] } as never;
    expect(penRowTypes(state).map((spec) => spec.id)).toEqual([
      "highlighter",
      "brush",
      "fountain",
      "ball",
      "calligraphy",
    ]);
  });

  it("switches to the highlighter tool when the highlighter is chosen", () => {
    const highlighter = penRowTypes({} as never).find((spec) => spec.id === "highlighter");
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

  it("repaints the pen row's icons in each pen's colour", async () => {
    const { bar, state } = await toolbar("pen");
    const replaced: string[] = [];
    const row = (id: string) => ({
      isConnected: true,
      querySelector: () => ({ replaceWith: () => replaced.push(id) }),
      toggleClass: () => undefined,
    });
    Object.assign(bar, {
      toolButtons: new Map(),
      colorSwatches: new Map(),
      widthButtons: new Map(),
      eraserSizeButtons: new Map(),
      penTypeButtons: new Map([
        ["fountain", row("fountain")],
        ["highlighter", row("highlighter")],
      ]),
      shapeButtons: new Map(),
      // A bar with no width yet: the tool change has nothing to fit (fitBar).
      barEl: { getBoundingClientRect: () => ({ width: 0 }) },
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

describe("the pen menu from the pen's side button (stylus-click.ts)", () => {
  /** A stand-in element: its classes, and whether it is in the document. */
  const el = (name: string, classes: string[] = [], connected = true) => ({
    name,
    isConnected: connected,
    style: { display: "" },
    hasClass: (cls: string) => classes.includes(cls),
  });

  async function bar(parts: { popover?: unknown; typeShown?: boolean; pen?: unknown }) {
    const { Toolbar } = await import("../../src/view/toolbar");
    const opened: string[] = [];
    const type = el("pen type");
    const toolbar = Object.assign(Object.create(Toolbar.prototype) as object, {
      state: { tool: "pen", penType: "fountain", color: "#000000", size: 3 },
      popover: parts.popover ?? null,
      penTypeButtons: new Map(parts.typeShown === undefined ? [] : [["fountain", type]]),
      optionsEl: el("pill", parts.typeShown === false ? ["is-collapsed"] : []),
      penToolButton: parts.pen === undefined ? el("bar pen") : parts.pen,
      moreButton: el("more"),
      barEl: el("bar"),
      openPenMenu: (from: { name: string }) => opened.push(`open from ${from.name}`),
      closePopover: () => opened.push("close"),
    }) as unknown as InstanceType<typeof Toolbar>;
    return { toolbar, opened };
  }

  it("hangs from the pen in hand's button while the pen's options show", async () => {
    const { toolbar, opened } = await bar({ typeShown: true });
    toolbar.togglePenMenu();
    expect(opened).toEqual(["open from pen type"]);
  });

  it("hangs from the pen on the bar when the options are tucked away, else from ⋯", async () => {
    const tucked = await bar({ typeShown: false });
    tucked.toolbar.togglePenMenu();
    expect(tucked.opened).toEqual(["open from bar pen"]);
    const folded = await bar({ pen: el("bar pen", ["is-overflowed"]) });
    folded.toolbar.togglePenMenu();
    expect(folded.opened).toEqual(["open from more"]);
  });

  it("closes whichever popover is open: the next click shuts what the last one opened", async () => {
    const { toolbar, opened } = await bar({ popover: {}, typeShown: true });
    toolbar.togglePenMenu();
    expect(opened).toEqual(["close"]);
  });
});

describe("the laser pointer's pill", () => {
  const globals = globalThis as unknown as Record<string, unknown>;

  /** The pill's elements, built with a document standing in for Obsidian's. */
  function laserPill(laserColor = "#ff3b30") {
    const optionsEl = new Element("div");
    const changes: string[] = [];
    const opened: Array<{ kind: string; current: string }> = [];
    const bar = Object.assign(Object.create(Toolbar.prototype) as object, {
      optionsEl,
      state: { tool: "laser", color: "#1a1a1a", size: 3, recentColors: [] },
      callbacks: { onLaserColorChange: (color: string) => changes.push(color) },
      options: { laserColor: () => laserColor },
      pillDock: { dock: "bottom" },
      widthButtons: new Map(),
      colorSwatches: new Map(),
      toggleColorPopover: (
        kind: string,
        _anchor: unknown,
        current: string,
        _pick: (color: string) => void,
      ) => opened.push({ kind, current }),
      buildOptions: () => undefined,
      syncActive: () => undefined,
    }) as unknown as { buildLaserOptions(): void };
    globals.activeDocument = {
      createElementNS: () => new Element("svg"),
      body: { hasClass: () => false },
    };
    try {
      bar.buildLaserOptions();
    } finally {
      delete globals.activeDocument;
    }
    return { optionsEl, changes, opened };
  }

  function all(el: FakeEl): FakeEl[] {
    return [el, ...el.children.flatMap(all)];
  }

  it("keeps the popup's icon and line, then one colour button with a caret", () => {
    const { optionsEl } = laserPill();
    const nodes = all(optionsEl);
    // The popup as it was: its icon, and its line of words.
    expect(nodes.some((node) => node.text.includes("Laser pointer (L)"))).toBe(true);
    expect(nodes.some((node) => node.classes.has("goodobsidian-tool-note-icon"))).toBe(true);
    // The Shape tool's colour well: one disc of the live colour, and its caret.
    const button = nodes.find((node) => node.classes.has("goodobsidian-shape-color"));
    expect(button?.tag).toBe("button");
    expect(button?.attrs["aria-label"]).toBe("Laser colour #ff3b30");
    const disc = nodes.find((node) => node.classes.has("goodobsidian-text-disc"));
    expect(disc?.style.background).toBe("#ff3b30");
    expect(nodes.some((node) => node.classes.has("goodobsidian-text-caret"))).toBe(true);
    // No palette in the pill itself, and nothing about strokes or widths.
    expect(nodes.some((node) => node.classes.has("goodobsidian-color-swatch"))).toBe(false);
    expect(nodes.some((node) => node.classes.has("goodobsidian-color-grid"))).toBe(false);
    expect(nodes.some((node) => node.classes.has("goodobsidian-width"))).toBe(false);
    expect(nodes.some((node) => node.classes.has("goodobsidian-sizes"))).toBe(false);
  });

  it("opens the Shape tool's own colour picker on a tap", () => {
    const { optionsEl, opened } = laserPill("#2a8ce0");
    const button = all(optionsEl).find((node) => node.classes.has("goodobsidian-shape-color"));
    expect(button).toBeDefined();
    button?.dispatch("click");
    expect(opened).toEqual([{ kind: "laser-color", current: "#2a8ce0" }]);
  });

  it("never paints its own icon", () => {
    const { optionsEl } = laserPill();
    for (const icon of all(optionsEl).filter((node) =>
      node.classes.has("goodobsidian-tool-note-icon"),
    )) {
      expect(icon.style.color).toBeUndefined();
    }
  });

  it("is not one of the pen types in the pen's row", () => {
    const ids = penRowTypes({} as never).map((spec) => spec.id);
    expect(ids).not.toContain("laser");
    expect(ids).toEqual(["fountain", "ball", "brush", "calligraphy", "highlighter"]);
  });
});
