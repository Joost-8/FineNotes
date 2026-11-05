/**
 * The preview picture on each note card of the Folders library. Pictures show
 * as themselves, PDFs as their first page, notebooks as their first page
 * drawn small (kept on disk), and a Markdown note as its first picture or
 * else its opening lines rendered. A card is painted only when it scrolls
 * near the screen. Anything that cannot be previewed gets a file-type tile.
 */

import { type App, Component, MarkdownRenderer, type TFile, setIcon } from "obsidian";
import { THUMBNAIL_IMAGE_EXTENSIONS, linkTarget } from "../../model/folder-thumbnail";
import { t } from "../../i18n/translate";
import { isNotebookFile } from "./files";
import { renderNotebookThumbnail } from "./ink-thumbnail";
import { loadPdf } from "./pdfjs";
import { ThumbnailDiskCache } from "./thumbnail-disk-cache";

/** Bump to forget every thumbnail drawn so far. */
const CACHE_VERSION = 2;
/** How many characters of a note are rendered for its preview. */
const MARKDOWN_PREVIEW_CHARACTERS = 1500;
/** The width a rendered note is laid out at before it is scaled to the card, px. */
const MARKDOWN_PREVIEW_WIDTH = 400;
/** The width a PDF's first page is drawn at, px (times the screen's pixel ratio). */
const PDF_PREVIEW_WIDTH = 240;
/** How many previews are drawn at once. */
const HEAVY_AT_ONCE = 2;
/** A card is painted this far before it scrolls into view. */
const ROOT_MARGIN = "200px 0px";

type ThumbnailEntry =
  { kind: "src"; src: string } | { kind: "nodes"; rendered: HTMLElement } | { kind: "placeholder" };

export class Thumbnails {
  private readonly failed = new Set<string>();
  private readonly cache = new Map<string, ThumbnailEntry>();
  private targets = new Map<Element, TFile>();
  private observer: IntersectionObserver | null = null;
  private renderer: Component | null = null;
  private heavyActive = 0;
  private readonly heavyWaiting: (() => void)[] = [];
  private readonly disk: ThumbnailDiskCache;

  /**
   * @param owner the view the previews belong to: the renderer's component
   *   is a child of it, so everything is released with it.
   * @param pluginDir this plugin's own folder (`manifest.dir`).
   */
  constructor(
    private readonly app: App,
    private readonly owner: Component,
    pluginDir: string,
  ) {
    this.disk = new ThumbnailDiskCache(app, pluginDir);
    this.reset();
  }

  /** Forget the cards on screen (the library is being drawn again); the pictures stay cached. */
  reset(): void {
    this.observer?.disconnect();
    this.targets = new Map();
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const slot = entry.target;
          const file = this.targets.get(slot);
          this.observer?.unobserve(slot);
          if (file) void this.paint(slot as HTMLElement, file);
        }
      },
      { rootMargin: ROOT_MARGIN },
    );
    if (this.renderer) this.owner.removeChild(this.renderer);
    this.renderer = new Component();
    this.owner.addChild(this.renderer);
  }

  dispose(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.targets = new Map();
    if (this.renderer) {
      this.owner.removeChild(this.renderer);
      this.renderer = null;
    }
    this.cache.clear();
    this.failed.clear();
  }

  /** Paint `file`'s preview into `slot` once it is near the screen. */
  observe(slot: HTMLElement, file: TFile): void {
    this.targets.set(slot, file);
    this.observer?.observe(slot);
  }

  private async paint(slot: HTMLElement, file: TFile): Promise<void> {
    const entry = await this.resolve(file);
    if (slot.isConnected) this.paintEntry(slot, entry, file);
  }

  private async resolve(file: TFile): Promise<ThumbnailEntry> {
    const extension = file.extension.toLowerCase();
    const key = `${CACHE_VERSION}:${file.path}:${file.stat.mtime}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    if (this.failed.has(key)) return { kind: "placeholder" };
    let entry: ThumbnailEntry;
    try {
      if (THUMBNAIL_IMAGE_EXTENSIONS.has(extension)) {
        entry = { kind: "src", src: this.app.vault.getResourcePath(file) };
      } else if (extension === "pdf") {
        const url = await this.renderPdf(file);
        entry = url ? { kind: "src", src: url } : { kind: "placeholder" };
      } else if (isNotebookFile(this.app, file)) {
        const drawn = await this.renderNotebook(file, key);
        if (!drawn) this.failed.add(key);
        // A notebook whose pictures or PDF could not all be drawn is shown, but not kept.
        if (drawn && !drawn.complete) return { kind: "src", src: drawn.url };
        entry = drawn ? { kind: "src", src: drawn.url } : { kind: "placeholder" };
      } else if (extension === "md") {
        entry = await this.buildMarkdownEntry(file);
      } else {
        entry = { kind: "placeholder" };
      }
    } catch (error) {
      console.warn(`FineNotes: thumbnail failed for ${file.path}`, error);
      return { kind: "placeholder" };
    }
    if (entry.kind !== "placeholder") {
      this.pruneCache(file.path);
      this.cache.set(key, entry);
    }
    return entry;
  }

  private async renderNotebook(
    file: TFile,
    key: string,
  ): Promise<{ url: string; complete: boolean } | null> {
    const saved = await this.disk.read(key);
    if (saved) return { url: saved, complete: true };
    const drawn = await this.limitHeavy(() => renderNotebookThumbnail(this.app, file, loadPdf));
    if (drawn?.complete) void this.disk.write(key, drawn.url);
    return drawn;
  }

  /** Forget the cached previews of older versions of `path`. */
  private pruneCache(path: string): void {
    const prefix = `${CACHE_VERSION}:${path}:`;
    for (const key of Array.from(this.cache.keys())) {
      if (key.startsWith(prefix)) this.cache.delete(key);
    }
  }

  private async buildMarkdownEntry(file: TFile): Promise<ThumbnailEntry> {
    const embed = this.app.metadataCache.getFileCache(file)?.embeds?.[0];
    if (embed) {
      const target = this.app.metadataCache.getFirstLinkpathDest(linkTarget(embed.link), file.path);
      if (target) {
        const extension = target.extension.toLowerCase();
        if (THUMBNAIL_IMAGE_EXTENSIONS.has(extension)) {
          return { kind: "src", src: this.app.vault.getResourcePath(target) };
        }
        if (extension === "pdf") {
          const url = await this.renderPdf(target);
          if (url) return { kind: "src", src: url };
        }
      }
    }
    const text = (await this.app.vault.cachedRead(file)).slice(0, MARKDOWN_PREVIEW_CHARACTERS);
    const rendered = createDiv();
    await this.limitHeavy(() =>
      MarkdownRenderer.render(this.app, text, rendered, file.path, this.renderer ?? this.owner),
    );
    return { kind: "nodes", rendered };
  }

  private renderPdf(file: TFile): Promise<string | null> {
    return this.limitHeavy(async () => {
      const lib = await loadPdf();
      const data = await this.app.vault.readBinary(file);
      const document = await lib.getDocument({ data }).promise;
      try {
        const page = await document.getPage(1);
        const natural = page.getViewport({ scale: 1 });
        const ratio = activeWindow.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale: (PDF_PREVIEW_WIDTH * ratio) / natural.width });
        const canvas = createEl("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        await page.render({ canvasContext: ctx, viewport, canvas }).promise;
        return canvas.toDataURL("image/jpeg", 0.9);
      } finally {
        await document.destroy();
      }
    });
  }

  /** Run `work` with at most two heavy previews drawing at once. */
  private async limitHeavy<T>(work: () => Promise<T>): Promise<T> {
    if (this.heavyActive < HEAVY_AT_ONCE) this.heavyActive++;
    else await new Promise<void>((resolve) => this.heavyWaiting.push(resolve));
    try {
      return await work();
    } finally {
      const next = this.heavyWaiting.shift();
      if (next) next();
      else this.heavyActive--;
    }
  }

  private paintEntry(slot: HTMLElement, entry: ThumbnailEntry, file: TFile): void {
    slot.empty();
    switch (entry.kind) {
      case "src": {
        const image = slot.createEl("img", {
          cls: "fl-thumb-img",
          attr: {
            src: entry.src,
            alt: t("view.folders.previewAlt", { name: file.basename }),
            draggable: "false",
          },
        });
        image.addEventListener("error", () => {
          image.remove();
          this.paintPlaceholder(slot, file);
        });
        return;
      }
      case "nodes": {
        const wrap = slot.createDiv({ cls: "fl-md-thumb markdown-rendered" });
        for (const node of Array.from(entry.rendered.childNodes)) {
          wrap.appendChild(node.cloneNode(true));
        }
        const width = slot.clientWidth || MARKDOWN_PREVIEW_WIDTH / 2;
        wrap.setCssProps({ transform: `scale(${width / MARKDOWN_PREVIEW_WIDTH})` });
        return;
      }
      case "placeholder":
        this.paintPlaceholder(slot, file);
        return;
    }
  }

  private paintPlaceholder(slot: HTMLElement, file: TFile): void {
    const tile = slot.createDiv({ cls: "fl-thumb-placeholder" });
    tile.createSpan({ cls: "fl-thumb-ext", text: (file.extension || "?").toUpperCase() });
    const icon = tile.createSpan({ cls: "fl-thumb-file-icon", attr: { "aria-hidden": "true" } });
    setIcon(icon, "file");
  }
}
