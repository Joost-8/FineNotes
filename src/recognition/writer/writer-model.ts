/**
 * Dostoyev, the handwriting writer this build downloads for Neaten, pinned by size
 * and SHA-256: the model's manifest (`manifest.ts`, the main file) and the
 * graphs it names, made by research/handwriting-rig/gen/neaten_v1.py
 * (`release`). The WebAssembly binary is the OCR's own file, kept once in
 * its folder.
 *
 * A later model is a new entry here (new id or version, files and hashes)
 * and, if its kind is new, a kind in `kinds.ts`; nothing else in Neaten
 * names a model. Other versions in the folder are found by their manifest
 * (`dostoyev-<version>.json`) and read for their format, so an older one shows
 * as needing an update and the download replaces it, as the OCR's and
 * Grape's do.
 *
 * Published as release v1.0 of its own repository, Joost-8/Dostoyev
 * (Apache 2.0; Joost's decision, 2026-11-24); every file there was checked
 * against the size and hash below.
 *
 * PURE: data only.
 */

import type { ModelAsset } from "../../downloads/model-manifest";
import { t } from "../../i18n/translate";
import { OCR_MODEL, OCR_WASM_FILE } from "../ocr/ocr-model";
import { WRITER_FORMAT } from "./manifest";

const RELEASE = "https://github.com/Joost-8/Dostoyev/releases/download/v1.0";

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
  version: "1.0",
  format: WRITER_FORMAT,
  folder: "handwriting/writer",
  files: [
    // The manifest first: it is the main file, by which other versions are recognised.
    file(
      "dostoyev-1.0.json",
      4_914,
      "a11698ec0f3cd6de7e778d95667042e0cc89343c2f62280a18d1c8a860f6963e",
    ),
    file(
      "dostoyev-1.0-velocity.int8.onnx",
      10_328_999,
      "067d9bd0e21deaa7c07940808c09906110e57534f29f56adb53c850fb5add48b",
    ),
    file(
      "dostoyev-1.0-encode.int8.onnx",
      2_112_608,
      "b1a0d73554bd81fca047509582c1617520c58bfd8d984e8f18fe6c8a1a902991",
    ),
    file(
      "dostoyev-1.0-durations.int8.onnx",
      1_634_221,
      "b06572e0ddbc6af27ea6bdd1432f584f991f4e46b3fa2175c70ec57f09cabc9d",
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
