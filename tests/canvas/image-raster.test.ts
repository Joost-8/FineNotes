import { describe, expect, it } from "vitest";
import {
  DECODE_BUCKETS,
  JPEG_QUALITY,
  KEEP_SMALL_BYTES,
  attachmentBaseName,
  availablePath,
  bucketSize,
  chooseCachedBucket,
  decodeBucket,
  drawImagePlaceholder,
  extensionForMime,
  extensionOf,
  fitLongSide,
  halvingSteps,
  hasTransparentPixel,
  isHiddenPath,
  isImagePath,
  mayHaveTransparency,
  mimeForExtension,
  normalizeMime,
  parentFolder,
  planImageEncode,
  pngMayHaveAlpha,
  sniffImageMime,
} from "../../src/canvas/image-raster";
import { asCanvasContext, fakeContext } from "./fake-canvas";

function bytesOf(...parts: Array<number[] | string>): Uint8Array {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === "string") for (const ch of part) out.push(ch.charCodeAt(0));
    else out.push(...part);
  }
  return new Uint8Array(out);
}

/** A PNG's signature, its IHDR chunk with `colourType`, then the named chunks. */
function png(colourType: number, ...chunks: string[]): Uint8Array {
  const u32 = (n: number): number[] => [
    (n >>> 24) & 255,
    (n >>> 16) & 255,
    (n >>> 8) & 255,
    n & 255,
  ];
  const ihdr = [...u32(1), ...u32(1), 8, colourType, 0, 0, 0];
  const parts: Array<number[] | string> = [
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    u32(13),
    "IHDR",
    ihdr,
    [0, 0, 0, 0],
  ];
  for (const type of chunks) parts.push(u32(1), type, [0], [0, 0, 0, 0]);
  return bytesOf(...parts);
}

describe("formats", () => {
  it("reads extensions and recognises image paths", () => {
    expect(extensionOf("folder/Photo.JPG")).toBe("jpg");
    expect(extensionOf("folder.png/file")).toBe("");
    expect(extensionOf(".png")).toBe("");
    expect(isImagePath("a/b.webp")).toBe(true);
    expect(isImagePath("a/b.PNG")).toBe(true);
    expect(isImagePath("a/b.pdf")).toBe(false);
    expect(isImagePath("a/b.toString")).toBe(false);
  });

  it("maps extensions to MIME types, and only known ones", () => {
    expect(mimeForExtension("SVG")).toBe("image/svg+xml");
    expect(mimeForExtension("jpeg")).toBe("image/jpeg");
    expect(mimeForExtension("constructor")).toBeNull();
    expect(mimeForExtension("pdf")).toBeNull();
  });

  it("normalises MIME spellings", () => {
    expect(normalizeMime("image/JPG")).toBe("image/jpeg");
    expect(normalizeMime("image/pjpeg")).toBe("image/jpeg");
    expect(normalizeMime("image/x-png")).toBe("image/png");
    expect(normalizeMime(" image/svg+xml; charset=utf-8")).toBe("image/svg+xml");
  });

  it("names the extension to save each format under", () => {
    expect(extensionForMime("image/jpeg")).toBe("jpg");
    expect(extensionForMime("image/png")).toBe("png");
    expect(extensionForMime("image/gif")).toBe("gif");
    expect(extensionForMime("image/webp")).toBe("webp");
    expect(extensionForMime("image/bmp")).toBe("bmp");
    expect(extensionForMime("image/svg+xml")).toBe("svg");
    expect(extensionForMime("image/heic")).toBe("img");
  });

  it("sniffs a format from its first bytes", () => {
    expect(sniffImageMime(png(2))).toBe("image/png");
    expect(sniffImageMime(bytesOf([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageMime(bytesOf("GIF89a"))).toBe("image/gif");
    expect(sniffImageMime(bytesOf("BM", [0, 0, 0, 0]))).toBe("image/bmp");
    expect(sniffImageMime(bytesOf("RIFF", [0, 0, 0, 0], "WEBPVP8 "))).toBe("image/webp");
    expect(sniffImageMime(bytesOf([0, 0, 0, 24], "ftypheic"))).toBe("image/heic");
    expect(sniffImageMime(bytesOf([0, 0, 0, 24], "ftypavif"))).toBe("image/avif");
    expect(sniffImageMime(bytesOf('<?xml version="1.0"?>\n<svg xmlns="x"></svg>'))).toBe(
      "image/svg+xml",
    );
    expect(sniffImageMime(bytesOf("  <svg viewBox='0 0 1 1'/>"))).toBe("image/svg+xml");
    expect(sniffImageMime(bytesOf("hello"))).toBeNull();
    expect(sniffImageMime(new Uint8Array(0))).toBeNull();
  });
});

describe("transparency", () => {
  it("reads whether a PNG can hold alpha from its header", () => {
    expect(pngMayHaveAlpha(png(2, "IDAT", "IEND"))).toBe(false);
    expect(pngMayHaveAlpha(png(0, "IDAT"))).toBe(false);
    expect(pngMayHaveAlpha(png(6, "IDAT"))).toBe(true);
    expect(pngMayHaveAlpha(png(4, "IDAT"))).toBe(true);
    expect(pngMayHaveAlpha(png(3, "PLTE", "tRNS", "IDAT"))).toBe(true);
    // Not a PNG, or cut short: assume it may.
    expect(pngMayHaveAlpha(bytesOf([0xff, 0xd8, 0xff]))).toBe(true);
    expect(pngMayHaveAlpha(png(2))).toBe(true);
  });

  it("finds any pixel that is not fully opaque", () => {
    expect(hasTransparentPixel([0, 0, 0, 255, 9, 9, 9, 255])).toBe(false);
    expect(hasTransparentPixel([0, 0, 0, 255, 9, 9, 9, 254])).toBe(true);
    expect(hasTransparentPixel([])).toBe(false);
  });

  it("only scans the formats that carry alpha", () => {
    expect(mayHaveTransparency("image/png")).toBe(true);
    expect(mayHaveTransparency("image/webp")).toBe(true);
    expect(mayHaveTransparency("image/jpeg")).toBe(false);
    expect(mayHaveTransparency("image/heic")).toBe(false);
  });
});

describe("sizes", () => {
  it("fits the long side, never enlarging", () => {
    expect(fitLongSide(4032, 3024, 2048)).toEqual({ width: 2048, height: 1536 });
    expect(fitLongSide(3024, 4032, 2048)).toEqual({ width: 1536, height: 2048 });
    expect(fitLongSide(800, 600, 2048)).toEqual({ width: 800, height: 600 });
    expect(fitLongSide(0, Number.NaN, 2048)).toEqual({ width: 1, height: 1 });
  });

  it("halves step by step, then lands on the target", () => {
    expect(halvingSteps({ width: 4032, height: 3024 }, { width: 1024, height: 768 })).toEqual([
      { width: 2016, height: 1512 },
      { width: 1024, height: 768 },
    ]);
    expect(halvingSteps({ width: 2048, height: 1024 }, { width: 1024, height: 512 })).toEqual([
      { width: 1024, height: 512 },
    ]);
    expect(halvingSteps({ width: 800, height: 600 }, { width: 800, height: 600 })).toEqual([
      { width: 800, height: 600 },
    ]);
  });
});

describe("planImageEncode", () => {
  const photo = { mime: "image/jpeg", byteLength: 4_000_000, width: 4032, height: 3024 };

  it("leaves GIF and SVG untouched", () => {
    expect(planImageEncode({ ...photo, mime: "image/gif", transparent: true })).toEqual({
      kind: "keep",
      mime: "image/gif",
      ext: "gif",
    });
    expect(planImageEncode({ ...photo, mime: "image/svg+xml", transparent: false }).kind).toBe(
      "keep",
    );
  });

  it("downscales a camera photo to 2048 px JPEG at 0.85", () => {
    expect(planImageEncode({ ...photo, transparent: false })).toEqual({
      kind: "encode",
      mime: "image/jpeg",
      ext: "jpg",
      width: 2048,
      height: 1536,
      quality: JPEG_QUALITY,
    });
  });

  it("keeps a JPEG that already fits, whatever its size", () => {
    expect(
      planImageEncode({
        ...photo,
        width: 1600,
        height: 1200,
        byteLength: 3_000_000,
        transparent: false,
      }),
    ).toEqual({ kind: "keep", mime: "image/jpeg", ext: "jpg" });
  });

  it("keeps PNG for anything transparent", () => {
    const sticker = { mime: "image/png", byteLength: 900_000, width: 900, height: 900 };
    expect(planImageEncode({ ...sticker, transparent: true })).toEqual({
      kind: "keep",
      mime: "image/png",
      ext: "png",
    });
    expect(planImageEncode({ ...sticker, width: 4000, height: 2000, transparent: true })).toEqual({
      kind: "encode",
      mime: "image/png",
      ext: "png",
      width: 2048,
      height: 1024,
    });
    expect(planImageEncode({ ...sticker, mime: "image/webp", transparent: true }).mime).toBe(
      "image/png",
    );
  });

  it("keeps a small opaque PNG or WebP, re-encodes a large one", () => {
    const shot = { mime: "image/png", width: 1200, height: 800, transparent: false };
    expect(planImageEncode({ ...shot, byteLength: KEEP_SMALL_BYTES }).kind).toBe("keep");
    expect(planImageEncode({ ...shot, mime: "image/webp", byteLength: 1000 }).kind).toBe("keep");
    expect(planImageEncode({ ...shot, byteLength: KEEP_SMALL_BYTES + 1 })).toMatchObject({
      kind: "encode",
      mime: "image/jpeg",
      width: 1200,
      height: 800,
    });
  });

  it("always converts formats other platforms may not show", () => {
    const small = { byteLength: 1000, width: 400, height: 300, transparent: false };
    expect(planImageEncode({ ...small, mime: "image/heic" }).kind).toBe("encode");
    expect(planImageEncode({ ...small, mime: "image/bmp" }).kind).toBe("encode");
  });

  it("honours a custom limit", () => {
    expect(planImageEncode({ ...photo, transparent: false }, 1024)).toMatchObject({
      width: 1024,
      height: 768,
    });
  });
});

describe("naming and paths", () => {
  const when = new Date(2026, 8, 22, 15, 30, 12);

  it("keeps a meaningful name, minus its extension", () => {
    expect(attachmentBaseName("IMG_1234.HEIC", when)).toBe("IMG_1234");
    expect(attachmentBaseName("Holiday photo.jpeg", when)).toBe("Holiday photo");
    expect(attachmentBaseName("C:\\Users\\me\\scan.png", when)).toBe("scan");
  });

  it("strips characters Obsidian refuses, and leading dots", () => {
    expect(attachmentBaseName("a/b:c?.png", when)).toBe("b c");
    expect(attachmentBaseName("#tag [x]|y.png", when)).toBe("tag x y");
    expect(attachmentBaseName(".hidden.png", when)).toBe("hidden");
    expect(attachmentBaseName("tab\there.png", when)).toBe("tab here");
  });

  it("names a generic or empty one after the time", () => {
    expect(attachmentBaseName("image.jpg", when)).toBe("Image 20260922-153012");
    expect(attachmentBaseName("", when)).toBe("Image 20260922-153012");
    expect(attachmentBaseName("???.png", when)).toBe("Image 20260922-153012");
  });

  it("spots a path through a dot-folder", () => {
    expect(isHiddenPath(".attachments/a.png")).toBe(true);
    expect(isHiddenPath("notes/.assets/a.png")).toBe(true);
    expect(isHiddenPath("notes/assets/a.png")).toBe(false);
    expect(isHiddenPath(".png")).toBe(false);
  });

  it("picks the first free name", () => {
    const taken = new Set(["notes/Image.jpg", "notes/Image 1.jpg"]);
    expect(availablePath("notes", "Image", "jpg", (p) => taken.has(p))).toBe("notes/Image 2.jpg");
    expect(availablePath("", "Image", "png", () => false)).toBe("Image.png");
    expect(availablePath("notes/", "a", "png", () => false)).toBe("notes/a.png");
    expect(availablePath("/", "a", "png", () => false)).toBe("a.png");
    expect(availablePath("x", "a", "png", () => true)).toMatch(/^x\/a \d+\.png$/);
  });

  it("finds a path's folder", () => {
    expect(parentFolder("a/b/c.md")).toBe("a/b");
    expect(parentFolder("c.md")).toBe("");
  });
});

describe("decode buckets", () => {
  it("rounds the needed size up the ladder, capped", () => {
    expect(decodeBucket(0)).toBe(128);
    expect(decodeBucket(128)).toBe(128);
    expect(decodeBucket(129)).toBe(256);
    expect(decodeBucket(900)).toBe(1024);
    expect(decodeBucket(9000)).toBe(DECODE_BUCKETS[DECODE_BUCKETS.length - 1]);
    expect(decodeBucket(Number.NaN)).toBe(128);
  });

  it("gives a zoom's worth of continuous scales only a handful of keys", () => {
    const keys = new Set<number>();
    for (let zoom = 0.5; zoom <= 8; zoom += 0.001) keys.add(decodeBucket(600 * 2 * zoom));
    expect(keys.size).toBeLessThanOrEqual(DECODE_BUCKETS.length);
  });

  it("uses what is cached when it is good enough", () => {
    expect(chooseCachedBucket([512, 1024], 1024)).toEqual({ use: 1024, decode: false });
    expect(chooseCachedBucket([2048], 1024)).toEqual({ use: 2048, decode: false });
    expect(chooseCachedBucket([2048], 256)).toEqual({ use: 2048, decode: true });
    expect(chooseCachedBucket([128, 256], 1024)).toEqual({ use: 256, decode: true });
    expect(chooseCachedBucket([], 512)).toEqual({ use: null, decode: true });
  });

  it("never enlarges a raster, but draws a vector at the bucket's size", () => {
    expect(bucketSize(4032, 3024, 1024)).toEqual({ width: 1024, height: 768 });
    expect(bucketSize(300, 200, 1024)).toEqual({ width: 300, height: 200 });
    expect(bucketSize(300, 200, 1024, true)).toEqual({ width: 1024, height: 683 });
    expect(bucketSize(0, 0, 256, true)).toEqual({ width: 256, height: 256 });
  });
});

describe("drawImagePlaceholder", () => {
  it("only tints the box while a picture loads", () => {
    const ctx = fakeContext();
    drawImagePlaceholder(asCanvasContext(ctx), 200, 100, false, 1);
    expect(ctx.ops.filter((op) => op.op === "fillRect")).toEqual([
      { op: "fillRect", x: 0, y: 0, w: 200, h: 100, fillStyle: "#8a94a6" },
    ]);
    expect(ctx.ops.some((op) => op.op === "strokeRect")).toBe(false);
    expect(ctx.depth).toBe(0);
  });

  it("marks a missing picture, with a label when there is room", () => {
    const ctx = fakeContext();
    drawImagePlaceholder(asCanvasContext(ctx), 400, 300, true, 0.5, "#123456");
    expect(ctx.ops.some((op) => op.op === "strokeRect")).toBe(true);
    expect(ctx.ops.some((op) => op.op === "fillText" && op.text === "Missing image")).toBe(true);
    expect(ctx.font).not.toContain("var(");
    expect(ctx.depth).toBe(0);
  });

  it("drops the label on a small box, and draws nothing for an empty one", () => {
    const small = fakeContext();
    drawImagePlaceholder(asCanvasContext(small), 60, 40, true, 1);
    expect(small.ops.some((op) => op.op === "fillText")).toBe(false);
    expect(small.depth).toBe(0);
    const empty = fakeContext();
    drawImagePlaceholder(asCanvasContext(empty), 0, 40, true, 1);
    expect(empty.ops).toEqual([]);
  });
});
