/**
 * `auto-backoff.ts` (FineNotes#265 review): after a failure, automatic
 * transcription waits instead of failing, and saying so, after every pause.
 */

import { describe, expect, it } from "vitest";
import {
  AUTO_BACKOFF_FIRST_MS,
  AUTO_BACKOFF_MAX_MS,
  NO_BACKOFF,
  afterAutoFailure,
  autoWaitLeft,
  showsAutoFailure,
} from "../../src/recognition/auto-backoff";

describe("automatic transcription after a failure", () => {
  it("runs at once while nothing failed", () => {
    expect(autoWaitLeft(NO_BACKOFF, 1_000)).toBe(0);
  });

  it("waits 10 minutes after a failure, then twice as long after each further one, up to an hour", () => {
    let state = afterAutoFailure(NO_BACKOFF, 0);
    expect(autoWaitLeft(state, 0)).toBe(AUTO_BACKOFF_FIRST_MS);
    expect(autoWaitLeft(state, AUTO_BACKOFF_FIRST_MS - 1)).toBe(1);
    expect(autoWaitLeft(state, AUTO_BACKOFF_FIRST_MS)).toBe(0);
    const waits = [AUTO_BACKOFF_FIRST_MS];
    for (let i = 0; i < 5; i++) {
      state = afterAutoFailure(state, 0);
      waits.push(autoWaitLeft(state, 0));
    }
    expect(waits.map((ms) => ms / 60_000)).toEqual([10, 20, 40, 60, 60, 60]);
    expect(Math.max(...waits)).toBe(AUTO_BACKOFF_MAX_MS);
  });

  it("shows only the first failure of a run of them", () => {
    const first = afterAutoFailure(NO_BACKOFF, 0);
    expect(showsAutoFailure(first)).toBe(true);
    expect(showsAutoFailure(afterAutoFailure(first, 0))).toBe(false);
    // After a success the next failure is news again.
    expect(showsAutoFailure(afterAutoFailure(NO_BACKOFF, 5))).toBe(true);
  });
});
