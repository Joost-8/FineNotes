/**
 * The page sidebar: GoodNotes' thumbnail panel, opened from the leftmost
 * toolbar button.
 *
 *   .goodobsidian-pagesidebar
 *     .goodobsidian-pagesidebar-top
 *       .goodobsidian-pagesidebar-head  (Pages / Audio · ✕)
 *       .goodobsidian-pagesidebar-tabs  (Pages | Audio, as in GoodNotes)
 *     .goodobsidian-pagesidebar-pages
 *       .goodobsidian-pagesidebar-filter ("All pages ⌄" / "Bookmarks only ⌄")
 *       .goodobsidian-pagesidebar-grid
 *         .goodobsidian-thumb × N    (canvas + ribbon + page number + ⌄ menu)
 *         .goodobsidian-thumb-add    ("+ Add page")
 *       .goodobsidian-pagesidebar-empty (no bookmarks yet)
 *     .goodobsidian-pagesidebar-audio (filled by the note's audio controller)
 *
 * Tapping a thumbnail scrolls the surface to that page; the page being read is
 * outlined in the accent colour and kept in view as the reader scrolls. Every
 * page operation goes through an undoable command owned by the host, so the
 * sidebar never mutates the document itself.
 *
 * Thumbnails are only painted while the panel is open, only when on screen,
 * and only when the page's content signature changed since the last paint —
 * outlining every stroke of every page on each edit would stall an iPad.
 */

import { Menu, setIcon } from "obsidian";
import { bookmarkedPageIndexes } from "../model/page-commands";
import type { BackdropPainter, ImagePainter } from "../canvas/renderer";
import { renderPageThumbnail } from "../canvas/renderer";
import type { PaperTheme } from "../canvas/backdrop";
import { type InkDocument, type Page, isCoverRuling } from "../model/document";
import { textStyleKey } from "../model/text-style";
import { PANEL_SLIDE_MS, prefersReducedMotion } from "./motion";

export type PageAction =
  | "add-before"
  | "add-after"
  | "change-template"
  | "change-cover"
  | "duplicate"
  | "move-up"
  | "move-down"
  | "clear"
  | "delete"
  | "convert-to-notebook"
  | "bookmark"
  | "copy-link";

export interface PageSidebarCallbacks {
  onSelectPage: (index: number) => void;
  /** `anchor` is the thumbnail's "…" button, for anything that opens a popover. */
  onPageAction: (action: PageAction, index: number, anchor: HTMLElement) => void;
  /** The "Add page" tile was tapped. */
  onAddPage: (anchor: HTMLElement) => void;
  /** The ✕ in the header. */
  onClose: () => void;
}

export interface PageSidebarRenderOptions {
  painter: BackdropPainter;
  /** Draws placed images; without one thumbnails leave them out. */
  images?: ImagePainter;
  paper: PaperTheme;
  usePressure: boolean;
  highlighterAlpha: number;
}

/** The sidebar's panes: the page thumbnails, or the note's recordings. */
export type SidebarTab = "pages" | "audio";

/** Which pages the Pages tab shows: GoodNotes' "All pages" / "Bookmarks only". */
export type PageFilter = "all" | "bookmarks";

const FILTER_LABELS: Record<PageFilter, string> = {
  all: "All pages",
  bookmarks: "Bookmarks only",
};

/** Thumbnail width in CSS px; the height follows each page's own aspect ratio. */
const THUMB_WIDTH = 120;
/** Quiet time after an edit before thumbnails repaint. */
const REFRESH_DEBOUNCE_MS = 350;

interface ThumbView {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  ribbon: HTMLElement;
  label: HTMLElement;
  /** Content signature at the last paint; empty means "never painted". */
  painted: string;
  visible: boolean;
}

export class PageSidebar {
  readonly el: HTMLElement;
  /** The Audio tab's pane, for the audio controller to fill. */
  readonly audioEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly pagesEl: HTMLElement;
  private readonly filterChip: HTMLButtonElement;
  private readonly filterLabel: HTMLElement;
  private readonly emptyEl: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly tabButtons = new Map<SidebarTab, HTMLButtonElement>();
  private tab: SidebarTab = "pages";
  private filter: PageFilter = "all";
  private readonly addTile: HTMLElement;
  private readonly thumbs: ThumbView[] = [];
  private readonly observer: IntersectionObserver;

  private doc: InkDocument | null = null;
  private current = 0;
  private open = false;
  /** A single page: no way to add, duplicate or reorder pages. */
  private single = false;
  private refreshTimer = 0;
  private paintFrame = 0;
  /** The slide in or out, while it runs. */
  private slide: Animation | null = null;

  constructor(
    host: HTMLElement,
    private readonly callbacks: PageSidebarCallbacks,
    private render: PageSidebarRenderOptions,
  ) {
    this.el = host.createDiv({ cls: "goodobsidian-pagesidebar is-hidden" });
    this.el.setAttribute("role", "navigation");
    this.el.setAttribute("aria-label", "Pages");
    // Header and tabs stay put while the thumbnails scroll under them.
    const top = this.el.createDiv({ cls: "goodobsidian-pagesidebar-top" });
    const head = top.createDiv({ cls: "goodobsidian-pagesidebar-head" });
    this.titleEl = head.createDiv({ cls: "goodobsidian-pagesidebar-title", text: "Pages" });
    const close = head.createEl("button", {
      cls: "goodobsidian-pagesidebar-close clickable-icon",
      attr: { "aria-label": "Close sidebar", title: "Close sidebar" },
    });
    setIcon(close, "x");
    close.addEventListener("click", () => this.callbacks.onClose());
    const tabs = top.createDiv({
      cls: "goodobsidian-pagesidebar-tabs",
      attr: { role: "tablist" },
    });
    for (const [tab, icon, label] of [
      ["pages", "file", "Pages"],
      ["audio", "mic", "Audio"],
    ] as const) {
      const button = tabs.createEl("button", {
        cls: "goodobsidian-pagesidebar-tab clickable-icon",
        attr: { role: "tab", "aria-label": label, title: label },
      });
      setIcon(button, icon);
      button.addEventListener("click", () => this.showTab(tab));
      this.tabButtons.set(tab, button);
    }
    this.pagesEl = this.el.createDiv({ cls: "goodobsidian-pagesidebar-pages" });
    this.filterChip = this.pagesEl.createEl("button", {
      cls: "goodobsidian-pagesidebar-filter clickable-icon",
      attr: { "aria-haspopup": "menu" },
    });
    this.filterLabel = this.filterChip.createSpan();
    setIcon(
      this.filterChip.createSpan({ cls: "goodobsidian-pagesidebar-filter-caret" }),
      "chevron-down",
    );
    this.filterChip.addEventListener("click", () => this.showFilterMenu());
    this.grid = this.pagesEl.createDiv({ cls: "goodobsidian-pagesidebar-grid" });
    this.emptyEl = this.pagesEl.createDiv({
      cls: "goodobsidian-pagesidebar-empty is-hidden",
      text: "No bookmarked pages yet. Tap the ribbon on a page, or bookmark it from ⋯ in the toolbar or its ⌄ menu.",
    });
    this.audioEl = this.el.createDiv({ cls: "goodobsidian-pagesidebar-audio" });

    // Every button here carries `clickable-icon`: Obsidian gives any other
    // button a filled background, and on iPad 20 px of side padding, which
    // left a 36 px icon button no room at all for its icon.
    this.addTile = this.grid.createEl("button", { cls: "goodobsidian-thumb-add clickable-icon" });
    this.addTile.setAttribute("aria-label", "Add page");
    const plus = this.addTile.createSpan({ cls: "goodobsidian-thumb-add-icon" });
    setIcon(plus, "plus");
    this.addTile.createSpan({ text: "Add page" });
    this.addTile.addEventListener("click", () => this.callbacks.onAddPage(this.addTile));

    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const view = this.thumbs.find((t) => t.root === entry.target);
          if (view) view.visible = entry.isIntersecting;
        }
        this.schedulePaint();
      },
      { root: this.el, rootMargin: "200px 0px" },
    );
    this.showTab(this.tab);
  }

  get isOpen(): boolean {
    return this.open;
  }

  /**
   * Open or close the panel. With `animate` it slides in from the left edge
   * or back out over the page, GoodNotes' 200 ms `ease`; closing takes it out
   * of the layout at once, so the page can widen under it while it slides.
   */
  setOpen(open: boolean, animate = false): void {
    if (open === this.open) return;
    this.open = open;
    this.slide?.cancel();
    this.slide = null;
    this.el.removeClass("is-closing");
    const motion = animate && !prefersReducedMotion() && typeof this.el.animate === "function";
    if (open) {
      this.el.removeClass("is-hidden");
      this.sync();
      this.revealCurrent();
      if (motion) {
        this.slide = this.el.animate(
          [{ transform: "translateX(-100%)" }, { transform: "translateX(0)" }],
          { duration: PANEL_SLIDE_MS, easing: "ease" },
        );
      }
      return;
    }
    if (!motion) {
      this.el.addClass("is-hidden");
      return;
    }
    this.el.addClass("is-closing");
    // Held at the end until it is hidden: no frame between the slide ending
    // and `finish` being handled may show the panel back over the page.
    const slide = this.el.animate(
      [{ transform: "translateX(0)" }, { transform: "translateX(-100%)" }],
      { duration: PANEL_SLIDE_MS, easing: "ease", fill: "forwards" },
    );
    this.slide = slide;
    slide.onfinish = () => {
      if (this.slide !== slide) return;
      this.slide = null;
      this.el.removeClass("is-closing");
      this.el.addClass("is-hidden");
      // Let go of the held transform, or it would outlive the next opening.
      slide.cancel();
    };
  }

  /** Show the page thumbnails or the recordings. */
  showTab(tab: SidebarTab): void {
    this.tab = tab;
    this.pagesEl.toggleClass("is-hidden", tab !== "pages");
    this.audioEl.toggleClass("is-hidden", tab !== "audio");
    const title = tab === "pages" ? "Pages" : "Audio";
    this.el.setAttribute("aria-label", title);
    this.titleEl.setText(title);
    for (const [key, button] of this.tabButtons) {
      button.toggleClass("is-active", key === tab);
      button.setAttribute("aria-selected", key === tab ? "true" : "false");
    }
    if (tab === "pages" && this.open) {
      this.schedulePaint();
      this.revealCurrent();
    }
  }

  toggle(animate = false): boolean {
    this.setOpen(!this.open, animate);
    return this.open;
  }

  /** Show every page, or only the bookmarked ones. */
  setFilter(filter: PageFilter): void {
    this.filter = filter;
    this.applyFilter();
  }

  /**
   * Paint page `index` into `canvas` at `cssWidth`, with the sidebar's own
   * render options: the ⋯ panel's page card uses it.
   */
  paintThumbnail(canvas: HTMLCanvasElement, index: number, cssWidth: number): void {
    const page = this.doc?.pages[index];
    if (!page) return;
    renderPageThumbnail(canvas, page, this.render.painter, cssWidth, window.devicePixelRatio || 1, {
      usePressure: this.render.usePressure,
      highlighterAlpha: this.render.highlighterAlpha,
      paper: this.render.paper,
      images: this.render.images,
    });
  }

  private showFilterMenu(): void {
    const menu = new Menu();
    for (const filter of ["all", "bookmarks"] as const) {
      menu.addItem((item) =>
        item
          .setTitle(FILTER_LABELS[filter])
          .setIcon(filter === "all" ? "files" : "bookmark")
          .setChecked(this.filter === filter)
          .onClick(() => this.setFilter(filter)),
      );
    }
    const r = this.filterChip.getBoundingClientRect();
    menu.showAtPosition({ x: r.left, y: r.bottom + 4 });
  }

  /**
   * Hide the thumbnails the filter leaves out, and the "Add page" tile with
   * them: a new page is never bookmarked, so it would not show. Pages keep
   * their real numbers.
   */
  private applyFilter(): void {
    const pages = this.doc?.pages ?? [];
    const onlyMarked = this.filter === "bookmarks";
    this.filterLabel.setText(FILTER_LABELS[this.filter]);
    this.filterChip.toggleClass("is-filtered", onlyMarked);
    this.thumbs.forEach((view, index) => {
      const marked = pages[index]?.bookmarked === true;
      view.ribbon.toggleClass("is-outline", !marked);
      view.ribbon.setAttribute("title", marked ? "Remove bookmark" : "Bookmark page");
      view.root.toggleClass("is-hidden", onlyMarked && !marked);
    });
    this.addTile.toggleClass("is-hidden", onlyMarked || this.single);
    const none = onlyMarked && this.doc !== null && bookmarkedPageIndexes(this.doc).length === 0;
    this.emptyEl.toggleClass("is-hidden", !none);
    if (this.open) this.schedulePaint();
  }

  /** Paper theme or ink options changed: repaint every thumbnail. */
  setRenderOptions(render: PageSidebarRenderOptions): void {
    this.render = render;
    this.invalidate();
  }

  /** The document (or its page list) changed. Cheap: repaint is debounced. */
  setDocument(doc: InkDocument): void {
    this.doc = doc;
    if (!this.open) return;
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => this.sync(), REFRESH_DEBOUNCE_MS);
  }

  /**
   * A single page offers no "Add page" tile and no add, duplicate or move
   * actions — only "Convert to notebook". Follows the document, since one
   * leaf can show a single page and then a notebook.
   */
  setSingle(single: boolean): void {
    this.single = single;
    this.applyFilter();
  }

  /** Force every thumbnail to repaint (e.g. a PDF raster just arrived). */
  invalidate(): void {
    for (const view of this.thumbs) view.painted = "";
    if (this.open) this.schedulePaint();
  }

  /** Repaint the thumbnails of pages that place the picture at `path` (it just decoded). */
  invalidateImage(path: string): void {
    const pages = this.doc?.pages ?? [];
    this.thumbs.forEach((view, index) => {
      if (pages[index]?.images.some((image) => image.path === path)) view.painted = "";
    });
    if (this.open) this.schedulePaint();
  }

  /** Mark page `index` as the one being read. */
  setCurrentPage(index: number): void {
    if (index === this.current) return;
    this.current = index;
    this.syncCurrent();
    if (this.open) this.revealCurrent();
  }

  destroy(): void {
    window.clearTimeout(this.refreshTimer);
    window.cancelAnimationFrame(this.paintFrame);
    this.slide?.cancel();
    this.slide = null;
    this.observer.disconnect();
    this.el.remove();
  }

  // --- Internals ------------------------------------------------------------

  /** Make the DOM match the page list, then repaint what changed. */
  private sync(): void {
    window.clearTimeout(this.refreshTimer);
    const pages = this.doc?.pages ?? [];
    while (this.thumbs.length < pages.length) this.thumbs.push(this.createThumb());
    while (this.thumbs.length > pages.length) {
      const view = this.thumbs.pop();
      if (!view) break;
      this.observer.unobserve(view.root);
      view.root.remove();
    }
    this.thumbs.forEach((view, index) => {
      view.label.setText(String(index + 1));
      view.canvas.setCssStyles({ aspectRatio: aspectOf(pages[index]) });
    });
    // "Add page" takes the shape of the page it would add: a copy of the last.
    const last = pages[pages.length - 1];
    this.addTile.setCssStyles({ aspectRatio: last ? aspectOf(last) : "" });
    this.applyFilter();
    this.syncCurrent();
    this.schedulePaint();
  }

  private createThumb(): ThumbView {
    const root = createDiv({ cls: "goodobsidian-thumb" });
    this.grid.insertBefore(root, this.addTile);
    const frame = root.createEl("button", { cls: "goodobsidian-thumb-frame clickable-icon" });
    const canvas = frame.createEl("canvas", { cls: "goodobsidian-thumb-canvas" });
    // GoodNotes' ribbon at the top right of every page: an outline, filled
    // red when the page is bookmarked. A tap on it toggles the bookmark.
    const ribbon = frame.createSpan({ cls: "goodobsidian-thumb-ribbon is-outline" });
    setIcon(ribbon, "bookmark");
    const footer = root.createDiv({ cls: "goodobsidian-thumb-footer" });
    const label = footer.createSpan({ cls: "goodobsidian-thumb-number" });
    const more = footer.createEl("button", { cls: "goodobsidian-thumb-more clickable-icon" });
    setIcon(more, "chevron-down");
    more.setAttribute("aria-label", "Page options");

    const view: ThumbView = { root, canvas, ribbon, label, painted: "", visible: false };
    frame.addEventListener("click", (event) => {
      const index = this.thumbs.indexOf(view);
      if (index < 0) return;
      // The ribbon lies inside the page's button: a tap on it bookmarks.
      if ((event.target as Element | null)?.closest(".goodobsidian-thumb-ribbon")) {
        this.callbacks.onPageAction("bookmark", index, ribbon);
        return;
      }
      this.callbacks.onSelectPage(index);
    });
    more.addEventListener("click", (event) => {
      const index = this.thumbs.indexOf(view);
      if (index >= 0) this.showMenu(index, event, more);
    });
    this.observer.observe(root);
    return view;
  }

  private syncCurrent(): void {
    this.thumbs.forEach((view, index) => {
      const active = index === this.current;
      view.root.toggleClass("is-current", active);
      view.root
        .querySelector(".goodobsidian-thumb-frame")
        ?.setAttribute("aria-current", active ? "page" : "false");
    });
  }

  private revealCurrent(): void {
    const view = this.thumbs[this.current];
    if (!view) return;
    // Scroll only the panel. `scrollIntoView` would also scroll every scrollable
    // ancestor, including Obsidian's own workspace on iPad.
    const panel = this.el.getBoundingClientRect();
    const box = view.root.getBoundingClientRect();
    if (box.top < panel.top) this.el.scrollTop -= panel.top - box.top + 12;
    else if (box.bottom > panel.bottom) this.el.scrollTop += box.bottom - panel.bottom + 12;
  }

  private schedulePaint(): void {
    if (!this.open || this.paintFrame) return;
    this.paintFrame = window.requestAnimationFrame(() => {
      this.paintFrame = 0;
      this.paintVisible();
    });
  }

  private paintVisible(): void {
    const pages = this.doc?.pages ?? [];
    const dpr = window.devicePixelRatio || 1;
    this.thumbs.forEach((view, index) => {
      const page = pages[index];
      if (!page || !view.visible) return;
      const signature = pageSignature(page);
      if (signature === view.painted) return;
      renderPageThumbnail(view.canvas, page, this.render.painter, THUMB_WIDTH, dpr, {
        usePressure: this.render.usePressure,
        highlighterAlpha: this.render.highlighterAlpha,
        paper: this.render.paper,
        images: this.render.images,
      });
      view.painted = signature;
    });
  }

  private showMenu(index: number, event: MouseEvent, anchor: HTMLElement): void {
    const total = this.doc?.pages.length ?? 0;
    const backdrop = this.doc?.pages[index]?.backdrop;
    const cover = !!backdrop && backdrop.kind !== "pdf" && isCoverRuling(backdrop.kind);
    const act = (action: PageAction) => () => this.callbacks.onPageAction(action, index, anchor);
    const menu = new Menu();
    const marked = this.doc?.pages[index]?.bookmarked === true;
    menu.addItem((item) =>
      item
        .setTitle(marked ? "Remove bookmark" : "Bookmark page")
        .setIcon(marked ? "bookmark-minus" : "bookmark")
        .onClick(act("bookmark")),
    );
    menu.addItem((item) =>
      item.setTitle("Copy link to page").setIcon("link").onClick(act("copy-link")),
    );
    menu.addSeparator();
    if (this.single) {
      menu.addItem((item) =>
        item
          .setTitle("Convert to notebook")
          .setIcon("book-open")
          .onClick(act("convert-to-notebook")),
      );
      menu.addSeparator();
    } else {
      menu.addItem((item) =>
        item.setTitle("Add page before").setIcon("file-plus").onClick(act("add-before")),
      );
      menu.addItem((item) =>
        item.setTitle("Add page after").setIcon("file-plus-2").onClick(act("add-after")),
      );
      menu.addSeparator();
      menu.addItem((item) =>
        item.setTitle("Duplicate page").setIcon("copy").onClick(act("duplicate")),
      );
    }
    // A cover is not paper: it changes design and colour, not template.
    if (cover) {
      menu.addItem((item) =>
        item.setTitle("Change cover").setIcon("palette").onClick(act("change-cover")),
      );
    } else {
      menu.addItem((item) =>
        item.setTitle("Change template").setIcon("layout-template").onClick(act("change-template")),
      );
    }
    if (!this.single) {
      menu.addItem((item) =>
        item
          .setTitle("Move up")
          .setIcon("arrow-up")
          .setDisabled(index <= 0)
          .onClick(act("move-up")),
      );
      menu.addItem((item) =>
        item
          .setTitle("Move down")
          .setIcon("arrow-down")
          .setDisabled(index >= total - 1)
          .onClick(act("move-down")),
      );
    }
    menu.addSeparator();
    menu.addItem((item) =>
      item.setTitle("Clear page").setIcon("x-circle").setWarning(true).onClick(act("clear")),
    );
    menu.addItem((item) =>
      item
        .setTitle("Delete page")
        .setIcon("trash-2")
        .setWarning(true)
        .setDisabled(total <= 1)
        .onClick(act("delete")),
    );
    menu.showAtMouseEvent(event);
  }
}

/** A page's CSS `aspect-ratio`, or "" (the stylesheet default) if degenerate. */
function aspectOf(page: Page): string {
  const { width, height } = page.geometry;
  return width > 0 && height > 0 ? `${width} / ${height}` : "";
}

/**
 * A cheap fingerprint of everything a thumbnail shows. Not a hash of every
 * coordinate — that would cost as much as painting — but it moves whenever a
 * stroke is added, erased, split, moved or snapped, a text box or an image
 * changes, or the paper does. A stroke move shifts its first point; a snap or
 * a partial erase changes its point count.
 */
function pageSignature(page: Page): string {
  let strokes = 0;
  for (const stroke of page.strokes) {
    const x = stroke.pts[0] ?? 0;
    const y = stroke.pts[1] ?? 0;
    strokes = (strokes * 31 + stroke.pts.length + x * 7 + y * 13 + stroke.id.length) % 1e9;
  }
  const text = page.textBoxes
    .map((t) => `${t.x},${t.y},${t.w},${t.h ?? ""},${textStyleKey(t)},${t.text}`)
    .join("|");
  const images = page.images
    .map((i) => `${i.path},${i.x},${i.y},${i.w},${i.h},${i.rotation ?? 0}`)
    .join("|");
  return [
    page.id,
    page.strokes.length,
    page.strokes[page.strokes.length - 1]?.id ?? "",
    strokes.toFixed(2),
    text,
    images,
    JSON.stringify(page.backdrop),
    page.geometry.width,
    page.geometry.height,
  ].join("#");
}
