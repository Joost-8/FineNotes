/**
 * PDFs kept beside a notebook's notes, as tabs inside the notebook view.
 *
 * A PDF is linked by vault path and never copied; a move or rename is
 * followed (`moved-files.ts`), and a missing file keeps its tab and its ink,
 * laid out from the page sizes stored with it. Ink written on a PDF tab is
 * stored in the notebook (`InkDocument.beside`), one {@link Page} per PDF
 * page that has any, keyed by the tab and the 0-based PDF page.
 *
 * The view shows a tab as an ordinary document built by
 * {@link besideDocument}: one page per PDF page, where the pages with marks
 * are the very objects in {@link BesidePdf.marks}, so commands run on that
 * document change the stored model. {@link syncMarks} then takes in pages
 * that gained ink and lets go of pages that became empty.
 *
 * Page ids on a tab are `~t<tab id>~<pdf page>`: a notes page id is minted as
 * `p<n>` (`nextPageId`) or `p-<nnn>` (`model/notebook.ts`), and a tab id has
 * no `~`, so no notes page and no other tab's page can carry one.
 *
 * Pure: no DOM, no Obsidian.
 */

import { mintedId } from "./dot-ids";
import { DEFAULT_PAGE_HEIGHT, DEFAULT_PAPER_WIDTH, SCHEMA_VERSION } from "../constants";
import type { BesidePdf, BesideView, InkDocument, Page, PageGeometry, SlideRef } from "./document";

export type { BesidePdf, BesideView, SlideRef } from "./document";

/** One run of equally sized PDF pages: width and height in page px, and how many. */
export type SizeRun = [width: number, height: number, count: number];

/** Pages a tab lays out at most: a size read from a file never allocates more. */
export const MAX_BESIDE_PAGES = 10_000;

/** What starts every page id on a tab; nothing else mints a `~`. */
export const BESIDE_PAGE_PREFIX = "~t";

const TAB_ID = /^[A-Za-z0-9_-]+$/;

/** Whether `id` can name a tab: non-empty, without `~` or anything else odd. */
export function isTabId(id: unknown): id is string {
  return typeof id === "string" && TAB_ID.test(id);
}

/** The id of page `page` (0-based) of tab `tab`. */
export function besidePageId(tab: string, page: number): string {
  return `${BESIDE_PAGE_PREFIX}${tab}~${page}`;
}

/** Whether a page id belongs to a tab beside the notes. */
export function isBesidePageId(id: string): boolean {
  return id.startsWith(BESIDE_PAGE_PREFIX);
}

/** The tab and PDF page a tab page id names, or `null` for any other id. */
export function parseBesidePageId(id: string): SlideRef | null {
  if (!isBesidePageId(id)) return null;
  const rest = id.slice(BESIDE_PAGE_PREFIX.length);
  const cut = rest.lastIndexOf("~");
  if (cut <= 0) return null;
  const tab = rest.slice(0, cut);
  const digits = rest.slice(cut + 1);
  if (!isTabId(tab) || !/^[0-9]+$/.test(digits)) return null;
  return { tab, page: Number(digits) };
}

// --- Sizes ----------------------------------------------------------------------

function isPositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Page sizes, in order, as runs of equal sizes. */
export function sizesToRuns(pages: readonly PageGeometry[]): SizeRun[] {
  const runs: SizeRun[] = [];
  for (const { width, height } of pages.slice(0, MAX_BESIDE_PAGES)) {
    const w = isPositive(width) ? width : DEFAULT_PAPER_WIDTH;
    const h = isPositive(height) ? height : DEFAULT_PAGE_HEIGHT;
    const last = runs[runs.length - 1];
    if (last && last[0] === w && last[1] === h) last[2]++;
    else runs.push([w, h, 1]);
  }
  return runs;
}

/**
 * Stored size runs, made safe: a bad width or height becomes the default
 * page's (the run is kept, so later pages keep their numbers), a count is a
 * whole number of at least 1, and the total never passes
 * {@link MAX_BESIDE_PAGES}. Anything that is not a run at all is skipped.
 */
export function readSizeRuns(raw: unknown): SizeRun[] {
  if (!Array.isArray(raw)) return [];
  const runs: SizeRun[] = [];
  let total = 0;
  for (const run of raw as unknown[]) {
    if (total >= MAX_BESIDE_PAGES) break;
    if (!Array.isArray(run)) continue;
    const [w, h, n] = run as unknown[];
    const count = typeof n === "number" && Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
    const kept = Math.min(count, MAX_BESIDE_PAGES - total);
    runs.push([
      isPositive(w) ? w : DEFAULT_PAPER_WIDTH,
      isPositive(h) ? h : DEFAULT_PAGE_HEIGHT,
      kept,
    ]);
    total += kept;
  }
  return runs;
}

/** How many PDF pages the tab lays out. */
export function pageCount(beside: Pick<BesidePdf, "sizes">): number {
  let total = 0;
  for (const run of beside.sizes) total += run[2];
  return total;
}

/** The size of PDF page `page` (0-based), or `null` past the end. */
export function pageSizeAt(beside: Pick<BesidePdf, "sizes">, page: number): PageGeometry | null {
  if (!Number.isInteger(page) || page < 0) return null;
  let start = 0;
  for (const [width, height, count] of beside.sizes) {
    if (page < start + count) return { width, height };
    start += count;
  }
  return null;
}

/** A stored tab view, only when every number in it makes sense. */
export function readBesideView(raw: unknown): BesideView | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const { page, zoom, x, y } = raw as Record<string, unknown>;
  if (typeof page !== "number" || !Number.isInteger(page) || page < 0) return undefined;
  if (!isPositive(zoom)) return undefined;
  if (typeof x !== "number" || !Number.isFinite(x)) return undefined;
  if (typeof y !== "number" || !Number.isFinite(y)) return undefined;
  return { page, zoom, x, y };
}

/** A stored slide reference, only when it names a tab id and a whole page. */
export function readSlideRef(raw: unknown): SlideRef | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const { tab, page } = raw as Record<string, unknown>;
  if (!isTabId(tab)) return undefined;
  if (typeof page !== "number" || !Number.isInteger(page) || page < 0) return undefined;
  return { tab, page };
}

// --- The tabs of a notebook ----------------------------------------------------------

/** The tab with this id, or `null`. */
export function findBeside(doc: InkDocument, id: string): BesidePdf | null {
  return doc.beside?.find((beside) => beside.id === id) ?? null;
}

/** The tab showing the PDF at `path`, or `null`. */
export function besideByPath(doc: InkDocument, path: string): BesidePdf | null {
  return doc.beside?.find((beside) => beside.path === path) ?? null;
}

/** A tab id no tab of `doc` has: `b1`, `b2`, … */
export function nextTabId(doc: InkDocument): string {
  // A notebook kept as page files: this device's dot, with a dash (a tab id holds no dot).
  const minted = mintedId(doc);
  if (minted) return minted.replace(".", "-");
  let max = 0;
  for (const beside of doc.beside ?? []) {
    const m = /^b(\d+)$/.exec(beside.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `b${max + 1}`;
}

/**
 * Keep the PDF at `path` beside the notes, with its page sizes (runs, as
 * {@link sizesToRuns} makes them). A PDF already kept is not added twice:
 * its tab is shown again and handed back.
 */
export function attachPdf(
  doc: InkDocument,
  path: string,
  sizes: readonly SizeRun[],
  label?: string,
): BesidePdf {
  const existing = besideByPath(doc, path);
  if (existing) {
    delete existing.hidden;
    return existing;
  }
  const beside: BesidePdf = { id: nextTabId(doc), path, sizes: readSizeRuns(sizes), marks: [] };
  const name = cleanLabel(label);
  if (name !== undefined) beside.label = name;
  (doc.beside ??= []).push(beside);
  return beside;
}

function cleanLabel(label: unknown): string | undefined {
  if (typeof label !== "string") return undefined;
  const trimmed = label.replace(/\s+/g, " ").trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** A stored tab name, trimmed to one line; absent when empty. */
export function readLabel(raw: unknown): string | undefined {
  return cleanLabel(raw);
}

/** Close a tab from the tab bar; its ink is kept. Whether anything changed. */
export function hideTab(doc: InkDocument, id: string): boolean {
  const beside = findBeside(doc, id);
  if (!beside || beside.hidden) return false;
  beside.hidden = true;
  return true;
}

/** Bring a closed tab back. Whether anything changed. */
export function showTab(doc: InkDocument, id: string): boolean {
  const beside = findBeside(doc, id);
  if (!beside?.hidden) return false;
  delete beside.hidden;
  return true;
}

/** Name a tab; an empty name goes back to the file's name. Whether anything changed. */
export function renameTab(doc: InkDocument, id: string, label: string): boolean {
  const beside = findBeside(doc, id);
  if (!beside) return false;
  const name = cleanLabel(label);
  if (name === beside.label) return false;
  if (name === undefined) delete beside.label;
  else beside.label = name;
  return true;
}

/** Remember where a tab was left. Whether anything changed. */
export function setTabView(doc: InkDocument, id: string, view: BesideView): boolean {
  const beside = findBeside(doc, id);
  const clean = readBesideView(view);
  if (!beside || !clean) return false;
  const old = beside.view;
  if (
    old &&
    old.page === clean.page &&
    old.zoom === clean.zoom &&
    old.x === clean.x &&
    old.y === clean.y
  ) {
    return false;
  }
  beside.view = clean;
  return true;
}

// --- A tab as a document ---------------------------------------------------------------

/** Whether a page holds anything worth keeping: ink, pictures, text or any other element. */
export function hasMarks(page: Page): boolean {
  return (
    page.strokes.length > 0 ||
    page.images.length > 0 ||
    page.textBoxes.length > 0 ||
    (page.tables?.length ?? 0) > 0 ||
    (page.graphs?.length ?? 0) > 0 ||
    (page.equations?.length ?? 0) > 0 ||
    (page.comments?.length ?? 0) > 0
  );
}

/** The 0-based PDF page a tab page shows, or `null` when it is not a PDF page. */
export function pdfPageOf(page: Page): number | null {
  return page.backdrop.kind === "pdf" ? page.backdrop.page : null;
}

/** A blank page of tab `beside` showing PDF page `index`. */
export function besidePage(beside: BesidePdf, index: number, geometry: PageGeometry): Page {
  return {
    id: besidePageId(beside.id, index),
    kind: "ink",
    geometry: { width: geometry.width, height: geometry.height },
    backdrop: { kind: "pdf", path: beside.path, page: index },
    strokes: [],
    images: [],
    textBoxes: [],
  };
}

/**
 * The tab as a document of its own: one page per PDF page. A page with marks
 * is the very object in `beside.marks` (so an edit made through this
 * document is an edit of the stored ink); the others are blank pages made
 * here, with stable ids. Marks past the PDF's last page (the file shrank)
 * stay stored and are not shown.
 */
export function besideDocument(beside: BesidePdf): InkDocument {
  const marked = new Map<number, Page>();
  for (const page of beside.marks) {
    const index = pdfPageOf(page);
    if (index !== null && !marked.has(index)) marked.set(index, page);
  }
  const pages: Page[] = [];
  let index = 0;
  for (const [width, height, count] of beside.sizes) {
    for (let i = 0; i < count; i++, index++) {
      pages.push(marked.get(index) ?? besidePage(beside, index, { width, height }));
    }
  }
  if (pages.length === 0) pages.push(besidePage(beside, 0, defaultGeometry()));
  const first = pages[0].geometry;
  return {
    version: SCHEMA_VERSION,
    view: {
      scrollY: beside.view?.y ?? 0,
      width: first.width,
      scale: beside.view?.zoom ?? 1,
    },
    pages,
  };
}

function defaultGeometry(): PageGeometry {
  return { width: DEFAULT_PAPER_WIDTH, height: DEFAULT_PAGE_HEIGHT };
}

/** The pages of a tab's document that hold marks, in order. */
export function storedMarks(doc: InkDocument): Page[] {
  return doc.pages.filter((page) => pdfPageOf(page) !== null && hasMarks(page));
}

/**
 * Bring `beside.marks` in line with the tab's document after edits: pages
 * that gained marks are taken in, pages left empty are let go, and marks for
 * PDF pages the document does not show are kept. In place, in PDF page
 * order. Whether the list changed.
 */
export function syncMarks(beside: BesidePdf, doc: InkDocument): boolean {
  const shown = new Set<number>();
  for (const page of doc.pages) {
    const index = pdfPageOf(page);
    if (index !== null) shown.add(index);
  }
  const kept = beside.marks.filter((page) => {
    const index = pdfPageOf(page);
    return index !== null && !shown.has(index);
  });
  const next = [...kept, ...storedMarks(doc)].sort(
    (a, b) => (pdfPageOf(a) ?? 0) - (pdfPageOf(b) ?? 0),
  );
  const changed =
    next.length !== beside.marks.length || next.some((page, i) => page !== beside.marks[i]);
  if (changed) beside.marks = next;
  return changed;
}

/** Whether a notebook uses anything of PDF tabs: a tab, or a snippet that remembers its slide. */
export function usesPdfTabs(doc: InkDocument): boolean {
  if ((doc.beside?.length ?? 0) > 0) return true;
  return doc.pages.some((page) => page.images.some((image) => image.slide !== undefined));
}

/**
 * The slides kept ready around slide `index` of `count`: the next first,
 * then the one before, then the one after the next (it shows at the pane's
 * foot once the next is gone to). A reader mostly goes on.
 */
export function slidesAround(index: number, count: number): number[] {
  return [index + 1, index - 1, index + 2].filter((i) => i >= 0 && i < count);
}
