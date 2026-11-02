/**
 * A PDF from another app as a FineNotes notebook. Pure: the caller reads the
 * PDF with pdf.js (`view/pdf-reading.ts`) and hands over what each page holds.
 *
 * Apps that only export PDF (Apple Notes, Nebo, Noteshelf, CollaNote and
 * others) come in this way. Each PDF page becomes a page with that PDF page
 * as its paper. Handwriting that the app saved as real annotations, `/Ink`
 * and `/Highlight`, comes over as ink that can be edited; those pages then
 * draw the PDF without its annotations, or the ink would show twice. Ink an
 * app flattened into the page stays part of the paper.
 */

import { SCHEMA_VERSION } from "../constants";
import { DEFAULT_PAGE_GEOMETRY, type Page, type Stroke } from "../model/document";
import { pdfPageGeometry } from "../model/scan-commands";
import type { ImportResult } from "./import-types";
import { hexColor, round2 } from "./import-types";

/** One annotation that becomes ink. Points are in PDF points, from the page's top-left. */
export interface PdfInkReading {
  kind: "ink" | "highlight";
  /** Red, green, blue in 0..255; `null` when the annotation names none. */
  color: readonly number[] | null;
  /** Line width in PDF points (`/BS /W`); 0 or absent means 1. */
  width: number;
  /**
   * Ink: each stroke as x, y, x, y, … . Highlight: each marked span as its
   * four corners (eight numbers), in any order.
   */
  paths: ReadonlyArray<readonly number[]>;
}

export interface PdfPageReading {
  /** The page's size in PDF points, rotation applied. */
  width: number;
  height: number;
  inks: readonly PdfInkReading[];
  /**
   * Annotations it draws that are neither ink nor highlights (typed text,
   * shapes, stamps, form fields); absent is none.
   */
  others?: number;
}

export class PdfImportError extends Error {}

/**
 * Note apps whose exported PDFs say so in their metadata (Creator or
 * Producer), so the import can say where a notebook came from. Noteful
 * shares notebooks only as PDF, so its notebooks arrive this way.
 */
const PDF_APPS: ReadonlyArray<[RegExp, string]> = [
  [/noteful/i, "Noteful"],
  [/goodnotes/i, "Goodnotes"],
  [/notability/i, "Notability"],
  [/noteshelf/i, "Noteshelf"],
  [/collanote/i, "CollaNote"],
  [/nebo|myscript/i, "Nebo"],
  [/flexcil/i, "Flexcil"],
  [/zoomnotes/i, "ZoomNotes"],
];

/** The note app named in a PDF's Creator/Producer text, or `undefined`. */
export function pdfAppName(madeBy: string): string | undefined {
  return PDF_APPS.find(([pattern]) => pattern.test(madeBy))?.[1];
}

/** Whether the bytes are a PDF. */
export function isPdf(bytes: Uint8Array): boolean {
  return String.fromCharCode(...bytes.subarray(0, 5)) === "%PDF-";
}

/** The pressure every imported stroke gets: the line is as wide as the PDF drew it. */
const PRESSURE = 0.5;
/** The black annotations are drawn in when they name no colour. */
const DEFAULT_COLOR = "#000000";
/** Highlighter yellow, for a highlight that names no colour. */
const DEFAULT_HIGHLIGHT = "#ffd400";

/**
 * Convert one PDF, given what pdf.js read from each page. The PDF itself is
 * the notebook's one attachment.
 */
export function readPdf(
  bytes: Uint8Array,
  pages: readonly PdfPageReading[],
  fallbackTitle: string,
  madeBy = "",
): ImportResult {
  if (!isPdf(bytes)) throw new PdfImportError("not a PDF");
  if (pages.length === 0) throw new PdfImportError("the PDF has no pages");
  const title = fallbackTitle;
  const fileName = `${title}.pdf`;
  let strokeN = 0;
  let inkPages = 0;

  const docPages: Page[] = pages.map((reading, index) => {
    const geometry = pdfPageGeometry(DEFAULT_PAGE_GEOMETRY, reading);
    const k = reading.width > 0 ? geometry.width / reading.width : 1;
    const strokes: Stroke[] = [];
    for (const ink of reading.inks) {
      for (const stroke of inkStrokes(ink, k)) {
        strokes.push({ id: `s${++strokeN}`, ...stroke });
      }
    }
    if (strokes.length > 0) inkPages++;
    return {
      id: `p${index + 1}`,
      kind: "ink",
      geometry,
      backdrop: {
        kind: "pdf",
        path: fileName,
        page: index,
        ...(strokes.length > 0 ? { annotations: false as const } : {}),
      },
      strokes,
      images: [],
      textBoxes: [],
    };
  });

  const warnings: string[] = [];
  if (inkPages === 0) {
    warnings.push(
      "The PDF has no handwriting saved as annotations, so its pages are the paper; " +
        "anything written on them is part of the page and can be written over, not edited.",
    );
  }
  return {
    source: "pdf",
    ...(pdfAppName(madeBy) ? { app: pdfAppName(madeBy) } : {}),
    title,
    doc: {
      version: SCHEMA_VERSION,
      view: { scrollY: 0, width: docPages[0].geometry.width, scale: 1 },
      pages: docPages,
    },
    attachments: [{ name: fileName, bytes, mime: "application/pdf" }],
    warnings,
  };
}

type Ink = Omit<Stroke, "id">;

/**
 * A PDF page's ink and highlight annotations as strokes on a page of
 * `width` × `height` px that the PDF page is drawn across.
 */
export function annotationStrokes(reading: PdfPageReading, width: number, height: number): Ink[] {
  if (!(reading.width > 0 && reading.height > 0)) return [];
  const kx = width / reading.width;
  const ky = height / reading.height;
  return reading.inks.flatMap((ink) => inkStrokes(ink, kx, ky));
}

/**
 * The strokes one annotation makes, scaled by `k` page px per PDF point
 * (`ky` down the page, when the page is drawn stretched).
 */
function inkStrokes(ink: PdfInkReading, k: number, ky = k): Ink[] {
  const width = ink.width > 0 && Number.isFinite(ink.width) ? ink.width : 1;
  const rgb = ink.color && ink.color.length >= 3 ? ink.color : null;
  const color = rgb ? hexColor(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255) : null;
  const out: Ink[] = [];
  if (ink.kind === "ink") {
    for (const path of ink.paths) {
      const pts: number[] = [];
      for (let i = 0; i + 1 < path.length; i += 2) {
        const x = path[i];
        const y = path[i + 1];
        if (Number.isFinite(x) && Number.isFinite(y))
          pts.push(round2(x * k), round2(y * ky), PRESSURE);
      }
      if (pts.length === 0) continue;
      out.push({ color: color ?? DEFAULT_COLOR, size: round2(width * k), tool: "pen", pts });
    }
    return out;
  }
  for (const quad of ink.paths) {
    const span = highlightSpan(quad);
    if (!span) continue;
    out.push({
      color: color ?? DEFAULT_HIGHLIGHT,
      size: round2(span.height * ky),
      tool: "highlighter",
      pts: [
        round2(span.x0 * k),
        round2(span.y * ky),
        PRESSURE,
        round2(span.x1 * k),
        round2(span.y * ky),
        PRESSURE,
      ],
    });
  }
  return out;
}

/** A highlighted span's centre line and height, from its four corners. */
function highlightSpan(
  quad: readonly number[],
): { x0: number; x1: number; y: number; height: number } | null {
  if (quad.length < 8 || !quad.slice(0, 8).every(Number.isFinite)) return null;
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  if (!(x1 > x0) || !(bottom > top)) return null;
  return { x0, x1, y: (top + bottom) / 2, height: bottom - top };
}
