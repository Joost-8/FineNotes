import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMAGE_MODELS,
  IMAGE_ASPECTS,
  IMAGE_VENDORS,
  base64ToBytes,
  buildImageRequest,
  canGenerateImages,
  describeMissingImage,
  extractGeneratedImage,
  generatedImageName,
  imageDimensions,
  imageExtension,
  imageUnsupportedReason,
} from "../../src/recognition/ai-image";

const base = {
  model: "m",
  apiKey: "sk-test",
  prompt: "  a plant cell  ",
  aspect: "square" as const,
};

describe("which vendors make images", () => {
  it("is OpenAI, Google and OpenRouter — never Claude or a custom endpoint", () => {
    expect(IMAGE_VENDORS.every(canGenerateImages)).toBe(true);
    expect(canGenerateImages("anthropic")).toBe(false);
    expect(canGenerateImages("custom")).toBe(false);
    expect(imageUnsupportedReason("anthropic")).toMatch(/Claude cannot make images/);
    expect(imageUnsupportedReason("custom")).toMatch(/OpenAI, Google or OpenRouter/);
    expect(imageUnsupportedReason("openai")).toBe("");
  });

  it("has a default model for each image vendor", () => {
    for (const vendor of IMAGE_VENDORS)
      expect(DEFAULT_IMAGE_MODELS[vendor].length).toBeGreaterThan(0);
  });
});

describe("buildImageRequest", () => {
  it("builds an OpenAI Images API request with a documented size", () => {
    const sizes = IMAGE_ASPECTS.map((aspect) => {
      const req = buildImageRequest({ ...base, vendor: "openai", aspect });
      expect(req.url).toBe("https://api.openai.com/v1/images/generations");
      expect(req.headers).toEqual({
        authorization: "Bearer sk-test",
        "content-type": "application/json",
      });
      const body = req.body as Record<string, unknown>;
      expect(body.prompt).toBe("a plant cell");
      expect(body.n).toBe(1);
      // GPT Image models reject the DALL·E-only response_format parameter.
      expect(body.response_format).toBeUndefined();
      return body.size;
    });
    expect(sizes).toEqual(["1024x1024", "1536x1024", "1024x1536"]);
  });

  it("builds a Gemini generateContent request asking for an image", () => {
    const req = buildImageRequest({ ...base, vendor: "google", aspect: "portrait" });
    expect(req.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/m:generateContent",
    );
    expect(req.headers).toEqual({
      "x-goog-api-key": "sk-test",
      "content-type": "application/json",
    });
    type GeminiImageBody = {
      contents: Array<{ parts: Array<{ text: string }> }>;
      generationConfig: { responseModalities: string[]; imageConfig: { aspectRatio: string } };
    };
    const body = req.body as GeminiImageBody;
    expect(body.contents[0].parts[0].text).toBe("a plant cell");
    expect(body.generationConfig.responseModalities).toEqual(["TEXT", "IMAGE"]);
    expect(body.generationConfig.imageConfig.aspectRatio).toBe("3:4");
  });

  it("builds an OpenRouter Image API request", () => {
    const req = buildImageRequest({ ...base, vendor: "openrouter", aspect: "landscape" });
    expect(req.url).toBe("https://openrouter.ai/api/v1/images");
    expect(req.headers).toMatchObject({
      authorization: "Bearer sk-test",
      "x-title": "FineNotes",
    });
    expect(req.body).toEqual({ model: "m", prompt: "a plant cell", n: 1, aspect_ratio: "4:3" });
  });

  it("refuses without a key or a prompt", () => {
    expect(() => buildImageRequest({ ...base, vendor: "openai", apiKey: "" })).toThrow(/API key/);
    expect(() => buildImageRequest({ ...base, vendor: "google", prompt: "  " })).toThrow(
      /describe/,
    );
  });
});

describe("extractGeneratedImage", () => {
  it("reads OpenAI's data[0].b64_json (PNG by default)", () => {
    const json = { created: 1, data: [{ b64_json: "iVBOR" }], usage: { total_tokens: 10 } };
    expect(extractGeneratedImage("openai", json)).toEqual({
      base64: "iVBOR",
      mimeType: "image/png",
    });
    const jpeg = { data: [{ b64_json: "/9j/" }], output_format: "jpeg" };
    expect(extractGeneratedImage("openai", jpeg)?.mimeType).toBe("image/jpeg");
    const jpg = { data: [{ b64_json: "/9j/" }], output_format: "jpg" };
    expect(extractGeneratedImage("openai", jpg)?.mimeType).toBe("image/jpeg");
  });

  it("reads OpenRouter's b64_json with its media_type, or a data URL", () => {
    const json = { data: [{ b64_json: "UklG", media_type: "image/webp" }] };
    expect(extractGeneratedImage("openrouter", json)).toEqual({
      base64: "UklG",
      mimeType: "image/webp",
    });
    const url = { data: [{ url: "data:image/png;base64,iVBOR" }] };
    expect(extractGeneratedImage("openrouter", url)).toEqual({
      base64: "iVBOR",
      mimeType: "image/png",
    });
    expect(extractGeneratedImage("openrouter", { data: [{ url: "https://x/y.png" }] })).toBeNull();
  });

  it("reads Gemini's inlineData part, skipping the text part", () => {
    const json = {
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              { text: "Here is your cell." },
              { inlineData: { mimeType: "image/png", data: "iVBOR" } },
            ],
          },
          finishReason: "STOP",
        },
      ],
    };
    expect(extractGeneratedImage("google", json)).toEqual({
      base64: "iVBOR",
      mimeType: "image/png",
    });
    const snake = { candidates: [{ content: { parts: [{ inline_data: { data: "Zm9v" } }] } }] };
    expect(extractGeneratedImage("google", snake)).toEqual({
      base64: "Zm9v",
      mimeType: "image/png",
    });
    const audio = {
      candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/wav", data: "x" } }] } }],
    };
    expect(extractGeneratedImage("google", audio)).toBeNull();
  });

  it("is null for malformed or empty payloads", () => {
    expect(extractGeneratedImage("openai", null)).toBeNull();
    expect(extractGeneratedImage("openai", { data: [] })).toBeNull();
    expect(extractGeneratedImage("openai", { data: [{ b64_json: "" }] })).toBeNull();
    expect(extractGeneratedImage("google", { candidates: [] })).toBeNull();
    expect(
      extractGeneratedImage("google", { candidates: [{ content: { parts: [1, null] } }] }),
    ).toBeNull();
  });
});

describe("describeMissingImage", () => {
  it("quotes Gemini's text answer to a refused prompt", () => {
    const json = {
      candidates: [{ content: { parts: [{ text: "I can't draw that." }] }, finishReason: "STOP" }],
    };
    expect(describeMissingImage("google", json)).toBe("I can't draw that.");
    const long = { candidates: [{ content: { parts: [{ text: "x".repeat(400) }] } }] };
    expect(describeMissingImage("google", long).length).toBeLessThanOrEqual(301);
  });

  it("names a blocked prompt or a no-image finish", () => {
    expect(describeMissingImage("google", { promptFeedback: { blockReason: "SAFETY" } })).toBe(
      "the prompt was blocked (SAFETY)",
    );
    expect(describeMissingImage("google", { candidates: [{ finishReason: "IMAGE_SAFETY" }] })).toBe(
      "no image (IMAGE_SAFETY)",
    );
    expect(describeMissingImage("google", { candidates: [{ finishReason: "STOP" }] })).toBe("");
    expect(describeMissingImage("google", { candidates: [] })).toBe("");
    expect(describeMissingImage("openai", { data: [] })).toBe("");
  });
});

describe("files", () => {
  it("names a generated picture from the time and the prompt", () => {
    const when = new Date(2026, 8, 22, 14, 3);
    expect(generatedImageName("A labelled [plant] cell: #bio | ^x", when, "image/png")).toBe(
      "AI image 2026-09-22 1403 A labelled plant cell bio x.png",
    );
    expect(generatedImageName("", when, "image/jpeg")).toBe("AI image 2026-09-22 1403.jpg");
    const long = generatedImageName("one two three four five six seven eight", when, "image/webp");
    expect(long).toBe("AI image 2026-09-22 1403 one two three four five six.webp");
  });

  it("maps MIME types to extensions", () => {
    expect(imageExtension("image/png")).toBe("png");
    expect(imageExtension("IMAGE/JPEG")).toBe("jpg");
    expect(imageExtension("image/jpg")).toBe("jpg");
    expect(imageExtension("image/webp")).toBe("webp");
    expect(imageExtension("image/gif")).toBe("gif");
    expect(imageExtension("application/octet-stream")).toBe("png");
  });

  it("decodes base64, ignoring whitespace", () => {
    expect(Array.from(base64ToBytes("AAEC\n/w=="))).toEqual([0, 1, 2, 255]);
  });
});

function bytes(...parts: Array<number[] | string>): Uint8Array {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === "string") for (const c of part) out.push(c.charCodeAt(0));
    else out.push(...part);
  }
  return new Uint8Array(out);
}

describe("imageDimensions", () => {
  it("reads a PNG's IHDR", () => {
    const png = bytes(
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13],
      "IHDR",
      [0, 0, 0x06, 0x00, 0, 0, 0x04, 0x00],
    );
    expect(imageDimensions(png)).toEqual({ width: 1536, height: 1024 });
  });

  it("walks a JPEG to its start-of-frame", () => {
    const jpeg = bytes(
      [0xff, 0xd8],
      [0xff, 0xe0, 0x00, 0x10, ...new Array<number>(14).fill(0)],
      [0xff, 0xc0, 0x00, 0x11, 0x08, 0x04, 0x00, 0x03, 0x00, 0x03],
      new Array<number>(8).fill(0),
    );
    expect(imageDimensions(jpeg)).toEqual({ width: 768, height: 1024 });
  });

  it("reads WebP VP8X, VP8L and VP8 headers", () => {
    const riff = (chunk: string, data: number[]) =>
      bytes("RIFF", [0, 0, 0, 0], "WEBP", chunk, [0, 0, 0, 0], data, new Array<number>(8).fill(0));
    expect(imageDimensions(riff("VP8X", [0, 0, 0, 0, 0xff, 0x03, 0, 0xff, 0x05, 0]))).toEqual({
      width: 1024,
      height: 1536,
    });
    expect(imageDimensions(riff("VP8L", [0x2f, 0x2b, 0xc1, 0x31, 0x00]))).toEqual({
      width: 300,
      height: 200,
    });
    expect(
      imageDimensions(riff("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, 0x00, 0x04, 0x00, 0x03])),
    ).toEqual({ width: 1024, height: 768 });
  });

  it("is null for anything else", () => {
    expect(imageDimensions(bytes("GIF89a", new Array<number>(30).fill(0)))).toBeNull();
    expect(imageDimensions(new Uint8Array(0))).toBeNull();
    expect(
      imageDimensions(bytes([0xff, 0xd8, 0x00, 0x00], new Array<number>(20).fill(0))),
    ).toBeNull();
    const zero = bytes([0x89, 0x50, 0x4e, 0x47], new Array<number>(20).fill(0));
    expect(imageDimensions(zero)).toBeNull();
  });
});
