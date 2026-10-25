/**
 * The "One item" lasso (`LassoMode` "single"): the pen takes what it lands
 * on and moves it in the same stroke; on empty paper it draws no loop and
 * a hold opens the Paste bar (`InkSurface.pickStart` / `pickMove` / `pickEnd`).
 */

import { describe, expect, it, vi } from "vitest";
vi.mock("obsidian", () => import("./fake-obsidian"));
const { InkSurface } = await import("../../src/view/ink-surface");

type Fake = Record<string, unknown>;
const run = (obj: Fake, method: string, ...args: unknown[]): unknown =>
  (obj[method] as (...args: unknown[]) => unknown).apply(obj, args);

const box = { index: 0 };
const selection = { pageId: "p1", strokes: [{ id: "s1" }], images: [], textBoxes: [] };

function surface(hit: boolean) {
  const s: Fake = Object.create(InkSurface.prototype) as Fake;
  // A getter on the class: shadow it on the instance.
  Object.defineProperty(s, "unitScale", { value: 1 });
  Object.assign(s, {
    groupDrag: null,
    picking: null,
    activePage: 0,
    callbacks: {},
    tapSelect: vi.fn(),
    liveSelection: vi.fn(() => (hit ? selection : null)),
    groupBounds: vi.fn(() => ({ minX: 0, minY: 0, maxX: 10, maxY: 10 })),
    toPage: vi.fn((_box: unknown, p: { x: number; y: number }) => p),
    dragCircleSelection: vi.fn(),
    startPress: vi.fn(),
    stopPress: vi.fn(),
    openPressMenu: vi.fn(),
  });
  s.endGroupDrag = vi.fn(() => {
    s.groupDrag = null;
  });
  return s;
}

describe("the One item lasso", () => {
  it("picks up what it lands on and moves it with the same stroke", () => {
    const s = surface(true);
    run(s, "pickStart", box, { x: 5, y: 5 });
    expect(s.tapSelect).toHaveBeenCalledWith(box, { x: 5, y: 5 }, expect.any(Number));
    expect(s.groupDrag).toMatchObject({ selection, from: { x: 5, y: 5 }, lifted: false });
    expect(s.startPress).not.toHaveBeenCalled();

    run(s, "pickMove", box, [{ x: 40, y: 5 }]);
    expect(s.dragCircleSelection).toHaveBeenCalledWith(box, { x: 40, y: 5 });

    (s.groupDrag as { lifted: boolean }).lifted = true;
    run(s, "pickEnd");
    expect(s.endGroupDrag).toHaveBeenCalledWith(true);
    expect(s.picking).toBeNull();
    expect(s.activePage).toBeNull();
  });

  it("a tap leaves the one thing selected and commits no move", () => {
    const s = surface(true);
    run(s, "pickStart", box, { x: 5, y: 5 });
    run(s, "pickEnd");
    expect(s.endGroupDrag).toHaveBeenCalledWith(false);
  });

  it("on empty paper draws nothing, moves nothing, and a hold opens the bar", () => {
    const s = surface(false);
    run(s, "pickStart", box, { x: 5, y: 5 });
    expect(s.groupDrag).toBeNull();
    expect(s.startPress).toHaveBeenCalledTimes(1);
    const open = (s.startPress as ReturnType<typeof vi.fn>).mock.calls[0][0] as () => void;
    open();
    expect(s.openPressMenu).toHaveBeenCalledWith(box, { x: 5, y: 5 });

    run(s, "pickMove", box, [{ x: 60, y: 60 }]);
    expect(s.stopPress).toHaveBeenCalled();
    expect(s.dragCircleSelection).not.toHaveBeenCalled();
    run(s, "pickEnd");
    expect(s.endGroupDrag).not.toHaveBeenCalled();
  });

  it("does not move anything in a locked notebook", () => {
    const s = surface(true);
    s.callbacks = { isLocked: () => true };
    run(s, "pickStart", box, { x: 5, y: 5 });
    expect(s.groupDrag).toBeNull();
    run(s, "pickMove", box, [{ x: 60, y: 60 }]);
    expect(s.dragCircleSelection).not.toHaveBeenCalled();
  });
});
