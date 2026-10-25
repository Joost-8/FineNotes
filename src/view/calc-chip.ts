/**
 * A calculation note's suggestion: a small chip beside a line that ends in
 * "=", saying what was read and the answer ("12×4 = 48"). It is chrome, not
 * ink: a tap writes the answer (the host does that), anything else leaves
 * the page as it was. One per surface, in the paper, so it scrolls and zooms
 * with the page; the surface places it (`InkSurface.showCalcSuggestion`).
 */

import { onTap } from "./selection-bar";

/** Where the chip belongs: a page, and a point on it in page px (the chip's bottom left). */
export interface CalcChipAnchor {
  pageId: string;
  x: number;
  y: number;
}

export class CalcChip {
  private readonly el: HTMLButtonElement;
  private readonly sumEl: HTMLElement;
  private readonly answerEl: HTMLElement;
  private accept: (() => void) | null = null;
  /** Where it is shown, or null while hidden. */
  anchor: CalcChipAnchor | null = null;

  constructor(parent: HTMLElement) {
    this.el = parent.createEl("button", { cls: "goodobsidian-calc-chip clickable-icon is-hidden" });
    this.sumEl = this.el.createSpan({ cls: "goodobsidian-calc-chip-sum" });
    this.answerEl = this.el.createSpan({ cls: "goodobsidian-calc-chip-answer" });
    // Finger, Pencil and mouse alike, and the pen never writes under it.
    onTap(this.el, () => {
      const accept = this.accept;
      this.hide();
      accept?.();
    });
  }

  /**
   * Show `sum` and `answer` ("12×4 =", "48") at `anchor`; `accept` runs on a
   * tap. `answer` is what will be written, so it is what the label names.
   */
  show(anchor: CalcChipAnchor, sum: string, answer: string, accept: () => void): void {
    this.anchor = anchor;
    this.accept = accept;
    this.sumEl.setText(sum);
    this.answerEl.setText(answer);
    this.el.setAttribute("aria-label", `Write ${answer}`);
    this.el.removeClass("is-hidden");
  }

  /** Put it at `left`, `top` in the paper's px (its bottom left corner). */
  place(left: number, top: number): void {
    this.el.setCssStyles({ left: `${left}px`, top: `${top}px` });
  }

  hide(): void {
    this.anchor = null;
    this.accept = null;
    this.el.addClass("is-hidden");
  }

  get shown(): boolean {
    return this.anchor !== null;
  }
}
