import { describe, expect, it } from "vitest";

import { measureLines } from "../../../src/ink/tidy";
import {
  chunkLine,
  flowWords,
  numericAnswer,
  placeAnswer,
  placeOfWord,
  placeWord,
  plainMarkdown,
  readsAs,
  wordsOfLines,
  writableText,
  type WrittenWord,
} from "../../../src/recognition/writer/known-layout";
import type { WrittenStroke } from "../../../src/recognition/writer/rows";
import { H, writerLine, writtenLine, xs, ys } from "./fixture";

const ascii = (ch: string): boolean => ch >= " " && ch <= "~";

describe("writableText", () => {
  it("writes typographic marks as plain ones and keeps line breaks", () => {
    const got = writableText("“Hello” – it’s…\r\n  next\tline  ", ascii);
    expect(got).toEqual({ text: '"Hello" - it\'s...\nnext line', missing: [] });
  });

  it("lists each letter the model lacks once, in order", () => {
    expect(writableText("café naïve café", ascii).missing).toEqual(["é", "ï"]);
  });
});

describe("plainMarkdown", () => {
  it("writes a Markdown box as it reads, without its marks", () => {
    const md = [
      "# Exam week",
      "- **Read** chapter *four*",
      "* [ ] Redo set ~~2~~ 3",
      "> see [[Lecture 3|the lecture]] and [notes](https://x.y)",
      "`ATP` is __made__ in snake_case_names",
    ].join("\n");
    expect(plainMarkdown(md)).toBe(
      [
        "Exam week",
        "- Read chapter four",
        "- Redo set 2 3",
        "see the lecture and notes",
        "ATP is made in snake_case_names",
      ].join("\n"),
    );
  });

  it("leaves plain text alone", () => {
    expect(plainMarkdown("2 * 3 = 6, a_b and 5 - 2")).toBe("2 * 3 = 6, a_b and 5 - 2");
  });
});

describe("chunkLine", () => {
  it("cuts at spaces, at most max characters a piece", () => {
    expect(chunkLine("aa bb cc dd", 5)).toEqual(["aa bb", "cc dd"]);
    expect(chunkLine("one", 5)).toEqual(["one"]);
  });

  it("gives a word longer than max a piece of its own", () => {
    expect(chunkLine("a extraordinary b", 5)).toEqual(["a", "extraordinary", "b"]);
  });

  it("makes nothing of an empty line", () => {
    expect(chunkLine("   ")).toEqual([]);
  });
});

describe("wordsOfLines", () => {
  it("cuts a line into its words, each from x 0 on its own baseline", () => {
    const [words] = wordsOfLines([writtenLine(3, 3)], H);
    expect(words).toHaveLength(3);
    for (const word of words) {
      const x = word.strokes.flatMap(xs);
      expect(Math.min(...x)).toBeCloseTo(0, 6);
      expect(Math.max(...x)).toBeCloseTo(word.width, 6);
      // Feet on the baseline (y 0), the letters above it (y down, so negative).
      const y = word.strokes.flatMap(ys);
      expect(Math.max(...y)).toBeCloseTo(0, 0);
      expect(Math.min(...y)).toBeLessThan(-H * 0.7);
    }
  });

  it("sizes the words to the writer's x-height", () => {
    const [words] = wordsOfLines([writtenLine(2, 3)], H);
    const height = -Math.min(...words[0].strokes.flatMap(ys));
    expect(height).toBeGreaterThan(H / 1.25);
    expect(height).toBeLessThan(H * 1.25);
  });

  it("evens out a line of several words toward the writer's size, a short one not", () => {
    // Letters written half as tall as the model's calibration.
    const half = (line: WrittenStroke[]): WrittenStroke[] =>
      line.map((s) => ({ ...s, pts: s.pts.map((v, i) => (i % 2 === 1 ? v * 0.5 : v)) }));
    const heightOf = (words: WrittenWord[]): number => -Math.min(...words[0].strokes.flatMap(ys));
    const [long, short] = wordsOfLines([half(writtenLine(4, 3)), half(writtenLine(1, 3))], H);
    expect(heightOf(long)).toBeCloseTo(H * 0.5 * 1.3, 0);
    expect(heightOf(short)).toBeCloseTo(H * 0.5, 0);
  });

  it("gives a stroke of no word to the word before it", () => {
    const line: WrittenStroke[] = [...writtenLine(2, 2), { pts: [5, 0, 5.05, 0.01], word: -1 }];
    const [words] = wordsOfLines([line], H);
    expect(words).toHaveLength(2);
    expect(words[1].strokes).toHaveLength(3);
  });
});

const box = (width: number, height = H): WrittenWord => ({
  strokes: [[0, 0, 0.5, width, -height, 0.5]],
  width,
});

describe("flowWords", () => {
  const frame = { left: 50, right: 250, top: 100, pitch: 40, bottom: 400, gap: 10 };

  it("wraps at the right edge with the writer's gap", () => {
    const flowed = flowWords([[box(90), box(90), box(90)]], frame);
    expect(flowed.lines).toBe(2);
    expect(flowed.left).toBe(0);
    expect(flowed.strokes.map((s) => [s[0], s[1]])).toEqual([
      [50, 100],
      [150, 100],
      [50, 140],
    ]);
  });

  it("starts every paragraph on a new line, and keeps a blank one", () => {
    const flowed = flowWords([[box(20)], [], [box(20)]], frame);
    expect(flowed.strokes.map((s) => s[1])).toEqual([100, 180]);
    expect(flowed.lines).toBe(3);
  });

  it("never puts two lines on one baseline, however many paragraphs", () => {
    const paragraphs = Array.from({ length: 5 }, () => [box(150), box(150)]);
    const baselines = flowWords(paragraphs, frame).strokes.map((s) => s[1]);
    expect(new Set(baselines).size).toBe(baselines.length);
    expect(baselines).toEqual([...baselines].sort((a, b) => a - b));
  });

  it("sets lines on the rules at or below the top on ruled paper", () => {
    const flowed = flowWords([[box(150), box(150)]], {
      ...frame,
      rules: [60, 96, 132, 168],
    });
    expect(flowed.strokes.map((s) => s[1])).toEqual([132, 168]);
  });

  it("stops at the bottom and counts the words left out", () => {
    const flowed = flowWords([[box(150), box(150), box(150)]], { ...frame, bottom: 140 });
    expect(flowed.strokes).toHaveLength(2);
    expect(flowed.left).toBe(1);
  });

  it("skips the lines where ink already is", () => {
    const flowed = flowWords([[box(150), box(150)]], {
      ...frame,
      taken: [{ x0: 200, y0: 130, x1: 300, y1: 145 }],
      reach: { up: 20, down: 8 },
    });
    expect(flowed.strokes.map((s) => s[1])).toEqual([100, 180]);
  });

  it("gives a word wider than the frame a line of its own", () => {
    const flowed = flowWords([[box(20), box(400), box(20)]], frame);
    expect(flowed.strokes.map((s) => s[1])).toEqual([100, 140, 180]);
  });
});

describe("placeOfWord and placeWord", () => {
  const line = writerLine(40, 200, 4, 4);
  const word = new Set(line.words[1]);

  it("finds the word's line and the strokes after it", () => {
    const at = placeOfWord(line.strokes, word);
    expect(at).not.toBeNull();
    if (!at) return;
    expect(at.after.sort()).toEqual([...line.words[2], ...line.words[3]].sort());
    expect(at.level + at.slope * at.x0).toBeCloseTo(200, 0);
    expect(at.xHeight).toBeGreaterThan(H * 0.7);
  });

  it("puts the new word on the line from the old one's left, and says how far the rest moves", () => {
    const at = placeOfWord(line.strokes, word);
    if (!at) throw new Error("no line");
    const placed = placeWord(box(at.x1 - at.x0 + 25), at);
    expect(placed.strokes[0][0]).toBeCloseTo(at.x0, 6);
    expect(placed.strokes[0][1]).toBeCloseTo(at.slope * at.x0 + at.level, 6);
    expect(placed.shift).toBeCloseTo(25, 6);
  });

  it("follows a sloped line", () => {
    const at = { slope: 0.1, level: 100, xHeight: H, x0: 50, x1: 80, after: [] };
    const placed = placeWord({ strokes: [[0, 0, 0.5, 30, 0, 0.5]], width: 30 }, at);
    expect(placed.strokes[0][1]).toBeCloseTo(105, 6);
    expect(placed.strokes[0][4]).toBeCloseTo(108, 6);
  });

  it("knows no line for ink that is not there", () => {
    expect(placeOfWord(line.strokes, new Set(["nope"]))).toBeNull();
  });

  it("is a real line of the fixture", () => {
    expect(measureLines(line.strokes)).toHaveLength(1);
  });
});

describe("placeAnswer", () => {
  // "1.5": two tall strokes (0 to 1 up) and a dot at the foot.
  const written: WrittenStroke[] = [
    { pts: [0, 0, 0, 1], word: 0 },
    { pts: [0.3, 0, 0.32, 0.02], word: 0 },
    { pts: [0.5, 1, 0.5, 0.5, 0.8, 0.4, 0.8, 0, 0.5, 0], word: 0 },
  ];

  it("stands the figures on the baseline, at the height asked, from x", () => {
    const placed = placeAnswer(written, { x: 300, baseline: 200, height: 20 });
    const x = placed.flatMap(xs);
    const y = placed.flatMap(ys);
    expect(Math.min(...x)).toBeCloseTo(300, 6);
    expect(Math.max(...y)).toBeCloseTo(200, 6);
    expect(Math.min(...y)).toBeCloseTo(180, 6);
  });

  it("writes nothing for nothing", () => {
    expect(placeAnswer([], { x: 0, baseline: 0, height: 10 })).toEqual([]);
  });
});

describe("readsAs", () => {
  it("takes an answer read back exactly, spaces aside", () => {
    expect(readsAs("$1,250.50", "$1,250.50")).toBe(true);
    expect(readsAs("12.5%", "12.5 %")).toBe(true);
  });

  it("refuses one figure or mark off", () => {
    expect(readsAs("$1,250.50", "$1,250.40")).toBe(false);
    expect(readsAs("12.5%", '12.5 ".')).toBe(false);
    expect(readsAs("-42", "42")).toBe(false);
  });
});

describe("numericAnswer", () => {
  it("takes plain numbers, decimals, negatives, percentages and money", () => {
    for (const ok of ["42", "-3", "3.14", "1,000,000", "12.5%", "$1,000", "-$5", ".5"])
      expect(numericAnswer(ok), ok).toBe(true);
  });

  it("never takes symbolic or two-dimensional maths", () => {
    for (const no of ["x+1", "2^3", "1/2", "√2", "π", "3e5", "", "-", "5 + 3"])
      expect(numericAnswer(no), no).toBe(false);
  });
});
