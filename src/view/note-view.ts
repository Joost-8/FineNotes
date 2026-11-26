/**
 * The text note view: a note you type into, as in Apple Notes, with
 * handwriting sections and pictures between the paragraphs.
 *
 * It is a file view over a Markdown file (`Title.note.md`,
 * `model/text-note-file.ts`), so Obsidian reads, saves, renames and syncs
 * it like any note. The page itself is `NoteEditor`; this file is what is
 * round it: the bar along the top (as Apple Notes lays it out: where you
 * are and undo on the left, what goes into the note in the middle, the pen
 * on the right), the Aa menu of text styles, the pen's palette, which docks
 * on any side of the note, and where pictures are kept.
 */

import {
  Notice,
  Scope,
  TextFileView,
  setIcon,
  type App,
  type Modifier,
  type TFile,
  type WorkspaceLeaf,
} from "obsidian";
import { nightColor } from "../canvas/night";
import { VIEW_TYPE_NOTE } from "../constants";
import { t, type TextKey } from "../i18n/translate";
import {
  TEXT_NOTE_FILE_SUFFIX,
  buildNoteFile,
  freeNoteName,
  hasDefaultName,
  parseNoteFile,
  stripTextNoteSuffix,
  titleFileName,
} from "../model/text-note-file";
import {
  ANY_HIGHLIGHT,
  BOLD,
  HIGHLIGHT,
  HIGHLIGHTS,
  ITALIC,
  STRIKE,
  UNDERLINE,
  emptyNote,
  noteTitle,
  type InkPaper,
  type Marks,
  type TextKind,
} from "../model/text-note";
import { pickImageFile, prepareImageBytes, saveImageAttachment } from "./image-import";
import { NoteEditor } from "./note-editor";
import { dragRange } from "./range-drag";
import { syncRangeFill } from "./range-fill";
import type { NotePen, NoteTool } from "./note-ink";
import type { TableLabel } from "./note-table-view";
import {
  defaultCalcPlace,
  parseCalculatorData,
  type CalculatorData,
} from "../model/calculator-store";
import type { GraphSpecData } from "../model/document";
import type { GraphSpec } from "../model/graph";
import { CalculatorPopover, type CalculatorHost } from "./calculator-popover";
import { DEVICE_READ_IDLE_MS, DEVICE_READ_NEXT_MS, DEVICE_READ_OPEN_MS } from "../constants";
import type { Stroke } from "../model/document";
import { inkReadingHash, nextSectionStep } from "../model/ink-reading";
import type { InkBlock } from "../model/text-note";
import type { ReadingGuard } from "../recognition/reading-guard";
import type { InkMathsHost } from "./note-ink-maths";
import { mergeNotes, OwnTexts } from "../model/note-merge";
import { type ReadLine, lineHits } from "../search/hit-strokes";
import { noteHits } from "../search/note-search";
import { NoteList } from "./note-list";
import { DialogKeyboard } from "./dialog-keyboard";
import { NoteExtras } from "./note-extras";
import { type NoteExportHost, shareMenu } from "./note-export";
import type GoodObsidianPlugin from "../main";

export const ICON_TEXT_NOTE = "notepad-text";

/** What the view needs from the plugin. */
export interface TextNoteHost {
  /** Pens thin and swell with pressure. */
  pressure(): boolean;
  highlighterAlpha(): number;
  /** Only a stylus writes: fingers never do. */
  onlyStylus(): boolean;
  /** Open Home, the notebook library. */
  openLibrary(): void;
  /** Make a new text note in `folder` (vault path, "" for the root) and open it. */
  newNote(folder: string): void;
  /** A tablet: notes and notebooks can hide Obsidian's tab bar and header. */
  fullScreenOffered(): boolean;
  fullScreen(): boolean;
  toggleFullScreen(): void;
  /** The calculator's switches and history, shared with the notebooks; absent: no calculator. */
  loadCalculator?: () => CalculatorData;
  saveCalculator?: (data: CalculatorData) => void;
  /** Reading handwriting on this device (Grape); absent, nothing is read. */
  reading?: NoteReadingHost;
  /** Handwritten sums worked out after their "=" (`note-ink-maths.ts`); absent, none are. */
  maths?: InkMathsHost;
  /** For recordings, their transcription and Ask AI (`note-extras.ts`); absent in the UI gallery. */
  plugin?: GoodObsidianPlugin;
}

/** What reading a note's handwriting on the device needs from the plugin. */
export interface NoteReadingHost {
  /** Reading handwriting on this device is on (the plugin's setting). */
  enabled(): boolean;
  /** The guard against a reading that takes the app down (`reading-guard.ts`). */
  guard: Pick<ReadingGuard, "paused" | "skipped" | "begin" | "end" | "fail">;
  /** Read strokes: the lines as text (`readingText`), and each line with its words' strokes. */
  read(strokes: readonly Stroke[]): Promise<{ text: string; lines: ReadLine[] }>;
}

/** The colours the palette offers, by tool; the first of each is the default. */
const PEN_COLORS = ["#1a1a1a", "#e03131", "#1971c2", "#2f9e44", "#f08c00", "#9c36b5"] as const;
const MARKER_COLORS = ["#ffd43b", "#8ce99a", "#ffa8a8", "#74c0fc", "#eebefa", "#ffc078"] as const;

/** Each tool's size range and default: pens and highlighters in section units, the eraser in CSS px. */
const SIZES: Readonly<Record<NoteTool, { min: number; max: number; step: number; base: number }>> =
  {
    pen: { min: 0.5, max: 14, step: 0.5, base: 3.5 },
    highlighter: { min: 6, max: 48, step: 1, base: 18 },
    eraser: { min: 4, max: 60, step: 1, base: 12 },
  };

interface ToolChoice {
  color: string;
  size: number;
}

/** Where the pen's palette rests. */
type Dock = "left" | "right" | "top" | "bottom";
const DOCKS: readonly Dock[] = ["left", "right", "top", "bottom"];

/** The pen in hand, kept for the session and across notes. */
interface PenChoices {
  tool: NoteTool;
  pen: ToolChoice;
  highlighter: ToolChoice;
  eraser: { size: number };
  dock: Dock;
}

const PEN_KEY = "finenotes-note-pen";
const TINT_KEY = "finenotes-note-tint";
/** Folded headings, by note path then heading text: a view state kept on this device. */
const FOLDS_KEY = "finenotes-note-folds";

function readFolds(raw: unknown): Record<string, string[]> {
  if (typeof raw !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, string[]> = {};
    for (const [path, titles] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(titles))
        out[path] = titles.filter((x): x is string => typeof x === "string");
    }
    return out;
  } catch {
    return {};
  }
}

const TINT_NAMES: Readonly<Record<string, TextKey>> = {
  yellow: "notebooks.note.tint.yellow",
  green: "notebooks.note.tint.green",
  pink: "notebooks.note.tint.pink",
  blue: "notebooks.note.tint.blue",
  purple: "notebooks.note.tint.purple",
};
/** Set once a stylus has written on this device: from then on fingers scroll and never write. */
const PEN_SEEN_KEY = "finenotes-note-pen-seen";

function clampSize(tool: NoteTool, value: unknown): number {
  const range = SIZES[tool];
  if (typeof value !== "number" || !Number.isFinite(value)) return range.base;
  return Math.max(range.min, Math.min(range.max, value));
}

export function readChoices(raw: unknown): PenChoices {
  const fallback: PenChoices = {
    tool: "pen",
    pen: { color: PEN_COLORS[0], size: SIZES.pen.base },
    highlighter: { color: MARKER_COLORS[0], size: SIZES.highlighter.base },
    eraser: { size: SIZES.eraser.base },
    dock: "left",
  };
  if (typeof raw !== "string") return fallback;
  try {
    const stored = JSON.parse(raw) as Partial<PenChoices> | null;
    const choice = (tool: "pen" | "highlighter", value: unknown, base: ToolChoice): ToolChoice => {
      const v = value as Partial<ToolChoice> | undefined;
      return {
        color:
          typeof v?.color === "string" && /^#[0-9a-f]{6}$/i.test(v.color) ? v.color : base.color,
        size: v?.size === undefined ? base.size : clampSize(tool, v.size),
      };
    };
    const eraser = stored?.eraser as { size?: unknown } | undefined;
    return {
      tool: stored?.tool === "highlighter" || stored?.tool === "eraser" ? stored.tool : "pen",
      pen: choice("pen", stored?.pen, fallback.pen),
      highlighter: choice("highlighter", stored?.highlighter, fallback.highlighter),
      eraser: {
        size: eraser?.size === undefined ? SIZES.eraser.base : clampSize("eraser", eraser.size),
      },
      dock: DOCKS.find((d) => d === stored?.dock) ?? "left",
    };
  } catch {
    return fallback;
  }
}

/** The text styles along the top of the Aa menu, as Apple Notes lists them. */
const KIND_ROWS: ReadonlyArray<[TextKind, TextKey]> = [
  ["title", "notebooks.note.title"],
  ["heading", "notebooks.note.heading"],
  ["subheading", "notebooks.note.subheading"],
  ["body", "notebooks.note.body"],
  ["mono", "notebooks.note.mono"],
];

const MARK_BUTTONS: ReadonlyArray<[Marks, string, TextKey]> = [
  [BOLD, "bold", "notebooks.note.bold"],
  [ITALIC, "italic", "notebooks.note.italic"],
  [UNDERLINE, "underline", "notebooks.note.underline"],
  [STRIKE, "strikethrough", "notebooks.note.strike"],
];

/** The lists in the Aa menu: an icon, or the marker itself where no icon says it. */
const LIST_BUTTONS: ReadonlyArray<[TextKind, string | null, string, TextKey]> = [
  ["dash", "list-minus", "", "notebooks.note.dashes"],
  ["bullet", "list", "", "notebooks.note.bullets"],
  ["number", "list-ordered", "", "notebooks.note.numbers"],
  ["upper", null, "A.", "notebooks.note.lettersUpper"],
  ["lower", null, "a.", "notebooks.note.lettersLower"],
];

/** Each tool's icon, in the palette and on the token it folds into while it is moved. */
const TOOL_ICONS: Readonly<Record<NoteTool, string>> = {
  pen: "pen-line",
  highlighter: "highlighter",
  eraser: "eraser",
};

const PAPER_NAMES: Readonly<Record<InkPaper, TextKey>> = {
  blank: "notebooks.note.paperBlank",
  lined: "notebooks.note.paperLined",
  squared: "notebooks.note.paperSquared",
  dotted: "notebooks.note.paperDotted",
};

const TABLE_LABELS: Readonly<Record<TableLabel, TextKey>> = {
  addRow: "notebooks.note.table.addRow",
  addColumn: "notebooks.note.table.addColumn",
  deleteRow: "notebooks.note.table.deleteRow",
  deleteColumn: "notebooks.note.table.deleteColumn",
  deleteTable: "notebooks.note.table.delete",
};

/** The side a palette dropped at `x, y` docks on: the nearest edge of the note. */
export function nearestDock(x: number, y: number, width: number, height: number): Dock {
  const distances: Array<[Dock, number]> = [
    ["left", x / Math.max(1, width)],
    ["right", (width - x) / Math.max(1, width)],
    ["top", y / Math.max(1, height)],
    ["bottom", (height - y) / Math.max(1, height)],
  ];
  distances.sort((a, b) => a[1] - b[1]);
  return distances[0][0];
}

/** How long typing must pause before a change made elsewhere is merged in, ms. */
const TYPING_PAUSE_MS = 2000;

export class TextNoteView extends TextFileView {
  /**
   * Obsidian 1.15 merges a file changed on disk into a plain-text view's
   * unsaved text by characters (diff-match-patch). That would cut through a
   * handwriting section's packed ink; the note merges by section itself
   * (`note-merge.ts`), as the notebook does.
   */
  isPlaintext = false;
  private editor: NoteEditor | null = null;
  private frontmatter = "";
  /**
   * The text on disk as this view last knew it (read or written): the base a
   * change made elsewhere is merged over.
   */
  private written: string | null = null;
  /** Texts this view wrote or read: one coming back from a sync is old news (`note-merge.ts`). */
  private readonly ownTexts = new OwnTexts();
  /** Which file `written` is of. */
  private loadedPath: string | null = null;
  /** Each read's ids differ from the last's, so a merge never holds two blocks with one id. */
  private loads = 0;
  /** A text that arrived while the pen was down: merged once it lifts. */
  private pendingDisk: string | null = null;
  private pendingTimer = 0;
  /** When the note was last edited here: a merge waits for typing to pause. */
  private lastEdit = 0;
  /** How rereads went, for the diagnostics: own, empty, merged, replaced. */
  readonly diskReloads = { own: 0, empty: 0, merged: 0, carried: 0, replaced: 0 };
  private choices: PenChoices;
  private bar: HTMLElement | null = null;
  private palette: HTMLElement | null = null;
  private styles: HTMLElement | null = null;
  private readonly buttons = new Map<string, HTMLElement>();
  private renameTimer = 0;
  /** The highlight colour last picked (the Aa menu's dot). */
  private tint: Marks;
  /** The calculator's window, while it is open over the note. */
  private calculator: CalculatorPopover | null = null;
  private readTimer = 0;
  private readBusy = false;
  /** Readings made in this session, by ink hash: undo brings ink back that was read already. */
  private readonly readings = new Map<string, string>();
  /** What a search opened the note to light, until the note is in. */
  private pendingSearch: string | null = null;
  private extras: NoteExtras | null = null;
  /** The list of notes beside the note, with its search (`note-list.ts`). */
  private list: NoteList | null = null;
  /** The bar's search field, and what keeps it working above the iPad keyboard. */
  private findField: HTMLInputElement | null = null;
  private findKeyboard: DialogKeyboard | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly host: TextNoteHost,
  ) {
    super(leaf);
    this.choices = readChoices(this.app.loadLocalStorage(PEN_KEY));
    const tint: unknown = this.app.loadLocalStorage(TINT_KEY);
    this.tint = HIGHLIGHTS.find((h) => h.name === tint)?.mark ?? HIGHLIGHT;
    // Obsidian takes Mod+B and Mod+I for its own editor before the page hears
    // them; a scope of the view's own gets them first while the note is active.
    this.scope = new Scope(this.app.scope);
    const mark = (modifiers: Modifier[], key: string, marks: Marks): void => {
      this.scope?.register(modifiers, key, () => {
        if (!this.editor || this.editor.isDrawing()) return true;
        // Typing a question in the Ask AI window, or a search in the bar: the keys are the field's.
        const active = this.contentEl.doc.activeElement;
        if (active?.closest(".goodobsidian-ask-window, .finenotes-note-find")) return true;
        this.editor.toggleMark(marks);
        return false;
      });
    };
    mark(["Mod"], "b", BOLD);
    mark(["Mod"], "i", ITALIC);
    mark(["Mod"], "u", UNDERLINE);
    mark(["Mod", "Shift"], "x", STRIKE);
    this.scope.register(["Mod", "Shift"], "h", () => {
      if (!this.editor || this.editor.isDrawing()) return true;
      this.editor.toggleMark(this.tint);
      return false;
    });
  }

  getViewType(): string {
    return VIEW_TYPE_NOTE;
  }

  override getIcon(): string {
    return ICON_TEXT_NOTE;
  }

  override getDisplayText(): string {
    return this.file ? stripTextNoteSuffix(this.file.name) : t("notebooks.note.untitled");
  }

  // -------------------------------------------------------------- the file

  getViewData(): string {
    const note = this.editor?.current() ?? emptyNote(() => "b0");
    this.written = buildNoteFile(this.frontmatter, note);
    this.ownTexts.note(this.written);
    return this.written;
  }

  setViewData(data: string, clear: boolean): void {
    const again = !clear && this.file !== null && this.file.path === this.loadedPath;
    if (again && data === this.written) return;
    if (again && this.reread(data)) return;
    const parsed = this.parse(data);
    this.frontmatter = parsed.frontmatter;
    this.written = data;
    this.loadedPath = this.file?.path ?? null;
    if (clear || !again) this.ownTexts.forget();
    this.ownTexts.note(data);
    const top = this.editor?.el.scrollTop ?? 0;
    this.editor?.load(parsed.note);
    this.restoreFolds();
    // Read again (changed elsewhere): stay where the reader was.
    if (again && this.editor) this.editor.el.scrollTop = top;
    this.extras?.relinkFromLog(parsed.note);
    this.showDate();
    if (clear) this.editor?.el.scrollTo({ top: 0 });
  }

  /** Fold the headings this note was left with folded. */
  private restoreFolds(): void {
    const folds = this.file
      ? readFolds(this.app.loadLocalStorage(FOLDS_KEY))[this.file.path]
      : null;
    if (folds?.length) this.editor?.foldTitles(folds);
  }

  /** The file read, with ids no earlier read of this view used. */
  private parse(data: string): ReturnType<typeof parseNoteFile> {
    const load = (++this.loads).toString(36);
    let sequence = 0;
    return parseNoteFile(data, () => `f${load}-${(++sequence).toString(36)}`);
  }

  /**
   * The same file read again because it changed on disk (a sync, another
   * app). True when it was handled here: an old text of this view's, an
   * empty file being written, or a merge with what this view has. False:
   * load it as it is (nothing here the file lacks).
   */
  private reread(data: string): boolean {
    const editor = this.editor;
    if (!editor) return false;
    // A text this view wrote or read: nothing new; an older one put back gets this view's again.
    if (this.ownTexts.has(data)) {
      this.diskReloads.own++;
      this.requestSave();
      return true;
    }
    // Emptied while something writes it whole (a copy, some syncs): the filled file follows.
    // Nothing is saved now, or this view would write over that copy.
    if (data.trim() === "") {
      this.diskReloads.empty++;
      return true;
    }
    // Not under the pen or mid-sentence: merged once it lifts, or typing pauses.
    if (editor.isPenDown() || Date.now() - this.lastEdit < TYPING_PAUSE_MS) {
      this.pendingDisk = data;
      this.contentEl.win.clearTimeout(this.pendingTimer);
      this.pendingTimer = this.contentEl.win.setTimeout(() => {
        const next = this.pendingDisk;
        this.pendingDisk = null;
        if (next !== null) this.setViewData(next, false);
      }, 300);
      return true;
    }
    const base = this.written;
    const mine = editor.current();
    const parsed = this.parse(data);
    const baseNote = base === null ? null : this.parse(base).note;
    const unsaved = base !== null && buildNoteFile(this.frontmatter, mine) !== base;
    if (!baseNote || !unsaved) {
      this.diskReloads.replaced++;
      return false;
    }
    const merged = mergeNotes(baseNote, mine, parsed.note);
    this.diskReloads.merged++;
    this.diskReloads.carried += merged.carried;
    this.frontmatter = parsed.frontmatter;
    this.written = data;
    this.ownTexts.note(data);
    const top = editor.el.scrollTop;
    editor.load(merged.note);
    this.restoreFolds();
    editor.el.scrollTop = top;
    this.extras?.relinkFromLog(merged.note);
    this.showDate();
    // The file gets what this view had too.
    this.requestSave();
    return true;
  }

  clear(): void {
    this.frontmatter = "";
    this.written = null;
    this.loadedPath = null;
    this.editor?.load(emptyNote(() => "b0"));
  }

  override async onLoadFile(file: TFile): Promise<void> {
    await super.onLoadFile(file);
    // A note with nothing in it yet opens ready to type its title.
    const note = this.editor?.current();
    if (note && noteTitle(note) === "" && note.blocks.length === 1) {
      this.contentEl.win.setTimeout(() => this.editor?.focusStart(), 60);
    }
    if (this.pendingSearch) this.contentEl.win.setTimeout(() => void this.showSearch(), 60);
    this.list?.refresh();
    this.scheduleReading(DEVICE_READ_OPEN_MS);
  }

  override async onUnloadFile(file: TFile): Promise<void> {
    this.contentEl.win.clearTimeout(this.renameTimer);
    this.contentEl.win.clearTimeout(this.readTimer);
    this.readTimer = 0;
    // A recording still running lands in this note before it goes.
    await this.extras?.finishForUnload();
    await super.onUnloadFile(file);
  }

  private showDate(): void {
    const time = this.file?.stat.mtime;
    if (!this.editor || !time) return;
    const text = new Intl.DateTimeFormat(undefined, {
      dateStyle: "long",
      timeStyle: "short",
    }).format(new Date(time));
    this.editor.setDate(text);
  }

  // -------------------------------------------------------------- building

  override async onOpen(): Promise<void> {
    const content = this.contentEl;
    content.empty();
    content.addClass("finenotes-note-view");
    this.bar = content.createDiv({ cls: "finenotes-note-bar" });
    this.extras = new NoteExtras({
      app: this.app,
      plugin: () => this.host.plugin ?? null,
      file: () => this.file,
      editor: () => this.editor,
      container: () => this.contentEl,
      recordingChanged: () => this.refresh(),
    });
    this.editor = new NoteEditor(content, {
      drawAudio: (card, block) => this.extras?.recordings.drawCard(card, block),
      pen: () => this.penInHand(),
      eraserSize: () => this.choices.eraser.size,
      paperName: (paper) => t(PAPER_NAMES[paper]),
      tableLabel: (key) => t(TABLE_LABELS[key]),
      linkNames: () => this.app.vault.getMarkdownFiles().map((file) => file.basename),
      openLink: (target) => void this.app.workspace.openLinkText(target, this.file?.path ?? ""),
      foldsChanged: (titles) => {
        const path = this.file?.path;
        if (!path) return;
        const all = readFolds(this.app.loadLocalStorage(FOLDS_KEY));
        if (titles.length > 0) all[path] = titles;
        else delete all[path];
        this.app.saveLocalStorage(FOLDS_KEY, JSON.stringify(all));
      },
      pressure: () => this.host.pressure(),
      highlighterAlpha: () => this.host.highlighterAlpha(),
      dark: () => this.isDark(),
      fingerDraws: () => this.fingerDraws(),
      imageUrl: (path) => this.imageUrl(path),
      saveImages: (files) => this.saveImages(files),
      changed: () => {
        this.lastEdit = Date.now();
        this.requestSave();
        this.queueRename();
        this.scheduleReading(DEVICE_READ_IDLE_MS);
      },
      turnIntoText: this.host.reading ? (block) => this.sectionText(block) : undefined,
      maths: this.host.maths,
      stateChanged: () => this.refresh(),
      ...(this.host.loadCalculator
        ? {
            editGraph: (spec: GraphSpecData, done: (spec: GraphSpecData) => void) =>
              this.editGraph(spec, done),
          }
        : {}),
      text: (key) =>
        t(
          key === "editGraph"
            ? "calculator.editGraph"
            : key === "title"
              ? "notebooks.note.titlePlaceholder"
              : key === "delete"
                ? "common.delete"
                : key === "missing"
                  ? "notebooks.note.missingPicture"
                  : key === "paper"
                    ? "notebooks.note.paper"
                    : key === "toText"
                      ? "notebooks.note.toText"
                      : "notebooks.note.unreadable",
        ),
    });
    this.list = new NoteList(content, {
      app: this.app,
      file: () => this.file,
      note: () => this.editor?.current() ?? null,
      // The bar's toggle hides while the list shows its own, as Apple Notes does.
      toggled: (open) => {
        content.toggleClass("has-note-list", open);
        this.buttons.get("list")?.toggleClass("is-hidden", open);
      },
      clearSearch: () => this.setFind(""),
    });
    this.buildBar(this.bar);
    this.buttons.get("list")?.toggleClass("is-hidden", this.list.isOpen);
    // The list follows notes made, gone or renamed.
    const relist = (): void => this.list?.refresh();
    this.registerEvent(this.app.vault.on("create", relist));
    this.registerEvent(this.app.vault.on("delete", relist));
    this.registerEvent(this.app.vault.on("rename", relist));
    this.palette = content.createDiv({ cls: "finenotes-note-palette" });
    // Obsidian's swipes (sidebars, the pull-down to the command palette) leave it alone.
    this.palette.dataset.ignoreSwipe = "true";
    this.buildPalette();
    this.refresh();

    // A stylus anywhere on the note is remembered: after it, fingers scroll.
    this.registerDomEvent(
      content,
      "pointerdown",
      (event) => {
        if (event.pointerType === "pen" && !this.app.loadLocalStorage(PEN_SEEN_KEY)) {
          this.app.saveLocalStorage(PEN_SEEN_KEY, "1");
        }
        const size = this.palette?.querySelector(".finenotes-note-palette-group.is-size.is-open");
        if (size && !size.contains(event.target as Node)) {
          size.removeClass("is-open");
          size.querySelector(".finenotes-note-size")?.removeClass("is-active");
        }
        if (this.styles && !this.styles.contains(event.target as Node)) {
          const anchor = this.buttons.get("styles");
          if (!anchor?.contains(event.target as Node)) this.closeStyles();
        }
      },
      { capture: true },
    );
    this.registerEvent(
      this.app.workspace.on("css-change", () => {
        this.editor?.refreshInk();
        this.buildPalette();
      }),
    );
    this.registerEvent(this.app.workspace.on("layout-change", () => this.refresh()));
    // The date strip follows the file: each save (after typing or drawing stops) moves it on.
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file === this.file) this.showDate();
      }),
    );
    const refreshImages = (): void => this.editor?.refreshImages();
    this.registerEvent(this.app.vault.on("create", refreshImages));
    this.registerEvent(this.app.vault.on("delete", refreshImages));
    this.registerEvent(this.app.vault.on("rename", refreshImages));
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        this.extras?.moved(file, oldPath);
        this.editor?.refreshAudio();
      }),
    );
    this.registerDomEvent(this.contentEl.doc, "visibilitychange", () => {
      if (this.contentEl.doc.visibilityState === "hidden") this.extras?.onHidden();
    });
  }

  override async onClose(): Promise<void> {
    this.contentEl.win.clearTimeout(this.renameTimer);
    this.calculator?.close();
    this.calculator = null;
    this.contentEl.win.clearTimeout(this.readTimer);
    this.extras?.destroy();
    this.extras = null;
    this.list?.destroy();
    this.list = null;
    this.findKeyboard?.end();
    this.findKeyboard = null;
    this.findField = null;
    this.editor?.destroy();
    this.editor = null;
    this.buttons.clear();
    this.contentEl.empty();
  }

  private isDark(): boolean {
    // The nearest theme class: Obsidian puts it on the body, a preview on its own frame.
    return this.contentEl.closest(".theme-dark, .theme-light")?.hasClass("theme-dark") ?? false;
  }

  private fingerDraws(): boolean {
    return !this.host.onlyStylus() && !this.app.loadLocalStorage(PEN_SEEN_KEY);
  }

  private penInHand(): NotePen {
    const { tool } = this.choices;
    if (tool === "eraser") return { tool, color: "", size: this.choices.eraser.size };
    const choice = tool === "highlighter" ? this.choices.highlighter : this.choices.pen;
    return { tool, color: choice.color, size: choice.size };
  }

  // -------------------------------------------------------------- the bar

  /** A bar button: an icon, named by its label; it never takes the caret out of the text. */
  private button(
    parent: HTMLElement,
    id: string,
    icon: string,
    label: TextKey,
    act: () => void,
    text?: string,
  ): HTMLElement {
    const name = t(label);
    const button = parent.createEl("button", {
      cls: "clickable-icon finenotes-note-button",
      attr: { "aria-label": name, type: "button" },
    });
    if (text) {
      button.addClass("is-text");
      button.setText(text);
    } else {
      setIcon(button, icon);
    }
    button.addEventListener("pointerdown", (event) => event.preventDefault());
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      act();
    });
    this.buttons.set(id, button);
    return button;
  }

  private pill(parent: HTMLElement): HTMLElement {
    return parent.createDiv({ cls: "finenotes-note-pill" });
  }

  private buildBar(bar: HTMLElement): void {
    const left = bar.createDiv({ cls: "finenotes-note-bar-group is-left" });
    const where = this.pill(left);
    // The note list, first in the bar as Apple Notes' sidebar button is.
    this.button(where, "list", "panel-left", "notebooks.noteList.toggle", () =>
      this.list?.setOpen(!this.list.isOpen),
    );
    if (this.host.fullScreenOffered()) {
      this.button(where, "full", "maximize-2", "toolbar.fullScreen", () => {
        this.host.toggleFullScreen();
        this.refresh();
      });
    }
    this.button(where, "home", "home", "notebooks.note.home", () => this.host.openLibrary());
    this.button(where, "new", "square-pen", "notebooks.note.new", () => {
      const parent = this.file?.parent;
      this.host.newNote(parent && !parent.isRoot() ? parent.path : "");
    });
    const history = this.pill(left);
    this.button(history, "undo", "undo-2", "common.undo", () => this.editor?.undo());
    this.button(history, "redo", "redo-2", "common.redo", () => this.editor?.redo());

    const middle = bar.createDiv({ cls: "finenotes-note-bar-group is-middle" });
    const insert = this.pill(middle);
    this.button(insert, "styles", "", "notebooks.note.styles", () => this.toggleStyles(), "Aa");
    this.button(insert, "kind:check", "list-checks", "notebooks.note.checklist", () =>
      this.editor?.setKind("check"),
    );
    this.button(insert, "table", "table", "notebooks.note.table.add", () => {
      this.closeStyles();
      this.editor?.insertTable();
    });
    // A picture or a recording, as Apple Notes' paperclip offers them.
    const attach = this.button(insert, "picture", "paperclip", "notebooks.note.attach", () => {
      this.closeStyles();
      this.extras?.attachMenu(attach, () => this.pickPicture());
    });
    if (this.host.loadCalculator) {
      this.button(insert, "calculator", "calculator", "calculator.calculator", () =>
        this.toggleCalculator(),
      );
    }

    const right = bar.createDiv({ cls: "finenotes-note-bar-group is-right" });
    const pen = this.pill(right);
    // Share, as Apple Notes puts it: its rarer choices (PDF, Markdown, text) in its menu.
    const share = this.button(pen, "share", "share", "notebooks.note.share", () => {
      this.closeStyles();
      shareMenu(share, this.exportHost());
    });
    this.button(pen, "ask", "sparkles", "notebooks.note.askAi", () => {
      this.closeStyles();
      this.extras?.openAsk();
    });
    this.button(pen, "draw", "pen-tool", "notebooks.note.draw", () => {
      this.closeStyles();
      this.editor?.setDrawing(!this.editor.isDrawing());
    });
    this.buildFind(right);
  }

  /**
   * Search, at the bar's far end as in Apple Notes: a field. Typing in it
   * shows what it found in the note list on the left; the ✕ (or Escape)
   * ends the search and gives the list its folder back.
   */
  private buildFind(parent: HTMLElement): void {
    const find = parent.createDiv({ cls: "finenotes-note-find" });
    setIcon(find.createSpan({ cls: "finenotes-note-find-icon" }), "search");
    const field = find.createEl("input", {
      attr: {
        type: "search",
        placeholder: t("notebooks.noteSearch.placeholder"),
        "aria-label": t("notebooks.note.search"),
        enterkeyhint: "search",
        autocomplete: "off",
        spellcheck: "false",
      },
    });
    const clear = find.createEl("button", {
      cls: "clickable-icon finenotes-note-find-clear is-hidden",
      attr: { type: "button", "aria-label": t("notebooks.noteSearch.clear") },
    });
    setIcon(clear, "x");
    clear.addEventListener("pointerdown", (event) => event.preventDefault());
    clear.addEventListener("click", () => this.setFind(""));
    field.addEventListener("input", () => {
      this.closeStyles();
      clear.toggleClass("is-hidden", field.value === "");
      this.list?.setQuery(field.value);
    });
    field.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      this.setFind("");
      field.blur();
    });
    this.findField = field;
    // The iPad keyboard: Obsidian's cap is lifted while typing, as in every field of ours.
    this.findKeyboard = new DialogKeyboard(find, { pad: true });
    this.findKeyboard.watch(field, find);
  }

  /** Set the bar's search field (empty ends the search). */
  private setFind(query: string): void {
    const field = this.findField;
    if (!field) return;
    field.value = query;
    field.parentElement
      ?.querySelector(".finenotes-note-find-clear")
      ?.toggleClass("is-hidden", query === "");
    this.list?.setQuery(query);
  }

  private exportHost(): NoteExportHost {
    return {
      app: this.app,
      file: () => this.file,
      note: () => this.editor?.current() ?? emptyNote(() => "b0"),
      exportsPath: () => {
        const own = this.extras?.folder("exports");
        if (own) return own;
        const parent = this.file?.parent;
        return parent && !parent.isRoot() ? parent.path : undefined;
      },
      exportsFolder: async () => {
        const own = await this.extras?.madeFolder("exports");
        if (own) return own;
        const parent = this.file?.parent;
        return parent && !parent.isRoot() ? parent.path : undefined;
      },
      pressure: () => this.host.pressure(),
      highlighterAlpha: () => this.host.highlighterAlpha(),
    };
  }

  private refresh(): void {
    const state = this.editor?.state();
    if (!state) return;
    const set = (id: string, on: boolean): void => {
      this.buttons.get(id)?.toggleClass("is-active", on);
    };
    const enable = (id: string, on: boolean): void => {
      const button = this.buttons.get(id);
      if (button?.instanceOf(HTMLButtonElement)) button.disabled = !on;
    };
    set("draw", state.drawing);
    set("styles", this.styles !== null);
    set("ask", this.extras?.askOpen === true);
    // Recording is a mark on the paperclip it was started from; the pill says the rest.
    this.buttons
      .get("picture")
      ?.toggleClass("is-recording", this.extras?.recordings.isRecording === true);
    enable("undo", state.canUndo);
    enable("redo", state.canRedo);
    enable("styles", !state.drawing);
    enable("kind:check", !state.drawing);
    enable("table", !state.drawing);
    set("calculator", this.calculator?.isOpen === true);
    const full = this.buttons.get("full");
    if (full) {
      const on = this.host.fullScreen();
      setIcon(full, on ? "minimize-2" : "maximize-2");
      full.setAttribute("aria-label", t(on ? "toolbar.leaveFullScreen" : "toolbar.fullScreen"));
    }
    this.contentEl.toggleClass("is-drawing", state.drawing);
    this.contentEl.toggleClass("is-finger-draw", this.fingerDraws());
    this.contentEl.dataset.dock = this.choices.dock;
    if (state.drawing) this.closeStyles();
    const kinds: TextKind[] = [...KIND_ROWS.map(([k]) => k), ...LIST_BUTTONS.map(([k]) => k)];
    for (const kind of [...kinds, "check" as const, "quote" as const]) {
      set(`kind:${kind}`, state.kind === kind);
    }
    for (const [mark] of MARK_BUTTONS) set(`mark:${mark}`, (state.marks & mark) !== 0);
    set("highlight", (state.marks & ANY_HIGHLIGHT) !== 0);
    enable("indent", state.inList);
    enable("outdent", state.inList);
  }

  // -------------------------------------------------------------- the Aa menu

  private toggleStyles(): void {
    if (this.styles) this.closeStyles();
    else this.openStyles();
    this.refresh();
  }

  private closeStyles(): void {
    if (!this.styles) return;
    const panel = this.styles;
    this.styles = null;
    for (const id of Array.from(this.buttons.keys())) {
      if (id === "kind:check") continue;
      if (
        id.startsWith("kind:") ||
        id.startsWith("mark:") ||
        id.endsWith("dent") ||
        id === "highlight" ||
        id === "tint"
      ) {
        this.buttons.delete(id);
      }
    }
    panel.remove();
    this.buttons.get("styles")?.removeClass("is-active");
  }

  private openStyles(): void {
    const anchor = this.buttons.get("styles");
    if (!anchor || !this.bar) return;
    const panel = this.contentEl.createDiv({ cls: "finenotes-note-styles" });
    this.styles = panel;
    const view = this.contentEl.getBoundingClientRect();
    const at = anchor.getBoundingClientRect();
    panel.setCssProps({
      "--fn-styles-x": `${at.left + at.width / 2 - view.left}px`,
      "--fn-styles-y": `${at.bottom - view.top + 8}px`,
    });

    // Title, Heading, Subheading, Body, Monostyled: words, as Apple Notes shows them.
    const kinds = panel.createDiv({ cls: "finenotes-note-styles-kinds" });
    for (const [kind, label] of KIND_ROWS) {
      const row = kinds.createEl("button", {
        cls: "clickable-icon finenotes-note-style",
        text: t(label),
        attr: { type: "button", "data-kind": kind },
      });
      row.addEventListener("pointerdown", (event) => event.preventDefault());
      row.addEventListener("mousedown", (event) => event.preventDefault());
      row.addEventListener("click", () => this.editor?.setKind(kind));
      this.buttons.set(`kind:${kind}`, row);
    }

    const first = panel.createDiv({ cls: "finenotes-note-styles-row" });
    const marks = first.createDiv({ cls: "finenotes-note-styles-group" });
    for (const [mark, icon, label] of MARK_BUTTONS) {
      this.button(marks, `mark:${mark}`, icon, label, () => this.editor?.toggleMark(mark));
    }
    // The highlight, in the colour last picked; the dot beside it picks another (as Apple Notes).
    const tint = first.createDiv({ cls: "finenotes-note-styles-group" });
    this.button(tint, "highlight", "highlighter", "notebooks.note.highlight", () =>
      this.editor?.toggleMark(this.tint),
    );
    const dot = this.button(tint, "tint", "", "notebooks.note.highlightColor", () => {
      tints.toggleClass("is-hidden", !tints.hasClass("is-hidden"));
    });
    dot.addClass("finenotes-note-tint-dot");
    const color = (): string => HIGHLIGHTS.find((h) => h.mark === this.tint)?.color ?? "#ffd43b";
    dot.setCssProps({ "--fn-swatch": color() });
    const tints = first.createDiv({ cls: "finenotes-note-tints is-hidden" });
    for (const h of HIGHLIGHTS) {
      const swatch = tints.createEl("button", {
        cls: "clickable-icon finenotes-note-swatch",
        attr: { type: "button", "aria-label": t(TINT_NAMES[h.name] ?? "notebooks.note.highlight") },
      });
      swatch.setCssProps({ "--fn-swatch": h.color });
      swatch.toggleClass("is-active", h.mark === this.tint);
      swatch.addEventListener("pointerdown", (event) => event.preventDefault());
      swatch.addEventListener("mousedown", (event) => event.preventDefault());
      swatch.addEventListener("click", () => {
        this.tint = h.mark;
        this.app.saveLocalStorage(TINT_KEY, h.name);
        dot.setCssProps({ "--fn-swatch": h.color });
        tints.querySelectorAll(".finenotes-note-swatch").forEach((el, i) => {
          el.toggleClass("is-active", HIGHLIGHTS[i].mark === h.mark);
        });
        tints.addClass("is-hidden");
        this.editor?.toggleMark(h.mark);
      });
    }

    const second = panel.createDiv({ cls: "finenotes-note-styles-row" });
    const lists = second.createDiv({ cls: "finenotes-note-styles-group" });
    for (const [kind, icon, text, label] of LIST_BUTTONS) {
      this.button(
        lists,
        `kind:${kind}`,
        icon ?? "",
        label,
        () => this.editor?.setKind(kind),
        icon ? undefined : text,
      );
    }
    const depth = second.createDiv({ cls: "finenotes-note-styles-group" });
    this.button(depth, "outdent", "indent-decrease", "notebooks.note.outdent", () =>
      this.editor?.indent(-1),
    );
    this.button(depth, "indent", "indent-increase", "notebooks.note.indent", () =>
      this.editor?.indent(1),
    );
    const quote = second.createDiv({ cls: "finenotes-note-styles-group" });
    this.button(quote, "kind:quote", "text-quote", "notebooks.note.quote", () =>
      this.editor?.setKind("quote"),
    );
  }

  // -------------------------------------------------------------- the pen's palette

  private buildPalette(): void {
    const palette = this.palette;
    if (!palette) return;
    palette.empty();
    palette.dataset.dock = this.choices.dock;
    this.contentEl.dataset.dock = this.choices.dock;
    const { tool } = this.choices;

    const grip = palette.createDiv({
      cls: "finenotes-note-palette-grip",
      attr: { "aria-label": t("notebooks.note.moveTools"), role: "button" },
    });
    grip.addEventListener("pointerdown", (event) => this.dragPalette(event));
    // A drag of the grip is the palette's own: no touch of it reaches Obsidian's
    // swipe recogniser, and WebKit does not scroll or long-press it.
    const holdTouch = (event: TouchEvent): void => {
      event.stopPropagation();
      if (event.cancelable) event.preventDefault();
    };
    grip.addEventListener("touchstart", holdTouch, { passive: false });
    grip.addEventListener("touchmove", holdTouch, { passive: false });

    const history = palette.createDiv({ cls: "finenotes-note-palette-group is-history" });
    this.button(history, "p-undo", "undo-2", "common.undo", () => this.editor?.undo());
    this.button(history, "p-redo", "redo-2", "common.redo", () => this.editor?.redo());

    const tools: ReadonlyArray<[NoteTool, string, TextKey]> = [
      ["pen", "pen-line", "notebooks.note.pen"],
      ["highlighter", "highlighter", "notebooks.note.highlighter"],
      ["eraser", "eraser", "notebooks.note.eraser"],
    ];
    const toolGroup = palette.createDiv({ cls: "finenotes-note-palette-group is-tools" });
    for (const [id, icon, label] of tools) {
      const button = this.button(toolGroup, `tool:${id}`, icon, label, () => {
        this.choices.tool = id;
        this.choicesChanged();
      });
      button.toggleClass("is-active", tool === id);
    }

    if (tool !== "eraser") {
      const choice = tool === "highlighter" ? this.choices.highlighter : this.choices.pen;
      const dark = this.isDark();
      const colors = palette.createDiv({ cls: "finenotes-note-palette-group is-colors" });
      for (const color of tool === "highlighter" ? MARKER_COLORS : PEN_COLORS) {
        const swatch = colors.createEl("button", {
          cls: "clickable-icon finenotes-note-swatch",
          attr: { type: "button", "aria-label": color },
        });
        // The swatch shows the ink as the page will: black ink is light on a dark note.
        const shown = dark && tool === "pen" ? nightColor(color) : color;
        swatch.setCssProps({ "--fn-swatch": shown });
        swatch.toggleClass("is-active", choice.color === color);
        swatch.addEventListener("click", () => {
          choice.color = color;
          this.choicesChanged();
        });
      }
    }
    this.buildSize(palette, tool);

    const done = palette.createEl("button", {
      cls: "clickable-icon finenotes-note-done",
      attr: { type: "button", "aria-label": t("common.done") },
    });
    setIcon(done, "check");
    done.addEventListener("click", () => this.editor?.setDrawing(false));
  }

  /** The size of the tool in hand: any size in its range, shown as the mark it makes. */
  private buildSize(palette: HTMLElement, tool: NoteTool): void {
    const range = SIZES[tool];
    const choice =
      tool === "eraser"
        ? this.choices.eraser
        : tool === "highlighter"
          ? this.choices.highlighter
          : this.choices.pen;
    const group = palette.createDiv({ cls: "finenotes-note-palette-group is-size" });
    // The size is a mark of the line it draws; tapping it shows the slider beside the palette.
    const toggle = group.createEl("button", {
      cls: "clickable-icon finenotes-note-size",
      attr: { type: "button", "aria-label": t("notebooks.note.size") },
    });
    const mark = toggle.createDiv({ cls: "finenotes-note-size-mark" });
    const pop = group.createDiv({ cls: "finenotes-note-size-pop" });
    toggle.addEventListener("pointerdown", (event) => event.preventDefault());
    toggle.addEventListener("click", () => {
      const open = !group.hasClass("is-open");
      group.toggleClass("is-open", open);
      toggle.toggleClass("is-active", open);
    });
    // The tool bar's own slider, so a size is set the same way everywhere.
    const track = pop.createDiv({ cls: "goodobsidian-width-slider finenotes-note-size-track" });
    const slider = track.createEl("input", {
      cls: "goodobsidian-width-range",
      type: "range",
      attr: {
        min: String(range.min),
        max: String(range.max),
        step: String(range.step),
        "aria-label": t("notebooks.note.size"),
      },
    });
    slider.value = String(choice.size);
    dragRange(slider);
    syncRangeFill(slider);
    const show = (size: number): void => {
      // A mark as big as the line it draws (capped to the palette), the eraser as a ring.
      const px = Math.max(3, Math.min(30, tool === "eraser" ? size : size * 1.3));
      mark.setCssProps({
        "--fn-mark": `${px}px`,
        "--fn-mark-color":
          tool === "eraser"
            ? "transparent"
            : this.isDark() && tool === "pen"
              ? nightColor(this.choices.pen.color)
              : (choice as ToolChoice).color,
      });
      mark.toggleClass("is-ring", tool === "eraser");
    };
    show(choice.size);
    slider.addEventListener("input", () => {
      choice.size = clampSize(tool, Number(slider.value));
      syncRangeFill(slider);
      show(choice.size);
    });
    slider.addEventListener("change", () => {
      choice.size = clampSize(tool, Number(slider.value));
      this.app.saveLocalStorage(PEN_KEY, JSON.stringify(this.choices));
    });
  }

  /** Drag the palette by its grip; it docks on the side of the note nearest where it is let go. */
  private dragPalette(down: PointerEvent): void {
    const palette = this.palette;
    if (!palette) return;
    down.preventDefault();
    down.stopPropagation();
    const grip = down.currentTarget as HTMLElement;
    try {
      grip.setPointerCapture(down.pointerId);
    } catch {
      // A synthetic pointer cannot be captured.
    }
    const content = this.contentEl;
    const still = content.win.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const view = (): DOMRect => content.getBoundingClientRect();
    // The palette folds into one round token with the tool in hand, which follows the finger.
    const token = content.createDiv({
      cls: "finenotes-note-palette-token",
      attr: { "data-ignore-swipe": "true" },
    });
    setIcon(token, TOOL_ICONS[this.choices.tool]);
    const hint = content.createDiv({ cls: "finenotes-note-dock-hint" });
    const place = (x: number, y: number): void => {
      const rect = view();
      token.setCssProps({
        "--fn-token-x": `${x - rect.left}px`,
        "--fn-token-y": `${y - rect.top}px`,
      });
      hint.dataset.dock = nearestDock(x - rect.left, y - rect.top, rect.width, rect.height);
    };
    place(down.clientX, down.clientY);
    const from = palette.getBoundingClientRect();
    if (!still && typeof palette.animate === "function") {
      const ox = down.clientX - from.left;
      const oy = down.clientY - from.top;
      palette.animate(
        [
          { opacity: 1, scale: "1", transformOrigin: `${ox}px ${oy}px` },
          { opacity: 0, scale: "0.25", transformOrigin: `${ox}px ${oy}px` },
        ],
        { duration: 200, easing: "cubic-bezier(0.4, 0, 0.6, 1)" },
      );
    }
    palette.addClass("is-folded");
    palette.addClass("is-settling");
    const move = (event: PointerEvent): void => {
      if (event.pointerId !== down.pointerId) return;
      place(event.clientX, event.clientY);
    };
    const up = (event: PointerEvent): void => {
      if (event.pointerId !== down.pointerId) return;
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      grip.removeEventListener("pointercancel", up);
      const rect = view();
      const dock = nearestDock(
        event.clientX - rect.left,
        event.clientY - rect.top,
        rect.width,
        rect.height,
      );
      hint.remove();
      if (dock !== this.choices.dock) {
        this.choices.dock = dock;
        this.choicesChanged();
      }
      this.unfoldPalette(token, event.clientX, event.clientY, still);
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", up);
  }

  /**
   * Let go: the token flies into the palette's place on its side and the
   * palette grows back out of it, with a little overshoot.
   */
  private unfoldPalette(token: HTMLElement, x: number, y: number, still: boolean): void {
    const palette = this.palette;
    const win = this.contentEl.win;
    if (!palette) {
      token.remove();
      return;
    }
    palette.removeClass("is-folded");
    win.setTimeout(() => palette.removeClass("is-settling"), 420);
    const to = palette.getBoundingClientRect();
    const view = this.contentEl.getBoundingClientRect();
    if (still || typeof palette.animate !== "function") {
      token.remove();
      return;
    }
    // Grow from the edge of the palette nearest where the token was let go.
    const ox = Math.max(0, Math.min(to.width, x - to.left));
    const oy = Math.max(0, Math.min(to.height, y - to.top));
    palette.animate(
      [
        { opacity: 0, scale: "0.25", transformOrigin: `${ox}px ${oy}px` },
        { opacity: 1, scale: "1", transformOrigin: `${ox}px ${oy}px` },
      ],
      { duration: 380, easing: "cubic-bezier(0.2, 1.2, 0.32, 1)" },
    );
    token.setCssProps({
      "--fn-token-x": `${to.left + ox - view.left}px`,
      "--fn-token-y": `${to.top + oy - view.top}px`,
    });
    token.addClass("is-landing");
    // A timer, not `finish`: the browser pane's animation clock can stall (ledger).
    win.setTimeout(() => token.remove(), 260);
  }

  private choicesChanged(): void {
    this.app.saveLocalStorage(PEN_KEY, JSON.stringify(this.choices));
    this.buildPalette();
    this.refresh();
  }

  // -------------------------------------------------------------- the calculator

  /**
   * The notebooks' calculator, over the note: its Insert types the answer
   * (or the steps) in at the caret, its Insert graph puts the graph in as a
   * section. The bar's calculator button opens and closes it.
   */
  private toggleCalculator(): void {
    this.closeStyles();
    const open = this.calculator;
    this.calculator = null;
    if (open?.isOpen) open.close();
    else this.calculator = new CalculatorPopover(this.contentEl, this.calculatorHost());
    this.refresh();
  }

  private calculatorHost(graphs = true): CalculatorHost {
    const host = this.host;
    // Until it is moved, the window opens on the right, off the text it serves;
    // that first place is the note's own and is not saved as the window's place.
    const bounds = { w: this.contentEl.clientWidth, h: this.contentEl.clientHeight };
    const left = defaultCalcPlace(bounds);
    const first = { ...left, x: Math.max(16, bounds.w - left.w - 16) };
    return {
      path: this.file?.path ?? "",
      load: () => {
        const data = host.loadCalculator?.() ?? parseCalculatorData(null);
        return data.calcWindow ? data : { ...data, calcWindow: first };
      },
      save: (data) => {
        const place = data.calcWindow;
        const moved = place && !(place.x === first.x && place.y === first.y);
        host.saveCalculator?.(moved ? data : { ...data, calcWindow: undefined });
      },
      insert: (text) => {
        if (!this.editor) return false;
        this.editor.insertText(text);
        return true;
      },
      ...(graphs
        ? { insertGraph: (spec: GraphSpec) => this.editor?.insertGraph(spec) ?? false }
        : {}),
    };
  }

  /** A graph's pencil: the calculator on its graph pane, and Update graph puts it back. */
  private editGraph(spec: GraphSpecData, done: (spec: GraphSpecData) => void): void {
    this.calculator?.close();
    const host = this.calculatorHost(false);
    this.calculator = new CalculatorPopover(this.contentEl, host, {
      editGraph: { spec: spec, done },
    });
  }

  // -------------------------------------------------------------- pictures

  private imageUrl(path: string): string | null {
    const file = this.app.metadataCache.getFirstLinkpathDest(path, this.file?.path ?? "");
    return file ? this.app.vault.getResourcePath(file) : null;
  }

  private pickPicture(): void {
    this.closeStyles();
    // Inside the tap: iPadOS opens a picker only then.
    void pickImageFile(this.contentEl, false).then((file) => {
      if (file) void this.editor?.insertImages([file]);
    });
  }

  private async saveImages(files: File[]): Promise<Array<{ path: string; width: number }>> {
    const note = this.file;
    if (!note) return [];
    const saved: Array<{ path: string; width: number }> = [];
    for (const file of files) {
      try {
        const prepared = await prepareImageBytes(await file.arrayBuffer(), file.type);
        const name = file.name.replace(/\.[^.]+$/, "") || t("notebooks.note.picture");
        const folder = await this.extras?.madeFolder("images");
        const kept = await saveImageAttachment(this.app, prepared, name, note.path, folder);
        saved.push({ path: kept.path, width: prepared.width });
      } catch (error) {
        console.error("FineNotes: could not add the picture", error);
      }
    }
    return saved;
  }

  // -------------------------------------------------------------- reading the handwriting

  /**
   * Read the note's handwriting on this device, for search, a moment after
   * writing stops (`ink-reading.ts` picks the section): one section at a
   * time, the one written in last first, never while the pen is down, each
   * marked with the reading guard so one that takes the app down is not
   * read again at the next start. The setting turns it off.
   */
  private scheduleReading(delay: number): void {
    const win = this.contentEl.win;
    win.clearTimeout(this.readTimer);
    this.readTimer = 0;
    const host = this.host.reading;
    if (!host?.enabled() || !this.file) return;
    this.readTimer = win.setTimeout(() => void this.readNextSection(), delay);
  }

  private async readNextSection(): Promise<void> {
    this.readTimer = 0;
    const host = this.host.reading;
    const editor = this.editor;
    const path = this.file?.path;
    if (!host || !editor || !path || this.readBusy || host.guard.paused) return;
    if (editor.isPenDown()) {
      this.scheduleReading(DEVICE_READ_IDLE_MS);
      return;
    }
    const step = nextSectionStep({
      note: editor.current(),
      known: this.readings,
      skip: new Set(host.guard.skipped(path).keys()),
      first: editor.lastInk(),
    });
    if (!step) return;
    if (step.kind !== "read") {
      editor.setReading(
        step.block.id,
        step.kind === "keep" ? { text: step.text, of: step.hash } : null,
      );
      this.scheduleReading(DEVICE_READ_NEXT_MS);
      return;
    }
    // Marked until the reading is over: a mark left at the next start means it took the app down.
    const mark = { path, key: step.hash, hash: step.hash, page: step.index + 1 };
    this.readBusy = true;
    host.guard.begin(mark);
    try {
      const { text } = await host.read(step.block.strokes);
      this.readings.set(step.hash, text);
      if (this.editor === editor) editor.setReading(step.block.id, { text, of: step.hash });
      this.scheduleReading(DEVICE_READ_NEXT_MS);
    } catch {
      // No model, or this ink could not be read: leave it until it changes.
      host.guard.fail(mark);
    } finally {
      host.guard.end();
      this.readBusy = false;
    }
  }

  /** What a section says, for "Turn into text": its kept reading, or read now. */
  private async sectionText(block: InkBlock): Promise<string | null> {
    const hash = inkReadingHash(block.strokes);
    if (block.reading?.of === hash && block.reading.text) return block.reading.text;
    const host = this.host.reading;
    if (!host) return null;
    try {
      const { text } = await host.read(block.strokes);
      this.readings.set(hash, text);
      if (text.trim()) return text;
      new Notice(t("notebooks.note.nothingRead"));
    } catch {
      new Notice(t("notebooks.note.readFailed"));
    }
    return null;
  }

  // -------------------------------------------------------------- search

  /**
   * `{ noteBlock }`: Home opened the note at a page of its preview, which
   * starts at that block. `{ search }`: a search opened it at what it found
   * (`openSearchHit`): light it once the note is in.
   */
  override setEphemeralState(state: unknown): void {
    super.setEphemeralState(state);
    const block = (state as { noteBlock?: unknown } | null)?.noteBlock;
    if (typeof block === "number" && Number.isInteger(block)) this.editor?.revealBlock(block);
    const search = (state as { search?: unknown } | null)?.search;
    if (typeof search !== "string" || search.trim() === "") return;
    this.pendingSearch = search;
    this.contentEl.win.setTimeout(() => void this.showSearch(), 60);
  }

  /**
   * Light every place the note holds the query: typed words at once; in
   * handwriting, each section that holds it at once, then its words, from
   * the device's reading of the section's strokes lined up with the kept
   * reading (`lineHits`, as a notebook lights its pages).
   */
  private async showSearch(): Promise<void> {
    const query = this.pendingSearch;
    const editor = this.editor;
    if (!query || !editor || !this.file) return;
    this.pendingSearch = null;
    const note = editor.current();
    const hits = noteHits(note, query);
    editor.showHits(hits);
    const host = this.host.reading;
    if (!host) return;
    for (const index of hits.ink) {
      const block = note.blocks[index];
      if (block?.type !== "ink") continue;
      try {
        const { lines } = await host.read(block.strokes);
        if (this.editor !== editor || editor.current().blocks[index] !== block) return;
        const words = lineHits(query, lines, block.reading?.text ?? "");
        editor.markInk(block.id, words);
      } catch {
        // No model: the section's outline is the mark.
      }
    }
  }

  // -------------------------------------------------------------- the file's name

  /**
   * The file, and with it the tab, is named after the note's title: a
   * moment after the title was last typed in, whatever it was called before.
   */
  private queueRename(): void {
    const win = this.contentEl.win;
    win.clearTimeout(this.renameTimer);
    this.renameTimer = win.setTimeout(() => void this.renameFromTitle(), 1200);
  }

  private async renameFromTitle(): Promise<void> {
    const file = this.file;
    const note = this.editor?.current();
    if (!file || !note) return;
    // The name always follows the title (an empty title leaves it alone).
    const base = titleFileName(noteTitle(note));
    if (!base || hasDefaultName(file.name, base)) return;
    await renameNote(this.app, file, base);
  }
}

/** Rename a text note to `base` (or `base 2`, … when that is taken), in its own folder. */
async function renameNote(app: App, file: TFile, base: string): Promise<void> {
  const folder = file.parent && !file.parent.isRoot() ? `${file.parent.path}/` : "";
  const name = freeNoteName(base, (candidate) => {
    const taken = app.vault.getAbstractFileByPath(`${folder}${candidate}`);
    return taken !== null && taken !== file;
  });
  if (name === file.name || !name.endsWith(TEXT_NOTE_FILE_SUFFIX)) return;
  try {
    await app.fileManager.renameFile(file, `${folder}${name}`);
  } catch (error) {
    console.error("FineNotes: could not name the note after its title", error);
  }
}
