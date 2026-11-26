/**
 * Where a text note keeps its files: pictures, recordings, their
 * transcripts and saved AI chats. As a notebook with a folder of its own
 * (`notebookPaths`), each kind has its folder, named as a notebook names
 * it, in a folder named after the note. The note itself stays where it is,
 * beside that folder, so a note without files is still one file:
 *
 *   <dir>/<Title>.note.md
 *   <dir>/<Title>/Images/
 *   <dir>/<Title>/Recordings/
 *   <dir>/<Title>/Transcripts/
 *   <dir>/<Title>/AI chats/
 *   <dir>/<Title>/Exports/
 *
 * Each folder is made the first time something is saved in it, as a
 * board's are. When the note is renamed or moved, its folder goes with it
 * (`followNoteRename`), and the note's embeds follow the move
 * (`relinkNotePaths`). A folder of the note's name with none of these
 * folders in it is the user's own, and is never moved.
 *
 * Pure: the view supplies what exists and does the renaming.
 */

import {
  OWN_FOLDER_AUDIO,
  OWN_FOLDER_CHATS,
  OWN_FOLDER_EXPORTS,
  OWN_FOLDER_IMAGES,
  OWN_FOLDER_TRANSCRIPTS,
} from "./new-notebook";
import type { NoteBlock, TextNote } from "./text-note";
import { transcriptPathFor } from "../audio/recording";

/** The kinds of file a text note keeps. */
export type NoteFileKind = "images" | "audio" | "transcripts" | "chats" | "exports";

const SUBFOLDER: Readonly<Record<NoteFileKind, string>> = {
  images: OWN_FOLDER_IMAGES,
  audio: OWN_FOLDER_AUDIO,
  transcripts: OWN_FOLDER_TRANSCRIPTS,
  chats: OWN_FOLDER_CHATS,
  exports: OWN_FOLDER_EXPORTS,
};

const SUFFIX = ".note.md";

function parentOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Whether a vault path is a text note's. */
export function isTextNotePath(path: string): boolean {
  const name = nameOf(path);
  return name.toLowerCase().endsWith(SUFFIX) && name.length > SUFFIX.length;
}

/** The folder of a note's files: beside the note, named after it ("" for a path that is no note). */
export function noteFilesFolder(notePath: string): string {
  if (!isTextNotePath(notePath)) return "";
  const parent = parentOf(notePath);
  const base = nameOf(notePath).slice(0, -SUFFIX.length);
  return parent ? `${parent}/${base}` : base;
}

/** Where a note saves `kind` ("" for a path that is no note). */
export function noteFilesSubfolder(notePath: string, kind: NoteFileKind): string {
  const folder = noteFilesFolder(notePath);
  return folder ? `${folder}/${SUBFOLDER[kind]}` : "";
}

/**
 * Whether a folder holding `childNames` is a note's files folder: it holds
 * at least one of the folders a note keeps its files in. Compared without
 * case, as the file systems a vault syncs to are.
 */
export function holdsNoteFiles(childNames: readonly string[]): boolean {
  const ours = new Set(Object.values(SUBFOLDER).map((name) => name.toLowerCase()));
  return childNames.some((name) => ours.has(name.toLowerCase()));
}

/**
 * The note at `oldPath` is now at `newPath`: the folder its files are in
 * should go from `from` to `to`, or `undefined` when nothing should move
 * (not a note before and after, the same place, the old folder not one of
 * a note's (`isFilesFolder`), or the new name already taken (`exists`)).
 */
export function followNoteRename(
  oldPath: string,
  newPath: string,
  isFilesFolder: (path: string) => boolean,
  exists: (path: string) => boolean,
): { from: string; to: string } | undefined {
  const from = noteFilesFolder(oldPath);
  const to = noteFilesFolder(newPath);
  if (!from || !to || from === to) return undefined;
  // Only the case changed: the file system may call these the same folder.
  if (from.toLowerCase() === to.toLowerCase() && parentOf(from) === parentOf(to)) {
    return isFilesFolder(from) ? { from, to } : undefined;
  }
  if (!isFilesFolder(from) || exists(to)) return undefined;
  return { from, to };
}

/**
 * Where `path` is after the file or folder at `from` moved to `to`:
 * `to` for `from` itself, the same place inside `to` for anything inside
 * `from`, else `undefined`.
 */
export function movedPath(path: string, from: string, to: string): string | undefined {
  if (!from || from === to) return undefined;
  if (path === from) return to;
  return path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : undefined;
}

/**
 * A recording's newest transcript note, or `undefined` while it has none.
 * A note keeps no link to it: transcripts are named after the recording
 * (`transcriptPathFor`), and each new one takes the next free name
 * (`X transcript.md`, `X transcript 1.md`, …), so the last of those is the newest.
 */
export function latestTranscriptPath(
  audioPath: string,
  folder: string | undefined,
  exists: (path: string) => boolean,
): string | undefined {
  const first = transcriptPathFor(audioPath, folder);
  if (!exists(first)) return undefined;
  const stem = first.slice(0, -".md".length);
  let latest = first;
  for (let n = 1; n < 1000; n++) {
    const next = `${stem} ${n}.md`;
    if (!exists(next)) break;
    latest = next;
  }
  return latest;
}

/**
 * The note with each picture's and recording's path put through `relink`
 * (a new path, or `undefined` to keep it), or `null` when none changed.
 */
export function relinkNotePaths(
  note: TextNote,
  relink: (path: string) => string | undefined,
): TextNote | null {
  let changed = false;
  const blocks = note.blocks.map((block): NoteBlock => {
    if (block.type !== "image" && block.type !== "audio") return block;
    const next = relink(block.path);
    if (next === undefined || next === block.path) return block;
    changed = true;
    return { ...block, path: next };
  });
  return changed ? { ...note, blocks } : null;
}
