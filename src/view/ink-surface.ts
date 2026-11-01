import { bindScrollThumb } from "./scroll-thumb-drag";
import { type PdfRenderArea, boundsMeet } from "../canvas/pdf-raster";
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
  inkReach,
  penFor,
  paperColorOf,
  renderPageThumbnail,
  tableLayoutOf,
} from "../canvas/renderer";
import { GraphExplorer } from "./graph-explore";
import { FloatingWindow } from "./floating-window";
import { pageTabs } from "../model/page-tabs";
import type { WindowPlace } from "../model/calculator-store";
import {
  ZOOM_AUTO_ADVANCE_DELAY_MS,
  panToShow,
  previousZoomBox,
  resizeZoomBox,
  scaleZoomBox,
  zoomAutoAdvanceDue,
  zoomBoxFromPoints,
  zoomBoxGestureZoom,
  zoomCatcherWanted,
  zoomDeskColor,
  zoomTargetPress,
  zoomView,
  zoomViewPoint,
  zoomViewPointFree,
  type ZoomPage,
  type ZoomPlace,
  autoAdvanceAcrossPages,
  dragZoomBoxAcrossPages,
  newLineAcrossPages,
  pinchZoomBox,
  placedZoomBox,
  zoomWindowDragAllowed,
  zoomWindowPans,
  zoomWindowFirstPlace,
  type ZoomHandle,
  type ZoomRect,
} from "../model/zoom-box";
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
  anchorCorner,
  boundsCentre,
  boundsCorner,
  boxInLasso,
  clampGroupDelta,
  cornerScale,
  crossPageDelta,
  dropPageAt,
  hitSelectionCorner,
  hitSelectionKnob,
  joinedDelta,
  lassoTakesStroke,
  minScaleForSide,
  paperBox,
  polygonOf,
  rectLoop,
  scaleBounds,
  selectionKnobPoint,
  smoothPath,
  selectionBounds,
  isLoneShape,
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
  imageCentre,
  imageHandlePoint,
  moveImage,
  rotateHandlePoint,
  rotationOf,
  sameTransform,
  sweptTurn,
  topImageAt,
  transformOf,
  withRotation,
} from "../canvas/image-geometry";
import { TurnSnap, shapeAngleOf } from "../canvas/turn-snap";
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
import { erasedPieces, erasesGrey } from "../canvas/erase-look";
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
  rowGapAtZoom,
  ROW_PULL_ADD_PX,
  PULL_ADD_PAGE_PX,
  rowEdgeTurn,
  pullAddAllowed,
  rowTurnsPages,
  scrollTopForPage,
  inkBeyondPage,
  boardCentre,
  boardScrollRange,
  boardScrollToCentre,
  layoutBoard,
} from "../canvas/page-layout";
import { movePagePts, pagesReached } from "../canvas/page-join";
import {
  MirrorSync,
  MoveToPage,
  elementBounds,
  findOwner,
  isMirror,
  mirrorRegions,
  mirrorsBefore,
  ownerKey,
  ownerOf,
  planMirrors,
  strokeReach,
} from "../canvas/mirrors";
import {
  MIN_TAPE_LENGTH,
  isTape,
  tapeClipPath,
  tapeColorOf,
  tapeHeightOf,
  tapePoints,
  toggleRevealed,
  topTapeAt,
} from "../model/cover-tape";
import { strokeFillHit, strokeHitByPoint } from "../canvas/hit-test";
import { type FillInk, bucketFill, insidePolygon } from "../canvas/bucket-fill";
import {
  AddFill,
  RecolorFill,
  DEFAULT_FILL_COLOR,
  enclosedArea,
  fillGapPx,
  fillInsertIndex,
  fillStroke,
  isBucketFill,
  readFillGap,
  sameFill,
} from "../model/fill-region";
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
import { FormatPainter } from "./format-painter";
import { PaintStyle, dominantInkStyle } from "../model/format-painter";
import {
  type EraserFilter,
  eraseCircleFromStroke,
  eraseRectsFromStroke,
  eraserTakes,
} from "../ink/stroke-eraser";
import {
  MAX_SCALE,
  anchorScrollDelta,
  boardFitZoom,
  pinchOpensOverview,
  fitPageZoom,
  nextZoomFloor,
  wheelZoomFactor,
  doubleTapZoom,
  pageFillZoom,
  zoomAnchorFor,
} from "../canvas/zoom";
import { KineticScroller, easeOutCubic, softZoom } from "../canvas/scroll-physics";
import { pairsAsDoubleTap, type PlainTap } from "../input/multi-finger-tap";
import { scrollThumb } from "../canvas/scroll-thumb";
import { WRITING_SCALE, zoomPercent } from "../model/units";
import { GrowBoard, boardGrowth, drawnBounds, isBoard, isNoGrowth } from "../model/board";
import { type PageSnapshot, prefersReducedMotion } from "./motion";
import {
  BRUSH_PRESSURE,
  type Smoothing,
  StrokeBuilder,
  type StrokeBuilderOptions,
  stabilizationReach,
} from "../ink/stroke-builder";
import { stabilizationOf } from "../model/pen-stabilization";
import { InkTracer } from "../ink/freehand";
import { TILT_MAX_FACTOR, tiltFactor, tiltShapes } from "../ink/tilt";
import { lineOfHighlight } from "../ink/straighten";
import { LINE_LEVEL_RISE, levelLine, levelTurn } from "../ink/level-line";
import { explainShape, recognizeAtZoom } from "../ink/shape-recognizer";
import { SNAP_RADIUS_PX, ShapeSnapper, penForPoint } from "../ink/shape-snap";
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
  HEART_ASPECT,
  STAR_ASPECT,
  type ShapePreset,
  type BoxPreset,
  isClosedKind,
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
  blankPage,
  type ImageCrop,
  type ImageElement,
  type InkDocument,
  type Page,
  type PageGeometry,
  type PdfBackdrop,
  type ShapeKind,
  CONNECTOR_SIDES,
  POINT_STRIDE,
  type ConnectorSide,
  type ShapeConnector,
  type Stroke,
  type GraphElement,
  type TableElement,
  type TextBoxElement,
  type Tool,
  strokeBounds,
  strokeCount,
  type PageComment,
} from "../model/document";
import {
  type TextLayout,
  type TextSelection,
  selectText,
  textMarkNote,
  textUnder,
} from "../canvas/pdf-text";
import { type PageLink, linkAt, notebookPageOf } from "../canvas/pdf-links";
import { highlightText, isHighlight, textHighlightStrokes } from "../model/text-highlight";
import { DUPLICATE_OFFSET, duplicateImage, nextImageId } from "../model/images";
import {
  TABLE_MIN_COL,
  TABLE_MIN_ROW,
  cellStyleOf,
  cellText,
  makeTable,
  nextTableId,
  setCellStyle,
  setCellText,
  stepCell,
  tableScaleRange,
} from "../model/table";
import { EditGraph, graphBounds, nextGraphId } from "../model/graph-element";
import {
  AddTable,
  InsertTableColumn,
  InsertTableRow,
  RemoveTableColumn,
  RemoveTableRow,
  ResizeTableColumn,
  ResizeTableRow,
  SetTableCell,
  SetTableCellStyle,
  SetTableHeader,
} from "../model/table-commands";
import {
  type PageSize,
  floatedTop,
  furthestFitting,
  insertColumnWithin,
  insertRowWithin,
  keepsToPage,
} from "../model/table-fit";
import {
  type CellRef,
  type TableLayout,
  cellAt,
  cellFrame,
  cellStyle,
  layoutTable,
} from "../canvas/table-layout";
import { type TableAction, TableCellEditor } from "./table-cell-editor";
import {
  AddElements,
  type ElementLists,
  type IdSource,
  type PageElements,
  MoveElementsToPage,
  RecolorStrokes,
  RemoveElements,
  ReshapeStroke,
  RestyleShapes,
  ReorientElements,
  type Reorientation,
  ScaleElements,
  TranslateElements,
  copyElements,
  elementsOnPage,
  isEmptySelection,
  reorientPoint,
  reorientPoints,
  scalePoints,
  translatePoints,
  textScaleRange,
} from "../model/selection-commands";
import {
  CropImage,
  type FlipAxis,
  FlipImage,
  type ImageLayer,
  ReorderImage,
  IMAGE_OPACITIES,
  SetImageLocked,
  SetImageFront,
  SetImageOpacity,
  canReorderImage,
} from "../model/image-commands";
import { InkClipboard, pasteCopies, pastePlacement, sameSpotTaken } from "../model/clipboard";
import {
  type NoteFrame,
  MoveNoteInk,
  SetNoteFolded,
  SetStickyColor,
  STICKY_COLORS,
  copyNoteInk,
  copyNoteText,
  foldedAway,
  foldedNoteAt,
  inkOfNote,
  isFolded,
  loneNote,
  noteAt,
  noteIdsOf,
  noteOfText,
  noteTextFrame,
  shownAt,
  textOfNote,
  withNoteInk,
  withNoteText,
} from "../model/sticky-notes";
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
import { SetTask, inkBounds, taskBoxRect, tasksOf, tickTask } from "../model/tasks";
import { TurnInkIntoText, inkTextBox, sharedInkColor } from "../model/ink-to-text";
import { fadeChanges } from "../audio/replay";
import { textSegments } from "../model/text-links";
import type { HandwrittenLink } from "../recognition/handwritten-links";
import { strokeKey } from "../recognition/hwr/corrections";
import { segmentPage } from "../recognition/hwr/lines";
import { median } from "../recognition/hwr/numeric";
import {
  type Command,
  type ImageTransform,
  InsertImage,
  RemoveImage,
  TransformImage,
} from "../model/commands";
import { ReplaceStrokesOnPage, type StrokeReplacement } from "../model/erase-commands";
import { addStrokesTimed } from "../model/recording-commands";
import { SetTextBoxStyle, SetTextBoxText } from "../model/text-commands";
import {
  DEFAULT_TEXT_STYLE,
  type TextStyle,
  type TextStylePatch,
  changesTextStyle,
  fontFamilyOf,
  lineHeightOf,
  normalizeBorder,
  shownCase,
  textStyleOf,
} from "../model/text-style";
import {
  type ListKind,
  type TextEdit,
  continueList,
  setTaskDone,
  taskBoxes,
  toggleList,
} from "../model/text-list";
import { keyboardHeight } from "./keyboard";
import { type ViewSpot, carriedOutOfSight, revealDelta, showsIn } from "./text-reveal";
import { DEFAULT_SHAPE_COLOR, pushRecentColor, sameColor } from "../model/colors";
import { canvasFont, fitTextWidth, textDecorationOf, textInset } from "../canvas/text-layout";
import { History, historyNotice } from "../model/history";
import {
  PointerController,
  type PointerControllerCallbacks,
  type PointerDebugRecord,
  type PointerSample,
  type PressRoute,
  deliversCoalescedSamples,
} from "../input/pointer-controller";
import { undoesPalm } from "../input/palm-rejection";
import { FingerGesture, type PinchInfo } from "../input/finger-gesture";
import {
  type FingerTurn,
  type TurnMotion,
  fingerTurnMotion,
  fingersOnSelection,
  isStill,
  startFingerTurn,
  stepFingerTurn,
  turnCommand,
  turnFrame,
  turnPoint,
} from "../canvas/selection-turn";
import {
  type BarrelAction,
  type PressInput,
  barrelActionOf,
  dragZoom,
  pressOverride,
  stylusButtonDown,
} from "../input/pen-modifiers";
import {
  LASER_COLOR,
  LASER_GLOW_PX,
  LASER_WIDTH_PX,
  type LaserPoint,
  LaserTrail,
  laserPaths,
} from "../canvas/laser-trail";
import { REJOIN_MS, REJOIN_PX, rejoinsStroke } from "../input/pen-rejoin";
import { cancelsStylusTouch, hasStylusTouch } from "../input/stylus-touch";
import { type StylusClickAction, stylusClickActionOf } from "../input/stylus-click";
import {
  type ActiveTool,
  type ToolbarState,
  eraserFilterFor,
  eraserModeFor,
  eraserSizeFor,
  lassoFilterFor,
  lassoModeFor,
  penTypeFor,
  shapeModeFor,
  strokeWidthFor,
  tableSizeFor,
} from "./toolbar";
import type { HighlighterTip, SnapMode } from "../settings-data";
import { SelectionActionBar, onTap } from "./selection-bar";
import { swallowGhostClick } from "./ghost-click";
import { edgeScrollSpeed } from "./page-drag-model";
import { CalcChip } from "./calc-chip";
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
import { joinedPagesOf } from "../model/joined-pages";
import type { SelectionAction } from "./selection-bar-model";
import { selectionKind, selectionMenu } from "./selection-kind";
import { writePngToClipboard } from "./picture-clipboard";
import { type KeyAction, keyOutcome } from "./surface-keys";
import {
  type PointerReading,
  type ShortcutInput,
  type ShortcutMatch,
  type ShortcutRow,
  type ShortcutTable,
  buttonBit,
  buttonInput,
  keyInput,
  matchShortcut,
} from "../model/shortcut-bindings";
import {
  type ToolLift,
  type ToolUse,
  continuesUse,
  drawingToolOf,
  selectedTool,
  toolAfterUse,
} from "./tool-return";
import { inkTargetAt } from "./ink-target";
import { PointerHud } from "./pointer-hud";
import { type TextEndRecord, textEndLine } from "./text-end-hud";
import { SizeWait, backingScale } from "./surface-size";
import { StrokeIndex } from "./stroke-index";
import { REST_MS, ViewRest } from "./view-rest";
import { IdSequence, strokeIdsOf, textBoxIdsOf } from "./id-sequence";
import { type PenCursorStyle, cursorCss, cursorFor, cursorSize, cursorToolOf } from "./pen-cursor";
import { type Span, toastSide } from "./toast-side";
import { RulerOverlay } from "./ruler-overlay";
import { type PointHandles, movePoint, pickPointHandle, pointHandles } from "../ink/shape-points";
import {
  besideOffset,
  boundsOfPts,
  connectorRoute,
  draggedOffset,
  facingSide,
  nearestSide,
  sideMiddle,
} from "../ink/connector-route";
import {
  CONNECTOR_WIDTH,
  type RoutedConnector,
  connectorBounds,
  routeConnectors,
} from "../canvas/connector-paint";
import {
  AddConnector,
  AddLinkedCopy,
  RetypeShape,
  liveConnectors,
  nextConnectorId,
} from "../model/connectors";
import { DEFAULT_RULER_SNAP } from "../canvas/ruler-geometry";

/** Zoom in multiplies the zoom by this, and Zoom out divides by it. */
const ZOOM_STEP = 1.25;

/**
 * Rasterising budget for a frame that is scrolling or zooming, in ms. The
 * rest of a 16.7 ms frame is the blits, the compositor and headroom; a tile
 * the budget skips is drawn from the page preview until the next frame.
 */
const SCROLL_FRAME_BUDGET_MS = 6;
/**
 * Rasterising budget for a frame at rest that has tiles to make with
 * something to stand in for them meanwhile: the last zoom's tiles, scaled,
 * or a page's preview. A zoom coming to rest made every tile on screen in
 * one frame, half a second with stacked highlights (the CPU slowed 4x), and
 * so did a PDF page arriving.
 */
const REST_FRAME_BUDGET_MS = 10;
/** Clear space round a sticker saved from a selection, page px: room for the ink's width. */
const STICKER_PAD = 8;
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
/** How long a zoom rests before the toolbar's width marks follow it. */
const SIZE_SCALE_SETTLE_MS = 150;
/** The page counter. */
const COUNTER_HOLD_MS = 1800;
/** The zoom readout, a beat after the counter. */
const ZOOM_READOUT_HOLD_MS = 2000;
/** The gap between linked ink and its underline, screen px. */
const LINK_UNDERLINE_GAP_PX = 3;
/** Room left round a word a search lit up, screen px. */
const SEARCH_MARK_PAD = 3;
/** Below a flagged word's ink, in screen px, to its dotted underline. */
const WORD_FLAG_GAP_PX = 5;
/** How far below the top of the view a section lands when the contents goes to it, screen px. */
const SECTION_LEAD_PX = 96;
/** How long "Undo" or "Redo" from a finger double tap stays in the readout pill. */
const READOUT_WORD_HOLD_MS = 900;
/** An undo or redo's notice ("Undid: Move selection") is a phrase: held longer. */
const READOUT_NOTICE_HOLD_MS = 1600;
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

/** How near ink a format painter's sweep must pass to paint it, screen px: the Pencil's tap reach. */
const PAINT_REACH_PX = 6;

/**
 * The standard eraser's margin for a brush stroke the Pencil's tilt widened
 * (`ink/tilt`): the cut reaches as far as its widest edge.
 */
const MAX_TILTED_HALF_WIDTH = MAX_STROKE_HALF_WIDTH * TILT_MAX_FACTOR;

/**
 * A cut piece's line starts again a sample past the cut, a little off the
 * stroke's own curve there: this much more (page px) round a cut is painted
 * again with it.
 */
const ERASE_CUT_MARGIN = 6;

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
  /** The global laser settings, read live so an open note follows Settings changes. */
  laserColor?: () => string;
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
  /** The Zoom box opened from a marquee or closed with its ×: the toolbar's switch follows. */
  onZoomBoxChange?: (open: boolean) => void;
  /**
   * The pen (or mouse) touched the page (true) or left it (false): the host
   * puts off work that would stall the ink until it has been up a moment.
   */
  onPen?: (down: boolean) => void;
  /**
   * A pen or mouse gesture began on a page with `tool`; `lent` when a stylus
   * button or a key lent that tool for this press only.
   */
  onGestureStart?: (tool: ActiveTool, lent: boolean) => void;
  /** A freehand pen stroke was drawn and committed on page `pageId` (calculation notes). */
  onStrokeDrawn?: (pageId: string, stroke: Stroke) => void;
  /** A pen or highlighter stroke snapped to a shape (Pen gestures › Make shapes). */
  onPenShape?: () => void;
  /**
   * Asked before every edit: true refuses it, for a note that must not be
   * written (the host says why).
   */
  isLocked?: () => boolean;
  /** A custom colour was picked (the lasso's recolour): the new recent list. */
  onRecentColors?: (colors: string[]) => void;
  /** "Save as sticker": the selection drawn as a transparent PNG, its size in page px. */
  onSaveSticker?: (png: ArrayBuffer, width: number, height: number) => void;
  /** Screenshot: the selection drawn on its paper as a PNG; the host offers Copy and Share. */
  onScreenshot?: (png: Blob, width: number, height: number) => void;
  /**
   * Screenshot of a patch of page `pageIndex` (page space): what a lasso
   * drawn round nothing offers, as Goodnotes does. The host draws the page
   * as it exports it (its paper, PDF and ink) and offers Copy and Share.
   */
  onRegionScreenshot?: (pageIndex: number, bounds: Bounds) => void;
  /**
   * "Edit graph" on a selected graph: the host opens the calculator with its
   * expressions, and commits what comes back (`EditGraph`). Without it the
   * selection bar offers Explore only.
   */
  onEditGraph?: (pageId: string, graph: GraphElement) => void;
  /** A key press switched tools; the host's toolbar should show the new one. */
  onToolChange?: (tool: ActiveTool) => void;
  /** A key (1 to 8) asked for saved pen `index` (FineNotes#25); the host applies it. */
  onSavedPen?: (index: number) => void;
  /** ? asked for the keyboard shortcuts; the host shows them. */
  onShortcuts?: () => void;
  /** This device's shortcut rows (`model/shortcut-bindings.ts`), read live. */
  shortcuts?: () => ShortcutTable;
  /**
   * Whether `tool`'s button is shown nowhere (Customize toolbar's "off"): a
   * shortcut then leaves it, as it would be in hand with no button showing it.
   */
  toolOff?: (tool: ActiveTool) => boolean;
  /** Run a shortcut action that belongs to the host (full screen, ruler, stickers…). */
  onShortcutAction?: (actionId: string) => boolean;
  /** What the stylus barrel button does (the settings); erase when absent. */
  barrelAction?: () => BarrelAction;
  /** What a click of the barrel button in the air does (the settings); the pen menu when absent. */
  stylusClick?: () => StylusClickAction;
  /** The barrel button was clicked in the air, at this client point; the host opens or closes the pen menu. */
  onStylusClick?: (clientX: number, clientY: number) => void;
  returnToPenOnReselect?: () => boolean;
  returnToPenAfterUse?: () => boolean;
  /** Whether highlighter strokes are drawn as straight runs (`ink/straighten.ts`); on when absent. */
  straightenHighlighter?: () => boolean;
  /** The highlighter's tip, read live (`settings.highlighterTip`); absent is round. */
  highlighterTip?: () => HighlighterTip;
  /** Whether the Brush pen keeps the Pencil's tilt ("Pencil tilt"); off when absent. */
  pencilTilt?: () => boolean;
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
  /** "Lasso takes what it touches" (settings, on unless it says false): any part of a stroke inside takes it. Read live. */
  lassoAnyPart?: () => boolean;
  /**
   * Stylus-only mode: every pointer but the pen is ignored on the page, so
   * a resting hand moves neither the ink nor the page. Read live, as the
   * toolbar and the settings may switch it while the note is open.
   */
  onlyStylusMode?: () => boolean;
  /** Page px added after each Zoom box line; negative overlaps the next line. */
  zoomBoxLineStep?: () => number;
  /** Whether the Zoom box advances after a stroke reaches its threshold. */
  zoomBoxAutoAdvance?: () => boolean;
  /** Percentage of the Zoom box's right edge that triggers auto-advance. */
  zoomBoxAutoAdvanceThreshold?: () => number;
  /** The Zoom box's auto-advance button changed the setting. */
  onZoomBoxAutoAdvance?: (on: boolean) => void;
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
  /** A cover tape was shown through or covered again (`model/cover-tape`). */
  onTapesToggled?: () => void;
  /**
   * {@link InkSurface.sizePreviewScales} changed (a zoom came to rest, or
   * the pane changed width), so the toolbar can redraw its width and
   * eraser-size marks at their size on the page now.
   */
  onSizeScale?: () => void;
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
  /**
   * Turn into › Task on a lasso selection of ink (2.5): the host asks what
   * it says, and applies `makeTask` for these stroke ids on page `index`.
   */
  onMakeTask?: (index: number, strokeIds: string[]) => void;
  /**
   * Turn into › Text on a lasso selection of ink (FineNotes#42): the host
   * asks what it says, then calls `turnInkIntoText` with the answer.
   */
  onTurnIntoText?: (index: number, strokeIds: string[]) => void;
  /** Open a link's target: a finger tap on linked ink, or Open link on its selection. */
  onOpenLink?: (target: string) => void;
  /** A comment's marker was tapped (`anchor` is the marker). */
  onTapComment?: (index: number, comment: PageComment, anchor: HTMLElement) => void;
  /** The press menu's Comment: pin a new comment at page point `at` of page `index`. */
  onAddComment?: (index: number, at: { x: number; y: number }) => void;
  /**
   * A finger tapped a `[[link]]` written by hand and found on the device:
   * the host offers to link those strokes to `target`.
   */
  onSuggestedLink?: (index: number, strokeIds: string[], target: string) => void;
  /**
   * A finger tapped (or a mouse right-clicked) a word underlined as maybe
   * misread (`setWordFlags`): the host asks what it says. `at` is the tap,
   * in client px.
   */
  onFlaggedWord?: (index: number, strokeIds: string[], at: { x: number; y: number }) => void;
  /**
   * "Correct" on lassoed ink, or on the press menu over ink: the host reads
   * the word these strokes are in (page `index`) and opens the same card
   * an underlined word does (`wordInk` places it under the word).
   */
  onCorrectWord?: (index: number, strokeIds: string[]) => void;
  /** Whether handwriting can be read here, so "Correct" is offered. */
  canCorrectWords?: () => boolean;
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
   * A pinch closed well past the fit and let go (`pinchOpensOverview`): show
   * every page in the overview. Only while the host enables it with
   * {@link InkSurface.setPinchToOverview}.
   */
  onPinchOverview?: (snapshot: PageSnapshot | null) => void;
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
  /** The page's links placed on the page, or null while it is not read. */
  peekLinks?(backdrop: PdfBackdrop, geometry: PageGeometry): PageLink[] | null;
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
  /**
   * The page scale the box was last laid out at (0: never). Mid-zoom the box
   * keeps that layout and is scaled whole from it (`zoomScaled`), so its
   * text cannot re-wrap or shift glyph by glyph as the font size passes
   * through fractional sizes: that read as the text wiggling.
   */
  laidAt: number;
  zoomScaled: boolean;
  /** When it was last focused (`now()`), for the HUD's text-end line. */
  focusedAt: number;
}

/** A text-tool drag shorter than this (page px) is a tap: a box that fits its text. */
const TEXT_TAP_SLOP = 12;
/** Narrowest a dragged or resized box may be, page px. */
const TEXT_MIN_W = 80;
const TEXT_MIN_H = 32;
/** How long after focusing a text box the surface owns scrolling (keyboard animation). */
const TEXT_FOCUS_HOLD_MS = 1200;

/** Whether a freehand stroke is eligible for recognition when it ends. */
export function shouldSnapStroke(mode: SnapMode, held: boolean): boolean {
  return mode === "auto" || (mode === "hold" && held);
}
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
/** A press on a folded note that moves less than this, screen px, opens it on lift. */
const FOLDED_TAP_SLOP_PX = 12;
/** Lasso points closer than this to the previous one are dropped, screen px. */
const LASSO_SPACING_PX = 3;
/** Room between a lasso selection and its dashed frame, screen px. */
const SELECTION_PAD_PX = 8;
/**
 * The frame's pad round a lone shape whose point rings and corner handles
 * both show, screen px: the corner squares stand clear of the rings.
 */
const SHAPE_FRAME_PAD_PX = 20;
/** Smallest a corner resize may make a lasso selection's longer side, screen px. */
const MIN_SELECTION_SIDE_PX = 32;
/** Two fingers whose midpoint lands this close to a selection's frame turn it, screen px. */
const FINGER_TURN_MARGIN_PX = 24;
/** The id a finger on the page has among the fingers on a selection's frame. */
const PAGE_FINGER_ID = -2;
const SVG_NS = "http://www.w3.org/2000/svg";
/** How far off ink or a picture a Pencil tap may land and still pick it, screen px. */
const PEN_TAP_TOLERANCE_PX = 6;
/** The same for a fingertip, which covers more of the glass. */
const FINGER_TAP_TOLERANCE_PX = 12;
/** The same for a mouse's right-click, as precise as the Pencil's tip. */
const MOUSE_TAP_TOLERANCE_PX = PEN_TAP_TOLERANCE_PX;
/** How long a tap on a PDF page waits for its links to be read, ms. */
const PDF_LINK_WAIT_MS = 1500;
/** A finger that lifts within this long of landing, having barely moved, tapped. */
const FINGER_TAP_MS = 350;
/** A double tap's page: which, where it was tapped, and whether the zoom fills the pane with it. */
interface ZoomSettle {
  index: number;
  /** The tapped point, page-local px. */
  local: { x: number; y: number };
  /** Where it was tapped, px from the surface's top-left. */
  screen: { x: number; y: number };
  fill: boolean;
}

/** How long a double tap's zoom takes to glide the last pixels to its page (`settleAfterZoom`). */
const DOUBLE_TAP_SETTLE_MS = 160;
/** A press on a selected image, or a lasso selection, drags once it has moved this far, screen px. */
const IMAGE_DRAG_SLOP_PX = 3;
/** How far from a shape's corner or end a press still takes its point handle, screen px. */
const POINT_HIT_RADIUS_PX = 18;
/** A side dot of a lone shape sits this far outside the selection frame, screen px. */
const LINK_DOT_GAP_PX = 10;
/** How far from a side dot a press still takes it, screen px. */
const LINK_DOT_HIT_RADIUS_PX = 16;
/** A tap on a side dot puts the linked copy this far beside the original, screen px at fit. */
const LINK_GAP_PX = 48;

/** The shapes a new linked shape can be turned into, in the order its bar shows them. */
const LINK_TYPES: ReadonlyArray<{ kind: BoxPreset; icon: string; label: string }> = [
  { kind: "rect", icon: "square", label: "Rectangle" },
  { kind: "ellipse", icon: "circle", label: "Circle" },
  { kind: "triangle", icon: "triangle", label: "Triangle" },
  { kind: "diamond", icon: "diamond", label: "Diamond" },
  { kind: "roundrect", icon: "squircle", label: "Rounded rectangle" },
];
/**
 * A lasso press on the paper held this long without moving opens the small
 * bar with Paste — or Unlock, on a locked picture (GoodNotes' long press).
 * Noticed by a timer: a pen held still sends no moves (ledger).
 */
const PRESS_HOLD_MS = 500;
/** The smallest scribble that erases: its longer side on screen, px. */
const SCRIBBLE_MIN_PX = 10;
/**
 * Scribble to fill: at least this share of the scribble's points inside
 * the region it fills, and its bounds at least {@link SCRIBBLE_FILL_SHARE}
 * of the region's area, so a mark made near an outline, or a small one in a
 * big frame, stays ink.
 */
const SCRIBBLE_FILL_INSIDE = 0.9;
const SCRIBBLE_FILL_SHARE = 0.15;
/** A stroke's ink radius as the fill sees it, over its width: a light hand writes thinner. */
const FILL_INK_RADIUS = 0.35;
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
/** How long a lasso drawn round nothing stays, then how long it fades (Joost's Goodnotes recording). */
const EMPTY_LASSO_MS = 1500;
const EMPTY_LASSO_FADE_MS = 300;
/** Screen px from where the pen lifted to the empty lasso's Screenshot button. */
const EMPTY_LASSO_PILL_OFFSET_PX = 12;
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
  /** A finger holds it, so a second finger may turn the picture. */
  finger?: boolean;
  /** The knob's turn settles here, when the knob was grabbed. */
  turn?: TurnSnap;
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
  /** The ink pressed, if any: "Correct" reads the word it is in. */
  ink: Stroke | null;
  /**
   * Opened by a finger that is still down. Until it lifts the bar takes no
   * presses, so a palm that opened it cannot have the pen land on Paste:
   * the pen goes through to the page, which closes the bar.
   */
  provisional: boolean;
}

const NO_IMAGES: ReadonlySet<ImageElement> = new Set();
const NO_STROKES: ReadonlySet<string> = new Set();
const NO_TABLES: ReadonlySet<TableElement> = new Set();
const NO_GRAPHS: ReadonlySet<GraphElement> = new Set();
const NO_CONNECTORS: ReadonlySet<string> = new Set();

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
  /** A finger on the frame drags it, so a second finger may turn it. */
  finger?: boolean;
  /** Set while two fingers turn it. */
  fingers?: GroupFingerTurn;
  /** Whether the selection has left the tiles for the wet layer yet. */
  lifted: boolean;
  /**
   * The page a move drops it on: its own until the pen crosses onto
   * another. (dx, dy) stay in its own page's space, where it is drawn.
   */
  target?: PageBox;
  /** Where the pen is in the pane, px, for scrolling near its edges. */
  screen?: Pt;
  /** The connectors joined to the selection's shapes, drawn on the wet layer while it moves. */
  connectors?: Set<string>;
}

/**
 * A lone shape's side dot dragged out into a linked copy (discussion #51),
 * from pointerdown to lift: the copy and its arrow follow the pen on the
 * wet layer; the lift commits one `AddLinkedCopy`.
 */
interface LinkDrag {
  pointerId: number;
  pageId: string;
  stroke: Stroke;
  side: ConnectorSide;
  clientX: number;
  clientY: number;
  lifted: boolean;
  /** How far the copy is moved from the original, page px, once the pen has left the dot. */
  offset: Pt | null;
  /**
   * Another shape the pen is over: the arrow is dropped on it and joins the
   * two, and no copy is made (Joost, 2026-10-29).
   */
  target: Stroke | null;
  /** The side of `target` nearest the pen: where the dropped arrow meets it. */
  targetSide: ConnectorSide;
}

/**
 * One corner or end of a lone selected shape dragged by its point handle
 * (discussion #51), from pointerdown to lift. Like a group drag, the shape
 * leaves the tiles once and is drawn on the wet layer; the lift commits one
 * `ReshapeStroke`.
 */
interface PointDrag {
  pointerId: number;
  pageId: string;
  stroke: Stroke;
  handles: PointHandles;
  handle: number;
  /** The handle less the pointer-down point: the point follows the pen from where it was. */
  grab: Pt;
  clientX: number;
  clientY: number;
  /** The shape's bounds before the drag, page space. */
  before: Bounds;
  /** Whether the shape has left the tiles for the wet layer yet. */
  lifted: boolean;
  /** The points and kind the shape has now, and where the dragged handle is. */
  draft: { pts: number[]; kind: ShapeKind; at: Pt } | null;
}

/**
 * Two fingers turning a lasso selection or a selected picture
 * (`canvas/selection-turn.ts`): on its frame, one on the frame and one
 * beside it, or both round it on the page (`page`). The lift commits it as
 * one step.
 */
interface GroupFingerTurn {
  state: FingerTurn;
  /** Where the turn settles: every 45° of the page, as the knob's does. */
  snap: TurnSnap;
  /** What the turn does now. */
  motion: TurnMotion;
  /** The fingers are the page's: they landed round the selection, not on its frame. */
  page: boolean;
  /**
   * The drag was made for the turn (by the page's fingers, or from a lone
   * picture's drag): there is no finger's drag of the frame to go back to.
   */
  owned: boolean;
}

/** A turn of a lasso selection by its knob, about the middle of its bounds. */
interface GroupTurn {
  /** The middle of the bounds, page space. */
  centre: Pt;
  /** Page-local point where the knob was grabbed. */
  from: Pt;
  /** Radians clockwise so far, settled by `snap`. */
  angle: number;
  /** Where the turn settles: held at the start, quarter turns, level, 15° steps. */
  snap: TurnSnap;
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

/** Flip horizontal · Flip vertical, as one segmented row of the "…" menu. */
function flipActions(flip: (axis: FlipAxis) => void, group = "flip"): SelectionAction[] {
  return [
    {
      id: "flip-x",
      icon: "flip-horizontal-2",
      label: "Flip horizontal",
      group,
      segment: "Flip",
      run: () => flip("x"),
    },
    {
      id: "flip-y",
      icon: "flip-vertical-2",
      label: "Flip vertical",
      group,
      segment: "Flip",
      run: () => flip("y"),
    },
  ];
}

/** The lasso menu's one row that opens what a selection can become (2.5). */
const TURN_INTO = { label: "Turn into", icon: "wand-sparkles" } as const;

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

/** A pen's side button with no keys held, as the table stores it. */
const SIDE_BUTTON: ShortcutInput = { type: "button", button: 2, mods: [], pen: true };

/**
 * Whether taking a shortcut should also keep the browser from acting on the
 * key. A bare letter or digit does not: it never had a browser meaning on the
 * page, and the built-in keys let those through too.
 */
function shortcutPreventsDefault(input: ShortcutInput): boolean {
  return input.type === "key" && (input.mods.length > 0 || !/^[a-z0-9]$/.test(input.key));
}

/** The tool an action switches to, or null for a command or a tool bar action. */
const SHORTCUT_TOOLS: Readonly<Record<string, ActiveTool>> = {
  "tool.pen": "pen",
  "tool.highlighter": "highlighter",
  "tool.eraser": "eraser",
  "tool.select": "select",
  "tool.shape": "shape",
  "tool.text": "text",
  "tool.laser": "laser",
  "tool.pan": "pan",
  "tool.zoom": "zoom",
};

function shortcutTool(actionId: string): ActiveTool | null {
  return SHORTCUT_TOOLS[actionId] ?? null;
}

/** A tool one press borrows from its keys or a stylus button (`pen-modifiers.ts`). */
type LentTool = "eraser" | "select" | "zoom";

/** The Magnifier's open Zoom box: its target on one page, and the line's left edge. */
interface ZoomBoxState {
  pageId: string;
  box: ZoomRect;
  /** Where the ↵ key returns to, in page px: the line's starting X. */
  originX: number;
}

/** A target box being moved or resized from its frame or one of its handles. */
interface ZoomTargetDrag {
  pointerId: number;
  /** The page the drag started on: its points are measured there, across pages too. */
  pageId: string;
  handle: ZoomHandle | "move";
  from: { x: number; y: number };
  start: ZoomRect;
}

/** The first drag in Zoom box mode, before there is a target to move. */
interface ZoomMarquee {
  pageId: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
}

/** The handles a target box shows, in the order its frame builds them. */
const ZOOM_HANDLES: readonly ZoomHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
/** How long the page glides to keep a stepped target box in view, ms. */
const ZOOM_BOX_PAN_MS = 180;
/** The Zoom box window's bar, CSS px (styles.css): what the window's body is short of its height. */
const ZOOM_WINDOW_BAR_PX = 40;
/** How far a two-finger spread must change before it is a pinch, not a tap. */
const ZOOM_PINCH_DEAD = 0.04;

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
  /**
   * The held or typed-in box, and where the view was when it last showed:
   * `dropTextOutOfSight` lets it go only once the view has moved since.
   */
  private textSeen: { view: TextBoxView; at: ViewSpot } | null = null;
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
  /** The size scales the host was last told of (`onSizeScale`). */
  private reportedSizeScale: { pen: number; eraser: number } | null = null;
  private sizeScaleTimer = 0;
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
  /** The ruler laid over the page (`ruler-overlay.ts`), out or put away. */
  private ruler: RulerOverlay | null = null;
  /** The zoom springing back inside its limits after a pinch overshot them. */
  private zoomAnim: {
    from: number;
    to: number;
    t0: number;
    cx: number;
    cy: number;
    /** Where a double tap's view comes to rest after (`settleAfterZoom`). */
    settle?: ZoomSettle;
  } | null = null;
  /**
   * A row settling on page `page`, centred, as a pinch lets go: `dx`, `dy`
   * is how far off centre it was at `t0`, and it eases to nothing over the
   * zoom spring's time, so the zoom and the centring land as one motion
   * (`stepRowSettle`).
   */
  private rowSettle: { page: number; dx: number; dy: number; t0: number } | null = null;
  /** Whether a pinch well past the fit opens the page overview (`setPinchToOverview`). */
  private pinchOverviewEnabled = false;
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
  private pressTool: LentTool | null = null;
  /**
   * The key or button held for a shortcut set to Hold: the tool it put in
   * hand, and the one to go back to when it is let go (null: nothing to go
   * back to, for the hand, which is Space's, or a tool already in hand).
   * `mod`: it was held with Cmd or Ctrl, whose key-up ends it too. A button
   * has no key: it ends when its pointer lets it go (`pointerId`, `bit`).
   */
  private heldShortcut: {
    key: string | null;
    pointerId: number | null;
    bit: number;
    mod: boolean;
    tool: ActiveTool;
    back: ActiveTool | null;
  } | null = null;
  /** A button shortcut ran on its press: the side button's click after it is no second run. */
  private buttonShortcutUntil = 0;
  /** A pen or mouse press is under way: a held key's tool switch waits for its lift. */
  private pressing = false;
  /** The tool a held key switched to (or back to) while a press was under way. */
  private pendingHeldTool: ActiveTool | null = null;
  /** A pen or mouse is moving the page from beside the pages, or with the barrel. */
  private penPanning = false;
  /** An Alt-drag zooming: the zoom it began at, and the client point it zooms about. */
  private zoomDrag: {
    from: number;
    x: number;
    y: number;
    /** The pen has moved far enough to be a drag, not a tap. */
    moved: boolean;
    /** A tap with the magnifier zooms in a step; an Alt-drag does not. */
    tapZoom: boolean;
  } | null = null;
  /** The Magnifier's target box and floating window, while one is open. */
  private zoomBox: ZoomBoxState | null = null;
  /** The target box's frame, on the paper over its page. */
  private zoomTargetEl: HTMLElement | null = null;
  /** The last frame position written, so a still page does not rewrite it each frame. */
  private zoomTargetCss = "";
  /** The first drag's dashed rectangle, before the target box exists. */
  private zoomMarqueeEl: HTMLElement | null = null;
  /** Covers the page while a first target drag waits in Stylus-only mode, for fingers too. */
  private zoomCatcherEl: HTMLElement | null = null;
  private zoomMarquee: ZoomMarquee | null = null;
  /** The pointer drawing the first target rectangle. */
  private zoomMarqueePointer: number | null = null;
  private zoomTargetDrag: ZoomTargetDrag | null = null;
  /** Previous target positions for the Zoom box's Back button. */
  private readonly zoomPositionHistory: { pageId: string; box: ZoomRect }[] = [];
  /** A finger (or the Hand) dragging the view inside the Zoom box window. */
  private zoomPan: {
    pointerId: number;
    x: number;
    y: number;
    start: ZoomRect;
    index: number;
    scale: number;
    moved: boolean;
  } | null = null;
  /** Fingers down on the Zoom box window, client px, for its pinch. */
  private readonly zoomTouches = new Map<number, { x: number; y: number }>();
  /** Two fingers pinching in the Zoom box window: its magnification (`pinchZoomBox`). */
  private zoomPinch: {
    a: number;
    b: number;
    dist: number;
    start: ZoomRect;
    moved: boolean;
  } | null = null;
  /** The floating window and its canvas, created when a target is first drawn. */
  private zoomFrame: FloatingWindow | null = null;
  private zoomCanvas: HTMLCanvasElement | null = null;
  private zoomReadout: HTMLElement | null = null;
  /** Where the floating window was last put; the surface keeps it while it is open. */
  private zoomPlace: WindowPlace | null = null;
  /**
   * The Zoom box's own pointer input: the page's `PointerController` on the
   * window's canvas, so a stroke written there gets everything one on the
   * page does (palm rejection, coalesced samples, the whole-px pen's
   * smoothing, the missing-pressure rule, the rejoin of a flickering pen).
   */
  private zoomInput: PointerController | null = null;
  /** A stroke is open in the Zoom box (its pen is down there). */
  private zoomStroke = false;
  /**
   * The pen's gesture lengths follow the Zoom box's magnification, not the
   * page's zoom: set when a stroke starts in the box, cleared when it ends or
   * one starts on the page ({@link gestureZoom}).
   */
  private strokeInBox = false;
  /** The box canvas's rectangle for the stroke under way, read once per press. */
  private zoomCanvasRect: DOMRect | null = null;
  /** Repaints the window while its corner is dragged to a new size. */
  private zoomResize: ResizeObserver | null = null;
  /** A window repaint asked for by a wet stroke, outside the page's frame loop. */
  private zoomPaintFrame = 0;
  /** The readout last written, so a still window is not touched every frame. */
  private zoomReadoutText = "";
  /** The debounce after a stroke that reached the auto-advance trigger. */
  private zoomAdvanceTimer: number | null = null;
  /** The furthest page x of the stroke being drawn inside the Zoom box. */
  private zoomStrokeMaxX = Number.NEGATIVE_INFINITY;
  /** The header's auto-advance switch, kept in step with the setting. */
  private zoomAutoAdvanceButton: HTMLButtonElement | null = null;
  /** The short glide after an auto-advance, so the box does not jump. */
  private zoomSlideFrame = 0;
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
  /**
   * Where the page was when the current finger gesture began, and whether
   * the system took any of its fingers (`pointercancel`): iPadOS's four-finger
   * app switch, Control Center, the swipe home. Then lifting puts the page
   * back instead of flinging or turning it.
   */
  private fingerGesture: {
    x: number;
    y: number;
    zoom: number;
    cx: number;
    cy: number;
    cancelled: boolean;
  } | null = null;
  /**
   * The current finger gesture for pulling in a page (`pullAddAllowed`):
   * where its focus started and is now, and whether a second finger came
   * down (a pinch is never a pull). Null between gestures, so the ring can
   * only show while one is going on.
   */
  private pullGesture: {
    fromX: number;
    fromY: number;
    x: number;
    y: number;
    pinched: boolean;
  } | null = null;
  /** Which way the pages run; read from the document on every layout. */
  private direction: ScrollDirection = "vertical";
  /** Whether the pages are laid out joined (`model/joined-pages.ts`), as of the last layout. */
  private joined = false;
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
  /**
   * An endless board (FineNotes#46): one page that grows, scrolled freely,
   * 100% at the writing size. Read from the document on every layout.
   */
  private board = false;
  /** What is drawn on the board (`drawnBounds`), kept up to date by every edit. */
  private boardDrawn: Bounds | null = null;
  /**
   * The view as it was when an erase made the drawing smaller: still in the
   * scroll range, so the view does not jump back to what is left. Let go of
   * when a finger or the wheel moves the view.
   */
  private boardHold: Bounds | null = null;
  /**
   * How far a left or up growth moved the board's content (page px) since
   * the last layout, which moves the view by as much so nothing on screen
   * jumps; an undo moves it back (`GrowBoard`'s `onShift`).
   */
  private boardShift = { x: 0, y: 0 };
  /** Steps the board's growth has looked at, so an undo never grows it again. */
  private boardChecked = new WeakSet<Command>();
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
  /** The format painter, made on first use; armed by "Copy style". */
  private formatPainter: FormatPainter | null = null;
  /** The format painter's sweep under way: painted live, one undo step at the lift. */
  private paintSweep: PaintStyle | null = null;
  /** A calculation note's suggestion beside its line, made on first use. */
  private calcChip: CalcChip | null = null;
  /** Set by a host while taps on ink mean something else (audio replay). */
  private strokeTapHandler: StrokeTapHandler | null = null;
  /** New strokes' and text boxes' ids: `s<N>` and `t<N>`, above any the document holds. */
  private readonly strokeIds = new IdSequence("s");
  private readonly textBoxIds = new IdSequence("t");
  private readonly history = new History();
  /** The undo/redo availability last reported to the host, as "undo/redo". */
  private historyShown = "";
  /** Every stroke by page position and by id; kept in step with each edit. */
  private readonly strokeIndex = (() => {
    const index = new StrokeIndex();
    // With the pages joined no tool acts on a mirror: tools find its owner.
    index.skip = (stroke) => this.joined && isMirror(stroke);
    return index;
  })();
  /** Whole-stroke erase in progress: the strokes the eraser has touched so far. */
  private eraseIds = new Set<string>();
  /**
   * "Grey out while erasing" (the eraser's mode list): this erase draws what
   * it takes grey rather than hiding it; decided on its first dab.
   */
  private eraseGrey = false;
  /**
   * By line, greyed: each cut stroke's stretches being cut away, drawn grey
   * beside its surviving pieces. Only drawn: the commit never sees them.
   */
  private eraseGreyCuts = new Map<string, Stroke[]>();
  /**
   * Standard (partial) erase in progress: original stroke id -> the pieces
   * that survive so far. The document is untouched until the gesture ends;
   * the renderer draws these pieces in the originals' place meanwhile.
   */
  private erasePieces = new Map<string, Stroke[]>();
  /** The previous dab's page-local point, so fast drags leave no gaps. */
  private eraseLast: { x: number; y: number } | null = null;
  /**
   * Tiles hold committed ink, so the live erase preview has to paint again
   * what it touches: `eraseDirty` is the strokes changed whole since the
   * last repaint (taken, greyed), `eraseCuts` the places, by page index,
   * where the eraser cut strokes since (a cut changes the stroke only
   * there), and `erasePreview` everything the gesture has touched, which is
   * put back from the document when it ends.
   */
  private eraseDirty = new Set<string>();
  private eraseCuts = new Map<number, Bounds[]>();
  private erasePreview = new Map<number, Bounds[]>();
  /** The strokes cut this gesture whose whole bounds `erasePreview` has. */
  private eraseCutSeen = new Set<string>();
  /**
   * The ruled eraser's pass on each page it reached, from its first dab
   * there; null on an unlined page. With the pages joined the eraser goes
   * on over the join, page by page.
   */
  private eraseRuled = new Map<string, RuledEraser | null>();
  /**
   * With the pages joined, the mirrors on other pages of the strokes the
   * eraser may touch, by owner key, read once a gesture: the erase preview
   * shows on them too (`canvas/mirrors.ts`).
   */
  private eraseMirrors: Map<string, Array<{ box: PageBox; stroke: Stroke }>> | null = null;
  /** The eraser's footprint, shown on the page while erasing. */
  private readonly eraserCursorEl: HTMLElement;
  /** The laser pointer's trail, and the canvas it is drawn on (FineNotes#25). Never saved. */
  private readonly laserTrail = new LaserTrail();
  private readonly laserCanvas: HTMLCanvasElement;
  /** The paper and the committed ink, bottom to top: what `snapshotPage` copies. */
  private readonly paneLayers: HTMLCanvasElement[];
  private laserFrame = 0;

  // The lasso (0.5). A selection is strokes, images and text boxes on one
  // page, held by identity and resolved against the live document. One
  // picture on its own is shown with the image chrome below instead (its
  // resize and rotate handles); anything else gets the group frame, which
  // moves the lot. The two are never shown together, and one action bar
  // serves both. Frame, bar and menu are DOM over the page, like the text
  // boxes, so a finger works them as well as the Pencil.
  private selection: GroupSelection | null = null;
  /**
   * Whether the selection shows its corner handles (discussion #51, Joost):
   * hidden when a lasso picks something up, shown at once for a lone shape,
   * and switched by the bar's corners button.
   */
  private selectionCorners = false;
  /** A lasso drawn round nothing: its loop and a Screenshot button, for a moment (`showEmptyLasso`). */
  private emptyLasso: { el: HTMLElement; timers: number[] } | null = null;
  /** A lasso has selected content; return only when its outside click dismisses it. */
  private selectionToolUsed = false;
  private lasso: LassoDraft | null = null;
  private groupDrag: GroupDrag | null = null;
  /** Every finger on the selection's frame: a second one makes the drag a turn. */
  private readonly selectionFingers = new FingerGesture({
    onPinchStart: (x, y, spread) => void this.startGroupTurn(x, y, spread, false),
    onPinch: (info) => this.stepGroupTurn(info),
    onPinchEnd: () => this.endGroupTurn(),
  });
  /** A finger on the page joined the one dragging the selection by its frame. */
  private pageFingerOnFrame = false;
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
  /** The graph being explored on a live canvas, if any: only one at a time. */
  private explorer: { pageId: string; explorer: GraphExplorer } | null = null;
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
  /** A marker on each comment pinned to a page; a tap opens it (`onTapComment`). */
  private readonly commentMarkersEl: HTMLElement;
  private readonly commentMarkers: HTMLButtonElement[] = [];
  /** What each marker in the pool stands for now: its page and comment. */
  private commentTargets: Array<{ index: number; comment: PageComment }> = [];
  /** The by-line lasso's insert-space markers: a column per block of lines per page. */
  private readonly spaceHandlesEl: HTMLElement;
  private readonly spaceHandleEls: HTMLElement[] = [];
  /** A ribbon in the margin beside each section in the contents. */
  private readonly sectionRibbonsEl: HTMLElement;
  private readonly sectionRibbons: HTMLElement[] = [];
  /** An underline under each piece of linked ink. */
  private readonly linkMarks: HTMLElement[] = [];
  /** A box beside each handwritten task, which a tap ticks (2.5). */
  private readonly taskMarks: HTMLElement[] = [];
  /** What the search result last opened found on its page, lit until the page is touched (2.5). */
  private searchHits: { pageId: string; words: string[][]; boxes: string[] } | null = null;
  private readonly searchMarks: HTMLElement[] = [];
  /** Ink a playing recording has not reached yet, drawn pale (2.5). */
  private fadedStrokes: ReadonlySet<string> = new Set();
  /** `[[links]]` written by hand, found on the device, by page id: offered, not made. */
  private readonly linkSuggestions = new Map<string, readonly HandwrittenLink[]>();
  /** Words Grape may have misread, by page id: a wavy underline each. */
  private readonly wordFlags = new Map<string, ReadonlyArray<readonly string[]>>();
  private readonly wordMarks: HTMLElement[] = [];
  /** The flagged word whose menu is open (page id, stroke key): drawn red. */
  private activeWordFlag: { pageId: string; key: string; strokes: readonly string[] } | null = null;
  /** The client point of the finger tap or right-click being handled, for `onFlaggedWord`. */
  private tapClient = { x: 0, y: 0 };
  /** The lasso's tap-and-hold bar, and the timer that opens it. */
  private pressMenu: PressMenu | null = null;
  private pressTimer = 0;
  /** Cmd/Ctrl+V waiting for the browser's paste event (see PASTE_EVENT_WAIT_MS). */
  private pasteTimer = 0;
  /** Whether a host set an image painter: without one, pictures are neither drawn nor pasted. */
  private imagesShown = false;
  /** A finger went down and could still turn out to be a tap. */
  private fingerTap: { x: number; y: number; t: number } | null = null;
  /** What paints page backdrops (`setBackdropPainter`), for `paintPaperSample` too. */
  private backdropPainter: BackdropPainter | null = null;
  /** Where a waiting sticky note goes on the next tap (`armStickyNote`). */
  private stickyPlace: ((index: number, at: Pt) => void) | null = null;
  /**
   * The note text box (`pageId:id`) a Text-tool tap on its note is about
   * to focus: shown by its textarea from before the focus lands.
   */
  private noteTextOpen: string | null = null;
  /** The note text boxes (by id) their textareas show, and the tiles leave out. */
  private noteTextOnDom: ReadonlySet<string> = new Set();
  /** The last finger tap that nothing took, waiting for a second (`zoomOnDoubleTap`). */
  private plainTap: PlainTap | null = null;
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
  /**
   * The "One item" lasso's pen is down: where it landed, and whether it
   * picked something up (then the selection follows it, as a held loop's
   * does).
   */
  private picking: { box: PageBox; at: Pt; dragging: boolean } | null = null;

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
    /** The end is on another shape's point: a connector is not levelled off it. */
    snapped?: boolean;
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
  /** Why the last text box stopped being edited (`text-end-hud.ts`). */
  private hudTextEnd = "";
  /** What the highlighter last did on a PDF page (`textMarkNote`). */
  private hudTextMark = "";
  /** The surface's path blurring a text box right now; "" while the browser does it. */
  private textBlurBy = "";
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
    private readonly options: InkSurfaceOptions,
    private readonly callbacks: InkSurfaceCallbacks,
  ) {
    this.paper = this.options.paper ?? LIGHT_PAPER;
    this.toolSeen = toolState.tool;
    this.drawingTool = drawingToolOf("pen", toolState.tool);

    this.surfaceEl = host.createDiv({ cls: "goodobsidian-surface" });
    this.syncDeskVar();
    // The three layers, bottom to top: paper, committed ink, the stroke being drawn.
    const [backdropCanvas, dryCanvas, wetCanvas] = (["backdrop", "dry", "wet"] as const).map(
      (layer) =>
        this.surfaceEl.createEl("canvas", {
          cls: `goodobsidian-canvas goodobsidian-canvas-${layer}`,
        }),
    );
    this.scrollEl = this.surfaceEl.createDiv({ cls: "goodobsidian-scroll" });
    // A first Zoom box drag is UI, not a stroke: in Stylus-only mode, where
    // fingers do nothing on the page, a catcher over it lets a finger draw it
    // too. It is shown only then, with the Magnifier in hand and no target
    // yet (`syncZoomCatcher`); otherwise a finger must still pan and pinch.
    this.zoomCatcherEl = this.surfaceEl.createDiv({
      cls: "goodobsidian-zoom-catcher is-hidden",
    });
    this.zoomCatcherEl.dataset.ignoreSwipe = "true";
    this.zoomCatcherEl.addEventListener("pointerdown", (event) =>
      this.onZoomCatcherPointerDown(event),
    );
    this.zoomCatcherEl.addEventListener("pointermove", (event) =>
      this.onZoomCatcherPointerMove(event),
    );
    for (const type of ["pointerup", "pointercancel"] as const) {
      this.zoomCatcherEl.addEventListener(type, (event) => this.onZoomCatcherPointerUp(event));
    }
    // It lies beside the scroll element, not in it, so the page's touch
    // listener never sees a Pencil drawing here (`input/stylus-touch`).
    const catcherTouch = (event: TouchEvent): void => {
      if (cancelsStylusTouch(event.type, event.changedTouches)) event.preventDefault();
    };
    for (const type of ["touchstart", "touchmove"] as const) {
      this.zoomCatcherEl.addEventListener(type, catcherTouch, { passive: false });
    }
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
    // Page tabs along the right edge, a binder's dividers: chrome, not ink.
    this.tabStripEl = this.surfaceEl.createDiv({ cls: "goodobsidian-page-tabs is-hidden" });
    this.tabStripEl.dataset.ignoreSwipe = "true";
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
    this.setDebug(this.options.debug);

    // A lock badge on each locked picture, under the selection chrome. The
    // badges take no presses: a tap-and-hold on the picture reaches the page.
    this.lockBadgesEl = this.paperEl.createDiv({ cls: "goodobsidian-lock-badges is-hidden" });
    this.commentMarkersEl = this.paperEl.createDiv({
      cls: "goodobsidian-comment-markers is-hidden",
    });
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
    // The Magnifier's Zoom box: the dashed rectangle of its first drag, then
    // the target frame that stays over the page while the window writes.
    this.zoomMarqueeEl = this.paperEl.createDiv({
      cls: "goodobsidian-zoom-marquee is-hidden",
    });
    this.zoomTargetEl = this.paperEl.createDiv({
      cls: "goodobsidian-zoom-target is-hidden",
    });
    this.zoomTargetEl.setCssProps(chromeSizes);
    this.zoomTargetEl.dataset.ignoreSwipe = "true";
    for (const handle of ZOOM_HANDLES) {
      const kind = handle.length === 2 ? "is-corner" : "is-edge";
      const grip = this.zoomTargetEl.createDiv({
        cls: `goodobsidian-image-handle ${kind} is-${handle}`,
      });
      grip.dataset.zoomHandle = handle;
    }
    // The viewfinder's badge sits inside the bottom-right corner: an obvious
    // grip that moves the box even with a writing tool in hand.
    const badge = this.zoomTargetEl.createDiv({ cls: "goodobsidian-zoom-badge" });
    badge.dataset.zoomMove = "true";
    badge.setAttribute("aria-hidden", "true");
    setIcon(badge, "zoom-in");
    this.zoomTargetEl.addEventListener("pointerdown", (event) =>
      this.onZoomTargetPointerDown(event),
    );
    this.zoomTargetEl.addEventListener("pointermove", (event) =>
      this.onZoomTargetPointerMove(event),
    );
    for (const type of ["pointerup", "pointercancel"] as const) {
      this.zoomTargetEl.addEventListener(type, (event) => this.onZoomTargetPointerUp(event));
    }
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
    for (const type of [
      "pointermove",
      "pointerup",
      "pointercancel",
      "lostpointercapture",
    ] as const) {
      this.imageFrameEl.addEventListener(type, this.onSelectionFinger);
    }

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
    this.palette = this.options.palette ?? PALETTE;
    this.selectionUiEl = this.paperEl.createDiv({ cls: "goodobsidian-selection-ui" });
    this.selectionFrameEl = this.selectionUiEl.createDiv({
      cls: "goodobsidian-selection-frame is-hidden",
    });
    // A freehand lasso's selection is drawn by the loop the pen drew, rounded
    // off, not by a box (see `smoothPath`); the frame keeps taking the drags.
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
    // Every finger on the frame, to its lift, for a two-finger turn of the selection.
    const fingerEvents = [
      "pointermove",
      "pointerup",
      "pointercancel",
      "lostpointercapture",
    ] as const;
    for (const type of fingerEvents) {
      this.selectionFrameEl.addEventListener(type, this.onSelectionFinger);
    }
    this.actionBar = new SelectionActionBar(this.selectionUiEl, "Selection");
    // With the lasso, a text box is something to select, not to type in.
    this.surfaceEl.toggleClass("is-lasso", toolState.tool === "select");
    this.surfaceEl.toggleClass("is-text-tool", toolState.tool === "text");
    this.syncNavigationCursor(toolState.tool);
    this.syncZoomTargetInteractive();
    this.syncZoomCatcher();

    this.paneLayers = [backdropCanvas, dryCanvas];
    const renderer = new Renderer(
      backdropCanvas,
      dryCanvas,
      wetCanvas,
      this.options.desynchronizedCanvas,
    );
    renderer.highlighterAlpha = this.options.highlighterAlpha;
    renderer.paper = this.paper;
    // A pan or scroll moves the dry layer rather than painting it again: on
    // a phone or tablet, whose compositor is always the GPU. Composited on
    // the CPU (a desktop with its GPU turned off), the larger canvas cost
    // more each frame than it saved.
    renderer.useOverscan(Platform.isMobile);
    this.renderer = renderer;

    // The ruler hears every press first (capture, on the surface): a finger
    // on it moves it, and a pen within reach of an edge follows the edge,
    // every sample put on it before it is mapped below.
    this.ruler = new RulerOverlay(this.surfaceEl, {
      guides: (event) => this.rulerGuides(event),
      fingersBusy: () => this.pointerInput?.isTouching === true || this.pinch !== null,
      inkWidth: () => strokeWidthFor(this.toolState) * this.scale,
    });

    // A button the user's shortcut table binds is theirs before it is a
    // stroke or a right click's menu (capture: ahead of the pointer input).
    const onButtonPress = (event: PointerEvent): void => this.onButtonPress(event);
    this.scrollEl.addEventListener("pointerdown", onButtonPress, true);
    this.disposers.push(() =>
      this.scrollEl.removeEventListener("pointerdown", onButtonPress, true),
    );

    // Pen, mouse and finger input arrive through the transparent overlay,
    // mapped into layout space as they come in.
    const input = new PointerController(
      this.scrollEl,
      (clientX, clientY) => {
        const at = this.ruler?.guide(clientX, clientY) ?? { x: clientX, y: clientY };
        return this.toLayout(at.x, at.y);
      },
      this.pointerCallbacks,
      {
        handHeld: () => this.handHeld,
        route: (event) => this.pressRoute(event),
        onlyStylus: () => this.callbacks.onlyStylusMode?.() === true,
        stylusClicks: () => this.stylusClickWanted(),
      },
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
      if (hasStylusTouch(event.changedTouches)) {
        if (event.type === "touchstart") this.diagSums.stylusTouches++;
        if (cancelsStylusTouch(event.type, event.changedTouches)) event.preventDefault();
        return;
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
      // Android's WebView: the pen touching down with its side button held is
      // this alone, as a mouse's. It is no click of the button, and no menu.
      if (type !== "touch" && this.pointerInput?.stylusTouched()) return;
      // A WebView may hand the barrel button's click in the air over as this alone.
      if (type === "pen" && this.pointerInput?.stylusMenu(event.timeStamp)) {
        this.stylusClicked(event.clientX, event.clientY);
        return;
      }
      if (type === "touch" || type === "pen" || this.touchPanning) return;
      // Stylus-only mode: a right-click is no more the pen's than a press is.
      if (this.callbacks.onlyStylusMode?.() === true) return;
      // A tablet driver can send a stylus button as a right click (FineNotes#25).
      if (now() < this.stylusMenuUntil) return;
      const target = event.target as Node | null;
      if (target && (this.selectionUiEl.contains(target) || this.imageUiEl.contains(target))) {
        return;
      }
      if (this.lasso || this.imageDrag || this.groupDrag || this.cropping) return;
      const at = this.toLayout(event.clientX, event.clientY);
      const box = boxAtPoint(this.pageLayout, at.x, at.y);
      if (!box) return;
      // The mouse is the pen, so it has no tap: a right-click on linked or
      // underlined ink does what a finger tap there does (FineNotes#41).
      if (this.mouseTapsInk(box, at, event.clientX, event.clientY)) return;
      this.openPressMenu(box, this.toPage(box, at));
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
      if (this.surfaceEl.ownerDocument.visibilityState === "hidden") {
        clipboard.noteWindowLeft();
        return;
      }
      // The system may have let a hidden page's canvases go: the next paint
      // draws the dry layer whole rather than only what changed.
      this.renderer?.repaintAll();
      if (this.layoutWhenShown) {
        this.layoutWhenShown = false;
        this.layout();
      } else this.requestFrame();
    };
    // The surface's own document: a popout window hides and shows its own.
    const viewDoc = this.surfaceEl.ownerDocument;
    window.addEventListener("blur", onLeave);
    viewDoc.addEventListener("visibilitychange", onVisibility);
    this.disposers.push(() => {
      window.removeEventListener("blur", onLeave);
      viewDoc.removeEventListener("visibilitychange", onVisibility);
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
    this.dropEmptyLasso();
    this.endCellEdit(true);
    this.cellEditor?.remove();
    this.cellEditor = null;
    this.eyedropper?.cancel();
    this.formatPainter?.cancel();
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
    this.ruler?.destroy();
    this.ruler = null;
    this.focusHoldFrame = this.relayoutFrame = 0;
    window.clearTimeout(this.wheelZoomTimer);
    this.wheelZoomTimer = 0;
    window.clearTimeout(this.chromeTimer);
    this.chromeTimer = 0;
    window.clearTimeout(this.sizeScaleTimer);
    this.sizeScaleTimer = 0;
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
    this.zoomResize?.disconnect();
    this.zoomResize = null;
    if (this.zoomPaintFrame) window.cancelAnimationFrame(this.zoomPaintFrame);
    this.zoomPaintFrame = 0;
    this.zoomFrame?.destroy();
    this.zoomFrame = null;
    this.zoomCanvas = null;
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
    this.endExplore(false);
    if (this.zoomBox) this.closeZoomBox(true);
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
  /** The strip of page tabs at the view's right edge. */
  private tabStripEl!: HTMLElement;
  /** The tabs shown, with the page each opens. */
  private tabEls: Array<{ el: HTMLElement; index: number }> = [];
  /** The strip as last built, to skip rebuilding it when nothing changed. */
  private tabKey = "";

  /**
   * Rebuild the page tabs when the notebook's tabs changed: one per tabbed
   * page, in page order, in its colour, labelled with its title. A tap opens
   * the page (pointer events: a Pencil tap over the page is never a click).
   */
  private syncPageTabs(): void {
    // Not built yet (a change can come before the strip exists).
    if (!this.tabStripEl) return;
    const tabs = pageTabs(this.doc);
    const key = tabs.map((t) => `${t.index}|${t.color}|${t.label}`).join(";");
    if (key === this.tabKey) return;
    this.tabKey = key;
    this.tabStripEl.empty();
    this.tabEls = [];
    for (const tab of tabs) {
      const el = this.tabStripEl.createEl("button", {
        cls: "goodobsidian-page-tab clickable-icon",
        attr: { "aria-label": `Open ${tab.label}`, title: tab.label },
      });
      el.setCssStyles({ backgroundColor: tab.color });
      el.createSpan({ cls: "goodobsidian-page-tab-label", text: tab.label });
      onTap(el, () => this.goToPage(tab.index));
      this.tabEls.push({ el, index: tab.index });
    }
    this.tabStripEl.toggleClass("is-hidden", tabs.length === 0);
    this.markCurrentTab();
  }

  /** Pull out the tab of the page being read, as a divider in use stands out. */
  private markCurrentTab(): void {
    if (!this.tabEls) return;
    // The tab of the page being read, or of the last tabbed page before it.
    let current = -1;
    for (const tab of this.tabEls) if (tab.index <= this.pageIndex) current = tab.index;
    for (const tab of this.tabEls) tab.el.toggleClass("is-current", tab.index === current);
  }

  /** The notebook's name, which a page header's `{title}` shows. */
  setNotebookTitle(title: string): void {
    if (!this.renderer || this.renderer.notebookTitle === title) return;
    this.renderer.notebookTitle = title;
    if (this.doc.furniture?.header?.includes("{title}")) {
      this.renderer.invalidateAll();
      this.requestFrame();
    }
  }

  applyCommand(command: Command): void {
    this.endExplore(true);
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
   * While set, a finger tap on ink — or a mouse right-click on it, or a tap
   * with the lasso — is offered to `handler` first (audio replay seeks to
   * when the ink was written). `null` gives taps back their usual meaning.
   */
  setStrokeTapHandler(handler: StrokeTapHandler | null): void {
    this.strokeTapHandler = handler;
  }

  /**
   * Show a calculation note's suggestion ("12×4 =", "48") with its bottom
   * left at `at` on page `pageId`; a tap runs `accept`. One at a time: a new
   * one replaces the last.
   */
  showCalcSuggestion(
    pageId: string,
    at: { x: number; y: number },
    sum: string,
    answer: string,
    accept: () => void,
  ): void {
    this.calcChip ??= new CalcChip(this.paperEl);
    this.calcChip.show({ pageId, x: at.x, y: at.y }, sum, answer, accept);
    this.syncCalcChip();
  }

  hideCalcSuggestion(): void {
    this.calcChip?.hide();
  }

  /** Where the suggestion is, or null while none shows. */
  get calcSuggestionPage(): string | null {
    return this.calcChip?.anchor?.pageId ?? null;
  }

  /**
   * Write strokes the host made (a calculation's answer) on page `pageId`,
   * as one undo step, with ids of their own. False when the note is locked
   * or the page is gone.
   */
  addInkStrokes(pageId: string, strokes: ReadonlyArray<Omit<Stroke, "id">>): boolean {
    if (this.callbacks.isLocked?.() || strokes.length === 0) return false;
    const page = this.doc.pages.find((p) => p.id === pageId);
    if (!page) return false;
    const made: Stroke[] = strokes.map((s) => ({ ...s, id: this.strokeIds.next() }));
    this.applyCommand(addStrokesTimed(page, made, this.clock(), "Write answer"));
    return true;
  }

  /** Keep the calculation suggestion on its page point across pan and zoom. */
  private syncCalcChip(): void {
    const chip = this.calcChip;
    const anchor = chip?.anchor;
    if (!chip || !anchor || !this.pageLayout) return;
    const box = this.pageLayout.boxes.find((b) => this.pageAt(b.index)?.id === anchor.pageId);
    if (!box) {
      chip.hide();
      return;
    }
    const scale = this.unitScale;
    chip.place((box.x + anchor.x) * scale, (box.y + anchor.y) * scale);
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
   * The pane as it is on screen now, and where the page being read is in
   * it, for the page overview to fly the page into its place. A copy of
   * the canvases: what shows, PDF and text included, with no repaint.
   */
  snapshotPage(): PageSnapshot | null {
    // The canvases catch up with the view first: a pinch moves it between frames.
    this.syncViewport();
    this.paint(Infinity);
    const page = this.pageClientRect();
    const [bottom] = this.paneLayers;
    if (!page || !bottom || bottom.width === 0 || bottom.height === 0) return null;
    const pane = this.surfaceEl.getBoundingClientRect();
    const image = createEl("canvas");
    image.width = bottom.width;
    image.height = bottom.height;
    const ctx = image.getContext("2d");
    if (!ctx) return null;
    // The dry layer reaches past the view, and may be shifted by a scroll.
    const dry = this.renderer?.dryOrigin() ?? { x: 0, y: 0 };
    for (const layer of this.paneLayers) {
      if (layer === bottom) ctx.drawImage(layer, 0, 0);
      else ctx.drawImage(layer, dry.x, dry.y);
    }
    return {
      image,
      pane: { left: pane.left, top: pane.top, width: pane.width, height: pane.height },
      page,
      desk: this.renderer?.desk ?? this.paper.desk,
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
    this.syncMirrors();
    // An arrow between two shapes reaches outside what a move of either repainted.
    this.syncConnectorTiles();
    this.growBoard();
    this.reportStatus();
    this.syncPageTabs();
    // Ink moved or went: the underlines and ribbons follow it.
    this.syncSectionRibbons();
    // A page's template may have changed: its lines, and their markers.
    this.syncSpaceHandles();
    // A comment added, resolved or removed (an undo too).
    this.syncCommentMarkers();
    this.syncCalcChip();
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
    this.syncDeskVar();
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

  /**
   * The desk's CSS colour (`--gob-desk`), which shows before the backdrop
   * canvas paints, follows the theme's desk: the Desk setting or dark pages.
   */
  private syncDeskVar(): void {
    this.surfaceEl.setCssProps({ "--gob-desk": this.paper.desk });
  }

  /** Reset zoom to the whole page and scroll back to the top ("fit / reset"). */
  resetView(): void {
    this.pinch = null;
    this.zoomAnim = null;
    this.rowSettle = null;
    this.userZoom = this.minZoom;
    this.ensurePaperSize();
    this.layout();
    // A board fits its whole drawing (FineNotes#44), in the middle of the pane.
    if (this.board) {
      this.centreBoard(false);
      this.reportStatus();
      return;
    }
    // After the layout, which would otherwise keep the current page of a row centred.
    this.scroller.setPosition(this.direction === "horizontal" ? this.rowX(0) : 0, 0);
    this.syncViewport();
    this.requestFrame();
    this.reportStatus();
  }

  /**
   * The view a notebook opens at. A board: the writing size (100%) on the
   * middle of its drawing. Anything else: {@link resetView}, the page fitted.
   * TODO(#46 phase 4): a board opens where it was left, as a notebook opens
   * on the page it was left at (`last-page.ts` keeps a page index only).
   */
  showHome(): void {
    if (!this.board) {
      this.resetView();
      return;
    }
    this.pinch = null;
    this.zoomAnim = null;
    this.userZoom = 1;
    this.ensurePaperSize();
    this.centreBoard(false);
    this.reportStatus();
    // The zoom jumped without a layout: the size marks follow it.
    this.reportSizeScale();
  }

  /** Put the middle of a board's drawing (or of its page) in the middle of the pane. */
  private centreBoard(animate: boolean): void {
    const page = this.doc.pages[0];
    if (!page) return;
    const centre = boardCentre(page.geometry, this.boardDrawn);
    const at = boardScrollToCentre(centre, this.scale, this.cssW, this.cssH);
    if (animate) this.scroller.glideTo(at.x, at.y, now());
    else this.scroller.setPosition(at.x, at.y);
    this.syncViewport();
    this.flashChrome(true);
    this.requestFrame();
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
    // A board is one page, always under the view: there is nowhere to go.
    if (this.board) return;
    const clamped = Math.max(0, Math.min(this.doc.pages.length - 1, index));
    const row = this.direction === "horizontal";
    // Zoomed in, a row lands on the page's top-left corner at the same zoom;
    // centring it would only show its middle.
    const zoomedRow = row && !this.turnsPages;
    if (zoomedRow) {
      // The hold moves to the new page, and the view glides there from where it is.
      const range = rowPageScrollRange(this.pageLayout, clamped, this.scale, this.cssW);
      this.glideHeldTo(clamped, range.min, 0, animate);
      this.syncViewport();
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
    // TODO(#46 phase 4): a heading on a board flies to its point, x and y,
    // and the zoom that shows it; for now the view only moves up or down.
    if (this.board && box) {
      const top = (Math.max(0, y) - SECTION_LEAD_PX / this.unitScale) * this.scale;
      const x = this.scroller.position.x;
      if (animate) this.scroller.glideTo(x, top, now());
      else this.scroller.setPosition(x, top);
      this.syncViewport();
      this.requestFrame();
      return;
    }
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

  /** Let (or stop) a pinch well past the fit open the page overview. The host knows single pages. */
  setPinchToOverview(enabled: boolean): void {
    this.pinchOverviewEnabled = enabled;
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
    // Another tool puts the format painter away.
    this.formatPainter?.cancel();
    // Another tool ends exploring a graph, keeping where it was left.
    this.endExplore(true);
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
    this.syncNavigationCursor(tool);
    this.syncZoomTargetInteractive();
    this.syncZoomCatcher();
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
      this.blurTextBox(`tool:${tool}`);
    }
  }

  /** The hand and magnifier tools show the cursor they act with (styles.css). */
  private syncNavigationCursor(tool: ActiveTool): void {
    this.scrollEl?.toggleClass("is-hand-tool", tool === "pan");
    this.scrollEl?.toggleClass("is-zoom-tool", tool === "zoom");
    this.scrollEl?.toggleClass("is-fill-tool", tool === "fill");
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
    // The user's shortcut table first: a row they recorded (or took away)
    // must win over the built-in key, and a conflicted input must do nothing.
    if (this.handleShortcutKey(event)) return true;
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
   * The user's shortcut table for a key press. Returns false when the key is
   * not in the table, so `keyOutcome` still has Escape, Delete on a picture,
   * the arrows and every other screen-aware key. A conflicted or cleared
   * input is taken and does nothing: a row the user changed never falls back
   * to the built-in key it replaced.
   */
  private handleShortcutKey(event: KeyboardEvent): boolean {
    const table = this.callbacks.shortcuts?.();
    if (!table) return false;
    // Typing keeps its keys, whatever a row is bound to.
    if (this.editingTextView() !== null || this.cellEdit) return false;
    const input = keyInput(event);
    if (!input) return false;
    const match = matchShortcut(table, input);
    if (!match) return false;
    if (match.kind === "conflict" || match.kind === "blocked") {
      event.preventDefault();
      return true;
    }
    // Delete, Copy and Paste's own keys belong to the screen until the user
    // records a different one for that row.
    if (match.row.contextual) return false;
    if (shortcutPreventsDefault(input)) event.preventDefault();
    if (match.row.mode === "hold" && match.row.action.holdable) {
      this.beginHeldShortcut(match.row, input);
    } else {
      this.runShortcut(match.row);
    }
    return true;
  }

  /** A tool switches; a saved pen is applied; a command runs. */
  private runShortcut(row: ShortcutRow): void {
    const id = row.action.id;
    const tool = shortcutTool(id);
    if (tool) {
      this.applyToolShortcut(tool);
      return;
    }
    if (id.startsWith("pen.saved.")) {
      if (this.practice) return;
      const index = Number(id.slice("pen.saved.".length)) - 1;
      if (index >= 0) this.callbacks.onSavedPen?.(index);
      return;
    }
    switch (id) {
      case "edit.undo":
        return this.undo();
      case "edit.redo":
        return this.redo();
      case "edit.select-all":
        return this.selectAllOnPage();
      case "edit.delete":
        if (this.cropping) return;
        if (this.liveImageSelection() !== null) {
          this.deleteSelectedImage();
          return;
        }
        return this.deleteSelection();
      case "edit.copy":
        if (!this.cropping && this.hasSelection()) this.copySelection();
        return;
      case "edit.cut":
        if (!this.cropping && this.hasSelection()) this.cutSelection();
        return;
      case "edit.paste":
        if (!this.cropping) this.paste();
        return;
      case "view.zoom-in":
        return this.zoomIn();
      case "view.zoom-out":
        return this.zoomOut();
      case "view.zoom-fit":
        return this.resetView();
      case "view.next-page":
        return this.nextPage();
      case "view.previous-page":
        return this.previousPage();
      case "view.shortcuts":
        return this.callbacks.onShortcuts?.();
      default:
        // Full screen, the ruler, stickers, recording, stylus only mode and
        // turning ink into text are the host's; it answers whether it ran.
        this.callbacks.onShortcutAction?.(id);
    }
  }

  /** The tool a key press switches to, as a letter already did. */
  private applyToolShortcut(tool: ActiveTool): void {
    const next = selectedTool(
      this.toolState.tool,
      tool,
      this.callbacks.returnToPenOnReselect?.() === true,
      this.drawingTool,
    );
    if (this.practice && !isPracticeTool(next)) return;
    if (this.callbacks.toolOff?.(next) === true) return;
    this.setTool(next);
    this.callbacks.onToolChange?.(next);
  }

  /**
   * Hold a shortcut's tool until its key is let go: the tool itself goes in
   * hand, its own gesture and ink with it (the highlighter writes highlighter
   * ink), and the tool before it comes back on the key-up. The hand is
   * Space's way instead: the page moves while the key is down.
   */
  private beginHeldShortcut(row: ShortcutRow, input: ShortcutInput, pointerId?: number): void {
    if (this.heldShortcut) return;
    const tool = shortcutTool(row.action.id);
    if (!tool) return;
    if (this.practice && !isPracticeTool(tool)) return;
    if (this.callbacks.toolOff?.(tool) === true) return;
    const mod = input.mods.includes("Mod");
    const key = input.type === "key" ? input.key : null;
    const bit = input.type === "button" ? buttonBit(input.button) : 0;
    const by = { key, pointerId: pointerId ?? null, bit, mod, tool };
    if (tool === "pan") {
      this.heldShortcut = { ...by, back: null };
      this.setHand(true);
      return;
    }
    const inHand = this.pendingHeldTool ?? this.toolState.tool;
    this.heldShortcut = { ...by, back: inHand === tool ? null : inHand };
    if (inHand !== tool) this.switchHeldTool(tool);
  }

  /** Put `tool` in hand for a held key, after the press under way if there is one. */
  private switchHeldTool(tool: ActiveTool): void {
    if (this.pressing) {
      this.pendingHeldTool = tool;
      return;
    }
    this.pendingHeldTool = null;
    this.setTool(tool);
    this.callbacks.onToolChange?.(tool);
  }

  /** The press is over: a held key's switch that waited for it happens now. */
  private pressEnded(): void {
    this.pressing = false;
    const tool = this.pendingHeldTool;
    if (tool) this.switchHeldTool(tool);
  }

  /** The key that held a tool was let go. */
  private endHeldShortcut(event: KeyboardEvent): void {
    const held = this.heldShortcut;
    if (!held || held.key === null) return;
    // Apple's WebKit sends no key-up for a key let go while ⌘ is down, so
    // letting go of ⌘ (or Ctrl) ends a tool held with it.
    const modUp = held.mod && (event.key === "Meta" || event.key === "Control");
    if (!modUp && keyInput(event)?.key !== held.key) return;
    this.releaseHeldShortcuts();
  }

  /** Let go of a held shortcut where the key-up cannot arrive (blur, view close). */
  releaseHeldShortcuts(): void {
    const held = this.heldShortcut;
    if (!held) return;
    this.heldShortcut = null;
    if (held.tool === "pan") this.setHand(false);
    else if (held.back) this.switchHeldTool(held.back);
  }

  /**
   * The user's shortcut table for a pen or mouse button (a right click, the
   * side button, the eraser end), or null when the press is the contact or
   * its button is not in the table. Never while text is being typed: a
   * press there is the text box's.
   */
  private buttonShortcut(
    press: PointerReading,
  ): { match: ShortcutMatch; input: ShortcutInput } | null {
    const table = this.callbacks.shortcuts?.();
    if (!table || this.editingTextView() || this.heldText || this.cellEdit) return null;
    const input = buttonInput(press);
    if (!input) return null;
    const match = matchShortcut(table, input);
    return match ? { match, input } : null;
  }

  /**
   * A button press on the page that the table binds, before the press is a
   * stroke. A press-mode row runs and the press draws nothing; a hold-mode
   * tool goes in hand until the button is let go, and the press (a pen
   * touching down with the side button held) draws with it. Either way the
   * right click's menu and the side button's own settings stay out of it.
   */
  private onButtonPress(event: PointerEvent): void {
    const bound = this.buttonShortcut(event);
    if (!bound) return;
    this.stylusMenuUntil = now() + STYLUS_MENU_MS;
    this.buttonShortcutUntil = now() + STYLUS_MENU_MS;
    const { match, input } = bound;
    if (match.kind === "action" && match.row.mode === "hold" && match.row.action.holdable) {
      if (!shortcutTool(match.row.action.id)) return;
      this.beginHeldShortcut(match.row, input, event.pointerId);
      if (this.heldShortcut?.pointerId === event.pointerId)
        this.watchButtonRelease(event.pointerId);
      // A mouse's right button never draws; the pen touching down does.
      if (event.pointerType === "mouse") event.preventDefault();
      return;
    }
    // The pointer input listens on this same element: only this stops it.
    event.preventDefault();
    event.stopImmediatePropagation();
    if (match.kind === "action") this.runShortcut(match.row);
  }

  /** End a button's held tool when its pointer lets the button go, or lifts. */
  private watchButtonRelease(pointerId: number): void {
    const win = this.surfaceEl.ownerDocument.defaultView ?? window;
    const off = (): void => {
      win.removeEventListener("pointerup", onEvent, true);
      win.removeEventListener("pointercancel", onEvent, true);
      win.removeEventListener("pointermove", onEvent, true);
    };
    const onEvent = (event: PointerEvent): void => {
      const held = this.heldShortcut;
      if (!held || held.pointerId !== pointerId) {
        off();
        return;
      }
      if (event.pointerId !== pointerId) return;
      if (event.type === "pointermove" && (event.buttons & held.bit) !== 0) return;
      off();
      this.releaseHeldShortcuts();
    };
    win.addEventListener("pointerup", onEvent, true);
    win.addEventListener("pointercancel", onEvent, true);
    win.addEventListener("pointermove", onEvent, true);
    this.disposers.push(off);
  }

  /**
   * A press as the side button's own settings see it: with a button the
   * table binds taken out, so the barrel's erase or lasso does not lend a
   * tool over the one the shortcut put in hand.
   */
  private withoutBoundButton<T extends PressInput>(press: T): T {
    if (!this.buttonShortcut(press)) return press;
    return { ...press, button: 0, buttons: press.buttons & 1 };
  }

  /** Whether the pen's side button is in the table, so its click in the air is listened for. */
  private sideButtonBound(): boolean {
    const table = this.callbacks.shortcuts?.();
    if (!table) return false;
    return matchShortcut(table, SIDE_BUTTON) !== null;
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

  /** A key let go anywhere: space ends the hand (FineNotes#7), a held tool returns. */
  handleKeyUp(event: KeyboardEvent): void {
    this.endHeldShortcut(event);
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
      this.applyToolShortcut(action.tool);
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
    const zoom = this.gestureZoom;
    return zoom > 0 && Number.isFinite(zoom) ? length / zoom : length;
  }

  /**
   * The zoom the pen's gesture lengths are measured at ({@link atFitZoom}):
   * the page's, or for a stroke written in the Zoom box the box's own
   * magnification as a page zoom. At 4x in the box, a page px is 4 screen px
   * there whatever the page behind it shows, so the sample spacing, the hold
   * radius, the tap slop and the shape recogniser follow the box; left on the
   * page's zoom, small writing in the box lost most of its samples.
   */
  private get gestureZoom(): number {
    if (this.strokeInBox) {
      const zoom = this.zoomBoxZoom();
      if (zoom !== null) return zoom;
    }
    return this.userZoom;
  }

  /** The controller whose pen is drawing: the Zoom box's while a stroke is in it. */
  private get penController(): PointerController | null {
    return this.strokeInBox ? this.zoomInput : this.pointerInput;
  }

  /**
   * When a pen last did anything, on the page or in the Zoom box (event
   * time, ms); null before the first. A finger held just after is the
   * writing hand (`finger-hold.ts`).
   */
  private lastPenAt(): number | null {
    const page = this.pointerInput?.lastPenAt ?? null;
    const box = this.zoomInput?.lastPenAt ?? null;
    if (page === null) return box;
    return box === null ? page : Math.max(page, box);
  }

  /** {@link unitScale} for pen gestures: CSS px per page px where the pen writes. */
  private get gestureScale(): number {
    return this.baseScale * this.gestureZoom || 1;
  }

  /** The Zoom box's magnification as a page zoom; null without an open box. */
  private zoomBoxZoom(): number | null {
    const state = this.zoomBox;
    const canvas = this.zoomCanvas;
    if (!state || !canvas) return null;
    const rect = this.zoomCanvasRect ?? canvas.getBoundingClientRect();
    return zoomBoxGestureZoom(zoomView(state.box, rect.width, rect.height).scale, this.baseScale);
  }

  /**
   * Measure the pane, stack the pages, fit them to its width and size the
   * canvases to it. A pane without a size yet is tried again (`SizeWait`).
   */
  layout(): void {
    const renderer = this.renderer;
    if (!renderer) return;
    // In the background iPadOS may resize the app for its app-switcher
    // snapshots (in the other orientation, too), and every such size would
    // re-fit the scale and the zoom floor under the page being read; coming
    // back then showed another page (Joost's recording, 2026-10-21). Nobody
    // sees a hidden page: lay it out once it shows again, from where it was.
    if (this.surfaceEl.ownerDocument.visibilityState === "hidden") {
      this.layoutWhenShown = true;
      return;
    }
    const { clientWidth: cssW, clientHeight: cssH } = this.surfaceEl;
    const size = this.sizeWait.check(cssW, cssH);
    if (size === "retry") window.requestAnimationFrame(() => this.layout());
    if (size !== "layout") return;
    this.hudLayouts += 1;
    // A row zoomed in keeps the spot in the middle of the pane in the middle
    // when the pane changes width (the sidebar, the Ask AI panel, a rotation,
    // Split View): the scale and the gap between pages both follow the width,
    // so the old scroll offset would name a spot pages away.
    if (isBoard(this.doc) && this.doc.pages.length === 1) {
      this.layoutBoardView(cssW, cssH);
      this.layoutTail(cssW, cssH);
      return;
    }
    if (this.board) {
      // A board's zoom counts from the writing size: a notebook starts afresh.
      this.renderer?.setPreviewWindow(null);
      this.board = false;
      this.boardDrawn = null;
      this.boardHold = null;
      this.zoomInitialised = false;
    }
    const rowAnchor =
      this.zoomInitialised && this.direction === "horizontal" && !this.pinch && !this.atZoomFloor
        ? this.rowPointAt(this.cssW / 2, this.cssH / 2)
        : null;
    this.cssW = cssW;
    this.cssH = cssH;
    this.ruler?.fitPane();

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
    const joined = joinedPagesOf(this.doc);
    // Mirrors leave the index while the pages are joined, and join it apart.
    const rejoined = joined !== (this.joined === true);
    this.joined = joined;
    if (rejoined) this.strokeIndex?.rebuild(this.doc.pages);
    this.pageLayout = layoutPages(this.doc.pages, { direction, joined });
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
      // Zoomed in, the gap closes so the next page shows beside this one.
      // Joined pages have no gap to space or close: 0 keeps `syncRowGap` out.
      this.rowSlot = joined ? 0 : rowSlotGap(this.doc.pages, cssW, this.baseScale * this.minZoom);
      this.rowGap = Number.NaN;
      this.syncRowGap();
    }
    this.ensurePaperSize();
    const scale = this.scale;
    if (anchored && priorScale > 0 && Math.abs(scale / priorScale - 1) > 1e-6) {
      const ratio = scale / priorScale;
      this.scroller.setPosition(priorAt.x * ratio, priorAt.y * ratio);
    }
    const rowSpot =
      rowAnchor && !turned && !this.atZoomFloor ? this.pageLayout.boxes[rowAnchor.index] : null;
    if (rowAnchor && rowSpot) {
      this.scroller.setPosition(
        (rowSpot.x + rowAnchor.local.x) * scale - cssW / 2,
        (rowSpot.y + rowAnchor.local.y) * scale - cssH / 2,
      );
    }
    if (turned) {
      this.userZoom = this.minZoom;
      this.ensurePaperSize();
      this.goToPage(reading);
    } else if (direction === "horizontal" && this.atZoomFloor && this.isScrollIdle) {
      // A pane that changed shape (rotation, split view) keeps the page centred.
      this.scroller.setPosition(this.rowX(this.pageIndex), 0);
    }
    this.layoutTail(cssW, cssH);
  }

  /** The end of every layout: size the canvases, place the paper and paint. */
  private layoutTail(cssW: number, cssH: number): void {
    this.renderer?.resize(cssW, cssH, backingScale(window.devicePixelRatio));
    this.syncViewport();
    this.syncInkCursor();
    this.settleIfIdle();
    this.renderAll();
    this.schedulePrefetch();
    if (this.debug) this.scheduleHud();
    this.reportSizeScale();
  }

  /**
   * Lay out an endless board (FineNotes#46): its one page at the origin, at
   * the writing size times the zoom; it opens at 100% on the middle of its
   * drawing. Afterwards the point in the middle of the pane stays there
   * when the pane changes shape, and moves with the board's content when a
   * left or up growth shifts it (`boardShift`), so the view never jumps.
   */
  private layoutBoardView(cssW: number, cssH: number): void {
    const page = this.doc.pages[0];
    const scaleBefore = this.unitScale;
    const shift = this.boardShift;
    this.boardShift = { x: 0, y: 0 };
    // The page point in the middle of the pane, before anything changes.
    // Opened anew, or a notebook before in this leaf: 100% on the middle.
    const fresh = !this.zoomInitialised || !this.board;
    const anchor = !fresh
      ? {
          x: (this.cssW / 2 - this.offsetX) / scaleBefore + shift.x,
          y: this.viewport.scrollY + this.cssH / 2 / scaleBefore + shift.y,
        }
      : null;
    const resized = cssW !== this.cssW || cssH !== this.cssH;
    const position = this.scroller.position;
    this.cssW = cssW;
    this.cssH = cssH;
    this.board = true;
    this.direction = "vertical";
    this.pageLayout = layoutBoard(page);
    // The stand-in while tiles catch up covers the drawing, not the whole board.
    if (fresh) this.renderer?.setPreviewWindow(() => this.boardPreviewWindow());
    this.renderer?.setLayout(this.pageLayout);
    this.boardDrawn = drawnBounds(page);
    this.baseScale = WRITING_SCALE;
    this.minZoom = boardFitZoom(this.boardDrawn, WRITING_SCALE, cssW, cssH);
    if (fresh) {
      this.userZoom = 1;
      this.zoomAnim = null;
    }
    this.zoomInitialised = true;
    this.ensurePaperSize();
    const scale = this.scale;
    if (!anchor) {
      const centre = boardCentre(page.geometry, this.boardDrawn);
      const home = boardScrollToCentre(centre, scale, cssW, cssH);
      this.scroller.setPosition(home.x, home.y);
    } else if (this.pinch) {
      // Mid-pinch the fingers hold the view: only the shift moves it.
      this.scroller.nudge(shift.x * scale, shift.y * scale);
    } else if (resized || shift.x !== 0 || shift.y !== 0) {
      const at = boardScrollToCentre(anchor, scale, cssW, cssH);
      this.scroller.setPosition(at.x, at.y);
    } else {
      this.scroller.setPosition(position.x, position.y);
    }
  }

  /**
   * After an edit on a board: keep what is drawn, the zoom floor and the
   * scroll range up to date, and grow the page where the newest edit came
   * within a screen of an edge, as part of that edit's undo step (once per
   * step, and never under a redo branch, where it would move the document
   * out from under the steps there).
   */
  private growBoard(): void {
    if (!this.board) return;
    const page = this.doc.pages[0];
    if (!page) return;
    const before = this.boardDrawn;
    this.boardDrawn = drawnBounds(page);
    if (before && (!this.boardDrawn || !boundsContain(this.boardDrawn, before))) {
      // Less drawn than before (an erase, an undo): keep the view where it is.
      this.boardHold = this.visibleBoardRect();
    }
    this.minZoom = boardFitZoom(this.boardDrawn, WRITING_SCALE, this.cssW, this.cssH);
    this.dropStaleBoardPreview();
    const latest = this.history.latest;
    if (latest && !this.boardChecked.has(latest) && !this.history.canRedo()) {
      this.boardChecked.add(latest);
      const scale = this.unitScale;
      const growth = boardGrowth(page.geometry, this.boardDrawn, {
        x: this.cssW / scale,
        y: this.cssH / scale,
      });
      if (!isNoGrowth(growth)) {
        const grow = new GrowBoard(page.id, growth, (dx, dy) => {
          this.boardShift.x += dx;
          this.boardShift.y += dy;
        });
        // Its `onChange` lays the board out again (`syncBoardLayout`).
        if (this.history.attach(this.doc, grow) && this.history.latest) {
          this.boardChecked.add(this.history.latest);
        }
        return;
      }
    }
    this.ensurePaperSize();
  }

  /**
   * The part of a board its stand-in preview shows: what is drawn and what
   * is on screen, and a screen more on every side (page px).
   */
  private boardPreviewWindow(): Bounds {
    const view = this.visibleBoardRect();
    const drawn = this.boardDrawn ? boundsUnion(this.boardDrawn, view) : view;
    const mx = view.maxX - view.minX;
    const my = view.maxY - view.minY;
    return {
      minX: drawn.minX - mx,
      minY: drawn.minY - my,
      maxX: drawn.maxX + mx,
      maxY: drawn.maxY + my,
    };
  }

  /**
   * Drop a board's preview once it no longer covers the drawing and the
   * view (ink beyond it, or the view zoomed out past it): the next one is
   * made around them.
   */
  private dropStaleBoardPreview(): void {
    const page = this.doc.pages[0];
    if (!this.board || !page || !this.renderer) return;
    const area = this.renderer.previewArea(page.id);
    if (!area) return;
    const view = this.visibleBoardRect();
    const needed = this.boardDrawn ? boundsUnion(this.boardDrawn, view) : view;
    const clipped = {
      minX: Math.max(0, needed.minX),
      minY: Math.max(0, needed.minY),
      maxX: Math.min(page.geometry.width, needed.maxX),
      maxY: Math.min(page.geometry.height, needed.maxY),
    };
    if (!boundsContain(area, clipped)) this.renderer.dropPreview(page.id);
  }

  /** The part of the board on screen, page px. */
  private visibleBoardRect(): Bounds {
    const scale = this.unitScale;
    const left = -this.offsetX / scale;
    const top = this.viewport.scrollY;
    return { minX: left, minY: top, maxX: left + this.cssW / scale, maxY: top + this.cssH / scale };
  }

  /** A finger or the wheel moves the view: the range an erase held open closes again. */
  private releaseBoardHold(): void {
    if (!this.boardHold) return;
    this.boardHold = null;
    if (this.board) this.ensurePaperSize();
  }

  /**
   * The board's page changed size, or its content moved (a growth, its undo,
   * or a withdrawn step that held one): lay it out again at once, the view
   * moving with the content, before anything paints.
   */
  private syncBoardLayout(): void {
    if (!this.board && !isBoard(this.doc)) return;
    const moved = this.boardShift.x !== 0 || this.boardShift.y !== 0;
    if (!moved && !this.layoutStale()) return;
    this.strokeIndex.rebuild(this.doc.pages);
    this.renderer?.invalidateAll();
    this.layout();
  }

  /** Tell the host when {@link sizePreviewScales} is not what it last said. */
  private reportSizeScale(): void {
    const { pen, eraser } = this.sizePreviewScales();
    const last = this.reportedSizeScale;
    if (last && last.pen === pen && last.eraser === eraser) return;
    this.reportedSizeScale = { pen, eraser };
    this.callbacks.onSizeScale?.();
  }

  /**
   * The row page nearest the pane point (`sx`, `sy`) (pane px) and the
   * page-local point under it, read from the layout as it is now.
   */
  private rowPointAt(
    sx: number,
    sy: number,
  ): { index: number; local: { x: number; y: number } } | null {
    const scale = this.unitScale;
    const at = { x: (sx - this.offsetX) / scale, y: sy / scale + this.viewport.scrollY };
    const index = nearestRowBox(this.pageLayout.boxes, at.x);
    const box = this.pageLayout.boxes[index];
    return box ? { index, local: this.toPage(box, at) } : null;
  }

  private relayoutFrame = 0;
  /** A layout was asked for while the page was hidden (`layout`): do it on showing. */
  private layoutWhenShown = false;
  /**
   * The page a zoomed-in row is held to (`ensurePaperSize`). Its own field,
   * not `pageIndex`: the page indicator rewrites `pageIndex` from what is on
   * screen while the view glides to a new page, and the hold must not follow
   * it back. Null when no row is held (zoomed out, pages down): the hold
   * then starts on the page being read.
   */
  private heldPage: number | null = null;

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
    const page = this.doc.pages[0];
    if (this.board && page) {
      // Free both ways, a screen past the drawing (and past the view an erase left).
      const drawn = this.boardDrawn;
      const hold = this.boardHold;
      const range = boardScrollRange(
        page.geometry,
        drawn && hold ? boundsUnion(drawn, hold) : (drawn ?? hold),
        scale,
        this.cssW,
        this.cssH,
      );
      this.scroller.setExtent({
        contentWidth: width,
        contentHeight: height,
        viewportWidth: this.cssW,
        viewportHeight: this.cssH,
        alwaysBounceX: true,
        rangeX: { min: range.minX, max: range.maxX },
        rangeY: { min: range.minY, max: range.maxY },
        freeAxes: true,
        trailY: this.typingField() ? keyboardHeight() : 0,
      });
      return;
    }
    const row = this.direction === "horizontal";
    const insets = row ? rowScrollInsets(this.pageLayout, scale, this.cssW) : { lead: 0, trail: 0 };
    // Zoomed in, a row is held to the page being read, as Goodnotes holds it
    // (Joost's recording, 2026-10-21): its edges stop at the pane's, and a
    // pull past one shows the next page and, far enough, turns to it
    // (`rowEdgeTurn`). While a pinch is on, the whole row is free, so the
    // neighbours show beside the page; letting go settles on the page then
    // in the middle (`onPinchEnd`). Joined pages are never held (`heldRow`).
    const last = this.pageLayout.boxes.length - 1;
    const rangeX =
      row && !this.turnsPages && last >= 0
        ? this.pinch || this.joined
          ? {
              min: rowPageScrollRange(this.pageLayout, 0, scale, this.cssW).min,
              max: rowPageScrollRange(this.pageLayout, last, scale, this.cssW).max,
            }
          : rowPageScrollRange(this.pageLayout, this.heldIndex(), scale, this.cssW)
        : undefined;
    // Zoomed out (or pages down) nothing is held; a later zoom-in starts on
    // the page then being read.
    if (!row || this.turnsPages) this.heldPage = null;
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
      trailY: this.typingField() ? keyboardHeight() : 0,
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
      this.zoomAnim === null &&
      this.rowSettle === null
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
    // A board always scrolls: its range centres a page smaller than the pane.
    this.offsetX =
      !this.board && this.direction !== "horizontal" && paperWidth <= this.cssW
        ? (this.cssW - paperWidth) / 2
        : -x;
    this.paperEl.setCssStyles({ transform: `translate(${this.offsetX}px, ${-y}px)` });
    this.viewport = { scrollY: y / scale, scale, width: this.pageLayout.width };
    this.renderer.setViewport(this.viewport, this.offsetX);
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
    // A board has no pages to count; the zoom readout stays.
    this.indicatorEl.toggleClass("is-hidden", total === 0 || this.board);
    if (index !== this.pageIndex) {
      this.pageIndex = index;
      this.markCurrentTab();
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
      // Past the point where letting go opens the overview, the pill says so
      // with the overview's symbol instead of a percentage.
      if (!this.pinchOverviewArmed) {
        this.zoomReadoutEl.removeClass("is-overview");
        this.zoomReadoutEl.setText(`${zoomPercent(this.scale)}%`);
      } else if (!this.zoomReadoutEl.hasClass("is-overview")) {
        this.zoomReadoutEl.empty();
        setIcon(this.zoomReadoutEl, "layout-grid");
        this.zoomReadoutEl.addClass("is-overview");
      }
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

  /**
   * The wet layer changes on its own frame, which does not repaint the page's
   * dry layer (or the Zoom box with it). Ask for one window repaint, unless
   * the page's own frame is already coming and will paint it.
   */
  private requestZoomPaint(): void {
    if (!this.zoomBox || this.frameReq || this.zoomPaintFrame) return;
    this.zoomPaintFrame = window.requestAnimationFrame(() => {
      this.zoomPaintFrame = 0;
      this.paintZoomBox();
    });
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
    // After the zoom, which moves the view about the fingers' point.
    const settling = this.stepRowSettle(t);
    // A lasso selection held at the pane's edge carries the view along.
    const carrying = this.stepGroupDragScroll();
    const moving = scrolling || zooming || settling || carrying;
    const busy = moving || this.scroller.isDragging || this.pinch !== null;
    this.noteViewMotion(busy);
    this.syncViewport();
    // The ruler's centimetres are the page's, at the zoom now.
    this.ruler?.setScale(this.scale);
    // A board's stand-in is coarse: its tiles start at the new zoom as soon
    // as the zoom is over, not after a fling that follows it has stopped.
    if (this.board && this.renderer.isTransient && !this.zoomTransient) {
      this.renderer.settle();
      this.dropStaleBoardPreview();
    }
    // The zoom has ended (a fling may carry on): place the boxes it hid or scaled.
    if (this.textBoxesProvisional && !this.zoomTransient) this.syncTextBoxes();
    this.trackTextPillMotion(busy);
    this.dropTextOutOfSight();
    this.reportTextAnchor();
    this.syncPullAdd();
    if (busy) this.flashChrome();
    const complete = this.paint(busy ? SCROLL_FRAME_BUDGET_MS : REST_FRAME_BUDGET_MS);
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
    // A few tiles a frame, the last zoom's scaled meanwhile.
    if (!this.paint(REST_FRAME_BUDGET_MS)) this.requestFrame();
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
    this.paintZoomBox();
    return complete;
  }

  /**
   * Rasterise ahead, and repair the page previews, in idle frames. Not while
   * the pen is on the page: the eraser paints in frames now, and between
   * them this repaired the preview of the page it was on every time,
   * though nothing shows a preview until a scroll needs one.
   */
  private schedulePrefetch(): void {
    if (this.prefetchReq || !this.renderer) return;
    this.prefetchReq = window.requestAnimationFrame(() => {
      this.prefetchReq = 0;
      if (!this.renderer || this.frameReq || this.scroller.isDragging || this.pinch) return;
      if (this.pressing) return;
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
      if (anim.settle) this.settleAfterZoom(anim.settle);
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
    let before = this.toLayout(anchorX, anchorY);
    // A row's pages slide together as it zooms in (`syncRowGap`): keep the
    // point of the page under the fingers fixed, not the layout point.
    const boxes = this.pageLayout.boxes;
    const held = this.direction === "horizontal" ? nearestRowBox(boxes, before.x) : -1;
    const local = held >= 0 ? this.toPage(boxes[held], before) : null;
    this.userZoom = nextZoom;
    if (this.syncRowGap() && local) {
      const box = this.pageLayout.boxes[held];
      if (box) before = { x: box.x + local.x, y: box.y + local.y };
    }
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
    this.syncCommentMarkers();
    this.syncCalcChip();
    this.syncSectionRibbons();
    this.syncSpaceHandles();
    this.flashChrome(true);
    this.requestFrame();
    this.reportStatus();
    // The toolbar's width marks follow once the zoom rests, not every frame.
    window.clearTimeout(this.sizeScaleTimer);
    this.sizeScaleTimer = window.setTimeout(() => {
      this.sizeScaleTimer = 0;
      this.reportSizeScale();
    }, SIZE_SCALE_SETTLE_MS);
  }

  /** The slot gap of a row at the zoom floor (`rowSlotGap`), set by `layout`. */
  private rowSlot = 0;
  /** The gap the row is laid out with now (`rowGapAtZoom`); NaN forces a layout. */
  private rowGap = Number.NaN;

  /**
   * Lay a row of pages out with the gap for the zoom now: the slot gap at
   * the floor, closing to a thin strip zoomed in, so the neighbouring page
   * shows (FineNotes#34). Tiles are per page, so moving pages costs no
   * rasterising. Returns whether the pages moved.
   */
  private syncRowGap(): boolean {
    if (this.direction !== "horizontal" || !(this.rowSlot > 0)) return false;
    const gap = rowGapAtZoom(this.rowSlot, this.userZoom, this.minZoom, this.scale);
    // Zoomed well in the gap is a fixed 20 screen px, a little less in page
    // units at every zoom step: lay the notebook out again only when it moved
    // by 3% (well under a px on screen), not on every frame of a pinch.
    if (Math.abs(gap - this.rowGap) < Math.max(0.01, this.rowGap * 0.03)) return false;
    this.rowGap = gap;
    this.pageLayout = layoutPages(this.doc.pages, { direction: "horizontal", gap });
    this.renderer?.setLayout(this.pageLayout);
    return true;
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
    this.releaseBoardHold();
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

  /** A row zoomed in, held to the page being read (`ensurePaperSize`). */
  private get heldRow(): boolean {
    // Joined pages are one strip: zoomed in, it pans freely over the joins,
    // so writing can run on from one page into the next.
    return this.direction === "horizontal" && !this.turnsPages && !this.joined;
  }

  /** The page a zoomed-in row is held to: `heldPage`, or the page being read. */
  private heldIndex(): number {
    const last = Math.max(0, this.doc.pages.length - 1);
    return Math.max(0, Math.min(last, this.heldPage ?? this.pageIndex));
  }

  /**
   * Move a zoomed-in row's hold to page `index` and go to `x`, `y` on it from
   * where the view is now: the view is put back where it was after the range
   * changes, so a glide starts there instead of jumping into the new range.
   */
  private glideHeldTo(index: number, x: number, y: number, animate: boolean): void {
    const from = this.scroller.position;
    this.heldPage = index;
    // The new range may not hold where the view is (an idle scroller is
    // clamped into it at once): the glide starts from where it was.
    this.ensurePaperSize();
    if (animate) this.scroller.glideTo(x, y, now(), undefined, from);
    else this.scroller.setPosition(x, y);
  }

  /**
   * Zoomed in, turn a held row to the page beside the one being read, at the
   * same zoom and height: it glides on to the next page's left edge, or back
   * to the previous page's right edge (`rowEdgeTurn`).
   */
  private turnHeldPage(step: -1 | 1): void {
    const to = this.heldIndex() + step;
    if (to < 0 || to >= this.doc.pages.length) return;
    const range = rowPageScrollRange(this.pageLayout, to, this.scale, this.cssW);
    this.glideHeldTo(to, step > 0 ? range.min : range.max, this.scroller.position.y, true);
    this.flashChrome();
    this.requestFrame();
  }

  /**
   * A pinch on a zoomed-in row ended: hold the row to the page now in the
   * middle of the pane and glide onto it, as Goodnotes settles on the page
   * when the fingers lift (the neighbours go out of sight again).
   */
  private settleHeldPage(): void {
    if (!this.heldRow) return;
    // The page indicator reports the page change from what is on screen.
    const at = this.rowPointAt(this.cssW / 2, this.cssH / 2);
    if (at) this.heldPage = at.index;
    const range = rowPageScrollRange(this.pageLayout, this.heldIndex(), this.scale, this.cssW);
    const { x } = this.scroller.position;
    const inside = Math.min(range.max, Math.max(range.min, x));
    // A finger still down carries the gesture on as a pan; its release springs
    // into the new range. Otherwise glide there now, before the range tightens.
    if (!this.scroller.isDragging && Math.abs(inside - x) > 0.5)
      this.scroller.snapTo(inside, null, now());
    this.ensurePaperSize();
    this.requestFrame();
  }

  /** Centre the page being read, if a pinch asked for it on ending (see `onPinchEnd`). */
  private settleRowAfterZoom(): void {
    if (!this.snapRowAfterZoom) return;
    this.snapRowAfterZoom = false;
    if (this.turnsPages) this.snapToPage(0, this.pageIndex);
  }

  /**
   * A pinch on a row let go where the row turns pages: carry the page being
   * read into the centre while the zoom springs back, instead of snapping it
   * there afterwards. A snap started mid-spring aimed at where the page was
   * before the zoom moved it, and threw the view a page off (Joost's
   * recording, 2026-10-21).
   */
  private startRowSettle(): void {
    const page = this.pageIndex;
    const { x, y } = this.scroller.position;
    this.scroller.stop();
    this.rowSettle = { page, dx: x - this.rowX(page), dy: y, t0: now() };
    this.requestFrame();
  }

  /** Advance `rowSettle`; true while it moves. Anything else moving the view ends it. */
  private stepRowSettle(t: number): boolean {
    const settle = this.rowSettle;
    if (!settle) return false;
    if (this.scroller.isDragging || this.scroller.isAnimating || this.pinch) {
      this.rowSettle = null;
      return false;
    }
    const progress = (t - settle.t0) / ZOOM_SPRING_MS;
    const left = progress >= 1 ? 0 : 1 - easeOutCubic(progress);
    // Centred at the scale of this frame: the zoom may still be springing.
    this.scroller.setPosition(this.rowX(settle.page) + settle.dx * left, settle.dy * left);
    if (progress < 1) return true;
    this.rowSettle = null;
    return false;
  }

  /** The fingers of the pinch under way have closed far enough to open the overview. */
  private get pinchOverviewArmed(): boolean {
    return (
      this.pinchOverviewEnabled &&
      this.pinch !== null &&
      pinchOpensOverview(this.pinch.raw, this.minZoom)
    );
  }

  /**
   * A pinch let go well past the fit: the host shows every page. The page
   * goes back to the fit under the overview at once, centred, so it is
   * there when the overview closes; the finger still down is done with.
   */
  private openOverviewFromPinch(): void {
    // The page as the fingers left it, before it goes back to the fit.
    const snapshot = this.snapshotPage();
    this.zoomAnim = null;
    this.rowSettle = null;
    this.snapRowAfterZoom = false;
    this.scroller.cancel();
    this.applyZoom(this.minZoom, this.cssW / 2, this.cssH / 2);
    if (this.direction === "horizontal") this.scroller.setPosition(this.rowX(this.pageIndex), 0);
    this.syncViewport();
    this.zoomReadoutEl.addClass("is-idle");
    this.callbacks.onPinchOverview?.(snapshot);
    this.requestFrame();
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
    // Zoomed in, a row is held to one page: past its end is past the
    // notebook's end only on the last page (elsewhere a pull turns the page).
    if (this.heldRow && this.heldIndex() !== this.doc.pages.length - 1) return 0;
    const end = this.scroller.overscrollEnd;
    return this.direction === "horizontal" ? end.x : end.y;
  }

  /** How far a pull is to adding a page: rows ask for a longer pull (`ROW_PULL_ADD_PX`). */
  private pullProgress(over: number): number {
    const threshold = this.direction === "horizontal" ? ROW_PULL_ADD_PX : PULL_ADD_PAGE_PX;
    return pullAddProgress(over, threshold);
  }

  /** Whether the finger gesture so far may pull in a new page (`pullAddAllowed`). */
  private pullAllowed(): boolean {
    const g = this.pullGesture;
    if (!g) return false;
    const row = this.direction === "horizontal";
    const dx = g.x - g.fromX;
    const dy = g.y - g.fromY;
    return pullAddAllowed({
      pinched: g.pinched,
      along: row ? dx : dy,
      across: row ? dy : dx,
    });
  }

  /** Keep the pull-to-add ring in step with the stretch while a finger holds it. */
  private syncPullAdd(): void {
    if (!this.pullAddEnabled || !this.touchPanning || !this.pullAllowed()) {
      this.pullAdd.hide();
      return;
    }
    const over = this.pullOverscroll();
    this.pullAdd.update(this.direction, over, this.pullProgress(over));
  }

  /** Repaint backdrop + ink and re-place the text boxes and selection chrome (zoom, layout, edits). */
  private renderAll(): void {
    this.paint(Infinity);
    this.syncTextBoxes();
    this.syncImageOverlay();
    this.syncSelectionOverlay();
    this.syncLockBadges();
    this.syncCommentMarkers();
    this.syncCalcChip();
    this.syncSectionRibbons();
    this.syncSpaceHandles();
    this.syncPageTabs();
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
    const onDom = this.noteTextShownByDom();
    this.syncNoteTextTiles(onDom);

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
        // A mirror is drawn by its owner's box, which runs over the join.
        if (this.joined && isMirror(textBox)) continue;
        const key = `${page.id}:${textBox.id}`;
        expected.add(key);
        let view = this.textBoxInputs.get(key);
        if (!view) view = this.createTextBoxView(page.id, textBox, key);
        const { input, root } = view;
        // A note's text is drawn with its note, but while its textarea shows it.
        const drawnOnNote =
          textBox.onSticky !== undefined &&
          noteOfText(page, textBox) !== null &&
          !onDom.has(textBox.id);
        // Never the box being typed in or held: hiding it would blur it.
        const park =
          (parked || drawnOnNote) &&
          !root.contains(document.activeElement) &&
          this.heldText !== view;
        root.toggleClass("is-parked", park);
        if (park) {
          if (parked) this.textBoxesProvisional = true;
          continue;
        }
        if (document.activeElement !== input && input.value !== textBox.text)
          input.value = textBox.text;
        this.renderShownText(view, textBox.text);
        // Mid-zoom a box keeps the layout it last had and is scaled whole from
        // it; it is laid out again once the zoom rests. Not the box being typed
        // in or framed, nor during a lasso resize (which scales boxes itself).
        if (
          zooming &&
          view.laidAt > 0 &&
          document.activeElement !== input &&
          this.frameDraft?.key !== key &&
          this.groupDrag === null
        ) {
          const shift = this.dragShift(page.id, textBox);
          root.setCssStyles({
            left: `${((box.x + textBox.x + shift.x) * scale).toFixed(2)}px`,
            top: `${((box.y + textBox.y + shift.y) * scale).toFixed(2)}px`,
            transform: `scale(${(scale / view.laidAt).toFixed(5)})`,
            transformOrigin: "0 0",
          });
          view.zoomScaled = true;
          this.textBoxesProvisional = true;
          continue;
        }
        if (view.zoomScaled) {
          view.zoomScaled = false;
          root.setCssStyles({ transform: "", transformOrigin: "" });
        }
        view.laidAt = scale;
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
          // A covered tape over the box hides it there, as it hides ink;
          // never the box being typed in.
          clipPath:
            document.activeElement === input
              ? ""
              : tapeClipPath(
                  page.strokes,
                  {
                    x: frame.x + shift.x,
                    y: frame.y + shift.y,
                    w: width,
                    h: frame.h ?? box.height,
                  },
                  scale,
                  (tape) => this.revealedTapes.has(this.tapeKey(tape)),
                ),
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
          // Capitals as the canvas draws them (`shownCase`), the typed text unchanged.
          textTransform: textBox.caps === true ? "uppercase" : "",
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
      if (document.activeElement === view.input) this.blurTextInput(view.input, "gone");
      // A kept box that went (an undo took it): nothing is held any more.
      if (this.heldText === view) this.heldText = null;
      view.root.remove();
    }
    // The pill floats by its box: a moved, resized, restyled or removed box moves it.
    this.reportTextAnchor();
    this.placeCellEditor();
  }

  /**
   * Build a box's shown text from its typed text: plain runs as text, links
   * as their shown text in a span that opens them. A box with no links shows
   * its textarea alone (`has-links` is off).
   *
   * A checklist's boxes are spans that tick on a tap. A box with boxes but no
   * links (`has-checks`) keeps its textarea shown and only the boxes of the
   * copy take taps, laid exactly over the textarea's own: on the iPad, a tap
   * on the words of a see-through textarea brought the keyboard up and
   * straight down again (2.5.1).
   */
  private renderShownText(view: TextBoxView, text: string): void {
    if (view.shownText === text) return;
    view.shownText = text;
    view.shown.empty();
    let links = 0;
    let checks = 0;
    // A checklist's boxes (2.5) are tappable like links: a tap ticks one.
    const boxes = taskBoxes(text);
    let at = 0;
    for (const segment of textSegments(text)) {
      const target = segment.target;
      const from = at;
      at += segment.text.length;
      if (target === undefined) {
        let done = 0;
        for (const box of boxes) {
          if (box.offset < from || box.offset >= at) continue;
          view.shown.appendText(segment.text.slice(done, box.offset - from));
          const check = view.shown.createSpan({
            cls: "goodobsidian-textbox-check",
            text: segment.text.charAt(box.offset - from),
            attr: { role: "checkbox", "aria-checked": String(box.done) },
          });
          this.bindTextTask(check, view, box.line, !box.done);
          done = box.offset - from + 1;
          checks++;
        }
        view.shown.appendText(segment.text.slice(done));
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
    view.root.toggleClass("has-checks", checks > 0 && links === 0);
  }

  /**
   * A checklist box in a text box ticks (or unticks) on a tap, as one step
   * of undo, without the box being edited. Pointer events, as for a link.
   */
  private bindTextTask(el: HTMLElement, view: TextBoxView, line: number, done: boolean): void {
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
      const live = this.liveTextBox(view.pageId, view.id);
      if (!live || this.callbacks.isLocked?.()) return;
      const text = setTaskDone(live.text, line, done);
      if (text === live.text) return;
      this.history.push(
        this.doc,
        new SetTextBoxText(view.pageId, view.id, text, done ? "Tick task" : "Untick task"),
      );
      view.input.value = text;
      this.renderShownText(view, text);
      this.changed([view.pageId]);
    });
    el.addEventListener("pointercancel", () => {
      pressed = null;
    });
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
    const shown = shownCase(textBox.text, textBox);
    const key = `${font}|${room}|${inset}|${shown}`;
    if (view.fitKey === key) return view.fitW;
    this.measureCtx ??= createEl("canvas").getContext("2d");
    const ctx = this.measureCtx;
    // One wide character at least: room for the caret in an empty box.
    const min = Math.ceil(textBox.fontSize + 2 * inset);
    if (!ctx) return Math.max(min, textBox.w);
    ctx.font = font;
    view.fitKey = key;
    view.fitW = fitTextWidth(shown, min, room, (text) => ctx.measureText(text).width, inset);
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
      laidAt: 0,
      zoomScaled: false,
      focusedAt: 0,
    };

    // Text editing must never start an ink gesture on the scroll overlay
    // beneath it. Snapshot the scroll position before the browser focuses the
    // box, so a jump it makes to "reveal" the caret can be undone.
    input.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      if (document.activeElement !== input) this.pendingFocusHold = this.scrollSnapshot();
    });
    input.addEventListener("focus", () => {
      view.focusedAt = now();
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
      if (this.debug) this.noteTextEnd(view, event);
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
      this.followTextBox(pageId, live);
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

  /**
   * Typing changes a box in place, outside the undo steps; its mirrors over
   * the join (`canvas/mirrors.ts`) follow the same way, so they are never
   * behind what the owner shows. The next step's sync puts everything else
   * right.
   */
  private followTextBox(pageId: string, owner: TextBoxElement): void {
    if (!this.joined) return;
    const key = ownerKey(pageId, owner.id);
    for (const page of this.doc.pages) {
      for (const mirror of page.textBoxes) {
        if (mirror.join !== key) continue;
        mirror.text = owner.text;
        mirror.w = owner.w;
        if (owner.h === undefined) delete mirror.h;
        else mirror.h = owner.h;
      }
    }
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
    const view = this.typingField();
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
    // Scrolled to show the box, not away from it: where it is seen from next.
    this.textSeen = null;
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
    const preview = this.erasePreviewPass();
    const complete = this.renderer.renderDocument(
      this.doc,
      this.inkPressure,
      preview.hidden,
      null,
      preview.replaced,
      budgetMs,
      this.viewMoving,
      preview.greyed,
    );
    // A direct dry repaint (an erase preview, a lifted image) does not always
    // ride the page's frame loop; the window still has to follow it.
    this.requestZoomPaint();
    return complete;
  }

  /**
   * What a live erase gesture hides, replaces or greys. The Zoom box paints
   * the same preview, so a stroke rubbed out in either view goes as it is
   * rubbed, not when the pen lifts.
   */
  private erasePreviewPass(): {
    hidden?: ReadonlySet<string>;
    replaced?: ReadonlyMap<string, readonly Stroke[]>;
    greyed?: ReadonlySet<string>;
  } {
    const grey = this.eraseGrey;
    let greyed: ReadonlySet<string> = this.eraseIds;
    let pieces: ReadonlyMap<string, readonly Stroke[]> = this.erasePieces;
    if (grey && this.eraseGreyCuts.size > 0) {
      // A cut stroke shows its grey stretches with what survives of it.
      const shown = new Map<string, readonly Stroke[]>(this.erasePieces);
      const ids = new Set(this.eraseIds);
      for (const [id, stretches] of this.eraseGreyCuts) {
        shown.set(id, [...stretches, ...(this.erasePieces.get(id) ?? [])]);
        for (const stretch of stretches) ids.add(stretch.id);
      }
      pieces = shown;
      greyed = ids;
    }
    let hidden: ReadonlySet<string> = this.eraseIds;
    if (this.joined && (greyed.size > 0 || pieces.size > 0)) {
      const onMirrors = this.mirrorErasePreview(grey ? greyed : hidden, pieces);
      pieces = onMirrors.pieces;
      if (grey) greyed = onMirrors.hidden;
      else hidden = onMirrors.hidden;
    }
    return {
      hidden: grey ? undefined : hidden,
      replaced: pieces,
      greyed: grey ? greyed : undefined,
    };
  }

  /**
   * Re-rasterise the tiles under the strokes the erase gesture changed since
   * the last paint, on whichever page each is (with the pages joined the
   * eraser goes on over the join), and under their mirrors.
   */
  private flushEraseDirty(): void {
    const cuts = this.eraseCuts;
    this.eraseCuts = new Map();
    const idle = this.eraseDirty.size === 0 && cuts.size === 0;
    if (idle || !this.activePage || !this.renderer) {
      this.eraseDirty.clear();
      return;
    }
    for (const [index, areas] of cuts) {
      // One event's dabs overlap one another: painted again as one area.
      const merged: Bounds[] = [];
      for (const area of areas) {
        const last = merged[merged.length - 1];
        if (last && boundsMeet(last, area))
          merged[merged.length - 1] = unionBounds(last, area) ?? last;
        else merged.push(area);
      }
      for (const area of merged) this.renderer?.invalidateArea(index, area);
    }
    const dirty = new Map<number, Bounds>();
    const add = (index: number, bounds: Bounds | null): void => {
      if (bounds) dirty.set(index, unionBounds(dirty.get(index) ?? null, bounds) ?? bounds);
    };
    for (const id of this.eraseDirty) {
      const stroke = this.strokeIndex.get(id);
      const pageId = this.strokeIndex.pageOf(id);
      const box = this.pageLayout.boxes.find((b) => b.id === pageId);
      if (!stroke || !box) continue;
      add(box.index, strokeBounds(stroke));
      for (const mirror of this.eraseMirrorsOf(box.id, id)) {
        add(mirror.box.index, strokeBounds(mirror.stroke));
      }
    }
    this.eraseDirty.clear();
    for (const [index, bounds] of dirty) {
      this.renderer?.invalidateRegion(index, bounds);
      this.erasePreview.set(index, [...(this.erasePreview.get(index) ?? []), bounds]);
    }
  }

  /**
   * The eraser at `at` (page-local, `radius`) cut `stroke` on page `index`.
   * What changed is the ink there: the cut takes the line's centre within
   * the radius and half the stroke's width (`inkReach`, its widest), with
   * the ink either side of it, up to 0.8 of that with pressure, and the cut
   * ends' round caps reach as far: 1.3 widths past the circle at most, and a
   * sample beyond, where the piece's line begins again. The whole stroke is
   * put back from the document when the gesture ends, so `erasePreview`
   * gets its bounds once.
   */
  private noteCut(index: number, stroke: Stroke, at: Pt, radius: number): void {
    const reach = radius + 1.5 * inkReach(stroke) + ERASE_CUT_MARGIN;
    const area = { minX: at.x - reach, minY: at.y - reach, maxX: at.x + reach, maxY: at.y + reach };
    this.eraseCuts.set(index, [...(this.eraseCuts.get(index) ?? []), area]);
    if (this.eraseCutSeen.has(stroke.id)) return;
    this.eraseCutSeen.add(stroke.id);
    const bounds = strokeBounds(stroke);
    if (bounds) this.erasePreview.set(index, [...(this.erasePreview.get(index) ?? []), bounds]);
  }

  /** The mirrors of stroke `id` of page `pageId`, for the erase preview; none apart. */
  private eraseMirrorsOf(pageId: string, id: string): Array<{ box: PageBox; stroke: Stroke }> {
    if (!this.joined) return [];
    if (!this.eraseMirrors) {
      const found = new Map<string, Array<{ box: PageBox; stroke: Stroke }>>();
      for (const box of this.pageLayout.boxes) {
        for (const stroke of this.pageAt(box.index)?.strokes ?? []) {
          if (!stroke.join) continue;
          const list = found.get(stroke.join) ?? [];
          list.push({ box, stroke });
          found.set(stroke.join, list);
        }
      }
      this.eraseMirrors = found;
    }
    return this.eraseMirrors.get(ownerKey(pageId, id)) ?? [];
  }

  /**
   * The erase preview on mirrors: `hidden` and `pieces` (by owner id) with
   * each owner's mirrors hidden too, and drawn as the owner's pieces moved
   * into the mirror's page.
   */
  private mirrorErasePreview(
    hidden: ReadonlySet<string>,
    pieces: ReadonlyMap<string, readonly Stroke[]>,
  ): { hidden: Set<string>; pieces: Map<string, readonly Stroke[]> } {
    const outHidden = new Set(hidden);
    const outPieces = new Map(pieces);
    const ownerBox = (id: string): PageBox | undefined => {
      const pageId = this.strokeIndex.pageOf(id);
      return this.pageLayout.boxes.find((b) => b.id === pageId);
    };
    for (const id of hidden) {
      const box = ownerBox(id);
      if (!box) continue;
      for (const mirror of this.eraseMirrorsOf(box.id, id)) outHidden.add(mirror.stroke.id);
    }
    for (const [id, survivors] of pieces) {
      const box = ownerBox(id);
      if (!box) continue;
      for (const mirror of this.eraseMirrorsOf(box.id, id)) {
        const moved = survivors.map((piece) => ({
          ...piece,
          id: `${piece.id}@${mirror.box.id}`,
          pts: movePagePts(piece.pts, box, mirror.box),
        }));
        outPieces.set(mirror.stroke.id, moved);
        // A stretch greyed on the owner is greyed on its mirror too.
        for (const [i, piece] of survivors.entries()) {
          if (hidden.has(piece.id)) outHidden.add(moved[i].id);
        }
      }
    }
    return { hidden: outHidden, pieces: outPieces };
  }

  /**
   * The backdrop painter. Injected by the host, because resolving a PDF backdrop
   * needs the vault and Obsidian's `loadPdfJs()` — neither of which the surface
   * should know about. Until one is set, pages paint as bare paper.
   */
  setBackdropPainter(painter: BackdropPainter | null): void {
    this.backdropPainter = painter;
    this.renderer?.setPainter(painter);
    this.requestFrame();
  }

  /**
   * Paint the page in view's paper and lines, without its ink, into
   * `canvas` (`width` by `height` CSS px) at the zoom now, centred on the
   * middle of what shows of the page: the paper under the width and eraser
   * size previews, so a size reads against the page's own lines. False when
   * no page shows.
   */
  paintPaperSample(canvas: HTMLCanvasElement, width: number, height: number): boolean {
    const page = this.doc.pages[this.pageIndex];
    const seen = this.visibleRegion(this.pageIndex);
    if (!page || !seen || !(width > 0) || !(height > 0)) return false;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    const scale = this.unitScale;
    const s = scale * dpr;
    const cx = (seen.minX + seen.maxX) / 2;
    const cy = (seen.minY + seen.maxY) / 2;
    // Off the page's edge the desk shows, as it does around the page.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.renderer?.desk ?? this.paper.desk;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(s, 0, 0, s, canvas.width / 2 - cx * s, canvas.height / 2 - cy * s);
    const region = {
      minX: Math.max(0, cx - width / 2 / scale),
      minY: Math.max(0, cy - height / 2 / scale),
      maxX: Math.min(page.geometry.width, cx + width / 2 / scale),
      maxY: Math.min(page.geometry.height, cy + height / 2 / scale),
    };
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, page.geometry.width, page.geometry.height);
    ctx.clip();
    ctx.fillStyle = paperColorOf(page, this.paper);
    ctx.fillRect(0, 0, page.geometry.width, page.geometry.height);
    this.backdropPainter?.paint(ctx, page.backdrop, page.geometry, 1, {
      deviceScale: s,
      region,
      paper: this.paper,
    });
    ctx.restore();
    return true;
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
    this.imagePainter = painter;
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
      // Only the PDF changed: painted again in place, a few tiles a frame,
      // and no ink reaches further for it.
      if (area?.region) renderer.invalidateBackdrop(index, area.region);
      else renderer.refreshPage(index);
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
   * previews in the width and eraser popovers. Both belong to the page and
   * grow with the zoom (`eraserSize`), so a mark shows what it covers.
   */
  sizePreviewScales(): { pen: number; eraser: number } {
    return { pen: this.unitScale, eraser: this.unitScale };
  }

  /**
   * How the stroke being drawn looks, and so what it is stored as: only the
   * highlighter lays down highlighter ink; every other tool that draws
   * (the pen, the Shape tool) lays down pen ink.
   */
  private currentStyle(): StrokeStyle {
    const tool: Tool = this.toolState.tool === "highlighter" ? "highlighter" : "pen";
    const { pressureEnabled } = this.toolState;
    // A calligraphy pen's flat nib, for the pen only (never a shape or the highlighter).
    const nib = this.toolState.tool === "pen" ? penTypeFor(this.toolState).nib : undefined;
    // The highlighter's flat chisel tip, when it is the one chosen.
    const tip =
      this.toolState.tool === "highlighter" && this.callbacks.highlighterTip?.() === "chisel"
        ? "chisel"
        : undefined;
    return {
      color: this.strokeColor(),
      size: this.strokeSize(),
      tool,
      usePressure: pressureEnabled,
      ...(nib !== undefined ? { nib } : {}),
      ...(tip !== undefined ? { tip } : {}),
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
    this.requestZoomPaint();
  }

  /** Settings for a new stroke's sampling, from the pen as it is now. */
  private builderOpts(): StrokeBuilderOptions {
    // A pen whose positions arrive as whole screen px (WebKit before iPadOS
    // 26.2) is smoothed; one that reports fractions is kept exact.
    const rounded = this.penController?.strokeRounded ?? false;
    const smoothing: Smoothing = rounded ? "centred" : "off";
    // The pen in hand's stroke stabilization, on screen like the spacing.
    // Not for the Shape tool, whose strokes become clean shapes, nor for a
    // practice file's training data.
    const { tool } = this.toolState;
    const pen = (tool === "pen" || tool === "highlighter") && this.practice === null;
    const percent = pen
      ? stabilizationOf(this.toolState.penStabilization, penTypeFor(this.toolState).id)
      : 0;
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
      stabilize: this.atFitZoom(stabilizationReach(percent / 100)),
      // A practice file is training data: keep the pen's samples as they came.
      record: this.practice !== null,
      tilt: this.keepsTilt(),
    };
  }

  /**
   * Whether the stroke about to start keeps the Pencil's tilt: the Brush pen
   * with "Pencil tilt" on, outside practice files. Other pens draw the same
   * at any angle (a ball, a nib) or are translucent and kept to one width
   * (the highlighter).
   */
  private keepsTilt(): boolean {
    return (
      this.toolState.tool === "pen" &&
      penTypeFor(this.toolState).id === "brush" &&
      this.practice === null &&
      this.callbacks.pencilTilt?.() === true
    );
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

  /**
   * A pen or mouse went down on the page. Extracted from the pointer
   * controller so the Zoom box's own canvas can feed it points mapped from
   * its magnified view: every tool then behaves the same in both views.
   */
  private penStart(sample: PointerSample, press: PressInput): void {
    this.pressing = true;
    this.callbacks.onPen?.(true);
    this.pressTool = this.pressOverrideOf(press);
    if (this.pressTool === "zoom" || (this.pressTool === null && this.toolState.tool === "zoom")) {
      if (this.startZoomMarquee(sample)) return;
      this.startZoomDrag(sample, this.pressTool === null);
      return;
    }
    this.markDrawing(true);
    this.penDown(sample);
  }

  private penMove(coalesced: PointerSample[]): void {
    this.penAt = coalesced[coalesced.length - 1] ?? this.penAt;
    if (this.zoomMarquee) {
      this.moveZoomMarquee(this.penAt);
      return;
    }
    if (this.zoomDrag) {
      this.moveZoomDrag(this.penAt);
      return;
    }
    const box = this.activePage;
    if (box) this.gestureOf(this.gestureTool()).move(box, coalesced);
  }

  private penEnd(sample: PointerSample): void {
    try {
      this.penLifted(sample);
    } finally {
      this.pressEnded();
    }
  }

  /** The pen's lift, on the page or in the Zoom box: what the press was for ends. */
  private penLifted(sample: PointerSample): void {
    this.callbacks.onPen?.(false);
    this.markDrawing(false);
    if (this.endZoomMarquee(sample)) return;
    if (this.endZoomDrag(sample)) return;
    if (this.finishCellTap(sample)) return;
    if (this.finishTextDismiss()) return;
    const box = this.activePage;
    this.finishToolGesture(box, sample);
  }

  private penCancel(): void {
    try {
      this.penCancelled();
    } finally {
      this.pressEnded();
    }
  }

  private penCancelled(): void {
    this.callbacks.onPen?.(false);
    this.markDrawing(false);
    if (this.cancelZoomMarquee()) return;
    if (this.endZoomDrag()) return;
    if (this.finishCellTap(null)) return;
    if (this.finishTextDismiss()) return;
    this.finishToolGesture(this.activePage, null);
  }

  private readonly pointerCallbacks: PointerControllerCallbacks = {
    onStylusClick: (clientX, clientY) => this.stylusClicked(clientX, clientY),
    onStart: (sample, press) => {
      this.strokeInBox = false;
      this.penStart(sample, press);
    },
    onMove: (coalesced) => this.penMove(coalesced),
    onEnd: (sample) => this.penEnd(sample),
    onCancel: () => this.penCancel(),
    // Fingers. Native touch-scroll is off (touch-action: none), so the
    // scroller gets the raw gesture and the frame loop moves the page.
    onPanStart: (x, y, t) => {
      this.dropEmptyLasso();
      // A finger beside one dragging the selection by its frame: the two turn it.
      if (this.joinFrameFingers(x, y, t)) return;
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
        // A pen moving the page (space, the hand tool, a barrel set to pan)
        // is no finger tap: lifting it must not undo, open a link or double-tap.
        this.fingerTap =
          this.penPanning || this.scroller.isAnimating || this.handHeld ? null : { x, y, t };
        if (this.fingerTap && !this.lasso) {
          this.fingerHold.begin(x, y, t);
          this.startPress(() => this.fingerHeld(), FINGER_HOLD_MS);
        }
      }
      if (!this.touchPanning) {
        this.swipeFromPage = this.pageIndex;
        const at = this.scroller.position;
        this.palmUndo = { t: now(), x: at.x, y: at.y, zoom: this.userZoom, cx: x, cy: y };
        this.fingerGesture = {
          x: at.x,
          y: at.y,
          zoom: this.userZoom,
          cx: x,
          cy: y,
          cancelled: false,
        };
        this.pullGesture = { fromX: x, fromY: y, x, y, pinched: false };
      }
      this.touchPanning = true;
      window.clearTimeout(this.wheelSnapTimer);
      this.releaseBoardHold();
      this.scroller.dragStart(x, y, t);
      this.requestFrame();
    },
    onPanMove: (x, y, t) => {
      if (this.pageFingerOnFrame) {
        this.selectionFingers.move(PAGE_FINGER_ID, x, y, t);
        return;
      }
      const tap = this.fingerTap;
      if (tap && Math.hypot(x - tap.x, y - tap.y) > TAP_SLOP_PX) {
        this.fingerTap = null;
        this.stopPress();
      }
      if (this.fingerHold.active && !this.fingerHold.move(x, y)) this.stopPress();
      if (this.pullGesture) {
        this.pullGesture.x = x;
        this.pullGesture.y = y;
      }
      this.scroller.dragMove(x, y, t);
      this.requestFrame();
    },
    onPanEnd: (t) => {
      if (this.pageFingerOnFrame) {
        this.pageFingerOnFrame = false;
        this.selectionFingers.lift(PAGE_FINGER_ID, t);
        return;
      }
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
      // letting go adds a page. Zoomed in too, as in Goodnotes: a row is no
      // longer held to one page, so its end is the last page's edge.
      const pulled =
        this.pullAddEnabled && this.pullAllowed() && this.pullProgress(this.pullOverscroll()) >= 1;
      // Zoomed in, held to its page: pulled well past an edge, letting go
      // turns to the page beside it (Goodnotes). Never a pinch.
      const bounds = this.scroller.bounds;
      const edgeTurn =
        this.heldRow && !pulled && this.pullGesture?.pinched === false
          ? rowEdgeTurn(this.scroller.position.x, bounds.minX, bounds.maxX)
          : 0;
      this.pullGesture = null;
      this.touchPanning = false;
      this.penPanning = false;
      this.palmUndo = null;
      this.scrollEl.removeClass("is-hand-dragging");
      this.pullAdd.hide();
      this.scroller.dragEnd(t);
      const gesture = this.fingerGesture;
      this.fingerGesture = null;
      if (gesture?.cancelled) {
        // The system took the gesture (an app switch, Control Center, the
        // swipe home): what the fingers did on the way was never meant for
        // the page, so it goes back to where it was, zoom and all, with no
        // fling and no page turn. A finger WebKit's long press cancelled was
        // held still, so for it this changes nothing.
        this.restoreFingerGesture(gesture);
        return;
      }
      if (pulled) {
        this.callbacks.onPullAddPage?.();
      } else if (this.snapRowAfterZoom && this.zoomAnim) {
        // The last finger of a pinch: the page centres as the zoom springs back.
        this.snapRowAfterZoom = false;
        this.startRowSettle();
      } else if (this.rowSettle) {
        // Already settling on its page.
      } else if (this.turnsPages) {
        this.snapToPage(this.scroller.velocity.x, this.swipeFromPage);
      } else if (edgeTurn !== 0) {
        this.turnHeldPage(edgeTurn);
      }
      this.requestFrame();
      if (tap && t - tap.t <= FINGER_TAP_MS) this.onFingerTap(tap.x, tap.y);
    },
    // Only a landing pen voids a finger gesture.
    onPanCancel: () => {
      // A turn of the selection is kept as far as it went, as a cancelled drag is.
      if (this.pageFingerOnFrame) {
        this.pageFingerOnFrame = false;
        this.selectionFingers.lift(PAGE_FINGER_ID, now());
      }
      if (this.groupDrag?.fingers?.page) this.endGroupTurn();
      this.fingerTap = null;
      this.fingerGesture = null;
      this.pullGesture = null;
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
    onPinchStart: (centerX, centerY, spread) => {
      // A pinch is never a pull: the ring goes, and stays gone for this gesture.
      if (this.pullGesture) this.pullGesture.pinched = true;
      this.pullAdd.hide();
      this.fingerTap = null;
      this.stopPress();
      this.fingerHold.end();
      if (this.imageDrag || this.groupDrag) return;
      // Two fingers meeting over the selection turn it, not the page.
      if (this.startGroupTurn(centerX, centerY, spread, true)) {
        this.scroller.cancel();
        return;
      }
      this.zoomAnim = null;
      this.rowSettle = null;
      this.pinch = { raw: this.userZoom, centerX, centerY };
    },
    onPinch: (info) => {
      if (this.groupDrag?.fingers?.page) {
        this.stepGroupTurn(info);
        return;
      }
      const pinch = this.pinch;
      if (!pinch) return;
      pinch.raw *= info.scaleFactor;
      pinch.centerX = info.centerX;
      pinch.centerY = info.centerY;
      // Past the limits the zoom stretches a little; the release springs it back.
      this.applyZoom(softZoom(pinch.raw, this.minZoom, MAX_SCALE), info.centerX, info.centerY);
    },
    onPinchEnd: () => {
      if (this.groupDrag?.fingers?.page) {
        this.endGroupTurn();
        return;
      }
      const pinch = this.pinch;
      const overview = this.pinchOverviewArmed;
      this.pinch = null;
      if (!pinch) return;
      if (overview) {
        this.openOverviewFromPinch();
        return;
      }
      this.settleHeldPage();
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
      }
      // No finger left: the page centres as the zoom springs back. With one
      // still down, its release does that (`onPanEnd`).
      if (this.snapRowAfterZoom && !this.scroller.isDragging) {
        this.snapRowAfterZoom = false;
        this.startRowSettle();
      } else if (!this.zoomAnim) {
        // Nothing to spring back: the release snaps to a page as a swipe does.
        this.snapRowAfterZoom = false;
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
      if (this.fingerGesture) this.fingerGesture.cancelled = true;
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
    // A step names itself in the readout (`stepHistory`).
    if (!can) this.flashReadout(redo ? "Nothing to redo" : "Nothing to undo");
    else if (redo) this.redo();
    else this.undo();
  }

  /** Show a word in the readout pill for `holdMs`, faded on the zoom readout's clock. */
  private flashReadout(text: string, holdMs = READOUT_WORD_HOLD_MS): void {
    this.zoomReadoutEl.removeClass("is-overview");
    this.zoomReadoutEl.setText(text);
    this.zoomReadoutEl.removeClass("is-idle");
    this.chromeUntil.zoom = now() + holdMs;
    if (!this.chromeTimer) this.chromeTimer = window.setTimeout(this.fadeChrome, holdMs);
  }

  /** Put the page back where a finger gesture the system took found it (`fingerGesture`). */
  private restoreFingerGesture(start: {
    x: number;
    y: number;
    zoom: number;
    cx: number;
    cy: number;
  }): void {
    this.zoomAnim = null;
    this.rowSettle = null;
    if (this.userZoom !== start.zoom) this.applyZoom(start.zoom, start.cx, start.cy);
    this.scroller.setPosition(start.x, start.y);
    this.syncViewport();
    this.requestFrame();
    if (this.debug) this.hud.mark("system:undo");
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
    this.rowSettle = null;
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
    this.dropEmptyLasso();
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

    if (this.cellEdit) {
      // With the Text tool a tap in another cell types there, and a tap
      // beside the table stops typing: decided on lift. Writing ends it.
      if (this.gestureTool() === "text") {
        this.cellTap = true;
        return;
      }
      // With the lasso (how "Edit table" is reached), a press in the table
      // being typed in moves to the cell it lifts in; beside it, lassoing
      // goes on as ever.
      const page = this.pageAt(box.index);
      const edited = this.cellEdit.table;
      if (
        this.gestureTool() === "select" &&
        page?.id === this.cellEdit.pageId &&
        cellAt(this.tableLayout(edited), local.x, local.y)
      ) {
        this.cellTap = true;
        return;
      }
      this.endCellEdit(true);
    }
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
    this.callbacks.onGestureStart?.(this.gestureTool(), this.pressTool !== null);
    this.gestureOf(this.gestureTool()).down(box, local, sample);
  }

  /** The pen or mouse lifted (`sample`), or its press was cancelled (null). */
  /** Complete the tool before switching; cancelled erasing is rolled back. */
  private finishToolGesture(box: PageBox | null, sample: PointerSample | null): void {
    const tool = this.gestureTool();
    // A tool a key or a stylus button lent is done with; the tool in hand was
    // not used. A held key's tool goes back on its key-up, not after one use.
    const lent = Boolean(this.pressTool) || Boolean(this.heldShortcut);
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
    return lent === "eraser" || lent === "select" ? lent : this.toolState.tool;
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
    if (this.stickyPlace && this.placeStickyAt(event.clientX, event.clientY)) return "ignore";
    if (this.editingTextView() || this.heldText || this.cellEdit) return "draw";
    if (this.pressOpensFoldedNote(event)) return "ignore";
    // The hand held by a shortcut moves the page wherever the pen lands.
    if (this.heldShortcut?.tool === "pan") {
      this.penPanning = true;
      return "pan";
    }
    const at = this.toLayout(event.clientX, event.clientY);
    const onPage = boxAtPoint(this.pageLayout, at.x, at.y) !== null;
    const press = this.withoutBoundButton(event);
    const route = pressOverride(press, { mac: macKeys(), barrel: this.barrel(), onPage });
    if (route === "ignore") return "ignore";
    // The hand tool moves the page wherever the pointer lands, as space does,
    // but it stays chosen until another tool is picked. A lent tool (the
    // eraser, the lasso, Alt's zoom) still wins for that press.
    if (route === "pan" || (route === null && this.toolState.tool === "pan")) {
      this.penPanning = true;
      return "pan";
    }
    return "draw";
  }

  /**
   * Whether a pen or mouse press may follow the ruler's edge: with the pen
   * or the highlighter, and no key or stylus button lending the press to
   * another tool. A practice file's strokes are handwriting samples: never.
   */
  private rulerGuides(event: PointerEvent): boolean {
    const { tool } = this.toolState;
    if (tool !== "pen" && tool !== "highlighter") return false;
    return this.practice === null && this.pressOverrideOf(event) === null;
  }

  /**
   * A sticky note waits to be placed: the next tap on a page, by pen, mouse
   * or finger, calls `place` with the page and the page-local point, and
   * draws nothing. Null stops it waiting.
   */
  armStickyNote(place: ((index: number, at: Pt) => void) | null): void {
    this.stickyPlace = place;
  }

  /** Whether a sticky note waits to be placed (`armStickyNote`). */
  get stickyArmed(): boolean {
    return this.stickyPlace !== null;
  }

  /** Place the waiting sticky note at a client point, if it is on a page. */
  private placeStickyAt(clientX: number, clientY: number): boolean {
    const place = this.stickyPlace;
    const at = this.toLayout(clientX, clientY);
    const box = boxAtPoint(this.pageLayout, at.x, at.y);
    if (!place || !box) return false;
    this.stickyPlace = null;
    place(box.index, this.toPage(box, at));
    return true;
  }

  /** Whether the ruler is out. */
  get rulerOut(): boolean {
    return this.ruler?.isOut ?? false;
  }

  /**
   * Bring the ruler out (level, in the middle of the pane) or put it away,
   * as `toolState.rulerKind` and `rulerSnap` say; out already, it takes on
   * a new kind or snapping where it lies.
   */
  setRulerOut(out: boolean): void {
    const ruler = this.ruler;
    if (!ruler) return;
    const snap = this.toolState.rulerSnap ?? DEFAULT_RULER_SNAP;
    ruler.setScale(this.scale);
    ruler.setSnap(snap);
    ruler.setOut(out, this.toolState.rulerKind ?? "straight", snap);
  }

  /** The tool a stroke's keys and buttons lend it, or null for the tool in hand. */
  private pressOverrideOf(press: PressInput): LentTool | null {
    // Typing keeps its keys: Shift is a capital there, not an eraser.
    if (this.editingTextView() || this.cellEdit) return null;
    const lent = pressOverride(this.withoutBoundButton(press), {
      mac: macKeys(),
      barrel: this.barrel(),
      onPage: true,
    });
    // A practice file has the pen and the eraser only.
    if (this.practice && lent === "select") return null;
    return lent === "eraser" || lent === "select" || lent === "zoom" ? lent : null;
  }

  private barrel(): BarrelAction {
    return barrelActionOf(this.callbacks.barrelAction?.());
  }

  /**
   * Whether a click of the barrel button in the air does anything here: the
   * setting asks for one, and no text is being typed (a press there is the
   * text box's, as it always was).
   */
  private stylusClickWanted(): boolean {
    const bound = this.sideButtonBound();
    if (!this.callbacks.onStylusClick && !bound) return false;
    if (!bound && stylusClickActionOf(this.callbacks.stylusClick?.()) === "none") return false;
    return !this.editingTextView() && !this.heldText && !this.cellEdit;
  }

  /**
   * A pen's press, move or lift anywhere in the view. Those on the page reach
   * the pointer input already; the rest (the tool bar, an open popover) are
   * passed on, so the side button's click is heard there too, and a pen
   * pressed there is not taken for it.
   */
  penInView(event: PointerEvent): void {
    if (event.target instanceof Node && this.scrollEl.contains(event.target)) return;
    this.pointerInput?.penElsewhere(event);
  }

  /** The barrel button clicked in the air (`stylus-click.ts`): the host's pen menu. */
  private stylusClicked(clientX: number, clientY: number): void {
    // A tablet driver may send the click as a right-click too (FineNotes#25).
    this.stylusMenuUntil = now() + STYLUS_MENU_MS;
    // A side button the table binds: a press-mode row runs once (not again
    // if its press already ran it); a held tool has nothing to hold in the air.
    const table = this.callbacks.shortcuts?.();
    const match = table ? matchShortcut(table, SIDE_BUTTON) : null;
    if (match) {
      if (now() < this.buttonShortcutUntil) return;
      if (match.kind === "action" && !(match.row.mode === "hold" && match.row.action.holdable)) {
        this.runShortcut(match.row);
      }
      return;
    }
    this.callbacks.onStylusClick?.(clientX, clientY);
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

  /** Alt held as the pen came down, or the magnifier: drawing up zooms in, down out, about that point. */
  private startZoomDrag(sample: Pt, tapZoom = false): void {
    const at = this.toClient(sample);
    this.zoomAnim = null;
    this.rowSettle = null;
    this.zoomDrag = { from: this.userZoom, x: at.x, y: at.y, moved: false, tapZoom };
  }

  private moveZoomDrag(sample: Pt): void {
    const drag = this.zoomDrag;
    if (!drag) return;
    // The sample was mapped with the view as it is now, so this is where the pen is.
    const at = this.toClient(sample);
    if (Math.hypot(at.x - drag.x, at.y - drag.y) > TAP_SLOP_PX) drag.moved = true;
    if (!drag.moved) return;
    const zoom = dragZoom(drag.from, at.y - drag.y, this.minZoom, MAX_SCALE);
    if (zoom !== this.userZoom) this.applyZoom(zoom, drag.x, drag.y);
  }

  /**
   * The zoom drag ended; true if there was one. A row zoomed back out settles
   * on its page. A tap with the magnifier, which moved nowhere, is one zoom
   * step in at the tap.
   */
  private endZoomDrag(sample: Pt | null = null): boolean {
    const drag = this.zoomDrag;
    if (!drag) return false;
    this.zoomDrag = null;
    this.pressTool = null;
    if (sample && drag.tapZoom && !drag.moved) {
      const at = this.toClient(sample);
      this.applyZoom(this.clampZoom(this.userZoom * ZOOM_STEP), at.x, at.y);
    }
    this.snapRowAfterZoom =
      this.direction === "horizontal" && rowTurnsPages(this.userZoom, this.minZoom);
    this.settleRowAfterZoom();
    this.requestFrame();
    return true;
  }

  // --- The Magnifier's Zoom box ------------------------------------------------

  /**
   * The Magnifier's mode switch, from the toolbar: with `on`, the first drag
   * on a page draws a target box; with `off`, the target and window go. A
   * Zoom box already open stays open when another tool is picked.
   */
  setZoomBox(on: boolean): void {
    this.toolState.zoomBox = on;
    // Zoom box mode opens a box where the page is being read: nothing to draw first.
    if (on && !this.zoomBox && this.openPlacedZoomBox()) return;
    if (!on) {
      if (this.zoomBox) this.closeZoomBox(false);
      else this.cancelZoomMarquee();
      this.syncZoomTargetInteractive();
      this.syncZoomCatcher();
      this.requestFrame();
      return;
    }
    this.syncZoomTargetInteractive();
    this.syncZoomCatcher();
    this.syncZoomTarget();
  }

  /** With the Magnifier in hand an unselected frame hints that a tap selects it. */
  private syncZoomTargetInteractive(): void {
    this.zoomTargetEl?.toggleClass("is-interactive", this.toolState.tool === "zoom");
  }

  /**
   * The first-drag catcher shows only with the magnifier, no target yet and
   * Stylus-only mode on (`zoomCatcherWanted`). Without it the pen and a mouse
   * draw the target through the page's own input (`penStart`), and a finger
   * still pans and pinches the page while the box waits.
   */
  private syncZoomCatcher(): void {
    const armed =
      this.toolState.zoomBox === true && this.zoomBox === null && this.toolState.tool === "zoom";
    const wanted = zoomCatcherWanted(armed, this.callbacks.onlyStylusMode?.() === true);
    if (!wanted && this.zoomMarqueePointer !== null) this.cancelZoomMarquee();
    this.zoomCatcherEl?.toggleClass("is-hidden", !wanted);
  }

  /** Stylus-only mode was switched: the Zoom box's catcher follows it. */
  onlyStylusChanged(): void {
    this.syncZoomCatcher();
  }

  /** The first Magnifier drag draws the target; true when it took the press. */
  private startZoomMarquee(sample: Pt): boolean {
    if (this.toolState.zoomBox !== true || this.zoomBox) return false;
    const pageBox = boxAtPoint(this.pageLayout, sample.x, sample.y);
    if (!pageBox) return false;
    const at = this.toPage(pageBox, sample);
    this.zoomMarquee = { pageId: pageBox.id, from: at, to: { ...at } };
    this.syncZoomMarquee();
    return true;
  }

  private moveZoomMarquee(sample: Pt): void {
    const marquee = this.zoomMarquee;
    if (!marquee) return;
    const pageBox = this.boxForPage(marquee.pageId);
    if (!pageBox) return;
    const at = this.toPage(pageBox, sample);
    marquee.to = {
      x: Math.max(0, Math.min(pageBox.width, at.x)),
      y: Math.max(0, Math.min(pageBox.height, at.y)),
    };
    this.syncZoomMarquee();
    this.requestFrame();
  }

  /** The first drag lifted: a big enough box opens the window; true when it was ours. */
  private endZoomMarquee(sample: Pt | null): boolean {
    const marquee = this.zoomMarquee;
    if (!marquee) return false;
    this.zoomMarquee = null;
    this.resetZoomMarqueePointer();
    this.zoomMarqueeEl?.addClass("is-hidden");
    const pageBox = this.boxForPage(marquee.pageId);
    if (!pageBox) {
      this.requestFrame();
      return true;
    }
    if (sample) {
      const at = this.toPage(pageBox, sample);
      marquee.to = {
        x: Math.max(0, Math.min(pageBox.width, at.x)),
        y: Math.max(0, Math.min(pageBox.height, at.y)),
      };
    }
    const box = zoomBoxFromPoints(marquee.from, marquee.to, pageBox.width, pageBox.height);
    if (box) this.openZoomBox(marquee.pageId, box);
    else this.syncZoomCatcher();
    this.requestFrame();
    return true;
  }

  private cancelZoomMarquee(): boolean {
    if (!this.zoomMarquee) return false;
    this.zoomMarquee = null;
    this.resetZoomMarqueePointer();
    this.zoomMarqueeEl?.addClass("is-hidden");
    this.syncZoomCatcher();
    this.requestFrame();
    return true;
  }

  /** Let go of the first-drag pointer even if the mode closes under it. */
  private resetZoomMarqueePointer(): void {
    const pointerId = this.zoomMarqueePointer;
    this.zoomMarqueePointer = null;
    if (pointerId === null) return;
    try {
      this.zoomCatcherEl?.releasePointerCapture(pointerId);
    } catch {
      // It was already released.
    }
  }

  private syncZoomMarquee(): void {
    const marquee = this.zoomMarquee;
    const el = this.zoomMarqueeEl;
    const pageBox = marquee ? this.boxForPage(marquee.pageId) : null;
    if (!marquee || !el || !pageBox) {
      el?.addClass("is-hidden");
      return;
    }
    const scale = this.unitScale;
    const x = Math.min(marquee.from.x, marquee.to.x);
    const y = Math.min(marquee.from.y, marquee.to.y);
    const w = Math.abs(marquee.to.x - marquee.from.x);
    const h = Math.abs(marquee.to.y - marquee.from.y);
    el.setCssStyles({
      left: `${(pageBox.x + x) * scale}px`,
      top: `${(pageBox.y + y) * scale}px`,
      width: `${w * scale}px`,
      height: `${h * scale}px`,
    });
    el.removeClass("is-hidden");
  }

  /**
   * One tap on the Magnifier in Zoom box mode (`magnifierTap`), or the mode
   * switched on: the box opens on the page being read, placed and sized for
   * writing (`placedZoomBox`), so the Pencil writes on at once, as in
   * Goodnotes. The target can still be moved and resized by its frame.
   * False when there is no page in view to put it on.
   */
  openPlacedZoomBox(): boolean {
    if (this.zoomBox) return true;
    const index = Math.max(0, Math.min(this.pageIndex, this.pageLayout.boxes.length - 1));
    const pageBox = this.pageLayout.boxes[index];
    if (!pageBox) return false;
    const view = this.visibleBoardRect();
    const seen = {
      minX: Math.max(0, view.minX - pageBox.x),
      minY: Math.max(0, view.minY - pageBox.y),
      maxX: Math.min(pageBox.width, view.maxX - pageBox.x),
      maxY: Math.min(pageBox.height, view.maxY - pageBox.y),
    };
    // A row turned to another page may not read as in view: the whole page then.
    const visible =
      seen.maxX > seen.minX && seen.maxY > seen.minY
        ? seen
        : { minX: 0, minY: 0, maxX: pageBox.width, maxY: pageBox.height };
    const place = this.zoomPlace ?? zoomWindowFirstPlace({ w: this.cssW, h: this.cssH });
    const box = placedZoomBox(
      visible,
      { width: pageBox.width, height: pageBox.height },
      place.w,
      Math.max(1, place.h - ZOOM_WINDOW_BAR_PX),
      this.unitScale,
    );
    if (!box) return false;
    this.cancelZoomMarquee();
    this.openZoomBox(pageBox.id, box);
    return true;
  }

  /** A target box was drawn: put it on the page and open the window over the view. */
  private openZoomBox(pageId: string, box: ZoomRect): void {
    this.zoomPositionHistory.length = 0;
    this.zoomBox = { pageId, box, originX: box.x };
    this.zoomMarquee = null;
    this.zoomMarqueeEl?.addClass("is-hidden");
    this.toolState.zoomBox = true;
    if (!this.zoomFrame) this.createZoomFrame();
    this.syncZoomTargetInteractive();
    this.syncZoomCatcher();
    this.syncZoomTarget();
    this.ensureZoomTargetVisible();
    this.callbacks.onZoomBoxChange?.(true);
    this.requestFrame();
  }

  /** The target and its window go; the toolbar's switch follows unless it asked. */
  closeZoomBox(notify: boolean): void {
    if (this.zoomStroke) {
      this.penCancel();
      this.endZoomStroke();
    }
    this.zoomInput?.detach();
    this.zoomInput = null;
    this.zoomBox = null;
    this.zoomPan = null;
    this.zoomPinch = null;
    this.zoomTouches.clear();
    this.zoomPositionHistory.length = 0;
    this.zoomMarquee = null;
    this.zoomTargetDrag = null;
    this.cancelZoomAdvance();
    this.cancelZoomSlide();
    this.zoomAutoAdvanceButton = null;
    this.resetZoomMarqueePointer();
    this.zoomMarqueeEl?.addClass("is-hidden");
    this.zoomTargetEl?.addClass("is-hidden");
    this.zoomResize?.disconnect();
    this.zoomResize = null;
    if (this.zoomPaintFrame) window.cancelAnimationFrame(this.zoomPaintFrame);
    this.zoomPaintFrame = 0;
    this.zoomFrame?.destroy();
    this.zoomFrame = null;
    this.zoomCanvas = null;
    this.zoomReadout = null;
    this.zoomReadoutText = "";
    // The mode stays: the next tap on the Magnifier opens a box again.
    this.syncZoomCatcher();
    if (notify) this.callbacks.onZoomBoxChange?.(false);
    this.requestFrame();
  }

  /** The floating window: navigation and zoom on its bar, the live page in its body. */
  private createZoomFrame(): void {
    const frame = new FloatingWindow({
      container: this.surfaceEl,
      cls: "goodobsidian-zoombox-window",
      title: "Zoom box",
      label: "Zoom box",
      closeLabel: "Close zoom box",
      min: { w: 304, h: 160 },
      // A palm resting inside the window while the Pencil writes must not
      // drag or resize it; the bar's buttons stay tappable.
      allowDrag: (event, part) =>
        zoomWindowDragAllowed(
          event.pointerType,
          this.callbacks.onlyStylusMode?.() === true,
          part,
          this.zoomStroke,
        ),
      buttons: [
        { icon: "arrow-left", label: "Previous position", run: () => this.previousZoomBox() },
        { icon: "arrow-right", label: "Advance", run: () => this.advanceZoomBox() },
        { icon: "corner-down-left", label: "New line", run: () => this.newZoomBoxLine() },
        {
          icon: "chevrons-right",
          label: "Auto-advance",
          run: () => this.setZoomAutoAdvance(!this.zoomAutoAdvanceOn()),
        },
        { icon: "minus", label: "Zoom out", run: () => this.scaleZoomWindow(1 / ZOOM_STEP) },
        { icon: "plus", label: "Zoom in", run: () => this.scaleZoomWindow(ZOOM_STEP) },
      ],
      // Open at the bottom, above the options pill, and centred.
      firstPlace: (bounds) => zoomWindowFirstPlace(bounds),
      place: () => this.zoomPlace,
      savePlace: (place) => {
        this.zoomPlace = place;
        // A resize changes the scale the readout names; ask for a paint.
        this.requestFrame();
      },
      onClose: () => this.closeZoomBox(true),
    });
    this.zoomFrame = frame;
    const bar = frame.el.querySelector<HTMLElement>(".goodobsidian-zoombox-window-bar");
    if (bar) {
      // A visible grip, though the whole bar drags: the window is moved and
      // sized by hand, and this says so at a glance.
      const grip = bar.createSpan({ cls: "goodobsidian-zoombox-drag" });
      grip.setAttribute("aria-hidden", "true");
      setIcon(grip, "grip-horizontal");
      bar.insertBefore(grip, bar.firstChild);
      this.zoomReadout = bar.createSpan({ cls: "goodobsidian-zoombox-readout" });
      const plus = bar.querySelector<HTMLElement>('[aria-label="Zoom in"]');
      if (plus) bar.insertBefore(this.zoomReadout, plus);
      this.zoomAutoAdvanceButton = bar.querySelector<HTMLButtonElement>(
        '[aria-label="Auto-advance"]',
      );
      this.syncZoomAutoAdvanceButton();
    }
    const canvas = frame.body.createEl("canvas", {
      cls: "goodobsidian-zoombox-canvas",
    });
    canvas.dataset.ignoreSwipe = "true";
    this.zoomCanvas = canvas;
    // The page's own input, on the window's canvas: one Pencil path for both.
    const input = new PointerController(
      canvas,
      (clientX, clientY) => this.zoomClientToLayout(clientX, clientY),
      this.zoomPointerCallbacks,
      {
        route: (event) => this.zoomBoxRoute(event),
        onlyStylus: () => this.callbacks.onlyStylusMode?.() === true,
        stylusClicks: () => this.stylusClickWanted(),
      },
    );
    input.attach();
    this.zoomInput = input;
    canvas.addEventListener("pointerdown", (event) => this.onZoomPanDown(event));
    canvas.addEventListener("pointermove", (event) => this.onZoomPanMove(event));
    for (const type of ["pointerup", "pointercancel"] as const) {
      canvas.addEventListener(type, (event) => this.onZoomPanUp(event));
    }
    // The Pencil's touchstart and touchmove are cancelled over the whole
    // window, as on the page: otherwise iPadOS's long press ends a held pen
    // in pointercancel and Scribble swallows strokes (`input/stylus-touch`).
    // The window stops touch events from bubbling, so the page's own
    // listener never sees these.
    const onTouch = (event: TouchEvent): void => {
      if (cancelsStylusTouch(event.type, event.changedTouches)) event.preventDefault();
    };
    for (const type of ["touchstart", "touchmove"] as const) {
      frame.el.addEventListener(type, onTouch, { passive: false });
    }
    // A corner drag changes the window's size, not its place record, until the
    // pointer is lifted; follow the size so the magnified page never stretches.
    if (typeof ResizeObserver === "function") {
      this.zoomResize = new ResizeObserver(() => this.requestFrame());
      this.zoomResize.observe(canvas);
    }
  }

  /** Every frame: keep the frame over its page and draw the magnified view. */
  private paintZoomBox(): void {
    if (this.zoomPaintFrame) {
      window.cancelAnimationFrame(this.zoomPaintFrame);
      this.zoomPaintFrame = 0;
    }
    const state = this.zoomBox;
    const canvas = this.zoomCanvas;
    const renderer = this.renderer;
    const el = this.zoomTargetEl;
    if (!state) {
      if (el && !el.hasClass("is-hidden")) el.addClass("is-hidden");
      return;
    }
    const pageBox = this.boxForPage(state.pageId);
    if (!pageBox) {
      this.closeZoomBox(true);
      return;
    }
    // The settings tab may have switched auto-advance while the box was open.
    this.syncZoomAutoAdvanceButton();
    if (!canvas || !renderer) {
      this.syncZoomTarget();
      return;
    }
    // Read the canvas size before writing the target's position: a layout
    // read after a style write would flush every frame of a target drag.
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    this.syncZoomTarget();
    if (!(width > 0) || !(height > 0)) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = backingScale(window.devicePixelRatio);
    const deviceW = Math.max(1, Math.round(width * dpr));
    const deviceH = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== deviceW || canvas.height !== deviceH) {
      canvas.width = deviceW;
      canvas.height = deviceH;
    }
    const view = zoomView(state.box, width, height);
    // The renderer measures `level` in canvas pixels per page px, as a tile
    // does, so hairline rules and graph curves are one device pixel, not one
    // CSS pixel at this dpr.
    const level = view.scale * dpr;
    // Clear and fill in device pixels: a fractional CSS size at this dpr would
    // otherwise leave a sliver of the old frame at the far edge.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = zoomDeskColor(renderer.desk, this.paper.desk);
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(view.offsetX, view.offsetY, view.width, view.height);
    ctx.clip();
    ctx.setTransform(
      view.scale * dpr,
      0,
      0,
      view.scale * dpr,
      view.offsetX * dpr,
      view.offsetY * dpr,
    );
    // Page coordinates: the target's top-left is the content's top-left.
    ctx.translate(-state.box.x, -state.box.y);
    const page = this.doc.pages[pageBox.index];
    if (!page) {
      ctx.restore();
      this.closeZoomBox(true);
      return;
    }
    const region = {
      minX: state.box.x,
      minY: state.box.y,
      maxX: state.box.x + state.box.w,
      maxY: state.box.y + state.box.h,
    };
    const preview = this.erasePreviewPass();
    renderer.paintZoomView(
      ctx,
      page,
      pageBox,
      region,
      level,
      this.inkPressure,
      preview.hidden,
      preview.replaced,
      preview.greyed,
    );
    ctx.restore();
    // The stroke in flight is not in the document yet: draw it here from the
    // same paint call the wet layer used, at the box's own resolution. A copy
    // of the page's wet layer, magnified, was blurred at 4-5x and sharpened
    // on lift (ink must never change once drawn), and was empty while the
    // target was off screen. Only what the wet layer cannot draw again (a
    // dragged picture or selection) is still copied.
    ctx.save();
    ctx.beginPath();
    ctx.rect(view.offsetX, view.offsetY, view.width, view.height);
    ctx.clip();
    ctx.setTransform(
      view.scale * dpr,
      0,
      0,
      view.scale * dpr,
      view.offsetX * dpr,
      view.offsetY * dpr,
    );
    ctx.translate(-state.box.x, -state.box.y);
    const drawn = renderer.paintWetInto(ctx, pageBox, view.scale);
    ctx.restore();
    if (!drawn) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const scale = this.unitScale;
      const screen = {
        minX: this.offsetX + (pageBox.x + state.box.x) * scale,
        minY: (pageBox.y + state.box.y - this.viewport.scrollY) * scale,
        maxX: this.offsetX + (pageBox.x + state.box.x + state.box.w) * scale,
        maxY: (pageBox.y + state.box.y + state.box.h - this.viewport.scrollY) * scale,
      };
      renderer.blitWet(ctx, screen, {
        minX: view.offsetX,
        minY: view.offsetY,
        maxX: view.offsetX + view.width,
        maxY: view.offsetY + view.height,
      });
    }
    // Over the wet stroke, as the page stacks them: task boxes, pictures in
    // front of the ink, then the text boxes that are DOM above the main page.
    ctx.save();
    ctx.beginPath();
    ctx.rect(view.offsetX, view.offsetY, view.width, view.height);
    ctx.clip();
    ctx.setTransform(
      view.scale * dpr,
      0,
      0,
      view.scale * dpr,
      view.offsetX * dpr,
      view.offsetY * dpr,
    );
    ctx.translate(-state.box.x, -state.box.y);
    renderer.paintZoomForeground(
      ctx,
      page,
      region,
      level,
      this.inkPressure,
      preview.hidden,
      preview.replaced,
      preview.greyed,
    );
    ctx.restore();
    const text = `${zoomPercent(view.scale)}%`;
    if (this.zoomReadout && text !== this.zoomReadoutText) {
      this.zoomReadoutText = text;
      this.zoomReadout.setText(text);
    }
  }

  private syncZoomTarget(): void {
    const state = this.zoomBox;
    const el = this.zoomTargetEl;
    if (!el) return;
    const pageBox = state ? this.boxForPage(state.pageId) : null;
    if (!state || !pageBox) {
      if (!el.hasClass("is-hidden")) el.addClass("is-hidden");
      return;
    }
    // Always live, as Goodnotes' blue box: a press anywhere on it moves it and
    // its handles resize it (Joost, 2026-10-30).
    el.addClass("is-selected");
    const scale = this.unitScale;
    const css = [
      (pageBox.x + state.box.x) * scale,
      (pageBox.y + state.box.y) * scale,
      state.box.w * scale,
      state.box.h * scale,
    ].join("|");
    if (css !== this.zoomTargetCss) {
      this.zoomTargetCss = css;
      el.setCssStyles({
        left: `${(pageBox.x + state.box.x) * scale}px`,
        top: `${(pageBox.y + state.box.y) * scale}px`,
        width: `${state.box.w * scale}px`,
        height: `${state.box.h * scale}px`,
      });
    }
    if (el.hasClass("is-hidden")) el.removeClass("is-hidden");
  }

  /** Pan just enough that the target, with a margin, is in view. */
  private ensureZoomTargetVisible(): void {
    const state = this.zoomBox;
    const pageBox = state ? this.boxForPage(state.pageId) : null;
    if (!state || !pageBox) return;
    const scale = this.unitScale;
    const view = {
      x: -this.offsetX / scale - pageBox.x,
      y: this.viewport.scrollY - pageBox.y,
      w: this.cssW / scale,
      h: this.cssH / scale,
    };
    const pan = panToShow(state.box, view, 18 / scale);
    if (pan.x === 0 && pan.y === 0) return;
    const target = this.scroller.glideTarget ?? this.scroller.position;
    this.scroller.glideTo(
      target.x + pan.x * scale,
      target.y + pan.y * scale,
      now(),
      ZOOM_BOX_PAN_MS,
    );
    this.requestFrame();
  }

  private newZoomBoxLine(): void {
    const state = this.zoomBox;
    const pageBox = state ? this.boxForPage(state.pageId) : null;
    if (!state || !pageBox) return;
    this.cancelZoomSlide();
    const { pages, index } = this.zoomPages();
    const next = newLineAcrossPages(state.box, state.originX, pages, index, this.zoomLineStep());
    this.pushZoomPosition();
    this.placeZoomBoxOn(next);
    this.ensureZoomTargetVisible();
    this.requestFrame();
  }

  /** The user's page-px offset between Zoom box lines, clamped as the setting is. */
  private zoomLineStep(): number {
    const step = this.callbacks.zoomBoxLineStep?.() ?? 0;
    return Number.isFinite(step) ? Math.max(-50, Math.min(100, step)) : 0;
  }

  private zoomAutoAdvanceOn(): boolean {
    return this.callbacks.zoomBoxAutoAdvance?.() === true;
  }

  private zoomAutoAdvanceThreshold(): number {
    const value = this.callbacks.zoomBoxAutoAdvanceThreshold?.() ?? 33;
    return Number.isFinite(value) ? Math.max(10, Math.min(50, value)) : 33;
  }

  private setZoomAutoAdvance(on: boolean): void {
    this.callbacks.onZoomBoxAutoAdvance?.(on);
    this.syncZoomAutoAdvanceButton();
    if (!on) this.cancelZoomAdvance();
  }

  private syncZoomAutoAdvanceButton(): void {
    const button = this.zoomAutoAdvanceButton;
    if (!button) return;
    const on = this.zoomAutoAdvanceOn();
    if (button.hasClass("is-active") === on && button.getAttribute("aria-pressed") === String(on)) {
      return;
    }
    button.toggleClass("is-active", on);
    button.setAttribute("aria-pressed", String(on));
    button.setAttribute("aria-label", on ? "Auto-advance: on" : "Auto-advance: off");
  }

  /** A new stroke in the box supersedes a pending advance. */
  private cancelZoomAdvance(): void {
    if (this.zoomAdvanceTimer === null) return;
    window.clearTimeout(this.zoomAdvanceTimer);
    this.zoomAdvanceTimer = null;
  }

  /** A hand on the box or a manual step ends an auto-advance glide. */
  private cancelZoomSlide(): void {
    if (!this.zoomSlideFrame) return;
    window.cancelAnimationFrame(this.zoomSlideFrame);
    this.zoomSlideFrame = 0;
  }

  /** After the pause, step right or wrap, as the manual arrows and ↵ do. */
  private scheduleZoomAdvance(): void {
    this.cancelZoomAdvance();
    if (!this.zoomAutoAdvanceOn()) return;
    const state = this.zoomBox;
    if (!state) return;
    if (!zoomAutoAdvanceDue(this.zoomStrokeMaxX, state.box, this.zoomAutoAdvanceThreshold())) {
      return;
    }
    this.zoomAdvanceTimer = window.setTimeout(() => {
      this.zoomAdvanceTimer = null;
      this.advanceZoomBox();
    }, ZOOM_AUTO_ADVANCE_DELAY_MS);
  }

  private advanceZoomBox(): void {
    const state = this.zoomBox;
    const pageBox = state ? this.boxForPage(state.pageId) : null;
    if (!state || !pageBox) return;
    const { pages, index } = this.zoomPages();
    const next = autoAdvanceAcrossPages(
      state.box,
      state.originX,
      pages,
      index,
      this.zoomLineStep(),
    );
    this.pushZoomPosition();
    if (next.index === index) {
      this.glideZoomBox(next.box);
      return;
    }
    // A new page: no slide across the gap, the box is simply there.
    this.placeZoomBoxOn(next);
    this.ensureZoomTargetVisible();
    this.requestFrame();
  }

  private previousZoomBox(): void {
    const state = this.zoomBox;
    const pageBox = state ? this.boxForPage(state.pageId) : null;
    if (!state || !pageBox) return;
    this.cancelZoomSlide();
    const previous = this.zoomPositionHistory.pop() ?? {
      pageId: state.pageId,
      box: previousZoomBox(state.box, pageBox.width, pageBox.height, this.zoomLineStep()),
    };
    if (this.boxForPage(previous.pageId)) state.pageId = previous.pageId;
    state.box = previous.box;
    this.syncZoomTarget();
    this.ensureZoomTargetVisible();
    this.requestFrame();
  }

  /** Remember where the box is, for ←. */
  private pushZoomPosition(): void {
    const state = this.zoomBox;
    if (!state) return;
    const last = this.zoomPositionHistory[this.zoomPositionHistory.length - 1];
    if (last && last.pageId === state.pageId && sameZoomRect(last.box, state.box)) return;
    this.zoomPositionHistory.push({ pageId: state.pageId, box: { ...state.box } });
  }

  /** The pages a Zoom box can go to, in order, and the index of the one it is on. */
  private zoomPages(): { pages: ZoomPage[]; index: number } {
    const boxes = this.pageLayout.boxes;
    const id = this.zoomBox?.pageId;
    return {
      pages: boxes.map((b) => ({ width: b.width, height: b.height })),
      index: Math.max(
        0,
        boxes.findIndex((b) => b.id === id),
      ),
    };
  }

  /** Where a drag of (dx, dy) page px from `start` on page `pageId` takes the box. */
  private dragZoomPlace(start: ZoomRect, dx: number, dy: number, pageId: string): ZoomPlace {
    const boxes = this.pageLayout.boxes;
    const index = Math.max(
      0,
      boxes.findIndex((b) => b.id === pageId),
    );
    const pages = boxes.map((b) => ({ width: b.width, height: b.height }));
    return dragZoomBoxAcrossPages(start, dx, dy, pages, index);
  }

  /** Put the box at `place`, on whichever page that is. */
  private placeZoomBoxOn(place: ZoomPlace): void {
    const state = this.zoomBox;
    const page = this.pageLayout.boxes[place.index];
    if (!state || !page) return;
    state.pageId = page.id;
    state.box = place.box;
    this.syncZoomTarget();
  }

  /**
   * A finger dragged inside the window moves the view, as on a page: what
   * is under the finger stays under it, so the box goes the other way, on
   * to the next page past the end of this one (Goodnotes). Fingers do not
   * write in the box. In Stylus-only mode they do nothing here: the hand
   * rests in the window to write, and the frame on the page still moves by
   * finger (`zoomWindowPans`). With the Hand in hand the Pencil and a mouse
   * drag it as well. A second finger turns the drag into a pinch, which
   * magnifies as Goodnotes' window does (`pinchZoomBox`).
   */
  private onZoomPanDown(event: PointerEvent): void {
    const state = this.zoomBox;
    const canvas = this.zoomCanvas;
    const onlyStylus = this.callbacks.onlyStylusMode?.() === true;
    if (!zoomWindowPans(event.pointerType, this.toolState.tool, onlyStylus)) return;
    if (event.pointerType === "touch") {
      this.zoomTouches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (!state || !canvas || this.zoomStroke) return;
    if (event.pointerType === "touch" && this.zoomTouches.size === 2 && !this.zoomPinch) {
      // The second finger: what the first one dragged goes back, and the two pinch.
      this.endZoomPan(false);
      const [a, b] = [...this.zoomTouches.keys()];
      const pa = this.zoomTouches.get(a);
      const pb = this.zoomTouches.get(b);
      const dist = pa && pb ? Math.hypot(pa.x - pb.x, pa.y - pb.y) : 0;
      if (dist > 0) {
        this.cancelZoomSlide();
        this.cancelZoomAdvance();
        this.zoomPinch = { a, b, dist, start: { ...state.box }, moved: false };
        try {
          canvas.setPointerCapture(event.pointerId);
        } catch {
          // A synthetic pointer has nothing to capture.
        }
      }
      return;
    }
    if (this.zoomPan || this.zoomPinch) return;
    const rect = canvas.getBoundingClientRect();
    const scale = zoomView(state.box, rect.width, rect.height).scale;
    if (!(scale > 0)) return;
    this.cancelZoomSlide();
    this.cancelZoomAdvance();
    this.zoomPan = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      start: { ...state.box },
      index: this.zoomPages().index,
      scale,
      moved: false,
    };
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // A synthetic pointer has nothing to capture.
    }
  }

  private onZoomPanMove(event: PointerEvent): void {
    if (this.zoomTouches.has(event.pointerId)) {
      this.zoomTouches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    const pinch = this.zoomPinch;
    if (pinch && (event.pointerId === pinch.a || event.pointerId === pinch.b)) {
      this.moveZoomPinch(pinch, event);
      return;
    }
    const pan = this.zoomPan;
    if (!pan || event.pointerId !== pan.pointerId) return;
    const dx = event.clientX - pan.x;
    const dy = event.clientY - pan.y;
    if (!pan.moved && Math.hypot(dx, dy) < TAP_SLOP_PX) return;
    if (!pan.moved) {
      pan.moved = true;
      this.pushZoomPosition();
    }
    event.preventDefault();
    const page = this.pageLayout.boxes[pan.index];
    if (!page) return;
    this.placeZoomBoxOn(this.dragZoomPlace(pan.start, -dx / pan.scale, -dy / pan.scale, page.id));
    this.requestFrame();
  }

  private onZoomPanUp(event: PointerEvent): void {
    this.zoomTouches.delete(event.pointerId);
    const pinch = this.zoomPinch;
    if (pinch && (event.pointerId === pinch.a || event.pointerId === pinch.b)) {
      this.zoomPinch = null;
      if (pinch.moved) {
        this.ensureZoomTargetVisible();
        this.requestFrame();
      }
      return;
    }
    if (!this.zoomPan || event.pointerId !== this.zoomPan.pointerId) return;
    this.endZoomPan(true);
  }

  /** The pinch's fingers moved: the box shrinks or grows about its middle. */
  private moveZoomPinch(pinch: NonNullable<InkSurface["zoomPinch"]>, event: PointerEvent): void {
    const state = this.zoomBox;
    const pageBox = state ? this.boxForPage(state.pageId) : null;
    const pa = this.zoomTouches.get(pinch.a);
    const pb = this.zoomTouches.get(pinch.b);
    if (!state || !pageBox || !pa || !pb) return;
    const k = Math.hypot(pa.x - pb.x, pa.y - pb.y) / pinch.dist;
    // A two-finger tap (undo) is no pinch: wait for a real change of spread.
    if (!pinch.moved && Math.abs(k - 1) < ZOOM_PINCH_DEAD) return;
    if (!pinch.moved) {
      pinch.moved = true;
      this.pushZoomPosition();
    }
    event.preventDefault();
    state.box = pinchZoomBox(pinch.start, k, pageBox.width, pageBox.height);
    this.syncZoomTarget();
    this.requestFrame();
  }

  private endZoomPan(settle: boolean): void {
    const pan = this.zoomPan;
    this.zoomPan = null;
    if (!pan || !this.zoomBox) return;
    if (!pan.moved) return;
    if (!settle) {
      // Let go for a two-finger tap: the view goes back to where it was.
      const page = this.pageLayout.boxes[pan.index];
      if (page) this.placeZoomBoxOn({ index: pan.index, box: pan.start });
    }
    // A hand-placed line starts its next line where this one's left edge is.
    this.zoomBox.originX = this.zoomBox.box.x;
    this.ensureZoomTargetVisible();
    this.requestFrame();
  }

  /** Move the target over a few frames, so an auto-advance reads as a slide. */
  private glideZoomBox(to: ZoomRect): void {
    const state = this.zoomBox;
    if (!state) return;
    this.cancelZoomSlide();
    const from = { ...state.box };
    if (typeof window.requestAnimationFrame !== "function") {
      state.box = to;
      this.syncZoomTarget();
      this.ensureZoomTargetVisible();
      this.requestFrame();
      return;
    }
    const start = now();
    const tick = (): void => {
      const t = Math.min(1, (now() - start) / 160);
      const eased = t * t * (3 - 2 * t);
      state.box = {
        x: from.x + (to.x - from.x) * eased,
        y: from.y + (to.y - from.y) * eased,
        w: from.w + (to.w - from.w) * eased,
        h: from.h + (to.h - from.h) * eased,
      };
      this.syncZoomTarget();
      this.requestFrame();
      if (t < 1) {
        this.zoomSlideFrame = window.requestAnimationFrame(tick);
      } else {
        this.zoomSlideFrame = 0;
        this.ensureZoomTargetVisible();
      }
    };
    this.zoomSlideFrame = window.requestAnimationFrame(tick);
  }

  /** − or +: the target shrinks or grows about its centre, so the window magnifies more or less. */
  private scaleZoomWindow(factor: number): void {
    const state = this.zoomBox;
    const pageBox = state ? this.boxForPage(state.pageId) : null;
    if (!state || !pageBox) return;
    this.cancelZoomSlide();
    state.box = scaleZoomBox(state.box, factor, pageBox.width, pageBox.height);
    this.syncZoomTarget();
    this.ensureZoomTargetVisible();
    this.requestFrame();
  }

  /** The first target drag, from the catcher: finger, Pencil or mouse alike. */
  private onZoomCatcherPointerDown(event: PointerEvent): void {
    if (this.zoomMarqueePointer !== null || event.button !== 0) return;
    const at = this.toLayout(event.clientX, event.clientY);
    if (!this.startZoomMarquee(at)) return;
    event.preventDefault();
    event.stopPropagation();
    this.zoomMarqueePointer = event.pointerId;
    try {
      this.zoomCatcherEl?.setPointerCapture(event.pointerId);
    } catch {
      // A synthetic pointer has nothing to capture.
    }
  }

  private onZoomCatcherPointerMove(event: PointerEvent): void {
    if (event.pointerId !== this.zoomMarqueePointer) return;
    event.preventDefault();
    event.stopPropagation();
    this.moveZoomMarquee(this.toLayout(event.clientX, event.clientY));
  }

  private onZoomCatcherPointerUp(event: PointerEvent): void {
    if (event.pointerId !== this.zoomMarqueePointer) return;
    event.preventDefault();
    event.stopPropagation();
    this.zoomMarqueePointer = null;
    try {
      this.zoomCatcherEl?.releasePointerCapture(event.pointerId);
    } catch {
      // It was never captured.
    }
    if (event.type === "pointercancel") this.cancelZoomMarquee();
    else this.endZoomMarquee(this.toLayout(event.clientX, event.clientY));
    this.syncZoomCatcher();
  }

  /** A press on the target's frame, badge or a handle: the frame moves, a handle resizes. */
  private onZoomTargetPointerDown(event: PointerEvent): void {
    if (this.zoomTargetDrag) return;
    const state = this.zoomBox;
    const pageBox = state ? this.boxForPage(state.pageId) : null;
    if (!state || !pageBox || event.button !== 0) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    const grip = target?.closest<HTMLElement>("[data-zoom-handle]");
    const handle = (grip?.dataset.zoomHandle ?? null) as ZoomHandle | null;
    const press = zoomTargetPress(handle);
    this.cancelZoomSlide();
    event.preventDefault();
    event.stopPropagation();
    try {
      (grip ?? this.zoomTargetEl)?.setPointerCapture(event.pointerId);
    } catch {
      // A synthetic pointer has nothing to capture.
    }
    this.zoomTargetDrag = {
      pointerId: event.pointerId,
      pageId: state.pageId,
      handle: press,
      from: this.pagePoint(pageBox, event.clientX, event.clientY),
      start: { ...state.box },
    };
  }

  private onZoomTargetPointerMove(event: PointerEvent): void {
    const drag = this.zoomTargetDrag;
    const state = this.zoomBox;
    const pageBox = state ? this.boxForPage(drag?.pageId ?? state.pageId) : null;
    if (!drag || !state || !pageBox || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const at = this.pagePoint(pageBox, event.clientX, event.clientY);
    const dx = at.x - drag.from.x;
    const dy = at.y - drag.from.y;
    if (drag.handle === "move") {
      // Dragged past the page's end, the frame goes on to the next page.
      this.placeZoomBoxOn(this.dragZoomPlace(drag.start, dx, dy, drag.pageId));
    } else {
      state.box = resizeZoomBox(drag.start, drag.handle, dx, dy, pageBox.width, pageBox.height);
      this.syncZoomTarget();
    }
    this.requestFrame();
  }

  private onZoomTargetPointerUp(event: PointerEvent): void {
    const drag = this.zoomTargetDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    this.zoomTargetDrag = null;
    if (this.zoomBox) {
      if (this.zoomBox.pageId !== drag.pageId || !sameZoomRect(this.zoomBox.box, drag.start)) {
        this.zoomPositionHistory.push({ pageId: drag.pageId, box: { ...drag.start } });
      }
      // A hand-placed line starts its next line where this one's left edge is.
      this.zoomBox.originX = this.zoomBox.box.x;
    }
    this.ensureZoomTargetVisible();
    this.requestFrame();
  }

  /**
   * A client point over the box's canvas, in layout space (what the page's
   * controller hands the surface): through the magnified view to its page
   * point, past the content's edge too, as a captured pen runs on.
   */
  private zoomClientToLayout(clientX: number, clientY: number): { x: number; y: number } {
    const state = this.zoomBox;
    const canvas = this.zoomCanvas;
    const pageBox = state ? this.boxForPage(state.pageId) : null;
    if (!state || !canvas || !pageBox) return { x: Number.NaN, y: Number.NaN };
    const rect = this.zoomCanvasRect ?? (this.zoomCanvasRect = canvas.getBoundingClientRect());
    const view = zoomView(state.box, rect.width, rect.height);
    const at = zoomViewPointFree(state.box, view, clientX - rect.left, clientY - rect.top);
    return { x: pageBox.x + at.x, y: pageBox.y + at.y };
  }

  /**
   * Where a pen or mouse press in the box goes. The magnifier and the hand
   * have no gesture there, a press in the margins round the content is
   * nothing, and a key or stylus button that would move the page does
   * nothing either; anything else draws, through the same `penStart` as the
   * page (a lent eraser or lasso included).
   */
  private zoomBoxRoute(event: PointerEvent): PressRoute {
    const { tool } = this.toolState;
    if (tool === "zoom" || tool === "pan") return "ignore";
    const state = this.zoomBox;
    const canvas = this.zoomCanvas;
    if (!state || !canvas) return "ignore";
    // A new press reads the canvas afresh: the window may have moved since.
    const rect = canvas.getBoundingClientRect();
    this.zoomCanvasRect = rect;
    const view = zoomView(state.box, rect.width, rect.height);
    if (!zoomViewPoint(state.box, view, event.clientX - rect.left, event.clientY - rect.top)) {
      return "ignore";
    }
    if (stylusButtonDown(event)) this.stylusMenuUntil = now() + STYLUS_MENU_MS;
    const route = pressOverride(event, { mac: macKeys(), barrel: this.barrel(), onPage: true });
    return route === "ignore" || route === "pan" ? "ignore" : "draw";
  }

  /**
   * The box's controller: strokes go to the same `penStart`/`penMove`/
   * `penEnd` as the page's, with the box's bookkeeping round them. Fingers
   * on the box never draw (they are the writing hand, as on the page) and
   * move nothing; two- and three-finger double taps still undo and redo.
   */
  private readonly zoomPointerCallbacks: PointerControllerCallbacks = {
    onStylusClick: (clientX, clientY) => this.stylusClicked(clientX, clientY),
    onStart: (sample, press) => this.zoomStrokeStart(sample, press),
    onMove: (coalesced) => this.zoomStrokeMove(coalesced),
    onEnd: (sample) => this.zoomStrokeEnd(sample),
    onCancel: () => this.zoomStrokeCancel(),
    onFingerDoubleTap: (fingers) => this.pointerCallbacks.onFingerDoubleTap?.(fingers),
    onFingerTapReport: (report) => this.pointerCallbacks.onFingerTapReport?.(report),
    onDebug: (record) => this.pointerCallbacks.onDebug?.(record),
  };

  /** The page x (page-local) a box stroke's sample reached, for auto-advance. */
  private zoomLocalX(sample: { x: number }): number {
    const state = this.zoomBox;
    const pageBox = state ? this.boxForPage(state.pageId) : null;
    return pageBox ? sample.x - pageBox.x : sample.x;
  }

  private zoomStrokeStart(sample: PointerSample, press: PressInput): void {
    this.strokeInBox = true;
    this.zoomStroke = true;
    this.cancelZoomAdvance();
    // The box must not glide on under a pen that has landed in it.
    this.cancelZoomSlide();
    this.zoomStrokeMaxX = this.zoomLocalX(sample);
    this.penStart(sample, press);
  }

  private zoomStrokeMove(coalesced: PointerSample[]): void {
    for (const sample of coalesced) {
      this.zoomStrokeMaxX = Math.max(this.zoomStrokeMaxX, this.zoomLocalX(sample));
    }
    this.penMove(coalesced);
  }

  private zoomStrokeEnd(sample: PointerSample): void {
    this.zoomStrokeMaxX = Math.max(this.zoomStrokeMaxX, this.zoomLocalX(sample));
    this.penEnd(sample);
    this.endZoomStroke();
    this.scheduleZoomAdvance();
  }

  /**
   * WebKit ends a pen held still in `pointercancel` (CLAUDE.md); the page
   * keeps that ink, and so does the box, which may then step on as after a lift.
   */
  private zoomStrokeCancel(): void {
    this.penCancel();
    this.endZoomStroke();
    this.scheduleZoomAdvance();
  }

  private endZoomStroke(): void {
    this.zoomStroke = false;
    this.strokeInBox = false;
    this.zoomCanvasRect = null;
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
      case "fill":
        return this.fillGesture;
      case "tape":
        return this.tapeGesture;
      default:
        return this.inkGesture;
    }
  }

  /** Where the Fill tool's press went down: page point and layout sample. */
  private fillPress: { boxIndex: number; x: number; y: number; sx: number; sy: number } | null =
    null;

  /**
   * The Fill tool: a tap inside an outline fills it with the pen's colour,
   * on lift. A drag is not a tap, and fills nothing.
   */
  private readonly fillGesture: PenGesture = {
    down: (box, at, sample) => {
      this.fillPress = { boxIndex: box.index, x: at.x, y: at.y, sx: sample.x, sy: sample.y };
    },
    move: () => undefined,
    up: (box, sample) => {
      const press = this.fillPress;
      this.fillPress = null;
      this.activePage = null;
      if (!press || press.boxIndex !== box.index) return;
      const moved = Math.hypot(sample.x - press.sx, sample.y - press.sy) * this.unitScale;
      if (moved > TAP_SLOP_PX) return;
      // The Fill tool's own colour, never the pen's.
      this.fillAt(box, press.x, press.y, this.toolState.fillColor ?? DEFAULT_FILL_COLOR, false);
    },
    cancel: () => {
      this.fillPress = null;
      this.activePage = null;
    },
  };

  /**
   * Fill the region of `box`'s page round page point (`x`, `y`) that the
   * ink encloses, with `color`, as one undo step: a fill already on that
   * region takes the colour instead. A region that is not closed, or a tap
   * on the ink, says so with a notice unless `quiet`. `accept` may refuse
   * the region found. True when the page changed (or already was so).
   */
  private fillAt(
    box: PageBox,
    x: number,
    y: number,
    color: string,
    quiet: boolean,
    accept?: (outline: number[], area: number) => boolean,
  ): boolean {
    const page = this.pageAt(box.index);
    if (!page) return false;
    // Pen ink and shapes bound a fill; highlighter, a note's ink and other
    // fills do not.
    const ink: FillInk[] = [];
    for (const stroke of page.strokes) {
      if (stroke.tool === "highlighter" || stroke.onSticky !== undefined) continue;
      if (isBucketFill(stroke)) continue;
      ink.push({ pts: stroke.pts, radius: stroke.size * FILL_INK_RADIUS });
    }
    const result = bucketFill({
      width: box.width,
      height: box.height,
      ink,
      x,
      y,
      gap: fillGapPx(readFillGap(this.toolState.fillGap)),
    });
    if (!result.ok) {
      if (!quiet) {
        new Notice(
          result.reason === "open"
            ? "This area is not closed: nothing filled."
            : "Tap inside an outline to fill it.",
        );
      }
      return false;
    }
    if (accept && !accept(result.outline, result.area)) return false;
    const stroke = fillStroke(this.strokeIds.next(), color, result.outline);
    const existing = sameFill(page.strokes, stroke.pts);
    if (existing && existing.color === stroke.color) return true;
    const command = existing
      ? new RecolorFill(page.id, existing, color)
      : new AddFill(page.id, stroke, fillInsertIndex(page.strokes, enclosedArea(stroke.pts)));
    this.history.push(this.doc, command);
    if (!existing) this.strokeIndex.add(page.id, stroke);
    const bounds = selectionBounds([existing ?? stroke], [], []);
    if (bounds) this.renderer?.invalidateRegion(box.index, bounds);
    if (this.debug) this.hud.mark("fill");
    this.inkChanged([page.id]);
    return true;
  }

  // --- Cover tape (`model/cover-tape`) -------------------------------------------

  /**
   * The cover tapes shown through in this view, by their owner's id (a
   * mirror over a join goes with its owner). This session's only: never
   * saved, so a notebook always opens, syncs and exports with its tapes on.
   */
  private revealedTapes: ReadonlySet<string> = new Set();

  /** A tape being dragged out: where it started and where the pen is, page px. */
  private tapeDrag: { from: Pt; to: Pt } | null = null;

  /**
   * The Cover tape tool: a drag lays a strip from where it started to where
   * it lifts, its height the pill's, made level or upright when nearly so; a
   * tap shows a tape there through, or covers it again.
   */
  private readonly tapeGesture: PenGesture = {
    down: (_box, at) => {
      this.tapeDrag = { from: at, to: at };
    },
    move: (box, samples) => {
      const drag = this.tapeDrag;
      const last = samples[samples.length - 1];
      if (!drag || !last) return;
      drag.to = this.toPage(box, last);
      const draft = this.tapeStroke(drag.from, drag.to);
      if (draft) this.renderer?.renderWetStrokes(box.index, [draft]);
      else this.renderer?.clearWet();
    },
    up: (box, sample) => this.finishTape(box, this.toPage(box, sample)),
    // iOS cancels some ordinary lifts: a tape dragged out is still laid.
    cancel: (box) => {
      if (box) this.finishTape(box, null);
      else {
        this.tapeDrag = null;
        this.renderer?.clearWet();
      }
    },
  };

  /** The tape a drag from `from` to `to` lays, or null for a tap. */
  private tapeStroke(from: Pt, to: Pt): Stroke | null {
    const pts = tapePoints(
      from,
      to,
      this.atFitZoom(LINE_LEVEL_RISE),
      this.atFitZoom(MIN_TAPE_LENGTH),
    );
    if (!pts) return null;
    return {
      id: "tape-draft",
      color: tapeColorOf(this.toolState.tapeColor),
      size: tapeHeightOf(this.toolState.tapeHeight),
      tool: "tape",
      pts,
    };
  }

  /** The tape tool lifted at `end` (null: cancelled where it was): lay the tape, or toggle one. */
  private finishTape(box: PageBox, end: Pt | null): void {
    const drag = this.tapeDrag;
    this.tapeDrag = null;
    this.activePage = null;
    this.renderer?.clearWet();
    const page = this.pageAt(box.index);
    if (!drag || !page) return;
    const draft = this.tapeStroke(drag.from, end ?? drag.to);
    if (!draft) {
      this.toggleTapeAt(page, drag.from, PEN_TAP_TOLERANCE_PX / this.gestureScale);
      return;
    }
    const stroke: Stroke = { ...draft, id: this.strokeIds.next() };
    // As `commitStroke`, but never stuck on a sticky note: a tape lies over the page.
    const command = addStrokesTimed(page, [stroke], this.penDownAt);
    this.history.push(this.doc, command);
    this.strokeIndex.add(page.id, stroke);
    this.renderer?.appendCommittedStroke(box.index, stroke, this.inkPressure);
    this.inkChanged([page.id]);
  }

  /** The id a tape is shown through by: its owner's, for a mirror over a join. */
  private tapeKey(tape: Stroke): string {
    const owner = tape.join ? ownerOf(tape.join) : null;
    return owner?.id ?? tape.id;
  }

  /**
   * Show the tape on top at page point `p` of `page` through, or cover it
   * again, with its mirrors. False when no tape is there. Never an undo
   * step, and never saved.
   */
  private toggleTapeAt(page: Page, p: Pt, tolerance: number): boolean {
    const tape = topTapeAt(page.strokes, p.x, p.y, tolerance);
    if (!tape) return false;
    this.setTapesShown(toggleRevealed(this.revealedTapes, this.tapeKey(tape)));
    return true;
  }

  /** Make `next` the tapes shown through, and repaint every tape whose state changed. */
  private setTapesShown(next: ReadonlySet<string>): void {
    const before = this.revealedTapes;
    this.revealedTapes = next;
    this.renderer?.setRevealedTapes(next);
    this.doc.pages.forEach((page, index) => {
      for (const stroke of page.strokes) {
        if (!isTape(stroke)) continue;
        const key = this.tapeKey(stroke);
        if (before.has(key) === next.has(key)) continue;
        const line = strokeBounds(stroke);
        if (!line) continue;
        const pad = stroke.size;
        this.renderer?.invalidateRegion(index, {
          minX: line.minX - pad,
          minY: line.minY - pad,
          maxX: line.maxX + pad,
          maxY: line.maxY + pad,
        });
      }
    });
    this.syncTextBoxes();
    this.renderDry();
    this.requestZoomPaint();
    this.callbacks.onTapesToggled?.();
  }

  /**
   * Whether every cover tape on the page in view is shown through, or null
   * when the page has none: the tape pill's eye.
   */
  tapesShown(): boolean | null {
    const page = this.doc.pages[this.currentPage];
    const tapes = page ? page.strokes.filter(isTape) : [];
    if (tapes.length === 0) return null;
    return tapes.every((tape) => this.revealedTapes.has(this.tapeKey(tape)));
  }

  /** Show every cover tape on the page in view through (`shown`), or cover them all. */
  showTapes(shown: boolean): void {
    const page = this.doc.pages[this.currentPage];
    if (!page) return;
    const next = new Set(this.revealedTapes);
    for (const tape of page.strokes) {
      if (!isTape(tape)) continue;
      if (shown) next.add(this.tapeKey(tape));
      else next.delete(this.tapeKey(tape));
    }
    this.setTapesShown(next);
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
    ctx.lineCap = "butt";
    ctx.lineJoin = "round";
    const color = this.options.laserColor?.() ?? LASER_COLOR;
    ctx.strokeStyle = color;
    const paths = laserPaths(this.laserTrail.segments(t));
    // A wide faint pass is the glow, a narrow one the beam: no canvas blur,
    // which is slow on the iPad.
    for (const [lineWidth, strength] of [
      [LASER_GLOW_PX, 0.25],
      [LASER_WIDTH_PX, 1],
    ] as const) {
      ctx.lineWidth = lineWidth * ratio;
      for (const { alpha, runs } of paths) {
        ctx.globalAlpha = alpha * strength;
        this.strokeLaserRuns(ctx, runs, sx, sy);
      }
    }
    ctx.globalAlpha = 1;
    this.requestLaser();
  }

  /** One path for every run of a fade level, stroked once: lines meet without overlapping. */
  private strokeLaserRuns(
    ctx: CanvasRenderingContext2D,
    runs: readonly LaserPoint[][],
    sx: (x: number) => number,
    sy: (y: number) => number,
  ): void {
    ctx.beginPath();
    for (const run of runs) {
      const first = run[0];
      if (!first) continue;
      ctx.moveTo(sx(first.x), sy(first.y));
      for (let index = 1; index < run.length; index++) {
        const point = run[index];
        ctx.lineTo(sx(point.x), sy(point.y));
      }
    }
    ctx.stroke();
  }

  /**
   * Every sample erases (a preview); the lift commits the gesture as one
   * step. The page is painted at the next frame, once for every pen event
   * since: painted in each event, a slow paint let events queue behind it
   * and the eraser fall further and further behind the pen.
   */
  private readonly eraserGesture: PenGesture = {
    down: (box, at) => {
      this.eraseReset();
      if (this.eraseAt(box, at)) this.requestFrame();
    },
    move: (box, samples) => {
      let erased = false;
      for (const sample of samples) {
        if (this.eraseAt(box, this.toPage(box, sample))) erased = true;
      }
      if (erased) this.requestFrame();
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
    down: (box, at) => {
      if (lassoModeFor(this.toolState) === "single") this.pickStart(box, at);
      else this.selectStart(box, at);
    },
    move: (box, samples) => {
      if (this.picking) this.pickMove(box, samples);
      else this.selectMove(samples.map((sample) => this.toPage(box, sample)));
    },
    up: () => {
      if (this.picking) this.pickEnd();
      else this.selectEnd();
    },
    cancel: () => {
      if (this.picking) this.pickEnd();
      else this.selectEnd();
    },
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
      // With the pages joined a box may be drawn over the join (`shapeRoom`).
      const room = this.shapeRoom(box);
      this.textDrag.to = {
        x: clamp(local.x, room.minX, room.maxX),
        y: clamp(local.y, room.minY, room.maxY),
      };
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
      const origin = this.snapDragEnd(box, mode, at);
      this.shapeDrag = { preset: mode, origin, to: origin, moved: false };
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
    this.requestZoomPaint();
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
    const mirrors = this.strokeMirrors(page.id, stroke.id);
    if (!this.history.withdraw(this.doc, lift.command)) return null;
    this.strokeIndex.remove(stroke.id, page.id);
    this.repaintMirrors(mirrors);
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
        const room = this.shapeRoom(box);
        const to = {
          x: clamp(local.x, room.minX, room.maxX),
          y: clamp(local.y, room.minY, room.maxY),
        };
        drag.to = this.snapDragEnd(box, drag.preset, to);
        drag.snapped = this.snapShown;
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
      if (
        Math.hypot(local.x - press.at.x, local.y - press.at.y) * this.gestureScale >
        TAP_SLOP_PX
      ) {
        this.cancelCircleHold();
      }
    }
    const snap = this.snap;
    if (snap) {
      // Snapped and still held: the shape follows the pen, and a corner or
      // its far end lands on another shape's when it comes near one. A line
      // or an arrow that did not, turned near level or upright, settles
      // there about its tail.
      if (last) {
        const pts = this.snapHeldShape(box, snap, this.toPage(box, last));
        const open = snap.kind === "line" || snap.kind === "arrow";
        const rise = this.atFitZoom(LINE_LEVEL_RISE);
        snap.pts = open && !this.snapShown ? levelLine(pts, "start", rise) : pts;
      }
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

  /** When a pen stroke snaps to a shape: Pen gestures › Make shapes. */
  private snapMode(): SnapMode {
    return this.toolState.snapMode ?? "hold";
  }

  /** The Shape tool always snaps on a hold; the pens unless Make shapes is off. */
  private holdToSnapEnabled(): boolean {
    // A practice file is handwriting only.
    if (this.practice) return false;
    const tool = this.toolState.tool;
    if (tool === "shape") return true;
    return (tool === "pen" || tool === "highlighter") && this.snapMode() !== "disabled";
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
    const result = recognizeAtZoom(builder.points(), this.gestureZoom, {
      held: true,
      curvatureThreshold: (this.toolState.snapCurvatureThreshold ?? 50) / 100,
    });
    this.diagHold = { fired: true, verdict: verdictOf(builder.points(), true) };
    this.hudVerdict("hold", builder.points(), result, true);
    if (!result) return;
    const box = this.activePage;
    const base = box ? this.snapShapeStart(box, result.kind, result.pts) : result.pts;
    const pivot = shapePivot(result.kind, base);
    if (!pivot) return;
    this.snap = {
      kind: result.kind,
      base,
      pivot,
      from: { x: anchor.x, y: anchor.y },
      pts: base,
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
        roundedPen: this.penController?.strokeRounded ?? null,
        scale: Math.round(this.scale * 1000) / 1000,
        tool: this.toolState.tool,
        snapMode: this.snapMode(),
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
    const best = accepted ?? recognizeAtZoom(pts, this.gestureZoom, { minConfidence: 0, held });
    const score = best?.confidence === undefined ? "" : best.confidence.toFixed(2);
    const label = best ? `${best.kind}${accepted ? "" : "✗"}${score}` : "∅";
    this.hudLastVerdict = `${where}→${label} n=${Math.floor(pts.length / 3)}`;
    this.hud.mark(where === "hold" ? "hold" : "snap?");
    this.scheduleHud();
  }

  /** Redraw the HUD on the next frame: one redraw for however many changes come first. */
  /** Blur a text box's textarea, telling the HUD which path did (`by`). */
  private blurTextInput(input: HTMLTextAreaElement, by: string): void {
    this.textBlurBy = by;
    try {
      input.blur();
    } finally {
      this.textBlurBy = "";
    }
  }

  /**
   * A text box blurred: keep why in the HUD, and whether it went with it,
   * empty (read once the blur handler has run). Where the focus went is
   * read a frame later, when WebKit has moved it.
   */
  private noteTextEnd(view: TextBoxView, event: FocusEvent): void {
    const surface = this.surfaceEl.getBoundingClientRect();
    const box = view.root.getBoundingClientRect();
    const record: TextEndRecord = {
      by: this.textBlurBy,
      ms: view.focusedAt ? now() - view.focusedAt : 0,
      to: event.relatedTarget instanceof Element ? event.relatedTarget : null,
      keyboard: keyboardHeight(),
      surfaceH: surface.height,
      boxTop: box.top - surface.top,
      boxBottom: box.bottom - surface.top,
      tool: this.toolState.tool,
      hidden: document.visibilityState === "hidden",
      removed: false,
    };
    window.requestAnimationFrame(() => {
      record.removed = !this.liveTextBox(view.pageId, view.id);
      this.hudTextEnd = textEndLine(record, document.activeElement);
      this.scheduleHud();
    });
  }

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
        `${this.hud.tilt()}\n` +
        (this.hudTextEnd ? `${this.hudTextEnd}\n` : "") +
        (this.hudTextMark ? `highlighter ${this.hudTextMark}\n` : "") +
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
      `${this.backdropPainter?.diagnostics?.() ?? "pdf=-"} ` +
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
    // Only the points kept since the last frame: what is traced stays. A
    // point's tilt widens it as it arrives, never after.
    const tilt = builder.tiltView;
    for (let i = tracer.length * 3; i + 2 < pts.length; i += 3) {
      tracer.push(pts[i], pts[i + 1], pts[i + 2], tiltFactor(tilt[i / 3]));
    }
    const runs = tracer.runs();
    // Samples still provisional (`densify` waits for the next to fix the
    // curve; centred smoothing for the next few): straight lines through
    // them until they settle. The open run is the tracer's copy, so this
    // changes nothing kept.
    const open = runs[runs.length - 1];
    if (open) for (const tip of builder.tail) open.pts.push(tip[0], tip[1]);
    this.renderer?.renderWetRuns(box.index, runs, style);
    this.requestZoomPaint();
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
    const rise = this.atFitZoom(LINE_LEVEL_RISE);
    return lineOfHighlight(pts, this.atFitZoom(HIGHLIGHT_LINE_MIN_PX), rise);
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
    this.showSnapMarker(null, null);
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
      // A tap in a table types in the cell, rather than placing a box on it.
      if (this.editCellAt(box, drag.origin)) return;
      // A tap on a sticky note types on the note.
      if (this.editNoteTextAt(box, drag.origin)) return;
      // GoodNotes' default: the box starts where the pen went down, as small
      // as it can be, and grows with the text (the sync sets its width).
      const x = clamp(drag.origin.x, 0, Math.max(0, box.width - TEXT_MIN_W));
      this.addTextBox(box, { x, y: drag.origin.y, w: TEXT_MIN_W, fit: true });
      return;
    }
    const w = Math.max(TEXT_MIN_W, rect.w);
    const h = Math.max(TEXT_MIN_H, rect.h);
    const room = this.shapeRoom(box);
    this.addTextBox(box, {
      x: clamp(rect.x, room.minX, Math.max(room.minX, room.maxX - w)),
      y: clamp(rect.y, room.minY, Math.max(room.minY, room.maxY - h)),
      w,
      h,
    });
  }

  /**
   * Create and focus a persistent text box with the given page-local frame:
   * a box of its own, or the text of the sticky note `onSticky`.
   */
  private addTextBox(box: PageBox, frame: TextBoxFrame, onSticky?: string): void {
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
      ...(onSticky !== undefined ? { onSticky } : {}),
    };
    // Shown by its textarea from the start, or the focus below finds it hidden.
    if (onSticky !== undefined) this.noteTextOpen = `${page.id}:${textBox.id}`;
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
    // Focused now, the note's text shows while it is typed in, as any box.
    this.noteTextOpen = null;
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

    // A Pencil or mouse tap on a cover tape shows it through, or covers it
    // again, instead of leaving a dot on it.
    if (!snap && final && this.penTapsTape(page, builder.points())) return;

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
    // A scribble over nothing, inside an outline, fills it instead.
    if (!snap && this.scribbleFill(box, builder.points())) {
      this.recordDiagnostic(
        builder.points(),
        "scribble-fill",
        final ? "up" : cancelledWhileHeld ? "cancel-as-hold" : "cancel",
        heldLongEnough,
      );
      return;
    }

    // The Shape tool's auto mode snaps every stroke on lift, no hold needed,
    // and so does the pen with Make shapes on lift (its Auto shape button).
    const snapMode = this.snapMode();
    const snapOnLift =
      this.toolState.tool === "shape" ||
      (snapMode === "auto" &&
        !this.practice &&
        (this.toolState.tool === "pen" || this.toolState.tool === "highlighter"));
    let shape: { kind: ShapeKind; pts: number[] } | null = snap;
    if (!shape && (snapOnLift || shouldSnapStroke(snapMode, heldLongEnough))) {
      // Held, the pen rested where the stroke ends; snapped on lift, it may
      // have trailed a tail as it left the glass.
      const held = heldLongEnough;
      shape = recognizeAtZoom(builder.points(), this.gestureZoom, {
        held,
        curvatureThreshold: (this.toolState.snapCurvatureThreshold ?? 50) / 100,
      });
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
    const { color, size, tool, nib, tip } = this.currentStyle();
    const samples = builder.recorded();
    const pts = shape
      ? shape.pts
      : (this.highlightLine(tool, builder.points()) ?? builder.points());
    // The Pencil's tilt, kept only where it widened the brush.
    const tilt = shape ? null : builder.tilts();
    const tilted = tilt !== null && tilt.length * 3 === pts.length && tiltShapes(tilt);
    const stroke: Stroke = {
      id: this.strokeIds.next(),
      color,
      size,
      tool,
      pts,
      ...(shape ? { shape: shape.kind } : {}),
      ...(samples ? { samples } : {}),
      // A snapped shape is clean geometry, drawn at one width: no nib.
      ...(nib !== undefined && !shape ? { nib } : {}),
      ...(tip !== undefined && !shape ? { tip } : {}),
      ...(tilted ? { tilt } : {}),
    };
    if (shape) this.styleShape(stroke);
    this.notePracticeInput();
    // Ink on the mirror of a sticky note goes on the note it mirrors.
    const home = this.strokeHome(box, page, stroke);
    const command = this.commitStroke(home.box, home.page, stroke);
    this.noteCircleLoop(home.page, stroke, command);
    // A board grows to hold ink past its edge (`growBoard`): nothing is lost.
    // Ink run on over a join is on the page beside it, not off the paper.
    if (!this.board && !this.runsOnOverJoin(home.box, stroke)) {
      this.noteOffPage(home.box, stroke, command);
    }
    if (!shape) this.callbacks.onStrokeDrawn?.(home.page.id, stroke);
    else if (this.toolState.tool === "pen" || this.toolState.tool === "highlighter") {
      this.callbacks.onPenShape?.();
    }
    // A stroke the pen was held on ended on purpose; any other may be a
    // flicker of the Pencil's contact, which the next pen-down carries on.
    if (!snap && !heldLongEnough && home.box === box) {
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
   * Whether a stroke of `pts` (page px) was a tap on a cover tape, which it
   * then toggled: every point within a tap's slop of the first, on a tape.
   */
  private penTapsTape(page: Page, pts: readonly number[]): boolean {
    if (pts.length < 3 || !page.strokes.some(isTape)) return false;
    const slop = TAP_SLOP_PX / this.gestureScale;
    for (let i = 3; i + 1 < pts.length; i += 3) {
      if (Math.hypot(pts[i] - pts[0], pts[i + 1] - pts[1]) > slop) return false;
    }
    const at = { x: pts[0], y: pts[1] };
    return this.toggleTapeAt(page, at, PEN_TAP_TOLERANCE_PX / this.gestureScale);
  }

  /**
   * Ink past the page's edge is kept but never drawn, so a stroke that runs
   * well off the page says so, with Undo: GoodNotes' "Content outside of
   * the page" notice, without dropping the stroke as GoodNotes does. The
   * notice goes the moment anything else is done (`syncHistory`).
   */
  /** With the pages joined, whether a stroke's ink runs on to another page: then it is not off the paper. */
  private runsOnOverJoin(box: PageBox, stroke: Stroke): boolean {
    if (!this.joined) return false;
    return pagesReached(this.pageLayout, box.index, stroke.pts, strokeReach(stroke)).length > 0;
  }

  private noteOffPage(box: PageBox, stroke: Stroke, command: Command): void {
    const beyond = inkBeyondPage(stroke.pts, box.width, box.height);
    if (beyond < this.atFitZoom(OFF_PAGE_TOLERANCE_PX)) return;
    this.hideOffPage();
    this.offPageCommand = command;
    this.offPageEl.removeClass("is-hidden");
    this.placeToasts();
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
    if (stroke.pts.length >= 3 && stroke.onSticky === undefined) {
      const note = noteAt(page, stroke.pts[0], stroke.pts[1]);
      if (note) stroke.onSticky = note.id;
    }
    const command = addStrokesTimed(page, [stroke], this.penDownAt);
    this.history.push(this.doc, command);
    this.strokeIndex.add(page.id, stroke);
    this.renderer?.appendCommittedStroke(box.index, stroke, this.inkPressure);
    // The wet layer was just cleared: blit the tiles now, or the stroke
    // would be missing for a frame. Ink run on over a join is mirrored on
    // the pages it reaches as part of the same step (`syncMirrors`).
    this.inkChanged([page.id]);
    return command;
  }

  /**
   * Where a stroke drawn on `box` belongs: there, unless the pages are
   * joined and it starts on the mirror of a sticky note from the page
   * beside it, whose ink is the owner's. Then the owner's page, the stroke
   * moved into its space and stuck on the owner note.
   */
  private strokeHome(box: PageBox, page: Page, stroke: Stroke): { box: PageBox; page: Page } {
    if (!this.joined || stroke.pts.length < 3 || stroke.onSticky !== undefined) {
      return { box, page };
    }
    const note = noteAt(page, stroke.pts[0], stroke.pts[1]);
    if (!note || !isMirror(note)) return { box, page };
    const owner = findOwner(this.doc, this.pageLayout, "images", note);
    if (!owner) return { box, page };
    stroke.pts = movePagePts(stroke.pts, box, owner.box);
    stroke.onSticky = owner.element.id;
    return { box: owner.box, page: owner.page };
  }

  /**
   * The mirrors of stroke `id` of page `pageId` on the other pages, where
   * they are drawn: to repaint after the step that made them is taken back.
   */
  private strokeMirrors(pageId: string, id: string): Array<{ index: number; stroke: Stroke }> {
    if (!this.joined) return [];
    const key = ownerKey(pageId, id);
    const out: Array<{ index: number; stroke: Stroke }> = [];
    this.doc.pages.forEach((other, index) => {
      for (const stroke of other.strokes) if (stroke.join === key) out.push({ index, stroke });
    });
    return out;
  }

  /** Repaint where the mirrors of a stroke were. */
  private repaintMirrors(mirrors: ReadonlyArray<{ index: number; stroke: Stroke }>): void {
    for (const { index, stroke } of mirrors) {
      const drawn = selectionBounds([stroke], [], []);
      if (drawn) this.renderer?.invalidateRegion(index, drawn);
    }
  }

  // --- Mirrors over the join (`canvas/mirrors.ts`) -------------------------------

  /** The newest undo step the mirrors were brought in line after (`syncMirrors`). */
  private mirroredStep: Command | null = null;

  /**
   * With the pages joined, bring every mirror in line with its owner after
   * an edit, as part of the same undo step (`History.attach`), and repaint
   * where they changed. Runs once for each new step; a notebook already in
   * line plans nothing. After an undo it plans nothing either: the step
   * taken back held its mirrors.
   */
  private syncMirrors(): void {
    const history = this.history as History | undefined;
    if (!history || !this.joined || this.board) return;
    const latest = history.latest;
    if (latest === this.mirroredStep) return;
    this.mirroredStep = latest;
    if (!latest) return;
    const ops = planMirrors(this.doc, this.pageLayout, {
      strokeBounds: (pageId, stroke) => this.ownerBounds(pageId, stroke),
    });
    if (ops.length === 0) return;
    const before = mirrorsBefore(this.doc, ops);
    if (!history.attach(this.doc, new MirrorSync(ops))) return;
    this.mirroredStep = history.latest;
    const indexOf = new Map(this.pageLayout.boxes.map((box) => [box.id, box.index]));
    for (const { pageId, bounds } of mirrorRegions(ops, before)) {
      const index = indexOf.get(pageId);
      if (index !== undefined) this.renderer?.invalidateRegion(index, bounds);
    }
    if (ops.some((op) => op.kind === "textBoxes")) this.syncTextBoxes();
    this.renderDry();
  }

  /**
   * A stroke's bounds for planning its mirrors: the index's cells when they
   * lie well inside the page (it reaches no other), its ink otherwise.
   */
  private ownerBounds(pageId: string, stroke: Stroke): Bounds | null {
    const cells = this.strokeIndex.cellBounds(stroke.id);
    const box = this.pageLayout.boxes.find((b) => b.id === pageId);
    if (cells && box && cells.minX > 0 && cells.minY > 0) {
      if (cells.maxX < box.width && cells.maxY < box.height) return cells;
    }
    return elementBounds("strokes", stroke);
  }

  // --- Snapping to other shapes (discussion #51) -----------------------------

  /**
   * Finds the corner, end or midpoint of another shape near a point, on
   * `snapPageId`, through the stroke index: one per surface, and a query
   * allocates nothing (`ink/shape-snap.ts`).
   */
  private readonly shapeSnapper = new ShapeSnapper((x, y, reach, visit) => {
    this.strokeIndex.forEachNear(this.snapPageId, x, y, reach, visit);
  });
  private snapPageId = "";
  /** The ring shown where a point snapped; made on first use. */
  private snapMarkerEl: HTMLElement | null = null;
  /** Whether the ring is up: the last point placed snapped to a shape. */
  private snapShown = false;

  /**
   * Snap page point (x, y) of `box` to another shape within
   * {@link SNAP_RADIUS_PX}, a screen length; true when it did, the target
   * then in `shapeSnapper.hit`.
   */
  private snapNear(box: PageBox, x: number, y: number): boolean {
    this.snapPageId = this.pageAt(box.index)?.id ?? "";
    return this.shapeSnapper.snap(x, y, this.atFitZoom(SNAP_RADIUS_PX));
  }

  /**
   * Where a Shape tool drag starts or is now, snapped to another shape's
   * corner, end or midpoint when it is a line's or arrow's end or a
   * rectangle's corner: the presets whose drag points lie on the shape.
   */
  private snapDragEnd(box: PageBox, preset: ShapePreset | "table", p: Pt): Pt {
    const snaps = preset === "line" || preset === "arrow" || preset === "rect";
    if (!snaps || !this.snapNear(box, p.x, p.y)) {
      this.showSnapMarker(null, null);
      return p;
    }
    const hit = this.shapeSnapper.hit;
    this.showSnapMarker(box, hit);
    return { x: hit.x, y: hit.y };
  }

  /**
   * A shape snapped by a hold, moved so that a line's or arrow's start lies
   * on another shape's point when it began near one (the start is where
   * the held shape turns about, so it is placed now or not at all).
   */
  private snapShapeStart(box: PageBox, kind: ShapeKind, pts: number[]): number[] {
    if (kind !== "line" && kind !== "arrow") return pts;
    if (!this.snapNear(box, pts[0], pts[1])) return pts;
    const hit = this.shapeSnapper.hit;
    this.showSnapMarker(box, hit);
    return translatePoints(pts, hit.x - pts[0], hit.y - pts[1]);
  }

  /**
   * The held shape following the pen at `pen`, turned and sized about its
   * pivot, with the corner or far end nearest another shape's point carried
   * onto it: the pen position that does that is solved exactly
   * (`penForPoint`), so the shape stays the shape. Circles and ellipses
   * have no corners to snap.
   */
  private snapHeldShape(
    box: PageBox,
    snap: { kind: ShapeKind; base: number[]; pivot: Pt; from: Pt },
    pen: Pt,
  ): number[] {
    const pts = transformShape(snap.base, snap.pivot, snap.from, pen);
    const open = snap.kind === "line" || snap.kind === "arrow";
    const corners = open ? 2 : snap.base.length / 3 - 1;
    if (snap.kind === "circle" || snap.kind === "ellipse" || corners > 12) {
      this.showSnapMarker(null, null);
      return pts;
    }
    // The far end of a line or arrow (its start is the pivot), or each corner.
    let best = Infinity;
    let vertex = -1;
    let tx = 0;
    let ty = 0;
    for (let i = open ? 1 : 0; i < corners; i++) {
      const x = pts[i * 3];
      const y = pts[i * 3 + 1];
      if (!this.snapNear(box, x, y)) continue;
      const hit = this.shapeSnapper.hit;
      const d = Math.hypot(hit.x - x, hit.y - y);
      if (d < best) {
        best = d;
        vertex = i;
        tx = hit.x;
        ty = hit.y;
      }
    }
    if (vertex < 0) {
      this.showSnapMarker(null, null);
      return pts;
    }
    const v0 = { x: snap.base[vertex * 3], y: snap.base[vertex * 3 + 1] };
    const target = { x: tx, y: ty };
    const at = penForPoint(snap.pivot, snap.from, v0, target);
    if (!at) return pts;
    this.showSnapMarker(box, target);
    return transformShape(snap.base, snap.pivot, snap.from, at);
  }

  /** Show the snap ring at page point `at` of `box`, or hide it (`null`). */
  private showSnapMarker(box: PageBox | null, at: { x: number; y: number } | null): void {
    this.snapShown = box !== null && at !== null;
    if (!box || !at) {
      this.snapMarkerEl?.addClass("is-hidden");
      return;
    }
    const el = (this.snapMarkerEl ??= this.paperEl.createDiv({
      cls: "goodobsidian-snap-marker is-hidden",
    }));
    const scale = this.unitScale;
    el.setCssStyles({ left: `${(box.x + at.x) * scale}px`, top: `${(box.y + at.y) * scale}px` });
    el.removeClass("is-hidden");
  }

  // --- Shape tool presets ------------------------------------------------------

  /**
   * Where a preset dragged out on `box` may reach, in its page space: the
   * page, or with the pages joined every page, so a shape can run over the
   * join (and is stored on each page it reaches, as ink is).
   */
  private shapeRoom(box: PageBox): Bounds {
    const boxes = this.joined && !this.board ? this.pageLayout.boxes : [box];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const b of boxes) {
      minX = Math.min(minX, b.x - box.x);
      minY = Math.min(minY, b.y - box.y);
      maxX = Math.max(maxX, b.x - box.x + b.width);
      maxY = Math.max(maxY, b.y - box.y + b.height);
    }
    return { minX, minY, maxX, maxY };
  }

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
      const aspect = preset === "star" ? STAR_ASPECT : preset === "heart" ? HEART_ASPECT : 1;
      const halfH = connector ? 0 : halfW * aspect;
      const cx = clamp(origin.x, halfW, Math.max(halfW, box.width - halfW));
      const cy = clamp(origin.y, halfH, Math.max(halfH, box.height - halfH));
      origin = { x: cx - halfW, y: cy - halfH };
      to = { x: cx + halfW, y: cy + halfH };
    }
    // An end that snapped to another shape's point is not levelled off it.
    const rise = drag.snapped === true ? 0 : this.atFitZoom(LINE_LEVEL_RISE);
    return presetGeometry(preset, origin, to, FALLBACK_PRESSURE, rise);
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
    // Fitted into the page, or with the pages joined into all of them: a
    // table may be drawn over the join. Worked out from the room's corner.
    const room = this.shapeRoom(box);
    const at = (p: Pt): Pt => ({ x: p.x - room.minX, y: p.y - room.minY });
    const page = { width: room.maxX - room.minX, height: room.maxY - room.minY };
    const fitted = drag.moved
      ? draggedTableBox(at(drag.origin), at(drag.to), size, page, this.atFitZoom(1))
      : tappedTableBox(at(drag.origin), size, page, this.atFitZoom(1));
    const back = (p: Pt): Pt => ({ x: p.x + room.minX, y: p.y + room.minY });
    return tableStrokes(back(fitted.from), back(fitted.to), size, FALLBACK_PRESSURE);
  }

  private showShapeDraft(box: PageBox): void {
    const drag = this.shapeDrag;
    if (!drag) return;
    if (drag.preset === "table") {
      const strokes = this.tableDragStrokes(box).map((part) => part.pts);
      if (strokes.length === 0) {
        this.renderer?.clearWet();
        this.requestZoomPaint();
      } else {
        this.renderer?.renderWetMany(box.index, strokes, this.tableStyle());
        this.requestZoomPaint();
      }
      return;
    }
    // While dragging, preview the real size — even a tiny one; the tap
    // default only applies if the pen lifts without having moved.
    const rise = drag.snapped === true ? 0 : this.atFitZoom(LINE_LEVEL_RISE);
    const pts = presetGeometry(drag.preset, drag.origin, drag.to, FALLBACK_PRESSURE, rise);
    if (pts.length === 0) {
      this.renderer?.clearWet();
      this.requestZoomPaint();
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
    this.showSnapMarker(null, null);
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
   * Place a table: one element (`model/table`), its rows, columns and typed
   * cells drawn under the ink, so a cell can be written in by hand or typed
   * in with the Text tool. The drag's strokes only showed where it goes.
   * One undo step.
   */
  private commitTable(box: PageBox, page: Page, parts: readonly TableStroke[]): void {
    const outline = parts[0];
    if (!outline || outline.pts.length < 9) return;
    const xs = outline.pts.filter((_, i) => i % 3 === 0);
    const ys = outline.pts.filter((_, i) => i % 3 === 1);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const size = tableSizeFor(this.toolState);
    const table = makeTable({
      id: nextTableId(this.doc),
      x,
      y,
      w: Math.max(...xs) - x,
      h: Math.max(...ys) - y,
      rows: size.rows,
      cols: size.cols,
      color: this.tableStyle().color,
      // The Text tool's colour and font: typed cells read as typed text.
      textColor: (this.toolState.textStyle ?? DEFAULT_TEXT_STYLE).color,
      header: this.toolState.tableHeader === true,
    });
    this.history.push(this.doc, new AddTable(page.id, table));
    this.renderer?.invalidateRegion(box.index, {
      minX: x - table.size,
      minY: y - table.size,
      maxX: x + (Math.max(...xs) - x) + table.size,
      maxY: y + (Math.max(...ys) - y) + table.size,
    });
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
    const selection = layout ? selectText(layout, at, at, this.atFitZoom(TEXT_SNAP_SLOP_PX)) : null;
    this.noteTextMark(box.index, layout, selection);
    if (!layout || !selection) return false;
    // Not the carry-on of a stroke just lifted: this is no handwriting.
    this.lastLift = null;
    this.textMark = { layout, from: at, selection };
    this.showTextMark(box);
    return true;
  }

  /** Say on the debug overlay what the highlighter did where it came down. */
  private noteTextMark(
    index: number,
    layout: TextLayout | null,
    selection: TextSelection | null,
  ): void {
    if (!this.debug) return;
    const page = this.pageAt(index);
    this.hudTextMark =
      page?.backdrop.kind !== "pdf"
        ? "not a PDF page"
        : !this.textSource
          ? "no text source"
          : textMarkNote(layout, selection);
    this.scheduleHud();
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
    this.requestZoomPaint();
  }

  /** Let go of a text highlight being dragged, keeping nothing (the tool changed under it). */
  private dropTextMark(): void {
    if (!this.textMark) return;
    this.textMark = null;
    this.renderer?.clearWet();
    this.requestZoomPaint();
  }

  /** The pen lifted from a text highlight: add it, one stroke a line, as one undo step. */
  private finishTextMark(box: PageBox): void {
    const mark = this.textMark;
    this.textMark = null;
    this.activePage = null;
    this.renderer?.clearWet();
    this.requestZoomPaint();
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
    this.placeToasts();
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
    // What the last pen events changed waits for the next frame: counted in
    // with the rest, so it is painted again too.
    this.flushEraseDirty();
    this.eraseIds = new Set();
    this.eraseGrey = false;
    this.eraseGreyCuts = new Map();
    this.erasePieces = new Map();
    this.eraseLast = null;
    this.eraseRuled = new Map();
    this.eraseMirrors = null;
    this.eraseDirty.clear();
    this.eraseCuts = new Map();
    this.eraseCutSeen = new Set();
    // Whatever the preview touched is drawn from the document again.
    const preview = this.erasePreview;
    this.erasePreview = new Map();
    for (const [index, areas] of preview) {
      for (const bounds of areas) this.renderer?.invalidateRegion(index, bounds);
    }
    this.eraserCursorEl.addClass("is-hidden");
  }

  /**
   * The eraser's diameter in page px: its chosen size on the paper, whatever
   * the zoom, as a pen's width is (Joost, 2026-10-25: a size that changed
   * with the zoom could not be judged). Zoomed in it shows larger on screen,
   * and covers what its mark and its mm say. It was a screen size until then.
   */
  private eraserSize(): number {
    return eraserSizeFor(this.toolState);
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
    const first = this.eraseLast === null;
    // Whole stroke and By line grey what they take, as Notability does.
    if (first) {
      const lined = mode === "ruled" && this.ruledFor(page, sample, filter, true) !== null;
      this.eraseGrey = erasesGrey(mode, lined, this.toolState.eraserGrey === true);
    }
    const whole = mode === "stroke";
    // With the pages joined the eraser goes on over the join: the pages
    // beside this one have ink here too (their own, running over), and
    // only owners are erased (`canvas/mirrors.ts`); their mirrors follow.
    const targets = this.eraseTargets(box);

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
      for (const target of targets) {
        const onPage = this.pageAt(target.index);
        if (!onPage) continue;
        const local = { x: at.x + box.x - target.x, y: at.y + box.y - target.y };
        const ruled = mode === "ruled" ? this.ruledFor(onPage, local, filter, false) : null;
        const hit = ruled
          ? this.eraseRuledAt(onPage, ruled, local, radius)
          : whole
            ? this.eraseWholeAt(onPage, local, radius, filter)
            : this.erasePartialAt(onPage, local, radius, filter, target.index);
        if (hit) changed = true;
      }
    }
    return changed;
  }

  /** The pages an eraser on `box` erases: it alone, or with the pages joined, it and its neighbours. */
  private eraseTargets(box: PageBox): PageBox[] {
    if (!this.joined || this.board) return [box];
    const boxes = this.pageLayout.boxes;
    return [boxes[box.index - 1], box, boxes[box.index + 1]].filter(
      (b): b is PageBox => b !== undefined,
    );
  }

  /**
   * The ruled eraser's pass on `page`, started at its first dab there: its
   * lines and its ink read once for the whole pass. A page without lines
   * erases as the standard eraser does; the page the pen went down on
   * says so (`announce`), so the mode never silently does nothing.
   */
  private ruledFor(
    page: Page,
    start: Pt,
    filter: EraserFilter,
    announce: boolean,
  ): RuledEraser | null {
    const known = this.eraseRuled.get(page.id);
    if (known !== undefined) return known;
    const blocks = writingLines(page.backdrop, page.geometry);
    if (blocks.length === 0) {
      if (announce) this.flashReadout("No lines on this page: erasing normally");
      this.eraseRuled.set(page.id, null);
      return null;
    }
    // Only owners: a mirror is erased with its owner (`canvas/mirrors.ts`).
    const ink = this.joined ? page.strokes.filter((stroke) => !isMirror(stroke)) : page.strokes;
    const ruled = new RuledEraser(blocks, ink, start, page.geometry.width, filter);
    this.eraseRuled.set(page.id, ruled);
    return ruled;
  }

  /**
   * Ruled mode: whole words on the line under the eraser, as far along it
   * as the pass goes (`ruled-ink.ts`), marked to go when the pen lifts; a
   * highlight, a shape or a stroke across lines is cut to what lies off the
   * erased stretch, as the standard eraser cuts.
   */
  private eraseRuledAt(page: Page, ruled: RuledEraser, at: Pt, radius: number): boolean {
    const dabbed = ruled.dab(at, radius);
    // Ink a sticky note hides, or a note's ink off its note, is not touched.
    const notes = noteIdsOf(page.images);
    const shown = (id: string): boolean => {
      const stroke = this.strokeIndex.get(id);
      return stroke !== undefined && shownAt(page, stroke, at.x, at.y, notes);
    };
    const taken = [...dabbed.taken].filter(shown);
    const cut = [...dabbed.cut].filter(shown);
    let changed = false;
    for (const id of taken) changed = this.markWhole(page, id) || changed;
    if (cut.length === 0) return changed;
    const regions = ruled.regions();
    const nextId = (): string => this.strokeIds.next();
    for (const id of cut) {
      const original = this.strokeIndex.get(id);
      if (!original || this.eraseIds.has(id)) continue;
      // Each dab cuts the original by every stretch so far, so pieces never
      // pile up cut upon cut.
      const pieces = eraseRectsFromStroke(original, regions, nextId);
      if (pieces === null) continue;
      // A linked word is never cut: touching it takes all of it. Nor is a
      // cover tape: a strip of paper comes off whole.
      if (isLinked(page, id) || isTape(original)) {
        changed = this.markWhole(page, id) || changed;
        continue;
      }
      this.erasePieces.set(id, pieces);
      if (this.eraseGrey) this.eraseGreyCuts.set(id, erasedPieces(original, regions));
      this.eraseDirty.add(id);
      changed = true;
    }
    return changed;
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
      this.eraseGreyCuts.delete(each);
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
    const notes = noteIdsOf(page.images);
    for (const id of this.strokeIndex.near(page.id, at.x, at.y, radius)) {
      const stroke = this.strokeIndex.get(id);
      if (!stroke || this.eraseIds.has(id) || !eraserTakes(stroke, filter)) continue;
      // Ink a sticky note hides, or a note's ink off its note, is not touched.
      if (!shownAt(page, stroke, at.x, at.y, notes)) continue;
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
    index: number,
  ): boolean {
    // The cut widens by half the stroke width, so the broad phase must too.
    const reach = radius + MAX_TILTED_HALF_WIDTH;
    const candidates = this.strokeIndex.near(page.id, sample.x, sample.y, reach);
    const nextId = (): string => this.strokeIds.next();
    const notes = noteIdsOf(page.images);
    let changed = false;
    for (const id of candidates) {
      const original = this.strokeIndex.get(id);
      if (!original || this.eraseIds.has(id) || !eraserTakes(original, filter)) continue;
      // Ink a sticky note hides, or a note's ink off its note, is not touched.
      if (!shownAt(page, original, sample.x, sample.y, notes)) continue;
      // A linked word is never cut: touching it takes all of it. Nor is a
      // cover tape: a strip of paper comes off whole.
      if (isLinked(page, id) || isTape(original)) {
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
        // With the pages joined its mirrors change too: painted again whole.
        if (this.joined) this.eraseDirty.add(id);
        else this.noteCut(index, original, sample, radius);
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

  /**
   * The cut strokes, each replaced by what is left of it: one step for each
   * page they are on (with the pages joined, the eraser goes over the join).
   */
  private cutSteps(box: PageBox | null, pieces: ReadonlyMap<string, Stroke[]>): Command[] {
    if (!box) return [];
    const byPage = new Map<string, StrokeReplacement[]>();
    for (const [id, survivors] of pieces) {
      const original = this.strokeIndex.get(id);
      const pageId = this.strokeIndex.pageOf(id);
      if (!original || !pageId) continue;
      const list = byPage.get(pageId) ?? [];
      list.push({ original, pieces: survivors });
      byPage.set(pageId, list);
    }
    return [...byPage].map(
      ([pageId, replacements]) => new ReplaceStrokesOnPage(pageId, replacements),
    );
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
    // Where the scribble began decides what it can see: a sticky note's ink
    // on that note, or the page's ink off any note stuck on.
    const notes = noteIdsOf(page.images);
    for (const id of near) {
      const stroke = this.strokeIndex.get(id);
      if (!stroke || !scribbleMayErase(stroke, gestures.scribbleErasesAll)) continue;
      if (!shownAt(page, stroke, pts[0], pts[1], notes)) continue;
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
   * Scribble to fill, with a switch of its own beside Scribble to erase: a
   * scribble that erased nothing, drawn inside a closed outline, fills that
   * region with the pen's colour and is not kept. Only when the region holds
   * the scribble (nearly all of its points) and the scribble covers a fair
   * share of it; anything else stays ink, as before.
   */
  private scribbleFill(box: PageBox, pts: number[]): boolean {
    const gestures = penGesturesOf(this.toolState.penGestures);
    if (!gestures.scribbleFill || this.toolState.tool !== "pen" || this.practice) return false;
    const scribble = detectScribble(pts, { minSize: this.atFitZoom(SCRIBBLE_MIN_PX) });
    if (!scribble) return false;
    const b = scribble.bounds;
    const accept = (outline: number[], area: number): boolean => {
      let inside = 0;
      let count = 0;
      for (let i = 0; i + 1 < pts.length; i += POINT_STRIDE) {
        count++;
        if (insidePolygon(outline, pts[i], pts[i + 1])) inside++;
      }
      const covered = (b.maxX - b.minX) * (b.maxY - b.minY);
      return inside >= SCRIBBLE_FILL_INSIDE * count && covered >= SCRIBBLE_FILL_SHARE * area;
    };
    // From its middle, or, if writing lies there, from where the pen started.
    const starts = [
      { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 },
      { x: pts[0], y: pts[1] },
    ];
    const { color } = this.currentStyle();
    return starts.some(({ x, y }) => this.fillAt(box, x, y, color, true, accept));
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
    return this.lassoed(page, loop, except);
  }

  /**
   * What `loop` (page space) encloses on `page`, as far as the lasso's
   * switches allow; never `except`. With the pages joined, owners only: a
   * mirror is picked up as its owner (`selectInside`).
   */
  private lassoed(page: Page, loop: readonly number[], except?: Stroke): ElementLists {
    const poly = polygonOf(loop);
    if (!poly) return { strokes: [], images: [], textBoxes: [], tables: [], graphs: [] };
    const filter = lassoFilterFor(this.toolState);
    const anyPart = this.callbacks.lassoAnyPart?.() !== false;
    const near = this.strokeIndex.within(page.id, poly.bounds);
    const own = <T extends { join?: string }>(list: readonly T[]): T[] =>
      this.joined ? list.filter((element) => !isMirror(element)) : [...list];
    return {
      strokes: page.strokes.filter(
        (stroke) =>
          stroke !== except &&
          near.has(stroke.id) &&
          lassoTakesStroke(stroke, filter) &&
          strokeInLasso(stroke, poly, anyPart) &&
          !foldedAway(page, stroke),
      ),
      // A locked picture is never picked up (until it is unlocked), nor a
      // folded note (until it is opened).
      images: filter.images
        ? own(page.images).filter(
            (image) => image.locked !== true && !isFolded(image) && boxInLasso(image, poly),
          )
        : [],
      // A note's text comes with its note (`select`), never on its own.
      textBoxes: filter.textBoxes
        ? own(page.textBoxes).filter(
            (textBox) =>
              noteOfText(page, textBox) === null &&
              boxInLasso(this.textBoxFrameOf(page.id, textBox), poly),
          )
        : [],
      tables: filter.tables
        ? own(page.tables ?? []).filter((table) => boxInLasso(this.tableFrameOf(table), poly))
        : [],
      graphs: filter.graphs
        ? own(page.graphs ?? []).filter((graph) => boxInLasso(graphFrame(graph), poly))
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
    const reach = candidate.stroke.size / 2 + CIRCLE_HOLD_TOLERANCE_PX / this.gestureScale;
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
    const { stroke } = candidate;
    const mirrors = this.strokeMirrors(page.id, stroke.id);
    if (!this.history.withdraw(this.doc, candidate.command)) return;
    this.strokeIndex.remove(stroke.id, page.id);
    this.repaintMirrors(mirrors);
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

  /**
   * The "One item" lasso went down: it takes what is on top there, as a
   * lasso tap would, and that one thing follows the pen until it lifts. On
   * empty paper nothing is selected and nothing is drawn; held still, the
   * pen opens the Paste / Unlock bar, as the other lassos' do.
   */
  private pickStart(box: PageBox, at: Pt): void {
    this.tapSelect(box, at, PEN_TAP_TOLERANCE_PX);
    const sel = this.liveSelection();
    const bounds = sel ? this.groupBounds(sel) : null;
    if (!sel || !bounds || this.callbacks.isLocked?.()) {
      this.picking = { box, at, dragging: false };
      if (!sel) this.startPress(() => this.openPressMenu(box, at));
      return;
    }
    this.groupDrag = {
      pointerId: -1,
      selection: sel,
      bounds,
      from: at,
      clientX: 0,
      clientY: 0,
      dx: 0,
      dy: 0,
      scale: null,
      turn: null,
      lifted: false,
    };
    this.picking = { box, at, dragging: true };
  }

  /** The "One item" pen moved: what it picked up follows, past the frame's slop. */
  private pickMove(box: PageBox, samples: readonly PointerSample[]): void {
    const pick = this.picking;
    const last = samples[samples.length - 1];
    if (!pick || !last) return;
    const p = this.toPage(box, last);
    if (Math.hypot(p.x - pick.at.x, p.y - pick.at.y) * this.gestureScale > TAP_SLOP_PX) {
      this.stopPress();
    }
    if (pick.dragging) this.dragCircleSelection(box, p);
  }

  /** It lifted: a move is one step; a tap leaves the one thing selected, with its frame. */
  private pickEnd(): void {
    const pick = this.picking;
    this.picking = null;
    this.stopPress();
    // Only a move commits: a tap on a table must select it, not type in a
    // cell, as the frame's own tap would on a second press.
    if (pick?.dragging) this.endGroupDrag(this.groupDrag?.lifted === true);
    this.activePage = null;
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
    const room = this.joined && !this.board ? this.shapeRoom(box) : undefined;
    const path = new LassoPath(box, LASSO_SPACING_PX / this.gestureScale, undefined, room);
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
    const scale = this.gestureScale;
    const moved = Math.hypot(last.x - lasso.origin.x, last.y - lasso.origin.y) * scale;
    if (moved > TAP_SLOP_PX) this.stopPress();
    if (lasso.mode === "freehand") for (const sample of samples) lasso.path.add(sample);
    lasso.to = { x: last.x, y: last.y };
    if (lasso.space) {
      this.dragSpace(lasso, lasso.space);
      return;
    }
    const loop = this.lassoLoop(lasso);
    // Drawn rounded off and open, as Goodnotes draws it; taken on the loop as drawn.
    const freehand = lasso.mode === "freehand";
    this.renderer?.renderLasso(lasso.box.index, freehand ? smoothPath(loop) : loop, !freehand);
    this.requestZoomPaint();
  }

  /** The lasso's pen stayed put long enough: open the tap-and-hold bar where it is. */
  private lassoHeld(): void {
    const lasso = this.lasso;
    if (!lasso) return;
    lasso.held = true;
    this.renderer?.clearWet();
    this.requestZoomPaint();
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
      lastPenAt: this.lastPenAt(),
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
    const top = topImageAt(page.images, p, PEN_TAP_TOLERANCE_PX / this.gestureScale);
    this.pressMenu = {
      pageId: page.id,
      at: { x: p.x, y: p.y },
      locked: top?.locked === true ? top : null,
      ink: this.strokeAt(page, p, PEN_TAP_TOLERANCE_PX / this.gestureScale),
      provisional,
    };
    this.syncActionBar();
  }

  private lassoLoop(lasso: LassoDraft): readonly number[] {
    if (lasso.mode === "lines") {
      const span = this.lassoSpan(lasso);
      return span ? spanOutline(lasso.lines[span.block], span) : [];
    }
    if (lasso.mode !== "rect") return lasso.path.points;
    const room = this.joined && !this.board ? this.shapeRoom(lasso.box) : undefined;
    return rectLoop(lasso.origin, lasso.to, lasso.box, room);
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
      this.requestZoomPaint();
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
    this.requestZoomPaint();
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
    const loop = this.lassoLoop(lasso);
    const poly = polygonOf(loop);
    const b = poly?.bounds;
    // A by-line span is a line tall from the start: only the pen's travel says it was drawn.
    const extent =
      lasso.mode === "lines"
        ? Math.hypot(lasso.to.x - lasso.origin.x, lasso.to.y - lasso.origin.y) * this.gestureScale
        : b
          ? Math.max(b.maxX - b.minX, b.maxY - b.minY) * this.gestureScale
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
    this.selectInside(lasso.box, loop);
    if (!this.liveSelection()) {
      // Round nothing: the loop stays a moment, with a Screenshot button.
      this.showEmptyLasso(lasso.box, lasso.mode === "rect" ? loop : smoothPath(loop), lasso.to);
      return;
    }
    if (lasso.mode !== "rect") this.keepOutline(smoothPath(this.lassoLoop(lasso)));
  }

  /**
   * A lasso drawn round nothing, as Goodnotes leaves it (Joost's recording,
   * 2026-10-30): the closed loop stays on the page with a Screenshot button
   * by where the pen lifted, for a moment, then both fade. The button takes
   * the patch of page inside the loop's bounds, paper and PDF included.
   * The next press, a scroll or a zoom takes it away at once.
   */
  private showEmptyLasso(box: PageBox, loop: readonly number[], end: Pt): void {
    this.dropEmptyLasso();
    const bounds = polygonOf(loop)?.bounds;
    if (!bounds || loop.length < 6) return;
    const scale = this.unitScale;
    const el = this.selectionUiEl.createDiv({ cls: "goodobsidian-empty-lasso" });
    const svg = activeDocument.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "goodobsidian-selection-outline");
    svg.setAttribute("aria-hidden", "true");
    const at = (v: number, origin: number): string => ((origin + v) * scale).toFixed(1);
    let d = `M${at(loop[0], box.x)} ${at(loop[1], box.y)}`;
    for (let i = 2; i + 1 < loop.length; i += 2)
      d += `L${at(loop[i], box.x)} ${at(loop[i + 1], box.y)}`;
    const path = activeDocument.createElementNS(SVG_NS, "path");
    path.setAttribute("d", `${d}Z`);
    svg.append(path);
    el.append(svg);
    const shoot = this.callbacks.onRegionScreenshot;
    if (shoot) {
      const pill = el.createDiv({ cls: "goodobsidian-empty-lasso-pill theme-dark" });
      pill.setCssStyles({
        left: `${((box.x + end.x) * scale + EMPTY_LASSO_PILL_OFFSET_PX).toFixed(1)}px`,
        top: `${((box.y + end.y) * scale + EMPTY_LASSO_PILL_OFFSET_PX).toFixed(1)}px`,
      });
      const button = pill.createEl("button", {
        cls: "goodobsidian-empty-lasso-shot clickable-icon",
        attr: { "aria-label": "Screenshot" },
      });
      iconInto(button, "camera", "");
      onTap(button, () => {
        this.dropEmptyLasso();
        shoot(box.index, bounds);
      });
    }
    const win = this.surfaceEl.ownerDocument.defaultView ?? window;
    this.emptyLasso = {
      el,
      timers: [
        win.setTimeout(() => el.addClass("is-fading"), EMPTY_LASSO_MS),
        // A timer, not the transition's end: the browser pane can hold that back.
        win.setTimeout(() => this.dropEmptyLasso(), EMPTY_LASSO_MS + EMPTY_LASSO_FADE_MS),
      ],
    };
  }

  /** Take an empty lasso's loop and button away (`showEmptyLasso`). */
  private dropEmptyLasso(): void {
    const shown = this.emptyLasso;
    if (!shown) return;
    this.emptyLasso = null;
    const win = this.surfaceEl.ownerDocument.defaultView ?? window;
    for (const timer of shown.timers) win.clearTimeout(timer);
    shown.el.remove();
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
      tables: filter.tables
        ? (page.tables ?? []).filter((table) => framed(frameBounds(this.tableFrameOf(table))))
        : [],
      graphs: filter.graphs
        ? (page.graphs ?? []).filter((graph) => framed(frameBounds(graphFrame(graph))))
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
      count: selectedCount(sel),
    };
    this.syncSelectionOverlay();
  }

  /** Select what the lasso encloses on its page, as far as its switches allow. */
  private selectInside(box: PageBox, loop: readonly number[]): void {
    const page = this.pageAt(box.index);
    if (!page) return;
    // A new selection: what an earlier one picked up and left unused goes back.
    this.clearSelection();
    const lists = this.lassoed(page, loop);
    let picked: MoveToPage | null = null;
    // With the pages joined a loop may reach over the join: what it encloses
    // on the page beside this one comes onto this page (nothing moves on
    // screen), as part of whatever the selection does next.
    if (this.joined && !this.board) {
      for (const other of this.eraseTargets(box)) {
        if (other === box) continue;
        const otherPage = this.pageAt(other.index);
        if (!otherPage) continue;
        const moved = loop.map((v, i) => v + (i % 2 === 0 ? box.x - other.x : box.y - other.y));
        const found = this.lassoed(otherPage, moved);
        if (isEmptySelection(found)) continue;
        picked = this.pickUpOverJoin(other, otherPage, box, page, found);
        lists.strokes.push(...picked.movedOf("strokes"));
        lists.images.push(...picked.movedOf("images"));
        lists.textBoxes.push(...picked.movedOf("textBoxes"));
        (lists.tables ??= []).push(...picked.movedOf("tables"));
        (lists.graphs ??= []).push(...picked.movedOf("graphs"));
      }
    }
    this.select(page.id, lists);
    // Kept to take back if the selection goes unused (`dropPickUp`).
    if (picked && this.selection) this.pickUp = picked;
    else if (picked) this.dropPickUpOf(picked);
  }

  /**
   * Move what a lasso found on page `fromPage` onto `toPage` (`MoveToPage`),
   * with the ink on any sticky note among it, and return it as it now is
   * there. The step joins the selection's next one; letting go without
   * doing anything takes it back (`dropPickUp`).
   */
  private pickUpOverJoin(
    from: PageBox,
    fromPage: Page,
    to: PageBox,
    toPage: Page,
    found: ElementLists,
  ): MoveToPage {
    const withInk = withNoteInk(fromPage, { strokes: found.strokes, images: found.images });
    const ids = (list: ReadonlyArray<{ id: string }> | undefined): string[] =>
      (list ?? []).map((element) => element.id);
    const move = new MoveToPage(fromPage.id, toPage.id, from, to, {
      strokes: ids(withInk),
      images: ids(found.images),
      textBoxes: ids(found.textBoxes),
      tables: ids(found.tables),
      graphs: ids(found.graphs),
    });
    this.history.push(this.doc, move);
    this.strokeIndex.refreshPages(this.doc.pages, [fromPage.id, toPage.id]);
    this.renderer?.invalidateAll();
    this.syncTextBoxes();
    this.changed([fromPage.id, toPage.id]);
    return move;
  }

  /** The last pick-up over a join, while it may still be taken back unused. */
  private pickUp: MoveToPage | null = null;

  /**
   * The selection was let go: if nothing was done with what a lasso picked
   * up over a join, put it back on its page, leaving no step behind.
   */
  private dropPickUp(): void {
    const move = this.pickUp;
    this.pickUp = null;
    if (move) this.dropPickUpOf(move);
  }

  /** Take back pick-up `move` if it is still the newest step, unused. */
  private dropPickUpOf(move: MoveToPage): void {
    if (!this.history.isLatest(move)) return;
    if (!this.history.withdraw(this.doc, move)) return;
    this.strokeIndex.refreshPages(this.doc.pages, [move.fromPageId, move.toPageId]);
    this.renderer?.invalidateAll();
    this.syncTextBoxes();
    this.mirroredStep = this.history.latest;
    this.changed([move.fromPageId, move.toPageId]);
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
    const tolerance = tolerancePx / this.gestureScale;
    const filter = lassoFilterFor(this.toolState);
    if (this.tapSelectOn(page, p, tolerance, filter)) return;
    // With the pages joined, what shows here may be the page beside's,
    // running over the join: its owner is picked up, where it is.
    for (const other of this.joined ? this.eraseTargets(box) : []) {
      const otherPage = other === box ? null : this.pageAt(other.index);
      const q = { x: p.x + box.x - other.x, y: p.y + box.y - other.y };
      if (otherPage && this.tapSelectOn(otherPage, q, tolerance, filter)) return;
    }
  }

  /** Select what a tap at page point `p` lands on, on `page`; whether anything was. */
  private tapSelectOn(page: Page, p: Pt, tolerance: number, filter: LassoFilter): boolean {
    if (filter.textBoxes) {
      // A note's text is picked up with its note, below.
      const shown = page.textBoxes.filter(
        (t) => !(this.joined && isMirror(t)) && noteOfText(page, t) === null,
      );
      const frames = shown.map((textBox) => ({
        textBox,
        ...this.textBoxFrameOf(page.id, textBox),
      }));
      const hit = topImageAt(frames, p, tolerance);
      const view = hit ? this.textBoxInputs.get(`${page.id}:${hit.textBox.id}`) : undefined;
      if (hit && view && !this.callbacks.isLocked?.()) {
        // GoodNotes: the lasso edits text. A tap selects the box with its
        // text options beside it; a second tap types, the lasso in hand.
        this.holdTextBox(view, null, true);
        return true;
      }
      if (hit) {
        this.select(page.id, { strokes: [], images: [], textBoxes: [hit.textBox] });
        return true;
      }
    }
    const stroke = this.strokeAt(page, p, tolerance, filter);
    if (stroke) {
      this.select(page.id, { strokes: [stroke], images: [], textBoxes: [] });
      return true;
    }
    // A graph lies under the ink and over the tables; it is picked up on its own.
    const graph = filter.graphs ? this.ownGraphAt(page, p) : null;
    if (graph) {
      this.select(page.id, { strokes: [], images: [], textBoxes: [], graphs: [graph] });
      return true;
    }
    // A table lies under the ink and over the pictures. It is picked up with
    // the handwriting in its cells, which stays ink of its own but goes
    // where the table goes.
    const table = filter.tables ? this.tableAt(page, p)?.table : undefined;
    if (table) {
      this.select(page.id, this.tableWithInk(page, table, filter));
      return true;
    }
    // A locked picture is passed over, as if it were part of the paper; a
    // mirror is picked up as its owner, from its own page.
    const unlocked = page.images.filter(
      (candidate) =>
        candidate.locked !== true && !isFolded(candidate) && !(this.joined && isMirror(candidate)),
    );
    const image = filter.images ? topImageAt(unlocked, p, tolerance) : null;
    if (image) this.setImageSelection(page.id, image);
    return image !== null;
  }

  /** The topmost graph at `p` that is not a mirror of another page's (with the pages joined). */
  private ownGraphAt(page: Page, p: Pt): GraphElement | null {
    if (!this.joined) return graphAt(page, p);
    return graphAt({ ...page, graphs: (page.graphs ?? []).filter((g) => !isMirror(g)) }, p);
  }

  /** A table with the ink that lies wholly inside its frame, as far as the lasso's switches allow. */
  private tableWithInk(page: Page, table: TableElement, filter: LassoFilter): ElementLists {
    const f = this.tableFrameOf(table);
    const frame: Bounds = { minX: f.x, minY: f.y, maxX: f.x + f.w, maxY: f.y + f.h };
    const near = this.strokeIndex.within(page.id, frame);
    const inked = page.strokes.filter((stroke) => {
      const b = near.has(stroke.id) ? strokeBounds(stroke) : null;
      return (
        b !== null &&
        lassoTakesStroke(stroke, filter) &&
        b.minX >= frame.minX &&
        b.minY >= frame.minY &&
        b.maxX <= frame.maxX &&
        b.maxY <= frame.maxY
      );
    });
    return { strokes: inked, images: [], textBoxes: [], tables: [table] };
  }

  // --- The format painter --------------------------------------------------------

  /**
   * Copy the look of `strokes` (the one most of them share,
   * `dominantInkStyle`) and arm the format painter: the selection goes, and
   * each Pencil or mouse sweep over ink from now on lays that look on what
   * it touches, one undo step a sweep, until another tool is picked.
   */
  private copyStyle(strokes: readonly Stroke[]): void {
    const style = dominantInkStyle(strokes);
    if (!style) return;
    this.clearSelection();
    this.formatPainter ??= new FormatPainter({
      input: this.scrollEl,
      layer: this.surfaceEl,
      paintAlong: (x0, y0, x1, y1) => this.paintAlong(x0, y0, x1, y1),
      finish: () => this.finishPaint(),
    });
    this.formatPainter.arm(style);
  }

  /**
   * Lay the copied look on every stroke the sweep from one client point to
   * the next passes over, on the page under its end: painted at once, its
   * tiles repaired on the next frame. Only owners are painted (the stroke
   * index leaves mirrors out), and only ink that shows there: a sticky
   * note hides what is under it.
   */
  private paintAlong(x0: number, y0: number, x1: number, y1: number): void {
    const style = this.formatPainter?.style;
    if (!style || this.callbacks.isLocked?.()) return;
    const end = this.toLayout(x1, y1);
    const box = boxAtPoint(this.pageLayout, end.x, end.y);
    const page = box ? this.pageAt(box.index) : null;
    if (!box || !page) return;
    const from = this.toPage(box, this.toLayout(x0, y0));
    const to = this.toPage(box, end);
    const reach = PAINT_REACH_PX / this.unitScale;
    const sweep = (this.paintSweep ??= new PaintStyle(style));
    const notes = noteIdsOf(page.images);
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / reach));
    let painted = false;
    for (let i = 0; i <= steps; i++) {
      const x = from.x + ((to.x - from.x) * i) / steps;
      const y = from.y + ((to.y - from.y) * i) / steps;
      for (const id of this.strokeIndex.near(page.id, x, y, reach + MAX_STROKE_HALF_WIDTH)) {
        const stroke = this.strokeIndex.get(id);
        if (!stroke || !shownAt(page, stroke, x, y, notes)) continue;
        const hit =
          strokeHitByPoint(stroke, x, y, stroke.size / 2 + reach) || strokeFillHit(stroke, x, y);
        if (!hit) continue;
        const before = elementBounds("strokes", stroke);
        if (!sweep.paint(this.doc, page.id, stroke)) continue;
        const after = elementBounds("strokes", stroke);
        const dirty = before && after ? unionBounds(before, after) : (before ?? after);
        // A colour or width is not part of a stroke's cached outline: re-rasterise.
        if (dirty) this.renderer?.invalidateRegion(box.index, dirty);
        painted = true;
      }
    }
    if (painted) this.requestFrame();
  }

  /**
   * The sweep has lifted: what it painted becomes one undo step. The live
   * paint is taken back and pushed as the command, which paints it again.
   */
  private finishPaint(): void {
    const sweep = this.paintSweep;
    this.paintSweep = null;
    if (!sweep?.changed) return;
    sweep.invert(this.doc);
    this.history.push(this.doc, sweep);
    const pages = sweep.pageIds;
    // A width changes where a stroke reaches: the index learns it.
    this.strokeIndex.refreshPages(this.doc.pages, pages);
    this.inkChanged(pages);
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
      if (stroke.onSticky !== undefined && foldedAway(page, stroke)) continue;
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
    const stroke = this.strokeAt(page, p, tolerancePx / this.gestureScale);
    return stroke !== null && handler(page, stroke);
  }

  /**
   * Make a selection on one page: nothing, one picture on its own (it keeps
   * its resize and rotate handles), or the group frame for anything else.
   */
  private select(pageId: string, elements: ElementLists): void {
    this.clearSelection();
    this.deselectImage();
    const { textBoxes } = elements;
    const tables = elements.tables ?? [];
    const graphs = elements.graphs ?? [];
    const images = elements.images.filter((image) => image.locked !== true);
    // A sticky note never goes anywhere without its ink.
    const page = images.some((image) => image.sticky)
      ? this.doc.pages.find((candidate) => candidate.id === pageId)
      : undefined;
    const strokes = page
      ? withNoteInk(page, { strokes: elements.strokes, images })
      : elements.strokes;
    if (isEmptySelection({ strokes, images, textBoxes, tables, graphs })) return;
    if (this.toolState.tool === "select") this.selectionToolUsed = true;
    if (
      textBoxes.length === 0 &&
      tables.length === 0 &&
      graphs.length === 0 &&
      images.length === 1 &&
      (strokes.length === 0 || loneNote({ strokes, images }) !== null)
    ) {
      this.setImageSelection(pageId, images[0]);
      return;
    }
    // So does its typed text.
    const withText = page ? withNoteText(page, { textBoxes, images }) : textBoxes;
    // A box being typed in stops being edited before it can be moved.
    const editing = this.editingTextView();
    const live = editing ? this.liveTextBox(editing.pageId, editing.id) : undefined;
    if (live && withText.includes(live)) this.blurTextBox();
    // So does a table being typed in.
    if (this.cellEdit && tables.includes(this.cellEdit.table)) this.endCellEdit(true);
    this.selection = {
      pageId,
      strokes: [...strokes],
      images: [...images],
      textBoxes: [...withText],
      tables: [...tables],
      graphs: [...graphs],
    };
    this.selectionCorners = isLoneShape(this.selection);
    this.shapePointsOn = false;
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
    this.dropPickUp();
    this.cancelGroupDrag();
    this.linkBar = null;
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
    return selectionBounds(sel.strokes, sel.images, [
      ...sel.textBoxes.map((textBox) => this.textBoxFrameOf(sel.pageId, textBox)),
      ...(sel.tables ?? []).map((table) => this.tableFrameOf(table)),
      ...(sel.graphs ?? []).map(graphFrame),
    ]);
  }

  /** How far a lasso drag has carried an element of `pageId`, page px; zero otherwise. */
  private dragShift(pageId: string, textBox: TextBoxElement): Pt {
    const drag = this.groupDrag;
    if (!drag?.lifted || drag.selection.pageId !== pageId) return { x: 0, y: 0 };
    if (!drag.selection.textBoxes.includes(textBox)) return { x: 0, y: 0 };
    const fingers = drag.fingers?.motion;
    if (fingers) {
      // Upright, as under the knob's turn: only its middle goes round.
      const f = this.textBoxFrameOf(pageId, textBox);
      const mid = turnPoint(fingers, { x: f.x + f.w / 2, y: f.y + f.h / 2 });
      return { x: mid.x - f.w / 2 - f.x, y: mid.y - f.h / 2 - f.y };
    }
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
    if (drag.fingers) return turnFrame(drag.bounds, drag.fingers.motion);
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

  /** Whether `sel` is drawn by the lasso's loop that made it (`keepOutline`), not a box. */
  private outlineShown(sel: GroupSelection): boolean {
    const outline = this.selectionOutline;
    return outline !== null && outline.count === selectedCount(sel);
  }

  /** Put the selection's dashed frame where it is (or where a drag has it), and its bar. */
  private syncSelectionOverlay(): void {
    const sel = this.liveSelection();
    const box = sel ? this.boxForPage(sel.pageId) : null;
    const drag = this.groupDrag?.lifted ? this.groupDrag : null;
    const bounds = sel && box ? (drag ? this.draggedBounds(drag) : this.groupBounds(sel)) : null;
    this.selectionFrameEl.toggleClass("is-hidden", !box || !bounds);
    this.selectionFrameEl.toggleClass("no-corners", !this.selectionCorners);
    if (box && bounds) {
      const scale = this.unitScale;
      const pad = this.framePad;
      const x = (box.x + bounds.minX) * scale - pad;
      const y = (box.y + bounds.minY) * scale - pad;
      this.selectionFrameEl.setCssStyles({
        left: `${x}px`,
        top: `${y}px`,
        width: `${(bounds.maxX - bounds.minX) * scale + 2 * pad}px`,
        height: `${(bounds.maxY - bounds.minY) * scale + 2 * pad}px`,
      });
      this.selectionFrameEl.toggleClass("is-dragging", drag !== null);
      // While the knob turns it, the frame turns with the selection about its middle.
      const angle = drag?.fingers?.motion.angle ?? drag?.turn?.angle ?? 0;
      this.selectionFrameEl.setCssStyles({ transform: angle !== 0 ? `rotate(${angle}rad)` : "" });
      // The loop that made the selection, while it is still those elements.
      const outline = this.selectionOutline;
      const shown = outline !== null && sel !== null && this.outlineShown(sel);
      this.selectionFrameEl.toggleClass("has-outline", shown);
      if (shown) {
        // The loop is relative to the bounds' corner, so a resize scales it too.
        const k = drag?.scale?.k ?? 1;
        const at = (v: number): string => (pad + v * k * scale).toFixed(1);
        const pts = outline.loop;
        let d = `M${at(pts[0])} ${at(pts[1])}`;
        for (let i = 2; i + 1 < pts.length; i += 2) d += `L${at(pts[i])} ${at(pts[i + 1])}`;
        this.selectionPathEl.setAttribute("d", `${d}Z`);
      }
    }
    this.syncShapePoints(drag ? null : sel, box);
    this.syncLinkDots(drag ? null : sel, box);
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
    const dragging =
      this.groupDrag?.lifted === true ||
      this.imageDrag?.lifted === true ||
      this.pointDrag?.lifted === true ||
      this.linkDrag?.lifted === true;
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
      clearAbove = clearBelow = this.framePad + IMAGE_CHROME_CLEAR_PX;
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
      this.typeBar?.hide();
      return;
    }
    const scale = this.unitScale;
    const anchor: Bounds = {
      minX: (box.x + bounds.minX) * scale,
      minY: (box.y + bounds.minY) * scale,
      maxX: (box.x + bounds.maxX) * scale,
      maxY: (box.y + bounds.maxY) * scale,
    };
    // A shape a side dot just made: the shapes it can become, in place of the actions.
    if (group && this.linkBarFor(group)) {
      this.actionBar.hide();
      this.showTypeBar(anchor, clearAbove, clearBelow);
      return;
    }
    this.typeBar?.hide();
    this.actionBar.show(anchor, this.visiblePaperRect(), { clearAbove, clearBelow });
  }

  /**
   * What a lasso selection's chrome covers, page space: its bounds, reaching
   * down to the rotate knob (less the frame's pad, which the bar adds back).
   */
  private groupChromeBounds(sel: GroupSelection): Bounds | null {
    const bounds = this.groupBounds(sel);
    if (!bounds) return null;
    // A lasso's loop has no knob until the resize handles are asked for.
    if (this.outlineShown(sel) && !this.selectionCorners) return bounds;
    const scale = this.unitScale;
    const knob = selectionKnobPoint(this.selectionFrameOf(bounds), ROTATE_HANDLE_OFFSET_PX / scale);
    const r = ROTATE_KNOB_RADIUS_PX / scale;
    return { ...bounds, maxY: Math.max(bounds.maxY, knob.y + r - this.framePad / scale) };
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
   * screenshots): the bar is Crop | Cut · Duplicate · Delete · "…". Since
   * 2.5 the menu has Cut · Copy · Duplicate · Paste across the top, as the
   * lasso's does, then Lock image, Crop image, one row each for Arrange
   * (front, back), Flip and Opacity, and Delete at the foot. Front and Back
   * stack the pictures among themselves — ink and text always stay above
   * every picture.
   */
  private imageActions(sel: { pageId: string; image: ImageElement }): SelectionAction[] {
    const page = this.doc.pages.find((candidate) => candidate.id === sel.pageId);
    const can = (to: ImageLayer): boolean =>
      page !== undefined && canReorderImage(page, sel.image, to);
    const actions = this.pictureActions(sel, can);
    const note = sel.image.sticky;
    if (!note) return actions;
    // A sticky note is paper, not a picture: its colour in place of the
    // crop and the opacity, which a note has no use for.
    const pictureOnly = (id: string): boolean =>
      id === "crop" || id === "crop-image" || id.startsWith("opacity-");
    const colour: SelectionAction = {
      id: "note-colour",
      icon: "palette",
      label: "Colour",
      group: "style",
      swatches: {
        colors: STICKY_COLORS.map((choice) => choice.color),
        current: note.color,
        pick: (color) => this.recolorSelectedNote(color),
      },
    };
    // Goodnotes' Collapse: the note folds away to its icon; a tap opens it.
    const fold: SelectionAction = {
      id: "note-fold",
      icon: "minimize-2",
      label: "Fold note",
      group: "style",
      bar: true,
      menu: "none",
      run: () => this.foldSelectedNote(),
    };
    return [
      colour,
      fold,
      ...actions
        .filter((action) => !pictureOnly(action.id))
        .map((action) => (action.id === "lock" ? { ...action, label: "Lock note" } : action)),
    ];
  }

  private pictureActions(
    sel: { pageId: string; image: ImageElement },
    can: (to: ImageLayer) => boolean,
  ): SelectionAction[] {
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
        id: "copy",
        icon: "copy",
        label: "Copy",
        group: "edit",
        menu: "tile",
        run: () => this.copySelection(),
      },
      {
        id: "duplicate",
        icon: "copy-plus",
        label: "Duplicate",
        group: "edit",
        bar: true,
        menu: "tile",
        run: () => this.duplicateSelectedImage(),
      },
      { ...this.pasteAction(sel.pageId), menu: "tile" },
      {
        id: "front",
        icon: "bring-to-front",
        label: "Bring to front",
        group: "arrange",
        segment: "Arrange",
        enabled: can("front"),
        run: () => this.reorderSelectedImage("front"),
      },
      {
        id: "back",
        icon: "send-to-back",
        label: "Send to back",
        group: "arrange",
        segment: "Arrange",
        enabled: can("back"),
        run: () => this.reorderSelectedImage("back"),
      },
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
      ...flipActions((axis) => this.flipSelectedImage(axis), "arrange"),
      {
        id: "in-front",
        icon: "layers",
        label: "In front of ink",
        group: "opacity",
        checked: sel.image.front === true,
        run: () => this.setSelectedImageFront(sel.image.front !== true),
      },
      ...IMAGE_OPACITIES.map((opacity): SelectionAction => ({
        id: `opacity-${opacity}`,
        icon: opacity === 1 ? "circle" : "circle-dashed",
        label: `${Math.round(opacity * 100)} %`,
        group: "opacity",
        segment: "Opacity",
        showLabel: true,
        checked: Math.abs((sel.image.opacity ?? 1) - opacity) < 0.005,
        run: () => this.setSelectedImageOpacity(opacity),
      })),
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
   * The bar for a lasso selection: Cut · Duplicate · Delete · "…". The menu
   * (2.5, redrawn when its shape options reached 22 rows) has Cut · Copy ·
   * Duplicate · Paste across the top, then Screenshot; Colour when it holds ink; one segmented
   * row each for a shape's fill, line, corners and arrows, and for Flip; Turn
   * into ›, which holds what the selection can become; and Delete. What it
   * holds decides the rest (`selectionMenu`): one kind keeps its own options,
   * a mix gets only its ink's colour, and Turn into offers what fits.
   */
  private groupActions(sel: GroupSelection): SelectionAction[] {
    // What it holds decides what the menu offers (`selection-kind.ts`).
    const menu = selectionMenu(selectionKind(sel, this.loneTable(sel) !== null));
    const actions: SelectionAction[] = [
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
        id: "copy",
        icon: "copy",
        label: "Copy",
        group: "edit",
        bar: true,
        menu: "tile",
        run: () => this.copySelection(),
      },
      {
        id: "duplicate",
        icon: "copy-plus",
        label: "Duplicate",
        group: "edit",
        bar: true,
        menu: "tile",
        run: () => this.duplicateSelection(),
      },
      { ...this.pasteAction(sel.pageId), menu: "tile" },
      // Any selection, whatever it holds.
      {
        id: "screenshot",
        icon: "camera",
        label: "Screenshot",
        group: "edit",
        run: () => void this.showSelectionScreenshot(),
      },
    ];
    // One graph on its own: look around in it, or change what it plots.
    const graphs = sel.graphs ?? [];
    if (graphs.length === 1 && selectedCount(sel) === 1) {
      const graph = graphs[0];
      actions.unshift({
        id: "explore-graph",
        icon: "move",
        label: "Explore",
        group: "graph",
        bar: true,
        run: () => this.exploreGraph(sel.pageId, graph),
      });
      const edit = this.callbacks.onEditGraph;
      if (edit) {
        actions.splice(1, 0, {
          id: "edit-graph",
          icon: "function-square",
          label: "Edit graph",
          group: "graph",
          bar: true,
          run: () => {
            this.clearSelection();
            edit(sel.pageId, graph);
          },
        });
      }
    }
    // One table (with the ink written in it): type in its cells, as a tap in a cell does.
    const table = this.loneTable(sel);
    if (table) {
      actions.unshift({
        id: "edit-table",
        icon: "text-cursor-input",
        label: "Edit table",
        group: "table",
        bar: true,
        run: () => this.startCellEdit(sel.pageId, table, { row: 0, col: 0 }),
      });
    }
    if (menu.colour && sel.strokes.length > 0) {
      const first = sel.strokes[0].color;
      actions.push({
        id: "colour",
        icon: "palette",
        label: "Colour",
        group: "style",
        swatches: {
          // The notebook's colours, the palette, then the custom colours picked lately.
          colors: [
            ...(this.doc.palette?.colors ?? []).filter(
              (color) => !this.palette.some((p) => sameColor(p, color)),
            ),
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
    // Its ink's look, to lay on other ink with the pen (`copyStyle`).
    if (menu.colour && sel.strokes.length > 0) {
      actions.push({
        id: "copy-style",
        icon: "paintbrush",
        label: "Copy style",
        group: "style",
        run: () => this.copyStyle(sel.strokes),
      });
    }
    if (menu.shapeStyle) actions.push(...this.shapeStyleActions(sel.strokes));
    const heading = this.groupBounds(sel);
    const index = this.doc.pages.findIndex((page) => page.id === sel.pageId);
    // Text first under Turn into: the plainest thing ink can become.
    const toText = this.callbacks.onTurnIntoText;
    if (menu.handwriting && toText && index >= 0 && sel.strokes.length > 0) {
      const ids = sel.strokes.map((stroke) => stroke.id);
      actions.push({
        id: "to-text",
        icon: "type",
        label: "Text",
        group: "turn",
        submenu: TURN_INTO,
        run: () => {
          this.clearSelection();
          toText(index, ids);
        },
      });
    }
    // Highlighter ink over a PDF's text: the text it covers can be copied.
    const highlighted =
      menu.handwriting && sel.strokes.some(isHighlight)
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
    // The word check's card, for any word, underlined or not.
    const correct = this.correctWordAction(index, sel.strokes);
    if (menu.handwriting && correct) actions.push(correct);
    if (menu.handwriting && heading && index >= 0 && this.callbacks.onAddSection) {
      const add = this.callbacks.onAddSection;
      actions.push({
        id: "contents",
        icon: "list-plus",
        label: "Contents heading",
        group: "turn",
        submenu: TURN_INTO,
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
    if (menu.link) actions.push(...this.linkActions(sel, index));
    if (menu.sticker && this.callbacks.onSaveSticker) {
      actions.push({
        id: "save-sticker",
        icon: "sticker",
        label: "Sticker",
        group: "turn",
        submenu: TURN_INTO,
        run: () => void this.saveSelectionAsSticker(),
      });
    }
    const comment = this.callbacks.onAddComment;
    if (menu.comment && heading && index >= 0 && comment) {
      actions.push({
        id: "comment",
        icon: "message-square-plus",
        label: "Comment",
        group: "turn",
        submenu: TURN_INTO,
        run: () => {
          // Pinned at the selection's top-right corner, beside what it is about.
          const at = { x: heading.maxX, y: heading.minY };
          this.clearSelection();
          comment(index, at);
        },
      });
    }
    // Task last under Turn into.
    if (menu.handwriting) actions.push(...this.taskActions(sel, index));
    // Flip after "Turn into": what a selection becomes reads before how it is turned.
    actions.push(...flipActions((axis) => this.flipSelection(axis), "flip"));
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
    // The bar, as Joost asked (2026-10-28): Cut · Copy · Duplicate · Delete ·
    // the resize handles, then the "…". A lone shape shows its handles from
    // the start, so it has only the corner points' switch (Joost, 2026-10-30).
    const lone = this.loneShape(sel);
    if (!lone) {
      actions.push({
        id: "corners",
        icon: "scan",
        label: this.selectionCorners ? "Hide resize handles" : "Show resize handles",
        group: "edit",
        bar: true,
        menu: "none",
        checked: this.selectionCorners,
        run: () => {
          this.selectionCorners = !this.selectionCorners;
          this.syncSelectionOverlay();
        },
      });
    }
    if (lone) {
      actions.push({
        id: "corner-points",
        icon: "vector-square",
        label: this.shapePointsOn ? "Hide corner points" : "Edit corner points",
        group: "edit",
        bar: true,
        menu: "none",
        checked: this.shapePointsOn,
        run: () => {
          this.shapePointsOn = !this.shapePointsOn;
          this.syncSelectionOverlay();
        },
      });
    }
    return actions;
  }

  /**
   * "Correct": the card an underlined word opens, for the word this ink is
   * in (the lasso's "…" menu, and the press menu over ink). Null when there
   * is no ink or handwriting cannot be read here.
   */
  private correctWordAction(
    index: number,
    strokes: readonly Stroke[],
    extra: Partial<SelectionAction> = {},
  ): SelectionAction | null {
    const correct = this.callbacks.onCorrectWord;
    // Shapes and highlighter are never read (`inkForReading`).
    const writing = strokes.filter((stroke) => !stroke.shape && stroke.tool !== "highlighter");
    if (!correct || index < 0 || writing.length === 0) return null;
    if (this.callbacks.canCorrectWords?.() === false) return null;
    const ids = writing.map((stroke) => stroke.id);
    return {
      id: "correct-word",
      icon: "spell-check",
      label: "Correct",
      group: "edit",
      ...extra,
      run: () => {
        this.clearSelection();
        correct(index, ids);
      },
    };
  }

  /**
   * Turn into › Task for selected ink (2.5), last under Turn into; with ink
   * that is in a task, Remove task as well.
   */
  private taskActions(sel: GroupSelection, index: number): SelectionAction[] {
    const page = this.doc.pages[index];
    const make = this.callbacks.onMakeTask;
    if (!page || !make || sel.strokes.length === 0) return [];
    const ids = sel.strokes.map((stroke) => stroke.id);
    const actions: SelectionAction[] = [
      {
        id: "task",
        icon: "square-check-big",
        label: "Task",
        group: "turn",
        submenu: TURN_INTO,
        run: () => {
          this.clearSelection();
          make(index, ids);
        },
      },
    ];
    const held = tasksOf(page, ids);
    if (held.length > 0) {
      actions.push({
        id: "untask",
        icon: "square-x",
        label: "Remove task",
        group: "link",
        run: () => {
          const commands = held.map((task) => new SetTask(page, task.id, null));
          this.applyCommand(new CompositeCommand("Remove task", commands));
        },
      });
    }
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
        group: "turn",
        submenu: TURN_INTO,
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
    // Held on handwriting: its word's card comes first.
    const index = page ? this.doc.pages.indexOf(page) : -1;
    const correct = press.ink
      ? this.correctWordAction(index, [press.ink], { group: "press", ...inBar })
      : null;
    if (correct) actions.unshift(correct);
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
        id: "comment-here",
        icon: "message-square-plus",
        label: "Comment",
        group: "press-text",
        // In the bar's "…" menu, so the bar keeps to its three words.
        enabled: this.callbacks.onAddComment !== undefined,
        run: () => {
          const box = this.boxForPage(press.pageId);
          if (box) this.callbacks.onAddComment?.(box.index, press.at);
        },
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

  /**
   * The lasso selection's ink, for Turn into › Text from a command: its
   * page and stroke ids, or `null` when nothing with ink is selected.
   */
  selectedInk(): { index: number; strokeIds: string[] } | null {
    const sel = this.liveSelection();
    if (!sel || sel.strokes.length === 0) return null;
    const index = this.doc.pages.findIndex((page) => page.id === sel.pageId);
    if (index < 0) return null;
    return { index, strokeIds: sel.strokes.map((stroke) => stroke.id) };
  }

  /**
   * Replace these strokes of page `page` with a text box saying `text`
   * (FineNotes#42), as one undo step, and select the box. The page is held
   * by identity: it may have moved while the host asked. False when there
   * was nothing to replace or the text was blank.
   */
  turnInkIntoText(page: Page, strokeIds: readonly string[], text: string): boolean {
    if (this.callbacks.isLocked?.() || !this.doc.pages.includes(page)) return false;
    const ids = new Set(strokeIds);
    const strokes = page.strokes.filter((stroke) => ids.has(stroke.id));
    const bounds = inkBounds(page, strokeIds);
    if (strokes.length === 0 || !bounds) return false;
    // The writing's own lines, as the recogniser finds them: drawing strokes left out.
    const lines = segmentPage(strokes).lines;
    const box = inkTextBox({
      id: this.textBoxIds.next(),
      bounds,
      text,
      style: this.toolState.textStyle ?? DEFAULT_TEXT_STYLE,
      inkColor: sharedInkColor(strokes.filter((stroke) => !isHighlight(stroke))),
      written: {
        count: lines.length,
        height: median(lines.map((line) => line.box[3] - line.box[1])),
      },
      pageWidth: page.geometry.width,
    });
    if (!box) return false;
    const command = new TurnInkIntoText(page, strokes, box);
    this.applyCommand(command);
    if (!command.applied) return false;
    this.syncTextBoxes();
    this.select(page.id, { strokes: [], images: [], textBoxes: [box] });
    return true;
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
      tables: sel.tables,
      graphs: sel.graphs,
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
          tables: group.tables,
          graphs: group.graphs,
        },
        bounds,
      );
      this.syncActionBar();
      return true;
    }
    const sel = this.liveImageSelection();
    if (!sel) return false;
    clipboard.put(
      { strokes: this.noteInk(sel), images: [sel.image], textBoxes: [] },
      imageBounds(transformOf(sel.image)),
    );
    // A note is no file: there is no picture for the system clipboard.
    if (!sel.image.sticky) this.callbacks.onCopyImage?.(sel.image);
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
      new RemoveElements(
        sel.pageId,
        { strokes: this.noteInk(sel), images: [sel.image], textBoxes: [] },
        "Cut",
      ),
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
      tables: entry.elements.tables,
      graphs: entry.elements.graphs,
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
    let tableSeq = Number(nextTableId(this.doc).slice(1)) - 1;
    let graphSeq = Number(nextGraphId(this.doc).slice(1)) - 1;
    return {
      stroke: () => this.strokeIds.next(),
      image: () => `i${++imageSeq}`,
      textBox: () => this.textBoxIds.next(),
      table: () => `g${++tableSeq}`,
      graph: () => `f${++graphSeq}`,
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
  /** The painter pictures are drawn with, for drawing a selection off the page. */
  private imagePainter: ImagePainter | null = null;

  /**
   * "Save as sticker": draw what is selected, and only that, on a transparent
   * canvas cut to its bounds (the painter the thumbnails use), and hand the
   * PNG to the host, which files it in the stickers folder.
   */
  private async saveSelectionAsSticker(): Promise<void> {
    const sel = this.liveSelection();
    const save = this.callbacks.onSaveSticker;
    const shot = sel && save ? await this.selectionPicture(sel, null) : null;
    if (!shot || !save) return;
    save(await shot.blob.arrayBuffer(), shot.width, shot.height);
  }

  /**
   * Screenshot (Joost on PR #59): what is selected, as it is drawn, on its
   * page's paper, as a PNG the host shows with Copy and Share
   * (`screenshot-modal.ts`). Without a host, it goes straight to the
   * clipboard, and the readout says whether it got there.
   */
  private async showSelectionScreenshot(): Promise<void> {
    const sel = this.liveSelection();
    const page = sel ? this.doc.pages.find((candidate) => candidate.id === sel.pageId) : null;
    if (!sel || !page) return;
    const show = this.callbacks.onScreenshot;
    const shot = this.selectionPicture(sel, paperColorOf(page, this.paper));
    if (!show) {
      const png = shot.then((made) => {
        if (!made) throw new Error("Nothing to draw");
        return made.blob;
      });
      const copied = await writePngToClipboard(png);
      this.flashReadout(copied ? "Copied as a picture" : "Couldn't copy the picture");
      return;
    }
    const made = await shot;
    if (made) show(made.blob, made.width, made.height);
  }

  /**
   * The selection drawn on its own, cut to its bounds with a small margin:
   * on `paper`, or transparent when that is null. Sharp at three times its
   * size, no side past 2048 px. `null` when there is nothing to draw.
   */
  private async selectionPicture(
    sel: GroupSelection,
    paper: string | null,
  ): Promise<{ blob: Blob; width: number; height: number } | null> {
    const bounds = this.groupBounds(sel);
    if (!bounds) return null;
    const pad = STICKER_PAD;
    const width = Math.max(1, bounds.maxX - bounds.minX + 2 * pad);
    const height = Math.max(1, bounds.maxY - bounds.minY + 2 * pad);
    const ids = {
      stroke: () => "s",
      image: () => "i",
      textBox: () => "t",
      table: () => "g",
      graph: () => "f",
    };
    const moved = copyElements(sel, ids, pad - bounds.minX, pad - bounds.minY);
    const page: Page = { ...blankPage("sticker", { width, height }), ...moved };
    const canvas = createEl("canvas");
    // Sharp at three times its size, but no side past 2048 px.
    const dpr = Math.min(3, 2048 / Math.max(width, height));
    renderPageThumbnail(canvas, page, { paint: () => undefined }, width, dpr, {
      transparent: true,
      usePressure: this.inkPressure,
      ...(this.imagePainter ? { images: this.imagePainter } : {}),
    });
    let out = canvas;
    if (paper) {
      // The paper behind it, as the page shows it.
      out = createEl("canvas");
      out.width = canvas.width;
      out.height = canvas.height;
      const ctx = out.getContext("2d");
      if (ctx) {
        ctx.fillStyle = paper;
        ctx.fillRect(0, 0, out.width, out.height);
        ctx.drawImage(canvas, 0, 0);
      }
      canvas.width = 0;
      canvas.height = 0;
    }
    const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png"));
    out.width = 0;
    out.height = 0;
    return blob ? { blob, width, height } : null;
  }

  /** Put the selected picture in front of the ink, or back under it, as one undo step. */
  private setSelectedImageFront(front: boolean): void {
    const sel = this.liveImageSelection();
    if (!sel || this.callbacks.isLocked?.()) return;
    this.history.push(this.doc, new SetImageFront(sel.pageId, sel.image, front));
    const box = this.boxForPage(sel.pageId);
    if (box) this.renderer?.invalidateRegion(box.index, imageBounds(transformOf(sel.image)));
    this.renderDry();
    this.syncActionBar();
    this.changed();
  }

  /** Draw the selected picture see-through, or opaque again, as one undo step. */
  private setSelectedImageOpacity(opacity: number): void {
    const sel = this.liveImageSelection();
    if (!sel || this.callbacks.isLocked?.()) return;
    if (Math.abs((sel.image.opacity ?? 1) - opacity) < 0.005) return;
    this.history.push(this.doc, new SetImageOpacity(sel.pageId, sel.image, opacity));
    const box = this.boxForPage(sel.pageId);
    if (box) this.renderer?.invalidateRegion(box.index, imageBounds(transformOf(sel.image)));
    this.renderDry();
    this.syncActionBar();
    this.changed();
  }

  private flipSelectedImage(axis: FlipAxis): void {
    const sel = this.liveImageSelection();
    if (!sel || this.callbacks.isLocked?.()) return;
    const before: NoteFrame = { ...sel.image };
    const after: NoteFrame = {
      ...before,
      ...(axis === "x"
        ? { flipX: before.flipX === true ? undefined : true }
        : { flipY: before.flipY === true ? undefined : true }),
    };
    this.history.push(
      this.doc,
      this.withNoteInkFollowing(sel, new FlipImage(sel.pageId, sel.image, axis), before, after),
    );
    // A note's ink moved with it: the eraser and the lasso look for it there.
    if (sel.image.sticky) this.strokeIndex.refreshPages(this.doc.pages, [sel.pageId]);
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
    const linked =
      this.syncLinkMarks() + this.syncWordMarks() + this.syncTaskMarks() + this.syncSearchMarks();
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
   * A box beside each handwritten task, where the export draws it
   * (`taskBoxRect`), ticked when done; a tap ticks or unticks it, one step of
   * undo. Returns how many are shown.
   */
  private syncTaskMarks(): number {
    let used = 0;
    const scale = this.unitScale;
    for (const box of this.pageLayout.boxes) {
      const page = this.pageAt(box.index);
      if (!page) continue;
      for (const task of page.tasks ?? []) {
        const bounds = inkBounds(page, task.strokes);
        if (!bounds) continue;
        let mark = this.taskMarks[used];
        if (!mark) {
          mark = this.sectionRibbonsEl.createDiv({
            cls: "goodobsidian-task-mark",
            attr: { role: "checkbox" },
          });
          this.bindTaskMark(mark);
          this.taskMarks.push(mark);
        }
        const rect = taskBoxRect(bounds);
        const first = page.strokes.find((s) => s.id === task.strokes[0]);
        mark.removeClass("is-hidden");
        mark.toggleClass("is-done", task.done === true);
        mark.dataset.pageId = page.id;
        mark.dataset.taskId = task.id;
        mark.setAttribute("aria-checked", String(task.done === true));
        mark.setAttribute("aria-label", task.text || "Task");
        mark.setCssStyles({
          left: `${(box.x + rect.x) * scale}px`,
          top: `${(box.y + rect.y) * scale}px`,
          width: `${rect.size * scale}px`,
          height: `${rect.size * scale}px`,
          color: first?.color ?? "",
        });
        used++;
      }
    }
    for (let i = used; i < this.taskMarks.length; i++) this.taskMarks[i].addClass("is-hidden");
    return used;
  }

  /**
   * Draw these strokes pale (`null`: none), as a recording plays: ink not
   * written yet at that moment (`audio/replay.ts`). Only the strokes whose
   * look changed are painted again, so playing forward costs one stroke's
   * tiles at a time.
   */
  setFadedStrokes(ids: ReadonlySet<string> | null): void {
    const next = ids ?? new Set<string>();
    const changed = fadeChanges(this.fadedStrokes, next);
    if (changed.size === 0) return;
    this.fadedStrokes = next;
    this.renderer?.setFadedStrokes(next);
    this.doc.pages.forEach((page, index) => {
      let dirty: Bounds | null = null;
      for (const stroke of page.strokes) {
        if (!changed.has(stroke.id)) continue;
        const bounds = strokeBounds(stroke);
        if (bounds) dirty = unionBounds(dirty, bounds);
      }
      if (dirty) this.renderer?.invalidateRegion(index, dirty);
    });
    this.renderDry();
  }

  /**
   * Light up what a search found on a page (2.5): each word's ink under a
   * soft highlight, and each text box holding the words, and glide to the
   * first of them. They stay until the page is next touched or edited, or
   * another search is opened; `null` puts them out.
   */
  setSearchHits(pageId: string | null, words: string[][] = [], boxes: string[] = []): void {
    const had = this.searchHits !== null;
    this.searchHits =
      pageId !== null && (words.length > 0 || boxes.length > 0) ? { pageId, words, boxes } : null;
    if (!had && !this.searchHits) return;
    for (const view of this.textBoxInputs.values()) {
      view.root.toggleClass(
        "is-search-hit",
        this.searchHits?.pageId === view.pageId && this.searchHits.boxes.includes(view.id),
      );
    }
    this.syncSectionRibbons();
    const hits = this.searchHits;
    if (!hits) return;
    const index = this.doc.pages.findIndex((page) => page.id === hits.pageId);
    const page = this.doc.pages[index];
    if (!page) return;
    // Glide to the first hit: the highest word, or the highest box.
    const tops = [
      ...hits.words.flatMap((ids) => inkBounds(page, ids)?.minY ?? []),
      ...page.textBoxes.filter((box) => hits.boxes.includes(box.id)).map((box) => box.y),
    ];
    if (tops.length > 0) this.goToPagePoint(index, Math.min(...tops), true);
    // The next press on the page puts them out.
    this.surfaceEl.addEventListener("pointerdown", () => this.setSearchHits(null), {
      capture: true,
      once: true,
    });
  }

  /** A soft highlight over each word the last search found. Returns how many are shown. */
  private syncSearchMarks(): number {
    let used = 0;
    const hits = this.searchHits;
    const box = hits ? this.boxForPage(hits.pageId) : null;
    const page = hits ? this.doc.pages.find((p) => p.id === hits.pageId) : undefined;
    if (hits && box && page) {
      const scale = this.unitScale;
      for (const ids of hits.words) {
        const bounds = inkBounds(page, ids);
        if (!bounds) continue;
        let mark = this.searchMarks[used];
        if (!mark) {
          mark = this.sectionRibbonsEl.createDiv({ cls: "goodobsidian-search-mark" });
          this.searchMarks.push(mark);
        }
        const pad = SEARCH_MARK_PAD / scale;
        mark.removeClass("is-hidden");
        mark.setCssStyles({
          left: `${(box.x + bounds.minX - pad) * scale}px`,
          top: `${(box.y + bounds.minY - pad) * scale}px`,
          width: `${(bounds.maxX - bounds.minX + 2 * pad) * scale}px`,
          height: `${(bounds.maxY - bounds.minY + 2 * pad) * scale}px`,
        });
        used++;
      }
    }
    for (let i = used; i < this.searchMarks.length; i++) this.searchMarks[i].addClass("is-hidden");
    return used;
  }

  /** A tap on a task's box ticks or unticks it: pointer events, as every control over the page. */
  private bindTaskMark(mark: HTMLElement): void {
    let pressed: number | null = null;
    mark.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      event.preventDefault();
      pressed = event.pointerId;
    });
    mark.addEventListener("pointerup", (event) => {
      event.stopPropagation();
      if (pressed !== event.pointerId) return;
      pressed = null;
      if (this.callbacks.isLocked?.()) return;
      const page = this.doc.pages.find((p) => p.id === mark.dataset.pageId);
      const task = page?.tasks?.find((t) => t.id === mark.dataset.taskId);
      if (!page || !task) return;
      this.applyCommand(tickTask(page, task, task.done !== true));
    });
    mark.addEventListener("pointercancel", () => {
      pressed = null;
    });
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

  /**
   * Underline words on a page that Grape may have misread; a finger tap on
   * one (a right-click with a mouse) calls `onFlaggedWord`. Replaces the
   * page's earlier flags.
   */
  setWordFlags(pageId: string, flags: ReadonlyArray<readonly string[]>): void {
    if (flags.length > 0) this.wordFlags.set(pageId, flags);
    else this.wordFlags.delete(pageId);
    this.syncSectionRibbons();
  }

  /**
   * Mark the word whose card is open (its underline turns red, and an
   * underline is drawn for a word that had none), or none with `null`.
   */
  setActiveWordFlag(pageId: string | null, strokeIds: readonly string[] = []): void {
    this.activeWordFlag =
      pageId === null ? null : { pageId, key: strokeKey(strokeIds), strokes: [...strokeIds] };
    this.syncSectionRibbons();
  }

  /**
   * Where a word's card goes: the bottom-left of these strokes' ink on page
   * `index`, in client px; null when none of it is on the page.
   */
  wordInk(index: number, strokeIds: readonly string[]): { x: number; y: number } | null {
    const page = this.pageAt(index);
    const box = page ? this.boxForPage(page.id) : null;
    const bounds = page && box ? this.linkBounds(page, strokeIds) : null;
    if (!box || !bounds) return null;
    return this.toClient({ x: box.x + bounds.minX, y: box.y + bounds.maxY });
  }

  /**
   * A dotted underline under each flagged word whose ink is still there, red
   * and wavy for the one whose menu is open. Returns how many.
   */
  private syncWordMarks(): number {
    let used = 0;
    const scale = this.unitScale;
    for (const box of this.pageLayout.boxes) {
      const page = this.pageAt(box.index);
      if (!page) continue;
      const flags = [...(this.wordFlags.get(page.id) ?? [])];
      // A word whose card was opened by hand ("Correct") is marked while it is open.
      const asked = this.activeWordFlag;
      if (asked?.pageId === page.id && !flags.some((strokes) => strokeKey(strokes) === asked.key)) {
        flags.push(asked.strokes);
      }
      for (const strokes of flags) {
        const bounds = this.linkBounds(page, strokes);
        if (!bounds) continue;
        let mark = this.wordMarks[used];
        if (!mark) {
          mark = this.sectionRibbonsEl.createDiv({ cls: "goodobsidian-word-flag" });
          this.wordMarks.push(mark);
        }
        mark.removeClass("is-hidden");
        const active = this.activeWordFlag;
        mark.toggleClass(
          "is-active",
          active !== null && active.pageId === page.id && active.key === strokeKey(strokes),
        );
        mark.setCssStyles({
          left: `${(box.x + bounds.minX) * scale}px`,
          top: `${(box.y + bounds.maxY) * scale + WORD_FLAG_GAP_PX}px`,
          width: `${Math.max(8, (bounds.maxX - bounds.minX) * scale)}px`,
        });
        used++;
      }
    }
    for (let i = used; i < this.wordMarks.length; i++) this.wordMarks[i].addClass("is-hidden");
    return used;
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
   * A finger tapped page point `p` of page `index`: follow the link of the
   * page's PDF there (a planner's tab, an index entry, a web address), if
   * any. A link to another page of the PDF goes to the notebook page that
   * shows it. A page whose links are not read yet has them read, and the
   * tap is followed once they are, if that comes soon (`pdfTextReady`),
   * unless `wait` is false: a right-click has opened the press menu by then.
   */
  private followPdfLink(index: number, p: Pt, tolerance: number, wait = true): boolean {
    const page = this.pageAt(index);
    const source = this.textSource;
    if (!page || page.backdrop.kind !== "pdf" || !source?.peekLinks) return false;
    const links = source.peekLinks(page.backdrop, page.geometry);
    if (links === null) {
      if (wait) this.pendingLinkTap = { page, p, tolerance, at: now() };
      source.request(page.backdrop);
      return false;
    }
    const link = linkAt(links, p, tolerance);
    if (!link) return false;
    if ("url" in link.target) {
      this.callbacks.onOpenLink?.(link.target.url);
      return true;
    }
    const to = notebookPageOf(this.doc.pages, page.backdrop.path, link.target.page, index);
    if (to < 0) return false;
    this.goToPage(to, true);
    return true;
  }

  /** A tap on a PDF page whose links were still being read, to follow once they are. */
  private pendingLinkTap: { page: Page; p: Pt; tolerance: number; at: number } | null = null;

  /**
   * A PDF page's text and links were read: a tap that waited on them is
   * followed now, if it was moments ago and the page is still there.
   */
  pdfTextReady(path: string, pdfPage: number): void {
    const tap = this.pendingLinkTap;
    const backdrop = tap?.page.backdrop;
    if (!tap || backdrop?.kind !== "pdf" || backdrop.path !== path || backdrop.page !== pdfPage) {
      return;
    }
    this.pendingLinkTap = null;
    const index = this.doc.pages.indexOf(tap.page);
    if (index < 0 || now() - tap.at > PDF_LINK_WAIT_MS) return;
    this.followPdfLink(index, tap.p, tap.tolerance);
  }

  /**
   * A finger tapped page point `p`: open the link whose ink is there, if
   * any. `tolerance` is page px, around the ink and down to its underline.
   */
  private openLinkAt(page: Page, p: Pt, tolerance: number): boolean {
    const { onOpenLink: open, onSuggestedLink: offer, onFlaggedWord: ask } = this.callbacks;
    const index = this.doc.pages.indexOf(page);
    const links = open ? (page.links ?? []) : [];
    const suggestions = offer && index >= 0 ? this.suggestionsOn(page) : [];
    const flags = ask && index >= 0 ? (this.wordFlags.get(page.id) ?? []) : [];
    const hit = inkTargetAt(
      {
        links: links.map((link) => link.strokes),
        suggestions: suggestions.map((s) => s.strokes),
        flags,
      },
      (strokes) => this.linkBounds(page, strokes),
      p,
      { tolerance, below: (LINK_UNDERLINE_GAP_PX + 4) / this.unitScale },
    );
    if (!hit) return false;
    if (hit.kind === "link") open?.(links[hit.index].target);
    else if (hit.kind === "suggestion") {
      const suggestion = suggestions[hit.index];
      offer?.(index, suggestion.strokes, suggestion.target);
    } else ask?.(index, [...flags[hit.index]], this.tapClient);
    return true;
  }

  /**
   * A marker on every comment, at the point it was pinned to: a speech
   * bubble, the AI's with a spark, faded once resolved. Pooled buttons in
   * the paper, so they scroll with it; `onTap` takes finger, Pencil and
   * mouse alike, and keeps the pen from writing under the marker.
   */
  private syncCommentMarkers(): void {
    // Not built yet (the first change can come from the constructor's load).
    if (!this.commentMarkersEl || !this.pageLayout) return;
    const scale = this.unitScale;
    const targets: Array<{ index: number; comment: PageComment }> = [];
    for (const box of this.pageLayout.boxes) {
      const page = this.pageAt(box.index);
      for (const comment of page?.comments ?? []) {
        const i = targets.length;
        targets.push({ index: box.index, comment });
        let marker = this.commentMarkers[i];
        if (!marker) {
          marker = this.commentMarkersEl.createEl("button", {
            cls: "goodobsidian-comment-marker clickable-icon",
          });
          iconInto(marker, "message-square", "•");
          // The pool slot, not the comment: what it stands for is read at tap time.
          onTap(marker, () => {
            const target = this.commentTargets[i];
            if (target) this.callbacks.onTapComment?.(target.index, target.comment, marker);
          });
          this.commentMarkers.push(marker);
        }
        marker.removeClass("is-hidden");
        marker.toggleClass("is-ai", comment.author === "ai");
        marker.toggleClass("is-resolved", comment.resolved === true);
        marker.setAttribute("aria-label", `Comment: ${comment.text}`);
        marker.setCssStyles({
          left: `${(box.x + comment.x) * scale}px`,
          top: `${(box.y + comment.y) * scale}px`,
        });
      }
    }
    this.commentTargets = targets;
    for (let i = targets.length; i < this.commentMarkers.length; i++) {
      this.commentMarkers[i].addClass("is-hidden");
    }
    this.commentMarkersEl.toggleClass("is-hidden", targets.length === 0);
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
    this.requestZoomPaint();
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
    // One segmented row per property (2.5): eleven check rows had become four lines.
    const row = (
      id: string,
      icon: string,
      label: string,
      segment: string,
      checked: boolean,
      apply: ShapeStyle,
    ): void => {
      out.push({
        id,
        icon,
        label,
        group: "style",
        segment,
        checked,
        run: () => this.restyleSelection(apply),
      });
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
      row("fill-none", "square", "No fill", "Fill", fill === "none", { fill: null });
      row("fill-soft", "droplet", "Soft fill", "Fill", fill === "soft", { fillFrom: "soft" });
      row("fill-solid", "paint-bucket", "Solid fill", "Fill", fill === "solid", {
        fillFrom: "solid",
      });
    }
    row("line-solid", "minus", "Solid line", "Line", style.dash === null, { dash: null });
    row("line-dash", "square-dashed", "Dashed line", "Line", style.dash === "dash", {
      dash: "dash",
    });
    row("line-dot", "ellipsis", "Dotted line", "Line", style.dash === "dot", { dash: "dot" });
    if (common.roundable) {
      const rounded = typeof style.radius === "number" && style.radius > 0;
      row("corners-square", "square", "Square corners", "Corners", !rounded, { radius: null });
      row("corners", "square-round-corner", "Rounded corners", "Corners", rounded, {
        radius: ROUND_RADIUS,
      });
    }
    if (common.headed) {
      const heads = style.heads ?? null;
      const start = heads?.start;
      const end = heads?.end;
      const filled = start === "filled" || end === "filled";
      const kind = filled ? "filled" : "open";
      row("head-start", "arrow-left", "Arrow at start", "Arrows", start !== undefined, {
        heads: { ...(start ? {} : { start: kind }), ...(end ? { end } : {}) },
      });
      row("head-end", "arrow-right", "Arrow at end", "Arrows", end !== undefined, {
        heads: { ...(start ? { start } : {}), ...(end ? {} : { end: kind }) },
      });
      const flip = filled ? "open" : "filled";
      row("head-filled", "triangle", "Filled arrowheads", "Arrows", filled, {
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
    if (!sel || this.pointDrag || this.linkDrag || this.callbacks.isLocked?.()) return;
    // A palm landing on the frame while the Pencil is busy elsewhere is a palm.
    const finger = event.pointerType === "touch";
    if (finger && this.activePage !== null) return;
    if (this.groupDrag) {
      // A second finger beside the one dragging it: a turn of the selection.
      if (finger && this.groupDrag.finger === true)
        this.addFrameFinger(this.selectionFrameEl, event);
      return;
    }
    const box = this.boxForPage(sel.pageId);
    const bounds = this.groupBounds(sel);
    if (!box || !bounds) return;
    try {
      this.selectionFrameEl.setPointerCapture(event.pointerId);
    } catch {
      // A synthetic pointer (a test harness) cannot be captured; moves still arrive.
    }
    const from = this.pagePoint(box, event.clientX, event.clientY);
    if (this.grabLinkDot(event, sel, bounds, from)) return;
    // Anything else done with the selection puts the bar of shapes away.
    this.linkBar = null;
    const turn = this.knobGrabbed(bounds, from);
    if (!turn && this.grabShapePoint(event, sel, from)) return;
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
      finger,
      lifted: false,
    };
    this.selectionFrameEl.addEventListener("pointermove", this.onSelectionPointerMove);
    this.selectionFrameEl.addEventListener("pointerup", this.onSelectionPointerEnd);
    this.selectionFrameEl.addEventListener("pointercancel", this.onSelectionPointerEnd);
    if (finger) {
      // No drag was under way, so any finger still counted lost its lift.
      if (!this.pageFingerOnFrame) this.selectionFingers.cancel();
      this.selectionFingers.down(event.pointerId, event.clientX, event.clientY, event.timeStamp);
    }
  };

  /** Another finger landed on a frame while one drags its selection or picture: it joins, to turn. */
  private addFrameFinger(frame: HTMLElement, event: PointerEvent): void {
    try {
      frame.setPointerCapture(event.pointerId);
    } catch {
      // A synthetic pointer (a test harness) cannot be captured; moves still arrive.
    }
    this.selectionFingers.down(event.pointerId, event.clientX, event.clientY, event.timeStamp);
  }

  /** A finger on the frame moved or lifted: the turn hears of it, before the drag does. */
  private readonly onSelectionFinger = (event: PointerEvent): void => {
    if (event.pointerType !== "touch") return;
    if (event.type === "pointermove") {
      this.selectionFingers.move(event.pointerId, event.clientX, event.clientY, event.timeStamp);
    } else {
      this.selectionFingers.lift(event.pointerId, event.timeStamp);
    }
  };

  /**
   * A finger landed on the page (client px) while another drags the
   * selection by its frame: it joins that finger, and the two turn the
   * selection. Its moves and its lift come through the page's pan.
   */
  private joinFrameFingers(x: number, y: number, t: number): boolean {
    if (this.pageFingerOnFrame) {
      // Another page finger joined it: the page's gesture moved its focus.
      this.selectionFingers.down(PAGE_FINGER_ID, x, y, t);
      return true;
    }
    const held = this.groupDrag?.finger === true || this.imageDrag?.finger === true;
    if (!held || this.touchPanning) return false;
    if (!this.selectionFingers.down(PAGE_FINGER_ID, x, y, t)) return false;
    this.pageFingerOnFrame = true;
    return true;
  }

  /**
   * Two fingers began a turn at client point (x, y), `spread` px apart: on
   * the frame of the selection or picture a finger is dragging, or (`page`)
   * both on the page with their midpoint over the selection or the selected
   * picture. Returns whether it took the gesture. A drag by a handle or a
   * knob stays what it was.
   */
  private startGroupTurn(x: number, y: number, spread: number, page: boolean): boolean {
    if (this.callbacks.isLocked?.()) return false;
    let drag = this.groupDrag;
    let owned = false;
    if (page) {
      if (drag || this.imageDrag || this.activePage !== null) return false;
      drag = this.turnableAt(x, y);
      owned = true;
    } else if (!drag) {
      drag = this.groupDragFromPicture();
      owned = true;
    }
    if (!drag || drag.scale || drag.turn || drag.fingers) return false;
    if (!page && drag.finger !== true) return false;
    if (!this.boxForPage(drag.selection.pageId)) return false;
    this.groupDrag = drag;
    const state = startFingerTurn(boundsCentre(drag.bounds), { x: drag.dx, y: drag.dy });
    // The turn's circle on screen is the fingers': it sizes the snap's catch.
    const snap = new TurnSnap(spread / 2, this.pageAngleOf(drag.selection));
    const motion = fingerTurnMotion(state, (raw) => snap.turn(raw));
    drag.fingers = { state, snap, motion, page, owned };
    return true;
  }
  /**
   * A drag for two page fingers whose midpoint (client px) lands over the
   * lasso selection, or over the selected picture, within a margin; `null`
   * when it lands elsewhere and the page should zoom.
   */
  private turnableAt(x: number, y: number): GroupDrag | null {
    const sel = this.liveSelection() ?? this.pictureAsSelection();
    const box = sel ? this.boxForPage(sel.pageId) : null;
    const bounds = sel ? this.groupBounds(sel) : null;
    if (!sel || !box || !bounds) return null;
    const at = this.pagePoint(box, x, y);
    const frame = this.selectionFrameOf(bounds);
    if (!fingersOnSelection(frame, at, FINGER_TURN_MARGIN_PX / this.unitScale)) return null;
    return {
      pointerId: -1,
      selection: sel,
      bounds,
      from: at,
      clientX: x,
      clientY: y,
      dx: 0,
      dy: 0,
      scale: null,
      turn: null,
      lifted: false,
    };
  }

  /** The selected picture as a selection of its own, a sticky note with its ink. */
  private pictureAsSelection(): GroupSelection | null {
    const picked = this.liveImageSelection();
    if (!picked) return null;
    return {
      pageId: picked.pageId,
      strokes: this.noteInk(picked),
      images: [picked.image],
      textBoxes: [],
      tables: [],
      graphs: [],
    };
  }

  /**
   * A finger dragging the selected picture by its body was joined by a
   * second: the picture's drag becomes a selection drag the turn carries on
   * from, with any move the finger made. The finger keeps its capture.
   */
  private groupDragFromPicture(): GroupDrag | null {
    const held = this.imageDrag;
    const sel = held?.finger === true && held.part === "body" ? this.pictureAsSelection() : null;
    const box = held ? this.boxForPage(held.pageId) : null;
    const bounds = sel ? this.groupBounds(sel) : null;
    if (!held || !sel || !box || !bounds || sel.images[0] !== held.image) return null;
    this.imageDrag = null;
    this.imageFrameEl.removeEventListener("pointermove", this.onImagePointerMove);
    this.imageFrameEl.removeEventListener("pointerup", this.onImagePointerEnd);
    this.imageFrameEl.removeEventListener("pointercancel", this.onImagePointerEnd);
    this.imageUiEl.removeClass("is-dragging");
    if (held.lifted) this.renderer?.setHiddenImages(NO_IMAGES);
    const drag: GroupDrag = {
      pointerId: held.pointerId,
      selection: sel,
      bounds,
      from: held.from,
      clientX: held.clientX,
      clientY: held.clientY,
      dx: held.draft.x - held.start.x,
      dy: held.draft.y - held.start.y,
      scale: null,
      turn: null,
      finger: true,
      lifted: false,
    };
    // Drawn where the finger had already carried it.
    if (held.lifted) {
      this.groupDrag = drag;
      this.liftSelection(drag, box);
      this.renderGroupDraft();
      this.syncImageOverlay();
    }
    return drag;
  }

  /** The fingers turned: the selection follows, drawn on the wet layer until the lift. */
  private stepGroupTurn(info: PinchInfo): void {
    const drag = this.groupDrag;
    const grip = drag?.fingers;
    const box = drag ? this.boxForPage(drag.selection.pageId) : null;
    if (!drag || !grip || !box) return;
    grip.state = stepFingerTurn(grip.state, info.rotation);
    if (!grip.state.engaged) return;
    grip.motion = fingerTurnMotion(grip.state, (raw) => grip.snap.turn(raw));
    if (!drag.lifted) {
      this.liftSelection(drag, box);
      this.syncImageOverlay();
    }
    this.renderGroupDraft();
    this.placeDraggedTextBoxes(drag, box);
    this.syncSelectionOverlay();
    // The page angle it has come to, by the fingers.
    const at = this.pagePoint(box, info.centerX, info.centerY);
    this.showTurnLabel(box, at, grip.snap.pageAngle(grip.motion.angle), grip.snap.snapped);
  }

  /**
   * Fewer than two fingers are left: the turn is one step. Fingers that
   * never turned leave a finger's drag of the frame going as it was.
   */
  private endGroupTurn(): void {
    const drag = this.groupDrag;
    const grip = drag?.fingers;
    if (!drag || !grip) return;
    this.showTurnLabel(null, null, 0, false);
    if (!grip.state.engaged && !grip.owned) {
      drag.fingers = undefined;
      return;
    }
    // On the lift a turn that ended close to a page step lands on it exactly.
    if (grip.state.engaged) grip.motion = fingerTurnMotion(grip.state, () => grip.snap.settled());
    this.endGroupDrag(true);
    this.syncImageOverlay();
  }

  private readonly onSelectionPointerMove = (event: PointerEvent): void => {
    const drag = this.groupDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.stopPropagation();
    event.preventDefault();
    // Two fingers turn it through `onSelectionFinger`.
    if (drag.fingers) return;
    const moved = Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY);
    if (!drag.lifted && moved < IMAGE_DRAG_SLOP_PX) return;
    const box = this.boxForPage(drag.selection.pageId);
    if (!box) return;
    this.moveGroupDrag(drag, box, this.pagePoint(box, event.clientX, event.clientY));
  };

  /**
   * The corner resize a press at page point `from` starts on the selection's
   * frame, or `null` when it grabbed no corner handle. The handles sit on the
   * dashed frame, which is `framePad` outside the bounds.
   */
  /** The selection's dashed frame, page space: its bounds grown by `framePad`. */
  private selectionFrameOf(bounds: Bounds): Bounds {
    const pad = this.framePad / this.unitScale;
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
    if (!hit) return null;
    const centre = boundsCentre(bounds);
    const radius = Math.hypot(from.x - centre.x, from.y - centre.y) * scale;
    const sel = this.selection;
    return { centre, from, angle: 0, snap: new TurnSnap(radius, sel ? this.pageAngleOf(sel) : 0) };
  }

  /**
   * The angle a selection has on the page, which its turns snap from: a
   * lone shape's main edge or axis, a lone picture's rotation, and 0 for
   * anything else (taken as drawn).
   */
  private pageAngleOf(sel: GroupSelection): number {
    const only = selectedCount(sel) === 1;
    if (only && sel.strokes.length === 1 && sel.strokes[0].shape !== undefined) {
      return shapeAngleOf(sel.strokes[0].pts) ?? 0;
    }
    // A picture, or a sticky note with its ink.
    if (sel.images.length === 1 && loneNote(sel) !== null) return rotationOf(sel.images[0]);
    if (only && sel.images.length === 1) return rotationOf(sel.images[0]);
    return 0;
  }

  /** The small angle readout beside the pen while a knob turns; made on first use. */
  private turnLabelEl: HTMLElement | null = null;

  /**
   * The turn a picture's knob starts: settling on every 45° of the page from
   * the picture's own rotation, measured on the knob's circle on screen.
   */
  private imageTurnSnap(start: ImageTransform, from: Pt): TurnSnap {
    const c = imageCentre(start);
    const radius = Math.hypot(from.x - c.x, from.y - c.y) * this.unitScale;
    return new TurnSnap(radius, rotationOf(start));
  }

  /**
   * Show the angle on the page a turn has brought the item to, in whole
   * degrees, beside page point `at` of `box` (where the pen or the fingers
   * are), marked when it has settled on a page step; or hide it (`box` null).
   */
  private showTurnLabel(box: PageBox | null, at: Pt | null, angle: number, snapped: boolean): void {
    if (!box || !at) {
      this.turnLabelEl?.addClass("is-hidden");
      return;
    }
    const el = (this.turnLabelEl ??= this.paperEl.createDiv({
      cls: "goodobsidian-turn-label is-hidden",
    }));
    const scale = this.unitScale;
    const degrees = Math.round((angle * 180) / Math.PI);
    // A true minus sign, as a number is typeset.
    el.setText(`${degrees < 0 ? "−" : ""}${Math.abs(degrees)}°`);
    el.toggleClass("is-snapped", snapped);
    el.setCssStyles({ left: `${(box.x + at.x) * scale}px`, top: `${(box.y + at.y) * scale}px` });
    el.removeClass("is-hidden");
  }

  private cornerGrabbed(sel: GroupSelection, bounds: Bounds, from: Pt): GroupScale | null {
    if (!this.selectionCorners) return null;
    const scale = this.unitScale;
    const pad = this.framePad / scale;
    const frame: Bounds = {
      minX: bounds.minX - pad,
      minY: bounds.minY - pad,
      maxX: bounds.maxX + pad,
      maxY: bounds.maxY + pad,
    };
    const corner = hitSelectionCorner(frame, from, HANDLE_HIT_RADIUS_PX / scale);
    if (!corner) return null;
    const at = boundsCorner(bounds, corner);
    return {
      corner,
      anchor: anchorCorner(bounds, corner),
      grab: { x: at.x - from.x, y: at.y - from.y },
      k: 1,
      ...this.groupScaleRange(sel, bounds),
    };
  }

  /** How far a selection may be scaled: not below the smallest side, nor past its text's sizes. */
  private groupScaleRange(sel: GroupSelection, bounds: Bounds): { min: number; max: number } {
    const fonts = textScaleRange(sel.textBoxes);
    const cells = tableScaleRange(sel.tables ?? []);
    const text = { min: Math.max(fonts.min, cells.min), max: Math.min(fonts.max, cells.max) };
    const side = minScaleForSide(bounds, MIN_SELECTION_SIDE_PX / this.unitScale);
    return { min: Math.max(side, text.min), max: text.max };
  }

  /** Carry a selection being dragged to page point `p`, from where the drag began. */
  private moveGroupDrag(drag: GroupDrag, box: PageBox, p: Pt): void {
    const scale = drag.scale;
    const turn = drag.turn;
    if (turn) {
      turn.angle = turn.snap.turn(sweptTurn(turn.centre, turn.from, p, 0));
      this.showTurnLabel(box, p, turn.snap.pageAngle(turn.angle), turn.snap.snapped);
    } else if (scale) {
      const pointer = { x: p.x + scale.grab.x, y: p.y + scale.grab.y };
      scale.k = cornerScale(drag.bounds, scale.corner, pointer, scale.min, scale.max);
    } else {
      // A move may carry it onto another page: the one under the pen.
      const own = this.boxForPage(drag.selection.pageId) ?? box;
      const at = { x: box.x + p.x, y: box.y + p.y };
      const boxes = this.pageLayout.boxes;
      const target = this.board ? own : (boxes[dropPageAt(boxes, at)] ?? own);
      const dx = at.x - own.x - drag.from.x;
      const dy = at.y - own.y - drag.from.y;
      // Joined, the pages are one sheet: it may lie over the join, as ink may.
      const d =
        this.joined && !this.board
          ? joinedDelta(drag.bounds, dx, dy, own, paperBox(boxes))
          : crossPageDelta(drag.bounds, dx, dy, own, target);
      drag.dx = d.dx;
      drag.dy = d.dy;
      drag.target = target;
      drag.screen = {
        x: at.x * this.unitScale + this.offsetX,
        y: (at.y - this.viewport.scrollY) * this.unitScale,
      };
      if (this.edgeSpeed(drag.screen).some((v) => v !== 0)) this.requestFrame();
    }
    if (!drag.lifted) this.liftSelection(drag, box);
    this.renderGroupDraft();
    this.placeDraggedTextBoxes(drag, box);
    this.syncSelectionOverlay();
  }

  /** How fast a selection held at pane point `at` scrolls the view, px a frame, per axis. */
  private edgeSpeed(at: Pt): [number, number] {
    return [edgeScrollSpeed(at.x, 0, this.cssW), edgeScrollSpeed(at.y, 0, this.cssH)];
  }

  /**
   * A selection carried near the pane's edge scrolls the notebook under
   * it, as the page sidebar does a dragged thumbnail, so it can reach a
   * page that is off screen. One frame's worth; true while it moved.
   */
  private stepGroupDragScroll(): boolean {
    const drag = this.groupDrag;
    const at = drag?.screen;
    if (!drag?.lifted || !at || drag.scale || drag.turn) return false;
    const [vx, vy] = this.edgeSpeed(at);
    if (vx === 0 && vy === 0) return false;
    const before = this.scroller.position;
    this.scroller.scrollBy(vx, vy);
    const after = this.scroller.position;
    if (after.x === before.x && after.y === before.y) return false;
    this.syncViewport();
    // The pen has not moved, but the page under it has.
    const box = this.boxForPage(drag.selection.pageId);
    if (!box) return true;
    const scale = this.unitScale;
    const layout = { x: (at.x - this.offsetX) / scale, y: at.y / scale + this.viewport.scrollY };
    this.moveGroupDrag(drag, box, this.toPage(box, layout));
    return true;
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
    // Their mirrors over the join go too, or the old place would show there.
    const mirrors = this.selectionMirrors(drag.selection);
    this.renderer?.setHiddenStrokes(
      new Set([...drag.selection.strokes.map((stroke) => stroke.id), ...mirrors.strokeIds]),
    );
    this.renderer?.setHiddenImages(new Set([...drag.selection.images, ...mirrors.images]));
    this.renderer?.setHiddenTables(new Set([...(drag.selection.tables ?? []), ...mirrors.tables]));
    this.renderer?.setHiddenGraphs(new Set([...(drag.selection.graphs ?? []), ...mirrors.graphs]));
    // Its connectors leave the tiles too, and follow it on the wet layer.
    drag.connectors = this.connectorIdsOf(drag.selection.pageId, drag.selection.strokes);
    if (drag.connectors.size > 0) {
      this.renderer?.setHiddenConnectors(drag.connectors);
      this.invalidateConnectors(drag.selection.pageId, drag.connectors);
    }
    this.renderer?.invalidateRegion(box.index, drag.bounds);
    this.invalidateMirrorRegions(mirrors.regions);
    this.renderDry();
  }

  /** The mirrors on other pages of what a selection holds (`canvas/mirrors.ts`): to hide while it moves. */
  private selectionMirrors(selection: GroupSelection): {
    strokeIds: string[];
    images: ImageElement[];
    tables: TableElement[];
    graphs: GraphElement[];
    regions: Array<{ index: number; bounds: Bounds }>;
  } {
    const out = {
      strokeIds: [] as string[],
      images: [] as ImageElement[],
      tables: [] as TableElement[],
      graphs: [] as GraphElement[],
      regions: [] as Array<{ index: number; bounds: Bounds }>,
    };
    if (!this.joined) return out;
    const keys = (list: ReadonlyArray<{ id: string }> | undefined): Set<string> =>
      new Set((list ?? []).map((element) => ownerKey(selection.pageId, element.id)));
    const wanted = {
      strokes: keys(selection.strokes),
      images: keys(selection.images),
      tables: keys(selection.tables),
      graphs: keys(selection.graphs),
    };
    this.pageLayout.boxes.forEach((box) => {
      const page = this.pageAt(box.index);
      if (!page || page.id === selection.pageId) return;
      const take = <T extends { join?: string }>(
        kind: "strokes" | "images" | "tables" | "graphs",
        list: readonly T[] | undefined,
        into: (element: T) => void,
      ): void => {
        for (const element of list ?? []) {
          if (!element.join || !wanted[kind].has(element.join)) continue;
          into(element);
          const bounds = elementBounds(kind, element as never);
          if (bounds) out.regions.push({ index: box.index, bounds });
        }
      };
      take("strokes", page.strokes, (stroke) => out.strokeIds.push(stroke.id));
      take("images", page.images, (image) => out.images.push(image));
      take("tables", page.tables, (table) => out.tables.push(table));
      take("graphs", page.graphs, (graph) => out.graphs.push(graph));
    });
    return out;
  }

  private invalidateMirrorRegions(regions: ReadonlyArray<{ index: number; bounds: Bounds }>): void {
    for (const { index, bounds } of regions) this.renderer?.invalidateRegion(index, bounds);
  }

  private renderGroupDraft(): void {
    const drag = this.groupDrag;
    const box = drag ? this.boxForPage(drag.selection.pageId) : null;
    if (!drag?.lifted || !box) return;
    const { strokes, images } = drag.selection;
    const fingers = drag.fingers?.motion;
    if (fingers) {
      // A turn about the middle, after the move a finger made first.
      const { anchor, angle } = fingers;
      this.renderer?.renderSelectionDraft(
        box.index,
        strokes,
        images,
        fingers.dx,
        fingers.dy,
        this.inkPressure,
        undefined,
        { x: anchor.x, y: anchor.y, angle },
        drag.selection.tables ?? [],
        drag.selection.graphs ?? [],
      );
      return;
    }
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
      drag.selection.tables ?? [],
      drag.selection.graphs ?? [],
      // A move is carried over the desk and onto other pages, not cut at its own page's edge.
      scale !== null || drag.turn !== null,
    );
    this.renderDraggedConnectors(drag, box);
    this.requestZoomPaint();
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
    this.showTurnLabel(null, null, 0, false);
    this.selectionFrameEl.removeEventListener("pointermove", this.onSelectionPointerMove);
    this.selectionFrameEl.removeEventListener("pointerup", this.onSelectionPointerEnd);
    this.selectionFrameEl.removeEventListener("pointercancel", this.onSelectionPointerEnd);
    if (this.selectionFrameEl.hasPointerCapture(drag.pointerId)) {
      this.selectionFrameEl.releasePointerCapture(drag.pointerId);
    }
    if (!drag.lifted) {
      // A tap in a cell of a table picked up on its own types in that cell,
      // as a second tap on a table does in Keynote and Numbers. Inside the
      // pointerup, so iPadOS raises the keyboard for the focus.
      const table =
        commit && !drag.scale && !drag.turn && !drag.fingers
          ? this.loneTable(drag.selection)
          : null;
      const cell = table ? cellAt(this.tableLayout(table), drag.from.x, drag.from.y) : null;
      if (table && cell) {
        this.startCellEdit(drag.selection.pageId, table, cell);
        return;
      }
      this.syncSelectionOverlay();
      return;
    }
    this.renderer?.setHiddenStrokes(NO_STROKES);
    this.renderer?.setHiddenImages(NO_IMAGES);
    this.renderer?.setHiddenTables(NO_TABLES);
    this.renderer?.setHiddenGraphs(NO_GRAPHS);
    if (drag.connectors && drag.connectors.size > 0) {
      this.renderer?.setHiddenConnectors(NO_CONNECTORS);
      // Back into the tiles where they are; a move repaints where they were too (`changed`).
      this.invalidateConnectors(drag.selection.pageId, drag.connectors);
    }
    this.renderer?.clearWet();
    // Mirrors hidden for the drag show again; moved, they are rebuilt (`syncMirrors`).
    this.invalidateMirrorRegions(this.selectionMirrors(drag.selection).regions);
    const { pageId } = drag.selection;
    const box = this.boxForPage(pageId);
    const scale = drag.scale;
    const fingers = drag.fingers?.motion;
    if (scale) {
      for (const textBox of drag.selection.textBoxes) {
        this.textBoxInputs
          .get(`${pageId}:${textBox.id}`)
          ?.root.setCssStyles({ transform: "", transformOrigin: "" });
      }
    }
    const turn = drag.turn;
    // On the lift a turn that ended close to a page step lands on it exactly.
    if (commit && turn) turn.angle = turn.snap.settled();
    // Dropped on another page (that is still there): it moves to that page.
    const onto =
      !fingers &&
      !turn &&
      !scale &&
      drag.target &&
      drag.target.id !== pageId &&
      this.doc.pages.some((page) => page.id === drag.target?.id)
        ? drag.target
        : null;
    const changed = fingers
      ? !isStill(fingers)
      : turn
        ? turn.angle !== 0
        : scale
          ? scale.k !== 1
          : onto !== null || drag.dx !== 0 || drag.dy !== 0;
    const moved = commit && changed && this.doc.pages.some((page) => page.id === pageId);
    let after: Bounds | null = null;
    if (moved && fingers) {
      after = this.commitFingerTurn(drag.selection, drag.bounds, fingers);
    } else if (moved && onto && box) {
      // (dx, dy) are in the selection's own page's space: shift them into the target's.
      this.history.push(
        this.doc,
        new MoveElementsToPage(
          pageId,
          onto.id,
          drag.selection,
          drag.dx + box.x - onto.x,
          drag.dy + box.y - onto.y,
        ),
      );
      this.strokeIndex.refreshPages(this.doc.pages, [pageId, onto.id]);
      this.selection = { ...drag.selection, pageId: onto.id };
      const landed = this.groupBounds(this.selection);
      if (landed) this.renderer?.invalidateRegion(onto.index, landed);
    } else if (moved && turn) {
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
    // Joined, its mirrors may change on any page the move reached (`syncMirrors`).
    if (moved) this.changed(onto ? (this.joined ? undefined : [pageId, onto.id]) : [pageId]);
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
    const heights = this.measuredHeights(sel);
    this.history.push(
      this.doc,
      new ReorientElements(sel.pageId, sel, motion, centre.x, centre.y, heights),
    );
    this.strokeIndex.refreshPages(this.doc.pages, [sel.pageId]);
    const after = this.groupBounds(sel);
    this.carryOutline(before, after, (x, y) => reorientPoint(motion, centre.x, centre.y, x, y));
    return after;
  }

  /** Commit two fingers' turn of a selection as one step (`turnCommand`); returns its bounds after. */
  private commitFingerTurn(sel: GroupSelection, before: Bounds, motion: TurnMotion): Bounds | null {
    const command = turnCommand(sel.pageId, sel, motion, this.measuredHeights(sel));
    if (!command) return before;
    this.history.push(this.doc, command);
    this.strokeIndex.refreshPages(this.doc.pages, [sel.pageId]);
    const after = this.groupBounds(sel);
    this.carryOutline(before, after, (x, y) => turnPoint(motion, { x, y }));
    return after;
  }

  /** The heights the view measured for a selection's text boxes and tables, for a turn. */
  private measuredHeights(sel: GroupSelection): Map<TextBoxElement | TableElement, number> {
    const heights = new Map<TextBoxElement | TableElement, number>();
    for (const textBox of sel.textBoxes) {
      heights.set(textBox, this.textBoxFrameOf(sel.pageId, textBox).h);
    }
    for (const table of sel.tables ?? []) heights.set(table, this.tableFrameOf(table).h);
    return heights;
  }

  /**
   * Carry the freehand loop along with a motion of its selection: it is
   * stored relative to the bounds' corner, which has moved.
   */
  private carryOutline(
    before: Bounds,
    after: Bounds | null,
    map: (x: number, y: number) => Pt,
  ): void {
    const outline = this.selectionOutline;
    if (!outline || !after) return;
    const loop: number[] = [];
    for (let i = 0; i + 1 < outline.loop.length; i += 2) {
      const p = map(before.minX + outline.loop[i], before.minY + outline.loop[i + 1]);
      loop.push(p.x - after.minX, p.y - after.minY);
    }
    this.selectionOutline = { ...outline, loop };
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
    this.endPointDrag(false);
    this.endLinkDrag(false);
  }

  /** Repaint the tiles under page `pageId`'s connectors in `ids`, where they are now. */
  private invalidateConnectors(pageId: string, ids: ReadonlySet<string>): void {
    const box = this.boxForPage(pageId);
    const page = this.doc.pages.find((candidate) => candidate.id === pageId);
    if (!box || !page) return;
    for (const routed of routeConnectors(page, undefined, (c) => ids.has(c.id))) {
      const b = connectorBounds(routed);
      if (b) this.renderer?.invalidateRegion(box.index, b);
    }
  }

  // --- Linked shapes: a side dot drags out a joined copy (discussion #51) ------

  /** The four dots beside a lone shape's sides; made on first use. */
  private linkDotsEl: HTMLElement | null = null;
  /** A side dot being dragged out into a linked copy, from pointerdown to lift. */
  private linkDrag: LinkDrag | null = null;
  /**
   * The shape a side dot just made, while the bar of shapes to turn it into
   * shows in place of the action bar; null once anything else happens.
   */
  private linkBar: { pageId: string; stroke: Stroke } | null = null;
  /** That bar; made on first use. */
  private typeBar: SelectionActionBar | null = null;
  /** Where each connector was last drawn, so a move repaints both places. */
  private connectorShown: Map<string, { pageId: string; bounds: Bounds }> | null = null;

  /** The one closed shape a selection holds on its own; null for anything else. */
  private loneLinkShape(sel: GroupSelection | null): Stroke | null {
    if (!sel || sel.strokes.length !== 1 || sel.images.length > 0 || sel.textBoxes.length > 0) {
      return null;
    }
    if ((sel.tables?.length ?? 0) > 0 || (sel.graphs?.length ?? 0) > 0) return null;
    const stroke = sel.strokes[0];
    return isWholeClosedShape(stroke) ? stroke : null;
  }

  /** Where the dot for `side` sits, page space: just outside the frame's side. */
  private linkDotPoint(bounds: Bounds, side: ConnectorSide): Pt {
    // Just outside the frame, however far out the frame stands.
    const pad = (this.framePad + LINK_DOT_GAP_PX) / this.unitScale;
    const grown: Bounds = {
      minX: bounds.minX - pad,
      minY: bounds.minY - pad,
      maxX: bounds.maxX + pad,
      maxY: bounds.maxY + pad,
    };
    return sideMiddle(grown, side);
  }

  /** Put a dot beside each side of the lone closed shape selected; none otherwise. */
  private syncLinkDots(sel: GroupSelection | null, box: PageBox | null): void {
    const stroke = this.loneLinkShape(sel);
    const bounds = stroke && sel ? this.groupBounds(sel) : null;
    const dragging =
      this.groupDrag?.lifted === true ||
      this.linkDrag?.lifted === true ||
      this.pointDrag?.lifted === true;
    if (!box || !bounds || dragging) {
      this.linkDotsEl?.addClass("is-hidden");
      return;
    }
    const el = (this.linkDotsEl ??= this.selectionUiEl.createDiv({
      cls: "goodobsidian-link-dots is-hidden",
    }));
    while (el.childElementCount < CONNECTOR_SIDES.length) {
      // Outside the frame, so a press on one is handed to the frame's own
      // handler, which captures the pointer on the frame (as the knob, a
      // child of the frame, has its presses bubble there).
      const dot = el.createDiv({ cls: "goodobsidian-link-dot" });
      dot.addEventListener("pointerdown", this.onSelectionPointerDown);
    }
    const scale = this.unitScale;
    CONNECTOR_SIDES.forEach((side, i) => {
      const at = this.linkDotPoint(bounds, side);
      (el.children[i] as HTMLElement).setCssStyles({
        left: `${(box.x + at.x) * scale}px`,
        top: `${(box.y + at.y) * scale}px`,
      });
    });
    el.removeClass("is-hidden");
  }

  /**
   * A press at page point `from` on the frame of a lone closed shape: when
   * it is on a side dot (and nearer to it than to the rotate knob), start
   * dragging out a linked copy from that side, and say so.
   */
  private grabLinkDot(event: PointerEvent, sel: GroupSelection, bounds: Bounds, from: Pt): boolean {
    const stroke = this.loneLinkShape(sel);
    if (!stroke) return false;
    const scale = this.unitScale;
    const knob = selectionKnobPoint(this.selectionFrameOf(bounds), ROTATE_HANDLE_OFFSET_PX / scale);
    const toKnob = Math.hypot(knob.x - from.x, knob.y - from.y);
    let side: ConnectorSide | null = null;
    let best = LINK_DOT_HIT_RADIUS_PX / scale;
    for (const s of CONNECTOR_SIDES) {
      const at = this.linkDotPoint(bounds, s);
      const d = Math.hypot(at.x - from.x, at.y - from.y);
      if (d <= best) {
        best = d;
        side = s;
      }
    }
    if (!side || toKnob < best) return false;
    // A corner ring nearer the press than the dot keeps it (a diamond's
    // corners sit on its sides' middles, a dot's width from the dots).
    const rings = this.shapePointsOn ? (this.loneShape(sel)?.handles.at ?? []) : [];
    for (let i = 0; i + 1 < rings.length; i += 2) {
      if (Math.hypot(rings[i] - from.x, rings[i + 1] - from.y) < best) return false;
    }
    this.linkDrag = {
      pointerId: event.pointerId,
      pageId: sel.pageId,
      stroke,
      side,
      clientX: event.clientX,
      clientY: event.clientY,
      lifted: false,
      offset: null,
      target: null,
      targetSide: "left",
    };
    this.linkBar = null;
    this.selectionFrameEl.addEventListener("pointermove", this.onLinkPointerMove);
    this.selectionFrameEl.addEventListener("pointerup", this.onLinkPointerEnd);
    this.selectionFrameEl.addEventListener("pointercancel", this.onLinkPointerEnd);
    return true;
  }

  /** How far the copy is moved from the original, page px, with the drag at page point `pen`. */
  private linkOffset(drag: LinkDrag, box: PageBox, pen: Pt | null): Pt | null {
    const b = strokeBounds(drag.stroke);
    if (!b) return null;
    const raw = pen
      ? draggedOffset(b, drag.side, pen)
      : besideOffset(b, drag.side, this.atFitZoom(LINK_GAP_PX));
    // The whole copy stays on the page (a shape too big for it, its middle).
    const fit = (lo: number, hi: number, d: number, size: number): number =>
      hi - lo <= size ? clamp(d, -lo, size - hi) : clamp(d, -(lo + hi) / 2, size - (lo + hi) / 2);
    return {
      x: fit(b.minX, b.maxX, raw.x, box.width),
      y: fit(b.minY, b.maxY, raw.y, box.height),
    };
  }

  /** The copy and its connector as they would be with the copy moved by `offset`. */
  private linkDraft(
    drag: LinkDrag,
    offset: Pt,
  ): { pts: number[]; toSide: ConnectorSide; routed: RoutedConnector | null } | null {
    const pts = translatePoints(drag.stroke.pts, offset.x, offset.y);
    const a = strokeBounds(drag.stroke);
    const b = boundsOfPts(pts);
    if (!a || !b) return null;
    const toSide = facingSide(a, b);
    const route = connectorRoute(drag.stroke.pts, drag.side, pts, toSide);
    const connector: ShapeConnector = {
      id: "",
      from: { stroke: drag.stroke.id, side: drag.side },
      to: { stroke: "", side: toSide },
      color: drag.stroke.color,
      size: CONNECTOR_WIDTH,
    };
    return { pts, toSide, routed: route ? { connector, route } : null };
  }

  private readonly onLinkPointerMove = (event: PointerEvent): void => {
    const drag = this.linkDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.stopPropagation();
    event.preventDefault();
    const moved = Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY);
    if (!drag.lifted && moved < this.linkSlopPx()) return;
    const box = this.boxForPage(drag.pageId);
    if (!box) return;
    const pen = this.pagePoint(box, event.clientX, event.clientY);
    drag.target = this.linkTargetAt(drag, pen);
    const targetBounds = drag.target ? strokeBounds(drag.target) : null;
    if (drag.target && targetBounds) {
      drag.targetSide = nearestSide(targetBounds, pen);
      const joined = this.linkToTarget(drag, drag.target);
      if (!drag.lifted) {
        drag.lifted = true;
        this.syncSelectionOverlay();
      }
      // Only the arrow: the copy a move away from it drew is wiped first.
      this.renderer?.clearWet();
      if (joined) this.renderer?.paintWetConnectors(box.index, [joined.routed]);
      return;
    }
    const offset = this.linkOffset(drag, box, pen);
    const draft = offset ? this.linkDraft(drag, offset) : null;
    if (!offset || !draft) return;
    drag.offset = offset;
    if (!drag.lifted) {
      drag.lifted = true;
      this.syncSelectionOverlay();
    }
    // The copy and its arrow on the wet layer; nothing in the tiles changes until the lift.
    const stroke = drag.stroke;
    this.renderer?.renderWet(box.index, draft.pts, {
      color: stroke.color,
      size: stroke.size,
      tool: stroke.tool,
      usePressure: this.inkPressure,
      shape: true,
      decor: decorOf(stroke),
    });
    if (draft.routed) this.renderer?.paintWetConnectors(box.index, [draft.routed]);
  };

  /** A drag shorter than this is a tap on the dot, screen px. */
  private linkSlopPx(): number {
    return IMAGE_DRAG_SLOP_PX * 2;
  }

  private readonly onLinkPointerEnd = (event: PointerEvent): void => {
    const drag = this.linkDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.stopPropagation();
    this.endLinkDrag(event.type === "pointerup" || drag.lifted);
  };

  /**
   * Finish a side-dot drag: make the linked copy where the drag left it (a
   * tap puts it beside the original, a gap away) as one `AddLinkedCopy`,
   * select it, and offer the bar of shapes to turn it into.
   */
  private endLinkDrag(commit: boolean): void {
    const drag = this.linkDrag;
    if (!drag) return;
    this.linkDrag = null;
    this.selectionFrameEl.removeEventListener("pointermove", this.onLinkPointerMove);
    this.selectionFrameEl.removeEventListener("pointerup", this.onLinkPointerEnd);
    this.selectionFrameEl.removeEventListener("pointercancel", this.onLinkPointerEnd);
    if (this.selectionFrameEl.hasPointerCapture(drag.pointerId)) {
      this.selectionFrameEl.releasePointerCapture(drag.pointerId);
    }
    this.renderer?.clearWet();
    const box = this.boxForPage(drag.pageId);
    const page = this.doc.pages.find((candidate) => candidate.id === drag.pageId);
    if (drag.target) {
      this.joinLinkTarget(drag, drag.target, commit, box, page);
      return;
    }
    const offset = box ? (drag.offset ?? this.linkOffset(drag, box, null)) : null;
    const draft = offset ? this.linkDraft(drag, offset) : null;
    if (!commit || !box || !page || !draft || !page.strokes.includes(drag.stroke)) {
      this.syncSelectionOverlay();
      return;
    }
    const source = drag.stroke;
    const copy: Stroke = { ...structuredClone(source), id: this.strokeIds.next(), pts: draft.pts };
    // A copy is not handwriting of that moment, and does not sit on a note.
    delete copy.t0;
    delete copy.samples;
    delete copy.onSticky;
    const connector: ShapeConnector = {
      id: nextConnectorId(this.doc),
      from: { stroke: source.id, side: drag.side },
      to: { stroke: copy.id, side: draft.toSide },
      color: source.color,
      size: CONNECTOR_WIDTH,
    };
    this.history.push(this.doc, new AddLinkedCopy(page.id, copy, connector));
    this.strokeIndex.add(page.id, copy);
    const made = boundsOfPts(copy.pts);
    if (made) this.renderer?.invalidateRegion(box.index, made);
    this.renderDry();
    this.changed([page.id]);
    this.select(page.id, { strokes: [copy], images: [], textBoxes: [] });
    this.linkBar = { pageId: page.id, stroke: copy };
    this.syncActionBar();
  }

  /**
   * The shape a side dot's arrow would be dropped on with the pen at page
   * point `pen`: the topmost closed shape on the page, other than the one
   * dragged from, whose bounds (and a finger's width round them) hold the
   * pen. Null for none.
   */
  private linkTargetAt(drag: LinkDrag, pen: Pt): Stroke | null {
    const page = this.doc.pages.find((candidate) => candidate.id === drag.pageId);
    if (!page) return null;
    const reach = this.atFitZoom(LINK_DOT_HIT_RADIUS_PX / 2);
    const near = this.strokeIndex.near(page.id, pen.x, pen.y, reach);
    let target: Stroke | null = null;
    let order = -1;
    for (const id of near) {
      const stroke = this.strokeIndex.get(id);
      if (!stroke || stroke === drag.stroke || !isWholeClosedShape(stroke)) {
        continue;
      }
      const b = strokeBounds(stroke);
      if (!b) continue;
      const inside =
        pen.x >= b.minX - reach &&
        pen.x <= b.maxX + reach &&
        pen.y >= b.minY - reach &&
        pen.y <= b.maxY + reach;
      if (!inside) continue;
      const at = page.strokes.indexOf(stroke);
      if (at > order) {
        order = at;
        target = stroke;
      }
    }
    return target;
  }

  /** The arrow from the dragged side to the side of `target` that faces it. */
  private linkToTarget(
    drag: LinkDrag,
    target: Stroke,
  ): { routed: RoutedConnector; toSide: ConnectorSide } | null {
    const toSide = drag.targetSide;
    const route = connectorRoute(drag.stroke.pts, drag.side, target.pts, toSide);
    if (!route) return null;
    const connector: ShapeConnector = {
      id: "",
      from: { stroke: drag.stroke.id, side: drag.side },
      to: { stroke: target.id, side: toSide },
      color: drag.stroke.color,
      size: CONNECTOR_WIDTH,
    };
    return { routed: { connector, route }, toSide };
  }

  /**
   * A side dot's arrow dropped on `target`: one `AddConnector` joining the
   * two (no copy, no bar of shapes); the shape dragged from stays selected.
   */
  private joinLinkTarget(
    drag: LinkDrag,
    target: Stroke,
    commit: boolean,
    box: PageBox | null,
    page: Page | undefined,
  ): void {
    const joined = this.linkToTarget(drag, target);
    const live = page?.strokes.includes(drag.stroke) && page.strokes.includes(target);
    if (!commit || !box || !page || !joined || !live) {
      this.syncSelectionOverlay();
      return;
    }
    const connector: ShapeConnector = {
      ...joined.routed.connector,
      id: nextConnectorId(this.doc),
    };
    this.history.push(this.doc, new AddConnector(page.id, connector));
    const drawn = connectorBounds({ connector, route: joined.routed.route });
    if (drawn) this.renderer?.invalidateRegion(box.index, drawn);
    this.renderDry();
    this.changed([page.id]);
    this.syncSelectionOverlay();
  }

  /** Whether the bar of shapes shows for `group`: it is exactly the shape a side dot just made. */
  private linkBarFor(group: GroupSelection): boolean {
    const bar = this.linkBar;
    const ok =
      bar !== null &&
      group.pageId === bar.pageId &&
      group.strokes.length === 1 &&
      group.strokes[0] === bar.stroke &&
      group.images.length === 0 &&
      group.textBoxes.length === 0 &&
      (group.tables?.length ?? 0) === 0 &&
      (group.graphs?.length ?? 0) === 0;
    if (!ok) this.linkBar = null;
    return ok;
  }

  /** Show the bar of shapes the new linked shape can become, above `anchor` (paper px). */
  private showTypeBar(anchor: Bounds, clearAbove: number, clearBelow: number): void {
    const bar = this.linkBar;
    if (!bar) return;
    const kind = bar.stroke.shape;
    const bar2 = (this.typeBar ??= new SelectionActionBar(this.selectionUiEl, "Shape"));
    bar2.setActions(
      LINK_TYPES.map((t) => ({
        id: `type-${t.kind}`,
        icon: t.icon,
        label: t.label,
        group: "type",
        bar: true,
        // The bar is the whole choice: no "…" menu behind it.
        menu: "none" as const,
        checked: kind === t.kind,
        run: () => this.retypeLinked(t.kind),
      })),
    );
    bar2.show(anchor, this.visiblePaperRect(), { clearAbove, clearBelow });
  }

  /**
   * Turn the shape a side dot just made into `kind`, in its box, as one
   * `RetypeShape`: its colour, width and style stay, and so does its arrow.
   */
  private retypeLinked(kind: BoxPreset): void {
    const bar = this.linkBar;
    const page = bar ? this.doc.pages.find((candidate) => candidate.id === bar.pageId) : null;
    const box = bar ? this.boxForPage(bar.pageId) : null;
    if (!bar || !page || !box || bar.stroke.shape === kind) return;
    const stroke = bar.stroke;
    const before = strokeBounds(stroke);
    if (!before || !page.strokes.includes(stroke)) return;
    const pressure = stroke.pts[2] ?? FALLBACK_PRESSURE;
    const pts = presetGeometry(
      kind,
      { x: before.minX, y: before.minY },
      { x: before.maxX, y: before.maxY },
      pressure,
    );
    if (pts.length === 0) return;
    this.history.push(this.doc, new RetypeShape(page.id, stroke, pts, kind));
    this.strokeIndex.remove(stroke.id, page.id);
    this.strokeIndex.add(page.id, stroke);
    this.renderer?.invalidateRegion(box.index, unionBounds(before, strokeBounds(stroke)) ?? before);
    this.renderDry();
    this.changed([page.id]);
    this.syncSelectionOverlay();
  }

  /**
   * Repaint the tiles where a connector was drawn and where it is now, for
   * every connector whose route changed since the last look (a shape at
   * either end moved, was erased, or came back with an undo). Connectors
   * reach between their shapes, outside the region a move of either shape
   * invalidates, so this runs after every change.
   */
  private syncConnectorTiles(): void {
    const shown = (this.connectorShown ??= new Map<string, { pageId: string; bounds: Bounds }>());
    const seen = new Set<string>();
    let dirty = false;
    this.doc.pages.forEach((page, index) => {
      if (!page.connectors || page.connectors.length === 0) return;
      for (const routed of routeConnectors(page)) {
        const id = routed.connector.id;
        const now = connectorBounds(routed);
        if (!now) continue;
        seen.add(id);
        const was = shown.get(id);
        if (was && was.pageId === page.id && sameBounds(was.bounds, now)) continue;
        if (was) {
          const at = this.boxForPage(was.pageId);
          if (at) this.renderer?.invalidateRegion(at.index, was.bounds);
        }
        this.renderer?.invalidateRegion(index, now);
        shown.set(id, { pageId: page.id, bounds: now });
        dirty = true;
      }
    });
    for (const [id, was] of shown) {
      if (seen.has(id)) continue;
      const at = this.boxForPage(was.pageId);
      if (at) this.renderer?.invalidateRegion(at.index, was.bounds);
      shown.delete(id);
      dirty = true;
    }
    if (dirty) this.requestFrame();
  }

  /** The connectors joined to any of `strokes` on page `pageId`, by id. */
  private connectorIdsOf(pageId: string, strokes: readonly Stroke[]): Set<string> {
    const page = this.doc.pages.find((candidate) => candidate.id === pageId);
    const ids = new Set<string>();
    if (!page?.connectors) return ids;
    const moved = new Set(strokes.map((stroke) => stroke.id));
    for (const c of liveConnectors(page)) {
      if (moved.has(c.from.stroke) || moved.has(c.to.stroke)) ids.add(c.id);
    }
    return ids;
  }

  /**
   * While a lasso selection is dragged, the connectors joined to it are
   * drawn on the wet layer over its draft, routed from where the drag has
   * its shapes (moved, resized or turned as the draft is).
   */
  private renderDraggedConnectors(drag: GroupDrag, box: PageBox): void {
    const ids = drag.connectors;
    const page = this.doc.pages[box.index];
    if (!ids || ids.size === 0 || !page) return;
    const moved = new Map<string, readonly number[]>();
    for (const stroke of drag.selection.strokes) {
      let pts: number[];
      if (drag.turn) {
        const motion: Reorientation = { kind: "rotate", angle: drag.turn.angle };
        pts = reorientPoints(stroke.pts, motion, drag.turn.centre.x, drag.turn.centre.y);
      } else if (drag.scale) {
        pts = scalePoints(stroke.pts, drag.scale.anchor.x, drag.scale.anchor.y, drag.scale.k);
      } else {
        pts = translatePoints(stroke.pts, drag.dx, drag.dy);
      }
      moved.set(stroke.id, pts);
    }
    const routed = routeConnectors(
      page,
      (id) => moved.get(id),
      (c) => ids.has(c.id),
    );
    this.renderer?.paintWetConnectors(box.index, routed);
  }

  // --- A lone shape's point handles (discussion #51) ------------------------

  /** The dots on a lone selected shape's corners and ends; made on first use. */
  private shapePointsEl: HTMLElement | null = null;
  /**
   * Whether the lone shape selected shows its corner rings: off when it is
   * selected, switched by the bar's corner points button (Joost,
   * 2026-10-29), so a tap on a shape shows only its resize handles.
   */
  private shapePointsOn = false;
  private pointDrag: PointDrag | null = null;

  /**
   * How far the selection's frame stands outside its bounds, screen px:
   * wider round a lone shape whose rings and corner squares both show.
   */
  private get framePad(): number {
    // Rings and corner squares both showing: the squares stand clear.
    return this.shapePointsOn && this.selectionCorners && this.loneShape(this.selection)
      ? SHAPE_FRAME_PAD_PX
      : SELECTION_PAD_PX;
  }

  /** The one shape a selection holds on its own, and its point handles; null otherwise. */
  private loneShape(sel: GroupSelection | null): { stroke: Stroke; handles: PointHandles } | null {
    if (!sel || sel.strokes.length !== 1 || sel.images.length > 0 || sel.textBoxes.length > 0) {
      return null;
    }
    if ((sel.tables?.length ?? 0) > 0 || (sel.graphs?.length ?? 0) > 0) return null;
    const stroke = sel.strokes[0];
    const handles = pointHandles(stroke.shape, stroke.pts);
    return handles ? { stroke, handles } : null;
  }

  /**
   * Put a dot on each corner and end of the lone shape selected, where a
   * point drag has them now; none for any other selection, or while the
   * whole selection is dragged (`sel` null). The frame takes the presses.
   */
  private syncShapePoints(sel: GroupSelection | null, box: PageBox | null): void {
    const drag = this.pointDrag;
    const lone = drag ?? (box && this.shapePointsOn ? this.loneShape(sel) : null);
    if (!lone || !box) {
      this.shapePointsEl?.addClass("is-hidden");
      return;
    }
    const el = (this.shapePointsEl ??= this.selectionUiEl.createDiv({
      cls: "goodobsidian-shape-points",
    }));
    el.removeClass("is-hidden");
    const at = lone.handles.at;
    const count = at.length / 2;
    while (el.childElementCount < count) el.createDiv({ cls: "goodobsidian-shape-point" });
    while (el.childElementCount > count) el.lastElementChild?.remove();
    const scale = this.unitScale;
    for (let h = 0; h < count; h++) {
      const dot = el.children[h] as HTMLElement;
      const moved = drag?.draft && drag.handle === h ? drag.draft.at : null;
      const x = moved ? moved.x : at[h * 2];
      const y = moved ? moved.y : at[h * 2 + 1];
      dot.setCssStyles({ left: `${(box.x + x) * scale}px`, top: `${(box.y + y) * scale}px` });
      dot.toggleClass("is-dragging", drag?.lifted === true && drag.handle === h);
    }
  }

  /**
   * A press at page point `from` on the frame of a lone shape: start
   * dragging the corner or end it took, and say so.
   */
  private grabShapePoint(event: PointerEvent, sel: GroupSelection, from: Pt): boolean {
    if (!this.shapePointsOn) return false;
    const lone = this.loneShape(sel);
    const before = lone ? strokeBounds(lone.stroke) : null;
    if (!lone || !before) return false;
    const reach = POINT_HIT_RADIUS_PX / this.unitScale;
    const f = this.selectionFrameOf(this.groupBounds(sel) ?? before);
    // The frame's corner squares, while they show, keep the presses nearer them.
    const corners = this.selectionCorners
      ? [
          { x: f.minX, y: f.minY },
          { x: f.maxX, y: f.minY },
          { x: f.maxX, y: f.maxY },
          { x: f.minX, y: f.maxY },
        ]
      : [];
    const handle = pickPointHandle(lone.handles.at, from, reach, corners);
    if (handle < 0) return false;
    const at = lone.handles.at;
    this.pointDrag = {
      pointerId: event.pointerId,
      pageId: sel.pageId,
      stroke: lone.stroke,
      handles: lone.handles,
      handle,
      grab: { x: at[handle * 2] - from.x, y: at[handle * 2 + 1] - from.y },
      clientX: event.clientX,
      clientY: event.clientY,
      before,
      lifted: false,
      draft: null,
    };
    this.selectionFrameEl.addEventListener("pointermove", this.onPointPointerMove);
    this.selectionFrameEl.addEventListener("pointerup", this.onPointPointerEnd);
    this.selectionFrameEl.addEventListener("pointercancel", this.onPointPointerEnd);
    return true;
  }

  private readonly onPointPointerMove = (event: PointerEvent): void => {
    const drag = this.pointDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.stopPropagation();
    event.preventDefault();
    const moved = Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY);
    if (!drag.lifted && moved < IMAGE_DRAG_SLOP_PX) return;
    const box = this.boxForPage(drag.pageId);
    if (!box) return;
    const p = this.pagePoint(box, event.clientX, event.clientY);
    const stroke = drag.stroke;
    const to = this.snapDraggedPoint(box, drag, {
      x: clamp(p.x + drag.grab.x, 0, box.width),
      y: clamp(p.y + drag.grab.y, 0, box.height),
    });
    const next = movePoint(stroke.shape ?? "polygon", stroke.pts, drag.handles, drag.handle, to);
    if (!next) return;
    drag.draft = { ...next, at: to };
    if (!drag.lifted) {
      // Out of the tiles once, as a dragged selection is: each frame after
      // this is one shape on the wet layer, never a tile rasterised again.
      drag.lifted = true;
      this.renderer?.setHiddenStrokes(new Set([stroke.id]));
      this.renderer?.invalidateRegion(box.index, drag.before);
      this.renderDry();
      this.selectionFrameEl.addClass("is-pointing");
      this.syncActionBar();
      // The side dots step aside with the frame.
      this.syncLinkDots(null, box);
    }
    this.renderer?.renderWet(box.index, next.pts, {
      color: stroke.color,
      size: stroke.size,
      tool: stroke.tool,
      usePressure: this.inkPressure,
      shape: true,
      decor: decorOf({ ...stroke, shape: next.kind }),
    });
    this.syncShapePoints(null, box);
  };

  /**
   * Where a dragged corner or end goes: onto another shape's corner, end or
   * midpoint near it (never its own shape's), with the snap ring; else, for
   * a line's or arrow's end, level or upright with the other end when it is
   * within a few degrees of either.
   */
  private snapDraggedPoint(box: PageBox, drag: PointDrag, p: Pt): Pt {
    this.shapeSnapper.exclude = drag.stroke;
    const snapped = this.snapNear(box, p.x, p.y);
    this.shapeSnapper.exclude = null;
    if (snapped) {
      const hit = this.shapeSnapper.hit;
      this.showSnapMarker(box, hit);
      return { x: hit.x, y: hit.y };
    }
    this.showSnapMarker(null, null);
    const { at, points, arrow } = drag.handles;
    const line = arrow || (points.length === 2 && points.every((list) => list.length === 1));
    if (!line) return p;
    const other = 1 - drag.handle;
    const ox = at[other * 2];
    const oy = at[other * 2 + 1];
    const turn = levelTurn(p.x - ox, p.y - oy, this.atFitZoom(LINE_LEVEL_RISE));
    if (turn === 0) return p;
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    const dx = p.x - ox;
    const dy = p.y - oy;
    return { x: ox + dx * c - dy * s, y: oy + dx * s + dy * c };
  }

  /** The lift commits the point's move; a pointercancel too, as a group drag's does. */
  private readonly onPointPointerEnd = (event: PointerEvent): void => {
    const drag = this.pointDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.stopPropagation();
    this.endPointDrag(true);
  };

  /**
   * Finish a point drag: commit it as one `ReshapeStroke` (`commit`) or
   * drop it, then put the shape back into the tiles over the region it
   * covered before and covers now.
   */
  private endPointDrag(commit: boolean): void {
    const drag = this.pointDrag;
    if (!drag) return;
    this.pointDrag = null;
    this.selectionFrameEl.removeEventListener("pointermove", this.onPointPointerMove);
    this.selectionFrameEl.removeEventListener("pointerup", this.onPointPointerEnd);
    this.selectionFrameEl.removeEventListener("pointercancel", this.onPointPointerEnd);
    if (this.selectionFrameEl.hasPointerCapture(drag.pointerId)) {
      this.selectionFrameEl.releasePointerCapture(drag.pointerId);
    }
    this.selectionFrameEl.removeClass("is-pointing");
    this.showSnapMarker(null, null);
    if (!drag.lifted) {
      this.syncSelectionOverlay();
      return;
    }
    this.renderer?.setHiddenStrokes(NO_STROKES);
    this.renderer?.clearWet();
    const { pageId, stroke } = drag;
    const draft = commit ? drag.draft : null;
    const done = draft !== null && this.doc.pages.some((page) => page.id === pageId);
    let after: Bounds | null = null;
    if (done) {
      this.history.push(this.doc, new ReshapeStroke(pageId, stroke, draft.pts, draft.kind));
      this.strokeIndex.remove(stroke.id, pageId);
      this.strokeIndex.add(pageId, stroke);
      after = strokeBounds(stroke);
      // The lasso's loop no longer goes round the shape it was drawn round.
      this.selectionOutline = null;
    }
    const box = this.boxForPage(pageId);
    if (box) {
      this.renderer?.invalidateRegion(box.index, unionBounds(drag.before, after) ?? drag.before);
    }
    this.renderDry();
    this.syncSelectionOverlay();
    if (done) this.changed([pageId]);
  }

  /**
   * A mouse right-clicked layout point `at` of `box` (client px given too):
   * open the link, suggestion or flagged word there, or a PDF link, or
   * hand ink to the stroke-tap handler, as a finger tap would. False when
   * nothing there took it, so the press menu opens instead.
   */
  private mouseTapsInk(box: PageBox, at: Pt, clientX: number, clientY: number): boolean {
    const page = this.pageAt(box.index);
    if (!page) return false;
    const p = this.toPage(box, at);
    const tolerance = MOUSE_TAP_TOLERANCE_PX / this.unitScale;
    this.tapClient = { x: clientX, y: clientY };
    // A press menu open elsewhere closes first; opening it again clears it anyway.
    if (this.pressMenu) this.clearSelection();
    return (
      this.toggleTapeAt(page, p, tolerance) ||
      this.openLinkAt(page, p, tolerance) ||
      this.followPdfLink(box.index, p, tolerance, false) ||
      this.offerStrokeTap(box, p, MOUSE_TAP_TOLERANCE_PX)
    );
  }

  /**
   * A finger tapped the page (client px). With the lasso it selects, like a
   * Pencil tap; with any other tool it lets go of a selected image, and a
   * tap on a shape, a table or a picture picks the lasso and selects it
   * (`fingerPicksShape`, `fingerPicksPicture`) — fingers never draw. While audio replay is open, a tap on ink goes to
   * it first, whatever the tool.
   */
  private onFingerTap(clientX: number, clientY: number): void {
    if (this.lasso || this.imageDrag || this.groupDrag) return;
    if (this.stickyPlace && this.placeStickyAt(clientX, clientY)) return;
    if (this.fingerOpensFoldedNote(clientX, clientY)) return;
    // A second tap close after one that did nothing zooms (`zoomOnDoubleTap`).
    const plain = { x: clientX, y: clientY, t: now() };
    const paired = pairsAsDoubleTap(this.plainTap, plain);
    this.plainTap = null;
    if (paired) {
      this.zoomOnDoubleTap(clientX, clientY);
      return;
    }
    // While a cell is typed in, a finger tap in another cell of that table types there.
    if (this.cellEdit && this.fingerMovesCell(clientX, clientY)) return;
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
    this.tapClient = { x: clientX, y: clientY };
    // A finger on linked ink opens the link; the pen keeps writing over it.
    const tapped = box ? this.pageAt(box.index) : null;
    if (box && tapped) {
      const tolerance = FINGER_TAP_TOLERANCE_PX / this.unitScale;
      // A cover tape lies over everything: a tap shows it through, or covers
      // it again. With the lasso a tap selects it instead, as it does ink.
      if (
        this.toolState.tool !== "select" &&
        this.toggleTapeAt(tapped, this.toPage(box, at), tolerance)
      ) {
        return;
      }
      if (this.openLinkAt(tapped, this.toPage(box, at), tolerance)) return;
      if (this.followPdfLink(box.index, this.toPage(box, at), tolerance)) return;
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
        // Then as a lasso tap reads the layers: ink, graphs, tables, pictures.
        if (
          this.fingerHoldsTextBox(tapped, p) ||
          this.fingerPicksShape(tapped, p) ||
          this.fingerPicksGraph(tapped, p) ||
          this.fingerPicksTable(tapped, p) ||
          this.fingerPicksPicture(tapped, p)
        ) {
          return;
        }
      }
      this.plainTap = plain;
      return;
    }
    if (!box) {
      // Off the pages is tapping out too: a parked box is forgotten.
      this.forgetParkedText();
      this.clearSelection();
      this.deselectImage();
      this.plainTap = plain;
      return;
    }
    this.tapSelect(box, this.toPage(box, at), FINGER_TAP_TOLERANCE_PX);
    if (!this.hasSelection()) this.plainTap = plain;
  }

  /**
   * One finger tapped twice where nothing took the taps: zoom until the
   * tapped page covers the pane, its left edge on the pane's and the tapped
   * spot as high as it was (inside the page), so nothing but the page shows;
   * from there, back to the whole page, centred. Zoom and scroll land as one
   * motion: the zoom turns about the point the move leaves in place
   * (`zoomAnchorFor`), and a last glide takes up what the clamps changed.
   */
  private zoomOnDoubleTap(clientX: number, clientY: number): void {
    // An endless board has no edge to fill: its writing size (100%), and
    // from there back to the whole drawing, about the tap.
    if (this.board) {
      const target = this.clampZoom(doubleTapZoom(this.userZoom, this.minZoom, 1));
      if (Math.abs(target - this.userZoom) < 1e-3) return;
      this.pinch = null;
      this.rowSettle = null;
      this.zoomAnim = { from: this.userZoom, to: target, t0: now(), cx: clientX, cy: clientY };
      this.requestFrame();
      return;
    }
    const at = this.toLayout(clientX, clientY);
    const box =
      boxAtPoint(this.pageLayout, at.x, at.y) ?? this.pageLayout.boxes[this.pageIndex] ?? null;
    if (!box) return;
    const fill = pageFillZoom(box.width, box.height, this.baseScale, this.cssW, this.cssH);
    const target = this.clampZoom(doubleTapZoom(this.userZoom, this.minZoom, fill));
    if (Math.abs(target - this.userZoom) < 1e-3) return;
    const rect = this.surfaceEl.getBoundingClientRect();
    const row = this.direction === "horizontal";
    const settle: ZoomSettle = {
      index: box.index,
      local: this.toPage(box, at),
      screen: { x: clientX - rect.left, y: clientY - rect.top },
      fill: target > this.userZoom,
    };
    // Aim the zoom with today's layout; the glide after it corrects for a
    // row whose gap closed as it zoomed (`syncRowGap`).
    const s0 = this.scale;
    const s1 = this.baseScale * target;
    const end = this.settleOffsets(settle, box, s1);
    const anchorX = zoomAnchorFor(this.offsetX, s0, end.x, s1) ?? settle.screen.x;
    const anchorY = zoomAnchorFor(-this.scroller.position.y, s0, end.y, s1) ?? settle.screen.y;
    this.pinch = null;
    this.rowSettle = null;
    // A row back at the floor snaps to its page as a pinch's release does.
    this.snapRowAfterZoom = row && rowTurnsPages(target, this.minZoom);
    this.zoomAnim = {
      from: this.userZoom,
      to: target,
      t0: now(),
      cx: rect.left + anchorX,
      cy: rect.top + anchorY,
      settle: this.snapRowAfterZoom ? undefined : settle,
    };
    this.requestFrame();
  }

  /**
   * Where a double tap's page puts the layout origin on screen at scale
   * `scale` (screen = offset + layout * scale): filling, the page's left
   * edge on the pane's and the tapped spot where it was, kept inside the
   * page; back at the whole page, the page centred.
   */
  private settleOffsets(settle: ZoomSettle, box: PageBox, scale: number): { x: number; y: number } {
    if (!settle.fill) {
      return {
        x: this.cssW / 2 - (box.x + box.width / 2) * scale,
        y: this.cssH / 2 - (box.y + box.height / 2) * scale,
      };
    }
    const keep = (tap: number, local: number, start: number, size: number, pane: number) =>
      Math.min(
        -start * scale,
        Math.max(pane - (start + size) * scale, tap - (start + local) * scale),
      );
    return {
      x: keep(settle.screen.x, settle.local.x, box.x, box.width, this.cssW),
      y: keep(settle.screen.y, settle.local.y, box.y, box.height, this.cssH),
    };
  }

  /**
   * A double tap's zoom ended: glide what is left to where its page belongs,
   * reckoned from the layout now (a row's pages moved closer as it zoomed).
   */
  private settleAfterZoom(settle: ZoomSettle): void {
    const box = this.pageLayout.boxes[settle.index];
    if (!box) return;
    const end = this.settleOffsets(settle, box, this.scale);
    const at = this.scroller.position;
    // A vertical stack narrower than the pane centres itself: only its height scrolls.
    const centred =
      this.direction !== "horizontal" && this.pageLayout.width * this.scale <= this.cssW;
    const x = centred ? at.x : -end.x;
    const y = -end.y;
    if (Math.hypot(x - at.x, y - at.y) < 0.5) return;
    this.scroller.glideTo(x, y, now(), DOUBLE_TAP_SETTLE_MS);
    this.syncViewport();
    this.requestFrame();
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
    if (!view) {
      this.textSeen = null;
      return;
    }
    const box = view.root.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) return;
    const page = this.surfaceEl.getBoundingClientRect();
    const at = { x: this.scroller.position.x, y: this.scroller.position.y, scale: this.scale };
    const seen = this.textSeen?.view === view ? this.textSeen.at : null;
    if (!seen || showsIn(box, page)) {
      this.textSeen = { view, at };
      return;
    }
    // Only the view moving carries a box away: the pane shrinking under it
    // (the iPad keyboard opening) does not (`carriedOutOfSight`).
    if (!carriedOutOfSight(box, page, seen, at)) return;
    this.textSeen = null;
    const parked = { view, tool: this.toolState.tool, returnTool: this.heldReturnTool };
    // The keyboard goes. With the lasso the blur keeps the box held, which
    // is let go next; the Text tool must not hand itself back.
    this.parkingText = true;
    try {
      const typing = this.editingTextView();
      if (typing) this.blurTextInput(typing.input, "out-of-sight");
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
  /**
   * A finger tapped a graph with a pen (or any tool but the lasso and Text):
   * the lasso is picked and the graph selected, its bar offering Explore and
   * Edit, as a tap on a picture does. The Pencil keeps writing over it.
   */
  private fingerPicksGraph(page: Page, p: Pt): boolean {
    if (this.practice || this.toolState.tool === "text") return false;
    const graph = graphAt(page, p);
    if (!graph) return false;
    this.setTool("select");
    this.callbacks.onToolChange?.("select");
    this.select(page.id, { strokes: [], images: [], textBoxes: [], graphs: [graph] });
    return true;
  }

  /**
   * A finger tapped a shape (a snapped shape or an arrow) with a pen, or any
   * tool but the lasso and Text: the lasso is picked and the shape selected
   * as a lasso tap selects it, with its frame, handles and bar, as a tap on
   * a picture does (discussion #51). Handwriting is left to the pen. Not in
   * a practice file. Returns whether it did.
   */
  private fingerPicksShape(page: Page, p: Pt): boolean {
    if (this.practice || this.toolState.tool === "text") return false;
    const filter = { ...lassoFilterFor(this.toolState), handwriting: false };
    const stroke = this.strokeAt(page, p, FINGER_TAP_TOLERANCE_PX / this.unitScale, filter);
    if (!stroke) return false;
    this.pickLasso();
    this.select(page.id, { strokes: [stroke], images: [], textBoxes: [] });
    return true;
  }

  /** The same for a table: it is selected with the ink in its cells, as a lasso tap takes it. */
  private fingerPicksTable(page: Page, p: Pt): boolean {
    if (this.practice || this.toolState.tool === "text") return false;
    const filter = lassoFilterFor(this.toolState);
    const table = filter.tables ? this.tableAt(page, p)?.table : undefined;
    if (!table) return false;
    this.pickLasso();
    this.select(page.id, this.tableWithInk(page, table, filter));
    return true;
  }

  /** Hand the lasso to a finger's selection, as the toolbar would. */
  private pickLasso(): void {
    this.setTool("select");
    this.callbacks.onToolChange?.("select");
  }

  // --- Graphs: exploring one on a live canvas ---------------------------------------

  /** Select a graph by id (after the host placed it). Returns whether it is there. */
  selectGraph(pageId: string, graphId: string): boolean {
    const page = this.doc.pages.find((candidate) => candidate.id === pageId);
    const graph = page?.graphs?.find((candidate) => candidate.id === graphId);
    if (!page || !graph) return false;
    this.select(page.id, { strokes: [], images: [], textBoxes: [], graphs: [graph] });
    return true;
  }

  /** Whether a graph is being explored: the harness reads this. */
  get exploring(): GraphExplorer | null {
    return this.explorer?.explorer ?? null;
  }

  /**
   * Open Explore on `graph`: it leaves the tiles (repainted once without it)
   * and a canvas over just its frame draws it live. Done commits the view as
   * one undo step; the graph then goes back into the tiles.
   */
  exploreGraph(pageId: string, graph: GraphElement): boolean {
    const page = this.doc.pages.find((candidate) => candidate.id === pageId);
    const box = this.boxForPage(pageId);
    if (!page || !box || !page.graphs?.includes(graph) || this.callbacks.isLocked?.()) return false;
    this.endExplore(true);
    this.clearSelection();
    this.deselectImage();
    const explorer = new GraphExplorer(this.paperEl, graph, {
      paper: paperColorOf(page, this.paper),
      night: pageLook(page.backdrop, this.paper).night,
      onClose: (view) => {
        if (this.explorer?.explorer !== explorer) return;
        this.explorer = null;
        this.renderer?.setHiddenGraphs(NO_GRAPHS);
        const at = this.boxForPage(pageId);
        if (view && page.graphs?.includes(graph)) {
          this.history.push(this.doc, new EditGraph(pageId, graph, { view }));
        }
        if (at) this.renderer?.invalidateRegion(at.index, graphBounds(graph));
        this.renderDry();
        if (view) this.changed([pageId]);
      },
    });
    this.explorer = { pageId, explorer };
    this.renderer?.setHiddenGraphs(new Set([graph]));
    this.renderer?.invalidateRegion(box.index, graphBounds(graph));
    this.syncExplore();
    this.renderDry();
    return true;
  }

  /** Close Explore if it is open: `commit` keeps the view it was left at (one undo step). */
  private endExplore(commit: boolean): void {
    this.explorer?.explorer.close(commit);
  }

  /** Keep the live canvas over its graph as the page zooms or lays out again. */
  private syncExplore(): void {
    const open = this.explorer;
    if (!open) return;
    const box = this.boxForPage(open.pageId);
    if (!box) {
      open.explorer.cancel();
      return;
    }
    const scale = this.unitScale;
    const g = open.explorer.graph;
    open.explorer.place(
      (box.x + g.x) * scale,
      (box.y + g.y) * scale,
      scale,
      window.devicePixelRatio || 1,
    );
  }

  private fingerPicksPicture(page: Page, p: Pt): boolean {
    if (this.practice || this.toolState.tool === "text") return false;
    const image = topImageAt(
      page.images.filter((candidate) => candidate.locked !== true && !isFolded(candidate)),
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
    const ink = this.noteInk(sel);
    const text = this.noteText(sel);
    this.applyCommand(
      ink.length > 0 || text.length > 0
        ? new RemoveElements(
            sel.pageId,
            { strokes: ink, images: [sel.image], textBoxes: text },
            "Delete",
          )
        : new RemoveImage(sel.pageId, sel.image.id),
    );
    this.selectionTakenAway();
    return true;
  }

  /** The ink on the selected image when it is a sticky note; none for a picture. */
  private noteInk(sel: { pageId: string; image: ImageElement }): Stroke[] {
    if (!sel.image.sticky) return [];
    const page = this.doc.pages.find((candidate) => candidate.id === sel.pageId);
    return page ? inkOfNote(page, sel.image) : [];
  }

  /** The typed text on the selected image when it is a sticky note; none for a picture. */
  private noteText(sel: { pageId: string; image: ImageElement }): TextBoxElement[] {
    if (!sel.image.sticky) return [];
    const page = this.doc.pages.find((candidate) => candidate.id === sel.pageId);
    return page ? textOfNote(page, sel.image) : [];
  }

  /**
   * The selected image's frame changes from `before` to `after` by
   * `command`: one undo step that takes a sticky note's ink along, or the
   * command alone for a picture or an empty note.
   */
  private withNoteInkFollowing(
    sel: { pageId: string; image: ImageElement },
    command: Command,
    before: NoteFrame,
    after: NoteFrame,
  ): Command {
    if (this.noteInk(sel).length === 0 && this.noteText(sel).length === 0) return command;
    return new CompositeCommand(command.label, [
      command,
      new MoveNoteInk(sel.pageId, sel.image, before, after),
    ]);
  }

  /** Fold the selected sticky note away to its icon, and let go of it. */
  private foldSelectedNote(): void {
    const sel = this.liveImageSelection();
    if (!sel || !sel.image.sticky || this.callbacks.isLocked?.()) return;
    this.deselectImage();
    this.setNoteFolded(sel.pageId, sel.image, true);
  }

  /** Fold `note` away, or open it again: one undo step, and its tiles painted again. */
  private setNoteFolded(pageId: string, note: ImageElement, folded: boolean): void {
    this.history.push(this.doc, new SetNoteFolded(pageId, note, folded));
    const box = this.boxForPage(pageId);
    if (box) this.renderer?.invalidateRegion(box.index, imageBounds(transformOf(note)));
    this.syncTextBoxes();
    this.renderDry();
    this.changed();
  }

  /** The folded note whose icon is under a client point, with its page, or `null`. */
  private foldedNoteAtClient(
    clientX: number,
    clientY: number,
  ): { pageId: string; note: ImageElement } | null {
    // Every press asks; a notebook without a folded note answers at once.
    if (this.doc?.pages.some((page) => page.images.some(isFolded)) !== true) return null;
    const at = this.toLayout(clientX, clientY);
    const box = boxAtPoint(this.pageLayout, at.x, at.y);
    const page = box ? this.pageAt(box.index) : null;
    if (!box || !page || this.callbacks.isLocked?.()) return null;
    const p = this.toPage(box, at);
    const note = foldedNoteAt(page, p.x, p.y);
    return note ? { pageId: page.id, note } : null;
  }

  /**
   * A pen or mouse pressed on a folded note: it draws nothing, and the note
   * opens on the lift, if the lift is near (a control over the page acts on
   * pointerup). Android's click after that lift is swallowed, or it would
   * land on whatever the open note shows under the pen.
   */
  private pressOpensFoldedNote(event: PointerEvent): boolean {
    if (event.button !== 0) return false;
    const hit = this.foldedNoteAtClient(event.clientX, event.clientY);
    if (!hit) return false;
    const doc = this.surfaceEl.ownerDocument;
    const { pointerId, clientX, clientY } = event;
    const end = (up: PointerEvent): void => {
      if (up.pointerId !== pointerId) return;
      doc.removeEventListener("pointerup", end, true);
      doc.removeEventListener("pointercancel", end, true);
      if (up.type !== "pointerup") return;
      if (Math.hypot(up.clientX - clientX, up.clientY - clientY) > FOLDED_TAP_SLOP_PX) return;
      swallowGhostClick(doc, up);
      this.setNoteFolded(hit.pageId, hit.note, false);
    };
    doc.addEventListener("pointerup", end, true);
    doc.addEventListener("pointercancel", end, true);
    return true;
  }

  /** A finger tapped (client px, at its lift): open the folded note there, if any. */
  private fingerOpensFoldedNote(clientX: number, clientY: number): boolean {
    const hit = this.foldedNoteAtClient(clientX, clientY);
    if (!hit) return false;
    const lift = { clientX, clientY, timeStamp: performance.now() } as PointerEvent;
    swallowGhostClick(this.surfaceEl.ownerDocument, lift);
    this.setNoteFolded(hit.pageId, hit.note, false);
    return true;
  }

  /**
   * A Text-tool tap on an open sticky note types on the note: in its text,
   * or in a new box made for it, inset on the paper and as wide as it.
   * Whether there was a note there.
   */
  private editNoteTextAt(box: PageBox, p: Pt): boolean {
    const page = this.pageAt(box.index);
    const note = page ? noteAt(page, p.x, p.y) : null;
    if (!page || !note || note.locked === true || this.callbacks.isLocked?.()) return false;
    const existing = textOfNote(page, note)[0];
    if (!existing) {
      this.addTextBox(box, noteTextFrame(note), note.id);
      return true;
    }
    const key = `${page.id}:${existing.id}`;
    this.noteTextOpen = key;
    this.syncTextBoxes();
    const view = this.textBoxInputs.get(key);
    if (view) this.focusTextBox(view.input);
    this.noteTextOpen = null;
    return true;
  }

  /**
   * The note text boxes (by id) their textareas show: being typed in, held
   * by the lasso, or about to be focused. The rest are drawn with their
   * notes, in the tiles and in a selection's drag alike.
   */
  private noteTextShownByDom(): Set<string> {
    const shown = new Set<string>();
    for (const page of this.doc?.pages ?? []) {
      for (const textBox of page.textBoxes) {
        if (textBox.onSticky === undefined) continue;
        const note = noteOfText(page, textBox);
        if (!note || isFolded(note)) continue;
        const key = `${page.id}:${textBox.id}`;
        const view = this.textBoxInputs.get(key);
        const typing =
          view !== undefined &&
          (view.root.contains(document.activeElement) || this.heldText === view);
        if (typing || this.noteTextOpen === key) shown.add(textBox.id);
      }
    }
    return shown;
  }

  /**
   * A box stopped being typed in or held: a note's text it was goes back to
   * being drawn with its note (its textarea parked, its tiles painted again).
   */
  private settleNoteText(): void {
    const shown = this.noteTextShownByDom();
    const was: ReadonlySet<string> = this.noteTextOnDom ?? new Set();
    if (shown.size === was.size && [...shown].every((id) => was.has(id))) return;
    this.syncTextBoxes();
  }

  /** Paint again the notes whose text moved between their textarea and their tiles. */
  private syncNoteTextTiles(shown: ReadonlySet<string>): void {
    const was: ReadonlySet<string> = this.noteTextOnDom ?? new Set();
    const changed = [...shown].filter((id) => !was.has(id));
    for (const id of was) if (!shown.has(id)) changed.push(id);
    if (changed.length === 0) return;
    this.noteTextOnDom = shown;
    this.renderer?.setHiddenText(shown);
    const ids = new Set(changed);
    this.doc.pages.forEach((page, index) => {
      for (const textBox of page.textBoxes) {
        if (!ids.has(textBox.id)) continue;
        const note = noteOfText(page, textBox);
        if (note) this.renderer?.invalidateRegion(index, imageBounds(transformOf(note)));
      }
    });
    this.requestFrame();
  }

  /** Repaint the selected sticky note in `color`. */
  private recolorSelectedNote(color: string): void {
    const sel = this.liveImageSelection();
    if (!sel || !sel.image.sticky || this.callbacks.isLocked?.()) return;
    if (sel.image.sticky.color === color) return;
    this.history.push(this.doc, new SetStickyColor(sel.pageId, sel.image, color));
    const box = this.boxForPage(sel.pageId);
    if (box) this.renderer?.invalidateRegion(box.index, imageBounds(transformOf(sel.image)));
    this.renderDry();
    this.syncActionBar();
    this.changed();
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
    const ink = copyNoteInk(page, sel.image, copy, () => this.strokeIds.next());
    const text = copyNoteText(page, sel.image, copy, () => this.textBoxIds.next());
    this.applyCommand(
      ink.length > 0 || text.length > 0
        ? new AddElements(page.id, { strokes: ink, images: [copy], textBoxes: text }, "Duplicate")
        : new InsertImage(page.id, copy),
    );
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
    this.syncExplore();
    const sel = this.liveImageSelection();
    const box = sel ? this.boxForPage(sel.pageId) : null;
    // Two fingers carry it as a selection, drawn on the wet layer: no chrome meanwhile.
    const pinched = sel !== null && this.groupDrag?.selection.images.includes(sel.image) === true;
    this.imageUiEl.toggleClass("is-hidden", !sel || !box || this.cropping !== null || pinched);
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
    if (!sel || this.groupDrag || this.callbacks.isLocked?.()) return;
    const finger = event.pointerType === "touch";
    if (this.imageDrag) {
      // A second finger beside the one dragging it: a turn of the picture.
      if (finger && this.imageDrag.finger === true) this.addFrameFinger(this.imageFrameEl, event);
      return;
    }
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
      finger,
      ...(part === "rotate" ? { turn: this.imageTurnSnap(start, from) } : {}),
    };
    this.imageUiEl.addClass("is-dragging");
    this.imageFrameEl.addEventListener("pointermove", this.onImagePointerMove);
    this.imageFrameEl.addEventListener("pointerup", this.onImagePointerEnd);
    this.imageFrameEl.addEventListener("pointercancel", this.onImagePointerEnd);
    if (finger) {
      // No drag was under way, so any finger still counted lost its lift.
      if (!this.pageFingerOnFrame) this.selectionFingers.cancel();
      this.selectionFingers.down(event.pointerId, event.clientX, event.clientY, event.timeStamp);
    }
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
        drag.draft = moveImage(
          drag.start,
          p.x - drag.from.x,
          p.y - drag.from.y,
          this.imageRoom(box),
        );
        break;
      case "rotate": {
        const swept = sweptTurn(imageCentre(drag.start), drag.from, p, 0);
        const turn = drag.turn ? drag.turn.turn(swept) : swept;
        drag.draft = withRotation(drag.start, rotationOf(drag.start) + turn);
        const page = drag.turn ? drag.turn.pageAngle(turn) : rotationOf(drag.start) + turn;
        this.showTurnLabel(box, p, page, drag.turn?.snapped === true);
        break;
      }
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

  /** Where a dragged picture's middle may go: its page, or with the pages joined, every page. */
  private imageRoom(box: PageBox): { width: number; height: number; minX: number; minY: number } {
    const room = this.joined && !this.board ? this.shapeRoom(box) : null;
    return room
      ? { minX: room.minX, minY: room.minY, width: room.maxX, height: room.maxY }
      : { minX: 0, minY: 0, width: box.width, height: box.height };
  }

  /** A dragged picture as a selection, its note's ink with it: to find its mirrors. */
  private imageAsSelection(pageId: string, image: ImageElement): GroupSelection {
    const page = this.doc.pages.find((candidate) => candidate.id === pageId);
    const ink = image.sticky && page ? page.strokes.filter((s) => s.onSticky === image.id) : [];
    return { pageId, strokes: ink, images: [image], textBoxes: [], tables: [], graphs: [] };
  }

  /** Take the dragged image out of the tiles and draw it on the wet layer instead. */
  private liftImage(drag: ImageDrag, box: PageBox): void {
    drag.lifted = true;
    // Its mirrors over the join go too, or the old place would show there.
    const mirrors = this.selectionMirrors(this.imageAsSelection(drag.pageId, drag.image));
    this.renderer?.setHiddenImages(new Set([drag.image, ...mirrors.images]));
    if (mirrors.strokeIds.length > 0) this.renderer?.setHiddenStrokes(new Set(mirrors.strokeIds));
    this.renderer?.invalidateRegion(box.index, imageBounds(drag.start));
    this.invalidateMirrorRegions(mirrors.regions);
    this.renderDry();
  }

  private renderImageDraft(): void {
    const drag = this.imageDrag;
    const box = drag ? this.boxForPage(drag.pageId) : null;
    if (!drag || !box) return;
    // A cropped or flipped picture is dragged as it is: the draft is a full copy.
    this.renderer?.renderImageDraft(box.index, placedAt(drag.image, drag.draft), this.inkPressure);
    this.requestZoomPaint();
  }

  /**
   * Finish an image drag: commit it (`commit`) or drop it, then put the
   * image back into the tiles where it was and where it now is.
   */
  private endImageDrag(commit: boolean): void {
    const drag = this.imageDrag;
    if (!drag) return;
    this.imageDrag = null;
    this.showTurnLabel(null, null, 0, false);
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
    this.renderer?.setHiddenStrokes(NO_STROKES);
    this.renderer?.clearWet();
    // Mirrors hidden for the drag show again; moved, they are rebuilt (`syncMirrors`).
    this.invalidateMirrorRegions(
      this.selectionMirrors(this.imageAsSelection(drag.pageId, drag.image)).regions,
    );
    // On the lift a turn that ended close to a page step lands on it exactly.
    if (commit && drag.turn && drag.part === "rotate") {
      drag.draft = withRotation(drag.start, rotationOf(drag.start) + drag.turn.settled());
    }
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
      const flips = { flipX: drag.image.flipX, flipY: drag.image.flipY };
      this.history.push(
        this.doc,
        this.withNoteInkFollowing(
          { pageId: drag.pageId, image: drag.image },
          new TransformImage(drag.pageId, drag.image.id, drag.draft),
          { ...drag.start, ...flips },
          { ...drag.draft, ...flips },
        ),
      );
      if (drag.image.sticky) this.strokeIndex.refreshPages(this.doc.pages, [drag.pageId]);
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
    this.stepHistory(false, (doc) => this.history.undo(doc));
  }

  redo(): void {
    this.stepHistory(true, (doc) => this.history.redo(doc));
  }

  /**
   * One step back or forward. A drag or crop in progress is dropped first,
   * since the step may take its element away; afterwards everything the
   * surface derives from the document is rebuilt, and the change is shown,
   * with the readout naming it ("Undid: Change shape style").
   */
  private stepHistory(redo: boolean, step: (doc: InkDocument) => Command | null): void {
    this.parkedText = null;
    // The cell's typing becomes its own step first, so the undo takes it back.
    this.endCellEdit(true);
    this.endCrop(false);
    this.cancelImageDrag();
    this.cancelGroupDrag();
    // An open Explore is committed first, so the undo takes back its view.
    this.endExplore(true);
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
    this.flashReadout(historyNotice(redo, command.label), READOUT_NOTICE_HOLD_MS);
  }

  /** Whether `command` is the newest step, so {@link undo} would take exactly it back. */
  isLatest(command: Command): boolean {
    return this.history.isLatest(command);
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
    this.syncBoardLayout();
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
    const box = this.pageLayout.boxes[0];
    const page = this.doc.pages[0];
    return (
      (!isBoard(this.doc) && scrollDirectionOf(this.doc) !== this.direction) ||
      (!isBoard(this.doc) && joinedPagesOf(this.doc) !== this.joined) ||
      this.pageLayout.boxes.length !== this.doc.pages.length ||
      isBoard(this.doc) !== this.board ||
      // A board's one page grew, or an undo took the growth back.
      (this.board &&
        box !== undefined &&
        page !== undefined &&
        (box.width !== page.geometry.width || box.height !== page.geometry.height))
    );
  }

  // --- Tables: typing in a cell -------------------------------------------------
  //
  // One textarea over the cell being typed in (`table-cell-editor.ts`); the
  // canvas leaves that cell's text out meanwhile. The typing writes the cell
  // as it goes and is recorded as one step when the cell is left.

  /** The table cell being typed in, and its text when typing began. */
  private cellEdit: {
    pageId: string;
    table: TableElement;
    row: number;
    col: number;
    before: string;
    /**
     * The table's top edge and frame when typing in this cell began (or was
     * last recorded): text that runs past the bottom of the page floats the
     * table up from there, and is recorded with the move as one step.
     */
    startY: number;
    startFrame: BoxFrame;
    /**
     * The cell's text the last time the table fitted its page, its top edge
     * then and where the caret was: typing that cannot fit even with the
     * table at the top of the page goes back to it.
     */
    fitText: string;
    fitY: number;
    fitCaret: number;
  } | null = null;
  /** The table bar's actions that would do nothing or not fit, worked out when they may change. */
  private cellDisabled: ReadonlySet<TableAction> = new Set();
  private cellEditor: TableCellEditor | null = null;
  /** A Text-tool press while a cell is typed in: what it does is decided on lift. */
  private cellTap = false;

  /** The field being typed in, a text box's or a table cell's, if any. */
  private typingField(): { root: HTMLElement; input: HTMLTextAreaElement } | null {
    const view = this.editingTextView();
    if (view) return view;
    const editor = this.cellEditor;
    return this.cellEdit && editor && document.activeElement === editor.input ? editor : null;
  }

  /** A table laid out with the surface's measuring canvas. */
  private tableLayout(table: TableElement): TableLayout {
    this.measureCtx ??= createEl("canvas").getContext("2d");
    const ctx = this.measureCtx;
    if (ctx) return tableLayoutOf(table, ctx);
    // No 2D context at all: a rough measure, only to keep the geometry sane.
    return layoutTable(table, () => (text) => text.length * table.fontSize * 0.55);
  }

  /** A table's frame in page space, its rows grown to their text. */
  private tableFrameOf(table: TableElement): BoxFrame {
    const layout = this.tableLayout(table);
    return { x: layout.x, y: layout.y, w: layout.w, h: layout.h };
  }

  /**
   * The one table a selection holds when nothing else but the ink written
   * in it is picked up with it (as a tap on a table selects it), else `null`.
   */
  private loneTable(sel: ElementLists): TableElement | null {
    const tables = sel.tables ?? [];
    const others =
      sel.images.length + sel.textBoxes.length + (sel.graphs?.length ?? 0) + tables.length - 1;
    return tables.length === 1 && others === 0 ? tables[0] : null;
  }

  /** The topmost table with a cell under page point `p`, and that cell. */
  private tableAt(page: Page, p: Pt): { table: TableElement; cell: CellRef } | null {
    // A mirror is typed in as its owner, on its own page (`editCellAt`).
    const tables = (page.tables ?? []).filter((table) => !(this.joined && isMirror(table)));
    for (let i = tables.length - 1; i >= 0; i--) {
      const cell = cellAt(this.tableLayout(tables[i]), p.x, p.y);
      if (cell) return { table: tables[i], cell };
    }
    return null;
  }

  /** A finger tapped at client (x, y): type in the cell there of the table being typed in. */
  private fingerMovesCell(clientX: number, clientY: number): boolean {
    const edit = this.cellEdit;
    if (!edit) return false;
    const at = this.toLayout(clientX, clientY);
    const box = boxAtPoint(this.pageLayout, at.x, at.y);
    if (!box || box.id !== edit.pageId) return false;
    const p = this.toPage(box, at);
    const cell = cellAt(this.tableLayout(edit.table), p.x, p.y);
    if (!cell) return false;
    this.startCellEdit(edit.pageId, edit.table, cell);
    return true;
  }

  /** Type in the cell under page point `p` of the page in `box`; false when there is none. */
  private editCellAt(box: PageBox, p: Pt): boolean {
    const page = this.pageAt(box.index);
    if (!page || this.practice || this.callbacks.isLocked?.()) return false;
    const hit = this.tableAt(page, p);
    if (hit) {
      this.startCellEdit(page.id, hit.table, hit.cell);
      return true;
    }
    // With the pages joined, the table may be the page beside's, over the join.
    for (const other of this.joined ? this.eraseTargets(box) : []) {
      const otherPage = other === box ? null : this.pageAt(other.index);
      const q = { x: p.x + box.x - other.x, y: p.y + box.y - other.y };
      const over = otherPage ? this.tableAt(otherPage, q) : null;
      if (otherPage && over) {
        this.startCellEdit(otherPage.id, over.table, over.cell);
        return true;
      }
    }
    return false;
  }

  /**
   * Start typing in a cell, or move the typing to another one (the keyboard
   * stays up). Focused synchronously: called inside the pointerup, because
   * iPadOS raises the keyboard only for a focus made during a user gesture.
   */
  private startCellEdit(pageId: string, table: TableElement, cell: CellRef): void {
    const previous = this.cellEdit;
    if (previous) this.commitCellEdit();
    else {
      this.blurTextBox();
      this.releaseHeldText();
      this.clearSelection();
      this.deselectImage();
    }
    const text = cellText(table, cell.row, cell.col);
    this.cellEdit = {
      pageId,
      table,
      ...cell,
      before: text,
      startY: table.y,
      startFrame: this.tableFrameOf(table),
      fitText: text,
      fitY: table.y,
      fitCaret: text.length,
    };
    this.cellDisabled = this.disabledTableActions();
    const editor = (this.cellEditor ??= new TableCellEditor(this.textBoxesEl, {
      onInput: (typed, composing) => this.typeInCell(typed, composing),
      onFocus: () => {
        this.holdTextEditingClass();
        this.watchTypingKeyboard(true);
        this.callbacks.onTextEditing?.(null);
        this.keepTypingBoxVisible();
      },
      onBlur: (next) => {
        const target = next as Node | null;
        if (
          target &&
          (editor.root.contains(target) ||
            editor.bar.contains(target) ||
            editor.grips.contains(target))
        ) {
          return;
        }
        this.endCellEdit(false);
      },
      onStep: (step) => this.stepCellEdit(step),
      onEscape: () => this.endCellEdit(true),
      onAction: (action) => this.tableAction(action),
      onColor: (color) => this.colorCell(color),
      onGrip: (kind, index, event) => this.startGripDrag(kind, index, event),
    }));
    editor.input.value = this.cellEdit.before;
    this.renderer?.setEditingCell({ table, cell });
    if (previous && previous.table !== table) this.repaintTable(previous.pageId, previous.table);
    this.repaintTable(pageId, table);
    this.placeCellEditor();
    if (document.activeElement !== editor.input) this.focusTextBox(editor.input);
    const end = editor.input.value.length;
    editor.input.setSelectionRange(end, end);
  }

  /** Record the cell's typing as one step, if it changed anything; typing goes on. */
  private commitCellEdit(): void {
    const edit = this.cellEdit;
    if (!edit) return;
    const after = cellText(edit.table, edit.row, edit.col);
    const moved = edit.table.y !== edit.startY;
    if (after === edit.before && !moved) return;
    const onPage = this.doc.pages.some(
      (page) => page.id === edit.pageId && page.tables?.includes(edit.table),
    );
    if (onPage) {
      const move = moved ? { from: edit.startY, to: edit.table.y } : undefined;
      this.history.push(
        this.doc,
        new SetTableCell(edit.pageId, edit.table, edit.row, edit.col, edit.before, after, move),
      );
    }
    edit.before = after;
    edit.startY = edit.table.y;
    edit.startFrame = this.tableFrameOf(edit.table);
  }

  /**
   * Stop typing in the cell: record it, give the cell's text back to the
   * canvas and put the keyboard away (`blur`: the textarea still has the
   * focus; the blur handler passes false).
   */
  private endCellEdit(blur: boolean): void {
    const edit = this.cellEdit;
    if (!edit) return;
    this.commitCellEdit();
    this.cellEdit = null;
    this.cellTap = false;
    this.endGripDrag(false);
    this.renderer?.setEditingCell(null);
    const editor = this.cellEditor;
    if (blur && editor && document.activeElement === editor.input) editor.input.blur();
    editor?.hide();
    this.watchTypingKeyboard(false);
    this.releaseTextEditingClass();
    this.repaintTable(edit.pageId, edit.table);
    this.handBackFromText();
  }

  /** The lift of a Text-tool tap made while a cell is typed in (see `penDown`). */
  private finishCellTap(sample: PointerSample | null): boolean {
    if (!this.cellTap) return false;
    this.cellTap = false;
    this.activePage = null;
    const box = sample ? boxAtPoint(this.pageLayout, sample.x, sample.y) : null;
    if (sample && box && this.editCellAt(box, this.toPage(box, sample))) return true;
    this.endCellEdit(true);
    return true;
  }

  /**
   * The cell's text was typed into: the cell changes as it is typed, and its
   * row grows. Text that would run past the bottom of the page floats the
   * table up, only as far as it needs and never above the page's top, and
   * back down as the text shrinks (never below where typing began). Text
   * that does not fit even then is not taken, as paper ends where it ends.
   * While an input method is still composing, all that waits until it settles.
   */
  private typeInCell(text: string, composing = false): void {
    const edit = this.cellEdit;
    if (!edit) return;
    const before = this.tableFrameOf(edit.table);
    setCellText(edit.table, edit.row, edit.col, text);
    let after = this.tableFrameOf(edit.table);
    const page = this.pageSizeOf(edit.pageId);
    const editor = this.cellEditor;
    if (!composing && page && editor) {
      edit.table.y = floatedTop(edit.startY, after.h, page.height);
      after = this.tableFrameOf(edit.table);
      if (keepsToPage(edit.startFrame, after, page)) {
        edit.fitText = text;
        edit.fitY = edit.table.y;
        edit.fitCaret = editor.input.selectionStart ?? text.length;
      } else {
        setCellText(edit.table, edit.row, edit.col, edit.fitText);
        edit.table.y = edit.fitY;
        editor.input.value = edit.fitText;
        editor.input.setSelectionRange(edit.fitCaret, edit.fitCaret);
        editor.refuse();
        after = this.tableFrameOf(edit.table);
      }
    }
    // A row that grew or shrank, or a table that floated, changes what still fits.
    if (after.h !== before.h || after.y !== before.y) {
      this.cellDisabled = this.disabledTableActions();
    }
    this.repaintTable(edit.pageId, edit.table, before);
    this.placeCellEditor();
    this.keepTypingBoxVisible();
    this.changed([edit.pageId]);
  }

  /** A page's size, page px, by its id. */
  private pageSizeOf(pageId: string): PageSize | null {
    const box = this.boxForPage(pageId);
    return box ? { width: box.width, height: box.height } : null;
  }

  /** Tab: the next cell (a new row past the last one); Shift+Tab: the one before. */
  private stepCellEdit(step: 1 | -1): void {
    const edit = this.cellEdit;
    if (!edit) return;
    let next = stepCell(edit.table, edit.row, edit.col, step);
    // Past the last cell, a new row, while the page has room for one.
    const plan = !next && step === 1 ? this.planTableAction("row-below", edit) : null;
    if (plan) {
      this.commitCellEdit();
      const before = this.tableFrameOf(edit.table);
      this.history.push(this.doc, plan.command);
      next = { row: edit.table.rows.length - 1, col: 0 };
      this.repaintTable(edit.pageId, edit.table, before);
      this.changed([edit.pageId]);
    } else if (!next && step === 1) {
      this.cellEditor?.refuse();
    }
    if (next) this.startCellEdit(edit.pageId, edit.table, next);
  }

  /** A button of the table's bar: one undo step, typing going on in the cell it leaves. */
  private tableAction(action: TableAction): void {
    const edit = this.cellEdit;
    if (!edit) return;
    this.commitCellEdit();
    const plan = this.planTableAction(action, edit);
    if (!plan) {
      this.cellEditor?.refuse();
      return;
    }
    const { pageId, table } = edit;
    const before = this.tableFrameOf(table);
    this.history.push(this.doc, plan.command);
    // The cell typed in after the edit: the new row or column, else the same place.
    this.cellEdit = null;
    this.startCellEdit(pageId, table, { row: plan.row, col: plan.col });
    this.repaintTable(pageId, table, before);
    this.changed([pageId]);
  }

  /**
   * A swatch under the bar: the cell's text takes that colour (`null`: the
   * table's own again), one undo step, and typing goes on in the cell.
   */
  private colorCell(color: string | null): void {
    const edit = this.cellEdit;
    if (!edit) return;
    const own = cellStyleOf(edit.table, edit.row, edit.col)?.color ?? null;
    if (own === color) return;
    this.commitCellEdit();
    const { pageId, table, row, col } = edit;
    this.history.push(this.doc, new SetTableCellStyle(pageId, table, row, col, { color }));
    this.cellEdit = null;
    this.startCellEdit(pageId, table, { row, col });
    this.repaintTable(pageId, table);
    this.changed([pageId]);
  }

  /** The colours a cell can take: the table's own text colour, then the pen palette's. */
  private cellColors(table: TableElement): string[] {
    const out = [table.textColor];
    for (const color of [...(this.doc.palette?.colors ?? []), ...this.palette]) {
      if (/^#[0-9a-f]{6}$/i.test(color) && !out.some((c) => sameColor(c, color))) out.push(color);
    }
    return out;
  }

  /**
   * What a bar button would do to the table being typed in: its command and
   * the cell typed in afterwards, or `null` when it would do nothing (the
   * last row, the most columns) or would take the table further past its
   * page than it is. A new row is no higher than the room below the table, a
   * new column narrows the others to the page's width, and then the whole
   * table is laid out once more, since narrower columns and a bold header
   * wrap their text onto more lines.
   */
  private planTableAction(
    action: TableAction,
    edit: { pageId: string; table: TableElement; row: number; col: number },
  ): { command: Command; row: number; col: number } | null {
    const { pageId, table } = edit;
    const page = this.pageSizeOf(pageId);
    if (!page) return null;
    const frame = this.tableFrameOf(table);
    let { row, col } = edit;
    let command: Command;
    let change: (trial: TableElement) => boolean;
    if (action === "row-above" || action === "row-below") {
      row += action === "row-below" ? 1 : 0;
      const room = page.height - (frame.y + frame.h);
      const at = row;
      change = (trial) => insertRowWithin(trial, at, room);
      command = new InsertTableRow(pageId, table, at, room);
    } else if (action === "col-left" || action === "col-right") {
      col += action === "col-right" ? 1 : 0;
      const room = page.width - table.x;
      const at = col;
      change = (trial) => insertColumnWithin(trial, at, room);
      command = new InsertTableColumn(pageId, table, at, room);
    } else if (action === "delete-row") {
      // Taking a row or a column out only makes the table smaller.
      if (table.rows.length <= 1) return null;
      return {
        command: new RemoveTableRow(pageId, table, row),
        row: Math.min(row, table.rows.length - 2),
        col,
      };
    } else if (action === "delete-col") {
      if (table.cols.length <= 1) return null;
      return {
        command: new RemoveTableColumn(pageId, table, col),
        row,
        col: Math.min(col, table.cols.length - 2),
      };
    } else if (action === "bold") {
      // A header cell is bold already; a bolder cell may wrap onto more lines.
      if (table.header === true && row === 0) return null;
      const bold = cellStyleOf(table, row, col)?.bold !== true;
      change = (trial) => {
        setCellStyle(trial, row, col, { bold });
        return true;
      };
      command = new SetTableCellStyle(pageId, table, row, col, { bold });
    } else {
      const on = table.header !== true;
      change = (trial) => {
        if (on) trial.header = true;
        else delete trial.header;
        return true;
      };
      command = new SetTableHeader(pageId, table, on);
    }
    const trial = structuredClone(table);
    if (!change(trial) || !keepsToPage(frame, this.tableFrameOf(trial), page)) return null;
    return { command, row, col };
  }

  /** The bar's actions that would do nothing or not fit on the page now. */
  private disabledTableActions(): ReadonlySet<TableAction> {
    const edit = this.cellEdit;
    const out = new Set<TableAction>();
    if (!edit) return out;
    const all: TableAction[] = [
      "row-above",
      "row-below",
      "col-left",
      "col-right",
      "header",
      "bold",
      "delete-row",
      "delete-col",
    ];
    for (const action of all) {
      if (!this.planTableAction(action, edit)) out.add(action);
    }
    return out;
  }

  /**
   * Re-rasterise the tiles under a table — where it is now and, when given,
   * where it was (`before`): a row that grew or a column that went changes
   * its frame — and repaint.
   */
  private repaintTable(pageId: string, table: TableElement, before?: BoxFrame): void {
    const box = this.boxForPage(pageId);
    if (!box) return;
    const frame = this.tableFrameOf(table);
    const pad = table.size + 2;
    const bounds = (f: BoxFrame): Bounds => ({
      minX: f.x - pad,
      minY: f.y - pad,
      maxX: f.x + f.w + pad,
      maxY: f.y + f.h + pad,
    });
    this.renderer?.invalidateRegion(box.index, bounds(frame));
    if (before) this.renderer?.invalidateRegion(box.index, bounds(before));
    this.renderDry();
  }

  /** Put the cell editor over its cell where the page is now, or away when no cell is typed in. */
  private placeCellEditor(): void {
    const editor = this.cellEditor;
    const edit = this.cellEdit;
    if (!editor) return;
    const box = edit ? this.boxForPage(edit.pageId) : null;
    const layout = edit ? this.tableLayout(edit.table) : null;
    const frame = edit && layout ? cellFrame(layout, edit) : null;
    if (!edit || !box || !layout || !frame) {
      editor.hide();
      return;
    }
    const scale = this.unitScale;
    const page = this.pageAt(box.index);
    const night = page ? pageLook(page.backdrop, this.paper).night : false;
    const style = cellStyle(edit.table, edit.row, edit.col);
    editor.place({
      left: Math.round((box.x + frame.x) * scale),
      top: Math.round((box.y + frame.y) * scale),
      width: Math.round(frame.w * scale),
      height: Math.round(frame.h * scale),
      tableLeft: Math.round((box.x + layout.x) * scale),
      tableTop: Math.round((box.y + layout.y) * scale),
      tableWidth: Math.round(layout.w * scale),
      tableHeight: Math.round(layout.h * scale),
      colEdges: layout.colX.map((x, i) => Math.round((box.x + x + layout.colW[i]) * scale)),
      rowEdges: layout.rowY.map((y, i) => Math.round((box.y + y + layout.rowH[i]) * scale)),
      col: edit.col,
      row: edit.row,
      scale,
      style: { ...style, color: shownColor(style.color, night) },
      header: edit.table.header === true,
      disabled: this.cellDisabled,
      bold: style.bold === true,
      colors: this.cellColors(edit.table),
      cellColor: cellStyleOf(edit.table, edit.row, edit.col)?.color ?? null,
    });
    const drag = this.gripDrag;
    if (drag) {
      const offset =
        drag.kind === "col"
          ? layout.colX[drag.index] + layout.colW[drag.index] - layout.x
          : layout.rowY[drag.index] + layout.rowH[drag.index] - layout.y;
      editor.showGuide(drag.kind, Math.round(offset * scale));
    }
  }

  // --- Tables: resizing a column or a row by its grip ---------------------------------
  //
  // Every column's right edge and every row's bottom edge has a grip on the
  // table's border (`table-cell-editor.ts`). A drag sizes only that column or
  // row, never under the least, and stops where the table would go further
  // past the page than it was when the drag began.

  private gripDrag: {
    pointerId: number;
    kind: "col" | "row";
    index: number;
    /** The column's width or the row's least height before the drag, page px. */
    was: number;
    /** Where the drag starts from: the shown size, page px, and the press, client px. */
    from: number;
    start: number;
    /** The table's frame when the drag began: it may not go further past the page. */
    frame: BoxFrame;
    target: HTMLElement;
  } | null = null;

  private startGripDrag(kind: "col" | "row", index: number, event: PointerEvent): void {
    const edit = this.cellEdit;
    if (!edit || this.gripDrag) return;
    const list = kind === "col" ? edit.table.cols : edit.table.rows;
    if (index < 0 || index >= list.length) return;
    const layout = this.tableLayout(edit.table);
    const target = event.currentTarget as HTMLElement;
    this.gripDrag = {
      pointerId: event.pointerId,
      kind,
      index,
      was: list[index],
      from: kind === "col" ? layout.colW[index] : layout.rowH[index],
      start: kind === "col" ? event.clientX : event.clientY,
      frame: this.tableFrameOf(edit.table),
      target,
    };
    target.addClass("is-dragging");
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // A synthetic pointer (a test harness) cannot be captured; moves still arrive.
    }
    target.addEventListener("pointermove", this.onGripMove);
    target.addEventListener("pointerup", this.onGripUp);
    target.addEventListener("pointercancel", this.onGripUp);
    this.placeCellEditor();
  }

  private readonly onGripMove = (event: PointerEvent): void => {
    const drag = this.gripDrag;
    const edit = this.cellEdit;
    if (!drag || !edit || event.pointerId !== drag.pointerId) return;
    event.stopPropagation();
    const before = this.tableFrameOf(edit.table);
    const at = drag.kind === "col" ? event.clientX : event.clientY;
    const want = drag.from + (at - drag.start) / this.unitScale;
    const least = drag.kind === "col" ? TABLE_MIN_COL : TABLE_MIN_ROW;
    const sized = (table: TableElement, size: number): void => {
      (drag.kind === "col" ? table.cols : table.rows)[drag.index] = Math.max(least, size);
    };
    const page = this.pageSizeOf(edit.pageId);
    const size = page
      ? furthestFitting(drag.from, want, (value) => {
          const trial = structuredClone(edit.table);
          sized(trial, value);
          return keepsToPage(drag.frame, this.tableFrameOf(trial), page);
        })
      : want;
    // Previewed on the table itself; the lift records it as one step.
    sized(edit.table, size);
    this.repaintTable(edit.pageId, edit.table, before);
    this.placeCellEditor();
  };

  private readonly onGripUp = (event: PointerEvent): void => {
    const drag = this.gripDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.stopPropagation();
    this.endGripDrag(true);
  };

  /** Finish a grip drag: record the new size as one step (`commit`), or put the old one back. */
  private endGripDrag(commit: boolean): void {
    const drag = this.gripDrag;
    if (!drag) return;
    this.gripDrag = null;
    drag.target.removeClass("is-dragging");
    this.cellEditor?.showGuide(null);
    drag.target.removeEventListener("pointermove", this.onGripMove);
    drag.target.removeEventListener("pointerup", this.onGripUp);
    drag.target.removeEventListener("pointercancel", this.onGripUp);
    if (drag.target.hasPointerCapture(drag.pointerId)) {
      drag.target.releasePointerCapture(drag.pointerId);
    }
    const edit = this.cellEdit;
    if (!edit) return;
    const list = drag.kind === "col" ? edit.table.cols : edit.table.rows;
    const size = list[drag.index];
    list[drag.index] = drag.was;
    if (commit && size !== drag.was) {
      this.history.push(
        this.doc,
        drag.kind === "col"
          ? new ResizeTableColumn(edit.pageId, edit.table, drag.index, size)
          : new ResizeTableRow(edit.pageId, edit.table, drag.index, size),
      );
      this.changed([edit.pageId]);
    }
    edit.startFrame = this.tableFrameOf(edit.table);
    this.cellDisabled = this.disabledTableActions();
    this.repaintTable(edit.pageId, edit.table);
    this.placeCellEditor();
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
  private blurTextBox(by = "finish"): void {
    const view = this.editingTextView();
    if (view) this.blurTextInput(view.input, by);
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
      this.blurTextInput(view.input, "tap-beside");
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
    this.settleNoteText();
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
  /**
   * Show the box being styled at `fontSize` while the size slider moves,
   * outside the history; `null` puts its own size back. The slider's
   * release stores the size through {@link applyTextStyle}, one step of undo.
   */
  previewTextSize(fontSize: number | null): void {
    const preview = this.textSizePreview;
    if (fontSize === null) {
      this.textSizePreview = null;
      if (!preview) return;
      const before = this.liveTextBox(preview.pageId, preview.id);
      if (before) before.fontSize = preview.fontSize;
      this.syncTextBoxes();
      return;
    }
    const view = this.textTargetView();
    const live = view ? this.liveTextBox(view.pageId, view.id) : undefined;
    if (!view || !live || this.callbacks.isLocked?.()) return;
    if (!preview || preview.pageId !== view.pageId || preview.id !== view.id) {
      this.textSizePreview = { pageId: view.pageId, id: view.id, fontSize: live.fontSize };
    }
    live.fontSize = fontSize;
    this.syncTextBoxes();
  }

  /** The box the size slider is previewing on, and its own size. */
  private textSizePreview: { pageId: string; id: string; fontSize: number } | null = null;

  applyTextStyle(patch: TextStylePatch): boolean {
    // A size still previewed goes back first, so the step undoes to the size it had.
    if (this.textSizePreview) this.previewTextSize(null);
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
    this.settleNoteText();
    // A size slider let go of elsewhere: the box keeps its stored size.
    if (this.textSizePreview) this.previewTextSize(null);
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
      if (!this.renderer || this.typingField()) return;
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
    this.placeToasts();
  }

  /**
   * The tool bar and its pill as shown, in screen px, for `placeToasts`.
   * Set by the view; without it the toasts keep to the bottom.
   */
  toastChrome: (() => Span[]) | null = null;

  /**
   * Put the toasts (off-page, text hint, highlighted text) at the end of
   * the page area away from the tool bar and its pill (`toastSide`). Run
   * when one shows and whenever the pill moves.
   */
  placeToasts(): void {
    const box = this.surfaceEl.getBoundingClientRect();
    const side = toastSide(box, this.toastChrome?.() ?? []);
    this.surfaceEl.toggleClass("is-toast-top", side === "top");
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
    tables: page.tables ?? [],
    graphs: page.graphs ?? [],
  };
}

/** How many elements a selection holds. */
function selectedCount(sel: ElementLists): number {
  return (
    sel.strokes.length +
    sel.images.length +
    sel.textBoxes.length +
    (sel.tables?.length ?? 0) +
    (sel.graphs?.length ?? 0)
  );
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
/**
 * A closed shape, whole: a side dot copies it, and a side dot's arrow may be
 * dropped on it. An erased piece of a closed shape is open, so it is not.
 */
function isWholeClosedShape(stroke: Stroke): boolean {
  if (stroke.shape === undefined || !isClosedKind(stroke.shape)) return false;
  const n = Math.floor(stroke.pts.length / 3);
  if (n < 3) return false;
  return stroke.pts[0] === stroke.pts[(n - 1) * 3] && stroke.pts[1] === stroke.pts[(n - 1) * 3 + 1];
}

function iconInto(el: HTMLElement, icon: string, fallback: string): void {
  setIcon(el, icon);
  const svg = el.querySelector("svg");
  if (!svg || svg.childElementCount === 0) {
    el.empty();
    el.setText(fallback);
  }
}

/** Whether two bounds are the same rectangle. */
function sameBounds(a: Bounds, b: Bounds): boolean {
  return a.minX === b.minX && a.minY === b.minY && a.maxX === b.maxX && a.maxY === b.maxY;
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

function sameZoomRect(a: ZoomRect, b: ZoomRect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
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

/** A graph's frame, page px: where it is drawn and where it is picked up. */
function graphFrame(graph: GraphElement): { x: number; y: number; w: number; h: number } {
  return { x: graph.x, y: graph.y, w: graph.w, h: graph.h };
}

/** The topmost graph whose frame holds `p` (page px), or null. */
function graphAt(page: Page, p: Pt): GraphElement | null {
  const graphs = page.graphs ?? [];
  for (let i = graphs.length - 1; i >= 0; i--) {
    const g = graphs[i];
    if (p.x >= g.x && p.x <= g.x + g.w && p.y >= g.y && p.y <= g.y + g.h) return g;
  }
  return null;
}

/** The index of the row box nearest layout x `x` (inside one, or the closer edge). */
function nearestRowBox(boxes: readonly PageBox[], x: number): number {
  let best = -1;
  let bestAway = Infinity;
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i];
    const away = x < box.x ? box.x - x : x > box.x + box.width ? x - box.x - box.width : 0;
    if (away < bestAway) {
      bestAway = away;
      best = i;
    }
  }
  return best;
}

/** Whether `outer` holds all of `inner`. */
function boundsContain(outer: Bounds, inner: Bounds): boolean {
  return (
    outer.minX <= inner.minX &&
    outer.minY <= inner.minY &&
    outer.maxX >= inner.maxX &&
    outer.maxY >= inner.maxY
  );
}

/** The smallest box holding both. */
function boundsUnion(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}
