/**
 * What one run of frames cost: a scroll, a page turn, a zoom. The debug
 * overlay's `fps=` and `paint=` are running averages, and a handful of slow
 * frames among forty quick ones barely moves either (FineNotes#201: a page
 * turn at 80 fps read `paint=0.7ms`). A run keeps the worst frame, how many
 * display frames were missed, and how often the whole page layer was
 * painted, and holds them after the run ends, to be read off the overlay.
 *
 * PURE: no DOM, no Obsidian.
 */

/** Frames further apart than this belong to different runs, ms. */
const RUN_GAP_MS = 100;
/**
 * A run shorter than this does not replace the one shown: the page paints a
 * frame or two by itself after it comes to rest.
 */
const RUN_MIN_FRAMES = 4;

interface Run {
  /** Frames drawn in the run. */
  frames: number;
  /** Display frames that passed without one of ours being drawn. */
  missed: number;
  /** The longest our own work took in one frame, ms. */
  peakMs: number;
  /** Whole paints of the page layer during the run, after its first frame. */
  whole: number;
}

const EMPTY: Run = { frames: 0, missed: 0, peakMs: 0, whole: 0 };

export class FrameRun {
  private last = Number.NaN;
  private wholeAtStart = 0;
  private now: Run = { ...EMPTY };
  private kept: Run = { ...EMPTY };

  /** The run to read: the one going on once it is long enough, else the last that was. */
  get shown(): Readonly<Run> {
    return this.now.frames >= RUN_MIN_FRAMES ? this.now : this.kept;
  }

  /**
   * A frame ran at `t` (the frame callback's time, ms) and our work in it
   * took `workMs`. `wholePaints` is the renderer's count so far, `frameMs`
   * the display's frame length.
   */
  note(t: number, workMs: number, wholePaints: number, frameMs: number): void {
    const gap = t - this.last;
    if (gap === 0) return;
    this.last = t;
    if (!(gap > 0 && gap < RUN_GAP_MS)) {
      if (this.now.frames >= RUN_MIN_FRAMES) this.kept = this.now;
      this.now = { ...EMPTY };
      // Counted from this frame on: what was painted at rest is not the run's.
      this.wholeAtStart = wholePaints;
    } else if (frameMs > 0) {
      this.now.missed += Math.max(0, Math.round(gap / frameMs) - 1);
    }
    this.now.frames++;
    this.now.peakMs = Math.max(this.now.peakMs, workMs);
    this.now.whole = wholePaints - this.wholeAtStart;
  }

  /** The overlay's words for the run: `run=38f missed=6 peak=11.2ms whole=3`. */
  line(): string {
    const run = this.shown;
    return `run=${run.frames}f missed=${run.missed} peak=${run.peakMs.toFixed(1)}ms whole=${run.whole}`;
  }
}
