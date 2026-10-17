/**
 * "Ask", laid out as a chat: the pages to send and the chat's controls on
 * top (Save chat, Chats, New chat), the conversation in the middle (your
 * questions as bubbles on the right, the answers rendered as markdown on the
 * left, each with Copy and Insert as text box), and the question field at the
 * bottom with a paperclip and a round send button. Before the first question,
 * suggestions fill the empty thread.
 *
 * Top left is the page picker: a thumbnail of the page being read, picked
 * when the dialog opens. Tapped, it opens the notebook's own PDFs (any of
 * them can be attached, whichever pages are picked) above a grid of every
 * page to pick up to `ASK_MAX_PAGES`. Each question sends the picked pages
 * the chat has not seen yet, so pages can be added mid-conversation.
 *
 * The conversation itself is an `AskSession` owned by the notebook's view:
 * this dialog only draws it. Closing the dialog loses nothing — reopened, it
 * shows the same chat, an answer that arrived meanwhile, the draft and the
 * pages picked.
 *
 * On the iPad the field sits at the bottom of a tall dialog, under the
 * keyboard: `DialogKeyboard` with `fit` shrinks the dialog to the room above
 * the keyboard and lifts it there, so the thread gets shorter and the field
 * stays in view.
 */

import {
  type App,
  Component,
  FuzzySuggestModal,
  MarkdownRenderer,
  Menu,
  Modal,
  Notice,
  type TFile,
  setIcon,
} from "obsidian";
import {
  ASK_MAX_PAGES,
  type ChatFile,
  PDF_MIME,
  markdownToPlainText,
} from "../recognition/ai-chat";
import {
  ATTACH_ACCEPT,
  type PdfBehind,
  attachKind,
  attachmentBytes,
  attachmentFromBytes,
  fileNameOf,
  pageRanges,
  sizeLabel,
} from "../recognition/ask-attachments";
import { type AskSession, pagesPhrase, shownText } from "../recognition/ask-session";
import { type SavedChatEntry, attachableFiles, readAttachment } from "./ask-chats-io";
import { DialogKeyboard } from "./dialog-keyboard";
import { writeSystemText } from "./system-clipboard";

export interface AskAiHost {
  session: AskSession;
  /** Markdown links in answers resolve against this note. */
  sourcePath: string;
  /** Who answers ("Anthropic (Claude)"), for the line under the pages. */
  target: string;
  /** The page being read, 1-based. */
  currentPage: () => number;
  /** Whether a page (1-based) has anything on it to ask about. */
  pageHasContent: (page: number) => boolean;
  /** Paint page `page` (1-based) into `canvas`, `cssWidth` wide. */
  paintThumbnail: (canvas: HTMLCanvasElement, page: number, cssWidth: number) => Promise<void>;
  /** Place `text` on the page being read; true when it was placed. */
  insert: (text: string) => boolean;
  /** The notebook's own PDFs, each with the 1-based pages printed on it. */
  notebookPdfs: () => PdfBehind[];
  /** This notebook's saved chats, newest first. */
  savedChats: () => Promise<SavedChatEntry[]>;
  /** Continue a saved chat in the session. */
  openSaved: (path: string) => Promise<void>;
  /** Remember "Save chat" for the next new chat. */
  rememberSave: (save: boolean) => void;
}

/** What the empty thread offers to ask, for one page or several; a tap sends it. */
const SUGGESTIONS = {
  one: [
    "Summarise this page",
    "Explain this step by step",
    "Check my work for mistakes",
    "Quiz me on this page",
  ],
  many: [
    "Summarise these pages",
    "What are the key ideas?",
    "Make practice questions",
    "What should I review?",
  ],
} as const;

/** Tallest the question field grows before it scrolls, px. */
const INPUT_MAX_PX = 160;
/** Width of a page in the picker's grid, and of the chip's thumbnail, CSS px. */
const GRID_THUMB_PX = 96;
const CHIP_THUMB_PX = 26;

export class AskAiModal extends Modal {
  private readonly session: AskSession;
  /** Owns the markdown render children of every answer; unloaded on close. */
  private component: Component | null = null;
  private keyboard: DialogKeyboard | null = null;
  private unsubscribe: (() => void) | null = null;

  private threadEl: HTMLElement | null = null;
  private noteEl: HTMLElement | null = null;
  private input: HTMLTextAreaElement | null = null;
  private sendButton: HTMLButtonElement | null = null;
  private attachButton: HTMLButtonElement | null = null;
  private fileInput: HTMLInputElement | null = null;
  /** The files on the next question, inside the field. */
  private filesEl: HTMLElement | null = null;
  /** The notebook's PDFs in the picker, by vault path. */
  private readonly pdfRows = new Map<string, { row: HTMLButtonElement; state: HTMLElement }>();
  private saveButton: HTMLButtonElement | null = null;
  private chatsButton: HTMLButtonElement | null = null;
  private newChatButton: HTMLButtonElement | null = null;

  /** The page picker: its chip, and the grid it opens. */
  private pagesButton: HTMLButtonElement | null = null;
  private chipThumb: HTMLCanvasElement | null = null;
  private chipLabel: HTMLElement | null = null;
  private chipPage = 0;
  private pickerEl: HTMLElement | null = null;
  private pickerCount: HTMLElement | null = null;
  /** Each page's tile in the grid, by 1-based page. */
  private readonly tiles = new Map<number, HTMLButtonElement>();
  private paintedThumbs = false;

  /** What the thread shows: each turn's text, in order. */
  private shownTexts: string[] = [];
  /** The question waiting for its answer (or failed), drawn after the turns. */
  private outstandingEl: HTMLElement | null = null;
  private outstandingKey = "";
  /** Whether the empty thread's suggestions are for one page. */
  private emptyForOne: boolean | null = null;

  constructor(
    app: App,
    private readonly host: AskAiHost,
  ) {
    super(app);
    this.session = host.session;
  }

  override onOpen(): void {
    this.component = new Component();
    this.component.load();
    this.modalEl.addClass("goodobsidian-ask-modal", "goodobsidian-dialog");
    this.keyboard = new DialogKeyboard(this.modalEl, { fit: true });
    this.titleEl.setText("Ask");
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("goodobsidian-chat");

    const top = contentEl.createDiv({ cls: "goodobsidian-chat-top" });
    this.buildPagesChip(top);
    const tools = top.createDiv({ cls: "goodobsidian-chat-tools" });
    this.saveButton = this.toolButton(tools, "bookmark", "Save chat", () => {
      const save = !this.session.save;
      this.host.rememberSave(save);
      void this.session.setSave(save).catch((error: unknown) => {
        new Notice(`FineNotes: could not ${save ? "save" : "remove"} the chat: ${String(error)}`);
      });
    });
    this.chatsButton = this.toolButton(tools, "history", "Chats", (event) => {
      void this.showChats(event);
    });
    this.newChatButton = this.toolButton(tools, "square-pen", "New chat", () => {
      this.closePicker();
      this.session.newChat(this.host.currentPage());
      this.input?.focus();
    });

    this.noteEl = contentEl.createDiv({ cls: "goodobsidian-chat-note" });
    this.buildPicker(contentEl);
    this.threadEl = contentEl.createDiv({ cls: "goodobsidian-chat-thread" });

    const composer = contentEl.createDiv({ cls: "goodobsidian-chat-composer" });
    this.filesEl = composer.createDiv({ cls: "goodobsidian-chat-files is-hidden" });
    const row = composer.createDiv({ cls: "goodobsidian-chat-compose-row" });
    this.attachButton = row.createEl("button", {
      cls: "goodobsidian-chat-attach clickable-icon",
      attr: { "aria-label": "Attach a file" },
    });
    setIcon(this.attachButton, "paperclip");
    this.attachButton.addEventListener("click", () => this.showAttachMenu());
    // The device's own picker (Files and Photos on the iPad), behind "From Files…".
    this.fileInput = row.createEl("input", {
      cls: "goodobsidian-chat-file-input",
      attr: { type: "file", accept: ATTACH_ACCEPT, multiple: "" },
    });
    this.fileInput.addEventListener("change", () => void this.attachPicked());
    const input = row.createEl("textarea", { cls: "goodobsidian-chat-input" });
    this.input = input;
    input.rows = 1;
    input.value = this.session.draft;
    input.addEventListener("input", () => {
      this.session.draft = input.value;
      this.syncInput();
    });
    input.addEventListener("focus", () => this.closePicker());
    input.addEventListener("keydown", (event) => {
      // Return sends, as in any chat; Shift+Return is a new line. Not while
      // an input method is still composing a character.
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        this.submit();
      }
    });
    this.sendButton = row.createEl("button", {
      cls: "goodobsidian-chat-send clickable-icon",
      attr: { "aria-label": "Send" },
    });
    setIcon(this.sendButton, "arrow-up");
    this.sendButton.addEventListener("click", () => this.submit());
    this.keyboard.watch(input, composer);

    this.unsubscribe = this.session.onChange(() => this.render());
    this.render();
    this.scrollToEnd();
    window.setTimeout(() => this.input?.focus(), 0);
  }

  override onClose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.keyboard?.end();
    this.keyboard = null;
    this.component?.unload();
    this.component = null;
    this.contentEl.empty();
  }

  private toolButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    onClick: (event: MouseEvent) => void,
  ): HTMLButtonElement {
    const button = parent.createEl("button", {
      cls: "goodobsidian-chat-tool clickable-icon",
      attr: { "aria-label": label },
    });
    setIcon(button.createSpan({ cls: "goodobsidian-chat-tool-icon" }), icon);
    button.createSpan({ cls: "goodobsidian-chat-tool-label", text: label });
    button.addEventListener("click", onClick);
    return button;
  }

  // --- Pages ----------------------------------------------------------------

  /** The chip top left: a thumbnail of the first picked page, and what is picked. */
  private buildPagesChip(parent: HTMLElement): void {
    const chip = parent.createEl("button", {
      cls: "goodobsidian-chat-pages clickable-icon",
      attr: { "aria-haspopup": "true", "aria-expanded": "false" },
    });
    const stack = chip.createDiv({ cls: "goodobsidian-chat-pages-stack" });
    this.chipThumb = stack.createEl("canvas", { cls: "goodobsidian-chat-pages-thumb" });
    this.chipLabel = chip.createSpan({ cls: "goodobsidian-chat-pages-label" });
    setIcon(chip.createSpan({ cls: "goodobsidian-chat-pages-chevron" }), "chevron-down");
    chip.addEventListener("click", () => this.togglePicker());
    this.pagesButton = chip;
  }

  /** The grid of every page, hidden until the chip is tapped. */
  private buildPicker(parent: HTMLElement): void {
    const picker = parent.createDiv({ cls: "goodobsidian-chat-picker is-hidden" });
    const head = picker.createDiv({ cls: "goodobsidian-chat-picker-head" });
    const title = head.createDiv({ cls: "goodobsidian-chat-picker-title" });
    title.createSpan({ text: "Pages to send" });
    this.pickerCount = title.createSpan({ cls: "goodobsidian-chat-picker-count" });
    const only = head.createEl("button", {
      cls: "goodobsidian-chat-picker-link clickable-icon",
      text: "Only this page",
    });
    only.addEventListener("click", () => this.session.setSelection([this.host.currentPage()]));
    const done = head.createEl("button", { cls: "mod-cta clickable-icon", text: "Done" });
    done.addEventListener("click", () => this.closePicker());

    this.buildPdfList(picker);
    const grid = picker.createDiv({ cls: "goodobsidian-chat-picker-grid" });
    const current = this.host.currentPage();
    for (let page = 1; page <= this.session.totalPages; page++) {
      const tile = grid.createEl("button", {
        cls: "goodobsidian-chat-tile clickable-icon",
        attr: { "aria-label": `Page ${page}` },
      });
      const frame = tile.createDiv({ cls: "goodobsidian-chat-tile-frame" });
      frame.createEl("canvas", { cls: "goodobsidian-chat-tile-thumb" });
      setIcon(frame.createDiv({ cls: "goodobsidian-chat-tile-check" }), "check");
      const caption = tile.createDiv({ cls: "goodobsidian-chat-tile-caption" });
      caption.createSpan({ text: String(page) });
      if (page === current)
        caption.createSpan({ cls: "goodobsidian-chat-tile-tag", text: "This page" });
      caption.createSpan({ cls: "goodobsidian-chat-tile-sent", text: "In chat" });
      if (!this.host.pageHasContent(page)) {
        tile.addClass("is-empty");
        tile.disabled = true;
        tile.setAttribute("aria-label", `Page ${page}, empty`);
      }
      tile.addEventListener("click", () => this.session.togglePage(page));
      this.tiles.set(page, tile);
    }
    picker.createDiv({
      cls: "goodobsidian-chat-picker-foot",
      text: `Up to ${ASK_MAX_PAGES} pages. Pages already in the chat stay in it.`,
    });
    this.pickerEl = picker;
  }

  private togglePicker(): void {
    if (this.pickerEl?.hasClass("is-hidden")) this.openPicker();
    else this.closePicker();
  }

  private openPicker(): void {
    const picker = this.pickerEl;
    if (!picker) return;
    this.input?.blur();
    picker.removeClass("is-hidden");
    this.pagesButton?.setAttribute("aria-expanded", "true");
    this.modalEl.addClass("is-picking");
    // Bring the page being read into view (by scrolling the grid itself, as
    // `scrollToEnd` does the thread), then paint the thumbnails.
    const tile = this.tiles.get(this.host.currentPage());
    const grid = tile?.parentElement;
    if (tile && grid) grid.scrollTop = tile.offsetTop - (grid.clientHeight - tile.offsetHeight) / 2;
    if (!this.paintedThumbs) {
      this.paintedThumbs = true;
      void this.paintTiles();
    }
  }

  private closePicker(): void {
    if (!this.pickerEl || this.pickerEl.hasClass("is-hidden")) return;
    this.pickerEl.addClass("is-hidden");
    this.pagesButton?.setAttribute("aria-expanded", "false");
    this.modalEl.removeClass("is-picking");
  }

  /** Paint every tile, the page being read and its neighbours first, one at a time. */
  private async paintTiles(): Promise<void> {
    const current = this.host.currentPage();
    const order = [...this.tiles.keys()].sort(
      (a, b) => Math.abs(a - current) - Math.abs(b - current) || a - b,
    );
    for (const page of order) {
      const canvas = this.tiles.get(page)?.querySelector("canvas");
      if (!canvas || !this.component) return;
      try {
        await this.host.paintThumbnail(canvas, page, GRID_THUMB_PX);
      } catch {
        // A page that cannot be drawn keeps its blank paper.
      }
    }
  }

  /** The chip and the grid, in line with the session's pick. */
  private renderPages(): void {
    const session = this.session;
    const picked = session.selected;
    const sent = session.sentPages;
    const full = picked.length >= ASK_MAX_PAGES;
    for (const [page, tile] of this.tiles) {
      const on = picked.includes(page);
      tile.toggleClass("is-selected", on);
      tile.toggleClass("is-sent", sent.has(page));
      tile.setAttribute("aria-pressed", String(on));
      if (!tile.hasClass("is-empty")) tile.disabled = session.busy || (!on && full);
    }
    this.pickerCount?.setText(`${picked.length} of ${ASK_MAX_PAGES}`);
    if (this.chipLabel) {
      this.chipLabel.setText(
        picked.length === 0
          ? "Pick pages"
          : picked.length <= 3
            ? `${picked.length === 1 ? "Page" : "Pages"} ${picked.join(", ")}`
            : `${picked.length} pages`,
      );
    }
    this.pagesButton?.toggleClass("is-many", picked.length > 1);
    this.pagesButton?.toggleClass("is-none", picked.length === 0);
    const first = picked[0] ?? 0;
    if (first !== this.chipPage && this.chipThumb) {
      this.chipPage = first;
      const canvas = this.chipThumb;
      if (first) void this.host.paintThumbnail(canvas, first, CHIP_THUMB_PX).catch(() => undefined);
    }
  }

  /** The line under the top bar: what the next question sends, and to whom. */
  private noteText(): string {
    const session = this.session;
    const sent = session.sentPages;
    const fresh = session.selected.filter((p) => !sent.has(p));
    const saved = session.save ? " Saved in AI chats." : "";
    if (session.selected.length === 0 && sent.size === 0) {
      return `Pick the pages to ask about.${saved}`;
    }
    if (fresh.length === 0) return `Asking ${this.host.target}.${saved}`;
    return `Sends ${pagesPhrase(fresh)} to ${this.host.target} with your question.${saved}`;
  }

  // --- Files ----------------------------------------------------------------

  /** Where a file comes from: the vault, or the device. */
  private showAttachMenu(): void {
    this.closePicker();
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle("From your vault…")
        .setIcon("vault")
        .onClick(() => {
          new VaultFileModal(this.app, attachableFiles(this.app), (file) => {
            void this.attachVaultFile(file.path);
          }).open();
        }),
    );
    menu.addItem((item) =>
      item
        .setTitle("From Files…")
        .setIcon("folder-open")
        .onClick(() => this.fileInput?.click()),
    );
    const anchor = this.attachButton?.getBoundingClientRect();
    if (anchor) menu.showAtPosition({ x: anchor.left, y: anchor.top - 4 });
  }

  private async attachVaultFile(path: string): Promise<void> {
    const file = await readAttachment(this.app, path);
    if (!file) {
      new Notice(`FineNotes: ${fileNameOf(path)} could not be read.`);
      return;
    }
    this.attachOrSay(file);
  }

  /** Files picked on the device. */
  private async attachPicked(): Promise<void> {
    const input = this.fileInput;
    if (!input?.files) return;
    for (const picked of Array.from(input.files)) {
      const file = attachmentFromBytes(picked.name, new Uint8Array(await picked.arrayBuffer()));
      if (file) this.attachOrSay(file);
      else {
        new Notice(
          `FineNotes: the AI cannot read ${picked.name}. Attach a PDF, a picture or a text file.`,
        );
      }
    }
    // The same file can be picked again after it was taken off.
    input.value = "";
  }

  private attachOrSay(file: ChatFile): void {
    const refusal = this.session.attach(file);
    if (refusal) new Notice(`FineNotes: ${refusal}`);
  }

  /** The files on the next question, as chips in the field, each with a ✕. */
  private renderAttachments(): void {
    const el = this.filesEl;
    if (!el) return;
    el.empty();
    const files = this.session.attachments;
    el.toggleClass("is-hidden", files.length === 0);
    for (const file of files) {
      const chip = el.createDiv({ cls: "goodobsidian-chat-file" });
      setIcon(chip.createSpan({ cls: "goodobsidian-chat-file-icon" }), fileIcon(file));
      const text = chip.createDiv({ cls: "goodobsidian-chat-file-text" });
      text.createDiv({ cls: "goodobsidian-chat-file-name", text: file.name });
      text.createDiv({
        cls: "goodobsidian-chat-file-size",
        text: sizeLabel(attachmentBytes(file)),
      });
      const remove = chip.createEl("button", {
        cls: "goodobsidian-chat-file-remove clickable-icon",
        attr: { "aria-label": `Remove ${file.name}` },
      });
      setIcon(remove, "x");
      remove.disabled = this.session.busy;
      remove.addEventListener("click", () => this.session.detach(file));
    }
  }

  /**
   * The notebook's own PDFs, at the top of the page picker: attaching one
   * lets the AI read the slides' text, not only a picture of each page. All
   * of them are offered, whichever pages are picked; tap one to attach it,
   * again to take it off.
   */
  private buildPdfList(picker: HTMLElement): void {
    const pdfs = this.host.notebookPdfs();
    if (pdfs.length === 0) return;
    const section = picker.createDiv({ cls: "goodobsidian-chat-pdfs" });
    const head = section.createDiv({ cls: "goodobsidian-chat-pdfs-head" });
    head.createSpan({ cls: "goodobsidian-chat-pdfs-title", text: "PDFs in this notebook" });
    head.createSpan({
      cls: "goodobsidian-chat-pdfs-hint",
      text: "Attach one and the AI reads its text, not only pictures of the pages.",
    });
    const list = section.createDiv({ cls: "goodobsidian-chat-pdfs-list" });
    for (const pdf of pdfs) {
      const row = list.createEl("button", { cls: "goodobsidian-chat-pdf clickable-icon" });
      setIcon(row.createSpan({ cls: "goodobsidian-chat-pdf-icon" }), "file-text");
      const text = row.createSpan({ cls: "goodobsidian-chat-pdf-text" });
      text.createSpan({ cls: "goodobsidian-chat-pdf-name", text: fileNameOf(pdf.path) });
      text.createSpan({
        cls: "goodobsidian-chat-pdf-pages",
        text: `${pdf.pages.length === 1 ? "Page" : "Pages"} ${pageRanges(pdf.pages)}`,
      });
      const state = row.createSpan({ cls: "goodobsidian-chat-pdf-state" });
      row.addEventListener("click", () => {
        const attached = this.session.attachments.find((f) => f.path === pdf.path);
        if (attached) this.session.detach(attached);
        else void this.attachVaultFile(pdf.path);
      });
      this.pdfRows.set(pdf.path, { row, state });
    }
  }

  /** Each PDF row: Attach, Attached, or In chat. */
  private renderPdfs(): void {
    const session = this.session;
    const sent = session.sentFiles;
    for (const [path, { row, state }] of this.pdfRows) {
      const inChat = sent.some((f) => f.path === path);
      const attached = session.attachments.some((f) => f.path === path);
      row.toggleClass("is-attached", attached || inChat);
      row.disabled = session.busy || inChat;
      row.setAttribute("aria-pressed", String(attached));
      state.empty();
      if (inChat) {
        state.setText("In chat");
      } else if (attached) {
        setIcon(state.createSpan(), "check");
        state.createSpan({ text: "Attached" });
      } else {
        setIcon(state.createSpan(), "paperclip");
        state.createSpan({ text: "Attach" });
      }
    }
  }

  // --- Conversation ---------------------------------------------------------

  private submit(question?: string): void {
    const text = (question ?? this.input?.value ?? "").trim();
    if (!text || this.session.busy) return;
    this.closePicker();
    if (question === undefined && this.input) {
      this.input.value = "";
      this.session.draft = "";
      this.syncInput();
    }
    this.session.dismissError();
    void this.session.send(text);
  }

  /** Bring the whole dialog in line with the session. */
  private render(): void {
    const session = this.session;
    const busy = session.busy;
    const saved = session.save;
    if (this.saveButton) {
      this.saveButton.toggleClass("is-active", saved);
      this.saveButton.setAttribute("aria-pressed", String(saved));
      this.saveButton.setAttribute(
        "aria-label",
        saved ? "Saved — tap to stop saving" : "Save chat",
      );
      const icon = this.saveButton.querySelector<HTMLElement>(".goodobsidian-chat-tool-icon");
      if (icon) setIcon(icon, saved ? "bookmark-check" : "bookmark");
      this.saveButton
        .querySelector(".goodobsidian-chat-tool-label")
        ?.setText(saved ? "Saved" : "Save chat");
    }
    if (this.pagesButton) this.pagesButton.disabled = busy;
    if (this.chatsButton) this.chatsButton.disabled = busy;
    if (this.attachButton) this.attachButton.disabled = busy;
    if (this.newChatButton) {
      this.newChatButton.disabled = busy;
      this.newChatButton.toggleClass("is-hidden", session.empty);
    }
    this.renderPages();
    this.renderAttachments();
    this.renderPdfs();
    this.noteEl?.setText(this.noteText());
    if (this.input) {
      this.input.placeholder =
        session.turns.length > 0 ? "Ask a follow-up…" : "Ask about your notes…";
    }
    this.renderThread();
    this.syncInput();
  }

  /** Grow the field with its text, up to a few lines, and enable Send when there is a question. */
  private syncInput(): void {
    const input = this.input;
    if (!input) return;
    input.setCssProps({ "--goodobsidian-chat-input-h": "auto" });
    const height = Math.min(INPUT_MAX_PX, input.scrollHeight);
    input.setCssProps({ "--goodobsidian-chat-input-h": `${height}px` });
    input.toggleClass("is-scrolling", input.scrollHeight > INPUT_MAX_PX);
    if (this.sendButton) this.sendButton.disabled = this.session.busy || !input.value.trim();
    // A taller field moves its top: keep it above the keyboard.
    this.keyboard?.update();
  }

  /**
   * Draw the turns not drawn yet, or all of them again when the chat is a
   * different one (a new chat, a loaded one); then the outstanding question.
   */
  private renderThread(): void {
    const thread = this.threadEl;
    if (!thread) return;
    const session = this.session;
    const texts = session.turns.map(shownText);
    const same =
      this.shownTexts.length <= texts.length &&
      this.shownTexts.every((text, i) => text === texts[i]);
    if (!same) {
      thread.empty();
      this.outstandingEl = null;
      this.outstandingKey = "";
      this.emptyForOne = null;
      this.shownTexts = [];
    }
    const added = texts.length > this.shownTexts.length;
    // New turns go before the outstanding question, which is redrawn below.
    this.outstandingEl?.remove();
    this.outstandingEl = null;
    let lastAnswer: HTMLElement | null = null;
    for (let i = this.shownTexts.length; i < texts.length; i++) {
      const turn = session.turns[i];
      if (turn.role === "user") this.questionRow(thread, texts[i], turn.pages, turn.files);
      else lastAnswer = this.answerRow(thread, texts[i]);
    }
    this.shownTexts = texts;

    if (session.empty) {
      const one = session.selected.length <= 1;
      if (this.emptyForOne !== one) {
        thread.querySelector(".goodobsidian-chat-empty")?.remove();
        this.renderEmpty(thread, one);
        this.emptyForOne = one;
      }
    } else if (this.emptyForOne !== null) {
      thread.querySelector(".goodobsidian-chat-empty")?.remove();
      this.emptyForOne = null;
    }

    const outstanding = session.outstanding;
    const key = outstanding
      ? `${outstanding.question}|${outstanding.status}|${outstanding.error ?? ""}`
      : "";
    if (outstanding) {
      const row = thread.createDiv({ cls: "goodobsidian-chat-outstanding" });
      this.questionRow(row, outstanding.question);
      if (outstanding.error === undefined) this.pendingRow(row, outstanding.status);
      else this.errorRow(row, outstanding.question, outstanding.error);
      this.outstandingEl = row;
    }
    if (added && lastAnswer) this.scrollToAnswer(lastAnswer);
    else if (key !== this.outstandingKey && outstanding) this.scrollToEnd();
    this.outstandingKey = key;
  }

  /** The thread before the first question: what this is, and a few questions to start with. */
  private renderEmpty(thread: HTMLElement, one: boolean): void {
    const empty = thread.createDiv({ cls: "goodobsidian-chat-empty" });
    setIcon(empty.createDiv({ cls: "goodobsidian-chat-empty-icon" }), "sparkles");
    empty.createDiv({
      cls: "goodobsidian-chat-empty-title",
      text: one ? "Ask about this page" : "Ask about these pages",
    });
    const chips = empty.createDiv({ cls: "goodobsidian-chat-suggestions" });
    for (const text of one ? SUGGESTIONS.one : SUGGESTIONS.many) {
      const chip = chips.createEl("button", { cls: "goodobsidian-chat-suggestion clickable-icon" });
      chip.setText(text);
      chip.addEventListener("click", () => this.submit(text));
    }
  }

  /** A question's bubble, with the pages it sent under it. */
  private questionRow(
    parent: HTMLElement,
    text: string,
    pages?: readonly number[],
    files?: readonly ChatFile[],
  ): void {
    const row = parent.createDiv({ cls: "goodobsidian-chat-msg is-user" });
    const column = row.createDiv({ cls: "goodobsidian-chat-question" });
    column.createDiv({ cls: "goodobsidian-chat-bubble", text });
    if (pages?.length) {
      const label = pages.length === 1 ? `Page ${pages[0]}` : `Pages ${pages.join(", ")}`;
      const meta = column.createDiv({ cls: "goodobsidian-chat-question-pages" });
      setIcon(meta.createSpan(), "file-image");
      meta.createSpan({ text: label });
    }
    if (files?.length) {
      const meta = column.createDiv({ cls: "goodobsidian-chat-question-pages" });
      setIcon(meta.createSpan(), "paperclip");
      meta.createSpan({ text: files.map((f) => f.name).join(", ") });
    }
  }

  /** An answer's row: the assistant's mark and a body. */
  private aiRow(parent: HTMLElement): { row: HTMLElement; body: HTMLElement } {
    const row = parent.createDiv({ cls: "goodobsidian-chat-msg is-ai" });
    setIcon(row.createDiv({ cls: "goodobsidian-chat-avatar" }), "sparkles");
    return { row, body: row.createDiv({ cls: "goodobsidian-chat-body" }) };
  }

  /** Three bouncing dots, and what is happening when there is something to say. */
  private pendingRow(parent: HTMLElement, status: string): void {
    const { body } = this.aiRow(parent);
    const typing = body.createDiv({ cls: "goodobsidian-chat-typing" });
    typing.setAttribute("aria-label", "Thinking");
    for (let i = 0; i < 3; i++) typing.createSpan({ cls: "goodobsidian-chat-dot" });
    body.createDiv({ cls: "goodobsidian-chat-status", text: status });
  }

  private errorRow(parent: HTMLElement, question: string, message: string): void {
    const { row, body } = this.aiRow(parent);
    row.addClass("is-error");
    body.createDiv({ cls: "goodobsidian-chat-error", text: `Could not answer: ${message}` });
    const retry = body.createEl("button", { cls: "goodobsidian-chat-action clickable-icon" });
    setIcon(retry.createSpan(), "rotate-ccw");
    retry.createSpan({ text: "Try again" });
    retry.addEventListener("click", () => this.submit(question));
  }

  private answerRow(parent: HTMLElement, markdown: string): HTMLElement {
    const { row, body } = this.aiRow(parent);
    const text = body.createDiv({ cls: "goodobsidian-chat-markdown markdown-rendered" });
    if (this.component) {
      void MarkdownRenderer.render(this.app, markdown, text, this.host.sourcePath, this.component);
    } else {
      text.setText(markdown);
    }

    const actions = body.createDiv({ cls: "goodobsidian-chat-actions" });
    const copy = actions.createEl("button", { cls: "goodobsidian-chat-action clickable-icon" });
    setIcon(copy.createSpan(), "copy");
    copy.createSpan({ text: "Copy" });
    copy.addEventListener("click", () => {
      void writeSystemText(markdown).then(
        () => new Notice("Answer copied."),
        () => new Notice("FineNotes could not use the clipboard here."),
      );
    });

    const insert = actions.createEl("button", { cls: "goodobsidian-chat-action clickable-icon" });
    setIcon(insert.createSpan(), "text-cursor-input");
    insert.createSpan({ text: "Insert as text box" });
    insert.addEventListener("click", () => {
      if (this.host.insert(markdownToPlainText(markdown))) {
        new Notice("Answer added to the page as a text box. Undo removes it.");
      }
    });
    return row;
  }

  /** The saved chats of this notebook, as a menu; picking one continues it. */
  private async showChats(event: MouseEvent): Promise<void> {
    this.closePicker();
    const anchor = this.chatsButton?.getBoundingClientRect();
    const chats = await this.host.savedChats();
    const menu = new Menu();
    if (chats.length === 0) {
      menu.addItem((item) =>
        item.setTitle("No saved chats yet. Turn on Save chat to keep one.").setDisabled(true),
      );
    }
    for (const chat of chats) {
      menu.addItem((item) =>
        item
          .setTitle(`${chat.title}${chat.created ? ` · ${shortDate(chat.created)}` : ""}`)
          .setIcon("message-square")
          .setChecked(chat.path === this.session.savedPath)
          .onClick(() => void this.host.openSaved(chat.path)),
      );
    }
    if (anchor) menu.showAtPosition({ x: anchor.left, y: anchor.bottom + 4 });
    else menu.showAtMouseEvent(event);
  }

  /**
   * Scroll the thread itself, never `scrollIntoView`: on the iPad that also
   * scrolls the window, which the keyboard handling then has to undo.
   */
  private scrollToEnd(): void {
    const thread = this.threadEl;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }

  /** Show a new answer from its start; a long one is read from the top. */
  private scrollToAnswer(answerEl: HTMLElement): void {
    const thread = this.threadEl;
    if (!thread) return;
    thread.scrollTop = Math.min(answerEl.offsetTop - 8, thread.scrollHeight);
  }
}

/** "17 Oct" this year, "17 Oct 2025" before. */
function shortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** The icon for an attached file's kind. */
function fileIcon(file: { name: string; mimeType: string }): string {
  if (file.mimeType === PDF_MIME) return "file-text";
  if (file.mimeType.startsWith("image/")) return "image";
  return attachKind(file.name) === "text" ? "file-code" : "file";
}

/** Search the vault for a file to attach: PDFs, pictures and text files, newest first. */
class VaultFileModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private readonly files: TFile[],
    private readonly onPick: (file: TFile) => void,
  ) {
    super(app);
    this.setPlaceholder("Attach a PDF, a picture or a text file…");
  }

  getItems(): TFile[] {
    return this.files;
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onPick(file);
  }
}
