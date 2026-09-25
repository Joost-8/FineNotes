import { describe, expect, it } from "vitest";
import {
  AUDIO_VENDORS,
  DEFAULT_AUDIO_MODELS,
  GOOGLE_INLINE_MAX_BYTES,
  OPENAI_AUDIO_MAX_BYTES,
  audioFilename,
  audioUnsupportedReason,
  buildAudioRequest,
  buildAudioTranscriptionPrompt,
  bytesToBase64,
  canTranscribeAudio,
  encodeMultipart,
  escapeDispositionValue,
  extractAudioTranscript,
  geminiAudioMimeType,
  makeBoundary,
} from "../../src/recognition/audio-request";

const decode = (body: Uint8Array) => new TextDecoder().decode(body);
const audio = new Uint8Array([0x00, 0x01, 0xfe, 0xff, 0x0d, 0x0a]);
const boundary = "----GoodObsidianTEST";

describe("encodeMultipart", () => {
  it("encodes text fields and a file byte for byte (RFC 7578, CRLF)", () => {
    const body = encodeMultipart(
      [
        { name: "model", value: "gpt-4o-mini-transcribe" },
        { name: "file", filename: "recording.m4a", contentType: "audio/mp4", data: audio },
      ],
      "XyZ",
    );
    const head =
      "--XyZ\r\n" +
      'Content-Disposition: form-data; name="model"\r\n' +
      "\r\n" +
      "gpt-4o-mini-transcribe\r\n" +
      "--XyZ\r\n" +
      'Content-Disposition: form-data; name="file"; filename="recording.m4a"\r\n' +
      "Content-Type: audio/mp4\r\n" +
      "\r\n";
    const tail = "\r\n--XyZ--\r\n";
    const expected = new Uint8Array([
      ...new TextEncoder().encode(head),
      ...audio,
      ...new TextEncoder().encode(tail),
    ]);
    expect(Array.from(body)).toEqual(Array.from(expected));
  });

  it("keeps binary bytes intact, including ones that look like CRLF or invalid UTF-8", () => {
    const body = encodeMultipart(
      [{ name: "file", filename: "a.bin", contentType: "application/octet-stream", data: audio }],
      "B",
    );
    const headLength = new TextEncoder().encode(
      '--B\r\nContent-Disposition: form-data; name="file"; filename="a.bin"\r\n' +
        "Content-Type: application/octet-stream\r\n\r\n",
    ).length;
    expect(Array.from(body.subarray(headLength, headLength + audio.length))).toEqual(
      Array.from(audio),
    );
  });

  it("encodes a body with no parts as just the closing delimiter", () => {
    expect(decode(encodeMultipart([], "B"))).toBe("--B--\r\n");
  });

  it("encodes non-ASCII text values as UTF-8", () => {
    const body = encodeMultipart([{ name: "prompt", value: "Große Übung" }], "B");
    expect(decode(body)).toBe(
      '--B\r\nContent-Disposition: form-data; name="prompt"\r\n\r\nGroße Übung\r\n--B--\r\n',
    );
  });

  it("escapes quotes and line breaks in names the way browsers do", () => {
    expect(escapeDispositionValue('my "best"\r\nfile.m4a')).toBe("my %22best%22%0D%0Afile.m4a");
    const body = decode(
      encodeMultipart(
        [{ name: "file", filename: 'a"b.m4a', contentType: "audio/mp4", data: new Uint8Array() }],
        "B",
      ),
    );
    expect(body).toContain('filename="a%22b.m4a"');
  });

  it("refuses a boundary that is not a legal token", () => {
    expect(() => encodeMultipart([], "")).toThrow(/boundary/);
    expect(() => encodeMultipart([], "has space")).toThrow(/boundary/);
    expect(() => encodeMultipart([], "x".repeat(71))).toThrow(/boundary/);
  });

  it("makes a boundary from random bytes", () => {
    const b = makeBoundary(new Uint8Array([0, 1, 171, 255]));
    expect(b).toBe("----FineNotes0001abff");
    expect(() => encodeMultipart([], makeBoundary(new Uint8Array(16).fill(7)))).not.toThrow();
  });
});

describe("buildAudioRequest", () => {
  const base = { model: "", apiKey: "sk-test", audio, mimeType: "audio/mp4", boundary };

  it("uploads to OpenAI as multipart with model, format and file", () => {
    const req = buildAudioRequest({ ...base, vendor: "openai", language: "nl" });
    expect(req.url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(req.headers).toEqual({ authorization: "Bearer sk-test" });
    expect(req.contentType).toBe(`multipart/form-data; boundary=${boundary}`);
    const text = decode(req.body);
    expect(text).toContain(`name="model"\r\n\r\n${DEFAULT_AUDIO_MODELS.openai}\r\n`);
    expect(text).toContain('name="response_format"\r\n\r\njson\r\n');
    expect(text).toContain('name="language"\r\n\r\nnl\r\n');
    expect(text).toContain('filename="recording.m4a"\r\nContent-Type: audio/mp4\r\n');
    expect(text.endsWith(`--${boundary}--\r\n`)).toBe(true);
  });

  it("uses the chosen model when one is set", () => {
    const req = buildAudioRequest({ ...base, vendor: "openai", model: " gpt-transcribe " });
    expect(decode(req.body)).toContain('name="model"\r\n\r\ngpt-transcribe\r\n');
  });

  it("sends a custom endpoint's own path, and no key when it has none", () => {
    const req = buildAudioRequest({
      ...base,
      vendor: "custom",
      apiKey: "",
      baseUrl: "https://whisper.example.ts.net/v1/chat/completions",
    });
    expect(req.url).toBe("https://whisper.example.ts.net/v1/audio/transcriptions");
    expect(req.headers).toEqual({});
    expect(decode(req.body)).toContain(`\r\n\r\n${DEFAULT_AUDIO_MODELS.custom}\r\n`);
  });

  it("sends Gemini the audio inline, relabelled m4a, beside a prompt", () => {
    const req = buildAudioRequest({ ...base, vendor: "google", model: "gemini-x" });
    expect(req.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent",
    );
    expect(req.headers["x-goog-api-key"]).toBe("sk-test");
    expect(req.contentType).toBe("application/json");
    const body = JSON.parse(decode(req.body)) as {
      contents: Array<{
        parts: Array<{ inline_data?: { mime_type: string; data: string }; text?: string }>;
      }>;
      generationConfig: { maxOutputTokens: number };
    };
    expect(body.contents[0].parts[0].inline_data).toEqual({
      mime_type: "audio/m4a",
      data: bytesToBase64(audio),
    });
    expect(body.contents[0].parts[1].text).toMatch(/Transcribe this audio/);
    expect(body.generationConfig.maxOutputTokens).toBeGreaterThan(8192);
  });

  it("refuses what the vendor would refuse, before sending anything", () => {
    expect(() => buildAudioRequest({ ...base, vendor: "openai", apiKey: " " })).toThrow(/API key/);
    expect(() =>
      buildAudioRequest({ ...base, vendor: "openai", audio: new Uint8Array(0) }),
    ).toThrow(/empty/);
    expect(() =>
      buildAudioRequest({
        ...base,
        vendor: "openai",
        audio: new Uint8Array(OPENAI_AUDIO_MAX_BYTES + 1),
      }),
    ).toThrow(/at most 25 MB/);
    expect(() =>
      buildAudioRequest({
        ...base,
        vendor: "google",
        audio: new Uint8Array((GOOGLE_INLINE_MAX_BYTES * 3) / 4 + 1024),
      }),
    ).toThrow(/Gemini takes at most/);
  });

  it("does not cap a self-hosted server at OpenAI's limit", () => {
    const req = buildAudioRequest({
      ...base,
      vendor: "custom",
      baseUrl: "http://localhost:8000/v1",
      audio: new Uint8Array(OPENAI_AUDIO_MAX_BYTES + 1),
    });
    expect(req.body.length).toBeGreaterThan(OPENAI_AUDIO_MAX_BYTES);
  });
});

describe("which vendors transcribe audio", () => {
  it("is OpenAI, Google and a custom endpoint; Claude and OpenRouter say what would work", () => {
    expect(AUDIO_VENDORS.every(canTranscribeAudio)).toBe(true);
    expect(canTranscribeAudio("anthropic")).toBe(false);
    expect(canTranscribeAudio("openrouter")).toBe(false);
    expect(audioUnsupportedReason("anthropic")).toMatch(/OpenAI or Google key/);
    expect(audioUnsupportedReason("openrouter")).toMatch(/OpenAI or Google key/);
    expect(audioUnsupportedReason("openai")).toBe("");
  });
});

describe("responses", () => {
  it("reads OpenAI's { text } and Gemini's candidate text", () => {
    expect(extractAudioTranscript("openai", { text: " Hello class. ", usage: {} })).toBe(
      "Hello class.",
    );
    expect(extractAudioTranscript("custom", { text: "hi" })).toBe("hi");
    expect(
      extractAudioTranscript("google", {
        candidates: [{ content: { parts: [{ text: "Hello " }, { text: "class." }] } }],
      }),
    ).toBe("Hello class.");
  });

  it("is empty for malformed payloads", () => {
    expect(extractAudioTranscript("openai", null)).toBe("");
    expect(extractAudioTranscript("openai", { text: 3 })).toBe("");
    expect(extractAudioTranscript("google", { candidates: [] })).toBe("");
  });
});

describe("helpers", () => {
  it("names the upload after the recording's type", () => {
    expect(audioFilename("audio/mp4")).toBe("recording.m4a");
    expect(audioFilename("audio/webm;codecs=opus")).toBe("recording.webm");
    expect(audioFilename("audio/mpeg")).toBe("recording.mp3");
    expect(audioFilename("audio/x-wav")).toBe("recording.wav");
    expect(audioFilename("application/unknown")).toBe("recording.m4a");
  });

  it("maps MIME types to ones Gemini lists", () => {
    expect(geminiAudioMimeType("audio/mp4")).toBe("audio/m4a");
    expect(geminiAudioMimeType("audio/x-m4a")).toBe("audio/m4a");
    expect(geminiAudioMimeType("audio/mp3")).toBe("audio/mpeg");
    expect(geminiAudioMimeType("audio/wav; rate=16000")).toBe("audio/wav");
    expect(geminiAudioMimeType("")).toBe("audio/m4a");
  });

  it("base64-encodes large inputs without overflowing the stack", () => {
    expect(bytesToBase64(new Uint8Array([0, 1, 2, 255]))).toBe("AAEC/w==");
    const big = new Uint8Array(200_000).fill(65);
    expect(bytesToBase64(big)).toBe(Buffer.from(big).toString("base64"));
  });

  it("adds a language hint to Gemini's prompt when given", () => {
    expect(buildAudioTranscriptionPrompt()).not.toMatch(/language/);
    expect(buildAudioTranscriptionPrompt("nl")).toMatch(/language: nl/);
  });
});
