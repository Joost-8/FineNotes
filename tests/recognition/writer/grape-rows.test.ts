import { describe, expect, it } from "vitest";

import { spanSureness } from "../../../src/recognition/writer/grape-rows";

describe("spanSureness", () => {
  it("is each character's best probability, other than blank, over its frames", () => {
    // Three classes (blank, a, n), four frames; "a" read on frames 0-1, "n" on frame 3.
    const p = [
      [0.1, 0.6, 0.3],
      [0.1, 0.8, 0.1],
      [0.9, 0.05, 0.05],
      [0.2, 0.1, 0.7],
    ];
    const logp = p.flat().map(Math.log);
    const got = spanSureness(
      logp,
      [
        [0, 1],
        [3, 3],
      ],
      3,
    );
    expect(got[0]).toBeCloseTo(0.8, 6);
    expect(got[1]).toBeCloseTo(0.7, 6);
  });
});
