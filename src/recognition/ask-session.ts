/**
 * One Ask AI conversation, owned by the notebook's view rather than the
 * dialog, so closing the dialog loses nothing: the chat, a question still
 * waiting for its answer, and the half-typed draft are all here when it opens
 * again. The dialog only draws this and listens for `onChange`.
 *
 * Saving is optional and can be switched either way at any time: on, the chat
 * is written to the notebook's AI chats folder after every answer; off, a file
 * it already wrote is removed. A saved chat can be loaded back; its first
 * question has no images then (they are not stored), so the next follow-up
 * renders the same pages again before it is sent.
 *
 * No DOM, no Obsidian, no network: everything with a side effect is a
 * dependency, so the whole conversation is testable.
 */

import { type AskScope, type ChatImage, type ChatTurn, buildAskFirstTurn } from "./ai-chat";
import type { SavedChat } from "./ask-chat-file";
import { errorMessage } from "../util/errors";

export interface AskPagesResult {
  images: ChatImage[];
  /** 1-based, in the same order as `images`. */
  pageNumbers: number[];
  totalPages: number;
}

export interface AskSessionDeps {
  /** The notebook's vault path, for a saved chat's link back. */
  notebookPath: () => string;
  /** The one-time consent. False = the user declined. */
  confirm: () => Promise<boolean>;
  /** Render the pages a question about `scope` sends. */
  prepare: (scope: AskScope) => Promise<AskPagesResult>;
  /** Render exactly these 1-based pages (a reloaded chat's follow-up). */
  preparePages: (pageNumbers: readonly number[]) => Promise<AskPagesResult>;
  /** Send the conversation; resolves to the answer's markdown. */
  ask: (turns: readonly ChatTurn[]) => Promise<string>;
  /** Write the chat; `path` is where it was written before (null the first time). Resolves to its path. */
  save: (chat: SavedChat, path: string | null) => Promise<string>;
  /** Remove a saved chat's file. */
  unsave: (path: string) => Promise<void>;
  now: () => Date;
}

/** A question sent and not yet answered, or one that failed. */
export interface AskOutstanding {
  question: string;
  /** What is happening, for the dots ("Reading the pages…"); "" while waiting for the answer. */
  status: string;
  /** Set when it failed. */
  error?: string;
}

export class AskSession {
  scope: AskScope;
  /** Oldest first; only answered questions are in it. */
  turns: ChatTurn[] = [];
  draft = "";
  outstanding: AskOutstanding | null = null;
  /** Whether this chat is to be kept in the AI chats folder. */
  save: boolean;
  /** Where it is saved, once written. */
  savedPath: string | null = null;
  /** The pages the first question sent, kept for saving and for reloading. */
  private pages: { pageNumbers: number[]; totalPages: number } | null = null;
  private created: string | null = null;
  /** Bumped by every new chat, so an answer to an old one is dropped. */
  private generation = 0;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly deps: AskSessionDeps,
    scope: AskScope,
    save: boolean,
  ) {
    this.scope = scope;
    this.save = save;
  }

  get busy(): boolean {
    return this.outstanding !== null && this.outstanding.error === undefined;
  }

  /** Call `listener` on every change; returns the unsubscribe. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    for (const listener of [...this.listeners]) listener();
  }

  /** Start over, optionally about another scope. The saved file of the old chat stays. */
  newChat(scope: AskScope = this.scope): void {
    if (this.busy) return;
    this.generation++;
    this.scope = scope;
    this.turns = [];
    this.outstanding = null;
    this.savedPath = null;
    this.pages = null;
    this.created = null;
    this.changed();
  }

  /** Continue a saved chat. */
  load(chat: SavedChat, path: string): void {
    if (this.busy) return;
    this.generation++;
    this.scope = chat.scope;
    this.turns = chat.turns.map((turn) => ({ role: turn.role, text: turn.text }));
    this.outstanding = null;
    this.save = true;
    this.savedPath = path;
    this.pages = { pageNumbers: [...chat.pageNumbers], totalPages: chat.totalPages };
    this.created = chat.created || null;
    this.changed();
  }

  /** Ask `question`; resolves once it is answered or has failed. */
  async send(question: string): Promise<void> {
    const text = question.trim();
    if (!text || this.busy) return;
    const generation = this.generation;
    const first = this.turns.length === 0;
    this.outstanding = { question: text, status: first ? "Reading the pages…" : "" };
    this.changed();
    const stale = (): boolean => generation !== this.generation;
    try {
      if (!(await this.deps.confirm())) {
        if (!stale()) {
          this.outstanding = null;
          this.changed();
        }
        return;
      }
      let history = this.turns;
      let turn: ChatTurn;
      if (first) {
        const pages = await this.deps.prepare(this.scope);
        if (stale()) return;
        if (pages.images.length === 0) throw new Error("there is nothing on these pages to send.");
        this.pages = { pageNumbers: pages.pageNumbers, totalPages: pages.totalPages };
        turn = {
          ...buildAskFirstTurn(text, pages.images, pages.pageNumbers, pages.totalPages),
          shown: text,
        };
        this.outstanding = { question: text, status: "" };
        this.changed();
      } else {
        history = await this.withImages();
        if (stale()) return;
        turn = { role: "user", text };
      }
      const answer = await this.deps.ask([...history, turn]);
      if (stale()) return;
      this.created ??= this.deps.now().toISOString();
      // Only a question that was answered joins the history, so a failed one
      // can simply be asked again.
      this.turns = [...history, turn, { role: "assistant", text: answer }];
      this.outstanding = null;
      this.changed();
      await this.persist();
    } catch (error) {
      if (stale()) return;
      this.outstanding = { question: text, status: "", error: errorMessage(error) };
      this.changed();
    }
  }

  /** Forget a failed question (its Try again resends it). */
  dismissError(): void {
    if (this.outstanding?.error === undefined) return;
    this.outstanding = null;
    this.changed();
  }

  /** Keep the chat in the AI chats folder, or stop keeping it (removing the file it wrote). */
  async setSave(save: boolean): Promise<void> {
    if (save === this.save) return;
    this.save = save;
    this.changed();
    if (save) {
      await this.persist();
    } else if (this.savedPath) {
      const path = this.savedPath;
      this.savedPath = null;
      this.changed();
      await this.deps.unsave(path);
    }
  }

  /** The chat as it would be saved, or null before its first answer. */
  snapshot(): SavedChat | null {
    if (this.turns.length === 0 || !this.pages) return null;
    return {
      notebook: this.deps.notebookPath(),
      scope: this.scope,
      pageNumbers: this.pages.pageNumbers,
      totalPages: this.pages.totalPages,
      created: this.created ?? this.deps.now().toISOString(),
      turns: this.turns.map((turn) => ({ role: turn.role, text: shownText(turn) })),
    };
  }

  private async persist(): Promise<void> {
    const chat = this.snapshot();
    if (!this.save || !chat) return;
    const generation = this.generation;
    const path = await this.deps.save(chat, this.savedPath);
    if (generation === this.generation && this.save) {
      this.savedPath = path;
      this.changed();
    }
  }

  /**
   * The history with its first question's images, rendering them again when
   * the chat was loaded from a file (which keeps no images).
   */
  private async withImages(): Promise<ChatTurn[]> {
    const [first, ...rest] = this.turns;
    if (!first || first.images?.length || !this.pages?.pageNumbers.length) return this.turns;
    const pages = await this.deps.preparePages(this.pages.pageNumbers);
    if (pages.images.length === 0) return this.turns;
    const question = shownText(first);
    const rebuilt = buildAskFirstTurn(question, pages.images, pages.pageNumbers, pages.totalPages);
    const withImages = [{ ...rebuilt, shown: question }, ...rest];
    this.turns = withImages;
    return withImages;
  }
}

/** A turn as the user sees it: the question as typed, or the answer. */
export function shownText(turn: ChatTurn): string {
  return turn.shown ?? turn.text;
}
