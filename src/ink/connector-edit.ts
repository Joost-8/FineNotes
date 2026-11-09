/**
 * Editing a connector by its handles, as Goodnotes does
 * (research/goodnotes-shapes-2026-11-08.md, "Editing"): a straight line or
 * a curve, and an elbow.
 *
 * - **A curve** passes through its bend points (an interpolating spline,
 *   centripetal Catmull-Rom, which never loops or cusps between them). Its
 *   handles are a ring on each end and bend point and a small dot half way
 *   along each run between two of them: dragging a ring moves that point,
 *   dragging a dot adds a bend point there. A straight `line` is a curve
 *   with no bend point yet, so its middle dot is the first bend.
 * - **An elbow** (a `path` of right-angled runs, the Shape tool's elbow) has
 *   a ring on each end and a pill on the middle of each run: dragging a pill
 *   slides that run sideways and its neighbours stretch, so every run stays
 *   level or upright. An end run slid away from its end gets a new short
 *   run back to it, so an L becomes a Z or a U.
 *
 * A curve is stored as a `path` sampled densely (contracts/api.md): every
 * run between two bend points gets the same number of samples, so its bend
 * points are samples at fixed indices and are read back by regenerating the
 * spline through them and comparing. A smooth path made elsewhere (a held
 * arrow's curve) is read by fitting a few evenly spaced bend points, and
 * only when the spline through them stays within {@link FIT_TOLERANCE}.
 *
 * PURE: no DOM. Outputs are fresh arrays.
 */

import { POINT_STRIDE } from "../model/document";
import { elbowPoints } from "./shape-geometry";

export interface Pt {
  x: number;
  y: number;
}

/** How a handle is drawn: a ring (an end or bend point), a dot (adds a bend), a pill along a run. */
export type HandleLook = "ring" | "dot" | "pill-x" | "pill-y";

/** What a handle does when dragged. */
export type ConnectorRole =
  /** Moves point `knot` (a curve's bend point or end, an elbow's end). */
  | { type: "knot"; knot: number }
  /** A curve's half-way dot on the run after point `seg`: adds a bend point there. */
  | { type: "mid"; seg: number }
  /** An elbow's run from point `run` to point `run + 1`: slides it sideways. */
  | { type: "run"; run: number };

export interface ConnectorHandles {
  kind: "curve" | "elbow";
  /** A curve's ends and bend points, or an elbow's start, corners and end. */
  knots: Pt[];
  /** Where each handle sits, page px: x, y, x, y, … */
  at: number[];
  roles: ConnectorRole[];
  looks: HandleLook[];
  /** The pressure the points carry (a shape is drawn at one width), and its ends' own. */
  pressure: number;
  ends: [number, number];
}

/** No more bend points than this on a curve (ends included); its half-way dots go then. */
export const MAX_CURVE_KNOTS = 12;
/** Fewest samples per run of a curve between two bend points. */
const MIN_RUN_SAMPLES = 16;
/** Most samples per run. */
const MAX_RUN_SAMPLES = 64;
/** A curve's samples are no further apart than about this, page px. */
const SAMPLE_STEP = 6;
/** How near a regenerated sample must be to the stored one to read a curve back (the file keeps 1/100 px). */
const READ_TOLERANCE = 0.02;
/** How near a fitted spline must stay to a smooth path made elsewhere, page px. */
export const FIT_TOLERANCE = 1.5;
/** Fewest samples a path made elsewhere needs to be fitted as a curve. */
const MIN_FIT_SAMPLES = 16;
/** Most runs tried when fitting one. */
const MAX_FIT_RUNS = 8;
/** Coordinates this close are the same (an elbow's level or upright run). */
const SAME = 0.01;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** The whole points of a flat `[x, y, p, …]` array, or null when one is not a number. */
function pointsOf(pts: readonly number[]): Pt[] | null {
  const out: Pt[] = [];
  const count = Math.floor(pts.length / POINT_STRIDE);
  for (let i = 0; i < count; i++) {
    const x = pts[i * POINT_STRIDE];
    const y = pts[i * POINT_STRIDE + 1];
    if (!Number.isFinite(x + y)) return null;
    out.push({ x, y });
  }
  return out;
}

/** Drop points that repeat the one before. */
function distinct(points: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || dist(p, last) > SAME) out.push(p);
  }
  return out;
}

function flatten(points: readonly Pt[], pressure: number, ends?: [number, number]): number[] {
  const out: number[] = [];
  for (const p of points) out.push(round2(p.x), round2(p.y), pressure);
  if (ends && out.length >= 2 * POINT_STRIDE) {
    out[2] = ends[0];
    out[out.length - 1] = ends[1];
  }
  return out;
}

// --- The spline ---------------------------------------------------------------

/**
 * The point at `u` (0 to 1) along the centripetal Catmull-Rom run from `p1`
 * to `p2`, with `p0` before and `p3` after (Barry and Goldman's pyramid).
 */
function catmullRom(p0: Pt, p1: Pt, p2: Pt, p3: Pt, u: number): Pt {
  const step = (a: Pt, b: Pt): number => Math.max(Math.sqrt(dist(a, b)), 1e-4);
  const t0 = 0;
  const t1 = t0 + step(p0, p1);
  const t2 = t1 + step(p1, p2);
  const t3 = t2 + step(p2, p3);
  const t = t1 + u * (t2 - t1);
  const mix = (a: Pt, b: Pt, ta: number, tb: number): Pt => {
    const k = (t - ta) / (tb - ta);
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  };
  const a1 = mix(p0, p1, t0, t1);
  const a2 = mix(p1, p2, t1, t2);
  const a3 = mix(p2, p3, t2, t3);
  const b1 = mix(a1, a2, t0, t2);
  const b2 = mix(a2, a3, t1, t3);
  return mix(b1, b2, t1, t2);
}

/**
 * The point before `a` on an end run from `a` to `b`, the next point on
 * being `c`: `c` mirrored across the run's perpendicular bisector, so the
 * end run bends as its neighbour does (an arc of a circle stays one, where
 * running straight out of the end left a flat run and a kink at the first
 * bend). With no `c`, `b` mirrored through `a`: a straight line.
 */
function phantom(a: Pt, b: Pt, c: Pt | undefined): Pt {
  const len = dist(a, b);
  if (!c || !(len > 0)) return { x: 2 * a.x - b.x, y: 2 * a.y - b.y };
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const along = (c.x - (a.x + b.x) / 2) * ux + (c.y - (a.y + b.y) / 2) * uy;
  return { x: c.x - 2 * along * ux, y: c.y - 2 * along * uy };
}

/** The point at `u` along run `seg` of the spline through `knots`. */
function splineAt(knots: readonly Pt[], seg: number, u: number): Pt {
  const n = knots.length;
  const p1 = knots[seg];
  const p2 = knots[seg + 1];
  const p0 = seg > 0 ? knots[seg - 1] : phantom(p1, p2, knots[seg + 2]);
  const p3 = seg + 2 < n ? knots[seg + 2] : phantom(p2, p1, knots[seg - 1]);
  return catmullRom(p0, p1, p2, p3, u);
}

/** How many samples each run of a curve through `knots` gets: one count for all, so bend points sit at fixed indices. */
export function runSamples(knots: readonly Pt[]): number {
  let longest = 0;
  for (let i = 1; i < knots.length; i++) longest = Math.max(longest, dist(knots[i - 1], knots[i]));
  return Math.min(MAX_RUN_SAMPLES, Math.max(MIN_RUN_SAMPLES, Math.ceil(longest / SAMPLE_STEP)));
}

/**
 * The spline through `knots`, sampled `perRun` times per run (the bend
 * points exactly, at every `perRun`-th index), as a flat points array with
 * `pressure`. Two knots give the straight line between them.
 */
export function splinePoints(knots: readonly Pt[], pressure: number, perRun?: number): number[] {
  if (knots.length < 2) return flatten(knots, pressure);
  if (knots.length === 2) return flatten(knots, pressure);
  const k = perRun ?? runSamples(knots);
  const out: Pt[] = [];
  for (let seg = 0; seg + 1 < knots.length; seg++) {
    out.push({ ...knots[seg] });
    for (let j = 1; j < k; j++) out.push(splineAt(knots, seg, j / k));
  }
  out.push({ ...knots[knots.length - 1] });
  return flatten(out, pressure);
}

/** The bend points of a curve this module made: the samples at fixed indices, when the spline through them gives the rest back. */
function readOwnCurve(pts: readonly number[], points: readonly Pt[]): Pt[] | null {
  const runs = points.length - 1;
  for (let m = 2; m < MAX_CURVE_KNOTS; m++) {
    if (runs % m !== 0) continue;
    const k = runs / m;
    if (k < MIN_RUN_SAMPLES) break;
    const knots: Pt[] = [];
    for (let s = 0; s <= m; s++) knots.push(points[s * k]);
    const again = splinePoints(knots, pts[2] ?? 0.5, k);
    if (again.length !== pts.length) continue;
    let same = true;
    for (let i = 0; i < again.length && same; i += POINT_STRIDE) {
      same =
        Math.abs(again[i] - pts[i]) <= READ_TOLERANCE &&
        Math.abs(again[i + 1] - pts[i + 1]) <= READ_TOLERANCE;
    }
    if (same) return knots;
  }
  return null;
}

/** The points `count` evenly spaced along the polyline by length, ends included. */
function evenAlong(points: readonly Pt[], count: number): Pt[] {
  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    lengths.push(lengths[i - 1] + dist(points[i - 1], points[i]));
  }
  const total = lengths[lengths.length - 1];
  const out: Pt[] = [{ ...points[0] }];
  let i = 1;
  for (let c = 1; c < count - 1; c++) {
    const want = (total * c) / (count - 1);
    while (i < points.length - 1 && lengths[i] < want) i++;
    const seg = lengths[i] - lengths[i - 1];
    const k = seg > 0 ? (want - lengths[i - 1]) / seg : 0;
    const a = points[i - 1];
    const b = points[i];
    out.push({ x: round2(a.x + (b.x - a.x) * k), y: round2(a.y + (b.y - a.y) * k) });
  }
  out.push({ ...points[points.length - 1] });
  return out;
}

/** How far `p` is from the polyline `line`. */
function distToPolyline(p: Pt, line: readonly Pt[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const k = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * k), p.y - (a.y + dy * k)));
  }
  return best;
}

/** A few bend points a smooth path made elsewhere passes close to, or null when it is not that smooth. */
function fitCurve(points: readonly Pt[]): Pt[] | null {
  if (points.length < MIN_FIT_SAMPLES) return null;
  for (let runs = 2; runs <= MAX_FIT_RUNS; runs++) {
    const knots = evenAlong(points, runs + 1);
    const flat = splinePoints(knots, 0.5);
    const line = pointsOf(flat) ?? [];
    if (points.every((p) => distToPolyline(p, line) <= FIT_TOLERANCE)) return knots;
  }
  return null;
}

// --- Elbows -----------------------------------------------------------------------

/** Each run of `points` level or upright, and at least one corner. */
function isElbow(points: readonly Pt[]): boolean {
  if (points.length < 3) return false;
  for (let i = 1; i < points.length; i++) {
    const level = Math.abs(points[i].y - points[i - 1].y) <= SAME;
    const upright = Math.abs(points[i].x - points[i - 1].x) <= SAME;
    if (level === upright) return false;
  }
  return true;
}

function isLevel(a: Pt, b: Pt): boolean {
  return Math.abs(a.y - b.y) <= SAME;
}

function isUpright(a: Pt, b: Pt): boolean {
  return Math.abs(a.x - b.x) <= SAME;
}

/**
 * An elbow tidied after a drag: no zero-length runs, and no corner between
 * two runs on one line (a run slid back into line with its neighbours, or
 * back over itself, is one run again). The ends stay.
 */
export function tidyElbow(points: readonly Pt[]): Pt[] {
  let out = distinct(points);
  let changed = true;
  while (changed && out.length > 2) {
    changed = false;
    for (let i = 1; i + 1 < out.length; i++) {
      const [a, b, c] = [out[i - 1], out[i], out[i + 1]];
      const level = isLevel(a, b) && isLevel(b, c);
      const upright = Math.abs(a.x - b.x) <= SAME && Math.abs(b.x - c.x) <= SAME;
      if (level || upright) {
        out = [...out.slice(0, i), ...out.slice(i + 1)];
        out = distinct(out);
        changed = true;
        break;
      }
    }
  }
  return out;
}

// --- Handles -----------------------------------------------------------------------

function curveHandles(knots: Pt[], pressure: number, ends: [number, number]): ConnectorHandles {
  const at: number[] = [];
  const roles: ConnectorRole[] = [];
  const looks: HandleLook[] = [];
  const room = knots.length < MAX_CURVE_KNOTS;
  for (let i = 0; i < knots.length; i++) {
    at.push(knots[i].x, knots[i].y);
    roles.push({ type: "knot", knot: i });
    looks.push("ring");
    if (room && i + 1 < knots.length) {
      const mid =
        knots.length === 2
          ? { x: (knots[0].x + knots[1].x) / 2, y: (knots[0].y + knots[1].y) / 2 }
          : splineAt(knots, i, 0.5);
      at.push(round2(mid.x), round2(mid.y));
      roles.push({ type: "mid", seg: i });
      looks.push("dot");
    }
  }
  return { kind: "curve", knots, at, roles, looks, pressure, ends };
}

function elbowHandles(knots: Pt[], pressure: number, ends: [number, number]): ConnectorHandles {
  const at: number[] = [knots[0].x, knots[0].y];
  const roles: ConnectorRole[] = [{ type: "knot", knot: 0 }];
  const looks: HandleLook[] = ["ring"];
  for (let r = 0; r + 1 < knots.length; r++) {
    const a = knots[r];
    const b = knots[r + 1];
    at.push(round2((a.x + b.x) / 2), round2((a.y + b.y) / 2));
    roles.push({ type: "run", run: r });
    looks.push(isLevel(a, b) ? "pill-x" : "pill-y");
  }
  const last = knots.length - 1;
  at.push(knots[last].x, knots[last].y);
  roles.push({ type: "knot", knot: last });
  looks.push("ring");
  return { kind: "elbow", knots, at, roles, looks, pressure, ends };
}

/**
 * The handles of a connector of `kind` with points `pts`: a straight `line`,
 * a straight or curved `path`, or an elbow. Null for anything else (a path
 * of slanted runs, a curve no spline fits), which keeps its corner handles.
 */
export function connectorHandles(
  kind: string | undefined,
  pts: readonly number[],
  elbow = false,
): ConnectorHandles | null {
  if (kind !== "line" && kind !== "path") return null;
  const raw = pointsOf(pts);
  if (!raw) return null;
  const pressure = pts[2] ?? 0.5;
  const ends: [number, number] = [pressure, pts[pts.length - 1] ?? pressure];
  const points = distinct(raw);
  if (points.length < 2) return null;
  if (points.length === 2) {
    // An elbow lying straight is still an elbow: its end bends it (`elbow`, from
    // the stroke's rounded bend).
    if (
      elbow &&
      kind === "path" &&
      isLevel(points[0], points[1]) !== isUpright(points[0], points[1])
    )
      return elbowHandles(points, pressure, ends);
    // A line, or a straight path: no bend yet, one middle dot.
    return raw.length === 2 ? curveHandles(points, pressure, ends) : null;
  }
  if (kind === "line") return null;
  if (isElbow(points)) return elbowHandles(points, pressure, ends);
  const knots =
    points.length === raw.length ? (readOwnCurve(pts, raw) ?? fitCurve(points)) : fitCurve(points);
  return knots ? curveHandles(knots, pressure, ends) : null;
}

/** Whether handle `handle` is one of the connector's two ends. */
export function isEndHandle(handles: ConnectorHandles, handle: number): boolean {
  const role = handles.roles[handle];
  return role?.type === "knot" && (role.knot === 0 || role.knot === handles.knots.length - 1);
}

/**
 * The connector's points with handle `handle` dragged to `to`, and the kind
 * they make: a straight line stays a `line` until it bends, then it is a
 * `path`. Null when `to` is not a point, or the drag would leave a
 * connector shorter than a px.
 */
export function dragConnector(
  kind: "line" | "path",
  handles: ConnectorHandles,
  handle: number,
  to: Pt,
): { pts: number[]; kind: "line" | "path" } | null {
  const role = handles.roles[handle];
  if (!role || !Number.isFinite(to.x + to.y)) return null;
  const p = { x: round2(to.x), y: round2(to.y) };
  const knots = handles.knots.map((k) => ({ ...k }));
  let next: Pt[];
  let out: "line" | "path" = "path";
  if (handles.kind === "curve") {
    if (role.type === "knot") knots[role.knot] = p;
    else if (role.type === "mid") knots.splice(role.seg + 1, 0, p);
    else return null;
    next = knots;
    if (next.length === 2) out = kind;
  } else {
    next = role.type === "run" ? slideRun(knots, role.run, p) : moveElbowEnd(knots, role, p);
    next = tidyElbow(next);
  }
  if (next.length < 2) return null;
  const first = next[0];
  const last = next[next.length - 1];
  if (next.length === 2 && dist(first, last) < 1) return null;
  const flat =
    handles.kind === "curve" && next.length > 2
      ? splinePoints(next, handles.pressure)
      : flatten(next, handles.pressure, handles.ends);
  return { pts: flat, kind: out };
}

/** An elbow's run `run` slid sideways to pass through `p`; an end run gets a new run back to its end. */
function slideRun(knots: Pt[], run: number, p: Pt): Pt[] {
  const level = isLevel(knots[run], knots[run + 1]);
  const at = (q: Pt): Pt => (level ? { x: q.x, y: p.y } : { x: p.x, y: q.y });
  const out = knots.slice();
  const last = knots.length - 1;
  const a = at(knots[run]);
  const b = at(knots[run + 1]);
  // The run's own ends move, unless one is the elbow's end: that stays, and a new corner joins it.
  const head: Pt[] = run === 0 ? [knots[0], a] : [a];
  const tail: Pt[] = run + 1 === last ? [b, knots[last]] : [b];
  out.splice(run, 2, ...head, ...tail);
  return out;
}

/**
 * An elbow with an end moved to `p`. One with at most one bend bends on its
 * own: it is routed afresh, along the longer direction first, as when it was
 * drawn. One whose runs were slid into a Z or U keeps its shape: the run from
 * that end slides along, so it stays level or upright.
 */
function moveElbowEnd(knots: Pt[], role: ConnectorRole, p: Pt): Pt[] {
  if (role.type !== "knot") return knots;
  const end = role.knot;
  if (knots.length <= 3) {
    return end === 0 ? elbowPoints(p, knots[knots.length - 1]) : elbowPoints(knots[0], p);
  }
  const out = knots.slice();
  const near = end === 0 ? 1 : end - 1;
  const level = isLevel(knots[end], knots[near]);
  out[end] = p;
  // Its neighbour is a corner (an elbow has at least one), and moving it
  // along the next run keeps that run square.
  out[near] = level ? { x: knots[near].x, y: p.y } : { x: p.x, y: knots[near].y };
  return out;
}
