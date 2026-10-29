/**
 * `src/view/handwriting-learning.ts`: where the learned model lives, which
 * practice set comes next, the practice lines it learns from, and that a
 * learned model is only ever deleted by the action that says so.
 */

import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PAGE_GEOMETRY } from "../../src/model/document";

vi.mock("obsidian", () => import("./fake-obsidian"));

const { TFile } = await import("./fake-obsidian");
const {
  deleteLearnedModel,
  learnedFiles,
  learnedKey,
  learnedModelPath,
  learnedRecord,
  practiceSheets,
  previousKey,
  readAllPracticeLines,
  readPracticeLines,
  swapWithPrevious,
  nextPracticeSet,
  practiceSetOf,
  progressLabel,
  symbolsToWrite,
  writePracticePage,
  writeSymbolPractice,
  MIN_PRACTICE_LINES,
  LEARN_STEPS,
} = await import("../../src/view/handwriting-learning");
const { learnSummary, nextSheetAction } = await import("../../src/recognition/hwr/learned-model");
const { buildPracticeFile, PRACTICE_LINES, SYMBOL_SET } =
  await import("../../src/recognition/practice");

describe("the learned model", () => {
  it("lives in the plugin's folder, with the one it replaced beside it", () => {
    expect(learnedModelPath(".obsidian/plugins/finenotes")).toBe(
      ".obsidian/plugins/finenotes/handwriting/personal.bin",
    );
    expect(learnedModelPath(".obsidian/plugins/finenotes", true)).toBe(
      ".obsidian/plugins/finenotes/handwriting/personal-prev.bin",
    );
  });

  it("is kept apart per Grape: learned from one, read only with that one", () => {
    expect(learnedModelPath(".obsidian/plugins/finenotes", false, "grape-2")).toBe(
      ".obsidian/plugins/finenotes/handwriting/grape-2/personal.bin",
    );
    expect(learnedKey("grape")).toBe("handwritingModel");
    expect(learnedKey("grape-2")).toBe("grape2Model");
    const one = { learnedAt: "2026-10-13", lines: 16, tested: 4, before: 15.2, after: 7.6 };
    expect(learnedRecord({ handwritingModel: one }, "grape")).toBe(one);
    expect(learnedRecord({ handwritingModel: one }, "grape-2")).toBeUndefined();
  });

  it("runs the recipe's 100 steps, from ten lines up", () => {
    expect(LEARN_STEPS).toBe(100);
    expect(MIN_PRACTICE_LINES).toBe(10);
  });
});

describe("practice sets", () => {
  it("reads a file's set from its name", () => {
    expect(practiceSetOf("Handwriting practice 2.practice.md")).toBe(2);
    expect(practiceSetOf("Handwriting practice 2 1.practice.md")).toBe(1);
    expect(practiceSetOf("Handwriting practice.practice.md")).toBeNull();
    expect(practiceSetOf("Handwriting practice 7.practice.md")).toBeNull();
    // The symbol sheet, and a second copy of it.
    expect(practiceSetOf("Symbol practice.practice.md")).toBe(SYMBOL_SET);
    expect(practiceSetOf("Symbol practice 2.practice.md")).toBe(SYMBOL_SET);
    expect(practiceSetOf("Old symbol practice.practice.md")).toBeNull();
  });

  it("writes the first set not written yet, then the one written least", () => {
    expect(nextPracticeSet([])).toBe(1);
    expect(nextPracticeSet([1])).toBe(2);
    expect(nextPracticeSet([1, 2, null])).toBe(3);
    expect(nextPracticeSet([1, 2, 3])).toBe(1);
    expect(nextPracticeSet([1, 2, 3, 1])).toBe(2);
  });
});

describe("progress", () => {
  it("says how far along and how long is left", () => {
    const started = 1_000_000;
    expect(progressLabel({ step: 0, steps: 100, startedAt: started }, started + 500)).toBe(
      "Learning · starting…",
    );
    // 25 steps in a minute: 75 to go is about three minutes.
    expect(progressLabel({ step: 25, steps: 100, startedAt: started }, started + 60_000)).toBe(
      "Learning · 25 % · about 3 min left",
    );
    expect(progressLabel({ step: 99, steps: 100, startedAt: started }, started + 99_000)).toBe(
      "Learning · 99 % · about 1 min left",
    );
  });
});

describe("readPracticeLines", () => {
  it("reads the open notebook, unsaved ink included", async () => {
    const doc = buildPracticeFile(1, DEFAULT_PAGE_GEOMETRY);
    // The first prompt is on rule 3; its copy goes on the line below.
    const y = 40 * 3 + 20;
    doc.pages[1].strokes = [
      {
        id: "s1",
        color: "#000",
        size: 2,
        tool: "pen",
        pts: [80, y - 8, 0.5, 300, y + 8, 0.5],
        t0: 12,
      },
    ];
    const host = { openNotebook: () => doc, app: {} } as never;
    const lines = await readPracticeLines(host, "Handwriting practice 1.practice.md");
    expect(lines).toEqual([
      { text: PRACTICE_LINES[0], strokes: [{ pts: [80, y - 8, 0.5, 300, y + 8, 0.5], t0: 12 }] },
    ]);
  });
});

/** A vault in memory: files by path, practice notebooks open, the settings saved. */
function fakeHost(files: Record<string, string>, docs: Record<string, unknown> = {}) {
  const store = new Map(Object.entries(files));
  const settings: Record<string, unknown> = {};
  let saves = 0;
  let reloads = 0;
  const host = {
    app: {
      vault: {
        adapter: {
          exists: async (path: string) =>
            store.has(path) || [...store.keys()].some((k) => k.startsWith(`${path}/`)),
          stat: async (path: string) =>
            store.has(path) ? { type: "file", size: store.get(path)?.length ?? 0, mtime: 0 } : null,
          remove: async (path: string) => void store.delete(path),
          rename: async (from: string, to: string) => {
            store.set(to, store.get(from) ?? "");
            store.delete(from);
          },
          read: async (path: string) => store.get(path) ?? "",
        },
        getMarkdownFiles: () =>
          [...store.keys()].filter((k) => k.endsWith(".md")).map((k) => new TFile(k)),
        getFileByPath: (path: string) => (store.has(path) ? new TFile(path) : null),
      },
    },
    pluginDir: "plug",
    settings,
    baseId: "grape-2",
    saveSettings: async () => void saves++,
    reloadReader: () => void reloads++,
    openNotebook: (path: string) => docs[path] ?? null,
  };
  return { host: host as never, store, settings, saves: () => saves, reloads: () => reloads };
}

const MODEL = "plug/handwriting/grape-2/personal.bin";
const PREVIOUS = "plug/handwriting/grape-2/personal-prev.bin";
const one = { learnedAt: "2026-10-13", lines: 16, tested: 4, before: 15.2, after: 7.6 };
const two = { learnedAt: "2026-10-21", lines: 40, tested: 10, before: 15.2, after: 5.1 };

describe("keeping a learned model", () => {
  it("finds which model files are on this device", async () => {
    const { host } = fakeHost({ [MODEL]: "abcd" });
    expect(await learnedFiles(host)).toEqual({ current: true, previous: false, bytes: 4 });
  });

  it("swaps with the previous model, files and records, and swaps back", async () => {
    const { host, store, settings } = fakeHost({ [MODEL]: "new", [PREVIOUS]: "old" });
    settings.grape2Model = two;
    settings.grape2ModelPrevious = one;
    settings.useLearnedHandwriting = false;
    await swapWithPrevious(host);
    expect(store.get(MODEL)).toBe("old");
    expect(store.get(PREVIOUS)).toBe("new");
    expect(settings[learnedKey("grape-2")]).toBe(one);
    expect(settings[previousKey("grape-2")]).toBe(two);
    expect(settings.useLearnedHandwriting).toBe(true);
    await swapWithPrevious(host);
    expect(store.get(MODEL)).toBe("new");
    expect(settings.grape2Model).toBe(two);
    expect([...store.keys()].some((k) => k.endsWith(".swap"))).toBe(false);
  });

  it("swaps a model whose scores were never recorded", async () => {
    const { host, store, settings } = fakeHost({ [MODEL]: "new", [PREVIOUS]: "old" });
    settings.grape2Model = two;
    await swapWithPrevious(host);
    expect(store.get(MODEL)).toBe("old");
    expect(settings.grape2Model).toBeUndefined();
    expect(settings.grape2ModelPrevious).toBe(two);
  });

  it("does nothing to swap without a previous model", async () => {
    const { host, store, saves } = fakeHost({ [MODEL]: "new" });
    await swapWithPrevious(host);
    expect(store.get(MODEL)).toBe("new");
    expect(saves()).toBe(0);
  });

  it("deletes both files and both records only when asked to delete", async () => {
    const { host, store, settings, reloads } = fakeHost({
      [MODEL]: "new",
      [PREVIOUS]: "old",
      "plug/words.txt": "x",
    });
    settings.grape2Model = two;
    settings.grape2ModelPrevious = one;
    await deleteLearnedModel(host);
    expect([...store.keys()]).toEqual(["plug/words.txt"]);
    expect(settings.grape2Model).toBeUndefined();
    expect(settings.grape2ModelPrevious).toBeUndefined();
    expect(reloads()).toBe(1);
  });

  it("no longer exports the action that deleted a model on the way to Grape", async () => {
    const module = await import("../../src/view/handwriting-learning");
    expect("resetLearnedModel" in module).toBe(false);
  });
});

describe("practice sheets", () => {
  function written(set: number, lines: number) {
    const doc = buildPracticeFile(set, DEFAULT_PAGE_GEOMETRY);
    // Prompt k sits on rule 3 + 3k of its page; its copy on the line below.
    doc.pages[1].strokes = Array.from({ length: lines }, (_, k) => {
      const y = 40 * (3 + 3 * k) + 20;
      return {
        id: `s${k}`,
        color: "#000",
        size: 2,
        tool: "pen" as const,
        pts: [80, y - 8, 0.5, 300, y + 8, 0.5],
        t0: 0,
      };
    });
    return doc;
  }

  it("lists each sheet with its set and the lines copied on it, by set", async () => {
    const { host } = fakeHost(
      {
        "P/Handwriting practice 2.practice.md": "",
        "P/Handwriting practice 1.practice.md": "",
        "P/Notes.md": "",
      },
      {
        "P/Handwriting practice 1.practice.md": written(1, 3),
        "P/Handwriting practice 2.practice.md": written(2, 0),
      },
    );
    const sheets = await practiceSheets(host);
    expect(sheets.map((s) => [s.title, s.set, s.written])).toEqual([
      ["Handwriting practice 1", 1, 3],
      ["Handwriting practice 2", 2, 0],
    ]);
    expect(sheets[0].prompts).toBe(PRACTICE_LINES.length);
  });

  it("records which sheets the lines came from", async () => {
    const { host } = fakeHost(
      { "a 1.practice.md": "", "b 2.practice.md": "" },
      { "a 1.practice.md": written(1, 2), "b 2.practice.md": written(2, 0) },
    );
    const { lines, sources } = await readAllPracticeLines(host);
    expect(lines).toHaveLength(2);
    expect(sources).toEqual([{ path: "a 1.practice.md", lines: 2 }]);
  });

  /** A practice notebook from before practice files: set 1's first `prompts` lines in text boxes. */
  function legacy(prompts: number, copied: number) {
    const doc = buildPracticeFile(1, DEFAULT_PAGE_GEOMETRY);
    delete doc.practice;
    const page = doc.pages[1];
    page.backdrop = { kind: "ruled-wide" };
    page.textBoxes = PRACTICE_LINES.slice(0, prompts).map((text, k) => ({
      id: `practice-${k + 1}`,
      x: 60,
      y: 120 * (k + 1),
      w: 900,
      h: 40,
      text,
      color: "#777",
      fontSize: 20,
    }));
    page.strokes = Array.from({ length: copied }, (_, k) => {
      const y = 120 * (k + 1) + 64;
      return {
        id: `s${k}`,
        color: "#000",
        size: 2,
        tool: "pen" as const,
        pts: [80, y - 8, 0.5, 300, y + 8, 0.5],
      };
    });
    doc.pages = [doc.pages[0], page];
    return doc;
  }

  it("finds the old practice notebook by its name after it moved, as set 1 with its own lines", async () => {
    // Joost's: the settings kept the path it was made at; it had moved since.
    const moved = "Miscellaneous/Handwriting practice.notebook.md";
    const { host, settings } = fakeHost({ [moved]: "" }, { [moved]: legacy(20, 20) });
    settings.practiceNotebookPath = "Computer Science/Handwriting practice.notebook.md";
    const sheets = await practiceSheets(host);
    expect(sheets).toEqual([
      { path: moved, title: "Handwriting practice", set: 1, written: 20, prompts: 20 },
    ]);
    expect(learnSummary(sheets, 3)).toBe("1 of 3 sheets · 20 lines");
    // Finished, so the next sheet is set 2, not the rest of set 1.
    expect(nextSheetAction(sheets, 3)).toEqual({ kind: "write", label: "Write sheet 2" });
    expect((await readAllPracticeLines(host)).lines).toHaveLength(20);
  });

  it("leaves out a notebook that only has the old name", async () => {
    const plain = buildPracticeFile(1, DEFAULT_PAGE_GEOMETRY);
    delete plain.practice;
    plain.pages = [plain.pages[0]];
    const { host } = fakeHost(
      { "Handwriting practice.notebook.md": "" },
      { "Handwriting practice.notebook.md": plain },
    );
    expect(await practiceSheets(host)).toEqual([]);
  });

  it("writes the set after the old notebook's", async () => {
    const path = "Handwriting practice.notebook.md";
    const { host } = fakeHost({ [path]: "" }, { [path]: legacy(20, 20) });
    const made: unknown[] = [];
    (host as { createPracticeFile: unknown }).createPracticeFile = async (...a: unknown[]) =>
      void made.push(a);
    await writePracticePage(host);
    expect(made).toEqual([[2]]);
  });

  it("writes only the symbols added since a symbol sheet was written", async () => {
    const old = buildPracticeFile(SYMBOL_SET, DEFAULT_PAGE_GEOMETRY);
    for (const page of old.pages.slice(1)) {
      const backdrop = page.backdrop as { printed?: { prompt?: string }[] };
      backdrop.printed = backdrop.printed?.filter(
        (line) => !line.prompt || Number(line.prompt.split("-")[2]) <= 53,
      );
    }
    const path = "Symbol practice.practice.md";
    const made: unknown[] = [];
    const none = fakeHost({});
    expect(await symbolsToWrite(none.host)).toBeNull();
    const { host } = fakeHost({ [path]: "" }, { [path]: old });
    (host as { createPracticeFile: unknown }).createPracticeFile = async (...a: unknown[]) =>
      void made.push(a);
    const missing = await symbolsToWrite(host);
    expect(missing?.[0]).toBe(53);
    await writeSymbolPractice(host);
    expect(made).toEqual([[SYMBOL_SET, missing]]);
    // A whole symbol sheet: another whole one.
    const whole = fakeHost(
      { [path]: "" },
      { [path]: buildPracticeFile(SYMBOL_SET, DEFAULT_PAGE_GEOMETRY) },
    );
    (whole.host as { createPracticeFile: unknown }).createPracticeFile = async (...a: unknown[]) =>
      void made.push(a);
    await writeSymbolPractice(whole.host);
    expect(made[1]).toEqual([SYMBOL_SET, undefined]);
  });
});
