/**
 * The "pull to add a page" ring GoodNotes shows past the last page: a page
 * icon inside a ring that fills as the page is dragged further past the end,
 * an arrow pointing the way to pull, and a label that turns to "Release"
 * once letting go would add the page.
 *
 * It sits in the strip of desk the stretch reveals — below the last page when
 * pages run down, right of it when they run across — and is chrome: it never
 * takes a pointer. The surface drives it every frame of a drag.
 */

import { setIcon } from "obsidian";
import type { ScrollDirection } from "../model/document";

/** Ring diameter, CSS px. */
const RING = 44;
const RADIUS = 19;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export class PullAddIndicator {
  private readonly el: HTMLElement;
  private readonly progressEl: SVGCircleElement;
  private readonly arrowEl: HTMLElement;
  private readonly labelEl: HTMLElement;
  private direction: ScrollDirection | null = null;
  private armed: boolean | null = null;
  private visible = false;

  constructor(host: HTMLElement) {
    this.el = host.createDiv({ cls: "goodobsidian-pull-add is-hidden" });
    this.el.setAttribute("aria-hidden", "true");
    const ring = this.el.createDiv({ cls: "goodobsidian-pull-add-ring" });
    const svg = ring.createSvg("svg", {
      attr: { width: RING, height: RING, viewBox: `0 0 ${RING} ${RING}` },
    });
    const c = RING / 2;
    svg.createSvg("circle", {
      cls: "goodobsidian-pull-add-track",
      attr: { cx: c, cy: c, r: RADIUS },
    });
    this.progressEl = svg.createSvg("circle", {
      cls: "goodobsidian-pull-add-progress",
      attr: {
        cx: c,
        cy: c,
        r: RADIUS,
        "stroke-dasharray": `${CIRCUMFERENCE}`,
        "stroke-dashoffset": `${CIRCUMFERENCE}`,
        transform: `rotate(-90 ${c} ${c})`,
      },
    });
    setIcon(ring.createDiv({ cls: "goodobsidian-pull-add-icon" }), "file-plus");
    this.arrowEl = this.el.createDiv({ cls: "goodobsidian-pull-add-arrow" });
    this.labelEl = this.el.createDiv({ cls: "goodobsidian-pull-add-label" });
  }

  /**
   * Show the ring for a stretch of `overscroll` px past the end, `progress`
   * of the way (0..1) to adding a page.
   */
  update(direction: ScrollDirection, overscroll: number, progress: number): void {
    if (overscroll <= 1) {
      this.hide();
      return;
    }
    if (direction !== this.direction) {
      this.direction = direction;
      this.el.toggleClass("is-row", direction === "horizontal");
      setIcon(this.arrowEl, direction === "horizontal" ? "arrow-left" : "arrow-up");
    }
    const armed = progress >= 1;
    if (armed !== this.armed) {
      this.armed = armed;
      this.el.toggleClass("is-armed", armed);
      this.labelEl.setText(armed ? "Release to add page" : "Pull to add page");
    }
    this.progressEl.setAttribute("stroke-dashoffset", `${CIRCUMFERENCE * (1 - progress)}`);
    // Centred in the strip of desk the stretch has revealed.
    const inset = Math.max(0, overscroll / 2);
    this.el.setCssProps({ "--gob-pull-inset": `${inset}px` });
    if (!this.visible) {
      this.visible = true;
      this.el.removeClass("is-hidden");
    }
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.el.addClass("is-hidden");
  }
}
