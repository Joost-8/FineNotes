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
  readonly file: TFile | null;
  /** The note's text around the ink, frontmatter included. */
  noteBody: string;
  /** The notebook's pages, whichever tab is shown (never a PDF tab's own document). */
  readonly doc: InkDocument;
  readonly paperWidth: number;
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
  /** Whether a page is drawn from the file at `path` (an imported PDF, a picture). */
  uses(path: string): boolean;
}

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

  constructor(
    private readonly host: CompanionSessionHost,
    private readonly manager: CompanionPdfManager | undefined,
  ) {}

  get file(): TFile | null {
    return this.host.file;
  }

  get penDown(): boolean {
    return this.host.penDown();
  }

  /** The notebook's companion id, from its frontmatter. */
  get id(): string | null {
    return companionIdFromBody(this.host.noteBody);
  }

  uses(path: string): boolean {
    return this.host.uses(path);
  }

  /** Whether this notebook keeps a Companion PDF. */
  get enabled(): boolean {
    const file = this.host.file;
    return (
      !!file && isCompanionNotebookPath(file.path) && this.manager?.entry(this.id)?.enabled === true
    );
  }

  /** A notebook was read: its frontmatter says what its companion is; a re-read may be newer. */
  loaded(again: boolean): void {
    this.closed = null;
    const file = this.host.file;
    if (!file || !this.manager) return;
    this.manager.hydrate(file, this.host.noteBody);
    if (again) this.manager.markDirty(this.id);
  }

  /** An edit: the PDF is behind now. Costs nothing but a flag. */
  changed(): void {
    this.manager?.markDirty(this.id);
  }

  async writeKeys(keys: CompanionKeys): Promise<boolean> {
    if (!this.host.writable()) return false;
    checkFrontmatter(this.host.noteBody);
    this.host.noteBody = withCompanionKeys(this.host.noteBody, keys);
    await this.host.saveBody();
    return true;
  }

  /** The notebook as saved: kept by the export after this view is gone. */
  private capture(): CompanionCapture {
    const { doc, file } = this.host;
    return {
      title: stripInkSuffix(file?.basename ?? ""),
      snapshot: this.host.snapshot(),
      paperWidth: this.host.paperWidth,
      furniture: doc.endless ? undefined : readFurniture(doc.furniture),
      resources: companionResources(doc),
      options: this.host.options(),
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
    const id = this.id;
    const entry = this.manager?.entry(id);
    if (!id || !this.manager || !this.enabled || !entry?.dirty || !this.host.writable()) return;
    await this.host.saveNow();
    if (this.host.file !== file) return;
    const made = this.capture();
    void this.manager.requestExport(id, file, () => made, false);
  }

  /** Update now (the row's button, the command): made even when it looks current or is missing. */
  async updateNow(): Promise<void> {
    const file = this.host.file;
    const id = this.id;
    if (!file || !id || !this.manager || !this.enabled) return;
    if (this.host.writable()) await this.host.saveNow();
    if (this.host.file !== file) return;
    const made = this.capture();
    await this.manager.requestExport(id, file, () => made, true);
  }

  private async check(): Promise<void> {
    const id = this.id;
    if (!id || !this.manager || !this.enabled) return;
    await this.manager.check(id, await captureHash(this.host.app, this.capture(), this.hasher));
  }

  private requireFile(file: TFile): void {
    if (this.host.file !== file) throw new CompanionError("path");
  }

  /** The Note Settings row, or `undefined` where a notebook cannot have one. */
  settings(): CompanionSettingsHost | undefined {
    const file = this.host.file;
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
        await manager.enable(file, this.host.noteBody, this.host.exportsFolder());
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

  /**
   * The export dialog's Keep updated, for a PDF of the whole notebook it just
   * saved at `path`; `undefined` when this notebook already has a companion.
   */
  keepUpdated(path: string, bytes: Uint8Array): (() => Promise<void>) | undefined {
    const file = this.host.file;
    const manager = this.manager;
    if (!file || !manager || this.enabled || !isCompanionNotebookPath(file.path)) return undefined;
    return async () => {
      this.requireFile(file);
      if (this.host.writable()) await this.host.saveNow();
      const hash = await captureHash(this.host.app, this.capture(), this.hasher);
      await manager.adopt(file, this.host.noteBody, path, bytes, hash, stampCompanionPdfSubject);
    };
  }
}
