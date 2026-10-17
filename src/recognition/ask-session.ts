/**
 * One Ask AI conversation, owned by the notebook's view rather than the
 * dialog, so closing the dialog loses nothing: the chat, a question still
 * waiting for its answer, the half-typed draft and the pages picked are all
 * here when it opens again. The dialog only draws this and listens for
 * `onChange`.
 *
 * Pages: the user picks up to `ASK_MAX_PAGES`, starting with the page being
 * read. A question sends the images of the picked pages the conversation has
 * not seen yet, so pages can be added mid-chat; pages already sent stay in
 * the history.
 *
 * Saving is optional and can be switched either way at any time: on, the chat
 * is written to the notebook's AI chats folder after every answer; off, a file
 * it already wrote is removed. A saved chat can be loaded back; its questions
 * have no images then (they are not stored), so the next follow-up renders
 * the same pages again before it is sent.
 *
 * No DOM, no Obsidian, no network: everything with a side effect is a
 * dependency, so the whole conversation is testable.
 */

import {
  ASK_MAX_PAGES,
  type ChatFile,
  type ChatImage,
  type ChatTurn,
  buildAskFirstTurn,
} from "./ai-chat";
import { attachRefusal } from "./ask-attachments";
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
  /** Render these 1-based pages; pages with nothing on them are left out. */
  preparePages: (pageNumbers: readonly number[]) => Promise<AskPagesResult>;
  /**
   * Send the conversation; resolves to the answer's markdown and what was
   * done in the notebook on the way (Claude's tools). `onStatus` says what
   * is happening meanwhile ("Reading page 3…").
   */
  ask: (
    turns: readonly ChatTurn[],
    onStatus: (status: string) => void,
  ) => Promise<{ text: string; actions?: readonly string[] }>;
  /** Write the chat; `path` is where it was written before (null the first time). Resolves to its path. */
  save: (chat: SavedChat, path: string | null) => Promise<string>;
  /** Remove a saved chat's file. */
  unsave: (path: string) => Promise<void>;
  /** Read an attached file from the vault again (a reloaded chat's); null when it is gone. */
  readFile: (path: string) => Promise<ChatFile | null>;
  now: () => Date;
}

/** A question sent and not yet answered, or one that failed. */
export interface AskOutstanding {
  question: string;
  /** What is happening, for the dots ("Reading pages 2, 3…"); "" while waiting for the answer. */
  status: string;
  /** Set when it failed. */
  error?: string;
}

export class AskSession {
  /** Oldest first; only answered questions are in it. */
  turns: ChatTurn[] = [];
  draft = "";
  outstanding: AskOutstanding | null = null;
  /** Whether this chat is to be kept in the AI chats folder. */
  save: boolean;
  /** Where it is saved, once written. */
  savedPath: string | null = null;
  /** 1-based, ascending: the pages picked for the next question. */
  selected: number[];
  /** The notebook's page count, for the line naming the pages and for saving. */
  totalPages: number;
  /** Files attached to the next question. */
  attachments: ChatFile[] = [];
  /** The page picker's list of the notebook's PDFs was closed; it stays closed. */
  pdfListClosed = false;
  private created: string | null = null;
  /** Bumped by every new chat, so an answer to an old one is dropped. */
  private generation = 0;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly deps: AskSessionDeps,
    options: { page: number; totalPages: number; save: boolean },
  ) {
    this.selected = [options.page];
    this.totalPages = options.totalPages;
    this.save = options.save;
  }

  get busy(): boolean {
    return this.outstanding !== null && this.outstanding.error === undefined;
  }

  /** Nothing asked yet, and nothing on its way. */
  get empty(): boolean {
    return this.turns.length === 0 && this.outstanding === null;
  }

  /** 1-based pages whose images the conversation already has. */
  get sentPages(): Set<number> {
    return new Set(this.turns.flatMap((turn) => turn.pages ?? []));
  }

  /** Files the conversation already has. */
  get sentFiles(): ChatFile[] {
    return this.turns.flatMap((turn) => [...(turn.files ?? [])]);
  }

  /** Attach `file` to the next question; resolves to why it cannot be, or null once it is. */
  attach(file: ChatFile): string | null {
    const refusal = attachRefusal(file, [...this.attachments, ...this.sentFiles]);
    if (refusal) return refusal;
    this.attachments = [...this.attachments, file];
    this.changed();
    return null;
  }

  /** Take a file off the next question. */
  detach(file: ChatFile): void {
    const next = this.attachments.filter((f) => f !== file);
    if (next.length === this.attachments.length) return;
    this.attachments = next;
    this.changed();
  }

  /** Call `listener` on every change; returns the unsubscribe. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    for (const listener of [...this.listeners]) listener();
  }

  /**
   * Pick these pages (1-based) for the next question: in range, no repeats,
   * ascending, at most `ASK_MAX_PAGES` (the first ones given win).
   */
  setSelection(pages: readonly number[]): void {
    const valid = pages.filter((p) => Number.isInteger(p) && p >= 1 && p <= this.totalPages);
    const next = [...new Set(valid)].slice(0, ASK_MAX_PAGES).sort((a, b) => a - b);
    if (next.length === this.selected.length && next.every((p, i) => p === this.selected[i])) {
      return;
    }
    this.selected = next;
    this.changed();
  }

  /** Add or remove one page; adding past the limit does nothing. */
  togglePage(page: number): void {
    if (this.selected.includes(page)) {
      this.setSelection(this.selected.filter((p) => p !== page));
    } else if (this.selected.length < ASK_MAX_PAGES) {
      this.setSelection([...this.selected, page]);
    }
  }

  /** The notebook gained or lost pages: keep the selection in range. */
  setTotalPages(total: number): void {
    if (total === this.totalPages) return;
    this.totalPages = total;
    this.setSelection(this.selected);
  }

  /** Start over on `page`. The saved file of the old chat stays. */
  newChat(page: number): void {
    if (this.busy) return;
    this.generation++;
    this.turns = [];
    this.outstanding = null;
    this.savedPath = null;
    this.created = null;
    this.attachments = [];
    this.selected = page >= 1 && page <= this.totalPages ? [page] : [];
    this.changed();
  }

  /** Continue a saved chat. The pages its questions sent stay picked. */
  load(chat: SavedChat, path: string): void {
    if (this.busy) return;
    this.generation++;
    this.turns = chat.turns.map((turn) => ({
      role: turn.role,
      text: turn.text,
      ...(turn.pages?.length ? { pages: [...turn.pages] } : {}),
      // Names only, for now: the next question reads them again (`withImages`).
      ...(turn.files?.length
        ? { files: turn.files.map((f) => ({ name: f.name, mimeType: "", path: f.path })) }
        : {}),
    }));
    this.outstanding = null;
    this.attachments = [];
    this.save = true;
    this.savedPath = path;
    this.created = chat.created || null;
    this.selected = [...this.sentPages]
      .filter((p) => p <= this.totalPages)
      .sort((a, b) => a - b)
      .slice(0, ASK_MAX_PAGES);
    this.changed();
  }

  /** Ask `question`; resolves once it is answered or has failed. */
  async send(question: string): Promise<void> {
    const text = question.trim();
    if (!text || this.busy) return;
    const generation = this.generation;
    const first = this.turns.length === 0;
    const sent = this.sentPages;
    const newPages = this.selected.filter((p) => !sent.has(p));
    const files = [...this.attachments];
    const reading = [
      ...(newPages.length ? [pagesPhrase(newPages)] : []),
      ...files.map((f) => f.name),
    ];
    this.outstanding = {
      question: text,
      status: reading.length ? `Reading ${listPhrase(reading)}…` : "",
    };
    this.changed();
    const stale = (): boolean => generation !== this.generation;
    try {
      if (first && newPages.length === 0 && files.length === 0) {
        throw new Error("pick a page or attach a file to ask about first.");
      }
      if (!(await this.deps.confirm())) {
        if (!stale()) {
          this.outstanding = null;
          this.changed();
        }
        return;
      }
      const history = await this.withImages();
      if (stale()) return;
      let turn: ChatTurn = { role: "user", text, shown: text };
      if (newPages.length) {
        const pages = await this.deps.preparePages(newPages);
        if (stale()) return;
        if (pages.images.length === 0) {
          if (first && files.length === 0) {
            throw new Error("there is nothing on these pages to send.");
          }
        } else {
          turn = this.questionWithPages(text, pages, first);
        }
        this.outstanding = { question: text, status: "" };
        this.changed();
      }
      if (files.length) turn = { ...turn, files };
      const answer = await this.deps.ask([...history, turn], (status) => {
        if (stale() || !this.outstanding || this.outstanding.error !== undefined) return;
        this.outstanding = { ...this.outstanding, status };
        this.changed();
      });
      if (stale()) return;
      const actions = answer.actions ?? [];
      // An answer is never empty in the history: the API refuses an empty turn.
      const said = answer.text.trim() || actions.join("\n") || "Done.";
      this.created ??= this.deps.now().toISOString();
      // Only a question that was answered joins the history, so a failed one
      // can simply be asked again.
      this.turns = [
        ...history,
        turn,
        { role: "assistant", text: said, ...(actions.length ? { actions } : {}) },
      ];
      this.attachments = this.attachments.filter((f) => !files.includes(f));
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
    if (this.turns.length === 0) return null;
    return {
      notebook: this.deps.notebookPath(),
      totalPages: this.totalPages,
      created: this.created ?? this.deps.now().toISOString(),
      turns: this.turns.map((turn) => ({
        role: turn.role,
        text: shownText(turn),
        ...(turn.pages?.length ? { pages: [...turn.pages] } : {}),
        ...(turn.files?.length
          ? {
              files: turn.files.map((f) => ({ name: f.name, ...(f.path ? { path: f.path } : {}) })),
            }
          : {}),
      })),
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

  /** A question carrying page images, with the line that names them. */
  private questionWithPages(question: string, pages: AskPagesResult, first: boolean): ChatTurn {
    const total = pages.totalPages || this.totalPages;
    const text = first
      ? buildAskFirstTurn(question, pages.images, pages.pageNumbers, total).text
      : `${addedLine(pages.pageNumbers, total)}\n\n${question}`;
    return { role: "user", text, shown: question, images: pages.images, pages: pages.pageNumbers };
  }

  /**
   * The history with every question's images, rendering them again where the
   * chat was loaded from a file (which keeps no images).
   */
  private async withImages(): Promise<ChatTurn[]> {
    const missing = this.turns.some(
      (t) => (t.pages?.length && !t.images?.length) || t.files?.some((f) => !hasData(f)),
    );
    if (!missing) return this.turns;
    const rebuilt: ChatTurn[] = [];
    for (const [i, turn] of this.turns.entries()) {
      let next = turn;
      if (turn.pages?.length && !turn.images?.length) {
        const pages = await this.deps.preparePages(turn.pages);
        next = pages.images.length
          ? this.questionWithPages(shownText(turn), pages, i === 0)
          : { ...turn, text: shownText(turn) };
      }
      if (turn.files?.some((f) => !hasData(f))) {
        // A file from the vault is read again; one from the device, or one
        // that is gone, cannot be, and the question goes without it.
        const files: ChatFile[] = [];
        for (const file of turn.files) {
          if (hasData(file)) files.push(file);
          else if (file.path) {
            const read = await this.deps.readFile(file.path);
            if (read) files.push(read);
          }
        }
        next = { ...next, files };
      } else if (turn.files?.length) {
        next = { ...next, files: turn.files };
      }
      rebuilt.push(next);
    }
    this.turns = rebuilt;
    return rebuilt;
  }
}

/** Whether a file still holds its contents (a reloaded chat's hold only names). */
function hasData(file: ChatFile): boolean {
  return file.base64 !== undefined || file.text !== undefined;
}

/** "a", "a and b", "a, b and c". */
function listPhrase(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** A turn as the user sees it: the question as typed, or the answer. */
export function shownText(turn: ChatTurn): string {
  return turn.shown ?? turn.text;
}

/** "page 3", "pages 2, 5 and 7". */
export function pagesPhrase(pages: readonly number[]): string {
  if (pages.length === 1) return `page ${pages[0]}`;
  return `pages ${pages.slice(0, -1).join(", ")} and ${pages[pages.length - 1]}`;
}

/** The line in front of a follow-up that brings more pages into the chat. */
function addedLine(pageNumbers: readonly number[], total: number): string {
  return pageNumbers.length === 1
    ? `Another image: page ${pageNumbers[0]} of ${total}.`
    : `More images: pages ${pageNumbers.join(", ")} of ${total}, in that order.`;
}
