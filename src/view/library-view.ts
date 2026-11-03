/**
 * The notebook library: every notebook in the vault as a cover, in the
 * vault's own folders, newest first. A grid of covers with a "Continue"
 * strip of the ones edited last, the vault's folders above them, and a
 * search field and a sort menu at the top.
 *
 *   .goodobsidian-library
 *     .goodobsidian-library-head   (← up · title · search · sort · New notebook)
 *     .goodobsidian-library-body
 *       .goodobsidian-library-label + .goodobsidian-library-recent   (root, not searching)
 *       .goodobsidian-library-label + .goodobsidian-library-folders
 *       .goodobsidian-library-label + .goodobsidian-library-grid
 *         .goodobsidian-library-card   (.goodobsidian-library-cover + caption)
 *
 * What a card shows comes from the notebook's file (model/library.ts). Files
 * are read one at a time, newest first, with a yield between each so a big
 * vault never holds the main thread, and a read is kept until the file's
 * size or time changes. Until a notebook is read it shows its name on a grey
 * cover.
 */

import {
  ItemView,
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
  NOTEBOOK_FILE_SUFFIX,
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
  freeName,
  moveStyles,
  movePaths,
  withFolderStyle,
} from "../model/library-style";
import { PdfBackdropCache } from "./pdf-backdrop";
import { acquirePdfWorker, releasePdfWorker } from "./pdf-worker";
import { thumbnailRasterScale } from "./page-sidebar";
import { FolderSuggestModal } from "./folder-suggest";
import { RenameModal } from "./rename-modal";
import { pickImageFile } from "./image-import";
import { VaultPdfSuggestModal } from "./pdf-import-modal";
import { INBOX_FOLDER } from "../model/inbox";
import { isStarred, starredFirst, toggleStar } from "../model/favorites";
import { LAST_PAGES_KEY, type LastPages, parseLastPages } from "../model/last-page";
import {
  type LibraryEntry,
  type LibraryPdf,
  type LibrarySort,
  browse,
  continueEntries,
  crumbs,
  hoistSingles,
  entryFromText,
  folderOf,
  readProgress,
  placeholderEntry,
  searchEntries,
  sortEntries,
  whenText,
} from "../model/library";

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
}

/** A folder as the library lists it. */
interface FolderTile {
  path: string;
  name: string;
  count: number;
}

const SORTS: ReadonlyArray<{ by: LibrarySort; label: string }> = [
  { by: "created", label: "Date created" },
  { by: "edited", label: "Last edited" },
  { by: "name", label: "Name" },
  { by: "pages", label: "Pages" },
];

/** How many notebooks the Continue strip shows. */
const CONTINUE_COUNT = 3;

interface Read {
  mtime: number;
  size: number;
  entry: LibraryEntry;
}

export class LibraryView extends ItemView {
  override icon = "house";
  private folder = "";
  private sort: LibrarySort = "edited";
  /** The sort turned around: oldest first, Z to A, fewest pages first. */
  private reverse = false;
  private layout: "grid" | "list" = "grid";
  /** Picking notebooks and folders for a Move, Star or Delete of several at once. */
  private selecting = false;
  private readonly selected = new Set<string>();
  private barEl!: HTMLElement;
  private pullEl!: HTMLElement;
  private query = "";
  private readonly reads = new Map<string, Read>();
  private reading = false;
  private closed = false;
  private paintTimer = 0;
  private pdf: PdfBackdropCache | null = null;
  private workerHeld = false;
  private refreshTimer = 0;
  private upEl!: HTMLElement;
  private titleEl!: HTMLElement;
  private bodyEl!: HTMLElement;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly host: LibraryHost,
  ) {
    super(leaf);
    this.navigation = true;
  }

  getViewType(): string {
    return VIEW_TYPE_LIBRARY;
  }

  getDisplayText(): string {
    return "Home";
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
    this.paintNow();
    await super.setState(state, result);
  }

  override async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("goodobsidian-library");

    const head = root.createDiv({ cls: "goodobsidian-library-head" });
    this.upEl = head.createEl("button", {
      cls: "clickable-icon goodobsidian-library-up",
      attr: { "aria-label": "Up one folder" },
    });
    setIcon(this.upEl, "arrow-left");
    this.makeDropTarget(this.upEl, () => this.folder.split("/").slice(0, -1).join("/"));
    this.upEl.addEventListener("click", () =>
      this.openFolder(this.folder.split("/").slice(0, -1).join("/")),
    );
    this.titleEl = head.createEl("h4", { cls: "goodobsidian-library-title" });

    const search = head.createDiv({ cls: "goodobsidian-library-search" });
    setIcon(search.createSpan(), "search");
    const input = search.createEl("input", {
      attr: { type: "search", placeholder: "Search", "aria-label": "Search notebooks" },
    });
    input.addEventListener("input", () => {
      this.query = input.value;
      this.paintNow();
    });

    const sort = head.createEl("button", {
      cls: "clickable-icon",
      attr: { "aria-label": "Sort" },
    });
    setIcon(sort, "arrow-up-down");
    sort.addEventListener("click", (event) => this.openSortMenu(event));

    const add = head.createEl("button", {
      cls: "goodobsidian-library-new",
      attr: { type: "button", "aria-haspopup": "menu" },
    });
    setIcon(add.createSpan({ cls: "goodobsidian-library-new-icon" }), "plus");
    add.createSpan({ text: "New" });
    add.addEventListener("click", (event) => this.openNewMenu(event));

    const gear = head.createEl("button", {
      cls: "clickable-icon",
      attr: { "aria-label": "FineNotes settings" },
    });
    setIcon(gear, "settings");
    gear.addEventListener("click", () => this.host.openSettings());

    this.bodyEl = root.createDiv({ cls: "goodobsidian-library-body" });
    this.pullEl = root.createDiv({ cls: "goodobsidian-library-pull" });
    setIcon(this.pullEl, "refresh-cw");
    root.insertBefore(this.pullEl, this.bodyEl);
    this.watchPull(this.bodyEl);
    this.barEl = root.createDiv({ cls: "goodobsidian-library-bar is-hidden" });

    const touched = (file: TAbstractFile): void => {
      if (file instanceof TFile && file.name.toLowerCase().endsWith(NOTEBOOK_FILE_SUFFIX))
        this.refreshSoon();
      else if (!(file instanceof TFile)) this.refreshSoon();
    };
    this.registerEvent(this.app.vault.on("create", touched));
    this.registerEvent(this.app.vault.on("delete", touched));
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        this.follow(oldPath, file.path);
        touched(file);
      }),
    );
    this.registerEvent(this.app.vault.on("modify", touched));

    // A notebook read since: its place has moved.
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf === this.leaf) this.paintNow();
      }),
    );

    this.paintNow();
    void this.readStale();
  }

  override async onClose(): Promise<void> {
    this.closed = true;
    this.pdf?.destroy();
    this.pdf = null;
    if (this.workerHeld) releasePdfWorker();
    this.workerHeld = false;
    window.clearTimeout(this.paintTimer);
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

  private notebookFiles(): TFile[] {
    return this.app.vault
      .getFiles()
      .filter(
        (f) =>
          f.extension === "md" &&
          f.name.toLowerCase().endsWith(NOTEBOOK_FILE_SUFFIX) &&
          !f.path.startsWith(`${INBOX_FOLDER}/`),
      );
  }

  private entries(): LibraryEntry[] {
    return this.notebookFiles().map((file) => {
      const read = this.reads.get(file.path);
      const fresh = read && read.mtime === file.stat.mtime && read.size === file.stat.size;
      const entry = fresh
        ? read.entry
        : (read?.entry ?? placeholderEntry(file.path, file.stat.mtime));
      return { ...entry, created: file.stat.ctime };
    });
  }

  /** A change in the vault: repaint at once, read what changed a moment later. */
  private refreshSoon(): void {
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.paintNow();
      void this.readStale();
    }, 400);
  }

  /** Read every notebook whose file changed since it was last read, newest first, one at a time. */
  private async readStale(): Promise<void> {
    if (this.reading) return;
    this.reading = true;
    try {
      const live = new Set<string>();
      const stale: TFile[] = [];
      for (const file of this.notebookFiles()) {
        live.add(file.path);
        const read = this.reads.get(file.path);
        if (!read || read.mtime !== file.stat.mtime || read.size !== file.stat.size)
          stale.push(file);
      }
      for (const path of [...this.reads.keys()]) if (!live.has(path)) this.reads.delete(path);
      stale.sort((a, b) => b.stat.mtime - a.stat.mtime);
      for (const file of stale) {
        if (this.closed) return;
        const { mtime, size } = file.stat;
        let entry: LibraryEntry;
        try {
          entry = entryFromText(file.path, mtime, await this.app.vault.cachedRead(file));
        } catch {
          entry = placeholderEntry(file.path, mtime);
        }
        this.reads.set(file.path, { mtime, size, entry });
        this.paintSoon();
        // Let the app breathe between notebooks.
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
    } finally {
      this.reading = false;
    }
  }

  // --- Painting ---------------------------------------------------------------

  private paintSoon(): void {
    if (this.paintTimer) return;
    this.paintTimer = window.setTimeout(() => {
      this.paintTimer = 0;
      this.paintNow();
    }, 150);
  }

  private paintNow(): void {
    if (!this.bodyEl) return;
    const searching = this.query.trim() !== "";
    this.titleEl.setText(
      this.folder === ""
        ? "Notebooks"
        : crumbs(this.folder)
            .map((c) => c.name)
            .join(" / "),
    );
    this.upEl.toggleClass("is-hidden", this.folder === "");
    this.bodyEl.empty();

    const all = this.entries();
    if (all.length === 0) {
      const empty = this.bodyEl.createDiv({ cls: "goodobsidian-library-empty" });
      empty.createDiv({ text: "No notebooks yet." });
      const button = empty.createEl("button", { text: "New notebook", cls: "mod-cta" });
      button.addEventListener("click", () => this.host.newNotebook(this.folder));
      return;
    }

    if (searching) {
      const found = sortEntries(searchEntries(all, this.query), this.sort, this.reverse);
      this.grid(found, found.length === 0 ? "No notebook matches." : "Results");
      return;
    }

    const left = this.lastPages();
    const stars = this.host.stars();
    const here = browse(hoistSingles(all), this.folder);
    if (this.folder === "" && stars.length > 0) {
      const books = all.filter((e) => isStarred(stars, e.path));
      const folders = stars
        .filter((path) => !path.toLowerCase().endsWith(NOTEBOOK_FILE_SUFFIX))
        .map((path) => this.folderTile(all, path))
        .filter((f): f is FolderTile => f !== null);
      if (books.length + folders.length > 0) {
        this.label("Favorites");
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
        all.filter((e) => e.pages > 0),
        CONTINUE_COUNT,
        (path) => left[path]?.at ?? 0,
      );
      if (recent.length > 0) {
        this.label("Continue");
        const row = this.bodyEl.createDiv({ cls: "goodobsidian-library-recent" });
        for (const entry of recent) {
          this.card(row, entry, left[entry.path]?.index);
        }
      }
    }
    const folders = [...here.folders, ...this.emptyFolders(here.folders)];
    if (folders.length > 0) {
      this.label("Folders");
      const row = this.bodyEl.createDiv({ cls: this.gridClass() });
      for (const folder of starredFirst(folders, stars, (f) => f.path))
        this.folderCard(row, folder);
    }
    // At the top, every notebook in the vault, under the folders; inside a folder, its own.
    const atTop = this.folder === "";
    const rest = atTop ? all : here.notebooks;
    if (rest.length > 0) {
      this.grid(
        sortEntries(rest, this.sort, this.reverse),
        atTop ? "All notebooks" : (SORTS.find((s) => s.by === this.sort)?.label ?? ""),
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
      .map((c) => ({ path: c.path, name: c.name, count: 0 }));
  }

  private label(text: string): void {
    this.bodyEl.createDiv({ cls: "goodobsidian-library-label", text });
  }

  private grid(entries: LibraryEntry[], label: string): void {
    this.label(label);
    const grid = this.bodyEl.createDiv({ cls: this.gridClass() });
    for (const entry of starredFirst(entries, this.host.stars(), (e) => e.path)) {
      this.card(grid, entry);
    }
  }

  /** A starred folder as a tile: how many notebooks it holds, or null when it holds none now. */
  private folderTile(all: LibraryEntry[], path: string): FolderTile | null {
    const count = all.filter((e) => e.folder === path || e.folder.startsWith(`${path}/`)).length;
    if (count === 0) return null;
    return { path, name: path.split("/").pop() ?? path, count };
  }

  /** The star in a cover's top right corner: on for a starred item, a tap toggles it. */
  private starButton(cover: HTMLElement, path: string, title: string): void {
    const on = isStarred(this.host.stars(), path);
    const star = cover.createEl("button", {
      cls: "clickable-icon goodobsidian-library-star",
      attr: {
        type: "button",
        "aria-label": on ? `Remove ${title} from favorites` : `Add ${title} to favorites`,
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
          ? "Empty"
          : `${folder.count} ${folder.count === 1 ? "notebook" : "notebooks"}`,
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
      attr: { type: "button", "aria-label": `Options for ${name}`, "aria-haspopup": "menu" },
    });
    setIcon(caret, "chevron-down");
    caret.addEventListener("click", (event) => {
      event.stopPropagation();
      menu(event);
    });
    caret.addEventListener("keydown", (event) => event.stopPropagation());
  }

  /** The notebook's first PDF page as its cover, drawn once the page is rendered; the title shows until then. */
  private paintPdfCover(cover: HTMLElement, pdf: LibraryPdf): void {
    cover.addClass("is-pdf");
    const canvas = cover.createEl("canvas", { cls: "goodobsidian-library-pdf" });
    const dpr = window.devicePixelRatio || 1;
    const cache = this.pdfCache();
    void cache
      .resolve(
        pdf.path,
        pdf.page,
        thumbnailRasterScale(dpr),
        {
          geometry: { width: pdf.width, height: pdf.height },
        },
        true,
      )
      .then((entry) => {
        if (!entry.ok || !canvas.isConnected) return;
        const w = 240;
        const h = Math.max(1, Math.round((w * pdf.height) / pdf.width));
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(entry.canvas, 0, 0, canvas.width, canvas.height);
        cover.addClass("is-ready");
      });
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

  /** A cover with its caption. With `leftAt` (the index it was left on) it shows where the reader is. */
  private card(parent: HTMLElement, entry: LibraryEntry, leftAt?: number): void {
    const card = parent.createDiv({
      cls: "goodobsidian-library-card",
      attr: { role: "button", tabindex: "0", "aria-label": entry.title },
    });
    const cover = card.createDiv({ cls: "goodobsidian-library-cover" });
    const palette = coverPalette(entry.color);
    cover.style.setProperty("--gob-cover", palette.base);
    cover.style.setProperty("--gob-cover-ink", palette.title);
    cover.style.setProperty("--gob-cover-spine", palette.spine);
    cover.style.setProperty("--gob-cover-hi", palette.sheenLight);
    cover.style.setProperty("--gob-cover-lo", palette.sheenDark);
    cover.createSpan({ cls: "goodobsidian-library-cover-title", text: entry.title });
    if (entry.pdf) this.paintPdfCover(cover, entry.pdf);
    this.starButton(cover, entry.path, entry.title);
    const caption = card.createDiv({ cls: "goodobsidian-library-caption" });
    this.nameRow(caption, entry.title, (event) => this.openCardMenu(event, entry));
    const when = whenText(entry.edited, Date.now());
    const progress = readProgress(entry, leftAt);
    if (progress) {
      caption.createDiv({
        cls: "goodobsidian-library-when",
        text: `Page ${progress.page} of ${progress.of} · ${when}`,
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
          entry.pages > 0 ? `${entry.pages} ${entry.pages === 1 ? "page" : "pages"}` : "",
          when,
        ]
          .filter(Boolean)
          .join(" · "),
      });
    }

    card.toggleClass("is-selected", this.selected.has(entry.path));
    const open = (): void =>
      this.selecting ? this.toggleSelected(card, entry.path) : this.openNotebook(entry.path);
    card.addEventListener("click", open);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
    this.makeDraggable(card, entry.path);
    card.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.openCardMenu(event, entry);
    });
  }

  // --- Menus and navigation -----------------------------------------------------

  /**
   * A notebook in a tab of its own, or the tab it is already in: the library
   * stays where it is, so it is always one tap back.
   */
  private openNotebook(path: string): void {
    const file = this.app.vault.getFileByPath(path);
    if (!file) return;
    let existing: WorkspaceLeaf | null = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view.getViewType() !== VIEW_TYPE_INK) return;
      if ((leaf.view as { file?: TFile | null }).file?.path === path) existing = leaf;
    });
    if (existing) void this.app.workspace.revealLeaf(existing);
    else void this.app.workspace.getLeaf("tab").openFile(file);
  }

  /** A menu with room for a finger: every row is tall (styles.css). */
  private newMenu(): Menu {
    const menu = new Menu();
    (menu as unknown as { dom?: HTMLElement }).dom?.addClass("goodobsidian-library-menu");
    return menu;
  }

  // --- Dragging into folders ----------------------------------------------------

  /** A notebook or folder lifted by a drag; dropped on a folder tile it moves in. */
  private dragging: string | null = null;

  private makeDraggable(card: HTMLElement, path: string): void {
    card.draggable = true;
    card.addEventListener("dragstart", (event) => {
      this.dragging = path;
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
    const path = this.dragging;
    if (path === null) return false;
    if (folderOf(path) === folder) return false;
    return folder !== path && !folder.startsWith(`${path}/`);
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
      const item = this.app.vault.getAbstractFileByPath(path);
      if (!item) return;
      const target = folder === "" ? item.name : `${folder}/${item.name}`;
      if (this.app.vault.getAbstractFileByPath(target)) {
        new Notice(`"${item.name}" already exists there.`);
        return;
      }
      void this.app.fileManager.renameFile(item, target);
    });
  }

  private openFolder(folder: string): void {
    this.folder = folder;
    this.query = "";
    const input = this.contentEl.querySelector<HTMLInputElement>(
      ".goodobsidian-library-search input",
    );
    if (input) input.value = "";
    this.paintNow();
    this.app.workspace.requestSaveLayout();
  }

  /** The view menu: pick several, grid or list, and what the order follows (a second tap turns it around). */
  private openSortMenu(event: MouseEvent): void {
    const menu = this.newMenu();
    menu.addItem((item) =>
      item
        .setTitle(this.selecting ? "Stop selecting" : "Select items")
        .setIcon("circle-check")
        .onClick(() => this.setSelecting(!this.selecting)),
    );
    menu.addSeparator();
    for (const [layout, label, icon] of [
      ["grid", "Grid", "layout-grid"],
      ["list", "List", "list"],
    ] as const) {
      menu.addItem((item) =>
        item
          .setTitle(label)
          .setIcon(icon)
          .setChecked(this.layout === layout)
          .onClick(() => {
            this.layout = layout;
            this.paintNow();
            this.app.workspace.requestSaveLayout();
          }),
      );
    }
    menu.addSeparator();
    for (const option of SORTS) {
      const current = this.sort === option.by;
      menu.addItem((item) => {
        item.setTitle(option.label).setChecked(current);
        if (current) item.setIcon(this.reverse ? "chevron-up" : "chevron-down");
        item.onClick(() => {
          this.reverse = current ? !this.reverse : false;
          this.sort = option.by;
          this.paintNow();
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
      text: count === 0 ? "Select items" : `${count} selected`,
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
    act("Star", "star", () => this.starSelected());
    act("Move", "folder-input", () => this.moveSelected());
    act("Delete", "trash-2", () => this.deleteSelected(), true);
    const done = bar.createEl("button", {
      cls: "mod-cta goodobsidian-library-bar-done",
      text: "Done",
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
        for (const path of [...this.selected]) {
          const item = this.app.vault.getAbstractFileByPath(path);
          if (!item || folderOf(path) === dir) continue;
          if (item instanceof TFolder && (dir === item.path || dir.startsWith(`${item.path}/`)))
            continue;
          const target = dir ? `${dir}/${item.name}` : item.name;
          if (this.app.vault.getAbstractFileByPath(target)) continue;
          void this.app.fileManager.renameFile(item, target);
        }
        this.setSelecting(false);
      },
      `Move ${this.selected.size} items to…`,
      this.folder,
    ).open();
  }

  private deleteSelected(): void {
    const paths = [...this.selected];
    void (async () => {
      for (const path of paths) {
        const item = this.app.vault.getAbstractFileByPath(path);
        if (item) await this.app.fileManager.promptForDeletion(item);
      }
      this.setSelecting(false);
    })();
  }

  /** What the New button offers: a notebook, a board, a PDF's pages as a notebook, a folder. */
  private openNewMenu(event: MouseEvent): void {
    const menu = this.newMenu();
    menu.addItem((item) =>
      item
        .setTitle("New notebook")
        .setIcon("notebook-pen")
        .onClick(() => this.host.newNotebook(this.folder)),
    );
    menu.addItem((item) =>
      item
        .setTitle("New board")
        .setIcon("infinity")
        .onClick(() => this.host.newBoard(this.folder)),
    );
    menu.addItem((item) =>
      item
        .setTitle("Import PDF…")
        .setIcon("file-up")
        .onClick(() => this.choosePdf(event)),
    );
    menu.addItem((item) =>
      item
        .setTitle("Add image…")
        .setIcon("image-plus")
        .onClick(() => {
          void pickImageFile(this.contentEl, false).then((file) => {
            if (file) this.host.importImage(file, this.folder);
          });
        }),
    );
    menu.addItem((item) =>
      item
        .setTitle("Import from another app…")
        .setIcon(ICON_IMPORT_NOTEBOOK)
        .onClick(() => this.host.importFromApp(this.folder)),
    );
    menu.addItem((item) =>
      item
        .setTitle("New folder")
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
        .setTitle("From files")
        .setIcon("file-text")
        .onClick(() => {
          void pickImageFile(this.contentEl, false, "application/pdf,.pdf").then((file) => {
            if (file) this.host.importPdf({ kind: "file", file }, this.folder);
          });
        }),
    );
    menu.addItem((item) =>
      item
        .setTitle("From vault")
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
      "New folder",
      (typed) => {
        const name = cleanName(typed);
        if (name === "") return;
        const path = this.folder === "" ? name : `${this.folder}/${name}`;
        if (this.app.vault.getAbstractFileByPath(path)) {
          new Notice(`"${name}" already exists here.`);
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
      "New folder",
      "Create",
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
        .setTitle("Rename")
        .setIcon("pencil")
        .onClick(() => this.rename(file, entry.title, NOTEBOOK_FILE_SUFFIX)),
    );
    menu.addItem((item) =>
      item
        .setTitle("Duplicate")
        .setIcon("copy-plus")
        .onClick(() => void this.duplicate(file, entry.title)),
    );
    menu.addItem((item) =>
      item
        .setTitle("Export as PDF")
        .setIcon("file-up")
        .onClick(() => void this.host.exportPdf(file)),
    );
    menu.addItem((item) =>
      item
        .setTitle("Move")
        .setIcon("folder-input")
        .onClick(() => this.move(file, entry.folder)),
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle("Open in new tab")
        .setIcon("file-plus")
        .onClick(() => void this.app.workspace.getLeaf("tab").openFile(file)),
    );
    menu.addItem((item) =>
      item
        .setTitle("Delete")
        .setIcon("trash-2")
        .onClick(() => {
          void this.app.fileManager.promptForDeletion(file).then((gone) => {
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
        .setTitle("Customize color…")
        .setIcon("palette")
        .onClick(() => this.chooseColor(event, folder.path)),
    );
    menu.addItem((item) =>
      item
        .setTitle("Set icon…")
        .setIcon("smile")
        .onClick(() => this.chooseIcon(event, folder.path)),
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle("Rename")
        .setIcon("pencil")
        .onClick(() => this.rename(target, folder.name, "")),
    );
    menu.addItem((item) =>
      item
        .setTitle("Move")
        .setIcon("folder-input")
        .onClick(() => this.move(target, folderOf(folder.path))),
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle("Delete")
        .setIcon("trash-2")
        .onClick(() => {
          void this.app.fileManager.promptForDeletion(target).then((gone) => {
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
          .setTitle(option.name)
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
          .setTitle(option.name)
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
        new Notice(`"${name}" already exists here.`);
        return;
      }
      void this.app.fileManager.renameFile(file, path);
    }).open();
  }

  private async duplicate(file: TFile, title: string): Promise<void> {
    const parent = file.parent?.path ?? "";
    const dir = parent === "/" ? "" : parent;
    const name = freeName(
      `${title} copy`,
      NOTEBOOK_FILE_SUFFIX,
      (n) => this.app.vault.getAbstractFileByPath(dir ? `${dir}/${n}` : n) !== null,
    );
    await this.app.vault.copy(file, dir ? `${dir}/${name}` : name);
  }

  /** Pick a folder, and put the file or folder inside it. */
  private move(file: TFile | TFolder, from: string): void {
    new FolderSuggestModal(
      this.app,
      (dest) => {
        const dir = dest === "/" ? "" : dest;
        if (dir === from) return;
        if (file instanceof TFolder && (dir === file.path || dir.startsWith(`${file.path}/`))) {
          new Notice("A folder cannot go inside itself.");
          return;
        }
        const path = dir ? `${dir}/${file.name}` : file.name;
        if (this.app.vault.getAbstractFileByPath(path)) {
          new Notice(`"${file.name}" already exists there.`);
          return;
        }
        void this.app.fileManager.renameFile(file, path);
      },
      `Move ${file.name} to…`,
      from,
    ).open();
  }

  /** Stars and folder looks go with a file or folder that was renamed or moved. */
  private follow(from: string, to: string): void {
    const stars = this.host.stars();
    const moved = movePaths(stars, from, to);
    if (moved.some((p, i) => p !== stars[i])) this.host.setStars(moved);
    const styles = this.host.folderStyles();
    const restyled = moveStyles(styles, from, to);
    if (JSON.stringify(restyled) !== JSON.stringify(styles)) this.host.setFolderStyles(restyled);
  }
}
