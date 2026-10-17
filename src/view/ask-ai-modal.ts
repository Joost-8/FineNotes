/**
 * "Ask about this page / notebook", laid out as a chat: the scope on top, the
 * conversation in the middle (your questions as bubbles on the right, the
 * answers rendered as markdown on the left, each with Copy and Insert as text
 * box), and the question field at the bottom with a round send button.
 * Before the first question, suggestions fill the empty thread.
 *
 * Follow-up questions continue the same conversation. The history lives in
 * this modal and dies with it; the page images are rendered once, for the
 * first question, and resent with every follow-up because the APIs keep no
 * state between requests. Changing the scope, or New chat, starts over.
 *
 * On the iPad the field sits at the bottom of a tall dialog, under the
 * keyboard: `DialogKeyboard` with `fit` shrinks the dialog to the room above
 * the keyboard and lifts it there, so the thread gets shorter and the field
 * stays in view.
 *
 * Everything that touches the note or the network is the host's (`AskAiHost`),
 * so this file is only the conversation's UI.
 */

import { type App, Component, MarkdownRenderer, Modal, Notice, setIcon } from "obsidian";
import {
  type AskScope,
  type ChatImage,
  type ChatTurn,
  buildAskFirstTurn,
  markdownToPlainText,
} from "../recognition/ai-chat";
import { errorMessage } from "../util/errors";
import { DialogKeyboard } from "./dialog-keyboard";
import { writeSystemText } from "./system-clipboard";

export interface AskPages {
  images: ChatImage[];
  /** 1-based, in the same order as `images`. */
  pageNumbers: number[];
  totalPages: number;
}

export interface AskAiHost {
  scope: AskScope;
  /** Offer the notebook scope at all (more than one page). */
  multiPage: boolean;
  /** Markdown links in answers resolve against this note. */
  sourcePath: string;
  /** One line under the scope: what a question sends, and where. */
  describe: (scope: AskScope) => string;
  /** The one-time consent. False = the user declined. */
  confirm: () => Promise<boolean>;
  /** Render the pages a question about `scope` sends. */
  prepare: (scope: AskScope) => Promise<AskPages>;
  /** Send the conversation; resolves to the answer's markdown. */
  ask: (turns: readonly ChatTurn[]) => Promise<string>;
  /** Place `text` on the page being read; true when it was placed. */
  insert: (text: string) => boolean;
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
  private askScope: AskScope;
  private turns: ChatTurn[] = [];
  private busy = false;
  private closed = false;
  /** Owns the markdown render children of every answer; unloaded on close. */
  private component: Component | null = null;
  private keyboard: DialogKeyboard | null = null;

  private threadEl: HTMLElement | null = null;
  private noteEl: HTMLElement | null = null;
  private input: HTMLTextAreaElement | null = null;
  private sendButton: HTMLButtonElement | null = null;
  private newChatButton: HTMLButtonElement | null = null;
  private readonly scopeButtons = new Map<AskScope, HTMLButtonElement>();

  constructor(
    app: App,
    private readonly host: AskAiHost,
  ) {
    super(app);
    this.askScope = host.multiPage ? host.scope : "page";
  }

  override onOpen(): void {
    this.closed = false;
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
    this.newChatButton = top.createEl("button", {
      cls: "goodobsidian-chat-new clickable-icon",
      attr: { "aria-label": "New chat" },
    });
    setIcon(this.newChatButton.createSpan(), "square-pen");
    this.newChatButton.createSpan({ text: "New chat" });
    this.newChatButton.addEventListener("click", () => this.newChat());

    this.noteEl = contentEl.createDiv({ cls: "goodobsidian-chat-note" });
    this.threadEl = contentEl.createDiv({ cls: "goodobsidian-chat-thread" });

    const composer = contentEl.createDiv({ cls: "goodobsidian-chat-composer" });
    const input = composer.createEl("textarea", { cls: "goodobsidian-chat-input" });
    this.input = input;
    input.placeholder = "Ask about your notes…";
    input.rows = 1;
    input.addEventListener("input", () => this.syncInput());
    input.addEventListener("keydown", (event) => {
      // Return sends, as in any chat; Shift+Return is a new line. Not while
      // an input method is still composing a character.
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        void this.submit();
      }
    });
    this.sendButton = composer.createEl("button", {
      cls: "goodobsidian-chat-send clickable-icon",
      attr: { "aria-label": "Send" },
    });
    setIcon(this.sendButton, "arrow-up");
    this.sendButton.addEventListener("click", () => void this.submit());
    this.keyboard.watch(input, composer);

    this.renderEmpty();
    this.syncScope();
    this.syncInput();
    window.setTimeout(() => this.input?.focus(), 0);
  }

  override onClose(): void {
    this.closed = true;
    this.keyboard?.end();
    this.keyboard = null;
    this.component?.unload();
    this.component = null;
    this.turns = [];
    this.contentEl.empty();
  }

  private setScope(scope: AskScope): void {
    if (scope === this.askScope || this.busy) return;
    this.askScope = scope;
    // The first question's images define the conversation; a new scope needs
    // new images, so it is a new conversation.
    this.newChat();
  }

  private newChat(): void {
    if (this.busy) return;
    this.turns = [];
    this.renderEmpty();
    this.syncScope();
    this.input?.focus();
  }

  private syncScope(): void {
    for (const [id, button] of this.scopeButtons) {
      button.toggleClass("is-active", id === this.askScope);
      button.setAttribute("aria-pressed", String(id === this.askScope));
    }
    this.noteEl?.setText(this.host.describe(this.askScope));
    this.newChatButton?.toggleClass("is-hidden", this.turns.length === 0);
    if (this.input) {
      this.input.placeholder = this.turns.length > 0 ? "Ask a follow-up…" : "Ask about your notes…";
    }
  }

  /** Grow the field with its text, up to a few lines, and enable Send when there is a question. */
  private syncInput(): void {
    const input = this.input;
    if (!input) return;
    input.setCssProps({ "--goodobsidian-chat-input-h": "auto" });
    const height = Math.min(INPUT_MAX_PX, input.scrollHeight);
    input.setCssProps({ "--goodobsidian-chat-input-h": `${height}px` });
    input.toggleClass("is-scrolling", input.scrollHeight > INPUT_MAX_PX);
    if (this.sendButton) this.sendButton.disabled = this.busy || !input.value.trim();
    // A taller field moves its top: keep it above the keyboard.
    this.keyboard?.update();
  }

  /** The thread before the first question: what this is, and a few questions to start with. */
  private renderEmpty(): void {
    const thread = this.threadEl;
    if (!thread) return;
    thread.empty();
    const empty = thread.createDiv({ cls: "goodobsidian-chat-empty" });
    setIcon(empty.createDiv({ cls: "goodobsidian-chat-empty-icon" }), "sparkles");
    empty.createDiv({
      cls: "goodobsidian-chat-empty-title",
      text: this.askScope === "page" ? "Ask about this page" : "Ask about this notebook",
    });
    const chips = empty.createDiv({ cls: "goodobsidian-chat-suggestions" });
    for (const text of SUGGESTIONS[this.askScope]) {
      const chip = chips.createEl("button", { cls: "goodobsidian-chat-suggestion clickable-icon" });
      chip.setText(text);
      chip.addEventListener("click", () => void this.submit(text));
    }
  }

  private async submit(asked?: string): Promise<void> {
    const question = (asked ?? this.input?.value ?? "").trim();
    const thread = this.threadEl;
    if (!question || this.busy || !thread) return;
    this.busy = true;
    this.setBusy(true);
    if (this.turns.length === 0) thread.empty();
    // Cleared at once, as in any chat; put back if the question fails.
    const typed = asked === undefined;
    if (typed && this.input) {
      this.input.value = "";
      this.syncInput();
    }

    const questionEl = thread.createDiv({ cls: "goodobsidian-chat-msg is-user" });
    questionEl.createDiv({ cls: "goodobsidian-chat-bubble", text: question });
    const answerEl = this.answerShell();
    const status = this.pending(answerEl, this.turns.length === 0 ? "Reading the pages…" : "");
    this.scrollToEnd();

    try {
      if (!(await this.host.confirm())) {
        questionEl.remove();
        answerEl.remove();
        this.restore(question, typed);
        if (this.turns.length === 0) this.renderEmpty();
        return;
      }
      let turn: ChatTurn;
      if (this.turns.length === 0) {
        const pages = await this.host.prepare(this.askScope);
        if (this.closed) return;
        if (pages.images.length === 0) throw new Error("there is nothing on these pages to send.");
        turn = buildAskFirstTurn(question, pages.images, pages.pageNumbers, pages.totalPages);
        status.setText("");
      } else {
        turn = { role: "user", text: question };
      }
      const answer = await this.host.ask([...this.turns, turn]);
      if (this.closed) return;
      // Only a question that was answered joins the history, so a failed one
      // can simply be asked again.
      this.turns.push(turn, { role: "assistant", text: answer });
      await this.renderAnswer(answerEl, answer);
      this.scrollToAnswer(answerEl);
    } catch (error) {
      if (this.closed) return;
      const message = errorMessage(error);
      this.renderError(answerEl, questionEl, question, message);
      this.restore(question, typed);
      this.scrollToEnd();
    } finally {
      this.busy = false;
      if (!this.closed) {
        this.setBusy(false);
        this.syncScope();
        this.syncInput();
      }
    }
  }

  /** Put a failed question back in the field, unless something new was typed meanwhile. */
  private restore(question: string, typed: boolean): void {
    if (!typed || !this.input || this.input.value.trim()) return;
    this.input.value = question;
    this.syncInput();
  }

  private setBusy(busy: boolean): void {
    this.modalEl.toggleClass("is-busy", busy);
    if (this.sendButton) this.sendButton.disabled = busy || !this.input?.value.trim();
    if (this.newChatButton) this.newChatButton.disabled = busy;
    for (const button of this.scopeButtons.values()) button.disabled = busy;
    for (const chip of this.threadEl?.querySelectorAll("button") ?? []) chip.disabled = busy;
  }

  /** An answer's row: the assistant's mark and an empty body. */
  private answerShell(): HTMLElement {
    const row = this.threadEl!.createDiv({ cls: "goodobsidian-chat-msg is-ai" });
    setIcon(row.createDiv({ cls: "goodobsidian-chat-avatar" }), "sparkles");
    row.createDiv({ cls: "goodobsidian-chat-body" });
    return row;
  }

  /** Three bouncing dots, and what is happening when there is something to say. */
  private pending(answerEl: HTMLElement, text: string): HTMLElement {
    const body = answerEl.querySelector<HTMLElement>(".goodobsidian-chat-body")!;
    const typing = body.createDiv({ cls: "goodobsidian-chat-typing" });
    typing.setAttribute("aria-label", "Thinking");
    for (let i = 0; i < 3; i++) typing.createSpan({ cls: "goodobsidian-chat-dot" });
    return body.createDiv({ cls: "goodobsidian-chat-status", text });
  }

  private renderError(
    answerEl: HTMLElement,
    questionEl: HTMLElement,
    question: string,
    message: string,
  ): void {
    const body = answerEl.querySelector<HTMLElement>(".goodobsidian-chat-body")!;
    body.empty();
    answerEl.addClass("is-error");
    body.createDiv({ cls: "goodobsidian-chat-error", text: `Could not answer: ${message}` });
    const retry = body.createEl("button", { cls: "goodobsidian-chat-action clickable-icon" });
    setIcon(retry.createSpan(), "rotate-ccw");
    retry.createSpan({ text: "Try again" });
    retry.addEventListener("click", () => {
      if (this.busy) return;
      questionEl.remove();
      answerEl.remove();
      if (this.input?.value.trim() === question) {
        this.input.value = "";
        this.syncInput();
      }
      void this.submit(question);
    });
  }

  private async renderAnswer(answerEl: HTMLElement, markdown: string): Promise<void> {
    const body = answerEl.querySelector<HTMLElement>(".goodobsidian-chat-body")!;
    body.empty();
    const text = body.createDiv({ cls: "goodobsidian-chat-markdown markdown-rendered" });
    if (this.component) {
      await MarkdownRenderer.render(this.app, markdown, text, this.host.sourcePath, this.component);
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
    const fromTop = answerEl.offsetTop - 8;
    thread.scrollTop = Math.min(fromTop, thread.scrollHeight);
  }
}
