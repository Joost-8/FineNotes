/**
 * The "Learn your handwriting" window as one state: which step you are on,
 * the three practice sheets as marks, what there is to learn from, and the
 * one button that does the next step (a second, quieter one where there is
 * a real alternative). The window, the AI menu's row, the settings row and
 * the practice sheet's button all read it, so they always agree.
 *
 * PURE: no DOM, no Obsidian.
 */

import {
  MIN_PRACTICE_LINES,
  type PracticeSheet,
  fewerMistakes,
  nextSheetAction,
} from "./learned-model";

/** How a learning run ended, as the window tells it. */
export type LearnResult =
  /** The new model reads better, and is now in use. */
  | { kind: "better"; tested: number; before: number; after: number }
  /** It did not beat the model in use (Grape, or the one learned before): nothing changed. */
  | { kind: "kept"; tested: number; kept: number; learned: number; mine: boolean }
  /** The practice lines held nothing to learn from. */
  | { kind: "nothing" }
  /** It stopped with an error; the sheets and corrected words are kept. */
  | { kind: "failed"; message: string };

/** A run in progress, as the learner reports it. */
export interface LearnRun {
  step: number;
  steps: number;
  startedAt: number;
}

/** What the window is shown from. */
export interface LearnWindowFacts {
  sheets: readonly PracticeSheet[];
  /** The text sets there are (sheets 1 to 3). */
  sets: number;
  /** Words corrected under "Underline words it may have misread". */
  corrections: number;
  /** The run going on now, or null. */
  run: LearnRun | null;
  /** How the last run ended, while the window that started it is open; else null. */
  result: LearnResult | null;
  /** The symbol sheet is still to write (none yet, or symbols were added since). */
  symbolsWanted: boolean;
  /** Now, in ms, for the time left. */
  now: number;
}

/** What a button does. */
export type LearnAction =
  | { kind: "write" }
  | { kind: "continue"; path: string }
  | { kind: "symbols" }
  | { kind: "learn" }
  | { kind: "stop" }
  | { kind: "grape" }
  | { kind: "close" };

export interface LearnButton {
  label: string;
  action: LearnAction;
  /** The filled one: the next step. */
  cta: boolean;
}

/** One of the three sheets, as a mark. */
export interface SheetMark {
  set: number;
  state: "done" | "started" | "next" | "todo";
  /** Under its name: "30 lines", "12 of 30", "to write". */
  detail: string;
}

export type LearnPhase = "start" | "ready" | "running" | "better" | "kept" | "failed";

export interface LearnWindowView {
  phase: LearnPhase;
  title: string;
  /** One line under the title. */
  lead: string;
  /** The sheets, while there is a step to take (start, ready). */
  marks: SheetMark[];
  /** Copied lines, and how many more are needed (0 when there are enough). */
  lines: number;
  missing: number;
  /** The run's share done, 0–100, and minutes left (null until it can tell). */
  percent: number;
  minutesLeft: number | null;
  /** A line of fine print, above the buttons. */
  note: string;
  /** Right to left, as the buttons sit: the last is the next step. */
  buttons: LearnButton[];
  /** Offer the symbol sheet beside the three. */
  symbols: boolean;
}

/** Copied lines plus corrected words, against the {@link MIN_PRACTICE_LINES} needed. */
export function learnMaterial(
  sheets: readonly PracticeSheet[],
  corrections: number,
): { lines: number; missing: number } {
  const lines = sheets.reduce((sum, sheet) => sum + sheet.written, 0);
  return { lines, missing: Math.max(0, MIN_PRACTICE_LINES - lines - corrections) };
}

/** The window for `facts`. */
export function learnWindow(facts: LearnWindowFacts): LearnWindowView {
  const { sheets, sets, corrections, run, result } = facts;
  const { lines, missing } = learnMaterial(sheets, corrections);
  const base = {
    marks: [] as SheetMark[],
    lines,
    missing,
    percent: 0,
    minutesLeft: null,
    note: "",
    symbols: false,
  };
  const from = materialText(lines, corrections);
  if (run) {
    const percent = run.steps > 0 ? Math.round((100 * run.step) / run.steps) : 0;
    const left =
      run.step > 0
        ? Math.max(
            1,
            Math.round((((facts.now - run.startedAt) / run.step) * (run.steps - run.step)) / 60000),
          )
        : null;
    return {
      ...base,
      phase: "running",
      title: "Learning your handwriting",
      lead: `From ${from}.`,
      percent,
      minutesLeft: left,
      note: "You can close this window and keep writing; the AI menu shows how far it is.",
      buttons: [
        { label: "Close", action: { kind: "close" }, cta: false },
        { label: "Stop", action: { kind: "stop" }, cta: false },
      ],
    };
  }
  const next = nextSheetAction(sheets, sets);
  const write: LearnButton = {
    label: next.label,
    action: next.kind === "continue" ? { kind: "continue", path: next.path } : { kind: "write" },
    cta: false,
  };
  if (result?.kind === "better") {
    return {
      ...base,
      phase: "better",
      title: "It reads you better",
      lead: `Tested on ${result.tested} of your lines it had not seen.`,
      note:
        `${fewerMistakes(result)} % fewer mistakes; it now reads with your model. For more, ` +
        "write another sheet or correct more words, then learn again.",
      buttons: [
        { label: "Go back to Grape", action: { kind: "grape" }, cta: false },
        { label: "Done", action: { kind: "close" }, cta: true },
      ],
    };
  }
  if (result?.kind === "kept") {
    const kept = result.mine ? "your model" : "Grape";
    return {
      ...base,
      phase: "kept",
      title: `${result.mine ? "Your model" : "Grape"} still reads you better`,
      lead: `Tested on ${result.tested} of your lines it had not seen.`,
      note: `Nothing changed: ${kept} stays. Another sheet usually helps: more lines, other words.`,
      buttons: [
        { label: "Close", action: { kind: "close" }, cta: false },
        { ...write, cta: true },
      ],
    };
  }
  if (result?.kind === "failed" || result?.kind === "nothing") {
    return {
      ...base,
      phase: "failed",
      title: "Learning stopped",
      lead:
        result.kind === "failed"
          ? `${result.message}.`
          : "There was nothing to learn from in the copied lines.",
      note: "Your sheets and corrected words are kept.",
      buttons: [
        { label: "Close", action: { kind: "close" }, cta: false },
        { label: "Try again", action: { kind: "learn" }, cta: true },
      ],
    };
  }
  const marks = sheetMarks(sheets, sets, next);
  const symbols = facts.symbolsWanted;
  if (missing > 0) {
    return {
      ...base,
      phase: "start",
      title: "Learn your handwriting",
      lead:
        "Copy a few lines, and FineNotes learns to read your writing better. It all happens " +
        "on this device.",
      marks,
      symbols,
      buttons: [{ ...write, cta: true }],
    };
  }
  return {
    ...base,
    phase: "ready",
    title: "Learn your handwriting",
    lead: `Ready to learn from ${from}.`,
    marks,
    symbols,
    note:
      "It takes a few minutes in the background, so you can keep writing, and keeps the " +
      "result only if it reads you better than now. Keep your sheets: each run learns from " +
      "all of them.",
    buttons: [write, { label: "Learn now", action: { kind: "learn" }, cta: true }],
  };
}

/** Sheets 1 to `sets` as marks: done, started, the next to write, or still to come. */
function sheetMarks(
  sheets: readonly PracticeSheet[],
  sets: number,
  next: ReturnType<typeof nextSheetAction>,
): SheetMark[] {
  // The set the next step is on: the sheet to continue, else the first not made yet.
  const nextSet =
    next.kind === "continue"
      ? (sheets.find((sheet) => sheet.path === next.path)?.set ?? null)
      : (Array.from({ length: sets }, (_, i) => i + 1).find(
          (set) => !sheets.some((sheet) => sheet.set === set),
        ) ?? null);
  const marks: SheetMark[] = [];
  for (let set = 1; set <= sets; set++) {
    const own = sheets.filter((sheet) => sheet.set === set);
    const written = own.reduce((sum, sheet) => sum + sheet.written, 0);
    const prompts = own.reduce((sum, sheet) => sum + sheet.prompts, 0);
    if (prompts > 0 && written >= prompts) {
      marks.push({ set, state: "done", detail: `${written} lines` });
    } else if (written > 0) {
      marks.push({ set, state: "started", detail: `${written} of ${prompts}` });
    } else if (set === nextSet) {
      marks.push({ set, state: "next", detail: "to write" });
    } else {
      marks.push({ set, state: "todo", detail: "" });
    }
  }
  return marks;
}

/** "30 lines and 4 corrected words". */
function materialText(lines: number, corrections: number): string {
  const copied = `${lines} line${lines === 1 ? "" : "s"}`;
  if (corrections === 0) return copied;
  return `${copied} and ${corrections} corrected word${corrections === 1 ? "" : "s"}`;
}

/**
 * The practice sheet's button: its count, and whether it is the next step.
 * Outlined, "4 / 10", until there is enough; filled, "30 lines", after.
 */
export function sheetButton(lines: number, corrections: number): { count: string; ready: boolean } {
  const total = lines + corrections;
  if (total < MIN_PRACTICE_LINES)
    return { count: `${total} / ${MIN_PRACTICE_LINES}`, ready: false };
  return { count: `${lines} line${lines === 1 ? "" : "s"}`, ready: true };
}
