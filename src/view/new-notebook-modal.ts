/**
 * The "New notebook" dialog, after GoodNotes' "Create notebook" sheet:
 *
 *   [Cancel]        New notebook        [Create]    (sticky: never scrolls away)
 *   Title ______________________________            (focused on open)
 *   ( Notebook | Single page )
 *   Cover   No cover · Plain · Label · Spine · Linen, then eight colours
 *   Paper   size · colour · orientation, then every template
 *   Folder  Lectures/Analysis  ›
 *           Create a folder for it (Images, Recordings)   [ toggle ]
 *
 * Laid out for an iPad in either orientation, and usable with the on-screen
 * keyboard up: Create sits in the header, Return in the title creates, and
 * while the title has focus on mobile the sheet moves to the top of the
 * screen and shrinks by `--keyboard-height` (CLAUDE.md: the keyboard's
 * height comes from that variable, never from `visualViewport`).
 *
 * It only reports the choice; the plugin writes the file.
 */

import { type App, Modal, ToggleComponent, setIcon } from "obsidian";
import type { PageGeometry, Ruling } from "../model/document";
import {
  type CoverChoice,
  type NotebookChoices,
  type NotebookType,
  OWN_FOLDER_AUDIO,
  OWN_FOLDER_EXPORTS,
  OWN_FOLDER_IMAGES,
  defaultTitle,
  normalizeFolder,
} from "../model/new-notebook";
import { COVER_COLORS, sizeGeometry } from "../model/templates";
import { CoverPicker } from "./cover-picker";
import { FolderSuggestModal } from "./folder-suggest";
import { type ScrollSnapshot, captureScroll, holdScroll, keyboardGone } from "./scroll-hold";
import { PaperControls, TemplateGrid } from "./template-picker";

export interface NewNotebookRequest {
  /** As typed; the plugin cleans it and derives the file name. */
  title: string;
  choices: NotebookChoices;
  /** Vault folder path; "" is the root. */
  folder: string;
}

export interface NewNotebookOptions {
  /** Preselected: the choices made last time. */
  choices: NotebookChoices;
  /** Preselected folder: the setting, or the active file's folder. */
  folder: string;
  onCreate: (request: NewNotebookRequest) => void;
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
  private heading: HTMLElement | null = null;
  private coverSection: HTMLElement | null = null;
  private coverPicker: CoverPicker | null = null;
  private grid: TemplateGrid | null = null;
  private folderLabel: HTMLElement | null = null;
  private readonly typeButtons = new Map<NotebookType, HTMLButtonElement>();
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
    this.buildType(body);
    this.buildCover(body);
    this.buildPaper(body);
    this.buildFolder(body);

    this.syncType();
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
    this.contentEl.empty();
  }

  // --- Sections ---------------------------------------------------------------

  private buildHeader(header: HTMLElement): void {
    const cancel = header.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
    this.heading = header.createDiv({ cls: "goodobsidian-newnb-heading" });
    const create = header.createEl("button", { cls: "mod-cta", text: "Create" });
    create.addEventListener("click", () => this.create());
  }

  private buildTitle(body: HTMLElement): void {
    const input = body.createEl("input", {
      cls: "goodobsidian-newnb-title",
      type: "text",
      attr: { "aria-label": "Title", enterkeyhint: "done", autocapitalize: "sentences" },
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
  }

  private buildType(body: HTMLElement): void {
    const seg = body.createDiv({ cls: "goodobsidian-segmented goodobsidian-newnb-type" });
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", "Type");
    const types: Array<[NotebookType, string]> = [
      ["notebook", "Notebook"],
      ["single", "Single page"],
    ];
    for (const [type, label] of types) {
      const button = seg.createEl("button", { cls: "clickable-icon", text: label });
      button.addEventListener("click", () => {
        this.choices.type = type;
        this.syncType();
      });
      this.typeButtons.set(type, button);
    }
  }

  private buildCover(body: HTMLElement): void {
    const section = this.section(body, "Cover");
    this.coverSection = section;
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
    this.grid = new TemplateGrid(section, {
      selected: this.choices.ruling,
      open: "selected",
      previewWidth: PREVIEW_WIDTH,
      onSelect: (ruling: Ruling) => {
        this.choices.ruling = ruling;
      },
      onActivate: (ruling: Ruling) => {
        this.choices.ruling = ruling;
        this.create();
      },
    });
    this.grid.el.addClass("is-inline");
  }

  private buildFolder(body: HTMLElement): void {
    const section = this.section(body, "Folder");
    const row = section.createEl("button", { cls: "goodobsidian-newnb-folder clickable-icon" });
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

    // A folder of its own, named after it, with its pictures, recordings and
    // exports in folders inside. The whole row toggles: the switch alone is small.
    const own = section.createDiv({ cls: "goodobsidian-newnb-own-folder" });
    const text = own.createDiv({ cls: "goodobsidian-newnb-own-folder-text" });
    text.createDiv({ text: "Create a folder for it" });
    text.createDiv({
      cls: "goodobsidian-newnb-own-folder-desc",
      text: `Named after it, with ${OWN_FOLDER_IMAGES}, ${OWN_FOLDER_AUDIO} and ${OWN_FOLDER_EXPORTS} folders inside for its pictures, recordings and PDF exports.`,
    });
    const toggle = new ToggleComponent(own).setValue(this.choices.ownFolder).onChange((on) => {
      this.choices.ownFolder = on;
    });
    toggle.toggleEl.setAttribute("aria-label", "Create a folder for it");
    own.addEventListener("click", (event) => {
      if (toggle.toggleEl.contains(event.target as Node)) return;
      toggle.setValue(!toggle.getValue());
    });
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

  private syncType(): void {
    const single = this.choices.type === "single";
    for (const [type, button] of this.typeButtons) {
      const active = type === this.choices.type;
      button.toggleClass("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    // A single page has no cover: it is one sheet, not a book.
    this.coverSection?.toggle(!single);
    this.heading?.setText(single ? "New page" : "New notebook");
    if (this.titleInput) this.titleInput.placeholder = defaultTitle(this.choices.type);
  }

  private syncFolder(): void {
    this.folderLabel?.setText(this.folder || "Vault root");
  }

  private create(): void {
    if (this.created) return;
    this.created = true;
    const request: NewNotebookRequest = {
      title: this.titleInput?.value ?? "",
      choices: { ...this.choices },
      folder: this.folder,
    };
    this.close();
    this.options.onCreate(request);
  }
}
