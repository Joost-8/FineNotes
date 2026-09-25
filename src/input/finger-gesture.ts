/**
 * Scrolling and zooming with fingers, reported as positions.
 *
 * The page sets `touch-action: none`, so the browser scrolls nothing and the
 * finger movement is ours to interpret. It goes out as raw client positions
 * with timestamps, not as deltas: the surface's kinetic scroller needs the
 * path and its timing to measure a fling.
 *
 * At most two fingers make the gesture; a third is ignored for as long as it
 * stays down. Where the gesture is, its focus, is the one finger or the
 * midpoint of the two. Whenever a finger joins or leaves, the gesture starts
 * again from the new focus (`onPanStart` once more), so a pinch that ends
 * with one finger still down carries on as a pan from where it is, with no
 * jump.
 */

export interface PinchInfo {
  /** Incremental zoom factor since the previous pinch event. */
  scaleFactor: number;
  /** The pinch midpoint, client px. */
  centerX: number;
  centerY: number;
}

/** What the gesture reports. Every member is optional: take what you need. */
export interface FingerGestureListener {
  onPanStart?: (x: number, y: number, t: number) => void;
  onPanMove?: (x: number, y: number, t: number) => void;
  onPanEnd?: (t: number) => void;
  onPanCancel?: () => void;
  onPinchStart?: (centerX: number, centerY: number) => void;
  onPinch?: (info: PinchInfo) => void;
  onPinchEnd?: () => void;
}

const MAX_FINGERS = 2;

interface Finger {
  x: number;
  y: number;
}

export class FingerGesture {
  /** The fingers in the gesture, in the order they landed. */
  private readonly fingers = new Map<number, Finger>();
  /**
   * How far apart the two fingers were at the last pinch report, or null
   * while there is no pinch. Zero until they spread, so no step divides by it.
   */
  private spread: number | null = null;

  constructor(private readonly listener: FingerGestureListener) {}

  /** Whether any finger is part of the gesture. */
  get active(): boolean {
    return this.fingers.size > 0;
  }

  /**
   * A finger went down, or was reported down again without lifting. Returns
   * whether the gesture took it: a third finger is left out.
   */
  down(id: number, x: number, y: number, t: number): boolean {
    if (!this.fingers.has(id) && this.fingers.size >= MAX_FINGERS) return false;
    this.fingers.set(id, { x, y });
    this.regroup(t);
    return true;
  }

  /** A finger moved. One the gesture did not take is ignored. */
  move(id: number, x: number, y: number, t: number): void {
    const finger = this.fingers.get(id);
    if (!finger) return;
    finger.x = x;
    finger.y = y;
    const focus = this.focus();
    if (focus.spread !== null) {
      if (this.spread) {
        this.listener.onPinch?.({
          scaleFactor: focus.spread / this.spread,
          centerX: focus.x,
          centerY: focus.y,
        });
      }
      this.spread = focus.spread;
    }
    this.listener.onPanMove?.(focus.x, focus.y, t);
  }

  /**
   * A finger lifted, or the browser cancelled it; the gesture treats both
   * alike. Returns whether it was one the gesture had taken.
   */
  lift(id: number, t: number): boolean {
    if (!this.fingers.delete(id)) return false;
    if (this.fingers.size > 0) {
      this.regroup(t);
    } else {
      this.endPinch();
      this.listener.onPanEnd?.(t);
    }
    return true;
  }

  /**
   * Drop every finger at once (a pen landed): the pan is void, not ended, and
   * a pinch in progress simply stops. Returns the ids that were dropped.
   */
  cancel(): number[] {
    const dropped = [...this.fingers.keys()];
    if (dropped.length === 0) return dropped;
    this.fingers.clear();
    this.spread = null;
    this.listener.onPanCancel?.();
    return dropped;
  }

  /** The number of fingers changed: begin the pinch, or end it, and restart the pan. */
  private regroup(t: number): void {
    const focus = this.focus();
    if (focus.spread === null) {
      this.endPinch();
    } else {
      const starting = this.spread === null;
      this.spread = focus.spread;
      if (starting) this.listener.onPinchStart?.(focus.x, focus.y);
    }
    this.listener.onPanStart?.(focus.x, focus.y, t);
  }

  private endPinch(): void {
    if (this.spread === null) return;
    this.spread = null;
    this.listener.onPinchEnd?.();
  }

  /**
   * Where the gesture is, and the distance between its two fingers (null
   * with one). Only called while at least one finger is down.
   */
  private focus(): { x: number; y: number; spread: number | null } {
    const [a, b] = [...this.fingers.values()];
    if (!b) return { x: a.x, y: a.y, spread: null };
    return {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      spread: Math.hypot(b.x - a.x, b.y - a.y),
    };
  }
}
