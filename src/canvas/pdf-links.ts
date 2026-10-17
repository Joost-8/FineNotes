/**
 * The links in a PDF backdrop: a planner's month tabs, its index, a web
 * address in a worksheet. pdf.js reports each as a Link annotation with a
 * rectangle in the PDF's own space and either a destination in the same PDF
 * or a URL; this places them on a notebook page of any size and finds the
 * one under a finger. Goodnotes' planner buyers' main complaint is links
 * that stop working; here they keep working on every page the PDF is on.
 *
 * Pure: no DOM, no pdf.js.
 */

import { type Matrix, pdfToPage } from "./pdf-text";

/** Where a link goes: a page of the same PDF (0-based), or a web address. */
export type PdfLinkTarget = { page: number } | { url: string };

/** A link as the PDF has it: `[x1, y1, x2, y2]` in PDF space. */
export interface PdfLink {
  rect: readonly [number, number, number, number];
  target: PdfLinkTarget;
}

/** A link placed on a notebook page, in page px. */
export interface PageLink {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  target: PdfLinkTarget;
}

/** The slice of a pdf.js annotation read here. */
export interface LinkAnnotationLike {
  subtype?: unknown;
  rect?: unknown;
  url?: unknown;
  unsafeUrl?: unknown;
  dest?: unknown;
}

/** Only these open from a tap: never `javascript:`, `file:` or the like. */
const SAFE_URL = /^(https?:|mailto:)/i;

/** A URL safe to open from a PDF, or null. */
export function safeUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const url = raw.trim();
  return SAFE_URL.test(url) ? url : null;
}

/**
 * The links among a page's annotations. `resolve` turns a destination (a
 * name or an explicit array) into a 0-based page of the same PDF, or null;
 * pdf.js answers it from the document.
 */
export async function readLinks(
  annotations: readonly LinkAnnotationLike[],
  resolve: (dest: unknown) => Promise<number | null>,
): Promise<PdfLink[]> {
  const out: PdfLink[] = [];
  for (const raw of annotations) {
    if (raw.subtype !== "Link" || !Array.isArray(raw.rect) || raw.rect.length < 4) continue;
    const r = raw.rect.slice(0, 4).map(Number);
    if (!r.every(Number.isFinite)) continue;
    const rect = [r[0], r[1], r[2], r[3]] as const;
    const url = safeUrl(raw.url) ?? safeUrl(raw.unsafeUrl);
    if (url) {
      out.push({ rect, target: { url } });
      continue;
    }
    if (raw.dest === undefined || raw.dest === null) continue;
    const page = await resolve(raw.dest).catch(() => null);
    if (typeof page === "number" && Number.isInteger(page) && page >= 0) {
      out.push({ rect, target: { page } });
    }
  }
  return out;
}

function apply(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/**
 * `links` on a notebook page of `geometry`, where the PDF page shows as
 * pdf.js's `viewport` transform at scale 1 of `source` size, fitted and
 * centred (as the backdrop is drawn, `pdfToPage`).
 */
export function linksOnPage(
  links: readonly PdfLink[],
  viewport: Matrix,
  source: { width: number; height: number },
  geometry: { width: number; height: number },
): PageLink[] {
  const m = pdfToPage(viewport, source, geometry);
  return links.map(({ rect, target }) => {
    const a = apply(m, rect[0], rect[1]);
    const b = apply(m, rect[2], rect[3]);
    return {
      minX: Math.min(a.x, b.x),
      minY: Math.min(a.y, b.y),
      maxX: Math.max(a.x, b.x),
      maxY: Math.max(a.y, b.y),
      target,
    };
  });
}

/**
 * The link under page point `p`, `tolerance` page px around each: the
 * smallest that holds it, so a small tab inside a big header wins.
 */
export function linkAt(
  links: readonly PageLink[],
  p: { x: number; y: number },
  tolerance: number,
): PageLink | null {
  let best: PageLink | null = null;
  let bestArea = Infinity;
  for (const link of links) {
    if (
      p.x < link.minX - tolerance ||
      p.x > link.maxX + tolerance ||
      p.y < link.minY - tolerance ||
      p.y > link.maxY + tolerance
    ) {
      continue;
    }
    const area = (link.maxX - link.minX) * (link.maxY - link.minY);
    if (area < bestArea) {
      best = link;
      bestArea = area;
    }
  }
  return best;
}

/**
 * The notebook page showing page `pdfPage` of the PDF at `path`, the one
 * nearest page `from` (a planner used twice in one notebook jumps within the
 * copy being read, back or forward); -1 when no page shows it.
 */
export function notebookPageOf(
  pages: ReadonlyArray<{ backdrop: { kind: string; path?: string; page?: number } }>,
  path: string,
  pdfPage: number,
  from = 0,
): number {
  let best = -1;
  pages.forEach((page, i) => {
    const b = page.backdrop;
    if (b.kind !== "pdf" || b.path !== path || b.page !== pdfPage) return;
    if (best < 0 || Math.abs(i - from) < Math.abs(best - from)) best = i;
  });
  return best;
}
