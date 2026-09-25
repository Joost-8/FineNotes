/**
 * "Ask about this page / notebook": a question field, the scope, and the
 * conversation so far, with each answer rendered as markdown and two actions
 * on it — Copy, and Insert as text box (an undoable command on the page).
 *
 * Follow-up questions continue the same conversation. The history lives in
 * this modal and dies with it; the page images are rendered once, for the
 * first question, and resent with every follow-up because the APIs keep no
 * state between requests. Changing the scope starts a new conversation.
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

export class AskAiModal extends Modal {
  private askScope: AskScope;
  private turns: ChatTurn[] = [];
  private busy = false;
  private closed = false;
  /** Owns the markdown render children of every answer; unloaded on close. */
  private component: Component | null = null;

  private threadEl: HTMLElement | null = null;
  private noteEl: HTMLElement | null = null;
  private input: HTMLTextAreaElement | null = null;
  private askButton: HTMLButtonElement | null = null;
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
    this.titleEl.setText("Ask AI");
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("goodobsidian-ask");

    if (this.host.multiPage) {
      const seg = contentEl.createDiv({ cls: "goodobsidian-segmented" });
      for (const { id, label } of SCOPES) {
        const button = seg.createEl("button", { cls: "clickable-icon", text: label });
        button.addEventListener("click", () => this.setScope(id));
        this.scopeButtons.set(id, button);
      }
    }
    this.noteEl = contentEl.createDiv({ cls: "goodobsidian-ask-note" });
    this.threadEl = contentEl.createDiv({ cls: "goodobsidian-ask-thread" });

    const composer = contentEl.createDiv({ cls: "goodobsidian-ask-composer" });
    this.input = composer.createEl("textarea", { cls: "goodobsidian-ask-input" });
    this.input.placeholder = "Ask a question about your notes…";
    this.input.rows = 3;
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void this.submit();
      }
    });
    const actions = composer.createDiv({ cls: "goodobsidian-ask-actions" });
    this.askButton = actions.createEl("button", { cls: "mod-cta", text: "Ask" });
    this.askButton.addEventListener("click", () => void this.submit());

    this.syncScope();
    window.setTimeout(() => this.input?.focus(), 0);
  }

  override onClose(): void {
    this.closed = true;
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
    this.turns = [];
    this.threadEl?.empty();
    this.syncScope();
  }

  private syncScope(): void {
    for (const [id, button] of this.scopeButtons) {
      button.toggleClass("is-active", id === this.askScope);
      button.setAttribute("aria-pressed", String(id === this.askScope));
    }
    this.noteEl?.setText(this.host.describe(this.askScope));
    this.askButton?.setText(this.turns.length > 0 ? "Ask follow-up" : "Ask");
  }

  private async submit(): Promise<void> {
    const question = this.input?.value.trim() ?? "";
    if (!question || this.busy || !this.threadEl) return;
    this.busy = true;
    this.setBusy(true);

    const questionEl = this.threadEl.createDiv({
      cls: "goodobsidian-ask-question",
      text: question,
    });
    const answerEl = this.threadEl.createDiv({ cls: "goodobsidian-ask-answer is-pending" });
    answerEl.setText(this.turns.length === 0 ? "Preparing the pages…" : "Thinking…");
    answerEl.scrollIntoView({ block: "nearest" });

    try {
      if (!(await this.host.confirm())) {
        questionEl.remove();
        answerEl.remove();
        return;
      }
      let turn: ChatTurn;
      if (this.turns.length === 0) {
        const pages = await this.host.prepare(this.askScope);
        if (this.closed) return;
        if (pages.images.length === 0) throw new Error("there is nothing on these pages to send.");
        turn = buildAskFirstTurn(question, pages.images, pages.pageNumbers, pages.totalPages);
        answerEl.setText("Thinking…");
      } else {
        turn = { role: "user", text: question };
      }
      const answer = await this.host.ask([...this.turns, turn]);
      if (this.closed) return;
      // Only a question that was answered joins the history, so a failed one
      // can simply be asked again.
      this.turns.push(turn, { role: "assistant", text: answer });
      if (this.input) this.input.value = "";
      await this.renderAnswer(answerEl, answer);
    } catch (error) {
      if (this.closed) return;
      const message = errorMessage(error);
      answerEl.removeClass("is-pending");
      answerEl.addClass("is-error");
      answerEl.setText(`Could not answer: ${message}`);
      new Notice(`FineNotes: ${message}`, 8000);
    } finally {
      this.busy = false;
      if (!this.closed) {
        this.setBusy(false);
        this.syncScope();
      }
    }
  }

  private setBusy(busy: boolean): void {
    if (this.askButton) this.askButton.disabled = busy;
    for (const button of this.scopeButtons.values()) button.disabled = busy;
  }

  private async renderAnswer(el: HTMLElement, markdown: string): Promise<void> {
    el.empty();
    el.removeClass("is-pending");
    const body = el.createDiv({ cls: "goodobsidian-ask-markdown markdown-rendered" });
    if (this.component) {
      await MarkdownRenderer.render(this.app, markdown, body, this.host.sourcePath, this.component);
    } else {
      body.setText(markdown);
    }

    const actions = el.createDiv({ cls: "goodobsidian-ask-answer-actions" });
    const copy = actions.createEl("button", { cls: "goodobsidian-ask-action clickable-icon" });
    setIcon(copy.createSpan(), "copy");
    copy.createSpan({ text: "Copy" });
    copy.addEventListener("click", () => {
      void navigator.clipboard.writeText(markdown).then(
        () => new Notice("Answer copied."),
        () => new Notice("FineNotes could not use the clipboard here."),
      );
    });

    const insert = actions.createEl("button", { cls: "goodobsidian-ask-action clickable-icon" });
    setIcon(insert.createSpan(), "text-cursor-input");
    insert.createSpan({ text: "Insert as text box" });
    insert.addEventListener("click", () => {
      if (this.host.insert(markdownToPlainText(markdown))) {
        new Notice("Answer added to the page as a text box. Undo removes it.");
      }
    });
  }
}
