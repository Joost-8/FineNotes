import { describe, expect, it } from "vitest";
import {
  type LearnWindowFacts,
  learnMaterial,
  learnWindow,
  sheetButton,
} from "../../src/recognition/hwr/learn-window-model";
import type { PracticeSheet } from "../../src/recognition/hwr/learned-model";

const sheet = (set: number, written: number, prompts = 30): PracticeSheet => ({
  path: `FineNotes assets/Handwriting sheets/Handwriting practice ${set}.practice.md`,
  title: `Handwriting practice ${set}`,
  set,
  written,
  prompts,
});

const facts = (fields: Partial<LearnWindowFacts> = {}): LearnWindowFacts => ({
  sheets: [],
  sets: 3,
  corrections: 0,
  run: null,
  result: null,
  symbolsWanted: true,
  now: 0,
  ...fields,
});

/** The buttons as "label*" (the filled one starred), left to right. */
const buttons = (f: Partial<LearnWindowFacts>) =>
  learnWindow(facts(f)).buttons.map((b) => `${b.label}${b.cta ? "*" : ""}`);

describe("the Learn your handwriting window", () => {
  it("starts with one step: write sheet 1, and nothing to learn yet", () => {
    const view = learnWindow(facts());
    expect(view.phase).toBe("start");
    expect(view.marks.map((m) => m.state)).toEqual(["next", "todo", "todo"]);
    expect(view.missing).toBe(10);
    expect(buttons({})).toEqual(["Write sheet 1*"]);
    expect(view.symbols).toBe(true);
  });

  it("counts corrected words toward the 10, and continues a sheet begun", () => {
    const view = learnWindow(facts({ sheets: [sheet(1, 4)], corrections: 3 }));
    expect(view.phase).toBe("start");
    expect([view.lines, view.missing]).toEqual([4, 3]);
    expect(view.marks[0]).toEqual({ set: 1, state: "started", detail: "4 of 30" });
    expect(buttons({ sheets: [sheet(1, 4)], corrections: 3 })).toEqual(["Continue sheet 1*"]);
  });

  it("is ready once there are 10: Learn now is the step, another sheet the option", () => {
    const view = learnWindow(facts({ sheets: [sheet(1, 30)], corrections: 4 }));
    expect(view.phase).toBe("ready");
    expect(view.lead).toBe("Ready to learn from 30 lines and 4 corrected words.");
    expect(view.marks.map((m) => [m.state, m.detail])).toEqual([
      ["done", "30 lines"],
      ["next", "to write"],
      ["todo", ""],
    ]);
    expect(view.note).toMatch(/only if it reads you better/);
    expect(view.note).toMatch(/Keep your sheets/);
    expect(buttons({ sheets: [sheet(1, 30)], corrections: 4 })).toEqual([
      "Write sheet 2",
      "Learn now*",
    ]);
  });

  it("shows a run's share and time left, with Stop", () => {
    const run = { step: 34, steps: 100, startedAt: 0 };
    // 34 steps in 68 s: 66 to go take 132 s, about 2 minutes.
    const view = learnWindow(facts({ sheets: [sheet(1, 30)], run, now: 68_000 }));
    expect([view.phase, view.percent, view.minutesLeft]).toEqual(["running", 34, 2]);
    expect(buttons({ run })).toEqual(["Close", "Stop"]);
    expect(learnWindow(facts({ run: { ...run, step: 0 } })).minutesLeft).toBeNull();
  });

  it("tells a better model with its numbers, and offers going back to Grape", () => {
    const result = { kind: "better" as const, tested: 60, before: 9.8, after: 4.1 };
    const view = learnWindow(facts({ sheets: [sheet(1, 30)], result }));
    expect(view.phase).toBe("better");
    expect(view.note).toMatch(/^58 % fewer mistakes/);
    expect(buttons({ result })).toEqual(["Go back to Grape", "Done*"]);
  });

  it("says nothing changed when it did not read better, and what to do next", () => {
    const result = { kind: "kept" as const, tested: 60, kept: 9.8, learned: 10.2, mine: false };
    const view = learnWindow(facts({ sheets: [sheet(1, 30)], result }));
    expect(view.title).toBe("Grape still reads you better");
    expect(view.note).toMatch(/^Nothing changed: Grape stays/);
    expect(buttons({ sheets: [sheet(1, 30)], result })).toEqual(["Close", "Write sheet 2*"]);
    const mine = learnWindow(facts({ result: { ...result, mine: true } }));
    expect(mine.title).toBe("Your model still reads you better");
  });

  it("offers trying again after a run that failed", () => {
    const view = learnWindow(facts({ result: { kind: "failed", message: "Out of memory" } }));
    expect([view.phase, view.lead]).toEqual(["failed", "Out of memory."]);
    expect(buttons({ result: { kind: "nothing" } })).toEqual(["Close", "Try again*"]);
  });
});

describe("what the other places say", () => {
  it("counts copied lines and the corrected words still needed", () => {
    expect(learnMaterial([sheet(1, 6), sheet(2, 1)], 1)).toEqual({ lines: 7, missing: 2 });
    expect(learnMaterial([sheet(1, 30)], 0).missing).toBe(0);
  });

  it("outlines the sheet's button with a count until there is enough", () => {
    expect(sheetButton(4, 0)).toEqual({ count: "4 / 10", ready: false });
    expect(sheetButton(8, 2)).toEqual({ count: "8 lines", ready: true });
  });
});
