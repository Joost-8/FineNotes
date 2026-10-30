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
 *   frame's budget allows, or drawn from the last level's tiles or the
 *   page's low-resolution preview until it does; with neither, it is
 *   rasterised anyway — the dry layer never shows a hole where a page is.
 *   What changes on a page is painted again in place on the tiles over it
 *   (`invalidateRegion`), and while the view stays, the dry layer draws only
 *   those px again.
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
import { LIGHT_PAPER, type PaperTheme, deskFor, pageLook, shownColor } from "./backdrop";
import { erasingLook } from "./erase-look";
import {
  DAY_HIGHLIGHTER_BLEND,
  NIGHT_HIGHLIGHTER_BLEND,
  nightColor,
  nightHighlighter,
} from "./night";
import { type InkRun, type PenOptions, inkRuns, penOptions, traceRun } from "../ink/freehand";
import { addDamage, damageArea, grow, rectArea, rectsMeet, staleRect, unite } from "./damage";
import { type PixelRect, inkPixelRect } from "./layer-rect";
import { widestTiltFactor } from "../ink/tilt";
import { inkBounds, taskBoxRect } from "../model/tasks";
import {
  type Backdrop,
  type Bounds,
  type ImageCrop,
  type ImageElement,
  type InkDocument,
  type InkTask,
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
import { paintStickyPaper, withinNote } from "./sticky-paper";
import { type Affine, isNoteInk, noteIdsOf, noteMove } from "../model/sticky-notes";
import { paintGraph } from "./graph-paint";
import { type RoutedConnector, paintConnector, paintConnectors } from "./connector-paint";
import { graphBounds } from "../model/graph-element";
import type { DocumentLayout, PageBox } from "./page-layout";
import { pagesAhead } from "./look-ahead";
import { joinLines, joinedSides } from "./page-join";
import { relativeLuminance } from "../model/cover";
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

/** How strongly ink a playing recording has not reached yet is drawn (2.5). */
const FADED_INK_ALPHA = 0.22;
/** The veil over the part of a picture a crop leaves out. A real colour: canvas ignores `var(--…)`. */
const CROP_VEIL = "rgba(0, 0, 0, 0.55)";
/**
 * The lasso's and the selection box's line: Goodnotes' blue (Joost's
 * recording, 2026-10-30), the same as the kept loop's (`--gob-lasso` in
 * styles.css). A real colour, as above.
 */
const SELECTION_LINE = "#1a6fd6";
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
  /** A stored stroke's Pencil altitude per point (`Stroke.tilt`); absent: upright. */
  tilt?: readonly number[];
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
    /** The ink tiles' level: device px per page px. */
    deviceScale: number,
    /** The zoom is mid-change: the level is not settled. */
    transient: boolean,
    /** The view is moving (or rested less than `REST_MS` ago). */
    moving?: boolean,
    /**
     * Pages near the view but not on it, those a scroll shows next first
     * (`pagesAhead`), for the painter to have ready before they arrive.
     */
    near?: Array<{ backdrop: Backdrop; geometry: PageGeometry }>,
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
  /** What it holds, for the diagnostic HUD. */
  diagnostics?: () => string;
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
  painter: ImagePainter | null,
  deviceScale: number,
  inkOnNote?: () => void,
): void {
  if (!(image.w > 0) || !(image.h > 0)) return;
  // A sticky note is paper painted here, so it needs no painter.
  const sticky = image.sticky;
  if (!sticky && !painter) return;
  ctx.save();
  if (image.opacity !== undefined) ctx.globalAlpha *= image.opacity;
  ctx.translate(image.x + image.w / 2, image.y + image.h / 2);
  const rotation = rotationOf(image);
  if (rotation !== 0) ctx.rotate(rotation);
  if (image.flipX === true || image.flipY === true) {
    ctx.scale(image.flipX === true ? -1 : 1, image.flipY === true ? -1 : 1);
  }
  ctx.translate(-image.w / 2, -image.h / 2);
  if (sticky) paintStickyPaper(ctx, image.w, image.h, sticky.color);
  else painter?.paintImage(ctx, image, deviceScale);
  ctx.restore();
  // The note's ink, over its paper and never past its edge.
  if (sticky && inkOnNote) withinNote(ctx, image, inkOnNote);
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
/** A join's mark on the desk: CSS px from the paper, long and wide. Short enough
 * for the 12 px of desk above and below a row of pages at the fit. */
const JOIN_MARK_GAP = 3;
const JOIN_MARK_LENGTH = 7;
const JOIN_MARK_WIDTH = 2;
/** Its colour on a dark desk and on a light one. */
const JOIN_MARK_ON_DARK = "rgba(255, 255, 255, 0.4)";
const JOIN_MARK_ON_LIGHT = "rgba(0, 0, 0, 0.3)";

/** The band of paper painted along a page's edges under its tiles, device px. */
const PAPER_EDGE = 2;
/** The page shadow: blur and downward offset, in CSS px. */
const SHADOW_BLUR = 14;
const SHADOW_OFFSET_Y = 3;

interface Tile {
  canvas: HTMLCanvasElement;
  pageId: string;
  level: number;
  rect: TileRect;
  /**
   * Page px of the tile drawn from an older state of the page: painted
   * again in place before the tile is next shown ({@link Renderer.invalidateRegion}).
   */
  stale?: Bounds;
  /**
   * Page px drawn from an older backdrop (a PDF raster that has since
   * landed sharper): painted again in place when a frame has the time,
   * shown as it is until then.
   */
  soft?: Bounds;
}

interface Preview {
  canvas: HTMLCanvasElement;
  scale: number;
  /**
   * The part of the page it shows, page px, when that is not the whole
   * page: an endless board's preview covers its drawing and a screen around
   * it ({@link Renderer.setPreviewWindow}).
   */
  window?: Bounds;
  /** As a tile's: page px painted again in place before it is next drawn. */
  stale?: Bounds;
  /** As a tile's: an older backdrop, painted again when there is time. */
  soft?: Bounds;
}

/**
 * The view a dry layer is painted in: where its top-left device px lies in
 * layout space, as `scrollY` and the layout origin's `originX` (CSS px from
 * its left edge). With overscan it reaches past the view on every side.
 */
interface DryView {
  scrollY: number;
  originX: number;
}

/**
 * What the dry layer shows: the scale, size and look it was painted at
 * (`key`), of which document, in which view (`paint`). While these stay, a
 * repaint draws only what changed since ({@link Renderer.renderDocument}),
 * and a scroll the overscan still covers only moves the canvas. `clipped`:
 * only the part in view was painted (mid-zoom), so the next paint is whole.
 */
interface DryShown {
  key: string;
  doc: InkDocument;
  layout: DocumentLayout;
  paper: PaperTheme;
  selection: boolean;
  paint: DryView;
  clipped: boolean;
}

/**
 * How far the dry layer reaches past the view on each side with overscan
 * on ({@link Renderer.useOverscan}): this share of the view's width and
 * height, and at most this many CSS px.
 */
const OVERSCAN_SHARE = 0.15;
const OVERSCAN_MAX = 200;

/**
 * Damage over this share of the dry layer is drawn as one full repaint:
 * clipping saves nothing then, and every tile is visited once either way.
 */
const DRY_DAMAGE_SHARE = 0.5;

/**
 * Longest side of a windowed preview, device px (16 MB at most). A board's
 * page is many screens across: its whole-page preview at the usual 1024 px
 * was too coarse to read ink by, so its preview covers less, more finely.
 */
const WINDOWED_PREVIEW_MAX_SIDE = 2048;

interface PathEntry {
  /**
   * What it was traced from besides the points array: the pressure setting,
   * the nib, the point count and both end points. Compared field by field:
   * this runs for every stroke of a page on every tile painted, and building
   * a string key each time showed in the eraser's profile.
   */
  pressure: boolean;
  size: number;
  nib: number | undefined;
  count: number;
  ends: readonly [number, number, number, number];
  /** The points array traced: a command that replaces it is always a change. */
  pts: readonly number[];
  /** The altitudes traced with them (`Stroke.tilt`), which a piece gets anew. */
  tilt: readonly number[] | undefined;
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
/**
 * The wet layer's content as a paint call: `paint` draws it in page
 * `pageIndex`'s local space, `scale` being the target's CSS px per page px.
 */
interface WetReplay {
  pageIndex: number;
  paint: (ctx: CanvasRenderingContext2D, scale: number) => void;
}

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

/** How the ink inside a sticky note is drawn, as the page's ink is around it. */
interface InkPass {
  usePressure: boolean;
  /** Strokes the eraser is taking away, by id. */
  hidden?: ReadonlySet<string>;
  /** Strokes the eraser is cutting, and the pieces they leave. */
  replaced?: ReadonlyMap<string, readonly Stroke[]>;
  /** Strokes (or cut pieces) the eraser is taking away, drawn grey until it lifts (`erase-look`). */
  greyed?: ReadonlySet<string>;
}

export class Renderer {
  /** How opaque highlighter ink is drawn, 0..1. The surface sets it from the settings. */
  highlighterAlpha = DEFAULT_HIGHLIGHTER_ALPHA;
  /**
   * Paper colours. Paper-white by default; dark pages are a view setting,
   * and whoever changes this must {@link invalidateAll}: tiles hold colour.
   */
  paper: PaperTheme = LIGHT_PAPER;
  /** The desk the last frame was painted on (`deskFor`): the theme's, unless a page matched it. */
  desk = LIGHT_PAPER.desk;

  /** The desk alone, under the dry layer ({@link renderBackdrops}). */
  private readonly backdrop: Layer;
  /** What the backdrop layer holds, so it is painted only when that changes. */
  private backdropDesk = "";
  private backdropSize = { w: 0, h: 0 };
  /** The pages, blitted from tiles. */
  private readonly dry: Layer;
  /** Whatever is in flight: a stroke, a lasso, a dragged selection or picture. */
  private readonly wet: Layer;
  /**
   * What the wet layer shows, as a function that paints it again in its
   * page's space at any resolution, for the Zoom box ({@link paintWetInto});
   * null when it shows nothing, or something only its pixels hold.
   */
  private wetReplay: WetReplay | null = null;
  /** The wet layer holds pixels {@link wetReplay} cannot paint again. */
  private wetRaster = false;
  /** The viewport canvases' size in CSS px, and device px per CSS px. */
  private screen = { width: 0, height: 0, dpr: 1 };
  /** The view, in layout space; see {@link setViewport}. */
  private view: ViewportState = { scrollY: 0, scale: 1, width: 0 };
  /** How far right of the canvases' left edge the layout's origin sits, in CSS px. */
  private originX = 0;
  /** The view's top-left at the last screen paint, layout px: which way it moves. */
  private lastLook: { x: number; y: number } | null = null;
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
  /** Strokes drawn pale: ink a recording's playback has not reached yet (2.5). */
  private fadedStrokes: ReadonlySet<string> = new Set();
  /** Tables left out of tiles and previews: a lasso selection being dragged. */
  private hiddenTables: ReadonlySet<TableElement> = new Set();
  /** Graphs left out of tiles and previews: a lasso selection being dragged, or one being explored. */
  private hiddenGraphs: ReadonlySet<GraphElement> = new Set();
  /** Connectors (by id) left out of tiles and previews: drawn on the wet layer while dragged. */
  private hiddenConnectors: ReadonlySet<string> = new Set();
  /** The cell being typed in, whose text its textarea shows instead. */
  private editingCell: { table: TableElement; cell: CellRef } | null = null;

  /** Device px per page px the tiles are rasterised at. 0 until the first frame. */
  private level = 0;
  /**
   * The level before the last settle, whose tiles stand in, scaled, for
   * any at the new level not made yet (0: none). Dropped once every tile on
   * screen is at the new level.
   */
  private fallbackLevel = 0;
  private readonly tiles = new ByteLru<Tile>(MIN_TILE_BUDGET, (tile) => releaseCanvas(tile.canvas));
  private readonly previews = new ByteLru<Preview>(PREVIEW_BUDGET, (p) => releaseCanvas(p.canvas));
  /** Where a page's preview should look, if not at the whole page ({@link setPreviewWindow}). */
  private previewWindow: ((box: PageBox) => Bounds | null) | null = null;
  private readonly paths = new WeakMap<Stroke, PathEntry>();
  private shadow: ShadowSprite | null = null;
  /** What the dry layer shows, or null when it must be painted whole. */
  private dryShown: DryShown | null = null;
  /**
   * Device px of the dry layer drawn from tiles that changed since it was
   * painted: while the view stays, the next paint draws these alone. A
   * pen event of the eraser blitted every tile on screen again, and that,
   * not the tiles' own painting, was most of what it cost.
   */
  private dryDamage: PixelRect[] = [];
  /** Whether the dry layer reaches past the view ({@link useOverscan}). */
  private overscanOn = false;
  /** How far it does, CSS px a side, whole device px each; 0 with it off. */
  private overscan = { x: 0, y: 0 };
  /** The CSS transform the dry layer was last given ({@link placeDry}), and its shift, CSS px. */
  private dryTransform = "";
  private dryShift = { x: 0, y: 0 };

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
    // Sizing a canvas empties it.
    this.dryShown = null;
    // Never 0: a canvas of no size cannot be drawn into, and iOS reports one lost.
    const deviceWidth = Math.max(1, Math.round(width * dpr));
    const deviceHeight = Math.max(1, Math.round(height * dpr));
    // Whole device px, so the canvas and its tiles stay on the px grid.
    const margin = (side: number): number =>
      this.overscanOn ? Math.round(Math.min(side * OVERSCAN_SHARE, OVERSCAN_MAX) * dpr) : 0;
    const [mx, my] = [margin(width), margin(height)];
    this.overscan = { x: mx / dpr, y: my / dpr };
    for (const { canvas } of [this.backdrop, this.dry, this.wet]) {
      const over = canvas === this.dry.canvas;
      canvas.width = deviceWidth + (over ? 2 * mx : 0);
      canvas.height = deviceHeight + (over ? 2 * my : 0);
      canvas.style.width = `${width + (over ? (2 * mx) / dpr : 0)}px`;
      canvas.style.height = `${height + (over ? (2 * my) / dpr : 0)}px`;
    }
    if (this.overscanOn) {
      this.dry.canvas.style.left = `${-mx / dpr}px`;
      this.dry.canvas.style.top = `${-my / dpr}px`;
      this.placeDry({ x: 0, y: 0 });
    }
    const viewportBytes = deviceWidth * deviceHeight * 4;
    this.tiles.setBudget(Math.max(MIN_TILE_BUDGET, TILE_BUDGET_VIEWPORTS * viewportBytes));
  }

  /**
   * Let the dry layer reach past the view on every side ({@link OVERSCAN_SHARE}),
   * and follow a scroll it still covers by moving the canvas (a CSS
   * transform) rather than painting it again: a frame of such a pan changes
   * no canvas at all. Handing a changed pane-sized canvas to the compositor
   * on every frame, not the drawing, was most of a zoomed-in pan's frame (a
   * CPU slowed 4x: about 30 fps). Takes effect at the next {@link resize}.
   */
  useOverscan(on: boolean): void {
    this.overscanOn = on;
  }

  /** Shift the dry layer `shift` CSS px from its place: a scroll it still covers. */
  private placeDry(shift: { x: number; y: number }): void {
    if (!this.overscanOn) return;
    this.dryShift = shift;
    const transform = shift.x === 0 && shift.y === 0 ? "" : `translate(${shift.x}px, ${shift.y}px)`;
    if (transform === this.dryTransform) return;
    this.dryTransform = transform;
    this.dry.canvas.style.transform = transform;
  }

  /**
   * Where the dry layer's top-left device px lies on the view, device px:
   * its overscan above and to the left, and the shift of a scroll it still
   * covers. (0, 0) without overscan. Whoever copies the layer's pixels to
   * the view's draws them there.
   */
  dryOrigin(): { x: number; y: number } {
    const dpr = this.screen.dpr;
    return {
      x: (this.dryShift.x - this.overscan.x) * dpr,
      y: (this.dryShift.y - this.overscan.y) * dpr,
    };
  }

  /** The view's size in device px (the dry layer is larger by its overscan). */
  private get screenDevice(): { w: number; h: number } {
    const { width, height, dpr } = this.screen;
    return { w: Math.max(1, Math.round(width * dpr)), h: Math.max(1, Math.round(height * dpr)) };
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

  /**
   * Let previews cover part of a page (`window` returns page px, or null
   * for the whole page), at up to {@link WINDOWED_PREVIEW_MAX_SIDE}. Null
   * goes back to whole pages. Drops every preview either way.
   */
  setPreviewWindow(window: ((box: PageBox) => Bounds | null) | null): void {
    this.previewWindow = window;
    this.previews.clear();
  }

  /** The part of a page its cached preview shows, page px, or null when it has none. */
  previewArea(pageId: string): Bounds | null {
    const preview = this.previews.peek(pageId);
    if (!preview) return null;
    const box = this.layout.boxes.find((b) => b.id === pageId);
    return preview.window ?? (box ? { minX: 0, minY: 0, maxX: box.width, maxY: box.height } : null);
  }

  /** Forget a page's preview, so the next one is made afresh. Its tiles stay. */
  dropPreview(pageId: string): void {
    this.previews.delete(pageId);
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

  /**
   * Draw these strokes pale in every tile and preview rasterised from now on:
   * ink written after the moment a recording is playing (2.5, as Notability
   * replays a note). Same rule as {@link setHiddenStrokes}: the caller
   * invalidates the regions of the strokes that changed.
   */
  setFadedStrokes(ids: ReadonlySet<string>): void {
    this.fadedStrokes = ids;
  }

  /** Leave these tables out of tiles and previews; as above, the caller invalidates. */
  setHiddenTables(tables: ReadonlySet<TableElement>): void {
    this.hiddenTables = tables;
  }

  /** Leave these graphs out of tiles and previews; as above, the caller invalidates. */
  setHiddenGraphs(graphs: ReadonlySet<GraphElement>): void {
    this.hiddenGraphs = graphs;
  }

  /** Leave these connectors (by id) out of tiles and previews; as above, the caller invalidates. */
  setHiddenConnectors(ids: ReadonlySet<string>): void {
    this.hiddenConnectors = ids;
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
    // The last level's tiles stay a while, to be drawn scaled in place of
    // those at the new level not made yet: a frame makes a few of those,
    // not all of them at once.
    const last = this.level;
    this.fallbackLevel = last;
    this.level = level;
    this.tiles.deleteWhere((tile) => tile.level !== level && tile.level !== last);
  }

  invalidateAll(): void {
    this.tiles.clear();
    this.previews.clear();
    this.dryShown = null;
  }

  /**
   * Paint the whole dry layer at the next frame, though nothing in the
   * tiles changed: when the platform may have dropped what a canvas showed
   * (the app back from the background).
   */
  repaintAll(): void {
    this.dryShown = null;
  }

  /**
   * How far past its centreline the widest tilted stroke on page `pageId`
   * reaches, page px; 0 when none is tilted. A brush laid flat can paint
   * beyond {@link INK_PAD}, so a change near it must repaint that far.
   */
  private widestInk(pageId: string): number {
    const page = this.doc?.pages.find((candidate) => candidate.id === pageId);
    let reach = 0;
    for (const stroke of page?.strokes ?? [])
      if (stroke.tilt) reach = Math.max(reach, inkReach(stroke));
    return reach;
  }

  invalidatePage(pageId: string): void {
    this.tiles.deleteWhere((tile) => tile.pageId === pageId);
    this.previews.delete(pageId);
    this.dryShown = null;
  }

  /**
   * A page-space rectangle changed (strokes erased, moved), and ink near it
   * may reach into it. The tiles and the preview over it keep the rest of
   * what they show: only the rectangle, padded by the widest ink, is painted
   * again, in place, before they are next drawn. Dropping the tiles instead
   * re-rasterised every tile under a long stroke the eraser touched, on
   * every pen event.
   */
  invalidateRegion(pageIndex: number, bounds: Bounds): void {
    const box = this.layout.boxes[pageIndex];
    if (!box) return;
    this.markStale(box, grow(bounds, Math.max(INK_PAD, this.widestInk(box.id))));
  }

  /**
   * Exactly this page-space rectangle changed: the caller's `area` already
   * holds every px that did (the eraser's cut, with the cut ends' caps), so
   * nothing is added round it. Painted again in place, as for
   * {@link invalidateRegion}.
   */
  invalidateArea(pageIndex: number, area: Bounds): void {
    const box = this.layout.boxes[pageIndex];
    if (box) this.markStale(box, area);
  }

  /**
   * Only the backdrop changed in this page-space rectangle (a PDF raster
   * landed): no ink reaches further for it, so it is painted again as it
   * is, two device px wider for the raster's own rounding.
   */
  invalidateBackdrop(pageIndex: number, region: Bounds): void {
    const box = this.layout.boxes[pageIndex];
    if (!box) return;
    this.markStale(box, grow(region, 2 / (this.level || this.deviceScale || 1)), true);
  }

  /**
   * The whole backdrop of page `pageIndex` changed (its PDF page image
   * landed): its tiles and preview are painted again in place, a few a
   * frame, and shown as they are until then. Dropping them made every tile
   * of the page on screen again in one frame.
   */
  refreshPage(pageIndex: number): void {
    const box = this.layout.boxes[pageIndex];
    if (box) this.markStale(box, { minX: 0, minY: 0, maxX: box.width, maxY: box.height }, true);
  }

  /**
   * Mark `area` (page px) of page `box` stale on its tiles, its preview and
   * the dry layer: `soft` when only the backdrop changed, so it may wait
   * for a frame with the time to paint it.
   */
  private markStale(box: PageBox, area: Bounds, soft = false): void {
    if (this.level !== 0) {
      for (const tr of tilesForBounds(box.width, box.height, this.level, area)) {
        const tile = this.tiles.peek(tileKey(box.id, this.level, tr.col, tr.row));
        if (!tile) continue;
        if (soft) tile.soft = unite(tile.soft, area);
        else tile.stale = unite(tile.stale, area);
      }
    }
    if (!soft) this.dropFallback(box, area);
    const preview = this.previews.peek(box.id);
    if (preview && soft) preview.soft = unite(preview.soft, area);
    else if (preview) preview.stale = unite(preview.stale, area);
    this.damageDry(box, area);
  }

  /** The last zoom's stand-ins over `area` (page px) of page `box` would show what changed: they go. */
  private dropFallback(box: PageBox, area: Bounds): void {
    const old = this.fallbackLevel;
    if (old === 0) return;
    for (const tr of tilesForBounds(box.width, box.height, old, area)) {
      this.tiles.delete(tileKey(box.id, old, tr.col, tr.row));
    }
  }

  /** The dry layer's px showing `area` (page px) of page `box`, in the view it was painted in. */
  private damageDry(box: PageBox, area: Bounds): void {
    if (!this.dryShown) return;
    const k = this.deviceScale;
    const { paint } = this.dryShown;
    const r = {
      x: (paint.originX + box.x * this.safeScale) * this.screen.dpr,
      y: (box.y - paint.scrollY) * k,
    };
    // Kept to the page and one px round it, its soft edge.
    const page: Bounds = { minX: 0, minY: 0, maxX: box.width, maxY: box.height };
    const shown: Bounds = {
      minX: Math.max(area.minX, page.minX),
      minY: Math.max(area.minY, page.minY),
      maxX: Math.min(area.maxX, page.maxX),
      maxY: Math.min(area.maxY, page.maxY),
    };
    if (!(shown.maxX > shown.minX) || !(shown.maxY > shown.minY)) return;
    const rect = staleRect(
      grow(shown, 1 / (k || 1)),
      k,
      -r.x,
      -r.y,
      this.dry.canvas.width,
      this.dry.canvas.height,
    );
    if (rect) this.dryDamage = addDamage(this.dryDamage, rect);
  }

  // --- Geometry -------------------------------------------------------------

  /** Draw on a viewport canvas in layout space from here on. */
  private toLayoutSpace(ctx: CanvasRenderingContext2D): void {
    const k = this.deviceScale;
    ctx.setTransform(k, 0, 0, k, this.originX * this.screen.dpr, -this.view.scrollY * k);
  }

  /** Clear a whole viewport canvas, whatever transform it was left in. */
  private wipe(ctx: CanvasRenderingContext2D): void {
    if (ctx === this.wet.ctx) {
      this.wetReplay = null;
      this.wetRaster = false;
    }
    const { width, height, dpr } = this.screen;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, dpr * width, dpr * height);
  }

  /** Show the wet layer, or hide it (see the constructor). */
  private setWetVisible(visible: boolean): void {
    // Drawn without saying how to draw it again: only the pixels have it.
    if (visible && this.wetReplay === null) this.wetRaster = true;
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

  /** The pages a scroll shows next, for the painter (`pagesAhead`). */
  private nearPages(doc: InkDocument): Array<{ backdrop: Backdrop; geometry: PageGeometry }> {
    const { top, bottom } = this.visibleBand();
    const scale = this.safeScale;
    const left = -this.originX / scale;
    const view = { minX: left, minY: top, maxX: left + this.screen.width / scale, maxY: bottom };
    const last = this.lastLook;
    this.lastLook = { x: view.minX, y: view.minY };
    const motion = last ? { x: view.minX - last.x, y: view.minY - last.y } : { x: 0, y: 0 };
    const boxes = this.layout.boxes.filter((box) => box.index < doc.pages.length);
    return pagesAhead(boxes, view, motion).map((box) => {
      const page = doc.pages[box.index];
      return { backdrop: page.backdrop, geometry: page.geometry };
    });
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
  private enterPage(ctx: CanvasRenderingContext2D, box: PageBox, clip = true): void {
    ctx.save();
    ctx.translate(box.x, box.y);
    if (!clip) return;
    ctx.beginPath();
    ctx.rect(0, 0, box.width, box.height);
    ctx.clip();
  }

  /**
   * Enter a page's local coordinate space for ink being drawn: clipped to
   * the sheet, or with joined pages to all of them, so a stroke shows on
   * the next page as it crosses the join (and is stored there on lift).
   */
  private enterWetPage(ctx: CanvasRenderingContext2D, box: PageBox): void {
    if (this.layout.joined !== true) {
      this.enterPage(ctx, box);
      return;
    }
    ctx.save();
    ctx.beginPath();
    for (const b of this.layout.boxes) ctx.rect(b.x, b.y, b.width, b.height);
    ctx.clip();
    ctx.translate(box.x, box.y);
  }

  // --- Backdrop layer -------------------------------------------------------

  /**
   * The backdrop layer: the desk alone, painted again only when its colour
   * changes. The desk under the pages, their shadows and their paper are
   * painted on the dry layer each frame, under the tiles
   * ({@link paintDesk}): a second pane-sized canvas changed every frame of a
   * scroll, and handing two of them to the compositor each frame, not the
   * drawing, was what held a page turn to about 34 fps with the CPU slowed
   * 4x (43 without it).
   */
  renderBackdrops(doc: InkDocument): void {
    this.doc = doc;
    const desk = this.deskOf(doc);
    const { width, height } = this.backdrop.canvas;
    if (
      desk === this.backdropDesk &&
      width === this.backdropSize.w &&
      height === this.backdropSize.h
    )
      return;
    this.backdropDesk = desk;
    this.backdropSize = { w: width, h: height };
    const ctx = this.backdrop.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = desk;
    ctx.fillRect(0, 0, width, height);
  }

  /**
   * The desk for the pages on screen (`deskFor`): the theme's, unless a
   * page's paper matches it, so every page stays apart from it.
   */
  private deskOf(doc: InkDocument): string {
    const papers: string[] = [];
    for (const box of this.boxesOnScreen(doc.pages.length)) {
      const page = doc.pages[box.index];
      if (page) papers.push(paperColorOf(page, this.paper));
    }
    return deskFor(this.paper, papers);
  }

  /**
   * The desk, a shadow under each page on screen and the page's paper, on
   * `ctx` (the dry layer) under its tiles. The page is an object lying on
   * the desk, not a region filling the pane (design brief), so the field is
   * painted edge to edge first.
   */
  private paintDesk(ctx: CanvasRenderingContext2D, doc: InkDocument, desk: string): void {
    const boxes = this.boxesOnScreen(doc.pages.length);
    this.desk = desk;
    // The last frame's tiles may have turned smoothing off: the shadow's
    // slices are stretched, and must be filtered.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.imageSmoothingEnabled = true;
    ctx.fillStyle = this.desk;
    ctx.fillRect(0, 0, this.dry.canvas.width, this.dry.canvas.height);
    const sprite = this.shadowSprite();
    for (const box of boxes) {
      const r = this.pageDeviceRect(box);
      this.drawShadow(ctx, sprite, r.x, r.y, r.w, r.h, SHADOW_OFFSET_Y * this.screen.dpr);
    }
    this.paintJoinMarks(ctx, boxes);
  }

  /**
   * A page's own paper colour under its tiles (see paperColorOf): over the
   * whole page where a tile is missing, else only a band along its edges.
   * The tiles start on whole pixels and the page need not, so its edge is
   * the paper's soft edge, as it always was; under the rest the tiles paint
   * their own paper, and filling there too doubled what a scroll frame
   * painted.
   */
  private paintPaper(
    ctx: CanvasRenderingContext2D,
    page: Page,
    box: PageBox,
    edgesOnly: boolean,
  ): void {
    const { x, y, w, h } = this.pageDeviceRect(box);
    ctx.fillStyle = paperColorOf(page, this.paper);
    if (!edgesOnly || w <= 2 * PAPER_EDGE || h <= 2 * PAPER_EDGE) {
      ctx.fillRect(x, y, w, h);
      return;
    }
    ctx.fillRect(x, y, w, PAPER_EDGE);
    ctx.fillRect(x, y + h - PAPER_EDGE, w, PAPER_EDGE);
    ctx.fillRect(x, y + PAPER_EDGE, PAPER_EDGE, h - 2 * PAPER_EDGE);
    ctx.fillRect(x + w - PAPER_EDGE, y + PAPER_EDGE, PAPER_EDGE, h - 2 * PAPER_EDGE);
  }

  /**
   * A short mark on the desk at each end of a join between pages on screen
   * (`canvas/page-join.ts`): where one page ends, shown beside the paper
   * rather than as a line over it. In screen px, so it reads the same at
   * every zoom.
   */
  private paintJoinMarks(ctx: CanvasRenderingContext2D, boxes: readonly PageBox[]): void {
    if (this.layout.joined !== true || boxes.length === 0) return;
    const shown = new Set(boxes.map((box) => box.index));
    const dpr = this.screen.dpr;
    const k = this.deviceScale;
    const gap = JOIN_MARK_GAP * dpr;
    const length = JOIN_MARK_LENGTH * dpr;
    ctx.save();
    ctx.strokeStyle = relativeLuminance(this.desk) < 0.3 ? JOIN_MARK_ON_DARK : JOIN_MARK_ON_LIGHT;
    ctx.lineWidth = JOIN_MARK_WIDTH * dpr;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (const line of joinLines(this.layout)) {
      if (!shown.has(line.index) && !shown.has(line.index - 1)) continue;
      if (line.across) {
        const y = (line.at - this.view.scrollY) * k;
        const left = (this.originX + line.from * this.view.scale) * dpr;
        const right = (this.originX + line.to * this.view.scale) * dpr;
        ctx.moveTo(left - gap, y);
        ctx.lineTo(left - gap - length, y);
        ctx.moveTo(right + gap, y);
        ctx.lineTo(right + gap + length, y);
      } else {
        const x = (this.originX + line.at * this.view.scale) * dpr;
        const top = (line.from - this.view.scrollY) * k;
        const bottom = (line.to - this.view.scrollY) * k;
        ctx.moveTo(x, top - gap);
        ctx.lineTo(x, top - gap - length);
        ctx.moveTo(x, bottom + gap);
        ctx.lineTo(x, bottom + gap + length);
      }
    }
    ctx.stroke();
    ctx.restore();
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
   * `hidden` strokes are skipped, `greyed` ones (strokes or pieces) drawn
   * grey, and `replaced` strokes are drawn as their listed pieces (the
   * eraser's live preview);
   * the caller invalidates the region they cover first, so the affected
   * tiles are painted again.
   *
   * While the view and the document are the ones the dry layer already
   * shows complete, only what changed since is painted: the px the
   * invalidations named, clipped, and only the tiles under them.
   */
  renderDocument(
    doc: InkDocument,
    usePressure: boolean,
    hidden?: ReadonlySet<string>,
    selection?: PageSelection | null,
    replaced?: ReadonlyMap<string, readonly Stroke[]>,
    budgetMs = Infinity,
    detailTransient = false,
    greyed?: ReadonlySet<string>,
  ): boolean {
    this.doc = doc;
    const ctx = this.dry.ctx;
    if (this.level === 0) this.level = quantiseLevel(this.deviceScale);
    const level = this.level;
    const k = this.deviceScale;
    const s = k / level;
    // At its own level a tile lands on whole device pixels: no seams, no resampling.
    const exact = Math.abs(s - 1) < 1e-3;
    // Mid-zoom the tiles' level is stale: nothing rasterised at it survives
    // the settle, so this frame draws what is cached and the stand-ins, and
    // spends no time making more.
    const transient = this.isTransient;
    const deadline = budgetMs === Infinity ? Infinity : now() + budgetMs;
    let complete = true;
    const ink: InkPass = { usePressure, hidden, replaced, greyed };

    // The PDF painter is asked about what is in view, not the overscan.
    const screen = this.screenDevice;
    this.painter?.prepare?.(
      this.boxesOnScreen(doc.pages.length).map((box) => {
        const page = doc.pages[box.index];
        const r = this.pageDeviceRect(box);
        return {
          backdrop: page.backdrop,
          geometry: page.geometry,
          region: {
            minX: -r.x / k,
            minY: -r.y / k,
            maxX: (screen.w - r.x) / k,
            maxY: (screen.h - r.y) / k,
          },
        };
      }),
      level,
      transient,
      detailTransient,
      this.nearPages(doc),
    );
    const desk = this.deskOf(doc);
    const key = this.dryKey(desk);
    // `damage` null: paint it all. Else only these px changed since the last paint.
    const { paint, damage, shift } = this.planDry(doc, desk, selection != null);
    this.placeDry(shift);
    if (damage?.length === 0) return true;
    // Mid-zoom only the part in view is painted: the overscan is not seen,
    // and a pinch paints every frame.
    const { x: mx, y: my } = this.overscan;
    const dpr = this.screen.dpr;
    const clipped = damage === null && transient && (mx > 0 || my > 0);
    const clip =
      damage ?? (clipped ? [{ x: mx * dpr, y: my * dpr, w: screen.w, h: screen.h }] : null);
    const meets = (rect: PixelRect): boolean => !clip || clip.some((d) => rectsMeet(d, rect));
    // Tiles drawn from a stand-in, painted again at the next frame.
    const pending: PixelRect[] = [];
    // Painted in the view the dry layer shows: its overscan included, and
    // kept while a scroll stays inside it.
    const real = { view: this.view, originX: this.originX, screen: this.screen };
    this.view = { ...real.view, scrollY: paint.scrollY };
    this.originX = paint.originX;
    this.screen = {
      ...real.screen,
      width: real.screen.width + 2 * mx,
      height: real.screen.height + 2 * my,
    };
    ctx.save();
    try {
      if (clip) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.beginPath();
        for (const d of clip) ctx.rect(d.x, d.y, d.w, d.h);
        ctx.clip();
      }
      this.paintDesk(ctx, doc, desk);
      ctx.imageSmoothingEnabled = !exact;
      for (const box of this.boxesOnScreen(doc.pages.length)) {
        const page = doc.pages[box.index];
        const r = this.pageDeviceRect(box);
        const ox = exact ? Math.round(r.x) : r.x;
        const oy = exact ? Math.round(r.y) : r.y;
        const raster = rasterSize(box.width, box.height, level);
        if (!meets(outwardRect(r.x, r.y, r.w, r.h))) continue;
        // The tiles' px on the dry layer: at their own level whole px; mid-zoom
        // neighbours share each rounded edge, so scaling leaves no seams.
        const placed = (tr: TileRect): PixelRect => {
          if (exact) return { x: ox + tr.x, y: oy + tr.y, w: tr.w, h: tr.h };
          const x0 = Math.round(ox + tr.x * s);
          const y0 = Math.round(oy + tr.y * s);
          return {
            x: x0,
            y: y0,
            w: Math.round(ox + (tr.x + tr.w) * s) - x0,
            h: Math.round(oy + (tr.y + tr.h) * s) - y0,
          };
        };
        const needed = tilesCovering(
          box.width,
          box.height,
          level,
          -ox / s,
          -oy / s,
          (this.dry.canvas.width - ox) / s,
          (this.dry.canvas.height - oy) / s,
        ).filter((tr) => meets(placed(tr)));

        let missing = 0;
        for (const tr of needed) {
          if (!this.tiles.has(tileKey(page.id, level, tr.col, tr.row))) missing++;
        }
        // Mid-zoom the tiles are scaled, and may not meet the page's edges.
        this.paintPaper(ctx, page, box, missing === 0 && exact);
        let preview = missing > 0 ? this.previews.get(page.id) : undefined;
        if (missing > 0 && !preview && transient) {
          // One whole-page stand-in beats tiles at a level about to be dropped.
          preview = this.buildPreview(page, box, usePressure) ?? undefined;
        }
        if (preview?.stale) this.repairPreview(preview, page, box, usePressure);
        // Zoomed out far enough that the stand-in is the closer match in
        // resolution, it alone is drawn: minifying dozens of tiles a frame is
        // what made a fast pinch-out drop frames, and looked no sharper.
        const previewOnly =
          preview !== undefined &&
          transient &&
          Math.abs(Math.log(k / preview.scale)) < Math.abs(Math.log(s));
        if (preview?.window) {
          // Only part of the page: the paper first, so nothing else shows the desk.
          const w = preview.window;
          ctx.fillStyle = paperColorOf(page, this.paper);
          ctx.fillRect(ox, oy, raster.w * s, raster.h * s);
          ctx.drawImage(
            preview.canvas,
            ox + w.minX * k,
            oy + w.minY * k,
            (preview.canvas.width / preview.scale) * k,
            (preview.canvas.height / preview.scale) * k,
          );
        } else if (preview) {
          // Blurry is better than blank while the tiles catch up.
          ctx.drawImage(preview.canvas, ox, oy, raster.w * s, raster.h * s);
        }

        for (const tr of needed) {
          if (previewOnly) break;
          let tile = this.tiles.get(tileKey(page.id, level, tr.col, tr.row));
          if (!tile) {
            const late = transient || now() > deadline;
            // The last zoom's tiles, scaled, else the preview under them.
            if (late && (this.drawFallback(ctx, page, box, tr, ox, oy, exact) || preview)) {
              // A stale-level tile is never worth making; a missed deadline
              // asks for another frame, which paints the tile's place again.
              if (!transient) {
                complete = false;
                pending.push(placed(tr));
              }
              continue;
            }
            tile = this.rasterTile(page, box, tr, level, ink) ?? undefined;
            if (!tile) continue;
          } else if (tile.stale || (tile.soft && now() <= deadline)) {
            // A stale tile whatever the budget: drawn as it is, it would show
            // what changed. A sharper backdrop can wait for the next frame.
            this.repairTile(tile, page, box, ink);
          } else if (tile.soft) {
            complete = false;
            pending.push(placed(tr));
          }
          const at = placed(tr);
          ctx.drawImage(tile.canvas, at.x, at.y, at.w, at.h);
        }

        if (selection && selection.pageIndex === box.index) {
          this.toLayoutSpace(ctx);
          this.enterPage(ctx, box);
          this.drawSelectionBox(ctx, selection.bounds, 8);
          ctx.restore();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
        }
      }
    } finally {
      ctx.restore();
      this.view = real.view;
      this.originX = real.originX;
      this.screen = real.screen;
    }
    for (const rect of pending) this.dryDamage = addDamage(this.dryDamage, rect);
    this.dryShown = {
      key,
      doc,
      layout: this.layout,
      paper: this.paper,
      selection: selection != null,
      paint,
      clipped,
    };
    // Every tile on screen is at the new level: the stand-ins can go.
    const old = this.fallbackLevel;
    if (old !== 0 && complete && !transient) {
      this.fallbackLevel = 0;
      this.tiles.deleteWhere((tile) => tile.level === old);
    }
    return complete;
  }

  /**
   * Draw the last level's tiles over the place of tile `tr` (at the level
   * now), scaled, smoothed: a stand-in until that tile is made. Whether they
   * covered all of it.
   */
  private drawFallback(
    ctx: CanvasRenderingContext2D,
    page: Page,
    box: PageBox,
    tr: TileRect,
    ox: number,
    oy: number,
    exact: boolean,
  ): boolean {
    const old = this.fallbackLevel;
    const level = this.level;
    if (old === 0 || old === level) return false;
    const k = this.deviceScale;
    const area = rectArea({ x: 0, y: 0, w: tr.w, h: tr.h }, level, tr.x, tr.y);
    const need = (area.maxX - area.minX) * (area.maxY - area.minY);
    let covered = 0;
    ctx.imageSmoothingEnabled = true;
    for (const ot of tilesForBounds(box.width, box.height, old, area)) {
      const tile = this.tiles.peek(tileKey(page.id, old, ot.col, ot.row));
      if (!tile) continue;
      const own = rectArea({ x: 0, y: 0, w: ot.w, h: ot.h }, old, ot.x, ot.y);
      const minX = Math.max(area.minX, own.minX);
      const minY = Math.max(area.minY, own.minY);
      const maxX = Math.min(area.maxX, own.maxX);
      const maxY = Math.min(area.maxY, own.maxY);
      if (!(maxX > minX) || !(maxY > minY)) continue;
      // Whole device px, so the pieces meet each other and the tiles round them.
      const x0 = Math.round(ox + minX * k);
      const y0 = Math.round(oy + minY * k);
      const x1 = Math.round(ox + maxX * k);
      const y1 = Math.round(oy + maxY * k);
      if (!(x1 > x0) || !(y1 > y0)) continue;
      ctx.drawImage(
        tile.canvas,
        minX * old - ot.x,
        minY * old - ot.y,
        (maxX - minX) * old,
        (maxY - minY) * old,
        x0,
        y0,
        x1 - x0,
        y1 - y0,
      );
      covered += (maxX - minX) * (maxY - minY);
    }
    ctx.imageSmoothingEnabled = !exact;
    return covered >= need * 0.999;
  }

  /** What, besides the document and the view, the dry layer's picture depends on. */
  private dryKey(desk: string): string {
    const { width, height } = this.dry.canvas;
    return `${width}x${height}@${this.screen.dpr}|${this.view.scale}|${this.level}|${desk}`;
  }

  /**
   * What this paint of the dry layer is: the view to paint it in, the damage
   * since its last paint (taken) or null to paint it whole, and how far to
   * shift the canvas. While the key, the document and the theme stay and
   * the view has moved no further than the overscan covers, the view it was
   * painted in is kept and the canvas shifted by the move; else it is
   * painted whole in the view now (and the overscan round it). Damage over
   * {@link DRY_DAMAGE_SHARE} of it is painted whole too.
   */
  private planDry(
    doc: InkDocument,
    desk: string,
    selection: boolean,
  ): { paint: DryView; damage: PixelRect[] | null; shift: { x: number; y: number } } {
    const { x: mx, y: my } = this.overscan;
    const scale = this.safeScale;
    const now: DryView = { scrollY: this.view.scrollY - my / scale, originX: this.originX + mx };
    const damage = this.dryDamage;
    this.dryDamage = [];
    const whole = { paint: now, damage: null, shift: { x: 0, y: 0 } };
    const shown = this.dryShown;
    if (!shown || shown.clipped || shown.selection || selection) return whole;
    if (shown.key !== this.dryKey(desk) || shown.doc !== doc) return whole;
    if (shown.layout !== this.layout || shown.paper !== this.paper) return whole;
    const { width, height } = this.dry.canvas;
    if (damageArea(damage) > DRY_DAMAGE_SHARE * width * height) return whole;
    // The move since, to whole device px: the tiles stay on the px grid.
    const dpr = this.screen.dpr;
    const x = Math.round((now.originX - shown.paint.originX) * dpr) / dpr;
    const y = Math.round((shown.paint.scrollY - now.scrollY) * scale * dpr) / dpr;
    if (Math.abs(x) > mx || Math.abs(y) > my) return whole;
    return { paint: shown.paint, damage, shift: { x, y } };
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
    // A ring round the view and its overscan, which a paint draws too.
    const dpr = this.screen.dpr;
    const ringX = PREFETCH_MARGIN + this.overscan.x * dpr;
    const ringY = PREFETCH_MARGIN + this.overscan.y * dpr;
    const screen = this.screenDevice;
    const marginLayout = Math.max(ringX, ringY) / k;
    const around = this.boxesInBand(
      doc.pages.length,
      top - marginLayout,
      bottom + marginLayout,
      marginLayout,
    );

    for (const box of around) {
      const page = doc.pages[box.index];
      const preview = this.previews.peek(page.id);
      if (!preview || preview.stale || preview.soft) {
        if (now() > deadline) return true;
        if (preview) this.repairPreview(preview, page, box, usePressure);
        else this.buildPreview(page, box, usePressure);
      }
    }
    for (const box of around) {
      const page = doc.pages[box.index];
      const r = this.pageDeviceRect(box);
      const ring = tilesCovering(
        box.width,
        box.height,
        level,
        (-ringX - r.x) / s,
        (-ringY - r.y) / s,
        (screen.w + ringX - r.x) / s,
        (screen.h + ringY - r.y) / s,
      );
      for (const tr of ring) {
        // A stale tile is left for the screen paint, which knows what the
        // eraser shows meanwhile; this one paints the document as it is.
        if (this.tiles.has(tileKey(page.id, level, tr.col, tr.row))) continue;
        if (!this.tiles.fits(tr.w * tr.h * 4)) return false;
        if (now() > deadline) return true;
        this.rasterTile(page, box, tr, level, { usePressure });
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
    ink: InkPass,
  ): Tile | null {
    const canvas = createEl("canvas");
    canvas.width = tr.w;
    canvas.height = tr.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    // Saved and restored, so a repair later starts from the same state.
    ctx.save();
    ctx.setTransform(level, 0, 0, level, -tr.x, -tr.y);
    this.paintTileContent(
      ctx,
      page,
      box,
      level,
      rectArea({ x: 0, y: 0, w: tr.w, h: tr.h }, level, tr.x, tr.y),
      ink,
    );
    ctx.restore();
    const tile: Tile = { canvas, pageId: page.id, level, rect: tr };
    this.tiles.set(tileKey(page.id, level, tr.col, tr.row), tile, tr.w * tr.h * 4);
    return tile;
  }

  /**
   * What a tile shows of `region` (page px), in page space at `level`: paper,
   * backdrop, pictures under the ink, tables, graphs and the page's edge, the
   * ink that reaches into it, and what lies over the ink.
   */
  private paintTileContent(
    ctx: CanvasRenderingContext2D,
    page: Page,
    box: PageBox,
    level: number,
    region: Bounds,
    ink: InkPass,
  ): void {
    this.paintPage(ctx, page, box, level, region, ink);
    this.paintStrokes(
      ctx,
      page,
      grow(region, INK_PAD),
      ink.usePressure,
      ink.hidden,
      ink.replaced,
      ink.greyed,
    );
    this.paintImages(ctx, page, grow(region, INK_PAD), level, ink, true);
  }

  /**
   * Paint a tile's stale area again, in place: cleared, clipped to the whole
   * device px it covers, and painted exactly as the tile was, so those px
   * come out as a fresh tile's would and the rest stays as it is.
   */
  private repairTile(tile: Tile, page: Page, box: PageBox, ink: InkPass): void {
    const stale = tile.soft ? unite(tile.stale, tile.soft) : tile.stale;
    tile.stale = undefined;
    tile.soft = undefined;
    if (!stale) return;
    const { rect: tr, level } = tile;
    const px = staleRect(stale, level, tr.x, tr.y, tr.w, tr.h);
    const ctx = px ? tile.canvas.getContext("2d") : null;
    if (!px || !ctx) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(px.x, px.y, px.w, px.h);
    ctx.clip();
    ctx.clearRect(px.x, px.y, px.w, px.h);
    ctx.setTransform(level, 0, 0, level, -tr.x, -tr.y);
    scratchLimit = px;
    try {
      this.paintTileContent(ctx, page, box, level, rectArea(px, level, tr.x, tr.y), ink);
    } finally {
      scratchLimit = null;
      ctx.restore();
    }
  }

  /**
   * A preview's stale area painted again in place, as {@link repairTile}
   * does a tile's, and as {@link buildPreview} drew it: without any erase
   * in progress, and the backdrop given a region only for a windowed one.
   */
  private repairPreview(preview: Preview, page: Page, box: PageBox, usePressure: boolean): void {
    const stale = preview.soft ? unite(preview.stale, preview.soft) : preview.stale;
    preview.stale = undefined;
    preview.soft = undefined;
    if (!stale) return;
    const k = preview.scale;
    const origin = preview.window ?? { minX: 0, minY: 0 };
    const { width, height } = preview.canvas;
    const px = staleRect(stale, k, origin.minX * k, origin.minY * k, width, height);
    const ctx = px ? preview.canvas.getContext("2d") : null;
    if (!px || !ctx) return;
    const area = rectArea(px, k, origin.minX * k, origin.minY * k);
    ctx.save();
    ctx.beginPath();
    ctx.rect(px.x, px.y, px.w, px.h);
    ctx.clip();
    ctx.clearRect(px.x, px.y, px.w, px.h);
    ctx.setTransform(k, 0, 0, k, -origin.minX * k, -origin.minY * k);
    scratchLimit = px;
    try {
      const ink: InkPass = { usePressure };
      this.paintPage(ctx, page, box, k, area, ink, preview.window !== undefined);
      this.paintStrokes(ctx, page, grow(area, INK_PAD), usePressure);
      this.paintImages(ctx, page, grow(area, INK_PAD), k, ink, true);
    } finally {
      scratchLimit = null;
      ctx.restore();
    }
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
      const ink: InkPass = { usePressure };
      this.paintPage(ctx, page, box, level, region, ink);
      const inked: Bounds = {
        minX: region.minX - INK_PAD,
        minY: region.minY - INK_PAD,
        maxX: region.maxX + INK_PAD,
        maxY: region.maxY + INK_PAD,
      };
      this.paintStrokes(ctx, page, inked, usePressure);
      this.paintImages(ctx, page, region, level, ink, true);
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

  /**
   * A page region painted afresh into `ctx`, at `level` CSS px per page px:
   * paper, backdrop, pictures, tables, graphs and committed ink, exactly as a
   * tile has them, up to (not including) what sits over the ink. The Zoom
   * box's window uses this so its magnified view keeps the page's template and
   * PDF background, not just the ink. `hidden`, `replaced` and `greyed` are a
   * live erase gesture's preview, as the dry tiles get them. The caller sets
   * the context's transform (page space, device scale included) and clips to
   * the window.
   */
  paintZoomView(
    ctx: CanvasRenderingContext2D,
    page: Page,
    box: PageBox,
    window: Bounds,
    level: number,
    usePressure: boolean,
    hidden?: ReadonlySet<string>,
    replaced?: ReadonlyMap<string, readonly Stroke[]>,
    greyed?: ReadonlySet<string>,
  ): void {
    const ink: InkPass = { usePressure, hidden, replaced, greyed };
    this.paintPage(ctx, page, box, level, window, ink);
    const inked: Bounds = {
      minX: window.minX - INK_PAD,
      minY: window.minY - INK_PAD,
      maxX: window.maxX + INK_PAD,
      maxY: window.maxY + INK_PAD,
    };
    this.paintStrokes(ctx, page, inked, usePressure, hidden, replaced, greyed);
  }

  /**
   * What sits over the ink: a checklist's box, pictures in front of the
   * handwriting, and text boxes. The Zoom box paints these after copying in
   * the wet layer, so a stroke in flight goes under them as it will once it
   * is committed, not over them for the rest of the gesture.
   */
  paintZoomForeground(
    ctx: CanvasRenderingContext2D,
    page: Page,
    window: Bounds,
    level: number,
    usePressure: boolean,
    hidden?: ReadonlySet<string>,
    replaced?: ReadonlyMap<string, readonly Stroke[]>,
    greyed?: ReadonlySet<string>,
  ): void {
    const look = pageLook(page.backdrop, this.paper);
    // A checklist box sits over its ink but under a picture in front of it.
    for (const task of page.tasks ?? []) paintTaskBox(ctx, page, task, look.night);
    const ink: InkPass = { usePressure, hidden, replaced, greyed };
    this.paintImages(ctx, page, window, level, ink, true);
    // Text boxes are DOM on the page, so the tile never has them; a
    // magnified view has no DOM above it, and paints them here as exports do.
    for (const box of page.textBoxes) paintTextBox(ctx, box, look.night);
  }

  /**
   * Copy the part of the wet layer inside `source` (CSS px of this renderer's
   * canvases) into `dest` (CSS px of `ctx`, whose transform is dpr). The Zoom
   * box overlays the in-progress stroke this way, so a stroke drawn in either
   * view appears in both without tracing it twice. Source is clipped to the
   * viewport; a partly off-screen target copies the part that is on screen.
   */
  blitWet(ctx: CanvasRenderingContext2D, source: Bounds, dest: Bounds): void {
    const left = Math.max(0, source.minX);
    const top = Math.max(0, source.minY);
    const right = Math.min(this.screen.width, source.maxX);
    const bottom = Math.min(this.screen.height, source.maxY);
    const sourceW = source.maxX - source.minX;
    const sourceH = source.maxY - source.minY;
    const destW = dest.maxX - dest.minX;
    const destH = dest.maxY - dest.minY;
    if (right <= left || bottom <= top || sourceW <= 0 || sourceH <= 0) return;
    if (destW <= 0 || destH <= 0) return;
    const dpr = this.screen.dpr;
    ctx.drawImage(
      this.wet.canvas,
      left * dpr,
      top * dpr,
      (right - left) * dpr,
      (bottom - top) * dpr,
      dest.minX + ((left - source.minX) / sourceW) * destW,
      dest.minY + ((top - source.minY) / sourceH) * destH,
      ((right - left) / sourceW) * destW,
      ((bottom - top) / sourceH) * destH,
    );
  }

  /**
   * Paint what the wet layer shows into `ctx`, which is in page `box`'s local
   * space at `scale` CSS px per page px: the Zoom box draws the stroke in
   * flight this way, at its own resolution, so it is as sharp while it is
   * written as once it is committed, and shows while the target is off
   * screen. A stroke begun on another (joined) page is placed by the two
   * pages' layout. False when the layer holds something only its pixels have
   * (a dragged picture or selection): the caller copies it ({@link blitWet}).
   */
  paintWetInto(ctx: CanvasRenderingContext2D, box: PageBox, scale: number): boolean {
    const replay = this.wetReplay;
    if (!replay) return !this.wetRaster;
    const from = this.layout.boxes[replay.pageIndex];
    if (!from) return true;
    ctx.save();
    ctx.translate(from.x - box.x, from.y - box.y);
    replay.paint(ctx, scale);
    ctx.restore();
    return true;
  }

  /** The whole page at thumbnail resolution: the fallback while tiles catch up. */
  private buildPreview(page: Page, box: PageBox, usePressure: boolean): Preview | null {
    const window = this.previewWindow ? clampToPage(this.previewWindow(box), box) : null;
    if (window) return this.buildWindowedPreview(page, box, window, usePressure);
    const scale = previewScale(box.width, box.height);
    const canvas = createEl("canvas");
    canvas.width = Math.max(1, Math.ceil(box.width * scale));
    canvas.height = Math.max(1, Math.ceil(box.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    // Saved and restored, so a repair later starts from the same state.
    ctx.save();
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const all: Bounds = { minX: -Infinity, minY: -Infinity, maxX: Infinity, maxY: Infinity };
    const ink: InkPass = { usePressure };
    this.paintPage(ctx, page, box, scale, all, ink);
    this.paintStrokes(ctx, page, all, usePressure);
    this.paintImages(ctx, page, all, scale, ink, true);
    ctx.restore();
    const preview: Preview = { canvas, scale };
    this.previews.set(page.id, preview, canvas.width * canvas.height * 4);
    return preview;
  }

  /** A preview of part of a page, `window` (page px), its longest side {@link WINDOWED_PREVIEW_MAX_SIDE}. */
  private buildWindowedPreview(
    page: Page,
    box: PageBox,
    window: Bounds,
    usePressure: boolean,
  ): Preview | null {
    const w = window.maxX - window.minX;
    const h = window.maxY - window.minY;
    const scale = previewScale(w, h, WINDOWED_PREVIEW_MAX_SIDE);
    const canvas = createEl("canvas");
    canvas.width = Math.max(1, Math.ceil(w * scale));
    canvas.height = Math.max(1, Math.ceil(h * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.save();
    ctx.setTransform(scale, 0, 0, scale, -window.minX * scale, -window.minY * scale);
    const ink: InkPass = { usePressure };
    this.paintPage(ctx, page, box, scale, window, ink);
    const inked: Bounds = {
      minX: window.minX - INK_PAD,
      minY: window.minY - INK_PAD,
      maxX: window.maxX + INK_PAD,
      maxY: window.maxY + INK_PAD,
    };
    this.paintStrokes(ctx, page, inked, usePressure);
    this.paintImages(ctx, page, window, scale, ink, true);
    ctx.restore();
    const preview: Preview = { canvas, scale, window };
    this.previews.set(page.id, preview, canvas.width * canvas.height * 4);
    return preview;
  }

  /**
   * Paper, the page's backdrop, its placed images and its hairline edge, in
   * page space. Images sit above the backdrop and below the ink, so a photo
   * can be written over, as in GoodNotes; `region` culls the ones this tile
   * does not show. The backdrop is told the region too (PDF detail is drawn
   * for it), unless `painterRegion` is false: a whole-page preview is drawn
   * without detail, and is repaired as it was drawn.
   */
  private paintPage(
    ctx: CanvasRenderingContext2D,
    page: Page,
    box: PageBox,
    level: number,
    region: Bounds,
    ink: InkPass,
    painterRegion = true,
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
      ...(painterRegion && Number.isFinite(region.minX) ? { region } : {}),
    });
    if (this.doc) {
      const texts = furnitureText(this.doc, box.index, this.notebookTitle);
      paintFurniture(ctx, page.geometry, texts, pageLook(page.backdrop, this.paper).night);
    }
    this.paintImages(ctx, page, region, level, ink);
    this.paintTables(ctx, page, region);
    this.paintGraphs(ctx, page, region, level);
    // Arrows joining shapes lie under the ink, as the tables and graphs do.
    const night = pageLook(page.backdrop, this.paper).night;
    paintConnectors(ctx, page, night, region, this.hiddenConnectors);
    // Inset by half a device pixel so the hairline lies inside the clip.
    // Not along a join: joined pages read as one sheet, and the desk beside
    // the join carries a mark instead (`renderBackdrops`).
    const hair = 1 / level;
    const joined = joinedSides(this.layout, box.index);
    const [x0, y0] = [hair / 2, hair / 2];
    const [x1, y1] = [box.width - hair / 2, box.height - hair / 2];
    ctx.strokeStyle = this.paper.edge;
    ctx.lineWidth = hair;
    if (!joined.top && !joined.bottom && !joined.left && !joined.right) {
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      return;
    }
    ctx.beginPath();
    if (!joined.top) ctx.rect(x0, y0, x1 - x0, 0);
    if (!joined.bottom) ctx.rect(x0, y1, x1 - x0, 0);
    if (!joined.left) ctx.rect(x0, y0, 0, y1 - y0);
    if (!joined.right) ctx.rect(x1, y0, 0, y1 - y0);
    ctx.stroke();
  }

  /**
   * The page's images that overlap `region`, bottom to top, at `level`
   * device px per page px: those under the ink, or with `front` those in
   * front of it. A sticky note brings its ink, drawn as `ink` says (the
   * erase preview's hidden and replaced strokes included); a hidden note
   * hides its ink too. Notes are painted without an image painter.
   */
  private paintImages(
    ctx: CanvasRenderingContext2D,
    page: Page,
    region: Bounds,
    level: number,
    ink: InkPass,
    front = false,
  ): void {
    const painter = this.imagePainter;
    for (const image of page.images) {
      if ((image.front === true) !== front) continue;
      if (!painter && !image.sticky) continue;
      if (this.hiddenImages.has(image)) continue;
      if (!overlaps(imageBounds(image), region)) continue;
      const inkOnNote = image.sticky
        ? () => {
            for (const stroke of page.strokes) {
              if (stroke.onSticky !== image.id) continue;
              this.paintStroke(
                ctx,
                stroke,
                region,
                ink.usePressure,
                false,
                ink.hidden,
                ink.replaced,
                ink.greyed,
              );
            }
          }
        : undefined;
      drawPlacedImage(ctx, image, painter, level, inkOnNote);
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
    greyed?: ReadonlySet<string>,
  ): void {
    const night = pageLook(page.backdrop, this.paper).night;
    // A sticky note's ink is drawn with its note (`paintImages`).
    const notes = noteIdsOf(page.images);
    for (const stroke of page.strokes) {
      if (isNoteInk(stroke, notes)) continue;
      this.paintStroke(ctx, stroke, region, usePressure, night, hidden, replaced, greyed);
    }
  }

  /**
   * One stroke as the tiles draw it: left out when hidden, grey while the
   * eraser holds it, its pieces while the eraser cuts it (a piece grey when
   * it is the stretch being cut away).
   */
  private paintStroke(
    ctx: CanvasRenderingContext2D,
    stroke: Stroke,
    region: Bounds,
    usePressure: boolean,
    night: boolean,
    hidden?: ReadonlySet<string>,
    replaced?: ReadonlyMap<string, readonly Stroke[]>,
    greyed?: ReadonlySet<string>,
  ): void {
    if (hidden?.has(stroke.id) || this.hiddenStrokes.has(stroke.id)) return;
    const pieces = replaced?.get(stroke.id);
    if (pieces && stroke.tool === "highlighter" && decorOf(stroke) === null) {
      // Laid down in one coat, as the highlight they are cut from was: then
      // they differ from it only where the eraser went, which is all the
      // eraser has painted again.
      const isGrey = (piece: Stroke): boolean => greyed?.has(piece.id) === true;
      this.paintCoat(
        ctx,
        pieces.filter((piece) => !isGrey(piece)),
        region,
        usePressure,
        night,
        false,
      );
      this.paintCoat(ctx, pieces.filter(isGrey), region, usePressure, night, true);
      return;
    }
    if (pieces) {
      for (const piece of pieces) {
        this.paintEntry(ctx, piece, region, usePressure, night, greyed?.has(piece.id) === true);
      }
      return;
    }
    this.paintEntry(ctx, stroke, region, usePressure, night, greyed?.has(stroke.id) === true);
  }

  private paintEntry(
    ctx: CanvasRenderingContext2D,
    stroke: Stroke,
    region: Bounds,
    usePressure: boolean,
    night: boolean,
    grey = false,
  ): void {
    const entry = this.pathEntry(stroke, usePressure);
    if (entry.runs.length === 0 || !entry.bounds || !overlaps(entry.bounds, region)) return;
    const faded = this.fadedStrokes.has(stroke.id);
    if (faded) {
      ctx.save();
      ctx.globalAlpha *= FADED_INK_ALPHA;
    }
    // Grey is only a colour: the outline traced for the stroke is the same.
    const look = grey ? erasingLook(stroke) : stroke;
    paintStroke(ctx, entry, look, this.highlighterAlpha, night, decorOf(look), stroke.pts);
    if (faded) ctx.restore();
  }

  /** Highlighter pieces of one stroke painted together, in one coat (`paintOnce`). */
  private paintCoat(
    ctx: CanvasRenderingContext2D,
    pieces: readonly Stroke[],
    region: Bounds,
    usePressure: boolean,
    night: boolean,
    grey: boolean,
  ): void {
    const runs: InkRun[] = [];
    const paths: Path2D[] = [];
    let first: Stroke | null = null;
    for (const piece of pieces) {
      const entry = this.pathEntry(piece, usePressure);
      if (entry.runs.length === 0 || !entry.bounds || !overlaps(entry.bounds, region)) continue;
      runs.push(...entry.runs);
      paths.push(...entry.paths);
      first ??= piece;
    }
    if (!first) return;
    const faded = this.fadedStrokes.has(first.id);
    if (faded) {
      ctx.save();
      ctx.globalAlpha *= FADED_INK_ALPHA;
    }
    paintStroke(
      ctx,
      { runs, paths },
      grey ? erasingLook(first) : first,
      this.highlighterAlpha,
      night,
    );
    if (faded) ctx.restore();
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
    const cached = this.paths.get(stroke);
    const tilt = stroke.tilt;
    if (
      cached &&
      cached.pts === pts &&
      cached.tilt === tilt &&
      cached.pressure === pressure &&
      Object.is(cached.size, stroke.size) &&
      Object.is(cached.nib, stroke.nib) &&
      cached.count === n &&
      Object.is(cached.ends[0], pts[0]) &&
      Object.is(cached.ends[1], pts[1]) &&
      Object.is(cached.ends[2], pts[n - 3]) &&
      Object.is(cached.ends[3], pts[n - 2])
    ) {
      return cached;
    }
    let runs: InkRun[] = [];
    let bounds: Bounds | null = null;
    if (n >= 3) {
      const shape = stroke.shape !== undefined;
      runs = inkRuns(pts, penOptions(stroke.size, pressure, stroke.nib), shape, tilt);
      const b = strokeBounds(stroke);
      if (b) {
        // Arrowheads reach sideways past the line's ends; a tilted brush, past its nib.
        const pad = inkReach(stroke) + (stroke.heads ? HEAD_MAX / 2 : 0);
        bounds = { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
      }
    }
    const entry: PathEntry = {
      pressure,
      size: stroke.size,
      nib: stroke.nib,
      count: n,
      ends: [pts[0], pts[1], pts[n - 3], pts[n - 2]],
      pts,
      tilt,
      runs,
      paths: runs.map(pathOf),
      bounds,
    };
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
   * Draw connectors over what the wet layer already shows (a dragged
   * selection's draft, drawn just before), routed to where the drag has
   * their shapes: they follow the drag, out of the tiles meanwhile.
   */
  paintWetConnectors(pageIndex: number, routed: readonly RoutedConnector[]): void {
    const box = this.layout.boxes[pageIndex];
    const page = this.doc?.pages[pageIndex];
    if (!box || !page || routed.length === 0) return;
    const ctx = this.wet.ctx;
    this.toLayoutSpace(ctx);
    this.enterPage(ctx, box);
    const night = pageLook(page.backdrop, this.paper).night;
    for (const item of routed) paintConnector(ctx, item, night);
    ctx.restore();
    this.wetReplay = null;
    this.setWetVisible(true);
  }

  /**
   * Draw the lasso being drawn (page space, flat `[x, y, …]`) on the wet
   * layer: a dashed line, no filled area (Joost on PR #59), in the selection
   * box's colour. `closed` joins its end back to its start (a box, a span of
   * lines); a freehand lasso is left open while the pen is down, as
   * Goodnotes draws it, and closes only on the lift.
   */
  renderLasso(pageIndex: number, loop: readonly number[], closed = true): void {
    const box = this.layout.boxes[pageIndex];
    const ctx = this.wet.ctx;
    this.wipe(ctx);
    if (!box || loop.length < 4) return;
    this.toLayoutSpace(ctx);
    this.enterWetPage(ctx, box);
    const paint = (c: CanvasRenderingContext2D, scale: number): void => {
      c.beginPath();
      c.moveTo(loop[0], loop[1]);
      for (let i = 2; i + 1 < loop.length; i += 2) c.lineTo(loop[i], loop[i + 1]);
      if (closed) c.closePath();
      selectionLine(c, scale);
      c.lineJoin = "round";
      c.stroke();
    };
    paint(ctx, this.safeScale);
    ctx.restore();
    this.wetReplay = { pageIndex, paint };
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
   * pictures (text boxes are DOM, and stay upright). `clip` false draws it
   * past its page's edge too: a move can carry it onto another page.
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
    clip = true,
  ): void {
    const box = this.layout.boxes[pageIndex];
    const ctx = this.wet.ctx;
    this.wipe(ctx);
    if (!box) return;
    this.toLayoutSpace(ctx);
    // Moving, the draft may be drawn over another page (it is dropped there);
    // joined pages are one sheet, so it is clipped to the sheets either way.
    if (clip || this.layout.joined === true) this.enterWetPage(ctx, box);
    else this.enterPage(ctx, box, false);
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
    const draw = (stroke: Stroke, dark: boolean): void => {
      const entry = this.pathEntry(stroke, usePressure);
      paintStroke(ctx, entry, stroke, this.highlighterAlpha, dark, decorOf(stroke), stroke.pts);
    };
    const notes = noteIdsOf(images);
    const pictures = (front: boolean): void => {
      for (const image of images) {
        if ((image.front === true) !== front) continue;
        const inkOnNote = image.sticky
          ? () => {
              for (const stroke of strokes) if (stroke.onSticky === image.id) draw(stroke, false);
            }
          : undefined;
        drawPlacedImage(ctx, image, this.imagePainter, this.deviceScale, inkOnNote);
      }
    };
    pictures(false);
    for (const stroke of strokes) if (!isNoteInk(stroke, notes)) draw(stroke, night);
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
      (stroke.onSticky !== undefined && page && isNoteInk(stroke, noteIdsOf(page.images))) ||
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
      const k = preview.scale;
      const origin = preview.window ?? { minX: 0, minY: 0 };
      ctx.setTransform(k, 0, 0, k, -origin.minX * k, -origin.minY * k);
      ctx.beginPath();
      ctx.rect(0, 0, box.width, box.height);
      ctx.clip();
      paintStroke(ctx, entry, stroke, this.highlighterAlpha, night, decorOf(stroke), stroke.pts);
      ctx.restore();
    }
    // The tiles under it changed; the rest of the dry layer did not. A
    // stand-in from the last zoom has not got it.
    this.dropFallback(box, bounds);
    this.damageDry(box, bounds);
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
  renderImageDraft(pageIndex: number, image: ImageElement, usePressure = false): void {
    const box = this.layout.boxes[pageIndex];
    const ctx = this.wet.ctx;
    this.wipe(ctx);
    if (!box || (!this.imagePainter && !image.sticky)) return;
    this.toLayoutSpace(ctx);
    this.enterWetPage(ctx, box);
    drawPlacedImage(
      ctx,
      image,
      this.imagePainter,
      this.deviceScale,
      this.draftInk(pageIndex, image, usePressure),
    );
    ctx.restore();
    this.setWetVisible(true);
  }

  /**
   * The ink of the note `draft` is a moved copy of (same id), drawn where
   * the draft has the note: the cached outlines under the map from the
   * note's frame to the draft's, as `MoveNoteInk` will commit it.
   */
  private draftInk(
    pageIndex: number,
    draft: ImageElement,
    usePressure: boolean,
  ): (() => void) | undefined {
    const page = this.doc?.pages[pageIndex];
    const note = draft.sticky ? page?.images.find((image) => image.id === draft.id) : undefined;
    if (!page || !note) return undefined;
    const m: Affine = noteMove(note, draft);
    const ctx = this.wet.ctx;
    return () => {
      ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
      for (const stroke of page.strokes) {
        if (stroke.onSticky !== note.id) continue;
        const entry = this.pathEntry(stroke, usePressure);
        paintStroke(ctx, entry, stroke, this.highlighterAlpha, false, decorOf(stroke), stroke.pts);
      }
    };
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
    this.enterWetPage(ctx, box);
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
    this.enterWetPage(ctx, box);
    const night = this.nightAt(pageIndex);
    const paint = (c: CanvasRenderingContext2D): void => {
      for (const pts of strokes) fillStroke(c, pts, style, this.highlighterAlpha, night);
    };
    paint(ctx);
    ctx.restore();
    this.wetReplay = { pageIndex, paint };
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
    this.enterWetPage(ctx, box);
    const night = this.nightAt(pageIndex);
    const paint = (c: CanvasRenderingContext2D): void => {
      for (const stroke of strokes) {
        fillStroke(c, stroke.pts, styleOf(stroke, false), this.highlighterAlpha, night);
      }
    };
    paint(ctx);
    ctx.restore();
    this.wetReplay = { pageIndex, paint };
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
    this.enterWetPage(ctx, box);
    const night = this.nightAt(pageIndex);
    const paint = (c: CanvasRenderingContext2D): void => {
      paintStroke(c, { runs }, style, this.highlighterAlpha, night);
    };
    paint(ctx);
    ctx.restore();
    this.wetReplay = { pageIndex, paint };
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
    ...(stroke.tilt !== undefined ? { tilt: stroke.tilt } : {}),
  };
}

/**
 * How far a stored stroke's ink can reach past its centreline, page px, at
 * most: its nib (pressure draws it at up to 0.8 of that), times the most the
 * Pencil's tilt widened it.
 */
export function inkReach(stroke: Pick<Stroke, "size" | "tilt" | "shape">): number {
  return stroke.shape === undefined ? stroke.size * widestTiltFactor(stroke.tilt) : stroke.size;
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
    // Times whatever the caller set: a faded stroke's alpha (replay).
    ctx.globalAlpha *= highlighterAlpha;
    ctx.globalCompositeOperation = night ? NIGHT_HIGHLIGHTER_BLEND : DAY_HIGHLIGHTER_BLEND;
  }
  // Ink colour is absolute (contracts/design-brief.md): a stored colour is
  // never changed, and never remapped to suit the app theme — that is how a
  // note written on one device stays legible on another. Only a night page
  // (dark pages, the view setting) *shows* it through `./night`'s mapping.
  if (!night) ctx.fillStyle = style.color;
  else ctx.fillStyle = highlighter ? nightHighlighter(style.color) : nightColor(style.color);
  if (decor && pts && ink.runs.length > 0) paintShape(ctx, pts, ink.runs[0].width, decor, night);
  else if (highlighter) paintOnce(ctx, ink.runs, ink.paths);
  else paintInk(ctx, ink.runs, ink.paths);
  ctx.restore();
}

/** The canvas {@link paintOnce} draws into; grown as needed, never shrunk. */
let onceCanvas: HTMLCanvasElement | null = null;

/**
 * The device px of the canvas being repaired, while one is (a tile's or a
 * preview's stale area): nothing is drawn outside them, so {@link paintOnce}
 * lays out its scratch over them alone. A highlight crossing a tile was
 * drawn into a scratch the size of the tile on every eraser dab near it.
 */
let scratchLimit: PixelRect | null = null;

/**
 * Paint translucent ink so no part of it is laid down twice (FineNotes#85).
 * On the iPad, WebKit darkened a wide highlighter line in dots along its
 * length, though the line was one path stroked once and its points never
 * doubled back (the same strokes drew evenly on the desktop). So the ink is
 * drawn opaque into a scratch canvas, where any overlap is the same colour,
 * and laid down once with `ctx`'s alpha and blend. Where there is no
 * scratch canvas to be had (the tests' stand-in contexts) it is drawn as is.
 */
function paintOnce(
  ctx: CanvasRenderingContext2D,
  runs: readonly InkRun[],
  paths?: readonly Path2D[],
): void {
  if (!("getTransform" in ctx) || typeof createEl !== "function") {
    paintInk(ctx, runs, paths);
    return;
  }
  const m = ctx.getTransform();
  const ink = inkPixelRect(runs, m, ctx.canvas.width, ctx.canvas.height);
  const rect = ink && scratchLimit ? overlapOf(ink, scratchLimit) : ink;
  if (!rect) return;
  const canvas = (onceCanvas ??= createEl("canvas"));
  if (canvas.width < rect.w) canvas.width = rect.w;
  if (canvas.height < rect.h) canvas.height = rect.h;
  const once = canvas.getContext("2d");
  if (!once) {
    paintInk(ctx, runs, paths);
    return;
  }
  once.setTransform(1, 0, 0, 1, 0, 0);
  once.globalAlpha = 1;
  once.globalCompositeOperation = "source-over";
  once.clearRect(0, 0, rect.w, rect.h);
  once.setTransform(m.a, m.b, m.c, m.d, m.e - rect.x, m.f - rect.y);
  once.fillStyle = ctx.fillStyle;
  paintInk(once, runs, paths);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(canvas, 0, 0, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h);
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
  const runs = inkRuns(points, penFor(style), style.shape === true, style.tilt);
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
  const alpha = options.highlighterAlpha ?? DEFAULT_HIGHLIGHTER_ALPHA;
  // A sticky note keeps its colour on dark pages, so its ink keeps its own too.
  const notes = noteIdsOf(page.images);
  const pictures = (front: boolean): void => {
    for (const image of page.images) {
      if ((image.front === true) !== front) continue;
      const inkOnNote = image.sticky
        ? () => {
            for (const stroke of page.strokes) {
              if (stroke.onSticky !== image.id) continue;
              fillStroke(ctx, stroke.pts, styleOf(stroke, options.usePressure), alpha, false);
            }
          }
        : undefined;
      drawPlacedImage(ctx, image, options.images ?? null, k, inkOnNote);
    }
  };
  pictures(false);
  // Tables lie under the ink, so handwriting in a cell shows over its lines.
  for (const table of page.tables ?? []) paintTable(ctx, table, look.night);
  // So do graphs: a note written over a curve shows over it.
  for (const graph of page.graphs ?? []) {
    paintGraph(ctx, graph, { level: k, night: look.night, paper: look.paper });
  }
  // And the arrows joining shapes.
  paintConnectors(ctx, page, look.night);

  for (const stroke of page.strokes) {
    if (isNoteInk(stroke, notes)) continue;
    fillStroke(ctx, stroke.pts, styleOf(stroke, options.usePressure), alpha, look.night);
  }
  // Handwriting made a checklist item has its box beside it, in its ink colour.
  for (const task of page.tasks ?? []) paintTaskBox(ctx, page, task, look.night);
  // A picture in front of the ink (a sticker on handwriting), under the text.
  pictures(true);

  // Over the ink, as on the page, where the text boxes are DOM above the ink
  // canvas: a filled shape is a ground the text sits on, and a filled box
  // covers the ink under it in an export just as it does on screen.
  for (const box of page.textBoxes) paintTextBox(ctx, box, look.night);
  ctx.restore();
}

/**
 * Paint a handwritten task's box in page space where the page shows it
 * (`taskBoxRect`): a rounded square in the colour of its first stroke,
 * ticked when done. Nothing when its ink is gone.
 */
export function paintTaskBox(
  ctx: CanvasRenderingContext2D,
  page: Page,
  task: InkTask,
  night = false,
): void {
  const bounds = inkBounds(page, task.strokes);
  if (!bounds) return;
  const { x, y, size } = taskBoxRect(bounds);
  const first = page.strokes.find((s) => s.id === task.strokes[0]);
  const color = first?.color ?? "#1f1f1f";
  ctx.save();
  ctx.strokeStyle = night ? nightColor(color) : color;
  ctx.lineWidth = Math.max(1.2, size / 11);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, size * 0.2);
  ctx.stroke();
  if (task.done === true) {
    ctx.beginPath();
    ctx.moveTo(x + size * 0.22, y + size * 0.52);
    ctx.lineTo(x + size * 0.42, y + size * 0.72);
    ctx.lineTo(x + size * 0.8, y + size * 0.28);
    ctx.stroke();
  }
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
    row.forEach((cell, c) => {
      if (skip && skip.row === r && skip.col === c) return;
      if (cell.lines.every((line) => line.runs.length === 0)) return;
      const style = cellStyle(table, r, c);
      ctx.font = canvasFont(style, style.fontSize);
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
/** The px two rectangles share, or null when they share none. */
function overlapOf(a: PixelRect, b: PixelRect): PixelRect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

/** Whole px covering a fractional device rectangle, and one more all round (its soft edge). */
function outwardRect(x: number, y: number, w: number, h: number): PixelRect {
  const x0 = Math.floor(x) - 1;
  const y0 = Math.floor(y) - 1;
  return { x: x0, y: y0, w: Math.ceil(x + w) + 1 - x0, h: Math.ceil(y + h) + 1 - y0 };
}

function padBounds(b: Bounds, pad: number): Bounds {
  return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
}

/** `window` cut to the page, or null when nothing of it is on the page. */
function clampToPage(window: Bounds | null, box: PageBox): Bounds | null {
  if (!window) return null;
  const out: Bounds = {
    minX: Math.max(0, window.minX),
    minY: Math.max(0, window.minY),
    maxX: Math.min(box.width, window.maxX),
    maxY: Math.min(box.height, window.maxY),
  };
  return out.maxX > out.minX && out.maxY > out.minY ? out : null;
}
