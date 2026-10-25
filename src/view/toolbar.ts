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
import { drawingToolOf, optionsAfterSwitch, selectedTool } from "./tool-return";
import { setIcon } from "obsidian";
import { DEFAULT_ERASER_SIZE, ERASER_SIZES, PALETTE, SIZES } from "../constants";
import {
  CONNECTOR_PRESETS,
  SHAPE_PRESETS,
  STAR_INNER_RATIO,
  type ShapeMode,
  isShapeMode,
  starPoints,
} from "../ink/shape-geometry";
import {
  type ArrowHead,
  type ShapeDash,
  TEXT_ALIGNS,
  TEXT_FONTS,
  TEXT_FONT_STACKS,
  type TextAlign,
} from "../model/document";
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
  removablePenColor,
  removePenColor,
  reservedPenColors,
  sameColor,
} from "../model/colors";
import { bindSwatchDrag } from "./swatch-drag";
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
import { hiddenEnds, scrollToShow } from "./swatch-drag-model";
import { formatMm } from "../model/units";
import { chosenWidth, nearestStop, widthStops } from "../model/pen-widths";
import { syncRangeFill } from "./range-fill";
import { clampEraserSize, eraserStops, quickEraserSizes } from "../model/eraser-sizes";
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
import {
  MAX_SAVED_PENS,
  type SavedPen,
  mmText,
  samePen,
  savedPenLabel,
  widthFromMm,
} from "../model/saved-pens";
import {
  type PenStabilization,
  stabilizationOf,
  withStabilization,
} from "../model/pen-stabilization";
import { DialogKeyboard } from "./dialog-keyboard";
import {
  DEFAULT_ARROW_HEADS,
  type FillMode,
  type ShapeToolStyle,
  readShapeToolStyle,
} from "../model/shape-style";

/**
 * Tools selectable in the toolbar. Pen, highlighter and shape produce
 * strokes. The laser pointer draws a fading trail that is never kept; it has
 * no bar button (FineNotes#25): L, or the pen type menu.
 */
export type ActiveTool = "pen" | "highlighter" | "eraser" | "select" | "text" | "shape" | "laser";

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
  { id: "fountain", label: "Fountain pen", tool: "pen", pressure: true, sizeScale: 1 },
  { id: "ball", label: "Ball pen", tool: "pen", pressure: false, sizeScale: 1 },
  { id: "brush", label: "Brush pen", tool: "pen", pressure: true, sizeScale: 1.8 },
  // A broad italic nib held at 40°, as calligraphy is taught: thick on the
  // downstrokes, hairline on the upstrokes. Width by direction, not pressure.
  {
    id: "calligraphy",
    label: "Calligraphy pen",
    tool: "pen",
    pressure: false,
    sizeScale: 2.6,
    nib: 40,
  },
  { id: "highlighter", label: "Highlighter", tool: "highlighter", pressure: false, sizeScale: 4 },
];

/**
 * The pen-type menu: every pen type, the highlighter included. The toolbar
 * has no highlighter button of its own (the pen button stands for both, as in
 * GoodNotes), so this menu is the only way to it without a keyboard.
 */
export const PEN_MENU_TYPES: readonly PenTypeSpec[] = PEN_TYPES;
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
  if (state.tool === "shape") return Math.max(0.5, state.size);
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
  { id: "standard", label: "Standard" },
  { id: "stroke", label: "Whole stroke" },
  { id: "ruled", label: "By line (lined paper)" },
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
  all: "All ink",
  highlighter: "Highlighter only",
  pen: "Pen only",
};

/** The lasso's type a toolbar state implies. `undefined` counts as freehand, GoodNotes' default. */
export function lassoModeFor(state: ToolbarState): LassoMode {
  return lassoModeOf(state.lassoMode);
}

/** What the lasso picks up, as a toolbar state implies it. `undefined` counts as everything. */
export function lassoFilterFor(state: ToolbarState): LassoFilter {
  return lassoFilterOf(state.lassoFilter);
}

const LASSO_MODE_LABELS: Record<LassoMode, string> = {
  rect: "Rectangular",
  freehand: "Freehand",
  lines: "By line",
};

/** GoodNotes' "What to include in the selection", less what this plugin does not have. */
const LASSO_FILTER_LABELS: Record<keyof LassoFilter, string> = {
  handwriting: "Handwriting",
  images: "Images",
  shapes: "Shapes",
  arrows: "Arrows",
  textBoxes: "Text boxes",
  tables: "Tables",
  graphs: "Graphs",
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
  auto: "Auto-shape: draw any shape and it snaps clean",
  rect: "Square",
  ellipse: "Circle",
  triangle: "Triangle",
  diamond: "Diamond",
  roundrect: "Rounded square",
  star: "Star",
  line: "Line: drag from start to end",
  arrow: "Arrow: drag from tail to tip",
  table: "Table",
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
  /** Draw-and-hold with the pens. `undefined` counts as enabled. */
  shapeSnapEnabled?: boolean;
  /**
   * The pen's auto-shape toggle: every pen stroke that is plainly a shape
   * snaps to it on lift, as the Shape tool's auto mode does. `undefined`
   * counts as off.
   */
  penAutoShape?: boolean;
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
  /** Scribble to erase and Circle to lasso. `undefined` counts as GoodNotes' defaults. */
  penGestures?: PenGestures;
  /** Eraser mode. `undefined` counts as "standard". */
  eraserMode?: EraserMode;
  /** Eraser diameter in page px. `undefined` counts as {@link DEFAULT_ERASER_SIZE}. */
  eraserSize?: number;
  /** What the eraser may erase. `undefined` counts as everything. */
  eraserFilter?: EraserFilter;
  /** The lasso's type. `undefined` counts as freehand. */
  lassoMode?: LassoMode;
  /** What the lasso picks up. `undefined` counts as everything. */
  lassoFilter?: LassoFilter;
  /** The Text tool's style for new boxes. `undefined` counts as {@link DEFAULT_TEXT_STYLE}. */
  textStyle?: TextStyle;
  /** "Pin Text tool": Text stays the tool after a box is finished. `undefined` counts as unpinned. */
  textPinned?: boolean;
  /**
   * "Drag to size": a drag with the Text tool draws the new box's size.
   * `undefined` counts as off, where every new box fits its text.
   */
  textDragSize?: boolean;
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
  /**
   * Screen px per page px for the size previews: the pen's at the zoom now,
   * the eraser's at fit-to-page. Left out, a page px is drawn as a screen px.
   */
  sizePreviewScales?: () => { pen: number; eraser: number };
  /** "Erase highlighter only" / "Erase pen only" changed. Hosts persist it. */
  onEraserFilterChange?: (filter: EraserFilter) => void;
  /** The lasso's type, or what it picks up, changed. Hosts persist it. */
  onLassoChange?: (mode: LassoMode, filter: LassoFilter) => void;
  /** Add a page; `anchor` is the button, for a popover to hang from. */
  onAddPage?: (anchor: HTMLElement) => void;
  onToggleThumbnails?: () => void;
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
  /** The options pill was placed (it may have moved); `chromeSpans` says where. */
  onPillPlaced?: () => void;
  /** The user dragged the options pill to `dock`; the host keeps it for this device. */
  onPillDock?: (dock: PillDock) => void;
  // --- The Text tool (0.5).
  /** A text control changed: apply `patch` to the box being edited, if there is one. */
  onTextStyle?: (patch: TextStylePatch) => void;
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
  /** The pen's auto-shape toggle changed. Hosts persist it. */
  onPenAutoShapeChange?: (enabled: boolean) => void;
  /** A pen gesture was switched on or off. Hosts persist it. */
  onPenGesturesChange?: (gestures: PenGestures) => void;
  /** A pen type's stroke stabilization changed (every step of a drag). Hosts persist it. */
  onPenStabilization?: (all: PenStabilization) => void;
  /** The Shape tool's colour changed. Hosts persist it. */
  onShapeColorChange?: (color: string) => void;
  /** "Header row" for new tables changed. Hosts persist it. */
  onTableHeaderChange?: (on: boolean) => void;
  /** The notebook's palette, offered first in every colour picker. */
  notebookColors?: () => readonly string[];
  /** The Shape tool's style changed. Hosts persist it. */
  onShapeStyleChange?: (style: ShapeToolStyle) => void;
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
  /** A pen type's own colour or row changed (`ToolbarState.penInks`). Hosts persist them. */
  onPenInks?: (inks: PenInks) => void;
  // --- Saved pens (FineNotes#24, #25). Without `savedPens`, no star in the pill.
  /** The saved pens, as the settings have them now. */
  savedPens?: () => readonly SavedPen[];
  /** "Save current pen": add `pen` to the saved pens. Hosts persist it. */
  onSavePen?: (pen: SavedPen) => void;
  /** "Edit saved pens": open where they are edited (the settings). */
  onEditPens?: () => void;
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
}

/** Minimum gap between the pill and the edge of the page area, in CSS px. */
const EDGE_INSET = 8;
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
 * fit, they fold into the ⋯ panel, least important first, in this order
 * (lower folds first). Undo, the pen, the eraser and ⋯ itself never fold,
 * and neither does the tool in hand.
 */
const FOLD_RANK = {
  fullScreen: 0,
  calculator: 1,
  pdf: 2,
  record: 3,
  image: 4,
  ai: 5,
  search: 6,
  share: 7,
  settings: 8,
  shape: 9,
  text: 10,
  select: 11,
  addPage: 12,
  redo: 13,
  thumbnails: 14,
} as const;

/** How many stroke widths tier 2 shows before the "more" chevron. */
const QUICK_WIDTHS = 3;

/** The pill changing width and place for a new tool: GoodNotes' 0.3 s `ease`. */
const PILL_MORPH_MS = 300;

/** How wide the colour row's faded ends are, CSS px (styles.css); a chosen colour is kept clear of them. */
const COLOR_ROW_FADE_PX = 14;

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
  contents: Map<Element, number>;
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
  /** Watches the pen's colour row give way to a narrow pane (`fitColorRow`). */
  private colorRowWatch: ResizeObserver | null = null;
  /** How far the pen's colour row was scrolled, kept across rebuilds of the pill. */
  private colorRowScroll = 0;
  /** A colour was just added with the "+": the row scrolls to its end once to show it. */
  private revealNewColor = false;
  private readonly widthButtons = new Map<number, HTMLElement>();
  private readonly penTypeButtons = new Map<PenType, HTMLButtonElement>();
  private readonly eraserSizeButtons = new Map<number, HTMLButtonElement>();
  private readonly shapeButtons = new Map<ShapeMode, HTMLButtonElement>();
  /** The Table button's "3 × 4" caption, kept in step with the picked size. */
  private tableCaption: HTMLElement | null = null;
  private thumbnailsButton: HTMLButtonElement | null = null;
  /** Full screen (tablets only, `onFullScreen`); its icon says which way it goes. */
  private fullScreenButton: HTMLButtonElement | null = null;
  /** The tier-1 pen button, drawn as the pen in hand (`drawPenPreview`). */
  private penToolButton: HTMLElement | null = null;
  /** What the pen button last drew, so an unchanged pen is not redrawn. */
  private penPreviewKey = "";
  /** The writing tools, centred on the bar while there is room. */
  private toolsGroup: HTMLElement | null = null;
  /** The tier-1 buttons that may fold into ⋯ (`fitBar`), ranked by `FOLD_RANK`. */
  private readonly foldable: Array<
    FoldedBarItem & { rank: number; button: HTMLElement; tool?: ActiveTool }
  > = [];
  private moreButton: HTMLButtonElement | null = null;
  private settingsButton: HTMLButtonElement | null = null;
  /** "Update available" under the gear while it shows (`showUpdateTip`). */
  private updateTip: HTMLElement | null = null;
  /** Sets `is-crowded` from the groups' widths (`watchCrowding`). */
  private measureCrowding: () => void = () => {};
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
  /** Bar buttons a practice file hides: everything but the pen, the eraser and the page's own. */
  private beyondWriting: HTMLElement[] = [];
  /** A practice file: only what writing needs ({@link setPractice}). */
  private practice = false;
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
  /** Tools whose options were tucked away when they were left: they come back tucked. */
  private readonly tuckedTools = new Set<ActiveTool>();
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
  /** The open pen menu's rows, by pen type, so a colour change repaints their icons. */
  private readonly penMenuRows = new Map<PenType, HTMLElement>();
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
    this.optionsVisible = !STARTS_TUCKED.has(optionsKey(state.tool));
    this.barEl = host.createDiv({ cls: "goodobsidian-toolbar" });
    this.barEl.setAttribute("role", "toolbar");
    this.barEl.setAttribute("aria-label", "Handwriting tools");
    // The pill always floats over the page (styles.css, `.is-floating`).
    this.optionsEl = host.createDiv({ cls: "goodobsidian-options is-floating" });
    this.optionsEl.setAttribute("role", "toolbar");
    this.optionsEl.setAttribute("aria-label", "Tool options");

    this.pillDock = offeredDock(options.pillDock);
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
    const left = this.barEl.createDiv({ cls: "goodobsidian-bar-group" });
    this.thumbnailsButton = this.barButton(
      left,
      "panel-left",
      "Page thumbnails",
      cb.onToggleThumbnails,
    );
    this.fold(
      FOLD_RANK.thumbnails,
      this.thumbnailsButton,
      "panel-left",
      "Page thumbnails",
      cb.onToggleThumbnails,
    );
    const beyond: HTMLElement[] = [];
    this.beyondWriting = beyond;
    const keep = (button: HTMLElement): void => {
      beyond.push(button);
    };
    keep(this.foldButton(left, FOLD_RANK.search, "search", "Search this notebook", cb.onSearch));
    keep(this.foldButton(left, FOLD_RANK.ai, "sparkles", "AI", cb.onAi));
    keep(this.foldButton(left, FOLD_RANK.calculator, "calculator", "Calculator", cb.onCalculator));

    const history = this.barEl.createDiv({ cls: "goodobsidian-bar-group is-centre" });
    this.undoButton = this.barButton(history, "undo-2", "Undo (Cmd/Ctrl+Z)", () =>
      this.callbacks.onUndo(),
    );
    this.redoButton = this.foldButton(
      history,
      FOLD_RANK.redo,
      "redo-2",
      "Redo (Cmd/Ctrl+Shift+Z)",
      () => this.callbacks.onRedo(),
    );

    // The writing tools, centred on the bar (styles.css), as GoodNotes has them.
    const tools = this.barEl.createDiv({ cls: "goodobsidian-bar-group is-tools" });
    this.toolsGroup = tools;
    // First, so every button paints over it.
    this.toolIndicator = tools.createDiv({ cls: "goodobsidian-tool-indicator is-hidden" });
    keep(this.addToolButton(tools, "select", "lasso", "Lasso select (V)"));
    this.addToolButton(tools, "pen", "pen-tool", "Pen (P or W)");
    this.addToolButton(tools, "eraser", "eraser", "Eraser (E)");
    keep(this.addToolButton(tools, "text", "type", "Text box (T)"));
    keep(this.addToolButton(tools, "shape", "shapes", "Shapes (S)"));
    keep(this.foldButton(tools, FOLD_RANK.image, "image", "Insert image", cb.onInsertImage));
    keep(this.foldButton(tools, FOLD_RANK.pdf, "file-text", "Insert PDF", cb.onInsertPdf));
    // The note's recordings live in the page sidebar's Files tab, as in
    // GoodNotes; the mic only starts and stops one.
    this.recordButton = this.foldButton(
      tools,
      FOLD_RANK.record,
      "mic",
      "Record audio",
      cb.onRecord,
    );
    keep(this.recordButton);

    // The document's own actions, right: full screen (tablets), add a page,
    // GoodNotes' share button (export as PDF), its ⋯ sheet for the page
    // being read (bookmark, duplicate, go to page, clear, delete), then,
    // rightmost, the note's own settings.
    const doc = this.barEl.createDiv({ cls: "goodobsidian-bar-group goodobsidian-bar-doc" });
    if (cb.onFullScreen) {
      this.fullScreenButton = this.foldButton(
        doc,
        FOLD_RANK.fullScreen,
        "maximize-2",
        "Full screen",
        cb.onFullScreen,
      );
    }
    this.addPageButton = this.foldButton(doc, FOLD_RANK.addPage, "plus", "Add page", cb.onAddPage);
    keep(this.foldButton(doc, FOLD_RANK.share, "share", "Export as PDF", cb.onShare));
    this.moreButton = this.barButton(doc, "more-horizontal", "More", cb.onMore);
    this.settingsButton = this.foldButton(
      doc,
      FOLD_RANK.settings,
      "settings",
      "Notebook settings",
      cb.onSettings,
    );
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
      const bar = this.barEl.getBoundingClientRect();
      if (bar.width === 0) return;
      const half = tools.getBoundingClientRect().width / 2;
      let leftEdge = bar.left;
      let rightEdge = bar.right;
      for (const group of Array.from(this.barEl.children)) {
        if (group === tools || !group.instanceOf(HTMLElement)) continue;
        const box = group.getBoundingClientRect();
        if (box.width === 0) continue;
        // Where each side's groups sit while the tools are centred.
        if (group.hasClass("goodobsidian-bar-doc")) rightEdge = Math.min(rightEdge, box.left);
        else leftEdge = Math.max(leftEdge, box.right);
      }
      const centre = bar.left + bar.width / 2;
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
      // The buttons moved with the bar: the indicator follows, without a slide.
      this.placeIndicator(this.indicatorTool, null);
      this.placeUpdateTip();
    };
    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(measure);
      observer.observe(this.barEl);
      this.disposers.push(() => observer.disconnect());
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
    const box = bar.getBoundingClientRect();
    if (box.width === 0) return;
    for (const item of this.foldable) item.button.removeClass("is-overflowed");
    this.measureCrowding();
    const style = getComputedStyle(bar);
    const left = box.left + parseFloat(style.paddingLeft);
    const right = box.right - parseFloat(style.paddingRight);
    const overflows = (): boolean =>
      Array.from(bar.children).some((group) => {
        if (!group.instanceOf(HTMLElement)) return false;
        const at = group.getBoundingClientRect();
        return at.width > 0 && (at.right > right + 0.5 || at.left < left - 0.5);
      });
    const order = [...this.foldable].sort((a, b) => a.rank - b.rank);
    for (const item of order) {
      if (!overflows()) break;
      if (item.tool !== undefined && item.tool === active) continue;
      // Hidden for another reason (a practice file, a single page): nothing to fold.
      if (item.button.style.display === "none") continue;
      item.button.addClass("is-overflowed");
      this.measureCrowding();
    }
    this.moreButton?.toggleClass("has-folded", this.foldedItems().length > 0);
    this.moreButton?.toggleClass(
      "has-mark",
      this.foldedItems().some((item) => item.marked),
    );
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
    const text = tip.createSpan({ cls: "goodobsidian-update-tip-text", text: "Update available" });
    text.setAttribute("role", "button");
    text.setAttribute("aria-label", "Update available: open FineNotes' settings");
    text.addEventListener("click", () => {
      this.hideUpdateTip();
      open();
    });
    const close = tip.createSpan({ cls: "goodobsidian-update-tip-close" });
    setIcon(close, "x");
    close.setAttribute("role", "button");
    close.setAttribute("aria-label", "Dismiss");
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
    const room = (tip.ownerDocument.defaultView ?? window).innerWidth;
    const left = Math.min(Math.max(8, at.left + at.width / 2 + 22 - width), room - width - 8);
    tip.setCssStyles({ top: `${Math.round(at.bottom + 6)}px`, left: `${Math.round(left)}px` });
  }

  private hideUpdateTip(): void {
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
      version === null ? "Notebook settings" : `Notebook settings · FineNotes ${version} is out`,
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
    const label = on ? "Leave full screen" : "Full screen";
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
      button.setAttribute("title", `${label} — not available yet`);
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

  /**
   * The pen button as its own preview, as Apple's pen picker draws each
   * tool: the pen type in hand, its nib in the ink colour, over a mark as
   * thick as the width it writes (`widthMarkThickness`). Redrawn only when
   * one of those changes, since `syncActive` runs on every pick.
   */
  private drawPenPreview(): void {
    const button = this.penToolButton;
    if (!button) return;
    const spec = this.activePenType();
    const color = this.state.color;
    const width = strokeWidthFor({ ...this.state, tool: spec.tool });
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
    button.setAttribute("aria-label", `${spec.label} (P or W)`);
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
    button.setAttribute("aria-label", `Lasso select: ${LASSO_MODE_LABELS[mode].toLowerCase()} (V)`);
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
    eraserModeIcon(button, mode, "Eraser");
    const label = ERASER_MODES.find((m) => m.id === mode)?.label ?? "Standard";
    button.setAttribute(
      "aria-label",
      mode === "standard" ? "Eraser (E)" : `Eraser: ${label.toLowerCase()} (E)`,
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
    if (tool === "pen") tool = this.activePenType().tool;
    const current = this.state.tool;
    this.drawingTool = drawingToolOf(this.drawingTool, current);
    tool = selectedTool(
      current,
      tool,
      this.callbacks.returnToPenOnReselect?.() === true,
      this.drawingTool,
    );
    if (tool === "select" && current === "select") {
      this.toggleLassoPopover(button);
      return;
    }
    this.closePopover();
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
  private leaveToolFor(next: ActiveTool): void {
    if (optionsKey(next) === optionsKey(this.optionsTool)) return;
    if (this.optionsVisible) this.tuckedTools.delete(optionsKey(this.optionsTool));
    else this.tuckedTools.add(optionsKey(this.optionsTool));
    const remembered =
      !this.tuckedTools.has(optionsKey(next)) && !STARTS_TUCKED.has(optionsKey(next));
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
    this.colorSwatches.clear();
    this.widthButtons.clear();
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
    // One live pen button, not four permanent swatches. The three pen styles
    // remain one tap away in its menu, keeping the writing area clear.
    const active = this.activePenType();
    const pen = this.optionsEl.createEl("button", { cls: "goodobsidian-pentype" });
    pen.append(penGlyph(active.id, this.state.color));
    pen.setAttribute("aria-label", `${active.label} options`);
    pen.setAttribute("title", `${active.label} options`);
    pen.addEventListener("click", () => this.togglePenTypeList());
    this.penTypeButtons.set(active.id, pen);
    // Upright at a side, the pill folds as GoodNotes' does: the pen type is
    // one button, the widths one, and the colours three and a ⌄.
    const upright = isUpright(this.pillDock);
    if (!upright) this.chevron("Pen options", () => this.togglePenTypeList());

    this.optionsEl.createDiv({ cls: "goodobsidian-sep" });

    if (upright) {
      const width = this.state.size;
      const button = widthButton(
        this.optionsEl,
        this.widthMm(width),
        active.id,
        this.widthMark(width),
        () => this.toggleWidthList(button),
      );
      button.setAttribute("aria-label", `Width ${this.widthMm(width)}: more widths`);
      this.widthButtons.set(width, button);
    } else {
      // Stroke widths, drawn as literal strokes of increasing weight.
      for (const width of this.quickWidths()) {
        const button = widthButton(
          this.optionsEl,
          this.widthMm(width),
          active.id,
          this.widthMark(width),
          () => {
            this.setWidth(width);
            this.syncActive();
          },
        );
        this.widthButtons.set(width, button);
      }
      this.chevron("More widths", (button) => this.toggleWidthList(button));
    }

    this.optionsEl.createDiv({ cls: "goodobsidian-sep" });

    const colors = this.quickColors();
    if (upright) {
      // The chosen colour and its neighbours; the ⌄ holds the whole row.
      const chosen = colors.findIndex((c) => sameColor(c, this.state.color));
      const first = colorWindow(colors.length, chosen, UPRIGHT_COLORS);
      for (const color of colors.slice(first, first + UPRIGHT_COLORS)) {
        this.penSwatch(this.optionsEl, color, colors);
      }
      this.chevron("All colours", (button) => this.togglePenColorList(button));
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
    const on = this.state.penAutoShape === true;
    const label = on ? "Auto shape: on" : "Auto shape: off";
    auto.setAttribute("aria-label", label);
    auto.setAttribute("title", `${label} — a stroke that is a shape becomes one`);
    auto.setAttribute("aria-pressed", String(on));
    auto.toggleClass("is-active", on);
    auto.addEventListener("click", () => {
      this.state.penAutoShape = !on;
      this.callbacks.onPenAutoShapeChange?.(!on);
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
      iconOrText(saved, "star", "Saved pens");
      saved.setAttribute("aria-label", "Saved pens (1–8)");
      saved.setAttribute("title", "Saved pens (1–8)");
      saved.setAttribute("aria-haspopup", "dialog");
      saved.addEventListener("click", () => this.toggleSavedPens(saved));
    }
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
    more.setAttribute("aria-label", "Add colour");
    more.setAttribute("title", "Add colour");
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
      more.setAttribute("aria-label", "Add colour");
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
   * Scroll the rebuilt colour row back to where it was, or to its end when a
   * colour was just added, keeping the chosen colour in view; and fade the
   * ends that hide more. A wheel scrolls it sideways, for a mouse.
   */
  private fitColorRow(row: HTMLElement): void {
    const fade = (): void => {
      const ends = hiddenEnds(row.scrollLeft, row.clientWidth, row.scrollWidth);
      row.toggleClass("has-more-start", ends.start);
      row.toggleClass("has-more-end", ends.end);
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
    // The row gives way when the pill has too little room, which can settle
    // after it was built (the pill is placed afterwards): look again then.
    this.colorRowWatch?.disconnect();
    this.colorRowWatch = null;
    if (typeof ResizeObserver !== "undefined") {
      let width = row.clientWidth;
      this.colorRowWatch = new ResizeObserver(() => {
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
    swatch.setCssStyles({ backgroundColor: color });
    // The chosen swatch wears a ▾ in whichever of dark or white reads on it.
    swatch.setCssProps({ "--gob-swatch-mark": contrastMark(color) });
    iconOrText(swatch.createSpan({ cls: "goodobsidian-swatch-mark" }), "chevron-down", "▾");
    swatch.setAttr("aria-label", color);
    swatch.addEventListener("click", onPick);
    return swatch;
  }

  /** The laser has nothing to set: the pill says what it is and that nothing it draws stays. */
  private buildLaserOptions(): void {
    const note = this.optionsEl.createDiv({ cls: "goodobsidian-laser-note" });
    iconOrText(note.createSpan({ cls: "goodobsidian-laser-note-icon" }), "pointer", "");
    note.createSpan({ text: "Laser pointer (L): its trail fades and is never saved" });
  }

  /**
   * The saved pens' popover: each pen with its number key, the one in hand
   * marked; then Save current pen, and a way to the settings, where they are
   * reordered and deleted.
   */
  private toggleSavedPens(anchor: HTMLElement): void {
    if (this.popoverKind === "saved-pens") {
      this.closePopover();
      return;
    }
    const body = this.openPopover("saved-pens", anchor);
    body.addClass("goodobsidian-saved-pens-popover");
    this.popoverRender = () => {
      body.empty();
      this.renderSavedPens(body);
      this.keepPopoverInside(anchor);
    };
    this.popoverRender();
  }

  private renderSavedPens(body: HTMLElement): void {
    body.createDiv({ cls: "goodobsidian-popover-label", text: "Saved pens" });
    const pens = this.callbacks.savedPens?.() ?? [];
    const current = penOfState(this.state);
    const inHand = this.state.tool === "pen" || this.state.tool === "highlighter";
    pens.forEach((pen, index) => {
      const spec = PEN_TYPES.find((type) => type.id === pen.type) ?? PEN_TYPES[0];
      const row = body.createEl("button", {
        cls: "goodobsidian-wide goodobsidian-pen-row goodobsidian-saved-pen",
      });
      row.append(penGlyph(spec.id, pen.color));
      row.createSpan({ cls: "goodobsidian-saved-pen-label", text: savedPenLabel(pen) });
      row.createEl("kbd", { cls: "goodobsidian-saved-pen-key", text: String(index + 1) });
      row.toggleClass("is-active", inHand && samePen(pen, current));
      row.addEventListener("click", () => {
        this.closePopover();
        this.applySavedPen(pen);
      });
    });
    if (pens.length === 0) {
      body.createDiv({ cls: "goodobsidian-popover-hint", text: "No saved pens yet." });
    }
    body.createDiv({ cls: "goodobsidian-popover-divider" });
    const saved = pens.some((pen) => samePen(pen, current));
    const add = body.createEl("button", {
      cls: "goodobsidian-wide goodobsidian-popover-link clickable-icon",
    });
    add.createSpan({
      text: saved
        ? "This pen is saved"
        : pens.length >= MAX_SAVED_PENS
          ? `Saved pens are full (${MAX_SAVED_PENS})`
          : "Save current pen",
    });
    add.disabled = !inHand || saved || pens.length >= MAX_SAVED_PENS || !this.callbacks.onSavePen;
    add.addEventListener("click", () => {
      if (add.disabled) return;
      this.callbacks.onSavePen?.(current);
      this.popoverRender?.();
    });
    if (!this.callbacks.onEditPens) return;
    const edit = body.createEl("button", {
      cls: "goodobsidian-wide goodobsidian-popover-link clickable-icon",
    });
    edit.createSpan({ text: "Edit saved pens" });
    iconOrText(edit.createSpan({ cls: "goodobsidian-popover-link-icon" }), "chevron-right", ">");
    edit.addEventListener("click", () => {
      this.closePopover();
      this.callbacks.onEditPens?.();
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
    modeButton.createSpan({ text: mode.label });
    const modeCaret = modeButton.createSpan({ cls: "goodobsidian-erasermode-caret" });
    iconOrText(modeCaret, "chevron-down", "");
    modeButton.setAttribute("aria-label", `Eraser mode: ${mode.label}`);
    modeButton.addEventListener("click", () => this.toggleEraserModeList(modeButton));

    this.optionsEl.createDiv({ cls: "goodobsidian-sep" });

    // Sizes, drawn as eraser footprints of increasing diameter: the presets,
    // with a size set on the slider in place of the nearest one. The chevron
    // opens the slider, as the pen's widths do.
    for (const size of quickEraserSizes(eraserSizeFor(this.state))) {
      const button = this.optionsEl.createEl("button", { cls: "goodobsidian-erasersize" });
      button.append(eraserSizeGlyph(this.eraserMark(size)));
      button.setAttribute("aria-label", `Eraser size ${this.eraserMm(size)}`);
      button.addEventListener("click", () => {
        this.setEraserSize(size);
        this.syncActive();
      });
      this.eraserSizeButtons.set(size, button);
    }
    this.chevron("Eraser size", (anchor) => this.toggleEraserSizeList(anchor));

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
    filterButton.createSpan({ text: ERASER_FILTER_LABELS[filter] });
    const filterCaret = filterButton.createSpan({ cls: "goodobsidian-erasermode-caret" });
    iconOrText(filterCaret, "chevron-down", "");
    filterButton.toggleClass("is-filtered", filter !== "all");
    filterButton.setAttribute("aria-label", `Eraser erases: ${ERASER_FILTER_LABELS[filter]}`);
    filterButton.addEventListener("click", () => this.toggleEraserFilterList(filterButton));

    this.optionsEl.createDiv({ cls: "goodobsidian-sep" });
    const clear = this.optionsEl.createEl("button", {
      cls: "goodobsidian-text-button",
      text: "Clear page",
    });
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
    // and a caret, opening the colour picker.
    this.optionsEl.createDiv({ cls: "goodobsidian-sep" });
    const color = this.state.shapeColor ?? DEFAULT_SHAPE_COLOR;
    const button = this.optionsEl.createEl("button", {
      cls: "goodobsidian-shape-color clickable-icon",
    });
    button.createSpan({ cls: "goodobsidian-text-disc" }).setCssStyles({ background: color });
    caretIn(button);
    button.setAttribute("aria-label", `Shape colour ${color}`);
    button.setAttribute("title", "Shape colour");
    button.addEventListener("click", () =>
      this.toggleColorPopover("shape-color", button, color, (picked) => {
        this.state.shapeColor = picked;
        this.callbacks.onShapeColorChange?.(picked);
        this.buildOptions();
      }),
    );

    // Fill, line, corners and arrowheads, in one popover; the button shows
    // the fill and line a new shape gets.
    const styleButton = this.optionsEl.createEl("button", {
      cls: "goodobsidian-shape-style clickable-icon",
    });
    styleButton.append(shapeStyleGlyph(readShapeToolStyle(this.state.shapeStyle), color));
    caretIn(styleButton);
    styleButton.setAttribute("aria-label", "Shape style: fill, line, corners and arrowheads");
    styleButton.setAttribute("title", "Shape style");
    styleButton.addEventListener("click", () => this.toggleShapeStylePopover(styleButton));
  }

  private toggleShapeStylePopover(anchor: HTMLElement): void {
    if (this.popoverKind === "shape-style") {
      this.closePopover();
      return;
    }
    const body = this.openPopover("shape-style", anchor);
    body.addClass("goodobsidian-shape-style-popover");
    this.renderShapeStyle(body, anchor);
    this.keepPopoverInside(anchor);
  }

  /**
   * The Shape tool's style. Each choice applies at once and the popover
   * stays open, so a shape can be set up in one visit, as a text box's
   * border is.
   */
  private renderShapeStyle(body: HTMLElement, anchor: HTMLElement): void {
    body.empty();
    const style = readShapeToolStyle(this.state.shapeStyle);
    const color = this.state.shapeColor ?? DEFAULT_SHAPE_COLOR;
    const set = (patch: Partial<ShapeToolStyle>): void => {
      const next: ShapeToolStyle = { ...style, ...patch };
      for (const key of Object.keys(next) as Array<keyof ShapeToolStyle>) {
        if (next[key] === undefined) delete next[key];
      }
      this.state.shapeStyle = next;
      this.callbacks.onShapeStyleChange?.(next);
      anchor.querySelector("svg")?.replaceWith(shapeStyleGlyph(next, color));
      this.renderShapeStyle(body, anchor);
    };
    const choices = <T>(
      label: string,
      options: ReadonlyArray<{ value: T; name: string; glyph: SVGElement }>,
      current: T,
      pick: (value: T) => void,
    ): void => {
      body.createDiv({ cls: "goodobsidian-popover-label", text: label });
      const row = body.createDiv({ cls: "goodobsidian-text-row" });
      for (const option of options) {
        const button = this.textOption(row, "is-flag", "", () => pick(option.value));
        button.append(option.glyph);
        button.setAttribute("aria-label", option.name);
        button.setAttribute("title", option.name);
        const on = option.value === current;
        button.setAttribute("aria-pressed", String(on));
        button.toggleClass("is-active", on);
      }
    };
    choices<FillMode | undefined>(
      "Fill",
      [
        { value: undefined, name: "No fill", glyph: shapeFillGlyph(undefined, color) },
        { value: "soft", name: "Soft fill", glyph: shapeFillGlyph("soft", color) },
        { value: "solid", name: "Solid fill", glyph: shapeFillGlyph("solid", color) },
      ],
      style.fill,
      (fill) => set({ fill }),
    );
    choices<ShapeDash | undefined>(
      "Line",
      [
        { value: undefined, name: "Solid line", glyph: dashGlyph(undefined) },
        { value: "dash", name: "Dashed line", glyph: dashGlyph("dash") },
        { value: "dot", name: "Dotted line", glyph: dashGlyph("dot") },
      ],
      style.dash,
      (dash) => set({ dash }),
    );
    this.switchRow(
      body.createDiv({ cls: "goodobsidian-switch-list goodobsidian-text-switches" }),
      "Rounded corners",
      style.round === true,
      (on) => set({ round: on ? true : undefined }),
    );
    const heads = style.heads ?? DEFAULT_ARROW_HEADS;
    const headOptions = (
      end: "start" | "end",
    ): Array<{
      value: ArrowHead | undefined;
      name: string;
      glyph: SVGElement;
    }> => [
      { value: undefined, name: `No head at the ${end}`, glyph: headGlyph(end, undefined) },
      { value: "open", name: `Open head at the ${end}`, glyph: headGlyph(end, "open") },
      { value: "filled", name: `Filled head at the ${end}`, glyph: headGlyph(end, "filled") },
    ];
    choices("Arrow start", headOptions("start"), heads.start, (start) =>
      set({ heads: { ...(start ? { start } : {}), ...(heads.end ? { end: heads.end } : {}) } }),
    );
    choices("Arrow end", headOptions("end"), heads.end, (end) =>
      set({ heads: { ...(heads.start ? { start: heads.start } : {}), ...(end ? { end } : {}) } }),
    );
  }

  /** Put the current table size on the Table button, and in its label. */
  private refreshTableButton(): void {
    const label = tableSizeLabel(tableSizeFor(this.state));
    this.tableCaption?.setText(label);
    const button = this.shapeButtons.get("table");
    button?.setAttribute("aria-label", `Table, ${label}: pick a size, then drag on the page`);
    button?.setAttribute("title", `Table, ${label}`);
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
      title.setText(`Table · ${tableSizeLabel(size)}`);
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
        button.setAttribute("aria-label", `${tableSizeLabel(size)} table`);
        button.addEventListener("pointerenter", () => show(size));
        button.addEventListener("focus", () => show(size));
        button.addEventListener("click", () => this.pickTableSize(size));
        cells.push({ button, size });
      }
    }
    grid.addEventListener("pointerleave", () => show(tableSizeFor(this.state)));
    this.switchRow(
      body.createDiv({ cls: "goodobsidian-switch-list goodobsidian-text-switches" }),
      "Header row",
      this.state.tableHeader === true,
      (on) => {
        this.state.tableHeader = on;
        this.callbacks.onTableHeaderChange?.(on);
      },
    );
    body.createDiv({
      cls: "goodobsidian-popover-hint",
      text: "Then drag it out on the page, or tap to place it",
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
    // Repeated selection may now return to Pen, so keep the lasso settings reachable.
    if (this.callbacks.returnToPenOnReselect?.() === true)
      this.barButton(this.optionsEl, "settings-2", "Lasso options", (button) =>
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
    body.createDiv({ cls: "goodobsidian-popover-title", text: "Lasso tool" });
    body.createDiv({ cls: "goodobsidian-popover-label", text: "Lasso type" });
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

    body.createDiv({ cls: "goodobsidian-popover-label", text: "What to include in the selection" });
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
      `Text style: ${preset?.name ?? "custom"}`,
      (b) => this.toggleTextPopover("preset", b, (body) => this.renderTextPresets(body)),
    );
    styles.createSpan({ cls: "goodobsidian-text-drop-label", text: preset?.name ?? "Style" });
    caretIn(styles);

    const color = this.textControl("is-color", "Text colour", (b) =>
      this.toggleTextPopover("color", b, (body) => this.renderTextColors(body)),
    );
    // The disc *is* the text colour: a value, not chrome.
    color.createSpan({ cls: "goodobsidian-text-disc" }).setCssStyles({ background: style.color });
    caretIn(color);

    // To one decimal: a box resized before sizes were rounded may hold more.
    const shownSize = String(Math.round(style.fontSize * 10) / 10);
    const size = this.textControl("is-drop is-size", `Font size ${shownSize}`, (b) =>
      this.toggleTextPopover("size", b, (body) => this.renderTextSizes(body)),
    );
    size.createSpan({ cls: "goodobsidian-text-drop-label", text: shownSize });
    caretIn(size);

    // The font's name, set in that font, as GoodNotes shows it.
    const font = fontOf(style);
    const fontButton = this.textControl("is-drop is-font", `Font: ${TEXT_FONT_LABELS[font]}`, (b) =>
      this.toggleTextPopover("font", b, (body) => this.renderTextFonts(body)),
    );
    fontButton
      .createSpan({ cls: "goodobsidian-text-drop-label", text: TEXT_FONT_LABELS[font] })
      .setCssStyles({ fontFamily: TEXT_FONT_STACKS[font] });
    caretIn(fontButton);

    const format = this.textControl("is-format", "Bold, italic, underline, strikethrough", (b) =>
      this.toggleTextPopover("format", b, (body) => this.renderTextFormat(body)),
    );
    format.createSpan({ cls: "goodobsidian-text-b", text: "B" });
    format.createSpan({ cls: "goodobsidian-text-i", text: "I" });
    format.toggleClass("is-on", !!(style.bold || style.italic || style.underline || style.strike));

    const align = style.align ?? "left";
    this.textControl("is-glyph", `Alignment: ${TEXT_ALIGN_LABELS[align]}`, (b) =>
      this.toggleTextPopover("align", b, (body) => this.renderTextAlign(body)),
    ).append(alignGlyph(align));

    this.textControl("is-glyph", `Line spacing ${formatLineHeight(lineHeightOf(style))}`, (b) =>
      this.toggleTextPopover("spacing", b, (body) => this.renderTextSpacing(body)),
    ).append(lineSpacingGlyph());

    // Bullets and numbering act on the text under the caret: only while a box is edited.
    const list = this.textControl("is-glyph", "Bullets and numbering", (b) =>
      this.toggleTextPopover("list", b, (body) => this.renderTextLists(body)),
    );
    list.append(listGlyph("bullet"));
    list.disabled = this.textTarget === null;

    this.optionsEl.createDiv({ cls: "goodobsidian-sep" });

    this.textControl("is-glyph", style.fill ? "Box fill" : "Box fill: none", (b) =>
      this.toggleTextPopover("fill", b, (body) => this.renderTextFills(body)),
    ).append(fillGlyph(style.fill));

    this.textControl("is-glyph", style.border ? "Box border" : "Box border: none", (b) =>
      this.toggleTextPopover("border", b, (body) => this.renderTextBorder(body)),
    ).append(borderGlyph(style.border, style.radius !== undefined));

    // "Drag to size text boxes" is a setting (Writing and tools), not a pill
    // button: it is a way of working, set once, not a style of one box.

    // GoodNotes' "Pin Text tool". Unpinned, finishing a box hands the page
    // back to the tool used before Text; pinned, Text stays.
    const pinned = this.state.textPinned === true;
    const pin = this.textControl("is-pin", "Pin Text tool", () => {
      this.state.textPinned = !pinned;
      this.saveTextTool();
      this.buildOptions();
    });
    // Labelled, as GoodNotes has it; a pane too narrow for the whole pill
    // (fitTextPill) drops the label and keeps the icon.
    iconOrText(pin.createSpan({ cls: "goodobsidian-text-pin-icon" }), "pin", "Pin");
    pin.createSpan({ cls: "goodobsidian-text-pin-label", text: "Pin Text tool" });
    pin.toggleClass("is-active", pinned);
    pin.setAttribute("aria-pressed", String(pinned));

    // Delete the box being edited: last, apart, and red, so it is not hit
    // by accident. Only while a box has focus; Undo brings it back.
    if (this.callbacks.onTextDelete) {
      this.optionsEl.createDiv({ cls: "goodobsidian-sep" });
      const remove = this.textControl("is-delete", "Delete text box", () =>
        this.callbacks.onTextDelete?.(),
      );
      iconOrText(remove.createSpan({ cls: "goodobsidian-text-pin-icon" }), "trash-2", "Delete");
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
    const floor = Math.min(hostBox.bottom, window.innerHeight - keyboardHeight()) - EDGE_INSET;
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
    body.createDiv({ cls: "goodobsidian-popover-label", text: "Colour" });
    renderColorPicker(body, {
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
    head.createDiv({ cls: "goodobsidian-popover-label", text: "Size" });
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
      attr: { "aria-label": "Font size" },
    });
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

  private renderTextFonts(body: HTMLElement): void {
    body.createDiv({ cls: "goodobsidian-popover-label", text: "Font" });
    const current = fontOf(this.shownTextStyle());
    for (const font of TEXT_FONTS) {
      const button = this.textOption(body, "is-wide", TEXT_FONT_LABELS[font], () =>
        this.pickText({ font }),
      );
      button.setCssStyles({ fontFamily: TEXT_FONT_STACKS[font] });
      button.toggleClass("is-active", font === current);
    }
  }

  /** The named styles, each shown in its own look; a pick applies it and closes. */
  private renderTextPresets(body: HTMLElement): void {
    body.createDiv({ cls: "goodobsidian-popover-label", text: "Text style" });
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
    body.createDiv({ cls: "goodobsidian-popover-label", text: "Text style" });
    const row = body.createDiv({ cls: "goodobsidian-text-row" });
    const style = this.shownTextStyle();
    const flags = [
      { key: "bold", glyph: "B", label: "Bold" },
      { key: "italic", glyph: "I", label: "Italic" },
      { key: "underline", glyph: "U", label: "Underline" },
      { key: "strike", glyph: "S", label: "Strikethrough" },
      { key: "caps", glyph: "AA", label: "All capitals" },
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
  }

  private renderTextAlign(body: HTMLElement): void {
    body.createDiv({ cls: "goodobsidian-popover-label", text: "Alignment" });
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
    body.createDiv({ cls: "goodobsidian-popover-label", text: "Line spacing" });
    const current = lineHeightOf(this.shownTextStyle());
    for (const lineHeight of LINE_HEIGHTS) {
      // The default is a choice like any other; picking it removes the key.
      const label =
        lineHeight === DEFAULT_LINE_HEIGHT
          ? `${formatLineHeight(lineHeight)} (default)`
          : formatLineHeight(lineHeight);
      this.textOption(body, "is-wide", label, () => this.pickText({ lineHeight })).toggleClass(
        "is-active",
        Math.abs(lineHeight - current) < 1e-9,
      );
    }
  }

  private renderTextFills(body: HTMLElement): void {
    body.createDiv({ cls: "goodobsidian-popover-label", text: "Box fill" });
    renderColorPicker(body, {
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
    body.createDiv({ cls: "goodobsidian-popover-label", text: "Border" });
    const row = body.createDiv({ cls: "goodobsidian-text-row" });
    const widths = [
      { label: "None", width: null },
      ...TEXT_BORDER_CHOICES.map((width) => ({ label: `${width} px`, width })),
    ];
    for (const { label, width } of widths) {
      const button = this.textOption(row, "is-flag", "", () =>
        this.applyTextPatch({ borderWidth: width }),
      );
      button.append(borderWidthGlyph(width));
      const name = width === null ? "No border" : `${label} border`;
      button.setAttribute("aria-label", name);
      button.setAttribute("title", name);
      const on = width === null ? !style.border : style.border?.width === width;
      button.setAttribute("aria-pressed", String(on));
      button.toggleClass("is-active", on);
    }
    body.createDiv({ cls: "goodobsidian-popover-label", text: "Corners" });
    const corners = body.createDiv({ cls: "goodobsidian-text-row" });
    for (const { label, radius } of TEXT_CORNER_CHOICES) {
      const on = radius === 0 ? style.radius === undefined : style.radius === radius;
      const button = this.textOption(corners, "is-flag", "", () =>
        this.applyTextPatch({ radius: radius === 0 ? null : radius }),
      );
      button.append(cornerGlyph(radius));
      button.setAttribute("aria-label", `${label} corners`);
      button.setAttribute("title", `${label} corners`);
      button.setAttribute("aria-pressed", String(on));
      button.toggleClass("is-active", on);
    }
    body.createDiv({ cls: "goodobsidian-popover-label", text: "Padding" });
    const paddings = body.createDiv({ cls: "goodobsidian-text-row" });
    for (const { label, padding } of TEXT_PADDINGS) {
      const on = padding === 0 ? style.padding === undefined : style.padding === padding;
      const button = this.textOption(paddings, "is-flag is-padding", label, () =>
        this.applyTextPatch({ padding: padding === 0 ? null : padding }),
      );
      button.setAttribute("aria-label", padding === 0 ? "No padding" : `Padding ${label}`);
      button.setAttribute("aria-pressed", String(on));
      button.toggleClass("is-active", on);
    }
    body.createDiv({ cls: "goodobsidian-popover-label", text: "Border colour" });
    const current = style.border?.color ?? style.color;
    // A colour picked with no border adds a thin one in that colour.
    renderColorPicker(body, {
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
    body.createDiv({ cls: "goodobsidian-popover-label", text: "Lists" });
    const row = body.createDiv({ cls: "goodobsidian-text-row" });
    const kinds: Array<{ kind: ListKind; label: string }> = [
      { kind: "bullet", label: "Bullets" },
      { kind: "number", label: "Numbering" },
      { kind: "task", label: "Checklist" },
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

  /** Three widths around the active one, per the reference screenshot. */
  private quickWidths(): number[] {
    const quick = this.widths.slice(0, QUICK_WIDTHS);
    // The live width takes the last slot, a preset or one set on the slider.
    const size = this.state.size;
    if (!quick.includes(size) && Number.isFinite(size) && size > 0) {
      quick[quick.length - 1] = size;
    }
    return quick;
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
    head.createDiv({ cls: "goodobsidian-popover-label", text: "Stroke width" });
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
        "aria-label": "Stroke width in millimetres",
      },
    });
    readout.createSpan({ cls: "goodobsidian-width-unit", text: "mm" });
    const reset = head.createEl("button", {
      cls: "goodobsidian-width-reset clickable-icon",
      attr: { "aria-label": "Reset stroke width", title: "Reset stroke width" },
    });
    iconOrText(reset, "rotate-ccw", "Reset");
    const slider = body.createDiv({ cls: "goodobsidian-width-slider" });
    const range = slider.createEl("input", {
      cls: "goodobsidian-width-range",
      type: "range",
      attr: { "aria-label": "Stroke width" },
    });
    // Stops, not widths: the pens' fine end steps in 0.05 mm, the rest in
    // half px (FineNotes#7). The highlighter keeps the thinnest preset.
    const highlighter =
      this.state.tool !== "shape" && penTypeFor(this.state).tool === "highlighter";
    const floor = highlighter ? Math.min(...this.widths) : 0;
    const stops = widthStops(this.widths, !highlighter);
    range.min = "0";
    range.max = String(stops.length - 1);
    range.step = "1";
    const preview = strokePreview(body);
    const row = body.createDiv({ cls: "goodobsidian-sizes" });
    const presets = new Map<number, HTMLElement>();
    // The readout, the thumb, the preview and the presets always show the live width.
    const show = (): void => {
      const width = chosenWidth(this.state.size, floor);
      // In mm of ink on the page: a highlighter's band, not the width before its 4x.
      if (activeDocument.activeElement !== field) field.value = mmText(width, this.inkScale());
      field.setAttribute("title", this.widthMm(width));
      range.value = String(nearestStop(stops, width));
      syncRangeFill(range);
      markChosen(presets, this.state.size);
      const color =
        this.state.tool === "shape"
          ? (this.state.shapeColor ?? DEFAULT_SHAPE_COLOR)
          : this.state.color;
      // A shape's outline is one even line, whatever pen is chosen.
      const pen = this.state.tool === "shape" ? "ball" : this.activePenType().id;
      preview(strokeWidthFor(this.state) * this.previewScales().pen, color, pen);
    };
    const pick = (width: number): void => {
      this.setWidth(width);
      show();
    };
    // After a preset or a reset, the pill's quick widths are rebuilt around it.
    const settle = (): void => {
      this.buildOptions();
      this.syncActive();
    };
    for (const width of this.widths) {
      const preset = widthButton(
        row,
        this.widthMm(width),
        this.activePenType().id,
        this.widthMark(width),
        () => {
          pick(width);
          this.closePopover();
          settle();
        },
      );
      presets.set(width, preset);
    }
    // The zoom changed under the open popover: its marks follow the ink.
    this.sizeMarksRender = () => {
      for (const [width, preset] of presets) {
        preset
          .querySelector("svg")
          ?.replaceWith(widthGlyph(this.widthMark(width), this.activePenType().id));
      }
      show();
    };
    // Live while dragging; the pill's widths follow once the thumb is let go.
    range.addEventListener("input", () => pick(stops[Number(range.value)] ?? this.state.size));
    range.addEventListener("change", settle);
    reset.addEventListener("click", () => {
      pick(this.options.defaultSize ?? this.widths[Math.floor(this.widths.length / 2)]);
      settle();
    });
    const typed = (): void => {
      const width = widthFromMm(field.value, this.inkScale());
      field.toggleClass("is-invalid", width === null);
      if (width === null) return;
      pick(width);
      field.value = mmText(chosenWidth(this.state.size, floor), this.inkScale());
      settle();
    };
    field.addEventListener("change", typed);
    field.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        typed();
      }
    });
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

  /** How wide an eraser size's mark is drawn, screen px: its footprint on the page. */
  private eraserMark(size: number): number {
    return size * this.previewScales().eraser;
  }

  /**
   * An eraser size in millimetres of paper it erases now. The eraser keeps
   * its size on screen, so zoomed in it covers less of the page: at 2.5x
   * the size that takes 4.9 mm at fit takes 2.0 mm.
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
    for (const [width, button] of this.widthButtons) {
      button.querySelector("svg")?.replaceWith(widthGlyph(this.widthMark(width), pen));
    }
    for (const [size, button] of this.eraserSizeButtons) {
      button.querySelector("svg")?.replaceWith(eraserSizeGlyph(this.eraserMark(size)));
      button.setAttribute("aria-label", `Eraser size ${this.eraserMm(size)}`);
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
    head.createDiv({ cls: "goodobsidian-popover-label", text: "Eraser size" });
    const readout = head.createSpan({ cls: "goodobsidian-width-readout" });
    const reset = head.createEl("button", {
      cls: "goodobsidian-width-reset clickable-icon",
      attr: { "aria-label": "Reset eraser size", title: "Reset eraser size" },
    });
    iconOrText(reset, "rotate-ccw", "Reset");
    const slider = body.createDiv({ cls: "goodobsidian-width-slider" });
    const range = slider.createEl("input", {
      cls: "goodobsidian-width-range",
      type: "range",
      attr: { "aria-label": "Eraser size" },
    });
    const stops = eraserStops();
    range.min = "0";
    range.max = String(stops.length - 1);
    range.step = "1";
    const preview = eraserPreview(body);
    const row = body.createDiv({ cls: "goodobsidian-sizes" });
    const presets = new Map<number, HTMLElement>();
    // The readout, the thumb, the preview and the presets always show the live size.
    const show = (): void => {
      const size = eraserSizeFor(this.state);
      readout.setText(this.eraserMm(size));
      range.value = String(nearestStop(stops, size));
      syncRangeFill(range);
      markChosen(presets, size);
      preview(size * this.previewScales().eraser);
    };
    const pick = (size: number): void => {
      this.setEraserSize(size);
      show();
    };
    // The pill's quick sizes are rebuilt around a new size once it is chosen.
    const settle = (): void => {
      this.buildOptions();
      this.syncActive();
    };
    for (const size of ERASER_SIZES) {
      const preset = row.createEl("button", { cls: "goodobsidian-erasersize" });
      preset.append(eraserSizeGlyph(this.eraserMark(size), POPOVER_ERASER_BOX));
      preset.setAttribute("aria-label", `Eraser size ${this.eraserMm(size)}`);
      preset.setAttribute("title", this.eraserMm(size));
      preset.addEventListener("click", () => {
        pick(size);
        this.closePopover();
        settle();
      });
      presets.set(size, preset);
    }
    this.sizeMarksRender = () => {
      for (const [size, preset] of presets) {
        preset
          .querySelector("svg")
          ?.replaceWith(eraserSizeGlyph(this.eraserMark(size), POPOVER_ERASER_BOX));
        preset.setAttribute("aria-label", `Eraser size ${this.eraserMm(size)}`);
        preset.setAttribute("title", this.eraserMm(size));
      }
      show();
    };
    // Live while dragging; the pill follows once the thumb is let go.
    range.addEventListener("input", () =>
      pick(stops[Number(range.value)] ?? eraserSizeFor(this.state)),
    );
    range.addEventListener("change", settle);
    reset.addEventListener("click", () => {
      pick(DEFAULT_ERASER_SIZE);
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
    body.createDiv({ cls: "goodobsidian-popover-label", text: "Eraser" });
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
      body.createDiv({ cls: "goodobsidian-popover-label", text: "What the eraser erases" });
      const list = body.createDiv({ cls: "goodobsidian-switch-list" });
      const filter = eraserFilterFor(this.state);
      this.switchRow(list, "Erase highlighter only", filter === "highlighter", (on) =>
        set(on ? "highlighter" : "all"),
      );
      this.switchRow(list, "Erase pen only", filter === "pen", (on) => set(on ? "pen" : "all"));
      body.createDiv({
        cls: "goodobsidian-popover-hint",
        text: "Pictures and text boxes are never erased.",
      });
    };
    this.popoverRender();
    this.keepPopoverInside(anchor);
  }

  private togglePenTypeList(): void {
    if (this.popoverKind === "pens") {
      this.closePopover();
      return;
    }
    const anchor = this.penTypeButtons.get(this.activePenType().id) ?? this.optionsEl;
    const body = this.openPopover("pens", anchor);
    // One popover, three pages, as in GoodNotes: the pen types, and behind
    // rows at their foot the pen in hand's settings and the pen gestures,
    // each with a way back.
    let page: "types" | "settings" | "gestures" = "types";
    this.popoverRender = () => {
      body.empty();
      this.popover?.toggleClass("is-pen-gestures", page !== "types");
      const go =
        (to: typeof page): (() => void) =>
        () => {
          page = to;
          this.popoverRender?.();
        };
      if (page === "gestures") this.renderPenGestures(body, go("types"));
      else if (page === "settings") this.renderPenSettings(body, go("types"));
      else this.renderPenTypes(body, go("settings"), go("gestures"));
      this.keepPopoverInside(anchor);
    };
    this.popoverRender();
  }

  /** The colour pen type `spec` writes with: the live one in hand, else its own. */
  private inkColorOf(spec: PenTypeSpec): string {
    if (spec.id === this.activePenType().id) return this.state.color;
    return penInkFor(this.state.penInks ?? {}, spec.id, this.inkInHand()).color;
  }

  private renderPenTypes(
    body: HTMLElement,
    openSettings: () => void,
    openGestures: () => void,
  ): void {
    this.penMenuRows.clear();
    body.createDiv({ cls: "goodobsidian-popover-label", text: "Pen type" });
    for (const spec of PEN_MENU_TYPES) {
      if (this.practice && spec.tool === "highlighter") continue;
      const button = body.createEl("button", { cls: "goodobsidian-wide goodobsidian-pen-row" });
      button.append(penGlyph(spec.id, this.inkColorOf(spec)));
      this.penMenuRows.set(spec.id, button);
      button.createSpan({ text: spec.label });
      button.toggleClass("is-active", spec.id === this.activePenType().id);
      button.addEventListener("click", () => {
        this.closePopover();
        this.choosePenType(spec);
      });
    }
    if (this.practice) return;
    // The laser pointer has no bar button (FineNotes#25): here, and L.
    const laser = body.createEl("button", {
      cls: "goodobsidian-wide goodobsidian-pen-row goodobsidian-laser-row",
    });
    iconOrText(laser.createSpan({ cls: "goodobsidian-laser-row-icon" }), "pointer", "");
    laser.createSpan({ text: "Laser pointer" });
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
    this.popoverLink(body, "Pen settings", "sliders-horizontal", openSettings);
    this.popoverLink(body, "Pen gestures", "signature", openGestures);
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
    iconOrText(backButton, "arrow-left", "Back");
    backButton.setAttribute("aria-label", backLabel);
    backButton.addEventListener("click", back);
    head.createDiv({ cls: "goodobsidian-popover-title", text: title });
  }

  /** The pen in hand's own settings, behind "Pen settings" in the pen type menu. */
  private renderPenSettings(body: HTMLElement, back: () => void): void {
    this.popoverPageHead(body, `${this.activePenType().label} settings`, "Back to pen types", back);
    this.renderStabilization(body);
  }

  /**
   * The pen in hand's "Stroke stabilization", 0-100%, which Goodnotes keeps
   * per pen (FineNotes discussion #30). It shapes only the strokes written
   * next (`ink/stroke-builder.ts`, `stabilizationReach`).
   */
  private renderStabilization(body: HTMLElement): void {
    const spec = this.activePenType();
    const head = body.createDiv({ cls: "goodobsidian-width-head" });
    head.createDiv({ cls: "goodobsidian-popover-label", text: "Stroke stabilization" });
    const readout = head.createDiv({ cls: "goodobsidian-width-readout" });
    const slider = body.createDiv({ cls: "goodobsidian-width-slider" });
    const range = slider.createEl("input", {
      cls: "goodobsidian-width-range",
      type: "range",
      attr: { "aria-label": `Stroke stabilization, ${spec.label}` },
    });
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
      text: "Steadies a shaky hand as you write. Higher settings trail the pen a little and round off small loops.",
    });
  }

  /**
   * GoodNotes' Pen Gestures page: Scribble to erase (and whether it takes
   * shapes and highlighter too), and Circle to lasso. The second switch is
   * greyed while the first is off, as GoodNotes has it.
   */
  private renderPenGestures(body: HTMLElement, back: () => void): void {
    this.popoverPageHead(body, "Pen gestures", "Back to pen types", back);

    const gestures = penGesturesOf(this.state.penGestures);
    const set = (patch: Partial<PenGestures>): void => {
      this.state.penGestures = { ...penGesturesOf(this.state.penGestures), ...patch };
      this.callbacks.onPenGesturesChange?.(this.state.penGestures);
      this.popoverRender?.();
    };

    const scribble = body.createDiv({ cls: "goodobsidian-switch-list" });
    this.switchRow(scribble, "Scribble to erase", gestures.scribbleErase, (on) =>
      set({ scribbleErase: on }),
    );
    const all = this.switchRow(
      scribble,
      "Erase shapes and highlighter",
      gestures.scribbleErase && gestures.scribbleErasesAll,
      (on) => set({ scribbleErasesAll: on }),
    );
    all.disabled = !gestures.scribbleErase;
    body.createDiv({
      cls: "goodobsidian-popover-hint",
      text: "Erase handwriting and drawings by scribbling over them.",
    });

    const lasso = body.createDiv({ cls: "goodobsidian-switch-list" });
    this.switchRow(lasso, "Circle to lasso", gestures.circleLasso, (on) =>
      set({ circleLasso: on }),
    );
    body.createDiv({
      cls: "goodobsidian-popover-hint",
      text: "Draw around anything, then hold the pen on the loop to select it and move it.",
    });
  }

  private openPopover(kind: string, anchor: HTMLElement): HTMLElement {
    this.closePopover();
    // Appended to the host, not to a bar: either bar would clip it.
    const popover = this.host.createDiv({ cls: "goodobsidian-popover" });
    popover.setAttribute("role", "dialog");
    // Removed with the popover, so its listeners need no disposer.
    this.keepFocus(popover, false);
    const body = popover.createDiv({ cls: "goodobsidian-popover-body" });

    const hostBox = this.host.getBoundingClientRect();
    const anchorBox = anchor.getBoundingClientRect();
    // Toward the page from wherever the pill rests (pill-dock-model.ts);
    // placed by the edge it opens from, so its size is not needed yet.
    const side = this.popoverSideFor(anchor);
    const centreX = anchorBox.left - hostBox.left + anchorBox.width / 2;
    const centreY = anchorBox.top - hostBox.top + anchorBox.height / 2;
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

    this.popover = popover;
    this.popoverKind = kind;
    this.growPopover(popover);
    return body;
  }

  /**
   * Which way a popover opens from `anchor`: toward the page from the pill
   * at its place; down from the tool bar, and from a pill floating by a
   * text box, whose own placing (`keepPopoverAboveKeyboard`) decides.
   */
  private popoverSideFor(anchor: HTMLElement): PopoverSide {
    if (!this.optionsEl.contains(anchor) || this.optionsEl.hasClass("is-anchored")) return "down";
    return popoverSide(this.pillDock);
  }

  private closePopover(): void {
    this.popoverKeyboard?.end();
    this.popoverKeyboard = null;
    if (this.popover) this.shrinkPopover(this.popover);
    this.popover = null;
    this.popoverKind = null;
    this.popoverRender = null;
    this.sizeMarksRender = null;
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
  private keepPopoverInside(anchor: HTMLElement): void {
    const popover = this.popover;
    if (!popover) return;
    const hostBox = this.host.getBoundingClientRect();
    const anchorBox = anchor.getBoundingClientRect();
    const box = popover.getBoundingClientRect();
    if (popover.hasClass("opens-right") || popover.hasClass("opens-left")) {
      // Beside an upright pill it hangs centred on its button: slide it up
      // or down instead, below the tool bar, the arrow still on the button.
      const top = hostBox.top + this.barBottom();
      let lift = 0;
      if (box.bottom > hostBox.bottom - EDGE_INSET) lift = hostBox.bottom - EDGE_INSET - box.bottom;
      if (box.top + lift < top) lift = top - box.top;
      popover.setCssProps({ "--gob-popover-arrow": `${Math.round(-lift)}px` });
      if (lift === 0) return;
      const centre = anchorBox.top - hostBox.top + anchorBox.height / 2;
      popover.setCssStyles({ top: `${Math.round(centre + lift)}px` });
      return;
    }
    let shift = 0;
    if (box.right > hostBox.right - EDGE_INSET) shift = hostBox.right - EDGE_INSET - box.right;
    if (box.left + shift < hostBox.left + EDGE_INSET) shift = hostBox.left + EDGE_INSET - box.left;
    // A popover with an arrow keeps it pointing at the anchor.
    popover.setCssProps({ "--gob-popover-arrow": `${Math.round(-shift)}px` });
    if (shift === 0) return;
    const centre = anchorBox.left - hostBox.left + anchorBox.width / 2;
    popover.setCssStyles({ left: `${Math.round(centre + shift)}px` });
  }

  /** Dismiss the popover on an outside press or Escape. */
  private installDismiss(): void {
    const onDown = (event: PointerEvent): void => {
      if (!this.popover) return;
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

  /** Where tier 1 ends, in host coordinates: the pill hangs below it. */
  private barBottom(): number {
    const hostBox = this.host.getBoundingClientRect();
    const barBox = this.barEl.getBoundingClientRect();
    return barBox.bottom - hostBox.top + EDGE_INSET;
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

  /** The bar and the pill as shown, as vertical spans in screen px (`toastSide`). */
  chromeSpans(): Array<{ top: number; bottom: number }> {
    const spans = [this.barEl.getBoundingClientRect()];
    const pill = this.optionsEl;
    // An upright pill stands at a side, clear of a toast centred on the page.
    const upright = pill.hasClass("is-upright") && !pill.hasClass("is-anchored");
    if (!pill.hasClass("is-offscreen") && !pill.hasClass("is-hidden") && !upright) {
      spans.push(pill.getBoundingClientRect());
    }
    return spans.map(({ top, bottom }) => ({ top, bottom }));
  }

  private placePill(): void {
    // A glide in progress would be measured as the pill's size.
    this.stopPillMorph();
    this.fitTextPill();
    const hostBox = this.host.getBoundingClientRect();
    const pill = this.optionsEl.getBoundingClientRect();
    const anchored = this.anchoredPlace(hostBox, pill);
    this.optionsEl.toggleClass("is-anchored", anchored !== null);
    this.optionsEl.toggleClass("is-offscreen", anchored === "hidden");
    if (anchored === "hidden") {
      this.clearForPill(null, hostBox);
      return;
    }
    if (anchored) {
      this.optionsEl.setCssStyles({
        left: `${Math.round(anchored.left)}px`,
        top: `${Math.round(anchored.top)}px`,
      });
      this.clearForPill(null, hostBox);
      return;
    }
    const area = this.pillArea(hostBox, pill.width);
    // An upright pill taller than the room scrolls (styles.css).
    this.optionsEl.setCssProps({
      "--gob-pill-room": `${Math.max(0, Math.round(area.bottom - area.top - 2 * EDGE_INSET))}px`,
    });
    const place = dockPlace(this.pillDock, area, pill.width, pill.height, EDGE_INSET);
    this.optionsEl.setCssStyles({
      left: `${Math.round(place.left)}px`,
      top: `${Math.round(place.top)}px`,
    });
    const shown = !this.optionsEl.hasClass("is-collapsed") && !this.optionsEl.hasClass("is-hidden");
    this.clearForPill(
      shown
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
   * The part of the view the pill rests in, host px: below the tool bar,
   * right of a docked panel (unless the pill would not fit beside it), and
   * above the keyboard.
   */
  private pillArea(hostBox: DOMRect, pillWidth: number): PillArea {
    const win = this.host.ownerDocument.defaultView;
    const windowBottom = (win?.innerHeight ?? Infinity) - keyboardHeight();
    // Obsidian pads the view's foot (32 px on mobile, for its own bar); the
    // page ends above it, and so does the pill's room.
    const foot = parseFloat(win?.getComputedStyle(this.host).paddingBottom ?? "") || 0;
    return {
      left: Math.min(this.leftInset, Math.max(0, hostBox.width - pillWidth)),
      top: this.barBottom(),
      right: hostBox.width,
      bottom: Math.min(hostBox.height - foot, windowBottom - hostBox.top),
    };
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
    const minTop = this.barBottom();
    // The keyboard covers the bottom of the window, whatever the host's height.
    const windowBottom =
      (this.host.ownerDocument.defaultView?.innerHeight ?? Infinity) - keyboardHeight();
    // The part of the screen the box can be seen in: below the tool bar,
    // above the keyboard, inside the page.
    const visibleTop = Math.max(minTop, (anchor.clipTop ?? -Infinity) - hostBox.top);
    const visibleBottom = Math.min(
      hostBox.height,
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
    const inset = Math.min(this.leftInset, Math.max(0, hostBox.width - pill.width));
    const minLeft = inset + EDGE_INSET;
    const maxLeft = Math.max(minLeft, hostBox.width - pill.width - EDGE_INSET);
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
    else this.clearForPill(null, this.host.getBoundingClientRect());
  }

  /**
   * On a narrow pane (an iPad in portrait or Split View) the text pill drops
   * the pin's label and narrows its dropdowns rather than overflow; anything
   * still too wide scrolls inside the pill instead of leaving the screen.
   */
  private fitTextPill(): void {
    const pill = this.optionsEl;
    pill.removeClass("is-compact");
    if (!pill.hasClass("is-text")) return;
    const room = this.host.getBoundingClientRect().width - this.leftInset - 2 * EDGE_INSET;
    if (pill.scrollWidth > room) pill.addClass("is-compact");
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

  /**
   * Keep the bars to writing (a practice file): the pen and the eraser,
   * undo and redo, the page panel, ⋯ and the settings. The pen loses the
   * highlighter, auto-shape and its gestures menu.
   */
  setPractice(on: boolean): void {
    if (on === this.practice) return;
    this.practice = on;
    for (const button of this.beyondWriting) button.toggle(!on);
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
   * Where the indicator and the tool buttons' contents are now, as seen
   * (mid-slide included, so a quick second pick carries on from there), or
   * `null` while the indicator is not shown.
   */
  private toolPlaces(): ToolPlaces | null {
    const indicator = this.toolIndicator;
    if (!indicator || indicator.hasClass("is-hidden") || !this.toolsGroup) return null;
    const box = indicator.getBoundingClientRect();
    if (box.width === 0) return null;
    const contents = new Map<Element, number>();
    for (const button of Array.from(this.toolsGroup.children)) {
      if (button === indicator) continue;
      for (const child of Array.from(button.children)) {
        contents.set(child, child.getBoundingClientRect().left);
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
    const target = tool === null ? undefined : this.toolButtons.get(tool);
    // A tool with no bar button (the laser), or a bar not laid out yet: no
    // indicator, and the button's own active square shows (styles.css).
    const shown = target !== undefined && target.offsetWidth > 0;
    indicator.toggleClass("is-hidden", !shown);
    this.toolsGroup?.toggleClass("has-indicator", shown);
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
    const dx = from.indicator.left - to.left;
    const sx = from.indicator.width / to.width;
    if (Math.abs(dx) >= 0.5 || Math.abs(sx - 1) > 0.01) {
      this.toolSlides.push(
        indicator.animate(
          [
            { translate: `${dx}px 0`, scale: `${sx} 1` },
            { translate: "0 0", scale: "1 1" },
          ],
          timing,
        ),
      );
    }
    for (const [child, left] of from.contents) {
      if (!child.isConnected) continue;
      const shift = left - child.getBoundingClientRect().left;
      if (Math.abs(shift) < 0.5) continue;
      this.toolSlides.push(
        child.animate([{ translate: `${shift}px 0` }, { translate: "0 0" }], timing),
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
    const from = tool === this.indicatorTool ? null : this.toolPlaces();
    markChosen(this.toolButtons, tool, true);
    // The tool in hand stays on the bar, and a chosen tool is wider.
    if (tool !== this.indicatorTool) this.fitBar(tool);
    this.placeIndicator(tool, from);
    markChosen(this.colorSwatches, state.color);
    markChosen(this.widthButtons, state.size);
    markChosen(this.eraserSizeButtons, eraserSizeFor(state));
    markChosen(this.penTypeButtons, this.activePenType().id);
    markChosen(this.shapeButtons, shapeModeFor(state), true);
    this.drawPenPreview();
    this.drawLassoIcon();
    this.drawEraserIcon();
    // The pen menu, if it is open, shows each pen in its colour now.
    if (this.popoverKind === "pens") {
      for (const [id, row] of this.penMenuRows) {
        if (!row.isConnected) continue;
        const spec = PEN_TYPES.find((type) => type.id === id);
        const glyph = row.querySelector("svg");
        if (spec && glyph) glyph.replaceWith(penGlyph(spec.id, this.inkColorOf(spec)));
        row.toggleClass("is-active", id === this.activePenType().id);
      }
    }
  }

  /** Take on a state the host changed (a shortcut, an undo, another note's defaults). */
  setState(next: ToolbarState): void {
    this.drawingTool = drawingToolOf(this.drawingTool, next.tool);
    this.leaveToolFor(next.tool);
    this.state = next;
    this.buildOptions();
    this.syncActive();
  }

  /** Show the record button as live (tinted) while a recording runs. */
  setRecording(active: boolean): void {
    this.recordButton?.toggleClass("is-recording", active);
    this.recordButton?.setAttribute("aria-pressed", active ? "true" : "false");
    this.recordButton?.setAttribute("aria-label", active ? "Stop recording" : "Record audio");
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
function markChosen<K>(buttons: Map<K, HTMLElement>, chosen: K, pressed = false): void {
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
    line: () => add("path", { d: "M5 19 19 5" }),
    arrow: () => add("path", { d: "M5 19 19 5M10.5 5H19V13.5" }),
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
  if (mode === "lines") {
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

/**
 * A strip of paper under the width slider with a sample stroke on it in the
 * pen's own character (`sampleStroke`, the width buttons' shapes drawn
 * large), at the width it will be on the page now. The SVG has no viewBox,
 * so its units are screen px. Returns the function that redraws it.
 */
function strokePreview(
  parent: HTMLElement,
): (screenWidth: number, color: string, pen: string) => void {
  const strip = parent.createDiv({ cls: "goodobsidian-size-preview" });
  strip.setAttribute("aria-hidden", "true");
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
 * A strip of paper under the eraser slider with the eraser's footprint on
 * it, at the size it erases on screen. A size larger than the strip is cut
 * at its edges, which still reads as large. Returns the redraw function.
 */
function eraserPreview(parent: HTMLElement): (screenDiameter: number) => void {
  const strip = parent.createDiv({ cls: "goodobsidian-size-preview" });
  strip.setAttribute("aria-hidden", "true");
  const ring = strip.createDiv({ cls: "goodobsidian-size-preview-eraser" });
  return (screenDiameter) => {
    const d = `${Math.max(2, screenDiameter).toFixed(1)}px`;
    ring.setCssStyles({ width: d, height: d });
  };
}

/** The eraser-size popover's presets are larger than the pill's: they have the room. */
const POPOVER_ERASER_BOX = 40;

/**
 * An eraser-size control: the eraser's footprint at the size it erases
 * (`diameter`, screen px), as the strip under the slider draws it, in a
 * `box` px square. One larger than the box fills it, shaded darker.
 */
function eraserSizeGlyph(diameter: number, box = 28): SVGElement {
  const svg = activeDocument.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${box} ${box}`);
  svg.setAttribute("width", String(box));
  svg.setAttribute("height", String(box));
  svg.setAttribute("aria-hidden", "true");
  const circle = activeDocument.createElementNS(SVG_NS, "circle");
  circle.setAttribute("cx", String(box / 2));
  circle.setAttribute("cy", String(box / 2));
  // The ring is drawn inside the footprint, as the strip's border is. A
  // footprint too big for the box fills it, shaded darker: at least this big.
  const d = Number.isFinite(diameter) && diameter > 0 ? diameter : 2;
  const fits = d <= box;
  circle.setAttribute("r", Math.max(0.75, Math.min(d, box) / 2 - 0.75).toFixed(2));
  circle.setAttribute("fill", "currentColor");
  circle.setAttribute("fill-opacity", fits ? "0.08" : "0.22");
  circle.setAttribute("stroke", "currentColor");
  circle.setAttribute("stroke-width", "1.5");
  svg.append(circle);
  return svg;
}

/**
 * A preset pen width, in the pill or in the widths popover: the stroke
 * itself, `thickness` screen px as it writes now, named by its ink's width
 * (`mm`, "0.62 mm") for screen readers and on hover.
 */
function widthButton(
  parent: HTMLElement,
  mm: string,
  pen: string,
  thickness: number,
  onPick: () => void,
): HTMLButtonElement {
  const button = parent.createEl("button", { cls: "goodobsidian-width" });
  button.append(widthGlyph(thickness, pen));
  button.setAttribute("aria-label", `Width ${mm}`);
  button.setAttribute("title", mm);
  button.addEventListener("click", onPick);
  return button;
}

/**
 * A stroke-width control drawn as a stroke `thickness` screen px thick, in
 * the pen's own character: tapered for the fountain pen, even for the
 * ballpoint, lifting off for the brush, a flat band for the highlighter
 * (pen-glyphs.ts).
 */
function widthGlyph(thickness: number, pen: string): SVGElement {
  const svg = activeDocument.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${SWOOSH_WIDTH} ${SWOOSH_HEIGHT}`);
  svg.setAttribute("width", String(SWOOSH_WIDTH));
  svg.setAttribute("height", String(SWOOSH_HEIGHT));
  svg.setAttribute("aria-hidden", "true");
  const shape = swoosh(pen, thickness);
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

/** What a new shape gets: its fill (or none) inside, its line round it. */
function shapeStyleGlyph(style: ShapeToolStyle, color: string): SVGElement {
  return textGlyph((add) => {
    const attrs: Record<string, string> = { x: "4.5", y: "4.5", width: "15", height: "15" };
    attrs.rx = style.round ? "4" : "1";
    if (style.fill) {
      attrs.fill = color;
      attrs["fill-opacity"] = style.fill === "soft" ? "0.3" : "1";
    }
    if (style.dash === "dash") attrs["stroke-dasharray"] = "3.5 3";
    if (style.dash === "dot") attrs["stroke-dasharray"] = "0.1 3.2";
    add("rect", attrs);
  });
}

function shapeFillGlyph(fill: FillMode | undefined, color: string): SVGElement {
  return textGlyph((add) => {
    const attrs: Record<string, string> = {
      x: "4.5",
      y: "4.5",
      width: "15",
      height: "15",
      rx: "3",
    };
    if (fill) {
      attrs.fill = color;
      attrs["fill-opacity"] = fill === "soft" ? "0.3" : "1";
    }
    add("rect", attrs);
    if (!fill) add("path", { d: "M7 17 17 7" });
  });
}

function dashGlyph(dash: ShapeDash | undefined): SVGElement {
  return textGlyph((add) => {
    const attrs: Record<string, string> = { d: "M3.5 12h17", "stroke-width": "2.2" };
    if (dash === "dash") attrs["stroke-dasharray"] = "4.5 3.5";
    if (dash === "dot") attrs["stroke-dasharray"] = "0.1 4";
    add("path", attrs);
  });
}

/** A line with its head (or none) on the end `end` names. */
function headGlyph(end: "start" | "end", head: ArrowHead | undefined): SVGElement {
  return textGlyph((add) => {
    // Pointing right for the end, left for the start.
    const tip = end === "end" ? 20 : 4;
    const back = end === "end" ? 13 : 11;
    add("path", { d: `M4 12h16` });
    if (head === "open") add("path", { d: `M${back} 7.5 ${tip} 12 ${back} 16.5` });
    if (head === "filled") {
      add("path", { d: `M${back} 7.5 ${tip} 12 ${back} 16.5Z`, fill: "currentColor" });
    }
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
