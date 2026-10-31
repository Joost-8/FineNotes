/**
 * Clean shape geometry: the Shape tool's preset shapes, the transform that
 * lets a snapped shape be resized and rotated while the pen is still held,
 * and the densifying pass that makes sparse geometry render faithfully.
 *
 * Pure: no DOM, no Obsidian, no clock. Output is the flat `[x, y, p, …]`
 * layout of `Stroke.pts`, rounded to serialize.ts's 1/100 px so a shape
 * survives a save/load round-trip unchanged.
 */

import { POINT_STRIDE, type ShapeKind } from "../model/document";
import { LINE_LEVEL_RISE, levelTurn } from "./level-line";

/**
 * The Shape tool's closed presets, in the order its options pill shows them.
 * Each is dragged out as its bounding box.
 */
export type BoxPreset =
  "rect" | "ellipse" | "triangle" | "diamond" | "roundrect" | "star" | "heart";

export const SHAPE_PRESETS: readonly BoxPreset[] = [
  "rect",
  "ellipse",
  "triangle",
  "diamond",
  "roundrect",
  "star",
  "heart",
];

/**
 * GoodNotes' two connector tools: dragged from start to end rather than
 * corner to corner, so the direction of the drag is kept.
 */
export type ConnectorPreset = "line" | "arrow";

export const CONNECTOR_PRESETS: readonly ConnectorPreset[] = ["line", "arrow"];

/** Every preset the Shape tool places as one stroke. */
export type ShapePreset = BoxPreset | ConnectorPreset;

/**
 * What the Shape tool draws: recognise freehand input, place a preset, or
 * place a table (src/ink/table-geometry.ts), which is several strokes.
 */
export type ShapeMode = "auto" | ShapePreset | "table";

export function isShapeMode(value: unknown): value is ShapeMode {
  return (
    value === "auto" ||
    value === "table" ||
    SHAPE_PRESETS.includes(value as BoxPreset) ||
    CONNECTOR_PRESETS.includes(value as ConnectorPreset)
  );
}

export function isConnectorPreset(value: ShapeMode): value is ConnectorPreset {
  return CONNECTOR_PRESETS.includes(value as ConnectorPreset);
}

/** Segments used for a full ellipse; enough to look round at any page zoom. */
export const ELLIPSE_SEGMENTS = 64;
/** Segments per quarter-circle corner of a rounded rectangle. */
const CORNER_SEGMENTS = 8;
/** Rounded-rect corner radius as a fraction of the shorter side. */
const ROUNDRECT_RADIUS_FRACTION = 0.2;
/**
 * Notch radius over tip radius of the preset star: the classic five-point
 * star, whose notches sit where a pentagram's lines cross (cos 72° / cos 36°).
 */
export const STAR_INNER_RATIO = Math.cos((72 * Math.PI) / 180) / Math.cos((36 * Math.PI) / 180);
/** Height over width of a regular five-point star standing on two tips (≈ 0.951). */
export const STAR_ASPECT =
  (1 + Math.cos((36 * Math.PI) / 180)) / (2 * Math.sin((72 * Math.PI) / 180));
/**
 * An emitted arrowhead (the connector preset, and the retrace gesture, whose
 * head nobody drew): barbs this fraction of the shaft, clamped to a size that
 * reads at page scale, at this half-angle. The clamp keeps the barbs inside
 * the one-stroke arrow fitter's 6 % floor up to a 660 px shaft, so a placed
 * arrow re-reads as an arrow.
 */
const ARROW_HEAD_FRACTION = 0.18;
const ARROW_HEAD_MIN_PX = 12;
const ARROW_HEAD_MAX_PX = 40;
export const ARROW_HEAD_DEG = 30;

export interface Pt {
  x: number;
  y: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function flatten(points: readonly Pt[], pressure: number): number[] {
  const out: number[] = [];
  for (const p of points) out.push(round2(p.x), round2(p.y), pressure);
  return out;
}

/**
 * Points around an ellipse centred on (`cx`, `cy`) with semi-axes `a` along
 * `theta` and `b` across it, starting at `start` radians and turning in
 * `direction` (+1 or -1). The closing point is repeated.
 */
export function ellipsePoints(
  cx: number,
  cy: number,
  a: number,
  b: number,
  theta: number,
  start = 0,
  direction = 1,
  segments = ELLIPSE_SEGMENTS,
): Pt[] {
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const out: Pt[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = start + (direction * (2 * Math.PI * i)) / segments;
    const u = a * Math.cos(t);
    const v = b * Math.sin(t);
    out.push({ x: cx + u * cos - v * sin, y: cy + u * sin + v * cos });
  }
  return out;
}

/**
 * The outline of a regular five-point star: tips at radius `outer` every 72°
 * from `phase` (radians), notches at `inner` halfway between. Ten vertices
 * plus the repeated closing point, starting at vertex `start` (even = a tip,
 * odd = a notch) and turning in `direction` (+1 or -1).
 */
export function starPoints(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  phase: number,
  start = 0,
  direction = 1,
): Pt[] {
  const out: Pt[] = [];
  for (let k = 0; k <= 10; k++) {
    const i = start + direction * k;
    const radius = Math.abs(i % 2) === 0 ? outer : inner;
    const angle = phase + (i * Math.PI) / 5;
    out.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
  }
  return out;
}

/**
 * A one-stroke pentagram: from tip `start` to every other tip and back, five
 * edges plus the repeated closing point. Tips sit at radius `outer` every 72°
 * from `phase`; `direction` (+1 or -1) is the way the pen turns.
 */
export function pentagramPoints(
  cx: number,
  cy: number,
  outer: number,
  phase: number,
  start = 0,
  direction = 1,
): Pt[] {
  const out: Pt[] = [];
  for (let k = 0; k <= 5; k++) {
    const angle = phase + ((start + 2 * direction * k) * 2 * Math.PI) / 5;
    out.push({ x: cx + outer * Math.cos(angle), y: cy + outer * Math.sin(angle) });
  }
  return out;
}

/** An angle folded into (−π, π]. */
function wrapAngle(a: number): number {
  let v = a;
  while (v > Math.PI) v -= 2 * Math.PI;
  while (v <= -Math.PI) v += 2 * Math.PI;
  return v;
}

/**
 * Relative widths of a cloud's bumps, going round from the top. Even bumps
 * evenly round an ellipse read as a flower (Joost, 2026-10-01); a cloud's
 * bumps differ.
 */
const CLOUD_WIDTHS = [1.0, 1.35, 0.85, 1.2, 0.9, 1.25, 0.8, 1.1, 1.3, 0.9, 1.15, 0.95];
/**
 * A bump's bulge over the chord between its two dips: rounder on top, flatter
 * underneath, as a cloud is. Both under a half circle (0.5 is one), so the
 * dips stay soft instead of pinched.
 */
const CLOUD_TOP_BULGE = 0.55;
const CLOUD_BOTTOM_BULGE = 0.35;
/** Bumps a cloud gets: fewer than 7 looks lumpy rather than cloudy. */
const CLOUD_MIN_BUMPS = 7;
const CLOUD_MAX_BUMPS = 12;
/** Straight pieces per bump. */
const CLOUD_ARC_SEGMENTS = 14;

/**
 * A cloud filling the box (`x0`, `y0`, `w` × `h`), with bumps on every side:
 * `bumps` arcs (clamped to 7–12) of uneven width between dips that sit round
 * an ellipse, the widest and roundest on top. Stretched so the outline
 * touches all four sides. It begins at the dip nearest `from` (the pen-down
 * point; the top when absent) and goes round in `direction` (+1 or -1, the
 * way `atan2` angles grow). The closing point is repeated.
 */
export function cloudPoints(
  x0: number,
  y0: number,
  w: number,
  h: number,
  bumps: number,
  from: Pt | null = null,
  direction = 1,
): Pt[] {
  const n = Math.min(CLOUD_MAX_BUMPS, Math.max(CLOUD_MIN_BUMPS, Math.round(bumps)));
  const widths = Array.from({ length: n }, (_, i) => CLOUD_WIDTHS[i % CLOUD_WIDTHS.length]);
  const total = widths.reduce((s, v) => s + v, 0);
  // Laid out on an ellipse of the box's proportions; the first bump centred on top.
  const a = h > 0 ? Math.min(3, Math.max(1, w / h)) / 2 : 0.5;
  const b = 0.5;
  const cusps: Pt[] = [];
  let at = -Math.PI / 2 - (widths[0] / total) * Math.PI;
  for (const width of widths) {
    cusps.push({ x: a * Math.cos(at), y: b * Math.sin(at) });
    at += (width / total) * 2 * Math.PI;
  }
  const unit: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const p = cusps[i];
    const q = cusps[(i + 1) % n];
    const chord = Math.hypot(q.x - p.x, q.y - p.y);
    const mx = (p.x + q.x) / 2;
    const my = (p.y + q.y) / 2;
    const ml = Math.hypot(mx, my) || 1;
    const nx = mx / ml;
    const ny = my / ml;
    // +1 at the top of the cloud (y grows downward), -1 at the bottom.
    const up = Math.max(-1, Math.min(1, -my / b));
    const bulge = CLOUD_BOTTOM_BULGE + ((CLOUD_TOP_BULGE - CLOUD_BOTTOM_BULGE) * (up + 1)) / 2;
    // The arc through both dips whose apex stands `bulge` × chord outside it.
    const sagitta = bulge * chord;
    const radius = (chord * chord) / 4 / (2 * sagitta) + sagitta / 2;
    const cx = mx + nx * (sagitta - radius);
    const cy = my + ny * (sagitta - radius);
    const a0 = Math.atan2(p.y - cy, p.x - cx);
    const sweep0 = wrapAngle(Math.atan2(q.y - cy, q.x - cx) - a0);
    const toApex = wrapAngle(Math.atan2(ny, nx) - a0);
    const viaApex = Math.sign(toApex) === Math.sign(sweep0) && Math.abs(toApex) < Math.abs(sweep0);
    const sweep = viaApex ? sweep0 : sweep0 - Math.sign(sweep0) * 2 * Math.PI;
    for (let k = 0; k < CLOUD_ARC_SEGMENTS; k++) {
      const t = a0 + (sweep * k) / CLOUD_ARC_SEGMENTS;
      unit.push({ x: cx + radius * Math.cos(t), y: cy + radius * Math.sin(t) });
    }
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of unit) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  let ring = unit.map((p) => ({
    x: x0 + ((p.x - minX) / (maxX - minX)) * w,
    y: y0 + ((p.y - minY) / (maxY - minY)) * h,
  }));
  // The layout goes round the way atan2 angles grow; turn it the pen's way.
  if (direction < 0) ring = [ring[0], ...ring.slice(1).reverse()];
  // Begin at the dip nearest the pen-down point.
  if (from) {
    let start = 0;
    let nearest = Infinity;
    for (let k = 0; k < ring.length; k += CLOUD_ARC_SEGMENTS) {
      const d = Math.hypot(ring[k].x - from.x, ring[k].y - from.y);
      if (d < nearest) {
        nearest = d;
        start = k;
      }
    }
    ring = ring.slice(start).concat(ring.slice(0, start));
  }
  ring.push({ ...ring[0] });
  return ring;
}

/** Straight pieces round a heart; enough to stay smooth on its lobes at any zoom. */
export const HEART_SEGMENTS = 72;

/**
 * The classic heart curve (x = 16 sin³t, y = 13 cos t − 5 cos 2t − 2 cos 3t
 * − cos 4t, y flipped for the screen), `HEART_SEGMENTS` + 1 samples from
 * the cusp at the top (t = 0) clockwise on screen: the right lobe, the tip
 * at t = π, the left lobe, and the cusp again. Its cusp and tip are where
 * the curve's speed falls to zero, so even samples in t crowd there and
 * both points stay sharp.
 */
function heartCurve(): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= HEART_SEGMENTS; i++) {
    const t = (2 * Math.PI * i) / HEART_SEGMENTS;
    const s = Math.sin(t);
    out.push({
      x: 16 * s * s * s,
      y: -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)),
    });
  }
  return out;
}

/**
 * The heart curve scaled into the unit box centred on the origin (−½ … ½
 * both ways), cusp up. Computed once.
 */
const HEART_UNIT: readonly Pt[] = (() => {
  const raw = heartCurve();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of raw) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return raw.map((p) => ({
    x: (p.x - minX) / (maxX - minX) - 0.5,
    y: (p.y - minY) / (maxY - minY) - 0.5,
  }));
})();

/** Height over width of the heart curve's bounding box (≈ 0.90). */
export const HEART_ASPECT = (() => {
  const raw = heartCurve();
  const xs = raw.map((p) => p.x);
  const ys = raw.map((p) => p.y);
  return (Math.max(...ys) - Math.min(...ys)) / (Math.max(...xs) - Math.min(...xs));
})();

/**
 * A heart filling a `w` × `h` box centred on (`cx`, `cy`), turned `phi`
 * radians from upright (cusp up, tip down). It begins at the sample nearest
 * `from` (the pen-down point; the cusp when absent) and goes round in
 * `direction` (+1 clockwise on screen when upright, −1 the other way). The
 * closing point is repeated.
 */
export function heartPoints(
  cx: number,
  cy: number,
  w: number,
  h: number,
  phi = 0,
  from: Pt | null = null,
  direction = 1,
): Pt[] {
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  let ring = HEART_UNIT.slice(0, -1).map((p) => {
    const u = p.x * w;
    const v = p.y * h;
    return { x: cx + u * cos - v * sin, y: cy + u * sin + v * cos };
  });
  if (direction < 0) ring = [ring[0], ...ring.slice(1).reverse()];
  if (from) {
    let start = 0;
    let nearest = Infinity;
    ring.forEach((p, k) => {
      const d = Math.hypot(p.x - from.x, p.y - from.y);
      if (d < nearest) {
        nearest = d;
        start = k;
      }
    });
    ring = ring.slice(start).concat(ring.slice(0, start));
  }
  ring.push({ ...ring[0] });
  return ring;
}

/** Straight pieces a full turn of an arc would get; a part of a turn gets its share. */
export const ARC_SEGMENTS_PER_TURN = 64;

/**
 * Points along a circular arc about (`cx`, `cy`) of radius `r`, from angle
 * `start` turning `sweep` radians (negative turns the other way): the two
 * ends exactly, and a sample at least every 5.625°.
 */
export function arcPoints(cx: number, cy: number, r: number, start: number, sweep: number): Pt[] {
  const segments = Math.max(
    2,
    Math.ceil((Math.abs(sweep) / (2 * Math.PI)) * ARC_SEGMENTS_PER_TURN - 1e-9),
  );
  const out: Pt[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = start + (sweep * i) / segments;
    out.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
  }
  return out;
}

/**
 * A sector (a pie slice) as one closed outline: the centre, out along the
 * first radius, round the arc, back along the second radius to the centre.
 * A half turn is a semicircle closed by its diameter, the centre then the
 * middle of that straight side.
 */
export function sectorPoints(
  cx: number,
  cy: number,
  r: number,
  start: number,
  sweep: number,
): Pt[] {
  return [{ x: cx, y: cy }, ...arcPoints(cx, cy, r, start, sweep), { x: cx, y: cy }];
}

/**
 * A clean arrow from `tail` to `tip` in contracts/api.md §2's layout — shaft,
 * then the V retraced through the tip: `[tail, tip, tip, barb, tip, barb]`.
 * The head is sized from the shaft (see {@link ARROW_HEAD_FRACTION}).
 */
export function arrowPoints(tail: Pt, tip: Pt, headDeg = ARROW_HEAD_DEG): Pt[] {
  const span = Math.hypot(tip.x - tail.x, tip.y - tail.y);
  if (!(span > 0)) return [];
  const barb = Math.min(ARROW_HEAD_MAX_PX, Math.max(ARROW_HEAD_MIN_PX, ARROW_HEAD_FRACTION * span));
  // Never longer than the shaft itself, or a short arrow is all head.
  const len = Math.min(barb, span * 0.45);
  const backX = (tail.x - tip.x) / span;
  const backY = (tail.y - tip.y) / span;
  const head = (headDeg * Math.PI) / 180;
  const rotate = (sign: number): Pt => {
    const c = Math.cos(sign * head);
    const s = Math.sin(sign * head);
    return { x: tip.x + len * (backX * c - backY * s), y: tip.y + len * (backX * s + backY * c) };
  };
  return [{ ...tail }, { ...tip }, { ...tip }, rotate(1), { ...tip }, rotate(-1)];
}

/**
 * A connector preset dragged from `from` to `to`: a line, or an arrow whose
 * head is at `to`. Returns `[]` when the two points coincide. Dragged with
 * its end within `levelRise` page px of level or upright it is made exactly
 * so, turned about `from`, where the pen went down (`level-line.ts`).
 */
function connectorGeometry(
  preset: ConnectorPreset,
  from: Pt,
  to: Pt,
  pressure: number,
  levelRise: number,
): number[] {
  const span = Math.hypot(to.x - from.x, to.y - from.y);
  if (!(span > 0) || !Number.isFinite(span)) return [];
  const turn = levelTurn(to.x - from.x, to.y - from.y, levelRise);
  const end =
    turn === 0
      ? to
      : Math.abs(to.x - from.x) >= Math.abs(to.y - from.y)
        ? { x: from.x + Math.sign(to.x - from.x) * span, y: from.y }
        : { x: from.x, y: from.y + Math.sign(to.y - from.y) * span };
  const points = preset === "line" ? [from, end] : arrowPoints(from, end);
  return flatten(points, pressure);
}

/**
 * A preset shape inscribed in the box spanned by two corners, drawn clockwise
 * on screen from the top-left, closing point repeated. Returns `[]` for a
 * degenerate box — callers treat that as "nothing to draw". Connectors (line,
 * arrow) run from `from` to `to` instead.
 */
export function presetGeometry(
  preset: ShapePreset,
  from: Pt,
  to: Pt,
  pressure: number,
  levelRise = LINE_LEVEL_RISE,
): number[] {
  if (preset === "line" || preset === "arrow") {
    return connectorGeometry(preset, from, to, pressure, levelRise);
  }
  const x0 = Math.min(from.x, to.x);
  const y0 = Math.min(from.y, to.y);
  const x1 = Math.max(from.x, to.x);
  const y1 = Math.max(from.y, to.y);
  const w = x1 - x0;
  const h = y1 - y0;
  if (!(w > 0) || !(h > 0) || !Number.isFinite(w + h)) return [];
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;

  let points: Pt[];
  switch (preset) {
    case "rect":
      points = [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
        { x: x0, y: y0 },
      ];
      break;
    case "ellipse":
      // Start at the top and run clockwise, like the other presets.
      points = ellipsePoints(cx, cy, w / 2, h / 2, 0, -Math.PI / 2, 1);
      break;
    case "triangle":
      // Isosceles, apex at top centre — what GoodNotes' preset places.
      points = [
        { x: cx, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
        { x: cx, y: y0 },
      ];
      break;
    case "diamond":
      points = [
        { x: cx, y: y0 },
        { x: x1, y: cy },
        { x: cx, y: y1 },
        { x: x0, y: cy },
        { x: cx, y: y0 },
      ];
      break;
    case "roundrect":
      points = roundRectPoints(x0, y0, x1, y1);
      break;
    case "star":
      points = boxedStar(x0, y0, w, h);
      break;
    case "heart":
      // From the cusp, clockwise, like the other presets.
      points = heartPoints(cx, cy, w, h);
      break;
  }
  return flatten(points, pressure);
}

/**
 * The classic star, one tip straight up, stretched to fill the box exactly —
 * like the ellipse preset, the box is the shape's extent, not a square it
 * sits inside. Clockwise from the top tip.
 */
function boxedStar(x0: number, y0: number, w: number, h: number): Pt[] {
  const unit = starPoints(0, 0, 1, STAR_INNER_RATIO, -Math.PI / 2);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of unit) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return unit.map((p) => ({
    x: x0 + ((p.x - minX) / (maxX - minX)) * w,
    y: y0 + ((p.y - minY) / (maxY - minY)) * h,
  }));
}

function roundRectPoints(x0: number, y0: number, x1: number, y1: number): Pt[] {
  const r = Math.min(x1 - x0, y1 - y0) * ROUNDRECT_RADIUS_FRACTION;
  // Corner centres and the angle each quarter-arc starts at, clockwise on
  // screen (y grows downward) from the top-right corner.
  const arcs: Array<[number, number, number]> = [
    [x1 - r, y0 + r, -Math.PI / 2],
    [x1 - r, y1 - r, 0],
    [x0 + r, y1 - r, Math.PI / 2],
    [x0 + r, y0 + r, Math.PI],
  ];
  const out: Pt[] = [];
  for (const [cx, cy, start] of arcs) {
    for (let i = 0; i <= CORNER_SEGMENTS; i++) {
      const t = start + (Math.PI / 2) * (i / CORNER_SEGMENTS);
      out.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
    }
  }
  out.push({ ...out[0] });
  return out;
}

/** Kinds whose geometry is a closed loop; the rest are open (line, arrow, arc). */
export function isClosedKind(kind: ShapeKind): boolean {
  return kind !== "line" && kind !== "arrow" && kind !== "arc" && kind !== "angle";
}

/**
 * The fixed point a held shape is resized and rotated about. An open shape
 * pivots on its first point, so a line's far end follows the pen; a closed
 * one on the centre of its bounding box, so it grows evenly.
 */
export function shapePivot(kind: ShapeKind, pts: readonly number[]): Pt | null {
  if (pts.length < POINT_STRIDE) return null;
  if (!isClosedKind(kind)) return { x: pts[0], y: pts[1] };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < pts.length; i += POINT_STRIDE) {
    minX = Math.min(minX, pts[i]);
    maxX = Math.max(maxX, pts[i]);
    minY = Math.min(minY, pts[i + 1]);
    maxY = Math.max(maxY, pts[i + 1]);
  }
  if (!Number.isFinite(minX + minY + maxX + maxY)) return null;
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

/** Below this pen-to-pivot distance a rotation angle is meaningless noise. */
const MIN_HANDLE = 4;

/**
 * The similarity transform about `pivot` that carries `from` onto `to`,
 * applied to `pts`. This is how a snapped shape follows the pen while it is
 * still held: distance from the pivot scales it, the angle around it rotates.
 * Returns `pts` unchanged when `from` sits too close to the pivot to define
 * an angle.
 */
export function transformShape(pts: readonly number[], pivot: Pt, from: Pt, to: Pt): number[] {
  const fx = from.x - pivot.x;
  const fy = from.y - pivot.y;
  const tx = to.x - pivot.x;
  const ty = to.y - pivot.y;
  const fromLen = Math.hypot(fx, fy);
  if (fromLen < MIN_HANDLE || !Number.isFinite(fromLen + tx + ty)) return pts.slice();
  const scale = Math.hypot(tx, ty) / fromLen;
  const angle = Math.atan2(ty, tx) - Math.atan2(fy, fx);
  const c = Math.cos(angle) * scale;
  const s = Math.sin(angle) * scale;
  const out = pts.slice();
  const usable = out.length - (out.length % POINT_STRIDE);
  for (let i = 0; i < usable; i += POINT_STRIDE) {
    const dx = out[i] - pivot.x;
    const dy = out[i + 1] - pivot.y;
    out[i] = round2(pivot.x + dx * c - dy * s);
    out[i + 1] = round2(pivot.y + dx * s + dy * c);
  }
  return out;
}
