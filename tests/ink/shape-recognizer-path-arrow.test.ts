/**
 * Arrows along a path (discussion #107, 2026-11-01): a held stroke of
 * straight runs at corners (an elbow, an S, stairs) or a smooth curve,
 * ending in a head, becomes a `path` with its head and rounded corners in
 * its style.
 *
 * No real Pencil path arrow has been traced yet, so the positives are
 * synthetic (`ink-synth`: Pencil density, tremor, a pen-down hook, corners
 * rounded or run past before the turn, every direction, mirrored). The
 * negatives lean on every real stroke the repo has: none may become a path,
 * held or lifted. The discriminators were printed across classes before the
 * gates were set (CLAUDE.md); the UJI pen characters (11 640 handwritten
 * characters, every stroke read as held) were run outside the suite, since
 * the corpus lives in the private research folder: 0.09 % of their strokes
 * at 80 page px tall became a path (0.3 % at 160, mostly the corpus's lift
 * tails read as a retrace, which a hold has none of).
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  explainShape,
  recognizeAtZoom,
  recognizeShape,
  styleOfShape,
} from "../../src/ink/shape-recognizer";
import { ROUND_RADIUS } from "../../src/model/shape-style";
import {
  type HeadStyle,
  type PathStyle,
  type Pt,
  arc,
  arrowOutline,
  handPath,
  inkFrom,
  pencilInk,
  polyline,
  resample,
  rng,
  tremor,
  turned,
  withHead,
} from "./ink-synth";

function xy(pts: readonly number[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i + 2 < pts.length; i += 3) out.push({ x: pts[i], y: pts[i + 1] });
  return out;
}

const CENTRE = { x: 400, y: 400 };
const DIRECTIONS = [0, 37, 90, 135, 180, 250, 300];

/** The reporter's S (Goodnotes pictures): its first run 3° off level, runs at right angles. */
const S = polyline(100, 260, 420, 245, 425, 520, 760, 515);
const ELBOWS: Array<[string, Pt[]]> = [
  ["L", polyline(150, 250, 450, 250, 450, 450)],
  ["S", S],
  ["U", polyline(150, 250, 450, 250, 450, 400, 200, 400)],
  ["stairs", polyline(100, 200, 220, 200, 220, 300, 340, 300, 340, 400, 460, 400)],
  ["short L", polyline(200, 300, 280, 300, 280, 360)],
  ["Z", polyline(150, 250, 400, 250, 250, 400, 500, 400)],
];

function sine(): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= 60; i++)
    out.push({ x: 150 + i * 8, y: 400 + 70 * Math.sin((i / 30) * Math.PI) });
  return out;
}
const CURVES: Array<[string, Pt[]]> = [
  ["quarter", arc(300, 400, 200, 200, 180, -90, 40)],
  ["half", arc(300, 400, 150, 150, 180, -180, 40)],
  ["S curve", sine()],
  ["shallow", arc(300, 400, 260, 260, 180, -60, 40)],
];

const HEADS: HeadStyle[] = [
  { kind: "v" },
  { kind: "open" },
  { kind: "v", len: 16, deg: 40 },
  { kind: "v", len: 24, deg: 25, ratio: 0.7 },
];
const CORNERS: PathStyle[] = [{}, { round: 12 }, { overrun: 6 }];

/** Pencil ink of `body` with `head`, turned and mirrored, a pen-down hook on odd seeds. */
function drawn(
  body: readonly Pt[],
  head: HeadStyle,
  corners: PathStyle,
  deg: number,
  mirror: boolean,
  seed: number,
): number[] {
  const poly = turned(withHead(handPath(body, corners), head), deg, CENTRE.x, CENTRE.y, mirror);
  return pencilInk(poly, seed, { hook: seed % 2 ? 12 : 0 });
}

/** Fraction of `cases` that snap to a path, held. */
function pathRate(cases: number[][]): number {
  return (
    cases.filter((pts) => recognizeShape(pts, { held: true })?.kind === "path").length /
    cases.length
  );
}

describe("an elbow with a head becomes a path of straight runs", () => {
  it("snaps every elbow, every head, every corner style, turned and mirrored", () => {
    for (const [name, body] of ELBOWS) {
      const cases: number[][] = [];
      let seed = 1;
      for (const head of HEADS) {
        for (const corners of CORNERS) {
          for (const deg of [0, 90, 135, 250]) {
            cases.push(drawn(body, head, corners, deg, seed % 2 === 0, seed++));
          }
        }
      }
      // A 16 px head on a long body is the hardest; nearly all still snap.
      expect(pathRate(cases), name).toBeGreaterThanOrEqual(0.95);
    }
  });

  it("the reporter's S: three runs, put level and upright, the corners rounded, an open head at the end", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const result = recognizeShape(drawn(S, { kind: "v" }, {}, 0, false, seed), { held: true });
      expect(result?.kind).toBe("path");
      const v = xy(result!.pts);
      expect(v).toHaveLength(4);
      // The first run was drawn 3° off level, the others square: all on the axes now.
      expect(v[0].y).toBeCloseTo(v[1].y, 6);
      expect(v[1].x).toBeCloseTo(v[2].x, 6);
      expect(v[2].y).toBeCloseTo(v[3].y, 6);
      // The corners where the hand turned; the tip where it stopped.
      expect(Math.hypot(v[1].x - 420, v[1].y - 252)).toBeLessThan(10);
      expect(Math.hypot(v[3].x - 760, v[3].y - 515)).toBeLessThan(10);
      expect(result!.heads).toEqual({ end: "open" });
      expect(result!.radius).toBe(ROUND_RADIUS);
      expect(result!.confidence).toBeGreaterThan(0.8);
    }
  });

  it("keeps a run that is not near an axis as drawn (an elbow in any direction)", () => {
    const result = recognizeShape(drawn(ELBOWS[0][1], { kind: "v" }, {}, 37, false, 3), {
      held: true,
    });
    const v = xy(result!.pts);
    const deg = (Math.atan2(v[1].y - v[0].y, v[1].x - v[0].x) * 180) / Math.PI;
    expect(Math.abs(deg - 37)).toBeLessThan(3);
  });

  it("snaps the reporter's S drawn in any direction, either way round", () => {
    const cases: number[][] = [];
    for (let deg = 0; deg < 360; deg += 15) {
      for (const mirror of [false, true])
        cases.push(drawn(S, { kind: "v" }, {}, deg, mirror, deg + 1));
    }
    expect(pathRate(cases)).toBe(1);
  });

  it("snaps the retrace gesture at the end of an elbow (back along the last run, then hold)", () => {
    let seed = 1;
    const cases: number[][] = [];
    for (const [name, body] of ELBOWS) {
      if (name === "short L") continue; // 40 px back is two thirds of its 60 px last run: doubled
      for (const deg of DIRECTIONS) {
        cases.push(drawn(body, { kind: "retrace", len: 40 }, {}, deg, deg % 2 === 0, seed++));
      }
    }
    expect(pathRate(cases)).toBeGreaterThanOrEqual(0.95);
  });
});

describe("a curve with a head becomes a smooth path", () => {
  it("snaps every curve with a V or an open head, in every direction and mirrored", () => {
    for (const [name, body] of CURVES) {
      const cases: number[][] = [];
      let seed = 1;
      for (const head of HEADS) {
        for (const deg of DIRECTIONS)
          cases.push(drawn(body, head, {}, deg, seed % 2 === 0, seed++));
      }
      expect(pathRate(cases), name).toBeGreaterThanOrEqual(0.95);
    }
  });

  it("is a dense smooth centreline from pen-down to the tip, with no corners to round", () => {
    const result = recognizeShape(drawn(CURVES[1][1], { kind: "v" }, {}, 0, false, 2), {
      held: true,
    });
    expect(result?.kind).toBe("path");
    expect(result!.radius).toBeUndefined();
    expect(result!.heads).toEqual({ end: "open" });
    const v = xy(result!.pts);
    expect(v.length).toBeGreaterThan(24);
    // Smooth: no turn between neighbouring samples past a few degrees.
    for (let i = 1; i < v.length - 1; i++) {
      const a = Math.atan2(v[i].y - v[i - 1].y, v[i].x - v[i - 1].x);
      const b = Math.atan2(v[i + 1].y - v[i].y, v[i + 1].x - v[i].x);
      const turn = Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));
      expect(turn).toBeLessThan((12 * Math.PI) / 180);
    }
    // It runs from where the pen started to the tip: the half circle's ends.
    expect(Math.hypot(v[0].x - 150, v[0].y - 400)).toBeLessThan(6);
    expect(Math.hypot(v[v.length - 1].x - 450, v[v.length - 1].y - 400)).toBeLessThan(6);
  });
});

describe("what is not a path arrow", () => {
  it("a straight arrow stays the straight arrow, held or lifted", () => {
    for (const seed of [1, 2, 3]) {
      const pts = inkFrom(arrowOutline({ x: 120, y: 300 }, { x: 460, y: 340 }), seed);
      expect(recognizeShape(pts, { held: true })?.kind).toBe("arrow");
      expect(recognizeShape(pts)?.kind).toBe("arrow");
    }
  });

  it("a path without a head, or with one barb, is never a path", () => {
    let seed = 1;
    for (const [, body] of [...ELBOWS, ...CURVES]) {
      for (const deg of [0, 135, 250]) {
        const plain = pencilInk(turned(handPath(body), deg, CENTRE.x, CENTRE.y), seed++);
        const oneBarb = drawn(body, { kind: "one-barb" }, {}, deg, false, seed++);
        for (const pts of [plain, oneBarb]) {
          const kinds = explainShape(pts, { held: true, minConfidence: 0 }).candidates;
          expect(kinds.map((c) => c.kind)).not.toContain("path");
        }
      }
    }
  });

  it("a head on a lifted stroke is left to handwriting: no path without a hold", () => {
    const pts = drawn(S, { kind: "v" }, {}, 0, false, 1);
    expect(explainShape(pts).candidates.map((c) => c.kind)).not.toContain("path");
  });

  it("a scribble whose last passes make a V is not a path (nor are its passes runs)", () => {
    // Passes reversing on the spot turn ~170°: past any corner a path has.
    const zigzag: Pt[] = [];
    for (let i = 0; i < 8; i++) zigzag.push({ x: 100 + i * 14, y: i % 2 ? 300 : 360 });
    const pts = pencilInk(withHead(zigzag, { kind: "v" }), 4);
    expect(explainShape(pts, { held: true }).candidates.map((c) => c.kind)).not.toContain("path");
  });

  it("a loop at the end is no head: written 6s and os that passed every other head gate", () => {
    // Without the head's straight-legs and corner gates each of these was
    // a path in at least 4 of 5 rebuilt streams (fixture's source).
    const { strokes } = JSON.parse(
      readFileSync("tests/ink/fixtures/uji-loops-path-arrow.json", "utf8"),
    ) as { strokes: Array<{ id: string; points: number[][] }> };
    expect(strokes).toHaveLength(18);
    for (const stroke of strokes) {
      const base = stroke.points.map(([x, y]) => ({ x: x * 0.08, y: y * 0.08 }));
      for (const seed of [1, 2, 3, 4, 5]) {
        const ink = tremor(resample(base, 1.4), rng(seed), { amplitude: 1.1 });
        const pts = ink.flatMap((p) => [p.x, p.y, 0.5]);
        expect(recognizeShape(pts, { held: true })?.kind, `${stroke.id} seed ${seed}`).not.toBe(
          "path",
        );
      }
    }
  });

  it("no real Pencil stroke in the repo is ever a path, held or lifted, from any rebuilt stream", () => {
    for (const file of [
      "real-handwriting-squiggles",
      "real-scribbles-ipad",
      "real-pencil-ipad",
      "real-pencil-ipad-2",
      "real-pencil-arrows-ipad",
      "real-pencil-stars-clouds-ipad",
      "real-pencil-shapes-2026-10-31",
      "real-highlights-ipad",
    ]) {
      const { strokes } = JSON.parse(readFileSync(`tests/ink/fixtures/${file}.json`, "utf8")) as {
        strokes: Array<{ pts?: number[]; points?: number[][] } | number[]>;
      };
      strokes.forEach((s, i) => {
        const raw = Array.isArray(s) ? s : (s.pts ?? s.points!.flatMap(([x, y]) => [x, y, 0.5]));
        const base = xy(raw);
        const streams = [raw];
        for (const seed of [1, 2, 3]) {
          const ink = tremor(resample(base, 1.4), rng(seed), { amplitude: 1.1 });
          streams.push(ink.flatMap((p) => [p.x, p.y, 0.5]));
        }
        for (const pts of streams) {
          for (const held of [true, false]) {
            const kinds = explainShape(pts, { held, minConfidence: 0 }).candidates;
            expect(
              kinds.map((c) => c.kind),
              `${file}#${i}`,
            ).not.toContain("path");
          }
        }
      });
    }
  });
});

describe("its style and zoom", () => {
  it("styleOfShape copies a path's head and corners, and nothing for other kinds", () => {
    const result = recognizeShape(drawn(S, { kind: "v" }, {}, 0, false, 1), { held: true })!;
    const style = styleOfShape(result);
    expect(style).toEqual({ heads: { end: "open" }, radius: ROUND_RADIUS });
    expect(style.heads).not.toBe(result.heads);
    expect(styleOfShape({})).toEqual({});
  });

  it("drawn zoomed in, its corners are as round on the page as they were drawn", () => {
    const pts = drawn(S, { kind: "v" }, {}, 0, false, 1).map((v, i) => (i % 3 === 2 ? v : v / 4));
    const result = recognizeAtZoom(pts, 4, { held: true });
    expect(result?.kind).toBe("path");
    expect(result!.radius).toBeCloseTo(ROUND_RADIUS / 4, 2);
  });

  it("a long held stroke is read without stalling the pen", () => {
    // Fourteen runs of stairs, ~1000 samples: ~12 ms on a laptop. The bound
    // only catches a blow-up (the crossing and clearance tests are quadratic).
    const corners: number[] = [];
    for (let i = 0; i < 7; i++)
      corners.push(60 + i * 110, 100 + i * 90, 60 + (i + 1) * 110, 100 + i * 90);
    const pts = drawn(polyline(...corners), { kind: "v" }, {}, 0, false, 1);
    const started = performance.now();
    explainShape(pts, { held: true });
    expect(performance.now() - started).toBeLessThan(500);
  });
});
