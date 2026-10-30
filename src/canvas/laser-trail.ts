/**
 * The laser pointer's trail (FineNotes#25, GoodNotes' laser): a glowing line
 * behind the pen that fades as it ages, for pointing at a page while
 * presenting or explaining. It is never part of the notebook: nothing here
 * reaches the document, the history or a save.
 *
 * Points are kept in layout space, so the trail stays on the ink it points
 * at while the page scrolls under it, and each one fades out
 * {@link LASER_FADE_MS} after it was drawn. A pen held still keeps its dot
 * at full strength until it lifts.
 *
 * Pure: no DOM, no Obsidian.
 */

/** How long a point of the trail takes to fade away, ms. */
export const LASER_FADE_MS = 650;

/** The trail's colour: GoodNotes' red laser. */
export const LASER_COLOR = "#ff3b30";

/** The trail's core width, and its glow's blur radius, in screen px. */
export const LASER_WIDTH_PX = 4;
export const LASER_GLOW_PX = 10;

export interface LaserPoint {
  x: number;
  y: number;
  /** When it was drawn, ms. */
  t: number;
}

/** One piece of the trail to draw: from `a` to `b`, at `alpha` (0–1). */
export interface LaserSegment {
  a: LaserPoint;
  b: LaserPoint;
  alpha: number;
}

export interface LaserDot {
  point: LaserPoint;
  alpha: number;
}

/** Base distance at the maximum frequency, in page CSS pixels. */
const LASER_DOT_BASE_SPACING_PX = 300;

/**
 * Points to draw along the beam. Frequency 3 spaces dots by 100 CSS pixels;
 * zero is deliberately empty, while larger values reduce the spacing.
 */
export function laserDots(segments: readonly LaserSegment[], frequency: number): LaserDot[] {
  if (!Number.isFinite(frequency) || frequency <= 0) return [];
  const spacing = LASER_DOT_BASE_SPACING_PX / frequency;
  const dots: LaserDot[] = [];
  let distanceSinceDot = 0;
  for (const { a, b, alpha } of segments) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length <= 0) continue;
    let distance = spacing - distanceSinceDot;
    while (distance < length) {
      const ratio = distance / length;
      dots.push({
        point: {
          x: a.x + dx * ratio,
          y: a.y + dy * ratio,
          t: a.t + (b.t - a.t) * ratio,
        },
        alpha,
      });
      distance += spacing;
    }
    distanceSinceDot = (distanceSinceDot + length) % spacing;
  }
  return dots;
}

export class LaserTrail {
  private points: LaserPoint[] = [];
  /** The pen is down: its last point does not fade. */
  private down = false;

  /** The pen came down at `p`: a new trail begins, the old one fading on. */
  start(p: LaserPoint): void {
    this.down = true;
    // A break between the old trail and the new: a point that joins nothing.
    this.points.push({ x: NaN, y: NaN, t: p.t }, p);
  }

  add(p: LaserPoint): void {
    if (this.down) this.points.push(p);
  }

  /** The pen lifted at time `t`: from now the tip fades like the rest. */
  end(t: number): void {
    if (!this.down) return;
    this.down = false;
    const last = this.points[this.points.length - 1];
    // The tip starts fading at the lift, not when it was first drawn.
    if (last && Number.isFinite(last.x)) this.points.push({ ...last, t });
  }

  /** Whether anything is left to draw at time `t` (the frame loop keeps going while so). */
  visible(t: number): boolean {
    this.prune(t);
    return this.down || this.points.some((p) => Number.isFinite(p.x));
  }

  /** The tip, while the pen is down: drawn as a dot so a pen held still still shows. */
  tip(): LaserPoint | null {
    const last = this.points[this.points.length - 1];
    return this.down && last && Number.isFinite(last.x) ? last : null;
  }

  /** The pieces to draw at time `t`, oldest first, each as strong as its newer end is young. */
  segments(t: number): LaserSegment[] {
    this.prune(t);
    const out: LaserSegment[] = [];
    for (let i = 1; i < this.points.length; i++) {
      const a = this.points[i - 1];
      const b = this.points[i];
      if (!Number.isFinite(a.x) || !Number.isFinite(b.x)) continue;
      const alpha = fade(t - b.t);
      if (alpha > 0) out.push({ a, b, alpha });
    }
    return out;
  }

  clear(): void {
    this.points = [];
    this.down = false;
  }

  /** Drop the points that have faded and lead nowhere still visible. */
  private prune(t: number): void {
    let keep = 0;
    // Keep one faded point before the first visible one, as the start of its segment.
    while (keep < this.points.length - 1 && fade(t - this.points[keep + 1].t) <= 0) keep++;
    if (keep > 0) this.points = this.points.slice(keep);
    if (!this.down && this.points.length === 1) this.points = [];
  }
}

/** How strong a point `age` ms old is: full, then down to nothing at {@link LASER_FADE_MS}. */
export function fade(age: number): number {
  if (age <= 0) return 1;
  if (age >= LASER_FADE_MS) return 0;
  const left = 1 - age / LASER_FADE_MS;
  return left * left;
}
