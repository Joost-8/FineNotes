import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { measureHand } from "../../../src/ink/tidy";
import { neatenEdit } from "../../../src/recognition/writer/apply";
import { placeLines } from "../../../src/recognition/writer/layout";

// "I'm the captain" on a climbing line of Joost's notebook (slope -0.149), with the ink of the page
// around it, and one fixed written line ("I'm the" rewritten, "captain" left): no model runs here.
// Beautify stood the level line at the line's left end, its lowest point, which is on the page's
// next line of ink; Tidy then grouped "captain" and the I's bottom bar with that neighbour and
// levelled them to it (26 November: "captain" 16 px under the written words, a second bar in the I).
const real = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "joost-climbing-line.json"), "utf8"),
) as {
  width: number;
  lineIds: string[];
  words: string[][];
  rewrite: boolean[];
  xHeight: { ink: number; written: number; least: number };
  written: { pts: number[]; word: number }[];
  strokes: { id: string; t0: number | null; pts: number[] }[];
};
const strokes = real.strokes.map((s) => ({ ...s, tool: "pen", shape: null }));
const hand = measureHand(strokes);
if (!hand) throw new Error("no hand");
const lineIds = new Set(real.lineIds);
const line = strokes.filter((s) => lineIds.has(s.id));
const [placed] = placeLines(
  [
    {
      strokes: line,
      words: real.words,
      rewrite: real.rewrite,
      written: real.written,
      xHeight: real.xHeight,
    },
  ],
  hand,
  real.width,
);
const edit = neatenEdit(strokes, [placed], hand, null, lineIds);

const ys = (pts: readonly number[]): number[] => pts.filter((_, i) => i % 3 === 1);
const bottom = (pts: readonly number[]): number => Math.max(...ys(pts));
const mean = (v: readonly number[]): number => v.reduce((a, b) => a + b, 0) / v.length;
const median = (v: readonly number[]): number => {
  const s = [...v].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : 0.5 * (s[s.length / 2 - 1] + s[s.length / 2]);
};

describe("Beautify on a climbing line", () => {
  const writtenWords = edit.added.filter((_, i) => placed.added[i].word <= 1);
  const keptWord = real.words[2].map((id) => edit.moved.get(id) as number[]);

  it("really is a climbing line with the page's next line of ink under its left end (the trap)", () => {
    const own = line.flatMap((s) => ys(s.pts));
    const others = strokes.filter((s) => !lineIds.has(s.id));
    const below = others.filter((s) => median(ys(s.pts)) > Math.max(...own) - hand.xHeight);
    expect(below.length).toBeGreaterThan(5);
  });

  it("leaves the word it kept standing on the written words' baseline", () => {
    const written = median(writtenWords.map((s) => bottom(s.pts)));
    const kept = median(keptWord.map(bottom));
    expect(Math.abs(kept - written)).toBeLessThan(5);
  });

  it("does not move the bars of the written I against its stem", () => {
    const word0 = placed.added.map((s, i) => ({ s, i })).filter(({ s }) => s.word === 0);
    const centre = (pts: readonly number[]): number => mean(ys(pts));
    const height = (pts: readonly number[]): number => Math.max(...ys(pts)) - Math.min(...ys(pts));
    const stem = word0.reduce((a, b) => (height(b.s.pts) > height(a.s.pts) ? b : a));
    const against = (pts: readonly number[], stemPts: readonly number[]): number =>
      centre(pts) - centre(stemPts);
    for (const { s, i } of word0) {
      const was = against(s.pts, stem.s.pts);
      const now = against(edit.added[i].pts, edit.added[stem.i].pts);
      expect(Math.abs(now - was)).toBeLessThan(1);
    }
  });

  it("still puts the kept word inside the page", () => {
    const right = Math.max(...keptWord.flatMap((pts) => pts.filter((_, i) => i % 3 === 0)));
    expect(right).toBeLessThan(real.width);
  });
});
