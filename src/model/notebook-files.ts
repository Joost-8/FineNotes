/**
 * The page sidebar's Files tab: a notebook's files by kind, one kind listed
 * at a time from a dropdown. Recordings keep their own panel (play,
 * transcribe); the other kinds are rows to open.
 *
 * Pictures and PDFs, and recording transcripts, come from the notebook itself
 * (the paths its pages and recordings point at), so listing them reads no
 * folder and decodes nothing. Saved chats and exports live in folders; the
 * view lists those. Pure: no DOM, no Obsidian.
 */

import type { InkDocument } from "./document";

export type FileKind = "recordings" | "images" | "transcripts" | "chats" | "exports";

export const FILE_KINDS: readonly FileKind[] = [
  "recordings",
  "images",
  "transcripts",
  "chats",
  "exports",
];

export const FILE_KIND_LABELS: Readonly<Record<FileKind, string>> = {
  recordings: "Recordings",
  images: "Pictures and PDFs",
  transcripts: "Transcripts",
  chats: "AI chats",
  exports: "Exports",
};

/** What the list says when a kind has nothing yet. */
export const FILE_KIND_EMPTY: Readonly<Record<FileKind, string>> = {
  recordings: "No recordings yet.",
  images: "No pictures or PDFs in this notebook yet.",
  transcripts: "No transcripts yet. Transcribe a recording, and it is listed here.",
  chats: "No saved AI chats yet.",
  exports: "No PDF exports yet.",
};

/** Obsidian icon names, matching the notebook folder's own folders in the explorer. */
export const FILE_KIND_ICONS: Readonly<Record<FileKind, string>> = {
  recordings: "mic",
  images: "image",
  transcripts: "file-text",
  chats: "message-square",
  exports: "file-output",
};

/** Read a remembered kind back; anything else is Recordings, the old Audio tab. */
export function parseFileKind(value: unknown): FileKind {
  return (FILE_KINDS as readonly unknown[]).includes(value) ? (value as FileKind) : "recordings";
}

/** One row of the list. */
export interface FileRow {
  /** Vault path of the file. */
  path: string;
  /** What the row shows under the name: "Page 3", "Pages 2, 5", "From a recording". */
  detail: string;
  /** The first page it is on (0-based), for a tap to go to; absent when it is on none. */
  page?: number;
}

/** The last segment of a path: what a row shows as its name. */
export function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** "Page 3", "Pages 2, 5" or "Pages 1, 2, 3 and 4 more", from 0-based page indexes. */
export function pagesDetail(pages: readonly number[]): string {
  if (pages.length === 0) return "";
  const shown = pages.slice(0, 3).map((page) => String(page + 1));
  const more = pages.length - shown.length;
  const list = shown.join(", ") + (more > 0 ? ` and ${more} more` : "");
  return `${pages.length === 1 ? "Page" : "Pages"} ${list}`;
}

/**
 * The pictures placed in the notebook and the PDFs its pages are drawn on,
 * each once, in the order they first appear, with the pages they are on.
 */
export function notebookImages(doc: InkDocument): FileRow[] {
  const pagesOf = new Map<string, number[]>();
  const add = (path: string, page: number) => {
    if (!path) return;
    const pages = pagesOf.get(path) ?? [];
    if (pages[pages.length - 1] !== page) pages.push(page);
    pagesOf.set(path, pages);
  };
  doc.pages.forEach((page, index) => {
    if (page.backdrop.kind === "pdf") add(page.backdrop.path, index);
    for (const image of page.images) add(image.path, index);
  });
  return [...pagesOf].map(([path, pages]) => ({
    path,
    detail: pagesDetail(pages),
    page: pages[0],
  }));
}

/** The transcript notes of the notebook's recordings, newest recording first. */
export function recordingTranscripts(doc: InkDocument): FileRow[] {
  const rows: FileRow[] = [];
  const seen = new Set<string>();
  for (const recording of [...(doc.recordings ?? [])].reverse()) {
    const path = recording.transcript;
    if (!path || seen.has(path)) continue;
    seen.add(path);
    rows.push({ path, detail: "From a recording" });
  }
  return rows;
}

/** Files in a folder, as rows, newest first: what the view lists for chats and exports. */
export function folderRows(
  files: ReadonlyArray<{ path: string; extension: string; mtime: number }>,
  extensions: readonly string[],
  detail: (mtime: number) => string,
): FileRow[] {
  return files
    .filter((file) => extensions.includes(file.extension.toLowerCase()))
    .sort((a, b) => b.mtime - a.mtime || a.path.localeCompare(b.path))
    .map((file) => ({ path: file.path, detail: detail(file.mtime) }));
}
