/**
 * Files a note points at follow it when they are renamed or moved (#14): PDF
 * pages, pictures, recordings and their transcripts, and the note's own
 * attachment folders. Those paths live inside the compressed payload, where
 * Obsidian's "Automatically update internal links" cannot see them, so the
 * plugin keeps a log of the moves it saw in the vault and relinks a note from
 * it: an open note at once, a closed one the next time it opens.
 *
 * A path is only ever relinked when its file is gone and the move it is
 * followed through leads to a file that exists. A guess by file name (a PDF
 * moved outside Obsidian, or before this log existed) is never made here: two
 * courses can both have a "Lecture 1.pdf", and the right one may simply not
 * have synced yet.
 *
 * Pure: no DOM, no Obsidian.
 */

import type { InkDocument } from "./document";

/** One rename or move seen in the vault; a folder's covers everything inside it. */
export interface FileMove {
  from: string;
  to: string;
}

/** Moves kept, newest last. A note closed for longer than this many moves keeps its old paths. */
export const MOVE_LOG_LIMIT = 500;

/** `path` itself or anything inside it, as a folder. */
function inside(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`);
}

/**
 * `log` with the move of `from` to `to` added. Earlier moves *away* from
 * `to` (or from inside it) are dropped: something is there again now, and a
 * note that still points there means the new arrival. Untrusted entries (not
 * two different non-empty strings) are dropped too, so a hand-edited
 * `data.json` cannot make a lookup throw.
 */
export function recordMove(log: readonly unknown[], from: string, to: string): FileMove[] {
  const kept = cleanMoveLog(log).filter((move) => !inside(move.from, to));
  if (from && to && from !== to) kept.push({ from, to });
  return kept.slice(-MOVE_LOG_LIMIT);
}

/** A stored log, with anything that is not a move left out. */
export function cleanMoveLog(log: unknown): FileMove[] {
  if (!Array.isArray(log)) return [];
  const moves: FileMove[] = [];
  for (const entry of log as unknown[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const { from, to } = entry as Record<string, unknown>;
    if (typeof from === "string" && typeof to === "string" && from && to && from !== to) {
      moves.push({ from, to });
    }
  }
  return moves.slice(-MOVE_LOG_LIMIT);
}

/**
 * Where `path` went: every move from the oldest on that names it (or a folder
 * it is in) carries it along, so "folder renamed, then the file moved out of
 * it" lands where the file is now. One pass in order, so a move and its move
 * back cannot loop.
 */
export function followMoves(log: readonly FileMove[], path: string): string {
  let current = path;
  for (const move of log) {
    if (inside(current, move.from)) current = move.to + current.slice(move.from.length);
  }
  return current;
}

/**
 * The relink for `path`, or `undefined` to leave it: only when nothing is at
 * `path` and the log leads to something that is.
 */
export function movedTarget(
  log: readonly FileMove[],
  exists: (path: string) => boolean,
  path: string,
): string | undefined {
  if (!path || exists(path)) return undefined;
  const to = followMoves(log, path);
  return to !== path && exists(to) ? to : undefined;
}

/**
 * Rewrite, in place, every vault path `doc` holds that `relink` has a new
 * path for; the number rewritten. In place on purpose: commands in the undo
 * history hold these same page, picture and recording objects, so undoing an
 * insert puts back the relinked path, not the dead one.
 */
export function relinkDocument(
  doc: InkDocument,
  relink: (path: string) => string | undefined,
): number {
  let changed = 0;
  const swap = (path: string): string => {
    const to = relink(path);
    if (to === undefined || to === path) return path;
    changed++;
    return to;
  };
  for (const page of doc.pages) {
    if (page.backdrop.kind === "pdf") page.backdrop.path = swap(page.backdrop.path);
    for (const image of page.images) image.path = swap(image.path);
  }
  for (const recording of doc.recordings ?? []) {
    recording.path = swap(recording.path);
    if (recording.transcript !== undefined) recording.transcript = swap(recording.transcript);
  }
  if (doc.folders) {
    for (const kind of Object.keys(doc.folders) as Array<keyof typeof doc.folders>) {
      const folder = doc.folders[kind];
      if (folder !== undefined) doc.folders[kind] = swap(folder);
    }
  }
  return changed;
}
