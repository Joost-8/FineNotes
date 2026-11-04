/**
 * The on-device OCR model as this build expects it: PaddleOCR's PP-OCRv5
 * mobile detector (DBNet) and PP-OCRv6 tiny recogniser (SVTR, CTC) with its
 * dictionary, plus the one WebAssembly file onnxruntime-web runs them with.
 * Downloaded on first use (downloads/model-store.ts) into
 * `<plugin>/ocr/ppocrv6-1/`, never bundled, each file pinned by exact size
 * and SHA-256.
 *
 * - The three model files are PaddleOCR's weights (Apache-2.0) in ONNX
 *   Runtime's `.ort` format, unchanged from the files of
 *   github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models (the detector: from
 *   the npm package pdfmarkdown-ppocrv5-models 1.0.0). They are served from the
 *   data-only branch `ocr-models` of this repository (folder `ppocrv6-1`, with
 *   the licence), over raw.githubusercontent.com, which supports range
 *   requests and has no bandwidth budget.
 * - `ort-wasm-simd-threaded.wasm` is the binary of onnxruntime-web 1.30.0
 *   (MIT, the version package.json pins) that its JavaScript, bundled into
 *   the OCR worker, expects: the worker is handed its bytes (`wasmBinary`),
 *   never a URL (ocr/worker.ts).
 *
 * PURE: data only.
 */

import type { ModelAsset, ModelFile } from "../../downloads/model-manifest";

const MODELS = "https://raw.githubusercontent.com/fariszyzy/FineNotes/ocr-models/ppocrv6-1";
const ORT = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist";

export const OCR_DET_FILE: ModelFile = {
  name: "PP-OCRv5_mobile_det_infer.ort",
  url: `${MODELS}/PP-OCRv5_mobile_det_infer.ort`,
  bytes: 4_896_928,
  sha256: "30acfc4e21f2a23669d01a75aaeb92190f96874613108a0f7086bed264420abc",
};

export const OCR_REC_FILE: ModelFile = {
  name: "PP-OCRv6_tiny_rec.ort",
  url: `${MODELS}/PP-OCRv6_tiny_rec.ort`,
  bytes: 4_530_048,
  sha256: "efc46adf1bde1e05b58748268abb0e71791bfa8616c435676bbca13d1ea47767",
};

export const OCR_DICT_FILE: ModelFile = {
  name: "ppocrv6_tiny_dict.txt",
  url: `${MODELS}/ppocrv6_tiny_dict.txt`,
  bytes: 27_157,
  sha256: "2f3717bbd530b681b6db3be35cc485e8a41a932b9558b833986bf0894eb21f2d",
};

/** onnxruntime-web 1.30.0's WebAssembly binary (the plain CPU build `onnxruntime-web/wasm` uses). */
export const OCR_WASM_FILE: ModelFile = {
  name: "ort-wasm-simd-threaded.wasm",
  url: `${ORT}/ort-wasm-simd-threaded.wasm`,
  bytes: 14_239_897,
  sha256: "3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2",
};

/**
 * What the sidecar caches (ocr-cache.ts) record as the model that read a
 * page: a cached page from another model version is read again.
 */
export const OCR_MODEL_VERSION = "ppocrv6-tiny-1";

export const OCR_MODEL: ModelAsset = {
  id: "ocr-ppocrv6",
  label: "Scanned-page reader (OCR model)",
  purpose:
    "It reads the printed text of scanned PDF pages on this device, so search, the text-snapping " +
    "highlighter and Copy text work on them; the pages never leave the device.",
  version: "2",
  format: 1,
  folder: "ocr/ppocrv6-1",
  files: [OCR_DET_FILE, OCR_REC_FILE, OCR_DICT_FILE, OCR_WASM_FILE],
  chunkBytes: 4 * 1024 * 1024,
};
