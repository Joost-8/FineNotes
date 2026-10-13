/**
 * A view's saves, made with the main thread kept free: what the main thread
 * does no longer grows with the notebook, so a 1,000-page notebook saves
 * between two strokes as a 10-page one does.
 *
 * - The JSON is put together from each page's cached JSON (serialize.ts),
 *   and only the pages that changed are serialised again, a few
 *   milliseconds at a time with the event loop let in between.
 * - The pages' text lives in a worker (save-worker.ts), which is sent only
 *   the pages it lacks, and DEFLATEs and base64-encodes the whole document
 *   there. The payload comes back and is written as any save is.
 *
 * Order: one save runs at a time, and one asked for meanwhile runs after it.
 * A synchronous save (the note closing, the app going to the background)
 * {@link BackgroundSaver.supersede}s whatever is running, and a result that
 * is older than it, or for another document or file, is never written. When
 * the worker cannot start, fails or is too slow, the save is made the old
 * way, on the main thread, and every later one too.
 *
 * No DOM and no Obsidian: the host and the worker come in as interfaces.
 */

import type { InkDocument } from "../model/document";
import {
  type DocumentEncoder,
  type DocumentSnapshot,
  type PageFragment,
  inkFileText,
} from "../model/serialize";

/** The worker as the saver sees it (save-worker-client.ts). Requests are handled in order. */
export interface CompressPort {
  /** Keep these pages' JSON, by slot. */
  put(slots: readonly number[], jsons: readonly string[]): void;
  /** The payload of `head`, the pages in `slots` and `]}`. Slots not listed are forgotten. */
  compress(head: string, slots: readonly number[], timeoutMs: number): Promise<string>;
  dispose(): void;
}

/** What a save is of: checked again before its result is written. */
export interface SaveTarget {
  readonly doc: InkDocument;
  readonly file: unknown;
}

/** The view, as the saver needs it. */
export interface SaverHost {
  /** What a background save would write now, or null when only the old way applies. */
  target(): SaveTarget | null;
  /** The note's text around the ink, as it is to be written; asked at the snapshot. */
  body(): string;
  /**
   * Write `contents` as the note's text. `behind`: the notebook changed
   * after the snapshot, so the file is behind it again.
   */
  write(contents: string, behind: boolean): Promise<void>;
  /** Save the old way: build and compress on the main thread. */
  writeNow(): Promise<void>;
  /** The pen is writing: the work between strokes is spread thinner. */
  penBusy(): boolean;
  /** The worker failed; saves are made the old way from now on. */
  failed?(error: unknown): void;
}

export interface SaverTiming {
  now(): number;
  /** Let the event loop run, for about `ms`. */
  pause(ms: number): Promise<void>;
  /** Main-thread work between two pauses. At least one page is serialised per slice. */
  sliceMs: number;
  /** The pause between slices while the pen writes. */
  penPauseMs: number;
  /**
   * Past this, the pages still to serialise are done in one go: edits that
   * touch every page kept landing faster than the slices could catch up.
   */
  prepareLimitMs: number;
  /** How long the worker may take to compress `chars` characters of JSON. */
  timeoutMs(chars: number): number;
}

export const DEFAULT_TIMING: SaverTiming = {
  now: () => performance.now(),
  pause: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
  sliceMs: 6,
  penPauseMs: 50,
  prepareLimitMs: 60_000,
  // A minute, and a second per MB: a slow iPad DEFLATEs about 10 MB a second.
  timeoutMs: (chars) => 60_000 + chars / 1000,
};

interface Prepared {
  snapshot: DocumentSnapshot;
  body: string;
  /** The encoder's edit count at the snapshot. */
  edits: number;
}

export class BackgroundSaver {
  /** Bumped by every save that must not be overwritten by one already running. */
  private epoch = 0;
  private running: Promise<void> | null = null;
  private again = false;
  private port: CompressPort | null = null;
  /** No worker, ever again, for this view: it could not start or it failed. */
  private broken = false;
  /** The slots the worker holds, as far as the requests sent so far go. */
  private readonly sent = new Set<number>();

  constructor(
    private readonly encoder: DocumentEncoder,
    private readonly host: SaverHost,
    private readonly startPort: () => Promise<CompressPort | null>,
    private readonly timing: SaverTiming = DEFAULT_TIMING,
  ) {}

  /** Whether a background save is under way. */
  get busy(): boolean {
    return this.running !== null;
  }

  /** Whether saves still go through the worker. */
  get usesWorker(): boolean {
    return !this.broken;
  }

  /** A save is about to be made another way: whatever runs now is older, and is dropped. */
  supersede(): void {
    this.epoch++;
  }

  /** The view closed: drop what runs, and let the worker go. A later save starts another. */
  stop(): void {
    this.epoch++;
    this.port?.dispose();
    this.port = null;
    this.sent.clear();
  }

  /**
   * Save in the background. While one runs, a second request makes it run
   * once more when it ends, so the last request is always saved after it.
   */
  save(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.loop();
    return this.running;
  }

  private async loop(): Promise<void> {
    try {
      do {
        this.again = false;
        await this.round();
      } while (this.again);
    } finally {
      // Cleared in the same step as the last check of `again`, so a request
      // can never land in between and be lost.
      this.running = null;
    }
  }

  /** The worker, started at the first save; null when there is none to be had. */
  private async workerPort(): Promise<CompressPort | null> {
    if (this.broken) return null;
    if (this.port) return this.port;
    const epoch = this.epoch;
    const port = await this.startPort().catch(() => null);
    if (epoch !== this.epoch) {
      // Stopped (or superseded) while it started: not kept, never leaked.
      port?.dispose();
      return null;
    }
    if (!port) this.broken = true;
    this.port = port;
    return port;
  }

  private async round(): Promise<void> {
    const epoch = this.epoch;
    const target = this.host.target();
    const port = target ? await this.workerPort() : null;
    if (epoch !== this.epoch) return;
    if (!target || !port) {
      await this.host.writeNow();
      return;
    }
    const live = (): boolean => {
      const now = this.host.target();
      return epoch === this.epoch && now?.doc === target.doc && now.file === target.file;
    };
    let prepared: Prepared | null;
    try {
      prepared = await this.prepare(target.doc, port, live);
    } catch {
      // Serialising failed: the old way fails too, and reports it as a failed save.
      if (live()) await this.host.writeNow();
      return;
    }
    if (!prepared || !live()) return;
    const { snapshot, body, edits } = prepared;
    let payload = (await this.matchesKnown(snapshot, live)) ? this.encoder.knownPayload : null;
    if (!live()) return;
    if (payload === null) {
      try {
        payload = await this.compress(port, snapshot);
      } catch (error) {
        if (epoch !== this.epoch) return;
        this.fail(error);
        if (live()) await this.host.writeNow();
        return;
      }
      // Older than a save made since, or for a document no longer shown.
      if (!live()) return;
    }
    this.encoder.accept(snapshot, payload);
    await this.host.write(inkFileText(body, payload), this.encoder.edits !== edits);
  }

  /** The snapshot, serialised a slice at a time, with each new page sent to the worker. */
  private async prepare(
    doc: InkDocument,
    port: CompressPort,
    live: () => boolean,
  ): Promise<Prepared | null> {
    const steps = this.encoder.snapshotSteps(doc);
    const started = this.timing.now();
    let sliceEnd = started + this.timing.sliceMs;
    let fresh: PageFragment[] = [];
    for (;;) {
      const step = steps.next();
      if (step.done) {
        // Same step as the snapshot: nothing can change in between.
        return { snapshot: step.value, body: this.host.body(), edits: this.encoder.edits };
      }
      fresh.push(step.value);
      const now = this.timing.now();
      if (now < sliceEnd) continue;
      this.send(port, fresh);
      fresh = [];
      if (now - started > this.timing.prepareLimitMs) {
        return {
          snapshot: this.encoder.snapshot(doc),
          body: this.host.body(),
          edits: this.encoder.edits,
        };
      }
      await this.timing.pause(this.host.penBusy() ? this.timing.penPauseMs : 0);
      if (!live()) return null;
      sliceEnd = this.timing.now() + this.timing.sliceMs;
    }
  }

  /** Whether the known payload already holds the snapshot, compared a slice at a time. */
  private async matchesKnown(snapshot: DocumentSnapshot, live: () => boolean): Promise<boolean> {
    const steps = this.encoder.matchesKnown(snapshot);
    let sliceEnd = this.timing.now() + this.timing.sliceMs;
    for (;;) {
      const step = steps.next();
      if (step.done) return step.value;
      if (this.timing.now() < sliceEnd) continue;
      await this.timing.pause(0);
      if (!live()) return false;
      sliceEnd = this.timing.now() + this.timing.sliceMs;
    }
  }

  /** Send the worker the pages it does not hold yet. */
  private send(port: CompressPort, fragments: readonly PageFragment[]): void {
    const slots: number[] = [];
    const jsons: string[] = [];
    for (const fragment of fragments) {
      if (this.sent.has(fragment.slot)) continue;
      this.sent.add(fragment.slot);
      slots.push(fragment.slot);
      jsons.push(fragment.json);
    }
    if (slots.length > 0) port.put(slots, jsons);
  }

  private compress(port: CompressPort, snapshot: DocumentSnapshot): Promise<string> {
    this.send(port, snapshot.pages);
    const slots = snapshot.pages.map((page) => page.slot);
    // The worker forgets what this request does not list; so does this record.
    const listed = new Set(slots);
    for (const slot of this.sent) if (!listed.has(slot)) this.sent.delete(slot);
    let chars = snapshot.head.length;
    for (const page of snapshot.pages) chars += page.json.length;
    return port.compress(snapshot.head, slots, this.timing.timeoutMs(chars));
  }

  private fail(error: unknown): void {
    this.broken = true;
    this.port?.dispose();
    this.port = null;
    this.sent.clear();
    this.host.failed?.(error);
  }
}
