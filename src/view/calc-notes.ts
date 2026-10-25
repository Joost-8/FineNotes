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
 * The pure parts: `model/calc-ink.ts` (the "=", the line, where the answer
 * goes), `model/calc-note.ts` (the reading to a sum, the answer's text) and
 * `model/answer-glyphs.ts` (the letters it is written in).
 */

import type { App } from "obsidian";
import { writingLines } from "../canvas/backdrop";
import { type GlyphSet, glyphsFor, glyphsFromSamples, writeText } from "../model/answer-glyphs";
import {
  type AnswerPlace,
  type EqualsSign,
  answerPlace,
  equalsAtEnd,
  sumStrokes,
} from "../model/calc-ink";
import {
  type NoteSum,
  answerText,
  evaluateSum,
  needsVariables,
  sumOfLine,
  variablesOfLines,
} from "../model/calc-note";
import type { CalcValue } from "../model/calculator";
import { DEFAULT_PAGE_GEOMETRY, type Page, type Stroke } from "../model/document";
import { parseInkFile } from "../model/serialize";
import { SYMBOL_SET, symbolSamples } from "../recognition/practice";
import { type HandwritingReader, inkForReading } from "./handwriting";
import { practiceFiles, practiceSetOf, type LearningHost } from "./handwriting-learning";
import type { InkSurface } from "./ink-surface";

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
  /** The practice files, for the symbol sheet's glyphs. */
  learning(): LearningHost;
}

/** The "=" a suggestion was made for is still the page's last ink. */
function stillLast(page: Page, eq: EqualsSign): boolean {
  const now = equalsAtEnd(page.strokes);
  return now !== null && now.strokes.every((s, i) => s.id === eq.strokes[i].id);
}

export class CalcNotes {
  private timer = 0;
  /** Bumped by every stroke and pen-down: a reading that comes back after one is dropped. */
  private token = 0;

  constructor(private readonly host: CalcNotesHost) {}

  /** A pen stroke was drawn: if it finished an "=", read the line once the pen has rested. */
  strokeDrawn(pageId: string): void {
    this.cancel();
    if (!this.host.enabled()) return;
    const page = this.host.page(pageId);
    const eq = page ? equalsAtEnd(page.strokes) : null;
    if (!eq) return;
    const token = this.token;
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      void this.suggest(pageId, eq, token).catch(() => undefined);
    }, CALC_DELAY_MS);
  }

  /** The pen touched the page: writing on drops the suggestion, untouched. */
  penDown(): void {
    this.cancel();
    this.host.surface()?.hideCalcSuggestion();
  }

  dispose(): void {
    this.cancel();
    this.host.surface()?.hideCalcSuggestion();
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
    const [line] = await reader.readGroups([inkForReading(strokes)]);
    if (!line || token !== this.token) return;
    let found = this.work(line.text, new Map());
    if (found === "variables") {
      const vars = await this.variablesAbove(page, strokes);
      if (token !== this.token) return;
      found = this.work(line.text, vars);
    }
    if (!found || found === "variables") return;
    const { sum, answer } = found;
    const place = answerPlace(strokes, eq);
    const surface = this.host.surface();
    if (!surface || token !== this.token) return;
    // Over the line, from the "=" on: never where the answer will be written,
    // so writing it by hand cannot land on the chip.
    const top = Math.min(eq.bounds.minY, place.baseline - place.height);
    surface.showCalcSuggestion(
      pageId,
      { x: eq.bounds.minX, y: top - place.height * 0.15 },
      `${sum.shown} ${answer.exact ? "=" : "≈"}`,
      answer.text.replace(/^-/, "−"),
      () => void this.write(pageId, eq, place, answer.text),
    );
  }

  /** The reading worked out, "variables" when it needs ones set above, or null. */
  private work(
    reading: string,
    vars: ReadonlyMap<string, CalcValue>,
  ): { sum: NoteSum; answer: { text: string; exact: boolean } } | "variables" | null {
    const sum = sumOfLine(reading, vars);
    const result = sum ? evaluateSum(sum, vars) : null;
    if (sum && result?.ok) {
      const answer = answerText(result.value);
      return answer ? { sum, answer } : null;
    }
    // A letter in the line may be a variable set above: worth reading those
    // lines once, but only once.
    const letters = /[A-Za-z]/.test(reading.replace(/=\s*$/, ""));
    if (vars.size > 0 || !(letters || (result !== null && needsVariables(result)))) return null;
    return "variables";
  }

  /** The variables set on the lines above the sum ("a = 5"), read on this device. */
  private async variablesAbove(
    page: Page,
    sum: readonly Stroke[],
  ): Promise<Map<string, CalcValue>> {
    const own = new Set(sum.map((s) => s.id));
    const top = Math.min(
      ...sum.map((s) => {
        let y = Infinity;
        for (let i = 1; i < s.pts.length; i += 3) y = Math.min(y, s.pts[i]);
        return y;
      }),
    );
    const above = page.strokes.filter((s) => !own.has(s.id));
    if (above.length === 0) return new Map();
    const reading = await this.host.reader.readPage(above);
    const lines = reading.lines
      .filter((line) => line.box[3] <= top + 1)
      .sort((a, b) => a.box[1] - b.box[1])
      .map((line) => line.text);
    return variablesOfLines(lines);
  }

  /** Write the answer after the "=", if it is still there and still the line's end. */
  private async write(
    pageId: string,
    eq: EqualsSign,
    place: AnswerPlace,
    text: string,
  ): Promise<void> {
    const glyphs = glyphsFor(text, await this.ownGlyphs());
    const page = this.host.page(pageId);
    const surface = this.host.surface();
    if (!glyphs || !page || !surface || !stillLast(page, eq)) return;
    const pen = eq.strokes[1];
    const ink = writeText(text, glyphs, place).map((pts) => ({
      color: pen.color,
      size: pen.size,
      tool: pen.tool,
      ...(pen.nib !== undefined ? { nib: pen.nib } : {}),
      pts,
    }));
    surface.addInkStrokes(pageId, ink);
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
