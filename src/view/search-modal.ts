/**
 * The toolbar's search button: "Search this notebook". Obsidian's own
 * search list (the quick switcher's), so it looks and types like the rest
 * of the app, with the field at the top of the screen where the iPad
 * keyboard cannot cover it. Each result is a page, with the words around
 * each match; tapping one closes the list and turns to that page.
 *
 * What is searched is decided in `src/search/notebook-search.ts`: the
 * page's transcription (the note's text layer, and the transcript server's
 * `.transcript.md` file) and its typed text boxes.
 */

import { type App, SuggestModal } from "obsidian";
import {
  type PageText,
  type SearchHit,
  hasTranscripts,
  queryTerms,
  searchPages,
} from "../search/notebook-search";
import { DialogKeyboard } from "./dialog-keyboard";

export interface NotebookSearchHost {
  index: readonly PageText[];
  /** The last query, so searching again carries on where it left off. */
  initial: string;
  onQuery: (query: string) => void;
  /** Turn to a page, 0-based. */
  goTo: (pageIndex: number) => void;
}

export class NotebookSearchModal extends SuggestModal<SearchHit> {
  private readonly transcribed: boolean;
  /**
   * Keeps Obsidian's keyboard cap off the notebook behind the list while the
   * keyboard is up, so the page is still there — at its size — to turn to.
   */
  private readonly keyboard: DialogKeyboard;

  constructor(
    app: App,
    private readonly host: NotebookSearchHost,
  ) {
    super(app);
    this.transcribed = hasTranscripts(host.index);
    this.keyboard = new DialogKeyboard(this.modalEl);
    this.modalEl.addClass("goodobsidian-search-modal");
    this.limit = 500;
    this.setPlaceholder("Search this notebook");
    this.emptyStateText = this.hint("");
  }

  override async onOpen(): Promise<void> {
    await super.onOpen();
    this.keyboard.start(this.inputEl);
    if (!this.host.initial) return;
    // Opening empties the field; write the last query after, and select it
    // so typing replaces it.
    this.inputEl.value = this.host.initial;
    this.inputEl.dispatchEvent(new Event("input"));
    this.inputEl.select();
  }

  override onClose(): void {
    super.onClose();
    this.keyboard.end();
  }

  getSuggestions(query: string): SearchHit[] {
    this.host.onQuery(query);
    this.emptyStateText = this.hint(query);
    return searchPages(this.host.index, query);
  }

  renderSuggestion(hit: SearchHit, el: HTMLElement): void {
    el.addClass("goodobsidian-search-hit");
    const head = el.createDiv({ cls: "goodobsidian-search-page" });
    head.createSpan({ text: `Page ${hit.pageIndex + 1}` });
    head.createSpan({
      cls: "goodobsidian-search-count",
      text: hit.count === 1 ? "1 match" : `${hit.count} matches`,
    });
    for (const snippet of hit.snippets) {
      const line = el.createDiv({ cls: "goodobsidian-search-snippet" });
      line.createSpan({
        cls: "goodobsidian-search-kind",
        text: snippet.kind === "handwriting" ? "Handwriting" : "Text",
      });
      line.appendText(snippet.before);
      line.createSpan({ cls: "suggestion-highlight", text: snippet.match });
      line.appendText(snippet.after);
    }
  }

  onChooseSuggestion(hit: SearchHit): void {
    this.host.goTo(hit.pageIndex);
  }

  /** What an empty list says: how to search, or why nothing was found. */
  private hint(query: string): string {
    if (queryTerms(query).length === 0) {
      return this.transcribed
        ? "Search the transcribed handwriting and typed text on every page."
        : "Search typed text on every page. Handwriting is searchable once it is transcribed (AI → Transcribe whole notebook).";
    }
    return this.transcribed
      ? "No page has all of these words."
      : "No page has all of these words in typed text. Handwriting is searchable once it is transcribed (AI → Transcribe whole notebook).";
  }
}
