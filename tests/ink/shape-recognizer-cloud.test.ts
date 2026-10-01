/**
 * Clouds, and the stars of the same recording (Joost, 2026-10-01): the
 * first real Pencil stars and clouds. The strokes were traced frame by frame
 * out of his screen recording (`fixtures/real-pencil-stars-clouds-ipad.json`)
 * and are rebuilt here as Pencil streams from every start, with tremor, a
 * pen-down hook and a closing overshoot, as the other real-ink tests do.
 *
 * The cloud gates were placed after printing their measures across every
 * class (CLAUDE.md): the "discriminators" block pins the separations, so a
 * retune that erodes one fails with the numbers in view.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cloudPoints } from "../../src/ink/shape-geometry";
import {
  explainShape,
  recognizeAtZoom,
  recognizeShape,
  recognizerInternals as R,
} from "../../src/ink/shape-recognizer";
import { dequantizePts, quantizePts } from "../../src/model/serialize";
import {
  type Pt,
  arc,
  handPentagram,
  handStar,
  pencilInk,
  rectangle,
  resample,
  rng,
  tremor,
} from "./ink-synth";

interface TracedStroke {
  id: number;
  expect: "star" | "cloud";
  desc: string;
  points: number[][];
}

const traced = (
  JSON.parse(readFileSync("tests/ink/fixtures/real-pencil-stars-clouds-ipad.json", "utf8")) as {
    strokes: TracedStroke[];
  }
).strokes;
const realStars = traced.filter((s) => s.expect === "star");
const realClouds = traced.filter((s) => s.expect === "cloud");

/** A traced loop as a Pencil stream: started at `startFraction`, overshooting its start, with tremor. */
function stream(stroke: TracedStroke, startFraction: number, seed: number): number[] {
  const loop: Pt[] = stroke.points.map(([x, y]) => ({ x, y }));
  const k = Math.floor(loop.length * startFraction);
  const rotated = loop.slice(k).concat(loop.slice(0, k));
  const overshoot = rotated.slice(0, Math.floor(rotated.length * 0.08));
  const rand = rng(seed);
  const drawn = tremor(resample([...rotated, rotated[0], ...overshoot], 1.4), rand, {
    amplitude: 1.1,
  });
  return drawn.flatMap((p) => [p.x, p.y, 0.45 + rand() * 0.2]);
}

const STARTS = [0, 0.2, 0.4, 0.6, 0.8];
const SEEDS = [1, 2, 3];

function xy(pts: readonly number[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i + 2 < pts.length; i += 3) out.push({ x: pts[i], y: pts[i + 1] });
  return out;
}

/**
 * A cloud as a hand draws it: `bumps` arcs of uneven size between cusps
 * jittered round an ellipse, a closing overshoot, a pen-down hook, tremor.
 */
function handCloud(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  bumps: number,
  seed: number,
  direction: 1 | -1 = 1,
): number[] {
  const rand = rng(seed * 31 + 7);
  const step = (2 * Math.PI) / bumps;
  const cusps: Pt[] = [];
  for (let i = 0; i < bumps; i++) {
    const a = direction * (i * step + (rand() - 0.5) * 0.5 * step);
    const r = 1 + (rand() - 0.5) * 0.16;
    cusps.push({ x: cx + rx * r * Math.cos(a), y: cy + ry * r * Math.sin(a) });
  }
  const path: Pt[] = [];
  for (let i = 0; i < bumps; i++) {
    const p = cusps[i];
    const q = cusps[(i + 1) % bumps];
    const chord = Math.hypot(q.x - p.x, q.y - p.y);
    const mx = (p.x + q.x) / 2;
    const my = (p.y + q.y) / 2;
    const ml = Math.hypot(mx - cx, my - cy);
    const nx = (mx - cx) / ml;
    const ny = (my - cy) / ml;
    // Real clouds dip 5–14 % of their diagonal between bumps: tall bumps.
    const bulge = (0.5 + rand() * 0.25) * chord;
    for (let k = 0; k < 16; k++) {
      const t = k / 16;
      const lift = 4 * bulge * t * (1 - t);
      path.push({ x: p.x + (q.x - p.x) * t + nx * lift, y: p.y + (q.y - p.y) * t + ny * lift });
    }
  }
  const overshoot = path.slice(0, Math.floor(path.length * 0.08));
  return pencilInk([...path, path[0], ...overshoot], seed, { hook: 6 + rand() * 6 });
}

describe("real Pencil clouds (Joost's recording, 2026-10-01)", () => {
  it.each(realClouds.map((s) => [s.desc, s] as const))(
    "recognises %s from every start, at every seed",
    (_desc, stroke) => {
      for (const start of STARTS) {
        for (const seed of SEEDS) {
          const result = recognizeShape(stream(stroke, start, seed));
          expect(result?.kind, `start ${start} seed ${seed}`).toBe("cloud");
        }
      }
    },
  );

  it("recognises them drawn at 4x zoom, a quarter the size on the page", () => {
    for (const stroke of realClouds) {
      const shrunk = stream(stroke, 0, 1).map((v, i) => (i % 3 === 2 ? v : v / 4));
      expect(recognizeAtZoom(shrunk, 4)?.kind).toBe("cloud");
    }
  });
});

describe("real Pencil stars (the same recording)", () => {
  it.each(realStars.map((s) => [s.desc, s] as const))(
    "snaps %s, drawn as a pentagram, to a star outline from every start",
    (_desc, stroke) => {
      // Before 2026-10-01 four of these five scored 0.56–0.70 (synthetic
      // stars had set the error scale) and only one cleared the 0.65 snap,
      // as in the recording; one of them was never tried as a pentagram,
      // because a gentle bend in one line read as a sixth corner.
      for (const start of STARTS) {
        for (const seed of SEEDS) {
          const result = recognizeShape(stream(stroke, start, seed));
          expect(result?.kind, `start ${start} seed ${seed}`).toBe("star");
          expect(result!.pts).toHaveLength(11 * 3);
        }
      }
    },
  );
});

describe("hand-drawn clouds", () => {
  const cases: Array<[string, number[]]> = [];
  for (const bumps of [6, 7, 8, 10, 12]) {
    for (const seed of [1, 2, 3]) {
      cases.push([`${bumps} bumps, seed ${seed}`, handCloud(300, 300, 150, 90, bumps, seed)]);
    }
  }
  cases.push(["a round cloud", handCloud(300, 300, 110, 105, 8, 4)]);
  cases.push(["a tall cloud", handCloud(300, 300, 70, 140, 8, 5)]);
  cases.push(["a small cloud", handCloud(300, 300, 45, 30, 7, 6)]);
  cases.push(["a cloud drawn the other way round", handCloud(300, 300, 150, 90, 8, 7, -1)]);

  it.each(cases)("recognises %s", (_name, pts) => {
    expect(recognizeShape(pts)?.kind).toBe("cloud");
  });
});

describe("what is never a cloud", () => {
  const rand = rng(9);
  const ink = (p: Pt[]): number[] =>
    tremor(resample(p, 1.4), rand, { amplitude: 1.1 }).flatMap((q) => [q.x, q.y, 0.5]);
  const flower = (petals: number, depth: number): Pt[] =>
    Array.from({ length: 401 }, (_, i) => {
      const a = (i / 400) * 2 * Math.PI;
      const r = 150 * (1 - depth * (0.5 - 0.5 * Math.cos(petals * a)));
      return { x: 300 + r * Math.cos(a), y: 300 + r * Math.sin(a) };
    });
  const nStar = (n: number, inner: number): Pt[] =>
    Array.from({ length: 2 * n + 1 }, (_, i) => {
      const r = i % 2 === 0 ? 150 : inner;
      const a = -Math.PI / 2 + (i * Math.PI) / n;
      return { x: 300 + r * Math.cos(a), y: 300 + r * Math.sin(a) };
    });

  it.each([
    ["a circle", ink(arc(300, 300, 140, 140))],
    ["a rectangle", ink(rectangle(100, 100, 300, 180))],
    ["a star outline", pencilInk(handStar(300, 300, 120, {}, 3), 3)],
    ["a pentagram", pencilInk(handPentagram(300, 300, 120, {}, 3), 3)],
    ["a five-petal flower", ink(flower(5, 0.3))],
    ["an eight-petal shallow flower", ink(flower(8, 0.2))],
    ["a six-point star", ink(nStar(6, 80))],
    ["a seven-point star", ink(nStar(7, 70))],
    ["a fat eight-point star", ink(nStar(8, 110))],
  ] as Array<[string, number[]]>)("does not take %s", (_name, pts) => {
    expect(explainShape(pts).candidates.map((c) => c.kind)).not.toContain("cloud");
  });

  it("never reads a real Pencil stroke of another shape as a cloud, from any start", () => {
    for (const file of ["real-pencil-ipad", "real-pencil-ipad-2"]) {
      const strokes = (
        JSON.parse(readFileSync(`tests/ink/fixtures/${file}.json`, "utf8")) as {
          strokes: Array<{ closed: boolean; points: number[][] }>;
        }
      ).strokes.filter((s) => s.closed);
      for (const s of strokes) {
        for (const start of STARTS) {
          const pts = stream({ id: 0, expect: "cloud", desc: "", points: s.points }, start, 1);
          expect(explainShape(pts).candidates.map((c) => c.kind)).not.toContain("cloud");
        }
      }
    }
    for (const stroke of realStars) {
      expect(explainShape(stream(stroke, 0, 1)).candidates.map((c) => c.kind)).not.toContain(
        "cloud",
      );
    }
  });
});

describe("cloud discriminators (printed before the gates were set)", () => {
  /** Dents of 3 %+, and the median turn of the bump tops before them across 0.8 % of the perimeter. */
  function measure(pts: readonly Pt[]): { dents: number; deep: number; top: number } {
    const diag = R.diagonalOf(R.boundsOf(pts));
    const dents = R.hullDents(pts, diag).filter((d: { depth: number }) => d.depth >= 0.03);
    const window = 0.008 * R.pathLength(pts);
    const tops = dents
      .map((d: { top: number }) => R.sharpnessAt(pts, d.top, window))
      .sort((a: number, b: number) => a - b);
    return {
      dents: dents.length,
      deep: dents.filter((d: { depth: number }) => d.depth >= 0.05).length,
      top: tops.length ? tops[Math.floor(tops.length / 2)] : 0,
    };
  }
  const plain = (s: TracedStroke): Pt[] =>
    resample(
      s.points.map(([x, y]) => ({ x, y })),
      1.4,
    );

  it("real clouds dip six times or more, and their bumps are round", () => {
    for (const s of realClouds) {
      const m = measure(plain(s));
      expect(m.dents, s.desc).toBeGreaterThanOrEqual(6);
      expect(m.deep, s.desc).toBeGreaterThanOrEqual(5);
      expect(m.top, s.desc).toBeLessThanOrEqual(65);
    }
  });

  it("real stars dip five times, at sharp tips", () => {
    for (const s of realStars) {
      const m = measure(plain(s));
      expect(m.dents, s.desc).toBe(5);
      expect(m.top, s.desc).toBeGreaterThanOrEqual(90);
    }
  });
});

describe("emitted cloud geometry", () => {
  const drawn = handCloud(300, 260, 160, 90, 8, 11);
  const cloud = recognizeShape(drawn)!;

  it("fills the box it was drawn in, as one closed outline", () => {
    expect(cloud.kind).toBe("cloud");
    const p = xy(cloud.pts);
    expect(p[p.length - 1].x).toBeCloseTo(p[0].x, 1);
    expect(p[p.length - 1].y).toBeCloseTo(p[0].y, 1);
    const box = R.boundsOf(p);
    const ink = R.boundsOf(xy(drawn));
    // The drawn box, give or take the pen-down hook.
    expect(Math.abs(box.minX - ink.minX)).toBeLessThan(14);
    expect(Math.abs(box.maxX - ink.maxX)).toBeLessThan(14);
    expect(Math.abs(box.minY - ink.minY)).toBeLessThan(14);
    expect(Math.abs(box.maxY - ink.maxY)).toBeLessThan(14);
  });

  it("has as many bumps as it was drawn with", () => {
    const p = xy(cloud.pts).slice(0, -1);
    const diag = R.diagonalOf(R.boundsOf(p));
    expect(R.hullDents(p, diag).filter((d: { depth: number }) => d.depth >= 0.03)).toHaveLength(8);
  });

  it("starts near pen-down and keeps the drawn winding", () => {
    for (const direction of [1, -1] as const) {
      const pts = handCloud(300, 260, 160, 90, 8, 12, direction);
      const result = recognizeShape(pts)!;
      const p = xy(result.pts);
      // The cusp nearest the pen-down point, at most half a bump away.
      expect(Math.hypot(p[0].x - pts[0], p[0].y - pts[1])).toBeLessThan(90);
      const area = (q: Pt[]): number =>
        q.reduce((s, a, i) => s + a.x * q[(i + 1) % q.length].y - q[(i + 1) % q.length].x * a.y, 0);
      expect(Math.sign(area(p))).toBe(Math.sign(area(xy(pts))));
    }
  });

  it("uses one constant pressure and survives serialize.ts quantization bit-for-bit", () => {
    expect(new Set(cloud.pts.filter((_, i) => i % 3 === 2)).size).toBe(1);
    expect(dequantizePts(quantizePts(cloud.pts))).toEqual(cloud.pts);
  });

  it("re-recognises its own output as the same cloud", () => {
    let current = cloud.pts;
    for (let pass = 1; pass <= 4; pass++) {
      const next = recognizeShape(current)!;
      expect(next.kind).toBe("cloud");
      expect(next.pts).toHaveLength(cloud.pts.length);
      for (let i = 0; i < current.length; i++) {
        expect(Math.abs(next.pts[i] - cloud.pts[i])).toBeLessThanOrEqual(0.0201);
      }
      current = next.pts;
    }
  });

  it("cloudPoints stretches any bump count to its box exactly", () => {
    for (const bumps of [3, 6, 12]) {
      const p = cloudPoints(10, 20, 200, 100, bumps);
      const box = R.boundsOf(p);
      expect(box.minX).toBeCloseTo(10, 6);
      expect(box.maxX).toBeCloseTo(210, 6);
      expect(box.minY).toBeCloseTo(20, 6);
      expect(box.maxY).toBeCloseTo(120, 6);
      expect(p).toHaveLength(bumps * 10 + 1);
    }
  });
});
