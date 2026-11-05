/**
 * The text of every note, notebook and PDF in the vault, kept so the Folders
 * sidebar can search inside them (Obsidian's own search cannot read inside
 * notebooks or PDFs).
 *
 * - Notes are read as they are; a notebook's text boxes are unpacked from
 *   its data block; a PDF's text comes from pdf.js, and a scanned PDF's from
 *   FineNotes' OCR cache once FineNotes has read it.
 * - Pages are kept in the browser's IndexedDB, so a restart reads only what
 *   changed. The words are indexed in memory (`model/folder-search.ts`).
 * - The work runs in the background, one file at a time, and waits while a
 *   pen is writing or the window is hidden.
 *
 * It works only between `start()` and `stop()`: the Folders sidebar starts it
 * with the simple look and stops it when that is turned off.
 */

import { type App, type TAbstractFile, TFile } from "obsidian";
import {
  type IndexCounts,
  type IndexedPage,
  type StoredDocument,
  MAX_PAGE_TEXT,
  MIN_PAGE_TEXT,
  SearchPostings,
  mergeOcrPages,
  parseOcrSidecar,
  snippetOf,
  tokenize,
} from "../../model/folder-search";
import { readNotebookText } from "../../model/folder-thumbnail";
import { isNotebookFile } from "./files";
import { loadPdf } from "./pdfjs";

const DATABASE_NAME = "finenotes-folder-search";
const STORE_NAME = "docs";
/** A PDF over this many bytes is not read. */
const MAX_PDF_BYTES = 60 * 1024 * 1024;
/** A notebook over this many bytes is not read. */
const MAX_NOTEBOOK_BYTES = 40 * 1024 * 1024;
/** The most characters read of one note. */
const MAX_NOTE_CHARACTERS = 300000;
/** The most pages read of one PDF. */
const MAX_PDF_PAGES = 800;
/** Reading waits this long after the pen was last used, ms. */
const PEN_QUIET_MS = 10000;
/** A changed file is read this long after its last change, ms. */
const MODIFY_DELAY_MS = 60000;
/** How long the status listeners wait to be told, ms. */
const STATUS_DELAY_MS = 400;
/** After opening a PDF or notebook, the OCR cache is looked at this soon, ms. */
const OCR_DELAY_MS = 5000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

/** The documents on disk, by path. Every method answers with a default when IndexedDB is unavailable. */
class DocumentStore {
  private db: IDBDatabase | null = null;

  async open(): Promise<void> {
    try {
      this.db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = activeWindow.indexedDB.open(DATABASE_NAME, 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore(STORE_NAME, { keyPath: "path" });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB failed"));
      });
    } catch {
      this.db = null;
    }
  }

  private objectStore(mode: IDBTransactionMode): IDBObjectStore | null {
    try {
      return this.db ? this.db.transaction(STORE_NAME, mode).objectStore(STORE_NAME) : null;
    } catch {
      return null;
    }
  }

  private run<T>(
    action: (store: IDBObjectStore) => IDBRequest,
    mode: IDBTransactionMode,
    fallback: T,
  ): Promise<T> {
    return new Promise<T>((resolve) => {
      const store = this.objectStore(mode);
      if (!store) {
        resolve(fallback);
        return;
      }
      try {
        const request = action(store);
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => resolve(fallback);
      } catch {
        resolve(fallback);
      }
    });
  }

  async keys(): Promise<string[]> {
    const keys = await this.run<IDBValidKey[]>((store) => store.getAllKeys(), "readonly", []);
    return keys.map(String);
  }

  get(path: string): Promise<StoredDocument | undefined> {
    return this.run<StoredDocument | undefined>((store) => store.get(path), "readonly", undefined);
  }

  async put(doc: StoredDocument): Promise<void> {
    await this.run<unknown>((store) => store.put(doc), "readwrite", undefined);
  }

  async delete(path: string): Promise<void> {
    await this.run<unknown>((store) => store.delete(path), "readwrite", undefined);
  }

  async clear(): Promise<void> {
    await this.run<unknown>((store) => store.clear(), "readwrite", undefined);
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }
}

/** What the index is doing, and what it holds. */
export interface IndexStatus extends IndexCounts {
  enabled: boolean;
  running: boolean;
  queued: number;
}

/** One note found by a search. */
export interface SearchHit {
  path: string;
  title: string;
  kind: "note" | "notebook" | "pdf";
  /** One-based page numbers, the first few. */
  pages: number[];
  /** How many pages matched in all. */
  matchedPages: number;
  snippet: string;
  score: number;
  titleMatch: boolean;
}

export interface SearchOutcome {
  hits: SearchHit[];
  tooShort: boolean;
  truncated: boolean;
}

export class FolderSearchIndex {
  private readonly store = new DocumentStore();
  private readonly index = new SearchPostings();
  private queue: string[] = [];
  private running = false;
  private stopped = false;
  private started = false;
  private ready = false;
  private forced = new Set<string>();
  private generation = 0;
  private rescanPending = false;
  private ocrRunning = false;
  private ocrTimer: number | null = null;
  private lastPen = 0;
  private readonly modifyTimers = new Map<string, number>();
  private readonly listeners = new Set<() => void>();
  private statusTimer: number | null = null;

  /**
   * @param ocrFolder where FineNotes keeps the text it read from scanned PDFs
   *   (`<plugin folder>/ocr`).
   * @param enabled whether "Search inside notes" is on.
   */
  constructor(
    private readonly app: App,
    private readonly ocrFolder: string,
    private readonly enabled: () => boolean,
  ) {}

  /** Open the store and, when search is on, load what it holds and bring it up to date. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    await this.store.open();
    if (this.enabled()) await this.load();
    this.emit();
    if (this.enabled() && !this.stopped) void this.scanAndRun();
  }

  private async load(): Promise<void> {
    if (this.ready) return;
    await this.loadSaved();
    this.ready = true;
  }

  /** Stop all work and let go of the store. It can be started again. */
  stop(): void {
    this.stopped = true;
    this.started = false;
    this.ready = false;
    this.generation++;
    this.queue = [];
    for (const timer of this.modifyTimers.values()) window.clearTimeout(timer);
    this.modifyTimers.clear();
    if (this.statusTimer !== null) window.clearTimeout(this.statusTimer);
    this.statusTimer = null;
    if (this.ocrTimer !== null) window.clearTimeout(this.ocrTimer);
    this.ocrTimer = null;
    this.index.clear();
    this.store.close();
  }

  /** "Search inside notes" was turned on. */
  enable(): void {
    if (!this.started || this.stopped) return;
    void (async () => {
      await this.load();
      this.emit();
      if (this.enabled() && !this.running) await this.scanAndRun();
    })();
  }

  /** "Search inside notes" was turned off: forget the words, keep the pages on disk. */
  disable(): void {
    this.generation++;
    this.queue = [];
    this.index.clear();
    this.ready = false;
    this.emit();
  }

  /** Forget everything and read every file again. */
  async rebuild(): Promise<void> {
    this.generation++;
    this.queue = [];
    this.forced.clear();
    this.index.clear();
    await this.store.clear();
    this.ready = true;
    this.emit();
    if (this.enabled()) {
      if (this.running) this.rescanPending = true;
      else void this.scanAndRun();
    }
  }

  /** A pen is writing: reading waits. */
  notePenActivity(): void {
    this.lastPen = Date.now();
  }

  /** Tell `listener` when the status changes (at most every 0.4 s). Returns how to stop. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getStatus(): IndexStatus {
    return {
      ...this.index.counts(),
      enabled: this.enabled(),
      running: this.running,
      queued: this.queue.length,
    };
  }

  private emit(): void {
    if (this.statusTimer !== null) return;
    this.statusTimer = window.setTimeout(() => {
      this.statusTimer = null;
      for (const listener of Array.from(this.listeners)) listener();
    }, STATUS_DELAY_MS);
  }

  // --- Following the vault ------------------------------------------------------

  onModify(file: TAbstractFile): void {
    if (!this.ready || !(file instanceof TFile) || !this.enabled() || !this.wanted(file)) return;
    const pending = this.modifyTimers.get(file.path);
    if (pending !== undefined) window.clearTimeout(pending);
    this.modifyTimers.set(
      file.path,
      window.setTimeout(() => {
        this.modifyTimers.delete(file.path);
        this.enqueue(file.path);
      }, MODIFY_DELAY_MS),
    );
  }

  onCreate(file: TAbstractFile): void {
    if (this.ready && file instanceof TFile && this.enabled() && this.wanted(file)) {
      this.enqueue(file.path);
    }
  }

  onDelete(path: string): void {
    if (!this.ready) return;
    const inside = `${path}/`;
    for (const known of Array.from(this.index.docs.keys())) {
      if (known === path || known.startsWith(inside)) {
        this.index.removeDoc(known);
        void this.store.delete(known);
      }
    }
    this.index.rebuildRefs();
    this.emit();
  }

  async onRename(file: TAbstractFile, oldPath: string): Promise<void> {
    if (!this.ready || !(file instanceof TFile)) return;
    const known = this.index.docs.get(oldPath);
    const stored =
      known && this.enabled() && this.wanted(file) ? await this.store.get(oldPath) : undefined;
    if (!known || !stored) {
      this.onDelete(oldPath);
      this.onCreate(file);
      return;
    }
    const kind = this.kindOf(file);
    stored.path = file.path;
    stored.title = this.titleOf(file, kind);
    this.index.removeDoc(oldPath);
    this.index.addDoc(stored);
    await this.store.put(stored);
    await this.store.delete(oldPath);
    if (kind === "pdf") {
      for (const use of this.index.pdfUsers.get(oldPath) ?? []) {
        this.forced.add(use.nb);
        this.enqueue(use.nb);
      }
    }
    this.index.rebuildRefs();
    this.emit();
  }

  private async loadSaved(): Promise<void> {
    const paths = await this.store.keys();
    const generation = this.generation;
    let since = Date.now();
    for (const path of paths) {
      if (this.stopped || generation !== this.generation) return;
      const doc = await this.store.get(path);
      if (doc) this.index.addDoc(doc);
      if (Date.now() - since > 12) {
        await sleep(this.shouldPause() ? 1000 : 8);
        since = Date.now();
      }
    }
    this.index.rebuildRefs();
  }

  // --- Deciding what to read ---------------------------------------------------

  private wanted(file: TFile): boolean {
    const extension = file.extension.toLowerCase();
    if (extension !== "md" && extension !== "pdf") return false;
    const config = this.app.vault.configDir;
    return (
      !file.path.startsWith(`${config}/`) &&
      !file.path.split("/").some((part) => part.startsWith("."))
    );
  }

  private kindOf(file: TFile): "note" | "notebook" | "pdf" {
    if (file.extension.toLowerCase() === "pdf") return "pdf";
    return isNotebookFile(this.app, file) ? "notebook" : "note";
  }

  private titleOf(file: TFile, kind: "note" | "notebook" | "pdf"): string {
    return kind === "notebook" ? file.basename.replace(/\.(notebook|page)$/i, "") : file.basename;
  }

  private sigOf(file: TFile): string {
    return `${file.stat.mtime}:${file.stat.size}`;
  }

  private enqueue(path: string): void {
    if (!this.ready || this.stopped) return;
    if (!this.queue.includes(path)) this.queue.push(path);
    this.emit();
    if (!this.running && this.enabled()) void this.run();
  }

  /** Queue every file that changed since it was read, notebooks first, then PDFs, newest first. */
  private async scanAndRun(): Promise<void> {
    if (!this.ready) await this.load();
    const files = this.app.vault.getFiles().filter((file) => this.wanted(file));
    const present = new Set(files.map((file) => file.path));
    for (const path of Array.from(this.index.docs.keys())) {
      if (!present.has(path)) {
        this.index.removeDoc(path);
        void this.store.delete(path);
      }
    }
    this.index.rebuildRefs();
    const changed = files.filter(
      (file) => this.index.docs.get(file.path)?.sig !== this.sigOf(file),
    );
    const rank = (file: TFile): number => {
      const kind = this.kindOf(file);
      return kind === "notebook" ? 0 : kind === "pdf" ? 1 : 2;
    };
    changed.sort((a, b) => rank(a) - rank(b) || b.stat.mtime - a.stat.mtime);
    for (const file of changed) {
      if (!this.queue.includes(file.path)) this.queue.push(file.path);
    }
    this.emit();
    await this.run();
  }

  /** Reading waits while a pen is writing and while the window is hidden. */
  private shouldPause(): boolean {
    return Date.now() - this.lastPen < PEN_QUIET_MS || activeDocument.hidden;
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.emit();
    try {
      let sinceRefs = 0;
      while (this.queue.length > 0 && !this.stopped && this.enabled()) {
        while (this.shouldPause() && !this.stopped) await sleep(2000);
        const path = this.nextPath();
        const file = this.app.vault.getAbstractFileByPath(path);
        const forced = this.forced.delete(path);
        if (
          file instanceof TFile &&
          (forced || this.index.docs.get(path)?.sig !== this.sigOf(file))
        ) {
          try {
            await this.readFile(file);
          } catch (error) {
            console.warn(`FineNotes: could not index ${path}`, error);
          }
          if (++sinceRefs >= 10) {
            sinceRefs = 0;
            this.index.rebuildRefs();
          }
        }
        this.emit();
        await sleep(40);
      }
      this.index.rebuildRefs();
    } finally {
      this.running = false;
      this.emit();
    }
    if (this.stopped || !this.enabled()) return;
    if (this.rescanPending) {
      this.rescanPending = false;
      void this.scanAndRun();
      return;
    }
    await this.ocrPass();
    this.compactIfNeeded();
    if (this.queue.length > 0) void this.run();
  }

  /** Start over from the store when so many pages are dead that the lists are mostly waste. */
  private compactIfNeeded(): void {
    if (!this.index.needsCompaction()) return;
    this.generation++;
    const queue = this.queue;
    this.index.clear();
    this.ready = false;
    void this.load().then(() => {
      this.queue = queue;
      this.emit();
      if (this.queue.length > 0 && !this.running) void this.run();
    });
  }

  /** The next file to read: a notebook first, then a PDF a notebook shows, then the next. */
  private nextPath(): string {
    const queue = this.queue;
    const isNotebook = (path: string): boolean => {
      const file = this.app.vault.getAbstractFileByPath(path);
      return file instanceof TFile && this.kindOf(file) === "notebook";
    };
    const notebook = queue.findIndex(isNotebook);
    if (notebook >= 0) return queue.splice(notebook, 1)[0];
    const shown = queue.findIndex((path) => this.index.pdfUsers.has(path));
    return (shown >= 0 ? queue.splice(shown, 1)[0] : queue.shift()) as string;
  }

  // --- Reading ----------------------------------------------------------------------

  private async readFile(file: TFile): Promise<void> {
    const kind = this.kindOf(file);
    const sig = this.sigOf(file);
    const generation = this.generation;
    let doc: StoredDocument;
    if (kind === "pdf") doc = await this.readPdf(file, sig);
    else if (kind === "notebook") doc = await this.readNotebook(file, sig);
    else doc = await this.readNote(file, sig);
    if (
      generation !== this.generation ||
      this.app.vault.getAbstractFileByPath(file.path) !== file
    ) {
      return;
    }
    this.index.addDoc(doc);
    await this.store.put(doc);
  }

  private async readNote(file: TFile, sig: string): Promise<StoredDocument> {
    let text = await this.app.vault.cachedRead(file);
    // A note's ink block is packed data, not words.
    text = text.replace(/%%(?:goodobsidian|inkedmark)[\s\S]*?%%/g, " ");
    if (text.length > MAX_NOTE_CHARACTERS) text = text.slice(0, MAX_NOTE_CHARACTERS);
    return {
      path: file.path,
      sig,
      kind: "note",
      title: file.basename,
      pages: text.trim() ? [{ p: 0, t: text }] : [],
    };
  }

  private async readNotebook(file: TFile, sig: string): Promise<StoredDocument> {
    const doc: StoredDocument = {
      path: file.path,
      sig,
      kind: "notebook",
      title: this.titleOf(file, "notebook"),
      pages: [],
    };
    if (file.stat.size > MAX_NOTEBOOK_BYTES) return doc;
    const pages = readNotebookText(await this.app.vault.cachedRead(file));
    if (!pages) return doc;
    const refs: NonNullable<StoredDocument["refs"]> = [];
    pages.forEach((page, index) => {
      if (page.text.trim()) doc.pages.push({ p: index, t: page.text.slice(0, MAX_PAGE_TEXT) });
      if (page.pdf) {
        const pdf = this.resolvePdf(page.pdf.path, file.path);
        if (pdf) refs.push({ pdf, pdfPage: page.pdf.page, nbPage: index });
      }
    });
    doc.refs = refs;
    return doc;
  }

  /** The vault path a notebook's PDF backdrop names, or null when it is not in the vault. */
  private resolvePdf(path: string, from: string): string | null {
    const exact = this.app.vault.getAbstractFileByPath(path);
    if (exact instanceof TFile) return exact.path;
    const linked = this.app.metadataCache.getFirstLinkpathDest(path, from);
    return linked ? linked.path : null;
  }

  private async readPdf(file: TFile, sig: string): Promise<StoredDocument> {
    const doc: StoredDocument = {
      path: file.path,
      sig,
      kind: "pdf",
      title: file.basename,
      pages: [],
    };
    if (file.stat.size > MAX_PDF_BYTES) return { ...doc, skipped: "too-large" };
    let reader: { destroy(): Promise<void> } | null = null;
    try {
      const lib = await loadPdf();
      const data = new Uint8Array(await this.app.vault.adapter.readBinary(file.path));
      const loaded = await lib.getDocument({ data }).promise;
      reader = loaded;
      const count = Math.min(loaded.numPages, MAX_PDF_PAGES);
      let empty = 0;
      for (let number = 1; number <= count && !this.stopped; number++) {
        const page = await loaded.getPage(number);
        const text = (await page.getTextContent()).items
          .map((item) => item.str ?? "")
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        page.cleanup();
        if (text.length < MIN_PAGE_TEXT) empty++;
        if (text) doc.pages.push({ p: number - 1, t: text.slice(0, MAX_PAGE_TEXT) });
        if (number % 6 === 0) {
          await sleep(15);
          while (this.shouldPause() && !this.stopped) await sleep(2000);
        }
      }
      doc.scanned = empty >= Math.max(1, count) * 0.5;
      return doc;
    } catch (error) {
      console.warn(`FineNotes: could not read PDF ${file.path}`, error);
      return { ...doc, skipped: "failed" };
    } finally {
      try {
        await reader?.destroy();
      } catch {
        // Nothing left to release.
      }
    }
  }

  // --- FineNotes' OCR cache -------------------------------------------------------------

  /** After a PDF or notebook was opened, FineNotes may have read pages: look at its cache soon. */
  scheduleOcr(): void {
    if (!this.ready || this.stopped || !this.enabled() || this.ocrTimer !== null) return;
    this.ocrTimer = window.setTimeout(() => {
      this.ocrTimer = null;
      if (!this.running) void this.ocrPass();
    }, OCR_DELAY_MS);
  }

  private async ocrPass(): Promise<void> {
    if (this.ocrRunning) return;
    this.ocrRunning = true;
    try {
      await this.ocrPassInner();
    } finally {
      this.ocrRunning = false;
    }
  }

  /**
   * Read the text FineNotes' OCR found on scanned PDFs (`<ocr folder>/<SHA-256
   * of the PDF>.json`) into the PDFs that have no text of their own.
   */
  private async ocrPassInner(): Promise<void> {
    const adapter = this.app.vault.adapter;
    let sidecars: string[] = [];
    try {
      if (!(await adapter.exists(this.ocrFolder))) return;
      sidecars = (await adapter.list(this.ocrFolder)).files.filter((path) =>
        path.endsWith(".json"),
      );
    } catch {
      return;
    }
    if (sidecars.length === 0 || !activeWindow.crypto?.subtle) return;
    const byHash = new Map(
      sidecars.map((path) => [path.slice(path.lastIndexOf("/") + 1).replace(/\.json$/, ""), path]),
    );
    for (const [path, info] of Array.from(this.index.docs.entries())) {
      if (this.stopped || !this.enabled()) return;
      if (info.kind !== "pdf" || !info.scanned || info.skipped) continue;
      while (this.shouldPause() && !this.stopped) await sleep(2000);
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile) || file.stat.size > MAX_PDF_BYTES) continue;
      try {
        const stored = await this.store.get(path);
        if (!stored) continue;
        if (!stored.hash) {
          const bytes = await adapter.readBinary(path);
          const digest = await activeWindow.crypto.subtle.digest("SHA-256", bytes);
          stored.hash = Array.from(new Uint8Array(digest), (b) =>
            b.toString(16).padStart(2, "0"),
          ).join("");
        }
        const sidecar = byHash.get(stored.hash);
        if (!sidecar) {
          await this.store.put(stored);
          continue;
        }
        const stamp = String((await adapter.stat(sidecar))?.mtime ?? 0);
        if (stored.ocrSig === stamp) continue;
        const read: IndexedPage[] = parseOcrSidecar(await adapter.read(sidecar));
        mergeOcrPages(stored.pages, read);
        stored.ocrSig = stamp;
        this.index.addDoc(stored);
        await this.store.put(stored);
        this.index.rebuildRefs();
        this.emit();
      } catch (error) {
        console.warn(`FineNotes: OCR cache for ${path} not used`, error);
      }
      await sleep(40);
    }
  }

  // --- Searching ---------------------------------------------------------------------------

  /** The notes holding every word of `query`, best first. */
  async search(query: string): Promise<SearchOutcome> {
    const words = Array.from(new Set(tokenize(query)));
    const match = this.index.match(query);
    if (match.tooShort) return { hits: [], tooShort: true, truncated: false };
    const hits: SearchHit[] = [];
    for (const { group, score } of match.groups) {
      const info = this.index.docs.get(group.path);
      if (!info) continue;
      let snippet = "";
      const source = group.sources[0];
      if (source) {
        const stored = await this.store.get(source.doc);
        const page = stored?.pages.find((entry) => entry.p === source.p);
        if (page) snippet = snippetOf(page.t, words);
      }
      const pages = Array.from(group.pages).sort((a, b) => a - b);
      hits.push({
        path: group.path,
        title: info.title,
        kind: group.kind,
        pages: pages.slice(0, 6),
        matchedPages: pages.length,
        snippet,
        score,
        titleMatch: group.titleMatch,
      });
    }
    return { hits, tooShort: false, truncated: match.truncated };
  }
}
