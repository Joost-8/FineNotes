/** Obsidian adapter for stable companion PDF associations and journalled writes. */
import { type App, type TAbstractFile, type TFile } from "obsidian";
import {
  COMPANION_FOLLOW_KEY,
  COMPANION_ID_KEY,
  COMPANION_PDF_KEY,
  CompanionController,
  companionContent,
  companionIdFromBody,
  companionMetaFromBody,
  companionName,
  companionPath,
  companionResources,
  defaultCompanionPath,
  isCompanionNotebookPath,
  parseCompanionStore,
  validCompanionId,
  type CompanionEntry,
  type CompanionExportOptions,
  type CompanionSnapshot,
  type CompanionStore,
} from "../model/companion-pdf";
import type { InkDocument } from "../model/document";
import {
  recoverCompanionWrite,
  replaceCompanionPdf,
  type CompanionWriteIO,
} from "../model/companion-write";
import { companionPdfIdentity, stampCompanionPdfSubject } from "../export/companion-metadata";
import { t } from "../i18n/translate";

export async function companionDigest(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function fingerprintCompanionDoc(
  app: App,
  doc: Pick<InkDocument, "pages">,
  title: string,
  options: CompanionExportOptions,
): Promise<{ fingerprint: string; resources: string[] }> {
  const resources = companionResources(doc);
  const assets = resources.map((path) => {
    const file = app.vault.getFileByPath(path);
    return { path, mtime: file?.stat.mtime ?? null, size: file?.stat.size ?? null };
  });
  const fingerprint = await companionDigest(companionContent(doc, options, assets) + title);
  return { fingerprint, resources };
}

export class CompanionPdfManager {
  readonly store: CompanionStore = { version: 1, entries: {} };
  readonly controller: CompanionController;
  private readonly internal = new Set<string>();
  private readonly identities = new Map<
    string,
    { mtime: number; size: number; id: string | null }
  >();
  private readonly bindings = new Map<string, Promise<void>>();
  private readonly configurations = new WeakMap<TFile, Promise<string>>();

  constructor(
    private readonly app: App,
    private readonly save: (store: CompanionStore) => Promise<void>,
  ) {
    this.controller = new CompanionController(this.store, {
      exists: (path) => this.app.vault.getAbstractFileByPath(path) !== null,
      pdfIdentity: (path) => this.identity(path),
      pdfPaths: () =>
        this.app.vault
          .getFiles()
          .filter((f) => f.extension.toLowerCase() === "pdf")
          .map((f) => f.path),
      rename: (from, to) => this.rename(from, to, true),
      replace: async (entry, bytes, id) => {
        const paths = [
          entry.pdfPath,
          `${entry.pdfPath}.fn-${id}-pending.pdf`,
          `${entry.pdfPath}.fn-${id}-backup.pdf`,
        ];
        paths.forEach((path) => this.internal.add(path));
        try {
          await replaceCompanionPdf(entry, bytes, id, this.writeIO());
        } finally {
          paths.forEach((path) => this.internal.delete(path));
        }
      },
      persist: () => this.persist(),
    });
  }

  load(raw: unknown): void {
    this.store.entries = parseCompanionStore(raw).entries;
  }

  modified(path: string): void {
    this.identities.delete(path);
  }

  async recoverAll(): Promise<void> {
    for (const [id, entry] of Object.entries(this.store.entries)) {
      if (!entry.transaction) continue;
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
    return this.save(this.store);
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
    if (!meta) return undefined;
    const existing = this.store.entries[meta.id];
    if (existing) {
      if (meta.pdfPath && !existing.enabled) {
        existing.enabled = true;
        existing.pdfPath = meta.pdfPath;
        if (meta.followName !== undefined) existing.followName = meta.followName;
        existing.dirty = true;
        void this.persist();
      }
      return existing;
    }
    if (!meta.pdfPath || !isCompanionNotebookPath(notebook.path)) return undefined;
    const entry: CompanionEntry = {
      notebookPath: notebook.path,
      pdfPath: meta.pdfPath,
      enabled: true,
      followName: meta.followName !== false,
      dirty: true,
    };
    this.store.entries[meta.id] = entry;
    void this.persist();
    return entry;
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

  private async identity(path: string): Promise<string | null> {
    const file = this.app.vault.getFileByPath(path);
    if (!file) return null;
    const cached = this.identities.get(path);
    if (cached && cached.mtime === file.stat.mtime && cached.size === file.stat.size)
      return cached.id;
    const mtime = file.stat.mtime;
    const size = file.stat.size;
    const id = await companionPdfIdentity(await this.app.vault.readBinary(file));
    if (file.stat.mtime !== mtime || file.stat.size !== size)
      throw new Error("PDF changed while its ownership was checked.");
    this.identities.set(path, { mtime, size, id });
    return id;
  }

  private async ensureFolder(path: string): Promise<void> {
    const folder = path.split("/").slice(0, -1).join("/");
    if (!folder || this.app.vault.getFolderByPath(folder)) return;
    try {
      await this.app.vault.createFolder(folder);
    } catch {
      if (!this.app.vault.getFolderByPath(folder))
        throw new Error(`Cannot create PDF folder: ${folder}`);
    }
  }

  private async rename(from: string, to: string, links: boolean): Promise<void> {
    const file = this.app.vault.getFileByPath(from);
    if (!file) throw new Error(`Missing PDF: ${from}`);
    if (this.app.vault.getAbstractFileByPath(to)) throw new Error(`Target already exists: ${to}`);
    await this.ensureFolder(to);
    this.identities.delete(from);
    this.identities.delete(to);
    this.internal.add(from);
    this.internal.add(to);
    try {
      if (links) await this.app.fileManager.renameFile(file, to);
      else await this.app.vault.rename(file, to);
    } finally {
      this.internal.delete(from);
      this.internal.delete(to);
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
        if (file) await this.app.fileManager.trashFile(file);
      },
    };
  }

  async recover(id: string): Promise<void> {
    const entry = this.entry(id);
    if (!entry?.transaction) return;
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
      throw new Error(
        "Two notebooks have the same companion identity. Remove the companion ID from the copied notebook before enabling it.",
      );
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
    const previous = this.configurations.get(notebook) ?? Promise.resolve("");
    const job = previous
      .catch(() => "")
      .then(async () => {
        const body = await this.app.vault.read(notebook);
        return this.configureOnce(notebook, body, folder, patch);
      })
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
      throw new Error("Companion PDFs are available for FineNotes notebooks and pages.");
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
    if (!validCompanionId(id)) throw new Error("Invalid companion identity");
    if (patch.enabled === false && this.entry(id)) {
      const entry = this.entry(id)!;
      if (entry.notebookPath !== notebook.path) await this.bind(id, notebook);
      entry.enabled = false;
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
      throw new Error(
        "Another file already exists at that path. Choose a different folder or filename.",
      );
    if (
      Object.entries(this.store.entries).some(
        ([other, e]) => other !== id && e.pdfPath.toLowerCase() === target.toLowerCase(),
      )
    )
      throw new Error("Another notebook already owns this PDF target.");
    this.store.entries[id] = entry;
    if (target !== entry.pdfPath) {
      let current: string | null;
      try {
        current = await this.controller.resolve(id);
      } catch (error) {
        if (
          this.app.vault.getAbstractFileByPath(entry.pdfPath) &&
          (await this.identity(entry.pdfPath)) !== id
        )
          current = null;
        else throw error;
      }
      if (current && !existing) await this.rename(current, target, true);
      this.controller.claim(id, target);
      if (!current && !existing) delete entry.lastFingerprint;
    }
    if (patch.followName !== undefined) entry.followName = patch.followName;
    if (patch.enabled !== undefined) entry.enabled = patch.enabled;
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
  async adoptExportedPdf(
    notebook: TFile,
    exportedPath: string,
    fingerprint: string,
  ): Promise<string> {
    if (!isCompanionNotebookPath(notebook.path))
      throw new Error("Companion PDFs are available for FineNotes notebooks and pages.");
    const cleanTarget = companionPath(exportedPath);
    const pdfFile = this.app.vault.getFileByPath(cleanTarget);
    if (!pdfFile) throw new Error("Exported PDF could not be found.");

    const body = await this.app.vault.read(notebook);
    this.hydrateFromBody(notebook, body);
    const id = companionIdFromBody(body) ?? this.generateId();
    if (
      Object.entries(this.store.entries).some(
        ([other, e]) => other !== id && e.pdfPath.toLowerCase() === cleanTarget.toLowerCase(),
      )
    )
      throw new Error("Another notebook already owns this PDF target.");

    const raw = await this.app.vault.readBinary(pdfFile);
    const stamped = await stampCompanionPdfSubject(raw, id);
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
      lastFingerprint: fingerprint,
    };
    this.store.entries[id] = entry;
    await this.syncFrontmatter(notebook, id, entry);
    await this.persist();
    return id;
  }

  async assess(
    id: string,
    notebook: TFile,
    snapshot: () => Promise<CompanionSnapshot>,
  ): Promise<void> {
    const entry = this.entry(id);
    if (!entry?.enabled) return;
    await this.bind(id, notebook);
    const current = await snapshot();
    const dirty =
      current.fingerprint !== entry.lastFingerprint || !this.app.vault.getFileByPath(entry.pdfPath);
    if (dirty && !entry.dirty) {
      entry.dirty = true;
      await this.persist();
    }
  }

  async update(
    id: string,
    notebook: TFile,
    snapshot: () => Promise<CompanionSnapshot>,
    force: boolean,
  ): Promise<void> {
    if (!this.entry(id)?.enabled || !this.app.vault.getFileByPath(notebook.path)) return;
    await this.bind(id, notebook);
    await this.controller.update(id, snapshot, force);
  }

  async renamed(file: TAbstractFile, from: string): Promise<void> {
    this.identities.delete(from);
    this.identities.delete(file.path);
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

  async deleted(path: string): Promise<void> {
    this.identities.delete(path);
    if (this.isInternal(path)) return;
    let changed = false;
    for (const entry of Object.values(this.store.entries))
      if (entry.pdfPath === path || entry.pdfPath.startsWith(path + "/")) {
        entry.dirty = true;
        delete entry.lastFingerprint;
        changed = true;
      }
    if (changed) await this.persist();
  }
}
