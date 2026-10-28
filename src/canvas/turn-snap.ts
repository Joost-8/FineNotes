/**
 * How a turn settles: by the rotate knob, or by two fingers (FineNotes
 * discussion #51). Turning a shape was "very sensitive"; Joost's rule since
 * PR #59: a turn snaps onto every 45° **measured on the page** (0°, 45°,
 * 90° …), whatever angle the item started at, and nowhere in between.
 *
 * So the detents are not turns of 45° but the turns that bring the item to
 * a page angle that is a multiple of 45°: a rectangle drawn 2° off level is
 * caught at −2° (level), 43°, 88° and so on, never at 89° or 179°. The
 * item's angle on the page ({@link shapeAngleOf} for a shape, a picture's
 * rotation, 0 for anything else) is the `base` the turn starts from.
 *
 * Between detents the turn is free, so any angle can still be placed. A
 * detent lets go only a little past where it caught (hysteresis), so the
 * turn never flickers at its edge. A capture is a distance along the
 * turn's circle in screen px (the knob's, or half the fingers' spread),
 * turned into an angle by that radius, and clamped, so a small circle
 * does not make every angle a detent and a large one still has some.
 *
 * Pure: no DOM. Angles are radians, clockwise on screen (y down).
 */

const DEG = Math.PI / 180;

/** The page angles a turn snaps onto, degrees apart. */
export const STEP_DEG = 45;
/** A detent catches within this many screen px of arc, 3°–8°, and lets go 1.5 times further out. */
const CATCH = { px: 14, min: 3 * DEG, max: 8 * DEG, release: 1.5 };

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

/** One turn, from pen-down to lift: feed it the swept angle, get the turn to show. */
export class TurnSnap {
  /** The detent the turn is held at, radians of turn, or null while it turns freely. */
  private held: number | null = null;
  private readonly detents: number[] = [];
  private readonly catchAngle: number;
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
    this.catchAngle = clamp(CATCH.px / r, CATCH.min, CATCH.max);
    const step = STEP_DEG * DEG;
    const from = Number.isFinite(base) ? base : 0;
    for (let k = 0; k < 360 / STEP_DEG; k++) this.detents.push(wrap(k * step - from));
    // Already on a page step: held there, so a tap or a wobble turns nothing.
    if (this.detents.some((d) => Math.abs(d) < 1e-9)) this.held = 0;
  }

  /** Whether the last turn returned sits on a page step. */
  get snapped(): boolean {
    return this.held !== null;
  }

  /** The item's angle on the page after turning it by `turn`, within (-π, π]. */
  pageAngle(turn: number): number {
    return wrap((Number.isFinite(this.base) ? this.base : 0) + turn);
  }

  /** The turn to show for `raw`, the angle swept so far (any range). */
  turn(raw: number): number {
    if (!Number.isFinite(raw)) return this.last;
    const a = wrap(raw);
    const held = this.held;
    if (held !== null && Math.abs(wrap(a - held)) <= this.catchAngle * CATCH.release) {
      this.last = held;
      return held;
    }
    let best: number | null = null;
    let bestOff = Infinity;
    for (const d of this.detents) {
      const off = Math.abs(wrap(a - d));
      if (off <= this.catchAngle && off < bestOff) {
        best = d;
        bestOff = off;
      }
    }
    this.held = best;
    this.last = best ?? a;
    return this.last;
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
