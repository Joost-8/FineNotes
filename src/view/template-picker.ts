/**
 * Choosing a page template, after GoodNotes:
 *
 * - {@link AddPagePopover} — the small sheet an add-page control opens:
 *   Before / After / Last page, the current and recent templates as cards (one
 *   tap adds the page), and "More from templates…".
 * - {@link TemplatePickerModal} — the full picker: page size, paper colour and
 *   orientation, every template in sections, Cancel / Apply. It serves both
 *   "add a page" and "change this page's template".
 *
 * Both only report a choice; the host turns it into an undoable command.
 *
 * The picker's parts — {@link PaperControls} (size, colour, orientation) and
 * {@link TemplateGrid} (every template, previewed with the real painter) —
 * are exported for the "New notebook" dialog, which asks the same questions.
 */

import { type App, Modal, setIcon } from "obsidian";
import { LIGHT_PAPER, drawSynthetic } from "../canvas/backdrop";
import type { PageGeometry, Ruling, SyntheticBackdrop } from "../model/document";
import type { InsertPosition } from "../model/page-commands";
import {
  PAGE_SIZES,
  PAPER_COLORS,
  type PaperColorId,
  TEMPLATE_SECTIONS,
  paperColorOf,
  paperLabel,
  popoverTemplates,
  sizeGeometry,
  sizeOf,
  templateBackdrop,
} from "../model/templates";

/** Paint a template preview into `canvas`, `cssWidth` CSS px wide. */
export function paintTemplatePreview(
  canvas: HTMLCanvasElement,
  backdrop: SyntheticBackdrop,
  geometry: PageGeometry,
  cssWidth: number,
): void {
  const dpr = window.devicePixelRatio || 1;
  const k = (cssWidth / geometry.width) * dpr;
  canvas.width = Math.max(1, Math.round(geometry.width * k));
  canvas.height = Math.max(1, Math.round(geometry.height * k));
  canvas.setCssStyles({ aspectRatio: `${geometry.width} / ${geometry.height}` });
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  // Rules are 1 page px; at this scale that is a tenth of a CSS pixel and
  // would vanish. Draw them about half a CSS pixel wide instead.
  const cssScale = cssWidth / geometry.width;
  drawSynthetic(ctx, backdrop, geometry, LIGHT_PAPER, Math.max(1, 0.5 / cssScale));
}

// --- Anchored popovers ------------------------------------------------------

/** Below `anchor`, right-aligned to it, kept inside the window. */
export function placePopover(el: HTMLElement, anchor: HTMLElement, maxWidth: number): void {
  const r = anchor.getBoundingClientRect();
  const width = Math.min(maxWidth, window.innerWidth - 16);
  let left = r.right - width;
  if (left < 8) left = Math.min(r.left, window.innerWidth - width - 8);
  left = Math.max(8, left);
  const height = el.offsetHeight;
  let top = r.bottom + 6;
  if (top + height > window.innerHeight - 8) top = Math.max(8, r.top - height - 6);
  el.setCssStyles({ left: `${left}px`, top: `${top}px`, width: `${width}px` });
}

/**
 * Close a popover on a tap outside it or its anchor, or on Escape; follow the
 * anchor through a rotation or a keyboard appearing rather than vanishing
 * mid-choice. Returns the function that removes the listeners.
 */
export function installPopoverDismiss(
  el: HTMLElement,
  anchor: HTMLElement,
  close: () => void,
  replace: () => void,
): () => void {
  const onDown = (event: PointerEvent): void => {
    const target = event.target as Node | null;
    if (target && (el.contains(target) || anchor.contains(target))) return;
    close();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") close();
  };
  // Close only if the anchor itself went away.
  const onResize = (): void => {
    if (anchor.isConnected) replace();
    else close();
  };
  // Capture: the drawing surface consumes its own pointer events.
  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", onResize);
  // A second tap on the anchor is the host's to handle: it closes the
  // popover instead of opening another (see each popover's `isOpen`).
  return () => {
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", onResize);
  };
}

// --- The popover ------------------------------------------------------------

export interface AddPagePopoverOptions {
  /** The template of the page the popover was opened from. */
  current: SyntheticBackdrop | { kind: "pdf"; path: string; page: number };
  /** Geometry new pages inherit (the reference page's). */
  geometry: PageGeometry;
  recent: readonly SyntheticBackdrop[];
  position: InsertPosition;
  onPick: (backdrop: SyntheticBackdrop, position: InsertPosition) => void;
  onMore: (position: InsertPosition) => void;
}

const POPOVER_WIDTH = 340;
const CARD_WIDTH = 64;

export class AddPagePopover {
  private readonly el: HTMLElement;
  private position: InsertPosition;
  private readonly segments = new Map<InsertPosition, HTMLButtonElement>();
  private readonly dispose: Array<() => void> = [];
  private closed = false;

  constructor(
    anchor: HTMLElement,
    private readonly options: AddPagePopoverOptions,
  ) {
    this.position = options.position;
    this.el = document.body.createDiv({ cls: "goodobsidian-addpage" });
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-label", "Add page");
    this.build();
    placePopover(this.el, anchor, POPOVER_WIDTH);
    this.dispose.push(
      installPopoverDismiss(
        this.el,
        anchor,
        () => this.close(),
        () => placePopover(this.el, anchor, POPOVER_WIDTH),
      ),
    );
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const d of this.dispose) d();
    this.el.remove();
  }

  private build(): void {
    this.el.createDiv({ cls: "goodobsidian-addpage-title", text: "Add Page" });

    const seg = this.el.createDiv({ cls: "goodobsidian-segmented" });
    const labels: Array<[InsertPosition, string]> = [
      ["before", "Before"],
      ["after", "After"],
      ["last", "Last page"],
    ];
    for (const [pos, label] of labels) {
      // `clickable-icon` on every button in this file: see page-sidebar.ts.
      const button = seg.createEl("button", { cls: "clickable-icon", text: label });
      button.addEventListener("click", () => {
        this.position = pos;
        this.syncSegments();
      });
      this.segments.set(pos, button);
    }
    this.syncSegments();

    this.el.createDiv({ cls: "goodobsidian-addpage-heading", text: "Recent templates" });
    this.el.createDiv({
      cls: "goodobsidian-addpage-hint",
      text: "Templates shown here keep the current page's size.",
    });
    const cards = this.el.createDiv({ cls: "goodobsidian-addpage-cards" });
    for (const card of popoverTemplates(this.options.current, this.options.recent)) {
      const button = cards.createEl("button", { cls: "goodobsidian-template-card clickable-icon" });
      button.setAttribute("aria-label", `Add a page: ${card.label}`);
      const canvas = button.createEl("canvas", { cls: "goodobsidian-template-preview" });
      paintTemplatePreview(canvas, card.backdrop, this.options.geometry, CARD_WIDTH);
      button.createDiv({ cls: "goodobsidian-template-name", text: card.label });
      button.createDiv({ cls: "goodobsidian-template-sub", text: paperLabel(card.backdrop) });
      button.addEventListener("click", () => {
        this.close();
        this.options.onPick(card.backdrop, this.position);
      });
    }

    this.el.createDiv({ cls: "goodobsidian-addpage-divider" });
    const more = this.el.createEl("button", { cls: "goodobsidian-addpage-row clickable-icon" });
    const icon = more.createSpan({ cls: "goodobsidian-addpage-row-icon" });
    setIcon(icon, "layout-template");
    more.createSpan({ text: "More from templates…" });
    more.addEventListener("click", () => {
      this.close();
      this.options.onMore(this.position);
    });
  }

  private syncSegments(): void {
    for (const [pos, button] of this.segments) {
      button.toggleClass("is-active", pos === this.position);
      button.setAttribute("aria-pressed", String(pos === this.position));
    }
  }
}

// --- Picker parts -------------------------------------------------------------

/** Size-select value meaning "leave the page the size it is". */
export const KEEP_SIZE = "keep";

export interface PaperControlsState {
  /** A {@link PAGE_SIZES} id, or {@link KEEP_SIZE}. */
  sizeId: string;
  color: PaperColorId;
  landscape: boolean;
}

export interface PaperControlsOptions extends PaperControlsState {
  /** Offer "Current size", which keeps the page as it is, orientation included. */
  keepSize: boolean;
  onChange: (state: PaperControlsState) => void;
}

/** Page size, paper colour and orientation: the row above the templates. */
export class PaperControls {
  readonly state: PaperControlsState;
  private readonly portrait: HTMLButtonElement;
  private readonly landscape: HTMLButtonElement;

  constructor(
    bar: HTMLElement,
    private readonly options: PaperControlsOptions,
  ) {
    this.state = { sizeId: options.sizeId, color: options.color, landscape: options.landscape };

    const size = bar.createEl("select", { cls: "dropdown" });
    size.setAttribute("aria-label", "Page size");
    if (options.keepSize) size.createEl("option", { text: "Current size", value: KEEP_SIZE });
    for (const s of PAGE_SIZES) size.createEl("option", { text: s.label, value: s.id });
    size.value = this.state.sizeId;
    size.addEventListener("change", () => {
      this.state.sizeId = size.value;
      this.syncOrientation();
      this.changed();
    });

    const color = bar.createEl("select", { cls: "dropdown" });
    color.setAttribute("aria-label", "Paper colour");
    for (const c of PAPER_COLORS) color.createEl("option", { text: c.label, value: c.id });
    color.value = this.state.color;
    color.addEventListener("change", () => {
      this.state.color = color.value as PaperColorId;
      this.changed();
    });

    const orient = bar.createDiv({ cls: "goodobsidian-segmented is-icons" });
    this.portrait = orient.createEl("button", { cls: "clickable-icon" });
    setIcon(this.portrait, "rectangle-vertical");
    this.portrait.setAttribute("aria-label", "Portrait");
    this.landscape = orient.createEl("button", { cls: "clickable-icon" });
    setIcon(this.landscape, "rectangle-horizontal");
    this.landscape.setAttribute("aria-label", "Landscape");
    this.portrait.addEventListener("click", () => this.setLandscape(false));
    this.landscape.addEventListener("click", () => this.setLandscape(true));
    this.syncOrientation();
  }

  private setLandscape(landscape: boolean): void {
    this.state.landscape = landscape;
    this.syncOrientation();
    this.changed();
  }

  /** "Current size" keeps the page as it is, orientation included. */
  private syncOrientation(): void {
    const keep = this.state.sizeId === KEEP_SIZE;
    for (const [button, value] of [
      [this.portrait, false],
      [this.landscape, true],
    ] as const) {
      button.disabled = keep;
      button.toggleClass("is-active", !keep && this.state.landscape === value);
      button.setAttribute("aria-pressed", String(!keep && this.state.landscape === value));
    }
  }

  private changed(): void {
    this.options.onChange({ ...this.state });
  }
}

export interface TemplateGridOptions {
  selected: Ruling;
  onSelect: (ruling: Ruling) => void;
  /** A double tap: choose this one and be done. */
  onActivate?: (ruling: Ruling) => void;
  /**
   * `"all"` opens every section; `"selected"` only the one holding the
   * selection, which keeps a dialog that asks other questions too compact.
   */
  open?: "all" | "selected";
  /** Preview width in CSS px. */
  previewWidth?: number;
}

/** Every paper template in GoodNotes' sections, each previewed with the real painter. */
export class TemplateGrid {
  readonly el: HTMLElement;
  private selected: Ruling;
  private readonly cards: Array<{ ruling: Ruling; root: HTMLElement; canvas: HTMLCanvasElement }> =
    [];

  constructor(
    parent: HTMLElement,
    private readonly options: TemplateGridOptions,
  ) {
    this.selected = options.selected;
    this.el = parent.createDiv({ cls: "goodobsidian-templates-sections" });
    for (const section of TEMPLATE_SECTIONS) {
      const details = this.el.createEl("details", { cls: "goodobsidian-templates-section" });
      details.open =
        options.open !== "selected" || section.templates.some((t) => t.ruling === this.selected);
      const summary = details.createEl("summary");
      setIcon(summary.createSpan({ cls: "goodobsidian-templates-chevron" }), "chevron-down");
      summary.createSpan({ text: section.title });
      const row = details.createDiv({ cls: "goodobsidian-templates-row" });
      for (const template of section.templates) {
        const root = row.createEl("button", {
          cls: "goodobsidian-template-card is-large clickable-icon",
        });
        root.setAttribute("aria-label", template.name);
        const canvas = root.createEl("canvas", { cls: "goodobsidian-template-preview" });
        root.createDiv({ cls: "goodobsidian-template-name", text: template.name });
        root.addEventListener("click", () => {
          this.select(template.ruling);
          this.options.onSelect(template.ruling);
        });
        root.addEventListener("dblclick", () => {
          this.select(template.ruling);
          this.options.onActivate?.(template.ruling);
        });
        this.cards.push({ ruling: template.ruling, root, canvas });
      }
    }
    this.sync();
  }

  get ruling(): Ruling {
    return this.selected;
  }

  select(ruling: Ruling): void {
    this.selected = ruling;
    this.sync();
  }

  /** Paint every preview on `color` paper at `geometry`. */
  repaint(color: PaperColorId, geometry: PageGeometry): void {
    const width = this.options.previewWidth ?? PREVIEW_WIDTH;
    for (const card of this.cards) {
      paintTemplatePreview(card.canvas, templateBackdrop(card.ruling, color), geometry, width);
    }
  }

  /**
   * Bring the selected card into view — scrolling only its row and this
   * grid, never an ancestor: `scrollIntoView` would also scroll Obsidian's
   * own workspace on iPad.
   */
  reveal(): void {
    const card = this.cards.find((c) => c.ruling === this.selected)?.root;
    const row = card?.parentElement;
    if (!card || !row) return;
    const box = card.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    row.scrollLeft += box.left + box.width / 2 - (rowBox.left + rowBox.width / 2);
    const panel = this.el.getBoundingClientRect();
    if (box.top < panel.top) this.el.scrollTop -= panel.top - box.top + 8;
    else if (box.bottom > panel.bottom) this.el.scrollTop += box.bottom - panel.bottom + 8;
  }

  private sync(): void {
    for (const card of this.cards) {
      const active = card.ruling === this.selected;
      card.root.toggleClass("is-selected", active);
      card.root.setAttribute("aria-pressed", String(active));
    }
  }
}

// --- The full picker --------------------------------------------------------

export interface TemplateChoice {
  backdrop: SyntheticBackdrop;
  /** The chosen page size, or null to keep the page's current one. */
  geometry: PageGeometry | null;
}

export interface TemplatePickerOptions {
  mode: "add" | "change";
  /** Preselected template (the reference page's). */
  initial: SyntheticBackdrop;
  /** The reference page's geometry: preselects size and orientation. */
  geometry: PageGeometry;
  onApply: (choice: TemplateChoice) => void;
}

const PREVIEW_WIDTH = 96;

export class TemplatePickerModal extends Modal {
  private ruling: Ruling;
  private color: PaperColorId;
  private sizeId: string;
  private landscape: boolean;
  private grid: TemplateGrid | null = null;

  constructor(
    app: App,
    private readonly options: TemplatePickerOptions,
  ) {
    super(app);
    this.ruling = options.initial.kind;
    this.color = paperColorOf(options.initial);
    const size = sizeOf(options.geometry);
    this.sizeId = size?.sizeId ?? KEEP_SIZE;
    this.landscape = size?.landscape ?? options.geometry.width > options.geometry.height;
  }

  override onOpen(): void {
    this.modalEl.addClass("goodobsidian-templates-modal", "goodobsidian-dialog");
    this.titleEl.setText(this.options.mode === "add" ? "Paper" : "Change template");
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("goodobsidian-templates");

    // A change keeps the page's size unless the user picks another one.
    const keepSize = this.sizeId === KEEP_SIZE || this.options.mode === "change";
    if (this.options.mode === "change") this.sizeId = KEEP_SIZE;
    new PaperControls(contentEl.createDiv({ cls: "goodobsidian-templates-controls" }), {
      keepSize,
      sizeId: this.sizeId,
      color: this.color,
      landscape: this.landscape,
      onChange: (state) => {
        this.sizeId = state.sizeId;
        this.color = state.color;
        this.landscape = state.landscape;
        this.repaint();
      },
    });

    this.grid = new TemplateGrid(contentEl, {
      selected: this.ruling,
      onSelect: (ruling) => {
        this.ruling = ruling;
      },
      onActivate: (ruling) => {
        this.ruling = ruling;
        this.apply();
      },
    });

    const footer = contentEl.createDiv({ cls: "goodobsidian-templates-footer" });
    const cancel = footer.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
    const apply = footer.createEl("button", { cls: "mod-cta", text: "Apply" });
    apply.addEventListener("click", () => this.apply());

    this.repaint();
    // Bring the preselected template into view.
    window.requestAnimationFrame(() => this.grid?.reveal());
  }

  override onClose(): void {
    this.grid = null;
    this.contentEl.empty();
  }

  /** The geometry previews are drawn at, and the one Apply will use. */
  private geometry(): PageGeometry {
    return this.sizeId === KEEP_SIZE
      ? this.options.geometry
      : sizeGeometry(this.sizeId, this.landscape);
  }

  private repaint(): void {
    this.grid?.repaint(this.color, this.geometry());
  }

  private apply(): void {
    const choice: TemplateChoice = {
      backdrop: templateBackdrop(this.ruling, this.color),
      geometry: this.sizeId === KEEP_SIZE ? null : sizeGeometry(this.sizeId, this.landscape),
    };
    this.close();
    this.options.onApply(choice);
  }
}
