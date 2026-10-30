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

describe("Make shapes and the Auto shape button (FineNotes#84)", () => {
  const globals = globalThis as unknown as Record<string, unknown>;
  beforeEach(() => {
    globals.activeDocument = { createElementNS: () => fakeEl() };
  });
  afterEach(() => {
    delete globals.activeDocument;
  });

  type Patch = Record<string, unknown>;
  function makeShapes(snapMode: string) {
    const body = fakeEl();
    const saved: Patch[] = [];
    const state: Record<string, unknown> = { tool: "pen", snapMode };
    const toolbar = Object.assign(Object.create(Toolbar.prototype) as object, {
      state,
      callbacks: {},
    }) as unknown as {
      renderMakeShapes(body: unknown, prefs: unknown, save: (patch: Patch) => void): void;
    };
    toolbar.renderMakeShapes(body, { snapMode, snapCurve: 50 }, (patch) => saved.push(patch));
    const els = walk(body);
    const radio = (label: string) => els.find((el) => el.attrs["aria-label"] === label);
    const bar = els.find((el) => el.attrs["aria-label"]?.startsWith("How curved"));
    return { state, saved, radio, bar };
  }

  it("offers off, after a hold and on lift, marks the one in use, and saves a pick", () => {
    const { state, saved, radio } = makeShapes("hold");
    expect(radio("When I hold the pen still")?.attrs["aria-checked"]).toBe("true");
    expect(radio("Off")?.attrs["aria-checked"]).toBe("false");
    radio("When I lift the pen, too")?.click?.();
    expect(state.snapMode).toBe("auto");
    expect(saved).toEqual([{ snapMode: "auto" }]);
  });

  it("shows the curve bar only while shapes are on", () => {
    expect(makeShapes("hold").bar).toBeDefined();
    expect(makeShapes("auto").bar).toBeDefined();
    expect(makeShapes("disabled").bar).toBeUndefined();
  });

  it("has the pill's Auto shape button change the same setting, so the pen follows it", () => {
    const state: Record<string, unknown> = { tool: "pen", snapMode: "hold" };
    const saved: Patch[] = [];
    const toolbar = Object.assign(Object.create(Toolbar.prototype) as object, {
      state,
      callbacks: { onPenPreferences: (patch: Patch) => saved.push(patch) },
    }) as unknown as { toggleAutoShape(): void };
    toolbar.toggleAutoShape();
    expect(state.snapMode).toBe("auto");
    toolbar.toggleAutoShape();
    expect(state.snapMode).toBe("hold");
    state.snapMode = "disabled";
    toolbar.toggleAutoShape();
    expect(state.snapMode).toBe("auto");
    expect(saved).toEqual([{ snapMode: "auto" }, { snapMode: "hold" }, { snapMode: "auto" }]);
  });
});
