/**
 * Work that may wait until the pen rests (FineNotes#275). On an iPad before
 * iPadOS 18.2 a main-thread stall while the pen is down is lost ink: the
 * pen's movement during it arrives as one sample. Bookkeeping that a lift
 * sets off (the page panel's thumbnails, a practice sheet's line count)
 * landed 50-600 ms after the lift, which is inside the next letter when
 * someone writes quickly. Such work is put here while the pen is writing and
 * done once it has rested (`write-hold.ts`), each kind once, latest wins.
 *
 * Pure: no DOM, no timers; the view says when the pen is quiet.
 */
export class QuietWork {
  private readonly waiting = new Map<string, () => void>();

  /** Run `job` now when the pen is not `writing`, else once it rests; a later job of the same `kind` replaces it. */
  run(kind: string, writing: boolean, job: () => void): void {
    if (!writing) {
      this.waiting.delete(kind);
      job();
      return;
    }
    this.waiting.set(kind, job);
  }

  /** Whether anything waits for the pen to rest. */
  get pending(): boolean {
    return this.waiting.size > 0;
  }

  /** The pen rests: run what waited, in the order first put off. */
  flush(): void {
    const jobs = [...this.waiting.values()];
    this.waiting.clear();
    for (const job of jobs) job();
  }

  /** Forget what waited (the view closes). */
  clear(): void {
    this.waiting.clear();
  }
}
