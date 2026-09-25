/**
 * Adversarial tests for `src/ink/shape-recognizer.ts` (contracts/api.md §2).
 *
 * The bar this suite tries to clear: **a wrong snap is worse than no snap.**
 * So the false-positive block is the important half — every shape in it is one
 * a person really draws and must never be silently replaced by a line, a box,
 * a circle or an arrow.
 *
 * Synthetic ink comes from `./ink-synth`, which models hand tremor as
 * low-frequency sinusoids plus sub-pixel noise. That is not a stylistic
 * choice: CLAUDE.md records a session lost to per-sample white noise inflating
 * path length ~2x and tripping the detour gate, which made the recognizer look
 * broken when the generator was.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { explainShape, recognizeAtZoom, recognizeShape } from "../../src/ink/shape-recognizer";
import { SNAP_MIN_CONFIDENCE } from "../../src/constants";
import type { InkDocument } from "../../src/model/document";
import { dequantizePts, quantizePts } from "../../src/model/serialize";
import {
  type Pt,
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
  rotate,
  segment,
  tremor,
} from "./ink-synth";

// --- Shapes a recognizer has no business recognizing ----------------------

function sine(x0: number, y0: number, width: number, amp: number, cycles: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= 200; i++) {
    const t = i / 200;
    out.push({ x: x0 + width * t, y: y0 + amp * Math.sin(2 * Math.PI * cycles * t) });
  }
  return out;
}

function spiral(cx: number, cy: number, r0: number, r1: number, turns: number): Pt[] {
  const out: Pt[] = [];
  const steps = 240;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = 2 * Math.PI * turns * t;
    const r = r0 + (r1 - r0) * t;
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return out;
}

function star(cx: number, cy: number, outer: number, inner: number, points = 5): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= points * 2; i++) {
    const a = ((-90 + (360 * i) / (points * 2)) * Math.PI) / 180;
    out.push({
      x: cx + (i % 2 === 0 ? outer : inner) * Math.cos(a),
      y: cy + (i % 2 === 0 ? outer : inner) * Math.sin(a),
    });
  }
  return out;
}

function heart(cx: number, cy: number, s: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= 160; i++) {
    const t = (i / 160) * 2 * Math.PI;
    out.push({
      x: cx + s * 16 * Math.sin(t) ** 3,
      y: cy - s * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)),
    });
  }
  return out;
}

function cursive(x0: number, y0: number, loops: number): Pt[] {
  const out: Pt[] = [];
  for (let l = 0; l < loops; l++) {
    for (let i = 0; i <= 60; i++) {
      const t = (i / 60) * 2 * Math.PI;
      out.push({
        x: x0 + l * 70 + 34 * Math.sin(t),
        y: y0 - 30 * (1 - Math.cos(t)) - 20 * Math.sin(t),
      });
    }
  }
  return out;
}

function scribble(x0: number, y0: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= 400; i++) {
    const t = i / 400;
    out.push({
      x: x0 + 320 * t + 26 * Math.sin(26 * t),
      y: y0 + 34 * Math.sin(17 * t) + 14 * Math.cos(41 * t),
    });
  }
  return out;
}

// --- Pencil artefacts -------------------------------------------------------
//
// Read from an iPad screen recording (2026-09-21): every real stroke has a
// short hook where the Pencil lands and sets off, and a closed shape runs on
// past its start. Neither is tremor, and neither was in this suite while the
// recogniser scored 0 for 20 on the device.

/** A pen-down tail `len` px long, heading off at `deg`, before the shape. */
function hook(points: Pt[], len: number, deg: number): Pt[] {
  const p0 = points[0];
  const a = (deg * Math.PI) / 180;
  const tail: Pt[] = [];
  for (let i = 5; i >= 1; i--) {
    const t = i / 5;
    tail.push({ x: p0.x + len * t * Math.cos(a), y: p0.y + len * t * Math.sin(a) });
  }
  return [...tail, ...points];
}

/** ~1 px spacing, as 240 Hz Pencil samples arrive. */
function dense(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y)));
    for (let k = 0; k < n; k++) {
      out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * The backend agent's original 27 adversarial shapes, less the six that are
 * now positives (hold-to-snap straightens triangles and other polygons and
 * fits ovals, 2026-09-21), the two that are now known limits (an octagon and
 * a stadium-like rounded rect read as round; see `known limits` below), and
 * the five-pointed star, which is a positive since 2026-09-22: Joost asked
 * for stars. It sat here as the case that proved the fitters did not mistake
 * a star for anything else; it now snaps to `star` (see `positives`), and
 * the shapes that must still never read as one — a decagon, a flower, other
 * star polygons — are in shape-recognizer-star-arrow.test.ts.
 */
const adversarial: Array<[string, number[]]> = [
  ["a V", inkFrom(polyline(100, 100, 200, 300, 300, 100), 1)],
  ["an L", inkFrom(polyline(100, 100, 100, 300, 300, 300), 2)],
  ["a Z", inkFrom(polyline(100, 100, 320, 100, 100, 260, 320, 260), 3)],
  ["an N", inkFrom(polyline(100, 320, 100, 100, 260, 320, 260, 100), 4)],
  ["a U", inkFrom(polyline(100, 100, 100, 300, 300, 300, 300, 100), 5)],
  [
    "an S",
    inkFrom([...arc(200, 180, 70, 70, 20, -250, 48), ...arc(200, 320, 70, 70, 200, 250, 48)], 6),
  ],
  ["a C (240 degrees of arc)", inkFrom(arc(300, 300, 150, 150, 60, 240, 80), 7)],
  ["a D", inkFrom([...segment(200, 120, 200, 420), ...arc(200, 270, 150, 150, 90, -180, 60)], 9)],
  ["a spiral", inkFrom(spiral(300, 300, 18, 170, 2.5), 15)],
  [
    "a double loop",
    inkFrom([...arc(300, 300, 140, 140, 0, 360, 96), ...arc(300, 300, 140, 140, 0, 360, 96)], 16),
  ],
  ["a heart", inkFrom(heart(300, 300, 12), 17)],
  ["a sine wave", inkFrom(sine(100, 300, 420, 35, 3), 18)],
  [
    "a lightning bolt",
    inkFrom(polyline(240, 100, 160, 250, 250, 250, 170, 420, 300, 240, 220, 240, 280, 100), 19),
  ],
  ["cursive loops", inkFrom(cursive(120, 300, 4), 20)],
  [
    "a one-barb arrow",
    inkFrom(arrowOutline({ x: 120, y: 300 }, { x: 460, y: 300 }, 0.22, 28, 1), 21),
  ],
  ["a scribbled word", inkFrom(scribble(120, 300), 26)],
  ["a checkmark", inkFrom(polyline(100, 220, 160, 300, 320, 100), 27)],
  ["a retraced line (out and straight back)", inkFrom(polyline(120, 200, 420, 210, 120, 200), 28)],
];

describe("recognizeShape refuses shapes that are not a snappable kind", () => {
  it("covers the full adversarial set", () => {
    // 18 since the star became a positive (2026-09-22, see above).
    expect(adversarial).toHaveLength(18);
  });

  it.each(adversarial)("returns null for %s", (_name, pts) => {
    expect(recognizeShape(pts)).toBeNull();
  });

  it("refuses them structurally: no fitter produces a candidate at any confidence", () => {
    // The confidence floor is not what keeps these out — the fitters' gates
    // (corner sharpness, sweep, closure, barbs) are. That is what lets the
    // floor be set by how sloppy a real shape may be, not by these.
    for (const [name, pts] of adversarial) {
      expect(explainShape(pts).candidates, name).toEqual([]);
    }
  });
});

describe("known limits: regular polygons and stadium shapes read as round", () => {
  // The circle gate is a corner test on a 5%-of-diagonal RDP of the loop,
  // capped at 75° (a square turns 90°). Real Pencil circles measure up to 62°
  // there — the chord angle at that tolerance — so the cap cannot come down to
  // a pentagon's 72° or an octagon's 45° without refusing real circles, which
  // the 42° cap of 0.1.8 did, every one of them. With polygon fitting on, the
  // pentagon and hexagon are straightened instead (see `positives`).
  it.each([
    ["an octagon", inkFrom(regularPolygon(300, 300, 160, 8), 13), "circle"],
    [
      "a pentagon, with polygon fitting off",
      inkFrom(regularPolygon(300, 300, 160, 5), 11),
      "circle",
    ],
    [
      "a hexagon, with polygon fitting off",
      inkFrom(regularPolygon(300, 300, 160, 6), 12),
      "circle",
    ],
    [
      "a heavily rounded rect (r = 40% of the short side)",
      inkFrom(roundedRectish(100, 120, 400, 300, 120), 23),
      "ellipse",
    ],
  ])("%s reads as round", (_name, pts, kind) => {
    expect(recognizeShape(pts)?.kind).toBe(kind);
  });

  it("a rect with corners rounded up to 20% of the short side is still a rect", () => {
    expect(recognizeShape(inkFrom(roundedRectish(100, 120, 400, 300, 60), 71))?.kind).toBe("rect");
  });
});

// --- Shapes it is actually for --------------------------------------------

/**
 * Polygon fitting is opt-in (see `RecognizeOptions.polygons`); the positive
 * suites run with it on so the fitter stays exercised, and a block below pins
 * that the default refuses what it would have accepted.
 */
const ALL = { polygons: true } as const;

const positives: Array<[string, number[], string]> = [
  ["a clean horizontal line", inkFrom(segment(100, 200, 500, 200), 40, { clean: true }), "line"],
  ["a hand-drawn horizontal line", inkFrom(segment(100, 200, 500, 200), 41), "line"],
  ["a hand-drawn vertical line", inkFrom(segment(200, 100, 200, 520), 42), "line"],
  ["a 45-degree line", inkFrom(segment(100, 100, 420, 420), 43), "line"],
  ["a shallow-angle line", inkFrom(segment(100, 400, 500, 170), 44), "line"],
  ["a line barely over the 24px minimum", inkFrom(segment(100, 100, 130, 122), 45), "line"],
  ["a small circle", inkFrom(arc(200, 200, 60, 60), 46), "circle"],
  ["a large circle", inkFrom(arc(400, 400, 250, 250), 47), "circle"],
  ["a counter-clockwise circle", inkFrom(arc(300, 300, 150, 150, 0, -360, 96), 48), "circle"],
  ["a circle started at the bottom", inkFrom(arc(300, 300, 150, 150, 90, 360, 96), 49), "circle"],
  [
    "a 1.15:1 loop (close enough to round to stay a circle)",
    inkFrom(arc(300, 300, 150, 172, 0, 360, 96), 50),
    "circle",
  ],
  [
    "a circle with heavier tremor",
    inkFrom(arc(300, 300, 150, 150), 51, { amplitude: 2 }),
    "circle",
  ],
  ["an axis-aligned rectangle", inkFrom(rectangle(100, 100, 400, 260), 52), "rect"],
  [
    "a rectangle 4 degrees off axis",
    inkFrom(rotate(rectangle(100, 100, 400, 260), 4, 300, 230), 53),
    "rect",
  ],
  [
    "a rectangle 20 degrees off axis",
    inkFrom(rotate(rectangle(100, 100, 400, 260), 20, 300, 230), 54),
    "rect",
  ],
  [
    "a rectangle 45 degrees off axis",
    inkFrom(rotate(rectangle(100, 100, 400, 260), 45, 300, 230), 55),
    "rect",
  ],
  ["a tall narrow rectangle", inkFrom(rectangle(200, 100, 140, 460), 56), "rect"],
  ["a sloppy rectangle", inkFrom(rectangle(100, 100, 400, 260), 57, { amplitude: 5 }), "rect"],
  [
    "a rectangle with lightly rounded corners",
    inkFrom(roundedRectish(100, 120, 400, 300, 24), 70),
    "rect",
  ],
  [
    "an arrow pointing right",
    inkFrom(arrowOutline({ x: 100, y: 300 }, { x: 500, y: 300 }), 58),
    "arrow",
  ],
  [
    "an arrow pointing left",
    inkFrom(arrowOutline({ x: 500, y: 300 }, { x: 100, y: 300 }), 59),
    "arrow",
  ],
  [
    "an arrow pointing up",
    inkFrom(arrowOutline({ x: 300, y: 500 }, { x: 300, y: 120 }), 60),
    "arrow",
  ],
  ["a diagonal arrow", inkFrom(arrowOutline({ x: 120, y: 120 }, { x: 460, y: 420 }), 61), "arrow"],
  [
    "a clean arrow",
    inkFrom(arrowOutline({ x: 100, y: 300 }, { x: 500, y: 300 }), 62, { clean: true }),
    "arrow",
  ],
  ["a short arrow", inkFrom(arrowOutline({ x: 100, y: 300 }, { x: 220, y: 300 }), 63), "arrow"],
  ["a tall O (2.1:1)", inkFrom(arc(300, 300, 90, 190, 0, 360, 96), 8), "ellipse"],
  ["a 1.35:1 oval", inkFrom(arc(300, 300, 150, 202, 0, 360, 96), 67), "ellipse"],
  ["a wide flat oval (3:1)", inkFrom(arc(300, 300, 210, 70, 0, 360, 96), 101), "ellipse"],
  [
    "a tilted oval",
    inkFrom(rotate(arc(300, 300, 200, 110, 0, 360, 96), 30, 300, 300), 102),
    "ellipse",
  ],
  ["a triangle", inkFrom(regularPolygon(300, 300, 160, 3), 10), "triangle"],
  ["a small triangle", inkFrom(regularPolygon(300, 300, 60, 3), 31), "triangle"],
  [
    "a sloppy triangle",
    inkFrom(regularPolygon(300, 300, 160, 3), 103, { amplitude: 4 }),
    "triangle",
  ],
  ["a right triangle", inkFrom(polyline(120, 120, 120, 420, 460, 420, 120, 120), 104), "triangle"],
  ["a diamond", inkFrom(polyline(300, 100, 450, 300, 300, 500, 150, 300, 300, 100), 33), "diamond"],
  ["a pentagon", inkFrom(regularPolygon(300, 300, 160, 5), 11), "polygon"],
  ["a hexagon", inkFrom(regularPolygon(300, 300, 160, 6), 12), "polygon"],
  [
    "a parallelogram",
    inkFrom(polyline(140, 380, 260, 140, 500, 140, 380, 380, 140, 380), 24),
    "polygon",
  ],
  [
    "a trapezoid",
    inkFrom(polyline(120, 380, 210, 160, 370, 160, 460, 380, 120, 380), 25),
    "polygon",
  ],
  // Pencil artefacts, see `hook` above. Sizes are the recording's: ~80 px.
  [
    "a circle overshooting its start by 40°",
    inkFrom(arc(300, 300, 80, 80, 0, 400, 110), 301),
    "circle",
  ],
  [
    "a circle with a 12 px pen-down hook",
    inkFrom(hook(arc(300, 300, 80, 80, 0, 360, 96), 12, 200), 302),
    "circle",
  ],
  [
    "a circle with a hook and an overshoot",
    inkFrom(hook(arc(300, 300, 80, 80, 0, 400, 110), 12, 200), 303),
    "circle",
  ],
  [
    "a circle with a hook and an overshoot, at Pencil sample density",
    inkFrom(dense(hook(arc(300, 300, 80, 80, 0, 400, 110), 12, 200)), 304, { spacing: 1 }),
    "circle",
  ],
  [
    "a rect with a 12 px pen-down hook",
    inkFrom(hook(rectangle(100, 100, 160, 120), 12, 225), 305),
    "rect",
  ],
  [
    "a rect overshooting its start by 30 px",
    inkFrom([...rectangle(100, 100, 160, 120), { x: 130, y: 100 }], 306),
    "rect",
  ],
  [
    "a rect with a hook and an overshoot",
    inkFrom(hook([...rectangle(100, 100, 160, 120), { x: 130, y: 100 }], 12, 225), 307),
    "rect",
  ],
  ["a line with a pen-down hook", inkFrom(hook(segment(100, 200, 400, 200), 10, 250), 308), "line"],
  [
    "an oval with a hook and an overshoot",
    inkFrom(hook(arc(300, 300, 120, 70, 0, 400, 110), 12, 200), 309),
    "ellipse",
  ],
  // Stars (2026-09-22). The first is the stroke that was the adversarial
  // "five-pointed star" until stars were asked for.
  ["a five-pointed star", inkFrom(star(300, 300, 170, 70), 14), "star"],
  [
    "a hand-drawn star with a hook and an overshoot, at Pencil density",
    pencilInk(
      handStar(
        300,
        300,
        130,
        { ratio: 0.45, radiusJitter: 0.08, angleJitter: 5, round: 3, overshoot: 0.12 },
        310,
      ),
      310,
      { hook: 12 },
    ),
    "star",
  ],
  [
    "a one-stroke pentagram with a hook and an overshoot",
    pencilInk(
      handPentagram(
        300,
        300,
        140,
        { radiusJitter: 0.06, angleJitter: 4, round: 3, overshoot: 0.1 },
        311,
      ),
      311,
      { hook: 12 },
    ),
    "star",
  ],
  // Apple Notes' arrow: a line, then back a little way along it.
  [
    "a line retraced a third of the way back",
    retracedLine({ x: 100, y: 300 }, 300, 0, { hook: [12, 200], retrace: [0.33, 3, 2] }, 312),
    "arrow",
  ],
];

describe("by default, only the basic shapes snap", () => {
  // Triangles count as basic since 2026-09-21 (Joost: squares, triangles and
  // lines first); skewed quads, pentagons and hexagons stay opt-in.
  const polygonKinds = new Set(["diamond", "polygon"]);
  // A diamond is a square standing on a corner, so the rect fitter takes it;
  // the pentagon and hexagon are the known limits above.
  const readsAsBasic = new Set(["a diamond", "a pentagon", "a hexagon"]);

  it.each(positives.filter(([, , kind]) => kind === "triangle"))(
    "recognises %s without opting in",
    (_name, pts) => {
      expect(recognizeShape(pts)?.kind).toBe("triangle");
    },
  );

  it.each(positives.filter(([name, , kind]) => polygonKinds.has(kind) && !readsAsBasic.has(name)))(
    "refuses %s rather than guessing",
    (_name, pts) => {
      expect(recognizeShape(pts)).toBeNull();
    },
  );

  it("squares up a diamond as a rect standing on its corner", () => {
    const diamond = positives.find(([name]) => name === "a diamond")!;
    expect(recognizeShape(diamond[1])?.kind).toBe("rect");
  });

  it.each(positives.filter(([, , kind]) => !polygonKinds.has(kind)))(
    "still recognises %s",
    (_name, pts, kind) => {
      expect(recognizeShape(pts)?.kind).toBe(kind);
    },
  );

  it("never turns a sloppy square into a parallelogram", () => {
    // On the iPad a square drawn with corners well off 90° came back as a
    // skewed "polygon". With polygons off it is a rect or nothing.
    for (const seed of [201, 202, 203, 204]) {
      const result = recognizeShape(inkFrom(rectangle(100, 100, 300, 300), seed, { amplitude: 6 }));
      if (result) expect(result.kind).toBe("rect");
    }
  });
});

// --- Real Pencil ink --------------------------------------------------------

/**
 * Ink traced out of an iPad screen recording of GoodObsidian 0.1.7, where
 * none of it snapped: contours of the ink at the recording's 1.909 device px
 * per page px, so the geometry is the user's but the sample order is not.
 * `pencilStream` puts the order back the way a Pencil delivers it: starting
 * anywhere on the loop, a pen-down hook, an overshoot past the start, hand
 * tremor, and the stroke builder's 1.4 px spacing.
 */
interface RealStroke {
  id: number;
  expect: string;
  desc: string;
  closed: boolean;
  points: number[][];
}
const realInk = (
  JSON.parse(readFileSync("tests/ink/fixtures/real-pencil-ipad.json", "utf8")) as {
    strokes: RealStroke[];
  }
).strokes;

function asTraced(stroke: RealStroke): number[] {
  const flat: number[] = [];
  for (const [x, y] of stroke.points) flat.push(x, y, 0.5);
  return flat;
}

function pencilStream(stroke: RealStroke, startFraction: number, seed: number): number[] {
  const loop = stroke.points.map(([x, y]) => ({ x, y }));
  let base: Pt[] = loop;
  if (stroke.closed) {
    const open = loop.slice(0, -1);
    const start = Math.floor(open.length * startFraction);
    const rotated = open.slice(start).concat(open.slice(0, start));
    const overshoot = rotated.slice(0, Math.floor(rotated.length * 0.12));
    base = [...rotated, rotated[0], ...overshoot];
  }
  const rand = rng(seed);
  const hooked = hook(base, 8 + rand() * 6, 150 + rand() * 120);
  const drawn = tremor(resample(hooked, 1.4), rand, { amplitude: 1.1 });
  const flat: number[] = [];
  for (const p of drawn) flat.push(p.x, p.y, 0.45 + rand() * 0.2);
  return flat;
}

const STARTS = [0, 0.2, 0.4, 0.6, 0.8];
const SEEDS = [1, 2, 3];
const roundKinds = new Set(["circle", "ellipse"]);

describe("ink drawn zoomed in (Joost's recording, 2026-09-24)", () => {
  // The same hand movement at 5x zoom is a fifth the size in page px.
  const ZOOM = 5;
  const shrink = (pts: number[]): number[] => pts.map((v, i) => (i % 3 === 2 ? v : v / ZOOM));
  const basic = realInk.filter(
    (s) => (s.expect === "circle" || s.expect === "rect" || s.expect === "line") && s.id !== 10,
  );
  const accepts = (stroke: RealStroke, kind: string | undefined): boolean =>
    stroke.expect === "circle" ? roundKinds.has(kind ?? "") : kind === stroke.expect;

  it("was refused by the page-px recogniser (the bug)", () => {
    let refused = 0;
    for (const stroke of basic) {
      for (const seed of SEEDS) {
        const result = recognizeShape(shrink(pencilStream(stroke, 0, seed)));
        if (!accepts(stroke, result?.kind)) refused++;
      }
    }
    expect(refused).toBeGreaterThan(0);
  });

  it.each(basic.map((s) => [s.desc, s] as const))(
    "recognises %s drawn at 5x, as small on the page as it was drawn",
    (_desc, stroke) => {
      for (const start of STARTS) {
        for (const seed of SEEDS) {
          const stream = pencilStream(stroke, start, seed);
          const zoomed = recognizeAtZoom(shrink(stream), ZOOM);
          expect(accepts(stroke, zoomed?.kind), `start ${start} seed ${seed}`).toBe(true);
          // Exactly the fit-zoom result, a fifth the size.
          const plain = recognizeShape(stream)!;
          expect(zoomed!.kind).toBe(plain.kind);
          expect(zoomed!.pts.length).toBe(plain.pts.length);
          zoomed!.pts.forEach((v, i) => {
            expect(v).toBeCloseTo(i % 3 === 2 ? plain.pts[i] : plain.pts[i] / ZOOM, 6);
          });
        }
      }
    },
  );

  it("is recognizeShape itself at fit zoom, or for a zoom that makes no sense", () => {
    const stream = pencilStream(basic[0], 0, 1);
    const plain = recognizeShape(stream);
    for (const zoom of [1, 0, -2, Number.NaN, Infinity]) {
      expect(recognizeAtZoom(stream, zoom)).toEqual(plain);
    }
  });
});

describe("real Pencil ink from the iPad recording (2026-09-21)", () => {
  const byExpect = (kind: string): RealStroke[] => realInk.filter((s) => s.expect === kind);
  const basic = [...byExpect("circle"), ...byExpect("rect"), ...byExpect("line")].filter(
    (s) => s.id !== 10, // an open loop the tracer could not order; not asserted
  );
  const accepts = (stroke: RealStroke, kind: string | undefined): boolean =>
    stroke.expect === "circle" ? roundKinds.has(kind ?? "") : kind === stroke.expect;

  it("carries the recording's basic shapes", () => {
    expect(basic.map((s) => s.expect).sort()).toEqual(["circle", "circle", "line", "rect", "rect"]);
  });

  it.each(basic.map((s) => [s.desc, s] as const))("recognises %s as traced", (_desc, stroke) => {
    const result = recognizeShape(asTraced(stroke));
    expect(accepts(stroke, result?.kind), `got ${result?.kind ?? "null"}`).toBe(true);
  });

  it.each(basic.map((s) => [s.desc, s] as const))(
    "recognises %s from every Pencil-like stream (any start, hook, overshoot, tremor)",
    (_desc, stroke) => {
      for (const start of STARTS) {
        for (const seed of SEEDS) {
          const result = recognizeShape(pencilStream(stroke, start, seed));
          expect(
            accepts(stroke, result?.kind),
            `start ${start} seed ${seed}: got ${result?.kind ?? "null"}`,
          ).toBe(true);
          expect(result!.confidence, `start ${start} seed ${seed}`).toBeGreaterThanOrEqual(
            SNAP_MIN_CONFIDENCE + 0.05,
          );
        }
      }
    },
  );

  it.each(
    byExpect("triangle")
      .filter((s) => s.id === 5 || s.id === 7)
      .map((s) => [s.desc, s] as const),
  )("straightens %s into a triangle, by default, from every stream", (_desc, stroke) => {
    expect(recognizeShape(asTraced(stroke))?.kind).toBe("triangle");
    for (const start of STARTS) {
      for (const seed of SEEDS) {
        const stream = pencilStream(stroke, start, seed);
        expect(recognizeShape(stream)?.kind, `start ${start} seed ${seed}`).toBe("triangle");
      }
    }
  });

  it.each(byExpect("none").map((s) => [s.desc, s] as const))(
    "refuses %s, as traced and from every stream",
    (_desc, stroke) => {
      expect(recognizeShape(asTraced(stroke))).toBeNull();
      for (const start of STARTS) {
        for (const seed of SEEDS) {
          expect(
            recognizeShape(pencilStream(stroke, start, seed)),
            `start ${start} seed ${seed}`,
          ).toBeNull();
        }
      }
    },
  );

  it.each(byExpect("hill").map((s) => [s.desc, s] as const))(
    "never squares up %s: a bowed triangle, occasionally an oval, or nothing",
    (_desc, stroke) => {
      // One straight base and one bowed side. With triangles on it may read
      // as a bowed triangle, and at the floor it occasionally reads as an
      // oval — both are documented tolerances. A rect, circle or line is not.
      for (const start of STARTS) {
        for (const seed of SEEDS) {
          const kind = recognizeShape(pencilStream(stroke, start, seed))?.kind ?? "null";
          expect(["null", "triangle", "ellipse"], `start ${start} seed ${seed}: ${kind}`).toContain(
            kind,
          );
        }
      }
    },
  );
});

/**
 * The second recording (2026-09-21 23:32, 0.2.0): every stroke that stayed
 * freehand. These are the sloppy end of the user's hand — a square with one
 * corner swung round and a bulging side, a circle with a spike in it, a
 * trapezoid — traced the same way. They bound what "wiggle room" means.
 */
const realInk2 = (
  JSON.parse(readFileSync("tests/ink/fixtures/real-pencil-ipad-2.json", "utf8")) as {
    strokes: RealStroke[];
  }
).strokes;

describe("the sloppy strokes of the second recording", () => {
  const stroke = (id: number): RealStroke => realInk2.find((s) => s.id === id)!;
  const kindsFrom = (s: RealStroke, opts?: { polygons: boolean }): Set<string> => {
    const kinds = new Set<string>();
    for (const start of STARTS) {
      for (const seed of SEEDS) {
        kinds.add(recognizeShape(pencilStream(s, start, seed), opts)?.kind ?? "null");
      }
    }
    return kinds;
  };

  it("a square with one swung-round corner and a bulging side is only ever a rect", () => {
    const s = stroke(21);
    // The traced loop starts on the swung-round corner, which no rotation
    // of the real stroke would; the rebuilt streams are the fair test.
    const kinds = kindsFrom(s);
    expect(kinds.has("rect")).toBe(true);
    for (const kind of kinds) expect(["rect", "null"]).toContain(kind);
  });

  it("a lumpy circle with a spike in it is a circle as traced", () => {
    expect(["circle", "ellipse"]).toContain(recognizeShape(asTraced(stroke(20)))?.kind);
  });

  it("a sloppy rectangle whose sides converge is a rect or nothing, never round", () => {
    for (const kind of kindsFrom(stroke(18))) expect(["rect", "null"]).toContain(kind);
  });

  it("a skewed quad with a tail is never a rect by default, and a polygon only when opted in", () => {
    for (const kind of kindsFrom(stroke(15))) expect(["null"]).toContain(kind);
    for (const kind of kindsFrom(stroke(15), ALL)) expect(["polygon", "null"]).toContain(kind);
  });

  it("a small rounded square with the pen curling inside is never rounded off or squared up", () => {
    for (const kind of kindsFrom(stroke(19))) expect(["null"]).toContain(kind);
  });
});

describe("recognizeShape snaps the kinds it is for", () => {
  it.each(positives)("recognises %s", (_name, pts, kind) => {
    const result = recognizeShape(pts, ALL);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe(kind);
    expect(result?.confidence).toBeGreaterThanOrEqual(SNAP_MIN_CONFIDENCE);
    expect(result?.confidence).toBeLessThanOrEqual(1);
  });
});

// --- Idempotency ----------------------------------------------------------

describe("recognizeShape is idempotent over its own output", () => {
  it.each(positives)("re-recognising the snapped %s yields the same kind", (_name, pts, kind) => {
    const first = recognizeShape(pts, ALL);
    expect(first).not.toBeNull();
    const second = recognizeShape(first!.pts, ALL);
    expect(second).not.toBeNull();
    expect(second?.kind).toBe(kind);
    // Already-clean geometry must score at least as well as the raw ink, or a
    // save/load cycle through a snapped stroke could un-snap it.
    expect(second!.confidence).toBeGreaterThanOrEqual(first!.confidence);
  });

  it("converges to a fixed point, never drifting more than one quantization step", () => {
    // Re-snapping a snapped shape is not an exact no-op: the fitter re-derives
    // its centre/axis from the emitted points and re-rounds to 1/100 px. What
    // matters is that the error is bounded by that rounding and dies out, so a
    // shape cannot creep across the page over repeated snap/save cycles.
    for (const [name, pts] of positives) {
      const first = recognizeShape(pts, ALL)!.pts;
      let current = first;
      let settledAt = -1;
      for (let pass = 1; pass <= 16; pass++) {
        const next = recognizeShape(current, ALL);
        expect(next, `${name} pass ${pass}`).not.toBeNull();
        expect(next!.pts, `${name} pass ${pass}`).toHaveLength(current.length);
        let step = 0;
        let total = 0;
        for (let i = 0; i < current.length; i++) {
          step = Math.max(step, Math.abs(next!.pts[i] - current[i]));
          total = Math.max(total, Math.abs(next!.pts[i] - first[i]));
        }
        // One pass moves no point by more than a single 1/100 px step...
        expect(step, `${name} step at pass ${pass}`).toBeLessThanOrEqual(0.0101);
        // ...and the drift does not accumulate across passes.
        expect(total, `${name} total drift at pass ${pass}`).toBeLessThanOrEqual(0.0201);
        if (step === 0 && settledAt < 0) settledAt = pass;
        current = next!.pts;
      }
      expect(settledAt, `${name} never settled`).toBeGreaterThan(0);
    }
  });
});

// --- The contract's own fixtures ------------------------------------------

function fixture(name: string): InkDocument {
  return JSON.parse(readFileSync(`contracts/fixtures/${name}.json`, "utf8")) as InkDocument;
}

describe("contracts/fixtures/doc-v2-shapes.json", () => {
  const strokes = fixture("doc-v2-shapes").pages[0].strokes;

  it("carries one stroke of each kind", () => {
    expect(strokes.map((s) => s.shape)).toEqual(["line", "rect", "circle", "arrow"]);
  });

  it.each(strokes.map((s) => [s.shape ?? "?", s.pts] as const))(
    "re-recognises the stored %s as itself",
    (kind, pts) => {
      const result = recognizeShape([...pts]);
      expect(result).not.toBeNull();
      expect(result?.kind).toBe(kind);
    },
  );
});

// --- Emitted geometry: contracts/api.md §2 --------------------------------

describe("emitted geometry matches the contract's per-kind layout", () => {
  const line = recognizeShape(inkFrom(segment(100, 200, 500, 200), 41))!;
  const rect = recognizeShape(inkFrom(rectangle(100, 100, 400, 260), 52))!;
  const circle = recognizeShape(inkFrom(arc(300, 300, 150, 150), 48))!;
  const arrow = recognizeShape(inkFrom(arrowOutline({ x: 100, y: 300 }, { x: 500, y: 300 }), 58))!;

  it("a line is 2 points", () => {
    expect(line.pts).toHaveLength(2 * 3);
  });

  it("a rect is 5 points, closed", () => {
    expect(rect.pts).toHaveLength(5 * 3);
    expect(rect.pts.slice(0, 2)).toEqual(rect.pts.slice(12, 14));
  });

  it("a circle is 33 points sampled every 11.25 degrees, closed", () => {
    expect(circle.pts).toHaveLength(33 * 3);
    expect(circle.pts.slice(0, 2)).toEqual(circle.pts.slice(96, 98));
    // 32 segments around a full turn is 11.25 degrees each.
    const cx = 300;
    const cy = 300;
    const a0 = Math.atan2(circle.pts[1] - cy, circle.pts[0] - cx);
    const a1 = Math.atan2(circle.pts[4] - cy, circle.pts[3] - cx);
    let step = Math.abs(a1 - a0);
    if (step > Math.PI) step = 2 * Math.PI - step;
    expect((step * 180) / Math.PI).toBeCloseTo(11.25, 1);
  });

  it("an arrow is 6 points laid out tail, tip, tip, barb, tip, barb", () => {
    expect(arrow.pts).toHaveLength(6 * 3);
    const tip = arrow.pts.slice(3, 5);
    expect(arrow.pts.slice(6, 8)).toEqual(tip);
    expect(arrow.pts.slice(12, 14)).toEqual(tip);
    // The two barbs sit on opposite sides of the shaft.
    const sideA = arrow.pts[10] - tip[1];
    const sideB = arrow.pts[16] - tip[1];
    expect(Math.sign(sideA)).toBe(-Math.sign(sideB));
  });

  it("pressure is a single constant across every emitted point", () => {
    for (const shape of [line, rect, circle, arrow]) {
      const pressures = new Set<number>();
      for (let i = 2; i < shape.pts.length; i += 3) pressures.add(shape.pts[i]);
      expect(pressures.size).toBe(1);
      const p = [...pressures][0];
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it("emitted geometry survives serialize.ts quantization bit-for-bit", () => {
    // If it did not, every save would nudge a snapped shape off its own grid.
    for (const shape of [line, rect, circle, arrow]) {
      expect(dequantizePts(quantizePts(shape.pts))).toEqual(shape.pts);
    }
  });
});

// --- The three deliberate limits (contracts/api.md §2) --------------------

describe("the arrow head gates", () => {
  const tail = { x: 100, y: 300 };
  const tip = { x: 500, y: 300 };

  /** Angle, in degrees, between a barb and the shaft reversed, as emitted. */
  function emittedHeadDeg(pts: number[]): number {
    const t = { x: pts[3], y: pts[4] };
    const back = { x: pts[0] - t.x, y: pts[1] - t.y };
    const barb = { x: pts[9] - t.x, y: pts[10] - t.y };
    const dot = back.x * barb.x + back.y * barb.y;
    const cross = back.x * barb.y - back.y * barb.x;
    return Math.abs(Math.atan2(cross, dot)) * (180 / Math.PI);
  }

  it("refuses a head so wide it is really a T", () => {
    expect(recognizeShape(inkFrom(arrowOutline(tail, tip, 0.2, 85), 90))).toBeNull();
  });

  it("refuses a head so narrow the barbs lie along the shaft", () => {
    expect(recognizeShape(inkFrom(arrowOutline(tail, tip, 0.2, 5), 91))).toBeNull();
  });

  it("refuses barbs longer than the shaft can justify", () => {
    // Barbs at 60% of the span: the "shaft" is no longer most of the stroke.
    expect(recognizeShape(inkFrom(arrowOutline(tail, tip, 0.6, 30), 92))).toBeNull();
  });

  it("refuses an arrow whose shaft is shorter than the 24px minimum", () => {
    expect(
      recognizeShape(inkFrom(arrowOutline({ x: 100, y: 300 }, { x: 118, y: 300 }, 0.3, 30), 93)),
    ).toBeNull();
  });

  it("opens a tight head out to the minimum emitted angle", () => {
    const result = recognizeShape(inkFrom(arrowOutline(tail, tip, 0.2, 15), 94));
    expect(result?.kind).toBe("arrow");
    expect(emittedHeadDeg(result!.pts)).toBeCloseTo(18, 0);
  });

  it("closes a sprawling head down to the maximum emitted angle", () => {
    const result = recognizeShape(inkFrom(arrowOutline(tail, tip, 0.2, 62), 95));
    expect(result?.kind).toBe("arrow");
    expect(emittedHeadDeg(result!.pts)).toBeCloseTo(45, 0);
  });

  it("leaves a head inside the emit band exactly where it was drawn", () => {
    const result = recognizeShape(inkFrom(arrowOutline(tail, tip, 0.2, 30), 96));
    expect(result?.kind).toBe("arrow");
    expect(emittedHeadDeg(result!.pts)).toBeCloseTo(30, 0);
  });

  it("emits symmetric barbs even when the drawn ones are lopsided", () => {
    const result = recognizeShape(inkFrom(arrowOutline(tail, tip, 0.2, 30), 97));
    const t = { x: result!.pts[3], y: result!.pts[4] };
    const lenA = Math.hypot(result!.pts[9] - t.x, result!.pts[10] - t.y);
    const lenB = Math.hypot(result!.pts[15] - t.x, result!.pts[16] - t.y);
    expect(lenA).toBeCloseTo(lenB, 1);
  });
});

describe("the three deliberate limits", () => {
  it("never snaps a stroke whose bbox diagonal is under 24px", () => {
    // 15 x 10 => diagonal 18, comfortably under the floor.
    expect(recognizeShape(inkFrom(segment(100, 100, 115, 110), 73))).toBeNull();
    expect(recognizeShape(inkFrom(arc(100, 100, 8, 8), 74))).toBeNull();
    // ...but 24px is a floor, not a wall: just above it, a line still snaps.
    expect(recognizeShape(inkFrom(segment(100, 100, 130, 122), 75))?.kind).toBe("line");
  });

  it("fits a 1.35:1 oval as an ellipse rather than circularising it", () => {
    const oval = inkFrom(arc(300, 300, 150, 202, 0, 360, 96), 67);
    const result = recognizeShape(oval);
    expect(result?.kind).toBe("ellipse");
    // The snapped oval keeps the drawn proportions: 150 x 202 semi-axes.
    const xs = result!.pts.filter((_, i) => i % 3 === 0);
    const ys = result!.pts.filter((_, i) => i % 3 === 1);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    expect(width).toBeGreaterThan(280);
    expect(width).toBeLessThan(320);
    expect(height).toBeGreaterThan(384);
    expect(height).toBeLessThan(424);
  });

  it("snaps real mouse-drawn triangles, not only synthetic ones", () => {
    // Two triangles Joost drew in Obsidian on 2026-09-21, decoded from the
    // saved note. Synthetic tremor had let the polygon gates be tuned too
    // tight: these bowed 0.048 and rounded a corner 0.125, and both were
    // refused until the gates were measured against them.
    const real = JSON.parse(
      readFileSync("tests/ink/fixtures/real-mouse-triangles.json", "utf8"),
    ) as number[][];
    expect(real).toHaveLength(2);
    for (const pts of real) expect(recognizeShape(pts, ALL)?.kind).toBe("triangle");
  });

  it("straightens a sloppy triangle's sides so its corners meet sharply", () => {
    const result = recognizeShape(
      inkFrom(regularPolygon(300, 300, 160, 3), 103, { amplitude: 4 }),
      ALL,
    );
    expect(result?.kind).toBe("triangle");
    // Three vertices plus the repeated closing point, each near a true corner.
    expect(result!.pts).toHaveLength(12);
    const truth = [0, 1, 2].map((k) => {
      const a = ((-90 + 120 * k) * Math.PI) / 180;
      return { x: 300 + 160 * Math.cos(a), y: 300 + 160 * Math.sin(a) };
    });
    for (let i = 0; i < 3; i++) {
      const v = { x: result!.pts[i * 3], y: result!.pts[i * 3 + 1] };
      const nearest = Math.min(...truth.map((t) => Math.hypot(t.x - v.x, t.y - v.y)));
      expect(nearest).toBeLessThan(16);
    }
  });

  it("refuses a one-barb arrow at any confidence, because a checkmark is one", () => {
    const oneBarb = inkFrom(arrowOutline({ x: 120, y: 300 }, { x: 460, y: 300 }, 0.22, 28, 1), 21);
    expect(recognizeShape(oneBarb, { minConfidence: 0 })).toBeNull();
  });
});

// --- Options --------------------------------------------------------------

describe("RecognizeOptions", () => {
  const circlePts = inkFrom(arc(300, 300, 150, 150), 48);

  it("minConfidence at 1.01 refuses everything", () => {
    for (const [name, pts] of positives.map(([n, p]) => [n, p] as const)) {
      expect(recognizeShape(pts, { ...ALL, minConfidence: 1.01 }), name).toBeNull();
    }
  });

  it("minConfidence defaults to SNAP_MIN_CONFIDENCE", () => {
    expect(recognizeShape(circlePts)).toEqual(
      recognizeShape(circlePts, { minConfidence: SNAP_MIN_CONFIDENCE }),
    );
  });

  it("closedness is relative to the stroke's own size, not a flat 24px", () => {
    // contracts/api.md §2: closed = gap <= max(closeTolerance, 0.1 * diagonal).
    // A 600px loop left 50px open is closed (0.1 * ~600 = 60 >= 50)...
    const bigGap = inkFrom(arc(400, 400, 300, 300, 0, 350.5, 96), 80);
    expect(recognizeShape(bigGap)?.kind).toBe("circle");
    // ...while the same 50px gap on a 200px loop is not (max(24, 20) = 24).
    const smallGap = inkFrom(arc(300, 300, 100, 100, 0, 331, 96), 81);
    expect(recognizeShape(smallGap)).toBeNull();
    // Raising closeTolerance past the gap closes it again.
    expect(recognizeShape(smallGap, { closeTolerance: 120 })?.kind).toBe("circle");
  });
});

// --- Degenerate and hostile input -----------------------------------------

describe("degenerate input", () => {
  it("returns null for no points", () => {
    expect(recognizeShape([])).toBeNull();
  });

  it("returns null for a single point", () => {
    expect(recognizeShape([10, 10, 0.5])).toBeNull();
  });

  it("tolerates a pts length that is not a multiple of three", () => {
    // A trailing partial point is dropped, not read as a coordinate.
    const full = recognizeShape([100, 100, 0.5, 400, 130, 0.5]);
    const ragged = recognizeShape([100, 100, 0.5, 400, 130, 0.5, 999]);
    expect(ragged?.kind).toBe("line");
    expect(ragged?.pts).toEqual(full?.pts);
    // Two numbers is less than one point.
    expect(recognizeShape([100, 100])).toBeNull();
    expect(recognizeShape([100, 100, 0.5, 400])).toBeNull();
  });

  it("returns null when any coordinate is NaN or infinite", () => {
    expect(recognizeShape([100, 100, 0.5, NaN, 400, 0.5, 400, 400, 0.5])).toBeNull();
    expect(recognizeShape([100, 100, 0.5, Infinity, 400, 0.5, 400, 400, 0.5])).toBeNull();
    expect(recognizeShape([100, 100, 0.5, 400, -Infinity, 0.5, 400, 400, 0.5])).toBeNull();
  });

  it("falls back to a sane pressure when every pressure sample is garbage", () => {
    const pts: number[] = [];
    for (let i = 0; i <= 100; i++) pts.push(100 + i * 4, 200, NaN);
    const result = recognizeShape(pts);
    expect(result?.kind).toBe("line");
    for (let i = 2; i < result!.pts.length; i += 3) {
      expect(Number.isFinite(result!.pts[i])).toBe(true);
      expect(result!.pts[i]).toBeGreaterThan(0);
    }
  });

  it("returns null for a stroke that never moves", () => {
    const pts: number[] = [];
    for (let i = 0; i < 500; i++) pts.push(300, 300, 0.5);
    expect(recognizeShape(pts)).toBeNull();
  });

  it("does not mutate the caller's points", () => {
    const pts = inkFrom(rectangle(100, 100, 400, 260), 52);
    const copy = [...pts];
    recognizeShape(pts);
    expect(pts).toEqual(copy);
  });
});

describe("performance", () => {
  it("handles a 4001-point stroke well inside a frame budget", () => {
    // contracts/api.md §2's trigger is a 500ms hold, but the snap itself has
    // to feel instant. This guards against an accidental O(n^2).
    const big = inkFrom(arc(500, 500, 400, 400, 0, 360, 4000), 99, { spacing: 0.628 });
    expect(big.length / 3).toBeGreaterThan(4000);
    const started = performance.now();
    const result = recognizeShape(big);
    const elapsed = performance.now() - started;
    expect(result?.kind).toBe("circle");
    expect(elapsed).toBeLessThan(250);
  });

  it("handles a 4001-point straight stroke, where RDP is worst-case", () => {
    const pts: number[] = [];
    for (let i = 0; i < 4001; i++) pts.push(100 + i * 0.15, 200 + Math.sin(i / 400) * 0.4, 0.5);
    const started = performance.now();
    expect(recognizeShape(pts)?.kind).toBe("line");
    expect(performance.now() - started).toBeLessThan(250);
  });
});
