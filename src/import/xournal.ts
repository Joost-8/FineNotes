/**
 * Xournal (`.xoj`) and Xournal++ (`.xopp`) notebooks as FineNotes documents.
 * Pure.
 *
 * Both are one XML document, usually gzipped; recent Xournal++ builds can
 * also write a zip holding `content.xml` and the pictures and PDFs it names.
 * Read from Xournal++'s loader (`src/core/control/xojfile/`, 2026-10), not
 * copied from it:
 *
 * - `<xournal>` holds an optional `<title>`, a `<preview>` picture (ignored)
 *   and `<page width height>`s, in PDF points (1/72 in).
 * - A page has one `<background>` and `<layer>`s, drawn in order.
 *   `type="solid"` has a `color` and a `style` (plain, lined, ruled, graph,
 *   dotted, staves, isodotted, isograph); `type="pdf"` names a PDF by
 *   `domain` and `filename` (only on the first such page) and a 1-based
 *   `pageno`; `type="pixmap"` names a picture, and with `domain="clone"` its
 *   `filename` is the 0-based index of the page whose picture it reuses. A
 *   PDF or picture outside the file cannot be brought over.
 * - `<stroke tool color width>x0 y0 x1 y1 …</stroke>`: the first number of
 *   `width` is the pen's width; any more are the width drawn on each
 *   segment, which carries the pressure.
 * - `<text font size x y color>` (or a six-number `matrix`, whose last two
 *   are the position) holds typed text; `<image left top right bottom>`
 *   holds a base64 picture, or an `<attachment path>` into the zip.
 *
 * Colours are `#rrggbbaa` or one of Xournal's palette names.
 */

import type {
  Backdrop,
  ImageElement,
  InkDocument,
  Page,
  Ruling,
  Stroke,
  TextBoxElement,
  TextFont,
} from "../model/document";
import { SCHEMA_VERSION } from "../constants";
import { gunzipSync, strFromU8, unzipSync } from "fflate";
import {
  median,
  pageScale,
  pressureForWidth,
  round2,
  sniffFile,
  type ImportAttachment,
  type ImportResult,
} from "./import-types";

export class XournalError extends Error {}

/** Page px per PDF point. */
export const XOURNAL_PX_PER_PT = pageScale(72, 25.4);

/** Xournal's pen palette. */
const INK_NAMES: Record<string, string> = {
  black: "#000000",
  blue: "#3333cc",
  red: "#ff0000",
  green: "#008000",
  gray: "#808080",
  lightblue: "#00c0ff",
  lightgreen: "#00ff00",
  magenta: "#ff00ff",
  orange: "#ff8000",
  yellow: "#ffff00",
  white: "#ffffff",
};

/** Xournal's paper palette. */
const PAPER_NAMES: Record<string, string> = {
  white: "#ffffff",
  yellow: "#ffff80",
  pink: "#ffc0d4",
  orange: "#ffc080",
  blue: "#a0e8ff",
  green: "#80ffc0",
};

/** Xournal's paper styles, as FineNotes rulings and their pitch in points. */
const STYLES: Record<string, { kind: Ruling; pitch?: number }> = {
  plain: { kind: "blank" },
  lined: { kind: "margin-left", pitch: 24 },
  ruled: { kind: "ruled-wide", pitch: 24 },
  graph: { kind: "squared", pitch: 14.17 },
  dotted: { kind: "dotted", pitch: 14.17 },
  staves: { kind: "music" },
  isodotted: { kind: "isometric-dots", pitch: 14.17 },
  isograph: { kind: "isometric", pitch: 14.17 },
};

/** Titles Xournal writes into every file, which name nothing. */
const BOILERPLATE_TITLE = /^xournal(\+\+)? document\b/i;

/** Page size when a page does not say: US Letter, Xournal's default. */
const DEFAULT_WIDTH = 612;
const DEFAULT_HEIGHT = 792;

// --- reading the bytes ---------------------------------------------------------

interface Container {
  xml: string;
  /** Files beside `content.xml` in a zip container. */
  files: ReadonlyMap<string, Uint8Array>;
}

/** Whether the bytes are a Xournal or Xournal++ notebook. */
export function isXournal(bytes: Uint8Array): boolean {
  try {
    return rootOf(openContainer(bytes).xml) !== null;
  } catch {
    return false;
  }
}

function openContainer(bytes: Uint8Array): Container {
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    return { xml: strFromU8(gunzipSync(bytes)), files: new Map() };
  }
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const files = new Map(Object.entries(unzipSync(bytes)));
    const content = files.get("content.xml");
    if (!content) throw new XournalError("the zip has no content.xml");
    return { xml: strFromU8(content), files };
  }
  return { xml: strFromU8(bytes), files: new Map() };
}

/** The `<xournal>` element, when the text is an XML document with that root. */
function rootOf(xml: string): XmlElement | null {
  // trimStart also drops a byte-order mark.
  const start = xml.trimStart();
  if (!start.startsWith("<?xml") && !start.startsWith("<xournal")) return null;
  const root = parseXml(xml).find((n): n is XmlElement => typeof n !== "string");
  return root?.name === "xournal" ? root : null;
}

// --- a small XML reader ------------------------------------------------------

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}
export type XmlNode = XmlElement | string;

/**
 * Parse XML into elements and text. Enough for Xournal's files: tags,
 * attributes, text, entities, comments, CDATA and processing instructions.
 * Throws {@link XournalError} on a tag it cannot read or close.
 */
export function parseXml(xml: string): XmlNode[] {
  const top: XmlNode[] = [];
  const stack: XmlElement[] = [];
  const add = (node: XmlNode): void => {
    const parent = stack[stack.length - 1];
    (parent ? parent.children : top).push(node);
  };
  let at = 0;
  while (at < xml.length) {
    const lt = xml.indexOf("<", at);
    if (lt < 0) {
      add(decodeEntities(xml.slice(at)));
      break;
    }
    if (lt > at) add(decodeEntities(xml.slice(at, lt)));
    if (xml.startsWith("<!--", lt)) {
      at = skipPast(xml, "-->", lt);
    } else if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt);
      if (end < 0) throw new XournalError("unterminated CDATA");
      add(xml.slice(lt + 9, end));
      at = end + 3;
    } else if (xml.startsWith("<?", lt)) {
      at = skipPast(xml, "?>", lt);
    } else if (xml.startsWith("<!", lt)) {
      at = skipPast(xml, ">", lt);
    } else if (xml[lt + 1] === "/") {
      const gt = xml.indexOf(">", lt);
      if (gt < 0) throw new XournalError("unterminated end tag");
      const name = xml.slice(lt + 2, gt).trim();
      const open = stack.pop();
      if (open?.name !== name) throw new XournalError(`unexpected </${name}>`);
      at = gt + 1;
    } else {
      at = readTag(xml, lt, (element, selfClosing) => {
        add(element);
        if (!selfClosing) stack.push(element);
      });
    }
  }
  if (stack.length > 0) throw new XournalError(`<${stack[stack.length - 1].name}> is not closed`);
  return top;
}

function skipPast(xml: string, end: string, from: number): number {
  const i = xml.indexOf(end, from);
  if (i < 0) throw new XournalError(`missing ${end}`);
  return i + end.length;
}

const NAME = /[A-Za-z_:][-A-Za-z0-9_:.]*/y;
const SPACE = /\s*/y;

function readTag(
  xml: string,
  lt: number,
  done: (element: XmlElement, selfClosing: boolean) => void,
): number {
  const match = (re: RegExp, from: number): string | null => {
    re.lastIndex = from;
    const m = re.exec(xml);
    return m ? m[0] : null;
  };
  const name = match(NAME, lt + 1);
  if (!name) throw new XournalError("bad tag");
  const attrs: Record<string, string> = {};
  let at = lt + 1 + name.length;
  for (;;) {
    at += (match(SPACE, at) ?? "").length;
    if (xml.startsWith("/>", at)) {
      done({ name, attrs, children: [] }, true);
      return at + 2;
    }
    if (xml[at] === ">") {
      done({ name, attrs, children: [] }, false);
      return at + 1;
    }
    const key = match(NAME, at);
    if (!key) throw new XournalError(`bad attribute in <${name}>`);
    at += key.length;
    at += (match(SPACE, at) ?? "").length;
    if (xml[at] !== "=") throw new XournalError(`attribute ${key} has no value`);
    at += 1;
    at += (match(SPACE, at) ?? "").length;
    const quote = xml[at];
    if (quote !== '"' && quote !== "'") throw new XournalError(`attribute ${key} is not quoted`);
    const end = xml.indexOf(quote, at + 1);
    if (end < 0) throw new XournalError(`attribute ${key} is not closed`);
    attrs[key] = decodeEntities(xml.slice(at + 1, end));
    at = end + 1;
  }
}

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

/** Replace XML's entity and character references. An unknown one is kept as written. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[ref] ?? whole;
  });
}

function elements(node: XmlElement, name?: string): XmlElement[] {
  return node.children.filter(
    (c): c is XmlElement => typeof c !== "string" && (name === undefined || c.name === name),
  );
}

function textOf(node: XmlElement): string {
  return node.children.map((c) => (typeof c === "string" ? c : textOf(c))).join("");
}

// --- the notebook ------------------------------------------------------------

/**
 * Convert one notebook. `fallbackTitle` is used when the file's own title
 * is missing or Xournal's boilerplate.
 */
export function readXournal(bytes: Uint8Array, fallbackTitle: string): ImportResult {
  let container: Container;
  let root: XmlElement | null;
  try {
    container = openContainer(bytes);
    root = rootOf(container.xml);
  } catch (e) {
    throw new XournalError(`the file could not be read: ${(e as Error).message}`);
  }
  if (!root) throw new XournalError("not a Xournal notebook");

  const ownTitle = elements(root, "title").map(textOf)[0]?.trim() ?? "";
  const name = ownTitle && !BOILERPLATE_TITLE.test(ownTitle) ? ownTitle : fallbackTitle;
  const k = XOURNAL_PX_PER_PT;

  const attachments: ImportAttachment[] = [];
  const attachedFiles = new Map<string, string>();
  const attach = (bytes: Uint8Array, label: string, key?: string): string => {
    const known = key === undefined ? undefined : attachedFiles.get(key);
    if (known) return known;
    const { mime, ext } = sniffFile(bytes);
    const fileName = `${name} - ${label} ${attachments.length + 1}.${ext}`;
    attachments.push({ name: fileName, bytes, mime });
    if (key !== undefined) attachedFiles.set(key, fileName);
    return fileName;
  };
  const zipped = (path: string | undefined): Uint8Array | undefined =>
    path ? container.files.get(path.replace(/^\.?\//, "")) : undefined;

  let missingPdf = 0;
  let missingPicture = 0;
  let unreadableStrokes = 0;
  let unreadablePictures = 0;
  let skipped = 0;
  let strokeN = 0;
  let imageN = 0;
  let textN = 0;
  let pdfName: string | undefined;
  /** Each page's background picture, for `domain="clone"`. */
  const pagePictures: (string | null)[] = [];

  const pages: Page[] = elements(root, "page").map((pageEl, index) => {
    const ptWidth = positive(pageEl.attrs.width) ?? DEFAULT_WIDTH;
    const ptHeight = positive(pageEl.attrs.height) ?? DEFAULT_HEIGHT;
    const width = Math.round(ptWidth * k);
    const height = Math.round(ptHeight * k);
    const page: Page = {
      id: `p${index + 1}`,
      kind: "ink",
      geometry: { width, height },
      backdrop: { kind: "blank" },
      strokes: [],
      images: [],
      textBoxes: [],
    };

    let picture: string | null = null;
    const bg = elements(pageEl, "background")[0];
    if (bg) {
      const type = bg.attrs.type;
      if (type === "solid") {
        page.backdrop = solidBackdrop(bg);
      } else if (type === "pdf") {
        if (bg.attrs.filename) pdfName = bg.attrs.filename;
        const pdf = zipped(pdfName);
        if (pdf && pdfName) {
          const pageNo = Math.max(1, Math.round(Number(bg.attrs.pageno) || 1));
          page.backdrop = { kind: "pdf", path: attach(pdf, "paper", pdfName), page: pageNo - 1 };
        } else missingPdf++;
      } else if (type === "pixmap") {
        picture = backgroundPicture(bg, pagePictures, zipped, attach);
        if (picture) {
          page.images.push({
            id: `i${++imageN}`,
            path: picture,
            x: 0,
            y: 0,
            w: width,
            h: height,
            locked: true,
          });
        } else missingPicture++;
      } else skipped++;
    }
    pagePictures.push(picture);

    for (const layer of elements(pageEl, "layer")) {
      for (const el of elements(layer)) {
        switch (el.name) {
          case "stroke": {
            if (el.attrs.tool === "eraser") break;
            const stroke = readStroke(el, k, `s${strokeN + 1}`);
            if (stroke) {
              page.strokes.push(stroke);
              strokeN++;
            } else unreadableStrokes++;
            break;
          }
          case "text": {
            const box = readText(el, k, `t${textN + 1}`);
            if (box) {
              page.textBoxes.push(box);
              textN++;
            } else skipped++;
            break;
          }
          case "image":
          case "teximage": {
            const image = readImage(el, k, `i${imageN + 1}`, zipped, (data) =>
              attach(data, "picture"),
            );
            if (image) {
              page.images.push(image);
              imageN++;
            } else if (el.name === "image") unreadablePictures++;
            else skipped++;
            break;
          }
          case "timestamp":
            break;
          default:
            skipped++;
        }
      }
    }
    return page;
  });
  if (pages.length === 0) throw new XournalError("the notebook has no pages");

  const warnings: string[] = [];
  if (missingPdf > 0) {
    warnings.push(
      `${plural(missingPdf, "page", "pages")} used a PDF that is not in the file; ` +
        `${missingPdf === 1 ? "it has" : "they have"} blank paper.`,
    );
  }
  if (missingPicture > 0) {
    warnings.push(
      `${plural(missingPicture, "page", "pages")} used a background picture that is not in the file; ` +
        `${missingPicture === 1 ? "it has" : "they have"} blank paper.`,
    );
  }
  if (unreadableStrokes > 0)
    warnings.push(`${plural(unreadableStrokes, "stroke")} could not be read.`);
  if (unreadablePictures > 0)
    warnings.push(`${plural(unreadablePictures, "picture")} could not be read.`);
  if (skipped > 0) {
    warnings.push(
      `${plural(skipped, "item")} (LaTeX, links or other elements) could not be brought over yet.`,
    );
  }

  const doc: InkDocument = {
    version: SCHEMA_VERSION,
    view: { scrollY: 0, width: pages[0].geometry.width, scale: 1 },
    pages,
  };
  return { source: "xournal", title: name, doc, attachments, warnings };
}

function solidBackdrop(bg: XmlElement): Backdrop {
  const style = Object.prototype.hasOwnProperty.call(STYLES, bg.attrs.style ?? "")
    ? STYLES[bg.attrs.style]
    : STYLES.plain;
  const backdrop: Backdrop = { kind: style.kind };
  if (style.pitch) backdrop.spacing = round2(style.pitch * XOURNAL_PX_PER_PT);
  const paper = parseColor(bg.attrs.color ?? "white", PAPER_NAMES);
  if (paper && paper !== "#ffffff") backdrop.paperColor = paper;
  return backdrop;
}

function backgroundPicture(
  bg: XmlElement,
  earlier: readonly (string | null)[],
  zipped: (path: string | undefined) => Uint8Array | undefined,
  attach: (bytes: Uint8Array, label: string, key?: string) => string,
): string | null {
  const domain = bg.attrs.domain ?? "absolute";
  if (domain === "clone") {
    const from = Number(bg.attrs.filename);
    return Number.isInteger(from) ? (earlier[from] ?? null) : null;
  }
  const inline = decodeBase64(textOf(bg));
  if (inline && inline.length > 0) return attach(inline, "picture");
  const file = domain === "attach" ? zipped(bg.attrs.filename) : undefined;
  return file ? attach(file, "picture", bg.attrs.filename) : null;
}

function readStroke(el: XmlElement, k: number, id: string): Stroke | null {
  const coords = numbers(textOf(el));
  const n = coords.length >> 1;
  const widths = numbers(el.attrs.width ?? "");
  const nominal = widths[0] > 0 ? widths[0] : 1.41;
  const segments = widths.slice(1).filter((w) => w > 0);
  if (n < 1) return null;
  // A segment's width is drawn from its first point; the last point takes the last segment's.
  const widthAt = (i: number): number =>
    segments.length > 0 ? segments[Math.min(i, segments.length - 1)] : nominal;
  const perPoint = Array.from({ length: n }, (_, i) => widthAt(i) * k);
  const size = round2(Math.max(0.1, median(perPoint)));
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    pts.push(
      round2(coords[i * 2] * k),
      round2(coords[i * 2 + 1] * k),
      pressureForWidth(perPoint[i], size),
    );
  }
  return {
    id,
    color: parseColor(el.attrs.color ?? "black", INK_NAMES) ?? "#000000",
    size,
    tool: el.attrs.tool === "highlighter" ? "highlighter" : "pen",
    pts,
  };
}

/** Xournal's font name, as `"Sans Bold Italic 12"`, as a FineNotes typeface and style. */
function readFont(font: string): { font?: TextFont; bold?: true; italic?: true } {
  const f = font.toLowerCase();
  const out: { font?: TextFont; bold?: true; italic?: true } = {};
  if (/mono|courier/.test(f)) out.font = "mono";
  else if (/times/.test(f)) out.font = "times";
  else if (/serif/.test(f) && !/sans/.test(f)) out.font = "serif";
  if (/bold/.test(f)) out.bold = true;
  if (/italic|oblique/.test(f)) out.italic = true;
  return out;
}

function readText(el: XmlElement, k: number, id: string): TextBoxElement | null {
  const text = textOf(el);
  let x = Number(el.attrs.x);
  let y = Number(el.attrs.y);
  const matrix = numbers(el.attrs.matrix ?? "");
  if (matrix.length === 6) [x, y] = [matrix[4], matrix[5]];
  if (!Number.isFinite(x) || !Number.isFinite(y) || text.trim() === "") return null;
  const fontSize = Math.max(12, round2((positive(el.attrs.size) ?? 12) * k));
  const wrap = positive(el.attrs.width);
  const longest = Math.max(...text.split("\n").map((line) => line.length));
  const box: TextBoxElement = {
    id,
    x: round2(x * k),
    y: round2(y * k),
    w: wrap ? round2(wrap * k) : Math.max(8, round2(longest * fontSize * 0.6)),
    text,
    color: parseColor(el.attrs.color ?? "black", INK_NAMES) ?? "#000000",
    fontSize,
    ...readFont(el.attrs.font ?? "Sans"),
  };
  if (!wrap) box.fit = true;
  return box;
}

function readImage(
  el: XmlElement,
  k: number,
  id: string,
  zipped: (path: string | undefined) => Uint8Array | undefined,
  attach: (bytes: Uint8Array) => string,
): ImageElement | null {
  let [left, top, right, bottom] = ["left", "top", "right", "bottom"].map((a) =>
    Number(el.attrs[a]),
  );
  const matrix = numbers(el.attrs.matrix ?? "");
  if (matrix.length === 6) {
    // The matrix maps the picture's own unit square onto the page.
    [left, top] = [matrix[4], matrix[5]];
    [right, bottom] = [left + matrix[0], top + matrix[3]];
  }
  if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top)
    return null;
  const linked = elements(el, "attachment")[0];
  const data = linked ? zipped(linked.attrs.path) : decodeBase64(textOf(el));
  if (!data || data.length === 0 || !sniffFile(data).mime.startsWith("image/")) return null;
  return {
    id,
    path: attach(data),
    x: round2(left * k),
    y: round2(top * k),
    w: round2((right - left) * k),
    h: round2((bottom - top) * k),
  };
}

/** A colour as `#rrggbb`: `#rrggbb`, `#rrggbbaa` (alpha dropped) or a palette name. */
export function parseColor(value: string, names: Record<string, string>): string | null {
  const v = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(v);
  if (hex) return `#${hex[1]}`;
  return Object.prototype.hasOwnProperty.call(names, v) ? names[v] : null;
}

function numbers(text: string): number[] {
  return text
    .trim()
    .split(/[\s,]+/)
    .filter((t) => t !== "")
    .map(Number)
    .filter(Number.isFinite);
}

function positive(value: string | undefined): number | undefined {
  const v = Number(value);
  return value !== undefined && Number.isFinite(v) && v > 0 ? v : undefined;
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Decode base64, ignoring whitespace. Null when the text is not base64. */
export function decodeBase64(text: string): Uint8Array | null {
  const clean = text.replace(/\s+/g, "").replace(/=+$/, "");
  if (clean.length === 0 || clean.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let o = 0;
  for (const ch of clean) {
    const d = BASE64.indexOf(ch);
    if (d < 0) return null;
    value = ((value << 6) | d) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (value >> bits) & 0xff;
    }
  }
  return out;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
