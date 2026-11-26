/**
 * One Companion PDF export at a time, across every notebook. A request for
 * a notebook already waiting replaces the waiting one (its newest content
 * wins; a forced request stays forced); a request while that notebook's
 * export runs waits for it. Nothing starts while the pen is down, and
 * nothing starts in the call that asked: a notebook that is closing has
 * finished tearing down before its export begins. Pure: time is handed in.
 */

export type CompanionJob = (force: boolean) => Promise<void>;

export interface CompanionQueueIO {
  /** True while the pen is writing anywhere: the queue waits. */
  paused: () => boolean;
  /** Resolves after about `ms`. */
  sleep: (ms: number) => Promise<void>;
  /** A job that failed: reported, never thrown at the caller that queued it. */
  failed: (id: string, error: unknown) => void;
  /** Running or waiting changed (the state marks). */
  changed?: () => void;
}

const PAUSE_POLL_MS = 400;

interface Waiting {
  job: CompanionJob;
  force: boolean;
  done: Array<() => void>;
}

export class CompanionQueue {
  private readonly waiting = new Map<string, Waiting>();
  private current: string | null = null;
  private draining: Promise<void> | null = null;
  private stopped = false;

  constructor(private readonly io: CompanionQueueIO) {}

  /** Queues `job` for `id`. Resolves when that notebook's export has run (or was dropped). */
  request(id: string, job: CompanionJob, force = false): Promise<void> {
    if (this.stopped) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const before = this.waiting.get(id);
      this.waiting.set(id, {
        job,
        force: force || before?.force === true,
        done: [...(before?.done ?? []), resolve],
      });
      this.io.changed?.();
      this.drain();
    });
  }

  /** Whether `id` is exporting or waiting to. */
  busy(id: string): boolean {
    return this.current === id || this.waiting.has(id);
  }

  /** Resolves once nothing is running or waiting. */
  idle(): Promise<void> {
    return this.draining ?? Promise.resolve();
  }

  /** Drops everything waiting; a job already running finishes on its own. */
  stop(): void {
    this.stopped = true;
    for (const waiting of this.waiting.values()) waiting.done.forEach((done) => done());
    this.waiting.clear();
    this.io.changed?.();
  }

  private drain(): void {
    if (this.draining) return;
    this.draining = this.run().finally(() => {
      this.draining = null;
      if (this.waiting.size > 0 && !this.stopped) this.drain();
    });
  }

  private async run(): Promise<void> {
    // Not in the caller's own turn: a closing view finishes first.
    await this.io.sleep(0);
    while (!this.stopped && this.waiting.size > 0) {
      while (this.io.paused() && !this.stopped) await this.io.sleep(PAUSE_POLL_MS);
      if (this.stopped) return;
      const [id, next] = this.waiting.entries().next().value as [string, Waiting];
      this.waiting.delete(id);
      this.current = id;
      this.io.changed?.();
      try {
        await next.job(next.force);
      } catch (error) {
        this.io.failed(id, error);
      } finally {
        this.current = null;
        next.done.forEach((done) => done());
        this.io.changed?.();
      }
    }
  }
}
