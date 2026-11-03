/**
 * Rasterising a PDF page for OCR (recognition/ocr): in the shared PDF worker
 * (pdf-worker.ts, an OffscreenCanvas drawn there and handed back as an
 * ImageBitmap at no cost) at about 170 dpi, or, when that worker cannot run
 * here, with Obsidian's pdf.js on this thread, as the backdrop cache does.
 *
 * It reads each PDF's bytes once per use (read-only; the PDF is never
 * written) and lets the worker's copy go when the PDF is released.
 */

import { type App, type TFile, loadPdfJs } from "obsidian";
import { rasterScale } from "../recognition/ocr/det";
import {
  PdfCanvasUnavailable,
  type PdfWorker,
  acquirePdfWorker,
  pdfAssets,
  releasePdfWorker,
} from "./pdf-worker";

/** A page drawn for OCR: the image, and the page's size in points. */
export interface OcrRaster {
  bitmap: ImageBitmap;
  /** Pixels per point. */
  scale: number;
  pageWidth: number;
  pageHeight: number;
}

// The slice of pdf.js used on this thread.
interface PdfPageLike {
  getViewport(params: { scale: number }): { width: number; height: number };
  render(params: { canvasContext: CanvasRenderingContext2D; viewport: unknown }): {
    promise: Promise<unknown>;
  };
  cleanup?: () => void;
}
interface PdfDocumentLike {
  numPages: number;
  getPage(n: number): Promise<PdfPageLike>;
  destroy(): Promise<void>;
}
interface PdfJsLike {
  getDocument(src: { data: Uint8Array } & ReturnType<typeof pdfAssets>): {
    promise: Promise<PdfDocumentLike>;
  };
}

export class OcrRasteriser {
  private worker: Promise<PdfWorker | null> | null = null;
  private workerHeld = false;
  /** Per path: its pages in the worker (null: the file is missing). */
  private readonly inWorker = new Map<string, Promise<number | null>>();
  private readonly onThread = new Map<string, Promise<PdfDocumentLike | null>>();

  constructor(private readonly app: App) {}

  private shared(): Promise<PdfWorker | null> {
    if (!this.worker) {
      this.workerHeld = true;
      this.worker = acquirePdfWorker();
    }
    return this.worker;
  }

  private async readBytes(path: string): Promise<ArrayBuffer | null> {
    const file: TFile | null = this.app.vault.getFileByPath(path);
    return file ? await this.app.vault.readBinary(file) : null;
  }

  private openInWorker(worker: PdfWorker, path: string): Promise<number | null> {
    let open = this.inWorker.get(path);
    if (!open) {
      open = (async () => {
        const bytes = await this.readBytes(path);
        // Handed over, not copied: nothing here reads the bytes again.
        return bytes ? await worker.open(path, bytes) : null;
      })();
      this.inWorker.set(path, open);
      open.catch(() => this.inWorker.delete(path));
    }
    return open;
  }

  private openOnThread(path: string): Promise<PdfDocumentLike | null> {
    let doc = this.onThread.get(path);
    if (!doc) {
      doc = (async () => {
        const bytes = await this.readBytes(path);
        if (!bytes) return null;
        const lib = (await loadPdfJs()) as PdfJsLike;
        return await lib.getDocument({ data: new Uint8Array(bytes), ...pdfAssets() }).promise;
      })();
      this.onThread.set(path, doc);
      doc.catch(() => this.onThread.delete(path));
    }
    return doc;
  }

  /** Page `page` (0-based) of `path` as an image; throws when it cannot be drawn. */
  async render(path: string, page: number): Promise<OcrRaster> {
    const worker = await this.shared();
    if (worker?.alive) {
      try {
        return await this.renderInWorker(worker, path, page);
      } catch (error) {
        // Out of canvas memory is no reason to try again on this thread.
        if (error instanceof PdfCanvasUnavailable) throw error;
        if (worker.alive) throw error;
      }
    }
    return await this.renderOnThread(path, page);
  }

  private async renderInWorker(worker: PdfWorker, path: string, page: number): Promise<OcrRaster> {
    const pages = await this.openInWorker(worker, path);
    if (pages === null) throw new Error(`missing PDF ${path}`);
    if (!Number.isInteger(page) || page < 0 || page >= pages) {
      throw new Error(`page ${page + 1} is outside ${path}`);
    }
    const size = await worker.pageSize(path, page);
    const scale = rasterScale(size.width, size.height);
    const render = worker.render(path, page, {
      sourceScale: scale,
      width: Math.max(1, Math.round(size.width * scale)),
      height: Math.max(1, Math.round(size.height * scale)),
    });
    const bitmap = await render.promise;
    return { bitmap, scale, pageWidth: size.width, pageHeight: size.height };
  }

  private async renderOnThread(path: string, page: number): Promise<OcrRaster> {
    const doc = await this.openOnThread(path);
    if (!doc) throw new Error(`missing PDF ${path}`);
    if (!Number.isInteger(page) || page < 0 || page >= doc.numPages) {
      throw new Error(`page ${page + 1} is outside ${path}`);
    }
    const pdfPage = await doc.getPage(page + 1);
    try {
      const base = pdfPage.getViewport({ scale: 1 });
      const scale = rasterScale(base.width, base.height);
      const viewport = pdfPage.getViewport({ scale });
      // Obsidian's global createEl, not document.createElement: it returns a
      // detached element, which is what an offscreen target must be.
      const canvas = createEl("canvas");
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const context = canvas.getContext("2d");
      if (!context) {
        canvas.width = canvas.height = 0;
        throw new PdfCanvasUnavailable();
      }
      try {
        await pdfPage.render({ canvasContext: context, viewport }).promise;
        const bitmap = await createImageBitmap(canvas);
        return { bitmap, scale, pageWidth: base.width, pageHeight: base.height };
      } finally {
        // iOS keeps a canvas's memory until it is emptied.
        canvas.width = canvas.height = 0;
      }
    } finally {
      pdfPage.cleanup?.();
    }
  }

  /** Let go of `path` (the worker's and this thread's copy of it). */
  release(path: string): void {
    const open = this.inWorker.get(path);
    this.inWorker.delete(path);
    if (open) {
      void Promise.all([open, this.worker ?? Promise.resolve(null)]).then(
        ([pages, worker]) => {
          if (pages !== null) worker?.close(path);
        },
        () => undefined,
      );
    }
    const doc = this.onThread.get(path);
    this.onThread.delete(path);
    void doc?.then((d) => d?.destroy()).catch(() => undefined);
  }

  dispose(): void {
    for (const path of [...this.inWorker.keys(), ...this.onThread.keys()]) this.release(path);
    if (this.workerHeld) {
      this.workerHeld = false;
      this.worker = null;
      releasePdfWorker();
    }
  }
}
