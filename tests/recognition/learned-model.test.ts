/**
 * `src/recognition/hwr/learned-model.ts`: what the settings say about the
 * learned handwriting model, its practice sheets, and the steps to make it.
 */

import { describe, expect, it } from "vitest";
import {
  MIN_PRACTICE_LINES,
  type LearnedModel,
  type PracticeSheet,
  deleteQuestion,
  fewerMistakes,
  hasUnusedLines,
  correctionsText,
  learnInfoText,
  learnSummary,
  learnedBadge,
  learnedDate,
  learnedFrom,
  learnedResult,
  learnedStatus,
  nextSheetAction,
  RELEARN_AFTER,
  relearnDue,
  relearnText,
  sheetText,
  sheetUse,
  newCorrections,
  undoText,
} from "../../src/recognition/hwr/learned-model";

const model: LearnedModel = {
  learnedAt: "2026-10-21T20:00:00.000Z",
  lines: 240,
  tested: 60,
  before: 9.8,
  after: 4.1,
  sources: [
    { path: "P/Handwriting practice 1.practice.md", lines: 30 },
    { path: "P/Handwriting practice 2.practice.md", lines: 20 },
  ],
};

function sheet(set: number, written: number): PracticeSheet {
  return {
    path: `P/Handwriting practice ${set}.practice.md`,
    title: `Handwriting practice ${set}`,
    set,
    written,
    prompts: 30,
  };
}

/** What `learnInfoText` goes on: nothing yet. */
const facts = {
  sheets: [] as PracticeSheet[],
  sets: 3,
  corrections: 0,
  fresh: 0,
  model: undefined as LearnedModel | undefined,
  onDevice: false,
};

describe("the learned model in words", () => {
  it("dates it the same on every device", () => {
    expect(learnedDate("2026-10-21T23:59:00.000Z")).toBe("21 Oct 2026");
    expect(learnedDate("2026-01-02")).toBe("2 Jan 2026");
    expect(learnedDate("garbage")).toBe("garbage");
  });

  it("says how many fewer mistakes it makes than Grape alone", () => {
    expect(fewerMistakes(model)).toBe(58);
    expect(fewerMistakes({ before: 5, after: 6 })).toBe(0);
    expect(fewerMistakes({ before: 0, after: 0 })).toBe(0);
  });

  it("says what it learned from and how well it reads", () => {
    expect(learnedFrom(model)).toBe("learned 21 Oct 2026 from 240 of your lines");
    expect(learnedFrom({ ...model, corrections: 1 })).toBe(
      "learned 21 Oct 2026 from 240 of your lines and 1 corrected word",
    );
    expect(learnedResult(model)).toBe(
      "On 60 test lines it gets 4.1 % of characters wrong, against 9.8 % with Grape alone: 58 % fewer mistakes.",
    );
    expect(learnedResult({ ...model, after: 9.8 })).toMatch(/Grape alone\.$/);
  });

  it("tells in use, switched off, and not on this device apart", () => {
    expect(learnedStatus(model, true, true)).toEqual({
      tone: "ready",
      text: "On this device and in use, learned 21 Oct 2026 from 240 of your lines.",
    });
    expect(learnedStatus(model, true, false).tone).toBe("off");
    expect(learnedStatus(model, true, false).text).toMatch(
      /switched off: reading uses Grape alone/,
    );
    expect(learnedStatus(model, false, true).tone).toBe("missing");
    expect(learnedStatus(model, false, true).text).toMatch(/not on this device/);
    expect(learnedStatus(undefined, false, true).text).toBe("Not learned yet.");
    // A file put back by hand, with no record: still on this device.
    expect(learnedStatus(undefined, true, true).text).toBe("On this device and in use.");
  });
});

describe("the learned model in a few words", () => {
  it("says in use with how well it reads, off, or missing", () => {
    expect(learnedBadge(model, true, true)).toEqual({
      tone: "ready",
      text: "In use · 9.8 % → 4.1 %",
    });
    expect(learnedBadge(undefined, true, true)).toEqual({ tone: "ready", text: "In use" });
    expect(learnedBadge(model, true, false)).toEqual({ tone: "off", text: "Off · Grape alone" });
    expect(learnedBadge(model, false, true)).toEqual({
      tone: "missing",
      text: "Not on this device yet",
    });
    expect(learnedBadge(undefined, false, true)).toEqual({
      tone: "missing",
      text: "Not learned yet",
    });
  });

  it("counts the sets written and the lines copied", () => {
    expect(learnSummary([], 3)).toBe("0 of 3 sheets · 0 lines");
    expect(learnSummary([sheet(1, 30), sheet(2, 1), sheet(3, 0)], 3)).toBe(
      "2 of 3 sheets · 31 lines",
    );
    expect(learnSummary([sheet(1, 1)], 3)).toBe("1 of 3 sheets · 1 line");
  });
});

describe("the practice sheets against the model", () => {
  it("marks sheets used, used with fewer lines, and new", () => {
    expect(sheetUse(sheet(1, 30), model)).toBe("used");
    expect(sheetUse(sheet(2, 28), model)).toBe("more");
    expect(sheetUse(sheet(3, 5), model)).toBe("new");
    expect(sheetUse(sheet(3, 0), model)).toBe("unknown");
    expect(sheetUse(sheet(1, 30), { ...model, sources: undefined })).toBe("unknown");
    expect(sheetUse(sheet(1, 30), undefined)).toBe("unknown");
  });

  it("describes each sheet in a line", () => {
    expect(sheetText(sheet(1, 30), "used")).toBe("all 30 lines copied · in your learned model");
    expect(sheetText(sheet(2, 28), "more")).toMatch(/^28 of 30 lines copied · .*learn again/);
    expect(sheetText(sheet(3, 5), "new")).toBe(
      "5 of 30 lines copied · not in your learned model yet",
    );
    expect(sheetText(sheet(3, 0), "unknown")).toBe("nothing copied yet");
  });

  it("knows when there are lines the model has not seen", () => {
    expect(hasUnusedLines([sheet(1, 30), sheet(2, 20)], model)).toBe(false);
    expect(hasUnusedLines([sheet(1, 30), sheet(2, 21)], model)).toBe(true);
    expect(hasUnusedLines([sheet(1, 30), sheet(3, 1)], model)).toBe(true);
  });
});

describe("the reminder to learn again", () => {
  it("comes once every 50 new corrected words, and once per 50 since the last reminder", () => {
    expect(RELEARN_AFTER).toBe(50);
    // Never learned: corrections alone are enough to start.
    expect(relearnDue(49, 49, undefined)).toBe(0);
    expect(relearnDue(50, 50, undefined)).toBe(50);
    // Learned from 30 of 80: 50 new.
    expect(relearnDue(49, 79, undefined)).toBe(0);
    expect(relearnDue(50, 80, undefined)).toBe(50);
    // Reminded (or learned and lost the gate) at 80: next at 130, counting from the model.
    expect(relearnDue(99, 129, 80)).toBe(0);
    expect(relearnDue(100, 130, 80)).toBe(100);
    // A corrections file that shrank says nothing.
    expect(relearnDue(50, 10, 80)).toBe(0);
  });

  it("counts corrections as new by when they were saved, so a failed run loses none", () => {
    const learned = Date.parse(model.learnedAt);
    const at = [learned - 2, learned - 1, learned + 1, learned + 5000];
    expect(newCorrections(at, undefined)).toBe(4);
    expect(newCorrections(at, model)).toBe(2);
    // A record without a usable date: what it says it learned from.
    expect(newCorrections(at, { learnedAt: "?", corrections: 1 })).toBe(3);
    expect(newCorrections(at, { learnedAt: "?" })).toBe(4);
  });

  it("tracks the corrected words in a line that says what they are for", () => {
    expect(correctionsText(0, 0, false)).toMatch(/none yet\. Tap an underlined word/);
    expect(correctionsText(17, 67, true)).toBe(
      "Corrected words: 17 new since your model learned, of 67 saved. " +
        "At 50 new words, FineNotes offers to learn again.",
    );
    expect(correctionsText(4, 4, false)).toMatch(/^Corrected words: 4 new, of 4 saved\./);
  });

  it("says how many, and whether there is a model to learn again", () => {
    expect(relearnText(50, true)).toEqual({
      title: "Learn your handwriting again",
      body: "50 words corrected since the last time.",
    });
    expect(relearnText(60, false).title).toBe("Learn your handwriting");
    expect(relearnText(60, false).body).toContain("60 words corrected");
  });
});

describe("the steps", () => {
  it("carries on with an unfinished sheet before starting another", () => {
    expect(nextSheetAction([], 3)).toEqual({ kind: "write", label: "Write sheet 1" });
    expect(nextSheetAction([sheet(1, 30), sheet(2, 12)], 3)).toEqual({
      kind: "continue",
      path: "P/Handwriting practice 2.practice.md",
      label: "Continue sheet 2",
    });
    expect(nextSheetAction([sheet(1, 30), sheet(2, 30)], 3)).toEqual({
      kind: "write",
      label: "Write sheet 3",
    });
    expect(nextSheetAction([sheet(1, 30), sheet(2, 30), sheet(3, 30)], 3).label).toBe(
      "Write another sheet",
    );
  });

  it("does not count the symbol sheet as one of the sets, and names it by its title", () => {
    const symbols = {
      path: "P/Symbol practice.practice.md",
      title: "Symbol practice",
      set: 100,
      written: 20,
      prompts: 53,
    };
    expect(learnSummary([sheet(1, 30), symbols], 3)).toBe("1 of 3 sheets · 50 lines");
    expect(learnInfoText({ ...facts, sheets: [symbols] })).toMatch(
      /20 copied lines on 0 of 3 sheets/,
    );
    // An unfinished symbol sheet never blocks the text sheets (it has its own chip).
    expect(nextSheetAction([symbols], 3)).toEqual({ kind: "write", label: "Write sheet 1" });
    expect(nextSheetAction([sheet(1, 30), symbols], 3)).toEqual({
      kind: "write",
      label: "Write sheet 2",
    });
    expect(nextSheetAction([sheet(1, 12), symbols], 3).label).toBe("Continue sheet 1");
    // A finished symbol sheet does not stand in for a set.
    expect(nextSheetAction([{ ...symbols, written: 53 }], 3).label).toBe("Write sheet 1");
  });

  it("says what learning needs, what there is, and what comes next", () => {
    // Too little yet: how much more.
    const few = learnInfoText({ ...facts, sheets: [sheet(1, 4)], corrections: 2, fresh: 2 });
    expect(few).toMatch(
      new RegExp(`^Needs: at least ${MIN_PRACTICE_LINES} copied lines or corrected words\\.`),
    );
    expect(few).toContain(
      "Has: 4 copied lines on 1 of 3 sheets, and 2 corrected words. " +
        "Corrections are kept, also when a learning run fails or is stopped.",
    );
    expect(few).toMatch(/Next: 4 more lines or words, then Learn now\.$/);
    // Enough, no model yet.
    expect(learnInfoText({ ...facts, sheets: [sheet(1, 30)] })).toMatch(
      /Next: Learn now\. .*better than Grape alone\.$/,
    );
    // A model: the words new since it, and how many until the reminder.
    const learned = { ...facts, model, onDevice: true, sheets: [sheet(1, 30), sheet(2, 20)] };
    const some = learnInfoText({ ...learned, corrections: 67, fresh: 17 });
    expect(some).toContain("and 67 corrected words (17 new since your model learned)");
    expect(some).toContain(
      "Next: after 33 more corrected words, FineNotes offers to learn again; " +
        "Learn again starts it now.",
    );
    expect(learnInfoText({ ...learned, corrections: 60, fresh: 55 })).toContain(
      "Next: enough new words to learn again;",
    );
    // Nothing new: say so.
    expect(learnInfoText({ ...learned, corrections: 5 })).toContain(
      "Next: your model has all of it.",
    );
    // A model that does not say what it learned from never claims that.
    expect(learnInfoText({ ...learned, model: { ...model, sources: undefined } })).toContain(
      "Next: after 50 more corrected words",
    );
  });

  it("says what deleting removes, and how to keep it instead", () => {
    expect(deleteQuestion(model, true)).toMatch(
      /^It was learned 21 Oct 2026 from 240 of your lines\. Its file and the one before it are deleted/,
    );
    expect(deleteQuestion(undefined, false)).toMatch(/^Its file is deleted from this vault/);
    expect(deleteQuestion(model, false)).toMatch(
      /switch off “Read with my learned model” instead\.$/,
    );
  });

  it("says which model going back brings", () => {
    expect(undoText(model)).toMatch(
      /the one learned 21 Oct 2026 from 240 of your lines, which got 4.1 %/,
    );
    expect(undoText(undefined)).toMatch(/the one you had before the last learning/);
  });
});
