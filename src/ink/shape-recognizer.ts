/**
 * Hold-to-snap shape recognition (contracts/api.md §2).
 *
 * Pure: no DOM, no Obsidian, no clock, no randomness. Given a freehand
 * stroke's flat `[x, y, p, …]` points it returns clean replacement geometry in
 * the same layout, or `null` when it is not confident.
 *
 * **Why not $1 / $P / $Q.** research/FEASIBILITY.md §5.1: the $-family
 * normalises rotation, scale and position away, and those are exactly the
 * parameters needed in order to *draw* the snapped shape. So this module fits
 * geometry directly — total-least-squares line, Kåsa circle, a principal-axis
 * ellipse, RDP plus an oriented box for rectangles, RDP plus per-edge line
 * fits for other polygons, RDP plus a regular-star fit for five-point stars,
 * and a shaft-plus-V or shaft-plus-retrace test for arrows — and every fitter
 * reports a residual that becomes the confidence.
 *
 * **Straightening polygons.** RDP finds roughly where the corners are, but a
 * corner *sample* is wherever the hand happened to turn, usually rounded off.
 * So each edge is re-fitted as a total-least-squares line through the middle
 * of its own samples, and every vertex becomes the intersection of its two
 * neighbouring edge lines. That is what turns a sloppy triangle into straight
 * sides meeting in sharp corners, rather than a triangle of wobbles.
 *
 * **A wrong snap is worse than no snap.** Every fitter is gated on shape, size
 * and residual, and the dispatcher returns `null` unless the best surviving
 * candidate clears `minConfidence`. Under-triggering is the intended failure.
 */

import { FALLBACK_PRESSURE, SNAP_CLOSE_TOLERANCE, SNAP_MIN_CONFIDENCE } from "../constants";
import { POINT_STRIDE, type ShapeKind } from "../model/document";
import {
  ELLIPSE_SEGMENTS,
  arrowPoints,
  ellipsePoints,
  pentagramPoints,
  starPoints,
} from "./shape-geometry";

export type { ShapeKind };

export interface ShapeResult {
  kind: ShapeKind;
  /** Clean replacement geometry, same flat `[x,y,p,…]` layout as `Stroke.pts`. */
  pts: number[];
  /** 0..1. Below `minConfidence` the caller must keep the raw stroke. */
  confidence: number;
}

export interface RecognizeOptions {
  /** Reject a match below this. Default {@link SNAP_MIN_CONFIDENCE}. */
  minConfidence?: number;
  /** Closing distance (page px) under which a stroke counts as closed. */
  closeTolerance?: number;
  /**
   * Also fit diamonds and other polygons (skewed quads, pentagons, hexagons).
   * Triangles are always fitted. Off by default since 2026-09-21: on real
   * Pencil ink the polygon fitter took a sloppy square as a parallelogram,
   * and Joost asked for squares, triangles and lines first. The fitter stays
   * tested.
   */
  polygons?: boolean;
}

// --- Tuning ---------------------------------------------------------------
// Every `*_MAX_ERR` here is a residual *tolerance*: the value at which a fit's
// confidence reaches 0. With the 0.75 acceptance floor that means a stroke
// snaps while its residual is under a quarter of the tolerance — so each one
// is set at four times the residual real ink produces, not at "the point
// where it stops looking like the shape". Measured 2026-09-21 on strokes
// traced out of an iPad recording (tests/ink/fixtures/real-pencil-ipad.json):
// circles 0.060–0.067 of r radial RMS, rects 0.012–0.018 of the diagonal to
// their straightened quad, a line 0.023 of its span. The previous values
// (0.2, 0.075 to the *box*, 0.11) refused every one of them.

/**
 * A stroke needs at least a start and an end. Taps and flicks are rejected by
 * {@link MIN_SPAN}, not by a point count — a *count* floor would also refuse
 * already-clean geometry, and `recognizeShape` should be idempotent on its own
 * output (re-running it over a snapped line must still say "line").
 */
const MIN_POINTS = 2;
/** Bounding-box diagonal below which we never snap, in page px. */
const MIN_SPAN = 24;
/** Closedness also scales with the stroke: a big loop may leave a big gap. */
const CLOSE_SPAN_FRACTION = 0.1;

/** Line: max perpendicular deviation as a fraction of end-to-end span. A
 *  quick Pencil line bows ~2–3% of its span; a 45° arc measures ~6.6%. */
const LINE_MAX_ERR = 0.25;
/** Line: path length may exceed the straight span by at most this factor. */
const LINE_MAX_DETOUR = 1.35;
/** Detour is measured on a lightly simplified copy, so per-sample digitizer
 *  noise does not inflate the path length of a perfectly straight stroke. */
const DETOUR_SIMPLIFY_FRACTION = 0.01;

/**
 * Circle: RMS radial deviation as a fraction of the fitted radius. A loop
 * flatter than {@link ELLIPSE_MAX_RATIO} goes to the ellipse fitter instead,
 * so this only has to absorb hand wobble.
 */
const CIRCLE_MAX_ERR = 0.4;
const CIRCLE_MIN_SWEEP = 1.7 * Math.PI;
const CIRCLE_MAX_SWEEP = 2.6 * Math.PI;
/**
 * Circle: sharpest corner allowed in a simplified copy of the loop.
 *
 * Radial deviation alone cannot tell a square from a wobbly circle — a
 * perfect square's radial RMS is 0.107 of r, a real Pencil circle's 0.065 —
 * so a structural gate is needed. But RDP turns any circle into a polygon
 * whose corners are set by the tolerance alone: a chord that deviates by
 * `t` from a circle of radius `r` turns 2·acos(1 − t/r), which at 5% of the
 * diagonal (t = 0.14 r) is 61° — exactly what real circles measured (51–62°),
 * while rects measured ≥ 93° and triangles ≥ 116°. At 2% the same real
 * circles read 51–82°, because hand lumps are still resolved at 2.4 px, and
 * the old 42° cap refused every one of them. So: coarse enough to erase
 * lumps, and a cap between the chord angle and a square's 90°.
 */
const CIRCLE_MAX_CORNER_DEG = 80;
/** Circle: RDP tolerance for that corner check, as a fraction of the diagonal. */
const CIRCLE_CORNER_FRACTION = 0.05;
/** Points emitted around a snapped circle (plus the repeated closing point). */
const CIRCLE_SEGMENTS = 32;

/**
 * Ellipse: a loop whose minor/major extent ratio is below this is an oval,
 * not a wobbly circle (about 1.18:1). At or above it the circle fitter owns it.
 */
const ELLIPSE_MAX_RATIO = 0.85;
/** Ellipse: flatter than this (8:1) the loop is a doubled-back line. */
const ELLIPSE_MIN_RATIO = 0.12;
/** Ellipse: RMS deviation of the normalised radius from 1 (same scale as
 *  the circle's radial RMS, and real ink lands in the same 0.06–0.08 band). */
const ELLIPSE_MAX_ERR = 0.4;
/** Ellipse: radius of the circle a loop is normalised onto for its corner
 *  check, in px, so maxCornerDeg's pixel floors mean what they usually do. */
const UNIT = 100;
/** Ellipse: within this of an axis, snap the major axis to it. */
const ELLIPSE_AXIS_SNAP_DEG = 8;
/** Ellipse: grid a kept tilt is rounded to. */
const ELLIPSE_TILT_STEP_DEG = 0.5;

/** Polygon: the vertex counts hold-to-snap will straighten into. */
const POLY_MIN_SIDES = 3;
const POLY_MAX_SIDES = 6;
/** Polygon: RMS distance to the straightened outline over the diagonal. Same
 *  ceiling as the rectangle fitter: at 0.05 a sloppy triangle scored 0.72. */
const POLY_MAX_ERR = 0.1;
/**
 * Polygon: RMS distance of one edge's samples from that edge, over its
 * length. Loose on purpose — measured on Joost's real mouse-drawn triangles,
 * edges bowed up to 0.048, well past synthetic tremor's 0.027.
 */
const POLY_EDGE_MAX_ERR = 0.11;
/**
 * Polygon: how far a straightened vertex may sit from the nearest ink, over
 * its shorter edge — the hand must have gone roughly to each corner. A real
 * rounded corner measured 0.125, synthetic ones 0.010-0.025.
 */
const POLY_MAX_CORNER_GAP = 0.25;
/**
 * Polygon: every corner must turn at least this sharply. This, not edge
 * straightness or corner gap, is what keeps an arc from passing as a run of
 * short sides (the "direction change" idea from PaleoSketch): RDP cuts an arc
 * into ~45° turns — a D measured a 43° minimum — while a regular hexagon turns
 * 60° and every other polygon more. Edge straightness could not separate them
 * (D 0.042, real triangles up to 0.048), and the D's corner gap (0.14) sits
 * right beside a real rounded corner's (0.125).
 */
const POLY_MIN_TURN_DEG = 50;
/** Polygon: RDP tolerance multipliers tried — the rectangle's, plus coarser
 *  ones, since a sloppy triangle's corners only fall out at a coarse scale. */
const POLY_SIMPLIFY_STEPS = [1, 1.6, 2.5, 4, 6];
/** Polygon: fraction of samples trimmed off each end of an edge before its
 *  line fit — that is where the hand was rounding the corner. */
const POLY_EDGE_TRIM = 0.2;
/** Polygon: a refined vertex further than this (× diagonal) from its RDP
 *  corner means the edge lines were near-parallel; keep the RDP corner. */
const POLY_VERTEX_MAX_SHIFT = 0.2;
/** Diamond: sides within this fraction of their mean length... */
const DIAMOND_SIDE_TOL = 0.12;
/** ...and both diagonals within this of the axes. */
const DIAMOND_AXIS_TOL_DEG = 8;

/**
 * Rect: RMS distance to the *straightened quad* as a fraction of the diagonal.
 * Not to the emitted box: a hand-drawn rectangle is a slightly trapezoid
 * quad (real ones measured 0.05–0.074 to their best box, 0.012–0.018 to their
 * quad), and "four straight sides meeting at roughly right angles" is what
 * makes it a rectangle. Squaring it up is beautification, done afterwards.
 */
const RECT_MAX_ERR = 0.15;
/** Rect: a corner may miss 90° by this much before the stroke is not a rect. */
const RECT_CORNER_TOL_DEG = 26;
/**
 * Rect: opposite sides may converge by at most this. Corner angles alone let
 * a trapezoid through (its corners miss 90° by 22°, inside the tolerance a
 * sloppy square needs), but a trapezoid's sides meet at 44° where real
 * rects measured ≤ 13° and a skewed square 2°.
 */
const RECT_MAX_CONVERGENCE_DEG = 20;
/** Rect: within this of an axis, snap the box to axis-aligned. */
const RECT_AXIS_SNAP_DEG = 6;
/** Rect: RDP tolerance as a fraction of the bounding-box diagonal. */
const RECT_SIMPLIFY_FRACTION = 0.025;
/** Rect: a simplified vertex turning less than this is not a corner. */
const RECT_MIN_TURN_DEG = 25;
/**
 * Rect: how sharply the ink itself must turn at each corner, measured between
 * chords reaching {@link CORNER_WINDOW_FRACTION} of the perimeter either way.
 * A coarse RDP of a lumpy circle is a quad too — four vertices at ~90° — but
 * its ink bends ~29° across that window where a drawn corner turns ~90°.
 */
const RECT_MIN_SHARPNESS_DEG = 50;
/**
 * Rect: one corner may be softer — down to this — as long as the other
 * three are sharp. A square drawn with one swung-round corner measured 39°
 * there (real ink, 2026-09-21) beside three corners at 80–112°; a lumpy
 * circle's coarse RDP quad measured two soft corners (42°, 49°) and passed
 * as a rect at 0.79 the moment the flat cut was lowered to 40°.
 */
const RECT_SOFT_CORNER_MIN_DEG = 30;
const CORNER_WINDOW_FRACTION = 0.08;

/** Arrow: max perpendicular deviation of the shaft, as a fraction of its span. */
const ARROW_SHAFT_MAX_ERR = 0.06;
/** Arrow: the shaft's own detour ceiling — it must be drawn in one sweep. */
const ARROW_SHAFT_MAX_DETOUR = 1.15;
/** Arrow: the shaft must be at least this fraction of the whole path length. */
const ARROW_MIN_SHAFT_FRACTION = 0.45;
/** Arrow: barb length bounds, as a fraction of the shaft span. */
const ARROW_MIN_BARB = 0.06;
const ARROW_MAX_BARB = 0.45;
/** Arrow: half-angle bounds between a barb and the reversed shaft. */
const ARROW_MIN_HEAD_DEG = 12;
const ARROW_MAX_HEAD_DEG = 75;
/** Arrow: emitted head half-angle is the measured mean, clamped to this band. */
const ARROW_EMIT_MIN_DEG = 18;
const ARROW_EMIT_MAX_DEG = 45;

// Retrace arrow (Apple Notes' gesture, 2026-09-22): a straight line, then back
// a little way along it. Every value below was chosen from printed class
// distributions (tests/ink/shape-recognizer-star-arrow.test.ts): plain lines
// with lift tails of 5–35 px in every direction, against deliberate retraces
// of 10–45 % of the shaft with up to 8° of hand deviation, at Pencil density.

/**
 * Retrace: how far back along the shaft the pen must come, in page px. A lift
 * tail that happens to reverse along the line reads as a retrace exactly as
 * long as itself — 32–35 px for the ledger's longest real tails, at any line
 * length and within 0–12° of the reverse direction, where no angle gate can
 * see it. So the floor is absolute and sits above that.
 */
const RETRACE_MIN_PX = 40;
/** ...and at least this fraction of the shaft, so a long line's flick is not one either. */
const RETRACE_MIN_FRACTION = 0.12;
/** ...and at most this: out and all the way back is a doubled line (adversarial), not an arrow. */
const RETRACE_MAX_FRACTION = 0.6;
/**
 * The retrace must head back within this of the reversed shaft. Synthetic
 * retraces measured ≤ 17° (8° of hand deviation, plus tremor and the pen's
 * sideways offset at the turn); a one-barb arrow's barb leaves at 28°, and a
 * one-barb arrow must stay refused (contracts/api.md §2).
 */
const RETRACE_MAX_ANGLE_DEG = 20;
/** The retrace must itself run straight back: its detour over its own span. */
const RETRACE_MAX_DETOUR = 1.25;

// Star (2026-09-22). Measured on synthetic hand-drawn stars — Pencil density,
// low-frequency tremor, 8–17 px pen-down hooks, 10–15 % closing overshoots,
// rounded tips, ±12 % tip radii and ±7° tip angles — against every adversarial
// closed shape (tests/ink/shape-recognizer-star-arrow.test.ts prints them).
// No real Pencil star has been seen yet.

/** Star: an outline has ten corners (tips and notches); a pentagram five. */
const STAR_OUTLINE_CORNERS = 10;
const STAR_PENTAGRAM_CORNERS = 5;
/**
 * Star: a simplified vertex turning less than this is not a corner. Under the
 * rectangle's 25°: a fat star's notch turns only ~40°, and one sloppy notch
 * dipped below 25° in two of six synthetic fat stars, leaving nine corners.
 */
const STAR_MIN_TURN_DEG = 12;
/** Star: RDP tolerance multipliers tried, of the rectangle's base tolerance. */
const STAR_SIMPLIFY_STEPS = [1, 1.6, 2.5, 4];
/** Star: same-way corners closer than this fraction of the median side are one split tip. */
const STAR_SPLIT_TIP_FRACTION = 0.3;
/** Outline: notch radius over tip radius. Stars measured 0.39–0.58. */
const STAR_MIN_RATIO = 0.25;
const STAR_MAX_RATIO = 0.7;
/** Outline: the shortest tip over the longest notch. Stars 1.57–2.42. */
const STAR_MIN_TIP_OVER_NOTCH = 1.25;
/** Tip radii may spread by this fraction of their mean. Stars ≤ 0.22. */
const STAR_MAX_TIP_SPREAD = 0.4;
/**
 * Each step between consecutive corners about the centre may miss its ideal
 * — 36° round an outline, 144° across a pentagram — by this much. Stars ≤ 14°;
 * a pentagon's corners step 72°, where a pentagram's step 144°.
 */
const STAR_MAX_STEP_DEV_DEG = 25;
/**
 * Every edge must be straight: RMS distance from its chord over its length.
 * Stars measured ≤ 0.079 (sloppy, 220 px, rounded tips); a five-petal
 * flower, which has the star's alternating structure exactly, 0.150–0.159.
 * Set nearer the flower than the stars because real Pencil edges bowed up to
 * 0.10 on triangles, and the polygon fitter's edge gate is 0.11.
 */
const STAR_EDGE_MAX_ERR = 0.12;
/** Outline: the ink must turn sharply at every tip, across 3 % of the perimeter. Stars ≥ 96°, a flower 77°. */
const STAR_MIN_TIP_SHARPNESS_DEG = 60;
const STAR_TIP_WINDOW_FRACTION = 0.03;
/** Pentagram: each tip turns 144° when regular; hand-drawn ones 137–150°, a pentagon's corners 72°. */
const PENTAGRAM_MIN_TURN_DEG = 105;
/** Star: RMS distance to the fitted regular star over its tip radius. Stars 0.010–0.048; four times that. */
const STAR_MAX_ERR = 0.2;
/** Star: within this of level (a tip straight up or straight down), level it. */
const STAR_AXIS_SNAP_DEG = 8;
/** Star: grid a kept tilt is rounded to, so re-fitting the output does not jitter. */
const STAR_PHASE_STEP_DEG = 0.5;

const DEG = Math.PI / 180;

// --- Small geometry helpers ----------------------------------------------

interface Pt {
  x: number;
  y: number;
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** Matches serialize.ts's `XY_SCALE`, so emitted geometry survives a save/load
 *  round-trip bit-for-bit instead of drifting by a quantization step. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Likewise for pressure, which serialize.ts quantizes to 1/255. */
function roundPressure(value: number): number {
  return Math.round(value * 255) / 255;
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function toPoints(pts: number[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i + POINT_STRIDE <= pts.length; i += POINT_STRIDE) {
    const x = pts[i];
    const y = pts[i + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
    out.push({ x, y });
  }
  return out;
}

function meanPressure(pts: number[]): number {
  let sum = 0;
  let n = 0;
  for (let i = 2; i < pts.length; i += POINT_STRIDE) {
    const p = pts[i];
    if (Number.isFinite(p)) {
      sum += p;
      n++;
    }
  }
  if (n === 0) return FALLBACK_PRESSURE;
  return roundPressure(clamp01(sum / n));
}

function flatten(points: readonly Pt[], pressure: number): number[] {
  const out: number[] = [];
  for (const p of points) out.push(round2(p.x), round2(p.y), pressure);
  return out;
}

function pathLength(points: readonly Pt[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1], points[i]);
  return total;
}

function boundsOf(points: readonly Pt[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function diagonalOf(box: Box): number {
  return Math.hypot(box.maxX - box.minX, box.maxY - box.minY);
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Shoelace area; its *sign* tells us the winding the user drew. */
function signedArea(points: readonly Pt[]): number {
  let acc = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    acc += points[j].x * points[i].y - points[i].x * points[j].y;
  }
  return acc / 2;
}

/** Interior turn at `b`, in degrees: 0 = straight on, 90 = square corner. */
function turnDeg(a: Pt, b: Pt, c: Pt): number {
  const v1x = b.x - a.x;
  const v1y = b.y - a.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const cross = v1x * v2y - v1y * v2x;
  const dot = v1x * v2x + v1y * v2y;
  return Math.abs(Math.atan2(cross, dot)) / DEG;
}

/** {@link turnDeg} with its sign: positive turns the way `atan2` angles grow. */
function signedTurnDeg(a: Pt, b: Pt, c: Pt): number {
  const v1x = b.x - a.x;
  const v1y = b.y - a.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  return Math.atan2(v1x * v2y - v1y * v2x, v1x * v2x + v1y * v2y) / DEG;
}

/** Total signed turn round a closed polygon: ±360 for a simple one, ±720 for a pentagram. */
function totalTurnDeg(vertices: readonly Pt[]): number {
  const n = vertices.length;
  let total = 0;
  for (let i = 0; i < n; i++) {
    total += signedTurnDeg(vertices[(i - 1 + n) % n], vertices[i], vertices[(i + 1) % n]);
  }
  return total;
}

/**
 * Ramer–Douglas–Peucker, iterative so a 10k-sample stroke cannot blow the
 * stack. Kept in-tree rather than adding `simplify-js`: 25 lines against a new
 * dependency (AGENTS.md wants a PLAN.md note for those).
 */
function simplify(points: readonly Pt[], tolerance: number): Pt[] {
  if (points.length <= 2) return points.slice();
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const segment = stack.pop();
    if (!segment) break;
    const [first, last] = segment;
    if (last - first < 2) continue;
    let worst = -1;
    let worstDist = tolerance;
    for (let i = first + 1; i < last; i++) {
      const d = distToSegment(points[i], points[first], points[last]);
      if (d > worstDist) {
        worstDist = d;
        worst = i;
      }
    }
    if (worst < 0) continue;
    keep[worst] = true;
    stack.push([first, worst], [worst, last]);
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * Second-sharpest turn, in degrees, over the vertices of a coarsely-simplified
 * closed copy of the loop. A polygon keeps its few sharp corners at any
 * tolerance; a circle is resolved into many shallow ones. This is what tells
 * the two apart. The *second* sharpest, because a real loop carries one
 * artefact — the notch where the Pencil landed — and a polygon has at least
 * three corners, all of them sharp; one sharp vertex proves nothing.
 */
function maxCornerDeg(points: readonly Pt[], diag: number): number {
  const tolerance = Math.max(1.5, CIRCLE_CORNER_FRACTION * diag);
  const loop = simplify(points, tolerance);
  while (loop.length > 1 && dist(loop[0], loop[loop.length - 1]) <= tolerance * 2) loop.pop();
  const n = loop.length;
  if (n < 4) return 180;
  const turns: number[] = [];
  for (let i = 0; i < n; i++) {
    turns.push(turnDeg(loop[(i - 1 + n) % n], loop[i], loop[(i + 1) % n]));
  }
  turns.sort((a, b) => b - a);
  return turns[1];
}

/**
 * A closed loop re-started at the sample farthest from its first one. The
 * farthest point from any point on a convex outline is a vertex, so this
 * puts the seam on a true corner of a polygon (and on the antipode of a
 * circle, where it does no harm). RDP anchors both ends of a sequence, and a
 * seam mid-edge costs nothing — but a seam *next to* a corner, as when an
 * overshoot ends there, lost that corner to the seam-duplicate pop and bent
 * an edge around it.
 */
function rotateToFarthest(points: readonly Pt[]): Pt[] {
  let far = 0;
  let farDist = -1;
  for (let i = 1; i < points.length; i++) {
    const d = dist(points[0], points[i]);
    if (d > farDist) {
      farDist = d;
      far = i;
    }
  }
  return [...points.slice(far), ...points.slice(0, far)];
}

// --- Line -----------------------------------------------------------------

interface LineFit {
  /** Start and end, projected onto the fitted axis (drawing order preserved). */
  a: Pt;
  b: Pt;
  span: number;
  /** Max perpendicular deviation divided by `span`. */
  err: number;
}

/**
 * Total least squares: the principal axis of the point covariance. Not
 * `y = mx + b`, which is undefined for a vertical stroke (FEASIBILITY §5.2).
 */
function fitLine(points: readonly Pt[]): LineFit | null {
  const n = points.length;
  if (n < 2) return null;
  let cx = 0;
  let cy = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
  }
  cx /= n;
  cy /= n;

  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of points) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ux = Math.cos(theta);
  const uy = Math.sin(theta);

  let maxPerp = 0;
  for (const p of points) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const perp = Math.abs(dx * uy - dy * ux);
    if (perp > maxPerp) maxPerp = perp;
  }

  const project = (p: Pt): Pt => {
    const t = (p.x - cx) * ux + (p.y - cy) * uy;
    return { x: cx + t * ux, y: cy + t * uy };
  };
  const a = project(points[0]);
  const b = project(points[n - 1]);
  const span = dist(a, b);
  if (span < 1e-6) return null;
  return { a, b, span, err: maxPerp / span };
}

/**
 * How much longer the drawn path is than the straight span, measured on a
 * lightly simplified copy. A stroke that doubles back has no perpendicular
 * error at all, so straightness alone cannot catch it — but raw sample noise
 * inflates a naive path length, hence the simplify pass.
 */
function detourOf(points: readonly Pt[], span: number): number {
  const tolerance = Math.max(1.5, DETOUR_SIMPLIFY_FRACTION * span);
  return pathLength(simplify(points, tolerance)) / span;
}

function lineCandidate(points: readonly Pt[], pressure: number): ShapeResult | null {
  const fit = fitLine(points);
  if (!fit) return null;
  const detour = detourOf(points, fit.span);
  if (detour > LINE_MAX_DETOUR) return null;
  const detourScore = clamp01(1 - (detour - 1) / (LINE_MAX_DETOUR - 1));
  const shapeScore = clamp01(1 - fit.err / LINE_MAX_ERR);
  const confidence = shapeScore * (0.7 + 0.3 * detourScore);
  return { kind: "line", pts: flatten([fit.a, fit.b], pressure), confidence };
}

// --- Circle ---------------------------------------------------------------

interface CircleFit {
  cx: number;
  cy: number;
  r: number;
  /** RMS radial deviation divided by `r`. */
  err: number;
  /** Signed total turn about the centre, in radians. */
  sweep: number;
}

/**
 * Kåsa algebraic least-squares circle: three summed moments and a 2x2 solve
 * (FEASIBILITY §5.2). Biased for short arcs, which is fine — we only accept
 * near-complete loops anyway.
 */
function fitCircle(points: readonly Pt[]): CircleFit | null {
  const n = points.length;
  if (n < 5) return null;
  let mx = 0;
  let my = 0;
  for (const p of points) {
    mx += p.x;
    my += p.y;
  }
  mx /= n;
  my /= n;

  let suu = 0;
  let suv = 0;
  let svv = 0;
  let suuu = 0;
  let svvv = 0;
  let suvv = 0;
  let svuu = 0;
  for (const p of points) {
    const u = p.x - mx;
    const v = p.y - my;
    suu += u * u;
    suv += u * v;
    svv += v * v;
    suuu += u * u * u;
    svvv += v * v * v;
    suvv += u * v * v;
    svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-9) return null;
  const c1 = 0.5 * (suuu + suvv);
  const c2 = 0.5 * (svvv + svuu);
  const uc = (c1 * svv - c2 * suv) / det;
  const vc = (suu * c2 - suv * c1) / det;
  const r2 = uc * uc + vc * vc + (suu + svv) / n;
  if (!(r2 > 0)) return null;
  const r = Math.sqrt(r2);
  if (r < 1e-6) return null;
  const cx = mx + uc;
  const cy = my + vc;

  let sqSum = 0;
  for (const p of points) {
    const d = Math.hypot(p.x - cx, p.y - cy) - r;
    sqSum += d * d;
  }
  const err = Math.sqrt(sqSum / n) / r;

  // Signed sweep, including the closing leg: an arc must not pass as a circle.
  let sweep = 0;
  let prev = Math.atan2(points[0].y - cy, points[0].x - cx);
  for (let i = 1; i <= n; i++) {
    const p = points[i % n];
    const angle = Math.atan2(p.y - cy, p.x - cx);
    let delta = angle - prev;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    sweep += delta;
    prev = angle;
  }
  return { cx, cy, r, err, sweep };
}

function circleCandidate(
  points: readonly Pt[],
  pressure: number,
  diag: number,
  axes: PrincipalAxes | null,
): ShapeResult | null {
  // An oval is the ellipse fitter's; circularising it would move the ink.
  if (axes && axes.ratio < ELLIPSE_MAX_RATIO) return null;
  const fit = fitCircle(points);
  if (!fit) return null;
  const sweep = Math.abs(fit.sweep);
  if (sweep < CIRCLE_MIN_SWEEP || sweep > CIRCLE_MAX_SWEEP) return null;
  if (maxCornerDeg(points, diag) > CIRCLE_MAX_CORNER_DEG) return null;
  const confidence = clamp01(1 - fit.err / CIRCLE_MAX_ERR);
  // Start where the pen started and turn the way it turned, so the snap lands
  // on top of the drawing instead of jumping.
  const start = Math.atan2(points[0].y - fit.cy, points[0].x - fit.cx);
  const step = ((fit.sweep < 0 ? -1 : 1) * (2 * Math.PI)) / CIRCLE_SEGMENTS;
  const ring: Pt[] = [];
  for (let i = 0; i <= CIRCLE_SEGMENTS; i++) {
    const angle = start + step * i;
    ring.push({ x: fit.cx + fit.r * Math.cos(angle), y: fit.cy + fit.r * Math.sin(angle) });
  }
  return { kind: "circle", pts: flatten(ring, pressure), confidence };
}

// --- Ellipse --------------------------------------------------------------

interface PrincipalAxes {
  cx: number;
  cy: number;
  /** Major-axis direction, radians. */
  theta: number;
  /** Semi-axes: `a` along `theta`, `b` across it. */
  a: number;
  b: number;
  /** b / a, in 0..1. */
  ratio: number;
}

/**
 * Orientation from the covariance's principal axis (symmetric, so uneven pen
 * speed cannot tilt it); size and centre from the extents in that frame — the
 * same "fit the frame, then take the box" idea as the rectangle fitter.
 */
function principalAxes(points: readonly Pt[]): PrincipalAxes | null {
  const axis = fitAxis(points);
  if (!axis || points.length < 5) return null;
  return axesInFrame(points, Math.atan2(axis.uy, axis.ux));
}

function axesInFrame(points: readonly Pt[], theta: number): PrincipalAxes | null {
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const p of points) {
    const u = p.x * cos + p.y * sin;
    const v = -p.x * sin + p.y * cos;
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  let a = (maxU - minU) / 2;
  let b = (maxV - minV) / 2;
  let major = theta;
  if (b > a) {
    [a, b] = [b, a];
    major = theta + Math.PI / 2;
  }
  if (!(a > 1e-6)) return null;
  const cu = (minU + maxU) / 2;
  const cv = (minV + maxV) / 2;
  return { cx: cu * cos - cv * sin, cy: cu * sin + cv * cos, theta: major, a, b, ratio: b / a };
}

/** Signed total turn of the loop about a point, closing leg included. */
function sweepAbout(points: readonly Pt[], cx: number, cy: number): number {
  const n = points.length;
  let sweep = 0;
  let prev = Math.atan2(points[0].y - cy, points[0].x - cx);
  for (let i = 1; i <= n; i++) {
    const p = points[i % n];
    const angle = Math.atan2(p.y - cy, p.x - cx);
    let delta = angle - prev;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    sweep += delta;
    prev = angle;
  }
  return sweep;
}

function ellipseCandidate(
  points: readonly Pt[],
  pressure: number,
  found: PrincipalAxes | null,
): ShapeResult | null {
  if (!found) return null;
  if (found.ratio >= ELLIPSE_MAX_RATIO || found.ratio < ELLIPSE_MIN_RATIO) return null;
  const sweep = sweepAbout(points, found.cx, found.cy);
  if (Math.abs(sweep) < CIRCLE_MIN_SWEEP || Math.abs(sweep) > CIRCLE_MAX_SWEEP) return null;

  // Map the loop onto a circle of radius UNIT. The corner gate runs there: an oval's
  // tips are tight bends in page space but round out under this map, while a
  // polygon's corners are still corners after any affine map.
  const cos = Math.cos(found.theta);
  const sin = Math.sin(found.theta);
  const unit: Pt[] = points.map((p) => {
    const dx = p.x - found.cx;
    const dy = p.y - found.cy;
    return {
      x: (UNIT * (dx * cos + dy * sin)) / found.a,
      y: (UNIT * (-dx * sin + dy * cos)) / found.b,
    };
  });
  if (maxCornerDeg(unit, diagonalOf(boundsOf(unit))) > CIRCLE_MAX_CORNER_DEG) return null;

  // Score against the fitted frame, never the snapped one (see rectCandidate).
  let sqSum = 0;
  for (const p of unit) {
    const d = Math.hypot(p.x, p.y) / UNIT - 1;
    sqSum += d * d;
  }
  const confidence = clamp01(1 - Math.sqrt(sqSum / points.length) / ELLIPSE_MAX_ERR);

  // Beautify: an oval drawn a few degrees off level is meant to be level.
  const quarter = Math.PI / 2;
  const offAxis = found.theta - Math.round(found.theta / quarter) * quarter;
  // Otherwise keep the tilt, on a 0.5° grid: re-fitting our own output then
  // lands on the same frame every pass instead of jittering by a rounding step.
  const tilt = ELLIPSE_TILT_STEP_DEG * DEG;
  const theta =
    Math.abs(offAxis) <= ELLIPSE_AXIS_SNAP_DEG * DEG
      ? found.theta - offAxis
      : Math.round(found.theta / tilt) * tilt;
  const axes = axesInFrame(points, theta) ?? found;

  // Start at the pen-down point's parameter and turn the way the pen turned,
  // so the snap lands on top of the drawing instead of jumping.
  const c = Math.cos(axes.theta);
  const s = Math.sin(axes.theta);
  const dx = points[0].x - axes.cx;
  const dy = points[0].y - axes.cy;
  // Quantised to a whole segment, so the samples land exactly on the axis
  // tips; otherwise re-fitting the output would shrink it a hair every pass.
  const segment = (2 * Math.PI) / ELLIPSE_SEGMENTS;
  const raw = Math.atan2((-dx * s + dy * c) / axes.b, (dx * c + dy * s) / axes.a);
  const start = Math.round(raw / segment) * segment;
  const direction = sweep < 0 ? -1 : 1;
  const ring = ellipsePoints(axes.cx, axes.cy, axes.a, axes.b, axes.theta, start, direction);
  return { kind: "ellipse", pts: flatten(ring, pressure), confidence };
}

// --- Polygon (triangle, diamond, other quads, pentagon, hexagon) ----------

interface Axis {
  cx: number;
  cy: number;
  ux: number;
  uy: number;
}

/** Total-least-squares line through `points`, as a centroid and a direction. */
function fitAxis(points: readonly Pt[]): Axis | null {
  const n = points.length;
  if (n < 2) return null;
  let cx = 0;
  let cy = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
  }
  cx /= n;
  cy /= n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of points) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx + syy < 1e-9) return null;
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { cx, cy, ux: Math.cos(theta), uy: Math.sin(theta) };
}

function intersect(l1: Axis, l2: Axis): Pt | null {
  const cross = l1.ux * l2.uy - l1.uy * l2.ux;
  if (Math.abs(cross) < 1e-6) return null;
  const t = ((l2.cx - l1.cx) * l2.uy - (l2.cy - l1.cy) * l2.ux) / cross;
  return { x: l1.cx + t * l1.ux, y: l1.cy + t * l1.uy };
}

/** The samples of a closed loop from index `from` to `to`, wrapping the seam. */
function loopSlice(points: readonly Pt[], from: number, to: number): Pt[] {
  if (from <= to) return points.slice(from, to + 1);
  return [...points.slice(from), ...points.slice(0, to + 1)];
}

/** The middle of an edge's samples: its ends are where the hand turned. */
function trimEdge(edge: readonly Pt[]): Pt[] {
  if (edge.length < 5) return edge.slice();
  const cut = Math.floor(edge.length * POLY_EDGE_TRIM);
  return edge.slice(cut, edge.length - cut);
}

/** RMS distance from `points` to the closed polygon `poly`. */
function polygonResidual(points: readonly Pt[], poly: readonly Pt[]): number {
  let sqSum = 0;
  for (const p of points) {
    let nearest = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const d = distToSegment(p, poly[i], poly[(i + 1) % poly.length]);
      if (d < nearest) nearest = d;
    }
    sqSum += nearest * nearest;
  }
  return Math.sqrt(sqSum / points.length);
}

interface PolygonFit {
  vertices: Pt[];
  /** RMS distance to the straightened outline over the diagonal. */
  err: number;
}

/**
 * Straighten a closed loop whose RDP corners are `cornerPts` (in loop order,
 * each one of the `points` objects itself): fit a line to each edge's samples
 * and put every vertex where its two edge lines cross.
 */
function straighten(
  points: readonly Pt[],
  cornerPts: readonly Pt[],
  diag: number,
): PolygonFit | null {
  const n = cornerPts.length;
  const indices = cornerPts.map((c) => points.indexOf(c));
  if (indices.some((i) => i < 0)) return null;

  const edges: Pt[][] = [];
  const lines: Axis[] = [];
  for (let i = 0; i < n; i++) {
    const edge = loopSlice(points, indices[i], indices[(i + 1) % n]);
    const line = fitAxis(trimEdge(edge));
    if (!line) return null;
    edges.push(edge);
    lines.push(line);
  }

  const vertices: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const crossing = intersect(lines[(i - 1 + n) % n], lines[i]);
    const corner = cornerPts[i];
    const near = crossing && dist(crossing, corner) <= POLY_VERTEX_MAX_SHIFT * diag;
    vertices.push(near ? crossing : corner);
  }

  // Every edge must itself be straight — see POLY_EDGE_MAX_ERR.
  for (let i = 0; i < n; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % n];
    const len = dist(a, b);
    if (len < 1e-6) return null;
    let sqSum = 0;
    for (const p of edges[i]) {
      const d = distToSegment(p, a, b);
      sqSum += d * d;
    }
    if (Math.sqrt(sqSum / edges[i].length) / len > POLY_EDGE_MAX_ERR) return null;
  }

  // ...and the hand must actually have reached every corner — see
  // POLY_MAX_CORNER_GAP.
  for (let i = 0; i < n; i++) {
    const v = vertices[i];
    const shorter = Math.min(dist(v, vertices[(i + 1) % n]), dist(v, vertices[(i - 1 + n) % n]));
    let nearest = Infinity;
    for (const p of points) nearest = Math.min(nearest, dist(p, v));
    if (nearest > POLY_MAX_CORNER_GAP * shorter) return null;
    // ...and turn like a corner, not like a bend in an arc.
    if (turnDeg(vertices[(i - 1 + n) % n], v, vertices[(i + 1) % n]) < POLY_MIN_TURN_DEG) {
      return null;
    }
  }
  return { vertices, err: polygonResidual(points, vertices) / diag };
}

/**
 * The rect fitter's territory: four corners within {@link RECT_CORNER_TOL_DEG}
 * of a right angle, opposite sides within {@link RECT_MAX_CONVERGENCE_DEG} of
 * parallel. The polygon fitter hands these over rather than keeping the skew
 * (a sloppy square must come back square, never as a parallelogram), and
 * everything else — a trapezoid, a kite — stays a polygon.
 */
function isRectLike(v: readonly Pt[]): boolean {
  if (v.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    if (Math.abs(turnDeg(v[(i + 3) % 4], v[i], v[(i + 1) % 4]) - 90) > RECT_CORNER_TOL_DEG) {
      return false;
    }
  }
  for (let i = 0; i < 2; i++) {
    const a = v[i];
    const b = v[i + 1];
    const c = v[i + 2];
    const d = v[(i + 3) % 4];
    if (angleBetweenDeg(b.x - a.x, b.y - a.y, c.x - d.x, c.y - d.y) > RECT_MAX_CONVERGENCE_DEG) {
      return false;
    }
  }
  return true;
}

/** Four near-equal sides, standing on a point: diagonals along the axes. */
function isDiamond(v: readonly Pt[]): boolean {
  if (v.length !== 4) return false;
  const sides = [0, 1, 2, 3].map((i) => dist(v[i], v[(i + 1) % 4]));
  const mean = (sides[0] + sides[1] + sides[2] + sides[3]) / 4;
  if (sides.some((len) => Math.abs(len - mean) > DIAMOND_SIDE_TOL * mean)) return false;
  const quarter = Math.PI / 2;
  for (const [p, q] of [
    [v[0], v[2]],
    [v[1], v[3]],
  ]) {
    const angle = Math.atan2(q.y - p.y, q.x - p.x);
    if (Math.abs(angle - Math.round(angle / quarter) * quarter) > DIAMOND_AXIS_TOL_DEG * DEG) {
      return false;
    }
  }
  return true;
}

function polygonCandidate(
  drawn: readonly Pt[],
  pressure: number,
  diag: number,
): ShapeResult | null {
  const origin = drawn[0];
  const points = rotateToFarthest(drawn);
  const window = CORNER_WINDOW_FRACTION * pathLength(points);
  // Every tolerance can yield a different corner count. Keep the fewest-sided
  // straightening that fits nearly as well as the best: a wobble in one edge
  // must not turn a triangle into a quadrilateral.
  const base = Math.max(2.5, RECT_SIMPLIFY_FRACTION * diag);
  const fits: PolygonFit[] = [];
  for (const step of POLY_SIMPLIFY_STEPS) {
    const tolerance = base * step;
    const loop = simplify(points, tolerance);
    while (loop.length > 1 && dist(loop[0], loop[loop.length - 1]) <= tolerance * 2) loop.pop();
    const found = corners(loop);
    // No de-duplication by count: two tolerances can yield the same number
    // of corners in different places, and the first failing proves nothing
    // about the second (measured on real ink: 4 then 3 then 3 corners).
    if (found.length < POLY_MIN_SIDES || found.length > POLY_MAX_SIDES) continue;
    // The ink must turn like a corner at every vertex but one (see the rect
    // fitter's RECT_SOFT_CORNER_MIN_DEG): a D's arc "vertex" measured 27°,
    // and the loosened edge gates alone would have made it a triangle.
    const sharpness = found
      .map((c) => sharpnessAt(points, points.indexOf(c), window))
      .sort((a, b) => a - b);
    if (sharpness[0] < RECT_SOFT_CORNER_MIN_DEG || sharpness[1] < RECT_MIN_SHARPNESS_DEG) continue;
    const fit = straighten(points, found, diag);
    // A polygon goes round once. A pentagram straightens beautifully into
    // five sharp corners and five straight edges — and winds twice; it is
    // the star fitter's, never a self-crossing "pentagon".
    if (fit && Math.abs(totalTurnDeg(fit.vertices)) <= 540) fits.push(fit);
  }
  if (fits.length === 0) return null;
  const bestErr = Math.min(...fits.map((f) => f.err));
  fits.sort((p, q) => p.vertices.length - q.vertices.length);
  const chosen = fits.find((f) => f.err <= bestErr * 1.25 + 0.004) ?? fits[0];

  const vertices = chosen.vertices;
  // Four right angles is a rectangle, and the rectangle fitter owns those —
  // unless it stands on a point, which is a diamond.
  const diamond = isDiamond(vertices);
  if (!diamond && isRectLike(vertices)) return null;
  const confidence = clamp01(1 - chosen.err / POLY_MAX_ERR);
  const kind: ShapeKind = vertices.length === 3 ? "triangle" : diamond ? "diamond" : "polygon";

  // Begin at the vertex nearest pen-down, keeping the drawn winding.
  let startIndex = 0;
  let best = Infinity;
  vertices.forEach((v, i) => {
    const d = dist(v, origin);
    if (d < best) {
      best = d;
      startIndex = i;
    }
  });
  const n = vertices.length;
  const ordered: Pt[] = [];
  for (let k = 0; k <= n; k++) ordered.push(vertices[(startIndex + k) % n]);
  return { kind, pts: flatten(ordered, pressure), confidence };
}

// --- Rectangle ------------------------------------------------------------

/** Drop simplified vertices that barely turn — e.g. the seam of a loop that
 *  started mid-edge, which RDP always keeps because it anchors the endpoints. */
function corners(loop: readonly Pt[]): Pt[] {
  const n = loop.length;
  if (n < 3) return loop.slice();
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const prev = loop[(i - 1 + n) % n];
    const next = loop[(i + 1) % n];
    if (turnDeg(prev, loop[i], next) >= RECT_MIN_TURN_DEG) out.push(loop[i]);
  }
  return out;
}

/** The 4 corners of the bounding box of `points` in a frame rotated by `theta`. */
function orientedBox(points: readonly Pt[], theta: number): { box: Pt[]; diag: number } {
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const p of points) {
    const u = p.x * cos + p.y * sin;
    const v = -p.x * sin + p.y * cos;
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  const unrotate = (u: number, v: number): Pt => ({ x: u * cos - v * sin, y: u * sin + v * cos });
  return {
    box: [unrotate(minU, minV), unrotate(maxU, minV), unrotate(maxU, maxV), unrotate(minU, maxV)],
    diag: Math.hypot(maxU - minU, maxV - minV),
  };
}

/** RMS distance from every raw point to the nearest edge of `box`. */
function boxResidual(points: readonly Pt[], box: readonly Pt[]): number {
  let sqSum = 0;
  for (const p of points) {
    let nearest = Infinity;
    for (let i = 0; i < 4; i++) {
      const d = distToSegment(p, box[i], box[(i + 1) % 4]);
      if (d < nearest) nearest = d;
    }
    sqSum += nearest * nearest;
  }
  return Math.sqrt(sqSum / points.length);
}

/**
 * How sharply the ink turns at sample `index` of a closed loop: the angle
 * between the chords to the samples `window` px of path behind and ahead of
 * it (wrapping across the seam). A drawn corner reads ~90° at any window
 * shorter than its sides; an arc reads window/r radians — a lumpy circle's
 * coarse RDP "corners" bend ~30° here where a rectangle's turn ~90°.
 */
function sharpnessAt(points: readonly Pt[], index: number, window: number): number {
  const n = points.length;
  const reach = (step: 1 | -1): Pt => {
    let walked = 0;
    let i = index;
    for (let k = 0; k < n - 1; k++) {
      const j = (i + step + n) % n;
      walked += dist(points[i], points[j]);
      i = j;
      if (walked >= window) break;
    }
    return points[i];
  };
  return turnDeg(reach(-1), points[index], reach(1));
}

/**
 * The rectangle a straightened quad means: the length-weighted mean of its
 * edge directions (folded to a quarter turn) for the orientation, and in
 * that frame the average of each pair of opposite vertices for the sides —
 * the box that runs through the middle of the drawn edges, rather than the
 * bounding box that every lump and corner tick pushes outward.
 */
function rectFromQuad(quad: readonly Pt[]): { box: Pt[]; theta: number } {
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const len = dist(a, b);
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    sx += len * Math.cos(4 * angle);
    sy += len * Math.sin(4 * angle);
  }
  let theta = Math.atan2(sy, sx) / 4;
  if (Math.abs(theta) <= RECT_AXIS_SNAP_DEG * DEG) theta = 0;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const us = quad.map((p) => p.x * cos + p.y * sin).sort((a, b) => a - b);
  const vs = quad.map((p) => -p.x * sin + p.y * cos).sort((a, b) => a - b);
  const left = (us[0] + us[1]) / 2;
  const right = (us[2] + us[3]) / 2;
  const top = (vs[0] + vs[1]) / 2;
  const bottom = (vs[2] + vs[3]) / 2;
  const unrotate = (u: number, v: number): Pt => ({ x: u * cos - v * sin, y: u * sin + v * cos });
  return {
    box: [
      unrotate(left, top),
      unrotate(right, top),
      unrotate(right, bottom),
      unrotate(left, bottom),
    ],
    theta,
  };
}

function rectCandidate(drawn: readonly Pt[], pressure: number, diag: number): ShapeResult | null {
  const origin = drawn[0];
  const points = rotateToFarthest(drawn);
  // Adaptive RDP: a sloppy rectangle needs a coarser tolerance before its four
  // corners fall out, a crisp one needs a fine tolerance to keep them apart.
  // Every tolerance that yields four corners is tried, since a coarse one can
  // find a different four (measured on real ink: 5, 6, 4 then 4 corners).
  const base = Math.max(2.5, RECT_SIMPLIFY_FRACTION * diag);
  const window = CORNER_WINDOW_FRACTION * pathLength(points);
  let fit: PolygonFit | null = null;
  let corner: Pt[] | null = null;
  for (const step of POLY_SIMPLIFY_STEPS) {
    const tolerance = base * step;
    const loop = simplify(points, tolerance);
    while (loop.length > 1 && dist(loop[0], loop[loop.length - 1]) <= tolerance * 2) loop.pop();
    const quad = corners(loop);
    if (quad.length !== 4) continue;
    // Rectangle-ness is judged on the corner *samples*: a bowed edge skews a
    // fitted line by several degrees, but the corners still say where the
    // hand went. The straightened quad only measures how well it fits.
    if (!isRectLike(quad)) continue;
    const sharpness = quad
      .map((c) => sharpnessAt(points, points.indexOf(c), window))
      .sort((a, b) => a - b);
    if (sharpness[0] < RECT_SOFT_CORNER_MIN_DEG || sharpness[1] < RECT_MIN_SHARPNESS_DEG) continue;
    const candidate = straighten(points, quad, diag);
    if (candidate && (!fit || candidate.err < fit.err)) {
      fit = candidate;
      corner = quad;
    }
  }
  if (!fit || !corner) return null;

  let angleErrSum = 0;
  for (let i = 0; i < 4; i++) {
    angleErrSum += Math.abs(turnDeg(corner[(i + 3) % 4], corner[i], corner[(i + 1) % 4]) - 90);
  }

  // Score against the straightened quad — that is what measures "four
  // straight sides at roughly right angles". Squaring it up and axis snapping
  // are beautification, and must not punish a stroke for being drawn a
  // little trapezoid or a couple of degrees off true.
  const cornerScore = clamp01(1 - angleErrSum / 4 / RECT_CORNER_TOL_DEG);
  const confidence = clamp01(1 - fit.err / RECT_MAX_ERR) * (0.75 + 0.25 * cornerScore);

  const emitted = rectFromQuad(fit.vertices);
  if (
    Math.hypot(emitted.box[2].x - emitted.box[0].x, emitted.box[2].y - emitted.box[0].y) < MIN_SPAN
  ) {
    return null;
  }
  let box = emitted.box;
  if (signedArea(box) * signedArea(points) < 0) box = [box[0], box[3], box[2], box[1]];
  // Begin at the corner nearest the pen-down point, preserving the seam.
  let startIndex = 0;
  let best = Infinity;
  for (let i = 0; i < 4; i++) {
    const d = dist(box[i], origin);
    if (d < best) {
      best = d;
      startIndex = i;
    }
  }
  const ordered = [0, 1, 2, 3, 0].map((k) => box[(startIndex + k) % 4]);
  return { kind: "rect", pts: flatten(ordered, pressure), confidence };
}

// --- Arrow ----------------------------------------------------------------

/**
 * A long straight shaft, then a short V retraced at the far end. Deliberately
 * the strictest fitter here: both barbs must exist, on opposite sides, or the
 * stroke is not an arrow. A tick or an L must never snap to one.
 */
function arrowCandidate(points: readonly Pt[], pressure: number, diag: number): ShapeResult | null {
  const total = pathLength(points);
  if (total < 1e-6) return null;

  // The tip is the point furthest from the pen-down point — but the pen
  // *returns* to the tip between the two barbs, and noise can make that second
  // visit measure marginally further. Take the FIRST index that reaches the
  // maximum, or the shaft silently swallows a barb and fails the detour gate.
  let tipDist = 0;
  for (let i = 1; i < points.length; i++) {
    const d = dist(points[0], points[i]);
    if (d > tipDist) tipDist = d;
  }
  const tipSlack = Math.max(1.5, 0.01 * tipDist);
  let tipIndex = -1;
  for (let i = 1; i < points.length; i++) {
    if (dist(points[0], points[i]) >= tipDist - tipSlack) {
      tipIndex = i;
      break;
    }
  }
  // Need a shaft before the tip and at least two points of head after it.
  // Not more: an already-snapped arrow is only six points long.
  if (tipIndex < 1 || tipIndex > points.length - 3) return null;

  const shaftPoints = points.slice(0, tipIndex + 1);
  const shaft = fitLine(shaftPoints);
  if (!shaft) return null;
  if (shaft.err > ARROW_SHAFT_MAX_ERR) return null;
  if (shaft.span < MIN_SPAN || shaft.span < ARROW_MIN_SHAFT_FRACTION * total) return null;
  if (detourOf(shaftPoints, shaft.span) > ARROW_SHAFT_MAX_DETOUR) return null;

  const tip = shaft.b;
  const tail = shaft.a;
  const ux = (tip.x - tail.x) / shaft.span;
  const uy = (tip.y - tail.y) / shaft.span;

  // Head points measured in the shaft frame: `along` runs back from the tip,
  // `side` is the signed offset that tells the two barbs apart.
  let sideMax = 0;
  let sideMin = 0;
  let barbPlus: Pt | null = null;
  let barbMinus: Pt | null = null;
  for (let i = tipIndex; i < points.length; i++) {
    const p = points[i];
    const dx = p.x - tip.x;
    const dy = p.y - tip.y;
    if (Math.hypot(dx, dy) > ARROW_MAX_BARB * shaft.span) return null;
    const side = dx * uy - dy * ux;
    if (side > sideMax) {
      sideMax = side;
      barbPlus = p;
    } else if (side < sideMin) {
      sideMin = side;
      barbMinus = p;
    }
  }
  if (!barbPlus || !barbMinus) return null;

  const measure = (barb: Pt): { len: number; deg: number } => {
    const dx = barb.x - tip.x;
    const dy = barb.y - tip.y;
    const len = Math.hypot(dx, dy);
    const along = -(dx * ux + dy * uy);
    return { len, deg: Math.atan2(Math.abs(dx * uy - dy * ux), along) / DEG };
  };
  const plus = measure(barbPlus);
  const minus = measure(barbMinus);
  for (const barb of [plus, minus]) {
    if (barb.len < ARROW_MIN_BARB * shaft.span || barb.len > ARROW_MAX_BARB * shaft.span) {
      return null;
    }
    if (barb.deg < ARROW_MIN_HEAD_DEG || barb.deg > ARROW_MAX_HEAD_DEG) return null;
  }
  if (diag < MIN_SPAN) return null;

  const meanLen = (plus.len + minus.len) / 2;
  let headDeg = (plus.deg + minus.deg) / 2;
  if (headDeg < ARROW_EMIT_MIN_DEG) headDeg = ARROW_EMIT_MIN_DEG;
  else if (headDeg > ARROW_EMIT_MAX_DEG) headDeg = ARROW_EMIT_MAX_DEG;
  const head = headDeg * DEG;
  const backX = -ux;
  const backY = -uy;
  const rotate = (sign: number): Pt => {
    const c = Math.cos(sign * head);
    const s = Math.sin(sign * head);
    return {
      x: tip.x + meanLen * (backX * c - backY * s),
      y: tip.y + meanLen * (backX * s + backY * c),
    };
  };
  // Same layout as contracts/fixtures/doc-v2-shapes.json: shaft, then the V
  // retraced through the tip, so one polyline draws the whole arrow.
  const geometry = [tail, tip, tip, rotate(1), tip, rotate(-1)];

  const straightScore = clamp01(1 - shaft.err / ARROW_SHAFT_MAX_ERR);
  const lengthSym = clamp01(1 - Math.abs(plus.len - minus.len) / Math.max(plus.len, minus.len));
  const angleSym = clamp01(1 - Math.abs(plus.deg - minus.deg) / 40);
  const confidence = straightScore * (0.6 + 0.25 * lengthSym + 0.15 * angleSym);
  return { kind: "arrow", pts: flatten(geometry, pressure), confidence };
}

// --- Retrace arrow ----------------------------------------------------------

/**
 * Apple Notes' arrow (Joost, 2026-09-22): a straight line, then back a little
 * way along it, then hold. The head goes where the pen turned, pointing the
 * way the line was drawn, and the shaft runs from pen-down to the turn.
 *
 * Read on the **raw** points: the hook trimmer would cut a short retrace off
 * as a lift hook and hand the line fitter a line. The retrace only decides
 * *that* the stroke is an arrow; how good an arrow is the line fitter's own
 * score for the shaft, so a retrace arrow is exactly as confident as the line
 * it was drawn along. Nobody drew the head, so it is emitted at a default
 * size ({@link arrowPoints}).
 */
function retraceArrowCandidate(points: readonly Pt[], pressure: number): ShapeResult | null {
  const n = points.length;
  if (n < 4) return null;
  // The turn is the farthest point from pen-down — the first sample to reach
  // it, as for the barb arrow's tip: the retrace passes back near it.
  let far = 0;
  for (let i = 1; i < n; i++) far = Math.max(far, dist(points[0], points[i]));
  const slack = Math.max(1.5, 0.01 * far);
  let turn = -1;
  for (let i = 1; i < n; i++) {
    if (dist(points[0], points[i]) >= far - slack) {
      turn = i;
      break;
    }
  }
  if (turn < 1 || turn >= n - 1) return null;

  // The shaft, less its pen-down hook; the retrace is at the other end.
  const shaftPoints = trimHook(points.slice(0, turn + 1), true);
  const shaft = fitLine(shaftPoints);
  if (!shaft || shaft.span < MIN_SPAN) return null;
  const detour = detourOf(shaftPoints, shaft.span);
  if (detour > LINE_MAX_DETOUR) return null;

  // The retrace, less a lift hook at its end: it must run straight back,
  // nearly on top of the shaft, some way but not all the way.
  const back = trimHook(points.slice(turn), false);
  const end = back[back.length - 1];
  const ux = (shaft.b.x - shaft.a.x) / shaft.span;
  const uy = (shaft.b.y - shaft.a.y) / shaft.span;
  const vx = end.x - shaft.b.x;
  const vy = end.y - shaft.b.y;
  const along = -(vx * ux + vy * uy);
  if (along < Math.max(RETRACE_MIN_PX, RETRACE_MIN_FRACTION * shaft.span)) return null;
  if (along > RETRACE_MAX_FRACTION * shaft.span) return null;
  if (angleBetweenDeg(vx, vy, -ux, -uy) > RETRACE_MAX_ANGLE_DEG) return null;
  if (detourOf(back, dist(back[0], end)) > RETRACE_MAX_DETOUR) return null;

  const detourScore = clamp01(1 - (detour - 1) / (LINE_MAX_DETOUR - 1));
  const confidence = clamp01(1 - shaft.err / LINE_MAX_ERR) * (0.7 + 0.3 * detourScore);
  return { kind: "arrow", pts: flatten(arrowPoints(shaft.a, shaft.b), pressure), confidence };
}

// --- Star -------------------------------------------------------------------

/** {@link corners} with the star's lower turn floor: a fat star's notches are shallow. */
function starCorners(loop: readonly Pt[]): Pt[] {
  const n = loop.length;
  if (n < 3) return loop.slice();
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const turn = turnDeg(loop[(i - 1 + n) % n], loop[i], loop[(i + 1) % n]);
    if (turn >= STAR_MIN_TURN_DEG) out.push(loop[i]);
  }
  return out;
}

/**
 * Merge a rounded tip that RDP split in two: consecutive corners turning the
 * same way, much closer together than corners usually are. A small star with
 * rounded tips measured 57° and 52° a few px apart where one tip was drawn,
 * and the coarser tolerance that joined them dropped a shallow notch instead.
 * The pair becomes the sample between them farthest from the corners'
 * centroid — the apex of the tip. Outline corners alternate in sign and a
 * pentagram's are far apart, so nothing else is ever merged.
 */
function mergeSplitCorners(points: readonly Pt[], found: readonly Pt[]): Pt[] {
  const n = found.length;
  if (n < 4) return found.slice();
  const turns = found.map((c, i) => signedTurnDeg(found[(i - 1 + n) % n], c, found[(i + 1) % n]));
  const sides = found.map((p, i) => dist(p, found[(i + 1) % n])).sort((a, b) => a - b);
  const typical = sides[Math.floor(n / 2)];
  const split = (i: number): boolean => {
    const j = (i + 1) % n;
    return (
      Math.sign(turns[i]) === Math.sign(turns[j]) &&
      dist(found[i], found[j]) < STAR_SPLIT_TIP_FRACTION * typical
    );
  };
  // Start where no pair straddles the seam of the list.
  let first = 0;
  while (first < n && split((first - 1 + n) % n)) first++;
  if (first === n) return found.slice();
  const cx = mean(found.map((p) => p.x));
  const cy = mean(found.map((p) => p.y));
  const out: Pt[] = [];
  for (let k = 0; k < n; k++) {
    const i = (first + k) % n;
    if (k < n - 1 && split(i)) {
      const from = points.indexOf(found[i]);
      const to = points.indexOf(found[(i + 1) % n]);
      let apex = found[i];
      if (from >= 0 && to >= 0) {
        let farthest = -1;
        for (const p of loopSlice(points, from, to)) {
          const d = Math.hypot(p.x - cx, p.y - cy);
          if (d > farthest) {
            farthest = d;
            apex = p;
          }
        }
      }
      out.push(apex);
      k++;
    } else {
      out.push(found[i]);
    }
  }
  return out;
}

/**
 * RMS distance of a closed loop's samples from index `from` to `to` (wrapping
 * the seam) from the chord joining those two samples, over its length.
 */
function edgeDeviation(points: readonly Pt[], from: number, to: number): number {
  const a = points[from];
  const b = points[to];
  const len = dist(a, b);
  if (len < 1e-6) return Infinity;
  const edge = loopSlice(points, from, to);
  let sqSum = 0;
  for (const p of edge) {
    const d = distToSegment(p, a, b);
    sqSum += d * d;
  }
  return Math.sqrt(sqSum / edge.length) / len;
}

/** Signed step from angle `a` to angle `b` (radians), in degrees, folded into (−180, 180]. */
function angleStepDeg(a: number, b: number): number {
  let d = (b - a) / DEG;
  while (d > 180) d -= 360;
  while (d <= -180) d += 360;
  return d;
}

function mean(values: readonly number[]): number {
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

interface StarFit {
  pentagram: boolean;
  cx: number;
  cy: number;
  /** Tip radius. */
  outer: number;
  /** Notch radius over tip radius (outline only). */
  ratio: number;
  /** The angle of a tip, radians. Any tip: the star repeats every 72°. */
  phase: number;
  /** +1 when the pen turned the way `atan2` angles grow. */
  direction: 1 | -1;
  /** RMS distance to the fitted regular star, over its tip radius. */
  err: number;
}

/**
 * The common angle of five tips spaced 72° apart about (cx, cy): multiplied
 * by five, every tip's angle lands in the same place, so their mean needs no
 * tip singled out and uneven spacing averages out.
 */
function fivefoldPhase(cx: number, cy: number, tips: readonly Pt[]): number {
  let s = 0;
  let c = 0;
  for (const t of tips) {
    const a = Math.atan2(t.y - cy, t.x - cx);
    s += Math.sin(5 * a);
    c += Math.cos(5 * a);
  }
  return Math.atan2(s, c) / 5;
}

/**
 * Structure shared by both kinds of star: every step between consecutive
 * corners goes round the centre the same way by about `ideal` degrees, every
 * edge between them is straight, and the tips are about equally far out.
 */
function starStructure(
  points: readonly Pt[],
  found: readonly Pt[],
  tips: readonly Pt[],
  cx: number,
  cy: number,
  direction: 1 | -1,
  ideal: number,
): { outer: number; indices: number[] } | null {
  const n = found.length;
  const tipR = tips.map((p) => Math.hypot(p.x - cx, p.y - cy));
  const outer = mean(tipR);
  if (!(outer > 1e-6)) return null;
  if ((Math.max(...tipR) - Math.min(...tipR)) / outer > STAR_MAX_TIP_SPREAD) return null;
  const angles = found.map((p) => Math.atan2(p.y - cy, p.x - cx));
  for (let i = 0; i < n; i++) {
    const step = angleStepDeg(angles[i], angles[(i + 1) % n]);
    if (Math.sign(step) !== direction) return null;
    if (Math.abs(Math.abs(step) - ideal) > STAR_MAX_STEP_DEV_DEG) return null;
  }
  const indices = found.map((c) => points.indexOf(c));
  if (indices.some((i) => i < 0)) return null;
  for (let i = 0; i < n; i++) {
    if (edgeDeviation(points, indices[i], indices[(i + 1) % n]) > STAR_EDGE_MAX_ERR) return null;
  }
  return { outer, indices };
}

/**
 * Ten corners alternating tip and notch, going round once: the outline of a
 * five-point star. Tips turn with the winding and notches against it — a
 * decagon or a pentagon drawn twice turns one way throughout. A five-petal
 * flower has the alternation exactly and is kept out by its curved edges.
 */
function fitStarOutline(
  points: readonly Pt[],
  found: readonly Pt[],
  perimeter: number,
): StarFit | null {
  const n = found.length;
  const turns = found.map((c, i) => signedTurnDeg(found[(i - 1 + n) % n], c, found[(i + 1) % n]));
  for (let i = 0; i < n; i++) {
    if (Math.sign(turns[i]) === Math.sign(turns[(i + 1) % n])) return null;
  }
  // Tips turn ~144° and notches ~72° back, so the sum carries the winding.
  const direction: 1 | -1 = turns.reduce((s, t) => s + t, 0) >= 0 ? 1 : -1;
  const isTip = turns.map((t) => Math.sign(t) === direction);
  const cx = mean(found.map((p) => p.x));
  const cy = mean(found.map((p) => p.y));
  const tips = found.filter((_, i) => isTip[i]);
  const notchR = found.filter((_, i) => !isTip[i]).map((p) => Math.hypot(p.x - cx, p.y - cy));
  const structure = starStructure(points, found, tips, cx, cy, direction, 36);
  if (!structure) return null;
  const { outer, indices } = structure;
  const ratio = mean(notchR) / outer;
  if (!(ratio >= STAR_MIN_RATIO && ratio <= STAR_MAX_RATIO)) return null;
  const shortestTip = Math.min(...tips.map((p) => Math.hypot(p.x - cx, p.y - cy)));
  if (shortestTip < STAR_MIN_TIP_OVER_NOTCH * Math.max(...notchR)) return null;
  // A drawn tip is a sharp turn of the ink, not a rounded lobe.
  const window = STAR_TIP_WINDOW_FRACTION * perimeter;
  for (let i = 0; i < n; i++) {
    if (isTip[i] && sharpnessAt(points, indices[i], window) < STAR_MIN_TIP_SHARPNESS_DEG) {
      return null;
    }
  }
  const phase = fivefoldPhase(cx, cy, tips);
  const model = starPoints(cx, cy, outer, ratio * outer, phase).slice(0, -1);
  const err = polygonResidual(points, model) / outer;
  return { pentagram: false, cx, cy, outer, ratio, phase, direction, err };
}

/**
 * Five corners, each turning sharply the same way, going round the centre
 * twice: the one-stroke pentagram. A pentagon turns 72° at each corner and
 * goes round once.
 */
function fitPentagram(points: readonly Pt[], found: readonly Pt[]): StarFit | null {
  const n = found.length;
  const turns = found.map((c, i) => signedTurnDeg(found[(i - 1 + n) % n], c, found[(i + 1) % n]));
  const direction: 1 | -1 = turns[0] >= 0 ? 1 : -1;
  for (const turn of turns) {
    if (Math.sign(turn) !== direction || Math.abs(turn) < PENTAGRAM_MIN_TURN_DEG) return null;
  }
  const cx = mean(found.map((p) => p.x));
  const cy = mean(found.map((p) => p.y));
  const structure = starStructure(points, found, found, cx, cy, direction, 144);
  if (!structure) return null;
  const phase = fivefoldPhase(cx, cy, found);
  const model = pentagramPoints(cx, cy, structure.outer, phase).slice(0, -1);
  const err = polygonResidual(points, model) / structure.outer;
  return { pentagram: true, cx, cy, outer: structure.outer, ratio: 0, phase, direction, err };
}

/**
 * A five-point star, drawn either way: as its outline (ten corners) or as a
 * one-stroke pentagram (five). Emitted as a regular star through the drawn
 * tips — centred, sized and turned like the drawing, and levelled when it is
 * within {@link STAR_AXIS_SNAP_DEG} of a tip pointing straight up or down.
 *
 * A drawn pentagram is emitted as a clean **pentagram**, not as the outline:
 * its inner pentagon is ink the user drew, and a snap that erased it would
 * change the drawing rather than tidy it (GoodNotes emits a clean version of
 * what was drawn). Both are kind `"star"`; contracts/api.md §2 lists the two
 * layouts.
 */
function starCandidate(drawn: readonly Pt[], pressure: number, diag: number): ShapeResult | null {
  const origin = drawn[0];
  // The farthest sample from any point of a star is a tip, so the seam lands
  // on a tip and RDP anchors it.
  const points = rotateToFarthest(drawn);
  const perimeter = pathLength(points);
  const base = Math.max(2.5, RECT_SIMPLIFY_FRACTION * diag);
  let best: StarFit | null = null;
  for (const step of STAR_SIMPLIFY_STEPS) {
    const tolerance = base * step;
    const loop = simplify(points, tolerance);
    while (loop.length > 1 && dist(loop[0], loop[loop.length - 1]) <= tolerance * 2) loop.pop();
    const found = mergeSplitCorners(points, starCorners(loop));
    const fit =
      found.length === STAR_OUTLINE_CORNERS
        ? fitStarOutline(points, found, perimeter)
        : found.length === STAR_PENTAGRAM_CORNERS
          ? fitPentagram(points, found)
          : null;
    if (fit && (!best || fit.err < best.err)) best = fit;
  }
  if (!best) return null;
  const confidence = clamp01(1 - best.err / STAR_MAX_ERR);

  // Beautify: level a star drawn a few degrees off, else keep its tilt on a
  // grid so that re-fitting our own output lands on the same angle.
  const level = best.phase / DEG + 90;
  const offLevel = level - Math.round(level / 36) * 36;
  const phase =
    Math.abs(offLevel) <= STAR_AXIS_SNAP_DEG
      ? (best.phase / DEG - offLevel) * DEG
      : Math.round(best.phase / DEG / STAR_PHASE_STEP_DEG) * STAR_PHASE_STEP_DEG * DEG;

  // Begin at the vertex nearest pen-down and turn the way the pen turned.
  const slots = best.pentagram ? 5 : 10;
  let start = 0;
  let nearest = Infinity;
  for (let k = 0; k < slots; k++) {
    const radius = best.pentagram || k % 2 === 0 ? best.outer : best.ratio * best.outer;
    const angle = phase + (k * 2 * Math.PI) / slots;
    const d = Math.hypot(
      best.cx + radius * Math.cos(angle) - origin.x,
      best.cy + radius * Math.sin(angle) - origin.y,
    );
    if (d < nearest) {
      nearest = d;
      start = k;
    }
  }
  const ring = best.pentagram
    ? pentagramPoints(best.cx, best.cy, best.outer, phase, start, best.direction)
    : starPoints(
        best.cx,
        best.cy,
        best.outer,
        (Math.round(best.ratio * 100) / 100) * best.outer,
        phase,
        start,
        best.direction,
      );
  return { kind: "star", pts: flatten(ring, pressure), confidence };
}

// --- Real-ink cleanup -------------------------------------------------------
//
// Pencil ink is not the ideal outline plus tremor that the synthetic tests
// model. Read from an iPad recording (2026-09-21), every stroke had two
// artefacts: a short hook where the pen landed and set off in a different
// direction, and an overshoot where a closed shape ran on past its start.
// Measured on synthetic copies, a 12 px hook alone refused a circle and
// dropped a rectangle to 0.59; an overshoot alone refused both — so the
// recogniser scored 0 for 20 on the device while its suite was green.

/** A hook is at most this long, in page px... */
const HOOK_MAX_PX = 30;
/** ...and at most this fraction of the path, so a small shape keeps its ends. */
const HOOK_MAX_FRACTION = 0.25;
/** A hook must turn at least this far from where the path then goes. A
 *  lead-in joining a line at 60° left the line scoring 0.45 under the old
 *  70°; a real corner is protected by the px budget, not by this angle. */
const HOOK_MIN_TURN_DEG = 45;

function indexAtLength(points: readonly Pt[], from: number, length: number, step: 1 | -1): number {
  let acc = 0;
  let i = from;
  while (i + step >= 0 && i + step < points.length && acc < length) {
    acc += dist(points[i], points[i + step]);
    i += step;
  }
  return i;
}

function angleBetweenDeg(ax: number, ay: number, bx: number, by: number): number {
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (la < 1e-9 || lb < 1e-9) return 0;
  const cos = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)));
  return Math.acos(cos) / DEG;
}

/**
 * Drop a pen-down or lift hook: a short run at one end that heads off at a
 * sharp angle to the path that follows. Every point within the hook budget is
 * tried as the hook's end, scored by the angle between the run up to it and
 * the same length of path beyond it; the sharpest turn wins if it is sharp
 * enough. (Comparing against a fixed window after a guessed end does not
 * work: the window still holds the rest of the hook, and a 90° tick read as
 * 37°.) The budget is walked by path length, so on sparse clean geometry —
 * a snapped rectangle's 160 px edge — nothing qualifies and nothing is cut.
 */
function trimHook(points: readonly Pt[], atStart: boolean): Pt[] {
  const total = pathLength(points);
  // The px cap is what protects a real edge: it must stay under the shortest
  // side a shape is drawn with (the tall narrow rect's 140 px, a 40 px
  // square's 40), while the fraction keeps a hook a minor part of the path.
  const maxLen = Math.min(HOOK_MAX_PX, HOOK_MAX_FRACTION * total);
  if (points.length < 4 || maxLen <= 0) return points.slice();
  const end = atStart ? 0 : points.length - 1;
  const step: 1 | -1 = atStart ? 1 : -1;
  let cut = -1;
  let sharpest = HOOK_MIN_TURN_DEG;
  let walked = 0;
  for (let i = end + step; i >= 0 && i < points.length; i += step) {
    walked += dist(points[i - step], points[i]);
    if (walked > maxLen) break;
    const j = indexAtLength(points, i, maxLen, step);
    if (j === i) break;
    const turn = angleBetweenDeg(
      points[i].x - points[end].x,
      points[i].y - points[end].y,
      points[j].x - points[i].x,
      points[j].y - points[i].y,
    );
    if (turn >= sharpest) {
      sharpest = turn;
      cut = i;
    }
  }
  if (cut < 0) return points.slice();
  return atStart ? points.slice(cut) : points.slice(0, cut + 1);
}

/** Fraction of the path, at each end, searched for the seam of a loop. */
const SEAM_SEARCH_FRACTION = 0.25;

/**
 * Cut an overshoot: when the end of a stroke lands back on its own beginning,
 * the beginning up to that point has been retraced and is dropped, so the loop
 * closes where the pen actually crossed its start instead of measuring the
 * overlap as an extra, doubled edge.
 */
function trimOvershoot(points: readonly Pt[], tolerance: number): Pt[] {
  const n = points.length;
  if (n < 6) return points.slice();
  const total = pathLength(points);
  const end = points[n - 1];
  let best = 0;
  let bestDist = dist(end, points[0]);
  // Bounded by path length, never by index: on sparse clean geometry one
  // segment can be most of the stroke (an arrow's shaft), and cutting it
  // would leave only the head — which then reads as a closed loop.
  let walked = 0;
  for (let j = 1; j < n; j++) {
    walked += dist(points[j - 1], points[j]);
    if (walked > SEAM_SEARCH_FRACTION * total) break;
    const d = dist(end, points[j]);
    if (d < bestDist) {
      bestDist = d;
      best = j;
    }
  }
  if (best === 0 || bestDist > tolerance) return points.slice();
  return points.slice(best);
}

// --- Dispatch -------------------------------------------------------------

function closedCandidates(
  points: readonly Pt[],
  pressure: number,
  diag: number,
  polygons: boolean,
): Array<ShapeResult | null> {
  const axes = principalAxes(points);
  const circle = circleCandidate(points, pressure, diag, axes);
  const ellipse = ellipseCandidate(points, pressure, axes);
  // Triangles always; other polygons only when asked for (see RecognizeOptions).
  const fitted = polygonCandidate(points, pressure, diag);
  const polygon = fitted && (polygons || fitted.kind === "triangle") ? fitted : null;
  // A loop the round fitters accept structurally has no run of sharp corners
  // (their gate caps the second-sharpest turn under a square's), so it is
  // not a rectangle whatever a coarse RDP quad of it scores: a lumpy circle
  // with a notch read as a rect at 0.79 otherwise. Regular polygons do pass
  // that gate, so the polygon fitter still competes when it is switched on.
  // A diamond is a square on its corner, so the rect fitter fits it just as
  // well; with polygon fitting on it must stay a diamond (the Shape tool's
  // preset round-trips through here), so the rect fitter stands aside.
  const rect =
    circle || ellipse || polygon?.kind === "diamond" ? null : rectCandidate(points, pressure, diag);
  // Stars are on by default: Joost asked for them (2026-09-22). No other
  // fitter produces a candidate for one, and the star fitter produces none
  // for anything in the adversarial suite or the real Pencil fixtures.
  return [circle, ellipse, rect, polygon, starCandidate(points, pressure, diag)];
}

/**
 * Returns null when the stroke is not confidently any known shape.
 *
 * A line drawn and then retraced a little way is an arrow before anything
 * else is tried. Otherwise closed strokes are tested against circle, ellipse,
 * rectangle, polygon and star; open strokes against arrow and line. The
 * best-scoring candidate wins, and only if it clears `minConfidence`.
 */
export function recognizeShape(pts: number[], opts?: RecognizeOptions): ShapeResult | null {
  const minConfidence = opts?.minConfidence ?? SNAP_MIN_CONFIDENCE;
  const best = explainShape(pts, opts).best;
  if (!best || best.confidence < minConfidence) return null;
  return { ...best, confidence: round2(best.confidence) };
}

/**
 * {@link recognizeShape} for ink drawn with the view zoomed `zoom` times past
 * fit-to-width. Every absolute length in here — the minimum span, the hook
 * and tail budgets, the closing tolerance — was tuned on real ink drawn at
 * fit-to-width, where a page px is about a screen px. Drawn at 5×, the same
 * hand movement is a fifth the size in page px, so a shape the pen plainly
 * drew was refused as a tap. The ink is scaled up to the size the hand
 * drew it at, recognised there, and the clean shape scaled back.
 */
export function recognizeAtZoom(
  pts: number[],
  zoom: number,
  opts?: RecognizeOptions,
): ShapeResult | null {
  if (!(zoom > 0) || !Number.isFinite(zoom) || zoom === 1) return recognizeShape(pts, opts);
  const result = recognizeShape(scaleXY(pts, zoom), opts);
  return result ? { ...result, pts: scaleXY(result.pts, 1 / zoom) } : null;
}

/** `[x, y, p, …]` with x and y multiplied by `k` about the origin; pressure kept. */
function scaleXY(pts: readonly number[], k: number): number[] {
  const out = pts.slice();
  for (let i = 0; i + 1 < out.length; i += POINT_STRIDE) {
    out[i] *= k;
    out[i + 1] *= k;
  }
  return out;
}

/** What the recogniser made of a stroke, for diagnostics. */
export interface ShapeExplanation {
  /** Bounding-box diagonal of the raw stroke, page px. */
  diag: number;
  /** Retained points before and after hook/overshoot cleanup. */
  n: number;
  cleanedN: number;
  /** Distance between the cleaned stroke's ends, and the closing tolerance. */
  gap: number;
  tolerance: number;
  closed: boolean;
  /** Every fitter that produced a candidate, best first, before any threshold. */
  candidates: Array<{ kind: ShapeKind; confidence: number }>;
  best: ShapeResult | null;
}

/**
 * The full verdict behind {@link recognizeShape}: every candidate and its
 * score, with no confidence threshold applied. This is what the on-device
 * diagnostics report, so a refused stroke says *why* it was refused.
 */
export function explainShape(pts: number[], opts?: RecognizeOptions): ShapeExplanation {
  const closeTolerance = opts?.closeTolerance ?? SNAP_CLOSE_TOLERANCE;
  const polygons = opts?.polygons === true;
  const none: ShapeExplanation = {
    diag: 0,
    n: 0,
    cleanedN: 0,
    gap: Infinity,
    tolerance: closeTolerance,
    closed: false,
    candidates: [],
    best: null,
  };

  const points = toPoints(pts);
  if (points.length < MIN_POINTS) return { ...none, n: points.length };
  const box = boundsOf(points);
  const diag = diagonalOf(box);
  if (diag < MIN_SPAN) return { ...none, n: points.length, diag };

  const pressure = meanPressure(pts);
  const tolerance = Math.max(closeTolerance, CLOSE_SPAN_FRACTION * diag);

  // Closed shapes are fitted to the cleaned stroke. Open ones see the raw
  // points as well: an arrow's last barb is a hook by any local measure, and
  // a short arrow's barbs can be shorter than a hook.
  // Hooks are trimmed only while the stroke has not closed: once the ends
  // meet (by themselves, or after the overshoot trim), both are real loop
  // points, and a "hook" found there is the first edge past the seam. That
  // cut a rectangle's corner and opened a 26 px gap (measured, 6 of 15
  // rebuilt streams) as soon as the hook budget passed the closing tolerance.
  const closedAt = (p: readonly Pt[]): boolean =>
    p.length >= MIN_POINTS && dist(p[0], p[p.length - 1]) <= tolerance;
  let cleaned = trimOvershoot(points, tolerance);
  if (!closedAt(cleaned)) cleaned = trimHook(cleaned, true);
  if (!closedAt(cleaned)) cleaned = trimHook(cleaned, false);
  const gap = cleaned.length >= 2 ? dist(cleaned[0], cleaned[cleaned.length - 1]) : Infinity;
  const closed = closedAt(cleaned);

  // Apple Notes' arrow is read first, on the raw points: the cleanup above
  // cuts a short retrace off as a lift hook. When the retrace is there, the
  // stroke is that arrow and nothing else — the line it was drawn along would
  // otherwise outscore it from the cleaned points.
  const retrace = retraceArrowCandidate(points, pressure);
  const candidates: Array<ShapeResult | null> = retrace
    ? [retrace]
    : closed
      ? closedCandidates(cleaned, pressure, diagonalOf(boundsOf(cleaned)), polygons)
      : [
          arrowCandidate(points, pressure, diag),
          lineCandidate(points, pressure),
          cleaned.length >= MIN_POINTS ? lineCandidate(cleaned, pressure) : null,
        ];

  const scored = candidates
    .filter((c): c is ShapeResult => c !== null)
    .sort((a, b) => b.confidence - a.confidence);
  return {
    diag,
    n: points.length,
    cleanedN: cleaned.length,
    gap,
    tolerance,
    closed,
    candidates: scored.map((c) => ({ kind: c.kind, confidence: round2(c.confidence) })),
    best: scored[0] ?? null,
  };
}

/**
 * The fitters' building blocks, for calibration scripts and the tests that
 * pin a discriminator's values across shape classes (CLAUDE.md: print those
 * before wiring a gate). Not part of the plugin's API.
 */
export const recognizerInternals = {
  toPoints,
  boundsOf,
  diagonalOf,
  pathLength,
  dist,
  turnDeg,
  simplify,
  corners,
  maxCornerDeg,
  fitLine,
  detourOf,
  fitCircle,
  principalAxes,
  orientedBox,
  boxResidual,
  straighten,
  sharpnessAt,
  isRectLike,
  rectFromQuad,
  rotateToFarthest,
  trimHook,
  trimOvershoot,
  signedTurnDeg,
  totalTurnDeg,
  starCorners,
  mergeSplitCorners,
  edgeDeviation,
  fivefoldPhase,
};
