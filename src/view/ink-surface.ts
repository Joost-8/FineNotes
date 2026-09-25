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
} from "../canvas/renderer";
import {
  type BoxFrame,
  type LassoFilter,
  type LassoMode,
  LassoPath,
  type Polygon,
  boxInLasso,
  clampGroupDelta,
  lassoTakesStroke,
  polygonOf,
  rectLoop,
  smoothLoop,
  selectionBounds,
  strokeInLasso,
  textBoxFrame,
} from "../canvas/lasso";
import {
  HANDLE_HIT_RADIUS_PX,
  IMAGE_CORNERS,
  IMAGE_EDGES,
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
  topImageAt,
  transformOf,
} from "../canvas/image-geometry";
import {
  cropOf,
  cropResult,
  croppedBox,
  dragCrop,
  isFullCrop,
  minCropFractions,
  pictureFraction,
  sameCrop,
  uncroppedBox,
} from "../canvas/image-crop";
import { type PaperTheme, paperTheme } from "../canvas/backdrop";
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
import { strokeHitByPoint } from "../canvas/hit-test";
import { type EraserFilter, eraseCircleFromStroke, eraserTakes } from "../ink/stroke-eraser";
import { MAX_SCALE, anchorScrollDelta, fitPageZoom, nextZoomFloor } from "../canvas/zoom";
import { KineticScroller, easeOutCubic, softZoom } from "../canvas/scroll-physics";
import { scrollThumb } from "../canvas/scroll-thumb";
import { zoomPercent } from "../model/units";
import { prefersReducedMotion } from "./motion";
import { StrokeBuilder, type StrokeBuilderOptions, mapPressure } from "../ink/stroke-builder";
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
  type ShapeKind,
  type Stroke,
  type TextBoxElement,
  type Tool,
  strokeBounds,
  strokeCount,
} from "../model/document";
import { DUPLICATE_OFFSET, duplicateImage, nextImageId } from "../model/images";
import {
  AddElements,
  type ElementLists,
  type IdSource,
  type PageElements,
  RecolorStrokes,
  RemoveElements,
  TranslateElements,
  copyElements,
  elementsOnPage,
  isEmptySelection,
} from "../model/selection-commands";
import {
  CropImage,
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
  textStyleOf,
} from "../model/text-style";
import { type ListKind, type TextEdit, continueList, toggleList } from "../model/text-list";
import { keyboardHeight } from "./keyboard";
import { DEFAULT_SHAPE_COLOR, pushRecentColor, sameColor } from "../model/colors";
import {
  TEXT_PAD_X,
  TEXT_PAD_Y,
  canvasFont,
  fitTextWidth,
  textDecorationOf,
} from "../canvas/text-layout";
import { History } from "../model/history";
import {
  PointerController,
  type PointerControllerCallbacks,
  type PointerDebugRecord,
  type PointerSample,
} from "../input/pointer-controller";
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
  tableSizeFor,
} from "./toolbar";
import { SelectionActionBar } from "./selection-bar";
import { PullAddIndicator } from "./pull-add-indicator";
import { scrollDirectionOf } from "../model/scroll-direction";
import type { SelectionAction } from "./selection-bar-model";
import { type KeyAction, keyOutcome } from "./surface-keys";
import { PointerHud } from "./pointer-hud";
import { SizeWait, backingScale } from "./surface-size";
import { StrokeIndex } from "./stroke-index";
import { IdSequence, strokeIdsOf, textBoxIdsOf } from "./id-sequence";

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
   * Per-notebook dark paper. Pages are paper-white by default no matter what
   * the Obsidian theme is doing (contracts/design-brief.md).
   */
  darkPaper?: boolean;
  /** Open with the diagnostics HUD showing (see {@link InkSurface.setDebug}). */
  debug: boolean;
  /** Colours the selection's "Colour" row offers (the pen's palette); default {@link PALETTE}. */
  palette?: readonly string[];
}

/** What the surface tells its host, and asks it. Only `onChange` is required. */
export interface InkSurfaceCallbacks {
  /**
   * The document changed — ink drawn, erased or moved, a text box edited, a
   * page cleared, an undo or redo — and is due to be saved.
   */
  onChange: () => void;
  /** Something the host may display changed (stroke count, zoom, current page). */
  onStatus?: () => void;
  /**
   * Asked before every edit: true refuses it, for a note that must not be
   * written (the host says why).
   */
  isLocked?: () => boolean;
  /** A custom colour was picked (the lasso's recolour): the new recent list. */
  onRecentColors?: (colors: string[]) => void;
  /** A key press switched tools; the host's toolbar should show the new one. */
  onToolChange?: (tool: ActiveTool) => void;
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
   * plugin's own (see `handlePaste`). The host saves and places it. Without
   * this, only the plugin's clipboard is pasted.
   */
  onPasteImage?: (file: File) => void;
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
  /** It moved: every coalesced sample since the last event (layout space), and the predicted ones. */
  move(box: PageBox, samples: PointerSample[], predicted: PointerSample[]): void;
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
  pageId: string;
  id: string;
  /** Width + font size the auto-height was last measured at; skips needless reflow. */
  measuredAt: string;
  /** Visual shrink applied to the textarea so its computed font stays >= 16px. */
  shrink: number;
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
  /** The crop being edited, as fractions of the whole picture. */
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

/** The small bar a lasso tap-and-hold opens: Paste on paper, Unlock on a locked picture. */
interface PressMenu {
  pageId: string;
  /** The pressed page point. */
  at: Pt;
  /** The locked picture pressed, if one was. */
  locked: ImageElement | null;
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
}

/**
 * A lasso selection being dragged by its frame, from pointerdown to lift.
 * The document is untouched until the lift commits one `TranslateElements`;
 * meanwhile the selection's ink and pictures are drawn on the wet layer,
 * moved by (dx, dy), and left out of the tiles, and its text boxes follow.
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
  /** Whether the selection has left the tiles for the wet layer yet. */
  lifted: boolean;
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
  /** A Text-tool gesture made while a box was being edited: it only ends the edit. */
  private textDismiss = false;
  /** A Text-tool press beside a held box: its lift lets go of the box (see `finishTextDismiss`). */
  private textRelease = false;
  /**
   * The box a first tap beside it stopped typing in but kept, framed with its
   * handles, until the next tap beside it.
   */
  private heldText: TextBoxView | null = null;
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
  /** A finger is dragging the page (touchmove must then not reach Obsidian). */
  private touchPanning = false;
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
  private paperIsDark: boolean;
  private pageIndex = 0;

  /** The pen stroke being drawn, from pen-down to lift. */
  private builder: StrokeBuilder | null = null;
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
  /** The eraser's footprint, shown on the page while erasing. */
  private readonly eraserCursorEl: HTMLElement;

  // The lasso (0.5). A selection is strokes, images and text boxes on one
  // page, held by identity and resolved against the live document. One
  // picture on its own is shown with the image chrome below instead (its
  // resize and rotate handles); anything else gets the group frame, which
  // moves the lot. The two are never shown together, and one action bar
  // serves both. Frame, bar and menu are DOM over the page, like the text
  // boxes, so a finger works them as well as the Pencil.
  private selection: GroupSelection | null = null;
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
  /** The lasso's tap-and-hold bar, and the timer that opens it. */
  private pressMenu: PressMenu | null = null;
  private pressTimer = 0;
  /** Cmd/Ctrl+V waiting for the browser's paste event (see PASTE_EVENT_WAIT_MS). */
  private pasteTimer = 0;
  /** Whether a host set an image painter: without one, pictures are neither drawn nor pasted. */
  private imagesShown = false;
  /** A finger went down and could still turn out to be a tap. */
  private fingerTap: { x: number; y: number; t: number } | null = null;

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
   * The frame the stroke in progress is next drawn in (`scheduleWet`), and
   * the predicted samples drawn ahead of its pen.
   */
  private wetFrame = 0;
  private pendingPredicted: PointerSample[] = [];
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
  private readonly diagSums = { down: 0, up: 0, cancel: 0, touchStarts: 0, stylusTouches: 0 };
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
    this.paperIsDark = options.darkPaper === true;
    this.paper = paperTheme(this.paperIsDark);
    this.toolSeen = toolState.tool;

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
    this.hudEl = this.surfaceEl.createDiv({ cls: "goodobsidian-hud" });
    this.eraserCursorEl = this.paperEl.createDiv({ cls: "goodobsidian-eraser-cursor is-hidden" });
    this.setDebug(options.debug);

    // A lock badge on each locked picture, under the selection chrome. The
    // badges take no presses: a tap-and-hold on the picture reaches the page.
    this.lockBadgesEl = this.paperEl.createDiv({ cls: "goodobsidian-lock-badges is-hidden" });

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
    this.selectionFrameEl.addEventListener("pointerdown", this.onSelectionPointerDown);
    this.actionBar = new SelectionActionBar(this.selectionUiEl, "Selection");
    // With the lasso, a text box is something to select, not to type in.
    this.surfaceEl.toggleClass("is-lasso", toolState.tool === "select");

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
    );
    input.attach();
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
      for (let i = 0; i < event.changedTouches.length; i++) {
        const touch = event.changedTouches[i] as Touch & { touchType?: string };
        if (touch.touchType === "stylus") {
          if (event.type === "touchstart") this.diagSums.stylusTouches++;
          if (event.type === "touchstart" || event.type === "touchmove") event.preventDefault();
          return;
        }
      }
      if (onTextBox(event.target)) return;
      event.stopPropagation();
      if (event.type === "touchmove" && this.touchPanning && event.cancelable) {
        event.preventDefault();
      }
      // With the lasso, a finger held still is a tap-and-hold (Paste,
      // Unlock). Cancelling its touchstart keeps WebKit's own long press from
      // claiming it and ending it in pointercancel, as it does a held Pencil.
      // No finger tap needs its click here: with the lasso, text boxes are
      // selected, not typed in, and every control acts on pointer events.
      if (event.type === "touchstart" && this.toolState.tool === "select" && event.cancelable) {
        event.preventDefault();
      }
    };
    for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"] as const) {
      this.scrollEl.addEventListener(type, onTouch, { passive: false });
      this.disposers.push(() => this.scrollEl.removeEventListener(type, onTouch));
    }

    // Wheel and trackpad: scroll, or zoom with Ctrl/Cmd (a trackpad pinch
    // arrives as a Ctrl+wheel). Momentum on a trackpad is the OS's own.
    const onWheel = (event: WheelEvent): void => this.onWheel(event);
    this.scrollEl.addEventListener("wheel", onWheel, { passive: false });
    this.disposers.push(() => this.scrollEl.removeEventListener("wheel", onWheel));

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
    window.clearTimeout(this.wheelSnapTimer);
    this.hideOffPage();
    for (const frame of [
      this.frameReq,
      this.prefetchReq,
      this.hudFrame,
      this.wetFrame,
      this.focusHoldFrame,
      this.relayoutFrame,
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
    this.history.push(this.doc, command);
    // A host command can bring in elements with ids of their own (a duplicated
    // page does), so the id sequences must never fall behind the document.
    this.strokeIds.catchUp(strokeIdsOf(this.doc));
    this.textBoxIds.catchUp(textBoxIdsOf(this.doc));
    this.strokeIndex.rebuild(this.doc.pages);
    this.renderer?.invalidateAll();
    this.layout();
    this.changed();
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

  /** The document changed: the host refreshes its status and saves. */
  private changed(): void {
    this.reportStatus();
    this.callbacks.onChange();
  }

  /** After an edit to the ink: put the tiles right at once, then tell the host. */
  private inkChanged(): void {
    this.renderDry();
    this.changed();
  }

  // --- What the host can ask for -----------------------------------------------

  /** Switch this notebook's paper between white (default) and dark. */
  setDarkPaper(dark: boolean): void {
    this.paperIsDark = dark;
    this.paper = paperTheme(dark);
    if (!this.renderer) return;
    this.renderer.paper = this.paper;
    this.renderer.invalidateAll();
    this.reportStatus();
    this.requestFrame();
  }

  get darkPaper(): boolean {
    return this.paperIsDark;
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
    const clamped = Math.max(0, Math.min(this.doc.pages.length - 1, index));
    const row = this.direction === "horizontal";
    const x = row ? this.rowX(clamped) : this.scroller.position.x;
    const y = row ? 0 : scrollTopForPage(this.pageLayout, clamped) * this.scale;
    if (animate) this.scroller.glideTo(x, y, now());
    else this.scroller.setPosition(x, y);
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

  setTool(tool: ActiveTool): void {
    // The toolbar shares `toolState` and has already written the new tool
    // into it, so the one being replaced is read from `toolSeen`.
    if (tool === "text" && this.toolSeen !== "text") this.toolBeforeText = this.toolSeen;
    this.toolSeen = tool;
    this.toolState.tool = tool;
    this.surfaceEl.toggleClass("is-lasso", tool === "select");
    if (tool !== "select") this.dropSelection();
    // Locked pictures wear a badge only while the lasso could select them.
    this.syncLockBadges();
    if (tool !== "text") {
      this.releaseHeldText();
      this.hideTextHint();
      // Picking another tool finishes the box being edited — and since the
      // tool is no longer Text, finishing it switches nothing back.
      this.blurTextBox();
    }
  }

  /**
   * Show or hide the diagnostics HUD. Showing it starts its event log and
   * totals from zero, so a recording begins clean.
   */
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
    if (isEditable(event.target)) return false;
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

  private runKeyAction(action: KeyAction): void {
    if (typeof action === "object") {
      this.setTool(action.tool);
      this.callbacks.onToolChange?.(action.tool);
      return;
    }
    switch (action) {
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
    this.indicatorEl.toggleClass("is-hidden", total === 0);
    if (index !== this.pageIndex) {
      this.pageIndex = index;
      this.callbacks.onPageChange?.(index, total);
      this.reportStatus();
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
    this.syncViewport();
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
    return this.pinch !== null || this.zoomAnim !== null || this.wheelZoomTimer !== 0;
  }

  /** The zoom came to rest: rasterise at the live scale from now on. */
  private settleIfIdle(): void {
    if (!this.renderer || this.zoomTransient || !this.renderer.isTransient) return;
    this.renderer.settle();
    this.paint(Infinity);
  }

  /** Paint the backdrop and the dry layer. Returns whether every tile was ready. */
  private paint(budgetMs: number): boolean {
    if (!this.renderer) return true;
    if (this.tilesPressure !== this.toolState.pressureEnabled) {
      // The pen type changed pressure: every outline is different now.
      this.tilesPressure = this.toolState.pressureEnabled;
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
      const more = this.renderer.prefetch(
        this.doc,
        this.toolState.pressureEnabled,
        PREFETCH_BUDGET_MS,
      );
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
    this.syncTextBoxes();
    this.syncImageOverlay();
    this.syncSelectionOverlay();
    this.syncLockBadges();
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
      const factor = Math.exp(-event.deltaY * unit * 0.01);
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
  }

  /** Keep typed page elements aligned with the canvas across pan and zoom. */
  private syncTextBoxes(): void {
    const expected = new Set<string>();
    const scale = this.unitScale;

    for (const box of this.pageLayout.boxes) {
      const page = this.pageAt(box.index);
      if (!page) continue;
      for (const textBox of page.textBoxes) {
        const key = `${page.id}:${textBox.id}`;
        expected.add(key);
        let view = this.textBoxInputs.get(key);
        if (!view) view = this.createTextBoxView(page.id, textBox, key);
        const { input, root } = view;
        if (document.activeElement !== input && input.value !== textBox.text)
          input.value = textBox.text;
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
        const fontPx = Math.max(8, textBox.fontSize * scale);
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
        root.setCssStyles({
          left: `${Math.round((box.x + frame.x + shift.x) * scale)}px`,
          top: `${Math.round((box.y + frame.y + shift.y) * scale)}px`,
          width: `${Math.round(width * scale)}px`,
          height: fixedHeight ? `${Math.round((frame.h ?? 0) * scale)}px` : root.style.height,
          // The fill is the frame's, so it covers the whole box, handles aside.
          background: textBox.fill ?? "",
        });
        // Every style key, re-read on every sync, so an undo or redo of a
        // style change shows at once — even in the box being typed in. The
        // font is a real family list from the model: the same one the
        // thumbnails paint with, installed on iPadOS, macOS and Windows.
        // The padding scales with the page (text-layout.ts), so the box
        // wraps at the same words at every zoom, and where the thumbnail does.
        input.setCssStyles({
          fontSize: `${(fontPx / shrink).toFixed(2)}px`,
          fontFamily: fontFamilyOf(textBox),
          fontWeight: textBox.bold ? "700" : "400",
          fontStyle: textBox.italic ? "italic" : "normal",
          textDecoration: textDecorationOf(textBox),
          textAlign: textBox.align ?? "left",
          lineHeight: String(lineHeight),
          padding: `${(TEXT_PAD_Y * unit).toFixed(2)}px ${(TEXT_PAD_X * unit).toFixed(2)}px`,
          // One line tall at least, as text-layout.ts assumes for the fill.
          minHeight: fixedHeight
            ? "0"
            : `${((textBox.fontSize * lineHeight + 2 * TEXT_PAD_Y) * unit).toFixed(2)}px`,
          color: textBox.color,
          width: `${100 / shrink}%`,
          height: fixedHeight ? `${100 / shrink}%` : input.style.height,
          transform: shrink < 1 ? `scale(${shrink})` : "",
        });
        view.styleKey = `${input.style.fontFamily}|${input.style.fontWeight}|${input.style.fontStyle}|${lineHeight}|${input.style.padding}`;
        if (!fixedHeight) this.autoSize(view, heightModeChanged);
      }
    }

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
  }

  /** Grow an auto-height box to fit its text. Measures only when something changed. */
  private autoSize(view: TextBoxView, force: boolean): void {
    const { input, root } = view;
    const key = `${root.style.width}|${input.style.fontSize}|${view.shrink}|${view.styleKey}`;
    if (!force && view.measuredAt === key) return;
    view.measuredAt = key;
    input.setCssStyles({ height: "auto" });
    const h = input.scrollHeight;
    input.setCssStyles({ height: `${h}px` });
    // The transform does not affect layout, so the frame is sized explicitly.
    root.setCssStyles({ height: `${Math.ceil(h * view.shrink)}px` });
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
    const key = `${font}|${room}|${textBox.text}`;
    if (view.fitKey === key) return view.fitW;
    this.measureCtx ??= createEl("canvas").getContext("2d");
    const ctx = this.measureCtx;
    // One wide character at least: room for the caret in an empty box.
    const min = Math.ceil(textBox.fontSize + 2 * TEXT_PAD_X);
    if (!ctx) return Math.max(min, textBox.w);
    ctx.font = font;
    view.fitKey = key;
    view.fitW = fitTextWidth(textBox.text, min, room, (text) => ctx.measureText(text).width);
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
    input.value = textBox.text;
    const view: TextBoxView = {
      root,
      input,
      pageId,
      id: textBox.id,
      measuredAt: "",
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
      // Typing again in a kept box, or in another one: nothing is held now.
      if (this.heldText === view) {
        this.heldText = null;
        root.removeClass("is-held");
      } else this.releaseHeldText();
      this.holdTextEditingClass();
      const snapshot = this.pendingFocusHold;
      this.pendingFocusHold = null;
      if (snapshot) this.holdScroll(input, snapshot);
      const live = this.liveTextBox(view.pageId, view.id);
      if (live) this.callbacks.onTextEditing?.(textStyleOf(live));
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
      // A fitted box widens with its text: a full sync sets the width first.
      // The height is measured after it either way: a new line adds height
      // without changing the width, which the sync's own measure keys on.
      if (live.fit) this.syncTextBoxes();
      if (live.h === undefined) this.autoSize(view, true);
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

      // Keep the caret's box above the on-screen keyboard, if it covers it.
      // Obsidian's iOS app does not shrink the visual viewport for the
      // keyboard; it publishes the keyboard's height as a CSS variable.
      const vv = window.visualViewport;
      const visibleBottom = Math.min(
        this.surfaceEl.getBoundingClientRect().bottom,
        vv ? vv.offsetTop + vv.height : window.innerHeight,
        window.innerHeight - keyboardHeight(),
      );
      const boxRect = input.getBoundingClientRect();
      const lineBottom = Math.min(boxRect.bottom, boxRect.top + 64);
      if (lineBottom > visibleBottom - 16) {
        top += lineBottom - visibleBottom + 16;
        this.scroller.setPosition(snapshot.left, top);
        top = this.scroller.position.y;
        this.syncViewport();
        this.requestFrame();
      }
      if (now() < until) this.focusHoldFrame = window.requestAnimationFrame(step);
    };
    step();
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
      this.toolState.pressureEnabled,
      this.eraseIds,
      null,
      this.erasePieces,
      budgetMs,
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

  /**
   * Stroke width actually laid down. A pen type is a multiplier on the width
   * the user picked (a highlighter is a fat nib, a brush a soft one), so the
   * three width controls keep meaning the same thing across pen types.
   */
  private strokeSize(): number {
    // A shape is drawn at the chosen width: a highlighter or brush nib would
    // make an outline four times too fat.
    if (this.toolState.tool === "shape") return Math.max(0.5, this.toolState.size);
    return Math.max(0.5, this.toolState.size * penTypeFor(this.toolState).sizeScale);
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

  /** Settings for a new stroke's sampling, from the pen as it is now. */
  private builderOpts(): StrokeBuilderOptions {
    return {
      // On screen, not on the page: at 5x zoom 1.4 page px is 7 screen px,
      // and small handwriting lost most of its samples.
      minDistance: this.atFitZoom(MIN_SAMPLE_DISTANCE),
      pressureEnabled: this.toolState.pressureEnabled,
      fallbackPressure: FALLBACK_PRESSURE,
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
    onStart: (sample) => this.penDown(sample),
    onMove: (coalesced, predicted) => {
      const box = this.activePage;
      if (box) this.gestureOf(this.toolState.tool).move(box, coalesced, predicted);
    },
    onEnd: (sample) => {
      if (this.finishTextDismiss()) return;
      const box = this.activePage;
      if (box) this.gestureOf(this.toolState.tool).up(box, sample);
    },
    onCancel: () => {
      if (this.finishTextDismiss()) return;
      this.gestureOf(this.toolState.tool).cancel(this.activePage);
    },
    // Fingers. Native touch-scroll is off (touch-action: none), so the
    // scroller gets the raw gesture and the frame loop moves the page.
    onPanStart: (x, y, t) => {
      // A resting palm must not scroll the page out from under an image or a
      // selection being dragged; without a dragStart the moves and the end
      // are no-ops.
      if (this.imageDrag || this.groupDrag) return;
      // Only the first finger can be a tap; a re-anchor keeps what it had. A
      // touch that stops a fling is only that, as on iOS. With the lasso, a
      // finger held still is a tap-and-hold, as the Pencil's is.
      if (!this.touchPanning) {
        this.fingerTap = this.scroller.isAnimating ? null : { x, y, t };
        if (this.fingerTap && this.toolState.tool === "select" && !this.lasso) {
          this.startPress(() => this.fingerHeld(x, y));
        }
      }
      if (!this.touchPanning) this.swipeFromPage = this.pageIndex;
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
      this.scroller.dragMove(x, y, t);
      this.requestFrame();
    },
    onPanEnd: (t) => {
      const tap = this.fingerTap;
      this.fingerTap = null;
      this.stopPress();
      // Read before the release springs it back: past the end far enough,
      // letting go adds a page.
      // A zoomed-in row is held to its page: its edge is no place to add one.
      const pulled =
        this.pullAddEnabled &&
        (this.direction !== "horizontal" || this.turnsPages) &&
        pullAddProgress(this.pullOverscroll()) >= 1;
      this.touchPanning = false;
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
    onPanCancel: () => {
      this.fingerTap = null;
      this.stopPress();
      this.touchPanning = false;
      this.pullAdd.hide();
      this.pinch = null;
      this.scroller.cancel();
      this.requestFrame();
    },
    onPinchStart: (centerX, centerY) => {
      this.fingerTap = null;
      this.stopPress();
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
    onDebug: (record) => this.onPointerEvent(record),
  };

  /**
   * The pen touched the page. What every tool has in common happens here —
   * the gesture's timestamp, letting go of what was selected or kept,
   * finding the page — and then the tool in use takes the gesture over.
   */
  private penDown(sample: PointerSample): void {
    if (this.callbacks.isLocked?.()) return;
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
      if (this.toolState.tool === "text") {
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
      if (this.toolState.tool === "text") {
        // A tap beside the box being edited finishes it, as in GoodNotes;
        // the next tap makes a new box. Finished on lift, like any tap.
        this.textDismiss = true;
        return;
      }
      // Writing on the page finishes typing. (The pen's pointerdown is
      // cancelled, so the box would otherwise keep focus and the keyboard.)
      this.blurTextBox();
    }
    this.gestureOf(this.toolState.tool).down(box, local, sample);
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
      default:
        return this.inkGesture;
    }
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
    move: (box, samples, predicted) => this.inkMove(box, samples, predicted),
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
    const builder = new StrokeBuilder(this.builderOpts());
    builder.add({ ...sample, ...at });
    this.builder = builder;
    this.snap = null;
    this.diagHold = { fired: false, verdict: "" };
    this.restartHold(at);
    this.watchCircleHold(box, at);
    this.renderer?.clearWet();
  }

  private inkMove(box: PageBox, samples: PointerSample[], predicted: PointerSample[]): void {
    const last = samples[samples.length - 1];
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
    this.pendingPredicted = predicted.map((s) => ({ ...s, ...this.toPage(box, s) }));
    this.scheduleWet();
  }

  private inkUp(box: PageBox, sample: PointerSample): void {
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
    const result = recognizeAtZoom(builder.points(), this.userZoom);
    this.diagHold = { fired: true, verdict: verdictOf(builder.points()) };
    this.hudVerdict("hold", builder.points(), result);
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
    this.pendingPredicted = [];
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
      liftVerdict: verdictOf(pts),
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
  ): void {
    if (!this.debug) return;
    const best = accepted ?? recognizeAtZoom(pts, this.userZoom, { minConfidence: 0 });
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
    this.wetFrame = window.requestAnimationFrame(this.drawWet);
  }

  private readonly drawWet = (): void => {
    this.wetFrame = 0;
    const box = this.activePage;
    const builder = this.builder;
    if (!builder || !box) return;
    // A snapped shape is drawn as the clean shape, following the held pen.
    if (this.snap) {
      this.renderer?.renderWet(box.index, this.snap.pts, { ...this.currentStyle(), shape: true });
      return;
    }
    // Drawn a little ahead of the pen: the samples the platform predicts
    // come next. They are never kept.
    const pts = builder.points();
    const options = this.builderOpts();
    for (const guess of this.pendingPredicted) {
      pts.push(guess.x, guess.y, mapPressure(guess.pressure, options));
    }
    this.renderer?.renderWet(box.index, pts, this.currentStyle());
  };

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
    this.pendingPredicted = [];
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
    return this.toolState.textDragSize === true;
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
        (this.toolState.tool === "pen" || this.toolState.tool === "highlighter"));
    let shape: { kind: ShapeKind; pts: number[] } | null = snap;
    if (!shape && (heldLongEnough || snapOnLift)) {
      shape = recognizeAtZoom(builder.points(), this.userZoom);
      this.hudVerdict(cancelledWhileHeld ? "cx-hold" : "lift", builder.points(), shape);
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
    const stroke: Stroke = {
      id: this.strokeIds.next(),
      color,
      size,
      tool,
      pts: shape ? shape.pts : builder.points(),
      ...(shape ? { shape: shape.kind } : {}),
    };
    const command = this.commitStroke(box, page, stroke);
    this.noteCircleLoop(page, stroke, command);
    this.noteOffPage(box, stroke, command);
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
    this.renderer?.appendCommittedStroke(box.index, stroke, this.toolState.pressureEnabled);
    // The wet layer was just cleared: blit the tiles now, or the stroke
    // would be missing for a frame.
    this.inkChanged();
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
    this.renderer?.renderWet(box.index, pts, { ...this.currentStyle(), shape: true });
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
    this.commitStroke(box, page, {
      id: this.strokeIds.next(),
      color: this.strokeColor(),
      size: this.strokeSize(),
      tool: "pen",
      pts,
      shape: drag.preset,
    });
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
      this.renderer?.appendCommittedStroke(box.index, stroke, this.toolState.pressureEnabled);
    }
    this.inkChanged();
  }

  // --- The eraser -------------------------------------------------------------------

  /** Drop any in-progress erase preview (the document was never touched). */
  private eraseReset(): void {
    this.eraseIds = new Set();
    this.erasePieces = new Map();
    this.eraseLast = null;
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
    const whole = eraserModeFor(this.toolState) === "stroke";
    // "Erase highlighter only" / "Erase pen only": a stroke it may not touch
    // is passed over, as if the eraser were not there.
    const filter = eraserFilterFor(this.toolState);

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
      const hit = whole
        ? this.eraseWholeAt(page, at, radius, filter)
        : this.erasePartialAt(page, at, radius, filter);
      if (hit) changed = true;
    }
    return changed;
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
      this.eraseIds.add(id);
      this.eraseDirty.add(id);
      marked = true;
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
      if (!original || !eraserTakes(original, filter)) continue;
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
    if (pieces.size > 0) this.commitCuts(box, pieces);
    else if (marked.size > 0) this.commitRemovals(marked);
  }

  /** Standard mode's commit: each stroke the eraser cut is replaced by what is left of it. */
  private commitCuts(box: PageBox | null, pieces: ReadonlyMap<string, Stroke[]>): void {
    const page = box ? this.pageAt(box.index) : null;
    const replacements: StrokeReplacement[] = [];
    for (const [id, survivors] of pieces) {
      const original = this.strokeIndex.get(id);
      if (original) replacements.push({ original, pieces: survivors });
    }
    if (!page || replacements.length === 0) {
      // The preview is gone, and the page it drew over comes back as it was.
      this.renderDry();
      return;
    }
    this.history.push(this.doc, new ReplaceStrokesOnPage(page.id, replacements));
    this.strokeIndex.rebuild(this.doc.pages);
    this.inkChanged();
  }

  /** Whole-stroke mode's commit: the marked strokes leave their pages, in one step for all pages. */
  private commitRemovals(marked: ReadonlySet<string>): void {
    const byPage = this.strokeIndex.byPage(marked);
    if (byPage.size === 0) return;
    const removals = [...byPage].map(([pageId, ids]) => new RemoveStrokesFromPage(pageId, ids));
    const step = removals.length === 1 ? removals[0] : new CompositeCommand("Erase", removals);
    this.history.push(this.doc, step);
    for (const id of marked) this.strokeIndex.remove(id);
    this.inkChanged();
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
    this.history.push(this.doc, new RemoveStrokesFromPage(page.id, ids, "Scribble to erase"));
    for (const id of ids) this.strokeIndex.remove(id, page.id);
    if (erased) this.renderer?.invalidateRegion(box.index, erased);
    if (this.debug) this.hud.mark("scribble");
    this.inkChanged();
    return true;
  }

  /**
   * Circle to lasso, first half: remember a pen stroke that loops round
   * something on its page, so that holding the pen on it can select that.
   * Anything else forgets the last loop.
   */
  private noteCircleLoop(page: Page, stroke: Stroke, command: Command): void {
    this.circleLoop = null;
    if (!penGesturesOf(this.toolState.penGestures).circleLasso) return;
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
    if (!penGesturesOf(this.toolState.penGestures).circleLasso) return;
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
    this.lasso = {
      box,
      mode: lassoModeFor(this.toolState),
      path,
      origin: { x: local.x, y: local.y },
      to: { x: local.x, y: local.y },
      held: false,
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
    const loop = this.lassoLoop(lasso);
    // Drawn rounded off, as GoodNotes draws it; taken on the loop as drawn.
    this.renderer?.renderLasso(lasso.box.index, lasso.mode === "rect" ? loop : smoothLoop(loop));
  }

  /** The lasso's pen stayed put long enough: open the tap-and-hold bar where it is. */
  private lassoHeld(): void {
    const lasso = this.lasso;
    if (!lasso) return;
    lasso.held = true;
    this.renderer?.clearWet();
    this.openPressMenu(lasso.box, lasso.origin);
  }

  /** A finger held still on the page with the lasso: the same bar, where it rests. */
  private fingerHeld(clientX: number, clientY: number): void {
    if (!this.fingerTap || this.lasso || this.imageDrag || this.groupDrag || this.cropping) return;
    // The lift is no longer a tap.
    this.fingerTap = null;
    const at = this.toLayout(clientX, clientY);
    const box = boxAtPoint(this.pageLayout, at.x, at.y);
    if (box) this.openPressMenu(box, this.toPage(box, at));
  }

  private startPress(open: () => void): void {
    this.stopPress();
    this.pressTimer = window.setTimeout(() => {
      this.pressTimer = 0;
      open();
    }, PRESS_HOLD_MS);
  }

  private stopPress(): void {
    if (this.pressTimer) window.clearTimeout(this.pressTimer);
    this.pressTimer = 0;
  }

  /**
   * Open the small bar a tap-and-hold brings up at page point `p`: Unlock
   * when the topmost picture there is locked (GoodNotes' way back to a locked
   * picture), otherwise Paste — greyed while the clipboard is empty.
   */
  private openPressMenu(box: PageBox, p: Pt): void {
    const page = this.pageAt(box.index);
    if (!page) return;
    this.clearSelection();
    this.deselectImage();
    const top = topImageAt(page.images, p, PEN_TAP_TOLERANCE_PX / this.unitScale);
    this.pressMenu = {
      pageId: page.id,
      at: { x: p.x, y: p.y },
      locked: top?.locked === true ? top : null,
    };
    this.syncActionBar();
  }

  private lassoLoop(lasso: LassoDraft): readonly number[] {
    return lasso.mode === "rect" ? rectLoop(lasso.origin, lasso.to, lasso.box) : lasso.path.points;
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
    const poly = polygonOf(this.lassoLoop(lasso));
    const b = poly?.bounds;
    const extent = b ? Math.max(b.maxX - b.minX, b.maxY - b.minY) * this.unitScale : 0;
    if (!poly || extent < TAP_SLOP_PX) {
      // With audio replay open, a tap on ink plays it instead of selecting it.
      if (this.offerStrokeTap(lasso.box, lasso.origin, PEN_TAP_TOLERANCE_PX)) this.dropSelection();
      else this.tapSelect(lasso.box, lasso.origin, PEN_TAP_TOLERANCE_PX);
      return;
    }
    this.selectInside(lasso.box, poly);
    if (lasso.mode !== "rect") this.keepOutline(smoothLoop(this.lassoLoop(lasso)));
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
      if (!strokeHitByPoint(stroke, p.x, p.y, stroke.size / 2 + tolerance)) continue;
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
      : textBox.fontSize * lineHeightOf(textBox) + 2 * TEXT_PAD_Y;
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
    return drag.selection.textBoxes.includes(textBox) ? { x: drag.dx, y: drag.dy } : { x: 0, y: 0 };
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
    const bounds = sel && box ? this.groupBounds(sel) : null;
    this.selectionFrameEl.toggleClass("is-hidden", !box || !bounds);
    if (box && bounds) {
      const scale = this.unitScale;
      const drag = this.groupDrag?.lifted ? this.groupDrag : null;
      const x = (box.x + bounds.minX + (drag?.dx ?? 0)) * scale - SELECTION_PAD_PX;
      const y = (box.y + bounds.minY + (drag?.dy ?? 0)) * scale - SELECTION_PAD_PX;
      this.selectionFrameEl.setCssStyles({
        left: `${x}px`,
        top: `${y}px`,
        width: `${(bounds.maxX - bounds.minX) * scale + 2 * SELECTION_PAD_PX}px`,
        height: `${(bounds.maxY - bounds.minY) * scale + 2 * SELECTION_PAD_PX}px`,
      });
      this.selectionFrameEl.toggleClass("is-dragging", drag !== null);
      // The loop that made the selection, while it is still those elements.
      const outline = this.selectionOutline;
      const count = sel ? sel.strokes.length + sel.images.length + sel.textBoxes.length : 0;
      const shown = outline !== null && outline.count === count;
      this.selectionFrameEl.toggleClass("has-outline", shown);
      if (shown) {
        const at = (v: number): string => (SELECTION_PAD_PX + v * scale).toFixed(1);
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
      bounds = this.groupBounds(group);
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
          custom: (color) => {
            const recent = pushRecentColor(this.toolState.recentColors ?? [], color);
            this.toolState.recentColors = recent;
            this.callbacks.onRecentColors?.(recent);
            this.recolorSelection(color);
          },
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
    return [
      {
        ...this.pasteAction(press.pageId, press.at),
        group: "press",
        bar: true,
        menu: "none",
        showLabel: true,
      },
    ];
  }

  /** Delete everything selected, as one undo step. */
  private deleteSelection(): void {
    if (this.callbacks.isLocked?.()) return;
    this.removeSelection("Delete selection");
  }

  /**
   * Take the lasso selection off its page as one undo step. A locked picture
   * is never taken: it cannot be selected, and this makes sure.
   */
  private removeSelection(label: string): void {
    const sel = this.liveSelection();
    if (!sel) return;
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
    this.strokeIndex.rebuild(this.doc.pages);
    this.renderDry();
    this.syncTextBoxes();
    this.changed();
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
      this.removeSelection("Cut");
      return;
    }
    const sel = this.liveImageSelection();
    if (!sel) return;
    this.applyCommand(
      new RemoveElements(sel.pageId, { strokes: [], images: [sel.image], textBoxes: [] }, "Cut"),
    );
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
    this.strokeIndex.rebuild(this.doc.pages);
    this.renderDry();
    this.syncTextBoxes();
    this.select(page.id, copies);
    this.changed();
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
   * the system clipboard holds a picture and is likely the fresher of the
   * two (the plugin's is empty, or the app was left since it was filled, so
   * another app may have copied since); then the picture goes to the host's
   * `onPasteImage`. Text fields keep their own pastes. Returns whether the
   * paste was taken.
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
    const onImage = this.imagesShown ? this.callbacks.onPasteImage : undefined;
    const file = onImage ? imageFileOf(event.clipboardData) : null;
    const systemFirst =
      file !== null && (clipboard.leftSinceCopy || !clipboard.canPaste(this.imagesShown));
    if (!systemFirst && this.paste()) {
      event.preventDefault();
      return true;
    }
    if (file && onImage) {
      event.preventDefault();
      onImage(file);
      return true;
    }
    return false;
  }

  // --- A picture's order, lock and crop (0.5) ---------------------------------

  /** Bring the selected picture to the front of the page's pictures, or send it to the back. */
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
    const crop = cropOf(sel.image);
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
    const { id, path } = session.image;
    this.renderer?.renderImageCropDraft(box.index, { id, path, ...session.full }, session.crop);
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
    this.strokeIndex.rebuild(this.doc.pages);
    this.renderDry();
    this.syncTextBoxes();
    this.select(sel.pageId, copies);
    this.changed();
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
    this.changed();
  }

  /**
   * A press on the selection's frame: the whole selection follows it, and
   * the lift commits one `TranslateElements`. A finger works it too.
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
    this.groupDrag = {
      pointerId: event.pointerId,
      selection: sel,
      bounds,
      from: this.pagePoint(box, event.clientX, event.clientY),
      clientX: event.clientX,
      clientY: event.clientY,
      dx: 0,
      dy: 0,
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

  /** Carry a selection being dragged to page point `p`, from where the drag began. */
  private moveGroupDrag(drag: GroupDrag, box: PageBox, p: Pt): void {
    const d = clampGroupDelta(drag.bounds, p.x - drag.from.x, p.y - drag.from.y, box);
    drag.dx = d.dx;
    drag.dy = d.dy;
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
    this.renderer?.renderSelectionDraft(
      box.index,
      strokes,
      images,
      drag.dx,
      drag.dy,
      this.toolState.pressureEnabled,
    );
  }

  /** Move just the dragged text boxes' frames; a full sync waits for the lift. */
  private placeDraggedTextBoxes(drag: GroupDrag, box: PageBox): void {
    const scale = this.unitScale;
    for (const textBox of drag.selection.textBoxes) {
      const view = this.textBoxInputs.get(`${drag.selection.pageId}:${textBox.id}`);
      view?.root.setCssStyles({
        left: `${Math.round((box.x + textBox.x + drag.dx) * scale)}px`,
        top: `${Math.round((box.y + textBox.y + drag.dy) * scale)}px`,
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
    const moved =
      commit &&
      (drag.dx !== 0 || drag.dy !== 0) &&
      this.doc.pages.some((page) => page.id === pageId);
    if (moved) {
      this.history.push(this.doc, new TranslateElements(pageId, drag.selection, drag.dx, drag.dy));
      this.strokeIndex.rebuild(this.doc.pages);
    }
    if (box) {
      const after = moved ? shiftBounds(drag.bounds, drag.dx, drag.dy) : null;
      this.renderer?.invalidateRegion(box.index, unionBounds(drag.bounds, after) ?? drag.bounds);
    }
    this.renderDry();
    this.syncTextBoxes();
    this.syncSelectionOverlay();
    if (moved) this.changed();
  }

  /** Abandon a selection drag without committing it (a reload, an undo, a tool change). */
  private cancelGroupDrag(): void {
    this.endGroupDrag(false);
  }

  /**
   * A finger tapped the page (client px). With the lasso it selects, like a
   * Pencil tap; with any other tool it only lets go of a selected image —
   * fingers never draw. While audio replay is open, a tap on ink goes to it
   * first, whatever the tool.
   */
  private onFingerTap(clientX: number, clientY: number): void {
    if (this.lasso || this.imageDrag || this.groupDrag) return;
    // A tap beside a picture being cropped finishes the crop, as a pen's does.
    if (this.cropping) {
      this.endCrop(true);
      return;
    }
    if (this.toolState.tool !== "select") this.deselectImage();
    const at = this.toLayout(clientX, clientY);
    const box = boxAtPoint(this.pageLayout, at.x, at.y);
    if (box && this.offerStrokeTap(box, this.toPage(box, at), FINGER_TAP_TOLERANCE_PX)) {
      this.clearSelection();
      return;
    }
    if (this.toolState.tool !== "select") return;
    if (!box) {
      this.clearSelection();
      this.deselectImage();
      return;
    }
    this.tapSelect(box, this.toPage(box, at), FINGER_TAP_TOLERANCE_PX);
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
    // A cropped picture is dragged cropped: the draft keeps its crop.
    const { id, path, crop } = drag.image;
    this.renderer?.renderImageDraft(box.index, {
      id,
      path,
      ...drag.draft,
      ...(crop ? { crop } : {}),
    });
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
    this.endCrop(false);
    this.cancelImageDrag();
    this.cancelGroupDrag();
    const command = step(this.doc);
    if (!command) return;
    // What was selected may have moved, gone or come back: start afresh.
    this.dropSelection();
    this.strokeIndex.rebuild(this.doc.pages);
    this.renderer?.invalidateAll();
    if (this.layoutStale()) this.layout();
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

  /** Tell the host the style of the box being edited, after something may have changed it. */
  private reportTextEditing(): void {
    const view = this.editingTextView();
    const live = view ? this.liveTextBox(view.pageId, view.id) : undefined;
    if (live) this.callbacks.onTextEditing?.(textStyleOf(live));
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
    view.root.removeClass("is-held");
    if (handBack) this.handBackFromText();
  }

  /** An unpinned Text tool hands back the tool used before it (GoodNotes' default). */
  private handBackFromText(): void {
    if (this.toolState.tool !== "text" || this.toolState.textPinned === true) return;
    if (this.editingTextView()) return;
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
    const view = this.editingTextView();
    if (!view) return false;
    if (this.callbacks.isLocked?.()) return true;
    const { input } = view;
    this.setTextInput(
      input,
      toggleList(input.value, input.selectionStart, input.selectionEnd, kind),
    );
    return true;
  }

  /**
   * The text pill's delete button: remove the box being edited, text and
   * all, as one undoable step (Undo brings it back as it was). Returns false
   * when no box is being edited.
   */
  deleteEditingTextBox(): boolean {
    const view = this.editingTextView();
    const live = view ? this.liveTextBox(view.pageId, view.id) : undefined;
    if (!view || !live) return false;
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
    const view = this.editingTextView();
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
    this.releaseTextEditingClass();
    this.removeIfEmpty(view);
    this.callbacks.onTextEditing?.(null);
    if (this.heldText === view) {
      // Kept by a tap beside it: the tool waits for the tap that lets go —
      // unless the box was empty and has just gone.
      if (this.liveTextBox(view.pageId, view.id)) return;
      this.heldText = null;
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
function verdictOf(pts: number[]): string {
  const e = explainShape(pts);
  const scored = e.candidates.map((c) => `${c.kind}:${c.confidence.toFixed(2)}`).join(" ");
  return `${e.closed ? "closed" : "open"} n=${e.n} diag=${Math.round(e.diag)} gap=${Math.round(e.gap)} [${scored}]`;
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** Whether an event's target is a page text box, or inside one. */
function onTextBox(target: EventTarget | null): boolean {
  return (target as Element | null)?.closest(".goodobsidian-page-textbox") != null;
}

/** Whether an event's target takes typing of its own: a field, or anything editable. */
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
