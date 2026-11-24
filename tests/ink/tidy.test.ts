import { describe, expect, it } from "vitest";

import {
  ASKED_LEVEL_SLOPE,
  DEFAULT_STRENGTH,
  lineOfStroke,
  measureHand,
  measureLines,
  neatness,
  tidyInk,
} from "../../src/ink/tidy";
import type { PageInk } from "../../src/recognition/hwr/lines";

/** x-height, letter width, gap between letters and between words, distance between lines (page px). */
const H = 12;
const W = 10;
const LETTER_GAP = 3;
const WORD_GAP = 16;
const PITCH = 40;

/**
 * The letters a line is written in. A hand is not one shape: stems give the
 * pen one turn at the foot, a "w" several, a dot and a crossbar none, and a
 * "g" hangs below the line.
 */
type Kind = "w" | "l" | "o" | "i" | "g" | "t";
const HAND: readonly Kind[] = ["w", "l", "o", "i", "g", "t", "w", "o"];

interface LineSpec {
  x: number;
  /** Baseline at the line's start (page y, down). */
  y: number;
  words?: number;
  letters?: number;
  /** The baseline's slope, and a slow wave on it (amplitude px, period px). */
  slope?: number;
  wave?: [number, number];
  /** tan of the lean. */
  lean?: number;
  wordGap?: number;
  /** Letter height over H. */
  size?: number;
  /** The letters to cycle through; the whole hand when absent. */
  hand?: readonly Kind[];
}

let nextId = 0;
let clock = 0;
/** Which line each stroke was written in, and which strokes stand on the baseline. */
let lineOf = new Map<string, number>();
let standing = new Set<string>();
let lineNo = 0;

/** A stroke through `corners` (x right, y up from the baseline), `per` points a side. */
function stroke(
  x: number,
  base: number,
  lean: number,
  corners: readonly [number, number][],
  stands: boolean,
  per = 6,
): PageInk {
  const pts: number[] = [];
  const put = (px: number, py: number): void => {
    pts.push(x + px + py * lean, base - py, 0.5);
  };
  for (let c = 0; c + 1 < corners.length; c++) {
    for (let k = 0; k < per; k++) {
      const f = k / per;
      put(
        corners[c][0] + f * (corners[c + 1][0] - corners[c][0]),
        corners[c][1] + f * (corners[c + 1][1] - corners[c][1]),
      );
    }
  }
  put(...corners[corners.length - 1]);
  clock += 300;
  const id = `s${nextId++}`;
  lineOf.set(id, lineNo);
  if (stands) standing.add(id);
  return { id, tool: "pen", shape: null, t0: clock, pts };
}

const ring = (h: number): [number, number][] =>
  Array.from({ length: 13 }, (_, k): [number, number] => {
    const a = (2 * Math.PI * k) / 12;
    return [W / 2 + (W / 2) * Math.sin(a), h / 2 + (h / 2) * Math.cos(a)];
  });

function letter(kind: Kind, x: number, base: number, h: number, lean: number): PageInk[] {
  switch (kind) {
    case "w":
      return [
        stroke(
          x,
          base,
          lean,
          [
            [0, h],
            [W / 4, 0],
            [W / 2, h],
            [(3 * W) / 4, 0],
            [W, h],
          ],
          true,
        ),
      ];
    case "l":
      return [
        stroke(
          x,
          base,
          lean,
          [
            [W / 2, 2 * h],
            [W / 2, 0],
          ],
          true,
          12,
        ),
      ];
    case "o":
      return [stroke(x, base, lean, ring(h), true, 2)];
    case "i":
      return [
        stroke(
          x,
          base,
          lean,
          [
            [W / 2, h],
            [W / 2, 0],
          ],
          true,
          8,
        ),
        stroke(
          x,
          base,
          lean,
          [
            [W / 2, 1.5 * h],
            [W / 2 + 0.3, 1.5 * h - 0.3],
          ],
          false,
          1,
        ),
      ];
    case "g":
      return [
        stroke(x, base, lean, [...ring(h), [W, h], [W, -0.8 * h], [W / 3, -0.9 * h]], false, 3),
      ];
    case "t":
      return [
        stroke(
          x,
          base,
          lean,
          [
            [W / 2, 1.6 * h],
            [W / 2, 0],
          ],
          true,
          10,
        ),
        stroke(
          x,
          base,
          lean,
          [
            [0, h],
            [W, h],
          ],
          false,
        ),
      ];
  }
}

function line(spec: LineSpec): PageInk[] {
  const out: PageInk[] = [];
  const words = spec.words ?? 6;
  const letters = spec.letters ?? 4;
  const gap = spec.wordGap ?? WORD_GAP;
  const hand = spec.hand ?? HAND;
  let x = spec.x;
  let n = 0;
  for (let w = 0; w < words; w++) {
    for (let l = 0; l < letters; l++) {
      const base =
        spec.y +
        (spec.slope ?? 0) * (x - spec.x) +
        (spec.wave ? spec.wave[0] * Math.sin((2 * Math.PI * (x - spec.x)) / spec.wave[1]) : 0);
      out.push(...letter(hand[n++ % hand.length], x, base, H * (spec.size ?? 1), spec.lean ?? 0));
      x += W + LETTER_GAP;
    }
    x += gap - LETTER_GAP;
  }
  clock += 2000;
  lineNo++;
  return out;
}

function page(specs: LineSpec[]): PageInk[] {
  nextId = 0;
  clock = 0;
  lineNo = 0;
  lineOf = new Map();
  standing = new Set();
  return specs.flatMap(line);
}

const apply = (strokes: readonly PageInk[], pts: Map<string, number[]>): PageInk[] =>
  strokes.map((s) => (pts.has(s.id) ? { ...s, pts: pts.get(s.id) as number[] } : s));

const edge = (s: PageInk, at: 0 | 1, pick: (a: number, b: number) => number, from: number) => {
  let v = from;
  for (let i = 0; i + 1 < s.pts.length; i += 3) v = pick(v, s.pts[i + at]);
  return v;
};
const left = (s: PageInk): number => edge(s, 0, Math.min, Infinity);
const right = (s: PageInk): number => edge(s, 0, Math.max, -Infinity);
const top = (s: PageInk): number => edge(s, 1, Math.min, Infinity);
const bottom = (s: PageInk): number => edge(s, 1, Math.max, -Infinity);
const spread = (v: number[]): number => Math.max(...v) - Math.min(...v);
const inLine = (strokes: readonly PageInk[], k: number): PageInk[] =>
  strokes.filter((s) => lineOf.get(s.id) === k);
/** Where the letters that stand on the baseline end (the feet of a line). */
const feet = (strokes: readonly PageInk[], k = 0): number[] =>
  inLine(strokes, k)
    .filter((s) => standing.has(s.id))
    .map(bottom);
/** How far a stroke went, on average over its points: [dx, dy]. */
function went(before: PageInk, after: PageInk): [number, number] {
  let dx = 0;
  let dy = 0;
  const n = Math.floor(before.pts.length / 3);
  for (let i = 0; i < n; i++) {
    dx += after.pts[i * 3] - before.pts[i * 3];
    dy += after.pts[i * 3 + 1] - before.pts[i * 3 + 1];
  }
  return [dx / n, dy / n];
}
/** The furthest any point of `a` is from the same point of `b`. */
function furthest(a: readonly PageInk[], b: readonly PageInk[]): number {
  let most = 0;
  a.forEach((s, k) => {
    for (let i = 0; i + 1 < s.pts.length; i += 3) {
      most = Math.max(most, Math.hypot(s.pts[i] - b[k].pts[i], s.pts[i + 1] - b[k].pts[i + 1]));
    }
  });
  return most;
}
/** The least room between the ink of line `a` (above) and line `b` where one stands over the other. */
function room(strokes: readonly PageInk[], a: number, b: number): number {
  let least = Infinity;
  for (const u of inLine(strokes, a)) {
    for (const l of inLine(strokes, b)) {
      if (Math.min(right(u), right(l)) - Math.max(left(u), left(l)) <= 0) continue;
      least = Math.min(least, top(l) - bottom(u));
    }
  }
  return least;
}

/** The geometry alone: strokes keep their own shape exactly. */
const GEOMETRY = { strength: 1, strokes: false } as const;

describe("tidyInk", () => {
  it("changes nothing at strength 0, and nothing on no ink", () => {
    const strokes = page([{ x: 20, y: 100, slope: 0.06 }]);
    expect(tidyInk(strokes, { strength: 0 }).pts.size).toBe(0);
    expect(tidyInk([]).pts.size).toBe(0);
    expect(measureHand([])).toBeNull();
  });

  it("keeps every stroke's id, point count and pressure", () => {
    const strokes = page([{ x: 20, y: 100, slope: 0.06, wave: [5, 300] }]);
    const { pts } = tidyInk(strokes);
    expect(pts.size).toBeGreaterThan(0);
    for (const s of strokes) {
      const next = pts.get(s.id);
      if (!next) continue;
      expect(next.length).toBe(s.pts.length);
      for (let i = 2; i < next.length; i += 3) expect(next[i]).toBe(s.pts[i]);
    }
    expect([...pts.keys()].every((id) => strokes.some((s) => s.id === id))).toBe(true);
  });

  it("levels a line that climbs", () => {
    const strokes = page([{ x: 20, y: 200, slope: -0.06 }]);
    const result = tidyInk(strokes, GEOMETRY);
    expect(result.before.tilt).toBeGreaterThan(3);
    expect(result.after.tilt).toBeLessThan(0.3);
    expect(spread(feet(strokes))).toBeGreaterThan(H);
    expect(spread(feet(apply(strokes, result.pts)))).toBeLessThan(0.15 * H);
  });

  it("levels a line of stems and bars alone: a stroke's end is a letter's foot", () => {
    const strokes = page([{ x: 20, y: 200, slope: -0.06, hand: ["l", "t", "i", "l"] }]);
    const result = tidyInk(strokes, GEOMETRY);
    expect(result.before.lines).toBe(1);
    expect(spread(feet(apply(strokes, result.pts)))).toBeLessThan(0.15 * H);
  });

  it("leaves a line written at a steep angle as it is", () => {
    const strokes = page([{ x: 20, y: 300, slope: -0.3 }]);
    const result = tidyInk(strokes, GEOMETRY);
    expect(result.after.tilt).toBeCloseTo(result.before.tilt, 0);
  });

  it("straightens a baseline that wanders slowly", () => {
    const strokes = page([{ x: 20, y: 100, wave: [6, 500], words: 9 }]);
    const result = tidyInk(strokes, GEOMETRY);
    expect(result.before.baseline).toBeGreaterThan(0.07);
    expect(result.after.baseline).toBeLessThan(0.5 * result.before.baseline);
    expect(spread(feet(apply(strokes, result.pts)))).toBeLessThan(0.6 * spread(feet(strokes)));
  });

  it("leaves every gap between neighbouring strokes exactly as it was written", () => {
    const strokes = page([{ x: 20, y: 100, slope: 0.05, wave: [5, 400] }]);
    const tidied = apply(strokes, tidyInk(strokes, GEOMETRY).pts);
    for (let i = 1; i < strokes.length; i++) {
      const before = left(strokes[i]) - right(strokes[i - 1]);
      const after = left(tidied[i]) - right(tidied[i - 1]);
      expect(Math.abs(after - before)).toBeLessThan(0.03);
    }
  });

  it("leaves every stroke its own size and shape: nothing is scaled or sheared", () => {
    const strokes = page([{ x: 20, y: 100, slope: 0.05, wave: [5, 400], lean: 0.2 }]);
    const tidied = apply(strokes, tidyInk(strokes, GEOMETRY).pts);
    strokes.forEach((s, k) => {
      expect(right(tidied[k]) - left(tidied[k])).toBeCloseTo(right(s) - left(s), 1);
      // A stroke is as tall as it was, but for the little its line turned under it.
      expect(Math.abs(bottom(tidied[k]) - top(tidied[k]) - (bottom(s) - top(s)))).toBeLessThan(
        0.08 * H,
      );
    });
  });

  it("moves what stands together together: no dot, bar or letter parts from its neighbour", () => {
    const strokes = page([
      { x: 26, y: 100, slope: -0.05, wave: [5, 350] },
      { x: 20, y: 100 + PITCH, slope: 0.04 },
      { x: 23, y: 100 + 2 * PITCH + 14, wave: [4, 300] },
    ]);
    const tidied = apply(strokes, tidyInk(strokes, GEOMETRY).pts);
    for (let i = 1; i < strokes.length; i++) {
      if (lineOf.get(strokes[i].id) !== lineOf.get(strokes[i - 1].id)) continue;
      const a = went(strokes[i - 1], tidied[i - 1]);
      const b = went(strokes[i], tidied[i]);
      // A wander is taken out smoothly, so neighbours differ by a little; a torn stroke by much.
      expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(0.35 * H);
    }
  });

  it("sets lines that start at one margin exactly on it, and leaves an indented line indented", () => {
    const strokes = page([
      { x: 24, y: 100 },
      { x: 18, y: 100 + PITCH },
      { x: 21, y: 100 + 2 * PITCH },
      { x: 15, y: 100 + 3 * PITCH },
      { x: 70, y: 100 + 4 * PITCH },
    ]);
    const tidied = apply(strokes, tidyInk(strokes, GEOMETRY).pts);
    const starts = [0, 1, 2, 3, 4].map((k) => Math.min(...inLine(tidied, k).map(left)));
    expect(spread(starts.slice(0, 4))).toBeLessThan(1);
    expect(starts[4]).toBeCloseTo(70, 0);
  });

  it("a page can have two margins: a list's lines are set on theirs", () => {
    const text = [0, 2, 4, 6].map((k) => ({ x: 60 + (k % 4) - 2, y: 100 + k * PITCH }));
    const list = [1, 3, 5].map((k) => ({ x: 20 + (k % 3) * 2, y: 100 + k * PITCH }));
    const strokes = page([...text, ...list]);
    const tidied = apply(strokes, tidyInk(strokes, GEOMETRY).pts);
    const starts = [0, 1, 2, 3, 4, 5, 6].map((k) => Math.min(...inLine(tidied, k).map(left)));
    expect(spread(starts.slice(0, 4))).toBeLessThan(1);
    expect(spread(starts.slice(4))).toBeLessThan(1);
    expect(starts[0] - starts[4]).toBeGreaterThan(30);
  });

  it("sets evenly written lines at exactly one distance", () => {
    const ys = [100, 100 + PITCH + 4, 100 + 2 * PITCH - 3, 100 + 3 * PITCH + 3, 100 + 4 * PITCH];
    const strokes = page(ys.map((y) => ({ x: 20, y })));
    const result = tidyInk(strokes, GEOMETRY);
    expect(result.before.pitch).toBeGreaterThan(0.1);
    expect(result.after.pitch).toBeLessThan(0.5 * result.before.pitch);
  });

  it("sets baselines on the rules of ruled paper", () => {
    const strokes = page([
      { x: 20, y: 103 },
      { x: 20, y: 137 },
      { x: 20, y: 184 },
    ]);
    const tidied = apply(
      strokes,
      tidyInk(strokes, {
        ...GEOMETRY,
        rules: [{ x0: 0, x1: 600, pitch: 40, baselines: [20, 60, 100, 140, 180, 220] }],
      }).pts,
    );
    for (const k of [0, 1, 2]) {
      for (const y of feet(tidied, k)) expect(Math.abs((y % 40) - 20)).toBeLessThan(1.5);
    }
  });

  it("never brings two lines nearer than they were when that was near", () => {
    // The upper line falls to the right, so levelling it about its middle lowers its start
    // toward the line under it, which is written close.
    const strokes = page([
      { x: 20, y: 100, slope: -0.07 },
      { x: 20, y: 131 },
    ]);
    const before = room(strokes, 0, 1);
    const tidied = apply(strokes, tidyInk(strokes, GEOMETRY).pts);
    expect(room(tidied, 0, 1)).toBeGreaterThan(Math.min(before, 0.5 * H) - 0.2 * H);
  });

  it("the first word of a line stays with its line, under a line of taller writing", () => {
    const strokes = page([
      { x: 20, y: 100, size: 1.5, slope: -0.05 },
      { x: 26, y: 100 + PITCH },
      { x: 20, y: 100 + 2 * PITCH },
      { x: 20, y: 100 + 3 * PITCH },
    ]);
    const tidied = apply(strokes, tidyInk(strokes, GEOMETRY).pts);
    const second = inLine(strokes, 1);
    const moved = second.map((s) => went(s, tidied[strokes.indexOf(s)]));
    // Line two is level already: all of it goes to the margin, by one step.
    for (const m of moved) {
      expect(m[0]).toBeCloseTo(moved[moved.length - 1][0], 1);
      expect(Math.abs(m[1] - moved[moved.length - 1][1])).toBeLessThan(0.1 * H);
    }
  });

  it("leaves a table row alone: cells a column apart are not running text", () => {
    const strokes = page([{ x: 20, y: 100, slope: 0.05, words: 5, letters: 2, wordGap: 9 * H }]);
    expect(tidyInk(strokes, { strength: 1 }).pts.size).toBe(0);
  });

  it("leaves a line alone when a tall stroke runs through it", () => {
    const strokes = page([{ x: 20, y: 200, slope: 0.05 }]);
    const rule: PageInk = {
      id: "rule",
      tool: "pen",
      shape: null,
      t0: 1,
      pts: Array.from({ length: 40 }, (_, i) => [150, 120 + i * 5, 0.5]).flat(),
    };
    expect(tidyInk([...strokes, rule], { strength: 1 }).pts.size).toBe(0);
  });

  it("leaves a line with an equals sign alone: it is a formula", () => {
    const strokes = page([{ x: 20, y: 200, slope: 0.05, words: 3 }]);
    const end = Math.max(...strokes.map(right));
    const bar = (id: string, y: number): PageInk => ({
      id,
      tool: "pen",
      shape: null,
      t0: clock + 400,
      pts: Array.from({ length: 6 }, (_, i) => [end + 10 + i * 2, y, 0.5]).flat(),
    });
    const base = 200 + 0.05 * (end - 20);
    const sum = [...strokes, bar("upper", base - 8), bar("lower", base - 4)];
    expect(tidyInk(strokes, { strength: 1 }).pts.size).toBeGreaterThan(0);
    expect(tidyInk(sum, { strength: 1 }).pts.size).toBe(0);
  });

  it("an underline follows the line it lies under", () => {
    const strokes = page([{ x: 20, y: 200, slope: -0.06 }]);
    const end = Math.max(...strokes.map(right));
    const underline: PageInk = {
      id: "under",
      tool: "pen",
      shape: null,
      t0: clock + 500,
      pts: Array.from({ length: 30 }, (_, i) => {
        const x = 20 + (i / 29) * (end - 20);
        return [x, 208 - 0.06 * (x - 20), 0.5];
      }).flat(),
    };
    const { pts } = tidyInk([...strokes, underline], { strength: 1 });
    const moved = pts.get("under") as number[];
    expect(moved).toBeDefined();
    // It is levelled with its line: its two ends come out at one height.
    expect(Math.abs(underline.pts[1] - underline.pts[underline.pts.length - 2])).toBeGreaterThan(
      15,
    );
    expect(Math.abs(moved[1] - moved[moved.length - 2])).toBeLessThan(2.5);
    // And it is still just under the letters that stand on the line.
    const low = Math.max(...feet(apply(strokes, pts)));
    expect(moved[1] - low).toBeGreaterThan(0);
    expect(moved[1] - low).toBeLessThan(1.6 * H);
  });

  it("a comma added under a line goes with that line, not with the one written after it", () => {
    // Line A stands 8 px right of the margin the other lines share, so it is moved left.
    page([]);
    const a = line({ x: 28, y: 100 });
    const tail = Math.max(...a.map(right));
    clock -= 1500;
    const comma: PageInk = {
      id: "comma",
      tool: "pen",
      shape: null,
      t0: clock,
      pts: [tail + 6, 101, 0.5, tail + 5, 105, 0.5, tail + 3, 110, 0.5, tail + 1, 113, 0.5],
    };
    clock += 3000;
    const rest = [1, 2, 3].flatMap((k) => line({ x: 20, y: 100 + k * PITCH }));
    const strokes = [...a, comma, ...rest];
    const { pts } = tidyInk(strokes, GEOMETRY);
    const last = a[a.length - 1];
    const lineMove = (pts.get(last.id) as number[])[0] - last.pts[0];
    expect(lineMove).toBeLessThan(-5);
    expect((pts.get("comma") as number[])[0] - comma.pts[0]).toBeCloseTo(lineMove, 0);
  });

  it("tidying again moves next to nothing", () => {
    const strokes = page([
      { x: 24, y: 100, slope: 0.05, wave: [5, 400] },
      { x: 18, y: 100 + PITCH, slope: -0.03 },
      { x: 21, y: 100 + 2 * PITCH + 4 },
      { x: 20, y: 100 + 3 * PITCH - 3, wave: [4, 300] },
    ]);
    const once = apply(strokes, tidyInk(strokes, GEOMETRY).pts);
    expect(furthest(apply(once, tidyInk(once, GEOMETRY).pts), once)).toBeLessThan(0.06 * H);
    // With strokes smoothed too, a second go smooths a hair more and no further.
    const smooth = apply(strokes, tidyInk(strokes).pts);
    expect(furthest(apply(smooth, tidyInk(smooth).pts), smooth)).toBeLessThan(0.15 * H);
  });

  it("keeps a ragged point array's length and leaves its tail alone", () => {
    const strokes = page([{ x: 20, y: 100, slope: 0.06 }]);
    const ragged = { ...strokes[3], pts: [...Array.from(strokes[3].pts), 42] };
    const input = strokes.map((s, i) => (i === 3 ? ragged : s));
    const next = tidyInk(input, { strength: 1 }).pts.get(ragged.id) as number[];
    expect(next.length).toBe(ragged.pts.length);
    expect(next[next.length - 1]).toBe(42);
    expect(next.every((v) => Number.isFinite(v))).toBe(true);
  });

  it("is deterministic, and a part strength makes part of the change", () => {
    const strokes = page([{ x: 20, y: 100, slope: 0.06, wave: [5, 300] }]);
    expect([...tidyInk(strokes).pts]).toEqual([...tidyInk(strokes).pts]);
    expect(DEFAULT_STRENGTH).toBe(1);
    const first = strokes[0];
    const dy = (strength: number): number =>
      (tidyInk(strokes, { strength, strokes: false }).pts.get(first.id) as number[])[1] -
      first.pts[1];
    expect(Math.abs(dy(0.5))).toBeGreaterThan(1);
    expect(Math.abs(dy(0.5))).toBeLessThan(Math.abs(dy(1)));
    expect(tidyInk(strokes, { strength: 0.5 }).after.tilt).toBeLessThan(neatness(strokes).tilt);
  });
});

describe("tidyInk the user asked for (maxLevelSlope)", () => {
  const tan = (deg: number): number => Math.tan((deg * Math.PI) / 180);
  const all = (strokes: readonly PageInk[]): Set<string> => new Set(strokes.map((s) => s.id));
  const ASKED = { ...GEOMETRY, maxLevelSlope: ASKED_LEVEL_SLOPE } as const;

  it("levels a line climbing 16 degrees, which the default leaves as written", () => {
    // Joost's line on his iPad (2026-11-24) climbed 16 degrees and Tidy did nothing.
    const strokes = page([{ x: 20, y: 600, slope: -tan(16), wave: [3, 250] }]);
    const only = all(strokes);
    const auto = tidyInk(strokes, { ...GEOMETRY, only });
    expect(auto.after.tilt).toBeCloseTo(auto.before.tilt, 0);
    const asked = tidyInk(strokes, { ...ASKED, only });
    expect(asked.before.tilt).toBeGreaterThan(15);
    expect(asked.after.tilt).toBeLessThan(0.3);
    expect(spread(feet(strokes))).toBeGreaterThan(100);
    expect(spread(feet(apply(strokes, asked.pts)))).toBeLessThan(0.4 * H);
    expect(asked.seen).toBe(true);
  });

  it("finds a long climbing line in one piece: levelled, never turned into stairs", () => {
    // Followed along the page, a long line past 10 degrees came back in two
    // pieces, each set level on its own: a step in the middle of the line.
    for (const deg of [10, 20, 30]) {
      for (const lean of [0, 0.25]) {
        const strokes = page([{ x: 20, y: 600, slope: -tan(deg), lean, wave: [3, 250] }]);
        const result = tidyInk(strokes, { ...ASKED, only: all(strokes) });
        expect(result.before.lines).toBe(1);
        expect(spread(feet(apply(strokes, result.pts)))).toBeLessThan(0.4 * H);
      }
    }
  });

  it("leaves a line steeper than 30 degrees as written", () => {
    const strokes = page([{ x: 20, y: 600, slope: -tan(35) }]);
    const result = tidyInk(strokes, { ...ASKED, only: all(strokes) });
    expect(result.pts.size).toBe(0);
    expect(result.seen).toBe(false);
  });

  it("levels each line of a paragraph written at an angle", () => {
    const strokes = page([
      { x: 20, y: 300, slope: -tan(20), words: 3 },
      { x: 20 + PITCH * tan(20), y: 300 + PITCH, slope: -tan(20), words: 3 },
      { x: 20 + 2 * PITCH * tan(20), y: 300 + 2 * PITCH, slope: -tan(20), words: 3 },
    ]);
    const result = tidyInk(strokes, { ...ASKED, only: all(strokes) });
    const after = apply(strokes, result.pts);
    for (const k of [0, 1, 2]) {
      expect(spread(feet(strokes, k))).toBeGreaterThan(3 * H);
      expect(spread(feet(after, k))).toBeLessThan(0.4 * H);
    }
  });

  it("levels a steep line among level ones, and moves none of them", () => {
    const strokes = page([
      { x: 20, y: 100 },
      { x: 20, y: 330, slope: -tan(20), words: 3 },
      { x: 20, y: 400 },
    ]);
    const steep = inLine(strokes, 1);
    const result = tidyInk(strokes, { ...ASKED, only: all(steep) });
    expect([...result.pts.keys()].every((id) => lineOf.get(id) === 1)).toBe(true);
    const after = apply(strokes, result.pts);
    expect(spread(feet(after, 1))).toBeLessThan(0.4 * H);
    expect(room(after, 0, 1)).toBeGreaterThan(0);
    expect(room(after, 1, 2)).toBeGreaterThan(0);
  });

  it("a lone word moves nothing, and says so: nothing to see", () => {
    const strokes = page([{ x: 400, y: 300, words: 1, letters: 5 }]);
    const result = tidyInk(strokes, { only: all(strokes), maxLevelSlope: ASKED_LEVEL_SLOPE });
    expect(result.pts.size).toBe(0);
    expect(result.seen).toBe(false);
    expect(lineOfStroke(strokes, strokes[1].id, ASKED_LEVEL_SLOPE)).toBeNull();
  });

  it("ink already tidied is not seen to change again, even where strokes are smoothed", () => {
    const strokes = page([{ x: 20, y: 300, slope: -tan(8), wave: [4, 300] }]);
    const options = { only: all(strokes), maxLevelSlope: ASKED_LEVEL_SLOPE };
    const once = tidyInk(strokes, options);
    expect(once.seen).toBe(true);
    expect(tidyInk(apply(strokes, once.pts), options).seen).toBe(false);
  });

  it("a held word on a steep line gives the whole line", () => {
    const strokes = page([
      { x: 20, y: 100 },
      { x: 20, y: 400, slope: -tan(20), words: 4 },
    ]);
    const steep = inLine(strokes, 1);
    expect(lineOfStroke(strokes, steep[9].id, ASKED_LEVEL_SLOPE)?.sort()).toEqual(
      steep.map((s) => s.id).sort(),
    );
  });
});

describe("tidyInk inside strokes", () => {
  /** A line with one stroke put in its place: `make` gets the stroke it replaces. */
  function withStroke(at: number, make: (old: PageInk) => number[]): [PageInk[], string] {
    const strokes = page([{ x: 20, y: 100 }]);
    const old = strokes[at];
    return [strokes.map((s) => (s === old ? { ...old, pts: make(old) } : s)), old.id];
  }
  const roughness = (pts: ArrayLike<number>): number => {
    let sum = 0;
    for (let i = 3; i + 4 < pts.length; i += 3) {
      sum += Math.hypot(
        pts[i - 3] - 2 * pts[i] + pts[i + 3],
        pts[i - 2] - 2 * pts[i + 1] + pts[i + 4],
      );
    }
    return sum;
  };

  it("smooths the tremor of a stem and leaves its ends where they are", () => {
    // Stroke 1 is the stem of the first "l".
    const [strokes, id] = withStroke(1, (old) =>
      Array.from(old.pts).map((v, i) => (i % 3 === 0 ? v + (i % 2 ? 0.45 : -0.45) : v)),
    );
    const shaky = strokes.find((s) => s.id === id) as PageInk;
    const next = tidyInk(strokes).pts.get(id) as number[];
    expect(roughness(next)).toBeLessThan(0.6 * roughness(shaky.pts));
    expect(next[1]).toBeCloseTo(shaky.pts[1], 1);
    expect(next[next.length - 2]).toBeCloseTo(shaky.pts[shaky.pts.length - 2], 1);
  });

  it("never moves a point further than a small share of a letter, and keeps corners", () => {
    const strokes = page([{ x: 20, y: 100, slope: 0.04, wave: [4, 300] }]);
    const plain = apply(strokes, tidyInk(strokes, GEOMETRY).pts);
    const smooth = apply(strokes, tidyInk(strokes).pts);
    // All but the bars, which are drawn straight: nothing strays from where the geometry put it.
    const kept = strokes.flatMap((s, k) =>
      bottom(s) - top(s) > 0.5 * H ? [[plain[k], smooth[k]] as const] : [],
    );
    expect(
      furthest(
        kept.map((p) => p[0]),
        kept.map((p) => p[1]),
      ),
    ).toBeLessThan(0.1 * H);
    // The "w" turns sharply on the baseline: its feet are where they were.
    const w = strokes.findIndex((s) => standing.has(s.id));
    expect(bottom(smooth[w])).toBeCloseTo(bottom(plain[w]), 1);
  });

  it("draws a wobbly crossbar straight, and leaves a bow drawn on purpose", () => {
    const bar = (bow: number) => (old: PageInk) => {
      const n = Math.floor(old.pts.length / 3);
      return Array.from({ length: n }, (_, i) => [
        old.pts[0] + (i / (n - 1)) * W,
        old.pts[1] + bow * Math.sin((Math.PI * i) / (n - 1)),
        0.5,
      ]).flat();
    };
    // Stroke 7 is the crossbar of the first "t".
    const [wobbly, id] = withStroke(7, bar(0.8));
    const straight = tidyInk(wobbly).pts.get(id) as number[];
    for (let i = 1; i < straight.length; i += 3) expect(straight[i]).toBeCloseTo(straight[1], 1);
    const [bowed] = withStroke(7, bar(6));
    const kept = apply(bowed, tidyInk(bowed).pts).find((s) => s.id === id) as PageInk;
    expect(spread(Array.from(kept.pts).filter((_, i) => i % 3 === 1))).toBeGreaterThan(4);
  });

  it("leaves strokes as they are with `strokes: false`", () => {
    const strokes = page([
      { x: 20, y: 100 },
      { x: 20, y: 100 + PITCH },
      { x: 20, y: 100 + 2 * PITCH },
    ]);
    expect(tidyInk(strokes, GEOMETRY).pts.size).toBe(0);
  });
});

describe("measureHand", () => {
  it("measures the writer's lean, size, word gap and line spacing", () => {
    const strokes = page([0, 1, 2, 3].map((k) => ({ x: 20, y: 100 + k * PITCH, lean: 0.25 })));
    const hand = measureHand(strokes);
    expect(hand).not.toBeNull();
    expect(hand?.lines).toBe(4);
    expect(hand?.slant).toBeGreaterThan(0.15);
    expect(hand?.slant).toBeLessThan(0.35);
    expect(hand?.xHeight).toBeGreaterThan(0.7 * H);
    expect(hand?.xHeight).toBeLessThan(1.5 * H);
    expect((hand?.linePitch ?? 0) * (hand?.xHeight ?? 0)).toBeCloseTo(PITCH, 0);
  });

  it("an upright hand measures upright", () => {
    const strokes = page([0, 1, 2].map((k) => ({ x: 20, y: 100 + k * PITCH })));
    expect(Math.abs(measureHand(strokes)?.slant ?? 1)).toBeLessThan(0.06);
  });

  it("a leaning hand keeps its lean: tidying shears nothing", () => {
    const strokes = page([0, 1, 2].map((k) => ({ x: 20 + k, y: 100 + k * PITCH, lean: 0.25 })));
    const tidied = apply(strokes, tidyInk(strokes, { strength: 1 }).pts);
    expect(measureHand(tidied)?.slant).toBeCloseTo(measureHand(strokes)?.slant ?? 0, 1);
  });
});

describe("measureLines", () => {
  it("gives each line's baseline, x-height and strokes, top to bottom", () => {
    const strokes = page([
      { x: 20, y: 100 + PITCH, slope: -0.05 },
      { x: 30, y: 100 },
    ]);
    const lines = measureLines(strokes);
    expect(lines).toHaveLength(2);
    // Top to bottom, whatever the order of writing.
    expect(lines[0].x0).toBeCloseTo(30, 0);
    expect(Math.abs(lines[0].slope)).toBeLessThan(0.01);
    expect(lines[0].level).toBeGreaterThan(100 - 0.2 * H);
    expect(lines[0].level).toBeLessThan(100 + 0.2 * H);
    expect(lines[1].slope).toBeCloseTo(-0.05, 2);
    // The baseline passes under the feet of the line's letters.
    const at = (x: number): number => lines[1].slope * x + lines[1].level;
    for (const s of inLine(strokes, 0).filter((t) => standing.has(t.id))) {
      expect(Math.abs(bottom(s) - at((left(s) + right(s)) / 2))).toBeLessThan(0.3 * H);
    }
    expect(lines[1].xHeight).toBeGreaterThan(0.7 * H);
    expect(lines[1].xHeight).toBeLessThan(1.5 * H);
    expect(new Set(lines[1].strokes)).toEqual(new Set(inLine(strokes, 0).map((s) => s.id)));
  });

  it("holds no line for ink that is not running text", () => {
    expect(measureLines([])).toEqual([]);
    const cells = page([{ x: 20, y: 100, words: 5, letters: 2, wordGap: 9 * H }]);
    expect(measureLines(cells)).toEqual([]);
  });
});

describe("tidyInk with only", () => {
  it("tidies one line of a page that drifts, keeps it clear of its neighbours, and moves nothing else", () => {
    // Three lines written close, all drifting the same way: levelled alone, the middle one would run into the
    // line above (the reviewer's probe on 24 November measured -0.2 px of room at this slope).
    const strokes = page([
      { x: 20, y: 200, slope: 0.1, words: 6 },
      { x: 20, y: 240, slope: 0.1, words: 6 },
      { x: 20, y: 280, slope: 0.1, words: 6 },
    ]);
    const middle = new Set(inLine(strokes, 1).map((s) => s.id));
    // The bug this guards: given that line alone, Tidy levels it into the line above.
    const alone = tidyInk(inLine(strokes, 1), { strength: 1, profile: measureHand(strokes) });
    expect(room(apply(strokes, alone.pts), 0, 1)).toBeLessThan(0.2 * H);
    const { pts } = tidyInk(strokes, { strength: 1, only: middle });
    expect([...pts.keys()].every((id) => middle.has(id))).toBe(true);
    expect(pts.size).toBeGreaterThan(0);
    const after = apply(strokes, pts);
    expect(room(after, 0, 1)).toBeGreaterThan(0.2 * H);
    expect(room(after, 1, 2)).toBeGreaterThan(0.2 * H);
  });

  it("a highlight on the tidied line follows it, though it is not in the set", () => {
    const strokes = page([{ x: 20, y: 200, slope: -0.06 }]);
    const end = Math.max(...strokes.map(right));
    const highlight: PageInk = {
      id: "marker",
      tool: "highlighter",
      shape: null,
      t0: clock + 500,
      pts: Array.from({ length: 30 }, (_, i) => {
        const x = 20 + (i / 29) * (end - 20);
        return [x, 196 - 0.06 * (x - 20), 0.5];
      }).flat(),
    };
    const writing = new Set(strokes.map((s) => s.id));
    const { pts } = tidyInk([...strokes, highlight], { strength: 1, only: writing });
    const moved = pts.get("marker") as number[];
    expect(moved).toBeDefined();
    expect(Math.abs(moved[1] - moved[moved.length - 2])).toBeLessThan(2.5);
  });

  it("leaves everything alone when no stroke of the set is on a line", () => {
    const strokes = page([{ x: 20, y: 200, slope: -0.06 }]);
    expect(tidyInk(strokes, { strength: 1, only: new Set(["nowhere"]) }).pts.size).toBe(0);
  });
});

describe("lineOfStroke", () => {
  it("gives every stroke of the held word's line, and nothing of the other lines", () => {
    const strokes = page([
      { x: 20, y: 100, slope: 0.04 },
      { x: 20, y: 100 + PITCH },
    ]);
    const held = inLine(strokes, 1)[5];
    const ids = lineOfStroke(strokes, held.id);
    expect(new Set(ids)).toEqual(new Set(inLine(strokes, 1).map((s) => s.id)));
  });

  it("gives nothing for ink that is not running text, or a stroke that is not there", () => {
    const cells = page([{ x: 20, y: 100, words: 5, letters: 2, wordGap: 9 * H }]);
    expect(lineOfStroke(cells, cells[0].id)).toBeNull();
    expect(lineOfStroke(page([{ x: 20, y: 100 }]), "nowhere")).toBeNull();
  });
});
