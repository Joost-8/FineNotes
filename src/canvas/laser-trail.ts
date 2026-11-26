/**
 * The laser pointer's neon trail (FineNotes#25): a glowing multi-stroke beam
 * for pointing at a page while presenting or explaining. It is never part of
 * the notebook: nothing here reaches the document, the history or a save.
 *
 * Points are kept in layout space, so the trail stays on the ink it points at
 * while the page scrolls under it. In sustain mode (default), strokes stay 100%
 * solid while writing and across quick consecutive strokes, hold for
 * {@link LASER_HOLD_MS}, then fade out together over {@link LASER_FADE_MS}.
 * With sustain off, old points fade continuously behind the pen.
 *
 * When the laser pointer is chosen from a pen's submenu, each stroke carries
 * that pen's own {@link PenOptions} and `StrokeBuilder` points/tilts so
 * `ink/freehand.ts` renders the exact pen geometry with zero duplicated math.
 *
 * Pure: no DOM, no Obsidian.
 */

import type { PenOptions } from "../ink/freehand";
import { StrokeBuilder, type InputSample, type StrokeBuilderOptions } from "../ink/stroke-builder";

/** How long drawn laser strokes stay 100% solid after lifting the pen, ms. */
export const LASER_HOLD_MS = 1000;

/** How long the laser strokes take to fade away after the hold window, ms. */
export const LASER_FADE_MS = 650;

/** The trail's colour: vivid neon red laser. */
export const LASER_COLOR = "#ff3b30";

/** Default laser white-core width (screen px) when entered via `L` or Presentation mode. */
export const LASER_WIDTH_PX = 2.4;

/** Outer glow blur radius (screen px) for the Gaussian neon aura. */
export const LASER_GLOW_PX = 16;

/** Hard cap on retained points across all active strokes so Hold never grows unboundedly. */
export const MAX_LASER_POINTS = 2500;

export interface LaserPoint {
  x: number;
  y: number;
  /** When it was drawn, ms. */
  t: number;
  /** Stylus pressure in 0..1 when inherited from a pen. */
  p?: number;
  /** Stylus altitude in degrees when inherited from a tilt-enabled pen. */
  a?: number;
}

/** One continuous laser stroke together with the pen options it was drawn with (or null for default). */
export interface LaserStroke {
  points: LaserPoint[];
  /** Flat `[x, y, p, ...]` from `StrokeBuilder` when inherited from a pen. */
  flat?: number[];
  /** Per-point stylus altitudes from `StrokeBuilder.tilts()` when brush tilt is active. */
  tilts?: number[];
  /** Pen options from `penOptions(...)` when opened from a pen submenu; null for default beam. */
  pen: PenOptions | null;
}

/** Snapshot of all currently visible neon laser strokes and their fade mode. */
export interface LaserFrame {
  strokes: readonly LaserStroke[];
  alpha: number;
  /** Active stylus tip while touching the screen (used to paint a glowing dot even when stationary). */
  tip: { point: LaserPoint; pen: PenOptions | null } | null;
  /** True when holding strokes solid before a unified fade; false when fading continuously behind the pen. */
  sustain: boolean;
  /** Current timestamp in ms (used for per-point fading when `sustain` is false). */
  now: number;
  /** Monotonic revision of the visible geometry/tip so stationary hold/fade can skip repaints. */
  version: number;
}

export class LaserTrail {
  private strokes: LaserStroke[] = [];
  /** The pen is currently down: everything stays 100% solid in sustain mode. */
  private down = false;
  /** Timestamp of the most recent pen lift, or null while drawing/empty. */
  private liftedAt: number | null = null;
  /** Incremented whenever strokes or tip change. */
  private rev = 0;

  /** The pen came down at `p`: starts a new stroke and keeps any visible strokes solid. */
  start(p: LaserPoint, pen: PenOptions | null = null): void {
    this.prune(p.t);
    this.down = true;
    this.liftedAt = null;
    this.strokes.push({ points: [p], pen });
    this.trimToCap();
    this.rev++;
  }

  add(p: LaserPoint): void {
    if (!this.down || this.strokes.length === 0) return;
    const current = this.strokes[this.strokes.length - 1].points;
    const last = current[current.length - 1];
    // Skip duplicate coordinates so quadratic smoothing never collapses on zero-length spans.
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.5) return;
    current.push(p);
    this.trimToCap();
    this.rev++;
  }

  /**
   * Replaces the active stroke's points with the settled `StrokeBuilder`
   * output (`flat` + optional `tilts`), keeping its pen options intact.
   */
  replaceCurrent(
    points: readonly LaserPoint[],
    flat?: readonly number[],
    tilts?: readonly number[] | null,
  ): void {
    if (!this.down || this.strokes.length === 0 || points.length === 0) return;
    const stroke = this.strokes[this.strokes.length - 1];
    stroke.points = [...points];
    stroke.flat = flat ? [...flat] : undefined;
    stroke.tilts = tilts && tilts.length === points.length ? [...tilts] : undefined;
    this.trimToCap();
    this.rev++;
  }

  /** The pen lifted at time `t`: hold solid for {@link LASER_HOLD_MS}, then fade out. */
  end(t: number): void {
    if (!this.down) return;
    this.down = false;
    this.liftedAt = t;
    this.rev++;
  }

  /** Current unified opacity (0–1) for all strokes at time `t` in sustain mode. */
  alpha(t: number): number {
    if (this.strokes.length === 0) return 0;
    if (this.down || this.liftedAt === null) return 1;
    const sinceLift = t - this.liftedAt;
    if (sinceLift <= LASER_HOLD_MS) return 1;
    return fade(sinceLift - LASER_HOLD_MS);
  }

  /** Complete strokes and live tip for neon rendering at time `t`. */
  activeStrokes(t: number, sustain = true): LaserFrame {
    if (sustain) this.prune(t);
    else this.pruneContinuous(t);
    const a = sustain ? this.alpha(t) : this.strokes.length > 0 ? 1 : 0;
    if (!(a > 0) || this.strokes.length === 0) {
      return { strokes: [], alpha: 0, tip: null, sustain, now: t, version: this.rev };
    }
    const lastStroke = this.strokes[this.strokes.length - 1];
    const tipPoint =
      this.down && lastStroke.points.length > 0
        ? lastStroke.points[lastStroke.points.length - 1]
        : null;
    return {
      strokes: this.strokes,
      alpha: a,
      tip: tipPoint ? { point: tipPoint, pen: lastStroke.pen } : null,
      sustain,
      now: t,
      version: this.rev,
    };
  }

  clear(): void {
    this.strokes = [];
    this.down = false;
    this.liftedAt = null;
    this.rev++;
  }

  /** Drop oldest points/strokes when total retained points exceed {@link MAX_LASER_POINTS}. */
  private trimToCap(): void {
    let total = 0;
    for (const stroke of this.strokes) total += stroke.points.length;
    if (total <= MAX_LASER_POINTS) return;
    let excess = total - MAX_LASER_POINTS;
    while (excess > 0 && this.strokes.length > 1) {
      const oldest = this.strokes[0];
      if (oldest.points.length <= excess) {
        excess -= oldest.points.length;
        this.strokes.shift();
      } else {
        this.trimStrokeHead(oldest, excess);
        excess = 0;
      }
    }
    if (excess > 0 && this.strokes.length === 1) {
      const only = this.strokes[0];
      const drop = Math.min(excess, Math.max(0, only.points.length - 2));
      if (drop > 0) this.trimStrokeHead(only, drop);
    }
  }

  private trimStrokeHead(stroke: LaserStroke, drop: number): void {
    stroke.points = stroke.points.slice(drop);
    if (stroke.flat) stroke.flat = stroke.flat.slice(drop * 3);
    if (stroke.tilts) stroke.tilts = stroke.tilts.slice(drop);
  }

  /** Drop all strokes once the post-lift hold + fade has finished. */
  private prune(t: number): void {
    if (!this.down && this.liftedAt !== null && this.alpha(t) <= 0) {
      this.strokes = [];
      this.liftedAt = null;
      this.rev++;
    }
  }

  /** Continuous-fade pruning: drop aged-out points/strokes individually behind the pen. */
  private pruneContinuous(t: number): void {
    const next: LaserStroke[] = [];
    let changed = false;
    for (let s = 0; s < this.strokes.length; s++) {
      const stroke = this.strokes[s];
      const isCurrent = this.down && s === this.strokes.length - 1;
      const pts = stroke.points;
      let keep = 0;
      while (keep < pts.length - 1 && fade(t - pts[keep + 1].t) <= 0) keep++;
      const trimmed = keep > 0 ? pts.slice(keep) : pts;
      const alive =
        isCurrent ||
        (trimmed.length > 1 && fade(t - trimmed[trimmed.length - 1].t) > 0) ||
        (trimmed.length === 1 && fade(t - trimmed[0].t) > 0);
      if (alive) {
        if (keep > 0) {
          this.trimStrokeHead(stroke, keep);
          changed = true;
        }
        next.push(stroke);
      } else {
        changed = true;
      }
    }
    if (changed) {
      this.strokes = next;
      if (next.length === 0 && !this.down) this.liftedAt = null;
      this.rev++;
    }
  }
}

export interface LaserPenSnapshot {
  pen: PenOptions;
  builderOpts: StrokeBuilderOptions;
}

/**
 * Coordinates a {@link LaserTrail} with an optional live {@link StrokeBuilder}
 * (when opened from a pen submenu), preserving original arrival timestamps
 * through continuous-fade pruning and rolling over the builder on long strokes
 * so both memory and per-move work stay strictly bounded.
 */
export class LaserSession {
  readonly trail = new LaserTrail();
  private penSnapshot: LaserPenSnapshot | null = null;
  private builder: StrokeBuilder | null = null;
  private times: number[] = [];
  private lastSampleAt = 0;

  setPen(snapshot: LaserPenSnapshot | null): void {
    this.penSnapshot = snapshot;
  }

  down(sample: InputSample, t: number, sustain: boolean): void {
    const snap = this.penSnapshot;
    this.builder = snap ? new StrokeBuilder(snap.builderOpts) : null;
    this.times = [];
    this.lastSampleAt = t;
    this.builder?.add({ ...sample, t });
    this.trail.start(
      { x: sample.x, y: sample.y, t, p: snap ? sample.pressure || undefined : undefined },
      snap?.pen ?? null,
    );
    if (snap) this.syncBuilder(t, t, sustain, false);
  }

  move(samples: readonly InputSample[], t: number, sustain: boolean): void {
    if (this.builder) {
      let accepted = false;
      for (const sample of samples) {
        if (this.builder.add({ ...sample, t })) accepted = true;
      }
      if (!accepted) return;
      this.lastSampleAt = t;
      this.syncBuilder(t, t, sustain, false);
    } else {
      for (const sample of samples) this.trail.add({ x: sample.x, y: sample.y, t });
    }
  }

  up(t: number, sustain: boolean): void {
    if (this.builder) {
      // Any tail points flushed by settle() arrived at lastSampleAt, not at a delayed lift.
      this.syncBuilder(t, this.lastSampleAt, sustain, true);
      this.builder = null;
      this.times = [];
    }
    this.trail.end(t);
  }

  clear(): void {
    this.builder = null;
    this.times = [];
    this.trail.clear();
  }

  private syncBuilder(nowMs: number, sampleTime: number, sustain: boolean, final: boolean): void {
    const builder = this.builder;
    if (!builder) return;
    if (final) builder.settle();
    const { points, flat, tilts } = syncLaserStream(
      builder.view,
      builder.tiltView,
      final ? [] : builder.tail,
      this.times,
      nowMs,
      sustain,
      sampleTime,
    );
    if (points.length > 0) this.trail.replaceCurrent(points, flat, tilts);
    // Bound StrokeBuilder memory on very long strokes by rolling over to a fresh builder.
    if (!final && builder.view.length > MAX_LASER_POINTS * 6 && this.penSnapshot) {
      const last = points[points.length - 1];
      if (last) {
        this.builder = new StrokeBuilder(this.penSnapshot.builderOpts);
        this.times = [last.t];
        this.builder.add({
          x: last.x,
          y: last.y,
          pressure: last.p ?? 0.5,
          altitude: last.a,
          t: last.t,
        });
        this.trail.start(last, this.penSnapshot.pen);
      }
    }
  }
}

/**
 * Incrementally converts a live `StrokeBuilder`'s zero-copy `view`, `tiltView`,
 * and provisional `tail` into bounded `LaserPoint`s + `flat`/`tilts` buffers.
 *
 * Keeps original arrival timestamps in `times` (never shifted by trail pruning)
 * so pausing in continuous-fade mode and lifting later can NEVER revive expired
 * marks, and slices only the live tail within {@link MAX_LASER_POINTS} so
 * builder sync work stays strictly bounded.
 */
export function syncLaserStream(
  view: readonly number[],
  tiltView: readonly number[],
  tail: readonly (readonly number[])[],
  times: number[],
  nowMs: number,
  sustain: boolean,
  sampleTime = nowMs,
): { points: LaserPoint[]; flat: number[]; tilts: number[] | null } {
  const settledCount = Math.floor(view.length / 3);
  const totalCount = settledCount + tail.length;
  if (totalCount === 0) return { points: [], flat: [], tilts: null };

  // Keep arrival timestamps aligned with both settled points and provisional tail entries.
  while (times.length < totalCount) times.push(sampleTime);
  if (times.length > totalCount) times.length = totalCount;

  // Bound work to the newest MAX_LASER_POINTS samples.
  let start = Math.max(0, totalCount - MAX_LASER_POINTS);

  // In continuous-fade mode, skip points whose true arrival timestamp already expired
  // (keeping one lead-in point if the next point is still visible, matching pruneContinuous).
  if (!sustain) {
    while (start < totalCount - 1 && fade(nowMs - times[start + 1]) <= 0) start++;
    if (start === totalCount - 1 && fade(nowMs - times[start]) <= 0) {
      return { points: [], flat: [], tilts: null };
    }
  }

  const hasTilts = tiltView.length >= settledCount && settledCount > 0;
  const points: LaserPoint[] = [];
  const flat: number[] = [];
  const tilts: number[] | null = hasTilts ? [] : null;

  for (let i = start; i < totalCount; i++) {
    let x: number;
    let y: number;
    let p: number;
    const t = times[i];
    let a: number | undefined;
    if (i < settledCount) {
      x = view[i * 3];
      y = view[i * 3 + 1];
      p = view[i * 3 + 2];
      a = hasTilts ? tiltView[i] : undefined;
    } else {
      const sample = tail[i - settledCount];
      x = sample[0];
      y = sample[1];
      p = sample[2];
      a = hasTilts ? sample[3] : undefined;
    }
    const validTilt = a !== undefined && Number.isFinite(a);
    points.push(validTilt ? { x, y, t, p, a } : { x, y, t, p });
    flat.push(x, y, p);
    if (tilts) tilts.push(validTilt ? (a as number) : Number.NaN);
  }
  return { points, flat, tilts };
}

/** Smooth ease-out fade from 1 to 0 over {@link LASER_FADE_MS}. */
export function fade(age: number): number {
  if (age <= 0) return 1;
  if (age >= LASER_FADE_MS) return 0;
  const left = 1 - age / LASER_FADE_MS;
  return left * left;
}
