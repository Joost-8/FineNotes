/**
 * The text note view: a note you type into, as in Apple Notes, with
 * handwriting sections and pictures between the paragraphs.
 *
 * It is a file view over a Markdown file (`Title.note.md`,
 * `model/text-note-file.ts`), so Obsidian reads, saves, renames and syncs
 * it like any note. The page itself is `NoteEditor`; this file is what is
 * round it: the bar (styles, a picture, the pen, undo), the pen's palette
 * in drawing mode, and where pictures are kept.
 */

import {
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
  BOLD,
  ITALIC,
  STRIKE,
  UNDERLINE,
  emptyNote,
  noteTitle,
  type Marks,
  type TextKind,
} from "../model/text-note";
import { pickImageFile, prepareImageBytes, saveImageAttachment } from "./image-import";
import { NoteEditor } from "./note-editor";
import type { NotePen, NoteTool } from "./note-ink";

export const ICON_TEXT_NOTE = "notepad-text";

/** What the view needs from the plugin. */
export interface TextNoteHost {
  /** Pens thin and swell with pressure. */
  pressure(): boolean;
  highlighterAlpha(): number;
  /** Only a stylus writes: fingers never do. */
  onlyStylus(): boolean;
}

/** The colours and widths the palette offers, by tool; the first of each is the default. */
const PEN_COLORS = ["#1a1a1a", "#e03131", "#1971c2", "#2f9e44", "#f08c00", "#9c36b5"] as const;
const MARKER_COLORS = ["#ffd43b", "#8ce99a", "#ffa8a8", "#74c0fc", "#eebefa", "#ffc078"] as const;
const PEN_SIZES = [2, 3.5, 6] as const;
const MARKER_SIZES = [12, 18, 26] as const;

interface ToolChoice {
  color: string;
  size: number;
}

/** The pen in hand, kept for the session and across notes. */
interface PenChoices {
  tool: NoteTool;
  pen: ToolChoice;
  highlighter: ToolChoice;
}

const PEN_KEY = "finenotes-note-pen";
/** Set once a stylus has written on this device: from then on fingers scroll and never write. */
const PEN_SEEN_KEY = "finenotes-note-pen-seen";

function readChoices(raw: unknown): PenChoices {
  const fallback: PenChoices = {
    tool: "pen",
    pen: { color: PEN_COLORS[0], size: PEN_SIZES[1] },
    highlighter: { color: MARKER_COLORS[0], size: MARKER_SIZES[1] },
  };
  if (typeof raw !== "string") return fallback;
  try {
    const stored = JSON.parse(raw) as Partial<PenChoices> | null;
    const choice = (value: unknown, base: ToolChoice): ToolChoice => {
      const v = value as Partial<ToolChoice> | undefined;
      return {
        color:
          typeof v?.color === "string" && /^#[0-9a-f]{6}$/i.test(v.color) ? v.color : base.color,
        size: typeof v?.size === "number" && v.size > 0 && v.size < 80 ? v.size : base.size,
      };
    };
    return {
      tool: stored?.tool === "highlighter" || stored?.tool === "eraser" ? stored.tool : "pen",
      pen: choice(stored?.pen, fallback.pen),
      highlighter: choice(stored?.highlighter, fallback.highlighter),
    };
  } catch {
    return fallback;
  }
}

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

const LIST_BUTTONS: ReadonlyArray<[TextKind, string, TextKey]> = [
  ["bullet", "list", "notebooks.note.bullets"],
  ["number", "list-ordered", "notebooks.note.numbers"],
  ["check", "list-checks", "notebooks.note.checklist"],
  ["quote", "text-quote", "notebooks.note.quote"],
];

export class TextNoteView extends TextFileView {
  private editor: NoteEditor | null = null;
  private frontmatter = "";
  /** What `getViewData` last answered: the file coming back as that is not a change. */
  private written: string | null = null;
  private choices: PenChoices;
  private bar: HTMLElement | null = null;
  private palette: HTMLElement | null = null;
  private styles: HTMLElement | null = null;
  private readonly buttons = new Map<string, HTMLElement>();
  private renameTimer = 0;
  /** The file name the note's title stood for when it was read or last renamed. */
  private namedAfter = "";

  constructor(
    leaf: WorkspaceLeaf,
    private readonly host: TextNoteHost,
  ) {
    super(leaf);
    this.choices = readChoices(this.app.loadLocalStorage(PEN_KEY));
    // Obsidian takes Mod+B and Mod+I for its own editor before the page hears
    // them; a scope of the view's own gets them first while the note is active.
    this.scope = new Scope(this.app.scope);
    const mark = (modifiers: Modifier[], key: string, marks: Marks): void => {
      this.scope?.register(modifiers, key, () => {
        if (!this.editor || this.editor.isDrawing()) return true;
        this.editor.toggleMark(marks);
        return false;
      });
    };
    mark(["Mod"], "b", BOLD);
    mark(["Mod"], "i", ITALIC);
    mark(["Mod"], "u", UNDERLINE);
    mark(["Mod", "Shift"], "x", STRIKE);
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
    return this.written;
  }

  setViewData(data: string, clear: boolean): void {
    if (!clear && data === this.written) return;
    let sequence = 0;
    const parsed = parseNoteFile(data, () => `f${(++sequence).toString(36)}`);
    this.frontmatter = parsed.frontmatter;
    this.written = data;
    this.namedAfter = titleFileName(noteTitle(parsed.note));
    this.editor?.load(parsed.note);
    this.showDate();
    if (clear) this.editor?.el.scrollTo({ top: 0 });
  }

  clear(): void {
    this.frontmatter = "";
    this.written = null;
    this.editor?.load(emptyNote(() => "b0"));
  }

  override async onLoadFile(file: TFile): Promise<void> {
    await super.onLoadFile(file);
    // A note with nothing in it yet opens ready to type its title.
    const note = this.editor?.current();
    if (note && noteTitle(note) === "" && note.blocks.length === 1) {
      this.contentEl.win.setTimeout(() => this.editor?.focusStart(), 60);
    }
  }

  override async onUnloadFile(file: TFile): Promise<void> {
    this.contentEl.win.clearTimeout(this.renameTimer);
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
    this.editor = new NoteEditor(content, {
      pen: () => this.penInHand(),
      pressure: () => this.host.pressure(),
      highlighterAlpha: () => this.host.highlighterAlpha(),
      dark: () => this.isDark(),
      fingerDraws: () => this.fingerDraws(),
      imageUrl: (path) => this.imageUrl(path),
      saveImages: (files) => this.saveImages(files),
      changed: () => {
        this.requestSave();
        this.queueRename();
      },
      stateChanged: () => this.refresh(),
      text: (key) =>
        t(
          key === "title"
            ? "notebooks.note.titlePlaceholder"
            : key === "delete"
              ? "common.delete"
              : key === "missing"
                ? "notebooks.note.missingPicture"
                : "notebooks.note.unreadable",
        ),
    });
    this.buildBar(this.bar);
    this.palette = content.createDiv({ cls: "finenotes-note-palette" });
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
        if (this.styles && !this.styles.contains(event.target as Node)) this.closeStyles();
      },
      { capture: true },
    );
    this.registerEvent(
      this.app.workspace.on("css-change", () => {
        this.editor?.refreshInk();
        this.buildPalette();
      }),
    );
    const refreshImages = (): void => this.editor?.refreshImages();
    this.registerEvent(this.app.vault.on("create", refreshImages));
    this.registerEvent(this.app.vault.on("delete", refreshImages));
    this.registerEvent(this.app.vault.on("rename", refreshImages));
  }

  override async onClose(): Promise<void> {
    this.contentEl.win.clearTimeout(this.renameTimer);
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
  ): HTMLElement {
    const button = parent.createEl("button", {
      cls: "clickable-icon finenotes-note-button",
      attr: { "aria-label": t(label), type: "button" },
    });
    setIcon(button, icon);
    button.addEventListener("pointerdown", (event) => event.preventDefault());
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      act();
    });
    this.buttons.set(id, button);
    return button;
  }

  private buildBar(bar: HTMLElement): void {
    const left = bar.createDiv({ cls: "finenotes-note-bar-group" });
    this.button(left, "styles", "type", "notebooks.note.styles", () => this.toggleStyles());
    this.button(left, "picture", "image-plus", "notebooks.note.addPicture", () =>
      this.pickPicture(),
    );
    this.button(left, "draw", "pencil", "notebooks.note.draw", () => {
      this.closeStyles();
      this.editor?.setDrawing(!this.editor.isDrawing());
    });
    const right = bar.createDiv({ cls: "finenotes-note-bar-group" });
    this.button(right, "undo", "undo-2", "common.undo", () => this.editor?.undo());
    this.button(right, "redo", "redo-2", "common.redo", () => this.editor?.redo());
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
    enable("undo", state.canUndo);
    enable("redo", state.canRedo);
    enable("styles", !state.drawing);
    this.contentEl.toggleClass("is-drawing", state.drawing);
    this.contentEl.toggleClass("is-finger-draw", this.fingerDraws());
    if (state.drawing) this.closeStyles();
    for (const [kind] of [...KIND_ROWS, ...LIST_BUTTONS]) set(`kind:${kind}`, state.kind === kind);
    for (const [mark] of MARK_BUTTONS) set(`mark:${mark}`, (state.marks & mark) !== 0);
    enable("indent", state.inList);
    enable("outdent", state.inList);
  }

  // -------------------------------------------------------------- styles

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
      if (id.startsWith("kind:") || id.startsWith("mark:") || id.endsWith("dent")) {
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
    const bar = this.contentEl.getBoundingClientRect();
    const at = anchor.getBoundingClientRect();
    panel.setCssProps({
      "--fn-styles-x": `${Math.max(8, at.left - bar.left)}px`,
      "--fn-styles-y": `${at.bottom - bar.top + 6}px`,
    });

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
    const marks = panel.createDiv({ cls: "finenotes-note-styles-row" });
    for (const [mark, icon, label] of MARK_BUTTONS) {
      this.button(marks, `mark:${mark}`, icon, label, () => this.editor?.toggleMark(mark));
    }
    const lists = panel.createDiv({ cls: "finenotes-note-styles-row" });
    for (const [kind, icon, label] of LIST_BUTTONS) {
      this.button(lists, `kind:${kind}`, icon, label, () => this.editor?.setKind(kind));
    }
    lists.createDiv({ cls: "finenotes-note-styles-gap" });
    this.button(lists, "outdent", "indent-decrease", "notebooks.note.outdent", () =>
      this.editor?.indent(-1),
    );
    this.button(lists, "indent", "indent-increase", "notebooks.note.indent", () =>
      this.editor?.indent(1),
    );
  }

  // -------------------------------------------------------------- the pen's palette

  private buildPalette(): void {
    const palette = this.palette;
    if (!palette) return;
    palette.empty();
    const { tool } = this.choices;
    const tools: ReadonlyArray<[NoteTool, string, TextKey]> = [
      ["pen", "pencil", "notebooks.note.pen"],
      ["highlighter", "highlighter", "notebooks.note.highlighter"],
      ["eraser", "eraser", "notebooks.note.eraser"],
    ];
    const toolGroup = palette.createDiv({ cls: "finenotes-note-palette-group" });
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
      const colors = palette.createDiv({ cls: "finenotes-note-palette-group" });
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
      const sizes = palette.createDiv({ cls: "finenotes-note-palette-group" });
      const all = tool === "highlighter" ? MARKER_SIZES : PEN_SIZES;
      all.forEach((size, i) => {
        const dot = sizes.createEl("button", {
          cls: "clickable-icon finenotes-note-size",
          attr: { type: "button", "aria-label": String(size) },
        });
        dot.setCssProps({ "--fn-dot": `${5 + i * 4}px` });
        dot.toggleClass("is-active", choice.size === size);
        dot.addEventListener("click", () => {
          choice.size = size;
          this.choicesChanged();
        });
      });
    }
    const done = palette.createEl("button", {
      cls: "clickable-icon finenotes-note-done",
      attr: { type: "button", "aria-label": t("common.done") },
    });
    setIcon(done, "check");
    done.addEventListener("click", () => this.editor?.setDrawing(false));
  }

  private choicesChanged(): void {
    this.app.saveLocalStorage(PEN_KEY, JSON.stringify(this.choices));
    this.buildPalette();
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
        const kept = await saveImageAttachment(this.app, prepared, name, note.path);
        saved.push({ path: kept.path, width: prepared.width });
      } catch (error) {
        console.error("FineNotes: could not add the picture", error);
      }
    }
    return saved;
  }

  // -------------------------------------------------------------- the file's name

  /**
   * The file is named after the note's title, as long as nobody named it
   * otherwise: a note still called "Untitled", or one whose name is the
   * title it had when it was opened, is renamed a moment after the title
   * was last typed in. A file the user named differently stays theirs.
   */
  private queueRename(): void {
    const win = this.contentEl.win;
    win.clearTimeout(this.renameTimer);
    this.renameTimer = win.setTimeout(() => void this.renameFromTitle(), 2500);
  }

  private async renameFromTitle(): Promise<void> {
    const file = this.file;
    const note = this.editor?.current();
    if (!file || !note) return;
    // The name follows the title while it is still the one a title gave it.
    const follows =
      hasDefaultName(file.name, t("notebooks.note.untitled")) ||
      (this.namedAfter !== "" && hasDefaultName(file.name, this.namedAfter));
    const base = titleFileName(noteTitle(note));
    if (!follows || !base || base === this.namedAfter) return;
    this.namedAfter = base;
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
