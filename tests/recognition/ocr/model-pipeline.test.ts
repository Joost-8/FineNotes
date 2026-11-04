import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { totalBytes } from "../../../src/downloads/model-manifest";
import {
  OCR_DET_FILE,
  OCR_MODEL,
  OCR_MODEL_ACCURATE,
  OCR_MODEL_MOST_ACCURATE,
  OCR_TIERS,
  effectiveOcrTier,
  ocrTiersFor,
  ocrTuningFor,
  OCR_REC_FILE,
  OCR_DICT_FILE,
  OCR_WASM_FILE,
} from "../../../src/recognition/ocr/ocr-model";
import { type OcrBackend, OcrCancelled, readPage } from "../../../src/recognition/ocr/pipeline";
import { OCR_TUNING, keptLines } from "../../../src/recognition/ocr/ocr-words";
import { REC_STRIDE } from "../../../src/recognition/ocr/rec";

describe("the OCR model as pinned", () => {
  it("pins every file by exact size and a lower-case SHA-256, over https (all assets of one release of the templates repository: never a CDN that compresses a ranged body)", () => {
    for (const file of OCR_MODEL.files) {
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(file.bytes).toBeGreaterThan(0);
      expect(file.url).toMatch(
        /^https:\/\/github\.com\/Joost-8\/FineNotes-templates\/releases\/download\/ocr-1\//,
      );
      // Never LFS (media.githubusercontent.com) or Hugging Face.
      expect(file.url).not.toMatch(/media\.githubusercontent|huggingface/);
      if (file !== OCR_WASM_FILE) expect(file.url.endsWith(`/${file.name}`)).toBe(true);
      else expect(file.url.endsWith("/ort-wasm-simd-threaded-1.30.0.wasm")).toBe(true);
    }
    expect(OCR_MODEL.files.map((f) => f.name)).toEqual([
      OCR_DET_FILE.name,
      OCR_REC_FILE.name,
      OCR_DICT_FILE.name,
      OCR_WASM_FILE.name,
    ]);
    expect(totalBytes(OCR_MODEL)).toBe(4_896_928 + 4_530_048 + 27_157 + 14_239_897);
  });

  it("downloads the WebAssembly binary of exactly the onnxruntime-web the build pins", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      dependencies: Record<string, string>;
    };
    const pinned = pkg.dependencies["onnxruntime-web"];
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
    expect(OCR_WASM_FILE.url).toContain(`/ort-wasm-simd-threaded-${pinned}.wasm`);
    const installed = JSON.parse(
      readFileSync("node_modules/onnxruntime-web/package.json", "utf8"),
    ) as {
      version: string;
    };
    expect(installed.version).toBe(pinned);
  });

  it("pins the other two recognisers the same way, each under 100 MB, in folders of its own", () => {
    for (const asset of [OCR_MODEL_ACCURATE, OCR_MODEL_MOST_ACCURATE]) {
      for (const file of asset.files) {
        expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(file.bytes).toBeLessThan(100_000_000);
        expect(file.url).toMatch(
          /^https:\/\/github\.com\/Joost-8\/FineNotes-templates\/releases\/download\/ocr-1\//,
        );
      }
    }
    expect(OCR_MODEL_ACCURATE.files.map((f) => f.name)).toEqual([
      "PP-OCRv6_small_rec.ort",
      "ppocrv6_dict.txt",
      OCR_DET_FILE.name,
      OCR_WASM_FILE.name,
    ]);
    expect(totalBytes(OCR_MODEL_ACCURATE)).toBe(21_290_816 + 74_948 + 4_896_928 + 14_239_897);
    expect(OCR_MODEL_MOST_ACCURATE.files[0].bytes).toBe(76_691_568);
  });

  it("shares the detector and the wasm between the choices: one file, one URL, one folder", () => {
    const shared = OCR_TIERS.map((t) =>
      t.asset.files.filter((f) => f.name === OCR_DET_FILE.name || f.name === OCR_WASM_FILE.name),
    );
    for (const files of shared) expect(files).toEqual([OCR_DET_FILE, OCR_WASM_FILE]);
    for (const { asset } of OCR_TIERS) {
      expect(asset.shared).toEqual({
        folder: OCR_MODEL.folder,
        files: [OCR_DET_FILE.name, OCR_WASM_FILE.name],
      });
    }
    // Different ids and folders for what is not shared, so no file of one is taken for another's.
    expect(new Set(OCR_TIERS.map((t) => t.asset.id)).size).toBe(3);
    expect(new Set(OCR_TIERS.map((t) => t.asset.folder)).size).toBe(3);
  });

  it("keeps Fast exactly as every install has it, and the largest model off the vault", () => {
    expect(OCR_MODEL).toMatchObject({ id: "ocr-ppocrv6", version: "2", folder: "ocr/ppocrv6-1" });
    expect(OCR_MODEL.deviceOnly).toBeUndefined();
    expect(OCR_MODEL_ACCURATE.deviceOnly).toBeUndefined();
    expect(OCR_MODEL_MOST_ACCURATE.deviceOnly).toBe(true);
    expect(OCR_TIERS[0].confidence).toEqual({ wordMean: 0.9, lineMean: 0.95, wordMin: 0.5 });
    expect(OCR_TUNING).toMatchObject(OCR_TIERS[0].confidence);
    // The calibrated numbers (docs/OCR.md, "Handwriting test set"): a change needs a new sweep.
    expect(OCR_TIERS.map((t) => t.confidence)).toEqual([
      { wordMean: 0.9, lineMean: 0.95, wordMin: 0.5 },
      { wordMean: 0.95, lineMean: 0.95, wordMin: 0.5 },
      { wordMean: 0.95, lineMean: 0.98, wordMin: 0.9 },
    ]);
  });

  it("offers the largest model on a desktop only; anything else chosen is Fast", () => {
    expect(ocrTiersFor(false).map((t) => t.id)).toEqual(["fast", "accurate", "most-accurate"]);
    expect(ocrTiersFor(true).map((t) => t.id)).toEqual(["fast", "accurate"]);
    expect(effectiveOcrTier("most-accurate", false).id).toBe("most-accurate");
    expect(effectiveOcrTier("most-accurate", true).id).toBe("fast");
    expect(effectiveOcrTier("accurate", true).id).toBe("accurate");
    expect(effectiveOcrTier(undefined, false).id).toBe("fast");
    expect(effectiveOcrTier("huge", false).id).toBe("fast");
  });

  it("gives each recogniser its own confidence thresholds, stricter as the model gets surer", () => {
    const [fast, accurate, best] = OCR_TIERS.map((t) => ocrTuningFor(t));
    expect(accurate.wordMean).toBeGreaterThan(fast.wordMean);
    expect(accurate.lineMean).toBeGreaterThanOrEqual(fast.lineMean);
    // The medium model reads a squiggle as "m" at 0.977 and its printed lines start at 0.998, so its
    // line mean is higher still; it also asks for a surer least character (marks and handwriting
    // reach 0.810, its printed text 0.990).
    expect(best.wordMean).toBeGreaterThanOrEqual(accurate.wordMean);
    expect(best.lineMean).toBeGreaterThan(accurate.lineMean);
    expect(best.wordMin).toBeGreaterThan(accurate.wordMin);
    // Everything else is the shared tuning.
    expect(best.overlap).toBe(OCR_TUNING.overlap);
    expect(best.sparseChars).toBe(OCR_TUNING.sparseChars);
  });

  it("is listed in THIRD_PARTY_NOTICES", () => {
    const notices = readFileSync("THIRD_PARTY_NOTICES.txt", "utf8");
    expect(notices).toContain("PP-OCRv5");
    expect(notices).toContain("PP-OCRv6");
    expect(notices).toContain("onnxruntime-web");
  });
});

// A fake backend: the "detector" paints bars where the page has lines; the "recogniser" answers
// with the text it was told for the line, one character per two time steps.
function fakeBackend(
  bars: { x: number; y: number; w: number; h: number; text: string }[],
  alphabet: string[],
): OcrBackend & { detections: number; batches: number[] } {
  const backend = {
    detections: 0,
    batches: [] as number[],
    detect(_tensor: Float32Array, width: number, height: number) {
      backend.detections++;
      const prob = new Float32Array(width * height);
      for (const b of bars) {
        for (let y = b.y; y < Math.min(height, b.y + b.h); y++)
          for (let x = b.x; x < Math.min(width, b.x + b.w); x++) prob[y * width + x] = 0.9;
      }
      return Promise.resolve(prob);
    },
    recognize(_data: Float32Array, n: number, width: number) {
      backend.batches.push(n);
      const steps = width / REC_STRIDE;
      const classes = alphabet.length;
      const probs = new Float32Array(n * steps * classes);
      // Lines come in batch order; find which bar each is by its width.
      const order = [...bars].sort((a, b) => a.w - b.w);
      for (let i = 0; i < n; i++) {
        const text = order[bars.length - n + i]?.text ?? "";
        for (let t = 0; t < steps; t++) probs[(i * steps + t) * classes] = 0.99;
        [...text].forEach((ch, k) => {
          const t = 1 + 2 * k;
          const row = (i * steps + t) * classes;
          probs[row] = 0.01;
          probs[row + alphabet.indexOf(ch)] = 0.95;
        });
      }
      return Promise.resolve({ probs, steps, classes });
    },
  };
  return backend;
}

describe("reading a page image", () => {
  const alphabet = ["", ..."abcdefghijklmnopqrstuvwxyz".split(""), " "];
  const image = { data: new Uint8ClampedArray(600 * 400 * 4).fill(255), width: 600, height: 400 };

  it("finds lines, orders them, reads them and returns words in the page's points", async () => {
    const bars = [
      { x: 40, y: 200, w: 300, h: 10, text: "tail line" },
      { x: 40, y: 60, w: 400, h: 10, text: "head of page" },
    ];
    const backend = fakeBackend(bars, alphabet);
    const steps: string[] = [];
    const page = await readPage(image, backend, {
      scale: 2,
      pageWidth: 300,
      pageHeight: 200,
      alphabet,
      onStep: (s) => steps.push(s),
    });
    expect(backend.detections).toBe(1);
    expect(steps).toEqual(["detect", "boxes", "recognise"]);
    expect(page.lines.map((l) => l.words.map((w) => w.text))).toEqual([
      ["head", "of", "page"],
      ["tail", "line"],
    ]);
    expect(page.imageWidth).toBe(600);
    expect(page.pageHeight).toBe(200);
    // The words sit inside their line's box, in points (pixels / 2), left to right.
    const [head, of, pg] = page.lines[0].words;
    expect(head.box[0]).toBeGreaterThanOrEqual(20 - 8);
    expect(head.box[2]).toBeLessThanOrEqual(of.box[0]);
    expect(of.box[2]).toBeLessThanOrEqual(pg.box[0]);
    expect(pg.box[2]).toBeLessThanOrEqual(220 + 8);
    expect(head.box[1]).toBeLessThan(35);
    expect(head.box[3]).toBeGreaterThan(30);
    // The confidences come from the network's probabilities.
    expect(head.conf).toBeCloseTo(0.95, 2);
    expect(page.lines[0].conf).toBeCloseTo(0.95, 2);
    expect(keptLines(page)).toHaveLength(2);
  });

  it("puts the words of a region back on the page: its origin is added to every box", async () => {
    const bars = [{ x: 40, y: 60, w: 300, h: 10, text: "label" }];
    const at = async (origin?: { x: number; y: number }) =>
      (
        await readPage(image, fakeBackend(bars, alphabet), {
          scale: 2,
          pageWidth: 612,
          pageHeight: 866,
          origin,
          alphabet,
        })
      ).lines[0].words[0].box;
    const home = await at();
    const shifted = await at({ x: 120.5, y: 300.25 });
    expect(shifted[0]).toBeCloseTo(home[0] + 120.5, 6);
    expect(shifted[2]).toBeCloseTo(home[2] + 120.5, 6);
    expect(shifted[1]).toBeCloseTo(home[1] + 300.25, 6);
    expect(shifted[3]).toBeCloseTo(home[3] + 300.25, 6);
  });

  it("reads a line the first reading was unsure of again, and keeps the better reading", async () => {
    // The recogniser is unsure the first time (a batch of one line each time) and sure the second.
    const bars = [{ x: 40, y: 60, w: 300, h: 10, text: "label" }];
    const inner = fakeBackend(bars, alphabet);
    let calls = 0;
    const backend = {
      ...inner,
      detect: inner.detect,
      async recognize(data: Float32Array, n: number, width: number) {
        calls++;
        const out = await inner.recognize(data, n, width);
        if (calls === 1) {
          // Spread the winner's probability thin: 0.6 each.
          for (let i = 0; i < out.probs.length; i++) if (out.probs[i] > 0.9) out.probs[i] = 0.6;
        }
        return out;
      },
    };
    const opts = { scale: 2, pageWidth: 300, pageHeight: 200, alphabet };
    const unsure = await readPage(image, backend, { ...opts, retry: [] });
    expect(keptLines(unsure)).toHaveLength(0);
    calls = 0;
    const again = await readPage(image, backend, { ...opts, retry: [1.0] });
    expect(calls).toBe(2);
    expect(
      keptLines(again)
        .flat()
        .map((w) => w.text),
    ).toEqual(["label"]);
    // A line that is sure the first time is not read again.
    calls = 5;
    await readPage(image, backend, { ...opts, retry: [1.0, 1.4] });
    expect(calls).toBe(6);
  });

  it("reads a line again by the model's own thresholds: sure for one model, unsure for another", async () => {
    // The recogniser is 0.95 sure of every character.
    const bars = [{ x: 40, y: 60, w: 300, h: 10, text: "label" }];
    const inner = fakeBackend(bars, alphabet);
    let calls = 0;
    const backend = {
      ...inner,
      detect: inner.detect,
      recognize(data: Float32Array, n: number, width: number) {
        calls++;
        return inner.recognize(data, n, width);
      },
    };
    const opts = { scale: 2, pageWidth: 300, pageHeight: 200, alphabet, retry: [1.0] };
    await readPage(image, backend, {
      ...opts,
      confidence: { wordMean: 0.9, lineMean: 0.9, wordMin: 0.5 },
    });
    expect(calls).toBe(1);
    calls = 0;
    await readPage(image, backend, {
      ...opts,
      confidence: { wordMean: 0.98, lineMean: 0.98, wordMin: 0.5 },
    });
    expect(calls).toBe(2);
  });

  it("keeps where each character starts, in page points, for a word with an enclosed number", async () => {
    const alpha = [...alphabet, "\u2460"];
    const bars = [{ x: 40, y: 60, w: 300, h: 10, text: "\u2460ab cd" }];
    const page = await readPage(image, fakeBackend(bars, alpha), {
      scale: 2,
      pageWidth: 300,
      pageHeight: 200,
      alphabet: alpha,
      retry: [],
    });
    const [glued, plain] = page.lines[0].words;
    expect(glued.text).toBe("\u2460ab");
    expect(glued.cuts).toHaveLength(2);
    const [x0, , x1] = glued.box;
    for (const c of glued.cuts ?? []) {
      expect(c).toBeGreaterThan(x0);
      expect(c).toBeLessThan(x1);
    }
    expect(glued.cuts?.[0]).toBeLessThan(glued.cuts?.[1] ?? 0);
    // A word with nothing to normalise carries no positions.
    expect(plain.text).toBe("cd");
    expect(plain.cuts).toBeUndefined();
  });

  it("rejects a class count the dictionary does not match (a damaged or wrong file)", async () => {
    const backend = fakeBackend([{ x: 40, y: 60, w: 300, h: 10, text: "abc" }], alphabet);
    await expect(
      readPage(image, backend, {
        scale: 1,
        pageWidth: 600,
        pageHeight: 400,
        alphabet: alphabet.slice(1),
      }),
    ).rejects.toThrow(/classes/);
  });

  it("stops between steps when asked", async () => {
    const backend = fakeBackend([{ x: 40, y: 60, w: 300, h: 10, text: "abc" }], alphabet);
    await expect(
      readPage(image, backend, {
        scale: 1,
        pageWidth: 600,
        pageHeight: 400,
        alphabet,
        cancelled: () => true,
      }),
    ).rejects.toBeInstanceOf(OcrCancelled);
    expect(backend.detections).toBe(0);
  });

  it("returns no lines for a page with no text", async () => {
    const page = await readPage(image, fakeBackend([], alphabet), {
      scale: 1,
      pageWidth: 600,
      pageHeight: 400,
      alphabet,
    });
    expect(page.lines).toEqual([]);
  });
});
