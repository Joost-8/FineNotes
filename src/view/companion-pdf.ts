/** Obsidian adapter for stable companion PDF associations and journalled writes. */
import { type App, Notice, type TAbstractFile, type TFile } from "obsidian";
import {
  COMPANION_FOLLOW_KEY,
  COMPANION_ID_KEY,
  COMPANION_PDF_KEY,
  CompanionController,
  companionContent,
  companionContentOnly,
  companionIdFromBody,
  companionMetaFromBody,
  companionName,
  companionPath,
  companionResources,
  defaultCompanionPath,
  isCompanionNotebookPath,
  isSyncConflictCopy,
  parseCompanionStore,
  validCompanionId,
  type CompanionDocument,
  type CompanionEntry,
  type CompanionExportOptions,
  type CompanionSnapshot,
  type CompanionStore,
} from "../model/companion-pdf";
import type { InkDocument, Page } from "../model/document";
import { hasBoards, isBoardPage } from "../model/board";
import { assembleJson, readStoredDocument, type DocumentSnapshot } from "../model/serialize";
import { furnitureText } from "../model/furniture";
import { stripInkSuffix } from "../model/new-notebook";
import { paperTheme } from "../canvas/backdrop";
import {
  recoverCompanionWrite,
  replaceCompanionPdf,
  type CompanionWriteIO,
} from "../model/companion-write";
import {
  companionPdfMeta,
  companionPdfSubject,
  stampCompanionPdfSubject,
} from "../export/companion-metadata";
import { exportPagesToPdf, type PdfExportSources } from "./pdf-export";
import { PdfBackdropCache } from "./pdf-backdrop";
import { VaultImageCache } from "./image-cache";
import { exportMarginsOf } from "../export/export-choice";
import { t } from "../i18n/translate";

/** The canonical notebook snapshot, made from the same fragments as a save. */
export function companionDocument(snapshot: DocumentSnapshot, paperWidth: number): InkDocument {
  return readStoredDocument(JSON.parse(assembleJson(snapshot)), paperWidth);
}

export function companionRenderPages(
  doc: CompanionDocument,
  cropBoard: (page: Page) => Page,
): Page[] {
  return hasBoards(doc)
    ? doc.pages.map((page) => (isBoardPage(doc, page) ? cropBoard(page) : page))
    : doc.pages;
}

/** Match transformed export pages by their stable IDs, including cropped PDF margins. */
export function companionFurniture(
  doc: CompanionDocument,
  title: string,
): NonNullable<PdfExportSources["furniture"]> {
  const indices = new Map(doc.pages.map((page, index) => [page.id, index]));
  return (page) => furnitureText(doc, indices.get(page.id) ?? -1, title);
}

export function companionOptions(sources: PdfExportSources): CompanionExportOptions {
  return {
    usePressure: sources.usePressure,
    highlighterAlpha: sources.highlighterAlpha,
    plainPaper: sources.plainPaper === true,
    withoutTapes: sources.withoutTapes === true,
    margins: sources.margins,
  };
}

export async function detachedCompanionSnapshot(params: {
  app: App;
  id: string;
  title: string;
  doc: CompanionDocument;
  pages: Page[];
  options: CompanionExportOptions;
}): Promise<CompanionSnapshot> {
  const { app, id, title, doc, pages, options } = params;
  const { fingerprint, contentHash, resources } = await fingerprintCompanionDoc(
    app,
    doc,
    title,
    options,
  );
  return {
    fingerprint,
    contentHash,
    resources,
    export: async () => {
      const images = new VaultImageCache(app);
      const pdf = pages.some((page) => page.backdrop.kind === "pdf")
        ? new PdfBackdropCache(app)
        : null;
      try {
        return await exportPagesToPdf(
          pages,
          {
            readPdf: async (path) => {
              const file = app.vault.getFileByPath(path);
              if (!file) throw new Error(t("notebooks.companion.errMissingSource", { path }));
              return app.vault.readBinary(file);
            },
            pdf,
            images,
            paper: paperTheme(false),
            usePressure: options.usePressure,
            highlighterAlpha: options.highlighterAlpha,
            plainPaper: options.plainPaper === true,
            withoutTapes: options.withoutTapes === true,
            margins: exportMarginsOf(options.margins),
            furniture: companionFurniture(doc, title),
          },
          { title, subject: companionPdfSubject(id, contentHash) },
        );
      } finally {
        images.destroy();
        pdf?.destroy();
      }
    },
  };
}

interface ResourceDigest {
  file: TFile;
  mtime: number;
  size: number;
  digest: Promise<string>;
}

const resourceDigests = new WeakMap<App, Map<string, ResourceDigest>>();

async function digestBytes(bytes: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function resourceDigest(app: App, path: string): Promise<string> {
  const file = app.vault.getFileByPath(path);
  if (!file) throw new Error(t("notebooks.companion.errMissingSource", { path }));
  const cache = resourceDigests.get(app) ?? new Map<string, ResourceDigest>();
  resourceDigests.set(app, cache);
  const cached = cache.get(path);
  const { mtime, size } = file.stat;
  if (cached?.file === file && cached.mtime === mtime && cached.size === size) return cached.digest;
  const digest = app.vault
    .readBinary(file)
    .then(digestBytes)
    .then((hash) => {
      if (
        cache.get(path) !== record ||
        app.vault.getFileByPath(path) !== file ||
        file.stat.mtime !== mtime ||
        file.stat.size !== size
      )
        throw new Error(t("notebooks.companion.errChangedDuringCheck"));
      return hash;
    })
    .catch((error: unknown) => {
      if (cache.get(path) === record) cache.delete(path);
      throw error;
    });
  const record = { file, mtime, size, digest };
  cache.set(path, record);
  return digest;
}

export async function fingerprintCompanionDoc(
  app: App,
  doc: CompanionDocument,
  title: string,
  options: CompanionExportOptions,
): Promise<{ fingerprint: string; contentHash: string; resources: string[] }> {
  const resources = companionResources(doc);
  const assets = [];
  for (const path of resources) assets.push({ path, digest: await resourceDigest(app, path) });
  const [fingerprint, fullContentHash] = await Promise.all([
    digestBytes(new TextEncoder().encode(companionContent(doc, options, assets) + title)),
    digestBytes(new TextEncoder().encode(companionContentOnly(doc, assets) + title)),
  ]);
  return { fingerprint, contentHash: fullContentHash.slice(0, 16), resources };
}

// External sync can report a rename or replacement as separate delete and create events.
const COMPANION_DELETE_SETTLE_MS = 5000;

export class CompanionPdfManager {
  readonly store: CompanionStore = { version: 1, entries: {} };
  readonly controller: CompanionController;
  private readonly internal = new Set<string>();
  private readonly identities = new Map<
    string,
    { mtime: number; size: number; id: string | null; contentHash: string | null }
  >();
  private readonly trashing = new Set<string>();
  private readonly pendingDeletes = new Map<
    string,
    {
      path: string;
      timer: number;
      observed: Set<string>;
    }
  >();
  private readonly recentPdfs = new Map<string, number>();
  private readonly statusListeners = new Set<() => void>();
  private readonly bindings = new Map<string, Promise<void>>();
  private readonly configurations = new WeakMap<TFile, Promise<string>>();

  constructor(
    private readonly app: App,
    private readonly save: (store: CompanionStore) => Promise<void>,
  ) {
    this.controller = new CompanionController(this.store, {
      exists: (path) => this.app.vault.getAbstractFileByPath(path) !== null,
      pdfIdentity: (path) => this.identity(path),
      pdfContentHash: (path) => this.contentHash(path),
      pdfPaths: () =>
        this.app.vault
          .getFiles()
          .filter((f) => f.extension.toLowerCase() === "pdf")
          .map((f) => f.path),
      rename: (from, to) => this.rename(from, to, true),
      replace: async (entry, bytes, id) => {
        const target = entry.pdfPath;
        if (this.pendingDeletes.has(id)) return false;
        return replaceCompanionPdf(entry, bytes, id, {
          ...this.writeIO(),
          cancelled: () => this.pendingDeletes.get(id)?.path === target,
        });
      },
      persist: () => this.persist(),
    });
  }

  load(raw: unknown): void {
    this.store.entries = parseCompanionStore(raw).entries;
    for (const [id, entry] of Object.entries(this.store.entries))
      if (entry.deletedAt !== undefined) this.scheduleDelete(id, entry, entry.deletedAt);
  }

  modified(path: string): void {
    this.identities.delete(path);
    resourceDigests.get(this.app)?.delete(path);
    if (this.isInternal(path)) return;
    for (const [id, entry] of Object.entries(this.store.entries))
      if (entry.pdfPath === path) {
        this.controller.markChanged(id);
        this.statusChanged();
      }
    if (
      /[.]pdf$/i.test(path) &&
      !/[.]fn-[a-f0-9]{16}-(?:pending|backup)[.]pdf$/i.test(path) &&
      !isSyncConflictCopy(path) &&
      this.app.vault.getFileByPath(path)
    ) {
      this.recentPdfs.delete(path);
      this.recentPdfs.set(path, Date.now());
      if (this.recentPdfs.size > 16) this.recentPdfs.delete(this.recentPdfs.keys().next().value!);
      for (const pending of this.pendingDeletes.values()) {
        if (pending.path !== path && pending.observed.size < 16) pending.observed.add(path);
      }
    }
  }

  async recoverAll(): Promise<void> {
    for (const [id, entry] of Object.entries(this.store.entries)) {
      if (!entry.enabled || !entry.transaction || entry.deletedAt !== undefined) continue;
      try {
        await this.recover(id);
      } catch (error) {
        entry.dirty = true;
        entry.error = error instanceof Error ? error.message : String(error);
        await this.persist();
      }
    }
  }

  persist(): Promise<void> {
    this.statusChanged();
    return this.save(this.store);
  }

  observeStatus(listener: () => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private statusChanged(): void {
    for (const listener of this.statusListeners) listener();
  }

  isInternal(path: string): boolean {
    return this.internal.has(path);
  }

  entry(id: string | null): CompanionEntry | undefined {
    return id ? this.store.entries[id] : undefined;
  }

  /**
   * Hydrates a local store entry from portable notebook frontmatter when a
   * notebook enabled on another device is opened for the first time here.
   */
  hydrateFromBody(notebook: TFile, body: string): CompanionEntry | undefined {
    const meta = companionMetaFromBody(body);
    if (!meta || !isCompanionNotebookPath(notebook.path)) return undefined;
    const existing = this.store.entries[meta.id];
    if (existing) {
      if (!meta.pdfPath) {
        this.cancelDelete(meta.id);
        if (existing.enabled) {
          this.disable(existing);
          this.persistHydration();
        }
        return existing;
      }
      let changed = false;
      if (existing.pdfPath !== meta.pdfPath || !existing.enabled) {
        this.cancelDelete(meta.id);
        existing.pdfPath = meta.pdfPath;
        existing.enabled = true;
        existing.awaitingPdf = true;
        this.controller.markChanged(meta.id);
        delete existing.error;
        changed = true;
      }
      if (meta.followName !== undefined && existing.followName !== meta.followName) {
        existing.followName = meta.followName;
        changed = true;
      }
      if (changed) this.persistHydration();
      return existing;
    }
    if (!meta.pdfPath) return undefined;
    const entry: CompanionEntry = {
      notebookPath: notebook.path,
      pdfPath: meta.pdfPath,
      enabled: true,
      followName: meta.followName !== false,
      dirty: true,
      awaitingPdf: true,
    };
    this.store.entries[meta.id] = entry;
    this.persistHydration();
    return entry;
  }

  private persistHydration(): void {
    void this.persist().catch((error: unknown) => this.noticeError(error));
  }

  private disable(entry: CompanionEntry): void {
    entry.enabled = false;
    entry.dirty = false;
    delete entry.lastFingerprint;
    delete entry.awaitingPdf;
    delete entry.error;
  }

  private noticeError(error: unknown): void {
    new Notice(
      t("notebooks.companion.noticePrefix", {
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  status(id: string | null): string {
    const entry = this.entry(id);
    if (!entry?.enabled) return t("notebooks.companion.statusOff");
    if (entry.error) return t("notebooks.companion.statusError", { error: entry.error });
    if (id && this.controller.isRunning(id)) return t("notebooks.companion.statusUpdating");
    if (!this.app.vault.getFileByPath(entry.pdfPath)) return t("notebooks.companion.statusMissing");
    return entry.dirty
      ? t("notebooks.companion.statusNeedsUpdate")
      : t("notebooks.companion.statusUpToDate");
  }

  private async pdfMeta(path: string): Promise<{ id: string | null; contentHash: string | null }> {
    const file = this.app.vault.getFileByPath(path);
    if (!file) return { id: null, contentHash: null };
    const cached = this.identities.get(path);
    if (cached && cached.mtime === file.stat.mtime && cached.size === file.stat.size) {
      return { id: cached.id, contentHash: cached.contentHash };
    }
    const mtime = file.stat.mtime;
    const size = file.stat.size;
    const meta = await companionPdfMeta(await this.app.vault.readBinary(file));
    if (
      this.app.vault.getFileByPath(path) !== file ||
      file.stat.mtime !== mtime ||
      file.stat.size !== size
    )
      throw new Error(t("notebooks.companion.errChangedDuringCheck"));
    const id = meta?.id ?? null;
    const contentHash = meta?.contentHash ?? null;
    this.identities.set(path, { mtime, size, id, contentHash });
    return { id, contentHash };
  }

  private async identity(path: string): Promise<string | null> {
    return (await this.pdfMeta(path)).id;
  }

  private async contentHash(path: string): Promise<string | null> {
    return (await this.pdfMeta(path)).contentHash;
  }

  private async ensureFolder(path: string): Promise<void> {
    const folder = path.split("/").slice(0, -1).join("/");
    if (!folder || this.app.vault.getFolderByPath(folder)) return;
    try {
      await this.app.vault.createFolder(folder);
    } catch {
      if (!this.app.vault.getFolderByPath(folder))
        throw new Error(t("notebooks.companion.errCreateFolder", { path: folder }));
    }
  }

  private async rename(from: string, to: string, links: boolean): Promise<void> {
    const file = this.app.vault.getFileByPath(from);
    if (!file) throw new Error(t("notebooks.companion.errMissingPath", { path: from }));
    if (this.app.vault.getAbstractFileByPath(to))
      throw new Error(t("notebooks.companion.errTargetExists", { path: to }));
    await this.ensureFolder(to);
    this.identities.delete(from);
    this.identities.delete(to);
    const paths = [from, to].filter((path) => !this.isInternal(path));
    paths.forEach((path) => this.internal.add(path));
    try {
      if (links) await this.app.fileManager.renameFile(file, to);
      else await this.app.vault.rename(file, to);
    } finally {
      paths.forEach((path) => this.internal.delete(path));
    }
  }

  private writeIO(): CompanionWriteIO {
    return {
      exists: (path) => this.app.vault.getAbstractFileByPath(path) !== null,
      identity: (path) => this.identity(path),
      persist: () => this.persist(),
      create: async (path, bytes) => {
        await this.ensureFolder(path);
        this.identities.delete(path);
        await this.app.vault.createBinary(path, bytes.slice().buffer);
      },
      rename: (from, to) => this.rename(from, to, false),
      remove: async (path) => {
        const file = this.app.vault.getFileByPath(path);
        if (!file) return;
        this.trashing.add(path);
        try {
          await this.app.fileManager.trashFile(file);
        } finally {
          this.trashing.delete(path);
        }
      },
    };
  }

  async recover(id: string): Promise<void> {
    const entry = this.entry(id);
    if (!entry?.enabled || !entry.transaction || entry.deletedAt !== undefined) return;
    const paths = [entry.transaction.target, entry.transaction.stage, entry.transaction.backup];
    paths.forEach((path) => this.internal.add(path));
    try {
      await recoverCompanionWrite(entry, id, this.writeIO());
    } finally {
      paths.forEach((path) => this.internal.delete(path));
    }
  }

  bind(id: string, notebook: TFile): Promise<void> {
    const pending = this.bindings.get(id);
    if (pending) return pending.then(() => this.bind(id, notebook));
    const job = this.bindOnce(id, notebook).finally(() => this.bindings.delete(id));
    this.bindings.set(id, job);
    return job;
  }

  private async bindOnce(id: string, notebook: TFile): Promise<void> {
    const entry = this.entry(id);
    if (!entry) return;
    const old = this.app.vault.getFileByPath(entry.notebookPath);
    if (
      entry.notebookPath !== notebook.path &&
      old &&
      companionIdFromBody(await this.app.vault.cachedRead(old)) === id
    )
      throw new Error(t("notebooks.companion.errDuplicateNotebook"));
    if (this.controller.isRunning(id) && entry.notebookPath === notebook.path) return;
    await this.controller.wait(id).catch(() => {});
    await this.recover(id);
    if (entry.notebookPath !== notebook.path) {
      const prevPdf = entry.pdfPath;
      await this.controller.followNotebookName(id, notebook.path);
      if (entry.pdfPath !== prevPdf && entry.enabled) {
        await this.syncFrontmatter(notebook, id, entry);
      }
    }
  }

  private async syncFrontmatter(notebook: TFile, id: string, entry: CompanionEntry): Promise<void> {
    await this.app.fileManager.processFrontMatter(
      notebook,
      (frontmatter: Record<string, unknown>) => {
        frontmatter[COMPANION_ID_KEY] = id;
        if (entry.enabled) {
          frontmatter[COMPANION_PDF_KEY] = entry.pdfPath;
          frontmatter[COMPANION_FOLLOW_KEY] = entry.followName;
        } else {
          delete frontmatter[COMPANION_PDF_KEY];
          delete frontmatter[COMPANION_FOLLOW_KEY];
        }
      },
    );
  }

  private generateId(): string {
    let id: string;
    do {
      id = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
    } while (this.store.entries[id]);
    return id;
  }

  configure(
    notebook: TFile,
    _body: string,
    folder: string | undefined,
    patch: {
      enabled?: boolean;
      followName?: boolean;
      pdfPath?: string;
    },
  ): Promise<string> {
    return this.configureSerial(notebook, async () => {
      const body = await this.app.vault.read(notebook);
      return this.configureOnce(notebook, body, folder, patch);
    });
  }

  private configureSerial(notebook: TFile, run: () => Promise<string>): Promise<string> {
    const previous = this.configurations.get(notebook) ?? Promise.resolve("");
    const job = previous
      .catch(() => "")
      .then(run)
      .finally(() => {
        if (this.configurations.get(notebook) === job) this.configurations.delete(notebook);
      });
    this.configurations.set(notebook, job);
    return job;
  }

  private async configureOnce(
    notebook: TFile,
    body: string,
    folder: string | undefined,
    patch: {
      enabled?: boolean;
      followName?: boolean;
      pdfPath?: string;
    },
  ): Promise<string> {
    if (!isCompanionNotebookPath(notebook.path))
      throw new Error(t("notebooks.companion.errNotebookUnavailable"));
    this.hydrateFromBody(notebook, body);
    let id = companionIdFromBody(body);
    if (!id) {
      id = this.generateId();
      const identity = id;
      await this.app.fileManager.processFrontMatter(
        notebook,
        (frontmatter: Record<string, unknown>) => {
          frontmatter[COMPANION_ID_KEY] = identity;
        },
      );
    }
    if (!validCompanionId(id)) throw new Error(t("notebooks.companion.errInvalidIdentity"));
    if (patch.enabled === false && this.entry(id)) {
      const entry = this.entry(id)!;
      if (entry.notebookPath !== notebook.path) await this.bind(id, notebook);
      this.cancelDelete(id);
      this.disable(entry);
      await this.syncFrontmatter(notebook, id, entry);
      await this.persist();
      return id;
    }
    await this.controller.wait(id).catch(() => {});
    await this.bind(id, notebook);
    const previous = this.entry(id);
    const entry: CompanionEntry = previous ?? {
      notebookPath: notebook.path,
      pdfPath: defaultCompanionPath(notebook.path, folder),
      enabled: false,
      followName: true,
      dirty: true,
    };
    const target = patch.pdfPath ? companionPath(patch.pdfPath) : entry.pdfPath;
    const existing = this.app.vault.getAbstractFileByPath(target);
    if (existing && (await this.identity(target)) !== id)
      throw new Error(t("notebooks.companion.errTargetExists", { path: target }));
    if (
      Object.entries(this.store.entries).some(
        ([other, e]) => other !== id && e.pdfPath.toLowerCase() === target.toLowerCase(),
      )
    )
      throw new Error(t("notebooks.companion.errOwnedByOther"));
    this.store.entries[id] = entry;
    if (target !== entry.pdfPath) {
      let current: string | null;
      try {
        current = await this.controller.resolve(id);
      } catch {
        // The old PDF cannot be told apart (two copies carry this identity, or
        // another file sits at its path): a target chosen by hand starts a
        // fresh PDF there and leaves every old file as it is.
        current = null;
      }
      if (current && !existing) await this.rename(current, target, true);
      this.controller.claim(id, target);
      if (!current && !existing) delete entry.lastFingerprint;
    }
    if (patch.followName !== undefined) entry.followName = patch.followName;
    if (patch.enabled !== undefined) {
      this.cancelDelete(id);
      if (!entry.enabled && patch.enabled) delete entry.awaitingPdf;
      entry.enabled = patch.enabled;
    }
    if (patch.followName === true)
      await this.controller.followNotebookName(id, notebook.path, true);
    delete entry.error;
    await this.syncFrontmatter(notebook, id, entry);
    await this.persist();
    return id;
  }

  /**
   * Links a PDF that FineNotes just exported from this notebook as its
   * Companion PDF: stamps our invisible Subject identity in-place (no
   * re-rendering) and records the initial fingerprint so it starts Up to date.
   */
  adoptExportedPdf(
    notebook: TFile,
    exportedPath: string,
    rendered: Pick<CompanionSnapshot, "fingerprint" | "contentHash" | "resources">,
    exportedBytes: ArrayBuffer,
  ): Promise<string> {
    return this.configureSerial(notebook, () =>
      this.adoptExportedPdfOnce(notebook, exportedPath, rendered, exportedBytes),
    );
  }

  private async adoptExportedPdfOnce(
    notebook: TFile,
    exportedPath: string,
    rendered: Pick<CompanionSnapshot, "fingerprint" | "contentHash" | "resources">,
    exportedBytes: ArrayBuffer,
  ): Promise<string> {
    if (!isCompanionNotebookPath(notebook.path))
      throw new Error(t("notebooks.companion.errNotebookUnavailable"));
    const cleanTarget = companionPath(exportedPath);
    const pdfFile = this.app.vault.getFileByPath(cleanTarget);
    if (!pdfFile) throw new Error(t("notebooks.companion.errMissing"));

    const body = await this.app.vault.read(notebook);
    this.hydrateFromBody(notebook, body);
    const id = companionIdFromBody(body) ?? this.generateId();
    if (this.entry(id)?.enabled) throw new Error(t("notebooks.companion.errAlreadyEnabled"));
    await this.bind(id, notebook);
    if (rendered.resources.includes(cleanTarget))
      throw new Error(t("notebooks.companion.errSourceConflict"));
    if (
      Object.entries(this.store.entries).some(
        ([other, e]) => other !== id && e.pdfPath.toLowerCase() === cleanTarget.toLowerCase(),
      )
    )
      throw new Error(t("notebooks.companion.errOwnedByOther"));

    const { mtime, size } = pdfFile.stat;
    const raw = await this.app.vault.readBinary(pdfFile);
    if (
      raw.byteLength !== exportedBytes.byteLength ||
      (await digestBytes(raw)) !== (await digestBytes(exportedBytes))
    )
      throw new Error(t("notebooks.companion.errTargetChanged"));
    const stamped = await stampCompanionPdfSubject(raw, id, rendered.contentHash);
    if (
      this.app.vault.getFileByPath(cleanTarget) !== pdfFile ||
      pdfFile.stat.mtime !== mtime ||
      pdfFile.stat.size !== size
    )
      throw new Error(t("notebooks.companion.errTargetChanged"));
    this.internal.add(cleanTarget);
    this.identities.delete(cleanTarget);
    try {
      await this.app.vault.modifyBinary(pdfFile, stamped.slice().buffer);
    } finally {
      this.internal.delete(cleanTarget);
    }

    const fileName = cleanTarget.split("/").pop() ?? "";
    const followName = fileName.toLowerCase() === companionName(notebook.path).toLowerCase();
    const entry: CompanionEntry = {
      notebookPath: notebook.path,
      pdfPath: cleanTarget,
      enabled: true,
      followName,
      dirty: false,
      lastFingerprint: rendered.fingerprint,
    };
    this.store.entries[id] = entry;
    await this.syncFrontmatter(notebook, id, entry);
    await this.persist();
    return id;
  }

  async assess(
    id: string,
    notebook: TFile,
    snapshot: () => Promise<CompanionSnapshot | undefined>,
  ): Promise<void> {
    const entry = this.entry(id);
    if (!entry?.enabled) return;
    await this.bind(id, notebook);
    const path = entry.pdfPath;
    const revision = this.controller.revision(id);
    const owned = this.app.vault.getFileByPath(path) !== null && (await this.identity(path)) === id;
    const current = owned ? await snapshot() : undefined;
    if (owned && !current) return;
    const dirty = !current || !(await this.controller.isCurrent(entry, path, current));
    if (
      entry.pdfPath !== path ||
      !entry.enabled ||
      this.controller.isRunning(id) ||
      revision !== this.controller.revision(id)
    )
      return;
    const changed = entry.dirty !== dirty || (owned && (entry.awaitingPdf || entry.error));
    entry.dirty = dirty;
    if (owned) {
      delete entry.awaitingPdf;
      delete entry.error;
    }
    if (current && !dirty) entry.lastFingerprint = current.fingerprint;
    if (changed) await this.persist();
  }

  async update(
    id: string,
    notebook: TFile,
    snapshot: () => Promise<CompanionSnapshot>,
    force: boolean,
  ): Promise<void> {
    if (
      !this.entry(id)?.enabled ||
      this.pendingDeletes.has(id) ||
      !this.app.vault.getFileByPath(notebook.path)
    )
      return;
    const body = await this.app.vault.cachedRead(notebook);
    if (companionIdFromBody(body) !== id || !this.hydrateFromBody(notebook, body)?.enabled) return;
    await this.bind(id, notebook);
    if (this.pendingDeletes.has(id)) return;
    const run = this.controller.update(id, snapshot, force);
    this.statusChanged();
    try {
      await run;
    } finally {
      this.statusChanged();
    }
  }

  async renamed(file: TAbstractFile, from: string): Promise<void> {
    this.modified(from);
    this.modified(file.path);
    if (this.isInternal(from) || this.isInternal(file.path)) return;
    const moved = (path: string): string =>
      path === from
        ? file.path
        : path.startsWith(from + "/")
          ? file.path + path.slice(from.length)
          : path;
    let changed = false;
    for (const [id, entry] of Object.entries(this.store.entries)) {
      const pdf = moved(entry.pdfPath);
      if (pdf !== entry.pdfPath) {
        this.cancelDelete(id);
        entry.pdfPath = pdf;
        changed = true;
        const noteFile = this.app.vault.getFileByPath(entry.notebookPath);
        if (noteFile && entry.enabled) await this.syncFrontmatter(noteFile, id, entry);
      }
      const note = moved(entry.notebookPath);
      if (note !== entry.notebookPath) {
        this.controller.markChanged(id);
        await this.controller.wait(id).catch(() => {});
        const prevPdf = entry.pdfPath;
        await this.controller.followNotebookName(id, note);
        if (entry.pdfPath !== prevPdf && entry.enabled) {
          const noteFile = this.app.vault.getFileByPath(note);
          if (noteFile) await this.syncFrontmatter(noteFile, id, entry);
        }
        changed = true;
      }
    }
    if (changed) await this.persist();
  }

  private cancelDelete(id: string): void {
    const pending = this.pendingDeletes.get(id);
    if (pending) window.clearTimeout(pending.timer);
    this.pendingDeletes.delete(id);
    const entry = this.entry(id);
    if (entry) delete entry.deletedAt;
  }

  destroy(): void {
    for (const { timer } of this.pendingDeletes.values()) window.clearTimeout(timer);
    this.pendingDeletes.clear();
  }

  private scheduleDelete(id: string, entry: CompanionEntry, time: number): void {
    const path = entry.pdfPath;
    const timer = window.setTimeout(
      () => void this.finishDelete(id, path).catch((error: unknown) => this.noticeError(error)),
      Math.max(0, time + COMPANION_DELETE_SETTLE_MS - Date.now()),
    );
    entry.deletedAt = time;
    const observed = new Set<string>();
    for (const [candidate, modifiedAt] of this.recentPdfs) {
      if (candidate !== path && modifiedAt > time - COMPANION_DELETE_SETTLE_MS)
        observed.add(candidate);
    }
    this.pendingDeletes.set(id, { path, timer, observed });
  }

  deleted(path: string): void {
    this.modified(path);
    if (this.trashing.has(path)) return;
    let changed = false;
    for (const [id, entry] of Object.entries(this.store.entries)) {
      if (!entry.enabled || this.pendingDeletes.has(id)) continue;
      if (entry.pdfPath !== path && !entry.pdfPath.startsWith(path + "/")) continue;
      this.scheduleDelete(id, entry, Date.now());
      this.controller.markChanged(id);
      changed = true;
    }
    if (changed) this.persistHydration();
  }

  private async finishDelete(id: string, target: string): Promise<void> {
    try {
      const entry = this.entry(id);
      if (!entry?.enabled || entry.pdfPath !== target) return;
      await this.controller.wait(id).catch(() => {});
      if (
        this.pendingDeletes.get(id)?.path !== target ||
        !entry.enabled ||
        entry.pdfPath !== target ||
        this.app.vault.getFileByPath(target)
      )
        return;
      const pending = this.pendingDeletes.get(id);
      if (!pending) return;
      const note = this.app.vault.getFileByPath(entry.notebookPath);
      if (note) {
        // Sync may have already supplied the new binding even if no view is open.
        const body = await this.app.vault.read(note);
        const meta = companionMetaFromBody(body);
        if (meta?.id !== id || meta.pdfPath !== target) {
          if (meta?.id === id) this.hydrateFromBody(note, body);
          return;
        }
        const matches: string[] = [];
        for (const candidate of pending.observed) {
          if ((await this.identity(candidate).catch(() => null)) === id) matches.push(candidate);
        }
        // Keep the association intact when sync delivers several owned candidates.
        if (matches.length > 1) {
          entry.error = t("notebooks.companion.errMultiplePdfs");
          return;
        }
        const moved = matches[0];
        await this.app.fileManager.processFrontMatter(
          note,
          (frontmatter: Record<string, unknown>) => {
            if (
              this.pendingDeletes.get(id)?.path !== target ||
              entry.pdfPath !== target ||
              this.app.vault.getFileByPath(target) ||
              frontmatter[COMPANION_ID_KEY] !== id ||
              frontmatter[COMPANION_PDF_KEY] !== target
            )
              return;
            if (moved) {
              frontmatter[COMPANION_PDF_KEY] = moved;
              entry.pdfPath = moved;
              entry.awaitingPdf = true;
              delete entry.error;
            } else {
              delete frontmatter[COMPANION_PDF_KEY];
              delete frontmatter[COMPANION_FOLLOW_KEY];
              this.disable(entry);
            }
          },
        );
      } else {
        this.disable(entry);
      }
      if (!entry.enabled) {
        const name = stripInkSuffix(note?.basename ?? entry.notebookPath.split("/").pop() ?? "");
        new Notice(t("notebooks.companion.deletedDisabled", { name }), 6000);
      }
    } finally {
      if (this.pendingDeletes.get(id)?.path === target) {
        this.cancelDelete(id);
        await this.persist();
      }
    }
  }
}
