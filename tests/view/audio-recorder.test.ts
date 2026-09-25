/**
 * `src/view/audio-recorder.ts` against fakes of the microphone, `MediaRecorder`
 * and the vault: the format fallback chain, the explicit bitrate, chunks
 * reaching the file in order as they arrive (and the last one after stop),
 * the in-memory fallback for Obsidian before 1.12.3, where the file goes, and
 * every way a recording can end badly. Nothing here has touched a real
 * microphone; the on-device checks are listed in the 0.5 report.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";

const env = vi.hoisted(() => ({ appendBinary: true }));

vi.mock("obsidian", () => ({
  Platform: { isIosApp: false, isSafari: false },
  normalizePath: (path: string) => path.replace(/\/+/g, "/").replace(/^\/+|\/+$/g, ""),
  requireApiVersion: () => env.appendBinary,
}));

const { AudioRecorder } = await import("../../src/view/audio-recorder");
const { RecordingClock, recordingBaseName } = await import("../../src/audio/recording");

// --- Fakes ------------------------------------------------------------------------

class FakeRecorder {
  static supported: (type: string) => boolean = () => true;
  /** Types whose `start()` throws although `isTypeSupported` said yes (iOS does this). */
  static refuse = new Set<string>();
  static instances: FakeRecorder[] = [];
  static isTypeSupported(type: string): boolean {
    return FakeRecorder.supported(type);
  }

  state: "inactive" | "recording" = "inactive";
  mimeType = "";
  timeslice = 0;
  stopCalls = 0;
  /** What the recorder flushes on `stop()`; `null` = it never answers. */
  finalChunk: number[] | null = [9];
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onerror: (() => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(
    readonly stream: unknown,
    readonly options: MediaRecorderOptions,
  ) {
    FakeRecorder.instances.push(this);
  }

  start(timeslice: number): void {
    const type = this.options.mimeType ?? "";
    if (FakeRecorder.refuse.has(type)) throw new Error("NotSupportedError");
    this.timeslice = timeslice;
    this.state = "recording";
    // Like Safari and Chromium: the real type is known once started.
    this.mimeType = type || "audio/mp4";
  }

  emit(bytes: number[]): void {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)]) });
  }

  stop(): void {
    this.stopCalls++;
    this.state = "inactive";
    const final = this.finalChunk;
    if (final === null) return;
    setTimeout(() => {
      if (final.length > 0) this.emit(final);
      this.onstop?.();
    }, 0);
  }
}

function fakeStream() {
  const listeners = new Map<string, () => void>();
  const track = {
    stopped: false,
    stop() {
      this.stopped = true;
    },
    addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
  };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  return { stream, track, listeners };
}

function fakeVault(attachments = "Notes/attachments") {
  const files = new Map<string, Uint8Array>();
  const folders = new Set<string>(["Notes"]);
  const vault = {
    getAbstractFileByPath: (path: string) =>
      files.has(path) || folders.has(path) ? { path } : null,
    getFolderByPath: (path: string) => (folders.has(path) ? { path } : null),
    getFileByPath: (path: string) => (files.has(path) ? { path } : null),
    createFolder: vi.fn(async (path: string) => {
      folders.add(path);
    }),
    createBinary: vi.fn(async (path: string, data: ArrayBuffer) => {
      if (files.has(path)) throw new Error("File already exists.");
      files.set(path, new Uint8Array(data));
      return { path };
    }),
    appendBinary: vi.fn(async (file: { path: string }, data: ArrayBuffer) => {
      const old = files.get(file.path);
      if (!old) throw new Error("File does not exist.");
      const next = new Uint8Array(old.length + data.byteLength);
      next.set(old);
      next.set(new Uint8Array(data), old.length);
      files.set(file.path, next);
    }),
  };
  const fileManager = {
    getAvailablePathForAttachment: vi.fn(async (name: string) => `${attachments}/${name}`),
  };
  return { app: { vault, fileManager } as unknown as App, vault, fileManager, files, folders };
}

const START = new Date(2026, 8, 22, 14, 5, 12).getTime();

function setup(
  options: { attachments?: string; getUserMedia?: () => Promise<unknown>; wakeLock?: unknown } = {},
) {
  const media = fakeStream();
  const vault = fakeVault(options.attachments);
  const time = { wall: START, mono: 1000 };
  const clock = new RecordingClock(
    () => time.wall,
    () => time.mono,
  );
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: vi.fn(options.getUserMedia ?? (async () => media.stream)) },
    ...(options.wakeLock ? { wakeLock: options.wakeLock } : {}),
  });
  const recorder = new AudioRecorder(vault.app, clock);
  const last = (): FakeRecorder => FakeRecorder.instances[FakeRecorder.instances.length - 1];
  return { ...media, ...vault, time, clock, recorder, last };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const bytesOf = (files: Map<string, Uint8Array>, path: string): number[] => [
  ...(files.get(path) ?? []),
];

beforeEach(() => {
  env.appendBinary = true;
  FakeRecorder.supported = () => true;
  FakeRecorder.refuse = new Set();
  FakeRecorder.instances = [];
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("window", {
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const expectedPath = (ext: string, folder = "Notes/attachments"): string =>
  `${folder}/${recordingBaseName(new Date(START))}.${ext}`;

// --- Tests --------------------------------------------------------------------------

describe("starting", () => {
  it("asks for AAC in MP4 at 32 kbps, in 10-second chunks", async () => {
    const { recorder, last, clock } = setup();
    await recorder.start("Notes/Lecture.ink.md");
    expect(last().options).toEqual({
      audioBitsPerSecond: 32000,
      mimeType: "audio/mp4;codecs=mp4a.40.2",
    });
    expect(last().timeslice).toBe(10000);
    expect(clock.running).toBe(true);
  });

  it("moves on to the next format when start() refuses one isTypeSupported accepted", async () => {
    FakeRecorder.refuse = new Set(["audio/mp4;codecs=mp4a.40.2"]);
    const { recorder, last } = setup();
    await recorder.start("Notes/Lecture.ink.md");
    expect(FakeRecorder.instances).toHaveLength(2);
    expect(last().options.mimeType).toBe("audio/mp4");
    // The refused one was unhooked: a stray event from it changes nothing.
    expect(FakeRecorder.instances[0].ondataavailable).toBeNull();
  });

  it("records Opus in WebM, named .webm, where MP4 is not offered (desktop Chromium)", async () => {
    FakeRecorder.supported = (type) => type.startsWith("audio/webm");
    const { recorder, last, files } = setup();
    await recorder.start("Notes/Lecture.ink.md");
    expect(last().options.mimeType).toBe("audio/webm;codecs=opus");
    last().emit([1]);
    const result = await recorder.stop();
    expect(result.saved?.path).toBe(expectedPath("webm"));
    expect(result.saved?.mimeType).toBe("audio/webm");
    expect(bytesOf(files, expectedPath("webm"))).toEqual([1, 9]);
  });

  it("falls back to the browser's default format, still at 32 kbps", async () => {
    FakeRecorder.supported = () => false;
    const { recorder, last } = setup();
    await recorder.start("Notes/Lecture.ink.md");
    expect(last().options).toEqual({ audioBitsPerSecond: 32000 });
  });

  it("gives up cleanly when every format is refused", async () => {
    FakeRecorder.refuse = new Set(["", "audio/mp4;codecs=mp4a.40.2", "audio/mp4"]);
    FakeRecorder.supported = (type) => type.startsWith("audio/mp4");
    const { recorder, track, clock } = setup();
    await expect(recorder.start("Notes/Lecture.ink.md")).rejects.toThrow(
      /refused every audio format/,
    );
    expect(track.stopped).toBe(true);
    expect(clock.running).toBe(false);
  });

  it("says what to do when the microphone is refused, and when there is none", async () => {
    const refused = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    const denied = setup({ getUserMedia: () => Promise.reject(refused) });
    await expect(denied.recorder.start("n.md")).rejects.toThrow(
      /not allowed to use the microphone/,
    );
    expect(denied.clock.running).toBe(false);

    const missing = Object.assign(new Error("none"), { name: "NotFoundError" });
    const none = setup({ getUserMedia: () => Promise.reject(missing) });
    await expect(none.recorder.start("n.md")).rejects.toThrow(/no microphone was found/);

    const busy = Object.assign(new Error("busy"), { name: "NotReadableError" });
    const taken = setup({ getUserMedia: () => Promise.reject(busy) });
    await expect(taken.recorder.start("n.md")).rejects.toThrow(/busy/);

    const odd = setup({ getUserMedia: () => Promise.reject("weird") });
    await expect(odd.recorder.start("n.md")).rejects.toThrow(/could not be opened \(weird\)/);
  });

  it("refuses where the device has no recording at all", async () => {
    const { recorder } = setup();
    vi.stubGlobal("navigator", {});
    await expect(recorder.start("n.md")).rejects.toThrow(/does not let Obsidian record audio/);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: async () => ({}) } });
    vi.stubGlobal("MediaRecorder", undefined);
    await expect(recorder.start("n.md")).rejects.toThrow(/does not let Obsidian record audio/);
  });
});

describe("writing", () => {
  it("appends each chunk as it arrives, in order, and the last one after stop", async () => {
    const { recorder, last, files, vault, time, track, clock } = setup();
    await recorder.start("Notes/Lecture.ink.md");
    const path = expectedPath("m4a");
    last().emit([1, 2]);
    await flush();
    expect(bytesOf(files, path)).toEqual([1, 2]);
    last().emit([3]);
    last().emit([4, 5]);
    await flush();
    expect(bytesOf(files, path)).toEqual([1, 2, 3, 4, 5]);
    expect(vault.createBinary).toHaveBeenCalledTimes(1);
    expect(vault.appendBinary).toHaveBeenCalledTimes(2);

    time.mono += 192_000;
    time.wall += 999_999; // a wall-clock jump changes nothing
    const result = await recorder.stop();
    expect(bytesOf(files, path)).toEqual([1, 2, 3, 4, 5, 9]);
    expect(result).toEqual({
      saved: { path, start: START, duration: 192_000, bytes: 6, mimeType: "audio/mp4" },
      problem: null,
    });
    expect(track.stopped).toBe(true);
    expect(clock.running).toBe(false);
  });

  it("skips empty chunks", async () => {
    const { recorder, last, vault } = setup();
    await recorder.start("Notes/Lecture.ink.md");
    last().emit([]);
    await flush();
    expect(vault.createBinary).not.toHaveBeenCalled();
    await recorder.stop();
    expect(vault.createBinary).toHaveBeenCalledTimes(1);
  });

  it("holds chunks in memory and writes once at the end before Obsidian 1.12.3", async () => {
    env.appendBinary = false;
    const { recorder, last, files, vault } = setup();
    await recorder.start("Notes/Lecture.ink.md");
    last().emit([1]);
    last().emit([2, 3]);
    await flush();
    expect(files.size).toBe(0);
    const result = await recorder.stop();
    expect(vault.appendBinary).not.toHaveBeenCalled();
    expect(bytesOf(files, expectedPath("m4a"))).toEqual([1, 2, 3, 9]);
    expect(result.saved?.bytes).toBe(4);
  });

  it("never puts a recording in a dot-folder: it goes next to the note instead", async () => {
    const { recorder, last, files } = setup({ attachments: "Notes/.attachments" });
    await recorder.start("Notes/Lecture.ink.md");
    last().emit([1]);
    const result = await recorder.stop();
    expect(result.saved?.path).toBe(expectedPath("m4a", "Notes"));
    expect(bytesOf(files, expectedPath("m4a", "Notes"))).toEqual([1, 9]);
  });

  it("creates the attachment folder, and takes the next name if the chosen one was taken", async () => {
    const { recorder, last, files, folders } = setup({ attachments: "Notes/audio" });
    await recorder.start("Notes/Lecture.ink.md");
    const chosen = expectedPath("m4a", "Notes/audio");
    files.set(chosen, new Uint8Array([7]));
    last().emit([1]);
    const result = await recorder.stop();
    expect(folders.has("Notes/audio")).toBe(true);
    const next = `Notes/audio/${recordingBaseName(new Date(START))} 1.m4a`;
    expect(result.saved?.path).toBe(next);
    expect(bytesOf(files, chosen)).toEqual([7]);
    expect(bytesOf(files, next)).toEqual([1, 9]);
  });

  it("writes by the path chosen at start, whatever happens to the note", async () => {
    const { recorder, last, fileManager } = setup();
    await recorder.start("Notes/Lecture.ink.md");
    expect(fileManager.getAvailablePathForAttachment).toHaveBeenCalledWith(
      `${recordingBaseName(new Date(START))}.m4a`,
      "Notes/Lecture.ink.md",
    );
    last().emit([1]);
    await recorder.stop();
    expect(fileManager.getAvailablePathForAttachment).toHaveBeenCalledTimes(1);
  });
});

describe("stopping", () => {
  it("reports nothing saved when nothing was recorded", async () => {
    const { recorder, last, files } = setup();
    await recorder.start("Notes/Lecture.ink.md");
    last().finalChunk = [];
    expect(await recorder.stop()).toEqual({ saved: null, problem: null });
    expect(files.size).toBe(0);
  });

  it("is idempotent: a second stop gets the same result and stops nothing twice", async () => {
    const { recorder, last } = setup();
    await recorder.start("Notes/Lecture.ink.md");
    const first = recorder.stop();
    const second = recorder.stop();
    expect(second).toBe(first);
    await first;
    expect(last().stopCalls).toBe(1);
  });

  it("does not wait forever for a recorder that never answers stop()", async () => {
    const { recorder, last } = setup();
    await recorder.start("Notes/Lecture.ink.md");
    last().emit([1]);
    await flush();
    last().finalChunk = null;
    vi.useFakeTimers();
    const pending = recorder.stop();
    await vi.advanceTimersByTimeAsync(5000);
    const result = await pending;
    expect(result.saved?.bytes).toBe(1);
  });

  it("says so when the file was deleted while recording", async () => {
    const { recorder, last, files } = setup();
    const interrupted: string[] = [];
    recorder.onInterrupted = (why) => interrupted.push(why);
    await recorder.start("Notes/Lecture.ink.md");
    last().emit([1]);
    await flush();
    files.delete(expectedPath("m4a"));
    last().emit([2]);
    await flush();
    expect(interrupted).toEqual(["write-failed"]);
    const result = await recorder.stop();
    expect(result).toEqual({ saved: null, problem: "File does not exist." });
  });

  it("keeps what was written when a later write fails, and says what went wrong", async () => {
    const { recorder, last, vault } = setup();
    await recorder.start("Notes/Lecture.ink.md");
    last().emit([1]);
    await flush();
    vault.appendBinary.mockRejectedValueOnce(new Error("disk full"));
    last().emit([2]);
    await flush();
    const result = await recorder.stop();
    expect(result.problem).toBe("disk full");
    expect(result.saved?.bytes).toBe(1);
  });
});

describe("interruptions", () => {
  it("reports a microphone that goes away, once, and not after stop", async () => {
    const { recorder, listeners } = setup();
    const interrupted: string[] = [];
    recorder.onInterrupted = (why) => interrupted.push(why);
    await recorder.start("Notes/Lecture.ink.md");
    listeners.get("ended")?.();
    expect(interrupted).toEqual(["track-ended"]);
    await recorder.stop();
    listeners.get("ended")?.();
    expect(interrupted).toEqual(["track-ended"]);
  });

  it("reports a recorder error, and a stop nobody asked for", async () => {
    const { recorder, last } = setup();
    const interrupted: string[] = [];
    recorder.onInterrupted = (why) => interrupted.push(why);
    await recorder.start("Notes/Lecture.ink.md");
    last().onerror?.();
    last().onstop?.();
    expect(interrupted).toEqual(["error", "error"]);
  });
});

describe("screen wake lock", () => {
  it("keeps the screen on where it can, and lets go at stop", async () => {
    const sentinel = { release: vi.fn(async () => undefined) };
    const wakeLock = { request: vi.fn(async () => sentinel) };
    const { recorder } = setup({ wakeLock });
    await recorder.start("Notes/Lecture.ink.md");
    expect(wakeLock.request).toHaveBeenCalledWith("screen");
    expect(recorder.keepsScreenOn).toBe(true);
    await recorder.stop();
    expect(sentinel.release).toHaveBeenCalledTimes(1);
    expect(recorder.keepsScreenOn).toBe(false);
  });

  it("does not keep the caller waiting on a wake lock that never answers", async () => {
    const wakeLock = { request: vi.fn(() => new Promise(() => undefined)) };
    const { recorder, clock } = setup({ wakeLock });
    vi.useFakeTimers();
    const started = recorder.start("Notes/Lecture.ink.md");
    await vi.advanceTimersByTimeAsync(1500);
    await expect(started).resolves.toBeUndefined();
    expect(recorder.keepsScreenOn).toBe(false);
    expect(clock.running).toBe(true);
  });

  it("does without one where it is missing or refused", async () => {
    const plain = setup();
    await plain.recorder.start("Notes/Lecture.ink.md");
    expect(plain.recorder.keepsScreenOn).toBe(false);

    const refusing = { request: vi.fn(() => Promise.reject(new Error("NotAllowedError"))) };
    const refused = setup({ wakeLock: refusing });
    await refused.recorder.start("Notes/Lecture.ink.md");
    expect(refused.recorder.keepsScreenOn).toBe(false);
    await refused.recorder.stop();
  });
});
