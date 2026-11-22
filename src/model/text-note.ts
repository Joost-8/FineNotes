/**
 * A text note: typed text first, with handwriting and pictures in sections
 * of their own between the paragraphs, as in Apple Notes. PURE: no DOM, no
 * Obsidian.
 *
 * A note is a list of blocks, top to bottom. A text block is one paragraph
 * (a title, a heading, a list item, …) made of runs, each a stretch of text
 * with its marks. An ink block is a strip of handwriting, {@link INK_WIDTH}
 * units wide whatever the pane's width (the view scales it), so ink never
 * moves between devices. An image block is one picture on a line of its own.
 *
 * Blocks are never changed in place: every edit returns a new note that
 * shares the blocks it did not touch. Undo is then a stack of notes, and the
 * view redraws exactly the blocks whose identity changed.
 *
 * On disk a note is ordinary Markdown (`text-note-file.ts`).
 */

import type { GraphSpecData, Stroke } from "./document";
import { strokeBounds } from "./document";

/** A run's marks, as bits. */
export const BOLD = 1;
export const ITALIC = 2;
export const UNDERLINE = 4;
export const STRIKE = 8;
/** A highlight behind the text: yellow (`==text==` on disk), and four more colours. */
export const HIGHLIGHT = 16;
export const HIGHLIGHT_GREEN = 32;
export const HIGHLIGHT_PINK = 64;
export const HIGHLIGHT_BLUE = 128;
export const HIGHLIGHT_PURPLE = 256;
/** The highlight colours, as the ink highlighter offers them; a run has at most one. */
export const HIGHLIGHTS: ReadonlyArray<{ mark: Marks; name: string; color: string }> = [
  { mark: HIGHLIGHT, name: "yellow", color: "#ffd43b" },
  { mark: HIGHLIGHT_GREEN, name: "green", color: "#8ce99a" },
  { mark: HIGHLIGHT_PINK, name: "pink", color: "#ffa8a8" },
  { mark: HIGHLIGHT_BLUE, name: "blue", color: "#74c0fc" },
  { mark: HIGHLIGHT_PURPLE, name: "purple", color: "#eebefa" },
];
export const ANY_HIGHLIGHT =
  HIGHLIGHT | HIGHLIGHT_GREEN | HIGHLIGHT_PINK | HIGHLIGHT_BLUE | HIGHLIGHT_PURPLE;
export const ALL_MARKS = BOLD | ITALIC | UNDERLINE | STRIKE | ANY_HIGHLIGHT;

/** `marks` with `mark` added; a highlight colour replaces any other. */
export function withMarkOn(marks: Marks, mark: Marks): Marks {
  const clear = (mark & ANY_HIGHLIGHT) !== 0 ? ANY_HIGHLIGHT : 0;
  return (marks & ~clear) | mark;
}
export type Marks = number;

export interface TextRun {
  readonly text: string;
  readonly marks: Marks;
}

export type TextKind =
  | "title"
  | "heading"
  | "subheading"
  | "body"
  | "mono"
  | "bullet"
  | "dash"
  | "number"
  | "upper"
  | "lower"
  | "check"
  | "quote";

export const TEXT_KINDS: readonly TextKind[] = [
  "title",
  "heading",
  "subheading",
  "body",
  "mono",
  "bullet",
  "dash",
  "number",
  "upper",
  "lower",
  "check",
  "quote",
];

/** The kinds that are list items: they indent, and Return on an empty one ends the list. */
export const LIST_KINDS: readonly TextKind[] = [
  "bullet",
  "dash",
  "number",
  "upper",
  "lower",
  "check",
];

/** The list kinds that count their items (1., A., a.). */
export const ORDERED_KINDS: readonly TextKind[] = ["number", "upper", "lower"];

/** The deepest a list item indents. */
export const MAX_INDENT = 3;

export interface TextBlock {
  readonly type: "text";
  readonly id: string;
  readonly kind: TextKind;
  readonly runs: readonly TextRun[];
  /** A list item's depth, 1..{@link MAX_INDENT}; absent at the margin. */
  readonly indent?: number;
  /** A checklist item that is ticked. */
  readonly checked?: true;
}

/** The width of every ink section, in its own units; the view scales it to the column. */
export const INK_WIDTH = 720;
/** A new ink section's height, and the least one can be. */
export const INK_DEFAULT_HEIGHT = 260;
export const INK_MIN_HEIGHT = 72;
/** No section grows past this: a canvas that tall is slow, and a new section is one stroke away. */
export const INK_MAX_HEIGHT = 6000;
/** Ink this close to a section's foot makes it grow, and by how much room it then leaves. */
export const INK_GROW_MARGIN = 120;
export const INK_GROW_ROOM = 150;
/** The room kept under the lowest ink when a section is trimmed to what it holds. */
export const INK_TRIM_ROOM = 28;

/** The paper a handwriting section shows under its ink: the notebook's four basic ones. */
export type InkPaper = "blank" | "lined" | "squared" | "dotted";
export const INK_PAPERS: readonly InkPaper[] = ["blank", "lined", "squared", "dotted"];

export interface InkBlock {
  readonly type: "ink";
  readonly id: string;
  readonly height: number;
  readonly strokes: readonly Stroke[];
  /** Absent: blank. */
  readonly paper?: InkPaper;
  /** What this device read the handwriting as, for search (`ink-reading.ts`). */
  readonly reading?: InkReading;
}

/** A handwriting section read on the device: its lines, and the ink they were read from. */
export interface InkReading {
  /** One line of writing a line. */
  readonly text: string;
  /** `inkReadingHash` of the strokes it was read from: other strokes are read again. */
  readonly of: string;
}

/** The least width a picture is shown at, as a share of the column. */
export const IMAGE_MIN_SHARE = 0.15;

export interface ImageBlock {
  readonly type: "image";
  readonly id: string;
  /** The vault path, or whatever link text the file was written with. */
  readonly path: string;
  /** Its width in px of a {@link INK_WIDTH}-wide column; absent fills the column. */
  readonly width?: number;
}

/** A table: rows of plain-text cells, the first row the header (`note-table.ts`). */
export interface TableBlock {
  readonly type: "table";
  readonly id: string;
  readonly rows: readonly (readonly string[])[];
}

/** Lines of the file this version cannot read: kept as they are, shown as a chip. */
export interface RawBlock {
  readonly type: "raw";
  readonly id: string;
  readonly text: string;
}

/**
 * A graph on a line of its own: the calculator's graph, kept whole as the
 * notebook's graph elements keep it (`model/graph-element.ts`), and drawn
 * by the same code. Its frame is the column's width; its height follows
 * the shape of its view.
 */
export interface GraphBlock {
  readonly type: "graph";
  readonly id: string;
  readonly spec: GraphSpecData;
}

/** A recording in the note (`model/note-audio-embed.ts`), played with the notebook's player. */
export interface AudioBlock {
  readonly type: "audio";
  readonly id: string;
  /** The vault path, or whatever link text the file was written with. */
  readonly path: string;
  /** Its length, ms, as measured while recording; absent when only the file can say. */
  readonly duration?: number;
}

export type NoteBlock =
  TextBlock | InkBlock | ImageBlock | TableBlock | RawBlock | GraphBlock | AudioBlock;

export interface TextNote {
  readonly blocks: readonly NoteBlock[];
}

/** A place in a note: a block by index, and how many characters into its text. */
export interface NotePoint {
  readonly block: number;
  readonly offset: number;
}

export interface NoteRange {
  readonly start: NotePoint;
  readonly end: NotePoint;
}

/** A note after an edit, and where the caret belongs. */
export interface NoteEdit {
  readonly note: TextNote;
  readonly caret: NotePoint;
}

export type IdSource = () => string;

// ---------------------------------------------------------------- runs

/** Runs with the empty ones dropped and equal neighbours joined. */
export function normalizeRuns(runs: readonly TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  for (const run of runs) {
    if (run.text.length === 0) continue;
    const marks = run.marks & ALL_MARKS;
    const last = out[out.length - 1];
    if (last && last.marks === marks) out[out.length - 1] = { text: last.text + run.text, marks };
    else out.push({ text: run.text, marks });
  }
  return out;
}

export function runsText(runs: readonly TextRun[]): string {
  let text = "";
  for (const run of runs) text += run.text;
  return text;
}

export function blockText(block: NoteBlock): string {
  return block.type === "text" ? runsText(block.runs) : "";
}

export function blockLength(block: NoteBlock): number {
  return blockText(block).length;
}

/** The runs between two character offsets. */
export function sliceRuns(runs: readonly TextRun[], from: number, to = Infinity): TextRun[] {
  const out: TextRun[] = [];
  let at = 0;
  for (const run of runs) {
    const end = at + run.text.length;
    const a = Math.max(from, at);
    const b = Math.min(to, end);
    if (b > a) out.push({ text: run.text.slice(a - at, b - at), marks: run.marks });
    at = end;
  }
  return out;
}

/** The marks of the character before `offset` (what typing there continues), or 0. */
export function marksBefore(runs: readonly TextRun[], offset: number): Marks {
  let at = 0;
  for (const run of runs) {
    at += run.text.length;
    if (offset <= at && run.text.length > 0) return run.marks;
  }
  return 0;
}

/** Runs without the spaces they end with. */
function trimmedEnd(runs: readonly TextRun[]): TextRun[] {
  const length = runsText(runs).replace(/\s+$/, "").length;
  return sliceRuns(runs, 0, length);
}

/** Runs without the spaces they start with. */
function trimmedStart(runs: readonly TextRun[]): TextRun[] {
  const text = runsText(runs);
  return sliceRuns(runs, text.length - text.replace(/^\s+/, "").length);
}

function withMark(runs: readonly TextRun[], from: number, to: number, mark: Marks, on: boolean) {
  const middle = sliceRuns(runs, from, to).map((run) => ({
    text: run.text,
    marks: on ? withMarkOn(run.marks, mark) : run.marks & ~mark,
  }));
  return normalizeRuns([...sliceRuns(runs, 0, from), ...middle, ...sliceRuns(runs, to)]);
}

// ---------------------------------------------------------------- blocks

export function textBlock(
  id: string,
  kind: TextKind = "body",
  runs: readonly TextRun[] = [],
  extra: { indent?: number; checked?: boolean } = {},
): TextBlock {
  const indent = canIndent(kind) ? clampIndent(extra.indent ?? 0) : 0;
  return {
    type: "text",
    id,
    kind,
    runs: normalizeRuns(runs),
    ...(indent > 0 ? { indent } : {}),
    ...(kind === "check" && extra.checked ? { checked: true as const } : {}),
  };
}

export function isList(kind: TextKind): boolean {
  return LIST_KINDS.includes(kind);
}

/** Whether a kind of line indents: lists, body text and quotes (not headings or code). */
export function canIndent(kind: TextKind): boolean {
  return isList(kind) || kind === "body" || kind === "quote";
}

function clampIndent(indent: number): number {
  return Number.isFinite(indent) ? Math.max(0, Math.min(MAX_INDENT, Math.round(indent))) : 0;
}

/** `block` as another kind, keeping what that kind can carry. */
function asKind(block: TextBlock, kind: TextKind, runs: readonly TextRun[] = block.runs) {
  return textBlock(block.id, kind, kind === "mono" ? plain(runs) : runs, {
    indent: block.indent,
    checked: block.checked,
  });
}

/** Monostyled text carries no marks. */
function plain(runs: readonly TextRun[]): TextRun[] {
  return runs.map((run) => ({ text: run.text, marks: 0 }));
}

/** A new note: one empty title. */
export function emptyNote(newId: IdSource): TextNote {
  return { blocks: [textBlock(newId(), "title")] };
}

function replaced(note: TextNote, index: number, count: number, ...blocks: NoteBlock[]): TextNote {
  const next = note.blocks.slice();
  next.splice(index, count, ...blocks);
  return { blocks: next };
}

/** `note` with at least one block, and a text block last, so there is always a line to type on. */
export function withTypingLine(note: TextNote, newId: IdSource): TextNote {
  const last = note.blocks[note.blocks.length - 1];
  if (last && last.type === "text") return note;
  return { blocks: [...note.blocks, textBlock(newId(), note.blocks.length ? "body" : "title")] };
}

export function replaceBlock(note: TextNote, index: number, block: NoteBlock): TextNote {
  if (!note.blocks[index]) return note;
  return replaced(note, index, 1, block);
}

export function insertBlock(note: TextNote, index: number, block: NoteBlock): TextNote {
  const at = Math.max(0, Math.min(note.blocks.length, index));
  return replaced(note, at, 0, block);
}

export function removeBlock(note: TextNote, index: number): TextNote {
  if (!note.blocks[index]) return note;
  return replaced(note, index, 1);
}

/**
 * Move the block at `from` so it sits before what is now at `to`
 * (`to === blocks.length` puts it last).
 */
export function moveBlock(note: TextNote, from: number, to: number): TextNote {
  const block = note.blocks[from];
  if (!block) return note;
  const target = Math.max(0, Math.min(note.blocks.length, to));
  if (target === from || target === from + 1) return note;
  const next = note.blocks.slice();
  next.splice(from, 1);
  next.splice(target > from ? target - 1 : target, 0, block);
  return { blocks: next };
}

export function indexOfBlock(note: TextNote, id: string): number {
  return note.blocks.findIndex((block) => block.id === id);
}

// ---------------------------------------------------------------- ranges

export function comparePoints(a: NotePoint, b: NotePoint): number {
  return a.block !== b.block ? a.block - b.block : a.offset - b.offset;
}

export function orderedRange(a: NotePoint, b: NotePoint): NoteRange {
  return comparePoints(a, b) <= 0 ? { start: a, end: b } : { start: b, end: a };
}

export function isCollapsed(range: NoteRange): boolean {
  return comparePoints(range.start, range.end) === 0;
}

/** `point` moved onto the note: an index that exists, an offset inside its text. */
export function clampPoint(note: TextNote, point: NotePoint): NotePoint {
  if (note.blocks.length === 0) return { block: 0, offset: 0 };
  const block = Math.max(0, Math.min(note.blocks.length - 1, Math.round(point.block)));
  const length = blockLength(note.blocks[block]);
  return { block, offset: Math.max(0, Math.min(length, Math.round(point.offset))) };
}

function clampRange(note: TextNote, range: NoteRange): NoteRange {
  return orderedRange(clampPoint(note, range.start), clampPoint(note, range.end));
}

/** The part of each text block a range covers: `[index, from, to]`. */
function spans(note: TextNote, range: NoteRange): Array<[number, number, number]> {
  const { start, end } = clampRange(note, range);
  const out: Array<[number, number, number]> = [];
  for (let i = start.block; i <= end.block; i++) {
    const block = note.blocks[i];
    if (!block || block.type !== "text") continue;
    const from = i === start.block ? start.offset : 0;
    const to = i === end.block ? end.offset : blockLength(block);
    out.push([i, from, to]);
  }
  return out;
}

// ---------------------------------------------------------------- editing

/**
 * Return pressed at `point`. A list item or quote with nothing in it ends
 * its list (an indented one steps out a level first); otherwise the block
 * splits there. What follows a title or heading is body text; a list goes
 * on as a list, with the new checklist item unticked.
 */
export function splitBlock(note: TextNote, at: NotePoint, newId: IdSource): NoteEdit {
  const point = clampPoint(note, at);
  const block = note.blocks[point.block];
  if (!block) return { note, caret: point };
  if (block.type !== "text") {
    const line = textBlock(newId());
    return {
      note: insertBlock(note, point.block + 1, line),
      caret: { block: point.block + 1, offset: 0 },
    };
  }
  const length = blockLength(block);
  if (length === 0 && (isList(block.kind) || block.kind === "quote")) {
    const stepped =
      (block.indent ?? 0) > 0
        ? textBlock(block.id, block.kind, [], {
            indent: (block.indent ?? 0) - 1,
            checked: block.checked,
          })
        : textBlock(block.id, "body");
    return { note: replaceBlock(note, point.block, stepped), caret: point };
  }
  const heading = block.kind === "title" || block.kind === "heading" || block.kind === "subheading";
  // At the very start of a heading with text, the new empty line goes above it.
  if (heading && point.offset === 0 && length > 0) {
    return {
      note: insertBlock(note, point.block, textBlock(newId())),
      caret: { block: point.block + 1, offset: 0 },
    };
  }
  const head = asKind(block, block.kind, sliceRuns(block.runs, 0, point.offset));
  const tail = textBlock(
    newId(),
    heading ? "body" : block.kind,
    sliceRuns(block.runs, point.offset),
    { indent: block.indent },
  );
  return {
    note: replaced(note, point.block, 1, head, tail),
    caret: { block: point.block + 1, offset: 0 },
  };
}

/** What Backspace at the very start of a block did. */
export type BackspaceResult =
  | (NoteEdit & { kind: "edited" })
  /** The block before is a section (ink, a picture): the view selects it instead. */
  | { kind: "select"; block: number }
  | { kind: "nothing" };

/**
 * Backspace with the caret at the start of block `index`: an indented item
 * steps out, a list item, quote or heading becomes body text, and body text
 * joins the paragraph before it. An empty paragraph after a section is
 * simply removed.
 */
export function backspaceAtStart(note: TextNote, index: number): BackspaceResult {
  const block = note.blocks[index];
  if (!block || block.type !== "text") return { kind: "nothing" };
  const caret = { block: index, offset: 0 };
  if ((block.indent ?? 0) > 0) {
    const out = textBlock(block.id, block.kind, block.runs, {
      indent: (block.indent ?? 0) - 1,
      checked: block.checked,
    });
    return { kind: "edited", note: replaceBlock(note, index, out), caret };
  }
  if (block.kind !== "body" && !(block.kind === "title" && index === 0)) {
    return { kind: "edited", note: replaceBlock(note, index, asKind(block, "body")), caret };
  }
  const before = note.blocks[index - 1];
  if (!before) return { kind: "nothing" };
  if (before.type !== "text") {
    // An empty line under a section goes, unless it is the note's last line to type on.
    if (blockLength(block) === 0 && index < note.blocks.length - 1) {
      return { kind: "edited", note: removeBlock(note, index), caret: { block: index, offset: 0 } };
    }
    return { kind: "select", block: index - 1 };
  }
  const offset = blockLength(before);
  const joined = asKind(before, before.kind, [...before.runs, ...block.runs]);
  return {
    kind: "edited",
    note: replaced(note, index - 1, 2, joined),
    caret: { block: index - 1, offset },
  };
}

/** Delete pressed at the end of block `index`: the next paragraph joins it. */
export function deleteAtEnd(note: TextNote, index: number): NoteEdit | null {
  const block = note.blocks[index];
  const next = note.blocks[index + 1];
  if (!block || block.type !== "text" || !next || next.type !== "text") return null;
  const joined = asKind(block, block.kind, [...block.runs, ...next.runs]);
  return {
    note: replaced(note, index, 2, joined),
    caret: { block: index, offset: blockLength(block) },
  };
}

/**
 * Remove what a range covers. The paragraphs at its two ends join; sections
 * inside it, and at its ends, go with it. The note never ends up empty.
 */
export function deleteRange(note: TextNote, range: NoteRange, newId: IdSource): NoteEdit {
  const { start, end } = clampRange(note, range);
  if (comparePoints(start, end) === 0) return { note, caret: start };
  const first = note.blocks[start.block];
  const last = note.blocks[end.block];
  const head = first.type === "text" ? sliceRuns(first.runs, 0, start.offset) : null;
  const tail = last.type === "text" ? sliceRuns(last.runs, end.offset) : null;
  let kept: NoteBlock;
  if (head && first.type === "text") {
    kept = asKind(first, first.kind, [...head, ...(tail ?? [])]);
  } else if (tail && last.type === "text") {
    kept = asKind(last, last.kind, tail);
  } else {
    kept = textBlock(newId());
  }
  return {
    note: replaced(note, start.block, end.block - start.block + 1, kept),
    caret: { block: start.block, offset: head ? runsText(head).length : 0 },
  };
}

/**
 * Put `blocks` in at `at` (pasted text, a dropped picture). One paragraph of
 * text flows into the line it lands on; several split that line, the first
 * joining what is before the caret and the last what is after it.
 */
export function insertBlocksAt(
  note: TextNote,
  at: NotePoint,
  blocks: readonly NoteBlock[],
  newId: IdSource,
): NoteEdit {
  const point = clampPoint(note, at);
  if (blocks.length === 0) return { note, caret: point };
  const base = note.blocks[point.block];
  if (!base || base.type !== "text") {
    const index = base ? point.block + 1 : 0;
    const next = note.blocks.slice();
    next.splice(index, 0, ...blocks);
    const lastIndex = index + blocks.length - 1;
    return {
      note: { blocks: next },
      caret: { block: lastIndex, offset: blockLength(blocks[blocks.length - 1]) },
    };
  }
  const head = sliceRuns(base.runs, 0, point.offset);
  const tail = sliceRuns(base.runs, point.offset);
  const headLength = runsText(head).length;
  const out: NoteBlock[] = [];
  let rest = blocks;
  const first = blocks[0];
  if (first.type === "text") {
    // An empty line takes the pasted paragraph's kind; a line with text keeps its own.
    const whole = headLength === 0 && tail.length === 0;
    out.push(
      whole
        ? textBlock(base.id, first.kind, first.runs, first)
        : asKind(base, base.kind, [...head, ...first.runs]),
    );
    rest = blocks.slice(1);
    if (rest.length === 0) {
      const only = out[0] as TextBlock;
      const merged = asKind(only, only.kind, [...only.runs, ...tail]);
      return {
        note: replaced(note, point.block, 1, merged),
        caret: { block: point.block, offset: headLength + blockLength(first) },
      };
    }
  } else if (headLength > 0) {
    // A section splits the line: the space that joined its two halves goes.
    out.push(asKind(base, base.kind, trimmedEnd(head)));
  }
  out.push(...rest.slice(0, -1));
  const last = rest[rest.length - 1];
  let caret: NotePoint;
  if (last.type === "text") {
    out.push(textBlock(last.id, last.kind, [...last.runs, ...tail], last));
    caret = { block: point.block + out.length - 1, offset: blockLength(last) };
  } else {
    out.push(last);
    // The rest of the line, or an empty one, goes under the section.
    const rest = trimmedStart(tail);
    const under =
      headLength > 0 ? textBlock(newId(), base.kind, rest, base) : asKind(base, base.kind, rest);
    out.push(under);
    caret = { block: point.block + out.length - 1, offset: 0 };
  }
  return { note: replaced(note, point.block, 1, ...out), caret };
}

/** Type `text` (no line breaks) with `marks` at `at`. */
export function insertText(note: TextNote, at: NotePoint, text: string, marks: Marks): NoteEdit {
  const point = clampPoint(note, at);
  const block = note.blocks[point.block];
  if (!block || block.type !== "text" || text.length === 0) return { note, caret: point };
  const clean = text.replace(/[\r\n]+/g, " ");
  const runs = [
    ...sliceRuns(block.runs, 0, point.offset),
    { text: clean, marks: block.kind === "mono" ? 0 : marks & ALL_MARKS },
    ...sliceRuns(block.runs, point.offset),
  ];
  return {
    note: replaceBlock(note, point.block, asKind(block, block.kind, runs)),
    caret: { block: point.block, offset: point.offset + clean.length },
  };
}

// ---------------------------------------------------------------- styles

/** The kind every text block a range touches has, or null when they differ (or none is text). */
export function kindIn(note: TextNote, range: NoteRange): TextKind | null {
  const { start, end } = clampRange(note, range);
  let kind: TextKind | null = null;
  for (let i = start.block; i <= end.block; i++) {
    const block = note.blocks[i];
    if (!block || block.type !== "text") continue;
    if (kind !== null && kind !== block.kind) return null;
    kind = block.kind;
  }
  return kind;
}

/**
 * Give every paragraph a range touches `kind`. Asking for the kind they all
 * already have turns them back into body text, so each style button is a
 * switch.
 */
export function setKind(note: TextNote, range: NoteRange, kind: TextKind): TextNote {
  const { start, end } = clampRange(note, range);
  const target = kindIn(note, range) === kind ? "body" : kind;
  const next = note.blocks.slice();
  let changed = false;
  for (let i = start.block; i <= end.block; i++) {
    const block = next[i];
    if (!block || block.type !== "text" || block.kind === target) continue;
    next[i] = textBlock(block.id, target, target === "mono" ? plain(block.runs) : block.runs, {
      indent: block.indent,
    });
    changed = true;
  }
  return changed ? { blocks: next } : note;
}

/** Whether all the text a range covers carries `mark`; at a caret, the text before it. */
export function hasMark(note: TextNote, range: NoteRange, mark: Marks): boolean {
  const ordered = clampRange(note, range);
  if (isCollapsed(ordered)) {
    const block = note.blocks[ordered.start.block];
    if (!block || block.type !== "text") return false;
    return (marksBefore(block.runs, ordered.start.offset) & mark) !== 0;
  }
  let any = false;
  for (const [index, from, to] of spans(note, ordered)) {
    const block = note.blocks[index] as TextBlock;
    for (const run of sliceRuns(block.runs, from, to)) {
      if ((run.marks & mark) === 0) return false;
      any = true;
    }
  }
  return any;
}

/** Switch `mark` over the text a range covers: off when all of it has it, else on. */
export function toggleMark(note: TextNote, range: NoteRange, mark: Marks): TextNote {
  const ordered = clampRange(note, range);
  if (isCollapsed(ordered)) return note;
  const on = !hasMark(note, ordered, mark);
  const next = note.blocks.slice();
  let changed = false;
  for (const [index, from, to] of spans(note, ordered)) {
    const block = next[index] as TextBlock;
    if (block.kind === "mono" || to <= from) continue;
    next[index] = asKind(block, block.kind, withMark(block.runs, from, to, mark, on));
    changed = true;
  }
  return changed ? { blocks: next } : note;
}

/** Indent (`+1`) or outdent (`-1`) the list items a range touches. */
export function indentBlocks(note: TextNote, range: NoteRange, delta: number): TextNote {
  const { start, end } = clampRange(note, range);
  const next = note.blocks.slice();
  let changed = false;
  for (let i = start.block; i <= end.block; i++) {
    const block = next[i];
    if (!block || block.type !== "text" || !canIndent(block.kind)) continue;
    const indent = clampIndent((block.indent ?? 0) + delta);
    if (indent === (block.indent ?? 0)) continue;
    next[i] = textBlock(block.id, block.kind, block.runs, { indent, checked: block.checked });
    changed = true;
  }
  return changed ? { blocks: next } : note;
}

/** Tick or untick the checklist item at `index`. */
export function toggleChecked(note: TextNote, index: number): TextNote {
  const block = note.blocks[index];
  if (!block || block.type !== "text" || block.kind !== "check") return note;
  return replaceBlock(
    note,
    index,
    textBlock(block.id, "check", block.runs, { indent: block.indent, checked: !block.checked }),
  );
}

/**
 * What typing a space after a line's first characters turns the line into,
 * as Markdown users expect: `-` or `*` a bullet, `1.` a numbered item, `[]`
 * a checklist item, `>` a quote, `#`, `##`, `###` the headings. Null for
 * anything else, and for a line that is not body text.
 */
export function shortcutKind(kind: TextKind, typed: string): TextKind | null {
  if (kind !== "body") return null;
  switch (typed) {
    case "-":
      return "dash";
    case "*":
    case "•":
      return "bullet";
    case "1.":
    case "1)":
      return "number";
    case "A.":
    case "A)":
      return "upper";
    case "a.":
    case "a)":
      return "lower";
    case "[]":
    case "[ ]":
      return "check";
    case ">":
      return "quote";
    case "#":
      return "title";
    case "##":
      return "heading";
    case "###":
      return "subheading";
    default:
      return null;
  }
}

// ---------------------------------------------------------------- folding

/** A heading's rank (1 the highest), or 0 for anything that is not a heading. */
export function headingRank(block: NoteBlock): number {
  if (block.type !== "text") return 0;
  return block.kind === "title"
    ? 1
    : block.kind === "heading"
      ? 2
      : block.kind === "subheading"
        ? 3
        : 0;
}

/**
 * What folding does to each block: `foldable` for a heading with something
 * under it (not the note's first line, its title), `hidden` for what a
 * folded heading above holds: everything up to the next heading of its rank
 * or higher. `folded` names the headings folded, by block id.
 */
export function foldPlan(
  blocks: readonly NoteBlock[],
  folded: ReadonlySet<string>,
): Array<{ foldable: boolean; hidden: boolean; folded: boolean }> {
  const out: Array<{ foldable: boolean; hidden: boolean; folded: boolean }> = [];
  let hidingRank = 0;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const rank = headingRank(block);
    if (hidingRank > 0 && rank > 0 && rank <= hidingRank) hidingRank = 0;
    const next = blocks[i + 1];
    const holds =
      rank > 0 &&
      i > 0 &&
      next !== undefined &&
      !(headingRank(next) > 0 && headingRank(next) <= rank);
    const isFolded = holds && folded.has(block.id);
    out.push({ foldable: holds, hidden: hidingRank > 0, folded: isFolded && hidingRank === 0 });
    if (isFolded && hidingRank === 0) hidingRank = rank;
  }
  return out;
}

// ---------------------------------------------------------------- list markers

/** The n-th letter (1 = a), round again after z. */
export function letterOf(n: number, upper: boolean): string {
  const letter = String.fromCharCode(97 + ((Math.max(1, n) - 1) % 26));
  return upper ? letter.toUpperCase() : letter;
}

/**
 * The marker each counted list item shows (`3.`, `C.`, `c.`), by block;
 * null for every other block. A list counts from 1 at each depth, starts
 * again where its kind changes at that depth, and ends at anything that is
 * not a list item. The page and the file both count this way.
 */
export function listMarkers(blocks: readonly NoteBlock[]): Array<string | null> {
  const out: Array<string | null> = [];
  let counts: Array<{ kind: TextKind; n: number } | undefined> = [];
  for (const block of blocks) {
    if (!(block.type === "text" && isList(block.kind))) {
      counts = [];
      out.push(null);
      continue;
    }
    const depth = block.indent ?? 0;
    counts.length = depth + 1;
    if (!ORDERED_KINDS.includes(block.kind)) {
      counts[depth] = undefined;
      out.push(null);
      continue;
    }
    const seen = counts[depth];
    const n = seen && seen.kind === block.kind ? seen.n + 1 : 1;
    counts[depth] = { kind: block.kind, n };
    out.push(block.kind === "number" ? `${n}.` : `${letterOf(n, block.kind === "upper")}.`);
  }
  return out;
}

// ---------------------------------------------------------------- ink

/** The lowest y any ink in a section reaches, its width included; 0 with none. */
export function inkBottom(strokes: readonly Stroke[]): number {
  let bottom = 0;
  for (const stroke of strokes) {
    const box = strokeBounds(stroke);
    if (box) bottom = Math.max(bottom, box.maxY + stroke.size / 2);
  }
  return bottom;
}

export function clampInkHeight(height: number): number {
  if (!Number.isFinite(height)) return INK_DEFAULT_HEIGHT;
  return Math.max(INK_MIN_HEIGHT, Math.min(INK_MAX_HEIGHT, Math.round(height)));
}

/**
 * The height a section should have once ink reaches `bottom`: unchanged
 * while there is room under it, else enough for {@link INK_GROW_ROOM} more.
 */
export function grownHeight(height: number, bottom: number): number {
  if (bottom <= height - INK_GROW_MARGIN) return height;
  return clampInkHeight(Math.max(height, bottom + INK_GROW_ROOM));
}

/** A section's height trimmed to what it holds; never taller than it was. */
export function trimmedHeight(block: InkBlock): number {
  const bottom = inkBottom(block.strokes);
  if (bottom === 0) return block.height;
  return Math.min(block.height, clampInkHeight(bottom + INK_TRIM_ROOM));
}

/** Strokes moved down by `dy` (a section resized from its top edge). */
export function shiftStrokes(strokes: readonly Stroke[], dy: number): Stroke[] {
  if (dy === 0) return strokes.slice();
  return strokes.map((stroke) => {
    const pts = stroke.pts.slice();
    for (let i = 1; i < pts.length; i += 3) pts[i] += dy;
    return { ...stroke, pts };
  });
}

/** The highest y any ink reaches (0 with none): how far a section's top edge can come down. */
export function inkTop(strokes: readonly Stroke[]): number {
  let top = Infinity;
  for (const stroke of strokes) {
    const box = strokeBounds(stroke);
    if (box) top = Math.min(top, box.minY - stroke.size / 2);
  }
  return Number.isFinite(top) ? Math.max(0, top) : 0;
}

/** A picture's shown width, as a share of the column (1 fills it). */
export function imageShare(block: ImageBlock): number {
  if (block.width === undefined || !Number.isFinite(block.width)) return 1;
  return Math.max(IMAGE_MIN_SHARE, Math.min(1, block.width / INK_WIDTH));
}

/** The width to store for a picture shown at `share` of the column; absent at full width. */
export function imageWidthFor(share: number): number | undefined {
  // Within a few percent of the column it snaps to it.
  if (!Number.isFinite(share) || share >= 0.97) return undefined;
  return Math.round(Math.max(IMAGE_MIN_SHARE, share) * INK_WIDTH);
}

// ---------------------------------------------------------------- reading

/** A note's title: its first line of text with anything in it. */
export function noteTitle(note: TextNote): string {
  for (const block of note.blocks) {
    const text = blockText(block).trim();
    if (text) return text;
  }
  return "";
}

/** The first `count` lines of text after the title, for a preview. */
export function notePreview(note: TextNote, count = 3): string[] {
  const lines: string[] = [];
  let seenTitle = false;
  for (const block of note.blocks) {
    const text = blockText(block).trim();
    if (!text) continue;
    if (!seenTitle) {
      seenTitle = true;
      continue;
    }
    lines.push(text);
    if (lines.length >= count) break;
  }
  return lines;
}

/** Whether the note holds nothing: no text, no ink, no picture. */
export function isBlankNote(note: TextNote): boolean {
  return note.blocks.every(
    (block) =>
      (block.type === "text" && blockLength(block) === 0) ||
      (block.type === "ink" && block.strokes.length === 0),
  );
}
