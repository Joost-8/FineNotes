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
/**
 * Gaps from this to {@link NEAR_MOST} times the short end are single frames.
 * The top is just under twice the short end: a frame that started nearly
 * half a frame late leaves a gap of little over half a frame, and a top of
 * one and a half times that left the ordinary frames out, so the display
 * read twice as fast as it is (240 Hz at 120, found in review).
 */
const NEAR_LEAST = 0.75;
const NEAR_MOST = 1.9;
/** A gap under this share of a frame is a stray reading, not a frame. */
const STRAY = 0.45;

/**
 * The display's frame length from the gaps between frames, ms.
 *
 * A frame is shown on one of the display's own ticks, so a gap is a whole
 * number of them, give or take how late each of its two frames started. The
 * short end of the gaps says which gaps were one tick: a missed frame makes
 * a gap longer, never shorter, and a tenth of them means one odd reading
 * decides nothing. But the short end itself is not the tick. A frame that
 * starts late is followed by a gap that much shorter, and an iPad Pro whose
 * frames often started a millisecond late read 143 Hz at 120 (FineNotes#201),
 * which cut every budget by a seventh and counted late frames as missed.
 *
 * So the short end only finds the single-tick gaps; their middle says about
 * how long a tick is; and the answer is the time all the gaps took over the
 * ticks they spanned, where each frame's lateness is added to one gap and
 * taken from the next and so falls out.
 */
export function frameLength(gaps: readonly number[]): number {
  const sorted = [...gaps].sort((a, b) => a - b);
  const short = sorted[Math.floor(SHARE * (sorted.length - 1))];
  const single = sorted.filter((g) => g >= NEAR_LEAST * short && g <= NEAR_MOST * short);
  const about = single[Math.floor((single.length - 1) / 2)] ?? short;
  let time = 0;
  let ticks = 0;
  for (const gap of sorted) {
    if (gap < STRAY * about) continue;
    time += gap;
    ticks += Math.max(1, Math.round(gap / about));
  }
  return ticks > 0 ? time / ticks : short;
}

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
    this.length = frameLength(this.gaps);
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
