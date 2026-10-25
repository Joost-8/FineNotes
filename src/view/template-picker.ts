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

import {
  PAPER_SWATCHES,
  type PaperStyle,
  RULE_SWATCHES,
  SPACING_STEPS,
  paperStyleOf,
  styledBackdrop,
} from "../canvas/paper-style";
import { type App, Menu, Modal, setIcon } from "obsidian";
import { renderColorMixer } from "./color-picker";
import { LIGHT_PAPER, drawSynthetic } from "../canvas/backdrop";
import type {
  Backdrop,
  PageGeometry,
  PdfBackdrop,
  Ruling,
  SyntheticBackdrop,
} from "../model/document";
import type { InsertPosition } from "../model/page-commands";
import type { PaperEntry } from "../model/paper-library";
import {
  type PaperDesign,
  defaultPaperDesign,
  designBackdrop,
  designGeometry,
} from "../model/paper-design";
import { openPaperDesigner } from "./paper-designer";
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
  current: Backdrop;
  /** Geometry new pages inherit (the reference page's). */
  geometry: PageGeometry;
  recent: readonly SyntheticBackdrop[];
  /** The templates in My templates now, by name: a page made of one before it was marked is still one. */
  templateNames?: ReadonlySet<string>;
  position: InsertPosition;
  /** A page of My templates as a card preview `cssWidth` wide; called again once it has rendered. */
  paintPaper?: (canvas: HTMLCanvasElement, backdrop: PdfBackdrop, cssWidth: number) => void;
  onPick: (backdrop: Backdrop, position: InsertPosition) => void;
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
  /** The card showing a page of My templates, repainted when its PDF page renders. */
  private paperCard: { canvas: HTMLCanvasElement; backdrop: PdfBackdrop } | null = null;

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

  /** Repaint the My templates card of `path`: its PDF page has rendered. */
  paperReady(path: string): void {
    const card = this.paperCard;
    if (!card || this.closed || card.backdrop.path !== path) return;
    this.options.paintPaper?.(card.canvas, card.backdrop, CARD_WIDTH);
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
    const { current, recent, templateNames } = this.options;
    for (const card of popoverTemplates(current, recent, templateNames)) {
      const button = cards.createEl("button", { cls: "goodobsidian-template-card clickable-icon" });
      button.setAttribute("aria-label", `Add a page: ${card.label}`);
      const canvas = button.createEl("canvas", { cls: "goodobsidian-template-preview" });
      const backdrop = card.backdrop;
      if (backdrop.kind === "pdf") {
        this.paperCard = { canvas, backdrop };
        this.options.paintPaper?.(canvas, backdrop, CARD_WIDTH);
      } else {
        paintTemplatePreview(canvas, backdrop, this.options.geometry, CARD_WIDTH);
      }
      button.createDiv({ cls: "goodobsidian-template-name", text: card.label });
      button.createDiv({
        cls: "goodobsidian-template-sub",
        text: backdrop.kind === "pdf" ? "My templates" : paperLabel(backdrop),
      });
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

  /** Paint every preview on `color` paper at `geometry`, in `style` when given. */
  repaint(color: PaperColorId, geometry: PageGeometry, style: PaperStyle = {}): void {
    const width = this.options.previewWidth ?? PREVIEW_WIDTH;
    for (const card of this.cards) {
      paintTemplatePreview(card.canvas, styledBackdrop(card.ruling, color, style), geometry, width);
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

  /**
   * Show no card as chosen (a paper from My templates is), or (`false`) the
   * chosen ruling again.
   */
  setDimmed(dimmed: boolean): void {
    this.dimmed = dimmed;
    this.sync();
  }

  private dimmed = false;

  private sync(): void {
    for (const card of this.cards) {
      const active = !this.dimmed && card.ruling === this.selected;
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

/**
 * "My templates" (`model/paper-library.ts`): the papers a user imported, a
 * card per PDF page, offered above the built-in papers. The host lists and
 * paints them, and imports more.
 */
export interface PaperLibraryHost {
  list(): Promise<PaperEntry[]>;
  /** Paint `entry` as a preview `cssWidth` wide; called again when its PDF page has rendered. */
  paint(canvas: HTMLCanvasElement, entry: PaperEntry, cssWidth: number): void;
  /**
   * Import a PDF or picture from the device. Must start its picker inside the
   * tap (iPadOS opens one only then). True when papers were added.
   */
  importFile(host: HTMLElement): Promise<boolean>;
  /** Import a PDF or picture already in the vault. True when papers were added. */
  importFromVault(): Promise<boolean>;
  /** Browse the community template gallery. True when papers were added from it. */
  browseCommunity?(): Promise<boolean>;
  /** Share a template with the community gallery; `path` preselects it. */
  shareTemplate?(path?: string): void;
  /** Delete a template from My templates, once the user agrees. True when it went. */
  deleteTemplate?(path: string): Promise<boolean>;
  /**
   * Keep a paper made in the paper designer: over the design at `path` when
   * editing one. Resolves to the saved paper, or null.
   */
  saveDesign?(design: PaperDesign, path?: string): Promise<PaperEntry | null>;
}

export interface MyTemplatesOptions {
  host: PaperLibraryHost;
  /**
   * A card per template file, not per page: a new notebook takes a whole
   * template (every page of a planner). The entry chosen is its first page.
   */
  wholeFiles?: boolean;
  previewWidth?: number;
  onChoose: (entry: PaperEntry) => void;
  onActivate?: (entry: PaperEntry) => void;
  /** Chosen as the section opens (through `onChoose`), when it is still in the library. */
  initial?: { path: string; page: number };
  /** A template was deleted; a dialog that had it chosen lets go of it. */
  onRemoved?: (path: string) => void;
}

/**
 * "My templates" (`model/paper-library.ts`): a section like the built-in
 * ones, with cards to bring templates in (from the device, from the vault,
 * from the community gallery) and a card for each paper. Used by the
 * template picker and the New notebook dialog.
 */
export class MyTemplatesSection {
  readonly el: HTMLElement;
  private cards: Array<{ entry: PaperEntry; root: HTMLElement; canvas: HTMLCanvasElement }> = [];
  private chosen: PaperEntry | null = null;
  private alive = true;
  private initial: { path: string; page: number } | null;

  constructor(
    parent: HTMLElement,
    private readonly options: MyTemplatesOptions,
  ) {
    this.el = parent.createDiv({ cls: "goodobsidian-my-papers" });
    this.initial = options.initial ?? null;
    void this.render();
  }

  /** Show `entry` as chosen, or none. */
  select(entry: PaperEntry | null): void {
    this.chosen = entry;
    this.sync();
  }

  /** Repaint the previews of `path`'s pages: one of its PDF pages has rendered. */
  paperReady(path: string): void {
    const width = this.options.previewWidth ?? PREVIEW_WIDTH;
    for (const card of this.cards) {
      if (card.entry.path === path) this.options.host.paint(card.canvas, card.entry, width);
    }
  }

  /** Stop drawing: the dialog closed. */
  dispose(): void {
    this.alive = false;
  }

  private async render(): Promise<void> {
    const { host } = this.options;
    const width = this.options.previewWidth ?? PREVIEW_WIDTH;
    const all = await host.list().catch(() => [] as PaperEntry[]);
    if (!this.alive) return;
    // A whole template: the first page of each file, with its page count.
    const counts = new Map<string, number>();
    for (const entry of all) counts.set(entry.path, (counts.get(entry.path) ?? 0) + 1);
    const entries = this.options.wholeFiles ? all.filter((entry) => entry.page === 0) : all;
    this.el.empty();
    this.cards = [];
    // Only the first listing: a later one (after an import or a delete) keeps what was chosen since.
    const initial = this.initial;
    this.initial = null;
    const found =
      initial &&
      entries.find((entry) => entry.path === initial.path && entry.page === initial.page);
    if (found) this.options.onChoose(found);
    const details = this.el.createEl("details", { cls: "goodobsidian-templates-section" });
    details.open = true;
    const summary = details.createEl("summary");
    setIcon(summary.createSpan({ cls: "goodobsidian-templates-chevron" }), "chevron-down");
    summary.createSpan({ text: "My templates" });
    const refresh = (added: boolean): void => {
      if (added && this.alive) void this.render();
    };
    // Small buttons beside the title: + (bring templates in) and Share.
    // Inside the summary, so a tap on them must not fold the section.
    const tools = summary.createSpan({ cls: "goodobsidian-my-papers-tools" });
    const tool = (icon: string, label: string): HTMLButtonElement => {
      const button = tools.createEl("button", {
        cls: "goodobsidian-my-papers-tool clickable-icon",
        attr: { "aria-label": label, title: label },
      });
      setIcon(button, icon);
      return button;
    };
    const add = tool("plus", "Add templates");
    const share = host.shareTemplate?.bind(host);
    // Only a PDF or picture can go to the community gallery, not a designed paper.
    if (share && entries.some((entry) => !entry.design)) {
      tool("share-2", "Share a template").addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        share();
      });
    }
    // The + opens a small list of its own buttons, not an Obsidian menu:
    // From files… must open the system picker inside the tap itself.
    const list = this.el.createDiv({ cls: "goodobsidian-my-papers-add is-hidden" });
    const close = (): void => {
      list.addClass("is-hidden");
      activeDocument.removeEventListener("pointerdown", outside, true);
    };
    const outside = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (target && (list.contains(target) || add.contains(target))) return;
      close();
    };
    const item = (icon: string, label: string, run: (button: HTMLElement) => void): void => {
      const button = list.createEl("button", {
        cls: "goodobsidian-my-papers-add-item clickable-icon",
      });
      setIcon(button.createSpan({ cls: "goodobsidian-my-papers-add-icon" }), icon);
      button.createSpan({ text: label });
      button.addEventListener("click", () => {
        close();
        run(button);
      });
    };
    if (host.saveDesign) item("pencil-ruler", "Design a paper…", () => this.openDesigner(null));
    const browse = host.browseCommunity?.bind(host);
    if (browse) item("globe", "Community templates…", () => void browse().then(refresh));
    item("file-up", "From files…", (button) => void host.importFile(button).then(refresh));
    item("folder-open", "From vault…", () => void host.importFromVault().then(refresh));
    add.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!list.hasClass("is-hidden")) {
        close();
        return;
      }
      list.removeClass("is-hidden");
      activeDocument.addEventListener("pointerdown", outside, true);
    });
    const row = details.createDiv({ cls: "goodobsidian-templates-row" });
    for (const entry of entries) {
      const pages = counts.get(entry.path) ?? 1;
      const name =
        this.options.wholeFiles && pages > 1
          ? `${entry.name.replace(/ · 1$/, "")} · ${pages} pages`
          : entry.name;
      // The card and its ⋯ side by side in a frame: a button cannot hold a button.
      const frame = row.createDiv({ cls: "goodobsidian-template-card-frame" });
      const root = frame.createEl("button", {
        cls: "goodobsidian-template-card is-large clickable-icon",
        attr: { "aria-label": name, title: name },
      });
      this.cardMenu(frame, entry, pages);
      const canvas = root.createEl("canvas", { cls: "goodobsidian-template-preview" });
      root.createDiv({ cls: "goodobsidian-template-name", text: name });
      root.addEventListener("click", () => this.options.onChoose(entry));
      root.addEventListener("dblclick", () => this.options.onActivate?.(entry));
      this.cards.push({ entry, root, canvas });
      host.paint(canvas, entry, width);
    }
    if (entries.length === 0) {
      row.createDiv({
        cls: "goodobsidian-my-papers-empty",
        text: "Tap + to design a paper, bring in a PDF or picture, or find one in the community gallery: every page of it is a paper here.",
      });
    }
    this.sync();
  }

  /**
   * The designer, in place of this section's dialog (never a dialog on a
   * dialog), for a new paper or to edit `entry`. Back returns to the dialog
   * as it was; Save returns with the saved paper listed and chosen.
   */
  private openDesigner(entry: PaperEntry | null): void {
    const { host } = this.options;
    const saveDesign = host.saveDesign?.bind(host);
    const modalEl = this.el.closest<HTMLElement>(".modal");
    if (!saveDesign || !modalEl) return;
    let saved: PaperEntry | null = null;
    openPaperDesigner(modalEl, {
      design: entry?.design ?? defaultPaperDesign(),
      editing: entry?.design !== undefined,
      save: async (design) => {
        saved = await saveDesign(design, entry?.path);
        return saved !== null;
      },
      done: () => {
        const chosen = saved;
        if (!chosen || !this.alive) return;
        if (entry && entry.path !== chosen.path) this.options.onRemoved?.(entry.path);
        void this.render().then(() => {
          if (this.alive) this.options.onChoose(chosen);
        });
      },
    });
  }

  /**
   * The ⋯ on a card: share the template, or delete it (the whole file, every
   * page); a designed paper is edited instead of shared.
   */
  private cardMenu(frame: HTMLElement, entry: PaperEntry, pages: number): void {
    const { host } = this.options;
    const path = entry.path;
    const design = entry.design !== undefined;
    const share = design ? undefined : host.shareTemplate?.bind(host);
    const edit = design && host.saveDesign ? () => this.openDesigner(entry) : undefined;
    const remove = host.deleteTemplate?.bind(host);
    if (!share && !remove && !edit) return;
    const more = frame.createEl("button", {
      cls: "goodobsidian-template-card-more clickable-icon",
      attr: { "aria-label": "Template options", title: "Template options" },
    });
    setIcon(more, "more-horizontal");
    more.addEventListener("click", (event) => {
      event.stopPropagation();
      const menu = new Menu();
      if (edit) {
        menu.addItem((item) => item.setTitle("Edit…").setIcon("pencil").onClick(edit));
      }
      if (share) {
        menu.addItem((item) =>
          item
            .setTitle("Share…")
            .setIcon("share-2")
            .onClick(() => share(path)),
        );
      }
      if (remove) {
        menu.addItem((item) =>
          item
            .setTitle(pages > 1 ? `Delete template (${pages} pages)` : "Delete template")
            .setIcon("trash-2")
            .setWarning(true)
            .onClick(() => {
              void remove(path).then((gone) => {
                if (!gone || !this.alive) return;
                if (this.chosen?.path === path) this.chosen = null;
                this.options.onRemoved?.(path);
                void this.render();
              });
            }),
        );
      }
      const box = more.getBoundingClientRect();
      menu.showAtPosition({ x: box.left, y: box.bottom });
    });
  }

  private sync(): void {
    const chosen = this.chosen;
    for (const card of this.cards) {
      const on =
        chosen !== null && card.entry.path === chosen.path && card.entry.page === chosen.page;
      card.root.toggleClass("is-selected", on);
      card.root.setAttribute("aria-pressed", String(on));
    }
  }
}

export interface TemplatePickerOptions {
  mode: "add" | "change";
  /** My templates, when the host has a library. */
  papers?: PaperLibraryHost;
  /** A paper from My templates was applied (instead of `onApply`). */
  onApplyPaper?: (entry: PaperEntry) => void;
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
  private style: PaperStyle;
  private styleEl: HTMLElement | null = null;
  /** Which row's custom colour mixer is open under it, if any. */
  private mixing: "paper" | "rule" | null = null;
  private sizeId: string;
  private landscape: boolean;
  private grid: TemplateGrid | null = null;
  /** The paper from My templates chosen, if one is (it wins over the ruling). */
  private paper: PaperEntry | null = null;
  private papers: MyTemplatesSection | null = null;

  constructor(
    app: App,
    private readonly options: TemplatePickerOptions,
  ) {
    super(app);
    this.ruling = options.initial.kind;
    this.color = paperColorOf(options.initial);
    this.style = paperStyleOf(options.initial);
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
        // A paper colour picked in the list replaces a custom one.
        if (state.color !== this.color) delete this.style.paper;
        this.color = state.color;
        this.landscape = state.landscape;
        this.renderStyle();
        this.repaint();
      },
    });
    this.styleEl = contentEl.createDiv({ cls: "goodobsidian-paper-style" });
    this.renderStyle();

    this.grid = new TemplateGrid(contentEl, {
      selected: this.ruling,
      onSelect: (ruling) => {
        this.ruling = ruling;
        this.choosePaper(null);
      },
      onActivate: (ruling) => {
        this.ruling = ruling;
        this.apply();
      },
    });
    // My templates first, in the same scrolling list as the built-in papers.
    if (this.options.papers) {
      this.papers = new MyTemplatesSection(createDiv(), {
        host: this.options.papers,
        onChoose: (entry) => this.choosePaper(entry),
        onActivate: (entry) => {
          this.choosePaper(entry);
          this.apply();
        },
        onRemoved: (path) => {
          if (this.paper?.path === path) this.choosePaper(null);
        },
      });
      this.grid.el.prepend(this.papers.el);
    }

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
    this.papers?.dispose();
    this.papers = null;
    this.styleEl = null;
    this.contentEl.empty();
  }

  /** The geometry previews are drawn at, and the one Apply will use. */
  private geometry(): PageGeometry {
    return this.sizeId === KEEP_SIZE
      ? this.options.geometry
      : sizeGeometry(this.sizeId, this.landscape);
  }

  private repaint(): void {
    this.grid?.repaint(this.color, this.geometry(), this.style);
  }

  /**
   * Paper colour, line colour and spacing: rows of swatches and steps under
   * the size and orientation, each choice repainting the previews at once.
   */
  private renderStyle(): void {
    const el = this.styleEl;
    if (!el) return;
    el.empty();
    const set = (patch: PaperStyle): void => {
      this.mixing = null;
      this.style = { ...this.style, ...patch };
      for (const key of Object.keys(this.style) as Array<keyof PaperStyle>) {
        if (this.style[key] === undefined) delete this.style[key];
      }
      this.renderStyle();
      this.repaint();
    };
    const shownPaper = (
      this.style.paper ??
      styledBackdrop("blank", this.color).paperColor ??
      "#ffffff"
    ).toLowerCase();

    const paperRow = el.createDiv({ cls: "goodobsidian-paper-style-row" });
    paperRow.createSpan({ cls: "goodobsidian-paper-style-label", text: "Paper" });
    for (const swatch of PAPER_SWATCHES) {
      this.swatch(paperRow, swatch.label, swatch.color, swatch.color === shownPaper, () =>
        set({ paper: swatch.color }),
      );
    }
    const paperCustom = !PAPER_SWATCHES.some((s) => s.color === shownPaper);
    this.customSwatch(paperRow, "paper", "Any paper colour", paperCustom ? shownPaper : null);
    this.mixer(el, "paper", shownPaper, (paper) => set({ paper }));

    const ruleRow = el.createDiv({ cls: "goodobsidian-paper-style-row" });
    ruleRow.createSpan({ cls: "goodobsidian-paper-style-label", text: "Lines" });
    for (const swatch of RULE_SWATCHES) {
      const on = (swatch.color ?? undefined) === this.style.rule;
      const button = this.swatch(ruleRow, swatch.label, swatch.color ?? shownPaper, on, () =>
        set({ rule: swatch.color ?? undefined }),
      );
      if (swatch.color === null) button.addClass("is-default");
    }
    const rule = this.style.rule;
    const ruleCustom = rule !== undefined && !RULE_SWATCHES.some((s) => s.color === rule);
    this.customSwatch(ruleRow, "rule", "Any line colour", ruleCustom ? rule : null);
    this.mixer(el, "rule", rule ?? "#9aa0ab", (color) => set({ rule: color }));

    const spacingRow = el.createDiv({ cls: "goodobsidian-paper-style-row" });
    spacingRow.createSpan({ cls: "goodobsidian-paper-style-label", text: "Spacing" });
    const steps = spacingRow.createDiv({ cls: "goodobsidian-segmented" });
    for (const step of SPACING_STEPS) {
      const on = (this.style.spacing ?? 1) === step.k;
      const button = steps.createEl("button", { cls: "clickable-icon", text: step.label });
      button.toggleClass("is-active", on);
      button.setAttribute("aria-pressed", String(on));
      button.addEventListener("click", () => set({ spacing: step.k === 1 ? undefined : step.k }));
    }
  }

  /**
   * The last swatch of a row: any colour. A ring of every hue, holding the
   * colour when it is one of no preset; a tap opens the mixer under the row.
   */
  private customSwatch(
    row: HTMLElement,
    which: "paper" | "rule",
    label: string,
    color: string | null,
  ): void {
    const open = this.mixing === which;
    const button = row.createEl("button", {
      cls: "goodobsidian-paper-swatch is-custom clickable-icon",
      attr: { "aria-label": label, title: label, "aria-expanded": String(open) },
    });
    const disc = button.createSpan({ cls: "goodobsidian-paper-swatch-disc" });
    if (color)
      disc.createSpan({ cls: "goodobsidian-paper-swatch-own" }).setCssStyles({ background: color });
    button.toggleClass("is-active", color !== null || open);
    button.addEventListener("click", () => {
      this.mixing = open ? null : which;
      this.renderStyle();
    });
  }

  /**
   * The custom colour mixer under the rows, for `which` when it is open. The
   * mixer reports only when its + is tapped, so dragging across the square
   * or the hue never picks a colour half way, and nothing here redraws the
   * mixer while a finger is on it.
   */
  private mixer(
    el: HTMLElement,
    which: "paper" | "rule",
    initial: string,
    use: (color: string) => void,
  ): void {
    if (this.mixing !== which) return;
    const panel = el.createDiv({ cls: "goodobsidian-paper-style-mixer" });
    renderColorMixer(panel, initial, (color) => use(color.toLowerCase()));
  }

  private swatch(
    row: HTMLElement,
    label: string,
    color: string,
    on: boolean,
    pick: () => void,
  ): HTMLButtonElement {
    const button = row.createEl("button", {
      cls: "goodobsidian-paper-swatch clickable-icon",
      attr: { "aria-label": label, title: label, "aria-pressed": String(on) },
    });
    button
      .createSpan({ cls: "goodobsidian-paper-swatch-disc" })
      .setCssStyles({ backgroundColor: color });
    button.toggleClass("is-active", on);
    button.addEventListener("click", pick);
    return button;
  }

  /** Repaint the previews of `path`'s pages: one of its PDF pages has rendered. */
  paperReady(path: string): void {
    this.papers?.paperReady(path);
  }

  private choosePaper(entry: PaperEntry | null): void {
    this.paper = entry;
    this.grid?.setDimmed(entry !== null);
    this.papers?.select(entry);
  }

  private apply(): void {
    const paper = this.paper;
    // A designed paper is an ordinary backdrop at its own size: no file to copy.
    if (paper?.design) {
      const choice: TemplateChoice = {
        backdrop: designBackdrop(paper.design),
        geometry: designGeometry(paper.design),
      };
      this.close();
      this.options.onApply(choice);
      return;
    }
    if (paper && this.options.onApplyPaper) {
      this.close();
      this.options.onApplyPaper(paper);
      return;
    }
    const choice: TemplateChoice = {
      backdrop: styledBackdrop(this.ruling, this.color, this.style),
      geometry: this.sizeId === KEEP_SIZE ? null : sizeGeometry(this.sizeId, this.landscape),
    };
    this.close();
    this.options.onApply(choice);
  }
}
