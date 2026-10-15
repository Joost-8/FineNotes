/**
 * When the floating text pill steps aside for a moving page
 * (`InkSurface.trackTextPillMotion`): only for a real scroll or zoom, and
 * back only once the page has been still for a moment.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("obsidian", () => import("./fake-obsidian"));
const { InkSurface } = await import("../../src/view/ink-surface");

type Fake = Record<string, unknown> & {
  scroller: { position: { x: number; y: number } };
  scale: number;
  textAnchorMoving: boolean;
  reportTextAnchor: ReturnType<typeof vi.fn>;
};

function surface(): Fake {
  const s = Object.create(InkSurface.prototype) as Fake;
  Object.assign(s, {
    scroller: { position: { x: 0, y: 1000 } },
    textAnchorMoving: false,
    textPillMotion: null,
    textPillSettleTimer: 0,
    // The view at rest before the gesture.
    textPillRest: { x: 0, y: 1000, scale: 1 },
    reportTextAnchor: vi.fn(),
  });
  Object.defineProperty(s, "scale", { value: 1, writable: true });
  return s;
}
const frame = (s: Fake, busy: boolean): void =>
  (s as unknown as { trackTextPillMotion: (b: boolean) => void }).trackTextPillMotion(busy);

describe("the text pill and a moving page", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("stays by its box for a nudge", () => {
    const s = surface();
    for (const dy of [4, 9, 15, 20]) {
      s.scroller.position.y = 1000 + dy;
      frame(s, true);
    }
    expect(s.textAnchorMoving).toBe(false);
    frame(s, false);
    vi.advanceTimersByTime(500);
    expect(s.textAnchorMoving).toBe(false);
  });

  it("steps aside for a real scroll, and comes back once the page has been still", () => {
    const s = surface();
    s.scroller.position.y = 1010;
    frame(s, true);
    expect(s.textAnchorMoving).toBe(false);
    s.scroller.position.y = 1030;
    frame(s, true);
    expect(s.textAnchorMoving).toBe(true);
    frame(s, false);
    // Still away just after the page stops.
    vi.advanceTimersByTime(100);
    expect(s.textAnchorMoving).toBe(true);
    vi.advanceTimersByTime(60);
    expect(s.textAnchorMoving).toBe(false);
    expect(s.reportTextAnchor).toHaveBeenCalled();
  });

  it("does not flash back when a scroll stops and starts again", () => {
    const s = surface();
    s.scroller.position.y = 1040;
    frame(s, true);
    frame(s, false);
    vi.advanceTimersByTime(100);
    // Moving again, even by a little: still away.
    s.scroller.position.y = 1042;
    frame(s, true);
    expect(s.textAnchorMoving).toBe(true);
    vi.advanceTimersByTime(400);
    expect(s.textAnchorMoving).toBe(true);
    frame(s, false);
    vi.advanceTimersByTime(200);
    expect(s.textAnchorMoving).toBe(false);
  });

  it("steps aside for a real zoom, not for the start of a pinch", () => {
    const s = surface();
    s.scale = 1.05;
    frame(s, true);
    expect(s.textAnchorMoving).toBe(false);
    s.scale = 1.08;
    frame(s, true);
    expect(s.textAnchorMoving).toBe(true);
  });

  it("a frame at rest with nothing moved leaves a pending return alone", () => {
    const s = surface();
    s.scroller.position.y = 1100;
    frame(s, true);
    frame(s, false);
    // A repaint at rest before the settle time: no early return.
    frame(s, false);
    expect(s.textAnchorMoving).toBe(true);
    vi.advanceTimersByTime(200);
    expect(s.textAnchorMoving).toBe(false);
  });
});
