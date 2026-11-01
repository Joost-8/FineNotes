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
  STAR_INNER_RATIO,
  arcPoints,
  arrowPoints,
  cloudPoints,
  ellipsePoints,
  heartPoints,
  pentagramPoints,
  sectorPoints,
  starPoints,
} from "./shape-geometry";
import { levelLine } from "./level-line";

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
  /**
   * The pen is resting where the stroke ends: a hold, not a lift. A held
   * stroke has no lift tail, so a short way back along a line is the arrow
   * gesture and nothing else ({@link RETRACE_HELD_MIN_PX}).
   */
  held?: boolean;
  /**
   * Also fit open arcs and sectors (a semicircle closed by its diameter
   * among them) on a stroke that is not {@link held}. A held stroke always
   * gets them. Off otherwise, because open curves are what handwriting is
   * made of (a C, a U, a bracket) and a D is a semicircle closed by its
   * diameter: the pen's Auto shape, which reads every stroke on lift, must
   * leave them as ink.
   */
  arcs?: boolean;
  /**
   * Curvature sensitivity as a percentage-like fraction. Lower values are
   * stricter and are useful when ordinary handwriting must remain freehand.
   */
  curvatureThreshold?: number;
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
/** A loop's closing gap never exceeds this share of the stroke's diagonal. */
const CLOSE_MAX_SPAN_FRACTION = 0.25;

/** Line: max perpendicular deviation as a fraction of end-to-end span. A
 *  quick Pencil line bows ~2–3% of its span; a 45° arc measures ~6.6%. */
const LINE_MAX_ERR = 0.25;
/** Line: path length may exceed the straight span by at most this factor. */
const LINE_MAX_DETOUR = 1.35;
/** Detour is measured on a lightly simplified copy, so per-sample digitizer
 *  noise does not inflate the path length of a perfectly straight stroke. */
const DETOUR_SIMPLIFY_FRACTION = 0.01;

function curvatureThresholdOf(value: number | undefined): number {
  return Math.min(1, Math.max(0.1, value ?? 0.5));
}

function curvatureToleranceMultiplier(threshold: number): number {
  return 0.5 + curvatureThresholdOf(threshold);
}

interface LineGuards {
  archBound: number;
  inflectionBound: number;
}

function lineGuards(threshold: number): LineGuards {
  return {
    archBound: 0.035 + 0.05 * threshold,
    inflectionBound: 0.045 + 0.06 * threshold,
  };
}

/**
 * Brackets and integrals are open strokes with meaningful curvature. Their
 * points can still have a deceptively good least-squares line fit, so reject
 * one-sided arches and opposing half-stroke deviations before scoring a line.
 */
function hasMeaningfulLineCurvature(
  points: readonly Pt[],
  chordA: Pt,
  chordB: Pt,
  span: number,
  threshold: number,
): boolean {
  if (points.length < 5 || span < 1e-6) return false;
  const guardA = points[Math.floor(points.length * 0.15)] ?? chordA;
  const guardB = points[Math.ceil(points.length * 0.85)] ?? chordB;
  const guardSpan = Math.max(1e-6, dist(guardA, guardB));
  const ux = (guardB.x - guardA.x) / guardSpan;
  const uy = (guardB.y - guardA.y) / guardSpan;
  const start = Math.floor(points.length * 0.1);
  const end = Math.max(start + 3, Math.ceil(points.length * 0.9));
  const body = points.slice(start, end);
  const signed = body.map((p) => (p.x - guardA.x) * uy - (p.y - guardA.y) * ux);
  const nonZero = signed.filter((d) => Math.abs(d) > guardSpan * 0.003);
  if (nonZero.length < 3) return false;
  const positive = nonZero.filter((d) => d > 0).length;
  const negative = nonZero.length - positive;
  const dominant = Math.max(positive, negative) / nonZero.length;
  const sagitta = Math.max(...nonZero.map((d) => Math.abs(d))) / guardSpan;
  const guards = lineGuards(threshold);
  if (dominant > 0.75 && sagitta > guards.archBound) return true;

  const middle = Math.floor(signed.length / 2);
  const first = signed.slice(0, middle);
  const second = signed.slice(middle);
  const firstMax = Math.max(...first);
  const firstMin = Math.min(...first);
  const secondMax = Math.max(...second);
  const secondMin = Math.min(...second);
  const firstDominant = Math.max(
    first.filter((d) => d > 0).length,
    first.filter((d) => d < 0).length,
  );
  const secondDominant = Math.max(
    second.filter((d) => d > 0).length,
    second.filter((d) => d < 0).length,
  );
  const firstSign = firstMax >= Math.abs(firstMin) ? 1 : -1;
  const secondSign = secondMax >= Math.abs(secondMin) ? 1 : -1;
  const opposing = firstSign !== secondSign;
  const peakRatio =
    (Math.max(Math.abs(firstMax), Math.abs(firstMin)) +
      Math.max(Math.abs(secondMax), Math.abs(secondMin))) /
    guardSpan;
  if (
    opposing &&
    firstDominant / first.length > 0.6 &&
    secondDominant / second.length > 0.6 &&
    peakRatio > guards.inflectionBound
  ) {
    return true;
  }
  return false;
}

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
/**
 * ...unless the pen is held at the end of the retrace ({@link RecognizeOptions.held}).
 * A lift tail only exists once the pen lifts, so a hold cannot contain one,
 * and the floor above refused every short arrow Joost drew: traced out of
 * his recording (2026-10-01), arrows on 52-136 px lines came back 18-44 px,
 * 25-44 % of the line, within 3-13° of it. The ones under 40 px stayed
 * freehand, became a line, or a triangle. This floor only stands above the
 * pen settling as it stops.
 */
const RETRACE_HELD_MIN_PX = 12;
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
/**
 * Star: RMS distance to the fitted regular star over its tip radius, at
 * which confidence reaches 0. Synthetic stars measured 0.010–0.048, but the
 * first real ones (Joost's recording, 2026-10-01) 0.060–0.088: a hand's
 * pentagram is not regular. At 0.2 they scored 0.56–0.70 and only one of
 * five cleared the 0.65 snap; at 0.35, 0.75–0.83. What keeps other shapes
 * out is the structure (five sharp same-way turns stepping 144° round the
 * centre, straight edges), not this.
 */
const STAR_MAX_ERR = 0.35;
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

function lineCandidate(
  points: readonly Pt[],
  pressure: number,
  curvatureThreshold = 0.5,
): ShapeResult | null {
  const fit = fitLine(points);
  if (!fit) return null;
  const threshold = curvatureThresholdOf(curvatureThreshold);
  if (
    hasMeaningfulLineCurvature(points, points[0], points[points.length - 1], fit.span, threshold)
  ) {
    return null;
  }
  const detour = detourOf(points, fit.span);
  const maxDetour = 1.15 + 0.4 * threshold;
  const maxErr = 0.04 + 0.42 * threshold;
  if (detour > maxDetour) return null;
  const detourScore = clamp01(1 - (detour - 1) / (maxDetour - 1));
  const shapeScore = clamp01(1 - fit.err / maxErr);
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
  curvatureThreshold = 0.5,
): ShapeResult | null {
  // An oval is the ellipse fitter's; circularising it would move the ink.
  if (axes && axes.ratio < ELLIPSE_MAX_RATIO) return null;
  const fit = fitCircle(points);
  if (!fit) return null;
  const sweep = Math.abs(fit.sweep);
  if (sweep < CIRCLE_MIN_SWEEP || sweep > CIRCLE_MAX_SWEEP) return null;
  if (maxCornerDeg(points, diag) > CIRCLE_MAX_CORNER_DEG) return null;
  const confidence = clamp01(
    1 - fit.err / (CIRCLE_MAX_ERR * curvatureToleranceMultiplier(curvatureThreshold)),
  );
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
  curvatureThreshold = 0.5,
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
  const confidence = clamp01(
    1 -
      Math.sqrt(sqSum / points.length) /
        (ELLIPSE_MAX_ERR * curvatureToleranceMultiplier(curvatureThreshold)),
  );

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
  curvatureThreshold = 0.5,
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
  const confidence = clamp01(
    1 - chosen.err / (POLY_MAX_ERR * curvatureToleranceMultiplier(curvatureThreshold)),
  );
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

function rectCandidate(
  drawn: readonly Pt[],
  pressure: number,
  diag: number,
  curvatureThreshold = 0.5,
): ShapeResult | null {
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
  const confidence =
    clamp01(1 - fit.err / (RECT_MAX_ERR * curvatureToleranceMultiplier(curvatureThreshold))) *
    (0.75 + 0.25 * cornerScore);

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
function retraceArrowCandidate(
  points: readonly Pt[],
  pressure: number,
  held: boolean,
): ShapeResult | null {
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
  const floor = held ? RETRACE_HELD_MIN_PX : RETRACE_MIN_PX;
  if (along < Math.max(floor, RETRACE_MIN_FRACTION * shaft.span)) return null;
  if (along > RETRACE_MAX_FRACTION * shaft.span) return null;
  // Which way the retrace runs is its own line's direction, not the way from
  // the turn to its end: the pen steps a px or two aside as it turns, and on
  // a short retrace (Joost's are 18-44 px) that step alone tilted the second
  // reading by 5°, refusing arrows drawn 13° off the line.
  const backFit = fitLine(back);
  if (!backFit || backFit.span === 0) return null;
  const bx = backFit.b.x - backFit.a.x;
  const by = backFit.b.y - backFit.a.y;
  if (angleBetweenDeg(bx, by, -ux, -uy) > RETRACE_MAX_ANGLE_DEG) return null;
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
 * The corners of `found` that turn as sharply as a pentagram's tips, with the
 * gentle bends between them dropped. A real pentagram's line bent once,
 * 23° (Joost's recording), and RDP kept the bend at every tolerance: six
 * corners, so it was never tried as a pentagram. An outline star's tips pass
 * this too, but five tips step 72° round the centre, not 144°, and
 * {@link fitPentagram} refuses them.
 */
function sharpCorners(found: readonly Pt[]): Pt[] {
  const n = found.length;
  return found.filter(
    (c, i) =>
      Math.abs(signedTurnDeg(found[(i - 1 + n) % n], c, found[(i + 1) % n])) >=
      PENTAGRAM_MIN_TURN_DEG,
  );
}

/** {@link fitPentagram} on the sharp corners, when exactly five of them are (see {@link sharpCorners}). */
function fitBentPentagram(points: readonly Pt[], found: readonly Pt[]): StarFit | null {
  const sharp = sharpCorners(found);
  return sharp.length === STAR_PENTAGRAM_CORNERS ? fitPentagram(points, sharp) : null;
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
 * A drawn pentagram becomes the classic star **outline**, its notches where
 * the pentagram's lines cross: the star a hand draws in one stroke, the way
 * it is meant (Joost, 2026-10-01; it used to be a clean pentagram). The
 * outline is kind `"star"` in contracts/api.md §2's layout.
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
          : found.length < STAR_OUTLINE_CORNERS
            ? fitBentPentagram(points, found)
            : null;
    if (fit && (!best || fit.err < best.err)) best = fit;
  }
  if (!best) return null;
  const confidence = clamp01(1 - best.err / STAR_MAX_ERR);
  // A pentagram becomes the outline it stands for: the same tips, notches
  // where its lines cross.
  // Rounded as a fitted ratio is, so the outline re-reads as itself.
  const ratio = Math.round((best.pentagram ? STAR_INNER_RATIO : best.ratio) * 100) / 100;

  // Beautify: level a star drawn a few degrees off, else keep its tilt on a
  // grid so that re-fitting our own output lands on the same angle.
  const level = best.phase / DEG + 90;
  const offLevel = level - Math.round(level / 36) * 36;
  const phase =
    Math.abs(offLevel) <= STAR_AXIS_SNAP_DEG
      ? (best.phase / DEG - offLevel) * DEG
      : Math.round(best.phase / DEG / STAR_PHASE_STEP_DEG) * STAR_PHASE_STEP_DEG * DEG;

  // Begin at the vertex nearest pen-down and turn the way the pen turned.
  let start = 0;
  let nearest = Infinity;
  for (let k = 0; k < STAR_OUTLINE_CORNERS; k++) {
    const radius = k % 2 === 0 ? best.outer : ratio * best.outer;
    const angle = phase + (k * 2 * Math.PI) / STAR_OUTLINE_CORNERS;
    const d = Math.hypot(
      best.cx + radius * Math.cos(angle) - origin.x,
      best.cy + radius * Math.sin(angle) - origin.y,
    );
    if (d < nearest) {
      nearest = d;
      start = k;
    }
  }
  const ring = starPoints(
    best.cx,
    best.cy,
    best.outer,
    ratio * best.outer,
    phase,
    start,
    best.direction,
  );
  return { kind: "star", pts: flatten(ring, pressure), confidence };
}

// --- Cloud ------------------------------------------------------------------

// Cloud (2026-10-01). Measured on Joost's three real clouds (traced out of his
// recording, tests/ink/fixtures/real-pencil-stars-clouds-ipad.json) against
// every real closed stroke in the fixtures and the synthetic adversaries:
// how deep the ink dips inside its own convex hull between bumps. Clouds dip
// 6–7 times by 3 % of the diagonal or more, 5–7 of them by 5 %; real circles,
// rects and triangles 0–2 times; a lumpy quad twice by 5 %; five-point stars,
// pentagrams and a five-petal flower exactly 5 times. Stars with more points
// dip as often, so what tells them apart is the top of each bump: round on a
// cloud, a sharp tip on a star. Measured across 0.8 % of the perimeter
// (short enough that a round bump reads its curvature, not its whole turn),
// the median top turns 38–64° on the real clouds and 92–154° on every star:
// real pentagrams, outlines, 4- to 8-point stars and heptagrams.

/** Cloud: a sample this far inside the hull (of the diagonal) is in a dent. */
const CLOUD_DENT_FLOOR = 0.012;
/** Cloud: a dent counts when its deepest sample is this far in. */
const CLOUD_DENT_MIN = 0.03;
/** Cloud: at least this many dents (five is a star, a flower, a lumpy quad's most). */
const CLOUD_MIN_DENTS = 6;
/** Cloud: and at least this many of them this deep. */
const CLOUD_DEEP_DENT = 0.05;
const CLOUD_MIN_DEEP_DENTS = 4;
/**
 * Cloud: the median dent no deeper than this. A backstop: real stars dip
 * 17–23 %, clouds 7 %; a six-point star (11 %) is kept out by its tips.
 */
const CLOUD_MAX_MEDIAN_DENT = 0.13;
/** Cloud: the median bump top may turn at most this much across {@link CLOUD_TOP_WINDOW} of the perimeter. */
const CLOUD_MAX_TOP_TURN_DEG = 80;
const CLOUD_TOP_WINDOW = 0.008;
/** Cloud: how sure a loop that passes every gate is; the gates are the test. */
const CLOUD_CONFIDENCE = 0.85;

/** The middle value (the upper one of an even count). */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** The convex hull, counter-clockwise (Andrew's monotone chain). */
function convexHull(points: readonly Pt[]): Pt[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Pt, a: Pt, b: Pt): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (list: readonly Pt[]): Pt[] => {
    const out: Pt[] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return half(sorted).concat(half([...sorted].reverse()));
}

/**
 * The dents of a closed loop: going round it once, each run of samples
 * farther than {@link CLOUD_DENT_FLOOR} inside the convex hull, as the depth
 * of its deepest sample over the diagonal, with the index of the sample
 * closest to the hull just before it: the top of the bump (or the star's
 * tip) the dent comes after.
 */
function hullDents(points: readonly Pt[], diag: number): Array<{ depth: number; top: number }> {
  return hullDentRuns(points, diag).map(({ depth, top }) => ({ depth, top }));
}

/**
 * {@link hullDents}, with the index of each dent's deepest sample as well
 * (`at`): where a heart's cusp is.
 */
function hullDentRuns(
  points: readonly Pt[],
  diag: number,
): Array<{ depth: number; top: number; at: number }> {
  const hull = convexHull(points);
  if (hull.length < 3 || !(diag > 0)) return [];
  const depth = points.map((p) => {
    let d = Infinity;
    for (let i = 0; i < hull.length; i++) {
      d = Math.min(d, distToSegment(p, hull[i], hull[(i + 1) % hull.length]));
    }
    return d / diag;
  });
  // Start on the hull, so no dent straddles the seam.
  const n = depth.length;
  let first = 0;
  for (let i = 1; i < n; i++) if (depth[i] < depth[first]) first = i;
  const dents: Array<{ depth: number; top: number; at: number }> = [];
  let deepest = 0;
  let at = first;
  let top = first;
  for (let k = 1; k <= n; k++) {
    const i = (first + k) % n;
    const d = depth[i];
    if (d > CLOUD_DENT_FLOOR) {
      if (d > deepest) {
        deepest = d;
        at = i;
      }
    } else {
      if (deepest > 0) {
        dents.push({ depth: deepest, top, at });
        deepest = 0;
        top = i;
      }
      if (d < depth[top]) top = i;
    }
  }
  if (deepest > 0) dents.push({ depth: deepest, top, at });
  return dents;
}

/**
 * A cloud: a closed loop of round bumps that dips in between them, at least
 * six times. Emitted as a clean cloud filling the box it was drawn in, with
 * as many bumps as it was drawn with (7 to 12, `cloudPoints`), starting
 * near the pen-down point and going round the way the pen did.
 */
function cloudCandidate(
  points: readonly Pt[],
  pressure: number,
  diag: number,
  runs: ReadonlyArray<{ depth: number; top: number }> = hullDents(points, diag),
): ShapeResult | null {
  const dents = runs.filter((d) => d.depth >= CLOUD_DENT_MIN);
  if (dents.length < CLOUD_MIN_DENTS) return null;
  if (dents.filter((d) => d.depth >= CLOUD_DEEP_DENT).length < CLOUD_MIN_DEEP_DENTS) return null;
  if (median(dents.map((d) => d.depth)) > CLOUD_MAX_MEDIAN_DENT) return null;
  // Round bumps, not a star's tips: the top before each dent.
  const window = CLOUD_TOP_WINDOW * pathLength(points);
  const tops = dents.map((d) => sharpnessAt(points, d.top, window));
  if (median(tops) > CLOUD_MAX_TOP_TURN_DEG) return null;

  const box = boundsOf(points);
  const w = box.maxX - box.minX;
  const h = box.maxY - box.minY;
  if (!(w > 0 && h > 0)) return null;
  const direction = signedArea(points) >= 0 ? 1 : -1;
  const ring = cloudPoints(box.minX, box.minY, w, h, dents.length, points[0], direction);
  return { kind: "cloud", pts: flatten(ring, pressure), confidence: CLOUD_CONFIDENCE };
}

// --- Heart ----------------------------------------------------------------
//
// A heart is a closed loop with exactly one dent, the cusp between its lobes,
// and a sharp tip on the far side of its middle from that cusp. No other
// family has that pair: round loops and polygons have no dent, a star dips
// five times and a cloud six or more, a pac-man's mouth is a dent with a
// round back. The frame is read off the two points (cusp to tip is the
// axis), the clean heart is laid into the loop's box in that frame, and the
// confidence is how far the ink lies from it, both ways round (ink to
// outline, and outline to ink, so a missing lobe costs as much as a lumpy
// one).

/** Heart: the cusp's dent is at least this deep, of the diagonal... */
const HEART_DENT_MIN = 0.03;
/** ...and at most this deep (deeper is a crescent or a pac-man's mouth). */
const HEART_DENT_MAX = 0.3;
/**
 * Heart: every other dent at most this share of the cusp's, and this deep
 * (of the diagonal). The classic heart's sides curve in a little above the
 * tip (2–3 % of the diagonal), and a hand's lobes are lumpy; a star's five
 * dents and a cloud's bumps are all alike.
 */
const HEART_OTHER_DENT_SHARE = 0.5;
const HEART_OTHER_DENT_MAX = 0.06;
/** Heart: sharpness is read across this share of the perimeter either side. */
const HEART_TURN_WINDOW = 0.04;
/** Heart: the tip turns at least this much there... */
const HEART_MIN_TIP_DEG = 55;
/** ...and the cusp at least this much (lobes that overlap far meet at ~55°)... */
const HEART_MIN_CUSP_DEG = 40;
/**
 * ...or this much when the dent is at least {@link HEART_DEEP_DENT} of the
 * diagonal: a deep dent is a cusp however round its bottom. A real heart
 * whose pen came down in the cusp and curled measured 27° there, with a
 * dent of 0.19 (2026-10-31).
 */
const HEART_MIN_DEEP_CUSP_DEG = 20;
const HEART_DEEP_DENT = 0.12;
/**
 * Heart: anywhere else round the outline (more than two windows from the
 * cusp and the tip) the ink turns at most this much: the lobes are round,
 * where a dart's wings or a fish's fins are corners...
 */
const HEART_MAX_LOBE_TURN_DEG = 75;
/**
 * ...or this much on a tall heart (height over width at least
 * {@link HEART_TALL_ASPECT}): narrow lobes are tight curves. Joost's real
 * hearts (2026-10-31, aspect 1.7-2.2) turned 75-90° there; a small rounded
 * square with a curl inside, the nearest real stroke that is no heart, 94°
 * at aspect 1.24.
 */
const HEART_MAX_TALL_LOBE_TURN_DEG = 92;
const HEART_TALL_ASPECT = 1.5;
/** Heart: the cusp lies within this share of the width of the middle. */
const HEART_MAX_CUSP_OFFSET = 0.2;
/** Heart: height over width, in the heart's own frame. */
const HEART_MIN_ASPECT = 0.55;
const HEART_MAX_ASPECT = 2.4;
/**
 * Heart: RMS distance (ink to outline and back, the worse) over the
 * diagonal at zero confidence. Loose: hands draw many hearts (fat round
 * lobes, a shallow or deep cusp), and the gates above are the test.
 */
const HEART_MAX_ERR = 0.2;
/** Heart: within this of upright (or of a quarter turn), made exactly so. */
const HEART_AXIS_SNAP_DEG = 10;
/** Heart: grid a kept tilt is rounded to. */
const HEART_TILT_STEP_DEG = 0.5;

/** The area centroid of a closed loop, or null when it encloses nothing. */
function centroidOf(points: readonly Pt[]): Pt | null {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const cross = points[j].x * points[i].y - points[i].x * points[j].y;
    a += cross;
    cx += (points[j].x + points[i].x) * cross;
    cy += (points[j].y + points[i].y) * cross;
  }
  if (Math.abs(a) < 1e-6) return null;
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

/** RMS distance from `from`'s points to the polyline `to`. */
function polylineResidual(from: readonly Pt[], to: readonly Pt[]): number {
  if (from.length === 0 || to.length < 2) return Infinity;
  let sqSum = 0;
  for (const p of from) {
    let nearest = Infinity;
    for (let i = 1; i < to.length; i++) {
      const d = distToSegment(p, to[i - 1], to[i]);
      if (d < nearest) nearest = d;
    }
    sqSum += nearest * nearest;
  }
  return Math.sqrt(sqSum / from.length);
}

/** The box of `points` in a frame turned `phi` from the page: centre (page px), width, height. */
function boxInFrame(
  points: readonly Pt[],
  phi: number,
): { cx: number; cy: number; w: number; h: number } {
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  let minA = Infinity;
  let maxA = -Infinity;
  let minB = Infinity;
  let maxB = -Infinity;
  for (const p of points) {
    const a = p.x * cos + p.y * sin;
    const b = -p.x * sin + p.y * cos;
    if (a < minA) minA = a;
    if (a > maxA) maxA = a;
    if (b < minB) minB = b;
    if (b > maxB) maxB = b;
  }
  const ca = (minA + maxA) / 2;
  const cb = (minB + maxB) / 2;
  return { cx: ca * cos - cb * sin, cy: ca * sin + cb * cos, w: maxA - minA, h: maxB - minB };
}

interface HeartFrame {
  cusp: number;
  tip: number;
  /** Sharpness at the cusp, at the tip, and the sharpest turn anywhere else. */
  cuspDeg: number;
  tipDeg: number;
  lobeDeg: number;
  /** How deep the cusp's dent is, of the diagonal. */
  dentDepth: number;
  /** Turn from upright (cusp up, tip down), radians. */
  phi: number;
}

/** Where a loop's cusp and tip are and which way it stands, or null when it is no heart. */
function heartFrame(
  points: readonly Pt[],
  diag: number,
  runs: ReadonlyArray<{ depth: number; at: number }> = hullDentRuns(points, diag),
): HeartFrame | null {
  const dents = [...runs].sort((a, b) => b.depth - a.depth);
  if (dents.length === 0) return null;
  const dent = dents[0];
  if (dent.depth < HEART_DENT_MIN || dent.depth > HEART_DENT_MAX) return null;
  const next = dents.length > 1 ? dents[1].depth : 0;
  if (next > HEART_OTHER_DENT_SHARE * dent.depth || next > HEART_OTHER_DENT_MAX) return null;
  const cusp = points[dent.at];
  const middle = centroidOf(points);
  if (!middle) return null;
  const toward = { x: middle.x - cusp.x, y: middle.y - cusp.y };
  const len = Math.hypot(toward.x, toward.y);
  if (!(len > 1e-6)) return null;
  let tip = 0;
  let far = -Infinity;
  points.forEach((p, i) => {
    const along = ((p.x - cusp.x) * toward.x + (p.y - cusp.y) * toward.y) / len;
    if (along > far) {
      far = along;
      tip = i;
    }
  });
  const ux = points[tip].x - cusp.x;
  const uy = points[tip].y - cusp.y;
  if (!(Math.hypot(ux, uy) > 1e-6)) return null;
  // Sharpness at the cusp and the tip, and the sharpest turn elsewhere.
  const n = points.length;
  const along: number[] = [0];
  for (let i = 1; i < n; i++) along.push(along[i - 1] + dist(points[i - 1], points[i]));
  const total = along[n - 1] + dist(points[n - 1], points[0]);
  const window = HEART_TURN_WINDOW * total;
  const apart = (i: number, j: number): number => {
    const d = Math.abs(along[i] - along[j]);
    return Math.min(d, total - d);
  };
  let lobeDeg = 0;
  for (let i = 0; i < n; i++) {
    if (apart(i, dent.at) <= 2 * window || apart(i, tip) <= 2 * window) continue;
    lobeDeg = Math.max(lobeDeg, sharpnessAt(points, i, window));
  }
  return {
    cusp: dent.at,
    tip,
    cuspDeg: sharpnessAt(points, dent.at, window),
    tipDeg: sharpnessAt(points, tip, window),
    lobeDeg,
    dentDepth: dent.depth,
    phi: Math.atan2(-ux, uy),
  };
}

/** The heart's frame when the loop has a heart's structure (every gate but the fit), else null. */
function isHeartShaped(
  points: readonly Pt[],
  diag: number,
  runs?: ReadonlyArray<{ depth: number; at: number }>,
): HeartFrame | null {
  const frame = heartFrame(points, diag, runs);
  if (!frame) return null;
  const minCusp = frame.dentDepth >= HEART_DEEP_DENT ? HEART_MIN_DEEP_CUSP_DEG : HEART_MIN_CUSP_DEG;
  if (frame.tipDeg < HEART_MIN_TIP_DEG || frame.cuspDeg < minCusp) return null;
  if (frame.lobeDeg > HEART_MAX_TALL_LOBE_TURN_DEG) return null;
  return frame;
}

function heartCandidate(
  points: readonly Pt[],
  pressure: number,
  diag: number,
  frame: HeartFrame | null,
): ShapeResult | null {
  if (!frame) return null;

  const box = boxInFrame(points, frame.phi);
  if (!(box.w > 0 && box.h > 0)) return null;
  const aspect = box.h / box.w;
  if (aspect < HEART_MIN_ASPECT || aspect > HEART_MAX_ASPECT) return null;
  if (aspect < HEART_TALL_ASPECT && frame.lobeDeg > HEART_MAX_LOBE_TURN_DEG) return null;
  // The cusp in the middle of the width: a heart is symmetric about its axis.
  const cusp = points[frame.cusp];
  const across = (cusp.x - box.cx) * Math.cos(frame.phi) + (cusp.y - box.cy) * Math.sin(frame.phi);
  if (Math.abs(across) > HEART_MAX_CUSP_OFFSET * box.w) return null;

  // Score against the heart in the drawn frame, never the levelled one.
  const fitted = heartPoints(box.cx, box.cy, box.w, box.h, frame.phi);
  const err =
    Math.max(polylineResidual(points, fitted), polylineResidual(fitted, [...points, points[0]])) /
    diag;
  const confidence = clamp01(1 - err / HEART_MAX_ERR);

  // Beautify: upright (or on its side) when nearly so, else on a 0.5° grid,
  // so that reading the output again lands on the same frame.
  const quarter = Math.PI / 2;
  const off = frame.phi - Math.round(frame.phi / quarter) * quarter;
  const tilt = HEART_TILT_STEP_DEG * DEG;
  const phi =
    Math.abs(off) <= HEART_AXIS_SNAP_DEG * DEG
      ? frame.phi - off
      : Math.round(frame.phi / tilt) * tilt;
  const shown = phi === frame.phi ? box : boxInFrame(points, phi);
  const clockwise = heartPoints(shown.cx, shown.cy, shown.w, shown.h, phi, points[0], 1);
  const direction = Math.sign(signedArea(clockwise)) === Math.sign(signedArea(points)) ? 1 : -1;
  const ring =
    direction === 1
      ? clockwise
      : heartPoints(shown.cx, shown.cy, shown.w, shown.h, phi, points[0], -1);
  return { kind: "heart", pts: flatten(ring, pressure), confidence };
}

// --- Arcs and sectors -----------------------------------------------------
//
// Part of a circle: an open arc, or a sector (a pie slice: the arc closed by
// two radii to its centre), whose half turn is a semicircle closed by its
// diameter. Open curved strokes are what handwriting is made of — a C, a U,
// a bracket — and a "D" is a semicircle closed by its diameter, so these
// fit only on a hold (or when asked for, `RecognizeOptions.arcs`), never on
// a lift with the pen's Auto shape on.

/** Arc: the stroke's box is at least this big, page px (a written "c" is smaller). */
const ARC_MIN_DIAG = 40;
/** Arc: turns at least this far about its centre (a flatter bow is a line's)... */
const ARC_MIN_SWEEP_DEG = 40;
/** ...and at most this far (more is a circle that did not quite close). */
const ARC_MAX_SWEEP_DEG = 300;
/** Arc: RMS radial deviation over the radius at zero confidence. */
const ARC_MAX_ERR = 0.3;
/** Arc: a sharper turn than this across {@link ARC_TURN_WINDOW} of the path is a corner (a U, a V). */
const ARC_MAX_TURN_DEG = 45;
const ARC_TURN_WINDOW = 0.06;
/** Arc: the angle about the centre may run back on itself at most this much in all. */
const ARC_MAX_BACKTRACK = 0.12;
/** Arc and sector: within this of a quarter-turn multiple, the turn is made exactly that. */
const ARC_SNAP_DEG = 15;
/** Sector: within this of a multiple of 15°, the angle is made exactly that. */
const SECTOR_FINE_SNAP_DEG = 4;
/** Arc and sector: an end within this of an axis (after the turn is snapped) is put on it. */
const ARC_AXIS_SNAP_DEG = 8;

/** Sector: corners are read across this share of the perimeter either side... */
const SECTOR_CORNER_WINDOW = 0.04;
/** ...and turn at least this much there. */
const SECTOR_CORNER_MIN_DEG = 50;
/** Sector: a straight side's RMS distance from its chord, over its length. */
const SECTOR_STRAIGHT_MAX_DEV = 0.035;
/** Sector: the arc stands off its chord all on one side: the mean offset is this much of the RMS. */
const SECTOR_ARC_ONE_SIDED = 0.75;
/**
 * Sector: and at least this share of what an arc of its turn would (a
 * straight side bowed by the hand is not an arc because the corner opposite
 * happens to be about equally far from all of it).
 */
const SECTOR_MIN_BOW_SHARE = 0.6;
/** Sector: the arc turns at most this across the corner window anywhere inside it. */
const SECTOR_ARC_MAX_TURN_DEG = 70;
/** Sector: the arc's RMS radial deviation about the centre, over the radius. */
const SECTOR_ARC_MAX_ERR = 0.12;
/** Sector: each radius within this share of the arc's radius. */
const SECTOR_RADIUS_TOL = 0.3;
/** Sector: the curved side's own circle within this share of the radius, and centred this near. */
const SECTOR_OWN_RADIUS_TOL = 0.3;
const SECTOR_OWN_CENTRE_TOL = 0.3;
/**
 * Sector: turns at least this far and at most this. Narrower, the arc is so
 * short its own circle is barely determined and the slice reads as the
 * triangle it nearly is.
 */
const SECTOR_MIN_SWEEP_DEG = 50;
const SECTOR_MAX_SWEEP_DEG = 320;
/** Sector: RMS distance from the outline over the radius at zero confidence. */
const SECTOR_MAX_ERR = 0.2;

interface ArcFit {
  cx: number;
  cy: number;
  r: number;
  /** RMS radial deviation over `r`. */
  err: number;
}

/**
 * A geometric least-squares circle: the Kåsa fit, then Gauss–Newton steps on
 * the true distances. Kåsa alone is biased on a short arc (it pulls the
 * radius in), which a full loop never shows but a quarter circle does.
 */
function fitArcCircle(points: readonly Pt[]): ArcFit | null {
  const start = fitCircle(points);
  if (!start) return null;
  let { cx, cy, r } = start;
  for (let iter = 0; iter < 12; iter++) {
    // Normal equations of the 3-parameter problem, solved by Cramer's rule.
    let a11 = 0;
    let a12 = 0;
    let a13 = 0;
    let a22 = 0;
    let a23 = 0;
    let a33 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    for (const p of points) {
      const dx = p.x - cx;
      const dy = p.y - cy;
      const d = Math.hypot(dx, dy);
      if (d < 1e-9) continue;
      const jx = -dx / d;
      const jy = -dy / d;
      const jr = -1;
      const res = d - r;
      a11 += jx * jx;
      a12 += jx * jy;
      a13 += jx * jr;
      a22 += jy * jy;
      a23 += jy * jr;
      a33 += jr * jr;
      b1 -= jx * res;
      b2 -= jy * res;
      b3 -= jr * res;
    }
    const det =
      a11 * (a22 * a33 - a23 * a23) - a12 * (a12 * a33 - a23 * a13) + a13 * (a12 * a23 - a22 * a13);
    if (Math.abs(det) < 1e-12) break;
    const d1 =
      b1 * (a22 * a33 - a23 * a23) - a12 * (b2 * a33 - a23 * b3) + a13 * (b2 * a23 - a22 * b3);
    const d2 =
      a11 * (b2 * a33 - a23 * b3) - b1 * (a12 * a33 - a23 * a13) + a13 * (a12 * b3 - b2 * a13);
    const d3 =
      a11 * (a22 * b3 - b2 * a23) - a12 * (a12 * b3 - b2 * a13) + b1 * (a12 * a23 - a22 * a13);
    cx += d1 / det;
    cy += d2 / det;
    r += d3 / det;
    if (!Number.isFinite(cx + cy + r) || !(r > 0)) return null;
    if (Math.abs(d1 / det) + Math.abs(d2 / det) + Math.abs(d3 / det) < 1e-6 * r) break;
  }
  let sqSum = 0;
  for (const p of points) {
    const d = Math.hypot(p.x - cx, p.y - cy) - r;
    sqSum += d * d;
  }
  return { cx, cy, r, err: Math.sqrt(sqSum / points.length) / r };
}

/** The signed turn of an open path about a point, and how much of it ran backwards. */
function openSweep(points: readonly Pt[], cx: number, cy: number): { sweep: number; back: number } {
  let sweep = 0;
  let total = 0;
  let prev = Math.atan2(points[0].y - cy, points[0].x - cx);
  for (let i = 1; i < points.length; i++) {
    const angle = Math.atan2(points[i].y - cy, points[i].x - cx);
    let delta = angle - prev;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    sweep += delta;
    total += Math.abs(delta);
    prev = angle;
  }
  return { sweep, back: total > 0 ? (total - Math.abs(sweep)) / 2 / total : 0 };
}

/** {@link sharpnessAt} on an open path; NaN where either reach would run off an end. */
function openSharpnessAt(points: readonly Pt[], index: number, window: number): number {
  const reach = (step: 1 | -1): Pt | null => {
    let walked = 0;
    for (let i = index; i + step >= 0 && i + step < points.length; i += step) {
      walked += dist(points[i], points[i + step]);
      if (walked >= window) return points[i + step];
    }
    return null;
  };
  const a = reach(-1);
  const b = reach(1);
  return a && b ? turnDeg(a, points[index], b) : NaN;
}

/**
 * A turn of `sweep` radians made a whole number of quarter turns when it is
 * within {@link ARC_SNAP_DEG} of one, else (`fine`) of a multiple of 15°
 * within {@link SECTOR_FINE_SNAP_DEG}; unchanged otherwise. The sign is kept.
 */
function snapSweep(sweep: number, fine: boolean): number {
  const deg = Math.abs(sweep) / DEG;
  const quarter = Math.round(deg / 90) * 90;
  if (quarter > 0 && Math.abs(deg - quarter) <= ARC_SNAP_DEG)
    return Math.sign(sweep) * quarter * DEG;
  if (fine) {
    const step = Math.round(deg / 15) * 15;
    if (step > 0 && Math.abs(deg - step) <= SECTOR_FINE_SNAP_DEG)
      return Math.sign(sweep) * step * DEG;
  }
  return sweep;
}

/**
 * The start angle of an arc turned `sweep` from `start`, kept about its
 * middle when the turn was snapped from `drawnSweep`, then turned so that
 * whichever end is within {@link ARC_AXIS_SNAP_DEG} of an axis lies on it.
 */
function placeArc(start: number, drawnSweep: number, sweep: number): number {
  let from = start + (drawnSweep - sweep) / 2;
  const quarter = Math.PI / 2;
  const offStart = from - Math.round(from / quarter) * quarter;
  const end = from + sweep;
  const offEnd = end - Math.round(end / quarter) * quarter;
  const off = Math.abs(offStart) <= Math.abs(offEnd) ? offStart : offEnd;
  if (Math.abs(off) <= ARC_AXIS_SNAP_DEG * DEG) from -= off;
  return from;
}

function arcCandidate(
  points: readonly Pt[],
  pressure: number,
  diag: number,
  curvatureThreshold = 0.5,
): ShapeResult | null {
  if (diag < ARC_MIN_DIAG || points.length < 5) return null;
  const fit = fitArcCircle(points);
  if (!fit || fit.r > 4 * diag) return null;
  const { sweep, back } = openSweep(points, fit.cx, fit.cy);
  const deg = Math.abs(sweep) / DEG;
  if (deg < ARC_MIN_SWEEP_DEG || deg > ARC_MAX_SWEEP_DEG) return null;
  if (back > ARC_MAX_BACKTRACK) return null;
  // No corner along the way: a U or a V is not a bow.
  const window = ARC_TURN_WINDOW * pathLength(points);
  for (let i = 0; i < points.length; i++) {
    const turn = openSharpnessAt(points, i, window);
    if (turn > ARC_MAX_TURN_DEG) return null;
  }
  const confidence = clamp01(
    1 - fit.err / (ARC_MAX_ERR * curvatureToleranceMultiplier(curvatureThreshold)),
  );
  const start = Math.atan2(points[0].y - fit.cy, points[0].x - fit.cx);
  const snapped = snapSweep(sweep, false);
  const from = snapped === sweep ? start : placeArc(start, sweep, snapped);
  const ring = arcPoints(fit.cx, fit.cy, fit.r, from, snapped);
  return { kind: "arc", pts: flatten(ring, pressure), confidence };
}

/** Indices of a closed loop's corners, in loop order: sharp turns, one per corner. */
function loopCorners(points: readonly Pt[], window: number, minDeg: number): number[] {
  const n = points.length;
  const at: number[] = [0];
  for (let i = 1; i < n; i++) at.push(at[i - 1] + dist(points[i - 1], points[i]));
  const total = at[n - 1] + dist(points[n - 1], points[0]);
  const sharp = points.map((_, i) => sharpnessAt(points, i, window));
  const order = sharp
    .map((s, i) => ({ s, i }))
    .filter((c) => c.s >= minDeg)
    .sort((a, b) => b.s - a.s);
  const kept: number[] = [];
  for (const { i } of order) {
    const apart = kept.every((k) => {
      const d = Math.abs(at[i] - at[k]);
      return Math.min(d, total - d) >= 2 * window;
    });
    if (apart) kept.push(i);
  }
  return kept.sort((a, b) => a - b);
}

/**
 * How far a run of samples between two corners stands off its chord, over
 * the chord: the RMS distance (`dev`) and the mean signed one (`mean`). A
 * straight side has a small `dev`; an arc a larger one, all on one side, so
 * `|mean|` is most of it (2/3 of the arc's height against `dev`'s 0.73).
 */
function sideOf(side: readonly Pt[]): { dev: number; mean: number } {
  const a = side[0];
  const b = side[side.length - 1];
  const chord = dist(a, b);
  if (!(chord > 1e-6)) return { dev: Infinity, mean: 0 };
  let sum = 0;
  let sqSum = 0;
  for (const p of side) {
    const d = ((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / chord;
    sum += d;
    sqSum += d * d;
  }
  return { dev: Math.sqrt(sqSum / side.length) / chord, mean: sum / side.length / chord };
}

/** RMS radial deviation of `points` about (`cx`, `cy`) over `r`. */
function radialErr(points: readonly Pt[], cx: number, cy: number, r: number): number {
  let sqSum = 0;
  for (const p of points) {
    const d = Math.hypot(p.x - cx, p.y - cy) - r;
    sqSum += d * d;
  }
  return Math.sqrt(sqSum / points.length) / r;
}

/** Samples a loop is densified to before its corners are looked for. */
const SECTOR_LOOP_SAMPLES = 400;

/** A closed loop with no gap between neighbouring samples (the closing one included) longer than `step`. */
function densifyLoop(points: readonly Pt[], step: number): Pt[] {
  if (!(step > 0)) return points.slice();
  const out: Pt[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    out.push(a);
    const pieces = Math.floor(dist(a, b) / step);
    for (let k = 1; k < pieces; k++) {
      out.push({ x: a.x + ((b.x - a.x) * k) / pieces, y: a.y + ((b.y - a.y) * k) / pieces });
    }
  }
  return out;
}

/**
 * A sector: a closed loop of an arc and two straight radii meeting at its
 * centre (three corners), or an arc and the straight diameter that closes
 * it (two corners, a half turn).
 */
function sectorCandidate(
  points: readonly Pt[],
  pressure: number,
  diag: number,
  curvatureThreshold = 0.5,
): ShapeResult | null {
  if (diag < ARC_MIN_DIAG) return null;
  // Densified first: clean geometry (a sector read again) has 150 px radii in
  // one segment each, and a corner window must not jump whole sides.
  const loop = rotateToFarthest(densifyLoop(points, pathLength(points) / SECTOR_LOOP_SAMPLES));
  const window = SECTOR_CORNER_WINDOW * pathLength(loop);
  const found = loopCorners(loop, window, SECTOR_CORNER_MIN_DEG);
  if (found.length < 2 || found.length > 4) return null;
  // The corners as found; then, weakest first, without one of them (a kink
  // the pen made in the arc, where a stroke began mid-arc); and two corners
  // whose straight side bends, split where it bends most (a wide slice's
  // centre turns only 180° less its angle: 30° at 150°).
  const sharpness = found.map((i) => sharpnessAt(loop, i, window));
  const tries: number[][] = [found];
  if (found.length > 2) {
    const weakest = found.map((_, i) => i).sort((a, b) => sharpness[a] - sharpness[b]);
    for (const drop of weakest) tries.push(found.filter((_, i) => i !== drop));
  }
  for (const corners of [...tries]) {
    if (corners.length !== 2) continue;
    for (const k of [0, 1]) {
      const side = loopSlice(loop, corners[(k + 1) % 2], corners[k]);
      const a = side[0];
      const b = side[side.length - 1];
      const chord = dist(a, b);
      if (!(chord > 0)) continue;
      let far = -1;
      let farDist = 0;
      side.forEach((p, i) => {
        const d = Math.abs((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / chord;
        if (d > farDist) {
          farDist = d;
          far = i;
        }
      });
      if (far > 0 && far < side.length - 1) {
        const at = (corners[(k + 1) % 2] + far) % loop.length;
        tries.push([...corners, at].sort((x, y) => x - y));
      }
    }
  }
  for (const corners of tries) {
    if (corners.length !== 2 && corners.length !== 3) continue;
    const result = sectorFromCorners(points, loop, corners, pressure, diag, curvatureThreshold);
    if (result) return result;
  }
  return null;
}

/** {@link sectorCandidate} for one choice of corners (indices into `loop`, in order). */
function sectorFromCorners(
  points: readonly Pt[],
  loop: readonly Pt[],
  found: readonly number[],
  pressure: number,
  diag: number,
  curvatureThreshold: number,
): ShapeResult | null {
  const sides = found.map((c, k) => loopSlice(loop, c, found[(k + 1) % found.length]));
  const reads = sides.map(sideOf);
  const isStraight = (s: { dev: number }): boolean => s.dev <= SECTOR_STRAIGHT_MAX_DEV;
  const curved = reads
    .map((s, k) => ({ s, k }))
    .filter(({ s }) => !isStraight(s) && Math.abs(s.mean) >= SECTOR_ARC_ONE_SIDED * s.dev);
  const straight = reads.filter(isStraight);
  if (curved.length !== 1 || straight.length !== found.length - 1) return null;
  const k = curved[0].k;
  // The arc turns evenly: no corner inside it (two sides of a triangle,
  // taken together, stand off their chord just as one-sidedly).
  const arcWindow = SECTOR_CORNER_WINDOW * pathLength(loop);
  const inside = sides[k];
  for (let i = 0; i < inside.length; i++) {
    const turn = openSharpnessAt(inside, i, arcWindow);
    if (turn > SECTOR_ARC_MAX_TURN_DEG) return null;
  }
  const arc = sides[k];
  const m = found.length;

  let centre: Pt | null;
  if (m === 2) {
    // The diameter: the middle of the straight side, between where it meets the arc.
    const line = fitAxis(trimEdge(sides[(k + 1) % 2]));
    if (!line) return null;
    const project = (p: Pt): Pt => {
      const t = (p.x - line.cx) * line.ux + (p.y - line.cy) * line.uy;
      return { x: line.cx + t * line.ux, y: line.cy + t * line.uy };
    };
    const a = project(loop[found[k]]);
    const b = project(loop[found[(k + 1) % 2]]);
    centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  } else {
    // The corner opposite the arc, where the two radii's lines cross.
    const corner = loop[found[(k + 2) % 3]];
    const l1 = fitAxis(trimEdge(sides[(k + 1) % 3]));
    const l2 = fitAxis(trimEdge(sides[(k + 2) % 3]));
    const crossing = l1 && l2 ? intersect(l1, l2) : null;
    centre = crossing && dist(crossing, corner) <= 0.1 * diag ? crossing : corner;
  }
  const r = median(arc.map((p) => dist(p, centre)));
  if (!(r > 0)) return null;
  if (radialErr(arc, centre.x, centre.y, r) > SECTOR_ARC_MAX_ERR) return null;
  if (m === 3) {
    for (const end of [loop[found[k]], loop[found[(k + 1) % 3]]]) {
      if (Math.abs(dist(end, centre) - r) > SECTOR_RADIUS_TOL * r) return null;
    }
  }
  const { sweep, back } = openSweep(arc, centre.x, centre.y);
  const deg = Math.abs(sweep) / DEG;
  if (deg < SECTOR_MIN_SWEEP_DEG || deg > SECTOR_MAX_SWEEP_DEG || back > ARC_MAX_BACKTRACK) {
    return null;
  }
  // An arc of this turn stands 0.73 × tan(turn / 4) / 2 of its chord off it, RMS.
  const expected = (0.73 * Math.tan(Math.abs(sweep) / 4)) / 2;
  if (reads[k].dev < SECTOR_MIN_BOW_SHARE * expected) return null;
  // And the curved side, fitted on its own, is a circle about that centre:
  // a triangle's bowed side is flatter, and bulges where the hand rounded a
  // corner rather than evenly (a real one: its own circle 1.4-1.8 times the
  // radius, centred 0.4-0.8 radii off the corner; real slices 1.0 and 0.05).
  const own = fitArcCircle(arc);
  if (!own) return null;
  if (Math.abs(own.r / r - 1) > SECTOR_OWN_RADIUS_TOL) return null;
  if (dist({ x: own.cx, y: own.cy }, centre) > SECTOR_OWN_CENTRE_TOL * r) return null;
  const start = Math.atan2(arc[0].y - centre.y, arc[0].x - centre.x);

  // Score against the sector as drawn, never the snapped one.
  const fitted = sectorPoints(centre.x, centre.y, r, start, sweep);
  const err = polylineResidual(points, fitted) / r;
  const confidence = clamp01(
    1 - err / (SECTOR_MAX_ERR * curvatureToleranceMultiplier(curvatureThreshold)),
  );

  const snapped = snapSweep(sweep, true);
  const from = placeArc(start, sweep, snapped);
  const ring = sectorPoints(centre.x, centre.y, r, from, snapped).slice(0, -1);
  // Begin at the vertex nearest pen-down; the winding is already the drawn one.
  let first = 0;
  let nearest = Infinity;
  ring.forEach((p, i) => {
    const d = dist(p, points[0]);
    if (d < nearest) {
      nearest = d;
      first = i;
    }
  });
  const ordered = ring.slice(first).concat(ring.slice(0, first));
  ordered.push({ ...ordered[0] });
  return { kind: "sector", pts: flatten(ordered, pressure), confidence };
}

// --- Segments and angles ----------------------------------------------------
//
// A segment is part of a disc cut off by a straight chord: a dome, or a
// semicircle when the cut runs through the middle. Joost's real domes
// (2026-10-31) stood a third as tall as wide, flatter than a semicircle, so
// the sector fitter (whose straight side is the diameter) refused them, and
// two of them were taken for triangles. An angle is two straight legs from
// one corner, as a right angle is drawn in geometry.

/** Segment: on a lift the stroke's box is at least this big, page px (a written "D" is smaller). */
const SEGMENT_LIFT_MIN_DIAG = 100;
/** Segment: the chord's ends lie within this share of the radius off the arc's circle. */
const SEGMENT_END_TOL = 0.3;
/** Segment: the arc turns at least this far about its centre, and at most this far... */
const SEGMENT_MIN_SWEEP_DEG = 40;
const SEGMENT_MAX_SWEEP_DEG = 320;
/**
 * ...and on a lift at most this far: a dome, flatter than a half. A "D" is
 * a half turn closed by its stem, so a semicircle waits for a hold (where
 * the sector fitter takes it). Joost's real domes turned 128-146°.
 */
const SEGMENT_LIFT_MAX_SWEEP_DEG = 160;
/** Segment: of three corners, the weakest may be a kink in the arc if it turns less than this. */
const SEGMENT_KINK_MAX_DEG = 90;
/** Segment: a chord within this of level or upright is made exactly so. */
const SEGMENT_AXIS_SNAP_DEG = 8;

/**
 * A segment: a closed loop of an arc and the straight chord that closes it
 * (two corners). The chord need not pass through the centre; when it nearly
 * does, the turn snaps to a half and the outline is a semicircle.
 */
function segmentCandidate(
  points: readonly Pt[],
  pressure: number,
  diag: number,
  curvatureThreshold: number,
  arcs: boolean,
): ShapeResult | null {
  if (diag < (arcs ? ARC_MIN_DIAG : SEGMENT_LIFT_MIN_DIAG)) return null;
  const loop = rotateToFarthest(densifyLoop(points, pathLength(points) / SECTOR_LOOP_SAMPLES));
  const window = SECTOR_CORNER_WINDOW * pathLength(loop);
  const found = loopCorners(loop, window, SECTOR_CORNER_MIN_DEG);
  // Two corners, or three where the pen kinked once along the arc: a soft
  // turn, where a real triangle with a bowed side has three sharp ones.
  let corners = found;
  if (found.length === 3) {
    const sharpness = found.map((i) => sharpnessAt(loop, i, window));
    const weakest = sharpness.indexOf(Math.min(...sharpness));
    if (sharpness[weakest] >= SEGMENT_KINK_MAX_DEG) return null;
    corners = found.filter((_, k) => k !== weakest);
  }
  if (corners.length !== 2) return null;
  const maxSweep = arcs ? SEGMENT_MAX_SWEEP_DEG : SEGMENT_LIFT_MAX_SWEEP_DEG;
  return segmentFromCorners(points, loop, corners, pressure, curvatureThreshold, maxSweep);
}

/** {@link segmentCandidate} for one pair of corners (indices into `loop`, in order). */
function segmentFromCorners(
  points: readonly Pt[],
  loop: readonly Pt[],
  corners: readonly number[],
  pressure: number,
  curvatureThreshold: number,
  maxSweepDeg: number,
): ShapeResult | null {
  const sides = [loopSlice(loop, corners[0], corners[1]), loopSlice(loop, corners[1], corners[0])];
  const reads = sides.map(sideOf);
  const straightAt = reads.findIndex((s) => s.dev <= SECTOR_STRAIGHT_MAX_DEV);
  if (straightAt < 0) return null;
  const k = 1 - straightAt;
  const bow = reads[k];
  if (bow.dev <= SECTOR_STRAIGHT_MAX_DEV || Math.abs(bow.mean) < SECTOR_ARC_ONE_SIDED * bow.dev) {
    return null;
  }
  const arc = sides[k];
  // The arc turns evenly: no corner inside it.
  const arcWindow = SECTOR_CORNER_WINDOW * pathLength(loop);
  for (let i = 0; i < arc.length; i++) {
    if (openSharpnessAt(arc, i, arcWindow) > SECTOR_ARC_MAX_TURN_DEG) return null;
  }
  const own = fitArcCircle(arc);
  if (!own || own.err > SECTOR_ARC_MAX_ERR) return null;
  // The chord, on the straight side's own line, between where it meets the arc.
  const line = fitAxis(trimEdge(sides[straightAt]));
  if (!line) return null;
  const project = (p: Pt): Pt => {
    const t = (p.x - line.cx) * line.ux + (p.y - line.cy) * line.uy;
    return { x: line.cx + t * line.ux, y: line.cy + t * line.uy };
  };
  const a = project(arc[0]);
  const b = project(arc[arc.length - 1]);
  for (const end of [a, b]) {
    if (Math.abs(dist(end, { x: own.cx, y: own.cy }) - own.r) > SEGMENT_END_TOL * own.r) {
      return null;
    }
  }
  const { sweep, back } = openSweep(arc, own.cx, own.cy);
  const deg = Math.abs(sweep) / DEG;
  if (deg < SEGMENT_MIN_SWEEP_DEG || deg > maxSweepDeg || back > ARC_MAX_BACKTRACK) {
    return null;
  }
  // The arc stands off its chord as an arc of that turn does (a flat bow is
  // a straight side that wobbled).
  const expected = (0.73 * Math.tan(Math.abs(sweep) / 4)) / 2;
  if (bow.dev < SECTOR_MIN_BOW_SHARE * expected) return null;

  // Score against the segment as drawn (chord and turn), never the snapped one.
  const drawn = segmentOutline(a, b, sweep, arc[Math.floor(arc.length / 2)]);
  if (!drawn) return null;
  const err = polylineResidual(points, drawn.ring) / drawn.r;
  const confidence = clamp01(
    1 - err / (SECTOR_MAX_ERR * curvatureToleranceMultiplier(curvatureThreshold)),
  );

  // Beautify: a chord near level or upright is made so about its middle, and
  // the turn snaps as an arc's does (a half within 15° is a semicircle).
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const heading = Math.atan2(b.y - a.y, b.x - a.x);
  const quarter = Math.PI / 2;
  const off = heading - Math.round(heading / quarter) * quarter;
  const turn = Math.abs(off) <= SEGMENT_AXIS_SNAP_DEG * DEG ? -off : 0;
  const spin = (p: Pt): Pt => {
    const dx = p.x - mid.x;
    const dy = p.y - mid.y;
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    return { x: mid.x + dx * c - dy * s, y: mid.y + dx * s + dy * c };
  };
  const shown = segmentOutline(
    spin(a),
    spin(b),
    snapSweep(sweep, true),
    spin(drawn.ring[Math.floor((drawn.ring.length - 2) / 2)]),
  );
  if (!shown) return null;
  // Begin at the chord's end nearest pen-down.
  const ring = shown.ring.slice(0, -1);
  const first = dist(ring[0], points[0]) <= dist(ring[ring.length - 1], points[0]) ? 0 : -1;
  const ordered = first === 0 ? ring : [ring[ring.length - 1], ...ring.slice(0, -1)];
  ordered.push({ ...ordered[0] });
  return { kind: "segment", pts: flatten(ordered, pressure), confidence };
}

/**
 * The closed outline of the segment on chord `a`-`b` whose arc turns
 * `sweep` (signed; the sign is ignored, `bulge` says which side the arc is
 * on): `a`, round the arc to `b`, back to `a`. Null for a degenerate chord.
 */
function segmentOutline(a: Pt, b: Pt, sweep: number, bulge: Pt): { ring: Pt[]; r: number } | null {
  const half = dist(a, b) / 2;
  const turn = Math.abs(sweep);
  if (!(half > 0) || !(turn > 0) || turn >= 2 * Math.PI) return null;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  // The unit normal of the chord toward the arc.
  let nx = -(b.y - a.y) / (2 * half);
  let ny = (b.x - a.x) / (2 * half);
  if ((bulge.x - mid.x) * nx + (bulge.y - mid.y) * ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  const r = half / Math.sin(turn / 2);
  // The centre lies away from the arc while the turn is under a half, past the chord after.
  const back = r * Math.cos(turn / 2);
  const centre = { x: mid.x - nx * back, y: mid.y - ny * back };
  const start = Math.atan2(a.y - centre.y, a.x - centre.x);
  // Whichever way round passes the bulge's side.
  for (const sign of [1, -1]) {
    const t = start + (sign * turn) / 2;
    const top = { x: centre.x + r * Math.cos(t), y: centre.y + r * Math.sin(t) };
    if ((top.x - mid.x) * nx + (top.y - mid.y) * ny > 0) {
      const ring = arcPoints(centre.x, centre.y, r, start, sign * turn);
      ring[ring.length - 1] = { ...b };
      ring.push({ ...a });
      return { ring, r };
    }
  }
  return null;
}

/** Angle: on a lift, the stroke's box is at least this big, page px (a tick is smaller)... */
const ANGLE_LIFT_MIN_DIAG = 70;
/** ...and on a hold at least this big. */
const ANGLE_HELD_MIN_DIAG = 50;
/** Angle: each leg is at least this long, page px. */
const ANGLE_MIN_LEG_PX = 25;
/** Angle: the shorter leg is at least this share of the longer (a hooked line is no angle). */
const ANGLE_MIN_LEG_RATIO = 0.2;
/** Angle: RMS distance of each leg's ink from its line, over the leg, at zero confidence. */
const ANGLE_MAX_ERR = 0.12;
/**
 * Angle: within this of a right angle it is taken, and made one. Other
 * openings are a V, a written "v", or a checkmark (75° in the suite).
 */
const ANGLE_RIGHT_SNAP_DEG = 12;
/**
 * Angle: on a lift, one leg lies within this of level or upright, as a
 * right angle is drawn in geometry (Joost's: 88° and -2°); a checkmark's
 * legs slant. On a hold any turn is taken.
 */
const ANGLE_LIFT_AXIS_DEG = 12;
/** Angle: the corner's crossing lies within this share of the diagonal of where the pen turned. */
const ANGLE_CORNER_TOL = 0.15;
/** Angle: a leg within this of level or upright is made so, turning the whole angle about its corner. */
const ANGLE_AXIS_SNAP_DEG = 8;

/**
 * A right angle: an open stroke of two straight legs meeting square (within
 * {@link ANGLE_RIGHT_SNAP_DEG}) at one corner, made exactly square. On a
 * lift one leg must also lie near level or upright.
 */
function angleCandidate(
  points: readonly Pt[],
  pressure: number,
  diag: number,
  held: boolean,
): ShapeResult | null {
  // Three points is enough: its own output, read again, is just that.
  if (points.length < 3 || diag < (held ? ANGLE_HELD_MIN_DIAG : ANGLE_LIFT_MIN_DIAG)) return null;
  const first = points[0];
  const last = points[points.length - 1];
  // The corner: the sample farthest from the line between the ends.
  let turnAt = -1;
  let far = 0;
  points.forEach((p, i) => {
    const d = distToSegment(p, first, last);
    if (d > far) {
      far = d;
      turnAt = i;
    }
  });
  if (turnAt < 1 || turnAt > points.length - 2) return null;
  const legs = [points.slice(0, turnAt + 1), points.slice(turnAt)];
  const lines = legs.map((leg) => fitAxis(trimEdge(leg)));
  const [l1, l2] = lines;
  if (!l1 || !l2) return null;
  const corner = intersect(l1, l2);
  if (!corner || dist(corner, points[turnAt]) > ANGLE_CORNER_TOL * diag) return null;
  const project = (p: Pt, l: Axis): Pt => {
    const t = (p.x - l.cx) * l.ux + (p.y - l.cy) * l.uy;
    return { x: l.cx + t * l.ux, y: l.cy + t * l.uy };
  };
  const a = project(first, l1);
  const b = project(last, l2);
  const lenA = dist(a, corner);
  const lenB = dist(b, corner);
  if (Math.min(lenA, lenB) < ANGLE_MIN_LEG_PX) return null;
  if (Math.min(lenA, lenB) < ANGLE_MIN_LEG_RATIO * Math.max(lenA, lenB)) return null;
  const opening = turnDeg(a, corner, b);
  if (Math.abs(opening - 90) > ANGLE_RIGHT_SNAP_DEG) return null;
  const quarter = Math.PI / 2;
  const offOf = (t: number): number => t - Math.round(t / quarter) * quarter;
  const toward = (p: Pt): number => Math.atan2(p.y - corner.y, p.x - corner.x);
  if (
    !held &&
    Math.min(Math.abs(offOf(toward(a))), Math.abs(offOf(toward(b)))) > ANGLE_LIFT_AXIS_DEG * DEG
  ) {
    return null;
  }
  // Each leg's ink lies along a straight line from the corner.
  const legErr = (leg: readonly Pt[], end: Pt, len: number): number =>
    polylineResidual(leg, [corner, end]) / len;
  const err = Math.max(legErr(legs[0], a, lenA), legErr(legs[1], b, lenB));
  const confidence = clamp01(1 - err / ANGLE_MAX_ERR);

  // Beautify: made square by turning the shorter leg about the corner, then
  // the whole turned so a leg near level or upright lies so.
  let angA = toward(a);
  let angB = toward(b);
  let between = angB - angA;
  while (between > Math.PI) between -= 2 * Math.PI;
  while (between < -Math.PI) between += 2 * Math.PI;
  const right = (Math.sign(between) || 1) * quarter;
  if (lenA <= lenB) angA = angB - right;
  else angB = angA + right;
  const longer = lenA >= lenB ? angA : angB;
  const shorter = lenA >= lenB ? angB : angA;
  const off =
    Math.abs(offOf(longer)) <= ANGLE_AXIS_SNAP_DEG * DEG
      ? offOf(longer)
      : Math.abs(offOf(shorter)) <= ANGLE_AXIS_SNAP_DEG * DEG
        ? offOf(shorter)
        : 0;
  angA -= off;
  angB -= off;
  const end = (t: number, len: number): Pt => ({
    x: corner.x + len * Math.cos(t),
    y: corner.y + len * Math.sin(t),
  });
  return {
    kind: "angle",
    pts: flatten([end(angA, lenA), { ...corner }, end(angB, lenB)], pressure),
    confidence,
  };
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
  curvatureThreshold: number,
  arcs: boolean,
): Array<ShapeResult | null> {
  const axes = principalAxes(points);
  // A loop with a heart's cusp and tip is no circle, however round its
  // lobes: fat lobes meeting at a shallow cusp passed the round fitters'
  // corner gate (second-sharpest turn) as a circle at 0.72.
  // The hull's dents are measured once, for the heart and the cloud.
  const dents = hullDentRuns(points, diag);
  const heart = isHeartShaped(points, diag, dents);
  const heartShaped = heart !== null;
  const circle = heartShaped
    ? null
    : circleCandidate(points, pressure, diag, axes, curvatureThreshold);
  const ellipse = heartShaped ? null : ellipseCandidate(points, pressure, axes, curvatureThreshold);
  const sector = arcs ? sectorCandidate(points, pressure, diag, curvatureThreshold) : null;
  // A dome: an arc closed by a straight chord. Its two corners and the
  // arc's chord also straighten into a triangle, which took two real domes
  // (2026-10-31); a loop that is a convincing dome is not a polygon.
  // A dome that fits too loosely to snap stands aside instead: a real
  // triangle with one bowed side (a sail) passes its structure on a hold.
  const dome = heartShaped
    ? null
    : segmentCandidate(points, pressure, diag, curvatureThreshold, arcs);
  const segment = dome && dome.confidence >= SNAP_MIN_CONFIDENCE ? dome : null;
  // Triangles always; other polygons only when asked for (see RecognizeOptions).
  const fitted = segment ? null : polygonCandidate(points, pressure, diag, curvatureThreshold);
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
    circle || ellipse || polygon?.kind === "diamond"
      ? null
      : rectCandidate(points, pressure, diag, curvatureThreshold);
  // Stars are on by default: Joost asked for them (2026-09-22). No other
  // fitter produces a candidate for one, and the star fitter produces none
  // for anything in the adversarial suite or the real Pencil fixtures.
  // A cloud's bumps keep the round fitters out, and its dents a rect's
  // corners; it competes with whatever is left.
  return [
    circle,
    ellipse,
    rect,
    polygon,
    starCandidate(points, pressure, diag),
    cloudCandidate(points, pressure, diag, dents),
    // One dent and a sharp tip: no other fitter takes a heart (a dent keeps
    // the round fitters and the rect out, and it is one dent, not a star's five).
    heartCandidate(points, pressure, diag, heart),
    // A semicircle is a sector and a segment both: the sector names it.
    sector ? null : segment,
    // A slice of pie also straightens into a triangle; the sector's arc fits
    // it better (a 60° slice: sector 0.96, triangle 0.84).
    sector,
  ];
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
  const arcs = opts?.arcs === true || opts?.held === true;
  const curvatureThreshold = curvatureThresholdOf(opts?.curvatureThreshold);
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
  // The gap that closes a loop is also bounded by the stroke's own size: a
  // 28 px glyph (a handwritten "1" with its tick) sat inside the fixed 24 px
  // and read as a closed loop, then as a triangle.
  const tolerance = Math.min(
    Math.max(closeTolerance, CLOSE_SPAN_FRACTION * diag),
    CLOSE_MAX_SPAN_FRACTION * diag,
  );

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
  const retrace = retraceArrowCandidate(points, pressure, opts?.held === true);
  const candidates: Array<ShapeResult | null> = retrace
    ? [retrace]
    : closed
      ? closedCandidates(
          cleaned,
          pressure,
          diagonalOf(boundsOf(cleaned)),
          polygons,
          curvatureThreshold,
          arcs,
        )
      : [
          arrowCandidate(points, pressure, diag),
          lineCandidate(points, pressure, curvatureThreshold),
          cleaned.length >= MIN_POINTS
            ? lineCandidate(cleaned, pressure, curvatureThreshold)
            : null,
          arcs && cleaned.length >= MIN_POINTS
            ? arcCandidate(cleaned, pressure, diagonalOf(boundsOf(cleaned)), curvatureThreshold)
            : null,
          cleaned.length >= MIN_POINTS
            ? angleCandidate(cleaned, pressure, diagonalOf(boundsOf(cleaned)), opts?.held === true)
            : null,
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
    best: scored[0] ? levelled(scored[0]) : null,
  };
}

/**
 * A line or an arrow within a few degrees of level or upright, made exactly
 * so about its middle, where it moves least off the ink ({@link levelLine}).
 * After scoring: the confidence is the drawn stroke's, never the levelled
 * line's (CLAUDE.md "Never score confidence against beautified output").
 */
function levelled(result: ShapeResult): ShapeResult {
  if (result.kind !== "line" && result.kind !== "arrow") return result;
  const pts = levelLine(result.pts, "middle");
  return pts === result.pts ? result : { ...result, pts };
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
  hullDents,
  hullDentRuns,
  heartFrame,
  fitArcCircle,
  openSweep,
  edgeDeviation,
  fivefoldPhase,
};
