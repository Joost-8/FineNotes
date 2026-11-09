/**
 * A PDF's outline (its bookmarks) read with Obsidian's pdf.js, flattened in
 * reading order with each entry's page and spot on it (discussion #185).
 * `model/pdf-outline` decides what the notebook's contents become.
 *
 * Every failure reads as "no outline": an outline is a nice extra on an
 * import, never a reason for one to fail.
 */

import { loadPdfJs } from "obsidian";
import { type OutlineItem, MAX_OUTLINE_ITEMS } from "../model/pdf-outline";
import { type PdfAssets, pdfAssets } from "./pdf-worker";

/** A destination: `[page ref or index, { name: "XYZ" | "Fit" | … }, …numbers]`. */
type Destination = unknown[];

interface OutlineNode {
  title: string;
  dest: string | Destination | null;
  items?: OutlineNode[];
}

interface PageLike {
  getViewport(params: { scale: number }): {
    width: number;
    height: number;
    convertToViewportPoint(x: number, y: number): number[];
  };
  cleanup?: () => void;
}

interface DocumentLike {
  numPages: number;
  getOutline(): Promise<OutlineNode[] | null>;
  getDestination(name: string): Promise<Destination | null>;
  getPageIndex(ref: unknown): Promise<number>;
  getPage(pageNumber: number): Promise<PageLike>;
  destroy(): Promise<void>;
}

interface PdfJsLike {
  getDocument(src: { data: Uint8Array } & PdfAssets): { promise: Promise<DocumentLike> };
}

/**
 * The outline of the PDF in `bytes`, or `[]` when it has none or cannot be
 * read. pdf.js gets a private copy, since it may detach what it is given.
 */
export async function readPdfOutline(bytes: ArrayBuffer | Uint8Array): Promise<OutlineItem[]> {
  let doc: DocumentLike | null = null;
  try {
    const lib = await loadPdfJs().then((value: unknown) => value as PdfJsLike);
    const copy = bytes instanceof Uint8Array ? bytes.slice(0) : new Uint8Array(bytes.slice(0));
    doc = await lib.getDocument({ data: copy, ...pdfAssets() }).promise;
    const outline = await doc.getOutline();
    if (!outline || outline.length === 0) return [];
    return await flatten(doc, outline);
  } catch {
    return [];
  } finally {
    await doc?.destroy().catch(() => undefined);
  }
}

async function flatten(doc: DocumentLike, outline: OutlineNode[]): Promise<OutlineItem[]> {
  const out: OutlineItem[] = [];
  const pages = new Map<number, PageLike | null>();
  const page = async (index: number): Promise<PageLike | null> => {
    if (!pages.has(index)) pages.set(index, await doc.getPage(index + 1).catch(() => null));
    return pages.get(index) ?? null;
  };
  const walk = async (nodes: OutlineNode[], depth: number): Promise<void> => {
    for (const node of nodes) {
      if (out.length >= MAX_OUTLINE_ITEMS) return;
      const spot = await resolve(doc, node.dest, page).catch(() => null);
      if (spot) out.push({ title: node.title, depth, ...spot });
      if (node.items && node.items.length > 0) await walk(node.items, depth + 1);
    }
  };
  try {
    await walk(outline, 1);
  } finally {
    for (const held of pages.values()) held?.cleanup?.();
  }
  return out;
}

/**
 * Where a destination points: its 0-based page, and the spot on it as
 * fractions from the top left, when the destination says (`XYZ`, `FitH`,
 * `FitBH`, `FitR`). `null` for a link elsewhere or a page that is not there.
 */
async function resolve(
  doc: DocumentLike,
  dest: OutlineNode["dest"],
  page: (index: number) => Promise<PageLike | null>,
): Promise<{ page: number; x?: number; y?: number } | null> {
  const explicit = typeof dest === "string" ? await doc.getDestination(dest) : dest;
  if (!Array.isArray(explicit) || explicit.length === 0) return null;
  const ref = explicit[0];
  const index =
    typeof ref === "number"
      ? ref
      : ref && typeof ref === "object"
        ? await doc.getPageIndex(ref)
        : -1;
  if (!Number.isInteger(index) || index < 0 || index >= doc.numPages) return null;
  const mode = (explicit[1] as { name?: unknown } | undefined)?.name;
  const num = (i: number): number | null => {
    const value = explicit[i];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };
  let left: number | null = null;
  let top: number | null = null;
  if (mode === "XYZ") {
    left = num(2);
    top = num(3);
  } else if (mode === "FitH" || mode === "FitBH") {
    top = num(2);
  } else if (mode === "FitR") {
    left = num(2);
    top = num(5);
  }
  if (top === null) return { page: index };
  const shown = await page(index);
  if (!shown) return { page: index };
  const viewport = shown.getViewport({ scale: 1 });
  const [x, y] = viewport.convertToViewportPoint(left ?? 0, top);
  if (!(viewport.width > 0 && viewport.height > 0)) return { page: index };
  return {
    page: index,
    ...(left === null ? {} : { x: x / viewport.width }),
    y: y / viewport.height,
  };
}
