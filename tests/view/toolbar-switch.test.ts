/**
 * `src/view/toolbar.ts` — a switch row in a popover flips on every tap and
 * shows it, also in a popover that does not redraw after a change (the
 * table picker's Header row); and the eraser mode list's switch, "Grey out
 * while erasing" (discussion #51).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("obsidian", () => import("./fake-obsidian"));
const { Toolbar } = await import("../../src/view/toolbar");

/** Just enough of an element for `switchRow`. */
function fakeRow() {
  const classes = new Set<string>();
  const attrs: Record<string, string> = {};
  let click: (() => void) | undefined;
  const span = { createSpan: () => span };
  const row = {
    createSpan: () => span,
    toggleClass: (cls: string, on: boolean) => (on ? classes.add(cls) : classes.delete(cls)),
    setAttribute: (name: string, value: string) => (attrs[name] = value),
    addEventListener: (_type: string, handler: () => void) => (click = handler),
  };
  return {
    parent: { createEl: () => row },
    tap: () => click?.(),
    on: () => classes.has("is-on"),
    attrs,
  };
}

describe("switch rows", () => {
  it("flip and show it on each tap, without the popover redrawing", () => {
    const toolbar = Object.create(Toolbar.prototype) as {
      switchRow(
        parent: unknown,
        label: string,
        on: boolean,
        change: (on: boolean) => void,
      ): unknown;
    };
    const el = fakeRow();
    const changes: boolean[] = [];
    toolbar.switchRow(el.parent, "Header row", false, (on) => changes.push(on));
    expect(el.on()).toBe(false);
    el.tap();
    expect(el.on()).toBe(true);
    expect(el.attrs["aria-checked"]).toBe("true");
    el.tap();
    expect(el.on()).toBe(false);
    expect(el.attrs["aria-checked"]).toBe("false");
    expect(changes).toEqual([true, false]);
  });
});

/** An element that accepts any call, keeping what tests read: text, attributes, click handlers. */
interface FakeEl {
  text: string;
  attrs: Record<string, string>;
  children: FakeEl[];
  click?: () => void;
}

function fakeEl(text = "", attrs: Record<string, string> = {}): FakeEl {
  const node: FakeEl = { text, attrs, children: [] };
  return new Proxy(node, {
    get(target, prop) {
      if (prop in target) return target[prop as keyof FakeEl];
      if (prop === "addEventListener") {
        return (type: string, handler: () => void) => {
          if (type === "click") target.click = handler;
        };
      }
      if (prop === "setAttribute") return (name: string, value: string) => (attrs[name] = value);
      if (typeof prop !== "string" || !/^create/.test(prop)) return () => undefined;
      return (_tag?: unknown, opts?: { text?: string; attr?: Record<string, string> }) => {
        const options = typeof _tag === "object" ? (_tag as typeof opts) : opts;
        const child = fakeEl(options?.text ?? "", { ...(options?.attr ?? {}) });
        target.children.push(child);
        return child;
      };
    },
  }) as FakeEl;
}

function walk(el: FakeEl): FakeEl[] {
  return [el, ...el.children.flatMap(walk)];
}

describe("the eraser's mode list", () => {
  // The modes' own icons are drawn as SVG through Obsidian's `activeDocument`.
  const globals = globalThis as unknown as Record<string, unknown>;
  beforeEach(() => {
    globals.activeDocument = { createElementNS: () => fakeEl() };
  });
  afterEach(() => {
    delete globals.activeDocument;
  });

  it("ends with Grey out while erasing, which sets the state and tells the host", () => {
    const body = fakeEl();
    const changes: boolean[] = [];
    const state: Record<string, unknown> = { tool: "eraser", eraserMode: "stroke" };
    const toolbar = Object.assign(Object.create(Toolbar.prototype) as object, {
      state,
      popoverKind: null,
      openPopover: () => body,
      callbacks: { onEraserGreyChange: (on: boolean) => changes.push(on) },
    }) as unknown as { toggleEraserModeList(anchor: unknown): void };
    toolbar.toggleEraserModeList(fakeEl());
    const rows = walk(body);
    const grey = rows.find((el) => el.attrs["aria-label"] === "Grey out while erasing");
    expect(grey?.attrs["aria-checked"]).toBe("false");
    expect(rows.some((el) => el.text === "Whole stroke and By line.")).toBe(true);
    grey?.click?.();
    expect(state.eraserGrey).toBe(true);
    grey?.click?.();
    expect(state.eraserGrey).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it("shows the switch on when the state says so", () => {
    const body = fakeEl();
    const toolbar = Object.assign(Object.create(Toolbar.prototype) as object, {
      state: { tool: "eraser", eraserMode: "ruled", eraserGrey: true },
      popoverKind: null,
      openPopover: () => body,
      callbacks: {},
    }) as unknown as { toggleEraserModeList(anchor: unknown): void };
    toolbar.toggleEraserModeList(fakeEl());
    const grey = walk(body).find((el) => el.attrs["aria-label"] === "Grey out while erasing");
    expect(grey?.attrs["aria-checked"]).toBe("true");
  });
});

describe("the Magnifier's Zoom box", () => {
  /** A tool button that keeps the classes and attributes `syncActive` writes. */
  function toolButton() {
    const classes = new Set<string>();
    const attrs: Record<string, string> = {};
    return {
      toggleClass: (cls: string, on: boolean) => {
        if (on) classes.add(cls);
        else classes.delete(cls);
      },
      setAttribute: (name: string, value: string) => {
        attrs[name] = value;
      },
      hasClass: (cls: string) => classes.has(cls),
      attrs,
    };
  }

  function toolbarWith(state: Record<string, unknown>, buttons: Map<string, unknown>) {
    return Object.assign(Object.create(Toolbar.prototype) as object, {
      state,
      indicatorTool: "pen",
      toolButtons: buttons,
      colorSwatches: new Map(),
      widthButtons: new Map(),
      eraserSizeButtons: new Map(),
      penTypeButtons: new Map(),
      shapeButtons: new Map(),
      activePenType: () => ({ id: "pen" }),
      toolPlaces: () => null,
      placeIndicator: () => {},
      fitBar: () => {},
      drawPenPreview: () => {},
      drawLassoIcon: () => {},
      drawEraserIcon: () => {},
      inkColorOf: () => "#000000",
      callbacks: {},
    }) as unknown as { state: Record<string, unknown>; syncActive(): void };
  }

  it("keeps the Magnifier lit while a Zoom box is open under another tool", () => {
    const pen = toolButton();
    const zoom = toolButton();
    const toolbar = toolbarWith(
      { tool: "pen", color: "#000000", size: 4, zoomBoxOpen: true },
      new Map<string, unknown>([
        ["pen", pen],
        ["zoom", zoom],
      ]),
    );
    toolbar.syncActive();
    expect(pen.hasClass("is-active")).toBe(true);
    // Stylus only carries `is-on` alone; the Magnifier must too, or the
    // indicator's transparent-active rule leaves only the icon tinted.
    expect(zoom.hasClass("is-active")).toBe(false);
    expect(zoom.hasClass("is-on")).toBe(true);
    expect(zoom.attrs["aria-pressed"]).toBe("true");
  });

  it("leaves the Magnifier a plain tool button when no box is open", () => {
    const pen = toolButton();
    const zoom = toolButton();
    const toolbar = toolbarWith(
      { tool: "pen", color: "#000000", size: 4, zoomBoxOpen: false },
      new Map<string, unknown>([
        ["pen", pen],
        ["zoom", zoom],
      ]),
    );
    toolbar.syncActive();
    expect(zoom.hasClass("is-active")).toBe(false);
    expect(zoom.hasClass("is-on")).toBe(false);
    expect(zoom.attrs["aria-pressed"]).toBe("false");
  });

  /** A bare toolbar whose Zoom box callbacks are recorded. */
  function magnifierBar(state: Record<string, unknown>) {
    const onZoomBoxOpen = vi.fn();
    const onToolChange = vi.fn();
    const syncActive = vi.fn();
    const buildOptions = vi.fn();
    const toolbar = Object.assign(Object.create(Toolbar.prototype) as object, {
      state,
      drawingTool: "pen",
      optionsTool: "pen",
      optionsVisible: false,
      tuckedTools: new Set(),
      callbacks: { onZoomBoxOpen, onToolChange, returnToPenOnReselect: () => false },
      syncActive,
      buildOptions,
      closePopover: () => {},
    }) as unknown as {
      state: Record<string, unknown>;
      tapTool(tool: string, button: unknown): void;
    };
    return { toolbar, onZoomBoxOpen, onToolChange, syncActive, buildOptions };
  }

  it("opens the Zoom box in one tap in Zoom box mode, keeping the pen in hand", () => {
    const bar = magnifierBar({ tool: "pen", zoomBox: true, zoomBoxOpen: false });
    bar.toolbar.tapTool("zoom", {});
    expect(bar.onZoomBoxOpen).toHaveBeenCalledWith(true);
    expect(bar.onToolChange).not.toHaveBeenCalled();
    expect(bar.toolbar.state.tool).toBe("pen");
    // The mode is remembered.
    expect(bar.toolbar.state.zoomBox).toBe(true);
  });

  it("picks the Magnifier with a box open, then closes the box on the next tap", () => {
    const open = magnifierBar({ tool: "pen", zoomBox: true, zoomBoxOpen: true });
    open.toolbar.tapTool("zoom", {});
    expect(open.onZoomBoxOpen).not.toHaveBeenCalled();
    expect(open.onToolChange).toHaveBeenCalledWith("zoom");
    const held = magnifierBar({ tool: "zoom", zoomBox: true, zoomBoxOpen: true });
    held.toolbar.tapTool("zoom", {});
    expect(held.onZoomBoxOpen).toHaveBeenCalledWith(false);
    expect(held.toolbar.state.zoomBoxOpen).toBe(false);
    expect(held.toolbar.state.zoomBox).toBe(true);
  });

  it("stays a tool like any other in Page zoom mode", () => {
    const bar = magnifierBar({ tool: "pen", zoomBox: false, zoomBoxOpen: false });
    bar.toolbar.tapTool("zoom", {});
    expect(bar.onZoomBoxOpen).not.toHaveBeenCalled();
    expect(bar.onToolChange).toHaveBeenCalledWith("zoom");
  });
});
