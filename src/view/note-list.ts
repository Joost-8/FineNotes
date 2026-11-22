/**
 * The note list beside a text note, as Apple Notes shows it on an iPad: a
 * search field at its top, and under it the notes of the note's folder, or
 * of a tag or a smart folder picked from the title's menu. Typing searches
 * every text note and notebook (the folder's first), as Apple's sidebar
 * search does; the bar's search button opens the list with the field
 * focused. It wears the notebook's page sidebar look (`goodobsidian-
 * pagesidebar` and its head), and slides over the note on a narrow pane.
 */

import { type App, Menu, TFile, setIcon } from "obsidian";
import { VIEW_TYPE_NOTE } from "../constants";
import { t } from "../i18n/translate";
import { placeholderEntry, whenText } from "../model/library";
import {
  type NoteScope,
  type SearchRow,
  type SmartFolder,
  notesIn,
  scopeOf,
  searchRows,
  tagCounts,
} from "../model/note-organise";
import type { TextNote } from "../model/text-note";
import { isTextNoteName, stripTextNoteSuffix } from "../model/text-note-file";
import { type LibraryBook, searchLibrary } from "../search/library-search";
import { DialogKeyboard } from "./dialog-keyboard";
import { listedNotes } from "./note-organiser";
import { openSearchHit, vaultSearchBooks } from "./vault-search-modal";

const OPEN_KEY = "finenotes-note-list-open";
const SCOPE_KEY = "finenotes-note-list-scope";
/** How long typing must pause before the text is searched, ms: titles answer at once. */
const SEARCH_DELAY_MS = 120;

export interface NoteListHost {
  app: App;
  /** The note shown now. */
  file(): TFile | null;
  /** The note as it is now, saved or not, for searching it. */
  note(): TextNote | null;
  smartFolders(): readonly SmartFolder[];
  /** The list opened or closed: the view makes room for it. */
  toggled(open: boolean): void;
}

function folderOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? "" : path.slice(0, cut);
}

export class NoteList {
  readonly el: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly field: HTMLInputElement;
  private readonly rowsEl: HTMLElement;
  private readonly keyboard: DialogKeyboard;
  private scope: NoteScope | null;
  private books: LibraryBook[] | null = null;
  private loading: Promise<void> | null = null;
  private timer = 0;

  constructor(
    parent: HTMLElement,
    private readonly host: NoteListHost,
  ) {
    const app = host.app;
    this.el = parent.createDiv({ cls: "goodobsidian-pagesidebar finenotes-note-list is-hidden" });
    // A finger on the list scrolls it; Obsidian's swipes stay out.
    this.el.dataset.ignoreSwipe = "true";
    let stored: unknown = null;
    try {
      const raw: unknown = app.loadLocalStorage(SCOPE_KEY);
      stored = typeof raw === "string" ? JSON.parse(raw) : null;
    } catch {
      stored = null;
    }
    // A folder scope follows the note; only a tag or a smart folder is kept.
    const kept = scopeOf(stored);
    this.scope = kept?.kind === "folder" ? null : kept;

    const top = this.el.createDiv({ cls: "goodobsidian-pagesidebar-top" });
    const head = top.createDiv({ cls: "goodobsidian-pagesidebar-head" });
    const pick = head.createEl("button", {
      cls: "clickable-icon finenotes-note-list-scope",
      attr: { type: "button", "aria-haspopup": "menu" },
    });
    this.titleEl = pick.createSpan({ cls: "goodobsidian-pagesidebar-title" });
    setIcon(pick.createSpan({ cls: "finenotes-note-list-caret" }), "chevron-down");
    pick.addEventListener("click", (event) => this.openScopeMenu(event));
    const close = head.createEl("button", {
      cls: "clickable-icon goodobsidian-pagesidebar-close",
      attr: { type: "button", "aria-label": t("common.close") },
    });
    setIcon(close, "x");
    close.addEventListener("click", () => this.setOpen(false));

    const search = top.createDiv({ cls: "finenotes-note-list-search" });
    setIcon(search.createSpan(), "search");
    this.field = search.createEl("input", {
      attr: {
        type: "search",
        placeholder: t("notebooks.note.searchPlaceholder"),
        "aria-label": t("notebooks.note.search"),
        enterkeyhint: "search",
        autocomplete: "off",
      },
    });
    this.field.addEventListener("input", () => this.paint());
    this.field.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.field.value !== "") {
        event.preventDefault();
        this.field.value = "";
        this.paint();
      }
    });
    // A panel that cannot rise: the keyboard only pads its foot (and Obsidian's cap is lifted).
    this.keyboard = new DialogKeyboard(this.el, { pad: true });
    this.keyboard.watch(this.field, search);
    this.rowsEl = this.el.createDiv({ cls: "finenotes-note-list-rows" });
    if (app.loadLocalStorage(OPEN_KEY) === "1") this.setOpen(true, false);
  }

  get isOpen(): boolean {
    return !this.el.hasClass("is-hidden");
  }

  setOpen(open: boolean, remember = true): void {
    this.el.toggleClass("is-hidden", !open);
    if (remember) this.host.app.saveLocalStorage(OPEN_KEY, open ? "1" : "0");
    if (!open) {
      this.field.blur();
      this.keyboard.end();
    }
    this.host.toggled(open);
    if (open) this.paint();
  }

  /** Open with the search field focused, ready to type (the bar's search button). */
  search(): void {
    if (!this.isOpen) this.setOpen(true);
    this.books = null;
    this.field.focus();
    this.field.select();
    this.paint();
  }

  /** The vault changed, or the note did: list again (the text is read again at the next search). */
  refresh(): void {
    this.books = null;
    if (this.isOpen) this.paint();
  }

  destroy(): void {
    this.el.win.clearTimeout(this.timer);
    this.keyboard.end();
  }

  private currentScope(): NoteScope {
    if (this.scope) return this.scope;
    return { kind: "folder", folder: folderOf(this.host.file()?.path ?? "") };
  }

  private scopeName(scope: NoteScope): string {
    if (scope.kind === "tag") return `#${scope.tag}`;
    if (scope.kind === "smart")
      return this.host.smartFolders().find((f) => f.id === scope.id)?.name ?? "";
    return scope.folder === ""
      ? t("notebooks.organise.root")
      : scope.folder.slice(scope.folder.lastIndexOf("/") + 1);
  }

  private setScope(scope: NoteScope | null): void {
    this.scope = scope;
    this.host.app.saveLocalStorage(SCOPE_KEY, JSON.stringify(scope));
    this.field.value = "";
    this.paint();
  }

  /** The title's menu: this folder, the smart folders, the tags; the current one ticked. */
  private openScopeMenu(event: MouseEvent): void {
    const now = this.currentScope();
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle(t("notebooks.organise.thisFolder"))
        .setIcon("folder")
        .setChecked(now.kind === "folder")
        .onClick(() => this.setScope(null)),
    );
    const smart = this.host.smartFolders();
    if (smart.length > 0) {
      menu.addSeparator();
      for (const folder of smart) {
        menu.addItem((item) =>
          item
            .setTitle(folder.name)
            .setIcon("folder-cog")
            .setChecked(now.kind === "smart" && now.id === folder.id)
            .onClick(() => this.setScope({ kind: "smart", id: folder.id })),
        );
      }
    }
    const tags = tagCounts(listedNotes(this.host.app));
    if (tags.length > 0) {
      menu.addSeparator();
      for (const { tag } of tags) {
        menu.addItem((item) =>
          item
            .setTitle(`#${tag}`)
            .setIcon("hash")
            .setChecked(now.kind === "tag" && now.tag === tag)
            .onClick(() => this.setScope({ kind: "tag", tag })),
        );
      }
    }
    menu.showAtMouseEvent(event);
  }

  private paint(): void {
    if (!this.isOpen) return;
    const scope = this.currentScope();
    this.titleEl.setText(this.scopeName(scope));
    const query = this.field.value.trim();
    if (query !== "") {
      this.paintSearch(query);
      return;
    }
    this.rowsEl.empty();
    const notes = notesIn(listedNotes(this.host.app), scope, this.host.smartFolders());
    const current = this.host.file()?.path;
    if (notes.length === 0) {
      this.rowsEl.createDiv({
        cls: "finenotes-note-list-empty",
        text: t("notebooks.organise.noNotes"),
      });
      return;
    }
    const now = Date.now();
    for (const note of notes) {
      const row = this.row(note.title, whenText(note.edited, now), note.path === current);
      row.addEventListener("click", () => this.openNote(note.path));
    }
  }

  /** Titles answer at once; the text found follows when typing pauses. */
  private paintSearch(query: string): void {
    const app = this.host.app;
    const items = app.vault
      .getFiles()
      .filter((f) => isTextNoteName(f.name) || f.name.endsWith(".notebook.md"))
      .map((f) => ({
        path: f.path,
        title: isTextNoteName(f.name)
          ? stripTextNoteSuffix(f.name)
          : placeholderEntry(f.path, 0).title,
      }));
    const folder = folderOf(this.host.file()?.path ?? "");
    const draw = (): void => {
      if (this.field.value.trim() !== query) return;
      const hits = this.books ? searchLibrary(this.books, query, 80) : [];
      this.drawResults(searchRows(items, hits, query, folder), query);
    };
    draw();
    this.el.win.clearTimeout(this.timer);
    this.timer = this.el.win.setTimeout(() => {
      if (this.books) draw();
      else void this.loadBooks().then(draw);
    }, SEARCH_DELAY_MS);
  }

  private loadBooks(): Promise<void> {
    if (this.loading) return this.loading;
    const file = this.host.file();
    const note = this.host.note();
    this.loading = vaultSearchBooks(this.host.app, file && note ? { path: file.path, note } : null)
      .then(
        (books) => {
          this.books = books;
        },
        () => {
          // Nothing kept to search on this device: titles still answer.
          this.books = [];
        },
      )
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }

  private drawResults(rows: readonly SearchRow[], query: string): void {
    this.rowsEl.empty();
    if (rows.length === 0) {
      this.rowsEl.createDiv({
        cls: "finenotes-note-list-empty",
        text: t("notebooks.note.searchNone"),
      });
      return;
    }
    const current = this.host.file()?.path;
    for (const result of rows) {
      const row = this.row(result.title, "", result.path === current);
      if (result.snippet) {
        const line = row.createDiv({ cls: "finenotes-note-list-snippet" });
        line.appendText(result.snippet.before);
        line.createSpan({ cls: "suggestion-highlight", text: result.snippet.match });
        line.appendText(result.snippet.after);
      }
      row.addEventListener("click", () => {
        openSearchHit(
          this.host.app,
          {
            path: result.path,
            pageIndex: result.pageIndex,
            phrase: false,
            near: false,
            count: 1,
            snippets: [],
          },
          query,
        );
      });
    }
  }

  /** A row: the note's name, when it was edited, the open note an accent fill. */
  private row(title: string, when: string, current: boolean): HTMLElement {
    const row = this.rowsEl.createEl("button", {
      cls: "clickable-icon finenotes-note-list-row",
      attr: { type: "button", "aria-current": current ? "page" : "false" },
    });
    row.toggleClass("is-current", current);
    row.createDiv({ cls: "finenotes-note-list-name", text: title || t("notebooks.note.untitled") });
    if (when) row.createDiv({ cls: "finenotes-note-list-when", text: when });
    return row;
  }

  /** Open a note in this tab, as Apple's list does. */
  private openNote(path: string): void {
    const app = this.host.app;
    const file = app.vault.getFileByPath(path);
    if (!(file instanceof TFile) || file.path === this.host.file()?.path) return;
    const leaf = app.workspace
      .getLeavesOfType(VIEW_TYPE_NOTE)
      .find((l) => l.view.containerEl.contains(this.el));
    void (leaf ?? app.workspace.getLeaf(false)).setViewState({
      type: VIEW_TYPE_NOTE,
      active: true,
      state: { file: file.path },
    });
  }
}
