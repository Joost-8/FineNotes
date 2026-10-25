/**
 * What the PDF importer (`import/pdf.ts`) needs from a PDF, read with the
 * pdf.js Obsidian bundles (`loadPdfJs`): each page's size, and its ink and
 * highlight annotations in page points from the top-left. Nothing is bundled.
 */

import { loadPdfJs } from "obsidian";
import { type PdfAssets, pdfAssets } from "./pdf-worker";
import type { PdfInkReading, PdfPageReading } from "../import/pdf";

// The slice of pdf.js used here (`loadPdfJs()` is typed `Promise<any>`).
interface Viewport {
  width: number;
  height: number;
  convertToViewportPoint(x: number, y: number): number[];
}

/** pdf.js has given both shapes over its versions: `{x, y}` lists, or flat numbers. */
type PointList = ArrayLike<number> | ReadonlyArray<{ x: number; y: number }>;

interface Annotation {
  subtype?: string;
  color?: ArrayLike<number> | null;
  borderStyle?: { width?: number };
  inkLists?: readonly PointList[];
  quadPoints?: PointList | readonly PointList[];
}

interface PageLike {
  getViewport(params: { scale: number }): Viewport;
  getAnnotations(params?: { intent?: string }): Promise<Annotation[]>;
  cleanup?: () => void;
}

interface DocumentLike {
  numPages: number;
  getMetadata?(): Promise<{ info?: { Creator?: unknown; Producer?: unknown } }>;
  getPage(pageNumber: number): Promise<PageLike>;
  destroy(): Promise<void>;
}

interface PdfJsLike {
  getDocument(src: { data: Uint8Array } & PdfAssets): { promise: Promise<DocumentLike> };
}

/**
 * Every page of the PDF in `bytes`. pdf.js may detach the buffer it is
 * given (CLAUDE.md), and these bytes are saved afterwards: it gets a copy.
 */
export async function readPdfPages(
  bytes: Uint8Array,
): Promise<{ pages: PdfPageReading[]; madeBy: string }> {
  const lib = await loadPdfJs().then((value: unknown) => value as PdfJsLike);
  const doc = await lib.getDocument({ data: bytes.slice(0), ...pdfAssets() }).promise;
  try {
    const pages: PdfPageReading[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const annotations = await page.getAnnotations({ intent: "display" }).catch(() => []);
      const inks: PdfInkReading[] = [];
      for (const a of annotations) {
        const ink = readAnnotation(a, viewport);
        if (ink) inks.push(ink);
      }
      pages.push({ width: viewport.width, height: viewport.height, inks });
      page.cleanup?.();
    }
    // The app that wrote it, from the PDF's Creator and Producer entries.
    const info = (await doc.getMetadata?.().catch(() => undefined))?.info;
    const madeBy = [info?.Creator, info?.Producer]
      .filter((v): v is string => typeof v === "string")
      .join(" ");
    return { pages, madeBy };
  } finally {
    await doc.destroy().catch(() => undefined);
  }
}

function readAnnotation(a: Annotation, viewport: Viewport): PdfInkReading | null {
  const color = a.color && a.color.length >= 3 ? [a.color[0], a.color[1], a.color[2]] : null;
  const width = a.borderStyle?.width ?? 1;
  const toPage = (flat: number[]): number[] => {
    const out: number[] = [];
    for (let i = 0; i + 1 < flat.length; i += 2) {
      const [x, y] = viewport.convertToViewportPoint(flat[i], flat[i + 1]);
      out.push(x, y);
    }
    return out;
  };
  if (a.subtype === "Ink" && a.inkLists) {
    const paths = a.inkLists.map((list) => toPage(flatten(list)));
    return { kind: "ink", color, width, paths };
  }
  if (a.subtype === "Highlight" && a.quadPoints) {
    // One flat list of 8 numbers a span, or (older pdf.js) a list per span.
    const q = a.quadPoints;
    const nested = Array.isArray(q) && q.length > 0 && isPointList(q[0]);
    const flat = nested ? (q as readonly PointList[]).flatMap(flatten) : flatten(q as PointList);
    const paths: number[][] = [];
    for (let i = 0; i + 7 < flat.length; i += 8) paths.push(toPage(flat.slice(i, i + 8)));
    return { kind: "highlight", color, width, paths };
  }
  return null;
}

function isPointList(v: unknown): v is PointList {
  return (
    Array.isArray(v) ||
    ArrayBuffer.isView(v) ||
    (typeof v === "object" && v !== null && "length" in v && typeof v.length === "number")
  );
}

function flatten(list: PointList): number[] {
  const out: number[] = [];
  for (let i = 0; i < list.length; i++) {
    const item = (list as ArrayLike<unknown>)[i];
    if (typeof item === "number") out.push(item);
    else if (item && typeof item === "object" && "x" in item && "y" in item) {
      const p = item as { x: number; y: number };
      out.push(p.x, p.y);
    }
  }
  return out;
}
