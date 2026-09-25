/**
 * Whether what Obsidian just read from a notebook file may ever be saved
 * back over it.
 *
 * A notebook view saves by rebuilding the whole file from what it loaded.
 * That is only safe when the load saw the file as it really is. On the iPad
 * it sometimes does not: iCloud can hand over an empty placeholder for a
 * file whose bytes have not arrived yet, and a sync caught half-way can
 * leave the ink block cut short. Rebuilding from either would replace the
 * user's ink with an empty page, so such a read is held instead: every save
 * writes it back unchanged, and the view refuses edits until a later load
 * comes through clean.
 *
 * No DOM, no Obsidian.
 */

import { BLOCK_LABEL, LEGACY_BLOCK_LABEL } from "../constants";

/** One read of a notebook file, as the view received it. */
export interface NoteRead {
  /** The text Obsidian handed to the view. */
  text: string;
  /** The file's size on disk as the vault last reported it; 0 when not known. */
  bytesOnDisk: number;
  /** Whether a notebook could be decoded from `text`. */
  decoded: boolean;
}

/**
 * Why a read cannot be trusted:
 * - `empty-read`: nothing but whitespace came back from a file that has bytes;
 * - `unreadable-ink`: the text names an ink block, but no notebook decoded
 *   from it (cut off, corrupt, or from a newer format).
 */
export type Distrust = "empty-read" | "unreadable-ink";

/** Where an ink block starts, current and pre-0.2.0. */
const BLOCK_OPENERS = [`%%${BLOCK_LABEL}`, `%%${LEGACY_BLOCK_LABEL}`];

/** Why `read` must not be saved over its file, or `null` when it is safe to. */
export function distrust(read: NoteRead): Distrust | null {
  if (read.bytesOnDisk > 0 && read.text.trim() === "") return "empty-read";
  if (!read.decoded && BLOCK_OPENERS.some((opener) => read.text.includes(opener))) {
    return "unreadable-ink";
  }
  return null;
}

/**
 * Holds the last untrusted read so that saves echo it. Each new read either
 * replaces what is held or releases it; nothing else does, so a view that is
 * cleared between two files stays locked until the next file has loaded.
 */
export class LoadGuard {
  private held: string | null = null;

  /** Judge a fresh read. Returns why it is held, or `null` when it is not. */
  admit(read: NoteRead): Distrust | null {
    const reason = distrust(read);
    this.held = reason === null ? null : read.text;
    return reason;
  }

  /** True while an untrusted read is held: the note takes no edits. */
  get locked(): boolean {
    return this.held !== null;
  }

  /** The file's next contents: the held read while locked, else `rebuild()`. */
  contents(rebuild: () => string): string {
    return this.held ?? rebuild();
  }
}
