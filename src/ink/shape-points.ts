/**
 * Editing a shape's points (FineNotes discussion #51): with one shape
 * selected, a handle on each of its corners or ends drags that point alone,
 * apart from the selection's resize and rotate handles.
 *
 * Which points get a handle is read off the geometry, never off the kind's
 * layout (contracts/api.md §2: an erased piece keeps its kind but not its
 * layout). A handle is a distinct vertex; copies of one point (a closed
 * shape's repeated first point, an arrow's tip) are one handle and move
 * together. Curved kinds (circles, ellipses, rounded rectangles, clouds,
 * hearts, arcs, sectors, segments) have no corners, so their handles are
 * spaced evenly along the outline and a drag bends it: the point follows the
 * pen and its neighbours follow it, less and less (a smooth falloff), so the
 * outline stays one smooth curve and keeps its kind. A whole arrow is the one
 * layout recognised, and only after checking it: its tail and tip are handles
 * and the head follows the shaft.
 *
 * Moving a corner of a whole `rect` or `diamond` makes it a `polygon` (four
 * corners, no longer square), which is what the contract's layout table
 * then says it is. Every other kind keeps its kind.
 *
 * PURE: no DOM. Output is a fresh points array, so the renderer's path
 * cache, which keys on the array's identity, traces it again
 * (CLAUDE.md "A stroke's end points cannot see a turn").
 */

import { POINT_STRIDE, type ShapeKind } from "../model/document";
import {
  type ConnectorHandles,
  type HandleLook,
  connectorHandles,
  dragConnector,
  isEndHandle,
} from "./connector-edit";

export interface Pt {
  x: number;
  y: number;
}

/** No more handles than this: more vertices than a star's ten is a curve, not corners. */
export const MAX_POINT_HANDLES = 12;

/** A line or an arrow's shaft never gets shorter than this, page px. */
const MIN_SPAN = 1;

/** Kinds drawn as curves: their points are samples, not corners; each gets handles along the outline. */
const CURVED: ReadonlySet<ShapeKind> = new Set<ShapeKind>([
  "circle",
  "ellipse",
  "roundrect",
  "cloud",
  "heart",
  "arc",
  "sector",
  "segment",
]);

/** The handles of one shape. */
export interface PointHandles {
  /** Where each handle sits, page px: x, y, x, y, … */
  at: number[];
  /** The points (indices into `pts` / {@link POINT_STRIDE}) each handle moves. */
  points: number[][];
  /** A whole arrow: handle 0 is its tail, handle 1 its tip, and the head follows. */
  arrow: boolean;
  /**
   * A curve: its `n` distinct samples (a closed outline's repeated first point
   * not counted), whether it is `closed`, and how many samples either side of
   * a handle follow it (`span`).
   */
  curve?: { n: number; closed: boolean; span: number };
  /**
   * A connector (a line, a curve, an elbow; `ink/connector-edit`): its
   * handles bend it or slide its runs instead of moving one point each.
   */
  connector?: ConnectorHandles;
  /** How each handle is drawn; absent, every one is a ring. */
  looks?: HandleLook[];
}

/** Handles along a closed curve, and along an open one (ends included). */
const CURVE_HANDLES_CLOSED = 8;
const CURVE_HANDLES_OPEN = 5;
/** Fewer samples than this is not a curve worth bending. */
const MIN_CURVE_SAMPLES = 8;

/** Evenly spaced handles along a curved shape's outline, or null when it has too few samples. */
function curveHandles(pts: readonly number[]): PointHandles | null {
  const count = Math.floor(pts.length / POINT_STRIDE);
  if (count < MIN_CURVE_SAMPLES) return null;
  for (let i = 0; i < count; i++) {
    if (!Number.isFinite(pts[i * POINT_STRIDE] + pts[i * POINT_STRIDE + 1])) return null;
  }
  const x = (i: number): number => pts[i * POINT_STRIDE];
  const y = (i: number): number => pts[i * POINT_STRIDE + 1];
  const closed = Math.hypot(x(0) - x(count - 1), y(0) - y(count - 1)) < 1e-6;
  const n = closed ? count - 1 : count;
  // Handles on fixed samples (evenly by index), so after a bend each one is
  // still on the sample it moved: re-spacing them along the new outline made
  // the one just dragged jump away from the pen.
  const wanted = closed ? CURVE_HANDLES_CLOSED : CURVE_HANDLES_OPEN;
  const at: number[] = [];
  const points: number[][] = [];
  let last = -1;
  for (let k = 0; k < wanted; k++) {
    const i = closed ? Math.round((k * n) / wanted) : Math.round((k * (n - 1)) / (wanted - 1));
    if (i <= last || i > n - 1) continue;
    last = i;
    at.push(x(i), y(i));
    points.push(closed && i === 0 ? [0, count - 1] : [i]);
  }
  if (points.length < 3) return null;
  const span = Math.max(2, Math.round(n / (closed ? points.length : points.length - 1)));
  return { at, points, arrow: false, curve: { n, closed, span } };
}

/** `pts` with the curve's sample under handle `handle` pulled to `to`, and its neighbours part of the way. */
function bendCurve(
  pts: readonly number[],
  handles: PointHandles,
  handle: number,
  to: Pt,
): number[] | null {
  const curve = handles.curve;
  const centre = handles.points[handle]?.[0];
  if (!curve || centre === undefined) return null;
  const dx = to.x - handles.at[handle * 2];
  const dy = to.y - handles.at[handle * 2 + 1];
  const out = pts.slice();
  for (let i = 0; i < curve.n; i++) {
    const apart = Math.abs(i - centre);
    const d = curve.closed ? Math.min(apart, curve.n - apart) : apart;
    if (d >= curve.span) continue;
    const w = Math.cos((Math.PI / 2) * (d / curve.span)) ** 2;
    out[i * POINT_STRIDE] = round2(pts[i * POINT_STRIDE] + dx * w);
    out[i * POINT_STRIDE + 1] = round2(pts[i * POINT_STRIDE + 1] + dy * w);
  }
  if (curve.closed) {
    const last = curve.n * POINT_STRIDE;
    out[last] = out[0];
    out[last + 1] = out[1];
  }
  return out;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** A whole arrow, checked: `[tail, tip, tip, barb, tip, barb]` with a shaft. */
function isWholeArrow(kind: ShapeKind | undefined, pts: readonly number[]): boolean {
  if (kind !== "arrow" || pts.length !== 6 * POINT_STRIDE) return false;
  const same = (i: number, j: number): boolean =>
    pts[i * POINT_STRIDE] === pts[j * POINT_STRIDE] &&
    pts[i * POINT_STRIDE + 1] === pts[j * POINT_STRIDE + 1];
  return same(1, 2) && same(1, 4) && !same(0, 1);
}

/**
 * The point handles of a stroke of `kind` with points `pts`, or `null` when
 * it gets none: handwriting, a curved kind, fewer than two distinct points,
 * or more than {@link MAX_POINT_HANDLES}.
 */
export function pointHandles(
  kind: ShapeKind | undefined,
  pts: readonly number[],
): PointHandles | null {
  if (kind === undefined) return null;
  if (CURVED.has(kind)) return curveHandles(pts);
  const connector = connectorHandles(kind, pts);
  if (connector) {
    return {
      at: connector.at,
      points: connector.at.filter((_, i) => i % 2 === 0).map(() => []),
      arrow: false,
      connector,
      looks: connector.looks,
    };
  }
  const count = Math.floor(pts.length / POINT_STRIDE);
  if (isWholeArrow(kind, pts)) {
    return {
      at: [pts[0], pts[1], pts[POINT_STRIDE], pts[POINT_STRIDE + 1]],
      points: [[0], [1, 2, 4]],
      arrow: true,
    };
  }
  const at: number[] = [];
  const points: number[][] = [];
  for (let i = 0; i < count; i++) {
    const x = pts[i * POINT_STRIDE];
    const y = pts[i * POINT_STRIDE + 1];
    if (!Number.isFinite(x + y)) return null;
    let found = -1;
    for (let h = 0; h < points.length; h++) {
      if (at[h * 2] === x && at[h * 2 + 1] === y) {
        found = h;
        break;
      }
    }
    if (found >= 0) {
      points[found].push(i);
      continue;
    }
    if (points.length === MAX_POINT_HANDLES) return null;
    at.push(x, y);
    points.push([i]);
  }
  return points.length >= 2 ? { at, points, arrow: false } : null;
}

/**
 * `pts` with handle `handle` of `handles` moved to `to`: a fresh array, and
 * the kind it then is. An arrow's head is carried round with its shaft, the
 * barbs' lengths, angles and sides kept. `null` when the move would leave a
 * line or a shaft shorter than a px, or `to` is not a point.
 */
export function movePoint(
  kind: ShapeKind,
  pts: readonly number[],
  handles: PointHandles,
  handle: number,
  to: Pt,
): { pts: number[]; kind: ShapeKind } | null {
  const moving = handles.points[handle];
  if (!moving || !Number.isFinite(to.x + to.y)) return null;
  if (handles.curve) {
    const bent = bendCurve(pts, handles, handle, to);
    return bent ? { pts: bent, kind } : null;
  }
  if (handles.connector) {
    return kind === "line" || kind === "path"
      ? dragConnector(kind, handles.connector, handle, to)
      : null;
  }
  const x = round2(to.x);
  const y = round2(to.y);
  const out = pts.slice();
  for (const i of moving) {
    out[i * POINT_STRIDE] = x;
    out[i * POINT_STRIDE + 1] = y;
  }
  if (handles.arrow) {
    if (!carryHead(pts, out)) return null;
  } else if (handles.points.length === 2 && !isClosed(handles)) {
    const [a, b] = [handles.points[0][0], handles.points[1][0]];
    const span = Math.hypot(
      out[b * POINT_STRIDE] - out[a * POINT_STRIDE],
      out[b * POINT_STRIDE + 1] - out[a * POINT_STRIDE + 1],
    );
    if (span < MIN_SPAN) return null;
  }
  // A whole rectangle or diamond with a corner moved is a quad; a piece of
  // one was never its kind's layout, and stays as it is.
  const squared = (kind === "rect" || kind === "diamond") && isClosed(handles);
  return { pts: out, kind: squared ? "polygon" : kind };
}

/** Some handle moves two copies of one point: the outline closes on itself. */
function isClosed(handles: PointHandles): boolean {
  return handles.points.some((list) => list.length > 1);
}

/**
 * Rebuild an arrow's barbs in `out` (tail and tip already moved) from the
 * head in `before`: each barb keeps its length and its angle off the shaft,
 * on the same side. False when the shaft has become too short to point.
 */
function carryHead(before: readonly number[], out: number[]): boolean {
  const S = POINT_STRIDE;
  const frame = (pts: readonly number[]): { ux: number; uy: number; span: number } => {
    const dx = pts[0] - pts[S];
    const dy = pts[1] - pts[S + 1];
    const span = Math.hypot(dx, dy);
    return { ux: dx / span, uy: dy / span, span };
  };
  const old = frame(before);
  const now = frame(out);
  if (!(now.span >= MIN_SPAN) || !(old.span > 0)) return false;
  const tipX = out[S];
  const tipY = out[S + 1];
  for (const barb of [3, 5]) {
    // The barb in the old shaft's frame: along it back towards the tail, and across.
    const vx = before[barb * S] - before[S];
    const vy = before[barb * S + 1] - before[S + 1];
    const along = vx * old.ux + vy * old.uy;
    const across = -vx * old.uy + vy * old.ux;
    out[barb * S] = round2(tipX + along * now.ux - across * now.uy);
    out[barb * S + 1] = round2(tipY + along * now.uy + across * now.ux);
  }
  return true;
}

/**
 * The handle a press at `p` grabs: the nearest within `radius` (page px),
 * and only when it is nearer than every one of `rivals` (the selection
 * frame's own handles), so neither set shadows the other. -1 for none.
 */
export function pickPointHandle(
  at: readonly number[],
  p: Pt,
  radius: number,
  rivals: readonly Pt[] = [],
): number {
  let best = -1;
  let bestDist = radius;
  for (let h = 0; h * 2 + 1 < at.length; h++) {
    const d = Math.hypot(at[h * 2] - p.x, at[h * 2 + 1] - p.y);
    if (d <= bestDist) {
      best = h;
      bestDist = d;
    }
  }
  if (best < 0) return -1;
  for (const rival of rivals) {
    if (Math.hypot(rival.x - p.x, rival.y - p.y) < bestDist) return -1;
  }
  return best;
}

/**
 * The point a dragged end is put level or upright with, when it is near
 * either: the other end of a straight line or a whole arrow. Null for every
 * other handle (a bend point, a run, a corner).
 */
export function levelAnchor(handles: PointHandles, handle: number): Pt | null {
  const connector = handles.connector;
  if (connector) {
    if (connector.kind !== "curve" || connector.knots.length !== 2) return null;
    if (!isEndHandle(connector, handle)) return null;
    return { ...connector.knots[handle === 0 ? 1 : 0] };
  }
  const { at, points, arrow } = handles;
  const line = arrow || (points.length === 2 && points.every((list) => list.length === 1));
  if (!line || handle < 0 || handle > 1) return null;
  const other = 1 - handle;
  return { x: at[other * 2], y: at[other * 2 + 1] };
}

/**
 * Whether a drag of handle `handle` snaps onto other shapes' points: a
 * corner or an end does; a bend point, a half-way dot or an elbow's run
 * does not (it would jump to a point it has no business on).
 */
export function snapsToShapes(handles: PointHandles, handle: number): boolean {
  return handles.connector ? isEndHandle(handles.connector, handle) : true;
}
