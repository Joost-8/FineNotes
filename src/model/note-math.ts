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
  askedLetter,
  assignmentOfLine,
  equationOfLine,
  evaluateSum,
  functionGraphSpec,
  functionOfLine,
  mathsClause,
  sumOfLine,
} from "./calc-note";
import { equationAnswer } from "./calc-tex";
import type { GraphSpec } from "./graph";
import { blockText, type NoteBlock, type TextNote } from "./text-note";

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
  /** The lines above that hold an "=", nearest last: where "x =" looks for its equation. */
  const above: string[] = [];
  for (const block of blocks) {
    if (block.type !== "text" || block.kind === "mono") continue;
    const text = blockText(block);
    if (text.length === 0 || text.length > MAX_LINE || !text.includes("=")) continue;
    const answer = answerOfLine(text, variables) ?? solutionOfLine(text, above);
    above.push(text);
    if (answer) {
      answers.set(block.id, answer);
      continue;
    }
    const set = assignmentOfLine(text, variables);
    if (set) variables.set(set.name, set.value);
  }
  return answers;
}

/** How far up "x =" looks for the equation it asks about, in lines with an "=". */
const EQUATION_REACH = 6;

/**
 * The solution a line that asks for a letter shows ("2x + 3 = 7, x =", or
 * "x =" under the equation): the notebook's own solver, as calculation
 * notes solve a handwritten one. Several solutions are joined by "or".
 * Null when the line asks for nothing, or there is nothing to solve.
 */
export function solutionOfLine(text: string, above: readonly string[] = []): LineAnswer | null {
  if (text.length > MAX_LINE) return null;
  const letter = askedLetter(text);
  if (!letter) return null;
  let equation = equationOfLine(text, letter);
  for (
    let i = above.length - 1;
    !equation && i >= Math.max(0, above.length - EQUATION_REACH);
    i--
  ) {
    // A line above is the equation whole: its own "x =" at the end is not one.
    if (askedLetter(above[i]) === letter && !equationOfLine(above[i], letter)) continue;
    equation = equationOfLine(above[i], letter) ?? equationOfLine(mathsClause(above[i]), letter);
  }
  if (!equation) return null;
  const forms = equationAnswer(equation.lhs, equation.rhs, equation.letter);
  if (!forms) return null;
  const values = forms.decimal.text.split(", ");
  const typed = values.join(" or ");
  const minus = values.map((v) => v.replace(/^-/, "−")).join(" or ");
  return { text: typed, shown: forms.decimal.exact ? minus : `≈ ${minus}` };
}

/**
 * The graphs a note's lines offer, by block id: a line that defines a
 * function ("f(x) = x^2 - 1", "y = 2x + 1") can be plotted in one tap. A
 * line that already shows an answer offers none.
 */
export function noteGraphs(
  blocks: readonly NoteBlock[],
  answered: ReadonlyMap<string, LineAnswer> = new Map(),
): Map<string, GraphSpec> {
  const graphs = new Map<string, GraphSpec>();
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    // A line whose graph is already right under it offers no second one.
    if (blocks[i + 1]?.type === "graph") continue;
    if (block.type !== "text" || block.kind === "mono" || answered.has(block.id)) continue;
    const text = blockText(block);
    if (text.length === 0 || text.length > MAX_LINE || !text.includes("=")) continue;
    const spec = graphOfLine(text);
    if (spec) graphs.set(block.id, spec);
  }
  return graphs;
}

/** The graph of the function a line defines, or null. */
export function graphOfLine(text: string): GraphSpec | null {
  if (text.length > MAX_LINE) return null;
  const fn = functionOfLine(mathsClause(text));
  if (!fn || fn.body === null) return null;
  return functionGraphSpec({ name: fn.name, body: fn.body });
}

/** `note` with `block` put in right under block `index`. */
export function withBlockAfter(note: TextNote, index: number, block: NoteBlock): TextNote {
  const blocks = note.blocks.slice();
  blocks.splice(Math.max(0, Math.min(blocks.length, index + 1)), 0, block);
  return { blocks };
}

/**
 * What is typed at the end of a line to put its answer in after the "=":
 * a space first, unless the line already ends in one.
 */
export function answerSuffix(text: string, answer: LineAnswer): string {
  return /\s$/.test(text) ? answer.text : ` ${answer.text}`;
}
