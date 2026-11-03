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
  Keymap,
  Menu,
  Notice,
  type TAbstractFile,
  TFile,
  TFolder,
  type ViewStateResult,
  type WorkspaceLeaf,
  setIcon,
} from "obsidian";
import { ICON_LIBRARY, NOTEBOOK_FILE_SUFFIX, VIEW_TYPE_LIBRARY } from "../constants";
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
  newNotebook(): void;
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

const SORTS: ReadonlyArray<{ by: LibrarySort; label: string; icon: string }> = [
  { by: "edited", label: "Last edited", icon: "clock" },
  { by: "name", label: "Name", icon: "arrow-down-a-z" },
  { by: "pages", label: "Pages", icon: "files" },
];

/** How many notebooks the Continue strip shows. */
const CONTINUE_COUNT = 3;

interface Read {
  mtime: number;
  size: number;
  entry: LibraryEntry;
}

export class LibraryView extends ItemView {
  override icon = ICON_LIBRARY;
  private folder = "";
  private sort: LibrarySort = "edited";
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
    return this.folder === "" ? "Notebooks" : (this.folder.split("/").pop() ?? "Notebooks");
  }

  override getState(): Record<string, unknown> {
    return { folder: this.folder, sort: this.sort };
  }

  override async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const saved = (state ?? {}) as { folder?: unknown; sort?: unknown };
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
      cls: "clickable-icon",
      attr: { "aria-label": "New notebook" },
    });
    setIcon(add, "plus");
    add.addEventListener("click", () => this.host.newNotebook());

    this.bodyEl = root.createDiv({ cls: "goodobsidian-library-body" });

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
      .filter((f) => f.extension === "md" && f.name.toLowerCase().endsWith(NOTEBOOK_FILE_SUFFIX));
  }

  private entries(): LibraryEntry[] {
    return this.notebookFiles().map((file) => {
      const read = this.reads.get(file.path);
      const fresh = read && read.mtime === file.stat.mtime && read.size === file.stat.size;
      return fresh ? read.entry : (read?.entry ?? placeholderEntry(file.path, file.stat.mtime));
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
      button.addEventListener("click", () => this.host.newNotebook());
      return;
    }

    if (searching) {
      const found = sortEntries(searchEntries(all, this.query), this.sort);
      this.grid(found, found.length === 0 ? "No notebook matches." : "Results");
      return;
    }

    const left = this.lastPages();
    const stars = this.host.stars();
    const here = browse(hoistSingles(all), this.folder);
    // What a row above shows is not listed again below it.
    const shown = new Set<string>();
    const shownFolders = new Set<string>();
    if (this.folder === "" && stars.length > 0) {
      const books = all.filter((e) => isStarred(stars, e.path));
      const folders = stars
        .filter((path) => !path.toLowerCase().endsWith(NOTEBOOK_FILE_SUFFIX))
        .map((path) => this.folderTile(all, path))
        .filter((f): f is FolderTile => f !== null);
      if (books.length + folders.length > 0) {
        this.label("Favorites");
        const row = this.bodyEl.createDiv({ cls: "goodobsidian-library-grid" });
        for (const folder of folders) {
          this.folderCard(row, folder);
          shownFolders.add(folder.path);
        }
        for (const entry of books) {
          this.card(row, entry, left[entry.path]?.index);
          shown.add(entry.path);
        }
      }
    }
    if (this.folder === "") {
      const recent = continueEntries(
        all.filter((e) => e.pages > 0 && !shown.has(e.path)),
        CONTINUE_COUNT,
        (path) => left[path]?.at ?? 0,
      );
      if (recent.length > 0) {
        this.label("Continue");
        const row = this.bodyEl.createDiv({ cls: "goodobsidian-library-recent" });
        for (const entry of recent) {
          this.card(row, entry, left[entry.path]?.index);
          shown.add(entry.path);
        }
      }
    }
    const folders = here.folders.filter((f) => !shownFolders.has(f.path));
    if (folders.length > 0) {
      this.label("Folders");
      const row = this.bodyEl.createDiv({ cls: "goodobsidian-library-grid" });
      for (const folder of starredFirst(folders, stars, (f) => f.path))
        this.folderCard(row, folder);
    }
    const rest = here.notebooks.filter((e) => !shown.has(e.path));
    if (rest.length > 0) {
      this.grid(sortEntries(rest, this.sort), SORTS.find((s) => s.by === this.sort)?.label ?? "");
    }
  }

  private label(text: string): void {
    this.bodyEl.createDiv({ cls: "goodobsidian-library-label", text });
  }

  private grid(entries: LibraryEntry[], label: string): void {
    this.label(label);
    const grid = this.bodyEl.createDiv({ cls: "goodobsidian-library-grid" });
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
      text: `${folder.count} ${folder.count === 1 ? "notebook" : "notebooks"}`,
    });
    const open = (): void => this.openFolder(folder.path);
    card.addEventListener("click", open);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
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

    const open = (event: MouseEvent | KeyboardEvent): void => {
      const file = this.app.vault.getFileByPath(entry.path);
      if (file) void this.app.workspace.getLeaf(Keymap.isModEvent(event)).openFile(file);
    };
    card.addEventListener("click", open);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open(event);
      }
    });
    card.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.openCardMenu(event, entry);
    });
  }

  // --- Menus and navigation -----------------------------------------------------

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

  private openSortMenu(event: MouseEvent): void {
    const menu = new Menu();
    for (const option of SORTS) {
      menu.addItem((item) =>
        item
          .setTitle(option.label)
          .setIcon(option.icon)
          .setChecked(this.sort === option.by)
          .onClick(() => {
            this.sort = option.by;
            this.paintNow();
            this.app.workspace.requestSaveLayout();
          }),
      );
    }
    menu.showAtMouseEvent(event);
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
    const menu = new Menu();
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
    const menu = new Menu();
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
    const menu = new Menu();
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
    const menu = new Menu();
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
