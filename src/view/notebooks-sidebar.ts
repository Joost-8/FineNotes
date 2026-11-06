/**
 * "Notebooks": a view in Obsidian's left sidebar, beside Files, Search and
 * Bookmarks, that lists only the vault's notebooks in their folders. It is
 * drawn with Obsidian's own file-tree classes, so it looks and behaves like
 * the file explorer: a tap on a folder folds it, a tap on a notebook opens
 * it, and a right-click (a long press) gives Obsidian's own file menu.
 *
 *   .goodobsidian-notebooks
 *     .nav-header > .nav-buttons-container   (Home · New notebook)
 *     .nav-files-container
 *       .tree-item.nav-folder … .tree-item.nav-file
 */

import { ItemView, Menu, Platform, TFile, type WorkspaceLeaf, setIcon } from "obsidian";
import { ICON_LIBRARY, VIEW_TYPE_INK } from "../constants";
import { type TreeFolder, notebookTree } from "../model/notebook-tree";
import { t } from "../i18n/translate";
import { unstackTabsOf } from "./library-view";

export const VIEW_TYPE_NOTEBOOKS = "finenotes-notebooks";

/** The folders unfolded in the tree, kept on this device. */
const OPEN_KEY = "finenotes-notebooks-open";

export interface NotebooksHost {
  isInkFile(file: TFile): boolean;
  openLibrary(): void;
  newNotebook(folder: string): void;
}

export class NotebooksSidebar extends ItemView {
  override icon = ICON_LIBRARY;
  private treeEl!: HTMLElement;
  private readonly unfolded = new Set<string>();
  private timer = 0;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly host: NotebooksHost,
  ) {
    super(leaf);
    const kept = this.app.loadLocalStorage(OPEN_KEY) as unknown;
    if (typeof kept === "string") {
      try {
        const list = JSON.parse(kept) as unknown;
        if (Array.isArray(list))
          for (const p of list) if (typeof p === "string") this.unfolded.add(p);
      } catch {
        // A damaged list unfolds nothing.
      }
    }
  }

  getViewType(): string {
    return VIEW_TYPE_NOTEBOOKS;
  }

  getDisplayText(): string {
    return t("notebooks.sidebar.title");
  }

  override async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("goodobsidian-notebooks");
    const header = root.createDiv({ cls: "nav-header" });
    const buttons = header.createDiv({ cls: "nav-buttons-container" });
    const button = (icon: string, label: string, run: () => void): void => {
      const el = buttons.createDiv({
        cls: "clickable-icon nav-action-button",
        attr: { "aria-label": label },
      });
      setIcon(el, icon);
      el.addEventListener("click", run);
    };
    button("house", t("notebooks.home.title"), () => this.host.openLibrary());
    button("square-pen", t("notebooks.menu.newNotebook"), () => this.host.newNotebook(""));
    this.treeEl = root.createDiv({ cls: "nav-files-container" });
    this.paint();
    const soon = (): void => {
      window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.paint(), 250);
    };
    this.registerEvent(this.app.vault.on("create", soon));
    this.registerEvent(this.app.vault.on("delete", soon));
    this.registerEvent(this.app.vault.on("rename", soon));
    this.registerEvent(this.app.workspace.on("file-open", () => this.markActive()));
    this.register(() => window.clearTimeout(this.timer));
  }

  private paint(): void {
    if (!this.treeEl) return;
    const files = this.app.vault.getFiles().filter((f) => this.host.isInkFile(f));
    const tree = notebookTree(files.map((f) => f.path));
    this.treeEl.empty();
    const top = this.treeEl.createDiv({ cls: "tree-item nav-folder mod-root" });
    const children = top.createDiv({ cls: "tree-item-children nav-folder-children" });
    this.folderContents(children, tree);
    if (tree.count === 0)
      children.createDiv({ cls: "pane-empty", text: t("notebooks.home.empty") });
    this.markActive();
  }

  private folderContents(parent: HTMLElement, folder: TreeFolder): void {
    for (const sub of folder.folders) this.folderRow(parent, sub);
    for (const book of folder.notebooks) {
      const item = parent.createDiv({ cls: "tree-item nav-file" });
      const self = item.createDiv({
        cls: "tree-item-self nav-file-title is-clickable tappable",
        attr: { "data-path": book.path, draggable: "true" },
      });
      setIcon(self.createDiv({ cls: "tree-item-icon goodobsidian-notebooks-icon" }), "notebook");
      self.createDiv({ cls: "tree-item-inner nav-file-title-content", text: book.title });
      self.addEventListener("click", (event) => this.openNotebook(book.path, event));
      self.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        const file = this.app.vault.getFileByPath(book.path);
        if (!file) return;
        const menu = new Menu();
        this.app.workspace.trigger(
          "file-menu",
          menu,
          file,
          "file-explorer-context-menu",
          this.leaf,
        );
        menu.showAtMouseEvent(event);
      });
      self.addEventListener("dragstart", (event) => {
        const file = this.app.vault.getFileByPath(book.path);
        const drag = (
          this.app as unknown as {
            dragManager?: {
              dragFile(e: DragEvent, f: TFile): unknown;
              onDragStart(e: DragEvent, d: unknown): void;
            };
          }
        ).dragManager;
        if (file && drag) drag.onDragStart(event, drag.dragFile(event, file));
      });
    }
  }

  private folderRow(parent: HTMLElement, folder: TreeFolder): void {
    const open = this.unfolded.has(folder.path);
    const item = parent.createDiv({ cls: "tree-item nav-folder" });
    item.toggleClass("is-collapsed", !open);
    const self = item.createDiv({
      cls: "tree-item-self nav-folder-title is-clickable mod-collapsible tappable",
      attr: { "data-path": folder.path },
    });
    const arrow = self.createDiv({ cls: "tree-item-icon collapse-icon" });
    setIcon(arrow, "right-triangle");
    arrow.toggleClass("is-collapsed", !open);
    self.createDiv({ cls: "tree-item-inner nav-folder-title-content", text: folder.name });
    self.createDiv({ cls: "tree-item-flair-outer" }).createSpan({
      cls: "tree-item-flair",
      text: String(folder.count),
    });
    const children = item.createDiv({ cls: "tree-item-children nav-folder-children" });
    if (open) this.folderContents(children, folder);
    self.addEventListener("click", () => {
      if (this.unfolded.has(folder.path)) this.unfolded.delete(folder.path);
      else this.unfolded.add(folder.path);
      this.app.saveLocalStorage(OPEN_KEY, JSON.stringify([...this.unfolded]));
      this.paint();
    });
  }

  /** The notebook open now, lit as the file explorer lights the file it has open. */
  private markActive(): void {
    const path = this.app.workspace.getActiveFile()?.path ?? null;
    this.treeEl?.querySelectorAll(".nav-file-title").forEach((el) => {
      (el as HTMLElement).toggleClass("is-active", el.getAttribute("data-path") === path);
    });
  }

  /** In the tab it is open in, else in a new one (a modifier key), else in the tab in front. */
  private openNotebook(path: string, event: MouseEvent): void {
    const file = this.app.vault.getFileByPath(path);
    if (!(file instanceof TFile)) return;
    let existing: WorkspaceLeaf | null = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view.getViewType() !== VIEW_TYPE_INK) return;
      if ((leaf.view as { file?: TFile | null }).file?.path === path) existing = leaf;
    });
    if (existing) void this.app.workspace.revealLeaf(existing);
    else {
      const leaf = this.app.workspace.getLeaf(event.ctrlKey || event.metaKey ? "tab" : false);
      unstackTabsOf(leaf);
      void leaf.openFile(file);
    }
    // On a phone or an iPad the sidebar is a drawer over the page: put it away, as Files does.
    if (Platform.isMobile) this.app.workspace.leftSplit.collapse();
  }
}
