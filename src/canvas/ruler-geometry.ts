/**
 * The ruler's geometry: where a straight ruler, a set square or a
 * protractor lies on screen, which of its edges a pen is near, where the pen
 * lands once it follows that edge, and how a drag or a two-finger turn moves
 * it. Pure: no DOM, no Obsidian.
 *
 * The ruler lives in screen space, in CSS px from the surface's top left: it
 * stays put while the page scrolls under it, as a ruler laid on a desk does.
 * Its size on screen is fixed; only its markings follow the zoom, so a
 * centimetre on it is a centimetre of the page (`PAGE_PX_PER_MM`). Because
 * the page is only ever scaled and moved, never turned, a line or an arc on
 * screen is a line or an arc on the page: following an edge here stores a
 * perfectly straight stroke.
 *
 * Angles are degrees, clockwise (the screen's y runs down), normalised to
 * (-180, 180].
 */

/** A point, in screen px or in the ruler's own frame. */
export interface RulerPt {
  x: number;
  y: number;
}

export type RulerKind = "straight" | "square" | "protractor";

export const RULER_KINDS: readonly RulerKind[] = ["straight", "square", "protractor"];

/** What each kind is called, for its tile's `aria-label`. */
export const RULER_KIND_LABELS: Record<RulerKind, string> = {
  straight: "Ruler",
  square: "Set square",
  protractor: "Protractor",
};

/** The angle snapping offered: off, or a step in degrees. */
export const RULER_SNAP_STEPS: readonly number[] = [0, 5, 15, 45];

export const DEFAULT_RULER_SNAP = 15;

/** Where the ruler lies: its frame's origin on screen and its turn. */
export interface RulerPose {
  x: number;
  y: number;
  /** Degrees, clockwise, in (-180, 180]. */
  angle: number;
}

/**
 * A ruler's shape. `length` is the straight ruler's length, the set
 * square's leg, the protractor's radius, all in screen px.
 */
export interface RulerSpec {
  kind: RulerKind;
  length: number;
}

/** The straight ruler's width across, screen px. */
export const RULER_WIDTH = 72;
/** The set square's legs, screen px. */
export const SQUARE_LEG = 240;
/** The protractor's radius, screen px. */
export const PROTRACTOR_RADIUS = 160;
/** The straight ruler is never shorter than this, nor longer than the other, screen px. */
export const RULER_MIN_LENGTH = 280;
export const RULER_MAX_LENGTH = 1000;

/**
 * How far from an edge a pen may come down and still follow it, screen px,
 * on either side of the edge. A screen length, so it is the same reach at
 * any zoom.
 */
export const RULER_REACH_PX = 24;

/** How far outside its body a finger still takes hold of the ruler, screen px. */
export const RULER_GRAB_SLOP_PX = 6;

/** An edge a pen can follow, in the space of the pose that made it. */
export type RulerEdge =
  | { type: "line"; a: RulerPt; b: RulerPt }
  | {
      type: "arc";
      /** The centre. */
      c: RulerPt;
      r: number;
      /** Radians, clockwise from +x, where the arc begins. */
      start: number;
      /** Radians, clockwise, how far it runs from `start`. */
      sweep: number;
    };

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/** An angle in degrees, in (-180, 180]; 0 for nonsense. Never -0. */
export function normalizeAngle(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  let a = deg % 360;
  if (a <= -180) a += 360;
  else if (a > 180) a -= 360;
  return a + 0;
}

/** A spec for `kind`, its straight length fitted to a pane `paneW` wide. */
export function rulerSpecFor(kind: RulerKind, paneW: number): RulerSpec {
  switch (kind) {
    case "straight": {
      const wanted = Number.isFinite(paneW) && paneW > 0 ? paneW * 0.8 : RULER_MIN_LENGTH;
      return {
        kind,
        length: Math.round(Math.min(RULER_MAX_LENGTH, Math.max(RULER_MIN_LENGTH, wanted))),
      };
    }
    case "square":
      return { kind, length: SQUARE_LEG };
    case "protractor":
      return { kind, length: PROTRACTOR_RADIUS };
  }
}

/**
 * The set square's corners in its own frame: the right angle, the end of
 * the bottom leg, the top of the upright leg. Its centroid is the origin, so
 * it turns about its middle.
 */
export function squareCorners(leg: number): [RulerPt, RulerPt, RulerPt] {
  const third = leg / 3;
  return [
    { x: -third, y: third },
    { x: 2 * third, y: third },
    { x: -third, y: -2 * third },
  ];
}

/** A point in the ruler's frame, on screen. */
export function toScreen(pose: RulerPose, p: RulerPt): RulerPt {
  const cos = Math.cos(pose.angle * DEG);
  const sin = Math.sin(pose.angle * DEG);
  return { x: pose.x + p.x * cos - p.y * sin, y: pose.y + p.x * sin + p.y * cos };
}

/** A point on screen, in the ruler's frame. */
export function toRuler(pose: RulerPose, p: RulerPt): RulerPt {
  const cos = Math.cos(pose.angle * DEG);
  const sin = Math.sin(pose.angle * DEG);
  const dx = p.x - pose.x;
  const dy = p.y - pose.y;
  return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };
}

/** The edges a pen can follow, on screen: the long edges, the set square's three, the protractor's arc and base. */
export function rulerEdges(spec: RulerSpec, pose: RulerPose): RulerEdge[] {
  const line = (a: RulerPt, b: RulerPt): RulerEdge => ({
    type: "line",
    a: toScreen(pose, a),
    b: toScreen(pose, b),
  });
  switch (spec.kind) {
    case "straight": {
      const half = spec.length / 2;
      const across = RULER_WIDTH / 2;
      return [
        line({ x: -half, y: -across }, { x: half, y: -across }),
        line({ x: -half, y: across }, { x: half, y: across }),
      ];
    }
    case "square": {
      const [right, foot, top] = squareCorners(spec.length);
      return [line(right, foot), line(top, right), line(top, foot)];
    }
    case "protractor": {
      const r = spec.length;
      return [
        {
          type: "arc",
          c: { x: pose.x, y: pose.y },
          r,
          start: Math.PI + pose.angle * DEG,
          sweep: Math.PI,
        },
        line({ x: -r, y: 0 }, { x: r, y: 0 }),
      ];
    }
  }
}

/** Where along an arc (radians from its start, in [0, 2π)) a point's direction lies. */
function arcOffset(edge: Extract<RulerEdge, { type: "arc" }>, p: RulerPt): number {
  const phi = Math.atan2(p.y - edge.c.y, p.x - edge.c.x);
  return (((phi - edge.start) % TAU) + TAU) % TAU;
}

/**
 * How far `p` is from `edge`, measured square to it, or `Infinity` when its
 * foot falls past the edge's ends: a pen beside the end of a ruler is not
 * at its edge.
 */
export function edgeDistance(edge: RulerEdge, p: RulerPt): number {
  if (edge.type === "line") {
    const dx = edge.b.x - edge.a.x;
    const dy = edge.b.y - edge.a.y;
    const len2 = dx * dx + dy * dy;
    if (!(len2 > 0)) return Infinity;
    const t = ((p.x - edge.a.x) * dx + (p.y - edge.a.y) * dy) / len2;
    if (t < 0 || t > 1) return Infinity;
    return Math.abs((p.x - edge.a.x) * dy - (p.y - edge.a.y) * dx) / Math.sqrt(len2);
  }
  if (arcOffset(edge, p) > edge.sweep) return Infinity;
  return Math.abs(Math.hypot(p.x - edge.c.x, p.y - edge.c.y) - edge.r);
}

/** The index of the edge nearest `p` within `reach`, or -1 when none is. */
export function nearestEdge(edges: readonly RulerEdge[], p: RulerPt, reach: number): number {
  let best = -1;
  let bestDistance = reach;
  edges.forEach((edge, index) => {
    const distance = edgeDistance(edge, p);
    if (distance <= bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

/**
 * `p` moved onto `edge`: square onto a line, kept between its ends;
 * along its radius onto an arc, kept between the arc's ends.
 */
export function projectOntoEdge(edge: RulerEdge, p: RulerPt): RulerPt {
  if (edge.type === "line") {
    const dx = edge.b.x - edge.a.x;
    const dy = edge.b.y - edge.a.y;
    const len2 = dx * dx + dy * dy;
    if (!(len2 > 0)) return { x: edge.a.x, y: edge.a.y };
    const t = Math.min(1, Math.max(0, ((p.x - edge.a.x) * dx + (p.y - edge.a.y) * dy) / len2));
    return { x: edge.a.x + t * dx, y: edge.a.y + t * dy };
  }
  let along = arcOffset(edge, p);
  if (along > edge.sweep) along = along - edge.sweep < TAU - along ? edge.sweep : 0;
  const angle = edge.start + along;
  return { x: edge.c.x + edge.r * Math.cos(angle), y: edge.c.y + edge.r * Math.sin(angle) };
}

/**
 * `edge` moved `by` px away from `inside` (a point within the ruler): a
 * pen drawing along a ruler draws beside its edge, not under it, so the
 * line it follows lies half the ink's width outside the ruler and shows.
 */
export function offsetEdge(edge: RulerEdge, by: number, inside: RulerPt): RulerEdge {
  if (!(by > 0)) return edge;
  if (edge.type === "arc") return { ...edge, r: edge.r + by };
  const dx = edge.b.x - edge.a.x;
  const dy = edge.b.y - edge.a.y;
  const len = Math.hypot(dx, dy);
  if (!(len > 0)) return edge;
  let nx = -dy / len;
  let ny = dx / len;
  // The normal that points away from the inside.
  if ((inside.x - edge.a.x) * nx + (inside.y - edge.a.y) * ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  return {
    type: "line",
    a: { x: edge.a.x + nx * by, y: edge.a.y + ny * by },
    b: { x: edge.b.x + nx * by, y: edge.b.y + ny * by },
  };
}

/** The ruler's middle on screen: a point inside it whatever its kind. */
export function rulerMiddle(spec: RulerSpec, pose: RulerPose): RulerPt {
  return toScreen(pose, middleOf(spec));
}

/** Whether `p` (screen px) is on the ruler, or within `slop` of it. */
export function hitsRuler(spec: RulerSpec, pose: RulerPose, p: RulerPt, slop = 0): boolean {
  const q = toRuler(pose, p);
  switch (spec.kind) {
    case "straight":
      return Math.abs(q.x) <= spec.length / 2 + slop && Math.abs(q.y) <= RULER_WIDTH / 2 + slop;
    case "protractor":
      return q.y <= slop && Math.hypot(q.x, q.y) <= spec.length + slop;
    case "square": {
      const [right, foot, top] = squareCorners(spec.length);
      // Inside the legs, and on the inner side of the long edge (pushed out by the slop).
      if (q.x < right.x - slop || q.y > right.y + slop) return false;
      // The long edge runs top → foot; its outward normal points up and right.
      const nx = foot.y - top.y;
      const ny = top.x - foot.x;
      const len = Math.hypot(nx, ny);
      return ((q.x - top.x) * nx + (q.y - top.y) * ny) / len <= slop;
    }
  }
}

/**
 * The magnetic pull of the angle snapping, degrees: `step` around each
 * multiple of the step, `cardinal` around level and upright, which never
 * swallows the neighbouring multiples. See {@link snapAngle}.
 */
export function snapTolerance(step: number): { step: number; cardinal: number } {
  if (!(step > 0)) return { step: 0, cardinal: 0 };
  const tolerance = Math.min(step * 0.4, 5);
  return { step: tolerance, cardinal: Math.min(tolerance * 2, step - tolerance) };
}

/** Rounding in a turn summed from finger angles must not push it out of a pull, degrees. */
const SNAP_EPSILON = 1e-6;

/**
 * A turn the fingers asked for, snapped: within a few degrees of a multiple
 * of `step` it settles on that multiple, and within twice that of level or
 * upright (0, 90, 180, 270) on those, so a ruler is easy to lay straight.
 * Between the pulls it turns freely. `step` 0 is no snapping at all.
 */
export function snapAngle(deg: number, step: number): number {
  const angle = normalizeAngle(deg);
  const tolerance = snapTolerance(step);
  if (tolerance.step === 0) return angle;
  const cardinal = Math.round(angle / 90) * 90;
  if (Math.abs(angle - cardinal) <= tolerance.cardinal + SNAP_EPSILON)
    return normalizeAngle(cardinal);
  const nearest = Math.round(angle / step) * step;
  if (Math.abs(angle - nearest) <= tolerance.step + SNAP_EPSILON) return normalizeAngle(nearest);
  return angle;
}

/** The ruler moved by one finger or the mouse: slid, never turned. */
export function dragPose(pose: RulerPose, dx: number, dy: number): RulerPose {
  return { x: pose.x + dx, y: pose.y + dy, angle: pose.angle };
}

/**
 * The ruler under two fingers that moved from `from` to `to`: it turns by
 * the turn of the line between them (snapped, from the angle it had when
 * the second finger landed) about their midpoint, and goes along with the
 * midpoint. Fingers on top of each other cannot say a turn: it only slides.
 */
export function twoFingerPose(
  start: RulerPose,
  from: readonly [RulerPt, RulerPt],
  to: readonly [RulerPt, RulerPt],
  step: number,
): RulerPose {
  const mid0 = { x: (from[0].x + from[1].x) / 2, y: (from[0].y + from[1].y) / 2 };
  const mid1 = { x: (to[0].x + to[1].x) / 2, y: (to[0].y + to[1].y) / 2 };
  const span0 = Math.hypot(from[1].x - from[0].x, from[1].y - from[0].y);
  const span1 = Math.hypot(to[1].x - to[0].x, to[1].y - to[0].y);
  let angle = start.angle;
  if (span0 >= 1 && span1 >= 1) {
    const turn =
      Math.atan2(to[1].y - to[0].y, to[1].x - to[0].x) -
      Math.atan2(from[1].y - from[0].y, from[1].x - from[0].x);
    angle = snapAngle(start.angle + turn / DEG, step);
  }
  const applied = normalizeAngle(angle - start.angle) * DEG;
  const cos = Math.cos(applied);
  const sin = Math.sin(applied);
  const ox = start.x - mid0.x;
  const oy = start.y - mid0.y;
  return {
    x: mid1.x + ox * cos - oy * sin,
    y: mid1.y + ox * sin + oy * cos,
    angle,
  };
}

/**
 * The ruler turned one step about `pivot` (the mouse wheel over it): by the
 * snapping step, or one degree with snapping off, and then snapped.
 */
export function stepTurn(
  pose: RulerPose,
  pivot: RulerPt,
  direction: 1 | -1,
  step: number,
): RulerPose {
  const by = step > 0 ? step : 1;
  // From the nearest whole step, so a ruler turned by hand lands on the grid.
  const base = step > 0 ? Math.round(pose.angle / by) * by : pose.angle;
  const target = normalizeAngle(base + direction * by);
  const applied = normalizeAngle(target - pose.angle) * DEG;
  const cos = Math.cos(applied);
  const sin = Math.sin(applied);
  const ox = pose.x - pivot.x;
  const oy = pose.y - pivot.y;
  return { x: pivot.x + ox * cos - oy * sin, y: pivot.y + ox * sin + oy * cos, angle: target };
}

/** Where the visual middle of a ruler is, in its own frame (the protractor's is above its base). */
function middleOf(spec: RulerSpec): RulerPt {
  return spec.kind === "protractor" ? { x: 0, y: -spec.length / 2 } : { x: 0, y: 0 };
}

/**
 * The pose for another kind of ruler in place of this one: the same turn,
 * its middle where the old one's was, so picking a kind does not send the
 * ruler across the screen.
 */
export function swapKind(pose: RulerPose, from: RulerSpec, to: RulerSpec): RulerPose {
  const middle = toScreen(pose, middleOf(from));
  const offset = toScreen({ x: 0, y: 0, angle: pose.angle }, middleOf(to));
  return { x: middle.x - offset.x, y: middle.y - offset.y, angle: pose.angle };
}

/** A ruler as it first comes out: level, its middle at the pane's middle. */
export function openingPose(spec: RulerSpec, paneW: number, paneH: number): RulerPose {
  const middle = middleOf(spec);
  return { x: paneW / 2 - middle.x, y: paneH / 2 - middle.y, angle: 0 };
}

/**
 * The pose kept on screen: its middle within the pane, so a ruler left at
 * the edge before the pane narrowed (a rotation, the sidebar) can still be
 * reached.
 */
export function keepInPane(
  spec: RulerSpec,
  pose: RulerPose,
  paneW: number,
  paneH: number,
): RulerPose {
  if (!(paneW > 0) || !(paneH > 0)) return pose;
  const middle = toScreen(pose, middleOf(spec));
  const x = Math.min(paneW, Math.max(0, middle.x));
  const y = Math.min(paneH, Math.max(0, middle.y));
  if (x === middle.x && y === middle.y) return pose;
  return { x: pose.x + x - middle.x, y: pose.y + y - middle.y, angle: pose.angle };
}

/** One mark of a centimetre scale. */
export interface RulerTick {
  /** Distance from the scale's zero, screen px. */
  at: number;
  /** Millimetres from zero. */
  mm: number;
  /** 0 the finest mark drawn, up to 2 the longest. */
  level: 0 | 1 | 2;
  /** The centimetres, on the marks that carry a number. */
  label?: string;
}

/** Mark spacings tried, finest first, in mm: 1 mm, 5 mm, 1 cm, 5 cm, 10 cm, 50 cm, 1 m. */
const TICK_LADDER = [1, 5, 10, 50, 100, 500, 1000];
/** Numbers are a whole number of centimetres. */
const LABEL_LADDER = [10, 50, 100, 500, 1000];
/** Marks closer than this on screen would run together, px. */
export const MIN_TICK_GAP_PX = 4;
/** Numbers closer than this would overlap, px. */
export const MIN_LABEL_GAP_PX = 28;

/**
 * The marks of a scale `length` screen px long, at `pxPerMm` screen px per
 * page millimetre: millimetres, half centimetres and centimetres while they
 * are far enough apart to read, coarser steps when zoomed out, and a number
 * of centimetres as often as the numbers fit.
 */
export function rulerTicks(length: number, pxPerMm: number): RulerTick[] {
  if (!(length > 0) || !(pxPerMm > 0) || !Number.isFinite(pxPerMm)) return [];
  const finest = TICK_LADDER.findIndex((mm) => mm * pxPerMm >= MIN_TICK_GAP_PX);
  if (finest < 0) return [];
  const unit = TICK_LADDER[finest];
  const labelUnit = LABEL_LADDER.find((mm) => mm * pxPerMm >= MIN_LABEL_GAP_PX);
  const ticks: RulerTick[] = [];
  const count = Math.floor(length / (unit * pxPerMm) + 1e-9);
  for (let i = 0; i <= count; i++) {
    const mm = i * unit;
    let rank = 0;
    for (let k = finest + 1; k < TICK_LADDER.length && rank < 2; k++) {
      if (mm % TICK_LADDER[k] !== 0) break;
      rank++;
    }
    const tick: RulerTick = { at: mm * pxPerMm, mm, level: rank as 0 | 1 | 2 };
    if (labelUnit !== undefined && mm % labelUnit === 0) tick.label = String(mm / 10);
    ticks.push(tick);
  }
  return ticks;
}

/** One mark of the protractor's scale, in whole degrees from its right end. */
export interface ProtractorTick {
  deg: number;
  level: 0 | 1 | 2;
  label?: string;
}

/** The protractor's marks: every degree, longer every 5 and 10, a number every 10. */
export function protractorTicks(): ProtractorTick[] {
  const ticks: ProtractorTick[] = [];
  for (let deg = 0; deg <= 180; deg++) {
    const level = deg % 10 === 0 ? 2 : deg % 5 === 0 ? 1 : 0;
    const tick: ProtractorTick = { deg, level };
    if (level === 2) tick.label = String(deg);
    ticks.push(tick);
  }
  return ticks;
}

/**
 * The ruler's angle as its readout shows it: how far it is from level,
 * 0–90°, whichever way round it lies and whichever way it leans (Apple's
 * ruler reads the same).
 */
export function readoutAngle(angle: number): number {
  const a = Math.abs(Math.round(normalizeAngle(angle))) % 180;
  return a > 90 ? 180 - a : a;
}

/** What the settings keep of the ruler: its kind and the snapping. */
export interface RulerSettings {
  kind: RulerKind;
  snap: number;
}

/** Stored ruler settings, checked: anything unknown falls back to the straight ruler at 15°. */
export function rulerSettingsOf(raw: unknown): RulerSettings {
  const value = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const kind = (RULER_KINDS as readonly unknown[]).includes(value.kind)
    ? (value.kind as RulerKind)
    : "straight";
  const snap = RULER_SNAP_STEPS.includes(value.snap as number)
    ? (value.snap as number)
    : DEFAULT_RULER_SNAP;
  return { kind, snap };
}
