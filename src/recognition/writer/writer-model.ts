/**
 * Dostoyev, the handwriting writer this build downloads for Neaten, pinned by size
 * and SHA-256: the model's manifest (`manifest.ts`, the main file) and the
 * graphs it names, made by research/handwriting-rig/gen/neaten_v1.py
 * (`release`, `c2`). The WebAssembly binary is the OCR's own file, kept once in
 * its folder.
 *
 * A later model is a new entry here (new id or version, files and hashes)
 * and, if its kind is new, a kind in `kinds.ts`; nothing else in Neaten
 * names a model. Other versions in the folder are found by their manifest
 * (`dostoyev-<version>.json`) and read for their format, so an older one shows
 * as needing an update and the download replaces it, as the OCR's and
 * Grape's do.
 *
 * Version 1.0 (A long, kind "dual") is release v1.0 of its own repository,
 * Joost-8/Dostoyev (Apache 2.0; Joost's decision, 2026-11-24). Version 2.0
 * is C2 long (kind "pieces", research gen/neaten_v1.py `c2`), Beautify's
 * writer from 24 November; its files are to be release v2.0 there.
 *
 * PURE: data only.
 */

import type { ModelAsset } from "../../downloads/model-manifest";
import { t } from "../../i18n/translate";
import { OCR_MODEL, OCR_WASM_FILE } from "../ocr/ocr-model";
import { WRITER_FORMAT } from "./manifest";

const RELEASE = "https://github.com/Joost-8/Dostoyev/releases/download/v2.0";

/**
 * Whether the files are published at `RELEASE`: Neaten is then offered
 * everywhere, and its first use offers the download. False would offer it
 * only where a copy is already in the folder (a development copy).
 */
export const WRITER_HOSTED = true;

const file = (name: string, bytes: number, sha256: string) => ({
  name,
  url: `${RELEASE}/${name}`,
  bytes,
  sha256,
});

export const WRITER_MODEL: ModelAsset = {
  id: "writer",
  get label() {
    return t("ai.neaten.modelLabel");
  },
  get purpose() {
    return t("ai.neaten.modelPurpose");
  },
  version: "2.0",
  format: WRITER_FORMAT,
  folder: "handwriting/writer",
  files: [
    // The manifest first: it is the main file, by which other versions are recognised.
    file(
      "dostoyev-2.0.json",
      5_224,
      "e39e7b61f30b9d9d1910f31c5556b977f8d9732667b63a35cf854e915c24a07a",
    ),
    file(
      "dostoyev-2.0-velocity.int8.onnx",
      10_181_538,
      "51934ada4ec7f1f3298fb6f90c2ce9790427b8f42afcbb1cc675d636a2e0cb21",
    ),
    file(
      "dostoyev-2.0-encode.int8.onnx",
      1_615_965,
      "e4c5dd77a75c2a1898f004dc914fd51840d13b98c70187e96f67357d1eeac9b7",
    ),
    file(
      "dostoyev-2.0-durations.int8.onnx",
      1_636_485,
      "d153ba8ffed365f60b3bb60fd60e5c5e8143401495291656681471a0e6a543ff",
    ),
    OCR_WASM_FILE,
  ],
  // Other versions' manifests (dostoyev-<version>.json), whatever research family each came from;
  // their graphs are named after them (dostoyev-<version>-…), and go with them.
  prefix: "dostoyev-",
  suffix: ".json",
  chunkBytes: 4 * 1024 * 1024,
  // The WebAssembly binary lives with the OCR's, downloaded once for both.
  shared: { folder: OCR_MODEL.folder, files: [OCR_WASM_FILE.name] },
};
