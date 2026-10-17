/**
 * Comments pinned to a page (`PageComment`): reading them from a file, a new
 * id, and the commands that add, resolve, edit and remove one, each one undo
 * step.
 *
 * A comment is held by identity, as tables are (ids repeat in hand-edited
 * notes), and every inverse puts back exactly what it changed.
 *
 * Pure: no DOM, no Obsidian.
 */

import type { Command } from "./commands";
import { type InkDocument, type PageComment, pageById } from "./document";

/** Longest comment kept, characters; a longer one is cut. */
export const MAX_COMMENT_LENGTH = 2000;

/** A comment id not yet used anywhere in `doc`: one above the highest `cm<N>`. */
export function nextCommentId(doc: InkDocument): string {
  let max = 0;
  for (const page of doc.pages) {
    for (const comment of page.comments ?? []) {
      const match = /^cm(\d+)$/.exec(comment.id);
      if (match) max = Math.max(max, Number(match[1]));
    }
  }
  return `cm${max + 1}`;
}

/**
 * A comment read from a file, or null when it is not one: it must point
 * somewhere and say something. A missing id is minted, unknown fields are
 * dropped, and anything but `"ai"` is the user's.
 */
export function normalizeComment(raw: unknown, mintId: () => string): PageComment | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.x !== "number" || !Number.isFinite(r.x)) return null;
  if (typeof r.y !== "number" || !Number.isFinite(r.y)) return null;
  const text = typeof r.text === "string" ? r.text.trim().slice(0, MAX_COMMENT_LENGTH) : "";
  if (!text) return null;
  const created =
    typeof r.created === "number" && Number.isFinite(r.created) && r.created >= 0
      ? Math.round(r.created)
      : 0;
  return {
    id: typeof r.id === "string" && r.id ? r.id : mintId(),
    x: r.x,
    y: r.y,
    text,
    author: r.author === "ai" ? "ai" : "you",
    created,
    ...(r.resolved === true ? { resolved: true as const } : {}),
  };
}

/** Pin a comment to a page. */
export class AddComment implements Command {
  readonly label = "Add comment";
  /** Whether the page had no `comments` list before, so undo leaves it without one. */
  private created = false;

  constructor(
    readonly pageId: string,
    private readonly comment: PageComment,
  ) {}

  apply(doc: InkDocument): void {
    const page = pageById(doc, this.pageId);
    if (!page) return;
    this.created = page.comments === undefined;
    (page.comments ??= []).push(this.comment);
  }

  invert(doc: InkDocument): void {
    const page = pageById(doc, this.pageId);
    const comments = page?.comments;
    if (!page || !comments) return;
    const index = comments.indexOf(this.comment);
    if (index >= 0) comments.splice(index, 1);
    if (this.created && comments.length === 0) delete page.comments;
  }
}

/** Take a comment off its page; undo puts it back where it was in the list. */
export class RemoveComment implements Command {
  readonly label = "Delete comment";
  private removed: { index: number } | null = null;

  constructor(
    readonly pageId: string,
    private readonly comment: PageComment,
  ) {}

  apply(doc: InkDocument): void {
    this.removed = null;
    const page = pageById(doc, this.pageId);
    const comments = page?.comments;
    if (!page || !comments) return;
    const index = comments.indexOf(this.comment);
    if (index < 0) return;
    comments.splice(index, 1);
    if (comments.length === 0) delete page.comments;
    this.removed = { index };
  }

  invert(doc: InkDocument): void {
    const page = pageById(doc, this.pageId);
    if (!page || !this.removed) return;
    const comments = (page.comments ??= []);
    comments.splice(Math.min(this.removed.index, comments.length), 0, this.comment);
    this.removed = null;
  }
}

/** Mark a comment resolved, or open it again. */
export class SetCommentResolved implements Command {
  readonly label: string;
  private before: boolean | null = null;

  constructor(
    readonly pageId: string,
    private readonly comment: PageComment,
    private readonly resolved: boolean,
  ) {
    this.label = resolved ? "Resolve comment" : "Reopen comment";
  }

  apply(doc: InkDocument): void {
    this.before = null;
    if (!onPage(doc, this.pageId, this.comment)) return;
    this.before = this.comment.resolved === true;
    setResolved(this.comment, this.resolved);
  }

  invert(doc: InkDocument): void {
    if (this.before === null || !onPage(doc, this.pageId, this.comment)) return;
    setResolved(this.comment, this.before);
    this.before = null;
  }
}

/** Change what a comment says. */
export class SetCommentText implements Command {
  readonly label = "Edit comment";
  private before: string | null = null;
  private readonly text: string;

  constructor(
    readonly pageId: string,
    private readonly comment: PageComment,
    text: string,
  ) {
    this.text = text.trim().slice(0, MAX_COMMENT_LENGTH);
  }

  apply(doc: InkDocument): void {
    this.before = null;
    if (!this.text || !onPage(doc, this.pageId, this.comment)) return;
    this.before = this.comment.text;
    this.comment.text = this.text;
  }

  invert(doc: InkDocument): void {
    if (this.before === null || !onPage(doc, this.pageId, this.comment)) return;
    this.comment.text = this.before;
    this.before = null;
  }
}

function onPage(doc: InkDocument, pageId: string, comment: PageComment): boolean {
  return pageById(doc, pageId)?.comments?.includes(comment) === true;
}

function setResolved(comment: PageComment, resolved: boolean): void {
  if (resolved) comment.resolved = true;
  else delete comment.resolved;
}
