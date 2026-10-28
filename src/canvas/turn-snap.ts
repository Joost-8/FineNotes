/**
 * How a turn by a knob settles (FineNotes discussion #51: turning a shape
 * was "very sensitive, it should be more snappy and auto adjusting").
 *
 * A knob a few dozen screen px from the middle it turns about moves the
 * selection by about a degree a px, so the angle followed every tremor of
 * the pen, and only quarter turns snapped (within 4°). Now a turn has
 * detents:
 *
 * - **Where it started.** The turn is held at 0 until the pen leaves that
 *   detent, so a tap or a wobble on the knob turns nothing.
 * - **Quarter turns** (90°, 180°, 270°), and **level**: for a lone shape,
 *   the turns that bring its longest straight edge level or upright
 *   ({@link levelTurnOf}), so a slightly tilted rectangle or line is easy
 *   to straighten. These hold strongest.
 * - **Every 15°**, held lightly.
 *
 * Between detents the turn is free, so any angle can still be placed. A
 * detent lets go only a little past where it caught (hysteresis), so the
 * turn never flickers at its edge. Every capture is a distance the pen
 * travels along the knob's circle, in screen px, turned into an angle by
 * the knob's radius on screen — clamped, so a knob close to the middle
 * does not make every angle a detent and a far one still has some.
 *
 * Pure: no DOM. Angles are radians, clockwise on screen (y down).
 */

const DEG = Math.PI / 180;

/** Quarter turns and level: caught within this many screen px of arc, 3°–8°. */
const STRONG = { px: 14, min: 3 * DEG, max: 8 * DEG, release: 1.5 };
/** Every {@link STEP_DEG}°: caught within this many screen px of arc, 1.2°–2.5°. */
const LIGHT = { px: 5, min: 1.2 * DEG, max: 2.5 * DEG, release: 1.3 };
/** Where the turn started: let go after this many screen px of arc, 4°–10°. */
const START = { px: 9, min: 4 * DEG, max: 10 * DEG, release: 1.5 };
/** The light detents' spacing, degrees. */
export const STEP_DEG = 15;

/** Shapes with more corners than this are curves: no edge to level. */
const MAX_EDGE_VERTICES = 12;

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

interface Detent {
  angle: number;
  /** Caught within this, radians. */
  catch: number;
  /** Let go this many times further out than it caught (hysteresis). */
  release: number;
}

/** One turn, from pen-down to lift: feed it the swept angle, get the turn to show. */
export class TurnSnap {
  /** The detent the turn is held at, radians, or null while it turns freely. */
  private held: Detent | null;
  private readonly detents: Detent[] = [];
  /** The turn last returned. */
  private last = 0;

  /**
   * `radiusPx`: how far the knob is from the middle it turns about, screen
   * px. `level`: the turn that brings the selection's main edge level
   * ({@link levelTurnOf}), or null for none.
   */
  constructor(radiusPx: number, level: number | null = null) {
    const r = radiusPx > 1 ? radiusPx : 1;
    const strong = clamp(STRONG.px / r, STRONG.min, STRONG.max);
    const light = clamp(LIGHT.px / r, LIGHT.min, LIGHT.max);
    const start: Detent = {
      angle: 0,
      catch: clamp(START.px / r, START.min, START.max),
      release: START.release,
    };
    this.detents.push(start);
    for (let k = -1; k <= 2; k++) {
      if (k !== 0)
        this.detents.push({
          angle: wrap((k * Math.PI) / 2),
          catch: strong,
          release: STRONG.release,
        });
      if (level !== null && Number.isFinite(level)) {
        this.detents.push({
          angle: wrap(level + (k * Math.PI) / 2),
          catch: strong,
          release: STRONG.release,
        });
      }
    }
    for (let k = -11; k <= 12; k++) {
      if (k % 6 !== 0)
        this.detents.push({
          angle: wrap(k * STEP_DEG * DEG),
          catch: light,
          release: LIGHT.release,
        });
    }
    // Held where it started: the dead zone at the start of a turn.
    this.held = start;
  }

  /** Whether the last turn returned sits on a detent. */
  get snapped(): boolean {
    return this.held !== null;
  }

  /** The turn to show for `raw`, the angle the pen has swept so far (any range). */
  turn(raw: number): number {
    if (!Number.isFinite(raw)) return this.last;
    const a = wrap(raw);
    const held = this.held;
    if (held && Math.abs(wrap(a - held.angle)) <= held.catch * held.release) {
      this.last = held.angle;
      return held.angle;
    }
    let best: Detent | null = null;
    let bestOff = Infinity;
    for (const d of this.detents) {
      const off = Math.abs(wrap(a - d.angle));
      if (off <= d.catch && off < bestOff) {
        best = d;
        bestOff = off;
      }
    }
    this.held = best;
    this.last = best ? best.angle : a;
    return this.last;
  }
}

/**
 * The turn (radians, clockwise) that brings the longest straight edge of
 * flat `[x, y, p, …]` points level or upright, whichever is nearer; null
 * for a curve (more than {@link MAX_EDGE_VERTICES} corners), a dot, or an
 * edge already level or upright.
 */
export function levelTurnOf(pts: readonly number[]): number | null {
  const n = Math.floor(pts.length / 3);
  if (n < 2 || n > MAX_EDGE_VERTICES + 1) return null;
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
  if (!(best > 0)) return null;
  const angle = Math.atan2(dy, dx);
  const quarter = Math.PI / 2;
  const turn = Math.round(angle / quarter) * quarter - angle;
  return Math.abs(turn) < 1e-9 ? null : turn;
}
