/**
 * The Folders library: the notes of one folder as a grid of thumbnails or a
 * list, its subfolders as cards above them, with sorting, selecting several
 * notes to move or delete, making a note or a notebook, and importing files.
 * It opens from the Folders sidebar and shows whichever folder was chosen
 * there; one tab serves every folder.
 */

import {
  type App,
  FileView,
  ItemView,
  Menu,
  Notice,
  Platform,
  TFile,
  TFolder,
  type ViewStateResult,
  type WorkspaceLeaf,
  debounce,
  normalizePath,
  setIcon,
} from "obsidian";
import { VIEW_TYPE_FOLDER_LIBRARY } from "../../constants";
import {
  DEFAULT_LIBRARY_WIDTH,
  columnsFor,
  directionRows,
  noteTitle,
  sortFolders,
  sortNotes,
} from "../../model/folder-library-order";
import {
  baseName,
  folderKey,
  freePath,
  isAttachmentFolderName,
  isHiddenName,
  isInside,
  isRootPath,
  parentPath,
} from "../../model/folder-paths";
import type { LibrarySort, LibraryViewMode } from "../../model/folder-sidebar-data";
import { t, tn } from "../../i18n/translate";
import { onContextMenu, onLongPress, openFileMenu, showMenu } from "./context-menu";
import type { FolderSidebarController } from "./controller";
import { countNotes } from "./files";
import { DeleteNotesModal, MoveToFolderModal } from "./modals";
import { Thumbnails } from "./thumbnails";
import { attachTouchDrag } from "./touch-drag";

/** How long after a vault change the library is drawn again, ms. */
const RENDER_DELAY_MS = 150;

/** A button made of a div (Obsidian restyles real buttons, and on the iPad pads each by 20 px). */
function addButton(
  parent: HTMLElement,
  cls: string,
  label: string,
  onClick: (button: HTMLElement, event: Event) => void,
): HTMLElement {
  const button = parent.createDiv({
    cls,
    attr: { role: "button", tabindex: "0", "aria-label": label, title: label },
  });
  button.addEventListener("click", (event) => onClick(button, event));
  button.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onClick(button, event);
  });
  return button;
}

/** A div that is not in the page yet (the global one: a Document cannot hold a second root). */
function detachedDiv(cls: string, attr?: Record<string, string>): HTMLElement {
  return createDiv({ cls, attr });
}

/** A labelled section of the page. */
function sectionOf(label: string): HTMLElement {
  return detachedDiv("fl-section", { "aria-label": label });
}

/** The sort's name for the menu and the button's tooltip. */
function sortKindName(sort: LibrarySort): string {
  switch (sort) {
    case "created":
      return t("view.folders.sort.created");
    case "modified":
      return t("view.folders.sort.modified");
    case "name":
      return t("view.folders.sort.name");
  }
}

/** The sort button's short label. */
function sortShortName(sort: LibrarySort): string {
  switch (sort) {
    case "created":
      return t("view.folders.sort.createdShort");
    case "modified":
      return t("view.folders.sort.modifiedShort");
    case "name":
      return t("view.folders.sort.name");
  }
}

/** The sort button's tooltip: what it sorts by and which way. */
function sortTitle(sort: LibrarySort, descending: boolean): string {
  const order =
    sort === "name"
      ? descending
        ? t("view.folders.sort.zToA")
        : t("view.folders.sort.aToZ")
      : descending
        ? t("view.folders.sort.newestFirst")
        : t("view.folders.sort.oldestFirst");
  return t("view.folders.sort.title", { kind: sortKindName(sort), order });
}

export class FolderLibraryView extends ItemView {
  private folderPath = "";
  private built = false;
  private scrollEl: HTMLElement | null = null;
  private pageEl: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private cols = 4;
  private resetScroll = false;
  private selectMode = false;
  private readonly selected = new Set<string>();
  private actionBarEl: HTMLElement | null = null;
  private thumbs!: Thumbnails;
  private readonly scheduleRender: () => void;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly controller: FolderSidebarController,
  ) {
    super(leaf);
    this.scheduleRender = debounce(() => this.render(), RENDER_DELAY_MS, true);
  }

  override getViewType(): string {
    return VIEW_TYPE_FOLDER_LIBRARY;
  }

  override getDisplayText(): string {
    return this.folderPath ? baseName(this.folderPath) : t("view.folders.library");
  }

  override getIcon(): string {
    return "layout-grid";
  }

  override getState(): Record<string, unknown> {
    return { ...super.getState(), folder: this.folderPath };
  }

  override async setState(state: unknown, result: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    const asked = (state as { folder?: unknown } | null)?.folder;
    const folder = folderKey(typeof asked === "string" ? asked : "");
    if (folder !== this.folderPath) {
      this.selected.clear();
      this.selectMode = false;
    }
    this.folderPath = folder;
    if (this.built) this.render();
  }

  override onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("folder-library-root");
    this.thumbs = new Thumbnails(this.app, this, this.controller.pluginDir);
    this.registerDomEvent(activeDocument, "keydown", (event) => {
      if (event.key !== "Escape" || !this.selectMode || event.defaultPrevented) return;
      if (this.app.workspace.getActiveViewOfType(FolderLibraryView) === this) this.exitSelectMode();
    });
    this.scrollEl = root.createDiv({ cls: "fl-scroll" });
    this.pageEl = this.scrollEl.createDiv({ cls: "fl-page" });
    this.resizeObserver = new ResizeObserver(() => this.updateColumns());
    this.resizeObserver.observe(this.pageEl);
    this.registerEvent(this.app.vault.on("create", (file) => this.onVaultChange(file.path)));
    this.registerEvent(this.app.vault.on("modify", (file) => this.onVaultChange(file.path)));
    this.registerEvent(this.app.vault.on("delete", (file) => this.onVaultChange(file.path)));
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (this.folderPath !== "" && isInside(oldPath, this.folderPath)) {
          this.folderPath = file.path + this.folderPath.slice(oldPath.length);
          this.updateTabHeader();
        }
        this.onVaultChange(file.path, oldPath);
      }),
    );
    this.register(this.controller.onDataChange(() => this.render()));
    this.built = true;
    this.render();
    return Promise.resolve();
  }

  override onClose(): Promise<void> {
    this.built = false;
    this.actionBarEl = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.thumbs.dispose();
    return Promise.resolve();
  }

  /** Show another folder. */
  setFolder(path: string): void {
    const folder = folderKey(path);
    if (folder === this.folderPath) return;
    this.folderPath = folder;
    this.selected.clear();
    this.selectMode = false;
    this.resetScroll = true;
    if (this.built) this.render();
  }

  /** Whether a change at `path` is in the folder shown. */
  private touches(path: string): boolean {
    return this.folderPath === "" ? true : isInside(path, this.folderPath);
  }

  private onVaultChange(path: string, oldPath?: string): void {
    if (this.built && (this.touches(path) || (oldPath !== undefined && this.touches(oldPath)))) {
      this.scheduleRender();
    }
  }

  /** Have Obsidian redraw the tab's title (the folder's name). */
  private updateTabHeader(): void {
    (this.leaf as WorkspaceLeaf & { updateHeader?: () => void }).updateHeader?.();
  }

  /** The nearest folder that still exists at or above `path`. */
  private resolveExistingFolder(path: string): string {
    let current = path;
    while (current !== "" && !(this.app.vault.getAbstractFileByPath(current) instanceof TFolder)) {
      current = parentPath(current);
    }
    return current;
  }

  private getFolder(path: string): TFolder {
    const key = folderKey(path);
    if (key === "") return this.app.vault.getRoot();
    const found = this.app.vault.getAbstractFileByPath(key);
    return found instanceof TFolder ? found : this.app.vault.getRoot();
  }

  private folderTitle(folder: TFolder): string {
    return isRootPath(folder.path)
      ? this.app.vault.getName()
      : folder.name || t("view.folders.untitledFolder");
  }

  /** The folder's notes, as the library lists and sorts them. */
  private notesOf(folder: TFolder): TFile[] {
    const { data } = this.controller;
    return sortNotes(
      folder.children.filter(
        (child): child is TFile => child instanceof TFile && !isHiddenName(child.name),
      ),
      data.librarySort,
      data.librarySortDescending,
    );
  }

  /** The folder's subfolders, by name. */
  private subfoldersOf(folder: TFolder): TFolder[] {
    const hideAttachments = this.controller.data.hideAttachmentFolders;
    return sortFolders(
      folder.children.filter(
        (child): child is TFolder =>
          child instanceof TFolder &&
          !isHiddenName(child.name) &&
          !(hideAttachments && isAttachmentFolderName(child.name)),
      ),
    );
  }

  private render(): void {
    if (!this.built || !this.scrollEl || !this.pageEl) return;
    const existing = this.resolveExistingFolder(this.folderPath);
    if (existing !== this.folderPath) this.folderPath = existing;
    this.controller.setSelectedFolder(this.folderPath);
    this.updateTabHeader();
    const scroll = this.scrollEl.scrollTop;
    this.thumbs.reset();
    this.pageEl.empty();
    const folder = this.getFolder(this.folderPath);
    const notes = this.notesOf(folder);
    const subfolders = this.subfoldersOf(folder);
    this.cols = columnsFor(this.pageEl.getBoundingClientRect().width || DEFAULT_LIBRARY_WIDTH);
    this.pruneSelection(notes);
    this.pageEl.appendChild(
      this.buildHeader(
        folder,
        countNotes(folder, this.controller.data.hideAttachmentFolders),
        subfolders.length,
      ),
    );
    if (notes.length === 0) {
      if (subfolders.length) this.pageEl.appendChild(this.buildFolderSection(subfolders));
      this.pageEl.appendChild(this.buildEmptyState(folder));
    } else {
      if (subfolders.length) this.pageEl.appendChild(this.buildFolderSection(subfolders));
      this.pageEl.appendChild(this.buildNotesSection(notes));
    }
    this.pageEl.toggleClass("is-selecting", this.selectMode);
    this.updateActionBar();
    if (this.resetScroll) {
      this.scrollEl.scrollTop = 0;
      this.resetScroll = false;
    } else {
      this.scrollEl.scrollTop = scroll;
    }
  }

  /** The grid has as many columns as the width holds. */
  private updateColumns(): void {
    if (!this.pageEl) return;
    const cols = columnsFor(this.pageEl.getBoundingClientRect().width);
    if (cols === this.cols) return;
    this.cols = cols;
    this.contentEl.querySelectorAll<HTMLElement>("[data-fl-grid]").forEach((grid) => {
      grid.setCssStyles({ gridTemplateColumns: `repeat(${cols}, 1fr)` });
    });
  }

  private buildHeader(folder: TFolder, noteCount: number, subfolderCount: number): HTMLElement {
    const header = detachedDiv("fl-header");
    const main = header.createDiv({ cls: "fl-header-main" });
    const chip = main.createSpan({ cls: "fl-chip", attr: { "aria-hidden": "true" } });
    setIcon(chip, isRootPath(folder.path) ? "library" : "folder");
    const color = isRootPath(folder.path) ? null : this.controller.getFolderColor(folder.path);
    if (color) {
      chip.addClass("has-color");
      chip.setCssProps({ "--fs-color": color });
    }
    main.createEl("h1", {
      cls: "fl-title",
      text: this.folderTitle(folder),
      attr: { title: this.folderTitle(folder) },
    });
    const meta = header.createDiv({ cls: "fl-meta" });
    const crumbs = meta.createEl("nav", {
      cls: "fl-crumbs",
      attr: { "aria-label": t("view.folders.pathLabel") },
    });
    if (!isRootPath(folder.path)) {
      const trail = [{ name: this.app.vault.getName(), path: "" }];
      let path = "";
      for (const part of folder.path.split("/").slice(0, -1)) {
        path = path ? `${path}/${part}` : part;
        trail.push({ name: part, path });
      }
      trail.forEach((entry, index) => {
        if (index > 0) {
          setIcon(
            crumbs.createSpan({ cls: "fl-crumb-sep", attr: { "aria-hidden": "true" } }),
            "chevron-right",
          );
        }
        addButton(
          crumbs,
          "fl-crumb",
          t("view.folders.open", { name: entry.name }),
          () => void this.controller.openFolderInLibrary(entry.path),
        ).createSpan({ cls: "fl-crumb-label", text: entry.name });
      });
      crumbs.createSpan({ cls: "fl-meta-dot", text: "·", attr: { "aria-hidden": "true" } });
    }
    const counts = [tn("view.folders.noteCount", noteCount)];
    if (subfolderCount > 0) counts.push(tn("view.folders.subfolderCount", subfolderCount));
    crumbs.createSpan({ cls: "fl-meta-counts", text: counts.join(" · ") });
    return header;
  }

  private buildEmptyState(folder: TFolder): HTMLElement {
    const empty = detachedDiv("fl-empty");
    empty.createDiv({ cls: "fl-empty-text", text: t("view.folders.emptyText") });
    empty.createDiv({ cls: "fl-empty-tip", text: t("view.folders.emptyTip") });
    const actions = empty.createDiv({ cls: "fl-empty-actions" });
    const create = addButton(
      actions,
      "fl-text-button is-primary",
      t("view.folders.newNote"),
      (button) => this.openNewMenu(button),
    );
    create.setAttribute("aria-haspopup", "menu");
    setIcon(create.createSpan({ cls: "fl-text-button-icon" }), "plus");
    create.createSpan({ cls: "fl-text-button-label", text: t("view.folders.newEllipsis") });
    const subfolder = addButton(
      actions,
      "fl-text-button",
      t("view.folders.newSubfolder"),
      () => void this.controller.startSubfolder(folder.path),
    );
    setIcon(subfolder.createSpan({ cls: "fl-text-button-icon" }), "folder-plus");
    subfolder.createSpan({ cls: "fl-text-button-label", text: t("view.folders.newSubfolder") });
    return empty;
  }

  private buildFolderSection(folders: TFolder[]): HTMLElement {
    const section = sectionOf(t("view.folders.subfolders"));
    const tabs = section.createDiv({ cls: "fl-tabs", attr: { role: "list" } });
    for (const folder of folders) {
      tabs
        .createDiv({ cls: "fl-tab-item", attr: { role: "listitem" } })
        .appendChild(this.buildFolderCard(folder));
    }
    return section;
  }

  private buildFolderCard(folder: TFolder): HTMLElement {
    const card = detachedDiv("fl-folder-card", { role: "button", tabindex: "0" });
    card.setAttribute("data-drop-path", folderKey(folder.path));
    const color = this.controller.getFolderColor(folder.path);
    if (color) {
      card.addClass("has-color");
      card.setCssProps({ "--fs-color": color });
    }
    setIcon(card.createSpan({ cls: "fl-folder-glyph", attr: { "aria-hidden": "true" } }), "folder");
    card.createSpan({
      cls: "fl-folder-title",
      text: folder.name || t("view.folders.untitledFolder"),
    });
    const count = countNotes(folder, this.controller.data.hideAttachmentFolders);
    if (count > 0) {
      card.createSpan({
        cls: "fl-folder-count",
        text: String(count),
        attr: { "aria-label": tn("view.folders.noteCount", count) },
      });
    }
    const open = (): void => void this.controller.openFolderInLibrary(folder.path);
    card.addEventListener("click", open);
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      open();
    });
    card.addEventListener("contextmenu", (event) =>
      onContextMenu(this.controller, folder, this.leaf, event),
    );
    onLongPress(card, (at) => openFileMenu(this.controller, folder, this.leaf, at));
    return card;
  }

  private buildNotesSection(notes: TFile[]): HTMLElement {
    const section = sectionOf(t("view.folders.notes"));
    section.appendChild(this.buildToolbar());
    section.appendChild(
      this.controller.data.libraryViewMode === "list"
        ? this.buildList(notes)
        : this.buildGrid(notes),
    );
    return section;
  }

  private buildToolbar(): HTMLElement {
    const toolbar = detachedDiv("fl-toolbar", {
      role: "toolbar",
      "aria-label": t("view.folders.noteOptions"),
    });
    const select = addButton(
      toolbar,
      this.selectMode ? "fl-text-button is-active" : "fl-text-button",
      this.selectMode ? t("view.folders.doneSelecting") : t("view.folders.selectNotes"),
      () => (this.selectMode ? this.exitSelectMode() : this.enterSelectMode()),
    );
    select.setAttribute("aria-pressed", this.selectMode ? "true" : "false");
    setIcon(
      select.createSpan({ cls: "fl-text-button-icon" }),
      this.selectMode ? "check" : "check-square",
    );
    select.createSpan({
      cls: "fl-text-button-label",
      text: this.selectMode ? t("common.done") : t("view.folders.select"),
    });
    const { librarySort: sort, librarySortDescending: descending } = this.controller.data;
    const sortButton = addButton(toolbar, "fl-text-button", sortTitle(sort, descending), (button) =>
      this.openSortMenu(button),
    );
    sortButton.setAttribute("aria-haspopup", "menu");
    setIcon(
      sortButton.createSpan({ cls: "fl-text-button-icon" }),
      descending ? "arrow-down" : "arrow-up",
    );
    sortButton.createSpan({ cls: "fl-text-button-label", text: sortShortName(sort) });
    const toggle = toolbar.createDiv({
      cls: "fl-view-toggle",
      attr: { role: "group", "aria-label": t("view.folders.view") },
    });
    const mode = this.controller.data.libraryViewMode;
    this.buildSegment(toggle, "grid", t("view.folders.grid"), "layout-grid", mode);
    this.buildSegment(toggle, "list", t("view.folders.list"), "list", mode);
    const create = addButton(toolbar, "fl-new-button", t("view.folders.newNote"), (button) =>
      this.openNewMenu(button),
    );
    create.setAttribute("aria-haspopup", "menu");
    setIcon(create.createSpan({ cls: "fl-new-icon" }), "plus");
    create.createSpan({ cls: "fl-new-label", text: t("view.folders.new") });
    return toolbar;
  }

  /** The "New" menu: a note, a FineNotes notebook, or files from the device. */
  private openNewMenu(button: HTMLElement): void {
    const folder = this.folderPath;
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle(t("view.folders.newObsidianNote"))
        .setIcon("file-plus")
        .onClick(() => void this.createNote(folder)),
    );
    menu.addItem((item) =>
      item
        .setTitle(t("view.folders.newNotebook"))
        .setIcon("pencil")
        .onClick(() => this.controller.host.openNewNotebookDialog(folder)),
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(t("view.folders.importNotebook"))
        .setIcon("download")
        .onClick(() => this.controller.host.openImportNotebook(folder)),
    );
    menu.addItem((item) =>
      item
        .setTitle(t("view.folders.importFiles"))
        .setIcon("upload")
        .onClick(() => this.pickFilesToImport(folder)),
    );
    const box = button.getBoundingClientRect();
    showMenu(menu, () => menu.showAtPosition({ x: box.left, y: box.bottom + 4 }), button);
  }

  /** Ask the device for files, and copy them into `folder`. */
  private pickFilesToImport(folder: string): void {
    const input = activeDocument.body.createEl("input", {
      attr: {
        type: "file",
        multiple: "",
        accept: ".md,.markdown,.txt,.pdf,text/markdown,text/plain,application/pdf,image/*",
        "aria-hidden": "true",
        tabindex: "-1",
      },
    });
    input.addClass("fs-focus-bridge");
    const remove = (): void => input.remove();
    input.addEventListener("change", () => {
      const files = Array.from(input.files ?? []);
      remove();
      void this.importFiles(folder, files);
    });
    input.addEventListener("cancel", remove);
    input.click();
    window.setTimeout(remove, 10 * 60 * 1000);
  }

  private async importFiles(folder: string, files: File[]): Promise<void> {
    if (files.length === 0) return;
    let imported = 0;
    for (const file of files) {
      try {
        const dot = file.name.lastIndexOf(".");
        const base = dot > 0 ? file.name.slice(0, dot) : file.name;
        const extension = dot > 0 ? file.name.slice(dot) : "";
        const path = normalizePath(
          freePath(
            folder,
            base,
            extension,
            (candidate) => this.app.vault.getAbstractFileByPath(normalizePath(candidate)) !== null,
          ),
        );
        await this.app.vault.createBinary(path, await file.arrayBuffer());
        imported++;
      } catch (error) {
        console.warn(`FineNotes: could not import ${file.name}`, error);
      }
    }
    new Notice(
      imported === files.length
        ? tn("view.folders.imported", imported)
        : tn("view.folders.importedSome", files.length, { done: imported }),
    );
  }

  private async createNote(folder: string): Promise<void> {
    const path = normalizePath(
      freePath(
        folder,
        "Untitled",
        ".md",
        (candidate) => this.app.vault.getAbstractFileByPath(normalizePath(candidate)) !== null,
      ),
    );
    try {
      const file = await this.app.vault.create(path, "");
      const leaf = this.app.workspace.getLeaf("tab");
      await this.showInLeaf(leaf, file);
      this.controller.collapseSidebarDrawerIfMobile();
    } catch (error) {
      console.warn("FineNotes: could not create note", error);
      new Notice(t("view.folders.createNoteFailed"));
    }
  }

  private async showInLeaf(leaf: WorkspaceLeaf, file: TFile): Promise<void> {
    const { workspace } = this.app;
    await leaf.openFile(file, { active: true });
    workspace.setActiveLeaf(leaf, { focus: true });
    await workspace.revealLeaf(leaf);
  }

  // --- Selecting ------------------------------------------------------------------------------------------

  private enterSelectMode(): void {
    this.selectMode = true;
    this.render();
  }

  private exitSelectMode(): void {
    this.selectMode = false;
    this.selected.clear();
    this.render();
  }

  /** Drop from the selection what is no longer in the folder. */
  private pruneSelection(notes: TFile[]): void {
    if (this.selected.size === 0) return;
    const present = new Set(notes.map((note) => note.path));
    for (const path of [...this.selected]) if (!present.has(path)) this.selected.delete(path);
  }

  private currentNotes(): TFile[] {
    return this.notesOf(this.getFolder(this.folderPath));
  }

  private toggleSelected(file: TFile, card: HTMLElement): void {
    if (this.selected.has(file.path)) this.selected.delete(file.path);
    else this.selected.add(file.path);
    this.applySelectedState(card, file.path);
    this.updateActionBar();
  }

  private applySelectedState(card: HTMLElement, path: string): void {
    const on = this.selected.has(path);
    card.toggleClass("is-selected", on);
    card.setAttribute("aria-pressed", on ? "true" : "false");
  }

  private addCheckMark(parent: HTMLElement): void {
    const check = parent.createDiv({ cls: "fl-check", attr: { "aria-hidden": "true" } });
    setIcon(check.createSpan({ cls: "fl-check-icon" }), "check");
  }

  /** The bar at the bottom while selecting: how many, select all, move, delete. */
  private updateActionBar(): void {
    if (!this.selectMode) {
      this.actionBarEl?.remove();
      this.actionBarEl = null;
      return;
    }
    this.actionBarEl ??= this.contentEl.createDiv({
      cls: "fl-action-bar",
      attr: { role: "toolbar", "aria-label": t("view.folders.selectionActions") },
    });
    const bar = this.actionBarEl;
    bar.empty();
    const total = this.currentNotes().length;
    const count = this.selected.size;
    bar.createSpan({
      cls: "fl-action-count",
      text: tn("view.folders.selectedCount", count),
      attr: { "aria-live": "polite" },
    });
    const all = total > 0 && count === total;
    const allLabel = all ? t("view.folders.deselectAll") : t("view.folders.selectAll");
    addButton(bar, "fl-action", allLabel, () => {
      if (all) this.selected.clear();
      else for (const note of this.currentNotes()) this.selected.add(note.path);
      this.syncSelectionDom();
      this.updateActionBar();
    }).createSpan({ cls: "fl-action-label", text: allLabel });
    const move = addButton(bar, "fl-action", t("view.folders.moveSelected"), () =>
      this.moveSelected(),
    );
    setIcon(move.createSpan({ cls: "fl-action-icon" }), "folder-input");
    move.createSpan({ cls: "fl-action-label", text: t("view.folders.move") });
    const remove = addButton(
      bar,
      "fl-action fl-action-danger",
      t("view.folders.deleteSelected"),
      () => this.deleteSelected(),
    );
    setIcon(remove.createSpan({ cls: "fl-action-icon" }), "trash-2");
    remove.createSpan({ cls: "fl-action-label", text: t("common.delete") });
    for (const button of [move, remove]) {
      button.toggleClass("is-disabled", count === 0);
      button.setAttribute("aria-disabled", count === 0 ? "true" : "false");
    }
  }

  private syncSelectionDom(): void {
    this.contentEl.querySelectorAll<HTMLElement>("[data-fl-path]").forEach((card) => {
      this.applySelectedState(card, card.getAttribute("data-fl-path") ?? "");
    });
  }

  private selectedFiles(): TFile[] {
    const files: TFile[] = [];
    for (const path of this.selected) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) files.push(file);
    }
    return files;
  }

  private moveSelected(): void {
    if (this.selected.size === 0) return;
    const hideAttachments = this.controller.data.hideAttachmentFolders;
    const folders: TFolder[] = [];
    const collect = (folder: TFolder): void => {
      folders.push(folder);
      for (const child of folder.children) {
        if (
          child instanceof TFolder &&
          !isHiddenName(child.name) &&
          !(hideAttachments && isAttachmentFolderName(child.name))
        ) {
          collect(child);
        }
      }
    };
    collect(this.app.vault.getRoot());
    new MoveToFolderModal(this.app, folders, (folder) => void this.performMove(folder)).open();
  }

  private async performMove(target: TFolder): Promise<void> {
    const files = this.selectedFiles();
    const prefix = isRootPath(target.path) ? "" : `${target.path}/`;
    let moved = 0;
    const skipped: string[] = [];
    for (const file of files) {
      const destination = normalizePath(`${prefix}${file.name}`);
      if (destination === file.path || this.app.vault.getAbstractFileByPath(destination)) {
        skipped.push(file.name);
        continue;
      }
      try {
        await this.app.fileManager.renameFile(file, destination);
        moved++;
      } catch (error) {
        console.warn(`FineNotes: could not move ${file.path}`, error);
        skipped.push(file.name);
      }
    }
    if (skipped.length) {
      new Notice(tn("view.folders.skipped", skipped.length, { names: skipped.join(", ") }));
    }
    this.exitSelectMode();
    new Notice(
      tn("view.folders.movedTo", moved, { folder: isRootPath(target.path) ? "/" : target.path }),
    );
  }

  private deleteSelected(): void {
    const files = this.selectedFiles();
    if (files.length === 0) return;
    new DeleteNotesModal(this.app, files.length, () => void this.performDelete(files)).open();
  }

  private async performDelete(files: TFile[]): Promise<void> {
    let trashed = 0;
    for (const file of files) {
      try {
        await this.app.fileManager.trashFile(file);
        trashed++;
      } catch (error) {
        console.warn(`FineNotes: could not trash ${file.path}`, error);
      }
    }
    this.exitSelectMode();
    new Notice(tn("view.folders.trashed", trashed));
  }

  // --- The toolbar's controls -----------------------------------------------------------------------------------

  private buildSegment(
    group: HTMLElement,
    mode: LibraryViewMode,
    label: string,
    icon: string,
    current: LibraryViewMode,
  ): void {
    const on = mode === current;
    const segment = addButton(group, on ? "fl-seg is-selected" : "fl-seg", label, () => {
      if (!on) this.controller.setLibraryViewMode(mode);
    });
    segment.setAttribute("aria-pressed", on ? "true" : "false");
    setIcon(segment.createSpan({ cls: "fl-seg-icon" }), icon);
  }

  private openSortMenu(button: HTMLElement): void {
    const { librarySort: sort, librarySortDescending: descending } = this.controller.data;
    const menu = new Menu();
    menu.addItem((item) => item.setTitle(t("view.folders.sort.by")).setIsLabel(true));
    for (const kind of ["created", "modified", "name"] as const) {
      menu.addItem((item) =>
        item
          .setTitle(sortKindName(kind))
          .setChecked(sort === kind)
          .onClick(() => this.controller.setLibrarySort(kind)),
      );
    }
    menu.addSeparator();
    const byName = sort === "name";
    const rows = directionRows(sort);
    const titles = byName
      ? [t("view.folders.sort.aToZ"), t("view.folders.sort.zToA")]
      : [t("view.folders.sort.newestFirst"), t("view.folders.sort.oldestFirst")];
    for (const [title, value] of [
      [titles[0], rows.first],
      [titles[1], rows.second],
    ] as const) {
      menu.addItem((item) =>
        item
          .setTitle(title)
          .setChecked(descending === value)
          .onClick(() => this.controller.setLibrarySortDescending(value)),
      );
    }
    const box = button.getBoundingClientRect();
    showMenu(menu, () => menu.showAtPosition({ x: box.left, y: box.bottom + 4 }), button);
  }

  // --- Cards and rows -----------------------------------------------------------------------------------------------

  private buildGrid(notes: TFile[]): HTMLElement {
    const grid = detachedDiv("fl-grid", { role: "list", "data-fl-grid": "" });
    grid.setCssStyles({ gridTemplateColumns: `repeat(${this.cols}, 1fr)` });
    for (const note of notes) {
      grid
        .createDiv({ cls: "fl-grid-item", attr: { role: "listitem" } })
        .appendChild(this.buildNoteCard(note));
    }
    return grid;
  }

  private buildNoteCard(note: TFile): HTMLElement {
    const card = detachedDiv("fl-card", { role: "button", tabindex: "0" });
    card.draggable = !Platform.isMobile && !this.selectMode;
    card.setAttribute("data-fl-path", note.path);
    this.applySelectedState(card, note.path);
    const area = card.createDiv({ cls: "fl-thumb-area" });
    const slot = area.createDiv({ cls: "fl-thumb-slot" });
    this.thumbs.observe(slot, note);
    this.addCheckMark(area);
    const body = card.createDiv({ cls: "fl-card-body" });
    body.createDiv({
      cls: "fl-card-title",
      text: noteTitle(note.basename) || t("view.folders.untitledNote"),
    });
    const options = addButton(
      body,
      "fl-options-button",
      t("view.folders.options"),
      (button, event) => {
        event.stopPropagation();
        if (event instanceof MouseEvent) {
          openFileMenu(this.controller, note, this.leaf, event, { anchor: button });
        } else {
          const box = button.getBoundingClientRect();
          openFileMenu(
            this.controller,
            note,
            this.leaf,
            { x: box.left, y: box.bottom },
            { anchor: button },
          );
        }
      },
    );
    setIcon(options, "more-horizontal");
    this.wireNoteItem(card, note);
    return card;
  }

  private buildList(notes: TFile[]): HTMLElement {
    const list = detachedDiv("fl-list", { role: "list" });
    const sort = this.controller.data.librarySort;
    for (const note of notes) {
      const row = list
        .createDiv({ cls: "fl-list-item", attr: { role: "listitem" } })
        .createDiv({ cls: "fl-row", attr: { role: "button", tabindex: "0" } });
      row.draggable = !Platform.isMobile && !this.selectMode;
      row.setAttribute("data-fl-path", note.path);
      this.applySelectedState(row, note.path);
      this.addCheckMark(row);
      const slot = row.createDiv({ cls: "fl-row-thumb" }).createDiv({ cls: "fl-thumb-slot" });
      this.thumbs.observe(slot, note);
      const text = row.createDiv({ cls: "fl-row-text" });
      text.createDiv({
        cls: "fl-row-title",
        text: noteTitle(note.basename) || t("view.folders.untitledNote"),
      });
      const date = new Date(sort === "created" ? note.stat.ctime : note.stat.mtime);
      text.createDiv({
        cls: "fl-row-date",
        text: date.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
      });
      row.createDiv({
        cls: "fl-row-time",
        text: date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
      });
      this.wireNoteItem(row, note);
    }
    return list;
  }

  /** Click, key, context menu, long press and drag on a note's card or row. */
  private wireNoteItem(el: HTMLElement, note: TFile): void {
    el.addEventListener("click", (event) => {
      if (this.selectMode) {
        this.toggleSelected(note, el);
        return;
      }
      void this.openNote(note, { newTab: event.metaKey || event.ctrlKey });
    });
    el.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (this.selectMode) this.toggleSelected(note, el);
      else void this.openNote(note, { newTab: false });
    });
    el.addEventListener("contextmenu", (event) => {
      if (this.selectMode) {
        event.preventDefault();
        return;
      }
      onContextMenu(this.controller, note, this.leaf, event);
    });
    const menu = (at: { x: number; y: number }): void => {
      if (!this.selectMode) openFileMenu(this.controller, note, this.leaf, at);
    };
    if (Platform.isMobile) {
      attachTouchDrag(el, {
        controller: this.controller,
        path: note.path,
        canStart: () => !this.selectMode,
        onMenu: menu,
      });
    } else {
      onLongPress(el, menu);
    }
    el.addEventListener("dragstart", (event) => {
      if (this.selectMode) {
        event.preventDefault();
        return;
      }
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", note.path);
      }
    });
  }

  /** Open a note: in this tab's place, or a tab of its own (never over the library). */
  private async openNote(note: TFile, options: { newTab: boolean }): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeaf(options.newTab ? "tab" : false);
    if (leaf.view.getViewType() === VIEW_TYPE_FOLDER_LIBRARY) leaf = workspace.getLeaf("tab");
    try {
      await this.showInLeaf(leaf, note);
    } catch (error) {
      console.warn(`FineNotes: could not open ${note.path}`, error);
      this.openUnsupported(note);
      return;
    }
    const view = leaf.view;
    const showsIt =
      view.getViewType() !== "empty" &&
      (!(view instanceof FileView) || view.file?.path === note.path);
    if (!showsIt) this.openUnsupported(note);
  }

  /** A file Obsidian cannot show: hand it to the system, where there is one. */
  private openUnsupported(note: TFile): void {
    if (Platform.isDesktopApp) {
      void (
        this.app as App & { openWithDefaultApp(path: string): Promise<void> }
      ).openWithDefaultApp(note.path);
    } else new Notice(t("view.folders.cannotOpen", { name: note.name }));
  }
}
