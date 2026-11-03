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
  type TAbstractFile,
  TFile,
  type ViewStateResult,
  type WorkspaceLeaf,
  setIcon,
} from "obsidian";
import { NOTEBOOK_FILE_SUFFIX, VIEW_TYPE_LIBRARY } from "../constants";
import { coverPalette } from "../model/cover";
import { isStarred, starredFirst, toggleStar } from "../model/favorites";
import { LAST_PAGES_KEY, type LastPages, parseLastPages } from "../model/last-page";
import {
  type LibraryEntry,
  type LibrarySort,
  browse,
  continueEntries,
  crumbs,
  hoistSingles,
  entryFromText,
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
  override icon = "library";
  private folder = "";
  private sort: LibrarySort = "edited";
  private query = "";
  private readonly reads = new Map<string, Read>();
  private reading = false;
  private closed = false;
  private paintTimer = 0;
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
    this.registerEvent(this.app.vault.on("rename", touched));
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

  /** A folder as a tile like a cover: a folder glyph, its name and how many notebooks it holds. */
  private folderCard(parent: HTMLElement, folder: FolderTile): void {
    const card = parent.createDiv({
      cls: "goodobsidian-library-card",
      attr: { role: "button", tabindex: "0", "aria-label": folder.name },
    });
    const cover = card.createDiv({ cls: "goodobsidian-library-cover is-folder" });
    setIcon(cover.createSpan({ cls: "goodobsidian-library-folder-glyph" }), "folder");
    this.starButton(cover, folder.path, folder.name);
    const caption = card.createDiv({ cls: "goodobsidian-library-caption" });
    caption.createDiv({ cls: "goodobsidian-library-name", text: folder.name });
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
    this.starButton(cover, entry.path, entry.title);
    const caption = card.createDiv({ cls: "goodobsidian-library-caption" });
    caption.createDiv({ cls: "goodobsidian-library-name", text: entry.title });
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

  private openCardMenu(event: MouseEvent, entry: LibraryEntry): void {
    const file = this.app.vault.getFileByPath(entry.path);
    if (!file) return;
    const menu = new Menu();
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
    menu.showAtMouseEvent(event);
  }
}
