/**
 * Stars and Apple Notes' retrace arrow (2026-09-22), for
 * `src/ink/shape-recognizer.ts`.
 *
 * Neither has been seen in real Pencil ink yet. The synthetic ink here models
 * what the iPad recordings showed of real strokes in general — 1.4 px
 * samples, low-frequency tremor, a pen-down hook, a closing overshoot, tips
 * the pen rounds — and every gate was placed after printing its discriminator
 * across every class (CLAUDE.md). The separations those gates rely on are
 * pinned in the "discriminators" blocks, so a retune that erodes one fails
 * here with the numbers in view.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SNAP_MIN_CONFIDENCE } from "../../src/constants";
import {
  explainShape,
  recognizeShape,
  recognizerInternals as R,
} from "../../src/ink/shape-recognizer";
import { dequantizePts, quantizePts } from "../../src/model/serialize";
import {
  type Pt,
  type StarStyle,
  arc,
  arrowOutline,
  handPentagram,
  handStar,
  inkFrom,
  pencilInk,
  polyline,
  rectangle,
  regularPolygon,
  resample,
  retracedLine,
  rng,
  roundedRectish,
  tremor,
} from "./ink-synth";

// --- Shapes a star fitter must never take --------------------------------

function nPointStar(cx: number, cy: number, outer: number, inner: number, n: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= 2 * n; i++) {
    const a = ((-90 + (180 * i) / n) * Math.PI) / 180;
    const r = i % 2 === 0 ? outer : inner;
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return out;
}

/** {n/step}: a star polygon drawn in one stroke, e.g. a heptagram {7/3}. */
function polygram(cx: number, cy: number, r: number, n: number, step: number): Pt[] {
  const out: Pt[] = [];
  for (let k = 0; k <= n; k++) {
    const a = ((-90 + (360 * step * k) / n) * Math.PI) / 180;
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return out;
}

/** Five round petals: the star's alternating structure, with curved edges. */
function flower(cx: number, cy: number, r: number, depth: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= 400; i++) {
    const t = (i / 400) * 2 * Math.PI;
    const rad = r * (1 - depth + depth * Math.cos(5 * t));
    out.push({ x: cx + rad * Math.cos(t - Math.PI / 2), y: cy + rad * Math.sin(t - Math.PI / 2) });
  }
  return out;
}

function twice(poly: Pt[]): Pt[] {
  return [...poly, ...poly.slice(1)];
}

const notStars: Array<[string, number[]]> = [
  ["a decagon", inkFrom(regularPolygon(300, 300, 160, 10), 14)],
  ["a four-point sparkle", inkFrom(nPointStar(300, 300, 150, 45, 4), 15)],
  ["a six-point star", inkFrom(nPointStar(300, 300, 150, 80, 6), 16)],
  ["a seven-point star", inkFrom(nPointStar(300, 300, 150, 70, 7), 17)],
  ["a heptagram {7/3}", inkFrom(polygram(300, 300, 150, 7, 3), 18)],
  ["a heptagram {7/2}", inkFrom(polygram(300, 300, 150, 7, 2), 19)],
  ["a five-petal flower", inkFrom(flower(300, 300, 150, 0.3), 20)],
  ["a deep five-petal flower", inkFrom(flower(300, 300, 150, 0.45), 21)],
  ["a shallow five-petal flower", inkFrom(flower(300, 300, 150, 0.2), 34)],
  ["a pentagon drawn twice", inkFrom(twice(regularPolygon(300, 300, 150, 5)), 22)],
  ["a triangle drawn twice", inkFrom(twice(regularPolygon(300, 300, 150, 3)), 23)],
  ["a circle drawn twice", inkFrom(twice(arc(300, 300, 140, 140)), 24)],
  [
    "a crown",
    inkFrom(
      polyline(100, 400, 100, 200, 180, 300, 250, 150, 320, 300, 400, 200, 400, 400, 100, 400),
      28,
    ),
  ],
  ["a house", inkFrom(polyline(100, 400, 100, 220, 250, 100, 400, 220, 400, 400, 100, 400), 29)],
  [
    "a five-point star missing a tip",
    inkFrom(
      [...nPointStar(300, 300, 150, 60, 5).slice(0, 8), nPointStar(300, 300, 150, 60, 5)[0]],
      30,
    ),
  ],
  [
    "a sawtooth loop",
    inkFrom(
      polyline(
        100,
        300,
        150,
        200,
        200,
        300,
        250,
        200,
        300,
        300,
        350,
        200,
        400,
        300,
        400,
        400,
        100,
        400,
        100,
        300,
      ),
      32,
    ),
  ],
];

// --- Hand-drawn stars ---------------------------------------------------------

/**
 * Outline stars across the ranges a hand produces: thin to fat (notch ratio
 * 0.38–0.55), level and tilted, neat (±4 % tips, ±2°) and sloppy (±12 %,
 * ±7°, rounded tips), both windings, started on a tip or a notch, 60–220 px,
 * each with a pen-down hook and an overshoot past the start.
 */
function outlineStars(): Array<[string, number[]]> {
  const out: Array<[string, number[]]> = [];
  let seed = 1;
  for (const ratio of [0.38, 0.45, 0.55]) {
    for (const rot of [-90, -70, -54, -18]) {
      for (const sloppy of [false, true]) {
        for (const direction of [1, -1] as const) {
          const size = 60 + (seed % 5) * 40;
          const style: StarStyle = {
            ratio,
            rotDeg: rot,
            radiusJitter: sloppy ? 0.12 : 0.04,
            angleJitter: sloppy ? 7 : 2,
            start: seed % 3 === 0 ? 1 : 0,
            direction,
            round: sloppy ? 4 : 1.5,
            overshoot: 0.1 + (seed % 3) * 0.03,
          };
          const name = `ratio ${ratio}, tip at ${rot}°, ${sloppy ? "sloppy" : "neat"}, R ${size}, turning ${direction}`;
          out.push([
            name,
            pencilInk(handStar(300, 300, size, style, seed), seed, { hook: 6 + (seed % 5) * 3 }),
          ]);
          seed++;
        }
      }
    }
  }
  return out;
}

/** One-stroke pentagrams, the same way: 45–260 px, both ways round, any start tip. */
function pentagrams(): Array<[string, number[]]> {
  const out: Array<[string, number[]]> = [];
  let seed = 101;
  for (const rot of [-90, -75, -60, -18, 10]) {
    for (const sloppy of [false, true]) {
      for (const direction of [1, -1] as const) {
        for (const size of [45, 90, 150, 260]) {
          const style: StarStyle = {
            rotDeg: rot,
            radiusJitter: sloppy ? 0.1 : 0.03,
            angleJitter: sloppy ? 7 : 2,
            direction,
            round: sloppy ? 5 : 1.5,
            overshoot: 0.08 + (seed % 3) * 0.03,
            start: seed % 5,
          };
          const name = `tip at ${rot}°, ${sloppy ? "sloppy" : "neat"}, R ${size}, turning ${direction}`;
          out.push([
            name,
            pencilInk(handPentagram(400, 400, size, style, seed), seed, {
              hook: 6 + (seed % 5) * 3,
            }),
          ]);
          seed++;
        }
      }
    }
  }
  return out;
}

const OUTLINES = outlineStars();
const PENTAGRAMS = pentagrams();

function xy(pts: readonly number[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i + 2 < pts.length; i += 3) out.push({ x: pts[i], y: pts[i + 1] });
  return out;
}

function centreOf(points: readonly Pt[]): Pt {
  return {
    x: points.reduce((s, p) => s + p.x, 0) / points.length,
    y: points.reduce((s, p) => s + p.y, 0) / points.length,
  };
}

describe("hand-drawn five-point stars snap to a clean star", () => {
  it.each(OUTLINES)("snaps an outline star: %s", (_name, pts) => {
    const result = recognizeShape(pts);
    expect(result?.kind).toBe("star");
    expect(result!.confidence).toBeGreaterThanOrEqual(SNAP_MIN_CONFIDENCE);
  });

  it.each(PENTAGRAMS)("snaps a one-stroke pentagram: %s", (_name, pts) => {
    const result = recognizeShape(pts);
    expect(result?.kind).toBe("star");
    expect(result!.confidence).toBeGreaterThanOrEqual(SNAP_MIN_CONFIDENCE);
  });

  it("scores neat stars well above the floor, not merely over it", () => {
    // Measured 2026-09-22: outline stars 0.74–0.96, pentagrams 0.66–0.95;
    // the lowest are 45 px pentagrams with an 18 px hook the closed stroke
    // keeps. A neat one must sit comfortably clear of the floor.
    for (const [name, pts] of [...OUTLINES, ...PENTAGRAMS].filter(([n]) => n.includes("neat"))) {
      if (name.includes("R 45")) continue;
      expect(recognizeShape(pts)!.confidence, name).toBeGreaterThanOrEqual(0.75);
    }
  });

  it("is on by default and stays a star with polygon fitting on", () => {
    // A pentagram straightens into five sharp corners and five straight
    // edges; with polygons on it must not come back as a self-crossing
    // "pentagon" — the polygon fitter now refuses anything that winds twice.
    for (const [name, pts] of [...OUTLINES.slice(0, 8), ...PENTAGRAMS.slice(0, 8)]) {
      expect(recognizeShape(pts, { polygons: true })?.kind, name).toBe("star");
      expect(
        explainShape(pts, { polygons: true }).candidates.map((c) => c.kind),
        name,
      ).not.toContain("polygon");
    }
  });
});

describe("the star fitter refuses everything else", () => {
  it.each(notStars)("produces no star for %s", (_name, pts) => {
    for (const polygons of [false, true]) {
      expect(explainShape(pts, { polygons }).candidates.map((c) => c.kind)).not.toContain("star");
    }
  });

  it.each(notStars.filter(([name]) => !name.includes("decagon")))(
    "returns null for %s",
    (_name, pts) => {
      // The decagon is round to the circle fitter (a known limit: regular
      // polygons read as circles); everything else is no shape at all.
      expect(recognizeShape(pts)).toBeNull();
    },
  );

  it("never reads a real Pencil stroke as a star, from any rebuilt stream", () => {
    for (const file of ["real-pencil-ipad", "real-pencil-ipad-2"]) {
      const strokes = (
        JSON.parse(readFileSync(`tests/ink/fixtures/${file}.json`, "utf8")) as {
          strokes: Array<{ id: number; closed: boolean; points: number[][] }>;
        }
      ).strokes;
      for (const stroke of strokes) {
        for (const seed of [1, 2, 3]) {
          const rand = rng(seed);
          const loop = stroke.points.map(([x, y]) => ({ x, y }));
          const drawn = tremor(resample(loop, 1.4), rand, { amplitude: 1.1 });
          const pts: number[] = [];
          for (const p of drawn) pts.push(p.x, p.y, 0.5);
          for (const polygons of [false, true]) {
            const kinds = explainShape(pts, { polygons }).candidates.map((c) => c.kind);
            expect(kinds, `${file}#${stroke.id} seed ${seed}`).not.toContain("star");
          }
        }
      }
    }
  });
});

// --- Discriminators ------------------------------------------------------------

interface Reading {
  corners: number;
  maxEdge: number;
  turns: number[];
}

/**
 * Every RDP reading of a closed stroke with five or ten corners, as the star
 * fitter sees it: after the overshoot trim, seam on the farthest sample,
 * split tips merged.
 */
function readings(pts: number[]): Reading[] {
  const raw = R.toPoints(pts);
  const tolerance = Math.max(24, 0.1 * R.diagonalOf(R.boundsOf(raw)));
  const points = R.rotateToFarthest(R.trimOvershoot(raw, tolerance));
  const base = Math.max(2.5, 0.025 * R.diagonalOf(R.boundsOf(points)));
  const out: Reading[] = [];
  for (const step of [1, 1.6, 2.5, 4]) {
    const tol = base * step;
    const loop = R.simplify(points, tol);
    while (loop.length > 1 && R.dist(loop[0], loop[loop.length - 1]) <= tol * 2) loop.pop();
    const found = R.mergeSplitCorners(points, R.starCorners(loop));
    const n = found.length;
    if (n !== 5 && n !== 10) continue;
    const idx = found.map((c) => points.indexOf(c));
    const edges = found.map((_, i) => R.edgeDeviation(points, idx[i], idx[(i + 1) % n]));
    const turns = found.map((c, i) =>
      R.signedTurnDeg(found[(i - 1 + n) % n], c, found[(i + 1) % n]),
    );
    out.push({ corners: n, maxEdge: Math.max(...edges), turns });
  }
  return out;
}

/** The straightest-edged reading with `corners` corners, if any. */
function reading(pts: number[], corners: number): Reading | null {
  const found = readings(pts).filter((r) => r.corners === corners);
  found.sort((a, b) => a.maxEdge - b.maxEdge);
  return found[0] ?? null;
}

describe("star discriminators, pinned across the classes they separate", () => {
  it("edges: stars are straight, a five-petal flower (the star's own structure) is not", () => {
    // Measured 2026-09-22: outline stars ≤ 0.079 at their straightest
    // reading, flowers 0.150–0.159. The gate (STAR_EDGE_MAX_ERR) is 0.12.
    for (const depth of [0.3, 0.45]) {
      const petals = reading(inkFrom(flower(300, 300, 150, depth), 20), 10)!;
      expect(petals.maxEdge, `depth ${depth}`).toBeGreaterThan(0.14);
    }
    for (const [name, pts] of OUTLINES) {
      expect(reading(pts, 10)?.maxEdge, name).toBeLessThan(0.09);
    }
  });

  it("turns: a pentagram's corners turn ~144°, a pentagon's 72°; the gate is 105°", () => {
    // Measured: pentagrams 135–153°, a pentagon 73–82°.
    for (const r of readings(inkFrom(regularPolygon(300, 300, 160, 5), 11))) {
      expect(Math.max(...r.turns.map(Math.abs))).toBeLessThan(90);
    }
    for (const [name, pts] of PENTAGRAMS) {
      const r = reading(pts, 5);
      expect(r, name).not.toBeNull();
      expect(Math.min(...r!.turns.map(Math.abs)), name).toBeGreaterThan(125);
    }
  });

  it("alternation: an outline star's corners turn alternately, a decagon's all one way", () => {
    for (const shape of [
      inkFrom(regularPolygon(300, 300, 160, 10), 14),
      inkFrom(twice(regularPolygon(300, 300, 150, 5)), 22),
    ]) {
      for (const r of readings(shape)) expect(new Set(r.turns.map(Math.sign)).size).toBe(1);
    }
    for (const [name, pts] of OUTLINES) {
      const star = reading(pts, 10)!;
      star.turns.forEach((t, i) =>
        expect(Math.sign(t), name).not.toBe(Math.sign(star.turns[(i + 1) % 10])),
      );
    }
  });
});

// --- Emitted geometry ------------------------------------------------------------

describe("emitted star geometry", () => {
  const drawnCentre = { x: 300, y: 300 };
  const outline = recognizeShape(
    pencilInk(
      handStar(300, 300, 120, { ratio: 0.45, rotDeg: -86, round: 2, overshoot: 0.12 }, 7),
      7,
      {
        hook: 10,
      },
    ),
  )!;
  const pentagram = recognizeShape(
    pencilInk(
      handPentagram(300, 300, 120, { rotDeg: -60, round: 2, overshoot: 0.1, start: 2 }, 8),
      8,
      {
        hook: 10,
      },
    ),
  )!;

  it("an outline is ten vertices plus the closing point, alternating tip and notch", () => {
    expect(outline.pts).toHaveLength(11 * 3);
    const p = xy(outline.pts);
    expect(p[10].x).toBeCloseTo(p[0].x, 1);
    expect(p[10].y).toBeCloseTo(p[0].y, 1);
    const c = centreOf(p.slice(0, 10));
    const radii = p.slice(0, 10).map((q) => Math.hypot(q.x - c.x, q.y - c.y));
    const tips = radii.filter((_, i) => i % 2 === (radii[0] > radii[1] ? 0 : 1));
    const notches = radii.filter((_, i) => i % 2 === (radii[0] > radii[1] ? 1 : 0));
    // A regular star: every tip equally far out, every notch equally far in.
    expect(Math.max(...tips) - Math.min(...tips)).toBeLessThan(0.05);
    expect(Math.max(...notches) - Math.min(...notches)).toBeLessThan(0.05);
    // Centred and sized like the drawing, with the drawn proportions.
    expect(Math.hypot(c.x - drawnCentre.x, c.y - drawnCentre.y)).toBeLessThan(8);
    expect(tips[0]).toBeGreaterThan(110);
    expect(tips[0]).toBeLessThan(130);
    expect(notches[0] / tips[0]).toBeCloseTo(0.45, 1);
  });

  it("levels a star drawn within 8° of upright: one tip straight up", () => {
    const p = xy(outline.pts).slice(0, 10);
    const c = centreOf(p);
    const top = p.reduce((a, b) => (b.y < a.y ? b : a));
    expect(top.x).toBeCloseTo(c.x, 1);
  });

  it("keeps the tilt of a star drawn well off level", () => {
    const tilted = recognizeShape(
      pencilInk(
        handStar(300, 300, 120, { ratio: 0.4, rotDeg: -70, round: 2, overshoot: 0.12 }, 9),
        9,
      ),
    )!;
    const p = xy(tilted.pts).slice(0, 10);
    const c = centreOf(p);
    const tipAngles = p
      .filter((q) => Math.hypot(q.x - c.x, q.y - c.y) > 80)
      .map((q) => (Math.atan2(q.y - c.y, q.x - c.x) * 180) / Math.PI);
    // One tip at -70° (± the hand's jitter), none at -90°.
    expect(tipAngles.some((a) => Math.abs(a + 70) < 3)).toBe(true);
    expect(tipAngles.some((a) => Math.abs(a + 90) < 5)).toBe(false);
  });

  it("a drawn pentagram comes back as a clean pentagram, not an outline", () => {
    // The inner pentagon is ink the user drew; emitting the outline would
    // erase it. Five tips plus the closing point, each step across the star.
    expect(pentagram.kind).toBe("star");
    expect(pentagram.pts).toHaveLength(6 * 3);
    const p = xy(pentagram.pts);
    const c = centreOf(p.slice(0, 5));
    for (let i = 0; i < 5; i++) {
      const a = Math.atan2(p[i].y - c.y, p[i].x - c.x);
      const b = Math.atan2(p[i + 1].y - c.y, p[i + 1].x - c.x);
      let step = Math.abs(((b - a) * 180) / Math.PI);
      if (step > 180) step = 360 - step;
      expect(step).toBeCloseTo(144, 0);
    }
  });

  it("starts at the vertex nearest pen-down and keeps the drawn winding", () => {
    for (const direction of [1, -1] as const) {
      const poly = handStar(
        300,
        300,
        120,
        { ratio: 0.42, start: 3, direction, overshoot: 0.1 },
        11,
      );
      const result = recognizeShape(pencilInk(poly, 11))!;
      const p = xy(result.pts);
      expect(Math.hypot(p[0].x - poly[0].x, p[0].y - poly[0].y)).toBeLessThan(12);
      // Same winding as the drawing: the signed area has the same sign.
      const area = (q: Pt[]): number =>
        q.reduce((s, a, i) => s + a.x * q[(i + 1) % q.length].y - q[(i + 1) % q.length].x * a.y, 0);
      expect(Math.sign(area(p.slice(0, 10)))).toBe(Math.sign(area(poly.slice(0, 10))));
    }
  });

  it("uses one constant pressure and survives serialize.ts quantization bit-for-bit", () => {
    for (const shape of [outline, pentagram]) {
      const pressures = new Set(shape.pts.filter((_, i) => i % 3 === 2));
      expect(pressures.size).toBe(1);
      expect(dequantizePts(quantizePts(shape.pts))).toEqual(shape.pts);
    }
  });

  it("re-recognises its own output as the same star, converging within a quantization step", () => {
    for (const first of [outline, pentagram]) {
      let current = first.pts;
      for (let pass = 1; pass <= 8; pass++) {
        const next = recognizeShape(current)!;
        expect(next.kind).toBe("star");
        expect(next.confidence).toBeGreaterThanOrEqual(first.confidence);
        expect(next.pts).toHaveLength(current.length);
        for (let i = 0; i < current.length; i++) {
          expect(Math.abs(next.pts[i] - first.pts[i])).toBeLessThanOrEqual(0.0201);
        }
        current = next.pts;
      }
    }
  });
});

// --- Apple Notes' arrow: a line, retraced a little way ------------------------------

const ORIGIN = { x: 300, y: 300 };
const LENGTHS = [60, 100, 160, 260, 420, 600];
const DIRECTIONS = [0, 35, 90, 200, 300];
/** The ledger's real lift tails: 5–35 px, any direction (180 = straight back along the line). */
const TAIL_LENGTHS = [5, 15, 25, 35];
const TAIL_DIRECTIONS = [180, 175, 170, 160, 150, 135, 90, 45, 0];

describe("a retraced line becomes an arrow", () => {
  /** [name, pts, length, direction, pen-down hook length] */
  const cases: Array<[string, number[], number, number, number]> = [];
  let seed = 1;
  // Retraces that clear the floor (≥ 40 px and ≥ 12 % of the shaft), with a
  // pen-down hook, 0–8° of hand deviation, and some with a lift tail.
  for (const [len, fraction] of [
    [100, 0.45],
    [160, 0.3],
    [260, 0.2],
    [420, 0.15],
    [600, 0.15],
  ] as const) {
    for (const deg of DIRECTIONS) {
      for (const dev of [0, 4, 8]) {
        const tail: [number, number] | undefined = seed % 3 === 0 ? [12, 240] : undefined;
        const hookLen = 10 + (seed % 3) * 8;
        const pts = retracedLine(
          ORIGIN,
          len,
          deg,
          { hook: [hookLen, deg + 150 + (seed % 5) * 20], retrace: [fraction, dev, 2], tail },
          seed++,
        );
        const name = `${len} px at ${deg}°, back ${fraction * 100}% (${dev}° off)${tail ? ", lift tail" : ""}`;
        cases.push([name, pts, len, deg, hookLen]);
      }
    }
  }

  it.each(cases)("snaps %s", (_name, pts, len, deg, hookLen) => {
    const result = recognizeShape(pts);
    expect(result?.kind).toBe("arrow");
    // Scored exactly as the line fitter scores the shaft: a 100 px shaft with
    // a 26 px lead-in bent 30° into it reads 0.70, a 160 px one 0.77, and
    // longer ones 0.9+.
    expect(result!.confidence).toBeGreaterThanOrEqual(len >= 160 ? 0.75 : SNAP_MIN_CONFIDENCE);
    // Contract layout: [tail, tip, tip, barb, tip, barb].
    const p = xy(result!.pts);
    expect(p).toHaveLength(6);
    expect(p[2]).toEqual(p[1]);
    expect(p[4]).toEqual(p[1]);
    // The shaft runs from pen-down to the turn; the head sits at the turn
    // and points the way the line was drawn.
    const turn = {
      x: ORIGIN.x + len * Math.cos((deg * Math.PI) / 180),
      y: ORIGIN.y + len * Math.sin((deg * Math.PI) / 180),
    };
    expect(Math.hypot(p[1].x - turn.x, p[1].y - turn.y)).toBeLessThan(8);
    // The tail is where the pen went down. These hooks are mostly lead-ins
    // within 10–50° of the line, which are part of the shaft, not trimmed.
    expect(Math.hypot(p[0].x - ORIGIN.x, p[0].y - ORIGIN.y)).toBeLessThan(hookLen + 6);
    const forward = Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x);
    let off = Math.abs(forward - (deg * Math.PI) / 180) % (2 * Math.PI);
    if (off > Math.PI) off = 2 * Math.PI - off;
    // The lead-in is part of the shaft's fit, so a short shaft tilts a little.
    expect((off * 180) / Math.PI).toBeLessThan(len >= 160 ? 3 : 6);
    // Both barbs trail back from the tip on opposite sides of the shaft.
    const ux = Math.cos(forward);
    const uy = Math.sin(forward);
    const side = (q: Pt): number => (q.x - p[1].x) * uy - (q.y - p[1].y) * ux;
    const along = (q: Pt): number => (q.x - p[1].x) * ux + (q.y - p[1].y) * uy;
    expect(Math.sign(side(p[3]))).toBe(-Math.sign(side(p[5])));
    expect(along(p[3])).toBeLessThan(0);
    expect(along(p[5])).toBeLessThan(0);
  });

  it("re-reads its own output as an arrow, at least as confidently", () => {
    for (const [name, pts] of cases.slice(0, 20)) {
      const first = recognizeShape(pts)!;
      const second = recognizeShape(first.pts)!;
      expect(second.kind, name).toBe("arrow");
      expect(second.confidence, name).toBeGreaterThanOrEqual(first.confidence);
    }
  });
});

describe("a plain line stays a line", () => {
  it("never turns a line with a real-style lift tail into an arrow, in any direction", () => {
    // A tail that happens to reverse along the line reads as a retrace
    // exactly as long as itself — 32–35 px for the longest tails, 0–12° off
    // straight back — so no angle can tell them apart; the 40 px floor does.
    let seed = 1000;
    const kinds = new Map<string, number>();
    for (const len of LENGTHS) {
      for (const deg of DIRECTIONS) {
        for (const tailLen of TAIL_LENGTHS) {
          for (const tailDeg of TAIL_DIRECTIONS) {
            const pts = retracedLine(
              ORIGIN,
              len,
              deg,
              {
                hook: [10 + (seed % 3) * 8, deg + 150 + (seed % 5) * 20],
                tail: [tailLen, tailDeg],
              },
              seed++,
            );
            const kind = recognizeShape(pts)?.kind ?? "null";
            kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
            expect(kind, `${len} px at ${deg}°, ${tailLen} px tail at ${tailDeg}°`).not.toBe(
              "arrow",
            );
          }
        }
      }
    }
    // Almost all of them still read as the line they are.
    expect(kinds.get("line")! / (LENGTHS.length * DIRECTIONS.length * 36)).toBeGreaterThan(0.85);
  });

  it("a retrace under the floor is a lift hook: the line fitter gets a line", () => {
    // 30 px back along a 260 px line: shorter than the longest real tail.
    const pts = retracedLine(ORIGIN, 260, 0, { retrace: [30 / 260, 0, 1] }, 5);
    expect(recognizeShape(pts)?.kind).toBe("line");
  });

  it("a retrace that strays more than 20° off the line is not an arrow", () => {
    const pts = retracedLine(ORIGIN, 260, 0, { retrace: [0.3, 30, 1] }, 6);
    expect(recognizeShape(pts)?.kind).not.toBe("arrow");
  });

  it("out and all the way back is still refused, not an arrow", () => {
    const pts = retracedLine(ORIGIN, 300, 0, { retrace: [0.95, 0, 2] }, 7);
    expect(recognizeShape(pts)).toBeNull();
  });

  it("the real Pencil line, from every rebuilt stream, is a line and never an arrow", () => {
    const line = (
      JSON.parse(readFileSync("tests/ink/fixtures/real-pencil-ipad.json", "utf8")) as {
        strokes: Array<{ id: number; expect: string; points: number[][] }>;
      }
    ).strokes.find((s) => s.expect === "line")!;
    for (const seed of [1, 2, 3, 4, 5]) {
      const rand = rng(seed);
      const base = line.points.map(([x, y]) => ({ x, y }));
      const drawn = tremor(resample(base, 1.4), rand, { amplitude: 1.1 });
      const pts: number[] = [];
      for (const p of drawn) pts.push(p.x, p.y, 0.5);
      // Held at the end, and with a straight-back lift tail of the longest
      // real length on top.
      expect(recognizeShape(pts)?.kind).toBe("line");
      const back = [
        ...drawn,
        ...resample(
          [
            drawn[drawn.length - 1],
            { x: drawn[drawn.length - 1].x - 35, y: drawn[drawn.length - 1].y },
          ],
          1.4,
        ),
      ];
      const tailed: number[] = [];
      for (const p of back) tailed.push(p.x, p.y, 0.5);
      expect(recognizeShape(tailed)?.kind).not.toBe("arrow");
    }
  });

  it("the one-barb arrow, the V, the L and the checkmark stay refused", () => {
    // contracts/api.md §2: a one-barb arrow is refused because every
    // checkmark and "L" is one. Its barb leaves the shaft at 28°; a retrace
    // must come back within 20°.
    const refused = [
      inkFrom(arrowOutline({ x: 120, y: 300 }, { x: 460, y: 300 }, 0.22, 28, 1), 21),
      inkFrom(polyline(100, 100, 200, 300, 300, 100), 1),
      inkFrom(polyline(100, 100, 100, 300, 300, 300), 2),
      inkFrom(polyline(100, 220, 160, 300, 320, 100), 27),
    ];
    for (const pts of refused) expect(recognizeShape(pts, { minConfidence: 0 })).toBeNull();
  });

  it("closed shapes never read as a retrace: their ends meet, so the 'retrace' is the whole way back", () => {
    for (const pts of [
      inkFrom(rectangle(100, 100, 400, 100), 3),
      inkFrom(regularPolygon(300, 300, 160, 3), 10),
      inkFrom(arc(300, 300, 150, 150), 25),
      inkFrom(roundedRectish(100, 120, 400, 300, 24), 70),
    ]) {
      expect(recognizeShape(pts)?.kind).not.toBe("arrow");
    }
  });
});
