/**
 * The notebook library: every notebook in the vault as a cover, in the
 * vault's own folders, newest first. A grid of covers with a "Continue"
 * strip of the ones edited last, the vault's folders above them, and a
 * search field and a sort menu at the top.
 *
 *   .goodobsidian-library   (.has-rail: the simple look, wide enough; .has-preview)
 *     .goodobsidian-library-rail      (Home and the folders, in the simple look)
 *     .goodobsidian-library-head   (← up · title · search · sort · New notebook)
 *     .goodobsidian-library-body
 *       .goodobsidian-library-label + .goodobsidian-library-recent   (root, not searching)
 *       .goodobsidian-library-label + .goodobsidian-library-folders
 *       .goodobsidian-library-label + .goodobsidian-library-grid
 *         .goodobsidian-library-card   (.goodobsidian-library-cover + caption)
 *     .goodobsidian-library-preview   (one tap on a cover: it, its pages, Open; a double tap opens)
 *
 * What a card shows comes from the notebook's file (model/library.ts). Files
 * are read one at a time, newest first, with a yield between each so a big
 * vault never holds the main thread, and a read is kept until the file's
 * size or time changes. Until a notebook is read it shows its name on a grey
 * cover; a read redraws that notebook's cards where they stand, and the page
 * is put in order once the reading ends. A hidden Home tab reads nothing: a
 * change waits until the tab is shown.
 *
 * The same read keeps each notebook's own text (search-store.ts), so a
 * search finds pages as well as titles: matching notebooks first, then
 * the pages that hold the words (`src/search/library-search.ts`), each
 * opening its notebook on that page with the words lit.
 */

import {
  Component,
  ItemView,
  MarkdownRenderer,
  Menu,
  Notice,
  type TAbstractFile,
  TFile,
  TFolder,
  type ViewStateResult,
  type WorkspaceLeaf,
  setIcon,
} from "obsidian";
import {
  ICON_IMPORT_NOTEBOOK,
  PRACTICE_FILE_SUFFIX,
  VIEW_TYPE_INK,
  VIEW_TYPE_LIBRARY,
} from "../constants";
import { coverPalette } from "../model/cover";
import {
  DEFAULT_FOLDER_COLOR,
  DEFAULT_FOLDER_ICON,
  FOLDER_COLORS,
  FOLDER_ICONS,
  type FolderStyles,
  cleanName,
  withFolderStyle,
} from "../model/library-style";
import { PdfBackdropCache } from "./pdf-backdrop";
import { NotebookPages } from "./library-pages";
import type { Page } from "../model/document";
import { type Tap, isDoubleTap, railFolders } from "../model/library-rail";
import { SIMPLE_CLASS } from "../model/simple-mode";
import { coverUrlNow, loadCover, loadEntries, saveCover, saveEntries } from "./home-cache";
import { acquirePdfWorker, releasePdfWorker } from "./pdf-worker";
import { thumbnailRasterScale } from "./page-sidebar";
import { FolderSuggestModal } from "./folder-suggest";
import { LibraryActions } from "./library-actions";
import { RenameModal } from "./rename-modal";
import { pickImageFile } from "./image-import";
import { VaultPdfSuggestModal } from "./pdf-import-modal";
import { INBOX_FOLDER } from "../model/inbox";
import { ASSETS_FOLDER } from "../model/vault-folders";
import { HOME_FILE, HOME_FILE_FLAG } from "../model/home-file";
import { notebookOwnedFiles } from "../model/library-files";
import { type TextKey, t, tn } from "../i18n/translate";
import {
  CHECK_RESULT_MS,
  type CheckOutcome,
  type CheckPhase,
  phaseAfter,
  updateButtonLook,
} from "../model/update-button";
import { inkFileSuffix } from "../model/new-notebook";
import { isStarred, starredFirst, toggleStar } from "../model/favorites";
import { LAST_PAGES_KEY, type LastPages, parseLastPages } from "../model/last-page";
import {
  HOME_PREVIEW_PAGES,
  type LibraryEntry,
  type LibraryPdf,
  type PreviewSheet,
  coverKey,
  type LibrarySort,
  browse,
  continueEntries,
  crumbs,
  extensionLabel,
  fileEntry,
  fileIcon,
  hoistSingles,
  folderOf,
  notePreviewText,
  readProgress,
  placeholderEntry,
  searchEntries,
  sortEntries,
  whenText,
} from "../model/library";
import {
  type LibraryBook,
  type LibraryHit,
  assemblePages,
  searchLibrary,
} from "../search/library-search";
import {
  type PageText,
  folderNotebookSidecarPath,
  transcriptSidecarPath,
  transcriptsByKey,
} from "../search/notebook-search";
import {
  type KeptPrinted,
  type KeptReading,
  type NotebookTextRecord,
  loadNotebookTexts,
  loadPrinted,
  loadReadings,
  printedKey,
  pruneReadings,
  readingKey,
  saveNotebookTexts,
  vaultKeyOf,
} from "./search-store";

/** What the view needs from the plugin. */
export interface LibraryHost {
  /** The New notebook / New board dialogs, made in `folder` ("" the root). */
  newNotebook(folder: string): void;
  newBoard(folder: string): void;
  /** The import dialog for Goodnotes, Notability and other apps, into `folder`. */
  importFromApp(folder: string): void;
  /** A notebook with this picture on its first page, made in `folder`. */
  importImage(file: File, folder: string): void;
  /** FineNotes' own page in Obsidian's settings. */
  openSettings(): void;
  /** The newer FineNotes that is out, or null. */
  update(): string | null;
  /** Open FineNotes' page under Community plugins, with Obsidian's Update button. */
  openUpdate(): void;
  /** Read the released version now (Home's check button); `update()` then has the answer. */
  checkUpdate(): Promise<CheckOutcome>;
  /** Call `listener` when `update()` may have changed (the daily check); returns the unsubscribe. */
  onUpdateChange(listener: () => void): () => void;
  /** A notebook whose pages are the chosen PDF's, made in `folder`. */
  importPdf(
    source: { kind: "file"; file: File } | { kind: "vault"; file: TFile },
    folder: string,
  ): void;
  /** The starred notebooks and folders, by vault path. */
  stars(): readonly string[];
  setStars(stars: string[]): void;
  /** The colour and icon chosen for folders, by vault path. */
  folderStyles(): FolderStyles;
  setFolderStyles(styles: FolderStyles): void;
  /** Open a notebook and start its "Export as PDF". */
  exportPdf(file: TFile): Promise<void>;
  /** Whether a file is an ink note: a notebook, a single page, a board, or a pre-0.2 `.ink.md`. */
  isInkFile(file: TFile): boolean;
}

/** A folder as the library lists it. */
interface FolderTile {
  path: string;
  name: string;
  count: number;
  /** How many of `count` are notebooks. */
  notebooks: number;
}

/** The width a note's preview is laid out at, before it is scaled to its cover. */
const NOTE_PAGE_WIDTH = 360;

/** The orders on offer, `label` their text key. */
const SORTS: ReadonlyArray<{ by: LibrarySort; label: TextKey }> = [
  { by: "created", label: "notebooks.home.sortCreated" },
  { by: "edited", label: "notebooks.home.sortEdited" },
  { by: "name", label: "notebooks.home.sortName" },
  { by: "pages", label: "notebooks.home.sortPages" },
];

/** How many notebooks the Continue strip shows. */
/** Whether "All notebooks" is folded on this device. */
const ALL_FOLDED_KEY = "finenotes-library-all-folded";

const CONTINUE_COUNT = 3;
/** How many notebooks the Recent row shows, after the Continue card's. */
const RECENT_COUNT = 6;

/** The narrowest Home that has room for the folder rail beside the covers, CSS px; narrower it is a drawer. */
const RAIL_MIN_WIDTH = 720;
/** Whether the folder rail is put away on this device (simple look, wide Home). */
const RAIL_HIDDEN_KEY = "finenotes-library-rail-hidden";
/** Whether Home lists notebooks only on this device. */
const ONLY_NOTEBOOKS_KEY = "finenotes-library-only-notebooks";
/** A cover drawn from the notebook's own cover page, CSS px wide. */
const COVER_WIDTH = 240;

interface Read {
  mtime: number;
  size: number;
  entry: LibraryEntry;
}

/** Each vault's reads this session, shared by every Home tab: reopening Home reads nothing new. */
const sessionReads = new Map<string, Map<string, Read>>();
/** Each vault's notebooks' own text this session, for searching inside them. */
const sessionTexts = new Map<string, Map<string, NotebookTextRecord>>();
/**
 * The notebook Home is reading, kept on this device until the read ends: a
 * mark still there when Home reads again means that read took the app down,
 * and that notebook is not read again until its file changes.
 */
const READING_MARK_KEY = "finenotes-home-reading";
/** The pause between notebooks read only for their text (the one-time index), ms. */
const TEXT_ONLY_GAP_MS = 60;
/** Pages a search shows at most. */
const MAX_PAGE_HITS = 40;
/** How long typing must pause before the pages are searched, ms: titles answer at once. */
const PAGE_SEARCH_DELAY_MS = 120;

/** What this device worked out about notebooks' pages (search-store.ts), loaded when a search starts. */
interface SearchExtras {
  readings: Map<string, KeptReading>;
  printed: Map<string, KeptPrinted>;
}

/** The icon a snippet's source shows: handwriting, a text box, a PDF. */
function snippetIcon(kind: PageText["sources"][number]["kind"]): string {
  return kind === "handwriting" ? "pen-line" : kind === "text" ? "type" : "file-text";
}

/**
 * Obsidian's "Stack tabs" shows every tab of a group side by side, so a
 * notebook opened from Home sat beside it like a split screen. A notebook
 * from Home takes the whole view: its tab group stops stacking. Read from
 * Obsidian 1.15's `app.js`, not public API: a tab group has `isStacked` and
 * `setStacked(on)`.
 */
export function unstackTabsOf(leaf: WorkspaceLeaf): void {
  const group = leaf.parent as unknown as {
    isStacked?: boolean;
    setStacked?: (on: boolean) => void;
  } | null;
  if (group?.isStacked && typeof group.setStacked === "function") group.setStacked(false);
}

export class LibraryView extends ItemView {
  override icon = "house";
  private folder = "";
  private sort: LibrarySort = "edited";
  /** "All notebooks" folded away (this device remembers). */
  private allFolded = this.app.loadLocalStorage(ALL_FOLDED_KEY) === "1";
  /** The sort turned around: oldest first, Z to A, fewest pages first. */
  private reverse = false;
  private layout: "grid" | "list" = "grid";
  /** Picking notebooks and folders for a Move, Star or Delete of several at once. */
  private selecting = false;
  private readonly selected = new Set<string>();
  private barEl!: HTMLElement;
  private pullEl!: HTMLElement;
  private updateEl!: HTMLElement;
  /** Where a check the user asked for stands (`model/update-button.ts`). */
  private checkPhase: CheckPhase = "idle";
  private checkTimer = 0;
  private query = "";
  private readonly reads = new Map<string, Read>();
  /** Each notebook's own text, for searching inside it; valid while its file's time and size match. */
  private texts = new Map<string, NotebookTextRecord>();
  /** What this device read on pages (Grape, PDF text); `null` until a search wants it, or after a notebook was visited. */
  private extras: SearchExtras | null = null;
  private extrasLoading: Promise<SearchExtras> | null = null;
  /** The transcript server's transcriptions, by notebook path, as of the sidecar's version. */
  private readonly sidecars = new Map<string, { stamp: string; byKey: Map<string, string> }>();
  /** Each notebook's pages as last searched, kept while nothing they are made of changed. */
  private readonly books = new Map<
    string,
    {
      of: NotebookTextRecord;
      sidecar: Map<string, string> | undefined;
      sign: string;
      pages: PageText[];
    }
  >();
  /** Where the page results go; carried over from paint to paint so typing never blanks them. */
  private hitsEl: HTMLElement | null = null;
  private hitsTimer = 0;
  /** Move, Duplicate and Delete, on a notebook's own folder when it has one. */
  private readonly actions: LibraryActions;
  /** The read under way, if any; `again` asks it for one more round when it ends. */
  private reading: Promise<void> | null = null;
  private again = false;
  private closed = false;
  /** A vault change came while the tab was hidden: read when it is shown again. */
  private stale = false;
  /** What the last paint showed (notebook paths, `folder:` paths): shown again, it does not fade in again. */
  private painted = new Set<string>();
  private before = new Set<string>();
  /** Each notebook's cards on the page now, to draw one again where it stands. */
  private cards = new Map<string, { el: HTMLElement; leftAt?: number }[]>();
  private pdf: PdfBackdropCache | null = null;
  private workerHeld = false;
  private refreshTimer = 0;
  private upEl!: HTMLElement;
  private titleEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private railEl!: HTMLElement;
  private railButton!: HTMLElement;
  /** The rail put away by its button (a wide Home); kept on this device. */
  private railHidden = this.app.loadLocalStorage(RAIL_HIDDEN_KEY) === "1";
  /** The rail opened as a drawer over a narrow Home. */
  private drawerOpen = false;
  /** Home lists notebooks only, no other files (the sort menu); kept on this device. */
  private onlyNotebooks = this.app.loadLocalStorage(ONLY_NOTEBOOKS_KEY) === "1";
  /** The simple look as of the last paint, so a change of it repaints. */
  private simple = false;
  private previewEl!: HTMLElement;
  /** The item the preview shows, or null when it is closed. */
  private previewPath: string | null = null;
  /** The last tap on a cover, for a double tap. */
  private lastTap: Tap | null = null;
  /** Notebooks read whole, for their cover and page pictures. */
  private pagesOf: NotebookPages | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly host: LibraryHost,
  ) {
    super(leaf);
    this.navigation = true;
    this.actions = new LibraryActions(this.app, (path) => this.isNotebookPath(path));
  }

  getViewType(): string {
    return VIEW_TYPE_LIBRARY;
  }

  getDisplayText(): string {
    return t("notebooks.home.title");
  }

  override getState(): Record<string, unknown> {
    return { folder: this.folder, sort: this.sort, reverse: this.reverse, layout: this.layout };
  }

  override async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const saved = (state ?? {}) as {
      folder?: unknown;
      sort?: unknown;
      reverse?: unknown;
      layout?: unknown;
    };
    this.reverse = saved.reverse === true;
    if (saved.layout === "list" || saved.layout === "grid") this.layout = saved.layout;
    if (typeof saved.folder === "string") this.folder = saved.folder;
    if (SORTS.some((s) => s.by === saved.sort)) this.sort = saved.sort as LibrarySort;
    this.paintNow(true);
    await super.setState(state, result);
  }

  override async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("goodobsidian-library");
    // Obsidian opens the command palette on a pull down; this list pulls to refresh instead.
    root.dataset.ignoreSwipe = "true";

    const head = root.createDiv({ cls: "goodobsidian-library-head" });
    // The folder rail's own toggle: Obsidian's sidebar button is hidden in the simple look.
    this.railButton = head.createEl("button", {
      cls: "clickable-icon goodobsidian-library-rail-toggle",
      attr: { type: "button", "aria-label": t("notebooks.home.folders") },
    });
    setIcon(this.railButton, "panel-left");
    this.railButton.addEventListener("click", () => this.toggleRail());
    this.upEl = head.createEl("button", {
      cls: "clickable-icon goodobsidian-library-up",
      attr: { "aria-label": t("notebooks.home.up") },
    });
    setIcon(this.upEl, "arrow-left");
    this.makeDropTarget(this.upEl, () => this.folder.split("/").slice(0, -1).join("/"));
    this.upEl.addEventListener("click", () =>
      this.openFolder(this.folder.split("/").slice(0, -1).join("/")),
    );
    this.titleEl = head.createEl("h4", { cls: "goodobsidian-library-title" });

    // Two arrows that check for a newer FineNotes; one found turns them into "Update to x".
    this.updateEl = head.createEl("button", {
      cls: "clickable-icon goodobsidian-library-update",
      attr: { type: "button" },
    });
    this.updateEl.addEventListener("click", () => this.tapUpdate());

    const search = head.createDiv({ cls: "goodobsidian-library-search" });
    setIcon(search.createSpan(), "search");
    const input = search.createEl("input", {
      attr: {
        type: "search",
        placeholder: t("notebooks.home.search"),
        "aria-label": t("notebooks.home.searchLabel"),
      },
    });
    input.addEventListener("input", () => {
      this.query = input.value;
      this.paintNow(true);
    });

    const sort = head.createEl("button", {
      cls: "clickable-icon",
      attr: { "aria-label": t("notebooks.home.sort") },
    });
    setIcon(sort, "arrow-up-down");
    sort.addEventListener("click", (event) => this.openSortMenu(event));

    const add = head.createEl("button", {
      cls: "goodobsidian-library-new",
      attr: { type: "button", "aria-haspopup": "menu" },
    });
    setIcon(add.createSpan({ cls: "goodobsidian-library-new-icon" }), "plus");
    add.createSpan({ text: t("notebooks.home.new") });
    add.addEventListener("click", (event) => this.openNewMenu(event));

    const gear = head.createEl("button", {
      cls: "clickable-icon",
      attr: { "aria-label": t("notebooks.home.settings") },
    });
    setIcon(gear, "settings");
    gear.addEventListener("click", () => this.host.openSettings());

    this.bodyEl = root.createDiv({ cls: "goodobsidian-library-body" });
    this.pullEl = root.createDiv({ cls: "goodobsidian-library-pull" });
    setIcon(this.pullEl, "refresh-cw");
    root.insertBefore(this.pullEl, this.bodyEl);
    this.watchPull(this.bodyEl);
    this.barEl = root.createDiv({ cls: "goodobsidian-library-bar is-hidden" });
    this.railEl = root.createDiv({ cls: "goodobsidian-library-rail" });
    root.insertBefore(this.railEl, head);
    this.previewEl = root.createDiv({ cls: "goodobsidian-library-preview is-hidden" });
    // A tap beside the drawer puts it away.
    this.bodyEl.addEventListener(
      "pointerdown",
      () => {
        if (!this.drawerOpen) return;
        this.drawerOpen = false;
        this.paintNow();
      },
      true,
    );
    // A tap on the page around the covers closes the preview.
    this.bodyEl.addEventListener("click", (event) => {
      if (
        event.target === this.bodyEl ||
        (event.target as HTMLElement).hasClass?.("goodobsidian-library-grid")
      )
        this.hidePreview();
    });

    // A deleted note's frontmatter may be gone already: one read before counts too.
    this.watchVault();
    // The daily check (or switching it off) can answer while Home is open: the pill follows at once.
    this.register(this.host.onUpdateChange(() => this.paintUpdate()));
    // The simple look turned on or off while Home is open: the rail follows at once.
    const look = new MutationObserver(() => {
      if (document.body.hasClass(SIMPLE_CLASS) !== this.simple) this.paintNow();
    });
    look.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    this.register(() => look.disconnect());
    // What this device read before: Home opens with every card as it was,
    // and only notebooks changed since are read again (FineNotes#146).
    const known = sessionReads.get(this.vaultKey());
    if (known) for (const [path, read] of known) this.reads.set(path, read);
    this.paintNow();
    void Promise.all([this.loadKnown(), this.loadKnownTexts()]).then(() => this.readStale());
  }

  override onResize(): void {
    if (!this.bodyEl || this.contentEl.clientWidth === 0) return;
    const mode = this.railMode();
    const was = this.contentEl.hasClass("has-rail")
      ? "side"
      : this.contentEl.hasClass("has-drawer")
        ? "drawer"
        : "none";
    this.contentEl.toggleClass("is-narrow", this.contentEl.clientWidth <= 760);
    if (mode !== was) this.paintNow();
  }

  /** Whether Home is too narrow for the rail beside the covers. A hidden Home (no width yet) counts as wide. */
  private narrowForRail(): boolean {
    const width = this.contentEl.clientWidth;
    return width > 0 && width < RAIL_MIN_WIDTH;
  }

  /**
   * The folder rail, in the simple look only (where Obsidian's own explorer
   * is hidden): beside the covers on a wide Home unless put away, or a
   * drawer over them on a narrow one while it is open.
   */
  private railMode(): "side" | "drawer" | "none" {
    if (!document.body.hasClass(SIMPLE_CLASS)) return "none";
    if (this.narrowForRail()) return this.drawerOpen ? "drawer" : "none";
    return this.railHidden ? "none" : "side";
  }

  private hasRail(): boolean {
    return this.railMode() === "side";
  }

  /** The rail's button: put the rail away or bring it back (wide), or open and close the drawer (narrow). */
  private toggleRail(): void {
    if (this.narrowForRail()) this.drawerOpen = !this.drawerOpen;
    else {
      this.railHidden = !this.railHidden;
      this.app.saveLocalStorage(RAIL_HIDDEN_KEY, this.railHidden ? "1" : "0");
    }
    this.paintNow();
  }

  private pages(): NotebookPages {
    this.pagesOf ??= new NotebookPages(this.app, () => this.pdfCache());
    return this.pagesOf;
  }

  /** One key per vault for what Home keeps on this device. */
  private vaultKey(): string {
    return vaultKeyOf(this.app);
  }

  /** The entries kept from earlier sessions, merged under any read this session; repaints if any came. */
  private async loadKnown(): Promise<void> {
    if (sessionReads.has(this.vaultKey())) return;
    const kept = await loadEntries(this.vaultKey());
    if (this.closed || kept.size === 0) return;
    let added = false;
    for (const [path, read] of kept) {
      if (this.reads.has(path)) continue;
      this.reads.set(path, read);
      added = true;
    }
    if (added) this.paintNow();
  }

  /** The notebooks' text kept from earlier sessions, under any read this session. */
  private async loadKnownTexts(): Promise<void> {
    const vault = this.vaultKey();
    const session = sessionTexts.get(vault);
    if (session) {
      this.texts = session;
      return;
    }
    sessionTexts.set(vault, this.texts);
    const kept = await loadNotebookTexts(vault);
    for (const [path, record] of kept) if (!this.texts.has(path)) this.texts.set(path, record);
    if (!this.closed && this.query.trim() !== "") this.paintNow();
  }

  /** Vault changes repaint and read, and showing the tab catches up on what came while it was hidden. */
  private watchVault(): void {
    // Any file made, gone or renamed is a card; only a notebook's edits change one (a note's
    // preview catches up at the next paint, not at every save).
    const listed = (): void => {
      if (this.containerEl.isShown()) this.refreshSoon();
      else this.stale = true;
    };
    const touched = (file: TAbstractFile): void => {
      if (file instanceof TFile && !this.reads.has(file.path) && !this.isNotebook(file)) return;
      // A notebook saved while Home is a tab in the background is read when Home is shown.
      if (this.containerEl.isShown()) this.refreshSoon();
      else this.stale = true;
    };
    this.registerEvent(this.app.vault.on("create", listed));
    this.registerEvent(this.app.vault.on("delete", listed));
    // Stars and folder looks follow renames and deletes in the plugin (main.ts), Home open or not.
    this.registerEvent(this.app.vault.on("rename", listed));
    this.registerEvent(this.app.vault.on("modify", touched));

    // A notebook read since: its place has moved.
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf !== this.leaf) return;
        // A notebook visited meanwhile may have read pages: search what it kept.
        this.extras = null;
        if (this.stale) this.refreshNow();
        else this.paintNow();
      }),
    );
  }

  /** The update control as `updateButtonLook` says: the arrows, a spin, "No update", or the pill. */
  private paintUpdate(): void {
    const el = this.updateEl;
    if (!el) return;
    const look = updateButtonLook(this.host.update(), this.checkPhase);
    if (
      el.dataset.look === look.kind &&
      el.dataset.version === (look.kind === "update" ? look.version : "")
    )
      return;
    el.dataset.look = look.kind;
    el.dataset.version = look.kind === "update" ? look.version : "";
    el.empty();
    const pill = look.kind === "update" || look.kind === "none";
    el.toggleClass("is-pill", pill);
    el.toggleClass("is-checking", look.kind === "checking");
    el.toggleClass("is-update", look.kind === "update");
    el.toggleClass("clickable-icon", !pill);
    const icon = el.createSpan({ cls: "goodobsidian-library-update-icon" });
    switch (look.kind) {
      case "update":
        setIcon(icon, "arrow-up-circle");
        el.createSpan({
          cls: "goodobsidian-library-update-text",
          text: t("notebooks.home.updateTo", { version: look.version }),
        });
        el.setAttribute("aria-label", t("settings.update.out", { version: look.version }));
        break;
      case "none":
        setIcon(icon, "check");
        el.createSpan({
          cls: "goodobsidian-library-update-text",
          text: t("notebooks.home.noUpdate"),
        });
        // Its words name it; a tooltip would only repeat them.
        el.removeAttribute("aria-label");
        break;
      case "offline":
        setIcon(icon, "wifi-off");
        el.setAttribute("aria-label", t("notebooks.home.updateOffline"));
        break;
      default:
        setIcon(icon, "refresh-cw");
        el.setAttribute("aria-label", t("notebooks.home.checkUpdate"));
    }
  }

  /** A tap on the update control: install the update that is known, or look for one. */
  private tapUpdate(): void {
    if (this.host.update() !== null) {
      this.host.openUpdate();
      return;
    }
    if (this.checkPhase === "checking") return;
    window.clearTimeout(this.checkTimer);
    this.checkPhase = "checking";
    this.paintUpdate();
    void this.host
      .checkUpdate()
      .catch((): CheckOutcome => "offline")
      .then((outcome) => {
        this.checkPhase = phaseAfter(outcome);
        this.paintUpdate();
        if (this.checkPhase === "idle") return;
        this.checkTimer = window.setTimeout(() => {
          this.checkPhase = "idle";
          this.paintUpdate();
        }, CHECK_RESULT_MS);
      });
  }

  override async onClose(): Promise<void> {
    window.clearTimeout(this.checkTimer);
    this.closed = true;
    this.unloadPreviews();
    this.pagesOf?.dispose();
    this.pagesOf = null;
    this.pdf?.destroy();
    this.pdf = null;
    if (this.workerHeld) releasePdfWorker();
    this.workerHeld = false;
    window.clearTimeout(this.refreshTimer);
  }

  // --- Data -------------------------------------------------------------------

  /** Where this device left each notebook (the notebook view keeps the map). */
  private lastPages(): LastPages {
    const raw: unknown = this.app.loadLocalStorage(LAST_PAGES_KEY);
    if (typeof raw !== "string") return parseLastPages(null);
    try {
      return parseLastPages(JSON.parse(raw));
    } catch {
      return parseLastPages(null);
    }
  }

  /** A notebook the library lists: any ink note but a handwriting practice sheet, outside the inbox. */
  private isNotebook(file: TFile): boolean {
    return (
      this.host.isInkFile(file) &&
      !file.name.toLowerCase().endsWith(PRACTICE_FILE_SUFFIX) &&
      !file.path.startsWith(`${INBOX_FOLDER}/`)
    );
  }

  private isNotebookPath(path: string): boolean {
    const file = this.app.vault.getFileByPath(path);
    return file !== null && this.isNotebook(file);
  }

  private notebookFiles(): TFile[] {
    return this.app.vault.getFiles().filter((f) => this.isNotebook(f));
  }

  /**
   * The vault's other files, shown beside the notebooks: all but ink notes
   * that are not notebooks, what FineNotes keeps for itself, and what a
   * notebook with a folder of its own holds (it is the notebook).
   */
  private otherFiles(): TFile[] {
    const all = this.app.vault.getFiles();
    const notebooks = new Set(all.filter((f) => this.isNotebook(f)).map((f) => f.path));
    const owned = notebookOwnedFiles(
      all.map((f) => f.path),
      (path) => notebooks.has(path),
    );
    const inside = (file: TFile, folder: string): boolean => file.path.startsWith(`${folder}/`);
    // The Home note FineNotes made opens this view: a card for it would open Home again.
    const ownHome = (file: TFile): boolean =>
      file.path === HOME_FILE &&
      this.app.metadataCache.getFileCache(file)?.frontmatter?.[HOME_FILE_FLAG] === true;
    return all.filter(
      (f) =>
        !this.host.isInkFile(f) &&
        !owned.has(f.path) &&
        !inside(f, INBOX_FOLDER) &&
        !inside(f, ASSETS_FOLDER) &&
        !ownHome(f),
    );
  }

  /** Every notebook, and every other file the library shows. */
  private entries(): LibraryEntry[] {
    return [
      ...this.notebookFiles().map((file) => this.entryOf(file)),
      ...this.otherFiles().map((file) => ({
        ...fileEntry(file.path, file.stat.mtime),
        created: file.stat.ctime,
      })),
    ];
  }

  /** What a notebook's card shows: its last read, or its file's facts until it is read. */
  private entryOf(file: TFile): LibraryEntry {
    const read = this.reads.get(file.path);
    const fresh = read && read.mtime === file.stat.mtime && read.size === file.stat.size;
    const entry = fresh
      ? read.entry
      : (read?.entry ?? placeholderEntry(file.path, file.stat.mtime));
    return { ...entry, created: file.stat.ctime };
  }

  /** A change in the vault: repaint at once, read what changed a moment later. */
  private refreshSoon(): void {
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => this.refreshNow(), 400);
  }

  /**
   * Read every notebook whose file changed since it was last read, newest
   * first, one at a time. A change while it reads makes it go round once
   * more when it ends, so nothing that changed meanwhile is missed.
   */
  private readStale(): Promise<void> {
    if (this.reading) {
      this.again = true;
      return this.reading;
    }
    this.reading = this.readLoop();
    return this.reading;
  }

  private async readLoop(): Promise<void> {
    try {
      do {
        this.again = false;
        await this.readRound();
      } while (this.again && !this.closed);
    } finally {
      // Cleared in the same step as the last look at `again`: no change lands in between.
      this.reading = null;
    }
  }

  /**
   * One pass over what changed. The first few reads repaint the page (the
   * Continue strip is made of them); the rest redraw their own cards, and
   * the page is put in order once at the end. A page rebuilt under a finger
   * loses its tap, and every card on it would fade in again.
   */
  private async readRound(): Promise<void> {
    const live = new Set<string>();
    const stale: TFile[] = [];
    for (const file of this.notebookFiles()) {
      live.add(file.path);
      if (!this.entryFresh(file) || !this.textFresh(file)) stale.push(file);
    }
    const changes = new Map<string, Read | null>();
    const textChanges = new Map<string, NotebookTextRecord | null>();
    for (const path of [...this.reads.keys()])
      if (!live.has(path)) {
        this.reads.delete(path);
        changes.set(path, null);
      }
    for (const path of [...this.texts.keys()])
      if (!live.has(path)) {
        this.texts.delete(path);
        textChanges.set(path, null);
      }
    // Grape's readings of notebooks gone or renamed are let go.
    if (textChanges.size > 0) pruneReadings(this.vaultKey(), (path) => live.has(path));
    sessionReads.set(this.vaultKey(), this.reads);
    this.skipCrashed(stale, changes, textChanges);
    // Cards first; notebooks read only for their text (the one-time index) after, newest first.
    const rank = (file: TFile): number => (this.entryFresh(file) ? 1 : 0);
    stale.sort((a, b) => rank(a) - rank(b) || b.stat.mtime - a.stat.mtime);
    let count = 0;
    let unsorted = false;
    for (const file of stale) {
      if (this.closed) {
        saveEntries(this.vaultKey(), changes);
        saveNotebookTexts(this.vaultKey(), textChanges);
        return;
      }
      const { mtime, size } = file.stat;
      // Only its text was missing (kept from before searching inside notebooks): its card stays.
      const textOnly = this.entryFresh(file);
      // Decoded in the read worker; its cover drawn from that same read, never a second one.
      this.markReading(file);
      const { entry, cover, text } = await this.pages()
        .readEntry(file, mtime, !textOnly)
        .finally(() => this.markReading(null));
      if (text) {
        const record = { mtime, size, pages: text };
        this.texts.set(file.path, record);
        textChanges.set(file.path, record);
      }
      if (textChanges.size >= 20) {
        saveNotebookTexts(this.vaultKey(), new Map(textChanges));
        textChanges.clear();
      }
      if (textOnly) {
        // The one-time index: a breath between notebooks, so memory is let go as it goes.
        await new Promise<void>((resolve) => window.setTimeout(resolve, TEXT_ONLY_GAP_MS));
        continue;
      }
      if (cover) await this.keepOwnCover(file, cover).catch(() => undefined);
      const read = { mtime, size, entry };
      this.reads.set(file.path, read);
      changes.set(file.path, read);
      // Kept in batches: a reading cut short by closing Home keeps what it read.
      if (changes.size >= 20) {
        saveEntries(this.vaultKey(), new Map(changes));
        changes.clear();
      }
      count++;
      unsorted = count !== CONTINUE_COUNT;
      if (unsorted) this.redrawCards(file);
      else this.paintNow();
      // Let the app breathe between notebooks.
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
    saveEntries(this.vaultKey(), changes);
    saveNotebookTexts(this.vaultKey(), textChanges);
    if (unsorted && !this.closed) this.paintNow();
    else if (textChanges.size > 0 && this.query.trim() !== "") this.schedulePageHits();
  }

  /** Marks the notebook being read on this device (`null`: none), before the read and after it. */
  private markReading(file: TFile | null): void {
    try {
      this.app.saveLocalStorage(
        READING_MARK_KEY,
        file
          ? JSON.stringify({ path: file.path, stamp: `${file.stat.mtime}:${file.stat.size}` })
          : null,
      );
    } catch {
      // No storage: nothing to guard with.
    }
  }

  /**
   * A mark left by a read that never ended (the app was closed or killed
   * under it): that notebook, as it is now, gets a plain card and no text,
   * and is not read again until its file changes, so a notebook too big for
   * this device cannot take Home down at every launch.
   */
  private skipCrashed(
    stale: TFile[],
    changes: Map<string, Read | null>,
    textChanges: Map<string, NotebookTextRecord | null>,
  ): void {
    let path: unknown = null;
    let stamp: unknown = null;
    try {
      const raw: unknown = this.app.loadLocalStorage(READING_MARK_KEY);
      if (typeof raw !== "string") return;
      ({ path, stamp } = JSON.parse(raw) as { path?: unknown; stamp?: unknown });
    } catch {
      return;
    }
    this.markReading(null);
    const at = stale.findIndex(
      (f) => f.path === path && `${f.stat.mtime}:${f.stat.size}` === stamp,
    );
    if (at < 0) return;
    const [file] = stale.splice(at, 1);
    const { mtime, size } = file.stat;
    const read = this.entryFresh(file)
      ? this.reads.get(file.path)
      : { mtime, size, entry: placeholderEntry(file.path, mtime) };
    if (read && !this.entryFresh(file)) {
      this.reads.set(file.path, read);
      changes.set(file.path, read);
    }
    const record = { mtime, size, pages: [] };
    this.texts.set(file.path, record);
    textChanges.set(file.path, record);
  }

  /** Whether a notebook's card is from its file as it is now. */
  private entryFresh(file: TFile): boolean {
    const read = this.reads.get(file.path);
    return !!read && read.mtime === file.stat.mtime && read.size === file.stat.size;
  }

  /** Whether a notebook's text for searching is from its file as it is now. */
  private textFresh(file: TFile): boolean {
    const text = this.texts.get(file.path);
    return !!text && text.mtime === file.stat.mtime && text.size === file.stat.size;
  }

  // --- Painting ---------------------------------------------------------------

  /** One notebook's cards drawn again where they stand: nothing else on the page moves or fades in. */
  private redrawCards(file: TFile): void {
    const shown = this.cards.get(file.path);
    if (!shown) return;
    this.cards.delete(file.path);
    const entry = this.entryOf(file);
    for (const { el, leftAt } of shown) {
      const parent = el.parentElement;
      if (!parent) continue;
      el.replaceWith(this.card(parent, entry, leftAt, true));
    }
  }

  /** A card put on the page: it fades in only when the last paint did not show it, or `animate` said so. */
  private enter(card: HTMLElement, key: string, settled = this.before.has(key)): void {
    this.painted.add(key);
    card.toggleClass("is-settled", settled);
  }

  /**
   * The page drawn anew. `animate`: every card fades in, as on opening a
   * folder or a new sort; otherwise only cards the page did not show before.
   */
  private paintNow(animate = false): void {
    if (!this.bodyEl) return;
    this.before = animate ? new Set() : this.painted;
    this.painted = new Set();
    this.cards.clear();
    const searching = this.query.trim() !== "";
    // With the rail the path is on the left; the title is the open folder's name alone.
    const names = crumbs(this.folder).map((c) => c.name);
    this.titleEl.setText(
      this.folder === ""
        ? t("notebooks.home.heading")
        : this.hasRail()
          ? (names[names.length - 1] ?? this.folder)
          : names.join(" / "),
    );
    this.upEl.toggleClass("is-hidden", this.folder === "");
    this.unloadPreviews();
    this.paintUpdate();
    this.bodyEl.empty();

    const all = this.entries();
    this.simple = document.body.hasClass(SIMPLE_CLASS);
    const mode = this.railMode();
    const rail = mode === "side";
    this.contentEl.toggleClass("has-rail", rail);
    this.contentEl.toggleClass("has-drawer", mode === "drawer");
    this.contentEl.toggleClass("is-narrow", this.contentEl.clientWidth <= 760);
    this.railButton.toggleClass("is-hidden", !this.simple);
    this.railButton.toggleClass("is-active", mode !== "none");
    this.railButton.setAttribute("aria-pressed", String(mode !== "none"));
    // Folders are filed from every item, then filtered: "Notebooks only" hides files, never moves notebooks.
    const keep = (e: LibraryEntry): boolean => !this.onlyNotebooks || e.kind === "notebook";
    if (mode !== "none") this.paintRail(all, keep);
    else this.railEl.empty();
    if (this.previewPath !== null && !all.some((e) => e.path === this.previewPath))
      this.hidePreview();
    if (all.length === 0) {
      const empty = this.bodyEl.createDiv({ cls: "goodobsidian-library-empty" });
      empty.createDiv({ text: t("notebooks.home.empty") });
      const button = empty.createEl("button", {
        text: t("notebooks.menu.newNotebook"),
        cls: "mod-cta",
      });
      button.addEventListener("click", () => this.host.newNotebook(this.folder));
      return;
    }

    if (searching) {
      const found = sortEntries(
        searchEntries(all.filter(keep), this.query),
        this.sort,
        this.reverse,
      );
      // Titles answer at once; the pages holding the words follow under them.
      if (found.length > 0) this.grid(found, t("notebooks.home.results"));
      const previous = this.hitsEl;
      this.hitsEl = this.bodyEl.createDiv({ cls: "goodobsidian-library-hits-area" });
      this.hitsEl.dataset.titles = String(found.length);
      // What the last search showed stays until this one's answer replaces it.
      if (previous) this.hitsEl.append(...Array.from(previous.childNodes));
      else if (found.length === 0 && this.texts.size === 0) this.noMatch(this.hitsEl);
      this.schedulePageHits();
      return;
    }
    this.hitsEl = null;
    window.clearTimeout(this.hitsTimer);

    const left = this.lastPages();
    const stars = this.host.stars();
    const made = this.host.folderStyles();
    const here = browse(
      hoistSingles(all, (folder) => made[folder] !== undefined).filter(keep),
      this.folder,
    );
    if (this.folder === "" && stars.length > 0) {
      const books = all.filter((e) => isStarred(stars, e.path));
      const folders = stars
        .filter((path) => this.app.vault.getAbstractFileByPath(path) instanceof TFolder)
        .map((path) => this.folderTile(all.filter(keep), path))
        .filter((f): f is FolderTile => f !== null);
      if (books.length + folders.length > 0) {
        this.label(t("notebooks.home.favorites"));
        const row = this.bodyEl.createDiv({ cls: this.gridClass() });
        for (const folder of folders) {
          this.folderCard(row, folder);
        }
        for (const entry of books) {
          this.card(row, entry, left[entry.path]?.index);
        }
      }
    }
    if (this.folder === "") {
      const recent = continueEntries(
        all.filter((e) => e.kind === "notebook" && e.pages > 0),
        CONTINUE_COUNT + RECENT_COUNT,
        (path) => left[path]?.at ?? 0,
      );
      if (recent.length > 0) {
        this.label(t("notebooks.home.continue"));
        const [first, ...more] = recent.slice(0, CONTINUE_COUNT);
        if (first) this.continueCard(first, left[first.path]?.index, more, left);
      }
      // The ones read or written before those, newest first.
      const earlier = recent.slice(CONTINUE_COUNT);
      if (earlier.length > 0) {
        this.label(t("notebooks.home.recent"));
        const row = this.bodyEl.createDiv({
          cls: `${this.gridClass()} goodobsidian-library-recent-row`,
        });
        for (const entry of earlier) this.card(row, entry, left[entry.path]?.index);
      }
    }
    const folders =
      rail && this.folder === "" ? [] : [...here.folders, ...this.emptyFolders(here.folders)];
    if (folders.length > 0) {
      this.label(t("notebooks.home.folders"));
      const row = this.bodyEl.createDiv({ cls: this.gridClass() });
      for (const folder of starredFirst(folders, stars, (f) => f.path))
        this.folderCard(row, folder);
    }
    // At the top, the root's own files, then every notebook in the vault; inside a folder,
    // its notebooks and files together.
    const atTop = this.folder === "";
    if (atTop) {
      const files = here.notebooks.filter((e) => e.kind !== "notebook");
      if (files.length > 0)
        this.grid(sortEntries(files, this.sort, this.reverse), t("notebooks.home.files"));
    }
    const rest = atTop ? all.filter((e) => e.kind === "notebook") : here.notebooks;
    if (rest.length > 0) {
      this.grid(
        sortEntries(rest, this.sort, this.reverse),
        atTop
          ? t("notebooks.home.all")
          : t(SORTS.find((s) => s.by === this.sort)?.label ?? "notebooks.home.sortEdited"),
        atTop,
      );
    }
  }

  /** Folders directly in this one that hold no file at all: made here, and waiting for a notebook. */
  private emptyFolders(listed: readonly { path: string }[]): FolderTile[] {
    const root = this.app.vault.getFolderByPath(this.folder === "" ? "/" : this.folder);
    if (!root) return [];
    // Only folders made here: an empty folder of the vault's own is not a notebook shelf.
    const made = this.host.folderStyles();
    const holdsFiles = (folder: TFolder): boolean =>
      folder.children.some((c) => c instanceof TFile || (c instanceof TFolder && holdsFiles(c)));
    return root.children
      .filter(
        (c): c is TFolder =>
          c instanceof TFolder &&
          !c.name.startsWith(".") &&
          c.path !== INBOX_FOLDER &&
          made[c.path] !== undefined &&
          !holdsFiles(c) &&
          !listed.some((l) => l.path === c.path),
      )
      .map((c) => ({ path: c.path, name: c.name, count: 0, notebooks: 0 }));
  }

  private label(text: string): void {
    this.bodyEl.createDiv({ cls: "goodobsidian-library-label", text });
  }

  /** A heading with a caret that folds what is under it; the choice is kept on this device. */
  private foldLabel(text: string): void {
    const head = this.bodyEl.createEl("button", {
      cls: "goodobsidian-library-label goodobsidian-library-fold clickable-icon",
      attr: { type: "button", "aria-expanded": String(!this.allFolded) },
    });
    head.createSpan({ text });
    const caret = head.createSpan({ cls: "goodobsidian-library-fold-caret" });
    setIcon(caret, this.allFolded ? "chevron-right" : "chevron-down");
    head.addEventListener("click", () => {
      this.allFolded = !this.allFolded;
      this.app.saveLocalStorage(ALL_FOLDED_KEY, this.allFolded ? "1" : "0");
      this.paintNow();
    });
  }

  private grid(entries: LibraryEntry[], label: string, foldable = false): void {
    if (foldable) {
      this.foldLabel(label);
      if (this.allFolded) return;
    } else this.label(label);
    const grid = this.bodyEl.createDiv({ cls: this.gridClass() });
    for (const entry of starredFirst(entries, this.host.stars(), (e) => e.path)) {
      this.card(grid, entry);
    }
  }

  /** A starred folder as a tile: how many items it holds, or null when it holds none now. */
  private folderTile(all: LibraryEntry[], path: string): FolderTile | null {
    const inside = all.filter((e) => e.folder === path || e.folder.startsWith(`${path}/`));
    if (inside.length === 0) return null;
    return {
      path,
      name: path.split("/").pop() ?? path,
      count: inside.length,
      notebooks: inside.filter((e) => e.kind === "notebook").length,
    };
  }

  /** The star in a cover's top right corner: on for a starred item, a tap toggles it. */
  private starButton(cover: HTMLElement, path: string, title: string): void {
    const on = isStarred(this.host.stars(), path);
    const star = cover.createEl("button", {
      cls: "clickable-icon goodobsidian-library-star",
      attr: {
        type: "button",
        "aria-label": on
          ? t("notebooks.home.starRemove", { name: title })
          : t("notebooks.home.starAdd", { name: title }),
        "aria-pressed": String(on),
      },
    });
    star.toggleClass("is-on", on);
    setIcon(star, "star");
    // The card opens on a tap; the star must not.
    star.addEventListener("click", (event) => {
      event.stopPropagation();
      this.host.setStars(toggleStar(this.host.stars(), path));
      this.paintNow();
    });
    star.addEventListener("keydown", (event) => event.stopPropagation());
  }

  /** A folder as a tile: a coloured folder with its icon, a star, and its name with a ⌄ for its menu. */
  private folderCard(parent: HTMLElement, folder: FolderTile): void {
    const card = parent.createDiv({
      cls: "goodobsidian-library-card",
      attr: { role: "button", tabindex: "0", "aria-label": folder.name },
    });
    this.enter(card, `folder:${folder.path}`);
    const style = this.host.folderStyles()[folder.path] ?? {};
    const cover = card.createDiv({ cls: "goodobsidian-library-cover is-folder" });
    cover.style.setProperty("--gob-folder", style.color ?? DEFAULT_FOLDER_COLOR);
    const art = cover.createDiv({ cls: "goodobsidian-library-folder-art" });
    art.createDiv({ cls: "goodobsidian-library-folder-back" });
    const front = art.createDiv({ cls: "goodobsidian-library-folder-front" });
    setIcon(front, style.icon ?? DEFAULT_FOLDER_ICON);
    this.starButton(art, folder.path, folder.name);
    const caption = card.createDiv({ cls: "goodobsidian-library-caption" });
    this.nameRow(caption, folder.name, (event) => this.openFolderMenu(event, folder));
    caption.createDiv({
      cls: "goodobsidian-library-when",
      text:
        folder.count === 0
          ? t("notebooks.home.folderEmpty")
          : folder.notebooks === folder.count
            ? tn("notebooks.home.folderCount", folder.count)
            : tn("notebooks.home.itemCount", folder.count),
    });
    card.toggleClass("is-selected", this.selected.has(folder.path));
    const open = (): void =>
      this.selecting ? this.toggleSelected(card, folder.path) : this.openFolder(folder.path);
    card.addEventListener("click", open);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
    this.makeDraggable(card, folder.path);
    this.makeDropTarget(card, folder.path);
    card.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.openFolderMenu(event, folder);
    });
  }

  /** The name, and beside it the ⌄ that opens the item's menu. */
  private nameRow(
    caption: HTMLElement,
    name: string,
    menu: (event: MouseEvent | KeyboardEvent) => void,
  ): void {
    const row = caption.createDiv({ cls: "goodobsidian-library-name-row" });
    row.createDiv({ cls: "goodobsidian-library-name", text: name });
    const caret = row.createEl("button", {
      cls: "clickable-icon goodobsidian-library-caret",
      attr: {
        type: "button",
        "aria-label": t("notebooks.home.options", { name }),
        "aria-haspopup": "menu",
      },
    });
    setIcon(caret, "chevron-down");
    caret.addEventListener("click", (event) => {
      event.stopPropagation();
      menu(event);
    });
    caret.addEventListener("keydown", (event) => event.stopPropagation());
  }

  /**
   * The notebook's first PDF page as its cover; the title shows until then.
   * A cover made before, this session or an earlier one, is a small JPEG
   * kept on this device (`home-cache.ts`) and shows at once; only a new or
   * changed PDF is rendered, and that once (FineNotes#146).
   */
  private paintPdfCover(cover: HTMLElement, pdf: LibraryPdf): void {
    cover.addClass("is-pdf");
    const file = this.app.vault.getFileByPath(pdf.path);
    if (!file) return;
    const dpr = window.devicePixelRatio || 1;
    const w = 240;
    const key = coverKey(pdf, file.stat, w * dpr);
    const vault = this.vaultKey();
    const show = (url: string, atOnce: boolean): void => {
      const img = cover.createEl("img", {
        cls: "goodobsidian-library-pdf",
        attr: { alt: "", decoding: "async", draggable: "false" },
      });
      img.src = url;
      if (atOnce) cover.addClass("is-cached");
      const ready = (): void => {
        cover.addClass("is-ready");
      };
      if (img.complete && img.naturalWidth > 0) ready();
      else img.addEventListener("load", ready, { once: true });
    };
    const now = coverUrlNow(key);
    if (now) {
      show(now, true);
      return;
    }
    // A library of many PDFs must not open and rasterise them all at once
    // (FineNotes#146: the page lagged, then the app was killed for memory).
    // A cover starts when it is on screen, and new ones render two at a time.
    // A PDF of the vault's own has no notebook page to fit: its page keeps its own size, in
    // points (a notebook page is ~1024 px wide, a PDF page ~600 pt).
    const sized = pdf.width > 0 && pdf.height > 0;
    const render = async (): Promise<void> => {
      if (this.closed || !cover.isConnected) return;
      const entry = await this.pdfCache().resolve(
        pdf.path,
        pdf.page,
        sized ? thumbnailRasterScale(dpr) : thumbnailRasterScale(dpr) * 1.7,
        sized ? { geometry: { width: pdf.width, height: pdf.height } } : undefined,
        true,
      );
      if (!entry.ok) return;
      const canvas = createEl("canvas");
      const h = sized
        ? Math.max(1, Math.round((w * pdf.height) / pdf.width))
        : Math.max(1, Math.round((w * entry.canvas.height) / Math.max(1, entry.canvas.width)));
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(entry.canvas, 0, 0, canvas.width, canvas.height);
      // The cover is copied; close the PDF so a library of many keeps none open.
      this.pdf?.forget(pdf.path);
      const url = await saveCover(vault, key, canvas);
      canvas.width = canvas.height = 0;
      if (url && cover.isConnected && !cover.hasClass("is-ready")) show(url, false);
    };
    // A cover kept on this device needs no render; otherwise it takes its turn in the queue.
    this.whenSeen(cover, async () => {
      const url = await loadCover(vault, key);
      if (this.closed || !cover.isConnected) return;
      if (url) show(url, false);
      else await render();
    });
  }

  /** `job` queued once `cover` comes near the screen: a big folder never draws every cover at once. */
  private whenSeen(cover: HTMLElement, job: () => Promise<void>): void {
    const start = (): void => this.queueCover(job);
    if (typeof IntersectionObserver === "undefined") {
      start();
      return;
    }
    const seen = new IntersectionObserver(
      (hits) => {
        if (!hits.some((hit) => hit.isIntersecting)) return;
        seen.disconnect();
        start();
      },
      { rootMargin: "400px" },
    );
    seen.observe(cover);
  }

  /**
   * A file's cover: its first page (a note, a PDF), the picture itself, or
   * a symbol and its extension for a file the library cannot draw. The
   * name shows until the page is drawn.
   */
  private paintFileCover(cover: HTMLElement, entry: LibraryEntry): void {
    cover.addClass("is-file", entry.kind === "file" ? "is-other" : `is-${entry.kind}`);
    if (entry.kind === "file") {
      setIcon(cover.createDiv({ cls: "goodobsidian-library-file-icon" }), fileIcon(entry.path));
      cover.createSpan({ cls: "goodobsidian-library-file-ext", text: extensionLabel(entry.path) });
      return;
    }
    cover.createSpan({ cls: "goodobsidian-library-cover-title", text: entry.title });
    if (entry.kind === "pdf" && entry.pdf) this.paintPdfCover(cover, entry.pdf);
    else if (entry.kind === "image") this.paintImageCover(cover, entry.path);
    else if (entry.kind === "note") this.paintNoteCover(cover, entry.path);
  }

  /**
   * A picture as its own cover, drawn small into a canvas: a folder of
   * photos must not keep every one decoded at full size (FineNotes#146).
   */
  private paintImageCover(cover: HTMLElement, path: string): void {
    const canvas = cover.createEl("canvas", { cls: "goodobsidian-library-raster" });
    const draw = async (): Promise<void> => {
      const file = this.app.vault.getFileByPath(path);
      if (this.closed || !canvas.isConnected || !file) return;
      const image = new Image();
      image.decoding = "async";
      image.src = this.app.vault.getResourcePath(file);
      try {
        await image.decode();
      } catch {
        return;
      }
      if (!canvas.isConnected || !(image.naturalWidth > 0)) return;
      // The whole picture, its longer side as long as a cover is tall; never larger than it is.
      const dpr = window.devicePixelRatio || 1;
      const fit = Math.min(1, (320 * dpr) / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * fit));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * fit));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      image.src = "";
      cover.addClass("is-ready");
    };
    this.whenSeen(cover, draw);
  }

  /** What renders the note previews on the page, let go at the next paint. */
  private previews: Component[] = [];

  private unloadPreviews(): void {
    for (const preview of this.previews) preview.unload();
    this.previews = [];
    // The covers it watched are gone with the page.
    this.noteObserver?.disconnect();
  }

  /**
   * A note's first page: the start of the note rendered as Obsidian renders
   * it, on a page laid out at a fixed width and scaled to the cover, so it
   * reads like a small copy of the note. It takes no taps; the card does.
   */
  private paintNoteCover(cover: HTMLElement, path: string): void {
    const page = cover.createDiv({
      cls: "goodobsidian-library-note markdown-rendered",
      attr: { "aria-hidden": "true", inert: "" },
    });
    page.style.width = `${NOTE_PAGE_WIDTH}px`;
    const draw = async (): Promise<void> => {
      const file = this.app.vault.getFileByPath(path);
      if (this.closed || !page.isConnected || !file) return;
      const text = notePreviewText(await this.app.vault.cachedRead(file));
      if (!page.isConnected || text === "") return;
      const owner = new Component();
      owner.load();
      this.previews.push(owner);
      await MarkdownRenderer.render(this.app, text, page, path, owner);
      if (!page.isConnected) return;
      // Its first report scales the page to the cover.
      this.noteSizes().observe(cover);
      cover.addClass("is-ready");
    };
    this.whenSeen(cover, draw);
  }

  private noteObserver: ResizeObserver | null = null;

  /** One watcher for every note cover: a page follows its cover when the grid's columns change. */
  private noteSizes(): ResizeObserver {
    this.noteObserver ??= new ResizeObserver((changes) => {
      for (const change of changes) {
        const cover = change.target as HTMLElement;
        const page = cover.querySelector<HTMLElement>(".goodobsidian-library-note");
        const width = cover.clientWidth;
        if (page && width > 0)
          page.style.setProperty("--gob-note-scale", String(width / NOTE_PAGE_WIDTH));
      }
    });
    return this.noteObserver;
  }

  private readonly coverQueue: Array<() => Promise<void>> = [];
  private coversRunning = 0;

  /** Runs cover renders two at a time, in the order they came into view. */
  private queueCover(job: () => Promise<void>): void {
    this.coverQueue.push(job);
    this.pumpCovers();
  }

  private pumpCovers(): void {
    while (!this.closed && this.coversRunning < 2) {
      const job = this.coverQueue.shift();
      if (!job) return;
      this.coversRunning++;
      void job()
        .catch(() => undefined)
        .finally(() => {
          this.coversRunning--;
          this.pumpCovers();
        });
    }
  }

  /** The PDF raster cache, made with the first PDF cover, rendering in the shared worker once it is up. */
  private pdfCache(): PdfBackdropCache {
    if (this.pdf) return this.pdf;
    const cache = new PdfBackdropCache(this.app);
    this.pdf = cache;
    if (!this.workerHeld) {
      this.workerHeld = true;
      void acquirePdfWorker().then((worker) => {
        if (worker && this.pdf === cache) cache.setWorker(worker);
      });
    }
    return cache;
  }

  /**
   * A cover with its caption. With `leftAt` (the index it was left on) it
   * shows where the reader is. `settled`: drawn again in place, no fade-in.
   */
  private card(
    parent: HTMLElement,
    entry: LibraryEntry,
    leftAt?: number,
    settled?: boolean,
  ): HTMLElement {
    const card = parent.createDiv({
      cls: "goodobsidian-library-card",
      attr: { role: "button", tabindex: "0", "aria-label": entry.title },
    });
    this.enter(card, entry.path, settled);
    this.cards.set(entry.path, [...(this.cards.get(entry.path) ?? []), { el: card, leftAt }]);
    const cover = card.createDiv({ cls: "goodobsidian-library-cover" });
    const notebook = entry.kind === "notebook";
    if (notebook) {
      const palette = coverPalette(entry.color);
      cover.style.setProperty("--gob-cover", palette.base);
      cover.style.setProperty("--gob-cover-ink", palette.title);
      cover.style.setProperty("--gob-cover-spine", palette.spine);
      cover.style.setProperty("--gob-cover-hi", palette.sheenLight);
      cover.style.setProperty("--gob-cover-lo", palette.sheenDark);
      cover.createSpan({ cls: "goodobsidian-library-cover-title", text: entry.title });
      if (entry.covered) this.paintOwnCover(cover, entry);
      else if (entry.pdf) this.paintPdfCover(cover, entry.pdf);
    } else this.paintFileCover(cover, entry);
    this.starButton(cover, entry.path, entry.title);
    const caption = card.createDiv({ cls: "goodobsidian-library-caption" });
    this.nameRow(caption, entry.title, (event) => this.openCardMenu(event, entry));
    const when = whenText(entry.edited, Date.now());
    const progress = readProgress(entry, leftAt);
    if (progress) {
      caption.createDiv({
        cls: "goodobsidian-library-when",
        text: `${t("notebooks.home.pageOf", { page: progress.page, total: progress.of })} · ${when}`,
      });
      const track = caption.createDiv({
        cls: "goodobsidian-library-progress",
        attr: {
          role: "progressbar",
          "aria-valuenow": String(progress.page),
          "aria-valuemax": String(progress.of),
        },
      });
      track.createDiv().style.width = `${Math.round(progress.ratio * 100)}%`;
    } else {
      caption.createDiv({
        cls: "goodobsidian-library-when",
        text: [
          entry.folder !== "" && this.query.trim() !== "" ? entry.folder : "",
          entry.pages > 0 ? tn("notebooks.home.pageCount", entry.pages) : "",
          // A note is what a vault is made of; any other file says what it is.
          notebook || entry.kind === "note" ? "" : extensionLabel(entry.path),
          when,
        ]
          .filter(Boolean)
          .join(" · "),
      });
    }

    card.toggleClass("is-selected", this.selected.has(entry.path));
    card.toggleClass("is-previewed", this.previewPath === entry.path);
    // One tap shows the preview; a second one on the same cover opens it.
    card.addEventListener("click", () => {
      if (this.selecting) {
        this.toggleSelected(card, entry.path);
        return;
      }
      const now = Date.now();
      if (isDoubleTap(this.lastTap, entry.path, now)) {
        this.lastTap = null;
        this.openItem(entry, leftAt);
        return;
      }
      this.lastTap = { key: entry.path, at: now };
      this.showPreview(entry, leftAt);
    });
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (this.selecting) this.toggleSelected(card, entry.path);
        else this.openItem(entry, leftAt);
      }
    });
    this.makeDraggable(card, entry.path);
    card.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.openCardMenu(event, entry);
    });
    return card;
  }

  // --- Folder rail, Continue, preview ------------------------------------------

  /** Home and the folders, the path to the open one unfolded; a row is a drop target. */
  private paintRail(all: LibraryEntry[], keep: (e: LibraryEntry) => boolean): void {
    const rail = this.railEl;
    rail.empty();
    const styles = this.host.folderStyles();
    const row = (
      label: string,
      icon: string | null,
      color: string | null,
      folder: string,
      depth: number,
      on: boolean,
      count?: number,
    ): HTMLElement => {
      const el = rail.createEl("button", {
        cls: "goodobsidian-library-rail-row clickable-icon",
        attr: { type: "button", "aria-current": on ? "page" : "false" },
      });
      el.toggleClass("is-on", on);
      el.style.setProperty("--gob-depth", String(depth));
      if (icon) setIcon(el.createSpan({ cls: "goodobsidian-library-rail-icon" }), icon);
      else
        el.createSpan({ cls: "goodobsidian-library-rail-dot" }).style.setProperty(
          "--gob-folder",
          color ?? DEFAULT_FOLDER_COLOR,
        );
      el.createSpan({ cls: "goodobsidian-library-rail-name", text: label });
      if (count !== undefined)
        el.createSpan({ cls: "goodobsidian-library-rail-count", text: String(count) });
      el.addEventListener("click", () => {
        // A drawer is put away once a folder is picked, as Obsidian's own is.
        this.drawerOpen = false;
        this.openFolder(folder);
      });
      this.makeDropTarget(el, folder);
      return el;
    };
    row(t("notebooks.home.title"), "house", null, "", 0, this.folder === "");
    rail.createDiv({ cls: "goodobsidian-library-rail-label", text: t("notebooks.home.folders") });
    const made = Object.keys(styles);
    const listed = hoistSingles(all, (folder) => styles[folder] !== undefined).filter(keep);
    for (const folder of railFolders(listed, this.folder, made)) {
      const el = row(
        folder.name,
        null,
        styles[folder.path]?.color ?? null,
        folder.path,
        folder.depth,
        folder.current,
        folder.count,
      );
      el.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        this.openFolderMenu(event, {
          path: folder.path,
          name: folder.name,
          count: folder.count,
          notebooks: folder.count,
        });
      });
    }
  }

  /**
   * The notebook read last as a wide card: its cover, where it was left
   * (page, folder, when, a bar), Continue, and the page itself; the next
   * ones read beside it, small.
   */
  private continueCard(
    entry: LibraryEntry,
    leftAt: number | undefined,
    more: LibraryEntry[],
    left: LastPages,
  ): void {
    const hero = this.bodyEl.createDiv({ cls: "goodobsidian-library-hero" });
    this.card(hero, entry, leftAt);
    const info = hero.createDiv({ cls: "goodobsidian-library-hero-info" });
    info.createDiv({ cls: "goodobsidian-library-hero-name", text: entry.title });
    const progress = readProgress(entry, leftAt);
    info.createDiv({
      cls: "goodobsidian-library-when",
      text: [
        entry.folder === ""
          ? ""
          : crumbs(entry.folder)
              .map((c) => c.name)
              .join(" › "),
        progress ? t("notebooks.home.pageOf", { page: progress.page, total: progress.of }) : "",
        whenText(entry.edited, Date.now()),
      ]
        .filter(Boolean)
        .join(" · "),
    });
    if (progress) {
      const track = info.createDiv({ cls: "goodobsidian-library-progress" });
      track.createDiv().style.width = `${Math.round(progress.ratio * 100)}%`;
    }
    const go = info.createEl("button", { cls: "mod-cta", text: t("notebooks.home.continue") });
    const index = leftAt ?? (entry.covered ? 1 : 0);
    go.addEventListener("click", () => this.openItem(entry, index));
    const sheet = hero.createDiv({
      cls: "goodobsidian-library-hero-page",
      attr: {
        role: "button",
        tabindex: "0",
        "aria-label": progress
          ? t("notebooks.home.pageOf", { page: progress.page, total: progress.of })
          : entry.title,
      },
    });
    sheet.addEventListener("click", () => this.openItem(entry, index));
    const file = this.app.vault.getFileByPath(entry.path);
    // Shown 220 px high, so at most ~300 px wide (a landscape page): drawn that wide.
    if (file) this.pagePicture(sheet, file, index, 300);
    if (more.length > 0) {
      const side = hero.createDiv({ cls: "goodobsidian-library-hero-more" });
      for (const next of more) this.card(side, next, left[next.path]?.index);
    }
  }

  /**
   * A notebook with a cover page shows that page as its cover, as the
   * notebook draws it (design, colour, title). It is drawn once, kept as a
   * small picture on this device, and shown over the plain cover when ready.
   */
  private ownCoverKey(file: TFile): string {
    const dpr = window.devicePixelRatio || 1;
    return `cover:${file.path}@${file.stat.mtime}:${file.stat.size}:${Math.round(COVER_WIDTH * dpr)}`;
  }

  /** The cover page of a notebook just read, kept as its cover picture unless one is kept already. */
  private async keepOwnCover(file: TFile, page: Page): Promise<void> {
    const key = this.ownCoverKey(file);
    if (coverUrlNow(key)) return;
    const vault = this.vaultKey();
    if (await loadCover(vault, key)) return;
    const canvas = await this.pages().renderOf(page, COVER_WIDTH);
    await saveCover(vault, key, canvas);
    canvas.width = canvas.height = 0;
  }

  private paintOwnCover(cover: HTMLElement, entry: LibraryEntry): void {
    const file = this.app.vault.getFileByPath(entry.path);
    if (!file) return;
    const key = this.ownCoverKey(file);
    const vault = this.vaultKey();
    const show = (url: string): void => {
      const img = cover.createEl("img", {
        cls: "goodobsidian-library-own",
        attr: { alt: "", decoding: "async", draggable: "false" },
      });
      img.src = url;
      const ready = (): void => {
        cover.addClass("is-own");
      };
      if (img.complete && img.naturalWidth > 0) ready();
      else img.addEventListener("load", ready, { once: true });
    };
    const now = coverUrlNow(key);
    if (now) {
      show(now);
      return;
    }
    this.whenSeen(cover, async () => {
      const kept = await loadCover(vault, key);
      if (this.closed || !cover.isConnected) return;
      if (kept) {
        show(kept);
        return;
      }
      // Not read since it changed: Home's own read draws the cover (keepOwnCover), then this card again.
      const read = this.reads.get(file.path);
      if (!read || read.mtime !== file.stat.mtime || read.size !== file.stat.size) return;
      const canvas = await this.pages().render(file, 0, COVER_WIDTH);
      if (!canvas || this.closed) return;
      const url = await saveCover(vault, key, canvas);
      canvas.width = canvas.height = 0;
      if (url && cover.isConnected) show(url);
    });
  }

  /** The preview of `entry`: its cover, facts, Open and ⋯, and (a notebook) its pages to open at. */
  private showPreview(entry: LibraryEntry, leftAt?: number): void {
    // The last preview's PDFs are closed; its pages are kept as pictures.
    this.pagesOf?.releasePdfs();
    this.previewPath = entry.path;
    this.contentEl.addClass("has-preview");
    this.contentEl
      .querySelectorAll(".goodobsidian-library-card.is-previewed")
      .forEach((el) => el.removeClass("is-previewed"));
    for (const { el } of this.cards.get(entry.path) ?? []) el.addClass("is-previewed");
    const pane = this.previewEl;
    pane.empty();
    pane.removeClass("is-hidden");
    const close = pane.createEl("button", {
      cls: "clickable-icon goodobsidian-library-preview-close",
      attr: { type: "button", "aria-label": t("common.close") },
    });
    setIcon(close, "x");
    close.addEventListener("click", () => this.hidePreview());

    const top = pane.createDiv({ cls: "goodobsidian-library-preview-top" });
    const shown = this.card(top, entry, leftAt, true);
    shown.removeClass("is-previewed");
    shown.addClass("is-in-preview");
    const info = top.createDiv({ cls: "goodobsidian-library-preview-info" });
    info.createDiv({ cls: "goodobsidian-library-hero-name", text: entry.title });
    const facts = [
      entry.folder === ""
        ? t("notebooks.home.title")
        : crumbs(entry.folder)
            .map((c) => c.name)
            .join(" › "),
      entry.pages > 0 ? tn("notebooks.home.pageCount", entry.pages) : "",
      whenText(entry.edited, Date.now()),
    ].filter(Boolean);
    for (const fact of facts) info.createDiv({ cls: "goodobsidian-library-when", text: fact });
    const buttons = info.createDiv({ cls: "goodobsidian-library-preview-buttons" });
    const open = buttons.createEl("button", { cls: "mod-cta", text: t("notebooks.home.open") });
    open.addEventListener("click", () => this.openItem(entry, leftAt));
    const more = buttons.createEl("button", {
      cls: "clickable-icon",
      attr: { type: "button", "aria-label": t("common.more"), "aria-haspopup": "menu" },
    });
    setIcon(more, "more-horizontal");
    more.addEventListener("click", (event) => this.openCardMenu(event, entry));

    if (entry.kind !== "notebook") return;
    const file = this.app.vault.getFileByPath(entry.path);
    if (!file) return;
    const strip = pane.createDiv({ cls: "goodobsidian-library-preview-pages" });
    const first = entry.covered ? 1 : 0;
    // A long notebook: its first page and the ones its contents and bookmarks point to.
    const sheets: PreviewSheet[] =
      entry.preview ??
      Array.from({ length: Math.min(entry.pages, HOME_PREVIEW_PAGES) }, (_, i) => ({
        index: first + i,
      }));
    for (const shown of sheets) {
      const { index } = shown;
      // Pages are counted without the cover, as Home's page count is.
      const number = index - first + 1;
      const holder = entry.preview
        ? strip.createDiv({ cls: "goodobsidian-library-preview-sheet" })
        : strip;
      const sheet = holder.createDiv({
        cls: "goodobsidian-library-preview-page",
        attr: {
          role: "button",
          tabindex: "0",
          "aria-label": t("notebooks.home.pageOf", { page: number, total: entry.pages }),
        },
      });
      if (entry.preview) {
        // The pages shown are not one after another: each says which it is.
        const caption = holder.createDiv({ cls: "goodobsidian-library-preview-caption" });
        caption.createSpan({ cls: "goodobsidian-page-embed-number", text: String(number) });
        if (shown.title !== undefined) caption.createSpan({ text: shown.title });
        if (shown.bookmarked) {
          const ribbon = holder.createDiv({ cls: "goodobsidian-library-preview-ribbon" });
          setIcon(ribbon, "bookmark");
        }
      }
      sheet.toggleClass("is-current", leftAt === index);
      sheet.addEventListener("click", () => this.openItem(entry, index));
      sheet.addEventListener("keydown", (event) => {
        if (event.key === "Enter") this.openItem(entry, index);
      });
      this.pagePicture(sheet, file, index, 110);
    }
  }

  /**
   * Page `index` of `file` drawn into `sheet` at the width it is shown
   * (at least `minWidth` CSS px, at most 420), as a small picture kept on
   * this device: shown again, it is there at once and nothing is drawn.
   */
  private pagePicture(sheet: HTMLElement, file: TFile, index: number, minWidth: number): void {
    const dpr = window.devicePixelRatio || 1;
    const show = (url: string): void => {
      if (!sheet.isConnected) return;
      const img = createEl("img", {
        cls: "goodobsidian-library-page-canvas",
        attr: { alt: "", decoding: "async", draggable: "false" },
      });
      img.src = url;
      sheet.empty();
      sheet.appendChild(img);
      sheet.addClass("is-ready");
    };
    const keyFor = (width: number): string =>
      `page:${file.path}#${index}@${file.stat.mtime}:${file.stat.size}:${Math.round(width * dpr)}`;
    const vault = this.vaultKey();
    this.whenSeen(sheet, async () => {
      if (this.closed || !sheet.isConnected) return;
      // Snapped to 40 px steps, so a pane a few px wider keeps its pictures.
      const shown = Math.ceil(Math.max(minWidth, sheet.clientWidth) / 40) * 40;
      const width = Math.min(420, shown);
      const key = keyFor(width);
      const kept = coverUrlNow(key) ?? (await loadCover(vault, key));
      if (kept) {
        show(kept);
        return;
      }
      const canvas = await this.pages().render(file, index, width);
      if (!canvas || this.closed) return;
      const url = await saveCover(vault, key, canvas);
      canvas.width = canvas.height = 0;
      if (url) show(url);
    });
  }

  private hidePreview(): void {
    if (this.previewPath === null) return;
    this.previewPath = null;
    this.pagesOf?.releasePdfs();
    this.contentEl.removeClass("has-preview");
    this.previewEl.addClass("is-hidden");
    this.previewEl.empty();
    this.contentEl
      .querySelectorAll(".goodobsidian-library-card.is-previewed")
      .forEach((el) => el.removeClass("is-previewed"));
  }

  // --- Search inside notebooks ---------------------------------------------------

  /** Search the pages a moment after typing pauses. */
  private schedulePageHits(): void {
    window.clearTimeout(this.hitsTimer);
    const query = this.query;
    this.hitsTimer = window.setTimeout(() => void this.fillPageHits(query), PAGE_SEARCH_DELAY_MS);
  }

  /** "No notebook matches", once neither a title nor a page did. */
  private noMatch(el: HTMLElement): void {
    el.empty();
    el.createDiv({ cls: "goodobsidian-library-label", text: t("notebooks.home.noMatch") });
  }

  /** What this device kept about pages, loaded once per search (and again after visiting a notebook). */
  private searchExtras(): Promise<SearchExtras> {
    if (this.extras) return Promise.resolve(this.extras);
    if (!this.extrasLoading) {
      const vault = this.vaultKey();
      const loading = Promise.all([loadReadings(vault), loadPrinted(vault)]).then(
        ([readings, printed]) => {
          const extras = { readings, printed };
          if (this.extrasLoading === loading) {
            this.extras = extras;
            this.extrasLoading = null;
          }
          return extras;
        },
      );
      this.extrasLoading = loading;
    }
    return this.extrasLoading;
  }

  /** The transcript server's transcriptions of a notebook, by page key, if it keeps any. */
  private async sidecarOf(path: string): Promise<Map<string, string> | undefined> {
    const file = [transcriptSidecarPath(path), folderNotebookSidecarPath(path)]
      .map((p) => (p ? this.app.vault.getFileByPath(p) : null))
      .find((f) => f !== null);
    if (!file) {
      this.sidecars.delete(path);
      return undefined;
    }
    const stamp = `${file.path}@${file.stat.mtime}:${file.stat.size}`;
    const kept = this.sidecars.get(path);
    if (kept?.stamp === stamp) return kept.byKey;
    try {
      const byKey = transcriptsByKey(await this.app.vault.cachedRead(file));
      this.sidecars.set(path, { stamp, byKey });
      return byKey;
    } catch {
      return undefined;
    }
  }

  /** A notebook's pages as searched, made again only when something they hold changed. */
  private bookPages(
    path: string,
    record: NotebookTextRecord,
    extras: SearchExtras,
    sidecar: Map<string, string> | undefined,
  ): PageText[] {
    const reading = (page: { id: string; hash: string }): string | undefined => {
      const kept = extras.readings.get(readingKey(path, page.id));
      return kept && kept.hash === page.hash ? kept.text : undefined;
    };
    const printed = (pdf: { path: string; page: number }): string | undefined => {
      const kept = extras.printed.get(printedKey(pdf.path, pdf.page));
      if (!kept) return undefined;
      const file = this.app.vault.getFileByPath(pdf.path);
      return file && kept.stamp === `${file.stat.mtime}:${file.stat.size}` ? kept.text : undefined;
    };
    // What this device adds, page by page: unchanged, the pages (and their folded text) are reused.
    const sign = record.pages
      .map((p) => `${reading(p)?.length ?? -1}/${p.pdf ? (printed(p.pdf)?.length ?? -1) : -1}`)
      .join(",");
    const kept = this.books.get(path);
    if (kept && kept.of === record && kept.sidecar === sidecar && kept.sign === sign)
      return kept.pages;
    const pages = assemblePages(record.pages, { sidecar, reading, printed });
    this.books.set(path, { of: record, sidecar, sign, pages });
    return pages;
  }

  /** The pages holding the query, under the titles that match it. */
  private async fillPageHits(query: string): Promise<void> {
    const el = this.hitsEl;
    if (!el || this.closed) return;
    const extras = await this.searchExtras();
    const books: LibraryBook[] = [];
    // The notebooks edited last first: among equal pages, the one in use now is nearer the top.
    const files = this.notebookFiles().sort((a, b) => b.stat.mtime - a.stat.mtime);
    for (const file of files) {
      const record = this.texts.get(file.path);
      if (!record) continue;
      const sidecar = await this.sidecarOf(file.path);
      books.push({ path: file.path, pages: this.bookPages(file.path, record, extras, sidecar) });
    }
    if (el !== this.hitsEl || query !== this.query || this.closed) return;
    this.renderPageHits(el, searchLibrary(books, query, MAX_PAGE_HITS), query);
  }

  /** The found pages, grouped by notebook in the order found; a tap opens the notebook there. */
  private renderPageHits(el: HTMLElement, hits: readonly LibraryHit[], query: string): void {
    el.empty();
    if (hits.length === 0) {
      if (el.dataset.titles === "0") this.noMatch(el);
      return;
    }
    el.createDiv({ cls: "goodobsidian-library-label", text: t("notebooks.home.pages") });
    const list = el.createDiv({ cls: "goodobsidian-library-hits" });
    const groups = new Map<string, LibraryHit[]>();
    for (const hit of hits) {
      const group = groups.get(hit.path);
      if (group) group.push(hit);
      else groups.set(hit.path, [hit]);
    }
    for (const [path, group] of groups) {
      const file = this.app.vault.getFileByPath(path);
      if (!file) continue;
      const entry = this.entryOf(file);
      const book = list.createDiv({ cls: "goodobsidian-library-hit-book" });
      book.createDiv({ cls: "goodobsidian-library-hit-title", text: entry.title });
      for (const hit of group) {
        const row = book.createEl("button", {
          cls: "goodobsidian-library-hit clickable-icon",
          attr: { type: "button" },
        });
        row.createSpan({
          cls: "goodobsidian-library-hit-page",
          text: t("view.search.page", { page: hit.pageIndex + 1 }),
        });
        const snippet = hit.snippets[0];
        if (snippet) {
          const line = row.createSpan({ cls: "goodobsidian-library-hit-text" });
          setIcon(
            line.createSpan({ cls: "goodobsidian-library-hit-kind" }),
            snippetIcon(snippet.kind),
          );
          line.appendText(snippet.before);
          line.createSpan({ cls: "suggestion-highlight", text: snippet.match });
          line.appendText(snippet.after);
        }
        row.addEventListener("click", () => this.openItem(entry, hit.pageIndex, query));
      }
    }
  }

  // --- Menus and navigation -----------------------------------------------------

  /**
   * A notebook or file in a tab of its own, or the tab it is already in, filling the
   * view: the library stays where it is, so it is always one tap back.
   */
  private openItem(entry: LibraryEntry, pageIndex?: number, search?: string): void {
    const file = this.app.vault.getFileByPath(entry.path);
    if (!file) return;
    const notebook = entry.kind === "notebook";
    let existing: WorkspaceLeaf | null = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      // A notebook only in its own view; any other file in whatever Obsidian opened it with.
      if (notebook && leaf.view.getViewType() !== VIEW_TYPE_INK) return;
      if ((leaf.view as { file?: TFile | null }).file?.path === entry.path) existing = leaf;
    });
    const leaf = existing ?? this.app.workspace.getLeaf("tab");
    unstackTabsOf(leaf);
    // A page picked in the preview or the Continue card: the notebook opens there.
    // A page Home's search found: the notebook lights the words there.
    const at =
      pageIndex !== undefined && notebook
        ? { pageIndex, ...(search ? { search } : {}) }
        : undefined;
    if (existing) {
      void this.app.workspace.revealLeaf(existing);
      if (at) leaf.setEphemeralState(at);
    } else void leaf.openFile(file, at ? { eState: at } : undefined);
  }

  /** A menu with room for a finger: every row is tall (styles.css). */
  private newMenu(): Menu {
    const menu = new Menu();
    (menu as unknown as { dom?: HTMLElement }).dom?.addClass("goodobsidian-library-menu");
    return menu;
  }

  // --- Dragging into folders ----------------------------------------------------

  /** A notebook (its own folder, when it has one) or folder lifted by a drag; dropped on a folder tile it moves in. */
  private dragging: string | null = null;

  private makeDraggable(card: HTMLElement, path: string): void {
    card.draggable = true;
    card.addEventListener("dragstart", (event) => {
      this.dragging = this.actions.unit(path);
      event.dataTransfer?.setData("text/plain", path);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      card.addClass("is-dragging");
    });
    card.addEventListener("dragend", () => {
      this.dragging = null;
      card.removeClass("is-dragging");
      this.contentEl
        .querySelectorAll(".is-drop")
        .forEach((el) => (el as HTMLElement).removeClass("is-drop"));
    });
  }

  /** Whether what is being dragged may go into `folder`. */
  private canDropInto(folder: string): boolean {
    return this.dragging !== null && LibraryActions.canMove(this.dragging, folder);
  }

  private makeDropTarget(el: HTMLElement, where: string | (() => string)): void {
    const dest = (): string => (typeof where === "function" ? where() : where);
    el.addEventListener("dragover", (event) => {
      if (!this.canDropInto(dest())) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      el.addClass("is-drop");
    });
    el.addEventListener("dragleave", () => el.removeClass("is-drop"));
    el.addEventListener("drop", (event) => {
      event.preventDefault();
      el.removeClass("is-drop");
      const folder = dest();
      const path = this.dragging;
      const allowed = this.canDropInto(folder);
      this.dragging = null;
      if (path === null || !allowed) return;
      void this.actions.move(path, folder);
    });
  }

  private openFolder(folder: string): void {
    this.folder = folder;
    this.query = "";
    const input = this.contentEl.querySelector<HTMLInputElement>(
      ".goodobsidian-library-search input",
    );
    if (input) input.value = "";
    this.paintNow(true);
    this.app.workspace.requestSaveLayout();
  }

  /** The view menu: pick several, grid or list, and what the order follows (a second tap turns it around). */
  private openSortMenu(event: MouseEvent): void {
    const menu = this.newMenu();
    menu.addItem((item) =>
      item
        .setTitle(t(this.selecting ? "notebooks.home.stopSelecting" : "notebooks.home.selectItems"))
        .setIcon("circle-check")
        .onClick(() => this.setSelecting(!this.selecting)),
    );
    menu.addSeparator();
    for (const [layout, label, icon] of [
      ["grid", t("notebooks.home.grid"), "layout-grid"],
      ["list", t("notebooks.home.list"), "list"],
    ] as const) {
      menu.addItem((item) =>
        item
          .setTitle(label)
          .setIcon(icon)
          .setChecked(this.layout === layout)
          .onClick(() => {
            this.layout = layout;
            this.paintNow(true);
            this.app.workspace.requestSaveLayout();
          }),
      );
    }
    menu.addItem((item) =>
      item
        .setTitle(t("notebooks.home.onlyNotebooks"))
        .setIcon("notebook")
        .setChecked(this.onlyNotebooks)
        .onClick(() => {
          this.onlyNotebooks = !this.onlyNotebooks;
          this.app.saveLocalStorage(ONLY_NOTEBOOKS_KEY, this.onlyNotebooks ? "1" : "0");
          this.paintNow(true);
        }),
    );
    menu.addSeparator();
    for (const option of SORTS) {
      const current = this.sort === option.by;
      menu.addItem((item) => {
        item.setTitle(t(option.label)).setChecked(current);
        if (current) item.setIcon(this.reverse ? "chevron-up" : "chevron-down");
        item.onClick(() => {
          this.reverse = current ? !this.reverse : false;
          this.sort = option.by;
          this.paintNow(true);
          this.app.workspace.requestSaveLayout();
        });
      });
    }
    this.show(menu, event);
  }

  private gridClass(): string {
    return this.layout === "list"
      ? "goodobsidian-library-grid is-list"
      : "goodobsidian-library-grid";
  }

  // --- Pull to refresh ------------------------------------------------------------

  /** Reread the vault's notebooks: a pull down from the top of the list, as in any list on an iPad. */
  private watchPull(body: HTMLElement): void {
    const THRESHOLD = 90;
    let startY = 0;
    let pull = 0;
    let tracking = false;
    const show = (amount: number): void => {
      const shown = Math.min(amount, THRESHOLD * 1.4) * 0.5;
      this.pullEl.setCssProps({ "--gob-pull": `${shown}px` });
      this.pullEl.toggleClass("is-ready", amount >= THRESHOLD);
      this.pullEl.toggleClass("is-pulling", amount > 4);
    };
    body.addEventListener(
      "touchstart",
      (event) => {
        tracking = body.scrollTop <= 0 && event.touches.length === 1;
        startY = event.touches[0]?.clientY ?? 0;
        pull = 0;
      },
      { passive: true },
    );
    body.addEventListener(
      "touchmove",
      (event) => {
        if (!tracking) return;
        const dy = (event.touches[0]?.clientY ?? 0) - startY;
        if (dy <= 0 || body.scrollTop > 0) {
          pull = 0;
          show(0);
          return;
        }
        pull = dy;
        show(pull);
      },
      { passive: true },
    );
    const end = (): void => {
      if (!tracking) return;
      tracking = false;
      const refresh = pull >= THRESHOLD;
      pull = 0;
      if (refresh) {
        this.pullEl.addClass("is-spinning");
        this.pullEl.setCssProps({ "--gob-pull": "36px" });
        this.refreshNow();
        window.setTimeout(() => {
          this.pullEl.removeClass("is-spinning", "is-pulling", "is-ready");
          show(0);
        }, 700);
      } else {
        show(0);
      }
    };
    body.addEventListener("touchend", end, { passive: true });
    body.addEventListener("touchcancel", end, { passive: true });
  }

  /** Repaint and read again whatever changed, at once. */
  private refreshNow(): void {
    window.clearTimeout(this.refreshTimer);
    this.stale = false;
    this.paintNow();
    void this.readStale();
  }

  // --- Picking several ----------------------------------------------------------

  private setSelecting(on: boolean): void {
    this.selecting = on;
    this.selected.clear();
    this.contentEl.toggleClass("is-selecting", on);
    this.syncBar();
    this.paintNow();
  }

  /** A tap in picking mode: the item is in or out; the card shows a tick. */
  private toggleSelected(card: HTMLElement, path: string): void {
    if (this.selected.has(path)) this.selected.delete(path);
    else this.selected.add(path);
    card.toggleClass("is-selected", this.selected.has(path));
    this.syncBar();
  }

  /** The bar of what can be done with the picked items; shown only while picking. */
  private syncBar(): void {
    const bar = this.barEl;
    bar.empty();
    bar.toggleClass("is-hidden", !this.selecting);
    if (!this.selecting) return;
    const count = this.selected.size;
    bar.createSpan({
      cls: "goodobsidian-library-bar-count",
      text: count === 0 ? t("notebooks.home.selectItems") : tn("notebooks.home.selected", count),
    });
    const act = (label: string, icon: string, run: () => void, danger = false): void => {
      const button = bar.createEl("button", {
        cls: `clickable-icon goodobsidian-library-bar-button${danger ? " is-danger" : ""}`,
        attr: { type: "button", "aria-label": label },
      });
      setIcon(button.createSpan(), icon);
      button.createSpan({ text: label });
      button.disabled = count === 0;
      button.addEventListener("click", run);
    };
    act(t("notebooks.home.star"), "star", () => this.starSelected());
    act(t("notebooks.home.move"), "folder-input", () => this.moveSelected());
    act(t("common.delete"), "trash-2", () => this.deleteSelected(), true);
    const done = bar.createEl("button", {
      cls: "mod-cta goodobsidian-library-bar-done",
      text: t("common.done"),
    });
    done.addEventListener("click", () => this.setSelecting(false));
  }

  private starSelected(): void {
    let stars = [...this.host.stars()];
    const all = [...this.selected].every((p) => stars.includes(p));
    for (const path of this.selected) {
      stars = all
        ? stars.filter((x) => x !== path)
        : stars.includes(path)
          ? stars
          : [...stars, path];
    }
    this.host.setStars(stars);
    this.setSelecting(false);
  }

  private moveSelected(): void {
    new FolderSuggestModal(
      this.app,
      (dest) => {
        const dir = dest === "/" ? "" : dest;
        const paths = [...this.selected];
        this.setSelecting(false);
        void (async () => {
          for (const path of paths) await this.actions.move(path, dir);
        })();
      },
      tn("notebooks.home.moveItems", this.selected.size),
      this.folder,
    ).open();
  }

  /** One question naming what goes, then the picked notebooks (and folders, all but the user's other files) go. */
  private deleteSelected(): void {
    const picked = [...this.selected].map((path) => ({
      path,
      folder: this.app.vault.getAbstractFileByPath(path) instanceof TFolder,
    }));
    void this.actions.trash(picked).then((gone) => {
      if (gone) this.setSelecting(false);
    });
  }

  /** What the New button offers: a notebook, a board, a PDF's pages as a notebook, a folder. */
  private openNewMenu(event: MouseEvent): void {
    const menu = this.newMenu();
    menu.addItem((item) =>
      item
        .setTitle(t("notebooks.menu.newNotebook"))
        .setIcon("notebook-pen")
        .onClick(() => this.host.newNotebook(this.folder)),
    );
    menu.addItem((item) =>
      item
        .setTitle(t("notebooks.newNotebook.board"))
        .setIcon("infinity")
        .onClick(() => this.host.newBoard(this.folder)),
    );
    menu.addItem((item) =>
      item
        .setTitle(t("notebooks.command.importPdf"))
        .setIcon("file-up")
        .onClick(() => this.choosePdf(event)),
    );
    menu.addItem((item) =>
      item
        .setTitle(t("notebooks.home.addImage"))
        .setIcon("image-plus")
        .onClick(() => {
          void pickImageFile(this.contentEl, false).then((file) => {
            if (file) this.host.importImage(file, this.folder);
          });
        }),
    );
    menu.addItem((item) =>
      item
        .setTitle(t("notebooks.newNotebook.importApp"))
        .setIcon(ICON_IMPORT_NOTEBOOK)
        .onClick(() => this.host.importFromApp(this.folder)),
    );
    menu.addItem((item) =>
      item
        .setTitle(t("notebooks.home.newFolder"))
        .setIcon("folder-plus")
        .onClick(() => this.newFolder()),
    );
    this.show(menu, event);
  }

  /** A PDF from the device or from the vault. */
  private choosePdf(event: MouseEvent): void {
    const menu = this.newMenu();
    menu.addItem((item) =>
      item
        .setTitle(t("notebooks.newNotebook.fromFiles"))
        .setIcon("file-text")
        .onClick(() => {
          void pickImageFile(this.contentEl, false, "application/pdf,.pdf").then((file) => {
            if (file) this.host.importPdf({ kind: "file", file }, this.folder);
          });
        }),
    );
    menu.addItem((item) =>
      item
        .setTitle(t("notebooks.newNotebook.fromVault"))
        .setIcon("folder-open")
        .onClick(() => {
          new VaultPdfSuggestModal(this.app, (file) =>
            this.host.importPdf({ kind: "vault", file }, this.folder),
          ).open();
        }),
    );
    this.show(menu, event);
  }

  /** A new, empty folder here; it shows as a tile until something is put in it. */
  private newFolder(): void {
    new RenameModal(
      this.app,
      t("notebooks.home.newFolder"),
      (typed) => {
        const name = cleanName(typed);
        if (name === "") return;
        const path = this.folder === "" ? name : `${this.folder}/${name}`;
        if (this.app.vault.getAbstractFileByPath(path)) {
          new Notice(t("notebooks.home.existsHere", { name }));
          return;
        }
        void this.app.vault.createFolder(path).then(() => {
          // Its look is its record here: a folder with one shows while it is empty.
          this.host.setFolderStyles(
            withFolderStyle(this.host.folderStyles(), path, {
              color: DEFAULT_FOLDER_COLOR,
              icon: DEFAULT_FOLDER_ICON,
            }),
          );
          this.refreshSoon();
        });
      },
      t("notebooks.home.newFolder"),
      t("notebooks.newNotebook.create"),
    ).open();
  }

  /** Where a menu opened by a tap on a button sits: under it. */
  private show(menu: Menu, event: MouseEvent | KeyboardEvent): void {
    const target = event.currentTarget;
    if (event.detail === 0 && target instanceof HTMLElement) {
      const rect = target.getBoundingClientRect();
      menu.showAtPosition({ x: rect.left, y: rect.bottom });
    } else if (event instanceof MouseEvent) {
      menu.showAtMouseEvent(event);
    }
  }

  private openCardMenu(event: MouseEvent | KeyboardEvent, entry: LibraryEntry): void {
    const file = this.app.vault.getFileByPath(entry.path);
    if (!file) return;
    const menu = this.newMenu();
    menu.addItem((item) =>
      item
        .setTitle(t("common.rename"))
        .setIcon("pencil")
        .onClick(() =>
          this.rename(file, entry.title, inkFileSuffix(file.name) ?? `.${file.extension}`),
        ),
    );
    // A copy and a PDF export are a notebook's; any other file has Obsidian's own.
    if (entry.kind === "notebook") {
      menu.addItem((item) =>
        item
          .setTitle(t("common.duplicate"))
          .setIcon("copy-plus")
          .onClick(() => void this.actions.duplicate(file.path)),
      );
      menu.addItem((item) =>
        item
          .setTitle(t("notebooks.home.exportPdf"))
          .setIcon("file-up")
          .onClick(() => void this.host.exportPdf(file)),
      );
    }
    menu.addItem((item) =>
      item
        .setTitle(t("notebooks.home.move"))
        .setIcon("folder-input")
        .onClick(() => this.move(file)),
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(t("notebooks.home.openInTab"))
        .setIcon("file-plus")
        .onClick(() => void this.app.workspace.getLeaf("tab").openFile(file)),
    );
    menu.addItem((item) =>
      item
        .setTitle(t("common.delete"))
        .setIcon("trash-2")
        .onClick(() => {
          void this.actions.trash([{ path: file.path, folder: false }]).then((gone) => {
            if (gone) this.refreshSoon();
          });
        }),
    );
    this.show(menu, event);
  }

  private openFolderMenu(event: MouseEvent | KeyboardEvent, folder: FolderTile): void {
    const target = this.app.vault.getFolderByPath(folder.path);
    if (!target) return;
    const menu = this.newMenu();
    menu.addItem((item) =>
      item
        .setTitle(t("notebooks.home.customizeColor"))
        .setIcon("palette")
        .onClick(() => this.chooseColor(event, folder.path)),
    );
    menu.addItem((item) =>
      item
        .setTitle(t("notebooks.home.setIcon"))
        .setIcon("smile")
        .onClick(() => this.chooseIcon(event, folder.path)),
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(t("common.rename"))
        .setIcon("pencil")
        .onClick(() => this.rename(target, folder.name, "")),
    );
    menu.addItem((item) =>
      item
        .setTitle(t("notebooks.home.move"))
        .setIcon("folder-input")
        .onClick(() => this.move(target)),
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(t("common.delete"))
        .setIcon("trash-2")
        .onClick(() => {
          // Its notebooks go; the folder too only when nothing of the user's is left in it.
          void this.actions.trash([{ path: target.path, folder: true }]).then((gone) => {
            if (gone) this.refreshSoon();
          });
        }),
    );
    this.show(menu, event);
  }

  /** The colours as a menu of their own, the current one ticked. */
  private chooseColor(event: MouseEvent | KeyboardEvent, path: string): void {
    const now = this.host.folderStyles()[path]?.color ?? DEFAULT_FOLDER_COLOR;
    const menu = this.newMenu();
    for (const option of FOLDER_COLORS) {
      menu.addItem((item) => {
        item
          .setTitle(t(option.name))
          .setChecked(option.color === now)
          .onClick(() => this.styleFolder(path, { color: option.color }));
        const swatch = createSpan({ cls: "goodobsidian-library-swatch" });
        swatch.style.background = option.color;
        (item as unknown as { dom: HTMLElement }).dom.prepend(swatch);
      });
    }
    this.show(menu, event);
  }

  private chooseIcon(event: MouseEvent | KeyboardEvent, path: string): void {
    const now = this.host.folderStyles()[path]?.icon ?? DEFAULT_FOLDER_ICON;
    const menu = this.newMenu();
    for (const option of FOLDER_ICONS) {
      menu.addItem((item) =>
        item
          .setTitle(t(option.name))
          .setIcon(option.id)
          .setChecked(option.id === now)
          .onClick(() => this.styleFolder(path, { icon: option.id })),
      );
    }
    this.show(menu, event);
  }

  private styleFolder(path: string, change: { color?: string; icon?: string }): void {
    this.host.setFolderStyles(withFolderStyle(this.host.folderStyles(), path, change));
    this.paintNow();
  }

  // --- Changing files ---------------------------------------------------------

  private rename(file: TFile | TFolder, current: string, suffix: string): void {
    new RenameModal(this.app, current, (typed) => {
      const name = cleanName(typed);
      if (name === "" || name === current) return;
      const parent = file.parent?.path ?? "";
      const path = [parent === "/" ? "" : parent, `${name}${suffix}`].filter(Boolean).join("/");
      if (this.app.vault.getAbstractFileByPath(path)) {
        new Notice(t("notebooks.home.existsHere", { name }));
        return;
      }
      void this.app.fileManager.renameFile(file, path);
    }).open();
  }

  /**
   * Pick a folder, and put the notebook (with its own folder) or folder
   * inside it. The picker starts at the folder it really is in, which for a
   * notebook filed above its folder (`hoistSingles`) is not the one it shows in.
   */
  private move(file: TFile | TFolder): void {
    new FolderSuggestModal(
      this.app,
      (dest) => void this.actions.move(file.path, dest === "/" ? "" : dest),
      t("notebooks.home.moveItem", { name: file.name }),
      folderOf(this.actions.unit(file.path)),
    ).open();
  }
}
