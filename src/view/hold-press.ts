/**
 * A finger or the Pencil held still on something: the long press that starts
 * picking several on Home. A mouse never holds (it right-clicks and drags),
 * moving past a few pixels is a scroll or a drag, and the click the lift
 * makes after a hold belongs to the hold, not to a tap.
 *
 * Pure: the caller runs the timer and passes the times and points.
 */

/** How long a press rests before it is a hold, ms. */
export const HOLD_MS = 450;
/** How far a press may drift and still be held, px. */
export const HOLD_SLOP = 10;
/** How long after a hold its lift's click is still the hold's, ms. */
const CLICK_AFTER_HOLD_MS = 800;

interface Press {
  id: number;
  x: number;
  y: number;
  key: string;
}

export class HoldPress {
  private press: Press | null = null;
  private heldAt = -Infinity;

  /** A pointer went down on `key`. Whether a hold timer should start. */
  down(id: number, pointerType: string, x: number, y: number, key: string): boolean {
    this.press = pointerType === "mouse" ? null : { id, x, y, key };
    return this.press !== null;
  }

  /** The pointer moved: too far, and it is no longer a hold. */
  move(id: number, x: number, y: number): void {
    const press = this.press;
    if (press && press.id === id && Math.hypot(x - press.x, y - press.y) > HOLD_SLOP)
      this.press = null;
  }

  /** Lifted, cancelled, or taken by a scroll or a drag. */
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

  /** Whether a hold ended just before `now` (its long-press menu is not wanted). */
  justHeld(now: number): boolean {
    return now - this.heldAt <= CLICK_AFTER_HOLD_MS;
  }

  /** A click at `now`: whether it is the lift of a hold, to be swallowed (once). */
  takeClick(now: number): boolean {
    if (now - this.heldAt > CLICK_AFTER_HOLD_MS) return false;
    this.heldAt = -Infinity;
    return true;
  }
}
