/**
 * FreeNotes notebooks (`.freenotes`) as FineNotes documents. Pure.
 *
 * Read from the files themselves (a FreeNotes 2026 export from Android); no
 * code of FreeNotes' is used and its format is not published, so every field
 * below is what the files showed, not a specification. A `.freenotes` file
 * is a zip around one `<uuid>.frnote/` folder of protocol buffers:
 *
 * - `metadata.dat`: 1 notebook id, 3 title.
 * - `document.dat`: 4 the notebook, whose repeated 1 are its pages: 1 page
 *   id, 3 position (absent on the first), 5 its paper, 6 the id of its ink
 *   file. Paper is 3 a ruled template (1 ?, 2 the pattern, 3 paper colour
 *   and 4 line colour as RGBA ints) or 4 a PDF template (2 the id of a PDF
 *   in `PDFs/`, 9 its page counted from 1).
 * - `layout.dat`: repeated 3, one per page: 1 its size (1 width, 2 height,
 *   in points: A4 is 595 × 842), 5 its page id.
 * - `FNPages/<id>.dat`: a page's ink. Repeated 3 are elements, each 2.1 an
 *   item: 2 the brush (1 tool: none or 1 a pen, 2 the highlighter, 101 the
 *   eraser; 2 colour as RGBA), 3 a transform (a, b, c, d, tx, ty; identity
 *   leaves out all but 1 and 4), 4 the stroke, and repeated 5 the strokes of
 *   the pixel eraser that went over it, items of their own. FreeNotes keeps
 *   an erased stroke whole and draws it with the eraser's path cut out.
 * - A stroke's repeated 2 are its points: 1 position (1 x, 2 y), 3 the width
 *   drawn there (1, 2), 4 a time, 7 pressure.
 *
 * Pens and the highlighter come over as strokes, with what the eraser
 * removed cut out of them. A page with a PDF template keeps the PDF as its
 * paper. Anything else on a page (pictures, text) is reported, not converted.
 */

import type { InkDocument, Page, Ruling, Stroke, SyntheticBackdrop } from "../model/document";
import { SCHEMA_VERSION } from "../constants";
import { eraseCircleFromPoints } from "../ink/stroke-eraser";
import {
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
import { Message, ProtobufError } from "./protobuf";

export class FreenotesError extends Error {}

/** A FreeNotes page is measured in points; A4 is 595 of them across 210 mm. */
export const FREENOTES_SCALE = pageScale(595, 210);

/** A4 in points, for a page whose size the layout leaves out. */
const DEFAULT_PAGE = { width: 595, height: 842 };

const TOOL_HIGHLIGHTER = 2;
const TOOL_ERASER = 101;

/** Black, as an RGBA int: a brush that leaves its colour out. */
const DEFAULT_COLOR = 0x000000ff;

/**
 * FreeNotes' ruled patterns (document.dat 4.1.5.3.2) as FineNotes rulings,
 * with their line pitch in points. Only 5 has been seen: a lined page of 20
 * lines, 42.1 pt (14.85 mm) apart. The pitch was measured, not read: the
 * baselines of seven pages of real handwriting sit on multiples of 842 / 20
 * within 2 pt. The rest stay blank paper until a file shows what they are.
 */
const PATTERNS = new Map<number, { kind: Ruling; pitch: number }>([
  [5, { kind: "ruled-wide", pitch: 842 / 20 }],
]);

/**
 * Whether a set of zip entries is a FreeNotes notebook, from their names
 * alone: `document.dat` and `layout.dat` in a `.frnote` folder, or next to
 * a `FNPages` folder.
 */
export function isFreenotes(files: ReadonlyMap<string, Uint8Array>): boolean {
  const root = packageRoot(files, "document.dat");
  if (root === null || !files.has(`${root}layout.dat`)) return false;
  if (root.toLowerCase().endsWith(".frnote/")) return true;
  for (const name of files.keys()) if (name.startsWith(`${root}FNPages/`)) return true;
  return false;
}

/**
 * Convert a `.freenotes` notebook, given its zip entries. The title is the
 * notebook's own; `fallbackTitle` (a file or `.frnote` folder name) is used
 * only when the notebook does not say.
 */
export function readFreenotes(
  files: ReadonlyMap<string, Uint8Array>,
  fallbackTitle: string,
): ImportResult {
  const root = packageRoot(files, "document.dat");
  if (root === null) throw new FreenotesError("not a FreeNotes notebook");
  const title = fallbackTitle.replace(/\.frnote$/i, "") || "Imported notebook";
  return new Converter(files, root, title).run();
}

/** document.dat's notebook message, or `undefined` when the bytes are not one. */
function notebookOf(bytes: Uint8Array): Message | undefined {
  try {
    const notebook = Message.parse(bytes).message(4);
    return notebook && repeated(notebook, 1).length > 0 ? notebook : undefined;
  } catch (e) {
    if (e instanceof ProtobufError) return undefined;
    throw e;
  }
}

/** Every message in a repeated field; one that does not parse is left out. */
function repeated(message: Message, field: number): Message[] {
  const out: Message[] = [];
  for (const f of message.fields) {
    if (f.field !== field || f.wire !== 2 || !f.bytes) continue;
    try {
      out.push(Message.parse(f.bytes));
    } catch {
      // Not a message: a field of the same number holding something else.
    }
  }
  return out;
}

/** An RGBA int as `#rrggbb`, and its alpha in 0..1. */
function rgba(value: number): { hex: string; alpha: number } {
  const v = value >>> 0;
  return {
    hex: hexColor((v >>> 24) / 255, ((v >>> 16) & 0xff) / 255, ((v >>> 8) & 0xff) / 255),
    alpha: (v & 0xff) / 255,
  };
}

/** A point in FreeNotes' page space: position and the width drawn there. */
interface RawPoint {
  x: number;
  y: number;
  w: number;
}

/** An affine transform: x' = a x + c y + tx, y' = b x + d y + ty. */
interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

function affineOf(m: Message | undefined): Affine {
  // Protocol buffers leave out fields at zero, so an absent a or d is 0, not 1;
  // but an item with no transform at all is drawn where it is.
  if (!m) return { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  return {
    a: m.double(1) ?? 0,
    b: m.double(2) ?? 0,
    c: m.double(3) ?? 0,
    d: m.double(4) ?? 0,
    tx: m.double(5) ?? 0,
    ty: m.double(6) ?? 0,
  };
}

/** An item's points, moved by its transform; widths scale by the transform's area. */
function pointsOf(item: Message): RawPoint[] {
  const stroke = item.message(4);
  if (!stroke) return [];
  const t = affineOf(item.message(3));
  const widthScale = Math.sqrt(Math.abs(t.a * t.d - t.b * t.c)) || 1;
  const out: RawPoint[] = [];
  for (const point of repeated(stroke, 2)) {
    const at = point.message(1);
    const x = at?.double(1) ?? 0;
    const y = at?.double(2) ?? 0;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const w = point.message(3)?.double(1) ?? 0;
    out.push({
      x: t.a * x + t.c * y + t.tx,
      y: t.b * x + t.d * y + t.ty,
      w: Number.isFinite(w) && w > 0 ? w * widthScale : 0,
    });
  }
  return out;
}

class Converter {
  private readonly attachments: ImportAttachment[] = [];
  /** Attachment names by FreeNotes PDF id, so a PDF behind many pages is saved once. */
  private readonly attached = new Map<string, string>();
  private readonly k = FREENOTES_SCALE;
  private strokeN = 0;
  private skipped = 0;
  private missingInk = 0;
  private missingPdfs = 0;
  private unknownPaper = 0;

  constructor(
    private readonly files: ReadonlyMap<string, Uint8Array>,
    private readonly root: string,
    private readonly fallbackTitle: string,
  ) {}

  run(): ImportResult {
    const notebook = notebookOf(this.file("document.dat") ?? new Uint8Array());
    if (!notebook) throw new FreenotesError("its page list could not be read");
    const sizes = this.pageSizes();

    const entries = repeated(notebook, 1)
      .map((entry, order) => ({ entry, order, position: entry.int(3) ?? 0 }))
      .sort((p, q) => p.position - q.position || p.order - q.order);
    const pages = entries.map(({ entry }, index) => this.page(entry, index, sizes));

    const warnings: string[] = [];
    if (this.skipped > 0) {
      warnings.push(
        `${plural(this.skipped, "item")} (pictures, text or other objects) could not be brought over yet.`,
      );
    }
    if (this.missingInk > 0) {
      warnings.push(
        `The ink of ${plural(this.missingInk, "page was", "pages were")} not found in the file; ` +
          `${this.missingInk === 1 ? "it was" : "they were"} left blank.`,
      );
    }
    if (this.missingPdfs > 0) {
      warnings.push(
        `${plural(this.missingPdfs, "page is", "pages are")} drawn on a PDF that was not found ` +
          `in the file; ${this.missingPdfs === 1 ? "it was" : "they were"} left blank.`,
      );
    }
    if (this.unknownPaper > 0) {
      warnings.push(
        `The paper of ${plural(this.unknownPaper, "page")} is not one FineNotes knows; ` +
          "it came over as blank paper.",
      );
    }

    const doc: InkDocument = {
      version: SCHEMA_VERSION,
      view: { scrollY: 0, width: pages[0].geometry.width, scale: 1 },
      pages,
    };
    return {
      source: "freenotes",
      title: this.title(),
      doc,
      attachments: this.attachments,
      warnings,
    };
  }

  private file(name: string): Uint8Array | undefined {
    return this.files.get(`${this.root}${name}`);
  }

  private title(): string {
    const bytes = this.file("metadata.dat");
    if (bytes) {
      try {
        const title = Message.parse(bytes).string(3)?.trim();
        if (title) return title;
      } catch {
        // A broken metadata file costs the title, nothing else.
      }
    }
    return this.fallbackTitle;
  }

  /** Page sizes in points, by page id, from layout.dat. */
  private pageSizes(): Map<string, { width: number; height: number }> {
    const sizes = new Map<string, { width: number; height: number }>();
    const bytes = this.file("layout.dat");
    if (!bytes) return sizes;
    let layout: Message;
    try {
      layout = Message.parse(bytes);
    } catch {
      return sizes;
    }
    for (const page of repeated(layout, 3)) {
      const id = page.string(5);
      const size = page.message(1);
      const width = size?.double(1);
      const height = size?.double(2);
      if (id && width && height && width > 0 && height > 0) sizes.set(id, { width, height });
    }
    return sizes;
  }

  private page(
    entry: Message,
    index: number,
    sizes: ReadonlyMap<string, { width: number; height: number }>,
  ): Page {
    const k = this.k;
    const id = entry.string(1) ?? "";
    const size = sizes.get(id) ?? DEFAULT_PAGE;
    const page: Page = {
      id: `p${index + 1}`,
      kind: "ink",
      geometry: { width: Math.round(size.width * k), height: Math.round(size.height * k) },
      backdrop: { kind: "blank" },
      strokes: [],
      images: [],
      textBoxes: [],
    };
    this.paper(entry.message(5), page);

    const inkId = entry.string(6);
    if (!inkId) return page;
    const ink = this.file(`FNPages/${inkId}.dat`);
    if (!ink) {
      this.missingInk++;
      return page;
    }
    let elements: Message[];
    try {
      elements = repeated(Message.parse(ink), 3);
    } catch {
      this.missingInk++;
      return page;
    }
    for (const element of elements) {
      const item = element.message(2)?.message(1);
      if (!item?.has(4)) {
        this.skipped++;
        continue;
      }
      page.strokes.push(...this.strokes(item));
    }
    return page;
  }

  /** A page's paper: a ruled template, or a page of a PDF. */
  private paper(paper: Message | undefined, page: Page): void {
    if (!paper) return;
    const pdf = paper.message(4)?.message(3);
    if (pdf) {
      const path = this.pdf(pdf.string(2));
      if (path) page.backdrop = { kind: "pdf", path, page: Math.max(0, (pdf.int(9) ?? 1) - 1) };
      else this.missingPdfs++;
      return;
    }
    const ruled = paper.message(3);
    if (!ruled) return;
    const pattern = ruled.int(2) ?? 0;
    const known = PATTERNS.get(pattern);
    if (!known && pattern !== 0) this.unknownPaper++;
    const backdrop: SyntheticBackdrop = known
      ? { kind: known.kind, spacing: round2(known.pitch * this.k) }
      : { kind: "blank" };
    const paperColor = ruled.int(3);
    if (paperColor !== undefined) {
      const { hex } = rgba(paperColor);
      if (hex !== "#ffffff") backdrop.paperColor = hex;
    }
    const lineColor = ruled.int(4);
    if (known && lineColor !== undefined) backdrop.color = rgba(lineColor).hex;
    page.backdrop = backdrop;
  }

  private pdf(pdfId: string | undefined): string | null {
    if (!pdfId) return null;
    const known = this.attached.get(pdfId);
    if (known) return known;
    const bytes = this.file(`PDFs/${pdfId}.pdf`);
    if (!bytes || bytes.length === 0) return null;
    const { mime, ext } = sniffFile(bytes);
    const name = `${this.title()} - paper ${this.attachments.length + 1}.${ext}`;
    this.attachments.push({ name, bytes, mime });
    this.attached.set(pdfId, name);
    return name;
  }

  /** One item as FineNotes strokes: several when the eraser cut it apart, none when it erased it all. */
  private strokes(item: Message): Stroke[] {
    const brush = item.message(2);
    const tool = brush?.int(1) ?? 0;
    if (tool === TOOL_ERASER) return [];
    const read = pointsOf(item);
    if (read.length === 0) return [];

    const k = this.k;
    const widths = read.map((p) => p.w * k);
    const drawn = widths.filter((w) => w > 0);
    const nib = round2(Math.max(0.1, drawn.length > 0 ? median(drawn) : k));
    const pts: number[] = [];
    for (let i = 0; i < read.length; i++) {
      pts.push(
        round2(read[i].x * k),
        round2(read[i].y * k),
        widths[i] > 0 ? round2(pressureForWidth(widths[i], nib)) : 0.5,
      );
    }

    let pieces: number[][] = [pts];
    for (const eraser of repeated(item, 5)) pieces = this.erase(pieces, nib, pointsOf(eraser));

    const { hex } = rgba(brush?.int(2) ?? DEFAULT_COLOR);
    return pieces.map((piece) => ({
      id: `s${++this.strokeN}`,
      color: hex,
      size: nib,
      tool: tool === TOOL_HIGHLIGHTER ? "highlighter" : "pen",
      pts: piece,
    }));
  }

  /**
   * Cut an eraser's path out of a stroke's pieces. The path is stepped at a
   * quarter of its width, so the circles it is cut with overlap and leave no
   * ink standing between two samples.
   */
  private erase(pieces: number[][], nib: number, path: readonly RawPoint[]): number[][] {
    const k = this.k;
    for (let i = 0; i < path.length; i++) {
      const to = path[i];
      const from = path[i - 1] ?? to;
      const radius = (Math.max(from.w, to.w) * k) / 2;
      if (!(radius > 0)) continue;
      const length = Math.hypot(to.x - from.x, to.y - from.y) * k;
      const steps = Math.max(1, Math.ceil(length / (radius / 2)));
      for (let s = i === 0 ? 0 : 1; s <= steps; s++) {
        const t = s / steps;
        const cx = (from.x + (to.x - from.x) * t) * k;
        const cy = (from.y + (to.y - from.y) * t) * k;
        const next: number[][] = [];
        for (const piece of pieces) {
          const cut = eraseCircleFromPoints(piece, nib, cx, cy, radius);
          if (cut === null) next.push(piece);
          else next.push(...cut);
        }
        pieces = next;
        if (pieces.length === 0) return pieces;
      }
    }
    return pieces;
  }
}
