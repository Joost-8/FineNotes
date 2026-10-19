import { describe, expect, it } from "vitest";
import {
  DEFAULT_SPEECH_MODEL,
  MOBILE_MAX_MS,
  SPEECH_MODELS,
  SPEECH_RUNTIME,
  effectiveSpeechModel,
  estimateMinutes,
  lengthVerdict,
  speechAsset,
  speechLanguage,
  speechModelsFor,
} from "../../src/audio/speech-models";
import { totalBytes } from "../../src/downloads/model-manifest";

const MIN = 60_000;

describe("speech models", () => {
  it("pins every file by size and SHA-256", () => {
    for (const m of SPEECH_MODELS) {
      expect(m.file.bytes, m.id).toBeGreaterThan(1_000_000);
      expect(m.file.sha256, m.id).toMatch(/^[0-9a-f]{64}$/);
      expect(m.file.url.startsWith("https://github.com/")).toBe(true);
    }
    expect(SPEECH_RUNTIME.bytes).toBeGreaterThan(100_000);
    expect(SPEECH_RUNTIME.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never offers small on a phone or tablet", () => {
    expect(speechModelsFor(true).map((m) => m.id)).toEqual(["whisper-tiny", "whisper-base"]);
    expect(speechModelsFor(false).map((m) => m.id)).toContain("whisper-small");
    expect(effectiveSpeechModel("whisper-small", true)).toBe(DEFAULT_SPEECH_MODEL);
    expect(effectiveSpeechModel("whisper-small", false)).toBe("whisper-small");
    expect(effectiveSpeechModel("nonsense", false)).toBe(DEFAULT_SPEECH_MODEL);
    expect(effectiveSpeechModel(undefined, true)).toBe(DEFAULT_SPEECH_MODEL);
  });

  it("builds an asset with the model first and the runtime beside it, one folder per model", () => {
    const asset = speechAsset("whisper-base");
    expect(asset.files[0].name).toBe("ggml-base-q8_0.bin");
    expect(asset.files[1]).toBe(SPEECH_RUNTIME);
    expect(asset.folder).toBe("speech-base");
    expect(speechAsset("whisper-tiny").folder).toBe("speech-tiny");
    expect(totalBytes(asset)).toBe(asset.files[0].bytes + SPEECH_RUNTIME.bytes);
  });
});

describe("length rules", () => {
  it("estimates from the measured speed, slower on mobile", () => {
    expect(estimateMinutes(0, "whisper-tiny", false)).toBe(1);
    const desk = estimateMinutes(30 * MIN, "whisper-base", false);
    const pad = estimateMinutes(30 * MIN, "whisper-base", true);
    expect(pad).toBeGreaterThan(desk);
  });

  it("warns past 15 minutes on mobile, refuses past the cap, and lets a voice memo through", () => {
    expect(lengthVerdict(2 * MIN, "whisper-base", true)).toEqual({ kind: "ok" });
    expect(lengthVerdict(16 * MIN, "whisper-tiny", true).kind).toBe("warn");
    expect(lengthVerdict(MOBILE_MAX_MS + 1, "whisper-tiny", true)).toEqual({
      kind: "too-long",
      limitMinutes: 30,
    });
    expect(lengthVerdict(16 * MIN, "whisper-tiny", false)).toEqual({ kind: "ok" });
    expect(lengthVerdict(90 * MIN, "whisper-base", false).kind).toBe("warn");
    expect(lengthVerdict(4 * 60 * MIN, "whisper-base", false).kind).toBe("too-long");
  });
});

describe("speechLanguage", () => {
  it("passes known codes and falls back to detect", () => {
    expect(speechLanguage("nl")).toBe("nl");
    expect(speechLanguage("xx")).toBe("auto");
    expect(speechLanguage(undefined)).toBe("auto");
  });
});
