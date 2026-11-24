/**
 * How long the pen waits for its ink (FineNotes#287), for the diagnostics
 * HUD, so a tester can compare two builds or two settings on a device with
 * nothing but a screen recording.
 *
 * Each wet paint of the stroke being written is timed from the newest pen
 * sample it shows (the event's `timeStamp`, which the platform stamps when
 * the hardware took the sample, on the clock `performance.now()` reads):
 *
 * - `ink`: to the end of that paint. What the page's own work costs: the
 *   wait for the event, the wait for the frame and the drawing.
 * - `frame`: to the start of the next frame. About when the paint is on
 *   the glass; the compositor and the panel add more that no page can see.
 *
 * And the input itself: how many samples a second the pen delivered and how
 * many came in one event (`n/ev`; a busy page or a throttled one batches
 * more). Each figure is over the last strokes, `LATENCY_WINDOW` paints.
 *
 * Also when a pen-down paints its dot (`paintsPenDown`).
 *
 * Pure: no DOM, no Obsidian.
 */

/** How many paints the figures are taken over: a few seconds of writing. */
export const LATENCY_WINDOW = 240;

/** A gap between pen events longer than this is a pause, not the input rate. */
const RATE_GAP_MS = 100;

export class InkLatency {
  /** The newest sample not painted yet; NaN once painted. */
  private pending = Number.NaN;
  private toInk: number[] = [];
  private toFrame: number[] = [];
  // The input rate, over the same writing.
  private events = 0;
  private samples = 0;
  private spanMs = 0;
  private lastEventAt = Number.NaN;

  /**
   * A pen event of the stroke being written, carrying samples stamped
   * `times` (a sample without a time is counted, not timed).
   */
  input(times: readonly (number | undefined)[], receivedAt: number): void {
    if (times.length === 0) return;
    let newest = this.pending;
    for (const t of times) if (t !== undefined && Number.isFinite(t) && !(newest >= t)) newest = t;
    this.pending = newest;
    const gap = receivedAt - this.lastEventAt;
    if (gap > 0 && gap < RATE_GAP_MS) {
      this.events += 1;
      this.samples += times.length;
      this.spanMs += gap;
    }
    this.lastEventAt = receivedAt;
  }

  /**
   * A wet paint ended at `at`. Returns the sample it showed, to hand to
   * {@link framed} at the next frame; null when no new sample was in it.
   */
  painted(at: number): number | null {
    const sample = this.pending;
    if (!Number.isFinite(sample)) return null;
    this.pending = Number.NaN;
    push(this.toInk, at - sample);
    return sample;
  }

  /** The frame after the paint of `sample` began at `at`. */
  framed(sample: number, at: number): void {
    push(this.toFrame, at - sample);
  }

  /** Whether anything was measured yet. */
  get measured(): boolean {
    return this.toInk.length > 0;
  }

  /**
   * One line: `lat ink 6/9ms frame 11/15ms in 240Hz 2.0n/ev`, the median and
   * the 95th percentile of each, or `lat -` before the first stroke.
   */
  line(): string {
    if (!this.measured) return "lat -";
    const pair = (a: number[]): string =>
      a.length ? `${percentile(a, 0.5).toFixed(0)}/${percentile(a, 0.95).toFixed(0)}ms` : "-";
    const hz = this.spanMs > 0 ? Math.round((this.samples / this.spanMs) * 1000) : 0;
    const per = this.events > 0 ? (this.samples / this.events).toFixed(1) : "-";
    return `lat ink ${pair(this.toInk)} frame ${pair(this.toFrame)} in ${hz}Hz ${per}n/ev`;
  }

  /** Forget everything: a new comparison starts. */
  reset(): void {
    this.pending = Number.NaN;
    this.toInk = [];
    this.toFrame = [];
    this.events = 0;
    this.samples = 0;
    this.spanMs = 0;
    this.lastEventAt = Number.NaN;
  }
}

/**
 * Whether a pen-down paints its dot on the next frame (FineNotes#287), or
 * waits for the first move as it did: a pen that rested a moment before it
 * moved showed nothing until then. Never while the stroke awaits its first
 * pressure or tilt reading: that rewrites the start, and the dot would
 * change once drawn.
 */
export function paintsPenDown(awaitingReading: boolean): boolean {
  return !awaitingReading;
}

function push(list: number[], value: number): void {
  if (!Number.isFinite(value) || value < 0) return;
  list.push(value);
  if (list.length > LATENCY_WINDOW) list.shift();
}

/** The `p` quantile of `values` (nearest rank below), which must not be empty. */
export function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * p)];
}
