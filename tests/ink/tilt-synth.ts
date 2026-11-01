/**
 * Synthetic Apple Pencil strokes with tilt, for the tilt tests.
 *
 * As with positions (ledger: "Synthetic test ink must model tremor, not white
 * noise"), a hand does not tilt a pen at random from one sample to the next.
 * A writing grip holds the Pencil 50-60° above the glass and drifts a degree
 * or two over a word; going into shading, the hand lowers it to 15-25° over a
 * few hundred ms, and back. The azimuth follows the hand (a right hand leans
 * the barrel towards the lower right) and swings slowly. On top: 0.1° of
 * sensor noise. The stream is timed as the Pencil reports, 240 Hz.
 *
 * Two platform forms: Safari 18.2 and later give `altitudeAngle` and
 * `azimuthAngle` (radians); before that WebKit gives only `tiltX`/`tiltY` in
 * whole degrees, which steps the altitude a degree at a time.
 */

import { rng } from "./ink-synth";

/** One pointer sample as the browser hands it over. */
export interface PencilSample {
  x: number;
  y: number;
  t: number;
  pressure: number;
  altitudeAngle?: number;
  azimuthAngle?: number;
  tiltX: number;
  tiltY: number;
  /** The altitude the hand held, degrees: the truth the readings came from. */
  trueAltitude: number;
}

export interface PencilStrokeOptions {
  /** Samples, at `hz`. */
  count?: number;
  hz?: number;
  /** The grip it starts and ends at, degrees above the glass. */
  grip?: number;
  /** The lowest the hand leans in the middle, degrees; `grip` for none. */
  flat?: number;
  /** Before Safari 18.2: whole-degree tiltX/tiltY only. */
  wholeDegrees?: boolean;
  seed?: number;
}

const DEG = Math.PI / 180;

/** `tiltX`/`tiltY` for an altitude and azimuth (degrees), as Pointer Events 3 defines them. */
export function tiltsOf(altitude: number, azimuth: number): { tiltX: number; tiltY: number } {
  if (altitude >= 90) return { tiltX: 0, tiltY: 0 };
  const t = Math.tan(altitude * DEG);
  return {
    tiltX: Math.atan(Math.cos(azimuth * DEG) / t) / DEG,
    tiltY: Math.atan(Math.sin(azimuth * DEG) / t) / DEG,
  };
}

/**
 * A shading stroke: zigzag hatching across 220 px, its altitude easing from
 * `grip` down to `flat` and back up over the stroke (a smoothstep in time,
 * so the lean is fastest mid-way, ~150°/s at the defaults).
 */
export function pencilStroke(options: PencilStrokeOptions = {}): PencilSample[] {
  const count = options.count ?? 240;
  const hz = options.hz ?? 240;
  const grip = options.grip ?? 55;
  const flat = options.flat ?? 20;
  const rand = rng(options.seed ?? 7);
  const phases = [rand() * 6.28, rand() * 6.28, rand() * 6.28];
  const out: PencilSample[] = [];
  for (let i = 0; i < count; i++) {
    const t = (i * 1000) / hz;
    const u = i / (count - 1);
    // Down and back up: 0 at both ends, 1 in the middle.
    const lean = Math.sin(Math.PI * u) ** 2;
    const drift = 1.2 * Math.sin(t / 310 + phases[0]) + 0.5 * Math.sin(t / 97 + phases[1]);
    const trueAltitude = grip - (grip - flat) * lean + drift;
    const altitude = trueAltitude + (rand() - 0.5) * 0.2;
    const azimuth = 135 + 8 * Math.sin(t / 420 + phases[2]);
    const x = 40 + 220 * u + 1.1 * Math.sin(t / 60 + phases[1]);
    const y = 100 + 30 * Math.sin(u * Math.PI * 12) + 0.8 * Math.sin(t / 45 + phases[0]);
    const tilts = tiltsOf(altitude, azimuth);
    const sample: PencilSample = {
      x,
      y,
      t,
      pressure: 0.24 + 0.06 * Math.sin(t / 150 + phases[2]),
      tiltX: options.wholeDegrees ? Math.round(tilts.tiltX) : tilts.tiltX,
      tiltY: options.wholeDegrees ? Math.round(tilts.tiltY) : tilts.tiltY,
      trueAltitude,
    };
    if (!options.wholeDegrees) {
      sample.altitudeAngle = altitude * DEG;
      sample.azimuthAngle = azimuth * DEG;
    }
    out.push(sample);
  }
  return out;
}
