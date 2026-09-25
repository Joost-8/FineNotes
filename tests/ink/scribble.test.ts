/**
 * `src/ink/scribble.ts` — Scribble to erase: is this stroke a scribble, and
 * what does it cover.
 *
 * Positives are zigzags and sawtooths drawn with Pencil density and hand
 * tremor (ink-synth.ts), and Joost's real scribbles traced from an iPad
 * recording. Negatives are what a pen draws on purpose that goes back and
 * forth or round and round: "mmm", "W", cursive loops, a word circled
 * several times, a spiral, a strike-through — plus every real Pencil shape
 * on file and the real strokes from Joost's test note that came closest.
 */

import { describe, expect, it } from "vitest";
import {
  MAX_LOOPING,
  MIN_OVERLAP,
  MIN_REVERSALS,
  SCRIBBLE_COVERAGE,
  detectScribble,
  measureScribble,
  scribbleCoverage,
  scribbleMayErase,
} from "../../src/ink/scribble";
import { type Pt, arc, pencilInk, rotate } from "./ink-synth";
import realPencil from "./fixtures/real-pencil-ipad.json";
import realPencil2 from "./fixtures/real-pencil-ipad-2.json";
import realMouse from "./fixtures/real-mouse-triangles.json";
import realSquiggles from "./fixtures/real-handwriting-squiggles.json";
import realScribbles from "./fixtures/real-scribbles-ipad.json";

const OPTS = { minSize: 8 };

/**
 * A zigzag: `passes` strokes `len` long along x, each `spacing` further down
 * than the last. `turn` rounds each turn out by that much; `jitter` varies
 * the passes' length and start by up to that share.
 */
function zigzag(
  x: number,
  y: number,
  len: number,
  passes: number,
  spacing: number,
  opts: { turn?: number; jitter?: number; seed?: number } = {},
): Pt[] {
  const pts: Pt[] = [];
  let r = opts.seed ?? 1;
  const rand = (): number => {
    r = (r * 16807) % 2147483647;
    return r / 2147483647;
  };
  const jitter = opts.jitter ?? 0;
  for (let i = 0; i < passes; i++) {
    const l = len * (1 - jitter * rand());
    const off = jitter * len * 0.5 * rand();
    const from = i % 2 === 0 ? x + off : x + l + off;
    const to = i % 2 === 0 ? x + l + off : x + off;
    const yy = y + i * spacing;
    const turn = opts.turn ?? 0;
    if (turn > 0 && i > 0) {
      const prev = pts[pts.length - 1];
      pts.push({ x: prev.x + (i % 2 === 0 ? -turn : turn), y: (prev.y + yy) / 2 });
    }
    pts.push({ x: from, y: yy }, { x: to, y: yy + spacing });
  }
  return pts;
}

/** A sawtooth: up at a slant `lean` px across, straight back down, `teeth` times. */
function sawtooth(
  x: number,
  y: number,
  h: number,
  step: number,
  lean: number,
  teeth: number,
): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < teeth; i++) {
    pts.push({ x: x + i * step, y: y + h }, { x: x + i * step + lean, y });
  }
  return pts;
}

/**
 * Joost's way (iPad recording, 2026-09-25): passes leaning 60° from the
 * line of writing, the scribble moving along the line `step` px a pass.
 */
function slanted(x: number, y: number, h: number, step: number, passes: number): Pt[] {
  const lean = h / Math.tan((60 * Math.PI) / 180);
  const pts: Pt[] = [];
  for (let i = 0; i < passes; i++) {
    const at = x + i * step;
    pts.push(i % 2 === 0 ? { x: at, y: y + h } : { x: at + lean, y });
  }
  return pts;
}

/** Loops going one way round, drifting outward a little each turn. */
function loops(cx: number, cy: number, a: number, b: number, turns: number): Pt[] {
  const pts: Pt[] = [];
  const steps = 90 * turns;
  for (let i = 0; i <= steps; i++) {
    const t = (i / 90) * 2 * Math.PI + 1.3;
    const k = 1 + (2 * i) / steps / Math.max(a, b);
    pts.push({ x: cx + a * k * Math.cos(t), y: cy + b * k * Math.sin(t) });
  }
  return pts;
}

/** A coil: thin loops advancing along x, the "@@@@" way of scribbling. */
function coil(x: number, y: number, a: number, b: number, turns: number, advance: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= 60 * turns; i++) {
    const t = (i / 60) * 2 * Math.PI;
    pts.push({ x: x + a * Math.cos(t) + (advance * i) / 60, y: y + b * Math.sin(t) });
  }
  return pts;
}

/** Cursive "m": a leg, back up it, an arch, down — `humps` times. */
function mmm(x: number, y: number, h: number, w: number, humps: number): Pt[] {
  const pts: Pt[] = [{ x, y: y + h }];
  let cx = x;
  for (let i = 0; i < humps; i++) {
    pts.push({ x: cx + 0.5, y: y + h * 0.35 });
    const r = w / 2;
    for (let k = 0; k <= 12; k++) {
      const t = Math.PI - (k / 12) * Math.PI;
      pts.push({ x: cx + r + r * Math.cos(t), y: y + h * 0.35 - r * Math.sin(t) * 0.9 });
    }
    cx += w;
    pts.push({ x: cx, y: y + h });
  }
  return pts;
}

function letterW(x: number, y: number, h: number, w: number, copies: number): Pt[] {
  const pts: Pt[] = [];
  for (let c = 0; c < copies; c++) {
    const ox = x + c * w;
    pts.push(
      { x: ox, y },
      { x: ox + w * 0.25, y: y + h },
      { x: ox + w * 0.5, y: y + h * 0.2 },
      { x: ox + w * 0.75, y: y + h },
      { x: ox + w, y },
    );
  }
  return pts;
}

/** Cursive "llll": tall loops, each going round the same way. */
function cursiveL(x: number, y: number, h: number, w: number, n: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const ox = x + i * w;
    for (let k = 0; k <= 30; k++) {
      const t = (k / 30) * 2 * Math.PI;
      pts.push({
        x: ox + w * 0.3 * Math.sin(t) + (w * k) / 30,
        y: y + h - (h * (1 - Math.cos(t))) / 2,
      });
    }
  }
  return pts;
}

function spiral(cx: number, cy: number, r: number, turns: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= turns * 60; i++) {
    const t = (i / 60) * 2 * Math.PI;
    const rr = (r * i) / (turns * 60);
    pts.push({ x: cx + rr * Math.cos(t), y: cy + rr * Math.sin(t) });
  }
  return pts;
}

/**
 * Real ink from a fixture file, as flat `[x, y, p, …]`: `{ strokes }` of
 * `points` pairs or flat `pts`, or a bare list of flat strokes.
 */
function realStrokes(file: unknown): number[][] {
  if (Array.isArray(file)) return file as number[][];
  const strokes = (file as { strokes: Array<{ points?: number[][]; pts?: number[] }> }).strokes;
  return strokes.map((s) => s.pts ?? (s.points ?? []).flatMap(([x, y]) => [x, y, 0.5]));
}

describe("detectScribble: scribbles", () => {
  const cases: Array<[string, Pt[]]> = [
    ["a dense zigzag", zigzag(100, 100, 60, 8, 6)],
    ["a tight zigzag of six passes", zigzag(100, 100, 60, 6, 4)],
    ["a loose zigzag", zigzag(100, 100, 60, 8, 10)],
    ["a zigzag with rounded turns", zigzag(100, 100, 60, 8, 6, { turn: 6 })],
    ["a sloppy zigzag", zigzag(100, 100, 60, 9, 5, { jitter: 0.35, seed: 7 })],
    ["a zigzag at 30°", rotate(zigzag(100, 100, 60, 8, 6), 30, 130, 120)],
    ["an up-and-down zigzag across a word", rotate(zigzag(100, 100, 30, 12, 6), 90, 130, 120)],
    ["a small zigzag over one letter", zigzag(100, 100, 20, 6, 3)],
    ["five passes", zigzag(100, 100, 50, 5, 6)],
    ["rubbing back and forth in place", zigzag(100, 100, 50, 9, 0.8)],
    ["a sawtooth, up at a slant and straight down", sawtooth(100, 100, 50, 10, 25, 8)],
    [
      "a zigzag down a word and back up it",
      [...zigzag(100, 100, 60, 8, 6), ...zigzag(100, 142, 60, 8, -6).slice(1)],
    ],
    // Slanted passes across a long word: the drift along the passes once
    // halved `overlap`, and refused Joost's scribbles over longer words.
    ["slanted passes across a long word", slanted(100, 100, 50, 14, 16)],
    ["slanted passes across a short word", slanted(100, 100, 40, 10, 8)],
  ];
  for (const [name, poly] of cases) {
    it(`reads ${name} as a scribble`, () => {
      for (const seed of [1, 2, 3]) {
        const scribble = detectScribble(pencilInk(poly, seed), OPTS);
        expect(scribble, `seed ${seed}`).not.toBeNull();
        expect(scribble?.measure.reversals).toBeGreaterThanOrEqual(MIN_REVERSALS);
        expect(scribble?.measure.looping).toBeLessThanOrEqual(MAX_LOOPING);
      }
    });
  }

  it("reads every one of Joost's real scribbles as a scribble", () => {
    // Traced from his recording: nine that erased in 0.8.0, and four that
    // were refused ("whats", "chimey", "Jer" and a second go at "Jer"),
    // each for its slant alone (overlap 0.43-0.45).
    const strokes = realStrokes(realScribbles);
    expect(strokes.length).toBe(15);
    for (const [i, pts] of strokes.entries()) {
      const scribble = detectScribble(pts, { minSize: 9 });
      expect(scribble, `stroke ${i}`).not.toBeNull();
      expect(scribble?.measure.overlap).toBeGreaterThanOrEqual(MIN_OVERLAP);
    }
  });

  it("is judged by size on screen: the same zigzag is too small below minSize", () => {
    const pts = pencilInk(zigzag(100, 100, 20, 6, 3), 1);
    expect(detectScribble(pts, { minSize: 8 })).not.toBeNull();
    expect(detectScribble(pts, { minSize: 40 })).toBeNull();
  });
});

describe("detectScribble: what a pen draws on purpose", () => {
  const cases: Array<[string, Pt[]]> = [
    ["four passes (a W's worth)", zigzag(100, 100, 50, 4, 6)],
    ["a cursive mmm", mmm(100, 100, 30, 16, 3)],
    ["a small cursive mmmm", mmm(100, 100, 14, 8, 4)],
    ["a W", letterW(100, 100, 30, 40, 1)],
    ["WW in one stroke", letterW(100, 100, 30, 40, 2)],
    ["a cursive llll", cursiveL(100, 100, 40, 12, 4)],
    ["a circle gone round three times", loops(150, 150, 40, 40, 3)],
    ["a 2:1 loop round a word, three times", loops(150, 150, 60, 30, 3)],
    ["a 3:1 loop round a word, three times", loops(150, 150, 75, 25, 3)],
    ["a 5:1 loop round a word, three times", loops(150, 150, 100, 20, 3)],
    ["a 6:1 loop round a long word, twice", loops(150, 150, 120, 20, 2)],
    ["a thin coil", coil(100, 100, 20, 4, 5, 8)],
    ["a round coil", coil(100, 100, 15, 8, 5, 10)],
    ["a spiral", spiral(150, 150, 50, 4)],
    ["a strike-through, back and forth", zigzag(100, 100, 120, 3, 1)],
    ["an arc", arc(100, 100, 50, 0, 300, 60)],
  ];
  for (const [name, poly] of cases) {
    it(`does not read ${name} as a scribble`, () => {
      for (const seed of [1, 2, 3]) {
        expect(detectScribble(pencilInk(poly, seed), OPTS), `seed ${seed}`).toBeNull();
      }
    });
  }

  it("refuses every real Pencil and mouse shape on file", () => {
    const strokes = [
      ...realStrokes(realPencil),
      ...realStrokes(realPencil2),
      ...realStrokes(realMouse),
    ];
    expect(strokes.length).toBeGreaterThan(20);
    for (const pts of strokes) expect(detectScribble(pts, OPTS)).toBeNull();
  });

  it("refuses the real handwriting strokes that come closest", () => {
    // From Joost's test note: wavy "nnnn" and "mmm" squiggles and letters
    // that reverse three times or more. The whole page (224 strokes) was
    // checked when the gates were set; none read as a scribble.
    const strokes = realStrokes(realSquiggles);
    expect(strokes.length).toBeGreaterThanOrEqual(8);
    for (const pts of strokes) {
      expect(measureScribble(pts, OPTS)?.reversals).toBeGreaterThanOrEqual(3);
      expect(detectScribble(pts, OPTS)).toBeNull();
    }
  });
});

describe("measureScribble", () => {
  it("cannot read fewer than four points, nor a stroke that never moves", () => {
    expect(measureScribble([], OPTS)).toBeNull();
    expect(measureScribble([0, 0, 0.5, 5, 5, 0.5, 9, 0, 0.5], OPTS)).toBeNull();
    expect(
      measureScribble([3, 3, 0.5, 3, 3, 0.5, 3, 3, 0.5, 3, 3, 0.5, 3, 3, 0.5], OPTS),
    ).toBeNull();
  });

  it("reads whole points only, skipping ones that are not numbers", () => {
    const pts = pencilInk(zigzag(100, 100, 60, 8, 6), 1);
    const clean = measureScribble(pts, OPTS);
    const ragged = measureScribble([...pts, 7], OPTS);
    expect(ragged).toEqual(clean);
    const holed = [...pts];
    holed[30] = Number.NaN;
    expect(measureScribble(holed, OPTS)?.reversals).toBe(clean?.reversals);
  });

  it("counts a zigzag's turns as hairpins, and an m's arches as not", () => {
    const zig = measureScribble(pencilInk(zigzag(100, 100, 60, 8, 6), 1), OPTS);
    expect(zig?.hairpins).toBe(zig?.reversals);
    const m = measureScribble(pencilInk(mmm(100, 100, 30, 16, 3), 1), OPTS);
    expect(m?.reversals).toBeGreaterThanOrEqual(4);
    expect(m?.hairpins).toBeLessThan((m?.reversals ?? 0) * 0.75);
  });

  it("measures looping: a zigzag's or a sawtooth's steps go on, loops' go out and back", () => {
    const looping = (poly: Pt[]): number =>
      measureScribble(pencilInk(poly, 1), OPTS)?.looping ?? Number.NaN;
    expect(looping(zigzag(100, 100, 60, 8, 6))).toBeLessThan(0.1);
    expect(looping(sawtooth(100, 100, 50, 10, 25, 8))).toBeLessThan(0.1);
    expect(looping(loops(150, 150, 60, 30, 3))).toBeGreaterThan(0.8);
  });

  it("measures overlap without the drift of slanted passes", () => {
    const m = measureScribble(pencilInk(slanted(100, 100, 50, 14, 16), 1), OPTS);
    // Along the passes the whole scribble spans ~3x one pass; drift removed, ~1x.
    expect(m?.overlap).toBeGreaterThan(0.8);
  });
});

describe("scribbleCoverage", () => {
  // A dense zigzag over the band x 100-160, y 100-148.
  const scribble = detectScribble(pencilInk(zigzag(100, 100, 60, 8, 6), 1), OPTS);
  const flat = (poly: Pt[]): number[] => poly.flatMap((p) => [p.x, p.y, 0.5]);

  it("covers writing under it", () => {
    expect(scribble).not.toBeNull();
    if (!scribble) return;
    const word = flat(mmm(110, 110, 20, 10, 3));
    expect(scribbleCoverage(scribble, word, 2)).toBeGreaterThanOrEqual(SCRIBBLE_COVERAGE);
  });

  it("does not cover writing beside it", () => {
    if (!scribble) return;
    const beside = flat(mmm(200, 110, 20, 10, 3));
    expect(scribbleCoverage(scribble, beside, 2)).toBe(0);
  });

  it("covers too little of a long line it only crosses", () => {
    if (!scribble) return;
    const line = flat([
      { x: 0, y: 125 },
      { x: 400, y: 125 },
    ]);
    const share = scribbleCoverage(scribble, line, 2);
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThan(SCRIBBLE_COVERAGE);
  });

  it("reaches `margin` past the band it swept", () => {
    if (!scribble) return;
    const b = scribble.bounds;
    const dot = [b.maxX + 5, (b.minY + b.maxY) / 2, 0.5];
    expect(scribbleCoverage(scribble, dot, 2)).toBe(0);
    expect(scribbleCoverage(scribble, dot, 8)).toBe(1);
  });

  it("covers a dot all or nothing, and an empty stroke not at all", () => {
    if (!scribble) return;
    expect(scribbleCoverage(scribble, [130, 124, 0.5], 1)).toBe(1);
    expect(scribbleCoverage(scribble, [130, 124, 0.5, 130, 124, 0.5], 1)).toBe(1);
    expect(scribbleCoverage(scribble, [500, 500, 0.5], 1)).toBe(0);
    expect(scribbleCoverage(scribble, [], 1)).toBe(0);
  });

  it("covers what a scribble retracing one line passes over, by the margin alone", () => {
    // Every pass on the same line: each region's hull is a sliver.
    const flatScribble = detectScribble(
      flat(zigzag(100, 100, 60, 8, 0)).map((v, i) => (i % 3 === 1 ? 100 : v)),
      OPTS,
    );
    expect(flatScribble).not.toBeNull();
    if (!flatScribble) return;
    expect(scribbleCoverage(flatScribble, [130, 101, 0.5], 2)).toBe(1);
    expect(scribbleCoverage(flatScribble, [130, 110, 0.5], 2)).toBe(0);
  });
});

describe("scribbleMayErase", () => {
  it("takes handwriting always, shapes and highlighter only when told to", () => {
    expect(scribbleMayErase({ tool: "pen" }, false)).toBe(true);
    expect(scribbleMayErase({ tool: "pen", shape: "rect" }, false)).toBe(false);
    expect(scribbleMayErase({ tool: "highlighter" }, false)).toBe(false);
    expect(scribbleMayErase({ tool: "pen", shape: "rect" }, true)).toBe(true);
    expect(scribbleMayErase({ tool: "highlighter" }, true)).toBe(true);
  });
});
