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
 *   Table: tapping it opens a rows × columns picker; the table is then
 *   dragged out like a preset and placed as ordinary ink strokes.
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

import { setIcon } from "obsidian";
import { DEFAULT_ERASER_SIZE, ERASER_SIZES, PALETTE } from "../constants";
import {
  CONNECTOR_PRESETS,
  SHAPE_PRESETS,
  STAR_INNER_RATIO,
  type ShapeMode,
  isShapeMode,
  starPoints,
} from "../ink/shape-geometry";
import { TEXT_ALIGNS, TEXT_FONTS, TEXT_FONT_STACKS, type TextAlign } from "../model/document";
import {
  DEFAULT_LINE_HEIGHT,
  DEFAULT_TEXT_STYLE,
  LINE_HEIGHTS,
  TEXT_ALIGN_LABELS,
  TEXT_FILLS,
  TEXT_FONT_LABELS,
  TEXT_SIZES,
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
import { DEFAULT_SHAPE_COLOR, contrastMark, pushRecentColor, sameColor } from "../model/colors";
import { formatMm } from "../model/units";
import { PANEL_SLIDE_MS, prefersReducedMotion } from "./motion";
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

/** Tools selectable in the toolbar. Pen, highlighter and shape produce strokes. */
export type ActiveTool = "pen" | "highlighter" | "eraser" | "select" | "text" | "shape";

/**
 * Pen types, as GoodNotes presents them. The highlighter is a pen type there,
 * not a top-level tool, so tier 1 shows one "pen" button and the type is chosen
 * in tier 2. Each type is expressed with knobs the ink engine already has.
 */
export type PenType = "fountain" | "ball" | "brush" | "highlighter";

export interface PenTypeSpec {
  id: PenType;
  label: string;
  tool: ActiveTool;
  /** Pressure-varying width. A ballpoint is deliberately uniform. */
  pressure: boolean;
  /** Multiplier on the chosen stroke width. */
  sizeScale: number;
}

export const PEN_TYPES: readonly PenTypeSpec[] = [
  { id: "fountain", label: "Fountain pen", tool: "pen", pressure: true, sizeScale: 1 },
  { id: "ball", label: "Ball pen", tool: "pen", pressure: false, sizeScale: 1 },
  { id: "brush", label: "Brush pen", tool: "pen", pressure: true, sizeScale: 1.8 },
  { id: "highlighter", label: "Highlighter", tool: "highlighter", pressure: false, sizeScale: 4 },
];

/** The intentionally small, day-to-day pen menu: fountain, ball and brush. */
const PRIMARY_PEN_TYPES = PEN_TYPES.slice(0, 3);
/** Keep the main pill short; the colour picker still exposes any custom colour. */
const QUICK_COLORS = 3;

/** The pen type a toolbar state implies. Used by the surface to size strokes. */
export function penTypeFor(state: ToolbarState): PenTypeSpec {
  const id = state.penType ?? (state.tool === "highlighter" ? "highlighter" : "fountain");
  return PEN_TYPES.find((p) => p.id === id) ?? PEN_TYPES[0];
}

/**
 * How the eraser removes ink. `standard` rubs out only what it passes over,
 * splitting strokes; `stroke` removes every stroke it touches, whole. The
 * names are GoodNotes' ("Standard" / "Erase entire stroke").
 */
export type EraserMode = "standard" | "stroke";

const ERASER_MODES: ReadonlyArray<{ id: EraserMode; label: string; icon: string }> = [
  { id: "standard", label: "Standard", icon: "eraser" },
  { id: "stroke", label: "Whole stroke", icon: "spline" },
];

/** The eraser mode a toolbar state implies. `undefined` counts as standard. */
export function eraserModeFor(state: ToolbarState): EraserMode {
  return state.eraserMode === "stroke" ? "stroke" : "standard";
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
};

/** GoodNotes' "What to include in the selection", less what this plugin does not have. */
const LASSO_FILTER_LABELS: Record<keyof LassoFilter, string> = {
  handwriting: "Handwriting",
  images: "Images",
  shapes: "Shapes",
  arrows: "Arrows",
  textBoxes: "Text boxes",
};

/** The Shape tool's mode a toolbar state implies. `undefined` counts as auto. */
export function shapeModeFor(state: ToolbarState): ShapeMode {
  return isShapeMode(state.shapeMode) ? state.shapeMode : "auto";
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
  /** The Shape tool's mode. `undefined` counts as "auto". */
  shapeMode?: ShapeMode;
  /** The Table tool's size. `undefined` counts as the last one picked. */
  tableSize?: TableSize;
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
  onColorChange: (color: string) => void;
  onSizeChange: (size: number) => void;
  onPressureToggle: (enabled: boolean) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  // --- Later additions. Optional: a host that supplies none
  // gets a disabled control rather than a control that lies.
  onPenTypeChange?: (spec: PenTypeSpec) => void;
  /** Eraser mode or size changed. Hosts persist it across sessions. */
  onEraserChange?: (mode: EraserMode, size: number) => void;
  /** "Erase highlighter only" / "Erase pen only" changed. Hosts persist it. */
  onEraserFilterChange?: (filter: EraserFilter) => void;
  /** The lasso's type, or what it picks up, changed. Hosts persist it. */
  onLassoChange?: (mode: LassoMode, filter: LassoFilter) => void;
  /** Add a page; `anchor` is the button, for a popover to hang from. */
  onAddPage?: (anchor: HTMLElement) => void;
  onToggleThumbnails?: () => void;
  onSearch?: () => void;
  // --- 0.5 (contracts/api.md v7).
  /** Open the image menu (Photos, camera, files, vault, scan, AI); `anchor` is the button. */
  onInsertImage?: (anchor: HTMLElement) => void;
  /** Open the AI menu (transcribe, ask, generate an image); `anchor` is the button. */
  onAi?: (anchor: HTMLElement) => void;
  /** Start or stop an audio recording, or open its controls; `anchor` is the button. */
  onRecord?: (anchor: HTMLElement) => void;
  /** Open this note's settings (where its pictures and recordings go); `anchor` is the gear. */
  onSettings?: (anchor: HTMLElement) => void;
  /** Export pages as a PDF and share it (GoodNotes' share button); `anchor` is the button. */
  onShare?: (anchor: HTMLElement) => void;
  /** Open the ⋯ panel for the page being read; `anchor` is the button. */
  onMore?: (anchor: HTMLElement) => void;
  // --- The Text tool (0.5).
  /** A text control changed: apply `patch` to the box being edited, if there is one. */
  onTextStyle?: (patch: TextStylePatch) => void;
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
  /** The Shape tool's colour changed. Hosts persist it. */
  onShapeColorChange?: (color: string) => void;
  /** A custom colour was picked: the new recent list. Hosts persist it. */
  onRecentColors?: (colors: string[]) => void;
}

export interface ToolbarOptions {
  /** The pen width the width popover's reset returns to; default the middle preset. */
  defaultSize?: number;
}

/** Minimum gap between the pill and the edge of the page area, in CSS px. */
const EDGE_INSET = 8;

/** The least room kept between the centred tools and the groups beside them. */
const BAR_GAP = 8;

/** How many stroke widths tier 2 shows before the "more" chevron. */
const QUICK_WIDTHS = 3;

/** The pill changing width and place for a new tool: GoodNotes' 0.3 s `ease`. */
const PILL_MORPH_MS = 300;
/** A new tool's controls fading in. */
const PILL_FADE_MS = 150;

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
  private readonly colorSwatches = new Map<string, HTMLElement>();
  private readonly widthButtons = new Map<number, HTMLElement>();
  private readonly penTypeButtons = new Map<PenType, HTMLButtonElement>();
  private readonly eraserSizeButtons = new Map<number, HTMLButtonElement>();
  private readonly shapeButtons = new Map<ShapeMode, HTMLButtonElement>();
  /** The Table button's "3 × 4" caption, kept in step with the picked size. */
  private tableCaption: HTMLElement | null = null;
  private thumbnailsButton: HTMLButtonElement | null = null;
  /** The writing tools, centred on the bar while there is room. */
  private toolsGroup: HTMLElement | null = null;
  /** The record button (0.5). */
  private recordButton: HTMLButtonElement | null = null;
  /** The add-page button. */
  private addPageButton: HTMLButtonElement | null = null;
  private undoButton: HTMLButtonElement | null = null;
  private redoButton: HTMLButtonElement | null = null;
  /** Width of a panel docked at the host's left edge; the pill stays clear of it. */
  private leftInset = 0;

  private popover: HTMLElement | null = null;
  private popoverKind: string | null = null;
  /** Redraws the open text popover's body in place after a change it made. */
  private popoverRender: (() => void) | null = null;
  /**
   * Style of the page text box being edited, shown in the text pill in place
   * of the style new boxes get. `null` while no box has focus.
   */
  private textTarget: TextStyle | null = null;
  private readonly disposers: Array<() => void> = [];

  /** The active tool remains active when its options are tucked away. */
  private optionsVisible = true;
  /** What the pill shows ("text" or a tool); a change fades the new controls in. */
  private pillKind: string | null = null;
  private pillMorph: Animation | null = null;
  /** The button under a pointer that is down on a bar, drawn pressed. */
  private pressed: HTMLElement | null = null;
  private palette: string[];

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
    this.barEl = host.createDiv({ cls: "goodobsidian-toolbar" });
    this.barEl.setAttribute("role", "toolbar");
    this.barEl.setAttribute("aria-label", "Handwriting tools");
    // The pill always floats over the page (styles.css, `.is-floating`).
    this.optionsEl = host.createDiv({ cls: "goodobsidian-options is-floating" });
    this.optionsEl.setAttribute("role", "toolbar");
    this.optionsEl.setAttribute("aria-label", "Tool options");

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
    this.barButton(left, "search", "Search this notebook", cb.onSearch);
    this.barButton(left, "sparkles", "AI", cb.onAi);

    const history = this.barEl.createDiv({ cls: "goodobsidian-bar-group is-centre" });
    this.undoButton = this.barButton(history, "undo-2", "Undo (Cmd/Ctrl+Z)", () =>
      this.callbacks.onUndo(),
    );
    this.redoButton = this.barButton(history, "redo-2", "Redo (Cmd/Ctrl+Shift+Z)", () =>
      this.callbacks.onRedo(),
    );

    // The writing tools, centred on the bar (styles.css), as GoodNotes has them.
    const tools = this.barEl.createDiv({ cls: "goodobsidian-bar-group is-tools" });
    this.toolsGroup = tools;
    this.addToolButton(tools, "select", "lasso", "Lasso select (V)");
    this.addToolButton(tools, "pen", "pen-tool", "Pen (P)");
    this.addToolButton(tools, "eraser", "eraser", "Eraser (E)");
    this.addToolButton(tools, "text", "type", "Text box (T)");
    this.addToolButton(tools, "shape", "shapes", "Shapes (S)");
    this.barButton(tools, "image", "Insert image", cb.onInsertImage);
    // The note's recordings live in the page sidebar's Audio tab, as in
    // GoodNotes; the mic only starts and stops one.
    this.recordButton = this.barButton(tools, "mic", "Record audio", cb.onRecord);

    // The document's own actions, right: add a page, GoodNotes' share
    // button (export as PDF), its ⋯ sheet for the page being read
    // (bookmark, duplicate, go to page, clear, delete), then, rightmost,
    // the note's own settings.
    const doc = this.barEl.createDiv({ cls: "goodobsidian-bar-group goodobsidian-bar-doc" });
    this.addPageButton = this.barButton(doc, "plus", "Add page", cb.onAddPage);
    this.barButton(doc, "share", "Export as PDF", cb.onShare);
    this.barButton(doc, "more-horizontal", "More", cb.onMore);
    this.barButton(doc, "settings", "Notebook settings", cb.onSettings);
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
    const measure = (): void => {
      this.barEl.removeClass("is-crowded");
      check();
    };
    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(measure);
      observer.observe(this.barEl);
      this.disposers.push(() => observer.disconnect());
    }
    measure();
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

  private addToolButton(parent: HTMLElement, tool: ActiveTool, icon: string, label: string): void {
    const button = this.barButton(parent, icon, label, () => this.tapTool(tool, button));
    if (tool === "select") {
      button.addClass("has-caret");
      iconOrText(button.createSpan({ cls: "goodobsidian-tool-caret" }), "chevron-down", "");
      button.setAttribute("aria-haspopup", "dialog");
    }
    this.toolButtons.set(tool, button);
  }

  /**
   * A tap on a tool. Another tool becomes the active one, with its options
   * showing. The active tool's own button instead shows or tucks away its
   * options (it stays selected), so the Pencil can write on without a large
   * control over the page; the lasso's button opens its popover instead
   * (GoodNotes: the chevron on it says so).
   */
  private tapTool(tool: ActiveTool, button: HTMLElement): void {
    const current = this.state.tool;
    if (tool === "select" && current === "select") {
      this.toggleLassoPopover(button);
      return;
    }
    this.closePopover();
    if (tool === current) {
      this.optionsVisible = !this.optionsVisible;
      this.showOptions(this.optionsVisible);
    } else {
      this.state.tool = tool;
      this.optionsVisible = true;
      this.callbacks.onToolChange(tool);
      this.buildOptions();
    }
    this.syncActive();
  }

  // --- Tier 2 ---------------------------------------------------------------

  /** Rebuild the options pill for whatever tool is active. */
  private buildOptions(): void {
    // Where the pill is now, mid-glide or not, so it can glide from there.
    const before = this.pillBox();
    this.stopPillMorph();
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
      if (this.popoverKind === "eraser-filter" && this.state.tool !== "eraser") this.closePopover();
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
      }
    }
    this.optionsEl.toggleClass("is-collapsed", !this.optionsVisible);
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
    pen.append(penGlyph(active, this.state.color));
    pen.setAttribute("aria-label", `${active.label} options`);
    pen.setAttribute("title", `${active.label} options`);
    pen.addEventListener("click", () => this.togglePenTypeList());
    this.penTypeButtons.set(active.id, pen);
    this.chevron("Pen options", () => this.togglePenTypeList());

    this.optionsEl.createDiv({ cls: "goodobsidian-sep" });

    // Stroke widths, drawn as literal strokes of increasing weight.
    for (const width of this.quickWidths()) {
      const button = widthButton(this.optionsEl, width, () => {
        this.setWidth(width);
        this.syncActive();
      });
      this.widthButtons.set(width, button);
    }
    this.chevron("More widths", (button) => this.toggleWidthList(button));

    this.optionsEl.createDiv({ cls: "goodobsidian-sep" });

    // Three quick colours, then every colour in the picker.
    for (const color of this.quickColors()) {
      const swatch = this.swatchButton(this.optionsEl, color, () => {
        // GoodNotes: a tap on the colour already chosen opens the picker on
        // it (the ▾ in the swatch says so); any other colour is just picked.
        if (sameColor(color, this.state.color)) {
          this.toggleColorPopover("pen-color", swatch, this.state.color, (picked) =>
            this.setPenColor(picked),
          );
        } else this.setPenColor(color);
      });
      this.colorSwatches.set(color, swatch);
    }
    // A dashed ring holding a "+", as GoodNotes' "add colour" (styles.css).
    const more = this.optionsEl.createEl("button", {
      cls: "goodobsidian-color-more clickable-icon",
    });
    iconOrText(more, "plus", "+");
    more.setAttribute("aria-label", "More colours");
    more.setAttribute("title", "More colours");
    more.addEventListener("click", () =>
      this.toggleColorPopover("pen-color", more, this.state.color, (color) =>
        this.setPenColor(color),
      ),
    );

    // Auto-shape: a stroke that is plainly a shape snaps to it on lift.
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
  }

  private setPenColor(color: string): void {
    this.state.color = color;
    this.callbacks.onColorChange(color);
    this.buildOptions();
    this.syncActive();
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
      onPick: (color) => {
        this.closePopover();
        if (color) pick(color);
      },
      onCustom: (color) => {
        this.closePopover();
        this.rememberColor(color);
        pick(color);
      },
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

  private buildEraserOptions(): void {
    // Mode first, as in GoodNotes: "Standard" with a chevron to switch.
    const mode = ERASER_MODES.find((m) => m.id === eraserModeFor(this.state)) ?? ERASER_MODES[0];
    const modeButton = this.optionsEl.createEl("button", { cls: "goodobsidian-erasermode" });
    const modeIcon = modeButton.createSpan({ cls: "goodobsidian-erasermode-icon" });
    iconOrText(modeIcon, mode.icon, mode.label);
    modeButton.createSpan({ text: mode.label });
    const modeCaret = modeButton.createSpan({ cls: "goodobsidian-erasermode-caret" });
    iconOrText(modeCaret, "chevron-down", "");
    modeButton.setAttribute("aria-label", `Eraser mode: ${mode.label}`);
    modeButton.addEventListener("click", () => this.toggleEraserModeList(modeButton));

    this.optionsEl.createDiv({ cls: "goodobsidian-sep" });

    // Sizes, drawn as eraser footprints of increasing diameter.
    for (const size of ERASER_SIZES) {
      const button = this.optionsEl.createEl("button", { cls: "goodobsidian-erasersize" });
      button.append(eraserSizeGlyph(size));
      button.setAttribute("aria-label", `Eraser size ${size}`);
      button.addEventListener("click", () => {
        this.state.eraserSize = size;
        this.callbacks.onEraserChange?.(eraserModeFor(this.state), size);
        this.syncActive();
      });
      this.eraserSizeButtons.set(size, button);
    }

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
    // Auto-shape stands apart from the presets, as in the reference, the
    // connectors apart from the closed shapes, and the table on its own.
    const groups: ShapeMode[][] = [["auto"], [...SHAPE_PRESETS], [...CONNECTOR_PRESETS], ["table"]];
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
          this.state.shapeMode = mode;
          this.syncActive();
          if (mode === "table") this.toggleTablePicker(button);
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
          cls: "goodobsidian-table-cell clickable-icon",
        });
        button.setAttribute("aria-label", `${tableSizeLabel(size)} table`);
        button.addEventListener("pointerenter", () => show(size));
        button.addEventListener("focus", () => show(size));
        button.addEventListener("click", () => this.pickTableSize(size));
        cells.push({ button, size });
      }
    }
    grid.addEventListener("pointerleave", () => show(tableSizeFor(this.state)));
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
    // Deliberately empty.
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
    row.addEventListener("click", () => onChange(!on));
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

    const color = this.textControl("is-color", "Text colour", (b) =>
      this.toggleTextPopover("color", b, (body) => this.renderTextColors(body)),
    );
    // The disc *is* the text colour: a value, not chrome.
    color.createSpan({ cls: "goodobsidian-text-disc" }).setCssStyles({ background: style.color });
    caretIn(color);

    const size = this.textControl("is-drop is-size", `Font size ${style.fontSize}`, (b) =>
      this.toggleTextPopover("size", b, (body) => this.renderTextSizes(body)),
    );
    size.createSpan({ cls: "goodobsidian-text-drop-label", text: String(style.fontSize) });
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

    // Off (the default), every new box fits its text, as in GoodNotes; on,
    // a drag draws the box's size, and a tap still makes a fitted box.
    const dragSize = this.state.textDragSize === true;
    const sizing = this.textControl(
      "is-drag-size",
      dragSize ? "Drag to size text boxes: on" : "Drag to size text boxes: off",
      () => {
        this.state.textDragSize = !dragSize;
        this.saveTextTool();
        this.buildOptions();
      },
    );
    iconOrText(sizing.createSpan({ cls: "goodobsidian-text-pin-icon" }), "square-dashed", "Size");
    sizing.toggleClass("is-active", dragSize);
    sizing.setAttribute("aria-pressed", String(dragSize));

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
      onPick: (color) => {
        if (color) this.pickText({ color });
      },
      onCustom: (color) => {
        this.rememberColor(color);
        this.pickText({ color });
      },
    });
  }

  private renderTextSizes(body: HTMLElement): void {
    body.createDiv({ cls: "goodobsidian-popover-label", text: "Size" });
    const grid = body.createDiv({ cls: "goodobsidian-text-grid" });
    const current = this.shownTextStyle().fontSize;
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

  private renderTextFormat(body: HTMLElement): void {
    body.createDiv({ cls: "goodobsidian-popover-label", text: "Text style" });
    const row = body.createDiv({ cls: "goodobsidian-text-row" });
    const style = this.shownTextStyle();
    const flags = [
      { key: "bold", glyph: "B", label: "Bold" },
      { key: "italic", glyph: "I", label: "Italic" },
      { key: "underline", glyph: "U", label: "Underline" },
      { key: "strike", glyph: "S", label: "Strikethrough" },
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
      onPick: (fill) => this.pickText({ fill }),
      onCustom: (fill) => {
        this.rememberColor(fill);
        this.pickText({ fill });
      },
    });
  }

  private renderTextLists(body: HTMLElement): void {
    body.createDiv({ cls: "goodobsidian-popover-label", text: "Lists" });
    const row = body.createDiv({ cls: "goodobsidian-text-row" });
    const kinds: Array<{ kind: ListKind; label: string }> = [
      { kind: "bullet", label: "Bullets" },
      { kind: "number", label: "Numbering" },
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
    this.state.penType = spec.id;
    if (this.state.tool !== spec.tool) {
      this.state.tool = spec.tool;
      this.callbacks.onToolChange(spec.tool);
    }
    this.state.pressureEnabled = spec.pressure;
    this.callbacks.onPressureToggle(spec.pressure);
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

  /** Black, red and blue are the uncluttered default; preserve a live custom ink. */
  private quickColors(): string[] {
    const quick = this.palette
      .filter((color) => color.toLowerCase() !== "#ffffff")
      .slice(0, QUICK_COLORS);
    if (quick.length === 0) quick.push(this.state.color);
    else if (!quick.includes(this.state.color) && this.state.color.toLowerCase() !== "#ffffff") {
      quick[quick.length - 1] = this.state.color;
    }
    return quick;
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
    const readout = head.createSpan({ cls: "goodobsidian-width-readout" });
    const reset = head.createEl("button", {
      cls: "goodobsidian-width-reset clickable-icon",
      attr: { "aria-label": "Reset stroke width", title: "Reset stroke width" },
    });
    iconOrText(reset, "rotate-ccw", "Reset");
    const slider = body.createDiv({ cls: "goodobsidian-width-slider" });
    slider.createDiv({ cls: "goodobsidian-width-wedge" });
    const range = slider.createEl("input", {
      cls: "goodobsidian-width-range",
      type: "range",
      attr: { "aria-label": "Stroke width" },
    });
    range.min = String(Math.min(...this.widths));
    range.max = String(Math.max(...this.widths));
    range.step = "0.5";
    const row = body.createDiv({ cls: "goodobsidian-sizes" });
    const presets = new Map<number, HTMLElement>();
    // The readout, the thumb and the presets always show the live width.
    const show = (): void => {
      readout.setText(formatMm(this.state.size));
      range.value = String(this.state.size);
      markChosen(presets, this.state.size);
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
      const preset = widthButton(row, width, () => {
        pick(width);
        this.closePopover();
        settle();
      });
      presets.set(width, preset);
    }
    // Live while dragging; the pill's widths follow once the thumb is let go.
    range.addEventListener("input", () => pick(Number(range.value)));
    range.addEventListener("change", settle);
    reset.addEventListener("click", () => {
      pick(this.options.defaultSize ?? this.widths[Math.floor(this.widths.length / 2)]);
      settle();
    });
    show();
  }

  /** A new pen width, from a preset, the slider or a reset. */
  private setWidth(width: number): void {
    this.state.size = width;
    this.callbacks.onSizeChange(width);
  }

  private toggleEraserModeList(anchor: HTMLElement): void {
    if (this.popoverKind === "eraser-mode") {
      this.closePopover();
      return;
    }
    const body = this.openPopover("eraser-mode", anchor);
    body.createDiv({ cls: "goodobsidian-popover-label", text: "Eraser" });
    for (const mode of ERASER_MODES) {
      const button = body.createEl("button", { cls: "goodobsidian-wide", text: mode.label });
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
    // One popover, two pages, as in GoodNotes: the pen types, and behind a
    // row at their foot the pen gestures, with a way back.
    let gestures = false;
    this.popoverRender = () => {
      body.empty();
      this.popover?.toggleClass("is-pen-gestures", gestures);
      const flip = (): void => {
        gestures = !gestures;
        this.popoverRender?.();
      };
      if (gestures) this.renderPenGestures(body, flip);
      else this.renderPenTypes(body, flip);
      this.keepPopoverInside(anchor);
    };
    this.popoverRender();
  }

  private renderPenTypes(body: HTMLElement, openGestures: () => void): void {
    body.createDiv({ cls: "goodobsidian-popover-label", text: "Pen type" });
    for (const spec of PRIMARY_PEN_TYPES) {
      const button = body.createEl("button", { cls: "goodobsidian-wide", text: spec.label });
      button.toggleClass("is-active", spec.id === this.activePenType().id);
      button.addEventListener("click", () => {
        this.closePopover();
        this.choosePenType(spec);
      });
    }
    body.createDiv({ cls: "goodobsidian-popover-divider" });
    const link = body.createEl("button", {
      cls: "goodobsidian-wide goodobsidian-popover-link clickable-icon",
    });
    link.createSpan({ text: "Pen gestures" });
    iconOrText(link.createSpan({ cls: "goodobsidian-popover-link-icon" }), "chevron-right", ">");
    link.addEventListener("click", openGestures);
  }

  /**
   * GoodNotes' Pen Gestures page: Scribble to erase (and whether it takes
   * shapes and highlighter too), and Circle to lasso. The second switch is
   * greyed while the first is off, as GoodNotes has it.
   */
  private renderPenGestures(body: HTMLElement, back: () => void): void {
    const head = body.createDiv({ cls: "goodobsidian-popover-head" });
    const backButton = head.createEl("button", {
      cls: "goodobsidian-popover-back clickable-icon",
    });
    iconOrText(backButton, "arrow-left", "Back");
    backButton.setAttribute("aria-label", "Back to pen types");
    backButton.addEventListener("click", back);
    head.createDiv({ cls: "goodobsidian-popover-title", text: "Pen gestures" });

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
    popover.setCssStyles({
      left: `${Math.round(anchorBox.left - hostBox.left + anchorBox.width / 2)}px`,
      top: `${Math.round(anchorBox.bottom - hostBox.top + 8)}px`,
    });

    this.popover = popover;
    this.popoverKind = kind;
    return body;
  }

  private closePopover(): void {
    this.popover?.remove();
    this.popover = null;
    this.popoverKind = null;
    this.popoverRender = null;
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
    // A glide in progress would be measured as the pill's size.
    this.stopPillMorph();
    this.fitTextPill();
    const hostBox = this.host.getBoundingClientRect();
    const pill = this.optionsEl.getBoundingClientRect();
    const inset = Math.min(this.leftInset, Math.max(0, hostBox.width - pill.width));
    const span = Math.max(1, hostBox.width - inset);
    const minLeft = inset + EDGE_INSET;
    const maxLeft = Math.max(minLeft, hostBox.width - pill.width - EDGE_INSET);
    const left = Math.min(maxLeft, Math.max(minLeft, inset + (span - pill.width) / 2));
    this.optionsEl.setCssStyles({
      left: `${Math.round(left)}px`,
      top: `${Math.round(this.barBottom())}px`,
    });
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
    if (visible) this.applyPosition();
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
    const before = this.pillBox();
    this.leftInset = open ? width : 0;
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
  }

  private activePenType(): PenTypeSpec {
    return penTypeFor(this.state);
  }

  /** Mark every choice button that matches the state, and unmark the rest. */
  syncActive(): void {
    const { state } = this;
    // Highlighter is a pen type, so the pen button stands for both.
    markChosen(this.toolButtons, state.tool === "highlighter" ? "pen" : state.tool, true);
    markChosen(this.colorSwatches, state.color);
    markChosen(this.widthButtons, state.size);
    markChosen(this.eraserSizeButtons, eraserSizeFor(state));
    markChosen(this.penTypeButtons, this.activePenType().id);
    markChosen(this.shapeButtons, shapeModeFor(state), true);
  }

  /** Take on a state the host changed (a shortcut, an undo, another note's defaults). */
  setState(next: ToolbarState): void {
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
    this.closePopover();
    this.stopPillMorph();
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

/** A pen-type swatch: a nib silhouette tinted with the current ink colour. */
function penGlyph(spec: PenTypeSpec, color: string): SVGElement {
  const svg = activeDocument.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 34");
  svg.setAttribute("width", "20");
  svg.setAttribute("height", "28");
  svg.setAttribute("aria-hidden", "true");

  const body = activeDocument.createElementNS(SVG_NS, "path");
  const wide = spec.id === "highlighter";
  body.setAttribute("d", wide ? "M5 4h14v18l-7 10-7-10z" : "M7 4h10v16l-5 12-5-12z");
  body.setAttribute("fill", "currentColor");
  body.setAttribute("opacity", "0.35");

  const nib = activeDocument.createElementNS(SVG_NS, "path");
  nib.setAttribute("d", wide ? "M5 22h14l-7 10z" : "M7 20h10l-5 12z");
  nib.setAttribute("fill", color);

  svg.append(body, nib);
  return svg;
}

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
 * rectangular lasso, a dashed freehand blob for the freehand one.
 */
function lassoGlyph(mode: LassoMode): SVGElement {
  const svg = activeDocument.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 32 32");
  svg.setAttribute("width", "30");
  svg.setAttribute("height", "30");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("stroke-dasharray", "4 3.2");
  const shape = activeDocument.createElementNS(SVG_NS, mode === "rect" ? "rect" : "path");
  if (mode === "rect") {
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

/** An eraser-size control: a hollow circle whose diameter grows with the size. */
function eraserSizeGlyph(size: number): SVGElement {
  const svg = activeDocument.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 28 28");
  svg.setAttribute("width", "28");
  svg.setAttribute("height", "28");
  svg.setAttribute("aria-hidden", "true");
  const largest = ERASER_SIZES[ERASER_SIZES.length - 1];
  const circle = activeDocument.createElementNS(SVG_NS, "circle");
  circle.setAttribute("cx", "14");
  circle.setAttribute("cy", "14");
  circle.setAttribute("r", String(Math.max(3, (12 * size) / largest)));
  circle.setAttribute("fill", "none");
  circle.setAttribute("stroke", "currentColor");
  circle.setAttribute("stroke-width", "1.5");
  svg.append(circle);
  return svg;
}

/**
 * A preset pen width, in the pill or in the widths popover: the stroke
 * itself, named in millimetres for screen readers and on hover.
 */
function widthButton(parent: HTMLElement, width: number, onPick: () => void): HTMLButtonElement {
  const button = parent.createEl("button", { cls: "goodobsidian-width" });
  button.append(widthGlyph(width));
  button.setAttribute("aria-label", `Width ${formatMm(width)}`);
  button.setAttribute("title", formatMm(width));
  button.addEventListener("click", onPick);
  return button;
}

/** A stroke-width control drawn as a literal stroke of that weight. */
function widthGlyph(size: number): SVGElement {
  const svg = activeDocument.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 28 24");
  svg.setAttribute("width", "28");
  svg.setAttribute("height", "24");
  svg.setAttribute("aria-hidden", "true");
  const line = activeDocument.createElementNS(SVG_NS, "path");
  line.setAttribute("d", "M3 12h22");
  line.setAttribute("stroke", "currentColor");
  line.setAttribute("stroke-linecap", "round");
  line.setAttribute("stroke-width", String(Math.max(1.5, Math.min(12, size))));
  line.setAttribute("fill", "none");
  svg.append(line);
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
  key: "bold" | "italic" | "underline" | "strike",
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
function iconOrText(el: HTMLElement, icon: string, label: string): void {
  setIcon(el, icon);
  const svg = el.querySelector("svg");
  if (!svg || svg.childElementCount === 0) {
    el.empty();
    el.setText(label.slice(0, 2));
    el.addClass("goodobsidian-icon-fallback");
  }
}
