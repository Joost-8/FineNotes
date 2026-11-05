/**
 * The slice of pdf.js the Folders sidebar uses. Obsidian's `loadPdfJs()` is
 * declared `Promise<any>`; it is read through these types instead.
 */

import { loadPdfJs } from "obsidian";

export interface PdfViewport {
  width: number;
  height: number;
}

export interface PdfTextItem {
  str?: string;
}

export interface PdfPage {
  getViewport(options: { scale: number }): PdfViewport;
  getTextContent(): Promise<{ items: PdfTextItem[] }>;
  render(options: {
    canvasContext: CanvasRenderingContext2D;
    viewport: PdfViewport;
    canvas: HTMLCanvasElement;
    transform?: number[];
  }): { promise: Promise<void> };
  cleanup(): void;
}

export interface PdfDocument {
  numPages: number;
  getPage(number: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}

export interface PdfJs {
  getDocument(source: { data: Uint8Array | ArrayBuffer }): { promise: Promise<PdfDocument> };
}

/** Obsidian's own pdf.js, loaded the first time it is asked for. */
export function loadPdf(): Promise<PdfJs> {
  return loadPdfJs().then((lib: unknown) => lib as PdfJs);
}
