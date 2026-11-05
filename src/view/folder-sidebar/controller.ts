/**
 * The Folders sidebar's state and actions, shared by its two views and the
 * settings: what the person chose and what is remembered about folders (kept
 * in FineNotes' settings), which folder the library shows, moving and
 * recolouring, and opening the sidebar and the library.
 *
 * It lives with the simple look: `syncSimpleLook(true)` puts the sidebar in
 * the left split and starts the search index; `syncSimpleLook(false)` takes
 * the sidebar away and stops the index.
 */

import {
  type App,
  type Component,
  Notice,
  Platform,
  TFolder,
  type WorkspaceLeaf,
  normalizePath,
} from "obsidian";
import { MAX_RECENT_COLORS, MAX_RECENT_FOLDERS, pushFront } from "../../model/folder-colors";
import {
  childPath,
  folderKey,
  isValidMove,
  remapKeys,
  remapPath,
  remapPathList,
  sameList,
} from "../../model/folder-paths";
import {
  type FolderSidebarData,
  type LibrarySort,
  type LibraryViewMode,
} from "../../model/folder-sidebar-data";
import { descendingFor } from "../../model/folder-library-order";
import { VIEW_TYPE_FOLDERS, VIEW_TYPE_FOLDER_LIBRARY } from "../../constants";
import { t } from "../../i18n/translate";
import { cacheFolder } from "../../recognition/ocr/ocr-cache";
import { errorMessage } from "../../util/errors";
import { watchTouches } from "./context-menu";
import { FolderLibraryView } from "./folder-library-view";
import { FolderSearchIndex } from "./search-index";
import { FolderSidebarView } from "./sidebar-view";

/** What the sidebar needs from FineNotes itself. */
export interface FolderSidebarHost {
  /** Open FineNotes' New notebook window, to make the notebook in `folder` ("" is the root). */
  openNewNotebookDialog(folder: string): void;
  /** Open FineNotes' Import notebook window, into `folder`. */
  openImportNotebook(folder: string): void;
}

export interface FolderSidebarOptions {
  app: App;
  /** The plugin: it owns the events, timers and listeners the sidebar registers. */
  owner: Component;
  /** This plugin's own folder (`manifest.dir`): thumbnails and the OCR cache are under it. */
  pluginDir: string;
  host: FolderSidebarHost;
  /** The sidebar's data in FineNotes' settings. Read each time: loading settings replaces it. */
  data: () => FolderSidebarData;
  /** Save FineNotes' settings. */
  save: () => Promise<void>;
}

/** How long after the simple look starts the search index starts, ms. */
export const SEARCH_START_DELAY_MS = 4000;

export class FolderSidebarController {
  readonly app: App;
  readonly host: FolderSidebarHost;
  readonly searchIndex: FolderSearchIndex;
  /** The plugin's own folder: where this plugin keeps its files. */
  readonly pluginDir: string;
  selectedFolderPath = "";
  private readonly owner: Component;
  private readonly getData: () => FolderSidebarData;
  private readonly saveSettings: () => Promise<void>;
  private readonly selectionListeners = new Set<() => void>();
  private readonly dataListeners = new Set<() => void>();
  private creatingLibrary: Promise<WorkspaceLeaf> | null = null;
  private simpleLook = false;
  /** The simple look just turned on: the Folders tab is still to be brought to the front, once. */
  private selectPending = false;
  private searchTimer: number | null = null;
  private events = false;
  private unloaded = false;

  constructor(options: FolderSidebarOptions) {
    this.app = options.app;
    this.owner = options.owner;
    this.pluginDir = options.pluginDir;
    this.host = options.host;
    this.getData = options.data;
    this.saveSettings = options.save;
    this.searchIndex = new FolderSearchIndex(
      this.app,
      cacheFolder(this.pluginDir),
      () => this.data.searchInNotes,
    );
  }

  /** The sidebar's data: what it shows and remembers. */
  get data(): FolderSidebarData {
    return this.getData();
  }

  /** The Folders sidebar's view, for the plugin to register under {@link VIEW_TYPE_FOLDERS}. */
  createSidebarView(leaf: WorkspaceLeaf): FolderSidebarView {
    return new FolderSidebarView(leaf, this);
  }

  /** The library's view, for the plugin to register under {@link VIEW_TYPE_FOLDER_LIBRARY}. */
  createLibraryView(leaf: WorkspaceLeaf): FolderLibraryView {
    return new FolderLibraryView(leaf, this);
  }

  /** Follow folders as they are renamed and deleted, and the vault for the search. Once. */
  followVault(): void {
    if (this.events) return;
    this.events = true;
    const { vault, workspace } = this.app;
    this.owner.registerEvent(
      vault.on("rename", (file, oldPath) => {
        const data = this.data;
        const colors = remapKeys(data.folderColors, oldPath, file.path);
        const expanded = remapKeys(data.expanded, oldPath, file.path);
        const lists = this.remapLists(oldPath, file.path);
        if (colors || expanded || lists) void this.save();
        const selected = remapPath(this.selectedFolderPath, oldPath, file.path);
        if (selected !== this.selectedFolderPath) this.setSelectedFolder(selected);
        if (colors || lists) this.notifyDataChanged();
      }),
    );
    this.owner.registerEvent(
      vault.on("delete", (file) => {
        const data = this.data;
        const colors = remapKeys(data.folderColors, file.path, null);
        const expanded = remapKeys(data.expanded, file.path, null);
        const lists = this.remapLists(file.path, null);
        if (colors || expanded || lists) void this.save();
        const selected = remapPath(this.selectedFolderPath, file.path, null);
        if (selected !== this.selectedFolderPath) this.setSelectedFolder(selected);
        if (colors || lists) this.notifyDataChanged();
      }),
    );
    // The index follows the vault for as long as it runs (it ignores events when stopped).
    this.owner.registerEvent(vault.on("modify", (file) => this.searchIndex.onModify(file)));
    this.owner.registerEvent(vault.on("create", (file) => this.searchIndex.onCreate(file)));
    this.owner.registerEvent(vault.on("delete", (file) => this.searchIndex.onDelete(file.path)));
    this.owner.registerEvent(
      vault.on("rename", (file, oldPath) => void this.searchIndex.onRename(file, oldPath)),
    );
    // Opening a PDF or a notebook may have FineNotes read pages: look at its OCR cache soon.
    this.owner.registerEvent(
      workspace.on("file-open", (file) => {
        if (file && (file.extension === "pdf" || /\.(notebook|page)\.md$/i.test(file.name))) {
          this.searchIndex.scheduleOcr();
        }
      }),
    );
    // A pen at work pauses reading.
    const pen = (event: PointerEvent): void => {
      if (event.pointerType === "pen") this.searchIndex.notePenActivity();
    };
    this.owner.registerDomEvent(activeDocument, "pointerdown", pen, {
      capture: true,
      passive: true,
    });
    this.owner.registerDomEvent(activeDocument, "pointermove", pen, {
      capture: true,
      passive: true,
    });
    watchTouches(this.owner);
    // When the layout settles, a second Folders tab (a leaf restored late, after one was made) goes.
    this.owner.registerEvent(workspace.on("layout-change", () => this.keepOneSidebar()));
  }

  /** The pinned and recent lists after folder `from` was renamed to `to` or deleted. */
  private remapLists(from: string, to: string | null): boolean {
    const data = this.data;
    let changed = false;
    for (const key of ["pinned", "recent"] as const) {
      const next = remapPathList(data[key], from, to);
      if (!sameList(next, data[key])) {
        data[key] = next;
        changed = true;
      }
    }
    return changed;
  }

  // --- The simple look -------------------------------------------------------------------------

  /**
   * The simple look was turned on or off (or is how the plugin starts). On:
   * the Folders sidebar is in the left split and the search index starts a
   * few seconds later. Off: the sidebar's tab is closed and the index stops.
   * Calling it again with the same answer does nothing.
   */
  syncSimpleLook(on: boolean): void {
    if (this.unloaded || on === this.simpleLook) return;
    this.simpleLook = on;
    this.selectPending = on;
    if (on) {
      void this.ensureSidebar();
      this.scheduleSearch();
    } else {
      this.cancelSearchStart();
      this.searchIndex.stop();
      this.app.workspace.detachLeavesOfType(VIEW_TYPE_FOLDERS);
    }
  }

  private scheduleSearch(): void {
    this.cancelSearchStart();
    this.searchTimer = window.setTimeout(() => {
      this.searchTimer = null;
      if (this.unloaded || !this.simpleLook) return;
      void this.searchIndex.start();
    }, SEARCH_START_DELAY_MS);
  }

  private cancelSearchStart(): void {
    if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
    this.searchTimer = null;
  }

  /** The plugin is unloading: stop the index and its timers. */
  dispose(): void {
    this.unloaded = true;
    this.cancelSearchStart();
    this.searchIndex.stop();
    this.simpleLook = false;
    this.selectPending = false;
  }

  /** Whether the sidebar is on (the simple look is). */
  get active(): boolean {
    return this.simpleLook;
  }

  /**
   * Make the Folders tab when there is none, and leave a person's choice to
   * close it alone. A tab that is already there is brought to the front of
   * its group: the simple look hides the tab headers, so a tab left behind
   * another one would have no way back.
   */
  private async ensureSidebar(): Promise<void> {
    if (this.app.workspace.getLeavesOfType(VIEW_TYPE_FOLDERS).length > 0) {
      this.selectFoldersTab();
      return;
    }
    await this.showSidebar();
    // A new tab is shown by showSidebar. If none could be made, one restored later is selected.
    if (this.app.workspace.getLeavesOfType(VIEW_TYPE_FOLDERS).length > 0) {
      this.selectPending = false;
    }
  }

  /**
   * Make the Folders tab the selected one of its group, once after the simple
   * look turned on. It neither expands a collapsed sidebar nor moves focus
   * (`revealLeaf` does both); the tab group's `selectTab` is undocumented.
   */
  private selectFoldersTab(): void {
    if (!this.selectPending || !this.simpleLook) return;
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_FOLDERS)[0];
    if (!leaf) return;
    const tabs = (leaf as unknown as { parent?: { selectTab?: (leaf: WorkspaceLeaf) => void } })
      .parent;
    if (typeof tabs?.selectTab === "function") tabs.selectTab(leaf);
    this.selectPending = false;
  }

  /**
   * Keep the first Folders tab and close any others. Obsidian restores a tab
   * of a plugin it has just enabled a moment after the plugin starts, so a
   * tab made on start is joined by the restored one. A tab the person closed
   * stays closed: this never makes one. A tab restored after the simple look
   * turned on is brought to the front, the one time.
   */
  private keepOneSidebar(): void {
    if (!this.simpleLook || this.unloaded) return;
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_FOLDERS);
    for (const extra of leaves.slice(1)) extra.detach();
    this.selectFoldersTab();
  }

  // --- Listeners -------------------------------------------------------------------------------------

  /** Call `listener` when the open folder changes. Returns how to stop. */
  onSelectionChange(listener: () => void): () => void {
    this.selectionListeners.add(listener);
    return () => this.selectionListeners.delete(listener);
  }

  /** Call `listener` when the sidebar's data changes. Returns how to stop. */
  onDataChange(listener: () => void): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  notifyDataChanged(): void {
    for (const listener of Array.from(this.dataListeners)) listener();
  }

  /** Save FineNotes' settings, the sidebar's data with them. */
  save(): Promise<void> {
    return this.saveSettings();
  }

  // --- Opening ------------------------------------------------------------------------------------------

  /** Show the Folders sidebar, making its tab in the left split if it has none. */
  async showSidebar(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_FOLDERS)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getLeftLeaf(false);
      if (!leaf) return;
      await leaf.setViewState({ type: VIEW_TYPE_FOLDERS, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  /**
   * Show `path` in the library: in the library tab that is open, or in a new
   * tab (or `into`, a tab with nothing in it).
   */
  async openFolderInLibrary(path: string, into?: WorkspaceLeaf): Promise<void> {
    const folder = folderKey(path);
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_FOLDER_LIBRARY)[0] ?? null;
    if (!leaf) {
      this.creatingLibrary ??= (async () => {
        const created = into ?? workspace.getLeaf("tab");
        await created.setViewState({
          type: VIEW_TYPE_FOLDER_LIBRARY,
          active: true,
          state: { folder },
        });
        return created;
      })().finally(() => {
        this.creatingLibrary = null;
      });
      leaf = await this.creatingLibrary;
    }
    const deferred = leaf as WorkspaceLeaf & { loadIfDeferred?: () => Promise<void> };
    if (deferred.loadIfDeferred) await deferred.loadIfDeferred();
    if (leaf.view instanceof FolderLibraryView) leaf.view.setFolder(folder);
    else this.setSelectedFolder(folder);
    void workspace.revealLeaf(leaf);
  }

  /** The library, at the folder last shown. */
  async openLibrary(into?: WorkspaceLeaf): Promise<void> {
    await this.openFolderInLibrary(this.selectedFolderPath, into);
  }

  /** On a phone or tablet the sidebar is a drawer: close it once something was opened. */
  collapseSidebarDrawerIfMobile(): void {
    if (Platform.isMobile) this.app.workspace.leftSplit.collapse();
  }

  /** Make the new-folder row appear in the sidebar, under `path` ("" is the root). */
  async startSubfolder(path: string): Promise<void> {
    // The keyboard comes up only for a field focused during the tap: this one holds the focus
    // while the sidebar opens, so the new-folder field can take it.
    const bridge = activeDocument.body.createEl("input", {
      cls: "fs-focus-bridge",
      attr: { "aria-hidden": "true", tabindex: "-1" },
    });
    bridge.focus();
    try {
      await this.showSidebar();
      const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_FOLDERS)[0];
      const deferred = leaf as
        (WorkspaceLeaf & { loadIfDeferred?: () => Promise<void> }) | undefined;
      if (deferred?.loadIfDeferred) await deferred.loadIfDeferred();
      if (leaf?.view instanceof FolderSidebarView) leaf.view.beginCreate(folderKey(path));
    } finally {
      window.setTimeout(() => bridge.remove(), 600);
    }
  }

  // --- Data ------------------------------------------------------------------------------------------------

  setSelectedFolder(path: string): void {
    const folder = folderKey(path);
    if (folder === this.selectedFolderPath) return;
    this.selectedFolderPath = folder;
    if (folder !== "") this.pushRecent(folder);
    for (const listener of Array.from(this.selectionListeners)) listener();
  }

  getFolderColor(path: string): string | null {
    return this.data.folderColors[path] ?? null;
  }

  setFolderColor(path: string, color: string): void {
    this.data.folderColors[path] = color;
    void this.save();
    this.notifyDataChanged();
  }

  clearFolderColor(path: string): void {
    delete this.data.folderColors[path];
    void this.save();
    this.notifyDataChanged();
  }

  isPinned(path: string): boolean {
    return this.data.pinned.includes(path);
  }

  togglePinned(path: string): void {
    const data = this.data;
    data.pinned = this.isPinned(path)
      ? data.pinned.filter((entry) => entry !== path)
      : [...data.pinned, path];
    void this.save();
    this.notifyDataChanged();
  }

  pushRecent(path: string): void {
    this.data.recent = pushFront(this.data.recent, path, MAX_RECENT_FOLDERS);
    void this.save();
  }

  addRecentColor(color: string): void {
    this.data.recentColors = pushFront(this.data.recentColors, color, MAX_RECENT_COLORS);
    void this.save();
  }

  isExpanded(path: string): boolean {
    return this.data.expanded[path] === true;
  }

  setExpanded(path: string, open: boolean): void {
    if (open) this.data.expanded[path] = true;
    else delete this.data.expanded[path];
    void this.save();
  }

  setLibrarySort(sort: LibrarySort): void {
    this.data.librarySort = sort;
    this.data.librarySortDescending = descendingFor(sort);
    void this.save();
    this.notifyDataChanged();
  }

  setLibrarySortDescending(descending: boolean): void {
    this.data.librarySortDescending = descending;
    void this.save();
    this.notifyDataChanged();
  }

  setLibraryViewMode(mode: LibraryViewMode): void {
    this.data.libraryViewMode = mode;
    void this.save();
    this.notifyDataChanged();
  }

  // --- Moving ----------------------------------------------------------------------------------------------

  /** Whether the item at `source` may be moved into the folder `target`. */
  isValidMove(source: string, target: string): boolean {
    return isValidMove(source, target);
  }

  /** Move the file or folder at `source` into the folder `target` ("" is the root). */
  async moveItem(source: string, target: string): Promise<void> {
    const folder = folderKey(target);
    if (!this.isValidMove(source, folder)) return;
    const item = this.app.vault.getAbstractFileByPath(source);
    if (!item) return;
    const destination = normalizePath(childPath(folder, item.name));
    if (this.app.vault.getAbstractFileByPath(destination)) {
      new Notice(t("view.folders.exists", { name: item.name }));
      return;
    }
    try {
      await this.app.fileManager.renameFile(item, destination);
      if (folder) this.setExpanded(folder, true);
    } catch (error) {
      new Notice(t("view.folders.moveFailed", { name: item.name, reason: errorMessage(error) }));
    }
  }

  /** The folder at `path`, if there is one. */
  folderAt(path: string): TFolder | null {
    const found = this.app.vault.getAbstractFileByPath(path);
    return found instanceof TFolder ? found : null;
  }
}
