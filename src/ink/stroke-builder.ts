/**
 * Turns the samples of one pen-down into the points a stroke stores — the
 * flat `[x, y, p, …]` buffer of the file format. It keeps a sample only once
 * the pen has moved far enough from the last one kept, and decides what
 * pressure each point stores. Pure: no DOM. The pointer events (their
 * coalesced samples) are unpacked in `input/pointer-controller.ts`.
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
  /**
   * The input is sparse: fill in points between the samples kept, along a
   * curve through them, about `minDistance` apart ({@link StrokeBuilder}).
   */
  densify?: boolean;
  /**
   * The positions are rounded (whole screen px): each sample follows the pen
   * only {@link ROUNDED_FOLLOW} of the way, before anything else sees it
   * ({@link StrokeBuilder}).
   */
  smooth?: boolean;
}

const DEFAULTS: StrokeBuilderOptions = {
  minDistance: MIN_SAMPLE_DISTANCE,
  pressureEnabled: true,
  fallbackPressure: FALLBACK_PRESSURE,
  densify: false,
  smooth: false,
};

/** At most this many points are filled in between two samples. */
const MAX_FILL = 64;

/**
 * With `smooth`, how far each sample moves from the last smoothed point
 * towards where the pen reported. WebKit before iPadOS 26.2 rounds every
 * position to a whole screen px, and at 60 Hz a pen's samples are only ~4 px
 * apart, so each step's direction is off by several degrees and a stroke
 * drawn through them wobbles (FineNotes#1, read from the reporter's
 * notebook). 1.0.1 drew every stroke through perfect-freehand's streamline
 * 0.5, which moves a point 0.15 + 0.85 × 0.5 of the way: the reporter's
 * "how it used to look". Here it is a filter on the input, so a smoothed
 * point is final once made and the ink still only grows.
 */
export const ROUNDED_FOLLOW = 0.575;

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
  /**
   * Densifying: the two samples kept before the newest, `[x, y, p]`, and the
   * newest, which waits for the one after it to fix the curve's way into it.
   */
  private before: number[] | null = null;
  private last: number[] | null = null;
  private waiting: number[] | null = null;
  /** With `smooth`: where the smoothed pen is, `[x, y]`; null before the first sample. */
  private trail: [number, number] | null = null;
  /** The pen's last real pressure reading; NaN until the first arrives. */
  private lastReading = Number.NaN;
  /** Counts the times points already kept were rewritten (see {@link revision}). */
  private rewrites = 0;

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

  /** How many points have been kept (a sample still waiting counts as one). */
  get length(): number {
    return this.flat.length / POINT_STRIDE + (this.waiting ? 1 : 0);
  }

  /**
   * Densifying: the newest sample, `[x, y, p]`, not yet in {@link view}
   * because the curve into it depends on the next. Draw a straight line to
   * it meanwhile. Null when nothing waits.
   */
  get pending(): readonly number[] | null {
    return this.waiting;
  }

  /** Put the sample still waiting into the points, as the stroke's end. */
  settle(): void {
    const tip = this.waiting;
    if (!tip || !this.last) return;
    fillCurve(this.before ?? this.last, this.last, tip, tip, this.options.minDistance, this.flat);
    this.before = this.last;
    this.last = tip;
    this.waiting = null;
  }

  get isEmpty(): boolean {
    return this.flat.length === 0;
  }

  /** The kept points, flat, as a copy the caller may keep; one still waiting is the end. */
  points(): number[] {
    const out = [...this.flat];
    const tip = this.waiting;
    if (tip && this.last) {
      fillCurve(this.before ?? this.last, this.last, tip, tip, this.options.minDistance, out);
    }
    return out;
  }

  /** The kept points, flat, without a copy: read them now, keep nothing. */
  get view(): readonly number[] {
    return this.flat;
  }

  /**
   * Changes whenever points already kept are rewritten: the pen's first
   * pressure reading fills in the points before it. Whatever was drawn from
   * the old values must be drawn again.
   */
  get revision(): number {
    return this.rewrites;
  }

  /**
   * The median pressure the pen actually read over the stroke, or null if
   * it read none (or pressure is off): what the next stroke assumes until
   * its own first reading comes in.
   */
  typicalPressure(): number | null {
    if (!this.options.pressureEnabled || Number.isNaN(this.lastReading)) return null;
    const readings: number[] = [];
    for (let p = 2; p < this.flat.length; p += POINT_STRIDE) readings.push(this.flat[p]);
    if (readings.length === 0) return null;
    readings.sort((a, b) => a - b);
    const mid = readings.length >> 1;
    return readings.length % 2 === 1 ? readings[mid] : (readings[mid - 1] + readings[mid]) / 2;
  }

  private offer(raw: InputSample, final: boolean): boolean {
    // Read the pressure first, even for a sample about to be dropped: the
    // pen's first real reading still fills in the points before it.
    const pressure = this.pressureFor(raw.pressure);
    const sample = this.follow(raw, final);
    const n = this.flat.length;
    if (n > 0 && !final) {
      const from = this.waiting ?? this.last;
      const dx = sample.x - (from ? from[0] : this.flat[n - POINT_STRIDE]);
      const dy = sample.y - (from ? from[1] : this.flat[n - POINT_STRIDE + 1]);
      const min = this.options.minDistance;
      if (dx * dx + dy * dy < min * min) return false;
    }
    if (!this.options.densify) {
      this.flat.push(sample.x, sample.y, pressure);
      return true;
    }
    const next = [sample.x, sample.y, pressure];
    if (!this.last) {
      this.flat.push(sample.x, sample.y, pressure);
      this.last = next;
    } else if (!this.waiting) {
      this.waiting = next;
    } else {
      // The sample after it fixes the curve into the one waiting: fill that in.
      const minDistance = this.options.minDistance;
      fillCurve(this.before ?? this.last, this.last, this.waiting, next, minDistance, this.flat);
      this.before = this.last;
      this.last = this.waiting;
      this.waiting = next;
    }
    if (final) this.settle();
    return true;
  }

  /**
   * With `smooth`, the sample moved {@link ROUNDED_FOLLOW} of the way from the
   * last smoothed point; every sample counts, dropped or kept. The first
   * sample and the pen-up are taken as they are: the stroke starts and ends
   * where the pen touched and lifted.
   */
  private follow(sample: InputSample, final: boolean): InputSample {
    if (!this.options.smooth) return sample;
    const trail = this.trail;
    if (!trail || final) {
      this.trail = [sample.x, sample.y];
      return sample;
    }
    trail[0] += (sample.x - trail[0]) * ROUNDED_FOLLOW;
    trail[1] += (sample.y - trail[1]) * ROUNDED_FOLLOW;
    return { x: trail[0], y: trail[1], pressure: sample.pressure };
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
    if (Number.isNaN(this.lastReading) && this.flat.length > 0) {
      for (let p = 2; p < this.flat.length; p += POINT_STRIDE) this.flat[p] = reading;
      for (const kept of [this.before, this.last, this.waiting]) if (kept) kept[2] = reading;
      this.rewrites++;
    }
    this.lastReading = reading;
    return reading;
  }
}

/**
 * Append the points of the centripetal Catmull-Rom curve from `b` to `c`
 * (`[x, y, p]` each), shaped by `a` before and `d` after, about `spacing`
 * apart and ending exactly on `c`; pressure runs straight from `b` to `c`.
 *
 * Where WebKit has no `getCoalescedEvents` (iPadOS before 18.2), a pen
 * arrives once a frame: at 60 Hz a quick letter is a few samples 5-15 px
 * apart, and the ink tracer's midpoint curves cut its corners and show its
 * jitter. Filling the samples in along a curve through them gives the
 * tracer what a Pencil reports at 240 Hz (FineNotes#1). Centripetal, because
 * that form never loops or overshoots between two samples. The points are
 * stored, so the stroke looks the same on every device.
 */
export function fillCurve(
  a: readonly number[],
  b: readonly number[],
  c: readonly number[],
  d: readonly number[],
  spacing: number,
  out: number[],
): void {
  const span = Math.hypot(c[0] - b[0], c[1] - b[1]);
  const n = Math.min(MAX_FILL, Math.max(1, Math.ceil(span / Math.max(spacing, 1e-6))));
  // A missing neighbour (at the stroke's ends) is the mirror of the far point.
  const p0 = Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-6 ? a : [2 * b[0] - c[0], 2 * b[1] - c[1]];
  const p3 = Math.hypot(d[0] - c[0], d[1] - c[1]) > 1e-6 ? d : [2 * c[0] - b[0], 2 * c[1] - b[1]];
  const t1 = Math.sqrt(Math.hypot(b[0] - p0[0], b[1] - p0[1]));
  const t2 = t1 + Math.sqrt(span);
  const t3 = t2 + Math.sqrt(Math.hypot(p3[0] - c[0], p3[1] - c[1]));
  for (let i = 1; i < n && span > 1e-6; i++) {
    const t = t1 + ((t2 - t1) * i) / n;
    const at = (k: number): number => {
      const a1 = ((t1 - t) / t1) * p0[k] + (t / t1) * b[k];
      const a2 = ((t2 - t) / (t2 - t1)) * b[k] + ((t - t1) / (t2 - t1)) * c[k];
      const a3 = ((t3 - t) / (t3 - t2)) * c[k] + ((t - t2) / (t3 - t2)) * p3[k];
      const b1 = ((t2 - t) / t2) * a1 + (t / t2) * a2;
      const b2 = ((t3 - t) / (t3 - t1)) * a2 + ((t - t1) / (t3 - t1)) * a3;
      return ((t2 - t) / (t2 - t1)) * b1 + ((t - t1) / (t2 - t1)) * b2;
    };
    out.push(at(0), at(1), b[2] + ((c[2] - b[2]) * i) / n);
  }
  out.push(c[0], c[1], c[2]);
}
