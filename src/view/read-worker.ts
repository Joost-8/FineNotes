/**
 * Home's read worker: decodes a notebook off the main thread and hands back
 * only what Home draws (its facts, a few pages). It keeps the last notebook
 * it read, so the pages of one preview cost one decode. esbuild bundles this
 * file into a string (`worker:` imports) and read-worker-client.ts starts it
 * from a Blob URL, as the save worker is started.
 *
 * No DOM and no Obsidian: only the worker's own `self`.
 */

import type { InkDocument } from "../model/document";
import { entryFromDoc } from "../model/library";
import { parseInkFile } from "../model/serialize";
import { READ_TAG, type ReadReply, type ReadRequest } from "./read-protocol";

interface WorkerScope {
  onmessage: ((event: MessageEvent<{ [READ_TAG]?: true } & ReadRequest>) => void) | null;
  postMessage(message: unknown): void;
}

const scope = self as unknown as WorkerScope;
let held: { key: string; doc: InkDocument | null } | null = null;

function reply(message: ReadReply): void {
  scope.postMessage({ [READ_TAG]: true, ...message });
}

scope.onmessage = (event) => {
  const request = event.data;
  if (!request || request[READ_TAG] !== true) return;
  try {
    if (held?.key !== request.key) {
      if (request.text === undefined) {
        reply({ id: request.id, ok: false, needText: true });
        return;
      }
      held = { key: request.key, doc: parseInkFile(request.text).doc };
    }
    const doc = held.doc;
    const pages = doc?.pages ?? [];
    reply({
      id: request.id,
      ok: true,
      count: pages.length,
      pages: request.want.flatMap((i) => {
        const page = pages[i];
        return page ? [[i, page] as [number, (typeof pages)[number]]] : [];
      }),
      ...(request.facts
        ? { entry: entryFromDoc(request.facts.path, request.facts.edited, doc) }
        : {}),
    });
  } catch (error) {
    reply({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
