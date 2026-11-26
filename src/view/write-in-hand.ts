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
import { isOutOfMemory } from "../recognition/writer/protocol";
import type { Page, Stroke, TextBoxElement } from "../model/document";
import { AddStrokeToPage, CompositeCommand, RemoveTextBoxFromPage } from "../model/page-commands";
import { neatenCommandFor } from "../model/neaten-commands";
import { measureHand } from "../ink/tidy";
import { writingLines } from "../canvas/backdrop";
import { type MirrorElement, type MirrorKind, elementBounds, isMirror } from "../canvas/mirrors";
import type { PageInk } from "../recognition/hwr/lines";
import type { InkStroke } from "../recognition/hwr/features";
import type { WrittenStroke } from "../recognition/writer/rows";
import { median } from "../recognition/writer/rows";
import {
  KNOWN_PRESSURE,
  boxXHeight,
  spacingOf,
  chunkLine,
  flowWords,
  numericAnswer,
  placeAnswer,
  placeOfWord,
  placeWord,
  plainMarkdown,
  wordsOfLines,
  writableText,
} from "../recognition/writer/known-layout";
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
    options?: { stop?: () => boolean; seed?: number; exact?: boolean; attempts?: number },
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

/** How many times a word or line Grape misreads is written again before the best reading is kept. */
const REWRITE_ATTEMPTS = 3;

/** A seed of its own for each writing, so the same text never comes out the same twice. */
const freshSeed = (): number => Math.floor(Math.random() * 1_000_000);

export class WriteInHand {
  constructor(private readonly writer: KnownWriter) {}

  /** Look once whether the writer can write, so the first menu after a launch already knows. */
  warm(): void {
    void this.writer.ready();
  }

  /** Whether known text can be written in the writer's hand now (the last answer, looked at again behind). */
  canWrite(): boolean {
    return this.writer.readyNow();
  }

  /**
   * `text` as the model writes it (typographic marks made plain), or null
   * when it holds a letter the model lacks (or the model is not read yet).
   */
  writable(text: string): string | null {
    const out = writableText(text, (ch) => this.writer.writes(ch));
    return out.missing.length === 0 && out.text.trim() !== "" ? out.text : null;
  }

  /**
   * Whether a text box can be turned into handwriting: one on the page
   * itself, level, with text (not a sticky note's or a shape's label, whose
   * owner the ink would leave).
   */
  canTurn(box: TextBoxElement): boolean {
    return (
      this.canWrite() &&
      box.text.trim() !== "" &&
      !box.onSticky &&
      !box.onShape &&
      !box.rotation &&
      !isMirror(box)
    );
  }

  /**
   * The word of `wordIds` on page `pageId` rewritten as `text` in the
   * writer's hand: on its line, from where it started, at the line's size;
   * the ink after it on the line moves by the difference in width. Nothing
   * changes if that ink changed meanwhile, the note became read-only
   * (`locked`), or the line would run off the page.
   */
  async rewriteWord(
    surface: InkSurface,
    pageId: string,
    wordIds: readonly string[],
    typed: string,
    locked: () => boolean = () => false,
  ): Promise<void> {
    const page = surface.document.pages.find((p) => p.id === pageId);
    const text = this.writable(typed);
    if (!page || text === null || locked()) return;
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
      return locked() || still.length !== before.length || still.some((s, i) => s !== before[i]);
    };
    // The word's underline shows the work, as the card did.
    surface.setActiveWordFlag(pageId, wordIds);
    let written: Awaited<ReturnType<KnownWriter["writeKnown"]>> = null;
    let failure: string | null = null;
    try {
      written = await this.writer.writeKnown([text], {
        stop,
        seed: freshSeed(),
        attempts: REWRITE_ATTEMPTS,
      });
    } catch (error) {
      console.warn("FineNotes: writing in your hand stopped", error);
      failure = isOutOfMemory(error) ? t("ai.neaten.noMemory") : null;
    } finally {
      surface.setActiveWordFlag(null);
    }
    if (stop()) return;
    if (!written) {
      new Notice(failure ?? t("ai.hand.failed"), 8000);
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
    // A wider word must not push the line off the page.
    const right = Math.max(
      ...placed.strokes.flatMap((pts) => boundsOf(pts).map((b) => b.x1)),
      ...[...moved.values()].flatMap((pts) => boundsOf(pts).map((b) => b.x1)),
    );
    if (right > page.geometry.width) {
      new Notice(t("ai.hand.noRoomLine"), 6000);
      return;
    }
    const command = neatenCommandFor(
      pageId,
      page.strokes,
      { removed: [...ids], added: placed.strokes.map((pts) => ({ pts, line: 0 })), moved },
      [word[0]],
      () => surface.newStrokeId(),
      t("surface.command.writeInHand"),
    );
    if (command) surface.applyCommand(command);
  }

  /**
   * The text box `boxId` on page `pageId` turned into the writer's
   * handwriting: from the box's left edge to the page's right margin (or the
   * rules' block), its paragraphs each from a new line, lines on the rules
   * of ruled paper and below the box's top, never on anything already on the
   * page (ink, pictures, other boxes, tables). Its x-height is the box's own
   * lowercase (`boxXHeight`), larger only to stay legible; the word gap and
   * line spacing are the writer's, in x-heights, from this page when it
   * holds enough writing or else their practice sheets (`spacingOf`); the ink is the box's colour. A box written in Markdown is
   * written as it reads, without its marks. When it does not all fit on the
   * page, or the note became read-only (`locked`), nothing changes.
   */
  async turnTextBox(
    surface: InkSurface,
    pageId: string,
    boxId: string,
    locked: () => boolean = () => false,
  ): Promise<void> {
    const page = surface.document.pages.find((p) => p.id === pageId);
    const box = page?.textBoxes.find((b) => b.id === boxId);
    if (!page || !box || locked() || !(await this.writer.ready()) || !this.canTurn(box)) return;
    const source = box.markdown ? plainMarkdown(box.text) : box.text;
    const { text, missing } = writableText(source, (ch) => this.writer.writes(ch));
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
      return locked() || !still || still.text !== box.text;
    };
    let written: Awaited<ReturnType<KnownWriter["writeKnown"]>> = null;
    let failure: string | null = null;
    try {
      written = await this.writer.writeKnown(pieces, {
        stop,
        seed: freshSeed(),
        attempts: REWRITE_ATTEMPTS,
      });
    } catch (error) {
      console.warn("FineNotes: writing in your hand stopped", error);
      failure = isOutOfMemory(error) ? t("ai.neaten.noMemory") : null;
    }
    if (stop()) return;
    if (!written) {
      new Notice(failure ?? t("ai.hand.failed"), 8000);
      return;
    }
    const writing = writingOf(page);
    const sample: PageInk[] = written.sample.map((s, i) => ({
      id: `p${i}`,
      tool: "pen",
      t0: s.t0 ?? null,
      pts: s.pts,
    }));
    // The page's measure only from enough writing: two strokes measured no gaps (Joost, 2026-11-25).
    const hand = spacingOf(measureHand(writing), measureHand(sample));
    const pen = penFor(writing, box);
    const plan = layoutFor(page, box, hand, pen.size);
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
      taken: takenOn(page, box.id),
      reach: { up: plan.xHeight * 2.2, down: plan.xHeight * 0.8 },
    });
    if (flowed.left > 0 || flowed.strokes.length === 0) {
      new Notice(t("ai.hand.noRoom"), 8000);
      return;
    }
    const label = t("surface.command.writeInHand");
    surface.applyCommand(
      new CompositeCommand(label, [
        new RemoveTextBoxFromPage(pageId, boxId),
        ...flowed.strokes.map(
          (pts) => new AddStrokeToPage(pageId, { ...pen, id: surface.newStrokeId(), pts }),
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
      // Only figures Grape reads back exactly: a wrong answer is worse than drawn figures.
      const written = await this.writer.writeKnown([text], { seed: freshSeed(), exact: true });
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
 * or undefined when the writer cannot write yet or the note is read-only
 * (`locked`; then nothing is offered). The offer after an answer is a card
 * of one row where the card was, only for text the model can write;
 * `shown` hands it to whoever closes cards.
 */
export function wordInHand(
  service: WriteInHand,
  surface: InkSurface,
  pageId: string,
  wordIds: readonly string[],
  at: { x: number; y: number },
  shown: (card: WordPopover) => void,
  locked: () => boolean = () => false,
): WriteWordInHand | undefined {
  if (!service.canWrite() || locked()) return undefined;
  const write = (text: string): void =>
    void service.rewriteWord(surface, pageId, wordIds, text, locked);
  return {
    write,
    writes: (text) => service.writable(text) !== null,
    offer: (text) => {
      if (service.writable(text) === null || locked()) return;
      shown(
        new WordPopover(at, {
          read: text,
          chips: [],
          onChip: () => {},
          rows: [{ icon: "signature", label: t("ai.word.writeInHand"), run: () => write(text) }],
        }),
      );
    },
  };
}

/** What written lines must keep clear of on `page`: every element but the box `except`, mirrors included. */
function takenOn(page: Page, except: string): { x0: number; y0: number; x1: number; y1: number }[] {
  const kinds: [MirrorKind, readonly MirrorElement[]][] = [
    ["strokes", page.strokes],
    ["images", page.images],
    ["textBoxes", page.textBoxes.filter((b) => b.id !== except)],
    ["tables", page.tables ?? []],
    ["graphs", page.graphs ?? []],
    ["equations", page.equations ?? []],
  ];
  return kinds.flatMap(([kind, list]) =>
    list.flatMap((element) => {
      const b = elementBounds(kind, element);
      return b ? [{ x0: b.minX, y0: b.minY, x1: b.maxX, y1: b.maxY }] : [];
    }),
  );
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

/** The box's colour, with the width and nib the page is mostly written with (the default width without writing). */
function penFor(writing: readonly Stroke[], box: TextBoxElement): Omit<Stroke, "id" | "pts"> {
  const counts = new Map<string, { stroke: Stroke; n: number }>();
  for (const s of writing) {
    const key = `${s.size}|${s.nib ?? ""}`;
    const c = counts.get(key);
    if (c) c.n++;
    else counts.set(key, { stroke: s, n: 1 });
  }
  const best = [...counts.values()].sort((a, b) => b.n - a.n)[0]?.stroke;
  return {
    color: box.color,
    size: best?.size ?? 3,
    tool: "pen",
    ...(best?.nib ? { nib: best.nib } : {}),
  };
}

/** The frame and size a text box's handwriting gets on its page. */
function layoutFor(
  page: Page,
  box: TextBoxElement,
  hand: { wordGap: number; linePitch: number },
  penSize: number,
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
  // The box's own size (Joost, 2026-11-25: "keep it to the size of the text"), larger only to stay legible.
  const xHeight = boxXHeight(box.fontSize, penSize, block ? block.pitch : null);
  const pitch = block?.pitch ?? hand.linePitch * xHeight;
  const gap = hand.wordGap * xHeight;
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
