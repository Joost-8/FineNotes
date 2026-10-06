/**
 * Notes follow the files they point at when those are renamed or moved in
 * the vault (#14; the rules are in `model/moved-files.ts`).
 *
 * Every rename Obsidian reports is written to a log in this vault's local
 * storage. A moment later, once a folder's worth of renames has arrived, the
 * open notebooks relink themselves from it and every closed ink note is
 * read, relinked and written back if it pointed at something that moved. The
 * rewrite is what reaches the other devices: they only see the move as a
 * delete and a create. A note that missed the rewrite (it was open, or a
 * sync brought back an older copy) relinks from the log when it next opens.
 */

import type { App, TAbstractFile } from "obsidian";
import {
  type FileMove,
  cleanMoveLog,
  followMoves,
  movedTarget,
  recordMove,
  relinkDocument,
} from "../model/moved-files";
import { buildInkFile, parseInkFile } from "../model/serialize";

const LOG_KEY = "goodobsidian:moved-files";
/** How long renames gather before notes are relinked: a folder's arrive as a burst. */
export const RELINK_DELAY_MS = 1000;

export interface FileMoveHost {
  /** Whether `file` is an ink note (a folder never is). */
  isInkFile(file: TAbstractFile): boolean;
  /** The ink notes open in a view now: they relink themselves. */
  openNotePaths(): Set<string>;
  /** Tell every open notebook to relink. */
  relinkOpen(): void;
  /** The page width a note without one decodes at. */
  paperWidth(): number;
}

export class FileMoveTracker {
  private timer = 0;
  /** A closed-note pass running, and whether another must follow it. */
  private running: Promise<void> | null = null;
  private again = false;
  /** Whether the renames since the last pass moved anything but ink notes. */
  private pending = false;
  private cached: FileMove[] | null = null;

  constructor(
    private readonly app: App,
    private readonly host: FileMoveHost,
  ) {}

  /** The moves seen on this device, oldest first. Read once: every edit asks. */
  log(): readonly FileMove[] {
    if (this.cached) return this.cached;
    const raw: unknown = this.app.loadLocalStorage(LOG_KEY);
    let log: FileMove[] = [];
    if (typeof raw === "string") {
      try {
        log = cleanMoveLog(JSON.parse(raw));
      } catch {
        // Unreadable: start a new log.
      }
    }
    this.cached = log;
    return log;
  }

  /** Obsidian's `rename` event. */
  renamed(file: TAbstractFile, oldPath: string): void {
    const log = this.log();
    // A folder's own rename already says where everything inside it went.
    if (followMoves(log, oldPath) === file.path) return;
    this.cached = recordMove(log, oldPath, file.path);
    this.app.saveLocalStorage(LOG_KEY, JSON.stringify(this.cached));
    // Renaming a notebook moves nothing a note points at.
    if (this.host.isInkFile(file)) return;
    // Open notebooks at once, so a moved PDF never shows as missing; closed
    // ones once the burst is over.
    this.pending = true;
    this.host.relinkOpen();
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.flush(), RELINK_DELAY_MS);
  }

  /** Where `path` moved to, when nothing is there any more and the log knows; else `undefined`. */
  relink(path: string, log: readonly FileMove[] = this.log()): string | undefined {
    return movedTarget(log, (to) => this.app.vault.getAbstractFileByPath(to) !== null, path);
  }

  /** Relink the closed notes in the background (open ones relinked as the moves came in). */
  flush(): Promise<void> {
    window.clearTimeout(this.timer);
    this.timer = 0;
    if (!this.pending) return this.running ?? Promise.resolve();
    this.pending = false;
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.relinkClosed().finally(() => {
      this.running = null;
      if (this.again) {
        this.again = false;
        this.pending = true;
        void this.flush();
      }
    });
    return this.running;
  }

  destroy(): void {
    window.clearTimeout(this.timer);
    this.timer = 0;
  }

  /**
   * Every closed ink note that points at a moved file, rewritten. A note that
   * does not decode is left alone, exactly as the view would hold it.
   */
  private async relinkClosed(): Promise<void> {
    const log = this.log();
    if (log.length === 0) return;
    const relink = (path: string) => this.relink(path, log);
    const width = this.host.paperWidth();
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!this.host.isInkFile(file) || this.host.openNotePaths().has(file.path)) continue;
      try {
        const { doc } = parseInkFile(await this.app.vault.cachedRead(file), width);
        if (!doc || relinkDocument(doc, relink) === 0) continue;
        // Read again inside the write, in case the note changed meanwhile.
        await this.app.vault.process(file, (data) => {
          const parsed = parseInkFile(data, width);
          if (!parsed.doc || relinkDocument(parsed.doc, relink) === 0) return data;
          return buildInkFile(parsed.body, parsed.doc);
        });
      } catch {
        // Unreadable now (mid-sync, deleted meanwhile): it relinks when it opens.
      }
    }
  }
}
