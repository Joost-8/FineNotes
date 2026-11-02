/**
 * The Margin popover, opened from the ⋯ panel's Margin row: where the
 * margin goes (none, left, right, both), how wide it is, its paper, and
 * which pages get it.
 *
 *   ┌───────────────────────────────┐
 *   │ [⊘] [▌▭] [▭▐] [▌▭▐]           │
 *   │ ───────●─────────────   33 %  │
 *   │ [ ] [≡] [#] [:]               │  paper: plain, lined, grid, dotted
 *   │ This page · PDF pages · All   │
 *   └───────────────────────────────┘
 *
 * No Apply button: every choice reaches the page at once and the host keeps
 * the whole visit as one undo step. A side the ink already reaches into
 * cannot be taken away, and the slider stops where the ink ends.
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
import { dragRange } from "./range-drag";
import { syncRangeFill } from "./range-fill";
import { installPopoverDismiss, placePopover } from "./template-picker";

export interface MarginChoice {
  side: MarginSide;
  /** Width of each margin, % of the page's own PDF or paper. */
  percent: number;
  /** The paper the margin is drawn on. */
  paper: MarginPaperChoice;
  /** Which pages get it. */
  scope: MarginScope;
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
  /** Draw a swatch of `paper` into `canvas`, {@link MARGIN_SWATCH_CSS_WIDTH} CSS px wide. */
  paintPaper?: (canvas: HTMLCanvasElement, paper: MarginPaperChoice) => void;
  onChange: (choice: MarginChoice) => void;
  onClose?: () => void;
}

/** A paper swatch's width, CSS px. */
export const MARGIN_SWATCH_CSS_WIDTH = 56;

const POPOVER_WIDTH = 300;

const SIDES: ReadonlyArray<{ side: MarginSide; icon: string; label: string }> = [
  { side: "none", icon: "square-slash", label: "No margin" },
  { side: "left", icon: "panel-left", label: "Margin on the left" },
  { side: "right", icon: "panel-right", label: "Margin on the right" },
  { side: "both", icon: "columns-3", label: "Margin on both sides" },
];

const PAPER_NAMES: Record<MarginPaperChoice, string> = {
  plain: "Plain",
  lined: "Lined",
  grid: "Grid",
  dotted: "Dotted",
};

const SCOPE_NAMES: Record<MarginScope, string> = {
  page: "This page",
  pdf: "PDF pages",
  all: "All pages",
};

export class MarginPopover {
  private readonly el: HTMLElement;
  private readonly dispose: Array<() => void> = [];
  private readonly buttons = new Map<MarginSide, HTMLButtonElement>();
  private readonly papers = new Map<MarginPaperChoice, HTMLButtonElement>();
  private readonly scopes = new Map<MarginScope, HTMLButtonElement>();
  private slider!: HTMLInputElement;
  private readout!: HTMLElement;
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
    this.el.setAttribute("aria-label", "Margin");
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
    for (const d of this.dispose) d();
    this.el.remove();
    this.options.onClose?.();
  }

  private build(): void {
    const seg = this.el.createDiv({ cls: "goodobsidian-segmented goodobsidian-margin-sides" });
    seg.setAttribute("role", "radiogroup");
    seg.setAttribute("aria-label", "Margin");
    for (const { side, icon, label } of SIDES) {
      // `clickable-icon`: Obsidian pads every other button 20 px on the iPad.
      const button = seg.createEl("button", { cls: "clickable-icon" });
      button.setAttribute("role", "radio");
      button.setAttribute("aria-label", label);
      setIcon(button, icon);
      button.addEventListener("click", () => {
        if (button.disabled || this.choice.side === side) return;
        this.change({ side });
      });
      this.buttons.set(side, button);
    }

    const width = this.el.createDiv({ cls: "goodobsidian-margin-width" });
    // The tool bar's own slider, so a width is set the same way everywhere.
    const track = width.createDiv({ cls: "goodobsidian-width-slider" });
    this.slider = track.createEl("input", {
      cls: "goodobsidian-width-range",
      type: "range",
      attr: { min: String(MARGIN_MIN_PERCENT), max: String(MARGIN_MAX_PERCENT), step: "1" },
    });
    dragRange(this.slider);
    this.slider.setAttribute("aria-label", "Margin width");
    this.slider.addEventListener("input", () =>
      this.change({ percent: Number(this.slider.value) }),
    );
    this.readout = width.createSpan({ cls: "goodobsidian-margin-readout" });

    // The paper: a swatch of each, named in its tooltip.
    const papers = this.el.createDiv({ cls: "goodobsidian-margin-papers" });
    papers.setAttribute("role", "radiogroup");
    papers.setAttribute("aria-label", "Margin paper");
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

    if (this.options.scopes.length > 1) {
      const scopes = this.el.createDiv({ cls: "goodobsidian-segmented goodobsidian-margin-scope" });
      scopes.setAttribute("role", "radiogroup");
      scopes.setAttribute("aria-label", "Which pages");
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

  /** Take part of a new choice, keep it inside what the ink allows, show it and report it. */
  private change(part: Partial<MarginChoice>): void {
    // A paper picked with no margin yet gives the page one, on the right.
    const opens =
      part.paper !== undefined && this.choice.side === "none" && part.side === undefined;
    this.choice = this.allowed({ ...this.choice, ...part, ...(opens ? { side: "right" } : {}) });
    this.sync();
    this.options.onChange({ ...this.choice });
  }

  /** `choice`, with every side the ink reaches into kept and the width at least its floor. */
  private allowed(choice: MarginChoice): MarginChoice {
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
    const floor = this.options.floor(scope);
    for (const [option, button] of this.buttons) {
      mark(button, option === side);
      // A side with ink in its margin cannot go.
      button.disabled =
        (option === "none" && (floor.left || floor.right)) ||
        (option === "left" && floor.right) ||
        (option === "right" && floor.left);
    }
    // The track keeps its scale; a value under the ink's floor springs back to it.
    this.slider.value = String(percent);
    syncRangeFill(this.slider);
    this.slider.disabled = side === "none";
    this.readout.setText(`${percent} %`);
    this.readout.toggleClass("is-faint", side === "none");
    for (const [option, button] of this.papers) mark(button, option === paper);
    for (const [option, button] of this.scopes) mark(button, option === scope);
  }
}

function mark(button: HTMLButtonElement, active: boolean): void {
  button.toggleClass("is-active", active);
  button.setAttribute("aria-checked", String(active));
}
