/**
 * The pen button and a return to "the pen" pick the pen type in hand: with
 * the highlighter as the type, strokes must be highlighter strokes, never
 * opaque pen ink in the highlighter's colour (Joost's notebook, 2026-10-15).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveTool } from "../../src/view/toolbar";
vi.mock("obsidian", () => import("./fake-obsidian"));
const { Toolbar } = await import("../../src/view/toolbar");
const { InkSurface } = await import("../../src/view/ink-surface");

type Fake = Record<string, unknown>;
const run = (obj: Fake, method: string, ...args: unknown[]): unknown =>
  (obj[method] as (...args: unknown[]) => unknown).apply(obj, args);

describe("the pen button", () => {
  function toolbar(tool: ActiveTool, penType: string) {
    return Object.assign(Object.create(Toolbar.prototype), {
      state: { tool, penType },
      optionsVisible: true,
      tuckedTools: new Set(),
      optionsTool: tool,
      callbacks: { returnToPenOnReselect: () => false, onToolChange: vi.fn() },
      closePopover: vi.fn(),
      showOptions: vi.fn(),
      buildOptions: vi.fn(),
      syncActive: vi.fn(),
    }) as Fake & {
      state: { tool: ActiveTool };
      callbacks: { onToolChange: ReturnType<typeof vi.fn> };
    };
  }

  it("picks the highlighter when that is the pen type in hand", () => {
    const t = toolbar("select", "highlighter");
    run(t, "tapTool", "pen", {});
    expect(t.state.tool).toBe("highlighter");
    expect(t.callbacks.onToolChange).toHaveBeenCalledWith("highlighter");
  });

  it("picks the pen for a pen type, and only tucks the options when it is in hand", () => {
    const t = toolbar("eraser", "ball");
    run(t, "tapTool", "pen", {});
    expect(t.state.tool).toBe("pen");
    const h = toolbar("highlighter", "highlighter");
    run(h, "tapTool", "pen", {});
    expect(h.state.tool).toBe("highlighter");
    expect(h.callbacks.onToolChange).not.toHaveBeenCalled();
    expect(h.showOptions).toHaveBeenCalledWith(false);
  });
});

describe("the surface's return to the pen", () => {
  beforeEach(() => vi.stubGlobal("window", globalThis));
  afterEach(() => vi.unstubAllGlobals());

  function surface(penType: string | undefined) {
    return Object.assign(Object.create(InkSurface.prototype), {
      toolState: { tool: "text", penType },
      toolSeen: "text",
      callbacks: {},
      surfaceEl: { toggleClass: vi.fn() },
      dropSelection: vi.fn(),
      syncLockBadges: vi.fn(),
      syncSpaceHandles: vi.fn(),
      syncPenCursor: vi.fn(),
      prefetchText: vi.fn(),
      dropTextMark: vi.fn(),
      releaseHeldText: vi.fn(),
      hideTextHint: vi.fn(),
      blurTextBox: vi.fn(),
      cancelPendingReturn: vi.fn(),
    }) as Fake & { toolState: { tool: ActiveTool } };
  }

  it("goes back to the highlighter when that is the pen type", () => {
    const s = surface("highlighter");
    run(s, "setTool", "pen");
    expect(s.toolState.tool).toBe("highlighter");
  });

  it("goes back to the pen for a pen type, or without one; the H key still gives the highlighter", () => {
    for (const type of ["fountain", undefined]) {
      const s = surface(type);
      run(s, "setTool", "pen");
      expect(s.toolState.tool).toBe("pen");
    }
    // The H key asks for the highlighter itself: it stays the highlighter.
    const s = surface("brush");
    run(s, "setTool", "highlighter");
    expect(s.toolState.tool).toBe("highlighter");
  });
});
