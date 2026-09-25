/**
 * Audio recorded against a note (0.5): every decision that does not need a
 * microphone, a vault or a DOM — which format to ask the recorder for, what
 * the file is called, the clock strokes and recordings share, how a stroke
 * maps to a moment in a recording, what a vendor will accept, and what the
 * transcript note says. The view (`src/view/audio-recorder.ts`,
 * `src/view/note-audio.ts`) only carries these decisions out.
 *
 * The recipe is research/FEATURES.md §3.5, and its traps are why several of
 * these exist: WebKit records at 192 kbps unless told otherwise, a fragmented
 * MP4 from `MediaRecorder` carries no duration, and `isTypeSupported` can say
 * yes to a type `start()` then refuses.
 *
 * Pure: no DOM, no Obsidian.
 */

import type { Page, Recording, Stroke } from "../model/document";
import { GOOGLE_INLINE_MAX_BYTES, OPENAI_AUDIO_MAX_BYTES } from "../recognition/audio-request";
import type { LlmVendor } from "../recognition/llm-request";

/**
 * Bits per second, always passed explicitly: WebKit's default is 192 kbps,
 * which makes a 90-minute lecture 130 MB. At 32 kbps mono it is 21.6 MB —
 * under OpenAI's 25 MB upload cap (FEATURES.md §3.2).
 */
export const RECORDING_BITRATE = 32000;

/**
 * `MediaRecorder.start(timeslice)`: a chunk every 10 s, each written to the
 * vault as it arrives. Nothing long is ever held in memory, a crash loses at
 * most one chunk, and the iOS 26 "recording stops at 30 seconds" bug is
 * reported against the single-blob-at-stop pattern this avoids.
 */
export const RECORDING_TIMESLICE_MS = 10000;

/**
 * How far before a stroke's pen-down a tap on it starts playback. People
 * write *after* they hear, so seeking to the pen-down lands after the thing
 * they wrote about. 5 s is FEATURES.md's unverified default, to be
 * calibrated against a real lecture.
 */
export const SEEK_LEAD_MS = 5000;

/**
 * What to ask the recorder for, best first. AAC in MP4 (`.m4a`) above all:
 * it is what the iPad records natively, `.m4a` is on Obsidian Sync's
 * default-on audio list, and WebM audio is a known non-player in Obsidian iOS.
 * Opus in WebM is desktop Electron's fallback.
 */
export const RECORDER_MIME_TYPES: readonly string[] = [
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
];

/**
 * The formats to try, in order: every preferred type the recorder claims to
 * support, then `""` — the browser's own default. The caller tries each in a
 * `try`, because `isTypeSupported` lies on iOS (it can say yes and then throw
 * on `start()`); a probe that throws counts as "no".
 */
export function recorderMimeCandidates(isSupported: (mimeType: string) => boolean): string[] {
  const supported = RECORDER_MIME_TYPES.filter((mimeType) => {
    try {
      return isSupported(mimeType);
    } catch {
      return false;
    }
  });
  return [...supported, ""];
}

const EXTENSIONS: Readonly<Record<string, string>> = {
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "m4a",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
};

/** The file extension for an audio MIME type (parameters ignored), or `null` if unknown. */
export function audioExtensionForMime(mimeType: string): string | null {
  const base = mimeType.split(";")[0].trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(EXTENSIONS, base) ? EXTENSIONS[base] : null;
}

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  aac: "audio/aac",
  webm: "audio/webm",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  flac: "audio/flac",
};

/** The MIME type to send an audio file as, from its extension; `null` if it is not audio. */
export function audioMimeForExtension(extension: string): string | null {
  const ext = extension.replace(/^\./, "").toLowerCase();
  return Object.prototype.hasOwnProperty.call(MIME_BY_EXTENSION, ext)
    ? MIME_BY_EXTENSION[ext]
    : null;
}

/**
 * What a recording actually is: the type the recorder reports once started,
 * else the type that was asked for, else — a recorder that reports nothing
 * and was asked for nothing — each platform's default (MP4 on Apple's
 * WebKit, WebM in Chromium). The extension always matches the MIME type, so
 * the file is named for what is inside it.
 */
export function recordedFormat(
  reported: string,
  requested: string,
  apple: boolean,
): { mimeType: string; extension: string } {
  for (const candidate of [reported, requested]) {
    const extension = audioExtensionForMime(candidate);
    if (extension) return { mimeType: candidate.split(";")[0].trim().toLowerCase(), extension };
  }
  return apple
    ? { mimeType: "audio/mp4", extension: "m4a" }
    : { mimeType: "audio/webm", extension: "webm" };
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/**
 * The audio file's name, without extension, in local time:
 * `Recording 2026-09-22 14-05`. No colon: iOS and Windows refuse it in a
 * file name. Two recordings in one minute are told apart by the vault
 * (` 1`, ` 2` …), not here.
 */
export function recordingBaseName(date: Date): string {
  return (
    `Recording ${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ` +
    `${pad2(date.getHours())}-${pad2(date.getMinutes())}`
  );
}

/** `03:12`, or `1:02:03` from an hour on. Anything not a positive number reads `00:00`. */
export function formatClock(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0
    ? `${hours}:${pad2(minutes)}:${pad2(seconds)}`
    : `${pad2(minutes)}:${pad2(seconds)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `22 Sep 2026, 14:05`, in local time. English, like the rest of the interface. */
export function formatRecordingDate(ms: number): string {
  const date = new Date(ms);
  return (
    `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}, ` +
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  );
}

/** One line for a recordings list: `22 Sep 2026, 14:05 · 03:12`. */
export function describeRecording(recording: Pick<Recording, "start" | "duration">): string {
  return `${formatRecordingDate(recording.start)} · ${formatClock(recording.duration)}`;
}

/** The next free `r<N>` recording id; seeded from the maximum, as stroke ids are. */
export function nextRecordingId(recordings: readonly Pick<Recording, "id">[] | undefined): string {
  let max = 0;
  for (const recording of recordings ?? []) {
    const match = /^r(\d+)$/.exec(recording.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `r${max + 1}`;
}

/**
 * The one clock strokes and recordings are stamped with, in wall-clock ms.
 *
 * Normally it *is* the wall clock. While a recording runs it is pinned: time
 * then advances on the monotonic clock from the moment recording started, so
 * a wall-clock jump mid-lecture (an NTP correction, a time-zone change) can
 * move neither the ink nor the audio against each other — FEATURES.md §3.3's
 * clock discipline. `elapsed()` is the recording's own length, which is the
 * duration a fragmented MP4 does not carry.
 */
export class RecordingClock {
  private anchor: { wall: number; mono: number } | null = null;

  constructor(
    private readonly wall: () => number,
    private readonly mono: () => number,
  ) {}

  /** Whether a recording is being timed. */
  get running(): boolean {
    return this.anchor !== null;
  }

  /** Start timing a recording; returns its wall-clock start. */
  start(): number {
    const wall = Math.round(this.wall());
    this.anchor = { wall, mono: this.mono() };
    return wall;
  }

  /** Stop timing; returns the recording's length in ms. The clock follows the wall again. */
  stop(): number {
    const elapsed = this.elapsed();
    this.anchor = null;
    return elapsed;
  }

  /** ms since `start()`; 0 when nothing is being timed. */
  elapsed(): number {
    const anchor = this.anchor;
    return anchor ? Math.max(0, Math.round(this.mono() - anchor.mono)) : 0;
  }

  /** Now, in wall-clock ms. */
  now(): number {
    const anchor = this.anchor;
    return anchor ? anchor.wall + this.elapsed() : this.wall();
  }
}

/**
 * When a stroke began, in wall-clock ms — `page.epoch + stroke.t0` — or
 * `null` when either is missing: a stroke written before 0.5 has no time,
 * and "unknown" must not be read as "at the start of the page".
 */
export function strokeTime(page: Pick<Page, "epoch">, stroke: Pick<Stroke, "t0">): number | null {
  const { epoch } = page;
  const { t0 } = stroke;
  if (typeof epoch !== "number" || !Number.isFinite(epoch) || epoch <= 0) return null;
  if (typeof t0 !== "number" || !Number.isFinite(t0) || t0 < 0) return null;
  return epoch + t0;
}

/** A moment inside a recording: which one, and how far into it. */
export interface RecordingHit {
  recording: Recording;
  offsetMs: number;
}

/**
 * The recording that was running at wall-clock time `at`, and how far into
 * it `at` falls. A stroke written before a recording started or after it
 * stopped belongs to none. Should two recordings ever overlap, `preferId`
 * (the one in the player) wins.
 */
export function findRecordingAt(
  recordings: readonly Recording[] | undefined,
  at: number,
  preferId?: string,
): RecordingHit | null {
  if (!Number.isFinite(at)) return null;
  let found: RecordingHit | null = null;
  for (const recording of recordings ?? []) {
    const offsetMs = at - recording.start;
    if (offsetMs < 0 || offsetMs > recording.duration) continue;
    if (recording.id === preferId) return { recording, offsetMs };
    found ??= { recording, offsetMs };
  }
  return found;
}

/**
 * Where playback starts for a stroke `offsetMs` into a recording: `leadMs`
 * earlier, and never outside the recording.
 */
export function seekTargetMs(offsetMs: number, durationMs: number, leadMs = SEEK_LEAD_MS): number {
  const end = Math.max(0, durationMs);
  return Math.min(end, Math.max(0, offsetMs - leadMs));
}

/**
 * The most a vendor will take in one transcription upload, in bytes, or
 * `null` when there is no published limit (a self-hosted endpoint).
 * Gemini's 20 MB is for the whole JSON request and the audio travels as
 * base64, so about three quarters of it is audio; 14 MB leaves room for the
 * prompt and the envelope.
 */
export function audioUploadLimit(vendor: LlmVendor): number | null {
  switch (vendor) {
    case "openai":
      return OPENAI_AUDIO_MAX_BYTES;
    case "google":
      return Math.min(14 * 1024 * 1024, Math.floor((GOOGLE_INLINE_MAX_BYTES * 3) / 4));
    default:
      return null;
  }
}

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Why a recording of `bytes` cannot be sent to `vendor`, or `null` when it
 * can. Checked against the file's size before it is read or anything is
 * sent, so a lecture that is too big is refused at once rather than after an
 * upload that was always going to fail.
 */
export function uploadSizeProblem(vendor: LlmVendor, bytes: number): string | null {
  const limit = audioUploadLimit(vendor);
  if (limit === null || bytes <= limit) return null;
  if (vendor === "google") {
    return (
      `This recording is ${megabytes(bytes)}, and Gemini takes at most about ` +
      `${megabytes(limit)} in one request. Use an OpenAI key (up to 25 MB), or record ` +
      "shorter parts."
    );
  }
  return (
    `This recording is ${megabytes(bytes)}, and OpenAI takes at most ${megabytes(limit)}. ` +
    "Record shorter parts."
  );
}

/** Split a vault path into its folder (`""` at the root) and its file name. */
function splitPath(path: string): { folder: string; name: string } {
  const slash = path.lastIndexOf("/");
  return slash < 0
    ? { folder: "", name: path }
    : { folder: path.slice(0, slash), name: path.slice(slash + 1) };
}

/** A file name without its last extension: `Recording 2026-09-22 14-05`. */
export function baseNameOf(path: string): string {
  const { name } = splitPath(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/** Where a recording's transcript goes: beside the audio, `<audio name> transcript.md`. */
export function transcriptPathFor(audioPath: string): string {
  const { folder } = splitPath(audioPath);
  const name = `${baseNameOf(audioPath)} transcript.md`;
  return folder ? `${folder}/${name}` : name;
}

export interface TranscriptNoteInput {
  /** The recording's name, e.g. `Recording 2026-09-22 14-05`. */
  title: string;
  /** Wall-clock start and length of the recording, ms. */
  start: number;
  duration: number;
  /** A link to the notebook, as the vault's link settings write it. */
  notebookLink: string;
  /** An embed of the audio file (`![[…]]` or `![](…)`), so it plays in the note. */
  audioEmbed: string;
  text: string;
}

/**
 * The transcript note: a heading, where and when it was recorded with a link
 * back to the notebook, the audio itself, then the text. A note of its own,
 * so nothing is ever written into the notebook's markdown.
 */
export function buildTranscriptNote(input: TranscriptNoteInput): string {
  return (
    `# ${input.title} — transcript\n\n` +
    `Recorded ${formatRecordingDate(input.start)} (${formatClock(input.duration)}) with ` +
    `${input.notebookLink}.\n\n` +
    `${input.audioEmbed}\n\n` +
    `${input.text.trim()}\n`
  );
}

/** One buffer of every chunk, in order: the fallback writes a recording in one go. */
export function concatChunks(chunks: readonly ArrayBuffer[]): ArrayBuffer {
  let length = 0;
  for (const chunk of chunks) length += chunk.byteLength;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}
