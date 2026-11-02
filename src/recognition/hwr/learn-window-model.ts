/**
 * The "Learn your handwriting" window as one state: which step you are on,
 * the three practice sheets as marks, what there is to learn from, and the
 * one button that does the next step (a second, quieter one where there is
 * a real alternative). The window, the AI menu's row, the settings row and
 * the practice sheet's button all read it, so they always agree.
 *
 * PURE: no DOM, no Obsidian.
 */

import { t, tn } from "../../i18n/translate";
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
      title: t("ai.learn.runningTitle"),
      lead: t("ai.learn.runningLead", { from }),
      percent,
      minutesLeft: left,
      note: t("ai.learn.runningNote"),
      buttons: [
        { label: t("common.close"), action: { kind: "close" }, cta: false },
        { label: t("ai.learn.stop"), action: { kind: "stop" }, cta: false },
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
      title: t("ai.learn.betterTitle"),
      lead: t("ai.learn.testedLead", { tested: result.tested }),
      note: t("ai.learn.betterNote", { percent: fewerMistakes(result) }),
      buttons: [
        { label: t("ai.learn.backToGrape"), action: { kind: "grape" }, cta: false },
        { label: t("common.done"), action: { kind: "close" }, cta: true },
      ],
    };
  }
  if (result?.kind === "kept") {
    return {
      ...base,
      phase: "kept",
      title: t(result.mine ? "ai.learn.keptMineTitle" : "ai.learn.keptGrapeTitle"),
      lead: t("ai.learn.testedLead", { tested: result.tested }),
      note: t(result.mine ? "ai.learn.keptMineNote" : "ai.learn.keptGrapeNote"),
      buttons: [
        { label: t("common.close"), action: { kind: "close" }, cta: false },
        { ...write, cta: true },
      ],
    };
  }
  if (result?.kind === "failed" || result?.kind === "nothing") {
    return {
      ...base,
      phase: "failed",
      title: t("ai.learn.stoppedTitle"),
      lead:
        result.kind === "failed"
          ? t("ai.learn.failedLead", { message: result.message })
          : t("ai.learn.nothingLead"),
      note: t("ai.learn.stoppedNote"),
      buttons: [
        { label: t("common.close"), action: { kind: "close" }, cta: false },
        { label: t("common.retry"), action: { kind: "learn" }, cta: true },
      ],
    };
  }
  const marks = sheetMarks(sheets, sets, next);
  const symbols = facts.symbolsWanted;
  if (missing > 0) {
    return {
      ...base,
      phase: "start",
      title: t("ai.learn.title"),
      lead: t("ai.learn.startLead"),
      marks,
      symbols,
      buttons: [{ ...write, cta: true }],
    };
  }
  return {
    ...base,
    phase: "ready",
    title: t("ai.learn.title"),
    lead: t("ai.learn.readyLead", { from }),
    marks,
    symbols,
    note: t("ai.learn.readyNote"),
    buttons: [write, { label: t("ai.learn.learnNow"), action: { kind: "learn" }, cta: true }],
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
      marks.push({ set, state: "done", detail: tn("ai.learn.lines", written) });
    } else if (written > 0) {
      marks.push({ set, state: "started", detail: t("ai.learn.ofCount", { written, prompts }) });
    } else if (set === nextSet) {
      marks.push({ set, state: "next", detail: t("ai.learn.toWrite") });
    } else {
      marks.push({ set, state: "todo", detail: "" });
    }
  }
  return marks;
}

/** "30 lines and 4 corrected words". */
function materialText(lines: number, corrections: number): string {
  const copied = tn("ai.learn.lines", lines);
  if (corrections === 0) return copied;
  return t("ai.learn.linesAndWords", {
    lines: copied,
    words: tn("ai.learn.correctedWords", corrections),
  });
}

/**
 * The practice sheet's button: its count, and whether it is the next step.
 * Outlined, "4 / 10", until there is enough; filled, "30 lines", after.
 */
export function sheetButton(lines: number, corrections: number): { count: string; ready: boolean } {
  const total = lines + corrections;
  if (total < MIN_PRACTICE_LINES)
    return { count: `${total} / ${MIN_PRACTICE_LINES}`, ready: false };
  return { count: tn("ai.learn.lines", lines), ready: true };
}
