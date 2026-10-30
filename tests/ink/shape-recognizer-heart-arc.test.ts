/**
 * Hearts, open arcs and sectors (2026-10-30).
 *
 * No real Pencil heart, arc or sector has been traced yet, so the positives
 * are synthetic (`ink-synth`: Pencil density, tremor, a pen-down hook, a
 * closing overshoot, starts all round the outline, both directions), and
 * the negatives lean on every real stroke the repo has: no real triangle,
 * circle, rect, star, cloud or arrow may read any differently held than
 * lifted (holding is how shapes are snapped, and a hold is what turns arcs
 * and sectors on), and none may read as a heart.
 *
 * The discriminators were printed across every class before the gates were
 * set (CLAUDE.md); the "discriminators" blocks pin the separations, so a
 * retune that erodes one fails with the numbers in view.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  HEART_ASPECT,
  arcPoints,
  cloudPoints,
  heartPoints,
  presetGeometry,
  sectorPoints,
} from "../../src/ink/shape-geometry";
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
  handHeart,
  handPentagram,
  handSector,
  handStar,
  lobeHeart,
  pencilInk,
  polyline,
  rectangle,
  regularPolygon,
  resample,
  rng,
  segment,
  tremor,
} from "./ink-synth";

function xy(pts: readonly number[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i + 2 < pts.length; i += 3) out.push({ x: pts[i], y: pts[i + 1] });
  return out;
}

const rand = rng(41);
/** Pencil-like ink along an ideal path, no hook. */
const ink = (p: Pt[]): number[] =>
  tremor(resample(p, 1.4), rand, { amplitude: 1.1 }).flatMap((q) => [q.x, q.y, 0.5]);

const kinds = (pts: number[], held = false): string[] =>
  explainShape(pts, { held }).candidates.map((c) => c.kind);

// --- Real strokes ------------------------------------------------------------

interface Traced {
  id: unknown;
  expect?: string;
  desc?: string;
  closed?: boolean;
  points: number[][];
}

function traced(file: string): Traced[] {
  return (
    JSON.parse(readFileSync(`tests/ink/fixtures/${file}.json`, "utf8")) as { strokes: Traced[] }
  ).strokes;
}

/** A traced stroke as a Pencil stream: a closed one started at `start` and overshooting. */
function stream(stroke: Traced, start: number, seed: number): number[] {
  const loop: Pt[] = stroke.points.map(([x, y]) => ({ x, y }));
  const r = rng(seed);
  const closed = stroke.closed ?? (stroke.expect !== "arrow" && stroke.expect !== "line");
  if (!closed)
    return tremor(resample(loop, 1.4), r, { amplitude: 1.1 }).flatMap((p) => [p.x, p.y, 0.5]);
  const k = Math.floor(loop.length * start);
  const rotated = loop.slice(k).concat(loop.slice(0, k));
  const overshoot = rotated.slice(0, Math.floor(rotated.length * 0.08));
  return tremor(resample([...rotated, rotated[0], ...overshoot], 1.4), r, {
    amplitude: 1.1,
  }).flatMap((p) => [p.x, p.y, 0.45 + r() * 0.2]);
}

const REAL_FILES = ["real-pencil-ipad", "real-pencil-ipad-2", "real-pencil-stars-clouds-ipad"];

function realStreams(): Array<[string, number[]]> {
  const out: Array<[string, number[]]> = [];
  for (const file of REAL_FILES) {
    for (const s of traced(file)) {
      for (const start of [0, 0.2, 0.4, 0.6, 0.8]) {
        for (const seed of [1, 2, 3]) {
          out.push([
            `${file} ${String(s.id)} (${s.desc ?? s.expect}) start ${start} seed ${seed}`,
            stream(s, start, seed),
          ]);
        }
      }
    }
  }
  const mouse = JSON.parse(
    readFileSync("tests/ink/fixtures/real-mouse-triangles.json", "utf8"),
  ) as number[][];
  mouse.forEach((pts, i) => out.push([`real mouse triangle ${i}`, pts]));
  for (const s of traced("real-pencil-arrows-ipad")) {
    out.push([`real arrow ${String(s.id)}`, stream(s, 0, 1)]);
  }
  return out;
}

// --- Hearts -----------------------------------------------------------------

describe("hand-drawn hearts", () => {
  const cases: Array<[string, number[]]> = [];
  let seed = 1;
  for (const cusp of [3, 5, 7]) {
    for (const start of [0, 0.25, 0.5, 0.75]) {
      for (const direction of [1, -1] as const) {
        cases.push([
          `cusp ${cusp}, from ${start} of the way round, direction ${direction}`,
          pencilInk(handHeart(300, 300, 220, { cusp, start, direction, overshoot: 0.05 }), seed++, {
            hook: 8,
          }),
        ]);
      }
    }
  }
  for (const wide of [0.75, 1.3]) {
    for (const lopsided of [0, 0.2]) {
      for (const tiltDeg of [0, 12, -18]) {
        cases.push([
          `width ${wide}, lopsided ${lopsided}, tilted ${tiltDeg}°`,
          pencilInk(handHeart(300, 300, 180, { wide, lopsided, tiltDeg, start: 0.1 }), seed++, {
            hook: 6,
          }),
        ]);
      }
    }
  }
  for (const gap of [0.6, 0.75, 0.9]) {
    for (const tip of [2.2, 2.6, 3.1]) {
      cases.push([
        `two round lobes (gap ${gap}, tip ${tip})`,
        pencilInk(lobeHeart(300, 300, 70, gap, tip), seed++, { hook: 6 }),
      ]);
    }
  }
  cases.push(["a small heart", pencilInk(handHeart(300, 300, 60, { start: 0.3 }), seed++)]);
  cases.push([
    "a big heart",
    pencilInk(handHeart(300, 300, 600, { start: 0.6 }), seed++, { hook: 10 }),
  ]);
  cases.push(["a heart on its side", pencilInk(handHeart(300, 300, 200, { tiltDeg: 88 }), seed++)]);

  it.each(cases)("recognises %s", (_name, pts) => {
    expect(recognizeShape(pts)?.kind).toBe("heart");
    // A hold changes nothing for a heart.
    expect(recognizeShape(pts, { held: true })?.kind).toBe("heart");
  });

  it("recognises one drawn at 4x zoom, a quarter the size on the page", () => {
    const pts = pencilInk(handHeart(300, 300, 50, { start: 0.2 }), 77);
    expect(recognizeAtZoom(pts, 4)?.kind).toBe("heart");
  });
});

describe("what is never a heart", () => {
  const flower: Pt[] = Array.from({ length: 401 }, (_, i) => {
    const a = (i / 400) * 2 * Math.PI;
    const r = 150 * (1 - 0.3 * (0.5 - 0.5 * Math.cos(5 * a)));
    return { x: 300 + r * Math.cos(a), y: 300 + r * Math.sin(a) };
  });
  const kidney: Pt[] = Array.from({ length: 301 }, (_, i) => {
    const a = (i / 300) * 2 * Math.PI;
    const r = 120 * (1 - 0.25 * Math.exp(-((a - 1.5 * Math.PI) ** 2) * 3));
    return { x: 300 + 1.4 * r * Math.cos(a), y: 300 + r * Math.sin(a) };
  });
  const apple: Pt[] = Array.from({ length: 301 }, (_, i) => {
    const a = (i / 300) * 2 * Math.PI - Math.PI;
    const r = 120 * (1 - 0.3 * Math.exp(-((a + Math.PI / 2) ** 2) * 6));
    return { x: 300 + r * Math.cos(a), y: 300 + r * Math.sin(a) };
  });
  const teardrop: Pt[] = Array.from({ length: 301 }, (_, i) => {
    const t = (i / 300) * 2 * Math.PI;
    return { x: 300 + 100 * Math.sin(t) * Math.sin(t / 2) ** 1.5, y: 300 - 150 * Math.cos(t / 2) };
  });
  const fish: Pt[] = [
    ...arc(300, 300, 120, 70, 20, 320, 80),
    { x: 470, y: 230 },
    { x: 470, y: 370 },
  ];
  const cloud = cloudPoints(150, 200, 300, 180, 9);

  it.each([
    ["a circle", ink(arc(300, 300, 140, 140))],
    ["an ellipse", ink(arc(300, 300, 160, 90))],
    ["a rectangle", ink(rectangle(100, 100, 300, 180))],
    ["a triangle", ink(regularPolygon(300, 300, 150, 3))],
    ["a triangle standing on its point", ink(regularPolygon(300, 300, 150, 3, 90))],
    ["a star outline", pencilInk(handStar(300, 300, 120, {}, 3), 3)],
    ["a pentagram", pencilInk(handPentagram(300, 300, 120, {}, 3), 3)],
    ["a cloud", ink([...cloud])],
    ["a five-petal flower", ink(flower)],
    ["a kidney bean", ink(kidney)],
    ["an apple (a dent, a round bottom)", ink(apple)],
    ["a teardrop (a tip, no dent)", ink(teardrop)],
    [
      "a dart (a notch and a point, straight wings)",
      ink(polyline(100, 100, 400, 250, 100, 400, 200, 250, 100, 100)),
    ],
    ["a fish", ink([...fish, fish[0]])],
    [
      "a crescent moon",
      ink([...arc(300, 300, 150, 150, 120, 240, 80), ...arc(380, 300, 120, 120, 240, -120, 60)]),
    ],
    ["a pac-man", pencilInk(handSector(300, 300, 120, 30, 300), 6)],
    ["a D", ink([...segment(200, 120, 200, 420), ...arc(200, 270, 150, 150, 90, -180, 60)])],
  ] as Array<[string, number[]]>)("does not take %s", (_name, pts) => {
    expect(kinds(pts)).not.toContain("heart");
    expect(kinds(pts, true)).not.toContain("heart");
  });

  it("never reads a real Pencil or mouse stroke as a heart, from any start", () => {
    for (const [name, pts] of realStreams()) {
      expect(kinds(pts, true), name).not.toContain("heart");
    }
  }, 30_000);
});

describe("heart discriminators (printed before the gates were set)", () => {
  /** Dents, deepest first, and the frame's three sharpness readings. */
  function measure(pts: readonly number[]): {
    dents: number[];
    tip: number;
    cusp: number;
    lobe: number;
  } | null {
    const p = xy(pts);
    const diag = R.diagonalOf(R.boundsOf(p));
    const frame = R.heartFrame(p, diag);
    if (!frame) return null;
    return {
      dents: R.hullDentRuns(p, diag)
        .map((d: { depth: number }) => d.depth)
        .sort((a: number, b: number) => b - a),
      tip: frame.tipDeg,
      cusp: frame.cuspDeg,
      lobe: frame.lobeDeg,
    };
  }

  it("hearts dip once, at a cusp of 50°+, opposite a tip of 80°+, with round lobes (≤ 60°)", () => {
    const hearts = [
      ...[3, 5, 7].map((cusp) => ink(handHeart(300, 300, 220, { cusp }))),
      ...[0.6, 0.9].map((gap) => ink(lobeHeart(300, 300, 70, gap, 2.2))),
    ];
    for (const pts of hearts) {
      const m = measure(pts);
      expect(m).not.toBeNull();
      if (!m) continue;
      expect(m.dents[0]).toBeGreaterThanOrEqual(0.04);
      expect(m.dents[1] ?? 0).toBeLessThanOrEqual(0.5 * m.dents[0]);
      expect(m.tip).toBeGreaterThanOrEqual(80);
      expect(m.cusp).toBeGreaterThanOrEqual(50);
      expect(m.lobe).toBeLessThanOrEqual(60);
    }
  });

  it("the near misses fail on the measure meant for them", () => {
    // A teardrop has a tip and no cusp; a dart has a notch and a point but
    // corners for wings; a crescent's far side is round.
    const teardrop = measure(
      ink(
        Array.from({ length: 301 }, (_, i) => {
          const t = (i / 300) * 2 * Math.PI;
          return {
            x: 300 + 100 * Math.sin(t) * Math.sin(t / 2) ** 1.5,
            y: 300 - 150 * Math.cos(t / 2),
          };
        }),
      ),
    );
    expect(teardrop === null || teardrop.cusp < 40).toBe(true);
    const dart = measure(ink(polyline(100, 100, 400, 250, 100, 400, 200, 250, 100, 100)));
    expect(dart === null || dart.lobe > 90).toBe(true);
    const crescent = measure(
      ink([...arc(300, 300, 150, 150, 120, 240, 80), ...arc(380, 300, 120, 120, 240, -120, 60)]),
    );
    expect(crescent === null || crescent.tip < 55).toBe(true);
  });
});

describe("emitted heart geometry", () => {
  const drawn = pencilInk(handHeart(300, 300, 220, { start: 0.3, tiltDeg: 6 }), 5, { hook: 6 });
  const result = recognizeShape(drawn);

  it("is a closed outline the size of the drawing, upright when nearly so", () => {
    expect(result?.kind).toBe("heart");
    const pts = xy(result?.pts ?? []);
    expect(pts[0]).toEqual(pts[pts.length - 1]);
    const box = R.boundsOf(pts);
    const ink0 = R.boundsOf(xy(drawn));
    expect(Math.abs(box.maxX - box.minX - (ink0.maxX - ink0.minX))).toBeLessThan(30);
    // Tilted 6°, it comes back upright: symmetric about a vertical line.
    const mid = (box.minX + box.maxX) / 2;
    const top = pts.reduce((best, p) => (p.y > best.y ? p : best));
    expect(Math.abs(top.x - mid)).toBeLessThan(1);
  });

  it("starts near pen-down and keeps the drawn winding", () => {
    const pts = xy(result?.pts ?? []);
    const first = xy(drawn)[0];
    expect(Math.hypot(pts[0].x - first.x, pts[0].y - first.y)).toBeLessThan(40);
    const area = (p: Pt[]): number =>
      p.reduce((s, q, i) => {
        const r = p[(i + 1) % p.length];
        return s + q.x * r.y - r.x * q.y;
      }, 0);
    expect(Math.sign(area(pts))).toBe(Math.sign(area(xy(drawn))));
  });

  it("survives serialize.ts quantization bit-for-bit, and reads as itself again", () => {
    const pts = result?.pts ?? [];
    expect(dequantizePts(quantizePts(pts))).toEqual(pts);
    const again = recognizeShape(pts);
    expect(again?.kind).toBe("heart");
    expect(again?.confidence).toBeGreaterThan(0.95);
  });

  it("the Shape tool's heart fills its box and reads as a heart", () => {
    const pts = presetGeometry(
      "heart",
      { x: 100, y: 100 },
      { x: 300, y: 100 + 200 * HEART_ASPECT },
      0.5,
    );
    const box = R.boundsOf(xy(pts));
    expect(box.minX).toBeCloseTo(100, 1);
    expect(box.maxX).toBeCloseTo(300, 1);
    expect(box.minY).toBeCloseTo(100, 1);
    expect(box.maxY).toBeCloseTo(100 + 200 * HEART_ASPECT, 1);
    expect(recognizeShape(pts)?.kind).toBe("heart");
    // From the cusp, clockwise on screen.
    const p = xy(pts);
    expect(p[0].x).toBeCloseTo(200, 1);
    expect(p[1].x).toBeGreaterThan(p[0].x);
  });

  it("heartPoints turns about its centre", () => {
    const up = xy(flatten(heartPoints(0, 0, 100, 90)));
    const side = xy(flatten(heartPoints(0, 0, 100, 90, Math.PI / 2)));
    // Turned a quarter, the cusp (first point) moves from above the centre to its right.
    expect(up[0].y).toBeLessThan(0);
    expect(side[0].x).toBeGreaterThan(0);
    expect(Math.abs(side[0].y)).toBeLessThan(1e-9);
  });
});

function flatten(points: readonly Pt[]): number[] {
  return points.flatMap((p) => [p.x, p.y, 0.5]);
}

// --- Arcs ---------------------------------------------------------------------

/** An arc as a Pencil stroke: `sweep` degrees from `start`, a pen-down hook. */
function handArc(r: number, start: number, sweep: number, seed: number, squash = 1): number[] {
  return pencilInk(arc(300, 300, r, r * squash, start, sweep, 90), seed, { hook: 7 });
}

describe("held open arcs", () => {
  const cases: Array<[string, number[]]> = [];
  let seed = 100;
  for (const sweep of [60, 90, 135, 180, 240, 290]) {
    for (const start of [-90, 20, 160]) {
      for (const direction of [1, -1]) {
        cases.push([
          `${sweep}° from ${start}°, direction ${direction}`,
          handArc(140, start, direction * sweep, seed++),
        ]);
      }
    }
  }
  for (const r of [40, 300])
    cases.push([`a semicircle of radius ${r}`, handArc(r, 180, 180, seed++)]);
  cases.push(["a slightly flattened half (0.93)", handArc(150, 180, 180, seed++, 0.93)]);

  it.each(cases)("recognises %s", (_name, pts) => {
    expect(recognizeShape(pts, { held: true })?.kind).toBe("arc");
  });

  it("only when held or asked for: a lifted curve stays ink", () => {
    for (const [name, pts] of cases) {
      expect(recognizeShape(pts)?.kind ?? null, name).not.toBe("arc");
      expect(recognizeShape(pts, { arcs: true })?.kind, name).toBe("arc");
    }
  });
});

describe("what is never an arc, held", () => {
  it.each([
    ["a line", ink(segment(100, 200, 500, 210))],
    ["a slightly bowed line", ink(arc(300, 900, 700, 700, 250, 30, 60))],
    ["a V", ink(polyline(100, 100, 200, 300, 300, 100))],
    ["an L", ink(polyline(100, 100, 100, 300, 300, 300))],
    ["a U with square corners", ink(polyline(100, 100, 100, 300, 300, 300, 300, 100))],
    ["a checkmark", ink(polyline(100, 220, 160, 300, 320, 100))],
    ["an S", ink([...arc(200, 180, 70, 70, 20, -250, 48), ...arc(200, 320, 70, 70, 200, 250, 48)])],
    [
      "a spiral",
      ink(
        Array.from({ length: 241 }, (_, i) => {
          const t = i / 240;
          const a = 2 * Math.PI * 2.5 * t;
          const r = 18 + 152 * t;
          return { x: 300 + r * Math.cos(a), y: 300 + r * Math.sin(a) };
        }),
      ),
    ],
    ["a circle that did not quite close (325°)", ink(arc(300, 300, 150, 150, 0, 325, 120))],
    ["a written c (small)", ink(arc(300, 300, 12, 12, 40, 280, 40))],
  ] as Array<[string, number[]]>)("does not take %s", (_name, pts) => {
    expect(kinds(pts, true)).not.toContain("arc");
  });

  it("never reads a real squiggle of handwriting as an arc", () => {
    const strokes = (
      JSON.parse(readFileSync("tests/ink/fixtures/real-handwriting-squiggles.json", "utf8")) as {
        strokes: Array<{ pts: number[] }>;
      }
    ).strokes;
    for (const s of strokes) expect(kinds(s.pts, true)).not.toContain("arc");
  });
});

describe("emitted arc geometry", () => {
  /** Turn, start angle and radius of an emitted arc. */
  function shape(pts: readonly number[]): { sweep: number; start: number; end: number; r: number } {
    const p = xy(pts);
    const fit = R.fitArcCircle(p);
    if (!fit) throw new Error("no circle");
    const { sweep } = R.openSweep(p, fit.cx, fit.cy);
    const angle = (q: Pt): number => (Math.atan2(q.y - fit.cy, q.x - fit.cx) * 180) / Math.PI;
    return {
      sweep: (sweep * 180) / Math.PI,
      start: angle(p[0]),
      end: angle(p[p.length - 1]),
      r: fit.r,
    };
  }

  it("makes a near-half an exact semicircle, its diameter level when nearly so", () => {
    const result = recognizeShape(handArc(150, 184, 168, 7), { held: true });
    expect(result?.kind).toBe("arc");
    const s = shape(result?.pts ?? []);
    expect(Math.abs(s.sweep)).toBeCloseTo(180, 0);
    expect(Math.abs(Math.abs(s.start) - 180)).toBeLessThan(0.5);
    expect(Math.abs(s.end)).toBeLessThan(0.5);
    expect(s.r).toBeGreaterThan(140);
    expect(s.r).toBeLessThan(160);
  });

  it("makes a near-quarter an exact quarter, and keeps a turn that is neither", () => {
    const quarter = shape(recognizeShape(handArc(150, -88, 99, 8), { held: true })?.pts ?? []);
    expect(Math.abs(quarter.sweep)).toBeCloseTo(90, 0);
    const odd = shape(recognizeShape(handArc(150, 10, 130, 9), { held: true })?.pts ?? []);
    expect(Math.abs(odd.sweep)).toBeGreaterThan(120);
    expect(Math.abs(odd.sweep)).toBeLessThan(140);
  });

  it("goes the way the pen went, from where it started", () => {
    const drawn = handArc(150, 30, -140, 10);
    const s = shape(recognizeShape(drawn, { held: true })?.pts ?? []);
    expect(s.sweep).toBeLessThan(0);
    const first = xy(drawn)[0];
    const out = xy(recognizeShape(drawn, { held: true })?.pts ?? []);
    expect(Math.hypot(out[0].x - first.x, out[0].y - first.y)).toBeLessThan(25);
  });

  it("survives quantization, and reads as itself again", () => {
    const pts = recognizeShape(handArc(150, 180, 175, 11), { held: true })?.pts ?? [];
    expect(dequantizePts(quantizePts(pts))).toEqual(pts);
    // Re-fitting moves a point by at most a rounding step or two, never more.
    const again = recognizeShape(pts, { held: true });
    expect(again?.kind).toBe("arc");
    expect(again?.pts).toHaveLength(pts.length);
    again?.pts.forEach((v, i) => expect(Math.abs(v - pts[i])).toBeLessThanOrEqual(0.03));
  });

  it("arcPoints puts a sample at least every 5.625° and the ends exactly", () => {
    const pts = arcPoints(0, 0, 100, 0, Math.PI / 2);
    expect(pts).toHaveLength(17);
    expect(pts[16].x).toBeCloseTo(0, 9);
    expect(pts[16].y).toBeCloseTo(100, 9);
  });
});

// --- Sectors ------------------------------------------------------------------

describe("held sectors and semicircles", () => {
  const cases: Array<[string, number[]]> = [];
  let seed = 200;
  for (const sweep of [60, 90, 120, 180, 270]) {
    for (const begin of ["centre", "arc", "middle"] as const) {
      for (const direction of [1, -1]) {
        for (const r of [70, 180]) {
          cases.push([
            `${sweep}° from the ${begin}, direction ${direction}, radius ${r}`,
            pencilInk(
              handSector(300, 300, r, -90 + 37 * (seed % 5), direction * sweep, begin),
              seed++,
              {
                hook: 6,
              },
            ),
          ]);
        }
      }
    }
  }

  it.each(cases)("recognises %s", (_name, pts) => {
    expect(recognizeShape(pts, { held: true })?.kind).toBe("sector");
  });

  it("only when held or asked for", () => {
    for (const [name, pts] of cases) {
      expect(recognizeShape(pts)?.kind ?? null, name).not.toBe("sector");
      expect(recognizeShape(pts, { arcs: true })?.kind, name).toBe("sector");
    }
  });

  it("leaves a slice narrower than 50° to the triangle it nearly is", () => {
    const pts = pencilInk(handSector(300, 300, 200, -90, 40), 7);
    expect(recognizeShape(pts, { held: true })?.kind).toBe("triangle");
  });
});

/** Corners cut `times` times (Chaikin): a polygon drawn with rounded corners. */
function rounded(poly: Pt[], times: number): Pt[] {
  let p = poly.slice(0, -1);
  for (let t = 0; t < times; t++) {
    const next: Pt[] = [];
    p.forEach((a, i) => {
      const b = p[(i + 1) % p.length];
      next.push({ x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y });
      next.push({ x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y });
    });
    p = next;
  }
  return [...p, p[0]];
}

describe("what is never a sector, held", () => {
  it("no real stroke reads any differently held than lifted, but for arrows", () => {
    // Arrows: a hold lowers the retrace floor (RETRACE_HELD_MIN_PX), as before.
    for (const [name, pts] of realStreams()) {
      if (name.startsWith("real arrow")) continue;
      expect(recognizeShape(pts, { held: true })?.kind ?? null, name).toBe(
        recognizeShape(pts)?.kind ?? null,
      );
    }
  }, 30_000);

  it.each([
    ["an equilateral triangle", ink(regularPolygon(300, 300, 150, 3))],
    ["a right triangle", ink(polyline(100, 100, 100, 400, 400, 400, 100, 100))],
    [
      "a right triangle, corners rounded",
      ink(rounded(polyline(100, 100, 100, 400, 400, 400, 100, 100), 2)),
    ],
    [
      "a right triangle, corners rounded more",
      ink(rounded(polyline(100, 100, 100, 400, 400, 400, 100, 100), 3)),
    ],
    ["an equilateral triangle, corners rounded", ink(rounded(regularPolygon(300, 300, 150, 3), 2))],
    ["a square, corners rounded", ink(rounded(rectangle(100, 100, 250, 250), 2))],
    ["a tall isosceles triangle", ink(polyline(300, 100, 380, 420, 220, 420, 300, 100))],
    [
      "a triangle with one bowed side",
      ink([
        ...polyline(300, 100, 420, 400),
        ...arc(300, 640, 300, 300, -66, -48, 30),
        { x: 300, y: 100 },
      ]),
    ],
    ["a rectangle", ink(rectangle(100, 100, 300, 180))],
    ["a circle", ink(arc(300, 300, 140, 140))],
    ["an ellipse", ink(arc(300, 300, 160, 90))],
    [
      "a stadium",
      ink([
        ...arc(200, 300, 80, 80, 90, 180, 40),
        ...arc(400, 300, 80, 80, 270, 180, 40),
        { x: 200, y: 380 },
      ]),
    ],
    [
      "a lens (two arcs)",
      ink([...arc(300, 200, 200, 200, 60, 60, 40), ...arc(300, 400, 200, 200, 240, 60, 40)]),
    ],
  ] as Array<[string, number[]]>)("does not take %s", (_name, pts) => {
    expect(kinds(pts, true)).not.toContain("sector");
  });
});

describe("emitted sector geometry", () => {
  it("snaps a near-quarter slice to an exact quarter with level and upright radii", () => {
    const drawn = pencilInk(handSector(300, 300, 150, -3, 86), 21, { hook: 6 });
    const result = recognizeShape(drawn, { held: true });
    expect(result?.kind).toBe("sector");
    const p = xy(result?.pts ?? []);
    expect(p[0]).toEqual(p[p.length - 1]);
    // The centre is the vertex with two straight neighbours; find it as the
    // point farthest from the arc's own circle... simpler: the drawn centre.
    const centre = p.reduce((best, q) =>
      Math.hypot(q.x - 300, q.y - 300) < Math.hypot(best.x - 300, best.y - 300) ? q : best,
    );
    const ends = p.filter((q) => Math.abs(Math.hypot(q.x - centre.x, q.y - centre.y) - 150) < 15);
    const angles = ends.map((q) => (Math.atan2(q.y - centre.y, q.x - centre.x) * 180) / Math.PI);
    expect(Math.min(...angles)).toBeCloseTo(0, 1);
    expect(Math.max(...angles)).toBeCloseTo(90, 1);
  });

  it("makes a D an exact semicircle closed by its diameter", () => {
    const d = ink([...segment(200, 120, 200, 420), ...arc(200, 270, 150, 150, 90, -180, 60)]);
    const result = recognizeShape(d, { held: true });
    expect(result?.kind).toBe("sector");
    const p = xy(result?.pts ?? []);
    const xs = p.map((q) => q.x);
    // Diameter upright at x ≈ 200, bulging 150 to the right.
    expect(Math.min(...xs)).toBeCloseTo(Math.max(...xs) - 150, -1);
    const onDiameter = p.filter((q) => Math.abs(q.x - Math.min(...xs)) < 0.01);
    expect(onDiameter.length).toBeGreaterThanOrEqual(3);
  });

  it("survives quantization, and reads as itself again", () => {
    const pts =
      recognizeShape(pencilInk(handSector(300, 300, 150, 10, 120), 22), { held: true })?.pts ?? [];
    expect(pts.length).toBeGreaterThan(0);
    expect(dequantizePts(quantizePts(pts))).toEqual(pts);
    const again = recognizeShape(pts, { held: true });
    expect(again?.kind).toBe("sector");
    expect(again?.confidence).toBeGreaterThan(0.95);
  });

  it("sectorPoints runs centre, arc, centre", () => {
    const pts = sectorPoints(0, 0, 100, 0, Math.PI / 2);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 0, y: 0 });
    expect(pts[1].x).toBeCloseTo(100, 9);
    expect(pts[pts.length - 2].y).toBeCloseTo(100, 9);
  });
});
