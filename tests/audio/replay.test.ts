/**
 * `src/audio/replay.ts`: which ink is pale at a moment of a recording.
 */

import { describe, expect, it } from "vitest";
import {
  fadeChanges,
  fadedAt,
  replayTimeline,
  writingAt,
  writtenCount,
} from "../../src/audio/replay";
import type { Page, Recording, Stroke } from "../../src/model/document";

function stroke(id: string, t0?: number): Stroke {
  return {
    id,
    color: "#000",
    size: 2,
    tool: "pen",
    pts: [0, 0, 0.5],
    ...(t0 === undefined ? {} : { t0 }),
  };
}

function page(id: string, epoch: number | undefined, strokes: Stroke[]): Page {
  return { id, epoch, strokes } as unknown as Page;
}

const recording: Recording = { id: "r1", path: "a.m4a", start: 10_000, duration: 60_000 };

const pages = [
  // Page 1's epoch is 9 s: s0 before the recording, s1 at 1 s in, s2 at 21 s.
  page("p1", 9_000, [stroke("s0", 0), stroke("s1", 2_000), stroke("s2", 22_000), stroke("old")]),
  // Page 2 began 30 s in; s4 lands after the recording ended.
  page("p2", 40_000, [stroke("s3", 5_000), stroke("s4", 40_000)]),
  page("p3", undefined, [stroke("s5", 1)]),
];

describe("replayTimeline", () => {
  it("takes the strokes written while the recording ran, in writing order", () => {
    expect(replayTimeline(pages, recording)).toEqual([
      { pageId: "p1", id: "s1", at: 1_000 },
      { pageId: "p1", id: "s2", at: 21_000 },
      { pageId: "p2", id: "s3", at: 35_000 },
    ]);
  });
});

describe("fadedAt and writingAt", () => {
  const timeline = replayTimeline(pages, recording);

  it("fades what is not written yet, and nothing at the end", () => {
    expect([...fadedAt(timeline, 0)]).toEqual(["s1", "s2", "s3"]);
    expect([...fadedAt(timeline, 21_000)]).toEqual(["s3"]);
    expect(fadedAt(timeline, 60_000).size).toBe(0);
  });

  it("counts what is written by a moment, as the pale set does", () => {
    for (const ms of [-1, 0, 1_000, 20_999, 21_000, 35_000, 99_000]) {
      expect(writtenCount(timeline, ms)).toBe(timeline.length - fadedAt(timeline, ms).size);
    }
  });

  it("follows the page being written", () => {
    expect(writingAt(timeline, 500)).toBeNull();
    expect(writingAt(timeline, 25_000)).toBe("p1");
    expect(writingAt(timeline, 36_000)).toBe("p2");
  });
});

describe("fadeChanges", () => {
  it("is what came back plus what went pale again", () => {
    expect([...fadeChanges(new Set(["a", "b"]), new Set(["b", "c"]))].sort()).toEqual(["a", "c"]);
    expect(fadeChanges(new Set(["a"]), new Set(["a"])).size).toBe(0);
  });
});
