import { describe, expect, it } from "vitest";
import { COAST_PX, COAST_SPEED, coasting } from "../../src/canvas/coast";
import { GLIDE_MS, KineticScroller } from "../../src/canvas/scroll-physics";

const still = { complete: true, held: false, zooming: false, pdf: false, speed: 0 };

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

  it("near is not slow: a view passing its end fast is in the middle of its turn", () => {
    expect(coasting({ ...still, remaining: 2, speed: COAST_SPEED })).toBe(true);
    expect(coasting({ ...still, remaining: 2, speed: COAST_SPEED + 0.01 })).toBe(false);
    expect(coasting({ ...still, remaining: 2, speed: 3 })).toBe(false);
  });

  it("gives way to a finger, a pinch or the pen, to a zoom, and to a paint with tiles to make", () => {
    expect(coasting({ ...still, remaining: 2, held: true })).toBe(false);
    expect(coasting({ ...still, remaining: 2, zooming: true })).toBe(false);
    expect(coasting({ ...still, remaining: 2, complete: false })).toBe(false);
  });

  it("never over a PDF: its pages are made at rest, as they always were", () => {
    expect(coasting({ ...still, remaining: 2, pdf: true })).toBe(false);
  });
});

const PAGE = 1196;

interface Frame {
  t: number;
  x: number;
  moved: number;
  coasts: boolean;
}

/** A row of iPad-wide pages. */
function row(): KineticScroller {
  const s = new KineticScroller();
  s.setExtent({
    contentWidth: PAGE * 6,
    contentHeight: 820,
    viewportWidth: 1180,
    viewportHeight: 820,
  });
  return s;
}

/** Step `s` at `hz` from `t0` until it stops: each frame's time, place, move and whether it coasted. */
function run(s: KineticScroller, hz: number, t0: number): Frame[] {
  const frame = 1000 / hz;
  const out: Frame[] = [];
  let last = s.position.x;
  for (let i = 1; i < 600; i++) {
    const moving = s.step(t0 + i * frame);
    const x = s.position.x;
    const coasts = coasting({ ...still, remaining: s.remaining, speed: s.speed });
    out.push({ t: i * frame, x, moved: Math.abs(x - last), coasts });
    last = x;
    if (!moving) break;
  }
  return out;
}

/**
 * A swipe of `dragged` px let go at `speed` px/ms, then the turn's snap to
 * the next page, stepped at `hz`.
 */
function turn(hz: number, dragged = 420, speed = 2.8): Frame[] {
  const s = row();
  // The finger goes left, the content with it.
  s.dragStart(1190, 400, 0);
  const steps = 18;
  for (let i = 1; i <= steps; i++)
    s.dragMove(1190 - (dragged * i) / steps, 400, (i * dragged) / speed / steps);
  const lift = dragged / speed;
  s.dragEnd(lift);
  s.snapTo(PAGE, null, lift);
  const out = run(s, hz, lift);
  expect(s.position.x).toBe(PAGE);
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

    // A page dragged most of the way and flicked: the spring carries it past
    // the next page and back, through the 8 px at full speed on the way out.
    for (const [dragged, speed] of [
      [1100, 6],
      [1150, 3],
      [1150, 6],
    ]) {
      it(`at ${hz} Hz: a ${dragged} px swipe let go at ${speed} px/ms coasts only once it has come back`, () => {
        const frames = turn(hz, dragged, speed);
        const peak = frames.reduce((a, f) => (f.x > a.x ? f : a));
        expect(peak.x - PAGE).toBeGreaterThan(20);
        const coast = frames.filter((f) => f.coasts);
        // None on the way out, past the page...
        expect(coast.every((f) => f.t > peak.t)).toBe(true);
        // ...and none that moves the page more than a slow frame does.
        const most = Math.max(...coast.map((f) => f.moved));
        expect(most).toBeLessThan(COAST_SPEED * 1.5 * (1000 / hz));
        // It still coasts, at the end.
        expect(coast.length).toBeGreaterThan(5);
      });
    }
  }

  it("a slow turn, let go without speed, coasts as well", () => {
    const frames = turn(60, 620, 0.2);
    expect(frames.some((f) => f.coasts)).toBe(true);
  });
});

describe("a glide's coast", () => {
  for (const pages of [1, 5]) {
    it(`a jump of ${pages} page(s) coasts only in its last, slow px`, () => {
      const s = row();
      s.glideTo(PAGE * pages, 0, 0);
      const frames = run(s, 60, 0);
      expect(s.position.x).toBe(PAGE * pages);
      const coast = frames.filter((f) => f.coasts);
      expect(coast.length).toBeGreaterThan(0);
      expect(coast[0].t).toBeGreaterThan(GLIDE_MS * 0.7);
      const most = Math.max(...coast.map((f) => f.moved));
      expect(most).toBeLessThan(COAST_SPEED * 1.5 * (1000 / 60));
    });
  }
});
