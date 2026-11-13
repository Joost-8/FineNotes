/**
 * The toolbar's search button: "Search this notebook". Obsidian's own
 * search list (the quick switcher's), so it looks and types like the rest
 * of the app, with the field at the top of the screen where the iPad
 * keyboard cannot cover it. Each result is a page, with the words around
 * each match; tapping one closes the list and turns to that page.
 *
 * What is searched is decided in `src/search/notebook-search.ts`: the
 * page's transcription (the note's text layer, and the transcript server's
 * `.transcript.md` file), its typed text boxes and its PDF's printed text.
 */

import { type App, SuggestModal, setIcon } from "obsidian";
import { t, tn } from "../i18n/translate";
import {
  type PageText,
  type SearchHit,
  hasTranscripts,
  queryTerms,
  searchPages,
} from "../search/notebook-search";
import { DialogKeyboard } from "./dialog-keyboard";
import type { Feature } from "../model/feature-index";
import { type FeatureHost, featureHits, hideButton } from "./feature-rows";

/** A row of the list: a page that holds the words, or a feature the words mean. */
type SearchRow = SearchHit | Feature;

function isFeature(row: SearchRow): row is Feature {
  return !("pageIndex" in row);
}

function kindLabel(kind: SearchHit["snippets"][number]["kind"]): string {
  if (kind === "handwriting") return t("view.search.kindHandwriting");
  if (kind === "text") return t("view.search.kindText");
  return t("view.search.kindPdf");
}

export interface NotebookSearchHost {
  index: readonly PageText[];
  /** The last query, so searching again carries on where it left off. */
  initial: string;
  onQuery: (query: string) => void;
  /** Turn to a page, 0-based, and light up what `query` found there. */
  goTo: (pageIndex: number, query: string) => void;
  /** Open a feature the words meant: its tip, or its switch. */
  showFeature?: (feature: Feature) => void;
  /** What a found feature's × can do: take it out of search results. */
  features?: FeatureHost;
}

export class NotebookSearchModal extends SuggestModal<SearchRow> {
  private transcribed: boolean;
  private index: readonly PageText[];
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
    this.index = host.index;
    this.transcribed = hasTranscripts(host.index);
    this.keyboard = new DialogKeyboard(this.modalEl);
    this.modalEl.addClass("goodobsidian-search-modal");
    this.limit = 500;
    this.setPlaceholder(t("view.search.placeholder"));
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

  /** More of the notebook was read (a PDF's pages): search it again as typed. */
  setIndex(index: readonly PageText[]): void {
    this.index = index;
    this.transcribed = hasTranscripts(index);
    if (this.inputEl.isConnected && this.inputEl.value) {
      this.inputEl.dispatchEvent(new Event("input"));
    }
  }

  getSuggestions(query: string): SearchRow[] {
    this.host.onQuery(query);
    this.emptyStateText = this.hint(query);
    // The notebook's own pages first; what FineNotes can do with those words after.
    const hidden = this.host.features?.hiddenFeatures() ?? [];
    const features = this.host.showFeature ? featureHits(query, undefined, hidden) : [];
    return [...searchPages(this.index, query), ...features];
  }

  renderSuggestion(hit: SearchRow, el: HTMLElement): void {
    if (isFeature(hit)) {
      el.addClass("goodobsidian-search-feature");
      setIcon(
        el.createSpan({ cls: "goodobsidian-feature-icon" }),
        hit.tip ? "lightbulb" : "sliders-horizontal",
      );
      const words = el.createSpan({ cls: "goodobsidian-feature-words" });
      words.createSpan({ cls: "goodobsidian-feature-title", text: t(hit.title) });
      words.createSpan({
        cls: "goodobsidian-feature-sub",
        text: hit.collection ? t(hit.collection.title) : t("notebooks.features.heading"),
      });
      const host = this.host.features;
      // Its × takes it out of search results, and the list is made again without it.
      if (host) {
        hideButton(el, hit, host, () => {
          this.inputEl.dispatchEvent(new Event("input"));
        });
      }
      return;
    }
    el.addClass("goodobsidian-search-hit");
    const head = el.createDiv({ cls: "goodobsidian-search-page" });
    head.createSpan({ text: t("view.search.page", { page: hit.pageIndex + 1 }) });
    head.createSpan({
      cls: "goodobsidian-search-count",
      text: tn("view.search.matches", hit.count),
    });
    for (const snippet of hit.snippets) {
      const line = el.createDiv({ cls: "goodobsidian-search-snippet" });
      line.createSpan({
        cls: "goodobsidian-search-kind",
        text: kindLabel(snippet.kind),
      });
      line.appendText(snippet.before);
      line.createSpan({ cls: "suggestion-highlight", text: snippet.match });
      line.appendText(snippet.after);
    }
  }

  onChooseSuggestion(hit: SearchRow): void {
    if (isFeature(hit)) {
      this.host.showFeature?.(hit);
      return;
    }
    this.host.goTo(hit.pageIndex, this.inputEl.value);
  }

  /** What an empty list says: how to search, or why nothing was found. */
  private hint(query: string): string {
    if (queryTerms(query).length === 0) {
      return this.transcribed
        ? t("view.search.hintTranscribed")
        : t("view.search.hintUntranscribed");
    }
    return this.transcribed ? t("view.search.noneTranscribed") : t("view.search.noneUntranscribed");
  }
}
