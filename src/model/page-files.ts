/**
 * A notebook that keeps each page in a file of its own (FineNotes#274).
 *
 * Obsidian Sync keeps every saved version of a note for a month and counts
 * it against the plan, and caps a file at 5 MB on its Standard plan. A
 * notebook in one file is written whole at every save, whichever page
 * changed. Kept apart, a save writes only the pages that changed.
 *
 * The notebook file stays the notebook: its frontmatter, prose and text
 * block are untouched, and its ink block holds a manifest instead of the
 * pages (`splitDocument` in serialize.ts, labelled `page-files`). Each page
 * is a Markdown file in the notebook's `Pages/` folder (`.md`, because
 * Sync leaves other file types behind unless each device opts in), holding
 * one `%%finenotes-page` block. That block is not the notebook block, so
 * nothing that reads notebooks takes a page file for a one-page notebook.
 *
 * Pure: no DOM, no Obsidian. Reading and writing the files is the view's.
 */

import {
  type InkDocumentLoad,
  type PageFileRef,
  type PageFilesManifest,
  assemblePageFiles,
  readPagePayload,
} from "./serialize";

/** The folder beside the notebook file that holds its pages. */
export const PAGES_FOLDER = "Pages";

/** The block a page file keeps its page in. */
export const PAGE_BLOCK_LABEL = "finenotes-page";

const PAGE_BLOCK_RE = new RegExp(
  `(?:^|\\n)[ \\t]*%%${PAGE_BLOCK_LABEL}[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n[ \\t]*%%[ \\t]*(?:\\r?\\n|$)`,
);

/** A page file's text: its page's payload in a block of its own. */
export function pageFileText(payload: string): string {
  return `%%${PAGE_BLOCK_LABEL}\n${payload}\n%%\n`;
}

/** The payload a page file holds, or `null` when the text is not a page file. */
export function pagePayloadOf(text: string): string | null {
  const block = PAGE_BLOCK_RE.exec(text);
  return block ? block[1].trim() : null;
}

/** Characters a page id may keep in its file name; anything else names the file by position. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * A file per page, relative to the notebook's folder, in page order:
 * `Pages/<id>.md`. Ids repeat in some files, and a few are not safe as file
 * names: such a page is named by its place instead, and every name is
 * unique ignoring case (the file systems a vault syncs to ignore it).
 */
export function pageFileNames(pages: readonly { id: string }[]): string[] {
  const taken = new Set<string>();
  return pages.map((page, i) => {
    let stem = SAFE_ID.test(page.id) ? page.id : `page-${i + 1}`;
    for (let n = 2; taken.has(stem.toLowerCase()); n++) {
      stem = `${SAFE_ID.test(page.id) ? page.id : `page-${i + 1}`}-${n}`;
    }
    taken.add(stem.toLowerCase());
    return `${PAGES_FOLDER}/${stem}.md`;
  });
}

/** The folder a vault path is in ("" for the root). */
function folderOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

/**
 * The vault path of a page file the manifest of `notebookPath` names, or
 * `null` when the name could lead anywhere but a Markdown file below the
 * notebook's folder: no absolute paths, no `..`, no backslashes, no empty
 * segments. A manifest is a file anyone can edit or sync in.
 */
export function resolvePageFile(notebookPath: string, file: string): string | null {
  if (!file.endsWith(".md") || file.includes("\\") || file.startsWith("/")) return null;
  const parts = file.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) return null;
  const folder = folderOf(notebookPath);
  return folder ? `${folder}/${file}` : file;
}

/** The folder holding the pages of the notebook at `notebookPath`. */
export function pagesFolderOf(notebookPath: string): string {
  const folder = folderOf(notebookPath);
  return folder ? `${folder}/${PAGES_FOLDER}` : PAGES_FOLDER;
}

/**
 * The folder whose notebook a page file at `path` may belong to: the folder
 * above its `Pages/`, or `null` when the file is not in a `Pages/` folder.
 */
export function notebookFolderOfPage(path: string): string | null {
  if (!path.endsWith(".md")) return null;
  const pages = folderOf(path);
  const name = pages.slice(pages.lastIndexOf("/") + 1);
  if (name !== PAGES_FOLDER) return null;
  return folderOf(pages);
}

/** A file's size and last change, as the vault reports them. */
export interface FileStamp {
  mtime: number;
  size: number;
}

/**
 * A notebook's size and last change counting its page files: the newest
 * change among the notebook file and its `Pages/` files, and their total
 * size. Home keys what it read of a notebook on this, since a save may now
 * leave the notebook file as it was. Without page files it is the file's own.
 */
export function notebookStat(notebook: FileStamp, pages: readonly FileStamp[]): FileStamp {
  let { mtime, size } = notebook;
  for (const page of pages) {
    mtime = Math.max(mtime, page.mtime);
    size += page.size;
  }
  return { mtime, size };
}

/**
 * The notebook a manifest makes from its pages' file texts. `textOf` gives
 * the text of a page file by vault path, or `undefined` when the file is
 * not there (yet). A page whose file is missing, is not a page file, or
 * cannot be read comes back blank and is listed in `missing`.
 */
export function readPageFilesNotebook(
  notebookPath: string,
  manifest: PageFilesManifest,
  textOf: (path: string) => string | undefined,
  fallbackWidth?: number,
): InkDocumentLoad {
  return assemblePageFiles(
    manifest,
    (ref: PageFileRef) => {
      const path = resolvePageFile(notebookPath, ref.file);
      const text = path === null ? undefined : textOf(path);
      const payload = text === undefined ? null : pagePayloadOf(text);
      if (payload === null) return undefined;
      try {
        return readPagePayload(payload);
      } catch {
        return undefined;
      }
    },
    fallbackWidth,
  );
}
