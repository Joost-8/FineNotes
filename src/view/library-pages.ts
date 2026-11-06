/**
 * Pages of a notebook drawn small for Home: its real cover, the page the
 * reader left off on (the Continue card) and the page strip of the preview.
 *
 * Notebooks are decoded in Home's read worker (read-worker.ts), which hands
 * back only the pages asked for: a big notebook decoded on the main thread
 * held it for over a second on a slowed CPU. Only those pages are kept here,
 * for two notebooks at most, and let go after a quiet spell. Without a
 * worker (or once it fails) the main thread decodes instead, as before.
 *
 * A page is drawn with the same `renderPageThumbnail` the page sidebar uses;
 * a PDF page's raster comes from Home's PDF cache and is laid under the
 * page's own ink, as the PDF export does.
 */

import type { App, TFile } from "obsidian";
import { renderPageThumbnail } from "../canvas/renderer";
import { parseInkFile } from "../model/serialize";
import { readTextSection } from "../recognition/text-layer";
import { type IndexedPage, notebookText } from "../search/library-search";
import type { Page } from "../model/document";
import { type LibraryEntry, entryFromDoc, placeholderEntry } from "../model/library";
import { VaultBackdropRenderer } from "./backdrop-renderer";
import type { PdfBackdropCache } from "./pdf-backdrop";
import { thumbnailRasterScale } from "./page-sidebar";
import type { ReadResult, ReadWorkerClient } from "./read-worker-client";

/** How many notebooks' pages are kept at once. */
const KEPT = 2;
/** Kept pages are let go after this long without a picture drawn from them, ms. */
const RELEASE_MS = 20_000;
/** Pages fetched together: a page and the ones after it, as a preview's strip wants them. */
const BATCH = 12;

interface Kept {
  stamp: string;
  count: number;
  pages: Map<number, Page>;
}

export class NotebookPages {
  private readonly kept = new Map<string, Kept>();
  /** A fetch under way per notebook, so pages asked for together are fetched once. */
  private readonly fetching = new Map<string, Promise<void>>();
  private readonly painter = new VaultBackdropRenderer(null);
  /** PDFs opened for pictures since the last {@link releasePdfs}. */
  private readonly pdfsUsed = new Set<string>();
  private releaseTimer = 0;
  /** `undefined`: not started yet; `null`: none (no Worker, or it failed to start). */
  private worker: ReadWorkerClient | null | undefined;

  constructor(
    private readonly app: App,
    private readonly pdf: () => PdfBackdropCache,
  ) {}

  private async client(): Promise<ReadWorkerClient | null> {
    if (this.worker === undefined) {
      this.worker = null;
      if (typeof Worker !== "undefined") {
        try {
          this.worker = new (await import("./read-worker-client")).ReadWorkerClient();
        } catch {
          this.worker = null;
        }
      }
    }
    return this.worker && !this.worker.failed ? this.worker : null;
  }

  /** Pages `want` of `file` (and its Home facts with `facts`), in the worker if there is one. */
  private async read(
    file: TFile,
    want: number[],
    facts?: { path: string; edited: number },
    searchText = false,
  ): Promise<ReadResult> {
    const key = `${file.path}@${file.stat.mtime}:${file.stat.size}`;
    // Home's own read takes the file as it is on disk, as it always has; pictures may take Obsidian's copy.
    const text = (): Promise<string> =>
      facts ? this.app.vault.read(file) : this.app.vault.cachedRead(file);
    const client = await this.client();
    if (client) {
      try {
        return await client.read(key, text, want, facts, searchText);
      } catch {
        // The worker stopped: this read and every later one on the main thread.
      }
    }
    const parsed = parseInkFile(await text());
    const doc = parsed.doc;
    const pages = doc?.pages ?? [];
    return {
      count: pages.length,
      pages: new Map(want.flatMap((i) => (pages[i] ? [[i, pages[i]] as [number, Page]] : []))),
      ...(facts ? { entry: entryFromDoc(facts.path, facts.edited, doc) } : {}),
      ...(searchText ? { searchText: notebookText(pages, readTextSection(parsed.body)) } : {}),
    };
  }

  /**
   * Home's own read of a notebook: its facts, its cover page when it has
   * one, and its own text for Home's search (`null` when it could not be read).
   * Without `withCover` no page comes back: only the facts and the text.
   */
  async readEntry(
    file: TFile,
    edited: number,
    withCover = true,
  ): Promise<{ entry: LibraryEntry; cover: Page | null; text: IndexedPage[] | null }> {
    try {
      const result = await this.read(file, withCover ? [0] : [], { path: file.path, edited }, true);
      const entry = result.entry ?? placeholderEntry(file.path, edited);
      return {
        entry,
        cover: entry.covered ? (result.pages.get(0) ?? null) : null,
        text: result.searchText ?? null,
      };
    } catch {
      return { entry: placeholderEntry(file.path, edited), cover: null, text: null };
    }
  }

  /** Page `index` of `file`, fetched with the pages after it and kept a while. */
  private async page(file: TFile, index: number): Promise<Page | null> {
    this.releaseLater();
    const stamp = `${file.stat.mtime}:${file.stat.size}`;
    for (;;) {
      const kept = this.kept.get(file.path);
      if (kept?.stamp === stamp && (kept.pages.has(index) || index >= kept.count))
        return kept.pages.get(index) ?? null;
      const under = this.fetching.get(file.path);
      if (!under) break;
      await under;
    }
    const kept = this.kept.get(file.path);
    const have = kept?.stamp === stamp ? kept : null;
    const want: number[] = [];
    for (let i = index; i < index + BATCH; i++) if (!have?.pages.has(i)) want.push(i);
    const done = this.read(file, want).then((result) => {
      const into: Kept = have ?? { stamp, count: result.count, pages: new Map() };
      into.count = result.count;
      for (const [i, page] of result.pages) into.pages.set(i, page);
      this.kept.delete(file.path);
      this.kept.set(file.path, into);
      while (this.kept.size > KEPT) {
        const oldest = this.kept.keys().next().value;
        if (oldest === undefined) break;
        this.kept.delete(oldest);
      }
    });
    this.fetching.set(file.path, done);
    try {
      await done;
    } finally {
      this.fetching.delete(file.path);
    }
    return this.kept.get(file.path)?.pages.get(index) ?? null;
  }

  /** Let go of every kept page once nothing has been drawn from them for {@link RELEASE_MS}. */
  private releaseLater(): void {
    window.clearTimeout(this.releaseTimer);
    this.releaseTimer = window.setTimeout(() => this.kept.clear(), RELEASE_MS);
  }

  /** Let go of everything now (Home closed), the worker included. */
  dispose(): void {
    window.clearTimeout(this.releaseTimer);
    this.kept.clear();
    this.releasePdfs();
    this.worker?.stop();
    this.worker = null;
  }

  /** A page of a notebook already read (Home's own read of it), drawn `cssWidth` CSS px wide. */
  renderOf(page: Page, cssWidth: number): Promise<HTMLCanvasElement> {
    return this.renderPage(page, cssWidth);
  }

  /** Page `index` of `file` drawn `cssWidth` CSS px wide, or null when it has no such page. */
  async render(file: TFile, index: number, cssWidth: number): Promise<HTMLCanvasElement | null> {
    const page = await this.page(file, index);
    if (!page) return null;
    return this.renderPage(page, cssWidth);
  }

  /**
   * Close the PDFs drawn from since the last call, and drop their rasters:
   * the pictures are kept as JPEGs, so nothing of them is needed again.
   */
  releasePdfs(): void {
    for (const path of this.pdfsUsed) this.pdf().forget(path);
    this.pdfsUsed.clear();
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
    this.pdfsUsed.add(backdrop.path);
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
