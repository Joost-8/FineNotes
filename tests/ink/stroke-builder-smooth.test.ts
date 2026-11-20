/**
 * Rounded input (FineNotes#1): WebKit before iPadOS 26.2 hands over every pen
 * position rounded to a whole screen px, and a stroke drawn through those
 * samples wobbles. `smoothing: "centred"` places each one from the samples
 * on both sides of it (`CENTRED_HALF`). Off, the builder keeps samples
 * exactly.
 */

import { describe, expect, it } from "vitest";
import { CENTRED_HALF, type Smoothing, StrokeBuilder } from "../../src/ink/stroke-builder";
import deviceRounded from "./fixtures/real-pencil-device-px-ipad.json";

type Sample = { x: number; y: number; pressure: number };

/** One device px of the fixture's iPad, page px: the grid its Pencil was rounded to. */
const DEVICE_GRID = 1 / (deviceRounded.scale * deviceRounded.devicePixelRatio);

/** A straight line as the reporter's iPad gave it: ~2-4 px steps, rounded to whole px. */
function roundedLine(n = 40, step = 3, angle = 0.62): Sample[] {
  return Array.from({ length: n }, (_, i) => ({
    x: Math.round(10.3 + i * step * Math.cos(angle)),
    y: Math.round(20.6 + i * step * Math.sin(angle)),
    pressure: 0.3,
  }));
}

/** An arc of radius `r` with exact (unrounded) samples `step` px apart. */
function arc(n: number, r = 20, step = 2): Sample[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i * step) / r;
    return { x: 100 + r * Math.cos(a), y: 100 + r * Math.sin(a), pressure: 0.3 };
  });
}

function triples(flat: readonly number[]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i + 2 < flat.length; i += 3) out.push([flat[i], flat[i + 1], flat[i + 2]]);
  return out;
}

/** Distance of each point from the true line through (10.3, 20.6) at `angle`. */
function offLine(pts: number[][], angle = 0.62): number[] {
  const [nx, ny] = [-Math.sin(angle), Math.cos(angle)];
  return pts.map(([x, y]) => Math.abs((x - 10.3) * nx + (y - 20.6) * ny));
}

/** How much the heading changes from one point to the next, degrees, summed. */
function turning(pts: number[][]): number {
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

const rms = (v: number[]): number => Math.sqrt(v.reduce((s, d) => s + d * d, 0) / v.length);
/** Leave out the ends: the start and the pen-up are taken as they are. */
const mid = (pts: number[][]): number[][] => pts.slice(pts.length / 5, (pts.length * 4) / 5);

function build(
  samples: Sample[],
  options: {
    smoothing?: Smoothing;
    densify?: boolean;
    minDistance?: number;
    grid?: number;
    stabilize?: number;
  },
): number[][] {
  const b = new StrokeBuilder({ minDistance: 1.4, ...options });
  for (const s of samples.slice(0, -1)) b.add(s);
  b.addFinal(samples[samples.length - 1]);
  return triples(b.points());
}

describe("StrokeBuilder smoothing", () => {
  it("is off unless asked for: samples are kept exactly", () => {
    const samples = roundedLine();
    const pts = build(samples, {});
    expect(pts.map(([x, y]) => [x, y])).toEqual(samples.map((s) => [s.x, s.y]));
  });

  describe("centred", () => {
    const smoothing = "centred";
    it("draws a rounded straight line straighter", () => {
      const samples = roundedLine();
      for (const densify of [false, true]) {
        const raw = build(samples, { densify });
        const smooth = build(samples, { densify, smoothing });
        expect(rms(offLine(mid(smooth)))).toBeLessThan(rms(offLine(mid(raw))) * 0.75);
        expect(turning(mid(smooth))).toBeLessThan(turning(mid(raw)) * 0.75);
      }
    });

    it("starts where the pen touched and ends where it lifted", () => {
      const samples = roundedLine(12);
      for (const densify of [false, true]) {
        const pts = build(samples, { densify, smoothing });
        expect(pts[0].slice(0, 2)).toEqual([samples[0].x, samples[0].y]);
        expect(pts[pts.length - 1].slice(0, 2)).toEqual([samples[11].x, samples[11].y]);
      }
    });

    it("only ever appends: points already kept never move", () => {
      for (const densify of [false, true]) {
        const b = new StrokeBuilder({ minDistance: 1.4, smoothing, densify });
        let before: number[] = [];
        for (const s of roundedLine(30)) {
          b.add(s);
          const now = [...b.view];
          expect(now.slice(0, before.length)).toEqual(before);
          before = now;
        }
      }
    });

    it("keeps the pen's pressure: only positions are smoothed", () => {
      const b = new StrokeBuilder({ minDistance: 0.1, smoothing });
      const pressures = [0.2, 0.6, 0.3, 0.7, 0.4, 0.5, 0.25, 0.65, 0.35];
      pressures.forEach((p, i) => b.add({ x: i * 3, y: (i % 2) * 1, pressure: p }));
      b.settle();
      expect(triples(b.view).map((p) => p[2])).toEqual(pressures);
    });
  });

  it("centred keeps a curve's shape: exact samples on an arc stay on it", () => {
    // Away from the ends, where the window is the full quadratic one; the
    // second sample from each end is a 3-point average, 0.07 px inside here.
    const pts = build(arc(40), { smoothing: "centred", minDistance: 0.1 }).slice(2, -2);
    const off = pts.map(([x, y]) => Math.abs(Math.hypot(x - 100, y - 100) - 20));
    expect(Math.max(...off)).toBeLessThan(0.01);
  });

  it("centred holds back the newest samples as the tail, and settles them on lift", () => {
    const b = new StrokeBuilder({ minDistance: 0.1, smoothing: "centred" });
    const samples = roundedLine(10);
    for (const s of samples) b.add(s);
    // Sample i passes once CENTRED_HALF samples follow it (fewer near the start).
    expect(b.view.length / 3).toBe(samples.length - CENTRED_HALF);
    // The held samples, then the pen-up the reckoning assumes.
    expect(b.tail.length).toBe(CENTRED_HALF + 1);
    expect(b.tail.at(-1)?.slice(0, 2)).toEqual([samples[9].x, samples[9].y]);
    expect(b.length).toBe(samples.length);
    b.settle();
    expect(b.tail).toEqual([]);
    expect(b.view.length / 3).toBe(samples.length);
  });

  it("centred: the tail is drawn where a pen-up would leave it (FineNotes#179)", () => {
    for (const options of [
      { smoothing: "centred" as const },
      { smoothing: "centred" as const, grid: DEVICE_GRID },
      { stabilize: 6 },
    ]) {
      for (const xy of deviceRounded.strokes) {
        const b = new StrokeBuilder({ minDistance: 0.01, ...options });
        for (let i = 0; i + 1 < xy.length; i += 2) {
          const pen = { x: xy[i], y: xy[i + 1], pressure: 0.5 };
          b.add(pen);
          const drawn = [...triples(b.view), ...b.tail].flatMap(([x, y]) => [x, y]);
          const lifted = new StrokeBuilder({ minDistance: 0.01, ...options });
          for (let j = 0; j < i; j += 2) {
            lifted.add({ x: xy[j], y: xy[j + 1], pressure: 0.5 });
          }
          lifted.add(pen);
          lifted.addFinal(pen);
          if (b.tail.length > 0) {
            expect(drawn).toEqual(triples(lifted.points()).flatMap(([x, y]) => [x, y]));
          }
        }
      }
    }
  });

  it("centred: points() is what settling would give, and changes nothing", () => {
    for (const densify of [false, true]) {
      const b = new StrokeBuilder({ minDistance: 1.4, smoothing: "centred", densify });
      for (const s of roundedLine(20)) b.add(s);
      const view = [...b.view];
      const tail = b.tail.map((s) => [...s]);
      const settled = b.points();
      expect(b.points()).toEqual(settled);
      expect([...b.view]).toEqual(view);
      expect(b.tail.map((s) => [...s])).toEqual(tail);
      b.settle();
      expect([...b.view]).toEqual(settled);
    }
  });

  it("centred: the pen's first pressure reading reaches the samples still held", () => {
    const b = new StrokeBuilder({
      minDistance: 0.1,
      smoothing: "centred",
      fallbackPressure: 0.5,
    });
    for (let i = 0; i < 5; i++) b.add({ x: i * 3, y: 0, pressure: 0 });
    const before = b.revision;
    b.add({ x: 15, y: 0, pressure: 0.3 });
    expect(b.revision).toBe(before + 1);
    b.settle();
    expect(triples(b.view).every((p) => p[2] === 0.3)).toBe(true);
  });

  it("centred: drops a sample too close to the last one held", () => {
    const b = new StrokeBuilder({ minDistance: 1.4, smoothing: "centred" });
    expect(b.add({ x: 0, y: 0, pressure: 0.3 })).toBe(true);
    expect(b.add({ x: 1, y: 0, pressure: 0.3 })).toBe(false);
    expect(b.add({ x: 2, y: 0, pressure: 0.3 })).toBe(true);
    expect(b.addFinal({ x: 2.5, y: 0, pressure: 0.3 })).toBe(true);
    expect(b.length).toBe(3);
  });

  it("centred steadies real Pencil ink rounded to device px (FineNotes#179)", () => {
    // How jagged a stroke is: the mean change of turn from one point to the
    // next, degrees. A letter turns; rounding makes it turn to and fro.
    const jagged = (pts: number[][]): number => {
      const turns: number[] = [];
      for (let i = 2; i < pts.length; i++) {
        const a = Math.atan2(pts[i - 1][1] - pts[i - 2][1], pts[i - 1][0] - pts[i - 2][0]);
        const b = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]);
        let d = b - a;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        turns.push(d);
      }
      let sum = 0;
      for (let i = 1; i < turns.length; i++) sum += Math.abs(turns[i] - turns[i - 1]);
      return turns.length > 1 ? (sum / (turns.length - 1)) * (180 / Math.PI) : 0;
    };
    const score = (smoothing: Smoothing): number => {
      let total = 0;
      for (const xy of deviceRounded.strokes) {
        const samples: Sample[] = [];
        for (let i = 0; i + 1 < xy.length; i += 2) {
          samples.push({ x: xy[i], y: xy[i + 1], pressure: 0.5 });
        }
        total += jagged(build(samples, { smoothing, minDistance: 0.01 }));
      }
      return total / deviceRounded.strokes.length;
    };
    const off = score("off");
    const centred = score("centred");
    // Measured: 30.9° off, 13.5° centred.
    expect(off).toBeGreaterThan(25);
    expect(centred).toBeLessThan(off * 0.55);
  });
});

/**
 * FineNotes#275: on a practice sheet, which opens with the whole page on
 * screen (~0.45 on an iPad in landscape), small handwriting came out
 * flattened ("Five" read "Fi~"). The centred window spans 7 samples, about
 * 13 screen px at a Pencil's 2 px spacing, wider than a letter written that
 * small, and a quadratic through it cannot follow a loop. Rounding moved
 * each sample at most half a grid step, so the filter may move it no
 * further: the steps go, the letter stays.
 */
describe("StrokeBuilder centred smoothing within the rounding grid (FineNotes#275)", () => {
  /** Cursive "veve", `h` page px tall: two v-and-loop pairs. */
  function cursive(h: number): number[][] {
    const out: number[][] = [];
    for (let i = 0; i <= 400; i++) {
      const t = (i / 400) * 4 * Math.PI;
      out.push([
        h * (t / Math.PI) * 0.9 + 0.35 * h * Math.sin(t),
        -h * 0.5 * (1 - Math.cos(t)) - 0.25 * h * Math.sin(2 * t),
      ]);
    }
    return out;
  }

  /** `path` (page px) as a Pencil reports it at `zoom`: every `step` screen px, rounded to whole px. */
  function penAt(path: number[][], zoom: number, step: number, ox: number, oy: number): Sample[] {
    const screen = path.map(([x, y]) => [x * zoom + ox, y * zoom + oy]);
    const out: Sample[] = [];
    let carry = 0;
    const take = (x: number, y: number): void => {
      out.push({ x: (Math.round(x) - ox) / zoom, y: (Math.round(y) - oy) / zoom, pressure: 0.4 });
    };
    take(screen[0][0], screen[0][1]);
    for (let i = 1; i < screen.length; i++) {
      const [ax, ay] = screen[i - 1];
      const [bx, by] = screen[i];
      const len = Math.hypot(bx - ax, by - ay);
      let d = step - carry;
      for (; d <= len; d += step) take(ax + ((bx - ax) * d) / len, ay + ((by - ay) * d) / len);
      carry = len - (d - step);
    }
    return out;
  }

  /** The farthest the true path gets from the drawn one: detail the stroke lost. */
  function lost(truth: number[][], drawn: number[][]): number {
    let worst = 0;
    for (const [x, y] of truth.slice(20, -20)) {
      let best = Infinity;
      for (let i = 1; i < drawn.length; i++) {
        const [ax, ay] = drawn[i - 1];
        const [bx, by] = drawn[i];
        const dx = bx - ax;
        const dy = by - ay;
        const l = dx * dx + dy * dy;
        const u = l ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l)) : 0;
        best = Math.min(best, Math.hypot(ax + u * dx - x, ay + u * dy - y));
      }
      worst = Math.max(worst, best);
    }
    return worst;
  }

  const OFFSETS = [
    [100.3, 200.7],
    [100.71, 200.12],
    [100.5, 200.5],
    [100.05, 200.9],
  ];

  it("never moves a sample further than half a grid step", () => {
    const samples = roundedLine(40);
    const pts = build(samples, { smoothing: "centred", grid: 1, minDistance: 0.01 });
    expect(pts.length).toBe(samples.length);
    pts.forEach(([x, y], i) => {
      expect(Math.abs(x - samples[i].x)).toBeLessThanOrEqual(0.5 + 1e-9);
      expect(Math.abs(y - samples[i].y)).toBeLessThanOrEqual(0.5 + 1e-9);
    });
  });

  it("keeps small letters the window alone flattens", () => {
    // The reporter's notebook strokes are ~16 page px tall; on a sheet at
    // 0.45 that is ~8 screen px.
    const h = 18;
    const zoom = 0.45;
    const truth = cursive(h);
    for (const densify of [false, true]) {
      let window = 0;
      let gridded = 0;
      for (const [ox, oy] of OFFSETS) {
        const samples = penAt(truth, zoom, 2.2, ox, oy);
        const options = { smoothing: "centred" as const, densify, minDistance: 1.4 / zoom };
        window += lost(truth, build(samples, options)) / h;
        gridded += lost(truth, build(samples, { ...options, grid: 1 / zoom })) / h;
      }
      // Measured with densify: 32% of the letter's height lost, 20% within the grid.
      expect(window / OFFSETS.length).toBeGreaterThan(0.28);
      expect(gridded / OFFSETS.length).toBeLessThan(0.23);
    }
  });

  it("steadies a rounded straight line as much as before", () => {
    const samples = roundedLine();
    for (const densify of [false, true]) {
      const window = build(samples, { densify, smoothing: "centred" });
      const gridded = build(samples, { densify, smoothing: "centred", grid: 1 });
      expect(rms(offLine(mid(gridded)))).toBeLessThanOrEqual(rms(offLine(mid(window))) * 1.05);
      expect(turning(mid(gridded))).toBeLessThanOrEqual(turning(mid(window)) * 1.05);
    }
  });

  it("still keeps an arc of exact samples on it", () => {
    const pts = build(arc(40), { smoothing: "centred", grid: 1, minDistance: 0.1 }).slice(2, -2);
    const off = pts.map(([x, y]) => Math.abs(Math.hypot(x - 100, y - 100) - 20));
    expect(Math.max(...off)).toBeLessThan(0.01);
  });

  it("steadies real Pencil ink rounded to device px as much as before", () => {
    const strokes = deviceRounded.strokes.map((xy) => {
      const samples: Sample[] = [];
      for (let i = 0; i + 1 < xy.length; i += 2)
        samples.push({ x: xy[i], y: xy[i + 1], pressure: 0.5 });
      return samples;
    });
    const turns = (grid?: number): number =>
      strokes.reduce(
        (sum, s) => sum + turning(build(s, { smoothing: "centred", minDistance: 0.01, grid })),
        0,
      );
    expect(turns(DEVICE_GRID)).toBeLessThanOrEqual(turns() * 1.1);
  });

  it("leaves stroke stabilization alone: it is meant to move the pen further", () => {
    const samples = penAt(cursive(18), 0.45, 2.2, 100.3, 200.7);
    const options = { smoothing: "centred" as const, stabilize: 12, minDistance: 0.01 };
    expect(build(samples, { ...options, grid: 1 / 0.45 })).toEqual(build(samples, options));
  });

  it("does nothing with smoothing off", () => {
    const samples = roundedLine();
    expect(build(samples, { grid: 1 })).toEqual(build(samples, {}));
  });
});
