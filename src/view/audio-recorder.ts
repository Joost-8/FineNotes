/**
 * One audio recording: the microphone, `MediaRecorder`, and the vault file
 * the chunks go into. research/FEATURES.md §3.5 is the recipe and every step
 * of it is here:
 *
 * 1. `getUserMedia({ audio: true })` only from a user's tap — `start()` calls
 *    it before its first `await`, because iPadOS grants the microphone only
 *    inside a gesture.
 * 2. AAC in MP4 at an explicit 32 kbps (WebKit's default is 192 kbps), with a
 *    fallback chain, since `isTypeSupported` can say yes and `start()` then
 *    throw. Desktop Electron may only offer Opus in WebM; the file is named
 *    for what is really in it.
 * 3. `start(10000)`: a chunk every ten seconds, appended to the file as it
 *    arrives with `Vault.appendBinary` (Obsidian 1.12.3+), so a lecture is
 *    never held in memory and never crosses the mobile bridge as one 20 MB
 *    blob. Older Obsidian keeps the chunks in memory and writes once at the
 *    end — honest about being the weaker path.
 * 4. The length is measured here (`RecordingClock`), because a fragmented
 *    MP4 carries no duration.
 * 5. A screen wake lock is asked for and never relied on: WKWebView may not
 *    have one.
 *
 * The file is written by the path chosen when recording started — never
 * re-derived from the note, which may be renamed mid-recording — and through
 * the `TFile` once it exists, which follows the audio file if *it* is renamed.
 */

import { type App, Platform, type TFile, normalizePath, requireApiVersion } from "obsidian";
import {
  RECORDING_BITRATE,
  RECORDING_TIMESLICE_MS,
  type RecordingClock,
  baseNameOf,
  concatChunks,
  recordedFormat,
  recorderMimeCandidates,
  recordingBaseName,
} from "../audio/recording";
import { availablePath, isHiddenPath, parentFolder } from "../canvas/image-raster";

/**
 * Longest to wait for the recorder's last chunk after `stop()`. The chunk
 * normally follows within milliseconds; the wait only matters if the app was
 * suspended in between, and then whichever comes first on resume wins — with
 * `appendBinary` a late chunk still lands in the file.
 */
const STOP_TIMEOUT_MS = 5000;

/** Longest `start()` waits to hear whether the screen will be kept on, ms. */
const WAKE_LOCK_WAIT_MS = 1500;

/** Why a recording ended without being asked to. */
export type RecorderInterruption = "error" | "track-ended" | "write-failed";

/** A recording that reached the vault. */
export interface SavedRecording {
  /** Vault path of the audio file, as it is now. */
  path: string;
  /** Wall-clock start, ms (the shared clock's). */
  start: number;
  /** Length in ms, measured while recording. */
  duration: number;
  bytes: number;
  mimeType: string;
}

export interface RecorderResult {
  /** The saved recording, or `null` when nothing reached the vault. */
  saved: SavedRecording | null;
  /** What went wrong while saving, Notice-ready; `null` if nothing did. */
  problem: string | null;
}

/** A single-use recorder: `start()` once, `stop()` once (further calls return the same result). */
export class AudioRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private wakeLock: WakeLockSentinel | null = null;
  /** The audio file, once the first chunk created it. */
  private file: TFile | null = null;
  /** Where it goes, chosen at start. */
  private path = "";
  private startedAt = 0;
  private format = { mimeType: "audio/mp4", extension: "m4a" };
  /** Chunks held for the one write at the end, on Obsidian without `appendBinary`. */
  private readonly memory: ArrayBuffer[] = [];
  /** Every write, in order: chunks must reach the file in the order they were recorded. */
  private writes: Promise<void> = Promise.resolve();
  private problem: string | null = null;
  private written = 0;
  private finishing: Promise<RecorderResult> | null = null;

  /** Whether the screen is being kept on (a wake lock was granted). */
  keepsScreenOn = false;
  /** Told when the recording ends by itself: the microphone went away, a write failed. */
  onInterrupted: ((why: RecorderInterruption) => void) | null = null;

  constructor(
    private readonly app: App,
    private readonly clock: RecordingClock,
  ) {}

  /**
   * Ask for the microphone and start recording, placing the file in
   * `folder` when the note chose one, else as an attachment of `notePath`.
   * **Call it synchronously from the user's tap.** Rejects with a
   * Notice-ready reason; nothing is left running then.
   */
  async start(notePath: string, folder?: string): Promise<void> {
    const devices = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    if (
      !devices ||
      typeof devices.getUserMedia !== "function" ||
      typeof MediaRecorder === "undefined"
    ) {
      throw new Error("this device does not let Obsidian record audio");
    }
    let stream: MediaStream;
    try {
      // The first thing, inside the tap.
      stream = await devices.getUserMedia({ audio: true });
    } catch (error) {
      throw new Error(microphoneProblem(error));
    }
    this.stream = stream;
    try {
      const { recorder, requested } = this.createRecorder(stream);
      this.recorder = recorder;
      this.startedAt = this.clock.start();
      this.format = recordedFormat(
        recorder.mimeType,
        requested,
        Platform.isIosApp || Platform.isSafari,
      );
    } catch (error) {
      for (const track of stream.getTracks()) track.stop();
      this.stream = null;
      throw error;
    }
    for (const track of stream.getAudioTracks()) {
      track.addEventListener("ended", () => this.interrupted("track-ended"), { once: true });
    }
    // Chunks queue behind the file name, which needs one round trip to settle.
    this.writes = this.choosePath(notePath, folder).catch((error) => this.fail(error));
    // The recording already runs; a wake-lock request that never answers
    // must not keep the caller waiting for it.
    await Promise.race([
      this.holdScreenOn(),
      new Promise<void>((resolve) => window.setTimeout(resolve, WAKE_LOCK_WAIT_MS)),
    ]);
  }

  /**
   * Stop, wait for the last chunk, and close the file. Safe to call more
   * than once; every call gets the same result.
   */
  stop(): Promise<RecorderResult> {
    this.finishing ??= this.finish();
    return this.finishing;
  }

  /**
   * The best format the recorder will actually start with. Each candidate
   * is constructed *and started* inside a `try`, because iOS can accept a
   * type in `isTypeSupported` and refuse it in `start()`.
   */
  private createRecorder(stream: MediaStream): { recorder: MediaRecorder; requested: string } {
    const candidates = recorderMimeCandidates((type) => MediaRecorder.isTypeSupported(type));
    let lastError: unknown = null;
    for (const mimeType of candidates) {
      let recorder: MediaRecorder | null = null;
      try {
        const options: MediaRecorderOptions = { audioBitsPerSecond: RECORDING_BITRATE };
        if (mimeType) options.mimeType = mimeType;
        recorder = new MediaRecorder(stream, options);
        this.wire(recorder);
        recorder.start(RECORDING_TIMESLICE_MS);
        return { recorder, requested: mimeType };
      } catch (error) {
        lastError = error;
        if (recorder) unwire(recorder);
      }
    }
    throw new Error(`the recorder refused every audio format (${describe(lastError)})`);
  }

  /** Handlers go on before `start()`, so not even the first chunk can be missed. */
  private wire(recorder: MediaRecorder): void {
    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) this.enqueue(event.data);
    };
    recorder.onerror = () => this.interrupted("error");
    // A stop nobody asked for: the browser ended the recording itself.
    recorder.onstop = () => this.interrupted("error");
  }

  private interrupted(why: RecorderInterruption): void {
    if (this.finishing) return;
    this.onInterrupted?.(why);
  }

  /** The audio file's path, chosen now: the note may be renamed before the first chunk. */
  private async choosePath(notePath: string, folder?: string): Promise<void> {
    const base = recordingBaseName(new Date(this.startedAt));
    const { extension } = this.format;
    let path = normalizePath(
      folder
        ? availablePath(folder, base, extension, this.exists)
        : await this.app.fileManager.getAvailablePathForAttachment(
            `${base}.${extension}`,
            notePath,
          ),
    );
    // Obsidian does not index dot-folders, and sync services skip them: an
    // attachment folder like `.attachments/` would hide the recording.
    if (isHiddenPath(path)) {
      path = normalizePath(availablePath(parentFolder(notePath), base, extension, this.exists));
    }
    this.path = path;
  }

  private readonly exists = (path: string): boolean =>
    this.app.vault.getAbstractFileByPath(path) !== null;

  private enqueue(blob: Blob): void {
    this.writes = this.writes.then(async () => {
      if (this.problem) return;
      try {
        await this.write(await blob.arrayBuffer());
      } catch (error) {
        this.fail(error);
      }
    });
  }

  private async write(bytes: ArrayBuffer): Promise<void> {
    if (bytes.byteLength === 0) return;
    if (requireApiVersion("1.12.3")) {
      // Straight to disk, chunk by chunk (FEATURES.md §3.1 trap 3).
      if (this.file) await this.app.vault.appendBinary(this.file, bytes);
      else this.file = await this.create(bytes);
    } else {
      this.memory.push(bytes);
    }
    this.written += bytes.byteLength;
  }

  /** Create the file with its first bytes, in a visible folder. */
  private async create(bytes: ArrayBuffer): Promise<TFile> {
    if (!this.path) throw new Error("no place was found for the recording");
    const folder = parentFolder(this.path);
    if (folder && !this.app.vault.getFolderByPath(folder)) {
      try {
        await this.app.vault.createFolder(folder);
      } catch {
        // Created meanwhile.
      }
    }
    if (this.exists(this.path)) {
      // Taken since it was chosen: the next free name beside it.
      this.path = normalizePath(
        availablePath(folder, baseNameOf(this.path), this.format.extension, this.exists),
      );
    }
    return this.app.vault.createBinary(this.path, bytes);
  }

  private fail(error: unknown): void {
    this.problem ??= describe(error);
    this.interrupted("write-failed");
  }

  private async finish(): Promise<RecorderResult> {
    // The length is what the user heard recorded, up to the moment they
    // stopped — not up to when the last chunk happened to arrive.
    const duration = this.clock.stop();
    const recorder = this.recorder;
    if (recorder) {
      await new Promise<void>((resolve) => {
        if (recorder.state === "inactive") {
          resolve();
          return;
        }
        const timer = window.setTimeout(resolve, STOP_TIMEOUT_MS);
        recorder.onstop = () => {
          window.clearTimeout(timer);
          resolve();
        };
        try {
          // Fires the last `dataavailable`, then `stop`.
          recorder.stop();
        } catch {
          window.clearTimeout(timer);
          resolve();
        }
      });
    }
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    await this.releaseScreen();
    // The last chunk was queued by its `dataavailable`, before `stop` fired.
    await this.writes;
    if (this.memory.length > 0 && !this.problem) {
      try {
        this.file = await this.create(concatChunks(this.memory));
      } catch (error) {
        this.problem ??= describe(error);
      }
      this.memory.length = 0;
    }
    const file = this.file;
    if (!file || this.written === 0) return { saved: null, problem: this.problem };
    // Deleted from the vault while it was being recorded: nothing to point at.
    if (!this.app.vault.getFileByPath(file.path)) {
      return { saved: null, problem: this.problem ?? "the audio file was deleted while recording" };
    }
    return {
      saved: {
        path: file.path,
        start: this.startedAt,
        duration,
        bytes: this.written,
        mimeType: this.format.mimeType,
      },
      problem: this.problem,
    };
  }

  /**
   * Try to keep the screen on while recording: an iPad that locks stops the
   * recording (WKWebView loses the microphone in the background, and a
   * plugin cannot change that). Reported unavailable in WKWebView, so this
   * is a nicety, never relied on — the first-recording notice says what to do
   * when it fails.
   */
  private async holdScreenOn(): Promise<void> {
    const wakeLock = (navigator as Navigator & { wakeLock?: WakeLock }).wakeLock;
    if (!wakeLock || typeof wakeLock.request !== "function") return;
    try {
      const sentinel = await wakeLock.request("screen");
      if (this.finishing) {
        // Stopped while the lock was being granted.
        await sentinel.release();
        return;
      }
      this.wakeLock = sentinel;
      this.keepsScreenOn = true;
    } catch {
      // Refused (no user activation left, low power mode, WKWebView): fine.
    }
  }

  private async releaseScreen(): Promise<void> {
    const lock = this.wakeLock;
    this.wakeLock = null;
    this.keepsScreenOn = false;
    try {
      await lock?.release();
    } catch {
      // Already released by the system (the page was hidden).
    }
  }
}

function unwire(recorder: MediaRecorder): void {
  recorder.ondataavailable = null;
  recorder.onerror = null;
  recorder.onstop = null;
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

/** What to tell the user when `getUserMedia` refuses. */
function microphoneProblem(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return Platform.isIosApp
        ? "Obsidian is not allowed to use the microphone. Allow it in the iPad's Settings → Obsidian → Microphone"
        : "Obsidian is not allowed to use the microphone. Allow it in your system's privacy settings";
    case "NotFoundError":
    case "OverconstrainedError":
      return "no microphone was found";
    case "NotReadableError":
    case "AbortError":
      return "the microphone is busy (another app may be using it)";
    default:
      return `the microphone could not be opened (${describe(error)})`;
  }
}
