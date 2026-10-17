/**
 * An undo or redo names the step in the readout pill, as Procreate's notice
 * does ("Undid: Change shape style"), however it was asked for: the bar's
 * buttons, a shortcut, or a two- or three-finger double tap.
 */

import { describe, expect, it, vi } from "vitest";
vi.mock("obsidian", () => import("./fake-obsidian"));
const { InkSurface } = await import("../../src/view/ink-surface");

type Fake = Record<string, unknown> & { flashReadout: ReturnType<typeof vi.fn> };
const run = (obj: Fake, method: string, ...args: unknown[]): unknown =>
  (obj[method] as (...args: unknown[]) => unknown).apply(obj, args);

function surface(undone: { label: string } | null, redone: { label: string } | null): Fake {
  return Object.assign(Object.create(InkSurface.prototype), {
    doc: { pages: [] },
    history: {
      undo: () => undone,
      redo: () => redone,
      canUndo: () => undone !== null,
      canRedo: () => redone !== null,
    },
    callbacks: {},
    strokeIndex: { rebuild: vi.fn() },
    renderer: null,
    endCrop: vi.fn(),
    cancelImageDrag: vi.fn(),
    cancelGroupDrag: vi.fn(),
    readingPlace: vi.fn(),
    dropSelection: vi.fn(),
    layoutStale: () => false,
    renderAll: vi.fn(),
    reportTextEditing: vi.fn(),
    changed: vi.fn(),
    revealChange: vi.fn(),
    flashReadout: vi.fn(),
  }) as Fake;
}

describe("the undo notice", () => {
  it("names the step undone and the step redone", () => {
    const s = surface({ label: "Change shape style" }, { label: "Add page" });
    run(s, "undo");
    expect(s.flashReadout).toHaveBeenLastCalledWith(
      "Undid: Change shape style",
      expect.any(Number),
    );
    run(s, "redo");
    expect(s.flashReadout).toHaveBeenLastCalledWith("Redid: Add page", expect.any(Number));
  });

  it("says nothing when there was nothing to undo", () => {
    const s = surface(null, null);
    run(s, "undo");
    expect(s.flashReadout).not.toHaveBeenCalled();
  });

  it("names the step for a finger double tap too, once", () => {
    const s = surface({ label: "Erase" }, null);
    run(s, "fingerDoubleTap", 2);
    expect(s.flashReadout).toHaveBeenCalledTimes(1);
    expect(s.flashReadout).toHaveBeenCalledWith("Undid: Erase", expect.any(Number));
    run(s, "fingerDoubleTap", 3);
    expect(s.flashReadout).toHaveBeenLastCalledWith("Nothing to redo");
  });
});
