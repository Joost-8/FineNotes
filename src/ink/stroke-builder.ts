/**
 * Turns the samples of one pen-down into the points a stroke stores — the
 * flat `[x, y, p, …]` buffer of the file format. It keeps a sample only once
 * the pen has moved far enough from the last one kept, and decides what
 * pressure each point stores. Pure: no DOM. The pointer events (coalesced
 * and predicted samples) are unpacked in `input/pointer-controller.ts`.
 */

import { FALLBACK_PRESSURE, MIN_SAMPLE_DISTANCE } from "../constants";
import { POINT_STRIDE } from "../model/document";

/** One pointer sample, in page px. */
export interface InputSample {
  x: number;
  y: number;
  /** The pointer's pressure, 0..1. A 0 means the device gave no reading. */
  pressure: number;
}

export interface StrokeBuilderOptions {
  /** A sample closer than this to the last point kept is dropped (page px). */
  minDistance: number;
  /** Off: every point stores `fallbackPressure`, whatever the pen reads. */
  pressureEnabled: boolean;
  /** The pressure stored when there is no reading to go by. */
  fallbackPressure: number;
}

const DEFAULTS: StrokeBuilderOptions = {
  minDistance: MIN_SAMPLE_DISTANCE,
  pressureEnabled: true,
  fallbackPressure: FALLBACK_PRESSURE,
};

/**
 * The pressure to store for one raw reading, taken on its own: the reading,
 * capped at 1, if pressure is on and there is one; otherwise the fallback.
 * (`StrokeBuilder` does better for a missing reading mid-stroke.)
 */
export function mapPressure(reading: number, settings: StrokeBuilderOptions): number {
  const use = settings.pressureEnabled && reading > 0;
  return use ? Math.min(reading, 1) : settings.fallbackPressure;
}

/**
 * The points of one stroke as it is drawn. `add` keeps a sample that lies
 * at least `minDistance` from the last point kept; `addFinal` keeps the
 * pen-up sample regardless, so the stroke ends where the pen lifted.
 *
 * A pressure of 0 from a pen is *no reading*, not no pressure: pointer
 * events report 0 on every pen-up, and WebKit can on a pen-down too. Mapped
 * to the 0.5 fallback, a light stroke (a Pencil writes at ~0.25) ended —
 * and could start — at twice its pressure, as a round dot 1.6x the line's
 * width: invisible at fit zoom, a blob at 5x (Joost's recording,
 * 2026-09-24). So a missing reading takes the pressure next to it: the
 * last one read, or, before any, the first one that arrives.
 */
export class StrokeBuilder {
  private readonly options: StrokeBuilderOptions;
  /** The points kept so far, flat. */
  private readonly flat: number[] = [];
  /** The pen's last real pressure reading; NaN until the first arrives. */
  private lastReading = Number.NaN;

  constructor(overrides: Partial<StrokeBuilderOptions> = {}) {
    this.options = { ...DEFAULTS, ...overrides };
  }

  /** Offer a sample; true if it was kept. */
  add(next: InputSample): boolean {
    return this.offer(next, false);
  }

  /** Keep the pen-up sample, however close it is to the last point. Always true. */
  addFinal(last: InputSample): boolean {
    return this.offer(last, true);
  }

  /** How many points have been kept. */
  get length(): number {
    return this.flat.length / POINT_STRIDE;
  }

  get isEmpty(): boolean {
    return this.flat.length === 0;
  }

  /** The kept points, flat, as a copy the caller may keep. */
  points(): number[] {
    return [...this.flat];
  }

  private offer(sample: InputSample, final: boolean): boolean {
    // Read the pressure first, even for a sample about to be dropped: the
    // pen's first real reading still fills in the points before it.
    const pressure = this.pressureFor(sample.pressure);
    const n = this.flat.length;
    if (n > 0 && !final) {
      const dx = sample.x - this.flat[n - POINT_STRIDE];
      const dy = sample.y - this.flat[n - POINT_STRIDE + 1];
      const min = this.options.minDistance;
      if (dx * dx + dy * dy < min * min) return false;
    }
    this.flat.push(sample.x, sample.y, pressure);
    return true;
  }

  /**
   * The stored pressure for a raw reading. A real reading is kept (capped
   * at 1) and remembered, and the first one also replaces the fallback on
   * every point stored before it; a missing one repeats the last reading,
   * or stores the fallback until there has been one. With pressure off,
   * always the fallback.
   */
  private pressureFor(raw: number): number {
    const { pressureEnabled, fallbackPressure } = this.options;
    if (!pressureEnabled) return fallbackPressure;
    if (!(raw > 0)) return Number.isNaN(this.lastReading) ? fallbackPressure : this.lastReading;
    const reading = Math.min(raw, 1);
    if (Number.isNaN(this.lastReading)) {
      for (let p = 2; p < this.flat.length; p += POINT_STRIDE) this.flat[p] = reading;
    }
    this.lastReading = reading;
    return reading;
  }
}
