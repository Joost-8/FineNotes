/**
 * Messages between Home and its read worker (read-worker.ts,
 * read-worker-client.ts): a notebook's text goes in, its Home facts and the
 * pages asked for come back, so a big notebook is never decoded on the main
 * thread (3.6 MB took 1.1 s there on a slowed CPU).
 *
 * PURE: types only.
 */

import type { Page } from "../model/document";
import type { LibraryEntry } from "../model/library";

/** Tags this module's messages. */
export const READ_TAG = "fineNotesRead";

export interface ReadRequest {
  id: number;
  /** The file and its version (`path@mtime:size`): the worker keeps the last one read. */
  key: string;
  /** The note's text; left out when the worker holds `key` already. */
  text?: string;
  /** The pages wanted, by index. */
  want: number[];
  /** Also the notebook's Home facts, as of this edit time. */
  facts?: { path: string; edited: number };
}

export type ReadReply =
  | { id: number; ok: true; count: number; pages: Array<[number, Page]>; entry?: LibraryEntry }
  /** The worker no longer holds `key`: ask again with the text. */
  | { id: number; ok: false; needText: true }
  | { id: number; ok: false; needText?: false; error: string };
