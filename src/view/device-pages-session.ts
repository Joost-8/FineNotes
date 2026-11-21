/**
 * The notebook view's side of a notebook kept as one file per page per
 * device (FineNotes#274): this device's id, reading the page folder, and
 * writing this device's files in it, one save at a time.
 *
 * The writing itself is decided by `model/device-pages-writer`; this only
 * does the vault's part, so it stays small.
 */

import { type App, TFile, TFolder, normalizePath } from "obsidian";
import type { InkDocument } from "../model/document";
import {
  type DevicePagesLoad,
  readDeviceFileName,
  readDevicePagesNotebook,
  readMetaFile,
  readPageFile,
} from "../model/device-pages";
import { DevicePagesWriter, randomId } from "../model/device-pages-writer";
import { DotClock, attachDotClock } from "../model/dot-ids";
import { isDeviceId } from "../model/provenance";

/** Where this install keeps its device id: the app's local storage, never data.json (it syncs). */
const DEVICE_ID_KEY = "finenotes-device-id";

/** This install's device id, made on first use. */
export function deviceIdOf(app: App): string {
  try {
    const kept: unknown = app.loadLocalStorage(DEVICE_ID_KEY);
    if (isDeviceId(kept)) return kept;
  } catch {
    // No local storage: a new id, kept if it can be.
  }
  const id = randomId();
  try {
    app.saveLocalStorage(DEVICE_ID_KEY, id);
  } catch {
    // Not kept: this session still writes as one device.
  }
  return id;
}

/** The folder a vault path is in ("" for the root). */
function parentOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

/** One open notebook kept as one file per page per device. */
export class DevicePagesSession {
  /** Set once the notebook is read whole (nothing still syncing): then it can be written. */
  writer: DevicePagesWriter | null = null;
  readonly clock: DotClock;
  /** The writes under way, one save after another. */
  private writing: Promise<void> = Promise.resolve();
  /**
   * The last text of each file that read whole, by name. A file a sync is
   * writing (empty first, or cut short) is read as this meanwhile, so the
   * page it holds never blanks; it is read again once it is whole.
   */
  private readonly whole = new Map<string, string>();

  constructor(
    private readonly app: App,
    /** The notebook file's path. */
    readonly path: string,
    /** The notebook file's payload: the legacy notebook. */
    readonly payload: string,
    /** The page folder's vault path. */
    readonly folder: string,
    readonly device: string,
    /** The session this one follows (the same notebook read again): its writes come first. */
    previous: DevicePagesSession | null = null,
    /** The clock the notebook's ids already come from (a notebook moving here), if any. */
    clock: DotClock | null = null,
  ) {
    this.clock = clock ?? new DotClock(device);
    if (previous) {
      this.writing = previous.writing;
      if (previous.folder === folder)
        for (const [name, text] of previous.whole) this.whole.set(name, text);
    }
  }

  /** Whether `name` (a file in the page folder) is one this device writes. */
  isOwn(name: string): boolean {
    return readDeviceFileName(name)?.device === this.device;
  }

  /** The text of every file of the layout in the page folder, by name. */
  async readFiles(): Promise<Map<string, string>> {
    // A save still being written is read once it is on disk.
    await this.writing;
    const texts = new Map<string, string>();
    const folder = this.app.vault.getAbstractFileByPath(this.folder);
    const children = folder instanceof TFolder ? folder.children : [];
    await Promise.all(
      children.map(async (file) => {
        const kind = file instanceof TFile ? readDeviceFileName(file.name) : null;
        if (!(file instanceof TFile) || !kind) return;
        let text: string | null = null;
        try {
          text = await this.app.vault.read(file);
        } catch {
          // Unreadable: as one being written.
        }
        const read =
          text === null
            ? null
            : kind.kind === "meta"
              ? readMetaFile(text, kind.device)
              : readPageFile(text, kind.device);
        // Not whole (empty, cut short): what it last held, if anything.
        if (text === null || read === "unreadable" || read === "not-a-file") {
          const last = this.whole.get(file.name);
          if (last !== undefined) texts.set(file.name, last);
          else if (text !== null) texts.set(file.name, text);
          return;
        }
        this.whole.set(file.name, text);
        texts.set(file.name, text);
      }),
    );
    return texts;
  }

  /**
   * The notebook made of `texts`. When nothing is still syncing, this device
   * may write it from now on ({@link writer}); otherwise it is shown as it is
   * and nothing is written. Throws when the legacy payload cannot be read.
   */
  load(texts: ReadonlyMap<string, string>, fallbackWidth: number): DevicePagesLoad {
    const load = readDevicePagesNotebook(this.payload, texts, fallbackWidth);
    attachDotClock(load.doc, this.clock);
    this.writer = load.syncing
      ? null
      : DevicePagesWriter.fromRead(this.device, this.clock, load.doc, load.sources, load.union);
    return load;
  }

  /** Begin writing a notebook just moved to the layout, with a writer made when it was read. */
  startWith(writer: DevicePagesWriter, doc: InkDocument): void {
    attachDotClock(doc, this.clock);
    this.writer = writer;
  }

  /**
   * Begin writing a notebook just moved to the layout: `legacy` is the
   * notebook its payload holds, `doc` the one shown (what changed since is
   * written to page files at the next save).
   */
  startFresh(legacy: InkDocument, doc: InkDocument): void {
    attachDotClock(doc, this.clock);
    this.writer = DevicePagesWriter.fresh(this.device, this.clock, legacy);
  }

  /**
   * Write what changed in `doc` since the last save: this device's changed
   * page files, then its meta. `changed`: the pages that may have changed
   * (`null`: any). What to write is decided now; the writing waits for the
   * save before it. Nothing when nothing changed, or when the notebook may
   * not be written (still syncing).
   */
  save(doc: InkDocument, changed: ReadonlySet<string> | null = null): Promise<void> {
    const writer = this.writer;
    if (!writer) return this.writing;
    const writes = writer.save(doc, changed);
    if (writes.length === 0) return this.writing;
    this.writing = this.writing.then(async () => {
      try {
        await this.ensureFolder(this.folder);
        for (const { name, text } of writes) {
          const path = normalizePath(`${this.folder}/${name}`);
          const file = this.app.vault.getAbstractFileByPath(path);
          if (file instanceof TFile) await this.app.vault.modify(file, text);
          else await this.app.vault.create(path, text);
        }
      } catch (error) {
        console.error("FineNotes: could not save a page of this notebook", error);
        // Written again whole at the next save.
        writer.unwritten();
      }
    });
    return this.writing;
  }

  /** Make `path` and the folders above it, as far as they are missing. */
  private async ensureFolder(path: string): Promise<void> {
    if (!path || this.app.vault.getAbstractFileByPath(path)) return;
    await this.ensureFolder(parentOf(path));
    try {
      await this.app.vault.createFolder(path);
    } catch (error) {
      // Made meanwhile (a sync): fine.
      if (!this.app.vault.getAbstractFileByPath(path)) throw error;
    }
  }
}
