/**
 * The hint over a tip's scratch page (Try it): the tip's moving picture, its
 * title and one line, and a ✓ that ends the try. When the gesture is done
 * the ✓ fills with the accent, and the try ends by itself a moment later.
 */

import { setIcon } from "obsidian";
import { t } from "../i18n/translate";
import type { Feature } from "../model/feature-index";
import { tipScene } from "../model/tip-scenes";
import { TipVisual } from "./tip-visual";
import { winOf } from "./host-window";

/** How long the filled ✓ shows before the try ends by itself. */
export const TRY_DONE_MS = 1400;

export class TryHint {
  readonly el: HTMLElement;
  private readonly visual: TipVisual | null;
  private readonly button: HTMLButtonElement;
  private finished = false;
  private timer: number | null = null;

  constructor(
    parent: HTMLElement,
    readonly feature: Feature,
    private readonly onEnd: () => void,
  ) {
    this.el = parent.createDiv({ cls: "goodobsidian-try" });
    const tip = feature.tip;
    this.visual = tip
      ? new TipVisual(this.el.createDiv({ cls: "goodobsidian-try-visual" }), tipScene(tip.scene))
      : null;
    const words = this.el.createDiv({ cls: "goodobsidian-try-words" });
    words.createDiv({ cls: "goodobsidian-try-title", text: t(feature.title) });
    words.createDiv({ cls: "goodobsidian-try-body", text: t(feature.body) });
    this.button = this.el.createEl("button", {
      cls: "goodobsidian-try-done clickable-icon",
      attr: { type: "button", "aria-label": t("notebooks.tips.tryDone") },
    });
    setIcon(this.button, "check");
    this.button.addEventListener("click", () => this.end());
  }

  /** The event `event` happened: when it is this gesture's, mark it done and end soon. */
  noteUse(event: string): void {
    if (this.finished || this.feature.tryOn?.done !== event) return;
    this.finished = true;
    this.el.addClass("is-done");
    this.timer = winOf(this.el).setTimeout(() => this.end(), TRY_DONE_MS);
  }

  /** End the try: once, whatever ended it. */
  end(): void {
    if (this.timer !== null) winOf(this.el).clearTimeout(this.timer);
    this.timer = null;
    if (!this.el.isConnected) return;
    this.destroy();
    this.onEnd();
  }

  /** Take the hint away without ending the try (the view is closing). */
  destroy(): void {
    if (this.timer !== null) winOf(this.el).clearTimeout(this.timer);
    this.timer = null;
    this.visual?.destroy();
    this.el.remove();
  }
}
