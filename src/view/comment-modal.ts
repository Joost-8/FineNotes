/**
 * A comment on a page: writing a new one (the press menu's Comment), or
 * reading one whose marker was tapped, with Resolve (or Reopen), Delete and
 * Save for an edit.
 *
 *   Comment · from the AI · 17 Oct, 21:40
 *   [ Step 3: the sign flips here.        ]
 *   [Delete]            [Resolve] [Save]
 *
 * It only hands back what the user chose; the host applies it as an
 * undoable command (`model/comments.ts`).
 */

import { type App, Modal } from "obsidian";
import { MAX_COMMENT_LENGTH } from "../model/comments";
import type { PageComment } from "../model/document";
import { DialogKeyboard } from "./dialog-keyboard";

export interface CommentModalActions {
  /** Save the text: a new comment's, or an edit. */
  save: (text: string) => void;
  /** Resolve or reopen; only for an existing comment. */
  resolve?: (resolved: boolean) => void;
  /** Delete; only for an existing comment. */
  remove?: () => void;
}

export class CommentModal extends Modal {
  private readonly keyboard: DialogKeyboard;

  constructor(
    app: App,
    /** The comment to show; null to write a new one. */
    private readonly comment: PageComment | null,
    /** 1-based page the comment is on, for the title. */
    private readonly pageNumber: number,
    private readonly actions: CommentModalActions,
  ) {
    super(app);
    this.keyboard = new DialogKeyboard(this.modalEl);
  }

  override onOpen(): void {
    const comment = this.comment;
    this.modalEl.addClass("goodobsidian-dialog", "goodobsidian-comment-modal");
    this.titleEl.setText(comment ? "Comment" : `New comment on page ${this.pageNumber}`);
    const body = this.contentEl;
    body.addClass("goodobsidian-ask");
    if (comment) {
      const by = comment.author === "ai" ? "From the AI" : "Yours";
      const when = comment.created > 0 ? ` · ${new Date(comment.created).toLocaleString()}` : "";
      const state = comment.resolved ? " · Resolved" : "";
      body.createDiv({
        cls: "goodobsidian-ask-note",
        text: `${by} · page ${this.pageNumber}${when}${state}`,
      });
    }
    const field = body.createEl("textarea", {
      cls: "goodobsidian-ask-input goodobsidian-comment-field",
      attr: {
        "aria-label": "Comment",
        placeholder: "What is this about?",
        maxlength: String(MAX_COMMENT_LENGTH),
      },
    });
    field.value = comment?.text ?? "";
    this.keyboard.watch(field, field);

    const actions = body.createDiv({
      cls: "goodobsidian-ask-actions goodobsidian-comment-actions",
    });
    if (comment && this.actions.remove) {
      const remove = actions.createEl("button", {
        cls: "goodobsidian-comment-delete clickable-icon",
        text: "Delete",
      });
      remove.addEventListener("click", () => {
        this.actions.remove?.();
        this.close();
      });
    }
    if (comment && this.actions.resolve) {
      const resolved = comment.resolved === true;
      const toggle = actions.createEl("button", {
        cls: "clickable-icon",
        text: resolved ? "Reopen" : "Resolve",
      });
      toggle.addEventListener("click", () => {
        this.saveIfChanged(field.value);
        this.actions.resolve?.(!resolved);
        this.close();
      });
    }
    const save = actions.createEl("button", {
      cls: "mod-cta clickable-icon",
      text: comment ? "Save" : "Add",
    });
    const sync = (): void => {
      save.disabled = !field.value.trim();
    };
    sync();
    field.addEventListener("input", sync);
    save.addEventListener("click", () => {
      if (!field.value.trim()) return;
      if (comment) this.saveIfChanged(field.value);
      else this.actions.save(field.value);
      this.close();
    });
    // A new comment is for typing; an existing one is first for reading.
    if (!comment) window.setTimeout(() => field.focus(), 0);
  }

  override onClose(): void {
    this.keyboard.end();
    this.contentEl.empty();
  }

  private saveIfChanged(text: string): void {
    if (this.comment && text.trim() && text.trim() !== this.comment.text) this.actions.save(text);
  }
}
