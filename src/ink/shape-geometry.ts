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

/**
 * The Shape tool's closed presets, in the order its options pill shows them.
 * Each is dragged out as its bounding box.
 */
export type BoxPreset = "rect" | "ellipse" | "triangle" | "diamond" | "roundrect" | "star";

export const SHAPE_PRESETS: readonly BoxPreset[] = [
  "rect",
  "ellipse",
  "triangle",
  "diamond",
  "roundrect",
  "star",
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
 * head is at `to`. Returns `[]` when the two points coincide.
 */
function connectorGeometry(preset: ConnectorPreset, from: Pt, to: Pt, pressure: number): number[] {
  const span = Math.hypot(to.x - from.x, to.y - from.y);
  if (!(span > 0) || !Number.isFinite(span)) return [];
  const points = preset === "line" ? [from, to] : arrowPoints(from, to);
  return flatten(points, pressure);
}

/**
 * A preset shape inscribed in the box spanned by two corners, drawn clockwise
 * on screen from the top-left, closing point repeated. Returns `[]` for a
 * degenerate box — callers treat that as "nothing to draw". Connectors (line,
 * arrow) run from `from` to `to` instead.
 */
export function presetGeometry(preset: ShapePreset, from: Pt, to: Pt, pressure: number): number[] {
  if (preset === "line" || preset === "arrow") return connectorGeometry(preset, from, to, pressure);
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

/** Kinds whose geometry is a closed loop; the rest are open (line, arrow). */
export function isClosedKind(kind: ShapeKind): boolean {
  return kind !== "line" && kind !== "arrow";
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
