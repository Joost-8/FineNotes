/**
 * What FineNotes did in its first minute, and where the main thread stalled,
 * for the shape diagnostics export. On the iPad nobody can open a console,
 * so a lag after a cold start is pinned from one run of that command
 * (ledger, 2026-10-22: the Grape bridge blocked startup for seconds).
 *
 * The plugin marks its steps (`mark`) and a timer that should fire every
 * `tick` ms reports how late it came (`late`); a late timer is a stall,
 * kept with the step marked last before it. Times are ms since the plugin
 * began loading.
 *
 * No DOM, no Obsidian.
 */

/** How many of the longest stalls are kept. */
export const STALLS_KEPT = 8;
/** A timer this much late counts as a stall. */
export const STALL_MS = 100;

export interface StartupStall {
  /** When the stall ended, ms since load. */
  at: number;
  /** How long the main thread was held. */
  ms: number;
  /** The step marked last before it ended. */
  after: string;
}

export interface StartupReport {
  marks: Array<{ name: string; at: number }>;
  stalls: StartupStall[];
  /** Every stall's length added up, kept or not. */
  stalledMs: number;
  /** How long the watch ran. */
  watchedMs: number;
}

export class StartupLog {
  private readonly marks: Array<{ name: string; at: number }> = [];
  private stalls: StartupStall[] = [];
  private stalledMs = 0;
  private watchedMs = 0;
  private stopped = false;
  private readonly origin: number;

  constructor(private readonly now: () => number) {
    this.origin = now();
  }

  private since(): number {
    return Math.round(this.now() - this.origin);
  }

  /** A step happened now. Nothing is kept once the watch has stopped. */
  mark(name: string): void {
    if (!this.stopped) this.marks.push({ name, at: this.since() });
  }

  /** The first minute is over: what is kept stays, nothing more is added. */
  stop(): void {
    this.stopped = true;
  }

  /** A step of `ms` that just ended (marked when it ended, with its length). */
  timed(name: string, ms: number): void {
    this.mark(`${name} (${Math.round(ms)} ms)`);
  }

  /** The watch timer fired `lateMs` after it was due. */
  late(lateMs: number): void {
    if (this.stopped) return;
    const at = this.since();
    this.watchedMs = at;
    if (!(lateMs >= STALL_MS)) return;
    const ms = Math.round(lateMs);
    this.stalledMs += ms;
    const after = this.marks.filter((m) => m.at <= at).pop()?.name ?? "load";
    this.stalls.push({ at, ms, after });
    this.stalls.sort((a, b) => b.ms - a.ms);
    if (this.stalls.length > STALLS_KEPT) this.stalls.length = STALLS_KEPT;
  }

  report(): StartupReport {
    return {
      marks: [...this.marks],
      stalls: [...this.stalls].sort((a, b) => a.at - b.at),
      stalledMs: this.stalledMs,
      watchedMs: this.watchedMs,
    };
  }
}
