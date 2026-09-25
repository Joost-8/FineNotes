/**
 * The decisions behind putting a picture on a page, kept pure so they can be
 * tested: which formats count as images, how big a picked photo is saved and
 * in what format, what it is called, and at which resolution a placed image
 * is decoded for the screen. No vault, no Obsidian; the one function that
 * draws ({@link drawImagePlaceholder}) only calls a 2D context it is handed,
 * as `backdrop.ts` does.
 *
 * ## Why these numbers
 *
 * - **2048 px on the long side** for a saved picture. An iPad camera photo is
 *   12 MP (4032 × 3024, several MB); a notebook syncs, and a page is 1024
 *   page px wide, so 2048 is already twice what the page can show at 100 %.
 * - **JPEG at 0.85** for everything opaque that has to be re-encoded: a
 *   2048 px photo lands around 400–700 KB. A picture with any transparent
 *   pixel stays PNG, so a cut-out or a sticker keeps its see-through parts.
 * - **GIF and SVG are never touched.** Re-encoding would flatten an
 *   animation or rasterise a vector drawing for no saving.
 * - **Decode buckets are powers of two.** The screen needs a placed image at
 *   `longSide × devicePixelRatio × zoom` pixels, which a pinch varies
 *   continuously; a cache keyed on that would mint a bitmap per frame (see
 *   the ledger on quantising cache keys), so it is rounded up the ladder.
 */

/** Extensions offered by "From vault" and recognised as images. */
export const IMAGE_EXTENSIONS: readonly string[] = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "svg",
];

/** Longest side, in pixels, a picked picture is saved at. */
export const MAX_IMAGE_LONG_SIDE = 2048;
/** JPEG quality for re-encoded pictures. */
export const JPEG_QUALITY = 0.85;
/**
 * A web-safe picture already within {@link MAX_IMAGE_LONG_SIDE} and at most
 * this many bytes is saved as it came: re-encoding could only lose quality.
 */
export const KEEP_SMALL_BYTES = 512 * 1024;

/** Resolutions (long side, device px) a placed image is decoded at. */
export const DECODE_BUCKETS: readonly number[] = [128, 256, 512, 1024, 2048];
/**
 * A cached decode up to this many times larger than needed is drawn as is;
 * beyond it, minifying aliases visibly, so the right size is decoded too.
 */
const OVERSIZE_TOLERANCE = 4;

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
};

/** Formats every Obsidian platform displays, so they may be saved unconverted. */
const WEB_SAFE = new Set(["image/jpeg", "image/png", "image/webp"]);

/** The lower-cased extension of a path or file name, without the dot. */
export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/** Whether a vault path names an image this plugin can place. */
export function isImagePath(path: string): boolean {
  return Object.prototype.hasOwnProperty.call(MIME_BY_EXTENSION, extensionOf(path));
}

/** The MIME type for an image extension, or `null` for anything else. */
export function mimeForExtension(ext: string): string | null {
  const key = ext.toLowerCase();
  return Object.prototype.hasOwnProperty.call(MIME_BY_EXTENSION, key)
    ? MIME_BY_EXTENSION[key]
    : null;
}

/** Canonical MIME type: lower-cased, parameters dropped, `image/jpg` read as JPEG. */
export function normalizeMime(mime: string): string {
  const base = mime.split(";")[0].trim().toLowerCase();
  if (base === "image/jpg" || base === "image/pjpeg") return "image/jpeg";
  if (base === "image/x-png") return "image/png";
  return base;
}

/** The file extension to save a MIME type under. */
export function extensionForMime(mime: string): string {
  switch (normalizeMime(mime)) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    case "image/bmp":
      return "bmp";
    case "image/svg+xml":
      return "svg";
    default:
      return "img";
  }
}

/**
 * The MIME type from a file's first bytes, or `null` if unrecognised. A
 * picked file's own type can be empty (iOS hands some photos over without
 * one), and a wrong type would save a PNG as `.jpg`.
 */
export function sniffImageMime(bytes: Uint8Array): string | null {
  const at = (i: number): number => bytes[i] ?? -1;
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return "image/png";
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) return "image/gif";
  if (at(0) === 0x42 && at(1) === 0x4d) return "image/bmp";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";
  if (ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4);
    if (brand === "avif" || brand === "avis") return "image/avif";
    if (/^(heic|heix|hevc|mif1|msf1)$/.test(brand)) return "image/heic";
  }
  const head = ascii(bytes, 0, Math.min(bytes.length, 512)).trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) {
    return "image/svg+xml";
  }
  return null;
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let out = "";
  for (let i = start; i < start + length && i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

/**
 * Whether a PNG can hold transparency at all: an alpha channel (colour type 4
 * or 6) or a `tRNS` chunk before the image data. `false` lets the caller skip
 * scanning every pixel. Anything that is not a readable PNG answers `true`.
 */
export function pngMayHaveAlpha(bytes: Uint8Array): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 33 || signature.some((b, i) => bytes[i] !== b)) return true;
  const colourType = bytes[25];
  if (colourType === 4 || colourType === 6) return true;
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length =
      ((bytes[offset] << 24) |
        (bytes[offset + 1] << 16) |
        (bytes[offset + 2] << 8) |
        bytes[offset + 3]) >>>
      0;
    const type = ascii(bytes, offset + 4, 4);
    if (type === "tRNS") return true;
    if (type === "IDAT" || type === "IEND") return false;
    offset += 12 + length;
  }
  return true;
}

/** Whether any pixel of RGBA data is less than fully opaque. */
export function hasTransparentPixel(rgba: ArrayLike<number>): boolean {
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] < 255) return true;
  }
  return false;
}

/** Formats whose decoded pixels are worth scanning for transparency. */
export function mayHaveTransparency(mime: string): boolean {
  const m = normalizeMime(mime);
  return m === "image/png" || m === "image/webp" || m === "image/avif" || m === "image/bmp";
}

/** Scale `width × height` down so the long side is at most `max`; never up. */
export function fitLongSide(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  const w = width > 0 && Number.isFinite(width) ? width : 1;
  const h = height > 0 && Number.isFinite(height) ? height : 1;
  const k = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

/**
 * Intermediate sizes for a good downscale: halve while halving still stays at
 * or above the target, then land on it. One `drawImage` from 4032 px straight
 * to 1024 samples too few source pixels and shimmers; halving steps do not.
 */
export function halvingSteps(
  from: { width: number; height: number },
  to: { width: number; height: number },
): Array<{ width: number; height: number }> {
  const steps: Array<{ width: number; height: number }> = [];
  let w = from.width;
  let h = from.height;
  while (w / 2 >= to.width && h / 2 >= to.height && steps.length < 16) {
    w = Math.round(w / 2);
    h = Math.round(h / 2);
    steps.push({ width: w, height: h });
  }
  const last = steps[steps.length - 1];
  if (!last || last.width !== to.width || last.height !== to.height) {
    steps.push({ width: to.width, height: to.height });
  }
  return steps;
}

export interface EncodeInput {
  /** The picked file's MIME type (sniffed when the file had none). */
  mime: string;
  byteLength: number;
  /** Decoded size, px. */
  width: number;
  height: number;
  /** Whether any decoded pixel is transparent. */
  transparent: boolean;
}

export type EncodePlan =
  | { kind: "keep"; mime: string; ext: string }
  | {
      kind: "encode";
      mime: "image/jpeg" | "image/png";
      ext: "jpg" | "png";
      width: number;
      height: number;
      /** JPEG only. */
      quality?: number;
    };

/**
 * How to save a picked picture (see the module notes for the numbers):
 *
 * 1. GIF and SVG: as they came.
 * 2. Any transparency: PNG, downscaled if too big — an untouched PNG that
 *    already fits is kept byte for byte.
 * 3. Opaque and already small enough: a JPEG is kept as is (re-encoding it
 *    only loses quality), and so is a small PNG or WebP.
 * 4. Everything else — big photos, HEIC, BMP — JPEG at 0.85, downscaled.
 */
export function planImageEncode(input: EncodeInput, maxLongSide = MAX_IMAGE_LONG_SIDE): EncodePlan {
  const mime = normalizeMime(input.mime);
  if (mime === "image/gif" || mime === "image/svg+xml") {
    return { kind: "keep", mime, ext: extensionForMime(mime) };
  }
  const fit = fitLongSide(input.width, input.height, maxLongSide);
  const scaled = fit.width !== Math.round(input.width) || fit.height !== Math.round(input.height);
  if (input.transparent) {
    if (!scaled && mime === "image/png") return { kind: "keep", mime, ext: "png" };
    return { kind: "encode", mime: "image/png", ext: "png", ...fit };
  }
  if (!scaled && mime === "image/jpeg") return { kind: "keep", mime, ext: "jpg" };
  if (!scaled && WEB_SAFE.has(mime) && input.byteLength <= KEEP_SMALL_BYTES) {
    return { kind: "keep", mime, ext: extensionForMime(mime) };
  }
  return { kind: "encode", mime: "image/jpeg", ext: "jpg", ...fit, quality: JPEG_QUALITY };
}

/** Characters Obsidian refuses in a file name, or that break a wikilink. */
const UNSAFE_NAME = /[\\/:*?"<>|#^[\]]/g;
/** Names cameras and pickers give every picture; they say nothing. */
const GENERIC_NAME = /^(image|photo|img|picture|capture|pasted image|untitled)$/i;

/**
 * A readable base name (no extension) for a saved picture: the picked file's
 * own name, cleaned, or `Image 20260922-153012` when that name is missing or
 * generic (the iPad camera calls every photo "image.jpg").
 */
export function attachmentBaseName(suggested: string, now: Date): string {
  const leaf = suggested.slice(
    Math.max(suggested.lastIndexOf("/"), suggested.lastIndexOf("\\")) + 1,
  );
  const dot = leaf.lastIndexOf(".");
  const printable = Array.from(dot > 0 ? leaf.slice(0, dot) : leaf)
    .map((ch) => (ch.charCodeAt(0) < 32 ? " " : ch))
    .join("");
  const stem = printable
    .replace(UNSAFE_NAME, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 80)
    .trim();
  if (stem && !GENERIC_NAME.test(stem)) return stem;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    `Image ${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

/**
 * Whether a vault path runs through a dot-folder. Obsidian does not index
 * those, so a picture saved there could never be found again.
 */
export function isHiddenPath(path: string): boolean {
  return path
    .split("/")
    .slice(0, -1)
    .some((segment) => segment.startsWith("."));
}

/** `folder/base.ext`, or `folder/base 1.ext`, `… 2.ext` — the first that does not exist. */
export function availablePath(
  folder: string,
  base: string,
  ext: string,
  exists: (path: string) => boolean,
): string {
  const prefix = folder && folder !== "/" ? `${folder.replace(/\/+$/, "")}/` : "";
  for (let i = 0; i < 10000; i++) {
    const path = `${prefix}${i === 0 ? base : `${base} ${i}`}.${ext}`;
    if (!exists(path)) return path;
  }
  return `${prefix}${base} ${Date.now()}.${ext}`;
}

/** The parent folder of a vault path, `""` for the vault root. */
export function parentFolder(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash <= 0 ? "" : path.slice(0, slash);
}

/** The decode bucket for an image that covers `devicePx` device px on its long side. */
export function decodeBucket(devicePx: number): number {
  const need = Number.isFinite(devicePx) ? devicePx : 0;
  for (const bucket of DECODE_BUCKETS) if (bucket >= need) return bucket;
  return DECODE_BUCKETS[DECODE_BUCKETS.length - 1];
}

/**
 * Which cached decode to draw for a wanted bucket, and whether the wanted one
 * still needs decoding. The exact bucket, or a larger one that is not wildly
 * larger, is good as it is. Otherwise the best stand-in is drawn — the
 * largest smaller decode, else a much larger one — while the right size is
 * decoded.
 */
export function chooseCachedBucket(
  available: Iterable<number>,
  wanted: number,
): { use: number | null; decode: boolean } {
  let larger = Infinity;
  let smaller = -Infinity;
  for (const bucket of available) {
    if (bucket === wanted) return { use: wanted, decode: false };
    if (bucket > wanted) larger = Math.min(larger, bucket);
    else smaller = Math.max(smaller, bucket);
  }
  if (larger !== Infinity && larger <= wanted * OVERSIZE_TOLERANCE) {
    return { use: larger, decode: false };
  }
  if (smaller !== -Infinity) return { use: smaller, decode: true };
  if (larger !== Infinity) return { use: larger, decode: true };
  return { use: null, decode: true };
}

/**
 * The pixel size a bucket decodes an image of natural size `width × height`
 * to. A raster is never enlarged past its own pixels — that only adds bytes;
 * a `vector` picture (SVG) is drawn at the bucket's size either way, since it
 * is sharp at any size.
 */
export function bucketSize(
  width: number,
  height: number,
  bucket: number,
  vector = false,
): { width: number; height: number } {
  if (!vector) return fitLongSide(width, height, bucket);
  const w = width > 0 && Number.isFinite(width) ? width : 1;
  const h = height > 0 && Number.isFinite(height) ? height : 1;
  const k = bucket / Math.max(w, h);
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

/** Canvas font for the placeholder label. Real families: `var(--…)` is ignored here. */
const PLACEHOLDER_FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/**
 * Stand-in for a placed image with no pixels to show, drawn into the box
 * `(0, 0, w, h)` of `ctx`'s current space. `px` is one device pixel in that
 * space, so strokes stay hairlines at any zoom.
 *
 * While the picture is still loading this is only a faint tint. A missing or
 * unreadable file gets a dashed frame, a small crossed-out picture and — room
 * permitting — "Missing image", so the gap reads as a lost attachment rather
 * than a blank area. The element itself is always kept: an image that fails to
 * resolve must never cost the page its place, as a PDF backdrop never costs
 * the ink over it.
 */
export function drawImagePlaceholder(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  missing: boolean,
  px: number,
  color = "#8a94a6",
): void {
  if (!(w > 0) || !(h > 0)) return;
  const unit = px > 0 && Number.isFinite(px) ? px : 1;
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = missing ? 0.1 : 0.06;
  ctx.fillRect(0, 0, w, h);
  if (!missing) {
    ctx.restore();
    return;
  }
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = color;
  ctx.lineWidth = unit * 1.5;
  ctx.setLineDash([unit * 6, unit * 4]);
  ctx.strokeRect(unit, unit, w - 2 * unit, h - 2 * unit);
  ctx.setLineDash([]);

  // A small picture frame with a mountain, crossed out.
  const s = Math.min(w, h, unit * 40) * 0.5;
  const cx = w / 2;
  const cy = h / 2 - (h > s * 3 ? s * 0.4 : 0);
  ctx.lineWidth = unit * 1.5;
  ctx.strokeRect(cx - s / 2, cy - s / 2.5, s, (s * 4) / 5);
  ctx.beginPath();
  ctx.moveTo(cx - s / 2, cy + s / 2.5);
  ctx.lineTo(cx - s / 8, cy);
  ctx.lineTo(cx + s / 2, cy + s / 2.5);
  ctx.moveTo(cx - s / 1.6, cy - s / 1.6);
  ctx.lineTo(cx + s / 1.6, cy + s / 1.6);
  ctx.stroke();

  const size = unit * 13;
  if (w > size * 9 && h > s * 3) {
    ctx.fillStyle = color;
    ctx.font = `${size}px ${PLACEHOLDER_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("Missing image", cx, cy + s / 2.5 + size * 0.8);
  }
  ctx.restore();
}
