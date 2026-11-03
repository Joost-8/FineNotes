/**
 * The on-device OCR model as this build expects it: PaddleOCR's PP-OCRv5
 * mobile detector (DBNet) and recogniser (SVTR, CTC) with its dictionary,
 * plus the one WebAssembly file onnxruntime-web runs them with. Downloaded
 * on first use (downloads/model-store.ts) into `<plugin>/ocr/ppocrv5/`,
 * never bundled, each file pinned by exact size and SHA-256.
 *
 * - The three model files are PaddleOCR's weights (Apache-2.0), converted
 *   to ONNX and published in the npm package pdfmarkdown-ppocrv5-models
 *   1.0.0; jsDelivr serves the package's files unchanged.
 * - `ort-wasm-simd-threaded.wasm` is the binary of onnxruntime-web 1.30.0
 *   (MIT, the version package.json pins) that its JavaScript, bundled into
 *   the OCR worker, expects: the worker is handed its bytes (`wasmBinary`),
 *   never a URL (ocr/worker.ts).
 *
 * PURE: data only.
 */

import type { ModelAsset, ModelFile } from "../../downloads/model-manifest";

const MODELS = "https://cdn.jsdelivr.net/npm/pdfmarkdown-ppocrv5-models@1.0.0";
const ORT = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist";

export const OCR_DET_FILE: ModelFile = {
  name: "PP-OCRv5_mobile_det_infer.ort",
  url: `${MODELS}/detection/PP-OCRv5_mobile_det_infer.ort`,
  bytes: 4_896_928,
  sha256: "30acfc4e21f2a23669d01a75aaeb92190f96874613108a0f7086bed264420abc",
};

export const OCR_REC_FILE: ModelFile = {
  name: "PP-OCRv5_mobile_rec_infer.onnx",
  url: `${MODELS}/recognition/PP-OCRv5_mobile_rec_infer.onnx`,
  bytes: 16_559_278,
  sha256: "d253c3cbee6e507828a5271a30ab0ec8ae7c2a99d0cc8e6f844fe380809d22b3",
};

export const OCR_DICT_FILE: ModelFile = {
  name: "ppocrv5_dict.txt",
  url: `${MODELS}/recognition/ppocrv5_dict.txt`,
  bytes: 74_014,
  sha256: "9dfc80c50b6cb07399a47a7cf25d11db475fb4ad0e1fc96b2eff6467c8166ff3",
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
export const OCR_MODEL_VERSION = "ppocrv5-mobile-1";

export const OCR_MODEL: ModelAsset = {
  id: "ocr-ppocrv5",
  label: "Scanned-page reader (OCR model)",
  purpose:
    "It reads the printed text of scanned PDF pages on this device, so search, the text-snapping " +
    "highlighter and Copy text work on them; the pages never leave the device.",
  version: "1",
  format: 1,
  folder: "ocr/ppocrv5",
  files: [OCR_DET_FILE, OCR_REC_FILE, OCR_DICT_FILE, OCR_WASM_FILE],
  chunkBytes: 4 * 1024 * 1024,
};
