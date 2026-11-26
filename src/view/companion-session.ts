/**
 * One open notebook's Companion PDF: what the view tells the manager (an
 * edit, a load, the close), the capture an export is made from, and the
 * Note Settings row. The view only wires these in (rule 3).
 */
import type { App, TFile } from "obsidian";
import {
  CompanionError,
  type CompanionKeys,
  companionIdFromBody,
  companionResources,
  isCompanionNotebookPath,
  withCompanionKeys,
} from "../model/companion-pdf";
import { CompanionHasher } from "../model/companion-hash";
import type { InkDocument, Page } from "../model/document";
import { readFurniture } from "../model/furniture";
import type { DocumentSnapshot } from "../model/serialize";
import { stripInkSuffix } from "../model/new-notebook";
import { stampCompanionPdfSubject } from "../export/companion-metadata";
import { typedPdfName } from "../export/export-name";
import type { ExportedFiles } from "./export-modal";
import {
  type CompanionCapture,
  type CompanionExportOptions,
  type CompanionPdfManager,
  type CompanionState,
  type CompanionViewLink,
  captureHash,
  checkFrontmatter,
  companionErrorText,
  sha256Hex,
} from "./companion-pdf";

/** What the notebook view gives its companion session. */
export interface CompanionSessionHost {
  readonly app: App;
  file(): TFile | null;
  /** The note's text around the ink, frontmatter included. */
  body(): string;
  setBody(body: string): void;
  /** The notebook's pages, whichever tab is shown (never a PDF tab's own document). */
  doc(): InkDocument;
  paperWidth(): number;
  /** The pages as the save cache holds them. */
  snapshot(): DocumentSnapshot;
  options(): CompanionExportOptions;
  crop(page: Page): Page;
  /** The notebook's own folder for exports, or `undefined` for Obsidian's default. */
  exportsFolder(): string | undefined;
  /** Saves now, and resolves once it is on disk. */
  saveNow(): Promise<void>;
  /** The note text changed: save it now. */
  saveBody(): Promise<void>;
  /** The view may write its file (not held, not waiting for page files): asked quietly. */
  writable(): boolean;
  penDown(): boolean;
  /** Whether `leaf` is this view's own tab. */
  isLeaf(leaf: unknown): boolean;
  /** Whether the app is in the background. */
  hidden(): boolean;
}

/** How long a changed notebook stays out of sight (another tab in front) before it is exported. */
export const LEFT_EXPORT_MS = 30_000;

/** The Note Settings row's host (`note-settings-modal.ts`). */
export interface CompanionSettingsHost {
  state: () => CompanionState;
  observe: (listener: () => void) => () => void;
  /** Brings the mark up to date (quietly; at most the PDF's Info is read). */
  check: () => void;
  setEnabled: (on: boolean) => Promise<void>;
  chooseFolder: (folder: string) => Promise<void>;
  update: () => Promise<void>;
  openPdf: () => void;
}

/** The action, its failures put in words (a code becomes a sentence in the user's language). */
function inWords<A extends unknown[]>(
  action: (...args: A) => Promise<void>,
): (...args: A) => Promise<void> {
  return async (...args) => {
    try {
      await action(...args);
    } catch (error) {
      throw error instanceof CompanionError ? new Error(companionErrorText(error.code)) : error;
    }
  };
}

export class CompanionSession implements CompanionViewLink {
  /** The file whose close was already handled (unload, then close). */
  private closed: TFile | null = null;
  private readonly hasher = new CompanionHasher(sha256Hex);
  /** Set while another tab is in front: then the notebook is exported once it has waited. */
  private leftTimer = 0;

  constructor(
    private readonly host: CompanionSessionHost,
    private readonly manager: CompanionPdfManager | undefined,
  ) {}

  get file(): TFile | null {
    return this.host.file();
  }

  get penDown(): boolean {
    return this.host.penDown();
  }

  /** The notebook's companion id, from its frontmatter. */
  get id(): string | null {
    return companionIdFromBody(this.host.body());
  }

  uses(path: string): boolean {
    return companionResources(this.host.doc()).includes(path);
  }

  /**
   * Whether this notebook keeps a Companion PDF of its own: on, and not a
   * copy made outside FineNotes that carries another notebook's id.
   */
  get enabled(): boolean {
    const file = this.host.file();
    return (
      !!file &&
      isCompanionNotebookPath(file.path) &&
      !!this.manager?.mine(this.manager.entry(this.id), file.path)
    );
  }

  /** A notebook was read: its frontmatter says what its companion is; a re-read may be newer. */
  loaded(again: boolean): void {
    this.closed = null;
    this.stopLeft();
    const file = this.host.file();
    if (!file || !this.manager) return;
    this.manager.hydrate(file, this.host.body());
    if (again) this.manager.markDirty(this.id);
  }

  /** An edit: the PDF is behind now. Costs nothing but a flag. */
  changed(): void {
    this.manager?.markDirty(this.id);
  }

  async writeKeys(keys: CompanionKeys): Promise<boolean> {
    if (!this.host.writable()) return false;
    checkFrontmatter(this.host.body());
    this.host.setBody(withCompanionKeys(this.host.body(), keys));
    await this.host.saveBody();
    return true;
  }

  /** The notebook as saved: kept by the export after this view is gone. */
  private capture(): CompanionCapture {
    const doc = this.host.doc();
    const file = this.host.file();
    const options = this.host.options();
    return {
      revision: this.manager?.revisionOf(this.id) ?? 0,
      optionsKey: JSON.stringify(options),
      title: stripInkSuffix(file?.basename ?? ""),
      snapshot: this.host.snapshot(),
      paperWidth: this.host.paperWidth(),
      furniture: doc.endless ? undefined : readFurniture(doc.furniture),
      resources: companionResources(doc),
      options,
      crop: (page) => this.host.crop(page),
    };
  }

  /**
   * The notebook closes (its tab, or another file in it): when it changed
   * since its PDF was checked, it is saved and queued. The export runs after
   * the view is gone, from what was saved.
   */
  async close(file: TFile): Promise<void> {
    if (this.closed === file) return;
    this.closed = file;
    this.stopLeft();
    await this.queueChanged(file);
  }

  /** Saves and queues the notebook when it changed (or this device's export switches did). */
  private async queueChanged(file: TFile): Promise<void> {
    const id = this.id;
    const entry = this.manager?.entry(id);
    if (!id || !this.manager || !entry || !this.enabled || !this.host.writable()) return;
    // This device's export switches changed: its PDF is behind here, and only here.
    if (entry.optionsKey !== undefined && entry.optionsKey !== JSON.stringify(this.host.options()))
      this.manager.markDirty(id);
    if (!entry.dirty) return;
    await this.host.saveNow();
    if (this.host.file() !== file) return;
    const made = this.capture();
    void this.manager.requestExport(id, file, () => made, false);
  }

  /**
   * Another tab came to the front, or this one did. On an iPad tabs are
   * seldom closed, so a changed notebook left out of sight for
   * {@link LEFT_EXPORT_MS} is exported as at a close; never while the app is
   * in the background.
   */
  activeLeafChanged(leaf: unknown): void {
    if (this.host.isLeaf(leaf)) {
      this.stopLeft();
      return;
    }
    const file = this.host.file();
    if (!file || this.leftTimer || !this.enabled || !this.manager?.entry(this.id)?.dirty) return;
    this.leftTimer = window.setTimeout(() => {
      this.leftTimer = 0;
      if (this.host.file() !== file || this.host.hidden()) return;
      void this.queueChanged(file);
    }, LEFT_EXPORT_MS);
  }

  private stopLeft(): void {
    window.clearTimeout(this.leftTimer);
    this.leftTimer = 0;
  }

  /** Update now (the row's button, the command): made even when it looks current or is missing. */
  async updateNow(): Promise<void> {
    const file = this.host.file();
    const id = this.id;
    if (!file || !id || !this.manager || !this.enabled) return;
    if (this.host.writable()) await this.host.saveNow();
    if (this.host.file() !== file) return;
    const made = this.capture();
    await this.manager.requestExport(id, file, () => made, true);
  }

  private async check(): Promise<void> {
    const id = this.id;
    if (!id || !this.manager || !this.enabled) return;
    const made = this.capture();
    await this.manager.check(
      id,
      await captureHash(this.host.app, made, this.hasher),
      made.optionsKey,
    );
  }

  private requireFile(file: TFile): void {
    if (this.host.file() !== file) throw new CompanionError("path");
  }

  /** The Note Settings row, or `undefined` where a notebook cannot have one. */
  settings(): CompanionSettingsHost | undefined {
    const file = this.host.file();
    const manager = this.manager;
    if (!file || !manager || !isCompanionNotebookPath(file.path)) return undefined;
    return {
      state: () => manager.state(this.enabled ? this.id : null),
      observe: (listener) => manager.observe(listener),
      check: () => void this.check().catch(() => undefined),
      setEnabled: inWords(async (on: boolean) => {
        this.requireFile(file);
        if (!on) {
          const id = this.id;
          if (id) await manager.disable(file, id);
          return;
        }
        if (this.host.writable()) await this.host.saveNow();
        await manager.enable(file, this.host.body(), this.host.exportsFolder());
        void this.updateNow();
      }),
      chooseFolder: inWords(async (folder: string) => {
        this.requireFile(file);
        const id = this.id;
        if (id) await manager.chooseFolder(file, id, folder);
      }),
      update: inWords(async () => {
        this.requireFile(file);
        await this.updateNow();
      }),
      openPdf: () => {
        const entry = manager.entry(this.id);
        if (entry) void this.host.app.workspace.openLinkText(entry.pdfPath, file.path, true);
      },
    };
  }

  /** Whether an export to `path` is the companion's own file (then {@link writeExport} writes it). */
  writes(path: string): boolean {
    const entry = this.manager?.entry(this.id);
    return this.enabled && entry?.pdfPath.toLowerCase() === path.toLowerCase();
  }

  /** The companion's file name when it is in `folder`: a file the Export dialog may replace. */
  ownIn(folder: string): string | undefined {
    const path = this.enabled ? this.manager?.entry(this.id)?.pdfPath : undefined;
    if (!path) return undefined;
    const at = path.lastIndexOf("/");
    return (at < 0 ? "" : path.slice(0, at)) === folder ? path.slice(at + 1) : undefined;
  }

  /**
   * A new PDF name typed in the Export dialog (#318): the companion takes it.
   * Only the name: a companion kept in a folder of its own stays there.
   */
  async moveTo(path: string): Promise<void> {
    const file = this.host.file();
    const id = this.id;
    const current = this.manager?.entry(id)?.pdfPath;
    if (!file || !id || !this.manager || !this.enabled || !current) return;
    const nameOf = (p: string): string => p.slice(p.lastIndexOf("/") + 1).toLowerCase();
    if (nameOf(path) === nameOf(current)) return;
    await this.manager.moveTo(file, id, path);
  }

  /**
   * The Export dialog's PDF, written to the companion's own file through the
   * companion's writer. `whole`: every page, so it carries the content hash
   * and the companion is up to date.
   */
  async writeExport(path: string, bytes: Uint8Array, whole: boolean): Promise<void> {
    const id = this.id;
    const file = this.host.file();
    if (!id || !file || !this.manager) return;
    const made = whole ? this.capture() : null;
    const stamp = made
      ? { hash: await captureHash(this.host.app, made, this.hasher), optionsKey: made.optionsKey }
      : null;
    await this.manager.writeExport(id, file.path, path, bytes, stamp, stampCompanionPdfSubject);
  }

  /**
   * Writes the Export dialog's PDF (#318, #310): a typed name is the
   * companion's name too, by one rule. An export of every page moves the
   * companion to it; an export to the companion's own file goes through its
   * writer, Subject and all (a part of the notebook is written there and
   * marked behind); any other file is written as the export always was, in
   * place when `replaces` (this notebook's own file). The whole notebook
   * can then become its companion (Keep updated).
   */
  async saveExport(
    path: string,
    bytes: Uint8Array,
    how: { whole: boolean; typed: string; replaces: boolean; type: string },
  ): Promise<ExportedFiles> {
    const { vault } = this.host.app;
    const buffer = bytes.slice().buffer;
    if (how.whole && typedPdfName(how.typed)) await this.moveTo(path);
    const existing = how.replaces ? vault.getFileByPath(path) : null;
    if (this.writes(path)) await this.writeExport(path, bytes, how.whole);
    else if (existing) await vault.modifyBinary(existing, buffer);
    else await vault.createBinary(path, buffer);
    const keepUpdated = how.whole ? this.keepUpdated(path, bytes) : undefined;
    const name = path.slice(path.lastIndexOf("/") + 1);
    const files = [new File([buffer], name, { type: how.type })];
    return { paths: [path], where: path, files, ...(keepUpdated ? { keepUpdated } : {}) };
  }

  /**
   * The export dialog's Keep updated, for a PDF of the whole notebook it just
   * saved at `path`; `undefined` when this notebook already has a companion.
   */
  keepUpdated(path: string, bytes: Uint8Array): (() => Promise<void>) | undefined {
    const file = this.host.file();
    const manager = this.manager;
    if (!file || !manager || this.enabled || !isCompanionNotebookPath(file.path)) return undefined;
    return async () => {
      this.requireFile(file);
      if (this.host.writable()) await this.host.saveNow();
      const hash = await captureHash(this.host.app, this.capture(), this.hasher);
      await manager.adopt(file, this.host.body(), path, bytes, hash, stampCompanionPdfSubject);
    };
  }
}
