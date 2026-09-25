/**
 * Choosing a notebook cover: a design (or none) and a colour, each design
 * previewed with the real painter in the chosen colour.
 *
 * - {@link CoverPicker} — the design row and colour row, shared by the "New
 *   notebook" dialog and the popover below.
 * - {@link CoverPopover} — a cover page's "Change cover", hung from its
 *   thumbnail's "…" button. Every tap applies at once, so the page itself is
 *   the preview; each is an undoable step.
 *
 * Both only report a choice; the host turns it into a command.
 */

import { setIcon } from "obsidian";
import {
  type CoverRuling,
  type PageGeometry,
  type SyntheticBackdrop,
  isCoverRuling,
} from "../model/document";
import type { CoverChoice } from "../model/new-notebook";
import { COVER_COLORS, COVER_TEMPLATES } from "../model/templates";
import { installPopoverDismiss, paintTemplatePreview, placePopover } from "./template-picker";

export interface CoverPickerOptions {
  design: CoverChoice;
  /** The cover colour, hex. One of {@link COVER_COLORS}, or a colour set elsewhere. */
  paperColor: string;
  /** The geometry previews are drawn at: the notebook's page size and orientation. */
  geometry: PageGeometry;
  /** Offer "No cover" before the designs. */
  allowNone: boolean;
  /** Design preview width, CSS px. */
  previewWidth: number;
  onChange: (design: CoverChoice, paperColor: string) => void;
}

interface DesignCard {
  root: HTMLButtonElement;
  /** `null` for "No cover", which has nothing to paint. */
  canvas: HTMLCanvasElement | null;
  preview: HTMLElement;
}

export class CoverPicker {
  readonly el: HTMLElement;
  private design: CoverChoice;
  private paperColor: string;
  private geometry: PageGeometry;
  private readonly designs = new Map<CoverChoice, DesignCard>();
  private readonly coverSwatches = new Map<string, HTMLButtonElement>();
  private readonly colorRow: HTMLElement;

  constructor(
    parent: HTMLElement,
    private readonly options: CoverPickerOptions,
  ) {
    this.design = options.design;
    this.paperColor = options.paperColor;
    this.geometry = options.geometry;
    this.el = parent.createDiv({ cls: "goodobsidian-coverpicker" });

    const row = this.el.createDiv({ cls: "goodobsidian-coverpicker-designs" });
    const large = options.allowNone ? " is-large" : "";
    if (options.allowNone) {
      // Every button here carries `clickable-icon` (CLAUDE.md: Obsidian pads
      // plain buttons 20 px on iPad, and fills them).
      const root = row.createEl("button", {
        cls: `goodobsidian-template-card${large} clickable-icon`,
      });
      const preview = root.createDiv({
        cls: "goodobsidian-template-preview goodobsidian-cover-none",
      });
      setIcon(preview, "ban");
      root.createDiv({ cls: "goodobsidian-template-name", text: "No cover" });
      root.setAttribute("aria-label", "No cover");
      root.addEventListener("click", () => this.pick("none", this.paperColor));
      this.designs.set("none", { root, canvas: null, preview });
    }
    for (const template of COVER_TEMPLATES) {
      const design = template.ruling as CoverRuling;
      const root = row.createEl("button", {
        cls: `goodobsidian-template-card${large} clickable-icon`,
      });
      const canvas = root.createEl("canvas", { cls: "goodobsidian-template-preview" });
      root.createDiv({
        cls: "goodobsidian-template-name",
        text: template.name.replace(/ cover$/, ""),
      });
      root.setAttribute("aria-label", template.name);
      root.addEventListener("click", () => this.pick(design, this.paperColor));
      this.designs.set(design, { root, canvas, preview: canvas });
    }

    this.colorRow = this.el.createDiv({ cls: "goodobsidian-coverpicker-colors" });
    this.colorRow.setAttribute("role", "group");
    this.colorRow.setAttribute("aria-label", "Cover colour");
    for (const color of COVER_COLORS) {
      const swatch = this.colorRow.createEl("button", {
        cls: "goodobsidian-cover-swatch clickable-icon",
      });
      // The dot *is* the cover colour, so this inline style is the value
      // itself rather than chrome (as the toolbar's ink swatches do).
      swatch.createSpan({ cls: "goodobsidian-cover-swatch-dot" }).setCssStyles({
        background: color.color,
      });
      swatch.setAttribute("aria-label", color.label);
      swatch.setAttribute("title", color.label);
      swatch.addEventListener("click", () => {
        if (this.design === "none") return;
        this.pick(this.design, color.color);
      });
      this.coverSwatches.set(color.color, swatch);
    }

    this.repaint();
    this.sync();
  }

  /** The notebook's size or orientation changed: redraw the previews to match. */
  setGeometry(geometry: PageGeometry): void {
    this.geometry = geometry;
    this.repaint();
  }

  private pick(design: CoverChoice, paperColor: string): void {
    const recolour = paperColor !== this.paperColor;
    this.design = design;
    this.paperColor = paperColor;
    if (recolour) this.repaint();
    this.sync();
    this.options.onChange(design, paperColor);
  }

  private repaint(): void {
    const { width, height } = this.geometry;
    for (const [design, card] of this.designs) {
      if (card.canvas && design !== "none") {
        const backdrop: SyntheticBackdrop = { kind: design, paperColor: this.paperColor };
        paintTemplatePreview(card.canvas, backdrop, this.geometry, this.options.previewWidth);
      } else {
        card.preview.setCssStyles({ aspectRatio: `${width} / ${height}` });
      }
    }
  }

  private sync(): void {
    for (const [design, card] of this.designs) {
      const active = design === this.design;
      card.root.toggleClass("is-selected", active);
      card.root.setAttribute("aria-pressed", String(active));
    }
    const none = this.design === "none";
    this.colorRow.toggleClass("is-disabled", none);
    const current = this.paperColor.toLowerCase();
    for (const [color, swatch] of this.coverSwatches) {
      const active = color === current;
      swatch.disabled = none;
      swatch.toggleClass("is-selected", active);
      swatch.setAttribute("aria-pressed", String(active));
    }
  }
}

// --- Change cover -----------------------------------------------------------

export interface CoverPopoverOptions {
  /** The cover page's backdrop now. */
  backdrop: SyntheticBackdrop;
  geometry: PageGeometry;
  /** A design or colour was tapped; the host applies it as an undoable command. */
  onPick: (backdrop: SyntheticBackdrop) => void;
}

const POPOVER_WIDTH = 360;
const PREVIEW_WIDTH = 56;

export class CoverPopover {
  private readonly el: HTMLElement;
  private readonly dispose: Array<() => void> = [];
  private closed = false;

  constructor(anchor: HTMLElement, options: CoverPopoverOptions) {
    this.el = document.body.createDiv({ cls: "goodobsidian-addpage goodobsidian-coverpopover" });
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-label", "Change cover");
    this.el.createDiv({ cls: "goodobsidian-addpage-title", text: "Change cover" });
    const kind = options.backdrop.kind;
    new CoverPicker(this.el, {
      design: isCoverRuling(kind) ? kind : "cover-plain",
      paperColor: options.backdrop.paperColor ?? COVER_COLORS[0].color,
      geometry: options.geometry,
      allowNone: false,
      previewWidth: PREVIEW_WIDTH,
      onChange: (design, paperColor) => {
        if (design !== "none") options.onPick({ kind: design, paperColor });
      },
    });
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
}
