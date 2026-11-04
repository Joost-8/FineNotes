/**
 * "Remove other OCR models": only the models of the other choices and the old
 * version's folder go, only on request, and never what the chosen model needs.
 */

import { describe, expect, it } from "vitest";
import {
  OCR_MODEL,
  OCR_MODEL_ACCURATE,
  OCR_MODEL_MOST_ACCURATE,
} from "../../src/recognition/ocr/ocr-model";
import {
  type OcrCleanupDeps,
  type RemovableModel,
  cleanupText,
  removeOtherOcrModels,
} from "../../src/view/ocr-models";

function model(asset: RemovableModel["asset"], kind: string, log: string[]): RemovableModel {
  return {
    asset,
    state: { kind },
    check: () => {
      log.push(`check ${asset.id}`);
      return Promise.resolve();
    },
    remove: () => {
      log.push(`remove ${asset.id}`);
      return Promise.resolve();
    },
  };
}

function rig(kinds: Record<string, string>, folders: string[] = []) {
  const log: string[] = [];
  const stores = new Map(
    [OCR_MODEL, OCR_MODEL_ACCURATE, OCR_MODEL_MOST_ACCURATE].map((a) => [
      a.id,
      model(a, kinds[a.id] ?? "missing", log),
    ]),
  );
  const present = new Set(folders);
  const deps: OcrCleanupDeps = {
    store: (id) => stores.get(id),
    folderExists: (f) => Promise.resolve(present.has(f)),
    removeFolder: (f) => {
      log.push(`rmdir ${f}`);
      present.delete(f);
      return Promise.resolve();
    },
  };
  return { deps, log };
}

describe("removeOtherOcrModels", () => {
  it("removes the models that are not in use and the old folder, never the one in use", async () => {
    const r = rig(
      { "ocr-ppocrv6": "ready", "ocr-ppocrv6-small": "ready", "ocr-ppocrv6-medium": "ready" },
      ["ocr/ppocrv5"],
    );
    const result = await removeOtherOcrModels("ocr-ppocrv6-small", r.deps);
    expect(r.log).toEqual([
      "check ocr-ppocrv6",
      "remove ocr-ppocrv6",
      "check ocr-ppocrv6-medium",
      "remove ocr-ppocrv6-medium",
      "rmdir ocr/ppocrv5",
    ]);
    expect(result.models).toEqual(["ocr-ppocrv6", "ocr-ppocrv6-medium"]);
    expect(result.folders).toEqual(["ocr/ppocrv5"]);
    // Their own files only: 4.5 MB + 27 KB, and 76.7 MB + 75 KB; the shared detector and wasm stay.
    expect(result.bytes).toBe(4_530_048 + 27_157 + 76_691_568 + 74_948);
    expect(cleanupText(result)).toBe(
      "FineNotes: removed 2 other OCR models (81.3 MB) and the folder of an old version.",
    );
  });

  it("leaves models that are not on this device, a download in flight, and a missing old folder", async () => {
    const r = rig({ "ocr-ppocrv6": "missing", "ocr-ppocrv6-medium": "downloading" });
    const result = await removeOtherOcrModels("ocr-ppocrv6-small", r.deps);
    expect(r.log.filter((l) => l.startsWith("remove") || l.startsWith("rmdir"))).toEqual([]);
    expect(result).toEqual({ models: [], folders: [], bytes: 0 });
    expect(cleanupText(result)).toMatch(/no other OCR models/);
  });

  it("removes the obsolete folder even when no model is left to remove", async () => {
    const r = rig({}, ["ocr/ppocrv5"]);
    const result = await removeOtherOcrModels("ocr-ppocrv6", r.deps);
    expect(result.folders).toEqual(["ocr/ppocrv5"]);
    expect(cleanupText(result)).toBe("FineNotes: removed the folder of an old version.");
  });
});
