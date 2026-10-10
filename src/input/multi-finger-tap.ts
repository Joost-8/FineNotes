/**
 * Double taps with two or three fingers: undo and redo, as in GoodNotes.
 *
 * Every finger that touches the page is watched here, the third included
 * (the scroll gesture takes at most two, `finger-gesture.ts`). A touch group
 * runs from the first finger landing to the last lifting. It is a tap when it
 * was short and no finger slid; a pen landing voids it. Its size is the most
 * fingers that were down at once. Two taps of the same size, close in time
 * and place, make a double tap; the second tap then starts afresh, so a
 * triple tap is one double tap and a stray single, never two.
 *
 * A finger the browser cancels counts as lifted. On Android the system claims
 * three-finger touches for its own gestures (a three-finger screenshot swipe,
 * on Lenovo and others) and the page sees them cancelled at once, before any
 * lift; voiding the group on a cancel made the three-finger tap never work
 * there. A cancel still has to pass the tap's own checks: on the iPad,
 * WebKit's long press cancels a finger only after a hold far longer than a tap.
 *
 * PURE: no DOM. Positions are client px, times are event timestamps (ms).
 */

/** A tap lasts at most this long, first finger down to last finger up. */
export const MULTI_TAP_MAX_MS = 300;

/** A finger that slides further than this (screen px) makes the group a scroll, not a tap. */
export const MULTI_TAP_SLOP_PX = 24;

/** The second tap must land within this long of the first one lifting. */
export const DOUBLE_TAP_GAP_MS = 350;

/** The second tap's centre must lie within this distance (screen px) of the first's. */
export const DOUBLE_TAP_DISTANCE_PX = 120;

/**
 * A group still open this long after it began is abandoned: a finger whose
 * lift never arrived must not hold every later touch in a group that can
 * never end.
 */
export const STALE_GROUP_MS = 2000;

/** Why a group of two or more fingers was, or was not, a tap. */
export type TapOutcome = "tap" | "double" | "slow" | "slid" | "pen" | "stale";

/** One finished group of two or more fingers, for the debug overlay. */
export interface TapReport {
  fingers: number;
  /** First finger down to last finger up (or to when it was abandoned), ms. */
  ms: number;
  outcome: TapOutcome;
  /** Some finger ended in a cancel rather than a lift. */
  cancelled: boolean;
}

interface Touch {
  x0: number;
  y0: number;
}

interface Group {
  start: number;
  /** The fingers still down. */
  down: Map<number, Touch>;
  /** Where each finger landed, for the group's centre. */
  landed: Touch[];
  /** The most fingers down at once. */
  peak: number;
  slid: boolean;
  pen: boolean;
  cancelled: boolean;
}

interface Tap {
  fingers: number;
  start: number;
  end: number;
  x: number;
  y: number;
}

export class MultiFingerTap {
  private group: Group | null = null;
  /** The last finished tap, waiting for its partner. */
  private last: Tap | null = null;

  constructor(
    /** A double tap with this many fingers (2 or 3) was made. */
    private readonly onDoubleTap: (fingers: number) => void,
    /** Every finished group of two or more fingers, and what it was. */
    private readonly onReport?: (report: TapReport) => void,
  ) {}

  /** A finger landed. */
  down(id: number, x: number, y: number, t: number): void {
    if (this.group && t - this.group.start > STALE_GROUP_MS) this.abandon(t);
    if (!this.group) {
      this.group = {
        start: t,
        down: new Map(),
        landed: [],
        peak: 0,
        slid: false,
        pen: false,
        cancelled: false,
      };
    }
    const group = this.group;
    const touch = { x0: x, y0: y };
    group.down.set(id, touch);
    group.landed.push(touch);
    group.peak = Math.max(group.peak, group.down.size);
  }

  /** A finger moved; a slide past the slop makes the group a scroll. */
  move(id: number, x: number, y: number): void {
    const group = this.group;
    const touch = group?.down.get(id);
    if (group && touch && Math.hypot(x - touch.x0, y - touch.y0) > MULTI_TAP_SLOP_PX) {
      group.slid = true;
      this.last = null;
    }
  }

  /** A finger lifted. The last one to lift ends the group. */
  up(id: number, t: number): void {
    const group = this.group;
    if (!group?.down.delete(id) || group.down.size > 0) return;
    this.group = null;
    const ms = t - group.start;
    const outcome: TapOutcome = group.pen
      ? "pen"
      : group.slid
        ? "slid"
        : ms > MULTI_TAP_MAX_MS
          ? "slow"
          : "tap";
    const paired = this.settle(outcome === "tap" ? finish(group, t) : null);
    this.report(group, ms, paired ? "double" : outcome);
  }

  /** The browser cancelled a finger: it counts as lifted (see the top of the file). */
  cancel(id: number, t: number): void {
    if (this.group?.down.has(id)) this.group.cancelled = true;
    this.up(id, t);
  }

  /**
   * A pen landed: the group is void, and so is a tap waiting for its partner.
   * The group's fingers are still followed until they lift, so a late finger
   * cannot start a fresh group of its own.
   */
  penDown(): void {
    if (this.group) this.group.pen = true;
    this.last = null;
  }

  /** Drop a group whose last lift never came. */
  private abandon(t: number): void {
    const group = this.group;
    if (!group) return;
    this.group = null;
    this.last = null;
    this.report(group, t - group.start, "stale");
  }

  private report(group: Group, ms: number, outcome: TapOutcome): void {
    if (group.peak < 2) return;
    this.onReport?.({ fingers: group.peak, ms, outcome, cancelled: group.cancelled });
  }

  /**
   * A tap ended (or a group that was not one): pair it with the last, or keep
   * it. Returns whether it completed a double tap.
   */
  private settle(tap: Tap | null): boolean {
    const last = this.last;
    this.last = null;
    if (!tap || tap.fingers < 2) return false;
    if (
      last &&
      last.fingers === tap.fingers &&
      tap.start - last.end <= DOUBLE_TAP_GAP_MS &&
      Math.hypot(tap.x - last.x, tap.y - last.y) <= DOUBLE_TAP_DISTANCE_PX
    ) {
      this.onDoubleTap(tap.fingers);
      return true;
    }
    this.last = tap;
    return false;
  }
}

/** A group that qualified as a tap, with its size and centre. */
function finish(group: Group, end: number): Tap {
  let x = 0;
  let y = 0;
  for (const touch of group.landed) {
    x += touch.x0;
    y += touch.y0;
  }
  const n = group.landed.length;
  return { fingers: group.peak, start: group.start, end, x: x / n, y: y / n };
}
