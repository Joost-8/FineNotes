/**
 * Paginated wet/dry canvas renderer (DOM).
 *
 * Three stacked, viewport-sized canvases share one transform that maps **layout
 * space** to device pixels: `device = (layout - scrollY) * scale * dpr`. Keeping
 * the canvases the size of the visible viewport (not the whole document) avoids
 * iOS WebKit's max-canvas-dimension limits and keeps fills cheap.
 *
 * - **backdrop**: the desk and the page shadows. Repainted every frame; it is
 *   a fill and a few blits.
 * - **dry**: the pages themselves — paper, rules or PDF, placed images,
 *   committed ink — blitted from cached **tiles** (`./tile-grid`). A scroll frame draws only
 *   bitmaps; nothing is re-outlined. Tiles are rasterised at the settled zoom
 *   (a *level*), scaled while a pinch is in flight, and rasterised afresh
 *   once it settles. A missing tile is rasterised inside the frame when the
 *   frame's budget allows, or drawn from the page's low-resolution preview
 *   until it does; with neither, it is rasterised anyway — the dry layer
 *   never shows a hole where a page is.
 * - **wet**: the in-progress stroke, drawn synchronously per input sample for
 *   the lowest perceptible latency — and an image while it is being dragged.
 *
 * Stroke outlines are expensive (perfect-freehand), so each stroke's `Path2D`
 * is cached against a fingerprint of its points: a moved or re-pointed stroke
 * re-outlines, an untouched one never does again.
 *
 * ## The coordinate contract
 *
 * Strokes are stored in **page space** (page-local, fixed intrinsic page size).
 * Each page has a box in **layout space** (`src/canvas/page-layout.ts`), and the
 * view picks the scale that fits layout space into the window. Every tile is
 * therefore rasterised in page space and clipped to the page rectangle — a
 * stroke that ran off the edge stays off the edge, and no viewport dimension
 * is ever written back into a stored coordinate. That one-way street is the
 * cross-device ink-drift fix the whole product rests on.
 */

import { DEFAULT_HIGHLIGHTER_ALPHA } from "../constants";
import { LIGHT_PAPER, type PaperTheme } from "./backdrop";
import { type InkPath, inkPath, penOptions } from "../ink/freehand";
import {
  type Backdrop,
  type Bounds,
  type ImageCrop,
  type ImageElement,
  type InkDocument,
  type Page,
  type PageGeometry,
  type Stroke,
  type TextBoxElement,
  type Tool,
  strokeBounds,
} from "../model/document";
import { imageBounds, rotationOf } from "./image-geometry";
import type { DocumentLayout, PageBox } from "./page-layout";
import { baselineOffset, canvasFont, decorationMetrics, layoutTextBox } from "./text-layout";
import {
  ByteLru,
  TILE_SIZE,
  type TileRect,
  previewScale,
  quantiseLevel,
  rasterSize,
  tileKey,
  tilesCovering,
  tilesForBounds,
} from "./tile-grid";
import type { ViewportState } from "./viewport";

/** The veil over the part of a picture a crop leaves out. A real colour: canvas ignores `var(--…)`. */
const CROP_VEIL = "rgba(0, 0, 0, 0.55)";
/** The lasso's and the selection box's line, and the lasso's fill. Real colours, as above. */
const SELECTION_LINE = "rgba(120,170,255,0.95)";
const SELECTION_FILL = "rgba(120,170,255,0.12)";
/** Highlighter ink multiplies with what is under it: it tints writing instead of covering it. */
const HIGHLIGHTER_BLEND: GlobalCompositeOperation = "multiply";
/** The class that hides the wet layer while nothing is being drawn on it. */
const WET_HIDDEN = "goodobsidian-wet-hidden";

/** A stroke's look without its points: what the wet layer draws a stroke in progress with. */
export interface StrokeStyle {
  color: string;
  /** Nib width, in page px. */
  size: number;
  tool: Tool;
  /** Whether pressure varies the width. The highlighter ignores it and keeps one width. */
  usePressure: boolean;
  /** Clean shape geometry (a snapped or placed shape), not freehand ink. */
  shape?: boolean;
}

/** A selection box, together with the page it belongs to. */
export interface PageSelection {
  pageIndex: number;
  bounds: Bounds;
}

/**
 * Synchronous backdrop painting, for the scroll path. Implementations must not
 * block: anything that needs I/O (a PDF raster) draws a placeholder now and
 * asks for a repaint when the bitmap lands.
 *
 * The asynchronous form is `BackdropRenderer` in `./backdrop` — the interface
 * contracts/api.md §4 specifies. `VaultBackdropRenderer` implements both.
 */
export interface BackdropPainter {
  /** `weight` thickens synthetic rules for a small thumbnail (default 1). */
  paint(
    ctx: CanvasRenderingContext2D,
    backdrop: Backdrop,
    geometry: PageGeometry,
    weight?: number,
  ): void;
}

/**
 * Synchronous image painting, for the scroll path — the image counterpart of
 * {@link BackdropPainter}. The renderer has already moved `ctx` to the
 * image's top-left corner and applied its rotation, so an implementation
 * draws into the box `(0, 0, image.w, image.h)` in page units. It must not
 * block: a picture not decoded yet draws a stand-in now and asks for a
 * repaint when its bitmap lands.
 *
 * `deviceScale` is how many device pixels one page unit covers where this
 * paint will be seen (a tile's level, a thumbnail's scale), which picks the
 * resolution to decode at.
 */
export interface ImagePainter {
  paintImage(ctx: CanvasRenderingContext2D, image: ImageElement, deviceScale: number): void;
}

/**
 * Draw one placed image in page space: translate to its centre, rotate, and
 * hand the painter its unrotated box. Shared by the tiles, the page preview,
 * the wet-layer drag preview and the sidebar thumbnails.
 */
export function drawPlacedImage(
  ctx: CanvasRenderingContext2D,
  image: ImageElement,
  painter: ImagePainter,
  deviceScale: number,
): void {
  if (!(image.w > 0) || !(image.h > 0)) return;
  ctx.save();
  ctx.translate(image.x + image.w / 2, image.y + image.h / 2);
  const rotation = rotationOf(image);
  if (rotation !== 0) ctx.rotate(rotation);
  ctx.translate(-image.w / 2, -image.h / 2);
  painter.paintImage(ctx, image, deviceScale);
  ctx.restore();
}

/**
 * The colour a page's paper is: its backdrop's `paperColor` (a cover's
 * cloth, a coloured paper), else the theme's paper. Whatever lies under the
 * page, or is filled before its backdrop, is this colour — so an edge pixel
 * the page only partly covers blends with its own paper. White there drew a
 * light line along a cover's edges (Joost, 2026-09-24).
 */
export function paperColorOf(page: Page, theme: PaperTheme): string {
  const backdrop = page.backdrop;
  return (backdrop.kind !== "pdf" ? backdrop.paperColor : undefined) ?? theme.paper;
}

/**
 * Paint an {@link InkPath} in the context's current `fillStyle`: filled for
 * handwriting, stroked with round joins for a shape. `path` is the cached
 * `Path2D` of `ink.d`, when there is one.
 */
export function paintInk(ctx: CanvasRenderingContext2D, ink: InkPath, path?: Path2D): void {
  const p = path ?? new Path2D(ink.d);
  if (ink.stroke === null) {
    ctx.fill(p);
    return;
  }
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineWidth = ink.stroke;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke(p);
}

/** What the diagnostic HUD shows about the cache. */
export interface RenderStats {
  level: number;
  tiles: number;
  tileBytes: number;
  previews: number;
}

const EMPTY_LAYOUT: DocumentLayout = {
  boxes: [],
  width: 0,
  height: 0,
  direction: "vertical",
  fitWidth: 0,
};

/**
 * Floor for the tile budget. iOS caps a page's total canvas memory hard, and
 * the three viewport canvases already take their share; 48 MB is 48 full
 * tiles — a couple of iPad screens' worth plus a ring around them.
 */
const MIN_TILE_BUDGET = 48 * 1024 * 1024;
/** The budget also scales with the viewport, or a huge desktop pane would thrash. */
const TILE_BUDGET_VIEWPORTS = 2.5;
const PREVIEW_BUDGET = 24 * 1024 * 1024;
/**
 * How far ink can reach past a stroke's centreline, in page px: half the
 * widest nib (size 12 × the highlighter's 4× scale). Tiles overlapping a
 * stroke by this much must draw it.
 */
const INK_PAD = 24;
/** Tiles this far (device px) beyond the viewport are rasterised ahead of a scroll. */
const PREFETCH_MARGIN = TILE_SIZE;
/** The page shadow: blur and downward offset, in CSS px. */
const SHADOW_BLUR = 14;
const SHADOW_OFFSET_Y = 3;

interface Tile {
  canvas: HTMLCanvasElement;
  pageId: string;
  level: number;
  rect: TileRect;
}

interface Preview {
  canvas: HTMLCanvasElement;
  scale: number;
}

interface PathEntry {
  fingerprint: string;
  path: Path2D | null;
  /** How `path` is painted (filled outline or stroked centreline). */
  ink: InkPath | null;
  /** Centreline bounds padded by the nib, so an overlap test is enough. */
  bounds: Bounds | null;
}

interface ShadowSprite {
  canvas: HTMLCanvasElement;
  /** Blur margin around the core, in device px. */
  margin: number;
  core: number;
  key: string;
}

/** One of the three stacked viewport canvases, and the context it is drawn through. */
interface Layer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

/** A canvas and its 2D context; `desynchronized` asks for the low-latency kind. */
function layerOf(canvas: HTMLCanvasElement, desynchronized: boolean): Layer {
  const context = canvas.getContext("2d", { desynchronized });
  if (context === null) throw new Error("FineNotes: this canvas has no 2D context");
  return { canvas, ctx: context };
}

/**
 * The selection's dashed line, 1.5 CSS px wide with 6 px dashes and 4 px
 * gaps at any zoom: `scale` is CSS px per unit of the space `ctx` is in.
 */
function selectionLine(ctx: CanvasRenderingContext2D, scale: number): void {
  ctx.strokeStyle = SELECTION_LINE;
  ctx.lineWidth = 1.5 / scale;
  ctx.setLineDash([6, 4].map((length) => length / scale));
}

/** Highlighter ink keeps one width: pressure never thins it. */
function pressureFor(tool: Tool, usePressure: boolean): boolean {
  return tool !== "highlighter" && usePressure;
}

/** Give the backing store back now; iOS holds canvas memory until then. */
function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

function overlaps(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export class Renderer {
  /** How opaque highlighter ink is drawn, 0..1. The surface sets it from the settings. */
  highlighterAlpha = DEFAULT_HIGHLIGHTER_ALPHA;
  /** Paper colours. Paper-white by default; a dark page is a notebook override. */
  paper: PaperTheme = LIGHT_PAPER;

  /** The desk and the page shadows. */
  private readonly backdrop: Layer;
  /** The pages, blitted from tiles. */
  private readonly dry: Layer;
  /** Whatever is in flight: a stroke, a lasso, a dragged selection or picture. */
  private readonly wet: Layer;
  /** The viewport canvases' size in CSS px, and device px per CSS px. */
  private screen = { width: 0, height: 0, dpr: 1 };
  /** The view, in layout space; see {@link setViewport}. */
  private view: ViewportState = { scrollY: 0, scale: 1, width: 0 };
  /** How far right of the canvases' left edge the layout's origin sits, in CSS px. */
  private originX = 0;
  private layout: DocumentLayout = EMPTY_LAYOUT;
  private painter: BackdropPainter | null = null;
  private imagePainter: ImagePainter | null = null;
  /**
   * Images left out of tiles and previews: one being dragged is drawn on the
   * wet layer instead, so a move re-rasterises nothing until it ends.
   */
  private hiddenImages: ReadonlySet<ImageElement> = new Set();
  /** Strokes (by id) left out of tiles and previews: a lasso selection being dragged. */
  private hiddenStrokes: ReadonlySet<string> = new Set();

  /** Device px per page px the tiles are rasterised at. 0 until the first frame. */
  private level = 0;
  private readonly tiles = new ByteLru<Tile>(MIN_TILE_BUDGET, (tile) => releaseCanvas(tile.canvas));
  private readonly previews = new ByteLru<Preview>(PREVIEW_BUDGET, (p) => releaseCanvas(p.canvas));
  private readonly paths = new WeakMap<Stroke, PathEntry>();
  private shadow: ShadowSprite | null = null;

  /**
   * `wetDesynchronized` asks for a low-latency context on the wet layer.
   * Only there: on iOS WebKit a desynchronized canvas can lose what it
   * shows once drawing stops, which the wet layer survives because every
   * pen sample redraws it, while committed ink on the dry layer would
   * disappear, or be left torn. So the backdrop and the dry layer never get
   * one.
   */
  constructor(
    backdrop: HTMLCanvasElement,
    dry: HTMLCanvasElement,
    wet: HTMLCanvasElement,
    wetDesynchronized: boolean,
  ) {
    this.backdrop = layerOf(backdrop, false);
    this.dry = layerOf(dry, false);
    this.wet = layerOf(wet, wetDesynchronized);
    // The same WebKit can fail to clear a desynchronized canvas to
    // transparent, and the wet layer lies over the dry one: it is shown only
    // while something is drawn on it, so a stale frame can never hide ink.
    this.setWetVisible(false);
  }

  /** Release every cached bitmap. The renderer is unusable afterwards. */
  destroy(): void {
    this.tiles.clear();
    this.previews.clear();
    if (this.shadow) releaseCanvas(this.shadow.canvas);
    this.shadow = null;
  }

  /** Size the three canvases to the pane: `width` x `height` CSS px at `dpr` device px each. */
  resize(width: number, height: number, dpr: number): void {
    this.screen = { width, height, dpr };
    // Never 0: a canvas of no size cannot be drawn into, and iOS reports one lost.
    const deviceWidth = Math.max(1, Math.round(width * dpr));
    const deviceHeight = Math.max(1, Math.round(height * dpr));
    for (const { canvas } of [this.backdrop, this.dry, this.wet]) {
      canvas.width = deviceWidth;
      canvas.height = deviceHeight;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    const viewportBytes = this.dry.canvas.width * this.dry.canvas.height * 4;
    this.tiles.setBudget(Math.max(MIN_TILE_BUDGET, TILE_BUDGET_VIEWPORTS * viewportBytes));
  }

  /**
   * What the canvases show: `view` is the scroll and scale in layout space,
   * and the layout's origin sits `originX` CSS px right of the canvases'
   * left edge (negative once the view has scrolled past it sideways).
   */
  setViewport(view: ViewportState, originX = 0): void {
    this.view = view;
    this.originX = originX;
  }

  /** The page stack this renderer is painting. */
  setLayout(layout: DocumentLayout): void {
    this.layout = layout;
  }

  /** The backdrop painter tiles draw pages with. Invalidates every tile. */
  setPainter(painter: BackdropPainter | null): void {
    this.painter = painter;
    this.invalidateAll();
  }

  /** The painter placed images are drawn with. Invalidates every tile. */
  setImagePainter(painter: ImagePainter | null): void {
    this.imagePainter = painter;
    this.invalidateAll();
  }

  /**
   * Leave these images out of every tile and preview rasterised from now on.
   * The caller invalidates the regions they cover, when they are hidden and
   * again when they come back (the ledger's rule for previews).
   */
  setHiddenImages(images: ReadonlySet<ImageElement>): void {
    this.hiddenImages = images;
  }

  /**
   * Leave these strokes out of every tile and preview rasterised from now on
   * — a lasso selection being dragged, drawn on the wet layer instead. Same
   * rule as {@link setHiddenImages}: the caller invalidates their regions.
   */
  setHiddenStrokes(ids: ReadonlySet<string>): void {
    this.hiddenStrokes = ids;
  }

  /** Device-pixel scale of one layout unit. Used to size PDF rasters. */
  get deviceScale(): number {
    return this.screen.dpr * this.view.scale;
  }

  /** CSS px per layout px, or 1 before there is a view. */
  private get safeScale(): number {
    return this.view.scale || 1;
  }

  /** The level tiles are rasterised at; see {@link settle}. */
  get tileLevel(): number {
    return this.level;
  }

  /** Whether the live zoom differs from the tiles' level (a pinch in flight). */
  get isTransient(): boolean {
    return this.level !== 0 && quantiseLevel(this.deviceScale) !== this.level;
  }

  stats(): RenderStats {
    return {
      level: this.level,
      tiles: this.tiles.size,
      tileBytes: this.tiles.bytes,
      previews: this.previews.size,
    };
  }

  // --- Cache invalidation ---------------------------------------------------

  /**
   * The zoom has settled: from now on tiles are rasterised at the live
   * scale, and tiles at any other level are released.
   */
  settle(): void {
    const level = quantiseLevel(this.deviceScale);
    if (level === this.level) return;
    this.level = level;
    this.tiles.deleteWhere((tile) => tile.level !== level);
  }

  invalidateAll(): void {
    this.tiles.clear();
    this.previews.clear();
  }

  invalidatePage(pageId: string): void {
    this.tiles.deleteWhere((tile) => tile.pageId === pageId);
    this.previews.delete(pageId);
  }

  /** A page-space rectangle changed (strokes erased, moved). */
  invalidateRegion(pageIndex: number, bounds: Bounds): void {
    const box = this.layout.boxes[pageIndex];
    if (!box || this.level === 0) return;
    for (const tr of tilesForBounds(box.width, box.height, this.level, bounds, INK_PAD)) {
      this.tiles.delete(tileKey(box.id, this.level, tr.col, tr.row));
    }
    this.previews.delete(box.id);
  }

  // --- Geometry -------------------------------------------------------------

  /** Draw on a viewport canvas in layout space from here on. */
  private toLayoutSpace(ctx: CanvasRenderingContext2D): void {
    const k = this.deviceScale;
    ctx.setTransform(k, 0, 0, k, this.originX * this.screen.dpr, -this.view.scrollY * k);
  }

  /** Clear a whole viewport canvas, whatever transform it was left in. */
  private wipe(ctx: CanvasRenderingContext2D): void {
    const { width, height, dpr } = this.screen;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, dpr * width, dpr * height);
  }

  /** Show the wet layer, or hide it (see the constructor). */
  private setWetVisible(visible: boolean): void {
    const classes = this.wet.canvas.classList;
    if (visible) classes.remove(WET_HIDDEN);
    else classes.add(WET_HIDDEN);
  }

  /** Layout-space band currently on screen. */
  private visibleBand(): { top: number; bottom: number } {
    const top = this.view.scrollY;
    return { top, bottom: top + this.screen.height / this.safeScale };
  }

  /**
   * The pages overlapping the band `[top, bottom]` (layout px) and the
   * visible columns widened by `marginX` layout px either side. The column
   * check matters when pages run across: a row of 200 pages shares one band.
   */
  private boxesInBand(pageCount: number, top: number, bottom: number, marginX = 0): PageBox[] {
    const scale = this.safeScale;
    const left = -this.originX / scale - marginX;
    const right = (this.screen.width - this.originX) / scale + marginX;
    const out: PageBox[] = [];
    for (const box of this.layout.boxes) {
      if (box.index >= pageCount) continue;
      if (box.y + box.height < top || box.y > bottom) continue;
      if (box.x + box.width < left || box.x > right) continue;
      out.push(box);
    }
    return out;
  }

  private boxesOnScreen(pageCount: number): PageBox[] {
    const { top, bottom } = this.visibleBand();
    return this.boxesInBand(pageCount, top, bottom);
  }

  /** A page's rectangle in device px of the viewport canvases. */
  private pageDeviceRect(box: PageBox): { x: number; y: number; w: number; h: number } {
    const k = this.deviceScale;
    return {
      x: (this.originX + box.x * this.view.scale) * this.screen.dpr,
      y: (box.y - this.view.scrollY) * k,
      w: box.width * k,
      h: box.height * k,
    };
  }

  /** Enter a page's local coordinate space, clipped to the sheet. */
  private enterPage(ctx: CanvasRenderingContext2D, box: PageBox): void {
    ctx.save();
    ctx.translate(box.x, box.y);
    ctx.beginPath();
    ctx.rect(0, 0, box.width, box.height);
    ctx.clip();
  }

  // --- Backdrop layer -------------------------------------------------------

  /** Repaint the backdrop layer: the desk, and a shadow under each visible page. */
  renderBackdrops(doc: InkDocument): void {
    const ctx = this.backdrop.ctx;
    // The desk. The page is an object lying on it, not a region filling the
    // pane (design brief), so the field is painted edge to edge first.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.paper.desk;
    ctx.fillRect(0, 0, this.dry.canvas.width, this.dry.canvas.height);
    const sprite = this.shadowSprite();
    for (const box of this.boxesOnScreen(doc.pages.length)) {
      const r = this.pageDeviceRect(box);
      this.drawShadow(ctx, sprite, r.x, r.y, r.w, r.h, SHADOW_OFFSET_Y * this.screen.dpr);
      // Under the page, the page's own colour (see paperColorOf).
      const page = doc.pages[box.index];
      ctx.fillStyle = page ? paperColorOf(page, this.paper) : this.paper.paper;
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
  }

  /**
   * The soft drop shadow is one small blurred square, drawn as nine slices.
   * Blurring a page-sized rectangle every frame was a measurable share of a
   * scroll frame on an iPad; blitting nine slices is not.
   */
  private shadowSprite(): ShadowSprite {
    const key = `${this.screen.dpr}|${this.paper.shadow}`;
    if (this.shadow && this.shadow.key === key) return this.shadow;
    if (this.shadow) releaseCanvas(this.shadow.canvas);
    const blur = Math.max(1, Math.round(SHADOW_BLUR * this.screen.dpr));
    const margin = blur * 2;
    const core = 8;
    const canvas = createEl("canvas");
    canvas.width = canvas.height = margin * 2 + core;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      // Only the shadow lands in the sprite: the square that casts it is
      // drawn off the canvas and its shadow shifted back on. A painted square
      // (it used to be paper-white) bled into the slices next to it wherever
      // they were drawn filtered, as a light seam under every page.
      const far = canvas.width * 2;
      ctx.shadowColor = this.paper.shadow;
      ctx.shadowBlur = blur;
      ctx.shadowOffsetX = far;
      ctx.fillStyle = "#000000";
      ctx.fillRect(margin - far, margin, core, core);
    }
    this.shadow = { canvas, margin, core, key };
    return this.shadow;
  }

  /**
   * The shadow of the page at `(x, y, w, h)`, cast `offset` device px down:
   * only the soft edges. The sprite's paper-coloured core used to be drawn
   * too, shifted down with them, which left a band of white paper `offset`
   * px tall under every page — invisible under white paper, a white line
   * under a coloured cover. The gap the
   * shift opens below the page is filled with the edge's own first row, so
   * the shadow runs on from the page without a seam.
   */
  private drawShadow(
    ctx: CanvasRenderingContext2D,
    sprite: ShadowSprite,
    x: number,
    pageY: number,
    w: number,
    h: number,
    offset: number,
  ): void {
    const y = pageY + offset;
    const { canvas, margin: m, core: c } = sprite;
    if (canvas.width === 0) return;
    const draw = (
      sx: number,
      sy: number,
      sw: number,
      sh: number,
      dx: number,
      dy: number,
      dw: number,
      dh: number,
    ): void => {
      if (dw <= 0 || dh <= 0) return;
      ctx.drawImage(canvas, sx, sy, sw, sh, dx, dy, dw, dh);
    };
    const right = m + c;
    draw(0, 0, m, m, x - m, y - m, m, m);
    draw(m, 0, c, m, x, y - m, w, m);
    draw(right, 0, m, m, x + w, y - m, m, m);
    draw(0, m, m, c, x - m, y, m, h);
    // No core: the caller fills the page's own rectangle with its paper.
    // The gap the offset opens below the page runs on from the edge slice.
    draw(m, right, c, 1, x, pageY + h, w, offset);
    draw(right, m, m, c, x + w, y, m, h);
    draw(0, right, m, m, x - m, y + h, m, m);
    draw(m, right, c, m, x, y + h, w, m);
    draw(right, right, m, m, x + w, y + h, m, m);
  }

  // --- Ink layer ------------------------------------------------------------

  /**
   * Repaint the dry layer from cached tiles, page- and viewport-culled.
   *
   * `budgetMs` bounds the time spent rasterising tiles that are not cached
   * yet; a frame in the middle of a fling passes a few ms, a repaint after
   * an edit passes `Infinity`. A tile the budget leaves unrasterised is drawn
   * from the page's preview, and rasterised regardless when there is none.
   * Returns whether everything on screen is drawn at full resolution.
   *
   * `hidden` strokes are skipped and `replaced` strokes are drawn as their
   * listed pieces (the eraser's live preview); the caller invalidates the
   * region they cover first, so the affected tiles rasterise afresh.
   */
  renderDocument(
    doc: InkDocument,
    usePressure: boolean,
    hidden?: ReadonlySet<string>,
    selection?: PageSelection | null,
    replaced?: ReadonlyMap<string, readonly Stroke[]>,
    budgetMs = Infinity,
  ): boolean {
    const ctx = this.dry.ctx;
    this.wipe(ctx);
    if (this.level === 0) this.level = quantiseLevel(this.deviceScale);
    const level = this.level;
    const k = this.deviceScale;
    const s = k / level;
    // At its own level a tile lands on whole device pixels: no seams, no resampling.
    const exact = Math.abs(s - 1) < 1e-3;
    ctx.imageSmoothingEnabled = !exact;
    // Mid-zoom the tiles' level is stale: nothing rasterised at it survives
    // the settle, so this frame draws what is cached and the stand-ins, and
    // spends no time making more.
    const transient = this.isTransient;
    const deadline = budgetMs === Infinity ? Infinity : now() + budgetMs;
    let complete = true;

    for (const box of this.boxesOnScreen(doc.pages.length)) {
      const page = doc.pages[box.index];
      const r = this.pageDeviceRect(box);
      const ox = exact ? Math.round(r.x) : r.x;
      const oy = exact ? Math.round(r.y) : r.y;
      const raster = rasterSize(box.width, box.height, level);
      const needed = tilesCovering(
        box.width,
        box.height,
        level,
        -ox / s,
        -oy / s,
        (this.dry.canvas.width - ox) / s,
        (this.dry.canvas.height - oy) / s,
      );

      let missing = 0;
      for (const tr of needed) {
        if (!this.tiles.has(tileKey(page.id, level, tr.col, tr.row))) missing++;
      }
      let preview = missing > 0 ? this.previews.get(page.id) : undefined;
      if (missing > 0 && !preview && transient) {
        // One whole-page stand-in beats tiles at a level about to be dropped.
        preview = this.buildPreview(page, box, usePressure) ?? undefined;
      }
      // Zoomed out far enough that the stand-in is the closer match in
      // resolution, it alone is drawn: minifying dozens of tiles a frame is
      // what made a fast pinch-out drop frames, and looked no sharper.
      const previewOnly =
        preview !== undefined &&
        transient &&
        Math.abs(Math.log(k / preview.scale)) < Math.abs(Math.log(s));
      if (preview) {
        // Blurry is better than blank while the tiles catch up.
        ctx.drawImage(preview.canvas, ox, oy, raster.w * s, raster.h * s);
      }

      for (const tr of needed) {
        if (previewOnly) break;
        const key = tileKey(page.id, level, tr.col, tr.row);
        let tile = this.tiles.get(key);
        if (!tile) {
          if (preview && (transient || now() > deadline)) {
            // A stale-level tile is never worth making; a missed deadline
            // asks for another frame.
            if (!transient) complete = false;
            continue;
          }
          tile = this.rasterTile(page, box, tr, level, usePressure, hidden, replaced) ?? undefined;
          if (!tile) continue;
        }
        if (exact) {
          ctx.drawImage(tile.canvas, ox + tr.x, oy + tr.y, tr.w, tr.h);
        } else {
          // Neighbouring tiles share each rounded edge, so scaling leaves no seams.
          const x0 = Math.round(ox + tr.x * s);
          const y0 = Math.round(oy + tr.y * s);
          const x1 = Math.round(ox + (tr.x + tr.w) * s);
          const y1 = Math.round(oy + (tr.y + tr.h) * s);
          ctx.drawImage(tile.canvas, x0, y0, x1 - x0, y1 - y0);
        }
      }

      if (selection && selection.pageIndex === box.index) {
        this.toLayoutSpace(ctx);
        this.enterPage(ctx, box);
        this.drawSelectionBox(ctx, selection.bounds, 8);
        ctx.restore();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
    }
    return complete;
  }

  /**
   * Rasterise tiles just outside the viewport, and the previews of the pages
   * on and around it, so a scroll finds them ready. Never evicts a tile to
   * make room, so it cannot thrash the ones on screen. Returns whether there
   * is more to do — the caller spreads the work over idle frames.
   */
  prefetch(doc: InkDocument, usePressure: boolean, budgetMs: number): boolean {
    if (this.level === 0 || this.layout.boxes.length === 0) return false;
    const level = this.level;
    const k = this.deviceScale;
    const s = k / level;
    const deadline = now() + budgetMs;
    const { top, bottom } = this.visibleBand();
    const marginLayout = PREFETCH_MARGIN / k;
    const around = this.boxesInBand(
      doc.pages.length,
      top - marginLayout,
      bottom + marginLayout,
      marginLayout,
    );

    for (const box of around) {
      const page = doc.pages[box.index];
      if (!this.previews.has(page.id)) {
        if (now() > deadline) return true;
        this.buildPreview(page, box, usePressure);
      }
    }
    for (const box of around) {
      const page = doc.pages[box.index];
      const r = this.pageDeviceRect(box);
      const ring = tilesCovering(
        box.width,
        box.height,
        level,
        (-PREFETCH_MARGIN - r.x) / s,
        (-PREFETCH_MARGIN - r.y) / s,
        (this.dry.canvas.width + PREFETCH_MARGIN - r.x) / s,
        (this.dry.canvas.height + PREFETCH_MARGIN - r.y) / s,
      );
      for (const tr of ring) {
        if (this.tiles.has(tileKey(page.id, level, tr.col, tr.row))) continue;
        if (!this.tiles.fits(tr.w * tr.h * 4)) return false;
        if (now() > deadline) return true;
        this.rasterTile(page, box, tr, level, usePressure);
      }
    }
    return false;
  }

  /** Paint one tile of a page: paper, backdrop, edge, then the ink that overlaps it. */
  private rasterTile(
    page: Page,
    box: PageBox,
    tr: TileRect,
    level: number,
    usePressure: boolean,
    hidden?: ReadonlySet<string>,
    replaced?: ReadonlyMap<string, readonly Stroke[]>,
  ): Tile | null {
    const canvas = createEl("canvas");
    canvas.width = tr.w;
    canvas.height = tr.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(level, 0, 0, level, -tr.x, -tr.y);
    this.paintPage(ctx, page, box, level, {
      minX: tr.x / level,
      minY: tr.y / level,
      maxX: (tr.x + tr.w) / level,
      maxY: (tr.y + tr.h) / level,
    });
    const region: Bounds = {
      minX: tr.x / level - INK_PAD,
      minY: tr.y / level - INK_PAD,
      maxX: (tr.x + tr.w) / level + INK_PAD,
      maxY: (tr.y + tr.h) / level + INK_PAD,
    };
    this.paintStrokes(ctx, page, region, usePressure, hidden, replaced);
    const tile: Tile = { canvas, pageId: page.id, level, rect: tr };
    this.tiles.set(tileKey(page.id, level, tr.col, tr.row), tile, tr.w * tr.h * 4);
    return tile;
  }

  /** The whole page at thumbnail resolution: the fallback while tiles catch up. */
  private buildPreview(page: Page, box: PageBox, usePressure: boolean): Preview | null {
    const scale = previewScale(box.width, box.height);
    const canvas = createEl("canvas");
    canvas.width = Math.max(1, Math.ceil(box.width * scale));
    canvas.height = Math.max(1, Math.ceil(box.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const all: Bounds = { minX: -Infinity, minY: -Infinity, maxX: Infinity, maxY: Infinity };
    this.paintPage(ctx, page, box, scale, all);
    this.paintStrokes(ctx, page, all, usePressure);
    const preview: Preview = { canvas, scale };
    this.previews.set(page.id, preview, canvas.width * canvas.height * 4);
    return preview;
  }

  /**
   * Paper, the page's backdrop, its placed images and its hairline edge, in
   * page space. Images sit above the backdrop and below the ink, so a photo
   * can be written over, as in GoodNotes; `region` culls the ones this tile
   * does not show.
   */
  private paintPage(
    ctx: CanvasRenderingContext2D,
    page: Page,
    box: PageBox,
    level: number,
    region: Bounds,
  ): void {
    ctx.beginPath();
    ctx.rect(0, 0, box.width, box.height);
    ctx.clip();
    ctx.fillStyle = paperColorOf(page, this.paper);
    ctx.fillRect(0, 0, box.width, box.height);
    // A 1 page-px rule vanishes at preview scale; keep rules about half a
    // device pixel wide there, as the sidebar thumbnails do.
    this.painter?.paint(ctx, page.backdrop, page.geometry, Math.max(1, 0.5 / level));
    this.paintImages(ctx, page, region, level);
    // Inset by half a device pixel so the hairline lies inside the clip.
    const hair = 1 / level;
    ctx.strokeStyle = this.paper.edge;
    ctx.lineWidth = hair;
    ctx.strokeRect(hair / 2, hair / 2, box.width - hair, box.height - hair);
  }

  /** The page's images that overlap `region`, bottom to top, at `level` device px per page px. */
  private paintImages(
    ctx: CanvasRenderingContext2D,
    page: Page,
    region: Bounds,
    level: number,
  ): void {
    const painter = this.imagePainter;
    if (!painter) return;
    for (const image of page.images) {
      if (this.hiddenImages.has(image)) continue;
      if (!overlaps(imageBounds(image), region)) continue;
      drawPlacedImage(ctx, image, painter, level);
    }
  }

  private paintStrokes(
    ctx: CanvasRenderingContext2D,
    page: Page,
    region: Bounds,
    usePressure: boolean,
    hidden?: ReadonlySet<string>,
    replaced?: ReadonlyMap<string, readonly Stroke[]>,
  ): void {
    for (const stroke of page.strokes) {
      if (hidden?.has(stroke.id) || this.hiddenStrokes.has(stroke.id)) continue;
      const pieces = replaced?.get(stroke.id);
      if (pieces) {
        for (const piece of pieces) this.paintEntry(ctx, piece, region, usePressure);
        continue;
      }
      this.paintEntry(ctx, stroke, region, usePressure);
    }
  }

  private paintEntry(
    ctx: CanvasRenderingContext2D,
    stroke: Stroke,
    region: Bounds,
    usePressure: boolean,
  ): void {
    const entry = this.pathEntry(stroke, usePressure);
    if (!entry.path || !entry.bounds || !overlaps(entry.bounds, region)) return;
    fillPath(ctx, entry.path, stroke, this.highlighterAlpha, entry.ink);
  }

  /**
   * The stroke's outline as a `Path2D`, outlined once. The fingerprint is
   * the point count and both end points, which changes under every edit the
   * commands make (a translation moves every point; an erase re-points).
   */
  private pathEntry(stroke: Stroke, usePressure: boolean): PathEntry {
    const pressure = pressureFor(stroke.tool, usePressure);
    const pts = stroke.pts;
    const n = pts.length;
    const fingerprint = `${pressure ? 1 : 0}|${n}|${pts[0]}|${pts[1]}|${pts[n - 3]}|${pts[n - 2]}`;
    const cached = this.paths.get(stroke);
    if (cached && cached.fingerprint === fingerprint) return cached;
    let path: Path2D | null = null;
    let ink: InkPath | null = null;
    let bounds: Bounds | null = null;
    if (n >= 3) {
      ink = inkPath(pts, penOptions(stroke.size, pressure), true, stroke.shape !== undefined);
      if (ink) path = new Path2D(ink.d);
      const b = strokeBounds(stroke);
      if (b) {
        const pad = stroke.size;
        bounds = { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
      }
    }
    const entry: PathEntry = { fingerprint, path, ink, bounds };
    this.paths.set(stroke, entry);
    return entry;
  }

  /** The selection box round `bounds`, `pad` page px outside it; `ctx` is in page space. */
  private drawSelectionBox(ctx: CanvasRenderingContext2D, bounds: Bounds, pad: number): void {
    const { minX, minY, maxX, maxY } = bounds;
    ctx.save();
    selectionLine(ctx, this.safeScale);
    ctx.strokeRect(minX - pad, minY - pad, maxX - minX + 2 * pad, maxY - minY + 2 * pad);
    ctx.restore();
  }

  /**
   * Draw the lasso being drawn (page space, flat `[x, y, …]`) on the wet
   * layer: a dashed loop closed back to its start, over a faint fill — the
   * same affordance colour as the selection box.
   */
  renderLasso(pageIndex: number, loop: readonly number[]): void {
    const box = this.layout.boxes[pageIndex];
    const ctx = this.wet.ctx;
    this.wipe(ctx);
    if (!box || loop.length < 4) return;
    this.toLayoutSpace(ctx);
    this.enterPage(ctx, box);
    ctx.beginPath();
    ctx.moveTo(loop[0], loop[1]);
    for (let i = 2; i + 1 < loop.length; i += 2) ctx.lineTo(loop[i], loop[i + 1]);
    ctx.closePath();
    ctx.fillStyle = SELECTION_FILL;
    // Even–odd, as the lasso's own hit rule reads a loop that crosses itself.
    ctx.fill("evenodd");
    selectionLine(ctx, this.safeScale);
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.restore();
    this.setWetVisible(true);
  }

  /**
   * Draw a lasso selection being dragged (page space) on the wet layer,
   * moved by (dx, dy): its images, then its ink over them, as the tiles
   * stack them. While it is dragged it is hidden from the tiles, so a move
   * costs one redraw of the selection per frame, from the cached outlines,
   * instead of re-rasterising every tile it crosses.
   */
  renderSelectionDraft(
    pageIndex: number,
    strokes: readonly Stroke[],
    images: readonly ImageElement[],
    dx: number,
    dy: number,
    usePressure: boolean,
  ): void {
    const box = this.layout.boxes[pageIndex];
    const ctx = this.wet.ctx;
    this.wipe(ctx);
    if (!box) return;
    this.toLayoutSpace(ctx);
    this.enterPage(ctx, box);
    ctx.translate(dx, dy);
    if (this.imagePainter) {
      for (const image of images) {
        drawPlacedImage(ctx, image, this.imagePainter, this.deviceScale);
      }
    }
    for (const stroke of strokes) {
      const entry = this.pathEntry(stroke, usePressure);
      if (entry.path) fillPath(ctx, entry.path, stroke, this.highlighterAlpha, entry.ink);
    }
    ctx.restore();
    this.setWetVisible(true);
  }

  /**
   * Paint a newly committed stroke into every cached tile (and the preview)
   * it overlaps, WITHOUT re-rasterising them. This keeps commit O(1) in the
   * page's stroke count: the O(n) full repaint was starving the main thread
   * (and dropping incoming pointer events) as a note filled up. The caller
   * then repaints the dry layer, which is a blit.
   */
  appendCommittedStroke(pageIndex: number, stroke: Stroke, usePressure: boolean): void {
    const box = this.layout.boxes[pageIndex];
    if (!box) return;
    const entry = this.pathEntry(stroke, usePressure);
    if (!entry.path || !entry.bounds) return;
    for (const tile of this.tiles.values()) {
      if (tile.pageId !== box.id || tile.level !== this.level) continue;
      const tr = tile.rect;
      const region: Bounds = {
        minX: tr.x / tile.level,
        minY: tr.y / tile.level,
        maxX: (tr.x + tr.w) / tile.level,
        maxY: (tr.y + tr.h) / tile.level,
      };
      if (!overlaps(entry.bounds, region)) continue;
      const ctx = tile.canvas.getContext("2d");
      if (!ctx) continue;
      ctx.save();
      ctx.setTransform(tile.level, 0, 0, tile.level, -tr.x, -tr.y);
      ctx.beginPath();
      ctx.rect(0, 0, box.width, box.height);
      ctx.clip();
      fillPath(ctx, entry.path, stroke, this.highlighterAlpha, entry.ink);
      ctx.restore();
    }
    const preview = this.previews.peek(box.id);
    const ctx = preview?.canvas.getContext("2d");
    if (preview && ctx) {
      ctx.save();
      ctx.setTransform(preview.scale, 0, 0, preview.scale, 0, 0);
      ctx.beginPath();
      ctx.rect(0, 0, box.width, box.height);
      ctx.clip();
      fillPath(ctx, entry.path, stroke, this.highlighterAlpha, entry.ink);
      ctx.restore();
    }
  }

  /** Draw the in-progress stroke (page space) on the wet layer. */
  renderWet(pageIndex: number, pts: number[], style: StrokeStyle): void {
    this.renderWetMany(pageIndex, [pts], style);
  }

  /**
   * Draw an image being moved, resized or rotated (page space) on the wet
   * layer. While it is dragged it is hidden from the tiles, so the gesture
   * costs one blit per frame instead of re-rasterising every tile it crosses;
   * it floats above the ink until the pen lifts, then drops back beneath it.
   */
  renderImageDraft(pageIndex: number, image: ImageElement): void {
    const box = this.layout.boxes[pageIndex];
    const ctx = this.wet.ctx;
    this.wipe(ctx);
    if (!box || !this.imagePainter) return;
    this.toLayoutSpace(ctx);
    this.enterPage(ctx, box);
    drawPlacedImage(ctx, image, this.imagePainter, this.deviceScale);
    ctx.restore();
    this.setWetVisible(true);
  }

  /**
   * Draw a picture being cropped (page space) on the wet layer: the whole
   * picture — `picture` is its uncropped box, with no `crop` of its own —
   * and, over it, a dark veil on everything the crop rectangle (fractions of
   * the picture) leaves out. The element itself is hidden from the tiles
   * meanwhile, as for a drag. The crop frame and its handles are DOM.
   */
  renderImageCropDraft(pageIndex: number, picture: ImageElement, crop: ImageCrop): void {
    const box = this.layout.boxes[pageIndex];
    const ctx = this.wet.ctx;
    this.wipe(ctx);
    if (!box || !this.imagePainter || !(picture.w > 0) || !(picture.h > 0)) return;
    this.toLayoutSpace(ctx);
    this.enterPage(ctx, box);
    drawPlacedImage(ctx, picture, this.imagePainter, this.deviceScale);
    const { w, h } = picture;
    ctx.translate(picture.x + w / 2, picture.y + h / 2);
    const rotation = rotationOf(picture);
    if (rotation !== 0) ctx.rotate(rotation);
    ctx.translate(-w / 2, -h / 2);
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.rect(crop.x * w, crop.y * h, crop.w * w, crop.h * h);
    ctx.fillStyle = CROP_VEIL;
    ctx.fill("evenodd");
    ctx.restore();
    this.setWetVisible(true);
  }

  /**
   * Draw several in-progress strokes at once on the wet layer — a table being
   * dragged out, which is an outline plus its row and column lines.
   */
  renderWetMany(pageIndex: number, strokes: readonly number[][], style: StrokeStyle): void {
    const box = this.layout.boxes[pageIndex];
    const ctx = this.wet.ctx;
    this.wipe(ctx);
    if (!box) return;
    this.toLayoutSpace(ctx);
    this.enterPage(ctx, box);
    for (const pts of strokes) fillStroke(ctx, pts, style, false, this.highlighterAlpha);
    ctx.restore();
    this.setWetVisible(true);
  }

  /** Nothing is in flight any more: empty the wet layer and hide it. */
  clearWet(): void {
    this.wipe(this.wet.ctx);
    this.setWetVisible(false);
  }
}

/** The style a stored stroke is drawn with, `pressure` being the user's setting. */
export function styleOf(stroke: Stroke, pressure: boolean): StrokeStyle {
  const { color, size, tool, shape } = stroke;
  return { color, size, tool, usePressure: pressure, shape: shape !== undefined };
}

/**
 * Paint a stroke whose path is already built, in whatever space `ctx` is
 * in: `ink` says whether to fill or stroke `path`, and without it the path
 * is filled.
 */
function fillPath(
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  style: { color: string; tool: Tool },
  highlighterAlpha: number,
  ink: InkPath | null = null,
): void {
  const highlighter = style.tool === "highlighter";
  ctx.save();
  if (highlighter) {
    ctx.globalAlpha = highlighterAlpha;
    ctx.globalCompositeOperation = HIGHLIGHTER_BLEND;
  }
  // Ink colour is absolute (contracts/design-brief.md): a stored colour is
  // painted exactly as stored. It is never remapped to suit the app theme —
  // that is how a note written on one device stays legible on another.
  ctx.fillStyle = style.color;
  if (ink) paintInk(ctx, ink, path);
  else ctx.fill(path);
  ctx.restore();
}

/**
 * Build one stroke's path from its points and paint it, in whatever space
 * `ctx` is in. `finished` is false for a stroke the pen is still drawing.
 */
function fillStroke(
  ctx: CanvasRenderingContext2D,
  points: number[],
  style: StrokeStyle,
  finished: boolean,
  highlighterAlpha: number,
): void {
  const pen = penOptions(style.size, pressureFor(style.tool, style.usePressure));
  const ink = inkPath(points, pen, finished, style.shape === true);
  if (ink) fillPath(ctx, new Path2D(ink.d), style, highlighterAlpha, ink);
}

export interface ThumbnailOptions {
  usePressure: boolean;
  highlighterAlpha?: number;
  paper?: PaperTheme;
  /** Draws the page's placed images; without one they are left out. */
  images?: ImagePainter;
}

/**
 * Paint one whole page — paper, backdrop, images, text boxes and ink — into `ctx`,
 * scaled so the page is `cssWidth` CSS px wide. The page-sidebar thumbnails
 * use this. It resizes the canvas itself, so the caller only picks a width.
 */
export function renderPageThumbnail(
  canvas: HTMLCanvasElement,
  page: Page,
  painter: BackdropPainter,
  cssWidth: number,
  dpr: number,
  options: ThumbnailOptions,
): void {
  const { width, height } = page.geometry;
  if (!(width > 0) || !(height > 0)) return;
  const k = (cssWidth / width) * dpr;
  canvas.width = Math.max(1, Math.round(width * k));
  canvas.height = Math.max(1, Math.round(height * k));
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = paperColorOf(page, options.paper ?? LIGHT_PAPER);
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Each axis scaled to the rounded canvas, so the page fills it exactly: at
  // the unrounded scale the last row or column was only partly painted and
  // showed the base through — a light line along a cover's bottom edge.
  ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();
  // A 1 page-px rule is about a tenth of a CSS pixel at thumbnail size and
  // would vanish; draw rules roughly half a CSS pixel wide instead.
  painter.paint(ctx, page.backdrop, page.geometry, Math.max(1, (0.5 * width) / cssWidth));
  if (options.images) {
    for (const image of page.images) drawPlacedImage(ctx, image, options.images, k);
  }

  for (const box of page.textBoxes) paintTextBox(ctx, box);

  const alpha = options.highlighterAlpha ?? DEFAULT_HIGHLIGHTER_ALPHA;
  for (const stroke of page.strokes) {
    fillStroke(ctx, stroke.pts, styleOf(stroke, options.usePressure), true, alpha);
  }
  ctx.restore();
}

/**
 * Paint one text box in page space: its fill, then its lines with the box's
 * font, alignment, line height and decorations. The line breaks come from
 * `text-layout.ts`, which follows the textarea's own rules, so a thumbnail
 * wraps where the page does. The font is a real family list from the model,
 * never `var(--…)`: canvas string properties do not resolve CSS variables.
 * Exported for its tests.
 */
export function paintTextBox(ctx: CanvasRenderingContext2D, box: TextBoxElement): void {
  if (!box.text && !box.fill) return;
  ctx.save();
  ctx.font = canvasFont(box, box.fontSize);
  const layout = layoutTextBox(box, (text) => ctx.measureText(text).width);
  if (box.fill) {
    ctx.fillStyle = box.fill;
    ctx.fillRect(box.x, box.y, box.w, layout.height);
  }
  if (box.text) {
    // A fixed-height box clips its overflow, as its textarea does.
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, layout.height);
    ctx.clip();
    ctx.fillStyle = box.color;
    ctx.textBaseline = "alphabetic";
    const metrics = ctx.measureText("Hg");
    // Older WebKit lacks the font-box metrics; fall back to typical proportions.
    const ascent = finiteOr(metrics.fontBoundingBoxAscent, box.fontSize * 0.8);
    const descent = finiteOr(metrics.fontBoundingBoxDescent, box.fontSize * 0.2);
    const baseline = baselineOffset(layout.lineBox, ascent, descent);
    const deco = decorationMetrics(box.fontSize);
    layout.lines.forEach((line, i) => {
      const y = layout.y + i * layout.lineBox + baseline;
      for (const run of line.runs) ctx.fillText(run.text, layout.x + run.x, y);
      if (line.runs.length === 0) return;
      const width = line.right - line.left;
      if (box.underline) {
        ctx.fillRect(layout.x + line.left, y + deco.underline, width, deco.thickness);
      }
      if (box.strike) ctx.fillRect(layout.x + line.left, y + deco.strike, width, deco.thickness);
    });
  }
  ctx.restore();
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}
