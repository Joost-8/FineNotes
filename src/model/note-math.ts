/**
 * Typed maths in a text note, as Apple Notes' Math Notes does it: a line
 * that ends in "=" shows its answer after the "=", and a line that sets a
 * letter ("rate = 12") gives it a value for the lines below. The sums are
 * read and worked out by the notebook's own calculation notes
 * (`calc-note.ts`, on the calculator's engine), so a typed sum and a
 * handwritten one agree.
 *
 * Nothing here writes into the note: the view shows the answer, and puts
 * it in only when it is tapped.
 *
 * PURE: no DOM, no Obsidian.
 */

import type { CalcValue } from "./calculator";
import {
  type CalcVariables,
  answerText,
  assignmentOfLine,
  evaluateSum,
  sumOfLine,
} from "./calc-note";
import { blockText, type NoteBlock } from "./text-note";

/** The answer a line shows. */
export interface LineAnswer {
  /** As it is put in when tapped: the calculator's own spelling ("-3", "0.5"). */
  text: string;
  /** As it is shown: a minus sign, and "≈" before an answer that was rounded. */
  shown: string;
}

/** The longest line read for a sum: past it, a paragraph is prose. */
const MAX_LINE = 240;

/** The answer `text` shows with the variables set above it, or null. */
export function answerOfLine(text: string, variables: CalcVariables): LineAnswer | null {
  if (text.length > MAX_LINE || !/=\s*$/.test(text)) return null;
  const sum = sumOfLine(text, variables);
  if (!sum) return null;
  const result = evaluateSum(sum, variables);
  if (!result.ok) return null;
  const answer = answerText(result.value);
  if (!answer) return null;
  const minus = answer.text.replace(/^-/, "−");
  return { text: answer.text, shown: answer.exact ? minus : `≈ ${minus}` };
}

/**
 * Every answer a note shows, by block id: its text lines top to bottom,
 * each seeing the letters set above it. Code lines are left alone.
 */
export function noteAnswers(blocks: readonly NoteBlock[]): Map<string, LineAnswer> {
  const answers = new Map<string, LineAnswer>();
  const variables = new Map<string, CalcValue>();
  for (const block of blocks) {
    if (block.type !== "text" || block.kind === "mono") continue;
    const text = blockText(block);
    if (text.length === 0 || text.length > MAX_LINE || !text.includes("=")) continue;
    const answer = answerOfLine(text, variables);
    if (answer) {
      answers.set(block.id, answer);
      continue;
    }
    const set = assignmentOfLine(text, variables);
    if (set) variables.set(set.name, set.value);
  }
  return answers;
}

/**
 * What is typed at the end of a line to put its answer in after the "=":
 * a space first, unless the line already ends in one.
 */
export function answerSuffix(text: string, answer: LineAnswer): string {
  return /\s$/.test(text) ? answer.text : ` ${answer.text}`;
}
