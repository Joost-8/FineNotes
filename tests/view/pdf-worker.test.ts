/**
 * The PDF worker's protocol, with the browser's Worker replaced by a fake
 * that answers as the real worker script does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", async () => ({
  ...(await import("./fake-obsidian")),
  loadPdfJs: () => Promise.resolve({}),
}));

const { PdfWorker, PdfRenderCancelled, acquirePdfWorker, releasePdfWorker, pdfJsBase } =
  await import("../../src/view/pdf-worker");

type Message = { fineNotesPdf: true; id: number; type: string; [key: string]: unknown };

/** How the fake answers; tests change it. */
const behaviour = {
  init: (): object => ({ ok: true }),
  hold: false,
  held: [] as Array<() => void>,
  /** Never answer `init`: a worker that hangs while starting. */
  silent: false,
  bitmaps: [] as Array<{ close: ReturnType<typeof vi.fn> }>,
};
let workers: FakeWorker[] = [];

class FakeWorker {
  readonly posted: Message[] = [];
  terminated = false;
  private readonly listeners = new Map<string, Array<(event: unknown) => void>>();
  constructor(
    readonly url: string,
    readonly options: object,
  ) {
    workers.push(this);
  }
  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  terminate(): void {
    this.terminated = true;
  }
  postMessage(message: Message): void {
    this.posted.push(message);
    const answer = (body: object) =>
      queueMicrotask(() =>
        this.emit("message", { data: { fineNotesPdf: true, id: message.id, ...body } }),
      );
    switch (message.type) {
      case "init":
        if (!behaviour.silent) answer(behaviour.init());
        break;
      case "open":
        answer({ ok: true, pages: 12 });
        break;
      case "size":
        answer({ ok: true, width: 600, height: 800 });
        break;
      case "render": {
        const bitmap = { width: message.width, height: message.height, close: vi.fn() };
        behaviour.bitmaps.push(bitmap);
        const send = () => answer({ ok: true, bitmap });
        if (behaviour.hold) behaviour.held.push(send);
        else send();
        break;
      }
      case "cancel":
        // The real worker answers the cancelled render instead.
        answer({ ok: false, cancelled: true });
        this.posted.at(-1)!.id = message.target as number;
        break;
    }
  }
}

const globals = globalThis as Record<string, unknown>;

beforeEach(() => {
  workers = [];
  behaviour.init = () => ({ ok: true });
  behaviour.hold = false;
  behaviour.held = [];
  behaviour.silent = false;
  behaviour.bitmaps = [];
  vi.stubGlobal("window", {
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: number) => clearTimeout(id),
    location: { origin: "app://obsidian.md" },
  });
  globals.Worker = FakeWorker;
  globals.OffscreenCanvas = class {};
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:worker");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete globals.Worker;
  delete globals.OffscreenCanvas;
});

describe("PdfWorker", () => {
  it("starts a module worker with pdf.js from where Obsidian loaded it", async () => {
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([
      { name: "capacitor://localhost/lib/pdfjs/pdf.min.mjs" } as PerformanceEntry,
    ]);
    const worker = await PdfWorker.start();
    expect(worker?.alive).toBe(true);
    expect(workers[0].options).toEqual({ type: "module" });
    expect(workers[0].posted[0]).toMatchObject({
      type: "init",
      base: "capacitor://localhost/lib/pdfjs/",
    });
    worker?.destroy();
    expect(worker?.alive).toBe(false);
    expect(workers[0].terminated).toBe(true);
  });

  it("falls back to the app bundle's place for pdf.js", () => {
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([]);
    expect(pdfJsBase()).toBe("app://obsidian.md/lib/pdfjs/");
  });

  it("is unavailable without workers or OffscreenCanvas, or if pdf.js fails to load in it", async () => {
    delete globals.OffscreenCanvas;
    expect(await PdfWorker.start()).toBeNull();
    globals.OffscreenCanvas = class {};
    behaviour.init = () => ({ ok: false, error: "import failed" });
    expect(await PdfWorker.start()).toBeNull();
    expect(workers.at(-1)?.terminated).toBe(true);
  });

  it("gives up on a worker that never answers", async () => {
    behaviour.silent = true;
    expect(await PdfWorker.start(20)).toBeNull();
    expect(workers[0].terminated).toBe(true);
  });

  it("opens a PDF, reads a page's size and renders a bitmap of the planned size", async () => {
    const worker = (await PdfWorker.start())!;
    const bytes = new ArrayBuffer(8);
    expect(await worker.open("a.pdf", bytes)).toBe(12);
    expect(await worker.pageSize("a.pdf", 3)).toEqual({ width: 600, height: 800 });
    const bitmap = await worker.render("a.pdf", 3, { sourceScale: 2, width: 512, height: 256 })
      .promise;
    expect([bitmap.width, bitmap.height]).toEqual([512, 256]);
    expect(workers[0].posted.find((m) => m.type === "render")).toMatchObject({
      path: "a.pdf",
      page: 3,
      sourceScale: 2,
    });
    worker.close("a.pdf");
    expect(workers[0].posted.at(-1)).toMatchObject({ type: "close", path: "a.pdf" });
    worker.destroy();
  });

  it("rejects a cancelled render as cancelled, and frees a bitmap that lands after", async () => {
    const worker = (await PdfWorker.start())!;
    behaviour.hold = true;
    const render = worker.render("a.pdf", 0, { sourceScale: 1, width: 10, height: 10 });
    render.cancel();
    render.cancel(); // twice is once
    expect(workers[0].posted.filter((m) => m.type === "cancel")).toHaveLength(1);
    await expect(render.promise).rejects.toBeInstanceOf(PdfRenderCancelled);
    // The worker had finished it anyway: its bitmap arrives unasked and is freed.
    behaviour.held[0]();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(behaviour.bitmaps[0].close).toHaveBeenCalled();
    worker.destroy();
  });

  it("fails every pending call when the worker dies", async () => {
    const worker = (await PdfWorker.start())!;
    behaviour.hold = true;
    const render = worker.render("a.pdf", 0, { sourceScale: 1, width: 10, height: 10 });
    workers[0].emit("error", { message: "out of memory" });
    await expect(render.promise).rejects.toThrow("out of memory");
    expect(worker.alive).toBe(false);
    await expect(worker.open("b.pdf", new ArrayBuffer(1))).rejects.toThrow("closed");
  });

  it("ignores messages that are not its own, such as pdf.js's", async () => {
    const worker = (await PdfWorker.start())!;
    workers[0].emit("message", { data: { sourceName: "worker", targetName: "main" } });
    workers[0].emit("message", { data: null });
    expect(await worker.open("a.pdf", new ArrayBuffer(1))).toBe(12);
    worker.destroy();
  });
});

describe("the shared worker", () => {
  it("starts once for every user and stops when the last lets go", async () => {
    const [a, b] = await Promise.all([acquirePdfWorker(), acquirePdfWorker()]);
    expect(a).toBe(b);
    expect(workers).toHaveLength(1);
    releasePdfWorker();
    await Promise.resolve();
    expect(workers[0].terminated).toBe(false);
    releasePdfWorker();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(workers[0].terminated).toBe(true);
    releasePdfWorker(); // one too many: harmless
    const c = await acquirePdfWorker();
    expect(workers).toHaveLength(2);
    expect(c).not.toBe(a);
    releasePdfWorker();
  });
});
