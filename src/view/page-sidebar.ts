/**
 * The page sidebar: GoodNotes' thumbnail panel, opened from the leftmost
 * toolbar button.
 *
 *   .goodobsidian-pagesidebar          (.is-overview: the full-pane grid; .is-selecting)
 *     .goodobsidian-pagesidebar-top
 *       .goodobsidian-pagesidebar-head  (⤢ · Pages / Contents / Files · ✕;
 *                                         overview: ⤡ or Select all · Pages · Select or Done)
 *       .goodobsidian-pagesidebar-tabs  (Pages | Contents | Files)
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
 *     .goodobsidian-pagesidebar-files
 *       .goodobsidian-files-kind      (the dropdown: Recordings, Pictures and PDFs, …)
 *       .goodobsidian-pagesidebar-audio (Recordings: filled by the note's audio controller)
 *       .goodobsidian-files-list      (any other kind: a row per file, built when shown)
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
import { t, tn } from "../i18n/translate";
import {
  FILE_KINDS,
  FILE_KIND_EMPTY,
  FILE_KIND_ICONS,
  FILE_KIND_LABELS,
  type FileKind,
  type FileRow,
  fileName,
} from "../model/notebook-files";
import {
  type ContentsEntry,
  type ContentsNode,
  contentsEntries,
  contentsTree,
  currentContentsEntry,
  levelShift,
  pageContentsEntries,
} from "../model/contents";
import type { ContentsLevel, PageChapter, PageSection } from "../model/document";
import type { BackdropPainter, ImagePainter } from "../canvas/renderer";
import { renderPageThumbnail } from "../canvas/renderer";
import { type PageTexts, furnitureText } from "../model/furniture";
import type { PaperTheme } from "../canvas/backdrop";
import { type InkDocument, type Page, isCoverRuling } from "../model/document";
import { boardDrawing, boardThumbBox } from "../model/board";
import { releaseCanvas } from "./image-import";
import { pageSignature } from "../model/page-signature";
import {
  type ClientBox,
  PANEL_SLIDE_MS,
  type PageSnapshot,
  prefersReducedMotion,
  springCurve,
} from "./motion";
import { EASE_OUT_FALLBACK, OVERVIEW_FLIGHT, springMs } from "./springs";
import { ContentsDrag } from "./contents-drag";
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
  | "contents-remove"
  /** Give the page a tab, or take it off. */
  | "tab";

/** What a section's ⌄ menu can do. */
export type SectionAction = "rename" | "remove";

/** What the overview's selection bar does to the selected pages. */
export type SelectionAction =
  "move-start" | "move-end" | "move-to" | "duplicate" | "bookmark" | "export" | "delete";

export interface PageSidebarCallbacks {
  /** A page was tapped; `fromOverview` when the overview closes to show it (jump, do not glide). */
  onSelectPage: (index: number, fromOverview?: boolean) => void;
  /**
   * A section was tapped, in the Contents tab or a page's list of its own:
   * go to its line on page `index` (`fromOverview`: jump, do not glide).
   */
  onSelectSection?: (index: number, section: PageSection, fromOverview?: boolean) => void;
  /** Rename or remove a section, from its ⌄ menu. */
  onSectionAction?: (
    action: SectionAction,
    index: number,
    section: PageSection,
    anchor: HTMLElement,
  ) => void;
  /**
   * Indent (`+1`) or outdent (`-1`) contents entry `at` (its place in
   * `contentsEntries`), from its ⌄ menu (discussion #185).
   */
  onContentsLevel?: (at: number, delta: 1 | -1) => void;
  /** Contents entry `at` was dragged to gap `gap` at `level` (`model/contents-drag.ts`). */
  onMoveContents?: (at: number, gap: number, level: ContentsLevel) => void;
  /** A new chapter of its own, standing before page `index`. */
  onNewChapter?: (index: number) => void;
  /** The ⌄ menu of a page-less chapter standing by page `index`. */
  onChapterAction?: (action: SectionAction, index: number, chapter: PageChapter) => void;
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
  /** The notebook view as it is on screen, for the overview to fly the page being read into its place. */
  pageSnapshot?: () => PageSnapshot | null;
  /**
   * The Files tab's rows for `kind` (never Recordings, which has its own
   * panel). Asked only while the tab is shown, once per showing or pick.
   */
  listFiles?: (kind: FileKind) => Promise<FileRow[]>;
  /** A file row was tapped. */
  onOpenFile?: (kind: FileKind, row: FileRow) => void;
  /** The Files tab's dropdown was changed. */
  onFileKind?: (kind: FileKind) => void;
}

export interface PageSidebarRenderOptions {
  painter: BackdropPainter;
  /** Draws placed images; without one thumbnails leave them out. */
  images?: ImagePainter;
  paper: PaperTheme;
  usePressure: boolean;
  highlighterAlpha: number;
  /** What a header's `{title}` becomes. */
  notebookTitle?: string;
}

/** The sidebar's panes: the page thumbnails, the contents, or the note's files. */
export type SidebarTab = "pages" | "contents" | "files";

function tabTitle(tab: SidebarTab, board = false): string {
  if (tab === "pages") return board ? t("view.sidebar.boards") : t("view.sidebar.pages");
  if (tab === "contents") return t("view.sidebar.contents");
  return t("view.sidebar.files");
}

/**
 * Which pages the Pages tab shows: GoodNotes' "All pages" / "Bookmarks only",
 * or the pages listed in the contents (a title, or headings inside).
 */
export type PageFilter = "all" | "bookmarks" | "contents";

function filterInfo(filter: PageFilter): { label: string; icon: string; empty: string } {
  if (filter === "all") return { label: t("view.sidebar.filterAll"), icon: "files", empty: "" };
  if (filter === "bookmarks") {
    return {
      label: t("view.sidebar.filterBookmarks"),
      icon: "bookmark",
      empty: t("view.sidebar.filterBookmarksEmpty"),
    };
  }
  return {
    label: t("view.sidebar.filterContents"),
    icon: "list",
    empty: t("view.sidebar.filterContentsEmpty"),
  };
}

/** Whether `page` passes `filter`. */
export function pagePassesFilter(page: Page, filter: PageFilter): boolean {
  if (filter === "bookmarks") return page.bookmarked === true;
  if (filter === "contents") return page.title !== undefined || (page.sections?.length ?? 0) > 0;
  return true;
}

/**
 * The name shown under a page's thumbnail: its title in the contents, or
 * else its topmost heading (sections are kept top to bottom); empty for a
 * page in neither.
 */
export function thumbnailTitleOf(page: Page | undefined): string {
  return page ? (pageContentsEntries(page, 0)[0]?.title ?? "") : "";
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
 * Past this many entries the contents open with every chapter folded, so a
 * textbook outline reads as its chapters first (discussion #185).
 */
const FOLD_CONTENTS_OVER = 40;

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
  /**
   * The page's name beside its number (its title in the contents, else its
   * first heading), hidden when it has none; a tap lists all its entries.
   */
  name: HTMLButtonElement;
  title: HTMLElement;
  /** "+2": how many more entries the page has in the contents. */
  count: HTMLElement;
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
  /** The Files tab's Recordings pane, for the audio controller to fill. */
  readonly audioEl: HTMLElement;
  private readonly filesEl: HTMLElement;
  private readonly kindSelect: HTMLSelectElement;
  private readonly filesList: HTMLElement;
  private fileKind: FileKind = "recordings";
  /** Counts list requests, so a slow answer for an older pick is dropped. */
  private filesRequest = 0;
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
  private readonly contentsChapter: HTMLButtonElement;
  /**
   * The contents as last rendered, one row each, with the entries each sits
   * inside (outermost first) and its fold key when it holds any.
   */
  private contentsItems: ContentsEntry[] = [];
  private contentsRows: Array<{ row: HTMLElement; parents: number[]; key: string | null }> = [];
  /**
   * Entries the reader folded shut (`true`) or open (`false`), by
   * `foldKey`: kept while the view is open. The rest follow `foldedByDefault`.
   */
  private readonly foldChoice = new Map<string, boolean>();
  /** Whether entries start folded: a long contents, such as a textbook outline. */
  private contentsFoldDefault = false;
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
  private readonly contentsDrag: ContentsDrag;
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
  /** The page flying into its place as the overview opens (`flyIn`): ends it early. */
  private flight: (() => void) | null = null;
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
    this.el.setAttribute("aria-label", t("view.sidebar.pages"));
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
    this.titleEl = head.createDiv({
      cls: "goodobsidian-pagesidebar-title",
      text: t("view.sidebar.pages"),
    });
    const close = head.createEl("button", {
      cls: "goodobsidian-pagesidebar-close clickable-icon",
      attr: { "aria-label": t("view.sidebar.close"), title: t("view.sidebar.close") },
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
      ["files", "folder"],
    ] as const) {
      const label = tabTitle(tab);
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
      text: t("view.sidebar.contentsEmpty"),
    });
    const adders = this.contentsEl.createDiv({ cls: "goodobsidian-contents-adders" });
    this.contentsAdd = adders.createEl("button", {
      cls: "goodobsidian-contents-add clickable-icon",
    });
    setIcon(this.contentsAdd.createSpan({ cls: "goodobsidian-contents-add-icon" }), "list-plus");
    this.contentsAddLabel = this.contentsAdd.createSpan();
    this.contentsAdd.addEventListener("click", () =>
      this.callbacks.onPageAction("contents", this.current, this.contentsAdd),
    );
    this.contentsChapter = adders.createEl("button", {
      cls: "goodobsidian-contents-new clickable-icon",
      attr: { "aria-label": t("view.contents.newChapter") },
    });
    setIcon(this.contentsChapter, "folder-plus");
    this.contentsChapter.addEventListener("click", () =>
      this.callbacks.onNewChapter?.(this.current),
    );
    this.filesEl = this.el.createDiv({ cls: "goodobsidian-pagesidebar-files" });
    this.kindSelect = this.filesEl.createEl("select", {
      cls: "dropdown goodobsidian-files-kind",
      attr: { "aria-label": t("view.sidebar.kindOfFile") },
    });
    for (const kind of FILE_KINDS) {
      this.kindSelect.createEl("option", { value: kind, text: FILE_KIND_LABELS[kind] });
    }
    this.kindSelect.addEventListener("change", () => {
      this.setFileKind(this.kindSelect.value as FileKind);
      this.callbacks.onFileKind?.(this.fileKind);
    });
    this.audioEl = this.filesEl.createDiv({ cls: "goodobsidian-pagesidebar-audio" });
    this.filesList = this.filesEl.createDiv({
      cls: "goodobsidian-files-list is-hidden",
      attr: { role: "list" },
    });
    this.selectBar = this.el.createDiv({
      cls: "goodobsidian-pagesidebar-selectbar is-hidden",
      attr: { role: "toolbar", "aria-label": t("view.sidebar.selectedPages") },
    });
    for (const [action, icon, label] of [
      ["move", "arrow-up-down", t("view.sidebar.move")],
      ["duplicate", "copy", t("common.duplicate")],
      ["bookmark", "bookmark", t("view.sidebar.bookmark")],
      ["export", "share", t("view.sidebar.export")],
      ["delete", "trash-2", t("common.delete")],
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
    this.addTile.setAttribute("aria-label", t("view.sidebar.addPage"));
    const plus = this.addTile.createSpan({ cls: "goodobsidian-thumb-add-icon" });
    setIcon(plus, "plus");
    this.addTile.createSpan({ text: t("view.sidebar.addPage") });
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
    this.contentsDrag = new ContentsDrag(this.el, this.contentsList, {
      canDrag: () =>
        this.open &&
        !this.board &&
        !this.single &&
        this.callbacks.canEdit?.() !== false &&
        !!this.callbacks.onMoveContents,
      document: () => this.doc,
      rows: () => this.contentsRows.map(({ row }) => row),
      visibleTop: () =>
        this.el.querySelector(".goodobsidian-pagesidebar-top")?.getBoundingClientRect().bottom ?? 0,
      onDrop: (at, gap, level) => this.callbacks.onMoveContents?.(at, gap, level),
      onPenTap: (at) => this.openContentsEntry(at),
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
      this.contentsDrag.cancel();
      this.setOverview(false);
      this.setSelecting(false);
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
      if (this.tab === "files") this.refreshFiles();
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
   * the pages; leaving it ends Select. With `animate` it opens with the page
   * being read flying into its place in the grid (`snapshot`, else the
   * host's `pageSnapshot`), or, without one, zooms open.
   */
  setOverview(on: boolean, animate = false, snapshot?: PageSnapshot | null): void {
    if (on === this.overview || (on && (!this.open || this.single || this.board))) return;
    const motion =
      on && animate && !prefersReducedMotion() && typeof this.el.animate === "function";
    // Before anything changes on screen.
    const from = motion ? (snapshot ?? this.callbacks.pageSnapshot?.() ?? null) : null;
    this.flight?.();
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
    this.syncChrome();
    // A thumbnail is painted for the width it shows at.
    for (const view of this.thumbs) view.painted = "";
    this.schedulePaint();
    this.revealCurrent();
    // The page flies into its place; with no page to fly, the panel zooms
    // open. Going back, the page is simply there again.
    if (motion && !(from && this.flyIn(from))) {
      this.zoom = this.el.animate(
        [
          { opacity: 0, transform: "scale(0.97)" },
          { opacity: 1, transform: "scale(1)" },
        ],
        { duration: PANEL_SLIDE_MS, easing: "ease" },
      );
    }
    this.callbacks.onOverviewChange?.(on);
  }

  /**
   * Open the overview the way a page goes into the deck: the page being
   * read leaves its place on the desk and settles into its slot in the
   * grid, the view it lay in recedes and fades, and the other pages come in
   * around it. The grid's own background is there from the first frame, so
   * nothing behind it shows through. False when the page's slot cannot be
   * found, for the plain zoom instead.
   */
  private flyIn(snap: PageSnapshot): boolean {
    const slot = this.thumbs[this.current]?.root.querySelector<HTMLElement>(
      ".goodobsidian-thumb-frame",
    );
    const host = this.el.parentElement;
    if (!slot || !host) return false;
    const to = slot.getBoundingClientRect();
    const { page, pane, image } = snap;
    if (!(to.width > 0) || !(page.width > 0) || !(pane.width > 0)) return false;
    const base = host.getBoundingClientRect();
    const k = image.width / pane.width;
    const layer = host.createDiv({ cls: "goodobsidian-overview-flight" });
    const place = (el: HTMLElement, box: ClientBox): void =>
      el.setCssStyles({
        left: `${box.left - base.left}px`,
        top: `${box.top - base.top}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
      });

    // The view as it was, with the page lifted out of it: the desk shows
    // where it lay, as it would under a page picked up.
    const view = layer.createEl("canvas", { cls: "goodobsidian-overview-flight-view" });
    view.width = image.width;
    view.height = image.height;
    const vctx = view.getContext("2d");
    if (vctx) {
      vctx.drawImage(image, 0, 0);
      vctx.fillStyle = snap.desk;
      const shadow = 12;
      vctx.fillRect(
        (page.left - pane.left - shadow) * k,
        (page.top - pane.top - shadow) * k,
        (page.width + 2 * shadow) * k,
        (page.height + 2 * shadow) * k,
      );
    }
    place(view, pane);

    // The page: its pixels as they were, where all of it showed; else (a
    // page zoomed in past the pane) the thumbnail painter draws all of it.
    const sheet = layer.createEl("canvas", { cls: "goodobsidian-overview-flight-page" });
    const whole =
      page.left >= pane.left - 1 &&
      page.top >= pane.top - 1 &&
      page.left + page.width <= pane.left + pane.width + 1 &&
      page.top + page.height <= pane.top + pane.height + 1;
    if (whole) {
      sheet.width = Math.max(1, Math.round(page.width * k));
      sheet.height = Math.max(1, Math.round(page.height * k));
      sheet
        .getContext("2d")
        ?.drawImage(
          image,
          (page.left - pane.left) * k,
          (page.top - pane.top) * k,
          page.width * k,
          page.height * k,
          0,
          0,
          sheet.width,
          sheet.height,
        );
    } else {
      this.paintThumbnail(sheet, this.current, Math.min(page.width, OVERVIEW_THUMB_WIDTH * 2));
    }
    place(sheet, page);

    const ms = springMs(OVERVIEW_FLIGHT);
    const easing = springCurve(OVERVIEW_FLIGHT, EASE_OUT_FALLBACK);
    const sx = to.width / page.width;
    const sy = to.height / page.height;
    // The slot's corners, drawn before the scale shrinks them.
    const radius = parseFloat(this.el.win.getComputedStyle(slot).borderTopLeftRadius) || 0;
    sheet.animate(
      [
        { transform: "none", borderRadius: "0px" },
        {
          transform: `translate(${to.left - page.left}px, ${to.top - page.top}px) scale(${sx}, ${sy})`,
          borderRadius: `${radius / sx}px / ${radius / sy}px`,
        },
      ],
      { duration: ms, easing, fill: "forwards" },
    );
    // The view recedes toward where the page lay, and is gone by half time.
    const origin = `${page.left + page.width / 2 - pane.left}px ${page.top + page.height / 2 - pane.top}px`;
    view.animate(
      [
        { transformOrigin: origin, transform: "scale(1)", opacity: 1 },
        { transformOrigin: origin, transform: "scale(0.88)", opacity: 0 },
      ],
      { duration: ms * 0.55, easing: "ease-out", fill: "forwards" },
    );
    // The rest of the overview comes in around the page.
    for (const part of Array.from(this.el.children)) {
      part.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: ms * 0.7,
        delay: ms * 0.2,
        easing: "ease-out",
        fill: "backwards",
      });
    }
    // Its own thumbnail shows once the page has landed on it. A timer, not
    // the animation's finish event (ledger: the browser pane delays those).
    slot.addClass("is-landing");
    const timer = window.setTimeout(() => this.flight?.(), ms);
    this.flight = () => {
      window.clearTimeout(timer);
      this.flight = null;
      slot.removeClass("is-landing");
      layer.remove();
    };
    return true;
  }

  /**
   * Select mode, in the panel or its overview: taps tick pages, the selection
   * bar shows, and dragging a ticked page takes every ticked page with it.
   */
  setSelecting(on: boolean): void {
    if (on && (!this.open || this.single || this.fixed)) return;
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
      if (this.contentsDrag.active) this.contentsDrag.cancel();
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
    if (tab !== "pages") this.setSelecting(false);
    this.pagesEl.toggleClass("is-hidden", tab !== "pages");
    this.contentsEl.toggleClass("is-hidden", tab !== "contents");
    this.filesEl.toggleClass("is-hidden", tab !== "files");
    const title = tabTitle(tab, this.board);
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
    if (tab === "files" && this.open) this.refreshFiles();
  }

  /** Which kind the Files tab lists. */
  setFileKind(kind: FileKind): void {
    this.fileKind = kind;
    this.kindSelect.value = kind;
    if (this.tab === "files" && this.open) this.refreshFiles();
  }

  /**
   * Fill the Files tab for its kind: Recordings shows the audio panel; any
   * other kind asks the host for its rows, now and not before, so an unopened
   * tab costs nothing. Rows show an icon, a name and a line under it, never a
   * preview, so a list of photos decodes none of them.
   */
  refreshFiles(): void {
    const kind = this.fileKind;
    const recordings = kind === "recordings";
    this.audioEl.toggleClass("is-hidden", !recordings);
    this.filesList.toggleClass("is-hidden", recordings);
    if (recordings || !this.callbacks.listFiles) return;
    const request = ++this.filesRequest;
    void this.callbacks.listFiles(kind).then(
      (rows) => {
        if (request === this.filesRequest) this.renderFiles(kind, rows);
      },
      () => {
        if (request === this.filesRequest) this.renderFiles(kind, []);
      },
    );
  }

  private renderFiles(kind: FileKind, rows: readonly FileRow[]): void {
    this.filesList.empty();
    if (rows.length === 0) {
      this.filesList.createDiv({
        cls: "goodobsidian-files-empty",
        text: FILE_KIND_EMPTY[kind],
      });
      return;
    }
    for (const row of rows) {
      // `clickable-icon` keeps Obsidian's button styling (and its iPad padding) off the row.
      const button = this.filesList.createEl("button", {
        cls: "goodobsidian-files-row clickable-icon",
        attr: { role: "listitem", title: row.path },
      });
      setIcon(button.createSpan({ cls: "goodobsidian-files-row-icon" }), FILE_KIND_ICONS[kind]);
      const text = button.createSpan({ cls: "goodobsidian-files-row-text" });
      text.createSpan({ cls: "goodobsidian-files-row-name", text: fileName(row.path) });
      if (row.detail) {
        text.createSpan({ cls: "goodobsidian-files-row-detail", text: row.detail });
      }
      button.addEventListener("click", () => this.callbacks.onOpenFile?.(kind, row));
    }
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
    renderPageThumbnail(
      canvas,
      this.thumbPage(page),
      this.render.painter,
      cssWidth,
      window.devicePixelRatio || 1,
      {
        usePressure: this.render.usePressure,
        highlighterAlpha: this.render.highlighterAlpha,
        paper: this.render.paper,
        images: this.render.images,
        furniture: this.furnitureOf(index),
      },
    );
  }

  /** Page `index`'s header and number, as the page itself prints them. */
  private furnitureOf(index: number): PageTexts {
    return this.doc ? furnitureText(this.doc, index, this.render.notebookTitle ?? "") : {};
  }

  private showFilterMenu(): void {
    const menu = new Menu();
    for (const filter of ["all", "bookmarks", "contents"] as const) {
      menu.addItem((item) =>
        item
          .setTitle(filterInfo(filter).label)
          .setIcon(filterInfo(filter).icon)
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
    this.filterLabel.setText(filterInfo(this.filter).label);
    this.filterChip.toggleClass("is-filtered", filtered);
    let shown = 0;
    this.thumbs.forEach((view, index) => {
      const page = pages[index];
      const marked = page?.bookmarked === true;
      view.ribbon.toggleClass("is-outline", !marked);
      view.ribbon.setAttribute(
        "title",
        marked ? t("view.sidebar.removeBookmark") : t("view.sidebar.bookmarkPage"),
      );
      const passes = !filtered || (page !== undefined && pagePassesFilter(page, this.filter));
      if (passes) shown++;
      view.root.toggleClass("is-hidden", !passes);
    });
    this.addTile.toggleClass("is-hidden", filtered || this.single);
    const none = filtered && this.doc !== null && shown === 0;
    this.emptyEl.setText(filterInfo(this.filter).empty);
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

  /**
   * An endless board file (FineNotes#46): its Pages tab is Boards
   * (discussion #160), a thumbnail per board cut to its drawing, added,
   * named, dragged and deleted as pages are. No bookmarks, filter or
   * overview: a file holds a few boards, not a hundred pages.
   */
  setBoard(board: boolean): void {
    if (board !== this.board) {
      this.board = board;
      this.el.toggleClass("is-board", board);
      const button = this.tabButtons.get("pages");
      if (button) {
        const label = tabTitle("pages", board);
        button.setAttribute("aria-label", label);
        button.setAttribute("title", label);
        setIcon(button, board ? "infinity" : "file");
      }
      const add = board ? t("view.sidebar.addBoard") : t("view.sidebar.addPage");
      this.addTile.setAttribute("aria-label", add);
      this.addTile.lastElementChild?.setText(add);
      if (board) {
        this.setOverview(false);
        this.filter = "all";
      }
      for (const view of this.thumbs) view.painted = "";
      this.sync();
    }
    this.syncContentsAdd();
    this.renderContents();
    this.showTab(this.tab);
  }

  /**
   * The page a thumbnail paints: on a board, the board cut to its drawing
   * ({@link boardThumbBox}), not metres of empty paper.
   */
  private thumbPage(page: Page): Page {
    return this.board || page.board ? boardDrawing(page, boardThumbBox(page)) : page;
  }

  /** Whether the panel serves an endless board ({@link setBoard}). */
  private board = false;

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
    this.contentsDrag.destroy();
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
      view.root
        .querySelector(".goodobsidian-thumb-kind")
        ?.toggleClass("is-hidden", pages[index]?.board !== true || this.board);
      const page = pages[index];
      const entries = page ? pageContentsEntries(page, index).length : 0;
      const title = thumbnailTitleOf(page);
      view.title.setText(title);
      view.count.setText(entries > 1 ? `+${entries - 1}` : "");
      view.count.toggleClass("is-hidden", entries < 2);
      view.name.toggleClass("is-hidden", title === "");
      view.name.setAttribute(
        "aria-label",
        entries > 1 ? t("view.sidebar.moreInContents", { title, count: entries - 1 }) : title,
      );
      view.canvas.setCssStyles({ aspectRatio: page ? aspectOf(this.thumbPage(page)) : "" });
    });
    // "Add page" takes the shape of the page it would add: a copy of the
    // last; "Add board", an empty board's square.
    const last = pages[pages.length - 1];
    const shape = this.board ? "1 / 1" : last ? aspectOf(last) : "";
    this.addTile.setCssStyles({ aspectRatio: shape });
    this.applyFilter();
    this.renderContents();
    this.syncCurrent();
    this.syncSelection();
    this.syncChrome();
    this.schedulePaint();
  }

  /**
   * Rebuild the Contents tab as a tree (discussion #185): chapters, the
   * entries inside them indented under them, each folded as the reader left
   * it. A long contents (a textbook's) starts with its chapters folded.
   */
  private renderContents(): void {
    this.contentsDrag.cancel();
    const entries = this.doc ? contentsEntries(this.doc) : [];
    this.contentsItems = entries;
    this.contentsList.empty();
    const rows: Array<{ row: HTMLElement; parents: number[]; key: string | null }> = [];
    const foldDefault = entries.length > FOLD_CONTENTS_OVER;
    const place = (node: ContentsNode, parents: number[]): void => {
      const key = node.children.length > 0 ? this.foldKey(node.entry) : null;
      const folded = key !== null && (this.foldChoice.get(key) ?? foldDefault);
      const row = this.contentsRow(
        node.entry,
        node.at,
        key === null ? null : folded,
        parents.length,
      );
      rows[node.at] = { row, parents, key };
      const fold = row.querySelector<HTMLElement>(".goodobsidian-contents-fold");
      if (fold && key !== null) {
        fold.addEventListener("click", () => {
          const shut = !this.isFolded(key);
          this.foldChoice.set(key, shut);
          fold.toggleClass("is-folded", shut);
          fold.setAttribute("aria-expanded", String(!shut));
          this.syncContentsFolds();
          this.currentEntry = -2;
          this.syncCurrent();
        });
      }
      for (const child of node.children) place(child, [...parents, node.at]);
    };
    for (const node of contentsTree(entries)) place(node, []);
    this.contentsRows = rows;
    this.contentsFoldDefault = foldDefault;
    this.syncContentsFolds();
    this.currentEntry = -2;
    this.contentsEmpty.toggleClass("is-hidden", entries.length > 0);
    this.syncContentsAdd();
  }

  /** Whether the entry with fold key `key` is folded shut now. */
  private isFolded(key: string): boolean {
    return this.foldChoice.get(key) ?? this.contentsFoldDefault;
  }

  /** What remembers an entry's fold: its page's id for a title, its own id for a heading. */
  private foldKey(entry: ContentsEntry): string {
    if (entry.section) return `s:${entry.section.id}`;
    if (entry.chapter) return `s:${entry.chapter.id}`;
    return `p:${this.doc?.pages[entry.index]?.id ?? entry.index}`;
  }

  /** Hide every row inside an entry that is folded shut. */
  private syncContentsFolds(): void {
    for (const { row, parents } of this.contentsRows) {
      const hidden = parents.some((at) => {
        const key = this.contentsRows[at]?.key;
        return key !== null && key !== undefined && this.isFolded(key);
      });
      row.toggleClass("is-hidden", hidden);
    }
  }

  /**
   * One row of the contents: a fold toggle when it holds entries (`folded`
   * says how it is; null for none), the entry, and its ⌄ menu, indented by
   * `depth`, the entries it sits inside.
   */
  private contentsRow(
    entry: ContentsEntry,
    at: number,
    folded: boolean | null,
    depth: number,
  ): HTMLElement {
    const row = this.contentsList.createDiv({
      cls: "goodobsidian-contents-row",
      attr: { role: "listitem", "aria-level": String(depth + 1) },
    });
    row.toggleClass("is-section", entry.section !== undefined);
    row.toggleClass("is-sub", depth > 0);
    row.setCssProps({ "--gob-contents-depth": String(depth) });
    if (folded !== null) {
      const fold = row.createEl("button", {
        cls: "goodobsidian-contents-fold clickable-icon",
        attr: {
          "aria-label": t("view.sidebar.toggleHeadings"),
          "aria-expanded": String(!folded),
        },
      });
      fold.toggleClass("is-folded", folded);
      setIcon(fold, "chevron-down");
    } else {
      row.createSpan({ cls: "goodobsidian-contents-fold-space" });
    }
    const go = row.createEl("button", { cls: "goodobsidian-contents-entry clickable-icon" });
    go.createSpan({ cls: "goodobsidian-contents-title", text: entry.title });
    // A file of one board: a board number would say nothing.
    const numbered = !this.board || (this.doc?.pages.length ?? 0) > 1;
    if (numbered) {
      go.createSpan({ cls: "goodobsidian-contents-page", text: String(entry.index + 1) });
    }
    go.setAttribute(
      "aria-label",
      !numbered
        ? entry.title
        : t("view.sidebar.entryLabel", { title: entry.title, page: entry.index + 1 }),
    );
    const section = entry.section;
    const chapter = entry.chapter;
    go.addEventListener("click", () => {
      if (!this.contentsDrag.consumeClick()) this.openContentsEntry(at);
    });
    // A board's page menu holds page actions it has none of; its headings keep theirs.
    if (this.board && !section) return row;
    const more = row.createEl("button", { cls: "goodobsidian-contents-more clickable-icon" });
    setIcon(more, "chevron-down");
    more.setAttribute("aria-label", t("view.sidebar.entryOptions"));
    more.addEventListener("click", (event) => {
      if (chapter) this.showChapterMenu(entry.index, chapter, at, event);
      else if (section) this.showSectionMenu(entry.index, section, at, event, more);
      else this.showContentsMenu(entry.index, at, event, more);
    });
    return row;
  }

  /** Go to contents entry `at`, as a tap on it does. */
  private openContentsEntry(at: number): void {
    const entry = this.contentsItems[at];
    if (!entry) return;
    if (entry.section) this.callbacks.onSelectSection?.(entry.index, entry.section);
    else this.callbacks.onSelectPage(entry.index);
  }

  private showChapterMenu(
    index: number,
    chapter: PageChapter,
    at: number,
    event: MouseEvent,
  ): void {
    const act = (action: SectionAction) => () =>
      this.callbacks.onChapterAction?.(action, index, chapter);
    const menu = new Menu();
    menu.addItem((item) =>
      item.setTitle(t("common.rename")).setIcon("pencil").onClick(act("rename")),
    );
    this.addLevelItems(menu, at);
    menu.addItem((item) =>
      item.setTitle(t("view.contents.remove")).setIcon("list-x").onClick(act("remove")),
    );
    menu.showAtMouseEvent(event);
  }

  private showSectionMenu(
    index: number,
    section: PageSection,
    at: number,
    event: MouseEvent,
    anchor: HTMLElement,
  ): void {
    const act = (action: SectionAction) => () =>
      this.callbacks.onSectionAction?.(action, index, section, anchor);
    const menu = new Menu();
    menu.addItem((item) =>
      item.setTitle(t("common.rename")).setIcon("pencil").onClick(act("rename")),
    );
    this.addLevelItems(menu, at);
    menu.addItem((item) =>
      item.setTitle(t("view.contents.remove")).setIcon("list-x").onClick(act("remove")),
    );
    menu.showAtMouseEvent(event);
  }

  /**
   * "Add page N to contents", for the page being read, unless it is listed
   * already. Not on a board: its contents are its headings.
   */
  private syncContentsAdd(): void {
    const page = this.doc?.pages[this.current];
    this.contentsAdd.toggleClass("is-hidden", this.board || !page || page.title !== undefined);
    this.contentsAddLabel.setText(t("view.sidebar.addPageToContents", { page: this.current + 1 }));
    this.contentsChapter.toggleClass("is-hidden", this.board || this.single || !page);
  }

  private showContentsMenu(
    index: number,
    at: number,
    event: MouseEvent,
    anchor: HTMLElement,
  ): void {
    const act = (action: PageAction) => () => this.callbacks.onPageAction(action, index, anchor);
    const menu = new Menu();
    menu.addItem((item) =>
      item.setTitle(t("common.rename")).setIcon("pencil").onClick(act("contents")),
    );
    this.addLevelItems(menu, at);
    menu.addItem((item) =>
      item.setTitle(t("view.contents.remove")).setIcon("list-x").onClick(act("contents-remove")),
    );
    menu.showAtMouseEvent(event);
  }

  /** Outdent and Indent for entry `at`, each only when it can move that way. */
  private addLevelItems(menu: Menu, at: number): void {
    const doc = this.doc;
    if (!doc || !this.callbacks.onContentsLevel) return;
    const shift = (delta: 1 | -1) => () => this.callbacks.onContentsLevel?.(at, delta);
    if (levelShift(doc, at, -1)) {
      menu.addItem((item) =>
        item.setTitle(t("view.contents.outdent")).setIcon("outdent").onClick(shift(-1)),
      );
    }
    if (levelShift(doc, at, 1)) {
      menu.addItem((item) =>
        item.setTitle(t("view.contents.indent")).setIcon("indent").onClick(shift(1)),
      );
    }
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
    // A board among a notebook's pages (discussion #160): ∞ at its lower corner.
    setIcon(frame.createSpan({ cls: "goodobsidian-thumb-kind is-hidden" }), "infinity");
    // The overview's Select mode: a tick at the page's corner.
    setIcon(frame.createSpan({ cls: "goodobsidian-thumb-check" }), "check");
    const footer = root.createDiv({ cls: "goodobsidian-thumb-footer" });
    const label = footer.createSpan({ cls: "goodobsidian-thumb-number" });
    const name = footer.createEl("button", { cls: "goodobsidian-thumb-name clickable-icon" });
    const title = name.createSpan({ cls: "goodobsidian-thumb-title" });
    const count = name.createSpan({ cls: "goodobsidian-thumb-count" });
    const more = footer.createEl("button", { cls: "goodobsidian-thumb-more clickable-icon" });
    setIcon(more, "chevron-down");
    more.setAttribute("aria-label", t("view.sidebar.pageOptions"));

    const view: ThumbView = {
      root,
      page: null,
      canvas,
      ribbon,
      label,
      name,
      title,
      count,
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
    name.addEventListener("click", (event) => {
      const index = this.thumbs.indexOf(view);
      if (index < 0 || this.drag.consumeClick()) return;
      this.tapName(index, event, name);
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
   * Mark the entry being read: the last one at or above the reader. Inside a
   * folded entry, the outermost folded one is marked instead. Touches the
   * rows only when it changes, since a scroll calls this every frame.
   */
  private syncCurrentEntry(): void {
    const reading = currentContentsEntry(this.contentsItems, this.current, this.currentY);
    const holder = this.contentsRows[reading];
    const shut = holder?.parents.find((parent) => {
      const key = this.contentsRows[parent]?.key;
      return key !== null && key !== undefined && this.isFolded(key);
    });
    const at = shut ?? reading;
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
      renderPageThumbnail(view.canvas, this.thumbPage(page), this.render.painter, width, dpr, {
        usePressure: this.render.usePressure,
        highlighterAlpha: this.render.highlighterAlpha,
        paper: this.render.paper,
        images: this.render.images,
        furniture: this.furnitureOf(index),
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
    if (this.selecting || range || toggle) {
      this.setSelecting(true);
      if (!this.selecting) return;
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

  /**
   * A tap on a page's name: with one entry in the contents, go to it; with
   * more, list them all, top to bottom, to pick one. While pages are being
   * picked in the overview the name is part of its page, and picks it.
   */
  private tapName(index: number, event: MouseEvent, anchor: HTMLElement): void {
    const page = this.doc?.pages[index];
    if (!page) return;
    if (this.selecting || event.shiftKey || event.metaKey || event.ctrlKey) {
      this.tapThumb(index, anchor, event);
      return;
    }
    const entries = pageContentsEntries(page, index);
    if (entries.length < 2) {
      if (entries[0]) this.goToEntry(entries[0]);
      return;
    }
    const menu = new Menu();
    for (const entry of entries) {
      menu.addItem((item) =>
        item
          .setTitle(entry.title)
          .setIcon(entry.section ? "heading" : "file-text")
          .onClick(() => this.goToEntry(entry)),
      );
    }
    menu.showAtMouseEvent(event);
  }

  /** Go to a page's title or to a heading on it, closing the overview first. */
  private goToEntry(entry: ContentsEntry): void {
    const fromOverview = this.overview;
    if (fromOverview) this.setOverview(false);
    if (entry.section) this.callbacks.onSelectSection?.(entry.index, entry.section, fromOverview);
    else this.callbacks.onSelectPage(entry.index, fromOverview);
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
    // Moving every page within the notebook means nothing.
    const whole = this.selected.size >= (this.doc?.pages.length ?? 0);
    menu.addItem((item) =>
      item
        .setTitle(t("view.sidebar.moveToStart"))
        .setIcon("arrow-up-to-line")
        .setDisabled(whole)
        .onClick(() => this.selectionAction("move-start", anchor)),
    );
    menu.addItem((item) =>
      item
        .setTitle(t("view.sidebar.moveToEnd"))
        .setIcon("arrow-down-to-line")
        .setDisabled(whole)
        .onClick(() => this.selectionAction("move-end", anchor)),
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(t("view.sidebar.toAnotherNotebook"))
        .setIcon("folder-input")
        .onClick(() => this.selectionAction("move-to", anchor)),
    );
    menu.showAtMouseEvent(event);
  }

  /** Start Select with page `index` ticked (the page menu's "Select pages"). */
  private beginSelecting(index: number): void {
    const page = this.doc?.pages[index];
    this.setSelecting(true);
    if (!page || !this.selecting) return;
    this.selected.add(page);
    this.anchor = page;
    this.syncSelection();
    this.syncChrome();
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
    const expandLabel = overview ? t("view.sidebar.backToSidebar") : t("view.sidebar.showAllPages");
    this.expandButton.setAttribute("aria-label", expandLabel);
    this.expandButton.setAttribute("title", expandLabel);
    this.expandButton.toggleClass("is-hidden", this.single || this.board || selecting);
    this.closeButton.toggleClass("is-hidden", overview || selecting);
    this.tabsEl.toggleClass("is-hidden", overview);
    this.selectButton.toggleClass("is-hidden", !overview && !selecting);
    this.selectButton.setText(selecting ? t("common.done") : t("view.sidebar.select"));
    this.selectButton.toggleClass("is-done", selecting);
    this.selectAllButton.toggleClass("is-hidden", !selecting);
    const shown = this.shownThumbs().length;
    const all = shown > 0 && this.selected.size >= shown;
    this.selectAllButton.setText(all ? t("view.sidebar.deselectAll") : t("view.sidebar.selectAll"));
    const count = this.selected.size;
    if (selecting) {
      this.titleEl.setText(
        count === 0 ? t("view.sidebar.selectPages") : tn("view.sidebar.pageCount", count),
      );
    } else {
      this.titleEl.setText(tabTitle(this.tab, this.board));
    }
    this.selectBar.toggleClass("is-hidden", !selecting);
    // Moving or deleting every page means nothing (and a notebook keeps one).
    const total = this.doc?.pages.length ?? 0;
    for (const [action, button] of this.selectBarButtons) {
      // Move stays: every page can still be copied to another notebook.
      const whole = action === "delete" && count >= total;
      button.disabled = count === 0 || whole;
    }
    const bookmark = this.selectBarButtons.get("bookmark");
    if (bookmark) {
      const marked = count > 0 && [...this.selected].every((page) => page.bookmarked === true);
      const label = marked ? t("view.sidebar.removeBookmark") : t("view.sidebar.bookmark");
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
    // A board among the pages takes no template or cover (discussion #160).
    const boardPage = this.doc?.pages[index]?.board === true;
    const act = (action: PageAction) => () => this.callbacks.onPageAction(action, index, anchor);
    const menu = new Menu();
    if (this.board) {
      this.boardMenu(menu, index, total, act);
      menu.showAtMouseEvent(event);
      return;
    }
    if (this.fixed) {
      // A practice file: rubbing a page out is the one thing to do to it.
      menu.addItem((item) =>
        item
          .setTitle(t("view.sidebar.clearPage"))
          .setIcon("x-circle")
          .setWarning(true)
          .onClick(act("clear")),
      );
      menu.showAtMouseEvent(event);
      return;
    }
    const marked = this.doc?.pages[index]?.bookmarked === true;
    menu.addItem((item) =>
      item
        .setTitle(marked ? t("view.sidebar.removeBookmark") : t("view.sidebar.bookmarkPage"))
        .setIcon(marked ? "bookmark-minus" : "bookmark")
        .onClick(act("bookmark")),
    );
    if (!this.single) {
      menu.addItem((item) =>
        item
          .setTitle(t("view.sidebar.selectPages"))
          .setIcon("check-circle")
          .onClick(() => this.beginSelecting(index)),
      );
    }
    const titled = this.doc?.pages[index]?.title !== undefined;
    menu.addItem((item) =>
      item
        .setTitle(titled ? t("view.contents.rename") : t("view.contents.add"))
        .setIcon(titled ? "pencil" : "list-plus")
        .onClick(act("contents")),
    );
    if (titled) {
      menu.addItem((item) =>
        item.setTitle(t("view.contents.remove")).setIcon("list-x").onClick(act("contents-remove")),
      );
    }
    if (!this.single) {
      const tabbed = this.doc?.pages[index]?.tab !== undefined;
      menu.addItem((item) =>
        item
          .setTitle(tabbed ? t("view.sidebar.removeTab") : t("view.sidebar.addTab"))
          .setIcon("tag")
          .onClick(act("tab")),
      );
    }
    menu.addItem((item) =>
      item.setTitle(t("view.sidebar.copyLink")).setIcon("link").onClick(act("copy-link")),
    );
    menu.addSeparator();
    if (this.single) {
      menu.addItem((item) =>
        item
          .setTitle(t("view.sidebar.convert"))
          .setIcon("book-open")
          .onClick(act("convert-to-notebook")),
      );
      menu.addSeparator();
    } else {
      menu.addItem((item) =>
        item.setTitle(t("view.sidebar.addBefore")).setIcon("file-plus").onClick(act("add-before")),
      );
      menu.addItem((item) =>
        item.setTitle(t("view.sidebar.addAfter")).setIcon("file-plus-2").onClick(act("add-after")),
      );
      menu.addSeparator();
      menu.addItem((item) =>
        item.setTitle(t("view.sidebar.duplicatePage")).setIcon("copy").onClick(act("duplicate")),
      );
    }
    // A cover is not paper: it changes design and colour, not template.
    if (boardPage) {
      // Its paper is the board's own, chosen as it was added.
    } else if (cover) {
      menu.addItem((item) =>
        item
          .setTitle(t("view.sidebar.changeCover"))
          .setIcon("palette")
          .onClick(act("change-cover")),
      );
    } else {
      menu.addItem((item) =>
        item
          .setTitle(t("view.sidebar.changeTemplate"))
          .setIcon("layout-template")
          .onClick(act("change-template")),
      );
    }
    if (!this.single) {
      menu.addItem((item) =>
        item
          .setTitle(t("view.sidebar.moveUp"))
          .setIcon("arrow-up")
          .setDisabled(index <= 0)
          .onClick(act("move-up")),
      );
      menu.addItem((item) =>
        item
          .setTitle(t("view.sidebar.moveDown"))
          .setIcon("arrow-down")
          .setDisabled(index >= total - 1)
          .onClick(act("move-down")),
      );
    }
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(t("view.sidebar.clearPage"))
        .setIcon("x-circle")
        .setWarning(true)
        .onClick(act("clear")),
    );
    menu.addItem((item) =>
      item
        .setTitle(t("view.sidebar.deletePage"))
        .setIcon("trash-2")
        .setWarning(true)
        .setDisabled(total <= 1)
        .onClick(act("delete")),
    );
    menu.showAtMouseEvent(event);
  }

  /**
   * A board's ⌄ menu (discussion #160): the page menu's items that mean
   * something for a board, in its order: its name (its line in the
   * contents), its link, its place among the boards, and clearing or
   * deleting it. No bookmark, tab, template or copy.
   */
  private boardMenu(
    menu: Menu,
    index: number,
    total: number,
    act: (action: PageAction) => () => void,
  ): void {
    const titled = this.doc?.pages[index]?.title !== undefined;
    menu.addItem((item) =>
      item
        .setTitle(titled ? t("view.contents.rename") : t("view.contents.add"))
        .setIcon(titled ? "pencil" : "list-plus")
        .onClick(act("contents")),
    );
    if (titled) {
      menu.addItem((item) =>
        item.setTitle(t("view.contents.remove")).setIcon("list-x").onClick(act("contents-remove")),
      );
    }
    menu.addItem((item) =>
      item.setTitle(t("view.sidebar.copyLink")).setIcon("link").onClick(act("copy-link")),
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(t("view.sidebar.moveUp"))
        .setIcon("arrow-up")
        .setDisabled(index <= 0)
        .onClick(act("move-up")),
    );
    menu.addItem((item) =>
      item
        .setTitle(t("view.sidebar.moveDown"))
        .setIcon("arrow-down")
        .setDisabled(index >= total - 1)
        .onClick(act("move-down")),
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(t("view.morePanel.clearBoard"))
        .setIcon("x-circle")
        .setWarning(true)
        .onClick(act("clear")),
    );
    menu.addItem((item) =>
      item
        .setTitle(t("view.sidebar.deleteBoard"))
        .setIcon("trash-2")
        .setWarning(true)
        .setDisabled(total <= 1)
        .onClick(act("delete")),
    );
  }
}

/** A page's CSS `aspect-ratio`, or "" (the stylesheet default) if degenerate. */
function aspectOf(page: Page): string {
  const { width, height } = page.geometry;
  return width > 0 && height > 0 ? `${width} / ${height}` : "";
}
