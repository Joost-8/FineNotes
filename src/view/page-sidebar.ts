/**
 * The page sidebar: GoodNotes' thumbnail panel, opened from the leftmost
 * toolbar button.
 *
 *   .goodobsidian-pagesidebar          (.is-overview: the full-pane grid; .is-selecting)
 *     .goodobsidian-pagesidebar-top
 *       .goodobsidian-pagesidebar-head  (⤢ · Pages / Contents / Audio · ✕;
 *                                         overview: ⤡ or Select all · Pages · Select or Done)
 *       .goodobsidian-pagesidebar-tabs  (Pages | Contents | Audio)
 *     .goodobsidian-pagesidebar-pages
 *       .goodobsidian-pagesidebar-filter ("All pages ⌄" / "Bookmarks only ⌄" / "In the contents ⌄")
 *       .goodobsidian-pagesidebar-grid
 *         .goodobsidian-thumb × N    (canvas + ribbon + tick + page number + ⌄ menu)
 *         .goodobsidian-thumb-add    ("+ Add page")
 *       .goodobsidian-pagesidebar-empty (no page passes the filter yet)
 *     .goodobsidian-pagesidebar-contents
 *       .goodobsidian-contents-list
 *         .goodobsidian-contents-row × N  (› fold · title · page number · ⌄ menu)
 *           .is-section: a heading inside a page (smaller, muted)
 *           .is-sub: one under its page's title, folding with it
 *       .goodobsidian-contents-empty
 *       .goodobsidian-contents-add  ("Add page N to contents")
 *     .goodobsidian-pagesidebar-audio (filled by the note's audio controller)
 *     .goodobsidian-pagesidebar-selectbar (overview, Select: Move · Duplicate · Bookmark · Export · Delete)
 *   .goodobsidian-pagesidebar-spacer  (holds the panel's width while the overview covers the page)
 *
 * The Contents tab is the notebook's table of contents: every page given a
 * title (model/contents.ts), in page order, as a heading, with the headings
 * lassoed inside that page (sections) folding away under it; sections on a
 * page without a title are listed on their own. Tapping one goes to its
 * page, or to its line, and the entry being read is marked as the reader
 * scrolls, each entry running on until the next.
 *
 * Tapping a thumbnail scrolls the surface to that page; the page being read is
 * outlined in the accent colour and kept in view as the reader scrolls. Every
 * page operation goes through an undoable command owned by the host, so the
 * sidebar never mutates the document itself.
 *
 * Pages are reordered by dragging their thumbnails (page-drag.ts): with the
 * mouse or the Pencil at once, with a finger after resting on the page. Under
 * a filter a drop lands next to the shown page it is dropped beside, in the
 * whole page list.
 *
 * The ⤢ button grows the panel into the **overview**: every page in a grid
 * filling the notebook view, GoodNotes' page grid. A tap opens a page and
 * goes back; ⤡ or Escape goes back without. Select (or Shift/Cmd-click on a
 * desktop) picks several pages, to move, duplicate, bookmark, export or
 * delete together, or to drag as one block.
 *
 * Thumbnails are only painted while the panel is open, only when on screen,
 * and only when the page's content signature changed since the last paint —
 * outlining every stroke of every page on each edit would stall an iPad.
 * Those scrolled out of view keep their pixels only up to a budget
 * ({@link KEEP_PAINTED_OFFSCREEN}); older ones give their canvas memory back
 * and are painted again if they return.
 */

import { Menu, setIcon } from "obsidian";
import {
  type ContentsEntry,
  contentsEntries,
  contentsTree,
  currentContentsEntry,
} from "../model/contents";
import type { PageSection } from "../model/document";
import type { BackdropPainter, ImagePainter } from "../canvas/renderer";
import { renderPageThumbnail } from "../canvas/renderer";
import type { PaperTheme } from "../canvas/backdrop";
import { type InkDocument, type Page, isCoverRuling } from "../model/document";
import { releaseCanvas } from "./image-import";
import { pageSignature } from "../model/page-signature";
import { PANEL_SLIDE_MS, prefersReducedMotion } from "./motion";
import { PageDrag } from "./page-drag";
import { rangeOf } from "./page-drag-model";

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
  | "copy-link"
  /** Add the page to the contents, or rename its entry: the host asks for the title. */
  | "contents"
  | "contents-remove";

/** What a section's ⌄ menu can do. */
export type SectionAction = "rename" | "remove";

/** What the overview's selection bar does to the selected pages. */
export type SelectionAction =
  "move-start" | "move-end" | "duplicate" | "bookmark" | "export" | "delete";

export interface PageSidebarCallbacks {
  /** A page was tapped; `fromOverview` when the overview closes to show it (jump, do not glide). */
  onSelectPage: (index: number, fromOverview?: boolean) => void;
  /** A section in the Contents tab was tapped: go to its line on page `index`. */
  onSelectSection?: (index: number, section: PageSection) => void;
  /** Rename or remove a section, from its ⌄ menu. */
  onSectionAction?: (
    action: SectionAction,
    index: number,
    section: PageSection,
    anchor: HTMLElement,
  ) => void;
  /** `anchor` is the thumbnail's "…" button, for anything that opens a popover. */
  onPageAction: (action: PageAction, index: number, anchor: HTMLElement) => void;
  /** The "Add page" tile was tapped. */
  onAddPage: (anchor: HTMLElement) => void;
  /** The ✕ in the header. */
  onClose: () => void;
  /** Whether pages may be reordered now (not on a protected note). Default: yes. */
  canEdit?: () => boolean;
  /** Pages were dragged: move `indexes` to gap `gap` of the page list (page-order.ts). */
  onMovePages?: (indexes: number[], gap: number) => void;
  /** An action from the overview's selection bar, on `indexes` in page order. */
  onSelectionAction?: (action: SelectionAction, indexes: number[], anchor: HTMLElement) => void;
  /** The overview opened or closed. */
  onOverviewChange?: (open: boolean) => void;
}

export interface PageSidebarRenderOptions {
  painter: BackdropPainter;
  /** Draws placed images; without one thumbnails leave them out. */
  images?: ImagePainter;
  paper: PaperTheme;
  usePressure: boolean;
  highlighterAlpha: number;
}

/** The sidebar's panes: the page thumbnails, the contents, or the note's recordings. */
export type SidebarTab = "pages" | "contents" | "audio";

const TAB_TITLES: Record<SidebarTab, string> = {
  pages: "Pages",
  contents: "Contents",
  audio: "Audio",
};

/**
 * Which pages the Pages tab shows: GoodNotes' "All pages" / "Bookmarks only",
 * or the pages listed in the contents (a title, or headings inside).
 */
export type PageFilter = "all" | "bookmarks" | "contents";

const FILTERS: Record<PageFilter, { label: string; icon: string; empty: string }> = {
  all: { label: "All pages", icon: "files", empty: "" },
  bookmarks: {
    label: "Bookmarks only",
    icon: "bookmark",
    empty:
      "No bookmarked pages yet. Tap the ribbon on a page, or bookmark it from ⋯ in the toolbar or its ⌄ menu.",
  },
  contents: {
    label: "In the contents",
    icon: "list",
    empty: "No pages in the contents yet. Give a page a title, or add a heading, from its ⌄ menu.",
  },
};

/** Whether `page` passes `filter`. */
export function pagePassesFilter(page: Page, filter: PageFilter): boolean {
  if (filter === "bookmarks") return page.bookmarked === true;
  if (filter === "contents") return page.title !== undefined || (page.sections?.length ?? 0) > 0;
  return true;
}

/**
 * The name shown under a page's thumbnail: its title in the contents, or
 * else its topmost heading; empty for a page in neither.
 */
export function thumbnailTitleOf(page: Page | undefined): string {
  if (!page) return "";
  if (page.title !== undefined) return page.title;
  let top: { title: string; y: number } | undefined;
  for (const section of page.sections ?? []) if (!top || section.y < top.y) top = section;
  return top?.title ?? "";
}

/** Thumbnail width in CSS px; the height follows each page's own aspect ratio. */
const THUMB_WIDTH = 120;

/**
 * The overview's thumbnails are painted this wide: its columns are 170-260
 * CSS px. PDF backdrops keep their thumbnail rasters ({@link thumbnailRasterScale},
 * already double the sidebar's width), so the overview asks the PDF cache for
 * nothing larger than the sidebar does.
 */
const OVERVIEW_THUMB_WIDTH = 240;

/**
 * The scale a PDF backdrop is rasterised at for a thumbnail, in the units of
 * `InkSurface.deviceScale` (device px per page px, for a page about 1024 page
 * px wide), doubled to stay sharp. Asking for the page view's own scale here
 * made a dozen thumbnails each want a page-sized raster (FineNotes#1).
 */
export function thumbnailRasterScale(dpr: number): number {
  return (THUMB_WIDTH * dpr * 2) / 1024;
}
/** Quiet time after an edit before thumbnails repaint. */
const REFRESH_DEBOUNCE_MS = 350;

/**
 * How many painted thumbnails stay painted out of view, the least recently
 * seen given back first. A thumbnail's canvas is ~330 KB at an iPad's pixel
 * ratio, and keeping every one painted held 325 MB after a scroll through
 * 1,000 pages: past what an iPad's web view grants canvases, where a canvas
 * then draws nothing (research/SCALE.md). Forty is a few screens either way.
 */
export const KEEP_PAINTED_OFFSCREEN = 40;

/** The same budget in the overview, whose canvases each hold four times the pixels. */
const KEEP_PAINTED_OFFSCREEN_OVERVIEW = 10;

interface ThumbView {
  root: HTMLElement;
  /** The page it shows, by identity: a page that moves keeps its thumbnail and its pixels. */
  page: Page | null;
  canvas: HTMLCanvasElement;
  ribbon: HTMLElement;
  label: HTMLElement;
  /** The page's title in the contents, beside its number; empty when it has none. */
  title: HTMLElement;
  /** Content signature at the last paint; empty means "never painted". */
  painted: string;
  /** The canvas holds pixels (it was painted and not given back since). */
  held: boolean;
  visible: boolean;
  /** When it was last on screen, as a paint count: the oldest is given back first. */
  seen: number;
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
  private readonly contentsEl: HTMLElement;
  private readonly contentsList: HTMLElement;
  private readonly contentsEmpty: HTMLElement;
  private readonly contentsAdd: HTMLButtonElement;
  private readonly contentsAddLabel: HTMLElement;
  /** The contents as last rendered, one row each, and the heading row each sub row is under. */
  private contentsItems: ContentsEntry[] = [];
  private contentsRows: Array<{ row: HTMLElement; heading: number }> = [];
  /** Headings folded shut, by their page's id: kept while the view is open. */
  private readonly folded = new Set<string>();
  /** How far down the page being read the reader is, page px; Infinity when unknown. */
  private currentY = Infinity;
  /** The entry marked as being read, so a scroll only touches the rows when it changes. */
  private currentEntry = -2;
  private readonly tabButtons = new Map<SidebarTab, HTMLButtonElement>();
  private tab: SidebarTab = "pages";
  private filter: PageFilter = "all";
  private readonly addTile: HTMLElement;
  private thumbs: ThumbView[] = [];
  private readonly drag: PageDrag;
  /** The header's ⤢ / ⤡, and the overview's Select all and Select / Done. */
  private readonly expandButton: HTMLButtonElement;
  private readonly selectAllButton: HTMLButtonElement;
  private readonly selectButton: HTMLButtonElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly tabsEl: HTMLElement;
  private readonly selectBar: HTMLElement;
  private readonly selectBarButtons = new Map<SelectionAction | "move", HTMLButtonElement>();
  /** Holds the docked panel's width in the layout while the overview covers the page. */
  private readonly spacer: HTMLElement;
  /** The overview: every page in a grid over the whole notebook view. */
  private overview = false;
  /** Select mode in the overview: a tap ticks a page instead of opening it. */
  private selecting = false;
  /** The ticked pages, by identity, so a selection survives pages moving. */
  private readonly selected = new Set<Page>();
  /** Where a Shift-click range starts: the page ticked last. */
  private anchor: Page | null = null;
  /** The overview's open or close animation, while it runs. */
  private zoom: Animation | null = null;
  /** Each thumbnail by its root element, for the intersection observer. */
  private readonly viewOf = new Map<Element, ThumbView>();
  /** Paint passes so far: the clock {@link ThumbView.seen} counts on. */
  private paints = 0;
  private readonly observer: IntersectionObserver;

  private doc: InkDocument | null = null;
  private current = 0;
  private open = false;
  /** A single page: no way to add, duplicate or reorder pages. */
  private single = false;
  /** A practice file: its pages and their paper are fixed; they can only be cleared. */
  private fixed = false;
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
    this.expandButton = head.createEl("button", {
      cls: "goodobsidian-pagesidebar-expand clickable-icon",
    });
    this.expandButton.addEventListener("click", () => this.setOverview(!this.overview, true));
    this.selectAllButton = head.createEl("button", {
      cls: "goodobsidian-pagesidebar-textbutton goodobsidian-pagesidebar-selectall clickable-icon",
    });
    this.selectAllButton.addEventListener("click", () => this.toggleSelectAll());
    this.titleEl = head.createDiv({ cls: "goodobsidian-pagesidebar-title", text: "Pages" });
    const close = head.createEl("button", {
      cls: "goodobsidian-pagesidebar-close clickable-icon",
      attr: { "aria-label": "Close sidebar", title: "Close sidebar" },
    });
    setIcon(close, "x");
    close.addEventListener("click", () => this.callbacks.onClose());
    this.closeButton = close;
    this.selectButton = head.createEl("button", {
      cls: "goodobsidian-pagesidebar-textbutton goodobsidian-pagesidebar-select clickable-icon",
    });
    this.selectButton.addEventListener("click", () => this.setSelecting(!this.selecting));
    const tabs = top.createDiv({
      cls: "goodobsidian-pagesidebar-tabs",
      attr: { role: "tablist" },
    });
    for (const [tab, icon] of [
      ["pages", "file"],
      ["contents", "table-of-contents"],
      ["audio", "mic"],
    ] as const) {
      const label = TAB_TITLES[tab];
      const button = tabs.createEl("button", {
        cls: "goodobsidian-pagesidebar-tab clickable-icon",
        attr: { role: "tab", "aria-label": label, title: label },
      });
      setIcon(button, icon);
      button.addEventListener("click", () => this.showTab(tab));
      this.tabButtons.set(tab, button);
    }
    this.tabsEl = tabs;
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
    this.emptyEl = this.pagesEl.createDiv({ cls: "goodobsidian-pagesidebar-empty is-hidden" });
    this.contentsEl = this.el.createDiv({ cls: "goodobsidian-pagesidebar-contents" });
    this.contentsList = this.contentsEl.createDiv({
      cls: "goodobsidian-contents-list",
      attr: { role: "list" },
    });
    this.contentsEmpty = this.contentsEl.createDiv({
      cls: "goodobsidian-contents-empty",
      text: "Nothing in the contents yet. Give a page a title here, from ⋯ in the toolbar, or from its ⌄ menu, and it starts a section.",
    });
    this.contentsAdd = this.contentsEl.createEl("button", {
      cls: "goodobsidian-contents-add clickable-icon",
    });
    setIcon(this.contentsAdd.createSpan({ cls: "goodobsidian-contents-add-icon" }), "list-plus");
    this.contentsAddLabel = this.contentsAdd.createSpan();
    this.contentsAdd.addEventListener("click", () =>
      this.callbacks.onPageAction("contents", this.current, this.contentsAdd),
    );
    this.audioEl = this.el.createDiv({ cls: "goodobsidian-pagesidebar-audio" });
    this.selectBar = this.el.createDiv({
      cls: "goodobsidian-pagesidebar-selectbar is-hidden",
      attr: { role: "toolbar", "aria-label": "Selected pages" },
    });
    for (const [action, icon, label] of [
      ["move", "arrow-up-down", "Move"],
      ["duplicate", "copy", "Duplicate"],
      ["bookmark", "bookmark", "Bookmark"],
      ["export", "share", "Export"],
      ["delete", "trash-2", "Delete"],
    ] as const) {
      const button = this.selectBar.createEl("button", {
        cls: "goodobsidian-pagesidebar-selectbar-button clickable-icon",
        attr: { "aria-label": label },
      });
      button.toggleClass("mod-warning", action === "delete");
      setIcon(button.createSpan({ cls: "goodobsidian-pagesidebar-selectbar-icon" }), icon);
      button.createSpan({ cls: "goodobsidian-pagesidebar-selectbar-label", text: label });
      button.addEventListener("click", (event) => {
        if (action === "move") this.showMoveMenu(event, button);
        else this.selectionAction(action, button);
      });
      this.selectBarButtons.set(action, button);
    }
    // Holds the panel's width while the overview covers the page, so the
    // page underneath keeps its size and place (and needs no relayout).
    this.spacer = host.createDiv({ cls: "goodobsidian-pagesidebar-spacer is-hidden" });
    // Obsidian's swipe recogniser opens its own sidebars on a sideways swipe:
    // not while a page is dragged across this panel (CLAUDE.md ledger).
    this.el.dataset.ignoreSwipe = "true";

    // Every button here carries `clickable-icon`: Obsidian gives any other
    // button a filled background, and on iPad 20 px of side padding, which
    // left a 36 px icon button no room at all for its icon.
    this.addTile = this.grid.createEl("button", { cls: "goodobsidian-thumb-add clickable-icon" });
    this.addTile.setAttribute("aria-label", "Add page");
    const plus = this.addTile.createSpan({ cls: "goodobsidian-thumb-add-icon" });
    setIcon(plus, "plus");
    this.addTile.createSpan({ text: "Add page" });
    this.addTile.addEventListener("click", () => this.callbacks.onAddPage(this.addTile));

    this.drag = new PageDrag(this.el, this.grid, {
      canDrag: () =>
        this.open &&
        !this.single &&
        this.callbacks.canEdit?.() !== false &&
        !!this.callbacks.onMovePages,
      shown: () => this.shownThumbs(),
      moving: (index) => this.movingWith(index),
      visibleTop: () =>
        this.el.querySelector(".goodobsidian-pagesidebar-top")?.getBoundingClientRect().bottom ?? 0,
      onDrop: (indexes, gap) => this.callbacks.onMovePages?.(indexes, gap),
      onPenTap: (index, target, event) => this.tapThumb(index, target, event),
    });

    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const view = this.viewOf.get(entry.target);
          if (view) view.visible = entry.isIntersecting;
        }
        this.schedulePaint();
      },
      { root: this.el, rootMargin: "200px 0px" },
    );
    this.showTab(this.tab);
    this.syncChrome();
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
    if (!open) {
      this.drag.cancel();
      this.setOverview(false);
    }
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

  /** Whether the overview (every page in a grid over the notebook view) is showing. */
  get isOverview(): boolean {
    return this.overview;
  }

  /**
   * Grow the panel into the overview, or back. The overview always shows
   * the pages; leaving it ends Select. With `animate` it zooms open.
   */
  setOverview(on: boolean, animate = false): void {
    if (on === this.overview || (on && (!this.open || this.single))) return;
    this.drag.cancel();
    const docked = this.el.offsetWidth;
    const floating = this.el.win.getComputedStyle(this.el).position === "absolute";
    this.overview = on;
    if (!on) this.setSelecting(false);
    if (on && this.tab !== "pages") this.showTab("pages");
    this.spacer.setCssStyles({ width: on && !floating ? `${docked}px` : "" });
    this.spacer.toggleClass("is-hidden", !on || floating);
    this.el.toggleClass("is-overview", on);
    this.zoom?.cancel();
    this.zoom = null;
    // It zooms open from the panel; going back, the page is simply there again.
    if (on && animate && !prefersReducedMotion() && typeof this.el.animate === "function") {
      this.zoom = this.el.animate(
        [
          { opacity: 0, transform: "scale(0.97)" },
          { opacity: 1, transform: "scale(1)" },
        ],
        { duration: PANEL_SLIDE_MS, easing: "ease" },
      );
    }
    this.syncChrome();
    // A thumbnail is painted for the width it shows at.
    for (const view of this.thumbs) view.painted = "";
    this.schedulePaint();
    this.revealCurrent();
    this.callbacks.onOverviewChange?.(on);
  }

  /** Select mode in the overview: taps tick pages, and the selection bar shows. */
  setSelecting(on: boolean): void {
    if (on && !this.overview) return;
    if (on === this.selecting) return;
    this.selecting = on;
    if (!on) {
      this.selected.clear();
      this.anchor = null;
    }
    this.syncChrome();
    this.syncSelection();
  }

  /**
   * A key while this panel is in charge: Escape drops a drag, leaves Select,
   * then leaves the overview; in the overview Cmd/Ctrl+A selects every page
   * and Delete deletes the selection. True if the key was taken.
   */
  handleKeyDown(event: KeyboardEvent): boolean {
    if (!this.open) return false;
    if (event.key === "Escape") {
      if (this.drag.active) this.drag.cancel();
      else if (this.selecting) this.setSelecting(false);
      else if (this.overview) this.setOverview(false, true);
      else return false;
      event.preventDefault();
      return true;
    }
    if (!this.overview || this.tab !== "pages") return false;
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "a") {
      event.preventDefault();
      this.setSelecting(true);
      this.selectShown(true);
      return true;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && this.selected.size > 0) {
      event.preventDefault();
      this.selectionAction("delete", this.selectBarButtons.get("delete") ?? this.el);
      return true;
    }
    return false;
  }

  /** Show the page thumbnails or the recordings. */
  showTab(tab: SidebarTab): void {
    this.tab = tab;
    this.pagesEl.toggleClass("is-hidden", tab !== "pages");
    this.contentsEl.toggleClass("is-hidden", tab !== "contents");
    this.audioEl.toggleClass("is-hidden", tab !== "audio");
    const title = TAB_TITLES[tab];
    this.el.setAttribute("aria-label", title);
    this.titleEl.setText(title);
    this.syncChrome();
    for (const [key, button] of this.tabButtons) {
      button.toggleClass("is-active", key === tab);
      button.setAttribute("aria-selected", key === tab ? "true" : "false");
    }
    if (tab === "pages" && this.open) {
      this.schedulePaint();
      this.revealCurrent();
    }
    if (tab === "contents" && this.open) this.revealCurrentEntry();
  }

  toggle(animate = false): boolean {
    this.setOpen(!this.open, animate);
    return this.open;
  }

  /** Show every page, or only the bookmarked ones, or only those in the contents. */
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
    for (const filter of ["all", "bookmarks", "contents"] as const) {
      menu.addItem((item) =>
        item
          .setTitle(FILTERS[filter].label)
          .setIcon(FILTERS[filter].icon)
          .setChecked(this.filter === filter)
          .onClick(() => this.setFilter(filter)),
      );
    }
    const r = this.filterChip.getBoundingClientRect();
    menu.showAtPosition({ x: r.left, y: r.bottom + 4 });
  }

  /**
   * Hide the thumbnails the filter leaves out, and the "Add page" tile with
   * them: a new page is neither bookmarked nor in the contents, so it would
   * not show. Pages keep their real numbers.
   */
  private applyFilter(): void {
    const pages = this.doc?.pages ?? [];
    const filtered = this.filter !== "all";
    this.filterLabel.setText(FILTERS[this.filter].label);
    this.filterChip.toggleClass("is-filtered", filtered);
    let shown = 0;
    this.thumbs.forEach((view, index) => {
      const page = pages[index];
      const marked = page?.bookmarked === true;
      view.ribbon.toggleClass("is-outline", !marked);
      view.ribbon.setAttribute("title", marked ? "Remove bookmark" : "Bookmark page");
      const passes = !filtered || (page !== undefined && pagePassesFilter(page, this.filter));
      if (passes) shown++;
      view.root.toggleClass("is-hidden", !passes);
    });
    this.addTile.toggleClass("is-hidden", filtered || this.single);
    const none = filtered && this.doc !== null && shown === 0;
    this.emptyEl.setText(FILTERS[this.filter].empty);
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
  setSingle(single: boolean, fixed = false): void {
    this.single = single || fixed;
    this.fixed = fixed;
    if (this.single) this.setOverview(false);
    this.applyFilter();
    this.syncChrome();
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

  /** Repaint the thumbnails of pages backed by page `pdfPage` of the PDF at `path` (it just rasterised). */
  invalidatePdfPage(path: string, pdfPage: number): void {
    const pages = this.doc?.pages ?? [];
    this.thumbs.forEach((view, index) => {
      const backdrop = pages[index]?.backdrop;
      if (backdrop?.kind === "pdf" && backdrop.path === path && backdrop.page === pdfPage) {
        view.painted = "";
      }
    });
    if (this.open) this.schedulePaint();
  }

  /**
   * Where the reader is, page `index` and `y` page px down it, as the page
   * scrolls: marks the contents entry being read, without moving the panel.
   */
  setReadingPoint(index: number, y: number): void {
    if (index !== this.current) {
      this.currentY = y;
      this.setCurrentPage(index);
      return;
    }
    this.currentY = y;
    this.syncCurrentEntry();
  }

  /** Mark page `index` as the one being read. */
  setCurrentPage(index: number): void {
    if (index === this.current) return;
    this.current = index;
    this.syncCurrent();
    if (this.open) {
      if (this.tab === "contents") this.revealCurrentEntry();
      else this.revealCurrent();
    }
  }

  /** Bring the thumbnails up to date now, not after the edit debounce (a drop just landed). */
  flush(): void {
    if (this.open) this.sync();
  }

  destroy(): void {
    window.clearTimeout(this.refreshTimer);
    window.cancelAnimationFrame(this.paintFrame);
    this.slide?.cancel();
    this.slide = null;
    this.zoom?.cancel();
    this.zoom = null;
    this.drag.destroy();
    this.observer.disconnect();
    this.el.remove();
    this.spacer.remove();
  }

  // --- Internals ------------------------------------------------------------

  /** Make the DOM match the page list, then repaint what changed. */
  private sync(): void {
    window.clearTimeout(this.refreshTimer);
    const pages = this.doc?.pages ?? [];
    // Each page keeps its own thumbnail, found by identity, so a page that
    // moved keeps its pixels and nothing repaints for a reorder.
    const byPage = new Map<Page, ThumbView>();
    for (const view of this.thumbs) if (view.page) byPage.set(view.page, view);
    const next: Array<ThumbView | null> = pages.map((page) => {
      const view = byPage.get(page);
      if (view) byPage.delete(page);
      return view ?? null;
    });
    const taken = new Set(next);
    const spare = this.thumbs.filter((view) => !taken.has(view));
    const thumbs = next.map((view) => view ?? spare.shift() ?? this.createThumb());
    for (const view of spare) {
      this.observer.unobserve(view.root);
      this.viewOf.delete(view.root);
      releaseCanvas(view.canvas);
      view.root.remove();
    }
    const reordered = thumbs.some((view, index) => this.grid.children[index] !== view.root);
    this.thumbs = thumbs;
    if (reordered) for (const view of thumbs) this.grid.insertBefore(view.root, this.addTile);
    for (const page of [...this.selected]) if (!pages.includes(page)) this.selected.delete(page);
    if (this.anchor && !pages.includes(this.anchor)) this.anchor = null;
    this.thumbs.forEach((view, index) => {
      view.page = pages[index] ?? null;
      view.label.setText(String(index + 1));
      const title = thumbnailTitleOf(pages[index]);
      view.title.setText(title);
      view.title.setAttribute("title", title);
      view.title.toggleClass("is-hidden", title === "");
      view.canvas.setCssStyles({ aspectRatio: aspectOf(pages[index]) });
    });
    // "Add page" takes the shape of the page it would add: a copy of the last.
    const last = pages[pages.length - 1];
    this.addTile.setCssStyles({ aspectRatio: last ? aspectOf(last) : "" });
    this.applyFilter();
    this.renderContents();
    this.syncCurrent();
    this.syncSelection();
    this.syncChrome();
    this.schedulePaint();
  }

  /**
   * Rebuild the Contents tab: titled pages as headings, the headings inside
   * each such page under it, folded as the reader left them. A few rows:
   * cheap.
   */
  private renderContents(): void {
    const entries = this.doc ? contentsEntries(this.doc) : [];
    this.contentsItems = entries;
    this.contentsList.empty();
    const rows: Array<{ row: HTMLElement; heading: number }> = [];
    for (const node of contentsTree(entries)) {
      const pageId = this.doc?.pages[node.entry.index]?.id ?? "";
      const folded = this.folded.has(pageId);
      const heading = this.contentsRow(node.entry, node.children.length > 0 ? folded : null);
      rows[node.at] = { row: heading, heading: node.at };
      const subs = node.children.map((child) => {
        const row = this.contentsRow(child.entry, null, true);
        row.toggleClass("is-hidden", folded);
        rows[child.at] = { row, heading: node.at };
        return row;
      });
      const fold = heading.querySelector<HTMLElement>(".goodobsidian-contents-fold");
      fold?.addEventListener("click", () => {
        const shut = !this.folded.has(pageId);
        if (shut) this.folded.add(pageId);
        else this.folded.delete(pageId);
        fold.toggleClass("is-folded", shut);
        fold.setAttribute("aria-expanded", String(!shut));
        for (const row of subs) row.toggleClass("is-hidden", shut);
        this.currentEntry = -2;
        this.syncCurrent();
      });
    }
    this.contentsRows = rows;
    this.currentEntry = -2;
    this.contentsEmpty.toggleClass("is-hidden", entries.length > 0);
    this.syncContentsAdd();
  }

  /**
   * One row of the contents: a fold toggle when it heads its page's headings
   * (`folded` says how it is; null for none), the entry, and its ⌄ menu. A
   * `sub` row is listed under its page's title; a heading inside a page
   * without one lines up with the page titles instead.
   */
  private contentsRow(entry: ContentsEntry, folded: boolean | null, sub = false): HTMLElement {
    const row = this.contentsList.createDiv({
      cls: "goodobsidian-contents-row",
      attr: { role: "listitem" },
    });
    row.toggleClass("is-section", entry.section !== undefined);
    row.toggleClass("is-sub", sub);
    if (folded !== null) {
      const fold = row.createEl("button", {
        cls: "goodobsidian-contents-fold clickable-icon",
        attr: {
          "aria-label": "Show or hide this page's headings",
          "aria-expanded": String(!folded),
        },
      });
      fold.toggleClass("is-folded", folded);
      setIcon(fold, "chevron-down");
    } else if (!sub) {
      row.createSpan({ cls: "goodobsidian-contents-fold-space" });
    }
    const go = row.createEl("button", { cls: "goodobsidian-contents-entry clickable-icon" });
    go.createSpan({ cls: "goodobsidian-contents-title", text: entry.title });
    go.createSpan({ cls: "goodobsidian-contents-page", text: String(entry.index + 1) });
    go.setAttribute("aria-label", `${entry.title}, page ${entry.index + 1}`);
    const section = entry.section;
    go.addEventListener("click", () => {
      if (section) this.callbacks.onSelectSection?.(entry.index, section);
      else this.callbacks.onSelectPage(entry.index);
    });
    const more = row.createEl("button", { cls: "goodobsidian-contents-more clickable-icon" });
    setIcon(more, "chevron-down");
    more.setAttribute("aria-label", "Contents entry options");
    more.addEventListener("click", (event) => {
      if (section) this.showSectionMenu(entry.index, section, event, more);
      else this.showContentsMenu(entry.index, event, more);
    });
    return row;
  }

  private showSectionMenu(
    index: number,
    section: PageSection,
    event: MouseEvent,
    anchor: HTMLElement,
  ): void {
    const act = (action: SectionAction) => () =>
      this.callbacks.onSectionAction?.(action, index, section, anchor);
    const menu = new Menu();
    menu.addItem((item) => item.setTitle("Rename").setIcon("pencil").onClick(act("rename")));
    menu.addItem((item) =>
      item.setTitle("Remove from contents").setIcon("list-x").onClick(act("remove")),
    );
    menu.showAtMouseEvent(event);
  }

  /** "Add page N to contents", for the page being read, unless it is listed already. */
  private syncContentsAdd(): void {
    const page = this.doc?.pages[this.current];
    this.contentsAdd.toggleClass("is-hidden", !page || page.title !== undefined);
    this.contentsAddLabel.setText(`Add page ${this.current + 1} to contents`);
  }

  private showContentsMenu(index: number, event: MouseEvent, anchor: HTMLElement): void {
    const act = (action: PageAction) => () => this.callbacks.onPageAction(action, index, anchor);
    const menu = new Menu();
    menu.addItem((item) => item.setTitle("Rename").setIcon("pencil").onClick(act("contents")));
    menu.addItem((item) =>
      item.setTitle("Remove from contents").setIcon("list-x").onClick(act("contents-remove")),
    );
    menu.showAtMouseEvent(event);
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
    // The overview's Select mode: a tick at the page's corner.
    setIcon(frame.createSpan({ cls: "goodobsidian-thumb-check" }), "check");
    const footer = root.createDiv({ cls: "goodobsidian-thumb-footer" });
    const label = footer.createSpan({ cls: "goodobsidian-thumb-number" });
    const title = footer.createSpan({ cls: "goodobsidian-thumb-title" });
    const more = footer.createEl("button", { cls: "goodobsidian-thumb-more clickable-icon" });
    setIcon(more, "chevron-down");
    more.setAttribute("aria-label", "Page options");

    const view: ThumbView = {
      root,
      page: null,
      canvas,
      ribbon,
      label,
      title,
      painted: "",
      held: false,
      visible: false,
      seen: 0,
    };
    frame.addEventListener("click", (event) => {
      const index = this.thumbs.indexOf(view);
      // A drag just ended here, or the Pencil's tap was already taken.
      if (index < 0 || this.drag.consumeClick()) return;
      this.tapThumb(index, event.target instanceof Element ? event.target : frame, event);
    });
    more.addEventListener("click", (event) => {
      const index = this.thumbs.indexOf(view);
      if (index >= 0) this.showMenu(index, event, more);
    });
    this.viewOf.set(root, view);
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
    this.syncCurrentEntry();
    this.syncContentsAdd();
  }

  /**
   * Mark the entry being read: the last one at or above the reader. Under a
   * folded heading, the heading is marked instead. Touches the rows only
   * when it changes, since a scroll calls this every frame.
   */
  private syncCurrentEntry(): void {
    const reading = currentContentsEntry(this.contentsItems, this.current, this.currentY);
    const holder = this.contentsRows[reading];
    const at = holder && holder.row.hasClass("is-hidden") ? holder.heading : reading;
    if (at === this.currentEntry) return;
    this.currentEntry = at;
    this.contentsRows.forEach(({ row }, i) => {
      row.toggleClass("is-current", i === at);
      row
        .querySelector(".goodobsidian-contents-entry")
        ?.setAttribute("aria-current", i === at ? "location" : "false");
    });
  }

  /** Keep the section being read in view in the Contents tab. */
  private revealCurrentEntry(): void {
    const row = this.contentsRows.find(({ row }) => row.hasClass("is-current"))?.row;
    if (row) this.revealInPanel(row);
  }

  private revealCurrent(): void {
    const view = this.thumbs[this.current];
    if (view) this.revealInPanel(view.root);
  }

  private revealInPanel(el: HTMLElement): void {
    // Scroll only the panel. `scrollIntoView` would also scroll every scrollable
    // ancestor, including Obsidian's own workspace on iPad.
    const panel = this.el.getBoundingClientRect();
    const box = el.getBoundingClientRect();
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
    const width = this.overview ? OVERVIEW_THUMB_WIDTH : THUMB_WIDTH;
    const now = ++this.paints;
    this.thumbs.forEach((view, index) => {
      const page = pages[index];
      if (!page || !view.visible) return;
      view.seen = now;
      const signature = pageSignature(page);
      if (signature === view.painted) return;
      renderPageThumbnail(view.canvas, page, this.render.painter, width, dpr, {
        usePressure: this.render.usePressure,
        highlighterAlpha: this.render.highlighterAlpha,
        paper: this.render.paper,
        images: this.render.images,
      });
      view.painted = signature;
      view.held = true;
    });
    this.releaseOffscreen();
  }

  /**
   * Give back the canvas memory of the thumbnails out of view, beyond the
   * {@link KEEP_PAINTED_OFFSCREEN} seen most recently. The page's aspect
   * ratio is set in CSS, so a released canvas keeps its place in the grid.
   */
  private releaseOffscreen(): void {
    const keep = this.overview ? KEEP_PAINTED_OFFSCREEN_OVERVIEW : KEEP_PAINTED_OFFSCREEN;
    const hidden = this.thumbs.filter((view) => view.held && !view.visible);
    if (hidden.length <= keep) return;
    hidden.sort((a, b) => a.seen - b.seen);
    for (const view of hidden.slice(0, hidden.length - keep)) {
      releaseCanvas(view.canvas);
      view.held = false;
      view.painted = "";
    }
  }

  /**
   * A tap on page `index`'s thumbnail (a click, or the Pencil's pointerup):
   * the ribbon bookmarks; in Select mode, or with Shift or Cmd/Ctrl in the
   * overview, it ticks pages; otherwise it opens the page, and the overview
   * closes to show it.
   */
  private tapThumb(index: number, target: Element, event: MouseEvent): void {
    const page = this.doc?.pages[index];
    if (!page) return;
    const range = event.shiftKey;
    const toggle = event.metaKey || event.ctrlKey;
    if (this.overview && (this.selecting || range || toggle)) {
      this.setSelecting(true);
      if (range && this.anchor && this.doc) {
        const from = this.doc.pages.indexOf(this.anchor);
        for (const at of rangeOf(from < 0 ? index : from, index)) {
          const each = this.doc.pages[at];
          if (each && !this.thumbs[at]?.root.hasClass("is-hidden")) this.selected.add(each);
        }
      } else if (this.selected.has(page)) {
        this.selected.delete(page);
      } else {
        this.selected.add(page);
      }
      this.anchor = page;
      this.syncSelection();
      this.syncChrome();
      return;
    }
    // The ribbon lies inside the page's button: a tap on it bookmarks.
    if (target.closest(".goodobsidian-thumb-ribbon")) {
      const ribbon = this.thumbs[index]?.ribbon;
      if (ribbon) this.callbacks.onPageAction("bookmark", index, ribbon);
      return;
    }
    if (this.overview) {
      this.setOverview(false);
      this.callbacks.onSelectPage(index, true);
      return;
    }
    this.callbacks.onSelectPage(index);
  }

  /** The thumbnails the filter shows, in order, with their pages' indexes. */
  private shownThumbs(): Array<{ root: HTMLElement; index: number }> {
    const out: Array<{ root: HTMLElement; index: number }> = [];
    this.thumbs.forEach((view, index) => {
      if (!view.root.hasClass("is-hidden")) out.push({ root: view.root, index });
    });
    return out;
  }

  /** What moves when page `index` is dragged: the selection, when it is ticked; else itself. */
  private movingWith(index: number): number[] {
    const page = this.doc?.pages[index];
    if (!page || !this.selected.has(page)) return [index];
    return this.selectedIndexes();
  }

  /** The ticked pages' indexes, in page order. */
  private selectedIndexes(): number[] {
    const pages = this.doc?.pages ?? [];
    const out: number[] = [];
    pages.forEach((page, index) => {
      if (this.selected.has(page)) out.push(index);
    });
    return out;
  }

  /** Tick every page shown, or (`on` false) none. */
  private selectShown(on: boolean): void {
    this.selected.clear();
    if (on) {
      for (const { index } of this.shownThumbs()) {
        const page = this.doc?.pages[index];
        if (page) this.selected.add(page);
      }
    }
    this.anchor = null;
    this.syncSelection();
    this.syncChrome();
  }

  /** Select all, or Deselect all when every page shown is ticked. */
  private toggleSelectAll(): void {
    const shown = this.shownThumbs();
    this.selectShown(!(shown.length > 0 && this.selected.size >= shown.length));
  }

  private selectionAction(action: SelectionAction, anchor: HTMLElement): void {
    const indexes = this.selectedIndexes();
    if (indexes.length === 0) return;
    if (action === "delete" && indexes.length >= (this.doc?.pages.length ?? 0)) return;
    this.callbacks.onSelectionAction?.(action, indexes, anchor);
  }

  private showMoveMenu(event: MouseEvent, anchor: HTMLElement): void {
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle("Move to the start")
        .setIcon("arrow-up-to-line")
        .onClick(() => this.selectionAction("move-start", anchor)),
    );
    menu.addItem((item) =>
      item
        .setTitle("Move to the end")
        .setIcon("arrow-down-to-line")
        .onClick(() => this.selectionAction("move-end", anchor)),
    );
    menu.showAtMouseEvent(event);
  }

  /** Tick or untick each thumbnail as the selection says. */
  private syncSelection(): void {
    this.el.toggleClass("is-selecting", this.selecting);
    for (const view of this.thumbs) {
      const on = this.selecting && view.page !== null && this.selected.has(view.page);
      view.root.toggleClass("is-selected", on);
      const frame = view.root.querySelector(".goodobsidian-thumb-frame");
      if (this.selecting) frame?.setAttribute("aria-pressed", String(on));
      else frame?.removeAttribute("aria-pressed");
    }
  }

  /**
   * The header and selection bar for the mode: ⤢ in the panel; ⤡ and Select
   * in the overview; Select all, "N pages" and Done while selecting.
   */
  private syncChrome(): void {
    const overview = this.overview;
    const selecting = this.selecting;
    setIcon(this.expandButton, overview ? "minimize-2" : "maximize-2");
    const expandLabel = overview ? "Back to the sidebar" : "Show all pages";
    this.expandButton.setAttribute("aria-label", expandLabel);
    this.expandButton.setAttribute("title", expandLabel);
    this.expandButton.toggleClass("is-hidden", this.single || selecting);
    this.closeButton.toggleClass("is-hidden", overview);
    this.tabsEl.toggleClass("is-hidden", overview);
    this.selectButton.toggleClass("is-hidden", !overview);
    this.selectButton.setText(selecting ? "Done" : "Select");
    this.selectButton.toggleClass("is-done", selecting);
    this.selectAllButton.toggleClass("is-hidden", !selecting);
    const shown = this.shownThumbs().length;
    const all = shown > 0 && this.selected.size >= shown;
    this.selectAllButton.setText(all ? "Deselect all" : "Select all");
    const count = this.selected.size;
    if (selecting) {
      this.titleEl.setText(
        count === 0 ? "Select pages" : count === 1 ? "1 page" : `${count} pages`,
      );
    } else {
      this.titleEl.setText(TAB_TITLES[this.tab]);
    }
    this.selectBar.toggleClass("is-hidden", !selecting);
    // Moving or deleting every page means nothing (and a notebook keeps one).
    const total = this.doc?.pages.length ?? 0;
    for (const [action, button] of this.selectBarButtons) {
      const whole = (action === "delete" || action === "move") && count >= total;
      button.disabled = count === 0 || whole;
    }
    const bookmark = this.selectBarButtons.get("bookmark");
    if (bookmark) {
      const marked = count > 0 && [...this.selected].every((page) => page.bookmarked === true);
      const label = marked ? "Remove bookmark" : "Bookmark";
      bookmark.setAttribute("aria-label", label);
      bookmark.querySelector(".goodobsidian-pagesidebar-selectbar-label")?.setText(label);
      const icon = bookmark.querySelector<HTMLElement>(".goodobsidian-pagesidebar-selectbar-icon");
      if (icon) setIcon(icon, marked ? "bookmark-minus" : "bookmark");
    }
  }

  private showMenu(index: number, event: MouseEvent, anchor: HTMLElement): void {
    const total = this.doc?.pages.length ?? 0;
    const backdrop = this.doc?.pages[index]?.backdrop;
    const cover = !!backdrop && backdrop.kind !== "pdf" && isCoverRuling(backdrop.kind);
    const act = (action: PageAction) => () => this.callbacks.onPageAction(action, index, anchor);
    const menu = new Menu();
    if (this.fixed) {
      // A practice file: rubbing a page out is the one thing to do to it.
      menu.addItem((item) =>
        item.setTitle("Clear page").setIcon("x-circle").setWarning(true).onClick(act("clear")),
      );
      menu.showAtMouseEvent(event);
      return;
    }
    const marked = this.doc?.pages[index]?.bookmarked === true;
    menu.addItem((item) =>
      item
        .setTitle(marked ? "Remove bookmark" : "Bookmark page")
        .setIcon(marked ? "bookmark-minus" : "bookmark")
        .onClick(act("bookmark")),
    );
    const titled = this.doc?.pages[index]?.title !== undefined;
    menu.addItem((item) =>
      item
        .setTitle(titled ? "Rename in contents" : "Add to contents")
        .setIcon(titled ? "pencil" : "list-plus")
        .onClick(act("contents")),
    );
    if (titled) {
      menu.addItem((item) =>
        item.setTitle("Remove from contents").setIcon("list-x").onClick(act("contents-remove")),
      );
    }
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
