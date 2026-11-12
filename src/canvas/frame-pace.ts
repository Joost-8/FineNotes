/**
 * How long this display's frames are, learned from the frames themselves, so
 * work that must fit in a frame is given a share of the frame there is. The
 * budgets were set for a 60 Hz frame of 16.7 ms; on a 120 Hz iPad a frame is
 * 8.3 ms, and 6 ms of tile making plus the blits no longer fit in one
 * (FineNotes#201: 120 fps scrolling, about 80 whenever new tiles were made).
 *
 * PURE: no DOM, no Obsidian.
 */

/** A 60 Hz frame, ms: what is assumed until the frames say otherwise. */
export const DEFAULT_FRAME_MS = 1000 / 60;

/** The shortest frame believed, ms (a 240 Hz display). */
const MIN_FRAME_MS = 1000 / 240;
/** A gap past this is a pause between frames, not a frame, ms. */
const MAX_GAP_MS = 50;
/** How many frame gaps are remembered. */
const WINDOW = 60;
/** This many gaps are needed before they are believed. */
const ENOUGH = 12;
/** The share of the gaps that must be as short as the frame length taken. */
const SHARE = 0.1;
/** No budget is cut below this, ms: a tile still has to be made sometime. */
export const MIN_BUDGET_MS = 2;

export class FramePace {
  private readonly gaps: number[] = [];
  private last = Number.NaN;
  private length = DEFAULT_FRAME_MS;

  /**
   * A frame ran at `t` (the frame callback's time, ms). `follows` says it
   * was asked for by the frame before it, so the time between them is one
   * frame, or several when frames were missed.
   */
  note(t: number, follows: boolean): void {
    const gap = t - this.last;
    this.last = t;
    if (!follows || !(gap >= MIN_FRAME_MS) || gap > MAX_GAP_MS) return;
    this.gaps.push(gap);
    if (this.gaps.length > WINDOW) this.gaps.shift();
    if (this.gaps.length < ENOUGH) return;
    // The display's own frame is the short end of the gaps: a missed frame
    // makes a gap longer, never shorter. A tenth of them, so one odd reading
    // decides nothing.
    const sorted = [...this.gaps].sort((a, b) => a - b);
    this.length = sorted[Math.floor(SHARE * (sorted.length - 1))];
  }

  /** The display's frame length, ms. */
  get frameMs(): number {
    return this.length;
  }

  /** Frames a second the display shows. */
  get hz(): number {
    return 1000 / this.length;
  }

  /**
   * A budget of `at60` ms in a 60 Hz frame, as the same share of this
   * display's frame; never more than `at60`, never under {@link MIN_BUDGET_MS}.
   */
  budget(at60: number): number {
    const scaled = (at60 * this.length) / DEFAULT_FRAME_MS;
    return Math.min(at60, Math.max(Math.min(at60, MIN_BUDGET_MS), scaled));
  }
}
