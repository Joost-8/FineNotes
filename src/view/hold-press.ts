/**
 * A finger (or the Pencil) held still on something: the long press that
 * starts picking several on Home. Moving past a few pixels is a scroll or a
 * drag. iPadOS claims a still touch as its own long press and cancels it;
 * a cancel of a press that stayed still long enough is the hold it cut short
 * (ipad-input lessons, 2026-09-21).
 *
 * Pure: the caller runs the timer and passes the times and points.
 */

/** How long a press rests before it is a hold, ms: before Android's 400 ms menu. */
export const HOLD_MS = 350;
/** How far a press may drift and still be held, px. */
export const HOLD_SLOP = 10;
/** A press the platform cancelled after resting this long was a hold, ms. */
export const HOLD_CANCELLED_MS = 250;
/** How long after a hold the long press's own menu is still the hold's, ms. */
const MENU_AFTER_HOLD_MS = 800;

interface Press {
  id: number;
  x: number;
  y: number;
  key: string;
  at: number;
}

export class HoldPress {
  private press: Press | null = null;
  private heldAt = -Infinity;

  /** A touch went down on `key` at `now`. */
  down(id: number, x: number, y: number, key: string, now: number): void {
    this.press = { id, x, y, key, at: now };
  }

  /** The touch moved: too far, and it is no longer a hold. */
  move(id: number, x: number, y: number): void {
    const press = this.press;
    if (press && press.id === id && Math.hypot(x - press.x, y - press.y) > HOLD_SLOP)
      this.press = null;
  }

  /** Lifted, or a second finger came: no hold. */
  end(): void {
    this.press = null;
  }

  /** The timer ran out at `now`: the key held, or `null` when the press is gone. */
  fire(now: number): string | null {
    const press = this.press;
    this.press = null;
    if (!press) return null;
    this.heldAt = now;
    return press.key;
  }

  /** The platform cancelled the touch at `now`: the key, if it had rested long enough. */
  cancelled(now: number): string | null {
    const press = this.press;
    if (press && now - press.at >= HOLD_CANCELLED_MS) return this.fire(now);
    this.press = null;
    return null;
  }

  /** Whether a hold fired just before `now`: a long-press menu then is not wanted. */
  justHeld(now: number): boolean {
    return now - this.heldAt <= MENU_AFTER_HOLD_MS;
  }
}
