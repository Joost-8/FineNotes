/**
 * The text of PDF backdrop pages, read with pdf.js `getTextContent` and kept
 * per page, for the highlighter that snaps to text and for Copy text.
 *
 * Like the raster cache (`pdf-backdrop.ts`) it is two-phase so that it never
 * stalls the pen: {@link PdfTextCache.peek} is a synchronous lookup, and when
 * it misses the caller goes on freehand and calls {@link PdfTextCache.request},
 * which reads in the background and fires {@link PdfTextCache.onReady}. While
 * held (the pen is writing, `write-hold.ts`) nothing is read; what was asked
 * for meanwhile is read once the pen has been up a moment.
 *
 * It opens its own read-only copy of each PDF it is asked about, through
 * Obsidian's bundled pdf.js (`loadPdfJs`), so it is independent of where the
 * pages are rasterised. The parsing runs in pdf.js's own worker; only the
 * text items cross to this thread. A page that fails to read, or has no text
 * (a scan), is kept as empty: nothing snaps, and the highlighter stays
 * freehand there.
 */

import { type App, type TFile, loadPdfJs } from "obsidian";
import { type PdfAssets, pdfAssets } from "./pdf-worker";
import {
  type Matrix,
  type PdfTextItem,
  type TextLayout,
  layoutText,
  pdfToPage,
} from "../canvas/pdf-text";
import {
  type LinkAnnotationLike,
  type PageLink,
  type PdfLink,
  linksOnPage,
  readLinks,
} from "../canvas/pdf-links";
import type { PageGeometry, PdfBackdrop } from "../model/document";

// The slice of pdf.js used here (`loadPdfJs()` is typed `Promise<any>`).
interface TextContentLike {
  items: ReadonlyArray<{
    str?: unknown;
    transform?: unknown;
    width?: unknown;
    height?: unknown;
    fontName?: unknown;
  }>;
  styles?: Record<string, { ascent?: unknown; descent?: unknown; vertical?: unknown } | undefined>;
}

interface PdfPageLike {
  getViewport(params: { scale: number }): { width: number; height: number; transform: number[] };
  getTextContent(): Promise<TextContentLike>;
  getAnnotations?: () => Promise<LinkAnnotationLike[]>;
  cleanup?: () => void;
}

interface PdfDocumentLike {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
  getDestination?: (name: string) => Promise<unknown>;
  getPageIndex?: (ref: unknown) => Promise<number>;
  destroy(): Promise<void>;
}

interface PdfJsLike {
  getDocument(src: { data: Uint8Array } & PdfAssets): { promise: Promise<PdfDocumentLike> };
}

/** A page's text as pdf.js gave it, before it is laid out on a page of some size. */
interface PageText {
  items: PdfTextItem[];
  /** Its links (a planner's tabs, web addresses), in PDF space. */
  links: PdfLink[];
  viewport: Matrix;
  source: { width: number; height: number };
}

/** Pages whose text is kept. A lecture deck is a few dozen; text is small. */
const MAX_PAGES = 200;

/**
 * How long a PDF that failed to open, or a page that failed to read, waits
 * before it is tried again, ms. A large PDF can fail to open on an iPad
 * short of memory; kept as failed, its highlighter never snapped again
 * until the notebook was reopened (#107).
 */
const RETRY_MS = 15_000;

const EMPTY: PageText = {
  items: [],
  links: [],
  viewport: [1, 0, 0, 1, 0, 0],
  source: { width: 1, height: 1 },
};

/** pdf.js's text items as {@link PdfTextItem}s, with their fonts' metrics. */
export function readTextItems(content: TextContentLike): PdfTextItem[] {
  const items: PdfTextItem[] = [];
  for (const raw of content.items) {
    const { str, transform, width, height } = raw;
    if (typeof str !== "string" || !Array.isArray(transform)) continue;
    if (typeof width !== "number" || typeof height !== "number") continue;
    const item: PdfTextItem = {
      str,
      transform: transform.map((n) => (typeof n === "number" ? n : Number.NaN)),
      width,
      height,
    };
    const style = typeof raw.fontName === "string" ? content.styles?.[raw.fontName] : undefined;
    if (typeof style?.ascent === "number") item.ascent = style.ascent;
    if (typeof style?.descent === "number") item.descent = style.descent;
    if (style?.vertical === true) item.vertical = true;
    items.push(item);
  }
  return items;
}

function pageKey(path: string, page: number): string {
  return `${path}:${page}`;
}

export class PdfTextCache {
  /** A page's text was read: whatever waits on it can look again. */
  onReady: ((path: string, page: number) => void) | null = null;

  private readonly pages = new Map<string, PageText>();
  /** Laid-out pages, by page and the geometry they were laid out on. */
  private readonly layouts = new Map<string, TextLayout>();
  private readonly inflight = new Set<string>();
  /** Callers of {@link layout} waiting on a page. */
  private readonly waiters = new Map<string, Array<() => void>>();
  private readonly deferred = new Map<string, PdfBackdrop>();
  private readonly documents = new Map<string, Promise<PdfDocumentLike | null>>();
  /** Per page key, or per path for a PDF that would not open: when it failed. */
  private readonly failed = new Map<string, number>();
  /** One page is read at a time, behind this. */
  private queue: Promise<void> = Promise.resolve();
  private held = false;
  private lib: Promise<PdfJsLike> | null = null;
  private destroyed = false;

  constructor(private readonly app: App) {}

  /**
   * The page's text laid out on a page of `geometry`, or null when it has
   * not been read yet. Never waits; an empty layout means it has no text.
   */
  peek(backdrop: PdfBackdrop, geometry: PageGeometry): TextLayout | null {
    const key = pageKey(backdrop.path, backdrop.page);
    const text = this.pages.get(key);
    if (!text) return null;
    const layoutKey = `${key}:${geometry.width}x${geometry.height}`;
    let layout = this.layouts.get(layoutKey);
    if (!layout) {
      layout = layoutText(text.items, pdfToPage(text.viewport, text.source, geometry));
      this.layouts.set(layoutKey, layout);
    }
    return layout;
  }

  /**
   * The page's links placed on a page of `geometry`, or null when the page
   * is not read yet (ask with {@link request}). Never waits.
   */
  peekLinks(backdrop: PdfBackdrop, geometry: PageGeometry): PageLink[] | null {
    const text = this.pages.get(pageKey(backdrop.path, backdrop.page));
    if (!text) return null;
    return text.links.length === 0
      ? []
      : linksOnPage(text.links, text.viewport, text.source, geometry);
  }

  /**
   * The page's text laid out on a page of `geometry`, read first if need
   * be: for search (#112), which may wait. Empty when it cannot be read.
   */
  async layout(backdrop: PdfBackdrop, geometry: PageGeometry): Promise<TextLayout> {
    const known = this.peek(backdrop, geometry);
    if (known) return known;
    const key = pageKey(backdrop.path, backdrop.page);
    await new Promise<void>((resolve) => {
      const list = this.waiters.get(key) ?? [];
      list.push(resolve);
      this.waiters.set(key, list);
      this.request(backdrop);
      // Destroyed, or nothing to read: nobody would answer.
      if (this.destroyed) this.wake(key);
    });
    return this.peek(backdrop, geometry) ?? { chars: [], lines: [] };
  }

  /** Read the page's text in the background, unless it is read or being read. */
  request(backdrop: PdfBackdrop): void {
    if (this.destroyed) return;
    const key = pageKey(backdrop.path, backdrop.page);
    if (this.pages.has(key) || this.inflight.has(key)) return;
    if (this.failedRecently(key) || this.failedRecently(backdrop.path)) return;
    if (this.held) {
      this.deferred.set(key, backdrop);
      return;
    }
    this.inflight.add(key);
    this.queue = this.queue.then(async () => {
      const text = await this.read(backdrop).catch(() => null);
      this.inflight.delete(key);
      if (this.destroyed) return;
      // A read that threw is tried again later, not kept as a page without text.
      if (!text) {
        this.failed.set(key, Date.now());
        return;
      }
      this.failed.delete(key);
      this.store(key, text);
      this.wake(key);
      this.onReady?.(backdrop.path, backdrop.page);
    });
  }

  /** While the pen writes nothing is read; letting go reads what was asked for meanwhile. */
  setHeld(held: boolean): void {
    if (this.held === held) return;
    this.held = held;
    if (held) return;
    const waiting = [...this.deferred.values()];
    this.deferred.clear();
    for (const backdrop of waiting) this.request(backdrop);
  }

  /** The file changed or went: read its text afresh next time. */
  forget(path: string): void {
    const prefix = `${path}:`;
    this.failed.delete(path);
    for (const key of [...this.failed.keys()]) if (key.startsWith(prefix)) this.failed.delete(key);
    for (const key of [...this.pages.keys()]) if (key.startsWith(prefix)) this.pages.delete(key);
    for (const key of [...this.layouts.keys()])
      if (key.startsWith(prefix)) this.layouts.delete(key);
    const doc = this.documents.get(path);
    this.documents.delete(path);
    void doc?.then((d) => d?.destroy()).catch(() => undefined);
  }

  destroy(): void {
    this.destroyed = true;
    this.deferred.clear();
    for (const doc of this.documents.values()) {
      void doc.then((d) => d?.destroy()).catch(() => undefined);
    }
    this.documents.clear();
    this.failed.clear();
    this.pages.clear();
    this.layouts.clear();
    this.onReady = null;
    for (const key of [...this.waiters.keys()]) this.wake(key);
  }

  private wake(key: string): void {
    const list = this.waiters.get(key);
    this.waiters.delete(key);
    for (const resolve of list ?? []) resolve();
  }

  private store(key: string, text: PageText): void {
    this.pages.set(key, text);
    while (this.pages.size > MAX_PAGES) {
      const oldest = this.pages.keys().next().value;
      if (oldest === undefined) break;
      this.pages.delete(oldest);
      for (const layoutKey of [...this.layouts.keys()]) {
        if (layoutKey.startsWith(`${oldest}:`)) this.layouts.delete(layoutKey);
      }
    }
  }

  /** True while `key` (a page, or a PDF's path) failed less than {@link RETRY_MS} ago. */
  private failedRecently(key: string): boolean {
    const at = this.failed.get(key);
    if (at === undefined) return false;
    if (Date.now() - at < RETRY_MS) return true;
    this.failed.delete(key);
    return false;
  }

  private async read(backdrop: PdfBackdrop): Promise<PageText | null> {
    const doc = await this.document(backdrop.path);
    // Not opened: tried again later (`failed` holds the path), not kept as empty.
    if (!doc) return null;
    const number = backdrop.page + 1;
    if (!Number.isInteger(number) || number < 1 || number > doc.numPages) return EMPTY;
    const page = await doc.getPage(number);
    try {
      const viewport = page.getViewport({ scale: 1 });
      const t = viewport.transform;
      if (t.length < 6 || !(viewport.width > 0) || !(viewport.height > 0)) return EMPTY;
      const content = await page.getTextContent();
      const links = await this.readPageLinks(doc, page).catch(() => [] as PdfLink[]);
      return {
        items: readTextItems(content),
        links,
        viewport: [t[0], t[1], t[2], t[3], t[4], t[5]],
        source: { width: viewport.width, height: viewport.height },
      };
    } finally {
      page.cleanup?.();
    }
  }

  /** A page's links, each destination resolved to a page of the same PDF. */
  private async readPageLinks(doc: PdfDocumentLike, page: PdfPageLike): Promise<PdfLink[]> {
    if (!page.getAnnotations) return [];
    const annotations = await page.getAnnotations();
    return readLinks(annotations, async (dest) => {
      let explicit: unknown = dest;
      if (typeof dest === "string") explicit = await doc.getDestination?.(dest);
      if (!Array.isArray(explicit) || explicit.length === 0) return null;
      const ref: unknown = explicit[0];
      // A destination names its page by reference, or (rarely) by index.
      if (typeof ref === "number") return ref;
      if (!doc.getPageIndex || typeof ref !== "object" || ref === null) return null;
      return doc.getPageIndex(ref);
    });
  }

  private document(path: string): Promise<PdfDocumentLike | null> {
    let doc = this.documents.get(path);
    if (!doc) {
      const opening = this.open(path).catch(() => null);
      doc = opening;
      this.documents.set(path, opening);
      // A PDF that would not open is forgotten, to be opened again after a while.
      void opening.then((opened) => {
        if (opened || this.documents.get(path) !== opening) return;
        this.documents.delete(path);
        this.failed.set(path, Date.now());
      });
    }
    return doc;
  }

  private async open(path: string): Promise<PdfDocumentLike | null> {
    const file: TFile | null = this.app.vault.getFileByPath(path);
    if (!file) return null;
    // Read-only, as everywhere: the source PDF is never written.
    const bytes = await this.app.vault.readBinary(file);
    this.lib ??= loadPdfJs().then((value: unknown) => value as PdfJsLike);
    const lib = await this.lib;
    // pdf.js may detach the buffer it is handed; nothing here reads the
    // bytes again, so they are handed over without a copy, which a large
    // PDF on an iPad has no memory to spare for (#107).
    return await lib.getDocument({ data: new Uint8Array(bytes), ...pdfAssets() }).promise;
  }
}
