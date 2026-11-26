/**
 * Column sums (discussion #228; Settings › Models on this device, next to
 * calculation notes): draw a line under a column of handwritten amounts and
 * lift the pen; a moment later the amounts glow, as a calculation note's sum
 * does, and a tap opens the maths card with every amount it read, lined up
 * on the decimal mark, and the total. Write puts the total under the line,
 * right-aligned with the amounts. A single line closes a subtotal, a double
 * line the total of the whole column.
 *
 * The column stays live while the notebook is open: erase or rewrite an
 * amount above the line and, once the pen rests, it is read again and the
 * glow comes back with the new total. Writing the total again replaces the
 * total written before.
 *
 * Where the ink sits decides what is a row, an amount, a minus and a name
 * (`model/column-sum.ts`); Grape reads only each amount. A row that does not
 * read as an amount withholds the total: the card shows what was read and
 * the row can be typed or picked right.
 */

import type { App } from "obsidian";
import { localeTag } from "../i18n/translate";
import { glyphsFor, textWidth, writeWithPowers } from "../model/answer-glyphs";
import { type CharDoubt, type SumReading, readWhole, withPick } from "../model/calc-layout";
import {
  type Amount,
  type Column,
  type ColumnSummary,
  type RuleKind,
  type SumRule,
  columnAbove,
  conventionOfLocale,
  marksSettled,
  parseTypedColumn,
  rowText,
  ruleAtEnd,
  summarizeColumn,
} from "../model/column-sum";
import type { Command } from "../model/commands";
import { type Bounds, type Page, type Stroke, strokeBounds } from "../model/document";
import { RemoveStrokesFromPage } from "../model/page-commands";
import type { CorrectionKind } from "../recognition/hwr/corrections";
import type { CalcCardContent } from "./calc-card";
import { CALC_DELAY_MS, writerGlyphs } from "./calc-notes";
import { CalcReadingModal } from "./calc-reading-modal";
import { type HandwritingReader, inkForReading } from "./handwriting";
import type { LearningHost } from "./handwriting-learning";
import type { CalcNoteSpec, InkSurface } from "./ink-surface";

/** What column sums need from the notebook view. */
export interface ColumnNotesHost {
  app: App;
  /** Whether to add up columns now: the setting is on, reading is on, the note can be written. */
  enabled(): boolean;
  surface(): InkSurface | null;
  page(pageId: string): Page | null;
  reader: HandwritingReader;
  learning(): LearningHost;
  /** Keep a labelled piece of ink for learning (`corrections.json`). */
  record(
    pageId: string,
    strokes: readonly Stroke[],
    read: string,
    text: string,
    kind: CorrectionKind,
  ): Promise<void>;
}

/** A line under a column, kept while the notebook is open so its total follows the amounts. */
interface LiveColumn {
  pageId: string;
  ruleIds: string[];
  kind: RuleKind;
  /** The rows' ink the total was last worked out for; a change reads the column again. */
  signature: string;
  /** Amounts typed in the dialog, by row; dropped when the rows' ink changes. */
  typed: Map<number, Amount>;
  /** The total written under the line, so writing it again replaces it. */
  written: string[];
}

/** The column note shown: what was read, and what the card did with it. */
interface OpenColumn {
  live: LiveColumn;
  column: Column;
  /** Each row's reading (null for a line or a row with no amount). */
  readings: Array<SumReading | null>;
  summary: ColumnSummary;
  content: CalcCardContent;
  accepted: Command | null;
}

function union(boxes: readonly Bounds[]): Bounds {
  return {
    minX: Math.min(...boxes.map((b) => b.minX)),
    minY: Math.min(...boxes.map((b) => b.minY)),
    maxX: Math.max(...boxes.map((b) => b.maxX)),
    maxY: Math.max(...boxes.map((b) => b.maxY)),
  };
}

/** The ink of the rows (amounts and signs): what, changed, means the column is read again. */
function signatureOf(column: Column): string {
  return column.rows
    .map((row) =>
      [...row.signStrokes, ...row.amount, ...(row.rule?.strokes ?? [])].map((s) => s.id).join(","),
    )
    .join("|");
}

/** Each row's own doubts, by its index in the card's list. */
interface DoubtRef {
  row: number;
  doubt: CharDoubt;
}

export class ColumnNotes {
  private timer = 0;
  /** Bumped by every stroke and pen-down: a reading that comes back after one is dropped. */
  private token = 0;
  private readonly live: LiveColumn[] = [];
  private note: OpenColumn | null = null;

  constructor(private readonly host: ColumnNotesHost) {}

  /** A pen stroke was drawn: a line under a column adds it up; any other may change one. */
  strokeDrawn(pageId: string): void {
    this.cancel();
    if (!this.host.enabled()) return;
    const page = this.host.page(pageId);
    if (!page) return;
    const rule = ruleAtEnd(page.strokes);
    const column = rule ? columnAbove(page.strokes, rule) : null;
    if (rule && column) {
      const live: LiveColumn = {
        pageId,
        ruleIds: rule.strokes.map((s) => s.id),
        kind: rule.kind,
        signature: "",
        typed: new Map(),
        written: [],
      };
      // A double line drawn over a single one replaces it.
      this.forget((l) => l.pageId === pageId && l.ruleIds.some((id) => live.ruleIds.includes(id)));
      this.live.push(live);
      this.schedule([live]);
      return;
    }
    this.schedule(this.live.filter((l) => l.pageId === pageId));
  }

  /** The document changed (an erase, an undo): the columns on those pages are checked again. */
  pagesChanged(pages?: readonly string[]): void {
    if (!this.host.enabled() || this.live.length === 0) return;
    const changed = this.live.filter((l) => !pages || pages.includes(l.pageId));
    if (changed.length === 0) return;
    window.clearTimeout(this.timer);
    this.schedule(changed);
  }

  /** The pen touched the page: what was waiting to be read waits for the next lift. */
  penDown(): void {
    this.cancel();
  }

  dispose(): void {
    this.cancel();
    this.live.length = 0;
    this.note = null;
  }

  /** An undo or redo of the total written: the glow comes back, or goes again. */
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

  private forget(which: (l: LiveColumn) => boolean): void {
    for (let i = this.live.length - 1; i >= 0; i--) if (which(this.live[i])) this.live.splice(i, 1);
  }

  private schedule(columns: LiveColumn[]): void {
    if (columns.length === 0) return;
    const token = this.token;
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      void (async () => {
        for (const live of columns) {
          if (token !== this.token) return;
          await this.refresh(live, token);
        }
      })().catch(() => undefined);
    }, CALC_DELAY_MS);
  }

  /** The line's column now, or null when the line is gone or has no column above it. */
  private columnOf(live: LiveColumn, page: Page): Column | null {
    const strokes = live.ruleIds
      .map((id) => page.strokes.find((s) => s.id === id))
      .filter((s): s is Stroke => s !== undefined);
    if (strokes.length !== live.ruleIds.length) return null;
    const boxes = strokes.map((s) => strokeBounds(s)).filter((b): b is Bounds => b !== null);
    if (boxes.length !== strokes.length) return null;
    const rule: SumRule = { kind: live.kind, strokes, bounds: union(boxes) };
    return columnAbove(page.strokes, rule);
  }

  /** Read the column again if its rows changed, and show the glow with its total. */
  private async refresh(live: LiveColumn, token: number): Promise<void> {
    const page = this.host.page(live.pageId);
    const surface = this.host.surface();
    if (!page || !surface) return;
    if (!live.ruleIds.every((id) => page.strokes.some((s) => s.id === id))) {
      // The line was erased: the column is no longer added up.
      this.forget((l) => l === live);
      if (this.note?.live === live) this.hide();
      return;
    }
    const column = this.columnOf(live, page);
    if (!column) {
      live.signature = "";
      if (this.note?.live === live) this.hide();
      return;
    }
    const signature = signatureOf(column);
    if (signature === live.signature) return;
    await this.host.reader.model();
    if (token !== this.token || !this.host.enabled()) return;
    const order = new Map(page.strokes.map((s, i) => [s.id, i]));
    const inPageOrder = (strokes: readonly Stroke[]): Stroke[] =>
      [...strokes].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    const rows = column.rows
      .map((row, i) => ({ i, ink: inPageOrder(row.amount) }))
      .filter(({ i, ink }) => !column.rows[i].rule && ink.length > 0);
    const lines = await this.host.reader.readGroups(
      rows.map((r) => inkForReading(r.ink)),
      { chars: true, math: true },
    );
    if (token !== this.token) return;
    const readings: Array<SumReading | null> = column.rows.map(() => null);
    rows.forEach((r, k) => {
      const line = lines[k];
      if (!line) return;
      // The letters as written, not the language model's guess: on numbers
      // read alone it is right more often (50.9 against 39.5 % exact,
      // `research/handwriting-rig/column-sum-probe.mjs`). Commas and full
      // stops are then settled by where they sit.
      const piece = marksSettled(
        {
          text: line.greedy ?? line.text,
          confidence: line.confidence,
          greedy: line.greedy,
          chars: line.chars,
        },
        r.ink,
        column.digit,
      );
      const reading = readWhole(r.ink, piece);
      const text = rowText(reading.text, r.ink, column.digit);
      readings[r.i] =
        text === reading.text.replace(/\s+/g, "")
          ? reading
          : // The 1 Grape missed: no doubt left about it.
            { ...reading, text, doubts: [], pieces: [{ ...reading.pieces[0], text }] };
    });
    if (live.signature !== "" && live.signature !== signature) live.typed.clear();
    live.signature = signature;
    this.open(live, column, readings);
  }

  private open(live: LiveColumn, column: Column, readings: Array<SumReading | null>): void {
    const surface = this.host.surface();
    if (!surface) return;
    const summary = this.summarize(live, column, readings);
    const note: OpenColumn = {
      live,
      column,
      readings,
      summary,
      content: this.content(live, summary, readings),
      accepted: null,
    };
    this.note = note;
    surface.showCalcNote(this.spec(note));
  }

  private summarize(
    live: LiveColumn,
    column: Column,
    readings: ReadonlyArray<SumReading | null>,
  ): ColumnSummary {
    return summarizeColumn(
      column,
      readings.map((r) => r?.text ?? null),
      conventionOfLocale(localeTag()),
      live.typed,
    );
  }

  private hide(): void {
    this.host.surface()?.hideCalcNote();
    this.note = null;
  }

  /** The doubts the card lists: those of the rows it shows, and not typed over. */
  private doubtsOf(summary: ColumnSummary, readings: ReadonlyArray<SumReading | null>): DoubtRef[] {
    const out: DoubtRef[] = [];
    for (const row of summary.shown) {
      for (const doubt of readings[row]?.doubts ?? []) out.push({ row, doubt });
    }
    return out;
  }

  private content(
    live: LiveColumn,
    summary: ColumnSummary,
    readings: ReadonlyArray<SumReading | null>,
  ): CalcCardContent {
    const total = summary.totalText;
    return {
      tex: summary.tex,
      lead: summary.tex,
      expression: summary.expression,
      forms: {
        fraction: null,
        decimal: { text: total ?? "", exact: true, shown: total ?? "?" },
      },
      form: "decimal",
      doubts: this.doubtsOf(summary, readings)
        .filter((d) => !live.typed.has(d.row))
        .map(({ doubt }) => ({ char: doubt.char, alternatives: doubt.alternatives })),
      column: true,
      ...(total === null ? { noAnswer: true } : {}),
    };
  }

  private spec(note: OpenColumn): CalcNoteSpec {
    const { column } = note;
    const rule = column.rule.bounds;
    const rows = note.summary.shown.map((i) => column.rows[i]);
    const ink = [
      ...rows.flatMap((row) => [...row.signStrokes, ...row.amount]),
      ...column.rule.strokes,
    ];
    const left = Math.min(...ink.map((s) => strokeBounds(s)?.minX ?? Infinity));
    const top = Math.min(...ink.map((s) => strokeBounds(s)?.minY ?? Infinity));
    const doubts = this.doubtsOf(note.summary, note.readings).filter(
      (d) => !note.live.typed.has(d.row),
    );
    return {
      pageId: note.live.pageId,
      strokes: ink,
      doubts: doubts.map((d) => d.doubt.strokes),
      // Beside the column, level with its top.
      cardAt: { x: rule.maxX + column.digit * 0.6, y: top },
      flipAt: left - column.digit * 0.6,
      content: note.content,
      actions: {
        write: () => {
          this.host.surface()?.hideCalcNote();
          void this.write(note);
        },
        toEquation: () => undefined,
        insertGraph: () => undefined,
        copyLatex: () => {
          void navigator.clipboard?.writeText(note.content.tex).catch(() => undefined);
        },
        notMaths: () => {
          // Not a sum: this line is no longer added up.
          this.forget((l) => l === note.live);
          this.hide();
        },
        editReading: () => this.editReading(note),
        formChosen: () => undefined,
        pick: (index, text) => this.pick(note, index, text),
      },
    };
  }

  /** The card's content again after its reading changed, the glow's doubts with it. */
  private update(note: OpenColumn): CalcCardContent {
    note.summary = this.summarize(note.live, note.column, note.readings);
    note.content = this.content(note.live, note.summary, note.readings);
    this.host.surface()?.updateCalcNote(this.spec(note));
    return note.content;
  }

  /** Doubt `index` answered as `text`: that row read again with it, and the total. */
  private pick(note: OpenColumn, index: number, text: string): CalcCardContent | null {
    const ref = this.doubtsOf(note.summary, note.readings).filter(
      (d) => !note.live.typed.has(d.row),
    )[index];
    const reading = ref ? note.readings[ref.row] : null;
    if (!ref || !reading) return null;
    const next = withPick(reading, ref.doubt, text);
    if (!next) return null;
    note.readings[ref.row] = next;
    if (text !== ref.doubt.char) {
      const piece = next.pieces[ref.doubt.piece];
      const page = this.host.page(note.live.pageId);
      const strokes = page?.strokes.filter((s) => piece.strokes.includes(s.id)) ?? [];
      if (strokes.length > 0) {
        void this.host
          .record(note.live.pageId, strokes, piece.read, piece.text, "misread")
          .catch(() => undefined);
      }
    }
    return this.update(note);
  }

  /** Type the column's amounts ("1.234,50 + 20 - 5"), one for each row the card lists. */
  private editReading(note: OpenColumn): void {
    const convention = note.summary.convention;
    new CalcReadingModal(this.host.app, {
      expression: note.summary.expression,
      preview: (text) => {
        const amounts = parseTypedColumn(text, convention);
        return amounts ? text.replace(/[{}\\$^_&%#~]/g, "") : null;
      },
      submit: (text) => {
        const amounts = parseTypedColumn(text, convention);
        const rows = note.summary.shown;
        if (!amounts || amounts.length !== rows.length) return false;
        rows.forEach((row, k) => note.live.typed.set(row, amounts[k]));
        this.update(note);
        return true;
      },
    }).open();
  }

  /**
   * Write the total under the line, right-aligned with the amounts, at their
   * height, in the line's pen; the total written there before goes first.
   */
  private async write(note: OpenColumn): Promise<void> {
    const text = note.summary.totalText;
    if (text === null) return;
    const glyphs = glyphsFor(text, await writerGlyphs(this.host.app, this.host.learning()));
    const surface = this.host.surface();
    const page = this.host.page(note.live.pageId);
    if (!glyphs || !surface || !page || !this.host.enabled()) return;
    const { column } = note;
    const amounts = note.summary.shown.flatMap((i) => column.rows[i].amount);
    // As tall as the amounts' digits (the column's digit height counts its commas in).
    const tall = amounts
      .map((s) => strokeBounds(s))
      .filter((b): b is Bounds => b !== null && b.maxY - b.minY > 0.6 * column.digit)
      .map((b) => b.maxY - b.minY)
      .sort((a, b) => a - b);
    const h = tall.length > 0 ? tall[Math.floor(tall.length / 2)] : column.digit;
    const right = Math.max(...amounts.map((s) => strokeBounds(s)?.maxX ?? -Infinity));
    const x =
      (Number.isFinite(right) ? right : column.rule.bounds.maxX) - textWidth(text, glyphs, h);
    const baseline = column.rule.bounds.maxY + h * 1.25;
    const pen = column.rule.strokes[column.rule.strokes.length - 1];
    const old = new Set(note.live.written.filter((id) => page.strokes.some((s) => s.id === id)));
    if (old.size > 0) surface.applyCommand(new RemoveStrokesFromPage(page.id, old));
    const before = new Set(page.strokes.map((s) => s.id));
    const ink = writeWithPowers(text, glyphs, { x, baseline, height: h }).map((pts) => ({
      color: pen.color,
      size: pen.size,
      tool: pen.tool,
      ...(pen.nib !== undefined ? { nib: pen.nib } : {}),
      pts,
    }));
    note.accepted = surface.addInkStrokes(page.id, ink);
    const after = this.host.page(page.id);
    note.live.written = after
      ? after.strokes.filter((s) => !before.has(s.id)).map((s) => s.id)
      : [];
    // Confirmed: the rows read right, for learning.
    note.summary.shown.forEach((row) => {
      const reading = note.readings[row];
      if (!reading || note.live.typed.has(row)) return;
      for (const piece of reading.pieces) {
        const strokes = page.strokes.filter((s) => piece.strokes.includes(s.id));
        if (strokes.length === 0 || !piece.text.trim()) continue;
        void this.host
          .record(page.id, strokes, piece.read, piece.text, "ignore")
          .catch(() => undefined);
      }
    });
  }
}
