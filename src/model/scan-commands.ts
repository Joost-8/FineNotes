/**
 * Putting scanned pages into a notebook — pure, like the rest of the model.
 *
 * Two kinds of scan arrive here:
 *
 * - **A straightened photo** becomes a new page, the size of the current
 *   page (turned to the scan's orientation), with the picture fitted inside
 *   a small margin.
 * - **A PDF** — typically from the iPad Files app's own "Scan Documents",
 *   which beats anything a web page can do — becomes one PDF-backed page per
 *   PDF page (`{ kind: "pdf", path, page }`, drawn by the existing backdrop
 *   renderer), each shaped like its PDF page.
 *
 * Everything goes in **after the current page, in order, as one undo step**:
 * a single `CompositeCommand` of `AddPage` (+ `InsertImage`) parts, so Undo
 * takes a whole scanning session back at once. (The view does not call
 * `insertImageBytes`, which would push an undo step per picture.)
 *
 * A single-page document never gains a page (contracts/api.md §6): its photo
 * scans are placed on the current page instead, and PDFs — which can only
 * be pages — are left out (the view does not offer them there).
 */

import { AddPage, type Command, InsertImage } from "./commands";
import type { Backdrop, InkDocument, Page, PageGeometry } from "./document";
import { newImageElement } from "./images";
import { CompositeCommand, nextPageId } from "./page-commands";
import { paperTemplateFor } from "./templates";

/** Margin around a scan on its page, as a fraction of the page's shorter side. */
export const SCAN_MARGIN = 0.035;

/** A straightened photo already saved in the vault. */
export interface SavedScan {
  kind?: "image";
  /** Vault path of the picture. */
  path: string;
  /** Its pixel size, for the aspect. */
  width: number;
  height: number;
}

/** A PDF already saved in the vault, with the size of each of its pages (PDF points). */
export interface SavedPdf {
  kind: "pdf";
  path: string;
  pages: ReadonlyArray<{ width: number; height: number }>;
}

export type SavedItem = SavedScan | SavedPdf;

/** A page the scans went onto, so the view can scroll to it and select the picture. */
export interface PlacedScan {
  pageId: string;
  pageIndex: number;
  /** The placed picture; absent on a PDF page. */
  imageId?: string;
}

export interface ScanInsert {
  command: CompositeCommand;
  placed: PlacedScan[];
  /** False when the scans went onto the current page (a single-page document). */
  addedPages: boolean;
}

/**
 * The name a scan is saved under, without extension: `Scan 20260922-153012`,
 * and `… p2` for the second of several scanned together, so one session's
 * pages sort together and in order in the attachments folder.
 */
export function scanFileName(now: Date, index = 0, count = 1): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return count > 1 ? `Scan ${stamp} p${index + 1}` : `Scan ${stamp}`;
}

/**
 * Whether a picked file is a PDF: its first bytes say `%PDF-` (the header
 * may sit anywhere in the first KB), or failing that its type or name does.
 */
export function looksLikePdf(head: Uint8Array, mime: string, name: string): boolean {
  const magic = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
  const end = Math.min(head.length, 1024) - magic.length;
  for (let i = 0; i <= end; i++) {
    if (magic.every((byte, k) => head[i + k] === byte)) return true;
  }
  return mime.toLowerCase() === "application/pdf" || /\.pdf$/i.test(name);
}

/**
 * The current page's size, turned to the scan's orientation: a landscape
 * scan gets a landscape page (the same two sides, swapped), so it is not
 * shrunk to a strip across a portrait sheet. A square scan keeps the page.
 */
export function scanPageGeometry(
  current: PageGeometry,
  scan: { width: number; height: number },
): PageGeometry {
  const pageLandscape = current.width > current.height;
  const scanLandscape = scan.width > scan.height;
  if (scan.width === scan.height || pageLandscape === scanLandscape) return { ...current };
  return { width: current.height, height: current.width };
}

/**
 * A page for one PDF page: the PDF page's own shape, with its short side
 * equal to the current page's short side — so the PDF fills the page with
 * no bars, and ink on it is at the notebook's usual scale. A page with no
 * usable size gets the current page's geometry.
 */
export function pdfPageGeometry(
  current: PageGeometry,
  pdfPage: { width: number; height: number },
): PageGeometry {
  const { width: w, height: h } = pdfPage;
  if (!(w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h))) return { ...current };
  const short = Math.min(current.width, current.height);
  return w <= h
    ? { width: short, height: Math.round((short * h) / w) }
    : { width: Math.round((short * w) / h), height: short };
}

/**
 * The box a scan occupies on a page: its aspect kept, as large as fits
 * inside a {@link SCAN_MARGIN} margin, centred. A scan is the page's content,
 * so unlike an ordinary picture it is enlarged to fill the page.
 */
export function scanImageBox(
  scan: { width: number; height: number },
  page: PageGeometry,
  margin = SCAN_MARGIN,
): { x: number; y: number; w: number; h: number } {
  const m = Math.min(page.width, page.height) * margin;
  const availW = Math.max(1, page.width - 2 * m);
  const availH = Math.max(1, page.height - 2 * m);
  const sw = scan.width > 0 && Number.isFinite(scan.width) ? scan.width : 1;
  const sh = scan.height > 0 && Number.isFinite(scan.height) ? scan.height : 1;
  const k = Math.min(availW / sw, availH / sh);
  const w = sw * k;
  const h = sh * k;
  return { x: (page.width - w) / 2, y: (page.height - h) / 2, w, h };
}

/**
 * Blank paper for a scan page, in the notebook's paper colour: ruling lines
 * showing round the margin of a scan look like a mistake, and a PDF or cover
 * backdrop cannot be repeated.
 */
export function scanBackdrop(doc: InkDocument, index: number): Backdrop {
  const paper = paperTemplateFor(doc.pages, index);
  if (paper.kind !== "pdf" && paper.paperColor) {
    return { kind: "blank", paperColor: paper.paperColor };
  }
  return { kind: "blank" };
}

/**
 * The command that puts `items` into `doc` after page `currentIndex` — or,
 * in a single-page document, its photo scans onto that page — plus where
 * each page went. `null` when there is nothing to insert or no such page.
 *
 * Ids are allocated as if each earlier item were already in: pages and
 * images are minted against a copy of the page list that grows as the
 * command is built, so three scans get three distinct page and image ids.
 */
export function buildScanInsert(
  doc: InkDocument,
  currentIndex: number,
  items: readonly SavedItem[],
): ScanInsert | null {
  const current = doc.pages[currentIndex];
  if (!current) return null;
  const single = doc.single === true;
  const parts: Command[] = [];
  const placed: PlacedScan[] = [];
  // What the document will look like, for fresh ids; never mutated itself.
  const pages: Page[] = [...doc.pages];
  const preview = (): InkDocument => ({ ...doc, pages });
  let at = currentIndex + 1;

  const addPage = (geometry: PageGeometry, backdrop: Backdrop): Page => {
    const page: Page = {
      id: nextPageId(preview()),
      kind: "ink",
      geometry,
      backdrop,
      strokes: [],
      images: [],
      textBoxes: [],
    };
    parts.push(new AddPage(at, page));
    pages.splice(at, 0, page);
    at++;
    return page;
  };

  for (const item of items) {
    if (item.kind === "pdf") {
      if (single) continue;
      item.pages.forEach((size, page) => {
        const added = addPage(pdfPageGeometry(current.geometry, size), {
          kind: "pdf",
          path: item.path,
          page,
        });
        placed.push({ pageId: added.id, pageIndex: at - 1 });
      });
      continue;
    }
    const pageIndex = single ? currentIndex : at;
    const page = single
      ? current
      : addPage(scanPageGeometry(current.geometry, item), scanBackdrop(doc, currentIndex));
    const image = newImageElement(preview(), item.path, scanImageBox(item, page.geometry));
    parts.push(new InsertImage(page.id, image));
    // Account for the image in the id preview without touching the real page.
    pages[pageIndex] = { ...pages[pageIndex], images: [...pages[pageIndex].images, image] };
    placed.push({ pageId: page.id, pageIndex, imageId: image.id });
  }

  if (parts.length === 0) return null;
  const count = single ? placed.length : pages.length - doc.pages.length;
  const label = count === 1 ? "Scan document" : `Scan ${count} pages`;
  return { command: new CompositeCommand(label, parts), placed, addedPages: !single };
}
