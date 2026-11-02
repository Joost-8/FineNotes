/**
 * Stroke stabilization (FineNotes discussion #30): a per-pen setting that
 * widens the centred window to a reach along the stroke
 * (`StrokeBuilderOptions.stabilize`, from `stabilizationReach`). Ink must
 * still only grow, the stroke must still start and end where the pen did,
 * and the low settings people use must steady a wobble without taking the
 * corners off real ink.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MAX_CENTRED_HALF,
  STABILIZE_MAX_PX,
  StrokeBuilder,
  type StrokeBuilderOptions,
  stabilizationReach,
} from "../../src/ink/stroke-builder";
import { recognizeShape } from "../../src/ink/shape-recognizer";
import { detectScribble } from "../../src/ink/scribble";
import { type Pt, resample, rng } from "./ink-synth";

type Sample = { x: number; y: number; pressure: number };

const STRENGTHS = [0, 0.01, 0.05, 0.1, 0.2, 0.5, 1];

/**
 * A shaky hand: the wobble of an unsteady hand is short (a 9-26 px
 * wavelength along the stroke, under a px each), unlike the slow drift
 * `ink-synth`'s tremor models; plus sub-px digitizer noise.
 */
function shaky(points: readonly Pt[], seed: number, amp = 0.8): Sample[] {
  const rand = rng(seed);
  const waves = [9, 15, 26];
  const amps = [amp, amp * 0.7, amp * 0.5];
  const phases = waves.map(() => rand() * 2 * Math.PI);
  let along = 0;
  return points.map((p, i) => {
    if (i > 0) along += Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y);
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const [tx, ty] = [(b.x - a.x) / len, (b.y - a.y) / len];
    let off = 0;
    for (let k = 0; k < 3; k++)
      off += amps[k] * Math.sin((2 * Math.PI * along) / waves[k] + phases[k]);
    return {
      x: p.x - ty * off + (rand() - 0.5) * 0.7,
      y: p.y + tx * off + (rand() - 0.5) * 0.7,
      pressure: 0.3 + rand() * 0.2,
    };
  });
}

/** Cursive loops ("lllll"), radius `r`, moving on `advance` px a loop. */
function loops(n: number, r: number, advance: number): Pt[] {
  const out: Pt[] = [];
  const steps = 400 * n;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * n * 2 * Math.PI;
    out.push({
      x: 50 + (advance * t) / (2 * Math.PI) + r * Math.sin(t),
      y: 100 - r + r * Math.cos(t),
    });
  }
  return out;
}

/** A circle of radius `r` about (100, 100), drawn `turns` times round. */
function circle(r: number, turns = 3): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= 720 * turns; i++) {
    const t = (i / 720) * 2 * Math.PI;
    out.push({ x: 100 + r * Math.cos(t), y: 100 + r * Math.sin(t) });
  }
  return out;
}

const asSamples = (pts: readonly Pt[]): Sample[] => pts.map((p) => ({ ...p, pressure: 0.4 }));

function triples(flat: readonly number[]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i + 2 < flat.length; i += 3) out.push([flat[i], flat[i + 1], flat[i + 2]]);
  return out;
}

function flatOf(samples: readonly Sample[]): number[] {
  return samples.flatMap((s) => [s.x, s.y, s.pressure]);
}

function samplesOf(flat: readonly number[]): Sample[] {
  return triples(flat).map(([x, y, pressure]) => ({ x, y, pressure }));
}

/** What the builder stores for `samples` at `strength`, the last one the pen-up. */
function build(
  samples: readonly Sample[],
  strength: number,
  options: Partial<StrokeBuilderOptions> = {},
): number[] {
  const b = new StrokeBuilder({
    minDistance: 1.4,
    stabilize: stabilizationReach(strength),
    ...options,
  });
  for (const s of samples.slice(0, -1)) b.add(s);
  b.addFinal(samples[samples.length - 1]);
  return b.points();
}

/** How much the heading changes from one point to the next, degrees, summed. */
function turning(flat: readonly number[]): number {
  const pts = triples(flat);
  let total = 0;
  for (let i = 2; i < pts.length; i++) {
    const a = Math.atan2(pts[i - 1][1] - pts[i - 2][1], pts[i - 1][0] - pts[i - 2][0]);
    const b = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]);
    let d = b - a;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    total += Math.abs(d);
  }
  return (total * 180) / Math.PI;
}

describe("stabilizationReach", () => {
  it("is none at 0 and below, and for anything not a number", () => {
    expect(stabilizationReach(0)).toBe(0);
    expect(stabilizationReach(-0.5)).toBe(0);
    expect(stabilizationReach(Number.NaN)).toBe(0);
  });

  it("rises with the strength, to STABILIZE_MAX_PX at 100% and no further", () => {
    for (let i = 1; i < STRENGTHS.length; i++) {
      expect(stabilizationReach(STRENGTHS[i])).toBeGreaterThan(
        stabilizationReach(STRENGTHS[i - 1]),
      );
    }
    expect(stabilizationReach(1)).toBe(STABILIZE_MAX_PX);
    expect(stabilizationReach(3)).toBe(STABILIZE_MAX_PX);
  });

  it("spends most of its range on the low settings people use", () => {
    // Goodnotes users report 5-10% for a ball pen, ~20% for cursive.
    expect(stabilizationReach(0.3)).toBeGreaterThan(STABILIZE_MAX_PX / 2);
  });
});

describe("StrokeBuilder stabilization", () => {
  const wobbly = shaky(resample(loops(4, 7, 9), 1.45), 1);

  it("at 0 is off, to the last bit", () => {
    for (const densify of [false, true]) {
      for (const smoothing of ["off", "centred"] as const) {
        const plain = build(wobbly, 0, { densify, smoothing, stabilize: undefined });
        expect(build(wobbly, 0, { densify, smoothing })).toEqual(plain);
      }
    }
    // Nothing but the spacing rule: every sample offered is kept as it came.
    expect(build(wobbly, 0, { minDistance: 0 })).toEqual(flatOf(wobbly));
  });

  it("only ever appends, at every strength: what is kept never moves", () => {
    for (const strength of STRENGTHS) {
      for (const densify of [false, true]) {
        for (const smoothing of ["off", "centred"] as const) {
          const b = new StrokeBuilder({
            minDistance: 1.4,
            stabilize: stabilizationReach(strength),
            densify,
            smoothing,
          });
          let before: number[] = [];
          for (const s of wobbly) {
            b.add(s);
            const now = [...b.view];
            expect(now.slice(0, before.length)).toEqual(before);
            before = now;
          }
          const last = wobbly[wobbly.length - 1];
          b.addFinal({ ...last, x: last.x + 0.3 });
          expect([...b.view].slice(0, before.length)).toEqual(before);
        }
      }
    }
  });

  it("starts where the pen touched and ends exactly where it lifted", () => {
    for (const strength of STRENGTHS) {
      for (const densify of [false, true]) {
        const pts = triples(build(wobbly, strength, { densify }));
        const [first, last] = [wobbly[0], wobbly[wobbly.length - 1]];
        expect(pts[0].slice(0, 2)).toEqual([first.x, first.y]);
        expect(pts[pts.length - 1].slice(0, 2)).toEqual([last.x, last.y]);
      }
    }
  });

  it("keeps the pen's pressure: only positions are steadied", () => {
    const pts = triples(build(wobbly, 0.5, { minDistance: 0 }));
    expect(pts.map((p) => p[2])).toEqual(wobbly.map((s) => s.pressure));
  });

  it("a whole-px pen keeps its own window when the setting asks for less", () => {
    // Today's automatic CENTRED_HALF samples, 1.45 px apart, reach ~4.4 px.
    const centred = build(wobbly, 0, { smoothing: "centred" });
    expect(build(wobbly, 0.01, { smoothing: "centred" })).toEqual(centred);
    // Asking for more takes the wider window.
    expect(build(wobbly, 0.5, { smoothing: "centred" })).toEqual(build(wobbly, 0.5));
  });

  it("holds back about the reach as the tail, and no more than MAX_CENTRED_HALF samples", () => {
    for (const strength of [0.05, 0.2, 1]) {
      const reach = stabilizationReach(strength);
      const b = new StrokeBuilder({ minDistance: 1.4, stabilize: reach });
      for (const s of wobbly.slice(0, 200)) b.add(s);
      const tail = [triples(b.view).at(-1)!, ...b.tail];
      let along = 0;
      for (let i = 1; i < tail.length; i++) {
        along += Math.hypot(tail[i][0] - tail[i - 1][0], tail[i][1] - tail[i - 1][1]);
      }
      expect(along).toBeGreaterThanOrEqual(reach);
      // One sample step past the reach, at most, plus the wobble's own
      // detour, which grows with the reach.
      expect(along).toBeLessThan(reach * 1.1 + 3);
    }
    const dense = new StrokeBuilder({ minDistance: 0.01, stabilize: STABILIZE_MAX_PX });
    for (let i = 0; i < 400; i++) dense.add({ x: i * 0.05, y: 0, pressure: 0.4 });
    expect(dense.tail.length).toBe(MAX_CENTRED_HALF);
  });

  it("is felt across the slider on a Pencil's longer wobble, which 10 px could not reach (#107)", () => {
    // A straight line with a wobble `wave` px long along it, sampled as a
    // Pencil sends it (240 Hz at 150 px/s): how much of the wobble is left.
    const left = (strength: number, wave: number): number => {
      const samples: Sample[] = [];
      for (let x = 0; x <= 300; x += 150 / 240) {
        samples.push({ x, y: 100 + 1.5 * Math.sin((2 * Math.PI * x) / wave), pressure: 0.4 });
      }
      const middle = triples(build(samples, strength)).filter(([x]) => x > 40 && x < 260);
      const rms = Math.sqrt(middle.reduce((sum, [, y]) => sum + (y - 100) ** 2, 0) / middle.length);
      return rms / (1.5 / Math.SQRT2);
    };
    expect(left(0.1, 12)).toBeLessThan(0.5);
    expect(left(0.5, 25)).toBeLessThan(0.6);
    expect(left(1, 25)).toBeLessThan(0.1);
  });

  it("steadies a shaky hand already at 5%, and more as it rises", () => {
    const clean = turning(flatOf(asSamples(resample(loops(4, 7, 9), 1.45))));
    const excess = (strength: number): number => {
      let sum = 0;
      for (let seed = 1; seed <= 6; seed++) {
        sum += turning(build(shaky(resample(loops(4, 7, 9), 1.45), seed), strength)) - clean;
      }
      return sum / 6;
    };
    const raw = excess(0);
    expect(excess(0.05)).toBeLessThan(raw * 0.4);
    expect(excess(0.2)).toBeLessThan(raw * 0.15);
    expect(excess(0.2)).toBeLessThan(excess(0.05));
  });

  it("keeps a small loop's size at the low settings", () => {
    // A 4 px loop is a small "e" at fit zoom. Higher up, loops under ~6 px
    // round off: the price of steadying a Pencil's longer wobble (#107).
    for (const [r, strength, most] of [
      [4, 0.05, 0.03],
      [8, 0.25, 0.03],
      [10, 1, 0.07],
      [20, 1, 0.01],
    ] as const) {
      const pts = triples(build(asSamples(resample(circle(r), 1.45)), strength));
      const middle = pts.slice(pts.length / 3, (pts.length * 2) / 3);
      const mean =
        middle.reduce((sum, [x, y]) => sum + Math.hypot(x - 100, y - 100), 0) / middle.length;
      expect(1 - mean / r, `r ${r} at ${strength}`).toBeLessThan(most);
    }
  });

  describe("real ink keeps its corners at the low settings", () => {
    interface RealStroke {
      id: number;
      expect: string;
      points: number[][];
    }
    const strokesOf = (file: string): RealStroke[] =>
      (JSON.parse(readFileSync(`tests/ink/fixtures/${file}`, "utf8")) as { strokes: RealStroke[] })
        .strokes;
    const real = [...strokesOf("real-pencil-ipad.json"), ...strokesOf("real-pencil-ipad-2.json")];
    // Traced from frames, so a point every few px: spaced as a Pencil's would be.
    const stream = (s: RealStroke): Sample[] =>
      asSamples(
        resample(
          s.points.map(([x, y]) => ({ x, y })),
          1.45,
        ),
      );

    const round = new Set(["circle", "ellipse", "none"]);

    it.each(real.map((s) => [`${s.id} (${s.expect})`, s] as const))(
      "stroke %s keeps its corners up to 20%",
      (_name, stroke) => {
        const plain = recognizeShape(build(stream(stroke), 0))?.kind ?? "none";
        for (const strength of [0.05, 0.1, 0.2]) {
          const kind = recognizeShape(build(stream(stroke), strength))?.kind ?? "none";
          // A shape with corners stays that shape. A round or unrecognised
          // one may come out rounder (the lumpy circle, 20, becomes a
          // circle), never with corners it did not have, unless steadied
          // into the shape it was drawn as (the rough rect, 21).
          if (round.has(plain)) {
            expect(round.has(kind) || kind === stroke.expect, `${kind} at ${strength}`).toBe(true);
          } else expect(kind, `at ${strength}`).toBe(plain);
        }
      },
    );

    it("scribbles to erase are still scribbles up to 20%, but for one on the gate", () => {
      const scribbles = (
        JSON.parse(readFileSync("tests/ink/fixtures/real-scribbles-ipad.json", "utf8")) as {
          strokes: { pts: number[] }[];
        }
      ).strokes;
      const missed = (strength: number): number[] =>
        scribbles.flatMap(({ pts }, i) =>
          detectScribble(build(samplesOf(pts), strength), { minSize: 9 }) ? [] : [i],
        );
      expect(missed(0.05)).toEqual([]);
      // Each strength misses at most the one scribble sitting on a gate:
      // stroke 7 at 20%.
      expect(missed(0.1)).toEqual([]);
      expect(missed(0.2)).toEqual([7]);
    });
  });
});
