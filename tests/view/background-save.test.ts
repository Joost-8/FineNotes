/**
 * The background save's order and fallbacks (background-save.ts), with the
 * worker played by its pure core (FragmentStore) behind a port whose answers
 * the test releases by hand.
 */

import { describe, expect, it } from "vitest";
import { inflateFromBase64 } from "../../src/model/compress";
import { type InkDocument, type Stroke, blankPage, emptyDocument } from "../../src/model/document";
import { FragmentStore } from "../../src/model/fragment-store";
import {
  DocumentEncoder,
  encodeDocument,
  inkFileText,
  parseInkFile,
} from "../../src/model/serialize";
import {
  BackgroundSaver,
  type CompressPort,
  type SaverHost,
  type SaverTiming,
} from "../../src/view/background-save";

/** A worker whose compressions wait until the test lets them through. */
class FakePort implements CompressPort {
  readonly store = new FragmentStore();
  readonly puts: number[][] = [];
  readonly waiting: Array<() => void> = [];
  compressions = 0;
  disposed = false;
  failWith: Error | null = null;
  /** Answer at once rather than wait for {@link release}. */
  instant = false;

  put(slots: readonly number[], jsons: readonly string[]): void {
    this.puts.push([...slots]);
    this.store.put(slots, jsons);
  }

  compress(head: string, slots: readonly number[]): Promise<string> {
    this.compressions++;
    // The worker reads its pages when the request arrives, in order.
    const run = (): string => {
      if (this.failWith) throw this.failWith;
      return this.store.compress(head, slots);
    };
    if (this.instant) return Promise.resolve().then(run);
    return new Promise((resolve, reject) => {
      this.waiting.push(() => {
        try {
          resolve(run());
        } catch (error) {
          reject(error as Error);
        }
      });
    });
  }

  /** Let the oldest waiting compression answer. */
  release(): void {
    this.waiting.shift()?.();
  }

  dispose(): void {
    this.disposed = true;
  }
}

/** A clock that only moves when told, and pauses that only yield. */
function timing(overrides: Partial<SaverTiming> = {}): SaverTiming & { t: number } {
  const clock = { t: 0 };
  return Object.assign(clock, {
    now: () => clock.t,
    pause: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
    sliceMs: 6,
    penPauseMs: 50,
    prepareLimitMs: 60_000,
    timeoutMs: () => 1000,
    ...overrides,
  });
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await flush();
}

function stroke(id: string, x: number): Stroke {
  return { id, color: "#1a1a1a", size: 2, tool: "pen", pts: [x, 10, 0.5, x + 5, 20, 0.5] };
}

function notebook(pages = 4): InkDocument {
  const doc = emptyDocument(800);
  for (let i = 1; i < pages; i++) doc.pages.push(blankPage(`p${i + 1}`));
  doc.pages.forEach((page, i) => page.strokes.push(stroke(`s${i}`, i * 10)));
  return doc;
}

/** The view, as far as the saver sees it (wrapped into a SaverHost by `setup`). */
class Host {
  doc: InkDocument;
  file: object | null = {};
  body = "# Notes\n";
  readonly writes: Array<{ contents: string; behind: boolean }> = [];
  syncWrites = 0;
  failures: unknown[] = [];
  pen = false;

  constructor(
    doc: InkDocument,
    readonly encoder: DocumentEncoder,
  ) {
    this.doc = doc;
  }

  target() {
    return this.file ? { doc: this.doc, file: this.file } : null;
  }

  async write(contents: string, behind: boolean): Promise<void> {
    this.writes.push({ contents, behind });
  }

  async writeNow(): Promise<void> {
    this.syncWrites++;
    this.writes.push({
      contents: inkFileText(this.body, this.encoder.encode(this.doc)),
      behind: false,
    });
  }

  penBusy(): boolean {
    return this.pen;
  }

  failed(error: unknown): void {
    this.failures.push(error);
  }
}

function setup(options: { port?: FakePort | null; timing?: SaverTiming; pages?: number } = {}) {
  const doc = notebook(options.pages);
  const encoder = new DocumentEncoder();
  const host = new Host(doc, encoder);
  const port = options.port === undefined ? new FakePort() : options.port;
  const hostView: SaverHost = {
    target: () => host.target(),
    body: () => host.body,
    write: (contents, behind) => host.write(contents, behind),
    writeNow: () => host.writeNow(),
    penBusy: () => host.penBusy(),
    failed: (error) => host.failed(error),
  };
  const saver = new BackgroundSaver(
    encoder,
    hostView,
    async () => port,
    options.timing ?? timing(),
  );
  return { doc, encoder, host, port: port as FakePort, saver };
}

/** The notebook a written file holds, as JSON. */
function writtenJson(contents: string): string {
  const parsed = parseInkFile(contents);
  return inflateFromBase64(parsed.payload!.slice(3));
}

function plainJson(doc: InkDocument): string {
  return inflateFromBase64(encodeDocument(doc).slice(3));
}

describe("BackgroundSaver", () => {
  it("writes what the synchronous save writes, compressed by the worker", async () => {
    const { doc, host, port, saver } = setup();
    port.instant = true;
    await saver.save();
    expect(host.writes).toHaveLength(1);
    expect(host.syncWrites).toBe(0);
    expect(host.writes[0].contents).toBe(inkFileText(host.body, new DocumentEncoder().encode(doc)));
    expect(saver.busy).toBe(false);
    // Unchanged: the payload is reused, the worker not asked again.
    await saver.save();
    expect(port.compressions).toBe(1);
    expect(host.writes[1].contents).toBe(host.writes[0].contents);
  });

  it("sends the worker only the page that changed", async () => {
    const { doc, encoder, host, port, saver } = setup({ pages: 6 });
    port.instant = true;
    await saver.save();
    expect(port.puts.flat()).toHaveLength(6);
    doc.pages[3].strokes.push(stroke("new", 99));
    encoder.touch([doc.pages[3]]);
    port.puts.length = 0;
    await saver.save();
    expect(port.puts.flat()).toHaveLength(1);
    expect(writtenJson(host.writes[1].contents)).toBe(plainJson(doc));
  });

  it("never writes a result older than a synchronous save made meanwhile", async () => {
    const { doc, encoder, host, port, saver } = setup();
    const running = saver.save();
    await settle();
    expect(port.waiting).toHaveLength(1);
    // The note goes to the background: saved at once, the old way.
    doc.pages[0].strokes.push(stroke("late", 50));
    encoder.touch([doc.pages[0]]);
    saver.supersede();
    await host.writeNow();
    port.release();
    await running;
    expect(host.writes).toHaveLength(1);
    expect(host.syncWrites).toBe(1);
    expect(writtenJson(host.writes[0].contents)).toBe(plainJson(doc));
  });

  it("drops a result for a document no longer shown, or another file", async () => {
    const { host, port, saver } = setup();
    const first = saver.save();
    await settle();
    host.doc = notebook(2);
    port.release();
    await first;
    const second = saver.save();
    await settle();
    host.file = {};
    port.release();
    await second;
    expect(host.writes).toHaveLength(0);
  });

  it("runs a save asked for meanwhile once more, after, with the latest notebook", async () => {
    const { doc, encoder, host, port, saver } = setup();
    const first = saver.save();
    await settle();
    doc.pages[1].strokes.push(stroke("during", 70));
    encoder.touch([doc.pages[1]]);
    const second = saver.save();
    const third = saver.save();
    expect(second).toBe(first);
    expect(third).toBe(first);
    port.release();
    await settle();
    // The first result is written, marked behind: an edit landed after its snapshot.
    expect(host.writes).toHaveLength(1);
    expect(host.writes[0].behind).toBe(true);
    expect(writtenJson(host.writes[0].contents)).not.toBe(plainJson(doc));
    port.release();
    await first;
    expect(host.writes).toHaveLength(2);
    expect(host.writes[1].behind).toBe(false);
    expect(writtenJson(host.writes[1].contents)).toBe(plainJson(doc));
    expect(port.compressions).toBe(2);
  });

  it("falls back to the synchronous save when the worker fails, and stays there", async () => {
    const { doc, encoder, host, port, saver } = setup();
    port.failWith = new Error("worker died");
    port.instant = true;
    await saver.save();
    expect(host.failures).toHaveLength(1);
    expect(port.disposed).toBe(true);
    expect(host.syncWrites).toBe(1);
    expect(writtenJson(host.writes[0].contents)).toBe(plainJson(doc));
    expect(saver.usesWorker).toBe(false);
    doc.pages[0].strokes.push(stroke("after", 1));
    encoder.touch([doc.pages[0]]);
    await saver.save();
    expect(host.syncWrites).toBe(2);
    expect(port.compressions).toBe(1);
  });

  it("saves the old way where no worker can start", async () => {
    const { host, saver } = setup({ port: null });
    await saver.save();
    expect(host.syncWrites).toBe(1);
    expect(saver.usesWorker).toBe(false);
  });

  it("saves the old way, at once, while the load is held (no target)", async () => {
    const { host, port, saver } = setup();
    host.file = null;
    await saver.save();
    expect(host.syncWrites).toBe(1);
    expect(port.compressions).toBe(0);
  });

  it("does not fall back after a stop: the view is gone", async () => {
    const { host, port, saver } = setup();
    port.failWith = new Error("stopped");
    const running = saver.save();
    await settle();
    saver.stop();
    port.release();
    await running;
    expect(host.writes).toHaveLength(0);
    expect(host.failures).toHaveLength(0);
    expect(saver.usesWorker).toBe(true);
  });

  it("serialises in slices, and an edit between slices still gives one consistent snapshot", async () => {
    const clock = timing({ sliceMs: 1 });
    const { doc, encoder, host, port, saver } = setup({ pages: 8, timing: clock });
    port.instant = true;
    let pauses = 0;
    clock.now = () => (clock.t += 1);
    clock.pause = async () => {
      pauses++;
      // Undo, between two slices: every page counts as changed again.
      if (pauses === 2) {
        doc.pages.reverse();
        encoder.touchAll();
      }
      await flush();
    };
    await saver.save();
    expect(pauses).toBeGreaterThan(2);
    expect(writtenJson(host.writes[0].contents)).toBe(plainJson(doc));
    expect(host.writes[0].behind).toBe(false);
  });

  it("finishes the snapshot in one go when edits keep outrunning the slices", async () => {
    const clock = timing({ sliceMs: 1, prepareLimitMs: 5 });
    const { doc, encoder, host, port, saver } = setup({ pages: 8, timing: clock });
    port.instant = true;
    clock.now = () => (clock.t += 1);
    clock.pause = async () => {
      encoder.touchAll();
      await flush();
    };
    await saver.save();
    expect(writtenJson(host.writes[0].contents)).toBe(plainJson(doc));
  });

  it("spreads the work thinner while the pen writes", async () => {
    const clock = timing({ sliceMs: 1 });
    const { host, port, saver } = setup({ pages: 4, timing: clock });
    port.instant = true;
    host.pen = true;
    const waits: number[] = [];
    clock.now = () => (clock.t += 1);
    clock.pause = async (ms) => {
      waits.push(ms);
      await flush();
    };
    await saver.save();
    expect(waits.length).toBeGreaterThan(0);
    expect(waits.every((ms) => ms === 50)).toBe(true);
  });

  it("reuses the payload read from disk when the notebook still writes as it", async () => {
    const { doc, encoder, host, port, saver } = setup();
    const onDisk = encodeDocument(doc);
    encoder.remember(onDisk);
    encoder.touchAll();
    await saver.save();
    expect(port.compressions).toBe(0);
    expect(parseInkFile(host.writes[0].contents).payload).toBe(onDisk);
  });

  it("lets a worker go that finished starting after the view stopped", async () => {
    const doc = notebook();
    const encoder = new DocumentEncoder();
    const host = new Host(doc, encoder);
    const port = new FakePort();
    let started: (port: CompressPort) => void = () => undefined;
    const saver = new BackgroundSaver(
      encoder,
      {
        target: () => host.target(),
        body: () => host.body,
        write: (contents, behind) => host.write(contents, behind),
        writeNow: () => host.writeNow(),
        penBusy: () => false,
      },
      () => new Promise((resolve) => (started = resolve)),
      timing(),
    );
    const running = saver.save();
    await settle();
    saver.stop();
    started(port);
    await running;
    expect(port.disposed).toBe(true);
    expect(host.writes).toHaveLength(0);
    expect(saver.usesWorker).toBe(true);
  });
});
