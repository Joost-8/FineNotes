/**
 * The "New notebook" dialog, after GoodNotes' "Create notebook" sheet:
 *
 *   [Cancel]        New notebook        [Create]    (sticky: never scrolls away)
 *   Title ______________________________            (focused on open)
 *   Import from another app…      [📁 Lectures/Analysis ›]
 *   Cover   No cover and the classic designs, the patterns, then the colours
 *   Paper   size · colour · orientation, then every template
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
    // Cancel is our way out. The stylesheet hides Obsidian's ✕ too, but on
    // the iPad it still showed, on top of Create: remove it outright — and
    // again whenever it comes back, in case Obsidian adds it after onOpen.
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
    this.buildCover(body);
    this.buildPaper(body);

    this.repaint();
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

  private removeCloseButton(): void {
    for (const el of Array.from(this.modalEl.querySelectorAll(".modal-close-button"))) el.remove();
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
    this.templates?.dispose();
    this.templates = null;
    this.contentEl.empty();
    this.options.onClosed?.();
  }

  // --- Sections ---------------------------------------------------------------

  private buildHeader(header: HTMLElement): void {
    const cancel = header.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
    header.createDiv({ cls: "goodobsidian-newnb-heading", text: "New notebook" });
    const create = header.createEl("button", { cls: "mod-cta", text: "Create" });
    create.addEventListener("click", () => this.create());
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
    input.addEventListener("keydown", (event) => {
      // Not while an IME is composing: its Return confirms the characters.
      if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        this.create();
      }
    });
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

  private buildCover(body: HTMLElement): void {
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
  }

  private buildPaper(body: HTMLElement): void {
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
        onChoose: (entry) => this.chooseTemplate(entry),
        onActivate: (entry) => {
          this.chooseTemplate(entry);
          this.create();
        },
      });
    }
    this.grid = new TemplateGrid(section, {
      selected: this.choices.ruling,
      open: "selected",
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
    if (this.template) request.template = this.template;
    this.close();
    this.options.onCreate(request);
  }
}
