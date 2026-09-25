/**
 * Pure request/response shapes for "Generate image" with the user's own key.
 *
 * Three services can do it, each its own way (all checked against the
 * vendors' own documentation on 2026-09-22):
 *
 * - **OpenAI** — the Images API, `POST /v1/images/generations`. GPT Image
 *   models always answer with base64 at `data[0].b64_json` (PNG unless asked
 *   otherwise); `response_format` belongs to the retired DALL·E models and is
 *   not sent. Sizes 1024x1024, 1536x1024, 1024x1536.
 *   https://developers.openai.com/api/docs/guides/image-generation
 * - **Google** — `generateContent` on a Gemini image model with
 *   `generationConfig.responseModalities: ["TEXT", "IMAGE"]` and
 *   `imageConfig.aspectRatio`; the picture comes back as an `inlineData` part.
 *   https://ai.google.dev/api/generate-content
 * - **OpenRouter** — its Image API, `POST /api/v1/images`, with an
 *   `aspect_ratio`; base64 at `data[0].b64_json` beside a `media_type`.
 *   https://openrouter.ai/docs/features/multimodal/image-generation
 *
 * Anthropic's API has no image output at all, and a custom OpenAI-compatible
 * endpoint is assumed to be a chat server; both say so instead of trying.
 *
 * No DOM, no Obsidian, no network.
 */

import { type LlmHttpRequest, type LlmVendor, VENDORS, isRecord } from "./llm-request";

export type ImageVendor = "openai" | "google" | "openrouter";

export const IMAGE_VENDORS: readonly ImageVendor[] = ["openai", "google", "openrouter"];

/**
 * Starting points, editable in settings. Current ids from each vendor's model
 * list (2026-09-22): OpenAI's everyday GPT Image model, Google's general
 * "Nano Banana" model, and an OpenRouter slug its image docs name.
 */
export const DEFAULT_IMAGE_MODELS: Readonly<Record<ImageVendor, string>> = {
  openai: "gpt-image-2.5-flare",
  google: "gemini-3.1-flash-image",
  openrouter: "google/gemini-2.5-flash-image",
};

export type ImageAspect = "square" | "landscape" | "portrait";

export const IMAGE_ASPECTS: readonly ImageAspect[] = ["square", "landscape", "portrait"];

/** OpenAI's three documented GPT Image sizes. */
const OPENAI_SIZES: Record<ImageAspect, string> = {
  square: "1024x1024",
  landscape: "1536x1024",
  portrait: "1024x1536",
};

/** Ratios both Gemini and OpenRouter document. */
const RATIOS: Record<ImageAspect, string> = {
  square: "1:1",
  landscape: "4:3",
  portrait: "3:4",
};

/** Whether the vendor can generate images with its own key. */
export function canGenerateImages(vendor: LlmVendor): vendor is ImageVendor {
  return (IMAGE_VENDORS as readonly string[]).includes(vendor);
}

/** A one-line reason why `vendor` cannot generate images (empty when it can). */
export function imageUnsupportedReason(vendor: LlmVendor): string {
  if (canGenerateImages(vendor)) return "";
  if (vendor === "anthropic") {
    return "Claude cannot make images — needs an OpenAI, Google or OpenRouter key";
  }
  return "Needs an OpenAI, Google or OpenRouter key";
}

export interface ImageRequestInput {
  vendor: ImageVendor;
  model: string;
  apiKey: string;
  prompt: string;
  aspect: ImageAspect;
}

/** Build the vendor's HTTP request. Throws on a missing key or an empty prompt. */
export function buildImageRequest(input: ImageRequestInput): LlmHttpRequest {
  if (!input.apiKey.trim()) throw new Error("missing API key");
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("describe the image first");
  const vendor = VENDORS[input.vendor];
  const headers = { ...vendor.headers(input.apiKey), "content-type": "application/json" };

  switch (input.vendor) {
    case "openai":
      return {
        url: "https://api.openai.com/v1/images/generations",
        headers,
        body: { model: input.model, prompt, n: 1, size: OPENAI_SIZES[input.aspect] },
      };

    case "google":
      return {
        url: vendor.url({ model: input.model }),
        headers,
        body: {
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            responseModalities: ["TEXT", "IMAGE"],
            imageConfig: { aspectRatio: RATIOS[input.aspect] },
          },
        },
      };

    case "openrouter":
      return {
        url: "https://openrouter.ai/api/v1/images",
        headers,
        body: { model: input.model, prompt, n: 1, aspect_ratio: RATIOS[input.aspect] },
      };
  }
}

export interface GeneratedImage {
  /** Base64 without a data-URL prefix. */
  base64: string;
  mimeType: string;
}

/** First element of an array read from JSON, as `unknown` (never `any`). */
function firstOf(value: unknown): unknown {
  return Array.isArray(value) ? (value as unknown[])[0] : undefined;
}

/** Split a `data:<mime>;base64,<data>` URL, or null. */
function fromDataUrl(url: unknown): GeneratedImage | null {
  if (typeof url !== "string") return null;
  const match = /^data:([\w/+.-]+);base64,(.+)$/s.exec(url);
  return match ? { mimeType: match[1], base64: match[2] } : null;
}

/** The generated picture in a vendor response, or null if there is none. */
export function extractGeneratedImage(vendor: ImageVendor, json: unknown): GeneratedImage | null {
  if (!isRecord(json)) return null;

  if (vendor === "google") {
    const candidate = firstOf(json.candidates);
    const content = isRecord(candidate) ? candidate.content : undefined;
    const parts: unknown[] = isRecord(content) && Array.isArray(content.parts) ? content.parts : [];
    for (const part of parts) {
      if (!isRecord(part)) continue;
      // The REST reply spells it `inlineData`; accept the proto spelling too.
      const inline = isRecord(part.inlineData)
        ? part.inlineData
        : isRecord(part.inline_data)
          ? part.inline_data
          : null;
      if (!inline || typeof inline.data !== "string" || !inline.data) continue;
      const mime = inline.mimeType ?? inline.mime_type;
      if (typeof mime === "string" && !mime.startsWith("image/")) continue;
      return { base64: inline.data, mimeType: typeof mime === "string" ? mime : "image/png" };
    }
    return null;
  }

  // OpenAI and OpenRouter share the `data: [{ b64_json }]` shape.
  const first = firstOf(json.data);
  if (!isRecord(first)) return null;
  if (typeof first.b64_json === "string" && first.b64_json) {
    const mime =
      typeof first.media_type === "string"
        ? first.media_type
        : typeof json.output_format === "string"
          ? `image/${json.output_format === "jpg" ? "jpeg" : json.output_format}`
          : "image/png";
    return { base64: first.b64_json, mimeType: mime };
  }
  return fromDataUrl(first.url);
}

/**
 * Why a response that parsed fine holds no picture — the vendor's own words
 * where it gave any (Gemini answers a refused prompt with text), else "".
 */
export function describeMissingImage(vendor: ImageVendor, json: unknown): string {
  if (!isRecord(json) || vendor !== "google") return "";
  const feedback = json.promptFeedback;
  if (isRecord(feedback) && typeof feedback.blockReason === "string") {
    return `the prompt was blocked (${feedback.blockReason})`;
  }
  const candidate = firstOf(json.candidates);
  if (!isRecord(candidate)) return "";
  const content = candidate.content;
  const parts: unknown[] = isRecord(content) && Array.isArray(content.parts) ? content.parts : [];
  const text = parts
    .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
    .join(" ")
    .trim();
  if (text) return text.length > 300 ? `${text.slice(0, 300)}…` : text;
  const reason = candidate.finishReason;
  return typeof reason === "string" && reason !== "STOP" ? `no image (${reason})` : "";
}

/**
 * A vault file name for a generated picture: when, plus the prompt's first
 * words, with every character Obsidian refuses in a linkable name removed —
 * e.g. `AI image 2026-09-22 1403 plant cell diagram.png`.
 */
export function generatedImageName(prompt: string, when: Date, mimeType: string): string {
  const p2 = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${when.getFullYear()}-${p2(when.getMonth() + 1)}-${p2(when.getDate())} ` +
    `${p2(when.getHours())}${p2(when.getMinutes())}`;
  const words = prompt
    .replace(/[\\/:*?"<>|#^[\]{}%~`$!@&=+;,.'()]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .join(" ")
    .slice(0, 48)
    .trim();
  return `AI image ${stamp}${words ? ` ${words}` : ""}.${imageExtension(mimeType)}`;
}

/** File extension for an image MIME type (the vault needs one). */
export function imageExtension(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "png";
  }
}

/** Decode base64 to bytes (standard alphabet; whitespace tolerated). */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Pixel size from a PNG, JPEG or WebP header, or null. Used to place the
 * picture at its real aspect ratio without decoding it.
 */
export function imageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const u32 = (i: number): number =>
    ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
  const u16 = (i: number): number => (bytes[i] << 8) | bytes[i + 1];
  const le16 = (i: number): number => bytes[i] | (bytes[i + 1] << 8);
  const le24 = (i: number): number => bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16);
  const ok = (w: number, h: number) => (w > 0 && h > 0 ? { width: w, height: h } : null);

  // PNG: signature, then the IHDR chunk's width and height.
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e) {
    return ok(u32(16), u32(20));
  }

  // JPEG: walk the segments to the first start-of-frame marker.
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1];
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        i += 2;
        continue;
      }
      const isFrame =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrame) return ok(u16(i + 7), u16(i + 5));
      i += 2 + u16(i + 2);
    }
    return null;
  }

  // WebP: RIFF container with a VP8, VP8L or VP8X first chunk.
  const tag = (i: number) =>
    String.fromCharCode(bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]);
  if (bytes.length >= 30 && tag(0) === "RIFF" && tag(8) === "WEBP") {
    const chunk = tag(12);
    if (chunk === "VP8X") return ok(le24(24) + 1, le24(27) + 1);
    if (chunk === "VP8 ") return ok(le16(26) & 0x3fff, le16(28) & 0x3fff);
    if (chunk === "VP8L") {
      const b = (i: number) => bytes[21 + i];
      const w = 1 + (((b(1) & 0x3f) << 8) | b(0));
      const h = 1 + (((b(3) & 0x0f) << 10) | (b(2) << 2) | ((b(1) & 0xc0) >> 6));
      return ok(w, h);
    }
  }
  return null;
}
