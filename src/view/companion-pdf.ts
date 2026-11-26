/**
 * Companion PDFs in the vault: the per-device journal, the one export queue
 * every notebook shares, and the vault's renames and deletes.
 *
 * Cost, on purpose:
 * - Nothing is exported in the background or while the pen is down: only
 *   after a notebook closes (from what was saved) or when asked.
 * - A notebook that has not changed since its PDF was checked costs nothing
 *   at close.
 * - A PDF this device wrote is known by its size and time; it is never read
 *   back. Another device's PDF is read once per change, and only its
 *   trailer and Info dictionary are looked at (`readCompanionSubject`).
 * - The vault is never searched for a PDF: moves are followed through
 *   Obsidian's rename events and the notebook's synced frontmatter.
 */
import { type App, Notice, type Plugin, type TAbstractFile, TFile, parseYaml } from "obsidian";
import {
  COMPANION_ID_KEY,
  CompanionError,
  type CompanionEntry,
  type CompanionErrorCode,
  type CompanionJournal,
  type CompanionKeys,
  type CompanionMark,
  type CompanionSeen,
  companionErrorCode,
  companionFrontmatter,
  companionIdFromBody,
  companionMark,
  companionMetaFromBody,
  companionName,
  companionTransaction,
  fileNameOf,
  folderOf,
  followedCompanionPath,
  followsName,
  freeCompanionPath,
  inCompanionFolder,
  isCompanionNotebookPath,
  isCompanionScratch,
  parseCompanionJournal,
  sameStat,
  withCompanionKeys,
} from "../model/companion-pdf";
import { CompanionHasher } from "../model/companion-hash";
import { CompanionQueue } from "../model/companion-queue";
import {
  recoverCompanionWrite,
  replaceCompanionPdf,
  type CompanionWriteIO,
} from "../model/companion-write";
import type { InkDocument, Page } from "../model/document";
import { hasBoards, isBoardPage } from "../model/board";
import { furnitureText } from "../model/furniture";
import { assembleJson, readStoredDocument, type DocumentSnapshot } from "../model/serialize";
import { paperTheme } from "../canvas/backdrop";
import { companionPdfSubject, readCompanionSubject } from "../export/companion-metadata";
import { exportPagesToPdf, type PdfExportSources } from "./pdf-export";
import { PdfBackdropCache } from "./pdf-backdrop";
import { VaultImageCache } from "./image-cache";
import { deviceIdOf } from "./device-pages-session";
import { t, type TextKey } from "../i18n/translate";

/** Where the journal is kept: this device's local storage, never data.json (it syncs). */
const JOURNAL_KEY = "finenotes-companion-journal";

const ERROR_TEXT: Record<CompanionErrorCode, TextKey> = {
  missing: "notebooks.companion.errMissing",
  occupied: "notebooks.companion.errOccupied",
  source: "notebooks.companion.errSource",
  export: "notebooks.companion.errExport",
  write: "notebooks.companion.errWrite",
  frontmatter: "notebooks.companion.errFrontmatter",
  path: "notebooks.companion.errPath",
  duplicate: "notebooks.companion.errDuplicate",
};

export function companionErrorText(code: CompanionErrorCode): string {
  return t(ERROR_TEXT[code]);
}

/** The export switches a companion is made with: this device's, as the export dialog left them. */
export type CompanionExportOptions = Pick<
  PdfExportSources,
  "usePressure" | "highlighterAlpha" | "plainPaper" | "withoutTapes" | "margins"
>;

/** A closed notebook, as it was saved: all an export needs, with nothing of the view. */
export interface CompanionCapture {
  title: string;
  snapshot: DocumentSnapshot;
  paperWidth: number;
  /** The page furniture as read (`readFurniture`), or `undefined` for a board. */
  furniture: unknown;
  resources: readonly string[];
  options: CompanionExportOptions;
  /** A board page cropped to its drawing. */
  crop: (page: Page) => Page;
}

/** What an open notebook view offers the manager. */
export interface CompanionViewLink {
  readonly file: TFile | null;
  /** Sets the keys in the view's own note text and saves it; `false` when the view cannot write. */
  writeKeys(keys: CompanionKeys): Promise<boolean>;
  /** The pen is on the page. */
  readonly penDown: boolean;
  /** The notebook's companion id. */
  readonly id: string | null;
  /** Whether its pages are drawn from the file at `path`. */
  uses(path: string): boolean;
}

export interface CompanionState {
  mark: CompanionMark;
  /** The last failure, in words, for the mark's label. */
  error?: string;
  folder: string;
  pdfExists: boolean;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The content hash of a capture: what its PDF's Subject carries. */
export function captureHash(
  app: App,
  capture: CompanionCapture,
  hasher?: CompanionHasher,
): Promise<string> {
  return (hasher ?? new CompanionHasher(sha256Hex)).hash({
    title: capture.title,
    furniture: capture.furniture,
    pages: capture.snapshot.pages,
    resources: capture.resources.map((path) => ({
      path,
      size: app.vault.getFileByPath(path)?.stat.size ?? -1,
    })),
  });
}

export function companionRenderPages(
  doc: Pick<InkDocument, "pages" | "endless">,
  crop: (page: Page) => Page,
): Page[] {
  return hasBoards(doc)
    ? doc.pages.map((page) => (isBoardPage(doc, page) ? crop(page) : page))
    : doc.pages;
}

/** Headers and page numbers for export pages, matched by page id (a cropped page is a copy). */
export function companionFurniture(
  doc: Pick<InkDocument, "pages" | "furniture" | "endless">,
  title: string,
): NonNullable<PdfExportSources["furniture"]> {
  const indices = new Map(doc.pages.map((page, index) => [page.id, index]));
  return (page) => furnitureText(doc, indices.get(page.id) ?? -1, title);
}

/** The PDF of a capture, rendered with caches of its own (the view's are gone). */
async function renderCapture(
  app: App,
  capture: CompanionCapture,
  subject: string,
): Promise<Uint8Array> {
  const doc = readStoredDocument(JSON.parse(assembleJson(capture.snapshot)), capture.paperWidth);
  const pages = companionRenderPages(doc, capture.crop);
  const images = new VaultImageCache(app);
  const pdf = pages.some((page) => page.backdrop.kind === "pdf") ? new PdfBackdropCache(app) : null;
  try {
    return await exportPagesToPdf(
      pages,
      {
        readPdf: async (path) => {
          const file = app.vault.getFileByPath(path);
          if (!file) throw new CompanionError("export");
          return app.vault.readBinary(file);
        },
        pdf,
        images,
        paper: paperTheme(false),
        ...capture.options,
        furniture: companionFurniture(doc, capture.title),
      },
      { title: capture.title, subject },
    );
  } finally {
    images.destroy();
    pdf?.destroy();
  }
}

function randomId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/** Refuses frontmatter that is not YAML, rather than writing more into it. */
export function checkFrontmatter(text: string): void {
  const yaml = companionFrontmatter(text);
  if (yaml === null) return;
  try {
    parseYaml(yaml);
  } catch {
    throw new CompanionError("frontmatter");
  }
}

export class CompanionPdfManager {
  private journal: CompanionJournal;
  readonly queue: CompanionQueue;
  /** Paths this manager is renaming, creating or deleting: their vault events are its own. */
  private readonly internal = new Set<string>();
  private readonly revisions = new Map<string, number>();
  private readonly listeners = new Set<() => void>();
  private views: () => Iterable<CompanionViewLink> = () => [];
  private penDown: () => boolean = () => false;
  private stopped = false;

  constructor(
    private readonly app: App,
    private readonly device = deviceIdOf(app),
  ) {
    let raw: unknown = null;
    try {
      raw = app.loadLocalStorage(JOURNAL_KEY);
    } catch {
      /* No local storage: a journal for this session only. */
    }
    this.journal = parseCompanionJournal(raw);
    this.queue = new CompanionQueue({
      paused: () => this.penDown(),
      sleep: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
      failed: (id, error) => this.failed(id, error, false),
      changed: () => this.statusChanged(),
    });
  }

  /** Hears the vault, recovers interrupted writes once the vault is indexed, stops with the plugin. */
  register(plugin: Plugin, views: () => Iterable<CompanionViewLink>): void {
    this.views = views;
    this.penDown = () => [...this.views()].some((view) => view.penDown);
    const { vault, workspace } = plugin.app;
    plugin.registerEvent(vault.on("rename", (file, oldPath) => void this.renamed(file, oldPath)));
    plugin.registerEvent(vault.on("delete", (file) => this.deleted(file.path)));
    plugin.registerEvent(vault.on("modify", (file) => this.changed(file)));
    plugin.registerEvent(vault.on("create", (file) => this.changed(file)));
    workspace.onLayoutReady(() => void this.recoverAll());
    plugin.register(() => this.destroy());
  }

  destroy(): void {
    this.stopped = true;
    this.queue.stop();
    this.listeners.clear();
  }

  isInternal(path: string): boolean {
    return this.internal.has(path) || isCompanionScratch(path);
  }

  entry(id: string | null): CompanionEntry | undefined {
    return id ? this.journal.entries[id] : undefined;
  }

  observe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private statusChanged(): void {
    for (const listener of this.listeners) listener();
  }

  /** Writes the journal to local storage: a few hundred bytes, on this device only. */
  private persist(): void {
    try {
      this.app.saveLocalStorage(JOURNAL_KEY, JSON.stringify(this.journal));
    } catch {
      /* Kept in memory for this session. */
    }
    this.statusChanged();
  }

  state(id: string | null): CompanionState {
    const entry = this.entry(id);
    const pdfExists = !!entry && this.app.vault.getFileByPath(entry.pdfPath) !== null;
    const mark = companionMark(entry, !!id && this.queue.busy(id), pdfExists);
    return {
      mark,
      ...(mark === "error" && entry?.error ? { error: companionErrorText(entry.error) } : {}),
      folder: entry ? folderOf(entry.pdfPath) : "",
      pdfExists,
    };
  }

  private revision(id: string): number {
    return this.revisions.get(id) ?? 0;
  }

  /** The notebook changed (an edit, or a newer copy read from disk): its PDF may be behind. */
  markDirty(id: string | null): void {
    const entry = this.entry(id);
    if (!id || !entry?.enabled) return;
    this.revisions.set(id, this.revision(id) + 1);
    if (entry.dirty) return;
    entry.dirty = true;
    this.persist();
  }

  /**
   * Takes the notebook's frontmatter as the truth for whether it has a
   * companion, where the PDF is and whether it follows the name: what
   * another device set wins over this device's journal.
   */
  hydrate(notebook: TFile, body: string): CompanionEntry | undefined {
    const meta = companionMetaFromBody(body);
    if (!meta || !isCompanionNotebookPath(notebook.path)) return undefined;
    let entry = this.journal.entries[meta.id];
    if (entry && meta.pdfPath && entry.notebookPath !== notebook.path) {
      // Another notebook still carries this id (a copy made outside FineNotes):
      // neither writes the PDF until one is set up again.
      const other = this.app.vault.getFileByPath(entry.notebookPath);
      const otherId: unknown = other
        ? this.app.metadataCache.getFileCache(other)?.frontmatter?.[COMPANION_ID_KEY]
        : undefined;
      if (other && otherId === meta.id) {
        if (entry.error !== "duplicate") {
          entry.error = "duplicate";
          this.persist();
        }
        return entry;
      }
    }
    if (!meta.pdfPath) {
      if (entry && (entry.enabled || entry.notebookPath !== notebook.path)) {
        entry.enabled = false;
        entry.notebookPath = notebook.path;
        delete entry.error;
        this.persist();
      }
      return entry;
    }
    if (!entry) {
      entry = {
        notebookPath: notebook.path,
        pdfPath: meta.pdfPath,
        enabled: true,
        followName: meta.followName ?? followsName(meta.pdfPath, notebook.path),
        dirty: true,
      };
      this.journal.entries[meta.id] = entry;
      this.persist();
      return entry;
    }
    let changed = false;
    if (entry.notebookPath !== notebook.path || entry.error === "duplicate") {
      entry.notebookPath = notebook.path;
      if (entry.error === "duplicate") delete entry.error;
      changed = true;
    }
    if (entry.pdfPath !== meta.pdfPath || !entry.enabled) {
      entry.pdfPath = meta.pdfPath;
      entry.enabled = true;
      entry.dirty = true;
      delete entry.error;
      changed = true;
    }
    if (meta.followName !== undefined && entry.followName !== meta.followName) {
      entry.followName = meta.followName;
      changed = true;
    }
    if (changed) this.persist();
    return entry;
  }

  // --- Reading PDFs -----------------------------------------------------------

  /**
   * What the PDF at `path` says about itself: from this device's record when
   * the file is exactly as this device wrote or last read it, or else from
   * its trailer and Info dictionary (one read of the file, no parsing).
   */
  private async pdfAt(entry: CompanionEntry, path: string): Promise<CompanionSeen | null> {
    const file = this.app.vault.getFileByPath(path);
    if (!file) return null;
    const stat = { path, mtime: file.stat.mtime, size: file.stat.size };
    if (sameStat(entry.written, stat)) return entry.written!;
    if (sameStat(entry.seen, stat)) return entry.seen!;
    const meta = readCompanionSubject(await this.app.vault.readBinary(file));
    const seen: CompanionSeen = { ...stat, id: meta?.id ?? null, hash: meta?.contentHash ?? null };
    if (file.stat.mtime === stat.mtime && file.stat.size === stat.size) {
      entry.seen = seen;
      this.persist();
    }
    return seen;
  }

  private exists(path: string): boolean {
    return this.app.vault.getAbstractFileByPath(path) !== null;
  }

  private async ensureFolder(path: string): Promise<void> {
    const folder = folderOf(path);
    if (!folder || this.app.vault.getFolderByPath(folder)) return;
    try {
      await this.app.vault.createFolder(folder);
    } catch {
      if (!this.app.vault.getFolderByPath(folder)) throw new CompanionError("path");
    }
  }

  private async internally<T>(paths: readonly string[], run: () => Promise<T>): Promise<T> {
    const mine = paths.filter((path) => !this.internal.has(path));
    mine.forEach((path) => this.internal.add(path));
    try {
      return await run();
    } finally {
      mine.forEach((path) => this.internal.delete(path));
    }
  }

  /** Moves this notebook's PDF, links and all, as the user would. */
  private async movePdf(entry: CompanionEntry, to: string): Promise<void> {
    const file = this.app.vault.getFileByPath(entry.pdfPath);
    if (!file) return;
    await this.ensureFolder(to);
    const from = entry.pdfPath;
    await this.internally([from, to], () => this.app.fileManager.renameFile(file, to));
    for (const record of [entry.written, entry.seen]) if (record?.path === from) record.path = to;
  }

  private writeIO(): CompanionWriteIO {
    return {
      exists: (path) => this.exists(path),
      owned: async (path) => {
        const [id] = Object.entries(this.journal.entries).find(([, e]) => e.pdfPath === path) ?? [];
        const entry = this.entry(id ?? null);
        return !!entry && (await this.pdfAt(entry, path))?.id === id;
      },
      create: async (path, bytes) => {
        await this.ensureFolder(path);
        await this.app.vault.createBinary(path, bytes.slice().buffer);
      },
      rename: async (from, to) => {
        const file = this.app.vault.getFileByPath(from);
        if (file) await this.app.vault.rename(file, to);
      },
      // Straight out, not to the trash: these are this device's own scratch
      // copies of a PDF, which in the trash would pile up and sync. The vault
      // may list one for a moment after; each write's names are new (see
      // `companionTransaction`), so that is never in the way.
      remove: async (path) => {
        const { adapter } = this.app.vault;
        if (await adapter.exists(path)) await adapter.remove(path);
      },
      persist: () => this.persist(),
    };
  }

  /** Finishes writes an earlier session left half done. Run once the vault is indexed. */
  async recoverAll(): Promise<void> {
    for (const entry of Object.values(this.journal.entries)) {
      const tx = entry.transaction;
      if (!tx) continue;
      try {
        await this.internally([tx.target, tx.stage, tx.backup], () =>
          recoverCompanionWrite(entry, this.writeIO()),
        );
      } catch {
        entry.error = "write";
        this.persist();
      }
    }
  }

  // --- Exporting --------------------------------------------------------------

  /**
   * Queues an export of the notebook as `capture` gives it. It runs after
   * the caller's turn, one notebook at a time, never while the pen is down.
   * Unforced, it does nothing for a notebook not changed since its PDF was
   * checked, and never makes a PDF that is missing.
   */
  requestExport(
    id: string,
    notebook: TFile,
    capture: () => CompanionCapture,
    force: boolean,
  ): Promise<void> {
    if (this.stopped || !this.entry(id)?.enabled) return Promise.resolve();
    if (!force && !this.entry(id)?.dirty) return Promise.resolve();
    return this.queue.request(
      id,
      async (forced) => {
        try {
          await this.exportNow(id, notebook, capture, forced);
        } catch (error) {
          this.failed(id, error, forced);
        }
      },
      force,
    );
  }

  private failed(id: string, error: unknown, loud: boolean): void {
    const entry = this.entry(id);
    if (!entry?.enabled) return;
    entry.error = companionErrorCode(error);
    entry.dirty = true;
    this.persist();
    if (!loud) return;
    const words =
      error instanceof Error && !(error instanceof CompanionError)
        ? error.message
        : companionErrorText(entry.error);
    new Notice(t("notebooks.companion.notice", { error: words }));
  }

  private async exportNow(
    id: string,
    notebook: TFile,
    capture: () => CompanionCapture,
    force: boolean,
  ): Promise<void> {
    const entry = this.entry(id);
    if (this.stopped || !entry?.enabled || !this.app.vault.getFileByPath(notebook.path)) return;
    // The frontmatter as it is now: turned off or moved on another device wins.
    const body = await this.app.vault.cachedRead(notebook);
    if (companionIdFromBody(body) !== id) return;
    this.hydrate(notebook, body);
    if (!entry.enabled || (!force && !entry.dirty)) return;
    if (entry.error === "duplicate") throw new CompanionError("duplicate");
    const revision = this.revision(id);
    const made = capture();
    const target = entry.pdfPath;
    if (made.resources.includes(target)) throw new CompanionError("source");
    const hash = await captureHash(this.app, made);
    const pdf = await this.pdfAt(entry, target);
    if (pdf && pdf.id !== id) throw new CompanionError("occupied");
    if (!pdf && !force) throw new CompanionError("missing");
    if (pdf && pdf.hash === hash && !force) {
      // Already shows this content (another device wrote it, or the edit was undone).
      entry.dirty = this.revision(id) !== revision;
      delete entry.error;
      this.persist();
      return;
    }
    const bytes = await renderCapture(this.app, made, companionPdfSubject(id, hash));
    // Moved, renamed or turned off while it rendered: the next update writes it.
    if (this.stopped || !entry.enabled || entry.pdfPath !== target) return;
    const tx = companionTransaction(target, id, this.device, Date.now());
    await this.ensureFolder(target);
    await this.internally([tx.target, tx.stage, tx.backup], () =>
      replaceCompanionPdf(entry, tx, bytes, this.writeIO()),
    );
    // Trusted from here on by its size and time: never read back.
    const file = this.app.vault.getFileByPath(target);
    if (file)
      entry.written = { path: target, mtime: file.stat.mtime, size: file.stat.size, id, hash };
    entry.dirty = this.revision(id) !== revision;
    delete entry.error;
    this.persist();
  }

  /**
   * Whether the PDF shows the notebook as `hash` says it is now, for the
   * state mark. Quiet: reads at most the PDF's Info, once per change.
   */
  async check(id: string, hash: string): Promise<void> {
    const entry = this.entry(id);
    if (!entry?.enabled || this.queue.busy(id) || entry.error === "duplicate") return;
    const revision = this.revision(id);
    const pdf = await this.pdfAt(entry, entry.pdfPath).catch(() => null);
    if (revision !== this.revision(id) || !entry.enabled) return;
    const dirty = !pdf || pdf.id !== id || pdf.hash !== hash;
    if (entry.dirty === dirty && (!pdf || entry.error !== "missing")) return;
    entry.dirty = dirty;
    if (pdf && entry.error === "missing") delete entry.error;
    this.persist();
  }

  // --- Setting up -------------------------------------------------------------

  private async writeKeys(notebook: TFile, keys: CompanionKeys): Promise<void> {
    for (const view of this.views()) {
      if (view.file === notebook && (await view.writeKeys(keys))) return;
    }
    await this.app.vault.process(notebook, (text) => {
      checkFrontmatter(text);
      return withCompanionKeys(text, keys);
    });
  }

  /** A path for this notebook's PDF at `preferred`, or a free name beside it when another file is there. */
  private async placeFor(
    id: string,
    entry: CompanionEntry,
    notebook: TFile,
    preferred: string,
  ): Promise<string> {
    if (!this.exists(preferred)) return preferred;
    if ((await this.pdfAt(entry, preferred))?.id === id) return preferred;
    return freeCompanionPath(notebook.path, folderOf(preferred), (path) => this.exists(path));
  }

  /**
   * Turns the companion on: the PDF goes in `folder` (the notebook's
   * exports folder) under the notebook's name, or a free name beside a file
   * already there that is not this notebook's. Its id goes into the notebook.
   */
  async enable(notebook: TFile, body: string, folder: string | undefined): Promise<string> {
    if (!isCompanionNotebookPath(notebook.path)) throw new CompanionError("path");
    checkFrontmatter(body);
    const meta = companionMetaFromBody(body);
    let id = meta?.id ?? null;
    while (!id || (!meta && this.entry(id))) id = randomId();
    const known = this.entry(id);
    const preferred =
      meta?.pdfPath ??
      known?.pdfPath ??
      inCompanionFolder(folder ?? folderOf(notebook.path), companionName(notebook.path));
    const entry: CompanionEntry = known ?? {
      notebookPath: notebook.path,
      pdfPath: preferred,
      enabled: false,
      followName: true,
      dirty: true,
    };
    this.journal.entries[id] = entry;
    const path = await this.placeFor(id, entry, notebook, preferred);
    entry.notebookPath = notebook.path;
    entry.pdfPath = path;
    entry.followName = followsName(path, notebook.path);
    entry.enabled = true;
    entry.dirty = true;
    delete entry.error;
    await this.writeKeys(notebook, { id, pdfPath: path, followName: entry.followName });
    this.persist();
    return id;
  }

  /** Turns it off here and, through the frontmatter, on every device. The PDF stays. */
  async disable(notebook: TFile, id: string): Promise<void> {
    const entry = this.entry(id);
    if (entry && entry.notebookPath !== notebook.path) {
      // A copy carrying another notebook's id: it lets go of the id, the other keeps its PDF.
      await this.writeKeys(notebook, { id: null, pdfPath: null, followName: null });
      if (entry.error === "duplicate") delete entry.error;
      this.persist();
      return;
    }
    if (entry) {
      entry.enabled = false;
      entry.dirty = false;
      delete entry.error;
    }
    await this.writeKeys(notebook, { pdfPath: null, followName: null });
    this.persist();
  }

  /** Moves the PDF (or where it will be made) to `folder`, keeping its name. */
  async chooseFolder(notebook: TFile, id: string, folder: string): Promise<void> {
    const entry = this.entry(id);
    if (!entry?.enabled) return;
    let next = inCompanionFolder(folder, fileNameOf(entry.pdfPath));
    if (next.toLowerCase() === entry.pdfPath.toLowerCase()) return;
    if (this.exists(next) && (await this.pdfAt(entry, next))?.id !== id) {
      next = freeCompanionPath(notebook.path, folder, (path) => this.exists(path));
    }
    const current = await this.pdfAt(entry, entry.pdfPath);
    if (current?.id === id && !this.exists(next)) await this.movePdf(entry, next);
    else entry.dirty = true;
    entry.pdfPath = next;
    entry.followName = followsName(next, notebook.path);
    delete entry.error;
    await this.writeKeys(notebook, { pdfPath: next, followName: entry.followName });
    this.persist();
  }

  /**
   * Makes a PDF the user just exported from this notebook its companion (the
   * export dialog's Keep updated): the Subject is set in the bytes in hand,
   * so it starts up to date without rendering again.
   */
  async adopt(
    notebook: TFile,
    body: string,
    path: string,
    bytes: Uint8Array,
    hash: string,
    stamp: (bytes: Uint8Array, id: string, hash: string) => Promise<Uint8Array>,
  ): Promise<void> {
    const file = this.app.vault.getFileByPath(path);
    // The file must still be the one the dialog just wrote.
    if (!file || file.stat.size !== bytes.byteLength) throw new CompanionError("occupied");
    checkFrontmatter(body);
    const meta = companionMetaFromBody(body);
    const id = meta?.id ?? randomId();
    const stamped = await stamp(bytes, id, hash);
    await this.internally([path], () => this.app.vault.modifyBinary(file, stamped.slice().buffer));
    const entry: CompanionEntry = {
      notebookPath: notebook.path,
      pdfPath: path,
      enabled: true,
      followName: followsName(path, notebook.path),
      dirty: false,
      written: { path, mtime: file.stat.mtime, size: file.stat.size, id, hash },
    };
    this.journal.entries[id] = entry;
    await this.writeKeys(notebook, { id, pdfPath: path, followName: entry.followName });
    this.persist();
  }

  // --- The vault's events -----------------------------------------------------

  /** A rename the user made: the PDF's new place, or the notebook's new name for a PDF that follows it. */
  async renamed(file: TAbstractFile, from: string): Promise<void> {
    if (this.isInternal(from) || this.isInternal(file.path)) return;
    const moved = (path: string): string =>
      path === from
        ? file.path
        : path.startsWith(`${from}/`)
          ? file.path + path.slice(from.length)
          : path;
    for (const [id, entry] of Object.entries(this.journal.entries)) {
      try {
        const pdf = moved(entry.pdfPath);
        const note = moved(entry.notebookPath);
        if (pdf !== entry.pdfPath) {
          for (const record of [entry.written, entry.seen])
            if (record?.path === entry.pdfPath) record.path = pdf;
          entry.pdfPath = pdf;
          // A name the user gave stays: it no longer follows the notebook's.
          entry.followName = followsName(pdf, note);
          if (entry.error === "missing") delete entry.error;
          this.persist();
          const notebook = this.app.vault.getFileByPath(note);
          if (entry.enabled && notebook) {
            await this.writeKeys(notebook, { pdfPath: pdf, followName: entry.followName });
          }
        }
        if (note === entry.notebookPath) continue;
        const renamedNote = fileNameOf(note) !== fileNameOf(entry.notebookPath);
        entry.notebookPath = note;
        this.persist();
        if (!entry.enabled || !renamedNote) continue;
        // The name is printed in the PDF's headers.
        this.markDirty(id);
        if (!entry.followName) continue;
        const next = followedCompanionPath(entry.pdfPath, note);
        if (next === entry.pdfPath || this.exists(next)) continue;
        if ((await this.pdfAt(entry, entry.pdfPath))?.id === id) await this.movePdf(entry, next);
        entry.pdfPath = next;
        this.persist();
        const notebook = this.app.vault.getFileByPath(note);
        if (notebook) await this.writeKeys(notebook, { pdfPath: next, followName: true });
      } catch (error) {
        this.failed(id, error, false);
      }
    }
  }

  /**
   * A PDF gone: marked missing, and made again only when asked. Nothing is
   * turned off, since a sync tool reports a move on another device as a
   * delete here, before the frontmatter with the new place arrives.
   */
  deleted(path: string): void {
    if (this.isInternal(path)) return;
    for (const [id, entry] of Object.entries(this.journal.entries)) {
      if (entry.notebookPath === path) {
        delete this.journal.entries[id];
        this.persist();
        continue;
      }
      if (!entry.enabled || (entry.pdfPath !== path && !entry.pdfPath.startsWith(`${path}/`)))
        continue;
      delete entry.written;
      delete entry.seen;
      entry.error = "missing";
      entry.dirty = true;
      this.persist();
    }
  }

  /** A PDF written by anyone but this device: it may be behind (or ahead), so checked at next close. */
  changed(file: TAbstractFile): void {
    if (this.isInternal(file.path)) return;
    const stat = file instanceof TFile ? file.stat : null;
    for (const [id, entry] of Object.entries(this.journal.entries)) {
      if (!entry.enabled || entry.pdfPath !== file.path) continue;
      if (stat && sameStat(entry.written, { path: file.path, mtime: stat.mtime, size: stat.size }))
        continue;
      if (entry.error === "missing") delete entry.error;
      this.markDirty(id);
      this.persist();
    }
    // A picture or an imported PDF a page is drawn from.
    for (const view of this.views()) if (view.uses(file.path)) this.markDirty(view.id);
  }
}
