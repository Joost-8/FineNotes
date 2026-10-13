/**
 * Messages between a notebook view and its save worker (save-worker.ts,
 * save-worker-client.ts). Requests are handled in the order they are sent,
 * which is what keeps the worker's pages and the main thread's record of
 * them (background-save.ts) the same.
 *
 * PURE: types only.
 */

/** Tags this module's messages. */
export const SAVE_TAG = "fineNotesSave";

export type SaveRequest =
  /** Keep these pages' JSON, by slot. No reply. */
  | { type: "put"; slots: number[]; jsons: string[] }
  /** The payload of `head`, the pages in `slots` and `]}`; other slots are forgotten. */
  | { type: "compress"; id: number; head: string; slots: number[] };

export type SaveReply =
  { id: number; ok: true; payload: string } | { id: number; ok: false; error: string };
