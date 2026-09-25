import { describe, expect, it } from "vitest";
import {
  AXIS_LOCK_DISTANCE,
  DECELERATION_RATE,
  GLIDE_MS,
  KineticScroller,
  MAX_STEP_MS,
  VelocityTracker,
  ZOOM_STRETCH,
  easeOutCubic,
  flingDistance,
  rubberBand,
  rubberBandInverse,
  softZoom,
} from "../../src/canvas/scroll-physics";

/** A one-page notebook on an iPad-sized viewport: taller than the view, narrower. */
function tallNarrow(): KineticScroller {
  const s = new KineticScroller();
  s.setExtent({ contentWidth: 900, contentHeight: 3000, viewportWidth: 1180, viewportHeight: 820 });
  return s;
}

/** Zoomed in: wider and taller than the viewport, so both axes scroll. */
function wideTall(): KineticScroller {
  const s = new KineticScroller();
  s.setExtent({
    contentWidth: 2400,
    contentHeight: 4000,
    viewportWidth: 1180,
    viewportHeight: 820,
  });
  return s;
}

/** Run frames at 60 Hz until the scroller rests. Returns the frame count. */
function settle(s: KineticScroller, from: number, maxFrames = 2000): number {
  let t = from;
  let frames = 0;
  while (s.step((t += 16.667)) && frames < maxFrames) frames++;
  return frames;
}

describe("rubberBand", () => {
  it("shows less of each extra pixel and never exceeds the dimension", () => {
    const d = 800;
    const a = rubberBand(100, d);
    const b = rubberBand(200, d);
    const c = rubberBand(100000, d);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(100);
    expect(b - a).toBeLessThan(a);
    expect(c).toBeLessThan(d);
  });

  it("is odd and zero at zero", () => {
    expect(rubberBand(0, 800)).toBe(0);
    expect(rubberBand(-150, 800)).toBeCloseTo(-rubberBand(150, 800), 10);
  });

  it("inverts", () => {
    for (const x of [1, 40, 300, 2500]) {
      expect(rubberBandInverse(rubberBand(x, 820), 820)).toBeCloseTo(x, 6);
    }
    expect(rubberBandInverse(0, 820)).toBe(0);
  });
});

describe("flingDistance", () => {
  it("matches the integral of the deceleration curve", () => {
    const v = 3; // px/ms
    let p = 0;
    let vel = v;
    for (let i = 0; i < 20000; i++) {
      p += vel;
      vel *= DECELERATION_RATE;
    }
    expect(flingDistance(v)).toBeCloseTo(p, -1);
  });
});

describe("softZoom", () => {
  it("passes values inside the limits through", () => {
    expect(softZoom(2, 1, 8)).toBe(2);
    expect(softZoom(1, 1, 8)).toBe(1);
  });

  it("compresses a pinch past either limit and stays within the stretch", () => {
    expect(softZoom(0.5, 1, 8)).toBeGreaterThan(0.5);
    expect(softZoom(0.5, 1, 8)).toBeLessThan(1);
    expect(softZoom(0.001, 1, 8)).toBeGreaterThan(Math.exp(-ZOOM_STRETCH));
    expect(softZoom(16, 1, 8)).toBeGreaterThan(8);
    expect(softZoom(1e6, 1, 8)).toBeLessThan(8 * Math.exp(ZOOM_STRETCH));
  });

  it("is monotonic", () => {
    let prev = 0;
    for (let z = 0.1; z < 20; z *= 1.05) {
      const s = softZoom(z, 1, 8);
      expect(s).toBeGreaterThan(prev);
      prev = s;
    }
  });

  it("falls back to the minimum for nonsense", () => {
    expect(softZoom(Number.NaN, 1, 8)).toBe(1);
    expect(softZoom(-2, 1, 8)).toBe(1);
  });
});

describe("easeOutCubic", () => {
  it("runs 0 to 1 and clamps", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(2)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });
});

describe("VelocityTracker", () => {
  it("measures speed over the recent window only", () => {
    const v = new VelocityTracker();
    v.add(0, 0, 0);
    v.add(500, 0, 0); // an old, slow stretch that must not count
    v.add(550, 0, 100);
    v.add(600, 0, 200);
    expect(v.velocity(600).y).toBeCloseTo(2, 6);
  });

  it("releases with nothing after a pause", () => {
    const v = new VelocityTracker();
    v.add(0, 0, 0);
    v.add(50, 0, 200);
    expect(v.velocity(50).y).toBeCloseTo(4, 6);
    expect(v.velocity(200).y).toBe(0);
  });

  it("needs two samples", () => {
    const v = new VelocityTracker();
    expect(v.velocity(0)).toEqual({ x: 0, y: 0 });
    v.add(0, 1, 1);
    expect(v.velocity(0)).toEqual({ x: 0, y: 0 });
  });
});

describe("KineticScroller: dragging", () => {
  it("moves the content against the finger", () => {
    const s = wideTall();
    s.dragStart(500, 500, 0);
    s.dragMove(500, 400, 16);
    expect(s.position).toEqual({ x: 0, y: 100 });
  });

  it("never scrolls sideways when the content fits the width", () => {
    const s = tallNarrow();
    s.dragStart(500, 500, 0);
    s.dragMove(200, 500, 16);
    expect(s.position.x).toBe(0);
    s.dragEnd(20);
    settle(s, 20);
    expect(s.position.x).toBe(0);
  });

  it("stretches past the top by less than the finger moved, then springs back", () => {
    const s = tallNarrow();
    s.dragStart(500, 200, 0);
    s.dragMove(500, 500, 16);
    expect(s.position.y).toBeLessThan(0);
    expect(s.position.y).toBeGreaterThan(-300);
    expect(s.isOverscrolled).toBe(true);
    s.dragEnd(32);
    expect(s.isAnimating).toBe(true);
    const frames = settle(s, 32);
    expect(s.position.y).toBe(0);
    expect(frames).toBeLessThan(60);
    expect(s.isAnimating).toBe(false);
  });

  it("does not fling on an axis it was released stretched on", () => {
    const s = tallNarrow();
    s.dragStart(500, 200, 0);
    // A fast drag straight into the top edge.
    for (let i = 1; i <= 5; i++) s.dragMove(500, 200 + i * 60, i * 16);
    s.dragEnd(80);
    settle(s, 80);
    expect(s.position.y).toBe(0);
  });

  it("resumes a stretched drag without a jump", () => {
    const s = tallNarrow();
    s.dragStart(500, 200, 0);
    s.dragMove(500, 500, 16);
    const stretched = s.position.y;
    s.dragEnd(16);
    s.dragStart(500, 500, 20);
    s.dragMove(500, 501, 36);
    expect(Math.abs(s.position.y - stretched)).toBeLessThan(2);
  });

  it("locks to the vertical axis when the drag starts nearly vertical", () => {
    const s = wideTall();
    s.setPosition(300, 300);
    s.dragStart(500, 500, 0);
    s.dragMove(502, 500 - AXIS_LOCK_DISTANCE - 2, 16);
    expect(s.axisLock).toBe("y");
    s.dragMove(600, 400, 32);
    expect(s.position.x).toBe(300);
    expect(s.position.y).toBe(400);
  });

  it("locks to the horizontal axis when the drag starts nearly horizontal", () => {
    const s = wideTall();
    s.setPosition(300, 300);
    s.dragStart(500, 500, 0);
    s.dragMove(500 - AXIS_LOCK_DISTANCE - 2, 501, 16);
    expect(s.axisLock).toBe("x");
    s.dragMove(400, 600, 32);
    expect(s.position).toEqual({ x: 400, y: 300 });
  });

  it("leaves a diagonal drag free on both axes", () => {
    const s = wideTall();
    s.setPosition(300, 300);
    s.dragStart(500, 500, 0);
    s.dragMove(480, 480, 16);
    expect(s.axisLock).toBe("free");
    expect(s.position).toEqual({ x: 320, y: 320 });
  });

  it("a tap leaves everything where it was", () => {
    const s = tallNarrow();
    s.setPosition(0, 400);
    s.dragStart(500, 500, 0);
    s.dragEnd(80);
    expect(s.isAnimating).toBe(false);
    expect(s.position.y).toBe(400);
  });
});

describe("KineticScroller: flinging", () => {
  it("coasts after a flick, further for a harder one, and rests in bounds", () => {
    const soft = new KineticScroller();
    soft.setExtent({
      contentWidth: 900,
      contentHeight: 30000,
      viewportWidth: 1180,
      viewportHeight: 820,
    });
    const hard = new KineticScroller();
    hard.setExtent({
      contentWidth: 900,
      contentHeight: 30000,
      viewportWidth: 1180,
      viewportHeight: 820,
    });

    soft.dragStart(500, 600, 0);
    for (let i = 1; i <= 5; i++) soft.dragMove(500, 600 - i * 20, i * 16);
    soft.dragEnd(80);
    const softDragged = soft.position.y;
    settle(soft, 80);

    hard.dragStart(500, 600, 0);
    for (let i = 1; i <= 5; i++) hard.dragMove(500, 600 - i * 60, i * 16);
    hard.dragEnd(80);
    const hardDragged = hard.position.y;
    settle(hard, 80);

    expect(soft.position.y).toBeGreaterThan(softDragged);
    expect(hard.position.y - hardDragged).toBeGreaterThan(2 * (soft.position.y - softDragged));
    // 3.75 px/ms should coast roughly its fling distance.
    expect(hard.position.y - hardDragged).toBeCloseTo(flingDistance(3.75), -2);
    expect(hard.isAnimating).toBe(false);
  });

  it("overshoots a hard edge a little and settles exactly on it", () => {
    const s = tallNarrow();
    s.setPosition(0, 2000);
    s.dragStart(500, 600, 0);
    for (let i = 1; i <= 5; i++) s.dragMove(500, 600 - i * 80, i * 16);
    s.dragEnd(80);
    const max = 3000 - 820;
    let peak = 0;
    let t = 80;
    while (s.step((t += 16.667))) peak = Math.max(peak, s.position.y);
    expect(peak).toBeGreaterThan(max);
    expect(peak - max).toBeLessThan(200);
    expect(s.position.y).toBe(max);
  });

  it("stops when the content is caught mid-fling", () => {
    const s = tallNarrow();
    s.dragStart(500, 600, 0);
    for (let i = 1; i <= 5; i++) s.dragMove(500, 600 - i * 60, i * 16);
    s.dragEnd(80);
    s.step(100);
    const caught = s.position.y;
    s.dragStart(500, 500, 110);
    expect(s.isAnimating).toBe(false);
    s.step(130);
    expect(s.position.y).toBe(caught);
  });

  it("never teleports after a stalled frame", () => {
    const s = tallNarrow();
    s.dragStart(500, 600, 0);
    for (let i = 1; i <= 5; i++) s.dragMove(500, 600 - i * 60, i * 16);
    s.dragEnd(80);
    const before = s.position.y;
    s.step(80 + 5000);
    expect(s.position.y - before).toBeLessThan(3.75 * MAX_STEP_MS + 1);
  });

  it("setPosition and scrollBy clamp and cancel a fling", () => {
    const s = tallNarrow();
    s.dragStart(500, 600, 0);
    for (let i = 1; i <= 5; i++) s.dragMove(500, 600 - i * 60, i * 16);
    s.dragEnd(80);
    s.scrollBy(50, -10000);
    expect(s.isAnimating).toBe(false);
    expect(s.position).toEqual({ x: 0, y: 0 });
    s.setPosition(-5, 99999);
    expect(s.position).toEqual({ x: 0, y: 3000 - 820 });
  });

  it("a nudge mid-drag keeps the finger's hold and clamps otherwise", () => {
    const s = wideTall();
    s.setPosition(100, 100);
    s.dragStart(500, 500, 0);
    s.nudge(50, 50);
    s.dragMove(500, 500, 16);
    expect(s.position).toEqual({ x: 150, y: 150 });
    s.dragEnd(20);
    s.nudge(-1000, -1000);
    expect(s.position).toEqual({ x: 0, y: 0 });
  });

  it("cancel drops the gesture and settles into bounds at once", () => {
    const s = tallNarrow();
    s.dragStart(500, 200, 0);
    s.dragMove(500, 500, 16);
    expect(s.position.y).toBeLessThan(0);
    s.cancel();
    expect(s.isDragging).toBe(false);
    expect(s.position.y).toBe(0);
  });

  it("a shrinking extent pulls a resting position back into bounds", () => {
    const s = tallNarrow();
    s.setPosition(0, 2000);
    s.setExtent({
      contentWidth: 900,
      contentHeight: 1000,
      viewportWidth: 1180,
      viewportHeight: 820,
    });
    expect(s.position.y).toBe(180);
  });
});

describe("KineticScroller: page glide", () => {
  /** An eight-page notebook: pages 1,000 px apart. */
  function notebook(): KineticScroller {
    const s = new KineticScroller();
    s.setExtent({
      contentWidth: 900,
      contentHeight: 8000,
      viewportWidth: 1180,
      viewportHeight: 820,
    });
    return s;
  }

  it("takes GLIDE_MS for one page and for seven alike", () => {
    for (const distance of [1000, 7000]) {
      const s = notebook();
      s.glideTo(0, distance, 0);
      expect(s.isGliding).toBe(true);
      expect(s.step(GLIDE_MS - 1)).toBe(true);
      expect(s.step(GLIDE_MS)).toBe(false);
      expect(s.position.y).toBe(Math.min(distance, 8000 - 820));
      expect(s.isAnimating).toBe(false);
    }
  });

  it("eases out: most of the way there at half time, moving from the first frame", () => {
    const s = notebook();
    s.glideTo(0, 1000, 100);
    s.step(100 + 16);
    expect(s.position.y).toBeGreaterThan(0);
    s.step(100 + GLIDE_MS / 2);
    expect(s.position.y).toBeCloseTo(1000 * easeOutCubic(0.5), 6);
    expect(s.position.y).toBeGreaterThan(800);
  });

  it("reads its progress off the clock, so a stalled frame cannot stretch it", () => {
    const s = notebook();
    s.glideTo(0, 3000, 0);
    s.step(16);
    expect(s.step(5000)).toBe(false);
    expect(s.position.y).toBe(3000);
  });

  it("clamps the target, and a glide of nothing does not animate", () => {
    const s = notebook();
    s.glideTo(-50, 99999, 0);
    settle(s, 0);
    expect(s.position).toEqual({ x: 0, y: 8000 - 820 });
    s.glideTo(0, 8000 - 820, 1000);
    expect(s.isAnimating).toBe(false);
  });

  it("a finger, setPosition or a snap takes over from a glide", () => {
    const grabbed = notebook();
    grabbed.glideTo(0, 4000, 0);
    grabbed.step(100);
    grabbed.dragStart(500, 500, 110);
    expect(grabbed.isGliding).toBe(false);
    const held = grabbed.position.y;
    grabbed.dragMove(500, 500, 126);
    expect(grabbed.position.y).toBe(held);

    const jumped = notebook();
    jumped.glideTo(0, 4000, 0);
    jumped.setPosition(0, 10);
    expect(jumped.isGliding).toBe(false);
    expect(jumped.step(50)).toBe(false);

    const snapped = notebook();
    snapped.glideTo(0, 4000, 0);
    snapped.snapTo(null, 500, 20);
    expect(snapped.isGliding).toBe(false);
    settle(snapped, 20);
    expect(snapped.position.y).toBe(500);
  });

  it("a nudge mid-glide (a zoom) moves the whole path with it", () => {
    const s = notebook();
    s.glideTo(0, 2000, 0);
    s.step(100);
    const before = s.position.y;
    s.nudge(0, 300);
    expect(s.position.y).toBe(before + 300);
    s.step(GLIDE_MS);
    expect(s.position.y).toBe(2300);
  });

  it("a shrinking extent pulls the glide's target back into bounds", () => {
    const s = notebook();
    s.glideTo(0, 6000, 0);
    s.setExtent({
      contentWidth: 900,
      contentHeight: 3000,
      viewportWidth: 1180,
      viewportHeight: 820,
    });
    settle(s, 0);
    expect(s.position.y).toBe(3000 - 820);
  });

  it("tells where it is going, so a held arrow key adds step to step", () => {
    const s = notebook();
    expect(s.glideTarget).toBeNull();
    s.glideTo(0, 150, 0, 120);
    s.step(40);
    // Mid-way the content is short of 150; the next step starts from 150.
    expect(s.position.y).toBeLessThan(150);
    expect(s.glideTarget).toEqual({ x: 0, y: 150 });
    const next = s.glideTarget ?? s.position;
    s.glideTo(next.x, next.y + 150, 40, 120);
    settle(s, 40);
    expect(s.position.y).toBe(300);
    expect(s.glideTarget).toBeNull();
  });
});
