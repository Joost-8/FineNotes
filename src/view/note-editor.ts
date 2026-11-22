/**
 * The page of a text note: its paragraphs, typed straight into, with the
 * handwriting sections and pictures between them.
 *
 * The paragraphs live in one editable element, so the caret, selection,
 * the keyboard, autocorrect, composition and Scribble are the browser's
 * own. The note (`model/text-note.ts`) stays the truth all the same:
 *
 * - Plain typing and deleting inside a paragraph is left to the browser,
 *   and read back from the page after every input (`note-dom.ts`).
 * - Everything that changes the note's structure (Return, Backspace at the
 *   start of a line, a selection across paragraphs, paste, a style) is
 *   stopped before the browser acts, done on the note, and drawn from it.
 *
 * Sections are islands the browser cannot edit. A tap selects one (then
 * Backspace removes it, a drag moves it, its handle sizes it); in drawing
 * mode the pen writes on the handwriting ones, and the text cannot be
 * edited at all, which also leaves the Pencil's Scribble nothing to write
 * into while it draws.
 */

import { Menu, setIcon } from "obsidian";
import { decodeNote } from "../model/text-note-file";
import { relinkNotePaths } from "../model/note-files";
import {
  BOLD,
  HIGHLIGHTS,
  withMarkOn,
  INK_DEFAULT_HEIGHT,
  INK_GROW_ROOM,
  INK_WIDTH,
  ITALIC,
  STRIKE,
  TEXT_KINDS,
  UNDERLINE,
  backspaceAtStart,
  blockLength,
  blockText,
  clampInkHeight,
  clampPoint,
  deleteAtEnd,
  deleteRange,
  hasMark,
  imageShare,
  imageWidthFor,
  indentBlocks,
  indexOfBlock,
  insertBlock,
  insertBlocksAt,
  insertText,
  foldPlan,
  headingRank,
  canIndent,
  listMarkers,
  isCollapsed,
  kindIn,
  marksBefore,
  moveBlock,
  orderedRange,
  removeBlock,
  replaceBlock,
  setKind,
  shortcutKind,
  sliceRuns,
  splitBlock,
  textBlock,
  toggleChecked,
  toggleMark,
  trimmedHeight,
  withTypingLine,
  INK_PAPERS,
  type AudioBlock,
  type ImageBlock,
  type InkBlock,
  type InkPaper,
  type TableBlock,
  type Marks,
  type NoteBlock,
  type NotePoint,
  type NoteRange,
  type TextBlock,
  type TextKind,
  type TextNote,
  type TextRun,
} from "../model/text-note";
import { offsetOf, positionAt, readRuns } from "./note-dom";
import { InkSection, type InkSectionHost, type NotePen } from "./note-ink";
import { NoteTableView, type TableLabel } from "./note-table-view";
import { emptyTable } from "../model/note-table";
import { findMarks, marksKey, openLinkAt, rankNames, type TextMark } from "../model/note-links";
import type { GraphSpecData } from "../model/document";
import { makeGraph } from "../model/graph-element";
import type { GraphBlock } from "../model/text-note";
import {
  answerSuffix,
  noteAnswers,
  noteGraphs,
  withBlockAfter,
  type LineAnswer,
} from "../model/note-math";
import { NoteGraph } from "./note-graph";
import { InkMaths, type InkMathsHost } from "./note-ink-maths";
import { inkReadingHash, turnInkIntoText, withReading } from "../model/ink-reading";
import type { NoteHits } from "../search/note-search";

/** The name of the highlight a search lights typed words with (styles.css). */
const SEARCH_HIGHLIGHT = "finenotes-note-search";

/** A window with the CSS Custom Highlight API (Safari 17.2, Chrome 105); older ones light no text. */
type HighlightWindow = Window & {
  CSS?: { highlights?: HighlightRegistry };
  Highlight?: typeof Highlight;
};

/** What the editor needs from the view that holds it. */
export interface NoteEditorHost {
  pen(): NotePen;
  /** The eraser's radius, CSS px. */
  eraserSize(): number;
  /** The names of a handwriting section's papers, for its paper menu. */
  paperName(paper: InkPaper): string;
  /** The names of a table's buttons. */
  tableLabel(key: TableLabel): string;
  /** The names a `[[` link can point at: the vault's notes and notebooks. */
  linkNames?(): string[];
  /** Open what a link points at. */
  openLink?(target: string): void;
  /** The folded headings changed (by their text): keep them for the next time the note opens. */
  foldsChanged?(titles: string[]): void;
  pressure(): boolean;
  highlighterAlpha(): number;
  dark(): boolean;
  fingerDraws(): boolean;
  /** A URL the picture at `path` can be shown from, or null when the vault has no such file. */
  imageUrl(path: string): string | null;
  /** Keep these picked or pasted pictures in the vault: each one's path and width in px. */
  saveImages(files: File[]): Promise<Array<{ path: string; width: number }>>;
  /** The note changed and should be saved. */
  changed(): void;
  /** The caret, the styles under it, undo or the mode changed: the bar may need redrawing. */
  stateChanged(): void;
  /** Texts shown on the page. */
  text(
    key: "title" | "delete" | "missing" | "unreadable" | "paper" | "editGraph" | "toText",
  ): string;
  /** Edit a graph in the calculator; `done` gets the edited one. Absent: graphs cannot be edited. */
  editGraph?: (spec: GraphSpecData, done: (spec: GraphSpecData) => void) => void;
  /**
   * What a handwriting section says, for "Turn into text": its reading,
   * read now when the one kept is out of date; null when nothing could be
   * read. Without it the section has no such button.
   */
  turnIntoText?(block: InkBlock): Promise<string | null>;
  /**
   * Handwritten sums work out after their "=" (`note-ink-maths.ts`).
   * Without it nothing is worked out.
   */
  maths?: InkMathsHost;
  /** Draw a recording's card into `card` (emptied first); again whenever its block changes. */
  drawAudio?: (card: HTMLElement, block: AudioBlock) => void;
}

/** What the bar shows about the place the caret is. */
export interface NoteEditorState {
  kind: TextKind | null;
  marks: Marks;
  drawing: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** A list item is under the caret: it can be indented. */
  inList: boolean;
}

interface BlockView {
  el: HTMLElement;
  block: NoteBlock;
  ink?: InkSection;
  table?: NoteTableView;
}

interface Snapshot {
  note: TextNote;
  selection: NoteRange | null;
  typing: boolean;
  time: number;
}

interface Drag {
  id: string;
  pointer: number;
  touch: boolean;
  startX: number;
  startY: number;
  startScroll: number;
  lastY: number;
  lifted: boolean;
  timer: number;
  target: number;
}

const FORMAT_MARKS: Readonly<Record<string, Marks>> = {
  formatBold: BOLD,
  formatItalic: ITALIC,
  formatUnderline: UNDERLINE,
  formatStrikeThrough: STRIKE,
};

/** Typing within this long of the last keystroke undoes as one step. */
const TYPING_GROUP_MS = 1200;
const MAX_UNDO = 300;
/** How far a mouse or pen moves before a pressed section lifts, and a finger's leeway while it holds. */
const DRAG_SLOP_PX = 6;
const HOLD_SLOP_PX = 10;
const HOLD_MS = 280;
/** Near the top or foot of the note a lifted section scrolls it. */
const EDGE_SCROLL_PX = 64;

function sameRuns(a: readonly TextRun[], b: readonly TextRun[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].text !== b[i].text || a[i].marks !== b[i].marks) return false;
  }
  return true;
}

/** `text` (which starts `at` characters into its line) appended, its links as spans. */
function appendMarked(
  holder: HTMLElement,
  text: string,
  at: number,
  marks: readonly TextMark[],
): void {
  let i = 0;
  for (const mark of marks) {
    const from = Math.max(0, mark.from - at);
    const to = Math.min(text.length, mark.to - at);
    if (to <= from || to <= i) continue;
    if (from > i) holder.appendText(text.slice(i, from));
    holder.createSpan({
      cls: "finenotes-note-link",
      text: text.slice(Math.max(i, from), to),
      attr: { "data-fn-kind": mark.kind, "data-fn-target": mark.target },
    });
    i = to;
  }
  if (i < text.length) holder.appendText(text.slice(i));
}

function kindOf(raw: string | undefined): TextKind {
  return TEXT_KINDS.includes(raw as TextKind) ? (raw as TextKind) : "body";
}

/** A graph's spec as a note keeps it (as a notebook page would); null when it plots nothing. */
function storedSpec(spec: GraphSpecData): GraphSpecData | null {
  const stored = makeGraph({ id: "g", x: 0, y: 0, spec }).spec;
  return stored.expressions.length > 0 ? stored : null;
}

function touchIsStylus(event: TouchEvent): boolean {
  for (let i = 0; i < event.changedTouches.length; i++) {
    const touch = event.changedTouches[i] as Touch & { touchType?: string };
    if (touch.touchType === "stylus") return true;
  }
  return false;
}

export class NoteEditor {
  /** The scrolling pane. */
  readonly el: HTMLElement;
  private readonly column: HTMLElement;
  private readonly dateEl: HTMLElement;
  private readonly root: HTMLElement;
  private readonly tail: HTMLElement;
  private readonly dropBar: HTMLElement;
  private note: TextNote = { blocks: [] };
  private readonly views = new Map<string, BlockView>();
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private lastSelection: NoteRange | null = null;
  private selectionBefore: NoteRange | null = null;
  /** Marks switched at a caret, for the next character typed there. */
  private pending: { marks: Marks; at: NotePoint } | null = null;
  private selected: string | null = null;
  private active: string | null = null;
  private drawing = false;
  private penIsDown = false;
  private lastDownType = "";
  private drag: Drag | null = null;
  private dragFrame = 0;
  private stateFrame = 0;
  private sequence = 0;
  /** Sections the pen grew this session, and those sized by hand: only the first are trimmed. */
  private readonly grown = new Set<string>();
  private readonly manual = new Set<string>();
  private readonly inkHost: InkSectionHost;
  /** Handwritten sums, worked out after their "=". */
  private readonly maths: InkMaths | null;
  private readonly stamp = Date.now().toString(36);
  /** The graphs shown, by block id, and the answers typed sums show. */
  private readonly graphs = new Map<string, NoteGraph>();
  private answers = new Map<string, LineAnswer>();
  /** The graphs function lines offer, by block id. */
  private offers = new Map<string, GraphSpecData>();
  /** The section written in last: it is read first. */
  private lastWritten: string | null = null;
  /** What a search found is lit, until the next touch or key. */
  private lit = false;

  constructor(
    parent: HTMLElement,
    private readonly host: NoteEditorHost,
  ) {
    this.el = parent.createDiv({ cls: "finenotes-note-scroll", attr: { tabindex: "-1" } });
    // Obsidian's own swipes (sidebars, back) stay out of the note, as in a notebook.
    this.el.dataset.ignoreSwipe = "true";
    this.column = this.el.createDiv({ cls: "finenotes-note-column" });
    this.dateEl = this.column.createDiv({ cls: "finenotes-note-date" });
    this.root = this.column.createDiv({
      cls: "finenotes-note-doc",
      attr: {
        contenteditable: "true",
        spellcheck: "true",
        role: "textbox",
        "aria-multiline": "true",
      },
    });
    this.tail = this.column.createDiv({ cls: "finenotes-note-tail" });
    this.dropBar = this.column.createDiv({ cls: "finenotes-note-drop" });

    this.inkHost = {
      pen: () => host.pen(),
      eraserSize: () => host.eraserSize(),
      pressure: () => host.pressure(),
      highlighterAlpha: () => host.highlighterAlpha(),
      dark: () => host.dark(),
      fingerDraws: () => host.fingerDraws(),
      drawing: () => this.drawing,
      newStrokeId: () => this.newStrokeId(),
      penArrived: () => this.setDrawing(true, true),
      commit: (id, next, manual) => this.commitInk(id, next, manual === true),
      touched: (id) => this.setActive(id),
      penDown: (down) => {
        this.penIsDown = down;
        if (down) this.maths?.penDown();
      },
      strokeDrawn: (id) => this.maths?.strokeDrawn(id),
    };
    this.maths = host.maths
      ? new InkMaths(
          host.maths,
          {
            block: (id) => {
              const block = this.note.blocks[indexOfBlock(this.note, id)];
              return block?.type === "ink" ? block : null;
            },
            show: (id, answer) => this.views.get(id)?.ink?.showAnswer(answer),
            newStrokeId: () => this.newStrokeId(),
            commit: (id, next) => this.commitInk(id, next, false),
          },
          this.el.win,
        )
      : null;

    this.root.addEventListener("beforeinput", this.onBeforeInput);
    this.root.addEventListener("input", this.onInput);
    this.root.addEventListener("paste", this.onPaste);
    this.root.addEventListener("drop", this.onDrop);
    this.root.addEventListener("dragover", this.onDragOver);
    this.root.addEventListener("dragstart", (event) => event.preventDefault());
    this.root.addEventListener("pointerdown", this.onRootDown);
    this.root.addEventListener("mousedown", this.onRootMouseDown);
    this.root.addEventListener("click", this.onRootClick);
    this.root.addEventListener("touchmove", this.onRootTouchMove, { passive: false });
    this.el.addEventListener("keydown", this.onKeyDown);
    this.el.addEventListener("touchstart", this.onPalm, { passive: false });
    this.el.addEventListener("touchmove", this.onPalm, { passive: false });
    this.tail.addEventListener("pointerdown", this.onTailDown);
    this.tail.addEventListener("click", this.onTailClick);
    this.tail.addEventListener("touchstart", this.onTailTouch, { passive: false });
    this.tail.addEventListener("touchmove", this.onTailTouch, { passive: false });
    this.el.doc.addEventListener("selectionchange", this.onSelectionChange);
    this.el.addEventListener("pointerdown", () => this.clearHits(), { capture: true });
    this.el.addEventListener("keydown", () => this.clearHits(), { capture: true });
  }

  destroy(): void {
    this.clearHits();
    this.el.doc.removeEventListener("selectionchange", this.onSelectionChange);
    this.endDrag(false);
    this.maths?.dispose();
    this.el.win.cancelAnimationFrame(this.stateFrame);
    for (const view of this.views.values()) view.ink?.destroy();
    this.views.clear();
    this.sweepGraphs();
    this.el.remove();
  }

  // -------------------------------------------------------------- the note

  /** Show `note`, as a file just read: nothing to undo, nothing selected. */
  load(note: TextNote): void {
    this.endDrag(false);
    // A file read again numbers its blocks from one again: nothing drawn is carried over.
    for (const view of this.views.values()) view.ink?.destroy();
    this.views.clear();
    this.root.empty();
    this.note = withTypingLine(note, this.newId);
    this.undoStack = [];
    this.redoStack = [];
    this.pending = null;
    this.selected = null;
    this.lastSelection = null;
    this.render();
    this.queueState();
  }

  current(): TextNote {
    return this.note;
  }

  /** Scroll so block `index` is at the top (Home opens a note at one of its pages). */
  revealBlock(index: number): void {
    const block = this.note.blocks[index];
    const el = block ? this.views.get(block.id)?.el : undefined;
    if (!el) return;
    const top = el.getBoundingClientRect().top - this.el.getBoundingClientRect().top;
    this.el.scrollTo({ top: Math.max(0, this.el.scrollTop + top - 16) });
  }

  /** The small line over the title: when the note was last changed. */
  setDate(text: string): void {
    this.dateEl.setText(text);
  }

  state(): NoteEditorState {
    const range = this.selection() ?? this.lastSelection;
    let marks: Marks = 0;
    let kind: TextKind | null = null;
    let inList = false;
    if (range) {
      kind = kindIn(this.note, range);
      inList = kind !== null && canIndent(kind);
      if (this.pending) marks = this.pending.marks;
      else {
        for (const mark of [BOLD, ITALIC, UNDERLINE, STRIKE, ...HIGHLIGHTS.map((h) => h.mark)]) {
          if (hasMark(this.note, range, mark)) marks |= mark;
        }
      }
    }
    return {
      kind,
      marks,
      drawing: this.drawing,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      inList,
    };
  }

  /** New ids never repeat one the file brought: they carry this session's stamp. */
  private readonly newId = (): string => `b${this.stamp}${(++this.sequence).toString(36)}`;

  private newStrokeId(): string {
    return `n${this.stamp}${(++this.sequence).toString(36)}`;
  }

  private queueState(): void {
    if (this.stateFrame) return;
    this.stateFrame = this.el.win.requestAnimationFrame(() => {
      this.stateFrame = 0;
      this.host.stateChanged();
    });
  }

  // -------------------------------------------------------------- drawing the note

  private render(): void {
    const seen = new Set<string>();
    let cursor: ChildNode | null = this.root.firstChild;
    for (const block of this.note.blocks) {
      seen.add(block.id);
      let view = this.views.get(block.id);
      if (!view) {
        view = this.createView(block);
        this.views.set(block.id, view);
      } else if (view.block !== block) {
        this.updateView(view, block);
      }
      if (cursor === view.el) cursor = cursor.nextSibling;
      else this.root.insertBefore(view.el, cursor);
    }
    while (cursor) {
      const next: ChildNode | null = cursor.nextSibling;
      cursor.remove();
      cursor = next;
    }
    for (const [id, view] of this.views) {
      if (seen.has(id)) continue;
      view.ink?.destroy();
      this.views.delete(id);
    }
    this.markFirst();
    this.markLists();
    this.markFolds();
    this.markAnswers();
    this.sweepGraphs();
    if (this.selected && !seen.has(this.selected)) this.selected = null;
    if (this.active && !seen.has(this.active)) this.active = null;
  }

  /** Headings folded now, by block id. */
  private readonly folded = new Set<string>();

  /** The folded headings by their text, to keep across a reload (block ids are not kept). */
  foldedTitles(): string[] {
    return this.note.blocks
      .filter((b) => this.folded.has(b.id))
      .map((b) => blockText(b))
      .filter((text) => text !== "");
  }

  /** Fold the headings with these texts (after a load). */
  foldTitles(titles: readonly string[]): void {
    this.folded.clear();
    const wanted = new Set(titles);
    for (const block of this.note.blocks) {
      if (headingRank(block) > 0 && wanted.has(blockText(block))) this.folded.add(block.id);
    }
    this.markFolds();
  }

  /** Fold or unfold a heading; the caret leaves what it hides. */
  toggleFold(id: string): void {
    if (this.folded.has(id)) this.folded.delete(id);
    else this.folded.add(id);
    this.markFolds();
    const index = indexOfBlock(this.note, id);
    const range = this.selection();
    if (index >= 0 && range && this.folded.has(id) && range.start.block > index) {
      const view = this.views.get(this.note.blocks[range.start.block]?.id ?? "");
      if (view?.el.hasClass("is-folded-away")) {
        this.caretTo({ block: index, offset: blockLength(this.note.blocks[index]) });
      }
    }
    this.host.foldsChanged?.(this.foldedTitles());
  }

  /** Show a fold's chevron on headings that hold something, and hide what folded ones hold. */
  private markFolds(): void {
    const plan = foldPlan(this.note.blocks, this.folded);
    this.note.blocks.forEach((block, i) => {
      const el = this.views.get(block.id)?.el;
      const step = plan[i];
      if (!el || !step) return;
      el.toggleClass("is-folded-away", step.hidden);
      if (step.foldable) el.dataset.foldable = step.folded ? "folded" : "open";
      else if (el.dataset.foldable !== undefined) delete el.dataset.foldable;
    });
    for (const id of Array.from(this.folded)) {
      if (!this.views.has(id)) this.folded.delete(id);
    }
  }

  /** The heading whose chevron (in the margin before it) is under the pointer. */
  private foldAt(event: MouseEvent): string | null {
    const node = event.target as Node | null;
    const line = node?.instanceOf(Element) ? node.closest(".finenotes-note-line") : null;
    if (!line?.instanceOf(HTMLElement) || line.dataset.foldable === undefined) return null;
    const rect = line.getBoundingClientRect();
    const rtl = this.root.win.getComputedStyle(line).direction === "rtl";
    const inMargin = rtl ? event.clientX > rect.right : event.clientX < rect.left;
    return inMargin ? (line.dataset.fnId ?? null) : null;
  }

  /** Counted list items show their number or letter, as the file writes it. */
  private markLists(): void {
    const markers = listMarkers(this.note.blocks);
    this.note.blocks.forEach((block, i) => {
      const el = this.views.get(block.id)?.el;
      if (!el) return;
      const marker = markers[i];
      if (marker === null) {
        if (el.dataset.marker !== undefined) delete el.dataset.marker;
      } else if (el.dataset.marker !== marker) {
        el.dataset.marker = marker;
      }
    });
  }

  /** The first line shows the title's placeholder while it is empty. */
  private markFirst(): void {
    const first = this.note.blocks[0];
    for (const view of this.views.values()) {
      if (view.block.type !== "text") continue;
      const isFirst = view.block === first;
      if (isFirst) view.el.dataset.placeholder = this.host.text("title");
      else delete view.el.dataset.placeholder;
    }
  }

  private createView(block: NoteBlock): BlockView {
    if (block.type === "ink") {
      const ink = new InkSection(block, this.inkHost);
      ink.el.toggleClass("is-empty", block.strokes.length === 0);
      this.addIslandBar(ink.el, block.id, true);
      return { el: ink.el, block, ink };
    }
    if (block.type === "image") {
      const el = createDiv({
        cls: "finenotes-note-image",
        attr: { contenteditable: "false", "data-fn-id": block.id, "data-fn-island": "image" },
      });
      el.createEl("img", { attr: { draggable: "false", alt: "" } });
      el.createDiv({ cls: "finenotes-note-handle" });
      this.addIslandBar(el, block.id);
      const view = { el, block };
      this.drawImage(view, block);
      return view;
    }
    if (block.type === "table") {
      const table = new NoteTableView(block, {
        commit: (id, next, typing) => this.commitTable(id, next, typing),
        remove: (id) => this.removeIsland(id),
        label: (key) => this.host.tableLabel(key),
      });
      return { el: table.el, block, table };
    }
    if (block.type === "graph") return this.createGraphView(block);
    if (block.type === "audio") {
      const el = createDiv({
        cls: "finenotes-note-audio",
        attr: { contenteditable: "false", "data-fn-id": block.id, "data-fn-island": "audio" },
      });
      this.host.drawAudio?.(el.createDiv({ cls: "finenotes-note-audio-card" }), block);
      this.addIslandBar(el, block.id);
      return { el, block };
    }
    if (block.type === "raw") {
      const el = createDiv({
        cls: "finenotes-note-raw",
        attr: { contenteditable: "false", "data-fn-id": block.id, "data-fn-island": "raw" },
      });
      setIcon(el.createSpan({ cls: "finenotes-note-raw-icon" }), "file-question");
      el.createSpan({ text: this.host.text("unreadable") });
      this.addIslandBar(el, block.id);
      return { el, block };
    }
    const el = createDiv({ cls: "finenotes-note-line", attr: { "data-fn-id": block.id } });
    const view = { el, block };
    this.drawLine(el, block, true);
    return view;
  }

  private updateView(view: BlockView, block: NoteBlock): void {
    const previous = view.block;
    view.block = block;
    if (block.type === "ink" && view.ink) {
      view.ink.setBlock(block);
    } else if (block.type === "table" && view.table) {
      view.table.setBlock(block);
    } else if (block.type === "image") {
      this.drawImage(view, block);
    } else if (block.type === "graph") {
      this.graphs.get(block.id)?.setBlock(block);
    } else if (block.type === "audio") {
      this.drawAudioCard(view.el, block);
    } else if (block.type === "text") {
      this.drawLine(view.el, block, previous.type !== "text");
    }
  }

  /** A paragraph's attributes, and its text when the page does not already hold it. */
  private drawLine(el: HTMLElement, block: TextBlock, fresh: boolean): void {
    el.dataset.kind = block.kind;
    if (block.indent) el.dataset.indent = String(block.indent);
    else delete el.dataset.indent;
    if (block.checked) el.dataset.checked = "true";
    else delete el.dataset.checked;
    el.toggleClass("is-blank", block.runs.length === 0);
    const marks = block.kind === "mono" ? [] : findMarks(blockText(block));
    const key = marksKey(marks);
    if (
      !fresh &&
      (el.dataset.marks ?? "") === key &&
      sameRuns(readRuns(el), block.runs) &&
      (block.runs.length > 0 || el.firstChild)
    ) {
      return;
    }
    if (key) el.dataset.marks = key;
    else delete el.dataset.marks;
    el.empty();
    if (block.runs.length === 0) {
      el.createEl("br");
      return;
    }
    let at = 0;
    for (const run of block.runs) {
      let holder: HTMLElement = el;
      if (run.marks & BOLD) holder = holder.createEl("b");
      if (run.marks & ITALIC) holder = holder.createEl("i");
      if (run.marks & UNDERLINE) holder = holder.createEl("u");
      if (run.marks & STRIKE) holder = holder.createEl("s");
      const tint = HIGHLIGHTS.find((h) => (run.marks & h.mark) !== 0);
      if (tint) holder = holder.createEl("mark", { attr: { "data-tint": tint.name } });
      appendMarked(holder, run.text, at, marks);
      at += run.text.length;
    }
  }

  /** Lines whose links changed as they were typed: drawn again, the caret kept. */
  private redecorate(): void {
    const range = this.selection();
    let drawn = false;
    for (const view of this.views.values()) {
      const block = view.block;
      if (block.type !== "text" || block.kind === "mono") continue;
      const key = marksKey(findMarks(blockText(block)));
      if ((view.el.dataset.marks ?? "") === key) continue;
      this.drawLine(view.el, block, true);
      drawn = true;
    }
    if (drawn && range) this.select(range);
  }

  // -------------------------------------------------------------- [[ suggestions

  private suggest: {
    el: HTMLElement;
    names: string[];
    index: number;
    block: number;
    from: number;
  } | null = null;

  /** After typing: offer the vault's notes while a `[[` is open before the caret. */
  private updateSuggest(): void {
    const range = this.selection();
    const names = this.host.linkNames?.();
    const block = range ? this.note.blocks[range.start.block] : undefined;
    const open =
      range && isCollapsed(range) && block?.type === "text" && block.kind !== "mono"
        ? openLinkAt(blockText(block), range.start.offset)
        : null;
    if (!range || !open || !names) {
      this.closeSuggest();
      return;
    }
    const ranked = rankNames(names, open.query);
    if (ranked.length === 0) {
      this.closeSuggest();
      return;
    }
    let el = this.suggest?.el;
    if (!el) {
      el = this.column.createDiv({ cls: "finenotes-note-suggest" });
      el.addEventListener("pointerdown", (event) => event.preventDefault());
      el.addEventListener("mousedown", (event) => event.preventDefault());
    }
    this.suggest = { el, names: ranked, index: 0, block: range.start.block, from: open.from };
    this.drawSuggest();
    // Under the caret.
    const caret = this.root.win.getSelection()?.getRangeAt(0).getBoundingClientRect();
    const column = this.column.getBoundingClientRect();
    if (caret) {
      el.setCssProps({
        "--fn-suggest-x": `${Math.max(0, caret.left - column.left)}px`,
        "--fn-suggest-y": `${caret.bottom - column.top + 6}px`,
      });
    }
  }

  private drawSuggest(): void {
    const suggest = this.suggest;
    if (!suggest) return;
    suggest.el.empty();
    suggest.names.forEach((name, i) => {
      const row = suggest.el.createDiv({ cls: "finenotes-note-suggest-row", text: name });
      row.toggleClass("is-selected", i === suggest.index);
      row.addEventListener("click", () => this.takeSuggest(i));
    });
  }

  private closeSuggest(): void {
    this.suggest?.el.remove();
    this.suggest = null;
  }

  /** Put the chosen name in as `[[Name]]`, the caret after it. */
  private takeSuggest(index: number): void {
    const suggest = this.suggest;
    const range = this.selection();
    if (!suggest || !range) return;
    const name = suggest.names[index];
    this.closeSuggest();
    if (!name) return;
    const block = this.note.blocks[suggest.block];
    const text = blockText(block);
    // A `]]` the browser already closed the link with is taken over, not doubled.
    const end = text.startsWith("]]", range.start.offset)
      ? range.start.offset + 2
      : range.start.offset;
    const removed = deleteRange(
      this.note,
      {
        start: { block: suggest.block, offset: suggest.from },
        end: { block: suggest.block, offset: end },
      },
      this.newId,
    );
    const marks = block.type === "text" ? marksBefore(block.runs, suggest.from) : 0;
    const edit = insertText(removed.note, removed.caret, `[[${name}]]`, marks);
    this.apply(edit.note, edit.caret);
  }

  /** The suggestion list's keys: up, down, Return or Tab to take one, Escape to close. */
  private suggestKey(event: KeyboardEvent): boolean {
    const suggest = this.suggest;
    if (!suggest) return false;
    const move = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (move) {
      suggest.index = (suggest.index + move + suggest.names.length) % suggest.names.length;
      this.drawSuggest();
    } else if (event.key === "Enter" || event.key === "Tab") {
      this.takeSuggest(suggest.index);
    } else if (event.key === "Escape") {
      this.closeSuggest();
    } else {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  /** A link under a tap: open it (Obsidian's live preview does the same). */
  private markAt(event: MouseEvent): { kind: string; target: string } | null {
    const node = event.target as Node | null;
    const el = node?.instanceOf(Element) ? node.closest("[data-fn-target]") : null;
    if (!el?.instanceOf(HTMLElement) || !this.root.contains(el)) return null;
    return { kind: el.dataset.fnKind ?? "", target: el.dataset.fnTarget ?? "" };
  }

  private drawImage(view: BlockView, block: ImageBlock): void {
    const img = view.el.querySelector("img");
    const url = this.host.imageUrl(block.path);
    view.el.toggleClass("is-missing", url === null);
    view.el.setCssProps({ "--fn-share": String(imageShare(block)) });
    if (img) {
      if (url === null) {
        img.removeAttribute("src");
        view.el.setAttribute("aria-label", `${this.host.text("missing")}: ${block.path}`);
      } else if (img.getAttribute("src") !== url) {
        img.setAttribute("src", url);
        view.el.removeAttribute("aria-label");
      }
    }
  }

  /** What a selected section shows: its paper (handwriting only), and remove it. */
  private addIslandBar(el: HTMLElement, id: string, ink = false): void {
    const bar = el.createDiv({ cls: "finenotes-note-island-bar" });
    if (ink) {
      const paper = bar.createEl("button", {
        cls: "clickable-icon finenotes-note-island-button",
        attr: { "aria-label": this.host.text("paper"), type: "button" },
      });
      setIcon(paper, "notebook-text");
      paper.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      paper.addEventListener("pointerup", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.paperMenu(id, event);
      });
    }
    if (ink && this.host.turnIntoText) {
      const toText = bar.createEl("button", {
        cls: "clickable-icon finenotes-note-island-button",
        attr: { "aria-label": this.host.text("toText"), type: "button" },
      });
      setIcon(toText, "type");
      toText.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      toText.addEventListener("pointerup", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void this.turnIntoText(id);
      });
    }
    const button = bar.createEl("button", {
      cls: "clickable-icon finenotes-note-island-button",
      attr: { "aria-label": this.host.text("delete"), type: "button" },
    });
    setIcon(button, "trash-2");
    // On pointerup: a Pencil's tap on a handwriting section makes no click.
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener("pointerup", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.removeIsland(id);
    });
  }

  private paperMenu(id: string, event: PointerEvent): void {
    const block = this.note.blocks.find((b) => b.id === id);
    if (!block || block.type !== "ink") return;
    const menu = new Menu();
    const icons: Record<InkPaper, string> = {
      blank: "square",
      lined: "align-justify",
      squared: "grid-3x3",
      dotted: "grip",
    };
    for (const paper of INK_PAPERS) {
      menu.addItem((item) =>
        item
          .setTitle(this.host.paperName(paper))
          .setIcon(icons[paper])
          .setChecked((block.paper ?? "blank") === paper)
          .onClick(() => this.setPaper(id, paper)),
      );
    }
    menu.showAtPosition({ x: event.clientX, y: event.clientY });
  }

  /** Give a handwriting section another paper; one undo step. */
  setPaper(id: string, paper: InkPaper): void {
    const block = this.note.blocks.find((b) => b.id === id);
    if (!block || block.type !== "ink" || (block.paper ?? "blank") === paper) return;
    const { paper: _old, ...rest } = block;
    const next: InkBlock = paper === "blank" ? rest : { ...rest, paper };
    this.apply(replaceBlock(this.note, indexOfBlock(this.note, id), next));
  }

  /** Pictures whose file has appeared, moved or gone: look them up again. */
  refreshImages(): void {
    for (const view of this.views.values()) {
      if (view.block.type === "image") this.drawImage(view, view.block);
    }
  }

  /** The theme or a pen setting changed. */
  refreshInk(): void {
    for (const view of this.views.values()) view.ink?.redraw();
    for (const graph of this.graphs.values()) graph.redraw();
  }

  // -------------------------------------------------------------- selection

  private pointOf(node: Node | null, offset: number): NotePoint | null {
    if (!node || !this.root.contains(node)) return null;
    const count = this.note.blocks.length;
    if (count === 0) return null;
    if (node === this.root) {
      if (offset < count) return { block: offset, offset: 0 };
      return { block: count - 1, offset: blockLength(this.note.blocks[count - 1]) };
    }
    let el: Node = node;
    while (el.parentNode && el.parentNode !== this.root) el = el.parentNode;
    const index = Array.prototype.indexOf.call(this.root.childNodes, el);
    const block = this.note.blocks[index];
    if (!block) return null;
    if (block.type !== "text") return { block: index, offset: 0 };
    return clampPoint(this.note, { block: index, offset: offsetOf(el, node, offset) });
  }

  /** The selection inside the note, start before end; null when it is elsewhere. */
  selection(): NoteRange | null {
    const selection = this.root.win.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const anchor = this.pointOf(selection.anchorNode, selection.anchorOffset);
    const focus = this.pointOf(selection.focusNode, selection.focusOffset);
    return anchor && focus ? orderedRange(anchor, focus) : null;
  }

  private domPoint(point: NotePoint): { node: Node; offset: number } {
    const at = clampPoint(this.note, point);
    const el = this.root.childNodes[at.block];
    const block = this.note.blocks[at.block];
    if (!el || !block || block.type !== "text") return { node: this.root, offset: at.block };
    return positionAt(el, at.offset);
  }

  private select(range: NoteRange, focus = true): void {
    const selection = this.root.win.getSelection();
    if (!selection) return;
    const start = this.domPoint(range.start);
    const end = this.domPoint(range.end);
    const dom = this.root.doc.createRange();
    try {
      dom.setStart(start.node, start.offset);
      dom.setEnd(end.node, end.offset);
    } catch {
      return;
    }
    if (focus && !this.drawing && this.root.doc.activeElement !== this.root) {
      this.root.focus({ preventScroll: true });
    }
    selection.removeAllRanges();
    selection.addRange(dom);
    this.lastSelection = range;
  }

  private caretTo(point: NotePoint): void {
    this.select({ start: point, end: point });
    const el = this.root.childNodes[clampPoint(this.note, point).block];
    if (el?.instanceOf(HTMLElement)) el.scrollIntoView({ block: "nearest" });
  }

  private readonly onSelectionChange = (): void => {
    if (this.suggest) {
      const at = this.selection();
      if (!at || at.start.block !== this.suggest.block) this.closeSuggest();
    }
    const range = this.selection();
    if (!range) return;
    this.lastSelection = range;
    if (this.selected && !this.drag) this.selectIsland(null);
    if (
      this.pending &&
      (!isCollapsed(range) ||
        range.start.block !== this.pending.at.block ||
        range.start.offset !== this.pending.at.offset)
    ) {
      this.pending = null;
    }
    this.queueState();
  };

  // -------------------------------------------------------------- changing the note

  private record(note: TextNote, selection: NoteRange | null, typing: boolean): void {
    const now = Date.now();
    const top = this.undoStack[this.undoStack.length - 1];
    if (typing && top?.typing && now - top.time < TYPING_GROUP_MS) {
      top.time = now;
    } else {
      this.undoStack.push({ note, selection, typing, time: now });
      if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    }
    this.redoStack = [];
  }

  /**
   * Make `next` the note. `caret` is where the caret goes; `silent` changes
   * are housekeeping the user did not ask for, and leave nothing to undo.
   */
  private apply(next: TextNote, caret?: NotePoint | NoteRange | null, silent = false): void {
    if (next !== this.note) {
      if (!silent) this.record(this.note, this.lastSelection, false);
      this.note = withTypingLine(next, this.newId);
      this.render();
      this.host.changed();
    }
    if (caret) {
      if ("block" in caret) this.caretTo(caret);
      else this.select(caret);
    }
    this.queueState();
  }

  undo(): void {
    this.step(this.undoStack, this.redoStack);
  }

  redo(): void {
    this.step(this.redoStack, this.undoStack);
  }

  private step(from: Snapshot[], to: Snapshot[]): void {
    const snapshot = from.pop();
    if (!snapshot) return;
    to.push({ note: this.note, selection: this.lastSelection, typing: false, time: 0 });
    this.note = snapshot.note;
    this.pending = null;
    this.render();
    if (snapshot.selection && !this.drawing) this.select(snapshot.selection);
    this.host.changed();
    this.queueState();
  }

  /**
   * Read the paragraphs back from the page after the browser edited them.
   * Whatever it left that the editor did not draw (a paragraph it made, a
   * stray text node) becomes a proper line. True when the note changed.
   */
  private syncFromDom(): boolean {
    const before = this.selection();
    const blocks: NoteBlock[] = [];
    const seen = new Set<string>();
    let stray = false;
    for (const child of Array.from(this.root.childNodes)) {
      if (child.nodeType !== 1) {
        const text = child.nodeValue ?? "";
        if (child.nodeType === 3 && text.trim()) {
          const block = textBlock(this.newId(), "body", [{ text, marks: 0 }]);
          blocks.push(block);
        }
        stray = true;
        continue;
      }
      const el = child as HTMLElement;
      const id = el.dataset.fnId ?? "";
      const view = this.views.get(id);
      const known = view !== undefined && view.el === el && !seen.has(id);
      if (el.dataset.fnIsland) {
        if (known) {
          blocks.push(view.block);
          seen.add(id);
        } else stray = true;
        continue;
      }
      const runs = readRuns(el);
      if (known && view.block.type === "text") {
        const old = view.block;
        const block = sameRuns(old.runs, runs) ? old : textBlock(id, old.kind, runs, old);
        view.block = block;
        el.toggleClass("is-blank", runs.length === 0);
        blocks.push(block);
        seen.add(id);
        continue;
      }
      // A paragraph the browser made: keep its text, draw it as one of ours.
      blocks.push(
        textBlock(this.newId(), kindOf(el.dataset.kind), runs, {
          indent: Number(el.dataset.indent) || 0,
        }),
      );
      stray = true;
    }
    const next = withTypingLine({ blocks }, this.newId);
    const changed =
      next.blocks.length !== this.note.blocks.length ||
      next.blocks.some((block, i) => block !== this.note.blocks[i]);
    this.note = next;
    if (stray || next.blocks.length !== blocks.length) {
      this.root.empty();
      for (const view of this.views.values()) {
        if (!seen.has(view.block.id)) view.ink?.destroy();
      }
      for (const id of Array.from(this.views.keys())) if (!seen.has(id)) this.views.delete(id);
      this.render();
      if (before) this.select(before);
    } else {
      for (const [id, view] of this.views) {
        if (seen.has(id)) continue;
        view.ink?.destroy();
        this.views.delete(id);
      }
      this.markFirst();
      this.markAnswers();
      this.sweepGraphs();
    }
    return changed;
  }

  // -------------------------------------------------------------- typing

  private touchesIsland(range: NoteRange): boolean {
    for (let i = range.start.block; i <= range.end.block; i++) {
      if (this.note.blocks[i]?.type !== "text") return true;
    }
    return false;
  }

  private readonly onBeforeInput = (event: InputEvent): void => {
    if (this.drawing) {
      event.preventDefault();
      return;
    }
    const type = event.inputType;
    if (this.inCell(event.target) && !type.startsWith("history")) return;
    const range = this.selection();
    this.selectionBefore = range;
    if (type === "historyUndo" || type === "historyRedo") {
      event.preventDefault();
      if (type === "historyUndo") this.undo();
      else this.redo();
      return;
    }
    if (type in FORMAT_MARKS) {
      event.preventDefault();
      this.toggleMark(FORMAT_MARKS[type]);
      return;
    }
    if (
      type.startsWith("format") ||
      type === "insertFromDrop" ||
      type.startsWith("insertFromPaste")
    ) {
      // Paste and drop are handled by their own events; other formats are not offered.
      event.preventDefault();
      return;
    }
    if (!range || event.isComposing) return;
    const collapsed = isCollapsed(range);
    const across = range.start.block !== range.end.block || this.touchesIsland(range);

    if (type === "insertParagraph" || type === "insertLineBreak") {
      event.preventDefault();
      const here = this.note.blocks[range.end.block];
      if (here && this.folded.has(here.id)) this.toggleFold(here.id);
      let note = this.note;
      let at = range.start;
      if (!collapsed) ({ note, caret: at } = deleteRange(note, range, this.newId));
      const edit = splitBlock(note, at, this.newId);
      this.apply(edit.note, edit.caret);
      return;
    }

    if (type.startsWith("delete")) {
      if (!collapsed) {
        if (!across) return;
        event.preventDefault();
        const edit = deleteRange(this.note, range, this.newId);
        this.apply(edit.note, edit.caret);
        return;
      }
      const block = this.note.blocks[range.start.block];
      if (type.endsWith("Backward") && range.start.offset === 0) {
        event.preventDefault();
        this.backspace(range.start.block);
        return;
      }
      if (type.endsWith("Forward") && range.start.offset === blockLength(block)) {
        event.preventDefault();
        const edit = deleteAtEnd(this.note, range.start.block);
        const next = this.note.blocks[range.start.block + 1];
        if (edit) this.apply(edit.note, edit.caret);
        else if (next && next.type !== "text") this.selectIsland(next.id);
      }
      return;
    }

    if (type !== "insertText" && type !== "insertReplacementText") return;
    const data = event.data ?? "";
    if (across) {
      event.preventDefault();
      const removed = deleteRange(this.note, range, this.newId);
      const edit = insertText(removed.note, removed.caret, data, 0);
      this.apply(edit.note, edit.caret);
      return;
    }
    const block = this.note.blocks[range.start.block];
    if (!collapsed || type !== "insertText" || block.type !== "text") return;
    if (data === " ") {
      // "- " at the start of a line makes it a bullet, as Markdown users expect.
      const typed = blockText(block).slice(0, range.start.offset);
      const kind = typed.length <= 3 ? shortcutKind(block.kind, typed) : null;
      if (kind) {
        event.preventDefault();
        const rest = sliceRuns(block.runs, range.start.offset);
        const next = replaceBlock(this.note, range.start.block, textBlock(block.id, kind, rest));
        this.apply(next, { block: range.start.block, offset: 0 });
        return;
      }
    }
    if (this.pending && data) {
      event.preventDefault();
      const marks = this.pending.marks;
      this.pending = null;
      const before = this.note;
      const edit = insertText(before, range.start, data, marks);
      this.record(before, range, true);
      this.apply(edit.note, edit.caret, true);
    }
  };

  private readonly onInput = (event: Event): void => {
    if (this.inCell(event.target)) return;
    const before = this.note;
    if (this.syncFromDom()) {
      this.record(before, this.selectionBefore, true);
      this.host.changed();
    }
    if (!(event as InputEvent).isComposing) {
      this.redecorate();
      this.updateSuggest();
    }
    this.queueState();
  };

  private backspace(index: number): void {
    const result = backspaceAtStart(this.note, index);
    if (result.kind === "edited") this.apply(result.note, result.caret);
    else if (result.kind === "select") this.selectIsland(this.note.blocks[result.block].id);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (this.suggestKey(event)) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const handled = (): void => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (mod && !event.altKey && (key === "z" || key === "y")) {
      handled();
      if (key === "y" || event.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (this.inCell(event.target)) return;
    if (this.selected) {
      const index = indexOfBlock(this.note, this.selected);
      if (key === "Backspace" || key === "Delete") {
        handled();
        this.removeIsland(this.selected);
      } else if (key === "Enter") {
        handled();
        const edit = splitBlock(this.note, { block: index, offset: 0 }, this.newId);
        this.selectIsland(null);
        this.apply(edit.note, edit.caret);
      } else if (key === "ArrowUp" || key === "ArrowLeft") {
        handled();
        this.leaveIsland(index, -1);
      } else if (key === "ArrowDown" || key === "ArrowRight") {
        handled();
        this.leaveIsland(index, 1);
      } else if (key === "Escape") {
        handled();
        this.selectIsland(null);
      }
      return;
    }
    if (key === "Escape" && this.drawing) {
      handled();
      this.setDrawing(false);
      return;
    }
    if (this.drawing) return;
    if (mod && !event.altKey) {
      const mark = key === "b" ? BOLD : key === "i" ? ITALIC : key === "u" ? UNDERLINE : 0;
      const strike = key === "x" && event.shiftKey ? STRIKE : 0;
      if (mark || strike) {
        handled();
        this.toggleMark(mark || strike);
      }
      return;
    }
    if (key === "Tab") {
      const range = this.selection();
      if (!range) return;
      const next = indentBlocks(this.note, range, event.shiftKey ? -1 : 1);
      // Tab only means something in a list; elsewhere it stays Obsidian's.
      if (next === this.note && !this.state().inList) return;
      handled();
      this.apply(next, range);
    }
  };

  /** From a selected section to the text beside it. */
  private leaveIsland(index: number, direction: -1 | 1): void {
    for (let i = index + direction; i >= 0 && i < this.note.blocks.length; i += direction) {
      const block = this.note.blocks[i];
      if (block.type !== "text") continue;
      this.selectIsland(null);
      this.caretTo({ block: i, offset: direction < 0 ? blockLength(block) : 0 });
      return;
    }
  }

  // -------------------------------------------------------------- styles

  private workingRange(): NoteRange | null {
    return this.selection() ?? this.lastSelection;
  }

  toggleMark(mark: Marks): void {
    const range = this.workingRange();
    if (!range || this.drawing) return;
    if (isCollapsed(range)) {
      const block = this.note.blocks[range.start.block];
      if (!block || block.type !== "text" || block.kind === "mono") return;
      const base = this.pending?.marks ?? marksBefore(block.runs, range.start.offset);
      const marks = (base & mark) !== 0 ? base & ~mark : withMarkOn(base, mark);
      this.pending = { marks, at: range.start };
      this.select(range);
      this.queueState();
      return;
    }
    this.apply(toggleMark(this.note, range, mark), range);
  }

  setKind(kind: TextKind): void {
    const range = this.workingRange();
    if (!range || this.drawing) return;
    this.apply(setKind(this.note, range, kind), range);
  }

  indent(delta: number): void {
    const range = this.workingRange();
    if (!range || this.drawing) return;
    this.apply(indentBlocks(this.note, range, delta), range);
  }

  // -------------------------------------------------------------- paste and pictures

  private insertBlocks(blocks: readonly NoteBlock[]): void {
    if (blocks.length === 0) return;
    const last = this.note.blocks.length - 1;
    const end = { block: last, offset: blockLength(this.note.blocks[last]) };
    const range = this.workingRange() ?? { start: end, end };
    let note = this.note;
    let at = range.start;
    if (!isCollapsed(range)) ({ note, caret: at } = deleteRange(note, range, this.newId));
    const edit = insertBlocksAt(note, at, blocks, this.newId);
    this.apply(edit.note, edit.caret);
  }

  /** Put pictures in at the caret (or at the end, with none). */
  async insertImages(files: File[]): Promise<void> {
    const saved = await this.host.saveImages(files);
    // A picture narrower than the column is shown at its own size, not blown up.
    const blocks = saved.map(({ path, width }): ImageBlock => {
      const fitted = width > 0 ? imageWidthFor(width / INK_WIDTH) : undefined;
      return { type: "image", id: this.newId(), path, ...(fitted ? { width: fitted } : {}) };
    });
    if (this.drawing) this.setDrawing(false);
    this.insertBlocks(blocks);
  }

  private readonly onPaste = (event: ClipboardEvent): void => {
    event.preventDefault();
    const data = event.clipboardData;
    if (!data || this.drawing) return;
    const files = Array.from(data.files).filter((file) => file.type.startsWith("image/"));
    if (files.length > 0) {
      void this.insertImages(files);
      return;
    }
    const text = data.getData("text/plain").replace(/\r\n?/g, "\n").replace(/\n+$/, "");
    if (text) this.insertBlocks(decodeNote(text, this.newId).blocks);
  };

  private readonly onDragOver = (event: DragEvent): void => {
    if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
  };

  private readonly onDrop = (event: DragEvent): void => {
    event.preventDefault();
    const files = Array.from(event.dataTransfer?.files ?? []).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (files.length > 0) void this.insertImages(files);
  };

  // -------------------------------------------------------------- sections

  private selectIsland(id: string | null): void {
    if (this.selected === id) return;
    if (this.selected) this.views.get(this.selected)?.el.removeClass("is-selected");
    this.selected = id;
    if (id) {
      this.views.get(id)?.el.addClass("is-selected");
      this.root.win.getSelection()?.removeAllRanges();
      // The pane takes the keys (Backspace, the arrows) without raising a keyboard.
      this.el.focus({ preventScroll: true });
    }
  }

  private setActive(id: string | null): void {
    if (this.active === id) return;
    if (this.active) this.views.get(this.active)?.el.removeClass("is-active");
    this.active = id;
    if (id) this.views.get(id)?.el.addClass("is-active");
  }

  private removeIsland(id: string): void {
    const index = indexOfBlock(this.note, id);
    if (index < 0) return;
    this.selectIsland(null);
    const next = removeBlock(this.note, index);
    const at = Math.min(index, next.blocks.length - 1);
    const block = next.blocks[at];
    this.apply(next, !this.drawing && block?.type === "text" ? { block: at, offset: 0 } : null);
  }

  /** A table's cells or shape changed; typing in a cell groups with the typing around it. */
  private commitTable(id: string, next: TableBlock, typing: boolean): void {
    const index = indexOfBlock(this.note, id);
    if (index < 0) return;
    this.record(this.note, this.lastSelection, typing);
    this.note = replaceBlock(this.note, index, next);
    this.render();
    this.host.changed();
    this.queueState();
  }

  /** Put a new table in at the caret, its first cell ready to type in. */
  insertTable(): void {
    if (this.drawing) return;
    const table = emptyTable(this.newId());
    this.insertBlocks([table]);
    this.views.get(table.id)?.table?.focusCell({ row: 0, column: 0 });
  }

  /** Whether an event happened inside a table's cell: the table handles it. */
  private inCell(target: EventTarget | null): boolean {
    const node = target as Node | null;
    const el = node?.instanceOf(Element) ? node : node?.parentElement;
    return el?.closest(".finenotes-note-table [data-row]") != null;
  }

  private commitInk(id: string, next: InkBlock, manual: boolean): void {
    const index = indexOfBlock(this.note, id);
    if (index < 0) return;
    if (manual) this.manual.add(id);
    else this.grown.add(id);
    this.lastWritten = id;
    this.apply(replaceBlock(this.note, index, next));
  }

  // -------------------------------------------------------------- readings and search

  /** The section written in last, if it is still there. */
  lastInk(): string | null {
    return this.lastWritten && indexOfBlock(this.note, this.lastWritten) >= 0
      ? this.lastWritten
      : null;
  }

  /** Whether a stroke is open: nothing should change the note under the pen. */
  isPenDown(): boolean {
    return this.penIsDown;
  }

  /**
   * Keep what the device read a section as (null: no reading), when its
   * ink is still the ink that was read (`of`). Nothing to undo: it is
   * housekeeping, as saving the file is. False when the section has gone
   * or its ink changed meanwhile.
   */
  setReading(id: string, reading: { text: string; of: string } | null): boolean {
    const index = indexOfBlock(this.note, id);
    const block = this.note.blocks[index];
    if (!block || block.type !== "ink") return false;
    if (reading && inkReadingHash(block.strokes) !== reading.of) return false;
    const next = withReading(block, reading);
    if (next !== block) this.apply(replaceBlock(this.note, index, next), null, true);
    return true;
  }

  /** Replace a handwriting section with typed paragraphs of what it says: one undo step. */
  private async turnIntoText(id: string): Promise<void> {
    const block = this.note.blocks.find((b) => b.id === id);
    if (!block || block.type !== "ink" || !this.host.turnIntoText) return;
    const text = await this.host.turnIntoText(block);
    // The section may have changed or gone while it was read (a reading kept meanwhile is no change).
    const index = indexOfBlock(this.note, id);
    const now = this.note.blocks[index];
    if (text === null || now?.type !== "ink" || now.strokes !== block.strokes) return;
    const edit = turnInkIntoText(this.note, index, text, this.newId);
    if (!edit) return;
    this.selectIsland(null);
    if (this.drawing) this.setDrawing(false);
    this.apply(edit.note, edit.caret);
  }

  /**
   * Light what a search found: typed words with a highlight over the text
   * (the browser's own, so neither the caret nor the keyboard moves), and
   * the sections that hold it with an outline, until `markInk` lights
   * their words. The first hit is scrolled into view.
   */
  showHits(hits: NoteHits): void {
    this.clearHits();
    const ranges: Range[] = [];
    for (const hit of hits.text) {
      const start = this.domPoint({ block: hit.block, offset: hit.start });
      const end = this.domPoint({ block: hit.block, offset: hit.end });
      const range = this.root.doc.createRange();
      try {
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        ranges.push(range);
      } catch {
        // A line the page has not drawn: nothing to light there.
      }
    }
    const win = this.root.win as HighlightWindow;
    const registry = win.CSS?.highlights;
    if (registry && win.Highlight && ranges.length > 0) {
      registry.set(SEARCH_HIGHLIGHT, new win.Highlight(...ranges));
    }
    for (const index of hits.ink) {
      this.views.get(this.note.blocks[index]?.id ?? "")?.el.addClass("is-search-hit");
    }
    this.lit = ranges.length > 0 || hits.ink.length > 0;
    // The first hit in the note's order.
    const first = Math.min(hits.text[0]?.block ?? Infinity, hits.ink[0] ?? Infinity);
    const block = Number.isFinite(first) ? this.note.blocks[first] : undefined;
    if (block) this.views.get(block.id)?.el.scrollIntoView({ block: "center" });
  }

  /** Light the words a search found in a section, each its strokes. */
  markInk(id: string, groups: readonly (readonly string[])[]): void {
    const view = this.views.get(id);
    if (!view?.ink || groups.length === 0) return;
    view.ink.setHits(groups);
    view.el.removeClass("is-search-hit");
    this.lit = true;
  }

  clearHits(): void {
    if (!this.lit) return;
    this.lit = false;
    (this.root.win as HighlightWindow).CSS?.highlights?.delete(SEARCH_HIGHLIGHT);
    for (const view of this.views.values()) {
      view.el.removeClass("is-search-hit");
      view.ink?.setHits(null);
    }
  }

  private islandAt(target: EventTarget | null): BlockView | null {
    const node = target as Node | null;
    const el = node?.instanceOf(Element) ? node.closest("[data-fn-island]") : null;
    const id = el?.instanceOf(HTMLElement) ? (el.dataset.fnId ?? "") : "";
    return this.views.get(id) ?? null;
  }

  private readonly onRootDown = (event: PointerEvent): void => {
    this.lastDownType = event.pointerType;
    const view = this.islandAt(event.target);
    if (!view) {
      if (this.selected) this.selectIsland(null);
      // A tap on the text with a finger or the mouse ends drawing: typing is what was meant.
      if (this.drawing && event.pointerType !== "pen") this.setDrawing(false);
      return;
    }
    if (this.drawing) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest(".finenotes-note-island-bar, .finenotes-note-ink-edge")) return;
    // A press in a table's cell puts the caret there; the table's edge selects and drags it.
    if (this.inCell(target)) {
      if (this.selected) this.selectIsland(null);
      return;
    }
    if (target.closest(".finenotes-note-handle") && view.block.type === "image") {
      event.preventDefault();
      this.selectIsland(view.block.id);
      this.resizeImage(view, event);
      return;
    }
    if (event.pointerType !== "touch") event.preventDefault();
    this.selectIsland(view.block.id);
    this.beginDrag(view, event);
  };

  /** A press on a checklist item's box, or on a section, must not move the caret. */
  private readonly onRootMouseDown = (event: MouseEvent): void => {
    if (this.inCell(event.target)) return;
    if (this.checkAt(event) !== null || this.foldAt(event) || this.islandAt(event.target)) {
      event.preventDefault();
    }
  };

  private readonly onRootClick = (event: MouseEvent): void => {
    if (this.drawing) return;
    const fold = this.foldAt(event);
    if (fold) {
      event.preventDefault();
      this.toggleFold(fold);
      return;
    }
    const mark = this.markAt(event);
    const tapped = this.selection();
    if (mark && (!tapped || isCollapsed(tapped))) {
      event.preventDefault();
      this.host.openLink?.(mark.target);
      return;
    }
    if (this.takeAnswer(event)) return;
    const index = this.checkAt(event);
    if (index === null) return;
    event.preventDefault();
    const range = this.lastSelection;
    this.apply(toggleChecked(this.note, index));
    if (range && this.root.doc.activeElement === this.root) this.select(range);
  };

  /** The checklist item whose box is under the pointer, by index; else null. */
  private checkAt(event: MouseEvent): number | null {
    const win = this.root.win;
    const node = event.target as Node | null;
    const line = node?.instanceOf(Element) ? node.closest(".finenotes-note-line") : null;
    if (!line?.instanceOf(HTMLElement) || line.dataset.kind !== "check") return null;
    const rect = line.getBoundingClientRect();
    const style = win.getComputedStyle(line);
    const rtl = style.direction === "rtl";
    const gutter = parseFloat(rtl ? style.paddingRight : style.paddingLeft) || 0;
    const inBox = rtl ? event.clientX > rect.right - gutter : event.clientX < rect.left + gutter;
    if (!inBox) return null;
    const index = indexOfBlock(this.note, line.dataset.fnId ?? "");
    return index >= 0 ? index : null;
  }

  private resizeImage(view: BlockView, down: PointerEvent): void {
    const handle = down.target as HTMLElement;
    const block = view.block as ImageBlock;
    const column = this.root.clientWidth || 1;
    const startWidth = view.el.getBoundingClientRect().width;
    const rtl = this.root.win.getComputedStyle(this.root).direction === "rtl";
    let share = imageShare(block);
    try {
      handle.setPointerCapture(down.pointerId);
    } catch {
      // A pointer that is already gone cannot be captured.
    }
    view.el.addClass("is-resizing");
    const move = (event: PointerEvent): void => {
      if (event.pointerId !== down.pointerId) return;
      const dx = (event.clientX - down.clientX) * (rtl ? -1 : 1);
      const width = imageWidthFor((startWidth + dx) / column);
      share = width === undefined ? 1 : width / INK_WIDTH;
      view.el.setCssProps({ "--fn-share": String(share) });
    };
    const up = (event: PointerEvent): void => {
      if (event.pointerId !== down.pointerId) return;
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      view.el.removeClass("is-resizing");
      const width = imageWidthFor(share);
      const index = indexOfBlock(this.note, block.id);
      if (index < 0 || width === block.width) return;
      const { width: _old, ...rest } = block;
      this.apply(replaceBlock(this.note, index, width === undefined ? rest : { ...rest, width }));
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  }

  // -------------------------------------------------------------- moving a section

  private beginDrag(view: BlockView, event: PointerEvent): void {
    this.endDrag(false);
    const touch = event.pointerType === "touch";
    const drag: Drag = {
      id: view.block.id,
      pointer: event.pointerId,
      touch,
      startX: event.clientX,
      startY: event.clientY,
      startScroll: this.el.scrollTop,
      lastY: event.clientY,
      lifted: false,
      timer: 0,
      target: -1,
    };
    this.drag = drag;
    // A finger that rests on a section lifts it; one that moves at once is scrolling.
    if (touch) drag.timer = this.el.win.setTimeout(() => this.lift(), HOLD_MS);
    const doc = this.el.doc;
    doc.addEventListener("pointermove", this.onDragMove);
    doc.addEventListener("pointerup", this.onDragEnd);
    doc.addEventListener("pointercancel", this.onDragEnd);
  }

  private lift(): void {
    const drag = this.drag;
    const view = drag ? this.views.get(drag.id) : undefined;
    if (!drag || !view || drag.lifted) return;
    drag.lifted = true;
    view.el.addClass("is-lifted");
    this.el.addClass("is-moving");
    this.placeDrag();
    const tick = (): void => {
      if (!this.drag?.lifted) return;
      const rect = this.el.getBoundingClientRect();
      const y = this.drag.lastY;
      let speed = 0;
      if (y < rect.top + EDGE_SCROLL_PX) speed = -(rect.top + EDGE_SCROLL_PX - y) / 4;
      else if (y > rect.bottom - EDGE_SCROLL_PX) speed = (y - (rect.bottom - EDGE_SCROLL_PX)) / 4;
      if (speed !== 0) {
        this.el.scrollTop += Math.max(-18, Math.min(18, speed));
        this.placeDrag();
      }
      this.dragFrame = this.el.win.requestAnimationFrame(tick);
    };
    this.dragFrame = this.el.win.requestAnimationFrame(tick);
  }

  /** Move the lifted section with the pointer and show where it would land. */
  private placeDrag(): void {
    const drag = this.drag;
    const view = drag ? this.views.get(drag.id) : undefined;
    if (!drag || !view) return;
    const dy = drag.lastY - drag.startY + (this.el.scrollTop - drag.startScroll);
    view.el.setCssProps({ "--fn-lift": `${dy}px` });
    const children = Array.from(this.root.children) as HTMLElement[];
    const from = children.indexOf(view.el);
    let target = children.length;
    for (let i = 0; i < children.length; i++) {
      if (i === from) continue;
      const rect = children[i].getBoundingClientRect();
      if (drag.lastY < rect.top + rect.height / 2) {
        target = i;
        break;
      }
    }
    drag.target = target;
    const idle = target === from || target === from + 1;
    this.dropBar.toggleClass("is-shown", !idle);
    if (idle) return;
    const columnTop = this.column.getBoundingClientRect().top;
    const y =
      target < children.length
        ? children[target].getBoundingClientRect().top
        : children[children.length - 1].getBoundingClientRect().bottom;
    this.dropBar.setCssProps({ "--fn-drop": `${y - columnTop}px` });
  }

  private readonly onDragMove = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointer) return;
    drag.lastY = event.clientY;
    const moved = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (!drag.lifted) {
      if (drag.touch) {
        if (moved > HOLD_SLOP_PX) this.endDrag(false);
        return;
      }
      if (moved < DRAG_SLOP_PX) return;
      this.lift();
    }
    event.preventDefault();
    this.placeDrag();
  };

  private readonly onDragEnd = (event: PointerEvent): void => {
    if (!this.drag || event.pointerId !== this.drag.pointer) return;
    this.endDrag(event.type === "pointerup");
  };

  private endDrag(drop: boolean): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    this.el.win.clearTimeout(drag.timer);
    this.el.win.cancelAnimationFrame(this.dragFrame);
    const doc = this.el.doc;
    doc.removeEventListener("pointermove", this.onDragMove);
    doc.removeEventListener("pointerup", this.onDragEnd);
    doc.removeEventListener("pointercancel", this.onDragEnd);
    const view = this.views.get(drag.id);
    view?.el.removeClass("is-lifted");
    view?.el.setCssProps({ "--fn-lift": "0px" });
    this.el.removeClass("is-moving");
    this.dropBar.removeClass("is-shown");
    if (!drop || !drag.lifted || drag.target < 0) return;
    const from = indexOfBlock(this.note, drag.id);
    if (from >= 0) this.apply(moveBlock(this.note, from, drag.target));
  }

  /** A lifted section holds the page still under the finger that moves it. */
  private readonly onRootTouchMove = (event: TouchEvent): void => {
    if (this.drag?.lifted && event.cancelable) event.preventDefault();
  };

  /** While the pen writes, a hand resting on the glass does not scroll the note. */
  private readonly onPalm = (event: TouchEvent): void => {
    if (this.penIsDown && !touchIsStylus(event) && event.cancelable) event.preventDefault();
  };

  // -------------------------------------------------------------- drawing mode

  isDrawing(): boolean {
    return this.drawing;
  }

  /**
   * Turn drawing mode on or off. Turning it on by hand, with no handwriting
   * in sight, opens an empty section where the caret was; `byPen` (the pen
   * touched a section) never does. Turning it off tidies up: sections left
   * empty go, and those the pen grew are trimmed to what they hold.
   */
  setDrawing(on: boolean, byPen = false): void {
    if (on === this.drawing) return;
    const range = this.lastSelection;
    this.drawing = on;
    this.el.toggleClass("is-drawing", on);
    this.root.setAttribute("contenteditable", on ? "false" : "true");
    this.pending = null;
    if (on) {
      this.selectIsland(null);
      this.root.win.getSelection()?.removeAllRanges();
      this.root.blur();
      if (!byPen && !this.inkInSight()) this.openSection(range);
    } else {
      this.setActive(null);
      this.tidy();
    }
    this.grown.clear();
    this.queueState();
  }

  private inkInSight(): boolean {
    const pane = this.el.getBoundingClientRect();
    for (const view of this.views.values()) {
      if (!view.ink) continue;
      const rect = view.el.getBoundingClientRect();
      if (rect.bottom > pane.top + 24 && rect.top < pane.bottom - 24) return true;
    }
    return false;
  }

  /** The index a new section at the note's end goes to: before a last line left empty. */
  private endIndex(): number {
    const count = this.note.blocks.length;
    const last = this.note.blocks[count - 1];
    return count > 1 && last?.type === "text" && blockLength(last) === 0 ? count - 1 : count;
  }

  private openSection(range: NoteRange | null): void {
    const block: InkBlock = {
      type: "ink",
      id: this.newId(),
      height: INK_DEFAULT_HEIGHT,
      strokes: [],
    };
    const caretBlock = range ? this.note.blocks[range.end.block] : undefined;
    // Under the line the caret is on; an empty line gives its place to the section.
    let index = this.endIndex();
    if (range && caretBlock) {
      const empty = caretBlock.type === "text" && blockLength(caretBlock) === 0;
      index = empty && range.end.block > 0 ? range.end.block : range.end.block + 1;
    }
    this.apply(insertBlock(this.note, index, block), null, true);
    this.setActive(block.id);
    this.views.get(block.id)?.el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  private tidy(): void {
    let changed = false;
    const blocks: NoteBlock[] = [];
    for (const block of this.note.blocks) {
      if (block.type !== "ink") {
        blocks.push(block);
        continue;
      }
      if (block.strokes.length === 0) {
        changed = true;
        continue;
      }
      const height =
        this.grown.has(block.id) && !this.manual.has(block.id)
          ? trimmedHeight(block)
          : block.height;
      if (height !== block.height) changed = true;
      blocks.push(height === block.height ? block : { ...block, height });
    }
    if (changed) this.apply({ blocks }, null, true);
  }

  /** The section a pen landing under the note writes on: the last one grown to reach it, or a new one. */
  private sectionUnder(clientY: number): InkSection | null {
    const scale = (this.root.clientWidth || INK_WIDTH) / INK_WIDTH;
    const index = this.endIndex();
    const before = this.note.blocks[index - 1];
    if (before?.type === "ink") {
      const view = this.views.get(before.id);
      if (!view?.ink) return null;
      const top = view.el.getBoundingClientRect().top;
      const height = clampInkHeight((clientY - top) / scale + INK_GROW_ROOM);
      if (height > before.height) {
        this.grown.add(before.id);
        this.apply(replaceBlock(this.note, index - 1, { ...before, height }), null, true);
      }
      return this.views.get(before.id)?.ink ?? null;
    }
    const anchor = this.root.children[index] ?? null;
    const top = anchor
      ? anchor.getBoundingClientRect().top
      : this.root.getBoundingClientRect().bottom;
    const block: InkBlock = {
      type: "ink",
      id: this.newId(),
      height: clampInkHeight(Math.max(INK_DEFAULT_HEIGHT, (clientY - top) / scale + INK_GROW_ROOM)),
      strokes: [],
    };
    this.grown.add(block.id);
    this.apply(insertBlock(this.note, index, block), null, true);
    return this.views.get(block.id)?.ink ?? null;
  }

  private readonly onTailTouch = (event: TouchEvent): void => {
    if ((touchIsStylus(event) || this.lastDownType === "pen") && event.cancelable) {
      event.preventDefault();
    }
  };

  /** The pen landing in the empty space under the note starts writing there. */
  private readonly onTailDown = (event: PointerEvent): void => {
    this.lastDownType = event.pointerType;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const pen = event.pointerType === "pen";
    const draws = this.drawing ? event.pointerType !== "touch" || this.host.fingerDraws() : pen;
    if (!draws) return;
    event.preventDefault();
    if (!this.drawing) this.setDrawing(true, true);
    this.sectionUnder(event.clientY)?.beginStroke(event);
  };

  /** A tap under the note puts the caret on its last line. */
  private readonly onTailClick = (): void => {
    if (this.lastDownType === "pen") return;
    if (this.drawing) {
      if (this.lastDownType === "touch" && !this.host.fingerDraws()) this.setDrawing(false);
      else return;
    }
    this.focusEnd();
  };

  /** Put the caret at the end of the note's last line. */
  focusEnd(): void {
    const last = this.note.blocks.length - 1;
    if (last < 0) return;
    this.selectIsland(null);
    this.caretTo({ block: last, offset: blockLength(this.note.blocks[last]) });
  }

  /** Put the caret in the title (a new note opens ready to type). */
  focusStart(): void {
    if (this.note.blocks[0]?.type === "text") this.caretTo({ block: 0, offset: 0 });
  }

  // -------------------------------------------------------------- maths and graphs

  /**
   * A line that ends in "=" shows its answer after it (a mark drawn by CSS
   * from `data-answer`, so the page's text stays the note's): the
   * notebook's calculation notes, on typed text.
   */
  private markAnswers(): void {
    this.answers = noteAnswers(this.note.blocks);
    this.offers = noteGraphs(this.note.blocks, this.answers);
    for (const view of this.views.values()) {
      if (view.block.type !== "text") continue;
      // A function line shows a graph mark after it; a tap puts its graph in under it.
      const offers = this.offers.has(view.block.id);
      if (offers && view.el.dataset.graph === undefined) view.el.dataset.graph = "";
      else if (!offers && view.el.dataset.graph !== undefined) delete view.el.dataset.graph;
      const shown = this.answers.get(view.block.id)?.shown;
      if (shown === undefined) {
        if (view.el.dataset.answer !== undefined) delete view.el.dataset.answer;
      } else if (view.el.dataset.answer !== shown) {
        view.el.dataset.answer = shown;
      }
    }
  }

  /** A tap on a line's answer types it in after the "=": one undo step. */
  private takeAnswer(event: MouseEvent): boolean {
    const node = event.target as Node | null;
    const line = node?.instanceOf(Element) ? node.closest(".finenotes-note-line") : null;
    if (!line?.instanceOf(HTMLElement)) return false;
    if (line.dataset.answer === undefined && line.dataset.graph === undefined) return false;
    const index = indexOfBlock(this.note, line.dataset.fnId ?? "");
    const block = this.note.blocks[index];
    const answer = block ? this.answers.get(block.id) : undefined;
    const offer = block ? this.offers.get(block.id) : undefined;
    if (!block || block.type !== "text" || (!answer && !offer)) return false;
    // The answer is drawn after the line's last character: a tap past it.
    const range = this.root.doc.createRange();
    range.selectNodeContents(line);
    const rects = range.getClientRects();
    const last = rects[rects.length - 1];
    if (!last || event.clientY < last.top || event.clientY > last.bottom) return false;
    const rtl = this.root.win.getComputedStyle(line).direction === "rtl";
    if (rtl ? event.clientX >= last.left : event.clientX <= last.right) return false;
    event.preventDefault();
    if (!answer && offer) {
      const stored = storedSpec(offer);
      if (!stored) return false;
      const graph: GraphBlock = { type: "graph", id: this.newId(), spec: stored };
      this.apply(withBlockAfter(this.note, index, graph));
      this.selectIsland(graph.id);
      return true;
    }
    if (!answer) return false;
    const text = blockText(block);
    const edit = insertText(
      this.note,
      { block: index, offset: text.length },
      answerSuffix(text, answer),
      0,
    );
    this.apply(edit.note, edit.caret);
    return true;
  }

  private createGraphView(block: GraphBlock): BlockView {
    this.graphs.get(block.id)?.destroy();
    const graph = new NoteGraph(block, { dark: () => this.host.dark() });
    this.graphs.set(block.id, graph);
    this.addIslandBar(graph.el, block.id);
    const edit = this.host.editGraph;
    if (edit) {
      const bar = graph.el.querySelector(".finenotes-note-island-bar");
      const button = createEl("button", {
        cls: "clickable-icon finenotes-note-island-button is-edit",
        attr: { "aria-label": this.host.text("editGraph"), type: "button" },
      });
      setIcon(button, "pencil");
      bar?.prepend(button);
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      button.addEventListener("pointerup", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.editGraph(block.id);
      });
    }
    return { el: graph.el, block };
  }

  /** Graphs no longer in the note let go of their canvas and their size watch. */
  private sweepGraphs(): void {
    for (const [id, graph] of this.graphs) {
      if (this.views.get(id)?.el === graph.el) continue;
      graph.destroy();
      this.graphs.delete(id);
    }
  }

  /** Open graph `id` in the calculator; what comes back replaces it, one undo step. */
  editGraph(id: string): void {
    const block = this.note.blocks.find((b) => b.id === id);
    if (!block || block.type !== "graph" || !this.host.editGraph) return;
    this.host.editGraph(structuredClone(block.spec), (spec) => {
      const index = indexOfBlock(this.note, id);
      const now = this.note.blocks[index];
      const stored = storedSpec(spec);
      if (index < 0 || now?.type !== "graph" || !stored) return;
      this.apply(replaceBlock(this.note, index, { ...now, spec: stored }));
    });
  }

  /** Put a graph in at the caret (or at the end, with none), selected. */
  insertGraph(spec: GraphSpecData): boolean {
    const stored = storedSpec(spec);
    if (!stored) return false;
    if (this.drawing) this.setDrawing(false);
    const block: GraphBlock = { type: "graph", id: this.newId(), spec: stored };
    this.insertBlocks([block]);
    this.selectIsland(block.id);
    return true;
  }

  /** Put text in at the caret as if it were pasted: lines become paragraphs. */
  insertText(text: string): void {
    if (this.drawing) this.setDrawing(false);
    const clean = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
    if (clean) this.insertBlocks(decodeNote(clean, this.newId).blocks);
  }
  // -------------------------------------------------------------- recordings and moved files

  private drawAudioCard(el: HTMLElement, block: AudioBlock): void {
    const card = el.querySelector<HTMLElement>(".finenotes-note-audio-card");
    if (!card) return;
    card.empty();
    this.host.drawAudio?.(card, block);
  }

  /** Draw every recording's card again (a transcript arrived, a job's state changed). */
  refreshAudio(): void {
    for (const view of this.views.values()) {
      if (view.block.type === "audio") this.drawAudioCard(view.el, view.block);
    }
  }

  /** Put Markdown (an AI answer) in at the caret, read as the note reads its file; one undo step. */
  insertMarkdown(text: string): boolean {
    const blocks = decodeNote(text.trim(), this.newId).blocks;
    if (blocks.length === 0) return false;
    if (this.drawing) this.setDrawing(false);
    this.insertBlocks(blocks);
    return true;
  }

  /** Put a recording in at the caret (or at the end, with none); one undo step. */
  insertAudio(path: string, duration?: number): void {
    const block: AudioBlock = {
      type: "audio",
      id: this.newId(),
      path,
      ...(duration !== undefined && duration > 0 ? { duration } : {}),
    };
    if (this.drawing) this.setDrawing(false);
    this.insertBlocks([block]);
  }

  /**
   * Put `text` in as paragraphs right after the block `id` (a recording's
   * transcript under it); one undo step. False when there is no such block.
   */
  insertTextAfter(id: string, text: string): boolean {
    const index = indexOfBlock(this.note, id);
    if (index < 0) return false;
    const lines = text
      .split(/\n{2,}/)
      .map((line) => line.replace(/\s*\n\s*/g, " ").trim())
      .filter((line) => line !== "");
    if (lines.length === 0) return false;
    const added = lines.map((line) => textBlock(this.newId(), "body", [{ text: line, marks: 0 }]));
    const blocks = [
      ...this.note.blocks.slice(0, index + 1),
      ...added,
      ...this.note.blocks.slice(index + 1),
    ];
    const last = index + added.length;
    this.apply({ ...this.note, blocks }, { block: last, offset: blockLength(blocks[last]) });
    return true;
  }

  /**
   * Point pictures and recordings at where their files are now (`relink`
   * gives a new path, or `undefined` to keep one). Not an undo step: undo
   * must not point back at a file that moved, so the steps are relinked too.
   */
  relinkPaths(relink: (path: string) => string | undefined): boolean {
    const next = relinkNotePaths(this.note, relink);
    if (!next) return false;
    const follow = (snapshot: Snapshot): Snapshot => ({
      ...snapshot,
      note: relinkNotePaths(snapshot.note, relink) ?? snapshot.note,
    });
    this.undoStack = this.undoStack.map(follow);
    this.redoStack = this.redoStack.map(follow);
    this.note = next;
    this.render();
    this.host.changed();
    return true;
  }
}
