/**
 * When to put off work that would stall the pen. **Pure:** times in, decisions out.
 *
 * A save rebuilds and compresses the notebook on the main thread, and a PDF
 * page rasterises there too. While the pen is writing, a stall of a few
 * hundred milliseconds is ink lost: on iPadOS before 18.2 WebKit has no
 * `getCoalescedEvents`, so the pen's movement during the stall arrives as a
 * single sample and is drawn as a straight line (FineNotes#1, an iPad 6th
 * generation on iPadOS 17). Obsidian saves 2 s after the first edit without
 * restarting its timer, so it used to save mid-sentence every 2 s.
 *
 * So the work waits until the pen has been off the glass for
 * {@link QUIET_MS}: the pause between sentences, not between words. A save
 * waits longer, {@link SAVE_QUIET_MS}, and never longer than
 * {@link MAX_SAVE_HOLD_MS}; past that it is made at the next lift, between
 * two strokes, never during one. A pen "down" for longer than
 * {@link LOST_LIFT_MS} is taken for a lift that never arrived, so nothing
 * can be held for good.
 *
 * Why a save waits longer than a PDF page (FineNotes#274): every save
 * rewrites the whole notebook, and Obsidian Sync keeps each write as a
 * version for a month, counted against the plan's storage. Waiting for a
 * 1 s pause, a 30-page notebook (1.6 MB) was written about 250 times in an
 * hour of writing; waiting for 5 s, about 60. Leaving the app
 * (`visibilitychange`) and closing the notebook still save at once, so the
 * longer wait only matters if Obsidian stops while the notebook is on screen.
 */

/** The pen counts as writing until it has been up this long (ms). */
export const QUIET_MS = 1000;

/** A save waits until the pen has been up this long (ms). */
export const SAVE_QUIET_MS = 5000;

/** A save put off this long (ms) is made at the next lift anyway. */
export const MAX_SAVE_HOLD_MS = 60_000;

/** A pen down this long (ms) is taken for a lift that never arrived. */
export const LOST_LIFT_MS = 20_000;

export class WriteHold {
  private down = false;
  private downAt = 0;
  private upAt = Number.NEGATIVE_INFINITY;
  /** When the save now waiting was first put off; null when none is. */
  private heldSince: number | null = null;

  penDown(now: number): void {
    this.down = true;
    this.downAt = now;
  }

  penUp(now: number): void {
    this.down = false;
    this.upAt = now;
  }

  /** Whether the pen is down, and has not been so long that its lift must have been lost. */
  private pressing(now: number): boolean {
    return this.down && now - this.downAt < LOST_LIFT_MS;
  }

  /** Whether the pen is down, or lifted less than `quiet` ms ago. */
  private within(now: number, quiet: number): boolean {
    return this.pressing(now) || (!this.down && now - this.upAt < quiet);
  }

  /** Whether the pen is down, or lifted less than {@link QUIET_MS} ago. */
  writing(now: number): boolean {
    return this.within(now, QUIET_MS);
  }

  /** ms from `now` until the pen has been up `quiet` ms, or until a pen still down counts as lifted. */
  private quietAfter(now: number, quiet: number): number {
    if (this.down) return Math.max(0, this.downAt + LOST_LIFT_MS - now);
    return Math.max(0, this.upAt + quiet - now);
  }

  /**
   * When to look again: ms from `now` until the pen counts as quiet if it
   * stays up, or until a pen still down counts as lifted. 0 if it is quiet.
   */
  quietIn(now: number): number {
    return this.quietAfter(now, QUIET_MS);
  }

  /** {@link quietIn} for a save: until the pen has been up {@link SAVE_QUIET_MS}. */
  saveQuietIn(now: number): number {
    return this.quietAfter(now, SAVE_QUIET_MS);
  }

  /** Whether a save is waiting. */
  get savePending(): boolean {
    return this.heldSince !== null;
  }

  /**
   * A save is due now: true to put it off (and remember it is waiting),
   * false to make it. Never made while the pen is down.
   */
  holdSave(now: number): boolean {
    if (!this.within(now, SAVE_QUIET_MS)) {
      this.heldSince = null;
      return false;
    }
    this.heldSince ??= now;
    if (this.pressing(now)) return true;
    if (now - this.heldSince >= MAX_SAVE_HOLD_MS) {
      this.heldSince = null;
      return false;
    }
    return true;
  }

  /** Whether a waiting save has waited long enough to be made at this lift. */
  overdue(now: number): boolean {
    return (
      this.heldSince !== null && !this.pressing(now) && now - this.heldSince >= MAX_SAVE_HOLD_MS
    );
  }

  /** The waiting save was made (or is no longer wanted). */
  saved(): void {
    this.heldSince = null;
  }
}
