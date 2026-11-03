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
import {
  type LibraryEntry,
  type LibrarySort,
  browse,
  continueEntries,
  crumbs,
  entryFromText,
  placeholderEntry,
  searchEntries,
  sortEntries,
  whenText,
} from "../model/library";

/** What the view needs from the plugin. */
export interface LibraryHost {
  newNotebook(): void;
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

    this.paintNow();
    void this.readStale();
  }

  override async onClose(): Promise<void> {
    this.closed = true;
    window.clearTimeout(this.paintTimer);
    window.clearTimeout(this.refreshTimer);
  }

  // --- Data -------------------------------------------------------------------

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

    const here = browse(all, this.folder);
    // What Continue shows is not listed again below it.
    const shown = new Set<string>();
    if (this.folder === "") {
      const recent = continueEntries(
        all.filter((e) => e.pages > 0),
        CONTINUE_COUNT,
      );
      if (recent.length > 0) {
        this.label("Continue");
        const row = this.bodyEl.createDiv({ cls: "goodobsidian-library-recent" });
        for (const entry of recent) {
          this.card(row, entry);
          shown.add(entry.path);
        }
      }
    }
    if (here.folders.length > 0) {
      this.label("Folders");
      const row = this.bodyEl.createDiv({ cls: "goodobsidian-library-folders" });
      for (const folder of here.folders) {
        const el = row.createEl("button", { cls: "clickable-icon goodobsidian-library-folder" });
        setIcon(el.createSpan({ cls: "goodobsidian-library-folder-icon" }), "folder");
        const text = el.createDiv();
        text.createDiv({ cls: "goodobsidian-library-folder-name", text: folder.name });
        text.createDiv({
          cls: "goodobsidian-library-folder-count",
          text: `${folder.count} ${folder.count === 1 ? "notebook" : "notebooks"}`,
        });
        el.addEventListener("click", () => this.openFolder(folder.path));
      }
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
    for (const entry of entries) this.card(grid, entry);
  }

  private card(parent: HTMLElement, entry: LibraryEntry): void {
    const card = parent.createDiv({
      cls: "goodobsidian-library-card",
      attr: { role: "button", tabindex: "0", "aria-label": entry.title },
    });
    const cover = card.createDiv({ cls: "goodobsidian-library-cover" });
    const palette = coverPalette(entry.color);
    cover.style.setProperty("--gob-cover", palette.base);
    cover.style.setProperty("--gob-cover-ink", palette.title);
    cover.style.setProperty("--gob-cover-spine", palette.spine);
    cover.createSpan({ cls: "goodobsidian-library-cover-title", text: entry.title });
    if (entry.pages > 0)
      cover.createSpan({ cls: "goodobsidian-library-pages", text: String(entry.pages) });
    const caption = card.createDiv({ cls: "goodobsidian-library-caption" });
    caption.createDiv({ cls: "goodobsidian-library-name", text: entry.title });
    const when = whenText(entry.edited, Date.now());
    caption.createDiv({
      cls: "goodobsidian-library-when",
      text: entry.folder !== "" && this.query.trim() !== "" ? `${entry.folder} · ${when}` : when,
    });

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
