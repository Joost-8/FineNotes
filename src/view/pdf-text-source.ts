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
 * text items cross to this thread. A page that fails to read is kept as
 * empty: nothing snaps, and the highlighter stays freehand there.
 *
 * A page with no text of its own, or hardly any (a scan, perhaps with a page
 * number on it), is read by OCR on this device when that is on
 * (`ocr-service.ts`): what was read before comes from the cache at once and
 * is merged with the page's own text (its own always wins); otherwise the
 * page is queued, stays as it is meanwhile, and is read again, with the OCR
 * text, when the service has read it (`ocrReady`).
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
import { type PageGeometry, type PdfBackdrop, pdfFrameOf } from "../model/document";
import { classifyPage } from "../recognition/ocr/figures";
import { wordsOfLayout } from "../recognition/ocr/ocr-text";
import { parseWordList } from "../recognition/hwr/corrections";
import { isSparse, mergedItems, nativeBoxes } from "../recognition/ocr/ocr-words";
import { type OperatorPageLike, readFigures } from "./pdf-figures";
import type { OcrOwner, OcrService } from "./ocr-service";

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
  getOperatorList?: OperatorPageLike["getOperatorList"];
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
  /** pdf.js's operator numbers, for finding the pictures on a page. */
  OPS?: Record<string, unknown>;
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
    // pdf.js reports NaN for the ascent of a font it has no metrics for.
    if (typeof style?.ascent === "number" && Number.isFinite(style.ascent)) {
      item.ascent = style.ascent;
    }
    if (typeof style?.descent === "number" && Number.isFinite(style.descent)) {
      item.descent = style.descent;
    }
    if (style?.vertical === true) item.vertical = true;
    items.push(item);
  }
  return items;
}

/** The English word list bundled with the plugin, or null when it cannot be read (no corrections then). */
async function bundledLexicon(): Promise<ReadonlySet<string> | null> {
  try {
    const { default: text } = await import("../../models/words.txt");
    const words = parseWordList(text);
    // Not the list itself (a build that hands back a path): too small to say what is a word.
    return words.size > 1000 ? words : null;
  } catch {
    return null;
  }
}

/** A PDF's own words, as far as they are read. */
interface Vocabulary {
  words: Set<string>;
  complete: boolean;
  cancelled: boolean;
}

function pageKey(path: string, page: number): string {
  return `${path}:${page}`;
}

export class PdfTextCache implements OcrOwner {
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
  /** Pages queued for OCR, by key: the backdrop to read again when they were read. */
  private readonly scanned = new Map<string, PdfBackdrop>();
  /** Pages whose OCR text arrived while they were being read: read again afterwards. */
  private readonly again = new Set<string>();

  /**
   * Each PDF's own words (four letters or more, lower case), from the text of
   * all its pages, read in the background. Corrections wait for it to be
   * complete, so what a page reads as never depends on which page was read first.
   */
  private readonly vocabularies = new Map<string, Vocabulary>();
  /** Vocabulary builders waiting for the pen to lift. */
  private readonly unheld: Array<() => void> = [];
  private lexicon: Promise<ReadonlySet<string> | null> | null = null;

  constructor(
    private readonly app: App,
    private readonly ocr: OcrService | null = null,
    /** The English word list a corrected word must not be in. */
    private readonly words: () => Promise<ReadonlySet<string> | null> = bundledLexicon,
  ) {}

  /**
   * The page's text laid out on a page of `geometry`, or null when it has
   * not been read yet. Never waits; an empty layout means it has no text.
   */
  peek(backdrop: PdfBackdrop, geometry: PageGeometry): TextLayout | null {
    const key = pageKey(backdrop.path, backdrop.page);
    const text = this.pages.get(key);
    if (!text) return null;
    // Where the PDF sits on the page: the whole page, or its frame on a widened one.
    const frame = pdfFrameOf(backdrop, geometry);
    const layoutKey = `${key}:${geometry.width}x${geometry.height}:${frame.x},${frame.y},${frame.width}x${frame.height}`;
    let layout = this.layouts.get(layoutKey);
    if (!layout) {
      layout = layoutText(text.items, pdfToPage(text.viewport, text.source, frame));
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
      : linksOnPage(text.links, text.viewport, text.source, pdfFrameOf(backdrop, geometry));
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
      // Destroyed, or nothing to read (it failed a moment ago and waits to
      // be tried again): nobody would answer.
      if (this.destroyed || (!this.inflight.has(key) && !this.deferred.has(key))) this.wake(key);
    });
    return this.peek(backdrop, geometry) ?? { chars: [], lines: [] };
  }

  /**
   * Read the page's text in the background, unless it is read or being read
   * (`force`: read it again, keeping what is known until the new text lands).
   */
  request(backdrop: PdfBackdrop, force = false): void {
    if (this.destroyed) return;
    const key = pageKey(backdrop.path, backdrop.page);
    if (this.inflight.has(key)) {
      if (force) this.again.add(key);
      return;
    }
    if (this.pages.has(key) && !force) return;
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
      // A read that threw is tried again later, not kept as a page without
      // text; a search waiting on it gets no text this time.
      if (!text) {
        this.failed.set(key, Date.now());
        this.wake(key);
        return;
      }
      this.failed.delete(key);
      this.store(key, text);
      this.wake(key);
      this.onReady?.(backdrop.path, backdrop.page);
      if (this.again.delete(key)) this.request(backdrop, true);
    });
  }

  /**
   * The notebook is on this page: its text, and its neighbours' (`near`),
   * are read now, so a scanned page is queued for OCR in the right order.
   */
  focus(backdrop: PdfBackdrop, near: readonly PdfBackdrop[] = []): void {
    if (this.destroyed) return;
    this.ocr?.focus(backdrop.path, backdrop.page);
    for (const b of [backdrop, ...near]) this.request(b);
  }

  /**
   * A setting that decides what OCR reads changed: every page of which the
   * text is kept is read again, so it is classified, queued or shown under
   * the new setting (what OCR read earlier stays in the cache).
   */
  ocrSettingsChanged(): void {
    if (this.destroyed) return;
    for (const key of [...this.pages.keys()]) {
      const at = key.lastIndexOf(":");
      const page = Number(key.slice(at + 1));
      if (Number.isInteger(page)) this.request({ kind: "pdf", path: key.slice(0, at), page }, true);
    }
  }

  /** OCR read a page this cache queued: read its text again, with it. */
  ocrReady(path: string, page: number): void {
    const key = pageKey(path, page);
    const backdrop = this.scanned.get(key);
    if (backdrop) this.request(backdrop, true);
  }

  /** The OCR service asks about a page it was not told of: read it, so a scan is found. */
  async ocrProbe(path: string, page: number): Promise<void> {
    if (this.destroyed || this.pages.has(pageKey(path, page))) return;
    const text = await this.read({ kind: "pdf", path, page }).catch(() => null);
    if (text && !this.destroyed) this.store(pageKey(path, page), text);
  }

  /** While the pen writes nothing is read; letting go reads what was asked for meanwhile. */
  setHeld(held: boolean): void {
    this.ocr?.hold(this, held);
    if (this.held === held) return;
    this.held = held;
    if (held) return;
    for (const wake of this.unheld.splice(0)) wake();
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
    this.dropVocabulary(path);
    for (const key of [...this.layouts.keys()])
      if (key.startsWith(prefix)) this.layouts.delete(key);
    for (const key of [...this.scanned.keys()])
      if (key.startsWith(prefix)) this.scanned.delete(key);
    const doc = this.documents.get(path);
    this.documents.delete(path);
    void doc?.then((d) => d?.destroy()).catch(() => undefined);
  }

  destroy(): void {
    this.destroyed = true;
    this.ocr?.release(this);
    this.scanned.clear();
    this.again.clear();
    this.deferred.clear();
    for (const doc of this.documents.values()) {
      void doc.then((d) => d?.destroy()).catch(() => undefined);
    }
    this.documents.clear();
    this.failed.clear();
    this.pages.clear();
    this.layouts.clear();
    for (const path of [...this.vocabularies.keys()]) this.dropVocabulary(path);
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
    // A page read again (with OCR text) is laid out afresh.
    for (const layoutKey of [...this.layouts.keys()]) {
      if (layoutKey.startsWith(`${key}:`)) this.layouts.delete(layoutKey);
    }
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
      const matrix: Matrix = [t[0], t[1], t[2], t[3], t[4], t[5]];
      const source = { width: viewport.width, height: viewport.height };
      const native = readTextItems(content);
      return {
        items: await this.withOcr(backdrop, doc.numPages, native, matrix, source, page),
        links,
        viewport: matrix,
        source,
      };
    } finally {
      page.cleanup?.();
    }
  }

  /**
   * The page's own text items, plus the OCR text where the page has too
   * little of its own, or pictures to read: from the cache at once, or
   * queued (the page then reads as it does without, until `ocrReady`).
   * Never waits for OCR.
   *
   * What the page is (recognition/ocr/figures.ts) comes from the cache if
   * it was looked at before, else from its text and the pictures its
   * drawing operators place on it: a page with text of its own and no
   * picture worth reading (`TEXT_ONLY`) is recorded as that and costs
   * nothing on the next opening.
   */
  private async withOcr(
    backdrop: PdfBackdrop,
    pages: number,
    native: PdfTextItem[],
    viewport: Matrix,
    source: { width: number; height: number },
    page: PdfPageLike,
  ): Promise<PdfTextItem[]> {
    const ocr = this.ocr;
    if (!ocr?.enabled) return native;
    const figures = ocr.figures === true;
    const sparse = isSparse(
      layoutText(native, pdfToPage(viewport, source, source)),
      source.width,
      source.height,
    );
    // Pictures are not looked at (the setting is off): only sparse pages are read, as before.
    if (!sparse && !figures) {
      ocr.settled(backdrop.path, backdrop.page);
      return native;
    }
    const key = pageKey(backdrop.path, backdrop.page);
    ocr.attach(this, backdrop.path);
    const found = await ocr.cached(backdrop.path, backdrop.page);
    if (found) {
      ocr.settled(backdrop.path, backdrop.page);
      if (found.condition !== "TEXT_ONLY" && found.condition !== "BLANK") {
        this.scanned.set(key, { kind: "pdf", path: backdrop.path, page: backdrop.page });
      }
      const dictionary =
        found.condition === "TEXT_ONLY" || found.condition === "BLANK"
          ? undefined
          : await this.dictionary(backdrop.path);
      return mergedItems(native, found, viewport, source, ocr.tuning(), figures, dictionary);
    }
    const operators = figures ? page.getOperatorList?.bind(page) : undefined;
    const scan = operators
      ? await readFigures({ getOperatorList: operators }, await this.operators(), viewport, source)
      : null;
    const plan = classifyPage(sparse, scan, source);
    if (plan.condition === "TEXT_ONLY") {
      ocr.settled(backdrop.path, backdrop.page);
      // Only a page whose pictures were looked at is known to need nothing.
      if (plan.known) void ocr.recordTextOnly(backdrop.path, backdrop.page, source);
      return native;
    }
    this.scanned.set(key, { kind: "pdf", path: backdrop.path, page: backdrop.page });
    ocr.want(this, backdrop.path, backdrop.page, pages, {
      items: native.length,
      rects: nativeBoxes(native, viewport, source),
      plan,
    });
    return native;
  }

  /**
   * The PDF's words and the English list, for correcting what OCR misread;
   * undefined until the whole PDF's vocabulary has been read (the words then
   * show as read, and the pages are merged again when it is complete), and
   * without the list.
   */
  private async dictionary(path: string) {
    this.lexicon ??= this.words().catch(() => null);
    const lexicon = await this.lexicon;
    if (!lexicon) return undefined;
    let vocabulary = this.vocabularies.get(path);
    if (!vocabulary) {
      vocabulary = { words: new Set(), complete: false, cancelled: false };
      this.vocabularies.set(path, vocabulary);
      void this.buildVocabulary(path, vocabulary);
    }
    return vocabulary.complete ? { vocabulary: vocabulary.words, lexicon } : undefined;
  }

  /** The vocabulary of `path` is let go (the file changed, or the cache is closing): its build stops. */
  private dropVocabulary(path: string): void {
    const vocabulary = this.vocabularies.get(path);
    if (vocabulary) vocabulary.cancelled = true;
    this.vocabularies.delete(path);
    for (const wake of this.unheld.splice(0)) wake();
  }

  /** Resolves when the pen is up, or `stop` says so (at once if it is up). */
  private async penUp(stop: () => boolean): Promise<void> {
    while (this.held && !stop()) await new Promise<void>((resolve) => this.unheld.push(resolve));
  }

  /**
   * Read the own text of every page of `path`, one page at a time and only
   * while the pen is up (text only: no raster, no model), into `vocabulary`.
   * When it is complete the pages that carry OCR words are read again, so
   * they take its corrections.
   */
  private async buildVocabulary(path: string, vocabulary: Vocabulary): Promise<void> {
    const stop = (): boolean => vocabulary.cancelled || this.destroyed;
    try {
      const doc = await this.document(path);
      if (!doc) throw new Error("not opened");
      for (let n = 1; n <= doc.numPages; n++) {
        await this.penUp(stop);
        if (stop()) return;
        const page = await doc.getPage(n);
        try {
          const viewport = page.getViewport({ scale: 1 });
          const t = viewport.transform;
          if (t.length >= 6 && viewport.width > 0 && viewport.height > 0) {
            const matrix: Matrix = [t[0], t[1], t[2], t[3], t[4], t[5]];
            const source = { width: viewport.width, height: viewport.height };
            const items = readTextItems(await page.getTextContent());
            const layout = layoutText(items, pdfToPage(matrix, source, source));
            for (const word of wordsOfLayout(layout)) vocabulary.words.add(word);
          }
        } finally {
          page.cleanup?.();
        }
        // The next page after the pen and the queue had a turn.
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        if (stop()) return;
      }
      vocabulary.complete = true;
      for (const key of [...this.scanned.keys()]) {
        if (key.startsWith(`${path}:`)) this.ocrReady(path, Number(key.slice(path.length + 1)));
      }
    } catch {
      // Tried again the next time a page needs it, after a while: its words show as read meanwhile.
      if (this.vocabularies.get(path) === vocabulary) {
        window.setTimeout(() => {
          if (this.vocabularies.get(path) === vocabulary) this.vocabularies.delete(path);
        }, RETRY_MS);
      }
    }
  }

  /** pdf.js's operator numbers. */
  private async operators(): Promise<Record<string, unknown> | undefined> {
    return (await this.lib)?.OPS;
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
