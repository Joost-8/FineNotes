import { describe, expect, it } from "vitest";
import {
  connectorHandles,
  splinePoints,
  traceCurve,
  traceElbow,
  type Pt,
} from "../../src/ink/connector-edit";

/**
 * A hand-drawn trail through `corners`: each turn rounded off (radius
 * `round`), sampled every 1.5 px, with low-frequency tremor (three slow
 * sinusoids) rather than white noise, as the ledger says real ink has.
 */
function trail(corners: Pt[], round = 10, seed = 1): Pt[] {
  // Cut each corner off along a quadratic through it.
  const path: Pt[] = [corners[0]];
  for (let i = 1; i < corners.length - 1; i++) {
    const [a, b, c] = [corners[i - 1], corners[i], corners[i + 1]];
    const lin = (p: Pt, q: Pt, d: number): Pt => {
      const len = Math.hypot(q.x - p.x, q.y - p.y);
      const k = Math.min(0.45, d / len);
      return { x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k };
    };
    const p0 = lin(b, a, round);
    const p2 = lin(b, c, round);
    for (let t = 0; t <= 1; t += 0.1) {
      path.push({
        x: (1 - t) ** 2 * p0.x + 2 * (1 - t) * t * b.x + t * t * p2.x,
        y: (1 - t) ** 2 * p0.y + 2 * (1 - t) * t * b.y + t * t * p2.y,
      });
    }
  }
  path.push(corners[corners.length - 1]);
  const out: Pt[] = [];
  let s = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.round(len / 1.5));
    for (let j = 0; j < steps; j++) {
      const k = j / steps;
      s += len / steps;
      const wob =
        1.2 * Math.sin(s / 37 + seed) +
        0.8 * Math.sin(s / 19 + 2 * seed) +
        0.5 * Math.sin(s / 11 + 3 * seed);
      out.push({ x: a.x + (b.x - a.x) * k + wob * 0.6, y: a.y + (b.y - a.y) * k + wob });
    }
  }
  out.push(path[path.length - 1]);
  return out;
}

function square(points: Pt[]): boolean {
  return points.every(
    (p, i) =>
      i === 0 || Math.abs(p.x - points[i - 1].x) < 0.01 || Math.abs(p.y - points[i - 1].y) < 0.01,
  );
}

function ends(t: Pt[]): [Pt, Pt] {
  return [t[0], t[t.length - 1]];
}

describe("traceElbow", () => {
  it("turns an L drawn across then down into one bend, across then down", () => {
    const t = trail([
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 250 },
    ]);
    const [from, to] = ends(t);
    const out = traceElbow(t, from, to);
    expect(out).toHaveLength(3);
    expect(square(out)).toBe(true);
    expect(out[1]).toEqual({ x: to.x, y: from.y });
  });

  it("keeps the order the pen went: down then across", () => {
    const t = trail([
      { x: 100, y: 100 },
      { x: 100, y: 300 },
      { x: 260, y: 300 },
    ]);
    const [from, to] = ends(t);
    const out = traceElbow(t, from, to);
    expect(out).toHaveLength(3);
    expect(out[1]).toEqual({ x: from.x, y: to.y });
  });

  it("makes a Z with its middle run where it was drawn", () => {
    for (let seed = 1; seed <= 5; seed++) {
      const t = trail(
        [
          { x: 100, y: 100 },
          { x: 220, y: 100 },
          { x: 220, y: 260 },
          { x: 380, y: 260 },
        ],
        12,
        seed,
      );
      const [from, to] = ends(t);
      const out = traceElbow(t, from, to);
      expect(out).toHaveLength(4);
      expect(square(out)).toBe(true);
      expect(Math.abs(out[1].x - 220)).toBeLessThan(4);
    }
  });

  it("makes a U that comes back", () => {
    const t = trail([
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 200 },
      { x: 120, y: 200 },
    ]);
    const [from, to] = ends(t);
    const out = traceElbow(t, from, to);
    expect(out).toHaveLength(4);
    expect(square(out)).toBe(true);
    expect(Math.abs(out[1].x - 300)).toBeLessThan(4);
  });

  it("follows a staircase of five runs", () => {
    const t = trail([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 200, y: 200 },
      { x: 300, y: 200 },
    ]);
    const [from, to] = ends(t);
    const out = traceElbow(t, from, to);
    expect(out).toHaveLength(6);
    expect(square(out)).toBe(true);
  });

  it("bends a straight diagonal once, along its longer direction", () => {
    const t = trail([
      { x: 0, y: 0 },
      { x: 200, y: 80 },
    ]);
    const [from, to] = ends(t);
    expect(traceElbow(t, from, to)).toEqual([from, { x: to.x, y: from.y }, to]);
  });

  it("puts its ends where the connector's ends are, snapped elsewhere", () => {
    const t = trail([
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 250 },
    ]);
    const to = { x: 305, y: 262 };
    const out = traceElbow(t, t[0], to);
    expect(out[out.length - 1]).toEqual(to);
    expect(square(out)).toBe(true);
  });

  it("is read back as an elbow with a pill on each run", () => {
    const t = trail([
      { x: 100, y: 100 },
      { x: 220, y: 100 },
      { x: 220, y: 260 },
      { x: 380, y: 260 },
    ]);
    const [from, to] = ends(t);
    const flat = traceElbow(t, from, to).flatMap((p) => [p.x, p.y, 0.5]);
    expect(connectorHandles("path", flat, true)?.kind).toBe("elbow");
  });
});

describe("traceCurve", () => {
  it("leaves a straight stroke straight", () => {
    const t = trail([
      { x: 0, y: 0 },
      { x: 300, y: 40 },
    ]);
    const [from, to] = ends(t);
    expect(traceCurve(t, from, to)).toBeNull();
  });

  it("fits an arc with a few bend points, staying near the ink", () => {
    const arc: Pt[] = [];
    for (let a = 0; a <= Math.PI; a += 0.02) {
      arc.push({ x: 200 - 150 * Math.cos(a), y: 300 - 120 * Math.sin(a) + 1.2 * Math.sin(a * 7) });
    }
    const [from, to] = ends(arc);
    const knots = traceCurve(arc, from, to);
    expect(knots).not.toBeNull();
    expect(knots!.length).toBeLessThanOrEqual(9);
    expect(knots![0]).toEqual(from);
    expect(knots![knots!.length - 1]).toEqual(to);
    const line = splinePoints(knots!, 0.5);
    // The top of the arc is kept.
    let top = Infinity;
    for (let i = 1; i < line.length; i += 3) top = Math.min(top, line[i]);
    expect(Math.abs(top - 180)).toBeLessThan(10);
  });

  it("is read back as a curve that can be bent further", () => {
    const s: Pt[] = [];
    for (let x = 0; x <= 300; x += 1.5)
      s.push({ x, y: 200 + 60 * Math.sin((x / 300) * 2 * Math.PI) });
    const [from, to] = ends(s);
    const knots = traceCurve(s, from, to)!;
    const handles = connectorHandles("path", splinePoints(knots, 0.5));
    expect(handles?.kind).toBe("curve");
    expect(handles?.knots.length).toBe(knots.length);
  });

  it("survives a trail of one point or junk", () => {
    expect(traceCurve([{ x: 5, y: 5 }], { x: 5, y: 5 }, { x: 5, y: 5 })).toBeNull();
    expect(traceElbow([{ x: Number.NaN, y: 0 }], { x: 0, y: 0 }, { x: 10, y: 10 })).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
  });
});
