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

/** What step 1 says: what to do with a practice sheet, and how far along the user is. */
export function writeStepText(sheets: readonly PracticeSheet[], sets: number): string {
  const how =
    "Each sheet has grey lines to copy: write each one on the empty line under it, in your " +
    "everyday handwriting, then close the sheet.";
  const written = writtenSets(sheets, sets);
  if (sheets.length === 0) return `${how} There are ${sets} sheets; start with the first.`;
  return `${how} ${written} of ${sets} sheets written; every sheet you add helps it learn.`;
}

/** What step 2 says, from the lines written and the words corrected so far. */
export function learnStepText(lines: number, corrections: number, model: boolean): string {
  const total = lines + corrections;
  if (total < MIN_PRACTICE_LINES) {
    return (
      `Copy at least ${MIN_PRACTICE_LINES} lines first (${total} so far). ` +
      "Then FineNotes learns from them on this device, in a few minutes."
    );
  }
  const words = corrections > 0 ? ` and ${plural(corrections, "corrected word")}` : "";
  return (
    `Learns from your ${plural(lines, "copied line")}${words} on this device, in a few minutes; ` +
    "you can keep writing meanwhile. It keeps the result only if it reads your test lines " +
    "better than Grape alone" +
    (model ? ", and the model you have now stays as the one to go back to." : ".")
  );
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
