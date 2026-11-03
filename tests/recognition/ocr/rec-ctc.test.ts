import { describe, expect, it } from "vitest";
import { RIGHT_BIAS, ctcDecode, wordsOf } from "../../../src/recognition/ocr/ctc-words";
import {
  REC_BATCH,
  REC_CORE,
  REC_HEIGHT,
  REC_MAX_WIDTH,
  REC_STRIDE,
  alphabetFrom,
  batchByWidth,
  batchTensor,
  cropLine,
  cropWidth,
} from "../../../src/recognition/ocr/rec";

// A tiny alphabet: class 0 is the blank, then "a".."e", then a space.
const ALPHABET = ["", "a", "b", "c", "d", "e", " "];
const C = ALPHABET.length;

/** Probabilities for `steps`: each `[class, probability]`, the rest of the mass spread over the others. */
function probs(steps: [number, number][]): Float32Array {
  const out = new Float32Array(steps.length * C);
  steps.forEach(([k, p], t) => {
    for (let c = 0; c < C; c++) out[t * C + c] = c === k ? p : (1 - p) / (C - 1);
  });
  return out;
}

describe("the recogniser's alphabet", () => {
  it("is the dictionary's lines, class 0 the blank, the last line the space", () => {
    const a = alphabetFrom("　\n\nx\ny\n ");
    expect(a).toEqual(["", "", "x", "y", " "]);
  });

  it("does not count a trailing line break as a class", () => {
    expect(alphabetFrom("-\na\nb\n ").length).toBe(4);
    expect(alphabetFrom("-\na\nb\n \n").length).toBe(4);
  });

  it("splits on line feeds only, so a separator character stays a character", () => {
    expect(alphabetFrom("-\na b\n ")[1]).toBe("a b");
  });
});

describe("CTC decoding with positions and confidences", () => {
  it("merges repeats, drops blanks, and keeps where and how sure each character was", () => {
    // blank a a blank a b b blank
    const chars = ctcDecode(
      probs([
        [0, 0.99],
        [1, 0.9],
        [1, 0.97],
        [0, 0.99],
        [1, 0.8],
        [2, 0.7],
        [2, 0.6],
        [0, 0.9],
      ]),
      8,
      C,
      ALPHABET,
    );
    expect(chars.map((c) => c.ch).join("")).toBe("aab");
    expect(chars[0]).toMatchObject({ ch: "a", t0: 1, t1: 2 });
    // Confidence is the highest probability over the character's steps.
    expect(chars[0].conf).toBeCloseTo(0.97, 5);
    expect(chars[1]).toMatchObject({ t0: 4, t1: 4 });
    expect(chars[2]).toMatchObject({ ch: "b", t0: 5, t1: 6 });
    expect(chars[2].conf).toBeCloseTo(0.7, 5);
  });

  it("skips a class whose dictionary entry is empty", () => {
    const chars = ctcDecode(probs([[1, 0.9]]), 1, C, ["", "", "b", "c", "d", "e", " "]);
    expect(chars).toEqual([]);
  });

  it("splits words at the spaces and places each from where its characters sit", () => {
    // "ab cd": a at step 2, b at 4, (space at 6), c at 9, d at 11; stride 8 px.
    const steps: [number, number][] = Array.from({ length: 14 }, () => [0, 0.99]);
    steps[2] = [1, 0.95];
    steps[4] = [2, 0.9];
    steps[6] = [6, 0.8];
    steps[9] = [3, 0.99];
    steps[11] = [4, 0.6];
    const line = wordsOf(ctcDecode(probs(steps), 14, C, ALPHABET), 14 * REC_STRIDE);
    expect(line.words.map((w) => w.text)).toEqual(["ab", "cd"]);
    const [ab, cd] = line.words;
    // Middles: a 2.5*8=20, b 4.5*8=36, c 9.5*8=76, d 11.5*8=92; half a pitch (8) either side, the right edge a little more.
    expect(ab.x0).toBeCloseTo(12, 5);
    expect(ab.x1).toBeCloseTo(44 + RIGHT_BIAS * 16, 5);
    expect(cd.x0).toBeCloseTo(68, 5);
    expect(cd.x1).toBeCloseTo(100 + RIGHT_BIAS * 16, 5);
    expect(ab.conf).toBeCloseTo(0.925, 5);
    expect(ab.min).toBeCloseTo(0.9, 5);
    expect(cd.min).toBeCloseTo(0.6, 5);
    // The line: the mean of all its characters (not the space).
    expect(line.conf).toBeCloseTo((0.95 + 0.9 + 0.99 + 0.6) / 4, 5);
  });

  it("is not just the line shared out evenly", () => {
    // A long word then a one-letter word far to the right.
    const steps: [number, number][] = Array.from({ length: 40 }, () => [0, 0.99]);
    [2, 4, 6, 8, 10].forEach((t) => (steps[t] = [1, 0.9]));
    steps[12] = [6, 0.9];
    steps[36] = [2, 0.9];
    const line = wordsOf(ctcDecode(probs(steps), 40, C, ALPHABET), 40 * REC_STRIDE);
    expect(line.words.map((w) => w.text)).toEqual(["aaaaa", "b"]);
    expect(line.words[1].x0).toBeGreaterThan(line.words[0].x1 + 100);
  });

  it("keeps words inside the crop and apart from each other", () => {
    const steps: [number, number][] = [
      [1, 0.9],
      [6, 0.9],
      [2, 0.9],
    ];
    const line = wordsOf(ctcDecode(probs(steps), 3, C, ALPHABET), 3 * REC_STRIDE);
    for (const w of line.words) {
      expect(w.x0).toBeGreaterThanOrEqual(0);
      expect(w.x1).toBeLessThanOrEqual(3 * REC_STRIDE);
    }
    expect(line.words[0].x1).toBeLessThanOrEqual(line.words[1].x0);
  });

  it("has no words for blanks and spaces only", () => {
    expect(wordsOf([], 100)).toEqual({ words: [], conf: 0 });
    const spaces = ctcDecode(probs([[6, 0.9]]), 1, C, ALPHABET);
    expect(wordsOf(spaces, 8).words).toEqual([]);
  });
});

describe("the recogniser's input", () => {
  it("scales a line to height 48, keeping its aspect ratio, in multiples of 8, capped", () => {
    // The box is read at REC_CORE of its height, so the crop is that much wider.
    expect(cropWidth({ w: 480, h: 48 })).toBe(Math.ceil((480 * REC_CORE) / 8) * 8);
    expect(cropWidth({ w: 480, h: 48 })).toBe(cropWidth({ w: 500, h: 50 }));
    expect(cropWidth({ w: 10, h: 100 })).toBe(16);
    expect(cropWidth({ w: 100000, h: 20 })).toBe(REC_MAX_WIDTH);
  });

  it("batches lines of about the same width together, at most REC_BATCH at a time", () => {
    const widths = [100, 400, 105, 110, 395, 2000];
    const batches = batchByWidth(widths);
    expect(batches).toEqual([[0, 2, 3], [4, 1], [5]]);
    const many = batchByWidth(new Array<number>(REC_BATCH * 2 + 1).fill(300));
    expect(many.map((b) => b.length)).toEqual([REC_BATCH, REC_BATCH, 1]);
  });

  it("crops a line upright, white outside the page, normalised to -1..1 in BGR", () => {
    // A 60x30 image: white, with a black bar across the middle rows.
    const w = 60;
    const h = 30;
    const rgba = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let y = 12; y < 18; y++)
      for (let x = 0; x < w; x++) rgba.fill(0, (y * w + x) * 4, (y * w + x) * 4 + 3);
    const crop = cropLine(rgba, w, h, { cx: 30, cy: 15, w: 60, h: 30, angle: 0, score: 1 }, 7);
    expect(crop.index).toBe(7);
    expect(crop.width).toBe(cropWidth({ w: 60, h: 30 }));
    const plane = REC_HEIGHT * crop.width;
    // The middle of the crop is black (-1), the top is white (1).
    expect(crop.data[(REC_HEIGHT / 2) * crop.width + 10]).toBeCloseTo(-1, 1);
    expect(crop.data[3 * crop.width + 10]).toBeCloseTo(1, 1);
    expect(crop.data.length).toBe(3 * plane);
    // A box hanging off the image reads white there.
    const off = cropLine(rgba, w, h, { cx: 0, cy: 0, w: 20, h: 10, angle: 0, score: 1 }, 0);
    expect(off.data[0]).toBeCloseTo(1, 5);
  });

  it("straightens a line that leans", () => {
    // A bright diagonal stripe leaning 10 degrees, cropped along its own direction, comes out level.
    const w = 200;
    const h = 100;
    const angle = (10 * Math.PI) / 180;
    const rgba = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let x = 20; x < 180; x++) {
      const cy = 50 + (x - 100) * Math.tan(angle);
      for (let y = Math.round(cy) - 3; y < Math.round(cy) + 3; y++)
        rgba.fill(0, (y * w + x) * 4, (y * w + x) * 4 + 3);
    }
    const crop = cropLine(rgba, w, h, { cx: 100, cy: 50, w: 150, h: 40, angle, score: 1 }, 0);
    const column = (x: number): number[] =>
      Array.from({ length: REC_HEIGHT }, (_, y) => crop.data[y * crop.width + x]);
    const centre = (col: number[]): number => {
      let sum = 0;
      let n = 0;
      col.forEach((v, y) => {
        if (v < 0) {
          sum += y;
          n++;
        }
      });
      return sum / n;
    };
    expect(Math.abs(centre(column(20)) - centre(column(crop.width - 20)))).toBeLessThan(2);
  });

  it("lays a batch out with each crop at the left of its row and zeros after", () => {
    const a = { index: 0, width: 16, data: new Float32Array(3 * REC_HEIGHT * 16).fill(1) };
    const b = { index: 1, width: 32, data: new Float32Array(3 * REC_HEIGHT * 32).fill(-1) };
    const { data, width } = batchTensor([a, b]);
    expect(width).toBe(32);
    expect(data.length).toBe(2 * 3 * REC_HEIGHT * 32);
    expect(data[0]).toBe(1);
    expect(data[15]).toBe(1);
    expect(data[16]).toBe(0);
    const second = 3 * REC_HEIGHT * 32;
    expect(data[second]).toBe(-1);
    expect(data[second + 31]).toBe(-1);
  });
});
