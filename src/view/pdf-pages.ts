/**
 * The page sizes of a PDF, for adding it to a notebook as PDF-backed pages
 * (see `buildScanInsert`). Uses the pdf.js Obsidian bundles (`loadPdfJs`),
 * as `pdf-backdrop.ts` does for drawing those pages; nothing is bundled.
 */

import { loadPdfJs } from "obsidian";

// The slice of pdf.js used here. `loadPdfJs()` is typed `Promise<any>`, and
// `any` is an error in this repo (pdf-backdrop.ts types its own slice too).
interface PdfPageLike {
  getViewport(params: { scale: number }): { width: number; height: number };
  render(params: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }): { promise: Promise<void> };
  cleanup?: () => void;
}

interface PdfDocumentLike {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
  destroy(): Promise<void>;
}

interface PdfJsLike {
  getDocument(src: { data: Uint8Array }): { promise: Promise<PdfDocumentLike> };
}

/**
 * Each page's size in PDF points, rotation applied (what `getViewport` at
 * scale 1 reports). Rejects when the bytes are not a readable PDF, or it
 * has no pages.
 *
 * pdf.js may transfer the buffer it is given to its worker and detach it
 * (CLAUDE.md), and these bytes are saved to the vault afterwards, so it
 * gets a private copy.
 */
export async function measurePdfPages(
  bytes: ArrayBuffer,
): Promise<Array<{ width: number; height: number }>> {
  const lib = await loadPdfJs().then((value: unknown) => value as PdfJsLike);
  const doc = await lib.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
  try {
    const sizes: Array<{ width: number; height: number }> = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const { width, height } = page.getViewport({ scale: 1 });
      sizes.push({ width, height });
      page.cleanup?.();
    }
    if (sizes.length === 0) throw new Error("The PDF has no pages");
    return sizes;
  } finally {
    await doc.destroy().catch(() => undefined);
  }
}

/** The longest edge, in pixels, of a PDF page drawn as a picture. */
const PICTURE_EDGE = 2000;

/**
 * A PDF's first page as PNG bytes, at most {@link PICTURE_EDGE} pixels on its
 * longer side: what a PDF placed on a page as a picture looks like. Rejects
 * when the bytes are not a readable PDF.
 */
export async function rasterizePdfFirstPage(bytes: Uint8Array): Promise<Uint8Array> {
  const lib = await loadPdfJs().then((value: unknown) => value as PdfJsLike);
  const doc = await lib.getDocument({ data: new Uint8Array(bytes) }).promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({
      scale: Math.min(4, PICTURE_EDGE / Math.max(1, base.width, base.height)),
    });
    // Obsidian's global createEl gives a detached canvas (see pdf-backdrop.ts).
    const canvas = createEl("canvas");
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    page.cleanup?.();
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("PNG encoding failed"))),
        "image/png",
      ),
    );
    canvas.width = canvas.height = 0;
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    await doc.destroy().catch(() => undefined);
  }
}
