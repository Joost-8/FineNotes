/**
 * The learned handwriting model as the settings describe it: what it was
 * learned from, how much better it reads than Grape alone, which practice
 * sheets are written and which of them it was built from, and the words of
 * the steps that make one (view/handwriting-learning.ts does the file work).
 *
 * PURE: no DOM, no Obsidian.
 */

import { t, tn } from "../../i18n/translate";

/** A practice sheet as learning used it: its vault path and the lines copied on it then. */
export interface LearnedSource {
  path: string;
  lines: number;
}

/** What the settings keep about a learned model. */
export interface LearnedModel {
  /** When it was learned, ISO. */
  learnedAt: string;
  /** Lines it learned from, and lines it was tested on. */
  lines: number;
  tested: number;
  /** Characters wrong on the test lines, in %, with Grape and with it. */
  before: number;
  after: number;
  /** The practice sheets it learned from (models learned before 2.5 have none). */
  sources?: LearnedSource[];
  /** Corrected words it learned from, besides the sheets. */
  corrections?: number;
}

/** Fewer copied lines than this, and there is not enough to learn from. */
export const MIN_PRACTICE_LINES = 10;

/**
 * New corrected words that make learning again worth it. About 300
 * characters, as much as 8 copied practice lines: Joost's first learned
 * model, from 16 lines, halved what Grape got wrong (15.2 to 7.6 %), and a
 * run holds back every fifth item to test on, so 50 new words put 10 of
 * them in the test. Fewer, and a run is mostly the same data again.
 */
export const RELEARN_AFTER = 50;

/**
 * The corrected words `model` has not learned from: those saved after it was
 * learned (`answeredAt`: each correction's time), or every one without a
 * model. Counted by time, not by a number kept beside the model, so a run
 * that fails or is stopped leaves them counted as new: nothing is lost.
 */
export function newCorrections(
  answeredAt: readonly number[],
  model: Pick<LearnedModel, "learnedAt" | "corrections"> | undefined,
): number {
  if (!model) return answeredAt.length;
  const since = Date.parse(model.learnedAt);
  if (!Number.isFinite(since)) return Math.max(0, answeredAt.length - (model.corrections ?? 0));
  return answeredAt.filter((at) => at > since).length;
}

/**
 * Whether to remind the user to learn again: `fresh` new corrected words
 * (`newCorrections`), `total` corrected in all. `remindedAt` is the total at
 * the last reminder or the last finished run, so a reminder comes once per
 * `RELEARN_AFTER` words, whatever the answer. Returns the new words to
 * mention, 0 when it is not time.
 */
export function relearnDue(fresh: number, total: number, remindedAt: number | undefined): number {
  if (fresh < RELEARN_AFTER) return 0;
  return total - (remindedAt ?? 0) >= RELEARN_AFTER ? fresh : 0;
}

/** "Corrected words: 17 not learned yet…": the corrections chip's label. */
export function correctionsText(fresh: number, total: number, model: boolean): string {
  if (total === 0) return t("ai.learned.correctionsNone");
  return t(model ? "ai.learned.correctionsSinceModel" : "ai.learned.corrections", {
    fresh,
    total,
    after: RELEARN_AFTER,
  });
}

/** The reminder's words, for `fresh` new corrected words: a title and one line under it. */
export function relearnText(fresh: number, learned: boolean): { title: string; body: string } {
  return learned
    ? {
        title: t("ai.learned.relearnAgainTitle"),
        body: t("ai.learned.relearnAgainBody", { fresh }),
      }
    : {
        title: t("ai.learn.title"),
        body: t("ai.learned.relearnBody", { fresh }),
      };
}

const MONTH_KEYS = [
  "ai.month.jan",
  "ai.month.feb",
  "ai.month.mar",
  "ai.month.apr",
  "ai.month.may",
  "ai.month.jun",
  "ai.month.jul",
  "ai.month.aug",
  "ai.month.sep",
  "ai.month.oct",
  "ai.month.nov",
  "ai.month.dec",
] as const;

/** The short name of a month (0 for January) in the language in use: "Oct". */
export function monthName(index: number): string {
  return t(MONTH_KEYS[index] ?? "ai.month.jan");
}

/** "21 Oct 2026": a learned date as the settings show it, the same on every device. */
export function learnedDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day || month > 12) return iso.slice(0, 10);
  return t("ai.learned.date", { day, month: monthName(month - 1), year });
}

/** How many fewer characters it gets wrong than Grape alone, in whole %; 0 when not fewer. */
export function fewerMistakes(model: Pick<LearnedModel, "before" | "after">): number {
  if (!(model.before > 0) || model.after >= model.before) return 0;
  return Math.round((100 * (model.before - model.after)) / model.before);
}

/** "learned 21 Oct 2026 from 240 of your lines": when and from how much. */
export function learnedFrom(model: LearnedModel): string {
  const date = learnedDate(model.learnedAt);
  if (!model.corrections) return t("ai.learned.from", { date, lines: model.lines });
  return t("ai.learned.fromWords", {
    date,
    lines: model.lines,
    words: tn("ai.learn.correctedWords", model.corrections),
  });
}

/** "On 60 test lines it gets 4.1 % of characters wrong, against 9.8 % with Grape alone: 58 % fewer mistakes." */
export function learnedResult(model: LearnedModel): string {
  const fewer = fewerMistakes(model);
  return t(fewer > 0 ? "ai.learned.resultFewer" : "ai.learned.result", {
    tested: model.tested,
    after: model.after,
    before: model.before,
    fewer,
  });
}

/** What the learned model's row says about it, given whether its file is on this device. */
export function learnedStatus(
  model: LearnedModel | undefined,
  onDevice: boolean,
  inUse: boolean,
): { tone: "ready" | "off" | "missing"; text: string } {
  if (!onDevice) {
    return model
      ? {
          tone: "missing",
          text: t("ai.learned.fileMissing", { from: learnedFrom(model) }),
        }
      : { tone: "missing", text: t("ai.learned.notLearnedDot") };
  }
  const from = model ? learnedFrom(model) : "";
  if (inUse) {
    return {
      tone: "ready",
      text: model ? t("ai.learned.inUseFrom", { from }) : t("ai.learned.inUse"),
    };
  }
  return {
    tone: "off",
    text: model ? t("ai.learned.switchedOffFrom", { from }) : t("ai.learned.switchedOff"),
  };
}

/**
 * The learned model's state in a few words, for its row and the section's
 * header: "In use · 9.8 % → 4.1 %", "Off", "Not learned yet". The long
 * form is `learnedStatus`, behind the row's info button.
 */
export function learnedBadge(
  model: LearnedModel | undefined,
  onDevice: boolean,
  inUse: boolean,
): { tone: "ready" | "off" | "missing"; text: string } {
  if (!onDevice) {
    return {
      tone: "missing",
      text: model ? t("ai.learned.badgeNotHere") : t("ai.learned.badgeNotLearned"),
    };
  }
  if (!inUse) return { tone: "off", text: t("ai.learned.badgeOff") };
  return {
    tone: "ready",
    text: model
      ? t("ai.learned.badgeInUseResult", { before: model.before, after: model.after })
      : t("ai.learned.badgeInUse"),
  };
}

/** "2 of 3 sheets · 49 lines": how far learning has come, in one line. */
export function learnSummary(sheets: readonly PracticeSheet[], sets: number): string {
  const written = writtenSets(sheets, sets);
  const lines = sheets.reduce((sum, sheet) => sum + sheet.written, 0);
  return t("ai.learn.summary", { written, sets, lines: tn("ai.learn.lines", lines) });
}

/** Whether a sheet is one of the `sets` text sets (not the symbol sheet, not a legacy notebook). */
function isTextSheet(sheet: PracticeSheet, sets: number): boolean {
  return sheet.set !== null && sheet.set >= 1 && sheet.set <= sets;
}

/** How many of the `sets` text sets have a sheet with something copied on it. */
function writtenSets(sheets: readonly PracticeSheet[], sets: number): number {
  return new Set(sheets.filter((s) => s.written > 0 && isTextSheet(s, sets)).map((s) => s.set))
    .size;
}

/** A practice sheet in the vault, as the settings list it. */
export interface PracticeSheet {
  path: string;
  /** The file's name without `.practice.md`. */
  title: string;
  /** Its set (1-based), or null for the practice notebook from before practice files. */
  set: number | null;
  /** Lines copied on it now, and lines it asks for. */
  written: number;
  prompts: number;
}

/** How a sheet stands against the learned model. */
export type SheetUse =
  /** No learned model, or one that does not say what it learned from. */
  | "unknown"
  /** Learned from, as it is now. */
  | "used"
  /** Learned from, but more lines were copied since. */
  | "more"
  /** Not learned from: written after, or not chosen. */
  | "new";

export function sheetUse(sheet: PracticeSheet, model: LearnedModel | undefined): SheetUse {
  if (!model?.sources) return "unknown";
  const source = model.sources.find((s) => s.path === sheet.path);
  if (!source) return sheet.written > 0 ? "new" : "unknown";
  return sheet.written > source.lines ? "more" : "used";
}

/** "28 of 30 lines copied · in your learned model": a sheet's line in the list. */
export function sheetText(sheet: PracticeSheet, use: SheetUse): string {
  const copied =
    sheet.written === 0
      ? t("ai.learn.copiedNone")
      : sheet.written >= sheet.prompts
        ? t("ai.learn.copiedAll", { prompts: sheet.prompts })
        : t("ai.learn.copiedSome", { written: sheet.written, prompts: sheet.prompts });
  switch (use) {
    case "used":
      return t("ai.learn.sheetLine", { copied, use: t("ai.learn.sheetUsed") });
    case "more":
      return t("ai.learn.sheetLine", { copied, use: t("ai.learn.sheetMore") });
    case "new":
      return t("ai.learn.sheetLine", { copied, use: t("ai.learn.sheetNew") });
    case "unknown":
      return copied;
  }
}

/** Whether any written sheet has lines the learned model has not seen. */
export function hasUnusedLines(
  sheets: readonly PracticeSheet[],
  model: LearnedModel | undefined,
): boolean {
  return sheets.some((sheet) => {
    const use = sheetUse(sheet, model);
    return use === "new" || use === "more";
  });
}

/**
 * Step 1's button: carry on with a sheet not copied to the end, else write
 * the first set there is no sheet of yet, else another copy of a set. The
 * symbol sheet has a chip of its own, so it never takes this button: either
 * kind of sheet can be written or continued at any time.
 */
export function nextSheetAction(
  sheets: readonly PracticeSheet[],
  sets: number,
): { kind: "continue"; path: string; label: string } | { kind: "write"; label: string } {
  const unfinished = sheets.find(
    (s) => (s.set === null || isTextSheet(s, sets)) && s.written < s.prompts,
  );
  if (unfinished)
    return {
      kind: "continue",
      path: unfinished.path,
      label: isTextSheet(unfinished, sets)
        ? t("ai.learn.continueSheet", { set: unfinished.set ?? 0 })
        : t("ai.learn.continueTitle", { title: unfinished.title }),
    };
  for (let set = 1; set <= sets; set++) {
    if (!sheets.some((s) => s.set === set)) {
      return { kind: "write", label: t("ai.learn.writeSheet", { set }) };
    }
  }
  return { kind: "write", label: t("ai.learn.writeAnother") };
}

/** What learning has to go on, for `learnInfoText`. */
export interface LearnFacts {
  sheets: readonly PracticeSheet[];
  /** The text sets there are. */
  sets: number;
  /** Corrected words saved, and those the learned model has not learned from. */
  corrections: number;
  fresh: number;
  /** The learned model's record, and whether its file is on this device. */
  model: LearnedModel | undefined;
  onDevice: boolean;
}

/**
 * "Learn your handwriting"'s ⓘ: what learning needs, what there is, and
 * what happens next.
 */
export function learnInfoText(facts: LearnFacts): string {
  const { sheets, sets, corrections, fresh, model } = facts;
  const lines = sheets.reduce((sum, sheet) => sum + sheet.written, 0);
  const needs = t("ai.learn.infoNeeds", { min: MIN_PRACTICE_LINES });
  const hasVars = {
    lines: tn("ai.learn.copiedLines", lines),
    written: writtenSets(sheets, sets),
    sets,
    words: tn("ai.learn.correctedWords", corrections),
    fresh,
  };
  const has =
    facts.onDevice && model ? t("ai.learn.infoHasSince", hasVars) : t("ai.learn.infoHas", hasVars);
  let next: string;
  if (lines + corrections < MIN_PRACTICE_LINES) {
    next = t("ai.learn.infoNextMore", { count: MIN_PRACTICE_LINES - lines - corrections });
  } else if (!facts.onDevice || !model) {
    next = t("ai.learn.infoNextLearn");
  } else if (fresh === 0 && model.sources && !hasUnusedLines(sheets, model)) {
    next = t("ai.learn.infoNextAll");
  } else {
    const left = Math.max(0, RELEARN_AFTER - fresh);
    next =
      left > 0
        ? t("ai.learn.infoNextAfter", { words: tn("ai.learn.moreCorrectedWords", left) })
        : t("ai.learn.infoNextEnough");
  }
  return [needs, has, next].join(" ");
}

/** The confirmation before deleting the learned model. */
export function deleteQuestion(model: LearnedModel | undefined, previous: boolean): string {
  if (model) {
    return t(previous ? "ai.learned.deleteWasPrevious" : "ai.learned.deleteWas", {
      from: learnedFrom(model),
    });
  }
  return t(previous ? "ai.learned.deletePrevious" : "ai.learned.delete");
}

/** What "Go back to the previous model" says about the model it goes back to. */
export function undoText(previous: LearnedModel | undefined): string {
  if (!previous) return t("ai.learned.undoLast");
  return t("ai.learned.undo", { from: learnedFrom(previous), after: previous.after });
}
