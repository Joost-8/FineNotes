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
 * Tracing a stroke (`ink/freehand.ts`) is work, so each stroke's runs and
 * their `Path2D`s are cached against a fingerprint of its points: a moved or
 * re-pointed stroke is traced again, an untouched one never is.
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
import { LIGHT_PAPER, type PaperTheme, pageLook, shownColor } from "./backdrop";
import {
  DAY_HIGHLIGHTER_BLEND,
  NIGHT_HIGHLIGHTER_BLEND,
  nightColor,
  nightHighlighter,
} from "./night";
import { type InkRun, type PenOptions, inkRuns, penOptions, traceRun } from "../ink/freehand";
import {
  type Backdrop,
  type Bounds,
  type ImageCrop,
  type ImageElement,
  type InkDocument,
  type Page,
  type PageGeometry,
  type ArrowHeads,
  type ShapeDash,
  type ShapeKind,
  type Stroke,
  type GraphElement,
  type TableElement,
  type TextBoxElement,
  type Tool,
  strokeBounds,
} from "../model/document";
import {
  type CellRef,
  type TableLayout,
  cellFill,
  cellStyle,
  layoutTable,
  tableLayoutKey,
} from "./table-layout";
import { imageBounds, rotationOf } from "./image-geometry";
import { paintGraph } from "./graph-paint";
import { graphBounds } from "../model/graph";
import type { DocumentLayout, PageBox } from "./page-layout";
import {
  baselineOffset,
  canvasFont,
  cornerRadiusOf,
  decorationMetrics,
  layoutTextBox,
  traceBoxPath,
  type TextBoxLayout,
} from "./text-layout";
import type { TextStyle } from "../model/text-style";
import { displayText } from "../model/text-links";
import { normalizeBorder, shownCase } from "../model/text-style";
import { canFill, canRound, isClosedLoop, splitFill } from "../model/shape-style";
import { type PageTexts, furnitureText } from "../model/furniture";
import {
  HEAD_MAX,
  type OutlineOp,
  arrowHead,
  dashPattern,
  outlineOps,
  pointsOf,
} from "./shape-decor";
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
  /** A shape's fill, dash, corners and arrowheads, when it has any. */
  decor?: ShapeDecor | null;
  /** A flat calligraphy nib's angle, degrees; absent for a round nib. */
  nib?: number;
}

/** What a shape is drawn with beyond its colour and width (`model/shape-style`). */
export interface ShapeDecor {
  kind: ShapeKind;
  fill?: string;
  dash?: ShapeDash;
  radius?: number;
  heads?: ArrowHeads;
}

/** A stroke's decor, or `null` when it is drawn as plain ink. */
export function decorOf(stroke: {
  shape?: ShapeKind;
  fill?: string;
  dash?: ShapeDash;
  radius?: number;
  heads?: ArrowHeads;
}): ShapeDecor | null {
  const kind = stroke.shape;
  if (kind === undefined) return null;
  const fill = canFill(kind) ? stroke.fill : undefined;
  const radius =
    canRound(kind) && stroke.radius !== undefined && stroke.radius > 0 ? stroke.radius : undefined;
  const heads =
    kind === "line" && (stroke.heads?.start || stroke.heads?.end) ? stroke.heads : undefined;
  if (!fill && !stroke.dash && !radius && !heads) return null;
  return {
    kind,
    ...(fill ? { fill } : {}),
    ...(stroke.dash ? { dash: stroke.dash } : {}),
    ...(radius ? { radius } : {}),
    ...(heads ? { heads } : {}),
  };
}

/** Header and page-number type: a real family list (canvas reads no CSS variables). */
const FURNITURE_FONT = '13px "Helvetica Neue", Helvetica, Arial, sans-serif';
/** How far the header and footer sit from the page's top and bottom edges, page px. */
const FURNITURE_MARGIN = 26;

/**
 * Print a page's header and page number (`model/furniture`) in a quiet
 * grey, in page space: the header top left, the number bottom centre or
 * right. Paper furniture, so it is drawn under the ink.
 */
export function paintFurniture(
  ctx: CanvasRenderingContext2D,
  geometry: PageGeometry,
  texts: PageTexts,
  night: boolean,
): void {
  if (!texts.header && !texts.footer) return;
  ctx.save();
  ctx.font = FURNITURE_FONT;
  ctx.fillStyle = night ? "#8b8f97" : "#9aa0a8";
  ctx.textBaseline = "middle";
  const side = Math.max(24, geometry.width * 0.06);
  if (texts.header) {
    ctx.textAlign = "left";
    ctx.fillText(texts.header, side, FURNITURE_MARGIN, geometry.width - 2 * side);
  }
  if (texts.footer) {
    const right = texts.align === "right";
    ctx.textAlign = right ? "right" : "center";
    ctx.fillText(
      texts.footer,
      right ? geometry.width - side : geometry.width / 2,
      geometry.height - FURNITURE_MARGIN,
    );
  }
  ctx.restore();
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
  /** Called once per screen paint, never once per ink tile or sidebar thumbnail. */
  prepare?: (
    visible: Array<{ backdrop: Backdrop; geometry: PageGeometry; region: Bounds }>,
    deviceScale: number,
    zoom: number,
    /** The zoom is mid-change: the level is not settled. */
    transient: boolean,
    /** The view is moving (or rested less than `REST_MS` ago). */
    moving?: boolean,
  ) => void;
  /**
   * `weight` thickens synthetic rules for a small thumbnail (default 1).
   * `target.paper` is the paper theme the caller paints the rest of the page
   * in (light or dark pages), so backdrop and ink always agree; without it,
   * the painter's own.
   */
  paint(
    ctx: CanvasRenderingContext2D,
    backdrop: Backdrop,
    geometry: PageGeometry,
    weight?: number,
    target?: { deviceScale: number; region?: Bounds; paper?: PaperTheme },
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
 * Draw one placed image in page space: translate to its centre, rotate,
 * mirror it when flipped, and hand the painter its unrotated box. Shared by
 * the tiles, the page preview, the wet-layer drag preview and the sidebar
 * thumbnails. The painter draws the crop into that box as usual; the mirror
 * applies to what it drew, which is why a stored crop stays in fractions of
 * the source file.
 */
export function drawPlacedImage(
  ctx: CanvasRenderingContext2D,
  image: ImageElement,
  painter: ImagePainter,
  deviceScale: number,
): void {
  if (!(image.w > 0) || !(image.h > 0)) return;
  ctx.save();
  if (image.opacity !== undefined) ctx.globalAlpha *= image.opacity;
  ctx.translate(image.x + image.w / 2, image.y + image.h / 2);
  const rotation = rotationOf(image);
  if (rotation !== 0) ctx.rotate(rotation);
  if (image.flipX === true || image.flipY === true) {
    ctx.scale(image.flipX === true ? -1 : 1, image.flipY === true ? -1 : 1);
  }
  ctx.translate(-image.w / 2, -image.h / 2);
  painter.paintImage(ctx, image, deviceScale);
  ctx.restore();
}

/**
 * The colour a page's paper is: its backdrop's `paperColor` (a cover's
 * cloth, a coloured paper), else the theme's paper; with dark pages, as
 * `pageLook` shows it. Whatever lies under the page, or is filled before its
 * backdrop, is this colour — so an edge pixel the page only partly covers
 * blends with its own paper. White there drew a light line along a cover's
 * edges (Joost, 2026-09-24).
 */
export function paperColorOf(page: Page, theme: PaperTheme): string {
  return pageLook(page.backdrop, theme).paper;
}

/**
 * Paint a stroke's runs (`inkRuns`) in the context's current `fillStyle`:
 * each one a line of its own width, round at the caps and the joins, drawn
 * by the canvas's stroke so a line that crosses itself is still one shape.
 * `paths` are the runs' cached `Path2D`s, when there are any.
 */
export function paintInk(
  ctx: CanvasRenderingContext2D,
  runs: readonly InkRun[],
  paths?: readonly Path2D[],
): void {
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  runs.forEach((run, i) => {
    ctx.lineWidth = run.width;
    ctx.stroke(paths?.[i] ?? pathOf(run));
  });
}

/** A run's polyline as a `Path2D`. */
export function pathOf(run: InkRun): Path2D {
  const path = new Path2D();
  traceRun(path, run);
  return path;
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
  /** The points array traced: a command that replaces it is always a change. */
  pts: readonly number[];
  /** The stroke's runs, and a `Path2D` for each. */
  runs: InkRun[];
  paths: Path2D[];
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

/** The pen a stroke of this style is traced with. */
export function penFor(style: {
  size: number;
  tool: Tool;
  usePressure: boolean;
  nib?: number;
}): PenOptions {
  return penOptions(style.size, pressureFor(style.tool, style.usePressure), style.nib);
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
  /**
   * Paper colours. Paper-white by default; dark pages are a view setting,
   * and whoever changes this must {@link invalidateAll}: tiles hold colour.
   */
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
  private pdfZoom = 1;
  private view: ViewportState = { scrollY: 0, scale: 1, width: 0 };
  /** How far right of the canvases' left edge the layout's origin sits, in CSS px. */
  private originX = 0;
  private layout: DocumentLayout = EMPTY_LAYOUT;
  /** The document last painted: the wet layer reads its pages' look from it. */
  private doc: InkDocument | null = null;
  /** What a header's `{title}` becomes: the notebook's name. */
  notebookTitle = "";
  private painter: BackdropPainter | null = null;
  private imagePainter: ImagePainter | null = null;
  /**
   * Images left out of tiles and previews: one being dragged is drawn on the
   * wet layer instead, so a move re-rasterises nothing until it ends.
   */
  private hiddenImages: ReadonlySet<ImageElement> = new Set();
  /** Strokes (by id) left out of tiles and previews: a lasso selection being dragged. */
  private hiddenStrokes: ReadonlySet<string> = new Set();
  /** Tables left out of tiles and previews: a lasso selection being dragged. */
  private hiddenTables: ReadonlySet<TableElement> = new Set();
  /** Graphs left out of tiles and previews: a lasso selection being dragged, or one being explored. */
  private hiddenGraphs: ReadonlySet<GraphElement> = new Set();
  /** The cell being typed in, whose text its textarea shows instead. */
  private editingCell: { table: TableElement; cell: CellRef } | null = null;

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
  setViewport(view: ViewportState, originX = 0, pdfZoom = 1): void {
    this.pdfZoom = pdfZoom;
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

  /** Leave these tables out of tiles and previews; as above, the caller invalidates. */
  setHiddenTables(tables: ReadonlySet<TableElement>): void {
    this.hiddenTables = tables;
  }

  /** Leave these graphs out of tiles and previews; as above, the caller invalidates. */
  setHiddenGraphs(graphs: ReadonlySet<GraphElement>): void {
    this.hiddenGraphs = graphs;
  }

  /**
   * Leave the text of this cell out of the tiles (`null`: none): it is
   * being typed in, and its textarea shows it. The caller invalidates the
   * table's region when this changes.
   */
  setEditingCell(editing: { table: TableElement; cell: CellRef } | null): void {
    this.editingCell = editing;
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
    this.doc = doc;
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
    detailTransient = false,
  ): boolean {
    this.doc = doc;
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

    const visibleBoxes = this.boxesOnScreen(doc.pages.length);
    this.painter?.prepare?.(
      visibleBoxes.map((box) => {
        const page = doc.pages[box.index];
        const r = this.pageDeviceRect(box);
        return {
          backdrop: page.backdrop,
          geometry: page.geometry,
          region: {
            minX: -r.x / k,
            minY: -r.y / k,
            maxX: (this.dry.canvas.width - r.x) / k,
            maxY: (this.dry.canvas.height - r.y) / k,
          },
        };
      }),
      level,
      this.pdfZoom,
      transient,
      detailTransient,
    );
    for (const box of visibleBoxes) {
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
    this.paintImages(ctx, page, region, level, true);
    const tile: Tile = { canvas, pageId: page.id, level, rect: tr };
    this.tiles.set(tileKey(page.id, level, tr.col, tr.row), tile, tr.w * tr.h * 4);
    return tile;
  }

  /**
   * The eyedropper's sample: a square of `size` device px of a page, its
   * top-left corner at device px (`x`, `y`) of the page drawn at `level`
   * device px per page px, painted afresh (paper, backdrop, pictures, ink)
   * and read back as RGBA. Always on the day's paper, whatever the view
   * shows: dark pages invert only what is painted, and the eyedropper picks
   * the note's own colours (`./eyedropper`). `null` where a canvas cannot be
   * read.
   */
  samplePage(
    page: Page,
    box: PageBox,
    square: { x: number; y: number; size: number },
    level: number,
    usePressure: boolean,
  ): Uint8ClampedArray | null {
    const canvas = createEl("canvas");
    canvas.width = square.size;
    canvas.height = square.size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx || !(level > 0)) return null;
    ctx.setTransform(level, 0, 0, level, -square.x, -square.y);
    const region: Bounds = {
      minX: square.x / level,
      minY: square.y / level,
      maxX: (square.x + square.size) / level,
      maxY: (square.y + square.size) / level,
    };
    const theme = this.paper;
    this.paper = LIGHT_PAPER;
    try {
      this.paintPage(ctx, page, box, level, region);
      const inked: Bounds = {
        minX: region.minX - INK_PAD,
        minY: region.minY - INK_PAD,
        maxX: region.maxX + INK_PAD,
        maxY: region.maxY + INK_PAD,
      };
      this.paintStrokes(ctx, page, inked, usePressure);
      this.paintImages(ctx, page, region, level, true);
    } finally {
      this.paper = theme;
    }
    try {
      return ctx.getImageData(0, 0, square.size, square.size).data;
    } catch {
      // A picture from elsewhere taints the canvas; there is nothing to read.
      return null;
    }
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
    this.paintImages(ctx, page, all, scale, true);
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
    this.painter?.paint(ctx, page.backdrop, page.geometry, Math.max(1, 0.5 / level), {
      deviceScale: level,
      paper: this.paper,
      ...(Number.isFinite(region.minX) ? { region } : {}),
    });
    if (this.doc) {
      const texts = furnitureText(this.doc, box.index, this.notebookTitle);
      paintFurniture(ctx, page.geometry, texts, pageLook(page.backdrop, this.paper).night);
    }
    this.paintImages(ctx, page, region, level);
    this.paintTables(ctx, page, region);
    this.paintGraphs(ctx, page, region, level);
    // Inset by half a device pixel so the hairline lies inside the clip.
    const hair = 1 / level;
    ctx.strokeStyle = this.paper.edge;
    ctx.lineWidth = hair;
    ctx.strokeRect(hair / 2, hair / 2, box.width - hair, box.height - hair);
  }

  /**
   * The page's images that overlap `region`, bottom to top, at `level`
   * device px per page px: those under the ink, or with `front` those in
   * front of it.
   */
  private paintImages(
    ctx: CanvasRenderingContext2D,
    page: Page,
    region: Bounds,
    level: number,
    front = false,
  ): void {
    const painter = this.imagePainter;
    if (!painter) return;
    for (const image of page.images) {
      if ((image.front === true) !== front) continue;
      if (this.hiddenImages.has(image)) continue;
      if (!overlaps(imageBounds(image), region)) continue;
      drawPlacedImage(ctx, image, painter, level);
    }
  }

  /** The page's tables that overlap `region`, under the ink, as every render stacks them. */
  private paintTables(ctx: CanvasRenderingContext2D, page: Page, region: Bounds): void {
    if (!page.tables || page.tables.length === 0) return;
    const night = pageLook(page.backdrop, this.paper).night;
    for (const table of page.tables) {
      if (this.hiddenTables.has(table)) continue;
      const layout = tableLayoutOf(table, ctx);
      const pad = table.size;
      const bounds: Bounds = {
        minX: layout.x - pad,
        minY: layout.y - pad,
        maxX: layout.x + layout.w + pad,
        maxY: layout.y + layout.h + pad,
      };
      if (!overlaps(bounds, region)) continue;
      const editing = this.editingCell?.table === table ? this.editingCell.cell : null;
      paintTable(ctx, table, night, editing, layout);
    }
  }

  /**
   * The page's graphs that overlap `region`, over the tables and under the
   * ink. Each draws from its cached curves (`graph-paint`), so a tile costs
   * a few path strokes once a graph has been sampled at this level.
   */
  private paintGraphs(
    ctx: CanvasRenderingContext2D,
    page: Page,
    region: Bounds,
    level: number,
  ): void {
    if (!page.graphs || page.graphs.length === 0) return;
    const night = pageLook(page.backdrop, this.paper).night;
    const paper = paperColorOf(page, this.paper);
    for (const graph of page.graphs) {
      if (this.hiddenGraphs.has(graph)) continue;
      if (!overlaps(padBounds(graphBounds(graph), 1), region)) continue;
      paintGraph(ctx, graph, { level, night, paper });
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
    const night = pageLook(page.backdrop, this.paper).night;
    for (const stroke of page.strokes) {
      if (hidden?.has(stroke.id) || this.hiddenStrokes.has(stroke.id)) continue;
      const pieces = replaced?.get(stroke.id);
      if (pieces) {
        for (const piece of pieces) this.paintEntry(ctx, piece, region, usePressure, night);
        continue;
      }
      this.paintEntry(ctx, stroke, region, usePressure, night);
    }
  }

  private paintEntry(
    ctx: CanvasRenderingContext2D,
    stroke: Stroke,
    region: Bounds,
    usePressure: boolean,
    night: boolean,
  ): void {
    const entry = this.pathEntry(stroke, usePressure);
    if (entry.runs.length === 0 || !entry.bounds || !overlaps(entry.bounds, region)) return;
    paintStroke(ctx, entry, stroke, this.highlighterAlpha, night, decorOf(stroke), stroke.pts);
  }

  /** Whether page `pageIndex` of the document last painted is shown inverted (`pageLook`). */
  private nightAt(pageIndex: number): boolean {
    const page = this.doc?.pages[pageIndex];
    return page ? pageLook(page.backdrop, this.paper).night : false;
  }

  /**
   * The stroke's runs and their `Path2D`s, traced once. They are reused
   * only for the same points array with the same fingerprint (the width, the
   * point count and both end points). Every command gives a stroke a new
   * array, which is what catches a turn or a mirror about a centre that one
   * of its ends sits on: a figure eight started from its middle and turned
   * keeps both ends, its count and its width. The fingerprint still catches
   * an array edited in place.
   */
  private pathEntry(stroke: Stroke, usePressure: boolean): PathEntry {
    const pressure = pressureFor(stroke.tool, usePressure);
    const pts = stroke.pts;
    const n = pts.length;
    const fingerprint = `${pressure ? 1 : 0}|${stroke.size}|${stroke.nib ?? ""}|${n}|${pts[0]}|${pts[1]}|${pts[n - 3]}|${pts[n - 2]}`;
    const cached = this.paths.get(stroke);
    if (cached && cached.pts === pts && cached.fingerprint === fingerprint) return cached;
    let runs: InkRun[] = [];
    let bounds: Bounds | null = null;
    if (n >= 3) {
      runs = inkRuns(
        pts,
        penOptions(stroke.size, pressure, stroke.nib),
        stroke.shape !== undefined,
      );
      const b = strokeBounds(stroke);
      if (b) {
        // Arrowheads reach sideways past the line's ends.
        const pad = stroke.size + (stroke.heads ? HEAD_MAX / 2 : 0);
        bounds = { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
      }
    }
    const entry: PathEntry = { fingerprint, pts, runs, paths: runs.map(pathOf), bounds };
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
   * instead of re-rasterising every tile it crosses. A resize passes
   * `scale`: the same outlines drawn `k` times the size about (x, y), which
   * is what `ScaleElements` commits (ink width scales with the ink). A turn
   * passes `turn`: the outlines turned `angle` radians clockwise about
   * (x, y), which is what `ReorientElements` commits for the ink and the
   * pictures (text boxes are DOM, and stay upright).
   */
  renderSelectionDraft(
    pageIndex: number,
    strokes: readonly Stroke[],
    images: readonly ImageElement[],
    dx: number,
    dy: number,
    usePressure: boolean,
    scale?: { x: number; y: number; k: number },
    turn?: { x: number; y: number; angle: number },
    tables: readonly TableElement[] = [],
    graphs: readonly GraphElement[] = [],
  ): void {
    const box = this.layout.boxes[pageIndex];
    const ctx = this.wet.ctx;
    this.wipe(ctx);
    if (!box) return;
    this.toLayoutSpace(ctx);
    this.enterPage(ctx, box);
    // A table stays upright under a turn (its middle goes round, as
    // `ReorientElements` commits), so it is drawn before the turn is applied.
    const night = this.nightAt(pageIndex);
    if (graphs.length > 0) {
      // Upright as well, like a table: its middle goes round under a turn.
      const page = this.doc?.pages[pageIndex];
      const paper = page ? paperColorOf(page, this.paper) : this.paper.paper;
      ctx.save();
      ctx.translate(dx, dy);
      if (scale && scale.k > 0 && Number.isFinite(scale.k)) {
        ctx.translate(scale.x, scale.y);
        ctx.scale(scale.k, scale.k);
        ctx.translate(-scale.x, -scale.y);
      }
      for (const graph of graphs) {
        ctx.save();
        if (turn && Number.isFinite(turn.angle) && turn.angle !== 0) {
          const cx = graph.x + graph.w / 2;
          const cy = graph.y + graph.h / 2;
          const c = Math.cos(turn.angle);
          const s = Math.sin(turn.angle);
          const tx = turn.x + (cx - turn.x) * c - (cy - turn.y) * s;
          const ty = turn.y + (cx - turn.x) * s + (cy - turn.y) * c;
          ctx.translate(tx - cx, ty - cy);
        }
        paintGraph(ctx, graph, { level: this.deviceScale, night, paper });
        ctx.restore();
      }
      ctx.restore();
    }
    if (tables.length > 0) {
      ctx.save();
      ctx.translate(dx, dy);
      if (scale && scale.k > 0 && Number.isFinite(scale.k)) {
        ctx.translate(scale.x, scale.y);
        ctx.scale(scale.k, scale.k);
        ctx.translate(-scale.x, -scale.y);
      }
      for (const table of tables) {
        const layout = tableLayoutOf(table, ctx);
        if (turn && Number.isFinite(turn.angle) && turn.angle !== 0) {
          const cx = layout.x + layout.w / 2;
          const cy = layout.y + layout.h / 2;
          const c = Math.cos(turn.angle);
          const s = Math.sin(turn.angle);
          const tx = turn.x + (cx - turn.x) * c - (cy - turn.y) * s;
          const ty = turn.y + (cx - turn.x) * s + (cy - turn.y) * c;
          ctx.save();
          ctx.translate(tx - cx, ty - cy);
          paintTable(ctx, table, night, null, layout);
          ctx.restore();
        } else paintTable(ctx, table, night, null, layout);
      }
      ctx.restore();
    }
    ctx.translate(dx, dy);
    if (scale && scale.k > 0 && Number.isFinite(scale.k)) {
      ctx.translate(scale.x, scale.y);
      ctx.scale(scale.k, scale.k);
      ctx.translate(-scale.x, -scale.y);
    }
    if (turn && Number.isFinite(turn.angle) && turn.angle !== 0) {
      ctx.translate(turn.x, turn.y);
      ctx.rotate(turn.angle);
      ctx.translate(-turn.x, -turn.y);
    }
    const pictures = (front: boolean): void => {
      if (!this.imagePainter) return;
      for (const image of images) {
        if ((image.front === true) !== front) continue;
        drawPlacedImage(ctx, image, this.imagePainter, this.deviceScale);
      }
    };
    pictures(false);
    for (const stroke of strokes) {
      const entry = this.pathEntry(stroke, usePressure);
      paintStroke(ctx, entry, stroke, this.highlighterAlpha, night, decorOf(stroke), stroke.pts);
    }
    pictures(true);
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
    if (entry.runs.length === 0 || !entry.bounds) return;
    // Under a picture in front of the ink, the stroke cannot simply be drawn
    // on top of the cached tiles: redraw that part of the page instead.
    const bounds = entry.bounds;
    const page = this.doc?.pages[pageIndex];
    if (
      page?.images.some((image) => image.front === true && overlaps(imageBounds(image), bounds))
    ) {
      this.invalidateRegion(pageIndex, bounds);
      return;
    }
    const night = this.nightAt(pageIndex);
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
      paintStroke(ctx, entry, stroke, this.highlighterAlpha, night, decorOf(stroke), stroke.pts);
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
      paintStroke(ctx, entry, stroke, this.highlighterAlpha, night, decorOf(stroke), stroke.pts);
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
    const night = this.nightAt(pageIndex);
    for (const pts of strokes) fillStroke(ctx, pts, style, this.highlighterAlpha, night);
    ctx.restore();
    this.setWetVisible(true);
  }

  /**
   * Draw strokes that are not committed yet, each in its own style, on the
   * wet layer: a highlight snapped to a PDF's text, a stroke a line, while
   * the pen drags it out.
   */
  renderWetStrokes(pageIndex: number, strokes: readonly Stroke[]): void {
    const box = this.layout.boxes[pageIndex];
    const ctx = this.wet.ctx;
    this.wipe(ctx);
    if (!box) return;
    this.toLayoutSpace(ctx);
    this.enterPage(ctx, box);
    const night = this.nightAt(pageIndex);
    for (const stroke of strokes) {
      fillStroke(ctx, stroke.pts, styleOf(stroke, false), this.highlighterAlpha, night);
    }
    ctx.restore();
    this.setWetVisible(true);
  }

  /**
   * Draw the handwriting being written, already traced into `runs` (page
   * space), on the wet layer, painted as a stored stroke of `style` is.
   */
  renderWetRuns(pageIndex: number, runs: readonly InkRun[], style: StrokeStyle): void {
    const box = this.layout.boxes[pageIndex];
    const ctx = this.wet.ctx;
    this.wipe(ctx);
    if (!box) return;
    this.toLayoutSpace(ctx);
    this.enterPage(ctx, box);
    paintStroke(ctx, { runs }, style, this.highlighterAlpha, this.nightAt(pageIndex));
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
  return {
    color,
    size,
    tool,
    usePressure: pressure,
    shape: shape !== undefined,
    decor: decorOf(stroke),
    ...(stroke.nib !== undefined ? { nib: stroke.nib } : {}),
  };
}

/**
 * Paint a stroke's runs in its colour, in whatever space `ctx` is in; a
 * highlighter translucent, multiplied into light paper and screened onto a
 * night page (`./night`). A highlighter keeps one width, so it is always one
 * run: its overlaps are never painted twice.
 */
function paintStroke(
  ctx: CanvasRenderingContext2D,
  ink: { runs: readonly InkRun[]; paths?: readonly Path2D[] },
  style: { color: string; tool: Tool },
  highlighterAlpha: number,
  night = false,
  decor: ShapeDecor | null = null,
  pts?: readonly number[],
): void {
  const highlighter = style.tool === "highlighter";
  ctx.save();
  if (highlighter) {
    ctx.globalAlpha = highlighterAlpha;
    ctx.globalCompositeOperation = night ? NIGHT_HIGHLIGHTER_BLEND : DAY_HIGHLIGHTER_BLEND;
  }
  // Ink colour is absolute (contracts/design-brief.md): a stored colour is
  // never changed, and never remapped to suit the app theme — that is how a
  // note written on one device stays legible on another. Only a night page
  // (dark pages, the view setting) *shows* it through `./night`'s mapping.
  if (!night) ctx.fillStyle = style.color;
  else ctx.fillStyle = highlighter ? nightHighlighter(style.color) : nightColor(style.color);
  if (decor && pts && ink.runs.length > 0) paintShape(ctx, pts, ink.runs[0].width, decor, night);
  else paintInk(ctx, ink.runs, ink.paths);
  ctx.restore();
}

/** Outline operations as a `Path2D`. */
function pathFromOps(ops: readonly OutlineOp[]): Path2D {
  const path = new Path2D();
  for (const o of ops) {
    if (o.op === "M") path.moveTo(o.x, o.y);
    else if (o.op === "L") path.lineTo(o.x, o.y);
    else if (o.op === "A") path.arcTo(o.x1, o.y1, o.x2, o.y2, o.r);
    else path.closePath();
  }
  return path;
}

/**
 * Paint a styled shape in the context's current `fillStyle` (its ink
 * colour): the fill under the outline, then the outline, dashed or dotted
 * when it is, then its arrowheads, solid. `width` is the width plain ink of
 * this stroke is drawn at, so a styled shape is exactly as heavy.
 */
function paintShape(
  ctx: CanvasRenderingContext2D,
  pts: readonly number[],
  width: number,
  decor: ShapeDecor,
  night: boolean,
): void {
  const ink = ctx.fillStyle;
  const closed = isClosedLoop(pts);
  let line = pts;
  const heads: Array<{ points: Array<{ x: number; y: number }>; filled: boolean }> = [];
  if (decor.heads) {
    const points = pointsOf(pts);
    const first = points[0];
    const last = points[points.length - 1];
    if (first && last) {
      const span = Math.hypot(last.x - first.x, last.y - first.y);
      const start = decor.heads.start
        ? arrowHead(last, first, width, decor.heads.start, span)
        : null;
      const end = decor.heads.end ? arrowHead(first, last, width, decor.heads.end, span) : null;
      const from = start ? start.stop : first;
      const to = end ? end.stop : last;
      const p = pts[2] ?? 0.5;
      line = [from.x, from.y, p, to.x, to.y, p];
      if (start) heads.push(start);
      if (end) heads.push(end);
    }
  }
  const path = pathFromOps(outlineOps(line, decor.radius ?? 0, closed));
  if (decor.fill && closed) {
    const { color, alpha } = splitFill(decor.fill);
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.fillStyle = night ? nightColor(color) : color;
    ctx.fill(path);
    ctx.restore();
  }
  ctx.strokeStyle = ink;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (decor.dash) ctx.setLineDash(dashPattern(decor.dash, width));
  ctx.stroke(path);
  ctx.setLineDash([]);
  for (const head of heads) {
    const shape = new Path2D();
    head.points.forEach((p, i) => (i === 0 ? shape.moveTo(p.x, p.y) : shape.lineTo(p.x, p.y)));
    if (head.filled) {
      shape.closePath();
      ctx.fillStyle = ink;
      ctx.fill(shape);
    }
    ctx.stroke(shape);
  }
}

/** Trace one stroke from its points and paint it, in whatever space `ctx` is in. */
function fillStroke(
  ctx: CanvasRenderingContext2D,
  points: number[],
  style: StrokeStyle,
  highlighterAlpha: number,
  night = false,
): void {
  const runs = inkRuns(points, penFor(style), style.shape === true);
  paintStroke(ctx, { runs }, style, highlighterAlpha, night, style.decor ?? null, points);
}

export interface ThumbnailOptions {
  /** Paint only annotations on a transparent canvas, for PDF composition. */
  transparent?: boolean;
  usePressure: boolean;
  highlighterAlpha?: number;
  paper?: PaperTheme;
  /** Draws the page's placed images; without one they are left out. */
  images?: ImagePainter;
  /** The page's header and page number, when the notebook has them. */
  furniture?: PageTexts;
}

/**
 * Paint one whole page — paper, backdrop, images, ink and text boxes, in the
 * order the page stacks them — into `ctx`, scaled so the page is `cssWidth`
 * CSS px wide. The page-sidebar thumbnails, the PDF export and the AI's page
 * render use this. It resizes the canvas itself, so the caller only picks a width.
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

  const look = pageLook(page.backdrop, options.paper ?? LIGHT_PAPER);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (!options.transparent) {
    ctx.fillStyle = look.paper;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
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
  if (!options.transparent) {
    painter.paint(ctx, page.backdrop, page.geometry, Math.max(1, (0.5 * width) / cssWidth), {
      deviceScale: k,
      paper: options.paper ?? LIGHT_PAPER,
    });
    if (options.furniture) paintFurniture(ctx, page.geometry, options.furniture, look.night);
  }
  const pictures = (front: boolean): void => {
    if (!options.images) return;
    for (const image of page.images) {
      if ((image.front === true) === front) drawPlacedImage(ctx, image, options.images, k);
    }
  };
  pictures(false);
  // Tables lie under the ink, so handwriting in a cell shows over its lines.
  for (const table of page.tables ?? []) paintTable(ctx, table, look.night);
  // So do graphs: a note written over a curve shows over it.
  for (const graph of page.graphs ?? []) {
    paintGraph(ctx, graph, { level: k, night: look.night, paper: look.paper });
  }

  const alpha = options.highlighterAlpha ?? DEFAULT_HIGHLIGHTER_ALPHA;
  for (const stroke of page.strokes) {
    fillStroke(ctx, stroke.pts, styleOf(stroke, options.usePressure), alpha, look.night);
  }
  // A picture in front of the ink (a sticker on handwriting), under the text.
  pictures(true);

  // Over the ink, as on the page, where the text boxes are DOM above the ink
  // canvas: a filled shape is a ground the text sits on, and a filled box
  // covers the ink under it in an export just as it does on screen.
  for (const box of page.textBoxes) paintTextBox(ctx, box, look.night);
  ctx.restore();
}

/**
 * Paint one text box in page space: its fill and border, with the box's
 * corners, then its lines with the box's
 * font, alignment, line height and decorations. The line breaks come from
 * `text-layout.ts`, which follows the textarea's own rules, so a thumbnail
 * wraps where the page does. The font is a real family list from the model,
 * never `var(--…)`: canvas string properties do not resolve CSS variables.
 * On a night page (`night`) its colours are shown as `./night` maps them.
 * Exported for its tests.
 */
export function paintTextBox(
  ctx: CanvasRenderingContext2D,
  typed: TextBoxElement,
  night = false,
): void {
  // Links in the text show as their text, brackets hidden, as on the page.
  const box = { ...typed, text: shownCase(displayText(typed.text), typed) };
  const border = normalizeBorder(box.border);
  if (!box.text && !box.fill && !border) return;
  ctx.save();
  ctx.font = canvasFont(box, box.fontSize);
  const layout = layoutTextBox(box, (text) => ctx.measureText(text).width);
  // The corners the page's frame has (its CSS `border-radius`).
  const radius = cornerRadiusOf(box.radius, box.w, layout.height);
  if (box.fill) {
    ctx.fillStyle = shownColor(box.fill, night);
    if (radius > 0) {
      ctx.beginPath();
      traceBoxPath(ctx, box.x, box.y, box.w, layout.height, radius);
      ctx.fill();
    } else ctx.fillRect(box.x, box.y, box.w, layout.height);
  }
  if (border) {
    // Inside the edge, as the frame's inset shadow is: the line's centre
    // sits half its width in, on corners half its width tighter.
    const width = Math.min(border.width, box.w / 2, layout.height / 2);
    const half = width / 2;
    ctx.strokeStyle = shownColor(border.color, night);
    ctx.lineWidth = width;
    ctx.beginPath();
    traceBoxPath(
      ctx,
      box.x + half,
      box.y + half,
      box.w - width,
      layout.height - width,
      Math.max(0, radius - half),
    );
    ctx.stroke();
  }
  if (box.text) paintTextLines(ctx, box, layout, { x: box.x, y: box.y, w: box.w }, night);
  ctx.restore();
}

/**
 * Paint laid-out lines of text in `style`'s colour and decorations, clipped
 * to the box `clip` (as tall as the layout): a fixed-height box, or a table
 * cell, clips its overflow, as its textarea does. `ctx.font` must already be
 * the style's. The clip stays: the caller saves and restores round it.
 */
function paintTextLines(
  ctx: CanvasRenderingContext2D,
  style: TextStyle,
  layout: TextBoxLayout,
  clip: { x: number; y: number; w: number },
  night: boolean,
): void {
  ctx.beginPath();
  ctx.rect(clip.x, clip.y, clip.w, layout.height);
  ctx.clip();
  ctx.fillStyle = shownColor(style.color, night);
  ctx.textBaseline = "alphabetic";
  const metrics = ctx.measureText("Hg");
  // Older WebKit lacks the font-box metrics; fall back to typical proportions.
  const ascent = finiteOr(metrics.fontBoundingBoxAscent, style.fontSize * 0.8);
  const descent = finiteOr(metrics.fontBoundingBoxDescent, style.fontSize * 0.2);
  const baseline = baselineOffset(layout.lineBox, ascent, descent);
  const deco = decorationMetrics(style.fontSize);
  layout.lines.forEach((line, i) => {
    const y = layout.y + i * layout.lineBox + baseline;
    for (const run of line.runs) ctx.fillText(run.text, layout.x + run.x, y);
    if (line.runs.length === 0) return;
    const width = line.right - line.left;
    if (style.underline) {
      ctx.fillRect(layout.x + line.left, y + deco.underline, width, deco.thickness);
    }
    if (style.strike) ctx.fillRect(layout.x + line.left, y + deco.strike, width, deco.thickness);
  });
}

/** Laid-out tables by object, kept while nothing their layout depends on changes. */
const tableLayouts = new WeakMap<TableElement, { key: string; layout: TableLayout }>();

/**
 * A table laid out with `ctx`'s text measuring (any context measures alike,
 * so one layout serves every tile), reused while its fingerprint holds.
 * Exported for the surface, which hit-tests and places the cell editor by it.
 */
export function tableLayoutOf(
  table: TableElement,
  ctx: Pick<CanvasRenderingContext2D, "font" | "measureText" | "save" | "restore">,
): TableLayout {
  const key = tableLayoutKey(table);
  const cached = tableLayouts.get(table);
  if (cached && cached.key === key) return cached.layout;
  ctx.save();
  const layout = layoutTable(table, (bold) => {
    const font = canvasFont({ ...cellStyle(table, 1), bold }, table.fontSize);
    return (text) => {
      if (ctx.font !== font) ctx.font = font;
      return ctx.measureText(text).width;
    };
  });
  ctx.restore();
  tableLayouts.set(table, { key, layout });
  return layout;
}

/**
 * Paint one table in page space: each cell's fill, its text (all but
 * `skip`, the cell being typed in, which its textarea shows), then the grid
 * over them in the table's colour, width and dash. The one function the
 * tiles, the page previews, the thumbnails, the PDF export and the lasso's
 * drag draft all paint a table with, so they agree. On a night page its
 * colours are shown as `./night` maps them.
 */
export function paintTable(
  ctx: CanvasRenderingContext2D,
  table: TableElement,
  night = false,
  skip: CellRef | null = null,
  laidOut?: TableLayout,
): void {
  const layout = laidOut ?? tableLayoutOf(table, ctx);
  ctx.save();
  layout.rowY.forEach((y, r) => {
    const fill = cellFill(table, r);
    if (!fill) return;
    const { color, alpha } = splitFill(fill);
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.fillStyle = shownColor(color, night);
    ctx.fillRect(layout.x, y, layout.w, layout.rowH[r]);
    ctx.restore();
  });
  layout.cells.forEach((row, r) => {
    const style = cellStyle(table, r);
    ctx.font = canvasFont(style, style.fontSize);
    row.forEach((cell, c) => {
      if (skip && skip.row === r && skip.col === c) return;
      if (cell.lines.every((line) => line.runs.length === 0)) return;
      const clip = { x: layout.colX[c], y: layout.rowY[r], w: layout.colW[c] };
      ctx.save();
      paintTextLines(ctx, style, cell, clip, night);
      ctx.restore();
    });
  });
  // The grid: inner lines first, the outline last over their ends.
  const width = Math.max(0.25, table.size);
  ctx.strokeStyle = shownColor(table.color, night);
  ctx.lineWidth = width;
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
  if (table.dash) ctx.setLineDash(dashPattern(table.dash, width));
  const right = layout.x + layout.w;
  const bottom = layout.y + layout.h;
  ctx.beginPath();
  for (let c = 1; c < layout.colX.length; c++) {
    ctx.moveTo(layout.colX[c], layout.y);
    ctx.lineTo(layout.colX[c], bottom);
  }
  for (let r = 1; r < layout.rowY.length; r++) {
    ctx.moveTo(layout.x, layout.rowY[r]);
    ctx.lineTo(right, layout.rowY[r]);
  }
  ctx.rect(layout.x, layout.y, layout.w, layout.h);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** `b` grown by `pad` on every side. */
function padBounds(b: Bounds, pad: number): Bounds {
  return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
}
