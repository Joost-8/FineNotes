/**
 * The two-tier toolbar of the ink note view.
 *
 * ## Why it looks like this
 *
 * contracts/design-brief.md is law here, and its "Layout must-haves" section is
 * derived from two GoodNotes reference screenshots Joost supplied:
 *
 * - **Tier 1 — the tool bar.** A full-width tinted bar (`--interactive-accent`).
 *   Left: document actions (thumbnails · search). Centre: undo · redo · add
 *   page. Right: tools (lasso · pen · eraser · text · shapes). The
 *   active tool is a light filled rounded square against the tint.
 * - **The Shape tool** (2026-09-21, from a GoodNotes screenshot Joost supplied,
 *   minus its width and colour): auto-shape, a divider, then square · circle
 *   · triangle · diamond · rounded square · star, a divider, then GoodNotes'
 *   two connector tools, line · arrow (added 2026-09-22). Auto-shape snaps
 *   whatever is drawn; a preset is dragged out corner to corner, a connector
 *   from start to end, and either tapped drops a default-size one. Last,
 *   Table: tapping it picks the size it shows, tapping it again opens a
 *   rows × columns picker; the table is then dragged out like a preset
 *   and placed as ordinary ink strokes.
 *   Draw-and-hold with the ordinary pen is a setting, not a toolbar control.
 * - **Tier 2 — the active tool's options.** A floating rounded pill directly
 *   below tier 1 holding only what the current tool needs. For the pen: its
 *   selected pen type (with a chevron to the three writing styles), a divider,
 *   three stroke widths drawn as literal strokes of increasing weight with the
 *   active one boxed, then three quick colour swatches.
 * - Joost trimmed the bar on 2026-09-21: the page navigator ("1 / 1" with
 *   arrows), transcribe, outline, image, sticky note, laser, microphone, the
 *   add-colour `+`, the pressure gauge and the "…" menu (zoom buttons, dark
 *   paper, a second Clear page, the status readout) are gone. Zoom is a pinch;
 *   Clear page lives in the eraser's options. Pages are navigated by
 *   scrolling, the sidebar and PageUp/PageDown.
 * - **The lasso** (2026-09-22, from a GoodNotes screenshot Joost supplied)
 *   has no pill. Its button carries a chevron, and tapping it again opens
 *   the "Lasso tool" popover hanging from it: the lasso type as two cards
 *   (Rectangular · Freehand) and a switch per kind of element it picks up.
 *   The eraser's pill gains GoodNotes' "Erase highlighter only" (and "pen
 *   only") as one "what it erases" control.
 * - The pill's *contents* change with the tool; its *position* does not.
 * - Touch targets >= 44pt (`--gob-touch`). Every chrome colour is an Obsidian
 *   CSS variable; nothing here is hardcoded.
 *
 * ## What research/RESEARCH.md's pain points changed
 *
 * The brief requires that file's "User pain points" section be read before
 * touching this toolbar. Three things came out of it:
 *
 * - Palm rejection "is currently finicky" in every competitor, and Excalidraw's
 *   accepted answer was an explicit user-facing override. The pressure toggle
 *   therefore lives in the pen's own options pill, not in a settings tab.
 * - Shapes, images and OCR are the three most-requested, never-delivered
 *   features in the incumbent's tracker. They get first-class buttons — and
 *   each one whose model side does not exist yet is rendered **disabled**
 *   rather than dead, because a control that silently does nothing is the worse
 *   failure.
 * - Every competitor's ink drifts between devices. Page navigation and the
 *   "3 / 18" readout are chrome-level, because discrete pages are the fix.
 */

import { penGlyph } from "./pen-glyph-svg";
import { rulerGlyph } from "./ruler-glyphs";
import {
  DEFAULT_RULER_SNAP,
  RULER_KINDS,
  RULER_KIND_LABELS,
  RULER_SNAP_STEPS,
  type RulerKind,
} from "../canvas/ruler-geometry";
import { LASER_COLOR } from "../canvas/laser-trail";
import { paintTape } from "../canvas/tape-paint";
import {
  drawingToolOf,
  optionsAfterSwitch,
  PEN_OPTIONS_ON_WRITE,
  PEN_OPTIONS_ON_WRITE_NAMES,
  type PenOptionsOnWrite,
  selectedTool,
} from "./tool-return";
import {
  BAR_ITEM_ICONS,
  BAR_ITEM_LABELS,
  type BarItemId,
  type CoreItemId,
  type PenSlotId,
  type ToolbarLayout,
  ZONES,
  type Zone,
  barItems as layoutBarItems,
  defaultLayout,
  isPenSlot,
  menuItems,
  normalizeLayout,
  penButtonType,
  penRowOffers,
  penSlotInHand,
  penSlotsOf,
  rememberPenType,
  penTypeSlot,
  penTypesOnBar,
  placeOf,
  savedPenSlot,
  setPenSlot,
  slotPenType,
  slotSavedId,
} from "./toolbar-layout";
import { ToolbarEditor } from "./toolbar-edit";
import { DEFAULT_STICKY_COLOR, STICKY_COLORS } from "../model/sticky-notes";
import {
  MAX_TAPE_HEIGHT,
  MIN_TAPE_HEIGHT,
  TAPE_COLORS,
  type TapeMode,
  tapeColorOf,
  tapeHeightOf,
  tapeHeightsOf,
  tapePresetIndex,
  withTapePreset,
  tapeModeOf,
} from "../model/cover-tape";
import { magnifierTap, zoomButtonState } from "../model/zoom-box";
import { Notice, setIcon } from "obsidian";
import { t } from "../i18n/translate";

import { deviceFamilies, hasFamily } from "./device-fonts";
import { loadedVaultFonts } from "./font-store";
import { errorMessage } from "../util/errors";
import { downloadLabel } from "../model/font-catalogue";
import { familyStack, matchesFamily } from "../model/text-family";
import type { LookPalette, LookStyle } from "../model/look";
import { DEFAULT_ERASER_SIZE, ICON_STYLUS_ONLY, PALETTE, SIZES } from "../constants";
import {
  CONNECTOR_PRESETS,
  SHAPE_PRESETS,
  HEART_ASPECT,
  STAR_INNER_RATIO,
  type ShapeMode,
  heartPoints,
  isShapeMode,
  starPoints,
} from "../ink/shape-geometry";
import { TEXT_ALIGNS, TEXT_FONTS, TEXT_FONT_STACKS, type TextAlign } from "../model/document";
import {
  DEFAULT_LINE_HEIGHT,
  DEFAULT_TEXT_STYLE,
  LINE_HEIGHTS,
  TEXT_ALIGN_LABELS,
  TEXT_BORDER_CHOICES,
  TEXT_CORNER_CHOICES,
  TEXT_PADDINGS,
  TEXT_PRESETS,
  presetOf,
  TEXT_FILLS,
  TEXT_FONT_LABELS,
  TEXT_SIZES,
  SIZE_SLIDER_STEPS,
  sizeAtSlider,
  sliderAtSize,
  type TextStyle,
  type TextStylePatch,
  fontFamilyOf,
  fontOf,
  lineHeightOf,
  textStyleKey,
  textStyleOf,
  withTextStyle,
} from "../model/text-style";
import type { ListKind } from "../model/text-list";
import { keyboardHeight } from "./keyboard";
import { renderColorPicker } from "./color-picker";
import { type PenInk, type PenInks, penInkFor, switchPenInk, withPenInk } from "../model/pen-inks";
import {
  SWOOSH_HEIGHT,
  SWOOSH_WIDTH,
  WIDTH_MARK_LIMIT,
  fitMarks,
  inkNeedsRim,
  sampleStroke,
  swoosh,
  widthMarkThickness,
} from "./pen-glyphs";
import {
  DEFAULT_SHAPE_COLOR,
  PEN_ROW_MAX,
  colorAfterRemoving,
  contrastMark,
  penColorRow,
  pickPenColor,
  pushRecentColor,
  parseHexColor,
  removablePenColor,
  removePenColor,
  reservedPenColors,
  sameColor,
} from "../model/colors";
import { bindSwatchDrag } from "./swatch-drag";
import { shownColor } from "../canvas/backdrop";
import { nightHighlighter } from "../canvas/night";
import { bindPenTypeDrag } from "./pen-type-drag";
import { movePenType, penTypeOrderOf, shownPenTypes } from "../model/pen-type-order";
import { bindPillDrag } from "./pill-drag";
import {
  DEFAULT_PILL_DOCK,
  type PillArea,
  type PillDock,
  type PopoverSide,
  colorWindow,
  dockPlace,
  isUpright,
  nearestDock,
  parsePillDock,
  pillClearance,
  popoverSide,
} from "./pill-dock-model";
import {
  type BarDock,
  DEFAULT_BAR_DOCK,
  barMenuSide,
  isBarUpright,
  UPRIGHT_BUTTON_MAX,
  pageArea,
  parseBarDock,
  sideLift,
  uprightButtonSize,
} from "./bar-dock-model";
import {
  NO_PILL_ROW,
  type PillRow,
  foldedBadge,
  pageTopShift,
  penWidthsShown,
  pillFitsBar,
  pillRow,
  pillRowEdge,
  widestRow,
} from "./pill-row-model";
import { hiddenEnds, pageScroll, scrollToShow } from "./swatch-drag-model";
import { closingPressStops } from "./popover-dismiss";
import { formatMm } from "../model/units";
import { chosenWidth, nearestStop, widthStops } from "../model/pen-widths";
import { dragRange } from "./range-drag";
import { RowDrag } from "./row-drag";
import { moveTo } from "./row-drag-model";
import { syncRangeFill } from "./range-fill";
import { clampEraserSize, eraserStops } from "../model/eraser-sizes";
import {
  DEFAULT_WIDTH_PRESETS,
  type WidthPresets,
  chosenSlot,
  eraserPresetsOf,
  presetsFor,
  withEraserPreset,
  withWidthPreset,
  withoutWidthPresets,
} from "../model/width-presets";
import { PANEL_SLIDE_MS, prefersReducedMotion, springCurve } from "./motion";
import {
  EASE_OUT_FALLBACK,
  POPOVER_IN,
  POPOVER_OUT,
  SPRING_FALLBACK,
  type Spring,
  TOOL_INDICATOR,
  springMs,
} from "./springs";
import {
  DEFAULT_TABLE_SIZE,
  TABLE_MAX_COLS,
  TABLE_MAX_ROWS,
  type TableSize,
  isTableSize,
  tableSizeLabel,
} from "../ink/table-geometry";
import {
  LASSO_FILTER_KEYS,
  LASSO_MODES,
  type LassoFilter,
  type LassoMode,
  lassoFilterOf,
  lassoModeOf,
} from "../canvas/lasso";
import { type EraserFilter, eraserFilterOf } from "../ink/stroke-eraser";
import { type PenGestures, penGesturesOf } from "../ink/pen-gestures";
import type { HighlighterTip, PenPreferences, ReturnToPen, SnapMode } from "../settings-data";
import {
  MAX_SAVED_PENS,
  type SavedPen,
  type SavedPenType,
  mmText,
  samePen,
  savedPenById,
  savedPenLabel,
  widthFromMm,
} from "../model/saved-pens";
import {
  type PenStabilization,
  stabilizationOf,
  withStabilization,
} from "../model/pen-stabilization";
import { DialogKeyboard } from "./dialog-keyboard";
import { DEFAULT_FILL_COLOR, FILL_GAPS, type FillGap, readFillGap } from "../model/fill-region";
import { onEnterKey } from "./enter-key";
import {
  DEFAULT_ARROW_HEADS,
  FILL_OPACITIES,
  type ShapeToolStyle,
  TINT_ALPHA,
  nearestFillOpacity,
  readShapeToolStyle,
} from "../model/shape-style";
import { isElement, sizeObserver, watchSize, winOf } from "./host-window";

/**
 * Tools selectable in the toolbar. Pen, highlighter and shape produce
 * strokes. The laser pointer draws a fading trail that is never kept; it has
 * no bar button (FineNotes#25): L, or the pen type menu.
 */
export type ActiveTool =
  | "pen"
  | "highlighter"
  | "eraser"
  | "select"
  | "text"
  | "shape"
  | "laser"
  | "pan"
  | "zoom"
  | "fill"
  | "tape";

/**
 * Pen types, as GoodNotes presents them. The highlighter is a pen type there,
 * not a top-level tool, so tier 1 shows one "pen" button and the type is chosen
 * in tier 2. Each type is expressed with knobs the ink engine already has.
 */
export type PenType = "fountain" | "ball" | "brush" | "calligraphy" | "highlighter";

export interface PenTypeSpec {
  id: PenType;
  label: string;
  tool: ActiveTool;
  /** Pressure-varying width. A ballpoint is deliberately uniform. */
  pressure: boolean;
  /** Multiplier on the chosen stroke width. */
  sizeScale: number;
  /** A flat nib at this angle, degrees: the width follows the direction (calligraphy). */
  nib?: number;
}

export const PEN_TYPES: readonly PenTypeSpec[] = [
  {
    id: "fountain",
    get label() {
      return t("toolbar.pen.fountain");
    },
    tool: "pen",
    pressure: true,
    sizeScale: 1,
  },
  {
    id: "ball",
    get label() {
      return t("toolbar.pen.ball");
    },
    tool: "pen",
    pressure: false,
    sizeScale: 1,
  },
  {
    id: "brush",
    get label() {
      return t("toolbar.pen.brush");
    },
    tool: "pen",
    pressure: true,
    sizeScale: 1.8,
  },
  // A broad italic nib held at 40°, as calligraphy is taught: thick on the
  // downstrokes, hairline on the upstrokes. Width by direction, not pressure.
  {
    id: "calligraphy",
    get label() {
      return t("toolbar.pen.calligraphy");
    },
    tool: "pen",
    pressure: false,
    sizeScale: 2.6,
    nib: 40,
  },
  {
    id: "highlighter",
    get label() {
      return t("toolbar.pen.highlighter");
    },
    tool: "highlighter",
    pressure: false,
    sizeScale: 4,
  },
];

/**
 * The pen types in the pen's row, in the user's order (`penTypeOrder`):
 * every one, the highlighter included, as the toolbar has no highlighter
 * button of its own (the pen button stands for both, as in Goodnotes).
 */
export function penRowTypes(state: ToolbarState): PenTypeSpec[] {
  const order = penTypeOrderOf(
    state.penTypeOrder,
    PEN_TYPES.map((spec) => spec.id),
  );
  return order.map((id) => PEN_TYPES.find((spec) => spec.id === id) ?? PEN_TYPES[0]);
}
/** The pen type a toolbar state implies. Used by the surface to size strokes. */
export function penTypeFor(state: ToolbarState): PenTypeSpec {
  const id = state.penType ?? (state.tool === "highlighter" ? "highlighter" : "fountain");
  return PEN_TYPES.find((p) => p.id === id) ?? PEN_TYPES[0];
}

/**
 * The stroke width actually laid down, page px. A pen type is a multiplier
 * on the width the user picked (a highlighter is a fat nib, a brush a soft
 * one), so the width controls keep meaning the same thing across pen types.
 * The surface draws with this and the width popover previews it.
 */
export function strokeWidthFor(state: ToolbarState): number {
  // A shape is drawn at the chosen width: a highlighter or brush nib would
  // make an outline four times too fat.
  if (state.tool === "shape") {
    return Math.max(0.5, readShapeToolStyle(state.shapeStyle).width ?? state.size);
  }
  const spec = penTypeFor(state);
  // Pen and highlighter share one width, and only the pens go below the
  // thinnest preset (FineNotes#7).
  const floor = spec.tool === "highlighter" ? Math.min(...SIZES) : 0;
  return Math.max(0.5, chosenWidth(state.size, floor) * spec.sizeScale);
}

/** The tool whose options memory `tool` shares: the highlighter is a pen type. */
function optionsKey(tool: ActiveTool): ActiveTool {
  return tool === "highlighter" ? "pen" : tool;
}

/** The icon a tool's pill shows while it is being carried: its tool bar button's. */
const PILL_ICONS: Partial<Record<ActiveTool, string>> = {
  pen: "pen-tool",
  eraser: "eraser",
  text: "type",
  shape: "shapes",
  pan: "hand",
  zoom: "zoom-in",
  fill: "paint-bucket",
};

/** The Fill tool's gap choices: a whole ring, a dashed one, an open one. */
const FILL_GAP_ICONS: Record<FillGap, string> = {
  exact: "circle",
  small: "circle-dashed",
  large: "loader-circle",
};

const FILL_GAP_LABELS: Record<FillGap, string> = {
  get exact() {
    return t("toolbar.fill.gap.exact");
  },
  get small() {
    return t("toolbar.fill.gap.small");
  },
  get large() {
    return t("toolbar.fill.gap.large");
  },
};

/** The places the pill can be dragged to: all four (pill-dock-model.ts). */
const OFFERED_DOCKS: readonly PillDock[] = ["top", "bottom", "left", "right"];

function offeredDock(raw: unknown): PillDock {
  const dock = parsePillDock(raw);
  return OFFERED_DOCKS.includes(dock) ? dock : DEFAULT_PILL_DOCK;
}

/**
 * Tools whose options pill starts tucked away each time they are picked, so
 * the page stays clear while writing: a tap on the tool's button again shows
 * it. The pen (and the highlighter with it).
 */
const STARTS_TUCKED: ReadonlySet<ActiveTool> = new Set<ActiveTool>(["pen"]);

/** The pen a toolbar state writes with, as a saved pen would hold it. */
export function penOfState(state: ToolbarState): SavedPen {
  return { type: penTypeFor(state).id, color: state.color, size: state.size };
}

/**
 * How the eraser removes ink. `standard` rubs out only what it passes over,
 * splitting strokes; `stroke` removes every stroke it touches, whole (the
 * names are GoodNotes': "Standard" / "Erase entire stroke"); `ruled`, on
 * lined paper, takes whole words line by line with their commas and dots,
 * and whole lines from the margin (Stylus Labs Write's ruled erase,
 * FineNotes#20).
 */
export type EraserMode = "standard" | "stroke" | "ruled";

const ERASER_MODES: ReadonlyArray<{ id: EraserMode; label: string }> = [
  {
    id: "standard",
    get label() {
      return t("toolbar.eraser.mode.standard");
    },
  },
  {
    id: "stroke",
    get label() {
      return t("toolbar.eraser.mode.stroke");
    },
  },
  {
    id: "ruled",
    get label() {
      return t("toolbar.eraser.mode.ruled");
    },
  },
];

/** The eraser mode a toolbar state implies. Anything unknown counts as standard. */
export function eraserModeFor(state: ToolbarState): EraserMode {
  const mode = state.eraserMode;
  return mode === "stroke" || mode === "ruled" ? mode : "standard";
}

/** What the eraser may erase, as a toolbar state implies it. `undefined` counts as everything. */
export function eraserFilterFor(state: ToolbarState): EraserFilter {
  return eraserFilterOf(state.eraserFilter);
}

const ERASER_FILTER_LABELS: Record<EraserFilter, string> = {
  get all() {
    return t("toolbar.eraser.filter.all");
  },
  get highlighter() {
    return t("toolbar.eraser.filter.highlighter");
  },
  get pen() {
    return t("toolbar.eraser.filter.pen");
  },
};

/** The lasso's type a toolbar state implies. `undefined` counts as freehand, GoodNotes' default. */
export function lassoModeFor(state: ToolbarState): LassoMode {
  return lassoModeOf(state.lassoMode);
}

/** What the lasso picks up, as a toolbar state implies it. `undefined` counts as everything. */
export function lassoFilterFor(state: ToolbarState): LassoFilter {
  return lassoFilterOf(state.lassoFilter);
}

/** A symbol for each kind of thing the lasso picks up, for its row in the bar. */
/** The laser's colours in a docked bar: its own red first. */
const LASER_COLORS: readonly string[] = [
  LASER_COLOR,
  "#ff9500",
  "#ffcc00",
  "#34c759",
  "#0a84ff",
  "#bf5af2",
];

const LASSO_FILTER_ICONS: Record<(typeof LASSO_FILTER_KEYS)[number], string> = {
  handwriting: "signature",
  images: "image",
  shapes: "shapes",
  arrows: "move-up-right",
  textBoxes: "type",
  tables: "table",
  graphs: "chart-spline",
};

const LASSO_MODE_LABELS: Record<LassoMode, string> = {
  get rect() {
    return t("toolbar.lasso.mode.rect");
  },
  get freehand() {
    return t("toolbar.lasso.mode.freehand");
  },
  get lines() {
    return t("toolbar.lasso.mode.lines");
  },
  get single() {
    return t("toolbar.lasso.mode.single");
  },
};

/** The lasso button's name for each type: the type is part of a whole sentence. */
const LASSO_SELECT_TIPS: Record<LassoMode, string> = {
  get rect() {
    return t("toolbar.lasso.selectTip.rect");
  },
  get freehand() {
    return t("toolbar.lasso.selectTip.freehand");
  },
  get lines() {
    return t("toolbar.lasso.selectTip.lines");
  },
  get single() {
    return t("toolbar.lasso.selectTip.single");
  },
};

/** GoodNotes' "What to include in the selection", less what this plugin does not have. */
const LASSO_FILTER_LABELS: Record<keyof LassoFilter, string> = {
  get handwriting() {
    return t("toolbar.lasso.filter.handwriting");
  },
  get images() {
    return t("toolbar.lasso.filter.images");
  },
  get shapes() {
    return t("toolbar.lasso.filter.shapes");
  },
  get arrows() {
    return t("toolbar.lasso.filter.arrows");
  },
  get textBoxes() {
    return t("toolbar.lasso.filter.textBoxes");
  },
  get tables() {
    return t("toolbar.lasso.filter.tables");
  },
  get graphs() {
    return t("toolbar.lasso.filter.graphs");
  },
};

/**
 * The Shape tool's mode a toolbar state implies. The tool no longer offers
 * auto-shape (the pen's Auto shape does that), so a mode remembered as
 * "auto", or none, is the rectangle.
 */
export function shapeModeFor(state: ToolbarState): ShapeMode {
  return isShapeMode(state.shapeMode) && state.shapeMode !== "auto" ? state.shapeMode : "rect";
}

const SHAPE_LABELS: Record<ShapeMode, string> = {
  get auto() {
    return t("toolbar.shape.auto");
  },
  get rect() {
    return t("toolbar.shape.rect");
  },
  get ellipse() {
    return t("toolbar.shape.ellipse");
  },
  get triangle() {
    return t("toolbar.shape.triangle");
  },
  get diamond() {
    return t("toolbar.shape.diamond");
  },
  get roundrect() {
    return t("toolbar.shape.roundrect");
  },
  get star() {
    return t("toolbar.shape.star");
  },
  get heart() {
    return t("toolbar.shape.heart");
  },
  get line() {
    return t("toolbar.shape.line");
  },
  get arrow() {
    return t("toolbar.shape.arrow");
  },
  get elbow() {
    return t("toolbar.shape.elbow");
  },
  get table() {
    return t("toolbar.shape.table");
  },
};

/**
 * The table size picked last, in any notebook this session, so a notebook
 * opened later starts from it rather than from 3 × 3 again. Like the Shape
 * tool's mode, it is not kept across restarts.
 */
let lastTableSize: TableSize = { ...DEFAULT_TABLE_SIZE };

/** The table size a toolbar state implies. */
export function tableSizeFor(state: ToolbarState): TableSize {
  return isTableSize(state.tableSize) ? state.tableSize : lastTableSize;
}

/** The eraser diameter (page px) a toolbar state implies. */
export function eraserSizeFor(state: ToolbarState): number {
  const size = state.eraserSize;
  return typeof size === "number" && Number.isFinite(size) && size > 0 ? size : DEFAULT_ERASER_SIZE;
}

export interface ToolbarState {
  tool: ActiveTool;
  color: string;
  size: number;
  pressureEnabled: boolean;
  /**
   * When a pen or highlighter stroke snaps to a shape (Pen gestures › Make
   * shapes): never, after a hold, or on lift too (the pill's Auto shape
   * button). `undefined` counts as `"hold"`.
   */
  snapMode?: SnapMode;
  /** How curved a stroke may be and still snap, 10–100. `undefined` counts as 50. */
  snapCurvatureThreshold?: number;
  /** The Shape tool's colour. `undefined` counts as {@link DEFAULT_SHAPE_COLOR}. */
  shapeColor?: string;
  /** Custom colours picked lately, newest first, for every colour picker. */
  recentColors?: string[];
  /** The pen row's picked slots, after the reserved ones. `undefined`: the built-in palette. */
  penColors?: string[];
  /**
   * Each pen type's own colour and row, kept while another pen type is in
   * hand (`model/pen-inks.ts`). The type in hand's live ones are `color` and
   * `penColors`.
   */
  penInks?: PenInks;
  /**
   * Each pen type's stroke stabilization, whole percent
   * (`model/pen-stabilization.ts`). `undefined`: every pen at 0%, off.
   */
  penStabilization?: PenStabilization;
  /** The Shape tool's mode. `undefined` (or a remembered "auto") counts as the rectangle. */
  shapeMode?: ShapeMode;
  /** The Shape tool's fill, line, corners and arrowheads. `undefined`: plain outlines. */
  shapeStyle?: ShapeToolStyle;
  /** The Table tool's size. `undefined` counts as the last one picked. */
  tableSize?: TableSize;
  /** New tables get a header row, a soft fill behind the first row. */
  tableHeader?: boolean;
  /** Active pen type. `undefined` counts as "fountain". */
  penType?: PenType;
  /**
   * The pen types' order in the pen's row (`model/pen-type-order.ts`).
   * `undefined`: their own order.
   */
  penTypeOrder?: PenType[];
  /** Scribble to erase and Circle to lasso. `undefined` counts as GoodNotes' defaults. */
  penGestures?: PenGestures;
  /** Eraser mode. `undefined` counts as "standard". */
  eraserMode?: EraserMode;
  /** Eraser diameter in page px. `undefined` counts as {@link DEFAULT_ERASER_SIZE}. */
  eraserSize?: number;
  /**
   * Each pen type's three width presets (`model/width-presets.ts`). A type
   * left out, or `undefined`, has the defaults.
   */
  widthPresets?: WidthPresets;
  /** The eraser's three preset sizes. `undefined`: the defaults. */
  eraserPresets?: number[];
  /** What the eraser may erase. `undefined` counts as everything. */
  eraserFilter?: EraserFilter;
  /**
   * "Grey out while erasing": Whole stroke and By line draw what they take
   * grey until the pen lifts, instead of hiding it. `undefined` counts as off.
   */
  eraserGrey?: boolean;
  /** The lasso's type. `undefined` counts as freehand. */
  lassoMode?: LassoMode;
  /** What the lasso picks up. `undefined` counts as everything. */
  lassoFilter?: LassoFilter;
  /** The Text tool's style for new boxes. `undefined` counts as {@link DEFAULT_TEXT_STYLE}. */
  textStyle?: TextStyle;
  /**
   * The Text tool places equations (its pill's Σ, discussion #166): a tap on
   * the page opens the equation editor instead of a text box. `undefined` counts as off.
   */
  textEquation?: boolean;
  /** "Pin Text tool": Text stays the tool after a box is finished. `undefined` counts as unpinned. */
  textPinned?: boolean;
  /**
   * "Drag to size": a drag with the Text tool draws the new box's size.
   * `undefined` counts as off, where every new box fits its text.
   */
  textDragSize?: boolean;
  /** How far the Fill tool reaches past gaps in an outline. `undefined` counts as "small". */
  fillGap?: FillGap;
  /** The Fill tool's own colour. `undefined` counts as {@link DEFAULT_FILL_COLOR}. */
  fillColor?: string;
  /** The ruler's kind. `undefined` counts as the straight ruler. */
  rulerKind?: RulerKind;
  /** The ruler's angle snapping, degrees, 0 for off. `undefined` counts as 15. */
  rulerSnap?: number;
  /**
   * The Magnifier's mode: `true` writes in a floating Zoom box, `false` (or
   * absent) zooms the page itself. The box stays open while another tool is
   * picked; only the Magnifier's own switch and its × close it.
   */
  zoomBox?: boolean;
  /** A target box and its window are open on the page right now. */
  zoomBoxOpen?: boolean;
  /** Cover tape's colour (`model/cover-tape`). `undefined` counts as masking tape. */
  tapeColor?: string;
  /** Cover tape's height, page px. `undefined` counts as the medium height. */
  tapeHeight?: number;
  /** The tape pill's three heights, each as the slider left it. `undefined`: the defaults. */
  tapeHeights?: readonly number[];
  /** How a new cover tape is laid. `undefined` counts as straight. */
  tapeMode?: TapeMode;
  /** Whether a cover tape dragged along a PDF's text covers its lines. `undefined` is off. */
  tapeSnapText?: boolean;
}

export interface ToolbarCallbacks {
  // Declared as properties holding functions, not as method signatures.
  // A method signature makes `callbacks.onFoo` an unbound method reference,
  // which @typescript-eslint/unbound-method rejects in CI's plugin-review
  // config — and it is right to: a host that wrote these as methods on a
  // class would lose `this` the moment we read one. A callback is a value.
  onToolChange: (tool: ActiveTool) => void;
  returnToPenOnReselect?: () => boolean;
  onColorChange: (color: string) => void;
  onSizeChange: (size: number) => void;
  /** The laser pointer's colour changed in its pill. Hosts persist it. */
  onLaserColorChange?: (color: string) => void;
  onPressureToggle: (enabled: boolean) => void;
  /** Whether pressure pens may widen with pressure (the advanced setting); off when absent. */
  pressureAllowed?: () => boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  // --- Later additions. Optional: a host that supplies none
  // gets a disabled control rather than a control that lies.
  onPenTypeChange?: (spec: PenTypeSpec) => void;
  /** Eraser mode or size changed. Hosts persist it across sessions. */
  onEraserChange?: (mode: EraserMode, size: number) => void;
  /** A pen type's width presets changed (`ToolbarState.widthPresets`). Hosts persist them. */
  onWidthPresets?: (presets: WidthPresets) => void;
  /** The eraser's preset sizes changed (`ToolbarState.eraserPresets`). Hosts persist them. */
  onEraserPresets?: (presets: number[]) => void;
  /**
   * Screen px per page px for the size previews: the pen's at the zoom now,
   * the eraser's at fit-to-page. Left out, a page px is drawn as a screen px.
   */
  sizePreviewScales?: () => { pen: number; eraser: number };
  /**
   * Paint the page in view's paper and lines at the zoom now into a canvas
   * `width` by `height` CSS px: the size previews' paper. False when there
   * is no page to paint; the strip then keeps its plain paper.
   */
  paintSizePaper?: (canvas: HTMLCanvasElement, width: number, height: number) => boolean;
  /** "Erase highlighter only" / "Erase pen only" changed. Hosts persist it. */
  onEraserFilterChange?: (filter: EraserFilter) => void;
  /** "Grey out while erasing" was switched. Hosts persist it. */
  onEraserGreyChange?: (on: boolean) => void;
  /** The lasso's type, or what it picks up, changed. Hosts persist it. */
  onLassoChange?: (mode: LassoMode, filter: LassoFilter) => void;
  /** Add a page; `anchor` is the button, for a popover to hang from. */
  onAddPage?: (anchor: HTMLElement) => void;
  onToggleThumbnails?: () => void;
  /** Open Home, the notebook library. Without it the bar has no Home button. */
  onHome?: () => void;
  /** Show the notebook full screen, or leave it. Without it the bar has no such button. */
  onFullScreen?: () => void;
  onSearch?: () => void;
  // --- 0.5 (contracts/api.md v7).
  /** Open the image menu (Photos, camera, files, vault, scan, AI); `anchor` is the button. */
  onInsertImage?: (anchor: HTMLElement) => void;
  /** Import whole or selected PDF pages. */
  onInsertPdf?: (anchor: HTMLElement) => void;
  /** Open the AI menu (transcribe, ask, generate an image); `anchor` is the button. */
  onAi?: (anchor: HTMLElement) => void;
  /** Open the calculator; `anchor` is the button. */
  onCalculator?: (anchor: HTMLElement) => void;
  /** Start or stop an audio recording, or open its controls; `anchor` is the button. */
  onRecord?: (anchor: HTMLElement) => void;
  /** Open this note's settings (where its pictures and recordings go); `anchor` is the gear. */
  onSettings?: (anchor: HTMLElement) => void;
  /** Export pages as a PDF and share it (GoodNotes' share button); `anchor` is the button. */
  onShare?: (anchor: HTMLElement) => void;
  /** Open the ⋯ panel for the page being read; `anchor` is the button. */
  onMore?: (anchor: HTMLElement) => void;
  /** A practice sheet's "Learn my handwriting": opens the Learn your handwriting window. */
  onLearnHandwriting?: () => void;
  /** The options pill was placed (it may have moved); `chromeSpans` says where. */
  onPillPlaced?: () => void;
  /** The user dragged the options pill to `dock`; the host keeps it for this device. */
  onPillDock?: (dock: PillDock) => void;
  /**
   * The docked pill's row (pill-row-model.ts) changed, moving the page's top
   * by `shift` px (down positive): the surface keeps the spot read still.
   */
  onPillRow?: (shift: number) => void;
  // --- The Text tool (0.5).
  /** A text control changed: apply `patch` to the box being edited, if there is one. */
  onTextStyle?: (patch: TextStylePatch) => void;
  /**
   * A field in the text pill (the font search), which took the focus from
   * the box being styled, is done; focus went to `to`, if anywhere. The
   * host gives the box its focus back (`InkSurface.textFieldDone`).
   */
  onTextFieldDone?: (to: Element | null) => void;
  /**
   * The size slider is being dragged: show the box at `fontSize` without a
   * step of undo (`null`: back to its own size). The size is stored, as one
   * step, through `onTextStyle` when the slider is let go.
   */
  onTextSizePreview?: (fontSize: number | null) => void;
  /** The Text tool's own state changed (style for new boxes, pin, drag to size). Hosts persist it. */
  onTextToolChange?: (style: TextStyle, pinned: boolean, dragSize: boolean) => void;
  /** Bullets or numbering for the lines under the caret of the box being edited. */
  onTextList?: (kind: ListKind) => void;
  /** Delete the text box being edited. */
  onTextDelete?: () => void;
  /** A pen gesture was switched on or off. Hosts persist it. */
  onPenGesturesChange?: (gestures: PenGestures) => void;
  /** A pen type's stroke stabilization changed (every step of a drag). Hosts persist it. */
  onPenStabilization?: (all: PenStabilization) => void;
  /** The settings the pen's menu holds for every pen, as they are now. */
  penPreferences?: () => PenPreferences;
  /** One of them changed in the pen's menu. Hosts persist and apply it. */
  onPenPreferences?: (patch: Partial<PenPreferences>) => void;
  /** The Shape tool's colour changed. Hosts persist it. */
  onShapeColorChange?: (color: string) => void;
  /** Cover tape's colour, height, mode or one of its three heights changed. Hosts persist it. */
  onTapeChange?: (
    color: string,
    height: number,
    mode: TapeMode,
    heights: readonly number[],
  ) => void;
  /** Cover tape's Snap to PDF text was switched. Hosts persist it. */
  onTapeSnapTextChange?: (on: boolean) => void;
  /**
   * Whether the cover tapes on the page in view are all shown through, or
   * `null` when it has none. Without it the tape's pill has no eye.
   */
  tapesShown?: () => boolean | null;
  /** Show every cover tape on the page in view through (`true`), or cover them all. */
  onShowTapes?: (shown: boolean) => void;
  /** "Header row" for new tables changed. Hosts persist it. */
  onTableHeaderChange?: (on: boolean) => void;
  /** The notebook's palette, offered first in every colour picker. */
  notebookColors?: () => readonly string[];
  /** The Shape tool's style changed. Hosts persist it. */
  onShapeStyleChange?: (style: ShapeToolStyle) => void;
  /** The Fill tool's gap choice changed. Hosts persist it. */
  onFillGapChange?: (gap: FillGap) => void;
  /** The Fill tool's colour changed. Hosts persist it; the pen's stays. */
  onFillColorChange?: (color: string) => void;
  /** A custom colour was picked: the new recent list. Hosts persist it. */
  onRecentColors?: (colors: string[]) => void;
  /**
   * Pick a colour from the page: the next press on it picks one, and `done`
   * gets it, or `null` if the pick was cancelled. Without it the colour
   * pickers offer no eyedropper.
   */
  onPickFromPage?: (done: (color: string | null) => void) => void;
  /** The pen row's picked slots changed. Hosts persist them. */
  onPenColors?: (colors: string[]) => void;
  /** The pen types were put in another order in the pen's row; the host keeps it. */
  onPenTypeOrder?: (order: PenType[]) => void;
  /** A pen type's own colour or row changed (`ToolbarState.penInks`). Hosts persist them. */
  onPenInks?: (inks: PenInks) => void;
  // --- Saved pens (FineNotes#24, #25). Without `savedPens`, no star in the pill.
  /** The saved pens, as the settings have them now. */
  savedPens?: () => readonly SavedPen[];
  /** "Save current pen": add `pen` to the saved pens. Hosts persist it. */
  onSavePen?: (pen: SavedPen) => void;
  /**
   * The pen dialog for a new saved pen, starting from `start` (FineNotes#211);
   * `onMade` gets the pen once it is saved, its id included.
   */
  onNewPen?: (start: SavedPen, onMade: (pen: SavedPen) => void) => void;
  /** The saved pens dragged into another order (FineNotes#211). Hosts persist it. */
  onReorderPens?: (pens: SavedPen[]) => void;
  /** A saved pen deleted from Saved pens or Customize toolbar. Hosts persist it. */
  onDeletePen?: (id: string) => void;
  /** "Edit saved pens": open where they are edited (the settings). */
  onEditPens?: () => void;
  /** Bring the ruler out or put it away. Without it the bar has no ruler. */
  onRuler?: () => void;
  /** Open the sticker picker; `anchor` is the button. Without it the bar has no stickers. */
  onStickers?: (anchor: HTMLElement) => void;
  /**
   * A sticky-note colour was picked: the next tap on a page sticks a note of
   * it there. Without it the bar has no sticky notes.
   */
  onStickyColor?: (color: string) => void;
  /** The sticky notes button was tapped while a note waited to be placed: it waits no more. */
  onStickyCancel?: () => void;
  /**
   * Customize toolbar (`toolbar-edit.ts`) moved a button: hosts keep the new
   * layout and show it in every notebook. Without it the More tools menu has
   * no "Customize toolbar" row.
   */
  onLayout?: (layout: ToolbarLayout) => void;
  /** Customize toolbar moved the bar to another edge (`bar-dock-model.ts`). */
  onSetBarDock?: (dock: BarDock) => void;
  /** Customize toolbar switched "Dock tool options" (`pill-row-model.ts`). */
  onSetPillRow?: (on: boolean) => void;
  /** The look worn now (`model/look.ts`), for Customize toolbar's Style and Colours rows. */
  lookNow?: () => { style: LookStyle; palette: LookPalette };
  /** Customize toolbar picked a style or colours. */
  onSetLook?: (style: LookStyle, palette: LookPalette) => void;
  /** The ruler's kind or snapping changed in its popover. Hosts persist it and bring the ruler out. */
  onRulerChange?: (kind: RulerKind, snap: number) => void;
  /** Stylus-only mode's toolbar button was tapped: turn the mode on or off. */
  onOnlyStylusMode?: (on: boolean) => void;
  /** The magnifier's own pill: one zoom step in or out, or the page fitted. */
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onZoomFit?: () => void;
  /** The Magnifier's mode switched: open or close the Zoom box. */
  onZoomBox?: (on: boolean) => void;
  /** Open (a placed box, `placedZoomBox`) or close the Zoom box, the mode and the tool kept. */
  onZoomBoxOpen?: (open: boolean) => void;
}

export interface ToolbarOptions {
  /** The pen width the width popover's reset returns to; default the middle preset. */
  defaultSize?: number;
  /**
   * Colours the settings define (the default ink, the custom palette): each
   * keeps a slot at the front of the pen's colour row.
   */
  reservedColors?: readonly string[];
  /** Where the options pill rests (`pill-dock-model.ts`); under the tool bar by default. */
  pillDock?: PillDock;
  /** Where the tool bar rests (`bar-dock-model.ts`); along the top by default. */
  barDock?: BarDock;
  /** "Dock tool options": the pill by the bar is a row the page starts past (`pill-row-model.ts`). */
  pillRow?: boolean;
  /** Where every button is (`toolbar-layout.ts`); the default layout when absent. */
  layout?: ToolbarLayout;
  /** Stylus-only mode is on, so its toolbar toggle starts on. */
  onlyStylusMode?: boolean;
  /** Fingers draw (the Pencil is away), so ⋯, where that is switched, starts lit. */
  fingerDrawing?: boolean;
  /** The laser pointer's colour, read live so its pill follows Settings, even while it shows. */
  laserColor?: () => string;
}

/** Minimum gap between the pill and the edge of the page area, in CSS px. */
const EDGE_INSET = 8;
/** The room round a docked pill, px: the row is only as tall as the pill and this either side. */
const DOCKED_INSET = 3;
/** How often a floating text pill looks for the keyboard (see `watchKeyboard`). */
const KEYBOARD_WATCH_MS = 250;
/**
 * How much of a text box, in screen px, must still show for its pill to stay
 * by it (or half the box, if that is less); less, and the pill leaves too.
 */
const TEXT_BOX_MIN_SHOWN = 16;
/** How far the text pill floats from its box, in screen px. */
const TEXT_PILL_GAP = 10;

/**
 * A text box on screen, client px: where the text pill floats
 * (`Toolbar.setTextAnchor`); `typing` when it is being typed in.
 */
export interface TextAnchor {
  left: number;
  top: number;
  right: number;
  bottom: number;
  typing?: boolean;
  /**
   * The page's own part of the screen, client px, when the host knows it:
   * on the iPad the window and the toolbar's host reach below the page.
   */
  clipTop?: number;
  clipBottom?: number;
  /** The page is moving (scroll, momentum, zoom): the pill waits until it settles. */
  moving?: boolean;
}

/** A bar button that may fold into ⋯, with its rank and the tool it picks, if any. */
type FoldableItem = FoldedBarItem & { rank: number; button: HTMLElement; tool?: ActiveTool };

/** The least room kept between the centred tools and the groups beside them. */
const BAR_GAP = 8;

/**
 * A tier-1 button folded into the ⋯ panel because the bar ran out of room
 * (`Toolbar.fitBar`). `run` does what the button does, anchored on ⋯.
 */
export interface FoldedBarItem {
  icon: string;
  label: string;
  run: (anchor: HTMLElement) => void;
  /** It carries a mark (the gear's "a newer FineNotes is out"). */
  marked?: boolean;
}

/**
 * INVARIANT: the tool bar never scrolls sideways. When its buttons do not
 * fit, they fold into the ⋯ panel (`foldOrder`): the buttons at the sides
 * from their outer ends in, as the user arranged them; the rest, and the
 * tools last, in this order (lower folds first). Undo, redo, the pen, the eraser and ⋯ itself never
 * fold, and neither does the tool in hand.
 */
const FOLD_RANK = {
  fullScreen: 0,
  calculator: 1,
  pdf: 2,
  sticker: 2.4,
  sticky: 2.6,
  record: 3,
  image: 4,
  ai: 5,
  search: 6,
  share: 7,
  zoom: 8.2,
  pan: 8.3,
  tape: 8.4,
  settings: 8,
  ruler: 8.5,
  shape: 9,
  text: 10,
  select: 11,
  stylus: 11.8,
  addPage: 12,
  thumbnails: 14,
  home: 14.5,
} as const;

/** The sticky-note colour picked last, ringed in the colours; the classic yellow at first. */
let lastStickyColor = DEFAULT_STICKY_COLOR;

/** The strip of the ruler button, from its right edge, that opens its popover: the chevron, px. */
const RULER_CARET_STRIP = 22;

/** The folded pill's one width button, in `widthButtons` beside the preset slots. */
const FOLDED_WIDTH = -1;

/** The pill changing width and place for a new tool: GoodNotes' 0.3 s `ease`. */
const PILL_MORPH_MS = 300;

/** How wide the colour row's faded ends are, CSS px (styles.css); a chosen colour is kept clear of them. */
const COLOR_ROW_FADE_PX = 14;

/** A mouse wheel turned over `row`, a sideways row, scrolls it sideways. */
function wheelScrollsSideways(row: HTMLElement): void {
  row.addEventListener(
    "wheel",
    (event) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      row.scrollLeft += event.deltaY;
      event.preventDefault();
    },
    { passive: false },
  );
}

/** How many colours an upright pill shows; the rest are behind its ⌄. */
const UPRIGHT_COLORS = 3;
/** A new tool's controls fading in. */
const PILL_FADE_MS = 150;

/** Under Reduce Motion a slide or a grow becomes this fade. */
const REDUCED_FADE_MS = 150;

/** How far a popover travels as it grows from its anchor, px. */
const POPOVER_RISE = 6;

/** Where the tool indicator and each tool button's contents are on screen, before a pick. */
interface ToolPlaces {
  indicator: DOMRect;
  contents: Map<Element, { left: number; top: number }>;
}

/** The options pill's box in host px, for gliding it from one place to the next. */
interface PillBox {
  left: number;
  width: number;
}

export class Toolbar {
  /** Tier 1: the tinted tool bar. */
  private readonly barEl: HTMLElement;
  /** Tier 2: the active tool's options pill. */
  private readonly optionsEl: HTMLElement;
  /** The room the docked pill takes from the page, in the bar's colour (`pill-row-model.ts`). */
  private readonly rowEl: HTMLElement;
  /** "Dock tool options" is on, on this device. */
  private pillRowOn = false;
  /** How far the docked side pill's colour column is scrolled. */
  private colorColumnScroll = 0;
  /** Where the pill rested before "Dock tool options" brought it to the bar, to give back when it is off. */
  private pillDockBefore: PillDock | null = null;
  /** The row as shown now. */
  private row: PillRow = NO_PILL_ROW;

  // The buttons that each stand for one choice, keyed by it. `syncActive`
  // marks the one matching the state; the pill's are rebuilt with the pill.
  private readonly toolButtons = new Map<ActiveTool, HTMLElement>();
  /** The lasso type the lasso button shows now (`drawLassoIcon`). */
  private lassoIconMode: LassoMode | null = null;
  /** The eraser mode the eraser button shows now (`drawEraserIcon`). */
  private eraserIconMode: EraserMode | null = null;
  private readonly colorSwatches = new Map<string, HTMLElement>();
  /** Where the pill rests when it is not by a text box (pill-dock-model.ts). */
  private pillDock: PillDock = DEFAULT_PILL_DOCK;
  /** Where the bar rests (bar-dock-model.ts). */
  private barDock: BarDock = DEFAULT_BAR_DOCK;
  /** Watches the pen's colour row give way to a narrow pane (`fitColorRow`). */
  private colorRowWatch: ResizeObserver | null = null;
  /** Watches the pen row give way to the colours in the bar (`fitPenRow`). */
  private penRowWatch: ResizeObserver | null = null;
  /** How far the pen's colour row was scrolled, kept across rebuilds of the pill. */
  private colorRowScroll = 0;
  /** How far the pen type row was scrolled, kept across rebuilds of the pill. */
  private penRowScroll = 0;
  /** A colour was just added with the "+": the row scrolls to its end once to show it. */
  private revealNewColor = false;
  /** The pill's width buttons by preset slot ({@link FOLDED_WIDTH} for the folded pill's one). */
  private readonly widthButtons = new Map<number, HTMLElement>();
  /** The width each of {@link widthButtons} draws, page px. */
  private readonly widthButtonSizes = new Map<number, number>();
  private readonly penTypeButtons = new Map<PenType, HTMLButtonElement>();
  /** The pill's eraser size buttons, by preset slot. */
  private readonly eraserSizeButtons = new Map<number, HTMLButtonElement>();
  /** The width preset picked last: between two holding the same width, this one is chosen. */
  private widthSlot: number | null = null;
  /** The eraser preset picked last, as {@link widthSlot}. */
  private eraserSlot: number | null = null;
  private readonly shapeButtons = new Map<ShapeMode, HTMLButtonElement>();
  /** The Table button's "3 × 4" caption, kept in step with the picked size. */
  private tableCaption: HTMLElement | null = null;
  private homeButton: HTMLButtonElement | null = null;
  private thumbnailsButton: HTMLButtonElement | null = null;
  /** Full screen (tablets only, `onFullScreen`); its icon says which way it goes. */
  private fullScreenButton: HTMLButtonElement | null = null;
  /** The tier-1 pen button, drawn as the pen in hand (`drawPenPreview`). */
  private penToolButton: HTMLElement | null = null;
  /** What the pen button last drew, so an unchanged pen is not redrawn. */
  private penPreviewKey = "";
  /** Pens on the bar as buttons of their own (FineNotes#211), by slot. */
  private readonly penSlotButtons = new Map<PenSlotId, HTMLButtonElement>();
  /** The pen types the pen's button stood for, newest first (`penButtonType`). */
  private penButtonRecent: SavedPenType[] = [];
  /**
   * The pen button last tapped (FineNotes#211): "main" for the pen's own
   * button, or a pinned pen's slot. It decides which button is in hand when
   * two hold the same pen; without a tap the pens are compared.
   */
  private handButton: PenSlotId | "main" | null = null;
  /** The pen the pen's own button had in hand last: it keeps showing it while a pinned pen is used. */
  private mainPen: SavedPen | null = null;
  /** The pen button the indicator marks while a pen is in hand: a slot, or the pen's (`null`). */
  private indicatorSlot: PenSlotId | null = null;
  /** Pages are shown dark: every colour the bar shows is shown as the ink is (`shownColor`). */
  private night = false;
  /** The writing tools, centred on the bar while there is room. */
  private toolsGroup: HTMLElement | null = null;
  /** The tier-1 buttons that may fold into ⋯ (`fitBar`), ranked by `FOLD_RANK`. */
  private readonly foldable: FoldableItem[] = [];
  private moreButton: HTMLButtonElement | null = null;
  /** Every button the bar has, by its item, for placing them (`setLayout`). */
  private readonly barItems = new Map<BarItemId, HTMLButtonElement>();
  /** What a tap on each button does, run from the More tools menu with its button. */
  private readonly itemRuns = new Map<BarItemId, (anchor: HTMLElement) => void>();
  /** Where every button is now (`toolbar-layout.ts`). */
  private layoutNow: ToolbarLayout = defaultLayout();
  /** The bar's three zones, start to end. */
  private zoneEls: Partial<Record<Zone, HTMLElement>> = {};
  /** Customize toolbar while it is open. */
  private editor: ToolbarEditor | null = null;
  /** The last button of the tools: the items off the bar and "Customize toolbar". */
  private accessoriesButton: HTMLButtonElement | null = null;
  /** Stylus-only mode's state, for its button's toggle and on/off mark. */
  private onlyStylusOn = false;
  /** The sticky notes button, on while a note waits to be placed (`setStickyArmed`). */
  private stickyButton: HTMLButtonElement | null = null;
  private settingsButton: HTMLButtonElement | null = null;
  /** "Update available" under the gear while it shows (`showUpdateTip`). */
  private updateTip: HTMLElement | null = null;
  /** Sets `is-crowded` from the groups' widths (`watchCrowding`). */
  private measureCrowding: () => void = () => {};
  /** Folds, centres and marks the bar again (`watchCrowding`), as after a resize. */
  private measureBar: () => void = () => {};
  /** The selected tool's square: one element sliding between the tool buttons. */
  private toolIndicator: HTMLElement | null = null;
  /** The tool the indicator stands under, so a pick of the same tool does not slide. */
  private indicatorTool: ActiveTool | null = null;
  /** The indicator's and the buttons' slides in flight; the next pick cancels them. */
  private toolSlides: Animation[] = [];
  /** The record button (0.5). */
  private recordButton: HTMLButtonElement | null = null;
  /** The add-page button. */
  private addPageButton: HTMLButtonElement | null = null;
  /** The ruler's button, shown on while the ruler is out (`setRulerOut`). */
  private rulerButton: HTMLButtonElement | null = null;
  /** Insert PDF: its pages become pages, which an endless board has not. */
  private insertPdfButton: HTMLButtonElement | null = null;
  /** Bar buttons a practice file hides: everything but the pen, the eraser and the page's own. */
  private beyondWriting: HTMLElement[] = [];
  /** A practice file: only what writing needs ({@link setPractice}). */
  private practice = false;
  /** An endless board ({@link setBoard}). */
  private board = false;
  /** A practice file's "Learn my handwriting", shown only there; its count beside it. */
  private learnButton: HTMLButtonElement | null = null;
  private learnCount: HTMLElement | null = null;
  private undoButton: HTMLButtonElement | null = null;
  private redoButton: HTMLButtonElement | null = null;
  /** Width of a panel docked at the host's left edge; the pill stays clear of it. */
  private leftInset = 0;
  /**
   * The text box the text pill acts on, on screen (client px), while one is
   * held or being typed in: the pill floats beside it (`setTextAnchor`).
   */
  private textAnchor: TextAnchor | null = null;
  /** What `anchoredPlace` decided last, in words, for the debug HUD (`textPillState`). */
  private pillDecision = "toolbar";
  /** While anchored: re-places the pill when the keyboard comes or goes (no event says so). */
  private keyboardWatch = 0;
  private keyboardSeen = 0;

  private popover: HTMLElement | null = null;
  private popoverKind: string | null = null;
  /** The open popover growing in, and the timer that ends it (and gives back its blur). */
  private popoverGrow: Animation | null = null;
  private popoverGrowTimer = 0;
  /** Popovers still closing, each removed by its own timer, never on `finish`. */
  private readonly leavingPopovers = new Map<HTMLElement, number>();
  /** Redraws the open text popover's body in place after a change it made. */
  private popoverRender: (() => void) | null = null;
  /** Places the open popover again after its rows changed on their own (`fitTextPopover`). */
  private popoverRefit: (() => void) | null = null;
  /** The device's fonts for the font menu (`deviceFamilies`), once read. */
  private deviceFonts: string[] | null = null;
  /** The font search has the focus it took from the box being styled. */
  private textFieldOpen = false;
  /** Redraws the open width or eraser-size popover's marks for a new zoom. */
  private sizeMarksRender: (() => void) | null = null;
  /**
   * Style of the page text box being edited, shown in the text pill in place
   * of the style new boxes get. `null` while no box has focus.
   */
  private textTarget: TextStyle | null = null;
  private readonly disposers: Array<() => void> = [];

  /** The active tool remains active when its options are tucked away. */
  private optionsVisible: boolean;
  /** The tool's pill was showing when Customize toolbar opened: it comes back when that closes. */
  private optionsBeforeCustomize = false;
  /** Tools whose options were tucked away when they were left: they come back tucked. */
  private readonly tuckedTools = new Set<ActiveTool>();
  /** A stroke tucked the options away ({@link tuckOptions}), not a tap: they may come back. */
  private tuckedByStroke = false;
  /**
   * The tool `optionsVisible` belongs to. Not `state.tool`: the surface shares
   * the state object and changes its tool before `setState` is called.
   */
  private optionsTool: ActiveTool;
  /** What the pill shows ("text" or a tool); a change fades the new controls in. */
  private pillKind: string | null = null;
  private pillMorph: Animation | null = null;
  /** The button under a pointer that is down on a bar, drawn pressed. */
  private pressed: HTMLElement | null = null;
  private palette: string[];
  /** The pen or highlighter last in use, which "select again" goes back to. */
  private drawingTool: ActiveTool = "pen";
  /** Keeps the width popover's mm field above the iPad keyboard while it is typed in. */
  private popoverKeyboard: DialogKeyboard | null = null;

  /**
   * Both tiers are appended to `host`, the view's content element. `widths`
   * are the preset pen widths; `state` is kept and updated as the user picks,
   * and every pick is also reported through `callbacks`.
   */
  constructor(
    private readonly host: HTMLElement,
    palette: readonly string[],
    private readonly widths: readonly number[],
    private state: ToolbarState,
    private readonly callbacks: ToolbarCallbacks,
    private readonly options: ToolbarOptions = {},
  ) {
    this.palette = [...palette];
    this.optionsTool = state.tool;
    this.onlyStylusOn = options.onlyStylusMode === true;
    this.barEl = host.createDiv({ cls: "goodobsidian-toolbar" });
    this.barEl.setAttribute("role", "toolbar");
    this.barEl.setAttribute("aria-label", t("toolbar.barLabel"));
    // An upright bar taller than its room scrolls: say so at the ends it can go.
    this.barEl.addEventListener("scroll", () => this.syncScrollCues(), { passive: true });
    this.barDock = parseBarDock(options.barDock);
    this.applyBarDock();
    // In the flow after the bar (before it along the bottom, styles.css), so
    // the page body gives it its height.
    this.rowEl = host.createDiv({ cls: "goodobsidian-pill-row" });
    this.pillRowOn = options.pillRow === true;
    // The pill always floats over the page (styles.css, `.is-floating`).
    this.optionsEl = host.createDiv({ cls: "goodobsidian-options is-floating" });
    this.optionsEl.setAttribute("role", "toolbar");
    this.optionsEl.setAttribute("aria-label", t("toolbar.optionsLabel"));
    // A finger drag on a bar, the pill or a popover's slider is ours, not
    // one of Obsidian's swipes, which would open a sidebar (CLAUDE.md).
    this.barEl.dataset.ignoreSwipe = "true";
    this.optionsEl.dataset.ignoreSwipe = "true";

    this.pillDock = offeredDock(options.pillDock);
    // Docked, the pill rests where the bar does (`followBar`).
    if (this.pillRowOn) {
      this.pillDockBefore = this.pillDock;
      this.pillDock = offeredDock(this.barDock);
    }
    // Docked, the pen's pill covers nothing: it need not start tucked away.
    this.optionsVisible = !this.startsTucked(state.tool);
    this.optionsEl.addClass(`is-dock-${this.pillDock}`);
    this.optionsEl.toggleClass("is-upright", isUpright(this.pillDock));
    bindPillDrag(this.optionsEl, {
      host,
      // By a text box the pill follows the box, so there is no place to move it to.
      canDrag: () => !this.optionsEl.hasClass("is-anchored"),
      icon: () =>
        this.optionsEl.hasClass("is-text")
          ? "type"
          : (PILL_ICONS[optionsKey(this.optionsTool)] ?? "pen-tool"),
      onDrop: (x, y) => this.dropPill(x, y),
    });

    this.disposers.push(() => this.colorRowWatch?.disconnect());
    this.disposers.push(() => this.penRowWatch?.disconnect());

    this.buildBar();
    this.buildOptions();
    this.applyPosition();
    this.syncActive();

    this.installDismiss();
    this.keepFocus(this.barEl, true);
    this.keepFocus(this.optionsEl, true);
    this.installPressFeedback();
  }

  /**
   * GoodNotes' press feedback: a pressed button's background square shrinks
   * while held and springs back on release (styles.css, `[data-pressed]`).
   * Driven by pointer events, as GoodNotes does, because iPadOS only applies
   * `:active` to pages with a touch listener. The release is heard on the
   * document: a mouse let go off the button never reaches it.
   */
  private installPressFeedback(): void {
    const release = (): void => {
      this.pressed?.removeAttribute("data-pressed");
      this.pressed = null;
    };
    const press = (event: PointerEvent): void => {
      release();
      const button = (event.target as Element | null)?.closest("button");
      if (!button || button.disabled) return;
      button.setAttribute("data-pressed", "");
      this.pressed = button;
    };
    const doc = this.host.ownerDocument;
    this.barEl.addEventListener("pointerdown", press);
    this.optionsEl.addEventListener("pointerdown", press);
    doc.addEventListener("pointerup", release, true);
    doc.addEventListener("pointercancel", release, true);
    this.disposers.push(() => {
      this.barEl.removeEventListener("pointerdown", press);
      this.optionsEl.removeEventListener("pointerdown", press);
      doc.removeEventListener("pointerup", release, true);
      doc.removeEventListener("pointercancel", release, true);
    });
  }

  /**
   * Chrome buttons never take focus from a page text box. Without this a tap
   * on the pill blurred the box being styled: the iPad keyboard dropped and
   * the change had no box to land on. `pointerdown` covers pen and touch;
   * `mousedown` is where desktop browsers move focus. The click still fires.
   * Buttons only — an input a popover may hold still needs focus to be typed in.
   */
  private keepFocus(el: HTMLElement, dispose: boolean): void {
    const keep = (event: Event): void => {
      const target = event.target as Element | null;
      if (target?.closest("button")) event.preventDefault();
    };
    el.addEventListener("pointerdown", keep);
    el.addEventListener("mousedown", keep);
    if (!dispose) return;
    this.disposers.push(() => {
      el.removeEventListener("pointerdown", keep);
      el.removeEventListener("mousedown", keep);
    });
  }

  // --- Tier 1 ---------------------------------------------------------------

  private buildBar(): void {
    // Passing `cb.onFoo` straight through is safe: ToolbarCallbacks declares
    // them as properties holding functions, not as methods. Passing
    // `undefined` is load-bearing — barButton disables a button that has no
    // handler, which is how the not-yet-implemented tools render greyed out.
    const cb = this.callbacks;
    // Three zones along the bar (toolbar-layout.ts): the start, the writing
    // tools centred in the middle, the document's actions at the end. Every
    // button is built once; `setLayout` puts each in its zone and place.
    const start = this.barEl.createDiv({ cls: "goodobsidian-bar-group is-start" });
    const tools = this.barEl.createDiv({ cls: "goodobsidian-bar-group is-tools" });
    const doc = this.barEl.createDiv({ cls: "goodobsidian-bar-group goodobsidian-bar-doc" });
    this.zoneEls = { start, middle: tools, end: doc };
    this.toolsGroup = tools;
    // First in its group, so every button paints over it; it follows the
    // tool in hand into whichever zone that is (`placeIndicator`).
    this.toolIndicator = tools.createDiv({ cls: "goodobsidian-tool-indicator is-hidden" });
    const beyond: HTMLElement[] = [];
    this.beyondWriting = beyond;
    const keep = (button: HTMLElement): void => {
      beyond.push(button);
    };
    // Every button, by its item; `run` is what the More tools menu does with it.
    const item = (
      id: BarItemId,
      button: HTMLButtonElement,
      run: ((anchor: HTMLElement) => void) | undefined,
      kept = true,
    ): HTMLButtonElement => {
      this.barItems.set(id, button);
      button.setAttribute("data-item", id);
      if (run) this.itemRuns.set(id, run);
      if (kept) keep(button);
      return button;
    };

    const home = cb.onHome;
    if (home) {
      this.homeButton = this.barButton(start, "house", t("toolbar.item.home"), home);
      // Home may fold, last of all (Joost, 2026-11-13).
      this.fold(FOLD_RANK.home, this.homeButton, "house", t("toolbar.item.home"), home);
      item("home", this.homeButton, home, false);
    }
    this.thumbnailsButton = this.barButton(
      start,
      "panel-left",
      t("toolbar.pageThumbnails"),
      cb.onToggleThumbnails,
    );
    this.fold(
      FOLD_RANK.thumbnails,
      this.thumbnailsButton,
      "panel-left",
      t("toolbar.pageThumbnails"),
      cb.onToggleThumbnails,
    );
    item("thumbnails", this.thumbnailsButton, cb.onToggleThumbnails, false);
    const search = cb.onSearch;
    item(
      "search",
      this.foldButton(start, FOLD_RANK.search, "search", t("toolbar.searchNotebook"), search),
      search,
    );
    item("ai", this.foldButton(start, FOLD_RANK.ai, "sparkles", t("toolbar.ai"), cb.onAi), cb.onAi);
    item(
      "calculator",
      this.foldButton(
        start,
        FOLD_RANK.calculator,
        "calculator",
        t("toolbar.calculator"),
        cb.onCalculator,
      ),
      cb.onCalculator,
    );
    const undo = (): void => this.callbacks.onUndo();
    const redo = (): void => this.callbacks.onRedo();
    this.undoButton = item(
      "undo",
      this.barButton(start, "undo-2", t("toolbar.undoTip"), undo),
      undo,
      false,
    );
    this.redoButton = item(
      "redo",
      // Undo and redo never fold (Joost, 2026-11-13).
      this.barButton(start, "redo-2", t("toolbar.redoTip"), redo),
      redo,
      false,
    );

    const tool = (id: ActiveTool & BarItemId, icon: string, label: string): void => {
      const button = this.addToolButton(tools, id, icon, label);
      item(id, button, (anchor) => this.tapTool(id, anchor), id !== "pen" && id !== "eraser");
    };
    tool("select", "lasso", t("toolbar.tip.lasso"));
    tool("pen", "pen-tool", t("toolbar.tip.pen"));
    tool("eraser", "eraser", t("toolbar.tip.eraser"));
    tool("text", "type", t("toolbar.tip.textBox"));
    tool("shape", "shapes", t("toolbar.tip.shapes"));
    // Page navigation tools. In More tools by default.
    tool("pan", "hand", t("toolbar.tip.hand"));
    tool("zoom", "zoom-in", t("toolbar.tip.magnifier"));
    tool("fill", "paint-bucket", t("toolbar.tool.fill"));
    // Cover tape: strips over the page that a tap shows through.
    tool("tape", "bandage", t("toolbar.tool.coverTape"));
    if (cb.onOnlyStylusMode) {
      const toggle = (): void => this.toggleOnlyStylusMode();
      const stylus = this.barButton(tools, ICON_STYLUS_ONLY, t("toolbar.stylusOff"), toggle);
      item("stylus", stylus, toggle);
      this.fold(FOLD_RANK.stylus, stylus, ICON_STYLUS_ONLY, t("toolbar.tool.stylusOnly"), toggle);
      this.setOnlyStylusMode(this.onlyStylusOn);
    }
    if (cb.onRuler) {
      item("ruler", this.addRulerButton(tools), () => {
        this.closePopover();
        this.callbacks.onRuler?.();
      });
    }
    const action = (
      id: BarItemId,
      rank: number,
      icon: string,
      label: string,
      handler: ((anchor: HTMLElement) => void) | undefined,
    ): HTMLButtonElement => item(id, this.foldButton(tools, rank, icon, label, handler), handler);
    action("image", FOLD_RANK.image, "image", t("toolbar.insertImage"), cb.onInsertImage);
    this.insertPdfButton = action(
      "pdf",
      FOLD_RANK.pdf,
      "file-text",
      t("toolbar.insertPdf"),
      cb.onInsertPdf,
    );
    if (cb.onStickers)
      action("sticker", FOLD_RANK.sticker, "sticker", t("toolbar.tool.stickers"), cb.onStickers);
    if (cb.onStickyColor) {
      this.stickyButton = action(
        "sticky",
        FOLD_RANK.sticky,
        "sticky-note",
        t("toolbar.tool.stickyNotes"),
        (anchor) => this.tapSticky(anchor),
      );
    }
    // The note's recordings live in the page sidebar's Files tab, as in
    // GoodNotes; the mic only starts and stops one.
    this.recordButton = action(
      "record",
      FOLD_RANK.record,
      "mic",
      t("toolbar.tool.recordAudio"),
      cb.onRecord,
    );
    // Goodnotes' accessories: what the bar does not show, and the way to
    // choose what it shows. Pinned to the bar, and it never folds, as ⋯
    // never does.
    const accessories = this.barButton(tools, "toolbox", t("toolbar.moreTools"), (button) =>
      this.toggleAccessories(button),
    );
    accessories.addClass("has-caret", "goodobsidian-accessories-button");
    iconOrText(accessories.createSpan({ cls: "goodobsidian-tool-caret" }), "chevron-down", "");
    accessories.setAttribute("aria-haspopup", "menu");
    this.accessoriesButton = item("accessories", accessories, undefined);

    // The document's own actions: full screen (tablets), add a page,
    // GoodNotes' share button (export as PDF), its ⋯ sheet for the page
    // being read (bookmark, duplicate, go to page, clear, delete), then the
    // note's own settings.
    if (cb.onFullScreen) {
      this.fullScreenButton = item(
        "fullscreen",
        this.foldButton(
          doc,
          FOLD_RANK.fullScreen,
          "maximize-2",
          t("toolbar.fullScreen"),
          cb.onFullScreen,
        ),
        cb.onFullScreen,
        false,
      );
    }
    this.addPageButton = item(
      "addPage",
      this.foldButton(doc, FOLD_RANK.addPage, "plus", t("toolbar.addPage"), cb.onAddPage),
      cb.onAddPage,
      false,
    );
    item(
      "share",
      this.foldButton(doc, FOLD_RANK.share, "share", t("toolbar.export"), cb.onShare),
      cb.onShare,
    );
    if (cb.onLearnHandwriting) this.buildLearnButton(doc, cb.onLearnHandwriting);
    this.moreButton = item(
      "more",
      this.barButton(doc, "more-horizontal", t("common.more"), cb.onMore),
      undefined,
      false,
    );
    if (this.options.fingerDrawing === true) this.setFingerDrawing(true);
    this.settingsButton = item(
      "settings",
      this.foldButton(
        doc,
        FOLD_RANK.settings,
        "settings",
        t("toolbar.notebookSettings"),
        cb.onSettings,
      ),
      cb.onSettings,
      false,
    );
    this.setLayout(this.options.layout ?? defaultLayout(), false);
    this.watchCrowding();
  }

  /**
   * The tools are centred on the bar unless that would put them over the
   * groups either side; then `is-crowded` lets them follow the left groups.
   * Measured from the groups themselves, so it follows the pane (a Split
   * View, the sidebar) rather than the window.
   */
  private watchCrowding(): void {
    const check = (): void => {
      const tools = this.toolsGroup;
      if (!tools) return;
      // Along the bar: across it for a bar along an edge, down it for an upright one.
      const along = this.barAxis();
      const bar = along(this.barEl.getBoundingClientRect());
      if (bar.length === 0) return;
      const half = along(tools.getBoundingClientRect()).length / 2;
      let leftEdge = bar.start;
      let rightEdge = bar.end;
      for (const group of Array.from(this.barEl.children)) {
        if (group === tools || !group.instanceOf(HTMLElement)) continue;
        const box = along(group.getBoundingClientRect());
        if (box.length === 0) continue;
        // Where each side's groups sit while the tools are centred.
        if (group.hasClass("goodobsidian-bar-doc")) rightEdge = Math.min(rightEdge, box.start);
        else leftEdge = Math.max(leftEdge, box.end);
      }
      const centre = bar.start + bar.length / 2;
      const crowded = centre - half < leftEdge + BAR_GAP || centre + half > rightEdge - BAR_GAP;
      this.barEl.toggleClass("is-crowded", crowded);
    };
    // Measure with the tools centred: crowding moves the right-hand group.
    this.measureCrowding = (): void => {
      this.barEl.removeClass("is-crowded");
      check();
    };
    const measure = (): void => {
      this.fitBar(this.indicatorTool);
      this.syncScrollCues();
      // The buttons moved with the bar: the indicator follows, without a slide.
      this.placeIndicator(this.indicatorTool, null);
      this.placeUpdateTip();
    };
    // What the bar's groups leave is the room a docked pill has inside it.
    const measureAll = (): void => {
      measure();
      if (this.pillRowOn) this.placePill();
    };
    this.measureBar = measureAll;
    if (typeof ResizeObserver === "function") {
      this.disposers.push(watchSize(this.barEl, measureAll));
    }
    measure();
  }

  /**
   * Keep the bar's invariant (`FOLD_RANK`): show every button, then fold the
   * least important into ⋯ until the groups fit inside the bar. `active` is
   * the tool in hand, which stays. Measured from the groups themselves, like
   * the crowding, so it follows the pane rather than the window.
   */
  private fitBar(active: ActiveTool | null): void {
    const bar = this.barEl;
    const along = this.barAxis();
    const box = along(bar.getBoundingClientRect());
    if (box.length === 0) return;
    for (const item of this.foldable) item.button.removeClass("is-overflowed");
    const upright = isBarUpright(this.barDock);
    // Upright, nothing folds (a tool added to the bar must show): the
    // buttons shrink to fit, and past their smallest the bar scrolls.
    bar.style.removeProperty("--gob-bar-button");
    this.measureCrowding();
    if (upright) {
      this.fitUprightBar();
      this.moreButton?.removeClass("has-folded");
      this.moreButton?.removeClass("has-mark");
      this.moreButton?.removeAttribute("data-folded-count");
      return;
    }
    const style = getComputedStyle(bar);
    const left = box.start + parseFloat(upright ? style.paddingTop : style.paddingLeft);
    const right = box.end - parseFloat(upright ? style.paddingBottom : style.paddingRight);
    const overflows = (): boolean =>
      Array.from(bar.children).some((group) => {
        if (!group.instanceOf(HTMLElement)) return false;
        const at = along(group.getBoundingClientRect());
        return at.length > 0 && (at.end > right + 0.5 || at.start < left - 0.5);
      });
    for (const item of this.foldOrder()) {
      if (!overflows()) break;
      if (item.tool !== undefined && item.tool === active) continue;
      // Hidden for another reason (a practice file, a single page, taken off
      // the bar in "Customize toolbar"): nothing to fold.
      if (item.button.style.display === "none" || item.button.hasClass("is-unlisted")) continue;
      item.button.addClass("is-overflowed");
      this.measureCrowding();
    }
    // The rows in the bar keep the room they were placed with (`dockWant`).
    if (bar.hasClass("has-pill-inside")) {
      this.foldForDock(this.dockWant);
      // Folding moved the tools: the pill starts where they end now.
      this.alignPillInBar();
    }
    this.settleFolds();
  }

  /**
   * The order the bar's buttons fold into ⋯, first to fold first. The bar's
   * own order chooses it, so Customize toolbar does (Joost, 2026-11-13): what
   * sits among the tools but is no tool (insert image, PDF…), then each side
   * from its outer end in, the end's first, then the start's. Tools fold
   * last, the least used first (`FOLD_RANK`).
   */
  private foldOrder(): FoldableItem[] {
    const byButton = new Map<Element, FoldableItem>(
      this.foldable.map((item) => [item.button, item]),
    );
    const inZone = (zone: HTMLElement | undefined): FoldableItem[] =>
      Array.from(zone?.children ?? []).flatMap((el) => {
        const item = byButton.get(el);
        return item ? [item] : [];
      });
    const byRank = (a: FoldableItem, b: FoldableItem): number => a.rank - b.rank;
    const { start, middle, end } = this.zoneEls;
    const notTool = (item: FoldableItem): boolean => item.tool === undefined;
    const order = [
      ...inZone(middle).filter(notTool).sort(byRank),
      ...inZone(end).filter(notTool).reverse(),
      ...inZone(start).filter(notTool),
    ];
    const placed = new Set(order);
    return [...order, ...this.foldable.filter((item) => !placed.has(item)).sort(byRank)];
  }

  /**
   * The folds are made: ⋯ counts them. In Customize toolbar nothing hides,
   * so every button can be moved: what would fold is marked (`will-fold`).
   */
  private settleFolds(): void {
    if (this.editor) {
      for (const item of this.foldable) {
        const folded = item.button.hasClass("is-overflowed");
        item.button.removeClass("is-overflowed");
        item.button.toggleClass("will-fold", folded);
      }
    }
    this.markFolded();
  }

  /** The ⋯ button shows that it holds folded buttons, and any that want attention. */
  private markFolded(): void {
    const count = this.foldedItems().length;
    this.moreButton?.toggleClass("has-folded", count > 0);
    // How many folded into it, on the bar without opening it (Joost, 2026-11-13).
    const badge = foldedBadge(count);
    if (badge === null) this.moreButton?.removeAttribute("data-folded-count");
    else this.moreButton?.setAttribute("data-folded-count", badge);
    this.moreButton?.toggleClass(
      "has-mark",
      this.foldedItems().some((item) => item.marked),
    );
  }

  /**
   * Mark which ends of a scrolling upright bar have more beyond them
   * (`can-scroll-up`, `can-scroll-down`): styles.css fades those ends and
   * shows a thin scroll thumb, so a hidden button is known to be there.
   */
  private syncScrollCues(): void {
    const bar = this.barEl;
    const scrolls = isBarUpright(this.barDock) && bar.scrollHeight > bar.clientHeight + 1;
    bar.toggleClass("can-scroll-up", scrolls && bar.scrollTop > 1);
    bar.toggleClass(
      "can-scroll-down",
      scrolls && bar.scrollTop + bar.clientHeight < bar.scrollHeight - 1,
    );
  }

  /**
   * An upright bar taller than its room: its buttons shrink in proportion
   * (`uprightButtonSize`), down to their smallest; what still does not fit
   * scrolls (styles.css, `.is-upright`).
   */
  private fitUprightBar(): void {
    const bar = this.barEl;
    const room = bar.clientHeight;
    const need = bar.scrollHeight;
    if (need <= room + 0.5) return;
    const buttons = Array.from(
      bar.querySelectorAll<HTMLElement>("button.goodobsidian-tool"),
    ).filter((button) => button.offsetHeight > 0).length;
    const size = uprightButtonSize(room, need, need - buttons * UPRIGHT_BUTTON_MAX);
    bar.setCssProps({ "--gob-bar-button": `${size}px` });
    this.measureCrowding();
  }

  /**
   * "Update available" in a small bubble under the gear (or ⋯, where the
   * gear has folded), until it is closed: a tap on it runs `open`, its ✕
   * runs `dismiss`, and either takes it away. The dot stays. False when the
   * bar is not laid out yet, so the host can try again.
   */
  showUpdateTip(open: () => void, dismiss: () => void): boolean {
    const anchor = this.updateAnchor();
    if (!anchor || anchor.getBoundingClientRect().width === 0) return false;
    this.hideUpdateTip();
    // On the body: the bar clips what leaves it (overflow: hidden).
    const tip = anchor.ownerDocument.body.createDiv({ cls: "goodobsidian-update-tip" });
    const text = tip.createSpan({
      cls: "goodobsidian-update-tip-text",
      text: t("toolbar.update.available"),
    });
    text.setAttribute("role", "button");
    text.setAttribute("aria-label", t("toolbar.update.availableTip"));
    text.addEventListener("click", () => {
      this.hideUpdateTip();
      open();
    });
    const close = tip.createSpan({ cls: "goodobsidian-update-tip-close" });
    setIcon(close, "x");
    close.setAttribute("role", "button");
    close.setAttribute("aria-label", t("common.dismiss"));
    close.addEventListener("click", () => {
      this.hideUpdateTip();
      dismiss();
    });
    this.updateTip = tip;
    this.placeUpdateTip();
    return true;
  }

  /** Where "Update available" points: the gear, or ⋯ when the gear has folded into it. */
  private updateAnchor(): HTMLButtonElement | null {
    const gear = this.settingsButton;
    return gear && !gear.hasClass("is-overflowed") ? gear : this.moreButton;
  }

  /**
   * Put "Update available" under its button, its point (22 px in from its
   * right) under the button's middle, on screen; hidden while the bar is
   * (another tab in front). The bar's ResizeObserver calls this.
   */
  private placeUpdateTip(): void {
    const tip = this.updateTip;
    if (!tip) return;
    const at = this.updateAnchor()?.getBoundingClientRect();
    const shown = at !== undefined && at.width > 0;
    tip.toggleClass("is-hidden", !shown);
    if (!shown) return;
    const width = tip.offsetWidth;
    const height = tip.offsetHeight;
    const win = tip.ownerDocument.defaultView ?? window;
    const room = win.innerWidth;
    const side = barMenuSide(this.barDock);
    for (const s of ["up", "right", "left"] as const) tip.toggleClass(`points-${s}`, s === side);
    let left = Math.min(Math.max(8, at.left + at.width / 2 + 22 - width), room - width - 8);
    let top = at.bottom + 6;
    // From a bar at another edge it opens toward the page, as the menus do.
    if (side === "up") top = at.top - 6 - height;
    else if (side !== "down") {
      left = side === "right" ? at.right + 6 : at.left - 6 - width;
      top = Math.min(
        Math.max(8, at.top + at.height / 2 - height / 2),
        win.innerHeight - height - 8,
      );
    }
    tip.setCssStyles({ top: `${Math.round(top)}px`, left: `${Math.round(left)}px` });
  }

  /** Take "Update available" away, if it shows. */
  hideUpdateTip(): void {
    this.updateTip?.remove();
    this.updateTip = null;
  }

  /**
   * A dot on the gear while a newer FineNotes is out (`version`), or none
   * (null). Folded into ⋯, the gear's row and ⋯ carry it instead.
   */
  setUpdateMark(version: string | null): void {
    const gear = this.settingsButton;
    if (!gear) return;
    gear.toggleClass("has-mark", version !== null);
    gear.setAttr(
      "aria-label",
      version === null
        ? t("toolbar.notebookSettings")
        : t("toolbar.notebookSettingsUpdate", { version }),
    );
    this.moreButton?.toggleClass(
      "has-mark",
      this.foldedItems().some((item) => item.marked),
    );
  }

  /**
   * Show whether the notebook is full screen: the button then offers the
   * way back, in the bar and in ⋯ alike.
   */
  setFullScreen(on: boolean): void {
    const button = this.fullScreenButton;
    if (!button) return;
    const icon = on ? "minimize-2" : "maximize-2";
    const label = on ? t("toolbar.leaveFullScreen") : t("toolbar.fullScreen");
    iconOrText(button, icon, label);
    button.setAttr("aria-label", label);
    const item = this.foldable.find((entry) => entry.button === button);
    if (item) {
      item.icon = icon;
      item.label = label;
    }
  }

  /** The bar's buttons folded into ⋯ just now, in the bar's order. */
  foldedItems(): FoldedBarItem[] {
    return this.foldable
      .filter((item) => item.button.hasClass("is-overflowed"))
      .sort((a, b) =>
        a.button.compareDocumentPosition(b.button) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
      )
      .map(({ icon, label, run, button }) => ({
        icon,
        label,
        run,
        marked: button.hasClass("has-mark"),
      }));
  }

  /** Let `button` fold into ⋯ (`fitBar`). A disabled one (no handler) never shows there. */
  private fold(
    rank: number,
    button: HTMLElement,
    icon: string,
    label: string,
    handler: ((anchor: HTMLButtonElement) => void) | undefined,
    tool?: ActiveTool,
  ): void {
    if (!handler) return;
    // A row in ⋯ is anchored on ⋯, since the button itself is hidden.
    const run = (anchor: HTMLElement): void => {
      const at = anchor.instanceOf(HTMLButtonElement) ? anchor : this.moreButton;
      if (at) handler(at);
    };
    // "Undo (Cmd/Ctrl+Z)" reads as "Undo" in a menu row.
    const name = label.replace(/ \(.*\)$/, "");
    this.foldable.push({ rank, button, icon, label: name, run, tool });
  }

  /** A tier-1 button that may fold into ⋯ when the bar runs short. */
  private foldButton(
    parent: HTMLElement,
    rank: number,
    icon: string,
    label: string,
    handler: ((button: HTMLButtonElement) => void) | undefined,
  ): HTMLButtonElement {
    const button = this.barButton(parent, icon, label, handler);
    this.fold(rank, button, icon, label, handler);
    return button;
  }

  /**
   * A tier-1 button. Passing `undefined` for the handler renders it disabled —
   * the feature exists in the design but not yet in the model.
   */
  /** A dot on Home: an update's news is waiting there. */
  setHomeDot(on: boolean): void {
    this.homeButton?.toggleClass("goodobsidian-has-news", on);
  }

  /** The bar items that carry an update's dot now. */
  private newsItems = new Set<string>();
  private onNewsUsed: ((id: string) => void) | null = null;

  /**
   * A dot on each button an update changed something behind (`items`, bar
   * item ids); `onUsed` runs the first time one is tapped, and its dot goes.
   */
  setNewsItems(items: readonly string[], onUsed: (id: string) => void): void {
    this.onNewsUsed = onUsed;
    this.newsItems = new Set(items);
    for (const [id, button] of this.barItems) {
      if (id !== "home") button.toggleClass("goodobsidian-has-news", this.newsItems.has(id));
    }
    if (this.newsWatched) return;
    this.newsWatched = true;
    // One listener for the whole bar, before the buttons' own.
    this.barEl.addEventListener(
      "click",
      (event) => {
        const target = event.target as Element | null;
        const id = target?.closest("[data-item]")?.getAttribute("data-item");
        if (!id || !this.newsItems.has(id)) return;
        this.newsItems.delete(id);
        this.barItems.get(id as BarItemId)?.removeClass("goodobsidian-has-news");
        this.onNewsUsed?.(id);
      },
      true,
    );
  }
  private newsWatched = false;

  private barButton(
    parent: HTMLElement,
    icon: string,
    label: string,
    handler: ((button: HTMLButtonElement) => void) | undefined,
  ): HTMLButtonElement {
    const button = parent.createEl("button", { cls: "goodobsidian-tool" });
    iconOrText(button, icon, label);
    button.setAttr("aria-label", label);
    if (!handler) {
      button.disabled = true;
      button.setAttribute("title", t("toolbar.notAvailableYet", { name: label }));
      return button;
    }
    button.addEventListener("click", () => {
      if (!button.disabled) handler(button);
    });
    return button;
  }

  private addToolButton(
    parent: HTMLElement,
    tool: ActiveTool,
    icon: string,
    label: string,
  ): HTMLButtonElement {
    const button = this.barButton(parent, icon, label, () => this.tapTool(tool, button));
    const rank =
      tool === "select"
        ? FOLD_RANK.select
        : tool === "text"
          ? FOLD_RANK.text
          : tool === "shape"
            ? FOLD_RANK.shape
            : tool === "pan"
              ? FOLD_RANK.pan
              : tool === "zoom"
                ? FOLD_RANK.zoom
                : tool === "tape"
                  ? FOLD_RANK.tape
                  : undefined;
    if (rank !== undefined) {
      this.fold(rank, button, icon, label, (anchor) => this.tapTool(tool, anchor), tool);
    }
    if (tool === "select") {
      button.addClass("has-caret");
      iconOrText(button.createSpan({ cls: "goodobsidian-tool-caret" }), "chevron-down", "");
      button.setAttribute("aria-haspopup", "dialog");
    }
    if (tool === "pen") {
      button.addClass("goodobsidian-tool-pen");
      this.penToolButton = button;
      this.drawPenPreview();
    }
    this.toolButtons.set(tool, button);
    return button;
  }

  /** The Stylus only button was tapped, on the bar or in a menu. */
  private toggleOnlyStylusMode(): void {
    this.callbacks.onOnlyStylusMode?.(!this.onlyStylusOn);
  }

  /** The page in view's cover tapes changed or the page did: the tape's pill shows them again. */
  refreshTape(): void {
    if (this.state.tool === "tape") this.buildOptions();
  }

  /** Show whether Stylus-only mode is on, on the bar and in the folded row that reads it. */
  setOnlyStylusMode(on: boolean): void {
    this.onlyStylusOn = on;
    const stylus = this.barItems.get("stylus");
    if (!stylus) return;
    stylus.toggleClass("is-on", on);
    stylus.setAttribute("aria-pressed", String(on));
    stylus.setAttribute("aria-label", on ? t("toolbar.stylusOn") : t("toolbar.stylusOff"));
    this.syncAccessoriesMark();
  }

  /**
   * Light ⋯ while fingers draw (`input/finger-draw.ts`), as the accessories
   * button lights for a mode its menu lists: ⋯ is where it is switched off.
   */
  setFingerDrawing(on: boolean): void {
    const more = this.moreButton;
    if (!more) return;
    more.toggleClass("is-on", on);
    more.setAttribute("aria-label", on ? t("toolbar.moreFinger") : t("common.more"));
  }

  /** Light the accessories button while one of the items its menu lists is on. */
  private syncAccessoriesMark(): void {
    const listed = menuItems(this.layout);
    const hiddenOn = (["ruler", "sticky", "stylus"] as const).some((id) => {
      const button = this.barItems.get(id);
      return button !== undefined && button.hasClass("is-on") && listed.includes(id);
    });
    this.accessoriesButton?.toggleClass("is-on", hiddenOn);
  }

  /**
   * Put every button where `layout` says (`toolbar-layout.ts`): each zone's
   * buttons in order, the rest off the bar (`is-unlisted`), waiting in More
   * tools unless shown nowhere. Buttons this bar does not have (no handler
   * for them here) are skipped. `relayout` refits the bar and moves the
   * indicator, as a live change needs.
   */
  setLayout(raw: ToolbarLayout, relayout = true): void {
    // A saved pen deleted meanwhile has no button.
    const pens = this.callbacks.savedPens?.() ?? [];
    const ids = new Set(pens.flatMap((pen) => (pen.id === undefined ? [] : [pen.id])));
    const layout = normalizeLayout(raw, ids);
    this.layoutNow = layout;
    this.syncPenSlots(layout);
    const onBar = new Set(layoutBarItems(layout));
    for (const zone of ZONES) {
      const el = this.zoneEls[zone];
      if (!el) return;
      for (const id of layout[zone]) {
        const button = this.barItems.get(id);
        if (button) el.appendChild(button);
      }
    }
    for (const [id, button] of this.barItems) button.toggleClass("is-unlisted", !onBar.has(id));
    // A practice sheet's button sits just before ⋯, wherever ⋯ is.
    const learn = this.learnButton;
    const more = this.moreButton;
    if (learn && more?.parentElement) more.parentElement.insertBefore(learn, more);
    this.syncAccessoriesMark();
    if (this.popoverKind === "accessories") this.popoverRender?.();
    this.editor?.refresh();
    if (!relayout) return;
    const tool = this.state.tool === "highlighter" ? "pen" : this.state.tool;
    // The pen's row loses or gains the types now on the bar.
    if (tool === "pen") this.buildOptions();
    this.syncActive();
    this.fitBar(tool);
    this.placeIndicator(tool, null);
  }

  // --- Pens as buttons of their own (FineNotes#211) -------------------------

  /**
   * Make a button for every pen `layout` puts on the bar, and drop those it
   * no longer does. Each sits in the tools' group until `setLayout` puts it
   * in its zone.
   */
  private syncPenSlots(layout: ToolbarLayout): void {
    const slots = new Set(penSlotsOf(layout));
    for (const [slot, button] of this.penSlotButtons) {
      if (slots.has(slot)) continue;
      button.remove();
      this.penSlotButtons.delete(slot);
      this.barItems.delete(slot);
    }
    const parent = this.toolsGroup;
    if (!parent) return;
    for (const slot of slots) {
      if (this.penSlotButtons.has(slot)) continue;
      const button = parent.createEl("button", {
        cls: "goodobsidian-tool goodobsidian-tool-pen goodobsidian-pen-slot",
      });
      button.setAttribute("data-item", slot);
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", () => {
        if (!button.disabled) this.tapPenSlot(slot, button);
      });
      this.penSlotButtons.set(slot, button);
      this.barItems.set(slot, button);
    }
    this.drawPenSlots();
  }

  /** The layout shown; the default before the bar is built (a bare toolbar in tests). */
  private laid(): ToolbarLayout {
    const shown: ToolbarLayout | undefined = this.layoutNow;
    return shown ?? defaultLayout();
  }

  /** The pen buttons, none before the bar is built. */
  private slotButtons(): Map<PenSlotId, HTMLButtonElement> {
    const buttons: Map<PenSlotId, HTMLButtonElement> | undefined = this.penSlotButtons;
    return buttons ?? new Map<PenSlotId, HTMLButtonElement>();
  }

  /** The saved pen a `saved:` slot names, or `null` (deleted meanwhile). */
  private savedPenOf(id: string): SavedPen | null {
    return savedPenById(this.callbacks.savedPens?.() ?? [], id);
  }

  /** The pen a slot's button writes with: a type in its own ink, or the saved pen. */
  private slotPen(slot: PenSlotId): SavedPen | null {
    const type = slotPenType(slot);
    if (type) {
      if (type === this.activePenType().id) return penOfState(this.state);
      const ink = penInkFor(this.state.penInks ?? {}, type, this.inkInHand());
      return { type, color: ink.color, size: ink.size ?? this.state.size };
    }
    const id = slotSavedId(slot);
    return id === null ? null : this.savedPenOf(id);
  }

  /** What a pen as a button is called: its type's name, or the saved pen's. */
  private slotLabel(slot: PenSlotId): string {
    const type = slotPenType(slot);
    if (type) return PEN_TYPES.find((spec) => spec.id === type)?.label ?? type;
    const pen = this.slotPen(slot);
    return pen ? t("toolbar.penSlot.saved", { name: savedPenLabel(pen) }) : "";
  }

  /** A bar item's name: its own, or a pen's. */
  private itemLabel(id: BarItemId): string {
    return isPenSlot(id) ? this.slotLabel(id) : BAR_ITEM_LABELS[id];
  }

  /** Draw every pen button: its type's glyph in its ink, and its width under it. */
  private drawPenSlots(): void {
    for (const [slot, button] of this.slotButtons()) {
      const pen = this.slotPen(slot);
      if (!pen) continue;
      this.drawPenFace(button, pen, slotSavedId(slot) !== null, this.slotLabel(slot));
    }
  }

  /**
   * Draw a pen button: the pen's glyph in its ink with its width under it,
   * as the pen's button shows the pen in hand; a saved pen with a small star,
   * the mark it is saved under.
   */
  private drawPenFace(button: HTMLElement, pen: SavedPen, saved: boolean, label: string): void {
    const spec = PEN_TYPES.find((type) => type.id === pen.type) ?? PEN_TYPES[0];
    const color = this.shown(pen.color);
    const width = strokeWidthFor({
      ...this.state,
      tool: spec.tool,
      penType: spec.id,
      size: pen.size,
    });
    const dark = activeDocument.body.hasClass("theme-dark");
    const key = `${spec.id}|${color}|${width}|${dark}|${saved}|${label}`;
    if (button.getAttribute("data-face") === key) return;
    button.setAttribute("data-face", key);
    button.empty();
    const glyph = penGlyph(spec.id, color);
    glyph.classList.add("goodobsidian-tool-pen-glyph");
    button.append(glyph);
    const mark = button.createSpan({ cls: "goodobsidian-tool-pen-width" });
    mark.toggleClass("is-highlighter", spec.tool === "highlighter");
    mark.toggleClass("is-rimmed", inkNeedsRim(color, dark));
    mark.setCssProps({
      "--gob-ink": color,
      "--gob-ink-width": `${widthMarkThickness(width)}px`,
    });
    // A little pin at its top right: a pen pinned to the bar, not the pen
    // menu's own button (FineNotes#211).
    iconOrText(button.createSpan({ cls: "goodobsidian-pen-slot-star" }), "pin", "");
    // In Customize toolbar the editor names it by what a press does.
    if (!button.hasAttribute("data-label")) button.setAttribute("aria-label", label);
    else button.setAttribute("data-label", label);
  }

  /** The pen button the pen in hand belongs to: a slot, or the pen's own (`null`). */
  private penSlotInHand(): PenSlotId | null {
    if (this.state.tool !== "pen" && this.state.tool !== "highlighter") return null;
    if (this.handButton === "main") return null;
    if (this.handButton && penSlotsOf(this.laid()).includes(this.handButton)) {
      return this.handButton;
    }
    return penSlotInHand(this.laid(), penOfState(this.state), (id) => this.savedPenOf(id));
  }

  /** The pen type the pen's button stands for now (`toolbar-layout.ts`). */
  private penButtonSpec(): PenTypeSpec {
    const order = penRowTypes(this.state).map((spec) => spec.id);
    const id = penButtonType(
      order,
      penTypesOnBar(this.laid()),
      this.activePenType().id,
      this.penButtonRecent,
    );
    return PEN_TYPES.find((spec) => spec.id === id) ?? this.activePenType();
  }

  /**
   * A pen as a button was tapped: put it in hand (a type with its own ink,
   * a saved pen as its key 1-8 does); tapped in hand, it shows or tucks
   * away its pill, as every tool's button does.
   */
  private tapPenSlot(slot: PenSlotId, button: HTMLElement): void {
    const was = this.penSlotInHand();
    this.handButton = slot;
    if (was === slot) {
      this.closePopover();
      this.tuckedByStroke = false;
      this.optionsVisible = !this.optionsVisible;
      this.showOptions(this.optionsVisible);
      this.syncActive();
      return;
    }
    const type = slotPenType(slot);
    const pen = type ? null : this.slotPen(slot);
    const spec = PEN_TYPES.find((p) => p.id === (type ?? pen?.type));
    if (!spec || (this.practice && spec.tool === "highlighter")) return;
    this.closePopover();
    if (pen) {
      this.applySavedPen(pen);
      return;
    }
    if (this.state.tool !== spec.tool) {
      this.drawingTool = drawingToolOf(this.drawingTool, spec.tool);
      this.leaveToolFor(spec.tool);
    }
    this.choosePenType(spec);
    button.focus({ preventScroll: true });
  }

  /** Put a pen on the bar as a button of its own, or take it off, and keep the layout. */
  private togglePenSlot(slot: PenSlotId): void {
    const save = this.callbacks.onLayout;
    if (!save) return;
    const on = placeOf(this.laid(), slot) === "off";
    this.setLayout(setPenSlot(this.laid(), slot, on));
    save(this.laid());
  }

  /**
   * Customize toolbar's New pen: the pen in hand as a saved pen (saved now if
   * it is not yet), for a button of its own. `null` when it cannot be: saved
   * pens are full, or that pen is on the bar already.
   */
  private newPenSlot(save: boolean): PenSlotId | null {
    const current = penOfState(this.state);
    const pens = this.callbacks.savedPens?.() ?? [];
    let pen = pens.find((saved) => samePen(saved, current)) ?? null;
    if (!pen) {
      if (pens.length >= MAX_SAVED_PENS || !this.callbacks.onSavePen) return null;
      if (!save) return "saved:new";
      this.callbacks.onSavePen(current);
      pen = (this.callbacks.savedPens?.() ?? []).find((saved) => samePen(saved, current)) ?? null;
    }
    if (!pen?.id) return null;
    const slot = savedPenSlot(pen.id);
    return placeOf(this.laid(), slot) === "off" ? slot : null;
  }

  /** The saved pens changed (added, edited, reordered, deleted): the bar's pens follow. */
  refreshSavedPens(): void {
    this.setLayout(this.laid());
  }

  /** The buttons its More tools menu lists now, in catalogue order. */
  get menuListed(): readonly CoreItemId[] {
    return menuItems(this.layout).filter((id) => this.itemRuns.has(id));
  }

  /** Where every button is now. */
  get layout(): ToolbarLayout {
    return this.layoutNow;
  }

  /**
   * Open Customize toolbar (`toolbar-edit.ts`): the bar's own edit mode.
   * Without a host to keep the layout (`onLayout`) there is none.
   */
  startCustomize(): void {
    const save = this.callbacks.onLayout;
    if (!save || this.editor) return;
    this.closePopover();
    // The tool's pill is put away while the bar is edited, so it takes none
    // of the room the edit mode uses.
    this.optionsBeforeCustomize = this.optionsVisible;
    if (this.optionsVisible) {
      this.optionsVisible = false;
      this.showOptions(false);
    }
    this.editor = new ToolbarEditor({
      bar: this.barEl,
      host: this.host,
      zones: () => this.zoneEls,
      button: (id) => this.barItems.get(id),
      has: (id) => this.barItems.has(id),
      label: (id) => this.itemLabel(id),
      newPen: this.callbacks.onSavePen
        ? {
            // A tap opens the pen dialog, which makes any pen while there is room.
            can: () =>
              this.newPenSlot(false) !== null ||
              (this.callbacks.onNewPen !== undefined &&
                (this.callbacks.savedPens?.() ?? []).length < MAX_SAVED_PENS),
            make: () => this.newPenSlot(true),
            draw: (chip) => {
              const current = penOfState(this.state);
              chip.append(penGlyph(current.type, this.shown(current.color)));
            },
            remove: (id) => {
              const savedId = slotSavedId(id);
              if (savedId !== null) this.deleteSavedPen(savedId);
              else if (isPenSlot(id) && placeOf(this.laid(), id) !== "off") this.togglePenSlot(id);
            },
            customize: this.callbacks.onNewPen
              ? (place) =>
                  this.callbacks.onNewPen?.(penOfState(this.state), (pen) => {
                    if (!pen.id) return;
                    const slot = savedPenSlot(pen.id);
                    if (placeOf(this.laid(), slot) === "off") place(slot);
                  })
              : undefined,
          }
        : undefined,
      layout: () => this.layoutNow,
      apply: (layout) => {
        this.setLayout(layout);
        save(layout);
      },
      foldsNow: () => this.markFolds(),
      barDock: () => this.barDock,
      pillRow: () => this.pillRowOn,
      setBarDock: this.callbacks.onSetBarDock,
      setPillRow: this.callbacks.onSetPillRow,
      look: this.callbacks.lookNow,
      setLook: this.callbacks.onSetLook,
      done: () => {
        this.editor = null;
        if (this.optionsBeforeCustomize) {
          this.optionsBeforeCustomize = false;
          this.optionsVisible = true;
          this.showOptions(true);
        }
        this.measureBar();
      },
    });
    this.markFolds();
  }

  /** Close Customize toolbar, if it is open. */
  stopCustomize(): void {
    this.editor?.finish();
  }

  /** Whether Customize toolbar is open. */
  get customizing(): boolean {
    return this.editor !== null;
  }

  /**
   * In Customize toolbar every button shows, so it can be moved: what would
   * fold into ⋯ at this width is marked (`will-fold`) instead of hidden.
   */
  private markFolds(): void {
    this.fitBar(this.indicatorTool);
    if (this.barEl.hasClass("has-pill-inside")) this.placePill();
  }

  /**
   * Goodnotes' accessories menu, hanging from the last button of the tools:
   * every item taken off the bar and not hidden, which a tap runs as its
   * button would, then "Customize toolbar".
   */
  private toggleAccessories(anchor: HTMLElement): void {
    if (this.popoverKind === "accessories") {
      this.closePopover();
      return;
    }
    const body = this.openPopover("accessories", anchor);
    this.popover?.addClass("has-arrow", "goodobsidian-accessories-popover");
    this.popover?.setAttribute("role", "menu");
    this.popoverRender = () => {
      body.empty();
      const hidden = this.menuListed;
      for (const id of hidden) {
        const button = this.barItems.get(id);
        const run = this.itemRuns.get(id);
        if (!button || !run) continue;
        const row = body.createEl("button", {
          cls: "goodobsidian-wide goodobsidian-pen-row goodobsidian-accessory-row",
          attr: { role: "menuitem" },
        });
        iconOrText(row.createSpan({ cls: "goodobsidian-accessory-icon" }), BAR_ITEM_ICONS[id], "");
        row.createSpan({ text: BAR_ITEM_LABELS[id] });
        row.toggleClass("is-active", button.hasClass("is-on") || button.hasClass("is-active"));
        row.addEventListener("click", () => {
          // Sticky notes swap this menu for their colours, hanging from the same place.
          if (id !== "sticky") this.closePopover();
          run(anchor);
        });
      }
      if (this.callbacks.onLayout) {
        if (hidden.length > 0) body.createDiv({ cls: "goodobsidian-popover-divider" });
        const customize = body.createEl("button", {
          cls: "goodobsidian-wide goodobsidian-pen-row goodobsidian-accessory-row",
          attr: { role: "menuitem" },
        });
        iconOrText(customize.createSpan({ cls: "goodobsidian-accessory-icon" }), "settings-2", "");
        customize.createSpan({ text: t("toolbar.customize.title") });
        customize.addEventListener("click", () => {
          this.closePopover();
          this.startCustomize();
        });
      }
      this.keepPopoverInside(anchor);
    };
    this.popoverRender();
  }

  /**
   * The sticky notes button: its ten colours, or, while a note waits to be
   * placed, a tap that stops it waiting.
   */
  private tapSticky(anchor: HTMLElement): void {
    if (this.stickyButton?.hasClass("is-on") || this.popoverKind === "sticky") {
      // Closing the colours while a note waits stops it waiting (`closePopover`).
      this.closePopover();
      return;
    }
    const body = this.openPopover("sticky", anchor);
    this.popover?.addClass("has-arrow", "goodobsidian-sticky-popover");
    body.createDiv({ cls: "goodobsidian-popover-label", text: t("toolbar.sticky.label") });
    const grid = body.createDiv({
      cls: "goodobsidian-sticky-colors",
      attr: { role: "group", "aria-label": t("toolbar.sticky.colour") },
    });
    const swatches = new Map<string, HTMLElement>();
    for (const { color, label } of STICKY_COLORS) {
      const swatch = grid.createEl("button", {
        cls: "goodobsidian-sticky-swatch",
        attr: { "aria-label": label },
      });
      // backgroundColor, never the shorthand: it would reset the stylesheet's clip (ledger).
      swatch.setCssStyles({ backgroundColor: color });
      swatches.set(color, swatch);
      swatch.addEventListener("click", () => {
        lastStickyColor = color;
        markChosen(swatches, color, true);
        this.callbacks.onStickyColor?.(color);
      });
    }
    markChosen(swatches, lastStickyColor, true);
    // As in Goodnotes, the colours stay out until the note is on the page:
    // the ringed one waits for a tap there, and a tap on another swaps it.
    this.callbacks.onStickyColor?.(lastStickyColor);
    this.keepPopoverInside(anchor);
  }

  /** Show the sticky notes button on while a note waits for a tap on the page. */
  setStickyArmed(armed: boolean): void {
    const button = this.stickyButton;
    if (!button) return;
    const was = button.hasClass("is-on");
    button.toggleClass("is-on", armed);
    button.setAttribute("aria-pressed", String(armed));
    button.setAttr(
      "aria-label",
      armed ? t("toolbar.sticky.placeTip") : t("toolbar.tool.stickyNotes"),
    );
    this.syncAccessoriesMark();
    // The note is on the page (or stopped waiting): its colours go.
    if (was && !armed && this.popoverKind === "sticky") this.closePopover();
  }

  /**
   * The ruler: not a tool but something laid on the page while any tool is
   * in hand, so a toggle beside the tools, drawn on while the ruler is out
   * (`setRulerOut`). A tap brings it out or puts it away; while it is out a
   * chevron shows, and a tap there opens its kinds and its snapping, as the
   * lasso's chevron does.
   */
  private addRulerButton(parent: HTMLElement): HTMLButtonElement {
    const button = parent.createEl("button", {
      cls: "goodobsidian-tool goodobsidian-ruler-button has-caret",
    });
    iconOrText(button, "ruler", t("toolbar.tool.ruler"));
    button.setAttr("aria-label", t("toolbar.tool.ruler"));
    button.setAttribute("aria-pressed", "false");
    iconOrText(button.createSpan({ cls: "goodobsidian-tool-caret" }), "chevron-down", "");
    button.addEventListener("click", (event) => {
      const box = button.getBoundingClientRect();
      const onCaret = button.hasClass("is-on") && event.detail !== 0;
      if (onCaret && event.clientX >= box.right - RULER_CARET_STRIP) {
        this.toggleRulerPopover(button);
        return;
      }
      this.closePopover();
      this.callbacks.onRuler?.();
    });
    this.fold(FOLD_RANK.ruler, button, "ruler", t("toolbar.tool.ruler"), () =>
      this.callbacks.onRuler?.(),
    );
    this.rulerButton = button;
    return button;
  }

  /** Show the ruler button on (accent) while the ruler is out, with its chevron. */
  setRulerOut(out: boolean): void {
    const button = this.rulerButton;
    if (!button || button.hasClass("is-on") === out) return;
    button.toggleClass("is-on", out);
    button.setAttribute("aria-pressed", String(out));
    this.syncAccessoriesMark();
    if (!out && this.popoverKind === "ruler") this.closePopover();
    // It is wider while it shows its chevron: the bar may fold differently,
    // and the centred tools move under the tool indicator, which follows.
    const tool = this.state.tool === "highlighter" ? "pen" : this.state.tool;
    this.fitBar(tool);
    this.placeIndicator(tool, null);
  }

  private toggleRulerPopover(anchor: HTMLElement): void {
    if (this.popoverKind === "ruler") {
      this.closePopover();
      return;
    }
    const body = this.openPopover("ruler", anchor);
    this.popover?.addClass("has-arrow");
    body.addClass("goodobsidian-ruler-popover");
    this.popoverRender = () => {
      body.empty();
      this.renderRulerOptions(body);
    };
    this.popoverRender();
    this.keepPopoverInside(anchor);
  }

  /** The three kinds as tiles drawn as each ruler, then the angle snapping. */
  private renderRulerOptions(body: HTMLElement): void {
    const kind = this.state.rulerKind ?? "straight";
    const snap = this.state.rulerSnap ?? DEFAULT_RULER_SNAP;
    const kinds = body.createDiv({ cls: "goodobsidian-ruler-kinds" });
    for (const option of RULER_KINDS) {
      const tile = kinds.createEl("button", {
        cls: "goodobsidian-ruler-kind clickable-icon",
        attr: { "aria-label": RULER_KIND_LABELS[option], "aria-pressed": String(option === kind) },
      });
      tile.append(rulerGlyph(option, 28));
      tile.toggleClass("is-active", option === kind);
      tile.addEventListener("click", () => {
        this.state.rulerKind = option;
        this.saveRuler();
        this.popoverRender?.();
      });
    }
    const steps = body.createDiv({
      cls: "goodobsidian-ruler-snap",
      attr: { role: "group", "aria-label": t("toolbar.ruler.angleSnapping") },
    });
    iconOrText(steps.createSpan({ cls: "goodobsidian-ruler-snap-icon" }), "magnet", "");
    for (const step of RULER_SNAP_STEPS) {
      const button = steps.createEl("button", {
        cls: "goodobsidian-ruler-snap-step clickable-icon",
        text: step === 0 ? t("common.off") : `${step}°`,
        attr: {
          "aria-label":
            step === 0 ? t("toolbar.ruler.noSnap") : t("toolbar.ruler.snapTo", { angle: step }),
          "aria-pressed": String(step === snap),
        },
      });
      button.toggleClass("is-active", step === snap);
      button.addEventListener("click", () => {
        this.state.rulerSnap = step;
        this.saveRuler();
        this.popoverRender?.();
      });
    }
  }

  private saveRuler(): void {
    this.callbacks.onRulerChange?.(
      this.state.rulerKind ?? "straight",
      this.state.rulerSnap ?? DEFAULT_RULER_SNAP,
    );
  }

  /**
   * The pen button as its own preview, as Apple's pen picker draws each
   * tool: the pen type in hand, its nib in the ink colour, over a mark as
   * thick as the width it writes (`widthMarkThickness`). Redrawn only when
   * one of those changes, since `syncActive` runs on every pick.
   */
  private drawPenPreview(): void {
    const button = this.penToolButton;
    if (!button) return;
    // With types on the bar as buttons of their own, the pen's button shows
    // the type it stands for, in that type's own ink (FineNotes#211).
    const penInHand = this.state.tool === "pen" || this.state.tool === "highlighter";
    const pinnedInHand = penInHand && this.penSlotInHand() !== null;
    if (penInHand && !pinnedInHand) this.mainPen = penOfState(this.state);
    const own = pinnedInHand ? this.mainPen : null;
    const spec = own
      ? (PEN_TYPES.find((type) => type.id === own.type) ?? this.penButtonSpec())
      : this.penButtonSpec();
    if (penInHand && !pinnedInHand && this.penButtonRecent[0] !== spec.id) {
      this.penButtonRecent = rememberPenType(this.penButtonRecent, spec.id);
    }
    const inHand = !own && spec.id === this.activePenType().id;
    const ink = own
      ? null
      : inHand
        ? null
        : penInkFor(this.state.penInks ?? {}, spec.id, this.inkInHand());
    const color = this.shown(own ? own.color : ink ? ink.color : this.state.color);
    const width = strokeWidthFor({
      ...this.state,
      tool: spec.tool,
      penType: spec.id,
      size: own ? own.size : (ink?.size ?? this.state.size),
    });
    const dark = activeDocument.body.hasClass("theme-dark");
    const key = `${spec.id}|${color}|${width}|${dark}`;
    if (key === this.penPreviewKey) return;
    this.penPreviewKey = key;
    button.empty();
    const glyph = penGlyph(spec.id, color);
    glyph.classList.add("goodobsidian-tool-pen-glyph");
    button.append(glyph);
    const mark = button.createSpan({ cls: "goodobsidian-tool-pen-width" });
    mark.toggleClass("is-highlighter", spec.tool === "highlighter");
    mark.toggleClass("is-rimmed", inkNeedsRim(color, dark));
    mark.setCssProps({
      "--gob-ink": color,
      "--gob-ink-width": `${widthMarkThickness(width)}px`,
    });
    button.setAttribute("aria-label", t("toolbar.tip.penType", { name: spec.label }));
  }

  /**
   * The lasso button shows the lasso type in use, drawn as its card in the
   * lasso popover draws it, so the two always match.
   */
  private drawLassoIcon(): void {
    const button = this.toolButtons.get("select");
    if (!button) return;
    const mode = lassoModeFor(this.state);
    if (mode === this.lassoIconMode) return;
    this.lassoIconMode = mode;
    // Whatever `iconOrText` put there: Lucide's lasso, or its text fallback.
    for (const child of Array.from(button.childNodes)) {
      if (!(child.instanceOf(HTMLElement) && child.hasClass("goodobsidian-tool-caret")))
        child.remove();
    }
    button.removeClass("goodobsidian-icon-fallback");
    const glyph = lassoGlyph(mode, 22);
    // Less margin than the card's, so it is as large as the icons beside it.
    glyph.setAttribute("viewBox", "2.5 2.5 27 27");
    button.prepend(glyph);
    button.setAttribute("aria-label", LASSO_SELECT_TIPS[mode]);
  }

  /**
   * The eraser button shows the eraser mode in use, drawn as the mode button
   * and the mode menu draw it: Lucide's eraser for Standard, the eraser
   * trailing a stroke for Whole stroke, lines with an eraser for By line.
   */
  private drawEraserIcon(): void {
    const button = this.toolButtons.get("eraser");
    if (!button) return;
    const mode = eraserModeFor(this.state);
    if (mode === this.eraserIconMode) return;
    this.eraserIconMode = mode;
    button.empty();
    button.removeClass("goodobsidian-icon-fallback");
    eraserModeIcon(button, mode, t("toolbar.tool.eraser"));
    button.setAttribute(
      "aria-label",
      mode === "standard"
        ? t("toolbar.tip.eraser")
        : mode === "stroke"
          ? t("toolbar.eraser.tip.stroke")
          : t("toolbar.eraser.tip.ruled"),
    );
  }

  /**
   * A tap on a tool: Notability's "first tap selects, second tap opens
   * options". Another tool becomes the active one and nothing opens
   * (`leaveToolFor`). The active tool's own button instead shows or tucks
   * away its options (it stays selected), so the Pencil can write on without
   * a large control over the page; the lasso's button opens its popover
   * instead (GoodNotes: the chevron on it says so).
   */
  private tapTool(tool: ActiveTool, button: HTMLElement): void {
    // The pen button stands for every pen type, the highlighter included:
    // it picks the type in hand. Picking plain "pen" with the highlighter as
    // the type wrote opaque pen ink in the highlighter's colour.
    if (tool === "pen") {
      // While the pen in hand belongs to a type's own button, the pen's
      // button puts its own type back in hand (FineNotes#211).
      const slot = this.penSlotInHand();
      const own = this.penButtonSpec();
      if (slot !== null && slotPenType(slot) !== null && own.id !== this.activePenType().id) {
        if (this.practice && own.tool === "highlighter") return;
        this.closePopover();
        this.choosePenType(own);
        return;
      }
      tool = this.activePenType().tool;
    }
    const current = this.state.tool;
    this.drawingTool = drawingToolOf(this.drawingTool, current);
    tool = selectedTool(
      current,
      tool,
      this.callbacks.returnToPenOnReselect?.() === true,
      this.drawingTool,
    );
    // Docked, the lasso's types and filters are its row: a second tap shows
    // or hides the row, as for every tool (docking design B, 2026-11-13).
    if (tool === "select" && current === "select" && !this.dockedAcross()) {
      this.toggleLassoPopover(button);
      return;
    }
    // The Magnifier in Zoom box mode opens the box in one tap, the tool in
    // hand kept; with the box open a tap picks the Magnifier (its pill), and
    // the next closes the box (`magnifierTap`).
    if (tool === "zoom") {
      const action = magnifierTap(
        current,
        this.state.zoomBox === true,
        this.state.zoomBoxOpen === true,
      );
      if (action !== "select") {
        this.callbacks.onZoomBoxOpen?.(action === "open");
        this.state.zoomBoxOpen = action === "open" && this.state.zoomBoxOpen === true;
        if (current === "zoom") this.buildOptions();
        this.syncActive();
        return;
      }
    }
    // The pen's own button after a pinned pen: its own pen again, with its
    // type row and menu, not the pinned pen's (FineNotes#211).
    if (tool === "pen") {
      const pinned =
        ((current === "pen" || current === "highlighter") && this.penSlotInHand() !== null) ||
        (this.handButton !== null && this.handButton !== "main");
      this.handButton = "main";
      if (pinned && this.mainPen) {
        this.closePopover();
        this.tuckedByStroke = false;
        this.optionsVisible = true;
        this.applySavedPen(this.mainPen);
        return;
      }
    }
    this.closePopover();
    this.tuckedByStroke = false;
    if (tool === current) {
      this.optionsVisible = !this.optionsVisible;
      this.showOptions(this.optionsVisible);
    } else {
      this.leaveToolFor(tool);
      this.state.tool = tool;
      this.callbacks.onToolChange(tool);
      this.buildOptions();
    }
    this.syncActive();
  }

  /**
   * Remember whether the tool being left had its options showing. A switch
   * never opens the next tool's options (`optionsAfterSwitch`): a pill that
   * was showing stays, with the next tool's controls, unless that tool was
   * last left tucked away. The pen's start tucked away every time it is
   * picked ({@link STARTS_TUCKED}). Highlighter is a pen type, so the two
   * share one memory.
   */
  /**
   * Whether `tool`'s pill starts tucked away when picked ({@link STARTS_TUCKED}):
   * not while it docks as a row, where it covers no writing and tucking it
   * would only move the page at every switch to the pen.
   */
  private startsTucked(tool: ActiveTool): boolean {
    return (
      STARTS_TUCKED.has(optionsKey(tool)) &&
      pillRowEdge(this.pillRowOn, this.pillDock, this.barDock) === null
    );
  }

  private leaveToolFor(next: ActiveTool): void {
    if (optionsKey(next) === optionsKey(this.optionsTool)) return;
    this.tuckedByStroke = false;
    if (this.optionsVisible) this.tuckedTools.delete(optionsKey(this.optionsTool));
    else this.tuckedTools.add(optionsKey(this.optionsTool));
    const remembered = !this.tuckedTools.has(optionsKey(next)) && !this.startsTucked(next);
    this.optionsVisible = optionsAfterSwitch(
      this.optionsVisible,
      remembered,
      this.callbacks.returnToPenOnReselect?.() === true,
    );
    this.optionsTool = next;
  }

  // --- Tier 2 ---------------------------------------------------------------

  /** Rebuild the options pill for whatever tool is active. */
  private buildOptions(): void {
    // Where the pill is now, mid-glide or not, so it can glide from there.
    const before = this.pillBox();
    this.stopPillMorph();
    // The colour row is rebuilt too: keep it scrolled where it was.
    const colorRow = this.optionsEl.querySelector<HTMLElement>(".goodobsidian-pen-colors");
    if (colorRow) this.colorRowScroll = colorRow.scrollLeft;
    this.optionsEl.empty();
    this.optionsEl.removeClass("has-one-width");
    this.colorSwatches.clear();
    this.widthButtons.clear();
    this.widthButtonSizes.clear();
    this.penTypeButtons.clear();
    this.eraserSizeButtons.clear();
    this.shapeButtons.clear();

    // A text box being edited shows the text options whatever the tool is:
    // styling the box under the caret is what the pill is for right then.
    const text = this.state.tool === "text" || this.textTarget !== null;
    this.optionsEl.toggleClass("is-text", text);
    if (text) this.buildTextOptions();
    else {
      // A text popover must not outlive the pill it hangs from, nor a tool's
      // own popover the tool (a keyboard shortcut can switch it underneath).
      if (this.popoverKind?.startsWith("text-")) this.closePopover();
      if (this.popoverKind === "lasso" && this.state.tool !== "select") this.closePopover();
      if (this.popoverKind?.startsWith("eraser-") && this.state.tool !== "eraser") {
        this.closePopover();
      }
      // The laser's picker lives in its pill; a picker opened from its palette closes with it.
      if (this.popoverKind === "laser-color" && this.state.tool !== "laser") this.closePopover();
      if (this.popoverKind === "tape-height" && this.state.tool !== "tape") this.closePopover();
      switch (this.state.tool) {
        case "pen":
        case "highlighter":
          this.buildPenOptions();
          break;
        case "eraser":
          this.buildEraserOptions();
          break;
        case "select":
          this.buildSelectOptions();
          break;
        case "shape":
          this.buildShapeOptions();
          break;
        case "laser":
          this.buildLaserOptions();
          break;
        case "pan":
          this.buildPanOptions();
          break;
        case "zoom":
          this.buildZoomOptions();
          break;
        case "fill":
          this.buildFillOptions();
          break;
        case "tape":
          this.buildTapeOptions();
          break;
      }
    }
    // A held or edited box always shows its pill, floating beside it.
    const anchored = this.textAnchor !== null && this.textTarget !== null;
    this.optionsEl.toggleClass("is-collapsed", !this.optionsVisible && !anchored);
    this.applyPosition();
    // Highlighter is a pen type: the same controls, so nothing to fade.
    const kind = text ? "text" : this.state.tool === "highlighter" ? "pen" : this.state.tool;
    this.morphPill(before, PILL_MORPH_MS, kind !== this.pillKind);
    this.pillKind = kind;
  }

  private buildPenOptions(): void {
    const active = this.activePenType();
    // Upright at a side, the pill folds as GoodNotes' does: the widths are
    // one button, and the colours three and a ⌄. Docked in a column of its
    // own (`roomy`) it has the page's whole height: all the widths, and every
    // colour in a grid.
    const upright = isUpright(this.pillDock);
    const roomy = upright && this.dockedAtSide();
    const folded = upright && !roomy;
    // Docked along the top or bottom the widths are one button too, and
    // their room goes to the colours (discussion #200).
    const edge = pillRowEdge(this.pillRowOn, this.pillDock, this.barDock);
    // A pen with a button of its own has no pen-type row (FineNotes#211):
    // docked, its widths take that room, as they did before docking.
    const oneWidth =
      penWidthsShown({ upright, roomy, edge }) === "one" && (upright || this.penRowShown());
    this.optionsEl.toggleClass("has-one-width", oneWidth && !folded);
    this.buildPenRow(upright);
    // The rest of the old pen menu: the laser pointer, the pen's settings and
    // the pen gestures. A practice sheet has none of them.
    if (!folded && !this.practice) {
      this.chevron(t("toolbar.penOptions"), (button) => this.openPenMenu(button));
    }

    this.optionsEl.createDiv({ cls: "goodobsidian-sep" });

    if (oneWidth) {
      const width = this.state.size;
      const button = widthButton(
        this.optionsEl,
        this.widthMm(width),
        active.id,
        this.widthMarks([width]).get(width),
        () => this.toggleWidthList(button),
      );
      button.setAttribute("aria-label", t("toolbar.width.moreWidths", { mm: this.widthMm(width) }));
      this.widthButtons.set(FOLDED_WIDTH, button);
      this.widthButtonSizes.set(FOLDED_WIDTH, width);
    } else {
      // The pen type's own presets, each drawn as the stroke it lays down.
      const presets = this.widthPresets();
      const marks = this.widthMarks(presets);
      presets.forEach((width, slot) => {
        const button = widthButton(
          this.optionsEl,
          this.widthMm(width),
          active.id,
          marks.get(width),
          () => {
            this.pickWidthPreset(slot);
            this.syncActive();
          },
        );
        this.widthButtons.set(slot, button);
        this.widthButtonSizes.set(slot, width);
      });
      this.chevron(t("toolbar.width.more"), (button) => this.toggleWidthList(button));
    }

    this.optionsEl.createDiv({ cls: "goodobsidian-sep" });

    const colors = this.quickColors();
    if (roomy) {
      // Every colour in one column, four showing and the rest a swipe away,
      // and the "+" after the last.
      const grid = this.optionsEl.createDiv({ cls: "goodobsidian-pen-colors is-column" });
      grid.dataset.ignoreSwipe = "true";
      for (const color of colors) this.penSwatch(grid, color, colors);
      if (colors.length < PEN_ROW_MAX) this.addColorButton(grid);
      this.fitColorColumn(grid);
    } else if (folded) {
      // The chosen colour and its neighbours; the ⌄ holds the whole row.
      const chosen = colors.findIndex((c) => sameColor(c, this.state.color));
      const first = colorWindow(colors.length, chosen, UPRIGHT_COLORS);
      for (const color of colors.slice(first, first + UPRIGHT_COLORS)) {
        this.penSwatch(this.optionsEl, color, colors);
      }
      this.chevron(t("toolbar.color.all"), (button) => this.togglePenColorList(button));
    } else {
      // The colour row, as GoodNotes': as many as the pill has room for, up
      // to ten (styles.css), the rest a swipe away, and the "+" after the
      // last one, so a new colour joins the end and stays.
      const row = this.optionsEl.createDiv({ cls: "goodobsidian-pen-colors" });
      // A sideways swipe here scrolls the row, never Obsidian's sidebars.
      row.dataset.ignoreSwipe = "true";
      for (const color of colors) this.penSwatch(row, color, colors);
      if (colors.length < PEN_ROW_MAX) this.addColorButton(row);
      this.fitColorRow(row);
    }

    // Auto-shape: a stroke that is plainly a shape snaps to it on lift.
    if (this.practice) return;
    this.optionsEl.createDiv({ cls: "goodobsidian-sep" });
    const auto = this.optionsEl.createEl("button", {
      cls: "goodobsidian-shape goodobsidian-pen-autoshape clickable-icon",
    });
    auto.append(shapeGlyph("auto"));
    const on = this.state.snapMode === "auto";
    auto.setAttribute("aria-label", on ? t("toolbar.autoShape.on") : t("toolbar.autoShape.off"));
    auto.setAttribute(
      "title",
      on ? t("toolbar.autoShape.onTitle") : t("toolbar.autoShape.offTitle"),
    );
    auto.setAttribute("aria-pressed", String(on));
    auto.toggleClass("is-active", on);
    auto.addEventListener("click", () => {
      this.toggleAutoShape();
      this.buildOptions();
    });

    // The saved pens, as Write and GoodNotes keep favourites (FineNotes#24),
    // at the far end: used less than the pen, widths and colours. (A
    // practice file has returned above.)
    if (this.callbacks.savedPens) {
      this.optionsEl.createDiv({ cls: "goodobsidian-sep" });
      const saved = this.optionsEl.createEl("button", {
        cls: "goodobsidian-saved-pens clickable-icon",
      });
      iconOrText(saved, "star", t("toolbar.savedPens.title"));
      saved.setAttribute("aria-label", t("toolbar.savedPens.tip"));
      saved.setAttribute("title", t("toolbar.savedPens.tip"));
      saved.setAttribute("aria-haspopup", "dialog");
      saved.addEventListener("click", () => this.toggleSavedPens(saved));
    }
  }

  /**
   * The pen types as a row, as Goodnotes has them: each drawn in its own ink,
   * the one in hand marked. A tap picks one; a tap on the one in hand opens
   * its menu (as a tap on the colour in use opens its picker). Hold one and
   * drag it to put it elsewhere (`pen-type-drag.ts`); none can be added or
   * taken away. All show while the pill has the room (styles.css,
   * FineNotes#164); on a narrow pane the rest scroll, across the pill or,
   * upright, down it.
   */
  /**
   * The pen types the row offers for the pen in hand: none for a pen with a
   * button of its own, a type's or a saved pen's (FineNotes#211).
   */
  private penRowOffered(): ReturnType<typeof penRowOffers> {
    if (this.penSlotInHand()?.startsWith("saved:")) return [];
    const order = penRowTypes(this.state).map((spec) => spec.id);
    return penRowOffers(
      shownPenTypes(order, this.practice, "highlighter"),
      penTypesOnBar(this.laid()),
      this.activePenType().id,
    );
  }

  /** The pen-type row has types to offer for the pen in hand (`buildPenRow`). */
  private penRowShown(): boolean {
    return this.penRowOffered().length > 0;
  }

  private buildPenRow(upright: boolean): void {
    const row = this.optionsEl.createDiv({ cls: "goodobsidian-pen-types" });
    // A swipe here scrolls the row, never Obsidian's sidebars.
    row.dataset.ignoreSwipe = "true";
    // Types on the bar as buttons of their own leave the row; the row goes
    // when the pen in hand has a button of its own, or one type is left (FineNotes#211).
    const order = penRowTypes(this.state).map((spec) => spec.id);
    const shown = this.penRowOffered();
    if (shown.length === 0) {
      row.remove();
      return;
    }
    for (const id of shown) {
      const spec = PEN_TYPES.find((type) => type.id === id);
      if (!spec) continue;
      const pen = row.createEl("button", { cls: "goodobsidian-pentype clickable-icon" });
      pen.append(penGlyph(spec.id, this.shown(this.inkColorOf(spec), spec.tool === "highlighter")));
      pen.setAttribute("aria-label", spec.label);
      pen.setAttribute("title", spec.label);
      pen.addEventListener("click", () => {
        if (spec.id !== this.activePenType().id) {
          this.closePopover();
          this.choosePenType(spec);
        } else if (!this.practice) this.openPenMenu(pen);
      });
      bindPenTypeDrag(pen, {
        row: () => row,
        upright: () => isUpright(this.pillDock),
        onMove: (gap) => {
          // Gaps count the pens shown; a practice sheet hides the highlighter.
          const before = shown[gap];
          const at = before === undefined ? order.length : order.indexOf(before);
          const next = movePenType(order, spec.id, at);
          if (next.join() === order.join()) return;
          this.state.penTypeOrder = next;
          this.callbacks.onPenTypeOrder?.(next);
          this.penRowScroll = upright ? row.scrollTop : row.scrollLeft;
          this.buildOptions();
          this.syncActive();
        },
      });
      this.penTypeButtons.set(spec.id, pen);
    }
    this.fitPenRow(row, upright);
  }

  /**
   * Keep the rebuilt pen row where it was scrolled, with the pen in hand in
   * view, and fade the ends that hide more, as the colour row does.
   */
  private fitPenRow(row: HTMLElement, upright: boolean): void {
    // No arrows here: the row keeps every pen in view (styles.css).
    const fade = (): void => {
      const ends = upright
        ? hiddenEnds(row.scrollTop, row.clientHeight, row.scrollHeight)
        : hiddenEnds(row.scrollLeft, row.clientWidth, row.scrollWidth);
      row.toggleClass("has-more-start", ends.start);
      row.toggleClass("has-more-end", ends.end);
    };
    const chosen = this.penTypeButtons.get(this.activePenType().id);
    if (upright) {
      row.scrollTop = this.penRowScroll;
      if (chosen) {
        row.scrollTop = scrollToShow(
          row.scrollTop,
          row.clientHeight,
          chosen.offsetTop - row.offsetTop,
          chosen.offsetHeight,
          COLOR_ROW_FADE_PX,
        );
      }
    } else {
      row.scrollLeft = this.penRowScroll;
      const showChosen = (): void => {
        if (!chosen) return;
        row.scrollLeft = scrollToShow(
          row.scrollLeft,
          row.clientWidth,
          chosen.offsetLeft - row.offsetLeft,
          chosen.offsetWidth,
          COLOR_ROW_FADE_PX,
        );
      };
      showChosen();
      // In the bar the row gives way to the colours once the pill is placed,
      // after it was built: keep the pen in hand in view then too.
      this.penRowWatch?.disconnect();
      this.penRowWatch = null;
      if (typeof ResizeObserver !== "undefined") {
        let width = row.clientWidth;
        this.penRowWatch = sizeObserver(row, () => {
          if (row.clientWidth === width) return;
          width = row.clientWidth;
          showChosen();
          fade();
        });
        this.penRowWatch.observe(row);
      }
    }
    this.penRowScroll = upright ? row.scrollTop : row.scrollLeft;
    fade();
    // The pill may still settle round it: place the arrows again once it has.
    winOf(this.barEl).requestAnimationFrame(fade);
    row.addEventListener("scroll", () => {
      this.penRowScroll = upright ? row.scrollTop : row.scrollLeft;
      fade();
    });
    if (!upright) wheelScrollsSideways(row);
  }

  /**
   * An arrow on each end of `row` that hides more, for a mouse, which cannot
   * swipe it (shown on a computer only, styles.css): a click slides the row
   * on by what shows. They sit beside the row rather than in it, so its
   * faded ends do not fade them too. Returns what shows and places them for
   * the ends that hide more.
   */
  private rowArrows(
    row: HTMLElement,
    upright: boolean,
  ): (ends: { start: boolean; end: boolean }) => void {
    const make = (dir: -1 | 1): HTMLButtonElement => {
      const button = createEl("button", {
        cls: `goodobsidian-row-arrow clickable-icon is-hidden ${dir < 0 ? "is-start" : "is-end"}`,
      });
      const icon = upright
        ? dir < 0
          ? "chevron-up"
          : "chevron-down"
        : dir < 0
          ? "chevron-left"
          : "chevron-right";
      iconOrText(button, icon, dir < 0 ? "‹" : "›");
      button.setAttribute(
        "aria-label",
        dir < 0 ? t("toolbar.row.showEarlier") : t("toolbar.row.showMore"),
      );
      button.addEventListener("click", () => {
        if (upright) {
          const top = pageScroll(
            row.scrollTop,
            row.clientHeight,
            row.scrollHeight,
            dir,
            COLOR_ROW_FADE_PX,
          );
          row.scrollTo({ top, behavior: "smooth" });
        } else {
          const left = pageScroll(
            row.scrollLeft,
            row.clientWidth,
            row.scrollWidth,
            dir,
            COLOR_ROW_FADE_PX,
          );
          row.scrollTo({ left, behavior: "smooth" });
        }
      });
      return button;
    };
    const start = make(-1);
    const end = make(1);
    row.after(start, end);
    return (ends) => {
      start.toggleClass("is-hidden", !ends.start);
      end.toggleClass("is-hidden", !ends.end);
      // The row's own box in the pill, which both share as offset parent.
      const x = row.offsetLeft;
      const y = row.offsetTop;
      const w = row.offsetWidth;
      const h = row.offsetHeight;
      if (upright) {
        start.setCssStyles({ left: `${x + w / 2}px`, top: `${y}px` });
        end.setCssStyles({ left: `${x + w / 2}px`, top: `${y + h}px` });
      } else {
        start.setCssStyles({ left: `${x}px`, top: `${y + h / 2}px` });
        end.setCssStyles({ left: `${x + w}px`, top: `${y + h / 2}px` });
      }
    };
  }

  /**
   * Write with `color`, and keep it in the row: a colour not there yet takes
   * the slot of `replace` (the swatch its picker opened from) or the first
   * picked slot, and stays until another pick needs the room.
   */
  private setPenColor(color: string, replace?: string): void {
    const reserved = this.reservedColors();
    const picked = pickPenColor(this.quickColors(), reserved.length, color, replace);
    const before = this.state.penColors;
    if (!before || picked.join() !== before.join()) {
      this.state.penColors = picked;
      this.callbacks.onPenColors?.(picked);
    }
    this.state.color = color;
    this.callbacks.onColorChange(color);
    this.keepPenInk();
    this.buildOptions();
    this.syncActive();
  }

  /**
   * One of the pen's colours. A tap on the colour already chosen opens the
   * picker on it (the ▾ in the swatch says so), as GoodNotes does, and what
   * it picks takes that swatch's place; any other colour is just picked. A
   * colour the user added can be deleted there, or dragged off the pill.
   */
  private penSwatch(parent: HTMLElement, color: string, colors: readonly string[]): void {
    const removable = removablePenColor(colors, this.reservedColors().length, color);
    const swatch = this.swatchButton(parent, color, () => {
      if (sameColor(color, this.state.color)) {
        this.toggleColorPopover(
          "pen-color",
          swatch,
          this.state.color,
          (picked) => this.setPenColor(picked, color),
          removable ? () => this.removePenColor(color) : undefined,
        );
      } else this.setPenColor(color);
    });
    if (removable) {
      bindSwatchDrag(swatch, {
        bar: () => this.optionsEl,
        onRemove: () => this.removePenColor(color),
      });
    }
    this.colorSwatches.set(color, swatch);
  }

  /** A dashed ring holding a "+", as GoodNotes' "add colour" (styles.css): the new colour joins the end. */
  private addColorButton(parent: HTMLElement): void {
    const more = parent.createEl("button", { cls: "goodobsidian-color-more clickable-icon" });
    iconOrText(more, "plus", "+");
    more.setAttribute("aria-label", t("toolbar.color.add"));
    more.setAttribute("title", t("toolbar.color.add"));
    more.addEventListener("click", () =>
      this.toggleColorPopover("pen-color", more, this.state.color, (color) => {
        this.revealNewColor = true;
        this.setPenColor(color);
      }),
    );
  }

  /**
   * The upright pill's ⌄: every colour of the row, and the "+", hanging
   * beside the pill. A colour picked there is picked and the list closes.
   */
  private togglePenColorList(anchor: HTMLElement): void {
    if (this.popoverKind === "pen-colors") {
      this.closePopover();
      return;
    }
    const body = this.openPopover("pen-colors", anchor);
    this.popover?.addClass("has-arrow", "is-pen-colors");
    const grid = body.createDiv({ cls: "goodobsidian-pen-color-grid" });
    const colors = this.quickColors();
    for (const color of colors) {
      const swatch = this.swatchButton(grid, color, () => {
        if (sameColor(color, this.state.color)) {
          const removable = removablePenColor(colors, this.reservedColors().length, color);
          this.toggleColorPopover(
            "pen-color",
            anchor,
            this.state.color,
            (picked) => this.setPenColor(picked, color),
            removable ? () => this.removePenColor(color) : undefined,
          );
        } else {
          this.closePopover();
          this.setPenColor(color);
        }
      });
      swatch.toggleClass("is-active", sameColor(color, this.state.color));
    }
    if (colors.length < PEN_ROW_MAX) {
      const more = grid.createEl("button", { cls: "goodobsidian-color-more clickable-icon" });
      iconOrText(more, "plus", "+");
      more.setAttribute("aria-label", t("toolbar.color.add"));
      more.addEventListener("click", () =>
        this.toggleColorPopover("pen-color", anchor, this.state.color, (color) =>
          this.setPenColor(color),
        ),
      );
    }
    this.keepPopoverInside(anchor);
  }

  /**
   * Take `color` out of the row (its picker's Delete, or dragged off the
   * pill). The pen then writes with the swatch before it, as GoodNotes does.
   */
  private removePenColor(color: string): void {
    const row = this.quickColors();
    const reserved = this.reservedColors().length;
    if (!removablePenColor(row, reserved, color)) return;
    if (this.popoverKind === "pen-color") this.closePopover();
    const picked = removePenColor(row, reserved, color);
    this.state.penColors = picked;
    this.callbacks.onPenColors?.(picked);
    if (sameColor(color, this.state.color)) {
      const next = colorAfterRemoving(row, color);
      if (next) {
        this.state.color = next;
        this.callbacks.onColorChange(next);
      }
    }
    this.keepPenInk();
    this.buildOptions();
    this.syncActive();
  }

  /**
   * The docked side pill's colour column: kept where it was scrolled, with
   * the chosen colour in view, and the ends that hide more faded.
   */
  private fitColorColumn(column: HTMLElement): void {
    const fade = (): void => {
      const ends = hiddenEnds(column.scrollTop, column.clientHeight, column.scrollHeight);
      column.toggleClass("has-more-start", ends.start);
      column.toggleClass("has-more-end", ends.end);
    };
    column.scrollTop = this.colorColumnScroll;
    const chosen = this.colorSwatches.get(
      [...this.colorSwatches.keys()].find((c) => sameColor(c, this.state.color)) ?? "",
    );
    if (chosen) {
      column.scrollTop = scrollToShow(
        column.scrollTop,
        column.clientHeight,
        chosen.offsetTop - column.offsetTop,
        chosen.offsetHeight,
        COLOR_ROW_FADE_PX,
      );
    }
    this.colorColumnScroll = column.scrollTop;
    fade();
    winOf(this.barEl).requestAnimationFrame(fade);
    column.addEventListener("scroll", () => {
      this.colorColumnScroll = column.scrollTop;
      fade();
    });
  }

  /**
   * Scroll the rebuilt colour row back to where it was, or to its end when a
   * colour was just added, keeping the chosen colour in view; and fade the
   * ends that hide more. A wheel scrolls it sideways, for a mouse.
   */
  private fitColorRow(row: HTMLElement): void {
    const arrows = this.rowArrows(row, false);
    const fade = (): void => {
      const ends = hiddenEnds(row.scrollLeft, row.clientWidth, row.scrollWidth);
      row.toggleClass("has-more-start", ends.start);
      row.toggleClass("has-more-end", ends.end);
      arrows(ends);
    };
    row.scrollLeft = this.revealNewColor ? row.scrollWidth : this.colorRowScroll;
    this.revealNewColor = false;
    const chosen = this.colorSwatches.get(
      [...this.colorSwatches.keys()].find((c) => sameColor(c, this.state.color)) ?? "",
    );
    /** Keep the chosen colour in view. Offsets are the pill's (the row is not positioned). */
    const showChosen = (): void => {
      if (chosen) {
        row.scrollLeft = scrollToShow(
          row.scrollLeft,
          row.clientWidth,
          chosen.offsetLeft - row.offsetLeft,
          chosen.offsetWidth,
          COLOR_ROW_FADE_PX,
        );
      }
      this.colorRowScroll = row.scrollLeft;
      fade();
    };
    showChosen();
    winOf(this.barEl).requestAnimationFrame(fade);
    // The row gives way when the pill has too little room, which can settle
    // after it was built (the pill is placed afterwards): look again then.
    this.colorRowWatch?.disconnect();
    this.colorRowWatch = null;
    if (typeof ResizeObserver !== "undefined") {
      let width = row.clientWidth;
      this.colorRowWatch = sizeObserver(row, () => {
        if (row.clientWidth === width) return;
        width = row.clientWidth;
        showChosen();
      });
      this.colorRowWatch.observe(row);
    }
    row.addEventListener("scroll", () => {
      this.colorRowScroll = row.scrollLeft;
      fade();
    });
    wheelScrollsSideways(row);
  }

  /** Remember the ink in hand (colour, row and width) as the active pen type's own. */
  private keepPenInk(): void {
    this.state.penInks = withPenInk(
      this.state.penInks ?? {},
      this.activePenType().id,
      this.inkInHand(),
    );
    this.callbacks.onPenInks?.(this.state.penInks);
  }

  /** The pen in hand's ink, as a pen type keeps it. */
  private inkInHand(): PenInk {
    const { color, penColors, size } = this.state;
    return { color, ...(penColors ? { colors: penColors } : {}), size };
  }

  /**
   * Open the colour picker on `anchor` (or close it if it is the one open).
   * `pick` gets the chosen colour; a custom one is also remembered as recent.
   */
  private toggleColorPopover(
    kind: string,
    anchor: HTMLElement,
    current: string,
    pick: (color: string) => void,
    onDelete?: () => void,
  ): void {
    if (this.popoverKind === kind) {
      this.closePopover();
      return;
    }
    const body = this.openPopover(kind, anchor);
    // Pointing at its swatch, as Notability's picker does.
    this.popover?.addClass("is-color-popover", "has-arrow");
    renderColorPicker(body, {
      // The laser's trail is drawn in its true colour on any page.
      shown: (color) => (kind === "laser-color" ? color : this.shown(color)),
      current,
      extra: this.pickerExtras(current),
      recent: this.state.recentColors ?? [],
      notebook: this.callbacks.notebookColors?.() ?? [],
      onPick: (color) => {
        this.closePopover();
        if (color) pick(color);
      },
      onCustom: (color) => {
        this.closePopover();
        this.rememberColor(color);
        pick(color);
      },
      onEyedropper: this.eyedropper(pick),
      onDelete,
    });
    this.keepPopoverInside(anchor);
  }

  /**
   * What the picker offers after its common colours: the user's own palette
   * colours (from settings), and the colour chosen now if it is not offered
   * anyway — the built-in pen palette would only repeat the common colours.
   */
  private pickerExtras(current: string): string[] {
    const own = this.palette.filter((color) => !(PALETTE as readonly string[]).includes(color));
    return [...own, current];
  }

  /**
   * The colour pickers' eyedropper, where the host can pick from the page:
   * the popover closes so the page shows, and the colour picked there is
   * used as a custom one would be (and remembered as recent).
   */
  private eyedropper(use: (color: string) => void): (() => void) | undefined {
    const pickFromPage = this.callbacks.onPickFromPage;
    if (!pickFromPage) return undefined;
    return () => {
      this.closePopover();
      pickFromPage((color) => {
        if (!color) return;
        this.rememberColor(color);
        use(color);
      });
    };
  }

  /** Put a custom colour at the front of the recent list, and have the host save it. */
  private rememberColor(color: string): void {
    const recent = pushRecentColor(this.state.recentColors ?? [], color);
    this.state.recentColors = recent;
    this.callbacks.onRecentColors?.(recent);
  }

  /** A colour swatch, shared by the pen pill and the text colour popover. */
  private swatchButton(parent: HTMLElement, color: string, onPick: () => void): HTMLButtonElement {
    const swatch = parent.createEl("button", { cls: "goodobsidian-swatch" });
    // The swatch *is* the ink colour, so this one inline style is the value
    // itself rather than chrome; everything else comes from Obsidian's vars.
    // The colour only: the `background` shorthand would reset the stylesheet's
    // `background-clip`, which keeps the disc smaller than its target.
    // On dark pages it is the colour the ink is shown in, as on the page.
    const shown = this.shown(color);
    swatch.setCssStyles({ backgroundColor: shown });
    // The chosen swatch wears a ▾ in whichever of dark or white reads on it.
    swatch.setCssProps({ "--gob-swatch-mark": contrastMark(shown) });
    iconOrText(swatch.createSpan({ cls: "goodobsidian-swatch-mark" }), "chevron-down", "▾");
    swatch.setAttr("aria-label", color);
    swatch.addEventListener("click", onPick);
    return swatch;
  }

  /** A tool pill with nothing to set: an icon and one line. */
  private toolNote(icon: string, text: string): void {
    // Docked in the bar, its room goes to the tool's choices (discussion #200).
    if (this.dockedAcross()) return;
    const note = this.optionsEl.createDiv({ cls: "goodobsidian-tool-note" });
    const mark = note.createSpan({ cls: "goodobsidian-tool-note-icon" });
    iconOrText(mark, icon, "");
    note.createSpan({ text });
  }

  /**
   * The laser's pill: what it is and that nothing it draws stays, then the
   * colour it points with. The colour is one button — a disc of it and a
   * caret — opening the same picker the Shape tool's colour opens; a laser
   * has no stroke and no width, so its colour is all it sets.
   */
  private buildLaserOptions(): void {
    this.toolNote("pointer", t("toolbar.laser.note"));
    if (!this.dockedAcross()) this.optionsEl.createDiv({ cls: "goodobsidian-sep" });
    const color = this.laserColor();
    if (this.dockedAcross()) {
      this.colorRow(
        LASER_COLORS,
        color,
        (picked) => this.setLaserColor(picked),
        (anchor) =>
          this.toggleColorPopover("laser-color", anchor, color, (picked) =>
            this.setLaserColor(picked),
          ),
      );
      return;
    }
    const button = this.optionsEl.createEl("button", {
      cls: "goodobsidian-shape-color clickable-icon goodobsidian-laser-color",
    });
    button.createSpan({ cls: "goodobsidian-text-disc" }).setCssStyles({ background: color });
    caretIn(button);
    button.setAttribute("aria-label", t("toolbar.laser.colourValue", { color }));
    button.setAttribute("title", t("toolbar.laser.colour"));
    button.addEventListener("click", () =>
      this.toggleColorPopover("laser-color", button, color, (picked) => this.setLaserColor(picked)),
    );
  }

  /** The laser's colour, as the settings have it now (never the icon's: the laser's icon stays grey). */
  private laserColor(): string {
    return parseHexColor(this.options?.laserColor?.() ?? "") ?? LASER_COLOR;
  }

  private setLaserColor(color: string): void {
    const hex = parseHexColor(color);
    if (!hex || sameColor(hex, this.laserColor())) return;
    this.callbacks.onLaserColorChange?.(hex);
    this.buildOptions();
    this.syncActive();
  }

  /**
   * Cover tape: straight or freehand, its colours, its three heights and a
   * chevron to any other height, and an eye that shows the tapes on the page in view through, or covers them
   * again (lit while they are shown). A tap on a tape shows or covers that one.
   */
  private buildTapeOptions(): void {
    const color = tapeColorOf(this.state.tapeColor);
    const height = tapeHeightOf(this.state.tapeHeight);
    const heights = tapeHeightsOf(this.state.tapeHeights);
    const mode = tapeModeOf(this.state.tapeMode);
    const set = (nextColor: string, nextHeight: number, nextMode = mode): void => {
      this.state.tapeColor = nextColor;
      this.state.tapeHeight = nextHeight;
      this.state.tapeMode = nextMode;
      this.callbacks.onTapeChange?.(nextColor, nextHeight, nextMode, heights);
      this.buildOptions();
    };
    for (const [each, icon, label] of tapeModes()) {
      const button = this.barButton(this.optionsEl, icon, label, () => {
        if (each !== mode) set(color, height, each);
      });
      button.addClass("goodobsidian-tape-mode");
      button.toggleClass("is-active", each === mode);
      button.setAttribute("aria-pressed", String(each === mode));
    }
    this.optionsEl.createDiv({ cls: "goodobsidian-sep" });
    for (const each of TAPE_COLORS) {
      const swatch = this.swatchButton(this.optionsEl, each, () => set(each, height));
      swatch.toggleClass("is-active", each === color);
    }
    this.optionsEl.createDiv({ cls: "goodobsidian-sep" });
    // Three heights, each kept as the slider left it, as the pens' widths
    // are (FineNotes#211): one is always the tape in hand.
    const inHand = tapePresetIndex(heights, height);
    heights.forEach((each, i) => {
      const button = this.optionsEl.createEl("button", {
        cls: "goodobsidian-width goodobsidian-tape-height clickable-icon",
      });
      button.append(tapeHeightGlyph(each));
      const label = `${tapeHeightLabels()[i] ?? ""} ${formatMm(each)}`.trim();
      button.setAttribute("aria-label", t("toolbar.tape.height", { label }));
      button.setAttribute("title", label);
      button.toggleClass("is-active", i === inHand);
      button.addEventListener("click", () => set(color, each));
    });
    // The height in hand on a slider, anywhere on its range (FineNotes#211).
    this.chevron(t("toolbar.tape.anyHeight"), (button) => this.toggleTapeHeight(button));
    this.optionsEl.createDiv({ cls: "goodobsidian-sep" });
    // Snap to PDF text: a magnet, as the ruler's angle snap, lit as a picked option while on (#164).
    const snap = this.state.tapeSnapText === true;
    const magnet = this.barButton(
      this.optionsEl,
      "magnet",
      t("toolbar.highlighter.snapText"),
      () => {
        this.state.tapeSnapText = !snap;
        this.callbacks.onTapeSnapTextChange?.(!snap);
        this.buildOptions();
      },
    );
    magnet.addClass("goodobsidian-tape-snap");
    magnet.toggleClass("is-active", snap);
    magnet.setAttribute("aria-pressed", String(snap));
    const shownOf = this.callbacks.tapesShown;
    const show = this.callbacks.onShowTapes;
    if (!shownOf || !show) return;
    const shown = shownOf();
    const eye = this.barButton(
      this.optionsEl,
      shown ? "eye" : "eye-off",
      shown ? t("toolbar.tape.cover") : t("toolbar.tape.show"),
      shown === null
        ? undefined
        : () => {
            show(!shown);
            this.buildOptions();
          },
    );
    eye.addClass("goodobsidian-tape-eye");
    eye.toggleClass("is-on", shown === true);
    eye.setAttribute("aria-pressed", String(shown === true));
    if (shown === null) eye.setAttribute("title", t("toolbar.tape.none"));
  }

  /**
   * The tape's height on a slider, as the pens' width popover has one: the
   * height in mm and any height from {@link MIN_TAPE_HEIGHT} to
   * {@link MAX_TAPE_HEIGHT} page px (FineNotes#211). It changes the pill's
   * height in hand, which keeps it, as a pen's width preset does; the others
   * stay as they are.
   */
  private toggleTapeHeight(anchor: HTMLElement): void {
    if (this.popoverKind === "tape-height") {
      this.closePopover();
      return;
    }
    const body = this.openPopover("tape-height", anchor);
    body.addClass("goodobsidian-width-popover", "goodobsidian-tape-height-popover");
    const head = body.createDiv({ cls: "goodobsidian-width-head" });
    head.createDiv({ cls: "goodobsidian-popover-label", text: t("toolbar.tape.heightTitle") });
    const readout = head.createDiv({ cls: "goodobsidian-text-size-readout" });
    const slider = body.createDiv({ cls: "goodobsidian-width-slider" });
    const range = slider.createEl("input", {
      cls: "goodobsidian-width-range",
      type: "range",
      attr: { "aria-label": t("toolbar.tape.heightTitle") },
    });
    dragRange(range);
    range.min = String(MIN_TAPE_HEIGHT);
    range.max = String(MAX_TAPE_HEIGHT);
    range.step = "1";
    // The tape as it will lie on the page now, on the page's own paper, as
    // the pens' and the eraser's sliders show theirs.
    const preview = tapePreview(body, this.callbacks.paintSizePaper);
    const show = (height: number): void => {
      readout.setText(formatMm(height));
      range.value = String(height);
      syncRangeFill(range);
      preview(height, this.previewScales().pen, tapeColorOf(this.state.tapeColor));
    };
    show(tapeHeightOf(this.state.tapeHeight));
    range.addEventListener("input", () => show(tapeHeightOf(Number(range.value))));
    range.addEventListener("change", () => {
      const height = tapeHeightOf(Number(range.value));
      const before = tapeHeightsOf(this.state.tapeHeights);
      const heights = withTapePreset(
        before,
        tapePresetIndex(before, tapeHeightOf(this.state.tapeHeight)),
        height,
      );
      this.state.tapeHeight = height;
      this.state.tapeHeights = heights;
      this.callbacks.onTapeChange?.(
        tapeColorOf(this.state.tapeColor),
        height,
        tapeModeOf(this.state.tapeMode),
        heights,
      );
      show(height);
      // The pill's band for that height is redrawn at its new size.
      this.buildOptions();
    });
    this.keepPopoverInside(anchor);
  }

  /** The hand has nothing to set: its pill says what dragging does with it. */
  private buildPanOptions(): void {
    this.toolNote("hand", t("toolbar.hand.note"));
  }

  /**
   * The Fill tool: its own colour, as the Shape tool has (a disc and a
   * caret opening the colour picker; picking leaves the pen's colour
   * alone), then how far a fill reaches past gaps in a hand-drawn outline,
   * as a ring with no gap, a dashed one and a ring open wide.
   */
  private buildFillOptions(): void {
    const color = this.state.fillColor ?? DEFAULT_FILL_COLOR;
    const setFill = (picked: string): void => {
      this.state.fillColor = picked;
      this.callbacks.onFillColorChange?.(picked);
      this.buildOptions();
    };
    if (this.dockedAcross()) {
      // Docked: the colours as swatches in the bar, as the pen has them.
      const colors = this.palette.filter((c) => c.toLowerCase() !== "#ffffff").slice(0, 8);
      this.colorRow(colors, color, setFill, (anchor) =>
        this.toggleColorPopover("fill-color", anchor, color, setFill),
      );
    } else {
      const colorButton = this.optionsEl.createEl("button", {
        cls: "goodobsidian-shape-color clickable-icon",
      });
      colorButton
        .createSpan({ cls: "goodobsidian-text-disc" })
        .setCssStyles({ background: this.shown(color, false) });
      caretIn(colorButton);
      colorButton.setAttribute("aria-label", t("toolbar.fill.colourValue", { color }));
      colorButton.setAttribute("title", t("toolbar.fill.colour"));
      colorButton.addEventListener("click", () =>
        this.toggleColorPopover("fill-color", colorButton, color, setFill),
      );
    }
    this.optionsEl.createDiv({ cls: "goodobsidian-sep" });
    const gap = readFillGap(this.state.fillGap);
    for (const choice of FILL_GAPS) {
      const button = this.optionsEl.createEl("button", {
        cls: "goodobsidian-fill-gap clickable-icon",
      });
      iconOrText(button, FILL_GAP_ICONS[choice], FILL_GAP_LABELS[choice]);
      button.setAttribute("aria-label", FILL_GAP_LABELS[choice]);
      button.setAttribute("aria-pressed", String(choice === gap));
      button.toggleClass("is-active", choice === gap);
      button.addEventListener("click", () => {
        if (choice === readFillGap(this.state.fillGap)) return;
        this.state.fillGap = choice;
        this.callbacks.onFillGapChange?.(choice);
        this.buildOptions();
        this.syncActive();
      });
    }
  }

  /** The magnifier: page zoom or a Zoom box, then its steps and fit. */
  private buildZoomOptions(): void {
    const cb = this.callbacks;
    const boxMode = this.state.zoomBox === true;
    for (const mode of [
      { box: false, label: t("toolbar.zoom.page"), icon: "file", fallback: "＋" },
      { box: true, label: t("toolbar.zoom.box"), icon: "scan", fallback: "▣" },
    ]) {
      const active = boxMode === mode.box;
      const button = this.optionsEl.createEl("button", {
        cls: "goodobsidian-zoommode",
      });
      button.toggleClass("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
      button.setAttribute("aria-label", mode.label);
      const glyph = button.createSpan({ cls: "goodobsidian-zoommode-icon" });
      iconOrText(glyph, mode.icon, mode.fallback);
      button.addEventListener("click", () => {
        // A second tap on Zoom box is the switch's own off position.
        const next = mode.box && active ? false : mode.box;
        if (next === boxMode) return;
        this.state.zoomBox = next;
        // Page zoom closes whatever target box was open; Zoom box opens one
        // where the page is being read, and hands the pen back to write in it.
        this.state.zoomBoxOpen = false;
        this.callbacks.onZoomBox?.(next);
        // The surface reports the box it opened back through setZoomBoxOpen.
        const opened = (this.state as { zoomBoxOpen?: boolean }).zoomBoxOpen === true;
        if (next && opened && this.drawingTool !== "zoom") {
          const back = this.drawingTool;
          this.leaveToolFor(back);
          this.state.tool = back;
          this.callbacks.onToolChange(back);
        }
        this.buildOptions();
        this.syncActive();
      });
    }
    this.optionsEl.createDiv({ cls: "goodobsidian-sep" });
    this.barButton(
      this.optionsEl,
      "zoom-out",
      t("toolbar.zoomOut"),
      cb.onZoomOut ? () => cb.onZoomOut?.() : undefined,
    );
    this.barButton(
      this.optionsEl,
      "maximize-2",
      // A board fits its whole drawing (FineNotes#46).
      this.board ? t("toolbar.fitDrawing") : t("toolbar.fitPage"),
      cb.onZoomFit ? () => cb.onZoomFit?.() : undefined,
    );
    this.barButton(
      this.optionsEl,
      "zoom-in",
      t("toolbar.zoomIn"),
      cb.onZoomIn ? () => cb.onZoomIn?.() : undefined,
    );
    // Page zoom keeps the note it always had; the Zoom box needs none: the
    // target it draws, and the window, show what a drag did.
    if (!boxMode && !this.dockedAcross()) {
      this.optionsEl.createDiv({ cls: "goodobsidian-sep" });
      this.toolNote("zoom-in", t("toolbar.zoom.note"));
    }
  }

  /**
   * The saved pens' popover: each pen with its number key, the one in hand
   * marked, in an order they are dragged to (a finger after a short hold);
   * then Save current pen, and a way to the settings, where they are edited
   * and deleted.
   */
  private toggleSavedPens(anchor: HTMLElement): void {
    if (this.popoverKind === "saved-pens") {
      this.closePopover();
      return;
    }
    const body = this.openPopover("saved-pens", anchor);
    body.addClass("goodobsidian-saved-pens-popover");
    let at = anchor;
    this.popoverRender = () => {
      body.empty();
      this.renderSavedPens(body);
      // A pin rebuilds the pill, its star with it (FineNotes#211). Placed
      // against the removed star, which measures 0, 0, the popover jumped
      // to the view's left edge: hang it from the new star instead.
      const popover = this.popover;
      if (!at.isConnected && popover) {
        const star = this.optionsEl.querySelector<HTMLElement>(".goodobsidian-saved-pens");
        if (!star) return;
        at = star;
        this.placePopover(popover, at);
      }
      this.keepPopoverInside(at);
    };
    this.popoverRender();
  }

  private renderSavedPens(body: HTMLElement): void {
    body.createDiv({ cls: "goodobsidian-popover-label", text: t("toolbar.savedPens.title") });
    const pens = this.callbacks.savedPens?.() ?? [];
    const current = penOfState(this.state);
    const inHand = this.state.tool === "pen" || this.state.tool === "highlighter";
    // Dragged into another order (FineNotes#211): the keys 1 to 8 follow it.
    const list = body.createDiv({ cls: "goodobsidian-saved-pen-list" });
    const pick = (pen: SavedPen): void => {
      this.closePopover();
      this.applySavedPen(pen);
    };
    const reorder = this.callbacks.onReorderPens;
    const drag = new RowDrag(list, ".goodobsidian-saved-pen", {
      canDrag: () => reorder !== undefined && pens.length > 1,
      onMove: (from, to) => {
        reorder?.(moveTo(pens, from, to));
        this.popoverRender?.();
      },
      onPenTap: (index) => {
        const pen = pens[index];
        if (pen) pick(pen);
      },
    });
    pens.forEach((pen, index) => {
      const spec = PEN_TYPES.find((type) => type.id === pen.type) ?? PEN_TYPES[0];
      const row = list.createEl("button", {
        cls: "goodobsidian-wide goodobsidian-pen-row goodobsidian-saved-pen",
      });
      row.append(penGlyph(spec.id, pen.color));
      row.createSpan({ cls: "goodobsidian-saved-pen-label", text: savedPenLabel(pen) });
      row.createEl("kbd", { cls: "goodobsidian-saved-pen-key", text: String(index + 1) });
      if (pen.id !== undefined && this.callbacks.onLayout && !this.practice) {
        this.savedPenPin(row, pen, pen.id);
      }
      if (pen.id !== undefined && this.callbacks.onDeletePen) {
        this.savedPenDelete(row, pen, pen.id);
      }
      row.toggleClass("is-active", inHand && samePen(pen, current));
      row.addEventListener("click", () => {
        if (!drag.consumeClick()) pick(pen);
      });
    });
    if (pens.length === 0) {
      body.createDiv({ cls: "goodobsidian-popover-hint", text: t("toolbar.savedPens.none") });
    }
    body.createDiv({ cls: "goodobsidian-popover-divider" });
    const make = this.callbacks.onNewPen;
    if (make && !this.practice) {
      // New pen: the pen dialog, starting from the pen in hand, to save it
      // as it is or changed first (FineNotes#211).
      const add = body.createEl("button", {
        cls: "goodobsidian-wide goodobsidian-popover-link clickable-icon",
      });
      const full = pens.length >= MAX_SAVED_PENS;
      add.createSpan({
        text: full
          ? t("toolbar.savedPens.full", { max: MAX_SAVED_PENS })
          : t("toolbar.savedPen.newPen"),
      });
      iconOrText(add.createSpan({ cls: "goodobsidian-popover-link-icon" }), "plus", "+");
      add.disabled = full;
      add.addEventListener("click", () => {
        if (add.disabled) return;
        this.closePopover();
        make(current, () => undefined);
      });
    } else this.saveCurrentPenLink(body, pens, current, inHand);
    this.editPensLink(body);
  }

  /** Save current pen, where there is no pen dialog to make one. */
  private saveCurrentPenLink(
    body: HTMLElement,
    pens: readonly SavedPen[],
    current: SavedPen,
    inHand: boolean,
  ): void {
    const saved = pens.some((pen) => samePen(pen, current));
    const add = body.createEl("button", {
      cls: "goodobsidian-wide goodobsidian-popover-link clickable-icon",
    });
    add.createSpan({
      text: saved
        ? t("toolbar.savedPens.thisSaved")
        : pens.length >= MAX_SAVED_PENS
          ? t("toolbar.savedPens.full", { max: MAX_SAVED_PENS })
          : t("toolbar.savedPens.saveCurrent"),
    });
    add.disabled = !inHand || saved || pens.length >= MAX_SAVED_PENS || !this.callbacks.onSavePen;
    add.addEventListener("click", () => {
      if (add.disabled) return;
      this.callbacks.onSavePen?.(current);
      this.popoverRender?.();
    });
  }

  /** Edit saved pens: the settings, where they are changed and deleted. */
  private editPensLink(body: HTMLElement): void {
    if (!this.callbacks.onEditPens) return;
    const edit = body.createEl("button", {
      cls: "goodobsidian-wide goodobsidian-popover-link clickable-icon",
    });
    edit.createSpan({ text: t("toolbar.savedPens.edit") });
    iconOrText(edit.createSpan({ cls: "goodobsidian-popover-link-icon" }), "chevron-right", ">");
    edit.addEventListener("click", () => {
      this.closePopover();
      this.callbacks.onEditPens?.();
    });
  }

  /**
   * Delete a saved pen (FineNotes#211): off the bar first, if it is on it,
   * so no button is left for a pen that is gone; then out of Saved pens.
   */
  private deleteSavedPen(id: string): void {
    const slot = savedPenSlot(id);
    if (placeOf(this.laid(), slot) !== "off") this.togglePenSlot(slot);
    if (this.handButton === slot) this.handButton = null;
    this.callbacks.onDeletePen?.(id);
  }

  /**
   * A saved pen's trash, at the end of its row: a first tap readies it (it
   * turns red), a second deletes the pen. It acts on its own lift, as the
   * pin does, and keeps its press from the row.
   */
  private savedPenDelete(row: HTMLElement, pen: SavedPen, id: string): void {
    const trash = row.createSpan({ cls: "goodobsidian-saved-pen-delete" });
    iconOrText(trash, "trash-2", "");
    const name = savedPenLabel(pen);
    trash.setAttribute("role", "button");
    trash.setAttribute("aria-label", t("toolbar.savedPens.delete", { name }));
    let pressed = false;
    trash.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      pressed = true;
    });
    trash.addEventListener("pointerup", (event) => {
      event.stopPropagation();
      if (!pressed) return;
      pressed = false;
      if (!trash.hasClass("is-armed")) {
        trash.addClass("is-armed");
        trash.setAttribute("aria-label", t("toolbar.savedPens.deleteConfirm", { name }));
        return;
      }
      this.deleteSavedPen(id);
      this.popoverRender?.();
    });
    trash.addEventListener("pointercancel", () => {
      pressed = false;
    });
    trash.addEventListener("click", (event) => event.stopPropagation());
  }

  /**
   * A saved pen's pin: on the bar as a button of its own, or not
   * (FineNotes#211). It sits in the row, which is itself a button and can be
   * dragged, so it acts on its own lift (the Pencil sends no click here)
   * and keeps its press from the row.
   */
  private savedPenPin(row: HTMLElement, pen: SavedPen, id: string): void {
    const slot = savedPenSlot(id);
    const on = placeOf(this.laid(), slot) !== "off";
    const pin = row.createSpan({ cls: "goodobsidian-saved-pen-pin" });
    pin.toggleClass("is-on", on);
    iconOrText(pin, "pin", "");
    const name = savedPenLabel(pen);
    pin.setAttribute("role", "button");
    pin.setAttribute("aria-pressed", String(on));
    pin.setAttribute(
      "aria-label",
      on ? t("toolbar.savedPens.unpin", { name }) : t("toolbar.savedPens.pin", { name }),
    );
    let pressed = false;
    pin.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      pressed = true;
    });
    pin.addEventListener("pointerup", (event) => {
      event.stopPropagation();
      if (!pressed) return;
      pressed = false;
      this.togglePenSlot(slot);
      this.popoverRender?.();
    });
    pin.addEventListener("pointercancel", () => {
      pressed = false;
    });
    pin.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
  }

  /**
   * Write with a saved pen: its type, colour and width, switching to the pen
   * or highlighter if another tool is in hand (the keys 1 to 8, the saved
   * pens' popover). Every change is reported as a pick by hand would be.
   */
  applySavedPen(pen: SavedPen): void {
    const spec = PEN_TYPES.find((type) => type.id === pen.type) ?? PEN_TYPES[0];
    if (this.practice && spec.tool === "highlighter") return;
    if (this.state.tool !== spec.tool) {
      this.drawingTool = drawingToolOf(this.drawingTool, spec.tool);
      this.leaveToolFor(spec.tool);
    }
    // The type first, so its own colour comes back, then the saved pen's
    // colour and width over it: that colour becomes the type's own.
    this.choosePenType(spec);
    this.state.color = pen.color;
    this.state.size = pen.size;
    this.callbacks.onColorChange(pen.color);
    this.callbacks.onSizeChange(pen.size);
    this.keepPenInk();
    this.buildOptions();
    this.syncActive();
  }

  private buildEraserOptions(): void {
    // Mode first, as in GoodNotes: "Standard" with a chevron to switch.
    const mode = ERASER_MODES.find((m) => m.id === eraserModeFor(this.state)) ?? ERASER_MODES[0];
    const modeButton = this.optionsEl.createEl("button", { cls: "goodobsidian-erasermode" });
    const modeIcon = modeButton.createSpan({ cls: "goodobsidian-erasermode-icon" });
    eraserModeIcon(modeIcon, mode.id, mode.label);
    // The titles stay on a pill along the top or bottom; an upright pill is icons only (styles.css).
    modeButton.createSpan({ cls: "goodobsidian-erasermode-label", text: mode.label });
    const modeCaret = modeButton.createSpan({ cls: "goodobsidian-erasermode-caret" });
    iconOrText(modeCaret, "chevron-down", "");
    modeButton.setAttribute("aria-label", t("toolbar.eraser.modeTip", { mode: mode.label }));
    modeButton.addEventListener("click", () => this.toggleEraserModeList(modeButton));

    this.optionsEl.createDiv({ cls: "goodobsidian-sep" });

    // Sizes, drawn as eraser footprints: the three presets, each keeping the
    // size it was given on the slider. The chevron opens the slider, as the
    // pen's widths do.
    const sizes = this.eraserPresets();
    const marks = this.eraserMarks(sizes, PILL_ERASER_BOX);
    sizes.forEach((size, slot) => {
      const button = this.optionsEl.createEl("button", { cls: "goodobsidian-erasersize" });
      button.append(eraserSizeGlyph(marks.get(size), PILL_ERASER_BOX));
      button.setAttribute("aria-label", t("toolbar.eraser.sizeValue", { mm: this.eraserMm(size) }));
      button.addEventListener("click", () => {
        this.pickEraserPreset(slot);
        this.syncActive();
      });
      this.eraserSizeButtons.set(slot, button);
    });
    this.chevron(t("toolbar.eraser.size"), (anchor) => this.toggleEraserSizeList(anchor));

    // What it erases: GoodNotes' "Erase highlighter only", and "pen only".
    this.optionsEl.createDiv({ cls: "goodobsidian-sep" });
    const filter = eraserFilterFor(this.state);
    const filterButton = this.optionsEl.createEl("button", {
      cls: "goodobsidian-erasermode goodobsidian-eraserfilter",
    });
    const filterIcon = filterButton.createSpan({ cls: "goodobsidian-erasermode-icon" });
    const icon =
      filter === "highlighter" ? "highlighter" : filter === "pen" ? "pen-line" : "layers";
    iconOrText(filterIcon, icon, ERASER_FILTER_LABELS[filter]);
    filterButton.createSpan({
      cls: "goodobsidian-erasermode-label",
      text: ERASER_FILTER_LABELS[filter],
    });
    const filterCaret = filterButton.createSpan({ cls: "goodobsidian-erasermode-caret" });
    iconOrText(filterCaret, "chevron-down", "");
    filterButton.toggleClass("is-filtered", filter !== "all");
    filterButton.setAttribute(
      "aria-label",
      t("toolbar.eraser.erasesTip", { filter: ERASER_FILTER_LABELS[filter] }),
    );
    filterButton.addEventListener("click", () => this.toggleEraserFilterList(filterButton));

    this.optionsEl.createDiv({ cls: "goodobsidian-sep" });
    const clear = this.optionsEl.createEl("button", {
      cls: "goodobsidian-text-button clickable-icon",
    });
    iconOrText(clear, "trash-2", t("toolbar.eraser.clearPage"));
    clear.setAttribute("aria-label", t("toolbar.eraser.clearPage"));
    clear.addEventListener("click", () => this.callbacks.onClear());
  }

  private buildShapeOptions(): void {
    // The connectors apart from the closed shapes, and the table on its own.
    // (Auto-shape is the pen's switch now, not a mode here.)
    const groups: ShapeMode[][] = [[...SHAPE_PRESETS], [...CONNECTOR_PRESETS], ["table"]];
    this.tableCaption = null;
    groups.forEach((modes, g) => {
      if (g > 0) this.optionsEl.createDiv({ cls: "goodobsidian-sep" });
      for (const mode of modes) {
        const button = this.optionsEl.createEl("button", {
          cls: "goodobsidian-shape clickable-icon",
        });
        button.append(shapeGlyph(mode));
        button.setAttribute("aria-label", SHAPE_LABELS[mode]);
        button.setAttribute("title", SHAPE_LABELS[mode]);
        button.addEventListener("click", () => {
          // First tap selects (the remembered size is on the button), a
          // second opens the picker, as every tool button does.
          const again = shapeModeFor(this.state) === mode;
          this.state.shapeMode = mode;
          this.syncActive();
          if (mode === "table" && again) this.toggleTablePicker(button);
        });
        this.shapeButtons.set(mode, button);
        if (mode === "table") {
          // The size shows on the button, so the remembered choice is visible
          // before the picker is ever opened again.
          button.addClass("is-table");
          this.tableCaption = button.createSpan({ cls: "goodobsidian-shape-caption" });
          this.refreshTableButton();
        }
      }
    });

    // The shapes' own colour, black until another is picked: a disc of it
    // and a caret, opening the colour panel (the pens' picker, then the
    // fill and its opacity), as the selection bar's disc does.
    this.optionsEl.createDiv({ cls: "goodobsidian-sep" });
    const color = this.state.shapeColor ?? DEFAULT_SHAPE_COLOR;
    const button = this.optionsEl.createEl("button", {
      cls: "goodobsidian-shape-color clickable-icon",
      attr: { "aria-haspopup": "dialog" },
    });
    button
      .createSpan({ cls: "goodobsidian-text-disc" })
      .setCssStyles({ background: this.shown(color, false) });
    caretIn(button);
    button.setAttribute("aria-label", t("toolbar.shape.colourValue", { color }));
    button.setAttribute("title", t("toolbar.shape.colour"));
    button.addEventListener("click", () => this.toggleShapeColourPanel(button));

    // The line: its style, width, corners and arrowheads, as the selection
    // bar's line panel has them.
    const lineButton = this.optionsEl.createEl("button", {
      cls: "goodobsidian-shape-style clickable-icon",
      attr: { "aria-haspopup": "dialog" },
    });
    iconOrText(
      lineButton.createSpan({ cls: "goodobsidian-shape-style-icon" }),
      "align-justify",
      t("surface.shapeStyle.line"),
    );
    caretIn(lineButton);
    lineButton.setAttribute("aria-label", t("surface.shapeStyle.line"));
    lineButton.setAttribute("title", t("surface.shapeStyle.line"));
    lineButton.addEventListener("click", () => this.toggleShapeLinePanel(lineButton));
  }

  /** The opacity Fill turns back on at, after it was switched off. */
  private shapeFillAlpha = TINT_ALPHA;

  /** Change the Shape tool's style, keep it, and leave out what is unset. */
  private setShapeStyle(patch: Partial<ShapeToolStyle>): ShapeToolStyle {
    const next: ShapeToolStyle = { ...readShapeToolStyle(this.state.shapeStyle), ...patch };
    for (const key of Object.keys(next) as Array<keyof ShapeToolStyle>) {
      if (next[key] === undefined) delete next[key];
    }
    // No line only with a fill: a shape is never drawn as nothing.
    if (next.fillAlpha === undefined) delete next.noLine;
    if (next.fillAlpha !== undefined) this.shapeFillAlpha = next.fillAlpha;
    this.state.shapeStyle = next;
    this.callbacks.onShapeStyleChange?.(next);
    return next;
  }

  private toggleShapeColourPanel(anchor: HTMLElement): void {
    if (this.popoverKind === "shape-color") {
      this.closePopover();
      return;
    }
    const body = this.openPopover("shape-color", anchor);
    this.popover?.addClass("is-color-popover", "has-arrow");
    body.addClass("goodobsidian-shape-panel");
    this.renderShapeColour(body, anchor);
    this.keepPopoverInside(anchor);
  }

  /**
   * The colour panel: the colours, then the fill's switch and, while it is
   * on, its opacity. A pick keeps the panel open, as the selection's does.
   */
  private renderShapeColour(body: HTMLElement, anchor: HTMLElement): void {
    body.empty();
    const color = this.state.shapeColor ?? DEFAULT_SHAPE_COLOR;
    const use = (picked: string): void => {
      this.state.shapeColor = picked;
      this.callbacks.onShapeColorChange?.(picked);
      anchor
        .querySelector<HTMLElement>(".goodobsidian-text-disc")
        ?.setCssStyles({ background: this.shown(picked, false) });
      anchor.setAttribute("aria-label", t("toolbar.shape.colourValue", { color: picked }));
      if (body.isConnected) this.renderShapeColour(body, anchor);
    };
    renderColorPicker(body.createDiv(), {
      shown: (c) => this.shown(c),
      current: color,
      extra: this.pickerExtras(color),
      recent: this.state.recentColors ?? [],
      notebook: this.callbacks.notebookColors?.() ?? [],
      onPick: (c) => {
        if (c) use(c);
      },
      onCustom: (c) => {
        this.rememberColor(c);
        use(c);
      },
      onEyedropper: this.eyedropper(use),
    });

    const style = readShapeToolStyle(this.state.shapeStyle);
    const on = style.fillAlpha !== undefined;
    body.createDiv({ cls: "goodobsidian-popover-divider" });
    this.switchRow(
      body.createDiv({ cls: "goodobsidian-switch-list goodobsidian-text-switches" }),
      t("surface.shapeStyle.fill"),
      on,
      (yes) => {
        this.setShapeStyle({ fillAlpha: yes ? this.shapeFillAlpha : undefined });
        this.renderShapeColour(body, anchor);
        this.keepPopoverInside(anchor);
      },
    );
    if (!on) return;
    const opacity = t("surface.selectionBar.segment.opacity");
    const range = this.panelSlider(body, opacity, FILL_OPACITIES.length - 1);
    range.input.value = String(FILL_OPACITIES.indexOf(nearestFillOpacity(style.fillAlpha ?? 1)));
    const stop = (): number => FILL_OPACITIES[Number(range.input.value)] ?? 1;
    const show = (): void => {
      range.readout.setText(`${Math.round(stop() * 100)} %`);
      syncRangeFill(range.input);
    };
    show();
    range.input.addEventListener("input", show);
    range.input.addEventListener("change", () => this.setShapeStyle({ fillAlpha: stop() }));
  }

  /** A labelled slider with a readout, as the selection's panels have them. */
  private panelSlider(
    body: HTMLElement,
    label: string,
    max: number,
  ): { input: HTMLInputElement; readout: HTMLElement } {
    const head = body.createDiv({ cls: "goodobsidian-width-head goodobsidian-shape-panel-head" });
    head.createDiv({ cls: "goodobsidian-popover-label", text: label });
    const readout = head.createSpan({ cls: "goodobsidian-width-readout" });
    const slider = body.createDiv({ cls: "goodobsidian-width-slider" });
    const input = slider.createEl("input", {
      cls: "goodobsidian-width-range",
      type: "range",
      attr: { "aria-label": label },
    });
    input.min = "0";
    input.max = String(Math.max(0, max));
    input.step = "1";
    dragRange(input);
    return { input, readout };
  }

  private toggleShapeLinePanel(anchor: HTMLElement): void {
    if (this.popoverKind === "shape-style") {
      this.closePopover();
      return;
    }
    const body = this.openPopover("shape-style", anchor);
    body.addClass("goodobsidian-shape-panel");
    this.renderShapeLine(body);
    this.keepPopoverInside(anchor);
  }

  /**
   * The line panel: None (with a fill only), Solid, Dashed, Dotted as tiles,
   * the width on a slider, then corners and arrowheads as segmented rows.
   * Each choice applies at once and the panel stays open.
   */
  private renderShapeLine(body: HTMLElement): void {
    body.empty();
    const style = readShapeToolStyle(this.state.shapeStyle);
    const filled = style.fillAlpha !== undefined;
    const noLine = filled && style.noLine === true;
    const set = (patch: Partial<ShapeToolStyle>): void => {
      this.setShapeStyle(patch);
      this.renderShapeLine(body);
    };

    const tiles = body.createDiv({ cls: "goodobsidian-shape-tiles" });
    const tile = (
      icon: string,
      label: string,
      on: boolean,
      patch: Partial<ShapeToolStyle>,
      enabled = true,
    ): void => {
      const button = tiles.createEl("button", {
        cls: "goodobsidian-shape-tile clickable-icon",
        attr: { "aria-label": label, "aria-pressed": String(on), title: label },
      });
      iconOrText(button.createSpan({ cls: "goodobsidian-shape-tile-icon" }), icon, label);
      button.createSpan({ cls: "goodobsidian-shape-tile-label", text: label });
      button.toggleClass("is-active", on);
      button.disabled = !enabled;
      button.addEventListener("click", () => set(patch));
    };
    tile("ban", t("surface.shapeStyle.noLine"), noLine, { noLine: true }, filled);
    tile("minus", t("surface.shapeStyle.solidLine"), !noLine && !style.dash, {
      dash: undefined,
      noLine: undefined,
    });
    tile("square-dashed", t("surface.shapeStyle.dashedLine"), !noLine && style.dash === "dash", {
      dash: "dash",
      noLine: undefined,
    });
    tile("ellipsis", t("surface.shapeStyle.dottedLine"), !noLine && style.dash === "dot", {
      dash: "dot",
      noLine: undefined,
    });

    const current = strokeWidthFor(this.state);
    const base = widthStops(SIZES, true);
    const stops = base.includes(current) ? base : [...base, current].sort((a, b) => a - b);
    const range = this.panelSlider(body, t("toolbar.width.title"), stops.length - 1);
    range.input.value = String(nearestStop(stops, current));
    const width = (): number => stops[Number(range.input.value)] ?? current;
    const show = (): void => {
      range.readout.setText(formatMm(width()));
      syncRangeFill(range.input);
    };
    show();
    range.input.addEventListener("input", show);
    range.input.addEventListener("change", () => this.setShapeStyle({ width: width() }));

    body.createDiv({ cls: "goodobsidian-popover-divider" });
    const segments = (
      label: string,
      options: ReadonlyArray<{
        icon: string;
        name: string;
        on: boolean;
        patch: Partial<ShapeToolStyle>;
      }>,
    ): void => {
      const row = body.createDiv({ cls: "goodobsidian-shape-segments" });
      row.createSpan({ cls: "goodobsidian-shape-segments-label", text: label });
      const group = row.createDiv({
        cls: "goodobsidian-shape-segment-group",
        attr: { role: "group", "aria-label": label },
      });
      for (const option of options) {
        const button = group.createEl("button", {
          cls: "goodobsidian-shape-segment clickable-icon",
          attr: {
            "aria-label": option.name,
            "aria-pressed": String(option.on),
            title: option.name,
          },
        });
        iconOrText(button, option.icon, option.name);
        button.toggleClass("is-active", option.on);
        button.addEventListener("click", () => set(option.patch));
      }
    };
    segments(t("surface.shapeStyle.corners"), [
      {
        icon: "square",
        name: t("surface.shapeStyle.squareCorners"),
        on: style.round !== true,
        patch: { round: undefined },
      },
      {
        icon: "square-round-corner",
        name: t("surface.shapeStyle.roundedCorners"),
        on: style.round === true,
        patch: { round: true },
      },
    ]);
    const heads = style.heads ?? DEFAULT_ARROW_HEADS;
    const { start, end } = heads;
    const filledHeads = start === "filled" || end === "filled";
    const kind = filledHeads ? "filled" : "open";
    const flip = filledHeads ? "open" : "filled";
    segments(t("surface.shapeStyle.arrows"), [
      {
        icon: "arrow-left",
        name: t("surface.shapeStyle.arrowAtStart"),
        on: start !== undefined,
        patch: { heads: { ...(start ? {} : { start: kind }), ...(end ? { end } : {}) } },
      },
      {
        icon: "arrow-right",
        name: t("surface.shapeStyle.arrowAtEnd"),
        on: end !== undefined,
        patch: { heads: { ...(start ? { start } : {}), ...(end ? {} : { end: kind }) } },
      },
      {
        icon: "triangle",
        name: t("surface.shapeStyle.filledArrowheads"),
        on: filledHeads,
        patch: {
          heads:
            start || end
              ? { ...(start ? { start: flip } : {}), ...(end ? { end: flip } : {}) }
              : { end: "filled" },
        },
      },
    ]);
  }

  /** Put the current table size on the Table button, and in its label. */
  private refreshTableButton(): void {
    const label = tableSizeLabel(tableSizeFor(this.state));
    this.tableCaption?.setText(label);
    const button = this.shapeButtons.get("table");
    button?.setAttribute("aria-label", t("toolbar.table.tip", { size: label }));
    button?.setAttribute("title", t("toolbar.table.title", { size: label }));
  }

  /**
   * The rows × columns picker: an 8 × 8 grid of cells big enough for a
   * finger. Tapping a cell picks that size and closes the picker; where the
   * device can hover (a mouse, a hovering Pencil) the grid previews the size
   * under the pointer, but nothing depends on hover.
   */
  private toggleTablePicker(anchor: HTMLElement): void {
    if (this.popoverKind === "table") {
      this.closePopover();
      return;
    }
    const body = this.openPopover("table", anchor);
    this.popover?.addClass("is-table-picker");
    body.addClass("goodobsidian-table-picker");
    const title = body.createDiv({ cls: "goodobsidian-popover-label" });
    const grid = body.createDiv({ cls: "goodobsidian-table-grid" });
    const cells: Array<{ button: HTMLButtonElement; size: TableSize }> = [];
    const show = (size: TableSize): void => {
      title.setText(t("toolbar.table.heading", { size: tableSizeLabel(size) }));
      for (const cell of cells) {
        const inside = cell.size.rows <= size.rows && cell.size.cols <= size.cols;
        cell.button.toggleClass("is-picked", inside);
      }
    };
    for (let rows = 1; rows <= TABLE_MAX_ROWS; rows++) {
      for (let cols = 1; cols <= TABLE_MAX_COLS; cols++) {
        const size = { rows, cols };
        const button = grid.createEl("button", {
          cls: "goodobsidian-table-pick clickable-icon",
        });
        button.setAttribute("aria-label", t("toolbar.table.cell", { size: tableSizeLabel(size) }));
        button.addEventListener("pointerenter", () => show(size));
        button.addEventListener("focus", () => show(size));
        button.addEventListener("click", () => this.pickTableSize(size));
        cells.push({ button, size });
      }
    }
    grid.addEventListener("pointerleave", () => show(tableSizeFor(this.state)));
    this.switchRow(
      body.createDiv({ cls: "goodobsidian-switch-list goodobsidian-text-switches" }),
      t("toolbar.table.headerRow"),
      this.state.tableHeader === true,
      (on) => {
        this.state.tableHeader = on;
        this.callbacks.onTableHeaderChange?.(on);
      },
    );
    body.createDiv({
      cls: "goodobsidian-popover-hint",
      text: t("toolbar.table.hint"),
    });
    show(tableSizeFor(this.state));
    this.keepPopoverInside(anchor);
  }

  private pickTableSize(size: TableSize): void {
    this.state.tableSize = { ...size };
    lastTableSize = { ...size };
    this.state.shapeMode = "table";
    this.closePopover();
    this.refreshTableButton();
    this.syncActive();
  }

  /**
   * The lasso has no options pill, as in GoodNotes: its type and what it
   * picks up live in the popover its tier-1 button opens (the chevron on the
   * button says so), and an empty pill hides itself.
   */
  private buildSelectOptions(): void {
    // Docked along the top or bottom, the lasso's options are in the bar itself.
    if (this.dockedAcross()) {
      this.buildLassoRow();
      return;
    }
    // Repeated selection may now return to Pen, so keep the lasso settings reachable.
    if (this.callbacks.returnToPenOnReselect?.() === true)
      this.barButton(this.optionsEl, "settings-2", t("toolbar.lasso.options"), (button) =>
        this.toggleLassoPopover(button),
      );
  }

  /**
   * GoodNotes' "Lasso Tool" popover, from a screenshot Joost supplied
   * (2026-09-22): the lasso type as two cards, then a switch per kind of
   * element the lasso picks up. It hangs from the lasso button with an arrow.
   */
  private toggleLassoPopover(anchor: HTMLElement): void {
    if (this.popoverKind === "lasso") {
      this.closePopover();
      return;
    }
    const body = this.openPopover("lasso", anchor);
    this.popover?.addClass("is-lasso-popover");
    this.popover?.addClass("has-arrow");
    body.addClass("goodobsidian-lasso-popover");
    this.popoverRender = () => {
      body.empty();
      this.renderLassoOptions(body);
    };
    this.popoverRender();
    this.keepPopoverInside(anchor);
  }

  private renderLassoOptions(body: HTMLElement): void {
    body.createDiv({ cls: "goodobsidian-popover-title", text: t("toolbar.lasso.tool") });
    body.createDiv({ cls: "goodobsidian-popover-label", text: t("toolbar.lasso.type") });
    const types = body.createDiv({ cls: "goodobsidian-lasso-types" });
    const mode = lassoModeFor(this.state);
    for (const option of [...LASSO_MODES].reverse()) {
      // Rectangular first, as GoodNotes lays them out.
      const card = types.createEl("button", { cls: "goodobsidian-lasso-type clickable-icon" });
      card.append(lassoGlyph(option));
      card.createSpan({ cls: "goodobsidian-lasso-type-label", text: LASSO_MODE_LABELS[option] });
      card.toggleClass("is-active", option === mode);
      card.setAttribute("aria-pressed", String(option === mode));
      card.addEventListener("click", () => {
        this.state.lassoMode = option;
        this.saveLasso();
        this.drawLassoIcon();
        this.popoverRender?.();
      });
    }

    body.createDiv({ cls: "goodobsidian-popover-label", text: t("toolbar.lasso.include") });
    const list = body.createDiv({ cls: "goodobsidian-switch-list" });
    const filter = lassoFilterFor(this.state);
    for (const key of LASSO_FILTER_KEYS) {
      this.switchRow(list, LASSO_FILTER_LABELS[key], filter[key], (on) => {
        this.state.lassoFilter = { ...lassoFilterFor(this.state), [key]: on };
        this.saveLasso();
        this.popoverRender?.();
      });
    }
  }

  /**
   * Docked along the top or bottom (discussion #200): a tool's choices are
   * a row of the bar, each one a button, rather than a menu behind one.
   */
  private dockedAcross(): boolean {
    const edge = pillRowEdge(this.pillRowOn, this.pillDock, this.barDock);
    return edge === "top" || edge === "bottom";
  }

  /**
   * A row of colour swatches for a tool with one colour (the laser, fill):
   * `colors`, the one in use among them, and a + that opens the picker for
   * any other.
   */
  private colorRow(
    colors: readonly string[],
    current: string,
    pick: (color: string) => void,
    openPicker: (anchor: HTMLElement) => void,
  ): void {
    const row = this.optionsEl.createDiv({ cls: "goodobsidian-pen-colors" });
    row.dataset.ignoreSwipe = "true";
    const shown = colors.some((c) => sameColor(c, current)) ? colors : [current, ...colors];
    for (const color of shown) {
      const swatch = this.swatchButton(row, color, () => pick(color));
      swatch.toggleClass("is-active", sameColor(color, current));
    }
    const more = row.createEl("button", {
      cls: "goodobsidian-color-more clickable-icon",
      attr: { type: "button", "aria-label": t("toolbar.color.add") },
    });
    iconOrText(more, "plus", "+");
    more.addEventListener("click", () => openPicker(more));
  }

  /**
   * The lasso popover's choices as a row of the bar (discussion #200): its
   * types, then what it picks up, each a symbol that is lit while on.
   */
  private buildLassoRow(): void {
    const mode = lassoModeFor(this.state);
    for (const option of [...LASSO_MODES].reverse()) {
      const button = this.optionsEl.createEl("button", {
        cls: "goodobsidian-shape goodobsidian-lasso-mode clickable-icon",
        attr: { type: "button", "aria-label": LASSO_MODE_LABELS[option] },
      });
      button.append(lassoGlyph(option, 24));
      button.toggleClass("is-active", option === mode);
      button.setAttribute("aria-pressed", String(option === mode));
      button.addEventListener("click", () => {
        this.state.lassoMode = option;
        this.saveLasso();
        this.drawLassoIcon();
        this.buildOptions();
      });
    }
    this.optionsEl.createDiv({ cls: "goodobsidian-sep" });
    const filter = lassoFilterFor(this.state);
    for (const key of LASSO_FILTER_KEYS) {
      const on = filter[key];
      const button = this.optionsEl.createEl("button", {
        cls: "goodobsidian-shape goodobsidian-lasso-filter clickable-icon",
        attr: { type: "button", "aria-label": LASSO_FILTER_LABELS[key] },
      });
      setIcon(button, LASSO_FILTER_ICONS[key]);
      button.toggleClass("is-active", on);
      button.setAttribute("aria-pressed", String(on));
      button.addEventListener("click", () => {
        this.state.lassoFilter = { ...lassoFilterFor(this.state), [key]: !on };
        this.saveLasso();
        this.buildOptions();
      });
    }
  }

  private saveLasso(): void {
    this.callbacks.onLassoChange?.(lassoModeFor(this.state), lassoFilterFor(this.state));
  }

  /**
   * One row of a switch list: the label, and an iOS-style switch on the
   * right. The whole row is the control, 44 px tall, so a finger finds it.
   */
  private switchRow(
    parent: HTMLElement,
    label: string,
    on: boolean,
    onChange: (on: boolean) => void,
  ): HTMLButtonElement {
    const row = parent.createEl("button", {
      cls: "goodobsidian-switch-row clickable-icon",
      attr: { role: "switch", "aria-checked": String(on), "aria-label": label },
    });
    row.createSpan({ cls: "goodobsidian-switch-label", text: label });
    row.createSpan({ cls: "goodobsidian-switch" }).createSpan({ cls: "goodobsidian-switch-thumb" });
    row.toggleClass("is-on", on);
    // The row keeps its own state: a popover that does not redraw after a
    // change (the table picker's Header row) still shows the flip, and a
    // second tap flips it back rather than sending the same value again.
    let current = on;
    row.addEventListener("click", () => {
      current = !current;
      row.toggleClass("is-on", current);
      row.setAttribute("aria-checked", String(current));
      onChange(current);
    });
    return row;
  }

  // --- Tier 2: the Text tool (0.5) -------------------------------------------
  //
  // After GoodNotes 6, from a screenshot Joost supplied (2026-09-22): colour ·
  // size · font · B I · alignment · line spacing · lists | box fill · pin.
  // Joost dropped "Text styles" and asked for a smaller pill the same day. Each control edits one whole-box style key. With a box
  // being edited the change is one undoable command on that box (the host
  // applies it) and is remembered for new boxes too; with none, it only sets
  // the style new boxes get. Nothing here takes focus from the box.

  /** The style new boxes get. */
  private newTextStyle(): TextStyle {
    return this.state.textStyle ?? { ...DEFAULT_TEXT_STYLE };
  }

  /** The style the pill shows: the box being edited, else the one new boxes get. */
  private shownTextStyle(): TextStyle {
    return this.textTarget ?? this.newTextStyle();
  }

  private buildTextOptions(): void {
    const style = this.shownTextStyle();

    // Named styles (Title, Heading, …): the preset the box matches, or "Style".
    const preset = presetOf(style);
    const styles = this.textControl(
      "is-drop is-preset",
      t("toolbar.text.styleTip", { name: preset?.name ?? t("toolbar.text.styleCustom") }),
      (b) => this.toggleTextPopover("preset", b, (body) => this.renderTextPresets(body)),
    );
    styles.createSpan({
      cls: "goodobsidian-text-drop-label",
      text: preset?.name ?? t("toolbar.text.style"),
    });
    caretIn(styles);

    const color = this.textControl("is-color", t("toolbar.text.colour"), (b) =>
      this.toggleTextPopover("color", b, (body) => this.renderTextColors(body)),
    );
    // The disc *is* the text colour: a value, not chrome.
    color
      .createSpan({ cls: "goodobsidian-text-disc" })
      .setCssStyles({ background: this.shown(style.color, false) });
    caretIn(color);

    // To one decimal: a box resized before sizes were rounded may hold more.
    const shownSize = String(Math.round(style.fontSize * 10) / 10);
    const size = this.textControl(
      "is-drop is-size",
      t("toolbar.text.fontSizeValue", { size: shownSize }),
      (b) => this.toggleTextPopover("size", b, (body) => this.renderTextSizes(body)),
    );
    size.createSpan({ cls: "goodobsidian-text-drop-label", text: shownSize });
    caretIn(size);

    // The font's name, set in that font, as GoodNotes shows it.
    const fontName = style.family ?? TEXT_FONT_LABELS[fontOf(style)];
    const fontButton = this.textControl(
      "is-drop is-font",
      t("toolbar.text.fontValue", { font: fontName }),
      (b) => this.toggleTextPopover("font", b, (body) => this.renderTextFonts(body)),
    );
    fontButton
      .createSpan({ cls: "goodobsidian-text-drop-label", text: fontName })
      .setCssStyles({ fontFamily: fontFamilyOf(style) });
    caretIn(fontButton);

    const format = this.textControl("is-format", t("toolbar.text.formatTip"), (b) =>
      this.toggleTextPopover("format", b, (body) => this.renderTextFormat(body)),
    );
    format.createSpan({ cls: "goodobsidian-text-b", text: "B" });
    format.createSpan({ cls: "goodobsidian-text-i", text: "I" });
    format.toggleClass("is-on", !!(style.bold || style.italic || style.underline || style.strike));

    const align = style.align ?? "left";
    this.textControl(
      "is-glyph",
      t("toolbar.text.alignValue", { align: TEXT_ALIGN_LABELS[align] }),
      (b) => this.toggleTextPopover("align", b, (body) => this.renderTextAlign(body)),
    ).append(alignGlyph(align));

    this.textControl(
      "is-glyph",
      t("toolbar.text.lineSpacingValue", { value: formatLineHeight(lineHeightOf(style)) }),
      (b) => this.toggleTextPopover("spacing", b, (body) => this.renderTextSpacing(body)),
    ).append(lineSpacingGlyph());

    // Bullets and numbering act on the text under the caret: only while a box is edited.
    const list = this.textControl("is-glyph", t("toolbar.text.listsTip"), (b) =>
      this.toggleTextPopover("list", b, (body) => this.renderTextLists(body)),
    );
    list.append(listGlyph("bullet"));
    list.disabled = this.textTarget === null;

    this.optionsEl.createDiv({ cls: "goodobsidian-sep" });

    this.textControl(
      "is-glyph",
      style.fill ? t("toolbar.text.boxFill") : t("toolbar.text.boxFillNone"),
      (b) => this.toggleTextPopover("fill", b, (body) => this.renderTextFills(body)),
    ).append(fillGlyph(style.fill));

    this.textControl(
      "is-glyph",
      style.border ? t("toolbar.text.boxBorder") : t("toolbar.text.boxBorderNone"),
      (b) => this.toggleTextPopover("border", b, (body) => this.renderTextBorder(body)),
    ).append(borderGlyph(style.border, style.radius !== undefined));

    // "Drag to size text boxes" is a setting (Writing and tools), not a pill
    // button: it is a way of working, set once, not a style of one box.

    // Equation (discussion #166): while on, a tap on the page writes a typed
    // equation instead of a text box. Only with the Text tool in hand, not
    // while a box is edited.
    if (this.state.tool === "text" && this.textTarget === null) {
      const on = this.state.textEquation === true;
      const equation = this.textControl("is-glyph is-equation", t("toolbar.text.equation"), () => {
        this.state.textEquation = !on;
        this.buildOptions();
      });
      equation.createSpan({ cls: "goodobsidian-text-sigma", text: "Σ" });
      equation.toggleClass("is-active", on);
      equation.setAttribute("aria-pressed", String(on));
    }

    // GoodNotes' "Pin Text tool". Unpinned, finishing a box hands the page
    // back to the tool used before Text; pinned, Text stays.
    const pinned = this.state.textPinned === true;
    const pin = this.textControl("is-pin", t("toolbar.text.pin"), () => {
      this.state.textPinned = !pinned;
      this.saveTextTool();
      this.buildOptions();
    });
    // Labelled, as GoodNotes has it; a pane too narrow for the whole pill
    // (fitTextPill) drops the label and keeps the icon.
    iconOrText(
      pin.createSpan({ cls: "goodobsidian-text-pin-icon" }),
      "pin",
      t("toolbar.text.pinShort"),
    );
    // The pin alone, named by its label: the pill takes no room for words.
    pin.toggleClass("is-active", pinned);
    pin.setAttribute("aria-pressed", String(pinned));

    // Delete the box being edited: last, apart, and red, so it is not hit
    // by accident. Only while a box has focus; Undo brings it back.
    if (this.callbacks.onTextDelete) {
      this.optionsEl.createDiv({ cls: "goodobsidian-sep" });
      const remove = this.textControl("is-delete", t("toolbar.text.deleteBox"), () =>
        this.callbacks.onTextDelete?.(),
      );
      iconOrText(
        remove.createSpan({ cls: "goodobsidian-text-pin-icon" }),
        "trash-2",
        t("common.delete"),
      );
      remove.disabled = this.textTarget === null;
    }
  }

  /** A text-pill button. Full 44 px: this pill is used with a keyboard up, by finger too. */
  private textControl(
    cls: string,
    label: string,
    onClick: (button: HTMLButtonElement) => void,
  ): HTMLButtonElement {
    const button = this.optionsEl.createEl("button", {
      cls: `goodobsidian-text-control clickable-icon ${cls}`,
    });
    button.setAttr("aria-label", label);
    button.setAttribute("title", label);
    button.addEventListener("click", () => onClick(button));
    return button;
  }

  /**
   * The mark after a box's family in the font menu: none where the device
   * draws it, a download where FineNotes can fetch it or a stand-in
   * (font-store.ts; a tap fetches it), ⚠ where it falls back to `fallback`.
   */
  private markFamily(
    button: HTMLElement,
    family: string,
    fallback: string,
    refresh: () => void,
  ): void {
    const fonts = loadedVaultFonts();
    const state = fonts ? fonts.state(family) : hasFamily(family) ? "installed" : "missing";
    if (state === "installed") return;
    const source = fonts?.source(family);
    if (state === "loaded") {
      // Drawn by FineNotes: in the family itself, or in its stand-in.
      if (source?.sizeAdjust !== undefined) {
        button.setAttr(
          "aria-label",
          t("toolbar.font.notOnDeviceLabel", { family, font: source.font.family }),
        );
      }
      return;
    }
    const mark = button.createSpan({ cls: "goodobsidian-font-missing" });
    if (state === "missing" || !fonts || !source) {
      const missing = t("toolbar.font.notOnDevice", { font: fallback });
      button.setAttr("aria-label", t("toolbar.font.familyNote", { family, note: missing }));
      mark.setAttr("title", missing);
      setIcon(mark, "alert-triangle");
      return;
    }
    const label = downloadLabel(source);
    mark.addClass("is-fetch");
    mark.setAttrs({ role: "button", tabindex: "0", "aria-label": label, title: label });
    setIcon(mark, "download");
    let busy = false;
    const get = (event: Event): void => {
      // The mark is inside the option: picking the font is not what it does.
      event.preventDefault();
      event.stopPropagation();
      if (busy) return;
      busy = true;
      mark.addClass("is-busy");
      setIcon(mark, "loader");
      fonts
        .fetch(family)
        .catch((error: unknown) => {
          new Notice(
            t("toolbar.font.getFailed", { font: source.font.family, error: errorMessage(error) }),
            8000,
          );
        })
        .finally(() => {
          if (button.isConnected) refresh();
        });
    };
    mark.addEventListener("click", get);
    mark.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") get(event);
    });
  }

  /** A button inside a text popover. */
  private textOption(
    parent: HTMLElement,
    cls: string,
    text: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const button = parent.createEl("button", {
      cls: `goodobsidian-text-option clickable-icon ${cls}`,
      text,
    });
    button.addEventListener("click", onClick);
    return button;
  }

  /**
   * Apply a text-pill change: to the box being edited (through the host, as
   * one undoable command) and to the style new boxes get, which is saved.
   */
  private applyTextPatch(patch: TextStylePatch): void {
    this.state.textStyle = withTextStyle(this.newTextStyle(), patch);
    if (this.textTarget) this.textTarget = withTextStyle(this.textTarget, patch);
    this.callbacks.onTextStyle?.(patch);
    this.saveTextTool();
    this.buildOptions();
    this.popoverRender?.();
  }

  private saveTextTool(): void {
    this.callbacks.onTextToolChange?.(
      this.newTextStyle(),
      this.state.textPinned === true,
      this.state.textDragSize === true,
    );
  }

  /** Pick one value and close, as a dropdown does. */
  private pickText(patch: TextStylePatch): void {
    this.closePopover();
    this.applyTextPatch(patch);
  }

  /**
   * Open a text popover on `anchor`, or close it if it is the one open.
   * `render` fills its body, and runs again after every change it makes, so
   * a multi-toggle popover (B I U S) stays open and shows the new state.
   */
  private toggleTextPopover(
    kind: string,
    anchor: HTMLElement,
    render: (body: HTMLElement) => void,
  ): void {
    const key = `text-${kind}`;
    if (this.popoverKind === key) {
      this.closePopover();
      return;
    }
    const body = this.openPopover(key, anchor);
    body.addClass("goodobsidian-text-popover");
    this.popover?.addClass("is-text-sheet");
    this.popoverRender = () => {
      body.empty();
      render(body);
    };
    this.popoverRender();
    this.popoverRefit = () => this.fitTextPopover(anchor);
    this.popoverRefit();
  }

  /**
   * Place a text popover and hold it to its room, from its height now. Run
   * again whenever its rows change after it opened: the font menu fills in
   * the device's fonts when they arrive, and a popover measured before that
   * was left uncapped, so the long list ran past the view's bottom, which
   * clips it, with nothing to scroll (FineNotes#165).
   */
  private fitTextPopover(anchor: HTMLElement): void {
    const popover = this.popover;
    if (!popover || !anchor.isConnected) return;
    // A cap from an earlier, shorter fill would be read back as its height.
    popover.setCssStyles({ maxHeight: "" });
    this.keepPopoverInside(anchor);
    this.keepPopoverAboveKeyboard(anchor);
  }

  /**
   * The text pill is used with the on-screen keyboard up, and a popover
   * hanging below it used to run under the keyboard, out of reach (Joost's
   * recording, 2026-09-22). Fit it into the room between its button and the
   * keyboard; if there is more room above the button, open it upwards
   * instead. Whatever still does not fit scrolls inside the popover.
   */
  private keepPopoverAboveKeyboard(anchor: HTMLElement): void {
    const popover = this.popover;
    if (!popover) return;
    // Beside an upright pill it is kept on screen as the others are.
    if (popover.hasClass("opens-right") || popover.hasClass("opens-left")) {
      this.keepPopoverInside(anchor);
      return;
    }
    const hostBox = this.host.getBoundingClientRect();
    const anchorBox = anchor.getBoundingClientRect();
    const floor =
      Math.min(hostBox.bottom, winOf(this.barEl).innerHeight - keyboardHeight()) - EDGE_INSET;
    const below = floor - (anchorBox.bottom + 8);
    const above = anchorBox.top - 8 - (hostBox.top + EDGE_INSET);
    const height = popover.offsetHeight;
    if (height <= below) return;
    if (above > below) {
      const room = Math.min(height, above);
      popover.addClass("opens-up");
      popover.setCssStyles({
        top: `${Math.round(anchorBox.top - 8 - room - hostBox.top)}px`,
        bottom: "auto",
        maxHeight: `${Math.round(room)}px`,
      });
      return;
    }
    popover.setCssStyles({ maxHeight: `${Math.max(96, Math.round(below))}px` });
  }

  private renderTextColors(body: HTMLElement): void {
    body.createDiv({ cls: "goodobsidian-popover-label", text: t("toolbar.text.colourLabel") });
    renderColorPicker(body, {
      shown: (color) => this.shown(color, false),
      current: this.shownTextStyle().color,
      extra: this.pickerExtras(this.shownTextStyle().color),
      recent: this.state.recentColors ?? [],
      notebook: this.callbacks.notebookColors?.() ?? [],
      onPick: (color) => {
        if (color) this.pickText({ color });
      },
      onCustom: (color) => {
        this.rememberColor(color);
        this.pickText({ color });
      },
      onEyedropper: this.eyedropper((color) => this.pickText({ color })),
    });
  }

  private renderTextSizes(body: HTMLElement): void {
    const current = this.shownTextStyle().fontSize;
    // Any size between the smallest and the largest, to one decimal, on a
    // slider above the usual sizes; the box follows it as it moves.
    const head = body.createDiv({ cls: "goodobsidian-width-head" });
    head.createDiv({ cls: "goodobsidian-popover-label", text: t("toolbar.text.size") });
    const readout = head.createDiv({
      cls: "goodobsidian-text-size-readout",
      text: String(Math.round(current * 10) / 10),
    });
    const slider = body.createDiv({
      cls: "goodobsidian-width-slider goodobsidian-text-size-slider",
    });
    const range = slider.createEl("input", {
      cls: "goodobsidian-width-range",
      type: "range",
      attr: { "aria-label": t("toolbar.text.fontSize") },
    });
    dragRange(range);
    range.min = "0";
    range.max = String(SIZE_SLIDER_STEPS);
    range.step = "1";
    range.value = String(sliderAtSize(current));
    syncRangeFill(range);
    range.addEventListener("input", () => {
      const fontSize = sizeAtSlider(Number(range.value));
      readout.setText(String(fontSize));
      syncRangeFill(range);
      this.callbacks.onTextSizePreview?.(fontSize);
    });
    range.addEventListener("change", () => {
      const fontSize = sizeAtSlider(Number(range.value));
      this.callbacks.onTextSizePreview?.(null);
      if (fontSize !== this.shownTextStyle().fontSize) this.applyTextPatch({ fontSize });
    });
    const grid = body.createDiv({ cls: "goodobsidian-text-grid" });
    for (const fontSize of TEXT_SIZES) {
      this.textOption(grid, "is-size", String(fontSize), () =>
        this.pickText({ fontSize }),
      ).toggleClass("is-active", fontSize === current);
    }
  }

  /**
   * The font menu (discussion #107): one list to scroll, each name in its
   * own face. The named family in use on top (marked when this device lacks
   * it), the six fonts every device has, then the device's own, read when
   * the menu opens. The loupe beside the heading opens a field that narrows
   * the list as it is typed in; Return takes the first name left. The field
   * takes the focus from the box being styled, which stays the one being
   * edited and gets it back once the field is done (`onTextFieldDone`). A
   * family is shown over the typeface it was picked on, which is what a
   * device without it shows.
   */
  private renderTextFonts(body: HTMLElement): void {
    const style = this.shownTextStyle();
    const current = fontOf(style);
    const family = style.family;
    const head = body.createDiv({ cls: "goodobsidian-font-head" });
    head.createDiv({ cls: "goodobsidian-popover-label", text: t("toolbar.text.font") });
    const list = body.createDiv({ cls: "goodobsidian-font-list" });
    let query = "";
    const fill = (): void => {
      list.empty();
      const shown = (name: string): boolean => matchesFamily(name, query);
      if (family && shown(family)) {
        const button = this.textOption(list, "is-wide is-family is-active", family, () =>
          this.closePopover(),
        );
        button.setCssStyles({ fontFamily: fontFamilyOf(style) });
        this.markFamily(button, family, TEXT_FONT_LABELS[current], fill);
      }
      for (const font of TEXT_FONTS) {
        if (!shown(TEXT_FONT_LABELS[font])) continue;
        const button = this.textOption(list, "is-wide", TEXT_FONT_LABELS[font], () =>
          this.pickText({ font, family: null }),
        );
        button.setCssStyles({ fontFamily: TEXT_FONT_STACKS[font] });
        button.toggleClass("is-active", !family && font === current);
      }
      const families = this.deviceFonts;
      const mine = families?.filter((name) => shown(name) && name !== family) ?? [];
      // Fonts of this device alone: another device may show the box in its fallback.
      if (!families || mine.length > 0) {
        list.createDiv({ cls: "goodobsidian-popover-label", text: t("toolbar.font.onDevice") });
      }
      if (!families) list.createDiv({ cls: "goodobsidian-font-busy" });
      for (const name of mine) {
        const button = this.textOption(list, "is-wide", name, () =>
          this.pickText({ family: name }),
        );
        button.setCssStyles({ fontFamily: familyStack(name, TEXT_FONT_STACKS[current]) });
      }
      if (list.childElementCount === 0) {
        list.createDiv({ cls: "goodobsidian-font-none", text: t("toolbar.font.none") });
      }
    };
    fill();
    // Read from the tap that opened the menu: the desktop app's font list needs one.
    if (!this.deviceFonts) {
      void deviceFamilies().then((families) => {
        this.deviceFonts = families;
        if (!list.isConnected) return;
        fill();
        this.popoverRefit?.();
      });
    }
    const loupe = head.createEl("button", {
      cls: "goodobsidian-font-search clickable-icon",
      attr: { "aria-label": t("toolbar.font.search"), title: t("toolbar.font.search") },
    });
    setIcon(loupe, "search");
    loupe.addEventListener("click", () => {
      loupe.remove();
      const field = head.createEl("input", {
        cls: "goodobsidian-font-field",
        attr: {
          type: "search",
          placeholder: t("toolbar.font.namePlaceholder"),
          "aria-label": t("toolbar.font.search"),
          enterkeyhint: "go",
          autocomplete: "off",
          autocapitalize: "off",
          spellcheck: "false",
          // The box being styled keeps editing while this has the focus.
          "data-goodobsidian-keeps-text": "",
        },
      });
      field.addEventListener("input", () => {
        query = field.value;
        fill();
        list.scrollTop = 0;
      });
      onEnterKey(field, () => list.querySelector<HTMLButtonElement>("button")?.click());
      field.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        this.closePopover();
      });
      field.addEventListener("blur", (event) => this.textFieldDone(event.relatedTarget));
      if (this.popover) {
        this.popoverKeyboard = new DialogKeyboard(this.popover, { pad: true });
        this.popoverKeyboard.watch(field, head);
      }
      this.textFieldOpen = true;
      field.focus();
    });
  }

  /** The font search let go of the focus: the box it took it from gets it back. */
  private textFieldDone(to: EventTarget | null): void {
    if (!this.textFieldOpen) return;
    this.textFieldOpen = false;
    this.callbacks.onTextFieldDone?.(isElement(to) ? to : null);
  }

  /** The named styles, each shown in its own look; a pick applies it and closes. */
  private renderTextPresets(body: HTMLElement): void {
    body.createDiv({ cls: "goodobsidian-popover-label", text: t("toolbar.text.styleLabel") });
    const list = body.createDiv({ cls: "goodobsidian-text-presets" });
    const current = presetOf(this.shownTextStyle());
    for (const preset of TEXT_PRESETS) {
      const look = withTextStyle(DEFAULT_TEXT_STYLE, preset.patch);
      const button = list.createEl("button", {
        cls: "goodobsidian-text-preset clickable-icon",
        text: preset.name,
        attr: { "aria-label": preset.name, "aria-pressed": String(current?.id === preset.id) },
      });
      button.toggleClass("is-active", current?.id === preset.id);
      // Shown as it will look, capped so the list stays a list.
      button.setCssStyles({
        fontFamily: TEXT_FONT_STACKS[fontOf(look)],
        fontSize: `${Math.min(26, Math.max(12, look.fontSize * 0.7))}px`,
        fontWeight: look.bold ? "700" : "400",
        fontStyle: look.italic ? "italic" : "normal",
        textTransform: look.caps ? "uppercase" : "none",
        letterSpacing: look.caps ? "0.06em" : "normal",
      });
      button.addEventListener("click", () => this.pickText(preset.patch));
    }
  }

  private renderTextFormat(body: HTMLElement): void {
    body.createDiv({ cls: "goodobsidian-popover-label", text: t("toolbar.text.styleLabel") });
    const row = body.createDiv({ cls: "goodobsidian-text-row" });
    const style = this.shownTextStyle();
    const flags = [
      { key: "bold", glyph: "B", label: t("toolbar.text.bold") },
      { key: "italic", glyph: "I", label: t("toolbar.text.italic") },
      { key: "underline", glyph: "U", label: t("toolbar.text.underline") },
      { key: "strike", glyph: "S", label: t("toolbar.text.strike") },
      { key: "caps", glyph: "AA", label: t("toolbar.text.caps") },
    ] as const;
    for (const flag of flags) {
      const on = style[flag.key] === true;
      // A toggle: the popover stays open so several can be set in a row.
      const button = this.textOption(row, `is-flag is-${flag.key}`, flag.glyph, () =>
        this.applyTextPatch(flagPatch(flag.key, !on)),
      );
      button.setAttribute("aria-label", flag.label);
      button.setAttribute("title", flag.label);
      button.setAttribute("aria-pressed", String(on));
      button.toggleClass("is-active", on);
    }
    // Markdown mode (discussion #107): the text read as Markdown, raw while
    // it is typed, drawn formatted once the box is let go. A toggle like the
    // flags beside it, and kept for new boxes as they are.
    const markdown = style.markdown === true;
    const label = t("toolbar.text.markdown");
    const button = this.textOption(row, "is-flag is-markdown", "", () =>
      this.applyTextPatch({ markdown: !markdown }),
    );
    iconOrText(button, "hash", "#");
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    button.setAttribute("aria-pressed", String(markdown));
    button.toggleClass("is-active", markdown);
  }

  private renderTextAlign(body: HTMLElement): void {
    body.createDiv({ cls: "goodobsidian-popover-label", text: t("toolbar.text.alignment") });
    const row = body.createDiv({ cls: "goodobsidian-text-row" });
    const current = this.shownTextStyle().align ?? "left";
    for (const align of TEXT_ALIGNS) {
      const button = this.textOption(row, "is-flag", "", () => this.pickText({ align }));
      button.append(alignGlyph(align));
      button.setAttribute("aria-label", TEXT_ALIGN_LABELS[align]);
      button.setAttribute("title", TEXT_ALIGN_LABELS[align]);
      button.toggleClass("is-active", align === current);
    }
  }

  private renderTextSpacing(body: HTMLElement): void {
    body.createDiv({ cls: "goodobsidian-popover-label", text: t("toolbar.text.lineSpacing") });
    const current = lineHeightOf(this.shownTextStyle());
    for (const lineHeight of LINE_HEIGHTS) {
      // The default is a choice like any other; picking it removes the key.
      const label =
        lineHeight === DEFAULT_LINE_HEIGHT
          ? t("toolbar.text.lineSpacingDefault", { value: formatLineHeight(lineHeight) })
          : formatLineHeight(lineHeight);
      this.textOption(body, "is-wide", label, () => this.pickText({ lineHeight })).toggleClass(
        "is-active",
        Math.abs(lineHeight - current) < 1e-9,
      );
    }
  }

  private renderTextFills(body: HTMLElement): void {
    body.createDiv({ cls: "goodobsidian-popover-label", text: t("toolbar.text.boxFill") });
    renderColorPicker(body, {
      shown: (color) => this.shown(color, false),
      current: this.shownTextStyle().fill ?? null,
      allowNone: true,
      // The soft fills first-class: they are what a box is usually filled with.
      extra: TEXT_FILLS,
      recent: this.state.recentColors ?? [],
      notebook: this.callbacks.notebookColors?.() ?? [],
      onPick: (fill) => this.pickText({ fill }),
      onCustom: (fill) => {
        this.rememberColor(fill);
        this.pickText({ fill });
      },
      onEyedropper: this.eyedropper((fill) => this.pickText({ fill })),
    });
  }

  /**
   * The box's border: none or a width, rounded corners, and a colour. Each
   * choice applies at once and the popover stays open, so a border can be
   * set up in one visit.
   */
  private renderTextBorder(body: HTMLElement): void {
    const style = this.shownTextStyle();
    body.createDiv({ cls: "goodobsidian-popover-label", text: t("toolbar.text.border") });
    const row = body.createDiv({ cls: "goodobsidian-text-row" });
    const widths = [
      { label: t("toolbar.color.none"), width: null },
      ...TEXT_BORDER_CHOICES.map((width) => ({ label: `${width} px`, width })),
    ];
    for (const { label, width } of widths) {
      const button = this.textOption(row, "is-flag", "", () =>
        this.applyTextPatch({ borderWidth: width }),
      );
      button.append(borderWidthGlyph(width));
      const name =
        width === null
          ? t("toolbar.text.noBorder")
          : t("toolbar.text.borderWidth", { width: label });
      button.setAttribute("aria-label", name);
      button.setAttribute("title", name);
      const on = width === null ? !style.border : style.border?.width === width;
      button.setAttribute("aria-pressed", String(on));
      button.toggleClass("is-active", on);
    }
    body.createDiv({ cls: "goodobsidian-popover-label", text: t("toolbar.text.corners") });
    const corners = body.createDiv({ cls: "goodobsidian-text-row" });
    for (const { label, radius } of TEXT_CORNER_CHOICES) {
      const on = radius === 0 ? style.radius === undefined : style.radius === radius;
      const button = this.textOption(corners, "is-flag", "", () =>
        this.applyTextPatch({ radius: radius === 0 ? null : radius }),
      );
      button.append(cornerGlyph(radius));
      button.setAttribute("aria-label", t("toolbar.text.cornersValue", { name: label }));
      button.setAttribute("title", t("toolbar.text.cornersValue", { name: label }));
      button.setAttribute("aria-pressed", String(on));
      button.toggleClass("is-active", on);
    }
    body.createDiv({ cls: "goodobsidian-popover-label", text: t("toolbar.text.padding") });
    const paddings = body.createDiv({ cls: "goodobsidian-text-row" });
    for (const { label, padding } of TEXT_PADDINGS) {
      const on = padding === 0 ? style.padding === undefined : style.padding === padding;
      const button = this.textOption(paddings, "is-flag is-padding", label, () =>
        this.applyTextPatch({ padding: padding === 0 ? null : padding }),
      );
      button.setAttribute(
        "aria-label",
        padding === 0
          ? t("toolbar.text.noPadding")
          : t("toolbar.text.paddingValue", { name: label }),
      );
      button.setAttribute("aria-pressed", String(on));
      button.toggleClass("is-active", on);
    }
    body.createDiv({ cls: "goodobsidian-popover-label", text: t("toolbar.text.borderColour") });
    const current = style.border?.color ?? style.color;
    // A colour picked with no border adds a thin one in that colour.
    renderColorPicker(body, {
      shown: (color) => this.shown(color, false),
      current: style.border ? current : null,
      extra: this.pickerExtras(current),
      recent: this.state.recentColors ?? [],
      notebook: this.callbacks.notebookColors?.() ?? [],
      onPick: (color) => {
        if (color) this.applyTextPatch({ borderColor: color });
      },
      onCustom: (color) => {
        this.rememberColor(color);
        this.applyTextPatch({ borderColor: color });
      },
      onEyedropper: this.eyedropper((color) => this.applyTextPatch({ borderColor: color })),
    });
  }

  private renderTextLists(body: HTMLElement): void {
    body.createDiv({ cls: "goodobsidian-popover-label", text: t("toolbar.text.lists") });
    const row = body.createDiv({ cls: "goodobsidian-text-row" });
    const kinds: Array<{ kind: ListKind; label: string }> = [
      { kind: "bullet", label: t("toolbar.text.bullets") },
      { kind: "number", label: t("toolbar.text.numbering") },
      { kind: "task", label: t("toolbar.text.checklist") },
    ];
    for (const { kind, label } of kinds) {
      const button = this.textOption(row, "is-flag", "", () => {
        this.closePopover();
        this.callbacks.onTextList?.(kind);
      });
      button.append(listGlyph(kind));
      button.setAttr("aria-label", label);
      button.setAttribute("title", label);
    }
  }

  private choosePenType(spec: PenTypeSpec): void {
    // Each pen type keeps its own colour, row and width (GoodNotes): the one
    // being left keeps what it wrote with, the one picked brings back its own.
    const from = this.activePenType().id;
    if (from !== spec.id) {
      const { color, size } = this.state;
      const step = switchPenInk(this.state.penInks ?? {}, from, spec.id, this.inkInHand());
      this.state.penInks = step.inks;
      this.callbacks.onPenInks?.(step.inks);
      if (step.ink.colors) {
        this.state.penColors = step.ink.colors;
        this.callbacks.onPenColors?.(step.ink.colors);
      }
      if (step.ink.color !== color) {
        this.state.color = step.ink.color;
        this.callbacks.onColorChange(step.ink.color);
      }
      if (step.ink.size !== undefined && step.ink.size !== size) {
        this.state.size = step.ink.size;
        this.callbacks.onSizeChange(step.ink.size);
      }
    }
    this.state.penType = spec.id;
    if (this.state.tool !== spec.tool) {
      this.state.tool = spec.tool;
      this.callbacks.onToolChange(spec.tool);
    }
    const pressure = spec.pressure && this.callbacks.pressureAllowed?.() === true;
    this.state.pressureEnabled = pressure;
    this.callbacks.onPressureToggle(pressure);
    this.callbacks.onPenTypeChange?.(spec);
    this.buildOptions();
    this.syncActive();
  }

  /** The pen type in hand's width presets (FineNotes#210): each keeps its own width. */
  private widthPresets(): number[] {
    return presetsFor(this.state.widthPresets ?? {}, this.activePenType().id);
  }

  /** The width preset holding the width in hand, or `null` when none does (a saved pen's). */
  private chosenWidthSlot(): number | null {
    this.widthSlot = chosenSlot(this.widthPresets(), this.state.size, this.widthSlot);
    return this.widthSlot;
  }

  /** Write with preset `slot`'s width; the slider now changes that preset. */
  private pickWidthPreset(slot: number): void {
    const width = this.widthPresets()[slot];
    if (width === undefined) return;
    this.widthSlot = slot;
    this.setWidth(width);
  }

  /**
   * A width from the slider or the mm field: the chosen preset becomes it,
   * the others keep theirs. With none chosen, only the width in hand changes.
   */
  private editWidth(width: number): void {
    const slot = this.chosenWidthSlot();
    if (slot !== null) {
      this.state.widthPresets = withWidthPreset(
        this.state.widthPresets ?? {},
        this.activePenType().id,
        slot,
        width,
      );
      this.callbacks.onWidthPresets?.(this.state.widthPresets);
    }
    this.setWidth(width);
  }

  /** The reset: the pen type's presets back to the defaults, and the chosen one's width in hand. */
  private resetWidthPresets(): void {
    const slot = this.chosenWidthSlot();
    this.state.widthPresets = withoutWidthPresets(
      this.state.widthPresets ?? {},
      this.activePenType().id,
    );
    this.callbacks.onWidthPresets?.(this.state.widthPresets);
    const width =
      slot !== null
        ? DEFAULT_WIDTH_PRESETS[slot]
        : (this.options.defaultSize ?? DEFAULT_WIDTH_PRESETS[1]);
    this.widthSlot = slot;
    this.setWidth(width);
  }

  /** The eraser's preset sizes. */
  private eraserPresets(): number[] {
    return eraserPresetsOf(this.state.eraserPresets);
  }

  /** The eraser preset holding the size in hand, or `null` when none does. */
  private chosenEraserSlot(): number | null {
    this.eraserSlot = chosenSlot(this.eraserPresets(), eraserSizeFor(this.state), this.eraserSlot);
    return this.eraserSlot;
  }

  /** Erase with preset `slot`'s size; the slider now changes that preset. */
  private pickEraserPreset(slot: number): void {
    const size = this.eraserPresets()[slot];
    if (size === undefined) return;
    this.eraserSlot = slot;
    this.setEraserSize(size);
  }

  /** A size from the slider: the chosen preset becomes it, as {@link editWidth}. */
  private editEraserSize(size: number): void {
    const slot = this.chosenEraserSlot();
    const clamped = clampEraserSize(size);
    if (slot !== null) {
      this.state.eraserPresets = withEraserPreset(this.eraserPresets(), slot, clamped);
      this.callbacks.onEraserPresets?.(this.state.eraserPresets);
    }
    this.setEraserSize(clamped);
  }

  /** The reset: the eraser's presets back to the defaults, and the chosen one's size in hand. */
  private resetEraserPresets(): void {
    const slot = this.chosenEraserSlot();
    this.state.eraserPresets = eraserPresetsOf(undefined);
    this.callbacks.onEraserPresets?.(this.state.eraserPresets);
    this.eraserSlot = slot;
    this.setEraserSize(slot !== null ? this.state.eraserPresets[slot] : DEFAULT_ERASER_SIZE);
  }

  /** The settings' own colours, which keep their slots in the pen's row. */
  private reservedColors(): string[] {
    return reservedPenColors(this.options.reservedColors ?? []);
  }

  /**
   * The pen's colour row: the reserved colours, then the picked ones, topped
   * up from the palette (white left out: it is for dark paper, in the picker).
   * A live colour chosen elsewhere shows in the first picked slot.
   */
  private quickColors(): string[] {
    const reserved = this.reservedColors();
    const fill = this.palette.filter((color) => color.toLowerCase() !== "#ffffff");
    const row = penColorRow(reserved, this.state.penColors, fill);
    return [...reserved, ...pickPenColor(row, reserved.length, this.state.color)];
  }

  private chevron(label: string, onClick: (button: HTMLButtonElement) => void): HTMLButtonElement {
    const button = this.optionsEl.createEl("button", { cls: "goodobsidian-chevron" });
    iconOrText(button, "chevron-down", label);
    button.setAttr("aria-label", label);
    button.addEventListener("click", () => onClick(button));
    return button;
  }

  // --- Popovers -------------------------------------------------------------

  private toggleWidthList(anchor: HTMLElement): void {
    if (this.popoverKind === "widths") {
      this.closePopover();
      return;
    }
    const body = this.openPopover("widths", anchor);
    body.addClass("goodobsidian-width-popover");
    // GoodNotes' Stroke Settings: the width in millimetres (a pen stroke has
    // the same real thickness on every paper size), a reset, a slider whose
    // track widens like the stroke does, and the presets.
    const head = body.createDiv({ cls: "goodobsidian-width-head" });
    head.createDiv({ cls: "goodobsidian-popover-label", text: t("toolbar.width.title") });
    // The width as a field: any width from the thinnest pen to 5 mm can be
    // typed, to a hundredth of a mm (FineNotes#24).
    const readout = head.createDiv({ cls: "goodobsidian-width-readout" });
    const field = readout.createEl("input", {
      cls: "goodobsidian-width-field",
      type: "text",
      attr: {
        inputmode: "decimal",
        spellcheck: "false",
        autocomplete: "off",
        "aria-label": t("toolbar.width.mmLabel"),
      },
    });
    readout.createSpan({ cls: "goodobsidian-width-unit", text: "mm" });
    const reset = head.createEl("button", {
      cls: "goodobsidian-width-reset clickable-icon",
      attr: { "aria-label": t("toolbar.width.reset"), title: t("toolbar.width.reset") },
    });
    iconOrText(reset, "rotate-ccw", t("toolbar.reset"));
    const slider = body.createDiv({ cls: "goodobsidian-width-slider" });
    const range = slider.createEl("input", {
      cls: "goodobsidian-width-range",
      type: "range",
      attr: { "aria-label": t("toolbar.width.title") },
    });
    dragRange(range);
    // Stops, not widths: the pens' fine end steps in 0.05 mm, the rest in
    // half px (FineNotes#7). The highlighter keeps the thinnest preset.
    const highlighter =
      this.state.tool !== "shape" && penTypeFor(this.state).tool === "highlighter";
    const floor = highlighter ? Math.min(...this.widths) : 0;
    const stops = widthStops(this.widths, !highlighter);
    range.min = "0";
    range.max = String(stops.length - 1);
    range.step = "1";
    const preview = strokePreview(body, this.callbacks.paintSizePaper);
    const row = body.createDiv({ cls: "goodobsidian-sizes" });
    // By slot: each preset keeps its own width, and the chosen one follows the slider.
    const presets = new Map<number, HTMLElement>();
    const drawPresets = (): void => {
      const widths = this.widthPresets();
      const marks = this.widthMarks(widths);
      const pen = this.activePenType().id;
      for (const [slot, preset] of presets) {
        const width = widths[slot];
        preset.querySelector("svg")?.replaceWith(widthGlyph(marks.get(width), pen));
        preset.setAttribute("aria-label", t("toolbar.width.value", { mm: this.widthMm(width) }));
        preset.setAttribute("title", this.widthMm(width));
      }
    };
    // The readout, the thumb, the preview and the presets always show the live width.
    const show = (): void => {
      const width = chosenWidth(this.state.size, floor);
      // In mm of ink on the page: a highlighter's band, not the width before its 4x.
      if (activeDocument.activeElement !== field) field.value = mmText(width, this.inkScale());
      field.setAttribute("title", this.widthMm(width));
      range.value = String(nearestStop(stops, width));
      syncRangeFill(range);
      drawPresets();
      markChosen(presets, this.chosenWidthSlot());
      const color =
        this.state.tool === "shape"
          ? (this.state.shapeColor ?? DEFAULT_SHAPE_COLOR)
          : this.state.color;
      // A shape's outline is one even line, whatever pen is chosen.
      const pen = this.state.tool === "shape" ? "ball" : this.activePenType().id;
      preview(strokeWidthFor(this.state) * this.previewScales().pen, this.shown(color), pen);
    };
    // A new width for the chosen preset, from the slider or the field.
    const edit = (width: number): void => {
      this.editWidth(width);
      show();
    };
    // After a preset, an edit or a reset, the pill's widths are drawn again.
    const settle = (): void => {
      this.buildOptions();
      this.syncActive();
    };
    const first = this.widthPresets();
    const firstMarks = this.widthMarks(first);
    first.forEach((width, slot) => {
      const preset = widthButton(
        row,
        this.widthMm(width),
        this.activePenType().id,
        firstMarks.get(width),
        () => {
          this.pickWidthPreset(slot);
          show();
          this.closePopover();
          settle();
        },
      );
      presets.set(slot, preset);
    });
    // The zoom changed under the open popover: its marks follow the ink.
    this.sizeMarksRender = show;
    // Live while dragging; the pill's widths follow once the thumb is let go.
    range.addEventListener("input", () => edit(stops[Number(range.value)] ?? this.state.size));
    range.addEventListener("change", settle);
    reset.addEventListener("click", () => {
      this.resetWidthPresets();
      show();
      settle();
    });
    const typed = (): void => {
      const width = widthFromMm(field.value, this.inkScale());
      field.toggleClass("is-invalid", width === null);
      if (width === null) return;
      edit(width);
      field.value = mmText(chosenWidth(this.state.size, floor), this.inkScale());
      settle();
    };
    field.addEventListener("change", typed);
    onEnterKey(field, typed);
    if (this.popover) {
      this.popoverKeyboard = new DialogKeyboard(this.popover);
      this.popoverKeyboard.watch(field, head);
    }
    show();
  }

  /**
   * How thick a width's mark is drawn, screen px: the stroke it lays down
   * with the pen in hand (its pen type's multiplier included), at the zoom
   * now, so the mark is the line it writes beside it.
   */
  private widthMark(width: number): number {
    return strokeWidthFor({ ...this.state, size: width }) * this.previewScales().pen;
  }

  /**
   * The pen type's multiplier on the chosen width (a highlighter's 4): the
   * mm the width controls show and take are the ink's, chosen width times
   * this. A shape's outline is drawn at the chosen width.
   */
  private inkScale(): number {
    return this.state.tool === "shape" ? 1 : penTypeFor(this.state).sizeScale;
  }

  /** A preset width as its button names it: the ink's width on the page, in mm. */
  private widthMm(width: number): string {
    return formatMm(strokeWidthFor({ ...this.state, size: width }));
  }

  /**
   * One control's width marks (`widthMark`): true size while the thickest
   * fits its bar (`WIDTH_MARK_LIMIT`), else shrunk together, still solid
   * (`fitMarks`).
   */
  private widthMarks(widths: readonly number[]): Map<number, SizeMark> {
    return fittedMarks(
      widths,
      widths.map((width) => this.widthMark(width)),
      WIDTH_MARK_LIMIT,
    );
  }

  /** How wide an eraser size's mark is drawn, screen px: its footprint on the page. */
  private eraserMark(size: number): number {
    return size * this.previewScales().eraser;
  }

  /** One control's eraser marks in `box` px squares, fitted as {@link widthMarks} are. */
  private eraserMarks(sizes: readonly number[], box: number): Map<number, SizeMark> {
    return fittedMarks(
      sizes,
      sizes.map((size) => this.eraserMark(size)),
      box,
    );
  }

  /**
   * An eraser size in millimetres of paper it erases. The eraser's size is
   * the paper's, so this is the same at every zoom (the host's eraser scale
   * equals its pen scale); a host that scales them apart still gets the truth.
   */
  private eraserMm(size: number): string {
    const { pen, eraser } = this.previewScales();
    return formatMm((size * eraser) / pen);
  }

  /**
   * Redraw every width and eraser-size mark at its true size: the zoom or
   * the pane's width changed, and the ink on the page with it.
   */
  refreshSizeMarks(): void {
    const pen = this.activePenType().id;
    const widths = this.widthMarks([...this.widthButtonSizes.values()]);
    for (const [slot, button] of this.widthButtons) {
      const width = this.widthButtonSizes.get(slot) ?? NaN;
      button.querySelector("svg")?.replaceWith(widthGlyph(widths.get(width), pen));
    }
    const presets = this.eraserPresets();
    const sizes = this.eraserMarks(presets, PILL_ERASER_BOX);
    for (const [slot, button] of this.eraserSizeButtons) {
      const size = presets[slot];
      button.querySelector("svg")?.replaceWith(eraserSizeGlyph(sizes.get(size), PILL_ERASER_BOX));
      button.setAttribute("aria-label", t("toolbar.eraser.sizeValue", { mm: this.eraserMm(size) }));
    }
    this.sizeMarksRender?.();
  }

  /** Screen px per page px for the size previews (1 : 1 without a host that knows). */
  private previewScales(): { pen: number; eraser: number } {
    const scales = this.callbacks.sizePreviewScales?.();
    const ok = (n: number | undefined): number =>
      n !== undefined && Number.isFinite(n) && n > 0 ? n : 1;
    return { pen: ok(scales?.pen), eraser: ok(scales?.eraser) };
  }

  /** A new pen width, from a preset, the slider or a reset. */
  /** Write with `width` (page px, before the pen type's multiplier); the pen type keeps it. */
  private setWidth(width: number): void {
    this.state.size = width;
    this.callbacks.onSizeChange(width);
    this.keepPenInk();
  }

  /**
   * The eraser's size: a readout, a reset, a slider from a fine tip to a wide
   * band, and the presets, laid out like the pen's "Stroke width".
   */
  private toggleEraserSizeList(anchor: HTMLElement): void {
    if (this.popoverKind === "eraser-size") {
      this.closePopover();
      return;
    }
    const body = this.openPopover("eraser-size", anchor);
    body.addClass("goodobsidian-width-popover");
    const head = body.createDiv({ cls: "goodobsidian-width-head" });
    head.createDiv({ cls: "goodobsidian-popover-label", text: t("toolbar.eraser.size") });
    const readout = head.createSpan({ cls: "goodobsidian-width-readout" });
    const reset = head.createEl("button", {
      cls: "goodobsidian-width-reset clickable-icon",
      attr: { "aria-label": t("toolbar.eraser.reset"), title: t("toolbar.eraser.reset") },
    });
    iconOrText(reset, "rotate-ccw", t("toolbar.reset"));
    const slider = body.createDiv({ cls: "goodobsidian-width-slider" });
    const range = slider.createEl("input", {
      cls: "goodobsidian-width-range",
      type: "range",
      attr: { "aria-label": t("toolbar.eraser.size") },
    });
    dragRange(range);
    const stops = eraserStops();
    range.min = "0";
    range.max = String(stops.length - 1);
    range.step = "1";
    const preview = eraserPreview(body, this.callbacks.paintSizePaper);
    const row = body.createDiv({ cls: "goodobsidian-sizes" });
    // By slot: each preset keeps its own size, and the chosen one follows the slider.
    const presets = new Map<number, HTMLElement>();
    const drawPresets = (): void => {
      const sizes = this.eraserPresets();
      const marks = this.eraserMarks(sizes, POPOVER_ERASER_BOX);
      for (const [slot, preset] of presets) {
        const size = sizes[slot];
        preset.empty();
        preset.append(eraserSizeGlyph(marks.get(size), POPOVER_ERASER_BOX));
        preset.setAttribute(
          "aria-label",
          t("toolbar.eraser.sizeValue", { mm: this.eraserMm(size) }),
        );
        preset.setAttribute("title", this.eraserMm(size));
      }
    };
    // The readout, the thumb, the preview and the presets always show the live size.
    const show = (): void => {
      const size = eraserSizeFor(this.state);
      readout.setText(this.eraserMm(size));
      range.value = String(nearestStop(stops, size));
      syncRangeFill(range);
      drawPresets();
      markChosen(presets, this.chosenEraserSlot());
      preview(size * this.previewScales().eraser);
    };
    // After a preset, an edit or a reset, the pill's sizes are drawn again.
    const settle = (): void => {
      this.buildOptions();
      this.syncActive();
    };
    this.eraserPresets().forEach((_, slot) => {
      const preset = row.createEl("button", { cls: "goodobsidian-erasersize" });
      preset.addEventListener("click", () => {
        this.pickEraserPreset(slot);
        show();
        this.closePopover();
        settle();
      });
      presets.set(slot, preset);
    });
    this.sizeMarksRender = show;
    // Live while dragging; the pill follows once the thumb is let go.
    range.addEventListener("input", () => {
      this.editEraserSize(stops[Number(range.value)] ?? eraserSizeFor(this.state));
      show();
    });
    range.addEventListener("change", settle);
    reset.addEventListener("click", () => {
      this.resetEraserPresets();
      show();
      settle();
    });
    show();
  }

  /** A new eraser size, from a quick size, a preset, the slider or a reset. */
  private setEraserSize(size: number): void {
    const clamped = clampEraserSize(size);
    this.state.eraserSize = clamped;
    this.callbacks.onEraserChange?.(eraserModeFor(this.state), clamped);
  }

  private toggleEraserModeList(anchor: HTMLElement): void {
    if (this.popoverKind === "eraser-mode") {
      this.closePopover();
      return;
    }
    const body = this.openPopover("eraser-mode", anchor);
    body.createDiv({ cls: "goodobsidian-popover-label", text: t("toolbar.tool.eraser") });
    for (const mode of ERASER_MODES) {
      const button = body.createEl("button", {
        cls: "goodobsidian-wide goodobsidian-erasermode-row",
      });
      eraserModeIcon(
        button.createSpan({ cls: "goodobsidian-erasermode-icon" }),
        mode.id,
        mode.label,
      );
      button.createSpan({ text: mode.label });
      button.toggleClass("is-active", mode.id === eraserModeFor(this.state));
      button.addEventListener("click", () => {
        this.closePopover();
        this.state.eraserMode = mode.id;
        this.callbacks.onEraserChange?.(mode.id, eraserSizeFor(this.state));
        this.buildOptions();
        this.syncActive();
      });
    }
    // How the modes that take ink whole show it going (discussion #51).
    const list = body.createDiv({ cls: "goodobsidian-switch-list" });
    this.switchRow(list, t("toolbar.eraser.greyOut"), this.state.eraserGrey === true, (on) => {
      this.state.eraserGrey = on;
      this.callbacks.onEraserGreyChange?.(on);
    });
    body.createDiv({ cls: "goodobsidian-popover-hint", text: t("toolbar.eraser.greyHint") });
  }

  /**
   * "Erase highlighter only" and "Erase pen only", as switches: at most one
   * is on, so turning one on turns the other off. Both off erases all ink.
   */
  private toggleEraserFilterList(anchor: HTMLElement): void {
    if (this.popoverKind === "eraser-filter") {
      this.closePopover();
      return;
    }
    const body = this.openPopover("eraser-filter", anchor);
    body.addClass("goodobsidian-eraser-filter");
    const set = (filter: EraserFilter): void => {
      this.state.eraserFilter = filter;
      this.callbacks.onEraserFilterChange?.(filter);
      this.buildOptions();
      this.popoverRender?.();
    };
    this.popoverRender = () => {
      body.empty();
      body.createDiv({
        cls: "goodobsidian-popover-label",
        text: t("toolbar.eraser.erasesHeading"),
      });
      const list = body.createDiv({ cls: "goodobsidian-switch-list" });
      const filter = eraserFilterFor(this.state);
      this.switchRow(list, t("toolbar.eraser.eraseHighlighter"), filter === "highlighter", (on) =>
        set(on ? "highlighter" : "all"),
      );
      this.switchRow(list, t("toolbar.eraser.erasePen"), filter === "pen", (on) =>
        set(on ? "pen" : "all"),
      );
      body.createDiv({
        cls: "goodobsidian-popover-hint",
        text: t("toolbar.eraser.neverErased"),
      });
    };
    this.popoverRender();
    this.keepPopoverInside(anchor);
  }

  /**
   * The pen menu, for a click of the pen's side button in the air
   * (`input/stylus-click.ts`): the pen menu opens, and the next click
   * closes it, or whichever popover is open then. It hangs from the pen type
   * button while the pen's options show, else from the pen on the bar.
   */
  togglePenMenu(): void {
    if (this.popover) {
      this.closePopover();
      return;
    }
    this.openPenMenu(this.penMenuAnchor());
  }

  /** What the pen menu hangs from: the pen type button on show, the bar's pen button, or ⋯. */
  private penMenuAnchor(): HTMLElement {
    const type = this.penTypeButtons.get(this.activePenType().id);
    if (type && !this.optionsEl.hasClass("is-collapsed")) return type;
    const pen = this.penToolButton;
    const onBar =
      pen !== null &&
      pen.isConnected &&
      !pen.hasClass("is-overflowed") &&
      !pen.hasClass("is-unlisted") &&
      pen.style.display !== "none";
    if (onBar) return pen;
    return this.moreButton ?? this.barEl;
  }

  /**
   * The pen's menu, from its ⌄, a tap on the pen in hand, or the side
   * button: the laser pointer, and the pen in hand's settings and the pen
   * gestures behind rows, each a page with a way back. The pen types
   * themselves are the row in the pen's bar.
   */
  private openPenMenu(anchor: HTMLElement): void {
    if (this.popoverKind === "pens") {
      this.closePopover();
      return;
    }
    const body = this.openPopover("pens", anchor);
    let page: "menu" | "settings" | "gestures" = "menu";
    this.popoverRender = () => {
      body.empty();
      this.popover?.toggleClass("is-pen-gestures", page !== "menu");
      const go =
        (to: typeof page): (() => void) =>
        () => {
          page = to;
          this.popoverRender?.();
        };
      if (page === "gestures") this.renderPenGestures(body, go("menu"));
      else if (page === "settings") this.renderPenSettings(body, go("menu"));
      else this.renderPenMenu(body, go("settings"), go("gestures"));
      this.keepPopoverInside(anchor);
    };
    this.popoverRender();
  }

  /** The colour pen type `spec` writes with: the live one in hand, else its own. */
  private inkColorOf(spec: PenTypeSpec): string {
    if (spec.id === this.activePenType().id) return this.state.color;
    return penInkFor(this.state.penInks ?? {}, spec.id, this.inkInHand()).color;
  }

  private renderPenMenu(
    body: HTMLElement,
    openSettings: () => void,
    openGestures: () => void,
  ): void {
    // The pen in hand's type as a button of its own on the bar, or off it
    // again (FineNotes#211). Not on a practice sheet, whose bar is fixed.
    if (this.callbacks.onLayout && !this.practice) {
      const slot = penTypeSlot(this.activePenType().id);
      const on = placeOf(this.laid(), slot) !== "off";
      const pin = body.createEl("button", {
        cls: "goodobsidian-wide goodobsidian-pen-row goodobsidian-pen-pin-row",
      });
      iconOrText(
        pin.createSpan({ cls: "goodobsidian-laser-row-icon" }),
        on ? "pin-off" : "pin",
        "",
      );
      pin.createSpan({ text: on ? t("toolbar.pen.removeFromBar") : t("toolbar.pen.addToBar") });
      pin.addEventListener("click", () => {
        this.closePopover();
        this.togglePenSlot(slot);
      });
      body.createDiv({ cls: "goodobsidian-popover-divider" });
    }
    // The highlighter's tip, first: its one choice no other pen has.
    if (this.activePenType().tool === "highlighter" && this.renderHighlighterTip(body)) {
      body.createDiv({ cls: "goodobsidian-popover-divider" });
    }
    // The laser pointer has no bar button (FineNotes#25): here, and L.
    const laser = body.createEl("button", {
      cls: "goodobsidian-wide goodobsidian-pen-row goodobsidian-laser-row",
    });
    laser.toggleClass("is-active", this.state.tool === "laser");
    const laserIcon = laser.createSpan({ cls: "goodobsidian-laser-row-icon" });
    iconOrText(laserIcon, "pointer", "");
    laser.createSpan({ text: t("toolbar.tool.laserPointer") });
    laser.createEl("kbd", { cls: "goodobsidian-saved-pen-key", text: "L" });
    laser.addEventListener("click", () => {
      this.closePopover();
      this.leaveToolFor("laser");
      this.state.tool = "laser";
      this.callbacks.onToolChange("laser");
      this.buildOptions();
      this.syncActive();
    });
    body.createDiv({ cls: "goodobsidian-popover-divider" });
    this.popoverLink(body, t("toolbar.pen.settings"), "sliders-horizontal", openSettings);
    this.popoverLink(body, t("toolbar.pen.gestures"), "signature", openGestures);
  }

  /**
   * The highlighter's tip, round or a flat chisel (`ink/chisel.ts`), as two
   * symbols in one row. It shapes only the highlights drawn next: each stroke
   * keeps its own (`Stroke.tip`). False when the host keeps no setting.
   */
  private renderHighlighterTip(body: HTMLElement): boolean {
    const prefs = this.callbacks.penPreferences?.();
    const save = this.callbacks.onPenPreferences;
    if (!prefs || !save) return false;
    const row = body.createDiv({ cls: "goodobsidian-tip-row" });
    row.createDiv({ cls: "goodobsidian-popover-label", text: t("toolbar.highlighter.tip") });
    const tips = row.createDiv({
      cls: "goodobsidian-segmented is-icons",
      attr: { role: "radiogroup", "aria-label": t("toolbar.highlighter.tipGroup") },
    });
    const choices: ReadonlyArray<[HighlighterTip, string, string]> = [
      ["round", t("toolbar.highlighter.round"), "circle"],
      ["chisel", t("toolbar.highlighter.chisel"), "rectangle-vertical"],
    ];
    for (const [tip, label, icon] of choices) {
      const on = prefs.highlighterTip === tip;
      const button = tips.createEl("button", {
        cls: "clickable-icon",
        attr: { role: "radio", "aria-label": label, "aria-checked": String(on) },
      });
      iconOrText(button, icon, label);
      button.toggleClass("is-active", on);
      button.addEventListener("click", () => {
        save({ highlighterTip: tip });
        this.popoverRender?.();
      });
    }
    return true;
  }

  /** A row that opens another page of the popover: an icon, its name, and a chevron. */
  private popoverLink(body: HTMLElement, label: string, icon: string, open: () => void): void {
    const link = body.createEl("button", {
      cls: "goodobsidian-wide goodobsidian-popover-link clickable-icon",
    });
    const name = link.createSpan({ cls: "goodobsidian-popover-link-name" });
    iconOrText(name.createSpan({ cls: "goodobsidian-popover-link-icon" }), icon, "");
    name.createSpan({ text: label });
    iconOrText(link.createSpan({ cls: "goodobsidian-popover-link-icon" }), "chevron-right", ">");
    link.addEventListener("click", open);
  }

  /** A popover page's head: a back arrow, and the page's title centred. */
  private popoverPageHead(
    body: HTMLElement,
    title: string,
    backLabel: string,
    back: () => void,
  ): void {
    const head = body.createDiv({ cls: "goodobsidian-popover-head" });
    const backButton = head.createEl("button", {
      cls: "goodobsidian-popover-back clickable-icon",
    });
    iconOrText(backButton, "arrow-left", t("toolbar.back"));
    backButton.setAttribute("aria-label", backLabel);
    backButton.addEventListener("click", back);
    head.createDiv({ cls: "goodobsidian-popover-title", text: title });
  }

  /**
   * The pen in hand's own settings, behind "Pen settings" in the pen type
   * menu (the highlighter's opacity and straightening too, which were in
   * Obsidian's settings until 2.7), then two that hold for every pen: "Hide
   * pen options while writing" with its three choices, and "Back to the
   * pen" with its four, each one row with its choice in a dropdown.
   */
  private renderPenSettings(body: HTMLElement, back: () => void): void {
    this.popoverPageHead(
      body,
      t("toolbar.pen.settingsTitle", { name: this.activePenType().label }),
      t("toolbar.pen.backToTypes"),
      back,
    );
    this.renderStabilization(body);
    const prefs = this.callbacks.penPreferences?.();
    const save = this.callbacks.onPenPreferences;
    if (!prefs || !save) return;
    if (this.activePenType().tool === "highlighter") {
      this.renderHighlighterLook(body, prefs, save);
    }
    body.createDiv({ cls: "goodobsidian-popover-divider" });
    this.choiceMenu<PenOptionsOnWrite>(
      body,
      t("toolbar.pen.hideOptions"),
      PEN_OPTIONS_ON_WRITE.map((id) => [id, PEN_OPTIONS_ON_WRITE_NAMES[id]]),
      prefs.tuckOnWrite,
      (choice) => save({ tuckOnWrite: choice }),
    );
    this.choiceMenu<ReturnToPen>(
      body,
      t("toolbar.pen.backToPen"),
      [
        ["never", t("toolbar.pen.returnNever")],
        ["reselect", t("toolbar.pen.returnReselect")],
        ["after-use", t("toolbar.pen.returnAfterUse")],
        ["both", t("toolbar.pen.returnBoth")],
      ],
      prefs.returnToPen,
      (choice) => save({ returnToPen: choice }),
    );
    body.createDiv({
      cls: "goodobsidian-popover-hint",
      text: t("toolbar.pen.returnHint"),
    });
  }

  /**
   * The highlighter's opacity, 10-100%, and whether a stroke drawn along a
   * line straightens when the pen lifts. Opacity is how every highlight is
   * drawn, those on the page too, so it is saved when the slider is let go
   * rather than redrawing every page at each step.
   */
  private renderHighlighterLook(
    body: HTMLElement,
    prefs: PenPreferences,
    save: (patch: Partial<PenPreferences>) => void,
  ): void {
    body.createDiv({ cls: "goodobsidian-popover-divider" });
    const head = body.createDiv({ cls: "goodobsidian-width-head" });
    head.createDiv({ cls: "goodobsidian-popover-label", text: t("toolbar.highlighter.opacity") });
    const readout = head.createDiv({ cls: "goodobsidian-width-readout" });
    const slider = body.createDiv({ cls: "goodobsidian-width-slider" });
    const range = slider.createEl("input", {
      cls: "goodobsidian-width-range",
      type: "range",
      attr: { "aria-label": t("toolbar.highlighter.opacityLabel") },
    });
    dragRange(range);
    range.min = "10";
    range.max = "100";
    range.step = "5";
    const show = (percent: number): void => {
      range.value = String(percent);
      range.setAttribute("aria-valuetext", `${percent}%`);
      readout.setText(`${percent}%`);
      syncRangeFill(range);
    };
    show(Math.round(prefs.highlighterAlpha * 100));
    range.addEventListener("input", () => show(Number(range.value)));
    range.addEventListener("change", () => save({ highlighterAlpha: Number(range.value) / 100 }));
    const list = body.createDiv({ cls: "goodobsidian-switch-list" });
    this.switchRow(list, t("toolbar.highlighter.straighten"), prefs.straightHighlighter, (on) =>
      save({ straightHighlighter: on }),
    );
    this.switchRow(list, t("toolbar.highlighter.snapText"), prefs.highlighterSnapText, (on) =>
      save({ highlighterSnapText: on }),
    );
  }

  /**
   * One row: the label, and the choice in use in a dropdown that lists the
   * rest, as the template picker's size and colour do (Obsidian's own
   * `dropdown`; on the iPad the system's picker).
   */
  private choiceMenu<T extends string>(
    body: HTMLElement,
    label: string,
    choices: ReadonlyArray<[T, string]>,
    current: T,
    pick: (choice: T) => void,
  ): void {
    const row = body.createDiv({ cls: "goodobsidian-choice-row" });
    row.createDiv({ cls: "goodobsidian-popover-label", text: label });
    const select = row.createEl("select", {
      cls: "dropdown goodobsidian-choice-select",
      attr: { "aria-label": label },
    });
    for (const [choice, name] of choices) {
      select.createEl("option", { text: name, value: choice });
    }
    select.value = current;
    select.addEventListener("change", () => {
      const picked = choices.find(([choice]) => choice === select.value);
      if (picked) pick(picked[0]);
    });
  }

  /**
   * The pen in hand's "Stroke stabilization", 0-100%, which Goodnotes keeps
   * per pen (FineNotes discussion #30). It shapes only the strokes written
   * next (`ink/stroke-builder.ts`, `stabilizationReach`).
   */
  private renderStabilization(body: HTMLElement): void {
    const spec = this.activePenType();
    const head = body.createDiv({ cls: "goodobsidian-width-head" });
    head.createDiv({ cls: "goodobsidian-popover-label", text: t("toolbar.pen.stabilization") });
    const readout = head.createDiv({ cls: "goodobsidian-width-readout" });
    const slider = body.createDiv({ cls: "goodobsidian-width-slider" });
    const range = slider.createEl("input", {
      cls: "goodobsidian-width-range",
      type: "range",
      attr: { "aria-label": t("toolbar.pen.stabilizationFor", { name: spec.label }) },
    });
    dragRange(range);
    range.min = "0";
    range.max = "100";
    range.step = "1";
    const show = (percent: number): void => {
      range.value = String(percent);
      range.setAttribute("aria-valuetext", `${percent}%`);
      readout.setText(`${percent}%`);
      syncRangeFill(range);
    };
    show(stabilizationOf(this.state.penStabilization, spec.id));
    const save = this.callbacks.onPenStabilization;
    // A host that keeps no setting gets a slider that does nothing, greyed.
    range.disabled = !save;
    range.addEventListener("input", () => {
      const percent = Number(range.value);
      this.state.penStabilization = withStabilization(
        this.state.penStabilization,
        spec.id,
        percent,
      );
      save?.(this.state.penStabilization);
      show(percent);
    });
    body.createDiv({
      cls: "goodobsidian-popover-hint",
      text: t("toolbar.pen.stabilizationHint"),
    });
  }

  /**
   * The pill's Auto shape button: the same setting as Make shapes, flipped
   * between on lift and after a hold. The host stores it and gives it to
   * every open notebook, so the pen follows the button at once.
   */
  private toggleAutoShape(): void {
    const mode: SnapMode = this.state.snapMode === "auto" ? "hold" : "auto";
    this.state.snapMode = mode;
    this.callbacks.onPenPreferences?.({ snapMode: mode });
  }

  /**
   * "Make shapes": when a pen stroke snaps to a clean shape (never, after a
   * hold, or on lift too, the pill's Auto shape button), and under it the
   * curve bar, from straight-only to loose (FineNotes#84). The bar is hidden
   * while shapes are off, where it means nothing.
   */
  private renderMakeShapes(
    body: HTMLElement,
    prefs: PenPreferences,
    save: (patch: Partial<PenPreferences>) => void,
  ): void {
    // One card, as the switches below it: the choice, and its bar.
    const card = body.createDiv({ cls: "goodobsidian-switch-list" });
    const row = card.createDiv({ cls: "goodobsidian-make-shapes" });
    row.createDiv({ cls: "goodobsidian-popover-label", text: t("toolbar.pen.makeShapes") });
    const modes = row.createDiv({
      cls: "goodobsidian-segmented is-icons",
      attr: { role: "radiogroup", "aria-label": t("toolbar.pen.makeShapes") },
    });
    const choices: ReadonlyArray<[SnapMode, string]> = [
      ["disabled", t("common.off")],
      ["hold", t("toolbar.pen.makeShapesHold")],
      ["auto", t("toolbar.pen.makeShapesLift")],
    ];
    for (const [mode, label] of choices) {
      const on = prefs.snapMode === mode;
      const button = modes.createEl("button", {
        cls: "clickable-icon",
        attr: { role: "radio", "aria-label": label, "aria-checked": String(on) },
      });
      // On lift is the pill's Auto shape button: the same symbol for the same thing.
      if (mode === "auto") button.append(shapeGlyph("auto"));
      else setIcon(button, mode === "hold" ? "timer" : "ban");
      button.toggleClass("is-active", on);
      button.addEventListener("click", () => {
        this.state.snapMode = mode;
        save({ snapMode: mode });
        this.popoverRender?.();
      });
    }

    if (prefs.snapMode !== "disabled") {
      const bar = card.createDiv({ cls: "goodobsidian-snap-curve" });
      setIcon(bar.createSpan({ attr: { "aria-hidden": "true" } }), "minus");
      const range = bar.createDiv({ cls: "goodobsidian-width-slider" }).createEl("input", {
        cls: "goodobsidian-width-range",
        type: "range",
        attr: {
          "aria-label": t("toolbar.pen.snapCurve"),
          title: t("toolbar.pen.snapCurveTitle"),
        },
      });
      dragRange(range);
      setIcon(bar.createSpan({ attr: { "aria-hidden": "true" } }), "waves");
      range.min = "10";
      range.max = "100";
      range.step = "5";
      range.value = String(prefs.snapCurve);
      syncRangeFill(range);
      range.addEventListener("input", () => {
        const curve = Number(range.value);
        this.state.snapCurvatureThreshold = curve;
        save({ snapCurve: curve });
        syncRangeFill(range);
      });
    }
    body.createDiv({
      cls: "goodobsidian-popover-hint",
      text: t("toolbar.pen.makeShapesHint"),
    });
  }

  /**
   * GoodNotes' Pen Gestures page: Make shapes, Scribble to erase
   * (and whether it takes shapes and highlighter too), Scribble to fill and
   * Circle to lasso. The second switch is
   * greyed while the first is off, as GoodNotes has it.
   */
  private renderPenGestures(body: HTMLElement, back: () => void): void {
    this.popoverPageHead(body, t("toolbar.pen.gestures"), t("toolbar.pen.backToTypes"), back);

    const prefs = this.callbacks.penPreferences?.();
    const save = this.callbacks.onPenPreferences;
    if (prefs && save) this.renderMakeShapes(body, prefs, save);

    const gestures = penGesturesOf(this.state.penGestures);
    const set = (patch: Partial<PenGestures>): void => {
      this.state.penGestures = { ...penGesturesOf(this.state.penGestures), ...patch };
      this.callbacks.onPenGesturesChange?.(this.state.penGestures);
      this.popoverRender?.();
    };

    const scribble = body.createDiv({ cls: "goodobsidian-switch-list" });
    this.switchRow(scribble, t("toolbar.gesture.scribbleErase"), gestures.scribbleErase, (on) =>
      set({ scribbleErase: on }),
    );
    const all = this.switchRow(
      scribble,
      t("toolbar.gesture.eraseAll"),
      gestures.scribbleErase && gestures.scribbleErasesAll,
      (on) => set({ scribbleErasesAll: on }),
    );
    all.disabled = !gestures.scribbleErase;
    body.createDiv({
      cls: "goodobsidian-popover-hint",
      text: t("toolbar.gesture.scribbleEraseHint"),
    });

    const fill = body.createDiv({ cls: "goodobsidian-switch-list" });
    this.switchRow(fill, t("toolbar.gesture.scribbleFill"), gestures.scribbleFill, (on) =>
      set({ scribbleFill: on }),
    );
    body.createDiv({
      cls: "goodobsidian-popover-hint",
      text: t("toolbar.gesture.scribbleFillHint"),
    });

    const lasso = body.createDiv({ cls: "goodobsidian-switch-list" });
    this.switchRow(lasso, t("toolbar.gesture.circleLasso"), gestures.circleLasso, (on) =>
      set({ circleLasso: on }),
    );
    body.createDiv({
      cls: "goodobsidian-popover-hint",
      text: t("toolbar.gesture.circleLassoHint"),
    });
  }

  private openPopover(kind: string, anchor: HTMLElement): HTMLElement {
    this.closePopover();
    // Appended to the host, not to a bar: either bar would clip it.
    const popover = this.host.createDiv({ cls: "goodobsidian-popover" });
    popover.setAttribute("role", "dialog");
    popover.dataset.ignoreSwipe = "true";
    // Removed with the popover, so its listeners need no disposer.
    this.keepFocus(popover, false);
    const body = popover.createDiv({ cls: "goodobsidian-popover-body" });
    this.placePopover(popover, anchor);

    this.popover = popover;
    this.popoverKind = kind;
    this.growPopover(popover);
    // Once the caller has filled it, every popover is kept inside the view,
    // whether or not its caller asks again: some never did, and in iPad
    // Split View a pane is narrow enough for any of them to hang off it
    // (FineNotes#210). A text popover is placed by its own refit.
    queueMicrotask(() => {
      if (this.popover !== popover || !anchor.isConnected) return;
      if (this.popoverRefit) this.popoverRefit();
      else this.keepPopoverInside(anchor);
    });
    return body;
  }

  /**
   * Put `popover` beside `anchor`: toward the page from wherever the pill
   * rests (pill-dock-model.ts), placed by the edge it opens from, so its
   * size is not needed yet. Returns the side it opens toward.
   */
  private placePopover(popover: HTMLElement, anchor: HTMLElement): PopoverSide {
    const hostBox = this.host.getBoundingClientRect();
    const anchorBox = anchor.getBoundingClientRect();
    const side = this.popoverSideFor(anchor);
    const centreX = anchorBox.left - hostBox.left + anchorBox.width / 2;
    const centreY = anchorBox.top - hostBox.top + anchorBox.height / 2;
    for (const each of ["up", "left", "right"]) popover.removeClass(`opens-${each}`);
    popover.style.removeProperty("top");
    popover.style.removeProperty("bottom");
    if (side !== "down") popover.addClass(`opens-${side}`);
    if (side === "down") {
      popover.setCssStyles({
        left: `${Math.round(centreX)}px`,
        top: `${Math.round(anchorBox.bottom - hostBox.top + 8)}px`,
      });
    } else if (side === "up") {
      popover.setCssStyles({
        left: `${Math.round(centreX)}px`,
        bottom: `${Math.round(hostBox.bottom - anchorBox.top + 8)}px`,
      });
    } else {
      const edge = side === "right" ? anchorBox.right + 8 : anchorBox.left - 8;
      popover.setCssStyles({
        left: `${Math.round(edge - hostBox.left)}px`,
        top: `${Math.round(centreY)}px`,
      });
    }
    return side;
  }

  /**
   * Which way a popover opens from `anchor`: toward the page from the bar
   * and from the pill, wherever each rests; down from a pill floating by a
   * text box, whose own placing (`keepPopoverAboveKeyboard`) decides.
   */
  private popoverSideFor(anchor: HTMLElement): PopoverSide {
    if (this.barEl.contains(anchor)) return barMenuSide(this.barDock);
    if (!this.optionsEl.contains(anchor) || this.optionsEl.hasClass("is-anchored")) return "down";
    return popoverSide(this.pillDock);
  }

  private closePopover(): void {
    const kind = this.popoverKind;
    // The font search goes with it: the box it took the focus from takes it back.
    this.textFieldDone(null);
    this.popoverKeyboard?.end();
    this.popoverKeyboard = null;
    if (this.popover) this.shrinkPopover(this.popover);
    this.popover = null;
    this.popoverKind = null;
    this.popoverRender = null;
    this.popoverRefit = null;
    this.sizeMarksRender = null;
    // The sticky colours closed with a note still waiting (Escape, another
    // tool, the button again): it waits no more.
    if (kind === "sticky" && this.stickyButton?.hasClass("is-on")) {
      this.callbacks.onStickyCancel?.();
    }
  }

  /**
   * A popover grows from its anchor: scale 0.96 to 1, a fade and a 6 px
   * drop, on the house spring (0.3 s, no bounce). Its blur is off while it
   * moves (`is-moving`; a blurred layer is never faded) and comes back on a
   * timer as long as the spring. Under Reduce Motion it only fades.
   */
  private growPopover(popover: HTMLElement): void {
    if (typeof popover.animate !== "function") return;
    popover.addClass("is-moving");
    const reduced = prefersReducedMotion();
    const duration = reduced ? REDUCED_FADE_MS : springMs(POPOVER_IN);
    this.popoverGrow = reduced
      ? popover.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing: "ease-out" })
      : popover.animate(
          [
            { opacity: 0, scale: "0.96", translate: `0 ${-POPOVER_RISE}px` },
            { opacity: 1, scale: "1", translate: "0 0" },
          ],
          { duration, easing: this.curve(POPOVER_IN) },
        );
    window.clearTimeout(this.popoverGrowTimer);
    this.popoverGrowTimer = window.setTimeout(() => {
      this.popoverGrowTimer = 0;
      // At rest by now, whatever the animation clock says (it can lag).
      this.popoverGrow?.cancel();
      this.popoverGrow = null;
      if (this.popover === popover) popover.removeClass("is-moving");
    }, duration);
  }

  /**
   * A closing popover shrinks back towards its anchor in 0.2 s, starting
   * from wherever its grow had got to, so a quick close never jumps. It
   * takes no taps meanwhile and is removed on a timer, never on `finish`.
   */
  private shrinkPopover(popover: HTMLElement): void {
    const grow = this.popoverGrow;
    this.popoverGrow = null;
    window.clearTimeout(this.popoverGrowTimer);
    this.popoverGrowTimer = 0;
    if (typeof popover.animate !== "function") {
      popover.remove();
      return;
    }
    // Read before cancelling: mid-grow, these are the values on screen.
    const seen = getComputedStyle(popover);
    const from = { opacity: seen.opacity, scale: seen.scale, translate: seen.translate };
    grow?.cancel();
    popover.addClass("is-moving");
    popover.addClass("is-leaving");
    const reduced = prefersReducedMotion();
    const duration = reduced ? REDUCED_FADE_MS : springMs(POPOVER_OUT);
    const to = reduced
      ? { opacity: 0 }
      : { opacity: 0, scale: "0.96", translate: `0 ${-POPOVER_RISE}px` };
    popover.animate([reduced ? { opacity: from.opacity } : from, to], {
      duration,
      easing: reduced ? "ease-in" : this.curve(POPOVER_OUT),
      fill: "forwards",
    });
    const timer = window.setTimeout(() => {
      this.leavingPopovers.delete(popover);
      popover.remove();
    }, duration);
    this.leavingPopovers.set(popover, timer);
  }

  /**
   * Slide the open popover sideways until it is inside the host. It hangs
   * centred under its anchor, and the Table button sits at the far end of a
   * pill centred on the page, so in portrait on an iPad (an ~820 px pane)
   * the ~370 px picker would hang some 60 px off the right edge.
   */
  /**
   * Hold a popover to `room` px: its body scrolls inside the popover, so the
   * arrow outside the box is never clipped. Taller rooms leave it alone.
   */
  private limitPopoverHeight(popover: HTMLElement, room: number): void {
    const body = popover.querySelector<HTMLElement>(".goodobsidian-popover-body");
    if (!body) {
      if (popover.offsetHeight > room) popover.setCssStyles({ maxHeight: `${Math.round(room)}px` });
      return;
    }
    body.setCssStyles({ maxHeight: "", overflowY: "" });
    const chrome = popover.offsetHeight - body.offsetHeight;
    if (popover.offsetHeight <= room) return;
    body.setCssStyles({
      maxHeight: `${Math.max(120, Math.round(room - chrome))}px`,
      overflowY: "auto",
    });
  }

  private keepPopoverInside(anchor: HTMLElement): void {
    const popover = this.popover;
    if (!popover) return;
    const hostBox = this.host.getBoundingClientRect();
    const anchorBox = anchor.getBoundingClientRect();
    if (popover.hasClass("opens-right") || popover.hasClass("opens-left")) {
      // Beside an upright pill or bar it hangs centred on its button: slide
      // it up or down instead, inside the page area (clear of the tool bar),
      // the arrow still on the button. Worked out from where it rests, not
      // from its box: it is still growing in (scale, translate) when this
      // first runs, and a box read then put it 100 px above the view on the
      // iPad (CLAUDE.md ledger, "Measuring an element that is still gliding").
      // As wide as the room on the side it opens to (a narrow Split View pane).
      const besideX = popover.hasClass("opens-right")
        ? hostBox.right - EDGE_INSET - (anchorBox.right + 8)
        : anchorBox.left - 8 - (hostBox.left + EDGE_INSET);
      popover.setCssProps({ "--gob-popover-room": `${Math.round(Math.max(120, besideX))}px` });
      const area = this.pillArea(hostBox, 0);
      const top = area.top;
      const floor = Math.max(top, area.bottom - EDGE_INSET);
      const room = floor - top;
      this.limitPopoverHeight(popover, room);
      const height = Math.min(popover.offsetHeight, room);
      const centre = anchorBox.top - hostBox.top + anchorBox.height / 2;
      const lift = sideLift(centre, height, top, floor);
      popover.setCssProps({ "--gob-popover-arrow": `${Math.round(-lift)}px` });
      popover.setCssStyles({ top: `${Math.round(centre + lift)}px` });
      return;
    }
    // Above or below its button: as tall as the room on that side, and the
    // rows scroll past it (a bar with everything moved into More tools).
    const gap = 16;
    const roomVertical = popover.hasClass("opens-up")
      ? anchorBox.top - hostBox.top - EDGE_INSET - gap
      : hostBox.bottom - anchorBox.bottom - EDGE_INSET - gap;
    this.limitPopoverHeight(popover, roomVertical);
    // Slid sideways into the view, worked out from where it rests (centred
    // on its button, `offsetWidth`), never from its box: that box carries
    // the slide of an earlier call (the pen menu re-renders as its pages
    // change) and the grow's scale, and in iPad Split View the settings
    // page was left hanging off the pane's left edge (FineNotes#210).
    const room = Math.max(0, hostBox.width - 2 * EDGE_INSET);
    popover.setCssProps({ "--gob-popover-room": `${Math.round(room)}px` });
    const centre = anchorBox.left - hostBox.left + anchorBox.width / 2;
    const shift = sideLift(centre, popover.offsetWidth, EDGE_INSET, hostBox.width - EDGE_INSET);
    // A popover with an arrow keeps it pointing at the anchor.
    popover.setCssProps({ "--gob-popover-arrow": `${Math.round(-shift)}px` });
    popover.setCssStyles({ left: `${Math.round(centre + shift)}px` });
  }

  /** Dismiss the popover on an outside press or Escape. */
  private installDismiss(): void {
    const onDown = (event: PointerEvent): void => {
      if (!this.popover) return;
      // The tap that sticks the waiting note closes the colours once it lands (`setStickyArmed`).
      if (this.popoverKind === "sticky" && this.stickyButton?.hasClass("is-on")) return;
      const target = event.target as Node | null;
      if (
        target &&
        (this.popover.contains(target) ||
          this.barEl.contains(target) ||
          this.optionsEl.contains(target))
      ) {
        return;
      }
      this.closePopover();
      // On the page, the pen or mouse press that closed it only closes it: it writes nothing.
      const onPage = (target as Element | null)?.closest?.(".goodobsidian-scroll") != null;
      if (closingPressStops(event, onPage)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") this.closePopover();
    };
    // Capture phase: the drawing surface handles its own input below us.
    this.host.addEventListener("pointerdown", onDown, true);
    this.host.addEventListener("keydown", onKey);
    this.disposers.push(() => {
      this.host.removeEventListener("pointerdown", onDown, true);
      this.host.removeEventListener("keydown", onKey);
    });
  }

  // --- Placing the options pill --------------------------------------------

  // --- Placing the tool bar ------------------------------------------------

  /**
   * Show the bar at its place: its edge as a class on the bar (`is-dock-*`,
   * `is-upright`, and `data-dock` for the menus that open from it,
   * `menuSideOf`) and on the view, whose layout gives it that edge
   * (styles.css, "The tool bar at another edge").
   */
  private applyBarDock(): void {
    const dock = this.barDock;
    for (const edge of ["top", "bottom", "left", "right"] as const) {
      this.barEl.toggleClass(`is-dock-${edge}`, edge === dock);
      this.host.toggleClass(`goodobsidian-bar-at-${edge}`, edge === dock);
    }
    this.barEl.toggleClass("is-upright", isBarUpright(dock));
    this.barEl.setAttribute("data-dock", dock);
  }

  /** A box's span along the bar: across the screen for a bar along an edge, down it upright. */
  private barAxis(): (box: DOMRect) => { start: number; end: number; length: number } {
    return isBarUpright(this.barDock)
      ? (box) => ({ start: box.top, end: box.bottom, length: box.height })
      : (box) => ({ start: box.left, end: box.right, length: box.width });
  }

  /**
   * With "Dock tool options" on, the pill rests by the bar, wherever the bar
   * is: a column beside a bar at a side, a row under or over one along an
   * edge. Off again, it goes back to where it was left. A pill carried
   * elsewhere meanwhile floats there (`pillRowEdge`).
   */
  private followBar(): void {
    if (this.pillRowOn) {
      this.pillDockBefore ??= this.pillDock;
      const bar = offeredDock(this.barDock);
      if (this.pillDock !== bar) this.setPillDock(bar);
    } else if (this.pillDockBefore !== null) {
      const before = this.pillDockBefore;
      this.pillDockBefore = null;
      this.setPillDock(before);
    }
  }

  /**
   * Rest the bar at `dock`, as the setting on this device says (main.ts,
   * `barDock`). The page area gives way on that side, and the surface lays
   * out again through its own ResizeObserver, keeping the page point it showed.
   */
  setBarDock(dock: BarDock): void {
    const next = parseBarDock(dock);
    if (next === this.barDock) return;
    this.closePopover();
    this.barDock = next;
    this.applyBarDock();
    this.followBar();
    // A bar moved from top to bottom keeps its size, so its observer is quiet.
    this.measureBar();
    this.applyPosition();
    this.editor?.refresh();
  }

  /**
   * Where the page body ends, host px: above Obsidian's foot padding (32 px
   * on mobile, for its own bar) and above the keyboard.
   */
  private pageBottom(hostBox: DOMRect): number {
    const win = this.host.ownerDocument.defaultView;
    const windowBottom = (win?.innerHeight ?? Infinity) - keyboardHeight();
    const foot = parseFloat(win?.getComputedStyle(this.host).paddingBottom ?? "") || 0;
    return Math.min(hostBox.height - foot, windowBottom - hostBox.top);
  }

  /** The bar's box in host px. */
  private barBox(hostBox: DOMRect): { left: number; top: number; right: number; bottom: number } {
    const bar = this.barEl.getBoundingClientRect();
    return {
      left: bar.left - hostBox.left,
      top: bar.top - hostBox.top,
      right: bar.right - hostBox.left,
      bottom: bar.bottom - hostBox.top,
    };
  }

  /**
   * Pin the pill directly under the tool bar, centred over the page area
   * (right of a docked sidebar), as GoodNotes does. It was draggable and its
   * position persisted until 0.3.1; a stale stored position left it sitting
   * in the middle of the page on every device it had been dragged on.
   * Re-applied after a resize or rotation and when the sidebar opens.
   */
  applyPosition(): void {
    this.placePill();
    // Toasts keep to the other end of the page (`toastSide`).
    this.callbacks.onPillPlaced?.();
  }

  /**
   * "Dock tool options" was switched on this device (main.ts, `pillRow`):
   * the pill by the bar becomes a row the page starts past, or floats again.
   */
  setPillRow(on: boolean): void {
    if (on === this.pillRowOn) return;
    this.pillRowOn = on;
    this.followBar();
    // Beside a bar at a side the pill's contents differ docked and floating.
    if (isUpright(this.pillDock)) this.buildOptions();
    this.applyPosition();
    this.editor?.refresh();
  }

  /**
   * Give the docked pill's row its room (`pill-row-model.ts`): the row's
   * height, which the page body gives up, and `is-docked` on the pill, which
   * then sits in it. It is placed where it floated: `pageArea` already puts
   * it `EDGE_INSET` clear of the bar, and the row is that inset either side
   * of it. `anchored`: floating by a text box, where the row keeps its room.
   */
  private syncPillRow(shown: boolean, height: number, anchored = false): void {
    // `height` is the pill's thickness across the row: its height, or its width at a side.
    const next = pillRow({
      edge: pillRowEdge(this.pillRowOn, this.pillDock, this.barDock),
      shown,
      anchored,
      height,
      gap: this.pillInset(),
      previous: this.row,
    });
    this.optionsEl.toggleClass(
      "is-docked",
      (next.edge !== null || this.optionsEl.hasClass("is-in-bar")) && !anchored,
    );
    const before = this.row;
    if (next.edge === before.edge && next.room === before.room) return;
    this.row = next;
    this.host.toggleClass("goodobsidian-has-pill-row", next.edge !== null);
    const side = next.edge === "left" || next.edge === "right";
    this.rowEl.setCssStyles({
      height: side || next.edge === null ? "" : `${next.room}px`,
      width: side ? `${next.room}px` : "",
    });
    const shift = pageTopShift(before, next);
    if (shift !== 0) this.callbacks.onPillRow?.(shift);
  }

  /** The bar and the pill as shown, as vertical spans in screen px (`toastSide`). */
  chromeSpans(): Array<{ top: number; bottom: number }> {
    // An upright bar stands beside the page, clear of a toast centred on it.
    const spans = isBarUpright(this.barDock) ? [] : [this.barEl.getBoundingClientRect()];
    const pill = this.optionsEl;
    // An upright pill stands at a side, clear of a toast centred on the page.
    const upright = pill.hasClass("is-upright") && !pill.hasClass("is-anchored");
    if (!pill.hasClass("is-offscreen") && !pill.hasClass("is-hidden") && !upright) {
      spans.push(pill.getBoundingClientRect());
    }
    return spans.map(({ top, bottom }) => ({ top, bottom }));
  }

  /**
   * The pen's pill is showing (not the text pill over it): its colours are a
   * row that scrolls. The laser's and fill's colour rows look the same but
   * belong to other tools.
   */
  private penPillShown(): boolean {
    const tool = this.state.tool;
    return !this.optionsEl.hasClass("is-text") && (tool === "pen" || tool === "highlighter");
  }

  /** The room the row in the bar was placed with, which a later `fitBar` keeps. */
  private pillWant = 0;
  /** The room the bar keeps for the widest row (`widestRow`), which a later `fitBar` keeps. */
  private dockWant = 0;
  /** What each tool's row was measured to need in the bar, by its options key. */
  private readonly rowNeeds = new Map<string, number>();

  /** Whose row the pill shows: the text pill's over the pen, else the tool's. */
  private rowKey(): string {
    return this.optionsEl.hasClass("is-text") ? "text" : optionsKey(this.state.tool);
  }

  /**
   * The room the row wants inside the bar: all of it, so no control is cut
   * (docking design B, 2026-11-13), except the pen's colours, which scroll
   * down to their least (styles.css, `.is-in-bar .goodobsidian-pen-colors`).
   */
  private pillNeed(): number {
    const pill = this.optionsEl;
    pill.setCssProps({ "--gob-pill-inside": "100000px" });
    this.fitTextPill(100000);
    let need = Math.ceil(pill.scrollWidth) + 2;
    const colours = this.penPillShown()
      ? pill.querySelector<HTMLElement>(".goodobsidian-pen-colors")
      : null;
    if (colours) {
      const least = parseFloat(getComputedStyle(colours).minWidth) || 0;
      need -= Math.max(0, Math.ceil(colours.scrollWidth) - least);
    }
    return need;
  }

  /** Put the pill in the bar right after the tools, with the room between them and the end. */
  private alignPillInBar(): void {
    const { from, room } = this.pillSpan();
    const hostBox = this.host.getBoundingClientRect();
    this.optionsEl.setCssProps({ "--gob-pill-inside": `${Math.max(0, room)}px` });
    this.optionsEl.setCssStyles({ left: `${Math.round(from + BAR_GAP - hostBox.left)}px` });
    this.markPillOverflow();
  }

  /**
   * The last resort when nothing more may fold (discussion #200): a pill
   * still wider than its room scrolls sideways in the bar rather than
   * losing its last buttons.
   */
  private markPillOverflow(): void {
    const pill = this.optionsEl;
    pill.removeClass("is-overflowing");
    if (!pill.hasClass("is-in-bar")) return;
    // From what it needs against its room: its own width may still be gliding
    // from the last tool's (morphPill). The pen's colours scroll by themselves.
    if (this.penPillShown()) return;
    pill.toggleClass("is-overflowing", this.pillWant > this.pillSpan().room + 1);
  }

  /** Take the pill back out of the bar: it is put in again only if it still fits. */
  private leaveBar(): void {
    this.barEl.removeClass("has-pill-inside");
    this.optionsEl.removeClass("is-in-bar");
  }

  /** Where the pill's place in the bar starts, and how wide it is, between the bar's groups. */
  private pillSpan(): { from: number; room: number } {
    const boxOf = (zone: HTMLElement | undefined): DOMRect | null => {
      const box = zone?.getBoundingClientRect();
      return box && box.width > 0 ? box : null;
    };
    const bar = this.barEl.getBoundingClientRect();
    const { start, middle, end } = this.zoneEls;
    const before = [boxOf(start), boxOf(middle)].flatMap((box) => (box ? [box.right] : []));
    const from = Math.max(bar.left, ...before);
    const to = boxOf(end)?.left ?? bar.right;
    return { from, room: Math.floor(to - from - 2 * BAR_GAP) };
  }

  /**
   * Fold the buttons at the end of the bar (the right, along the top), from
   * their outer end in, until the rows have `want` px beside the tools. Only
   * those fold for a row (Joost, 2026-11-13): the start's buttons and the
   * tools always show, and a row that still does not fit gets a bar of its own.
   */
  private foldForDock(want: number): void {
    const end = new Set(Array.from(this.zoneEls.end?.children ?? []));
    for (const item of this.foldOrder()) {
      if (this.pillSpan().room >= want) return;
      if (!end.has(item.button) || item.tool !== undefined) continue;
      if (item.button.hasClass("is-overflowed")) continue;
      if (item.button.style.display === "none" || item.button.hasClass("is-unlisted")) continue;
      item.button.addClass("is-overflowed");
    }
  }

  /**
   * Docking design B (2026-11-13): put the row docked along the top or
   * bottom inside the bar, after the tools, when the widest row any tool
   * shows (`widestRow`) fits there once the bar's buttons fold
   * (`foldOrder`). The room is decided by the widest row, not by
   * the tool in hand, so switching tools never moves a button. False when
   * it does not fit: then every tool's row is a row of its own under the bar.
   */
  private placeInsideBar(hostBox: DOMRect): boolean {
    const edge = pillRowEdge(this.pillRowOn, this.pillDock, this.barDock);
    if (edge !== "top" && edge !== "bottom") return false;
    this.fitBar(this.indicatorTool);
    this.barEl.addClass("has-pill-inside");
    const pill = this.optionsEl;
    pill.addClass("is-in-bar");
    pill.addClass("is-docked");
    this.pillWant = this.pillNeed();
    this.rowNeeds.set(this.rowKey(), this.pillWant);
    this.dockWant = widestRow(this.rowNeeds);
    this.foldForDock(this.dockWant);
    const { from, room } = this.pillSpan();
    pill.setCssProps({ "--gob-pill-inside": `${Math.max(0, room)}px` });
    this.fitTextPill(room);
    const bar = this.barEl.getBoundingClientRect();
    const box = pill.getBoundingClientRect();
    if (
      !pillFitsBar({ edge, room, need: this.dockWant, height: box.height, barHeight: bar.height })
    ) {
      this.leaveBar();
      this.fitTextPill();
      // The buttons folded for the rows come back: the bar folds only for itself.
      this.fitBar(this.indicatorTool);
      return false;
    }
    this.settleFolds();
    pill.setCssStyles({
      left: `${Math.round(from + BAR_GAP - hostBox.left)}px`,
      top: `${Math.round(bar.top - hostBox.top + (bar.height - box.height) / 2)}px`,
    });
    this.markPillOverflow();
    return true;
  }

  private placePill(): void {
    const wasInside = this.barEl.hasClass("has-pill-inside");
    this.placePillNow();
    // Into or out of the bar, the tools move and buttons fold or come back.
    const inside = this.barEl.hasClass("has-pill-inside");
    if (wasInside && !inside) this.fitBar(this.indicatorTool);
    if (wasInside !== inside || inside) this.placeIndicator(this.indicatorTool, null);
  }

  private placePillNow(): void {
    // A glide in progress would be measured as the pill's size.
    this.stopPillMorph();
    this.leaveBar();
    this.optionsEl.removeClass("is-overflowing");
    // The lasso's chevron goes while its options are a docked row (styles.css).
    this.barEl.toggleClass("has-docked-row", this.dockedAcross());
    // Docked, the pill is as wide as the row allows: measure it so.
    this.optionsEl.toggleClass(
      "is-docked",
      pillRowEdge(this.pillRowOn, this.pillDock, this.barDock) !== null &&
        !this.optionsEl.hasClass("is-anchored"),
    );
    this.fitTextPill();
    const hostBox = this.host.getBoundingClientRect();
    const pill = this.optionsEl.getBoundingClientRect();
    const anchored = this.anchoredPlace(hostBox, pill);
    this.optionsEl.toggleClass("is-anchored", anchored !== null);
    this.optionsEl.toggleClass("is-offscreen", anchored === "hidden");
    if (anchored === "hidden") {
      this.clearForPill(null, hostBox);
      this.syncPillRow(false, 0, true);
      return;
    }
    if (anchored) {
      this.optionsEl.setCssStyles({
        left: `${Math.round(anchored.left)}px`,
        top: `${Math.round(anchored.top)}px`,
      });
      this.clearForPill(null, hostBox);
      this.syncPillRow(false, 0, true);
      return;
    }
    if (this.placeInsideBar(hostBox)) {
      this.clearForPill(null, hostBox);
      this.syncPillRow(false, 0);
      return;
    }
    // A row of its own narrower than the tool's controls (Split View): they
    // scroll sideways, faded at the end, rather than being cut off.
    const across = this.optionsEl.hasClass("is-docked") && !isUpright(this.pillDock);
    this.optionsEl.toggleClass(
      "is-overflowing",
      across && this.optionsEl.scrollWidth > this.optionsEl.clientWidth + 1,
    );
    const area = this.pillArea(hostBox, pill.width);
    // An upright pill taller than the room scrolls (styles.css).
    this.optionsEl.setCssProps({
      "--gob-pill-room": `${Math.max(0, Math.round(area.bottom - area.top - 2 * EDGE_INSET))}px`,
    });
    const place = dockPlace(this.pillDock, area, pill.width, pill.height, this.pillInset());
    this.optionsEl.setCssStyles({
      left: `${Math.round(place.left)}px`,
      top: `${Math.round(place.top)}px`,
    });
    const shown = !this.optionsEl.hasClass("is-collapsed") && !this.optionsEl.hasClass("is-hidden");
    this.syncPillRow(shown, isUpright(this.pillDock) ? pill.width : pill.height);
    // Docked, the page already ends at the row: nothing on it need step aside.
    this.clearForPill(
      shown && this.row.edge === null
        ? {
            left: place.left,
            top: place.top,
            right: place.left + pill.width,
            bottom: place.top + pill.height,
          }
        : null,
      hostBox,
    );
  }

  /**
   * Tell what else rests on the view's edges (the page counter, the zoom
   * readout, the recording pill, the audio player; styles.css) how far the
   * pill reaches in from the edge it rests on, as `--gob-pill-clear-*` on
   * the host; `null` while it is not at its place.
   */
  private clearForPill(
    pill: { left: number; top: number; right: number; bottom: number } | null,
    hostBox: DOMRect,
  ): void {
    // Measured from where the page ends, as the counter and readout are.
    const area = this.pillArea(hostBox, 0);
    const clear = pillClearance(
      this.pillDock,
      pill ?? { left: 0, top: 0, right: 0, bottom: 0 },
      { width: area.right, height: area.bottom },
      pill !== null,
      EDGE_INSET,
    );
    this.host.setCssProps({
      "--gob-pill-clear-bottom": `${clear.bottom}px`,
      "--gob-pill-clear-left": `${clear.left}px`,
      "--gob-pill-clear-right": `${clear.right}px`,
    });
  }

  /**
   * The part of the view the pill rests in, host px: the page area, clear
   * of the tool bar wherever it rests, right of a docked panel (unless the
   * pill would not fit beside it), and above the keyboard (`pageArea`).
   */
  private pillArea(hostBox: DOMRect, pillWidth: number): PillArea {
    // The page runs inside the view's padding, as the bar does.
    const style = this.host.ownerDocument.defaultView?.getComputedStyle(this.host);
    const pad = (value: string | undefined): number => parseFloat(value ?? "") || 0;
    return pageArea(
      this.barDock,
      this.barBox(hostBox),
      {
        left: pad(style?.paddingLeft),
        right: hostBox.width - pad(style?.paddingRight),
        bottom: this.pageBottom(hostBox),
      },
      this.pillInset(),
      this.leftInset,
      pillWidth,
    );
  }

  /** Whether the pill is docked in a column beside a bar at a side (`pillRowEdge`). */
  private dockedAtSide(): boolean {
    const edge = pillRowEdge(this.pillRowOn, this.pillDock, this.barDock);
    return edge === "left" || edge === "right";
  }

  /** How far the pill rests from the bar: less when it is docked in a row of its own. */
  private pillInset(): number {
    return pillRowEdge(this.pillRowOn, this.pillDock, this.barDock) === null
      ? EDGE_INSET
      : DOCKED_INSET;
  }

  /** The pill was carried and let go at (`x`, `y`), host px: rest it at the nearest place. */
  private dropPill(x: number, y: number): void {
    const hostBox = this.host.getBoundingClientRect();
    const pill = this.optionsEl.getBoundingClientRect();
    const dock = nearestDock(this.pillArea(hostBox, pill.width), x, y, OFFERED_DOCKS);
    // Spring from where it was let go: the pill grows out of the square there.
    const before = { x: x - pill.width / 2, y: y - pill.height / 2 };
    this.setPillDock(dock);
    this.callbacks.onPillDock?.(dock);
    const after = this.optionsEl.getBoundingClientRect();
    if (prefersReducedMotion()) return;
    const dx = before.x - (after.left - hostBox.left);
    const dy = before.y - (after.top - hostBox.top);
    this.optionsEl.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(0.3)`, opacity: 0.4 },
        { transform: "none", opacity: 1 },
      ],
      { duration: springMs(TOOL_INDICATOR), easing: this.curve(TOOL_INDICATOR) },
    );
  }

  /**
   * Rest the pill at `dock` (another notebook's pill was moved there, or
   * this one was dropped there). Hosts call it to keep every notebook alike.
   */
  setPillDock(dock: PillDock): void {
    const next = offeredDock(dock);
    if (next === this.pillDock) {
      this.applyPosition();
      return;
    }
    const turned = isUpright(next) !== isUpright(this.pillDock);
    this.optionsEl.removeClass(`is-dock-${this.pillDock}`);
    this.pillDock = next;
    this.optionsEl.addClass(`is-dock-${next}`);
    this.optionsEl.toggleClass("is-upright", isUpright(next));
    // Upright, the pen's pill folds its widths and colours (buildPenOptions).
    if (turned) {
      this.closePopover();
      this.buildOptions();
    } else this.applyPosition();
  }

  /**
   * Where the text pill floats by its box (host px), as GoodNotes' text bar
   * does: under a selected box, over one being typed in, centred on it, and
   * on the other side when the first has no room (the keyboard's top counts
   * as the screen's bottom), kept inside the page area and below the tool
   * bar. `null` when there is no box, the
   * pill is not the text pill, or the box leaves no room either side (a box
   * as tall as the screen): the pill then stays under the tool bar.
   */
  private anchoredPlace(
    hostBox: DOMRect,
    pill: DOMRect,
  ): { left: number; top: number } | "hidden" | null {
    const anchor = this.textAnchor;
    this.pillDecision = "toolbar";
    if (!anchor || !this.textTarget || !this.optionsEl.hasClass("is-text")) return null;
    if (pill.width === 0 || pill.height === 0) return null;
    // Inside the page area: clear of the tool bar wherever it rests.
    const area = this.pillArea(hostBox, pill.width);
    const minTop = area.top;
    const barTop = this.barDock === "bottom" ? this.barBox(hostBox).top : Infinity;
    // The keyboard covers the bottom of the window, whatever the host's height.
    const windowBottom =
      (this.host.ownerDocument.defaultView?.innerHeight ?? Infinity) - keyboardHeight();
    // The part of the screen the box can be seen in: below the tool bar,
    // above the keyboard, inside the page.
    const visibleTop = Math.max(minTop, (anchor.clipTop ?? -Infinity) - hostBox.top);
    const visibleBottom = Math.min(
      hostBox.height,
      barTop,
      windowBottom - hostBox.top,
      (anchor.clipBottom ?? Infinity) - hostBox.top,
    );
    const maxBottom = visibleBottom - EDGE_INSET;
    // A box scrolled (mostly) out of sight takes its pill with it, as in
    // GoodNotes: no bar left on screen beside a box that is not. With the
    // Text tool pinned the pill stays, under the tool bar.
    const boxTop = anchor.top - hostBox.top;
    const boxBottom = anchor.bottom - hostBox.top;
    const shown = Math.min(boxBottom, visibleBottom) - Math.max(boxTop, visibleTop);
    const gone = shown < Math.min(TEXT_BOX_MIN_SHOWN, (boxBottom - boxTop) / 2);
    // GoodNotes' bars leave while the page moves and come back, by their
    // box, once it settles: never a bar sliding about the screen, or one a
    // frame behind its box.
    if (gone || anchor.moving === true) {
      if (this.state.textPinned === true) {
        this.pillDecision = "toolbar (pinned)";
        return null;
      }
      this.pillDecision = gone ? "hidden (box out of view)" : "hidden (page moving)";
      return "hidden";
    }
    const below = anchor.bottom - hostBox.top + TEXT_PILL_GAP;
    const above = anchor.top - hostBox.top - TEXT_PILL_GAP - pill.height;
    const fitsBelow = below + pill.height <= maxBottom && below >= minTop;
    const fitsAbove = above >= minTop && above + pill.height <= maxBottom;
    // GoodNotes: under a selected box, over one being typed in (the keyboard
    // is coming up under it); the other side when the first has no room.
    const order = anchor.typing === true ? [fitsAbove, fitsBelow] : [fitsBelow, fitsAbove];
    const tops = anchor.typing === true ? [above, below] : [below, above];
    let top: number;
    if (order[0]) top = tops[0];
    else if (order[1]) top = tops[1];
    else {
      this.pillDecision = "toolbar (no room by the box)";
      return null;
    }
    this.pillDecision = top === below ? "below the box" : "above the box";
    const minLeft = area.left + EDGE_INSET;
    const maxLeft = Math.max(minLeft, area.right - pill.width - EDGE_INSET);
    const centre = (anchor.left + anchor.right) / 2 - hostBox.left;
    const left = Math.min(maxLeft, Math.max(minLeft, centre - pill.width / 2));
    return { left, top };
  }

  /** The floating pill's box in host px, or `null` while it is not shown. */
  private pillBox(): PillBox | null {
    const box = this.optionsEl.getBoundingClientRect();
    if (box.width === 0) return null;
    return { left: box.left - this.host.getBoundingClientRect().left, width: box.width };
  }

  /**
   * Glide the pill from `before` to where it now rests, as GoodNotes' options
   * bar does between tools: its width and place change over 0.3 s while it
   * stays centred, and with `fresh` the new controls fade in. The pill's own
   * `width: max-content` and inline `left` take over when the glide ends.
   */
  private morphPill(before: PillBox | null, durationMs: number, fresh: boolean): void {
    if (!before || prefersReducedMotion()) return;
    const after = this.pillBox();
    if (!after) return;
    if (fresh) {
      for (const child of Array.from(this.optionsEl.children)) {
        child.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: PILL_FADE_MS,
          easing: "ease-out",
        });
      }
    }
    if (Math.abs(after.width - before.width) < 1 && Math.abs(after.left - before.left) < 1) return;
    const morph = this.optionsEl.animate(
      [
        { width: `${before.width}px`, left: `${before.left}px` },
        { width: `${after.width}px`, left: `${after.left}px` },
      ],
      { duration: durationMs, easing: "ease" },
    );
    this.pillMorph = morph;
    morph.onfinish = () => {
      if (this.pillMorph === morph) this.pillMorph = null;
    };
  }

  private stopPillMorph(): void {
    this.pillMorph?.cancel();
    this.pillMorph = null;
  }

  /**
   * Tuck the pill away or bring it back. It slides up behind the tool bar
   * and down again, GoodNotes' 0.25 s with no fade: a CSS transition on
   * `.is-collapsed` (styles.css), which also stops it taking taps at once
   * and hides it when the slide ends.
   */
  private showOptions(visible: boolean): void {
    this.optionsEl.toggleClass("is-collapsed", !visible);
    // Tucked away, it leaves its edge to the counter and the readout again.
    if (visible) this.applyPosition();
    else {
      this.clearForPill(null, this.host.getBoundingClientRect());
      this.syncPillRow(false, 0);
    }
  }

  /**
   * A text pill too wide for its pane drops the pin's label first (the pin
   * keeps its icon: an iPad in landscape, since the pill has Σ); on a
   * narrower pane (portrait, Split View) it also narrows its dropdowns.
   * Anything still too wide scrolls inside the pill instead of leaving the
   * screen.
   */
  private fitTextPill(inside?: number): void {
    const pill = this.optionsEl;
    pill.removeClass("is-short");
    pill.removeClass("is-compact");
    if (!pill.hasClass("is-text")) return;
    const area = this.pillArea(this.host.getBoundingClientRect(), 0);
    const room = inside ?? area.right - area.left - 2 * EDGE_INSET;
    if (pill.scrollWidth <= room) return;
    pill.addClass("is-short");
    if (pill.scrollWidth > room) {
      pill.removeClass("is-short");
      pill.addClass("is-compact");
    }
  }

  // --- Host-facing state ----------------------------------------------------

  /**
   * Show the style of the page text box being edited in the text pill, or,
   * with `null` (editing ended), the style new boxes get. Hosts call this
   * when a box takes or loses focus, and after an undo while one has it.
   */
  /**
   * Where the box the text pill acts on is on screen (client px), or `null`:
   * while there is one, the pill floats beside it and shows even if it was
   * tucked away. Hosts call this whenever the box appears, moves or goes.
   */
  setTextAnchor(rect: TextAnchor | null): void {
    const was = this.textAnchor;
    this.textAnchor = rect ? { ...rect } : null;
    if (!was && !rect) return;
    this.watchKeyboard(rect !== null);
    // A held box always shows its pill, as GoodNotes shows its bar.
    const anchored = rect !== null && this.textTarget !== null;
    this.optionsEl.toggleClass("is-collapsed", !this.optionsVisible && !anchored);
    this.applyPosition();
  }

  /**
   * Obsidian sets `--keyboard-height` from its native side, with no event a
   * page can hear, and the iPad's keyboard does not resize the window: while
   * the pill floats by a box, look four times a second, and re-place it
   * (over the box instead of under it) when the keyboard has come or gone.
   */
  private watchKeyboard(on: boolean): void {
    const win = this.host.ownerDocument.defaultView;
    if (!on || !win) {
      if (this.keyboardWatch) win?.clearInterval(this.keyboardWatch);
      this.keyboardWatch = 0;
      return;
    }
    if (this.keyboardWatch) return;
    this.keyboardSeen = keyboardHeight();
    this.keyboardWatch = win.setInterval(() => {
      const height = keyboardHeight();
      if (height === this.keyboardSeen) return;
      this.keyboardSeen = height;
      this.applyPosition();
    }, KEYBOARD_WATCH_MS);
  }

  /** What the text pill did last: where it went, or why it hid (the debug HUD shows it). */
  get textPillState(): string {
    return this.pillDecision;
  }

  setTextTarget(style: TextStyle | null): void {
    const next = style ? textStyleOf(style) : null;
    const same =
      next === null
        ? this.textTarget === null
        : this.textTarget !== null && textStyleKey(next) === textStyleKey(this.textTarget);
    this.textTarget = next;
    if (same) return;
    this.buildOptions();
    this.popoverRender?.();
  }

  /**
   * Reflect the page sidebar: the thumbnails button reads as pressed, and the
   * floating pill is kept to the page area right of the panel's `width`.
   */
  setThumbnailsOpen(open: boolean, width: number): void {
    this.thumbnailsButton?.toggleClass("is-active", open);
    this.thumbnailsButton?.setAttribute("aria-pressed", String(open));
    this.setLeftInset(open ? width : 0);
  }

  /**
   * Keep the pill right of whatever panel holds the left of the page: the
   * page sidebar, or the Ask chat in its sidebar.
   */
  setLeftInset(width: number): void {
    if (width === this.leftInset) return;
    const before = this.pillBox();
    this.leftInset = width;
    this.applyPosition();
    // The pill moves with the page as the panel slides, not ahead of it.
    this.morphPill(before, PANEL_SLIDE_MS, false);
  }

  /**
   * Grey out Undo and Redo when there is nothing to undo or redo, as
   * GoodNotes does. The surface reports every change (`onHistoryChange`).
   */
  setHistoryState(canUndo: boolean, canRedo: boolean): void {
    if (this.undoButton) this.undoButton.disabled = !canUndo;
    if (this.redoButton) this.redoButton.disabled = !canRedo;
  }

  /**
   * Show or hide "Add page". A single page has none, and the same leaf can
   * load a single page and then a notebook (or convert one into the other),
   * so this follows the document rather than being fixed at construction.
   */
  setAddPageVisible(visible: boolean): void {
    this.addPageButton?.toggle(visible);
    this.fitBar(this.indicatorTool);
  }

  /** An endless board (FineNotes#46): its zoom's fit button fits the drawing. */
  setBoard(board: boolean): void {
    this.board = board;
  }

  /** Offer Insert PDF, or not (an endless board, FineNotes#46). Pictures stay. */
  setInsertPdfVisible(visible: boolean): void {
    this.insertPdfButton?.toggle(visible && !this.practice);
    this.fitBar(this.indicatorTool);
  }

  /**
   * Keep the bars to writing (a practice file): the pen and the eraser,
   * undo and redo, the page panel, ⋯ and the settings. The pen loses the
   * highlighter, auto-shape and its gestures menu.
   */
  setPractice(on: boolean): void {
    if (on === this.practice) return;
    this.practice = on;
    for (const button of this.beyondWriting) button.toggle(!on);
    this.learnButton?.toggle(on);
    this.fitBar(this.indicatorTool);
    if (on && this.activePenType().tool === "highlighter") this.choosePenType(PEN_TYPES[0]);
    this.closePopover();
    this.buildOptions();
    this.syncActive();
    // Buttons came or went beside the tool in hand.
    this.placeIndicator(this.indicatorTool, null);
  }

  private activePenType(): PenTypeSpec {
    return penTypeFor(this.state);
  }

  /**
   * "Learn my handwriting" on a practice sheet's bar, before ⋯: the way on
   * from the sheet. Outlined with a count until there is enough to learn
   * from, then filled ({@link setLearnCount}).
   */
  private buildLearnButton(parent: HTMLElement, open: () => void): void {
    const button = parent.createEl("button", { cls: "goodobsidian-learn-sheet clickable-icon" });
    iconOrText(button.createSpan({ cls: "goodobsidian-learn-sheet-icon" }), "graduation-cap", "");
    button.createSpan({
      cls: "goodobsidian-learn-sheet-label",
      text: t("toolbar.learn.label"),
    });
    this.learnCount = button.createSpan({ cls: "goodobsidian-learn-sheet-count" });
    button.addEventListener("click", open);
    button.toggle(this.practice);
    this.learnButton = button;
  }

  /** The practice sheet's button: how much there is to learn from, and whether it is enough. */
  setLearnCount(count: string, ready: boolean): void {
    this.learnCount?.setText(count);
    this.learnButton?.toggleClass("is-ready", ready);
    this.learnButton?.setAttribute(
      "aria-label",
      ready ? t("toolbar.learn.ready", { count }) : t("toolbar.learn.progress", { count }),
    );
  }

  /**
   * Where the indicator and the tool buttons' contents are now, as seen
   * (mid-slide included, so a quick second pick carries on from there), or
   * `null` while the indicator is not shown.
   */
  private toolPlaces(): ToolPlaces | null {
    const indicator = this.toolIndicator;
    const group = indicator?.parentElement;
    if (!indicator || indicator.hasClass("is-hidden") || !group) return null;
    const box = indicator.getBoundingClientRect();
    if (box.width === 0) return null;
    const contents = new Map<Element, { left: number; top: number }>();
    for (const button of Array.from(group.children)) {
      if (button === indicator) continue;
      for (const child of Array.from(button.children)) {
        const at = child.getBoundingClientRect();
        contents.set(child, { left: at.left, top: at.top });
      }
    }
    return { indicator: box, contents };
  }

  /**
   * Put the indicator under `tool`'s button. Given where things were
   * (`from`), it slides there on the house spring (0.35 s, bounce 0.1),
   * as `translate` and `scale` only, and the buttons' contents glide to
   * their new places too, since the lasso widens when it is picked and the
   * centred group shifts. Interrupted, a slide restarts from where it was
   * seen. Under Reduce Motion it fades in at its new place instead.
   */
  private placeIndicator(tool: ActiveTool | null, from: ToolPlaces | null): void {
    const indicator = this.toolIndicator;
    if (!indicator) return;
    for (const slide of this.toolSlides) slide.cancel();
    this.toolSlides = [];
    this.indicatorTool = tool;
    const slot = tool === "pen" ? this.indicatorSlot : null;
    let target =
      tool === null
        ? undefined
        : ((slot !== null ? this.slotButtons().get(slot) : undefined) ??
          this.toolButtons.get(tool));
    // A tool taken off the bar is in hand from the accessories menu: the
    // indicator marks that button instead.
    if (target?.hasClass("is-unlisted") && this.accessoriesButton) target = this.accessoriesButton;
    // A tool with no bar button (the laser), or a bar not laid out yet: no
    // indicator, and the button's own active square shows (styles.css).
    const shown = target !== undefined && target.offsetWidth > 0;
    indicator.toggleClass("is-hidden", !shown);
    // Positioned in its group's box: it moves into the group of the button
    // it marks, first so the buttons paint over it.
    const group = target?.parentElement;
    if (shown && group && indicator.parentElement !== group) group.prepend(indicator);
    for (const zone of Object.values(this.zoneEls)) {
      zone?.toggleClass("has-indicator", shown && zone === indicator.parentElement);
    }
    if (!target || !shown) return;
    indicator.setCssStyles({
      left: `${target.offsetLeft}px`,
      top: `${target.offsetTop}px`,
      width: `${target.offsetWidth}px`,
      height: `${target.offsetHeight}px`,
    });
    if (!from || typeof indicator.animate !== "function") return;
    if (prefersReducedMotion()) {
      this.toolSlides = [
        indicator.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: REDUCED_FADE_MS,
          easing: "ease-out",
        }),
      ];
      return;
    }
    const to = indicator.getBoundingClientRect();
    if (to.width === 0) return;
    const timing = { duration: springMs(TOOL_INDICATOR), easing: this.curve(TOOL_INDICATOR) };
    // Across an upright bar's tools it slides down, not along.
    const dx = from.indicator.left - to.left;
    const dy = from.indicator.top - to.top;
    const sx = from.indicator.width / to.width;
    const sy = to.height > 0 ? from.indicator.height / to.height : 1;
    if (
      Math.abs(dx) >= 0.5 ||
      Math.abs(dy) >= 0.5 ||
      Math.abs(sx - 1) > 0.01 ||
      Math.abs(sy - 1) > 0.01
    ) {
      this.toolSlides.push(
        indicator.animate(
          [
            { translate: `${dx}px ${dy}px`, scale: `${sx} ${sy}` },
            { translate: "0 0", scale: "1 1" },
          ],
          timing,
        ),
      );
    }
    for (const [child, was] of from.contents) {
      if (!child.isConnected) continue;
      const now = child.getBoundingClientRect();
      const shiftX = was.left - now.left;
      const shiftY = was.top - now.top;
      if (Math.abs(shiftX) < 0.5 && Math.abs(shiftY) < 0.5) continue;
      this.toolSlides.push(
        child.animate([{ translate: `${shiftX}px ${shiftY}px` }, { translate: "0 0" }], timing),
      );
    }
  }

  /** A house spring as this browser can run it; the bouncy one falls back to `--gob-spring`. */
  private curve(spring: Spring): string {
    return springCurve(spring, spring.bounce > 0 ? SPRING_FALLBACK : EASE_OUT_FALLBACK);
  }

  /** Mark every choice button that matches the state, and unmark the rest. */
  syncActive(): void {
    const { state } = this;
    // Highlighter is a pen type, so the pen button stands for both.
    const tool = state.tool === "highlighter" ? "pen" : state.tool;
    const slot = this.penSlotInHand();
    const from =
      tool === this.indicatorTool && slot === this.indicatorSlot ? null : this.toolPlaces();
    markChosen(this.toolButtons, tool, true);
    // The pen in hand may be one of the pens on the bar (FineNotes#211).
    this.indicatorSlot = slot;
    for (const [id, button] of this.slotButtons()) {
      button.toggleClass("is-active", id === slot);
      button.setAttribute("aria-pressed", String(id === slot));
    }
    if (slot !== null) {
      this.penToolButton?.removeClass("is-active");
      this.penToolButton?.setAttribute("aria-pressed", "false");
    }
    this.drawPenSlots();
    // An open Zoom box keeps the Magnifier lit while another tool writes.
    // `is-on` is exactly what Stylus only uses: the whole button takes the
    // active background and icon colour, not just the glyph.
    const zoom = this.toolButtons.get("zoom");
    if (zoom) {
      const mark = zoomButtonState(this.state.tool, this.state.zoomBoxOpen === true);
      zoom.toggleClass("is-on", mark.highlighted);
      zoom.setAttribute("aria-pressed", String(mark.pressed));
    }
    // The tool in hand stays on the bar, and a chosen tool is wider.
    if (tool !== this.indicatorTool) this.fitBar(tool);
    this.placeIndicator(tool, from);
    markChosen(this.colorSwatches, state.color);
    markChosen(
      this.widthButtons,
      this.widthButtons.has(FOLDED_WIDTH) ? FOLDED_WIDTH : this.chosenWidthSlot(),
    );
    markChosen(this.eraserSizeButtons, this.chosenEraserSlot());
    markChosen(this.penTypeButtons, this.activePenType().id);
    markChosen(this.shapeButtons, shapeModeFor(state), true);
    this.drawPenPreview();
    this.drawLassoIcon();
    this.drawEraserIcon();
    // The pen row shows each pen in its own ink now.
    for (const [id, button] of this.penTypeButtons) {
      if (!button.isConnected) continue;
      const spec = PEN_TYPES.find((type) => type.id === id);
      const glyph = button.querySelector("svg");
      if (spec && glyph)
        glyph.replaceWith(
          penGlyph(spec.id, this.shown(this.inkColorOf(spec), spec.tool === "highlighter")),
        );
    }
  }

  /**
   * Tuck the pill away as a second tap on the tool's button does, until
   * that button is tapped again or {@link showTuckedOptions} ("Hide pen
   * options while writing").
   */
  tuckOptions(): void {
    // A docked pill covers no ink, and tucking it would move the page each stroke.
    if (!this.optionsVisible || this.row.edge !== null) return;
    this.optionsVisible = false;
    this.tuckedByStroke = true;
    this.showOptions(false);
  }

  /**
   * Bring back the options a stroke tucked away ("until the pen lifts"),
   * unless a tap or another tool has had a say since: a pill the user
   * tucked stays tucked.
   */
  showTuckedOptions(): void {
    if (!this.tuckedByStroke) return;
    this.tuckedByStroke = false;
    if (this.optionsVisible) return;
    this.optionsVisible = true;
    this.showOptions(true);
  }

  /**
   * Pages are shown dark, or no longer: swatches and pen marks show each
   * colour as the page shows its ink, while what is picked stays the true one.
   */
  setNight(night: boolean): void {
    if (night === this.night) return;
    this.night = night;
    this.buildOptions();
    this.syncActive();
  }

  /**
   * `color` as the page shows ink of it: a highlighter's own way on dark
   * pages (`nightHighlighter`), every other ink's `shownColor`.
   */
  private shown(color: string, highlighter = this.state.tool === "highlighter"): string {
    return this.night && highlighter ? nightHighlighter(color) : shownColor(color, this.night);
  }

  /** Take on a state the host changed (a shortcut, an undo, another note's defaults). */
  setState(next: ToolbarState): void {
    this.drawingTool = drawingToolOf(this.drawingTool, next.tool);
    this.leaveToolFor(next.tool);
    this.state = next;
    this.buildOptions();
    this.syncActive();
  }

  /**
   * The surface opened the Zoom box (one tap, or a drawn target) or closed it
   * with its ×. The bar follows without calling back, so the host is not
   * asked to open what is already open. Closing keeps the mode: the next tap
   * on the Magnifier opens a box again.
   */
  setZoomBoxOpen(open: boolean): void {
    this.state.zoomBoxOpen = open;
    if (open) this.state.zoomBox = true;
    if (this.state.tool === "zoom") this.buildOptions();
    this.syncActive();
  }

  /** Show the record button as live (tinted) while a recording runs. */
  setRecording(active: boolean): void {
    this.recordButton?.toggleClass("is-recording", active);
    this.recordButton?.setAttribute("aria-pressed", active ? "true" : "false");
    this.recordButton?.setAttribute(
      "aria-label",
      active ? t("toolbar.recordStop") : t("toolbar.tool.recordAudio"),
    );
  }

  /** Close what is open, drop every listener outside the toolbar, and take both tiers away. */
  destroy(): void {
    this.hideUpdateTip();
    this.closePopover();
    for (const [popover, timer] of this.leavingPopovers) {
      window.clearTimeout(timer);
      popover.remove();
    }
    this.leavingPopovers.clear();
    for (const slide of this.toolSlides) slide.cancel();
    this.toolSlides = [];
    this.stopPillMorph();
    this.watchKeyboard(false);
    const disposers = this.disposers.splice(0);
    disposers.forEach((dispose) => dispose());
    this.barEl.remove();
    this.optionsEl.remove();
  }
}

/**
 * Mark the button keyed `chosen` as active and every other one as not;
 * `pressed` mirrors that in `aria-pressed`, for buttons that toggle.
 */
function markChosen<K>(buttons: Map<K, HTMLElement>, chosen: K | null, pressed = false): void {
  for (const [key, button] of buttons) {
    const isChosen = key === chosen;
    button.toggleClass("is-active", isChosen);
    if (pressed) button.setAttribute("aria-pressed", String(isChosen));
  }
}

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * A Shape-tool control, drawn as the outline it places. Auto-shape is a
 * square and a circle overlapping, after the reference screenshot.
 */
function shapeGlyph(mode: ShapeMode): SVGElement {
  const svg = activeDocument.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "22");
  svg.setAttribute("height", "22");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("stroke-linecap", "round");
  const add = (tag: string, attrs: Record<string, string>): void => {
    const el = activeDocument.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    svg.append(el);
  };
  const shapes: Record<ShapeMode, () => void> = {
    auto: () => {
      add("rect", { x: "8.5", y: "3.5", width: "12", height: "12", rx: "3" });
      add("circle", { cx: "9", cy: "15", r: "5.5" });
    },
    rect: () => add("rect", { x: "4", y: "4", width: "16", height: "16", rx: "1" }),
    ellipse: () => add("circle", { cx: "12", cy: "12", r: "8.5" }),
    triangle: () => add("path", { d: "M12 3.8 20.6 19H3.4Z" }),
    diamond: () => add("path", { d: "M12 3.2 20.8 12 12 20.8 3.2 12Z" }),
    roundrect: () => add("rect", { x: "3.5", y: "5.5", width: "17", height: "13", rx: "5" }),
    // The same star the preset places, so the button shows what it draws.
    star: () => {
      const tips = starPoints(12, 12.9, 9.6, 9.6 * STAR_INNER_RATIO, -Math.PI / 2);
      const d = tips.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`);
      add("path", { d: `${d.join(" ")}Z` });
    },
    // Likewise the heart.
    heart: () => {
      const outline = heartPoints(12, 12.4, 18, 18 * HEART_ASPECT);
      const d = outline.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`);
      add("path", { d: `${d.join(" ")}Z` });
    },
    line: () => add("path", { d: "M5 19 19 5" }),
    // A curve to a head: it is drawn straight and bends by its middle dot.
    arrow: () => add("path", { d: "M4 18C5 8 15 6 18.5 17M14.3 14.3l4.2 2.7 1.9-4.6" }),
    // Across, a rounded bend, then down to a head: the elbow it places.
    elbow: () => add("path", { d: "M4 6h9.5a3.5 3.5 0 0 1 3.5 3.5V19M13.5 15.5 17 19l3.5-3.5" }),
    table: () => {
      add("rect", { x: "3.5", y: "5", width: "17", height: "14", rx: "1.5" });
      add("path", { d: "M3.5 9.7h17M3.5 14.3h17M9.2 5v14M14.8 5v14" });
    },
  };
  shapes[mode]();
  return svg;
}

/**
 * A lasso type card's picture, after GoodNotes': a dashed square for the
 * rectangular lasso, a dashed freehand blob for the freehand one. The lasso
 * tool's own button draws the same picture for the type in use.
 */
function lassoGlyph(mode: LassoMode, size = 30): SVGElement {
  const svg = activeDocument.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 32 32");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("stroke-dasharray", "4 3.2");
  const shape = activeDocument.createElementNS(SVG_NS, mode === "rect" ? "rect" : "path");
  if (mode === "single") {
    // A pointer: it takes what it lands on, with no loop to draw.
    svg.removeAttribute("stroke-dasharray");
    shape.setAttribute("d", "M9 5l16 12-7.5 1.2 4.3 7.8-3.6 1.9-4.3-7.9L9 25z");
    shape.setAttribute("fill", "currentColor");
    shape.setAttribute("fill-opacity", "0.25");
  } else if (mode === "lines") {
    // The staircase a text selection makes over three lines.
    shape.setAttribute("d", "M14 7h13v12h-9v6H5V13h9z");
    shape.setAttribute("fill", "currentColor");
    shape.setAttribute("fill-opacity", "0.25");
  } else if (mode === "rect") {
    for (const [key, value] of Object.entries({
      x: "5",
      y: "5",
      width: "22",
      height: "22",
      rx: "4",
    })) {
      shape.setAttribute(key, value);
    }
  } else {
    shape.setAttribute("d", "M8 7c5-4 14-3 18 1s2 9-2 12-3 6-8 6-11-4-11-9 0-7 3-10z");
    shape.setAttribute("fill", "currentColor");
    shape.setAttribute("fill-opacity", "0.25");
  }
  svg.append(shape);
  return svg;
}

/** Paints the page in view into a canvas (`ToolbarCallbacks.paintSizePaper`). */
type PaperPainter = (canvas: HTMLCanvasElement, width: number, height: number) => boolean;

/**
 * The page's own paper and lines under a size strip, at the zoom now, so a
 * width or an eraser reads against the lines it will meet (Joost's
 * recording, 2026-10-25: the strip's own 16 px lines matched no page).
 * Returns what repaints it, measured each time as the strip may have just
 * been laid out; without a page the strip keeps its plain paper.
 */
function paperUnder(strip: HTMLElement, paint?: PaperPainter): () => void {
  if (!paint) return () => undefined;
  const canvas = strip.createEl("canvas", { cls: "goodobsidian-size-preview-paper" });
  return () => {
    const width = strip.clientWidth;
    const height = strip.clientHeight;
    strip.toggleClass("has-page", width > 0 && height > 0 && paint(canvas, width, height));
  };
}

/**
 * A strip of paper under the width slider with a sample stroke on it in the
 * pen's own character (`sampleStroke`, the width buttons' shapes drawn
 * large), at the width it will be on the page now. The SVG has no viewBox,
 * so its units are screen px. Returns the function that redraws it.
 */
function strokePreview(
  parent: HTMLElement,
  paint?: PaperPainter,
): (screenWidth: number, color: string, pen: string) => void {
  const strip = parent.createDiv({ cls: "goodobsidian-size-preview" });
  strip.setAttribute("aria-hidden", "true");
  const paper = paperUnder(strip, paint);
  const svg = activeDocument.createElementNS(SVG_NS, "svg");
  svg.classList.add("goodobsidian-size-preview-stroke");
  const path = activeDocument.createElementNS(SVG_NS, "path");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  strip.append(svg);
  return (screenWidth, color, pen) => {
    // Measured each time: the popover is laid out by then. The fallback is
    // the stylesheet's strip in a popover that has not been laid out yet.
    const width = strip.clientWidth || 240;
    const height = strip.clientHeight || 44;
    paper();
    const shape = sampleStroke(pen, screenWidth, width, height);
    path.setAttribute("d", shape.d);
    if (shape.strokeWidth === undefined) {
      path.setAttribute("fill", color);
      path.removeAttribute("stroke");
      path.removeAttribute("stroke-width");
    } else {
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", color);
      path.setAttribute("stroke-width", shape.strokeWidth.toFixed(2));
      path.setAttribute("stroke-linecap", shape.cap ?? "round");
    }
    if (shape.opacity === undefined) path.removeAttribute("opacity");
    else path.setAttribute("opacity", String(shape.opacity));
    strip.toggleClass("is-highlighter", pen === "highlighter");
    // White ink would vanish on white paper: show it on dark paper instead.
    strip.toggleClass("is-light-ink", sameColor(color, "#ffffff"));
  };
}

/**
 * A strip of paper under the tape-height slider with a piece of tape on it,
 * drawn by the page's own tape painter at the height it will have on the
 * page now (`scale` screen px per page px). A tape taller than the strip is
 * cut at its edges, which still reads as wide. Returns the redraw function.
 */
function tapePreview(
  parent: HTMLElement,
  paint?: PaperPainter,
): (height: number, scale: number, color: string) => void {
  const strip = parent.createDiv({ cls: "goodobsidian-size-preview is-tape" });
  strip.setAttribute("aria-hidden", "true");
  const paper = paperUnder(strip, paint);
  const canvas = strip.createEl("canvas", { cls: "goodobsidian-size-preview-tape" });
  return (height, scale, color) => {
    paper();
    const width = strip.clientWidth || 240;
    const tall = strip.clientHeight || 72;
    const ratio = activeWindow.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(tall * ratio);
    canvas.setCssStyles({ width: `${width}px`, height: `${tall}px` });
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Page px from here on, so the painter draws the tape as the page does.
    ctx.setTransform(ratio * scale, 0, 0, ratio * scale, 0, 0);
    const across = width / scale;
    const middle = tall / scale / 2;
    paintTape(ctx, [across * 0.12, middle, 0.5, across * 0.88, middle, 0.5], height, color);
  };
}

/**
 * A strip of paper under the eraser slider with the eraser's footprint on
 * it, at the size it erases on screen. A size larger than the strip is cut
 * at its edges, which still reads as large. Returns the redraw function.
 */
function eraserPreview(
  parent: HTMLElement,
  paint?: PaperPainter,
): (screenDiameter: number) => void {
  const strip = parent.createDiv({ cls: "goodobsidian-size-preview is-eraser" });
  strip.setAttribute("aria-hidden", "true");
  const paper = paperUnder(strip, paint);
  const ring = strip.createDiv({ cls: "goodobsidian-size-preview-eraser" });
  return (screenDiameter) => {
    paper();
    const d = `${Math.max(2, screenDiameter).toFixed(1)}px`;
    ring.setCssStyles({ width: d, height: d });
  };
}

/**
 * The eraser-size popover's presets are larger than the pill's: they have
 * the room, and at fit-to-width zoom the largest eraser (48) fits true size.
 */
const POPOVER_ERASER_BOX = 48;
const PILL_ERASER_BOX = 28;

/** A size mark as drawn: `size` screen px, after its control's marks were fitted (`fitMarks`). */
interface SizeMark {
  size: number;
}

/** Each of `keys` with its mark: `sizes` (screen px) fitted together into `limit`. */
function fittedMarks(
  keys: readonly number[],
  sizes: readonly number[],
  limit: number,
): Map<number, SizeMark> {
  const fit = fitMarks(sizes, limit);
  return new Map(keys.map((key, i) => [key, { size: fit.sizes[i] }]));
}

/**
 * An eraser-size control: the eraser's footprint at the size it erases
 * (`mark`, screen px), as the strip under the slider draws it, in a `box`
 * px square. Shrunk to fit beside larger ones it keeps a solid ring
 * (Joost, 2026-10-30): the sizes' ratios already say which is which.
 */
function eraserSizeGlyph(mark: SizeMark | undefined, box: number): SVGElement {
  const diameter = mark?.size ?? NaN;
  const svg = activeDocument.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${box} ${box}`);
  svg.setAttribute("width", String(box));
  svg.setAttribute("height", String(box));
  svg.setAttribute("aria-hidden", "true");
  const circle = activeDocument.createElementNS(SVG_NS, "circle");
  circle.setAttribute("cx", String(box / 2));
  circle.setAttribute("cy", String(box / 2));
  // The ring alone, drawn inside the footprint as the strip's border is: the
  // eraser's own size on the page at this zoom, or its share of the box.
  const d = Number.isFinite(diameter) && diameter > 0 ? diameter : 2;
  circle.setAttribute("r", Math.max(0.75, Math.min(d, box) / 2 - 0.75).toFixed(2));
  circle.setAttribute("fill", "none");
  circle.setAttribute("stroke", "currentColor");
  circle.setAttribute("stroke-width", "1.5");
  svg.append(circle);
  return svg;
}

/** What the tape's three heights are called, to screen readers and on hover. */
/** The names of the cover tape's three heights, narrowest first. */
function tapeHeightLabels(): string[] {
  return [t("toolbar.tape.narrow"), t("toolbar.tape.medium"), t("toolbar.tape.wide")];
}

/** The tape pill's two ways to lay a tape: mode, Lucide icon, name. */
function tapeModes(): readonly (readonly [TapeMode, string, string])[] {
  return [
    ["straight", "minus", t("toolbar.tape.straight")],
    ["freehand", "spline", t("toolbar.tape.freehand")],
  ];
}

/**
 * A tape height button's mark: a band as tall as the height, in step with
 * the others (the default heights draw 5, 9 and 15 px), never past the glyph.
 */
function tapeHeightGlyph(height: number): SVGElement {
  const svg = activeDocument.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 28 24");
  svg.setAttribute("width", "28");
  svg.setAttribute("height", "24");
  svg.setAttribute("aria-hidden", "true");
  const tall = Math.max(3, Math.min(20, Math.round(height / 4.8)));
  const rect = activeDocument.createElementNS(SVG_NS, "rect");
  rect.setAttribute("x", "3");
  rect.setAttribute("y", String(12 - tall / 2));
  rect.setAttribute("width", "22");
  rect.setAttribute("height", String(tall));
  rect.setAttribute("rx", "1");
  rect.setAttribute("fill", "currentColor");
  svg.append(rect);
  return svg;
}

/**
 * A preset pen width, in the pill or in the widths popover: the stroke
 * itself, `mark` screen px as it writes now, named by its ink's width
 * (`mm`, "0.62 mm") for screen readers and on hover.
 */
function widthButton(
  parent: HTMLElement,
  mm: string,
  pen: string,
  mark: SizeMark | undefined,
  onPick: () => void,
): HTMLButtonElement {
  const button = parent.createEl("button", { cls: "goodobsidian-width" });
  button.append(widthGlyph(mark, pen));
  button.setAttribute("aria-label", t("toolbar.width.value", { mm }));
  button.setAttribute("title", mm);
  button.addEventListener("click", onPick);
  return button;
}

/**
 * A stroke-width control drawn as a level bar `thickness` screen px thick,
 * its ends in the pen's character (`swoosh` in pen-glyphs.ts).
 */
function widthGlyph(mark: SizeMark | undefined, pen: string): SVGElement {
  const svg = activeDocument.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${SWOOSH_WIDTH} ${SWOOSH_HEIGHT}`);
  svg.setAttribute("width", String(SWOOSH_WIDTH));
  svg.setAttribute("height", String(SWOOSH_HEIGHT));
  svg.setAttribute("aria-hidden", "true");
  const shape = swoosh(pen, mark?.size ?? NaN);
  const path = activeDocument.createElementNS(SVG_NS, "path");
  path.setAttribute("d", shape.d);
  if (shape.strokeWidth === undefined) {
    path.setAttribute("fill", "currentColor");
  } else {
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", String(shape.strokeWidth));
    path.setAttribute("stroke-linecap", shape.cap ?? "round");
  }
  if (shape.opacity !== undefined) path.setAttribute("opacity", String(shape.opacity));
  svg.append(path);
  return svg;
}

/** An outlined 24 × 24 glyph in the pill's own colour, for the text controls. */
function textGlyph(
  draw: (add: (tag: string, attrs: Record<string, string>) => void) => void,
): SVGElement {
  const svg = activeDocument.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "22");
  svg.setAttribute("height", "22");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  draw((tag, attrs) => {
    const el = activeDocument.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    svg.append(el);
  });
  return svg;
}

/**
 * Four lines set the way an alignment sets text. Drawn rather than taken
 * from Lucide, whose alignment icons were renamed between versions Obsidian
 * has shipped.
 */
function alignGlyph(align: TextAlign): SVGElement {
  const widths = align === "justify" ? [16, 16, 16, 9] : [16, 10, 16, 12];
  return textGlyph((add) => {
    widths.forEach((w, i) => {
      const x = align === "right" ? 20 - w : align === "center" ? 12 - w / 2 : 4;
      add("path", { d: `M${x} ${6 + i * 4}h${w}` });
    });
  });
}

/** Line spacing: a double arrow beside three lines. */
function lineSpacingGlyph(): SVGElement {
  return textGlyph((add) => {
    add("path", { d: "M6 4v16M3.5 6.5 6 4l2.5 2.5M3.5 17.5 6 20l2.5-2.5" });
    add("path", { d: "M11 6h9M11 12h9M11 18h9" });
  });
}

/** Box fill: a square, filled with the fill, or struck through for none (GoodNotes' glyph). */
function fillGlyph(fill: string | undefined): SVGElement {
  return textGlyph((add) => {
    add("rect", {
      x: "4",
      y: "4",
      width: "16",
      height: "16",
      rx: "2.5",
      ...(fill ? { fill } : {}),
    });
    if (!fill) add("path", { d: "M6.5 6.5l11 11" });
  });
}

/**
 * Box border, in the pill: a square outlined in the border's colour, as thick
 * as the border and with its corners; a dotted square for none.
 */
function borderGlyph(border: TextStyle["border"], rounded: boolean): SVGElement {
  return textGlyph((add) => {
    const width = border ? Math.min(3.2, 1.2 + border.width * 0.5) : 1.6;
    add("rect", {
      x: "4.5",
      y: "4.5",
      width: "15",
      height: "15",
      rx: rounded ? "4.5" : "0.5",
      "stroke-width": width.toFixed(1),
      ...(border ? { stroke: border.color } : { "stroke-dasharray": "1.5 2.6" }),
    });
  });
}

/** A border width in the border popover: a line that thick, or a struck-out square for none. */
function borderWidthGlyph(width: number | null): SVGElement {
  return textGlyph((add) => {
    if (width === null) {
      add("rect", { x: "4", y: "4", width: "16", height: "16", rx: "2.5" });
      add("path", { d: "M6.5 6.5l11 11" });
      return;
    }
    add("path", { d: "M4 12h16", "stroke-width": String(Math.min(5, 0.8 + width)) });
  });
}

/** A corner of a box at radius `radius` (0 is square), as the corner choices show it. */
function cornerGlyph(radius: number): SVGElement {
  return textGlyph((add) => {
    const r = Math.min(12, radius * 0.5);
    add("path", { d: r > 0 ? `M5 19V${5 + r}a${r} ${r} 0 0 1 ${r} -${r}H19` : "M5 19V5H19" });
  });
}

/** A list: three lines, each led by a dot or a number. */
function listGlyph(kind: ListKind): SVGElement {
  return textGlyph((add) => {
    add("path", { d: "M10 6h10M10 12h10M10 18h10" });
    if (kind === "bullet") {
      for (const y of [6, 12, 18]) {
        add("circle", { cx: "5", cy: String(y), r: "1.3", fill: "currentColor", stroke: "none" });
      }
      return;
    }
    if (kind === "task") {
      // Three boxes, the first ticked.
      for (const y of [6, 12, 18]) {
        add("rect", { x: "2.6", y: String(y - 2.4), width: "4.8", height: "4.8", rx: "1" });
      }
      add("path", { d: "M3.6 6l1.1 1.1 1.9-2.2", "stroke-width": "1.3" });
      return;
    }
    // 1, 2, 3 drawn as strokes, so the glyph needs no font.
    add("path", { d: "M4.2 4.6 5.4 4v4", "stroke-width": "1.4" });
    add("path", { d: "M4 10.6c.4-.6 1.8-.8 2 .1.2.8-2 1.8-2 3h2.2", "stroke-width": "1.4" });
    add("path", {
      d: "M4 16.4c.5-.6 2.1-.6 2 .5-.1.6-.8.7-1.2.7.6 0 1.4.2 1.3.9-.1 1-1.6 1-2.1.4",
      "stroke-width": "1.4",
    });
  });
}

/** A dropdown's chevron, inside the button it opens. */
function caretIn(button: HTMLElement): void {
  iconOrText(button.createSpan({ cls: "goodobsidian-text-caret" }), "chevron-down", "");
}

/** `1` → "1.0", `1.15` → "1.15": how line spacing reads in the menu. */
function formatLineHeight(value: number): string {
  return Number.isInteger(value) ? value.toFixed(1) : String(value);
}

function flagPatch(
  key: "bold" | "italic" | "underline" | "strike" | "caps",
  value: boolean,
): TextStylePatch {
  const patch: TextStylePatch = {};
  patch[key] = value;
  return patch;
}

/**
 * `setIcon` plus the fallback the shipping iPad plugin Pencil documents:
 * "On some older mobile builds plugin-registered icons can come up blank (no
 * `<svg>` child, or an empty one); in that case we fall back to a short text
 * label so the button stays usable." (research/FEASIBILITY.md §2.4.)
 */
/**
 * The eraser mode's icon into `el`, in Lucide's style (24-unit grid, the
 * stroke width the surrounding icons use): Lucide's eraser for Standard;
 * for Whole stroke the eraser with a stroke trailing from its tip; for By
 * line three lines of writing, the middle one going, with a small eraser.
 * Joost's picks from three designs each (2026-10-21).
 */
function eraserModeIcon(el: HTMLElement, mode: EraserMode, label: string): void {
  if (mode === "standard") {
    iconOrText(el, "eraser", label);
    return;
  }
  el.empty();
  const svg = activeDocument.createElementNS(SVG_NS, "svg");
  for (const [key, value] of Object.entries({
    class: "svg-icon goodobsidian-eraser-glyph",
    viewBox: "0 0 24 24",
    width: "24",
    height: "24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  })) {
    svg.setAttribute(key, value);
  }
  const path = (parent: Element, d: string, dash?: string): void => {
    const p = activeDocument.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    if (dash) p.setAttribute("stroke-dasharray", dash);
    // In a scaled group the line keeps the icon's own width.
    if (parent !== svg) p.setAttribute("vector-effect", "non-scaling-stroke");
    parent.appendChild(p);
  };
  const eraser = (transform: string): void => {
    const g = activeDocument.createElementNS(SVG_NS, "g");
    g.setAttribute("transform", transform);
    path(g, "m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21");
    path(g, "m5 11 9 9");
    svg.appendChild(g);
  };
  if (mode === "stroke") {
    eraser("translate(5 0) scale(0.78)");
    path(svg, "M2 21c1.5-3.5 3-5.5 4.5-4s.5 4 2.5 3.5 2-2 3.5-3.2");
  } else {
    path(svg, "M3 5h13");
    path(svg, "M3 10.5h8", "2 2.6");
    path(svg, "M3 16h5");
    eraser("translate(10.5 10.5) scale(0.56)");
  }
  el.appendChild(svg);
}

function iconOrText(el: HTMLElement, icon: string, label: string): void {
  setIcon(el, icon);
  const svg = el.querySelector("svg");
  if (!svg || svg.childElementCount === 0) {
    el.empty();
    el.setText(label.slice(0, 2));
    el.addClass("goodobsidian-icon-fallback");
  }
}
