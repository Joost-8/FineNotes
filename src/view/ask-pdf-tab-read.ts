/**
 * `read_pdf_tab`, Ask AI's look into the PDFs kept in tabs beside the notes
 * (#263): the printed text of the pages asked for, read through the view's
 * PDF text cache, and a picture of the few that have little text, drawn with
 * the user's own marks on them. The pure parts are in
 * `recognition/ask-pdf-tabs.ts`.
 */

import type { ChatImage } from "../recognition/ai-chat";
import type { AskToolOutcome } from "../recognition/ai-client";
import {
  type AskPdfReading,
  type AskPdfTab,
  type ReadPdfTabCall,
  findPdfTab,
  pagesToPicture,
  pdfTabRange,
  pdfTabText,
  unknownTabText,
} from "../recognition/ask-pdf-tabs";
import type { RenderedPage } from "../recognition/page-render";
import type { BesidePdf } from "../model/beside-pdfs";
import type { InkDocument, Page } from "../model/document";
import { tabLabel } from "../model/pdf-tabs-list";
import { layoutPlainText } from "../search/pdf-hits";
import type { PdfTextCache } from "./pdf-text-source";

/** What reading a tab needs from the view. */
export interface PdfTabReadHost {
  /** The tabs on the strip. */
  tabs: () => readonly BesidePdf[];
  /** Whether the PDF at `path` is in the vault. */
  exists: (path: string) => boolean;
  /** The tab as a document: one page per PDF page, with the user's marks. */
  document: (beside: BesidePdf) => InkDocument;
  /** The view's PDF text cache; `null` before the notebook is open. */
  text: () => PdfTextCache | null;
  /** A page drawn for a vision model. */
  render: (page: Page) => Promise<RenderedPage | null>;
}

/** The tabs as Ask sees them: name, path and page count (0 when missing). */
export function askPdfTabs(host: PdfTabReadHost): AskPdfTab[] {
  return host.tabs().map((beside) => ({
    label: tabLabel(beside),
    path: beside.path,
    pages: host.exists(beside.path) ? pageCount(beside) : 0,
  }));
}

/** Run a `read_pdf_tab` call. */
export async function readPdfTab(
  host: PdfTabReadHost,
  call: ReadPdfTabCall,
): Promise<AskToolOutcome> {
  const tabs = askPdfTabs(host);
  const tab = findPdfTab(tabs, call.tab);
  const beside = tab ? host.tabs().find((b) => b.path === tab.path) : undefined;
  if (!tab || !beside) return { text: unknownTabText(tabs, call.tab), isError: true };
  if (tab.pages === 0) return { text: `${tab.path} is missing from the vault.`, isError: true };
  const range = pdfTabRange(call, tab.pages);
  if (!range) {
    return { text: `“${tab.label}” has ${tab.pages} pages.`, isError: true };
  }
  const cache = host.text();
  if (!cache) return { text: "The PDF cannot be read right now.", isError: true };
  const pages = host.document(beside).pages;
  const texts: Array<{ page: number; text: string }> = [];
  for (let n = range.from; n <= range.to; n++) {
    const page = pages[n - 1];
    if (!page || page.backdrop.kind !== "pdf") continue;
    try {
      texts.push({
        page: n,
        text: layoutPlainText(await cache.layout(page.backdrop, page.geometry)),
      });
    } catch {
      texts.push({ page: n, text: "" });
    }
  }
  const images: ChatImage[] = [];
  const pictured: number[] = [];
  for (const n of pagesToPicture(texts)) {
    const page = pages[n - 1];
    const rendered = page ? await host.render(page) : null;
    if (!rendered) continue;
    images.push({ base64: rendered.base64, mimeType: "image/png" });
    pictured.push(n);
  }
  const text = pdfTabText(tab, texts, pictured);
  return images.length > 0 ? { text, images } : { text };
}

/**
 * The printed text of the page the user is reading, for the question to
 * carry; "" when it cannot be read (missing PDF, no text, an error).
 */
export async function slideText(host: PdfTabReadHost, reading: AskPdfReading): Promise<string> {
  const beside = host.tabs().find((b) => b.path === reading.path);
  const cache = host.text();
  if (!beside || !cache || !host.exists(beside.path)) return "";
  const page = host.document(beside).pages[reading.page - 1];
  if (!page || page.backdrop.kind !== "pdf") return "";
  try {
    return layoutPlainText(await cache.layout(page.backdrop, page.geometry));
  } catch {
    return "";
  }
}

/** A tab's page count, from the sizes kept with it. */
function pageCount(beside: BesidePdf): number {
  return beside.sizes.reduce((sum, [, , count]) => sum + count, 0);
}
