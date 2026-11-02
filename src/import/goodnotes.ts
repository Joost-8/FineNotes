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
 *   a page (its template, and an order key that sorts as plain bytes), each
 *   value with a clock (`{1: value, 2: {1: counter}}`); kind 3 gives a page
 *   another paper and kind 55 moves it, the higher counter winning; kinds
 *   56 and 57 set a flag on a page, `{3: {1: 1}}` for on and `{3: {}}` for
 *   off: 56 removes the page, 57 bookmarks it; kind 62 is an outline entry
 *   (`1` its page, `5` the title, `6` its order, `3.1` a point on the page
 *   with y up from the bottom).
 * - `notes/<id>`: one page's content, as header/body record pairs. The id is
 *   the page's id plus one. A body `{7: …}` is a stroke, `{1: …}` a picture
 *   (`3` its centre, own size and turn when turned), `{21: …}` a text box (or
 *   a shape, when it holds no text), `{8: …}` an older text box holding RTF,
 *   `{20: …}` a comment. A header with `{3: 1}` marks its element deleted.
 * - `attachments/<id>`: paper PDFs and pictures, as they are.
 *
 * A stroke's points are Apple-LZ4 compressed, in a small typed layout
 * (`tpl\0`, length, a signature like `vA(v)A(u)…`, then the values). Every
 * layout starts with the stroke's centreline: an array of verbs (move to, or
 * a quadratic curve to) and the points and curves they read (`centreline`).
 * A `u` among the leading values is the stroke's full width, -1 when every
 * point has its own. The layouts seen:
 *
 * - `vuA(v)A(S(uu))A(S(uuuu))…`, the commonest: the centreline as structs,
 *   at the stroke's width.
 * - 24, `vA(v)A(u)A(u)…`: ten flat arrays, the centreline's points with their
 *   half-widths. The second-last array holds the pen samples, the last one
 *   entry per sample, so the stride is their ratio: 5 floats for a pen (x, y,
 *   half-width, two not used here), 7 for the marker (x, y, a value not used
 *   here, half-width, three more). Some strokes leave the samples empty; theirs
 *   is the centreline.
 * - `vuA(v)A(u)A(u)…`: the same ten arrays behind a width, the samples always
 *   empty: the centreline, its verbs 2 and 3 carrying full widths.
 * - 25: arrays of structs, `A(S(…))`. A start point (x, y, azimuth,
 *   altitude, force), then segments of 11 floats: one not used here and two
 *   more points. The width is the layout's first float, for the whole stroke.
 *
 * Stroke field 9 is what shape recognition made of the stroke (a polyline,
 * or a frame and a turn); it is not read here. A stroke moved with the lasso
 * keeps its points and gains an offset (field 6, `{1: dx, 2: dy}`).
 */

import { canFill, isClosedLoop, readFill } from "../model/shape-style";
import type {
  ImageElement,
  InkDocument,
  Page,
  PageSection,
  ShapeKind,
  Stroke,
  TextBoxElement,
} from "../model/document";
import { SCHEMA_VERSION } from "../constants";
import { MIN_TEXT_BOX_WIDTH, isBorderWidth, isCornerRadius } from "../model/text-style";
import { TEXT_PAD_X, TEXT_PAD_Y } from "../canvas/text-layout";
import { normalizePageTitle } from "../model/contents";
import { textSegments } from "../model/text-links";
import { decodeAppleLz4 } from "./apple-lz4";
import {
  importedFont,
  hexColor,
  ImportTally,
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
  /** The version of `template`: a later change of paper has a higher one. */
  paperClock: number;
  order: string;
  orderClock: number;
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
  const changes: Array<{ page: string; kind: number; value: string; clock: number }> = [];
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
      case 54: {
        const paper = stamped(body.message(3));
        const order = stamped(body.message(4));
        pages.set(id, {
          id,
          template: paper.value,
          paperClock: paper.clock,
          order: order.value ?? "",
          orderClock: order.clock,
          deleted: false,
          bookmarked: false,
          created: created++,
        });
        break;
      }
      case 3:
      case 55: {
        // A page's paper changed (3) or the page moved (55), applied once
        // every page is known: the newer clock wins.
        const change = stamped(body.message(3));
        if (change.value !== undefined) {
          changes.push({ page: id, kind: kind.field, value: change.value, clock: change.clock });
        }
        break;
      }
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

  for (const change of changes) {
    const page = pages.get(change.page);
    if (!page) continue;
    if (change.kind === 3 && change.clock >= page.paperClock) {
      page.template = change.value;
      page.paperClock = change.clock;
    } else if (change.kind === 55 && change.clock >= page.orderClock) {
      page.order = change.value;
      page.orderClock = change.clock;
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

  // Composed: a file name from macOS spells "ü" as "u" and a mark (`attachmentBaseName`).
  const name = (fileTitle || title || "Imported notebook").normalize("NFC");
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

  const tally = new ImportTally();
  let missingPaper = 0;
  let strokeN = 0;
  let imageN = 0;
  let textN = 0;
  let sectionN = 0;
  // Links in typed text name pages by id: their page number once sorted.
  const pageNumbers = new Map(live.map((entry, index) => [entry.id, index + 1]));
  const pageText: string[] = [];

  const docPages: Page[] = live.map((entry, index) => {
    const pageNumber = index + 1;
    const templateId = entry.template && templates.has(entry.template) ? entry.template : common;
    if (templateId !== entry.template) missingPaper++;
    const template = templateId ? templates.get(templateId) : undefined;
    const width = template?.width ?? 834.24;
    const height = template?.height ?? 1078.825;
    const k = pageScale(width, width / GOODNOTES_UNITS_PER_MM);
    const paper = template?.attachment ? attach(template.attachment, "paper") : null;

    const page: Page = {
      id: `p${pageNumber}`,
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

    const text = searchText(file(`search/${layerId(entry.id)}`));
    if (text) pageText[index] = text;

    // A page of this notebook becomes a link inside the same note; a page of
    // another notebook has no known place in the vault, so its words stay plain.
    const pageLink = (words: string, url: string): LinkedWords => {
      const target = goodnotesPageLink(url);
      if (target === null) return linkWords(words, url, `(${url})`);
      const number = pageNumbers.get(target);
      if (number === undefined) return { text: words, kept: "elsewhere" };
      return linkWords(words, `#page=${number}`, `(→ page ${number})`);
    };

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
        const strokes = readStroke(body, k, () => `s${++strokeN}`);
        if (strokes) page.strokes.push(...strokes);
        else tally.add("unreadable", pageNumber);
      } else if (kind === 8) {
        const box = readRtfBox(body, k, `t${textN + 1}`);
        if (box) {
          page.textBoxes.push(box);
          textN++;
        } else tally.add("empty", pageNumber);
      } else if (kind === 1) {
        const image = readImage(body, k, `i${imageN + 1}`, (id) => attach(id, "picture"));
        if (image) {
          page.images.push(image);
          imageN++;
          if (/\.jp2$/i.test(image.path)) tally.add("jpeg2000", pageNumber);
        } else tally.add("other", pageNumber);
      } else if (kind === 21) {
        const typed = readTyped(body, 32, pageLink);
        const box = typed ? textBoxOf(body, typed, k, `t${textN + 1}`) : null;
        if (box) {
          if (typed?.written) tally.add("links", pageNumber);
          if (typed?.elsewhere) tally.add("elsewhere", pageNumber);
          if (typed?.mixed) tally.add("mixed", pageNumber);
        }
        const frame = readFrame(body);
        const framed = frame ? framedBox(frame, box, k, `t${textN + 1}`) : null;
        if (framed) {
          // A rectangle, rounded or not: one box with its border, corners and fill.
          page.textBoxes.push(framed);
          textN++;
        } else {
          if (box) {
            page.textBoxes.push(box);
            textN++;
          }
          if (frame) {
            // A diamond or another polygon, or a rectangle a box cannot be:
            // its outline as a shape stroke.
            const outline = outlineOf(frame, k, `s${strokeN + 1}`);
            page.strokes.push(outline);
            strokeN++;
            tally.add("shapes", pageNumber);
            if (frame.fill && !box) {
              // Such a rectangle keeps its fill as an empty filled box; any
              // other closed shape keeps it on its outline.
              const fill = readFill(frame.fill);
              if (frame.vertices.length < 3) {
                page.textBoxes.push(filledBox(frame, k, `t${++textN}`));
              } else if (fill && canFill(outline.shape) && isClosedLoop(outline.pts)) {
                outline.fill = fill;
              } else tally.add("fills", pageNumber);
            }
          } else if (!box) tally.add("empty", pageNumber);
        }
      } else if (kind === 20) {
        const note = readComment(body, k, `t${textN + 1}`, pageLink);
        if (note) {
          page.textBoxes.push(note);
          textN++;
          tally.add("comments", pageNumber);
        } else tally.add("other", pageNumber);
      } else tally.add("other", pageNumber);
    }
    return page;
  });

  const warnings: string[] = [];
  if (missingPaper > 0) {
    warnings.push(
      `${plural(missingPaper, "page uses", "pages use")} a Goodnotes paper that is not in the file; ` +
        "the notebook's usual paper was used instead.",
    );
  }
  const lines = [
    tally.line("unreadable", (n) => `${plural(n, "stroke")} could not be read.`),
    tally.line("shapes", (n) => `${plural(n, "shape")} came over as outlines.`),
    tally.line(
      "fills",
      (n) => `${plural(n, "shape's fill", "shapes' fills")} could not be kept, only the outline.`,
    ),
    tally.line(
      "comments",
      (n) => `${plural(n, "comment")} came over as a text box with the author's name.`,
    ),
    tally.line(
      "links",
      (n) =>
        `${plural(n, "text box keeps a link", "text boxes keep a link")} written after the words, ` +
        "which cannot hold one.",
    ),
    tally.line(
      "elsewhere",
      (n) =>
        `${plural(n, "text box links", "text boxes link")} to another Goodnotes notebook; ` +
        "those words came over without the link.",
    ),
    tally.line(
      "mixed",
      (n) =>
        `${plural(n, "text box has", "text boxes have")} words in more than one colour; ` +
        "a text box here has one, so the first was kept.",
    ),
    tally.line(
      "jpeg2000",
      (n) =>
        `${plural(n, "picture is", "pictures are")} JPEG 2000, ` +
        "which Obsidian cannot show until converted to PNG or JPEG.",
    ),
    tally.line("other", (n) => `${plural(n, "other item")} could not be brought over yet.`),
  ];
  for (const line of lines) if (line) warnings.push(line);

  const first = docPages[0];
  const doc: InkDocument = {
    version: SCHEMA_VERSION,
    view: { scrollY: 0, width: first.geometry.width, scale: 1 },
    pages: docPages,
  };
  const result: ImportResult = { source: "goodnotes", title: name, doc, attachments, warnings };
  if (pageText.some(Boolean)) result.pageText = Array.from(pageText, (t) => t ?? "");
  return result;
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
  /**
   * Where each further piece of the stroke begins in `points`: a centreline
   * can move to a new start part-way, and the pieces are not joined.
   */
  starts?: number[];
}

/**
 * A stroke as one FineNotes stroke a piece (`PenPath.starts`), each named by
 * `nextId`. Empty for a stroke without points (Goodnotes keeps some), null
 * when it cannot be read.
 */
function readStroke(body: Message, k: number, nextId: () => string): Stroke[] | null {
  const data = body.bytes(2);
  if (!data) return null;
  let path: PenPath;
  try {
    path = penPath(decodeAppleLz4(data));
  } catch {
    return null;
  }
  if (path.points.length === 0) return [];
  const offset = body.message(6);
  const dx = finite(offset?.float(1));
  const dy = finite(offset?.float(2));
  const usable = (p: PenPoint): boolean => Number.isFinite(p.x) && Number.isFinite(p.y);
  const all = path.points.filter(usable);
  if (all.length === 0) return null;

  const halves = all
    .map((p) => p.half)
    .filter((h): h is number => h !== undefined && Number.isFinite(h) && h > 0);
  const half = halves.length > 0 ? median(halves) : (path.half ?? 1);
  const size = round2(Math.max(0.1, 2 * half * k));
  const colour = body.message(4);
  const [r, g, b, a] = [1, 2, 3, 4].map((f) => colour?.float(f) ?? (f === 4 ? 1 : 0));

  const bounds = [0, ...(path.starts ?? []), path.points.length];
  const strokes: Stroke[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const piece = path.points.slice(bounds[i], bounds[i + 1]).filter(usable);
    if (piece.length === 0) continue;
    const pts: number[] = [];
    for (const p of piece) {
      const pressure =
        p.half === undefined || !Number.isFinite(p.half)
          ? 0.5
          : pressureForWidth(2 * p.half * k, size);
      pts.push((p.x + dx) * k, (p.y + dy) * k, pressure);
    }
    strokes.push({
      id: nextId(),
      color: hexColor(r, g, b),
      size,
      tool: a < HIGHLIGHTER_ALPHA ? "highlighter" : "pen",
      pts,
    });
  }
  return strokes;
}

/** The pen samples of a decompressed stroke, in either layout. Throws on anything else. */
export function penPath(raw: Uint8Array): PenPath {
  const layout = readTplLayout(raw);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const f32 = (at: number): number => view.getFloat32(at, true);
  const { arrays } = layout;

  const width = layout.scalars.find((s) => s.kind === "u");
  /** The stroke's own width, when it has one (it is -1 when every point has its own). */
  const strokeWidth = width && f32(width.at) > 0 ? f32(width.at) : undefined;

  if (arrays.some((a) => a.kind === "S")) {
    if (arrays[1]?.fields === "uu" && arrays[2]?.fields === "uuuu") {
      return centreline(view, arrays, "pairs", strokeWidth);
    }
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
    return { points, half: strokeWidth !== undefined ? strokeWidth / 2 : undefined };
  }

  // Schema 24: the second-last array holds the samples, the last one entry
  // per sample. Strokes with a width of their own leave both empty, as does
  // the odd stroke without one; theirs is the centreline.
  const samples = arrays[arrays.length - 2];
  const perSample = arrays[arrays.length - 1];
  const stride = samples && perSample ? samples.count / perSample.count : NaN;
  if (
    width ||
    arrays.length < 10 ||
    samples.kind !== "u" ||
    !Number.isInteger(stride) ||
    stride < 3
  ) {
    if (arrays[1]?.kind !== "u" || arrays[2]?.kind !== "u") {
      throw new GoodnotesError("unexpected stroke layout");
    }
    return centreline(view, arrays, width ? "widths" : "halves", strokeWidth);
  }
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

/**
 * How a centreline's points are written: `pairs` as structs of x, y (the
 * stroke's width for them all); `widths` as flat floats, x, y, with a full
 * width after a point's last pair under verbs 2 and 3; `halves` as flat
 * floats x, y, half-width.
 */
type CentrelineKind = "pairs" | "widths" | "halves";

/**
 * A stroke's centreline: the first array is its verbs (u16), the next two
 * the points they move to and the curves they draw, each verb reading the
 * next item of its own array:
 *
 * - `0` moves to a point, `1` draws a quadratic curve (a control point,
 *   then its end) from where the last verb ended;
 * - `2` and `3` are the same with widths, in `widths` layouts only.
 *
 * Each curve comes back as two points, its middle and its end. A move after
 * the first starts a new piece (`starts`). Throws when the verbs and the
 * arrays they read disagree.
 */
function centreline(
  view: DataView,
  arrays: TplArray[],
  kind: CentrelineKind,
  strokeWidth: number | undefined,
): PenPath {
  const [verbs, moves, curves] = arrays;
  if (verbs?.kind !== "v" || !moves || !curves) {
    throw new GoodnotesError("unexpected stroke layout");
  }
  const f32 = (at: number): number => view.getFloat32(at, true);
  const half = strokeWidth !== undefined ? strokeWidth / 2 : undefined;
  // Read positions in the move and curve arrays, in floats (flat) or items (structs).
  let m = 0;
  let c = 0;
  const flat = kind !== "pairs";
  const take = (array: TplArray, from: number, n: number): number[] => {
    const end = flat ? from + n : from + 1;
    if (end > array.count) throw new GoodnotesError("stroke verbs past their points");
    const at = array.at + (flat ? from * 4 : from * array.size);
    return Array.from({ length: n }, (_, i) => f32(at + i * 4));
  };
  const points: PenPoint[] = [];
  const starts: number[] = [];
  const at = (x: number, y: number, h: number | undefined): PenPoint =>
    h === undefined ? { x, y } : { x, y, half: h };
  for (let i = 0; i < verbs.count; i++) {
    const verb = view.getUint16(verbs.at + i * 2, true);
    if (verb > 3 || (verb > 1 && kind !== "widths")) {
      throw new GoodnotesError(`unknown stroke verb ${verb}`);
    }
    if (verb === 0 || verb === 2) {
      const n = kind === "pairs" ? 2 : kind === "halves" || verb === 2 ? 3 : 2;
      const [x, y, w] = take(moves, m, n);
      m += flat ? n : 1;
      if (points.length > 0) starts.push(points.length);
      const h = kind === "halves" ? w : verb === 2 ? w / 2 : half;
      points.push(at(x, y, h));
      continue;
    }
    const n = kind === "pairs" ? 4 : kind === "halves" || verb === 3 ? 6 : 4;
    const v = take(curves, c, n);
    c += flat ? n : 1;
    // Halves interleave: cx, cy, ch, x, y, h. Widths trail: cx, cy, x, y, wc, w.
    const [cx, cy, x, y] = kind === "halves" ? [v[0], v[1], v[3], v[4]] : v;
    const [hc, h] =
      kind === "halves" ? [v[2], v[5]] : verb === 3 ? [v[4] / 2, v[5] / 2] : [half, half];
    const from = points[points.length - 1];
    if (!from) {
      points.push(at(x, y, h));
      continue;
    }
    // The curve's middle: a quarter each of its ends, half its control point.
    const mid = (a: number, b: number, ctrl: number): number => 0.25 * a + 0.5 * ctrl + 0.25 * b;
    const hm =
      from.half !== undefined && hc !== undefined && h !== undefined ? mid(from.half, h, hc) : hc;
    points.push(at(mid(from.x, x, cx), mid(from.y, y, cy), hm), at(x, y, h));
  }
  const path: PenPath = { points, half };
  if (starts.length > 0) path.starts = starts;
  return path;
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

/**
 * A `tpl` layout: its loose values and its arrays. A type it does not know
 * (newer strokes end in an `A(f)`) ends the layout there once the centreline's
 * three arrays are read, since what follows them is never needed; before
 * that it is an error.
 */
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
  /** The value types of the entry at `s`: itself, an array's item, or a struct's fields. */
  const types = (s: number): string => {
    if (signature[s] !== "A") return signature[s];
    if (signature[s + 2] !== "S") return signature[s + 2] ?? "";
    return signature.slice(s + 4, signature.indexOf(")", s));
  };
  let at = sigEnd + 1;
  for (let s = 0; s < signature.length;) {
    const c = signature[s];
    if (arrays.length >= 3 && /[^uv]/.test(types(s))) break;
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

/**
 * A picture element, or null. A PDF placed as a picture comes back as one
 * too; `importNotebooks` turns it into an image.
 */
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
  const x = origin?.float(1) ?? 0;
  const y = origin?.float(2) ?? 0;
  const w = size?.float(1);
  const h = size?.float(2);
  if (!attachment || !w || !h || w <= 0 || h <= 0) return null;
  const path = attach(attachment);
  if (!path) return null;
  // A turned picture: `2` is only its bounds; `3` its centre, its own size
  // and the turn, in radians clockwise.
  const turned = body.message(3);
  const centre = turned?.message(1);
  const own = turned?.message(2);
  const rotation = finite(num(turned, 3));
  const ow = finite(num(own, 1));
  const oh = finite(num(own, 2));
  if (centre && Math.abs(rotation) > 1e-3 && ow > 0 && oh > 0) {
    const cx = finite(num(centre, 1));
    const cy = finite(num(centre, 2));
    return {
      id,
      path,
      x: round2((cx - ow / 2) * k),
      y: round2((cy - oh / 2) * k),
      w: round2(ow * k),
      h: round2(oh * k),
      rotation: Math.round(rotation * 1e4) / 1e4,
    };
  }
  return { id, path, x: round2(x * k), y: round2(y * k), w: round2(w * k), h: round2(h * k) };
}

/** Typed text read from a text store: its runs joined, its links in FineNotes' link syntax. */
interface Typed {
  store: Message;
  text: string;
  /** The first run's attributes, for the box's colour, size and typeface. */
  attrs?: Message;
  /** Whether a link had to be written out after its words. */
  written: boolean;
  /** Whether a link to another notebook was left off its words. */
  elsewhere: boolean;
  /** Whether its words are in more than one colour (a box has one: the first run's). */
  mixed: boolean;
}

/**
 * Linked words as they go into a text box: `link` a working link (FineNotes#20),
 * `written` the words with the link written out after them, `elsewhere` the
 * words alone, their link leading to another notebook.
 */
interface LinkedWords {
  text: string;
  kept: "link" | "written" | "elsewhere";
}

/**
 * Words linked to `target` (`#page=3`, a page of this notebook, or a web
 * address) as a text box writes a link: `[[#page=3|words]]`, `[words](url)`,
 * or the words alone when they are the address itself. Spaces around the
 * words stay outside the link. Words a link cannot hold (a bracket, a line
 * break) keep `writtenOut` after them instead; each form is read back with
 * the text box's own parser before it is used.
 */
function linkWords(words: string, target: string, writtenOut: string): LinkedWords {
  const core = words.trim();
  if (core === "") return { text: words, kept: "link" };
  const lead = words.slice(0, words.length - words.trimStart().length);
  const trail = words.slice(words.trimEnd().length);
  const inPage = target.startsWith("#");
  // A web address cannot hold a bracket or a space between a markdown link's parentheses.
  const href = inPage
    ? target
    : target.replace(
        /[()\s]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
      );
  const forms = inPage ? [`[[${target}|${core}]]`] : [core, `[${core}](${href})`];
  for (const form of forms) {
    const segments = textSegments(form);
    if (segments.length === 1 && segments[0].text === core && segments[0].target === href) {
      return { text: `${lead}${form}${trail}`, kept: "link" };
    }
  }
  return { text: `${lead}${core} ${writtenOut}${trail}`, kept: "written" };
}

/**
 * The text in a box's store (field `32` of a text box, `31` of a comment):
 * runs of `{1: text, 2: attributes}` behind Apple LZ4, an attribute `4` a
 * link. A link may span several runs (Goodnotes splits runs where the font
 * changes); its words are handed to `link` together, once.
 * Null when there is no text at all.
 */
function readTyped(
  body: Message,
  field: number,
  link: (words: string, url: string) => LinkedWords,
): Typed | null {
  const store = body.message(field);
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
  let text = "";
  let linkedWords = "";
  let written = false;
  let elsewhere = false;
  runs.forEach((run, i) => {
    const words = run.string(1) ?? "";
    const url = run.message(2)?.string(4);
    if (!url) {
      text += words;
      return;
    }
    linkedWords += words;
    if (runs[i + 1]?.message(2)?.string(4) === url) return;
    const made = link(linkedWords, url);
    linkedWords = "";
    text += made.text;
    if (made.kept === "written") written = true;
    if (made.kept === "elsewhere") elsewhere = true;
  });
  if (text.trim() === "") return null;
  const inked = runs.filter((run) => (run.string(1) ?? "").trim() !== "");
  const attrs = inked[0]?.message(2);
  // Only runs that state a colour count: one without may simply carry on the last.
  const colours = new Set(
    inked.map((run) => rgba(run.message(2)?.message(3))).filter((c) => c !== undefined),
  );
  return { store, text, attrs, written, elsewhere, mixed: colours.size > 1 };
}

/**
 * A text box from its typed text. Its top-left is field `20.1`, the text
 * sits inside the insets of the store's `10`; a fixed width is `21.2.1`,
 * otherwise the box grows with its text (the store's `2` is that text's size).
 */
function textBoxOf(body: Message, typed: Typed, k: number, id: string): TextBoxElement {
  const { store, attrs } = typed;
  const origin = body.message(20)?.message(1);
  const insets = store.message(10);
  const left = finite(num(insets, 2), 10);
  const top = finite(num(insets, 1), 10);
  const right = finite(num(insets, 4), 10);
  const fixedWidth = num(body.message(21)?.message(2), 1);
  const textWidth = num(store.message(2), 1);
  const fixed = fixedWidth !== undefined && Number.isFinite(fixedWidth) && fixedWidth > 0;

  const box: TextBoxElement = {
    id,
    x: round2((finite(num(origin, 1)) + left) * k),
    y: round2((finite(num(origin, 2)) + top) * k),
    w: round2(Math.max(8, (fixed ? fixedWidth - left - right : (textWidth ?? 200)) * k)),
    text: typed.text,
    color: rgba(attrs?.message(3)) ?? "#000000",
    fontSize: round2(Math.max(12, fontSize(attrs, store) * k)),
  };
  if (!fixed) box.fit = true;
  // The font each box was written in, over the nearest typeface (discussion #107).
  Object.assign(box, importedFont(attrs?.string(30) ?? store.message(5)?.message(1)?.string(30)));
  const fill = rgba(body.message(30)?.message(1)?.message(1), true);
  if (fill) box.fill = fill;
  return box;
}

/** A run's font size, or the box's own (`-404` means "the box's"). */
function fontSize(attrs: Message | undefined, store: Message): number {
  const run = num(attrs, 40);
  if (run !== undefined && run !== INHERITED_FONT_SIZE && run > 0) return run;
  return num(store.message(5)?.message(1), 40) ?? 24;
}

/** What a text box draws around itself, in Goodnotes units. */
interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
  /** The height was stored (`21.2.2`), not taken from the width. */
  storedHeight: boolean;
  /** A polygon's vertices in the box's unit square; empty for a rectangle. */
  vertices: Array<[number, number]>;
  cornerRadius: number;
  /** The border's width, 0 for none (or one in a fully transparent colour). */
  borderWidth: number;
  /** The border's colour, with its alpha; absent for none. */
  borderColor?: string;
  fill?: string;
}

/**
 * A text box's frame, when it draws one: a plain border (`31.1`, its width,
 * wider than 0), a rounded rectangle (`22.1.1`, the corner radius) or a
 * polygon in the box's unit square (field `22.3`, e.g. a diamond), each with
 * the box's fill (`30.1.1`). A drawn shape without a border needs a fill to
 * show at all.
 */
function readFrame(body: Message): Frame | null {
  const geometry = body.message(22);
  const border = body.message(31);
  const borderWidth = num(border, 1) ?? 0;
  // A polygon is `22.3.1`: its vertices (each `{1: {1: x, 2: y}}`, in the
  // box's unit square) as repeated field 1.
  const vertices = (geometry?.message(3)?.message(1)?.fields ?? [])
    .filter((f) => f.field === 1 && f.wire === 2 && f.bytes)
    .map((f) => Message.parse(f.bytes as Uint8Array).message(1))
    .map((v): [number, number] => [finite(num(v, 1)), finite(num(v, 2))]);
  const cornerRadius = finite(num(geometry?.message(1), 1));
  const drawn = vertices.length >= 3 || cornerRadius > 0;
  const origin = body.message(20)?.message(1);
  const size = body.message(21)?.message(2);
  const w = finite(num(size, 1));
  const hRaw = num(size, 2);
  const storedHeight = hRaw !== undefined && Number.isFinite(hRaw) && hRaw > 0;
  const h = storedHeight ? hRaw : w;
  if (!(w > 0 && h > 0)) return null;
  const fill = rgba(body.message(30)?.message(1)?.message(1), true);
  // A border without a colour is black; one in a transparent colour is none.
  const colour = border?.message(3)?.message(1);
  const borderColor = borderWidth > 0 ? (colour ? rgba(colour, true) : "#000000") : undefined;
  if (!borderColor && !(drawn && fill)) return null;
  return {
    x: finite(num(origin, 1)),
    y: finite(num(origin, 2)),
    w,
    h,
    storedHeight,
    vertices,
    cornerRadius,
    borderWidth: borderColor ? borderWidth : 0,
    ...(borderColor ? { borderColor } : {}),
    ...(fill ? { fill } : {}),
  };
}

/**
 * A rectangular frame (square or rounded corners) as one box: the text box
 * it frames, or an empty one, spread to the frame and given its border,
 * corners and fill. The text keeps clear of the border by itself
 * (`text-layout.ts`). `null` for a polygon, for a border or radius past
 * what the loader keeps, and for a frame narrower than the narrowest box the
 * loader keeps (it would reopen wider than its outline); those come over as
 * an outline instead.
 */
function framedBox(
  frame: Frame,
  box: TextBoxElement | null,
  k: number,
  id: string,
): TextBoxElement | null {
  if (frame.vertices.length >= 3) return null;
  if (round2(frame.w * k) < MIN_TEXT_BOX_WIDTH) return null;
  const width = round2(frame.borderWidth * k);
  const border = frame.borderColor && width > 0 ? { width, color: frame.borderColor } : undefined;
  if (border && !isBorderWidth(border.width)) return null;
  const radius = round2(Math.min(frame.cornerRadius, frame.w / 2, frame.h / 2) * k);
  if (radius > 0 && !isCornerRadius(radius)) return null;
  if (!border && !frame.fill && !box) return null;
  const framed: TextBoxElement = {
    ...(box ?? { id, x: 0, y: 0, w: 0, text: "", color: "#000000", fontSize: 22 }),
    x: round2(frame.x * k),
    y: round2(frame.y * k),
    w: round2(frame.w * k),
  };
  // Goodnotes' frame is the box's size, however little text it holds.
  if (frame.storedHeight || !box) framed.h = round2(Math.max(24, frame.h * k));
  delete framed.fit;
  if (frame.fill) framed.fill = frame.fill;
  if (border) framed.border = border;
  if (radius > 0) framed.radius = radius;
  return framed;
}

/** A rectangle's fill as an empty filled box the frame's size. */
function filledBox(frame: Frame, k: number, id: string): TextBoxElement {
  return {
    id,
    x: round2(frame.x * k),
    y: round2(frame.y * k),
    w: round2(frame.w * k),
    h: round2(Math.max(24, frame.h * k)),
    text: "",
    color: "#000000",
    fontSize: 22,
    ...(frame.fill ? { fill: frame.fill } : {}),
  };
}

/**
 * A frame's outline as a shape stroke: a diamond, a triangle or a polygon,
 * or a rectangle whose border or corners the loader would not keep.
 */
function outlineOf(frame: Frame, k: number, id: string): Stroke {
  const { x, y, w, h, vertices } = frame;
  let kind: ShapeKind = "rect";
  let points: Array<[number, number]>;
  if (vertices.length >= 3) {
    const diamond =
      vertices.length === 4 &&
      [
        [0.5, 0],
        [1, 0.5],
        [0.5, 1],
        [0, 0.5],
      ].every(
        ([vx, vy], i) => Math.abs(vertices[i][0] - vx) + Math.abs(vertices[i][1] - vy) < 0.01,
      );
    kind = diamond ? "diamond" : vertices.length === 3 ? "triangle" : "polygon";
    points = [...vertices, vertices[0]].map(([u, v]) => [x + u * w, y + v * h]);
  } else {
    const radius = Math.min(frame.cornerRadius, w / 2, h / 2);
    if (radius > 0) {
      kind = "roundrect";
      points = roundRect(x, y, w, h, radius);
    } else {
      points = [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
        [x, y],
      ];
    }
  }
  const colour = (frame.borderWidth > 0 ? frame.borderColor : undefined) ?? frame.fill;
  return {
    id,
    color: colour?.slice(0, 7) ?? "#000000",
    size: round2(Math.max(0.5, (frame.borderWidth > 0 ? frame.borderWidth : 2) * k)),
    tool: "pen",
    pts: points.flatMap(([px, py]) => [round2(px * k), round2(py * k), 0.5]),
    shape: kind,
  };
}

/** A rounded rectangle as the Shape tool lays one out: four 8-segment quarter arcs, closed (37 points). */
function roundRect(x: number, y: number, w: number, h: number, r: number): Array<[number, number]> {
  const corners: Array<[number, number, number]> = [
    [x + w - r, y + r, -Math.PI / 2],
    [x + w - r, y + h - r, 0],
    [x + r, y + h - r, Math.PI / 2],
    [x + r, y + r, Math.PI],
  ];
  const points: Array<[number, number]> = [];
  for (const [cx, cy, from] of corners) {
    for (let i = 0; i <= 8; i++) {
      const a = from + (i / 8) * (Math.PI / 2);
      points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  points.push(points[0]);
  return points;
}

/**
 * A comment (kind 20) as a text box: its colour (`30`), its size (`21.2`),
 * and its text (`31`) signed with its author (`33`), or the author alone for
 * a comment without text.
 */
function readComment(
  body: Message,
  k: number,
  id: string,
  link: (words: string, url: string) => LinkedWords,
): TextBoxElement | null {
  const typed = readTyped(body, 31, link);
  const author = body.string(33)?.trim();
  const words = typed?.text.trim();
  const text = words
    ? author
      ? `${author}: ${words}`
      : words
    : `Comment by ${author || "someone"}`;
  const origin = body.message(20)?.message(1);
  const size = body.message(21)?.message(2);
  const w = finite(num(size, 1), 200);
  const h = num(size, 2);
  const store = typed?.store ?? body.message(31);
  const box: TextBoxElement = {
    id,
    x: round2(finite(num(origin, 1)) * k),
    y: round2(finite(num(origin, 2)) * k),
    w: round2(Math.max(80, w * k)),
    text,
    color: rgba(typed?.attrs?.message(3)) ?? "#000000",
    fontSize: round2(Math.max(12, (store ? fontSize(typed?.attrs, store) : 24) * k)),
    fill: rgba(body.message(30), true) ?? "#fff3b0",
  };
  if (h !== undefined && Number.isFinite(h) && h > 0) box.h = round2(Math.max(24, h * k));
  return box;
}

/**
 * An older text box (kind 8) as a text box: its frame (`2`, already turned
 * by the transform in `4`), the text inside it by the inset `10`, and the
 * text itself as RTF (`6`). Its background (`7`) is clear unless it has an
 * alpha. Null when it holds no words.
 */
function readRtfBox(body: Message, k: number, id: string): TextBoxElement | null {
  const rtf = readRtf(body.string(6) ?? "");
  if (!rtf || rtf.text.trim() === "") return null;
  const frame = body.message(2);
  const origin = frame?.message(1);
  const size = frame?.message(2);
  const inset = finite(num(body, 10), 10);
  const fontSize = rtf.size ?? 24;
  // The text sits where Goodnotes put it: a box here keeps its own padding
  // around its text, so it starts that much further out.
  const box: TextBoxElement = {
    id,
    x: round2((finite(num(origin, 1)) + inset) * k - TEXT_PAD_X),
    y: round2((finite(num(origin, 2)) + inset) * k - TEXT_PAD_Y),
    w: round2(
      Math.max(8, (finite(num(size, 1), 200 + 2 * inset) - 2 * inset) * k + 2 * TEXT_PAD_X),
    ),
    text: rtf.text,
    color: rtf.color ?? "#000000",
    fontSize: round2(Math.max(12, fontSize * k)),
  };
  // Goodnotes sizes a box to its text, in fonts often not here (Snell
  // Roundhand, Noteworthy) and narrower than the one used instead: a box
  // that held one line grows with its text rather than wrap it.
  const height = num(size, 2);
  if (!rtf.text.includes("\n") && height !== undefined && height - 2 * inset < 1.8 * fontSize) {
    box.fit = true;
  }
  const typeface = fontFor(rtf.font);
  if (typeface !== "sans") box.font = typeface;
  const fill = rgba(body.message(7), true);
  if (fill) box.fill = fill;
  return box;
}

/** What a text box keeps of an RTF document. */
export interface RtfText {
  text: string;
  /** The first words' font, size in points and colour. */
  font?: string;
  size?: number;
  color?: string;
}

/** RTF groups whose contents are not text. */
const RTF_DESTINATIONS = new Set([
  "fonttbl",
  "colortbl",
  "expandedcolortbl",
  "stylesheet",
  "info",
  "listtable",
  "listoverridetable",
  "pict",
  "header",
  "footer",
]);

/**
 * The plain text of an RTF document as Apple writes one, with the font, size
 * and colour its first words are in. Paragraphs and line breaks become new
 * lines; `\'hh` is a byte in the document's code page. Null when it is not RTF.
 */
export function readRtf(rtf: string): RtfText | null {
  if (!rtf.startsWith("{\\rtf")) return null;
  let decoder: TextDecoder;
  const page = /\\ansicpg(\d+)/.exec(rtf)?.[1] ?? "1252";
  try {
    decoder = new TextDecoder(`windows-${page}`);
  } catch {
    decoder = new TextDecoder("windows-1252");
  }
  const fonts = new Map<number, string>();
  const colours: Array<string | undefined> = [];
  let colour: [number, number, number] | null = null;
  let fontNumber = 0;
  let fontName = "";

  interface State {
    destination: string | null;
    skip: boolean;
    font: number;
    size?: number;
    colour: number;
    /** Characters to drop after a `\u`. */
    uc: number;
  }
  let state: State = { destination: null, skip: false, font: 0, colour: 0, uc: 1 };
  const stack: State[] = [];
  let text = "";
  let first: RtfText | null = null;
  let pendingSkip = 0;
  let bytes: number[] = [];

  const put = (s: string): void => {
    if (state.skip) return;
    if (state.destination === "fonttbl") {
      fontName += s;
      return;
    }
    if (state.destination !== null) return;
    if (!first && s.trim() !== "") {
      first = {
        text: "",
        font: fonts.get(state.font),
        size: state.size,
        color: colours[state.colour],
      };
    }
    text += s;
  };
  /** `\'hh` bytes in a row, decoded together (a code page may use two a character). */
  const flushBytes = (): void => {
    if (bytes.length === 0) return;
    put(decoder.decode(new Uint8Array(bytes)));
    bytes = [];
  };

  for (let i = 0; i < rtf.length;) {
    const ch = rtf[i];
    if (ch !== "\\" || rtf[i + 1] !== "'") flushBytes();
    if (ch === "{") {
      stack.push(state);
      state = { ...state };
      i++;
      continue;
    }
    if (ch === "}") {
      if (state.destination === "fonttbl" && fontName.trim()) {
        fonts.set(fontNumber, fontName.replace(/;\s*$/, "").trim());
      }
      fontName = "";
      state = stack.pop() ?? state;
      i++;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      i++;
      continue;
    }
    if (ch !== "\\") {
      if (pendingSkip > 0) pendingSkip--;
      else if (state.destination === "colortbl" && ch === ";") {
        const rgb = colour?.map((v) => v / 255);
        colours.push(rgb ? hexColor(rgb[0], rgb[1], rgb[2]) : undefined);
        colour = null;
      } else if (state.destination === "fonttbl" && ch === ";") {
        if (fontName.trim()) fonts.set(fontNumber, fontName.trim());
        fontName = "";
      } else put(ch);
      i++;
      continue;
    }
    // A control symbol, or a control word with an optional number.
    const next = rtf[i + 1] ?? "";
    if (next === "'") {
      const byte = parseInt(rtf.slice(i + 2, i + 4), 16);
      i += 4;
      if (pendingSkip > 0) pendingSkip--;
      else if (Number.isFinite(byte)) bytes.push(byte);
      continue;
    }
    if (!/[a-zA-Z]/.test(next)) {
      i += 2;
      if (next === "\n" || next === "\r") put("\n");
      else if (next === "~") put(" ");
      else if (next === "*") state.skip = true;
      else if (next === "\\" || next === "{" || next === "}") put(next);
      continue;
    }
    const word = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(rtf.slice(i, i + 64));
    if (!word) {
      i++;
      continue;
    }
    i += word[0].length;
    const name = word[1];
    const n = word[2] === undefined ? undefined : Number(word[2]);
    if (RTF_DESTINATIONS.has(name)) {
      state.destination = name;
      continue;
    }
    if (state.destination === "colortbl") {
      colour ??= [0, 0, 0];
      if (name === "red") colour[0] = n ?? 0;
      else if (name === "green") colour[1] = n ?? 0;
      else if (name === "blue") colour[2] = n ?? 0;
      continue;
    }
    if (state.destination === "fonttbl") {
      if (name === "f") fontNumber = n ?? 0;
      continue;
    }
    switch (name) {
      case "par":
      case "line":
        put("\n");
        break;
      case "tab":
        put("\t");
        break;
      case "f":
        state.font = n ?? 0;
        break;
      case "fs":
        if (n !== undefined && n > 0) state.size = n / 2;
        break;
      case "cf":
        state.colour = n ?? 0;
        break;
      case "uc":
        state.uc = n ?? 1;
        break;
      case "u":
        if (n !== undefined) put(String.fromCharCode(n < 0 ? n + 65536 : n));
        pendingSkip = state.uc;
        break;
    }
  }
  flushBytes();
  const found: RtfText = first ?? { text: "" };
  found.text = text.replace(/\s+$/, "");
  return found;
}

/**
 * The page a Goodnotes link points at, by page id, or null when the URL is
 * not one: `https://app.goodnotes.com/documents/?anchor=<base64 of "page-<id>">`.
 */
export function goodnotesPageLink(url: string): string | null {
  const match = /^https:\/\/app\.goodnotes\.com\/documents\/\?(?:.*&)?anchor=([^&#]+)/.exec(url);
  if (!match) return null;
  let decoded: string;
  try {
    decoded = new TextDecoder().decode(base64Bytes(decodeURIComponent(match[1])));
  } catch {
    return null;
  }
  return decoded.startsWith("page-") ? decoded.slice(5) : null;
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Standard or URL-safe base64, padding optional. Throws on other characters. */
function base64Bytes(text: string): Uint8Array {
  const clean = text.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const c of clean) {
    const v = BASE64.indexOf(c);
    if (v < 0) throw new GoodnotesError("not base64");
    value = (value << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >> bits) & 255);
    }
  }
  return new Uint8Array(out);
}

/**
 * What Goodnotes' own handwriting recognition read on a page, from
 * `search/<page>`: one group (field `6`) per word, space or line break, in
 * reading order, each with its candidates (field `3`), the best first.
 * Blank lines are dropped; "" when there is nothing.
 */
export function searchText(data: Uint8Array | undefined): string {
  if (!data || data.length === 0) return "";
  let index: Message;
  try {
    index = Message.parse(data);
  } catch {
    return "";
  }
  let text = "";
  for (const field of index.fields) {
    if (field.field !== 6 || field.wire !== 2 || !field.bytes) continue;
    try {
      text += Message.parse(field.bytes).string(3) ?? "";
    } catch {
      // Not a word group.
    }
  }
  return text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line !== "")
    .join("\n");
}

/** `#rrggbb` (or `#rrggbbaa` with `alpha`, when not opaque) from `{1: r, 2: g, 3: b, 4: a}`; undefined when absent or, with `alpha`, invisible. */
function rgba(colour: Message | undefined, alpha = false): string | undefined {
  if (!colour) return undefined;
  const hex = hexColor(num(colour, 1) ?? 0, num(colour, 2) ?? 0, num(colour, 3) ?? 0);
  if (!alpha) return hex;
  const a = num(colour, 4) ?? 0;
  if (!(a > 0.01)) return undefined;
  if (a >= 0.999) return hex;
  return `${hex}${Math.round(Math.min(1, a) * 255)
    .toString(16)
    .padStart(2, "0")}`;
}

/**
 * A versioned value, `{1: value, 2: {1: counter, 2: device}}`: the value and
 * its counter (0 when it has none). Goodnotes keeps the one with the higher.
 */
function stamped(message: Message | undefined): { value?: string; clock: number } {
  return { value: message?.string(1), clock: message?.message(2)?.int(1) ?? 0 };
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
