/**
 * A run of frames on the debug overlay (FineNotes#201): the worst frame, the
 * display frames missed and the whole paints of the page layer, kept after
 * the run ends, since the running averages beside them hide a few slow frames.
 */

import { describe, expect, it } from "vitest";
import { FrameRun } from "../../src/canvas/frame-run";

const FRAME = 1000 / 120;

/** `count` frames a display frame apart from `t`, each 0.7 ms of work. Returns the last one's time. */
function steady(run: FrameRun, t: number, count: number, whole = 0): number {
  for (let i = 0; i < count; i++) run.note(t + i * FRAME, 0.7, whole, FRAME);
  return t + (count - 1) * FRAME;
}

describe("a run of frames", () => {
  it("counts its frames, the worst one and the display frames missed", () => {
    const run = new FrameRun();
    let t = steady(run, 1000, 5);
    // One frame took two display frames, one took three.
    run.note((t += 2 * FRAME), 9.5, 0, FRAME);
    run.note((t += 3 * FRAME), 0.8, 0, FRAME);
    expect(run.shown).toEqual({ frames: 7, missed: 3, peakMs: 9.5, whole: 0 });
    expect(run.line()).toBe("run=7f missed=3 peak=9.5ms whole=0");
  });

  it("counts the whole paints made during the run, not those made at rest before it", () => {
    const run = new FrameRun();
    steady(run, 1000, 4, 5);
    // Three painted whole while nothing moved, between the runs.
    const t = steady(run, 2000, 4, 8);
    run.note(t + FRAME, 1, 9, FRAME);
    run.note(t + 2 * FRAME, 1, 10, FRAME);
    expect(run.shown.whole).toBe(2);
  });

  it("keeps a run's numbers after it ends, through the frame or two the page paints at rest", () => {
    const run = new FrameRun();
    const t = steady(run, 1000, 6);
    run.note(t + 2 * FRAME, 5, 1, FRAME);
    const turn = "run=7f missed=1 peak=5.0ms whole=1";
    expect(run.line()).toBe(turn);
    run.note(1400, 12, 1, FRAME);
    run.note(1400 + FRAME, 0.5, 1, FRAME);
    expect(run.line()).toBe(turn);
    // The next real run takes its place once it is long enough.
    steady(run, 3000, 3);
    expect(run.line()).toBe(turn);
    steady(run, 3000 + 3 * FRAME, 1);
    expect(run.line()).toBe("run=4f missed=0 peak=0.7ms whole=0");
  });

  it("counts two callbacks of one display frame once", () => {
    const run = new FrameRun();
    steady(run, 1000, 4);
    run.note(1000 + 3 * FRAME, 30, 0, FRAME);
    expect(run.shown).toEqual({ frames: 4, missed: 0, peakMs: 0.7, whole: 0 });
  });
});
