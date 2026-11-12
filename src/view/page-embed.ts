/**
 * Notebook embeds: `![[Physics.notebook#page=3]]` (or `#Page 3`, `#p3`) in an
 * ordinary note shows that page of the notebook, read-only, at the note's
 * width; `![[Physics.notebook]]` shows every page, one under the other
 * (FineNotes discussion #167). In a hover preview of a notebook link, a
 * notebook of more than `MAX_PREVIEW_PAGES`, such as an imported textbook,
 * shows its cover and the pages its chapters, bookmarks and contents point
 * to, each labelled, then how many it left out (`embedPageNumbers`). A click
 * opens the notebook at the page clicked. Paginated notebooks can do this
 * where an infinite canvas cannot: a page has a fixed shape of its own.
 *
 * The hook. Obsidian builds every `![[…]]` embed, in reading view, live
 * preview, hover previews, canvas cards and Export to PDF alike, through one
 * loader that asks its embed registry for the creator registered for the
 * target file's extension (`app.embedRegistry`, read from Obsidian's own
 * `app.js`; core Canvas and Bases register their file types there the same
 * way). A notebook is a `.md` file, so its embeds reach the Markdown creator,
 * which would show the note's text and fail to find a section named
 * "page=3". The plugin puts a creator in front of that one: it takes
 * notebook files whose subpath names a page, or that have none, and hands
 * everything else, headings included, to the original, untouched. The
 * registry is not public API, so the hook checks its shape first and stands
 * aside when it is not there; Obsidian then shows the Markdown embed it
 * always did.
 *
 * Painting goes through `paintPagePreview`, the export dialog's one-shot
 * page renderer (paper or PDF slide, pictures, text boxes, ink), into one
 * canvas per page shown, only once that page is on screen, one at a time.
 * All embeds share one decoded copy of each notebook, one PDF raster cache
 * and one picture cache, and the canvases of pages off screen are given back
 * past a byte budget, so a note that embeds many pages stays cheap.
 *
 * Export to PDF renders the note in a hidden window and waits for every
 * embed's `loadFile()` (read from `app.js`: the print path collects them in
 * `promises`), where nothing is ever on screen. An embed inside that print
 * layout paints every page at once, in light paper, before it resolves.
 */

import { type App, Component, Keymap, type TAbstractFile, TFile, setIcon } from "obsidian";
import { LIGHT_PAPER, type PaperTheme } from "../canvas/backdrop";
import { t, tn } from "../i18n/translate";
import { paintedTextHeight } from "../canvas/renderer";
import { isBoard, textLinesHeight } from "../model/board";
import { DEFAULT_PAGE_GEOMETRY, type Page, type TextBoxElement } from "../model/document";
import { pageSignature } from "../model/page-signature";
import { parseInkFile } from "../model/serialize";
import { VaultImageCache } from "./image-cache";
import { releaseCanvas } from "./image-import";
import {
  EMBED_CANVAS_BUDGET,
  type EmbedCrop,
  SharedNotebooks,
  boardEmbedBox,
  embedPaintSize,
  embedWidth,
  type EmbedTarget,
  embedLabel,
  embedPageLabel,
  embedPageLink,
  embedPageNumbers,
  embedTarget,
  embedsToRelease,
  printPaintSize,
  regionEmbedPart,
} from "./page-embed-model";
import { previewCaption } from "../model/preview-pages";
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

/** What notebook embeds need from the plugin. */
export interface PageEmbedHost {
  app: App;
  isInkFile(file: TFile): boolean;
  paperWidth(): number;
  usePressure(): boolean;
  highlighterAlpha(): number;
  /** The paper theme pages are shown in: light, or dark pages (the view setting). */
  paper(): PaperTheme;
}

/** A notebook's pages as embeds read them, and whether it is an endless board. */
interface EmbedNotebook {
  pages: readonly Page[];
  board: boolean;
}

/** Quiet time after a notebook is saved before its embeds repaint. */
const CHANGE_DEBOUNCE_MS = 300;
/** How long the next page waits for a slow one to finish painting. */
const SLOW_PAINT_MS = 1500;

/** The element of Obsidian's Export to PDF layout (`body > .print`, app.js). */
const PRINT_LAYOUT = ".print";

/**
 * Every notebook embed the plugin draws, and what they share. A child of the
 * plugin: the hook comes off with it.
 */
export class PageEmbeds extends Component {
  /** Each notebook's pages; none for a file without an ink block, `null` for one that would not decode. */
  private readonly notebooks = new SharedNotebooks<EmbedNotebook | null>(3);
  /** Measures self-sizing text boxes for a board's cut, as its export does. */
  private measureCtx: CanvasRenderingContext2D | null = null;
  private readonly live = new Set<NotebookEmbed>();
  /** The pages shown, by the element the observers report. */
  private readonly byElement = new Map<Element, PageSlot>();
  /** Pages waiting to paint; `true` paints one even while it is not on screen. */
  private readonly queue = new Map<PageSlot, boolean>();
  private pumping = false;
  private intersections: IntersectionObserver | null = null;
  private resizes: ResizeObserver | null = null;
  private pdf: PdfBackdropCache | null = null;
  private images: VaultImageCache | null = null;
  private workerHeld = false;
  private readonly changeTimers = new Map<string, number>();
  private active = false;
  /**
   * Obsidian's Markdown embed creator, which this one stands in front of:
   * an embed whose subpath names no region of its notebook goes back to it.
   */
  private markdown: EmbedCreator | null = null;

  constructor(private readonly host: PageEmbedHost) {
    super();
  }

  override onload(): void {
    this.active = true;
    this.register(this.installHook());
    const { vault } = this.host.app;
    this.registerEvent(vault.on("modify", (file) => this.fileChanged(file)));
    this.registerEvent(this.host.app.workspace.on("css-change", () => this.repaintAll()));
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
   * Put the notebook creator in front of Obsidian's Markdown one. Returns
   * what takes it off again. When another plugin has since put its own
   * creator in front of this one, taking this one out would drop theirs
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
    this.markdown = original;
    return () => {
      enabled = false;
      this.markdown = null;
      if (registry.embedByExtension.md !== creator) return;
      registry.unregisterExtension("md");
      registry.registerExtension("md", original);
    };
  }

  /** A notebook embed for `file`, or `null` to leave the embed to Obsidian. */
  private create(ctx: EmbedContext, file: TFile, subpath: string): NotebookEmbed | null {
    if (!this.active) return null;
    const target = embedTarget(subpath);
    if (target === null || !this.host.isInkFile(file)) return null;
    return new NotebookEmbed(this, ctx, file, target, subpath);
  }

  // --- Embeds coming and going ----------------------------------------------------

  /** @internal An embed was built: watch its pages come on screen. */
  track(embed: NotebookEmbed): void {
    if (!this.active) return;
    this.live.add(embed);
    for (const slot of embed.slots) this.trackSlot(slot);
  }

  /** @internal An embed was taken down. */
  untrack(embed: NotebookEmbed): void {
    this.live.delete(embed);
    for (const slot of embed.slots) this.untrackSlot(slot);
  }

  /** @internal A page of a tracked embed was added. */
  trackSlot(slot: PageSlot): void {
    if (!this.active || !this.live.has(slot.embed)) return;
    this.byElement.set(slot.el, slot);
    this.intersections ??= new IntersectionObserver((entries) => this.onIntersect(entries));
    this.resizes ??= new ResizeObserver((entries) => this.onResize(entries));
    this.intersections.observe(slot.el);
    this.resizes.observe(slot.el);
  }

  /** @internal A page of an embed was taken out. */
  untrackSlot(slot: PageSlot): void {
    if (this.byElement.get(slot.el) === slot) this.byElement.delete(slot.el);
    this.queue.delete(slot);
    this.intersections?.unobserve(slot.el);
    this.resizes?.unobserve(slot.el);
  }

  private onIntersect(entries: IntersectionObserverEntry[]): void {
    const now = performance.now();
    for (const entry of entries) {
      const slot = this.byElement.get(entry.target);
      if (!slot) continue;
      slot.visible = entry.isIntersecting;
      slot.lastSeen = now;
      if (slot.visible) this.schedule(slot);
    }
  }

  /** A new width may cross a paint step; `refresh` decides. */
  private onResize(entries: ResizeObserverEntry[]): void {
    for (const entry of entries) {
      const slot = this.byElement.get(entry.target);
      if (slot?.visible) this.schedule(slot);
    }
  }

  // --- Painting -------------------------------------------------------------------

  /** Paint `slot` when its turn comes; `force` even while it is not on screen. */
  private schedule(slot: PageSlot, force = false): void {
    if (!this.active || !this.live.has(slot.embed) || !slot.attached) return;
    if (slot.busy) {
      // Refreshed again once the one under way ends.
      slot.again = true;
      return;
    }
    this.queue.set(slot, force || (this.queue.get(slot) ?? false));
    if (!this.pumping) void this.pump();
  }

  /**
   * One page at a time, so opening a note full of pages does not stall it.
   * A page that takes longer than `SLOW_PAINT_MS` (a PDF slide on an older
   * iPad, a picture decode WebKit holds back) keeps painting on its own and
   * lands when ready; the others do not wait behind it.
   */
  private async pump(): Promise<void> {
    this.pumping = true;
    try {
      for (;;) {
        const next = this.queue.entries().next();
        if (next.done) break;
        const [slot, force] = next.value;
        this.queue.delete(slot);
        if ((!slot.visible && !force) || !this.live.has(slot.embed) || slot.busy) continue;
        if (!slot.attached) continue;
        const run = this.refresh(slot)
          .catch((error: unknown) => {
            console.error("FineNotes: could not draw an embedded page", error);
            slot.embed.showLink("unreadable");
          })
          .finally(() => {
            slot.busy = false;
            if (slot.again) {
              slot.again = false;
              if (slot.visible) this.schedule(slot);
            }
          });
        slot.busy = true;
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

  /** Bring one page of an embed up to date with its file: the page, a link, or nothing to do. */
  private async refresh(slot: PageSlot): Promise<void> {
    const { embed } = slot;
    if (!(await this.syncEmbed(embed))) return;
    if (!this.live.has(embed) || !slot.attached || !slot.page) return;
    const size = embedPaintSize(slot.boxWidth(), window.devicePixelRatio || 1, slot.aspect());
    if (!size) return;
    await this.paint(slot, size, this.host.paper());
    if (!this.live.has(embed)) return;
    this.trim();
  }

  /**
   * Read the embed's notebook if it changed since its pages were set, and
   * set them. False when the embed shows a link instead (no such file, no
   * such page, a notebook that will not decode).
   */
  private async syncEmbed(embed: NotebookEmbed): Promise<boolean> {
    const { file } = embed;
    if (!this.host.app.vault.getFileByPath(file.path)) {
      embed.showLink("missing-file");
      return false;
    }
    const version = file.stat.mtime;
    if (embed.version === version) return !embed.isLink;
    const notebook = await this.notebook(file, version);
    if (embed.version === version) return !embed.isLink;
    embed.version = version;
    const reason = embed.setPages(notebook);
    // `#Introduction` names no region: Obsidian shows that heading of the note's text,
    // as it did before regions. A region that is gone since it was shown says so instead.
    if (reason === "missing-region" && !embed.foundRegion && this.markdown) {
      this.untrack(embed);
      await embed.handOver(this.markdown);
      return false;
    }
    if (reason) {
      embed.showLink(reason);
      return false;
    }
    embed.showPages();
    // Pages the update added that are already on screen are reported by the observer.
    return true;
  }

  /** Paint `slot`'s page at `size` in `paper`, unless the canvas already holds just that. */
  private async paint(
    slot: PageSlot,
    size: { cssWidth: number; dpr: number },
    paper: PaperTheme,
  ): Promise<void> {
    const page = slot.page;
    if (!page) return;
    const look = paper.night ? (paper.keepPdf ? "|dark-keep-pdf" : "|dark") : "";
    const crop = slot.crop;
    const cut = crop ? `#${crop.x},${crop.y},${crop.width},${crop.height}` : "";
    const key = `${pageSignature(page)}${cut}@${size.cssWidth}x${size.dpr}${look}`;
    if (key === slot.painted) return;
    await paintPagePreview(
      slot.canvas,
      page,
      this.sources(page, paper),
      size.cssWidth,
      size.dpr,
      crop ?? undefined,
    );
    slot.painted = key;
    slot.bytes = slot.canvas.width * slot.canvas.height * 4;
  }

  /**
   * An embed in Obsidian's Export to PDF layout: every page painted now, in
   * light paper (the export is always light), before `loadFile` resolves,
   * since the export waits for it and nothing there is ever on screen.
   */
  async paintForPrint(embed: NotebookEmbed): Promise<void> {
    try {
      if (!(await this.syncEmbed(embed))) return;
      for (const slot of embed.slots) {
        await this.paint(slot, printPaintSize(slot.boxWidth(), slot.aspect()), LIGHT_PAPER);
      }
    } catch (error) {
      console.error("FineNotes: could not draw an embedded page for the PDF", error);
      embed.showLink("unreadable");
    }
  }

  /**
   * The pages of the notebook at `file` as of `version`, decoded once for
   * every embed of it: none when the file has no ink block yet (a decoded
   * notebook always has a page), `null` when its block does not decode.
   */
  private notebook(file: TFile, version: number): Promise<EmbedNotebook | null> {
    return this.notebooks.get(file.path, version, async () => {
      const text = await this.host.app.vault.cachedRead(file);
      const { doc, payload } = parseInkFile(text, this.host.paperWidth());
      if (doc) return { pages: doc.pages, board: isBoard(doc) };
      return payload === undefined ? { pages: [], board: false } : null;
    });
  }

  /**
   * The part of a board's page an embed shows: its drawing (`boardEmbedBox`),
   * self-sizing text measured as the export measures it.
   */
  boardCut(page: Page): EmbedCrop {
    return boardEmbedBox(page, (text) => this.textHeight(text));
  }

  private textHeight(text: TextBoxElement): number {
    this.measureCtx ??= createEl("canvas").getContext("2d");
    return this.measureCtx ? paintedTextHeight(this.measureCtx, text) : textLinesHeight(text);
  }

  private sources(page: Page, paper: PaperTheme): PdfExportSources {
    return {
      pdf: page.backdrop.kind === "pdf" ? this.pdfCache() : this.pdf,
      images: page.images.length > 0 ? this.imageCache() : this.images,
      paper,
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

  /** Give back the canvases of pages off screen once all of them hold too much. */
  private trim(): void {
    const painted: PageSlot[] = [];
    for (const embed of this.live)
      for (const slot of embed.slots) if (slot.bytes > 0) painted.push(slot);
    for (const slot of embedsToRelease(
      painted.map((s) => ({ key: s, bytes: s.bytes, visible: s.visible, lastSeen: s.lastSeen })),
      EMBED_CANVAS_BUDGET,
    )) {
      slot.release();
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
          if (embed.file.path !== file.path) continue;
          // An embed showing a link has no page on screen to report it: read it anyway.
          const first = embed.slots[0];
          if (embed.isLink && first) this.schedule(first, true);
          for (const slot of embed.slots) if (slot.visible) this.schedule(slot);
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

  /**
   * The page appearance may have changed (the setting, or Obsidian's theme
   * it follows): every page in view repaints if its look did.
   */
  repaintAll(): void {
    for (const embed of this.live)
      for (const slot of embed.slots) if (slot.visible) this.schedule(slot);
  }

  /** A picture or PDF changed under the pages that show it: they read it afresh. */
  private sourceChanged(path: string): void {
    const picture = this.images?.forget(path) ?? false;
    const pdf = /\.pdf$/i.test(path) && (this.pdf?.forget(path) ?? false);
    if (!picture && !pdf) return;
    for (const embed of this.live) {
      for (const slot of embed.slots) {
        const page = slot.page;
        if (!page) continue;
        const shows =
          page.images.some((image) => image.path === path) ||
          (page.backdrop.kind === "pdf" && page.backdrop.path === path);
        if (!shows) continue;
        slot.painted = "";
        if (slot.visible) this.schedule(slot);
      }
    }
  }
}

/** Why an embed shows a link instead of its pages. */
type LinkReason = "missing-page" | "missing-region" | "no-pages" | "missing-file" | "unreadable";

function linkTitle(reason: LinkReason, target: EmbedTarget): string {
  switch (reason) {
    case "missing-page":
      return t("view.pageEmbed.missingPage", { page: target.page });
    case "missing-region":
      return t("view.pageEmbed.missingRegion", { name: target.region ?? "" });
    case "no-pages":
      return t("view.pageEmbed.noPages");
    case "missing-file":
      return t("view.pageEmbed.missingFile");
    case "unreadable":
      return t("view.pageEmbed.unreadable");
  }
}

/**
 * One `![[Notebook#page=N]]` or `![[Notebook]]`: its pages, each painted into
 * a canvas of its own, or, when there is nothing to show, a plain link to the
 * notebook. What Obsidian's embed loader expects back from a creator: a
 * component with `loadFile()`.
 */
class NotebookEmbed extends Component {
  readonly containerEl: HTMLElement;
  /** The pages shown, in order. One until the notebook has been read. */
  readonly slots: PageSlot[] = [];
  private linkEl: HTMLElement | null = null;
  /** The pages are from the file as of `version` (its modification time); -1 for not read yet. */
  version = -1;
  isLink = false;
  /** A whole notebook too long to show every page: a choice of them, each labelled. */
  shortened = false;
  private moreEl: HTMLElement | null = null;
  private loaded = false;
  /** A region embed has shown its region once: from then on, one gone says so. */
  foundRegion = false;

  constructor(
    readonly embeds: PageEmbeds,
    readonly ctx: EmbedContext,
    readonly file: TFile,
    readonly target: EmbedTarget,
    /** The link's subpath as Obsidian gave it, for handing the embed back. */
    private readonly subpath: string,
  ) {
    super();
    this.containerEl = ctx.containerEl;
    this.containerEl.addClass("goodobsidian-page-embed");
    if (target.whole) this.containerEl.addClass("goodobsidian-notebook-embed");
    this.slots.push(new PageSlot(this, target.page));
  }

  /** Called by Obsidian's embed loader once the embed is in place. */
  loadFile(): Promise<void> {
    this.loaded = true;
    if (this.containerEl.closest(PRINT_LAYOUT)) return this.embeds.paintForPrint(this);
    this.embeds.track(this);
    return Promise.resolve();
  }

  override onunload(): void {
    this.embeds.untrack(this);
    for (const slot of this.slots) slot.release();
  }

  /**
   * The notebook's pages: one slot for each page this embed shows, added or
   * taken out to match. Returns why there is nothing to show, if so.
   */
  setPages(notebook: EmbedNotebook | null): LinkReason | null {
    if (!notebook) return "unreadable";
    const { pages } = notebook;
    if (this.target.region !== undefined) {
      // One page, cut to the region (discussion #167).
      const part = regionEmbedPart(pages, this.target.region);
      if (!part) return "missing-region";
      this.foundRegion = true;
      this.shortened = false;
      this.slots[0]?.show(part.page, pages[part.page - 1] ?? null, 1, part.crop);
      this.showMore(0);
      return null;
    }
    // Obsidian's hover preview of a link holds the embed in a `.hover-popover`.
    const hover = this.containerEl.closest(".hover-popover") !== null;
    const numbers = embedPageNumbers(this.target, pages, hover);
    if (numbers.length === 0) return "no-pages";
    // A hover preview of a long notebook shows a choice of its pages: each says which it is.
    const left = this.target.whole ? pages.length - numbers.length : 0;
    this.shortened = left > 0;
    while (this.slots.length > numbers.length) {
      const slot = this.slots.pop();
      if (!slot) break;
      this.embeds.untrackSlot(slot);
      slot.remove();
    }
    while (this.slots.length < numbers.length) {
      const slot = new PageSlot(this, this.slots.length + 1);
      this.slots.push(slot);
      if (this.loaded) this.embeds.trackSlot(slot);
    }
    numbers.forEach((number, i) => {
      const page = pages[number - 1] ?? null;
      // A board shows its drawing, not the paper it has grown to.
      const crop = page && notebook.board ? this.embeds.boardCut(page) : null;
      this.slots[i]?.show(number, page, numbers.length, crop);
    });
    this.showMore(left);
    return this.slots.every((slot) => slot.page) ? null : "missing-page";
  }

  /**
   * After the pages of a shortened embed: how many it left out, as a link
   * that opens the notebook. Gone when it shows them all.
   */
  private showMore(left: number): void {
    if (left <= 0) {
      this.moreEl?.remove();
      this.moreEl = null;
      return;
    }
    if (!this.moreEl) {
      const link = createEl("a", {
        cls: "goodobsidian-page-embed-more interactive-child",
        href: this.ctx.linktext,
      });
      link.dataset.href = this.ctx.linktext;
      link.addEventListener("click", (event) => this.openNotebook(event));
      this.moreEl = link;
    }
    this.moreEl.setText(`+${left}`);
    this.moreEl.setAttribute("aria-label", tn("view.pageEmbed.morePages", left));
    this.moreEl.toggleClass("is-hidden", this.isLink);
    // Last, after any page added since.
    this.containerEl.appendChild(this.moreEl);
  }

  /** The notebook itself, where it was last left. */
  private openNotebook(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    void this.ctx.app.workspace.openLinkText(
      this.ctx.linktext,
      this.ctx.sourcePath,
      Keymap.isModEvent(event),
    );
  }

  open(event: MouseEvent | KeyboardEvent, page: number): void {
    event.preventDefault();
    event.stopPropagation();
    void this.ctx.app.workspace.openLinkText(
      embedPageLink(this.ctx.linktext, this.target, page),
      this.ctx.sourcePath,
      Keymap.isModEvent(event),
    );
  }

  /**
   * No region of this name: what Obsidian's Markdown embed shows instead
   * (a heading of the note's text, or its own "not found"), in this embed's
   * place, as if the plugin had never taken it.
   */
  async handOver(markdown: EmbedCreator): Promise<void> {
    for (const slot of this.slots) slot.remove();
    this.slots.length = 0;
    this.linkEl?.remove();
    this.linkEl = null;
    this.moreEl?.remove();
    this.moreEl = null;
    this.containerEl.removeClass(
      "goodobsidian-page-embed",
      "goodobsidian-notebook-embed",
      "is-link",
    );
    const child = markdown(this.ctx, this.file, this.subpath);
    if (!child) return;
    this.addChild(child);
    await child.loadFile();
  }

  showPages(): void {
    if (!this.isLink) return;
    this.isLink = false;
    this.linkEl?.remove();
    this.linkEl = null;
    this.containerEl.removeClass("is-link");
    for (const slot of this.slots) slot.el.removeClass("is-hidden");
    this.moreEl?.removeClass("is-hidden");
  }

  /** No page to show: a plain link to the notebook, saying why. */
  showLink(reason: LinkReason): void {
    for (const slot of this.slots) {
      slot.release();
      slot.el.addClass("is-hidden");
    }
    this.moreEl?.addClass("is-hidden");
    this.version = -1;
    this.isLink = true;
    this.containerEl.addClass("is-link");
    this.linkEl?.remove();
    const link = this.containerEl.createEl("a", {
      cls: "internal-link goodobsidian-page-embed-link interactive-child",
      text: embedLabel(this.file.basename, this.target),
      href: this.ctx.linktext,
    });
    link.dataset.href = this.ctx.linktext;
    link.setAttribute("title", linkTitle(reason, this.target));
    link.toggleClass("is-unresolved", reason === "missing-file");
    link.addEventListener("click", (event) => this.open(event, this.target.page));
    this.linkEl = link;
  }
}

/** One page of an embed: its box, sized by the page's shape, and the canvas it is painted into. */
class PageSlot {
  readonly el: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  /** The page's number in the notebook, 1-based. */
  number: number;
  page: Page | null = null;
  /** The part of the page shown, page px; `null` for all of it. */
  crop: EmbedCrop | null = null;
  /** What the canvas holds: the page's signature and the paint size; "" for nothing. */
  painted = "";
  bytes = 0;
  visible = false;
  lastSeen = 0;
  /** A refresh is under way; `again` asks for one more after it. */
  busy = false;
  again = false;
  attached = true;
  private captionEl: HTMLElement | null = null;
  private ribbonEl: HTMLElement | null = null;

  constructor(
    readonly embed: NotebookEmbed,
    number: number,
  ) {
    this.number = number;
    // Live preview selects the link's source on a click inside an embed,
    // except inside an `interactive-child`: a click on the page opens it.
    this.el = embed.containerEl.createDiv({
      cls: "goodobsidian-page-embed-page interactive-child",
    });
    this.el.setAttribute("role", "link");
    this.el.tabIndex = 0;
    // Until the notebook is read: its name for one embedded whole, else "Physics, page 3".
    this.el.setAttribute(
      "aria-label",
      embedPageLabel(embed.file.basename, embed.target, number, 1),
    );
    // A region's shape is not known yet: a short box, not a page, until it is read.
    this.el.setCssStyles({
      aspectRatio: embed.target.region !== undefined ? "4 / 1" : aspectOf(DEFAULT_PAGE_GEOMETRY),
    });
    if (embed.isLink) this.el.addClass("is-hidden");
    this.canvas = this.el.createEl("canvas", { cls: "goodobsidian-page-embed-canvas" });
    // No backing store until the page is painted (a canvas starts at 300 x 150).
    releaseCanvas(this.canvas);
    this.el.addEventListener("click", (event) => this.embed.open(event, this.number));
    this.el.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") this.embed.open(event, this.number);
    });
  }

  /**
   * Show page `number` (`page`, or `null` when the notebook has none such) of
   * `count` shown; only its `crop` when given.
   */
  show(number: number, page: Page | null, count: number, crop: EmbedCrop | null = null): void {
    this.number = number;
    this.page = page;
    this.crop = crop;
    const { embed } = this;
    this.el.setAttribute(
      "aria-label",
      embedPageLabel(embed.file.basename, embed.target, number, count),
    );
    if (page) this.el.setCssStyles({ aspectRatio: aspectOf(crop ?? page.geometry) });
    this.label(embed.shortened ? page : null);
  }

  /**
   * On the paper of a shortened embed's page, since the pages shown are not
   * one after another: its number and its line in the contents, top left,
   * and its bookmark, top right, as the page sidebar marks it. Nothing when
   * `page` is `null`.
   */
  private label(page: Page | null): void {
    this.captionEl?.remove();
    this.captionEl = null;
    this.ribbonEl?.remove();
    this.ribbonEl = null;
    if (!page) return;
    const caption = this.el.createDiv({ cls: "goodobsidian-page-embed-caption" });
    caption.createSpan({ cls: "goodobsidian-page-embed-number", text: String(this.number) });
    const title = previewCaption(page);
    if (title !== undefined) caption.createSpan({ text: title });
    this.captionEl = caption;
    if (page.bookmarked) {
      const ribbon = this.el.createDiv({ cls: "goodobsidian-page-embed-ribbon" });
      setIcon(ribbon, "bookmark");
      this.ribbonEl = ribbon;
    }
  }

  /** The shown part's height over its width, for a cut; 0 for a whole page. */
  aspect(): number {
    const crop = this.crop;
    return crop && crop.width > 0 ? crop.height / crop.width : 0;
  }

  /** The width the page box has now, CSS px, after the size syntax's cap. */
  boxWidth(): number {
    const { containerEl } = this.embed;
    const width = embedWidth(containerEl.getAttribute("width"), containerEl.getAttribute("alt"));
    this.el.setCssStyles({ maxWidth: width === null ? "" : `${width}px` });
    return this.el.getBoundingClientRect().width;
  }

  /** Taken out of the embed: the notebook has fewer pages now. */
  remove(): void {
    this.attached = false;
    this.release();
    this.el.remove();
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
