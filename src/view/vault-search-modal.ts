/**
 * A text note's search: every text note and notebook in the vault, the
 * note in use first. It is the notebook's search list (`search-modal.ts`,
 * Obsidian's own quick-switcher list, its field at the top of the screen
 * where the iPad keyboard cannot cover it), with each result headed by the
 * note or notebook it is in; Home's search finds the pages
 * (`library-search.ts`), so a word is found here exactly as it is there.
 *
 * - Text notes are read from their files (`note-search.ts`): their typed
 *   text and what the device read their handwriting as. The note in use is
 *   searched as it is now, saved or not.
 * - Notebooks are searched in what Home keeps on this device
 *   (`search-store.ts`): their transcriptions and text boxes, Grape's
 *   readings and their PDFs' printed text. A notebook Home has never read
 *   is not found until Home has been opened once.
 */

import { type App, SuggestModal, TFile, type WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE_INK } from "../constants";
import { t, tn } from "../i18n/translate";
import { placeholderEntry } from "../model/library";
import type { TextNote } from "../model/text-note";
import { isTextNoteName, parseNoteFile, stripTextNoteSuffix } from "../model/text-note-file";
import {
  type LibraryBook,
  type LibraryHit,
  assemblePages,
  searchLibrary,
} from "../search/library-search";
import { currentFirst, notePageText } from "../search/note-search";
import type { PageText } from "../search/notebook-search";
import { DialogKeyboard } from "./dialog-keyboard";
import {
  loadNotebookTexts,
  loadPrinted,
  loadReadings,
  printedKey,
  readingKey,
  vaultKeyOf,
} from "./search-store";

/** The most results the list shows. */
const MAX_HITS = 80;

/** Each text note's searchable text, by path, while its file is unchanged. */
const noteTexts = new Map<string, { stamp: string; page: PageText }>();

function stampOf(file: TFile): string {
  return `${file.stat.mtime}:${file.stat.size}`;
}

/** Every text note but `skip`, edited last first, as search sees it. */
async function noteBooks(app: App, skip: string | null): Promise<LibraryBook[]> {
  const files = app.vault
    .getFiles()
    .filter((file) => isTextNoteName(file.name) && file.path !== skip)
    .sort((a, b) => b.stat.mtime - a.stat.mtime);
  const books: LibraryBook[] = [];
  for (const file of files) {
    const stamp = stampOf(file);
    let kept = noteTexts.get(file.path);
    if (kept?.stamp !== stamp) {
      try {
        let n = 0;
        // The strokes are not needed, and unpacking them is the slow part.
        const note = parseNoteFile(await app.vault.cachedRead(file), () => `s${++n}`, {
          readingsOnly: true,
        }).note;
        kept = { stamp, page: notePageText(note) };
        noteTexts.set(file.path, kept);
      } catch {
        continue;
      }
    }
    books.push({ path: file.path, pages: [kept.page] });
  }
  return books;
}

/** Every notebook Home has read, edited last first, with what this device worked out about it. */
async function notebookBooks(app: App): Promise<LibraryBook[]> {
  const vault = vaultKeyOf(app);
  const [texts, readings, printed] = await Promise.all([
    loadNotebookTexts(vault),
    loadReadings(vault),
    loadPrinted(vault),
  ]);
  const books: Array<LibraryBook & { mtime: number }> = [];
  for (const [path, record] of texts) {
    const file = app.vault.getFileByPath(path);
    if (!file) continue;
    const pages = assemblePages(record.pages, {
      reading: (page) => {
        const kept = readings.get(readingKey(path, page.id));
        return kept && kept.hash === page.hash ? kept.text : undefined;
      },
      printed: (pdf) => {
        const kept = printed.get(printedKey(pdf.path, pdf.page));
        const source = kept ? app.vault.getFileByPath(pdf.path) : null;
        return kept && source && kept.stamp === stampOf(source) ? kept.text : undefined;
      },
    });
    books.push({ path, pages, mtime: file.stat.mtime });
  }
  return books.sort((a, b) => b.mtime - a.mtime);
}

/** Everything a text note's search looks through, the note in use first. */
export async function vaultSearchBooks(
  app: App,
  current: { path: string; note: TextNote } | null,
): Promise<LibraryBook[]> {
  const own = current ? [{ path: current.path, pages: [notePageText(current.note)] }] : [];
  const [notes, notebooks] = await Promise.all([
    noteBooks(app, current?.path ?? null),
    // What this device kept of its notebooks may be out of reach (no storage): the notes still answer.
    notebookBooks(app).catch((): LibraryBook[] => []),
  ]);
  return [...own, ...notes, ...notebooks];
}

/**
 * Open a result: its tab when it is open already, else in this tab (as a
 * link does), with what to light there: a notebook's page, a note's words.
 */
export function openSearchHit(app: App, hit: LibraryHit, query: string): void {
  const file = app.vault.getFileByPath(hit.path);
  if (!(file instanceof TFile)) return;
  const note = isTextNoteName(file.name);
  let existing: WorkspaceLeaf | null = null;
  app.workspace.iterateAllLeaves((leaf) => {
    if (!note && leaf.view.getViewType() !== VIEW_TYPE_INK) return;
    if ((leaf.view as { file?: TFile | null }).file?.path === hit.path) existing = leaf;
  });
  const state = note ? { search: query } : { pageIndex: hit.pageIndex, search: query };
  if (existing) {
    const leaf: WorkspaceLeaf = existing;
    void app.workspace.revealLeaf(leaf);
    leaf.setEphemeralState(state);
    return;
  }
  void app.workspace.getLeaf(false).openFile(file, { eState: state });
}

function kindLabel(kind: LibraryHit["snippets"][number]["kind"]): string {
  if (kind === "handwriting") return t("view.search.kindHandwriting");
  if (kind === "text") return t("view.search.kindText");
  return t("view.search.kindPdf");
}

export class VaultSearchModal extends SuggestModal<LibraryHit> {
  private readonly keyboard: DialogKeyboard;

  constructor(
    app: App,
    private readonly books: readonly LibraryBook[],
    private readonly current: string | null,
    private readonly initial: string,
    private readonly onQuery: (query: string) => void,
  ) {
    super(app);
    this.keyboard = new DialogKeyboard(this.modalEl);
    // The notebook search's look, rows and all (styles.css).
    this.modalEl.addClass("goodobsidian-search-modal");
    this.limit = MAX_HITS;
    this.setPlaceholder(t("notebooks.note.searchPlaceholder"));
    this.emptyStateText = t("notebooks.note.searchHint");
  }

  override async onOpen(): Promise<void> {
    await super.onOpen();
    this.keyboard.start(this.inputEl);
    if (!this.initial) return;
    // Opening empties the field; write the last query after, selected so typing replaces it.
    this.inputEl.value = this.initial;
    this.inputEl.dispatchEvent(new Event("input"));
    this.inputEl.select();
  }

  override onClose(): void {
    super.onClose();
    this.keyboard.end();
  }

  getSuggestions(query: string): LibraryHit[] {
    this.onQuery(query);
    const hits = currentFirst(searchLibrary(this.books, query, MAX_HITS), this.current);
    this.emptyStateText =
      query.trim() === "" ? t("notebooks.note.searchHint") : t("notebooks.note.searchNone");
    return hits;
  }

  renderSuggestion(hit: LibraryHit, el: HTMLElement): void {
    el.addClass("goodobsidian-search-hit");
    const name = hit.path.slice(hit.path.lastIndexOf("/") + 1);
    const note = isTextNoteName(name);
    const head = el.createDiv({ cls: "goodobsidian-search-page" });
    head.createSpan({
      cls: "finenotes-search-title",
      text: note ? stripTextNoteSuffix(name) : placeholderEntry(hit.path, 0).title,
    });
    // A notebook's page; a note is one page, and its count says enough.
    head.createSpan({
      cls: "goodobsidian-search-count",
      text: note
        ? tn("view.search.matches", hit.count)
        : `${t("view.search.page", { page: hit.pageIndex + 1 })} · ${tn("view.search.matches", hit.count)}`,
    });
    for (const snippet of hit.snippets) {
      const line = el.createDiv({ cls: "goodobsidian-search-snippet" });
      line.createSpan({ cls: "goodobsidian-search-kind", text: kindLabel(snippet.kind) });
      line.appendText(snippet.before);
      line.createSpan({ cls: "suggestion-highlight", text: snippet.match });
      line.appendText(snippet.after);
    }
  }

  onChooseSuggestion(hit: LibraryHit): void {
    openSearchHit(this.app, hit, this.inputEl.value);
  }
}
