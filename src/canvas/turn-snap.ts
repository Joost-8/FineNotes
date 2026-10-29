/**
 * How a turn settles: by the rotate knob, or by two fingers (FineNotes
 * discussion #51). Joost's rule on PR #59: a turn is drawn toward every 45°
 * **measured on the page** (0°, 45°, 90° …), whatever angle the item
 * started at — and, after the first try felt like a full stop at each
 * step, the pull is gentle: the turn slows near a step and goes through it
 * fluently, never held.
 *
 * The steps are not turns of 45° but the turns that bring the item to a
 * page angle that is a multiple of 45°: a rectangle drawn 2° off level is
 * drawn toward −2° (level), 43°, 88° and so on, never 89° or 179°. The
 * item's angle on the page ({@link shapeAngleOf} for a shape, a picture's
 * rotation, 0 for anything else) is the `base` the turn starts from.
 *
 * Near a step, within a pull zone, the shown turn is eased toward it:
 * `off · (MIN_SLOPE + (1 − MIN_SLOPE)·|off|/zone)` — continuous at the
 * zone's edge, and never slower than `MIN_SLOPE` of the hand, so it never
 * stops. On the lift ({@link TurnSnap.settled}) a turn that ends in the
 * inner half of a zone lands on the step exactly, so a shape left "at 90°"
 * is at 90.000°, not 89.6°. A zone is a distance along the turn's circle
 * in screen px (the knob's, or half the fingers' spread), turned into an
 * angle by that radius and clamped.
 *
 * Pure: no DOM. Angles are radians, clockwise on screen (y down).
 */

const DEG = Math.PI / 180;

/** The page angles a turn is drawn toward, degrees apart. */
export const STEP_DEG = 45;
/** The pull reaches this many screen px of arc each side of a step, 3°–9°. */
const PULL = { px: 16, min: 3 * DEG, max: 9 * DEG };
/** At a step the shown turn still moves this share of the hand's turn. */
const MIN_SLOPE = 0.3;
/** Within this share of the pull zone, the lift lands on the step exactly. */
const LAND = 0.5;
/** The readout marks the turn as on a step within this angle of it. */
const ON_STEP = 0.5 * DEG;

/** Shapes with more corners than this are curves: their axis, not an edge, is their angle. */
const MAX_EDGE_VERTICES = 12;
/** A curve whose spread along its axis is less than this times across it is round: no angle. */
const MIN_ELONGATION = 1.15;

/** Wrap an angle into (-π, π]. */
function wrap(angle: number): number {
  const turn = 2 * Math.PI;
  let a = angle % turn;
  if (a <= -Math.PI) a += turn;
  if (a > Math.PI) a -= turn;
  return a;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** One turn, from press to lift: feed it the swept angle, get the turn to show. */
export class TurnSnap {
  private readonly steps: number[] = [];
  private readonly zone: number;
  /** The swept angle last given, wrapped. */
  private raw = 0;
  /** The turn last returned. */
  private last = 0;

  /**
   * `radiusPx`: the radius of the turn's circle on screen, px. `base`: the
   * item's angle on the page now, radians (0 for a selection taken as drawn).
   */
  constructor(
    radiusPx: number,
    private readonly base = 0,
  ) {
    const r = radiusPx > 1 ? radiusPx : 1;
    this.zone = clamp(PULL.px / r, PULL.min, PULL.max);
    const from = Number.isFinite(base) ? base : 0;
    const step = STEP_DEG * DEG;
    for (let k = 0; k < 360 / STEP_DEG; k++) this.steps.push(wrap(k * step - from));
  }

  /** Whether the last turn shown sits on a page step (for the readout's mark). */
  get snapped(): boolean {
    const near = this.nearest(this.last);
    return Math.abs(near.off) <= ON_STEP;
  }

  /** The item's angle on the page after turning it by `turn`, within (-π, π]. */
  pageAngle(turn: number): number {
    return wrap((Number.isFinite(this.base) ? this.base : 0) + turn);
  }

  /** The turn to show for `raw`, the angle swept so far (any range): drawn gently toward a step. */
  turn(raw: number): number {
    if (!Number.isFinite(raw)) return this.last;
    this.raw = wrap(raw);
    const { step, off } = this.nearest(this.raw);
    const a = Math.abs(off);
    this.last =
      a >= this.zone
        ? this.raw
        : wrap(step + off * (MIN_SLOPE + ((1 - MIN_SLOPE) * a) / this.zone));
    return this.last;
  }

  /**
   * The turn to keep on the lift: on the step itself when the last turn
   * ended in the inner part of its pull, so a shape left at a page step is
   * on it exactly; else the turn as shown.
   */
  settled(): number {
    const { step, off } = this.nearest(this.raw);
    return Math.abs(off) <= this.zone * LAND ? step : this.last;
  }

  /** The step nearest `angle`, and how far `angle` is from it. */
  private nearest(angle: number): { step: number; off: number } {
    let step = 0;
    let off = Infinity;
    for (const s of this.steps) {
      const d = wrap(angle - s);
      if (Math.abs(d) < Math.abs(off)) {
        step = s;
        off = d;
      }
    }
    return { step, off };
  }
}

/**
 * The angle a shape (flat `[x, y, p, …]` points) has on the page, within
 * (−90°, 90°]: the direction of its longest straight edge for a shape with
 * corners, the long axis of a curve (an ellipse drawn tilted). `null` for a
 * dot, a round shape, or anything with no direction.
 */
export function shapeAngleOf(pts: readonly number[]): number | null {
  const n = Math.floor(pts.length / 3);
  if (n < 2) return null;
  if (n <= MAX_EDGE_VERTICES + 1) {
    let best = 0;
    let dx = 0;
    let dy = 0;
    for (let i = 1; i < n; i++) {
      const ex = pts[i * 3] - pts[(i - 1) * 3];
      const ey = pts[i * 3 + 1] - pts[(i - 1) * 3 + 1];
      const len = ex * ex + ey * ey;
      if (len > best) {
        best = len;
        dx = ex;
        dy = ey;
      }
    }
    return best > 0 ? halfTurn(Math.atan2(dy, dx)) : null;
  }
  // A curve: the axis of its points' spread (second moments).
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += pts[i * 3];
    my += pts[i * 3 + 1];
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const x = pts[i * 3] - mx;
    const y = pts[i * 3 + 1] - my;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
  }
  const mean = (sxx + syy) / 2;
  const spread = Math.hypot((sxx - syy) / 2, sxy);
  const along = mean + spread;
  const across = mean - spread;
  if (!(along > 0) || along < MIN_ELONGATION * MIN_ELONGATION * Math.max(across, 0)) return null;
  return halfTurn(Math.atan2(2 * sxy, sxx - syy) / 2);
}

/** An edge has no direction: its angle within (−90°, 90°]. */
function halfTurn(angle: number): number {
  let a = wrap(angle);
  if (a <= -Math.PI / 2) a += Math.PI;
  if (a > Math.PI / 2) a -= Math.PI;
  return a;
}
