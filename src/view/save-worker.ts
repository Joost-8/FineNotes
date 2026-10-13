/**
 * The save worker: keeps a notebook's pages as UTF-8 and compresses the
 * whole document off the main thread, where a stall during a stroke is lost
 * ink on iPadOS before 18.2 (ledger 2026-10-01). esbuild bundles this file
 * into a string (`worker:` imports, esbuild.config.mjs) and
 * save-worker-client.ts starts it from a Blob URL, as the recogniser's
 * worker is started.
 *
 * No DOM and no Obsidian: only the worker's own `self`.
 */

import { FragmentStore } from "../model/fragment-store";
import { SAVE_TAG, type SaveReply, type SaveRequest } from "./save-protocol";

interface WorkerScope {
  onmessage: ((event: MessageEvent<{ [SAVE_TAG]?: true } & SaveRequest>) => void) | null;
  postMessage(message: unknown): void;
}

const scope = self as unknown as WorkerScope;
const store = new FragmentStore();

function reply(message: SaveReply): void {
  scope.postMessage({ [SAVE_TAG]: true, ...message });
}

scope.onmessage = (event) => {
  const request = event.data;
  if (!request || request[SAVE_TAG] !== true) return;
  if (request.type === "put") {
    store.put(request.slots, request.jsons);
    return;
  }
  try {
    reply({ id: request.id, ok: true, payload: store.compress(request.head, request.slots) });
  } catch (error) {
    reply({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
