/**
 * Per-note destinations for new pictures, recordings and PDF exports: the
 * toolbar's settings button lets a notebook (or a single page) send its
 * images to one vault folder, its audio to another and its exported PDFs to
 * a third, instead of Obsidian's "Default location for new attachments"
 * (pictures, recordings) or the note's own folder (exports). Stored in the
 * document as `meta.folders`, so the choice travels with the note to every
 * device.
 *
 * Pure: no DOM, no Obsidian. Resolving a folder into a free file name is the
 * view's job (`availablePath`).
 */

import type { Command } from "./commands";
import type { AttachmentFolders, AttachmentKind, InkDocument } from "./document";
import { normalizeFolder } from "./new-notebook";

export const ATTACHMENT_KINDS: readonly AttachmentKind[] = ["images", "audio", "exports"];

const LABELS: Record<AttachmentKind, string> = {
  images: "Set image folder",
  audio: "Set recording folder",
  exports: "Set export folder",
};

/**
 * A stored folder in canonical form, or `undefined` when there is none to
 * keep. The vault root is not a choice here (`""` means "not set"), and a
 * dot-folder is refused: Obsidian does not index it, so a picture saved there
 * could never be drawn again.
 */
export function cleanFolder(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const folder = normalizeFolder(value);
  if (!folder || folder.split("/").some((part) => part.startsWith("."))) return undefined;
  return folder;
}

/** Normalize untrusted `meta.folders`; `undefined` when nothing usable is set. */
export function normalizeAttachmentFolders(raw: unknown): AttachmentFolders | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const folders: AttachmentFolders = {};
  for (const kind of ATTACHMENT_KINDS) {
    if (!Object.prototype.hasOwnProperty.call(record, kind)) continue;
    const folder = cleanFolder(record[kind]);
    if (folder) folders[kind] = folder;
  }
  return Object.keys(folders).length > 0 ? folders : undefined;
}

/** The folder this note saves `kind` in, or `undefined` for the default (see `AttachmentFolders`). */
export function attachmentFolder(
  doc: InkDocument | null,
  kind: AttachmentKind,
): string | undefined {
  return cleanFolder(doc?.folders?.[kind]);
}

/**
 * Set (or with `undefined` clear) where a note saves `kind`. Undoable like
 * every other change to the note, and — like `SetSingle` — an inverse puts
 * an absent key back as absent, `folders` included.
 */
export class SetAttachmentFolder implements Command {
  readonly label: string;
  private readonly folder: string | undefined;
  private previous: AttachmentFolders | undefined;
  /** The document's key order before apply, so undo restores it too. */
  private keyOrder: string[] = [];

  constructor(
    private readonly kind: AttachmentKind,
    folder: string | undefined,
  ) {
    this.folder = cleanFolder(folder);
    this.label = LABELS[kind];
  }

  apply(doc: InkDocument): void {
    this.previous = doc.folders ? { ...doc.folders } : undefined;
    this.keyOrder = Object.keys(doc);
    const next: AttachmentFolders = { ...doc.folders };
    if (this.folder) next[this.kind] = this.folder;
    else delete next[this.kind];
    writeFolders(doc, next);
  }

  invert(doc: InkDocument): void {
    const hadKey = "folders" in doc;
    writeFolders(doc, this.previous ? { ...this.previous } : {});
    // Re-adding a deleted key appends it: put it back where it was.
    if (this.previous && !hadKey) restoreKeyOrder(doc, this.keyOrder);
  }
}

function restoreKeyOrder(doc: InkDocument, order: readonly string[]): void {
  const record = doc as unknown as Record<string, unknown>;
  const entries = Object.entries(record);
  for (const [key] of entries) delete record[key];
  const rank = (key: string): number => {
    const i = order.indexOf(key);
    return i < 0 ? order.length : i;
  };
  entries.sort((a, b) => rank(a[0]) - rank(b[0]));
  for (const [key, value] of entries) record[key] = value;
}

function writeFolders(doc: InkDocument, folders: AttachmentFolders): void {
  if (Object.keys(folders).length > 0) doc.folders = folders;
  else delete doc.folders;
}

/**
 * The folders to offer under a folder field while it is typed in: paths that
 * start with what was typed first, then paths that contain it anywhere, each
 * in the order given, at most `limit`. Case never matters. An empty query
 * offers the first `limit`. Dot-folders are never offered ({@link cleanFolder}
 * would refuse them).
 */
export function suggestFolders(paths: readonly string[], query: string, limit = 6): string[] {
  const q = query.trim().toLowerCase();
  const usable = paths.filter((path) => cleanFolder(path) === path);
  if (q === "") return usable.slice(0, limit);
  const starts: string[] = [];
  const contains: string[] = [];
  for (const path of usable) {
    const lower = path.toLowerCase();
    if (lower === q) continue;
    if (lower.startsWith(q)) starts.push(path);
    else if (lower.includes(q)) contains.push(path);
  }
  return [...starts, ...contains].slice(0, limit);
}
