/**
 * The list beside a text note, as Apple Notes shows it on an iPad: the
 * notes of the note's folder, newest first; and while the bar's search
 * field holds words, what search found in every text note and notebook,
 * under "Search · Found N notes", in sections (Top hits, Notes, Notebooks).
 * Each found row is its title (the words in the accent colour), a short
 * date and the line that holds the words, and its folder.
 *
 * It wears the notebook's page sidebar look (`goodobsidian-pagesidebar`),
 * and lies over the note on a narrow pane. The rules are pure, in
 * `model/note-listing.ts`; the text it searches is the note search's
 * (`vaultSearchBooks`, `searchLibrary`), so a word is found here as on Home.
 */

import { type App, Menu, TFile, setIcon } from "obsidian";
import { VIEW_TYPE_NOTE } from "../constants";
import { localeTag, t, tn } from "../i18n/translate";
import { placeholderEntry, whenText } from "../model/library";
import {
  type Findable,
  type FoundRow,
  type ShowKind,
  folderOf,
  foundSections,
  leadOf,
  markSpans,
  notesIn,
  searchRows,
  shortWhen,
} from "../model/note-listing";
import type { TextNote } from "../model/text-note";
import { isTextNoteName, stripTextNoteSuffix } from "../model/text-note-file";
import { type LibraryBook, searchLibrary } from "../search/library-search";
import { openSearchHit, vaultSearchBooks } from "./vault-search-modal";

const OPEN_KEY = "finenotes-note-list-open";
/** What search looks through on this device (the ⋯ menu). */
const SEARCH_KIND_KEY = "finenotes-note-search-kind";
/** How long typing must pause before the text is searched, ms: titles answer at once. */
const SEARCH_DELAY_MS = 120;
/** The most text hits searched for. */
const MAX_HITS = 80;
/** Characters of a found line kept before the words, so the words still show. */
const SNIPPET_LEAD = 14;

export interface NoteListHost {
  app: App;
  /** The note shown now. */
  file(): TFile | null;
  /** The note as it is now, saved or not, for searching it. */
  note(): TextNote | null;
  /** The list opened or closed: the view makes room for it. */
  toggled(open: boolean): void;
  /** The list's own toggle was used mid-search: empty the bar's field. */
  clearSearch(): void;
}

export class NoteList {
  readonly el: HTMLElement;
  private readonly headEl: HTMLElement;
  private readonly rowsEl: HTMLElement;
  private query = "";
  /** The list was opened by a search, and closes again when the search ends. */
  private openedForSearch = false;
  private kind: ShowKind;
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
    const kind: unknown = app.loadLocalStorage(SEARCH_KIND_KEY);
    this.kind = kind === "notes" || kind === "notebooks" ? kind : "all";
    this.headEl = this.el.createDiv({ cls: "finenotes-note-list-head" });
    this.rowsEl = this.el.createDiv({ cls: "finenotes-note-list-rows" });
    if (app.loadLocalStorage(OPEN_KEY) === "1") this.setOpen(true, false);
  }

  get isOpen(): boolean {
    return !this.el.hasClass("is-hidden");
  }

  /** Open or close the list; `remember` keeps the choice for the next note. */
  setOpen(open: boolean, remember = true): void {
    this.el.toggleClass("is-hidden", !open);
    if (remember) {
      this.host.app.saveLocalStorage(OPEN_KEY, open ? "1" : "0");
      this.openedForSearch = false;
    }
    this.host.toggled(open);
    if (open) this.paint();
  }

  /**
   * What the bar's search field holds. Words open the list on the results
   * (and it closes again when they are gone, if it was closed before);
   * none show the folder's notes again.
   */
  setQuery(query: string): void {
    const was = this.query;
    this.query = query.trim();
    if (this.query !== "" && was === "") this.books = null;
    if (this.query !== "" && !this.isOpen) {
      this.setOpen(true, false);
      this.openedForSearch = true;
      return;
    }
    if (this.query === "" && this.openedForSearch) {
      this.openedForSearch = false;
      this.setOpen(false, false);
      return;
    }
    this.paint();
  }

  /** The vault changed, or the note did: list again (the text is read again at the next search). */
  refresh(): void {
    this.books = null;
    if (this.isOpen) this.paint();
  }

  destroy(): void {
    this.el.win.clearTimeout(this.timer);
  }

  /** The head: the list's toggle, the title, and while searching the ⋯ of search's choices. */
  private paintHead(title: string, subtitle?: string): void {
    const head = this.headEl;
    head.empty();
    const toggle = head.createEl("button", {
      cls: "clickable-icon finenotes-note-list-toggle",
      attr: { type: "button", "aria-label": t("notebooks.noteList.toggle") },
    });
    setIcon(toggle, "panel-left");
    toggle.addEventListener("click", () => {
      if (this.query !== "") {
        this.openedForSearch = false;
        this.query = "";
        this.host.clearSearch();
      }
      this.setOpen(false);
    });
    const titles = head.createDiv({ cls: "finenotes-note-list-titles" });
    titles.createDiv({ cls: "finenotes-note-list-title", text: title });
    if (subtitle !== undefined)
      titles.createDiv({ cls: "finenotes-note-list-subtitle", text: subtitle });
    if (subtitle === undefined) return;
    const more = head.createEl("button", {
      cls: "clickable-icon finenotes-note-list-more",
      attr: {
        type: "button",
        "aria-label": t("notebooks.noteSearch.options"),
        "aria-haspopup": "menu",
      },
    });
    setIcon(more, "more-horizontal");
    more.addEventListener("click", (event) => this.openOptions(event));
  }

  /** The ⋯ menu: what search looks through, as Home's Show filter offers it. */
  private openOptions(event: MouseEvent): void {
    const menu = new Menu();
    for (const [kind, label, icon] of [
      ["all", "notebooks.home.showAll", "layers"],
      ["notes", "notebooks.home.showNotes", "notepad-text"],
      ["notebooks", "notebooks.home.onlyNotebooks", "notebook"],
    ] as const) {
      menu.addItem((item) =>
        item
          .setTitle(t(label))
          .setIcon(icon)
          .setChecked(this.kind === kind)
          .onClick(() => {
            this.kind = kind;
            this.host.app.saveLocalStorage(SEARCH_KIND_KEY, kind);
            this.paint();
          }),
      );
    }
    menu.showAtMouseEvent(event);
  }

  private paint(): void {
    if (!this.isOpen) return;
    if (this.query !== "") {
      this.paintSearch(this.query);
      return;
    }
    const folder = folderOf(this.host.file()?.path ?? "");
    this.paintHead(
      folder === "" ? this.host.app.vault.getName() : folder.slice(folder.lastIndexOf("/") + 1),
    );
    this.rowsEl.empty();
    const app = this.host.app;
    const notes = notesIn(
      app.vault
        .getFiles()
        .filter((file) => isTextNoteName(file.name))
        .map((file) => ({
          path: file.path,
          title: stripTextNoteSuffix(file.name),
          edited: file.stat.mtime,
        })),
      folder,
    );
    if (notes.length === 0) {
      this.rowsEl.createDiv({
        cls: "finenotes-note-list-empty",
        text: t("notebooks.noteList.empty"),
      });
      return;
    }
    const current = this.host.file()?.path;
    const now = Date.now();
    for (const note of notes) {
      const row = this.row(note.path === current);
      row.createDiv({
        cls: "finenotes-note-list-name",
        text: note.title || t("notebooks.note.untitled"),
      });
      row.createDiv({ cls: "finenotes-note-list-when", text: whenText(note.edited, now) });
      row.addEventListener("click", () => this.openNote(note.path));
    }
  }

  /** Every note and notebook search may show, with a note's first lines once its text is read. */
  private findables(): Findable[] {
    const leads = new Map<string, string>();
    for (const book of this.books ?? []) {
      const text = book.pages[0]?.sources[0]?.text;
      if (text) leads.set(book.path, text);
    }
    return this.host.app.vault
      .getFiles()
      .filter((f) => {
        const note = isTextNoteName(f.name);
        const book = !note && f.name.endsWith(".notebook.md");
        return this.kind === "notes" ? note : this.kind === "notebooks" ? book : note || book;
      })
      .map((f) => {
        const note = isTextNoteName(f.name);
        const title = note ? stripTextNoteSuffix(f.name) : placeholderEntry(f.path, 0).title;
        const lead = leads.get(f.path);
        return {
          path: f.path,
          title,
          edited: f.stat.mtime,
          ...(note ? {} : { notebook: true }),
          ...(lead ? { lead: leadOf(lead, title) } : {}),
        };
      });
  }

  /** Titles answer at once; the text found follows when typing pauses. */
  private paintSearch(query: string): void {
    const folder = folderOf(this.host.file()?.path ?? "");
    const draw = (): void => {
      if (this.query !== query) return;
      const hits = this.books ? searchLibrary(this.books, query, MAX_HITS) : [];
      this.drawResults(searchRows(this.findables(), hits, query, folder), query);
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

  private drawResults(rows: readonly FoundRow[], query: string): void {
    const sections = foundSections(rows);
    this.paintHead(
      t("notebooks.noteSearch.title"),
      tn("notebooks.noteSearch.found", sections.total),
    );
    this.rowsEl.empty();
    if (rows.length === 0) {
      this.rowsEl.createDiv({
        cls: "finenotes-note-list-empty",
        text: t("notebooks.note.searchNone"),
      });
      return;
    }
    const section = (name: string, count: string, found: readonly FoundRow[]): void => {
      if (found.length === 0) return;
      const head = this.rowsEl.createDiv({ cls: "finenotes-note-list-section" });
      head.createSpan({ cls: "finenotes-note-list-section-name", text: name });
      head.createSpan({ cls: "finenotes-note-list-section-count", text: count });
      for (const result of found) this.foundRow(result, query);
    };
    section(
      t("notebooks.noteSearch.topHits"),
      tn("notebooks.noteSearch.results", sections.top.length),
      sections.top,
    );
    section(
      t("notebooks.noteSearch.notes"),
      tn("notebooks.noteSearch.count", sections.notes.length),
      sections.notes,
    );
    section(
      t("notebooks.noteSearch.notebooks"),
      tn("notebooks.noteSearch.count", sections.notebooks.length),
      sections.notebooks,
    );
  }

  /** A found row: its title, its date and the line that holds the words, its folder. */
  private foundRow(result: FoundRow, query: string): void {
    const row = this.row(result.path === this.host.file()?.path);
    row.addClass("is-found");
    const name = row.createDiv({ cls: "finenotes-note-list-name" });
    this.marked(name, result.title || t("notebooks.note.untitled"), query);
    const line = row.createDiv({ cls: "finenotes-note-list-line" });
    line.createSpan({
      cls: "finenotes-note-list-when",
      text: shortWhen(result.edited, Date.now(), localeTag()),
    });
    const snippet = result.snippet;
    if (snippet) {
      const text = line.createSpan({ cls: "finenotes-note-list-snippet" });
      const before =
        snippet.match !== "" && snippet.before.length > SNIPPET_LEAD
          ? `…${snippet.before.slice(-SNIPPET_LEAD).trimStart()}`
          : snippet.before;
      text.appendText(before);
      if (snippet.match) text.createSpan({ cls: "finenotes-note-list-hit", text: snippet.match });
      text.appendText(snippet.after);
    }
    const where = row.createDiv({ cls: "finenotes-note-list-folder" });
    setIcon(where.createSpan({ cls: "finenotes-note-list-folder-icon" }), "folder");
    const folder = folderOf(result.path);
    where.createSpan({
      text:
        folder === "" ? this.host.app.vault.getName() : folder.slice(folder.lastIndexOf("/") + 1),
    });
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

  /** `text` with the query's words in the accent colour. */
  private marked(el: HTMLElement, text: string, query: string): void {
    for (const span of markSpans(text, query)) {
      if (span.hit) el.createSpan({ cls: "finenotes-note-list-hit", text: span.text });
      else el.appendText(span.text);
    }
  }

  /** A row, the open note an accent fill. */
  private row(current: boolean): HTMLElement {
    const row = this.rowsEl.createEl("button", {
      cls: "clickable-icon finenotes-note-list-row",
      attr: { type: "button", "aria-current": current ? "page" : "false" },
    });
    row.toggleClass("is-current", current);
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
