import { describe, expect, it } from "vitest";
import { COAST_PX, coasting } from "../../src/canvas/coast";
import { KineticScroller } from "../../src/canvas/scroll-physics";

const still = { complete: true, held: false, zooming: false };

describe("coasting", () => {
  it("holds within COAST_PX of a snap's end", () => {
    expect(coasting({ ...still, remaining: COAST_PX })).toBe(true);
    expect(coasting({ ...still, remaining: 0.4 })).toBe(true);
    expect(coasting({ ...still, remaining: COAST_PX + 0.1 })).toBe(false);
  });

  it("never without a place the view is heading for", () => {
    // At rest the idle prefetch runs; a fling's end is not known.
    expect(coasting({ ...still, remaining: null })).toBe(false);
  });

  it("gives way to a finger, a pinch or the pen, to a zoom, and to a paint with tiles to make", () => {
    expect(coasting({ ...still, remaining: 2, held: true })).toBe(false);
    expect(coasting({ ...still, remaining: 2, zooming: true })).toBe(false);
    expect(coasting({ ...still, remaining: 2, complete: false })).toBe(false);
  });
});

/**
 * A row of iPad-wide pages, a swipe of `dragged` px let go at `speed` px/ms,
 * then the turn's snap to the next page, stepped at `hz`. Returns each
 * frame's time since the lift, how far it moved and whether it coasted.
 */
function turn(
  hz: number,
  dragged = 420,
  speed = 2.8,
): { t: number; moved: number; coasts: boolean }[] {
  const page = 1196;
  const s = new KineticScroller();
  s.setExtent({
    contentWidth: page * 6,
    contentHeight: 820,
    viewportWidth: 1180,
    viewportHeight: 820,
  });
  const frame = 1000 / hz;
  // The finger goes left, the content with it.
  s.dragStart(800, 400, 0);
  const steps = 18;
  for (let i = 1; i <= steps; i++)
    s.dragMove(800 - (dragged * i) / steps, 400, (i * dragged) / speed / steps);
  const lift = dragged / speed;
  s.dragEnd(lift);
  s.snapTo(page, null, lift);
  const out: { t: number; moved: number; coasts: boolean }[] = [];
  let last = s.position.x;
  for (let i = 1; i < 400; i++) {
    const moving = s.step(lift + i * frame);
    const x = s.position.x;
    out.push({
      t: i * frame,
      moved: Math.abs(x - last),
      coasts: coasting({ ...still, remaining: s.remaining }),
    });
    last = x;
    if (!moving) break;
  }
  expect(s.position.x).toBe(page);
  return out;
}

describe("a page turn's coast", () => {
  for (const hz of [60, 120]) {
    it(`at ${hz} Hz: the end of the turn, long enough to make a page's tiles`, () => {
      const frames = turn(hz);
      const first = frames.findIndex((f) => f.coasts);
      expect(first).toBeGreaterThan(0);
      // Once coasting it stays so until the spring stops, where `remaining` is null.
      const tail = frames.slice(first, -1);
      expect(tail.every((f) => f.coasts)).toBe(true);
      expect(frames[frames.length - 1].coasts).toBe(false);
      // A good share of the turn: before, the tiles waited for all of it to pass.
      const total = frames[frames.length - 1].t;
      const coast = total - frames[first].t;
      expect(coast).toBeGreaterThan(120);
      expect(coast / total).toBeGreaterThan(0.25);
    });

    it(`at ${hz} Hz: no coasting frame moves the page far enough for a late one to show`, () => {
      const frames = turn(hz).filter((f) => f.coasts);
      // Two frames' worth, should one run long: under 5 px at 60 Hz, 2.5 at 120.
      const most = Math.max(...frames.map((f) => f.moved));
      expect(most * 2).toBeLessThan(300 / hz);
    });
  }

  it("a slow turn, let go without speed, coasts as well", () => {
    const frames = turn(60, 620, 0.2);
    expect(frames.some((f) => f.coasts)).toBe(true);
  });
});
