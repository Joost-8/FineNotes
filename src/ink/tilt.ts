/**
 * Pencil tilt: how far the pen leans, read from a pointer event, and how
 * much wider it makes the brush (discussion #51). Held as people write (50-60°
 * above the screen) nothing changes; laid down flat for shading, the brush
 * paints up to {@link TILT_MAX_FACTOR} times its width.
 *
 * A stroke stores the pen's altitude per point (`Stroke.tilt`), not the
 * width it made, so the curve here can be retuned and every stroke follows.
 *
 * What the platforms give: WebKit fills `tiltX`/`tiltY` (whole degrees) from
 * the Pencil's altitude and azimuth on every pointer event, and from Safari
 * 18.2 also `altitudeAngle` (radians, finer). Chromium (Android, the desktop
 * app) fills both from the stylus where the hardware reports tilt. A device
 * without tilt reports 0/0, upright, which changes nothing.
 *
 * Pure: no DOM.
 */

/** Upright, degrees above the screen: a pen with no tilt, and a mouse. */
export const UPRIGHT = 90;

/** At and above this altitude, degrees, tilt leaves the width alone: writing grips. */
export const TILT_START = 45;

/** At and below this altitude, degrees, the brush is at its widest. */
export const TILT_FULL = 15;

/** How many times its own width a brush laid flat paints. */
export const TILT_MAX_FACTOR = 3;

/**
 * The width multiplier at `altitude` degrees: 1 from {@link TILT_START} up,
 * {@link TILT_MAX_FACTOR} from {@link TILT_FULL} down, a smoothstep between,
 * so the line never kinks as the hand leans. Anything not a number is 1.
 */
export function tiltFactor(altitude: number): number {
  if (!Number.isFinite(altitude)) return 1;
  const t = Math.min(1, Math.max(0, (TILT_START - altitude) / (TILT_START - TILT_FULL)));
  return 1 + (TILT_MAX_FACTOR - 1) * t * t * (3 - 2 * t);
}

/** The orientation fields of a pointer event, as far as the browser has them. */
export interface TiltReading {
  /** Radians above the screen, π/2 upright (Pointer Events 3; WebKit from Safari 18.2). */
  altitudeAngle?: number;
  /** Degrees, -90..90, the lean towards +x. */
  tiltX?: number;
  /** Degrees, -90..90, the lean towards +y. */
  tiltY?: number;
}

/**
 * The pen's altitude in degrees above the screen, 0..90, or NaN when the
 * event says nothing. `altitudeAngle` when there is one (radians, finer);
 * otherwise from `tiltX`/`tiltY`, the plane angles, as Pointer Events 3
 * converts them.
 */
export function altitudeOf(reading: TiltReading): number {
  const { altitudeAngle, tiltX, tiltY } = reading;
  if (typeof altitudeAngle === "number" && Number.isFinite(altitudeAngle)) {
    return clampAltitude((altitudeAngle * 180) / Math.PI);
  }
  if (
    typeof tiltX !== "number" ||
    typeof tiltY !== "number" ||
    !Number.isFinite(tiltX) ||
    !Number.isFinite(tiltY)
  ) {
    return Number.NaN;
  }
  if (Math.abs(tiltX) >= 90 || Math.abs(tiltY) >= 90) return 0;
  const tx = Math.tan((tiltX * Math.PI) / 180);
  const ty = Math.tan((tiltY * Math.PI) / 180);
  return clampAltitude((Math.atan2(1, Math.hypot(tx, ty)) * 180) / Math.PI);
}

function clampAltitude(degrees: number): number {
  return Math.min(UPRIGHT, Math.max(0, degrees));
}

/**
 * How quickly the stored altitude follows the reading, ms. WebKit before
 * Safari 18.2 gives whole-degree `tiltX`/`tiltY`, so the altitude steps by
 * about a degree, and on the steep part of the curve a degree is 12% of the
 * width. A filter that only looks back keeps the ink append-only: a point's
 * width is settled the moment it arrives.
 */
export const TILT_SMOOTHING_MS = 20;

/** The share of a new reading taken when the time between readings is unknown. */
const UNTIMED_WEIGHT = 0.3;

/**
 * An upright reading this far (degrees) below the one before is no reading:
 * no hand turns a pen from 80° to upright between two samples a few ms
 * apart, but a device can drop to its 0/0 default.
 */
const UPRIGHT_JUMP = 10;

/**
 * The altitude each sample of one stroke stores. Missing is not upright, as
 * pressure 0 is not no pressure (`StrokeBuilder`): a sample without a reading,
 * or an upright one straight after a lean (see {@link UPRIGHT_JUMP}), takes
 * the altitude before it. Until the first reading, {@link next} gives NaN; the
 * builder fills those in when it arrives.
 */
export class TiltFilter {
  private value = Number.NaN;
  private lastRaw = Number.NaN;
  private lastT = Number.NaN;

  /** The altitude so far, NaN before any reading. */
  get current(): number {
    return this.value;
  }

  /** Take one reading (degrees, NaN for none) at time `t` ms; the altitude to store. */
  next(reading: number, t?: number): number {
    if (!Number.isFinite(reading)) return this.value;
    // 0.01: π/2 radians comes back from degrees a hair under 90.
    if (reading >= UPRIGHT - 0.01 && this.lastRaw < UPRIGHT - UPRIGHT_JUMP) return this.value;
    this.lastRaw = reading;
    const timed = typeof t === "number" && Number.isFinite(t);
    if (Number.isNaN(this.value)) {
      this.value = reading;
    } else {
      const dt = timed && Number.isFinite(this.lastT) ? t - this.lastT : Number.NaN;
      const weight = dt > 0 ? 1 - Math.exp(-dt / TILT_SMOOTHING_MS) : UNTIMED_WEIGHT;
      this.value += (reading - this.value) * weight;
    }
    if (timed) this.lastT = t;
    return this.value;
  }

  /** A filter in the same state. */
  copy(): TiltFilter {
    const copy = new TiltFilter();
    copy.value = this.value;
    copy.lastRaw = this.lastRaw;
    copy.lastT = this.lastT;
    return copy;
  }
}

/**
 * An altitude rounded to the tenth of a degree a file stores, so a stroke
 * draws the same live as after a save (NaN stays NaN).
 */
export function storedAltitude(degrees: number): number {
  return Math.round(degrees * 10) / 10;
}

const widest = new WeakMap<readonly number[], number>();

/**
 * The most `tilt` (a stroke's altitudes) widens the stroke anywhere, 1 for
 * none: how much further than its nib its ink can reach, for tiles, the
 * eraser and bounds. Remembered per array, which nothing edits in place.
 */
export function widestTiltFactor(tilt: readonly number[] | undefined): number {
  if (!tilt || tilt.length === 0) return 1;
  let factor = widest.get(tilt);
  if (factor === undefined) {
    let lowest = UPRIGHT;
    for (const altitude of tilt) if (altitude < lowest) lowest = altitude;
    factor = tiltFactor(lowest);
    widest.set(tilt, factor);
  }
  return factor;
}

/**
 * Whether a stroke's altitudes are worth keeping: some point leans past
 * {@link TILT_START}, so the brush drew wider there. A stroke held as people
 * write keeps none, and costs nothing on disk.
 */
export function tiltShapes(tilt: readonly number[]): boolean {
  return tilt.some((altitude) => Number.isFinite(altitude) && altitude < TILT_START);
}

/**
 * The altitude at each point of `piece`, a stretch cut out of the polyline
 * `pts` (flat `[x, y, p, …]`, stride 3) whose points carry `tilt`: every
 * point of the piece lies on the polyline, in order, as the eraser cuts it.
 * Each is found on the first segment at or after the last one found that
 * passes within `tolerance` of it, and takes the altitude interpolated there.
 * `from` (a segment index, as returned) lets several pieces of one stroke be
 * walked in order. Null when a point cannot be placed.
 */
export function tiltAlong(
  pts: readonly number[],
  tilt: readonly number[],
  piece: readonly number[],
  from = 0,
  tolerance = 1e-3,
): { tilt: number[]; segment: number } | null {
  const n = Math.min(tilt.length, Math.floor(pts.length / 3));
  const out: number[] = [];
  let segment = Math.max(0, from);
  for (let i = 0; i + 2 < piece.length; i += 3) {
    const x = piece[i];
    const y = piece[i + 1];
    let found = false;
    for (; segment < n; segment++) {
      const a = segment * 3;
      if (segment === n - 1) {
        // The last point, on its own.
        if (Math.hypot(x - pts[a], y - pts[a + 1]) <= tolerance) {
          out.push(tilt[segment]);
          found = true;
          break;
        }
        continue;
      }
      const b = a + 3;
      const dx = pts[b] - pts[a];
      const dy = pts[b + 1] - pts[a + 1];
      const length2 = dx * dx + dy * dy;
      const t =
        length2 > 0
          ? Math.min(1, Math.max(0, ((x - pts[a]) * dx + (y - pts[a + 1]) * dy) / length2))
          : 0;
      if (Math.hypot(x - (pts[a] + dx * t), y - (pts[a + 1] + dy * t)) <= tolerance) {
        out.push(tilt[segment] + (tilt[segment + 1] - tilt[segment]) * t);
        found = true;
        break;
      }
    }
    if (!found) return null;
  }
  return { tilt: out, segment };
}
