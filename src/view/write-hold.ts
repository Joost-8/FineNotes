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
 * never waits longer than {@link MAX_SAVE_HOLD_MS}; past that it is made at
 * the next lift, between two strokes, never during one. A pen "down" for
 * longer than that is taken for a lift that never arrived, so nothing can
 * be held for good.
 */

/** The pen counts as writing until it has been up this long (ms). */
export const QUIET_MS = 1000;

/** A save put off this long (ms) is made at the next lift anyway. */
export const MAX_SAVE_HOLD_MS = 20_000;

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
    return this.down && now - this.downAt < MAX_SAVE_HOLD_MS;
  }

  /** Whether the pen is down, or lifted less than {@link QUIET_MS} ago. */
  writing(now: number): boolean {
    return this.pressing(now) || (!this.down && now - this.upAt < QUIET_MS);
  }

  /**
   * When to look again: ms from `now` until the pen counts as quiet if it
   * stays up, or until a pen still down counts as lifted. 0 if it is quiet.
   */
  quietIn(now: number): number {
    if (this.down) return Math.max(0, this.downAt + MAX_SAVE_HOLD_MS - now);
    return Math.max(0, this.upAt + QUIET_MS - now);
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
    if (!this.writing(now)) {
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
