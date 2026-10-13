/**
 * A finger held still on the page: when that opens the small press menu
 * (Paste, Text box, Select all), with any tool, as GoodNotes' long press
 * does. Pure: the surface owns the timer and the DOM, and asks this module
 * what a held finger means.
 *
 * The hold is noticed by a timer, never by a pointer event: a finger held
 * still sends none (ledger, "Hold-to-snap never fired").
 *
 * A hold is a finger that
 *
 * - stays within {@link FINGER_HOLD_SLOP_PX} of where it landed, on screen
 *   (client px, never page px: the same slop at every zoom);
 * - for {@link FINGER_HOLD_MS};
 * - with no other finger on the glass (two fingers pinch);
 * - not soon after the pen ({@link PEN_QUIET_MS}): the writing hand lands
 *   between words and lines before the pen does, and rests there;
 * - and no wider than a fingertip, where WebKit reports a contact size at
 *   all ({@link PALM_CONTACT_PX}).
 *
 * These only ever refuse the *menu*. The touch still pans, pinches and taps
 * as before: a palm rule that blocked the gesture itself left pinches dead
 * (ledger, 2026-09-30), and a menu wrongly held back costs nothing.
 *
 * WebKit runs its own long press and may end a held finger in
 * `pointercancel` before the timer is due. A cancel of a finger that has been
 * still for {@link CANCEL_HOLD_FLOOR_MS} is taken for the hold it
 * interrupted, as the Pencil's is (ledger, "iOS ends a stationary pen in
 * pointercancel").
 */

/** How long a finger stays still before the press menu opens, ms. */
export const FINGER_HOLD_MS = 500;
/** How far a held finger may drift and still be holding, screen px (the tap slop). */
export const FINGER_HOLD_SLOP_PX = 8;
/** A finger held within this long of any pen event (hover included) is the writing hand, ms. */
export const PEN_QUIET_MS = 1500;
/** A contact wider than this is a palm, not a fingertip, CSS px. */
export const PALM_CONTACT_PX = 80;
/** A cancel of a finger still at least this long counts as the hold WebKit took, ms. */
export const CANCEL_HOLD_FLOOR_MS = 250;

/** Why a held finger does not open the menu. */
export type HoldVeto = "pen" | "fingers" | "palm";

/** What the surface knows when the hold falls due. */
export interface HoldCheck {
  /** Now, on the clock the pointer events use, ms. */
  t: number;
  /** The last pen event of any kind (down, move, lift, hover), ms; `null` when none came yet. */
  lastPenAt: number | null;
  /** Touch points on the glass now, the held one included. */
  touches: number;
}

/** One finger's hold, from landing to the menu or to letting go. */
export class FingerHold {
  private anchor: { x: number; y: number; t: number } | null = null;
  /** The widest contact the finger reported, CSS px; 0 while unknown. */
  private contact = 0;

  /** A finger landed at client point (x, y) at time t. */
  begin(x: number, y: number, t: number): void {
    this.anchor = { x, y, t };
    this.contact = 0;
  }

  /** Whether a finger is being watched for a hold. */
  get active(): boolean {
    return this.anchor !== null;
  }

  /** Where the watched finger landed, client px; `null` when none is. */
  get origin(): { x: number; y: number } | null {
    const a = this.anchor;
    return a ? { x: a.x, y: a.y } : null;
  }

  /**
   * The finger reported a contact size (a `PointerEvent`'s width and height,
   * CSS px). WebKit reports 1 x 1, or nothing, where it has no reading.
   */
  noteContact(width: number, height: number): void {
    const widest = Math.max(width || 0, height || 0);
    if (widest > this.contact) this.contact = widest;
  }

  /** The finger moved to (x, y). Returns false, and stops watching, once it left the slop. */
  move(x: number, y: number): boolean {
    const a = this.anchor;
    if (!a) return false;
    if (Math.hypot(x - a.x, y - a.y) <= FINGER_HOLD_SLOP_PX) return true;
    this.anchor = null;
    return false;
  }

  /** Stop watching: the finger lifted, a second one landed, or the pen did. */
  end(): void {
    this.anchor = null;
  }

  /**
   * The hold fell due (the timer, or a cancel that counts): `null` when it
   * opens the menu, else why not. Either way the watch ends.
   */
  verdict(check: HoldCheck): HoldVeto | null {
    this.anchor = null;
    if (check.touches > 1) return "fingers";
    if (check.lastPenAt !== null && check.t - check.lastPenAt < PEN_QUIET_MS) return "pen";
    if (this.contact > PALM_CONTACT_PX) return "palm";
    return null;
  }

  /**
   * The finger ended in `pointercancel` at time t: whether that is WebKit's
   * long press taking a finger that was holding still, so the hold is due now.
   */
  cancelIsHold(t: number): boolean {
    const a = this.anchor;
    return a !== null && t - a.t >= CANCEL_HOLD_FLOOR_MS;
  }
}
