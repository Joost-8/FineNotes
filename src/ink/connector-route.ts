/**
 * Where a connector between two shapes runs (discussion #51, Goodnotes'
 * linked copies): from a side of one shape to a side of the other, in
 * right-angled runs, as few bends as will do, never back through either
 * shape where a simple detour avoids it.
 *
 * A connector holds no points (`ShapeConnector`); this module routes it from
 * the two shapes as they are, every time it is drawn, so it follows either
 * shape wherever a command or a drag takes it.
 *
 * - **Anchors.** A connector meets a shape where the line from the middle
 *   of its bounds towards the chosen side leaves the outline: the middle of a
 *   rectangle's side, a diamond's or an ellipse's extreme point, a
 *   triangle's slanted side half way up. Off the outline's polygon (a dot,
 *   a line), the middle of that side of the bounds.
 * - **Routes.** Out of each anchor along its side's outward normal to a
 *   stub just clear of the shape's bounds, then one of a few orthogonal
 *   shapes between the two stubs: an L (one bend), a Z or a U through the
 *   middle (two), or round the outside of both shapes (four). The first
 *   that leaves and arrives the right way and crosses neither shape's bounds
 *   wins, fewest bends first, then shortest.
 *
 * PURE: no DOM. Points are page px; shapes are flat `[x, y, p, …]`.
 */

import type { Bounds, ConnectorSide } from "../model/document";

export interface Pt {
  x: number;
  y: number;
}

const STRIDE = 3;

/** How far past a shape's bounds a connector runs before its first bend, page px. */
export const CONNECTOR_STUB = 24;

/** The outward normal of each side, y down. */
const NORMAL: Readonly<Record<ConnectorSide, Pt>> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

/** The side across from `side`. */
export function oppositeSide(side: ConnectorSide): ConnectorSide {
  return side === "top" ? "bottom" : side === "bottom" ? "top" : side === "left" ? "right" : "left";
}

/** The outward normal of `side`. */
export function sideNormal(side: ConnectorSide): Pt {
  return NORMAL[side];
}

/** The bounds of flat points, or null when there is not one whole point. */
export function boundsOfPts(pts: readonly number[]): Bounds | null {
  const n = Math.floor(pts.length / STRIDE);
  if (n === 0) return null;
  const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (let i = 0; i < n; i++) {
    const x = pts[i * STRIDE];
    const y = pts[i * STRIDE + 1];
    if (!Number.isFinite(x + y)) return null;
    if (x < b.minX) b.minX = x;
    if (x > b.maxX) b.maxX = x;
    if (y < b.minY) b.minY = y;
    if (y > b.maxY) b.maxY = y;
  }
  return b;
}

/** The middle of `side` of `b`. */
export function sideMiddle(b: Bounds, side: ConnectorSide): Pt {
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  switch (side) {
    case "top":
      return { x: cx, y: b.minY };
    case "bottom":
      return { x: cx, y: b.maxY };
    case "left":
      return { x: b.minX, y: cy };
    case "right":
      return { x: b.maxX, y: cy };
  }
}

/**
 * Where a connector meets a shape of points `pts` on `side`: the furthest
 * point where the ray from the middle of its bounds towards that side
 * crosses the outline, or the middle of that side of the bounds when it
 * crosses nothing.
 */
export function sideAnchor(pts: readonly number[], side: ConnectorSide): Pt | null {
  const b = boundsOfPts(pts);
  if (!b) return null;
  const c = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  const n = NORMAL[side];
  const count = Math.floor(pts.length / STRIDE);
  let best = -Infinity;
  for (let i = 1; i < count; i++) {
    const ax = pts[(i - 1) * STRIDE];
    const ay = pts[(i - 1) * STRIDE + 1];
    const bx = pts[i * STRIDE];
    const by = pts[i * STRIDE + 1];
    // Solve c + t·n = a + u·(b − a) for t ≥ 0, u in [0, 1].
    const ex = bx - ax;
    const ey = by - ay;
    const den = n.x * ey - n.y * ex;
    if (Math.abs(den) < 1e-12) continue;
    const wx = ax - c.x;
    const wy = ay - c.y;
    const t = (wx * ey - wy * ex) / den;
    const u = (wx * n.y - wy * n.x) / den;
    if (t >= 0 && u >= -1e-9 && u <= 1 + 1e-9 && t > best) best = t;
  }
  return best > -Infinity ? { x: c.x + n.x * best, y: c.y + n.y * best } : sideMiddle(b, side);
}

/** The side of `to` that faces `from`: along whichever axis the two are further apart. */
export function facingSide(from: Bounds, to: Bounds): ConnectorSide {
  const fx = (from.minX + from.maxX) / 2;
  const fy = (from.minY + from.maxY) / 2;
  const tx = (to.minX + to.maxX) / 2;
  const ty = (to.minY + to.maxY) / 2;
  // Measured in sizes, so a wide pair side by side reads as side by side.
  const w = Math.max(1, (from.maxX - from.minX + to.maxX - to.minX) / 2);
  const h = Math.max(1, (from.maxY - from.minY + to.maxY - to.minY) / 2);
  const dx = (tx - fx) / w;
  const dy = (ty - fy) / h;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "left" : "right";
  return dy >= 0 ? "top" : "bottom";
}

/** Whether an axis-aligned segment runs through the inside of `b` (its edge does not count). */
function crosses(p: Pt, q: Pt, b: Bounds): boolean {
  const e = 0.5;
  const minX = Math.min(p.x, q.x);
  const maxX = Math.max(p.x, q.x);
  const minY = Math.min(p.y, q.y);
  const maxY = Math.max(p.y, q.y);
  return minX < b.maxX - e && maxX > b.minX + e && minY < b.maxY - e && maxY > b.minY + e;
}

/** Drop repeated points and the middle of three in a straight run. */
function simplify(points: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-6 && Math.abs(last.y - p.y) < 1e-6) continue;
    const prev = out[out.length - 2];
    if (prev && last) {
      const straight =
        (Math.abs(prev.x - last.x) < 1e-6 && Math.abs(last.x - p.x) < 1e-6) ||
        (Math.abs(prev.y - last.y) < 1e-6 && Math.abs(last.y - p.y) < 1e-6);
      // Only a run that keeps its direction merges; a turn back stays a turn.
      const onward = (last.x - prev.x) * (p.x - last.x) + (last.y - prev.y) * (p.y - last.y) > 0;
      if (straight && onward) {
        out[out.length - 1] = p;
        continue;
      }
    }
    out.push(p);
  }
  return out;
}

function lengthOf(points: readonly Pt[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.abs(points[i].x - points[i - 1].x) + Math.abs(points[i].y - points[i - 1].y);
  }
  return total;
}

/** The point where a connector leaves `b` on `side` at anchor `a`: just past the bounds. */
function stubOf(a: Pt, b: Bounds, side: ConnectorSide, stub: number): Pt {
  switch (side) {
    case "top":
      return { x: a.x, y: b.minY - stub };
    case "bottom":
      return { x: a.x, y: b.maxY + stub };
    case "left":
      return { x: b.minX - stub, y: a.y };
    case "right":
      return { x: b.maxX + stub, y: a.y };
  }
}

/**
 * A right-angled route from anchor `a` on side `sa` of the shape bounded by
 * `boxA` to anchor `b` on side `sb` of the one bounded by `boxB`: the points
 * of a polyline, `a` first, `b` last.
 */
export function routeElbow(
  a: Pt,
  sa: ConnectorSide,
  boxA: Bounds,
  b: Pt,
  sb: ConnectorSide,
  boxB: Bounds,
  stub = CONNECTOR_STUB,
): Pt[] {
  const p = stubOf(a, boxA, sa, stub);
  const q = stubOf(b, boxB, sb, stub);
  const mx = (p.x + q.x) / 2;
  const my = (p.y + q.y) / 2;
  const outer: Bounds = {
    minX: Math.min(boxA.minX, boxB.minX) - stub,
    minY: Math.min(boxA.minY, boxB.minY) - stub,
    maxX: Math.max(boxA.maxX, boxB.maxX) + stub,
    maxY: Math.max(boxA.maxY, boxB.maxY) + stub,
  };
  const middles: Pt[][] = [
    [{ x: q.x, y: p.y }],
    [{ x: p.x, y: q.y }],
    [
      { x: mx, y: p.y },
      { x: mx, y: q.y },
    ],
    [
      { x: p.x, y: my },
      { x: q.x, y: my },
    ],
  ];
  for (const y of [outer.minY, outer.maxY]) {
    middles.push([
      { x: p.x, y },
      { x: q.x, y },
    ]);
  }
  for (const x of [outer.minX, outer.maxX]) {
    middles.push([
      { x, y: p.y },
      { x, y: q.y },
    ]);
  }
  const na = NORMAL[sa];
  const nb = NORMAL[sb];
  let best: Pt[] | null = null;
  let bestScore = Infinity;
  for (const middle of middles) {
    const route = simplify([a, p, ...middle, q, b]);
    if (route.length < 2) continue;
    // Leaves `a` outwards along its side, and comes into `b` from outside its side.
    const first = route[1];
    const last = route[route.length - 2];
    if ((first.x - a.x) * na.x + (first.y - a.y) * na.y <= 0) continue;
    if ((last.x - b.x) * nb.x + (last.y - b.y) * nb.y <= 0) continue;
    let blocked = false;
    for (let i = 1; i < route.length && !blocked; i++) {
      const s = route[i - 1];
      const e = route[i];
      // The runs out of the anchors are inside their own shape's bounds by design.
      const ownA = i === 1;
      const ownB = i === route.length - 1;
      if (!ownA && crosses(s, e, boxA)) blocked = true;
      if (!ownB && crosses(s, e, boxB)) blocked = true;
    }
    if (blocked) continue;
    const score = (route.length - 2) * 1e6 + lengthOf(route);
    if (score < bestScore) {
      bestScore = score;
      best = route;
    }
  }
  // Nothing clean: the Z through the middle, crossing what it must.
  return best ?? simplify([a, p, ...middles[2], q, b]);
}

/**
 * The route of a connector between shapes of points `fromPts` and `toPts`,
 * leaving the first on `fromSide` and meeting the second on `toSide`, as
 * flat `[x, y, …]` pairs; null when either shape has no point.
 */
export function connectorRoute(
  fromPts: readonly number[],
  fromSide: ConnectorSide,
  toPts: readonly number[],
  toSide: ConnectorSide,
  stub = CONNECTOR_STUB,
): number[] | null {
  const boxA = boundsOfPts(fromPts);
  const boxB = boundsOfPts(toPts);
  const a = sideAnchor(fromPts, fromSide);
  const b = sideAnchor(toPts, toSide);
  if (!boxA || !boxB || !a || !b) return null;
  const route = routeElbow(a, fromSide, boxA, b, toSide, boxB, stub);
  const out: number[] = [];
  for (const pt of route) out.push(pt.x, pt.y);
  return out;
}

/** The bounds of a route's `[x, y, …]` pairs, grown by `pad` (its width and head). */
export function routeBounds(route: readonly number[], pad: number): Bounds | null {
  if (route.length < 2) return null;
  const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (let i = 0; i + 1 < route.length; i += 2) {
    b.minX = Math.min(b.minX, route[i]);
    b.maxX = Math.max(b.maxX, route[i]);
    b.minY = Math.min(b.minY, route[i + 1]);
    b.maxY = Math.max(b.maxY, route[i + 1]);
  }
  return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
}

/**
 * How far to move a copy of a shape bounded by `b` so it sits beside the
 * original on `side`, `gap` page px away: a tap on a side dot.
 */
export function besideOffset(b: Bounds, side: ConnectorSide, gap: number): Pt {
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const n = NORMAL[side];
  return { x: n.x * (w + gap), y: n.y * (h + gap) };
}

/**
 * How far to move a copy of a shape bounded by `b`, dragged out by its
 * `side` dot to `pen`, so that the copy's near edge sits at the pen and it
 * hangs on in the drag's direction, centred across it.
 */
export function draggedOffset(b: Bounds, side: ConnectorSide, pen: Pt): Pt {
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const n = NORMAL[side];
  // The copy's middle: half a size past the pen, along the side's normal.
  const mx = pen.x + (n.x * w) / 2;
  const my = pen.y + (n.y * h) / 2;
  return { x: mx - cx, y: my - cy };
}
