/**
 * The paper designer: make a paper of your own for My templates, with a live
 * preview drawn by the real painter.
 *
 * It opens *inside* the dialog it was called from (the template picker or
 * the New notebook dialog), in place of that dialog's content, never as a
 * second dialog on top: {@link openPaperDesigner} sets the dialog's own
 * children aside and puts them back, untouched, when the designer closes.
 *
 * Paper and lines are open; the rarer parts (margins, a blank area, a margin
 * line) start folded, each with its state beside its heading.
 *
 * The design and its file are `model/paper-design.ts`; saving is the host's
 * (`VaultPaperLibrary.saveDesign`).
 */

import { setIcon } from "obsidian";
import { LIGHT_PAPER, drawSynthetic } from "../canvas/backdrop";
import { PAPER_SWATCHES, RULE_SWATCHES } from "../canvas/paper-style";
import type { PaperSide } from "../model/document";
import {
  DEFAULT_MARGIN_LINE_COLOR,
  DEFAULT_RULE_COLOR,
  DESIGN_RANGES,
  DESIGN_SPACING_MM,
  type DesignRange,
  type DesignRuling,
  type DesignTexture,
  type MarginLineSides,
  type PaperDesign,
  blankSummary,
  clampDesignValue,
  designBackdrop,
  designGeometry,
  marginLineSummary,
  marginsSummary,
} from "../model/paper-design";
import { PAGE_SIZES } from "../model/templates";
import { pageToMm } from "../model/units";
import { renderColorMixer } from "./color-picker";
import { DialogKeyboard } from "./dialog-keyboard";

export interface PaperDesignerOptions {
  /** The design to start from: a new one, or the one being edited. */
  design: PaperDesign;
  /** Editing a saved paper (the title says so). */
  editing: boolean;
  /** Keep the design; true when it was saved. */
  save: (design: PaperDesign) => Promise<boolean>;
  /** The designer closed: `saved` after a save, false after Back. */
  done: (saved: boolean) => void;
}

/** Margin line colours: the school book's soft red first. */
const MARGIN_LINE_SWATCHES: ReadonlyArray<{ label: string; color: string }> = [
  { label: "Soft red", color: DEFAULT_MARGIN_LINE_COLOR },
  { label: "Red", color: "#d9534f" },
  { label: "Blue", color: "#8fb0dc" },
  { label: "Grey", color: "#b8bcc4" },
];

const RULING_CHOICES: ReadonlyArray<{ id: DesignRuling; icon: string; label: string }> = [
  { id: "none", icon: "square", label: "No lines" },
  { id: "lines", icon: "align-justify", label: "Lines" },
  { id: "squares", icon: "grid", label: "Squares" },
  { id: "dots", icon: "grip", label: "Dots" },
];

const TEXTURE_CHOICES: ReadonlyArray<{ id: DesignTexture; label: string }> = [
  { id: "plain", label: "Plain" },
  { id: "fine", label: "Fine" },
  { id: "heavy", label: "Heavy" },
];

const SIDE_CHOICES: ReadonlyArray<{ id: PaperSide; icon: string; label: string }> = [
  { id: "top", icon: "panel-top", label: "Top" },
  { id: "right", icon: "panel-right", label: "Right" },
  { id: "bottom", icon: "panel-bottom", label: "Bottom" },
  { id: "left", icon: "panel-left", label: "Left" },
];

const LINE_SIDE_CHOICES: ReadonlyArray<{ id: MarginLineSides; label: string }> = [
  { id: "left", label: "Left" },
  { id: "right", label: "Right" },
  { id: "both", label: "Both" },
];

/** The blank area a design gets when one is first switched on, mm. */
const DEFAULT_BLANK_MM = 50;
/** A margin line's inset when one is first switched on, mm. */
const DEFAULT_INSET_MM = 25;

/**
 * Open the designer in `modalEl` (an Obsidian `.modal`), in place of what
 * it holds now. Returns a function that closes it as Back would.
 */
export function openPaperDesigner(modalEl: HTMLElement, options: PaperDesignerOptions): () => void {
  const designer = new PaperDesigner(modalEl, options);
  return () => designer.finish(false);
}

class PaperDesigner {
  private readonly design: PaperDesign;
  private readonly stash: ChildNode[];
  private readonly root: HTMLElement;
  private readonly keyboard: DialogKeyboard;
  private readonly syncers: Array<() => void> = [];
  private readonly observer: ResizeObserver | null;
  private canvas!: HTMLCanvasElement;
  private previewBox!: HTMLElement;
  private caption!: HTMLElement;
  private saveButton!: HTMLButtonElement;
  /** Which colour row's mixer is open, if any. */
  private mixing: "paper" | "rule" | "line" | null = null;
  private closed = false;

  constructor(
    private readonly modalEl: HTMLElement,
    private readonly options: PaperDesignerOptions,
  ) {
    this.design = structuredClone(options.design);
    // The dialog's own content, set aside whole (listeners and state kept).
    this.stash = Array.from(modalEl.childNodes);
    for (const node of this.stash) node.remove();
    modalEl.addClass("goodobsidian-designing");
    this.keyboard = new DialogKeyboard(modalEl);
    this.root = modalEl.createDiv({ cls: "goodobsidian-paper-designer" });
    this.build();
    this.sync();
    // Repaint when the preview's room changes (a rotation, Split View), on
    // the next frame and only for a real change: painting resizes the canvas
    // inside the observed box, which must not feed the observer.
    let room = "";
    this.observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver((entries) => {
            if (!this.root.isConnected) {
              this.observer?.disconnect();
              return;
            }
            const box = entries[0]?.contentRect;
            const next = box ? `${Math.round(box.width)}x${Math.round(box.height)}` : "";
            if (next === room) return;
            room = next;
            window.requestAnimationFrame(() => this.paint());
          });
    this.observer?.observe(this.previewBox);
    window.requestAnimationFrame(() => this.paint());
  }

  /** Close: put the dialog's own content back and report. */
  finish(saved: boolean): void {
    if (this.closed) return;
    this.closed = true;
    this.observer?.disconnect();
    this.keyboard.end();
    this.root.remove();
    this.modalEl.removeClass("goodobsidian-designing");
    this.modalEl.append(...this.stash);
    this.options.done(saved);
  }

  // --- Layout ---------------------------------------------------------------------

  private build(): void {
    const header = this.root.createDiv({ cls: "goodobsidian-paper-designer-header" });
    // `clickable-icon` on every button: Obsidian's iPad padding (ledger).
    const back = header.createEl("button", {
      cls: "goodobsidian-paper-designer-back clickable-icon",
      attr: { "aria-label": "Back", title: "Back" },
    });
    setIcon(back, "chevron-left");
    back.addEventListener("click", () => this.finish(false));
    header.createDiv({
      cls: "goodobsidian-paper-designer-title",
      text: this.options.editing ? "Edit paper" : "New paper",
    });
    this.saveButton = header.createEl("button", { cls: "mod-cta", text: "Save" });
    this.saveButton.addEventListener("click", () => void this.save());

    const body = this.root.createDiv({ cls: "goodobsidian-paper-designer-body" });
    this.previewBox = body.createDiv({ cls: "goodobsidian-paper-designer-preview" });
    const frame = this.previewBox.createDiv({ cls: "goodobsidian-paper-designer-frame" });
    this.canvas = frame.createEl("canvas", { cls: "goodobsidian-paper-designer-canvas" });
    this.caption = this.previewBox.createDiv({ cls: "goodobsidian-paper-designer-caption" });
    const controls = body.createDiv({ cls: "goodobsidian-paper-designer-controls" });

    const nameRow = controls.createDiv({ cls: "goodobsidian-paper-designer-name-row" });
    const name = nameRow.createEl("input", {
      cls: "goodobsidian-paper-designer-name",
      attr: { type: "text", placeholder: "Paper name", "aria-label": "Paper name" },
    });
    name.value = this.design.name;
    name.addEventListener("input", () => {
      this.design.name = name.value.trim();
    });
    name.addEventListener("keydown", (event) => {
      if (event.key === "Enter") name.blur();
    });
    this.keyboard.watch(name, nameRow);

    this.buildPaper(this.section(controls, "Paper", true));
    this.buildLines(this.section(controls, "Lines", true));
    this.buildMargins(
      this.section(controls, "Margins", false, () => marginsSummary(this.design.margins), true),
    );
    this.buildBlank(
      this.section(controls, "Blank area", false, () => blankSummary(this.design.blank), true),
    );
    this.buildMarginLine(
      this.section(controls, "Margin line", false, () => marginLineSummary(this.design.marginLine)),
    );
  }

  /**
   * A foldable section: chevron, title and, folded, its state beside the
   * title. `ruledOnly` hides it while the paper has no lines (margins and
   * a blank area only stop a ruling).
   */
  private section(
    parent: HTMLElement,
    title: string,
    open: boolean,
    state?: () => string,
    ruledOnly = false,
  ): HTMLElement {
    const details = parent.createEl("details", { cls: "goodobsidian-paper-designer-section" });
    details.open = open;
    const summary = details.createEl("summary");
    setIcon(summary.createSpan({ cls: "goodobsidian-templates-chevron" }), "chevron-down");
    summary.createSpan({ text: title });
    const stateEl = state ? summary.createSpan({ cls: "goodobsidian-paper-designer-state" }) : null;
    this.syncers.push(() => {
      if (stateEl && state) stateEl.setText(state());
      if (ruledOnly) details.toggleClass("is-hidden", this.design.ruling === "none");
    });
    return details.createDiv({ cls: "goodobsidian-paper-designer-rows" });
  }

  private row(parent: HTMLElement, label?: string): HTMLElement {
    const row = parent.createDiv({ cls: "goodobsidian-paper-style-row" });
    if (label) row.createSpan({ cls: "goodobsidian-paper-style-label", text: label });
    return row;
  }

  // --- Sections -------------------------------------------------------------------

  private buildPaper(el: HTMLElement): void {
    const sizeRow = this.row(el);
    const size = sizeRow.createEl("select", { cls: "dropdown" });
    size.setAttribute("aria-label", "Page size");
    for (const s of PAGE_SIZES) size.createEl("option", { text: s.label, value: s.id });
    size.value = this.design.size;
    size.addEventListener("change", () => this.change(() => (this.design.size = size.value)));
    const orient = sizeRow.createDiv({ cls: "goodobsidian-segmented is-icons" });
    for (const [landscape, icon, label] of [
      [false, "rectangle-vertical", "Portrait"],
      [true, "rectangle-horizontal", "Landscape"],
    ] as const) {
      const button = this.choice(orient, label, icon);
      button.addEventListener("click", () =>
        this.change(() => (this.design.landscape = landscape)),
      );
      this.syncers.push(() => this.mark(button, this.design.landscape === landscape));
    }

    this.colorRow(
      el,
      "paper",
      PAPER_SWATCHES,
      () => this.design.paper,
      (color) => {
        this.design.paper = color;
      },
    );

    const texture = this.row(el, "Texture").createDiv({ cls: "goodobsidian-segmented" });
    for (const option of TEXTURE_CHOICES) {
      const button = this.choice(texture, option.label);
      button.addEventListener("click", () => this.change(() => (this.design.texture = option.id)));
      this.syncers.push(() => this.mark(button, this.design.texture === option.id));
    }
  }

  private buildLines(el: HTMLElement): void {
    const kinds = this.row(el).createDiv({ cls: "goodobsidian-segmented is-icons" });
    for (const option of RULING_CHOICES) {
      const button = this.choice(kinds, option.label, option.icon);
      button.addEventListener("click", () =>
        this.change(() => {
          if (this.design.ruling === option.id) return;
          this.design.ruling = option.id;
          this.design.spacing = DESIGN_SPACING_MM[option.id];
        }),
      );
      this.syncers.push(() => this.mark(button, this.design.ruling === option.id));
    }
    const spacing = this.row(el, "Spacing");
    this.stepper(
      spacing,
      "spacing",
      "Spacing",
      () => this.design.spacing,
      (v) => {
        this.design.spacing = v;
      },
    );
    const color = this.colorRow(
      el,
      "rule",
      [
        // The built-in papers' own rule first: a new design starts on it.
        { label: "Paper blue-grey", color: DEFAULT_RULE_COLOR },
        ...RULE_SWATCHES.flatMap((s) => (s.color ? [{ label: s.label, color: s.color }] : [])),
      ],
      () => this.design.ruleColor,
      (c) => {
        this.design.ruleColor = c;
      },
    );
    this.syncers.push(() => {
      const ruled = this.design.ruling !== "none";
      spacing.toggleClass("is-hidden", !ruled);
      color.toggleClass("is-hidden", !ruled);
    });
  }

  private buildMargins(el: HTMLElement): void {
    const grid = el.createDiv({ cls: "goodobsidian-paper-designer-margins" });
    for (const side of SIDE_CHOICES) {
      const row = this.row(grid, side.label);
      this.stepper(
        row,
        "margin",
        `${side.label} margin`,
        () => this.design.margins[side.id],
        (v) => {
          this.design.margins[side.id] = v;
        },
      );
    }
  }

  private buildBlank(el: HTMLElement): void {
    const sides = this.row(el).createDiv({ cls: "goodobsidian-segmented is-icons" });
    const none = this.choice(sides, "No blank area", "ban");
    none.addEventListener("click", () => this.change(() => (this.design.blank = null)));
    this.syncers.push(() => this.mark(none, this.design.blank === null));
    for (const side of SIDE_CHOICES) {
      const button = this.choice(sides, `Blank area at the ${side.label.toLowerCase()}`, side.icon);
      button.addEventListener("click", () =>
        this.change(() => {
          this.design.blank = { side: side.id, size: this.design.blank?.size ?? DEFAULT_BLANK_MM };
        }),
      );
      this.syncers.push(() => this.mark(button, this.design.blank?.side === side.id));
    }
    const size = this.row(el, "Size");
    this.stepper(
      size,
      "blank",
      "Blank area size",
      () => this.design.blank?.size ?? 0,
      (v) => {
        if (this.design.blank) this.design.blank.size = v;
      },
    );
    this.syncers.push(() => size.toggleClass("is-hidden", this.design.blank === null));
  }

  private buildMarginLine(el: HTMLElement): void {
    const sides = this.row(el).createDiv({ cls: "goodobsidian-segmented" });
    const none = this.choice(sides, "None");
    none.addEventListener("click", () => this.change(() => (this.design.marginLine = null)));
    this.syncers.push(() => this.mark(none, this.design.marginLine === null));
    for (const option of LINE_SIDE_CHOICES) {
      const button = this.choice(sides, option.label);
      button.addEventListener("click", () =>
        this.change(() => {
          const line = this.design.marginLine;
          this.design.marginLine = {
            sides: option.id,
            inset: line?.inset ?? DEFAULT_INSET_MM,
            color: line?.color ?? DEFAULT_MARGIN_LINE_COLOR,
          };
        }),
      );
      this.syncers.push(() => this.mark(button, this.design.marginLine?.sides === option.id));
    }
    const inset = this.row(el, "Inset");
    this.stepper(
      inset,
      "inset",
      "Margin line inset",
      () => this.design.marginLine?.inset ?? 0,
      (v) => {
        if (this.design.marginLine) this.design.marginLine.inset = v;
      },
    );
    const color = this.colorRow(
      el,
      "line",
      MARGIN_LINE_SWATCHES,
      () => this.design.marginLine?.color ?? DEFAULT_MARGIN_LINE_COLOR,
      (c) => {
        if (this.design.marginLine) this.design.marginLine.color = c;
      },
    );
    this.syncers.push(() => {
      const on = this.design.marginLine !== null;
      inset.toggleClass("is-hidden", !on);
      color.toggleClass("is-hidden", !on);
    });
  }

  // --- Controls -------------------------------------------------------------------

  /** A segment of a segmented control: an icon (named in its label) or a word. */
  private choice(parent: HTMLElement, label: string, icon?: string): HTMLButtonElement {
    const button = parent.createEl("button", { cls: "clickable-icon" });
    if (icon) {
      setIcon(button, icon);
      button.setAttribute("aria-label", label);
      button.setAttribute("title", label);
    } else {
      button.setText(label);
    }
    return button;
  }

  private mark(button: HTMLElement, on: boolean): void {
    button.toggleClass("is-active", on);
    button.setAttribute("aria-pressed", String(on));
  }

  /**
   * A row of colour swatches with an any-colour swatch last, whose mixer
   * opens under the row (as in the template picker). Returns the row and
   * its mixer together, for hiding both.
   */
  private colorRow(
    parent: HTMLElement,
    which: "paper" | "rule" | "line",
    swatches: ReadonlyArray<{ label: string; color: string }>,
    get: () => string,
    set: (color: string) => void,
  ): HTMLElement {
    // No label: the swatches say what they are, and their section says of what.
    const wrap = parent.createDiv({ cls: "goodobsidian-paper-designer-colors" });
    const row = this.row(wrap);
    for (const swatch of swatches) {
      const button = row.createEl("button", {
        cls: "goodobsidian-paper-swatch clickable-icon",
        attr: { "aria-label": swatch.label, title: swatch.label },
      });
      button
        .createSpan({ cls: "goodobsidian-paper-swatch-disc" })
        .setCssStyles({ backgroundColor: swatch.color });
      button.addEventListener("click", () =>
        this.change(() => {
          this.mixing = null;
          set(swatch.color);
        }),
      );
      this.syncers.push(() => this.mark(button, get().toLowerCase() === swatch.color));
    }
    const custom = row.createEl("button", {
      cls: "goodobsidian-paper-swatch is-custom clickable-icon",
      attr: { "aria-label": "Any colour", title: "Any colour" },
    });
    const disc = custom.createSpan({ cls: "goodobsidian-paper-swatch-disc" });
    const own = disc.createSpan({ cls: "goodobsidian-paper-swatch-own" });
    const mixer = wrap.createDiv({ cls: "goodobsidian-paper-style-mixer is-hidden" });
    custom.addEventListener("click", () => {
      const opening = this.mixing !== which;
      this.mixing = opening ? which : null;
      if (opening) {
        mixer.empty();
        renderColorMixer(mixer, get(), (color) =>
          this.change(() => {
            this.mixing = null;
            set(color.toLowerCase());
          }),
        );
      }
      this.sync();
    });
    this.syncers.push(() => {
      const color = get().toLowerCase();
      const isPreset = swatches.some((s) => s.color === color);
      own.toggleClass("is-hidden", isPreset);
      if (!isPreset) own.setCssStyles({ background: color });
      this.mark(custom, !isPreset || this.mixing === which);
      mixer.toggleClass("is-hidden", this.mixing !== which);
    });
    return wrap;
  }

  /** − value mm +: the value typed, or stepped with a Pencil tap. */
  private stepper(
    row: HTMLElement,
    range: DesignRange,
    label: string,
    get: () => number,
    set: (value: number) => void,
  ): void {
    const box = row.createDiv({ cls: "goodobsidian-paper-designer-stepper" });
    const { step } = DESIGN_RANGES[range];
    const minus = box.createEl("button", {
      cls: "clickable-icon",
      attr: { "aria-label": `${label}: less`, title: "Less" },
    });
    setIcon(minus, "minus");
    const input = box.createEl("input", {
      attr: { type: "text", inputmode: "decimal", "aria-label": `${label}, mm` },
    });
    box.createSpan({ cls: "goodobsidian-paper-designer-unit", text: "mm" });
    const plus = box.createEl("button", {
      cls: "clickable-icon",
      attr: { "aria-label": `${label}: more`, title: "More" },
    });
    setIcon(plus, "plus");
    const put = (value: number): void => {
      const clamped = clampDesignValue(range, value);
      if (clamped !== null) this.change(() => set(clamped));
      else this.sync();
    };
    minus.addEventListener("click", () => put(get() - step));
    plus.addEventListener("click", () => put(get() + step));
    input.addEventListener("change", () => put(Number(input.value.replace(",", "."))));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") input.blur();
    });
    this.keyboard.watch(input, row);
    this.syncers.push(() => {
      if (document.activeElement !== input) input.value = String(Number(get().toFixed(2)));
    });
  }

  // --- State ----------------------------------------------------------------------

  private change(apply: () => void): void {
    apply();
    this.sync();
  }

  private sync(): void {
    for (const sync of this.syncers) sync();
    this.paint();
  }

  /** Draw the design into the preview, as large as fits, whole. */
  private paint(): void {
    if (this.closed) return;
    const geometry = designGeometry(this.design);
    this.caption.setText(
      `${Math.round(pageToMm(geometry.width))} × ${Math.round(pageToMm(geometry.height))} mm`,
    );
    const box = this.previewBox;
    const room = {
      width: box.clientWidth - 24,
      height: box.clientHeight - 24 - this.caption.offsetHeight,
    };
    if (!(room.width > 0) || !(room.height > 0)) return;
    const cssScale = Math.min(room.width / geometry.width, room.height / geometry.height);
    const cssWidth = geometry.width * cssScale;
    const cssHeight = geometry.height * cssScale;
    const dpr = window.devicePixelRatio || 1;
    const k = cssScale * dpr;
    this.canvas.width = Math.max(1, Math.round(geometry.width * k));
    this.canvas.height = Math.max(1, Math.round(geometry.height * k));
    this.canvas.setCssStyles({ width: `${cssWidth}px`, height: `${cssHeight}px` });
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    // Rules about half a CSS pixel wide, as every template preview draws them.
    drawSynthetic(
      ctx,
      designBackdrop(this.design),
      geometry,
      LIGHT_PAPER,
      Math.max(1, 0.5 / cssScale),
    );
  }

  private async save(): Promise<void> {
    if (this.closed || this.saveButton.disabled) return;
    this.saveButton.disabled = true;
    const design: PaperDesign = { ...this.design, name: this.design.name || "My paper" };
    const saved = await this.options.save(design).catch(() => false);
    if (saved) this.finish(true);
    else if (!this.closed) this.saveButton.disabled = false;
  }
}
