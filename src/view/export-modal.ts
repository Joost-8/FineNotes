/**
 * The toolbar's share button: "Export as PDF", as in GoodNotes. What will be
 * exported is shown, not described:
 *
 * - **All pages** — every page in a scrollable grid, all ticked.
 * - **This page** — the page being read, large.
 * - **Choose pages** — the same grid; a tap ticks or unticks a page
 *   (shift-click ticks a span on a desktop), with Select all / None, and
 *   the choice also typed as `1-3, 5` for a long notebook. **The order the
 *   pages are ticked is the PDF's page order**; each ticked page shows its
 *   place in it. A tap on a page under All pages switches here with that
 *   page unticked.
 *
 * Previews are painted as the file will look, only for tiles near the
 * visible part of the grid, and freed again when scrolled far away: a
 * 200-page notebook must not hold 200 canvases on an iPad.
 *
 * The PDF is saved next to the notebook (never over an existing file); then
 * it can be opened in Obsidian or handed to the system share sheet.
 */

import { type App, Modal, setIcon } from "obsidian";
import {
  type ExportScope,
  allPages,
  formatPageRange,
  parsePageRange,
  toggleSelection,
} from "../export/page-range";
import { DialogKeyboard } from "./dialog-keyboard";
import { releaseCanvas } from "./image-import";
import { errorMessage } from "../util/errors";

export interface ExportedPdf {
  /** Vault path it was saved at. */
  path: string;
  /** File name, for the share sheet. */
  name: string;
  bytes: ArrayBuffer;
}

export interface ExportPdfHost {
  /** "notebook" or "page": only the wording changes. */
  noun: string;
  pageCount: number;
  /** 0-based page being read. */
  currentPage: number;
  /** A page's size in page px, for its preview's shape. */
  pageSize: (index: number) => { width: number; height: number };
  /** The note's "PDF exports" folder, or `null` when PDFs are saved next to the note. */
  folder: string | null;
  /** Paint page `index`'s preview into `canvas`, `cssWidth` CSS px wide, as it will export. */
  paintPreview: (canvas: HTMLCanvasElement, index: number, cssWidth: number) => Promise<void>;
  /** The file name the pages would be saved under. */
  fileNameFor: (pages: readonly number[]) => string;
  /** Render and save; `onProgress` counts finished pages. Rejects with an `AbortError` when cancelled. */
  export: (
    pages: readonly number[],
    onProgress: (done: number, total: number) => void,
    cancelled: () => boolean,
  ) => Promise<ExportedPdf>;
  /** Open the saved PDF in Obsidian. */
  open: (path: string) => void;
}

/** Width of a page tile in the grid, CSS px; the grid fits as many per row as it can. */
const TILE_WIDTH = 112;
/** Width of the single-page preview, CSS px. */
const SINGLE_WIDTH = 260;

export class ExportPdfModal extends Modal {
  /** Not `scope`: Modal has one (Obsidian's keymap scope). */
  private pageScope: ExportScope;
  /** The ticked pages under Choose pages, in the order they will export. */
  private chosen: number[];
  /** Where a shift-click span starts: the last page tapped. */
  private anchor: number | null = null;
  private busy = false;
  private cancelled = false;
  private closed = false;
  private readonly keyboard: DialogKeyboard;
  private readonly scopeButtons = new Map<ExportScope, HTMLButtonElement>();
  private grid: PageGrid | null = null;
  private single: HTMLCanvasElement | null = null;

  constructor(
    app: App,
    private readonly host: ExportPdfHost,
  ) {
    super(app);
    this.keyboard = new DialogKeyboard(this.modalEl);
    this.pageScope = host.pageCount > 1 ? "all" : "current";
    this.chosen = [host.currentPage];
  }

  override onOpen(): void {
    this.closed = false;
    this.modalEl.addClass("goodobsidian-export-modal", "goodobsidian-dialog");
    this.titleEl.setText("Export as PDF");
    this.renderChoose();
  }

  override onClose(): void {
    this.closed = true;
    // A running export stops after the page it is on.
    this.cancelled = true;
    this.keyboard.end();
    this.disposePreviews();
    this.contentEl.empty();
  }

  /** The pages the current choice exports. */
  private pages(): number[] {
    if (this.pageScope === "all") return allPages(this.host.pageCount);
    if (this.pageScope === "current") return [this.host.currentPage];
    return this.chosen;
  }

  // --- Choose pages ----------------------------------------------------------

  private renderChoose(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("goodobsidian-ask");
    this.scopeButtons.clear();
    const { pageCount, currentPage } = this.host;

    if (pageCount > 1) {
      const seg = contentEl.createDiv({ cls: "goodobsidian-segmented goodobsidian-export-scope" });
      const scopes: ReadonlyArray<{ id: ExportScope; label: string }> = [
        { id: "all", label: `All ${pageCount} pages` },
        { id: "current", label: `This page (${currentPage + 1})` },
        { id: "custom", label: "Choose pages" },
      ];
      for (const { id, label } of scopes) {
        const button = seg.createEl("button", { cls: "clickable-icon", text: label });
        button.addEventListener("click", () => {
          if (this.busy || this.pageScope === id) return;
          this.pageScope = id;
          sync(true);
        });
        this.scopeButtons.set(id, button);
      }
    }

    // Choose pages: select all / none and the typed form of the choice.
    const bar = contentEl.createDiv({ cls: "goodobsidian-export-choose" });
    const selectAll = bar.createEl("button", { cls: "clickable-icon", text: "Select all" });
    const selectNone = bar.createEl("button", { cls: "clickable-icon", text: "None" });
    const field = bar.createEl("input", {
      cls: "goodobsidian-export-range",
      type: "text",
      attr: {
        placeholder: "Pages, e.g. 1-3, 5",
        "aria-label": "Pages to export",
        autocapitalize: "off",
        autocomplete: "off",
        spellcheck: "false",
        enterkeyhint: "done",
      },
    });
    this.keyboard.watch(field, bar);

    const stage = contentEl.createDiv({ cls: "goodobsidian-export-stage" });
    const summary = contentEl.createDiv({ cls: "goodobsidian-ask-note" });
    const status = contentEl.createDiv({ cls: "goodobsidian-ask-status" });
    const actions = contentEl.createDiv({ cls: "goodobsidian-ask-actions" });
    const cancel = actions.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
    const go = actions.createEl("button", { cls: "mod-cta", text: "Export" });

    /** A typed range that does not parse, shown instead of the summary. */
    let rangeError: string | null = null;

    const setChosen = (pages: number[], fromField = false): void => {
      this.chosen = pages;
      rangeError = null;
      if (!fromField) field.value = formatPageRange(pages);
      sync(false);
    };

    selectAll.addEventListener("click", () => setChosen(allPages(pageCount)));
    selectNone.addEventListener("click", () => setChosen([]));
    field.addEventListener("input", () => {
      if (!field.value.trim()) {
        setChosen([], true);
        return;
      }
      const parsed = parsePageRange(field.value, pageCount);
      if (parsed.ok) {
        setChosen(parsed.pages, true);
      } else {
        rangeError = parsed.error;
        sync(false);
      }
    });
    field.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        field.blur();
      }
    });

    const onTap = (index: number, extend: boolean): void => {
      if (this.busy) return;
      if (this.pageScope === "all") {
        // Unticking a page of "all" is choosing the rest.
        this.pageScope = "custom";
        this.chosen = allPages(pageCount);
      }
      this.chosen = toggleSelection(this.chosen, index, this.anchor, extend);
      this.anchor = index;
      setChosen(this.chosen);
    };

    /** Show what the current choice exports; `scopeChanged` re-centres the view on it. */
    const sync = (scopeChanged: boolean): void => {
      for (const [id, button] of this.scopeButtons) {
        button.toggleClass("is-active", id === this.pageScope);
        button.setAttribute("aria-pressed", String(id === this.pageScope));
      }
      bar.toggleClass("is-hidden", this.pageScope !== "custom");
      if (this.pageScope === "custom" && document.activeElement !== field) {
        field.value = formatPageRange(this.chosen);
      }

      if (this.pageScope === "current") {
        this.grid?.setHidden(true);
        this.showSingle(stage);
      } else {
        this.single?.parentElement?.addClass("is-hidden");
        if (!this.grid) this.grid = new PageGrid(stage, this.host, onTap);
        this.grid.setHidden(false);
        this.grid.setSelection(this.pages(), this.pageScope === "custom");
        if (scopeChanged) this.grid.reveal(this.pageScope === "custom" ? currentPage : 0);
      }

      const pages = this.pages();
      const n = pages.length;
      summary.toggleClass("is-error", rangeError !== null);
      if (rangeError !== null) {
        summary.setText(rangeError);
      } else if (n === 0) {
        summary.setText("Tap the pages to export.");
      } else {
        // Say the order when it is not the notebook's own.
        const reordered = pages.some((page, i) => i > 0 && page < pages[i - 1]);
        const which =
          this.pageScope !== "custom"
            ? ""
            : reordered
              ? ` (${formatPageRange(pages)}, in that order)`
              : ` (${formatPageRange(pages)})`;
        summary.setText(
          `${n === 1 ? "1 page" : `${n} pages`}${which}, saved as ` +
            `“${this.host.fileNameFor(pages)}” ` +
            (this.host.folder !== null
              ? `in “${this.host.folder}”.`
              : `next to this ${this.host.noun}.`),
        );
      }
      go.disabled = n === 0 || rangeError !== null || this.busy;
      this.keyboard.update();
    };

    const run = async (): Promise<void> => {
      const pages = this.pages();
      if (pages.length === 0 || this.busy) return;
      this.busy = true;
      this.cancelled = false;
      go.disabled = true;
      contentEl.addClass("is-busy");
      for (const button of this.scopeButtons.values()) button.disabled = true;
      status.removeClass("is-error");
      try {
        const saved = await this.host.export(
          pages,
          (done, total) => {
            if (this.closed) return;
            status.setText(done < total ? `Rendering page ${done + 1} of ${total}…` : "Saving…");
          },
          () => this.cancelled,
        );
        if (this.closed) return;
        this.renderDone(saved);
      } catch (error) {
        if (this.closed || (error instanceof DOMException && error.name === "AbortError")) return;
        this.busy = false;
        contentEl.removeClass("is-busy");
        status.addClass("is-error");
        status.setText(errorMessage(error));
        for (const button of this.scopeButtons.values()) button.disabled = false;
        sync(false);
      }
    };
    go.addEventListener("click", () => void run());
    sync(true);
  }

  /** The page being read, large. Painted once. */
  private showSingle(stage: HTMLElement): void {
    if (this.single) {
      this.single.parentElement?.removeClass("is-hidden");
      return;
    }
    const index = this.host.currentPage;
    const wrap = stage.createDiv({ cls: "goodobsidian-export-single" });
    const frame = wrap.createDiv({ cls: "goodobsidian-thumb-frame" });
    frame.setCssStyles({ aspectRatio: aspectOf(this.host.pageSize(index)) });
    const canvas = frame.createEl("canvas", { cls: "goodobsidian-thumb-canvas" });
    wrap.createDiv({ cls: "goodobsidian-thumb-number", text: `Page ${index + 1}` });
    this.single = canvas;
    void this.host.paintPreview(canvas, index, SINGLE_WIDTH).catch(() => undefined);
  }

  private disposePreviews(): void {
    this.grid?.destroy();
    this.grid = null;
    if (this.single) releaseCanvas(this.single);
    this.single = null;
  }

  // --- Saved -----------------------------------------------------------------

  private renderDone(saved: ExportedPdf): void {
    this.busy = false;
    this.keyboard.end();
    this.disposePreviews();
    const { contentEl } = this;
    contentEl.empty();
    contentEl.removeClass("is-busy");
    contentEl.createDiv({ cls: "goodobsidian-export-done", text: `Saved “${saved.path}”.` });
    const status = contentEl.createDiv({ cls: "goodobsidian-ask-status" });
    const actions = contentEl.createDiv({ cls: "goodobsidian-ask-actions" });

    const file = shareableFile(saved);
    if (file) {
      // A fresh tap: the share sheet needs a user gesture, which the export's
      // own tap has long since spent.
      const share = actions.createEl("button", { text: "Share…" });
      share.addEventListener("click", () => {
        navigator.share({ files: [file], title: saved.name }).catch((error: unknown) => {
          // Dismissing the sheet rejects with AbortError; that is not a failure.
          if (error instanceof DOMException && error.name === "AbortError") return;
          status.addClass("is-error");
          status.setText(errorMessage(error));
        });
      });
    }
    const open = actions.createEl("button", { text: "Open" });
    open.addEventListener("click", () => {
      this.close();
      this.host.open(saved.path);
    });
    const done = actions.createEl("button", { cls: "mod-cta", text: "Done" });
    done.addEventListener("click", () => this.close());
  }
}

// --- The page grid -------------------------------------------------------------

interface Tile {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  /** Near the visible part of the grid: keep it painted. */
  near: boolean;
  painted: boolean;
}

/**
 * Every page as a tile, like the page sidebar's thumbnails, in a grid that
 * scrolls. Tiles are painted one at a time while near the visible part and
 * freed when scrolled well away; their frames keep the page's shape either
 * way, so freeing one never moves the grid.
 */
class PageGrid {
  private readonly el: HTMLElement;
  private readonly tiles: Tile[] = [];
  private readonly observer: IntersectionObserver;
  private painting = false;
  private destroyed = false;

  constructor(
    parent: HTMLElement,
    private readonly host: ExportPdfHost,
    onTap: (index: number, extend: boolean) => void,
  ) {
    this.el = parent.createDiv({ cls: "goodobsidian-export-grid" });
    this.el.setAttribute("role", "listbox");
    this.el.setAttribute("aria-label", "Pages");
    this.el.setAttribute("aria-multiselectable", "true");
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const tile = this.tiles.find((t) => t.root === entry.target);
          if (!tile) continue;
          tile.near = entry.isIntersecting;
          if (!tile.near && tile.painted) {
            releaseCanvas(tile.canvas);
            tile.painted = false;
          }
        }
        void this.paintNear();
      },
      { root: this.el, rootMargin: "300px 0px" },
    );

    for (let index = 0; index < host.pageCount; index++) {
      const root = this.el.createDiv({ cls: "goodobsidian-thumb goodobsidian-export-tile" });
      if (index === host.currentPage) root.addClass("is-current");
      // `clickable-icon`: Obsidian restyles every other button (and pads it
      // 20 px on iPad).
      const frame = root.createEl("button", {
        cls: "goodobsidian-thumb-frame clickable-icon",
        attr: { role: "option", "aria-label": `Page ${index + 1}` },
      });
      frame.setCssStyles({ aspectRatio: aspectOf(host.pageSize(index)) });
      const canvas = frame.createEl("canvas", { cls: "goodobsidian-thumb-canvas" });
      const check = frame.createSpan({ cls: "goodobsidian-export-check" });
      setIcon(check.createSpan({ cls: "goodobsidian-export-check-icon" }), "check");
      check.createSpan({ cls: "goodobsidian-export-order" });
      root.createDiv({ cls: "goodobsidian-thumb-number", text: String(index + 1) });
      frame.addEventListener("click", (event) => onTap(index, event.shiftKey));
      this.tiles.push({ root, canvas, near: false, painted: false });
      this.observer.observe(root);
    }
  }

  setHidden(hidden: boolean): void {
    this.el.toggleClass("is-hidden", hidden);
  }

  /**
   * Tick the pages in `order`. While `choosing`, each shows its place in
   * the PDF (1, 2, 3…) and the others an empty circle; otherwise a tick.
   */
  setSelection(order: readonly number[], choosing: boolean): void {
    this.el.toggleClass("is-choosing", choosing);
    const place = new Map(order.map((page, i) => [page, i + 1]));
    this.tiles.forEach((tile, index) => {
      const at = place.get(index);
      tile.root.toggleClass("is-selected", at !== undefined);
      const frame = tile.root.querySelector("button");
      frame?.setAttribute("aria-selected", String(at !== undefined));
      frame?.setAttribute(
        "aria-label",
        at !== undefined && choosing
          ? `Page ${index + 1}, exported as page ${at}`
          : `Page ${index + 1}`,
      );
      const label = tile.root.querySelector(".goodobsidian-export-order");
      if (label) label.textContent = at !== undefined && choosing ? String(at) : "";
    });
  }

  /** Scroll the grid (only the grid) so page `index` is in view. */
  reveal(index: number): void {
    const tile = this.tiles[index];
    if (!tile) return;
    const box = this.el.getBoundingClientRect();
    const at = tile.root.getBoundingClientRect();
    if (at.top < box.top || at.bottom > box.bottom) {
      this.el.scrollTop += at.top - box.top - (box.height - at.height) / 2;
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.observer.disconnect();
    for (const tile of this.tiles) releaseCanvas(tile.canvas);
  }

  /** Paint the tiles near the view, nearest the top first, one at a time. */
  private async paintNear(): Promise<void> {
    if (this.painting) return;
    this.painting = true;
    try {
      for (;;) {
        if (this.destroyed) return;
        const index = this.tiles.findIndex((t) => t.near && !t.painted);
        if (index < 0) return;
        const tile = this.tiles[index];
        tile.painted = true;
        try {
          await this.host.paintPreview(tile.canvas, index, TILE_WIDTH);
        } catch {
          // A page that cannot be previewed stays blank; the export says why.
        }
        // Scrolled away (or closed) while painting: give the memory back.
        if (!tile.near || this.destroyed) {
          releaseCanvas(tile.canvas);
          tile.painted = false;
        }
      }
    } finally {
      this.painting = false;
    }
  }
}

function aspectOf(size: { width: number; height: number }): string {
  return size.width > 0 && size.height > 0 ? `${size.width} / ${size.height}` : "1 / 1.414";
}

/** The PDF as a `File` the platform's share sheet will take, or `null` where there is none. */
function shareableFile(saved: ExportedPdf): File | null {
  if (typeof navigator.share !== "function" || typeof navigator.canShare !== "function") {
    return null;
  }
  try {
    const file = new File([saved.bytes], saved.name, { type: "application/pdf" });
    return navigator.canShare({ files: [file] }) ? file : null;
  } catch {
    return null;
  }
}
