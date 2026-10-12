/**
 * Goodnotes 6 notebooks (`.goodnotes`) as FineNotes documents. Pure.
 *
 * The format is undocumented; this reads what was found in real files
 * (2026-10, see `research/IMPORT-FORMATS.md` in the dev repo). A `.goodnotes`
 * file is a zip:
 *
 * - `index.events.pb`: the notebook as a log of changes, each a
 *   length-prefixed protobuf record `{1: target id, <kind>: body}`, the latest
 *   event winning. Kind 30/31 names the notebook; kind 6 records an
 *   attachment (`2` its file in `attachments/`, which for an imported PDF is
 *   not the record's own id); kind 2 defines a paper template (`4` an
 *   attachment record, `5` the PDF page, 1-based, `8` its size); kind 54 adds
 *   a page (its template, and an order key that sorts as plain bytes); kinds
 *   56 and 57 set a flag on a page, `{3: {1: 1}}` for on and `{3: {}}` for
 *   off: 56 removes the page, 57 bookmarks it; kind 62 is an outline entry
 *   (`1` its page, `5` the title, `6` its order, `3.1` a point on the page
 *   with y up from the bottom).
 * - `notes/<id>`: one page's content, as header/body record pairs. The id is
 *   the page's id plus one. A body `{7: …}` is a stroke, `{1: …}` a picture,
 *   `{21: …}` a text box (or a shape, when it holds no text), `{20: …}` a
 *   comment. A header with `{3: 1}` marks its element deleted.
 * - `attachments/<id>`: paper PDFs and pictures, as they are.
 *
 * A stroke's points are Apple-LZ4 compressed, in a small typed layout
 * (`tpl\0`, length, a signature like `vA(v)A(u)…`, then the values). Two
 * layouts exist (the stroke's field 21 names its schema):
 *
 * - 24: ten flat arrays. The second-last holds the pen samples, the last one
 *   entry per sample, so the stride is their ratio: 5 floats for a pen (x, y,
 *   half-width, two not used here), 7 for the marker (x, y, a value not used
 *   here, half-width, three more).
 * - 25: arrays of structs, `A(S(…))`. A start point (x, y, azimuth,
 *   altitude, force), then segments of 11 floats: one not used here and two
 *   more points. The width is the layout's first float, for the whole stroke.
 *
 * A stroke moved with the lasso keeps its points and gains an offset
 * (field 6, `{1: dx, 2: dy}`).
 */

import type {
  ImageElement,
  InkDocument,
  Page,
  PageSection,
  Stroke,
  TextBoxElement,
} from "../model/document";
import { SCHEMA_VERSION } from "../constants";
import { normalizePageTitle } from "../model/contents";
import { decodeAppleLz4 } from "./apple-lz4";
import {
  fontFor,
  hexColor,
  median,
  packageRoot,
  pageScale,
  plural,
  pressureForWidth,
  round2,
  sniffFile,
  type ImportAttachment,
  type ImportResult,
} from "./import-types";
import { Message, splitDelimited } from "./protobuf";

export class GoodnotesError extends Error {}

/**
 * Goodnotes' page units per millimetre: its Letter page is 834.24 units
 * across 215.9 mm.
 */
export const GOODNOTES_UNITS_PER_MM = 834.24 / 215.9;

/** Below this opacity a stroke is taken for the highlighter. */
const HIGHLIGHTER_ALPHA = 0.95;

/**
 * An outline entry this close to the top of its page (a share of the page's
 * height) names the page itself; one further down is a heading inside it.
 * Goodnotes puts the entries it makes from a PDF's own outline at the very top.
 */
const PAGE_TITLE_BAND = 0.05;

/** Goodnotes' "use the box's own size" for a run of text. */
const INHERITED_FONT_SIZE = -404;

/** Whether a set of zip entries is a Goodnotes notebook. */
export function isGoodnotes(files: ReadonlyMap<string, Uint8Array>): boolean {
  return findRoot(files) !== null;
}

function findRoot(files: ReadonlyMap<string, Uint8Array>): string | null {
  return packageRoot(files, "index.events.pb");
}

interface Template {
  width: number;
  height: number;
  /** An attachment record id (kind 6), or a file id for files without one. */
  attachment?: string;
  /** 0-based page of a PDF attachment. */
  pdfPage: number;
}

interface PageEntry {
  id: string;
  template?: string;
  order: string;
  deleted: boolean;
  bookmarked: boolean;
  created: number;
}

interface OutlineEntry {
  page: string;
  title: string;
  order: string;
  /** Distance from the bottom of the page, in Goodnotes units; absent is 0. */
  y: number;
  x: number;
}

/**
 * Convert one notebook, given its zip entries. `fileTitle` names it: the
 * name the notebook was exported under is the one the user gave it, while
 * the name inside the package is often Goodnotes' default ("Untitled", or
 * the PDF's own name). The inner name is used only when `fileTitle` is empty.
 */
export function readGoodnotes(
  files: ReadonlyMap<string, Uint8Array>,
  fileTitle: string,
): ImportResult {
  const root = findRoot(files);
  if (root === null) throw new GoodnotesError("not a Goodnotes notebook");
  const file = (path: string): Uint8Array | undefined => files.get(root + path);

  let title = "";
  const records = new Map<string, string>();
  const templates = new Map<string, Template>();
  const pages = new Map<string, PageEntry>();
  const outline = new Map<string, OutlineEntry>();
  let created = 0;
  for (const record of splitDelimited(file("index.events.pb") ?? new Uint8Array())) {
    let event: Message;
    try {
      event = Message.parse(record);
    } catch {
      continue;
    }
    const id = event.string(1);
    const kind = event.fields.find((f) => f.field !== 1 && f.wire === 2);
    if (!id || !kind?.bytes) continue;
    let body: Message;
    try {
      body = Message.parse(kind.bytes);
    } catch {
      continue;
    }
    switch (kind.field) {
      case 30:
      case 31: {
        const name = body.message(2)?.string(1);
        if (name) title = name;
        break;
      }
      case 6: {
        const target = body.string(2);
        if (target) records.set(id, target);
        break;
      }
      case 2: {
        const size = body.message(8);
        const width = size?.float(1);
        const height = size?.float(2);
        if (width && height && width > 0 && height > 0) {
          const page = Math.round(num(body, 5) ?? 1);
          templates.set(id, {
            width,
            height,
            attachment: body.string(4),
            pdfPage: Math.max(0, page - 1),
          });
        }
        break;
      }
      case 54:
        pages.set(id, {
          id,
          template: body.message(3)?.string(1),
          order: body.message(4)?.string(1) ?? "",
          deleted: false,
          bookmarked: false,
          created: created++,
        });
        break;
      case 56: {
        const page = pages.get(id);
        if (page) page.deleted = flagOn(body);
        break;
      }
      case 57: {
        const page = pages.get(id);
        if (page) page.bookmarked = flagOn(body);
        break;
      }
      case 62: {
        const entry = body.string(2);
        const page = body.string(1);
        const text = body.string(5);
        if (!entry || !page || text === undefined) break;
        const point = body.message(3)?.message(1);
        outline.set(entry, {
          page,
          title: text,
          order: body.string(6) ?? "",
          x: num(point, 1) ?? 0,
          y: num(point, 2) ?? 0,
        });
        break;
      }
    }
  }

  const live = [...pages.values()]
    .filter((p) => !p.deleted)
    .sort((a, b) => compareKeys(a.order, b.order) || a.created - b.created);
  if (live.length === 0) throw new GoodnotesError("the notebook has no pages");

  // A template the package does not carry (one of Goodnotes' built-in ones)
  // gets the paper most of the other pages have.
  const counts = new Map<string, number>();
  for (const p of live) {
    if (p.template && templates.has(p.template)) {
      counts.set(p.template, (counts.get(p.template) ?? 0) + 1);
    }
  }
  const common = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  const name = fileTitle || title || "Imported notebook";
  const attachments: ImportAttachment[] = [];
  const attached = new Map<string, string>();
  /** A file in `attachments/`, by record or file id; its name in the result, or null. */
  const attach = (id: string, label: string): string | null => {
    const fileId = records.get(id) ?? id;
    const known = attached.get(fileId);
    if (known) return known;
    const bytes = file(`attachments/${fileId}`);
    if (!bytes || bytes.length === 0) return null;
    const { mime, ext } = sniffFile(bytes);
    const fileName = `${name} - ${label} ${attachments.length + 1}.${ext}`;
    attachments.push({ name: fileName, bytes, mime });
    attached.set(fileId, fileName);
    return fileName;
  };

  const outlineByPage = new Map<string, OutlineEntry[]>();
  for (const entry of [...outline.values()].sort((a, b) => compareKeys(a.order, b.order))) {
    const list = outlineByPage.get(entry.page) ?? [];
    list.push(entry);
    outlineByPage.set(entry.page, list);
  }

  const warnings: string[] = [];
  const skipped = { shapes: 0, comments: 0, pdfPictures: 0, other: 0 };
  let missingPaper = 0;
  let unreadableStrokes = 0;
  let strokeN = 0;
  let imageN = 0;
  let textN = 0;
  let sectionN = 0;

  const docPages: Page[] = live.map((entry, index) => {
    const templateId = entry.template && templates.has(entry.template) ? entry.template : common;
    if (templateId !== entry.template) missingPaper++;
    const template = templateId ? templates.get(templateId) : undefined;
    const width = template?.width ?? 834.24;
    const height = template?.height ?? 1078.825;
    const k = pageScale(width, width / GOODNOTES_UNITS_PER_MM);
    const paper = template?.attachment ? attach(template.attachment, "paper") : null;

    const page: Page = {
      id: `p${index + 1}`,
      kind: "ink",
      geometry: { width: Math.round(width * k), height: Math.round(height * k) },
      backdrop: paper
        ? { kind: "pdf", path: paper, page: template?.pdfPage ?? 0 }
        : { kind: "blank" },
      strokes: [],
      images: [],
      textBoxes: [],
    };
    if (entry.bookmarked) page.bookmarked = true;

    const sections: PageSection[] = [];
    for (const item of outlineByPage.get(entry.id) ?? []) {
      const text = normalizePageTitle(item.title);
      if (!text) continue;
      const fromTop = Math.max(0, height - item.y);
      if (page.title === undefined && fromTop <= height * PAGE_TITLE_BAND) {
        page.title = text;
      } else {
        sections.push({
          id: `c${++sectionN}`,
          x: round2(Math.max(0, item.x) * k),
          y: round2(fromTop * k),
          title: text,
        });
      }
    }
    if (sections.length > 0) page.sections = sections.sort((a, b) => a.y - b.y);

    const content = file(`notes/${layerId(entry.id)}`);
    // Whether the last header marked its element removed (`{3: 1}`): a
    // picture deleted in Goodnotes stays in the file with that mark.
    let removed = false;
    for (const record of content ? splitDelimited(content) : []) {
      let outer: Message;
      try {
        outer = Message.parse(record);
      } catch {
        continue;
      }
      // Headers carry several fields; a body is one length-delimited field.
      if (outer.fields.length !== 1 || outer.fields[0].wire !== 2) {
        removed = (outer.int(3) ?? 0) !== 0;
        continue;
      }
      if (removed) continue;
      const kind = outer.fields[0].field;
      const body = outer.message(kind);
      if (!body) continue;
      if (kind === 7) {
        const stroke = readStroke(body, k, `s${strokeN + 1}`);
        if (stroke) {
          page.strokes.push(stroke);
          strokeN++;
        } else unreadableStrokes++;
      } else if (kind === 1) {
        const image = readImage(body, k, `i${imageN + 1}`, (id) => attach(id, "picture"));
        if (image === "pdf") skipped.pdfPictures++;
        else if (image) {
          page.images.push(image);
          imageN++;
        } else skipped.other++;
      } else if (kind === 21) {
        const box = readTextBox(body, k, `t${textN + 1}`);
        if (box) {
          page.textBoxes.push(box);
          textN++;
        } else skipped.shapes++;
      } else if (kind === 20) {
        skipped.comments++;
      } else skipped.other++;
    }
    return page;
  });

  if (missingPaper > 0) {
    warnings.push(
      `${plural(missingPaper, "page uses", "pages use")} a Goodnotes paper that is not in the file; ` +
        "the notebook's usual paper was used instead.",
    );
  }
  if (unreadableStrokes > 0)
    warnings.push(`${plural(unreadableStrokes, "stroke")} could not be read.`);
  if (skipped.shapes > 0)
    warnings.push(`${plural(skipped.shapes, "shape")} could not be brought over yet.`);
  if (skipped.comments > 0)
    warnings.push(`${plural(skipped.comments, "comment")} could not be brought over yet.`);
  if (skipped.pdfPictures > 0) {
    warnings.push(
      `${plural(skipped.pdfPictures, "PDF placed as a picture", "PDFs placed as pictures")} ` +
        "could not be brought over yet.",
    );
  }
  if (skipped.other > 0) {
    warnings.push(`${plural(skipped.other, "other item")} could not be brought over yet.`);
  }

  const first = docPages[0];
  const doc: InkDocument = {
    version: SCHEMA_VERSION,
    view: { scrollY: 0, width: first.geometry.width, scale: 1 },
    pages: docPages,
  };
  return { source: "goodnotes", title: name, doc, attachments, warnings };
}

/** Order keys compare as plain bytes (`-QKIL` sorts before `4zLQe01`). */
function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The id of a page's content file: the page id with one added to its last group. */
export function layerId(pageId: string): string {
  const dash = pageId.lastIndexOf("-");
  const tail = pageId.slice(dash + 1);
  if (dash < 0 || !/^[0-9a-fA-F]{1,12}$/.test(tail)) return pageId;
  const next = (BigInt(`0x${tail}`) + 1n).toString(16).toUpperCase().padStart(tail.length, "0");
  return pageId.slice(0, dash + 1) + next.slice(-tail.length);
}

/** One pen sample in Goodnotes units. */
export interface PenPoint {
  x: number;
  y: number;
  /** Half the stroke's width here, when the layout records it per sample. */
  half?: number;
}

/** A stroke's samples, and the half-width of the whole stroke when no sample has one. */
export interface PenPath {
  points: PenPoint[];
  half?: number;
}

function readStroke(body: Message, k: number, id: string): Stroke | null {
  const data = body.bytes(2);
  if (!data) return null;
  let path: PenPath;
  try {
    path = penPath(decodeAppleLz4(data));
  } catch {
    return null;
  }
  const offset = body.message(6);
  const dx = finite(offset?.float(1));
  const dy = finite(offset?.float(2));
  const points = path.points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (points.length === 0) return null;

  const halves = points.map((p) => p.half).filter((h): h is number => h !== undefined);
  const half = halves.length > 0 ? median(halves) : (path.half ?? 1);
  const size = round2(Math.max(0.1, 2 * half * k));
  const pts: number[] = [];
  for (const p of points) {
    const pressure = p.half === undefined ? 0.5 : pressureForWidth(2 * p.half * k, size);
    pts.push((p.x + dx) * k, (p.y + dy) * k, pressure);
  }

  const colour = body.message(4);
  const [r, g, b, a] = [1, 2, 3, 4].map((f) => colour?.float(f) ?? (f === 4 ? 1 : 0));
  return {
    id,
    color: hexColor(r, g, b),
    size,
    tool: a < HIGHLIGHTER_ALPHA ? "highlighter" : "pen",
    pts,
  };
}

/** The pen samples of a decompressed stroke, in either layout. Throws on anything else. */
export function penPath(raw: Uint8Array): PenPath {
  const layout = readTplLayout(raw);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const f32 = (at: number): number => view.getFloat32(at, true);
  const { arrays } = layout;

  if (arrays.some((a) => a.kind === "S")) {
    // Schema 25: a start point, then segments of two points each.
    const start = arrays.find((a) => a.kind === "S" && a.fields === "uuuuu");
    const segments = arrays.find((a) => a.kind === "S" && a.fields === "u".repeat(11));
    if (!start || !segments || start.count < 1) {
      throw new GoodnotesError("unexpected stroke layout");
    }
    const points: PenPoint[] = [{ x: f32(start.at), y: f32(start.at + 4) }];
    for (let i = 0; i < segments.count; i++) {
      const at = segments.at + i * segments.size;
      points.push({ x: f32(at + 4), y: f32(at + 8) }, { x: f32(at + 24), y: f32(at + 28) });
    }
    const width = layout.scalars.find((s) => s.kind === "u");
    const w = width ? f32(width.at) : NaN;
    return { points, half: Number.isFinite(w) && w > 0 ? w / 2 : undefined };
  }

  // Schema 24: the second-last array holds the samples, the last one entry per sample.
  const samples = arrays[arrays.length - 2];
  const perSample = arrays[arrays.length - 1];
  if (!samples || !perSample || samples.kind !== "u" || perSample.count < 1) {
    throw new GoodnotesError("unexpected stroke layout");
  }
  const stride = samples.count / perSample.count;
  if (!Number.isInteger(stride) || stride < 3) throw new GoodnotesError("unexpected stroke layout");
  const halfAt = stride === 5 ? 2 : stride === 7 ? 3 : -1;
  const points: PenPoint[] = [];
  for (let i = 0; i < perSample.count; i++) {
    const at = samples.at + i * stride * 4;
    const point: PenPoint = { x: f32(at), y: f32(at + 4) };
    if (halfAt >= 0) point.half = f32(at + halfAt * 4);
    points.push(point);
  }
  // Without a known per-sample width, the start point's third value is the stroke's.
  const startPoint = arrays[1];
  const half = startPoint?.kind === "u" && startPoint.count >= 3 ? f32(startPoint.at + 8) : NaN;
  return { points, half: halfAt < 0 && Number.isFinite(half) && half > 0 ? half : undefined };
}

/** The pen samples of a schema-24 stroke as flat floats, five or seven a sample. */
export function penSamples(raw: Uint8Array): Float32Array {
  const arrays = readTpl(raw);
  const samples = arrays[arrays.length - 2];
  if (!samples || samples.kind !== "u") throw new GoodnotesError("unexpected stroke layout");
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const out = new Float32Array(samples.count);
  for (let i = 0; i < samples.count; i++) out[i] = view.getFloat32(samples.at + i * 4, true);
  return out;
}

interface TplScalar {
  kind: "u" | "v";
  at: number;
}

interface TplArray {
  /** `S` is an array of structs. */
  kind: "u" | "v" | "S";
  count: number;
  /** Offset of the first item. */
  at: number;
  /** Bytes per item. */
  size: number;
  /** A struct's field types, such as `uuuuu`; for `u` and `v` the type itself. */
  fields: string;
}

/** A `tpl` layout: its loose values and its arrays. */
export function readTplLayout(raw: Uint8Array): { scalars: TplScalar[]; arrays: TplArray[] } {
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (raw.length < 9 || String.fromCharCode(...raw.subarray(0, 4)) !== "tpl\0") {
    throw new GoodnotesError("not a tpl block");
  }
  const sigEnd = raw.indexOf(0, 8);
  if (sigEnd < 0) throw new GoodnotesError("unterminated signature");
  const signature = String.fromCharCode(...raw.subarray(8, sigEnd));
  const width = (t: string): number => {
    if (t === "v") return 2;
    if (t === "u") return 4;
    throw new GoodnotesError(`unknown type ${t}`);
  };
  /** The text inside the brackets that open at `open`, and the index after them. */
  const group = (open: number): [string, number] => {
    if (signature[open] !== "(") throw new GoodnotesError("bad signature");
    const close = signature.indexOf(")", open);
    if (close < 0) throw new GoodnotesError("bad signature");
    return [signature.slice(open + 1, close), close + 1];
  };

  const scalars: TplScalar[] = [];
  const arrays: TplArray[] = [];
  let at = sigEnd + 1;
  for (let s = 0; s < signature.length;) {
    const c = signature[s];
    if (c === "A") {
      let item: string;
      let next: number;
      if (signature[s + 2] === "S") {
        // `A(S(uuu))`: the struct's own brackets close one before the array's.
        [item, next] = group(s + 3);
        if (signature[next] !== ")") throw new GoodnotesError("bad signature");
        next += 1;
      } else {
        [item, next] = group(s + 1);
        if (item.length !== 1) throw new GoodnotesError("bad signature");
      }
      const struct = signature[s + 2] === "S";
      const size = [...item].reduce((n, t) => n + width(t), 0);
      if (at + 4 > raw.length) throw new GoodnotesError("array past end");
      const count = view.getUint32(at, true);
      at += 4;
      const end = at + count * size;
      if (end > raw.length) throw new GoodnotesError("array past end");
      arrays.push({ kind: struct ? "S" : (item as "u" | "v"), count, at, size, fields: item });
      at = end;
      s = next;
    } else {
      const size = width(c);
      if (at + size > raw.length) throw new GoodnotesError("value past end");
      scalars.push({ kind: c as "u" | "v", at });
      at += size;
      s += 1;
    }
  }
  return { scalars, arrays };
}

/** The arrays of a `tpl` layout: where each starts and how many items it has. */
export function readTpl(raw: Uint8Array): TplArray[] {
  return readTplLayout(raw).arrays;
}

/** A picture element, `"pdf"` for a PDF placed as a picture (not drawable yet), or null. */
function readImage(
  body: Message,
  k: number,
  id: string,
  attach: (attachmentId: string) => string | null,
): ImageElement | "pdf" | null {
  const attachment = body.string(4);
  const frame = body.message(2);
  const origin = frame?.message(1);
  const size = frame?.message(2);
  const x = origin?.float(1) ?? 0;
  const y = origin?.float(2) ?? 0;
  const w = size?.float(1);
  const h = size?.float(2);
  if (!attachment || !w || !h || w <= 0 || h <= 0) return null;
  const path = attach(attachment);
  if (!path) return null;
  if (path.endsWith(".pdf")) return "pdf";
  return { id, path, x: round2(x * k), y: round2(y * k), w: round2(w * k), h: round2(h * k) };
}

/**
 * A text box with text in it, or null for one without (a shape: Goodnotes
 * makes shapes as empty text boxes with an outline). Its top-left is field
 * `20.1`, the text sits inside the insets of `32.10`; a fixed width is
 * `21.2.1`, otherwise the box grows with its text (`32.2` is that text's size).
 */
function readTextBox(body: Message, k: number, id: string): TextBoxElement | null {
  const store = body.message(32);
  const data = store?.message(1)?.bytes(2);
  if (!store || !data) return null;
  let runs: Message[];
  try {
    runs = Message.parse(decodeAppleLz4(data))
      .fields.filter((f) => f.field === 1 && f.wire === 2 && f.bytes)
      .map((f) => Message.parse(f.bytes as Uint8Array));
  } catch {
    return null;
  }
  const text = runs.map((run) => run.string(1) ?? "").join("");
  if (text.trim() === "") return null;

  const origin = body.message(20)?.message(1);
  const insets = store.message(10);
  const left = finite(num(insets, 2), 10);
  const top = finite(num(insets, 1), 10);
  const right = finite(num(insets, 4), 10);
  const fixedWidth = num(body.message(21)?.message(2), 1);
  const textWidth = num(store.message(2), 1);

  const font = store.message(5)?.message(1);
  const attrs = runs.find((run) => (run.string(1) ?? "").trim() !== "")?.message(2);
  const runSize = num(attrs, 40);
  const size =
    runSize !== undefined && runSize !== INHERITED_FONT_SIZE && runSize > 0
      ? runSize
      : (num(font, 40) ?? 24);
  const colour = attrs?.message(3);
  const family = attrs?.string(30) ?? font?.string(30);

  const box: TextBoxElement = {
    id,
    x: round2((finite(origin?.float(1)) + left) * k),
    y: round2((finite(origin?.float(2)) + top) * k),
    w: round2(
      Math.max(
        8,
        (fixedWidth && Number.isFinite(fixedWidth)
          ? fixedWidth - left - right
          : (textWidth ?? 200)) * k,
      ),
    ),
    text,
    color: colour
      ? hexColor(colour.float(1) ?? 0, colour.float(2) ?? 0, colour.float(3) ?? 0)
      : "#000000",
    fontSize: round2(Math.max(12, size * k)),
  };
  if (!(fixedWidth && Number.isFinite(fixedWidth))) box.fit = true;
  const typeface = fontFor(family);
  if (typeface !== "sans") box.font = typeface;
  const fill = body.message(30)?.message(1)?.message(1);
  if (fill && (fill.float(4) ?? 0) > 0) {
    box.fill = hexColor(fill.float(1) ?? 0, fill.float(2) ?? 0, fill.float(3) ?? 0);
  }
  return box;
}

/** A page flag event's value: `{3: {1: 1}}` is on, anything else off. */
function flagOn(body: Message): boolean {
  return (body.message(3)?.int(1) ?? 0) !== 0;
}

/** A number stored either as a float or as a varint. */
function num(message: Message | undefined, field: number): number | undefined {
  return message?.float(field) ?? message?.double(field) ?? message?.int(field);
}

function finite(v: number | undefined, fallback = 0): number {
  return v !== undefined && Number.isFinite(v) ? v : fallback;
}
