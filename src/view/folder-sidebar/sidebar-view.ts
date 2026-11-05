/**
 * The Folders sidebar: the vault's folders as a tree in the left split, with
 * pinned and recent folders on top, inline new-folder and rename, drag and
 * drop to move (and a long press then drag on a touch screen), colours, note
 * counts, a filter box that also searches inside notes, and a short tips card.
 *
 * Tapping a folder opens it in the Folders library. This view only draws and
 * listens; what is remembered and what happens to the vault is the
 * controller's (`controller.ts`).
 */

import {
  FileView,
  ItemView,
  Notice,
  Platform,
  TFile,
  TFolder,
  type WorkspaceLeaf,
  debounce,
  normalizePath,
  setIcon,
} from "obsidian";
import { VIEW_TYPE_FOLDERS } from "../../constants";
import { MAX_RECENT_SHOWN, randomPaletteColor } from "../../model/folder-colors";
import {
  childPath,
  folderKey,
  hasPathSeparator,
  isAttachmentFolderName,
  isHiddenName,
  openAncestors,
  parentPath,
} from "../../model/folder-paths";
import { compareTreeEntries, noteTitle } from "../../model/folder-library-order";
import { MIN_QUERY_WORD_LENGTH, tokenize } from "../../model/folder-search";
import { t, tn } from "../../i18n/translate";
import { errorMessage } from "../../util/errors";
import { closeMenus, onContextMenu, onLongPress, openFileMenu } from "./context-menu";
import type { FolderSidebarController } from "./controller";
import { countNotes } from "./files";
import { promptRenameFolder } from "./modals";
import type { SearchHit, SearchOutcome } from "./search-index";
import { attachTouchDrag } from "./touch-drag";

/** The tips card: an icon and a line each. */
function tips(): [string, string][] {
  return [
    ["pointer", t("view.folders.tip.tap")],
    ["more-horizontal", t("view.folders.tip.hold")],
    ["pencil", t("view.folders.tip.pencil")],
    ["move", t("view.folders.tip.move")],
  ];
}

/** A folder being made in the tree. */
interface InlineCreate {
  parentPath: string;
  color: string | null;
}

/** How the tree is being drawn. */
interface TreeOptions {
  /** Only folders whose name, or whose subfolders' names, hold this (lower case). */
  filter?: string;
  /** A row in the pinned or recent list: not a tree row. */
  quick?: boolean;
}

/** The folder or file a path names. */
type TreeEntry = TFolder | TFile;

export class FolderSidebarView extends ItemView {
  private filterText = "";
  private readonly collapsedSections = new Set<string>();
  private pendingFocus: string | null = null;
  private activePath: string | null = null;
  private inlineCreate: InlineCreate | null = null;
  /** A name is being typed: the tree is not drawn again under it. */
  private editing = false;
  private rendering = false;
  private dragPath: string | null = null;
  private editMode = false;
  private stopKeyboardWatch: (() => void) | null = null;
  private searchEl: HTMLElement | null = null;
  private searchFootEl: HTMLElement | null = null;
  private wasIndexing = false;
  private searchQuery = "";
  private searchResult: SearchOutcome | null = null;
  private searchLoading = false;
  private searchSeq = 0;
  private searchTimer: number | null = null;
  private paneEl!: HTMLElement;
  private listEl!: HTMLElement;
  private hereEl!: HTMLElement;
  private introEl!: HTMLElement;
  private filterInput!: HTMLInputElement;
  private editToggle!: HTMLElement;
  private readonly scheduleRender: () => void;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly controller: FolderSidebarController,
  ) {
    super(leaf);
    this.scheduleRender = debounce(() => this.requestRender(), 100, true);
  }

  override getViewType(): string {
    return VIEW_TYPE_FOLDERS;
  }

  override getDisplayText(): string {
    return t("view.folders.title");
  }

  override getIcon(): string {
    return "folder";
  }

  override async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("folder-sidebar-root");
    this.paneEl = root.createEl("aside", {
      cls: "fs-pane",
      attr: { "aria-label": t("view.folders.title") },
    });
    const header = this.paneEl.createEl("header", { cls: "fs-header" });
    header.createSpan({ cls: "fs-header-title", text: t("view.folders.title") });
    const tools = header.createDiv({ cls: "fs-header-tools" });
    this.makeIconButton(tools, "chevrons-down-up", t("view.folders.collapseAll"), () =>
      this.collapseAll(),
    );
    this.makeIconButton(tools, "locate-fixed", t("view.folders.reveal"), () =>
      this.revealSelected(),
    );
    this.makeIconButton(tools, "folder-plus", t("view.folders.newFolder"), () =>
      this.startInlineCreate(""),
    );
    this.editToggle = this.makeIconButton(tools, "pencil", t("view.folders.editMode"), () =>
      this.setEditMode(!this.editMode),
    );
    const filter = this.paneEl.createDiv({ cls: "fs-filter" });
    setIcon(
      filter.createSpan({ cls: "fs-filter-icon", attr: { "aria-hidden": "true" } }),
      "search",
    );
    this.filterInput = filter.createEl("input", {
      cls: "fs-filter-input",
      attr: {
        type: "text",
        placeholder: t("view.folders.filterPlaceholder"),
        "aria-label": t("view.folders.filterLabel"),
        enterkeyhint: "search",
      },
    });
    this.makeIconButton(filter, "x", t("view.folders.clearFilter"), () => {
      this.setFilter("");
      this.filterInput.focus();
    }).addClass("fs-filter-clear");
    this.filterInput.addEventListener("input", () => this.setFilter(this.filterInput.value));
    this.filterInput.addEventListener("focus", () => this.keepVisible(this.filterInput));
    this.filterInput.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.filterText) {
        event.preventDefault();
        this.setFilter("");
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        this.listEl.querySelector<HTMLElement>('.fs-item[tabindex="0"]')?.focus();
      }
    });
    this.hereEl = this.paneEl.createDiv({ cls: "fs-here" });
    this.introEl = this.paneEl.createDiv({ cls: "fs-intro-slot" });
    this.listEl = this.paneEl.createEl("nav", {
      cls: "fs-list",
      attr: { role: "tree", "aria-label": t("view.folders.treeLabel") },
    });
    this.registerDomEvent(this.listEl, "keydown", (event) => this.onTreeKey(event));
    header.setAttribute("data-drop-path", "");
    this.listEl.setAttribute("data-drop-path", "");
    this.attachRootDropZone(header);
    this.attachRootDropZone(this.listEl);
    const { controller } = this;
    this.register(
      controller.searchIndex.onChange(() => {
        this.renderSearchFooter();
        const status = controller.searchIndex.getStatus();
        const indexing = status.running || status.queued > 0;
        if (
          this.wasIndexing &&
          !indexing &&
          this.filterText.trim() &&
          controller.data.searchInNotes
        ) {
          this.scheduleSearch();
        }
        this.wasIndexing = indexing;
      }),
    );
    this.register(controller.onSelectionChange(() => this.requestRender()));
    this.register(controller.onDataChange(() => this.requestRender()));
    this.registerEvent(this.app.vault.on("create", () => this.scheduleRender()));
    this.registerEvent(this.app.vault.on("delete", () => this.scheduleRender()));
    this.registerEvent(this.app.vault.on("rename", () => this.scheduleRender()));
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        this.setActivePath(file ? file.path : null);
      }),
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf && leaf.view instanceof FileView) this.setActivePath(leaf.view.file?.path ?? null);
      }),
    );
    this.render();
    return Promise.resolve();
  }

  override async onClose(): Promise<void> {
    this.stopKeyboardWatch?.();
    if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
    closeMenus();
    return Promise.resolve();
  }

  /** Start making a new folder in `parentFolder` ("" is the root), with a name field in the tree. */
  beginCreate(parentFolder: string): void {
    this.startInlineCreate(parentFolder);
  }

  private requestRender(): void {
    if (!this.editing) this.render();
  }

  private endEditing(): void {
    this.editing = false;
    this.render();
  }

  private setFilter(text: string): void {
    this.filterText = text;
    if (this.filterInput.value !== text) this.filterInput.value = text;
    this.paneEl.toggleClass("has-filter", text.trim() !== "");
    if (this.inlineCreate) {
      this.inlineCreate = null;
      this.editing = false;
    }
    this.scheduleSearch();
    this.render();
  }

  // --- Search inside notes -------------------------------------------------------------

  private scheduleSearch(): void {
    if (this.searchTimer !== null) {
      window.clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    const query = this.filterText.trim();
    this.searchSeq++;
    this.searchQuery = query;
    this.searchResult = null;
    this.searchLoading = false;
    if (
      !this.controller.data.searchInNotes ||
      tokenize(query).every((word) => word.length < MIN_QUERY_WORD_LENGTH)
    ) {
      return;
    }
    this.searchLoading = true;
    const seq = this.searchSeq;
    this.searchTimer = window.setTimeout(() => {
      this.searchTimer = null;
      void this.controller.searchIndex
        .search(query)
        .catch((): SearchOutcome => ({ hits: [], tooShort: false, truncated: false }))
        .then((result) => {
          if (seq !== this.searchSeq) return;
          this.searchResult = result;
          this.searchLoading = false;
          this.renderSearchSection();
        });
    }, 300);
  }

  private renderSearchSection(): void {
    const section = this.searchEl;
    if (!section || !section.isConnected || this.editing) return;
    section.empty();
    this.searchFootEl = null;
    if (!this.controller.data.searchInNotes || this.filterText.trim() === "") return;
    section.createDiv({
      cls: "fs-section-label fs-search-label",
      text: t("view.folders.search.label"),
    });
    if (this.searchLoading) {
      section.createDiv({ cls: "fs-search-note", text: t("view.folders.search.loading") });
    } else if (!this.searchResult || this.searchResult.tooShort) {
      section.createDiv({ cls: "fs-search-note", text: t("view.folders.search.short") });
    } else if (this.searchResult.hits.length === 0) {
      section.createDiv({ cls: "fs-search-note", text: t("view.folders.search.none") });
    } else {
      const words = tokenize(this.searchQuery);
      for (const hit of this.searchResult.hits) this.renderHit(section, hit, words);
      if (this.searchResult.truncated) {
        section.createDiv({ cls: "fs-search-note", text: t("view.folders.search.truncated") });
      }
    }
    this.searchFootEl = section.createDiv({ cls: "fs-search-foot" });
    this.renderSearchFooter();
  }

  private renderSearchFooter(): void {
    const foot = this.searchFootEl;
    if (!foot || !foot.isConnected) return;
    foot.empty();
    const status = this.controller.searchIndex.getStatus();
    if (status.running || status.queued > 0) {
      foot.createDiv({
        cls: "fs-search-note is-faint",
        text: tn("view.folders.search.reading", status.queued),
      });
    }
    if (status.unsearchablePdfs > 0) {
      foot.createDiv({
        cls: "fs-search-note is-faint",
        text: tn("view.folders.search.scanned", status.unsearchablePdfs),
      });
    }
    if (status.tooLargePdfs > 0) {
      foot.createDiv({
        cls: "fs-search-note is-faint",
        text: tn("view.folders.search.tooLarge", status.tooLargePdfs),
      });
    }
  }

  private renderHit(parent: HTMLElement, hit: SearchHit, words: string[]): void {
    const row = parent.createDiv({
      cls: "fs-hit",
      attr: {
        role: "button",
        tabindex: "0",
        "aria-label": t("view.folders.open", { name: hit.title }),
      },
    });
    const icon = row.createSpan({ cls: "fs-glyph fs-hit-icon", attr: { "aria-hidden": "true" } });
    setIcon(
      icon,
      hit.kind === "notebook" ? "book-open" : hit.kind === "pdf" ? "file" : "file-text",
    );
    const body = row.createDiv({ cls: "fs-hit-body" });
    this.appendHighlighted(body.createDiv({ cls: "fs-hit-title" }), hit.title, words);
    const pages = hit.pages.length
      ? `${tn("view.folders.search.pages", hit.matchedPages, {
          pages: hit.pages.join(", "),
        })}${hit.matchedPages > hit.pages.length ? ` +${hit.matchedPages - hit.pages.length}` : ""}`
      : "";
    const folder = parentPath(hit.path);
    const meta = [pages, folder].filter(Boolean).join(" · ");
    if (meta) body.createDiv({ cls: "fs-hit-meta", text: meta });
    if (hit.snippet)
      this.appendHighlighted(body.createDiv({ cls: "fs-hit-snippet" }), hit.snippet, words);
    const open = (event: Event): void => {
      const file = this.app.vault.getAbstractFileByPath(hit.path);
      if (!(file instanceof TFile)) return;
      const newTab = event instanceof MouseEvent && (event.metaKey || event.ctrlKey);
      if (hit.kind === "pdf" && hit.pages.length > 0) {
        void this.app.workspace.openLinkText(
          `${hit.path}#page=${hit.pages[0]}`,
          "",
          newTab ? "tab" : false,
        );
      } else {
        void this.app.workspace.getLeaf(newTab ? "tab" : false).openFile(file);
      }
      this.controller.collapseSidebarDrawerIfMobile();
    };
    row.addEventListener("click", open);
    row.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      open(event);
    });
  }

  /** `text` in `parent`, with the query words (two letters or more) marked. */
  private appendHighlighted(parent: HTMLElement, text: string, words: string[]): void {
    const marked = words.filter((word) => word.length >= 2);
    if (marked.length === 0) {
      parent.setText(text);
      return;
    }
    const escaped = marked.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const pattern = new RegExp(`(${escaped.join("|")})`, "gi");
    let last = 0;
    for (const match of text.matchAll(pattern)) {
      const at = match.index ?? 0;
      if (at > last) parent.appendText(text.slice(last, at));
      parent.createEl("mark", { text: match[0] });
      last = at + match[0].length;
    }
    if (last < text.length) parent.appendText(text.slice(last));
  }

  // --- Drawing ---------------------------------------------------------------------------------------

  private render(): void {
    this.rendering = true;
    try {
      const scroll = this.listEl.scrollTop;
      this.listEl.empty();
      this.renderHere();
      this.renderIntro();
      const filter = this.filterText.trim().toLowerCase();
      const { data } = this.controller;
      if (filter) {
        const before = this.listEl.childElementCount;
        this.renderTree(this.app.vault.getRoot(), 0, { filter });
        if (this.listEl.childElementCount === before && !data.searchInNotes) {
          this.listEl.createDiv({
            cls: "fs-empty",
            text: t("view.folders.noMatch", { filter: this.filterText.trim() }),
          });
        } else if (this.listEl.childElementCount === before) {
          this.listEl.createDiv({ cls: "fs-empty is-small", text: t("view.folders.noName") });
        }
        this.searchEl = this.listEl.createDiv({ cls: "fs-search" });
        if (
          data.searchInNotes &&
          !this.searchResult &&
          !this.searchLoading &&
          tokenize(filter).some((word) => word.length >= MIN_QUERY_WORD_LENGTH)
        ) {
          this.scheduleSearch();
        }
        this.renderSearchSection();
      } else {
        this.searchEl = null;
        const hasQuick = this.renderQuickSections();
        if (hasQuick) this.renderSectionLabel(t("view.folders.section.all"), "all");
        if (!hasQuick || !this.collapsedSections.has("all")) {
          if (this.inlineCreate && this.inlineCreate.parentPath === "") {
            this.buildInlineRow(0, this.inlineCreate);
          }
          this.renderTree(this.app.vault.getRoot(), 0, {});
        }
        if (!this.listEl.querySelector(".fs-item")) {
          this.listEl.createDiv({ cls: "fs-empty", text: t("view.folders.empty") });
        }
      }
      this.listEl.scrollTop = scroll;
      this.finishRender();
    } finally {
      this.rendering = false;
    }
  }

  /** One row of the tree can be reached by Tab (the selected one, or the first), and focus returns to a row. */
  private finishRender(): void {
    const rows = Array.from(this.listEl.querySelectorAll<HTMLElement>(".fs-item[data-path]"));
    const focusable =
      rows.find(
        (row) => row.classList.contains("is-selected") && row.classList.contains("fs-in-tree"),
      ) ?? rows[0];
    rows.forEach((row) => row.setAttribute("tabindex", row === focusable ? "0" : "-1"));
    if (this.pendingFocus === null) return;
    const path = this.pendingFocus;
    this.pendingFocus = null;
    rows
      .find((row) => row.getAttribute("data-path") === path && row.classList.contains("fs-in-tree"))
      ?.focus({ preventScroll: false });
  }

  /** The path of the open folder, each part a button that opens that folder. */
  private renderHere(): void {
    this.hereEl.empty();
    const selected = this.controller.selectedFolderPath;
    this.hereEl.toggleClass("is-hidden", selected === "");
    if (selected === "") return;
    this.hereEl.setAttribute("aria-label", t("view.folders.hereLabel"));
    const parts = selected.split("/");
    let path = "";
    parts.forEach((part, index) => {
      path = path ? `${path}/${part}` : part;
      const target = path;
      if (index > 0) {
        setIcon(
          this.hereEl.createSpan({ cls: "fs-here-sep", attr: { "aria-hidden": "true" } }),
          "chevron-right",
        );
      }
      if (index === parts.length - 1) {
        this.hereEl.createSpan({
          cls: "fs-here-seg is-current",
          text: part,
          attr: { "aria-current": "true" },
        });
        return;
      }
      const segment = this.hereEl.createSpan({
        cls: "fs-here-seg",
        text: part,
        attr: {
          role: "button",
          tabindex: "0",
          "aria-label": t("view.folders.open", { name: part }),
        },
      });
      const open = (): void => void this.controller.openFolderInLibrary(target);
      segment.addEventListener("click", open);
      segment.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        open();
      });
    });
    this.hereEl.scrollLeft = this.hereEl.scrollWidth;
  }

  private renderIntro(): void {
    this.introEl.empty();
    if (this.controller.data.seenIntro) return;
    const card = this.introEl.createDiv({ cls: "fs-intro", attr: { role: "note" } });
    card.createDiv({ cls: "fs-intro-title", text: t("view.folders.intro.title") });
    const list = card.createEl("ul", { cls: "fs-intro-list" });
    for (const [icon, text] of tips()) {
      const item = list.createEl("li");
      setIcon(item.createSpan({ cls: "fs-intro-icon", attr: { "aria-hidden": "true" } }), icon);
      item.createSpan({ text });
    }
    this.makeTextButton(card, t("view.folders.intro.ok"), () => {
      this.controller.data.seenIntro = true;
      void this.controller.save();
      this.renderIntro();
    }).addClass("fs-intro-ok");
  }

  /** The Pinned and Recent lists. Whether either has anything to show. */
  private renderQuickSections(): boolean {
    const { data } = this.controller;
    const folderAt = (path: string): TFolder | null => this.controller.folderAt(path);
    const pinned = data.showPinned
      ? data.pinned.map(folderAt).filter((folder): folder is TFolder => folder !== null)
      : [];
    const pinnedPaths = new Set(pinned.map((folder) => folder.path));
    const recent = data.showRecent
      ? data.recent
          .filter((path) => !pinnedPaths.has(path))
          .map(folderAt)
          .filter((folder): folder is TFolder => folder !== null)
          .slice(0, MAX_RECENT_SHOWN)
      : [];
    const sections: [string, string, TFolder[]][] = [
      [t("view.folders.section.pinned"), "pinned", pinned],
      [t("view.folders.section.recent"), "recent", recent],
    ];
    let any = false;
    for (const [label, id, folders] of sections) {
      if (folders.length === 0) continue;
      any = true;
      this.renderSectionLabel(label, id);
      if (this.collapsedSections.has(id)) continue;
      for (const folder of folders) {
        const parent = parentPath(folder.path);
        this.renderFolder(folder, 0, { quick: true }, parent ? parent.split("/").join(" › ") : "");
      }
    }
    return any;
  }

  private renderSectionLabel(label: string, id: string): void {
    const collapsed = this.collapsedSections.has(id);
    const row = this.listEl.createDiv({
      cls: ["fs-section-label", collapsed ? "is-collapsed" : "is-open"],
      attr: { role: "button", tabindex: "0", "aria-expanded": String(!collapsed) },
    });
    setIcon(
      row.createSpan({ cls: "fs-section-chevron", attr: { "aria-hidden": "true" } }),
      "chevron-down",
    );
    row.createSpan({ text: label });
    const toggle = (): void => {
      if (this.collapsedSections.has(id)) this.collapsedSections.delete(id);
      else this.collapsedSections.add(id);
      this.render();
    };
    row.addEventListener("click", toggle);
    row.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggle();
    });
  }

  /** The children of `folder` as the tree lists them: no hidden ones, folders first, by name. */
  private sortedChildren(folder: TFolder): TreeEntry[] {
    const hideAttachments = this.controller.data.hideAttachmentFolders;
    return folder.children
      .filter((child): child is TreeEntry => child instanceof TFolder || child instanceof TFile)
      .filter((child) => !isHiddenName(child.name))
      .filter(
        (child) =>
          !(hideAttachments && child instanceof TFolder && isAttachmentFolderName(child.name)),
      )
      .sort((a, b) =>
        compareTreeEntries(
          { name: a.name, isFolder: a instanceof TFolder },
          { name: b.name, isFolder: b instanceof TFolder },
        ),
      );
  }

  /** Whether `folder`, or a folder inside it, has a name holding `filter`. */
  private subtreeMatches(folder: TFolder, filter: string): boolean {
    if (folder.name.toLowerCase().includes(filter)) return true;
    return this.sortedChildren(folder).some(
      (child) => child instanceof TFolder && this.subtreeMatches(child, filter),
    );
  }

  private renderTree(folder: TFolder, depth: number, options: TreeOptions): void {
    const showFiles = this.controller.data.showFilesInSidebar && !options.filter;
    for (const child of this.sortedChildren(folder)) {
      if (child instanceof TFolder) {
        if (options.filter && !this.subtreeMatches(child, options.filter)) continue;
        this.renderFolder(child, depth, options);
      } else if (showFiles) {
        this.renderFile(child, depth);
      }
    }
  }

  private makeRow(path: string, depth: number, classes: string[]): HTMLElement {
    const row = this.listEl.createDiv({ cls: ["fs-item", ...classes] });
    row.setAttribute("role", "treeitem");
    row.setAttribute("data-path", path);
    row.setAttribute("aria-level", String(depth + 1));
    row.setAttribute("tabindex", "-1");
    row.setCssProps({ "--depth": String(depth) });
    row.draggable = !Platform.isMobile;
    row.addEventListener("dragstart", (event) => this.onDragStart(event, path));
    row.addEventListener("dragend", () => this.onDragEnd());
    return row;
  }

  private makeChevronSlot(parent: HTMLElement): HTMLElement {
    return parent.createSpan({ cls: "fs-chevron-slot" });
  }

  private makeIconButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    onClick: (button: HTMLElement) => void,
  ): HTMLElement {
    const button = parent.createDiv({
      cls: "fs-icon-button",
      attr: { role: "button", tabindex: "0", "aria-label": label, title: label },
    });
    setIcon(button, icon);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick(button);
    });
    button.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      onClick(button);
    });
    return button;
  }

  private makeTextButton(parent: HTMLElement, label: string, onClick: () => void): HTMLElement {
    const button = parent.createDiv({
      cls: "fs-text-button",
      text: label,
      attr: { role: "button", tabindex: "0" },
    });
    button.addEventListener("click", onClick);
    button.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onClick();
    });
    return button;
  }

  private appendFolderGlyph(parent: HTMLElement, open: boolean): HTMLElement {
    const glyph = parent.createSpan({ cls: "fs-glyph", attr: { "aria-hidden": "true" } });
    setIcon(glyph, open ? "folder-open" : "folder");
    return glyph;
  }

  /** The folder's name, with the part the filter matched marked. */
  private appendTitle(parent: HTMLElement, name: string, filter?: string): HTMLElement {
    const title = parent.createSpan({ cls: "fs-title" });
    const at = filter ? name.toLowerCase().indexOf(filter) : -1;
    if (filter && at >= 0) {
      title.appendText(name.slice(0, at));
      title.createEl("mark", { text: name.slice(at, at + filter.length) });
      title.appendText(name.slice(at + filter.length));
    } else {
      title.setText(name);
    }
    return title;
  }

  private renderFolder(folder: TFolder, depth: number, options: TreeOptions, subtitle = ""): void {
    const children = this.sortedChildren(folder);
    const { data } = this.controller;
    let hasChildren: boolean;
    let expanded: boolean;
    if (options.quick) {
      hasChildren = false;
      expanded = false;
    } else if (options.filter) {
      const filter = options.filter;
      hasChildren = children.some(
        (child) => child instanceof TFolder && this.subtreeMatches(child, filter),
      );
      expanded = hasChildren;
    } else {
      hasChildren = data.showFilesInSidebar
        ? children.length > 0
        : children.some((child) => child instanceof TFolder);
      expanded = this.controller.isExpanded(folder.path);
    }
    const classes: string[] = [];
    if (this.controller.selectedFolderPath === folder.path) classes.push("is-selected");
    classes.push(options.quick ? "fs-quick" : "fs-in-tree");
    const row = this.makeRow(folder.path, options.quick ? 0 : depth, classes);
    row.setAttribute("data-drop-path", folderKey(folder.path));
    row.setAttribute("aria-selected", String(this.controller.selectedFolderPath === folder.path));
    if (hasChildren) row.setAttribute("aria-expanded", String(expanded));
    row.setAttribute("data-has-children", hasChildren ? "true" : "false");
    const color = this.controller.getFolderColor(folder.path);
    if (color) {
      row.addClass("has-color");
      row.setCssProps({ "--fs-color": color });
    }
    const content = row.createDiv({ cls: "fs-item-content" });
    if (!options.quick) {
      const slot = this.makeChevronSlot(content);
      if (hasChildren) {
        const chevron = slot.createDiv({
          cls: ["fs-chevron", expanded ? "is-expanded" : "is-collapsed"],
          attr: {
            role: "button",
            tabindex: "-1",
            "aria-label": expanded ? t("view.folders.collapse") : t("view.folders.expand"),
          },
        });
        setIcon(chevron, "chevron-right");
        if (!options.filter) {
          chevron.addEventListener("click", (event) => {
            event.stopPropagation();
            this.toggleFolder(folder.path);
          });
        }
      }
    }
    this.appendFolderGlyph(content, expanded);
    if (options.quick && subtitle) {
      const wrap = content.createSpan({ cls: "fs-title-wrap" });
      this.appendTitle(wrap, folder.name);
      wrap.createSpan({ cls: "fs-sub", text: subtitle });
    } else {
      this.appendTitle(content, folder.name, options.filter);
    }
    if (data.showCounts) {
      const count = countNotes(folder, data.hideAttachmentFolders);
      if (count > 0) {
        content.createSpan({
          cls: "fs-count",
          text: String(count),
          attr: { "aria-label": tn("view.folders.noteCount", count) },
        });
      }
    }
    const actions = row.createDiv({ cls: "fs-actions" });
    this.makeIconButton(actions, "more-horizontal", t("view.folders.moreOptions"), (button) => {
      const box = button.getBoundingClientRect();
      openFileMenu(
        this.controller,
        folder,
        this.leaf,
        { x: box.left, y: box.bottom + 4 },
        {
          actions: this.menuActions(folder),
          anchor: button,
        },
      );
    }).addClass("fs-more");
    row.addEventListener("click", () => {
      void this.controller.openFolderInLibrary(folder.path);
      this.controller.collapseSidebarDrawerIfMobile();
    });
    row.addEventListener("contextmenu", (event) =>
      onContextMenu(this.controller, folder, this.leaf, event, {
        actions: this.menuActions(folder),
      }),
    );
    this.attachPress(row, folder);
    row.addEventListener("dragover", (event) => {
      if (!this.canAcceptDrop(event, folder.path)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      row.addClass("is-drop-target");
    });
    row.addEventListener("dragleave", (event) => {
      const next = event.relatedTarget as Node | null;
      if (!next || !row.contains(next)) row.removeClass("is-drop-target");
    });
    row.addEventListener("drop", (event) => {
      const source = this.dropSource(event);
      if (!source) return;
      event.preventDefault();
      event.stopPropagation();
      row.removeClass("is-drop-target");
      this.onDragEnd();
      void this.controller.moveItem(source, folder.path).then(() => this.render());
    });
    if (options.quick) return;
    if (this.inlineCreate && this.inlineCreate.parentPath === folder.path) {
      this.buildInlineRow(depth + 1, this.inlineCreate);
    }
    if (hasChildren && expanded) this.renderTree(folder, depth + 1, options);
  }

  private renderFile(file: TFile, depth: number): void {
    const classes = ["is-file", "fs-in-tree"];
    if (this.activePath === file.path) classes.push("is-active");
    const row = this.makeRow(file.path, depth, classes);
    const content = row.createDiv({ cls: "fs-item-content" });
    this.makeChevronSlot(content);
    const glyph = content.createSpan({
      cls: "fs-glyph fs-file-icon",
      attr: { "aria-hidden": "true" },
    });
    setIcon(glyph, "file-text");
    const name = file.extension === "md" ? noteTitle(file.basename) : file.name;
    content.createSpan({ cls: "fs-title", text: name });
    row.addEventListener("click", (event) => {
      const newTab = event.metaKey || event.ctrlKey;
      void this.app.workspace.getLeaf(newTab ? "tab" : false).openFile(file);
    });
    row.addEventListener("contextmenu", (event) =>
      onContextMenu(this.controller, file, this.leaf, event),
    );
    this.attachPress(row, file);
  }

  /** The row where a new folder's name is typed. */
  private buildInlineRow(depth: number, create: InlineCreate): void {
    const row = this.listEl.createDiv({ cls: ["fs-item", "fs-inline-row"] });
    row.setCssProps({ "--depth": String(depth) });
    if (create.color) {
      row.addClass("has-color");
      row.setCssProps({ "--fs-color": create.color });
    }
    const content = row.createDiv({ cls: "fs-item-content" });
    this.makeChevronSlot(content);
    this.appendFolderGlyph(content, false);
    const input = content.createEl("input", {
      cls: "fs-inline-input",
      attr: {
        type: "text",
        placeholder: t("view.folders.newFolder"),
        "aria-label": t("view.folders.newFolderName"),
      },
    });
    let done = false;
    const finish = (name: string | null): void => {
      if (done || this.rendering) return;
      done = true;
      if (this.inlineCreate === create) {
        this.inlineCreate = null;
        this.editing = false;
      }
      this.render();
      if (name) void this.createFolderAt(create.parentPath, name, create.color);
    };
    input.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      if (event.key === "Enter") {
        event.preventDefault();
        finish(input.value.trim() || null);
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish(null);
      }
    });
    input.addEventListener("blur", () => finish(input.value.trim() || null));
  }

  // --- Keyboard ---------------------------------------------------------------------------------------

  private onTreeKey(event: KeyboardEvent): void {
    const target =
      event.target instanceof HTMLElement && event.target.classList.contains("fs-item")
        ? event.target
        : null;
    if (!target || event.isComposing) return;
    const rows = Array.from(this.listEl.querySelectorAll<HTMLElement>(".fs-item[data-path]"));
    const index = rows.indexOf(target);
    const path = target.getAttribute("data-path") ?? "";
    const hasChildren = target.getAttribute("data-has-children") === "true";
    const expanded = target.getAttribute("aria-expanded") === "true";
    const filtering = this.filterText.trim() !== "";
    const focusRow = (row: HTMLElement | undefined): void => {
      if (!row) return;
      rows.forEach((other) => other.setAttribute("tabindex", other === row ? "0" : "-1"));
      row.focus();
    };
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusRow(rows[index + 1]);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusRow(rows[index - 1]);
        break;
      case "Home":
        event.preventDefault();
        focusRow(rows[0]);
        break;
      case "End":
        event.preventDefault();
        focusRow(rows[rows.length - 1]);
        break;
      case "ArrowRight":
        event.preventDefault();
        if (hasChildren && !expanded && !filtering) {
          this.pendingFocus = path;
          this.toggleFolder(path);
        } else if (expanded) {
          focusRow(rows[index + 1]);
        }
        break;
      case "ArrowLeft":
        event.preventDefault();
        if (hasChildren && expanded && !filtering) {
          this.pendingFocus = path;
          this.toggleFolder(path);
        } else {
          const parent = parentPath(path);
          focusRow(
            rows.find(
              (row) =>
                row.getAttribute("data-path") === parent && row.classList.contains("fs-in-tree"),
            ),
          );
        }
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        target.click();
        break;
      case "F2": {
        const folder = this.app.vault.getAbstractFileByPath(path);
        if (folder instanceof TFolder) {
          event.preventDefault();
          this.startRename(folder, target);
        }
        break;
      }
      default:
    }
  }

  // --- Open folders -------------------------------------------------------------------------------------

  private setActivePath(path: string | null): void {
    if (path === this.activePath) return;
    this.activePath = path;
    if (path && openAncestors(this.controller.data.expanded, path)) void this.controller.save();
    this.requestRender();
  }

  private toggleFolder(path: string): void {
    this.controller.setExpanded(path, !this.controller.isExpanded(path));
    this.requestRender();
  }

  private collapseAll(): void {
    this.controller.data.expanded = {};
    void this.controller.save();
    this.requestRender();
  }

  /** Open the path to the folder the library shows, and scroll it into view. */
  private revealSelected(): void {
    const selected = this.controller.selectedFolderPath;
    if (!selected) return;
    if (this.filterText) this.setFilter("");
    if (openAncestors(this.controller.data.expanded, selected)) void this.controller.save();
    this.collapsedSections.delete("all");
    this.render();
    const row = Array.from(this.listEl.querySelectorAll<HTMLElement>(".fs-in-tree")).find(
      (candidate) => candidate.getAttribute("data-path") === selected,
    );
    row?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  // --- Making and renaming folders ------------------------------------------------------------------------

  private startInlineCreate(parent: string): void {
    closeMenus();
    if (this.filterText) {
      this.filterText = "";
      this.filterInput.value = "";
      this.paneEl.removeClass("has-filter");
    }
    this.collapsedSections.delete("all");
    if (parent) this.controller.setExpanded(parent, true);
    this.inlineCreate = {
      parentPath: parent,
      color: this.controller.data.autoColorNewFolders ? randomPaletteColor() : null,
    };
    this.editing = true;
    this.render();
    const input = this.listEl.querySelector<HTMLInputElement>(".fs-inline-row input");
    if (input) {
      input.focus();
      this.keepVisible(input);
    }
  }

  /**
   * On a phone the keyboard covers the lower half of the screen: scroll the
   * list so `field` stays above it, until the field loses focus.
   */
  private keepVisible(field: HTMLElement): void {
    this.stopKeyboardWatch?.();
    this.paneEl.addClass("is-typing");
    const viewport = activeWindow.visualViewport;
    let stop = (): void => {};
    const scrollIntoSight = (): void => {
      if (!field.isConnected) {
        stop();
        return;
      }
      const bottom = viewport ? viewport.offsetTop + viewport.height : activeWindow.innerHeight;
      const overshoot = field.getBoundingClientRect().bottom - (bottom - 24);
      if (overshoot > 0) this.listEl.scrollTop += overshoot;
    };
    viewport?.addEventListener("resize", scrollIntoSight);
    viewport?.addEventListener("scroll", scrollIntoSight);
    const timers = [120, 350, 700].map((delay) => window.setTimeout(scrollIntoSight, delay));
    let stopped = false;
    stop = () => {
      if (stopped) return;
      stopped = true;
      viewport?.removeEventListener("resize", scrollIntoSight);
      viewport?.removeEventListener("scroll", scrollIntoSight);
      timers.forEach((timer) => window.clearTimeout(timer));
      field.removeEventListener("blur", stop);
      const pane = this.paneEl;
      window.setTimeout(() => {
        if (!this.stopKeyboardWatch) pane.removeClass("is-typing");
      }, 500);
      if (activeWindow.scrollY !== 0) activeWindow.scrollTo(0, 0);
      if (this.stopKeyboardWatch === stop) this.stopKeyboardWatch = null;
    };
    field.addEventListener("blur", stop);
    this.stopKeyboardWatch = stop;
  }

  private async createFolderAt(parent: string, name: string, color: string | null): Promise<void> {
    if (hasPathSeparator(name)) {
      new Notice(t("view.folders.nameInvalid"));
      this.render();
      return;
    }
    const path = normalizePath(childPath(parent, name));
    try {
      await this.app.vault.createFolder(path);
      if (color) this.controller.setFolderColor(path, color);
      void this.controller.openFolderInLibrary(path);
    } catch (error) {
      new Notice(t("view.folders.createFailed", { name, reason: errorMessage(error) }));
    }
    this.render();
  }

  /** Turn the folder's name on its row into a field. */
  private startRename(folder: TFolder, row: HTMLElement): void {
    const title = row.querySelector(".fs-title");
    if (!title) return;
    row.draggable = false;
    const input = createEl("input");
    input.type = "text";
    input.className = "fs-inline-input";
    input.value = folder.name;
    input.setAttribute("aria-label", t("view.folders.folderName"));
    input.addEventListener("click", (event) => event.stopPropagation());
    title.replaceWith(input);
    this.editing = true;
    input.focus();
    input.select();
    this.keepVisible(input);
    let done = false;
    const finish = async (apply: boolean): Promise<void> => {
      if (done) return;
      if (this.rendering) {
        done = true;
        this.editing = false;
        return;
      }
      done = true;
      const name = input.value.trim();
      if (apply && name && name !== folder.name) {
        if (hasPathSeparator(name)) {
          new Notice(t("view.folders.nameInvalid"));
        } else {
          const target = normalizePath(childPath(parentPath(folder.path), name));
          try {
            await this.app.fileManager.renameFile(folder, target);
          } catch (error) {
            new Notice(t("view.folders.renameFailed", { reason: errorMessage(error) }));
          }
        }
      }
      this.endEditing();
    };
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.isComposing) return;
      if (event.key === "Enter") {
        event.preventDefault();
        void finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        void finish(false);
      }
    });
    input.addEventListener("blur", () => {
      void finish(true);
    });
  }

  private menuActions(folder: TFolder): { rename: () => void; newSubfolder: () => void } {
    return {
      rename: () => this.renameFolderRow(folder),
      newSubfolder: () => this.startInlineCreate(folder.path),
    };
  }

  /** Rename in place when the folder is on screen in the tree, else in a window. */
  private renameFolderRow(folder: TFolder): void {
    const row = Array.from(this.listEl.querySelectorAll<HTMLElement>(".fs-item.fs-in-tree")).find(
      (candidate) => candidate.getAttribute("data-path") === folder.path,
    );
    if (row) this.startRename(folder, row);
    else promptRenameFolder(this.app, folder);
  }

  /** On: every folder shows its ⋯ button and count, as on a touch screen. */
  private setEditMode(on: boolean): void {
    this.editMode = on;
    this.paneEl.toggleClass("is-edit", on);
    this.editToggle.setAttribute("aria-pressed", String(on));
    const label = on ? t("common.done") : t("view.folders.editMode");
    this.editToggle.setAttribute("aria-label", label);
    this.editToggle.setAttribute("title", label);
    setIcon(this.editToggle, on ? "check" : "pencil");
  }

  // --- Pressing, dragging and dropping ------------------------------------------------------------------------

  /** A long press (a hold and drag on a touch screen) on a row opens its menu. */
  private attachPress(row: HTMLElement, entry: TreeEntry): void {
    const open = (at: { x: number; y: number }): void => {
      openFileMenu(this.controller, entry, this.leaf, at, {
        actions: entry instanceof TFolder ? this.menuActions(entry) : undefined,
      });
    };
    if (Platform.isMobile) {
      attachTouchDrag(row, { controller: this.controller, path: entry.path, onMenu: open });
    } else {
      onLongPress(row, open);
    }
  }

  private onDragStart(event: DragEvent, path: string): void {
    this.dragPath = path;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", path);
    }
  }

  private onDragEnd(): void {
    this.dragPath = null;
    this.paneEl
      .querySelectorAll(".is-drop-target")
      .forEach((el) => el.classList.remove("is-drop-target"));
  }

  /** A drag that began outside this view (the library's cards) carries a path as text. */
  private isForeignDrag(event: DragEvent): boolean {
    return (
      this.dragPath === null &&
      !!event.dataTransfer &&
      Array.from(event.dataTransfer.types).includes("text/plain")
    );
  }

  private canAcceptDrop(event: DragEvent, target: string): boolean {
    return this.dragPath !== null
      ? this.controller.isValidMove(this.dragPath, target)
      : this.isForeignDrag(event);
  }

  private dropSource(event: DragEvent): string | null {
    if (this.dragPath !== null) return this.dragPath;
    return event.dataTransfer?.getData("text/plain").trim() || null;
  }

  /** Dropping on the header or the empty part of the list moves the item to the vault's root. */
  private attachRootDropZone(zone: HTMLElement): void {
    this.registerDomEvent(zone, "dragover", (event) => {
      if (!this.canAcceptDrop(event, "")) return;
      if (event.target instanceof Element && event.target.closest(".fs-item")) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      this.listEl.addClass("is-drop-target");
    });
    this.registerDomEvent(zone, "dragleave", (event) => {
      const next = event.relatedTarget as Node | null;
      if (!next || !zone.contains(next)) this.listEl.removeClass("is-drop-target");
    });
    this.registerDomEvent(zone, "drop", (event) => {
      if (event.target instanceof Element && event.target.closest(".fs-item")) return;
      const source = this.dropSource(event);
      if (!source) return;
      event.preventDefault();
      this.listEl.removeClass("is-drop-target");
      this.onDragEnd();
      void this.controller.moveItem(source, "").then(() => this.render());
    });
  }
}
