/**
 * Handwritten maths in a text note's handwriting sections, as a notebook
 * page has it (`calc-notes.ts`): write a sum that ends in "=" and lift the
 * pen; a moment later Grape reads the line on this device and its answer
 * shows after the "=" ("12×4 = 48"). A tap writes the answer as ink, at the
 * line's own height, in the writer's hand when they wrote the symbol sheet.
 * Writing on, or ignoring it, leaves the section as it was.
 *
 * Also as on a page: a letter set on a line above ("a = 5") is used, "x ="
 * solves the equation on the line or above it, and a line with ink after its
 * "=" ("2x + 3 = 7") offers its solution.
 *
 * A misread digit would give a confident wrong answer, so nothing is written
 * until the user has seen what was read and tapped it.
 */

import { fitAnswer, type GlyphSet, glyphsFor, writeWithPowers } from "../model/answer-glyphs";
import {
  type AnswerPlace,
  type EqualsSign,
  answerPlace,
  answerPlaceAfter,
  equalsAfter,
  equalsAtEnd,
  isSumInk,
  sumStrokes,
} from "../model/calc-ink";
import { readWhole, type SumReading } from "../model/calc-layout";
import {
  askedLetter,
  equationLetter,
  equationOfLine,
  evaluateSum,
  mathsClause,
  needsVariables,
  sumOfLine,
  suggestionLabel,
  variablesOfLines,
  answerText,
} from "../model/calc-note";
import { equationAnswer } from "../model/calc-tex";
import type { CalcValue } from "../model/calculator";
import { type Stroke, strokeBounds } from "../model/document";
import { INK_WIDTH, type InkBlock } from "../model/text-note";
import { CALC_DELAY_MS, readSumLine } from "./calc-notes";
import { type HandwritingReader, inkForReading } from "./handwriting";

/** What reading maths in a note needs from the plugin. */
export interface InkMathsHost {
  /** Whether to work sums out now: calculation notes and reading on the device are on. */
  enabled(): boolean;
  reader: Pick<HandwritingReader, "model" | "readGroups" | "readPage">;
  /** The writer's glyphs from their symbol sheet, or null (the clean ones are used). */
  glyphs(): Promise<GlyphSet | null>;
}

/** What it needs from the note's page: the sections and a way to change one. */
export interface InkMathsOwner {
  block(id: string): InkBlock | null;
  /** Show (or with null, take away) the answer on a section. */
  show(id: string, answer: InkAnswer | null): void;
  newStrokeId(): string;
  /** The section's ink changed: one undo step. */
  commit(id: string, next: InkBlock): void;
}

/** An answer shown on a section, in section units. */
export interface InkAnswer {
  x: number;
  baseline: number;
  height: number;
  /** What is shown: what was read and its answer ("12×4 = 48"). */
  label: string;
  /** A tap writes it. */
  write(): void;
}

/** What was found on a line: the answer's text to write, and the label shown. */
interface Found {
  text: string;
  label: string;
}

/** The ids of a section's last strokes, which must still be its last when the answer comes back. */
function lastIds(strokes: readonly Stroke[], n: number): string {
  const ink = strokes.filter(isSumInk);
  return ink
    .slice(-n)
    .map((s) => s.id)
    .join(" ");
}

export class InkMaths {
  private timer = 0;
  /** Bumped by every stroke and pen-down: a reading that comes back after one is dropped. */
  private token = 0;
  /** The section showing an answer now. */
  private showing: string | null = null;

  constructor(
    private readonly host: InkMathsHost,
    private readonly owner: InkMathsOwner,
    private readonly win: Window = window,
  ) {}

  /** A pen stroke was drawn in a section: if it finished a sum, read the line once the pen rests. */
  strokeDrawn(id: string): void {
    this.cancel();
    if (!this.host.enabled()) return;
    const block = this.owner.block(id);
    if (!block) return;
    const eq = equalsAtEnd(block.strokes);
    const rest = eq ? null : equalsAfter(block.strokes, []);
    if (!eq && !rest) return;
    const token = this.token;
    this.timer = this.win.setTimeout(() => {
      this.timer = 0;
      const asked = eq
        ? this.suggest(id, eq, token)
        : rest
          ? this.suggestWhole(id, rest.eq, rest.after, token)
          : Promise.resolve();
      void asked.catch(() => undefined);
    }, CALC_DELAY_MS);
  }

  /** The pen touched the note: writing on puts the answer away. */
  penDown(): void {
    this.cancel();
    this.hide();
  }

  dispose(): void {
    this.cancel();
    this.hide();
  }

  private cancel(): void {
    this.win.clearTimeout(this.timer);
    this.timer = 0;
    this.token++;
  }

  private hide(): void {
    if (this.showing) this.owner.show(this.showing, null);
    this.showing = null;
  }

  /** A sum that ends in its "=". */
  private async suggest(id: string, eq: EqualsSign, token: number): Promise<void> {
    const reader = this.host.reader;
    await reader.model();
    const block = this.owner.block(id);
    if (!block || token !== this.token || !this.host.enabled()) return;
    const last = lastIds(block.strokes, 2);
    const strokes = sumStrokes(block.strokes, eq, []);
    const reading = await readSumLine(reader, strokes, eq);
    if (!reading || token !== this.token) return;
    let above: string[] | null = null;
    const linesAbove = async (): Promise<string[]> =>
      (above ??= await this.linesAbove(block, strokes));
    let found = this.work(reading.text, new Map());
    if (found === "variables") {
      const vars = variablesOfLines(await linesAbove());
      if (token !== this.token) return;
      found = this.work(reading.text, vars);
      if (found === "variables") found = null;
    }
    if (!found) {
      // "x =": the equation in x on this line, or the nearest one above.
      const letter = askedLetter(reading.text);
      const equation = letter
        ? (equationOfLine(reading.text, letter) ??
          [...(await linesAbove())]
            .reverse()
            .map((line) => equationOfLine(line, letter))
            .find((e) => e !== null) ??
          null)
        : null;
      if (token !== this.token) return;
      const forms = equation ? equationAnswer(equation.lhs, equation.rhs, equation.letter) : null;
      if (forms && equation) {
        found = {
          text: forms.decimal.text,
          label: `${equation.letter} = ${forms.decimal.shown ?? forms.decimal.text}`,
        };
      }
    }
    if (!found) return;
    this.open(id, last, 2, strokes, answerPlace(strokes, eq), eq, found, token);
  }

  /** A line with ink after its "=" ("2x + 3 = 7"): its solution, written after the line. */
  private async suggestWhole(
    id: string,
    eq: EqualsSign,
    after: Stroke[],
    token: number,
  ): Promise<void> {
    const reader = this.host.reader;
    await reader.model();
    const block = this.owner.block(id);
    if (!block || token !== this.token || !this.host.enabled()) return;
    const last = lastIds(block.strokes, after.length);
    const strokes = [...sumStrokes(block.strokes, eq, []), ...after];
    const ink = strokes.filter(isSumInk);
    const [line] = await reader.readGroups([inkForReading(ink)], { chars: true, math: true });
    if (!line || token !== this.token) return;
    const reading: SumReading = readWhole(ink, {
      text: line.text,
      confidence: line.confidence,
      greedy: line.greedy,
      chars: line.chars,
    });
    const clause = mathsClause(reading.text);
    const letter = equationLetter(clause);
    const equation = letter ? equationOfLine(clause, letter) : null;
    const forms = equation ? equationAnswer(equation.lhs, equation.rhs, equation.letter) : null;
    if (!forms || !equation) return;
    const value = forms.decimal.text;
    const found: Found = {
      text: `${equation.letter}=${value}`,
      label: `${equation.letter} = ${forms.decimal.shown ?? value}`,
    };
    const place = answerPlaceAfter(answerPlace(strokes.slice(0, -after.length), eq), after);
    // Beside the equation, a little apart from it.
    const spaced = { ...place, x: place.x + place.height * 0.8 };
    this.open(id, last, after.length, strokes, spaced, eq, found, token);
  }

  /** The reading worked out, "variables" when it needs ones set above, or null. */
  private work(reading: string, vars: ReadonlyMap<string, CalcValue>): Found | "variables" | null {
    const sum = sumOfLine(reading, vars);
    const result = sum ? evaluateSum(sum, vars) : null;
    if (sum && result?.ok) {
      const answer = answerText(result.value);
      return answer ? { text: answer.text, label: suggestionLabel(sum, answer) } : null;
    }
    const letters = /[A-Za-z]/.test(reading.replace(/=\s*$/, ""));
    if (vars.size > 0 || !(letters || (result !== null && needsVariables(result)))) return null;
    return "variables";
  }

  /** The section's lines above the sum, read on this device, top to bottom. */
  private async linesAbove(block: InkBlock, sum: readonly Stroke[]): Promise<string[]> {
    const own = new Set(sum.map((s) => s.id));
    const top = Math.min(...sum.map((s) => strokeBounds(s)?.minY ?? Infinity));
    const above = block.strokes.filter((s) => !own.has(s.id));
    if (above.length === 0) return [];
    const reading = await this.host.reader.readPage(above);
    return reading.lines
      .filter((line) => line.box[3] <= top + 1)
      .sort((a, b) => a.box[1] - b.box[1])
      .map((line) => line.text);
  }

  private open(
    id: string,
    last: string,
    n: number,
    strokes: readonly Stroke[],
    place: AnswerPlace,
    eq: EqualsSign,
    found: Found,
    token: number,
  ): void {
    const block = this.owner.block(id);
    if (!block || token !== this.token || lastIds(block.strokes, n) !== last) return;
    this.hide();
    this.showing = id;
    this.owner.show(id, {
      ...place,
      label: found.label,
      write: () => void this.write(id, last, n, strokes, place, eq, found.text),
    });
  }

  /** Write the answer as ink after the "=", if the section's ink is still what was read. */
  private async write(
    id: string,
    last: string,
    n: number,
    strokes: readonly Stroke[],
    place: AnswerPlace,
    eq: EqualsSign,
    text: string,
  ): Promise<void> {
    const shown = text.replace(/\s+/g, "");
    const glyphs = glyphsFor(shown.replace(/\^/g, ""), await this.host.glyphs());
    this.hide();
    const block = this.owner.block(id);
    if (!glyphs || !block || lastIds(block.strokes, n) !== last) return;
    const raw = writeWithPowers(shown, glyphs, place);
    const lineLeft = Math.min(...strokes.map((s) => strokeBounds(s)?.minX ?? Infinity));
    const written = fitAnswer(raw, place, Number.isFinite(lineLeft) ? lineLeft : place.x, {
      width: INK_WIDTH,
      height: block.height,
    });
    const pen = eq.strokes[1];
    const ink: Stroke[] = written.map((pts) => ({
      id: this.owner.newStrokeId(),
      color: pen.color,
      size: pen.size,
      tool: pen.tool,
      ...(pen.nib !== undefined ? { nib: pen.nib } : {}),
      pts,
    }));
    this.owner.commit(id, { ...block, strokes: [...block.strokes, ...ink] });
  }
}
