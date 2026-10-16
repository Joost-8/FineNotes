/**
 * Saber notes (`.sbn2`, `.sbn`, `.sba`) as FineNotes documents. Pure.
 *
 * Read from Saber's own loader (saber-notes/saber, file format version 19,
 * 2026-10); no code of Saber's is used. A note is one map, BSON in `.sbn2`
 * and JSON in the older `.sbn`:
 *
 * - `v` format version; `b` paper colour (ARGB int); `p` background pattern
 *   (`""`, `college`, `college-rtl`, `lined`, `grid`, `dots`, `staffs`,
 *   `tablature`, `cornell`); `l` line height (default 40); `z` the pages.
 * - A page is `{w, h, s: strokes, i: images, q: Quill delta, b: background
 *   image}`, 1000 × 1400 units by default. Before version 8 the strokes and
 *   images sat at the top level (`s`, `i`) with a page index `i` each, and
 *   `z` held `[w, h]` pairs; before that the whole note was a list of strokes.
 * - A stroke is `{p: points, ty: tool, c: ARGB colour, pe: pressure on,
 *   s: size (default 10), t: thinning (default 0.5), ox, oy: offset}`. A
 *   point is a binary of float32 x, y and an optional pressure (version 13
 *   on), or `{x, y, p}`. `shape: "circle"` stores `cx, cy, r` and
 *   `shape: "rect"` stores `rl, rt, rw, rh` instead of points. The stroke is
 *   drawn by perfect-freehand, `2·s·(0.5 − t·(0.5 − p))` wide.
 * - An image is `{e: extension, x, y, w, h, sx, sy, sw, sh, nw, nh, a}`, `a`
 *   indexing an asset; `.pdf` images add `pdfi`, the PDF's page. Since
 *   version 19 asset `n` is a file of its own next to the note
 *   (`<note>.sbn2.n`, `main.sbn2.n` in a `.sba` zip); before, the note held
 *   them in a top-level list `a`.
 *
 * A page whose background is a PDF page becomes a PDF backdrop. Typed text
 * comes over as plain text in one text box per page. SVG pictures and PDFs
 * placed on a page are reported, not converted.
 */

import type {
  ImageCrop,
  ImageElement,
  InkDocument,
  Page,
  Ruling,
  Stroke,
  SyntheticBackdrop,
  TextBoxElement,
} from "../model/document";
import { SCHEMA_VERSION } from "../constants";
import { looksLikeBson, readBson, type BsonValue } from "./bson";
import {
  hexColor,
  median,
  packageRoot,
  pageScale,
  pressureForWidth,
  round2,
  sniffFile,
  type ImportAttachment,
  type ImportResult,
} from "./import-types";

export class SaberError extends Error {}

/** The newest file format version this reader knows. */
export const SABER_VERSION = 19;

/** Saber's default page, in its units: 1000 × 1400, read as A4's 210 mm across. */
export const SABER_PAGE = { width: 1000, height: 1400 };

/** Page px per Saber unit. */
export const SABER_SCALE = pageScale(SABER_PAGE.width, 210);

/** Saber's defaults for what a file leaves out. */
const DEFAULT_LINE_HEIGHT = 40;
const DEFAULT_SIZE = 10;
const DEFAULT_THINNING = 0.5;
const DEFAULT_COLOR = 0xff000000;

/** Below this opacity a pen stroke is taken for the highlighter. */
const HIGHLIGHTER_ALPHA = 0.95 * 255;

/** Points round a converted circle: FineNotes' circle layout, every 11.25°. */
const CIRCLE_POINTS = 33;

/** Saber's background patterns, by their stored names, as FineNotes rulings. */
const PATTERNS: ReadonlyMap<string, Ruling> = new Map<string, Ruling>([
  ["college", "legal"],
  ["college-rtl", "ruled-wide"],
  ["lined", "ruled-wide"],
  ["grid", "squared"],
  ["dots", "dotted"],
  ["staffs", "music"],
  ["tablature", "guitar-tab"],
  ["cornell", "cornell"],
]);

type Dict = { [key: string]: BsonValue };

/** Whether the bytes are a Saber note: `.sbn2` BSON or `.sbn` JSON. */
export function isSaber(bytes: Uint8Array): boolean {
  const root = parse(bytes);
  return root !== undefined && isSaberRoot(root);
}

/** Whether a set of zip entries is a Saber archive (`.sba`). */
export function isSaberArchive(files: ReadonlyMap<string, Uint8Array>): boolean {
  return packageRoot(files, "main.sbn2") !== null;
}

/** Convert a `.sba`, given its zip entries: `main.sbn2` and its assets `main.sbn2.0`, …. */
export function readSaberArchive(
  files: ReadonlyMap<string, Uint8Array>,
  fallbackTitle: string,
): ImportResult {
  const root = packageRoot(files, "main.sbn2");
  if (root === null) throw new SaberError("not a Saber archive");
  const main = `${root}main.sbn2`;
  const assets = new Map<string, Uint8Array>();
  for (const [name, bytes] of files) {
    if (name.startsWith(`${main}.`)) assets.set(name.slice(main.length + 1), bytes);
  }
  return readSaber(files.get(main) ?? new Uint8Array(), fallbackTitle, assets);
}

/**
 * Convert one note. `assets` holds the files stored next to it, keyed by
 * their index (`"0"`) or by their file name (`Note.sbn2.0`); a note from
 * before version 19 carries its own.
 */
export function readSaber(
  bytes: Uint8Array,
  fallbackTitle: string,
  assets: ReadonlyMap<string, Uint8Array> = new Map(),
): ImportResult {
  const root = parse(bytes);
  if (root === undefined || !isSaberRoot(root)) throw new SaberError("not a Saber note");
  return new Converter(root, fallbackTitle, assets).run();
}

/** The note's root value, or `undefined` when the bytes are neither BSON nor JSON. */
function parse(bytes: Uint8Array): BsonValue | undefined {
  if (looksLikeBson(bytes)) {
    try {
      return readBson(bytes);
    } catch {
      return undefined;
    }
  }
  let first = 0;
  while (first < bytes.length && /\s/.test(String.fromCharCode(bytes[first]))) first++;
  if (bytes[first] !== 0x7b && bytes[first] !== 0x5b) return undefined;
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as BsonValue;
  } catch {
    return undefined;
  }
}

function isSaberRoot(root: BsonValue): boolean {
  if (Array.isArray(root)) {
    return root.length > 0 && root.every((s) => isDict(s) && Array.isArray(get(s, "p")));
  }
  if (!isDict(root)) return false;
  return (
    Array.isArray(get(root, "z")) ||
    (typeof get(root, "v") === "number" && Array.isArray(get(root, "s")))
  );
}

interface RawPage {
  width: number;
  height: number;
  strokes: Dict[];
  images: Dict[];
  quill: BsonValue[] | null;
  background: Dict | null;
}

class Converter {
  private readonly title: string;
  private readonly version: number;
  private readonly inline: BsonValue[] | null;
  private readonly attachments: ImportAttachment[] = [];
  /** Attachment names by asset index, so a PDF behind many pages is saved once. */
  private readonly attached = new Map<number, string>();
  private readonly k = SABER_SCALE;
  private strokeN = 0;
  private imageN = 0;
  private textN = 0;
  private unreadable = 0;
  private missingPictures = 0;
  private missingPdfs = 0;
  private skipped = 0;
  private formatted = false;

  constructor(
    private readonly root: BsonValue,
    fallbackTitle: string,
    private readonly assets: ReadonlyMap<string, Uint8Array>,
  ) {
    this.title = fallbackTitle;
    this.version = isDict(root) ? (num(get(root, "v")) ?? 0) : 0;
    const inline = isDict(root) ? get(root, "a") : undefined;
    this.inline = Array.isArray(inline) ? inline : null;
  }

  run(): ImportResult {
    const root = this.root;
    const settings = isDict(root) ? root : null;
    const rawPages = collectPages(root);
    const lineHeight = positive(settings && get(settings, "l")) ?? DEFAULT_LINE_HEIGHT;
    const paper = this.paper(settings, lineHeight);

    const pages = rawPages.map((raw, index) => this.page(raw, index, paper, lineHeight));

    const warnings: string[] = [];
    if (this.version > SABER_VERSION) {
      warnings.push(
        "This note was saved by a newer version of Saber; some of it may not have come over.",
      );
    }
    if (this.unreadable > 0)
      warnings.push(`${plural(this.unreadable, "stroke")} could not be read.`);
    if (this.missingPictures > 0) {
      warnings.push(
        `${plural(this.missingPictures, "picture was", "pictures were")} not found in the file. ` +
          "Export the note from Saber as a .sba file to bring pictures over.",
      );
    }
    if (this.missingPdfs > 0) {
      warnings.push(
        `${plural(this.missingPdfs, "page is", "pages are")} drawn on a PDF that was not found ` +
          "in the file; they were left blank.",
      );
    }
    if (this.skipped > 0) {
      warnings.push(
        `${plural(this.skipped, "item")} (SVG pictures or PDFs placed on a page) could not be brought over yet.`,
      );
    }
    if (this.formatted)
      warnings.push("Typed text came over as plain text; its formatting was not brought over.");

    const doc: InkDocument = {
      version: SCHEMA_VERSION,
      view: { scrollY: 0, width: pages[0].geometry.width, scale: 1 },
      pages,
    };
    return {
      source: "saber",
      title: this.title,
      doc,
      attachments: this.attachments,
      warnings,
    };
  }

  /** The paper every page shares: Saber keeps the pattern and colour per note. */
  private paper(settings: Dict | null, lineHeight: number): SyntheticBackdrop {
    const pattern = settings ? get(settings, "p") : undefined;
    const kind = typeof pattern === "string" ? PATTERNS.get(pattern) : undefined;
    const backdrop: SyntheticBackdrop = kind
      ? { kind, spacing: round2(lineHeight * this.k) }
      : { kind: "blank" };
    const colour = settings ? num(get(settings, "b")) : undefined;
    if (colour !== undefined) {
      const hex = argbHex(colour);
      if (hex !== "#ffffff") backdrop.paperColor = hex;
    }
    return backdrop;
  }

  private page(raw: RawPage, index: number, paper: SyntheticBackdrop, lineHeight: number): Page {
    const k = this.k;
    const width = Math.round(raw.width * k);
    const height = Math.round(raw.height * k);
    const page: Page = {
      id: `p${index + 1}`,
      kind: "ink",
      geometry: { width, height },
      backdrop: { ...paper },
      strokes: [],
      images: [],
      textBoxes: [],
    };

    if (raw.background) this.background(raw.background, page);
    for (const s of raw.strokes) {
      const stroke = this.stroke(s);
      if (stroke) page.strokes.push(stroke);
      else this.unreadable++;
    }
    for (const d of raw.images) {
      const image = this.image(d);
      if (image) page.images.push(image);
    }
    if (raw.quill) {
      const box = this.text(raw.quill, width, lineHeight);
      if (box) page.textBoxes.push(box);
    }
    return page;
  }

  /** A page's background image: a PDF page becomes the paper, a picture is laid under the ink. */
  private background(d: Dict, page: Page): void {
    const isPdf = get(d, "e") === ".pdf";
    const bytes = this.bytes(d);
    if (isPdf) {
      const path = bytes ? this.attach(bytes, assetIndex(d), "pdf") : null;
      if (path) page.backdrop = { kind: "pdf", path, page: Math.max(0, num(get(d, "pdfi")) ?? 0) };
      else this.missingPdfs++;
      return;
    }
    if (!bytes) {
      this.missingPictures++;
      return;
    }
    const path = this.attach(bytes, assetIndex(d), "picture");
    const { width, height } = page.geometry;
    let w = width;
    let h = height;
    const nw = positive(get(d, "nw"));
    const nh = positive(get(d, "nh"));
    const fit = num(get(d, "f")) ?? 1;
    // BoxFit.contain (1) and scaleDown (6) keep the picture's shape; the rest fill the page.
    if (nw && nh && (fit === 1 || fit === 6)) {
      const s = Math.min(width / nw, height / nh);
      w = nw * s;
      h = nh * s;
    }
    page.images.push({
      id: `i${++this.imageN}`,
      path,
      x: round2((width - w) / 2),
      y: round2((height - h) / 2),
      w: round2(w),
      h: round2(h),
      locked: true,
    });
  }

  private image(d: Dict): ImageElement | null {
    const ext = get(d, "e");
    if (ext === ".svg" || ext === ".pdf") {
      this.skipped++;
      return null;
    }
    const bytes = this.bytes(d);
    if (!bytes) {
      this.missingPictures++;
      return null;
    }
    const k = this.k;
    const w = positive(get(d, "w"));
    const h = positive(get(d, "h"));
    if (!w || !h) {
      this.skipped++;
      return null;
    }
    const image: ImageElement = {
      id: `i${++this.imageN}`,
      path: this.attach(bytes, assetIndex(d), "picture"),
      x: round2((num(get(d, "x")) ?? 0) * k),
      y: round2((num(get(d, "y")) ?? 0) * k),
      w: round2(w * k),
      h: round2(h * k),
    };
    const crop = cropOf(d);
    if (crop) image.crop = crop;
    return image;
  }

  /** The bytes behind an image: an asset by index, or (in old notes) the image's own `b`. */
  private bytes(d: Dict): Uint8Array | null {
    const index = assetIndex(d);
    if (index !== null) {
      const own = this.inline ? toBytes(this.inline[index]) : this.external(index);
      return own && own.length > 0 ? own : null;
    }
    const b = toBytes(get(d, "b"));
    return b && b.length > 0 ? b : null;
  }

  private external(index: number): Uint8Array | null {
    const direct = this.assets.get(String(index));
    if (direct) return direct;
    for (const [name, bytes] of this.assets) {
      if (/\.sbn2?\.\d+$/.test(name) && name.endsWith(`.${index}`)) return bytes;
    }
    return null;
  }

  private attach(bytes: Uint8Array, index: number | null, label: string): string {
    const known = index === null ? undefined : this.attached.get(index);
    if (known) return known;
    const { mime, ext } = sniffFile(bytes);
    const name = `${this.title} - ${label} ${this.attachments.length + 1}.${ext}`;
    this.attachments.push({ name, bytes, mime });
    if (index !== null) this.attached.set(index, name);
    return name;
  }

  private stroke(d: Dict): Stroke | null {
    const k = this.k;
    const shape = get(d, "shape");
    const argb = (num(get(d, "c")) ?? DEFAULT_COLOR) >>> 0;
    const alpha = argb >>> 24;
    const size = positive(get(d, "s")) ?? DEFAULT_SIZE;
    const thinning = num(get(d, "t")) ?? DEFAULT_THINNING;
    const highlighter = get(d, "ty") === "Highlighter" || alpha < HIGHLIGHTER_ALPHA;
    const base = {
      id: `s${this.strokeN + 1}`,
      color: argbHex(argb),
      tool: highlighter ? ("highlighter" as const) : ("pen" as const),
    };

    if (shape === "circle" || shape === "rect") {
      const outline = shape === "circle" ? circlePoints(d) : rectPoints(d);
      if (!outline) return null;
      const pts: number[] = [];
      for (const [x, y] of outline) pts.push(round2(x * k), round2(y * k), 0.5);
      this.strokeN++;
      return { ...base, size: round2(Math.max(0.1, size * k)), pts, shape };
    }
    if (shape !== undefined && shape !== null) return null;

    const points = get(d, "p");
    if (!Array.isArray(points)) return null;
    const ox = num(get(d, "ox")) ?? 0;
    const oy = num(get(d, "oy")) ?? 0;
    const pressureOn = get(d, "pe") !== false;
    const read: Array<[number, number, number | undefined]> = [];
    for (const p of points) {
      const point = pointOf(p);
      if (point) read.push([point[0] + ox, point[1] + oy, pressureOn ? point[2] : undefined]);
    }
    if (read.length === 0) return null;

    // The width perfect-freehand draws at each point, in page px.
    const widthAt = (p: number | undefined): number =>
      p === undefined ? size * k : Math.max(0, 2 * size * (0.5 - thinning * (0.5 - p))) * k;
    const widths = read.map(([, , p]) => widthAt(p));
    const nib = round2(Math.max(0.1, median(widths)));
    const pts: number[] = [];
    for (let i = 0; i < read.length; i++) {
      const [x, y, p] = read[i];
      pts.push(
        round2(x * k),
        round2(y * k),
        p === undefined ? 0.5 : pressureForWidth(widths[i], nib),
      );
    }
    this.strokeN++;
    return { ...base, size: nib, pts };
  }

  /** A page's Quill text as one plain text box where Saber lays it out. */
  private text(ops: BsonValue[], pageWidth: number, lineHeight: number): TextBoxElement | null {
    let text = "";
    for (const op of ops) {
      if (!isDict(op)) continue;
      const insert = get(op, "insert");
      if (typeof insert === "string") text += insert;
      else if (insert !== undefined) this.formatted = true;
      if (isDict(get(op, "attributes"))) this.formatted = true;
    }
    text = text.replace(/\s+$/, "");
    if (text === "") return null;
    const lh = lineHeight * this.k;
    return {
      id: `t${++this.textN}`,
      x: round2(lh * 0.5),
      y: round2(lh * 1.2),
      w: round2(Math.max(80, pageWidth - lh)),
      text,
      color: "#000000",
      fontSize: round2(Math.max(12, lh)),
      lineHeight: 1,
    };
  }
}

/** The pages of a note, whichever version wrote it, with every stroke and image in place. */
function collectPages(root: BsonValue): RawPage[] {
  const pages: RawPage[] = [];
  const blank = (width = SABER_PAGE.width, height = SABER_PAGE.height): RawPage => ({
    width,
    height,
    strokes: [],
    images: [],
    quill: null,
    background: null,
  });
  let fallback = { width: SABER_PAGE.width, height: SABER_PAGE.height };
  let looseStrokes: BsonValue[] = [];
  let looseImages: BsonValue[] = [];

  if (Array.isArray(root)) looseStrokes = root;
  else if (isDict(root)) {
    const w = positive(get(root, "w"));
    const h = positive(get(root, "h"));
    if (w && h) fallback = { width: w, height: h };
    const z = get(root, "z");
    for (const p of Array.isArray(z) ? z : []) {
      if (Array.isArray(p)) {
        pages.push(blank(positive(p[0]) ?? SABER_PAGE.width, positive(p[1]) ?? SABER_PAGE.height));
      } else if (isDict(p)) {
        const page = blank(
          positive(get(p, "w")) ?? SABER_PAGE.width,
          positive(get(p, "h")) ?? SABER_PAGE.height,
        );
        page.strokes = dicts(get(p, "s"));
        page.images = dicts(get(p, "i"));
        const q = get(p, "q");
        page.quill = Array.isArray(q) ? q : null;
        const b = get(p, "b");
        page.background = isDict(b) ? b : null;
        pages.push(page);
      }
    }
    looseStrokes = arrayOf(get(root, "s"));
    looseImages = arrayOf(get(root, "i"));
  }

  // Before version 8 strokes and images carried their page index.
  const place = (item: Dict): RawPage => {
    const index = Math.max(0, Math.min(9999, Math.floor(num(get(item, "i")) ?? 0)));
    while (pages.length <= index) pages.push(blank(fallback.width, fallback.height));
    return pages[index];
  };
  for (const s of dicts(looseStrokes)) place(s).strokes.push(s);
  for (const i of dicts(looseImages)) place(i).images.push(i);

  // Saber keeps an empty page at the end of every note to write on next.
  while (pages.length > 1 && isEmpty(pages[pages.length - 1])) pages.pop();
  if (pages.length === 0) pages.push(blank(fallback.width, fallback.height));
  return pages;
}

function isEmpty(page: RawPage): boolean {
  return (
    page.strokes.length === 0 &&
    page.images.length === 0 &&
    page.background === null &&
    (page.quill === null || page.quill.every((op) => isDict(op) && get(op, "insert") === "\n"))
  );
}

/** A point: float32 x, y and maybe a pressure in a binary, or `{x, y, p}`. */
function pointOf(p: BsonValue): [number, number, number | undefined] | null {
  let x: number | undefined;
  let y: number | undefined;
  let pressure: number | undefined;
  if (p instanceof Uint8Array) {
    if (p.length < 8) return null;
    const view = new DataView(p.buffer, p.byteOffset, p.byteLength);
    x = view.getFloat32(0, true);
    y = view.getFloat32(4, true);
    if (p.length >= 12) pressure = view.getFloat32(8, true);
  } else if (isDict(p)) {
    x = num(get(p, "x"));
    y = num(get(p, "y"));
    pressure = num(get(p, "p"));
  }
  if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (pressure === undefined || !Number.isFinite(pressure) || pressure < 0)
    return [x, y, undefined];
  return [x, y, Math.min(1, pressure)];
}

function circlePoints(d: Dict): Array<[number, number]> | null {
  const cx = num(get(d, "cx")) ?? 0;
  const cy = num(get(d, "cy")) ?? 0;
  const r = positive(get(d, "r"));
  if (!r) return null;
  const out: Array<[number, number]> = [];
  for (let i = 0; i < CIRCLE_POINTS; i++) {
    const a = (i / (CIRCLE_POINTS - 1)) * 2 * Math.PI;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

function rectPoints(d: Dict): Array<[number, number]> | null {
  const l = num(get(d, "rl")) ?? 0;
  const t = num(get(d, "rt")) ?? 0;
  const w = positive(get(d, "rw"));
  const h = positive(get(d, "rh"));
  if (!w || !h) return null;
  return [
    [l, t],
    [l + w, t],
    [l + w, t + h],
    [l, t + h],
    [l, t],
  ];
}

/** An image's crop, as fractions of its natural size, when it shows less than the whole. */
function cropOf(d: Dict): ImageCrop | undefined {
  const nw = positive(get(d, "nw"));
  const nh = positive(get(d, "nh"));
  const sw = positive(get(d, "sw"));
  const sh = positive(get(d, "sh"));
  if (!nw || !nh || !sw || !sh) return undefined;
  const clamp = (v: number): number => Math.max(0, Math.min(1, v));
  const x = clamp((num(get(d, "sx")) ?? 0) / nw);
  const y = clamp((num(get(d, "sy")) ?? 0) / nh);
  const crop = {
    x: round4(x),
    y: round4(y),
    w: round4(Math.min(1 - x, sw / nw)),
    h: round4(Math.min(1 - y, sh / nh)),
  };
  if (crop.w <= 0 || crop.h <= 0) return undefined;
  if (crop.x === 0 && crop.y === 0 && crop.w === 1 && crop.h === 1) return undefined;
  return crop;
}

function assetIndex(d: Dict): number | null {
  const a = num(get(d, "a"));
  return a !== undefined && Number.isInteger(a) && a >= 0 ? a : null;
}

/** Bytes from a binary, a list of byte values or base64 (how JSON notes hold them). */
function toBytes(v: BsonValue | undefined): Uint8Array | null {
  if (v instanceof Uint8Array) return v;
  if (Array.isArray(v)) {
    if (!v.every((b) => typeof b === "number")) return null;
    return Uint8Array.from(v, (b) => b & 0xff);
  }
  if (typeof v === "string") return fromBase64(v);
  return null;
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Decode base64; `null` when the text is not base64. */
export function fromBase64(text: string): Uint8Array | null {
  const clean = text.replace(/[\s=]+$/g, "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*$/.test(clean) || clean.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let acc = 0;
  let o = 0;
  for (const ch of clean) {
    acc = (acc << 6) | BASE64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}

function argbHex(argb: number): string {
  const c = argb >>> 0;
  return hexColor(((c >>> 16) & 255) / 255, ((c >>> 8) & 255) / 255, (c & 255) / 255);
}

function isDict(v: BsonValue | undefined): v is Dict {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Uint8Array);
}

/** A field of a map, own properties only: JSON objects have a prototype. */
function get(d: Dict, key: string): BsonValue | undefined {
  return Object.prototype.hasOwnProperty.call(d, key) ? d[key] : undefined;
}

function num(v: BsonValue | undefined | null): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function positive(v: BsonValue | undefined | null): number | undefined {
  const n = num(v);
  return n !== undefined && n > 0 ? n : undefined;
}

function arrayOf(v: BsonValue | undefined): BsonValue[] {
  return Array.isArray(v) ? v : [];
}

function dicts(v: BsonValue | undefined): Dict[] {
  return arrayOf(v).filter(isDict);
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
