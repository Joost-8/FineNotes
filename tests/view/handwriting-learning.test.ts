/**
 * `src/view/handwriting-learning.ts`: where the learned model lives, what
 * the settings say about it, and the practice lines it learns from.
 */

import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PAGE_GEOMETRY } from "../../src/model/document";

vi.mock("obsidian", () => import("./fake-obsidian"));

const { learnedModelPath, learnedSummary, readPracticeLines, MIN_PRACTICE_LINES, LEARN_STEPS } =
  await import("../../src/view/handwriting-learning");
const { buildPracticeNotebook, PRACTICE_LINES } = await import("../../src/recognition/practice");

describe("the learned model", () => {
  it("lives in the plugin's folder, with the one it replaced beside it", () => {
    expect(learnedModelPath(".obsidian/plugins/finenotes")).toBe(
      ".obsidian/plugins/finenotes/handwriting/personal.bin",
    );
    expect(learnedModelPath(".obsidian/plugins/finenotes", true)).toBe(
      ".obsidian/plugins/finenotes/handwriting/personal-prev.bin",
    );
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

describe("readPracticeLines", () => {
  it("reads the open notebook, unsaved ink included", async () => {
    const doc = buildPracticeNotebook(DEFAULT_PAGE_GEOMETRY);
    const prompt = doc.pages[0].textBoxes.find((b) => b.id === "practice-1")!;
    const y = prompt.y + 1.6 * (prompt.h ?? 40);
    doc.pages[0].strokes = [
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
    const lines = await readPracticeLines(host, "Handwriting practice.notebook.md");
    expect(lines).toEqual([
      { text: PRACTICE_LINES[0], strokes: [{ pts: [80, y - 8, 0.5, 300, y + 8, 0.5], t0: 12 }] },
    ]);
  });
});
