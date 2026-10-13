/**
 * Page embeds: `![[Physics.notebook#page=3]]` (or `#Page 3`, `#p3`) in an
 * ordinary note shows that page of the notebook, read-only, at the note's
 * width; a click opens the notebook there. Paginated notebooks can do this
 * where an infinite canvas cannot: a page has a fixed shape of its own.
 *
 * The hook. Obsidian builds every `![[…]]` embed, in reading view, live
 * preview, hover previews and canvas cards alike, through one loader that
 * asks its embed registry for the creator registered for the target file's
 * extension (`app.embedRegistry`, read from Obsidian's own `app.js`; core
 * Canvas and Bases register their file types there the same way). A
 * notebook is a `.md` file, so its embeds reach the Markdown creator, which
 * would show the note's text and fail to find a section named "page=3".
 * The plugin puts a creator in front of that one: it takes notebook files
 * whose subpath names a page, or that have none (`![[Physics.notebook]]`
 * shows page 1), and hands everything else, headings included, to the
 * original, untouched. The registry is not public API, so the hook checks its shape
 * first and stands aside when it is not there; Obsidian then shows the
 * Markdown embed it always did.
 *
 * Painting goes through `paintPagePreview`, the export dialog's one-shot
 * page renderer (paper or PDF slide, pictures, text boxes, ink), into one
 * canvas per embed, only once the embed is on screen, one at a time. All
 * embeds share one decoded copy of each notebook, one PDF raster cache and
 * one picture cache, and the canvases of embeds off screen are given back
 * past a byte budget, so a note that embeds many pages stays cheap.
 */

import { type App, Component, Keymap, type TAbstractFile, TFile } from "obsidian";
import { paperTheme } from "../canvas/backdrop";
import { DEFAULT_PAGE_GEOMETRY, type Page } from "../model/document";
import { pageSignature } from "../model/page-signature";
import { parseInkFile } from "../model/serialize";
import { VaultImageCache } from "./image-cache";
import { releaseCanvas } from "./image-import";
import {
  EMBED_CANVAS_BUDGET,
  SharedNotebooks,
  embedPaintSize,
  embedWidth,
  type EmbedTarget,
  embedLabel,
  embedTarget,
  embedsToRelease,
} from "./page-embed-model";
import { PdfBackdropCache } from "./pdf-backdrop";
import { type PdfExportSources, paintPagePreview } from "./pdf-export";
import { acquirePdfWorker, releasePdfWorker } from "./pdf-worker";

/** What Obsidian's embed loader hands a creator (the part read here). */
export interface EmbedContext {
  app: App;
  containerEl: HTMLElement;
  /** The link as written, subpath included: `Physics.notebook#page=3`. */
  linktext: string;
  sourcePath: string;
}

/** A creator in Obsidian's embed registry; what it returns must have `loadFile()`. */
export type EmbedCreator = (
  ctx: EmbedContext,
  file: TFile,
  subpath: string,
) => (Component & { loadFile(): unknown }) | null;

/** The part of Obsidian's private embed registry the hook uses. */
interface EmbedRegistry {
  embedByExtension: Record<string, EmbedCreator | undefined>;
  registerExtension(extension: string, creator: EmbedCreator): void;
  unregisterExtension(extension: string): void;
}

/** The registry, when it has the shape this hook was written against. */
function embedRegistryOf(app: App): EmbedRegistry | null {
  const registry = (app as unknown as { embedRegistry?: Partial<EmbedRegistry> }).embedRegistry;
  if (
    !registry ||
    typeof registry.registerExtension !== "function" ||
    typeof registry.unregisterExtension !== "function" ||
    typeof registry.embedByExtension !== "object" ||
    registry.embedByExtension === null
  ) {
    return null;
  }
  return registry as EmbedRegistry;
}

/** What page embeds need from the plugin. */
export interface PageEmbedHost {
  app: App;
  isInkFile(file: TFile): boolean;
  paperWidth(): number;
  usePressure(): boolean;
  highlighterAlpha(): number;
}

/** Quiet time after a notebook is saved before its embeds repaint. */
const CHANGE_DEBOUNCE_MS = 300;
/** How long the next embed waits for a slow one to finish painting. */
const SLOW_PAINT_MS = 1500;

/**
 * Every page embed the plugin draws, and what they share. A child of the
 * plugin: the hook comes off with it.
 */
export class PageEmbeds extends Component {
  /** Each notebook's pages; none for a file without an ink block, `null` for one that would not decode. */
  private readonly notebooks = new SharedNotebooks<readonly Page[] | null>(3);
  private readonly live = new Set<NotebookPageEmbed>();
  /** The embeds by the element the observers report. */
  private readonly byElement = new Map<Element, NotebookPageEmbed>();
  private readonly queue = new Set<NotebookPageEmbed>();
  private pumping = false;
  private intersections: IntersectionObserver | null = null;
  private resizes: ResizeObserver | null = null;
  private pdf: PdfBackdropCache | null = null;
  private images: VaultImageCache | null = null;
  private workerHeld = false;
  private readonly changeTimers = new Map<string, number>();
  private active = false;

  constructor(private readonly host: PageEmbedHost) {
    super();
  }

  override onload(): void {
    this.active = true;
    this.register(this.installHook());
    const { vault } = this.host.app;
    this.registerEvent(vault.on("modify", (file) => this.fileChanged(file)));
    this.registerEvent(vault.on("create", (file) => this.fileChanged(file)));
    this.registerEvent(vault.on("delete", (file) => this.fileDeleted(file)));
    this.registerEvent(
      vault.on("rename", (file, oldPath) => {
        this.notebooks.forget(oldPath);
        this.sourceChanged(oldPath);
        this.fileChanged(file);
      }),
    );
  }

  override onunload(): void {
    this.active = false;
    for (const timer of this.changeTimers.values()) window.clearTimeout(timer);
    this.changeTimers.clear();
    this.intersections?.disconnect();
    this.intersections = null;
    this.resizes?.disconnect();
    this.resizes = null;
    this.queue.clear();
    // Embeds already on screen keep their picture; they stop following the file.
    this.live.clear();
    this.byElement.clear();
    this.notebooks.clear();
    this.pdf?.destroy();
    this.pdf = null;
    this.images?.destroy();
    this.images = null;
    if (this.workerHeld) {
      this.workerHeld = false;
      releasePdfWorker();
    }
  }

  /**
   * Put the notebook-page creator in front of Obsidian's Markdown one.
   * Returns what takes it off again. When another plugin has since put its
   * own creator in front of this one, taking this one out would drop theirs
   * too, so it only stands aside: it hands every embed straight on.
   */
  private installHook(): () => void {
    const registry = embedRegistryOf(this.host.app);
    const original = registry?.embedByExtension.md;
    if (!registry || typeof original !== "function") return () => undefined;
    let enabled = true;
    const creator: EmbedCreator = (ctx, file, subpath) =>
      (enabled ? this.create(ctx, file, subpath) : null) ?? original(ctx, file, subpath);
    registry.unregisterExtension("md");
    registry.registerExtension("md", creator);
    return () => {
      enabled = false;
      if (registry.embedByExtension.md !== creator) return;
      registry.unregisterExtension("md");
      registry.registerExtension("md", original);
    };
  }

  /** A page embed for `file`, or `null` to leave the embed to Obsidian. */
  private create(ctx: EmbedContext, file: TFile, subpath: string): NotebookPageEmbed | null {
    if (!this.active) return null;
    const target = embedTarget(subpath);
    if (target === null || !this.host.isInkFile(file)) return null;
    return new NotebookPageEmbed(this, ctx, file, target);
  }

  // --- Embeds coming and going ----------------------------------------------------

  /** @internal An embed was built: watch it come on screen. */
  track(embed: NotebookPageEmbed): void {
    if (!this.active) return;
    this.live.add(embed);
    this.byElement.set(embed.containerEl, embed);
    this.intersections ??= new IntersectionObserver((entries) => this.onIntersect(entries));
    this.resizes ??= new ResizeObserver((entries) => this.onResize(entries));
    this.intersections.observe(embed.containerEl);
    this.resizes.observe(embed.containerEl);
  }

  /** @internal An embed was taken down. */
  untrack(embed: NotebookPageEmbed): void {
    this.live.delete(embed);
    if (this.byElement.get(embed.containerEl) === embed) this.byElement.delete(embed.containerEl);
    this.queue.delete(embed);
    this.intersections?.unobserve(embed.containerEl);
    this.resizes?.unobserve(embed.containerEl);
  }

  private onIntersect(entries: IntersectionObserverEntry[]): void {
    const now = performance.now();
    for (const entry of entries) {
      const embed = this.byElement.get(entry.target);
      if (!embed) continue;
      embed.visible = entry.isIntersecting;
      embed.lastSeen = now;
      if (embed.visible) this.schedule(embed);
    }
  }

  /** A new width may cross a paint step; `refresh` decides. */
  private onResize(entries: ResizeObserverEntry[]): void {
    for (const entry of entries) {
      const embed = this.byElement.get(entry.target);
      if (embed?.visible) this.schedule(embed);
    }
  }

  // --- Painting -------------------------------------------------------------------

  private schedule(embed: NotebookPageEmbed): void {
    if (!this.active || !this.live.has(embed)) return;
    if (embed.busy) {
      // Refreshed again once the one under way ends.
      embed.again = true;
      return;
    }
    this.queue.add(embed);
    if (!this.pumping) void this.pump();
  }

  /**
   * One embed at a time, so opening a note full of pages does not stall it.
   * A page that takes longer than `SLOW_PAINT_MS` (a PDF slide on an older
   * iPad, a picture decode WebKit holds back) keeps painting on its own and
   * lands when ready; the others do not wait behind it.
   */
  private async pump(): Promise<void> {
    this.pumping = true;
    try {
      for (;;) {
        const next = this.queue.values().next();
        if (next.done) break;
        const embed = next.value;
        this.queue.delete(embed);
        if (!embed.visible || !this.live.has(embed) || embed.busy) continue;
        const run = this.refresh(embed)
          .catch((error: unknown) => {
            console.error("FineNotes: could not draw an embedded page", error);
            embed.showLink("unreadable");
          })
          .finally(() => {
            embed.busy = false;
            if (embed.again) {
              embed.again = false;
              if (embed.visible) this.schedule(embed);
            }
          });
        embed.busy = true;
        let timer = 0;
        await Promise.race([
          run,
          new Promise<void>((resolve) => (timer = window.setTimeout(resolve, SLOW_PAINT_MS))),
        ]);
        window.clearTimeout(timer);
      }
    } finally {
      this.pumping = false;
    }
  }

  /** Bring one embed up to date with its file: its page, a link, or nothing to do. */
  private async refresh(embed: NotebookPageEmbed): Promise<void> {
    const { file } = embed;
    if (!this.host.app.vault.getFileByPath(file.path)) {
      embed.showLink("missing-file");
      return;
    }
    const version = file.stat.mtime;
    if (embed.version !== version || !embed.page) {
      const pages = await this.notebook(file, version);
      if (!this.live.has(embed)) return;
      embed.version = version;
      embed.page = pages?.[embed.target.page - 1] ?? null;
      if (!embed.page) {
        embed.showLink(!pages ? "unreadable" : pages.length === 0 ? "no-pages" : "missing-page");
        return;
      }
    }
    const page = embed.page;
    embed.showPage(page);
    const size = embedPaintSize(embed.boxWidth(), window.devicePixelRatio || 1);
    if (!size) return;
    const key = `${pageSignature(page)}@${size.cssWidth}x${size.dpr}`;
    if (key === embed.painted) return;
    await paintPagePreview(embed.canvas, page, this.sources(page), size.cssWidth, size.dpr);
    if (!this.live.has(embed)) return;
    embed.painted = key;
    embed.bytes = embed.canvas.width * embed.canvas.height * 4;
    this.trim();
  }

  /**
   * The pages of the notebook at `file` as of `version`, decoded once for
   * every embed of it: none when the file has no ink block yet (a decoded
   * notebook always has a page), `null` when its block does not decode.
   */
  private notebook(file: TFile, version: number): Promise<readonly Page[] | null> {
    return this.notebooks.get(file.path, version, async () => {
      const text = await this.host.app.vault.cachedRead(file);
      const { doc, payload } = parseInkFile(text, this.host.paperWidth());
      if (doc) return doc.pages;
      return payload === undefined ? [] : null;
    });
  }

  private sources(page: Page): PdfExportSources {
    return {
      pdf: page.backdrop.kind === "pdf" ? this.pdfCache() : this.pdf,
      images: page.images.length > 0 ? this.imageCache() : this.images,
      paper: paperTheme(false),
      usePressure: this.host.usePressure(),
      highlighterAlpha: this.host.highlighterAlpha(),
    };
  }

  /** The PDF raster cache, made on the first PDF page, rendering in the shared worker once it is up. */
  private pdfCache(): PdfBackdropCache {
    if (this.pdf) return this.pdf;
    const cache = new PdfBackdropCache(this.host.app);
    this.pdf = cache;
    if (!this.workerHeld) {
      this.workerHeld = true;
      void acquirePdfWorker().then((worker) => {
        if (worker && this.pdf === cache) cache.setWorker(worker);
      });
    }
    return cache;
  }

  private imageCache(): VaultImageCache {
    this.images ??= new VaultImageCache(this.host.app);
    return this.images;
  }

  /** Give back the canvases of embeds off screen once all of them hold too much. */
  private trim(): void {
    const painted = [...this.live].filter((embed) => embed.bytes > 0);
    for (const embed of embedsToRelease(
      painted.map((e) => ({ key: e, bytes: e.bytes, visible: e.visible, lastSeen: e.lastSeen })),
      EMBED_CANVAS_BUDGET,
    )) {
      embed.release();
    }
  }

  // --- Files changing -------------------------------------------------------------

  private fileChanged(file: TAbstractFile): void {
    if (!(file instanceof TFile)) return;
    this.sourceChanged(file.path);
    if (!this.watches(file.path)) return;
    // A notebook open beside the note saves a second after the pen lifts; one repaint will do.
    window.clearTimeout(this.changeTimers.get(file.path));
    this.changeTimers.set(
      file.path,
      window.setTimeout(() => {
        this.changeTimers.delete(file.path);
        this.notebooks.forget(file.path);
        for (const embed of this.live) {
          if (embed.file.path === file.path && embed.visible) this.schedule(embed);
        }
      }, CHANGE_DEBOUNCE_MS),
    );
  }

  private fileDeleted(file: TAbstractFile): void {
    this.notebooks.forget(file.path);
    this.sourceChanged(file.path);
    for (const embed of this.live) {
      if (embed.file.path === file.path) embed.showLink("missing-file");
    }
  }

  private watches(path: string): boolean {
    for (const embed of this.live) if (embed.file.path === path) return true;
    return false;
  }

  /** A picture or PDF changed under the pages that show it: they read it afresh. */
  private sourceChanged(path: string): void {
    const picture = this.images?.forget(path) ?? false;
    const pdf = /\.pdf$/i.test(path) && (this.pdf?.forget(path) ?? false);
    if (!picture && !pdf) return;
    for (const embed of this.live) {
      const page = embed.page;
      if (!page) continue;
      const shows =
        page.images.some((image) => image.path === path) ||
        (page.backdrop.kind === "pdf" && page.backdrop.path === path);
      if (!shows) continue;
      embed.painted = "";
      if (embed.visible) this.schedule(embed);
    }
  }
}

/** Why an embed shows a link instead of its page. */
type LinkReason = "missing-page" | "no-pages" | "missing-file" | "unreadable";

const LINK_TITLES: Record<LinkReason, (page: number) => string> = {
  "missing-page": (page) => `This notebook has no page ${page}.`,
  "no-pages": () => "This notebook has no pages.",
  "missing-file": () => "This notebook is not in the vault.",
  unreadable: () => "This notebook could not be read.",
};

/**
 * One `![[Notebook#page=N]]`: the page painted into a canvas, or, when there
 * is no such page to show, a plain link to the notebook. What Obsidian's
 * embed loader expects back from a creator: a component with `loadFile()`.
 */
class NotebookPageEmbed extends Component {
  readonly containerEl: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  private readonly pageEl: HTMLElement;
  private linkEl: HTMLElement | null = null;
  /** The page shown, from the file as of `version` (its modification time). */
  page: Page | null = null;
  version = -1;
  /** What the canvas holds: the page's signature and the paint size; "" for nothing. */
  painted = "";
  bytes = 0;
  visible = false;
  lastSeen = 0;
  /** A refresh is under way; `again` asks for one more after it. */
  busy = false;
  again = false;

  constructor(
    private readonly embeds: PageEmbeds,
    private readonly ctx: EmbedContext,
    readonly file: TFile,
    /** The page shown (1-based, as the link writes it), or page 1 of the whole notebook. */
    readonly target: EmbedTarget,
  ) {
    super();
    this.containerEl = ctx.containerEl;
    this.containerEl.addClass("goodobsidian-page-embed");
    // Live preview selects the link's source on a click inside an embed,
    // except inside an `interactive-child`: a click on the page opens it.
    this.pageEl = this.containerEl.createDiv({
      cls: "goodobsidian-page-embed-page interactive-child",
    });
    this.pageEl.setAttribute("role", "link");
    this.pageEl.tabIndex = 0;
    this.pageEl.setAttribute("aria-label", embedLabel(file.basename, target));
    this.pageEl.setCssStyles({ aspectRatio: aspectOf(DEFAULT_PAGE_GEOMETRY) });
    this.canvas = this.pageEl.createEl("canvas", { cls: "goodobsidian-page-embed-canvas" });
    // No backing store until the page is painted (a canvas starts at 300 x 150).
    releaseCanvas(this.canvas);
  }

  /** Called by Obsidian's embed loader once the embed is in place. */
  loadFile(): Promise<void> {
    this.registerDomEvent(this.pageEl, "click", (event) => this.open(event));
    this.registerDomEvent(this.pageEl, "keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") this.open(event);
    });
    this.embeds.track(this);
    return Promise.resolve();
  }

  override onunload(): void {
    this.embeds.untrack(this);
    this.release();
  }

  private open(event: MouseEvent | KeyboardEvent): void {
    event.preventDefault();
    event.stopPropagation();
    void this.ctx.app.workspace.openLinkText(
      this.ctx.linktext,
      this.ctx.sourcePath,
      Keymap.isModEvent(event),
    );
  }

  /** The width the page box has now, CSS px, after the size syntax's cap. */
  boxWidth(): number {
    const width = embedWidth(
      this.containerEl.getAttribute("width"),
      this.containerEl.getAttribute("alt"),
    );
    this.pageEl.setCssStyles({ maxWidth: width === null ? "" : `${width}px` });
    return this.pageEl.getBoundingClientRect().width;
  }

  showPage(page: Page): void {
    this.linkEl?.remove();
    this.linkEl = null;
    this.containerEl.removeClass("is-link");
    this.pageEl.removeClass("is-hidden");
    this.pageEl.setCssStyles({ aspectRatio: aspectOf(page.geometry) });
  }

  /** No page to show: a plain link to the notebook, saying why. */
  showLink(reason: LinkReason): void {
    this.release();
    this.page = null;
    this.version = -1;
    this.pageEl.addClass("is-hidden");
    this.containerEl.addClass("is-link");
    this.linkEl?.remove();
    const link = this.containerEl.createEl("a", {
      cls: "internal-link goodobsidian-page-embed-link interactive-child",
      text: embedLabel(this.file.basename, this.target),
      href: this.ctx.linktext,
    });
    link.dataset.href = this.ctx.linktext;
    link.setAttribute("title", LINK_TITLES[reason](this.target.page));
    link.toggleClass("is-unresolved", reason === "missing-file");
    link.addEventListener("click", (event) => this.open(event));
    this.linkEl = link;
  }

  /** Give the canvas' pixels back; the page paints again when it is next on screen. */
  release(): void {
    if (this.bytes === 0 && this.painted === "") return;
    releaseCanvas(this.canvas);
    this.painted = "";
    this.bytes = 0;
  }
}

/** A page's CSS `aspect-ratio`. */
function aspectOf(geometry: { width: number; height: number }): string {
  return geometry.width > 0 && geometry.height > 0 ? `${geometry.width} / ${geometry.height}` : "";
}
