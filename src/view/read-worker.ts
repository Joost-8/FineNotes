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
import { readTextSection } from "../recognition/text-layer";
import { notebookText } from "../search/library-search";
import { READ_TAG, type ReadReply, type ReadRequest } from "./read-protocol";

interface WorkerScope {
  onmessage: ((event: MessageEvent<{ [READ_TAG]?: true } & ReadRequest>) => void) | null;
  postMessage(message: unknown): void;
}

const scope = self as unknown as WorkerScope;
/** The last notebook read, with its text layer (all of the note's own text Home's search needs). */
let held: { key: string; doc: InkDocument | null; layer: string | null } | null = null;

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
      const parsed = parseInkFile(request.text);
      held = { key: request.key, doc: parsed.doc, layer: readTextSection(parsed.body) };
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
      ...(request.searchText ? { searchText: notebookText(pages, held.layer) } : {}),
    });
  } catch (error) {
    reply({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
