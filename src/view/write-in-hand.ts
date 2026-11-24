/**
 * Known text written in the writer's own hand, with the model behind
 * Beautify (`neaten.ts`, `writeKnown`). The text is known, so nothing is
 * read and nothing can be misread:
 *
 * 1. A word the writer corrected on the word card, rewritten in place of
 *    the old ink on its line, the rest of the line moved by the difference
 *    in width (`rewriteWord`).
 * 2. A text box turned into handwriting (Turn into › Handwriting): wrapped
 *    to the page's margins, set on its rules on ruled paper, each line with
 *    its own noise, below any ink already there (`turnTextBox`).
 * 3. A calculation's answer after the user's "=": plain numbers only, never
 *    symbolic maths (`answerInk`); the glyphs stay the fallback.
 *
 * Offered only once the writer can write: the model is on this device and
 * the writer copied enough practice lines (Beautify's rule). Each change is
 * one undo step.
 */

import { Notice } from "obsidian";
import { t } from "../i18n/translate";
import type { Page, Stroke, TextBoxElement } from "../model/document";
import { AddStrokeToPage, CompositeCommand, RemoveTextBoxFromPage } from "../model/page-commands";
import { neatenCommandFor } from "../model/neaten-commands";
import { measureHand } from "../ink/tidy";
import { writingLines } from "../canvas/backdrop";
import { isMirror } from "../canvas/mirrors";
import type { PageInk } from "../recognition/hwr/lines";
import type { InkStroke } from "../recognition/hwr/features";
import type { WrittenStroke } from "../recognition/writer/rows";
import { median } from "../recognition/writer/rows";
import {
  KNOWN_PRESSURE,
  MIN_LINE_PITCH,
  chunkLine,
  flowWords,
  numericAnswer,
  placeAnswer,
  placeOfWord,
  placeWord,
  wordsOfLines,
  writableText,
} from "../recognition/writer/known-layout";
import { IdSequence, strokeIdsOf } from "./id-sequence";
import type { InkSurface } from "./ink-surface";
import type { WriteWordInHand } from "./word-check";
import { WordPopover } from "./word-popover";

/** What writes the text: Beautify's service (`NeatenService`). */
export interface KnownWriter {
  ready(): Promise<boolean>;
  readyNow(): boolean;
  writes(ch: string): boolean;
  writeKnown(
    texts: readonly string[],
    options?: { stop?: () => boolean; seed?: number },
  ): Promise<{ lines: WrittenStroke[][]; sample: InkStroke[] } | null>;
}

/** The page's own writing: pen ink, no shapes, no mirrors of joined pages. */
function writingOf(page: Page): Stroke[] {
  return page.strokes.filter((s) => !isMirror(s) && s.tool === "pen" && !s.shape);
}

function pressureOf(strokes: readonly Stroke[]): number {
  const p = strokes.flatMap((s) => {
    const out: number[] = [];
    for (let i = 2; i < s.pts.length; i += 3) out.push(s.pts[i]);
    return out;
  });
  return p.length ? median(p) : KNOWN_PRESSURE;
}

/** A seed of its own for each writing, so the same text never comes out the same twice. */
const freshSeed = (): number => Math.floor(Math.random() * 1_000_000);

export class WriteInHand {
  constructor(private readonly writer: KnownWriter) {}

  /** Whether known text can be written in the writer's hand now (the last answer, looked at again behind). */
  canWrite(): boolean {
    return this.writer.readyNow();
  }

  /**
   * The word of `wordIds` on page `pageId` rewritten as `text` in the
   * writer's hand: on its line, from where it started, at the line's size;
   * the ink after it on the line moves by the difference in width. Nothing
   * changes if that ink changed meanwhile.
   */
  async rewriteWord(
    surface: InkSurface,
    pageId: string,
    wordIds: readonly string[],
    text: string,
  ): Promise<void> {
    const page = surface.document.pages.find((p) => p.id === pageId);
    if (!page) return;
    const ids = new Set(wordIds);
    const word = page.strokes.filter((s) => ids.has(s.id));
    const at = placeOfWord(writingOf(page), ids);
    if (!at || word.length === 0) return;
    // The ink the rewrite replaces or moves, as it is now: any change to it ends the work.
    const watched = new Set([...ids, ...at.after]);
    const before = page.strokes.filter((s) => watched.has(s.id));
    const stop = (): boolean => {
      const now = surface.document.pages.find((p) => p.id === pageId);
      const still = now?.strokes.filter((s) => watched.has(s.id)) ?? [];
      return still.length !== before.length || still.some((s, i) => s !== before[i]);
    };
    surface.setActiveWordFlag(pageId, wordIds);
    let written: Awaited<ReturnType<KnownWriter["writeKnown"]>> = null;
    try {
      written = await this.writer.writeKnown([text], { stop, seed: freshSeed() });
    } catch (error) {
      console.warn("FineNotes: writing in your hand stopped", error);
    } finally {
      surface.setActiveWordFlag(null);
    }
    if (stop()) return;
    if (!written) {
      new Notice(t("ai.hand.failed"), 6000);
      return;
    }
    // The whole text as one unit (a correction may be two words), as the model spaced it.
    const one = written.lines[0].map((s) => ({ pts: s.pts, word: 0 }));
    const [[unit]] = wordsOfLines([one], at.xHeight, pressureOf(word));
    if (!unit) return;
    const placed = placeWord(unit, at);
    const moved = new Map<string, number[]>();
    if (Math.abs(placed.shift) > 0.5) {
      for (const s of before) {
        if (ids.has(s.id)) continue;
        moved.set(
          s.id,
          s.pts.map((v, i) => (i % 3 === 0 ? v + placed.shift : v)),
        );
      }
    }
    const strokeIds = new IdSequence("s", () => surface.document);
    strokeIds.restart(strokeIdsOf(surface.document));
    const command = neatenCommandFor(
      pageId,
      page.strokes,
      { removed: [...ids], added: placed.strokes.map((pts) => ({ pts, line: 0 })), moved },
      [word[0]],
      () => strokeIds.next(),
      t("surface.command.writeInHand"),
    );
    if (command) surface.applyCommand(command);
  }

  /**
   * The text box `boxId` on page `pageId` turned into the writer's
   * handwriting: from the box's left edge to the page's right margin (or the
   * rules' block), its paragraphs each from a new line, lines on the rules
   * of ruled paper and below the box's top, never on ink already there. The
   * size and word gap are the writer's on this page, or on their practice
   * sheets when the page has no writing. When it does not all fit on the
   * page, nothing changes.
   */
  async turnTextBox(surface: InkSurface, pageId: string, boxId: string): Promise<void> {
    const page = surface.document.pages.find((p) => p.id === pageId);
    const box = page?.textBoxes.find((b) => b.id === boxId);
    if (!page || !box || !(await this.writer.ready())) return;
    const { text, missing } = writableText(box.text, (ch) => this.writer.writes(ch));
    if (missing.length > 0) {
      new Notice(t("ai.hand.missing", { chars: missing.join(" ") }), 8000);
      return;
    }
    const paragraphs = text.split("\n").map((line) => chunkLine(line));
    const pieces = paragraphs.flat();
    if (pieces.length === 0) return;
    const stop = (): boolean => {
      const now = surface.document.pages.find((p) => p.id === pageId);
      const still = now?.textBoxes.find((b) => b.id === boxId);
      return !still || still.text !== box.text;
    };
    const working = new Notice(t("ai.hand.writing"), 0);
    let written: Awaited<ReturnType<KnownWriter["writeKnown"]>> = null;
    try {
      written = await this.writer.writeKnown(pieces, { stop, seed: freshSeed() });
    } catch (error) {
      console.warn("FineNotes: writing in your hand stopped", error);
    } finally {
      working.hide();
    }
    if (stop()) return;
    if (!written) {
      new Notice(t("ai.hand.failed"), 6000);
      return;
    }
    const writing = writingOf(page);
    const sample: PageInk[] = written.sample.map((s, i) => ({
      id: `p${i}`,
      tool: "pen",
      t0: s.t0 ?? null,
      pts: s.pts,
    }));
    const hand = measureHand(writing) ?? measureHand(sample);
    const plan = layoutFor(page, box, hand);
    const words = wordsOfLines(written.lines, plan.xHeight, pressureOf(writing));
    // The pieces back into their paragraphs.
    let at = 0;
    const flowedParagraphs = paragraphs.map((chunks) => {
      const own = words.slice(at, at + chunks.length).flat();
      at += chunks.length;
      return own;
    });
    const flowed = flowWords(flowedParagraphs, {
      ...plan.frame,
      taken: page.strokes.filter((s) => !isMirror(s)).flatMap((s) => boundsOf(s.pts)),
      reach: { up: plan.xHeight * 2.2, down: plan.xHeight * 0.8 },
    });
    if (flowed.left > 0 || flowed.strokes.length === 0) {
      new Notice(t("ai.hand.noRoom"), 8000);
      return;
    }
    const pen = usualPen(writing, box);
    const strokeIds = new IdSequence("s", () => surface.document);
    strokeIds.restart(strokeIdsOf(surface.document));
    const label = t("surface.command.writeInHand");
    surface.applyCommand(
      new CompositeCommand(label, [
        new RemoveTextBoxFromPage(pageId, boxId),
        ...flowed.strokes.map(
          (pts) => new AddStrokeToPage(pageId, { ...pen, id: strokeIds.next(), pts }),
        ),
      ]),
    );
  }

  /**
   * A calculation's answer written by the writer after "=" (page px, one
   * array per stroke), or null for the glyphs to write it: not a plain
   * number, the writer not ready, or it could not.
   */
  async answerInk(
    text: string,
    at: { x: number; baseline: number; height: number },
  ): Promise<number[][] | null> {
    if (!numericAnswer(text) || !this.writer.readyNow()) return null;
    try {
      const written = await this.writer.writeKnown([text], { seed: freshSeed() });
      const line = written?.lines[0];
      return line && line.length > 0 ? placeAnswer(line, at) : null;
    } catch (error) {
      console.warn("FineNotes: the answer is written in glyphs", error);
      return null;
    }
  }
}

/**
 * The word card's way to write a word in the writer's hand (`WordCheck.ask`),
 * or undefined when the writer cannot write yet (then nothing is offered).
 * The offer after an answer is a card of one row where the card was;
 * `shown` hands it to whoever closes cards.
 */
export function wordInHand(
  service: WriteInHand,
  surface: InkSurface,
  pageId: string,
  wordIds: readonly string[],
  at: { x: number; y: number },
  shown: (card: WordPopover) => void,
): WriteWordInHand | undefined {
  if (!service.canWrite()) return undefined;
  const write = (text: string): void => void service.rewriteWord(surface, pageId, wordIds, text);
  return {
    write,
    offer: (text) =>
      shown(
        new WordPopover(at, {
          read: text,
          chips: [],
          onChip: () => {},
          rows: [{ icon: "signature", label: t("ai.word.writeInHand"), run: () => write(text) }],
        }),
      ),
  };
}

/** A stroke's bounds, as `flowWords` takes them (none for a stroke without points). */
function boundsOf(pts: ArrayLike<number>): { x0: number; y0: number; x1: number; y1: number }[] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i + 1 < pts.length; i += 3) {
    x0 = Math.min(x0, pts[i]);
    x1 = Math.max(x1, pts[i]);
    y0 = Math.min(y0, pts[i + 1]);
    y1 = Math.max(y1, pts[i + 1]);
  }
  return Number.isFinite(x0) ? [{ x0, y0, x1, y1 }] : [];
}

/** The pen the page is mostly written with, or the box's colour at the default width. */
function usualPen(writing: readonly Stroke[], box: TextBoxElement): Omit<Stroke, "id" | "pts"> {
  const counts = new Map<string, { stroke: Stroke; n: number }>();
  for (const s of writing) {
    const key = `${s.color}|${s.size}|${s.nib ?? ""}`;
    const c = counts.get(key);
    if (c) c.n++;
    else counts.set(key, { stroke: s, n: 1 });
  }
  const best = [...counts.values()].sort((a, b) => b.n - a.n)[0]?.stroke;
  if (!best) return { color: box.color, size: 3, tool: "pen" };
  return {
    color: best.color,
    size: best.size,
    tool: "pen",
    ...(best.nib ? { nib: best.nib } : {}),
  };
}

/** The frame and size a text box's handwriting gets on its page. */
function layoutFor(
  page: Page,
  box: TextBoxElement,
  hand: { xHeight: number; wordGap: number; linePitch: number } | null,
): {
  xHeight: number;
  frame: {
    left: number;
    right: number;
    top: number;
    pitch: number;
    bottom: number;
    gap: number;
    rules?: number[];
  };
} {
  const { width, height } = page.geometry;
  const margin = Math.max(24, width * 0.06);
  const blocks = writingLines(page.backdrop, page.geometry);
  const block =
    blocks.find(
      (b) => box.x >= b.x0 - margin && box.x <= b.x1 && b.baselines.some((y) => y > box.y),
    ) ?? null;
  // The writer's size; on ruled paper never taller than the rules allow.
  let xHeight = hand?.xHeight ?? (block ? block.pitch / MIN_LINE_PITCH : 10);
  if (block) xHeight = Math.min(xHeight, block.pitch / MIN_LINE_PITCH);
  const pitch = block?.pitch ?? Math.max(hand?.linePitch ?? 0, MIN_LINE_PITCH) * xHeight;
  const gap = (hand?.wordGap ?? 1) * xHeight;
  const left = Math.max(box.x, block ? block.x0 : 0);
  const right = block ? block.x1 - xHeight * 0.5 : width - margin;
  return {
    xHeight,
    frame: {
      left,
      right: Math.max(right, left + 4 * xHeight),
      // The first line where the box's first line of text stands.
      top: box.y + xHeight * 1.6,
      pitch,
      bottom: height - Math.max(12, height * 0.03),
      gap,
      ...(block ? { rules: block.baselines } : {}),
    },
  };
}
