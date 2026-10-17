import { bindScrollThumb } from "./scroll-thumb-drag";
import type { PdfRenderArea } from "../canvas/pdf-raster";
/**
 * The notebook's drawing surface: the part of `InkView` the pen touches.
 *
 * It builds the page stack and its canvases (backdrop, committed "dry" ink,
 * the "wet" stroke in progress), turns pointer events into the tools' work
 * — pen, highlighter, shapes, eraser, lasso, text — and owns scrolling,
 * zoom, undo and redo, the page counter and the diagnostics HUD. Files,
 * transcription and settings are the host's business: the surface reports
 * each change through `onChange` and the host decides when to save.
 *
 * What it puts inside the host element:
 *
 *   .goodobsidian-surface          position:relative, clips
 *     canvas.backdrop           paper, rules/grid, PDF rasters, page edges
 *     canvas.dry                committed ink, clipped per page
 *     canvas.wet                the in-progress stroke
 *     .goodobsidian-scroll         transparent overlay; owns scrolling + input
 *       .goodobsidian-paper        spacer that defines the scroll range
 *         .goodobsidian-textboxes  page text boxes (DOM)
 *         .goodobsidian-lock-badges  a lock on each locked picture (lasso only)
 *         .goodobsidian-image-ui   the selected image's frame, handles and rotate knob
 *         .goodobsidian-crop-ui    crop mode: the whole picture's box and the crop frame
 *         .goodobsidian-selection-ui  the lasso selection's frame, the action bar, its menu
 *     .goodobsidian-pageindicator  "3 of 18"
 *     .goodobsidian-hud            pointer diagnostics (debug only)
 *
 * ## Coordinates — read this before changing anything here
 *
 * `src/canvas/page-layout.ts` stacks the document's pages into **layout space**
 * at their intrinsic sizes. The view then picks
 * `scale = (surfaceWidth / layout.width) * userZoom` and scrolls. Pointer
 * positions come in as client px, are converted to layout space, and only then
 * to **page space** relative to whichever page was hit. Stored stroke
 * coordinates are page space and *never* depend on the window: that one-way
 * street is the whole reason this fork is paginated (see the coordinate-drift
 * bug quoted in research/RESEARCH.md).
 */

import { Notice, Platform, setIcon } from "obsidian";
import {
  DEFAULT_HIGHLIGHTER_ALPHA,
  FALLBACK_PRESSURE,
  HOLD_MS,
  HOLD_RADIUS,
  MIN_SAMPLE_DISTANCE,
  PALETTE,
  SNAP_CLOSE_TOLERANCE,
} from "../constants";
import {
  type BackdropPainter,
  type ImagePainter,
  Renderer,
  type StrokeStyle,
  decorOf,
  penFor,
} from "../canvas/renderer";
import {
  ROUND_RADIUS,
  type ShapeStyle,
  commonShapeStyle,
  readShapeToolStyle,
  splitFill,
  styleNewShape,
} from "../model/shape-style";
import {
  type BoxFrame,
  type LassoFilter,
  type LassoMode,
  LassoPath,
  type Polygon,
  anchorCorner,
  boundsCentre,
  boundsCorner,
  boxInLasso,
  clampGroupDelta,
  cornerScale,
  hitSelectionCorner,
  hitSelectionKnob,
  lassoTakesStroke,
  minScaleForSide,
  polygonOf,
  rectLoop,
  scaleBounds,
  selectionKnobPoint,
  smoothLoop,
  selectionBounds,
  strokeInLasso,
  textBoxFrame,
} from "../canvas/lasso";
import {
  HANDLE_HIT_RADIUS_PX,
  IMAGE_CORNERS,
  IMAGE_EDGES,
  type ImageCorner,
  type ImagePart,
  ROTATE_HANDLE_OFFSET_PX,
  dragImageHandle,
  edgeHandlesFit,
  fromImageLocal,
  hitImagePart,
  imageBounds,
  imageHandlePoint,
  moveImage,
  rotateHandlePoint,
  rotateImage,
  rotationOf,
  sameTransform,
  sweptTurn,
  topImageAt,
  transformOf,
} from "../canvas/image-geometry";
import {
  cropResult,
  croppedBox,
  dragCrop,
  isFullCrop,
  minCropFractions,
  pictureFraction,
  sameCrop,
  shownCrop,
  uncroppedBox,
} from "../canvas/image-crop";
import {
  LIGHT_PAPER,
  type PaperTheme,
  pageLook,
  shownColor,
  writingLines,
} from "../canvas/backdrop";
import { nightHighlighter } from "../canvas/night";
import {
  type LineSpan,
  RuledEraser,
  inLineSpan,
  lineSpan,
  linedItems,
  spanOutline,
} from "../canvas/ruled-ink";
import { type LineBlock, lineAt, lineOfBounds } from "../canvas/writing-lines";
import {
  type SpaceLayout,
  type SpacePlan,
  type SpaceTarget,
  planInsertSpace,
  spaceHandles,
  spaceStrip,
  spaceTargetAt,
} from "../canvas/insert-space";
import type { ViewportState } from "../canvas/viewport";
import {
  type DocumentLayout,
  type PageBox,
  type ScrollDirection,
  boxAtPoint,
  currentPageIndex,
  currentPageIndexInRow,
  layoutPages,
  pageSnapIndex,
  pullAddProgress,
  rowPageScrollRange,
  rowScrollInsets,
  rowScrollXForPage,
  rowSlotGap,
  rowTurnsPages,
  scrollTopForPage,
  inkBeyondPage,
} from "../canvas/page-layout";
import { strokeFillHit, strokeHitByPoint } from "../canvas/hit-test";
import {
  EYEDROP_REACH_PX,
  type EyedropResult,
  type StoredCandidate,
  averagePixels,
  eyedropColor,
  eyedropSquare,
  nearestStored,
  textBoxCandidates,
} from "../canvas/eyedropper";
import { Eyedropper } from "./eyedropper";
import { type EraserFilter, eraseCircleFromStroke, eraserTakes } from "../ink/stroke-eraser";
import {
  MAX_SCALE,
  anchorScrollDelta,
  fitPageZoom,
  nextZoomFloor,
  wheelZoomFactor,
} from "../canvas/zoom";
import { KineticScroller, easeOutCubic, softZoom } from "../canvas/scroll-physics";
import { scrollThumb } from "../canvas/scroll-thumb";
import { zoomPercent } from "../model/units";
import { prefersReducedMotion } from "./motion";
import {
  BRUSH_PRESSURE,
  type Smoothing,
  StrokeBuilder,
  type StrokeBuilderOptions,
} from "../ink/stroke-builder";
import { InkTracer } from "../ink/freehand";
import { lineOfHighlight } from "../ink/straighten";
import { explainShape, recognizeAtZoom } from "../ink/shape-recognizer";
import {
  SCRIBBLE_COVERAGE,
  detectScribble,
  measureScribble,
  scribbleCoverage,
  scribbleMayErase,
} from "../ink/scribble";
import { gestureLoopOf, penGesturesOf } from "../ink/pen-gestures";
import {
  type Pt,
  STAR_ASPECT,
  type ShapePreset,
  isConnectorPreset,
  presetGeometry,
  shapePivot,
  transformShape,
} from "../ink/shape-geometry";
import {
  type TableStroke,
  draggedTableBox,
  tableStrokes,
  tappedTableBox,
} from "../ink/table-geometry";
import {
  type Bounds,
  type ImageCrop,
  type ImageElement,
  type InkDocument,
  type Page,
  type PageGeometry,
  type PdfBackdrop,
  type ShapeKind,
  type Stroke,
  type TextBoxElement,
  type Tool,
  strokeBounds,
  strokeCount,
} from "../model/document";
import { type TextLayout, type TextSelection, selectText, textUnder } from "../canvas/pdf-text";
import { highlightText, isHighlight, textHighlightStrokes } from "../model/text-highlight";
import { DUPLICATE_OFFSET, duplicateImage, nextImageId } from "../model/images";
import {
  AddElements,
  type ElementLists,
  type IdSource,
  type PageElements,
  RecolorStrokes,
  RemoveElements,
  RestyleShapes,
  ReorientElements,
  type Reorientation,
  ScaleElements,
  TranslateElements,
  copyElements,
  elementsOnPage,
  isEmptySelection,
  reorientPoint,
  textScaleRange,
} from "../model/selection-commands";
import {
  CropImage,
  type FlipAxis,
  FlipImage,
  type ImageLayer,
  ReorderImage,
  SetImageLocked,
  canReorderImage,
} from "../model/image-commands";
import { InkClipboard, pasteCopies, pastePlacement, sameSpotTaken } from "../model/clipboard";
import {
  AddTextBoxToPage,
  ClearPage,
  CompositeCommand,
  RemoveStrokesFromPage,
  RemoveTextBoxFromPage,
  SetTextBoxFrame,
  type TextBoxFrame,
} from "../model/page-commands";
import { isLinked, linkStrokes, linksOf, withLinkedStrokes } from "../model/links";
import { textSegments } from "../model/text-links";
import type { HandwrittenLink } from "../recognition/handwritten-links";
import {
  type Command,
  type ImageTransform,
  InsertImage,
  RemoveImage,
  TransformImage,
} from "../model/commands";
import { ReplaceStrokesOnPage, type StrokeReplacement } from "../model/erase-commands";
import { addStrokesTimed } from "../model/recording-commands";
import { SetTextBoxStyle } from "../model/text-commands";
import {
  DEFAULT_TEXT_STYLE,
  type TextStyle,
  type TextStylePatch,
  changesTextStyle,
  fontFamilyOf,
  lineHeightOf,
  normalizeBorder,
  textStyleOf,
} from "../model/text-style";
import { type ListKind, type TextEdit, continueList, toggleList } from "../model/text-list";
import { keyboardHeight } from "./keyboard";
import { revealDelta } from "./text-reveal";
import { DEFAULT_SHAPE_COLOR, pushRecentColor, sameColor } from "../model/colors";
import { canvasFont, fitTextWidth, textDecorationOf, textInset } from "../canvas/text-layout";
import { History } from "../model/history";
import {
  PointerController,
  type PointerControllerCallbacks,
  type PointerDebugRecord,
  type PointerSample,
  type PressRoute,
  deliversCoalescedSamples,
} from "../input/pointer-controller";
import { undoesPalm } from "../input/palm-rejection";
import {
  type BarrelAction,
  type PressInput,
  type PressOverride,
  barrelActionOf,
  dragZoom,
  pressOverride,
  stylusButtonDown,
} from "../input/pen-modifiers";
import { LASER_COLOR, LASER_GLOW_PX, LASER_WIDTH_PX, LaserTrail } from "../canvas/laser-trail";
import { REJOIN_MS, REJOIN_PX, rejoinsStroke } from "../input/pen-rejoin";
import {
  type ActiveTool,
  type ToolbarState,
  eraserFilterFor,
  eraserModeFor,
  eraserSizeFor,
  lassoFilterFor,
  lassoModeFor,
  shapeModeFor,
  strokeWidthFor,
  tableSizeFor,
} from "./toolbar";
import { SelectionActionBar, onTap } from "./selection-bar";
import { FINGER_HOLD_MS, FingerHold } from "../input/finger-hold";
import { cleanPastedText, inkFirst, pastedTextOrigin } from "./paste-choice";
import {
  canReadSystemClipboard,
  onSystemTextWritten,
  readSystemClipboard,
  writeSystemText,
} from "./system-clipboard";
import { PullAddIndicator } from "./pull-add-indicator";
import { scrollDirectionOf } from "../model/scroll-direction";
import type { SelectionAction } from "./selection-bar-model";
import { type KeyAction, keyOutcome } from "./surface-keys";
import {
  type ToolLift,
  type ToolUse,
  continuesUse,
  drawingToolOf,
  selectedTool,
  toolAfterUse,
} from "./tool-return";
import { PointerHud } from "./pointer-hud";
import { SizeWait, backingScale } from "./surface-size";
import { StrokeIndex } from "./stroke-index";
import { REST_MS, ViewRest } from "./view-rest";
import { IdSequence, strokeIdsOf, textBoxIdsOf } from "./id-sequence";
import { type PenCursorStyle, cursorCss, cursorFor, cursorSize, cursorToolOf } from "./pen-cursor";

/** Zoom in multiplies the zoom by this, and Zoom out divides by it. */
const ZOOM_STEP = 1.25;

/**
 * Rasterising budget for a frame that is scrolling or zooming, in ms. The
 * rest of a 16.7 ms frame is the blits, the compositor and headroom; a tile
 * the budget skips is drawn from the page preview until the next frame.
 */
const SCROLL_FRAME_BUDGET_MS = 6;
/** Budget for one idle prefetch frame (tiles just off screen, page previews). */
const PREFETCH_BUDGET_MS = 5;
/** How long the zoom takes to spring back inside its limits after a pinch. */
const ZOOM_SPRING_MS = 260;
/** A wheel/trackpad zoom counts as settled this long after its last event. */
const WHEEL_ZOOM_SETTLE_MS = 160;
/** A wheel scroll across a row of pages settles on a page this long after its last event. */
const WHEEL_SNAP_MS = 180;
/** One wheel "line" (deltaMode 1), in CSS px. */
const WHEEL_LINE_PX = 16;
/** ↑ and ↓ scroll this far, in CSS px — GoodNotes' step, measured. */
const ARROW_SCROLL_PX = 150;
/** …and glide there this fast, so a held key reads as a scroll, not a jump. */
const ARROW_SCROLL_MS = 120;
/**
 * Ink this far past the page's edge (screen px at fit zoom) earns the
 * "outside the page" notice; a tail that just grazes the edge does not.
 */
const OFF_PAGE_TOLERANCE_PX = 24;
/** How long the notice stays, and how long it takes to fade. */
const OFF_PAGE_NOTICE_MS = 4000;
const OFF_PAGE_FADE_MS = 200;
/**
 * How near a PDF's text the highlighter must come down to snap to it, in
 * screen px at fit-to-page ({@link InkSurface.atFitZoom}): a Pencil aimed at
 * a line of small print lands a little above or below it.
 */
const TEXT_SNAP_SLOP_PX = 8;

/** The shortest highlight, in screen px, that becomes a straight line on lift when drawn as one. */
const HIGHLIGHT_LINE_MIN_PX = 24;
/** How long the snapped text and its Copy stay up. */
const TEXT_COPY_NOTICE_MS = 6000;

/*
 * The page counter, the scroll thumbs and the zoom readout show only while
 * the page moves, as GoodNotes' do (research/goodnotes-smoothness §2): they
 * appear at once and fade this long after the last movement.
 */
/** Scroll thumbs: gone about a second after the page stops. */
const THUMB_HOLD_MS = 1000;
/** The page counter. */
const COUNTER_HOLD_MS = 1800;
/** The zoom readout, a beat after the counter. */
const ZOOM_READOUT_HOLD_MS = 2000;
/** The gap between linked ink and its underline, screen px. */
const LINK_UNDERLINE_GAP_PX = 3;
/** How far below the top of the view a section lands when the contents goes to it, screen px. */
const SECTION_LEAD_PX = 96;
/** How long "Undo" or "Redo" from a finger double tap stays in the readout pill. */
const READOUT_WORD_HOLD_MS = 900;
/** Gap between a scroll thumb and the edges of the surface, CSS px. */
const THUMB_INSET = 4;

/** A preset-shape press that moves less than this (page px) is a tap. */
const SHAPE_TAP_SLOP = 6;
/** Size, in page px, of a preset shape placed with a tap. */
const SHAPE_DEFAULT_SIZE = 160;
/** Width a table is ruled at, page px: under the thinnest pen, as ruled paper is. */
const TABLE_STROKE_WIDTH = 1.5;
/**
 * A pointercancel of a pen that has sat still for at least this long counts
 * as a hold. WebKit's long-press recogniser cancels a stationary pointer at
 * about the same moment our own timer would fire, so the race must not lose
 * the snap; a genuine mid-stroke cancel comes far sooner than this.
 */
const CANCEL_HOLD_FLOOR_MS = 250;

/** How many recent strokes the shape diagnostics keep. */
const DIAGNOSTICS_MAX = 24;

/**
 * One drawn stroke, as the "Copy shape diagnostics" command reports it: the
 * pointer stream's shape, whether the hold fired, what the recogniser said at
 * the hold and at the lift, and the retained points so the verdict can be
 * reproduced offline. Page px, rounded to 0.1.
 */
interface StrokeDiagnostic {
  /** ms since the surface was created. */
  at: number;
  tool: string;
  pointer: string;
  /** pointermoves, and coalesced samples inside them. */
  moves: number;
  samples: number;
  /** ms from pointerdown to the first pointermove, and to the end. */
  firstMoveMs: number;
  durationMs: number;
  end: "up" | "cancel" | "cancel-as-hold";
  /** The hold timer fired while the pen was down, and its verdict. */
  holdFired: boolean;
  holdVerdict: string;
  /** Whether the lift counted as held, and the recogniser's verdict then. */
  held: boolean;
  liftVerdict: string;
  committed: string;
  pts: number[];
}

/**
 * Broad-phase margin for the standard eraser: half the widest stroke the pens
 * can lay down (largest width 12 x the highlighter's 4x nib), since the cut
 * reaches that far past a stroke's centreline.
 */
const MAX_STROKE_HALF_WIDTH = 24;

/** How a surface is set up. The plugin's settings supply most of it. */
export interface InkSurfaceOptions {
  /**
   * Let the wet layer (the stroke being drawn) skip the compositor with a
   * `desynchronized` 2D context, where the platform offers one.
   */
  desynchronizedCanvas: boolean;
  /** Opacity of highlighter ink, 0–1. */
  highlighterAlpha: number;
  /**
   * The paper theme: light, or dark pages (the view setting). Pages are
   * paper-white by default no matter what the Obsidian theme is doing
   * (contracts/design-brief.md).
   */
  paper?: PaperTheme;
  /** Open with the diagnostics HUD showing (see {@link InkSurface.setDebug}). */
  debug: boolean;
  /** Colours the selection's "Colour" row offers (the pen's palette); default {@link PALETTE}. */
  palette?: readonly string[];
}

/** What the surface tells its host, and asks it. Only `onChange` is required. */
export interface InkSurfaceCallbacks {
  /**
   * The document changed — ink drawn, erased or moved, a text box edited, a
   * page cleared, an undo or redo — and is due to be saved. `pages` names
   * the ids of the only pages it changed, when the change is one of the few
   * that can say (a stroke, an erase, a selection's edit); without it,
   * anything may have changed, anywhere.
   */
  onChange: (pages?: readonly string[]) => void;
  /** Something the host may display changed (stroke count, zoom, current page). */
  onStatus?: () => void;
  /**
   * The pen (or mouse) touched the page (true) or left it (false): the host
   * puts off work that would stall the ink until it has been up a moment.
   */
  onPen?: (down: boolean) => void;
  /**
   * Asked before every edit: true refuses it, for a note that must not be
   * written (the host says why).
   */
  isLocked?: () => boolean;
  /** A custom colour was picked (the lasso's recolour): the new recent list. */
  onRecentColors?: (colors: string[]) => void;
  /** A key press switched tools; the host's toolbar should show the new one. */
  onToolChange?: (tool: ActiveTool) => void;
  /** A key (1 to 8) asked for saved pen `index` (FineNotes#25); the host applies it. */
  onSavedPen?: (index: number) => void;
  /** ? asked for the keyboard shortcuts; the host shows them. */
  onShortcuts?: () => void;
  /** What the stylus barrel button does (the settings); erase when absent. */
  barrelAction?: () => BarrelAction;
  returnToPenOnReselect?: () => boolean;
  returnToPenAfterUse?: () => boolean;
  /** Whether highlighter strokes are drawn as straight runs (`ink/straighten.ts`); on when absent. */
  straightenHighlighter?: () => boolean;
  /**
   * Where the box the text pill acts on is on screen (client px), or `null`
   * when there is none: the host floats the pill beside it, as GoodNotes
   * does. Reported when the target changes and whenever it moves.
   */
  onTextAnchor?: (rect: TextAnchorRect | null) => void;
  /** What the host did with the text pill last (debug HUD): where it put it, or why it hid it. */
  textPillState?: () => string;
  /** "Drag to size text boxes" (settings): a Text-tool drag draws the new box. Read live. */
  textDragSize?: () => boolean;
  /** Whether a two-finger double tap undoes and a three-finger one redoes. */
  fingerTapUndo?: () => boolean;
  /**
   * Whether there is anything to undo or redo changed, so a host can grey
   * out its Undo and Redo buttons. Sent once on construction too.
   */
  onHistoryChange?: (canUndo: boolean, canRedo: boolean) => void;
  /**
   * The user scrolled onto a different page. `index` is 0-based.
   * Hosts use it to keep the toolbar's page navigation in step.
   */
  onPageChange?: (index: number, total: number) => void;
  /**
   * Where the reader is as the page moves: page `index`, `y` page px down
   * it (a third of the way down the view). Every frame of a scroll.
   */
  onReadingPoint?: (index: number, y: number) => void;
  /**
   * "Add to contents" on a lasso selection: the host asks for a title and
   * adds a section to page `index` at `at` (page px, the heading's left and
   * middle).
   */
  onAddSection?: (index: number, at: { x: number; y: number }, strokeIds: string[]) => void;
  /**
   * "Link to…" on a lasso selection of ink: the host asks where to, and
   * applies `linkStrokes` for these stroke ids on page `index`. `current`
   * is where the ink leads now, when all of it is in one link.
   */
  onLinkStrokes?: (index: number, strokeIds: string[], current: string | null) => void;
  /** Open a link's target: a finger tap on linked ink, or Open link on its selection. */
  onOpenLink?: (target: string) => void;
  /**
   * A finger tapped a `[[link]]` written by hand and found on the device:
   * the host offers to link those strokes to `target`.
   */
  onSuggestedLink?: (index: number, strokeIds: string[], target: string) => void;
  /**
   * The user asked for a new page after `afterIndex`.
   *
   * The host decides what the new page looks like (it knows the notebook's
   * defaults) and applies the model's `AddPage` through {@link applyCommand}.
   * Without this callback the add-page control stays disabled.
   */
  onAddPageRequested?: (afterIndex: number) => void;
  /**
   * The page was pulled past the last page and let go: add a page after the
   * last one (GoodNotes' "pull to add page"). Only offered while the host
   * enables it with {@link InkSurface.setPullToAddPage}.
   */
  onPullAddPage?: () => void;
  /**
   * A page text box took focus (its style), or editing ended (`null`). Hosts
   * show the box's style in the text pill. Also sent after an undo or redo
   * changes the style of the box being edited.
   */
  onTextEditing?: (style: TextStyle | null) => void;
  /**
   * A lone picture was copied (or cut) to the plugin's clipboard. A host may
   * also put its pixels on the system clipboard, where other apps can paste
   * them; ink cannot travel that way.
   */
  onCopyImage?: (image: ImageElement) => void;
  /**
   * Cmd/Ctrl+V found a picture on the system clipboard, fresher than the
   * plugin's own (see `handlePaste`), or the press menu's Paste did — then
   * with `at`, the page and page-local point to centre it on. The host saves
   * and places it. Without this, only the plugin's clipboard is pasted.
   */
  onPasteImage?: (file: File, at?: { pageIndex: number; x: number; y: number }) => void;
}

/**
 * The text of PDF backdrop pages, laid out in page space (the host reads it
 * with pdf.js; `pdf-text-source.ts`). `peek` never waits: null means not
 * read yet, and the highlighter stays freehand until `request` has read it.
 */
export interface PdfTextSource {
  peek(backdrop: PdfBackdrop, geometry: PageGeometry): TextLayout | null;
  request(backdrop: PdfBackdrop): void;
}

/**
 * Asked about a tap on ink (a finger, or the lasso) while a host has set one
 * — audio replay's "tap a stroke to hear it". Returns true when it took the
 * tap; false lets the tap do what it would have done anyway.
 */
export type StrokeTapHandler = (page: Page, stroke: Stroke) => boolean;

/**
 * A tool's handling of the pen, from pen-down to lift, on the page it went
 * down on. The surface reads the tool afresh at every event, as the toolbar
 * (or a key) may switch it mid-gesture.
 */
interface PenGesture {
  /** The pen went down at page point `at`; `sample` is the same point in layout space. */
  down(box: PageBox, at: Pt, sample: PointerSample): void;
  /** It moved: every coalesced sample since the last event (layout space). */
  move(box: PageBox, samples: PointerSample[]): void;
  /** It lifted at `sample` (layout space). */
  up(box: PageBox, sample: PointerSample): void;
  /**
   * The platform cancelled it. On iOS that is often an ordinary lift, so
   * a tool keeps what it can. `box` is null when the pen went down off every page.
   */
  cancel(box: PageBox | null): void;
}

/** The DOM for one page text box: a frame with a textarea and two drag handles. */
interface TextBoxView {
  root: HTMLElement;
  input: HTMLTextAreaElement;
  /**
   * The text as shown while the box is not being edited, when it has links
   * in it: each link as its shown text, in the accent colour, tappable. Laid
   * over the textarea, which keeps the layout and is what gets edited.
   */
  shown: HTMLElement;
  /** The text `shown` was last built from. */
  shownText: string | null;
  pageId: string;
  id: string;
  /** Width + font size the auto-height was last measured at; skips needless reflow. */
  measuredAt: string;
  /** Visual shrink applied to the textarea so its computed font stays >= 16px. */
  shrink: number;
  /**
   * The auto height last measured, in page px, and the text it was measured
   * for: a pinch scales it instead of measuring (the box wraps at the same
   * words at every zoom), and the box is measured again once the zoom rests.
   */
  pageH: number;
  pageHText: string;
  /** Whether the box had a fixed height at the last sync. */
  fixed: boolean;
  /** The style that changes a box's height (font, weight, line height…) at the last sync. */
  styleKey: string;
  /** Text, font and room a fitted box's width was last measured for, and that width. */
  fitKey: string;
  fitW: number;
}

/** A text-tool drag shorter than this (page px) is a tap: a box that fits its text. */
const TEXT_TAP_SLOP = 12;
/** Narrowest a dragged or resized box may be, page px. */
const TEXT_MIN_W = 80;
const TEXT_MIN_H = 32;
/** How long after focusing a text box the surface owns scrolling (keyboard animation). */
const TEXT_FOCUS_HOLD_MS = 1200;
/**
 * Room kept above a box being typed in, screen px: the text pill floats
 * there (about 46 px tall, 10 px off the box).
 */
const TEXT_PILL_ROOM_PX = 64;
/**
 * The part of the window a box being typed in keeps clear at the bottom,
 * whatever keyboard height is reported: a floating keyboard or a small one
 * still covers the bottom of the screen (Joost, 2026-10-15).
 */
const TYPING_KEYBOARD_SHARE = 0.4;
/** Space kept between a box being typed in and the keyboard, screen px. */
const TEXT_REVEAL_MARGIN_PX = 16;
/** How often a box being typed in looks for the keyboard (`watchTypingKeyboard`). */
const TYPING_KEYBOARD_WATCH_MS = 250;
/**
 * Body class set while a page text box is being edited. styles.css uses it to
 * lift Obsidian's mobile keyboard cap on the app container, which otherwise
 * collapsed the page to zero height on iPad (the keyboard covers the lower
 * part of the page instead, as in GoodNotes).
 */
const TEXT_EDITING_BODY_CLASS = "goodobsidian-text-editing";
/** How often a pending release of the editing class checks the keyboard again. */
const TEXT_CLASS_POLL_MS = 50;
/**
 * Longest the editing class outlives a blur while `--keyboard-height` still
 * reads above zero (a hardware keyboard, another field taking focus, a value
 * Obsidian never resets). After this it goes regardless.
 */
const TEXT_CLASS_RELEASE_MS = 1500;
/** Below this computed font size iPadOS zooms the page into a focused field. */
const IOS_MIN_INPUT_FONT_PX = 16;

/** A lasso press that moves less than this, in screen px, is a tap, not a lasso. */
const TAP_SLOP_PX = 8;
/** Lasso points closer than this to the previous one are dropped, screen px. */
const LASSO_SPACING_PX = 3;
/** Room between a lasso selection and its dashed frame, screen px. */
const SELECTION_PAD_PX = 8;
/** Smallest a corner resize may make a lasso selection's longer side, screen px. */
const MIN_SELECTION_SIDE_PX = 32;
const SVG_NS = "http://www.w3.org/2000/svg";
/** How far off ink or a picture a Pencil tap may land and still pick it, screen px. */
const PEN_TAP_TOLERANCE_PX = 6;
/** The same for a fingertip, which covers more of the glass. */
const FINGER_TAP_TOLERANCE_PX = 12;
/** A finger that lifts within this long of landing, having barely moved, tapped. */
const FINGER_TAP_MS = 350;
/** A press on a selected image, or a lasso selection, drags once it has moved this far, screen px. */
const IMAGE_DRAG_SLOP_PX = 3;
/**
 * A lasso press on the paper held this long without moving opens the small
 * bar with Paste — or Unlock, on a locked picture (GoodNotes' long press).
 * Noticed by a timer: a pen held still sends no moves (ledger).
 */
const PRESS_HOLD_MS = 500;
/** The smallest scribble that erases: its longer side on screen, px. */
const SCRIBBLE_MIN_PX = 10;
/** Slack round the band a scribble swept, screen px, past half of either nib. */
const SCRIBBLE_MARGIN_PX = 2;
/** How far off the loop a held pen may land and still turn it into a lasso, screen px. */
const CIRCLE_HOLD_TOLERANCE_PX = 14;
/**
 * How long Cmd/Ctrl+V waits for the browser's own paste event (which may
 * carry a picture from another app) before pasting the plugin's clipboard
 * itself. WebKit fires no paste event where nothing editable has focus.
 */
const PASTE_EVENT_WAIT_MS = 120;
/** Room kept between a selected picture's handles and its action bar, screen px. */
const IMAGE_CHROME_CLEAR_PX = 10;
/** Room kept between a tap-and-hold's spot and its bar: clear of a fingertip, screen px. */
const PRESS_CLEAR_PX = 28;
/** The rotate knob's drawn radius, screen px; its target is the 44 px hit area. */
const ROTATE_KNOB_RADIUS_PX = 14;
/** How far in from a locked picture's top-right corner its lock badge sits, screen px. */
const LOCK_BADGE_INSET_PX = 18;

/**
 * The plugin's clipboard (Cut, Copy, Paste): one for every notebook open in
 * this Obsidian window, so ink copied in one note pastes into another.
 */
const clipboard = new InkClipboard();
// Text FineNotes copies (Copy text, a page link) is newer than any ink held.
onSystemTextWritten(() => clipboard.noteSystemCopy());

/**
 * A move, resize, stretch or rotate of the selected image, from pointerdown
 * to lift. The document is untouched until the lift commits one
 * `TransformImage`; meanwhile `draft` is drawn on the wet layer and the image
 * is left out of the tiles.
 */
interface ImageDrag {
  pointerId: number;
  part: ImagePart;
  pageId: string;
  image: ImageElement;
  start: ImageTransform;
  /** Page-local point where the pointer went down. */
  from: { x: number; y: number };
  /**
   * The grabbed handle's position less `from`, page px: the handle follows
   * the pen from where it was, rather than jumping to where the pen landed
   * inside its 44 px target.
   */
  grab: { x: number; y: number };
  /** Client point where it went down, for the drag slop. */
  clientX: number;
  clientY: number;
  draft: ImageTransform;
  /** Whether the image has left the tiles for the wet layer yet. */
  lifted: boolean;
}

/**
 * Crop mode on the selected picture, from Crop to Done or Cancel. The
 * picture is shown whole on the wet layer, veiled outside the crop, and left
 * out of the tiles; nothing is committed until Done.
 */
interface CropSession {
  pageId: string;
  image: ImageElement;
  /** The whole picture, page space: the element's crop undone. */
  full: ImageTransform;
  /** The crop being edited, as fractions of the whole picture as drawn (mirrored when flipped). */
  crop: ImageCrop;
  /** The crop the picture had when crop mode began. */
  initial: ImageCrop;
  /** A handle, or the frame, being dragged. */
  drag: {
    pointerId: number;
    part: ImagePart;
    start: ImageCrop;
    /** Where the pointer went down, as fractions of the whole picture. */
    from: { u: number; v: number };
    min: { u: number; v: number };
  } | null;
}

/**
 * The small bar a tap-and-hold opens (a finger with any tool, the lasso's
 * pen, a right-click): Paste, Text box and Select all on paper; Unlock on a
 * locked picture.
 */
interface PressMenu {
  pageId: string;
  /** The pressed page point. */
  at: Pt;
  /** The locked picture pressed, if one was. */
  locked: ImageElement | null;
  /**
   * Opened by a finger that is still down. Until it lifts the bar takes no
   * presses, so a palm that opened it cannot have the pen land on Paste:
   * the pen goes through to the page, which closes the bar.
   */
  provisional: boolean;
}

const NO_IMAGES: ReadonlySet<ImageElement> = new Set();
const NO_STROKES: ReadonlySet<string> = new Set();

/** A lasso selection: strokes, images and text boxes on one page, held by identity. */
interface GroupSelection extends ElementLists {
  pageId: string;
}

/** A lasso being drawn, from pen-down to lift, on the page it started on. */
interface LassoDraft {
  box: PageBox;
  mode: LassoMode;
  /** The freehand loop so far. */
  path: LassoPath;
  /** Page-local pen-down point, and where the pen is now (the rectangle's corners). */
  origin: Pt;
  to: Pt;
  /** The pen was held still long enough to open the Paste / Unlock bar instead. */
  held: boolean;
  /** The page's lines, for a lasso selecting by line; empty otherwise. */
  lines: LineBlock[];
  /**
   * A by-line lasso that went down in the margin inserts space instead: the
   * line it started from, and how many lines the drag has opened so far.
   */
  space: { target: SpaceTarget; count: number; plan: SpacePlan | null; text: string } | null;
}

/**
 * A lasso selection being dragged by its frame, from pointerdown to lift:
 * moved by its body, resized by a corner handle, or turned by its knob. The
 * document is untouched until the lift commits one `TranslateElements`,
 * `ScaleElements` or `ReorientElements`; meanwhile the selection's ink and
 * pictures are drawn on the wet layer, moved by (dx, dy), scaled by `scale`
 * or turned by `turn`, and left out of the tiles, and its text boxes follow.
 */
interface GroupDrag {
  pointerId: number;
  selection: GroupSelection;
  /** The selection's bounds when the drag began, page space. */
  bounds: Bounds;
  /** Page-local point where the pointer went down. */
  from: Pt;
  /** Client point where it went down, for the drag slop. */
  clientX: number;
  clientY: number;
  dx: number;
  dy: number;
  /** Set when a corner handle was grabbed: the drag resizes instead of moving. */
  scale: GroupScale | null;
  /** Set when the rotate knob was grabbed: the drag turns instead of moving. */
  turn: GroupTurn | null;
  /** Whether the selection has left the tiles for the wet layer yet. */
  lifted: boolean;
}

/** A turn of a lasso selection by its knob, about the middle of its bounds. */
interface GroupTurn {
  /** The middle of the bounds, page space. */
  centre: Pt;
  /** Page-local point where the knob was grabbed. */
  from: Pt;
  /** Radians clockwise so far, snapped onto quarter turns. */
  angle: number;
}

/** A corner resize of a lasso selection, about the opposite corner of its bounds. */
interface GroupScale {
  corner: ImageCorner;
  /** The fixed corner, page space. */
  anchor: Pt;
  /** The grabbed corner of the bounds less the pointer-down point: the corner follows the pen from where it was. */
  grab: Pt;
  /** Scale so far, and the range it may take (the minimum size, the text sizes). */
  k: number;
  min: number;
  max: number;
}

/**
 * A full copy of a picture with its box and turn replaced by `t`: every other
 * field (crop, flips, and any added later) comes along, and a turn `t` does
 * not have is dropped rather than left over from the picture.
 */
function placedAt(image: ImageElement, t: ImageTransform): ImageElement {
  const out: ImageElement = { ...image, x: t.x, y: t.y, w: t.w, h: t.h };
  if (t.rotation === undefined) delete out.rotation;
  else out.rotation = t.rotation;
  return out;
}

/** Flip horizontal · Flip vertical, as rows of their own in the "…" menu. */
function flipActions(flip: (axis: FlipAxis) => void): SelectionAction[] {
  return [
    {
      id: "flip-x",
      icon: "flip-horizontal-2",
      label: "Flip horizontal",
      group: "flip",
      run: () => flip("x"),
    },
    {
      id: "flip-y",
      icon: "flip-vertical-2",
      label: "Flip vertical",
      group: "flip",
      run: () => flip("y"),
    },
  ];
}

/**
 * A box on screen, client px; whether it is being typed in (the keyboard is
 * up); and the top and bottom of the page's own part of the screen.
 */
export interface TextAnchorRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  typing: boolean;
  clipTop: number;
  clipBottom: number;
  /** The page is moving (scroll, momentum, zoom, a finger on it). */
  moving: boolean;
}

/**
 * How far the page must scroll, in screen px, or how much it must zoom, as a
 * ratio, within one gesture before the text pill steps aside; less is a
 * nudge, and the pill follows its box. And how long the page must then be
 * still before the pill fades back in.
 */
const TEXT_PILL_MOVE_PX = 24;
const TEXT_PILL_ZOOM_RATIO = 0.06;
const TEXT_PILL_SETTLE_MS = 150;

/** How long after the tap that held a box it takes taps itself (to type in it). */
const HELD_TAP_DELAY_MS = 350;

/** How long after a finger tap the click iOS makes of it can still arrive. */
const CLICK_AFTER_TAP_MS = 600;

/**
 * Keep the click a browser synthesises from a tap that has been handled
 * already from reaching `target` (and focusing a field there): its
 * `mousedown` and `click` within {@link CLICK_AFTER_TAP_MS} are stopped.
 */
function swallowClickAfterTap(target: HTMLElement): void {
  const win = target.ownerDocument.defaultView;
  if (!win) return;
  const stop = (event: Event): void => {
    if (!(event.target instanceof Node) || !target.contains(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
  };
  const options = { capture: true };
  for (const type of ["mousedown", "click"]) win.addEventListener(type, stop, options);
  win.setTimeout(() => {
    for (const type of ["mousedown", "click"]) win.removeEventListener(type, stop, options);
  }, CLICK_AFTER_TAP_MS);
}

/** The tools a practice file has: writing and rubbing out. */
function isPracticeTool(tool: ActiveTool): boolean {
  return tool === "pen" || tool === "eraser";
}

export class InkSurface {
  readonly surfaceEl: HTMLElement;
  private readonly scrollEl: HTMLElement;
  private readonly paperEl: HTMLElement;
  private readonly textBoxesEl: HTMLElement;
  private readonly textBoxInputs = new Map<string, TextBoxView>();
  /** Dashed rectangle shown while dragging out a new text box. */
  private readonly textDraftEl: HTMLElement;
  /** Page-local start of a text-tool drag, and where it currently is. */
  private textDrag: { origin: { x: number; y: number }; to: { x: number; y: number } } | null =
    null;
  /**
   * The command that created the newest text box, and the style and frame
   * changes made to it since, so an empty one leaves no trace in the history.
   */
  private lastTextBoxAdd: { key: string; command: AddTextBoxToPage; followers: Command[] } | null =
    null;
  /** Live frame of a text box being moved/resized by its handle, before commit. */
  private frameDraft: { key: string; frame: TextBoxFrame } | null = null;
  /** The box whose handle is being dragged, from pointerdown to lift. */
  private textFrameDrag: string | null = null;
  /** The tool as of the last `setTool`, so switching to Text can remember what it replaced. */
  private toolSeen: ActiveTool;
  /** The tool in use before Text, which an unpinned Text tool returns to. */
  private toolBeforeText: ActiveTool | null = null;
  /** The pen or highlighter last in use, which the return-to-pen settings go back to. */
  private drawingTool: ActiveTool = "pen";
  /** A Text-tool gesture made while a box was being edited: it only ends the edit. */
  private textDismiss = false;
  /** A Text-tool press beside a held box: its lift lets go of the box (see `finishTextDismiss`). */
  private textRelease = false;
  /**
   * The box a first tap beside it stopped typing in but kept, framed with its
   * handles, until the next tap beside it.
   */
  private heldText: TextBoxView | null = null;
  /**
   * The tool a finger tap on a box replaced with the lasso, to come back to
   * when the box is let go (`fingerHoldsTextBox`); kept while it is typed in
   * with the lasso, and dropped when it is let go.
   */
  private heldReturnTool: ActiveTool | null = null;
  /** Makes a held box take taps once the tap that selected it is over. */
  private heldTapTimer = 0;
  /**
   * The box that was held or typed in when it scrolled out of sight: its
   * frame, pill and keyboard went, but a tap on it, with the same tool and
   * nothing else tapped in between, types in it at once (Joost, after
   * GoodNotes). The tool held then, and the one to come back to after.
   */
  private parkedText: {
    view: TextBoxView;
    tool: ActiveTool;
    returnTool: ActiveTool | null;
  } | null = null;
  /** Set while a box is parked: its blur must not hand the Text tool back. */
  private parkingText = false;
  /** The last rectangle handed to `onTextAnchor`, rounded, as a key ("" for none). */
  private textAnchorKey = "";
  /**
   * Whether the page is moving enough to send the text pill away: a real
   * scroll or zoom, not a nudge (`trackTextPillMotion`). It stays away until
   * the page has settled for a moment.
   */
  private textAnchorMoving = false;
  /** Where the view was when the page started moving, and whether that has sent the pill away. */
  private textPillMotion: { x: number; y: number; scale: number; away: boolean } | null = null;
  /** Brings the pill back once the page has settled (`TEXT_PILL_SETTLE_MS`). */
  private textPillSettleTimer = 0;
  /** Where the view was on the last frame at rest: where a movement is measured from. */
  private textPillRest: { x: number; y: number; scale: number } | null = null;
  /** While a box is typed in: an interval looking for the keyboard (`watchTypingKeyboard`). */
  private typingKeyboardWatch = 0;
  private typingKeyboardSeen = 0;
  /** A pending release of the editing body class (see `releaseTextEditingClass`). */
  private textClassTimer = 0;
  /** The Text tool's hint pill, and what its × does. */
  private readonly textHintEl: HTMLElement;
  private readonly textHintLabel: HTMLElement;
  private textHintDismiss: (() => void) | null = null;
  /** "Part of this stroke is outside the page", with Undo (`noteOffPage`). */
  private readonly offPageEl: HTMLElement;
  /** The stroke the notice's Undo takes back; `null` while it is hidden. */
  private offPageCommand: Command | null = null;
  private offPageTimer = 0;
  private offPageFade: Animation | null = null;
  /** The text a highlight just snapped to, with Copy (`showTextCopy`). */
  private readonly textCopyEl: HTMLElement;
  private readonly textCopyLabel: HTMLElement;
  private textCopyText = "";
  private textCopyTimer = 0;
  /** The highlight the notice is about: it goes once that is undone or followed. */
  private textCopyCommand: Command | null = null;
  /** PDF pages' text, for the highlighter that snaps to it; null until the host sets one. */
  private textSource: PdfTextSource | null = null;
  /** A highlighter drag that started over a PDF's text, from pen-down to lift. */
  private textMark: { layout: TextLayout; from: Pt; selection: TextSelection } | null = null;
  private readonly indicatorEl: HTMLElement;
  /** "68%", while the zoom changes. */
  private readonly zoomReadoutEl: HTMLElement;
  private readonly thumbYEl: HTMLElement;
  private readonly thumbXEl: HTMLElement;
  /** The pane's glide from its old shape (see `glideFrom`), while it runs. */
  private flip: Animation | null = null;
  /** When each transient piece of chrome is due to fade (`now()` ms). */
  private readonly chromeUntil = { thumbs: 0, counter: 0, zoom: 0 };
  private chromeTimer = 0;
  /** The diagnostics HUD, over the page (see `setDebug`). */
  private readonly hudEl: HTMLElement;

  /** Null once the surface is destroyed; late callbacks check for that first. */
  private renderer: Renderer | null;
  /** What undoes each listener, observer and controller the constructor attached. */
  private readonly disposers: Array<() => void> = [];
  /** The one animation frame every scroll, zoom and repaint coalesces into. */
  private frameReq = 0;
  private prefetchReq = 0;
  /** Scroll position and momentum. The DOM never scrolls; this does. */
  private readonly scroller = new KineticScroller();
  /** A pinch in flight: the un-rubber-banded zoom the fingers are asking for. */
  private pinch: { raw: number; centerX: number; centerY: number } | null = null;
  /** The zoom springing back inside its limits after a pinch overshot them. */
  private zoomAnim: { from: number; to: number; t0: number; cx: number; cy: number } | null = null;
  private wheelZoomTimer = 0;
  /** A wheel or trackpad scroll across a row of pages settles on a page when it stops. */
  private wheelSnapTimer = 0;
  /** Whether the view is still moving; zoomed-in PDF detail waits until it rests. */
  private readonly viewRest = new ViewRest();
  /** One more frame once the view has rested, to render the PDF detail it held back. */
  private detailRestTimer = 0;
  /** A finger is dragging the page (touchmove must then not reach Obsidian). */
  private touchPanning = false;
  /** Space is held: pen and mouse pan (FineNotes#7). */
  private handHeld = false;
  /**
   * What the press under way does instead of the tool in hand, because a
   * key or a stylus button was held as it came down (`pen-modifiers.ts`,
   * FineNotes#25). Null for the tool itself; it lasts for that press only.
   */
  private pressTool: PressOverride | null = null;
  /** A pen or mouse is moving the page from beside the pages, or with the barrel. */
  private penPanning = false;
  /** An Alt-drag zooming: the zoom it began at, and the client point it zooms about. */
  private zoomDrag: { from: number; x: number; y: number } | null = null;
  /** Until when (`now()`) a right-click menu is a stylus button's doing, not the user's. */
  private stylusMenuUntil = 0;
  /** The cursor over the page for the pens, on a computer (FineNotes#25, #27). */
  private penCursor: PenCursorStyle = "arrow";
  /** What the ink cursor was last drawn for, so an unchanged one is not set again. */
  private inkCursorKey = "";
  /** Where the page was when the current finger gesture began, to undo a palm's scroll. */
  private palmUndo: {
    t: number;
    x: number;
    y: number;
    zoom: number;
    cx: number;
    cy: number;
  } | null = null;
  /** Which way the pages run; read from the document on every layout. */
  private direction: ScrollDirection = "vertical";
  /** The page a finger swipe started on: a row of pages turns at most one page per swipe. */
  private swipeFromPage = 0;
  /** A pinch ended zoomed out on a row: centre the page once the zoom settles. */
  private snapRowAfterZoom = false;
  /** Whether pulling past the last page adds one (a notebook, not a single page). */
  private pullAddEnabled = false;
  private readonly pullAdd: PullAddIndicator;
  /** Pressure the tiles were last rasterised with; a change invalidates them. */
  private tilesPressure: boolean | null = null;
  /** Whether ink on the pages is drawn with its pressure ({@link setInkPressure}). */
  private inkPressure = false;
  private cssW = 0;
  private cssH = 0;

  /** The scroll (layout px) and scale, as the renderer takes them. */
  private viewport: ViewportState = { scrollY: 0, scale: 1, width: 0 };
  /** Where layout x = 0 is drawn: CSS px from the pane's left edge. */
  private offsetX = 0;
  private pageLayout: DocumentLayout = layoutPages([]);
  /** Fit-to-width factor: layout px -> CSS px at 100% zoom. */
  private baseScale = 1;
  /** User zoom, multiplied on top of {@link baseScale}. */
  private userZoom = 1;
  /**
   * The zoom floor: the whole (tallest) page on screen. At most 1, recomputed
   * per layout because it depends on the pane's height. Also the default.
   */
  private minZoom = 1;
  /** Whether the first layout has set the default zoom yet. */
  private zoomInitialised = false;
  private paper: PaperTheme;
  private pageIndex = 0;

  /** The pen stroke being drawn, from pen-down to lift. */
  private builder: StrokeBuilder | null = null;
  /**
   * A practice file: only the pen and the eraser, no snapping, no pictures,
   * and every stroke keeps its raw samples. `device` is what it is written
   * on, recorded in the file with the kind of pointer.
   */
  private practice: { device: string } | null = null;
  /** The kind of pointer the open stroke is drawn with. */
  private strokeInput = "";
  /** Page the current gesture belongs to; a gesture never changes page. */
  private activePage: PageBox | null = null;
  /**
   * Wall-clock ms the strokes are timestamped with. The wall clock itself
   * unless a host supplies another — the note view hands in the recording's
   * clock, so ink and audio share one timeline (see `setClock`).
   */
  private clock: () => number = () => Date.now();
  /**
   * When the current gesture's pen went down, on {@link clock}. Read at pen-
   * down, not at the lift: a stroke's `t0` is when it began.
   */
  private penDownAt: number | null = null;
  /** The colour pickers' "pick from the page", made on first use. */
  private eyedropper: Eyedropper | null = null;
  /** Set by a host while taps on ink mean something else (audio replay). */
  private strokeTapHandler: StrokeTapHandler | null = null;
  /** New strokes' and text boxes' ids: `s<N>` and `t<N>`, above any the document holds. */
  private readonly strokeIds = new IdSequence("s");
  private readonly textBoxIds = new IdSequence("t");
  private readonly history = new History();
  /** The undo/redo availability last reported to the host, as "undo/redo". */
  private historyShown = "";
  /** Every stroke by page position and by id; kept in step with each edit. */
  private readonly strokeIndex = new StrokeIndex();
  /** Whole-stroke erase in progress: the strokes the eraser has touched so far. */
  private eraseIds = new Set<string>();
  /**
   * Standard (partial) erase in progress: original stroke id -> the pieces
   * that survive so far. The document is untouched until the gesture ends;
   * the renderer draws these pieces in the originals' place meanwhile.
   */
  private erasePieces = new Map<string, Stroke[]>();
  /** The previous dab's page-local point, so fast drags leave no gaps. */
  private eraseLast: { x: number; y: number } | null = null;
  /**
   * Tiles hold committed ink, so the live erase preview has to re-rasterise
   * what it touches: `eraseDirty` is the strokes changed since the last
   * repaint, `erasePreview` everything the gesture has touched, which is put
   * back from the document when it ends.
   */
  private eraseDirty = new Set<string>();
  private erasePreview: { pageIndex: number; bounds: Bounds } | null = null;
  /** The ruled eraser's pass, from its first dab; null in the other modes and on unlined pages. */
  private eraseRuled: RuledEraser | null = null;
  /** The eraser's footprint, shown on the page while erasing. */
  private readonly eraserCursorEl: HTMLElement;
  /** The laser pointer's trail, and the canvas it is drawn on (FineNotes#25). Never saved. */
  private readonly laserTrail = new LaserTrail();
  private readonly laserCanvas: HTMLCanvasElement;
  private laserFrame = 0;

  // The lasso (0.5). A selection is strokes, images and text boxes on one
  // page, held by identity and resolved against the live document. One
  // picture on its own is shown with the image chrome below instead (its
  // resize and rotate handles); anything else gets the group frame, which
  // moves the lot. The two are never shown together, and one action bar
  // serves both. Frame, bar and menu are DOM over the page, like the text
  // boxes, so a finger works them as well as the Pencil.
  private selection: GroupSelection | null = null;
  /** A lasso has selected content; return only when its outside click dismisses it. */
  private selectionToolUsed = false;
  private lasso: LassoDraft | null = null;
  private groupDrag: GroupDrag | null = null;
  private readonly selectionUiEl: HTMLElement;
  private readonly selectionFrameEl: HTMLElement;
  /** The rounded lasso loop drawn in the frame, for a freehand selection. */
  private readonly selectionPathEl: SVGPathElement;
  /**
   * The freehand loop a selection was made with, rounded, relative to the
   * selection's bounds then (page px), and how many elements it took: the
   * outline is drawn only while the selection is still those elements.
   */
  private selectionOutline: { loop: number[]; count: number } | null = null;
  private readonly actionBar: SelectionActionBar;
  private readonly palette: readonly string[];

  // Placed images (0.5). One image is selected at a time, held by identity
  // (ids can repeat in a hand-edited file) and resolved against the live
  // document. Its frame and handles are DOM over the page, like the text
  // boxes, so a finger works them as well as the Pencil; whatever they grab
  // never reaches the page below.
  private imageSel: { pageId: string; image: ImageElement } | null = null;
  private imageDrag: ImageDrag | null = null;
  private readonly imageUiEl: HTMLElement;
  private readonly imageFrameEl: HTMLElement;
  /**
   * Crop mode on the selected picture, and its DOM: a box over the whole
   * picture that takes the presses, and the crop frame inside it.
   */
  private cropping: CropSession | null = null;
  private readonly cropUiEl: HTMLElement;
  private readonly cropPictureEl: HTMLElement;
  private readonly cropFrameEl: HTMLElement;
  /** A lock badge on each locked picture, shown only while the lasso is the tool. */
  private readonly lockBadgesEl: HTMLElement;
  private readonly lockBadges: HTMLElement[] = [];
  /** The by-line lasso's insert-space markers: a column per block of lines per page. */
  private readonly spaceHandlesEl: HTMLElement;
  private readonly spaceHandleEls: HTMLElement[] = [];
  /** A ribbon in the margin beside each section in the contents. */
  private readonly sectionRibbonsEl: HTMLElement;
  private readonly sectionRibbons: HTMLElement[] = [];
  /** An underline under each piece of linked ink. */
  private readonly linkMarks: HTMLElement[] = [];
  /** `[[links]]` written by hand, found on the device, by page id: offered, not made. */
  private readonly linkSuggestions = new Map<string, readonly HandwrittenLink[]>();
  /** The lasso's tap-and-hold bar, and the timer that opens it. */
  private pressMenu: PressMenu | null = null;
  private pressTimer = 0;
  /** Cmd/Ctrl+V waiting for the browser's paste event (see PASTE_EVENT_WAIT_MS). */
  private pasteTimer = 0;
  /** Whether a host set an image painter: without one, pictures are neither drawn nor pasted. */
  private imagesShown = false;
  /** A finger went down and could still turn out to be a tap. */
  private fingerTap: { x: number; y: number; t: number } | null = null;
  /** The same finger, watched for a hold that opens the press menu (`finger-hold.ts`). */
  private readonly fingerHold = new FingerHold();
  /** Touch points on the glass at the last touch event over the page. */
  private touchCount = 0;

  // Circle to lasso (pen gestures). The loop the pen just drew round
  // something, for as long as it is the latest step; a pen held on it for
  // PRESS_HOLD_MS takes it back and selects what it enclosed, and the same
  // pen then drags the selection until it lifts.
  private circleLoop: { pageId: string; stroke: Stroke; command: Command; loop: number[] } | null =
    null;
  /** A pen put down on that loop: where, until the hold fires or the pen moves off. */
  private circlePress: { box: PageBox; at: Pt; t: number } | null = null;
  /** The selection a held loop made follows the pen that held it. */
  private circleDrag = false;

  // Hold-to-snap (contracts/api.md §2). The pen must dwell for HOLD_MS; a
  // timer, not the next pointermove, notices that — a pen held perfectly still
  // sends no moves at all, which is why this never fired when it was polled.
  private holdAnchor: { x: number; y: number; t: number } | null = null;
  private holdTimer = 0;
  /**
   * Set once the held stroke snapped. Until the pen lifts, the shape follows
   * it: `base` is the snapped geometry, and moving the pen from `from` scales
   * and rotates it about `pivot` (GoodNotes' "adjust while holding").
   */
  private snap: { kind: ShapeKind; base: number[]; pivot: Pt; from: Pt; pts: number[] } | null =
    null;
  /**
   * The Shape tool's preset being dragged out — corner to corner, a
   * connector start to end — or a table, which is several strokes.
   */
  /**
   * The Shape tool's preset being dragged out. `moved` sticks once the pen
   * has left the tap slop: dragging back to the start is still a drag.
   */
  private shapeDrag: {
    preset: ShapePreset | "table";
    origin: Pt;
    to: Pt;
    moved: boolean;
  } | null = null;

  /**
   * The median pressure the pen read on the last stroke; null before any.
   * A new stroke assumes it until its own first reading comes in.
   */
  private penPressure: number | null = null;
  /** Whether the browser hands over every pen sample, or one per frame. */
  private readonly coalescedInput = deliversCoalescedSamples();
  /** The pointer input, once attached: whether the pen's positions arrive rounded. */
  private pointerInput: PointerController | null = null;
  /**
   * The ink stroke the pen last lifted from, while a quick pen-down nearby
   * could still carry it on (`input/pen-rejoin.ts`): when and where it
   * lifted, the builder that holds its points, and the step that added it.
   */
  private lastLift: {
    t: number;
    boxIndex: number;
    pageId: string;
    x: number;
    y: number;
    builder: StrokeBuilder;
    stroke: Stroke;
    command: Command;
    penDownAt: number | null;
  } | null = null;
  /** Where the pen was last seen (layout space), for a cancel, which has no position. */
  private penAt: Pt | null = null;
  /**
   * An eraser stroke or shape that lifted with "Return after one use" on:
   * the switch waits out the rejoin window (`input/pen-rejoin.ts`), since a
   * flicker of the Pencil's contact also arrives as a lift. A pen-down that
   * carries the use on cancels it; any other makes it happen at once.
   */
  private pendingReturn: (ToolLift & { timer: number }) | null = null;
  /** The frame the stroke in progress is next drawn in (`scheduleWet`). */
  private wetFrame = 0;
  /**
   * The stroke in progress, traced as it grows: the tracer settles each
   * point's geometry once, and each frame draws that plus the unsettled
   * tail. `wetRevision` is the builder's, so a rewrite of kept points (the
   * first pressure reading) traces the stroke afresh.
   */
  private wetTracer: InkTracer | null = null;
  private wetRevision = -1;
  /** A pane with no size yet is laid out again on the next frames, a bounded number of times. */
  private readonly sizeWait = new SizeWait();

  // The diagnostics HUD: its pointer log, when it is next redrawn, and the
  // numbers the surface adds (the last shape verdict, layouts, frame rate).
  private debug = false;
  private readonly hud = new PointerHud();
  private hudFrame = 0;
  private hudLastVerdict = "-";
  private hudLayouts = 0;
  /** Frame rate and paint time while something moves, smoothed. */
  private hudFps = 0;
  private hudPaintMs = 0;
  private hudLastFrameT = 0;

  // Shape diagnostics, kept whether or not the HUD is on: the last strokes and
  // what the recogniser made of each, for the "Copy shape diagnostics"
  // command. There is no console on iPadOS, and a HUD in a screen recording
  // proved too easy to leave off; a pasted report is a stroke's whole story.
  private readonly diagnostics: StrokeDiagnostic[] = [];
  private readonly diagPointer = {
    type: "",
    downT: 0,
    lastT: 0,
    firstMoveT: -1,
    moves: 0,
    samples: 0,
  };
  private readonly diagSums = {
    down: 0,
    up: 0,
    cancel: 0,
    touchStarts: 0,
    stylusTouches: 0,
    palmUndo: 0,
    rejoins: 0,
  };
  private diagHold = { fired: false, verdict: "" };
  private readonly createdAt = now();

  /**
   * Build the surface as the last child of `host`; in a flex column it
   * takes the height left over. The surface edits `doc` in place.
   * `toolState` is the toolbar's own object: the toolbar writes the tool
   * and its options into it, and the surface reads them as each gesture
   * needs them, so the two never have to be kept in step.
   */
  constructor(
    host: HTMLElement,
    private doc: InkDocument,
    private readonly toolState: ToolbarState,
    options: InkSurfaceOptions,
    private readonly callbacks: InkSurfaceCallbacks,
  ) {
    this.paper = options.paper ?? LIGHT_PAPER;
    this.toolSeen = toolState.tool;
    this.drawingTool = drawingToolOf("pen", toolState.tool);

    this.surfaceEl = host.createDiv({ cls: "goodobsidian-surface" });
    // The three layers, bottom to top: paper, committed ink, the stroke being drawn.
    const [backdropCanvas, dryCanvas, wetCanvas] = (["backdrop", "dry", "wet"] as const).map(
      (layer) =>
        this.surfaceEl.createEl("canvas", {
          cls: `goodobsidian-canvas goodobsidian-canvas-${layer}`,
        }),
    );
    this.scrollEl = this.surfaceEl.createDiv({ cls: "goodobsidian-scroll" });
    this.paperEl = this.scrollEl.createDiv({ cls: "goodobsidian-paper" });
    this.textBoxesEl = this.paperEl.createDiv({ cls: "goodobsidian-textboxes" });
    this.textDraftEl = this.textBoxesEl.createDiv({ cls: "goodobsidian-textbox-draft is-hidden" });
    // Obsidian mobile's one swipe recogniser (sidebars, File properties, the
    // pull-down action) ignores any touch inside an element carrying
    // `data-ignore-swipe` — its own graph view and sliders use it. Every
    // finger gesture on the page is the page's: a scroll, a page turn, a
    // pull to add a page. (Read from Obsidian's app.js; it listens on the
    // bubbling path, so the stopPropagation below also holds, but not for a
    // touch on a text box, which that guard lets through.)
    this.surfaceEl.dataset.ignoreSwipe = "true";
    this.indicatorEl = this.surfaceEl.createDiv({ cls: "goodobsidian-pageindicator is-idle" });
    // A readout, not a control: a button there would sit under a resting palm
    // the moment a two-finger zoom gives way to writing.
    this.zoomReadoutEl = this.surfaceEl.createDiv({ cls: "goodobsidian-zoomreadout is-idle" });
    this.zoomReadoutEl.setAttribute("aria-hidden", "true");
    this.thumbYEl = this.surfaceEl.createDiv({
      cls: "goodobsidian-scrollthumb is-vertical is-idle",
    });
    this.thumbXEl = this.surfaceEl.createDiv({
      cls: "goodobsidian-scrollthumb is-horizontal is-idle",
    });
    // On a computer the thumbs can be dragged (any pointer: a mouse, a
    // graphics tablet's pen). On a tablet they stay a readout like the zoom
    // readout above, for the same reason: the stylesheet turns their pointer
    // events off under `is-mobile`, so a palm or a Pencil stroke at the edge
    // of the page reaches the page and its palm rejection.
    for (const [element, vertical] of [
      [this.thumbYEl, true],
      [this.thumbXEl, false],
    ] as const) {
      this.disposers.push(
        bindScrollThumb(
          element,
          vertical,
          () => {
            const bounds = this.scroller.bounds;
            const viewport = vertical ? this.cssH : this.cssW;
            return {
              position: vertical ? this.scroller.position.y : this.scroller.position.x,
              minimum: vertical ? bounds.minY : bounds.minX,
              maximum: vertical ? bounds.maxY : bounds.maxX,
              viewport,
              track: viewport - 2 * THUMB_INSET,
            };
          },
          (position) => {
            const current = this.scroller.position;
            this.scroller.setPosition(
              vertical ? current.x : position,
              vertical ? position : current.y,
            );
            this.requestFrame();
          },
          () => this.flashChrome(false),
          // A row turned page by page settles on a page, as the wheel does.
          // The snap goes at most one page from `pageIndex`, which a frame
          // sets, and a thumb crosses several pages a frame: bring it up to
          // date first.
          () => {
            if (!vertical && this.turnsPages && this.isScrollIdle) {
              this.syncViewport();
              this.snapToPage(0, this.pageIndex);
            }
          },
        ),
      );
    }

    this.pullAdd = new PullAddIndicator(this.surfaceEl);
    // The Text tool's hint, a pill at the bottom of the surface as in GoodNotes.
    this.textHintEl = this.surfaceEl.createDiv({ cls: "goodobsidian-text-hint is-hidden" });
    this.textHintEl.setAttribute("role", "status");
    iconInto(this.textHintEl.createSpan({ cls: "goodobsidian-text-hint-icon" }), "info", "i");
    this.textHintLabel = this.textHintEl.createSpan({ cls: "goodobsidian-text-hint-label" });
    const hintClose = this.textHintEl.createEl("button", {
      cls: "goodobsidian-text-hint-close clickable-icon",
      attr: { "aria-label": "Dismiss this tip" },
    });
    iconInto(hintClose, "x", "×");
    // Keep a page text box's focus (and the iPad keyboard) while closing it.
    hintClose.addEventListener("pointerdown", (event) => event.preventDefault());
    hintClose.addEventListener("click", () => {
      const dismiss = this.textHintDismiss;
      this.hideTextHint();
      dismiss?.();
    });
    // GoodNotes' "Content outside of the page" toast, bottom centre.
    this.offPageEl = this.surfaceEl.createDiv({ cls: "goodobsidian-offpage is-hidden" });
    this.offPageEl.setAttribute("role", "status");
    iconInto(
      this.offPageEl.createSpan({ cls: "goodobsidian-offpage-icon" }),
      "alert-triangle",
      "!",
    );
    this.offPageEl.createSpan({
      cls: "goodobsidian-offpage-label",
      text: "Part of this stroke is outside the page",
    });
    const offPageUndo = this.offPageEl.createEl("button", {
      cls: "goodobsidian-offpage-undo clickable-icon",
      text: "Undo",
    });
    offPageUndo.addEventListener("pointerdown", (event) => event.preventDefault());
    offPageUndo.addEventListener("click", () => {
      const command = this.offPageCommand;
      this.hideOffPage();
      if (command && this.history.isLatest(command)) this.undo();
    });
    // The text a highlight snapped to, with Copy, where the off-page notice shows.
    this.textCopyEl = this.surfaceEl.createDiv({ cls: "goodobsidian-text-copy is-hidden" });
    this.textCopyEl.setAttribute("role", "status");
    iconInto(this.textCopyEl.createSpan({ cls: "goodobsidian-text-copy-icon" }), "highlighter", "");
    this.textCopyLabel = this.textCopyEl.createSpan({ cls: "goodobsidian-text-copy-label" });
    const textCopyButton = this.textCopyEl.createEl("button", {
      cls: "goodobsidian-text-copy-button clickable-icon",
      text: "Copy",
    });
    onTap(textCopyButton, () => {
      const text = this.textCopyText;
      this.hideTextCopy();
      this.copyText(text);
    });
    this.hudEl = this.surfaceEl.createDiv({ cls: "goodobsidian-hud" });
    this.eraserCursorEl = this.paperEl.createDiv({ cls: "goodobsidian-eraser-cursor is-hidden" });
    // Over the ink and under the text boxes, in screen px: the laser's trail.
    this.laserCanvas = this.surfaceEl.createEl("canvas", {
      cls: "goodobsidian-canvas goodobsidian-canvas-laser",
    });
    this.surfaceEl.insertBefore(this.laserCanvas, this.scrollEl);
    this.setDebug(options.debug);

    // A lock badge on each locked picture, under the selection chrome. The
    // badges take no presses: a tap-and-hold on the picture reaches the page.
    this.lockBadgesEl = this.paperEl.createDiv({ cls: "goodobsidian-lock-badges is-hidden" });
    // A ribbon beside each heading listed in the contents. Takes no presses either.
    this.sectionRibbonsEl = this.paperEl.createDiv({
      cls: "goodobsidian-section-ribbons is-hidden",
    });
    // With the by-line lasso, a mark beside each line where a press and a
    // drag inserts space. Drawn over the ink, so writing in the margin
    // cannot hide it; it takes no presses (the margin under it does).
    this.spaceHandlesEl = this.paperEl.createDiv({
      cls: "goodobsidian-space-handles is-hidden",
    });

    // The selected image's chrome, above the text boxes, after GoodNotes:
    // square corner handles (resize, aspect kept), round handles mid-edge
    // (stretch one way), and a rotate knob hanging below on a stem. Its sizes
    // are screen px, handed to the stylesheet from the same constants the
    // hit-testing uses, so what is drawn and what answers a tap cannot drift
    // apart.
    const chromeSizes = {
      "--gob-image-handle": `${HANDLE_HIT_RADIUS_PX * 2}px`,
      "--gob-image-rotate-offset": `${ROTATE_HANDLE_OFFSET_PX}px`,
      "--gob-image-knob": `${ROTATE_KNOB_RADIUS_PX * 2}px`,
    };
    this.imageUiEl = this.paperEl.createDiv({ cls: "goodobsidian-image-ui is-hidden" });
    this.imageUiEl.setCssProps(chromeSizes);
    this.imageFrameEl = this.imageUiEl.createDiv({ cls: "goodobsidian-image-frame" });
    for (const corner of IMAGE_CORNERS) {
      this.imageFrameEl.createDiv({ cls: `goodobsidian-image-handle is-corner is-${corner}` });
    }
    for (const edge of IMAGE_EDGES) {
      this.imageFrameEl.createDiv({ cls: `goodobsidian-image-handle is-edge is-${edge}` });
    }
    const knob = this.imageFrameEl.createDiv({ cls: "goodobsidian-image-rotate" });
    iconInto(knob.createDiv({ cls: "goodobsidian-image-rotate-knob" }), "refresh-cw", "↻");
    this.imageFrameEl.addEventListener("pointerdown", this.onImagePointerDown);

    // Crop mode: a box over the whole picture, which takes every press on
    // it, with the crop frame and its handles inside.
    this.cropUiEl = this.paperEl.createDiv({ cls: "goodobsidian-crop-ui is-hidden" });
    this.cropUiEl.setCssProps(chromeSizes);
    this.cropPictureEl = this.cropUiEl.createDiv({ cls: "goodobsidian-crop-picture" });
    this.cropFrameEl = this.cropPictureEl.createDiv({ cls: "goodobsidian-crop-frame" });
    for (const handle of [...IMAGE_CORNERS, ...IMAGE_EDGES]) {
      const kind = handle.length === 2 ? "is-corner" : "is-edge";
      this.cropFrameEl.createDiv({ cls: `goodobsidian-crop-handle ${kind} is-${handle}` });
    }
    this.cropPictureEl.addEventListener("pointerdown", this.onCropPointerDown);

    // The lasso selection's frame (a press inside it drags the selection),
    // then the action bar and its menu, above everything else on the page.
    this.palette = options.palette ?? PALETTE;
    this.selectionUiEl = this.paperEl.createDiv({ cls: "goodobsidian-selection-ui" });
    this.selectionFrameEl = this.selectionUiEl.createDiv({
      cls: "goodobsidian-selection-frame is-hidden",
    });
    // A freehand lasso's selection is drawn by the loop the pen drew, rounded
    // off, not by a box (see `smoothLoop`); the frame keeps taking the drags.
    const outline = activeDocument.createElementNS(SVG_NS, "svg");
    outline.setAttribute("class", "goodobsidian-selection-outline");
    outline.setAttribute("aria-hidden", "true");
    this.selectionPathEl = activeDocument.createElementNS(SVG_NS, "path");
    outline.append(this.selectionPathEl);
    this.selectionFrameEl.append(outline);
    // A square handle at each corner resizes the selection, the aspect kept,
    // drawn as a picture's corner handles are, from the same sizes.
    this.selectionUiEl.setCssProps(chromeSizes);
    for (const corner of IMAGE_CORNERS) {
      this.selectionFrameEl.createDiv({ cls: `goodobsidian-image-handle is-corner is-${corner}` });
    }
    // And a rotate knob below it on a stem, as below a picture.
    const groupKnob = this.selectionFrameEl.createDiv({ cls: "goodobsidian-image-rotate" });
    iconInto(groupKnob.createDiv({ cls: "goodobsidian-image-rotate-knob" }), "refresh-cw", "↻");
    this.selectionFrameEl.addEventListener("pointerdown", this.onSelectionPointerDown);
    this.actionBar = new SelectionActionBar(this.selectionUiEl, "Selection");
    // With the lasso, a text box is something to select, not to type in.
    this.surfaceEl.toggleClass("is-lasso", toolState.tool === "select");
    this.surfaceEl.toggleClass("is-text-tool", toolState.tool === "text");

    const renderer = new Renderer(
      backdropCanvas,
      dryCanvas,
      wetCanvas,
      options.desynchronizedCanvas,
    );
    renderer.highlighterAlpha = options.highlighterAlpha;
    renderer.paper = this.paper;
    this.renderer = renderer;

    // Pen, mouse and finger input arrive through the transparent overlay,
    // mapped into layout space as they come in.
    const input = new PointerController(
      this.scrollEl,
      (clientX, clientY) => this.toLayout(clientX, clientY),
      this.pointerCallbacks,
      () => this.handHeld,
      (event) => this.pressRoute(event),
    );
    input.attach();
    this.pointerInput = input;
    this.disposers.push(() => input.detach());

    // iOS WebKit runs its own long-press recogniser on the raw *touch* stream,
    // and when it claims a stationary pen it ends the pointer in pointercancel
    // — which is exactly what draw-and-hold asks the user to do. Neither
    // `touch-action: none` nor `-webkit-touch-callout: none` reaches that
    // recogniser; cancelling touchstart does (pointer events are dispatched
    // first and are unaffected). Stylus touches only: a finger tap must still
    // synthesise the click that focuses a text box.
    //
    // touchmove is cancelled too, for iPadOS Scribble: with it on, the system
    // watches every Pencil stroke for handwriting and swallows pointer events
    // it claims (WebKit bug 217430; Apple forums thread 662874). Cancelling
    // touchmove is the documented way to tell it the page owns the stroke.
    //
    // Finger touches on the page are stopped from bubbling past the surface:
    // Obsidian mobile watches touches for its edge swipes (the sidebars, the
    // file properties pane), and a swipe that starts on the page is a scroll,
    // not a request for a sidebar. Touches on a text box are left alone; the
    // box needs the click the browser synthesises from them. (That Obsidian
    // listens on the bubbling path is an assumption; see the ledger.)
    const onTouch = (event: TouchEvent): void => {
      if (event.type === "touchstart") this.diagSums.touchStarts++;
      this.touchCount = event.touches.length;
      for (let i = 0; i < event.changedTouches.length; i++) {
        const touch = event.changedTouches[i] as Touch & { touchType?: string };
        if (touch.touchType === "stylus") {
          if (event.type === "touchstart") this.diagSums.stylusTouches++;
          if (event.type === "touchstart" || event.type === "touchmove") event.preventDefault();
          return;
        }
      }
      if (onTextBox(event.target)) return;
      // The lasso's menu scrolls by itself when it is taller than the view
      // (the custom colour picker): a finger there must not be cancelled.
      if (onSelectionMenu(event.target)) {
        event.stopPropagation();
        return;
      }
      event.stopPropagation();
      if (event.type === "touchmove" && this.touchPanning && event.cancelable) {
        event.preventDefault();
      }
      // A finger held still is a tap-and-hold (the press menu), with any
      // tool. Cancelling its touchstart keeps WebKit's own long press from
      // claiming it and ending it in pointercancel, as it does a held Pencil.
      // No finger tap on the page needs its click: every control over it acts
      // on pointer events, and text boxes returned above. Except while a box
      // is being typed in, outside the lasso: a tap beside it must still
      // blur it, and a hold that WebKit cancels is caught as one anyway.
      if (
        event.type === "touchstart" &&
        event.cancelable &&
        !isButtonLike(event.target) &&
        (this.toolState.tool === "select" || !this.editingTextView())
      ) {
        event.preventDefault();
      }
    };
    for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"] as const) {
      this.scrollEl.addEventListener(type, onTouch, { passive: false });
      this.disposers.push(() => this.scrollEl.removeEventListener(type, onTouch));
    }

    // A right-click (or a trackpad's secondary click) on the paper opens the
    // press menu where it landed, as holding a finger does on the iPad. A
    // touch or the Pencil open it by holding, not here (Chromium sends a
    // contextmenu for a long press too, palm or not). Text boxes keep the
    // system's menu.
    const onContextMenu = (event: MouseEvent): void => {
      if (onTextBox(event.target) || isEditable(event.target)) return;
      event.preventDefault();
      const type = (event as Partial<PointerEvent>).pointerType;
      if (type === "touch" || type === "pen" || this.touchPanning) return;
      // A tablet driver can send a stylus button as a right click (FineNotes#25).
      if (now() < this.stylusMenuUntil) return;
      const target = event.target as Node | null;
      if (target && (this.selectionUiEl.contains(target) || this.imageUiEl.contains(target))) {
        return;
      }
      if (this.lasso || this.imageDrag || this.groupDrag || this.cropping) return;
      const at = this.toLayout(event.clientX, event.clientY);
      const box = boxAtPoint(this.pageLayout, at.x, at.y);
      if (box) this.openPressMenu(box, this.toPage(box, at));
    };
    this.scrollEl.addEventListener("contextmenu", onContextMenu);
    this.disposers.push(() => this.scrollEl.removeEventListener("contextmenu", onContextMenu));

    // Wheel and trackpad: scroll, or zoom with Ctrl/Cmd (a trackpad pinch
    // arrives as a Ctrl+wheel). Momentum on a trackpad is the OS's own.
    const onWheel = (event: WheelEvent): void => this.onWheel(event);
    for (const element of [this.scrollEl, this.thumbYEl, this.thumbXEl]) {
      element.addEventListener("wheel", onWheel, { passive: false });
      this.disposers.push(() => element.removeEventListener("wheel", onWheel));
    }

    // Neither the surface nor the scroll overlay scrolls natively (the page
    // moves by a transform), but a browser may still scroll an overflow:hidden
    // element to reveal a focused text box — iPadOS does, when the keyboard
    // opens. That slides the canvases out from under the page; undo it at once.
    for (const el of [this.surfaceEl, this.scrollEl]) {
      const pin = (): void => {
        if (el.scrollTop !== 0) el.scrollTop = 0;
        if (el.scrollLeft !== 0) el.scrollLeft = 0;
      };
      el.addEventListener("scroll", pin);
      this.disposers.push(() => el.removeEventListener("scroll", pin));
    }

    // The on-screen keyboard changes the visual viewport, and a WebView may
    // report that without resizing any element the ResizeObserver watches.
    // Repaint on it anyway, so the canvases can never sit stale under the page.
    const vv = window.visualViewport;
    if (vv) {
      const onViewport = (): void => this.scheduleRelayout();
      vv.addEventListener("resize", onViewport);
      vv.addEventListener("scroll", onViewport);
      this.disposers.push(() => {
        vv.removeEventListener("resize", onViewport);
        vv.removeEventListener("scroll", onViewport);
      });
    }

    // Leaving the app may put something newer on the system clipboard: from
    // then on, a picture pasted from there wins over the plugin's clipboard
    // (see `handlePaste`). Idempotent, so every open surface may report it.
    const onLeave = (): void => clipboard.noteWindowLeft();
    const onVisibility = (): void => {
      if (document.visibilityState === "hidden") clipboard.noteWindowLeft();
    };
    window.addEventListener("blur", onLeave);
    document.addEventListener("visibilitychange", onVisibility);
    this.disposers.push(() => {
      window.removeEventListener("blur", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    });

    // A pane that changes size (a sidebar, a rotation, a split) is laid out again.
    const sizeWatch = new ResizeObserver(() => this.layout());
    sizeWatch.observe(this.surfaceEl);
    this.disposers.push(() => sizeWatch.disconnect());

    // Every path that changes the history — a stroke, an erase, a withdrawn
    // empty text box, undo, a new file — reaches the host's buttons this way.
    this.history.onChange = () => this.syncHistory();
    this.setDocument(doc);
  }

  /**
   * Stop everything the surface set going: frames, timers, gestures, the
   * pointer controller, listeners and observers. Its DOM stays; that is the
   * host's to remove.
   */
  destroy(): void {
    this.eyedropper?.cancel();
    this.watchTypingKeyboard(false);
    window.clearTimeout(this.textPillSettleTimer);
    window.clearTimeout(this.wheelSnapTimer);
    this.cancelPendingReturn();
    window.clearTimeout(this.detailRestTimer);
    this.hideOffPage();
    for (const frame of [
      this.frameReq,
      this.prefetchReq,
      this.hudFrame,
      this.wetFrame,
      this.focusHoldFrame,
      this.relayoutFrame,
      this.laserFrame,
    ]) {
      if (frame) window.cancelAnimationFrame(frame);
    }
    this.frameReq = this.prefetchReq = this.hudFrame = this.wetFrame = 0;
    this.focusHoldFrame = this.relayoutFrame = 0;
    window.clearTimeout(this.wheelZoomTimer);
    this.wheelZoomTimer = 0;
    window.clearTimeout(this.chromeTimer);
    this.chromeTimer = 0;
    window.clearTimeout(this.textClassTimer);
    this.textClassTimer = 0;
    window.clearTimeout(this.pasteTimer);
    this.pasteTimer = 0;
    this.stopPress();
    this.stopHold();
    this.cancelImageDrag();
    this.cancelGroupDrag();
    this.endCrop(false);
    this.actionBar.destroy();
    this.flip?.cancel();
    this.flip = null;
    this.renderer?.destroy();
    document.body.removeClass(TEXT_EDITING_BODY_CLASS);
    while (this.disposers.length > 0) this.disposers.shift()?.();
    // From here on every late callback finds no renderer and does nothing.
    this.renderer = null;
  }

  // --- The document being edited ---------------------------------------------

  /**
   * Edit `doc` from now on (a note opened, or its file changed on disk). The
   * history starts empty, and new ids count on from the ones `doc` holds.
   */
  setDocument(doc: InkDocument): void {
    this.doc = doc;
    this.parkedText = null;
    this.strokeIds.restart(strokeIdsOf(doc));
    this.textBoxIds.restart(textBoxIdsOf(doc));
    this.history.clear();
    this.lastTextBoxAdd = null;
    this.heldText = null;
    this.circleLoop = null;
    // A reloaded file is new objects: the old selection points at nothing.
    this.dropSelection();
    this.eraseReset();
    this.strokeIndex.rebuild(doc.pages);
    this.renderer?.invalidateAll();
    this.layout();
    // Opening a note says where you are, page and zoom, then both fade.
    this.flashChrome(true);
    this.reportStatus();
  }

  /**
   * Apply a document-level command (add/remove page, set backdrop, place an
   * image) through this surface's undo stack, so it undoes with the ink.
   * Stroke edits go through the surface's own tools instead. Any selection
   * is dropped; to select an image just placed, call {@link selectImage}.
   */
  applyCommand(command: Command): void {
    this.dropSelection();
    const place = this.readingPlace();
    this.history.push(this.doc, command);
    // A host command can bring in elements with ids of their own (a duplicated
    // page does), so the id sequences must never fall behind the document.
    this.strokeIds.catchUp(strokeIdsOf(this.doc));
    this.textBoxIds.catchUp(textBoxIdsOf(this.doc));
    this.strokeIndex.rebuild(this.doc.pages);
    this.renderer?.invalidateAll();
    this.layout();
    if (command.keepsReading) this.keepReading(place);
    this.changed();
  }

  /** The page being read and where the view is on it, to come back to after pages move. */
  private readingPlace(): { page: Page; y: number } | null {
    const page = this.doc.pages[this.pageIndex];
    const box = this.pageLayout.boxes[this.pageIndex];
    if (!page || !box || !(this.scale > 0)) return null;
    // In layout px, so a change of scale (the widest page gone) cannot skew it.
    return { page, y: this.scroller.position.y / this.scale - box.y };
  }

  /**
   * Pages were added, removed or reordered (a `keepsReading` command): keep
   * the page that was being read in view, at the same place on it, rather
   * than whatever page now sits at the old scroll position. If that page is
   * gone, the view stays where it is.
   */
  private keepReading(place: ReturnType<InkSurface["readingPlace"]>): void {
    if (!place) return;
    const index = this.doc.pages.indexOf(place.page);
    const box = this.pageLayout.boxes[index];
    if (index < 0 || !box) return;
    if (this.direction === "horizontal") {
      this.goToPage(index);
      return;
    }
    // `layout` has already rescaled x; only the page's place in the column moved.
    this.scroller.setPosition(this.scroller.position.x, (box.y + place.y) * this.scale);
    this.syncViewport();
    this.requestFrame();
  }

  /**
   * The clock new strokes are timestamped with, in wall-clock ms. Every
   * stroke committed gets `t0` = its pen-down on this clock minus its page's
   * `epoch`, and a page without one gets one with its first stroke, in the
   * same undo step (`addStrokesTimed`). Hosts that record audio pass the
   * recorder's clock, which is pinned to the monotonic clock while a
   * recording runs; everyone else keeps the default wall clock.
   */
  setClock(clock: () => number): void {
    this.clock = clock;
  }

  /**
   * While set, a finger tap on ink — or a tap with the lasso — is offered to
   * `handler` first (audio replay seeks to when the ink was written). `null`
   * gives taps back their usual meaning.
   */
  setStrokeTapHandler(handler: StrokeTapHandler | null): void {
    this.strokeTapHandler = handler;
  }

  /** Repaint without touching layout or indexes (a PDF raster arrived). */
  repaint(): void {
    this.renderer?.invalidateAll();
    this.requestFrame();
  }

  /** The document being edited: the one object every edit changes in place. */
  get document(): InkDocument {
    return this.doc;
  }

  get pageCount(): number {
    return this.doc.pages.length;
  }

  /** 0-based index of the page currently filling most of the viewport. */
  get currentPage(): number {
    return this.pageIndex;
  }

  /**
   * The part of page `index` that is on screen, in that page's own
   * coordinates, or null when none of it is. For hosts that place something
   * "where the reader is looking" (an AI answer, a generated picture).
   */
  visiblePageRect(index = this.pageIndex): { x: number; y: number; w: number; h: number } | null {
    const box = this.pageLayout.boxes[index];
    const scale = this.scale;
    if (!box || !(scale > 0) || this.cssW === 0 || this.cssH === 0) return null;
    // Screen x = offsetX + layoutX * scale; the viewport's scrollY is in layout px.
    const left = Math.max(box.x, -this.offsetX / scale);
    const right = Math.min(box.x + box.width, (this.cssW - this.offsetX) / scale);
    const top = Math.max(box.y, this.viewport.scrollY);
    const bottom = Math.min(box.y + box.height, this.viewport.scrollY + this.cssH / scale);
    if (right <= left || bottom <= top) return null;
    return { x: left - box.x, y: top - box.y, w: right - left, h: bottom - top };
  }

  /**
   * Where the page being read is drawn, in client px, measured with the pane
   * at rest: a running {@link glideFrom} is finished first. For a host that
   * animates the pane around the page (the page sidebar).
   */
  pageClientRect(): { left: number; top: number; width: number; height: number } | null {
    this.flip?.finish();
    this.flip = null;
    const box = this.pageLayout.boxes[this.pageIndex];
    const scale = this.scale;
    if (!box || !(scale > 0) || this.cssW === 0) return null;
    const pane = this.surfaceEl.getBoundingClientRect();
    return {
      left: pane.left + this.offsetX + box.x * scale,
      top: pane.top + (box.y - this.viewport.scrollY) * scale,
      width: box.width * scale,
      height: box.height * scale,
    };
  }

  /**
   * The pane just changed shape and was laid out afresh — the page sidebar
   * opened or closed. Draw the page where it was (`before`, from
   * {@link pageClientRect}) and glide it to where it is now, over
   * `durationMs`. A transform on the whole surface (FLIP): no canvas is
   * resized or repainted mid-glide, and the new layout is sharp the moment
   * it lands. Skipped when the page did not move, and for reduced motion.
   */
  glideFrom(before: { left: number; top: number; width: number }, durationMs: number): void {
    const after = this.pageClientRect();
    if (!after || !(after.width > 0) || !(before.width > 0)) return;
    if (prefersReducedMotion() || typeof this.surfaceEl.animate !== "function") return;
    const k = before.width / after.width;
    const pane = this.surfaceEl.getBoundingClientRect();
    // About the pane's top-left corner, the page's corner lands on `before`'s.
    const tx = before.left - pane.left - (after.left - pane.left) * k;
    const ty = before.top - pane.top - (after.top - pane.top) * k;
    if (Math.abs(tx) < 0.5 && Math.abs(ty) < 0.5 && Math.abs(k - 1) < 0.001) return;
    const flip = this.surfaceEl.animate(
      [
        { transformOrigin: "0 0", transform: `translate(${tx}px, ${ty}px) scale(${k})` },
        { transformOrigin: "0 0", transform: "translate(0, 0) scale(1)" },
      ],
      { duration: durationMs, easing: "ease" },
    );
    this.flip = flip;
    flip.onfinish = () => {
      if (this.flip === flip) this.flip = null;
    };
  }

  private pageAt(index: number): Page | null {
    return this.doc.pages[index] ?? null;
  }

  /** Tell the host to refresh what it shows of the surface: stroke count, zoom, page. */
  private reportStatus(): void {
    this.callbacks.onStatus?.();
  }

  /**
   * The document changed: the host refreshes its status and saves. `pages`:
   * the ids of the only pages changed, only where that is certain (the
   * host's save cache trusts it; see InkSurfaceCallbacks.onChange).
   */
  private changed(pages?: readonly string[]): void {
    this.reportStatus();
    // Ink moved or went: the underlines and ribbons follow it.
    this.syncSectionRibbons();
    // A page's template may have changed: its lines, and their markers.
    this.syncSpaceHandles();
    this.callbacks.onChange(pages);
  }

  /** After an edit to the ink: put the tiles right at once, then tell the host. */
  private inkChanged(pages?: readonly string[]): void {
    this.renderDry();
    this.changed(pages);
  }

  // --- What the host can ask for -----------------------------------------------

  /**
   * Show the pages light or dark (`paperTheme`). Only what is painted
   * changes: tiles and page previews are emptied, since they hold colour;
   * the stroke outlines they are drawn from hold none and stay.
   */
  setPaperTheme(theme: PaperTheme): void {
    if (theme === this.paper) return;
    this.paper = theme;
    if (!this.renderer) return;
    this.renderer.paper = theme;
    this.renderer.invalidateAll();
    this.syncTextBoxes();
    this.syncInkCursor();
    this.requestFrame();
  }

  get paperTheme(): PaperTheme {
    return this.paper;
  }

  /** Reset zoom to the whole page and scroll back to the top ("fit / reset"). */
  resetView(): void {
    this.pinch = null;
    this.zoomAnim = null;
    this.userZoom = this.minZoom;
    this.ensurePaperSize();
    this.layout();
    // After the layout, which would otherwise keep the current page of a row centred.
    this.scroller.setPosition(this.direction === "horizontal" ? this.rowX(0) : 0, 0);
    this.syncViewport();
    this.requestFrame();
    this.reportStatus();
  }

  zoomIn(): void {
    this.zoomBy(ZOOM_STEP);
  }

  zoomOut(): void {
    this.zoomBy(1 / ZOOM_STEP);
  }

  /**
   * Show page `index`: its top at the top of the viewport, or — pages
   * running across — centred. With `animate` it glides there in a fixed
   * time (`GLIDE_MS`), however far away the page is, as GoodNotes does.
   */
  goToPage(index: number, animate = false): void {
    this.parkedText = null;
    const clamped = Math.max(0, Math.min(this.doc.pages.length - 1, index));
    const row = this.direction === "horizontal";
    if (row && !this.turnsPages && clamped !== this.pageIndex) {
      // Zoomed in, a row is held to the page being read (`ensurePaperSize`),
      // so a glide to another page stopped at this one's edge. Move the hold
      // to the new page and land on its top-left corner, at the same zoom.
      this.pageIndex = clamped;
      this.ensurePaperSize();
      const range = rowPageScrollRange(this.pageLayout, clamped, this.scale, this.cssW);
      this.scroller.setPosition(range.min, 0);
      this.syncViewport();
      this.callbacks.onPageChange?.(clamped, this.doc.pages.length);
      this.reportStatus();
      this.flashChrome();
      this.requestFrame();
      return;
    }
    const x = row ? this.rowX(clamped) : this.scroller.position.x;
    const y = row ? 0 : scrollTopForPage(this.pageLayout, clamped) * this.scale;
    if (animate) this.scroller.glideTo(x, y, now());
    else this.scroller.setPosition(x, y);
    this.syncViewport();
    this.flashChrome();
    this.requestFrame();
  }

  /**
   * Go to a point inside page `index` (page px): the page, scrolled so the
   * point sits a little below the top of the view. A row of pages turns to
   * the page and goes no further.
   */
  goToPagePoint(index: number, y: number, animate = false): void {
    const clamped = Math.max(0, Math.min(this.doc.pages.length - 1, index));
    const box = this.pageLayout.boxes[clamped];
    if (this.direction === "horizontal" || !box) {
      this.goToPage(clamped, animate);
      return;
    }
    const lead = SECTION_LEAD_PX / this.scale;
    const top = Math.max(0, box.y + Math.max(0, y) - lead) * this.scale;
    const x = this.scroller.position.x;
    if (animate) this.scroller.glideTo(x, top, now());
    else this.scroller.setPosition(x, top);
    this.syncViewport();
    this.flashChrome();
    this.requestFrame();
  }

  /** The scroll x that centres page `index` of a row in the pane. */
  private rowX(index: number): number {
    return rowScrollXForPage(this.pageLayout, index, this.scale, this.cssW);
  }

  /** Let (or stop) a pull past the last page add a page. The host knows single pages. */
  setPullToAddPage(enabled: boolean): void {
    this.pullAddEnabled = enabled;
    if (!enabled) this.pullAdd.hide();
  }

  /** Which way this notebook's pages run. */
  get scrollDirection(): ScrollDirection {
    return this.direction;
  }

  nextPage(): void {
    this.goToPage(this.pageIndex + 1, true);
  }

  previousPage(): void {
    this.goToPage(this.pageIndex - 1, true);
  }

  /** Whether an add-page control should be enabled (see `onAddPageRequested`). */
  get canAddPage(): boolean {
    return typeof this.callbacks.onAddPageRequested === "function";
  }

  /** Ask the host to insert a page after the one currently being read. */
  requestAddPage(): void {
    this.callbacks.onAddPageRequested?.(this.pageIndex);
  }

  /**
   * Keep this surface to writing (a practice file), or let it go back to
   * everything. `device` names what it is written on, for the file.
   */
  setPractice(device: string | null): void {
    this.practice = device === null ? null : { device };
    if (this.practice && !isPracticeTool(this.toolState.tool)) {
      this.setTool("pen");
      this.callbacks.onToolChange?.("pen");
    }
  }

  setTool(tool: ActiveTool): void {
    // A colour waiting to be picked was for the tool being left.
    this.eyedropper?.cancel();
    // Another tool: a box scrolled out of sight is forgotten.
    this.parkedText = null;
    // "The pen" means the pen type in hand: with the highlighter as the type,
    // a return to the pen is a return to the highlighter. Otherwise strokes
    // were stored as opaque pen ink in the highlighter's colour and width.
    // (An explicit highlighter, the H key, stays the highlighter.)
    if (tool === "pen" && this.toolState.penType === "highlighter") tool = "highlighter";
    // A practice file has the pen and the eraser only.
    if (this.practice && !isPracticeTool(tool)) tool = "pen";
    // The toolbar shares `toolState` and has already written the new tool
    // into it, so the one being replaced is read from `toolSeen`.
    if (tool === "text" && this.toolSeen !== "text") this.toolBeforeText = this.toolSeen;
    if (tool !== "select") this.selectionToolUsed = false;
    this.drawingTool = drawingToolOf(this.drawingTool, tool);
    // A tool picked by hand overrides a return still waiting to happen.
    this.cancelPendingReturn();
    this.toolSeen = tool;
    this.toolState.tool = tool;
    if (tool !== "highlighter") this.dropTextMark();
    if (this.textCopyTimer) this.hideTextCopy();
    this.prefetchText();
    this.surfaceEl.toggleClass("is-lasso", tool === "select");
    this.surfaceEl.toggleClass("is-text-tool", tool === "text");
    this.syncPenCursor();
    if (tool !== "select") this.dropSelection();
    // Locked pictures wear a badge only while the lasso could select them.
    this.syncLockBadges();
    this.syncSpaceHandles();
    if (tool !== "text") {
      this.releaseHeldText();
      this.hideTextHint();
      // Picking another tool finishes the box being edited — and since the
      // tool is no longer Text, finishing it switches nothing back.
      this.blurTextBox();
    }
  }

  /** Called only after a complete tool operation, never during pointer movement. */
  private completeToolUse(use: ToolUse): void {
    const tool = toolAfterUse(
      this.toolState.tool,
      use,
      this.callbacks.returnToPenAfterUse?.() === true,
      this.drawingTool,
    );
    if (tool === this.toolState.tool) return;
    this.setTool(tool);
    this.callbacks.onToolChange?.(tool);
  }

  /**
   * An eraser stroke or shape lifted at `at`: return after the rejoin
   * window, unless the next pen-down carries the use on (`pendingReturn`).
   */
  private deferToolUse(at: Pt | null): void {
    this.cancelPendingReturn();
    const enabled = this.callbacks.returnToPenAfterUse?.() === true;
    if (toolAfterUse(this.toolState.tool, "gesture", enabled) === this.toolState.tool) return;
    const timer = window.setTimeout(() => {
      this.pendingReturn = null;
      this.completeToolUse("gesture");
    }, REJOIN_MS);
    this.pendingReturn = { t: now(), x: at?.x ?? NaN, y: at?.y ?? NaN, timer };
  }

  /** A pen-down at `at` (layout space): the waiting return is cancelled or made now. */
  private settlePendingReturn(at: Pt): void {
    const pending = this.pendingReturn;
    if (!pending) return;
    this.cancelPendingReturn();
    if (continuesUse(pending, now(), at.x, at.y, this.atFitZoom(REJOIN_PX))) return;
    this.completeToolUse("gesture");
  }

  private cancelPendingReturn(): void {
    if (!this.pendingReturn) return;
    window.clearTimeout(this.pendingReturn.timer);
    this.pendingReturn = null;
  }

  /**
   * Delete or Cut took away what a lasso use selected: that finishes the use
   * as an outside click would, since nothing is left to click outside of.
   */
  private selectionTakenAway(): void {
    if (!this.selectionToolUsed || this.toolState.tool !== "select") return;
    this.selectionToolUsed = false;
    this.completeToolUse("selection");
  }

  /** The selection frame handles inside presses; a page press ends a used lasso. */
  private dismissUsedSelection(): boolean {
    if (
      !this.selectionToolUsed ||
      this.toolState.tool !== "select" ||
      this.callbacks.returnToPenAfterUse?.() !== true
    )
      return false;
    // Gone by other means (Delete, Cut, Undo): nothing is on screen to
    // dismiss, so this press is the lasso's again, as the toolbar shows.
    if (!this.liveSelection() && !this.liveImageSelection()) {
      this.selectionToolUsed = false;
      return false;
    }
    this.activePage = null;
    this.completeToolUse("selection");
    return true;
  }

  /**
   * Show or hide the diagnostics HUD. Showing it starts its event log and
   * totals from zero, so a recording begins clean.
   */
  /** Whether the pen in hand records pressure, so its new strokes widen with it. */
  setPressure(enabled: boolean): void {
    this.toolState.pressureEnabled = enabled;
  }

  /**
   * Draw the ink on the pages with its pressure (the "Pressure-sensitive pens"
   * setting), or at one even width: every stroke is traced again at the next
   * frame. Not the pen in hand: picking the ball pen must not redraw the
   * fountain pen's strokes. A stroke written without pressure stores 0.5,
   * which draws at the pen's own width either way.
   */
  setInkPressure(enabled: boolean): void {
    if (this.inkPressure === enabled) return;
    this.inkPressure = enabled;
    this.requestFrame();
  }

  setDebug(enabled: boolean): void {
    this.debug = enabled;
    this.hudEl.toggleClass("is-hidden", !enabled);
    if (!enabled) return;
    this.hud.restart();
    this.renderHud();
  }

  /**
   * A key pressed while the notebook has the focus (the host decides which
   * element listens). Returns whether the surface took it. Keys typed into a
   * field are the field's; which key does what is `keyOutcome`'s table.
   */
  handleKeyDown(event: KeyboardEvent): boolean {
    if (event.defaultPrevented || event.isComposing || isEditable(event.target)) return false;
    // Space on a focused toolbar button presses the button.
    if (event.key === " " && isButtonLike(event.target)) return false;
    const outcome = keyOutcome(event, {
      cropping: this.cropping !== null,
      editingText: () => this.editingTextView() !== null,
      clipboard: () => this.clipboardKey(event),
      menuOpen: () => this.actionBar.isMenuOpen,
      imageSelected: () => this.liveImageSelection() !== null,
      groupSelected: () => this.liveSelection() !== null,
      pressMenuOpen: () => this.pressMenu !== null,
      rowFitsPane: () => this.direction === "horizontal" && this.scroller.bounds.maxY <= 1,
    });
    if (!outcome) return false;
    if (outcome.preventDefault) event.preventDefault();
    this.runKeyAction(outcome.action);
    return true;
  }

  /**
   * Cmd/Ctrl+A: everything on the page being read, as the press menu's
   * Select all does, so Delete then clears it in one step (FineNotes#25).
   */
  private selectAllOnPage(): void {
    if (this.practice) return;
    const page = this.doc.pages[this.pageIndex];
    if (page) this.select(page.id, selectablesOf(page));
  }

  /**
   * What the cursor over the page is while a pen is in hand: the ink dot
   * (FineNotes#27), the small crosshair (FineNotes#25) or the arrow. The
   * view passes the arrow on a tablet.
   */
  setPenCursor(style: PenCursorStyle): void {
    this.penCursor = style;
    this.inkCursorKey = "";
    this.surfaceEl.removeClass("is-drawing");
    this.syncPenCursor();
  }

  /** The pen's colour, width or type changed in the toolbar: the ink cursor follows. */
  refreshPenCursor(): void {
    this.syncInkCursor();
  }

  private syncPenCursor(): void {
    const tool = this.toolState.tool;
    const pen = cursorToolOf(tool) !== null;
    this.surfaceEl.toggleClass("is-pen-cursor", this.penCursor === "crosshair" && pen);
    this.surfaceEl.toggleClass("is-ink-cursor", this.penCursor === "ink" && pen);
    this.surfaceEl.toggleClass("is-laser", tool === "laser");
    this.syncInkCursor();
  }

  /**
   * Draw the ink cursor for the pen in hand: its colour as this page shows
   * it (dark pages show ink lighter), and its width on screen at this zoom,
   * in whole px. Cheap when nothing changed, so it is called after every
   * zoom step; skipped during a pinch, and drawn once it ends.
   */
  private syncInkCursor(): void {
    if (this.penCursor !== "ink" || this.pinch) return;
    const tool = cursorToolOf(this.toolState.tool);
    if (!tool) return;
    const page = this.doc.pages[this.pageIndex];
    const night = page ? pageLook(page.backdrop, this.paper).night : false;
    const color = this.strokeColor();
    const shown =
      night && tool === "highlighter" ? nightHighlighter(color) : shownColor(color, night);
    const width = cursorSize(this.strokeSize() * this.unitScale);
    const highlighterAlpha = this.renderer?.highlighterAlpha ?? DEFAULT_HIGHLIGHTER_ALPHA;
    const key = `${tool} ${shown} ${width} ${highlighterAlpha}`;
    if (key === this.inkCursorKey) return;
    this.inkCursorKey = key;
    const hover = cursorFor(tool, shown, width, { highlighterAlpha });
    const down = cursorFor(tool, shown, width, { highlighterAlpha, drawing: true });
    this.surfaceEl.setCssProps({
      "--goodobsidian-pen-cursor": cursorCss(hover, "crosshair"),
      "--goodobsidian-pen-cursor-drawing": cursorCss(down, "crosshair"),
    });
  }

  /** A pen or mouse is down on the page, or lifted: the ink cursor shrinks to a dot meanwhile. */
  private markDrawing(on: boolean): void {
    if (this.penCursor === "ink") this.surfaceEl.toggleClass("is-drawing", on);
  }

  /** A key let go anywhere: space ends the hand (FineNotes#7). */
  handleKeyUp(event: KeyboardEvent): void {
    if (event.key === " ") this.setHand(false);
  }

  /**
   * Space held or let go. While held, a pen or mouse coming down on the page
   * moves it instead of drawing; the window losing focus lets go too, since
   * the key-up then goes elsewhere.
   */
  setHand(held: boolean): void {
    if (this.handHeld === held) return;
    this.handHeld = held;
    this.scrollEl.toggleClass("is-hand", held);
    if (!held) this.scrollEl.removeClass("is-hand-dragging");
  }

  private runKeyAction(action: KeyAction): void {
    if (typeof action === "object" && "savedPen" in action) {
      // A practice file is written with the pen it has.
      if (!this.practice) this.callbacks.onSavedPen?.(action.savedPen);
      return;
    }
    if (typeof action === "object") {
      const tool = selectedTool(
        this.toolState.tool,
        action.tool,
        this.callbacks.returnToPenOnReselect?.() === true,
        this.drawingTool,
      );
      if (this.practice && !isPracticeTool(tool)) return;
      this.setTool(tool);
      this.callbacks.onToolChange?.(tool);
      return;
    }
    switch (action) {
      case "hand":
        return this.setHand(true);
      case "select-all":
        return this.selectAllOnPage();
      case "shortcuts":
        return this.callbacks.onShortcuts?.();
      case "undo":
        return this.undo();
      case "redo":
        return this.redo();
      case "keep-crop":
      case "drop-crop":
        return this.endCrop(action === "keep-crop");
      case "close-menu":
        return this.actionBar.closeMenu();
      case "delete-image":
        this.deleteSelectedImage();
        return;
      case "deselect-image":
        return this.deselectImage();
      case "delete-selection":
        return this.deleteSelection();
      case "clear-selection":
        return this.clearSelection();
      case "next-page":
        return this.nextPage();
      case "previous-page":
        return this.previousPage();
      // An iPad with a keyboard: ↑ and ↓ scroll a step, as in GoodNotes.
      case "scroll-down":
        return this.scrollStep(ARROW_SCROLL_PX);
      case "scroll-up":
        return this.scrollStep(-ARROW_SCROLL_PX);
      case "none":
        return;
    }
  }

  // --- Layout and painting -----------------------------------------------------

  /** layout px -> CSS px. */
  private get scale(): number {
    return this.baseScale * this.userZoom;
  }

  /**
   * {@link scale}, for dividing by: 1 instead of zero (before the first
   * layout) or NaN, so a screen length never turns into an infinite one.
   */
  private get unitScale(): number {
    return this.scale || 1;
  }

  /**
   * A length tuned in page px at fit-to-width zoom, in page px at the zoom
   * now: the same distance on screen. Gesture thresholds (tap slop, hold
   * radius, sample spacing), default sizes and the eraser were all tuned
   * where a page px is about a screen px; left in page px they grew with
   * the zoom — at 5x a small drag with the Shape tool read as a tap and
   * placed a shape the size of the page (Joost's recording, 2026-09-24).
   * Pen width and text size stay in page px: they belong to the page.
   */
  private atFitZoom(length: number): number {
    const zoom = this.userZoom;
    return zoom > 0 && Number.isFinite(zoom) ? length / zoom : length;
  }

  /**
   * Measure the pane, stack the pages, fit them to its width and size the
   * canvases to it. A pane without a size yet is tried again (`SizeWait`).
   */
  layout(): void {
    const renderer = this.renderer;
    if (!renderer) return;
    const { clientWidth: cssW, clientHeight: cssH } = this.surfaceEl;
    const size = this.sizeWait.check(cssW, cssH);
    if (size === "retry") window.requestAnimationFrame(() => this.layout());
    if (size !== "layout") return;
    this.hudLayouts += 1;
    this.cssW = cssW;
    this.cssH = cssH;

    const direction = scrollDirectionOf(this.doc);
    const turned = direction !== this.direction;
    // The page being read stays the page being read when the pages turn.
    const reading = this.pageIndex;
    // And the spot being read stays at the top of the view when the scale
    // changes under it — the sidebar narrowing the pane, a rotation. The
    // scroll offset is in scaled px, so left alone it would now point
    // somewhere else in the notebook, pages away when zoomed in.
    const priorScale = this.scale;
    const priorAt = this.scroller.position;
    const anchored = this.zoomInitialised && !turned && direction === "vertical" && !this.pinch;
    this.direction = direction;
    this.pageLayout = layoutPages(this.doc.pages, { direction });
    renderer.setLayout(this.pageLayout);
    // Fit the page stack to the available width, but never magnify past 1:1 —
    // on a wide desktop pane an upscaled page looks like a zoom bug, and the
    // brief wants a page floating on a desk, not a page stretched across it.
    // This scales the *view*; no stored coordinate is touched, which is the
    // point of the whole design.
    // A row fits one page (and its margins) to the pane, not the whole row.
    const fit = this.pageLayout.fitWidth;
    this.baseScale = fit > 0 ? Math.min(1, cssW / fit) : 1;
    this.updateZoomFloor(cssH);
    if (direction === "horizontal") {
      // One page per screen, as GoodNotes: now the floor is known, space the
      // pages so a centred page's neighbours sit just off the pane. The gap
      // changes neither the fit width nor the tallest page, so the scale and
      // floor just computed still hold.
      const gap = rowSlotGap(this.doc.pages, cssW, this.baseScale * this.minZoom);
      this.pageLayout = layoutPages(this.doc.pages, { direction, gap });
      renderer.setLayout(this.pageLayout);
    }
    this.ensurePaperSize();
    const scale = this.scale;
    if (anchored && priorScale > 0 && Math.abs(scale / priorScale - 1) > 1e-6) {
      const ratio = scale / priorScale;
      this.scroller.setPosition(priorAt.x * ratio, priorAt.y * ratio);
    }
    if (turned) {
      this.userZoom = this.minZoom;
      this.ensurePaperSize();
      this.goToPage(reading);
    } else if (direction === "horizontal" && this.atZoomFloor && this.isScrollIdle) {
      // A pane that changed shape (rotation, split view) keeps the page centred.
      this.scroller.setPosition(this.rowX(this.pageIndex), 0);
    }

    renderer.resize(cssW, cssH, backingScale(window.devicePixelRatio));
    this.syncViewport();
    this.syncInkCursor();
    this.settleIfIdle();
    this.renderAll();
    this.schedulePrefetch();
    if (this.debug) this.scheduleHud();
  }

  private relayoutFrame = 0;

  /** Coalesce viewport events into one layout per frame. */
  private scheduleRelayout(): void {
    if (this.relayoutFrame) return;
    this.relayoutFrame = window.requestAnimationFrame(() => {
      this.relayoutFrame = 0;
      this.layout();
    });
  }

  /**
   * Recompute the zoom floor — the whole page on screen — for the pane's
   * height. The first layout opens at the floor, as GoodNotes opens a page;
   * afterwards a view sitting at the floor stays there when the pane changes
   * shape (a rotation), and a view below the new floor is lifted onto it.
   */
  private updateZoomFloor(cssH: number): void {
    let tallest = 0;
    for (const box of this.pageLayout.boxes) tallest = Math.max(tallest, box.height);
    const step = nextZoomFloor({
      zoom: this.userZoom,
      floor: this.minZoom,
      newFloor: fitPageZoom(tallest, this.baseScale, cssH),
      initialised: this.zoomInitialised,
      // A pane made short by the keyboard must not re-fit the page into it.
      keyboard: document.body.hasClass(TEXT_EDITING_BODY_CLASS) || keyboardHeight() > 0,
    });
    this.minZoom = step.floor;
    this.zoomInitialised = true;
    if (this.pinch) return;
    if (step.zoom !== this.userZoom) {
      this.zoomAnim = null;
      this.userZoom = step.zoom;
    }
  }

  /** Size the paper (the text boxes' frame) and the scroll range, in scaled px. */
  private ensurePaperSize(): void {
    const scale = this.scale;
    const width = Math.ceil(this.pageLayout.width * scale);
    const height = Math.ceil(this.pageLayout.height * scale);
    this.paperEl.setCssStyles({ width: `${width}px`, height: `${height}px` });
    const row = this.direction === "horizontal";
    const insets = row ? rowScrollInsets(this.pageLayout, scale, this.cssW) : { lead: 0, trail: 0 };
    // Zoomed in, a swipe moves around the page being read and never onto the
    // next one; turning pages waits until the view is zoomed out again.
    const rangeX =
      row && !this.turnsPages
        ? rowPageScrollRange(this.pageLayout, this.pageIndex, scale, this.cssW)
        : undefined;
    this.scroller.setExtent({
      contentWidth: width,
      contentHeight: height,
      viewportWidth: this.cssW,
      viewportHeight: this.cssH,
      leadX: insets.lead,
      trailX: insets.trail,
      // Even a one-page row stretches sideways, so it can be pulled to add a page.
      alwaysBounceX: row,
      rangeX,
      // While a box is typed in, room to lift it above the keyboard: a page
      // that fits the screen (a cover, a single page) has none of its own.
      trailY: this.editingTextView() ? keyboardHeight() : 0,
    });
  }

  /** At the zoom floor: the whole page on screen. */
  private get atZoomFloor(): boolean {
    return this.userZoom <= this.minZoom * 1.001;
  }

  /**
   * A row of pages zoomed out far enough to turn page by page (a little past
   * the floor still counts). Zoomed in further, swipes stay on the page.
   */
  private get turnsPages(): boolean {
    return this.direction === "horizontal" && rowTurnsPages(this.userZoom, this.minZoom);
  }

  /** No finger, fling, pinch or zoom spring is moving the view. */
  private get isScrollIdle(): boolean {
    return (
      !this.scroller.isDragging &&
      !this.scroller.isAnimating &&
      this.pinch === null &&
      this.zoomAnim === null
    );
  }

  /**
   * Derive the viewport from the scroller and move the paper to match. No
   * DOM is measured here: this runs every frame of a fling, and the scroll
   * position is state, not something read back from an element.
   */
  private syncViewport(): void {
    if (!this.renderer) return;
    const scale = this.unitScale;
    const paperWidth = this.pageLayout.width * scale;
    const { x, y } = this.scroller.position;
    // A page narrower than the pane floats centred; a wider one scrolls. A row
    // always scrolls: its scroll range already centres the first and last page.
    this.offsetX =
      this.direction !== "horizontal" && paperWidth <= this.cssW
        ? (this.cssW - paperWidth) / 2
        : -x;
    this.paperEl.setCssStyles({ transform: `translate(${this.offsetX}px, ${-y}px)` });
    this.viewport = { scrollY: y / scale, scale, width: this.pageLayout.width };
    this.renderer.setViewport(this.viewport, this.offsetX, this.userZoom);
    this.updatePageIndicator();
  }

  private updatePageIndicator(): void {
    const total = this.doc.pages.length;
    const scale = this.viewport.scale || 1;
    let index: number;
    if (this.direction === "horizontal") {
      const left = -this.offsetX / scale;
      index = currentPageIndexInRow(this.pageLayout, left, left + this.cssW / scale);
    } else {
      const top = this.viewport.scrollY;
      index = currentPageIndex(this.pageLayout, top, top + this.cssH / scale);
    }
    this.indicatorEl.setText(total > 0 ? `${index + 1} of ${total}` : "0 of 0");
    const seen = this.visiblePageRect(index);
    if (seen) this.callbacks.onReadingPoint?.(index, seen.y + seen.h / 3);
    this.indicatorEl.toggleClass("is-hidden", total === 0);
    if (index !== this.pageIndex) {
      this.pageIndex = index;
      this.callbacks.onPageChange?.(index, total);
      this.reportStatus();
      this.prefetchText();
      // A page of its own paper may show the ink in another colour.
      this.syncInkCursor();
    }
  }

  /**
   * Show the page counter and the scroll thumbs — and, for a zoom, the zoom
   * readout — and (re)start the clock that fades each one. Called on every
   * frame the page moves, so each fades a fixed time after the *last*
   * movement: instant in, then a 0.5 s fade (the stylesheet's), as GoodNotes
   * does. The readout lingers 200 ms longer than the counter.
   */
  private flashChrome(zoom = false): void {
    if (!this.renderer || this.doc.pages.length === 0) return;
    const t = now();
    this.indicatorEl.removeClass("is-idle");
    this.chromeUntil.counter = t + COUNTER_HOLD_MS;
    this.syncScrollThumbs(true);
    this.chromeUntil.thumbs = t + THUMB_HOLD_MS;
    if (zoom) {
      this.zoomReadoutEl.setText(`${zoomPercent(this.scale)}%`);
      this.zoomReadoutEl.removeClass("is-idle");
      this.chromeUntil.zoom = t + ZOOM_READOUT_HOLD_MS;
    }
    if (!this.chromeTimer) this.chromeTimer = window.setTimeout(this.fadeChrome, THUMB_HOLD_MS);
  }

  /**
   * Fade whatever is due and come back for the rest. A timer, because the
   * page coming to rest fires no event to react to.
   */
  private readonly fadeChrome = (): void => {
    this.chromeTimer = 0;
    if (!this.renderer) return;
    const t = now();
    let next = Infinity;
    const due = (until: number, fade: () => void): void => {
      if (until > t) next = Math.min(next, until);
      else fade();
    };
    due(this.chromeUntil.thumbs, () => {
      this.thumbYEl.addClass("is-idle");
      this.thumbXEl.addClass("is-idle");
    });
    due(this.chromeUntil.counter, () => this.indicatorEl.addClass("is-idle"));
    due(this.chromeUntil.zoom, () => this.zoomReadoutEl.addClass("is-idle"));
    if (next < Infinity) this.chromeTimer = window.setTimeout(this.fadeChrome, next - t + 1);
  };

  /**
   * Place the scroll thumbs for the scroll position now, from the scroller's
   * own range (so a row of pages, with its lead and trail, reads right).
   * With `show`, bring back any that scroll: an axis with nowhere to go has
   * no thumb.
   */
  private syncScrollThumbs(show: boolean): void {
    const bounds = this.scroller.bounds;
    const { x, y } = this.scroller.position;
    const place = (
      el: HTMLElement,
      position: number,
      viewport: number,
      range: number,
      vertical: boolean,
    ): void => {
      const track = viewport - 2 * THUMB_INSET;
      const thumb = scrollThumb(position, viewport, range + viewport, track);
      if (!thumb) {
        el.addClass("is-idle");
        return;
      }
      const along = THUMB_INSET + thumb.offset;
      el.setCssStyles(
        vertical
          ? { transform: `translateY(${along}px)`, height: `${thumb.length}px` }
          : { transform: `translateX(${along}px)`, width: `${thumb.length}px` },
      );
      if (show) el.removeClass("is-idle");
    };
    place(this.thumbYEl, y - bounds.minY, this.cssH, bounds.maxY - bounds.minY, true);
    place(this.thumbXEl, x - bounds.minX, this.cssW, bounds.maxX - bounds.minX, false);
  }

  // --- The frame loop -------------------------------------------------------
  //
  // Everything that moves the view — a finger, a fling, a pinch, the zoom
  // springing back, a wheel — asks for one frame. The frame advances the
  // physics, positions the paper and paints. While anything is still moving
  // it asks for the next frame; when it comes to rest it settles the tiles'
  // zoom level and starts prefetching. Nothing here measures the DOM.

  private requestFrame(): void {
    if (this.frameReq) return;
    this.frameReq = window.requestAnimationFrame(this.frame);
  }

  private readonly frame = (t: number): void => {
    this.frameReq = 0;
    if (!this.renderer) return;
    const started = now();
    // Both advance every frame: a pinch usually ends with one finger still
    // moving, so a fling and the zoom spring run together. Short-circuiting
    // here froze the spring for the length of the fling, then snapped it.
    const scrolling = this.scroller.step(t);
    const zooming = this.stepZoomAnim(t);
    const moving = scrolling || zooming;
    const busy = moving || this.scroller.isDragging || this.pinch !== null;
    this.noteViewMotion(busy);
    this.syncViewport();
    // The zoom has ended (a fling may carry on): place the boxes it hid or scaled.
    if (this.textBoxesProvisional && !this.zoomTransient) this.syncTextBoxes();
    this.trackTextPillMotion(busy);
    this.dropTextOutOfSight();
    this.reportTextAnchor();
    this.syncPullAdd();
    if (busy) this.flashChrome();
    const complete = this.paint(busy ? SCROLL_FRAME_BUDGET_MS : Infinity);
    if (this.debug) this.trackFrame(t, started, moving);
    if (moving || !complete) {
      this.requestFrame();
      return;
    }
    this.settleIfIdle();
    this.schedulePrefetch();
    // The action bar flips above or below the selection by what is on
    // screen, which a scroll changes; re-place it once the page comes to rest.
    if (this.imageSel) this.syncImageOverlay();
    if (this.selection) this.syncSelectionOverlay();
    if (this.pressMenu) this.syncActionBar();
  };

  /** Whether the zoom is mid-gesture, so the tiles' level must not change yet. */
  private get zoomTransient(): boolean {
    return (
      this.pinch !== null ||
      this.zoomAnim !== null ||
      this.wheelZoomTimer !== 0 ||
      this.zoomDrag !== null
    );
  }

  /** Whether the view moved within `REST_MS`: PDF detail waits until it rests. */
  private get viewMoving(): boolean {
    return this.zoomTransient || this.viewRest.moving(now());
  }

  /** Record this frame's view; once it stops, one more frame renders the held-back detail. */
  private noteViewMotion(busy: boolean): void {
    const { x, y } = this.scroller.position;
    if (!this.viewRest.note({ x, y, zoom: this.userZoom }, busy, now())) return;
    window.clearTimeout(this.detailRestTimer);
    this.detailRestTimer = window.setTimeout(() => {
      this.detailRestTimer = 0;
      this.requestFrame();
    }, REST_MS + 16);
  }

  /**
   * Text boxes a zoom only scaled or hid (`syncTextBoxes`): measured and
   * placed for real, once the zoom has come to rest.
   */
  private textBoxesProvisional = false;

  /** The zoom came to rest: rasterise at the live scale from now on. */
  private settleIfIdle(): void {
    if (this.textBoxesProvisional && !this.zoomTransient) this.syncTextBoxes();
    if (!this.renderer || this.zoomTransient || !this.renderer.isTransient) return;
    this.renderer.settle();
    this.paint(Infinity);
  }

  /** Paint the backdrop and the dry layer. Returns whether every tile was ready. */
  private paint(budgetMs: number): boolean {
    if (!this.renderer) return true;
    if (this.tilesPressure !== this.inkPressure) {
      // The pressure setting changed: every outline is different now.
      this.tilesPressure = this.inkPressure;
      this.renderer.invalidateAll();
    }
    this.renderBackdrop();
    const complete = this.renderDry(budgetMs);
    // An image or a lasso selection being dragged, or a picture being
    // cropped, lives on the wet layer, which does not follow a scroll or zoom
    // by itself.
    if (this.imageDrag?.lifted) this.renderImageDraft();
    if (this.groupDrag?.lifted) this.renderGroupDraft();
    if (this.cropping) this.renderCropDraft();
    return complete;
  }

  private schedulePrefetch(): void {
    if (this.prefetchReq || !this.renderer) return;
    this.prefetchReq = window.requestAnimationFrame(() => {
      this.prefetchReq = 0;
      if (!this.renderer || this.frameReq || this.scroller.isDragging || this.pinch) return;
      const more = this.renderer.prefetch(this.doc, this.inkPressure, PREFETCH_BUDGET_MS);
      if (more) this.schedulePrefetch();
    });
  }

  private stepZoomAnim(t: number): boolean {
    const anim = this.zoomAnim;
    if (!anim) return false;
    const progress = (t - anim.t0) / ZOOM_SPRING_MS;
    const zoom =
      progress >= 1 ? anim.to : anim.from * Math.pow(anim.to / anim.from, easeOutCubic(progress));
    this.applyZoom(zoom, anim.cx, anim.cy);
    if (progress >= 1) {
      this.zoomAnim = null;
      this.settleRowAfterZoom();
      return false;
    }
    return true;
  }

  private clampZoom(zoom: number): number {
    if (!Number.isFinite(zoom)) return this.minZoom;
    return Math.min(MAX_SCALE, Math.max(this.minZoom, zoom));
  }

  /**
   * Zoom about a client-space anchor, keeping the layout point under it
   * fixed. `nextZoom` is taken as given: a pinch passes a rubber-banded
   * value past the limits, everything else clamps first.
   */
  private applyZoom(nextZoom: number, anchorX: number, anchorY: number): void {
    const before = this.toLayout(anchorX, anchorY);
    this.userZoom = nextZoom;
    this.ensurePaperSize();
    this.syncViewport();
    const after = this.toLayout(anchorX, anchorY);
    const delta = anchorScrollDelta(before, after, this.scale);
    this.scroller.nudge(delta.x, delta.y);
    this.syncViewport();
    this.syncInkCursor();
    this.syncTextBoxes();
    this.syncImageOverlay();
    this.syncSelectionOverlay();
    this.syncLockBadges();
    this.syncSectionRibbons();
    this.syncSpaceHandles();
    this.flashChrome(true);
    this.requestFrame();
    this.reportStatus();
  }

  private zoomBy(factor: number): void {
    const rect = this.surfaceEl.getBoundingClientRect();
    this.applyZoom(
      this.clampZoom(this.userZoom * factor),
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
  }

  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? WHEEL_LINE_PX : event.deltaMode === 2 ? this.cssH : 1;
    if (event.ctrlKey || event.metaKey) {
      const factor = wheelZoomFactor(event.deltaY * unit);
      this.applyZoom(this.clampZoom(this.userZoom * factor), event.clientX, event.clientY);
      window.clearTimeout(this.wheelZoomTimer);
      this.wheelZoomTimer = window.setTimeout(() => {
        this.wheelZoomTimer = 0;
        this.requestFrame();
      }, WHEEL_ZOOM_SETTLE_MS);
      return;
    }
    let dx = event.deltaX * unit;
    let dy = event.deltaY * unit;
    const row = this.direction === "horizontal";
    // A mouse wheel only turns up and down: across a row of pages whose page
    // fits the pane, that is the only way it can go.
    const turnWheel = row && Math.abs(dy) > Math.abs(dx) && this.scroller.bounds.maxY <= 1;
    if ((event.shiftKey && dx === 0) || turnWheel) {
      dx = dy;
      dy = 0;
    }
    this.scroller.scrollBy(dx, dy);
    this.flashChrome();
    this.requestFrame();
    if (row && this.turnsPages) {
      // Settle on the nearest page once the wheel (or the trackpad's own
      // momentum) stops.
      window.clearTimeout(this.wheelSnapTimer);
      this.wheelSnapTimer = window.setTimeout(() => {
        this.wheelSnapTimer = 0;
        if (!this.isScrollIdle || this.direction !== "horizontal") return;
        this.snapToPage(0, this.pageIndex);
      }, WHEEL_SNAP_MS);
    }
  }

  /**
   * Glide `dy` CSS px down (or up), on from wherever the last step is still
   * heading, so holding the key scrolls steadily instead of stuttering.
   */
  private scrollStep(dy: number): void {
    const from = this.scroller.glideTarget ?? this.scroller.position;
    this.scroller.glideTo(from.x, from.y + dy, now(), ARROW_SCROLL_MS);
    this.flashChrome();
    this.requestFrame();
  }

  /** Centre the page being read, if a pinch asked for it on ending (see `onPinchEnd`). */
  private settleRowAfterZoom(): void {
    if (!this.snapRowAfterZoom) return;
    this.snapRowAfterZoom = false;
    if (this.turnsPages) this.snapToPage(0, this.pageIndex);
  }

  /**
   * After a swipe across a row of pages at the zoom floor: settle on the page
   * the release points at, one page at most from where the swipe began.
   */
  private snapToPage(velocity: number, fromIndex: number): void {
    const index = pageSnapIndex(
      this.pageLayout,
      this.scroller.position.x,
      velocity,
      fromIndex,
      this.scale,
      this.cssW,
    );
    this.scroller.snapTo(this.rowX(index), 0, now());
    this.requestFrame();
  }

  /** How far the page is stretched past the last page, along the way the pages run. */
  private pullOverscroll(): number {
    const end = this.scroller.overscrollEnd;
    return this.direction === "horizontal" ? end.x : end.y;
  }

  /** Keep the pull-to-add ring in step with the stretch while a finger holds it. */
  private syncPullAdd(): void {
    const held = this.direction === "horizontal" && !this.turnsPages;
    if (!this.pullAddEnabled || !this.touchPanning || held) {
      this.pullAdd.hide();
      return;
    }
    const over = this.pullOverscroll();
    this.pullAdd.update(this.direction, over, pullAddProgress(over));
  }

  /** Repaint backdrop + ink and re-place the text boxes and selection chrome (zoom, layout, edits). */
  private renderAll(): void {
    this.paint(Infinity);
    this.syncTextBoxes();
    this.syncImageOverlay();
    this.syncSelectionOverlay();
    this.syncLockBadges();
    this.syncSectionRibbons();
    this.syncSpaceHandles();
  }

  /** Keep typed page elements aligned with the canvas across pan and zoom. */
  private syncTextBoxes(): void {
    const expected = new Set<string>();
    const scale = this.unitScale;
    // Mid-zoom only the pages within a screen of the view are kept in step:
    // re-styling every box of a long notebook each frame of a pinch made it
    // crawl. The rest are hidden until the zoom rests and are placed then.
    const zooming = this.zoomTransient;
    this.textBoxesProvisional = false;
    const seen = zooming ? this.visiblePaperRect() : null;
    const marginX = this.cssW;
    const marginY = this.cssH;
    const measure: TextBoxView[] = [];

    for (const box of this.pageLayout.boxes) {
      const page = this.pageAt(box.index);
      if (!page) continue;
      const parked =
        seen !== null &&
        (box.x * scale > seen.maxX + marginX ||
          (box.x + box.width) * scale < seen.minX - marginX ||
          box.y * scale > seen.maxY + marginY ||
          (box.y + box.height) * scale < seen.minY - marginY);
      // Dark pages show a box's colours as its ink is shown (`./night`).
      const night = pageLook(page.backdrop, this.paper).night;
      for (const textBox of page.textBoxes) {
        const key = `${page.id}:${textBox.id}`;
        expected.add(key);
        let view = this.textBoxInputs.get(key);
        if (!view) view = this.createTextBoxView(page.id, textBox, key);
        const { input, root } = view;
        // Never the box being typed in or held: hiding it would blur it.
        const park = parked && !root.contains(document.activeElement) && this.heldText !== view;
        root.toggleClass("is-parked", park);
        if (park) {
          this.textBoxesProvisional = true;
          continue;
        }
        if (document.activeElement !== input && input.value !== textBox.text)
          input.value = textBox.text;
        this.renderShownText(view, textBox.text);
        const frame = this.frameDraft?.key === key ? this.frameDraft.frame : textBox;
        // A fitted box is as wide as its text, up to the page's edge. The
        // width is written back, so the file and the thumbnails wrap it
        // exactly as the textarea does; a box being moved keeps its own
        // until it lands.
        let width = frame.w;
        if (frame.fit) {
          width = this.fittedWidth(view, textBox, frame.x, box.width);
          if (frame === textBox) textBox.w = width;
        }
        // A lasso selection being dragged carries its text boxes along.
        const shift = this.dragShift(page.id, textBox);
        const fixedHeight = frame.h !== undefined;
        // iPadOS zooms the whole page into any text field whose computed font
        // is under 16px, which threw the view off the page when the keyboard
        // opened. So the field always *computes* >= 16px, and a transform
        // shrinks it back to the size the page scale calls for.
        // No floor: a floored font stops shrinking with the page, so small
        // labels re-wrapped zoomed out and grew over what sits under them.
        const fontPx = textBox.fontSize * scale;
        const shrink = Math.min(1, fontPx / IOS_MIN_INPUT_FONT_PX);
        view.shrink = shrink;
        // Page px -> the textarea's own px, before its shrink transform.
        const unit = scale / shrink;
        const lineHeight = lineHeightOf(textBox);
        // Switching between fixed and auto height (e.g. undoing a resize) must
        // re-measure, whatever the cache says.
        const heightModeChanged = view.fixed !== fixedHeight;
        view.fixed = fixedHeight;
        root.toggleClass("has-fixed-height", fixedHeight);
        const border = normalizeBorder(textBox.border);
        const inset = textInset(textBox);
        root.setCssStyles({
          left: `${Math.round((box.x + frame.x + shift.x) * scale)}px`,
          top: `${Math.round((box.y + frame.y + shift.y) * scale)}px`,
          width: `${Math.round(width * scale)}px`,
          height: fixedHeight ? `${Math.round((frame.h ?? 0) * scale)}px` : root.style.height,
          // The fill is the frame's, so it covers the whole box, handles aside.
          background: textBox.fill !== undefined ? shownColor(textBox.fill, night) : "",
          // The border is an inset shadow: drawn inside the edge, as the
          // thumbnails draw it, and taking no width from the text (the
          // padding below keeps the text clear of it). Never under 1 px: a
          // thinner shadow showed on two sides only, zoomed out.
          boxShadow: border
            ? `inset 0 0 0 ${Math.max(1, border.width * scale).toFixed(2)}px ${shownColor(border.color, night)}`
            : "",
          // A box that shows a fill or border has the corners the thumbnails
          // draw; a bare one keeps the soft editing frame from the stylesheet.
          // CSS shrinks a radius too big for the box, as cornerRadiusOf does.
          borderRadius:
            textBox.radius !== undefined
              ? `${(textBox.radius * scale).toFixed(2)}px`
              : textBox.fill !== undefined || border
                ? "0"
                : "",
        });
        // Every style key, re-read on every sync, so an undo or redo of a
        // style change shows at once — even in the box being typed in. The
        // font is a real family list from the model: the same one the
        // thumbnails paint with, installed on iPadOS, macOS and Windows.
        // The padding scales with the page (text-layout.ts), so the box
        // wraps at the same words at every zoom, and where the thumbnail does.
        const typeStyle = {
          fontSize: `${(fontPx / shrink).toFixed(2)}px`,
          fontFamily: fontFamilyOf(textBox),
          fontWeight: textBox.bold ? "700" : "400",
          fontStyle: textBox.italic ? "italic" : "normal",
          textDecoration: textDecorationOf(textBox),
          textAlign: textBox.align ?? "left",
          lineHeight: String(lineHeight),
          padding: `${(inset.y * unit).toFixed(2)}px ${(inset.x * unit).toFixed(2)}px`,
          // One line tall at least, as text-layout.ts assumes for the fill.
          minHeight: fixedHeight
            ? "0"
            : `${((textBox.fontSize * lineHeight + 2 * inset.y) * unit).toFixed(2)}px`,
          color: shownColor(textBox.color, night),
          width: `${100 / shrink}%`,
          transform: shrink < 1 ? `scale(${shrink})` : "",
        };
        input.setCssStyles({
          ...typeStyle,
          height: fixedHeight ? `${100 / shrink}%` : input.style.height,
        });
        // The shown text lies exactly over the textarea, the frame's full height.
        view.shown.setCssStyles({ ...typeStyle, height: `${100 / shrink}%` });
        view.styleKey = `${input.style.fontFamily}|${input.style.fontWeight}|${input.style.fontStyle}|${lineHeight}|${input.style.padding}`;
        if (!fixedHeight && this.needsMeasure(view, heightModeChanged, zooming)) measure.push(view);
      }
    }
    this.measureBoxes(measure);

    // Take stale views out of the map before touching them: blurring a
    // focused one runs the end-of-editing handlers, which may sync again.
    const stale: TextBoxView[] = [];
    for (const [key, view] of this.textBoxInputs) {
      if (expected.has(key)) continue;
      this.textBoxInputs.delete(key);
      stale.push(view);
    }
    for (const view of stale) {
      // Removing a focused element fires no blur in every engine; an undo
      // that takes away the box being edited must still end the edit.
      if (document.activeElement === view.input) view.input.blur();
      // A kept box that went (an undo took it): nothing is held any more.
      if (this.heldText === view) this.heldText = null;
      view.root.remove();
    }
    // The pill floats by its box: a moved, resized, restyled or removed box moves it.
    this.reportTextAnchor();
  }

  /**
   * Build a box's shown text from its typed text: plain runs as text, links
   * as their shown text in a span that opens them. A box with no links shows
   * its textarea alone (`has-links` is off).
   */
  private renderShownText(view: TextBoxView, text: string): void {
    if (view.shownText === text) return;
    view.shownText = text;
    view.shown.empty();
    let links = 0;
    for (const segment of textSegments(text)) {
      const target = segment.target;
      if (target === undefined) {
        view.shown.appendText(segment.text);
        continue;
      }
      links++;
      const link = view.shown.createSpan({
        cls: "goodobsidian-textbox-link",
        text: segment.text,
        attr: { "aria-label": target },
      });
      this.bindTextLink(link, target);
    }
    view.root.toggleClass("has-links", links > 0);
  }

  /**
   * A link in a text box opens on a tap: pointer events, as for every control
   * over the page (a Pencil tap synthesises no click). Taken before the box
   * or the page sees the press, so it neither starts editing nor draws.
   */
  private bindTextLink(el: HTMLElement, target: string): void {
    let pressed: number | null = null;
    el.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      event.preventDefault();
      pressed = event.pointerId;
    });
    el.addEventListener("pointerup", (event) => {
      event.stopPropagation();
      if (pressed !== event.pointerId) return;
      pressed = null;
      this.callbacks.onOpenLink?.(target);
    });
    el.addEventListener("pointercancel", () => {
      pressed = null;
    });
  }

  /**
   * Grow an auto-height box to fit its text. Measures only when something
   * changed; mid-zoom it scales the last measured height instead, since a
   * measure forces a layout and a pinch would force one per box per frame.
   */
  private autoSize(view: TextBoxView, force: boolean): void {
    if (this.needsMeasure(view, force, false)) this.measureBoxes([view]);
  }

  /**
   * Whether an auto-height box must be measured. Mid-zoom (`zooming`) it is
   * not: its last height is scaled instead, and it is measured once the zoom
   * ends (`textBoxesProvisional`).
   */
  private needsMeasure(view: TextBoxView, force: boolean, zooming: boolean): boolean {
    const { input, root } = view;
    const key = `${root.style.width}|${input.style.fontSize}|${view.shrink}|${view.styleKey}`;
    if (!force && view.measuredAt === key) return false;
    if (zooming && !force && view.pageH > 0 && view.pageHText === input.value) {
      const scale = this.unitScale;
      input.setCssStyles({ height: `${((view.pageH * scale) / view.shrink).toFixed(2)}px` });
      root.setCssStyles({ height: `${Math.ceil(view.pageH * scale)}px` });
      view.measuredAt = "";
      this.textBoxesProvisional = true;
      return false;
    }
    view.measuredAt = key;
    return true;
  }

  /**
   * Fit auto-height boxes to their text: every write, then every read, then
   * every write, so the browser lays out once for all of them, not once per box.
   */
  private measureBoxes(views: readonly TextBoxView[]): void {
    if (views.length === 0) return;
    const scale = this.unitScale;
    for (const view of views) view.input.setCssStyles({ height: "auto" });
    const heights = views.map((view) => view.input.scrollHeight);
    views.forEach((view, i) => {
      const h = heights[i];
      view.input.setCssStyles({ height: `${h}px` });
      // The transform does not affect layout, so the frame is sized explicitly.
      view.root.setCssStyles({ height: `${Math.ceil(h * view.shrink)}px` });
      view.pageH = (h * view.shrink) / scale;
      view.pageHText = view.input.value;
    });
  }

  /** Canvas used only to measure the text of boxes that fit their text. */
  private measureCtx: CanvasRenderingContext2D | null = null;

  /**
   * The width a fitted box needs for its text, sitting at `x` on a page
   * `pageWidth` wide: measured with the canvas the thumbnails paint with,
   * so both wrap alike. Measures only when the text, font or room changed.
   */
  private fittedWidth(
    view: TextBoxView,
    textBox: TextBoxElement,
    x: number,
    pageWidth: number,
  ): number {
    const font = canvasFont(textBox, textBox.fontSize);
    const room = pageWidth - x;
    const inset = textInset(textBox).x;
    const key = `${font}|${room}|${inset}|${textBox.text}`;
    if (view.fitKey === key) return view.fitW;
    this.measureCtx ??= createEl("canvas").getContext("2d");
    const ctx = this.measureCtx;
    // One wide character at least: room for the caret in an empty box.
    const min = Math.ceil(textBox.fontSize + 2 * inset);
    if (!ctx) return Math.max(min, textBox.w);
    ctx.font = font;
    view.fitKey = key;
    view.fitW = fitTextWidth(textBox.text, min, room, (text) => ctx.measureText(text).width, inset);
    return view.fitW;
  }

  private createTextBoxView(pageId: string, textBox: TextBoxElement, key: string): TextBoxView {
    const root = this.textBoxesEl.createDiv({
      cls: "goodobsidian-page-textbox",
      attr: { "data-textbox-key": key },
    });
    const input = root.createEl("textarea", {
      cls: "goodobsidian-page-textbox-input",
      attr: { "aria-label": "Page text box", rows: "1" },
    });
    const moveHandle = root.createDiv({
      cls: "goodobsidian-page-textbox-handle is-move",
      attr: { "aria-label": "Move text box" },
    });
    const resizeHandle = root.createDiv({
      cls: "goodobsidian-page-textbox-handle is-resize",
      attr: { "aria-label": "Resize text box" },
    });
    const shown = root.createDiv({ cls: "goodobsidian-page-textbox-view" });
    input.value = textBox.text;
    const view: TextBoxView = {
      root,
      input,
      shown,
      shownText: null,
      pageId,
      id: textBox.id,
      measuredAt: "",
      pageH: 0,
      pageHText: "",
      shrink: 1,
      fixed: textBox.h !== undefined,
      styleKey: "",
      fitKey: "",
      fitW: textBox.w,
    };

    // Text editing must never start an ink gesture on the scroll overlay
    // beneath it. Snapshot the scroll position before the browser focuses the
    // box, so a jump it makes to "reveal" the caret can be undone.
    input.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      if (document.activeElement !== input) this.pendingFocusHold = this.scrollSnapshot();
    });
    input.addEventListener("focus", () => {
      // Typing again in a kept box, or in another one: nothing is held now,
      // and nothing parked. A box held with the lasso is typed in with the
      // lasso still in hand (GoodNotes); the tool to come back to stays for
      // when it is let go.
      this.parkedText = null;
      if (this.heldText === view) {
        this.heldText = null;
        window.clearTimeout(this.heldTapTimer);
        this.heldTapTimer = 0;
        root.removeClass("is-held", "is-tappable");
      } else this.releaseHeldText();
      this.holdTextEditingClass();
      const snapshot = this.pendingFocusHold;
      this.pendingFocusHold = null;
      if (snapshot) this.holdScroll(input, snapshot);
      const live = this.liveTextBox(view.pageId, view.id);
      if (live) this.callbacks.onTextEditing?.(textStyleOf(live));
      this.reportTextAnchor();
      this.watchTypingKeyboard(true);
      // A keyboard already up (typing went on from another box) covers it now.
      if (!snapshot) this.keepTypingBoxVisible();
    });
    input.addEventListener("blur", (event) => {
      if (!this.renderer) return;
      // A handle drag finishes the edit itself when it lets go.
      if (root.hasClass("is-dragging")) return;
      if (onTextBox(event.relatedTarget)) {
        // Straight into another box: still editing, still the Text tool.
        this.removeIfEmpty(view);
        return;
      }
      this.endTextEditing(view);
    });
    // Enter on a list line continues the list; on an empty item, ends it.
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      if (input.selectionStart !== input.selectionEnd) return;
      const edit = continueList(input.value, input.selectionStart);
      if (!edit) return;
      event.preventDefault();
      this.setTextInput(input, edit);
    });
    input.addEventListener("input", () => {
      const live = this.liveTextBox(pageId, textBox.id);
      if (!live) return;
      live.text = input.value;
      this.renderShownText(view, live.text);
      // A fitted box widens with its text: a full sync sets the width first.
      // The height is measured after it either way: a new line adds height
      // without changing the width, which the sync's own measure keys on.
      if (live.fit) this.syncTextBoxes();
      if (live.h === undefined) this.autoSize(view, true);
      // A new line can reach under the keyboard.
      this.keepTypingBoxVisible();
      this.reportTextAnchor();
      this.changed();
    });
    moveHandle.addEventListener("pointerdown", (event) =>
      this.startFrameDrag(view, key, "move", event),
    );
    resizeHandle.addEventListener("pointerdown", (event) =>
      this.startFrameDrag(view, key, "resize", event),
    );

    this.textBoxInputs.set(key, view);
    return view;
  }

  /**
   * A box left with no text is litter: invisible (it has no fill) but still in
   * the note. Remove it. If creating it is still the latest undo step, take
   * that step back instead, so Undo never resurrects a blank box.
   */
  private removeIfEmpty(view: TextBoxView): void {
    const live = this.liveTextBox(view.pageId, view.id);
    if (!live || live.text.trim() !== "") return;
    const add = this.lastTextBoxAdd;
    const key = `${view.pageId}:${view.id}`;
    // The box's creation and every style or frame change made to it since
    // go together, or nothing is taken back and a removal is recorded.
    const withdrawn =
      add?.key === key && this.history.withdrawTail(this.doc, [add.command, ...add.followers]);
    if (add?.key === key) this.lastTextBoxAdd = null;
    if (!withdrawn) {
      this.history.push(this.doc, new RemoveTextBoxFromPage(view.pageId, view.id));
    }
    this.syncTextBoxes();
    this.changed();
  }

  /** Record a command on a text box; one on the newest box is withdrawn with it if left empty. */
  private pushTextCommand(key: string, command: Command): void {
    this.history.push(this.doc, command);
    if (this.lastTextBoxAdd?.key === key) this.lastTextBoxAdd.followers.push(command);
  }

  private liveTextBox(pageId: string, id: string): TextBoxElement | undefined {
    const page = this.doc.pages.find((candidate) => candidate.id === pageId);
    return page?.textBoxes.find((candidate) => candidate.id === id);
  }

  /**
   * Move or resize a text box by one of its handles. The frame is previewed
   * live and committed as one undoable command when the pointer lifts.
   */
  private startFrameDrag(
    view: TextBoxView,
    key: string,
    mode: "move" | "resize",
    event: PointerEvent,
  ): void {
    const live = this.liveTextBox(view.pageId, view.id);
    const pageBox = this.pageLayout.boxes.find((b) => b.id === view.pageId);
    if (!live || !pageBox || this.callbacks.isLocked?.()) return;
    event.stopPropagation();
    // Keeps the focus where it is: a resize goes on editing, keyboard up.
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    // Before any blur below, so the blur handler knows a drag is under way.
    view.root.addClass("is-dragging");
    this.textFrameDrag = key;
    if (mode === "move" && document.activeElement === view.input) {
      // Moving a box ends editing, as in GoodNotes, and puts the keyboard
      // away: on the iPad it covered half the page the box was moving over.
      // The blur leaves the body's editing class in place (see
      // `releaseTextEditingClass`), so the surface is not resized under the
      // finger while the keyboard slides down; and the blur handler sees
      // `is-dragging` and removes nothing, since the box is mid-move.
      view.input.blur();
    }

    const scale = this.unitScale;
    const startX = event.clientX;
    const startY = event.clientY;
    // An auto-height box being resized takes its current rendered height.
    const startH = live.h ?? view.root.getBoundingClientRect().height / scale;
    const start: TextBoxFrame = { x: live.x, y: live.y, w: live.w, h: live.h };
    // A move keeps a fitted box fitted; a resize gives it the size dragged to.
    if (live.fit && mode === "move") start.fit = true;

    const onMove = (e: PointerEvent): void => {
      if (e.pointerId !== event.pointerId) return;
      const dx = (e.clientX - startX) / scale;
      const dy = (e.clientY - startY) / scale;
      let frame: TextBoxFrame;
      if (mode === "move") {
        const x = clamp(start.x + dx, 0, Math.max(0, pageBox.width - start.w));
        const y = clamp(start.y + dy, 0, Math.max(0, pageBox.height - (start.h ?? startH)));
        frame = { ...start, x, y };
      } else {
        const w = clamp(start.w + dx, TEXT_MIN_W, Math.max(TEXT_MIN_W, pageBox.width - start.x));
        const h = clamp(startH + dy, TEXT_MIN_H, Math.max(TEXT_MIN_H, pageBox.height - start.y));
        frame = { ...start, w, h };
      }
      this.frameDraft = { key, frame };
      this.syncTextBoxes();
    };
    const onEnd = (e: PointerEvent): void => {
      if (e.pointerId !== event.pointerId) return;
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onEnd);
      handle.removeEventListener("pointercancel", onEnd);
      if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
      view.root.removeClass("is-dragging");
      this.textFrameDrag = null;
      const draft = this.frameDraft;
      this.frameDraft = null;
      if (draft && draft.key === key) {
        const f = draft.frame;
        const frame: TextBoxFrame = {
          x: f.x,
          y: f.y,
          w: f.w,
          ...(f.h !== undefined ? { h: f.h } : {}),
          ...(f.fit ? { fit: true as const } : {}),
        };
        this.pushTextCommand(key, new SetTextBoxFrame(view.pageId, view.id, frame));
        this.changed();
      }
      this.syncTextBoxes();
      if (mode === "resize") {
        this.focusTextBox(view.input);
        return;
      }
      // A move finished the edit when it began; wrap it up now the box has
      // landed (and is no longer mid-drag, so an empty one may go). The box
      // is not refocused: that would bring the keyboard straight back.
      if (document.activeElement !== view.input) this.endTextEditing(view);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onEnd);
    handle.addEventListener("pointercancel", onEnd);
  }

  // --- Keeping the page still while a text box takes focus -----------------

  /** Scroll position captured just before a text box takes focus. */
  private pendingFocusHold: ScrollSnapshot | null = null;
  private focusHoldFrame = 0;

  private scrollSnapshot(): ScrollSnapshot {
    const ancestors: Array<{ el: Element; top: number; left: number }> = [];
    for (let el = this.surfaceEl.parentElement; el; el = el.parentElement) {
      ancestors.push({ el, top: el.scrollTop, left: el.scrollLeft });
    }
    return {
      top: this.scroller.position.y,
      left: this.scroller.position.x,
      windowX: window.scrollX,
      windowY: window.scrollY,
      ancestors,
    };
  }

  /** Focus a text box without letting the browser scroll anything to reveal it. */
  private focusTextBox(input: HTMLTextAreaElement): void {
    const snapshot = this.scrollSnapshot();
    input.focus({ preventScroll: true });
    this.holdScroll(input, snapshot);
  }

  /**
   * iPadOS scrolls every scrollable ancestor to reveal a focused field — and
   * again as the keyboard slides up — which dragged the whole page down. For a
   * short window the surface owns scrolling: it puts everything back where the
   * user left it, then scrolls the page only as far as needed to keep the box
   * above the keyboard.
   */
  private holdScroll(input: HTMLTextAreaElement, snapshot: ScrollSnapshot): void {
    if (this.focusHoldFrame) window.cancelAnimationFrame(this.focusHoldFrame);
    const until = now() + TEXT_FOCUS_HOLD_MS;
    let top = snapshot.top;
    const step = (): void => {
      this.focusHoldFrame = 0;
      if (document.activeElement !== input || !this.renderer) return;
      for (const a of snapshot.ancestors) {
        if (a.el.scrollTop !== a.top) a.el.scrollTop = a.top;
        if (a.el.scrollLeft !== a.left) a.el.scrollLeft = a.left;
      }
      if (window.scrollX !== snapshot.windowX || window.scrollY !== snapshot.windowY)
        window.scrollTo(snapshot.windowX, snapshot.windowY);
      const position = this.scroller.position;
      if (position.x !== snapshot.left || position.y !== top) {
        this.scroller.setPosition(snapshot.left, top);
        this.syncViewport();
        this.requestFrame();
      }

      // Keep the box above the on-screen keyboard, with room for the pill.
      if (this.keepTypingBoxVisible()) top = this.scroller.position.y;
      if (now() < until) this.focusHoldFrame = window.requestAnimationFrame(step);
    };
    step();
  }

  /**
   * Scroll the page so the box being typed in sits above the on-screen
   * keyboard, with room above it for the text pill that floats over it
   * (`text-reveal.ts`), as GoodNotes does. Obsidian's iOS app does not shrink
   * the visual viewport for the keyboard; it publishes the keyboard's height
   * as a CSS variable (`keyboardHeight`). Returns whether it scrolled.
   */
  private keepTypingBoxVisible(): boolean {
    const view = this.editingTextView();
    if (!view || !this.renderer) return false;
    const surface = this.surfaceEl.getBoundingClientRect();
    const vv = window.visualViewport;
    // A floating or minimised keyboard reports a small height, or none,
    // but still sits low on the screen: the box rises above it either way.
    const keyboard = Math.max(keyboardHeight(), window.innerHeight * TYPING_KEYBOARD_SHARE);
    const bottom =
      Math.min(
        surface.bottom,
        vv ? vv.offsetTop + vv.height : window.innerHeight,
        window.innerHeight - keyboard,
      ) - TEXT_REVEAL_MARGIN_PX;
    const box = view.root.getBoundingClientRect();
    const { input } = view;
    const delta = revealDelta(
      box,
      { top: surface.top + TEXT_PILL_ROOM_PX, bottom },
      input.selectionEnd >= input.value.length,
    );
    if (Math.abs(delta) < 1) return false;
    // The keyboard's height is known now: let the scroll range reach past it.
    this.ensurePaperSize();
    const position = this.scroller.position;
    this.scroller.setPosition(position.x, position.y + delta);
    this.syncViewport();
    this.requestFrame();
    return true;
  }

  /**
   * While a box is typed in, keep it clear of the keyboard as the keyboard
   * comes, changes height (the predictive bar, a hardware keyboard's strip)
   * or goes: nothing announces it, so look four times a second.
   */
  private watchTypingKeyboard(on: boolean): void {
    if (!on) {
      if (this.typingKeyboardWatch) window.clearInterval(this.typingKeyboardWatch);
      this.typingKeyboardWatch = 0;
      return;
    }
    if (this.typingKeyboardWatch) return;
    this.typingKeyboardSeen = keyboardHeight();
    this.typingKeyboardWatch = window.setInterval(() => {
      const height = keyboardHeight();
      if (height === this.typingKeyboardSeen) return;
      this.typingKeyboardSeen = height;
      this.keepTypingBoxVisible();
    }, TYPING_KEYBOARD_WATCH_MS);
  }

  private renderBackdrop(): void {
    this.renderer?.renderBackdrops(this.doc);
  }

  /**
   * Repaint the dry layer now. Synchronous and complete by default; a frame
   * in motion passes a budget and accepts a preview standing in for a tile.
   */
  private renderDry(budgetMs = Infinity): boolean {
    if (!this.renderer) return true;
    this.flushEraseDirty();
    // `eraseIds` / `erasePieces` are empty except during a live erase gesture.
    // The lasso selection's frame is DOM (it takes presses), not canvas.
    return this.renderer.renderDocument(
      this.doc,
      this.inkPressure,
      this.eraseIds,
      null,
      this.erasePieces,
      budgetMs,
      this.viewMoving,
    );
  }

  /** Re-rasterise the tiles under the strokes the erase gesture changed since the last paint. */
  private flushEraseDirty(): void {
    const box = this.activePage;
    if (this.eraseDirty.size === 0 || !box) {
      this.eraseDirty.clear();
      return;
    }
    let dirty: Bounds | null = null;
    for (const id of this.eraseDirty) {
      const stroke = this.strokeIndex.get(id);
      const bounds = stroke ? strokeBounds(stroke) : null;
      if (bounds) dirty = unionBounds(dirty, bounds);
    }
    this.eraseDirty.clear();
    if (!dirty) return;
    this.renderer?.invalidateRegion(box.index, dirty);
    const preview = this.erasePreview;
    this.erasePreview = {
      pageIndex: box.index,
      bounds:
        preview && preview.pageIndex === box.index
          ? (unionBounds(preview.bounds, dirty) ?? dirty)
          : dirty,
    };
  }

  /**
   * The backdrop painter. Injected by the host, because resolving a PDF backdrop
   * needs the vault and Obsidian's `loadPdfJs()` — neither of which the surface
   * should know about. Until one is set, pages paint as bare paper.
   */
  setBackdropPainter(painter: BackdropPainter | null): void {
    this.renderer?.setPainter(painter);
    this.requestFrame();
  }

  /** `devicePixelRatio * viewScale` — what a PDF backdrop should rasterise at. */
  get deviceScale(): number {
    return this.renderer?.deviceScale ?? 1;
  }

  /**
   * The painter placed images are drawn with. Injected by the host for the
   * same reason as the backdrop painter: decoding a picture needs the vault.
   * Until one is set, images are not drawn.
   */
  setImagePainter(painter: ImagePainter | null): void {
    this.imagesShown = painter !== null;
    this.renderer?.setImagePainter(painter);
    this.requestFrame();
  }

  /**
   * A picture at `path` finished decoding, or turned out missing: re-rasterise
   * exactly the tiles that show it, on every page that places it.
   */
  imageReady(path: string): void {
    const renderer = this.renderer;
    if (!renderer) return;
    let shown = false;
    this.doc.pages.forEach((page, index) => {
      for (const image of page.images) {
        if (image.path !== path) continue;
        renderer.invalidateRegion(index, imageBounds(image));
        shown = true;
      }
    });
    if (shown) this.requestFrame();
  }

  /**
   * Page `pdfPage` of the PDF at `path` finished rasterising, or turned out
   * missing: invalidate its region, or the whole page for a preview.
   * Other pages and regions keep their cached ink tiles.
   */
  /** PDF rendering changed how it works (the worker came up): paint once to ask again. */
  refreshPdfDetail(): void {
    this.requestFrame();
  }

  pdfPageReady(path: string, pdfPage: number, area?: PdfRenderArea): void {
    const renderer = this.renderer;
    if (!renderer) return;
    let shown = false;
    this.doc.pages.forEach((page, index) => {
      const backdrop = page.backdrop;
      if (backdrop.kind !== "pdf" || backdrop.path !== path || backdrop.page !== pdfPage) return;
      if (
        area &&
        (area.geometry.width !== page.geometry.width ||
          area.geometry.height !== page.geometry.height)
      )
        return;
      if (area?.region) renderer.invalidateRegion(index, area.region);
      else renderer.invalidatePage(page.id);
      shown = true;
    });
    if (shown) this.requestFrame();
  }

  /** The part of page `index` that is on screen, in page space; `null` when none is. */
  visibleRegion(index: number): Bounds | null {
    const box = this.pageLayout.boxes[index];
    if (!box || this.cssW === 0 || this.cssH === 0) return null;
    const scale = this.unitScale;
    const left = Math.max(box.x, -this.offsetX / scale);
    const right = Math.min(box.x + box.width, (this.cssW - this.offsetX) / scale);
    const top = Math.max(box.y, this.viewport.scrollY);
    const bottom = Math.min(box.y + box.height, this.viewport.scrollY + this.cssH / scale);
    if (!(right > left) || !(bottom > top)) return null;
    return { minX: left - box.x, minY: top - box.y, maxX: right - box.x, maxY: bottom - box.y };
  }

  /** The Shape tool draws in its own colour (black until picked); every other tool in the pen's. */
  private strokeColor(): string {
    if (this.toolState.tool === "shape") return this.toolState.shapeColor ?? DEFAULT_SHAPE_COLOR;
    return this.toolState.color;
  }

  /** Stroke width actually laid down (`strokeWidthFor`, which the width popover previews). */
  private strokeSize(): number {
    return strokeWidthFor(this.toolState);
  }

  /**
   * How many screen px one page px of each size is right now, for the size
   * previews in the width and eraser popovers. Pen width belongs to the page
   * and grows with the zoom; the eraser is a screen size, set at fit-to-page
   * zoom (`atFitZoom`).
   */
  sizePreviewScales(): { pen: number; eraser: number } {
    return { pen: this.unitScale, eraser: this.unitScale / (this.userZoom || 1) };
  }

  /**
   * How the stroke being drawn looks, and so what it is stored as: only the
   * highlighter lays down highlighter ink; every other tool that draws
   * (the pen, the Shape tool) lays down pen ink.
   */
  private currentStyle(): StrokeStyle {
    const tool: Tool = this.toolState.tool === "highlighter" ? "highlighter" : "pen";
    const { pressureEnabled } = this.toolState;
    return {
      color: this.strokeColor(),
      size: this.strokeSize(),
      tool,
      usePressure: pressureEnabled,
    };
  }

  /**
   * A shape the Shape tool made, given the tool's fill, line, corners and
   * arrowheads (`styleNewShape`). A shape the pen snapped keeps plain ink.
   */
  private styleShape(stroke: Stroke): Stroke {
    if (this.toolState.tool === "shape") {
      styleNewShape(stroke, readShapeToolStyle(this.toolState.shapeStyle));
    }
    return stroke;
  }

  /** Draw a shape being placed or held on the wet layer, styled as it will be committed. */
  private renderWetShape(pageIndex: number, kind: ShapeKind, pts: number[]): void {
    const style = this.currentStyle();
    const shape = this.styleShape({
      id: "",
      color: style.color,
      size: style.size,
      tool: style.tool,
      pts,
      shape: kind,
    });
    this.renderer?.renderWet(pageIndex, shape.pts, {
      ...style,
      shape: true,
      decor: decorOf(shape),
    });
  }

  /** Settings for a new stroke's sampling, from the pen as it is now. */
  private builderOpts(): StrokeBuilderOptions {
    // A pen whose positions arrive as whole screen px (WebKit before iPadOS
    // 26.2) is smoothed; one that reports fractions is kept exact.
    const rounded = this.pointerInput?.strokeRounded ?? false;
    const smoothing: Smoothing = rounded ? "centred" : "off";
    return {
      // On screen, not on the page: at 5x zoom 1.4 page px is 7 screen px,
      // and small handwriting lost most of its samples.
      minDistance: this.atFitZoom(MIN_SAMPLE_DISTANCE),
      pressureEnabled: this.toolState.pressureEnabled,
      // Until a stroke's first reading arrives it is drawn at the pen's
      // pressure on the last stroke, not at 0.5: a light hand (~0.25) saw
      // every stroke start as a blob for a frame.
      fallbackPressure: this.toolState.pressureEnabled
        ? (this.penPressure ?? FALLBACK_PRESSURE)
        : FALLBACK_PRESSURE,
      // The Brush pen answers pressure far more strongly than the Fountain pen.
      ...(this.toolState.pressureEnabled && this.toolState.penType === "brush"
        ? { pressureCurve: BRUSH_PRESSURE }
        : {}),
      // One sample a frame (iPadOS before 18.2): fill the stroke in between
      // them. Where every sample arrives, the stroke is stored as it is.
      densify: !this.coalescedInput,
      smoothing,
      // A practice file is training data: keep the pen's samples as they came.
      record: this.practice !== null,
    };
  }

  // --- Pen and finger input ------------------------------------------------------

  /** Client px -> layout space. Folds in scroll and horizontal centering. */
  private toLayout(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.surfaceEl.getBoundingClientRect();
    const scale = this.unitScale;
    return {
      x: (clientX - rect.left - this.offsetX) / scale,
      y: (clientY - rect.top) / scale + this.viewport.scrollY,
    };
  }

  /** Layout-space sample -> page-local sample, for the gesture's page. */
  private toPage(box: PageBox, sample: { x: number; y: number }): { x: number; y: number } {
    return { x: sample.x - box.x, y: sample.y - box.y };
  }

  private readonly pointerCallbacks: PointerControllerCallbacks = {
    onStart: (sample, press) => {
      this.callbacks.onPen?.(true);
      this.pressTool = this.pressOverrideOf(press);
      if (this.pressTool === "zoom") {
        this.startZoomDrag(sample);
        return;
      }
      this.markDrawing(true);
      this.penDown(sample);
    },
    onMove: (coalesced) => {
      this.penAt = coalesced[coalesced.length - 1] ?? this.penAt;
      if (this.zoomDrag) {
        this.moveZoomDrag(this.penAt);
        return;
      }
      const box = this.activePage;
      if (box) this.gestureOf(this.gestureTool()).move(box, coalesced);
    },
    onEnd: (sample) => {
      this.callbacks.onPen?.(false);
      this.markDrawing(false);
      if (this.endZoomDrag()) return;
      if (this.finishTextDismiss()) return;
      const box = this.activePage;
      this.finishToolGesture(box, sample);
    },
    onCancel: () => {
      this.callbacks.onPen?.(false);
      this.markDrawing(false);
      if (this.endZoomDrag()) return;
      if (this.finishTextDismiss()) return;
      this.finishToolGesture(this.activePage, null);
    },
    // Fingers. Native touch-scroll is off (touch-action: none), so the
    // scroller gets the raw gesture and the frame loop moves the page.
    onPanStart: (x, y, t) => {
      // A resting palm must not scroll the page out from under an image or a
      // selection being dragged; without a dragStart the moves and the end
      // are no-ops.
      if (this.imageDrag || this.groupDrag) return;
      // Only the first finger can be a tap; a re-anchor keeps what it had. A
      // touch that stops a fling is only that, as on iOS. A finger held
      // still is a tap-and-hold, with any tool, as the lasso's Pencil is.
      // A pan with space held is never a tap (FineNotes#7).
      if (this.handHeld || this.penPanning) this.scrollEl.addClass("is-hand-dragging");
      if (!this.touchPanning) {
        this.fingerTap = this.scroller.isAnimating || this.handHeld ? null : { x, y, t };
        if (this.fingerTap && !this.lasso) {
          this.fingerHold.begin(x, y, t);
          this.startPress(() => this.fingerHeld(), FINGER_HOLD_MS);
        }
      }
      if (!this.touchPanning) {
        this.swipeFromPage = this.pageIndex;
        const at = this.scroller.position;
        this.palmUndo = { t: now(), x: at.x, y: at.y, zoom: this.userZoom, cx: x, cy: y };
      }
      this.touchPanning = true;
      window.clearTimeout(this.wheelSnapTimer);
      this.scroller.dragStart(x, y, t);
      this.requestFrame();
    },
    onPanMove: (x, y, t) => {
      const tap = this.fingerTap;
      if (tap && Math.hypot(x - tap.x, y - tap.y) > TAP_SLOP_PX) {
        this.fingerTap = null;
        this.stopPress();
      }
      if (this.fingerHold.active && !this.fingerHold.move(x, y)) this.stopPress();
      this.scroller.dragMove(x, y, t);
      this.requestFrame();
    },
    onPanEnd: (t) => {
      const tap = this.fingerTap;
      this.fingerTap = null;
      this.stopPress();
      this.fingerHold.end();
      // The finger that opened the press menu lifted: now it takes presses.
      if (this.pressMenu?.provisional) {
        this.pressMenu.provisional = false;
        this.syncActionBar();
      }
      // Read before the release springs it back: past the end far enough,
      // letting go adds a page.
      // A zoomed-in row is held to its page: its edge is no place to add one.
      const pulled =
        this.pullAddEnabled &&
        (this.direction !== "horizontal" || this.turnsPages) &&
        pullAddProgress(this.pullOverscroll()) >= 1;
      this.touchPanning = false;
      this.penPanning = false;
      this.palmUndo = null;
      this.scrollEl.removeClass("is-hand-dragging");
      this.pullAdd.hide();
      this.scroller.dragEnd(t);
      if (pulled) {
        this.callbacks.onPullAddPage?.();
      } else if (this.turnsPages) {
        this.snapToPage(this.scroller.velocity.x, this.swipeFromPage);
      }
      this.requestFrame();
      if (tap && t - tap.t <= FINGER_TAP_MS) this.onFingerTap(tap.x, tap.y);
    },
    // Only a landing pen voids a finger gesture.
    onPanCancel: () => {
      this.fingerTap = null;
      this.stopPress();
      this.fingerHold.end();
      this.touchPanning = false;
      this.penPanning = false;
      this.pullAdd.hide();
      this.pinch = null;
      this.scroller.cancel();
      this.undoPalm();
      this.requestFrame();
    },
    onPinchStart: (centerX, centerY) => {
      this.fingerTap = null;
      this.stopPress();
      this.fingerHold.end();
      if (this.imageDrag || this.groupDrag) return;
      this.zoomAnim = null;
      this.pinch = { raw: this.userZoom, centerX, centerY };
    },
    onPinch: (info) => {
      const pinch = this.pinch;
      if (!pinch) return;
      pinch.raw *= info.scaleFactor;
      pinch.centerX = info.centerX;
      pinch.centerY = info.centerY;
      // Past the limits the zoom stretches a little; the release springs it back.
      this.applyZoom(softZoom(pinch.raw, this.minZoom, MAX_SCALE), info.centerX, info.centerY);
    },
    onPinchEnd: () => {
      const pinch = this.pinch;
      this.pinch = null;
      if (!pinch) return;
      this.syncInkCursor();
      const target = this.clampZoom(this.userZoom);
      // Pinched back out to where a row turns pages: settle on the page being
      // read, centred, once any zoom spring is done.
      this.snapRowAfterZoom =
        this.direction === "horizontal" && rowTurnsPages(target, this.minZoom);
      if (target !== this.userZoom) {
        this.zoomAnim = {
          from: this.userZoom,
          to: target,
          t0: now(),
          cx: pinch.centerX,
          cy: pinch.centerY,
        };
      } else {
        this.settleRowAfterZoom();
      }
      this.requestFrame();
    },
    onFingerDoubleTap: (fingers) => this.fingerDoubleTap(fingers),
    onFingerContact: (width, height) => {
      if (this.fingerHold.active) this.fingerHold.noteContact(width, height);
    },
    // WebKit's own long press may end a finger held still before the press
    // timer is due: that is the hold it interrupted (ledger).
    onFingerCancel: (t) => {
      if (!this.pressTimer || !this.fingerHold.cancelIsHold(t)) return;
      this.stopPress();
      this.fingerHeld();
    },
    // With the debug overlay on, every touch of two or more fingers says what
    // it counted as, so a gesture that does nothing on a device can be read.
    onFingerTapReport: (r) => {
      if (!this.debug) return;
      const cx = r.cancelled ? " cx" : "";
      this.hud.mark(`tap${r.fingers}:${r.outcome}${cx} ${Math.round(r.ms)}ms`);
      this.flashReadout(
        `${r.fingers} fingers · ${Math.round(r.ms)} ms · ${r.outcome}${r.cancelled ? " (cancelled)" : ""}`,
      );
    },
    onDebug: (record) => this.onPointerEvent(record),
  };

  /**
   * Two fingers double-tapped: undo; three: redo (GoodNotes' gestures). The
   * result shows briefly in the readout pill, as a zoom's percentage does.
   */
  private fingerDoubleTap(fingers: number): void {
    if (this.callbacks.fingerTapUndo?.() === false) return;
    if (this.callbacks.isLocked?.() === true) return;
    const redo = fingers >= 3;
    const can = redo ? this.history.canRedo() : this.history.canUndo();
    if (can) {
      if (redo) this.redo();
      else this.undo();
    }
    this.flashReadout(
      can ? (redo ? "Redo" : "Undo") : redo ? "Nothing to redo" : "Nothing to undo",
    );
  }

  /** Show a word in the readout pill, faded on the zoom readout's clock. */
  private flashReadout(text: string): void {
    this.zoomReadoutEl.setText(text);
    this.zoomReadoutEl.removeClass("is-idle");
    this.chromeUntil.zoom = now() + READOUT_WORD_HOLD_MS;
    if (!this.chromeTimer)
      this.chromeTimer = window.setTimeout(this.fadeChrome, READOUT_WORD_HOLD_MS);
  }

  /**
   * A pen landed on a finger gesture: the touch was most likely the writing
   * hand coming down first, so the page goes back to where it was when the
   * touch landed, zoom and all (`undoesPalm`).
   */
  private undoPalm(): void {
    const undo = this.palmUndo;
    this.palmUndo = null;
    if (!undo) return;
    const at = this.scroller.position;
    const moved = Math.hypot(at.x - undo.x, at.y - undo.y);
    const zoomed = this.userZoom !== undo.zoom;
    if ((!zoomed && moved < 0.5) || !undoesPalm(now() - undo.t, moved)) return;
    this.zoomAnim = null;
    if (zoomed) this.applyZoom(undo.zoom, undo.cx, undo.cy);
    this.scroller.setPosition(undo.x, undo.y);
    this.syncViewport();
    this.diagSums.palmUndo++;
    if (this.debug) this.hud.mark("palm:undo");
  }

  /**
   * The pen touched the page. What every tool has in common happens here —
   * the gesture's timestamp, letting go of what was selected or kept,
   * finding the page — and then the tool in use takes the gesture over.
   */
  private penDown(sample: PointerSample): void {
    this.penAt = sample;
    this.settlePendingReturn(sample);
    if (this.callbacks.isLocked?.()) return;
    if (this.dismissUsedSelection()) return;
    // Whatever this gesture commits is timestamped with its pen-down.
    this.penDownAt = this.clock();
    // A press beside a picture being cropped finishes the crop, keeping it.
    if (this.cropping) this.endCrop(true);
    // The selected image's frame keeps its own presses, so one that reaches
    // the page landed beside it: let go of the image, as GoodNotes does —
    // and of a lasso selection, whose frame does the same.
    this.deselectImage();
    this.clearSelection();
    if (this.heldText) {
      // The second tap beside a kept text box only lets go of it (on lift).
      if (this.gestureTool() === "text") {
        this.textRelease = true;
        return;
      }
      this.releaseHeldText();
    }
    // A gesture belongs to exactly one page. Starting in the gutter between
    // two pages does nothing, which is what GoodNotes does too.
    const box = boxAtPoint(this.pageLayout, sample.x, sample.y);
    this.activePage = box;
    if (!box) return;
    const local = this.toPage(box, sample);

    if (this.editingTextView()) {
      if (this.gestureTool() === "text") {
        // A tap beside the box being edited finishes it, as in GoodNotes;
        // the next tap makes a new box. Finished on lift, like any tap.
        this.textDismiss = true;
        return;
      }
      // Writing on the page finishes typing. (The pen's pointerdown is
      // cancelled, so the box would otherwise keep focus and the keyboard.)
      this.blurTextBox();
    }
    this.gestureOf(this.gestureTool()).down(box, local, sample);
  }

  /** Complete the tool before switching; cancelled erasing is rolled back. */
  private finishToolGesture(box: PageBox | null, sample: PointerSample | null): void {
    const tool = this.gestureTool();
    // A tool a key or a stylus button lent is done with; the tool in hand was not used.
    const lent = Boolean(this.pressTool);
    this.pressTool = null;
    const gesture = this.gestureOf(tool);
    if (sample) {
      if (!box) return;
      gesture.up(box, sample);
    } else {
      gesture.cancel(box);
      // WebKit can cancel an ordinary lift; shapes keep their committed ink.
      if (!box || tool !== "shape") return;
    }
    if (!lent) this.deferToolUse(sample ?? this.penAt);
  }

  /**
   * The tool the press under way uses: the one in hand, or the eraser or
   * lasso a key or a stylus button lent it.
   */
  private gestureTool(): ActiveTool {
    const lent = this.pressTool;
    if (lent === "eraser" || lent === "select") return lent;
    return this.toolState.tool;
  }

  /**
   * Where a pen or mouse press goes before it is a stroke: beside the pages
   * or with a barrel set to pan it moves the page as a finger does, with a
   * fling (rnote); a barrel set to do nothing, pressed while hovering, is
   * no press at all. Never while text is being typed: a press there is the
   * text box's, as it always was.
   */
  private pressRoute(event: PointerEvent): PressRoute {
    if (stylusButtonDown(event)) this.stylusMenuUntil = now() + STYLUS_MENU_MS;
    if (this.editingTextView() || this.heldText) return "draw";
    const at = this.toLayout(event.clientX, event.clientY);
    const onPage = boxAtPoint(this.pageLayout, at.x, at.y) !== null;
    const route = pressOverride(event, { mac: macKeys(), barrel: this.barrel(), onPage });
    if (route === "ignore") return "ignore";
    if (route !== "pan") return "draw";
    this.penPanning = true;
    return "pan";
  }

  /** The tool a stroke's keys and buttons lend it, or null for the tool in hand. */
  private pressOverrideOf(press: PressInput): PressOverride | null {
    // Typing keeps its keys: Shift is a capital there, not an eraser.
    if (this.editingTextView()) return null;
    const lent = pressOverride(press, { mac: macKeys(), barrel: this.barrel(), onPage: true });
    // A practice file has the pen and the eraser only.
    if (this.practice && lent === "select") return null;
    return lent === "eraser" || lent === "select" || lent === "zoom" ? lent : null;
  }

  private barrel(): BarrelAction {
    return barrelActionOf(this.callbacks.barrelAction?.());
  }

  /** Layout space -> client px, at the view as it is now: the inverse of {@link toLayout}. */
  private toClient(p: Pt): Pt {
    const rect = this.surfaceEl.getBoundingClientRect();
    const scale = this.unitScale;
    return {
      x: rect.left + this.offsetX + p.x * scale,
      y: rect.top + (p.y - this.viewport.scrollY) * scale,
    };
  }

  /** Alt held as the pen came down: drawing up zooms in, down out, about that point. */
  private startZoomDrag(sample: Pt): void {
    const at = this.toClient(sample);
    this.zoomAnim = null;
    this.zoomDrag = { from: this.userZoom, x: at.x, y: at.y };
  }

  private moveZoomDrag(sample: Pt): void {
    const drag = this.zoomDrag;
    if (!drag) return;
    // The sample was mapped with the view as it is now, so this is where the pen is.
    const at = this.toClient(sample);
    const zoom = dragZoom(drag.from, at.y - drag.y, this.minZoom, MAX_SCALE);
    if (zoom !== this.userZoom) this.applyZoom(zoom, drag.x, drag.y);
  }

  /** The Alt-drag ended; true if there was one. A row zoomed back out settles on its page. */
  private endZoomDrag(): boolean {
    if (!this.zoomDrag) return false;
    this.zoomDrag = null;
    this.pressTool = null;
    this.snapRowAfterZoom =
      this.direction === "horizontal" && rowTurnsPages(this.userZoom, this.minZoom);
    this.settleRowAfterZoom();
    this.requestFrame();
    return true;
  }

  /** How the tool in use handles the pen (see {@link PenGesture}). */
  private gestureOf(tool: ActiveTool): PenGesture {
    switch (tool) {
      case "eraser":
        return this.eraserGesture;
      case "select":
        return this.lassoGesture;
      case "text":
        return this.textGesture;
      case "laser":
        return this.laserGesture;
      default:
        return this.inkGesture;
    }
  }

  /** The laser pointer: a fading trail behind the pen, never part of the notebook. */
  private readonly laserGesture: PenGesture = {
    down: (_box, _at, sample) => {
      this.laserTrail.start({ x: sample.x, y: sample.y, t: now() });
      this.requestLaser();
    },
    move: (_box, samples) => {
      const t = now();
      for (const sample of samples) this.laserTrail.add({ x: sample.x, y: sample.y, t });
      this.requestLaser();
    },
    up: () => this.endLaser(),
    cancel: () => this.endLaser(),
  };

  private endLaser(): void {
    this.laserTrail.end(now());
    this.activePage = null;
    this.requestLaser();
  }

  private requestLaser(): void {
    if (this.laserFrame) return;
    this.laserFrame = window.requestAnimationFrame(() => {
      this.laserFrame = 0;
      this.paintLaser();
    });
  }

  /**
   * Draw the laser's trail where its points are on screen now (it stays on
   * what it pointed at while the page moves), and keep drawing while any
   * of it is still fading.
   */
  private paintLaser(): void {
    const canvas = this.laserCanvas;
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(this.cssW * ratio);
    const height = Math.round(this.cssH * ratio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const t = now();
    if (!this.laserTrail.visible(t)) return;
    const scale = this.unitScale;
    const scrollY = this.viewport.scrollY;
    const sx = (x: number): number => (x * scale + this.offsetX) * ratio;
    const sy = (y: number): number => (y - scrollY) * scale * ratio;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = LASER_COLOR;
    ctx.fillStyle = LASER_COLOR;
    const segments = this.laserTrail.segments(t);
    // A wide faint pass is the glow, a narrow one the beam: no canvas blur,
    // which is slow on the iPad.
    for (const [lineWidth, strength] of [
      [LASER_GLOW_PX, 0.25],
      [LASER_WIDTH_PX, 1],
    ] as const) {
      ctx.lineWidth = lineWidth * ratio;
      for (const { a, b, alpha } of segments) {
        ctx.globalAlpha = alpha * strength;
        ctx.beginPath();
        ctx.moveTo(sx(a.x), sy(a.y));
        ctx.lineTo(sx(b.x), sy(b.y));
        ctx.stroke();
      }
    }
    const tip = this.laserTrail.tip();
    if (tip) {
      for (const [radius, strength] of [
        [LASER_GLOW_PX / 2, 0.3],
        [LASER_WIDTH_PX * 0.75, 1],
      ] as const) {
        ctx.globalAlpha = strength;
        ctx.beginPath();
        ctx.arc(sx(tip.x), sy(tip.y), radius * ratio, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    this.requestLaser();
  }

  /** Every sample erases (a preview); the lift commits the gesture as one step. */
  private readonly eraserGesture: PenGesture = {
    down: (box, at) => {
      this.eraseReset();
      if (this.eraseAt(box, at)) this.renderDry();
    },
    move: (box, samples) => {
      let erased = false;
      for (const sample of samples) {
        if (this.eraseAt(box, this.toPage(box, sample))) erased = true;
      }
      if (erased) this.renderDry();
    },
    up: () => this.eraseCommit(),
    // Nothing is committed before the lift, so the page simply goes back.
    cancel: () => {
      this.eraseReset();
      this.activePage = null;
      this.renderDry();
    },
  };

  /** A loop, or a rectangle, selects on lift; a cancel is taken as the lift it most likely was. */
  private readonly lassoGesture: PenGesture = {
    down: (box, at) => this.selectStart(box, at),
    move: (box, samples) => this.selectMove(samples.map((sample) => this.toPage(box, sample))),
    up: () => this.selectEnd(),
    cancel: () => this.selectEnd(),
  };

  /** A tap makes a box that fits its text; with "Drag to size" on, a drag draws the box instead. */
  private readonly textGesture: PenGesture = {
    down: (_box, at) => {
      this.textDrag = { origin: at, to: at };
    },
    move: (box, samples) => {
      const last = samples[samples.length - 1];
      if (!this.textDrag || !last) return;
      const local = this.toPage(box, last);
      this.textDrag.to = { x: clamp(local.x, 0, box.width), y: clamp(local.y, 0, box.height) };
      this.showTextDraft(box);
    },
    up: (box) => this.finishTextDrag(box),
    // Like ink, a cancelled box is kept: iOS may cancel an ordinary lift.
    cancel: (box) => {
      if (box) this.finishTextDrag(box);
    },
  };

  /** The pen, the highlighter and the Shape tool: ink, shapes, and the pen's gestures. */
  private readonly inkGesture: PenGesture = {
    down: (box, at, sample) => this.inkDown(box, at, sample),
    move: (box, samples) => this.inkMove(box, samples),
    up: (box, sample) => this.inkUp(box, sample),
    cancel: (box) => this.inkCancel(box),
  };

  private inkDown(box: PageBox, at: Pt, sample: PointerSample): void {
    const mode = this.toolState.tool === "shape" ? shapeModeFor(this.toolState) : "auto";
    if (mode !== "auto") {
      // A preset is dragged out as its bounding box, as in GoodNotes.
      this.shapeDrag = { preset: mode, origin: at, to: at, moved: false };
      this.showShapeDraft(box);
      return;
    }
    if (this.startTextMark(box, at)) return;
    const resumed = this.resumeLifted(box, at);
    const builder = resumed ?? new StrokeBuilder(this.builderOpts());
    builder.add({ ...sample, ...at });
    this.strokeInput = sample.pointerType ?? "";
    this.builder = builder;
    this.snap = null;
    this.diagHold = { fired: false, verdict: "" };
    this.restartHold(at);
    this.watchCircleHold(box, at);
    this.renderer?.clearWet();
    // A carried-on stroke is drawn wet at once: its committed ink has just
    // been taken back, and the dry layer drops it on the next frame.
    if (resumed) this.drawWet();
  }

  /**
   * The pen came down again so soon, and so close to where it lifted, that
   * it never left the glass (`input/pen-rejoin.ts`): take the stroke it
   * lifted from back off the page and return its builder, to go on with.
   * Null for a new stroke.
   */
  private resumeLifted(box: PageBox, at: Pt): StrokeBuilder | null {
    const lift = this.lastLift;
    this.lastLift = null;
    if (!lift || lift.boxIndex !== box.index) return null;
    const page = this.pageAt(box.index);
    if (!page || page.id !== lift.pageId) return null;
    const style = this.currentStyle();
    const { stroke } = lift;
    if (style.color !== stroke.color || style.size !== stroke.size || style.tool !== stroke.tool) {
      return null;
    }
    const distance = Math.hypot(at.x - lift.x, at.y - lift.y);
    if (!rejoinsStroke(now() - lift.t, distance, this.atFitZoom(REJOIN_PX))) return null;
    if (!this.history.withdraw(this.doc, lift.command)) return null;
    this.strokeIndex.remove(stroke.id, page.id);
    const drawn = selectionBounds([stroke], [], []);
    if (drawn) this.renderer?.invalidateRegion(box.index, drawn);
    if (this.circleLoop?.command === lift.command) this.circleLoop = null;
    if (this.offPageCommand === lift.command) this.hideOffPage();
    // The stroke keeps the time its first piece went down.
    this.penDownAt = lift.penDownAt;
    this.renderDry();
    this.changed();
    this.diagSums.rejoins++;
    if (this.debug) {
      this.hud.mark("rejoin");
      this.scheduleHud();
    }
    return lift.builder;
  }

  private inkMove(box: PageBox, samples: PointerSample[]): void {
    const last = samples[samples.length - 1];
    if (this.textMark) {
      if (last) this.dragTextMark(box, this.toPage(box, last));
      return;
    }
    if (this.shapeDrag) {
      if (last) {
        const local = this.toPage(box, last);
        const drag = this.shapeDrag;
        drag.to = { x: clamp(local.x, 0, box.width), y: clamp(local.y, 0, box.height) };
        const travelled = Math.hypot(drag.to.x - drag.origin.x, drag.to.y - drag.origin.y);
        if (travelled >= this.atFitZoom(SHAPE_TAP_SLOP)) drag.moved = true;
        this.showShapeDraft(box);
      }
      return;
    }
    if (this.circleDrag) {
      if (last) this.dragCircleSelection(box, this.toPage(box, last));
      return;
    }
    const builder = this.builder;
    if (!builder) return;
    const press = this.circlePress;
    if (press && last) {
      const local = this.toPage(box, last);
      if (Math.hypot(local.x - press.at.x, local.y - press.at.y) * this.unitScale > TAP_SLOP_PX) {
        this.cancelCircleHold();
      }
    }
    const snap = this.snap;
    if (snap) {
      // Snapped and still held: the shape follows the pen.
      if (last) snap.pts = transformShape(snap.base, snap.pivot, snap.from, this.toPage(box, last));
      this.scheduleWet();
      return;
    }
    // Keeping a sample is cheap and happens at once; outlining the stroke is
    // not, so it waits for the next frame (`scheduleWet`), once however many
    // moves came in meanwhile.
    for (const sample of samples) {
      const local = this.toPage(box, sample);
      builder.add({ ...sample, ...local });
      this.trackHold(local);
    }
    this.scheduleWet();
  }

  private inkUp(box: PageBox, sample: PointerSample): void {
    if (this.textMark) {
      this.finishTextMark(box);
      return;
    }
    if (this.shapeDrag) {
      this.finishShapeDrag(box);
      return;
    }
    if (this.circleDrag) {
      this.endCircleDrag();
      return;
    }
    this.cancelCircleHold();
    this.finishStroke(box, { ...sample, ...this.toPage(box, sample) });
  }

  /**
   * A cancelled pen keeps its ink. iOS cancels the pointer on some ordinary
   * lifts, and on a pen held still (WebKit's own long press), so throwing
   * the stroke away would make ink just written disappear; a pen that sat
   * still counts as the hold it was.
   */
  private inkCancel(box: PageBox | null): void {
    // As ink is, a highlight is kept when iOS cancels the lift.
    if (box && this.textMark) {
      this.finishTextMark(box);
      return;
    }
    if (box && this.shapeDrag) {
      this.finishShapeDrag(box);
      return;
    }
    // A cancelled drag of a held loop's selection is kept, as the frame's is.
    if (this.circleDrag) {
      this.endCircleDrag();
      return;
    }
    // WebKit may end a pen held on the loop before our timer: the same hold.
    const press = this.circlePress;
    if (press && now() - press.t >= CANCEL_HOLD_FLOOR_MS) {
      this.circleHeld(false);
      this.activePage = null;
      return;
    }
    this.cancelCircleHold();
    // A cancel of a pen that has not moved is WebKit reporting a long press,
    // not aborting one: treat it as the hold it interrupted.
    const anchor = this.holdAnchor;
    const cancelledWhileHeld = anchor !== null && now() - anchor.t >= CANCEL_HOLD_FLOOR_MS;
    if (box) this.finishStroke(box, null, cancelledWhileHeld);
  }

  /**
   * Hold-to-snap trigger (contracts/api.md §2): the pen must stay within
   * `HOLD_RADIUS` (on screen, see {@link atFitZoom}) for `HOLD_MS`. Drifting
   * further restarts the clock. In page px, slow writing at 5x zoom stayed
   * inside the radius and could snap mid-word.
   */
  private trackHold(local: Pt): void {
    const anchor = this.holdAnchor;
    if (!anchor) return;
    const dx = local.x - anchor.x;
    const dy = local.y - anchor.y;
    const radius = this.atFitZoom(HOLD_RADIUS);
    if (dx * dx + dy * dy > radius * radius) this.restartHold(local);
  }

  private restartHold(local: Pt): void {
    this.stopHold();
    if (!this.holdToSnapEnabled()) return;
    this.holdAnchor = { x: local.x, y: local.y, t: now() };
    this.holdTimer = window.setTimeout(() => {
      this.holdTimer = 0;
      this.snapHeldStroke();
    }, HOLD_MS);
  }

  private stopHold(): void {
    if (this.holdTimer) window.clearTimeout(this.holdTimer);
    this.holdTimer = 0;
    this.holdAnchor = null;
  }

  /** The Shape tool always snaps on a hold; the pens only with the setting on. */
  private holdToSnapEnabled(): boolean {
    // A practice file is handwriting only.
    if (this.practice) return false;
    const tool = this.toolState.tool;
    if (tool === "shape") return true;
    return (tool === "pen" || tool === "highlighter") && this.toolState.shapeSnapEnabled !== false;
  }

  /**
   * The pen has dwelled: try to read the stroke so far as a shape. On a
   * confident match the wet stroke is replaced by the clean shape at once,
   * while the pen is still down. On no match nothing happens — a wrong snap
   * is worse than none — and the user can keep writing.
   */
  private snapHeldStroke(): void {
    const builder = this.builder;
    const anchor = this.holdAnchor;
    if (!builder || !anchor || this.snap) return;
    const result = recognizeAtZoom(builder.points(), this.userZoom, { held: true });
    this.diagHold = { fired: true, verdict: verdictOf(builder.points(), true) };
    this.hudVerdict("hold", builder.points(), result, true);
    if (!result) return;
    const pivot = shapePivot(result.kind, result.pts);
    if (!pivot) return;
    this.snap = {
      kind: result.kind,
      base: result.pts,
      pivot,
      from: { x: anchor.x, y: anchor.y },
      pts: result.pts,
    };
    this.scheduleWet();
  }

  // --- Shape diagnostics ----------------------------------------------------

  /** The pointer stream's shape, kept for every stroke (not only with the HUD). */
  private trackPointer(record: PointerDebugRecord): void {
    const p = this.diagPointer;
    switch (record.type) {
      case "down":
        this.diagSums.down++;
        p.type = record.pointerType;
        p.downT = record.timeStamp;
        p.lastT = record.timeStamp;
        p.firstMoveT = -1;
        p.moves = 0;
        p.samples = 0;
        break;
      case "move":
        p.moves++;
        p.samples += record.coalesced;
        if (p.firstMoveT < 0) p.firstMoveT = record.timeStamp;
        p.lastT = record.timeStamp;
        break;
      case "up":
        this.diagSums.up++;
        p.lastT = record.timeStamp;
        break;
      case "cancel":
        this.diagSums.cancel++;
        p.lastT = record.timeStamp;
        break;
    }
  }

  private recordDiagnostic(
    pts: number[],
    committed: string,
    end: StrokeDiagnostic["end"],
    held: boolean,
  ): void {
    const p = this.diagPointer;
    this.diagnostics.push({
      at: Math.round(now() - this.createdAt),
      tool:
        this.toolState.tool === "shape"
          ? `shape/${shapeModeFor(this.toolState)}`
          : this.toolState.tool,
      pointer: p.type,
      moves: p.moves,
      samples: p.samples,
      firstMoveMs: p.firstMoveT < 0 ? -1 : Math.round(p.firstMoveT - p.downT),
      durationMs: Math.round(p.lastT - p.downT),
      end,
      holdFired: this.diagHold.fired,
      holdVerdict: this.diagHold.verdict,
      held,
      liftVerdict: verdictOf(pts, held),
      committed,
      pts: pts.map((v) => Math.round(v * 10) / 10),
    });
    if (this.diagnostics.length > DIAGNOSTICS_MAX) this.diagnostics.shift();
  }

  /**
   * The recent strokes and the environment they were drawn in, as JSON, for
   * a bug report. `extra` is whatever the host knows (plugin version, file).
   */
  exportDiagnostics(extra: Record<string, unknown> = {}): string {
    const proto = typeof PointerEvent === "undefined" ? null : PointerEvent.prototype;
    return JSON.stringify(
      {
        ...extra,
        platform: {
          iosApp: Platform.isIosApp,
          androidApp: Platform.isAndroidApp,
          tablet: Platform.isTablet,
          phone: Platform.isPhone,
          desktop: Platform.isDesktop,
        },
        devicePixelRatio: window.devicePixelRatio,
        coalescedEvents: proto !== null && "getCoalescedEvents" in proto,
        predictedEvents: proto !== null && "getPredictedEvents" in proto,
        roundedPen: this.pointerInput?.strokeRounded ?? null,
        scale: Math.round(this.scale * 1000) / 1000,
        tool: this.toolState.tool,
        drawAndHold: this.toolState.shapeSnapEnabled !== false,
        holdMs: HOLD_MS,
        holdRadius: HOLD_RADIUS,
        pointers: this.diagSums,
        strokes: this.diagnostics,
      },
      null,
      0,
    );
  }

  // --- The diagnostics HUD -------------------------------------------------------

  /**
   * A drawing-pointer event, as the pointer controller reports it: always
   * noted for the shape diagnostics, and counted on the HUD while it shows.
   */
  private onPointerEvent(record: PointerDebugRecord): void {
    this.trackPointer(record);
    if (!this.debug) return;
    this.hud.record(record);
    this.scheduleHud();
  }

  /**
   * What the recogniser made of a stroke, for the HUD: the accepted kind, or
   * the best candidate it refused and its score — so a screen recording can
   * tell "the hold never fired" from "it fired and the shape was refused".
   */
  private hudVerdict(
    where: string,
    pts: number[],
    accepted: { kind: ShapeKind; confidence?: number } | null,
    held = false,
  ): void {
    if (!this.debug) return;
    const best = accepted ?? recognizeAtZoom(pts, this.userZoom, { minConfidence: 0, held });
    const score = best?.confidence === undefined ? "" : best.confidence.toFixed(2);
    const label = best ? `${best.kind}${accepted ? "" : "✗"}${score}` : "∅";
    this.hudLastVerdict = `${where}→${label} n=${Math.floor(pts.length / 3)}`;
    this.hud.mark(where === "hold" ? "hold" : "snap?");
    this.scheduleHud();
  }

  /** Redraw the HUD on the next frame: one redraw for however many changes come first. */
  private scheduleHud(): void {
    if (this.hudFrame !== 0) return;
    this.hudFrame = window.requestAnimationFrame(this.drawHud);
  }

  private readonly drawHud = (): void => {
    this.hudFrame = 0;
    this.renderHud();
  };

  /**
   * The HUD's text: the pointer log and counts, the last shape verdict, the
   * pointer and page, then where everything is on screen.
   */
  private renderHud(): void {
    if (!this.debug) return;
    this.hudEl.setText(
      this.hud.summary(strokeCount(this.doc)) +
        `shape ${this.hudLastVerdict}\n` +
        `${this.hud.pointer()} page=${this.pageIndex + 1}\n` +
        this.hudGeometry(),
    );
  }

  /**
   * Where everything is, for diagnosing iPad-only view jumps from a screenshot
   * (there is no console on iPadOS): pinch-zoom and keyboard viewport, every
   * scroll offset that a focused text box can disturb, and the canvas size.
   */
  private hudGeometry(): string {
    const vv = window.visualViewport;
    const r = (n: number): number => Math.round(n);
    const canvas = this.surfaceEl.querySelector("canvas");
    const active = document.activeElement;
    const focus = active?.classList.contains("goodobsidian-page-textbox-input")
      ? "textbox"
      : (active?.tagName.toLowerCase() ?? "-");
    return (
      `vv ${vv ? `${r(vv.width)}x${r(vv.height)} @${r(vv.offsetLeft)},${r(vv.offsetTop)} z=${vv.scale.toFixed(2)}` : "-"} ` +
      `win ${r(window.innerWidth)}x${r(window.innerHeight)} sy=${r(window.scrollY)}
` +
      `surf ${this.cssW}x${this.cssH} st=${r(this.surfaceEl.scrollTop)} ` +
      `scroll x=${r(this.scroller.position.x)} y=${r(this.scroller.position.y)} ` +
      `cv ${canvas ? `${canvas.width}x${canvas.height}` : "-"} layouts=${this.hudLayouts}
` +
      `pill=${this.callbacks.textPillState?.() ?? "-"} ` +
      `focus=${focus} zoom=${this.scale.toFixed(2)} kb=${r(keyboardHeight())} ` +
      `app=${r(document.querySelector(".app-container")?.getBoundingClientRect().height ?? -1)}
` +
      this.hudFrames()
    );
  }

  /** Frame rate, paint time and the tile cache — what a scroll recording should show. */
  private hudFrames(): string {
    const stats = this.renderer?.stats();
    const v = this.scroller.velocity;
    const tiles = stats ? `${stats.tiles}/${(stats.tileBytes / 1048576).toFixed(0)}MB` : "-";
    return (
      `fps=${this.hudFps.toFixed(0)} paint=${this.hudPaintMs.toFixed(1)}ms ` +
      `tiles=${tiles} prev=${stats?.previews ?? 0} lvl=${stats?.level.toFixed(2) ?? "-"} ` +
      `v=${(v.x * 1000).toFixed(0)},${(v.y * 1000).toFixed(0)}px/s ` +
      `${this.scroller.isDragging ? "drag" : this.scroller.isAnimating ? "fling" : "rest"}` +
      `${this.pinch ? " pinch" : ""}${this.zoomAnim ? " zoom-spring" : ""}`
    );
  }

  /** Smooth the frame interval and paint time over consecutive moving frames. */
  private trackFrame(t: number, started: number, moving: boolean): void {
    const paint = now() - started;
    this.hudPaintMs = this.hudPaintMs ? this.hudPaintMs * 0.8 + paint * 0.2 : paint;
    if (moving && this.hudLastFrameT) {
      const dt = t - this.hudLastFrameT;
      if (dt > 0 && dt < 250) {
        const fps = 1000 / dt;
        this.hudFps = this.hudFps ? this.hudFps * 0.8 + fps * 0.2 : fps;
      }
    }
    this.hudLastFrameT = moving ? t : 0;
    this.scheduleHud();
  }

  // --- Drawing a stroke ------------------------------------------------------------

  /**
   * Draw the stroke in progress on the next frame. Pointer events can come
   * several times a frame; the outline is drawn once, with whatever arrived.
   */
  private scheduleWet(): void {
    if (this.wetFrame !== 0 || !this.builder) return;
    this.wetFrame = window.requestAnimationFrame(() => this.drawWet());
  }

  private drawWet(): void {
    this.wetFrame = 0;
    const box = this.activePage;
    const builder = this.builder;
    if (!builder || !box) return;
    // A snapped shape is drawn as the clean shape, following the held pen.
    if (this.snap) {
      this.renderWetShape(box.index, this.snap.kind, this.snap.pts);
      return;
    }
    const style = this.currentStyle();
    // A straightened highlight is traced afresh each frame: a new sample can
    // move where its runs bend. It has few samples, so that stays cheap.
    const pts = builder.view;
    let tracer = this.wetTracer;
    if (!tracer || builder.revision !== this.wetRevision) {
      tracer = new InkTracer(penFor(style));
      this.wetTracer = tracer;
      this.wetRevision = builder.revision;
    }
    // Only the points kept since the last frame: what is traced stays.
    for (let i = tracer.length * 3; i + 2 < pts.length; i += 3) {
      tracer.push(pts[i], pts[i + 1], pts[i + 2]);
    }
    const runs = tracer.runs();
    // Samples still provisional (`densify` waits for the next to fix the
    // curve; centred smoothing for the next few): straight lines through
    // them until they settle. The open run is the tracer's copy, so this
    // changes nothing kept.
    const open = runs[runs.length - 1];
    if (open) for (const tip of builder.tail) open.pts.push(tip[0], tip[1]);
    this.renderer?.renderWetRuns(box.index, runs, style);
  }

  /**
   * A highlighter stroke drawn as a line, lifted: the straight line it meant
   * (`lineOfHighlight`), with the straightening setting on; null for any
   * other stroke, or one that is not a line. The shortest it snaps is a
   * screen length.
   */
  private highlightLine(tool: Tool, pts: readonly number[]): number[] | null {
    if (tool !== "highlighter") return null;
    if (this.callbacks.straightenHighlighter?.() === false) return null;
    return lineOfHighlight(pts, this.atFitZoom(HIGHLIGHT_LINE_MIN_PX));
  }

  /**
   * Stop drawing the stroke in progress: no frame pending, no hold timer,
   * the wet layer clear. Returns its builder, for a caller that keeps it.
   */
  private endWetStroke(): StrokeBuilder | null {
    if (this.wetFrame !== 0) window.cancelAnimationFrame(this.wetFrame);
    this.wetFrame = 0;
    const builder = this.builder;
    this.builder = null;
    this.snap = null;
    this.wetTracer = null;
    this.stopHold();
    this.renderer?.clearWet();
    return builder;
  }

  /** The page-local rectangle of the current text-tool drag, normalised. */
  private textDragRect(): { x: number; y: number; w: number; h: number } | null {
    const drag = this.textDrag;
    if (!drag) return null;
    return {
      x: Math.min(drag.origin.x, drag.to.x),
      y: Math.min(drag.origin.y, drag.to.y),
      w: Math.abs(drag.to.x - drag.origin.x),
      h: Math.abs(drag.to.y - drag.origin.y),
    };
  }

  /** "Drag to size" is on: a text-tool drag draws the new box. */
  private dragSizesText(): boolean {
    return this.callbacks.textDragSize?.() ?? this.toolState.textDragSize === true;
  }

  private showTextDraft(box: PageBox): void {
    const rect = this.textDragRect();
    const isTap =
      !rect || !this.dragSizesText() || Math.max(rect.w, rect.h) < this.atFitZoom(TEXT_TAP_SLOP);
    this.textDraftEl.toggleClass("is-hidden", isTap);
    if (!rect || isTap) return;
    const scale = this.unitScale;
    this.textDraftEl.setCssStyles({
      left: `${Math.round((box.x + rect.x) * scale)}px`,
      top: `${Math.round((box.y + rect.y) * scale)}px`,
      width: `${Math.round(rect.w * scale)}px`,
      height: `${Math.round(rect.h * scale)}px`,
    });
  }

  /** End a text-tool gesture: a tap or a dragged rectangle becomes a text box. */
  private finishTextDrag(box: PageBox): void {
    const drag = this.textDrag;
    const rect = this.textDragRect();
    this.textDrag = null;
    this.activePage = null;
    this.textDraftEl.addClass("is-hidden");
    if (!rect || !drag) return;

    if (!this.dragSizesText() || Math.max(rect.w, rect.h) < this.atFitZoom(TEXT_TAP_SLOP)) {
      // GoodNotes' default: the box starts where the pen went down, as small
      // as it can be, and grows with the text (the sync sets its width).
      const x = clamp(drag.origin.x, 0, Math.max(0, box.width - TEXT_MIN_W));
      this.addTextBox(box, { x, y: drag.origin.y, w: TEXT_MIN_W, fit: true });
      return;
    }
    const w = Math.max(TEXT_MIN_W, rect.w);
    const h = Math.max(TEXT_MIN_H, rect.h);
    this.addTextBox(box, {
      x: clamp(rect.x, 0, Math.max(0, box.width - w)),
      y: clamp(rect.y, 0, Math.max(0, box.height - h)),
      w,
      h,
    });
  }

  /** Create and focus a persistent text box with the given page-local frame. */
  private addTextBox(box: PageBox, frame: TextBoxFrame): void {
    const page = this.pageAt(box.index);
    if (!page) return;
    const textBox: TextBoxElement = {
      id: this.textBoxIds.next(),
      x: Math.max(0, frame.x),
      y: Math.max(0, frame.y),
      w: frame.w,
      ...(frame.h !== undefined ? { h: frame.h } : {}),
      ...(frame.fit ? { fit: true as const } : {}),
      text: "",
      // The Text tool's own style (colour, size, font…), not the pen's colour.
      ...textStyleOf(this.toolState.textStyle ?? DEFAULT_TEXT_STYLE),
    };
    const add = new AddTextBoxToPage(page.id, textBox);
    this.history.push(this.doc, add);
    this.lastTextBoxAdd = { key: `${page.id}:${textBox.id}`, command: add, followers: [] };
    // The hint has done its job once a box exists.
    this.hideTextHint();
    this.syncTextBoxes();
    this.changed();

    const view = this.textBoxInputs.get(`${page.id}:${textBox.id}`);
    // Focus without letting the browser scroll anything to "reveal" the box:
    // on iPad that is what dragged the page to the bottom. Synchronous, inside
    // the pointerup, because iPadOS only raises the keyboard for a focus made
    // during a user gesture.
    if (view) this.focusTextBox(view.input);
  }

  /**
   * The pen lifted (`final`, its last sample) or was cancelled (`final`
   * null): turn what it drew into a stroke — or a shape, or a scribble that
   * erases — and commit it as one step.
   */
  private finishStroke(
    box: PageBox,
    final: PointerSample | null,
    cancelledWhileHeld = false,
  ): void {
    const snap = this.snap;
    // A lift that lands just as the timer is due still counts as a hold.
    const heldLongEnough =
      this.holdAnchor !== null &&
      (cancelledWhileHeld || now() - this.holdAnchor.t >= HOLD_MS) &&
      this.holdToSnapEnabled();
    const builder = this.endWetStroke();
    this.activePage = null;
    if (!builder) return;

    if (final && !snap) builder.addFinal(final);
    // A cancel has no last sample: the one still waiting is where the stroke ends.
    builder.settle();
    this.penPressure = builder.typicalPressure() ?? this.penPressure;
    // One sample is a dot, and a dot is ink; only a stroke with none is dropped.
    if (builder.length === 0) return;

    const page = this.pageAt(box.index);
    if (!page) return;

    // Scribble to erase: a scribble over writing erases it and is not kept.
    if (!snap && this.scribbleErase(box, page, builder.points())) {
      this.recordDiagnostic(
        builder.points(),
        "scribble-erase",
        final ? "up" : cancelledWhileHeld ? "cancel-as-hold" : "cancel",
        heldLongEnough,
      );
      return;
    }

    // The Shape tool's auto mode snaps every stroke on lift, no hold needed,
    // and so does the pen with its auto-shape toggle on.
    const snapOnLift =
      this.toolState.tool === "shape" ||
      (this.toolState.penAutoShape === true &&
        !this.practice &&
        (this.toolState.tool === "pen" || this.toolState.tool === "highlighter"));
    let shape: { kind: ShapeKind; pts: number[] } | null = snap;
    if (!shape && (heldLongEnough || snapOnLift)) {
      // Held, the pen rested where the stroke ends; snapped on lift, it may
      // have trailed a tail as it left the glass.
      const held = heldLongEnough;
      shape = recognizeAtZoom(builder.points(), this.userZoom, { held });
      this.hudVerdict(cancelledWhileHeld ? "cx-hold" : "lift", builder.points(), shape, held);
    } else if (!shape && this.debug) {
      this.hud.mark(final ? "lift·nohold" : "cx·nohold");
      this.scheduleHud();
    }
    this.recordDiagnostic(
      builder.points(),
      shape ? shape.kind : "freehand",
      final ? "up" : cancelledWhileHeld ? "cancel-as-hold" : "cancel",
      heldLongEnough,
    );

    // Stored as it was drawn on the wet layer: the same colour, width and ink.
    const { color, size, tool } = this.currentStyle();
    const samples = builder.recorded();
    const stroke: Stroke = {
      id: this.strokeIds.next(),
      color,
      size,
      tool,
      pts: shape ? shape.pts : (this.highlightLine(tool, builder.points()) ?? builder.points()),
      ...(shape ? { shape: shape.kind } : {}),
      ...(samples ? { samples } : {}),
    };
    if (shape) this.styleShape(stroke);
    this.notePracticeInput();
    const command = this.commitStroke(box, page, stroke);
    this.noteCircleLoop(page, stroke, command);
    this.noteOffPage(box, stroke, command);
    // A stroke the pen was held on ended on purpose; any other may be a
    // flicker of the Pencil's contact, which the next pen-down carries on.
    if (!snap && !heldLongEnough) {
      const end = builder.length - 1;
      const raw = builder.view;
      this.lastLift = {
        t: now(),
        boxIndex: box.index,
        pageId: page.id,
        x: raw[end * 3],
        y: raw[end * 3 + 1],
        builder,
        stroke,
        command,
        penDownAt: this.penDownAt,
      };
    }
  }

  /**
   * Ink past the page's edge is kept but never drawn, so a stroke that runs
   * well off the page says so, with Undo: GoodNotes' "Content outside of
   * the page" notice, without dropping the stroke as GoodNotes does. The
   * notice goes the moment anything else is done (`syncHistory`).
   */
  private noteOffPage(box: PageBox, stroke: Stroke, command: Command): void {
    const beyond = inkBeyondPage(stroke.pts, box.width, box.height);
    if (beyond < this.atFitZoom(OFF_PAGE_TOLERANCE_PX)) return;
    this.hideOffPage();
    this.offPageCommand = command;
    this.offPageEl.removeClass("is-hidden");
    this.offPageTimer = window.setTimeout(() => this.fadeOffPage(), OFF_PAGE_NOTICE_MS);
  }

  private fadeOffPage(): void {
    this.offPageTimer = 0;
    if (prefersReducedMotion()) {
      this.hideOffPage();
      return;
    }
    this.offPageFade = this.offPageEl.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: OFF_PAGE_FADE_MS,
      easing: "ease-in",
      fill: "forwards",
    });
    // A timer, not the finish event, which can land late (see toolbar.ts).
    this.offPageTimer = window.setTimeout(() => this.hideOffPage(), OFF_PAGE_FADE_MS);
  }

  private hideOffPage(): void {
    window.clearTimeout(this.offPageTimer);
    this.offPageTimer = 0;
    this.offPageFade?.cancel();
    this.offPageFade = null;
    this.offPageCommand = null;
    this.offPageEl.addClass("is-hidden");
  }

  /**
   * Record a finished stroke via the command stack (applies the add), then
   * paint just this stroke incrementally rather than re-outlining the page.
   * Every stroke is timestamped with its gesture's pen-down (a snapped shape
   * keeps the time its freehand original began), and a page's first one
   * starts the page's clock in the same undo step.
   */
  private commitStroke(box: PageBox, page: Page, stroke: Stroke): Command {
    const command = addStrokesTimed(page, [stroke], this.penDownAt);
    this.history.push(this.doc, command);
    this.strokeIndex.add(page.id, stroke);
    this.renderer?.appendCommittedStroke(box.index, stroke, this.inkPressure);
    // The wet layer was just cleared: blit the tiles now, or the stroke
    // would be missing for a frame.
    this.inkChanged([page.id]);
    return command;
  }

  // --- Shape tool presets ------------------------------------------------------

  /**
   * Geometry of the preset being dragged; a tap places a default size,
   * centred on the tap: a square box (a star keeps its own proportions, so a
   * tapped one is regular), or a connector running left to right. The slop
   * and the default size are on-screen lengths ({@link atFitZoom}): a tap
   * at 5x zoom makes a shape that looks as big as one tapped at fit.
   */
  private shapeDragGeometry(box: PageBox): number[] {
    const drag = this.shapeDrag;
    if (!drag || drag.preset === "table") return [];
    const preset = drag.preset;
    let { origin, to } = drag;
    if (!drag.moved) {
      const halfW = this.atFitZoom(SHAPE_DEFAULT_SIZE) / 2;
      const connector = isConnectorPreset(preset);
      const halfH = connector ? 0 : preset === "star" ? halfW * STAR_ASPECT : halfW;
      const cx = clamp(origin.x, halfW, Math.max(halfW, box.width - halfW));
      const cy = clamp(origin.y, halfH, Math.max(halfH, box.height - halfH));
      origin = { x: cx - halfW, y: cy - halfH };
      to = { x: cx + halfW, y: cy + halfH };
    }
    return presetGeometry(preset, origin, to, FALLBACK_PRESSURE);
  }

  /**
   * The strokes of the table being dragged out. Until the pen has moved past
   * the tap slop they are the table a tap would place, so what shows at
   * pen-down is exactly what lifting there leaves on the page.
   */
  private tableDragStrokes(box: PageBox): TableStroke[] {
    const drag = this.shapeDrag;
    if (!drag || drag.preset !== "table") return [];
    const size = tableSizeFor(this.toolState);
    const page = { width: box.width, height: box.height };
    const frame = drag.moved
      ? draggedTableBox(drag.origin, drag.to, size, page, this.atFitZoom(1))
      : tappedTableBox(drag.origin, size, page, this.atFitZoom(1));
    return tableStrokes(frame.from, frame.to, size, FALLBACK_PRESSURE);
  }

  private showShapeDraft(box: PageBox): void {
    const drag = this.shapeDrag;
    if (!drag) return;
    if (drag.preset === "table") {
      const strokes = this.tableDragStrokes(box).map((part) => part.pts);
      if (strokes.length === 0) this.renderer?.clearWet();
      else this.renderer?.renderWetMany(box.index, strokes, this.tableStyle());
      return;
    }
    // While dragging, preview the real size — even a tiny one; the tap
    // default only applies if the pen lifts without having moved.
    const pts = presetGeometry(drag.preset, drag.origin, drag.to, FALLBACK_PRESSURE);
    if (pts.length === 0) {
      this.renderer?.clearWet();
      return;
    }
    this.renderWetShape(box.index, drag.preset, pts);
  }

  /** A table is ruled in the pen's colour, thinner than handwriting. */
  private tableStyle(): StrokeStyle {
    return { ...this.currentStyle(), size: TABLE_STROKE_WIDTH, tool: "pen", shape: true };
  }

  private finishShapeDrag(box: PageBox): void {
    const drag = this.shapeDrag;
    const table = this.tableDragStrokes(box);
    const pts = this.shapeDragGeometry(box);
    this.shapeDrag = null;
    this.activePage = null;
    this.renderer?.clearWet();
    const page = this.pageAt(box.index);
    if (!drag || !page) return;
    if (drag.preset === "table") {
      this.commitTable(box, page, table);
      return;
    }
    if (pts.length === 0) return;
    this.commitStroke(
      box,
      page,
      this.styleShape({
        id: this.strokeIds.next(),
        color: this.strokeColor(),
        size: this.strokeSize(),
        tool: "pen",
        pts,
        shape: drag.preset,
      }),
    );
  }

  /**
   * Place a table. Its outline and inner lines are ordinary strokes — a rect
   * and lines, so they can be written in, erased and lassoed like any ink —
   * added together as one undo step.
   */
  private commitTable(box: PageBox, page: Page, parts: readonly TableStroke[]): void {
    if (parts.length === 0) return;
    const style = this.tableStyle();
    const strokes: Stroke[] = parts.map((part) => ({
      id: this.strokeIds.next(),
      color: style.color,
      size: style.size,
      tool: "pen",
      pts: part.pts,
      shape: part.shape,
    }));
    // One undo step, every line sharing the gesture's pen-down time.
    this.history.push(this.doc, addStrokesTimed(page, strokes, this.penDownAt, "Add table"));
    for (const stroke of strokes) {
      this.strokeIndex.add(page.id, stroke);
      this.renderer?.appendCommittedStroke(box.index, stroke, this.inkPressure);
    }
    this.inkChanged([page.id]);
  }

  // --- The highlighter on a PDF's text ------------------------------------------

  /**
   * Where the text of PDF pages comes from (null: nowhere; the highlighter
   * then never snaps). Reads the pages in view if the highlighter is in hand.
   */
  setTextSource(source: PdfTextSource | null): void {
    this.textSource = source;
    this.prefetchText();
  }

  /**
   * The text of page `index`'s PDF, laid out on the page, or null when the
   * page is not a PDF's or its text is not read yet (it is asked for then).
   * Never waits: the pen can be on its way down.
   */
  private pageText(index: number): TextLayout | null {
    const page = this.pageAt(index);
    const source = this.textSource;
    if (!page || !source || page.backdrop.kind !== "pdf") return null;
    const layout = source.peek(page.backdrop, page.geometry);
    if (!layout) source.request(page.backdrop);
    return layout;
  }

  /**
   * With the highlighter in hand, have the text of the page in view and the
   * pages either side read, so the first stroke on them can snap.
   */
  private prefetchText(): void {
    if (!this.textSource || this.toolState.tool !== "highlighter") return;
    for (const index of [this.pageIndex, this.pageIndex + 1, this.pageIndex - 1]) {
      this.pageText(index);
    }
  }

  /**
   * The highlighter came down on a PDF page's text: it marks that text, a
   * line at a time, instead of drawing freehand. Anywhere else (off the
   * text, on a scan, on a page whose text is still being read) it draws
   * freehand as ever.
   */
  private startTextMark(box: PageBox, at: Pt): boolean {
    if (this.toolState.tool !== "highlighter" || this.practice) return false;
    const layout = this.pageText(box.index);
    if (!layout) return false;
    const selection = selectText(layout, at, at, this.atFitZoom(TEXT_SNAP_SLOP_PX));
    if (!selection) return false;
    // Not the carry-on of a stroke just lifted: this is no handwriting.
    this.lastLift = null;
    this.textMark = { layout, from: at, selection };
    this.showTextMark(box);
    return true;
  }

  private dragTextMark(box: PageBox, to: Pt): void {
    const mark = this.textMark;
    if (!mark) return;
    const selection = selectText(mark.layout, mark.from, to, this.atFitZoom(TEXT_SNAP_SLOP_PX));
    if (!selection) return;
    if (selection.start === mark.selection.start && selection.end === mark.selection.end) return;
    mark.selection = selection;
    this.showTextMark(box);
  }

  /** The highlight being dragged, drawn wet exactly as it will be stored. */
  private showTextMark(box: PageBox): void {
    const mark = this.textMark;
    if (!mark) return;
    let n = 0;
    const strokes = textHighlightStrokes(
      mark.selection.rects,
      this.strokeColor(),
      () => `draft${++n}`,
    );
    this.renderer?.renderWetStrokes(box.index, strokes);
  }

  /** Let go of a text highlight being dragged, keeping nothing (the tool changed under it). */
  private dropTextMark(): void {
    if (!this.textMark) return;
    this.textMark = null;
    this.renderer?.clearWet();
  }

  /** The pen lifted from a text highlight: add it, one stroke a line, as one undo step. */
  private finishTextMark(box: PageBox): void {
    const mark = this.textMark;
    this.textMark = null;
    this.activePage = null;
    this.renderer?.clearWet();
    const page = this.pageAt(box.index);
    if (!mark || !page) return;
    const strokes = textHighlightStrokes(mark.selection.rects, this.strokeColor(), () =>
      this.strokeIds.next(),
    );
    if (strokes.length === 0) return;
    const command = highlightText(page, strokes, this.penDownAt);
    this.history.push(this.doc, command);
    for (const stroke of strokes) {
      this.strokeIndex.add(page.id, stroke);
      this.renderer?.appendCommittedStroke(box.index, stroke, this.inkPressure);
    }
    // Only this page changed: the save cache serialises it alone.
    this.inkChanged([page.id]);
    this.showTextCopy(mark.selection.text, command);
  }

  /** Show the text a highlight snapped to, with Copy, for a few seconds. */
  private showTextCopy(text: string, command: Command): void {
    this.hideTextCopy();
    if (!text) return;
    this.textCopyText = text;
    this.textCopyCommand = command;
    this.textCopyLabel.setText(`\u201c${text.replace(/\s+/g, " ")}\u201d`);
    this.textCopyEl.removeClass("is-hidden");
    this.textCopyTimer = window.setTimeout(() => this.hideTextCopy(), TEXT_COPY_NOTICE_MS);
  }

  private hideTextCopy(): void {
    window.clearTimeout(this.textCopyTimer);
    this.textCopyTimer = 0;
    this.textCopyText = "";
    this.textCopyCommand = null;
    this.textCopyEl.addClass("is-hidden");
  }

  /** Put `text` on the system clipboard, and say so. */
  private copyText(text: string): void {
    if (!text) return;
    void writeSystemText(text).then(
      () => new Notice("Text copied."),
      () => new Notice("FineNotes could not use the clipboard here."),
    );
  }

  /**
   * The PDF text under highlighter ink on page `index`, snapped or freehand
   * (`strokes`, or all of the page's). Null when the page is not a PDF's or
   * its text is not read yet; "" when no highlight covers any text.
   */
  highlightedText(index = this.pageIndex, strokes?: readonly Stroke[]): string | null {
    const page = this.pageAt(index);
    const layout = this.pageText(index);
    if (!page || !layout) return null;
    return textUnder(layout, (strokes ?? page.strokes).filter(isHighlight));
  }

  /** Copy the text highlighted on the page in view, or say why there is none. */
  copyHighlightedText(): void {
    const page = this.pageAt(this.pageIndex);
    if (!page || page.backdrop.kind !== "pdf" || !this.textSource) {
      new Notice("This page has no PDF text to copy.");
      return;
    }
    const text = this.highlightedText(this.pageIndex);
    if (text === null) new Notice("Reading this page's text. Try again in a moment.");
    else if (!text) new Notice("Nothing highlighted on this page covers text.");
    else this.copyText(text);
  }

  // --- The eraser -------------------------------------------------------------------

  /** Drop any in-progress erase preview (the document was never touched). */
  private eraseReset(): void {
    this.eraseIds = new Set();
    this.erasePieces = new Map();
    this.eraseLast = null;
    this.eraseRuled = null;
    this.eraseDirty.clear();
    // Whatever the preview touched is drawn from the document again.
    const preview = this.erasePreview;
    this.erasePreview = null;
    if (preview) this.renderer?.invalidateRegion(preview.pageIndex, preview.bounds);
    this.eraserCursorEl.addClass("is-hidden");
  }

  /**
   * The eraser's diameter in page px: its chosen size on screen, whatever
   * the zoom. Zooming in is how a small mistake is reached; an eraser that
   * grew with the page wiped out its neighbours too.
   */
  private eraserSize(): number {
    return this.atFitZoom(eraserSizeFor(this.toolState));
  }

  /** Show the eraser's footprint centred on a page-local point. */
  private showEraserCursor(box: PageBox, sample: { x: number; y: number }): void {
    const scale = this.unitScale;
    const diameter = Math.max(4, Math.round(this.eraserSize() * scale));
    this.eraserCursorEl.removeClass("is-hidden");
    this.eraserCursorEl.setCssStyles({
      left: `${Math.round((box.x + sample.x) * scale)}px`,
      top: `${Math.round((box.y + sample.y) * scale)}px`,
      width: `${diameter}px`,
      height: `${diameter}px`,
    });
  }

  /**
   * Apply one eraser dab at a page-local point, in whichever mode is active.
   * Returns whether the preview changed; the caller repaints once per event,
   * not once per coalesced sample.
   */
  private eraseAt(box: PageBox, sample: { x: number; y: number }): boolean {
    const page = this.pageAt(box.index);
    if (!page) return false;
    this.showEraserCursor(box, sample);
    const radius = this.eraserSize() / 2;
    const mode = eraserModeFor(this.toolState);
    // "Erase highlighter only" / "Erase pen only": a stroke it may not touch
    // is passed over, as if the eraser were not there.
    const filter = eraserFilterFor(this.toolState);
    if (mode === "ruled" && this.eraseLast === null) this.startRuledErase(page, sample, filter);
    const ruled = this.eraseRuled;
    const whole = mode === "stroke";

    // Samples of a fast drag can land further apart than the eraser is wide.
    // Dab along the gap at half-radius steps so the swept path is solid.
    const last = this.eraseLast ?? sample;
    this.eraseLast = { x: sample.x, y: sample.y };
    const gap = Math.hypot(sample.x - last.x, sample.y - last.y);
    const steps = Math.min(64, Math.max(1, Math.ceil(gap / Math.max(1, radius / 2))));
    let changed = false;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const at = { x: last.x + (sample.x - last.x) * t, y: last.y + (sample.y - last.y) * t };
      const hit = ruled
        ? this.eraseRuledAt(page, ruled, at, radius)
        : whole
          ? this.eraseWholeAt(page, at, radius, filter)
          : this.erasePartialAt(page, at, radius, filter);
      if (hit) changed = true;
    }
    return changed;
  }

  /**
   * The ruled eraser's first dab: read the page's lines and its ink once for
   * the whole pass. A page without lines erases as the standard eraser does,
   * and says so, so the mode never silently does nothing.
   */
  private startRuledErase(page: Page, start: Pt, filter: EraserFilter): void {
    const blocks = writingLines(page.backdrop, page.geometry);
    if (blocks.length === 0) {
      this.flashReadout("No lines on this page: erasing normally");
      return;
    }
    this.eraseRuled = new RuledEraser(blocks, page.strokes, start, page.geometry.width, filter);
  }

  /**
   * Ruled mode: whole strokes on the line under the eraser, as far along it
   * as the pass goes (`ruled-ink.ts`), marked to go when the pen lifts.
   */
  private eraseRuledAt(page: Page, ruled: RuledEraser, at: Pt, radius: number): boolean {
    let marked = false;
    for (const id of ruled.dab(at, radius)) marked = this.markWhole(page, id) || marked;
    return marked;
  }

  /**
   * Mark a stroke to go whole when the eraser lifts, with every stroke
   * linked with it: a linked word is erased all at once, never in part.
   * Returns whether anything was newly marked.
   */
  private markWhole(page: Page, id: string): boolean {
    let marked = false;
    for (const each of withLinkedStrokes(page, [id])) {
      if (this.eraseIds.has(each)) continue;
      this.eraseIds.add(each);
      this.eraseDirty.add(each);
      // Cut pieces of it, from earlier in the pass, go with it.
      this.erasePieces.delete(each);
      marked = true;
    }
    return marked;
  }

  /**
   * Whole-stroke mode: a stroke the eraser touches is marked, to go in full
   * when the pen lifts. Returns whether any stroke was newly marked.
   */
  private eraseWholeAt(page: Page, at: Pt, radius: number, filter: EraserFilter): boolean {
    let marked = false;
    for (const id of this.strokeIndex.near(page.id, at.x, at.y, radius)) {
      const stroke = this.strokeIndex.get(id);
      if (!stroke || this.eraseIds.has(id) || !eraserTakes(stroke, filter)) continue;
      if (!strokeHitByPoint(stroke, at.x, at.y, radius)) continue;
      marked = this.markWhole(page, id) || marked;
    }
    return marked;
  }

  /**
   * Standard mode: cut the eraser's circle out of every stroke under it. The
   * spatial index still holds the originals, and every piece lies inside its
   * original's bounds, so querying for originals finds their pieces too.
   */
  private erasePartialAt(
    page: Page,
    sample: { x: number; y: number },
    radius: number,
    filter: EraserFilter,
  ): boolean {
    // The cut widens by half the stroke width, so the broad phase must too.
    const reach = radius + MAX_STROKE_HALF_WIDTH;
    const candidates = this.strokeIndex.near(page.id, sample.x, sample.y, reach);
    const nextId = (): string => this.strokeIds.next();
    let changed = false;
    for (const id of candidates) {
      const original = this.strokeIndex.get(id);
      if (!original || this.eraseIds.has(id) || !eraserTakes(original, filter)) continue;
      // A linked word is never cut: touching it takes all of it.
      if (isLinked(page, id)) {
        const touches = (this.erasePieces.get(id) ?? [original]).some((piece) =>
          strokeHitByPoint(piece, sample.x, sample.y, radius + piece.size / 2),
        );
        if (touches && this.markWhole(page, id)) changed = true;
        continue;
      }
      let touched = false;
      const survivors: Stroke[] = [];
      for (const piece of this.erasePieces.get(id) ?? [original]) {
        const cut = eraseCircleFromStroke(piece, sample.x, sample.y, radius, nextId);
        if (cut === null) {
          survivors.push(piece);
        } else {
          touched = true;
          survivors.push(...cut);
        }
      }
      if (touched) {
        this.erasePieces.set(id, survivors);
        this.eraseDirty.add(id);
        changed = true;
      }
    }
    return changed;
  }

  /**
   * The eraser lifted: what it took goes as one undo step — the cut strokes
   * replaced by their pieces, or the marked strokes removed from their pages.
   */
  private eraseCommit(): void {
    const box = this.activePage;
    const marked = this.eraseIds;
    const pieces = this.erasePieces;
    this.eraseReset();
    this.activePage = null;
    // The cut strokes are replaced by what is left of them, and the marked
    // ones (whole strokes, linked words) leave their pages: one step for all.
    const steps = [...this.cutSteps(box, pieces), ...this.removalSteps(marked)];
    if (steps.length === 0) {
      // The preview is gone, and the page it drew over comes back as it was.
      if (pieces.size > 0) this.renderDry();
      return;
    }
    this.history.push(
      this.doc,
      steps.length === 1 ? steps[0] : new CompositeCommand("Erase", steps),
    );
    // Each step changes the one page it names; the rest of the index stands.
    const touched = steps.map((step) => step.pageId);
    if (touched.every((id): id is string => id !== undefined)) {
      this.strokeIndex.refreshPages(this.doc.pages, touched);
      this.inkChanged(touched);
    } else {
      this.strokeIndex.rebuild(this.doc.pages);
      this.inkChanged();
    }
  }

  /** The cut strokes, each replaced by what is left of it. */
  private cutSteps(box: PageBox | null, pieces: ReadonlyMap<string, Stroke[]>): Command[] {
    const page = box ? this.pageAt(box.index) : null;
    const replacements: StrokeReplacement[] = [];
    for (const [id, survivors] of pieces) {
      const original = this.strokeIndex.get(id);
      if (original) replacements.push({ original, pieces: survivors });
    }
    return page && replacements.length > 0 ? [new ReplaceStrokesOnPage(page.id, replacements)] : [];
  }

  /** The marked strokes, off their pages. */
  private removalSteps(marked: ReadonlySet<string>): Command[] {
    const byPage = this.strokeIndex.byPage(marked);
    return [...byPage].map(([pageId, ids]) => new RemoveStrokesFromPage(pageId, ids));
  }

  // --- Pen gestures: Scribble to erase and Circle to lasso --------------------
  //
  // GoodNotes 6's, from the pen's menu. The geometry is pure
  // (src/ink/scribble.ts, src/ink/pen-gestures.ts); this is the wiring. Pen
  // only: a highlighter scribbling over text is highlighting it.

  /**
   * Scribble to erase: if the stroke just drawn is a scribble over ink,
   * erase what it covers as one undo step and keep the scribble off the
   * page. False, having done nothing, when it is not a scribble or covers
   * nothing: then it is ink like any other.
   */
  private scribbleErase(box: PageBox, page: Page, pts: number[]): boolean {
    const gestures = penGesturesOf(this.toolState.penGestures);
    if (!gestures.scribbleErase || this.toolState.tool !== "pen") return false;
    const minSize = this.atFitZoom(SCRIBBLE_MIN_PX);
    const scribble = detectScribble(pts, { minSize });
    if (this.debug) {
      const m = measureScribble(pts, { minSize });
      if (m) {
        const verdict = scribble ? "✓" : "✗";
        this.hudLastVerdict = `scribble${verdict} R=${m.reversals} H=${m.hairpins} L=${m.looping.toFixed(2)} ov=${m.overlap.toFixed(2)}`;
        this.scheduleHud();
      }
    }
    if (!scribble) return false;
    // A stroke is covered by its ink, not its centreline: half of both nibs.
    const reach = this.strokeSize() / 2 + this.atFitZoom(SCRIBBLE_MARGIN_PX);
    const b = scribble.bounds;
    const pad = reach + MAX_STROKE_HALF_WIDTH;
    const near = this.strokeIndex.within(page.id, {
      minX: b.minX - pad,
      minY: b.minY - pad,
      maxX: b.maxX + pad,
      maxY: b.maxY + pad,
    });
    const ids = new Set<string>();
    for (const id of near) {
      const stroke = this.strokeIndex.get(id);
      if (!stroke || !scribbleMayErase(stroke, gestures.scribbleErasesAll)) continue;
      const margin = reach + stroke.size / 2;
      if (scribbleCoverage(scribble, stroke.pts, margin) >= SCRIBBLE_COVERAGE) ids.add(id);
    }
    if (ids.size === 0) return false;
    const erased = selectionBounds(
      page.strokes.filter((stroke) => ids.has(stroke.id)),
      [],
      [],
    );
    // A linked word goes whole, never in part.
    for (const id of withLinkedStrokes(page, ids)) ids.add(id);
    this.history.push(this.doc, new RemoveStrokesFromPage(page.id, ids, "Scribble to erase"));
    for (const id of ids) this.strokeIndex.remove(id, page.id);
    if (erased) this.renderer?.invalidateRegion(box.index, erased);
    if (this.debug) this.hud.mark("scribble");
    this.inkChanged([page.id]);
    return true;
  }

  /**
   * Circle to lasso, first half: remember a pen stroke that loops round
   * something on its page, so that holding the pen on it can select that.
   * Anything else forgets the last loop.
   */
  private noteCircleLoop(page: Page, stroke: Stroke, command: Command): void {
    this.circleLoop = null;
    if (!penGesturesOf(this.toolState.penGestures).circleLasso || this.practice) return;
    if (this.toolState.tool !== "pen" || stroke.tool !== "pen") return;
    const loop = gestureLoopOf(stroke.pts, this.atFitZoom(SNAP_CLOSE_TOLERANCE));
    if (!loop) return;
    const candidate = { pageId: page.id, stroke, command, loop };
    if (isEmptySelection(this.enclosedBy(page, loop, stroke))) return;
    this.circleLoop = candidate;
  }

  /** What `loop` encloses on `page`, as far as the lasso's switches allow; never `except`. */
  private enclosedBy(page: Page, loop: readonly number[], except: Stroke): ElementLists {
    const poly = polygonOf(loop);
    if (!poly) return { strokes: [], images: [], textBoxes: [] };
    const filter = lassoFilterFor(this.toolState);
    const near = this.strokeIndex.within(page.id, poly.bounds);
    return {
      strokes: page.strokes.filter(
        (stroke) =>
          stroke !== except &&
          near.has(stroke.id) &&
          lassoTakesStroke(stroke, filter) &&
          strokeInLasso(stroke, poly),
      ),
      images: filter.images
        ? page.images.filter((image) => image.locked !== true && boxInLasso(image, poly))
        : [],
      textBoxes: filter.textBoxes
        ? page.textBoxes.filter((textBox) =>
            boxInLasso(this.textBoxFrameOf(page.id, textBox), poly),
          )
        : [],
    };
  }

  /** A pen went down: if it is on the last loop, a hold there will select what it encloses. */
  private watchCircleHold(box: PageBox, local: Pt): void {
    this.cancelCircleHold();
    const candidate = this.circleLoop;
    const page = this.pageAt(box.index);
    if (!candidate || !page || page.id !== candidate.pageId) return;
    if (!penGesturesOf(this.toolState.penGestures).circleLasso || this.practice) return;
    // Only while the loop is still the latest step: taking it back must undo nothing else.
    if (!this.history.isLatest(candidate.command)) {
      this.circleLoop = null;
      return;
    }
    const reach = candidate.stroke.size / 2 + CIRCLE_HOLD_TOLERANCE_PX / this.unitScale;
    if (!strokeHitByPoint(candidate.stroke, local.x, local.y, reach)) return;
    this.circlePress = { box, at: { x: local.x, y: local.y }, t: now() };
    this.startPress(() => this.circleHeld(true));
  }

  private cancelCircleHold(): void {
    if (!this.circlePress) return;
    this.circlePress = null;
    this.stopPress();
  }

  /**
   * Circle to lasso, second half: the pen was held on the loop. The loop is
   * taken back as if never drawn (it was the latest step, so undo is left
   * as it was before it), what it enclosed is selected, and — while the pen
   * is still down (`drag`) — the selection follows the pen.
   */
  private circleHeld(drag: boolean): void {
    const press = this.circlePress;
    const candidate = this.circleLoop;
    this.circlePress = null;
    this.circleLoop = null;
    if (!press || !candidate) return;
    const page = this.pageAt(press.box.index);
    if (!page || page.id !== candidate.pageId) return;
    // The pen went down to hold, not to write: what it drew so far goes.
    this.endWetStroke();
    if (!this.history.withdraw(this.doc, candidate.command)) return;
    const { stroke } = candidate;
    this.strokeIndex.remove(stroke.id, page.id);
    const drawn = selectionBounds([stroke], [], []);
    if (drawn) this.renderer?.invalidateRegion(press.box.index, drawn);
    this.renderDry();
    this.select(page.id, this.enclosedBy(page, candidate.loop, stroke));
    if (this.debug) {
      this.hud.mark("circle→lasso");
      this.scheduleHud();
    }
    this.changed();
    const sel = this.liveSelection();
    const bounds = sel ? this.groupBounds(sel) : null;
    if (!drag || !sel || !bounds) return;
    this.groupDrag = {
      pointerId: -1,
      selection: sel,
      bounds,
      from: press.at,
      clientX: 0,
      clientY: 0,
      dx: 0,
      dy: 0,
      scale: null,
      turn: null,
      lifted: false,
    };
    this.circleDrag = true;
  }

  /** The pen that held a loop moved: its selection follows, past the same slop as the frame's. */
  private dragCircleSelection(box: PageBox, p: Pt): void {
    const drag = this.groupDrag;
    if (!drag) return;
    const moved = Math.hypot(p.x - drag.from.x, p.y - drag.from.y) * this.unitScale;
    if (!drag.lifted && moved < IMAGE_DRAG_SLOP_PX) return;
    this.moveGroupDrag(drag, box, p);
  }

  /** That pen lifted: the move is one step, as a drag of the frame is. */
  private endCircleDrag(): void {
    this.circleDrag = false;
    this.activePage = null;
    this.endGroupDrag(true);
  }

  // --- The lasso and its selection (0.5) -------------------------------------
  //
  // GoodNotes' lasso: drawn freehand by default, or dragged out as a
  // rectangle; on lift, what the loop encloses (by the switches in the lasso's
  // popover) is selected. A tap selects the one thing on top where it landed.
  // The pure rules live in src/canvas/lasso.ts; every change the selection
  // makes is one command from src/model/selection-commands.ts, one undo step.

  /** Start a lasso on the page the pen went down on, letting go of any selection. */
  private selectStart(box: PageBox, local: Pt): void {
    this.clearSelection();
    this.deselectImage();
    const path = new LassoPath(box, LASSO_SPACING_PX / this.unitScale);
    path.add(local);
    let mode = lassoModeFor(this.toolState);
    let lines: LineBlock[] = [];
    let space: LassoDraft["space"] = null;
    if (mode === "lines") {
      // By line needs a line under the pen; elsewhere it drags a rectangle.
      // From the margin next to a line, it inserts space instead.
      const page = this.pageAt(box.index);
      lines = page ? writingLines(page.backdrop, page.geometry) : [];
      const target = page ? spaceTargetAt(lines, page.geometry.width, local.x, local.y) : null;
      if (lines.length === 0) this.flashReadout("No lines on this page: selecting a rectangle");
      if (target) {
        space = {
          target,
          count: 0,
          plan: null,
          text: "Drag down to insert lines, up to remove empty ones",
        };
        this.flashReadout(space.text);
      } else if (!lineAt(lines, local.x, local.y)) {
        mode = "rect";
        lines = [];
      }
    }
    this.lasso = {
      box,
      mode,
      path,
      origin: { x: local.x, y: local.y },
      to: { x: local.x, y: local.y },
      held: false,
      lines,
      space,
    };
    // Held still, the press opens the Paste / Unlock bar instead.
    this.startPress(() => this.lassoHeld());
  }

  /** The pen moved: extend the loop (clamped to its page) and redraw it. */
  private selectMove(samples: readonly Pt[]): void {
    const lasso = this.lasso;
    const last = samples[samples.length - 1];
    if (!lasso || !last || lasso.held) return;
    const scale = this.unitScale;
    const moved = Math.hypot(last.x - lasso.origin.x, last.y - lasso.origin.y) * scale;
    if (moved > TAP_SLOP_PX) this.stopPress();
    if (lasso.mode === "freehand") for (const sample of samples) lasso.path.add(sample);
    lasso.to = { x: last.x, y: last.y };
    if (lasso.space) {
      this.dragSpace(lasso, lasso.space);
      return;
    }
    const loop = this.lassoLoop(lasso);
    // Drawn rounded off, as GoodNotes draws it; taken on the loop as drawn.
    this.renderer?.renderLasso(
      lasso.box.index,
      lasso.mode === "freehand" ? smoothLoop(loop) : loop,
    );
  }

  /** The lasso's pen stayed put long enough: open the tap-and-hold bar where it is. */
  private lassoHeld(): void {
    const lasso = this.lasso;
    if (!lasso) return;
    lasso.held = true;
    this.renderer?.clearWet();
    this.openPressMenu(lasso.box, lasso.origin);
  }

  /**
   * A finger held still on the page, with any tool: the same bar, where it
   * rests — unless it is the writing hand, a palm or one of two fingers
   * (`finger-hold.ts`), or rests on a text box or a control, which have
   * long presses of their own.
   */
  private fingerHeld(): void {
    const origin = this.fingerHold.origin;
    const veto = this.fingerHold.verdict({
      t: now(),
      lastPenAt: this.pointerInput?.lastPenAt ?? null,
      touches: this.touchCount,
    });
    if (this.debug) this.hud.mark(`hold:${veto ?? "menu"}`);
    if (veto || !origin || !this.fingerTap) return;
    if (this.lasso || this.imageDrag || this.groupDrag || this.cropping) return;
    const under = activeDocument.elementFromPoint(origin.x, origin.y);
    if (onTextBox(under) || isButtonLike(under)) return;
    // The lift is no longer a tap.
    this.fingerTap = null;
    const at = this.toLayout(origin.x, origin.y);
    const box = boxAtPoint(this.pageLayout, at.x, at.y);
    if (box) this.openPressMenu(box, this.toPage(box, at), true);
  }

  private startPress(open: () => void, ms = PRESS_HOLD_MS): void {
    this.stopPress();
    this.pressTimer = window.setTimeout(() => {
      this.pressTimer = 0;
      open();
    }, ms);
  }

  private stopPress(): void {
    if (this.pressTimer) window.clearTimeout(this.pressTimer);
    this.pressTimer = 0;
  }

  /**
   * Open the small bar a tap-and-hold brings up at page point `p`: Unlock
   * when the topmost picture there is locked (GoodNotes' way back to a locked
   * picture), otherwise Paste, Text box and Select all. `provisional` while
   * the finger that held is still down (see {@link PressMenu}).
   */
  private openPressMenu(box: PageBox, p: Pt, provisional = false): void {
    const page = this.pageAt(box.index);
    if (!page) return;
    this.clearSelection();
    this.deselectImage();
    const top = topImageAt(page.images, p, PEN_TAP_TOLERANCE_PX / this.unitScale);
    this.pressMenu = {
      pageId: page.id,
      at: { x: p.x, y: p.y },
      locked: top?.locked === true ? top : null,
      provisional,
    };
    this.syncActionBar();
  }

  private lassoLoop(lasso: LassoDraft): readonly number[] {
    if (lasso.mode === "lines") {
      const span = this.lassoSpan(lasso);
      return span ? spanOutline(lasso.lines[span.block], span) : [];
    }
    return lasso.mode === "rect" ? rectLoop(lasso.origin, lasso.to, lasso.box) : lasso.path.points;
  }

  /**
   * An insert-space drag moved: whole lines from where it started, the strip
   * they open (or close) drawn on the page, and what will happen in the
   * readout, worked out again only when the count of lines changes.
   */
  private dragSpace(lasso: LassoDraft, space: NonNullable<LassoDraft["space"]>): void {
    const block = lasso.lines[space.target.block];
    const count = Math.round((lasso.to.y - lasso.origin.y) / block.pitch);
    if (count === space.count) {
      // Kept up while the pen is down, or the readout would fade mid-drag.
      this.flashReadout(space.text);
      return;
    }
    space.count = count;
    space.plan =
      count === 0
        ? null
        : planInsertSpace(this.doc, lasso.box.index, space.target, count, this.spaceLayout());
    const plan = space.plan;
    const lines = plan?.lines ?? 0;
    if (lines === 0) {
      this.renderer?.clearWet();
      space.text = count < 0 ? "No empty lines to remove here" : "Drag down to insert lines";
      this.flashReadout(space.text);
      return;
    }
    const strip = spaceStrip(block, space.target, lines);
    this.renderer?.renderLasso(lasso.box.index, [
      strip.minX,
      strip.minY,
      strip.maxX,
      strip.minY,
      strip.maxX,
      strip.maxY,
      strip.minX,
      strip.maxY,
    ]);
    space.text = spaceReadout(plan as SpacePlan);
    this.flashReadout(space.text);
  }

  /** How the insert-space planner sees this surface's pages. */
  private spaceLayout(): SpaceLayout {
    return {
      lines: (page) => writingLines(page.backdrop, page.geometry),
      textBoxBounds: (page, textBox) => {
        const f = this.textBoxFrameOf(page.id, textBox);
        return { minX: f.x, minY: f.y, maxX: f.x + f.w, maxY: f.y + f.h };
      },
    };
  }

  /** A by-line lasso's span, from its pen-down to the pen. */
  private lassoSpan(lasso: LassoDraft): LineSpan | null {
    return lineSpan(lasso.lines, lasso.origin, lasso.to);
  }

  /** The pen lifted: a lasso too small to have been drawn was a tap. */
  private selectEnd(): void {
    const lasso = this.lasso;
    this.lasso = null;
    this.activePage = null;
    this.stopPress();
    this.renderer?.clearWet();
    // A held press has opened its bar already; the lift only lets go.
    if (!lasso || lasso.held) return;
    if (lasso.space) {
      // Planned against the document as it is now: nothing else can have
      // changed it while the pen was down, but plan again to be sure.
      const { target, count } = lasso.space;
      const plan =
        count === 0
          ? null
          : planInsertSpace(this.doc, lasso.box.index, target, count, this.spaceLayout());
      if (plan?.command) this.applyCommand(plan.command);
      return;
    }
    const poly = polygonOf(this.lassoLoop(lasso));
    const b = poly?.bounds;
    // A by-line span is a line tall from the start: only the pen's travel says it was drawn.
    const extent =
      lasso.mode === "lines"
        ? Math.hypot(lasso.to.x - lasso.origin.x, lasso.to.y - lasso.origin.y) * this.unitScale
        : b
          ? Math.max(b.maxX - b.minX, b.maxY - b.minY) * this.unitScale
          : 0;
    if (!poly || extent < TAP_SLOP_PX) {
      // With audio replay open, a tap on ink plays it instead of selecting it.
      if (this.offerStrokeTap(lasso.box, lasso.origin, PEN_TAP_TOLERANCE_PX)) this.dropSelection();
      else this.tapSelect(lasso.box, lasso.origin, PEN_TAP_TOLERANCE_PX);
      return;
    }
    if (lasso.mode === "lines") {
      const span = this.lassoSpan(lasso);
      if (span) this.selectOnLines(lasso.box, lasso.lines, span);
      this.keepOutline(this.lassoLoop(lasso));
      return;
    }
    this.selectInside(lasso.box, poly);
    if (lasso.mode !== "rect") this.keepOutline(smoothLoop(this.lassoLoop(lasso)));
  }

  /**
   * Select what lies in a by-line span, as far as the lasso's switches
   * allow: ink by the line it sits on (a comma or a dot with its word),
   * pictures and text boxes by the line their frame sits on.
   */
  private selectOnLines(box: PageBox, blocks: readonly LineBlock[], span: LineSpan): void {
    const page = this.pageAt(box.index);
    if (!page) return;
    const filter = lassoFilterFor(this.toolState);
    const framed = (bounds: Bounds): boolean =>
      inLineSpan(span, lineOfBounds(blocks, bounds), bounds);
    const frameBounds = (f: { x: number; y: number; w: number; h: number }): Bounds => ({
      minX: f.x,
      minY: f.y,
      maxX: f.x + f.w,
      maxY: f.y + f.h,
    });
    this.select(page.id, {
      strokes: linedItems(blocks, page.strokes, strokeBounds)
        .filter((l) => lassoTakesStroke(l.item, filter) && inLineSpan(span, l.line, l.bounds))
        .map((l) => l.item),
      images: filter.images
        ? page.images.filter((image) => image.locked !== true && framed(frameBounds(image)))
        : [],
      textBoxes: filter.textBoxes
        ? page.textBoxes.filter((textBox) =>
            framed(frameBounds(this.textBoxFrameOf(page.id, textBox))),
          )
        : [],
    });
  }

  /** Draw the new selection by the loop that made it (page px), not by a box. */
  private keepOutline(loop: readonly number[]): void {
    const sel = this.liveSelection();
    const bounds = sel ? this.groupBounds(sel) : null;
    if (!sel || !bounds || loop.length < 6) return;
    this.selectionOutline = {
      loop: loop.map((v, i) => v - (i % 2 === 0 ? bounds.minX : bounds.minY)),
      count: sel.strokes.length + sel.images.length + sel.textBoxes.length,
    };
    this.syncSelectionOverlay();
  }

  /** Select what the lasso encloses on its page, as far as its switches allow. */
  private selectInside(box: PageBox, poly: Polygon): void {
    const page = this.pageAt(box.index);
    if (!page) return;
    const filter = lassoFilterFor(this.toolState);
    const near = this.strokeIndex.within(page.id, poly.bounds);
    this.select(page.id, {
      strokes: page.strokes.filter(
        (stroke) =>
          near.has(stroke.id) && lassoTakesStroke(stroke, filter) && strokeInLasso(stroke, poly),
      ),
      // A locked picture is never picked up (until it is unlocked).
      images: filter.images
        ? page.images.filter((image) => image.locked !== true && boxInLasso(image, poly))
        : [],
      textBoxes: filter.textBoxes
        ? page.textBoxes.filter((textBox) =>
            boxInLasso(this.textBoxFrameOf(page.id, textBox), poly),
          )
        : [],
    });
  }

  /**
   * A tap with the lasso selects what is on top where it landed: a text box
   * (typed text sits above the page), else the ink (drawn over pictures),
   * else a picture — as far as the lasso's switches allow. A tap on empty
   * paper selects nothing. `tolerancePx` is how far off it may land, in
   * screen px.
   */
  private tapSelect(box: PageBox, p: Pt, tolerancePx: number): void {
    const tappedPage = this.pageAt(box.index);
    if (tappedPage && this.tapParkedText(tappedPage, p)) return;
    if (tappedPage && this.tapWithHeldText(tappedPage, p)) return;
    this.clearSelection();
    this.deselectImage();
    const page = this.pageAt(box.index);
    if (!page) return;
    const tolerance = tolerancePx / this.unitScale;
    const filter = lassoFilterFor(this.toolState);
    if (filter.textBoxes) {
      const frames = page.textBoxes.map((textBox) => ({
        textBox,
        ...this.textBoxFrameOf(page.id, textBox),
      }));
      const hit = topImageAt(frames, p, tolerance);
      const view = hit ? this.textBoxInputs.get(`${page.id}:${hit.textBox.id}`) : undefined;
      if (hit && view && !this.callbacks.isLocked?.()) {
        // GoodNotes: the lasso edits text. A tap selects the box with its
        // text options beside it; a second tap types, the lasso in hand.
        this.holdTextBox(view, null, true);
        return;
      }
      if (hit) {
        this.select(page.id, { strokes: [], images: [], textBoxes: [hit.textBox] });
        return;
      }
    }
    const stroke = this.strokeAt(page, p, tolerance, filter);
    if (stroke) {
      this.select(page.id, { strokes: [stroke], images: [], textBoxes: [] });
      return;
    }
    // A locked picture is passed over, as if it were part of the paper.
    const unlocked = page.images.filter((candidate) => candidate.locked !== true);
    const image = filter.images ? topImageAt(unlocked, p, tolerance) : null;
    if (image) this.setImageSelection(page.id, image);
  }

  // --- Picking a colour from the page --------------------------------------------

  /**
   * Arm the eyedropper for a colour picker: the next press on the page picks
   * a colour (`../canvas/eyedropper`) and `done` gets it, or `null` when it
   * is cancelled (Escape, the bar's ✕, a press off the page, a tool change).
   * The page does nothing else with that press, and nothing takes focus, so
   * a text box being edited stays edited.
   */
  pickColorFromPage(done: (color: string | null) => void): void {
    this.eyedropper ??= new Eyedropper({
      input: this.scrollEl,
      layer: this.surfaceEl,
      colorAt: (clientX, clientY) => this.eyedropAt(clientX, clientY),
    });
    this.eyedropper.arm(done);
  }

  /** Recolour the selection with a colour of the user's own, remembered as recent. */
  private recolorCustom(color: string): void {
    const recent = pushRecentColor(this.toolState.recentColors ?? [], color);
    this.toolState.recentColors = recent;
    this.callbacks.onRecentColors?.(recent);
    this.recolorSelection(color);
  }

  /** Whether a colour is waiting to be picked from the page. */
  get pickingColor(): boolean {
    return this.eyedropper?.armed === true;
  }

  /**
   * What the eyedropper picks at a client point. Everything there that
   * stores a colour is a candidate, topmost first: the topmost text box's
   * border (when the tap is on it), else its text and its fill, then the
   * ink under them, whatever pen wrote it (typed text sits above the ink,
   * as for the lasso's tap). One candidate is picked as stored; several are
   * told apart by the pixels there, so a tap between the letters of a
   * filled box gives the fill, and ink showing through a box gives the ink.
   * With none (a picture, a PDF page, the paper) the averaged pixels are
   * picked. Pixels come from a light render of the page there, so dark
   * pages never hand back their night colours. `null` off the pages.
   */
  private eyedropAt(clientX: number, clientY: number): EyedropResult | null {
    const at = this.toLayout(clientX, clientY);
    const box = boxAtPoint(this.pageLayout, at.x, at.y);
    const page = box ? this.pageAt(box.index) : null;
    if (!box || !page) return null;
    const p = this.toPage(box, at);
    const reach = EYEDROP_REACH_PX / this.unitScale;
    const candidates: StoredCandidate[] = [];
    for (let i = page.textBoxes.length - 1; i >= 0 && candidates.length === 0; i--) {
      const textBox = page.textBoxes[i];
      const frame = this.textBoxFrameOf(page.id, textBox);
      candidates.push(
        ...textBoxCandidates(
          { ...textBox, ...frame, border: normalizeBorder(textBox.border) },
          p,
          reach,
        ),
      );
    }
    const stroke = this.strokeAt(page, p, reach);
    if (stroke) {
      const alpha = stroke.tool === "highlighter" ? (this.renderer?.highlighterAlpha ?? 1) : 1;
      candidates.push({ color: stroke.color, alpha });
    }
    const sample = (): string | null => {
      if (!this.renderer) return null;
      const level = this.deviceScale;
      const square = eyedropSquare(p.x * level, p.y * level);
      const pixels = this.renderer.samplePage(page, box, square, level, this.inkPressure);
      return pixels ? averagePixels(pixels) : null;
    };
    // Pixels only when they have something to decide.
    const pixel = candidates.length > 0 ? (candidates.length > 1 ? sample() : null) : sample();
    const stored = eyedropColor(nearestStored(candidates, pixel), null);
    // A candidate that is not a colour (a hand-edited note) falls through to the pixels.
    return stored ?? eyedropColor(null, candidates.length === 1 ? sample() : pixel);
  }

  /** The topmost stroke whose ink passes within `tolerance` of a page point. */
  private strokeAt(
    page: Page,
    p: { x: number; y: number },
    tolerance: number,
    filter?: LassoFilter,
  ): Stroke | null {
    let best: Stroke | null = null;
    let bestIndex = -1;
    const candidates = this.strokeIndex.near(page.id, p.x, p.y, tolerance + MAX_STROKE_HALF_WIDTH);
    for (const id of candidates) {
      const stroke = this.strokeIndex.get(id);
      if (!stroke || (filter && !lassoTakesStroke(stroke, filter))) continue;
      const hit =
        strokeHitByPoint(stroke, p.x, p.y, stroke.size / 2 + tolerance) ||
        strokeFillHit(stroke, p.x, p.y);
      if (!hit) continue;
      const index = page.strokes.indexOf(stroke);
      if (index > bestIndex) {
        best = stroke;
        bestIndex = index;
      }
    }
    return best;
  }

  /**
   * Offer a tap on ink at page point `p` to the host's stroke-tap handler.
   * True when there is a handler, the tap landed on a stroke, and the
   * handler took it.
   */
  private offerStrokeTap(box: PageBox, p: { x: number; y: number }, tolerancePx: number): boolean {
    const handler = this.strokeTapHandler;
    const page = handler ? this.pageAt(box.index) : null;
    if (!handler || !page) return false;
    const stroke = this.strokeAt(page, p, tolerancePx / this.unitScale);
    return stroke !== null && handler(page, stroke);
  }

  /**
   * Make a selection on one page: nothing, one picture on its own (it keeps
   * its resize and rotate handles), or the group frame for anything else.
   */
  private select(pageId: string, elements: ElementLists): void {
    this.clearSelection();
    this.deselectImage();
    const { strokes, textBoxes } = elements;
    const images = elements.images.filter((image) => image.locked !== true);
    if (isEmptySelection({ strokes, images, textBoxes })) return;
    if (this.toolState.tool === "select") this.selectionToolUsed = true;
    if (strokes.length === 0 && textBoxes.length === 0 && images.length === 1) {
      this.setImageSelection(pageId, images[0]);
      return;
    }
    // A box being typed in stops being edited before it can be moved.
    const editing = this.editingTextView();
    const live = editing ? this.liveTextBox(editing.pageId, editing.id) : undefined;
    if (live && textBoxes.includes(live)) this.blurTextBox();
    this.selection = {
      pageId,
      strokes: [...strokes],
      images: [...images],
      textBoxes: [...textBoxes],
    };
    this.syncSelectionOverlay();
  }

  /**
   * The selection, as far as it is still on its page. Undo, a reload or a
   * host command can take elements away; what is gone is dropped here, and
   * a selection with nothing left is no selection.
   */
  private liveSelection(): GroupSelection | null {
    const sel = this.selection;
    if (!sel) return null;
    const page = this.doc.pages.find((candidate) => candidate.id === sel.pageId);
    const on = page ? elementsOnPage(page, sel) : null;
    this.selection = on && !isEmptySelection(on) ? { pageId: sel.pageId, ...on } : null;
    return this.selection;
  }

  /** Let go of the lasso selection, if any, and of the tap-and-hold bar. */
  private clearSelection(): void {
    this.cancelGroupDrag();
    const pressed = this.pressMenu !== null;
    this.pressMenu = null;
    this.selectionOutline = null;
    if (!this.selection) {
      if (pressed) this.syncActionBar();
      return;
    }
    this.selection = null;
    this.syncSelectionOverlay();
  }

  /** Let go of everything: a lasso being drawn, and either kind of selection. */
  private dropSelection(): void {
    if (this.lasso) {
      this.lasso = null;
      this.renderer?.clearWet();
    }
    this.stopPress();
    this.clearSelection();
    this.deselectImage();
  }

  /** A text box's frame in page space; an auto-height box is measured where it is shown. */
  private textBoxFrameOf(pageId: string, textBox: TextBoxElement): BoxFrame {
    const view = this.textBoxInputs.get(`${pageId}:${textBox.id}`);
    const measured = view
      ? view.root.offsetHeight / this.unitScale
      : textBox.fontSize * lineHeightOf(textBox) + 2 * textInset(textBox).y;
    return textBoxFrame(textBox, measured);
  }

  /** Bounds of everything in a selection, page space. */
  private groupBounds(sel: GroupSelection): Bounds | null {
    return selectionBounds(
      sel.strokes,
      sel.images,
      sel.textBoxes.map((textBox) => this.textBoxFrameOf(sel.pageId, textBox)),
    );
  }

  /** How far a lasso drag has carried an element of `pageId`, page px; zero otherwise. */
  private dragShift(pageId: string, textBox: TextBoxElement): Pt {
    const drag = this.groupDrag;
    if (!drag?.lifted || drag.selection.pageId !== pageId) return { x: 0, y: 0 };
    if (!drag.selection.textBoxes.includes(textBox)) return { x: 0, y: 0 };
    const turn = drag.turn;
    if (turn) {
      // A box stays upright: only its middle goes round.
      const f = this.textBoxFrameOf(pageId, textBox);
      const c = { x: f.x + f.w / 2, y: f.y + f.h / 2 };
      const motion: Reorientation = { kind: "rotate", angle: turn.angle };
      const to = reorientPoint(motion, turn.centre.x, turn.centre.y, c.x, c.y);
      return { x: to.x - c.x, y: to.y - c.y };
    }
    const scale = drag.scale;
    if (!scale) return { x: drag.dx, y: drag.dy };
    // A resize carries the box's corner away from the anchor (its size is a transform).
    return {
      x: (textBox.x - scale.anchor.x) * (scale.k - 1),
      y: (textBox.y - scale.anchor.y) * (scale.k - 1),
    };
  }

  /**
   * Where a lasso drag has the selection's bounds now, page space. A turn
   * leaves them where they were: the frame turns with the selection instead.
   */
  private draggedBounds(drag: GroupDrag): Bounds {
    if (drag.turn) return drag.bounds;
    return drag.scale
      ? scaleBounds(drag.bounds, drag.scale.anchor, drag.scale.k)
      : shiftBounds(drag.bounds, drag.dx, drag.dy);
  }

  /** The part of the paper element on screen, in its own (scaled layout) px. */
  private visiblePaperRect(): Bounds {
    const top = this.scroller.position.y;
    return {
      minX: -this.offsetX,
      minY: top,
      maxX: this.cssW - this.offsetX,
      maxY: top + this.cssH,
    };
  }

  /** Put the selection's dashed frame where it is (or where a drag has it), and its bar. */
  private syncSelectionOverlay(): void {
    const sel = this.liveSelection();
    const box = sel ? this.boxForPage(sel.pageId) : null;
    const drag = this.groupDrag?.lifted ? this.groupDrag : null;
    const bounds = sel && box ? (drag ? this.draggedBounds(drag) : this.groupBounds(sel)) : null;
    this.selectionFrameEl.toggleClass("is-hidden", !box || !bounds);
    if (box && bounds) {
      const scale = this.unitScale;
      const x = (box.x + bounds.minX) * scale - SELECTION_PAD_PX;
      const y = (box.y + bounds.minY) * scale - SELECTION_PAD_PX;
      this.selectionFrameEl.setCssStyles({
        left: `${x}px`,
        top: `${y}px`,
        width: `${(bounds.maxX - bounds.minX) * scale + 2 * SELECTION_PAD_PX}px`,
        height: `${(bounds.maxY - bounds.minY) * scale + 2 * SELECTION_PAD_PX}px`,
      });
      this.selectionFrameEl.toggleClass("is-dragging", drag !== null);
      // While the knob turns it, the frame turns with the selection about its middle.
      const angle = drag?.turn?.angle ?? 0;
      this.selectionFrameEl.setCssStyles({ transform: angle !== 0 ? `rotate(${angle}rad)` : "" });
      // The loop that made the selection, while it is still those elements.
      const outline = this.selectionOutline;
      const count = sel ? sel.strokes.length + sel.images.length + sel.textBoxes.length : 0;
      const shown = outline !== null && outline.count === count;
      this.selectionFrameEl.toggleClass("has-outline", shown);
      if (shown) {
        // The loop is relative to the bounds' corner, so a resize scales it too.
        const k = drag?.scale?.k ?? 1;
        const at = (v: number): string => (SELECTION_PAD_PX + v * k * scale).toFixed(1);
        const pts = outline.loop;
        let d = `M${at(pts[0])} ${at(pts[1])}`;
        for (let i = 2; i + 1 < pts.length; i += 2) d += `L${at(pts[i])} ${at(pts[i + 1])}`;
        this.selectionPathEl.setAttribute("d", `${d}Z`);
      }
    }
    this.syncActionBar();
  }

  /**
   * Show the action bar over whatever there is — a picture being cropped, a
   * lasso selection, a lone picture, or the spot a tap-and-hold opened — with
   * the entries that fit it, or hide it. Hidden while a selection is dragged.
   */
  private syncActionBar(): void {
    const crop = this.cropping;
    const group = crop ? null : this.liveSelection();
    const image = crop || group ? null : this.liveImageSelection();
    const press = crop || group || image ? null : this.pressMenu;
    const pageId = crop?.pageId ?? group?.pageId ?? image?.pageId ?? press?.pageId ?? "";
    const box = this.boxForPage(pageId);
    const dragging = this.groupDrag?.lifted === true || this.imageDrag?.lifted === true;
    let bounds: Bounds | null = null;
    let clearAbove = SELECTION_PAD_PX;
    let clearBelow = SELECTION_PAD_PX;
    if (crop) {
      bounds = imageBounds(crop.full);
      clearAbove = clearBelow = IMAGE_CHROME_CLEAR_PX;
      this.actionBar.setActions(this.cropActions(crop));
    } else if (group) {
      bounds = this.groupChromeBounds(group);
      // Clear of the corner handles on the frame, as of a picture's.
      clearAbove = clearBelow = SELECTION_PAD_PX + IMAGE_CHROME_CLEAR_PX;
      this.actionBar.setActions(this.groupActions(group));
    } else if (image) {
      // The picture and its rotate knob, wherever a turn has put the knob.
      bounds = this.imageChromeBounds(image.image);
      clearAbove = clearBelow = IMAGE_CHROME_CLEAR_PX;
      this.actionBar.setActions(this.imageActions(image));
    } else if (press) {
      bounds = { minX: press.at.x, minY: press.at.y, maxX: press.at.x, maxY: press.at.y };
      // Clear of the pen tip or the fingertip resting on that spot.
      clearAbove = clearBelow = PRESS_CLEAR_PX;
      this.actionBar.setActions(this.pressActions(press));
    }
    this.actionBar.el.toggleClass("is-provisional", press?.provisional === true);
    if (!box || !bounds || dragging) {
      this.actionBar.hide();
      return;
    }
    const scale = this.unitScale;
    const anchor: Bounds = {
      minX: (box.x + bounds.minX) * scale,
      minY: (box.y + bounds.minY) * scale,
      maxX: (box.x + bounds.maxX) * scale,
      maxY: (box.y + bounds.maxY) * scale,
    };
    this.actionBar.show(anchor, this.visiblePaperRect(), { clearAbove, clearBelow });
  }

  /**
   * What a lasso selection's chrome covers, page space: its bounds, reaching
   * down to the rotate knob (less the frame's pad, which the bar adds back).
   */
  private groupChromeBounds(sel: GroupSelection): Bounds | null {
    const bounds = this.groupBounds(sel);
    if (!bounds) return null;
    const scale = this.unitScale;
    const knob = selectionKnobPoint(this.selectionFrameOf(bounds), ROTATE_HANDLE_OFFSET_PX / scale);
    const r = ROTATE_KNOB_RADIUS_PX / scale;
    return { ...bounds, maxY: Math.max(bounds.maxY, knob.y + r - SELECTION_PAD_PX / scale) };
  }

  /** What a lone picture's chrome covers, page space: the rotated picture and its knob. */
  private imageChromeBounds(image: ImageElement): Bounds {
    const drag = this.imageDrag;
    const t = drag && drag.image === image ? drag.draft : transformOf(image);
    const scale = this.unitScale;
    const b = imageBounds(t);
    const knob = rotateHandlePoint(t, ROTATE_HANDLE_OFFSET_PX / scale);
    const r = ROTATE_KNOB_RADIUS_PX / scale;
    return {
      minX: Math.min(b.minX, knob.x - r),
      minY: Math.min(b.minY, knob.y - r),
      maxX: Math.max(b.maxX, knob.x + r),
      maxY: Math.max(b.maxY, knob.y + r),
    };
  }

  /**
   * A lone picture's bar and "…" menu, as GoodNotes has them (Joost's
   * screenshots): the bar is Crop | Cut · Duplicate · Delete · "…"; the menu
   * has Cut · Front · Back across the top, then Copy · Duplicate · Paste ·
   * Lock image, Crop image, and Delete at the foot. Front and Back stack the
   * pictures among themselves — ink and text always stay above every picture.
   */
  private imageActions(sel: { pageId: string; image: ImageElement }): SelectionAction[] {
    const page = this.doc.pages.find((candidate) => candidate.id === sel.pageId);
    const can = (to: ImageLayer): boolean =>
      page !== undefined && canReorderImage(page, sel.image, to);
    return [
      {
        id: "crop",
        icon: "crop",
        label: "Crop",
        group: "crop",
        bar: true,
        menu: "none",
        run: () => this.startCrop(),
      },
      {
        id: "cut",
        icon: "scissors",
        label: "Cut",
        group: "edit",
        bar: true,
        menu: "tile",
        run: () => this.cutSelection(),
      },
      {
        id: "front",
        icon: "bring-to-front",
        label: "Front",
        group: "edit",
        menu: "tile",
        enabled: can("front"),
        run: () => this.reorderSelectedImage("front"),
      },
      {
        id: "back",
        icon: "send-to-back",
        label: "Back",
        group: "edit",
        menu: "tile",
        enabled: can("back"),
        run: () => this.reorderSelectedImage("back"),
      },
      { id: "copy", icon: "copy", label: "Copy", group: "edit", run: () => this.copySelection() },
      {
        id: "duplicate",
        icon: "copy-plus",
        label: "Duplicate",
        group: "edit",
        bar: true,
        run: () => this.duplicateSelectedImage(),
      },
      this.pasteAction(sel.pageId),
      {
        id: "lock",
        icon: "lock",
        label: "Lock image",
        group: "edit",
        run: () => this.lockSelectedImage(),
      },
      {
        id: "crop-image",
        icon: "crop",
        label: "Crop image",
        group: "crop-image",
        run: () => this.startCrop(),
      },
      ...flipActions((axis) => this.flipSelectedImage(axis)),
      {
        id: "delete",
        icon: "trash-2",
        label: "Delete",
        group: "edit",
        menuGroup: "delete",
        bar: true,
        destructive: true,
        run: () => this.deleteSelectedImage(),
      },
    ];
  }

  /**
   * The bar for a lasso selection: Cut · Duplicate · Delete · "…"; the menu
   * has Copy · Duplicate · Paste, Colour when it holds ink, and Delete.
   */
  private groupActions(sel: GroupSelection): SelectionAction[] {
    const actions: SelectionAction[] = [
      {
        id: "cut",
        icon: "scissors",
        label: "Cut",
        group: "edit",
        bar: true,
        menu: "none",
        run: () => this.cutSelection(),
      },
      { id: "copy", icon: "copy", label: "Copy", group: "edit", run: () => this.copySelection() },
      {
        id: "duplicate",
        icon: "copy-plus",
        label: "Duplicate",
        group: "edit",
        bar: true,
        run: () => this.duplicateSelection(),
      },
      this.pasteAction(sel.pageId),
    ];
    if (sel.strokes.length > 0) {
      const first = sel.strokes[0].color;
      actions.push({
        id: "colour",
        icon: "palette",
        label: "Colour",
        group: "style",
        swatches: {
          // The palette, then the custom colours picked lately anywhere.
          colors: [
            ...this.palette,
            ...(this.toolState.recentColors ?? []).filter(
              (color) => !this.palette.some((p) => sameColor(p, color)),
            ),
          ],
          current: sel.strokes.every((stroke) => stroke.color === first) ? first : null,
          pick: (color) => this.recolorSelection(color),
          custom: (color) => this.recolorCustom(color),
          // The selection stays while the page is tapped: the eyedropper takes that press.
          eyedropper: () =>
            this.pickColorFromPage((color) => {
              if (color) this.recolorCustom(color);
            }),
        },
      });
    }
    actions.push(...this.shapeStyleActions(sel.strokes));
    const heading = this.groupBounds(sel);
    const index = this.doc.pages.findIndex((page) => page.id === sel.pageId);
    // Highlighter ink over a PDF's text: the text it covers can be copied.
    const highlighted = sel.strokes.some(isHighlight)
      ? this.highlightedText(index, sel.strokes)
      : null;
    if (highlighted) {
      actions.push({
        id: "copy-text",
        icon: "type",
        label: "Copy text",
        group: "edit",
        run: () => this.copyText(highlighted),
      });
    }
    actions.push(...this.linkActions(sel, index));
    actions.push(...flipActions((axis) => this.flipSelection(axis)));
    if (heading && index >= 0 && this.callbacks.onAddSection) {
      const add = this.callbacks.onAddSection;
      actions.push({
        id: "contents",
        icon: "list-plus",
        label: "Add to contents",
        group: "contents",
        run: () => {
          const at = { x: heading.minX, y: (heading.minY + heading.maxY) / 2 };
          this.clearSelection();
          add(
            index,
            at,
            sel.strokes.map((stroke) => stroke.id),
          );
        },
      });
    }
    actions.push({
      id: "delete",
      icon: "trash-2",
      label: "Delete",
      group: "edit",
      menuGroup: "delete",
      bar: true,
      destructive: true,
      run: () => this.deleteSelection(),
    });
    return actions;
  }

  /**
   * Link to… for selected ink; with ink that is in one link, Open link and
   * Remove link as well.
   */
  private linkActions(sel: GroupSelection, index: number): SelectionAction[] {
    const page = this.doc.pages[index];
    const ask = this.callbacks.onLinkStrokes;
    if (!page || !ask || sel.strokes.length === 0) return [];
    const ids = sel.strokes.map((stroke) => stroke.id);
    const links = linksOf(page, ids);
    const one = links.length === 1 ? links[0] : null;
    const actions: SelectionAction[] = [
      {
        id: "link",
        icon: "link",
        label: one ? "Change link" : "Link to…",
        group: "link",
        run: () => {
          this.clearSelection();
          ask(index, ids, one?.target ?? null);
        },
      },
    ];
    const open = this.callbacks.onOpenLink;
    if (one && open) {
      actions.push({
        id: "open-link",
        icon: "external-link",
        label: "Open link",
        group: "link",
        bar: true,
        run: () => open(one.target),
      });
    }
    if (links.length > 0) {
      actions.push({
        id: "unlink",
        icon: "unlink",
        label: "Remove link",
        group: "link",
        run: () => {
          const commands = linkStrokes(this.doc, page, ids, null);
          if (commands.length > 0) this.applyCommand(new CompositeCommand("Remove link", commands));
        },
      });
    }
    return actions;
  }

  /** Paste, greyed while the clipboard holds nothing this surface can show. */
  private pasteAction(pageId: string, at?: Pt): SelectionAction {
    return {
      id: "paste",
      icon: "clipboard-paste",
      label: "Paste",
      group: "edit",
      enabled: clipboard.canPaste(this.imagesShown),
      run: () => {
        this.paste({ pageId, at });
      },
    };
  }

  /** Crop mode's bar: Cancel · Reset | Done, in words. */
  private cropActions(session: CropSession): SelectionAction[] {
    return [
      {
        id: "crop-cancel",
        icon: "x",
        label: "Cancel",
        group: "crop",
        bar: true,
        menu: "none",
        showLabel: true,
        run: () => this.endCrop(false),
      },
      {
        id: "crop-reset",
        icon: "rotate-ccw",
        label: "Reset",
        group: "crop",
        bar: true,
        menu: "none",
        showLabel: true,
        enabled: !isFullCrop(session.crop),
        run: () => this.resetCrop(),
      },
      {
        id: "crop-done",
        icon: "check",
        label: "Done",
        group: "done",
        bar: true,
        menu: "none",
        showLabel: true,
        run: () => this.endCrop(true),
      },
    ];
  }

  /** A tap-and-hold's bar: Unlock on a locked picture, else Paste. */
  private pressActions(press: PressMenu): SelectionAction[] {
    const locked = press.locked;
    if (locked) {
      return [
        {
          id: "unlock",
          icon: "lock-open",
          label: "Unlock",
          group: "press",
          bar: true,
          menu: "none",
          showLabel: true,
          run: () => this.unlockImage(press.pageId, locked),
        },
      ];
    }
    const page = this.doc.pages.find((candidate) => candidate.id === press.pageId);
    const inBar = { bar: true, menu: "none", showLabel: true } as const;
    const actions: SelectionAction[] = [
      {
        id: "paste",
        icon: "clipboard-paste",
        label: "Paste",
        group: "press",
        ...inBar,
        enabled: this.canPasteHere(),
        run: () => this.pasteHere(press.pageId, press.at),
      },
    ];
    // A practice file takes the pen alone (`practice.ts`).
    if (this.practice) return actions;
    actions.push(
      {
        id: "text-here",
        icon: "type",
        label: "Text box",
        group: "press-text",
        ...inBar,
        run: () => this.textBoxHere(press.pageId, press.at),
      },
      {
        id: "select-page",
        icon: "box-select",
        label: "Select all",
        group: "press-select",
        ...inBar,
        enabled: page !== undefined && !isEmptySelection(selectablesOf(page)),
        run: () => {
          if (page) this.select(page.id, selectablesOf(page));
        },
      },
    );
    return actions;
  }

  /**
   * Whether the press menu's Paste can have anything: the plugin's
   * clipboard holds something, or the system's can be read (what it holds
   * is only known once it is, which on iPad asks the user first).
   */
  private canPasteHere(): boolean {
    if (clipboard.canPaste(this.imagesShown)) return true;
    return !this.practice && canReadSystemClipboard();
  }

  /**
   * The press menu's Paste, at page point `at` (`paste-choice.ts`): the
   * plugin's clipboard when nothing newer can be on the system's, else a
   * picture or text from the system clipboard, else the plugin's after all.
   * Runs inside the tap, which the system clipboard's read requires.
   */
  private pasteHere(pageId: string, at: Pt): void {
    const ink = clipboard.canPaste(this.imagesShown);
    if (this.practice || inkFirst(ink, clipboard.leftSinceCopy) || !canReadSystemClipboard()) {
      if (!this.paste({ pageId, at }) && !ink) new Notice("FineNotes: nothing to paste.");
      return;
    }
    void readSystemClipboard().then((found) => {
      const index = this.doc.pages.findIndex((page) => page.id === pageId);
      if (index < 0 || this.callbacks.isLocked?.()) return;
      const onImage = this.imagesShown ? this.callbacks.onPasteImage : undefined;
      if (found.kind === "image" && onImage) {
        onImage(found.file, { pageIndex: index, x: at.x, y: at.y });
        return;
      }
      if (found.kind === "text") {
        this.addPastedText(index, at, found.text);
        return;
      }
      if (this.paste({ pageId, at })) return;
      new Notice(
        found.kind === "unavailable"
          ? "FineNotes: couldn't read the clipboard here."
          : "FineNotes: nothing to paste.",
      );
    });
  }

  /** Text from the system clipboard as a new text box at `at`, selected: one undo step. */
  private addPastedText(index: number, at: Pt, text: string): void {
    const page = this.pageAt(index);
    if (!page) return;
    const origin = pastedTextOrigin(at, page.geometry);
    const textBox: TextBoxElement = {
      id: this.textBoxIds.next(),
      x: origin.x,
      y: origin.y,
      w: TEXT_MIN_W,
      fit: true,
      text,
      ...textStyleOf(this.toolState.textStyle ?? DEFAULT_TEXT_STYLE),
    };
    this.dropSelection();
    this.history.push(this.doc, new AddTextBoxToPage(page.id, textBox));
    this.syncTextBoxes();
    this.select(page.id, { strokes: [], images: [], textBoxes: [textBox] });
    this.changed();
  }

  /** The press menu's Text box: a new, empty box at `at`, focused for typing, as the Text tool's tap makes. */
  private textBoxHere(pageId: string, at: Pt): void {
    if (this.callbacks.isLocked?.()) return;
    const box = this.boxForPage(pageId);
    if (!box) return;
    this.clearSelection();
    const x = clamp(at.x, 0, Math.max(0, box.width - TEXT_MIN_W));
    // Inside the tap, so iPadOS raises the keyboard for the focus.
    this.addTextBox(box, { x, y: at.y, w: TEXT_MIN_W, fit: true });
  }

  /** Delete everything selected, as one undo step. */
  private deleteSelection(): void {
    if (this.callbacks.isLocked?.()) return;
    if (this.removeSelection("Delete selection")) this.selectionTakenAway();
  }

  /**
   * Take the lasso selection off its page as one undo step. A locked picture
   * is never taken: it cannot be selected, and this makes sure.
   */
  private removeSelection(label: string): boolean {
    const sel = this.liveSelection();
    if (!sel) return false;
    const box = this.boxForPage(sel.pageId);
    const bounds = this.groupBounds(sel);
    const elements: PageElements = {
      strokes: sel.strokes,
      images: sel.images.filter((image) => image.locked !== true),
      textBoxes: sel.textBoxes,
    };
    this.clearSelection();
    this.history.push(this.doc, new RemoveElements(sel.pageId, elements, label));
    if (box && bounds) this.renderer?.invalidateRegion(box.index, bounds);
    this.strokeIndex.refreshPages(this.doc.pages, [sel.pageId]);
    this.renderDry();
    this.syncTextBoxes();
    this.changed([sel.pageId]);
    return true;
  }

  // --- Cut, Copy and Paste (0.5) ---------------------------------------------
  //
  // One clipboard for the whole window (`clipboard` above), holding deep
  // copies; a paste is one `AddElements` of fresh copies with fresh ids,
  // selected. Where a paste lands is `pastePlacement`'s rule
  // (src/model/clipboard.ts): where it was when that spot is on screen and
  // free, stepping 24 px down and right past copies already there, else
  // centred in view — or on the spot a tap-and-hold opened the bar.

  /** Whether anything is selected that Cut or Copy could take. */
  private hasSelection(): boolean {
    return this.liveSelection() !== null || this.liveImageSelection() !== null;
  }

  /** Copy the selection. A lone picture is offered to the host for the system clipboard too. */
  private copySelection(): boolean {
    const group = this.liveSelection();
    if (group) {
      const bounds = this.groupBounds(group);
      if (!bounds) return false;
      clipboard.put(
        {
          strokes: group.strokes,
          images: group.images.filter((image) => image.locked !== true),
          textBoxes: group.textBoxes,
        },
        bounds,
      );
      this.syncActionBar();
      return true;
    }
    const sel = this.liveImageSelection();
    if (!sel) return false;
    clipboard.put(
      { strokes: [], images: [sel.image], textBoxes: [] },
      imageBounds(transformOf(sel.image)),
    );
    this.callbacks.onCopyImage?.(sel.image);
    this.syncActionBar();
    return true;
  }

  /** Copy the selection, then take it off the page — one undo step, which puts it back. */
  private cutSelection(): void {
    if (this.callbacks.isLocked?.() || !this.copySelection()) return;
    if (this.liveSelection()) {
      if (this.removeSelection("Cut")) this.selectionTakenAway();
      return;
    }
    const sel = this.liveImageSelection();
    if (!sel) return;
    this.applyCommand(
      new RemoveElements(sel.pageId, { strokes: [], images: [sel.image], textBoxes: [] }, "Cut"),
    );
    this.selectionTakenAway();
  }

  /**
   * Paste the clipboard onto a page, selected, as one undo step: the page
   * `target` names, else the selection's, else the one in view; centred on
   * `target.at` when given. Pictures are left out while this surface does
   * not show them (no image painter set). Returns whether anything was pasted.
   */
  private paste(target: { pageId?: string; at?: Pt } = {}): boolean {
    const entry = clipboard.content;
    if (!entry || !clipboard.canPaste(this.imagesShown)) return false;
    if (this.callbacks.isLocked?.()) return false;
    const pageId =
      target.pageId ?? this.liveSelection()?.pageId ?? this.liveImageSelection()?.pageId;
    let index = pageId ? this.doc.pages.findIndex((page) => page.id === pageId) : -1;
    if (index < 0) index = this.pageIndex;
    const page = this.pageAt(index);
    const box = this.pageLayout.boxes[index];
    if (!page || !box) return false;
    const withImages = this.imagesShown;
    const held: PageElements = {
      strokes: entry.elements.strokes,
      images: withImages ? entry.elements.images : [],
      textBoxes: entry.elements.textBoxes,
    };
    const d = pastePlacement({
      bounds: entry.bounds,
      page: page.geometry,
      visible: this.visibleRegion(index),
      at: target.at ?? null,
      taken: (dx, dy) => sameSpotTaken(page, held, dx, dy),
    });
    const copies = pasteCopies(entry, this.freshIds(), d.dx, d.dy, withImages);
    this.dropSelection();
    this.history.push(this.doc, new AddElements(page.id, copies, "Paste"));
    this.renderer?.invalidateRegion(box.index, shiftBounds(entry.bounds, d.dx, d.dy));
    this.strokeIndex.refreshPages(this.doc.pages, [page.id]);
    this.renderDry();
    this.syncTextBoxes();
    this.select(page.id, copies);
    this.changed([page.id]);
    return true;
  }

  /** Fresh ids for copies placed in this document. */
  private freshIds(): IdSource {
    let imageSeq = Number(nextImageId(this.doc).slice(1)) - 1;
    return {
      stroke: () => this.strokeIds.next(),
      image: () => `i${++imageSeq}`,
      textBox: () => this.textBoxIds.next(),
    };
  }

  /** Cmd/Ctrl + C, X or V on the page. Returns whether it was taken. */
  private clipboardKey(event: KeyboardEvent): boolean {
    const key = event.key.toLowerCase();
    if (key === "c" || key === "x") {
      if (this.cropping || !this.hasSelection()) return false;
      event.preventDefault();
      if (key === "c") this.copySelection();
      else this.cutSelection();
      return true;
    }
    if (key !== "v" || this.cropping) return false;
    // Not prevented: the browser's paste event follows, and may carry a
    // picture from another app (`handlePaste`). Where none comes — WebKit
    // sends none while nothing editable has focus — paste our own.
    window.clearTimeout(this.pasteTimer);
    this.pasteTimer = window.setTimeout(() => {
      this.pasteTimer = 0;
      this.paste();
    }, PASTE_EVENT_WAIT_MS);
    return true;
  }

  /**
   * A paste event reached the host. The plugin's clipboard is pasted — unless
   * the system clipboard holds a picture or text and is likely the fresher of
   * the two (the plugin's is empty, the app was left since it was filled, or
   * FineNotes copied text since); then a picture goes to the host's
   * `onPasteImage`, and text becomes a text box on the page in view. Text
   * fields keep their own pastes. Returns whether the paste was taken.
   */
  handlePaste(event: ClipboardEvent): boolean {
    window.clearTimeout(this.pasteTimer);
    this.pasteTimer = 0;
    if (isEditable(event.target) || this.editingTextView() || this.cropping) return false;
    // A protected note refuses the paste once (its host says why), whichever
    // clipboard it would have come from.
    if (this.callbacks.isLocked?.()) {
      event.preventDefault();
      return true;
    }
    const onImage = this.imagesShown && !this.practice ? this.callbacks.onPasteImage : undefined;
    const file = onImage ? imageFileOf(event.clipboardData) : null;
    const text = this.practice
      ? ""
      : cleanPastedText(event.clipboardData?.getData("text/plain") ?? "");
    const systemFirst =
      (file !== null || text !== "") &&
      (clipboard.leftSinceCopy || !clipboard.canPaste(this.imagesShown));
    if (!systemFirst && this.paste()) {
      event.preventDefault();
      return true;
    }
    if (file && onImage) {
      event.preventDefault();
      onImage(file);
      return true;
    }
    // Text, as the press menu's Paste takes it: a text box in the middle of
    // the page in view.
    const region = text ? this.visibleRegion(this.pageIndex) : null;
    if (region) {
      event.preventDefault();
      const at = { x: (region.minX + region.maxX) / 2, y: (region.minY + region.maxY) / 2 };
      this.addPastedText(this.pageIndex, at, text);
      return true;
    }
    return false;
  }

  // --- A picture's order, lock and crop (0.5) ---------------------------------

  /** Bring the selected picture to the front of the page's pictures, or send it to the back. */
  /** Mirror the selected picture in its own frame; it stays selected, its box unchanged. */
  private flipSelectedImage(axis: FlipAxis): void {
    const sel = this.liveImageSelection();
    if (!sel || this.callbacks.isLocked?.()) return;
    this.history.push(this.doc, new FlipImage(sel.pageId, sel.image, axis));
    const box = this.boxForPage(sel.pageId);
    if (box) this.renderer?.invalidateRegion(box.index, imageBounds(transformOf(sel.image)));
    this.renderDry();
    this.syncActionBar();
    this.changed();
  }

  private reorderSelectedImage(to: ImageLayer): void {
    const sel = this.liveImageSelection();
    const page = sel ? this.doc.pages.find((candidate) => candidate.id === sel.pageId) : null;
    if (!sel || !page || !canReorderImage(page, sel.image, to)) return;
    if (this.callbacks.isLocked?.()) return;
    this.history.push(this.doc, new ReorderImage(sel.pageId, sel.image, to));
    // The order only shows where the picture overlaps others: its own box.
    const box = this.boxForPage(sel.pageId);
    if (box) this.renderer?.invalidateRegion(box.index, imageBounds(transformOf(sel.image)));
    this.renderDry();
    this.syncActionBar();
    this.changed();
  }

  /**
   * Lock the selected picture. It lets go of the selection, and the lasso
   * passes it over until a tap-and-hold on it offers Unlock.
   */
  private lockSelectedImage(): void {
    const sel = this.liveImageSelection();
    if (!sel || this.callbacks.isLocked?.()) return;
    this.deselectImage();
    this.history.push(this.doc, new SetImageLocked(sel.pageId, sel.image, true));
    this.syncLockBadges();
    this.changed();
    new Notice("FineNotes: image locked. To unlock it, hold the lasso on it.");
  }

  /** Unlock a picture from the tap-and-hold bar, and select it. */
  private unlockImage(pageId: string, image: ImageElement): void {
    const page = this.doc.pages.find((candidate) => candidate.id === pageId);
    if (!page?.images.includes(image) || this.callbacks.isLocked?.()) return;
    this.clearSelection();
    this.history.push(this.doc, new SetImageLocked(pageId, image, false));
    this.syncLockBadges();
    this.setImageSelection(pageId, image);
    this.changed();
  }

  /**
   * A small lock on each locked picture while the lasso is the tool — the one
   * tool that would otherwise pick it up — so a lock can be found without
   * cluttering the page the rest of the time. The badges take no presses.
   */
  /**
   * The by-line lasso's markers: while it is the lasso type, a column of
   * them in the margin of every block of lines, one level with each line.
   */
  private syncSpaceHandles(): void {
    // Not built yet (the first change can come from the constructor's load).
    if (!this.spaceHandlesEl || !this.pageLayout) return;
    let used = 0;
    if (this.toolState.tool === "select" && lassoModeFor(this.toolState) === "lines") {
      const scale = this.unitScale;
      for (const box of this.pageLayout.boxes) {
        const page = this.pageAt(box.index);
        if (!page) continue;
        const lines = writingLines(page.backdrop, page.geometry);
        for (const column of spaceHandles(lines, page.geometry.width)) {
          let el = this.spaceHandleEls[used];
          if (!el) {
            el = this.spaceHandlesEl.createDiv({ cls: "goodobsidian-space-handle" });
            this.spaceHandleEls.push(el);
          }
          el.removeClass("is-hidden");
          el.setCssStyles({
            left: `${(box.x + column.x) * scale}px`,
            top: `${(box.y + column.top) * scale}px`,
            height: `${column.lines * column.pitch * scale}px`,
          });
          el.setCssProps({ "--gob-space-pitch": `${column.pitch * scale}px` });
          used++;
        }
      }
    }
    for (let i = used; i < this.spaceHandleEls.length; i++) {
      this.spaceHandleEls[i].addClass("is-hidden");
    }
    this.spaceHandlesEl.toggleClass("is-hidden", used === 0);
  }

  /**
   * A practice file says what it was written on: the device, once, and the
   * kind of pointer of the latest stroke (training leaves out mouse ink).
   */
  private notePracticeInput(): void {
    const info = this.doc.practice;
    if (!this.practice || !info) return;
    info.device ??= this.practice.device;
    if (this.strokeInput) info.input = this.strokeInput;
  }

  /** The lasso's type changed (the toolbar wrote it into the tool state): its page marks follow. */
  refreshLassoChrome(): void {
    this.syncSpaceHandles();
  }

  /** One ribbon at the page's left edge for each section, level with its heading. */
  private syncSectionRibbons(): void {
    // Not built yet (the first change can come from the constructor's load).
    if (!this.sectionRibbonsEl || !this.pageLayout) return;
    let used = 0;
    const scale = this.unitScale;
    for (const box of this.pageLayout.boxes) {
      const page = this.pageAt(box.index);
      for (const section of page?.sections ?? []) {
        let ribbon = this.sectionRibbons[used];
        if (!ribbon) {
          ribbon = this.sectionRibbonsEl.createDiv({ cls: "goodobsidian-section-ribbon" });
          iconInto(ribbon, "bookmark", "▾");
          this.sectionRibbons.push(ribbon);
        }
        ribbon.removeClass("is-hidden");
        ribbon.setAttribute("aria-label", section.title);
        ribbon.setCssStyles({
          left: `${box.x * scale}px`,
          top: `${(box.y + section.y) * scale}px`,
        });
        used++;
      }
    }
    for (let i = used; i < this.sectionRibbons.length; i++) {
      this.sectionRibbons[i].addClass("is-hidden");
    }
    const linked = this.syncLinkMarks();
    this.sectionRibbonsEl.toggleClass("is-hidden", used === 0 && linked === 0);
  }

  /**
   * An underline under each link's ink, in the accent colour: the ink keeps
   * its own. Returns how many are shown.
   */
  private syncLinkMarks(): number {
    let used = 0;
    const scale = this.unitScale;
    for (const box of this.pageLayout.boxes) {
      const page = this.pageAt(box.index);
      if (!page) continue;
      const marks = [
        ...(page.links ?? []).map((link) => ({ link, suggested: false })),
        ...this.suggestionsOn(page).map((link) => ({ link, suggested: true })),
      ];
      for (const { link, suggested } of marks) {
        const bounds = this.linkBounds(page, link.strokes);
        if (!bounds) continue;
        let mark = this.linkMarks[used];
        if (!mark) {
          mark = this.sectionRibbonsEl.createDiv({ cls: "goodobsidian-link-mark" });
          this.linkMarks.push(mark);
        }
        mark.removeClass("is-hidden");
        mark.toggleClass("is-suggested", suggested);
        mark.setAttribute("aria-label", link.target);
        mark.setCssStyles({
          left: `${(box.x + bounds.minX) * scale}px`,
          top: `${(box.y + bounds.maxY) * scale + LINK_UNDERLINE_GAP_PX}px`,
          width: `${Math.max(8, (bounds.maxX - bounds.minX) * scale)}px`,
        });
        used++;
      }
    }
    for (let i = used; i < this.linkMarks.length; i++) this.linkMarks[i].addClass("is-hidden");
    return used;
  }

  /**
   * Offer `[[links]]` written by hand on a page, as found on the device: a
   * dashed underline each, and a finger tap asks to link them. Replaces the
   * page's earlier suggestions.
   */
  setLinkSuggestions(pageId: string, found: readonly HandwrittenLink[]): void {
    if (found.length > 0) this.linkSuggestions.set(pageId, found);
    else this.linkSuggestions.delete(pageId);
    this.syncSectionRibbons();
  }

  /** A page's suggestions, less any whose ink has since been linked or erased. */
  private suggestionsOn(page: Page): { strokes: string[]; target: string }[] {
    const found = this.linkSuggestions.get(page.id);
    if (!found) return [];
    const linked = new Set((page.links ?? []).flatMap((link) => link.strokes));
    return found
      .filter((s) => !s.strokeIds.some((id) => linked.has(id)))
      .map((s) => ({ strokes: s.strokeIds, target: s.target }));
  }

  /** The bounds of a link's ink that is still on the page, or null when none is. */
  private linkBounds(page: Page, strokeIds: readonly string[]): Bounds | null {
    const ids = new Set(strokeIds);
    let out: Bounds | null = null;
    for (const stroke of page.strokes) {
      if (!ids.has(stroke.id)) continue;
      const b = strokeBounds(stroke);
      if (!b) continue;
      out = out
        ? {
            minX: Math.min(out.minX, b.minX),
            minY: Math.min(out.minY, b.minY),
            maxX: Math.max(out.maxX, b.maxX),
            maxY: Math.max(out.maxY, b.maxY),
          }
        : b;
    }
    return out;
  }

  /**
   * A finger tapped page point `p`: open the link whose ink is there, if
   * any. `tolerance` is page px, around the ink and down to its underline.
   */
  private openLinkAt(page: Page, p: Pt, tolerance: number): boolean {
    const below = (LINK_UNDERLINE_GAP_PX + 4) / this.unitScale;
    const hit = (strokes: readonly string[]): boolean => {
      const b = this.linkBounds(page, strokes);
      if (!b) return false;
      if (p.x < b.minX - tolerance || p.x > b.maxX + tolerance) return false;
      return p.y >= b.minY - tolerance && p.y <= b.maxY + below + tolerance;
    };
    const open = this.callbacks.onOpenLink;
    for (const link of page.links ?? []) {
      if (open && hit(link.strokes)) {
        open(link.target);
        return true;
      }
    }
    const offer = this.callbacks.onSuggestedLink;
    const index = this.doc.pages.indexOf(page);
    for (const suggestion of this.suggestionsOn(page)) {
      if (offer && index >= 0 && hit(suggestion.strokes)) {
        offer(index, suggestion.strokes, suggestion.target);
        return true;
      }
    }
    return false;
  }

  private syncLockBadges(): void {
    let used = 0;
    if (this.toolState.tool === "select") {
      const scale = this.unitScale;
      const inset = LOCK_BADGE_INSET_PX / scale;
      for (const box of this.pageLayout.boxes) {
        const page = this.pageAt(box.index);
        if (!page) continue;
        for (const image of page.images) {
          if (image.locked !== true) continue;
          const t = transformOf(image);
          // Just inside the top-right corner, turning with the picture.
          const p = fromImageLocal(t, {
            x: Math.max(0, t.w / 2 - inset),
            y: Math.min(0, inset - t.h / 2),
          });
          let badge = this.lockBadges[used];
          if (!badge) {
            badge = this.lockBadgesEl.createDiv({ cls: "goodobsidian-lock-badge" });
            iconInto(badge, "lock", "•");
            this.lockBadges.push(badge);
          }
          badge.removeClass("is-hidden");
          badge.setCssStyles({
            left: `${(box.x + p.x) * scale}px`,
            top: `${(box.y + p.y) * scale}px`,
          });
          used++;
        }
      }
    }
    for (let i = used; i < this.lockBadges.length; i++) this.lockBadges[i].addClass("is-hidden");
    this.lockBadgesEl.toggleClass("is-hidden", used === 0);
  }

  /**
   * Crop the selected picture: it shows whole, veiled outside the crop, with
   * the crop in a frame whose corners and edges drag, and Cancel · Reset |
   * Done in the bar. Nothing is stored until Done.
   */
  private startCrop(): void {
    const sel = this.liveImageSelection();
    const box = sel ? this.boxForPage(sel.pageId) : null;
    if (!sel || !box || this.cropping || this.callbacks.isLocked?.()) return;
    this.cancelImageDrag();
    const crop = shownCrop(sel.image);
    this.cropping = {
      pageId: sel.pageId,
      image: sel.image,
      full: uncroppedBox(sel.image),
      crop: { ...crop },
      initial: { ...crop },
      drag: null,
    };
    // The element leaves the tiles; the wet layer shows the whole picture.
    this.renderer?.setHiddenImages(new Set([sel.image]));
    this.renderer?.invalidateRegion(box.index, imageBounds(transformOf(sel.image)));
    this.renderDry();
    this.renderCropDraft();
    this.syncImageOverlay();
  }

  /** Back to the whole picture; Done then stores no crop at all. */
  private resetCrop(): void {
    const session = this.cropping;
    if (!session) return;
    session.crop = { x: 0, y: 0, w: 1, h: 1 };
    this.renderCropDraft();
    this.syncImageOverlay();
  }

  /**
   * Leave crop mode. With `commit`, a changed crop is stored as one
   * `CropImage` — the part that stays visible does not move on the page;
   * otherwise the picture is as it was. It stays selected either way.
   */
  private endCrop(commit: boolean): void {
    const session = this.cropping;
    if (!session) return;
    this.endCropDrag();
    this.cropping = null;
    this.renderer?.setHiddenImages(NO_IMAGES);
    this.renderer?.clearWet();
    const page = this.doc.pages.find((candidate) => candidate.id === session.pageId);
    const changed =
      commit &&
      page?.images.includes(session.image) === true &&
      !sameCrop(session.crop, session.initial);
    if (changed) {
      const next = cropResult(session.image, session.crop);
      this.history.push(this.doc, new CropImage(session.pageId, session.image, next));
    }
    // The whole picture covers the element as it was and as it is now.
    const box = this.boxForPage(session.pageId);
    if (box) this.renderer?.invalidateRegion(box.index, imageBounds(session.full));
    this.renderDry();
    this.syncImageOverlay();
    if (changed) this.changed();
  }

  private renderCropDraft(): void {
    const session = this.cropping;
    const box = session ? this.boxForPage(session.pageId) : null;
    if (!session || !box) return;
    // The whole picture, mirrored as the element is; the crop is as it is drawn.
    const whole = placedAt(session.image, session.full);
    delete whole.crop;
    this.renderer?.renderImageCropDraft(box.index, whole, session.crop);
  }

  /** Put crop mode's DOM on the whole picture, and its frame on the crop. */
  private syncCropOverlay(): void {
    const session = this.cropping;
    const box = session ? this.boxForPage(session.pageId) : null;
    this.cropUiEl.toggleClass("is-hidden", !session || !box);
    if (!session || !box) return;
    const scale = this.unitScale;
    const { full, crop } = session;
    this.cropPictureEl.setCssStyles({
      left: `${(box.x + full.x) * scale}px`,
      top: `${(box.y + full.y) * scale}px`,
      width: `${full.w * scale}px`,
      height: `${full.h * scale}px`,
      transform: `rotate(${rotationOf(full)}rad)`,
    });
    this.cropFrameEl.setCssStyles({
      left: `${crop.x * 100}%`,
      top: `${crop.y * 100}%`,
      width: `${crop.w * 100}%`,
      height: `${crop.h * 100}%`,
    });
    const fit = edgeHandlesFit(croppedBox(full, crop), HANDLE_HIT_RADIUS_PX / scale);
    this.cropFrameEl.toggleClass("no-ns", !fit.ns);
    this.cropFrameEl.toggleClass("no-ew", !fit.ew);
  }

  /**
   * A press on the picture in crop mode: a corner or an edge of the crop
   * frame moves those sides, inside the frame moves the frame, and the
   * veiled rest does nothing. The page below never sees any of it.
   */
  private readonly onCropPointerDown = (event: PointerEvent): void => {
    event.stopPropagation();
    event.preventDefault();
    const session = this.cropping;
    if (!session || session.drag) return;
    // A palm landing on the picture while the Pencil is busy elsewhere is a palm.
    if (event.pointerType === "touch" && this.activePage !== null) return;
    const box = this.boxForPage(session.pageId);
    if (!box) return;
    const p = this.pagePoint(box, event.clientX, event.clientY);
    const radius = HANDLE_HIT_RADIUS_PX / this.unitScale;
    const part = hitImagePart(croppedBox(session.full, session.crop), p, radius, null);
    if (!part) return;
    try {
      this.cropPictureEl.setPointerCapture(event.pointerId);
    } catch {
      // A synthetic pointer (a test harness) cannot be captured; moves still arrive.
    }
    session.drag = {
      pointerId: event.pointerId,
      part,
      start: { ...session.crop },
      from: pictureFraction(session.full, p),
      min: minCropFractions(session.full),
    };
    this.cropPictureEl.addEventListener("pointermove", this.onCropPointerMove);
    this.cropPictureEl.addEventListener("pointerup", this.onCropPointerEnd);
    this.cropPictureEl.addEventListener("pointercancel", this.onCropPointerEnd);
  };

  private readonly onCropPointerMove = (event: PointerEvent): void => {
    const session = this.cropping;
    const drag = session?.drag;
    if (!session || !drag || event.pointerId !== drag.pointerId) return;
    event.stopPropagation();
    event.preventDefault();
    const box = this.boxForPage(session.pageId);
    if (!box) return;
    const f = pictureFraction(session.full, this.pagePoint(box, event.clientX, event.clientY));
    session.crop = dragCrop(drag.start, drag.part, f.u - drag.from.u, f.v - drag.from.v, drag.min);
    this.renderCropDraft();
    this.syncCropOverlay();
  };

  /** A lift (or an iOS cancel, which may be an ordinary lift) keeps the frame where it is. */
  private readonly onCropPointerEnd = (event: PointerEvent): void => {
    const drag = this.cropping?.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.stopPropagation();
    this.endCropDrag();
    this.syncActionBar();
  };

  private endCropDrag(): void {
    const drag = this.cropping?.drag;
    if (!this.cropping || !drag) return;
    this.cropping.drag = null;
    this.cropPictureEl.removeEventListener("pointermove", this.onCropPointerMove);
    this.cropPictureEl.removeEventListener("pointerup", this.onCropPointerEnd);
    this.cropPictureEl.removeEventListener("pointercancel", this.onCropPointerEnd);
    if (this.cropPictureEl.hasPointerCapture(drag.pointerId)) {
      this.cropPictureEl.releasePointerCapture(drag.pointerId);
    }
  }

  /**
   * Place a copy of everything selected just below and right of it (images
   * share their files), as one undo step, and select the copy — GoodNotes'
   * Duplicate.
   */
  private duplicateSelection(): void {
    const sel = this.liveSelection();
    const box = sel ? this.boxForPage(sel.pageId) : null;
    const bounds = sel ? this.groupBounds(sel) : null;
    if (!sel || !box || !bounds || this.callbacks.isLocked?.()) return;
    const d = clampGroupDelta(bounds, DUPLICATE_OFFSET, DUPLICATE_OFFSET, box);
    const copies = copyElements(sel, this.freshIds(), d.dx, d.dy);
    this.history.push(this.doc, new AddElements(sel.pageId, copies));
    this.renderer?.invalidateRegion(box.index, shiftBounds(bounds, d.dx, d.dy));
    this.strokeIndex.refreshPages(this.doc.pages, [sel.pageId]);
    this.renderDry();
    this.syncTextBoxes();
    this.select(sel.pageId, copies);
    this.changed([sel.pageId]);
  }

  /**
   * The selected shapes' fill, line, corners and arrowheads, as menu rows
   * with a check on what they have now (none where they differ). Each row
   * restyles every shape that can take it, as one undo step.
   */
  private shapeStyleActions(strokes: readonly Stroke[]): SelectionAction[] {
    const common = commonShapeStyle(strokes);
    if (common.shapes === 0) return [];
    const { style } = common;
    const out: SelectionAction[] = [];
    const row = (
      id: string,
      icon: string,
      label: string,
      group: string,
      checked: boolean,
      apply: ShapeStyle,
    ): void => {
      out.push({ id, icon, label, group, checked, run: () => this.restyleSelection(apply) });
    };
    if (common.fillable) {
      const fill =
        style.fill === undefined
          ? null
          : style.fill === null
            ? "none"
            : splitFill(style.fill).alpha < 1
              ? "soft"
              : "solid";
      row("fill-none", "square", "No fill", "fill", fill === "none", { fill: null });
      row("fill-soft", "paint-bucket", "Soft fill", "fill", fill === "soft", { fillFrom: "soft" });
      row("fill-solid", "paint-bucket", "Solid fill", "fill", fill === "solid", {
        fillFrom: "solid",
      });
    }
    row("line-solid", "minus", "Solid line", "line", style.dash === null, { dash: null });
    row("line-dash", "square-dashed", "Dashed line", "line", style.dash === "dash", {
      dash: "dash",
    });
    row("line-dot", "ellipsis", "Dotted line", "line", style.dash === "dot", { dash: "dot" });
    if (common.roundable) {
      const rounded = typeof style.radius === "number" && style.radius > 0;
      row("corners", "square-round-corner", "Rounded corners", "corners", rounded, {
        radius: rounded ? null : ROUND_RADIUS,
      });
    }
    if (common.headed) {
      const heads = style.heads ?? null;
      const start = heads?.start;
      const end = heads?.end;
      const filled = start === "filled" || end === "filled";
      const kind = filled ? "filled" : "open";
      row("head-start", "arrow-left", "Arrow at start", "heads", start !== undefined, {
        heads: { ...(start ? {} : { start: kind }), ...(end ? { end } : {}) },
      });
      row("head-end", "arrow-right", "Arrow at end", "heads", end !== undefined, {
        heads: { ...(start ? { start } : {}), ...(end ? {} : { end: kind }) },
      });
      const flip = filled ? "open" : "filled";
      row("head-filled", "triangle", "Filled arrowheads", "heads", filled, {
        heads:
          start || end
            ? { ...(start ? { start: flip } : {}), ...(end ? { end: flip } : {}) }
            : { end: "filled" },
      });
    }
    return out;
  }

  /** Restyle the selected shapes (`RestyleShapes`), as one undo step. */
  private restyleSelection(style: ShapeStyle): void {
    const sel = this.liveSelection();
    if (!sel || sel.strokes.length === 0 || this.callbacks.isLocked?.()) return;
    const before = selectionBounds(sel.strokes, [], []);
    const command = new RestyleShapes(sel.pageId, sel.strokes, style);
    this.history.push(this.doc, command);
    const box = this.boxForPage(sel.pageId);
    const after = selectionBounds(sel.strokes, [], []);
    const dirty = before && after ? unionBounds(before, after) : (before ?? after);
    // A fill, dash or corner is not part of a stroke's cached outline: re-rasterise.
    if (box && dirty) this.renderer?.invalidateRegion(box.index, dirty);
    // An arrow given heads became a line: its points changed.
    this.strokeIndex.refreshPages(this.doc.pages, [sel.pageId]);
    this.renderDry();
    this.syncSelectionOverlay();
    this.syncActionBar();
    this.changed([sel.pageId]);
  }

  /** Give every selected stroke one colour, as one undo step. */
  private recolorSelection(color: string): void {
    const sel = this.liveSelection();
    if (!sel || sel.strokes.length === 0 || this.callbacks.isLocked?.()) return;
    if (sel.strokes.every((stroke) => stroke.color === color)) return;
    this.history.push(this.doc, new RecolorStrokes(sel.pageId, sel.strokes, color));
    const box = this.boxForPage(sel.pageId);
    const bounds = selectionBounds(sel.strokes, [], []);
    // A colour is not part of a stroke's cached outline: re-rasterise.
    if (box && bounds) this.renderer?.invalidateRegion(box.index, bounds);
    this.renderDry();
    this.syncActionBar();
    this.changed([sel.pageId]);
  }

  /**
   * A press on the selection's frame: the whole selection follows it, and
   * the lift commits one `TranslateElements`. A press on a corner handle
   * resizes it instead, about the opposite corner, the aspect kept, and the
   * lift commits one `ScaleElements`; the knob below turns it about its
   * middle, and the lift commits one `ReorientElements`. The pure hit tests
   * decide which, so the handles answer across 44 screen px at any zoom. A
   * finger works it too.
   */
  private readonly onSelectionPointerDown = (event: PointerEvent): void => {
    // Everything on the frame is the frame's: the page below never sees it.
    event.stopPropagation();
    event.preventDefault();
    const sel = this.liveSelection();
    if (!sel || this.groupDrag || this.callbacks.isLocked?.()) return;
    // A palm landing on the frame while the Pencil is busy elsewhere is a palm.
    if (event.pointerType === "touch" && this.activePage !== null) return;
    const box = this.boxForPage(sel.pageId);
    const bounds = this.groupBounds(sel);
    if (!box || !bounds) return;
    try {
      this.selectionFrameEl.setPointerCapture(event.pointerId);
    } catch {
      // A synthetic pointer (a test harness) cannot be captured; moves still arrive.
    }
    const from = this.pagePoint(box, event.clientX, event.clientY);
    const turn = this.knobGrabbed(bounds, from);
    this.groupDrag = {
      pointerId: event.pointerId,
      selection: sel,
      bounds,
      from,
      clientX: event.clientX,
      clientY: event.clientY,
      dx: 0,
      dy: 0,
      scale: turn ? null : this.cornerGrabbed(sel, bounds, from),
      turn,
      lifted: false,
    };
    this.selectionFrameEl.addEventListener("pointermove", this.onSelectionPointerMove);
    this.selectionFrameEl.addEventListener("pointerup", this.onSelectionPointerEnd);
    this.selectionFrameEl.addEventListener("pointercancel", this.onSelectionPointerEnd);
  };

  private readonly onSelectionPointerMove = (event: PointerEvent): void => {
    const drag = this.groupDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.stopPropagation();
    event.preventDefault();
    const moved = Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY);
    if (!drag.lifted && moved < IMAGE_DRAG_SLOP_PX) return;
    const box = this.boxForPage(drag.selection.pageId);
    if (!box) return;
    this.moveGroupDrag(drag, box, this.pagePoint(box, event.clientX, event.clientY));
  };

  /**
   * The corner resize a press at page point `from` starts on the selection's
   * frame, or `null` when it grabbed no corner handle. The handles sit on the
   * dashed frame, which is `SELECTION_PAD_PX` outside the bounds.
   */
  /** The selection's dashed frame, page space: its bounds grown by `SELECTION_PAD_PX`. */
  private selectionFrameOf(bounds: Bounds): Bounds {
    const pad = SELECTION_PAD_PX / this.unitScale;
    return {
      minX: bounds.minX - pad,
      minY: bounds.minY - pad,
      maxX: bounds.maxX + pad,
      maxY: bounds.maxY + pad,
    };
  }

  /** The turn a press at page point `from` starts, or `null` when it missed the rotate knob. */
  private knobGrabbed(bounds: Bounds, from: Pt): GroupTurn | null {
    const scale = this.unitScale;
    const frame = this.selectionFrameOf(bounds);
    const hit = hitSelectionKnob(
      frame,
      from,
      ROTATE_HANDLE_OFFSET_PX / scale,
      HANDLE_HIT_RADIUS_PX / scale,
    );
    return hit ? { centre: boundsCentre(bounds), from, angle: 0 } : null;
  }

  private cornerGrabbed(sel: GroupSelection, bounds: Bounds, from: Pt): GroupScale | null {
    const scale = this.unitScale;
    const pad = SELECTION_PAD_PX / scale;
    const frame: Bounds = {
      minX: bounds.minX - pad,
      minY: bounds.minY - pad,
      maxX: bounds.maxX + pad,
      maxY: bounds.maxY + pad,
    };
    const corner = hitSelectionCorner(frame, from, HANDLE_HIT_RADIUS_PX / scale);
    if (!corner) return null;
    const at = boundsCorner(bounds, corner);
    const text = textScaleRange(sel.textBoxes);
    return {
      corner,
      anchor: anchorCorner(bounds, corner),
      grab: { x: at.x - from.x, y: at.y - from.y },
      k: 1,
      min: Math.max(minScaleForSide(bounds, MIN_SELECTION_SIDE_PX / scale), text.min),
      max: text.max,
    };
  }

  /** Carry a selection being dragged to page point `p`, from where the drag began. */
  private moveGroupDrag(drag: GroupDrag, box: PageBox, p: Pt): void {
    const scale = drag.scale;
    const turn = drag.turn;
    if (turn) {
      turn.angle = sweptTurn(turn.centre, turn.from, p);
    } else if (scale) {
      const pointer = { x: p.x + scale.grab.x, y: p.y + scale.grab.y };
      scale.k = cornerScale(drag.bounds, scale.corner, pointer, scale.min, scale.max);
    } else {
      const d = clampGroupDelta(drag.bounds, p.x - drag.from.x, p.y - drag.from.y, box);
      drag.dx = d.dx;
      drag.dy = d.dy;
    }
    if (!drag.lifted) this.liftSelection(drag, box);
    this.renderGroupDraft();
    this.placeDraggedTextBoxes(drag, box);
    this.syncSelectionOverlay();
  }

  /**
   * The lift commits the whole move as one step. A pointercancel commits
   * too: iOS can cancel an ordinary lift, and a selection that snapped back
   * would read as the app refusing the move.
   */
  private readonly onSelectionPointerEnd = (event: PointerEvent): void => {
    const drag = this.groupDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.stopPropagation();
    this.endGroupDrag(true);
  };

  /**
   * Take the selection's ink and pictures out of the tiles and draw them on
   * the wet layer instead; the tiles under them are rasterised once without
   * them, rather than on every frame of the drag.
   */
  private liftSelection(drag: GroupDrag, box: PageBox): void {
    drag.lifted = true;
    this.renderer?.setHiddenStrokes(new Set(drag.selection.strokes.map((stroke) => stroke.id)));
    this.renderer?.setHiddenImages(new Set(drag.selection.images));
    this.renderer?.invalidateRegion(box.index, drag.bounds);
    this.renderDry();
  }

  private renderGroupDraft(): void {
    const drag = this.groupDrag;
    const box = drag ? this.boxForPage(drag.selection.pageId) : null;
    if (!drag?.lifted || !box) return;
    const { strokes, images } = drag.selection;
    const scale = drag.scale;
    this.renderer?.renderSelectionDraft(
      box.index,
      strokes,
      images,
      drag.dx,
      drag.dy,
      this.inkPressure,
      scale ? { x: scale.anchor.x, y: scale.anchor.y, k: scale.k } : undefined,
      drag.turn
        ? { x: drag.turn.centre.x, y: drag.turn.centre.y, angle: drag.turn.angle }
        : undefined,
    );
  }

  /**
   * Move just the dragged text boxes' frames; a full sync waits for the
   * lift. A resize scales each box by a transform meanwhile, so its text
   * is not laid out again on every frame.
   */
  private placeDraggedTextBoxes(drag: GroupDrag, box: PageBox): void {
    const scale = this.unitScale;
    const k = drag.scale?.k;
    for (const textBox of drag.selection.textBoxes) {
      const view = this.textBoxInputs.get(`${drag.selection.pageId}:${textBox.id}`);
      const shift = this.dragShift(drag.selection.pageId, textBox);
      view?.root.setCssStyles({
        left: `${Math.round((box.x + textBox.x + shift.x) * scale)}px`,
        top: `${Math.round((box.y + textBox.y + shift.y) * scale)}px`,
        ...(k === undefined ? {} : { transform: `scale(${k})`, transformOrigin: "0 0" }),
      });
    }
  }

  /**
   * Finish a selection drag: commit it (`commit`) or drop it, then put the
   * selection back into the tiles where it was and where it now is.
   */
  private endGroupDrag(commit: boolean): void {
    const drag = this.groupDrag;
    if (!drag) return;
    this.groupDrag = null;
    this.circleDrag = false;
    this.selectionFrameEl.removeEventListener("pointermove", this.onSelectionPointerMove);
    this.selectionFrameEl.removeEventListener("pointerup", this.onSelectionPointerEnd);
    this.selectionFrameEl.removeEventListener("pointercancel", this.onSelectionPointerEnd);
    if (this.selectionFrameEl.hasPointerCapture(drag.pointerId)) {
      this.selectionFrameEl.releasePointerCapture(drag.pointerId);
    }
    if (!drag.lifted) {
      this.syncSelectionOverlay();
      return;
    }
    this.renderer?.setHiddenStrokes(NO_STROKES);
    this.renderer?.setHiddenImages(NO_IMAGES);
    this.renderer?.clearWet();
    const { pageId } = drag.selection;
    const box = this.boxForPage(pageId);
    const scale = drag.scale;
    if (scale) {
      for (const textBox of drag.selection.textBoxes) {
        this.textBoxInputs
          .get(`${pageId}:${textBox.id}`)
          ?.root.setCssStyles({ transform: "", transformOrigin: "" });
      }
    }
    const turn = drag.turn;
    const changed = turn
      ? turn.angle !== 0
      : scale
        ? scale.k !== 1
        : drag.dx !== 0 || drag.dy !== 0;
    const moved = commit && changed && this.doc.pages.some((page) => page.id === pageId);
    let after: Bounds | null = null;
    if (moved && turn) {
      const motion: Reorientation = { kind: "rotate", angle: turn.angle };
      after = this.reorientSelection(drag.selection, drag.bounds, motion, turn.centre);
    } else if (moved) {
      this.history.push(
        this.doc,
        scale
          ? new ScaleElements(pageId, drag.selection, scale.anchor.x, scale.anchor.y, scale.k)
          : new TranslateElements(pageId, drag.selection, drag.dx, drag.dy),
      );
      this.strokeIndex.refreshPages(this.doc.pages, [pageId]);
      // The freehand loop is drawn relative to the bounds: it scales with them.
      const outline = this.selectionOutline;
      if (scale && outline) {
        this.selectionOutline = { ...outline, loop: outline.loop.map((v) => v * scale.k) };
      }
      after = this.draggedBounds(drag);
    }
    this.selectionFrameEl.setCssStyles({ transform: "" });
    if (box) {
      this.renderer?.invalidateRegion(box.index, unionBounds(drag.bounds, after) ?? drag.bounds);
    }
    this.renderDry();
    this.syncTextBoxes();
    this.syncSelectionOverlay();
    if (moved) this.changed([pageId]);
  }

  /**
   * Turn or mirror a selection about `centre` as one `ReorientElements`, and
   * carry the freehand loop round with it. Returns the selection's bounds
   * afterwards; the caller repaints them and the bounds `before`.
   */
  private reorientSelection(
    sel: GroupSelection,
    before: Bounds,
    motion: Reorientation,
    centre: Pt,
  ): Bounds | null {
    const heights = new Map<TextBoxElement, number>();
    for (const textBox of sel.textBoxes) {
      heights.set(textBox, this.textBoxFrameOf(sel.pageId, textBox).h);
    }
    this.history.push(
      this.doc,
      new ReorientElements(sel.pageId, sel, motion, centre.x, centre.y, heights),
    );
    this.strokeIndex.refreshPages(this.doc.pages, [sel.pageId]);
    const after = this.groupBounds(sel);
    // The loop is stored relative to the bounds' corner, which has moved.
    const outline = this.selectionOutline;
    if (outline && after) {
      const loop: number[] = [];
      for (let i = 0; i + 1 < outline.loop.length; i += 2) {
        const x = before.minX + outline.loop[i];
        const y = before.minY + outline.loop[i + 1];
        const p = reorientPoint(motion, centre.x, centre.y, x, y);
        loop.push(p.x - after.minX, p.y - after.minY);
      }
      this.selectionOutline = { ...outline, loop };
    }
    return after;
  }

  /**
   * Mirror the lasso selection about the middle of its bounds: ink is
   * mirrored, pictures flip, and text boxes move to their mirrored place but
   * still read forwards. One undo step; the selection stays.
   */
  private flipSelection(axis: FlipAxis): void {
    const sel = this.liveSelection();
    if (!sel || this.groupDrag || this.callbacks.isLocked?.()) return;
    const before = this.groupBounds(sel);
    const box = this.boxForPage(sel.pageId);
    if (!before || !box) return;
    const after = this.reorientSelection(sel, before, { kind: "flip", axis }, boundsCentre(before));
    this.renderer?.invalidateRegion(box.index, unionBounds(before, after) ?? before);
    this.renderDry();
    this.syncTextBoxes();
    this.syncSelectionOverlay();
    this.changed([sel.pageId]);
  }

  /** Abandon a selection drag without committing it (a reload, an undo, a tool change). */
  private cancelGroupDrag(): void {
    this.endGroupDrag(false);
  }

  /**
   * A finger tapped the page (client px). With the lasso it selects, like a
   * Pencil tap; with any other tool it lets go of a selected image, and a
   * tap on a picture picks the lasso and selects it (`fingerPicksPicture`)
   * — fingers never draw. While audio replay is open, a tap on ink goes to
   * it first, whatever the tool.
   */
  private onFingerTap(clientX: number, clientY: number): void {
    if (this.lasso || this.imageDrag || this.groupDrag) return;
    if (this.dismissUsedSelection()) return;
    // A tap beside a picture being cropped finishes the crop, as a pen's does.
    if (this.cropping) {
      this.endCrop(true);
      return;
    }
    // A tap beside the press menu only closes it, as a tap beside any menu does.
    if (this.pressMenu) {
      this.clearSelection();
      return;
    }
    // Outside the lasso a selection is a paste's or Circle to lasso's: a tap lets go of it.
    if (this.toolState.tool !== "select") {
      this.deselectImage();
      this.clearSelection();
    }
    const at = this.toLayout(clientX, clientY);
    const box = boxAtPoint(this.pageLayout, at.x, at.y);
    // A finger on linked ink opens the link; the pen keeps writing over it.
    const tapped = box ? this.pageAt(box.index) : null;
    if (box && tapped) {
      const tolerance = FINGER_TAP_TOLERANCE_PX / this.unitScale;
      if (this.openLinkAt(tapped, this.toPage(box, at), tolerance)) return;
    }
    if (box && this.offerStrokeTap(box, this.toPage(box, at), FINGER_TAP_TOLERANCE_PX)) {
      this.clearSelection();
      return;
    }
    if (this.toolState.tool !== "select") {
      // A box held without the keyboard: a finger beside it lets go, as the
      // Pencil's tap does, and an unpinned Text tool hands back the tool before.
      if (this.toolState.tool === "text" && this.heldText) {
        this.releaseHeldText(true);
        return;
      }
      if (box && tapped) {
        const p = this.toPage(box, at);
        // Typed text sits above the pictures, so a box is tried first.
        if (!this.fingerHoldsTextBox(tapped, p)) this.fingerPicksPicture(tapped, p);
      }
      return;
    }
    if (!box) {
      // Off the pages is tapping out too: a parked box is forgotten.
      this.forgetParkedText();
      this.clearSelection();
      this.deselectImage();
      return;
    }
    this.tapSelect(box, this.toPage(box, at), FINGER_TAP_TOLERANCE_PX);
  }

  /**
   * A finger tapped a text box while a pen, the highlighter, the eraser or
   * the shape tool was in hand: the lasso is picked and the box held, as
   * GoodNotes does — framed with its handles, the text pill floating by it on
   * its style, no keyboard (the lasso never types). A second tap on the box
   * focuses it, which brings the keyboard and the Text tool; a tap beside it
   * lets go and the tool in hand before comes back. Not with the Text tool
   * (a tap there already edits), in a practice file, or on a page that is
   * locked. Returns whether it did.
   */
  private fingerHoldsTextBox(page: Page, p: Pt): boolean {
    if (this.practice || this.toolState.tool === "text") return false;
    if (this.callbacks.isLocked?.()) return false;
    let view: TextBoxView | undefined;
    for (let i = page.textBoxes.length - 1; i >= 0 && !view; i--) {
      const textBox = page.textBoxes[i];
      const f = this.textBoxFrameOf(page.id, textBox);
      if (p.x >= f.x && p.x <= f.x + f.w && p.y >= f.y && p.y <= f.y + f.h) {
        view = this.textBoxInputs.get(`${page.id}:${textBox.id}`);
      }
    }
    if (!view) return false;
    const back = this.toolState.tool;
    this.setTool("select");
    this.callbacks.onToolChange?.("select");
    this.holdTextBox(view, back, true);
    return true;
  }

  /**
   * Select a text box with the lasso, as GoodNotes does: framed with its
   * handles, its text options floating beside it, no keyboard. A second tap
   * on it types, the lasso still in hand; a tap beside it lets go, and `back`
   * (the tool a finger tap left for the lasso; null when the lasso was
   * picked on purpose) comes back. `afterTap`: the box takes taps itself
   * only once the tap that selected it is over, since iOS turns a finger's
   * tap into a click aimed at whatever is under it then.
   */
  private holdTextBox(view: TextBoxView, back: ActiveTool | null, afterTap: boolean): void {
    this.releaseHeldText();
    this.clearSelection();
    this.deselectImage();
    this.heldText = view;
    this.heldReturnTool = back;
    view.root.addClass("is-held");
    this.reportTextEditing();
    window.clearTimeout(this.heldTapTimer);
    this.heldTapTimer = 0;
    if (!afterTap) {
      view.root.addClass("is-tappable");
      return;
    }
    swallowClickAfterTap(view.root);
    this.heldTapTimer = window.setTimeout(() => {
      this.heldTapTimer = 0;
      if (this.heldText === view) view.root.addClass("is-tappable");
    }, HELD_TAP_DELAY_MS);
  }

  /**
   * A tap with the lasso while a box is held or typed in: on the box (a
   * Pencil's, or a finger's before the box takes taps) types in it; beside
   * it ends the typing, lets go of the box, and the tool in hand before the
   * lasso comes back. Returns whether there was such a box to answer the tap.
   */
  private tapWithHeldText(page: Page, p: Pt): boolean {
    if (this.toolState.tool !== "select") return false;
    const typing = this.editingTextView();
    const view = this.heldText ?? typing;
    if (!view) return false;
    const live = this.liveTextBox(view.pageId, view.id);
    const f = live ? this.textBoxFrameOf(view.pageId, live) : null;
    const on =
      f !== null &&
      page.id === view.pageId &&
      p.x >= f.x &&
      p.x <= f.x + f.w &&
      p.y >= f.y &&
      p.y <= f.y + f.h;
    if (on) {
      if (view !== typing) this.focusTextBox(view.input);
      return true;
    }
    this.letGoOfText();
    return true;
  }

  /**
   * Let go of the text box held or typed in: the keyboard goes, the box's
   * frame and its pill go, and the tool in hand before comes back — the
   * lasso's way (`heldReturnTool`) or the unpinned Text tool's (it hands
   * back the tool used before it). Nothing is recorded: a selection is not
   * an edit, so undo is as it was. What a tap beside the box does, and what
   * scrolling the box out of sight does (`dropTextOutOfSight`).
   */
  private letGoOfText(): void {
    const typing = this.editingTextView();
    const back = this.heldReturnTool;
    // The keyboard goes; with the lasso the blur keeps the box held, and
    // with the Text tool it may hand the tool back already.
    typing?.input.blur();
    if (this.toolState.tool === "text") {
      this.releaseHeldText(true);
      return;
    }
    this.releaseHeldText();
    if (back && back !== "select" && this.toolState.tool === "select") {
      this.setTool(back);
      this.callbacks.onToolChange?.(back);
    }
  }

  /**
   * Whether the page has moved enough, this gesture, to send the text pill
   * away: more than `TEXT_PILL_MOVE_PX` of scroll or `TEXT_PILL_ZOOM_RATIO`
   * of zoom since it started. A nudge, a palm or a pinch that barely moves
   * leaves the pill by its box, following it. Once sent away it stays away
   * until the page has been still for `TEXT_PILL_SETTLE_MS`, so a scroll
   * that stops and starts again does not flash it.
   */
  private trackTextPillMotion(busy: boolean): void {
    const position = this.scroller.position;
    if (busy) {
      window.clearTimeout(this.textPillSettleTimer);
      this.textPillSettleTimer = 0;
      const from = this.textPillRest ?? { x: position.x, y: position.y, scale: this.scale };
      const motion = (this.textPillMotion ??= { ...from, away: this.textAnchorMoving });
      if (!motion.away) {
        const scrolled = Math.hypot(position.x - motion.x, position.y - motion.y);
        const zoomed = motion.scale > 0 ? Math.abs(this.scale / motion.scale - 1) : 0;
        motion.away = scrolled > TEXT_PILL_MOVE_PX || zoomed > TEXT_PILL_ZOOM_RATIO;
      }
      this.textAnchorMoving = motion.away;
      return;
    }
    const motion = this.textPillMotion;
    this.textPillMotion = null;
    this.textPillRest = { x: position.x, y: position.y, scale: this.scale };
    // Nothing moved since the last frame at rest: a pending settle decides.
    if (!motion?.away) return;
    window.clearTimeout(this.textPillSettleTimer);
    this.textPillSettleTimer = window.setTimeout(() => {
      this.textPillSettleTimer = 0;
      this.textAnchorMoving = false;
      this.reportTextAnchor();
    }, TEXT_PILL_SETTLE_MS);
  }

  /**
   * A held or typed-in box that has left the page's part of the screen
   * entirely (no pixel of it shows) loses its frame, its pill and the
   * keyboard for good, as in GoodNotes: scrolling back brings none of them
   * back. The tool stays as it is and the box is parked (`parkedText`): a
   * tap on it types in it at once; a tap anywhere else, another tool, an
   * undo, a page change or a reload forgets it. Checked as the view moves.
   */
  private dropTextOutOfSight(): void {
    const view = this.heldText ?? this.editingTextView();
    if (!view) return;
    const box = view.root.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) return;
    const page = this.surfaceEl.getBoundingClientRect();
    const showing =
      box.bottom > page.top &&
      box.top < page.bottom &&
      box.right > page.left &&
      box.left < page.right;
    if (showing) return;
    const parked = { view, tool: this.toolState.tool, returnTool: this.heldReturnTool };
    // The keyboard goes. With the lasso the blur keeps the box held, which
    // is let go next; the Text tool must not hand itself back.
    this.parkingText = true;
    try {
      this.editingTextView()?.input.blur();
    } finally {
      this.parkingText = false;
    }
    this.releaseHeldText();
    this.parkedText = parked;
  }

  /**
   * A lasso tap (finger or Pencil) while a box is parked: on that box, it
   * types in it at once, the keyboard and the pill by the box; anywhere
   * else, the box is forgotten and, as after a tap beside a held box, the
   * tool in hand before the lasso comes back. Returns whether the tap was
   * the parked box's to answer.
   */
  private tapParkedText(page: Page, p: Pt): boolean {
    const parked = this.parkedText;
    if (!parked) return false;
    this.parkedText = null;
    if (parked.tool !== this.toolState.tool || this.toolState.tool !== "select") return false;
    const { view } = parked;
    const live = this.liveTextBox(view.pageId, view.id);
    const f = live ? this.textBoxFrameOf(view.pageId, live) : null;
    const on =
      f !== null &&
      page.id === view.pageId &&
      p.x >= f.x &&
      p.x <= f.x + f.w &&
      p.y >= f.y &&
      p.y <= f.y + f.h;
    if (on) {
      this.heldReturnTool = parked.returnTool;
      this.focusTextBox(view.input);
      return true;
    }
    this.returnFromParked(parked.returnTool);
    return true;
  }

  /** A tap off the pages while a box is parked: forget it, and come back from the lasso. */
  private forgetParkedText(): void {
    const parked = this.parkedText;
    this.parkedText = null;
    if (parked && parked.tool === "select" && this.toolState.tool === "select") {
      this.returnFromParked(parked.returnTool);
    }
  }

  /** As after a tap beside a held box: the tool in hand before the lasso comes back. */
  private returnFromParked(back: ActiveTool | null): void {
    if (!back || back === "select") return;
    this.setTool(back);
    this.callbacks.onToolChange?.(back);
  }

  /**
   * A finger tapped a picture while a pen, the highlighter, the eraser or
   * the shape tool was in hand: the lasso is picked and the picture selected,
   * with its handles to move, resize and turn it, since a finger never draws.
   * Not with the Text tool (a finger places and focuses boxes there), in a
   * practice file, or on a locked picture. Returns whether it did.
   */
  private fingerPicksPicture(page: Page, p: Pt): boolean {
    if (this.practice || this.toolState.tool === "text") return false;
    const image = topImageAt(
      page.images.filter((candidate) => candidate.locked !== true),
      p,
      0,
    );
    if (!image) return false;
    this.setTool("select");
    this.callbacks.onToolChange?.("select");
    this.setImageSelection(page.id, image);
    return true;
  }

  // --- Placed images --------------------------------------------------------

  /**
   * Select a placed image: it gets a frame, resize, stretch and rotate
   * handles and the action bar. Returns false when no such image is on that
   * page, or it is locked.
   */
  selectImage(pageId: string, imageId: string): boolean {
    const page = this.doc.pages.find((candidate) => candidate.id === pageId);
    const image = page?.images.find((candidate) => candidate.id === imageId);
    if (!page || !image || image.locked === true) return false;
    this.setImageSelection(page.id, image);
    return true;
  }

  /** Let go of the selected image, if any; crop mode on it ends without a change. */
  deselectImage(): void {
    this.endCrop(false);
    if (!this.imageSel) return;
    this.cancelImageDrag();
    this.imageSel = null;
    this.syncImageOverlay();
  }

  /** The selected image and its page, or `null`. */
  get selectedImage(): { pageId: string; image: ImageElement } | null {
    return this.liveImageSelection();
  }

  /** Delete the selected image (one undo step). Returns whether one was deleted. */
  deleteSelectedImage(): boolean {
    const sel = this.liveImageSelection();
    if (!sel || this.callbacks.isLocked?.()) return false;
    this.applyCommand(new RemoveImage(sel.pageId, sel.image.id));
    this.selectionTakenAway();
    return true;
  }

  /**
   * Place a copy of the selected image just below and right of it, sharing
   * its file, and select the copy. Returns whether one was made.
   */
  duplicateSelectedImage(): boolean {
    const sel = this.liveImageSelection();
    const page = sel ? this.doc.pages.find((candidate) => candidate.id === sel.pageId) : null;
    if (!sel || !page || this.callbacks.isLocked?.()) return false;
    const copy = duplicateImage(this.doc, page.geometry, sel.image);
    this.applyCommand(new InsertImage(page.id, copy));
    this.setImageSelection(page.id, copy);
    return true;
  }

  private setImageSelection(pageId: string, image: ImageElement): void {
    // A locked picture cannot be selected until it is unlocked.
    if (image.locked === true) return;
    // One selection at a time: a lasso selection gives way to the picture.
    this.endCrop(false);
    this.clearSelection();
    this.cancelImageDrag();
    this.imageSel = { pageId, image };
    if (this.toolState.tool === "select") this.selectionToolUsed = true;
    this.syncImageOverlay();
  }

  /**
   * The selection, if the image it holds is still on its page. Undo, a file
   * reload or another command can take it away; then it is dropped here.
   */
  private liveImageSelection(): { pageId: string; image: ImageElement } | null {
    const sel = this.imageSel;
    if (!sel) return null;
    const page = this.doc.pages.find((candidate) => candidate.id === sel.pageId);
    if (page && page.images.includes(sel.image)) return sel;
    this.imageSel = null;
    return null;
  }

  private boxForPage(pageId: string): PageBox | null {
    return this.pageLayout.boxes.find((box) => box.id === pageId) ?? null;
  }

  /** Client px -> page-local point on a given page. */
  private pagePoint(box: PageBox, clientX: number, clientY: number): { x: number; y: number } {
    return this.toPage(box, this.toLayout(clientX, clientY));
  }

  /**
   * Put the selected image's chrome where the image is (or where a drag has
   * it). The frame is the image's unrotated box turned about its centre, as
   * the canvas draws it; edge handles show only on an edge long enough for
   * them. The action bar is the selection's own (see `syncActionBar`):
   * above the picture, or below it when there is no room above on screen.
   * In crop mode the crop frame stands in for all of it.
   */
  private syncImageOverlay(): void {
    const sel = this.liveImageSelection();
    const box = sel ? this.boxForPage(sel.pageId) : null;
    this.imageUiEl.toggleClass("is-hidden", !sel || !box || this.cropping !== null);
    this.syncCropOverlay();
    this.syncActionBar();
    if (!sel || !box || this.cropping) return;
    const scale = this.unitScale;
    const drag = this.imageDrag;
    const t = drag && drag.image === sel.image ? drag.draft : transformOf(sel.image);
    this.imageFrameEl.setCssStyles({
      left: `${(box.x + t.x) * scale}px`,
      top: `${(box.y + t.y) * scale}px`,
      width: `${t.w * scale}px`,
      height: `${t.h * scale}px`,
      transform: `rotate(${rotationOf(t)}rad)`,
    });
    const fit = edgeHandlesFit(t, HANDLE_HIT_RADIUS_PX / scale);
    this.imageFrameEl.toggleClass("no-ns", !fit.ns);
    this.imageFrameEl.toggleClass("no-ew", !fit.ew);
  }

  /**
   * A press on the selected image's frame or one of its handles. The pure
   * hit test decides what was grabbed, so handles answer across 44 screen px
   * at any zoom, and the drag is tracked on the frame by pointer capture.
   * A corner resizes with the aspect kept, an edge stretches one way, the
   * knob below turns the picture, and anywhere else moves it.
   */
  private readonly onImagePointerDown = (event: PointerEvent): void => {
    // Everything on the frame is the frame's: the page below never sees it.
    event.stopPropagation();
    event.preventDefault();
    const sel = this.liveImageSelection();
    if (!sel || this.imageDrag || this.callbacks.isLocked?.()) return;
    const box = this.boxForPage(sel.pageId);
    if (!box) return;
    const from = this.pagePoint(box, event.clientX, event.clientY);
    const scale = this.unitScale;
    const start = transformOf(sel.image);
    const part =
      hitImagePart(start, from, HANDLE_HIT_RADIUS_PX / scale, ROTATE_HANDLE_OFFSET_PX / scale) ??
      "body";
    const grabbed = part === "body" || part === "rotate" ? from : imageHandlePoint(start, part);
    try {
      this.imageFrameEl.setPointerCapture(event.pointerId);
    } catch {
      // A synthetic pointer (a test harness) cannot be captured; moves still arrive.
    }
    this.imageDrag = {
      pointerId: event.pointerId,
      part,
      pageId: sel.pageId,
      image: sel.image,
      start,
      from,
      grab: { x: grabbed.x - from.x, y: grabbed.y - from.y },
      clientX: event.clientX,
      clientY: event.clientY,
      draft: start,
      lifted: false,
    };
    this.imageUiEl.addClass("is-dragging");
    this.imageFrameEl.addEventListener("pointermove", this.onImagePointerMove);
    this.imageFrameEl.addEventListener("pointerup", this.onImagePointerEnd);
    this.imageFrameEl.addEventListener("pointercancel", this.onImagePointerEnd);
  };

  private readonly onImagePointerMove = (event: PointerEvent): void => {
    const drag = this.imageDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.stopPropagation();
    event.preventDefault();
    const moved = Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY);
    if (!drag.lifted && moved < IMAGE_DRAG_SLOP_PX) return;
    const box = this.boxForPage(drag.pageId);
    if (!box) return;
    const p = this.pagePoint(box, event.clientX, event.clientY);
    switch (drag.part) {
      case "body":
        drag.draft = moveImage(drag.start, p.x - drag.from.x, p.y - drag.from.y, box);
        break;
      case "rotate":
        drag.draft = rotateImage(drag.start, drag.from, p);
        break;
      default:
        drag.draft = dragImageHandle(drag.start, drag.part, {
          x: p.x + drag.grab.x,
          y: p.y + drag.grab.y,
        });
    }
    if (!drag.lifted) this.liftImage(drag, box);
    this.renderImageDraft();
    this.syncImageOverlay();
  };

  /**
   * The lift commits the whole gesture as one `TransformImage`. A
   * pointercancel commits too: iOS can cancel an ordinary lift, and a drag
   * that snapped back would read as the app refusing the move.
   */
  private readonly onImagePointerEnd = (event: PointerEvent): void => {
    const drag = this.imageDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.stopPropagation();
    this.endImageDrag(true);
  };

  /** Take the dragged image out of the tiles and draw it on the wet layer instead. */
  private liftImage(drag: ImageDrag, box: PageBox): void {
    drag.lifted = true;
    this.renderer?.setHiddenImages(new Set([drag.image]));
    this.renderer?.invalidateRegion(box.index, imageBounds(drag.start));
    this.renderDry();
  }

  private renderImageDraft(): void {
    const drag = this.imageDrag;
    const box = drag ? this.boxForPage(drag.pageId) : null;
    if (!drag || !box) return;
    // A cropped or flipped picture is dragged as it is: the draft is a full copy.
    this.renderer?.renderImageDraft(box.index, placedAt(drag.image, drag.draft));
  }

  /**
   * Finish an image drag: commit it (`commit`) or drop it, then put the
   * image back into the tiles where it was and where it now is.
   */
  private endImageDrag(commit: boolean): void {
    const drag = this.imageDrag;
    if (!drag) return;
    this.imageDrag = null;
    this.imageFrameEl.removeEventListener("pointermove", this.onImagePointerMove);
    this.imageFrameEl.removeEventListener("pointerup", this.onImagePointerEnd);
    this.imageFrameEl.removeEventListener("pointercancel", this.onImagePointerEnd);
    if (this.imageFrameEl.hasPointerCapture(drag.pointerId)) {
      this.imageFrameEl.releasePointerCapture(drag.pointerId);
    }
    this.imageUiEl.removeClass("is-dragging");
    if (!drag.lifted) {
      this.syncImageOverlay();
      return;
    }
    this.renderer?.setHiddenImages(NO_IMAGES);
    this.renderer?.clearWet();
    const box = this.boxForPage(drag.pageId);
    const page = this.doc.pages.find((candidate) => candidate.id === drag.pageId);
    const changed =
      commit && page?.images.includes(drag.image) && !sameTransform(drag.start, drag.draft);
    if (box) {
      const dirty = changed
        ? unionBounds(imageBounds(drag.start), imageBounds(drag.draft))
        : imageBounds(drag.start);
      if (dirty) this.renderer?.invalidateRegion(box.index, dirty);
    }
    if (changed) {
      this.history.push(this.doc, new TransformImage(drag.pageId, drag.image.id, drag.draft));
    }
    this.renderDry();
    this.syncImageOverlay();
    if (changed) this.changed();
  }

  /** Abandon an image drag without committing it (a reload, an undo, a tool change). */
  private cancelImageDrag(): void {
    this.endImageDrag(false);
  }

  // --- Undo and redo ----------------------------------------------------------------

  undo(): void {
    this.stepHistory((doc) => this.history.undo(doc));
  }

  redo(): void {
    this.stepHistory((doc) => this.history.redo(doc));
  }

  /**
   * One step back or forward. A drag or crop in progress is dropped first,
   * since the step may take its element away; afterwards everything the
   * surface derives from the document is rebuilt, and the change is shown.
   */
  private stepHistory(step: (doc: InkDocument) => Command | null): void {
    this.parkedText = null;
    this.endCrop(false);
    this.cancelImageDrag();
    this.cancelGroupDrag();
    const place = this.readingPlace();
    const command = step(this.doc);
    if (!command) return;
    // What was selected may have moved, gone or come back: start afresh.
    this.dropSelection();
    this.strokeIndex.rebuild(this.doc.pages);
    this.renderer?.invalidateAll();
    if (this.layoutStale()) this.layout();
    if (command.keepsReading) this.keepReading(place);
    this.renderAll();
    this.reportTextEditing();
    this.changed();
    this.revealChange(command);
  }

  /** Whether Undo would do anything. */
  get canUndo(): boolean {
    return this.history.canUndo();
  }

  /** Whether Redo would do anything. */
  get canRedo(): boolean {
    return this.history.canRedo();
  }

  /**
   * Show what an undo or redo changed. A change on a page that is off
   * screen glides that page into view, so it can never happen unseen —
   * GoodNotes changes such a page silently (research/goodnotes-smoothness §4).
   */
  private revealChange(command: Command): void {
    const id = command.pageId;
    const index = id === undefined ? -1 : this.doc.pages.findIndex((page) => page.id === id);
    if (index >= 0 && this.visiblePageRect(index) === null) this.goToPage(index, true);
    // Which page changed, even when it was already on screen.
    else this.flashChrome();
  }

  /** Tell the host when undo or redo becomes (un)available. */
  private syncHistory(): void {
    // The off-page notice's Undo means that stroke; once it is not the
    // latest step (more ink, an undo, a withdrawn loop) the notice goes.
    if (this.offPageCommand && !this.history.isLatest(this.offPageCommand)) this.hideOffPage();
    if (this.textCopyCommand && !this.history.isLatest(this.textCopyCommand)) this.hideTextCopy();
    const canUndo = this.history.canUndo();
    const canRedo = this.history.canRedo();
    const shown = `${canUndo}/${canRedo}`;
    if (shown === this.historyShown) return;
    this.historyShown = shown;
    this.callbacks.onHistoryChange?.(canUndo, canRedo);
  }

  /** The document no longer matches the layout: its scroll direction or page count changed. */
  private layoutStale(): boolean {
    return (
      scrollDirectionOf(this.doc) !== this.direction ||
      this.pageLayout.boxes.length !== this.doc.pages.length
    );
  }

  // --- Text editing (0.5) -----------------------------------------------------

  /** The page text box that has focus, if any. */
  private editingTextView(): TextBoxView | null {
    const active = document.activeElement;
    for (const view of this.textBoxInputs.values()) {
      if (view.input === active) return view;
    }
    return null;
  }

  /**
   * The box the text pill acts on: the one being typed in, else the one held
   * without the keyboard (a tap beside it, or a finger tap on it with
   * another tool).
   */
  private textTargetView(): TextBoxView | null {
    const view = this.editingTextView() ?? this.heldText;
    return view && this.liveTextBox(view.pageId, view.id) ? view : null;
  }

  /** Tell the host the style of the box the pill acts on, after something may have changed it. */
  private reportTextEditing(): void {
    const view = this.textTargetView();
    const live = view ? this.liveTextBox(view.pageId, view.id) : undefined;
    if (live) this.callbacks.onTextEditing?.(textStyleOf(live));
    this.reportTextAnchor();
  }

  /**
   * Tell the host where the pill's box is on screen now, if that changed
   * (see `onTextAnchor`). One measure per call, and only while there is a
   * box: cheap enough for every frame of a scroll.
   */
  private reportTextAnchor(): void {
    if (!this.callbacks.onTextAnchor) return;
    const view = this.textTargetView();
    const box = view ? view.root.getBoundingClientRect() : null;
    const typing = view !== null && view === this.editingTextView();
    // The part of the screen the page shows: on the iPad the window and the
    // toolbar's host reach below it, so a box can be gone from the page and
    // still inside them.
    const page = this.surfaceEl.getBoundingClientRect();
    const rect =
      box && box.width > 0 && box.height > 0
        ? {
            left: box.left,
            top: box.top,
            right: box.right,
            bottom: box.bottom,
            typing,
            clipTop: page.top,
            clipBottom: page.bottom,
            moving: this.textAnchorMoving,
          }
        : null;
    const key = rect
      ? [rect.left, rect.top, rect.right, rect.bottom, page.top, page.bottom]
          .map(Math.round)
          .join(",") + `,${typing},${this.textAnchorMoving}`
      : "";
    if (key === this.textAnchorKey) return;
    this.textAnchorKey = key;
    this.callbacks.onTextAnchor?.(rect);
  }

  /** Finish editing the focused text box, if there is one (the blur handler does the rest). */
  private blurTextBox(): void {
    this.editingTextView()?.input.blur();
  }

  /**
   * The lift of a Text-tool tap beside a box. The first tap beside the box
   * being edited stops the typing — the keyboard goes — but keeps the box,
   * framed with its handles, so it can be moved or resized straight away;
   * the second lets go of it. GoodNotes does this, where one tap dropped
   * the box at once (research/goodnotes-smoothness §7).
   */
  private finishTextDismiss(): boolean {
    const dismiss = this.textDismiss;
    const release = this.textRelease;
    if (!dismiss && !release) return false;
    this.textDismiss = false;
    this.textRelease = false;
    this.activePage = null;
    if (release) {
      this.releaseHeldText(true);
      return true;
    }
    const view = this.editingTextView();
    if (view) {
      this.heldText = view;
      view.root.addClass("is-held");
      view.input.blur();
      // The blur handed the pill back to the tool: the held box keeps it.
      this.reportTextEditing();
    }
    return true;
  }

  /**
   * Let go of the box a first tap kept (see `finishTextDismiss`). With
   * `handBack`, the unpinned Text tool then hands back the tool used before
   * it, as it would have when the typing stopped.
   */
  private releaseHeldText(handBack = false): void {
    const view = this.heldText;
    if (!view) return;
    this.heldText = null;
    this.heldReturnTool = null;
    window.clearTimeout(this.heldTapTimer);
    this.heldTapTimer = 0;
    view.root.removeClass("is-held", "is-tappable");
    // The pill goes back to the tool's own style, unless typing goes on elsewhere.
    if (!this.editingTextView()) this.callbacks.onTextEditing?.(null);
    this.reportTextAnchor();
    if (handBack) this.handBackFromText();
  }

  /**
   * An unpinned Text tool hands back the tool used before it (GoodNotes'
   * default), or the pen with "Return to pen after one use". A pinned one
   * stays: the pin is the choice made for this tool, so it wins over the
   * general setting.
   */
  private handBackFromText(): void {
    if (this.toolState.tool !== "text" || this.editingTextView() || this.parkingText) return;
    if (this.toolState.textPinned === true) return;
    if (this.callbacks.returnToPenAfterUse?.() === true) {
      this.completeToolUse("text");
      return;
    }
    const back =
      this.toolBeforeText && this.toolBeforeText !== "text" ? this.toolBeforeText : "pen";
    this.setTool(back);
    this.callbacks.onToolChange?.(back);
  }

  /**
   * The text pill's list button: make the lines under the caret a bulleted
   * or numbered list, or plain again. Returns false when no box is being
   * edited. The markers are text, so this is an edit like typing.
   */
  applyTextList(kind: ListKind): boolean {
    const view = this.textTargetView();
    if (!view) return false;
    if (this.callbacks.isLocked?.()) return true;
    const { input } = view;
    // A held box has no caret: the list takes every line.
    const typing = view === this.editingTextView();
    this.setTextInput(
      input,
      toggleList(
        input.value,
        typing ? input.selectionStart : 0,
        typing ? input.selectionEnd : input.value.length,
        kind,
      ),
    );
    return true;
  }

  /**
   * The text pill's delete button: remove the box being edited, text and
   * all, as one undoable step (Undo brings it back as it was). Returns false
   * when no box is being edited.
   */
  deleteEditingTextBox(): boolean {
    const view = this.textTargetView();
    const live = view ? this.liveTextBox(view.pageId, view.id) : undefined;
    if (!view || !live) return false;
    if (view === this.heldText && view !== this.editingTextView()) {
      if (this.callbacks.isLocked?.()) return true;
      this.history.push(this.doc, new RemoveTextBoxFromPage(view.pageId, view.id));
      this.releaseHeldText(true);
      this.syncTextBoxes();
      this.changed();
      return true;
    }
    if (this.callbacks.isLocked?.()) return true;
    // A box deleted on purpose is recorded as a removal, never withdrawn
    // with its creation as an empty box is.
    if (this.lastTextBoxAdd?.key === `${view.pageId}:${view.id}`) this.lastTextBoxAdd = null;
    this.history.push(this.doc, new RemoveTextBoxFromPage(view.pageId, view.id));
    // Removed first, so the blur finds nothing left to tidy, then ends the
    // edit the usual way: keyboard down, the pill back to the tool.
    view.input.blur();
    this.syncTextBoxes();
    this.changed();
    return true;
  }

  /** Put an edit into a box's textarea and let it take the path typing takes. */
  private setTextInput(input: HTMLTextAreaElement, edit: TextEdit): void {
    input.value = edit.text;
    input.setSelectionRange(edit.selectionStart, edit.selectionEnd);
    input.dispatchEvent(new Event("input"));
  }

  /**
   * Apply a text-pill change to the box being edited, as one undoable step.
   * Returns false when no box is being edited (the pill then only changed the
   * style new boxes get). A change that alters nothing records nothing.
   */
  applyTextStyle(patch: TextStylePatch): boolean {
    const view = this.textTargetView();
    const live = view ? this.liveTextBox(view.pageId, view.id) : undefined;
    if (!view || !live) return false;
    if (this.callbacks.isLocked?.()) {
      // Refused: put the pill back on the box's real style.
      this.reportTextEditing();
      return true;
    }
    if (!changesTextStyle(live, patch)) return true;
    const key = `${view.pageId}:${view.id}`;
    this.pushTextCommand(key, new SetTextBoxStyle(view.pageId, view.id, patch));
    this.syncTextBoxes();
    this.changed();
    return true;
  }

  /**
   * A text box stopped being edited — it blurred, or a move that blurred it
   * has landed. An empty one goes, the host's pill returns to the tool's own
   * style, and an unpinned Text tool hands back the tool used before it
   * (GoodNotes' default). Not reached while a handle drag holds the box, nor
   * when focus went straight into another box.
   */
  private endTextEditing(view: TextBoxView): void {
    this.watchTypingKeyboard(false);
    this.releaseTextEditingClass();
    this.removeIfEmpty(view);
    // Typed in with the lasso: the keyboard went, the box stays selected
    // with its options beside it, as in GoodNotes, until a tap beside it.
    if (this.toolState.tool === "select" && this.liveTextBox(view.pageId, view.id)) {
      const back = this.heldReturnTool;
      this.holdTextBox(view, back, false);
      return;
    }
    this.callbacks.onTextEditing?.(null);
    this.reportTextAnchor();
    if (this.heldText === view) {
      // Kept by a tap beside it: the tool waits for the tap that lets go —
      // unless the box was empty and has just gone.
      if (this.liveTextBox(view.pageId, view.id)) {
        // Only a Text tool about to hand back lets go at once; a pinned one stays.
        const returning =
          this.callbacks.returnToPenAfterUse?.() === true && this.toolState.textPinned !== true;
        if (!returning) return;
        this.releaseHeldText();
      } else {
        this.heldText = null;
      }
    }
    this.handBackFromText();
  }

  /** A box has focus: keep Obsidian's keyboard cap lifted (see TEXT_EDITING_BODY_CLASS). */
  private holdTextEditingClass(): void {
    window.clearTimeout(this.textClassTimer);
    this.textClassTimer = 0;
    document.body.addClass(TEXT_EDITING_BODY_CLASS);
  }

  /**
   * Put Obsidian's keyboard cap back — but only once doing so cannot resize
   * the page under the user's finger.
   *
   * The cap is `max-height: calc(100vh - var(--keyboard-height))` on the app
   * container (ledger: "Obsidian's iPad keyboard cap collapsed the page to
   * zero height"). Dropping the class the moment a box blurs re-applies it
   * while the keyboard is still sliding down and `--keyboard-height` is still
   * large, so the container — and this surface with it — shrinks, then grows
   * back as the value falls. Mid-drag, that jumped the page under the finger
   * moving a box. So the class stays until no handle drag is in progress
   * **and** `--keyboard-height` reads 0, when the cap is `100vh` and changes
   * nothing. The timeout covers a value that never returns to 0.
   */
  private releaseTextEditingClass(): void {
    window.clearTimeout(this.textClassTimer);
    let deadline = now() + TEXT_CLASS_RELEASE_MS;
    const attempt = (): void => {
      this.textClassTimer = 0;
      if (!this.renderer || this.editingTextView()) return;
      if (this.textFrameDrag !== null) {
        // The clock starts when the drag ends.
        deadline = now() + TEXT_CLASS_RELEASE_MS;
      } else if (keyboardHeight() === 0 || now() >= deadline) {
        document.body.removeClass(TEXT_EDITING_BODY_CLASS);
        // The zoom floor was held while the keyboard was up; catch it up now.
        this.scheduleRelayout();
        return;
      }
      this.textClassTimer = window.setTimeout(attempt, TEXT_CLASS_POLL_MS);
    };
    attempt();
  }

  /** Show the Text tool's hint pill; `onDismiss` runs when its × is tapped. */
  showTextHint(text: string, onDismiss: () => void): void {
    this.textHintLabel.setText(text);
    this.textHintDismiss = onDismiss;
    this.textHintEl.removeClass("is-hidden");
  }

  hideTextHint(): void {
    this.textHintDismiss = null;
    this.textHintEl.addClass("is-hidden");
  }

  /**
   * Remove every stroke on the page being read (one undoable step).
   * Returns false when that page is already empty.
   */
  clearStrokes(): boolean {
    const page = this.pageAt(this.pageIndex);
    if (!page || page.strokes.length === 0) return false;
    this.history.push(this.doc, new ClearPage(page.id));
    this.renderer?.invalidatePage(page.id);
    this.strokeIndex.clearPage(page.id);
    this.clearSelection();
    this.inkChanged();
    return true;
  }
}

/** The recogniser's full verdict on a stroke, one line, for the diagnostics. */
function verdictOf(pts: number[], held: boolean): string {
  const e = explainShape(pts, { held });
  const scored = e.candidates.map((c) => `${c.kind}:${c.confidence.toFixed(2)}`).join(" ");
  return `${e.closed ? "closed" : "open"} n=${e.n} diag=${Math.round(e.diag)} gap=${Math.round(e.gap)} [${scored}]`;
}

/** How long after a stylus button goes down a right-click menu is taken to be its doing, ms. */
const STYLUS_MENU_MS = 1500;

/**
 * Whether Cmd, not Ctrl, is the command key: macOS, where Ctrl+click is the
 * right click, and an iPad with a keyboard.
 */
function macKeys(): boolean {
  return Platform.isMacOS || Platform.isIosApp;
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** Whether an event's target is a page text box, or inside one. */
function onTextBox(target: EventTarget | null): boolean {
  return (target as Element | null)?.closest(".goodobsidian-page-textbox") != null;
}

/** Everything on a page the lasso could pick up: a locked picture stays put. */
function selectablesOf(page: Page): ElementLists {
  return {
    strokes: page.strokes,
    images: page.images.filter((image) => image.locked !== true),
    textBoxes: page.textBoxes,
  };
}

function onSelectionMenu(target: EventTarget | null): boolean {
  return (target as Element | null)?.closest(".goodobsidian-selection-menu") != null;
}

/** Whether an event's target takes typing of its own: a field, or anything editable. */
/** A control space presses (a toolbar or menu button). */
function isButtonLike(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return false;
  return el.closest("button, [role='button'], a[href]") !== null;
}

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

/**
 * The first picture file a paste carries, or `null`. Looked for in `files`
 * and then among the items, since engines fill one or the other.
 */
function imageFileOf(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const file of Array.from(data.files)) {
    if (file.type.startsWith("image/")) return file;
  }
  for (const item of Array.from(data.items)) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) return file;
  }
  return null;
}

/** `setIcon`, with a text fallback for mobile builds where an icon comes up blank. */
function iconInto(el: HTMLElement, icon: string, fallback: string): void {
  setIcon(el, icon);
  const svg = el.querySelector("svg");
  if (!svg || svg.childElementCount === 0) {
    el.empty();
    el.setText(fallback);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function unionBounds(a: Bounds | null, b: Bounds | null): Bounds | null {
  if (!a) return b;
  if (!b) return a;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

function shiftBounds(b: Bounds, dx: number, dy: number): Bounds {
  return { minX: b.minX + dx, minY: b.minY + dy, maxX: b.maxX + dx, maxY: b.maxY + dy };
}

/** Every scroll position a focus might disturb, so it can be put back. */
interface ScrollSnapshot {
  top: number;
  left: number;
  windowX: number;
  windowY: number;
  ancestors: Array<{ el: Element; top: number; left: number }>;
}

/** What an insert-space drag will do, for the readout while it is dragged. */
export function spaceReadout(plan: SpacePlan): string {
  const n = Math.abs(plan.lines);
  const lines = `${n} ${n === 1 ? "line" : "lines"}`;
  if (plan.lines < 0) return `Remove ${lines}`;
  const parts = [`Insert ${lines}`];
  if (plan.spilled > 0) parts.push("some ink moves to the next page");
  if (plan.addedPages > 0) parts.push(plan.addedPages === 1 ? "adds a page" : "adds pages");
  return parts.join(" · ");
}
