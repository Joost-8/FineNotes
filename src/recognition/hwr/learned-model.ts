/**
 * The learned handwriting model as the settings describe it: what it was
 * learned from, how much better it reads than Grape alone, which practice
 * sheets are written and which of them it was built from, and the words of
 * the steps that make one (view/handwriting-learning.ts does the file work).
 *
 * PURE: no DOM, no Obsidian.
 */

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
  if (total === 0) {
    return "Corrected words: none yet. Tap an underlined word in a notebook to correct it.";
  }
  const learned = model ? " since your model learned" : "";
  return (
    `Corrected words: ${fresh} new${learned}, of ${total} saved. ` +
    `At ${RELEARN_AFTER} new words, FineNotes offers to learn again.`
  );
}

/** The reminder's words, for `fresh` new corrected words: a title and one line under it. */
export function relearnText(fresh: number, learned: boolean): { title: string; body: string } {
  return learned
    ? {
        title: "Learn your handwriting again",
        body: `${fresh} words corrected since the last time.`,
      }
    : {
        title: "Learn your handwriting",
        body: `${fresh} words corrected: enough to learn from.`,
      };
}

/** "21 Oct 2026": a learned date as the settings show it, the same on every device. */
export function learnedDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  const months = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
  if (!year || !month || !day || month > 12) return iso.slice(0, 10);
  return `${day} ${months[month - 1]} ${year}`;
}

/** How many fewer characters it gets wrong than Grape alone, in whole %; 0 when not fewer. */
export function fewerMistakes(model: Pick<LearnedModel, "before" | "after">): number {
  if (!(model.before > 0) || model.after >= model.before) return 0;
  return Math.round((100 * (model.before - model.after)) / model.before);
}

/** "learned 21 Oct 2026 from 240 of your lines": when and from how much. */
export function learnedFrom(model: LearnedModel): string {
  const words = model.corrections ? ` and ${plural(model.corrections, "corrected word")}` : "";
  return `learned ${learnedDate(model.learnedAt)} from ${model.lines} of your lines${words}`;
}

/** "On 60 test lines it gets 4.1 % of characters wrong, against 9.8 % with Grape alone: 58 % fewer mistakes." */
export function learnedResult(model: LearnedModel): string {
  const fewer = fewerMistakes(model);
  return (
    `On ${model.tested} test lines it gets ${model.after} % of characters wrong, against ` +
    `${model.before} % with Grape alone` +
    (fewer > 0 ? `: ${fewer} % fewer mistakes.` : ".")
  );
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
          text: `Its file is not on this device (${learnedFrom(model)}). Reading uses Grape alone until sync brings it.`,
        }
      : { tone: "missing", text: "Not learned yet." };
  }
  const when = model ? `, ${learnedFrom(model)}` : "";
  return inUse
    ? { tone: "ready", text: `On this device and in use${when}.` }
    : { tone: "off", text: `On this device, switched off: reading uses Grape alone${when}.` };
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
    return { tone: "missing", text: model ? "Not on this device yet" : "Not learned yet" };
  }
  if (!inUse) return { tone: "off", text: "Off · Grape alone" };
  return {
    tone: "ready",
    text: model ? `In use · ${model.before} % → ${model.after} %` : "In use",
  };
}

/** "2 of 3 sheets · 49 lines": how far learning has come, in one line. */
export function learnSummary(sheets: readonly PracticeSheet[], sets: number): string {
  const written = writtenSets(sheets, sets);
  const lines = sheets.reduce((sum, sheet) => sum + sheet.written, 0);
  return `${written} of ${sets} sheets · ${plural(lines, "line")}`;
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
      ? "nothing copied yet"
      : sheet.written >= sheet.prompts
        ? `all ${sheet.prompts} lines copied`
        : `${sheet.written} of ${sheet.prompts} lines copied`;
  switch (use) {
    case "used":
      return `${copied} · in your learned model`;
    case "more":
      return `${copied} · in your learned model, with fewer lines: learn again to use the rest`;
    case "new":
      return `${copied} · not in your learned model yet`;
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
        ? `Continue sheet ${unfinished.set}`
        : `Continue ${unfinished.title}`,
    };
  for (let set = 1; set <= sets; set++) {
    if (!sheets.some((s) => s.set === set)) return { kind: "write", label: `Write sheet ${set}` };
  }
  return { kind: "write", label: "Write another sheet" };
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
  const needs =
    `Needs: at least ${MIN_PRACTICE_LINES} copied lines or corrected words. Copy the grey ` +
    "lines of a practice sheet in your everyday handwriting, and tap underlined words in " +
    "your notes to correct them.";
  const since = facts.onDevice && model ? ` (${fresh} new since your model learned)` : "";
  const has =
    `Has: ${plural(lines, "copied line")} on ${writtenSets(sheets, sets)} of ${sets} sheets, ` +
    `and ${plural(corrections, "corrected word")}${since}. ` +
    "Corrections are kept, also when a learning run fails or is stopped.";
  let next: string;
  if (lines + corrections < MIN_PRACTICE_LINES) {
    next = `Next: ${MIN_PRACTICE_LINES - lines - corrections} more lines or words, then Learn now.`;
  } else if (!facts.onDevice || !model) {
    next =
      "Next: Learn now. It takes a few minutes on this device, and keeps the result only " +
      "if it reads your test lines better than Grape alone.";
  } else if (fresh === 0 && model.sources && !hasUnusedLines(sheets, model)) {
    next = "Next: your model has all of it. Write another sheet or correct more words first.";
  } else {
    const left = Math.max(0, RELEARN_AFTER - fresh);
    next =
      (left > 0
        ? `Next: after ${plural(left, "more corrected word")}, FineNotes offers to learn again; `
        : "Next: enough new words to learn again; ") +
      "Learn again starts it now. The model you have stays to go back to.";
  }
  return [needs, has, next].join(" ");
}

/** The confirmation before deleting the learned model. */
export function deleteQuestion(model: LearnedModel | undefined, previous: boolean): string {
  const what = model ? `It was ${learnedFrom(model)}. ` : "";
  const files = previous
    ? "Its file and the one before it are deleted from this vault"
    : "Its file is deleted from this vault";
  return (
    `${what}${files}, and through sync from your other devices; reading goes back to Grape ` +
    "alone. Your practice sheets stay, so you can learn again, which takes a few minutes. " +
    "To stop using it but keep it, switch off “Read with my learned model” instead."
  );
}

/** What "Go back to the previous model" says about the model it goes back to. */
export function undoText(previous: LearnedModel | undefined): string {
  const which = previous
    ? `the one ${learnedFrom(previous)}, which got ${previous.after} % of characters wrong`
    : "the one you had before the last learning";
  return `Swap your learned model for ${which}. Your current one is kept, so you can swap back.`;
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
