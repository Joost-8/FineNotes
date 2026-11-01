/**
 * The "New notebook" dialog, after GoodNotes' "Create notebook" sheet:
 *
 *   [Create]        New notebook          (∞) (✕)    (sticky: never scrolls away)
 *   Title ______________________________            (focused on open)
 *   Import from another app…      [📁 Lectures/Analysis ›]
 *   Cover   No cover and the classic designs, the patterns, then the colours
 *   Paper   size · colour · orientation, then every template
 *
 * The ∞ switches it to an endless board (FineNotes#46): the header says
 * "New board", and cover, size, colour, orientation and the templates give
 * way to three cards, Blank, Dotted and Squared, on white paper.
 *
 * Laid out for an iPad in either orientation, and usable with the on-screen
 * keyboard up: Create sits in the header, Return in the title creates, and
 * while the title has focus on mobile the sheet moves to the top of the
 * screen and shrinks by `--keyboard-height` (CLAUDE.md: the keyboard's
 * height comes from that variable, never from `visualViewport`).
 *
 * It only reports the choice; the plugin writes the file.
 */

import { type App, Modal, setIcon } from "obsidian";
import { ICON_IMPORT_NOTEBOOK } from "../constants";
import { onEnterKey } from "./enter-key";
import { BOARD_RULINGS } from "../model/board";
import type { PageGeometry, Ruling } from "../model/document";
import {
  type CoverChoice,
  type NotebookChoices,
  defaultTitle,
  normalizeFolder,
} from "../model/new-notebook";
import { COVER_COLORS, sizeGeometry } from "../model/templates";
import { CoverPicker } from "./cover-picker";
import { FolderSuggestModal } from "./folder-suggest";
import { type ScrollSnapshot, captureScroll, holdScroll, keyboardGone } from "./scroll-hold";
import type { PaperEntry } from "../model/paper-library";
import {
  MyTemplatesSection,
  type PaperLibraryHost,
  PaperControls,
  TemplateGrid,
  paintTemplatePreview,
} from "./template-picker";

export interface NewNotebookRequest {
  /** As typed; the plugin cleans it and derives the file name. */
  title: string;
  choices: NotebookChoices;
  /** Vault folder path; "" is the root. */
  folder: string;
  /** A template from My templates, chosen instead of a paper: every page of it. */
  template?: PaperEntry;
}

export interface NewNotebookOptions {
  /** My templates, with the community gallery, when the host has them. */
  papers?: PaperLibraryHost;
  /** The dialog closed, whatever it did. */
  onClosed?: () => void;
  /** Preselected: the choices made last time. */
  choices: NotebookChoices;
  /** Preselected over the paper: the template from My templates chosen last time, if still there. */
  template?: { path: string; page: number } | null;
  /** Preselected folder: the setting, or the active file's folder. */
  folder: string;
  onCreate: (request: NewNotebookRequest) => void;
  /**
   * "Import from another app…", under the title: closes the dialog and imports
   * into the dialog's folder. Left out, there is no link.
   */
  onImport?: (folder: string) => void;
}

/** Preview width of a cover or template card, CSS px. */
const PREVIEW_WIDTH = 72;
/** Preview width of a board's paper card, CSS px: three to a row. */
const BOARD_PREVIEW_WIDTH = 132;
/** A board's paper cards show a landscape piece of it, 4 by 3. */
const BOARD_PREVIEW_GEOMETRY: PageGeometry = { width: 560, height: 420 };
/** The cards' names, in `BOARD_RULINGS` order. */
const BOARD_PAPER_NAMES: Readonly<Partial<Record<Ruling, string>>> = {
  blank: "Blank",
  dotted: "Dotted",
  squared: "Squared",
};
/** How long after the title takes focus the dialog owns scrolling (keyboard animation), ms. */
const FOCUS_HOLD_MS = 1200;
/** After closing, the app is held in place until the keyboard is down: at least, at most, ms. */
const CLOSE_HOLD_MIN_MS = 300;
const CLOSE_HOLD_MAX_MS = 2000;
/**
 * Body class that lifts Obsidian's keyboard cap on the app while the title
 * is being typed (styles.css; ledger: "Obsidian's iPad keyboard cap collapsed
 * the page to zero height"). Our own, not the surface's text-editing class,
 * so neither can release the other's.
 */
const TYPING_BODY_CLASS = "goodobsidian-dialog-typing";
/** Longest the cap stays lifted after the title lets go, waiting for the keyboard, ms. */
const CAP_RELEASE_MS = 1500;
const CAP_POLL_MS = 50;

export class NewNotebookModal extends Modal {
  private readonly choices: NotebookChoices;
  private folder: string;
  private created = false;

  private titleInput: HTMLInputElement | null = null;
  private coverPicker: CoverPicker | null = null;
  private grid: TemplateGrid | null = null;
  private folderLabel: HTMLElement | null = null;
  private heading: HTMLElement | null = null;
  private boardToggle: HTMLElement | null = null;
  /** Cover and Paper: what a notebook asks and a board does not. */
  private notebookSections: HTMLElement[] = [];
  /** A board's three paper cards. */
  private boardSection: HTMLElement | null = null;
  private boardCards: Array<{ ruling: Ruling; root: HTMLElement }> = [];
  /** Scroll offsets before the title first took focus: what closing puts back. */
  private openScroll: ScrollSnapshot | null = null;
  /** Offsets captured as a finger lands on the title, before WebKit moves anything. */
  private pendingScroll: ScrollSnapshot | null = null;
  private stopHold: (() => void) | null = null;
  private capTimer = 0;
  /** Removes Obsidian's ✕ whenever it is added to the dialog. */
  private closeWatch: MutationObserver | null = null;

  constructor(
    app: App,
    private readonly options: NewNotebookOptions,
  ) {
    super(app);
    this.choices = { ...options.choices };
    this.folder = normalizeFolder(options.folder);
  }

  override onOpen(): void {
    this.modalEl.addClass("goodobsidian-newnb-modal", "goodobsidian-dialog");
    this.containerEl.addClass("goodobsidian-newnb-container");
    // Our own ✕ in the header is the way out. The stylesheet hides Obsidian's
    // ✕ too, but on the iPad it still showed, on top of the header: remove it
    // outright, and again whenever it comes back, in case Obsidian adds it
    // after onOpen.
    this.removeCloseButton();
    this.closeWatch?.disconnect();
    this.closeWatch = new MutationObserver(() => this.removeCloseButton());
    this.closeWatch.observe(this.modalEl, { childList: true });
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("goodobsidian-newnb");

    this.buildHeader(contentEl.createDiv({ cls: "goodobsidian-newnb-header" }));
    const body = contentEl.createDiv({ cls: "goodobsidian-newnb-body" });
    this.buildTitle(body);
    this.notebookSections = [this.buildCover(body), this.buildPaper(body)];
    this.buildBoardPapers(body);

    this.repaint();
    this.syncKind();
    // Focus inside the gesture that opened the dialog: iPadOS raises the
    // keyboard only for a focus made during a user gesture. Without
    // `preventScroll`, and without the hold the focus handler starts, WebKit
    // scrolled the window to "reveal" the title and left it scrolled after
    // the dialog closed: the new notebook opened pushed off the screen.
    if (this.titleInput) {
      this.openScroll = captureScroll(this.titleInput);
      this.pendingScroll = this.openScroll;
      this.titleInput.focus({ preventScroll: true });
    }
  }

  /**
   * Obsidian's own ✕, a direct child of the dialog: `modal-close-button`
   * before 1.14, `modal-header-button` since (read from app.js). Only direct
   * children, so nothing inside our own header is touched.
   */
  private removeCloseButton(): void {
    const selector = ":scope > .modal-close-button, :scope > .modal-header-button";
    for (const el of Array.from(this.modalEl.querySelectorAll(selector))) el.remove();
  }

  override onClose(): void {
    this.closeWatch?.disconnect();
    this.closeWatch = null;
    this.stopHold?.();
    // The keyboard slides down after this; the notebook opens meanwhile.
    // Keep the app where it was until the keyboard is gone.
    const snapshot = this.openScroll;
    this.stopHold = snapshot
      ? holdScroll(snapshot, {
          minMs: CLOSE_HOLD_MIN_MS,
          maxMs: CLOSE_HOLD_MAX_MS,
          done: keyboardGone,
        })
      : null;
    this.openScroll = null;
    this.pendingScroll = null;
    this.containerEl.removeClass("is-typing");
    this.releaseCap();
    this.coverPicker = null;
    this.grid = null;
    this.notebookSections = [];
    this.boardSection = null;
    this.boardCards = [];
    this.templates?.dispose();
    this.templates = null;
    this.contentEl.empty();
    this.options.onClosed?.();
  }

  // --- Sections ---------------------------------------------------------------

  /**
   * Create on the left, the title in the middle; on the right "New board"
   * (the ∞), a symbol with its name, and a round ✕ that closes. Pages are
   * joined in the notebook's own settings (the gear), not here.
   */
  private buildHeader(header: HTMLElement): void {
    const create = header.createEl("button", { cls: "mod-cta", text: "Create" });
    create.addEventListener("click", () => this.create());
    this.heading = header.createDiv({ cls: "goodobsidian-newnb-heading", text: "New notebook" });
    const end = header.createDiv({ cls: "goodobsidian-newnb-header-end" });
    const board = end.createEl("button", {
      cls: "goodobsidian-newnb-board goodobsidian-newnb-choice clickable-icon",
      attr: { type: "button", "aria-label": "New board" },
    });
    setIcon(board.createSpan({ cls: "goodobsidian-newnb-choice-icon" }), "infinity");
    board.createSpan({ text: "New board" });
    board.addEventListener("click", () => {
      this.choices.type = this.choices.type === "endless" ? "notebook" : "endless";
      this.syncKind();
    });
    this.boardToggle = board;
    const close = end.createEl("button", {
      cls: "goodobsidian-newnb-close clickable-icon",
      attr: { type: "button", "aria-label": "Close" },
    });
    setIcon(close, "x");
    close.addEventListener("click", () => this.close());
  }

  private buildTitle(body: HTMLElement): void {
    const input = body.createEl("input", {
      cls: "goodobsidian-newnb-title",
      type: "text",
      attr: {
        "aria-label": "Title",
        enterkeyhint: "done",
        autocapitalize: "sentences",
        placeholder: defaultTitle("notebook"),
      },
    });
    // Not while an IME is composing: its Return confirms the characters.
    onEnterKey(input, () => this.create());
    // While the title has focus the on-screen keyboard is up (on iPad): lift
    // the sheet to the top so nothing it needs sits under the keyboard.
    input.addEventListener("pointerdown", () => {
      if (document.activeElement !== input) this.pendingScroll = captureScroll(input);
    });
    input.addEventListener("focus", () => {
      this.containerEl.addClass("is-typing");
      const snapshot = this.pendingScroll ?? captureScroll(input);
      this.pendingScroll = null;
      this.openScroll ??= snapshot;
      this.stopHold?.();
      this.stopHold = holdScroll(snapshot, { minMs: FOCUS_HOLD_MS, maxMs: FOCUS_HOLD_MS });
      this.liftCap();
    });
    input.addEventListener("blur", () => {
      this.containerEl.removeClass("is-typing");
      this.releaseCap();
    });
    this.titleInput = input;
    // Under the title: importing instead on the left, where it goes on the right.
    const row = body.createDiv({ cls: "goodobsidian-newnb-under-title" });
    this.buildImportLink(row);
    this.buildFolder(row);
  }

  /** A quiet link under the title: bring a notebook in from another app instead. */
  private buildImportLink(body: HTMLElement): void {
    const onImport = this.options.onImport;
    if (!onImport) return;
    // `clickable-icon` keeps Obsidian's own button styling (and its iPad
    // padding) off this link-styled button.
    const link = body.createEl("button", {
      cls: "goodobsidian-newnb-import clickable-icon",
      attr: { type: "button" },
    });
    setIcon(link.createSpan({ cls: "goodobsidian-newnb-import-icon" }), ICON_IMPORT_NOTEBOOK);
    link.createSpan({ text: "Import from another app…" });
    link.createSpan({ cls: "goodobsidian-beta-tag", text: "Beta" });
    link.addEventListener("click", () => {
      const folder = this.folder;
      this.close();
      onImport(folder);
    });
  }

  private buildCover(body: HTMLElement): HTMLElement {
    const section = this.section(body, "Cover");
    const color = COVER_COLORS.find((c) => c.id === this.choices.coverColor) ?? COVER_COLORS[0];
    this.coverPicker = new CoverPicker(section, {
      design: this.choices.cover,
      paperColor: color.color,
      geometry: this.geometry(),
      allowNone: true,
      previewWidth: PREVIEW_WIDTH,
      onChange: (design: CoverChoice, paperColor: string) => {
        this.choices.cover = design;
        const picked = COVER_COLORS.find((c) => c.color === paperColor.toLowerCase());
        if (picked) this.choices.coverColor = picked.id;
      },
    });
    return section;
  }

  private buildPaper(body: HTMLElement): HTMLElement {
    const section = this.section(body, "Paper");
    new PaperControls(section.createDiv({ cls: "goodobsidian-templates-controls" }), {
      keepSize: false,
      sizeId: this.choices.size,
      color: this.choices.paper,
      landscape: this.choices.landscape,
      onChange: (state) => {
        this.choices.size = state.sizeId;
        this.choices.paper = state.color;
        this.choices.landscape = state.landscape;
        this.repaint();
      },
    });
    // My templates first: a whole template (a planner's every page) instead of one paper.
    const papers = this.options.papers;
    if (papers) {
      this.templates = new MyTemplatesSection(section, {
        host: papers,
        wholeFiles: true,
        previewWidth: PREVIEW_WIDTH,
        ...(this.options.template ? { initial: this.options.template } : {}),
        onChoose: (entry) => this.chooseTemplate(entry),
        onActivate: (entry) => {
          this.chooseTemplate(entry);
          this.create();
        },
        onRemoved: (path) => {
          if (this.template?.path === path) this.chooseTemplate(null);
        },
      });
    }
    this.grid = new TemplateGrid(section, {
      selected: this.choices.ruling,
      previewWidth: PREVIEW_WIDTH,
      onSelect: (ruling: Ruling) => {
        this.choices.ruling = ruling;
        this.chooseTemplate(null);
      },
      onActivate: (ruling: Ruling) => {
        this.choices.ruling = ruling;
        this.chooseTemplate(null);
        this.create();
      },
    });
    this.grid.el.addClass("is-inline");
    return section;
  }

  /**
   * A board's paper: three cards, white, one of them chosen. A double tap
   * creates the board at once, as a template's does.
   */
  private buildBoardPapers(body: HTMLElement): void {
    const section = body.createDiv({ cls: "goodobsidian-newnb-section goodobsidian-newnb-boards" });
    const row = section.createDiv({ cls: "goodobsidian-newnb-board-cards" });
    this.boardCards = BOARD_RULINGS.map((ruling) => {
      const name = BOARD_PAPER_NAMES[ruling] ?? ruling;
      const root = row.createEl("button", {
        cls: "goodobsidian-template-card is-large clickable-icon",
        attr: { type: "button", "aria-label": name },
      });
      const canvas = root.createEl("canvas", { cls: "goodobsidian-template-preview" });
      paintTemplatePreview(canvas, { kind: ruling }, BOARD_PREVIEW_GEOMETRY, BOARD_PREVIEW_WIDTH);
      root.createDiv({ cls: "goodobsidian-template-name", text: name });
      root.addEventListener("click", () => {
        this.choices.boardRuling = ruling;
        this.syncBoardCards();
      });
      root.addEventListener("dblclick", () => {
        this.choices.boardRuling = ruling;
        this.syncBoardCards();
        this.create();
      });
      return { ruling, root };
    });
    this.boardSection = section;
    this.syncBoardCards();
  }

  private syncBoardCards(): void {
    for (const card of this.boardCards) {
      const active = card.ruling === this.choices.boardRuling;
      card.root.toggleClass("is-selected", active);
      card.root.setAttribute("aria-pressed", String(active));
    }
  }

  /**
   * Show what the kind asks for: a notebook its cover and paper, a board its
   * three cards. The ∞ is lit while it is on; the header and the title's
   * placeholder say which is being made.
   */
  private syncKind(): void {
    const board = this.choices.type === "endless";
    this.boardToggle?.toggleClass("is-active", board);
    this.boardToggle?.setAttribute("aria-pressed", String(board));
    this.heading?.setText(board ? "New board" : "New notebook");
    this.titleInput?.setAttribute("placeholder", defaultTitle(board ? "endless" : "notebook"));
    for (const section of this.notebookSections) section.toggleClass("is-hidden", board);
    this.boardSection?.toggleClass("is-hidden", !board);
  }

  /** A template from My templates (null: the paper picked in the grid). */
  private chooseTemplate(entry: PaperEntry | null): void {
    this.template = entry;
    this.grid?.setDimmed(entry !== null);
    this.templates?.select(entry);
  }

  /** Repaint My templates' previews of `path`: one of its PDF pages has rendered. */
  paperReady(path: string): void {
    this.templates?.paperReady(path);
  }

  private templates: MyTemplatesSection | null = null;
  private template: PaperEntry | null = null;

  /** The folder it is made in, as a chip beside the import link: tap to choose another. */
  private buildFolder(parent: HTMLElement): void {
    const row = parent.createEl("button", { cls: "goodobsidian-newnb-folder clickable-icon" });
    row.setAttribute("aria-label", "Choose folder");
    setIcon(row.createSpan({ cls: "goodobsidian-newnb-folder-icon" }), "folder");
    this.folderLabel = row.createSpan({ cls: "goodobsidian-newnb-folder-path" });
    setIcon(row.createSpan({ cls: "goodobsidian-newnb-folder-icon" }), "chevron-right");
    row.addEventListener("click", () => {
      new FolderSuggestModal(
        this.app,
        (path) => {
          this.folder = normalizeFolder(path);
          this.syncFolder();
        },
        undefined,
        this.folder,
      ).open();
    });
    this.syncFolder();
  }

  private section(body: HTMLElement, title: string): HTMLElement {
    const section = body.createDiv({ cls: "goodobsidian-newnb-section" });
    section.createDiv({ cls: "goodobsidian-newnb-section-title", text: title });
    return section;
  }

  // --- The keyboard cap -------------------------------------------------------

  /**
   * While the title has focus, Obsidian squeezes the app behind the dialog
   * to the space above the keyboard — to nothing at all, on the iPad — and a
   * notebook created with the keyboard up opened inside that squeezed app.
   * Lift the cap, as a page text box does.
   */
  private liftCap(): void {
    window.clearTimeout(this.capTimer);
    this.capTimer = 0;
    document.body.addClass(TYPING_BODY_CLASS);
  }

  /** Put the cap back once the keyboard is fully down, when it changes nothing. */
  private releaseCap(): void {
    window.clearTimeout(this.capTimer);
    const deadline = performance.now() + CAP_RELEASE_MS;
    const attempt = (): void => {
      this.capTimer = 0;
      const input = this.titleInput;
      // Focus came straight back (a tap on the title again): keep it lifted.
      if (input?.isConnected && document.activeElement === input) return;
      if (keyboardGone() || performance.now() >= deadline) {
        document.body.removeClass(TYPING_BODY_CLASS);
        return;
      }
      this.capTimer = window.setTimeout(attempt, CAP_POLL_MS);
    };
    attempt();
  }

  // --- State -------------------------------------------------------------------

  private geometry(): PageGeometry {
    return sizeGeometry(this.choices.size, this.choices.landscape);
  }

  private repaint(): void {
    const geometry = this.geometry();
    this.grid?.repaint(this.choices.paper, geometry);
    this.coverPicker?.setGeometry(geometry);
  }

  private syncFolder(): void {
    this.folderLabel?.setText(this.folder || "Vault root");
    this.folderLabel?.parentElement?.setAttribute("title", this.folder || "Vault root");
  }

  private create(): void {
    if (this.created) return;
    this.created = true;
    const request: NewNotebookRequest = {
      title: this.titleInput?.value ?? "",
      choices: { ...this.choices },
      folder: this.folder,
    };
    // A board is drawn on one of its three papers, never a template's pages.
    if (this.template && this.choices.type !== "endless") request.template = this.template;
    this.close();
    this.options.onCreate(request);
  }
}
