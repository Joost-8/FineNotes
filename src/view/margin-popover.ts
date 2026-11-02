/**
 * The Margin popover, opened from the ⋯ panel's Margin row: where the
 * margin goes (none, left, right, both), how wide it is, and whether every
 * page gets it.
 *
 *   ┌───────────────────────────────┐
 *   │ [⊘] [▌▭] [▭▐] [▌▭▐]           │
 *   │ ───────●─────────────   33 %  │
 *   │ All pages              (on)   │
 *   └───────────────────────────────┘
 *
 * No Apply button: every choice reaches the page at once and the host keeps
 * the whole visit as one undo step. A side the ink already reaches into
 * cannot be taken away, and the slider stops where the ink ends.
 *
 * It only reports what was chosen; the host does it.
 */

import { setIcon } from "obsidian";
import { MARGIN_MAX_PERCENT, MARGIN_MIN_PERCENT, type MarginSide } from "../model/page-margin";
import { dragRange } from "./range-drag";
import { syncRangeFill } from "./range-fill";
import { installPopoverDismiss, placePopover } from "./template-picker";

export interface MarginChoice {
  side: MarginSide;
  /** Width of each margin, % of the page's own PDF or paper. */
  percent: number;
  /** Every page of the notebook, or this page only. */
  all: boolean;
}

export interface MarginPopoverOptions {
  initial: MarginChoice;
  /** Offer All pages (a notebook of one page has nothing to offer it for). */
  canAll: boolean;
  /**
   * What ink already in a margin allows for `all`: the sides that must keep
   * a margin and the narrowest share, %.
   */
  floor: (all: boolean) => { left: boolean; right: boolean; percent: number };
  onChange: (choice: MarginChoice) => void;
  onClose?: () => void;
}

const POPOVER_WIDTH = 300;

const SIDES: ReadonlyArray<{ side: MarginSide; icon: string; label: string }> = [
  { side: "none", icon: "square-slash", label: "No margin" },
  { side: "left", icon: "panel-left", label: "Margin on the left" },
  { side: "right", icon: "panel-right", label: "Margin on the right" },
  { side: "both", icon: "columns-3", label: "Margin on both sides" },
];

export class MarginPopover {
  private readonly el: HTMLElement;
  private readonly dispose: Array<() => void> = [];
  private readonly buttons = new Map<MarginSide, HTMLButtonElement>();
  private slider!: HTMLInputElement;
  private readout!: HTMLElement;
  private allSwitch: HTMLElement | null = null;
  private choice: MarginChoice;
  private closed = false;

  constructor(
    anchor: HTMLElement,
    private readonly options: MarginPopoverOptions,
  ) {
    this.choice = { ...options.initial };
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

    if (this.options.canAll) {
      const row = this.el.createDiv({ cls: "goodobsidian-margin-all" });
      row.createSpan({ text: "All pages" });
      const toggle = row.createDiv({ cls: "checkbox-container" });
      toggle.setAttribute("role", "switch");
      toggle.setAttribute("aria-label", "All pages");
      toggle.tabIndex = 0;
      const flip = (): void => this.change({ all: !this.choice.all });
      toggle.addEventListener("click", flip);
      toggle.addEventListener("keydown", (event) => {
        if (event.key !== " " && event.key !== "Enter") return;
        event.preventDefault();
        flip();
      });
      this.allSwitch = toggle;
    }
  }

  /** Take part of a new choice, keep it inside what the ink allows, show it and report it. */
  private change(part: Partial<MarginChoice>): void {
    this.choice = this.allowed({ ...this.choice, ...part });
    this.sync();
    this.options.onChange({ ...this.choice });
  }

  /** `choice`, with every side the ink reaches into kept and the width at least its floor. */
  private allowed(choice: MarginChoice): MarginChoice {
    const floor = this.options.floor(choice.all);
    const left = choice.side === "left" || choice.side === "both" || floor.left;
    const right = choice.side === "right" || choice.side === "both" || floor.right;
    const side: MarginSide = left && right ? "both" : left ? "left" : right ? "right" : "none";
    const min = Math.max(MARGIN_MIN_PERCENT, Math.min(MARGIN_MAX_PERCENT, floor.percent));
    const percent = Math.round(Math.min(MARGIN_MAX_PERCENT, Math.max(min, choice.percent)));
    return { ...choice, side, percent };
  }

  private sync(): void {
    const { side, percent, all } = this.choice;
    const floor = this.options.floor(all);
    for (const [option, button] of this.buttons) {
      const active = option === side;
      button.toggleClass("is-active", active);
      button.setAttribute("aria-checked", String(active));
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
    if (this.allSwitch) {
      this.allSwitch.toggleClass("is-enabled", all);
      this.allSwitch.setAttribute("aria-checked", String(all));
    }
  }
}
