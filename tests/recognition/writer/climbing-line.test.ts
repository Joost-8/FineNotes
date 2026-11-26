import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { measureHand } from "../../../src/ink/tidy";
import { neatenEdit } from "../../../src/recognition/writer/apply";
import {
  CLEAR_PAD,
  clearBaseline,
  clearanceFor,
  clearanceOf,
  placeLines,
} from "../../../src/recognition/writer/layout";

// "I'm the captain" on a climbing line of Joost's notebook (slope -0.149), with the ink of the page
// around it, and one fixed written line ("I'm the" rewritten, "captain" left): no model runs here.
// Beautify stood the level line at the line's left end, its lowest point, which is on the page's
// next line of ink; Tidy then grouped "captain" and the I's bottom bar with that neighbour and
// levelled them to it (26 November: "captain" 16 px under the written words, a second bar in the I).
// At the line's middle instead, the written I (40 px tall against his 27) passed 1.8 px from the
// line above: the level line must clear the ink on both sides.
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
const others = strokes.filter((s) => !lineIds.has(s.id));
const clear = clearanceFor(line, others, hand.xHeight);
const input = {
  strokes: line,
  words: real.words,
  rewrite: real.rewrite,
  written: real.written,
  xHeight: real.xHeight,
};
const [placed] = placeLines([{ ...input, clear }], hand, real.width);
const edit = neatenEdit(strokes, [placed], hand, null, lineIds);

const ys = (pts: readonly number[]): number[] => pts.filter((_, i) => i % 3 === 1);
const bottom = (pts: readonly number[]): number => Math.max(...ys(pts));
const top = (pts: readonly number[]): number => Math.min(...ys(pts));
const mean = (v: readonly number[]): number => v.reduce((a, b) => a + b, 0) / v.length;
const median = (v: readonly number[]): number => {
  const s = [...v].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : 0.5 * (s[s.length / 2 - 1] + s[s.length / 2]);
};

describe("clearanceOf", () => {
  const line = { x0: 100, x1: 300, y0: 0, y1: 0 };
  const box = (x0: number, x1: number, y0: number, y1: number) => ({ x0, x1, y0, y1 });
  it("takes the lowest ink above and the highest ink below, near the line's x-range", () => {
    const got = clearanceOf(
      line,
      [
        box(120, 160, 20, 60), // above, bottom 60
        box(200, 240, 10, 80), // above, bottom 80 (the lowest)
        box(150, 180, 140, 190), // below, top 140
        box(250, 280, 120, 200), // below, top 120 (the highest)
        box(900, 950, 90, 110), // far to the right of the line
      ],
      100,
      20,
    );
    expect(got).toEqual({ above: 80, below: 120 });
  });
  it("is null on a side with nothing, and ignores ink standing on the line", () => {
    expect(clearanceOf(line, [box(150, 180, 90, 105)], 100, 20)).toEqual({
      above: null,
      below: null,
    });
  });
  it("counts ink up to an x-height beyond the line's ends", () => {
    expect(clearanceOf(line, [box(310, 330, 0, 50)], 100, 20).above).toBe(50);
    expect(clearanceOf(line, [box(330, 350, 0, 50)], 100, 20).above).toBeNull();
  });
});

describe("clearBaseline", () => {
  const band = { top: 40, depth: 10 };
  const pad = 5;
  it("leaves a baseline where the written band already clears both sides", () => {
    expect(clearBaseline(100, band, { above: 20, below: 200 }, pad, [90, 110])).toBe(100);
    expect(clearBaseline(100, band, { above: null, below: null }, pad, [90, 110])).toBe(100);
  });
  it("moves down, within the line's climb, when the ink above is too close", () => {
    // The band's top (100 - 40 = 60) is 2 under the ink above (58): needs 63, so 103.
    expect(clearBaseline(100, band, { above: 58, below: null }, pad, [90, 120])).toBe(103);
    // The climb ends at 101.
    expect(clearBaseline(100, band, { above: 58, below: null }, pad, [90, 101])).toBe(101);
  });
  it("moves up when the ink below is too close", () => {
    // The band's foot (100 + 10 = 110) is 2 above the ink below (112): needs 107, so 97.
    expect(clearBaseline(100, band, { above: null, below: 112 }, pad, [90, 120])).toBe(97);
  });
  it("centres the band between ink on both sides, and shares a shortage equally", () => {
    // Ink at 20 and 105 around a band of 50 (now 10 too low): centred, 17.5 either side.
    expect(clearBaseline(100, band, { above: 20, below: 105 }, pad, [0, 200])).toBe(77.5);
    // Room 20..60 for a band of 50: it does not fit; both sides short by 5 (gaps -5 and -5).
    const y = clearBaseline(100, band, { above: 20, below: 60 }, pad, [0, 200]);
    expect(y - band.top - 20).toBeCloseTo(60 - y - band.depth, 9);
  });
});

describe("placeLines with clearance", () => {
  const home = placeLines([{ ...input }], hand, real.width)[0];
  const feet = (p: typeof home): number => Math.max(...p.added.flatMap((s) => ys(s.pts)));
  const crown = (p: typeof home): number => Math.min(...p.added.flatMap((s) => ys(s.pts)));
  it("is the line's middle when nothing is given, and the same when it already clears", () => {
    const roomy = placeLines(
      [{ ...input, clear: { above: crown(home) - 100, below: feet(home) + 100 } }],
      hand,
      real.width,
    )[0];
    expect(feet(roomy)).toBeCloseTo(feet(home), 9);
  });
  it("moves the written words down when ink above is too close", () => {
    const close = placeLines(
      [{ ...input, clear: { above: crown(home) + 1, below: null } }],
      hand,
      real.width,
    )[0];
    expect(feet(close)).toBeGreaterThan(feet(home));
  });
});

describe("Beautify on a climbing line", () => {
  const writtenWords = edit.added.filter((_, i) => placed.added[i].word <= 1);
  const keptWord = real.words[2].map(
    (id) => edit.moved.get(id) ?? line.find((s) => s.id === id)!.pts,
  );
  const writtenTop = Math.min(...writtenWords.map((s) => top(s.pts)));
  const writtenFoot = Math.max(...writtenWords.map((s) => bottom(s.pts)));

  it("sees the line above and the line below (the trap)", () => {
    expect(clear?.above).not.toBeNull();
    expect(clear?.below).not.toBeNull();
  });

  it("shares the shortage between the line above and the line below, and stays clear of both", () => {
    // Written big (40 px tall for his 27), the band (41 px) is taller than the room between the
    // boxes of the two lines (34 px): the boxes overlap by 3.3 px on each side, equally.
    const above = writtenTop - (clear?.above as number);
    const below = (clear?.below as number) - writtenFoot;
    expect(Math.abs(above - below)).toBeLessThan(0.5);
    // By the ink itself every stroke of the page stays 5 px or more from the written words
    // (the I was 1.8 px from s14 at the line's middle).
    const near = (a: readonly number[], b: readonly number[]): number => {
      let m = Infinity;
      for (let i = 0; i < a.length; i += 3)
        for (let j = 0; j < b.length; j += 3)
          m = Math.min(m, Math.hypot(a[i] - b[j], a[i + 1] - b[j + 1]));
      return m;
    };
    const written = writtenWords.flatMap((s) => s.pts);
    for (const s of others) expect(near(written, s.pts)).toBeGreaterThan(CLEAR_PAD * hand.xHeight);
  });

  it("leaves the word it kept standing on the written words' baseline", () => {
    const written = median(writtenWords.map((s) => bottom(s.pts)));
    const kept = median(keptWord.map(bottom));
    expect(Math.abs(kept - written)).toBeLessThan(3);
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
      expect(Math.abs(now - was)).toBeLessThan(1.5);
    }
  });

  it("still puts the kept word inside the page", () => {
    const right = Math.max(...keptWord.flatMap((pts) => pts.filter((_, i) => i % 3 === 0)));
    expect(right).toBeLessThan(real.width);
  });
});

describe("Beautify on a climbing line squeezed between two lines (stock seed 6)", () => {
  // The level line is moved to clear the line above and below; with the line just stood level,
  // Tidy must not regroup it with the line below and level it to that again (the kept word ended
  // 5.8 px under the new words, the new words moved up to 7 px).
  const squeezed = JSON.parse(
    readFileSync(join(__dirname, "fixtures", "joost-climbing-line-squeezed.json"), "utf8"),
  ) as typeof real;
  const all = squeezed.strokes.map((s) => ({ ...s, tool: "pen", shape: null }));
  const hand2 = measureHand(all);
  if (!hand2) throw new Error("no hand");
  const ids = new Set(squeezed.lineIds);
  const own = all.filter((s) => ids.has(s.id));
  const [lineOut] = placeLines(
    [
      {
        strokes: own,
        words: squeezed.words,
        rewrite: squeezed.rewrite,
        written: squeezed.written,
        xHeight: squeezed.xHeight,
        clear: clearanceFor(
          own,
          all.filter((s) => !ids.has(s.id)),
          hand2.xHeight,
        ),
      },
    ],
    hand2,
    squeezed.width,
  );
  const out = neatenEdit(all, [lineOut], hand2, null, ids);

  it("leaves the written words where placeLines put them", () => {
    out.added.forEach((s, i) => {
      s.pts.forEach((v, k) => {
        if (k % 3 !== 2) expect(Math.abs(v - lineOut.added[i].pts[k])).toBeLessThan(0.5);
      });
    });
  });

  it("leaves the kept word on the written words' feet", () => {
    const feet = median(out.added.map((s) => bottom(s.pts)));
    const kept = median(
      squeezed.words[2].map((id) => bottom(out.moved.get(id) ?? all.find((s) => s.id === id)!.pts)),
    );
    expect(Math.abs(kept - feet)).toBeLessThan(3);
  });
});
