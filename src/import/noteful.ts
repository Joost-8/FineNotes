/**
 * Noteful notebooks (`.noteful`) as FineNotes documents. Pure.
 *
 * The format is undocumented; this reads what was found in a real Noteful
 * backup (2026-10, Noteful 1.5, package format 1.21: 115 notebooks, every
 * page's ink read to its last byte). A `.noteful` file is not a zip:
 *
 * - It starts with the magic `AA BB CC DE` and ends with 16 bytes: the magic
 *   again, then the offset (8 bytes) and length (4) of an index. The index
 *   names every record and says where it is (field 10 names, 11 offsets,
 *   12 lengths). Records are messages in the tagged layout of
 *   `noteful-fields.ts`, or files kept as they are (PDFs, pictures).
 * - `n:<id>` is the notebook: field 3 its title.
 * - `d:<id>` is the document. Field 2 lists its pages as a collection
 *   (`{1: ids, 2: times, 3: alive flags, 0: items}`). A page names its ink
 *   record (`2.0`), its paper (`4`) and its place in the order (`5`, a key
 *   compared character by character).
 * - The paper is a PDF page: an imported PDF (`4.0 = 1`, the PDF in `4.4`,
 *   the page in `4.5`) or Noteful's own paper, which it keeps rendered as a
 *   one-page PDF (`4.0 = 2`, `4.3`). `4.1` is the page's size, in units of
 *   1/132 inch, the unit of every coordinate.
 * - An ink record holds the strokes as one packed block (field 2), and the
 *   page's other objects, pictures and text boxes, as a collection (field 5).
 *
 * The stroke block is a run of elements. `F1 02` sets the colour of the
 * strokes after it (red, green, blue, alpha as doubles, then 10 bytes not
 * used here). `F1 01` is a stroke: an 8-byte id, 2 bytes of flags, three
 * version stamps, a pen id (4 bytes), 8 more bytes when flag 16 is set, the
 * width (double) and the point count (8 bytes). Flag 2 adds a count `m` and
 * two arrays of `m` floats; then come the points: under four, as float
 * pairs; else a box (x, width, y, height as floats) and each point as two
 * 16-bit fractions of it. Flag 1 adds one value a point (4 bytes each for
 * float points; 8 bytes plus 2 a point otherwise), which is not pressure
 * (it runs to the thousands) and is skipped.
 */

import { SCHEMA_VERSION } from "../constants";
import type { ImageElement, InkDocument, Page, Stroke, TextBoxElement } from "../model/document";
import { PAGE_PX_PER_MM } from "../model/units";
import {
  hexColor,
  round2,
  sniffFile,
  type ImportAttachment,
  type ImportResult,
} from "./import-types";
import { NotefulError, NotefulMessage, readFields, type NotefulSpan } from "./noteful-fields";

export { NotefulError } from "./noteful-fields";

const MAGIC = 0xaabbccde;
const FOOTER = 16;
/** FineNotes page px per Noteful unit (1/132 inch). */
export const NOTEFUL_SCALE = (PAGE_PX_PER_MM * 25.4) / 132;
/** Noteful's Letter page, for a page that does not say its size. */
const DEFAULT_SIZE: readonly [number, number] = [1122.5, 1449.92];
const TAG_STROKE = 0xf101;
const TAG_COLOR = 0xf102;
const COLOR_BYTES = 44;
const KNOWN_FLAGS = 1 | 2 | 16;
/** The pressure every stroke gets: Noteful's width is the line's. */
const PRESSURE = 0.5;

/** Whether the bytes are a Noteful notebook. */
export function isNoteful(bytes: Uint8Array): boolean {
  if (bytes.length < 4 + FOOTER) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(0) === MAGIC && view.getUint32(bytes.length - FOOTER) === MAGIC;
}

/** The notebook's records by name, from the index at its end. */
function readIndex(bytes: Uint8Array): Map<string, NotefulSpan> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tail = bytes.length - FOOTER;
  const offset = Number(view.getBigUint64(tail + 4));
  const length = view.getUint32(tail + 12);
  if (offset + length > tail) throw new NotefulError("the index is outside the file");
  const index = NotefulMessage.parse(bytes, { start: offset, end: offset + length });
  const names = index.strings(10);
  const offsets = index.numbers(11);
  const lengths = index.numbers(12);
  const records = new Map<string, NotefulSpan>();
  names.forEach((name, i) => {
    const start = offsets[i];
    const end = start + lengths[i];
    if (Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end <= tail) {
      records.set(name, { start, end });
    }
  });
  return records;
}

/** The live items of a collection (`{1: ids, 3: alive, 0: items}`), in stored order. */
function liveItems(collection: NotefulMessage | undefined): NotefulMessage[] {
  if (!collection) return [];
  const alive = collection.numbers(3);
  return collection.messages(0).filter((_, i) => alive[i] !== 0);
}

/** Convert one notebook. `fallbackTitle` is used when it has no name of its own. */
export function readNoteful(bytes: Uint8Array, fallbackTitle: string): ImportResult {
  if (!isNoteful(bytes)) throw new NotefulError("not a Noteful notebook");
  const records = readIndex(bytes);
  const named = (prefix: string): NotefulMessage | undefined => {
    for (const [name, span] of records) {
      if (name.startsWith(prefix)) return NotefulMessage.parse(bytes, span);
    }
    return undefined;
  };
  const record = (id: string | undefined): Uint8Array | undefined => {
    const span = id ? records.get(id) : undefined;
    return span ? bytes.subarray(span.start, span.end) : undefined;
  };

  const title = named("n:")?.string(3)?.trim() || fallbackTitle;
  const doc = named("d:");
  if (!doc) throw new NotefulError("the notebook has no document record");

  const pages = liveItems(doc.message(2))
    .map((page, index) => ({ page, index, key: page.string(5) ?? "" }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.index - b.index))
    .map(({ page }) => page);
  if (pages.length === 0) throw new NotefulError("the notebook has no pages");

  const attachments: ImportAttachment[] = [];
  const attached = new Map<string, string>();
  const attach = (id: string, label: string): string | null => {
    const known = attached.get(id);
    if (known) return known;
    const data = record(id);
    if (!data || data.length === 0) return null;
    const { mime, ext } = sniffFile(data);
    const name = `${title} - ${label} ${attachments.length + 1}.${ext}`;
    attachments.push({ name, bytes: data, mime });
    attached.set(id, name);
    return name;
  };

  const tally = { strokes: 0, images: 0, texts: 0, lostStrokes: 0, skipped: 0, missing: 0 };
  const docPages: Page[] = pages.map((page, index) => {
    const template = page.message(4);
    const [w, h] = template?.pair(1) ?? DEFAULT_SIZE;
    const imported = template?.number(0) === 1;
    const pdfId = imported ? template?.string(4) : template?.string(3);
    const pdfPage = imported ? Math.max(0, Math.round(template?.number(5) ?? 0)) : 0;
    const pdf = pdfId ? attach(pdfId, imported ? "document" : "paper") : null;
    if (pdfId && !pdf) tally.missing++;

    const out: Page = {
      id: `p${index + 1}`,
      kind: "ink",
      geometry: { width: Math.round(w * NOTEFUL_SCALE), height: Math.round(h * NOTEFUL_SCALE) },
      backdrop: pdf ? { kind: "pdf", path: pdf, page: pdfPage } : { kind: "blank" },
      strokes: [],
      images: [],
      textBoxes: [],
    };
    const ink = page.message(2)?.string(0);
    const content = ink ? record(ink) : undefined;
    if (content && content.length > 0) {
      const message = new NotefulMessage(content, safeFields(content));
      readStrokes(message, out, tally);
      readObjects(message, out, tally, (id) => attach(id, "picture"));
    }
    return out;
  });

  const warnings: string[] = [];
  if (tally.lostStrokes > 0) {
    warnings.push(`${plural(tally.lostStrokes, "page")} had ink that could not all be read.`);
  }
  if (tally.skipped > 0) {
    warnings.push(
      `${plural(tally.skipped, "item")} (shapes or other elements) could not be brought over yet.`,
    );
  }
  if (tally.missing > 0) {
    warnings.push(
      `${plural(tally.missing, "picture or paper", "pictures or papers")} were not in the file.`,
    );
  }

  const result: InkDocument = {
    version: SCHEMA_VERSION,
    view: { scrollY: 0, width: docPages[0].geometry.width, scale: 1 },
    pages: docPages,
  };
  return { source: "noteful", title, doc: result, attachments, warnings };
}

/** A message's fields, or none when the record cannot be read. */
function safeFields(bytes: Uint8Array): NotefulMessage["fields"] {
  try {
    return readFields(bytes, 0, bytes.length);
  } catch {
    return [];
  }
}

interface Tally {
  strokes: number;
  images: number;
  texts: number;
  lostStrokes: number;
  skipped: number;
  missing: number;
}

/** The strokes of one ink record's packed block, onto `page`. */
function readStrokes(content: NotefulMessage, page: Page, tally: Tally): void {
  const block = content.span(2);
  if (!block) return;
  const bytes = content.bytes;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const k = NOTEFUL_SCALE;
  const end = block.end;
  let at = block.start;
  let color = "#000000";
  let highlighter = false;
  while (at < end) {
    if (at + 2 > end) break;
    const tag = view.getUint16(at);
    if (tag === TAG_COLOR) {
      if (at + COLOR_BYTES > end) break;
      const [r, g, b] = [0, 1, 2].map((i) => view.getFloat64(at + 2 + 8 * i));
      color = hexColor(r, g, b);
      highlighter = view.getUint8(at + 35) === 1;
      at += COLOR_BYTES;
      continue;
    }
    if (tag !== TAG_STROKE || at + 56 > end) break;
    const flags = view.getUint16(at + 10);
    if (flags & ~KNOWN_FLAGS) break;
    let head = at + 40;
    if (flags & 16) head += 8;
    if (head + 16 > end) break;
    const width = view.getFloat64(head);
    const n = Number(view.getBigUint64(head + 8));
    at = head + 16;
    if (flags & 2) {
      if (at + 8 > end) break;
      at += 8 + 8 * Number(view.getBigUint64(at));
    }
    // With flag 1 every point carries a third value, interleaved: float
    // points are (x, y, value) triples; quantized ones have the value's
    // range (8 bytes) after the box, then (x, y, value) as 16-bit fractions.
    const extra = (flags & 1) !== 0;
    const raw = n < 4;
    const stride = raw ? (extra ? 12 : 8) : extra ? 6 : 4;
    const first = raw ? 0 : extra ? 24 : 16;
    const size = first + stride * n;
    if (!(n > 0) || at + size > end) break;
    const pts: number[] = [];
    if (raw) {
      for (let i = 0; i < n; i++) {
        const p = at + stride * i;
        pushPoint(pts, view.getFloat32(p) * k, view.getFloat32(p + 4) * k);
      }
    } else {
      const bx = view.getFloat32(at);
      const bw = view.getFloat32(at + 4);
      const by = view.getFloat32(at + 8);
      const bh = view.getFloat32(at + 12);
      for (let i = 0; i < n; i++) {
        const p = at + first + stride * i;
        const u = view.getUint16(p) / 0xffff;
        const v = view.getUint16(p + 2) / 0xffff;
        pushPoint(pts, (bx + u * bw) * k, (by + v * bh) * k);
      }
    }
    at += size;
    if (pts.length === 0) continue;
    tally.strokes++;
    page.strokes.push({
      id: `s${tally.strokes}`,
      color,
      size: round2(Math.max(0.1, (Number.isFinite(width) ? width : 1) * k)),
      tool: highlighter ? "highlighter" : "pen",
      pts,
    } satisfies Stroke);
  }
  if (at !== end) tally.lostStrokes++;
}

function pushPoint(pts: number[], x: number, y: number): void {
  if (Number.isFinite(x) && Number.isFinite(y)) pts.push(round2(x), round2(y), PRESSURE);
}

/** The pictures and text boxes of one ink record, onto `page`. */
function readObjects(
  content: NotefulMessage,
  page: Page,
  tally: Tally,
  attach: (id: string) => string | null,
): void {
  let objects: NotefulMessage[];
  try {
    objects = liveItems(content.message(5));
  } catch {
    tally.skipped++;
    return;
  }
  const k = NOTEFUL_SCALE;
  for (const object of objects) {
    try {
      const [cx, cy, w, h, rotation] = object.message(2)?.numbers(1) ?? [];
      const body = object.message(6);
      const kind = body?.number(1);
      // A straight line's frame has no width or no height, so only a box
      // that holds a picture or text needs both.
      if (!body || ![cx, cy, w, h].every(Number.isFinite) || w < 0 || h < 0) {
        tally.skipped++;
        continue;
      }
      const box = {
        x: round2((cx - w / 2) * k),
        y: round2((cy - h / 2) * k),
        w: round2(w * k),
        h: round2(h * k),
      };
      const boxed = w > 0 && h > 0;
      if (kind === 1 && boxed) {
        const path = attach(body.string(10) ?? "");
        if (!path) {
          tally.missing++;
          continue;
        }
        tally.images++;
        const image: ImageElement = { id: `i${tally.images}`, path, ...box };
        if (rotation && Number.isFinite(rotation)) image.rotation = rotation;
        page.images.push(image);
      } else if (kind === 2 && boxed) {
        const text = body.message(4);
        const words = text?.strings(2).join("") ?? "";
        if (!words.trim()) continue;
        const rgba = text?.messages(7)[0]?.numbers(0) ?? [];
        tally.texts++;
        const box2: TextBoxElement = {
          id: `t${tally.texts}`,
          x: box.x,
          y: box.y,
          w: box.w,
          text: words,
          color: rgba.length >= 3 ? hexColor(rgba[0], rgba[1], rgba[2]) : "#000000",
          fontSize: round2(Math.max(12, (text?.numbers(10)[0] ?? 16) * k)),
        };
        page.textBoxes.push(box2);
      } else if (body.span(13)) {
        // Lines, curves and free-form shapes: a path in the frame's own
        // coordinates, drawn with the shape's outline colour and width.
        const stroke = pathStroke(body, cx - w / 2, cy - h / 2);
        if (!stroke) {
          tally.skipped++;
          continue;
        }
        tally.strokes++;
        page.strokes.push({ id: `s${tally.strokes}`, ...stroke });
      } else tally.skipped++;
    } catch {
      tally.skipped++;
    }
  }
}

/** Points sampled along each curve segment of a shape's path. */
const CURVE_STEPS = 16;

/**
 * A path shape (`6.13`: coordinates in `1`, commands in `2`: 0 move, 1 line,
 * 2 quadratic, 3 cubic curve, 4 close) as one stroke, offset by the frame's
 * top-left corner. Coordinates no command used are drawn as straight lines.
 */
function pathStroke(body: NotefulMessage, left: number, top: number): Omit<Stroke, "id"> | null {
  const path = body.message(13);
  const coords = path?.numbers(1) ?? [];
  const commands = path?.numbers(2) ?? [];
  const k = NOTEFUL_SCALE;
  const points: Array<[number, number]> = [];
  let next = 0;
  const take = (): [number, number] | null => {
    if (2 * next + 1 >= coords.length) return null;
    const p: [number, number] = [coords[2 * next], coords[2 * next + 1]];
    next++;
    return p;
  };
  let start: [number, number] | null = null;
  let last: [number, number] | null = null;
  for (const command of commands) {
    if (command === 0 || command === 1) {
      const p = take();
      if (!p) break;
      if (command === 0) start = p;
      points.push(p);
      last = p;
    } else if (command === 2 || command === 3) {
      const controls = command === 2 ? [take(), take()] : [take(), take(), take()];
      if (controls.some((c) => !c) || !last) break;
      const from: [number, number] = last;
      const [a, b, c] = controls as Array<[number, number]>;
      for (let s = 1; s <= CURVE_STEPS; s++) {
        const t = s / CURVE_STEPS;
        const u = 1 - t;
        points.push(
          command === 2
            ? [
                u * u * from[0] + 2 * u * t * a[0] + t * t * b[0],
                u * u * from[1] + 2 * u * t * a[1] + t * t * b[1],
              ]
            : [
                u * u * u * from[0] +
                  3 * u * u * t * a[0] +
                  3 * u * t * t * b[0] +
                  t * t * t * c[0],
                u * u * u * from[1] +
                  3 * u * u * t * a[1] +
                  3 * u * t * t * b[1] +
                  t * t * t * c[1],
              ],
        );
      }
      last = command === 2 ? b : c;
    } else if (command === 4 && start) {
      points.push(start);
    }
  }
  for (let p = take(); p; p = take()) points.push(p);
  const pts: number[] = [];
  for (const [x, y] of points) pushPoint(pts, (left + x) * k, (top + y) * k);
  if (pts.length === 0) return null;
  const outline = body.message(7);
  const rgba = outline?.message(7)?.numbers(0) ?? [];
  const width = outline?.number(2) ?? 2;
  return {
    color: rgba.length >= 3 ? hexColor(rgba[0], rgba[1], rgba[2]) : "#000000",
    size: round2(Math.max(0.1, (Number.isFinite(width) ? width : 2) * k)),
    tool: "pen",
    pts,
  };
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
