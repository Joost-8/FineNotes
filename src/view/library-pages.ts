/**
 * Pages of a notebook drawn small for Home: its real cover, the page the
 * reader left off on (the Continue card) and the page strip of the preview.
 *
 * A notebook is read whole (`parseInkFile`) once per change and kept for a
 * few notebooks only; a page is drawn with the same `renderPageThumbnail`
 * the page sidebar uses. A PDF page's raster comes from Home's PDF cache
 * and is laid under the page's own ink, as the PDF export does.
 */

import type { App, TFile } from "obsidian";
import { renderPageThumbnail } from "../canvas/renderer";
import { parseInkFile } from "../model/serialize";
import type { InkDocument, Page } from "../model/document";
import { VaultBackdropRenderer } from "./backdrop-renderer";
import type { PdfBackdropCache } from "./pdf-backdrop";
import { thumbnailRasterScale } from "./page-sidebar";

/** How many notebooks are kept read at once. */
const KEPT = 4;

export class NotebookPages {
  private readonly docs = new Map<string, { stamp: string; doc: Promise<InkDocument | null> }>();
  private readonly painter = new VaultBackdropRenderer(null);

  constructor(
    private readonly app: App,
    private readonly pdf: () => PdfBackdropCache,
  ) {}

  /** The notebook, read once per change of its file. */
  doc(file: TFile): Promise<InkDocument | null> {
    const stamp = `${file.stat.mtime}:${file.stat.size}`;
    const kept = this.docs.get(file.path);
    if (kept && kept.stamp === stamp) {
      // Most recently used last.
      this.docs.delete(file.path);
      this.docs.set(file.path, kept);
      return kept.doc;
    }
    const doc = this.app.vault
      .cachedRead(file)
      .then((text) => parseInkFile(text).doc)
      .catch(() => null);
    this.docs.set(file.path, { stamp, doc });
    while (this.docs.size > KEPT) {
      const oldest = this.docs.keys().next().value;
      if (oldest === undefined) break;
      this.docs.delete(oldest);
    }
    return doc;
  }

  /** Page `index` of `file` drawn `cssWidth` CSS px wide, or null when it has no such page. */
  async render(file: TFile, index: number, cssWidth: number): Promise<HTMLCanvasElement | null> {
    const doc = await this.doc(file);
    const page = doc?.pages[index];
    if (!page) return null;
    return this.renderPage(page, cssWidth);
  }

  /** How many pages `file` has, the cover included. */
  async pageCount(file: TFile): Promise<number> {
    return (await this.doc(file))?.pages.length ?? 0;
  }

  private async renderPage(page: Page, cssWidth: number): Promise<HTMLCanvasElement> {
    const dpr = window.devicePixelRatio || 1;
    const canvas = createEl("canvas");
    const backdrop = page.backdrop;
    if (backdrop.kind !== "pdf") {
      renderPageThumbnail(canvas, page, this.painter, cssWidth, dpr, { usePressure: true });
      return canvas;
    }
    // A PDF page: its raster under the page's own ink.
    const ink = createEl("canvas");
    renderPageThumbnail(ink, page, this.painter, cssWidth, dpr, {
      usePressure: true,
      transparent: true,
    });
    canvas.width = ink.width;
    canvas.height = ink.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return ink;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Sharp at the size it is shown: device px per page px, a little over, never past 2.
    const scale = Math.min(
      2,
      Math.max(thumbnailRasterScale(dpr), (cssWidth * dpr * 1.25) / page.geometry.width),
    );
    const entry = await this.pdf().resolve(
      backdrop.path,
      backdrop.page,
      scale,
      { geometry: page.geometry },
      true,
    );
    if (entry.ok) ctx.drawImage(entry.canvas, 0, 0, canvas.width, canvas.height);
    ctx.drawImage(ink, 0, 0);
    ink.width = ink.height = 0;
    return canvas;
  }
}
