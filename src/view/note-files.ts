/**
 * A text note's files folder on disk (`model/note-files.ts` says where):
 * made when something is first saved in it, and moved with the note.
 */

import { type App, type TAbstractFile, TFile, TFolder, normalizePath } from "obsidian";
import { followNoteRename, holdsNoteFiles } from "../model/note-files";

/** Make `path` and every folder above it that is missing. */
export async function ensureFolder(app: App, path: string): Promise<void> {
  const parts = normalizePath(path).split("/").filter(Boolean);
  for (let n = 1; n <= parts.length; n++) {
    const folder = parts.slice(0, n).join("/");
    if (app.vault.getAbstractFileByPath(folder)) continue;
    try {
      await app.vault.createFolder(folder);
    } catch {
      // Made meanwhile (a sync, or another save).
    }
  }
}

/**
 * Obsidian's `rename` event: a text note renamed or moved takes the folder
 * of its files along, through `fileManager.renameFile` so links into it
 * follow too. Run after Obsidian's own rename has finished.
 */
export function followNoteFiles(app: App, file: TAbstractFile, oldPath: string): void {
  if (!(file instanceof TFile)) return;
  const move = followNoteRename(
    oldPath,
    file.path,
    (path) => {
      const folder = app.vault.getAbstractFileByPath(path);
      return folder instanceof TFolder && holdsNoteFiles(folder.children.map((c) => c.name));
    },
    (path) => app.vault.getAbstractFileByPath(path) !== null,
  );
  if (!move) return;
  window.setTimeout(() => {
    const from = app.vault.getAbstractFileByPath(move.from);
    if (!(from instanceof TFolder)) return;
    void (async () => {
      const parent = move.to.slice(0, Math.max(0, move.to.lastIndexOf("/")));
      if (parent) await ensureFolder(app, parent);
      await app.fileManager.renameFile(from, move.to);
    })().catch((error: unknown) => {
      console.error("FineNotes: could not move the note's files with it", error);
    });
  }, 0);
}
