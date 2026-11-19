/**
 * The text of PDF pages read through the PDF worker (`pdf-worker.ts`), from
 * the document it already holds to draw the pages, instead of a second copy
 * of the whole PDF opened by this thread's pdf.js. For a 157 MB textbook
 * that second copy cost 190 MB for as long as the notebook was open.
 *
 * {@link shapePageText} and {@link keptOperators} run inside the worker:
 * their source is copied into the worker's script, so they use nothing from
 * outside themselves (no imports, no helpers, no newer syntax than ES2020).
 * {@link workerTextDocument} is what `PdfTextCache` reads from here: the
 * slice of a pdf.js document it uses, answered by the worker.
 */

/** A page's size, text and links, as plain data that crosses to this thread. */
export interface WorkerPageText {
  /** The page at scale 1: its size in PDF points and pdf.js's viewport transform. */
  width: number;
  height: number;
  transform: number[];
  /** pdf.js's text items, only the fields read here (`readTextItems`). */
  items: Array<{
    str: string;
    transform?: unknown;
    width?: unknown;
    height?: unknown;
    fontName?: unknown;
  }>;
  styles: Record<string, { ascent?: unknown; descent?: unknown; vertical?: unknown }>;
  /** Only the links (`readLinks`), with only what is read of them. */
  annotations: Array<{
    subtype?: unknown;
    rect?: unknown;
    url?: unknown;
    unsafeUrl?: unknown;
    dest?: unknown;
  }>;
}

interface ContentLike {
  items: ArrayLike<Record<string, unknown>>;
  styles?: Record<string, Record<string, unknown> | undefined>;
}

/**
 * What the worker sends of a page: pdf.js's viewport, text content and
 * annotations cut down to plain data (a font's metrics object or a form
 * field would not survive the crossing, and are not read).
 */
export function shapePageText(
  viewport: { width: number; height: number; transform: ArrayLike<number> },
  content: ContentLike,
  annotations: ArrayLike<Record<string, unknown>> | null | undefined,
): WorkerPageText {
  const items: WorkerPageText["items"] = [];
  for (let i = 0; i < content.items.length; i++) {
    const item = content.items[i];
    if (!item || typeof item.str !== "string") continue;
    items.push({
      str: item.str,
      transform: item.transform,
      width: item.width,
      height: item.height,
      fontName: item.fontName,
    });
  }
  const styles: WorkerPageText["styles"] = {};
  const given = content.styles || {};
  for (const name of Object.keys(given)) {
    const style = given[name] || {};
    styles[name] = { ascent: style.ascent, descent: style.descent, vertical: style.vertical };
  }
  const links: WorkerPageText["annotations"] = [];
  const all = annotations || [];
  for (let i = 0; i < all.length; i++) {
    const a = all[i];
    if (!a || a.subtype !== "Link") continue;
    links.push({
      subtype: a.subtype,
      rect: a.rect,
      url: a.url,
      unsafeUrl: a.unsafeUrl,
      dest: a.dest,
    });
  }
  return {
    width: viewport.width,
    height: viewport.height,
    transform: Array.from(viewport.transform),
    items,
    styles,
    annotations: links,
  };
}

/**
 * A page's operator list with only the operators in `keep` (the ones figure
 * finding reads, `pdf-figures.ts`): the rest, every path a plot draws, need
 * not be copied across.
 */
export function keptOperators(
  list: { fnArray: ArrayLike<number>; argsArray: ArrayLike<unknown> },
  keep: readonly number[],
): { fnArray: number[]; argsArray: unknown[] } {
  const fnArray: number[] = [];
  const argsArray: unknown[] = [];
  for (let i = 0; i < list.fnArray.length; i++) {
    const fn = list.fnArray[i];
    if (keep.indexOf(fn) === -1) continue;
    fnArray.push(fn);
    argsArray.push(list.argsArray[i]);
  }
  return { fnArray, argsArray };
}

/** What {@link workerTextDocument} asks of the worker (`PdfWorker`). */
export interface TextWorker {
  readonly alive: boolean;
  /** One more use of `path` if it is open there already: its page count, else `null`. */
  share(path: string): Promise<number | null>;
  /** Open `bytes` (handed over) as `path` there: its page count. */
  open(path: string, bytes: ArrayBuffer): Promise<number>;
  /** `page` is 0-based. */
  pageText(path: string, page: number): Promise<WorkerPageText>;
  operators(
    path: string,
    page: number,
    keep: readonly number[],
  ): Promise<{ fnArray: number[]; argsArray: unknown[] }>;
  destination(path: string, name: string): Promise<unknown>;
  pageIndex(path: string, ref: unknown): Promise<number>;
  close(path: string): void;
}

/**
 * `path`, opened in `worker` with `numPages` pages, as the slice of a pdf.js
 * document `PdfTextCache` reads: pages are 1-based there, as in pdf.js.
 * `keep` are the operators figure finding reads. Destroying it lets go of
 * this use of the worker's document.
 */
export function workerTextDocument(
  worker: TextWorker,
  path: string,
  numPages: number,
  keep: readonly number[],
) {
  let closed = false;
  return {
    numPages,
    async getPage(pageNumber: number) {
      const page = pageNumber - 1;
      const text = await worker.pageText(path, page);
      return {
        getViewport: ({ scale }: { scale: number }) => ({
          width: text.width * scale,
          height: text.height * scale,
          transform: text.transform.map((n) => n * scale),
        }),
        getTextContent: () => Promise.resolve({ items: text.items, styles: text.styles }),
        getAnnotations: () => Promise.resolve(text.annotations),
        getOperatorList: () => worker.operators(path, page, keep),
        cleanup: () => undefined,
      };
    },
    getDestination: (name: string) => worker.destination(path, name),
    getPageIndex: (ref: unknown) => worker.pageIndex(path, ref),
    destroy(): Promise<void> {
      if (!closed) {
        closed = true;
        worker.close(path);
      }
      return Promise.resolve();
    },
  };
}
