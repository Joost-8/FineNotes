/**
 * Calculation notes (Settings › Models on this device, on by default): write
 * a line that ends in "=" and lift the pen; a moment later FineNotes reads
 * the line on this device and shows a suggestion beside it, what it read and
 * the answer ("12×4 = 48"). A tap writes the answer as ink, after the "=", at
 * the line's own height, in the writer's hand when they wrote the symbol
 * sheet; writing on, or ignoring it, leaves the page as it was.
 *
 * A misread digit would give a confident wrong answer, so nothing is
 * written until the user has seen what was read and tapped the suggestion.
 *
 * A line with ink after its "=" is read too: an equation in one letter
 * ("x + 5 = 7") offers its solution, a function ("y = 2x + 1") its graph.
 *
 * The pure parts: `model/calc-ink.ts` (the "=", the line, where the answer
 * goes), `model/calc-layout.ts` (raised dots and fractions, by where they
 * sit), `model/calc-note.ts` (the reading to a sum, the answer's text) and
 * `model/answer-glyphs.ts` (the letters it is written in).
 */

import { type App, Notice } from "obsidian";
import { writingLines } from "../canvas/backdrop";
import { measureEquation } from "../canvas/equation-paint";
import { t } from "../i18n/translate";
import {
  type GlyphSet,
  glyphsFor,
  glyphsFromSamples,
  writeFraction,
  writeWithPowers,
} from "../model/answer-glyphs";
import {
  type AnswerPlace,
  type EqualsSign,
  answerPlace,
  answerPlaceAfter,
  equalsAfter,
  equalsAtEnd,
  graphPlaceUnder,
  isSumInk,
  sumStrokes,
} from "../model/calc-ink";
import {
  type PieceReading,
  type SumReading,
  readLaidOut,
  readWhole,
  withPick,
} from "../model/calc-layout";
import {
  type NoteEquation,
  type NoteFunction,
  type NoteSum,
  askedLetter,
  equationLetter,
  equationOfLine,
  evaluateSum,
  functionGraphSpec,
  functionOfLine,
  needsVariables,
  sumOfLine,
  variablesOfLines,
} from "../model/calc-note";
import {
  type AnswerForms,
  answerForms,
  equationAnswer,
  expressionTex,
  polynomialAnswer,
} from "../model/calc-tex";
import type { CalcValue } from "../model/calculator";
import { DEFAULT_PAGE_GEOMETRY, type Page, type Stroke, strokeBounds } from "../model/document";
import { AddEquation, makeEquation, nextEquationId } from "../model/equation";
import {
  AddGraph,
  GRAPH_DEFAULT_H,
  GRAPH_DEFAULT_W,
  graphFrameHeight,
  graphFromSpec,
  nextGraphId,
} from "../model/graph-element";
import { CompositeCommand, RemoveStrokesFromPage } from "../model/page-commands";
import { parseInkFile } from "../model/serialize";
import { SYMBOL_SET, symbolSamples } from "../recognition/practice";
import { type HandwritingReader, inkForReading } from "./handwriting";
import { practiceFiles, practiceSetOf, type LearningHost } from "./handwriting-learning";
import type { Command } from "../model/commands";
import type { LineReading } from "../recognition/hwr/recognizer";
import type { CorrectionKind } from "../recognition/hwr/corrections";
import type { AnswerForm, CalcCardContent } from "./calc-card";
import { CalcReadingModal } from "./calc-reading-modal";
import type { CalcNoteSpec, InkSurface } from "./ink-surface";

/** How long after the pen lifts from the "=" the line is read, ms. */
export const CALC_DELAY_MS = 700;

/** What calculation notes need from the notebook view. */
export interface CalcNotesHost {
  app: App;
  /** Whether to calculate now: the setting is on, reading is on, the note can be written. */
  enabled(): boolean;
  surface(): InkSurface | null;
  page(pageId: string): Page | null;
  reader: HandwritingReader;
  /** Open the graph, to type a function into (a bare "f(x) =" has nothing to plot yet). */
  openGraph(): void;
  /** The practice files, for the symbol sheet's glyphs. */
  learning(): LearningHost;
  /**
   * Keep a labelled piece of ink for learning (`corrections.json`): what
   * Grape read, and what it is.
   */
  record(
    pageId: string,
    strokes: readonly Stroke[],
    read: string,
    text: string,
    kind: CorrectionKind,
  ): Promise<void>;
}

/** The calculation note open now: what was read, worked out, and what the card did with it. */
interface OpenNote {
  pageId: string;
  eq: EqualsSign;
  /** The ink written after the "=" ("x + 5 = 7"); empty when the "=" ends the line. */
  after: Stroke[];
  /** The sum's strokes, the "=" included. */
  strokes: Stroke[];
  place: AnswerPlace;
  reading: SumReading;
  vars: ReadonlyMap<string, CalcValue>;
  content: CalcCardContent;
  /** Pieces corrected with a pick (kept as misreads, not confirmed). */
  picked: Set<number>;
  /** Whether the reading was typed over in the card. */
  typed: boolean;
  /** The step that wrote the answer or made the equation, so its undo brings the glow back. */
  accepted: Command | null;
}

/** What the layout reader needs of a line Grape read. */
function pieceOf(l: LineReading): PieceReading {
  return { text: l.text, confidence: l.confidence, greedy: l.greedy, chars: l.chars };
}

/** A stroke's left edge, page px. */
function strokeLeft(stroke: Stroke): number {
  return strokeBounds(stroke)?.minX ?? Infinity;
}

/** The ink a suggestion was made for is still the page's last. */
function stillLast(page: Page, eq: EqualsSign, after: readonly Stroke[] = []): boolean {
  if (after.length > 0) {
    const ink = page.strokes.filter(isSumInk);
    return ink[ink.length - 1]?.id === after[after.length - 1].id;
  }
  const now = equalsAtEnd(page.strokes);
  return now !== null && now.strokes.every((s, i) => s.id === eq.strokes[i].id);
}

export class CalcNotes {
  private timer = 0;
  /** Bumped by every stroke and pen-down: a reading that comes back after one is dropped. */
  private token = 0;
  /** The note shown last (it stays after it is put out, for an undo of what the card did). */
  private note: OpenNote | null = null;
  /** The answer form last chosen in the card, kept for the next sum while the view is open. */
  private form: AnswerForm | null = null;
  private measureCtx: CanvasRenderingContext2D | null = null;

  constructor(private readonly host: CalcNotesHost) {}

  /** A pen stroke was drawn: if it finished an "=", read the line once the pen has rested. */
  strokeDrawn(pageId: string): void {
    this.cancel();
    if (!this.host.enabled()) return;
    const page = this.host.page(pageId);
    if (!page) return;
    const eq = equalsAtEnd(page.strokes);
    const rest = eq ? null : equalsAfter(page.strokes, writingLines(page.backdrop, page.geometry));
    if (!eq && !rest) return;
    const token = this.token;
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      const asked = eq
        ? this.suggest(pageId, eq, token)
        : rest
          ? this.suggestWhole(pageId, rest.eq, rest.after, token)
          : Promise.resolve();
      void asked.catch(() => undefined);
    }, CALC_DELAY_MS);
  }

  /** The pen touched the page: writing on drops the note, untouched. */
  penDown(): void {
    this.cancel();
    this.host.surface()?.hideCalcNote();
  }

  dispose(): void {
    this.cancel();
    this.host.surface()?.hideCalcNote();
    this.note = null;
  }

  /**
   * An undo or redo: undoing the answer written, or the typed equation made,
   * from the card brings the sum's glow back (the card closed); redoing it
   * puts the glow out again.
   */
  historyStep(command: Command, redo: boolean): void {
    const note = this.note;
    const surface = this.host.surface();
    if (!note || note.accepted !== command || !surface) return;
    if (redo) surface.hideCalcNote();
    else surface.showCalcNote(this.spec(note));
  }

  private cancel(): void {
    window.clearTimeout(this.timer);
    this.timer = 0;
    this.token++;
  }

  private async suggest(pageId: string, eq: EqualsSign, token: number): Promise<void> {
    const reader = this.host.reader;
    await reader.model();
    if (token !== this.token || !this.host.enabled()) return;
    const page = this.host.page(pageId);
    if (!page || !stillLast(page, eq)) return;
    const strokes = sumStrokes(page.strokes, eq, writingLines(page.backdrop, page.geometry));
    const reading = await this.read(strokes, eq);
    if (reading === null || token !== this.token) return;
    // The lines above are read once, for the variables they set and the
    // equation an "x =" asks about.
    let above: string[] | null = null;
    const linesAbove = async (): Promise<string[]> =>
      (above ??= await this.linesAbove(page, strokes));
    let found = this.work(reading.text, new Map());
    let vars: ReadonlyMap<string, CalcValue> = new Map();
    if (found === "variables") {
      vars = variablesOfLines(await linesAbove());
      if (token !== this.token) return;
      found = this.work(reading.text, vars);
    }
    let content: CalcCardContent | null = null;
    const solved =
      found && found !== "variables"
        ? { sum: found.sum, forms: answerForms(found.value) }
        : this.expanded(reading.text, vars);
    if (solved?.forms) content = this.content(solved.sum, solved.forms, reading);
    else {
      // "x =": the equation in x on this line, or the nearest one above.
      const letter = askedLetter(reading.text);
      if (letter) {
        const equation =
          equationOfLine(reading.text, letter) ??
          [...(await linesAbove())]
            .reverse()
            .map((line) => equationOfLine(line, letter))
            .find((e) => e !== null) ??
          null;
        if (token !== this.token) return;
        if (equation) content = this.equationContent(equation, reading);
      }
    }
    // "f(x) =" and "y =" with nothing to work out: the graph, to type it in.
    if (!content && functionOfLine(reading.text)?.body === null) {
      content = this.lineContent(reading);
    }
    if (!content) return;
    this.open(pageId, eq, [], strokes, answerPlace(strokes, eq), reading, vars, content, token);
  }

  /**
   * A line with ink after its "=", read whole (measured on real lines: as
   * good as reading the two sides apart, and it always finds the "="): an
   * equation in one letter, or a function.
   */
  private async suggestWhole(
    pageId: string,
    eq: EqualsSign,
    after: Stroke[],
    token: number,
  ): Promise<void> {
    const reader = this.host.reader;
    await reader.model();
    if (token !== this.token || !this.host.enabled()) return;
    const page = this.host.page(pageId);
    if (!page || !stillLast(page, eq, after)) return;
    const blocks = writingLines(page.backdrop, page.geometry);
    const strokes = [...sumStrokes(page.strokes, eq, blocks), ...after];
    const ink = strokes.filter(isSumInk);
    const [line] = await reader.readGroups([inkForReading(ink)], { chars: true, math: true });
    if (!line || token !== this.token) return;
    const whole = readWhole(ink, {
      text: line.text,
      confidence: line.confidence,
      greedy: line.greedy,
      chars: line.chars,
    });
    const eqIds = new Set(eq.strokes.map((s) => s.id));
    const reading = await this.withLayout(
      whole,
      strokes.filter((s) => !eqIds.has(s.id) && !after.includes(s)),
      after,
    );
    if (token !== this.token) return;
    const content = this.lineContent(reading);
    if (!content) return;
    const place = answerPlaceAfter(answerPlace(strokes.slice(0, -after.length), eq), after);
    this.open(pageId, eq, after, strokes, place, reading, new Map(), content, token);
  }

  /**
   * A whole line with its sides' layout: a raised power or dot, a stacked
   * fraction, where the marks sit says more than Grape reading them on the
   * line. Unchanged when neither side has any. Such a reading has no doubts
   * or pieces to keep: its characters no longer line up with the whole line's.
   */
  private async withLayout(
    whole: SumReading,
    left: readonly Stroke[],
    right: readonly Stroke[],
  ): Promise<SumReading> {
    const laid = (side: readonly Stroke[]): Promise<SumReading | null> =>
      readLaidOut(side, async (groups) =>
        (
          await this.host.reader.readGroups(groups.map(inkForReading), {
            chars: true,
            math: true,
          })
        ).map(pieceOf),
      );
    const [l, r] = await Promise.all([laid(left), laid(right)]);
    const parts = whole.text.split("=");
    if ((!l && !r) || parts.length !== 2) return whole;
    const side = (reading: SumReading | null, read: string): string =>
      reading ? reading.text.replace(/\s*=\s*$/, "") : read.trim();
    return {
      ...whole,
      text: `${side(l, parts[0])} = ${side(r, parts[1])}`,
      dot: l?.dot === true || r?.dot === true,
      fraction: l?.fraction === true || r?.fraction === true,
      doubts: [],
      pieces: [],
    };
  }

  /** The card for a line that is a function or an equation in one letter, or null. */
  private lineContent(reading: SumReading): CalcCardContent | null {
    const fn = functionOfLine(reading.text);
    if (fn) return this.functionContent(fn, reading);
    const letter = equationLetter(reading.text);
    const equation = letter ? equationOfLine(reading.text, letter) : null;
    if (!equation) return null;
    const content = this.equationContent(equation, reading);
    if (!content) return null;
    return {
      ...content,
      // Beside the equation, not in place of its right side.
      lead: String.raw`${content.tex},\ ${equation.letter}`,
      written: `${equation.letter}=${content.forms.decimal.text}`,
    };
  }

  /** The card for a function: what was read, typeset, and nothing to answer. */
  private functionContent(fn: NoteFunction, reading: SumReading): CalcCardContent | null {
    const body = fn.body === null ? "" : expressionTex(fn.body);
    if (body === null) return null;
    const tex = `${fn.name} = ${body}`.trim();
    return {
      tex,
      lead: tex,
      expression: `${fn.name} = ${fn.body ?? ""}`.trim(),
      forms: { fraction: null, decimal: { text: "", exact: true } },
      form: "decimal",
      doubts: reading.doubts.map((d) => ({ char: d.char, alternatives: d.alternatives })),
      graph: fn,
    };
  }

  /** Show the glow for what was read, unless the pen has moved on. */
  private open(
    pageId: string,
    eq: EqualsSign,
    after: Stroke[],
    strokes: Stroke[],
    place: AnswerPlace,
    reading: SumReading,
    vars: ReadonlyMap<string, CalcValue>,
    content: CalcCardContent,
    token: number,
  ): void {
    const surface = this.host.surface();
    if (!surface || token !== this.token) return;
    const note: OpenNote = {
      pageId,
      eq,
      after,
      strokes,
      place,
      reading,
      vars,
      content,
      picked: new Set(),
      typed: false,
      accepted: null,
    };
    this.note = note;
    surface.showCalcNote(this.spec(note));
  }

  /** What the surface shows for `note`: the glow, its doubts, and the card's content and actions. */
  private spec(note: OpenNote): CalcNoteSpec {
    const left = Math.min(...note.strokes.map((s) => strokeLeft(s)));
    const { eq, place } = note;
    const right = Math.max(eq.bounds.maxX, ...note.after.map((s) => strokeBounds(s)?.maxX ?? 0));
    return {
      pageId: note.pageId,
      strokes: note.strokes,
      doubts: note.reading.doubts.map((d) => d.strokes),
      // Beside the "=", level with the top of the sum's line.
      cardAt: { x: right + place.height * 0.6, y: place.baseline - place.height * 1.4 },
      flipAt: left - place.height * 0.6,
      content: note.content,
      actions: {
        write: (form) => {
          this.host.surface()?.hideCalcNote();
          void this.write(note, form);
        },
        toEquation: (form) => {
          this.host.surface()?.hideCalcNote();
          this.toEquation(note, form);
        },
        insertGraph: () => {
          this.host.surface()?.hideCalcNote();
          this.insertGraph(note);
        },
        copyLatex: () => {
          void navigator.clipboard?.writeText(note.content.tex).then(
            () => new Notice(t("calculator.latexCopied")),
            () => undefined,
          );
        },
        notMaths: () => this.host.surface()?.hideCalcNote(),
        editReading: () => this.editReading(note),
        formChosen: (form) => {
          this.form = form;
        },
        pick: (index, text) => this.pick(note, index, text),
      },
    };
  }

  /**
   * Type the reading in a dialog (above the keyboard on the iPad), the sum
   * typeset as it is typed. What is saved is worked out as a sum or an
   * expanded polynomial; the glow and the card follow it. Nothing of it is
   * kept for learning: typed over the whole reading, its pieces may no
   * longer say what the ink is.
   */
  private editReading(note: OpenNote): void {
    const solve = (text: string): CalcCardContent | null => {
      const fn = functionOfLine(text);
      if (fn) return this.functionContent(fn, { ...note.reading, doubts: [] });
      // An equation typed: solved for its one letter.
      if (text.includes("=")) {
        const letter = /(?<![A-Za-z])([A-Za-z])(?![A-Za-z])/.exec(text)?.[1]?.toLowerCase();
        const equation = letter ? equationOfLine(text, letter) : null;
        return equation ? this.equationContent(equation, { ...note.reading, doubts: [] }) : null;
      }
      const sum = sumOfLine(`${text} =`, note.vars) ?? { expression: text, shown: text };
      const result = evaluateSum(sum, note.vars);
      const forms = result.ok ? answerForms(result.value) : polynomialAnswer(sum.expression);
      return forms ? this.content(sum, forms, { ...note.reading, doubts: [] }) : null;
    };
    new CalcReadingModal(this.host.app, {
      expression: note.content.expression,
      preview: (text) => {
        if (text.includes("=")) {
          const [l, r] = text.split("=");
          const lt = expressionTex(l ?? "");
          const rt = expressionTex(r ?? "");
          return lt !== null && rt !== null ? `${lt} = ${rt}` : null;
        }
        const sum = sumOfLine(`${text} =`, note.vars);
        return expressionTex(sum?.expression ?? text, { dot: note.reading.dot });
      },
      submit: (text) => {
        const next = solve(text);
        if (!next) return false;
        note.typed = true;
        note.reading = { ...note.reading, doubts: [] };
        note.content = next;
        this.host.surface()?.updateCalcNote(this.spec(note));
        return true;
      },
    }).open();
  }

  /**
   * Doubt `index` answered as `text` in the card: the reading with it, worked
   * out again; the piece kept as a correction (Grape read it wrong; the ink
   * and what it is). Null when the sum no longer works out.
   */
  private pick(note: OpenNote, index: number, text: string): CalcCardContent | null {
    const doubt = note.reading.doubts[index];
    if (!doubt) return null;
    const next = withPick(note.reading, doubt, text);
    if (!next) return null;
    const content = this.pickedContent(note, next);
    if (!content) return null;
    note.reading = next;
    note.content = content;
    // The character Grape read, chosen: confirmed, and kept as read right
    // when the answer is accepted. Another: a misread, kept now.
    if (text !== doubt.char) {
      note.picked.add(doubt.piece);
      const piece = next.pieces[doubt.piece];
      this.record(note, piece.strokes, piece.read, piece.text, "misread");
    }
    this.host.surface()?.updateCalcNote(this.spec(note));
    return content;
  }

  /** The card for a reading changed by a pick, as a line or as a sum. */
  private pickedContent(note: OpenNote, next: SumReading): CalcCardContent | null {
    if (note.after.length > 0 || note.content.graph) return this.lineContent(next);
    const found = this.work(next.text, note.vars);
    const solved =
      found && found !== "variables"
        ? { sum: found.sum, forms: answerForms(found.value) }
        : this.expanded(next.text, note.vars);
    return solved?.forms ? this.content(solved.sum, solved.forms, next) : null;
  }

  /**
   * The answer was accepted (written, or turned into an equation) as read:
   * every piece not already corrected is kept as a confirmed reading. Not
   * after the reading was typed over: its pieces may no longer say what the
   * ink is.
   */
  private confirm(note: OpenNote): void {
    if (note.typed) return;
    note.reading.pieces.forEach((piece, i) => {
      if (note.picked.has(i)) return;
      this.record(note, piece.strokes, piece.read, piece.text, "ignore");
    });
  }

  private record(
    note: OpenNote,
    ids: readonly string[],
    read: string,
    text: string,
    kind: CorrectionKind,
  ): void {
    const page = this.host.page(note.pageId);
    if (!page || !text.trim()) return;
    const strokes = page.strokes.filter((s) => ids.includes(s.id));
    if (strokes.length === 0) return;
    void this.host.record(note.pageId, strokes, read, text, kind).catch(() => undefined);
  }

  /** The card's content for `sum` worked out to `value`: its LaTeX, the answer's forms and the doubts. */
  /**
   * A sum with a letter no line above sets ("(2x+4)(4x+1) ="): the
   * polynomial it expands to, or null when it is none.
   */
  private expanded(
    reading: string,
    vars: ReadonlyMap<string, CalcValue>,
  ): { sum: NoteSum; forms: AnswerForms | null } | null {
    const sum = sumOfLine(reading, vars);
    return sum ? { sum, forms: polynomialAnswer(sum.expression) } : null;
  }

  private content(
    sum: NoteSum,
    forms: AnswerForms | null,
    reading: SumReading,
  ): CalcCardContent | null {
    const tex = expressionTex(sum.expression, { dot: reading.dot });
    if (!forms || tex === null) return null;
    const form: AnswerForm = forms.fraction
      ? (this.form ?? (reading.fraction ? "fraction" : "decimal"))
      : "decimal";
    return {
      tex,
      lead: tex,
      expression: sum.expression,
      forms,
      form,
      doubts: reading.doubts.map((d) => ({ char: d.char, alternatives: d.alternatives })),
    };
  }

  /**
   * The card for an equation solved ("2x+3=7" asked with "x ="): the
   * equation typeset, its solutions as the answer ("x = 2"), written after
   * the "=" as the values alone. Null when it has no real solution.
   */
  private equationContent(equation: NoteEquation, reading: SumReading): CalcCardContent | null {
    const forms = equationAnswer(equation.lhs, equation.rhs, equation.letter);
    const lhs = expressionTex(equation.lhs);
    const rhs = expressionTex(equation.rhs);
    if (!forms || lhs === null || rhs === null) return null;
    return {
      tex: `${lhs} = ${rhs}`,
      lead: equation.letter,
      expression: `${equation.lhs} = ${equation.rhs}`,
      forms: {
        ...forms,
        decimal: { ...forms.decimal, shown: `${equation.letter} = ${forms.decimal.shown ?? ""}` },
      },
      form: "decimal",
      doubts: reading.doubts.map((d) => ({ char: d.char, alternatives: d.alternatives })),
    };
  }

  /**
   * The sum's line, read. Grape reads a plain line whole; a line with a
   * raised dot or a fraction (`calc-layout.ts`) is read piece by piece and
   * put together by where the pieces sit. Each reading brings its characters,
   * for the doubts. Null when it cannot be read.
   */
  private async read(strokes: readonly Stroke[], eq: EqualsSign): Promise<SumReading | null> {
    const reader = this.host.reader;
    const eqIds = new Set(eq.strokes.map((s) => s.id));
    const body = strokes.filter((s) => !eqIds.has(s.id));
    const piece = pieceOf;
    const laidOut = await readLaidOut(body, async (groups) =>
      (await reader.readGroups(groups.map(inkForReading), { chars: true, math: true })).map(piece),
    );
    if (laidOut !== null) return laidOut;
    // `inkForReading` keeps pen ink only, in order: the indices `chars` names.
    const ink = strokes.filter((s) => s.tool === "pen" && !s.shape);
    const [line] = await reader.readGroups([inkForReading(ink)], { chars: true, math: true });
    return line ? readWhole(ink, piece(line)) : null;
  }

  /** The reading worked out, "variables" when it needs ones set above, or null. */
  private work(
    reading: string,
    vars: ReadonlyMap<string, CalcValue>,
  ): { sum: NoteSum; value: CalcValue } | "variables" | null {
    const sum = sumOfLine(reading, vars);
    const result = sum ? evaluateSum(sum, vars) : null;
    if (sum && result?.ok) return { sum, value: result.value };
    // A letter in the line may be a variable set above: worth reading those
    // lines once, but only once.
    const letters = /[A-Za-z]/.test(reading.replace(/=\s*$/, ""));
    if (vars.size > 0 || !(letters || (result !== null && needsVariables(result)))) return null;
    return "variables";
  }

  /** The variables set on the lines above the sum ("a = 5"), read on this device. */
  /** The lines above the sum, read on this device, top to bottom. */
  private async linesAbove(page: Page, sum: readonly Stroke[]): Promise<string[]> {
    const own = new Set(sum.map((s) => s.id));
    const top = Math.min(
      ...sum.map((s) => {
        let y = Infinity;
        for (let i = 1; i < s.pts.length; i += 3) y = Math.min(y, s.pts[i]);
        return y;
      }),
    );
    const above = page.strokes.filter((s) => !own.has(s.id));
    if (above.length === 0) return [];
    const reading = await this.host.reader.readPage(above);
    return reading.lines
      .filter((line) => line.box[3] <= top + 1)
      .sort((a, b) => a.box[1] - b.box[1])
      .map((line) => line.text);
  }

  /**
   * Write the answer after the "=", in the chosen form (a fraction stacked
   * over a bar, or a decimal), if the "=" is still there and still the
   * line's end.
   */
  private async write(note: OpenNote, form: AnswerForm): Promise<void> {
    const { pageId, eq, place, after } = note;
    const forms = note.content.forms;
    const fraction = form === "fraction" ? forms.fraction : null;
    const shown = (note.content.written ?? forms.decimal.text).replace(/\s+/g, "");
    const text = fraction ? `${fraction.n}${fraction.d}` : shown.replace(/\^/g, "");
    const glyphs = glyphsFor(text, await this.ownGlyphs());
    const page = this.host.page(pageId);
    const surface = this.host.surface();
    if (!glyphs || !page || !surface || !stillLast(page, eq, after)) return;
    const pen = eq.strokes[1];
    const written = fraction
      ? writeFraction(fraction.n, fraction.d, glyphs, place)
      : writeWithPowers(shown, glyphs, place);
    const ink = written.map((pts) => ({
      color: pen.color,
      size: pen.size,
      tool: pen.tool,
      ...(pen.nib !== undefined ? { nib: pen.nib } : {}),
      pts,
    }));
    // Kept before the step, while the sum's ink is surely on the page.
    this.confirm(note);
    note.accepted = surface.addInkStrokes(pageId, ink);
  }

  /**
   * Put the graph of the written function under its line, the ink left as
   * it is (one undo step). A bare "f(x) =" opens the graph to type it in.
   */
  private insertGraph(note: OpenNote): void {
    const fn = note.content.graph;
    const surface = this.host.surface();
    const page = this.host.page(note.pageId);
    if (!fn || !surface || !page || !this.host.enabled()) return;
    if (fn.body === null) {
      this.host.openGraph();
      return;
    }
    const spec = functionGraphSpec({ ...fn, body: fn.body });
    const w = GRAPH_DEFAULT_W;
    const h = graphFrameHeight(spec, w, GRAPH_DEFAULT_H);
    let top = Infinity;
    let left = Infinity;
    let bottom = -Infinity;
    for (const stroke of note.strokes) {
      const box = strokeBounds(stroke);
      if (!box) continue;
      top = Math.min(top, box.minY);
      left = Math.min(left, box.minX);
      bottom = Math.max(bottom, box.maxY);
    }
    const line = { minX: left, minY: top, maxX: left, maxY: bottom };
    const at = graphPlaceUnder(line, { w, h }, page.geometry);
    const graph = graphFromSpec(nextGraphId(surface.document), at.x, at.y, spec);
    graph.h = h;
    if (graph.spec.expressions.length === 0) return;
    this.confirm(note);
    const command = new AddGraph(note.pageId, graph);
    surface.applyCommand(command);
    surface.selectGraph(note.pageId, graph.id);
    note.accepted = command;
  }

  /**
   * Turn the sum into a typed equation (discussion #166) in its place: its
   * ink, "=" included, goes, and the equation of the sum and its answer
   * comes, level with the "=", in the pen's colour. One undo step.
   */
  private toEquation(note: OpenNote, form: AnswerForm): void {
    const { pageId, eq, place, content } = note;
    const ids = new Set(note.strokes.map((s) => s.id));
    const surface = this.host.surface();
    const page = this.host.page(pageId);
    this.measureCtx ??= createEl("canvas").getContext("2d");
    const ctx = this.measureCtx;
    if (!surface || !page || !ctx || !this.host.enabled()) return;
    const fraction = form === "fraction" ? content.forms.fraction : null;
    const decimal = content.forms.decimal;
    const answer = fraction ? fraction.tex : (decimal.tex ?? decimal.text);
    const sign = !fraction && !decimal.exact ? "\\approx" : "=";
    const tex = `${content.lead} ${sign} ${answer}`;
    const size = Math.max(12, place.height * 1.1);
    const frame = measureEquation(ctx, tex, size);
    const left = Math.min(...page.strokes.filter((s) => ids.has(s.id)).map((s) => strokeLeft(s)));
    const cy = (eq.bounds.minY + eq.bounds.maxY) / 2;
    const equation = makeEquation({
      id: nextEquationId(surface.document),
      x: Number.isFinite(left) ? left : eq.bounds.minX,
      y: cy - frame.h / 2,
      tex,
      color: eq.strokes[1].color,
      size,
      ...frame,
    });
    this.confirm(note);
    const command = new CompositeCommand(t("calculator.toEquation"), [
      new RemoveStrokesFromPage(pageId, ids),
      new AddEquation(pageId, equation),
    ]);
    surface.applyCommand(command);
    note.accepted = command;
  }

  /** The writer's glyphs from their symbol sheets (the last sample of each character wins). */
  private async ownGlyphs(): Promise<GlyphSet | null> {
    const host = this.host.learning();
    const sheets = practiceFiles(host).filter((f) => practiceSetOf(f.name) === SYMBOL_SET);
    const samples: ReturnType<typeof symbolSamples> = [];
    for (const file of sheets) {
      try {
        const open = host.openNotebook(file.path);
        const doc =
          open ??
          parseInkFile(await this.host.app.vault.read(file), DEFAULT_PAGE_GEOMETRY.width).doc;
        if (doc) samples.push(...symbolSamples(doc));
      } catch {
        // A sheet that does not parse gives no glyphs.
      }
    }
    const glyphs = glyphsFromSamples(samples);
    return glyphs.size > 0 ? glyphs : null;
  }
}
