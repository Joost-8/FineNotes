/**
 * The notebook view's automatic reading on the device (`readNextPageOnDevice`
 * in `src/view/ink-view.ts`) with the reading guard: a page is marked while
 * it is read, a page that fails is skipped until it changes, and nothing is
 * read while the guard has paused reading after a crash (FineNotes#22).
 */

import { beforeAll, describe, expect, it, vi } from "vitest";
import { type Page, type Stroke, blankPage } from "../../src/model/document";
import { type GuardStore, ReadingGuard } from "../../src/recognition/reading-guard";
import type { InkView as InkViewClass } from "../../src/view/ink-view";

vi.mock("obsidian", () => import("./fake-obsidian"));

let InkView: typeof InkViewClass;

// The whole view loads here: under a full parallel run that can pass 10 s.
beforeAll(async () => {
  ({ InkView } = await import("../../src/view/ink-view"));
}, 60_000);

const ink = (id: string): Stroke => ({
  id,
  color: "#000",
  size: 2,
  tool: "pen",
  pts: [0, 0, 0.5, 10, 10, 0.5],
});

function pages(): Page[] {
  const list = [blankPage("p1"), blankPage("p2")];
  list[0].strokes = [ink("a")];
  list[1].strokes = [ink("b")];
  return list;
}

function storage(initial?: string): GuardStore & { value: string | undefined } {
  const s = {
    value: initial,
    load: (): unknown => s.value,
    save: (value: string): void => {
      s.value = value;
    },
  };
  return s;
}

const reading = { lines: [], segment: 0, wordGap: 1 };

/** A view without its DOM: the members the reading loop uses. */
function view(readPage: (strokes: unknown) => Promise<unknown>, guard: ReadingGuard) {
  const doc = { pages: pages() };
  const members = {
    surface: { currentPage: 0 },
    doc,
    noteBody: "",
    file: { path: "A.notebook.md" },
    deviceRead: new Map<string, string>(),
    deviceBusy: false,
    checkedWords: new Map(),
    penIsDown: false,
    deviceTimer: 0,
    plugin: {
      readingGuard: guard,
      handwriting: { model: vi.fn(async () => ({})), readPage: vi.fn(readPage) },
    },
    writeTranscripts: vi.fn(),
    offerHandwrittenLinks: vi.fn(async () => {}),
    scheduleDeviceReading: vi.fn(),
  };
  const v = Object.create(InkView.prototype) as Record<string, unknown>;
  for (const [key, value] of Object.entries(members)) {
    Object.defineProperty(v, key, { value, writable: true, configurable: true });
  }
  const next = (): Promise<void> =>
    (v as unknown as { readNextPageOnDevice(): Promise<void> }).readNextPageOnDevice();
  return { v: v as typeof members & Record<string, unknown>, next };
}

describe("reading pages on the device", () => {
  it("marks the page while it is read, and lifts the mark after", async () => {
    const store = storage();
    let markedWhileReading: string | undefined;
    const { v, next } = view(
      async () => {
        markedWhileReading = store.value;
        return reading;
      },
      new ReadingGuard(store, "1"),
    );
    await next();
    expect(JSON.parse(markedWhileReading as string).reading).toMatchObject({
      path: "A.notebook.md",
      key: "p1",
      page: 1,
    });
    expect(JSON.parse(store.value as string).reading).toBeNull();
    expect(v.writeTranscripts).toHaveBeenCalledOnce();
    expect(v.deviceBusy).toBe(false);
  });

  it("skips a page whose reading failed, and goes on to the next", async () => {
    const store = storage();
    const guard = new ReadingGuard(store, "1");
    const read = vi.fn(async (): Promise<unknown> => {
      throw new Error("the recogniser did not answer within 180 s");
    });
    const { v, next } = view(read, guard);
    await next();
    expect(guard.skipped("A.notebook.md").has("p1")).toBe(true);
    expect(v.scheduleDeviceReading).toHaveBeenCalled();
    expect(JSON.parse(store.value as string).reading).toBeNull();
    read.mockResolvedValueOnce(reading);
    await next();
    // Not kept for suggestions: checking words is off.
    expect(read).toHaveBeenLastCalledWith(v.doc.pages[1].strokes, false);
  });

  it("blames no page when the model fails to load", async () => {
    const store = storage();
    const guard = new ReadingGuard(store, "1");
    const { v, next } = view(async () => reading, guard);
    v.plugin.handwriting.model.mockRejectedValueOnce(new Error("no model file"));
    await next();
    expect(v.plugin.handwriting.readPage).not.toHaveBeenCalled();
    expect(guard.skipped("A.notebook.md").size).toBe(0);
    expect(store.value).toBeUndefined();
    expect(v.deviceBusy).toBe(false);
  });

  it("reads nothing while reading is paused after a crash", async () => {
    const mark = { path: "A.notebook.md", key: "p1", hash: "x", page: 1 };
    const crashed = storage(JSON.stringify({ version: "1", reading: mark, crashed: [] }));
    const { v, next } = view(async () => reading, new ReadingGuard(crashed, "1"));
    await next();
    expect(v.plugin.handwriting.readPage).not.toHaveBeenCalled();
  });
});
