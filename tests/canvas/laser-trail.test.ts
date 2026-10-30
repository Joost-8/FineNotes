/** `src/canvas/laser-trail.ts` — the laser pointer's fading trail (FineNotes#25). */

import { describe, expect, it } from "vitest";
import { LASER_FADE_MS, LaserTrail, fade, laserDots } from "../../src/canvas/laser-trail";

describe("fade", () => {
  it("is full when new, nothing once faded, and falls in between", () => {
    expect(fade(-5)).toBe(1);
    expect(fade(0)).toBe(1);
    expect(fade(LASER_FADE_MS)).toBe(0);
    expect(fade(LASER_FADE_MS * 2)).toBe(0);
    const half = fade(LASER_FADE_MS / 2);
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(1);
    expect(fade(10)).toBeGreaterThan(fade(20));
  });
});

describe("LaserTrail", () => {
  it("draws the pen's path, newest pieces strongest", () => {
    const trail = new LaserTrail();
    trail.start({ x: 0, y: 0, t: 0 });
    trail.add({ x: 10, y: 0, t: 100 });
    trail.add({ x: 20, y: 0, t: 200 });
    const segments = trail.segments(200);
    expect(segments).toHaveLength(2);
    expect(segments[0].alpha).toBeLessThan(segments[1].alpha);
    expect(segments[1]).toMatchObject({ a: { x: 10 }, b: { x: 20 }, alpha: 1 });
    expect(trail.tip()).toEqual({ x: 20, y: 0, t: 200 });
  });

  describe("laserDots", () => {
    const segments = [
      {
        a: { x: 0, y: 0, t: 0 },
        b: { x: 100, y: 0, t: 100 },
        alpha: 1,
      },
    ];

    it("emits no dots when disabled", () => {
      expect(laserDots(segments, 0)).toEqual([]);
    });

    it("emits proportionally more dots at higher frequencies", () => {
      expect(laserDots(segments, 1)).toHaveLength(16);
      expect(laserDots(segments, 3)).toHaveLength(49);
      expect(laserDots(segments, 3)[0].point).toMatchObject({ x: 2, y: 0 });
    });

    it("keeps spacing continuous across pointer samples", () => {
      const sampledPath = [
        { a: { x: 0, y: 0, t: 0 }, b: { x: 1.5, y: 0, t: 1.5 }, alpha: 1 },
        { a: { x: 1.5, y: 0, t: 1.5 }, b: { x: 3, y: 0, t: 3 }, alpha: 1 },
        { a: { x: 3, y: 0, t: 3 }, b: { x: 4.5, y: 0, t: 4.5 }, alpha: 1 },
        { a: { x: 4.5, y: 0, t: 4.5 }, b: { x: 6, y: 0, t: 6 }, alpha: 1 },
      ];
      expect(laserDots(sampledPath, 3).map(({ point }) => point.x)).toEqual([2, 4]);
    });

    it("supports disabled, medium, and maximum density", () => {
      const path = [{ a: { x: 0, y: 0, t: 0 }, b: { x: 100, y: 0, t: 100 }, alpha: 1 }];
      expect(laserDots(path, 0)).toHaveLength(0);
      expect(laserDots(path, 3)).toHaveLength(49);
      expect(laserDots(path, 10)).toHaveLength(166);
    });
  });

  it("lets the old part fade while the pen goes on, and keeps a still pen's dot", () => {
    const trail = new LaserTrail();
    trail.start({ x: 0, y: 0, t: 0 });
    trail.add({ x: 10, y: 0, t: 10 });
    trail.add({ x: 20, y: 0, t: 1000 });
    expect(trail.segments(1000)).toHaveLength(1);
    // Held still long after: no segment is left, but the dot is.
    expect(trail.segments(5000)).toHaveLength(0);
    expect(trail.visible(5000)).toBe(true);
    expect(trail.tip()).toMatchObject({ x: 20 });
  });

  it("fades out after the lift, from the lift", () => {
    const trail = new LaserTrail();
    trail.start({ x: 0, y: 0, t: 0 });
    trail.add({ x: 10, y: 0, t: 10 });
    trail.end(2000);
    expect(trail.tip()).toBeNull();
    expect(trail.visible(2000)).toBe(true);
    expect(trail.visible(2000 + LASER_FADE_MS)).toBe(false);
    expect(trail.segments(2000 + LASER_FADE_MS)).toEqual([]);
  });

  it("does not join one trail to the next", () => {
    const trail = new LaserTrail();
    trail.start({ x: 0, y: 0, t: 0 });
    trail.add({ x: 10, y: 0, t: 10 });
    trail.end(20);
    trail.start({ x: 100, y: 100, t: 30 });
    trail.add({ x: 110, y: 100, t: 40 });
    const segments = trail.segments(40);
    expect(segments.some(({ a, b }) => a.x === 10 && b.x === 100)).toBe(false);
    expect(segments.some(({ a, b }) => a.x === 100 && b.x === 110)).toBe(true);
  });

  it("takes no points while the pen is up, and a lift with none is nothing", () => {
    const trail = new LaserTrail();
    trail.add({ x: 1, y: 1, t: 0 });
    trail.end(0);
    expect(trail.visible(0)).toBe(false);
    trail.start({ x: 0, y: 0, t: 0 });
    trail.clear();
    expect(trail.visible(0)).toBe(false);
    expect(trail.tip()).toBeNull();
  });
});
