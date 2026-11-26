/**
 * A text note cut into pages, for Home's previews: a text note has no
 * pages of its own, so Home lays it out on A4-like sheets as wide as the
 * note's column and shows those, the way it shows a notebook's pages.
 *
 * Two steps, both PURE: {@link wrapRuns} breaks a paragraph into lines
 * with a measuring function the caller supplies (the view measures with a
 * canvas), and {@link paginate} deals the measured blocks onto pages. A
 * paragraph may break between its lines; a handwriting section or a
 * picture is never cut while it fits on one page, and only one taller than
 * a page is cut, at page heights. A heading is not left alone at a page's
 * foot.
 *
 * No DOM, no Obsidian.
 */

import { DEFAULT_PAGE_HEIGHT, DEFAULT_PAPER_WIDTH } from "../constants";
import { INK_WIDTH, type TextNote, type TextRun } from "./text-note";

/** Room round the column, page px: the column is {@link INK_WIDTH} wide, as in the note. */
export const NOTE_PAGE_MARGIN_X = 64;
export const NOTE_PAGE_MARGIN_TOP = 72;
export const NOTE_PAGE_MARGIN_BOTTOM = 64;
/** A page: the column and its margins, in the notebook's A4 proportions. */
export const NOTE_PAGE_WIDTH = INK_WIDTH + 2 * NOTE_PAGE_MARGIN_X;
export const NOTE_PAGE_HEIGHT = Math.round(
  (NOTE_PAGE_WIDTH * DEFAULT_PAGE_HEIGHT) / DEFAULT_PAPER_WIDTH,
);
/** The height the column has on one page. */
export const NOTE_CONTENT_HEIGHT =
  NOTE_PAGE_HEIGHT - NOTE_PAGE_MARGIN_TOP - NOTE_PAGE_MARGIN_BOTTOM;

/** One block as laid out: the room over it and under it, and the height of each of its lines. */
export interface MeasuredBlock {
  /** Room above it; none at the top of a page. */
  readonly before: number;
  /** Room below its last line. */
  readonly after: number;
  /** A paragraph's lines, top to bottom; a section's or picture's one height. */
  readonly lines: readonly number[];
  /** A handwriting section or a picture: kept on one page while it fits on one. */
  readonly whole: boolean;
  /** A heading: moved to the next page rather than left without the line under it. */
  readonly keepWithNext?: boolean;
}

/** The part of a block one page shows. */
export interface PageSlice {
  readonly block: number;
  /** Its lines `from` to `to` (exclusive); a whole block is line 0. */
  readonly from: number;
  readonly to: number;
  /** Its top, from the top of the page's column. */
  readonly y: number;
  /** How far into the block the slice starts: 0, except for a block taller than a page. */
  readonly offset: number;
  /** How much of it shows. */
  readonly height: number;
}

function sum(values: readonly number[], from = 0, to = values.length): number {
  let total = 0;
  for (let i = from; i < to; i++) total += values[i];
  return total;
}

/** The least of `block` that must share a page with whatever leads into it. */
function firstPart(block: MeasuredBlock, room: number): number {
  const first = block.lines[0] ?? 0;
  return block.whole ? Math.min(sum(block.lines), room) : first;
}

/**
 * `blocks` dealt onto pages `room` high, top to bottom: always one page at
 * least, an empty one for a note with nothing in it.
 */
export function paginate(blocks: readonly MeasuredBlock[], room: number): PageSlice[][] {
  const height = Number.isFinite(room) && room > 0 ? room : 1;
  const pages: PageSlice[][] = [[]];
  let y = 0;
  const newPage = (): void => {
    pages.push([]);
    y = 0;
  };
  const place = (slice: PageSlice): void => {
    pages[pages.length - 1].push(slice);
  };
  blocks.forEach((block, index) => {
    if (block.lines.length === 0) return;
    const top = (): number => (y === 0 ? 0 : block.before);
    if (block.whole) {
      const total = sum(block.lines);
      if (total <= height) {
        if (y > 0 && y + block.before + total > height) newPage();
        y += top();
        place({ block: index, from: 0, to: 1, y, offset: 0, height: total });
        y += total + block.after;
        return;
      }
      // Taller than a page: it starts on a page of its own and is cut at page heights.
      if (y > 0) newPage();
      for (let offset = 0; offset < total; offset += height) {
        if (offset > 0) newPage();
        const shown = Math.min(height, total - offset);
        place({ block: index, from: 0, to: 1, y: 0, offset, height: shown });
        y = shown;
      }
      y += block.after;
      return;
    }
    if (block.keepWithNext && y > 0) {
      const next = blocks.slice(index + 1).find((b) => b.lines.length > 0);
      const need =
        block.before +
        sum(block.lines) +
        block.after +
        (next ? next.before + firstPart(next, height) : 0);
      if (y + need > height && need <= height) newPage();
    }
    let line = 0;
    while (line < block.lines.length) {
      if (y > 0 && y + top() + block.lines[line] > height) newPage();
      y += top();
      const start = y;
      const from = line;
      // At least one line on every page, however tall it is.
      do {
        y += block.lines[line];
        line++;
      } while (line < block.lines.length && y + block.lines[line] <= height);
      place({ block: index, from, to: line, y: start, offset: 0, height: y - start });
      if (line < block.lines.length) newPage();
    }
    y += block.after;
  });
  return pages;
}

/**
 * The blocks `ticked` pages show any part of, by index: a paragraph, list
 * or section split over pages belongs to every page it reaches, so it is
 * kept whole when any of them is ticked.
 */
export function blocksOnPages(
  pages: readonly PageSlice[][],
  ticked: Iterable<number>,
): Set<number> {
  const blocks = new Set<number>();
  for (const page of ticked) for (const slice of pages[page] ?? []) blocks.add(slice.block);
  return blocks;
}

/**
 * `note` with only the blocks `ticked` pages show (`pages` its layout, one
 * measured block per note block, as `layoutNote` lays it out), in order.
 */
export function noteOnPages(
  note: TextNote,
  pages: readonly PageSlice[][],
  ticked: Iterable<number>,
): TextNote {
  const kept = blocksOnPages(pages, ticked);
  return { blocks: note.blocks.filter((_, i) => kept.has(i)) };
}

/** The index of the page `block` starts on, or 0 when no page shows it. */
export function pageOfBlock(pages: readonly PageSlice[][], block: number): number {
  const at = pages.findIndex((page) => page.some((slice) => slice.block === block));
  return at < 0 ? 0 : at;
}

/** The first block a page shows the start of, else the first it shows any of; null for an empty page. */
export function firstBlockOn(pages: readonly PageSlice[][], page: number): number | null {
  const slices = pages[page] ?? [];
  const starts = slices.find((slice) => slice.from === 0 && slice.offset === 0);
  return (starts ?? slices[0])?.block ?? null;
}

/**
 * A paragraph's runs broken into lines no wider than `width`, by
 * `measure` (the width of a piece of text in a run's marks). Lines break
 * after spaces; a word wider than a line breaks between letters (the note
 * wraps "anywhere" too); a newline in the text always breaks. A
 * paragraph with no text is one empty line.
 */
export function wrapRuns(
  runs: readonly TextRun[],
  width: number,
  measure: (text: string, marks: number) => number,
): TextRun[][] {
  const lines: TextRun[][] = [];
  let line: TextRun[] = [];
  let used = 0;
  const push = (text: string, marks: number, w: number): void => {
    const last = line[line.length - 1];
    if (last && last.marks === marks) line[line.length - 1] = { text: last.text + text, marks };
    else line.push({ text, marks });
    used += w;
  };
  const end = (): void => {
    lines.push(trimEnd(line));
    line = [];
    used = 0;
  };
  for (const run of runs) {
    // Words with the spaces after them, and newlines on their own.
    const pieces = run.text.match(/\n|[^\s\n]+[^\S\n]*|[^\S\n]+/g) ?? [];
    for (const piece of pieces) {
      if (piece === "\n") {
        end();
        continue;
      }
      const word = piece.trimEnd();
      const w = measure(piece, run.marks);
      const wordWidth = word === piece ? w : measure(word, run.marks);
      if (used + wordWidth <= width || (used === 0 && word === "")) {
        push(piece, run.marks, w);
        continue;
      }
      if (used > 0 && wordWidth <= width) {
        end();
        push(piece, run.marks, w);
        continue;
      }
      // Too wide for a line of its own: letter by letter.
      for (const char of Array.from(piece)) {
        const cw = measure(char, run.marks);
        if (used > 0 && used + cw > width && char.trim() !== "") end();
        push(char, run.marks, cw);
      }
    }
  }
  if (line.length > 0 || lines.length === 0) end();
  return lines;
}

/** A line without the spaces it ended on. */
function trimEnd(line: TextRun[]): TextRun[] {
  const out = line.slice();
  while (out.length > 0) {
    const last = out[out.length - 1];
    const text = last.text.replace(/[^\S\n]+$/, "");
    if (text === "") {
      out.pop();
      continue;
    }
    out[out.length - 1] = { text, marks: last.marks };
    break;
  }
  return out;
}
