/**
 * The display's frame length, learned from its frames (src/canvas/frame-pace.ts),
 * and the budgets that follow from it (FineNotes#201).
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_FRAME_MS, FramePace, MIN_BUDGET_MS } from "../../src/canvas/frame-pace";

/** Run `count` frames `gap` ms apart, each asked for by the one before. */
function run(pace: FramePace, from: number, gap: number, count: number): number {
  let t = from;
  for (let i = 0; i < count; i++) {
    t += gap;
    pace.note(t, true);
  }
  return t;
}

describe("FramePace", () => {
  it("assumes 60 Hz until enough frames have been seen", () => {
    const pace = new FramePace();
    expect(pace.frameMs).toBeCloseTo(DEFAULT_FRAME_MS);
    pace.note(0, false);
    run(pace, 0, 8.33, 8);
    expect(pace.frameMs).toBeCloseTo(DEFAULT_FRAME_MS);
    expect(pace.budget(6)).toBe(6);
  });

  it("learns a 120 Hz display and halves the budgets", () => {
    const pace = new FramePace();
    pace.note(0, false);
    run(pace, 0, 8.33, 30);
    expect(pace.frameMs).toBeCloseTo(8.33, 1);
    expect(pace.hz).toBeCloseTo(120, 0);
    expect(pace.budget(6)).toBeCloseTo(3, 1);
    expect(pace.budget(10)).toBeCloseTo(5, 1);
  });

  it("still knows the display is 120 Hz while most frames are missed", () => {
    const pace = new FramePace();
    pace.note(0, false);
    let t = 0;
    // One frame in six on time, the rest taking two.
    for (let i = 0; i < 60; i++) {
      t += i % 6 === 0 ? 8.33 : 16.67;
      pace.note(t, true);
    }
    expect(pace.frameMs).toBeCloseTo(8.33, 1);
  });

  it("is not fooled by one short reading", () => {
    const pace = new FramePace();
    pace.note(0, false);
    let t = run(pace, 0, 16.67, 40);
    t += 5;
    pace.note(t, true);
    run(pace, t, 16.67, 10);
    expect(pace.frameMs).toBeCloseTo(16.67, 1);
  });

  it("ignores a frame that was not asked for by the one before, and pauses", () => {
    const pace = new FramePace();
    pace.note(0, false);
    let t = run(pace, 0, 16.67, 20);
    // A lone frame 8 ms later (a pen event), then a long rest.
    pace.note(t + 8, false);
    t = run(pace, t + 8, 16.67, 20);
    pace.note(t + 400, true);
    pace.note(t + 400.5, true);
    expect(pace.frameMs).toBeCloseTo(16.67, 1);
  });

  it("forgets an old rate once the frames are longer for good", () => {
    const pace = new FramePace();
    pace.note(0, false);
    const t = run(pace, 0, 8.33, 60);
    run(pace, t, 16.67, 60);
    expect(pace.frameMs).toBeCloseTo(16.67, 1);
  });

  it("never gives more than the 60 Hz budget, nor less than the floor", () => {
    const slow = new FramePace();
    slow.note(0, false);
    run(slow, 0, 33.3, 30);
    expect(slow.budget(6)).toBe(6);
    const fast = new FramePace();
    fast.note(0, false);
    run(fast, 0, 4.17, 30);
    expect(fast.budget(6)).toBe(MIN_BUDGET_MS);
    expect(fast.budget(1)).toBe(1);
  });
});

/** Feed `gaps` (ms), each frame asked for by the one before. */
function feed(pace: FramePace, gaps: readonly number[]): void {
  let t = 0;
  pace.note(t, false);
  for (const gap of gaps) pace.note((t += gap), true);
}

/** `count` gaps from `pattern`, over and over. */
function repeat(pattern: readonly number[], count: number): number[] {
  return Array.from({ length: count }, (_, i) => pattern[i % pattern.length]);
}

describe("FramePace with frames that start late", () => {
  const T = 1000 / 120;

  // FineNotes#201: a 120 Hz iPad Pro read 143 Hz. A frame whose callback
  // starts late is followed by a short gap, and the short end of the gaps
  // alone is then shorter than any frame the display shows.
  it("reads 120 Hz when a third of the frames start 1.4 ms late", () => {
    const pace = new FramePace();
    feed(pace, repeat([T, T + 1.4, T - 1.4], 60));
    expect(pace.hz).toBeCloseTo(120, 0);
  });

  it("reads 120 Hz when every other frame starts late", () => {
    const pace = new FramePace();
    feed(pace, repeat([T + 1.2, T - 1.2], 60));
    expect(pace.hz).toBeCloseTo(120, 0);
  });

  it("reads 120 Hz with late frames and missed ones together", () => {
    const pace = new FramePace();
    // A missed frame that also ran late, the short gap after it, two on time, a late pair.
    feed(pace, repeat([2 * T + 1.3, T - 1.3, T, T, T + 1.5, T - 1.5, 2 * T, T], 60));
    expect(pace.hz).toBeCloseTo(120, 0);
  });

  it("reads 120 Hz when one frame in six is on time and they start late", () => {
    const pace = new FramePace();
    feed(pace, repeat([T + 1, T - 1, 2 * T, 2 * T, 2 * T + 1, 2 * T - 1], 60));
    expect(pace.hz).toBeCloseTo(120, 0);
  });

  it("reads 60 Hz with late frames too", () => {
    const pace = new FramePace();
    feed(pace, repeat([2 * T, 2 * T + 2.5, 2 * T - 2.5], 60));
    expect(pace.hz).toBeCloseTo(60, 0);
  });

  it("leaves the budgets on the short end of the gaps, as they were tuned", () => {
    const pace = new FramePace();
    feed(pace, repeat([T, T + 1.4, T - 1.4], 60));
    // The rate is read right, and what a frame may spend has not changed:
    // 6 ms x (8.33 - 1.4) / 16.67, as before the rate was corrected.
    expect(pace.hz).toBeCloseTo(120, 0);
    expect(pace.budget(6)).toBeCloseTo((6 * (T - 1.4)) / (1000 / 60), 2);
    expect(pace.budget(6)).toBeLessThan(2.6);
  });

  it("a 60 Hz tablet whose frames start late keeps its budgets too", () => {
    const pace = new FramePace();
    // An iPad Air read 16.0 ms at the short end of a 16.6 ms frame.
    feed(pace, repeat([16.6, 17.2, 16.0, 16.6, 16.6, 17.2, 16.0, 16.6, 16.6, 16.6], 60));
    expect(pace.frameMs).toBeCloseTo(16.6, 1);
    expect(pace.budget(6)).toBeCloseTo((6 * 16.0) / (1000 / 60), 2);
  });
});

describe("FramePace with frames that start almost half a frame late", () => {
  const T = 1000 / 120;

  // Found in review: one frame in ten 3.8 ms late made the short end 4.5 ms,
  // the ordinary 8.3 ms gaps fell outside "single frames", and it read 240 Hz.
  it("reads 120 Hz when one frame in ten starts 3.8 ms late", () => {
    const pace = new FramePace();
    feed(pace, repeat([T + 3.8, T - 3.8, T, T, T, T, T, T, T, T], 60));
    expect(pace.hz).toBeCloseTo(120, 0);
  });

  it("reads 120 Hz when two frames in ten start 3.8 ms late", () => {
    const pace = new FramePace();
    feed(pace, repeat([T + 3.8, T - 3.8, T, T, T + 3.8, T - 3.8, T, T, T, T], 60));
    expect(pace.hz).toBeCloseTo(120, 0);
  });

  it("stays near 120 Hz whatever frames start late, by up to 4 ms", () => {
    // A small generator with a fixed seed: the same windows every run.
    let seed = 20261126;
    const random = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    let off = 0;
    const windows = 400;
    for (let w = 0; w < windows; w++) {
      const gaps: number[] = [];
      let late = 0;
      for (let i = 0; i < 60; i++) {
        const next = random() < 0.3 ? random() * 4 : 0;
        gaps.push(T + next - late);
        late = next;
      }
      const pace = new FramePace();
      feed(pace, gaps);
      if (Math.abs(pace.hz - 120) > 6) off++;
    }
    // The old short-end rule was off in 7 windows of 10.
    expect(off / windows).toBeLessThan(0.02);
  });

  it("still reads 240 Hz on a display that fast with most frames missed", () => {
    const pace = new FramePace();
    const tick = 1000 / 240;
    feed(pace, repeat([tick, 2 * tick, 2 * tick, 2 * tick, 2 * tick, 2 * tick], 60));
    expect(pace.hz).toBeCloseTo(240, 0);
  });
});
