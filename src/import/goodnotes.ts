/**
 * Goodnotes 6 notebooks (`.goodnotes`) as FineNotes documents. Pure.
 *
 * The format is undocumented; this reads what was found in real files
 * (2026-10). A `.goodnotes` file is a zip:
 *
 * - `index.events.pb`: the notebook as a log of changes, each a
 *   length-prefixed protobuf record `{1: target id, <kind>: body}`. Kind 30/31
 *   names the notebook; kind 2 defines a paper template (its size, and a PDF
 *   in `attachments/`); kind 54 adds a page (its template, and a fractional
 *   order key). Kinds 56 and 57 set a flag on a page, `{3: {1: 1}}` for on
 *   and `{3: {}}` for off, the latest event winning: 56 removes the page, 57
 *   bookmarks it. Read from a real notebook (2026-10-12) whose bookmarked
 *   page carried a 57 and whose removed page a 56; a page bookmarked and
 *   un-bookmarked again carries a 57 with the flag off.
 * - `notes/<id>`: one page's content, as header/body record pairs. The id is
 *   the page's id plus one. A body `{7: …}` is a stroke, `{1: …}` a picture.
 *   A header with `{3: 1}` marks its element deleted.
 * - `attachments/<id>`: paper PDFs and pictures, as they are.
 *
 * A stroke's points are Apple-LZ4 compressed, in a small typed layout
 * (`tpl\0`, length, a signature like `vA(v)A(u)…`, then the values). Its
 * second-last array holds the pen samples, five float32s each: x, y and the
 * half-width drawn there, then two numbers not used here.
 */

import type { ImageElement, InkDocument, Page, Stroke } from "../model/document";
import { SCHEMA_VERSION } from "../constants";
import { decodeAppleLz4 } from "./apple-lz4";
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
import { Message, splitDelimited } from "./protobuf";

export class GoodnotesError extends Error {}

/**
 * Goodnotes' page units per millimetre: its Letter page is 834.24 units
 * across 215.9 mm.
 */
export const GOODNOTES_UNITS_PER_MM = 834.24 / 215.9;

/** Below this opacity a stroke is taken for the highlighter. */
const HIGHLIGHTER_ALPHA = 0.95;

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
  attachment?: string;
}

interface PageEntry {
  id: string;
  template?: string;
  order: string;
  deleted: boolean;
  bookmarked: boolean;
  created: number;
}

/**
 * Convert one notebook, given its zip entries. `fallbackTitle` is used when
 * the notebook has no name of its own.
 */
export function readGoodnotes(
  files: ReadonlyMap<string, Uint8Array>,
  fallbackTitle: string,
): ImportResult {
  const root = findRoot(files);
  if (root === null) throw new GoodnotesError("not a Goodnotes notebook");
  const file = (path: string): Uint8Array | undefined => files.get(root + path);

  let title = "";
  const templates = new Map<string, Template>();
  const pages = new Map<string, PageEntry>();
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
      case 2: {
        const size = body.message(8);
        const width = size?.float(1);
        const height = size?.float(2);
        if (width && height && width > 0 && height > 0) {
          templates.set(id, { width, height, attachment: body.string(4) });
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
    }
  }

  const live = [...pages.values()]
    .filter((p) => !p.deleted)
    .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : a.created - b.created));
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

  const name = title || fallbackTitle;
  const attachments: ImportAttachment[] = [];
  const attached = new Map<string, string>();
  const attach = (id: string, label: string): string | null => {
    const known = attached.get(id);
    if (known) return known;
    const bytes = file(`attachments/${id}`);
    if (!bytes || bytes.length === 0) return null;
    const { mime, ext } = sniffFile(bytes);
    const fileName = `${name} - ${label} ${attachments.length + 1}.${ext}`;
    attachments.push({ name: fileName, bytes, mime });
    attached.set(id, fileName);
    return fileName;
  };

  const warnings: string[] = [];
  let missingPaper = 0;
  let skippedElements = 0;
  let unreadableStrokes = 0;
  let strokeN = 0;
  let imageN = 0;

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
      backdrop: paper ? { kind: "pdf", path: paper, page: 0 } : { kind: "blank" },
      strokes: [],
      images: [],
      textBoxes: [],
    };
    if (entry.bookmarked) page.bookmarked = true;

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
        if (image) {
          page.images.push(image);
          imageN++;
        } else skippedElements++;
      } else skippedElements++;
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
  if (skippedElements > 0) {
    warnings.push(
      `${plural(skippedElements, "item")} (text boxes, shapes or other elements) could not be brought over yet.`,
    );
  }

  const first = docPages[0];
  const doc: InkDocument = {
    version: SCHEMA_VERSION,
    view: { scrollY: 0, width: first.geometry.width, scale: 1 },
    pages: docPages,
  };
  return { source: "goodnotes", title: name, doc, attachments, warnings };
}

/** The id of a page's content file: the page id with one added to its last group. */
export function layerId(pageId: string): string {
  const dash = pageId.lastIndexOf("-");
  const tail = pageId.slice(dash + 1);
  if (dash < 0 || !/^[0-9a-fA-F]{1,12}$/.test(tail)) return pageId;
  const next = (BigInt(`0x${tail}`) + 1n).toString(16).toUpperCase().padStart(tail.length, "0");
  return pageId.slice(0, dash + 1) + next.slice(-tail.length);
}

function readStroke(body: Message, k: number, id: string): Stroke | null {
  const data = body.bytes(2);
  if (!data) return null;
  let samples: Float32Array;
  try {
    samples = penSamples(decodeAppleLz4(data));
  } catch {
    return null;
  }
  const n = samples.length / 5;
  if (n < 1) return null;
  const halves: number[] = [];
  for (let i = 0; i < n; i++) halves.push(samples[i * 5 + 2]);
  const size = round2(Math.max(0.1, 2 * median(halves) * k));
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = samples[i * 5];
    const y = samples[i * 5 + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    pts.push(x * k, y * k, pressureForWidth(2 * samples[i * 5 + 2] * k, size));
  }
  if (pts.length === 0) return null;

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

/** The pen samples of a decompressed stroke: its second-last array, five floats a sample. */
export function penSamples(raw: Uint8Array): Float32Array {
  const arrays = readTpl(raw);
  const samples = arrays[arrays.length - 2];
  if (!samples || samples.kind !== "u" || samples.count % 5 !== 0) {
    throw new GoodnotesError("unexpected stroke layout");
  }
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const out = new Float32Array(samples.count);
  for (let i = 0; i < samples.count; i++) out[i] = view.getFloat32(samples.at + i * 4, true);
  return out;
}

interface TplArray {
  kind: "u" | "v";
  count: number;
  /** Offset of the first item. */
  at: number;
}

/** The arrays of a `tpl` layout: where each starts and how many items it has. */
export function readTpl(raw: Uint8Array): TplArray[] {
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
  const arrays: TplArray[] = [];
  let at = sigEnd + 1;
  for (let s = 0; s < signature.length;) {
    if (signature[s] === "A") {
      const t = signature[s + 2];
      if (signature[s + 1] !== "(" || signature[s + 3] !== ")")
        throw new GoodnotesError("bad signature");
      if (at + 4 > raw.length) throw new GoodnotesError("array past end");
      const count = view.getUint32(at, true);
      at += 4;
      const end = at + count * width(t);
      if (end > raw.length) throw new GoodnotesError("array past end");
      arrays.push({ kind: t as "u" | "v", count, at });
      at = end;
      s += 4;
    } else {
      at += width(signature[s]);
      s += 1;
    }
  }
  return arrays;
}

function readImage(
  body: Message,
  k: number,
  id: string,
  attach: (attachmentId: string) => string | null,
): ImageElement | null {
  const attachment = body.string(4);
  const frame = body.message(2);
  const origin = frame?.message(1);
  const size = frame?.message(2);
  const x = origin?.float(1);
  const y = origin?.float(2);
  const w = size?.float(1);
  const h = size?.float(2);
  if (!attachment || x === undefined || y === undefined || !w || !h || w <= 0 || h <= 0)
    return null;
  const path = attach(attachment);
  if (!path) return null;
  return { id, path, x: round2(x * k), y: round2(y * k), w: round2(w * k), h: round2(h * k) };
}

/** A page flag event's value: `{3: {1: 1}}` is on, anything else off. */
function flagOn(body: Message): boolean {
  return (body.message(3)?.int(1) ?? 0) !== 0;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
