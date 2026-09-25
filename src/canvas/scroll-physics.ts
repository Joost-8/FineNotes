/**
 * Kinetic scrolling and rubber-banding, the way UIScrollView does it. Pure:
 * no DOM and no timers. The surface feeds it finger positions and frame
 * timestamps and reads the position back.
 *
 * Why this exists at all: native scrolling is switched off on the drawing
 * surface (`touch-action: none`), because iOS WebKit otherwise claims a pen
 * drag as a scroll and cuts the stroke short. Everything the platform would
 * have done for free — coasting after a flick, stretching at the edges and
 * springing back, locking to one axis — has to be rebuilt here. The numbers
 * are Apple's where they are documented (deceleration rate, rubber-band
 * coefficient) and tuned by feel where they are not.
 *
 * Units: positions and velocities are CSS px and px/ms; time is ms. A
 * position is where the content's top-left sits relative to the viewport,
 * as `scrollTop`/`scrollLeft` would report it, so a finger moving right makes
 * `x` go down.
 */

export interface Vec2 {
  x: number;
  y: number;
}

/** UIScrollView's "normal" deceleration rate, applied per millisecond. */
export const DECELERATION_RATE = 0.998;
/** Apple's rubber-band coefficient. */
export const RUBBER_BAND_COEFFICIENT = 0.55;
/** Below this release speed (px/ms) the content simply stops. */
export const MIN_FLING_SPEED = 0.05;
/** Below this speed a fling has come to rest. */
export const REST_SPEED = 0.005;
/** Finger travel (px) before a drag decides whether it locks to an axis. */
export const AXIS_LOCK_DISTANCE = 8;
/** A drag starting within this many degrees of an axis locks to it. */
export const AXIS_LOCK_DEGREES = 30;
/** The return spring is critically damped; this is its angular frequency, rad/ms. */
export const SPRING_OMEGA = 0.018;
/** Samples older than this (ms) before the last one do not count toward release velocity. */
export const VELOCITY_WINDOW_MS = 100;
/** A finger that rested this long before lifting releases with no velocity. */
export const VELOCITY_STALE_MS = 60;
/** Frame gaps longer than this are clamped, so a stalled tab does not teleport. */
export const MAX_STEP_MS = 64;
/** How far, in log units, a pinch may stretch past its zoom limits: ln(1.6). */
export const ZOOM_STRETCH = Math.log(1.6);
/**
 * How long a page jump glides, whatever the distance. GoodNotes, measured
 * frame by frame (research/goodnotes-smoothness): one page and seven pages
 * both took ≈450 ms, easing out.
 */
export const GLIDE_MS = 450;

/**
 * Apple's rubber-band curve: the further the content is dragged past an
 * edge, the less of each extra pixel shows, and it never shows more than
 * `dimension` (the viewport size on that axis). Signed.
 */
export function rubberBand(
  overscroll: number,
  dimension: number,
  coefficient = RUBBER_BAND_COEFFICIENT,
): number {
  if (overscroll === 0 || !(dimension > 0)) return 0;
  const x = Math.abs(overscroll);
  const y = (1 - 1 / ((x * coefficient) / dimension + 1)) * dimension;
  return overscroll < 0 ? -y : y;
}

/** The finger travel that would have produced a displayed stretch of `displayed`. */
export function rubberBandInverse(
  displayed: number,
  dimension: number,
  coefficient = RUBBER_BAND_COEFFICIENT,
): number {
  if (displayed === 0 || !(dimension > 0)) return 0;
  const y = Math.min(Math.abs(displayed), dimension * 0.999);
  const x = (dimension / coefficient) * (y / (dimension - y));
  return displayed < 0 ? -x : x;
}

/** How far a fling at `velocity` px/ms travels before it rests. */
export function flingDistance(velocity: number, rate = DECELERATION_RATE): number {
  return -velocity / Math.log(rate);
}

/**
 * A pinch past the zoom limits stretches a little and springs back, as it
 * does on iOS. The stretch is rubber-banded in log space so it feels the
 * same at every zoom level.
 */
export function softZoom(raw: number, min: number, max: number): number {
  if (!(raw > 0)) return min;
  if (raw < min) return min * Math.exp(-rubberBand(Math.log(min / raw), ZOOM_STRETCH));
  if (raw > max) return max * Math.exp(rubberBand(Math.log(raw / max), ZOOM_STRETCH));
  return raw;
}

export function easeOutCubic(progress: number): number {
  const q = 1 - Math.min(1, Math.max(0, progress));
  return 1 - q * q * q;
}

/**
 * Release velocity from the last few finger positions. Only the samples of
 * the last {@link VELOCITY_WINDOW_MS} count, and a finger that paused before
 * lifting releases with none — that pause is how a user stops a scroll dead.
 */
export class VelocityTracker {
  private readonly samples: Array<{ t: number; x: number; y: number }> = [];

  reset(): void {
    this.samples.length = 0;
  }

  add(t: number, x: number, y: number): void {
    this.samples.push({ t, x, y });
    while (this.samples.length > 1 && this.samples[0].t < t - VELOCITY_WINDOW_MS) {
      this.samples.shift();
    }
  }

  velocity(t: number): Vec2 {
    const n = this.samples.length;
    if (n < 2) return { x: 0, y: 0 };
    const last = this.samples[n - 1];
    if (t - last.t > VELOCITY_STALE_MS) return { x: 0, y: 0 };
    const first = this.samples[0];
    const dt = last.t - first.t;
    if (dt <= 0) return { x: 0, y: 0 };
    return { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt };
  }
}

export interface ScrollExtent {
  contentWidth: number;
  contentHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  /**
   * Extra room to scroll before the content's left edge and past its right
   * edge, px — so a horizontal notebook can centre its first and last page.
   * `x` then runs from `-leadX` to `contentWidth - viewportWidth + trailX`.
   */
  leadX?: number;
  trailX?: number;
  /** Stretch sideways even when nothing is wider than the pane (a one-page row). */
  alwaysBounceX?: boolean;
  /**
   * An explicit `x` range, overriding the one the content implies: a
   * zoomed-in row of pages is held to the page being read. Past it the
   * content still stretches and springs back.
   */
  rangeX?: { min: number; max: number };
}

export type AxisLock = "undecided" | "x" | "y" | "free";

interface Drag {
  /** Where the finger went down. */
  originX: number;
  originY: number;
  /** Un-rubber-banded content position at the start of the drag. */
  baseX: number;
  baseY: number;
  lock: AxisLock;
}

interface AxisStep {
  p: number;
  v: number;
  done: boolean;
}

/** A {@link KineticScroller.glideTo} in progress. */
interface Glide {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  t0: number;
  duration: number;
}

/**
 * The content's position under one finger (or a pinch midpoint) and after
 * it lets go. One instance per surface; the surface calls `step` once per
 * animation frame while {@link isAnimating}.
 */
export class KineticScroller {
  private x = 0;
  private y = 0;
  private minX = 0;
  private maxX = 0;
  private minY = 0;
  private maxY = 0;
  private viewW = 1;
  private viewH = 1;
  /** Content wider than the viewport: it can scroll and stretch sideways. */
  private bounceX = false;
  /** Vertical always stretches, as GoodNotes does even on a one-page note. */
  private readonly bounceY = true;
  private drag: Drag | null = null;
  private vx = 0;
  private vy = 0;
  /** Where a {@link snapTo} is carrying each axis; `null` = free. */
  private targetX: number | null = null;
  private targetY: number | null = null;
  /** A fixed-length glide ({@link glideTo}); takes precedence over everything but a drag. */
  private glide: Glide | null = null;
  private animating = false;
  private lastStepT = -1;
  private readonly tracker = new VelocityTracker();

  get position(): Vec2 {
    return { x: this.x, y: this.y };
  }

  get velocity(): Vec2 {
    return { x: this.vx, y: this.vy };
  }

  get isDragging(): boolean {
    return this.drag !== null;
  }

  get isAnimating(): boolean {
    return this.animating;
  }

  get axisLock(): AxisLock {
    return this.drag?.lock ?? "undecided";
  }

  /** Whether the content is currently stretched past an edge. */
  get isOverscrolled(): boolean {
    return this.x < this.minX || this.x > this.maxX || this.y < this.minY || this.y > this.maxY;
  }

  /**
   * How far the content is stretched past its far end on each axis — past
   * the last page — in px; 0 when it is not. What "pull to add a page" reads.
   */
  get overscrollEnd(): Vec2 {
    return { x: Math.max(0, this.x - this.maxX), y: Math.max(0, this.y - this.maxY) };
  }

  /** The scroll range, for callers that aim a {@link snapTo}. */
  get bounds(): { minX: number; maxX: number; minY: number; maxY: number } {
    return { minX: this.minX, maxX: this.maxX, minY: this.minY, maxY: this.maxY };
  }

  /** Content and viewport sizes changed (zoom, resize, a page added). */
  setExtent(extent: ScrollExtent): void {
    this.viewW = Math.max(1, extent.viewportWidth);
    this.viewH = Math.max(1, extent.viewportHeight);
    const lead = Math.max(0, extent.leadX ?? 0);
    const trail = Math.max(0, extent.trailX ?? 0);
    this.minX = lead > 0 ? -lead : 0;
    this.maxX = Math.max(this.minX, extent.contentWidth - extent.viewportWidth + trail);
    const range = extent.rangeX;
    if (range && Number.isFinite(range.min) && Number.isFinite(range.max)) {
      this.minX = range.min;
      this.maxX = Math.max(range.min, range.max);
    }
    this.maxY = Math.max(0, extent.contentHeight - extent.viewportHeight);
    this.bounceX =
      extent.alwaysBounceX === true ||
      extent.contentWidth + lead + trail > extent.viewportWidth + 0.5;
    if (this.targetX !== null) this.targetX = clamp(this.targetX, this.minX, this.maxX);
    if (this.targetY !== null) this.targetY = clamp(this.targetY, this.minY, this.maxY);
    if (this.glide) {
      this.glide.toX = clamp(this.glide.toX, this.minX, this.maxX);
      this.glide.toY = clamp(this.glide.toY, this.minY, this.maxY);
    }
    // Nobody is holding it and nothing is moving it: it must sit in bounds.
    if (!this.drag && !this.animating) {
      this.x = clamp(this.x, this.minX, this.maxX);
      this.y = clamp(this.y, this.minY, this.maxY);
    }
  }

  /** Jump to a position (clamped). Cancels any fling. */
  setPosition(x: number, y: number): void {
    this.stop();
    this.x = clamp(x, this.minX, this.maxX);
    this.y = clamp(y, this.minY, this.maxY);
  }

  scrollBy(dx: number, dy: number): void {
    this.setPosition(this.x + dx, this.y + dy);
  }

  /**
   * Shift the content without disturbing a gesture or fling in progress —
   * how a zoom keeps the point under the fingers fixed mid-pinch.
   */
  nudge(dx: number, dy: number): void {
    this.x += dx;
    this.y += dy;
    if (this.glide) {
      // A zoom mid-glide keeps its anchor still: the glide's whole path moves with it.
      this.glide.fromX += dx;
      this.glide.fromY += dy;
      this.glide.toX = clamp(this.glide.toX + dx, this.minX, this.maxX);
      this.glide.toY = clamp(this.glide.toY + dy, this.minY, this.maxY);
    }
    if (this.drag) {
      this.drag.baseX += dx;
      this.drag.baseY += dy;
    } else if (!this.animating) {
      this.x = clamp(this.x, this.minX, this.maxX);
      this.y = clamp(this.y, this.minY, this.maxY);
    }
  }

  /** Cancel any fling. The position stays where it is. */
  stop(): void {
    this.animating = false;
    this.vx = 0;
    this.vy = 0;
    this.targetX = null;
    this.targetY = null;
    this.glide = null;
  }

  /**
   * Carry the content to a position (clamped) in exactly `durationMs`,
   * easing out, whatever the distance — how a page jump glides. Unlike
   * {@link snapTo} it starts from rest and its length does not grow with the
   * distance: a jump across seven pages takes as long as one to the next.
   * `t` is the timestamp the glide starts at, on the clock `step` is fed.
   */
  glideTo(x: number, y: number, t: number, durationMs = GLIDE_MS): void {
    if (this.drag) return;
    this.stop();
    const toX = clamp(x, this.minX, this.maxX);
    const toY = clamp(y, this.minY, this.maxY);
    if (Math.hypot(toX - this.x, toY - this.y) < 0.5 || !(durationMs > 0)) {
      this.x = toX;
      this.y = toY;
      return;
    }
    this.glide = { fromX: this.x, fromY: this.y, toX, toY, t0: t, duration: durationMs };
    this.animating = true;
    this.lastStepT = t;
  }

  /** Whether a {@link glideTo} is carrying the content. */
  get isGliding(): boolean {
    return this.glide !== null;
  }

  /**
   * Where a glide in progress will come to rest, or `null` with none — so a
   * repeated step (an arrow key held down) adds to where the last one is
   * going rather than to where the content happens to be mid-way.
   */
  get glideTarget(): Vec2 | null {
    return this.glide ? { x: this.glide.toX, y: this.glide.toY } : null;
  }

  /**
   * Carry the content to a position (clamped) on a critically damped spring,
   * starting from the current velocity — how a page swipe settles on a page,
   * and how "go to page" glides there. `null` leaves that axis free.
   */
  snapTo(x: number | null, y: number | null, t?: number): void {
    if (this.drag) return;
    this.glide = null;
    this.targetX = x === null ? null : clamp(x, this.minX, this.maxX);
    this.targetY = y === null ? null : clamp(y, this.minY, this.maxY);
    if (this.targetX === null && this.targetY === null) return;
    this.animating = true;
    if (t !== undefined) this.lastStepT = t;
  }

  /** Drop the drag and any fling and settle into bounds (a pen landed). */
  cancel(): void {
    this.drag = null;
    this.stop();
    this.x = clamp(this.x, this.minX, this.maxX);
    this.y = clamp(this.y, this.minY, this.maxY);
  }

  dragStart(fingerX: number, fingerY: number, t: number): void {
    // Touching the screen stops a fling dead, as it does on iOS.
    this.stop();
    this.drag = {
      originX: fingerX,
      originY: fingerY,
      baseX: this.rawFromDisplayed(this.x, this.minX, this.maxX, this.viewW, this.bounceX),
      baseY: this.rawFromDisplayed(this.y, this.minY, this.maxY, this.viewH, this.bounceY),
      lock: "undecided",
    };
    this.tracker.reset();
    this.tracker.add(t, fingerX, fingerY);
  }

  dragMove(fingerX: number, fingerY: number, t: number): void {
    const drag = this.drag;
    if (!drag) return;
    this.tracker.add(t, fingerX, fingerY);
    const dx = drag.originX - fingerX;
    const dy = drag.originY - fingerY;
    if (drag.lock === "undecided" && Math.hypot(dx, dy) >= AXIS_LOCK_DISTANCE) {
      drag.lock = decideLock(dx, dy, this.bounceX);
    }
    const useX = drag.lock === "x" || drag.lock === "free" || drag.lock === "undecided";
    const useY = drag.lock !== "x";
    const rawX = drag.baseX + (useX && this.bounceX ? dx : 0);
    const rawY = drag.baseY + (useY ? dy : 0);
    this.x = this.displayedFromRaw(rawX, this.minX, this.maxX, this.viewW, this.bounceX);
    this.y = this.displayedFromRaw(rawY, this.minY, this.maxY, this.viewH, this.bounceY);
  }

  dragEnd(t: number): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    const finger = this.tracker.velocity(t);
    // The content moves against the finger.
    let vx = -finger.x;
    let vy = -finger.y;
    if (drag.lock === "x") vy = 0;
    if (drag.lock === "y" || !this.bounceX) vx = 0;
    if (Math.abs(vx) < MIN_FLING_SPEED) vx = 0;
    if (Math.abs(vy) < MIN_FLING_SPEED) vy = 0;
    // Let go while stretched: it springs back, it does not fling on that axis.
    if (this.x < this.minX || this.x > this.maxX) vx = 0;
    if (this.y < this.minY || this.y > this.maxY) vy = 0;
    this.vx = vx;
    this.vy = vy;
    this.animating = vx !== 0 || vy !== 0 || this.isOverscrolled;
    this.lastStepT = t;
  }

  /**
   * Advance the fling or the return spring to time `t`. Returns whether the
   * content is still moving, i.e. whether another frame is needed.
   */
  step(t: number): boolean {
    if (!this.animating || this.drag) {
      this.lastStepT = t;
      return false;
    }
    const glide = this.glide;
    if (glide) {
      // Read off the clock, not integrated: a dropped frame cannot stretch it.
      const progress = (t - glide.t0) / glide.duration;
      this.lastStepT = t;
      if (progress >= 1) {
        this.x = glide.toX;
        this.y = glide.toY;
        this.glide = null;
        this.animating = false;
        return false;
      }
      const eased = easeOutCubic(progress);
      this.x = glide.fromX + (glide.toX - glide.fromX) * eased;
      this.y = glide.fromY + (glide.toY - glide.fromY) * eased;
      return true;
    }
    let dt = this.lastStepT < 0 ? 16 : t - this.lastStepT;
    dt = clamp(dt, 0, MAX_STEP_MS);
    this.lastStepT = t;
    if (dt === 0) return true;
    const sx =
      this.targetX === null
        ? stepAxis(this.x, this.vx, this.minX, this.maxX, dt, this.bounceX)
        : springAxis(this.x, this.vx, this.targetX, dt);
    const sy =
      this.targetY === null
        ? stepAxis(this.y, this.vy, this.minY, this.maxY, dt, this.bounceY)
        : springAxis(this.y, this.vy, this.targetY, dt);
    if (sx.done) this.targetX = null;
    if (sy.done) this.targetY = null;
    this.x = sx.p;
    this.vx = sx.v;
    this.y = sy.p;
    this.vy = sy.v;
    this.animating = !(sx.done && sy.done);
    return this.animating;
  }

  private displayedFromRaw(
    raw: number,
    min: number,
    max: number,
    dimension: number,
    bounce: boolean,
  ): number {
    if (raw < min) return bounce ? min + rubberBand(raw - min, dimension) : min;
    if (raw > max) return bounce ? max + rubberBand(raw - max, dimension) : max;
    return raw;
  }

  private rawFromDisplayed(
    displayed: number,
    min: number,
    max: number,
    dimension: number,
    bounce: boolean,
  ): number {
    if (!bounce) return clamp(displayed, min, max);
    if (displayed < min) return min + rubberBandInverse(displayed - min, dimension);
    if (displayed > max) return max + rubberBandInverse(displayed - max, dimension);
    return displayed;
  }
}

function decideLock(dx: number, dy: number, canScrollX: boolean): AxisLock {
  if (!canScrollX) return "y";
  const tan = Math.tan((AXIS_LOCK_DEGREES * Math.PI) / 180);
  if (Math.abs(dx) <= Math.abs(dy) * tan) return "y";
  if (Math.abs(dy) <= Math.abs(dx) * tan) return "x";
  return "free";
}

/** One axis, one frame, on the critically damped spring towards `target`. */
function springAxis(p: number, v: number, target: number, dt: number): AxisStep {
  const d = p - target;
  const w = SPRING_OMEGA;
  const e = Math.exp(-w * dt);
  const c = v + w * d;
  const nd = (d + c * dt) * e;
  const nv = (v - w * c * dt) * e;
  if (Math.abs(nd) < 0.5 && Math.abs(nv) < REST_SPEED * 4) return { p: target, v: 0, done: true };
  return { p: target + nd, v: nv, done: false };
}

/** One axis, one frame: free deceleration inside the bounds, a spring outside. */
function stepAxis(
  p: number,
  v: number,
  min: number,
  max: number,
  dt: number,
  bounce: boolean,
): AxisStep {
  if (p < min || p > max) {
    if (!bounce) return { p: clamp(p, min, max), v: 0, done: true };
    // Critically damped spring back to the nearer edge, carrying whatever
    // velocity the fling arrived with, so it overshoots a little then settles.
    const target = p < min ? min : max;
    const d = p - target;
    const w = SPRING_OMEGA;
    const e = Math.exp(-w * dt);
    const c = v + w * d;
    const nd = (d + c * dt) * e;
    const nv = (v - w * c * dt) * e;
    // Crossing back over the edge means the spring is done; it never carries
    // energy back into a scroll.
    if (Math.sign(nd) !== Math.sign(d) || (Math.abs(nd) < 0.1 && Math.abs(nv) < REST_SPEED)) {
      return { p: target, v: 0, done: true };
    }
    return { p: target + nd, v: nv, done: false };
  }
  if (v === 0) return { p, v: 0, done: true };
  const r = Math.pow(DECELERATION_RATE, dt);
  const np = p + (v * (r - 1)) / Math.log(DECELERATION_RATE);
  let nv = v * r;
  if (Math.abs(nv) < REST_SPEED) nv = 0;
  if (np < min || np > max) {
    if (!bounce) return { p: clamp(np, min, max), v: 0, done: true };
    return { p: np, v: nv, done: false };
  }
  return { p: np, v: nv, done: nv === 0 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
