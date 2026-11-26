import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { measureHand, measureLines } from "../../../src/ink/tidy";
import {
  MODEL_X_HEIGHT,
  bodyOf,
  placeLines,
  type LineToPlace,
} from "../../../src/recognition/writer/layout";
import { median } from "../../../src/recognition/writer/rows";
import { writerLine, writtenLine, xs, ys } from "./fixture";

const first = writerLine(40, 100);
const second = writerLine(40, 400);
const profile = (() => {
  const p = measureHand([...first.strokes, ...second.strokes]);
  if (!p) throw new Error("the fixture ink has no hand");
  return p;
})();

function lineToPlace(
  rewrite: boolean[],
  written = writtenLine(),
): LineToPlace<(typeof first.strokes)[number]> {
  return { strokes: first.strokes, words: first.words, rewrite, written };
}

const allX = (ids: readonly string[]): number[] =>
  first.strokes.filter((s) => ids.includes(s.id)).flatMap((s) => xs(s.pts));

describe("bodyOf", () => {
  const at = (id: string, x0: number, x1: number, n = 3) => ({
    id,
    tool: "pen",
    pts: Array.from({ length: n }, (_, i) => [x0 + ((x1 - x0) * i) / (n - 1), 0, 0.5]).flat(),
  });
  // Three commas from earlier in the line, then the word itself (June).
  const ink = [
    at("c1", 0, 4),
    at("c2", 100, 104),
    at("j1", 200, 220, 9),
    at("j2", 222, 240, 9),
    at("c3", 180, 184),
  ];
  const byId = new Map(ink.map((s) => [s.id, s]));

  it("keeps the word's own run of ink and drops pieces from elsewhere on the line", () => {
    expect(bodyOf(["c1", "c2", "c3", "j1", "j2"], byId, 20)).toEqual(["c3", "j1", "j2"]);
  });

  it("keeps a word whose ink is all together as it is", () => {
    expect(bodyOf(["j2", "j1"], byId, 20)).toEqual(["j2", "j1"]);
  });
});

describe("the fixture", () => {
  it("is read as running text with a hand", () => {
    expect(measureLines(first.strokes)).toHaveLength(1);
    expect(profile.xHeight).toBeGreaterThan(0);
    expect(profile.wordGap).toBeGreaterThan(0);
  });
});

describe("placeLines", () => {
  const rewrite = [true, true, true, true];

  it("starts the new strokes at the line's left edge and stands them on its baseline", () => {
    const [placed] = placeLines([lineToPlace(rewrite)], profile);
    const left = Math.min(...first.strokes.flatMap((s) => xs(s.pts)));
    expect(Math.min(...placed.added.flatMap((s) => xs(s.pts)))).toBeCloseTo(left, 3);
    const home = measureLines(first.strokes)[0];
    const base = home.slope * left + home.level;
    // The letters' feet are the lowest points: they stand on the baseline (to within a pixel).
    expect(Math.max(...placed.added.flatMap((s) => ys(s.pts)))).toBeGreaterThan(base - 1.5);
    expect(Math.max(...placed.added.flatMap((s) => ys(s.pts)))).toBeLessThan(base + 1.5);
    // Taller than nothing: the x-height is the writer's.
    const top = Math.min(...placed.added.flatMap((s) => ys(s.pts)));
    expect(base - top).toBeGreaterThan(profile.xHeight * 0.6);
    expect(base - top).toBeLessThan(profile.xHeight * 1.6);
  });

  it("replaces every stroke of the rewritten words", () => {
    const [placed] = placeLines([lineToPlace(rewrite)], profile);
    expect([...placed.removed].sort()).toEqual(first.words.flat().sort());
    expect(placed.kept.size).toBe(0);
    expect(placed.added.length).toBe(writtenLine().length);
  });

  it("keeps the words in order with the profile's word gap between them", () => {
    const [placed] = placeLines([lineToPlace(rewrite)], profile);
    const gap = profile.wordGap * profile.xHeight;
    const extent = [0, 1, 2, 3].map((w) => {
      const v = placed.added.filter((s) => s.word === w).flatMap((s) => xs(s.pts));
      return [Math.min(...v), Math.max(...v)];
    });
    for (let w = 1; w < 4; w++) expect(extent[w][0] - extent[w - 1][1]).toBeCloseTo(gap, 3);
    expect(extent[0][0]).toBeLessThan(extent[1][0]);
  });

  it("keeps the writer's own strokes of a word with rewrite = false, moved only along the line", () => {
    const [placed] = placeLines([lineToPlace([true, false, true, true])], profile);
    const keptIds = first.words[1];
    expect([...placed.kept.keys()].sort()).toEqual([...keptIds].sort());
    for (const id of keptIds) expect(placed.removed).not.toContain(id);
    expect(placed.removed.sort()).toEqual(
      [...first.words[0], ...first.words[2], ...first.words[3]].sort(),
    );
    expect(placed.added.some((s) => s.word === 1)).toBe(false);
    // All strokes of the kept word move by the same amount, so that it sits one word gap after the word before.
    const dx = placed.kept.get(keptIds[0])?.dx as number;
    for (const id of keptIds) expect(placed.kept.get(id)?.dx).toBe(dx);
    const gap = profile.wordGap * profile.xHeight;
    const before = Math.max(...placed.added.filter((s) => s.word === 0).flatMap((s) => xs(s.pts)));
    expect(Math.min(...allX(keptIds)) + dx - before).toBeCloseTo(gap, 3);
    // And the next written word follows it by a gap.
    const after = Math.min(...placed.added.filter((s) => s.word === 2).flatMap((s) => xs(s.pts)));
    expect(after - (Math.max(...allX(keptIds)) + dx)).toBeCloseTo(gap, 3);
  });

  it("keeps the writer's own gap between two kept words (a word the reading split stays whole)", () => {
    const [placed] = placeLines([lineToPlace([true, false, false, true])], profile);
    const a = first.words[1];
    const b = first.words[2];
    const own = Math.min(...allX(b)) - Math.max(...allX(a));
    const da = placed.kept.get(a[0])?.dx as number;
    const db = placed.kept.get(b[0])?.dx as number;
    expect(Math.min(...allX(b)) + db - (Math.max(...allX(a)) + da)).toBeCloseTo(own, 6);
  });

  it("moves ink the reading gave no word with the word to its left", () => {
    // The last stroke of word 1 counts as loose ink (a comma read apart, a stray dot).
    const loose = first.words[1][first.words[1].length - 1];
    const words = first.words.map((ids, w) => (w === 1 ? ids.slice(0, -1) : [...ids]));
    const [placed] = placeLines(
      [
        {
          strokes: first.strokes,
          words,
          rewrite: [true, true, true, true],
          written: writtenLine(),
        },
      ],
      profile,
    );
    const end1 = Math.max(...allX(words[1]));
    const looseX = Math.min(...allX([loose]));
    const newEnd1 = Math.max(...placed.added.filter((s) => s.word === 1).flatMap((s) => xs(s.pts)));
    // Same distance from its word's end as before.
    expect(looseX + (placed.kept.get(loose)?.dx as number) - newEnd1).toBeCloseTo(looseX - end1, 6);
    expect(placed.removed).not.toContain(loose);
  });

  it("returns a line with nothing to rewrite unchanged", () => {
    const [placed] = placeLines([lineToPlace([false, false, false, false])], profile);
    expect(placed.added).toEqual([]);
    expect(placed.removed).toEqual([]);
    expect(placed.kept.size).toBe(first.strokes.length);
    expect([...placed.kept.values()].every((m) => m.dx === 0 && m.dy === 0)).toBe(true);
  });

  it("returns a line unchanged when nothing was written for it", () => {
    const [placed] = placeLines([lineToPlace(rewrite, [])], profile);
    expect(placed.added).toEqual([]);
    expect(placed.removed).toEqual([]);
  });

  it("gives the new points the median pressure of the line", () => {
    const [placed] = placeLines([lineToPlace(rewrite)], profile);
    const expected = median(
      first.strokes.map((s) => {
        const p: number[] = [];
        for (let i = 2; i < s.pts.length; i += 3) p.push(s.pts[i]);
        return median(p);
      }),
    );
    for (const s of placed.added)
      for (let i = 2; i < s.pts.length; i += 3) expect(s.pts[i]).toBeCloseTo(expected);
  });

  it("stands a kept word of a tilted line on the written words' level line (B-214. on Joost's iPad)", () => {
    // The line climbs 1 px in 10; its last word stays the writer's ink.
    const tilt = (pts: ArrayLike<number>) =>
      Array.from(pts, (v, i) => (i % 3 === 1 ? v - 0.1 * (pts[i - 1] - 40) : v));
    const strokes = first.strokes.map((s) => ({ ...s, pts: tilt(s.pts) }));
    const [placed] = placeLines(
      [{ strokes, words: first.words, rewrite: [true, true, true, false], written: writtenLine() }],
      profile,
    );
    const feet = Math.max(...placed.added.flatMap((s) => ys(s.pts)));
    const kept = strokes.filter((s) => first.words[3].includes(s.id));
    const keptFeet = Math.max(
      ...kept.flatMap((s) => ys(s.pts).map((y) => y + (placed.kept.get(s.id)?.dy ?? 0))),
    );
    // Unmoved, its feet stand 8 px or more above the written words (they were 16 before the level line stood at the line's middle); now on the same line.
    expect(feet - Math.max(...kept.flatMap((s) => ys(s.pts)))).toBeGreaterThan(5);
    expect(Math.abs(keptFeet - feet)).toBeLessThan(0.3 * profile.xHeight);
  });

  it("never pushes ink past the page's edge: gaps narrow, then the rightmost written words go back to ink", () => {
    const right = Math.max(...first.strokes.flatMap((s) => xs(s.pts)));
    const pageWidth = right + profile.xHeight;
    const sized = (k: number) => ({
      ...lineToPlace([true, true, true, true]),
      xHeight: { ink: k * profile.xHeight, written: MODEL_X_HEIGHT, least: 0 },
    });
    const rightOf = (placed: ReturnType<typeof placeLines>[number]) =>
      Math.max(
        ...first.strokes
          .filter((s) => placed.kept.has(s.id))
          .flatMap((s) => xs(s.pts).map((x) => x + (placed.kept.get(s.id)?.dx ?? 0))),
        ...placed.added.flatMap((s) => xs(s.pts)),
      );
    // A quarter bigger than the writer's: past the edge, until the gaps narrow.
    expect(rightOf(placeLines([sized(1.25)], profile)[0])).toBeGreaterThan(right);
    const narrowed = placeLines([sized(1.25)], profile, pageWidth)[0];
    expect(rightOf(narrowed)).toBeLessThanOrEqual(right + 1e-6);
    expect(new Set(narrowed.added.map((s) => s.word))).toEqual(new Set([0, 1, 2, 3]));
    // Half again bigger: the last word goes back to the writer's own ink.
    const held = placeLines([sized(1.5)], profile, pageWidth)[0];
    expect(rightOf(held)).toBeLessThanOrEqual(right + 1e-6);
    expect(new Set(held.added.map((s) => s.word))).toEqual(new Set([0, 1, 2]));
    for (const id of first.words[3]) expect(held.kept.has(id)).toBe(true);
    // A word the writer answered on a card goes back last: the word before it goes instead.
    const answered = { ...sized(1.5), answered: [false, false, false, true] };
    const kept = placeLines([answered], profile, pageWidth)[0];
    expect(rightOf(kept)).toBeLessThanOrEqual(right + 1e-6);
    expect(kept.added.some((s) => s.word === 3)).toBe(true);
    expect(kept.added.some((s) => s.word === 2)).toBe(false);
  });

  it("places each line on its own, in order", () => {
    const both = placeLines(
      [
        lineToPlace(rewrite),
        { strokes: second.strokes, words: second.words, rewrite, written: writtenLine() },
      ],
      profile,
    );
    expect(both).toHaveLength(2);
    expect(Math.min(...both[1].added.flatMap((s) => ys(s.pts)))).toBeGreaterThan(
      Math.max(...both[0].added.flatMap((s) => ys(s.pts))),
    );
  });
});

describe("placeLines on Joost's line alone on the page (his iPad, 24 November)", () => {
  // "testing the new beautify", "the" and "new" rewritten. Alone on a page, his hand
  // measures a word gap of half an x-height, and the words he left were trimmed at
  // gaps inside them: "the" and "new" were drawn on top of "testing", pieces of his
  // old "the" and "new" stayed behind.
  const real = JSON.parse(
    readFileSync(join(__dirname, "fixtures", "joost-line-alone.json"), "utf8"),
  ) as { strokes: { id: string; t0: number; pts: number[] }[]; words: string[][] };
  const strokes = real.strokes.map((s) => ({ ...s, tool: "pen", shape: null }));
  const hand = measureHand(strokes);
  if (!hand) throw new Error("no hand");
  const [line] = placeLines(
    [
      {
        strokes,
        words: real.words,
        rewrite: [false, true, true, false],
        written: writtenLine(4, 3),
      },
    ],
    hand,
  );
  const ptsOf = (id: string): number[] => strokes.find((t) => t.id === id)?.pts ?? [];
  const span = (all: number[]): [number, number] => [Math.min(...all), Math.max(...all)];
  const keptSpan = (w: number) =>
    span(real.words[w].flatMap((id) => xs(ptsOf(id)).map((x) => x + (line.kept.get(id)?.dx ?? 0))));
  const newSpan = (w: number) =>
    span(line.added.filter((s) => s.word === w).flatMap((s) => xs(s.pts)));

  it("measures a word gap of under one x-height from this line alone (the trap)", () => {
    expect(hand.wordGap).toBeLessThan(1);
  });

  it("takes away every stroke of the rewritten words and keeps all of the others", () => {
    expect(new Set(line.removed)).toEqual(new Set([...real.words[1], ...real.words[2]]));
    for (const id of [...real.words[0], ...real.words[3]]) expect(line.kept.has(id)).toBe(true);
  });

  it("lays the words out left to right without overlapping", () => {
    const order = [keptSpan(0), newSpan(1), newSpan(2), keptSpan(3)];
    for (let i = 1; i < order.length; i++) expect(order[i][0]).toBeGreaterThan(order[i - 1][1]);
  });

  it("writes the new words as wide, together, as his were", () => {
    const width = ([a, b]: [number, number]): number => b - a;
    const his = [1, 2].reduce(
      (sum, w) => sum + width(span(real.words[w].flatMap((id) => xs(ptsOf(id))))),
      0,
    );
    const made = [1, 2].reduce((sum, w) => sum + width(newSpan(w)), 0);
    expect(made / his).toBeGreaterThan(0.95);
    expect(made / his).toBeLessThan(1.05);
  });
});
