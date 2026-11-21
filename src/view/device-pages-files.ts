/**
 * The vault side of a notebook kept as one file per page per device
 * (FineNotes#274, `model/device-pages`): finding its page folder, its stamp,
 * and reading it, for the readers that are not the notebook view (Home,
 * page embeds). Read-only: nothing here writes.
 */

import { type App, TFile, TFolder } from "obsidian";
import type { InkDocument } from "../model/document";
import { pageFileName } from "../model/device-pages-writer";
import {
  type FileStamp,
  NOTEBOOK_ID_KEY,
  devicePagesFolderOf,
  isNotebookId,
  notebookStat,
  readDeviceFileName,
  readDevicePagesNotebook,
} from "../model/device-pages";

/** The vault path of a notebook's page folder, from the id in its frontmatter (`null`: none). */
export function devicePagesFolderPath(app: App, file: TFile): string | null {
  const id: unknown = app.metadataCache.getFileCache(file)?.frontmatter?.[NOTEBOOK_ID_KEY];
  return isNotebookId(id) ? devicePagesFolderOf(file.path, id) : null;
}

/** A notebook's page folder, when its frontmatter names one and it is there. */
export function devicePagesFolderFor(app: App, file: TFile): TFolder | null {
  const path = devicePagesFolderPath(app, file);
  const folder = path === null ? null : app.vault.getAbstractFileByPath(path);
  return folder instanceof TFolder ? folder : null;
}

/** The files of a page folder that belong to the layout. */
function deviceFilesIn(folder: TFolder): TFile[] {
  return (Array.isArray(folder.children) ? folder.children : []).filter(
    (child): child is TFile => child instanceof TFile && readDeviceFileName(child.name) !== null,
  );
}

/**
 * A notebook file's size and last change, counting the files in its page
 * folder: a notebook kept as one file per page per device saves without its
 * own file changing.
 */
export function notebookStatOf(app: App, file: TFile): FileStamp {
  const folder = devicePagesFolderFor(app, file);
  if (!folder) return file.stat;
  return notebookStat(
    file.stat,
    deviceFilesIn(folder).map((page) => page.stat),
  );
}

/** The text of `files` (Obsidian's cached copies), by name; an unreadable one is left out. */
async function textsOf(app: App, files: readonly TFile[]): Promise<Map<string, string>> {
  const texts = new Map<string, string>();
  await Promise.all(
    files.map(async (file) => {
      try {
        texts.set(file.name, await app.vault.cachedRead(file));
      } catch {
        // Unreadable: as one not synced yet.
      }
    }),
  );
  return texts;
}

/**
 * A notebook kept as one file per page per device, joined from the files in
 * its page folder at `folderPath` (none yet: the legacy notebook alone).
 * With `onlyPage` (an index), only that page's files are read besides the
 * metas, so an embed of one page reads one page: the notebook's other pages
 * are then as the legacy notebook and the metas have them. `null` when the
 * notebook file's own payload cannot be read.
 */
export async function readDevicePagesFolder(
  app: App,
  payload: string,
  folderPath: string,
  fallbackWidth?: number,
  onlyPage?: number,
): Promise<InkDocument | null> {
  const folder = app.vault.getAbstractFileByPath(folderPath);
  let files = folder instanceof TFolder ? deviceFilesIn(folder) : [];
  try {
    if (onlyPage !== undefined) {
      const metas = files.filter((file) => readDeviceFileName(file.name)?.kind === "meta");
      const order = readDevicePagesNotebook(payload, await textsOf(app, metas), fallbackWidth);
      const id = order.doc.pages[onlyPage]?.id;
      const devices = new Set(files.map((file) => readDeviceFileName(file.name)?.device));
      const names = new Set(
        id === undefined
          ? []
          : [...devices].flatMap((device) => (device ? [pageFileName(id, device)] : [])),
      );
      files = [...metas, ...files.filter((file) => names.has(file.name))];
    }
    return readDevicePagesNotebook(payload, await textsOf(app, files), fallbackWidth).doc;
  } catch {
    return null;
  }
}
