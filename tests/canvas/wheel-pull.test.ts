import { describe, expect, it } from "vitest";
import {
  WHEEL_PULL_ADD_PX,
  WHEEL_PULL_PAUSE_MS,
  WHEEL_PULL_REST,
  WHEEL_PULL_STEP_MAX_PX,
  type WheelPull,
  type WheelPullEvent,
  wheelPullProgress,
  wheelPullStep,
} from "../../src/canvas/page-layout";

/** Feed events in order, from rest. */
const run = (events: readonly WheelPullEvent[], from: WheelPull = WHEEL_PULL_REST): WheelPull =>
  events.reduce(wheelPullStep, from);

/** `n` wheel events of `along` px each, 16 ms apart, all with the view at the end. */
const atEnd = (n: number, along: number, t0 = 0): WheelPullEvent[] =>
  Array.from({ length: n }, (_, i) => ({ t: t0 + i * 16, along, across: 0, atEnd: true }));

describe("wheelPullStep (scroll past the last page to add one, FineNotes#111)", () => {
  it("lets a deliberate pull at the end fill the ring", () => {
    const pull = run(atEnd(4, 100));
    expect(pull.armed).toBe(true);
    expect(wheelPullProgress(pull)).toBe(1);
  });

  it("fills part way for a shorter pull", () => {
    const pull = run(atEnd(1, 100));
    expect(wheelPullProgress(pull)).toBeCloseTo(100 / WHEEL_PULL_ADD_PX, 6);
  });

  it("caps one event, so a single big jump is never a pull", () => {
    const pull = run([{ t: 0, along: 2000, across: 0, atEnd: true }]);
    expect(pull.total).toBe(WHEEL_PULL_STEP_MAX_PX);
    expect(wheelPullProgress(pull)).toBeLessThan(1);
  });

  it("never counts a flick or momentum that ran into the end", () => {
    const glide: WheelPullEvent[] = [
      { t: 0, along: 120, across: 0, atEnd: false },
      { t: 16, along: 90, across: 0, atEnd: false },
      ...atEnd(40, 60, 32),
    ];
    const pull = run(glide);
    expect(pull.armed).toBe(false);
    expect(wheelPullProgress(pull)).toBe(0);
  });

  it("starts over after a pause, and may pull then", () => {
    const glide = run([{ t: 0, along: 120, across: 0, atEnd: false }, ...atEnd(5, 60, 16)]);
    expect(wheelPullProgress(glide)).toBe(0);
    const later = run(atEnd(4, 100, glide.lastT + WHEEL_PULL_PAUSE_MS), glide);
    expect(wheelPullProgress(later)).toBe(1);
  });

  it("drops the pull when the wheel scrolls back", () => {
    const pull = run([...atEnd(2, 100), { t: 40, along: -10, across: 0, atEnd: true }]);
    expect(wheelPullProgress(pull)).toBe(0);
    // …and the rest of that burst cannot pull again.
    expect(wheelPullProgress(run(atEnd(5, 100, 50), pull))).toBe(0);
  });

  it("refuses a swipe that runs across the pages as much as along them", () => {
    const pull = run([{ t: 0, along: 60, across: 40, atEnd: true }, ...atEnd(5, 100, 16)]);
    expect(wheelPullProgress(pull)).toBe(0);
  });

  it("drops the pull when the view is no longer at the end", () => {
    const pull = run([...atEnd(2, 100), { t: 40, along: 100, across: 0, atEnd: false }]);
    expect(pull).toEqual({ total: 0, lastT: 40, armed: false });
  });

  it("keeps the pull through empty events", () => {
    const pull = run([...atEnd(2, 100), { t: 40, along: 0, across: 0, atEnd: true }]);
    expect(pull.total).toBe(200);
    expect(pull.lastT).toBe(40);
  });

  it("shows nothing at rest", () => {
    expect(wheelPullProgress(WHEEL_PULL_REST)).toBe(0);
  });
});
