/**
 * Search this notebook in its sidebar (discussion #112): the field, and
 * every match as a row to step through, docked at the right of the
 * notebook as Goodnotes shows its search, so the page sidebar can stay open
 * on the left. It is the default look; the other is the original list
 * (`search-modal.ts`), and the button beside ✕ switches to it. The choice
 * is the `searchLayout` setting, one for every notebook.
 *
 *   .goodobsidian-searchpanel.is-sidebar
 *     .goodobsidian-searchpanel-top      (field · original-list switch · ✕)
 *     .goodobsidian-searchpanel-nav      (3 / 75 · ↑ · ↓)
 *     .goodobsidian-searchpanel-list
 *       .goodobsidian-searchpanel-row × N  (kind icon · snippet with the match · page)
 *         .is-current: the one the page shows
 *       .goodobsidian-feature-row × ≤ 3  (what FineNotes can do with those words)
 *     .goodobsidian-searchpanel-empty   (how to search, or why nothing was found)
 *
 * A tap on a row turns to its match and lights it; ↑ and ↓ (the buttons, or
 * the keys) and Enter step to the previous and next. The list is made again
 * as more of the notebook is read (a PDF's pages), and the current match
 * stays current.
 */

import { setIcon } from "obsidian";
import { t } from "../i18n/translate";
import type { Feature } from "../model/feature-index";
import {
  type PageText,
  type SourceKind,
  hasTranscripts,
  queryTerms,
} from "../search/notebook-search";
import { type SearchResult, keepCurrent, listResults, stepResult } from "../search/search-results";
import { DialogKeyboard } from "./dialog-keyboard";
import { type FeatureHost, featureHits, featureRow } from "./feature-rows";
import { onTap } from "./selection-bar";

export interface SearchPanelHost {
  /** Where the sidebar docks: the notebook's body, beside the page. */
  dock: HTMLElement;
  /** Show the search as the original list instead, with the query as typed. */
  switchToOriginal(query: string): void;
  /** Turn to a match and light it. */
  goTo(result: SearchResult, query: string): void;
  /** The query as typed, so searching again carries on where it left off. */
  onQuery(query: string): void;
  /** The sidebar came or went, or the panel closed: the page lays itself out again. */
  onLayout(): void;
  /** The panel closed. */
  onClose(): void;
  /** Open a feature the words meant: its tip, or its switch. */
  features?: FeatureHost;
}

/** Rows made at once; more as the list is scrolled or stepped near its end. */
const ROW_BATCH = 150;

const KIND_ICONS: Record<SourceKind, string> = {
  handwriting: "pen-line",
  text: "type",
  pdf: "file-text",
};

function kindLabel(kind: SourceKind): string {
  if (kind === "handwriting") return t("view.search.kindHandwriting");
  if (kind === "text") return t("view.search.kindText");
  return t("view.search.kindPdf");
}

export class SearchPanel {
  /** The panel, docked in the notebook's body while open. */
  readonly el: HTMLElement;
  private readonly top: HTMLElement;
  private readonly field: HTMLInputElement;
  private readonly clear: HTMLButtonElement;
  private readonly position: HTMLElement;
  private readonly prev: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  private readonly list: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly keyboard: DialogKeyboard;

  private index: readonly PageText[] = [];
  private query = "";
  private results: SearchResult[] = [];
  private total = 0;
  private current: number | null = null;
  private rows: HTMLElement[] = [];
  private open = false;

  constructor(private readonly host: SearchPanelHost) {
    this.el = createDiv({ cls: "goodobsidian-searchpanel" });
    this.el.dataset.ignoreSwipe = "true";
    this.el.setAttribute("role", "search");
    this.top = this.el.createDiv({ cls: "goodobsidian-searchpanel-top" });
    const box = this.top.createDiv({ cls: "goodobsidian-searchpanel-field" });
    setIcon(box.createSpan({ cls: "goodobsidian-searchpanel-glass" }), "search");
    this.field = box.createEl("input", {
      type: "search",
      attr: {
        placeholder: t("view.search.placeholder"),
        "aria-label": t("view.search.placeholder"),
        enterkeyhint: "search",
        autocapitalize: "off",
        autocorrect: "off",
        spellcheck: "false",
      },
    });
    this.clear = this.iconButton(box, "x-circle", t("view.search.clear"), () => {
      this.field.value = "";
      this.search();
      this.field.focus();
    });
    this.clear.addClass("goodobsidian-searchpanel-clear");
    const tools = this.top.createDiv({ cls: "goodobsidian-searchpanel-tools" });
    this.iconButton(tools, "list", t("view.search.showOriginal"), () => {
      const query = this.field.value;
      this.close();
      this.host.switchToOriginal(query);
    });
    this.iconButton(tools, "x", t("common.close"), () => this.close());

    const nav = this.el.createDiv({ cls: "goodobsidian-searchpanel-nav" });
    this.position = nav.createSpan({ cls: "goodobsidian-searchpanel-position" });
    this.position.setAttribute("aria-live", "polite");
    this.prev = this.iconButton(nav, "chevron-up", t("view.search.previous"), () => this.step(-1));
    this.next = this.iconButton(nav, "chevron-down", t("view.search.next"), () => this.step(1));

    // Under the steps, where an empty list would start.
    this.empty = this.el.createDiv({ cls: "goodobsidian-searchpanel-empty" });
    this.list = this.el.createDiv({ cls: "goodobsidian-searchpanel-list" });
    this.list.setAttribute("role", "listbox");
    this.list.addEventListener("scroll", () => this.fillTo(this.rows.length + 1, true), {
      passive: true,
    });

    this.field.addEventListener("input", () => this.search());
    this.el.addEventListener("keydown", (event) => this.onKey(event));
    this.keyboard = new DialogKeyboard(this.el, { pad: true });
    this.keyboard.watch(this.field, this.top);
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** Open with `query` (the last one) selected, or bring the field back. */
  show(index: readonly PageText[], query: string): void {
    this.index = index;
    if (!this.open) {
      this.open = true;
      this.mount();
      this.field.value = query;
      this.search();
    } else {
      this.setIndex(index);
    }
    this.field.focus();
    this.field.select();
  }

  /** More of the notebook was read: the list is made again, the current match kept. */
  setIndex(index: readonly PageText[]): void {
    this.index = index;
    if (!this.open || !this.query) return;
    const was = this.current !== null ? this.results[this.current] : null;
    this.relist();
    this.current = keepCurrent(was, this.results);
    this.render();
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.keyboard.end();
    this.unmount();
    this.host.onLayout();
    this.host.onClose();
  }

  destroy(): void {
    this.keyboard.end();
    this.unmount();
    this.open = false;
  }

  /** Step to the next (1) or previous (-1) match, and go there. */
  step(delta: 1 | -1): void {
    const at = stepResult(this.current, this.results.length, delta);
    if (at !== null) this.choose(at);
  }

  private mount(): void {
    this.el.addClass("is-sidebar");
    this.host.dock.appendChild(this.el);
    this.host.onLayout();
  }

  private unmount(): void {
    this.el.detach();
  }

  // --- Searching ------------------------------------------------------------

  private search(): void {
    this.query = this.field.value;
    this.host.onQuery(this.query);
    this.relist();
    this.current = null;
    this.render();
    this.list.scrollTop = 0;
  }

  private relist(): void {
    const { results, total } = listResults(this.index, this.query);
    this.results = results;
    this.total = total;
  }

  private choose(at: number): void {
    const result = this.results[at];
    if (!result) return;
    this.current = at;
    this.fillTo(at + 1);
    this.rows.forEach((row, i) => {
      row.toggleClass("is-current", i === at);
      row.setAttribute("aria-selected", String(i === at));
    });
    this.updatePosition();
    this.scrollToCurrent();
    this.host.goTo(result, this.query);
  }

  private scrollToCurrent(): void {
    const row = this.current !== null ? this.rows[this.current] : undefined;
    row?.scrollIntoView({ block: "nearest" });
  }

  private onKey(event: KeyboardEvent): void {
    if (event.isComposing) return;
    if (event.key === "ArrowDown" || (event.key === "Enter" && !event.shiftKey)) {
      event.preventDefault();
      this.step(1);
    } else if (event.key === "ArrowUp" || (event.key === "Enter" && event.shiftKey)) {
      event.preventDefault();
      this.step(-1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.close();
    }
  }

  // --- Drawing --------------------------------------------------------------

  private render(): void {
    this.list.empty();
    this.rows = [];
    this.fillTo(Math.max(ROW_BATCH, (this.current ?? 0) + 1));
    const hidden = this.host.features?.hiddenFeatures() ?? [];
    const features = this.host.features ? featureHits(this.query, undefined, hidden) : [];
    this.list.toggleClass("has-features", features.length > 0);
    for (const feature of features) this.featureRow(feature);
    this.clear.toggleClass("is-hidden", this.query === "");
    this.updatePosition();
    const nothing = this.results.length === 0;
    this.empty.toggleClass("is-hidden", !nothing || features.length > 0);
    this.empty.setText(nothing ? this.hint() : "");
  }

  /**
   * Make rows up to `count` (the next batch, from a scroll: only once the
   * list is scrolled near its end), before the feature rows.
   */
  private fillTo(count: number, fromScroll = false): void {
    if (fromScroll) {
      const near = this.list.scrollTop + this.list.clientHeight > this.list.scrollHeight - 400;
      if (!near) return;
      count = this.rows.length + ROW_BATCH;
    }
    const end = Math.min(count, this.results.length);
    const before = this.list.querySelector(".goodobsidian-feature-row");
    for (let i = this.rows.length; i < end; i++) {
      const row = this.row(this.results[i], i);
      if (before) this.list.insertBefore(row, before);
      this.rows.push(row);
    }
  }

  private row(result: SearchResult, at: number): HTMLElement {
    const row = this.list.createEl("button", {
      cls: "goodobsidian-searchpanel-row clickable-icon",
      attr: { type: "button", role: "option" },
    });
    const current = at === this.current;
    row.toggleClass("is-current", current);
    row.setAttribute("aria-selected", String(current));
    const kind = row.createSpan({
      cls: "goodobsidian-searchpanel-kind",
      attr: { "aria-label": kindLabel(result.kind), role: "img" },
    });
    setIcon(kind, KIND_ICONS[result.kind]);
    const words = row.createSpan({ cls: "goodobsidian-searchpanel-snippet" });
    const { before, match, after } = result.snippet;
    words.appendText(before);
    words.createSpan({ cls: "goodobsidian-searchpanel-match", text: match });
    words.appendText(after);
    row.createSpan({
      cls: "goodobsidian-searchpanel-page",
      text: String(result.pageIndex + 1),
      attr: { "aria-label": t("view.search.page", { page: result.pageIndex + 1 }) },
    });
    onTap(row, () => this.choose(at));
    return row;
  }

  private featureRow(feature: Feature): void {
    const host = this.host.features;
    if (!host) return;
    featureRow(this.list, feature, host, undefined, () => this.render());
  }

  /** "3 / 75" while on a match, "75" before one is chosen; a listed cap shows as "1000+". */
  private updatePosition(): void {
    const shown = this.results.length;
    const total = this.total > shown ? `${shown}+` : String(this.total);
    const text =
      this.current !== null
        ? t("view.search.position", { current: this.current + 1, total })
        : this.query && shown > 0
          ? total
          : "";
    this.position.setText(text);
    const none = shown === 0;
    this.prev.disabled = none;
    this.next.disabled = none;
  }

  /** What an empty list says: how to search, or why nothing was found. */
  private hint(): string {
    const transcribed = hasTranscripts(this.index);
    if (queryTerms(this.query).length === 0) {
      return transcribed ? t("view.search.hintTranscribed") : t("view.search.hintUntranscribed");
    }
    return transcribed ? t("view.search.noneTranscribed") : t("view.search.noneUntranscribed");
  }

  private iconButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    run: () => void,
  ): HTMLButtonElement {
    const button = parent.createEl("button", {
      cls: "goodobsidian-searchpanel-button clickable-icon",
      attr: { type: "button", "aria-label": label },
    });
    setIcon(button, icon);
    onTap(button, run);
    return button;
  }
}
