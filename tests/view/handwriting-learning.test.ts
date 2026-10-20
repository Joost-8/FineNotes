/**
 * `src/view/handwriting-learning.ts`: where the learned model lives, what
 * the settings say about it, which practice set comes next, and the
 * practice lines it learns from.
 */

import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PAGE_GEOMETRY } from "../../src/model/document";

vi.mock("obsidian", () => import("./fake-obsidian"));

const {
  learnedKey,
  learnedModelPath,
  learnedRecord,
  learnedSummary,
  readPracticeLines,
  nextPracticeSet,
  practiceSetOf,
  progressLabel,
  MIN_PRACTICE_LINES,
  LEARN_STEPS,
} = await import("../../src/view/handwriting-learning");
const { buildPracticeFile, PRACTICE_LINES } = await import("../../src/recognition/practice");

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

  it("is described in one sentence, or invited when there is none", () => {
    expect(learnedSummary(undefined)).toMatch(/practice lines once/);
    const text = learnedSummary({
      learnedAt: "2026-10-11T20:00:00.000Z",
      lines: 32,
      tested: 8,
      before: 18.4,
      after: 6,
    });
    expect(text).toBe(
      "Learned from 32 of your lines on 2026-10-11: on 8 test lines it gets 6 % of characters wrong, against 18.4 % before.",
    );
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
