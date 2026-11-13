import { describe, expect, it } from "vitest";
import {
  type OnlineAnswer,
  TranscriptionStopped,
  UPLOAD_WINDOW_MAX_S,
  WAV_HEADER_BYTES,
  answerText,
  encodeWav,
  isOnlineSpeechService,
  isSpeechService,
  joinAnswers,
  transcribeOnline,
  uploadWindowSeconds,
  windowResult,
} from "../../src/audio/online-speech";
import { SPEECH_RATE, type SpeechWindow } from "../../src/audio/speech-chunks";

const MB = 1024 * 1024;

/** A tone with a quiet gap every `gapEvery` seconds, so cuts have somewhere to go. */
function speechLike(seconds: number, gapEvery = 50): Float32Array {
  const out = new Float32Array(Math.round(seconds * SPEECH_RATE));
  for (let i = 0; i < out.length; i++) {
    const t = i / SPEECH_RATE;
    const quiet = t % gapEvery > gapEvery - 0.5;
    out[i] = quiet ? 0 : 0.3 * Math.sin(2 * Math.PI * 220 * t);
  }
  return out;
}

describe("services", () => {
  it("knows this device and the online services, and nothing else", () => {
    expect(isSpeechService("device")).toBe(true);
    expect(isSpeechService("groq")).toBe(true);
    expect(isSpeechService("anthropic")).toBe(false);
    expect(isSpeechService(undefined)).toBe(false);
    expect(isOnlineSpeechService("device")).toBe(false);
    expect(isOnlineSpeechService("openrouter")).toBe(true);
  });
});

describe("uploadWindowSeconds", () => {
  it("fits 16-bit mono WAV under the limit, at most ten minutes", () => {
    expect(uploadWindowSeconds(25 * MB)).toBe(UPLOAD_WINDOW_MAX_S);
    const small = uploadWindowSeconds(4 * MB);
    expect(small * SPEECH_RATE * 2 + WAV_HEADER_BYTES).toBeLessThan(4 * MB);
    expect(small).toBeGreaterThan(100);
    expect(uploadWindowSeconds(1000)).toBe(30);
  });

  it("keeps a full window's WAV under 25 MB", () => {
    const seconds = uploadWindowSeconds(25 * MB);
    expect(seconds * SPEECH_RATE * 2 + WAV_HEADER_BYTES).toBeLessThan(25 * MB);
  });
});

describe("encodeWav", () => {
  it("writes a 16 kHz mono 16-bit PCM header and clamped samples", () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 2, -2, 0.5, Number.NaN]));
    const view = new DataView(wav.buffer);
    const ascii = (at: number, n: number) => String.fromCharCode(...wav.subarray(at, at + n));
    expect(ascii(0, 4)).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(wav.length - 8);
    expect(ascii(8, 8)).toBe("WAVEfmt ");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint32(28, true)).toBe(32000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(ascii(36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(14);
    const sample = (i: number) => view.getInt16(WAV_HEADER_BYTES + i * 2, true);
    expect([0, 1, 2, 3, 4, 5, 6].map(sample)).toEqual([0, 32767, -32768, 32767, -32768, 16383, 0]);
  });
});

describe("windowResult", () => {
  const window: SpeechWindow = { index: 1, from: 16000, to: 64000, own0: 20000, own1: 60000 };

  it("passes a service's own segments through", () => {
    const segments = [{ start: 0, end: 500, text: "hi" }];
    expect(windowResult(window, { text: "hi", segments }).segments).toBe(segments);
  });

  it("spans what the window keeps with text alone", () => {
    expect(windowResult(window, { text: " Hello there. " }).segments).toEqual([
      { start: 250, end: 2750, text: "Hello there." },
    ]);
    expect(windowResult(window, { text: "  " }).segments).toEqual([]);
  });
});

describe("answerText", () => {
  it("is the text when there are no segments", () => {
    expect(answerText({ text: " Hello class. " })).toBe("Hello class.");
  });

  it("is a timed transcript from segments, without silence lines", () => {
    const answer: OnlineAnswer = {
      text: "ignored",
      segments: [
        { start: 0, end: 1500, text: " Good  morning." },
        { start: 1500, end: 2000, text: "[BLANK_AUDIO]" },
        { start: 5000, end: 6000, text: "Let's start." },
      ],
    };
    expect(answerText(answer)).toBe("[0:00] Good morning.\n\n[0:05] Let's start.");
  });

  it("falls back to the text when every segment is silence", () => {
    expect(answerText({ text: "Hm.", segments: [{ start: 0, end: 1, text: "(music)" }] })).toBe(
      "Hm.",
    );
  });
});

describe("joinAnswers", () => {
  const windows: SpeechWindow[] = [
    { index: 0, from: 0, to: 16000 * 10.3, own0: 0, own1: 16000 * 10 },
    { index: 1, from: 16000 * 9.7, to: 16000 * 20, own0: 16000 * 10, own1: 16000 * 20 },
  ];

  it("gives paragraphs, and drops the words a window repeats from the one before", () => {
    const text = joinAnswers([
      { window: windows[0], answer: { text: "we usually call it pictures" } },
      { window: windows[1], answer: { text: "call it pictures and then we draw" } },
    ]);
    expect(text).toBe("we usually call it pictures\n\nand then we draw");
  });

  it("gives a timed transcript when the windows came with segments", () => {
    const text = joinAnswers([
      {
        window: windows[0],
        answer: { text: "", segments: [{ start: 0, end: 2000, text: "One." }] },
      },
      // 2.3 s into the second window is 12 s into the recording.
      {
        window: windows[1],
        answer: { text: "", segments: [{ start: 2300, end: 4000, text: "Two." }] },
      },
    ]);
    expect(text).toBe("[0:00] One.\n\n[0:12] Two.");
  });
});

describe("transcribeOnline", () => {
  it("sends a recording that fits whole, as it is, without decoding it", async () => {
    const bytes = new Uint8Array(1000);
    const sent: { size: number; type: string }[] = [];
    const parts: number[][] = [];
    const text = await transcribeOnline({
      bytes,
      mimeType: "audio/mp4",
      maxBytes: 1000,
      decode: () => Promise.reject(new Error("should not decode")),
      send: (audio, type) => {
        sent.push({ size: audio.length, type });
        return Promise.resolve({ text: "Whole." });
      },
      onUpload: (part, count) => parts.push([part, count]),
    });
    expect(text).toBe("Whole.");
    expect(sent).toEqual([{ size: 1000, type: "audio/mp4" }]);
    expect(parts).toEqual([[1, 1]]);
  });

  it("decodes a longer one and sends WAV windows under the limit, in order", async () => {
    const samples = speechLike(130);
    const maxBytes = 1 * MB; // about 30 s of WAV a window
    const sizes: number[] = [];
    let n = 0;
    const text = await transcribeOnline({
      bytes: new Uint8Array(maxBytes + 1),
      mimeType: "audio/mp4",
      maxBytes,
      decode: () => Promise.resolve(samples),
      send: (audio, type) => {
        expect(type).toBe("audio/wav");
        sizes.push(audio.length);
        n += 1;
        return Promise.resolve({ text: `Part ${n}.` });
      },
    });
    expect(sizes.length).toBeGreaterThanOrEqual(5);
    for (const size of sizes) expect(size).toBeLessThan(maxBytes);
    expect(text.split("\n\n")).toEqual(sizes.map((_, i) => `Part ${i + 1}.`));
  });

  it("stops before the next upload when asked", async () => {
    let sent = 0;
    await expect(
      transcribeOnline({
        bytes: new Uint8Array(2 * MB),
        mimeType: "audio/mp4",
        maxBytes: 1 * MB,
        decode: () => Promise.resolve(speechLike(120)),
        send: () => {
          sent += 1;
          return Promise.resolve({ text: "x" });
        },
        stopped: () => sent >= 1,
      }),
    ).rejects.toBeInstanceOf(TranscriptionStopped);
    expect(sent).toBe(1);
  });

  it("passes a service's error through", async () => {
    await expect(
      transcribeOnline({
        bytes: new Uint8Array(10),
        mimeType: "audio/mp4",
        maxBytes: 100,
        decode: () => Promise.resolve(new Float32Array(0)),
        send: () => Promise.reject(new Error("Groq: invalid API key")),
      }),
    ).rejects.toThrow("Groq: invalid API key");
  });
});
