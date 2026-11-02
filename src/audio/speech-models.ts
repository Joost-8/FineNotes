/**
 * The speech models "Transcribe on this device" can download, and the rules
 * for which to offer where and when to warn.
 *
 * Each model is OpenAI's Whisper (MIT) in whisper.cpp's ggml format,
 * quantised to 8 bits (q8_0: 20-30 % faster than q5_1 in WebAssembly, no
 * less accurate; large-v3-turbo to 5 bits, see its entry), plus FineNotes'
 * own build of the whisper.cpp runtime
 * (scripts/whisper-runtime): one single-threaded WebAssembly module, since
 * neither Obsidian on the iPad nor a worker started from a Blob can have
 * SharedArrayBuffer there. Speeds are measured on a laptop in
 * research/audio-ondevice-2026-10-19.md; the iPad's are estimates.
 *
 * PURE: no DOM, no Obsidian.
 */

import type { ModelAsset, ModelFile } from "../downloads/model-manifest";

export type SpeechModelId = "whisper-tiny" | "whisper-base" | "whisper-small" | "whisper-turbo";

/**
 * Where the files are published: the `speech-1` release of the templates
 * repository. 2.4.x reads the same files from Joost-8/FineNotes-models,
 * which stays up until those installs have updated.
 */
const RELEASE = "https://github.com/Joost-8/FineNotes-templates/releases/download/speech-1";

/** FineNotes' whisper.cpp runtime: scripts/whisper-runtime/build.sh, whisper.cpp 0c7be69, emsdk 4.0.15. */
export const SPEECH_RUNTIME: ModelFile = {
  name: "fn-whisper-1.js",
  url: `${RELEASE}/fn-whisper-1.js`,
  bytes: 1_659_483,
  sha256: "1a230b53356a8036d1804064cd75213d21677d795df30e33594657b68146879b",
};

interface SpeechModelInfo {
  id: SpeechModelId;
  label: string;
  /** The ggml file. */
  file: ModelFile;
  /** Measured on the laptop: seconds of audio per second of work, one thread, flash attention. */
  laptopSpeed: number;
  /** Offered on a phone or tablet. */
  mobile: boolean;
  /** The longest recording it takes, ms, when that is less than the device's limit: past it a job runs for hours. */
  maxMs?: number;
  /**
   * Kept on this computer, outside the vault, so no sync carries it to an
   * iPad that cannot run it (or replaces it mid-download). Small stays in
   * the vault, where earlier versions put it.
   */
  deviceOnly?: true;
}

export const SPEECH_MODELS: readonly SpeechModelInfo[] = [
  {
    id: "whisper-tiny",
    label: "Whisper tiny",
    file: {
      name: "ggml-tiny-q8_0.bin",
      url: `${RELEASE}/ggml-tiny-q8_0.bin`,
      bytes: 43_537_433,
      sha256: "c2085835d3f50733e2ff6e4b41ae8a2b8d8110461e18821b09a15c40c42d1cca",
    },
    laptopSpeed: 4.5,
    mobile: true,
  },
  {
    id: "whisper-base",
    label: "Whisper base",
    file: {
      name: "ggml-base-q8_0.bin",
      url: `${RELEASE}/ggml-base-q8_0.bin`,
      bytes: 81_768_585,
      sha256: "c577b9a86e7e048a0b7eada054f4dd79a56bbfa911fbdacf900ac5b567cbb7d9",
    },
    laptopSpeed: 2.1,
    mobile: true,
  },
  {
    id: "whisper-small",
    label: "Whisper small",
    file: {
      name: "ggml-small-q8_0.bin",
      url: `${RELEASE}/ggml-small-q8_0.bin`,
      bytes: 264_464_607,
      sha256: "49c8fb02b65e6049d5fa6c04f81f53b867b5ec9540406812c643f177317f779f",
    },
    laptopSpeed: 0.68,
    mobile: false,
  },
  {
    // Discussion #107. q5_0, not q8_0: q8_0's 874 MB, held twice while it
    // loads, runs out of the runtime's 2 GB heap (ggml's mem_buffer assert).
    // q5_0 on the test clip: 1.69 GB of heap, 3.6 % word error (base 9.5 %),
    // 0.14x real time with the laptop busy (base 1.72x then, 2.1x quiet).
    // Not offered on an iPad: that heap, and hours of work, are too much.
    id: "whisper-turbo",
    label: "Whisper large-v3-turbo",
    file: {
      name: "ggml-large-v3-turbo-q5_0.bin",
      url: `${RELEASE}/ggml-large-v3-turbo-q5_0.bin`,
      bytes: 574_041_195,
      sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
    },
    laptopSpeed: 0.15,
    mobile: false,
    // About 2¼ hours of work.
    maxMs: 20 * 60_000,
    // 574 MB would otherwise sync to every device with the vault.
    deviceOnly: true,
  },
];

export const DEFAULT_SPEECH_MODEL: SpeechModelId = "whisper-base";

export function speechModelInfo(id: SpeechModelId): SpeechModelInfo {
  return SPEECH_MODELS.find((m) => m.id === id) ?? SPEECH_MODELS[1];
}

/** Under this many seconds of audio per second of work, the size menu calls a model very slow. */
export const VERY_SLOW_SPEED = 0.5;

/**
 * A model as the size menu lists it: its name, its download size, "desktop
 * only" when an iPad is not offered it, and "very slow" when it is.
 */
export function speechChoiceLabel(id: SpeechModelId, size: string): string {
  const info = speechModelInfo(id);
  const notes = [size];
  if (!info.mobile) notes.push("desktop only");
  if (info.laptopSpeed < VERY_SLOW_SPEED) notes.push("very slow");
  return `${info.label} (${notes.join(", ")})`;
}

/** The models offered on this kind of device. */
export function speechModelsFor(mobile: boolean): SpeechModelInfo[] {
  return SPEECH_MODELS.filter((m) => !mobile || m.mobile);
}

/** The model to use: the chosen one if it is offered here, else the default. */
export function effectiveSpeechModel(chosen: string | undefined, mobile: boolean): SpeechModelId {
  const offered = speechModelsFor(mobile);
  return offered.find((m) => m.id === chosen)?.id ?? DEFAULT_SPEECH_MODEL;
}

/** The downloadable model: the ggml file first (the main file), then the runtime. */
export function speechAsset(id: SpeechModelId): ModelAsset {
  const info = speechModelInfo(id);
  return {
    id,
    label: `${info.label} (speech recognizer model)`,
    purpose: "Transcribes recordings on this device, with no key and no server.",
    version: "1",
    format: 1,
    folder: `speech-${id.slice("whisper-".length)}`,
    files: [info.file, SPEECH_RUNTIME],
    // Tens of MB: fewer, larger requests than the default 512 KB.
    chunkBytes: 4 * 1024 * 1024,
    ...(info.deviceOnly ? { deviceOnly: true } : {}),
  };
}

/** A phone or tablet is assumed this much slower than the laptop the speeds were measured on (unproven). */
export const MOBILE_SLOWDOWN = 1.5;

/** Estimated minutes to transcribe `durationMs` of audio, rounded up, at least 1. */
export function estimateMinutes(durationMs: number, id: SpeechModelId, mobile: boolean): number {
  const speed = speechModelInfo(id).laptopSpeed / (mobile ? MOBILE_SLOWDOWN : 1);
  const minutes = durationMs / 60000 / speed;
  return Math.max(1, Math.ceil(minutes));
}

/** Longer than this on a phone or tablet asks first: it takes long and uses battery. */
export const MOBILE_WARN_MS = 15 * 60_000;
/** Anywhere, a job estimated to take this long asks first. */
export const WARN_MINUTES = 20;
/**
 * The longest recording transcribed on the device. The whole recording is
 * decoded to 16 kHz samples first (4 bytes each: 115 MB for 30 minutes),
 * which a 4 GB iPad must hold beside Obsidian and the model.
 */
export const MOBILE_MAX_MS = 30 * 60_000;
export const DESKTOP_MAX_MS = 3 * 60 * 60_000;

export type LengthVerdict =
  | { kind: "ok" }
  | { kind: "warn"; minutes: number }
  /** `byModel`: the model's own limit, which a smaller model does not have. */
  | { kind: "too-long"; limitMinutes: number; byModel?: true };

/** Whether a recording of `durationMs` can be transcribed here, and whether to warn first. */
export function lengthVerdict(
  durationMs: number,
  id: SpeechModelId,
  mobile: boolean,
): LengthVerdict {
  const device = mobile ? MOBILE_MAX_MS : DESKTOP_MAX_MS;
  const model = speechModelInfo(id).maxMs ?? Infinity;
  const limit = Math.min(device, model);
  if (durationMs > limit) {
    const limitMinutes = Math.round(limit / 60000);
    return model < device
      ? { kind: "too-long", limitMinutes, byModel: true }
      : { kind: "too-long", limitMinutes };
  }
  const minutes = estimateMinutes(durationMs, id, mobile);
  if ((mobile && durationMs > MOBILE_WARN_MS) || minutes >= WARN_MINUTES)
    return { kind: "warn", minutes };
  return { kind: "ok" };
}

/** Languages offered for the recognizer, with "auto" first: ISO 639-1 codes Whisper knows. */
export const SPEECH_LANGUAGES: readonly { code: string; name: string }[] = [
  { code: "auto", name: "Detect" },
  { code: "en", name: "English" },
  { code: "nl", name: "Dutch" },
  { code: "de", name: "German" },
  { code: "fr", name: "French" },
  { code: "es", name: "Spanish" },
  { code: "it", name: "Italian" },
  { code: "pt", name: "Portuguese" },
  { code: "pl", name: "Polish" },
  { code: "sv", name: "Swedish" },
  { code: "tr", name: "Turkish" },
  { code: "ru", name: "Russian" },
  { code: "uk", name: "Ukrainian" },
  { code: "zh", name: "Chinese" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "ar", name: "Arabic" },
  { code: "hi", name: "Hindi" },
];

/** The code to hand the recognizer: a known one, else "auto". */
export function speechLanguage(code: string | undefined): string {
  return SPEECH_LANGUAGES.some((l) => l.code === code) ? (code as string) : "auto";
}
