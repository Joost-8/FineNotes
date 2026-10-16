/**
 * reMarkable pages (`.rm`) and documents (`.rmdoc`, or the folder the
 * reMarkable keeps per document) as FineNotes documents. Pure.
 *
 * A page is a `.rm` file starting with the 43-byte header
 * `reMarkable .lines file, version=N` padded with spaces. All numbers are
 * little-endian. The screen is 1404 × 1872 px at 226 dpi.
 *
 * - Versions 3 and 5 (firmware 1.x–2.x, after matomatical's Kaitai spec):
 *   int32 layer count; per layer an int32 stroke count; per stroke int32
 *   pen, int32 colour, int32 unused, float32 base width, (version 5 only)
 *   int32 unused, int32 point count; per point six float32s: x, y, speed,
 *   direction, width, pressure. x and y are from the page's top left.
 * - Version 6 (firmware 3.x, after rmscene): a run of blocks, each
 *   `uint32 length, uint8 0, uint8 min version, uint8 version, uint8 type`
 *   and a body of tagged values. A tag is a varint `index << 4 | type`,
 *   where the type is 0xF (an id: a byte and a varint), 0x1, 0x4 or 0x8
 *   (that many bytes) or 0xC (a uint32 length and a sub-block). Items live
 *   in a CRDT tree: a scene-tree block (1) gives a node its parent, a
 *   tree-node block (2) its visibility and anchor, a group item (4) puts a
 *   node in its parent, a line item (5) is a stroke. An item is gone when
 *   its `deleted length` is set, it carries no value, or a tombstone (8)
 *   names it. Lines' x is centred on the page (−702 … 702). Points are six
 *   float32s in a version 1 block; in version 2 they are float32 x, y,
 *   uint16 speed, uint16 width in quarter px, uint8 direction, uint8
 *   pressure.
 *
 * A document is `<uuid>.content` (JSON: the page order, and which PDF page
 * each page shows), `<uuid>.metadata` (its name), `<uuid>/<page id>.rm` per
 * page with ink, and the `<uuid>.pdf` it annotates, if any. Strokes are drawn
 * in the order they are stored, not in CRDT order; text, text highlights and
 * eraser strokes are reported, not brought over.
 */

import type { InkDocument, Page, Stroke } from "../model/document";
import { SCHEMA_VERSION } from "../constants";
import {
  hexColor,
  pageScale,
  pressureForWidth,
  round2,
  sniffFile,
  type ImportAttachment,
  type ImportResult,
} from "./import-types";

export class RemarkableError extends Error {}

const MAGIC = "reMarkable .lines file, version=";
const HEADER_LENGTH = 43;

/** The reMarkable screen, in its px. */
export const REMARKABLE_WIDTH = 1404;
export const REMARKABLE_HEIGHT = 1872;
const REMARKABLE_DPI = 226;

/** Page px per reMarkable px. */
export const REMARKABLE_SCALE = pageScale(
  REMARKABLE_WIDTH,
  (REMARKABLE_WIDTH * 25.4) / REMARKABLE_DPI,
);

/** reMarkable px of paper kept below the lowest ink when a page is longer than the screen. */
const BOTTOM_MARGIN = 40;

const HIGHLIGHTERS = new Set([5, 18]);
const ERASERS = new Set([6, 8]);

/** Colour ids of all versions, after rmc's palette. */
const PALETTE: Readonly<Record<number, string>> = {
  0: "#000000",
  1: "#909090",
  2: "#ffffff",
  3: "#fbf719",
  4: "#00ff00",
  5: "#ffc0cb",
  6: "#4e69c9",
  7: "#b33e39",
  8: "#7d7d7d",
  9: "#ffed75",
  10: "#a1d87d",
  11: "#8bd0e5",
  12: "#b782cd",
  13: "#f7e851",
};

/** What a highlighter of black, grey, white or the generic highlight colour looks like. */
const HIGHLIGHT_YELLOW = "#ffed75";

/** v6 ids of the top and the bottom of the page's text, which groups can be anchored to. */
const ANCHOR_TOP = "0:281474976710654";
const ANCHOR_BOTTOM = "0:281474976710655";

/** The `.lines` version in a file's header, or null when it is not a reMarkable page. */
export function remarkableVersion(bytes: Uint8Array): number | null {
  if (bytes.length < MAGIC.length + 1) return null;
  for (let i = 0; i < MAGIC.length; i++) if (bytes[i] !== MAGIC.charCodeAt(i)) return null;
  let version = 0;
  let i = MAGIC.length;
  for (; i < Math.min(bytes.length, HEADER_LENGTH) && bytes[i] >= 48 && bytes[i] <= 57; i++)
    version = version * 10 + bytes[i] - 48;
  return i > MAGIC.length ? version : null;
}

/** Whether a file is a reMarkable page (of any version; reading may still refuse it). */
export function isRemarkableLines(bytes: Uint8Array): boolean {
  return remarkableVersion(bytes) !== null;
}

/** Things counted while reading, reported once per import. */
interface Tally {
  erasers: number;
  highlights: number;
  text: number;
  anchoredToText: number;
  hidden: number;
  damaged: number;
  unreadable: number;
}

const newTally = (): Tally => ({
  erasers: 0,
  highlights: 0,
  text: 0,
  anchoredToText: 0,
  hidden: 0,
  damaged: 0,
  unreadable: 0,
});

/** A stroke as stored, in reMarkable px from the page's top left. */
interface RawStroke {
  pen: number;
  color: number;
  /** v6's own colour, `0xAARRGGBB`, when the line carries one. */
  argb?: number;
  /** x, y, width per point. */
  points: number[];
}

/** Convert one `.rm` page. */
export function readRemarkableLines(bytes: Uint8Array, fallbackTitle: string): ImportResult {
  const tally = newTally();
  const counter = { n: 0 };
  const page = buildPage(readStrokes(bytes, tally), "p1", counter, tally);
  return {
    source: "remarkable",
    title: fallbackTitle,
    doc: documentOf([page]),
    attachments: [],
    warnings: warningsOf(tally),
  };
}

/** The raw strokes of a page, of any supported version. */
export function readStrokes(bytes: Uint8Array, tally: Tally = newTally()): RawStroke[] {
  const version = remarkableVersion(bytes);
  if (version === null) throw new RemarkableError("not a reMarkable page");
  if (version === 3 || version === 5) return readV3(bytes, version === 5);
  if (version === 6) return readV6(bytes, tally);
  throw new RemarkableError(`reMarkable page version ${version} is not supported`);
}

class Cursor {
  private readonly view: DataView;

  constructor(
    readonly bytes: Uint8Array,
    public pos: number,
    readonly end: number = bytes.length,
  ) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  need(n: number): number {
    if (n < 0 || this.pos + n > this.end) throw new RemarkableError("unexpected end of data");
    const at = this.pos;
    this.pos += n;
    return at;
  }

  u8(): number {
    return this.bytes[this.need(1)];
  }

  u16(): number {
    return this.view.getUint16(this.need(2), true);
  }

  u32(): number {
    return this.view.getUint32(this.need(4), true);
  }

  i32(): number {
    return this.view.getInt32(this.need(4), true);
  }

  f32(): number {
    return this.view.getFloat32(this.need(4), true);
  }

  f64(): number {
    return this.view.getFloat64(this.need(8), true);
  }

  varuint(): number {
    let value = 0;
    for (let scale = 1; ; scale *= 128) {
      const b = this.u8();
      value += (b & 0x7f) * scale;
      if (b < 0x80) return value;
      if (scale > 2 ** 49) throw new RemarkableError("varint too long");
    }
  }

  /** A CRDT id, as `part1:part2`. */
  id(): string {
    const a = this.u8();
    return `${a}:${this.varuint()}`;
  }
}

function readV3(bytes: Uint8Array, v5: boolean): RawStroke[] {
  const c = new Cursor(bytes, HEADER_LENGTH);
  const strokes: RawStroke[] = [];
  const layers = c.i32();
  if (layers < 0 || layers > 1000) throw new RemarkableError("implausible layer count");
  for (let l = 0; l < layers; l++) {
    const count = c.i32();
    if (count < 0 || count * 20 > c.end - c.pos)
      throw new RemarkableError("implausible stroke count");
    for (let s = 0; s < count; s++) {
      const pen = c.i32();
      const color = c.i32();
      c.need(4);
      c.f32();
      if (v5) c.need(4);
      const n = c.i32();
      if (n < 0 || n * 24 > c.end - c.pos) throw new RemarkableError("implausible point count");
      const points: number[] = [];
      for (let p = 0; p < n; p++) {
        const x = c.f32();
        const y = c.f32();
        c.need(8);
        const width = c.f32();
        c.need(4);
        points.push(x, y, width);
      }
      strokes.push({ pen, color, points });
    }
  }
  return strokes;
}

// --- version 6 ----------------------------------------------------------------

const TAG_ID = 0xf;
const TAG_LENGTH4 = 0xc;

interface Field {
  type: number;
  /** Offset of the value (of a sub-block's contents, past its length). */
  at: number;
  length: number;
}

/** The tagged values between `start` and `end`, by index (the first of each). */
class Fields {
  readonly map = new Map<number, Field>();

  constructor(
    private readonly bytes: Uint8Array,
    start: number,
    end: number,
  ) {
    const c = new Cursor(bytes, start, end);
    while (c.pos < end) {
      const tag = c.varuint();
      const index = Math.floor(tag / 16);
      const type = tag % 16;
      let at = c.pos;
      let length: number;
      if (type === TAG_ID) {
        c.id();
        length = c.pos - at;
      } else if (type === 1 || type === 4 || type === 8) {
        length = type;
        c.need(length);
      } else if (type === TAG_LENGTH4) {
        length = c.u32();
        at = c.pos;
        c.need(length);
      } else {
        throw new RemarkableError(`unknown tag type ${type}`);
      }
      if (!this.map.has(index)) this.map.set(index, { type, at, length });
    }
  }

  private field(index: number, type: number): Field | undefined {
    const f = this.map.get(index);
    return f?.type === type ? f : undefined;
  }

  private cursor(f: Field): Cursor {
    return new Cursor(this.bytes, f.at, f.at + f.length);
  }

  id(index: number): string | undefined {
    const f = this.field(index, TAG_ID);
    return f && this.cursor(f).id();
  }

  int(index: number): number | undefined {
    const f = this.field(index, 4);
    return f && this.cursor(f).u32();
  }

  float(index: number): number | undefined {
    const f = this.field(index, 4);
    return f && this.cursor(f).f32();
  }

  byte(index: number): number | undefined {
    const f = this.field(index, 1);
    return f && this.bytes[f.at];
  }

  /** A sub-block's raw extent. */
  block(index: number): Field | undefined {
    return this.field(index, TAG_LENGTH4);
  }

  /** A sub-block's tagged values, skipping `skip` leading bytes. */
  sub(index: number, skip = 0): Fields | undefined {
    const f = this.block(index);
    return f && f.length >= skip ? new Fields(this.bytes, f.at + skip, f.at + f.length) : undefined;
  }
}

interface V6Node {
  visible: boolean;
  anchor?: string;
  originX?: number;
}

interface V6Line extends RawStroke {
  parent: string;
}

function readV6(bytes: Uint8Array, tally: Tally): RawStroke[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parents = new Map<string, string>();
  const nodes = new Map<string, V6Node>();
  const lines = new Map<string, V6Line>();
  const glyphs = new Set<string>();
  const removed = new Set<string>();
  let text = 0;
  let pos = HEADER_LENGTH;
  while (pos + 8 <= bytes.length) {
    const length = view.getUint32(pos, true);
    const version = bytes[pos + 6];
    const type = bytes[pos + 7];
    const start = pos + 8;
    const end = start + length;
    if (end > bytes.length) {
      tally.damaged++;
      break;
    }
    try {
      const f = new Fields(bytes, start, end);
      switch (type) {
        case 1: {
          const node = f.id(1);
          const parent = f.sub(4)?.id(1);
          if (node && parent && node !== parent) parents.set(node, parent);
          break;
        }
        case 2: {
          const node = f.id(1);
          if (!node) break;
          nodes.set(node, {
            visible: (f.sub(3)?.byte(2) ?? 1) !== 0,
            anchor: f.sub(7)?.id(2),
            originX: f.sub(10)?.float(2),
          });
          break;
        }
        case 3:
        case 5:
        case 6: {
          const item = f.id(2);
          const parent = f.id(1);
          if (!item || !parent) break;
          const value = (f.int(5) ?? 0) === 0 ? f.block(6) : undefined;
          if (!value || value.length < 1) {
            removed.add(item);
            break;
          }
          removed.delete(item);
          if (type === 3) glyphs.add(item);
          else if (type === 6) text++;
          else {
            const line = readLine(bytes, value, version);
            if (line) lines.set(item, { ...line, parent });
          }
          break;
        }
        case 7:
          text++;
          break;
        case 8: {
          const item = f.id(2);
          if (item) removed.add(item);
          break;
        }
      }
    } catch {
      tally.damaged++;
    }
    pos = end;
  }

  for (const id of glyphs) if (!removed.has(id)) tally.highlights++;
  if (text > 0) tally.text++;

  const placed = new Map<string, { x: number; y: number; visible: boolean }>();
  const place = (node: string): { x: number; y: number; visible: boolean } => {
    const known = placed.get(node);
    if (known) return known;
    let x = 0;
    let y = 0;
    let visible = true;
    const seen = new Set<string>();
    for (let n: string | undefined = node; n && !seen.has(n); n = parents.get(n)) {
      seen.add(n);
      const info = nodes.get(n);
      if (!info) continue;
      if (!info.visible) visible = false;
      if (info.originX !== undefined && Number.isFinite(info.originX)) x += info.originX;
      if (info.anchor === ANCHOR_BOTTOM) y += REMARKABLE_HEIGHT;
      else if (info.anchor !== undefined && info.anchor !== ANCHOR_TOP) tally.anchoredToText++;
    }
    const at = { x, y, visible };
    placed.set(node, at);
    return at;
  };

  const out: RawStroke[] = [];
  const hiddenLayers = new Set<string>();
  for (const [id, line] of lines) {
    if (removed.has(id)) continue;
    const at = place(line.parent);
    if (!at.visible) {
      hiddenLayers.add(line.parent);
      continue;
    }
    const points = line.points.slice();
    for (let i = 0; i < points.length; i += 3) {
      points[i] += at.x + REMARKABLE_WIDTH / 2;
      points[i + 1] += at.y;
    }
    out.push({ pen: line.pen, color: line.color, argb: line.argb, points });
  }
  tally.hidden += hiddenLayers.size;
  return out;
}

/** A line item's value: its sub-block holds the item type (3) and then tagged values. */
function readLine(bytes: Uint8Array, value: Field, version: number): RawStroke | null {
  if (bytes[value.at] !== 3) return null;
  const f = new Fields(bytes, value.at + 1, value.at + value.length);
  const pen = f.int(1);
  const color = f.int(2);
  const data = f.block(5);
  if (pen === undefined || color === undefined || !data) return null;
  const size = version === 1 ? 24 : 14;
  if (data.length % size !== 0) throw new RemarkableError("ragged points");
  const c = new Cursor(bytes, data.at, data.at + data.length);
  const points: number[] = [];
  for (let i = 0; i < data.length / size; i++) {
    const x = c.f32();
    const y = c.f32();
    let width: number;
    if (version === 1) {
      c.need(8);
      width = c.f32();
      c.need(4);
    } else {
      c.u16();
      width = c.u16() / 4;
      c.need(2);
    }
    points.push(x, y, width);
  }
  return { pen, color, argb: f.int(8), points };
}

// --- to FineNotes ---------------------------------------------------------------

function colourOf(raw: RawStroke, highlighter: boolean): string {
  if (raw.argb !== undefined && raw.argb >>> 24 !== 0) {
    const ch = (shift: number): number => ((raw.argb ?? 0) >>> shift) & 255;
    return hexColor(ch(16) / 255, ch(8) / 255, ch(0) / 255);
  }
  if (highlighter && (raw.color <= 2 || raw.color === 9)) return HIGHLIGHT_YELLOW;
  return PALETTE[raw.color] ?? PALETTE[0];
}

/** A FineNotes stroke from a raw one, or null for eraser strokes and strokes with no points. */
export function toStroke(raw: RawStroke, id: string, k = REMARKABLE_SCALE): Stroke | null {
  if (ERASERS.has(raw.pen)) return null;
  const xyw: number[] = [];
  for (let i = 0; i + 2 < raw.points.length; i += 3) {
    const [x, y, w] = [raw.points[i], raw.points[i + 1], raw.points[i + 2]];
    if (Number.isFinite(x) && Number.isFinite(y)) xyw.push(x, y, Number.isFinite(w) ? w : 0);
  }
  if (xyw.length === 0) return null;
  let sum = 0;
  for (let i = 2; i < xyw.length; i += 3) sum += Math.max(0, xyw[i]);
  const mean = sum / (xyw.length / 3);
  const size = round2(Math.max(0.1, mean * k));
  const pts: number[] = [];
  for (let i = 0; i < xyw.length; i += 3) {
    const w = xyw[i + 2] > 0 ? xyw[i + 2] : mean;
    pts.push(round2(xyw[i] * k), round2(xyw[i + 1] * k), pressureForWidth(w * k, size));
  }
  const highlighter = HIGHLIGHTERS.has(raw.pen);
  return {
    id,
    color: colourOf(raw, highlighter),
    size,
    tool: highlighter ? "highlighter" : "pen",
    pts,
  };
}

function buildPage(
  raws: readonly RawStroke[],
  id: string,
  counter: { n: number },
  tally: Tally,
  k = REMARKABLE_SCALE,
): Page {
  let bottom = 0;
  const strokes: Stroke[] = [];
  for (const raw of raws) {
    if (ERASERS.has(raw.pen)) {
      tally.erasers++;
      continue;
    }
    const stroke = toStroke(raw, `s${counter.n + 1}`, k);
    if (!stroke) continue;
    counter.n++;
    strokes.push(stroke);
    for (let i = 1; i < raw.points.length; i += 3)
      if (Number.isFinite(raw.points[i])) bottom = Math.max(bottom, raw.points[i]);
  }
  const height = Math.max(REMARKABLE_HEIGHT, Math.ceil(bottom + BOTTOM_MARGIN));
  return {
    id,
    kind: "ink",
    geometry: { width: Math.round(REMARKABLE_WIDTH * k), height: Math.round(height * k) },
    backdrop: { kind: "blank" },
    strokes,
    images: [],
    textBoxes: [],
  };
}

function documentOf(pages: Page[]): InkDocument {
  return {
    version: SCHEMA_VERSION,
    view: { scrollY: 0, width: pages[0].geometry.width, scale: 1 },
    pages,
  };
}

// --- documents ------------------------------------------------------------------

type Json = { [key: string]: unknown };
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function parseJson(bytes: Uint8Array | undefined): unknown {
  if (!bytes) return undefined;
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return undefined;
  }
}

interface Found {
  /** The folder holding the document's files, `""` or `"Name/"`. */
  prefix: string;
  uuid: string;
  content: Json;
}

function findContent(files: ReadonlyMap<string, Uint8Array>): Found | null {
  for (const [name, bytes] of files) {
    const parts = name.split("/");
    const last = parts[parts.length - 1];
    if (parts.length > 2 || !last.endsWith(".content")) continue;
    const content = parseJson(bytes);
    if (!isObject(content) || !("cPages" in content || "pages" in content || "fileType" in content))
      continue;
    return {
      prefix: parts.length === 2 ? `${parts[0]}/` : "",
      uuid: last.slice(0, -".content".length),
      content,
    };
  }
  return null;
}

/** Whether a set of files (an unzipped `.rmdoc`, or a reMarkable document folder) is a reMarkable document. */
export function isRemarkableDocument(files: ReadonlyMap<string, Uint8Array>): boolean {
  return findContent(files) !== null;
}

interface PageRef {
  /** The page's id, naming its `.rm` file. */
  id: string;
  /** The 0-based PDF page it shows, or null for a page added to the PDF. */
  pdfPage: number | null;
}

const lwwValue = (v: unknown): unknown => (isObject(v) ? v.value : undefined);

/** The pages in reading order, from `.content`. */
export function pageOrder(content: Json): PageRef[] {
  const cPages = isObject(content.cPages) ? content.cPages.pages : undefined;
  if (Array.isArray(cPages)) {
    const entries = cPages
      .map((p: unknown, i) => ({ p, i }))
      .filter(
        (e): e is { p: Json; i: number } =>
          isObject(e.p) && typeof e.p.id === "string" && !lwwValue(e.p.deleted),
      )
      .map(({ p, i }) => {
        const idx = lwwValue(p.idx);
        const redir = lwwValue(p.redir);
        return {
          id: p.id as string,
          order: typeof idx === "string" ? idx : "",
          i,
          redir: typeof redir === "number" && redir >= 0 ? redir : null,
        };
      })
      .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : a.i - b.i));
    // Documents written before `redir` existed show their PDF in page order.
    const anyRedir = entries.some((e) => e.redir !== null);
    return entries.map((e, n) => ({ id: e.id, pdfPage: anyRedir ? e.redir : n }));
  }
  const ids = Array.isArray(content.pages) ? content.pages : [];
  const map = Array.isArray(content.redirectionPageMap) ? content.redirectionPageMap : null;
  return ids
    .filter((id): id is string => typeof id === "string")
    .map((id, i) => {
      const r: unknown = map ? map[i] : i;
      return { id, pdfPage: typeof r === "number" && r >= 0 ? r : null };
    });
}

/**
 * Convert one document, given its files by path. `fallbackTitle` is used when
 * the document has no name of its own.
 */
export function readRemarkableDocument(
  files: ReadonlyMap<string, Uint8Array>,
  fallbackTitle: string,
): ImportResult {
  const found = findContent(files);
  if (!found) throw new RemarkableError("not a reMarkable document");
  const { prefix, uuid, content } = found;
  const base = `${prefix}${uuid}`;

  const metadata = parseJson(files.get(`${base}.metadata`));
  const visible = isObject(metadata) ? metadata.visibleName : undefined;
  const title = (typeof visible === "string" && visible.trim()) || fallbackTitle;

  let refs = pageOrder(content);
  if (refs.length === 0) {
    // No page list: the page files that are there, in name order.
    const folder = `${base}/`;
    refs = [...files.keys()]
      .filter(
        (n) => n.startsWith(folder) && n.endsWith(".rm") && !n.slice(folder.length).includes("/"),
      )
      .sort()
      .map((n, i) => ({ id: n.slice(folder.length, -".rm".length), pdfPage: i }));
  }
  if (refs.length === 0) throw new RemarkableError("the document has no pages");

  const tally = newTally();
  const attachments: ImportAttachment[] = [];
  const warnings: string[] = [];
  const pdfBytes = files.get(`${base}.pdf`);
  let pdfName: string | null = null;
  if (pdfBytes && pdfBytes.length > 0) {
    const { mime, ext } = sniffFile(pdfBytes);
    pdfName = `${title}.${ext}`;
    attachments.push({ name: pdfName, bytes: pdfBytes, mime });
  } else if (files.has(`${base}.epub`)) {
    warnings.push("The book's own pages could not be brought over; only the handwriting was.");
  }

  const counter = { n: 0 };
  const pages = refs.map((ref, index) => {
    const bytes = files.get(`${base}/${ref.id}.rm`) ?? files.get(`${base}/${index}.rm`);
    let raws: RawStroke[] = [];
    if (bytes) {
      try {
        raws = readStrokes(bytes, tally);
      } catch {
        tally.unreadable++;
      }
    }
    const page = buildPage(raws, `p${index + 1}`, counter, tally);
    if (pdfName && ref.pdfPage !== null)
      page.backdrop = { kind: "pdf", path: pdfName, page: ref.pdfPage };
    return page;
  });

  return {
    source: "remarkable",
    title,
    doc: documentOf(pages),
    attachments,
    warnings: [...warnings, ...warningsOf(tally)],
  };
}

function warningsOf(t: Tally): string[] {
  const out: string[] = [];
  if (t.unreadable > 0)
    out.push(
      `${plural(t.unreadable, "page")} could not be read and ${t.unreadable === 1 ? "was" : "were"} left blank.`,
    );
  if (t.damaged > 0)
    out.push(`Part of the ink could not be read (${plural(t.damaged, "damaged block")}).`);
  if (t.erasers > 0) {
    out.push(
      `${plural(t.erasers, "eraser stroke")} ${t.erasers === 1 ? "was" : "were"} left out; ink rubbed out with ${t.erasers === 1 ? "it" : "them"} may show again.`,
    );
  }
  if (t.highlights > 0)
    out.push(`${plural(t.highlights, "text highlight")} could not be brought over yet.`);
  if (t.text > 0) out.push("Typed text could not be brought over yet.");
  if (t.anchoredToText > 0)
    out.push("Some ink was placed next to typed text and may sit higher on the page than it did.");
  if (t.hidden > 0) out.push(`Ink on ${plural(t.hidden, "hidden layer")} was left out.`);
  return out;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
