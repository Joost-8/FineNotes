import { describe, expect, it } from "vitest";
import type { CropLine, CropWord } from "../../../src/recognition/ocr/ctc-words";
import { REC_HEIGHT } from "../../../src/recognition/ocr/rec";
import { inkColumns, snapWords } from "../../../src/recognition/ocr/word-edges";

const W = 200;

/** A crop (first plane used) that is paper (1) with ink (-1) in the given column ranges, rows 10..38. */
function crop(inkRuns: [number, number][], paper = 1, ink = -1): Float32Array {
  const data = new Float32Array(3 * REC_HEIGHT * W).fill(paper);
  for (const [a, b] of inkRuns) {
    for (let y = 10; y < 38; y++) for (let x = a; x < b; x++) data[y * W + x] = ink;
  }
  return data;
}

const word = (text: string, x0: number, x1: number, first: number, last: number): CropWord => ({
  text,
  x0,
  x1,
  conf: 0.99,
  min: 0.9,
  first,
  last,
});

describe("snapping words to the ink", () => {
  const line: CropLine = {
    pitch: 16,
    conf: 0.99,
    words: [word("ab", 12, 70, 24, 56), word("cd", 80, 160, 96, 140)],
  };

  it("finds the columns that hold ink, and none when the crop has no contrast", () => {
    const ink = inkColumns(crop([[20, 40]]), W);
    expect(ink && [ink[19], ink[20], ink[39], ink[40]]).toEqual([0, 1, 1, 0]);
    expect(inkColumns(crop([[20, 40]], 0.1, 0), W)).toBeNull();
  });

  it("puts the boundary between words in the widest ink-free gap and the ends at the ink", () => {
    // "ab" is inked 20..40 and 43..60 (a gap inside the word), "cd" 90..150.
    const data = crop([
      [20, 40],
      [43, 60],
      [90, 150],
    ]);
    const snapped = snapWords(line, data, W, 16);
    const [ab, cd] = snapped.words;
    // Ink edges, widened by the 1 px bearing.
    expect(ab.x0).toBe(19);
    expect(ab.x1).toBe(61);
    expect(cd.x0).toBe(89);
    expect(cd.x1).toBe(151);
    expect(ab.text).toBe("ab");
  });

  it("keeps the estimate where the crop shows no ink there, or the ink is far from the characters", () => {
    expect(snapWords(line, crop([]), W, 16)).toBe(line);
    // Ink only far to the right of the first word's characters: its ends stay.
    const far = snapWords(line, crop([[170, 195]]), W, 16);
    expect(far.words[0].x0).toBe(12);
  });

  it("never lets neighbours overlap, and copes with a line with no words", () => {
    const touching: CropLine = {
      pitch: 16,
      conf: 1,
      words: [word("a", 10, 60, 30, 40), word("b", 50, 100, 70, 80)],
    };
    const [a, b] = snapWords(
      touching,
      crop([
        [25, 45],
        [65, 90],
      ]),
      W,
      16,
    ).words;
    expect(a.x1).toBeLessThanOrEqual(b.x0);
    const empty: CropLine = { words: [], conf: 0 };
    expect(snapWords(empty, crop([[1, 2]]), W, 16)).toBe(empty);
  });
});
