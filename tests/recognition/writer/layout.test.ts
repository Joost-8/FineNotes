import { describe, expect, it } from "vitest";

import { measureHand, measureLines } from "../../../src/ink/tidy";
import { placeLines, type LineToPlace } from "../../../src/recognition/writer/layout";
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
    const dx = placed.kept.get(keptIds[0]) as number;
    for (const id of keptIds) expect(placed.kept.get(id)).toBe(dx);
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
    const da = placed.kept.get(a[0]) as number;
    const db = placed.kept.get(b[0]) as number;
    expect(Math.min(...allX(b)) + db - (Math.max(...allX(a)) + da)).toBeCloseTo(own, 6);
  });

  it("returns a line with nothing to rewrite unchanged", () => {
    const [placed] = placeLines([lineToPlace([false, false, false, false])], profile);
    expect(placed.added).toEqual([]);
    expect(placed.removed).toEqual([]);
    expect(placed.kept.size).toBe(first.strokes.length);
    expect([...placed.kept.values()].every((dx) => dx === 0)).toBe(true);
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
