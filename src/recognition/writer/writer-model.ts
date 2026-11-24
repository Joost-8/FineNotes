/**
 * The handwriting writer Neaten runs ("A long", research/handwriting-rig,
 * 2026-11-24): three ONNX graphs with int8 weights (gen/export_onnx.py,
 * gen/onnx_quantize.py) and the model's numbers (`writer.json`), pinned by
 * size and SHA-256. Downloaded on first use like the OCR model; the
 * WebAssembly binary is the OCR's own file, kept once in its folder.
 *
 * NOT PUBLISHED YET: where the files are hosted is Joost's decision. Until
 * then the URLs below name the proposed release (Joost-8/Grape, tag
 * writer-1.0) and a development copy is placed in the folder by hand; the
 * store uses any copy whose bytes match.
 *
 * PURE: data only.
 */

import type { ModelAsset } from "../../downloads/model-manifest";
import { t } from "../../i18n/translate";
import { OCR_MODEL, OCR_WASM_FILE } from "../ocr/ocr-model";

const RELEASE = "https://github.com/Joost-8/Grape/releases/download/writer-1.0";

/**
 * Whether the files are published at `RELEASE`. Until they are, Neaten is
 * offered only where a copy is already in the folder (a development copy).
 */
export const WRITER_HOSTED = false;

/** The graphs' and the numbers' files, by role. */
export const WRITER_FILES = {
  encode: "encode.int8.onnx",
  durations: "durations.int8.onnx",
  velocity: "velocity.int8.onnx",
  meta: "writer.json",
} as const;

export const WRITER_MODEL: ModelAsset = {
  id: "writer-a-long",
  get label() {
    return t("ai.neaten.modelLabel");
  },
  get purpose() {
    return t("ai.neaten.modelPurpose");
  },
  version: "1.0",
  format: 1,
  folder: "handwriting/writer-1",
  files: [
    {
      name: WRITER_FILES.velocity,
      url: `${RELEASE}/${WRITER_FILES.velocity}`,
      bytes: 10_328_999,
      sha256: "067d9bd0e21deaa7c07940808c09906110e57534f29f56adb53c850fb5add48b",
    },
    {
      name: WRITER_FILES.encode,
      url: `${RELEASE}/${WRITER_FILES.encode}`,
      bytes: 2_112_608,
      sha256: "b1a0d73554bd81fca047509582c1617520c58bfd8d984e8f18fe6c8a1a902991",
    },
    {
      name: WRITER_FILES.durations,
      url: `${RELEASE}/${WRITER_FILES.durations}`,
      bytes: 1_634_221,
      sha256: "b06572e0ddbc6af27ea6bdd1432f584f991f4e46b3fa2175c70ec57f09cabc9d",
    },
    {
      name: WRITER_FILES.meta,
      url: `${RELEASE}/${WRITER_FILES.meta}`,
      bytes: 1_508,
      sha256: "55a6c0574e0d830fdd71d1209d7e34efbbb8fe00668f2206e99a4cdb1046a88a",
    },
    OCR_WASM_FILE,
  ],
  chunkBytes: 4 * 1024 * 1024,
  // The WebAssembly binary lives with the OCR's, downloaded once for both.
  shared: { folder: OCR_MODEL.folder, files: [OCR_WASM_FILE.name] },
};
