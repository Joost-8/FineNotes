/** `src/view/surface-size.ts` — backing scale and the wait for a pane with no size. */

import { describe, expect, it } from "vitest";
import {
  MAX_BACKING_SCALE,
  SIZE_WAIT_FRAMES,
  SizeWait,
  backingScale,
} from "../../src/view/surface-size";

describe("backingScale", () => {
  it("follows the screen up to the cap", () => {
    expect(backingScale(1)).toBe(1);
    expect(backingScale(1.25)).toBe(1.25);
    expect(backingScale(2)).toBe(2);
    expect(backingScale(MAX_BACKING_SCALE)).toBe(MAX_BACKING_SCALE);
    expect(backingScale(4)).toBe(MAX_BACKING_SCALE);
    expect(backingScale(Infinity)).toBe(MAX_BACKING_SCALE);
  });

  it("is 1 when the screen reports nothing usable", () => {
    expect(backingScale(undefined)).toBe(1);
    expect(backingScale(0)).toBe(1);
    expect(backingScale(Number.NaN)).toBe(1);
  });
});

describe("SizeWait", () => {
  it("lays out a pane that has both sides", () => {
    expect(new SizeWait().check(800, 600)).toBe("layout");
  });

  it("retries a pane missing either side, up to its budget, then waits", () => {
    const wait = new SizeWait();
    const answers = Array.from({ length: SIZE_WAIT_FRAMES + 2 }, (_, i) =>
      wait.check(i % 2 === 0 ? 0 : 800, 0),
    );
    expect(answers.filter((a) => a === "retry")).toHaveLength(SIZE_WAIT_FRAMES);
    expect(answers.slice(SIZE_WAIT_FRAMES)).toEqual(["wait", "wait"]);
  });

  it("gets its whole budget back once the pane has a size", () => {
    const wait = new SizeWait(3);
    expect([wait.check(0, 0), wait.check(0, 0), wait.check(0, 0), wait.check(0, 0)]).toEqual([
      "retry",
      "retry",
      "retry",
      "wait",
    ]);
    expect(wait.check(10, 10)).toBe("layout");
    expect(wait.check(0, 10)).toBe("retry");
  });
});
