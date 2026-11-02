/**
 * `HandwritingLearner` (view/handwriting-learning.ts) end to end with the
 * worker faked: a correction saved by `WordCheck` reaches the run as a
 * labelled word, and a run that fails or is stopped loses nothing.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => import("./fake-obsidian"));

/** What the faked worker was given, and what it does. */
const worker = {
  lines: [] as { text: string }[],
  run: (): Promise<unknown> => Promise.reject(new Error("out of memory")),
};

vi.mock("../../src/recognition/hwr/client", () => ({
  HwrWorkerClient: class {
    tune(_base: ArrayBuffer, lines: { text: string }[]): Promise<unknown> {
      worker.lines = lines;
      return worker.run();
    }
    terminate(): void {}
  },
}));

const { notices } = await import("./fake-obsidian");
const { HandwritingLearner } = await import("../../src/view/handwriting-learning");
const { WordCheck } = await import("../../src/view/word-check");
const { newCorrections } = await import("../../src/recognition/hwr/learned-model");

const CORRECTIONS = "FineNotes assets/Handwriting sheets/corrections.json";

function setUp() {
  const store = new Map<string, string>();
  const settings: Record<string, unknown> = {};
  const adapter = {
    exists: async (path: string) =>
      store.has(path) || [...store.keys()].some((k) => k.startsWith(`${path}/`)),
    read: async (path: string) => store.get(path) ?? "",
    write: async (path: string, text: string) => void store.set(path, text),
    writeBinary: async (path: string) => void store.set(path, "bin"),
    rename: async () => undefined,
    remove: async (path: string) => void store.delete(path),
    mkdir: async () => undefined,
  };
  const app = { vault: { adapter, getMarkdownFiles: () => [], getFileByPath: () => null } };
  const host = {
    app,
    pluginDir: "plug",
    settings,
    baseId: "grape-2",
    saveSettings: async () => undefined,
    reloadReader: () => undefined,
    baseModel: async () => new ArrayBuffer(4),
    openNotebook: () => null,
    createPracticeFile: async () => null,
  };
  const check = new WordCheck(
    app as never,
    () => "plug",
    () => Promise.resolve(null),
  );
  const learner = new HandwritingLearner(() => host as never);
  return { store, settings, check, learner };
}

/** Correct twelve words, as a tap on each underlined word does. */
async function correctTwelve(check: InstanceType<typeof WordCheck>): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await check.record(
      {
        note: "Notes.notebook.md",
        pageId: "p1",
        word: { text: `wrd${i}`, strokeIds: [`s${i}`] },
        strokes: [{ id: `s${i}`, pts: new Float32Array([0, 0, 0.5, 9, 9, 0.5]), t0: 0 }] as never,
      },
      "misread",
      `word${i}`,
    );
  }
}

describe("learning from corrected words", () => {
  beforeEach(() => {
    notices.length = 0;
    worker.lines = [];
  });

  it("learns from every saved correction, and keeps them all when the run fails", async () => {
    const { store, settings, check, learner } = setUp();
    await correctTwelve(check);
    const saved = store.get(CORRECTIONS);
    worker.run = () => Promise.reject(new Error("out of memory"));
    await learner.start();
    // Saved, and handed to the run with the typed text as the label.
    expect(worker.lines.map((l) => l.text)).toEqual(
      Array.from({ length: 12 }, (_, i) => `word${i}`),
    );
    expect(notices.at(-1)?.message).toMatch(/out of memory.*corrected words are kept/);
    // Nothing touched: the file, the reminder's count, the model.
    expect(store.get(CORRECTIONS)).toBe(saved);
    expect(settings.relearnRemindedAt).toBeUndefined();
    expect(settings.grape2Model).toBeUndefined();
    expect(newCorrections(check.answeredAt, undefined)).toBe(12);
    expect(learner.progress).toBeNull();
  });

  it("counts a finished run's corrections as learned only when its model is kept", async () => {
    const { settings, check, learner } = setUp();
    await correctTwelve(check);
    const result = { errors: 1, chars: 10 };
    // The gate refuses: corrections stay new, and the reminder counts from here.
    worker.run = () =>
      Promise.resolve({ better: false, before: result, after: result, heldOut: 2, trained: 10 });
    await learner.start();
    expect(settings.relearnRemindedAt).toBe(12);
    expect(settings.grape2Model).toBeUndefined();
    // The gate keeps it: the record says when the run started, so they are learned.
    worker.run = () =>
      Promise.resolve({
        better: true,
        before: result,
        after: { errors: 0, chars: 10 },
        heldOut: 2,
        trained: 10,
        bytes: new Uint8Array(4),
      });
    const before = Date.now();
    await learner.start();
    const record = settings.grape2Model as { learnedAt: string; corrections: number };
    expect(record.corrections).toBe(12);
    expect(Date.parse(record.learnedAt)).toBeGreaterThanOrEqual(before - 1);
    expect(newCorrections(check.answeredAt, record)).toBe(0);
  });

  it("tells an open Learn window how a run ended, in place of a notice", async () => {
    const { check, learner } = setUp();
    await correctTwelve(check);
    const told: unknown[] = [];
    const stop = learner.present((result) => told.push(result));
    worker.run = () =>
      Promise.resolve({
        better: true,
        before: { errors: 2, chars: 20 },
        after: { errors: 1, chars: 20 },
        heldOut: 3,
        trained: 9,
        bytes: new Uint8Array(4),
      });
    await learner.start();
    expect(told).toEqual([{ kind: "better", tested: 3, before: 10, after: 5 }]);
    expect(notices).toHaveLength(0);
    // No window open: the notice again.
    stop();
    worker.run = () => Promise.reject(new Error("out of memory"));
    await learner.start();
    expect(told).toHaveLength(1);
    expect(notices.at(-1)?.message).toMatch(/out of memory/);
  });
});
