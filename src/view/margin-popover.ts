/**
 * The Margin popover, opened from the ⋯ panel's Margin row: where the
 * margin goes (none, left, right, both), how wide it is, its paper, and
 * which pages get it.
 *
 *   ┌───────────────────────────────┐
 *   │ [⊘] [▌▭] [▭▐] [▌▭▐]           │
 *   │ ───────●─────────────   33 %  │
 *   │ [ ] [≡] [#] [:]               │  paper: plain, lined, grid, dotted
 *   │ [−  8.2 mm  +]                │  its pitch; only on a ruled paper
 *   │ This page · PDF pages · All   │
 *   └───────────────────────────────┘
 *
 * No Apply button: every choice reaches the page at once and the host keeps
 * the whole visit as one undo step. The slider stops where the ink in a
 * margin ends, and a side with ink in its margin is kept; only No margin
 * can take one away, and with ink in it, it asks first, in words: "Delete
 * 3 strokes in the margin?".
 *
 * It only reports what was chosen; the host does it.
 */

import { setIcon } from "obsidian";
import {
  MARGIN_MAX_PERCENT,
  MARGIN_MIN_PERCENT,
  MARGIN_PAPERS,
  type MarginPaperChoice,
  type MarginScope,
  type MarginSide,
} from "../model/page-margin";
import { DESIGN_RANGES, clampDesignValue } from "../model/paper-design";
import { DialogKeyboard } from "./dialog-keyboard";
import { type MmStepper, mmStepper } from "./mm-stepper";
import { dragRange } from "./range-drag";
import { syncRangeFill } from "./range-fill";
import { installPopoverDismiss, placePopover } from "./template-picker";
import { t, tn } from "../i18n/translate";

export interface MarginChoice {
  side: MarginSide;
  /** Width of each margin, % of the page's own PDF or paper. */
  percent: number;
  /** The paper the margin is drawn on. */
  paper: MarginPaperChoice;
  /**
   * The pitch of its lines, squares or dots, mm, once one was set here;
   * absent: each page keeps its own (by default the page's spacing).
   */
  spacingMm?: number;
  /** Which pages get it. */
  scope: MarginScope;
  /** No margin even where there is ink in it: what lies wholly in it is deleted. */
  drop?: boolean;
}

export interface MarginPopoverOptions {
  initial: MarginChoice;
  /**
   * The scopes worth offering, in order. "PDF pages" only where some pages
   * are PDFs and some are not, "All pages" only with more than one page;
   * with "page" alone the row is left out.
   */
  scopes: readonly MarginScope[];
  /**
   * What ink already in a margin allows for `scope`: the sides that must
   * keep a margin and the narrowest share, %.
   */
  floor: (scope: MarginScope) => { left: boolean; right: boolean; percent: number };
  /**
   * What closing the margins of `scope` would delete: how many things, on
   * how many pages.
   */
  cut?: (scope: MarginScope) => { items: number; pages: number };
  /** The pitch, mm, a margin of `paper` has on this page while none was set here. */
  spacingMm?: (paper: MarginPaperChoice) => number | null;
  /** Draw a swatch of `paper` into `canvas`, {@link MARGIN_SWATCH_CSS_WIDTH} CSS px wide. */
  paintPaper?: (canvas: HTMLCanvasElement, paper: MarginPaperChoice) => void;
  onChange: (choice: MarginChoice) => void;
  onClose?: () => void;
}

/** A paper swatch's width, CSS px. */
export const MARGIN_SWATCH_CSS_WIDTH = 56;

const POPOVER_WIDTH = 300;

const SIDES: ReadonlyArray<{ side: MarginSide; icon: string; label: string }> = [
  {
    side: "none",
    icon: "square-slash",
    get label() {
      return t("surface.margin.none");
    },
  },
  {
    side: "left",
    icon: "panel-left",
    get label() {
      return t("surface.margin.left");
    },
  },
  {
    side: "right",
    icon: "panel-right",
    get label() {
      return t("surface.margin.right");
    },
  },
  {
    side: "both",
    icon: "columns-3",
    get label() {
      return t("surface.margin.both");
    },
  },
];

const PAPER_NAMES: Record<MarginPaperChoice, string> = {
  get plain() {
    return t("surface.margin.paper.plain");
  },
  get lined() {
    return t("surface.margin.paper.lined");
  },
  get grid() {
    return t("surface.margin.paper.grid");
  },
  get dotted() {
    return t("surface.margin.paper.dotted");
  },
};

const SCOPE_NAMES: Record<MarginScope, string> = {
  get page() {
    return t("surface.margin.scope.page");
  },
  get pdf() {
    return t("surface.margin.scope.pdf");
  },
  get all() {
    return t("surface.margin.scope.all");
  },
};

export class MarginPopover {
  private readonly el: HTMLElement;
  private readonly dispose: Array<() => void> = [];
  private readonly buttons = new Map<MarginSide, HTMLButtonElement>();
  private readonly papers = new Map<MarginPaperChoice, HTMLButtonElement>();
  private readonly scopes = new Map<MarginScope, HTMLButtonElement>();
  private slider!: HTMLInputElement;
  private readout!: HTMLElement;
  private confirm!: HTMLElement;
  private confirmText!: HTMLElement;
  private spacing: MmStepper | null = null;
  private keyboard: DialogKeyboard | null = null;
  private choice: MarginChoice;
  private closed = false;

  constructor(
    anchor: HTMLElement,
    private readonly options: MarginPopoverOptions,
  ) {
    const scope = options.scopes.includes(options.initial.scope) ? options.initial.scope : "page";
    this.choice = { ...options.initial, scope };
    this.el = document.body.createDiv({ cls: "goodobsidian-addpage goodobsidian-margin" });
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-label", t("surface.margin.title"));
    this.build();
    this.sync();
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
    this.keyboard?.end();
    for (const d of this.dispose) d();
    this.el.remove();
    this.options.onClose?.();
  }

  private build(): void {
    const seg = this.el.createDiv({ cls: "goodobsidian-segmented goodobsidian-margin-sides" });
    seg.setAttribute("role", "radiogroup");
    seg.setAttribute("aria-label", t("surface.margin.title"));
    for (const { side, icon, label } of SIDES) {
      // `clickable-icon`: Obsidian pads every other button 20 px on the iPad.
      const button = seg.createEl("button", { cls: "clickable-icon" });
      button.setAttribute("role", "radio");
      button.setAttribute("aria-label", label);
      setIcon(button, icon);
      button.addEventListener("click", () => {
        if (this.choice.side === side) return;
        if (side === "none" && this.askBeforeClosing()) return;
        this.change({ side });
      });
      this.buttons.set(side, button);
    }

    // Closing a margin with ink in it: asked here, and only while asking.
    this.confirm = this.el.createDiv({ cls: "goodobsidian-margin-confirm is-hidden" });
    this.confirmText = this.confirm.createSpan();
    const answers = this.confirm.createDiv({ cls: "goodobsidian-margin-confirm-buttons" });
    const keep = answers.createEl("button", { text: t("surface.margin.keep") });
    keep.addEventListener("click", () => this.confirm.addClass("is-hidden"));
    const remove = answers.createEl("button", { cls: "mod-warning", text: t("common.delete") });
    remove.addEventListener("click", () => {
      this.confirm.addClass("is-hidden");
      this.change({ side: "none", drop: true });
    });

    const width = this.el.createDiv({ cls: "goodobsidian-margin-width" });
    // The tool bar's own slider, so a width is set the same way everywhere.
    const track = width.createDiv({ cls: "goodobsidian-width-slider" });
    this.slider = track.createEl("input", {
      cls: "goodobsidian-width-range",
      type: "range",
      attr: { min: String(MARGIN_MIN_PERCENT), max: String(MARGIN_MAX_PERCENT), step: "1" },
    });
    dragRange(this.slider);
    this.slider.setAttribute("aria-label", t("surface.margin.width"));
    this.slider.addEventListener("input", () =>
      this.change({ percent: Number(this.slider.value) }),
    );
    this.readout = width.createSpan({ cls: "goodobsidian-margin-readout" });

    // The paper: a swatch of each, named in its tooltip.
    const papers = this.el.createDiv({ cls: "goodobsidian-margin-papers" });
    papers.setAttribute("role", "radiogroup");
    papers.setAttribute("aria-label", t("surface.margin.paperGroup"));
    for (const paper of MARGIN_PAPERS) {
      const button = papers.createEl("button", { cls: "goodobsidian-margin-paper clickable-icon" });
      button.setAttribute("role", "radio");
      button.setAttribute("aria-label", PAPER_NAMES[paper]);
      const canvas = button.createEl("canvas");
      this.options.paintPaper?.(canvas, paper);
      button.addEventListener("click", () => {
        if (button.disabled || this.choice.paper === paper) return;
        this.change({ paper });
      });
      this.papers.set(paper, button);
    }

    // The ruled paper's pitch: the page's own until one is set here. Shown only on a ruled margin.
    if (this.options.spacingMm) {
      this.keyboard = new DialogKeyboard(this.el);
      const row = this.el.createDiv({ cls: "goodobsidian-margin-spacing" });
      this.spacing = mmStepper(row, {
        label: t("notebooks.designer.spacing"),
        step: DESIGN_RANGES.spacing.step,
        get: () => this.shownSpacing() ?? 0,
        format: (mm) => mm.toFixed(1),
        put: (mm) => {
          const clamped = clampDesignValue("spacing", mm);
          if (clamped === null) this.spacing?.sync();
          else this.change({ spacingMm: Math.round(clamped * 10) / 10 });
        },
        keyboard: this.keyboard,
        row,
      });
    }

    if (this.options.scopes.length > 1) {
      const scopes = this.el.createDiv({ cls: "goodobsidian-segmented goodobsidian-margin-scope" });
      scopes.setAttribute("role", "radiogroup");
      scopes.setAttribute("aria-label", t("surface.margin.whichPages"));
      for (const scope of this.options.scopes) {
        const button = scopes.createEl("button", {
          cls: "clickable-icon",
          text: SCOPE_NAMES[scope],
        });
        button.setAttribute("role", "radio");
        button.addEventListener("click", () => {
          if (this.choice.scope === scope) return;
          this.change({ scope });
        });
        this.scopes.set(scope, button);
      }
    }
  }

  /**
   * No margin was tapped: with ink in the margins it would close, show the
   * question instead and say so (true); with none, close them at once.
   */
  private askBeforeClosing(): boolean {
    const floor = this.options.floor(this.choice.scope);
    if (!floor.left && !floor.right) return false;
    const { items, pages } = this.options.cut?.(this.choice.scope) ?? { items: 0, pages: 0 };
    if (items === 0) {
      // Only things that reach onto the page are there: nothing is deleted.
      this.change({ side: "none", drop: true });
      return true;
    }
    this.confirmText.setText(
      pages > 1
        ? tn("surface.margin.deleteInMargins", items, { pages })
        : tn("surface.margin.deleteInMargin", items),
    );
    this.confirm.removeClass("is-hidden");
    return true;
  }

  /** Take part of a new choice, keep it inside what the ink allows, show it and report it. */
  private change(part: Partial<MarginChoice>): void {
    this.confirm.addClass("is-hidden");
    // A paper picked with no margin yet gives the page one, on the right.
    const opens =
      part.paper !== undefined && this.choice.side === "none" && part.side === undefined;
    // Deleting is for the one choice that asked; the next choice keeps ink again.
    const drop = part.drop === true;
    this.choice = this.allowed({
      ...this.choice,
      ...part,
      ...(opens ? { side: "right" } : {}),
      drop,
    });
    this.sync();
    this.options.onChange({ ...this.choice });
  }

  /** `choice`, with every side the ink reaches into kept and the width at least its floor. */
  private allowed(choice: MarginChoice): MarginChoice {
    if (choice.drop) return choice;
    const floor = this.options.floor(choice.scope);
    const left = choice.side === "left" || choice.side === "both" || floor.left;
    const right = choice.side === "right" || choice.side === "both" || floor.right;
    const side: MarginSide = left && right ? "both" : left ? "left" : right ? "right" : "none";
    const min = Math.max(MARGIN_MIN_PERCENT, Math.min(MARGIN_MAX_PERCENT, floor.percent));
    const percent = Math.round(Math.min(MARGIN_MAX_PERCENT, Math.max(min, choice.percent)));
    return { ...choice, side, percent };
  }

  private sync(): void {
    const { side, percent, paper, scope } = this.choice;
    for (const [option, button] of this.buttons) mark(button, option === side);
    // The track keeps its scale; a value under the ink's floor springs back to it.
    this.slider.value = String(percent);
    syncRangeFill(this.slider);
    this.slider.disabled = side === "none";
    this.readout.setText(`${percent} %`);
    this.readout.toggleClass("is-faint", side === "none");
    for (const [option, button] of this.papers) mark(button, option === paper);
    for (const [option, button] of this.scopes) mark(button, option === scope);
    if (this.spacing) {
      const shown = this.shownSpacing();
      this.spacing.el.parentElement?.toggleClass("is-hidden", shown === null || side === "none");
      this.spacing.sync();
    }
  }

  /** The pitch the field shows, mm: the one set here, else the page's own; null on plain paper. */
  private shownSpacing(): number | null {
    if (this.choice.paper === "plain") return null;
    return this.choice.spacingMm ?? this.options.spacingMm?.(this.choice.paper) ?? null;
  }
}

function mark(button: HTMLButtonElement, active: boolean): void {
  button.toggleClass("is-active", active);
  button.setAttribute("aria-checked", String(active));
}
