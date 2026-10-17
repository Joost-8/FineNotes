/**
 * "Ask about this page / notebook", laid out as a chat: the scope and the
 * chat's controls on top (Save chat, Chats, New chat), the conversation in
 * the middle (your questions as bubbles on the right, the answers rendered as
 * markdown on the left, each with Copy and Insert as text box), and the
 * question field at the bottom with a round send button. Before the first
 * question, suggestions fill the empty thread.
 *
 * The conversation itself is an `AskSession` owned by the notebook's view:
 * this dialog only draws it. Closing the dialog loses nothing — reopened, it
 * shows the same chat, an answer that arrived meanwhile, and the draft.
 *
 * On the iPad the field sits at the bottom of a tall dialog, under the
 * keyboard: `DialogKeyboard` with `fit` shrinks the dialog to the room above
 * the keyboard and lifts it there, so the thread gets shorter and the field
 * stays in view.
 */

import { type App, Component, MarkdownRenderer, Menu, Modal, Notice, setIcon } from "obsidian";
import { type AskScope, markdownToPlainText } from "../recognition/ai-chat";
import { type AskSession, shownText } from "../recognition/ask-session";
import type { SavedChatEntry } from "./ask-chats-io";
import { DialogKeyboard } from "./dialog-keyboard";
import { writeSystemText } from "./system-clipboard";

export interface AskAiHost {
  session: AskSession;
  /** Offer the notebook scope at all (more than one page). */
  multiPage: boolean;
  /** Markdown links in answers resolve against this note. */
  sourcePath: string;
  /** One line under the scope: what a question sends, and where. */
  describe: (scope: AskScope) => string;
  /** Place `text` on the page being read; true when it was placed. */
  insert: (text: string) => boolean;
  /** This notebook's saved chats, newest first. */
  savedChats: () => Promise<SavedChatEntry[]>;
  /** Continue a saved chat in the session. */
  openSaved: (path: string) => Promise<void>;
  /** Remember "Save chat" for the next new chat. */
  rememberSave: (save: boolean) => void;
}

const SCOPES: ReadonlyArray<{ id: AskScope; label: string }> = [
  { id: "page", label: "This page" },
  { id: "notebook", label: "Whole notebook" },
];

/** What the empty thread offers to ask; a tap sends it. */
const SUGGESTIONS: Record<AskScope, readonly string[]> = {
  page: [
    "Summarise this page",
    "Explain this step by step",
    "Check my work for mistakes",
    "Quiz me on this page",
  ],
  notebook: [
    "Summarise these pages",
    "What are the key ideas?",
    "Make practice questions",
    "What should I review?",
  ],
};

/** Tallest the question field grows before it scrolls, px. */
const INPUT_MAX_PX = 160;

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
  private saveButton: HTMLButtonElement | null = null;
  private chatsButton: HTMLButtonElement | null = null;
  private newChatButton: HTMLButtonElement | null = null;
  private readonly scopeButtons = new Map<AskScope, HTMLButtonElement>();

  /** What the thread shows: each turn's text, in order, and the scope it is drawn for. */
  private shown: { scope: AskScope | null; texts: string[] } = { scope: null, texts: [] };
  /** The question waiting for its answer (or failed), drawn after the turns. */
  private outstandingEl: HTMLElement | null = null;
  private outstandingKey = "";

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
    this.titleEl.setText("Ask AI");
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("goodobsidian-chat");

    const top = contentEl.createDiv({ cls: "goodobsidian-chat-top" });
    if (this.host.multiPage) {
      const seg = top.createDiv({ cls: "goodobsidian-segmented goodobsidian-chat-scope" });
      for (const { id, label } of SCOPES) {
        const button = seg.createEl("button", { cls: "clickable-icon", text: label });
        button.addEventListener("click", () => this.setScope(id));
        this.scopeButtons.set(id, button);
      }
    }
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
      this.session.newChat();
      this.input?.focus();
    });

    this.noteEl = contentEl.createDiv({ cls: "goodobsidian-chat-note" });
    this.threadEl = contentEl.createDiv({ cls: "goodobsidian-chat-thread" });

    const composer = contentEl.createDiv({ cls: "goodobsidian-chat-composer" });
    const input = composer.createEl("textarea", { cls: "goodobsidian-chat-input" });
    this.input = input;
    input.rows = 1;
    input.value = this.session.draft;
    input.addEventListener("input", () => {
      this.session.draft = input.value;
      this.syncInput();
    });
    input.addEventListener("keydown", (event) => {
      // Return sends, as in any chat; Shift+Return is a new line. Not while
      // an input method is still composing a character.
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        this.submit();
      }
    });
    this.sendButton = composer.createEl("button", {
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

  private setScope(scope: AskScope): void {
    if (scope === this.session.scope || this.session.busy) return;
    // The first question's images define the conversation; a new scope needs
    // new images, so it is a new conversation.
    this.session.newChat(scope);
  }

  private submit(question?: string): void {
    const text = (question ?? this.input?.value ?? "").trim();
    if (!text || this.session.busy) return;
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
    for (const [id, button] of this.scopeButtons) {
      button.toggleClass("is-active", id === session.scope);
      button.setAttribute("aria-pressed", String(id === session.scope));
      button.disabled = busy;
    }
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
    if (this.chatsButton) this.chatsButton.disabled = busy;
    if (this.newChatButton) {
      this.newChatButton.disabled = busy;
      this.newChatButton.toggleClass(
        "is-hidden",
        session.turns.length === 0 && !session.outstanding,
      );
    }
    this.noteEl?.setText(
      this.host.describe(session.scope) +
        (saved ? " The chat is saved in the notebook's AI chats folder." : ""),
    );
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
      this.shown.scope === session.scope &&
      this.shown.texts.length <= texts.length &&
      this.shown.texts.every((text, i) => text === texts[i]);
    if (!same) {
      thread.empty();
      this.outstandingEl = null;
      this.outstandingKey = "";
      this.shown = { scope: session.scope, texts: [] };
    }
    const added = texts.length > this.shown.texts.length;
    // New turns go before the outstanding question, which is redrawn below.
    this.outstandingEl?.remove();
    this.outstandingEl = null;
    let lastAnswer: HTMLElement | null = null;
    for (let i = this.shown.texts.length; i < texts.length; i++) {
      const turn = session.turns[i];
      if (turn.role === "user") this.questionRow(thread, texts[i]);
      else lastAnswer = this.answerRow(thread, texts[i]);
    }
    this.shown.texts = texts;

    const empty = texts.length === 0 && !session.outstanding;
    if (empty) {
      if (!thread.querySelector(".goodobsidian-chat-empty")) this.renderEmpty(thread);
    } else {
      thread.querySelector(".goodobsidian-chat-empty")?.remove();
    }

    const outstanding = session.outstanding;
    const key = outstanding
      ? `${outstanding.question}\u0000${outstanding.status}\u0000${outstanding.error ?? ""}`
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
  private renderEmpty(thread: HTMLElement): void {
    const empty = thread.createDiv({ cls: "goodobsidian-chat-empty" });
    setIcon(empty.createDiv({ cls: "goodobsidian-chat-empty-icon" }), "sparkles");
    empty.createDiv({
      cls: "goodobsidian-chat-empty-title",
      text: this.session.scope === "page" ? "Ask about this page" : "Ask about this notebook",
    });
    const chips = empty.createDiv({ cls: "goodobsidian-chat-suggestions" });
    for (const text of SUGGESTIONS[this.session.scope]) {
      const chip = chips.createEl("button", { cls: "goodobsidian-chat-suggestion clickable-icon" });
      chip.setText(text);
      chip.addEventListener("click", () => this.submit(text));
    }
  }

  private questionRow(parent: HTMLElement, text: string): void {
    const row = parent.createDiv({ cls: "goodobsidian-chat-msg is-user" });
    row.createDiv({ cls: "goodobsidian-chat-bubble", text });
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
