/** `src/canvas/laser-trail.ts` — the laser pointer's neon trail and pen options (FineNotes#25). */

import { describe, expect, it } from "vitest";
import { penOptions } from "../../src/ink/freehand";
import {
  LASER_FADE_MS,
  LASER_HOLD_MS,
  LaserSession,
  LaserTrail,
  MAX_LASER_POINTS,
  fade,
  syncLaserStream,
} from "../../src/canvas/laser-trail";

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
  it("keeps strokes 100% solid while writing, holds after lift, then fades out together", () => {
    const trail = new LaserTrail();
    trail.start({ x: 0, y: 0, t: 0 });
    trail.add({ x: 10, y: 0, t: 100 });
    trail.add({ x: 20, y: 0, t: 200 });

    const active = trail.activeStrokes(200);
    expect(active.alpha).toBe(1);
    expect(active.strokes).toHaveLength(1);
    expect(active.tip?.point).toMatchObject({ x: 20, y: 0 });

    trail.end(500);
    expect(trail.activeStrokes(500).tip).toBeNull();
    expect(trail.alpha(500 + LASER_HOLD_MS)).toBe(1);
    const mid = trail.alpha(500 + LASER_HOLD_MS + LASER_FADE_MS / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(trail.activeStrokes(500 + LASER_HOLD_MS + LASER_FADE_MS).strokes).toEqual([]);
  });

  it("keeps earlier visible strokes solid when starting a follow-up stroke", () => {
    const trail = new LaserTrail();
    trail.start({ x: 0, y: 0, t: 0 });
    trail.add({ x: 10, y: 0, t: 10 });
    trail.end(20);

    trail.start({ x: 100, y: 100, t: 30 + LASER_HOLD_MS + 100 });
    trail.add({ x: 110, y: 100, t: 40 + LASER_HOLD_MS + 100 });

    const frame = trail.activeStrokes(40 + LASER_HOLD_MS + 100);
    expect(frame.alpha).toBe(1);
    expect(frame.strokes).toHaveLength(2);
    expect(frame.strokes[0].points.map((p) => p.x)).toEqual([0, 10]);
    expect(frame.strokes[1].points.map((p) => p.x)).toEqual([100, 110]);
  });

  it("replaces active stroke points with StrokeBuilder flat/tilts and preserves PenOptions", () => {
    const calligraphy = penOptions(8, false, 40);
    const trail = new LaserTrail();
    trail.start({ x: 0, y: 0, t: 0, p: 0.5 }, calligraphy);
    trail.replaceCurrent(
      [
        { x: 0, y: 0, t: 10, p: 0.5 },
        { x: 12, y: 4, t: 20, p: 0.8 },
      ],
      [0, 0, 0.5, 12, 4, 0.8],
      [45, 50],
    );
    trail.end(20);
    trail.start({ x: 50, y: 50, t: 30 }, null);

    const frame = trail.activeStrokes(30);
    expect(frame.strokes).toHaveLength(2);
    expect(frame.strokes[0].pen).toEqual(calligraphy);
    expect(frame.strokes[0].flat).toEqual([0, 0, 0.5, 12, 4, 0.8]);
    expect(frame.strokes[0].tilts).toEqual([45, 50]);
    expect(frame.strokes[1].pen).toBeNull();
    expect(frame.tip?.pen).toBeNull();
  });

  it("prunes old points continuously behind the pen when sustain is false", () => {
    const trail = new LaserTrail();
    trail.start({ x: 0, y: 0, t: 0 });
    trail.add({ x: 10, y: 0, t: 100 });
    trail.add({ x: 20, y: 0, t: 200 });

    expect(trail.activeStrokes(200, false).strokes[0].points).toHaveLength(3);

    // After LASER_FADE_MS past the earlier points, only the live tail remains.
    trail.add({ x: 30, y: 0, t: 1000 });
    expect(trail.activeStrokes(1000, false).strokes[0].points.map((p) => p.x)).toEqual([20, 30]);
    trail.end(1000);
    expect(trail.activeStrokes(1000 + LASER_FADE_MS, false).strokes).toEqual([]);
  });

  it("takes no points while the pen is up, and clear resets everything", () => {
    const trail = new LaserTrail();
    trail.add({ x: 1, y: 1, t: 0 });
    trail.end(0);
    expect(trail.activeStrokes(0).strokes).toEqual([]);
    trail.start({ x: 0, y: 0, t: 0 });
    trail.clear();
    expect(trail.activeStrokes(0).strokes).toEqual([]);
  });

  it("never revives expired marks on delayed lift after continuous-fade pruning", () => {
    const trail = new LaserTrail();
    const times: number[] = [];
    const pen = penOptions(4, true);
    trail.start({ x: 0, y: 0, t: 100, p: 0.5 }, pen);

    // Draw 4 settled points at t = 100..130.
    const view = [0, 0, 0.5, 10, 0, 0.5, 20, 0, 0.5, 30, 0, 0.5];
    const tiltView = [40, 45, 50, 55];
    const drawn = syncLaserStream(view, tiltView, [], times, 100, false);
    trail.replaceCurrent(drawn.points, drawn.flat, drawn.tilts);
    expect(times).toEqual([100, 100, 100, 100]);

    // Pause with pen down until all 4 points have faded past LASER_FADE_MS (pruning the trail).
    const afterFade = 100 + LASER_FADE_MS + 500;
    trail.activeStrokes(afterFade, false);

    // Lift at afterFade: builder still holds all 4 settled points, but syncLaserStream must NOT revive them!
    const onLift = syncLaserStream(view, tiltView, [], times, afterFade, false);
    expect(onLift.points).toEqual([]);
    if (onLift.points.length > 0) trail.replaceCurrent(onLift.points, onLift.flat, onLift.tilts);
    trail.end(afterFade);
    expect(trail.activeStrokes(afterFade, false).strokes).toEqual([]);
  });

  it("caps retained points at MAX_LASER_POINTS and keeps version stable during stationary hold/fade", () => {
    const trail = new LaserTrail();
    trail.start({ x: 0, y: 0, t: 0 });
    for (let i = 1; i <= MAX_LASER_POINTS + 50; i++) {
      trail.add({ x: i * 2, y: 0, t: i });
    }
    const downFrame = trail.activeStrokes(MAX_LASER_POINTS + 50);
    expect(downFrame.strokes[0].points.length).toBeLessThanOrEqual(MAX_LASER_POINTS);

    trail.end(MAX_LASER_POINTS + 60);
    const holdFrame = trail.activeStrokes(MAX_LASER_POINTS + 100);
    const fadeFrame = trail.activeStrokes(MAX_LASER_POINTS + 60 + LASER_HOLD_MS + 100);
    expect(fadeFrame.version).toBe(holdFrame.version);
  });
});

describe("LaserSession", () => {
  it("never revives expired marks on delayed lift with centred-smoothing StrokeBuilder", () => {
    const session = new LaserSession();
    session.setPen({
      pen: penOptions(4, true),
      builderOpts: {
        minDistance: 2,
        pressureEnabled: true,
        fallbackPressure: 0.5,
        smoothing: "centred",
      },
    });
    session.down({ x: 0, y: 0, pressure: 0.5 }, 100, false);
    session.move(
      [
        { x: 10, y: 0, pressure: 0.5 },
        { x: 20, y: 0, pressure: 0.6 },
        { x: 30, y: 0, pressure: 0.7 },
        { x: 40, y: 0, pressure: 0.6 },
      ],
      130,
      false,
    );

    // Pause with pen down until all drawn points have faded out and pruned.
    const afterFade = 130 + LASER_FADE_MS + 500;
    session.trail.activeStrokes(afterFade, false);

    // A tiny move at the same position (rejected by StrokeBuilder) must NOT revive the expired tail.
    session.move([{ x: 40, y: 0, pressure: 0.6 }], afterFade, false);
    const afterTinyMove = session.trail.activeStrokes(afterFade, false);
    expect(afterTinyMove.strokes[0]?.points.length ?? 0).toBeLessThanOrEqual(1);
    expect(afterTinyMove.strokes[0]?.points.every((p) => p.t <= 130)).toBe(true);

    // Delayed lift flushes builder.settle(), which must NOT revive expired points.
    session.up(afterFade + 10, false);
    expect(session.trail.activeStrokes(afterFade + 10, false).strokes).toEqual([]);
  });

  it("rolls over the StrokeBuilder on very long strokes to bound memory and point count", () => {
    const session = new LaserSession();
    session.setPen({
      pen: penOptions(4, true),
      builderOpts: {
        minDistance: 1,
        pressureEnabled: true,
        fallbackPressure: 0.5,
      },
    });
    session.down({ x: 0, y: 0, pressure: 0.5 }, 0, true);
    const totalSamples = MAX_LASER_POINTS * 2 + 20;
    for (let i = 1; i <= totalSamples; i++) {
      session.move([{ x: i * 4, y: 0, pressure: 0.5 }], i, true);
    }
    const frame = session.trail.activeStrokes(totalSamples, true);
    const retained = frame.strokes.reduce((sum, s) => sum + s.points.length, 0);
    expect(retained).toBeLessThanOrEqual(MAX_LASER_POINTS);
    session.clear();
    expect(session.trail.activeStrokes(totalSamples + 1, true).strokes).toEqual([]);
  });
});
