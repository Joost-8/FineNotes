/**
 * `src/audio/recording.ts` — the pure half of audio recording: format choice,
 * file names, the shared clock, the stroke ↔ recording time mapping, vendor
 * upload limits and the transcript note.
 */

import { describe, expect, it } from "vitest";
import {
  RECORDER_MIME_TYPES,
  RecordingClock,
  SEEK_LEAD_MS,
  audioExtensionForMime,
  audioMimeForExtension,
  audioUploadLimit,
  baseNameOf,
  buildTranscriptNote,
  concatChunks,
  describeRecording,
  findRecordingAt,
  formatClock,
  formatRecordingDate,
  nextRecordingId,
  recordedFormat,
  recorderMimeCandidates,
  recordingBaseName,
  seekTargetMs,
  strokeTime,
  transcriptPathFor,
  uploadSizeProblem,
} from "../../src/audio/recording";
import type { Recording } from "../../src/model/document";
import { OPENAI_AUDIO_MAX_BYTES } from "../../src/recognition/audio-request";

const MB = 1024 * 1024;

describe("recorderMimeCandidates", () => {
  it("offers AAC in MP4 first where it is supported, then the browser default", () => {
    const iPad = (mime: string) => mime.startsWith("audio/mp4");
    expect(recorderMimeCandidates(iPad)).toEqual(["audio/mp4;codecs=mp4a.40.2", "audio/mp4", ""]);
  });

  it("falls back to Opus in WebM on a recorder without MP4 (desktop Electron)", () => {
    const chromium = (mime: string) => mime.startsWith("audio/webm");
    expect(recorderMimeCandidates(chromium)).toEqual(["audio/webm;codecs=opus", "audio/webm", ""]);
  });

  it("keeps the preference order, and a probe that throws counts as unsupported", () => {
    expect(recorderMimeCandidates(() => true)).toEqual([...RECORDER_MIME_TYPES, ""]);
    expect(
      recorderMimeCandidates(() => {
        throw new Error("NotSupportedError");
      }),
    ).toEqual([""]);
  });
});

describe("audio types and extensions", () => {
  it("names a file for what is inside it", () => {
    expect(audioExtensionForMime("audio/mp4;codecs=mp4a.40.2")).toBe("m4a");
    expect(audioExtensionForMime("AUDIO/MP4")).toBe("m4a");
    expect(audioExtensionForMime("audio/aac")).toBe("m4a");
    expect(audioExtensionForMime("audio/webm;codecs=opus")).toBe("webm");
    expect(audioExtensionForMime("audio/ogg")).toBe("ogg");
    expect(audioExtensionForMime("audio/mpeg")).toBe("mp3");
    expect(audioExtensionForMime("audio/wav")).toBe("wav");
    expect(audioExtensionForMime("")).toBeNull();
    expect(audioExtensionForMime("video/mp4")).toBeNull();
    // A lookup table indexed by untrusted strings (CLAUDE.md).
    expect(audioExtensionForMime("constructor")).toBeNull();
  });

  it("reads the type to upload a file as from its extension", () => {
    expect(audioMimeForExtension("m4a")).toBe("audio/mp4");
    expect(audioMimeForExtension(".M4A")).toBe("audio/mp4");
    expect(audioMimeForExtension("webm")).toBe("audio/webm");
    expect(audioMimeForExtension("mp3")).toBe("audio/mpeg");
    expect(audioMimeForExtension("flac")).toBe("audio/flac");
    expect(audioMimeForExtension("md")).toBeNull();
    expect(audioMimeForExtension("toString")).toBeNull();
  });

  it("trusts what the recorder reports, then what was asked, then the platform", () => {
    expect(recordedFormat("audio/webm;codecs=opus", "audio/mp4", false)).toEqual({
      mimeType: "audio/webm",
      extension: "webm",
    });
    expect(recordedFormat("", "audio/mp4;codecs=mp4a.40.2", false)).toEqual({
      mimeType: "audio/mp4",
      extension: "m4a",
    });
    expect(recordedFormat("", "", true)).toEqual({ mimeType: "audio/mp4", extension: "m4a" });
    expect(recordedFormat("audio/x-unknown", "", false)).toEqual({
      mimeType: "audio/webm",
      extension: "webm",
    });
  });
});

describe("names and labels", () => {
  const at = new Date(2026, 8, 2, 9, 5, 30);

  it("names a recording by its local start, without a colon", () => {
    expect(recordingBaseName(at)).toBe("Recording 2026-09-02 09-05");
    expect(recordingBaseName(at)).not.toContain(":");
  });

  it("formats elapsed time as mm:ss, and h:mm:ss from an hour", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(999)).toBe("00:00");
    expect(formatClock(192_000)).toBe("03:12");
    expect(formatClock(59 * 60_000 + 59_999)).toBe("59:59");
    expect(formatClock(3_723_000)).toBe("1:02:03");
    for (const bad of [-5, Number.NaN, Infinity]) expect(formatClock(bad)).toBe("00:00");
  });

  it("describes a recording by date and length", () => {
    expect(formatRecordingDate(at.getTime())).toBe("2 Sep 2026, 09:05");
    expect(describeRecording({ start: at.getTime(), duration: 192_000 })).toBe(
      "2 Sep 2026, 09:05 · 03:12",
    );
  });

  it("mints recording ids above the highest, never by count", () => {
    expect(nextRecordingId(undefined)).toBe("r1");
    expect(nextRecordingId([])).toBe("r1");
    expect(nextRecordingId([{ id: "r1" }, { id: "r7" }, { id: "x3" }])).toBe("r8");
  });

  it("puts the transcript beside the audio, named after it", () => {
    expect(transcriptPathFor("Lectures/audio/Recording 2026-09-22 14-05.m4a")).toBe(
      "Lectures/audio/Recording 2026-09-22 14-05 transcript.md",
    );
    expect(transcriptPathFor("Recording.m4a")).toBe("Recording transcript.md");
    expect(baseNameOf("a/b/.hidden")).toBe(".hidden");
    expect(baseNameOf("a/b/c.d.m4a")).toBe("c.d");
  });
});

describe("RecordingClock", () => {
  function clocks() {
    const t = { wall: 1_000_000, mono: 50 };
    const clock = new RecordingClock(
      () => t.wall,
      () => t.mono,
    );
    return { t, clock };
  }

  it("is the wall clock while nothing records", () => {
    const { t, clock } = clocks();
    expect(clock.running).toBe(false);
    expect(clock.now()).toBe(1_000_000);
    t.wall += 500;
    expect(clock.now()).toBe(1_000_500);
    expect(clock.elapsed()).toBe(0);
  });

  it("runs on the monotonic clock while recording, immune to wall-clock jumps", () => {
    const { t, clock } = clocks();
    expect(clock.start()).toBe(1_000_000);
    expect(clock.running).toBe(true);
    t.mono += 2500;
    t.wall += 3_600_000; // an hour's jump mid-lecture
    expect(clock.elapsed()).toBe(2500);
    expect(clock.now()).toBe(1_002_500);
    expect(clock.stop()).toBe(2500);
    expect(clock.running).toBe(false);
    expect(clock.now()).toBe(t.wall);
  });

  it("never runs backwards", () => {
    const { t, clock } = clocks();
    clock.start();
    t.mono -= 10;
    expect(clock.elapsed()).toBe(0);
  });
});

describe("stroke ↔ recording time", () => {
  const start = Date.UTC(2026, 8, 22, 10, 0, 0);
  const first: Recording = { id: "r1", path: "a.m4a", start, duration: 600_000 };
  const second: Recording = { id: "r2", path: "b.m4a", start: start + 3_600_000, duration: 60_000 };

  it("a stroke's time is its page's epoch plus its t0", () => {
    expect(strokeTime({ epoch: start }, { t0: 1500 })).toBe(start + 1500);
    expect(strokeTime({ epoch: start }, { t0: 0 })).toBe(start);
  });

  it("an untimed stroke, or a page without a clock, has no time", () => {
    expect(strokeTime({ epoch: start }, {})).toBeNull();
    expect(strokeTime({}, { t0: 10 })).toBeNull();
    expect(strokeTime({ epoch: 0 }, { t0: 10 })).toBeNull();
    expect(strokeTime({ epoch: start }, { t0: -1 })).toBeNull();
    expect(strokeTime({ epoch: Number.NaN }, { t0: 1 })).toBeNull();
  });

  it("finds the recording that was running, across pages with their own epochs", () => {
    // Page 1 started before the recording; page 2 was added during it.
    const page1 = { epoch: start - 120_000 };
    const page2 = { epoch: start + 400_000 };
    const on1 = strokeTime(page1, { t0: 180_000 });
    const on2 = strokeTime(page2, { t0: 30_000 });
    expect(findRecordingAt([first, second], on1 ?? Number.NaN)).toEqual({
      recording: first,
      offsetMs: 60_000,
    });
    expect(findRecordingAt([first, second], on2 ?? Number.NaN)).toEqual({
      recording: first,
      offsetMs: 430_000,
    });
    expect(findRecordingAt([first, second], start + 3_600_000 + 5000)?.recording).toBe(second);
  });

  it("strokes written outside every recording belong to none", () => {
    expect(findRecordingAt([first, second], start - 1)).toBeNull();
    expect(findRecordingAt([first, second], start + 600_001)).toBeNull();
    expect(findRecordingAt(undefined, start)).toBeNull();
    expect(findRecordingAt([first], Number.NaN)).toBeNull();
    // The edges themselves are inside.
    expect(findRecordingAt([first], start)?.offsetMs).toBe(0);
    expect(findRecordingAt([first], start + 600_000)?.offsetMs).toBe(600_000);
  });

  it("prefers the recording in the player when two overlap", () => {
    const overlap: Recording = { id: "r3", path: "c.m4a", start: start + 1000, duration: 5000 };
    expect(findRecordingAt([first, overlap], start + 2000)?.recording).toBe(first);
    expect(findRecordingAt([first, overlap], start + 2000, "r3")?.recording).toBe(overlap);
  });

  it("seeks a few seconds before the pen went down, never outside the audio", () => {
    expect(SEEK_LEAD_MS).toBe(5000);
    expect(seekTargetMs(60_000, 600_000)).toBe(55_000);
    expect(seekTargetMs(3000, 600_000)).toBe(0);
    expect(seekTargetMs(900_000, 600_000)).toBe(600_000);
    expect(seekTargetMs(60_000, 600_000, 10_000)).toBe(50_000);
    expect(seekTargetMs(10, -5)).toBe(0);
  });
});

describe("upload limits", () => {
  it("knows OpenAI's 25 MB and Gemini's inline budget; a custom endpoint has none", () => {
    expect(audioUploadLimit("openai")).toBe(OPENAI_AUDIO_MAX_BYTES);
    expect(audioUploadLimit("google")).toBe(14 * MB);
    expect(audioUploadLimit("custom")).toBeNull();
    expect(audioUploadLimit("anthropic")).toBeNull();
  });

  it("refuses a file that is too big before anything is read or sent", () => {
    expect(uploadSizeProblem("openai", 21.6 * MB)).toBeNull();
    expect(uploadSizeProblem("openai", 30 * MB)).toBe(
      "This recording is 30.0 MB, and OpenAI takes at most 25.0 MB. Record shorter parts.",
    );
    expect(uploadSizeProblem("google", 14 * MB)).toBeNull();
    expect(uploadSizeProblem("google", 20 * MB)).toMatch(
      /^This recording is 20\.0 MB, and Gemini takes at most about 14\.0 MB .*OpenAI key/,
    );
    expect(uploadSizeProblem("custom", 500 * MB)).toBeNull();
  });
});

describe("buildTranscriptNote", () => {
  it("is a heading, a link back, the audio, then the text", () => {
    const start = new Date(2026, 8, 22, 14, 5).getTime();
    const note = buildTranscriptNote({
      title: "Recording 2026-09-22 14-05",
      start,
      duration: 192_000,
      notebookLink: "[[Analysis.ink|Analysis]]",
      audioEmbed: "![[Recording 2026-09-22 14-05.m4a]]",
      text: "  Good morning.\n\nToday: limits.  \n",
    });
    expect(note).toBe(
      "# Recording 2026-09-22 14-05 — transcript\n\n" +
        "Recorded 22 Sep 2026, 14:05 (03:12) with [[Analysis.ink|Analysis]].\n\n" +
        "![[Recording 2026-09-22 14-05.m4a]]\n\n" +
        "Good morning.\n\nToday: limits.\n",
    );
  });
});

describe("concatChunks", () => {
  it("joins chunks in order", () => {
    const a = new Uint8Array([1, 2]).buffer;
    const b = new Uint8Array([]).buffer;
    const c = new Uint8Array([3]).buffer;
    expect([...new Uint8Array(concatChunks([a, b, c]))]).toEqual([1, 2, 3]);
    expect(concatChunks([]).byteLength).toBe(0);
  });
});
