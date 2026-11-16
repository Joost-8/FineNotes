/**
 * Search this notebook (discussion #112): the field, and every match as a
 * row to step through, in one of two looks the notebook keeps for itself
 * (`model/search-look.ts`):
 *
 * - the **sidebar**, docked at the right of the notebook as Goodnotes shows
 *   its search, beside the page sidebar's side, so both can be open;
 * - the **window**, floating over the page (`floating-window.ts`), moved by
 *   its bar and sized from its corner like the calculator.
 *
 *   .goodobsidian-searchpanel            (.is-sidebar | .is-window)
 *     .goodobsidian-searchpanel-top      (field · look switch · ✕; the window's bar holds the last two)
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
import { type SearchLook, otherLook } from "../model/search-look";
import type { WindowPlace } from "../model/calculator-store";
import {
  type PageText,
  type SourceKind,
  hasTranscripts,
  queryTerms,
} from "../search/notebook-search";
import { type SearchResult, keepCurrent, listResults, stepResult } from "../search/search-results";
import { DialogKeyboard } from "./dialog-keyboard";
import { type FeatureHost, featureHits, featureRow } from "./feature-rows";
import { FloatingWindow } from "./floating-window";
import { onTap } from "./selection-bar";

export interface SearchPanelHost {
  /** Where the sidebar docks: the notebook's body, beside the page. */
  dock: HTMLElement;
  /** Where the window floats: the notebook view's content area. */
  container: HTMLElement;
  /** The look this notebook keeps. */
  look(): SearchLook;
  /** Keep a new look with the notebook. */
  setLook(look: SearchLook): void;
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

/** Where the window was, for every notebook on this device until Obsidian restarts. */
let lastPlace: WindowPlace | null = null;

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
  /** The panel's own content, moved between the sidebar and the window. */
  readonly el: HTMLElement;
  private readonly top: HTMLElement;
  private readonly field: HTMLInputElement;
  private readonly clear: HTMLButtonElement;
  private readonly tools: HTMLElement;
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
  private frame: FloatingWindow | null = null;
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
    this.tools = this.top.createDiv({ cls: "goodobsidian-searchpanel-tools" });

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

  /** Whether it is docked beside the page, taking room from it. */
  get isDocked(): boolean {
    return this.open && this.frame === null;
  }

  /** Open in the notebook's look with `query` (the last one) selected, or bring the field back. */
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

  // --- Looks ----------------------------------------------------------------

  private mount(): void {
    const look = this.host.look();
    this.tools.empty();
    if (look === "window") {
      this.el.removeClass("is-sidebar");
      this.el.addClass("is-window");
      this.frame = new FloatingWindow({
        container: this.host.container,
        cls: "goodobsidian-search-window",
        title: t("toolbar.searchNotebook"),
        label: t("toolbar.searchNotebook"),
        buttons: [this.switchButton(look)],
        min: { w: 260, h: 220 },
        firstPlace: (bounds) => {
          const w = Math.min(360, bounds.w - 16);
          return { x: Math.max(8, bounds.w - w - 16), y: 72, w, h: Math.min(520, bounds.h - 88) };
        },
        place: () => lastPlace,
        savePlace: (place) => {
          lastPlace = place;
        },
        onClose: () => this.close(),
      });
      this.frame.body.appendChild(this.el);
    } else {
      this.el.removeClass("is-window");
      this.el.addClass("is-sidebar");
      const sw = this.switchButton(look);
      this.iconButton(this.tools, sw.icon, sw.label, sw.run);
      this.iconButton(this.tools, "x", t("common.close"), () => this.close());
      this.host.dock.appendChild(this.el);
    }
    this.host.onLayout();
  }

  private unmount(): void {
    this.el.detach();
    this.frame?.destroy();
    this.frame = null;
  }

  /** The button that shows the results in the other look, and keeps that look with the notebook. */
  private switchButton(look: SearchLook): { icon: string; label: string; run: () => void } {
    const other = otherLook(look);
    return {
      icon: other === "sidebar" ? "panel-right" : "app-window",
      label: other === "sidebar" ? t("view.search.showInSidebar") : t("view.search.showAsWindow"),
      run: () => {
        this.host.setLook(other);
        this.unmount();
        this.mount();
        this.field.focus();
        this.scrollToCurrent();
      },
    };
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
