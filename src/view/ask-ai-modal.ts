/**
 * "Ask", laid out as a chat: the pages to send and the chat's controls on
 * top (New chat), the conversation in the middle (your
 * questions as bubbles on the right, the answers rendered as markdown on the
 * left, each with Copy and Insert as text box), and the question field at the
 * bottom with a paperclip and a round send button. Before the first question,
 * suggestions fill the empty thread.
 *
 * Top left is the page picker: a thumbnail of the page being read, picked
 * when the dialog opens (none on a board, which sends what is on screen
 * with each question). Tapped, it opens the notebook's own PDFs (any of
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
import { t, tn } from "../i18n/translate";
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
import { type AskUsage, usageMark } from "../recognition/ask-usage";
import type { ChangeState } from "../model/change-set";
import { ASK_VAULT_SCOPES, type AskVaultScope } from "../recognition/vault-context";

/** The reach as a mark: the notebook alone, its folder, or the whole vault. */
const REACH_ICON: Readonly<Record<AskVaultScope, string>> = {
  off: "notebook",
  folder: "folder-search",
  vault: "library",
};
import { bytesToBase64 } from "../recognition/audio-request";
import { attachableFiles, readAttachment } from "./ask-chats-io";
import { DialogKeyboard } from "./dialog-keyboard";
import { onEnterKey } from "./enter-key";
import { keyboardHeight } from "./keyboard";
import { writeSystemText } from "./system-clipboard";
import { sizeObserver } from "./host-window";

export interface AskAiHost {
  session: AskSession;
  /** Markdown links in answers resolve against this note. */
  sourcePath: string;
  /** Who answers ("Anthropic (Claude)"), for the line under the pages. */
  target: string;
  /** Open an `obsidian://finenotes?…` link from an answer (a handbook entry) in FineNotes itself. */
  openAppLink?: (url: string) => void;
  /** Whether an answer shows what it cost (the setting). */
  showCost?: () => boolean;
  /** The page being read, 1-based. */
  currentPage: () => number;
  /** Whether a page (1-based) has anything on it to ask about. */
  pageHasContent: (page: number) => boolean;
  /** Paint page `page` (1-based) into `canvas`, `cssWidth` wide. */
  paintThumbnail: (canvas: HTMLCanvasElement, page: number, cssWidth: number) => Promise<void>;
  /** Place `text` on the page being read; true when it was placed. */
  insert: (text: string) => boolean;
  /**
   * Ask AI's changes to the notebook, by number (`model/change-ledger`):
   * where each stands, taking one back or making it again, and a call when
   * the notebook changed (so the marks follow an undo).
   */
  changes?: {
    state: (id: number) => ChangeState | null;
    toggle: (id: number) => void;
    onChange: (listener: () => void) => () => void;
  };
  /** Place an SVG drawing from an answer on the page being read. */
  insertDrawing: (svg: string) => Promise<boolean>;
  /**
   * The whole notebook as one PDF to attach, for a notebook with more pages
   * than a question can send as pictures; `onProgress` counts pages made.
   * Null when it could not be made.
   */
  notebookAsPdf?: (onProgress: (done: number, total: number) => void) => Promise<ChatFile | null>;
  /** The notebook's own PDFs, each with the 1-based pages printed on it. */
  notebookPdfs: () => PdfBehind[];
  /** What Ask AI may read besides this notebook (the setting), and changing it from the chat. */
  vaultScope?: { get: () => AskVaultScope; set: (scope: AskVaultScope) => void };
  /**
   * A chat about something that is not pages (a text note, `note-ask.ts`):
   * what goes with each question is said by `line`; there are no pages to
   * pick and no sidebar to move to.
   */
  subject?: {
    line: (saved: boolean) => string;
    empty: string;
    suggestions: readonly string[];
  };
}

/**
 * What the empty thread offers to ask, for one page, several, or only an
 * attached file (the lasso's Ask AI sends its selection as one); a tap
 * sends it. With nothing picked or attached (a new chat, unless the setting
 * picks the open page) there is nothing to ask about yet: no suggestions.
 */
type SuggestionKind = "none" | "one" | "many" | "screen" | "file";

function suggestions(kind: SuggestionKind): string[] {
  switch (kind) {
    case "none":
      return [];
    case "one":
      return [
        t("ai.ask.suggestOne.summarise"),
        t("ai.ask.suggestOne.explain"),
        t("ai.ask.suggestOne.check"),
        t("ai.ask.suggestOne.quiz"),
      ];
    case "many":
      return [
        t("ai.ask.suggestMany.summarise"),
        t("ai.ask.suggestMany.keyIdeas"),
        t("ai.ask.suggestMany.practice"),
        t("ai.ask.suggestMany.review"),
      ];
    case "screen":
      // A board (FineNotes#46): what is on screen goes with each question.
      return [
        t("ai.ask.suggestScreen.explain"),
        t("ai.ask.suggestScreen.summarise"),
        t("ai.ask.suggestScreen.check"),
        t("ai.ask.suggestScreen.quiz"),
      ];
    case "file":
      return [
        t("ai.ask.suggestFile.says"),
        t("ai.ask.suggestFile.explain"),
        t("ai.ask.suggestFile.check"),
        t("ai.ask.suggestFile.quiz"),
      ];
  }
}

/** Tallest the question field grows before it scrolls, px. */
const INPUT_MAX_PX = 160;
/** Shortest the field gets when the keyboard leaves little room, px. */
const INPUT_MIN_PX = 40;
/** Of the thread, what stays in view above the field however tall it grows, px. */
const THREAD_MIN_PX = 32;
/** The chat column's gap between rows, px (styles.css). */
const ROW_GAP_PX = 8;
/** Width of a page in the picker's grid, and of the chip's thumbnail, CSS px. */
const GRID_THUMB_PX = 96;
const CHIP_THUMB_PX = 26;

/**
 * The chat itself, drawn into a frame: a window (`AskAiModal`) or the
 * sidebar beside the page (`AskChatPanel`). Both show the same `AskSession`,
 * so switching between them keeps the chat and the draft.
 */
export class AskChat {
  private readonly session: AskSession;
  /** Owns the markdown render children of every answer; unloaded on close. */
  private component: Component | null = null;
  private unsubscribe: (() => void) | null = null;
  /** Refits the field when the column changes height (the keyboard sliding in). */
  private resize: ResizeObserver | null = null;

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
  /** The whole notebook as one PDF, first in the PDF list (more pages than a question takes). */
  private wholeRow: { row: HTMLButtonElement; state: HTMLElement } | null = null;
  /** The whole notebook's PDF, once made: attached, or sent with a question. */
  private wholeFile: ChatFile | null = null;
  /** "Making PDF… n/N" while it is made. */
  private wholeProgress: string | null = null;
  private reachButton: HTMLButtonElement | null = null;
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
  /** What the empty thread's suggestions are for. */
  private emptyFor: SuggestionKind | null = null;
  /** Each action row that changed the notebook, by its change's number. */
  private readonly changeRows = new Map<number, { item: HTMLElement; button: HTMLButtonElement }>();
  private unsubscribeChanges: (() => void) | null = null;

  private readonly keyboard: DialogKeyboard;

  constructor(
    private readonly app: App,
    private readonly host: AskAiHost,
    private readonly frame: AskChatFrame,
  ) {
    this.session = host.session;
    this.keyboard = frame.keyboard;
  }

  /** Build the chat into the frame. */
  mount(): void {
    this.component = new Component();
    this.component.load();
    const contentEl = this.frame.content;
    contentEl.empty();
    contentEl.addClass("goodobsidian-chat");

    const top = contentEl.createDiv({ cls: "goodobsidian-chat-top" });
    // A board sends what is on screen: there are no pages to pick.
    if (!this.session.screen && !this.host.subject) this.buildPagesChip(top);
    // Every chat is kept, as a note in the notebook's (or note's) AI chats
    // folder, and is opened or deleted there, as any file: no controls for it here.
    const tools = top.createDiv({ cls: "goodobsidian-chat-tools" });
    // What it may read, right of the title: the reach's icon and its name, so
    // the choice is read at a glance and changed in one tap.
    if (this.host.vaultScope) {
      const chip = this.frame.title.createEl("button", {
        cls: "goodobsidian-chat-reach clickable-icon",
        attr: { "aria-haspopup": "true" },
      });
      chip.createSpan({ cls: "goodobsidian-chat-reach-icon" });
      chip.createSpan({ cls: "goodobsidian-chat-reach-label" });
      setIcon(chip.createSpan({ cls: "goodobsidian-chat-reach-chevron" }), "chevron-down");
      chip.addEventListener("click", () => this.showReachMenu());
      this.reachButton = chip;
    }
    const other = this.frame.layout === "window" ? "sidebar" : "window";
    if (!this.host.subject)
      this.toolButton(
        tools,
        other === "sidebar" ? "panel-left" : "app-window",
        other === "sidebar" ? t("ai.ask.showInSidebar") : t("ai.ask.showAsWindow"),
        () => this.frame.switchLayout(),
        "goodobsidian-chat-layout",
      );
    this.newChatButton = this.toolButton(tools, "square-pen", t("ai.ask.newChat"), () => {
      this.closePicker();
      this.session.newChat(this.host.currentPage());
      this.input?.focus();
    });

    this.noteEl = contentEl.createDiv({ cls: "goodobsidian-chat-note" });
    if (!this.session.screen && !this.host.subject) this.buildPicker(contentEl);
    this.threadEl = contentEl.createDiv({ cls: "goodobsidian-chat-thread" });

    const composer = contentEl.createDiv({ cls: "goodobsidian-chat-composer" });
    this.filesEl = composer.createDiv({ cls: "goodobsidian-chat-files is-hidden" });
    const row = composer.createDiv({ cls: "goodobsidian-chat-compose-row" });
    this.attachButton = row.createEl("button", {
      cls: "goodobsidian-chat-attach clickable-icon",
      attr: { "aria-label": t("ai.ask.attach") },
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
    input.addEventListener("blur", () => this.syncInput());
    // Return sends, as in any chat; Shift+Return is a new line. Not while
    // an input method is still composing a character.
    onEnterKey(input, () => this.submit(), { shiftNewline: true });
    this.sendButton = row.createEl("button", {
      cls: "goodobsidian-chat-send clickable-icon",
      attr: { "aria-label": t("ai.ask.send") },
    });
    setIcon(this.sendButton, "arrow-up");
    this.sendButton.addEventListener("click", () => this.submit());
    this.keyboard.watch(input, composer);

    this.unsubscribe = this.session.onChange(() => this.render());
    this.unsubscribeChanges = this.host.changes?.onChange(() => this.refreshChanges()) ?? null;
    this.resize = sizeObserver(contentEl, () => this.syncInput());
    this.resize.observe(contentEl);
    this.render();
    this.scrollToEnd();
    window.setTimeout(() => this.input?.focus(), 0);
  }

  /** Take the chat down; the session, and so the chat and the draft, live on. */
  destroy(): void {
    this.resize?.disconnect();
    this.resize = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.unsubscribeChanges?.();
    this.unsubscribeChanges = null;
    this.keyboard.end();
    this.component?.unload();
    this.component = null;
    this.frame.content.empty();
  }

  private toolButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    onClick: (event: MouseEvent) => void,
    cls = "",
  ): HTMLButtonElement {
    const button = parent.createEl("button", {
      cls: `goodobsidian-chat-tool clickable-icon ${cls}`.trim(),
      attr: { "aria-label": label },
    });
    setIcon(button.createSpan({ cls: "goodobsidian-chat-tool-icon" }), icon);
    button.createSpan({ cls: "goodobsidian-chat-tool-label", text: label });
    button.addEventListener("click", onClick);
    return button;
  }

  // --- What it may read -----------------------------------------------------

  /** The three reaches, the one in use checked; the choice is the setting's. */
  private showReachMenu(): void {
    const scope = this.host.vaultScope;
    const anchor = this.reachButton?.getBoundingClientRect();
    if (!scope || !anchor) return;
    this.closePicker();
    const menu = new Menu();
    const now = scope.get();
    for (const choice of ASK_VAULT_SCOPES) {
      menu.addItem((item) =>
        item
          .setTitle(t(`ai.ask.reach.${choice}`))
          .setIcon(REACH_ICON[choice])
          .setChecked(choice === now)
          .onClick(() => {
            scope.set(choice);
            this.renderReach();
          }),
      );
    }
    menu.showAtPosition({ x: anchor.left, y: anchor.bottom + 4 });
  }

  /** The pill shows the reach in use: its icon and its name. */
  private renderReach(): void {
    const button = this.reachButton;
    const scope = this.host.vaultScope;
    if (!button || !scope) return;
    const now = scope.get();
    const icon = button.querySelector<HTMLElement>(".goodobsidian-chat-reach-icon");
    if (icon) setIcon(icon, REACH_ICON[now]);
    button.querySelector(".goodobsidian-chat-reach-label")?.setText(t(`ai.ask.reach.${now}`));
    button.setAttribute("aria-label", t("ai.ask.reachNow", { reach: t(`ai.ask.reach.${now}`) }));
    button.disabled = this.session.busy;
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
    title.createSpan({ text: t("ai.ask.pagesToSend") });
    this.pickerCount = title.createSpan({ cls: "goodobsidian-chat-picker-count" });
    const only = head.createEl("button", {
      cls: "goodobsidian-chat-picker-link clickable-icon",
      text: t("ai.ask.onlyThisPage"),
    });
    only.addEventListener("click", () => this.session.setSelection([this.host.currentPage()]));
    const done = head.createEl("button", {
      cls: "mod-cta clickable-icon",
      text: t("common.done"),
    });
    done.addEventListener("click", () => this.closePicker());

    this.buildPdfList(picker);
    const grid = picker.createDiv({ cls: "goodobsidian-chat-picker-grid" });
    const current = this.host.currentPage();
    for (let page = 1; page <= this.session.totalPages; page++) {
      const tile = grid.createEl("button", {
        cls: "goodobsidian-chat-tile clickable-icon",
        attr: { "aria-label": t("ai.ask.page", { page }) },
      });
      const frame = tile.createDiv({ cls: "goodobsidian-chat-tile-frame" });
      frame.createEl("canvas", { cls: "goodobsidian-chat-tile-thumb" });
      setIcon(frame.createDiv({ cls: "goodobsidian-chat-tile-check" }), "check");
      const caption = tile.createDiv({ cls: "goodobsidian-chat-tile-caption" });
      caption.createSpan({ text: String(page) });
      if (page === current)
        caption.createSpan({ cls: "goodobsidian-chat-tile-tag", text: t("ai.ask.thisPage") });
      caption.createSpan({ cls: "goodobsidian-chat-tile-sent", text: t("ai.ask.inChat") });
      if (!this.host.pageHasContent(page)) {
        tile.addClass("is-empty");
        tile.disabled = true;
        tile.setAttribute("aria-label", t("ai.ask.pageEmpty", { page }));
      }
      tile.addEventListener("click", () => this.session.togglePage(page));
      this.tiles.set(page, tile);
    }
    picker.createDiv({
      cls: "goodobsidian-chat-picker-foot",
      text: t("ai.ask.pickerFoot", { max: ASK_MAX_PAGES }),
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
    this.frame.content.addClass("is-picking");
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
    this.frame.content.removeClass("is-picking");
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
    this.pickerCount?.setText(t("ai.ask.pickedOf", { count: picked.length, max: ASK_MAX_PAGES }));
    if (this.chipLabel) {
      this.chipLabel.setText(
        picked.length === 0
          ? t("ai.ask.pickPages")
          : picked.length <= 3
            ? tn("ai.ask.pageList", picked.length, { list: picked.join(", ") })
            : tn("ai.ask.pageCount", picked.length),
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
    const saved = session.save;
    const target = this.host.target;
    if (this.host.subject) return this.host.subject.line(saved);
    if (session.screen) {
      return t(saved ? "ai.ask.noteScreenSaved" : "ai.ask.noteScreen", { target });
    }
    // While a question is out its files have left the field, but it is asking, not waiting for a pick.
    if (
      session.selected.length === 0 &&
      sent.size === 0 &&
      session.attachments.length === 0 &&
      !session.busy
    ) {
      return t(saved ? "ai.ask.notePickSaved" : "ai.ask.notePick");
    }
    // Saying it can use the notebook also tells which build is running.
    if (fresh.length === 0) {
      return t(saved ? "ai.ask.noteAskingSaved" : "ai.ask.noteAsking", { target });
    }
    return t(saved ? "ai.ask.noteSendsSaved" : "ai.ask.noteSends", {
      pages: pagesPhrase(fresh),
      target,
    });
  }

  // --- Files ----------------------------------------------------------------

  /** Where a file comes from: the vault, or the device. */
  private showAttachMenu(): void {
    this.closePicker();
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle(t("ai.ask.fromVault"))
        .setIcon("vault")
        .onClick(() => {
          new VaultFileModal(this.app, attachableFiles(this.app), (file) => {
            void this.attachVaultFile(file.path);
          }).open();
        }),
    );
    menu.addItem((item) =>
      item
        .setTitle(t("ai.ask.fromFiles"))
        .setIcon("folder-open")
        .onClick(() => this.fileInput?.click()),
    );
    const anchor = this.attachButton?.getBoundingClientRect();
    if (anchor) menu.showAtPosition({ x: anchor.left, y: anchor.top - 4 });
  }

  private async attachVaultFile(path: string): Promise<void> {
    const file = await readAttachment(this.app, path);
    if (!file) {
      new Notice(t("ai.ask.unreadable", { name: fileNameOf(path) }));
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
        new Notice(t("ai.ask.cannotRead", { name: picked.name }));
      }
    }
    // The same file can be picked again after it was taken off.
    input.value = "";
  }

  /**
   * Attach the notebook's PDF in place of the picked pages, making it first
   * (once: taken off and attached again, the same file goes).
   */
  private async attachWholeNotebook(make: NonNullable<AskAiHost["notebookAsPdf"]>): Promise<void> {
    if (this.wholeProgress !== null) return;
    let file = this.wholeFile;
    if (!file) {
      this.wholeProgress = t("ai.ask.makingPdf", { done: 0, total: this.session.totalPages });
      this.renderWhole();
      try {
        file = await make((done, total) => {
          this.wholeProgress = t("ai.ask.makingPdf", { done, total });
          this.renderWhole();
        });
      } finally {
        this.wholeProgress = null;
      }
      if (!file) {
        this.renderWhole();
        new Notice(t("ai.ask.pdfFailed"));
        return;
      }
      this.wholeFile = file;
    }
    const refusal = this.session.attachInstead(file);
    if (refusal) new Notice(refusal);
    this.renderWhole();
  }

  private attachOrSay(file: ChatFile): void {
    const refusal = this.session.attach(file);
    if (refusal) new Notice(t("ai.ask.refusal", { reason: refusal }));
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
        attr: { "aria-label": t("ai.ask.removeFile", { name: file.name }) },
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
    // Closed with its ✕, it stays closed while the notebook is open, and the
    // pages get its room. The paperclip still attaches any PDF.
    const pdfs = this.session.pdfListClosed ? [] : this.host.notebookPdfs();
    // More pages than a question takes as pictures: the whole notebook as one
    // PDF, a row like the notebook's own PDFs, which the AI reads page by page.
    const makePdf = this.host.notebookAsPdf;
    const whole =
      makePdf && this.session.totalPages > ASK_MAX_PAGES && !this.session.screen ? makePdf : null;
    if (pdfs.length === 0 && !whole) return;
    const section = picker.createDiv({ cls: "goodobsidian-chat-pdfs" });
    if (whole) this.buildWholeRow(section.createDiv({ cls: "goodobsidian-chat-pdfs-list" }), whole);
    if (pdfs.length === 0) return;
    const head = section.createDiv({ cls: "goodobsidian-chat-pdfs-head" });
    const words = head.createDiv({ cls: "goodobsidian-chat-pdfs-words" });
    words.createSpan({ cls: "goodobsidian-chat-pdfs-title", text: t("ai.ask.pdfsTitle") });
    words.createSpan({
      cls: "goodobsidian-chat-pdfs-hint",
      text: t("ai.ask.pdfsHint"),
    });
    const close = head.createEl("button", {
      cls: "goodobsidian-chat-pdfs-close clickable-icon",
      attr: { "aria-label": t("ai.ask.hidePdfs") },
    });
    setIcon(close, "x");
    close.addEventListener("click", () => {
      this.session.pdfListClosed = true;
      // The whole notebook's row stays: only the notebook's own PDFs go.
      head.remove();
      list.remove();
      if (!this.wholeRow) section.remove();
      this.pdfRows.clear();
    });
    const list = section.createDiv({ cls: "goodobsidian-chat-pdfs-list" });
    for (const pdf of pdfs) {
      const row = list.createEl("button", { cls: "goodobsidian-chat-pdf clickable-icon" });
      setIcon(row.createSpan({ cls: "goodobsidian-chat-pdf-icon" }), "file-text");
      const text = row.createSpan({ cls: "goodobsidian-chat-pdf-text" });
      text.createSpan({ cls: "goodobsidian-chat-pdf-name", text: fileNameOf(pdf.path) });
      text.createSpan({
        cls: "goodobsidian-chat-pdf-pages",
        text: tn("ai.ask.pageList", pdf.pages.length, { list: pageRanges(pdf.pages) }),
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

  /** The whole notebook's row: its icon, name and page count, and Attach. */
  private buildWholeRow(list: HTMLElement, make: NonNullable<AskAiHost["notebookAsPdf"]>): void {
    const row = list.createEl("button", { cls: "goodobsidian-chat-pdf clickable-icon" });
    setIcon(row.createSpan({ cls: "goodobsidian-chat-pdf-icon" }), "files");
    const text = row.createSpan({ cls: "goodobsidian-chat-pdf-text" });
    text.createSpan({ cls: "goodobsidian-chat-pdf-name", text: t("ai.ask.wholeAsPdf") });
    text.createSpan({
      cls: "goodobsidian-chat-pdf-pages",
      text: tn("ai.ask.wholePages", this.session.totalPages),
    });
    const state = row.createSpan({ cls: "goodobsidian-chat-pdf-state" });
    row.addEventListener("click", () => {
      const attached = this.wholeFile && this.session.attachments.includes(this.wholeFile);
      if (attached && this.wholeFile) this.session.detach(this.wholeFile);
      else void this.attachWholeNotebook(make);
    });
    this.wholeRow = { row, state };
  }

  /** The whole notebook's row: Attach, Making PDF… n/N, Attached, or In chat. */
  private renderWhole(): void {
    const whole = this.wholeRow;
    if (!whole) return;
    const session = this.session;
    const file = this.wholeFile;
    const inChat = !!file && session.sentFiles.includes(file);
    const attached = !!file && session.attachments.includes(file);
    const making = this.wholeProgress !== null;
    whole.row.toggleClass("is-attached", attached || inChat);
    whole.row.disabled = session.busy || inChat || making;
    whole.row.setAttribute("aria-pressed", String(attached));
    const { state } = whole;
    state.empty();
    if (making) {
      state.createSpan({ text: this.wholeProgress ?? "" });
    } else if (inChat) {
      state.setText(t("ai.ask.inChat"));
    } else if (attached) {
      setIcon(state.createSpan(), "check");
      state.createSpan({ text: t("ai.ask.attached") });
    } else {
      setIcon(state.createSpan(), "paperclip");
      state.createSpan({ text: t("ai.ask.attachShort") });
    }
  }

  /** Each PDF row: Attach, Attached, or In chat. */
  private renderPdfs(): void {
    this.renderWhole();
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
        state.setText(t("ai.ask.inChat"));
      } else if (attached) {
        setIcon(state.createSpan(), "check");
        state.createSpan({ text: t("ai.ask.attached") });
      } else {
        setIcon(state.createSpan(), "paperclip");
        state.createSpan({ text: t("ai.ask.attachShort") });
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
    if (this.pagesButton) this.pagesButton.disabled = busy;
    this.renderReach();
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
        session.turns.length > 0 ? t("ai.ask.followUp") : t("ai.ask.placeholder");
    }
    this.renderThread();
    this.syncInput();
  }

  /** Grow the field with its text, up to a few lines, and enable Send when there is a question. */
  private syncInput(): void {
    const input = this.input;
    if (!input) return;
    // The keyboard first: the room the field has depends on it. While it is
    // up, the line under the tools gives its room to the field.
    this.keyboard.update();
    this.frame.content.toggleClass(
      "is-typing",
      document.activeElement === input && keyboardHeight() > 0,
    );
    input.setCssProps({ "--goodobsidian-chat-input-h": "auto" });
    const max = this.inputRoom(input);
    const height = Math.min(max, input.scrollHeight);
    input.setCssProps({
      "--goodobsidian-chat-input-h": `${height}px`,
      "--goodobsidian-chat-input-max": `${max}px`,
    });
    // Past its room the field scrolls inside, and the line being typed stays in view.
    input.toggleClass("is-scrolling", input.scrollHeight > max);
    if (this.sendButton) this.sendButton.disabled = this.session.busy || !input.value.trim();
  }

  /**
   * How tall the field may grow: up to `INPUT_MAX_PX`, but never so tall
   * that the column overflows, which on the iPad pushed the field under
   * the keyboard (the column is short then). The thread above gives up
   * its height first, down to `THREAD_MIN_PX`.
   */
  private inputRoom(input: HTMLTextAreaElement): number {
    const content = this.frame.content;
    const composer = input.closest<HTMLElement>(".goodobsidian-chat-composer");
    const above =
      this.pickerEl && !this.pickerEl.hasClass("is-hidden") ? this.pickerEl : this.threadEl;
    if (!composer || !above) return INPUT_MAX_PX;
    const box = content.getBoundingClientRect();
    if (box.height === 0) return INPUT_MAX_PX;
    const padding = parseFloat(getComputedStyle(content).paddingBottom) || 0;
    const chrome = composer.offsetHeight - input.offsetHeight;
    const room =
      box.bottom -
      padding -
      above.getBoundingClientRect().top -
      THREAD_MIN_PX -
      ROW_GAP_PX -
      chrome;
    return Math.max(INPUT_MIN_PX, Math.min(INPUT_MAX_PX, Math.floor(room)));
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
      this.changeRows.clear();
      this.outstandingEl = null;
      this.outstandingKey = "";
      this.emptyFor = null;
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
      else lastAnswer = this.answerRow(thread, texts[i], turn.actions, turn.usage, turn.changes);
    }
    this.shownTexts = texts;
    this.refreshChanges();

    if (session.empty) {
      const count = session.selected.length;
      const kind = session.screen
        ? "screen"
        : count > 1
          ? "many"
          : count === 1
            ? "one"
            : session.attachments.length
              ? "file"
              : "none";
      if (this.emptyFor !== kind) {
        thread.querySelector(".goodobsidian-chat-empty")?.remove();
        this.renderEmpty(thread, kind);
        this.emptyFor = kind;
      }
    } else if (this.emptyFor !== null) {
      thread.querySelector(".goodobsidian-chat-empty")?.remove();
      this.emptyFor = null;
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

  /**
   * Each action that changed the notebook, marked as it stands now: in
   * place (its control undoes it), taken back (struck through; the control
   * redoes it), or touched since (the control says why it cannot, on a tap).
   */
  private refreshChanges(): void {
    const changes = this.host.changes;
    if (!changes) return;
    for (const [id, { item, button }] of this.changeRows) {
      const state = changes.state(id);
      const undone = state === "undone";
      item.toggleClass("is-undone", undone);
      item.toggleClass("is-changed", state === "changed");
      button.toggleClass("is-hidden", state === null);
      const icon = undone ? "redo-2" : "undo-2";
      if (button.dataset.icon !== icon) {
        button.empty();
        setIcon(button, icon);
        button.dataset.icon = icon;
      }
      button.setAttribute("aria-label", t(undone ? "ai.ask.redoChange" : "ai.ask.undoChange"));
    }
  }

  /** The thread before the first question: what this is, and a few questions to start with. */
  private renderEmpty(thread: HTMLElement, kind: SuggestionKind): void {
    const empty = thread.createDiv({ cls: "goodobsidian-chat-empty" });
    setIcon(empty.createDiv({ cls: "goodobsidian-chat-empty-icon" }), "sparkles");
    const title = {
      none: t("ai.ask.emptyNone"),
      one: t("ai.ask.emptyOne"),
      many: t("ai.ask.emptyMany"),
      screen: t("ai.ask.emptyScreen"),
      file: t("ai.ask.emptyFile"),
    };
    const subject = this.host.subject;
    empty.createDiv({
      cls: "goodobsidian-chat-empty-title",
      text: subject ? subject.empty : title[kind],
    });
    const choices = subject ? subject.suggestions : suggestions(kind);
    if (choices.length === 0) return;
    const chips = empty.createDiv({ cls: "goodobsidian-chat-suggestions" });
    for (const text of choices) {
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
      const label = tn("ai.ask.pageList", pages.length, { list: pages.join(", ") });
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
    typing.setAttribute("aria-label", t("ai.ask.thinking"));
    for (let i = 0; i < 3; i++) typing.createSpan({ cls: "goodobsidian-chat-dot" });
    body.createDiv({ cls: "goodobsidian-chat-status", text: status });
  }

  private errorRow(parent: HTMLElement, question: string, message: string): void {
    const { row, body } = this.aiRow(parent);
    row.addClass("is-error");
    body.createDiv({
      cls: "goodobsidian-chat-error",
      text: t("ai.ask.couldNotAnswer", { message }),
    });
    const retry = body.createEl("button", { cls: "goodobsidian-chat-action clickable-icon" });
    setIcon(retry.createSpan(), "rotate-ccw");
    retry.createSpan({ text: t("common.retry") });
    retry.addEventListener("click", () => this.submit(question));
  }

  private answerRow(
    parent: HTMLElement,
    markdown: string,
    done?: readonly string[],
    usage?: AskUsage,
    changes?: readonly (number | null)[],
  ): HTMLElement {
    const { row, body } = this.aiRow(parent);
    // What Claude did in the notebook on the way to the answer; what changed
    // the notebook can be taken back from here, however much was done since.
    if (done?.length) {
      const list = body.createDiv({ cls: "goodobsidian-chat-done" });
      done.forEach((action, i) => {
        const item = list.createDiv({ cls: "goodobsidian-chat-done-item" });
        setIcon(item.createSpan({ cls: "goodobsidian-chat-done-mark" }), "check");
        item.createSpan({ cls: "goodobsidian-chat-done-text", text: action });
        const id = changes?.[i] ?? null;
        if (id === null || !this.host.changes) return;
        const button = item.createEl("button", {
          cls: "goodobsidian-chat-done-undo clickable-icon",
        });
        button.addEventListener("click", () => this.host.changes?.toggle(id));
        this.changeRows.set(id, { item, button });
      });
    }
    const text = body.createDiv({ cls: "goodobsidian-chat-markdown markdown-rendered" });
    if (this.component) {
      void MarkdownRenderer.render(
        this.app,
        markdown,
        text,
        this.host.sourcePath,
        this.component,
      ).then(() => this.showDrawings(text));
    } else {
      text.setText(markdown);
    }
    // A note the answer links to (one it read, or one it wrote) opens in a tab beside the notebook.
    text.addEventListener("click", (event) => {
      // A handbook link (finenotes_help) opens its tip or switch here, not through the system.
      const own = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>(
        'a[href^="obsidian://finenotes"]',
      );
      if (own && this.host.openAppLink) {
        event.preventDefault();
        this.host.openAppLink(own.href);
        return;
      }
      const link = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>(
        "a.internal-link",
      );
      const target = link?.getAttribute("data-href") ?? link?.getAttribute("href");
      if (!link || !target) return;
      event.preventDefault();
      void this.app.workspace.openLinkText(target, this.host.sourcePath, "tab");
    });

    const actions = body.createDiv({ cls: "goodobsidian-chat-actions" });
    const copy = actions.createEl("button", { cls: "goodobsidian-chat-action clickable-icon" });
    setIcon(copy.createSpan(), "copy");
    copy.createSpan({ text: t("common.copy") });
    copy.addEventListener("click", () => {
      void writeSystemText(markdown).then(
        () => new Notice(t("ai.ask.copied")),
        () => new Notice(t("ai.ask.clipboardFailed")),
      );
    });

    const insert = actions.createEl("button", { cls: "goodobsidian-chat-action clickable-icon" });
    setIcon(insert.createSpan(), "text-cursor-input");
    insert.createSpan({ text: t("ai.ask.insertText") });
    insert.addEventListener("click", () => {
      if (this.host.insert(markdownToPlainText(markdown))) {
        new Notice(t("ai.ask.insertedText"));
      }
    });

    // What the answer cost, as a mark: the numbers behind it in its tooltip.
    const mark = this.host.showCost?.()
      ? usageMark(usage, (count) => t("ai.ask.tokens", { count }))
      : null;
    if (mark && usage) {
      actions.createSpan({
        cls: "goodobsidian-chat-cost",
        text: mark,
        attr: {
          "aria-label": t("ai.ask.costTip", {
            input: (usage.input + usage.cacheRead + usage.cacheWrite).toLocaleString(),
            output: usage.output.toLocaleString(),
          }),
        },
      });
    }
    return row;
  }

  /**
   * An answer's ```svg code blocks, drawn as pictures with an "Insert on
   * page" button. Drawn through an `<img>`, so nothing in the SVG runs.
   */
  private showDrawings(container: HTMLElement): void {
    for (const code of Array.from(container.querySelectorAll<HTMLElement>("pre > code"))) {
      if (!/\blanguage-svg\b/.test(code.className)) continue;
      const svg = code.textContent?.trim() ?? "";
      const pre = code.parentElement;
      if (!pre?.parentElement || !/^(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(svg)) continue;
      const figure = pre.parentElement.createDiv({ cls: "goodobsidian-chat-figure" });
      pre.replaceWith(figure);
      figure.createEl("img", {
        cls: "goodobsidian-chat-figure-img",
        attr: {
          alt: t("ai.ask.drawingAlt"),
          src: `data:image/svg+xml;base64,${bytesToBase64(new TextEncoder().encode(svg))}`,
        },
      });
      const insert = figure.createEl("button", {
        cls: "goodobsidian-chat-action clickable-icon",
      });
      setIcon(insert.createSpan(), "image-plus");
      insert.createSpan({ text: t("ai.ask.insertDrawing") });
      insert.addEventListener("click", () => {
        void this.host.insertDrawing(svg).then((placed) => {
          if (placed) new Notice(t("ai.ask.insertedDrawing"));
        });
      });
    }
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

/** Where the chat is shown: a window over the notebook, or a sidebar beside the page. */
export type AskLayout = "window" | "sidebar";

/** The frame an `AskChat` is drawn in, and what it can ask of it. */
export interface AskChatFrame {
  /** The window or the panel; carries `goodobsidian-ask-frame`. */
  el: HTMLElement;
  /** The "Ask" title, which the reach pill follows. */
  title: HTMLElement;
  /** Where the chat's own elements go. */
  content: HTMLElement;
  keyboard: DialogKeyboard;
  layout: AskLayout;
  /** Show the same chat in the other layout. */
  switchLayout: () => void;
}

/** The chat as a window over the notebook. */
export class AskAiModal extends Modal {
  private chat: AskChat | null = null;

  constructor(
    app: App,
    private readonly host: AskAiHost,
    private readonly switchLayout: () => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.modalEl.addClass(
      "goodobsidian-ask-modal",
      "goodobsidian-dialog",
      "goodobsidian-ask-frame",
    );
    this.titleEl.setText(t("ai.ask.title"));
    // A row, so the reach pill sits right of the title.
    this.titleEl.addClass("goodobsidian-ask-title");
    this.contentEl.empty();
    this.chat = new AskChat(this.app, this.host, {
      el: this.modalEl,
      title: this.titleEl,
      content: this.contentEl,
      keyboard: new DialogKeyboard(this.modalEl, { fit: true }),
      layout: "window",
      switchLayout: () => {
        this.close();
        this.switchLayout();
      },
    });
    this.chat.mount();
  }

  override onClose(): void {
    this.chat?.destroy();
    this.chat = null;
    this.contentEl.empty();
  }
}

/**
 * The chat as a sidebar beside the page, as Goodnotes shows its AI: the page
 * stays in view and can be written on while the chat is open. It takes the
 * left of the notebook's body, so it and the page sidebar are never open
 * together (the view closes one when the other opens).
 *
 * On the iPad the keyboard covers its lower part: `DialogKeyboard` with `pad`
 * pads the panel's foot by the part the keyboard covers, so the field rises
 * above it and the thread gets shorter.
 */
export class AskChatPanel {
  readonly el: HTMLElement;
  private chat: AskChat | null = null;

  constructor(
    private readonly app: App,
    parent: HTMLElement,
    private readonly callbacks: {
      host: () => AskAiHost;
      onClose: () => void;
      switchLayout: () => void;
    },
  ) {
    this.el = parent.createDiv({ cls: "goodobsidian-chatpanel goodobsidian-ask-frame is-hidden" });
  }

  get isOpen(): boolean {
    return !this.el.hasClass("is-hidden");
  }

  open(): void {
    if (this.isOpen) return;
    this.el.empty();
    const head = this.el.createDiv({ cls: "goodobsidian-chatpanel-head" });
    const title = head.createDiv({ cls: "goodobsidian-chatpanel-title", text: t("ai.ask.title") });
    const close = head.createEl("button", {
      cls: "goodobsidian-chatpanel-close clickable-icon",
      attr: { "aria-label": t("common.close") },
    });
    setIcon(close, "x");
    close.addEventListener("click", () => this.callbacks.onClose());
    const content = this.el.createDiv({ cls: "goodobsidian-chatpanel-body" });
    this.el.removeClass("is-hidden");
    this.chat = new AskChat(this.app, this.callbacks.host(), {
      el: this.el,
      title,
      content,
      keyboard: new DialogKeyboard(this.el, { pad: true }),
      layout: "sidebar",
      switchLayout: () => this.callbacks.switchLayout(),
    });
    this.chat.mount();
  }

  close(): void {
    if (!this.isOpen) return;
    this.chat?.destroy();
    this.chat = null;
    this.el.empty();
    this.el.addClass("is-hidden");
  }

  destroy(): void {
    this.close();
    this.el.remove();
  }
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
    this.setPlaceholder(t("ai.ask.vaultPlaceholder"));
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
