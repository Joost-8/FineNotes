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
 *   never a URL (ocr/worker.ts). The same bytes are served from the folder
 *   `runtime` of the `ocr-models` branch: jsDelivr sends it brotli-compressed
 *   even for `Accept-Encoding: identity`, and a range of a compressed body
 *   counts compressed bytes.
 *
 * PURE: data only.
 */

import {
  type ModelAsset,
  type ModelFile,
  formatSize,
  totalBytes,
} from "../../downloads/model-manifest";
import { OCR_TUNING, type OcrTuning } from "./ocr-words";

const BRANCH = "https://raw.githubusercontent.com/fariszyzy/FineNotes/ocr-models";
const MODELS = `${BRANCH}/ppocrv6-1`;
const RUNTIME = `${BRANCH}/runtime`;

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
  url: `${RUNTIME}/ort-wasm-simd-threaded-1.30.0.wasm`,
  bytes: 14_239_897,
  sha256: "3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2",
};

/** The three choices of the setting "OCR model". */
export type OcrTierId = "fast" | "accurate" | "most-accurate";

export const DEFAULT_OCR_TIER: OcrTierId = "fast";

/**
 * What decides whether a recogniser's reading is trusted (ocr-words.ts
 * `keptLines`). Each recogniser has its own: calibrated on that model's
 * confidences for printed text and for scribbles (docs/OCR.md, "Choosing a
 * model"), since a larger model is more confident about both.
 */
export interface OcrConfidence {
  wordMean: number;
  lineMean: number;
  wordMin: number;
}

/** PP-OCRv6 small recogniser (21.3 MB), hosted beside the tiny one's folder. */
export const OCR_SMALL_REC_FILE: ModelFile = {
  name: "PP-OCRv6_small_rec.ort",
  url: `${BRANCH}/ppocrv6-small-1/PP-OCRv6_small_rec.ort`,
  bytes: 21_290_816,
  sha256: "40bccd9fa3ae2d14d724bf9d020c8f0edfc801489477b92f7449162a538366df",
};

/** The small and the medium recogniser share this dictionary (18,709 lines; the space is the last class). */
export const OCR_SMALL_DICT_FILE: ModelFile = {
  name: "ppocrv6_dict.txt",
  url: `${BRANCH}/ppocrv6-small-1/ppocrv6_dict.txt`,
  bytes: 74_948,
  sha256: "41557512862dfe31970cf22407742b629725461dd84c0d8771bde9c87c2202c8",
};

/** PP-OCRv6 medium recogniser (76.7 MB, desktop only). */
export const OCR_MEDIUM_REC_FILE: ModelFile = {
  name: "PP-OCRv6_medium_rec.ort",
  url: `${BRANCH}/ppocrv6-medium-1/PP-OCRv6_medium_rec.ort`,
  bytes: 76_691_568,
  sha256: "14bf37252c87d2359764466c751d17787a28c9c5cbd5d64059a6f49b9dbd4ab4",
};

export const OCR_MEDIUM_DICT_FILE: ModelFile = {
  name: "ppocrv6_dict.txt",
  url: `${BRANCH}/ppocrv6-medium-1/ppocrv6_dict.txt`,
  bytes: 74_948,
  sha256: "41557512862dfe31970cf22407742b629725461dd84c0d8771bde9c87c2202c8",
};

/** The detector and the wasm: every tier's, kept once, in the folder the first tier made. */
const SHARED_FOLDER = "ocr/ppocrv6-1";
const SHARED = { folder: SHARED_FOLDER, files: [OCR_DET_FILE.name, OCR_WASM_FILE.name] } as const;

const PURPOSE =
  "It reads the printed text of scanned PDF pages on this device, so search, the text-snapping " +
  "highlighter and Copy text work on them; the pages never leave the device.";

/** Fast: the model every install had before the choice existed (same id, version and folder). */
export const OCR_MODEL: ModelAsset = {
  id: "ocr-ppocrv6",
  label: "Scanned-page reader (OCR model)",
  purpose: PURPOSE,
  version: "2",
  format: 1,
  folder: SHARED_FOLDER,
  files: [OCR_DET_FILE, OCR_REC_FILE, OCR_DICT_FILE, OCR_WASM_FILE],
  chunkBytes: 4 * 1024 * 1024,
  shared: SHARED,
};

/** Accurate: the small recogniser with the shared detector. */
export const OCR_MODEL_ACCURATE: ModelAsset = {
  id: "ocr-ppocrv6-small",
  label: "Scanned-page reader, accurate (OCR model)",
  purpose: PURPOSE,
  version: "1",
  format: 1,
  folder: "ocr/ppocrv6-small-1",
  files: [OCR_SMALL_REC_FILE, OCR_SMALL_DICT_FILE, OCR_DET_FILE, OCR_WASM_FILE],
  chunkBytes: 4 * 1024 * 1024,
  shared: SHARED,
};

/**
 * Most accurate: the medium recogniser. Kept on this device outside the
 * vault, as the large Whisper model is, so its 77 MB never syncs to a phone.
 */
export const OCR_MODEL_MOST_ACCURATE: ModelAsset = {
  id: "ocr-ppocrv6-medium",
  label: "Scanned-page reader, most accurate (OCR model)",
  purpose: PURPOSE,
  version: "1",
  format: 1,
  folder: "ocr/ppocrv6-medium-1",
  files: [OCR_MEDIUM_REC_FILE, OCR_MEDIUM_DICT_FILE, OCR_DET_FILE, OCR_WASM_FILE],
  chunkBytes: 4 * 1024 * 1024,
  deviceOnly: true,
  shared: SHARED,
};

export interface OcrTier {
  id: OcrTierId;
  /** The setting's name for it. */
  label: string;
  asset: ModelAsset;
  /** The recogniser's and its dictionary's file names in `asset`. */
  rec: string;
  dict: string;
  /**
   * What the sidecar caches record as the model that read a page: a cached
   * page from another version is read again. One per recogniser.
   */
  version: string;
  confidence: OcrConfidence;
  /** Not offered on a phone or tablet. */
  desktopOnly: boolean;
  /**
   * Seconds to read one dense A4 page (detector and recogniser, one wasm
   * thread, a laptop): the speed hint beside the choice (docs/OCR.md).
   */
  secondsPerPage: number;
}

/**
 * What the sidecar caches (ocr-cache.ts) record as the model that read a
 * page: a cached page from another model version is read again.
 */
export const OCR_MODEL_VERSION = "ppocrv6-tiny-1";

export const OCR_TIERS: readonly OcrTier[] = [
  {
    id: "fast",
    label: "Fast",
    asset: OCR_MODEL,
    rec: OCR_REC_FILE.name,
    dict: OCR_DICT_FILE.name,
    version: OCR_MODEL_VERSION,
    // The word values OCR_TUNING has always had; the line mean is 0.95 since the
    // handwriting test set (docs/OCR.md, "Handwriting test set").
    confidence: { wordMean: 0.9, lineMean: 0.95, wordMin: 0.5 },
    desktopOnly: false,
    secondsPerPage: 6,
  },
  {
    id: "accurate",
    label: "Accurate",
    asset: OCR_MODEL_ACCURATE,
    rec: OCR_SMALL_REC_FILE.name,
    dict: OCR_SMALL_DICT_FILE.name,
    version: "ppocrv6-small-1",
    confidence: { wordMean: 0.95, lineMean: 0.95, wordMin: 0.5 },
    desktopOnly: false,
    secondsPerPage: 14,
  },
  {
    id: "most-accurate",
    label: "Most accurate",
    asset: OCR_MODEL_MOST_ACCURATE,
    rec: OCR_MEDIUM_REC_FILE.name,
    dict: OCR_MEDIUM_DICT_FILE.name,
    version: "ppocrv6-medium-1",
    // The line mean 0.98 since the handwriting test set: a squiggle read as "m" reached 0.977.
    confidence: { wordMean: 0.95, lineMean: 0.98, wordMin: 0.9 },
    desktopOnly: true,
    secondsPerPage: 48,
  },
];

/** The tiers offered on this kind of device. */
export function ocrTiersFor(mobile: boolean): OcrTier[] {
  return OCR_TIERS.filter((t) => !mobile || !t.desktopOnly);
}

/** The tier to use: the chosen one if it is offered here, else Fast. */
export function effectiveOcrTier(chosen: unknown, mobile: boolean): OcrTier {
  const tiers = ocrTiersFor(mobile);
  return tiers.find((t) => t.id === chosen) ?? tiers[0];
}

/** Every number that decides what OCR text is trusted, with `tier`'s confidence thresholds. */
export function ocrTuningFor(tier: Pick<OcrTier, "confidence">): OcrTuning {
  return { ...OCR_TUNING, ...tier.confidence };
}

/**
 * The folder the first release of the PP-OCRv5 reader used. Nothing reads it
 * any more; only "Remove other OCR models" deletes it.
 */
export const OCR_OBSOLETE_FOLDERS: readonly string[] = ["ocr/ppocrv5"];

/** How many times slower a page is with Accurate than with Fast (shown on a phone or tablet). */
export const OCR_ACCURATE_SLOWDOWN = Math.round(
  OCR_TIERS[1].secondsPerPage / OCR_TIERS[0].secondsPerPage,
);

/** A choice as the setting lists it: "Fast · 23.7 MB · ~6 s/page on desktop". */
export function ocrChoiceLabel(tier: OcrTier, mobile: boolean): string {
  const where = mobile ? "on a laptop" : "on desktop";
  return `${tier.label} · ${formatSize(totalBytes(tier.asset))} · ~${tier.secondsPerPage} s/page ${where}`;
}
