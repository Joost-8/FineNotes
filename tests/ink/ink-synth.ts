/**
 * Synthetic pencil ink for the shape-recognizer tests.
 *
 * The one rule this file exists to enforce (CLAUDE.md, "Synthetic test ink must
 * model tremor, not white noise"): a hand does **not** produce per-sample white
 * noise. Feeding +/-6 px uniform noise into a geometry recognizer inflates path
 * length ~2x and trips detour gates that real ink never trips, so the tests
 * would fail for a reason that has nothing to do with the code under test.
 *
 * Tremor here is three low-frequency sinusoids in arc length, with independent
 * random phase, displaced along the local normal, plus 0.35 px of sub-pixel
 * digitizer noise. Everything is driven by a seeded PRNG so a failure is
 * reproducible.
 */

export interface Pt {
  x: number;
  y: number;
}

/** mulberry32 — small, fast, and deterministic across platforms. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Walk a polyline at a fixed sample spacing, as a digitizer would. */
export function resample(poly: readonly Pt[], spacing = 3): Pt[] {
  if (poly.length === 0) return [];
  const out: Pt[] = [{ ...poly[0] }];
  let carry = 0;
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1];
    const b = poly[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (seg === 0) continue;
    let t = spacing - carry;
    while (t <= seg) {
      out.push({ x: a.x + ((b.x - a.x) * t) / seg, y: a.y + ((b.y - a.y) * t) / seg });
      t += spacing;
    }
    carry = (carry + seg) % spacing;
  }
  const last = poly[poly.length - 1];
  const tail = out[out.length - 1];
  if (Math.hypot(last.x - tail.x, last.y - tail.y) > 1e-9) out.push({ ...last });
  return out;
}

/** Arc length at each sample. */
function arcLengths(points: readonly Pt[]): number[] {
  const s: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    s.push(s[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  return s;
}

export interface TremorOptions {
  /** Peak displacement of the dominant tremor sinusoid, in px. */
  amplitude?: number;
  /** Sub-pixel digitizer noise, in px. Real pencils sit around 0.3. */
  noise?: number;
  /** Wavelengths of the three sinusoids, in px of arc length. */
  wavelengths?: [number, number, number];
}

/**
 * Displace a sampled path along its local normal by three low-frequency
 * sinusoids, then add sub-pixel white noise. Never per-sample jitter of any
 * consequence: that is the trap this helper exists to avoid.
 */
export function tremor(points: readonly Pt[], rand: () => number, opts: TremorOptions = {}): Pt[] {
  const amplitude = opts.amplitude ?? 1.1;
  const noise = opts.noise ?? 0.35;
  const [w1, w2, w3] = opts.wavelengths ?? [190, 97, 53];
  const amps = [amplitude, amplitude * 0.55, amplitude * 0.3];
  const waves = [w1, w2, w3];
  const phases = [rand() * Math.PI * 2, rand() * Math.PI * 2, rand() * Math.PI * 2];
  const s = arcLengths(points);

  return points.map((p, i) => {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    let offset = 0;
    for (let k = 0; k < 3; k++)
      offset += amps[k] * Math.sin((2 * Math.PI * s[i]) / waves[k] + phases[k]);
    const jx = (rand() - 0.5) * 2 * noise;
    const jy = (rand() - 0.5) * 2 * noise;
    // Normal is the tangent rotated 90 degrees.
    return { x: p.x - ty * offset + jx, y: p.y + tx * offset + jy };
  });
}

/** Flat `[x, y, p, …]`, with a mildly varying pressure the way a pen reports it. */
export function flat(points: readonly Pt[], rand?: () => number): number[] {
  const out: number[] = [];
  for (const p of points) {
    const pressure = rand ? 0.45 + rand() * 0.2 : 0.5;
    out.push(p.x, p.y, pressure);
  }
  return out;
}

/** A sampled, tremored stroke from ideal vertices, as flat `[x,y,p,…]`. */
export function inkFrom(
  poly: readonly Pt[],
  seed: number,
  opts: TremorOptions & { spacing?: number; clean?: boolean } = {},
): number[] {
  const rand = rng(seed);
  const sampled = resample(poly, opts.spacing ?? 3);
  const drawn = opts.clean ? sampled : tremor(sampled, rand, opts);
  return flat(drawn, rand);
}

// --- Ideal shape outlines -------------------------------------------------

export function segment(ax: number, ay: number, bx: number, by: number): Pt[] {
  return [
    { x: ax, y: ay },
    { x: bx, y: by },
  ];
}

export function polyline(...xy: number[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < xy.length; i += 2) out.push({ x: xy[i], y: xy[i + 1] });
  return out;
}

/** Arc / ellipse outline. `sweepDeg` 360 closes the loop exactly. */
export function arc(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  startDeg = 0,
  sweepDeg = 360,
  steps = 96,
): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = ((startDeg + (sweepDeg * i) / steps) * Math.PI) / 180;
    out.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
  }
  return out;
}

/** Axis-aligned rectangle outline, closed, starting at the top-left. */
export function rectangle(x: number, y: number, w: number, h: number): Pt[] {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
    { x, y },
  ];
}

/** Rotate a polyline about a point. */
export function rotate(poly: readonly Pt[], deg: number, cx: number, cy: number): Pt[] {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return poly.map((p) => ({
    x: cx + (p.x - cx) * c - (p.y - cy) * s,
    y: cy + (p.x - cx) * s + (p.y - cy) * c,
  }));
}

/** Regular polygon outline, closed. */
export function regularPolygon(
  cx: number,
  cy: number,
  r: number,
  sides: number,
  rotDeg = -90,
): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= sides; i++) {
    const a = ((rotDeg + (360 * i) / sides) * Math.PI) / 180;
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return out;
}

/** Rounded-corner rectangle outline, closed. */
export function roundedRectish(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  steps = 12,
): Pt[] {
  const out: Pt[] = [];
  const corner = (ccx: number, ccy: number, from: number): void => {
    for (let i = 0; i <= steps; i++) {
      const a = ((from + (90 * i) / steps) * Math.PI) / 180;
      out.push({ x: ccx + r * Math.cos(a), y: ccy + r * Math.sin(a) });
    }
  };
  out.push({ x: x + r, y });
  out.push({ x: x + w - r, y });
  corner(x + w - r, y + r, -90);
  out.push({ x: x + w, y: y + h - r });
  corner(x + w - r, y + h - r, 0);
  out.push({ x: x + r, y: y + h });
  corner(x + r, y + h - r, 90);
  out.push({ x, y: y + r });
  corner(x + r, y + r, 180);
  return out;
}

/**
 * A full arrow drawn as one stroke: tail -> tip -> barb -> tip -> barb, which
 * is the gesture contracts/api.md §2 says is the only one that snaps.
 */
export function arrowOutline(
  tail: Pt,
  tip: Pt,
  barbFraction = 0.22,
  headDeg = 28,
  barbs: 1 | 2 = 2,
): Pt[] {
  const dx = tip.x - tail.x;
  const dy = tip.y - tail.y;
  const span = Math.hypot(dx, dy);
  const ux = dx / span;
  const uy = dy / span;
  const len = span * barbFraction;
  const head = (headDeg * Math.PI) / 180;
  const barb = (sign: number): Pt => {
    const c = Math.cos(sign * head);
    const s = Math.sin(sign * head);
    return { x: tip.x + len * (-ux * c - -uy * s), y: tip.y + len * (-ux * s + -uy * c) };
  };
  const out = [tail, tip, barb(1)];
  if (barbs === 2) out.push(tip, barb(-1));
  return out;
}

// --- Hand-drawn stars and retraced lines (2026-09-22) ---------------------
//
// No real Pencil star or retrace arrow has been seen yet, so these model what
// the recordings showed of real ink in general: Pencil sample density, low-
// frequency tremor, a pen-down hook, a closing overshoot, and corners the pen
// rounds rather than turns on the spot. A hand star is also never regular:
// tips vary in length and angle.

export interface StarStyle {
  /** Notch radius over tip radius (outline only). */
  ratio?: number;
  /** Angle of the first tip, degrees; -90 is upright on screen. */
  rotDeg?: number;
  /** Per-vertex radius jitter, as a fraction (uniform ±). */
  radiusJitter?: number;
  /** Per-vertex angle jitter, degrees (uniform ±). */
  angleJitter?: number;
  /** Vertex the pen starts on: even is a tip, odd a notch (outline). */
  start?: number;
  /** -1 draws the other way round. */
  direction?: 1 | -1;
  /** Round every tip off by this many px, as a pen turning in an arc does. */
  round?: number;
  /** Run on past the start by this fraction of the first edge. */
  overshoot?: number;
}

function roundCorner(points: Pt[], at: number, by: number): Pt[] {
  if (by <= 0 || at <= 0 || at >= points.length - 1) return points;
  const p = points[at];
  const toward = (q: Pt): Pt => {
    const d = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    const k = Math.min(by, d / 3) / d;
    return { x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k };
  };
  return [
    ...points.slice(0, at),
    toward(points[at - 1]),
    toward(points[at + 1]),
    ...points.slice(at + 1),
  ];
}

/** Ten jittered star vertices, tips at even indices. */
function starVertices(
  cx: number,
  cy: number,
  r: number,
  style: StarStyle,
  rand: () => number,
): Pt[] {
  const ratio = style.ratio ?? 0.4;
  const rot = style.rotDeg ?? -90;
  const rj = style.radiusJitter ?? 0;
  const aj = style.angleJitter ?? 0;
  const out: Pt[] = [];
  for (let i = 0; i < 10; i++) {
    const radius = (i % 2 === 0 ? r : r * ratio) * (1 + (rand() * 2 - 1) * rj);
    const a = ((rot + 36 * i + (rand() * 2 - 1) * aj) * Math.PI) / 180;
    out.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) });
  }
  return out;
}

function overshootAndRound(order: Pt[], style: StarStyle, isTip: (i: number) => boolean): Pt[] {
  let path = order;
  if (style.overshoot) {
    const [a, b] = order;
    path = [
      ...order,
      { x: a.x + (b.x - a.x) * style.overshoot, y: a.y + (b.y - a.y) * style.overshoot },
    ];
  }
  if (style.round) {
    for (let i = path.length - 2; i >= 1; i--) {
      if (isTip(i)) path = roundCorner(path, i, style.round);
    }
  }
  return path;
}

/** A five-point star's outline, as a hand draws it (see {@link StarStyle}). */
export function handStar(cx: number, cy: number, r: number, style: StarStyle, seed: number): Pt[] {
  const v = starVertices(cx, cy, r, style, rng(seed * 7919 + 13));
  const dir = style.direction ?? 1;
  const start = style.start ?? 0;
  const index = (k: number): number => (((start + dir * k) % 10) + 10) % 10;
  const order: Pt[] = [];
  for (let k = 0; k <= 10; k++) order.push(v[index(k)]);
  return overshootAndRound(order, style, (i) => index(i) % 2 === 0);
}

/** A one-stroke pentagram — tip to every other tip — as a hand draws it. */
export function handPentagram(
  cx: number,
  cy: number,
  r: number,
  style: StarStyle,
  seed: number,
): Pt[] {
  const tips = starVertices(cx, cy, r, style, rng(seed * 104729 + 7)).filter((_, i) => i % 2 === 0);
  const dir = style.direction ?? 1;
  const start = style.start ?? 0;
  const order: Pt[] = [];
  for (let k = 0; k <= 5; k++) order.push(tips[(((start + dir * 2 * k) % 5) + 5) % 5]);
  return overshootAndRound(order, style, () => true);
}

/**
 * Pencil ink from an ideal path: an optional pen-down hook `hook` px long at a
 * seeded random angle, 1.4 px samples (the stroke builder's spacing), hand
 * tremor, and a pressure that wanders the way a pen reports it.
 */
export function pencilInk(
  poly: readonly Pt[],
  seed: number,
  opts: { hook?: number } = {},
): number[] {
  const rand = rng(seed);
  let base: Pt[] = [...poly];
  const hookLen = opts.hook ?? 0;
  if (hookLen > 0) {
    const a = rand() * 2 * Math.PI;
    const p0 = poly[0];
    const lead: Pt[] = [];
    for (let i = 5; i >= 1; i--) {
      const t = i / 5;
      lead.push({ x: p0.x + hookLen * t * Math.cos(a), y: p0.y + hookLen * t * Math.sin(a) });
    }
    base = [...lead, ...base];
  }
  const drawn = tremor(resample(base, 1.4), rand, { amplitude: 1.1 });
  const out: number[] = [];
  for (const p of drawn) out.push(p.x, p.y, 0.45 + rand() * 0.2);
  return out;
}

export interface RetraceOptions {
  /** A pen-down hook: length px and absolute direction, degrees. */
  hook?: [number, number];
  /** Back along the line: fraction of its length, deviation from straight back (degrees), sideways offset at the turn (px). */
  retrace?: [number, number, number];
  /** A lift tail at the very end: length px and direction relative to the line (degrees; 180 = straight back). */
  tail?: [number, number];
}

/**
 * A straight line from `from`, `len` px at `deg`, drawn with a pen: a
 * pen-down hook, a retrace back along it (Apple Notes' arrow gesture), and
 * a lift tail, each optional. Pencil density and tremor, as flat pts.
 */
export function retracedLine(
  from: Pt,
  len: number,
  deg: number,
  opts: RetraceOptions,
  seed: number,
): number[] {
  const at = (a: Pt, l: number, d: number): Pt => ({
    x: a.x + l * Math.cos((d * Math.PI) / 180),
    y: a.y + l * Math.sin((d * Math.PI) / 180),
  });
  const tip = at(from, len, deg);
  let poly: Pt[] = [from, tip];
  if (opts.hook) poly = [at(from, opts.hook[0], opts.hook[1]), ...poly];
  if (opts.retrace) {
    const [fraction, dev, offset] = opts.retrace;
    const turn = at(tip, offset, deg + 90);
    poly = [...poly, turn, at(turn, fraction * len, deg + 180 + dev)];
  }
  if (opts.tail) poly = [...poly, at(poly[poly.length - 1], opts.tail[0], deg + opts.tail[1])];
  const rand = rng(seed);
  const drawn = tremor(resample(poly, 1.4), rand, { amplitude: 1.1 });
  return flat(drawn, rand);
}
