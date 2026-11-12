/**
 * The frames of a notebook's named regions (discussion #167; `model/regions`)
 * on the surface: a thin dashed outline round each, its name in a small tab
 * at its top-left corner. Shown only while the lasso is the tool, the one
 * that makes them, so the page is clean while writing and reading. The
 * outline takes no presses; the name does (`onTap`, which keeps the pen from
 * writing under it), and its host offers Copy embed link, Rename and Delete.
 *
 * A pool of elements in the paper, placed in CSS px as the comment markers
 * are, so they scroll and zoom with it.
 */

import { setIcon } from "obsidian";
import type { Page, PageRegion } from "../model/document";
import { onTap } from "./selection-bar";

/** A page's box in the layout, as the surface places it (layout px). */
interface PlacedPage {
  index: number;
  x: number;
  y: number;
}

/** A region on screen: the page it is on (0-based) and the region. */
export interface ShownRegion {
  index: number;
  region: PageRegion;
}

export class RegionFrames {
  readonly el: HTMLElement;
  private readonly frames: HTMLElement[] = [];
  /** What each frame in the pool stands for now, read at tap time. */
  private shown: ShownRegion[] = [];

  constructor(
    parent: HTMLElement,
    private readonly onTapName: (shown: ShownRegion, anchor: HTMLElement) => void,
  ) {
    this.el = parent.createDiv({ cls: "goodobsidian-region-frames is-hidden" });
  }

  /**
   * Place a frame on every region of the pages laid out, `scale` CSS px per
   * layout px; none at all unless `visible`.
   */
  sync(
    boxes: readonly PlacedPage[],
    pageAt: (index: number) => Page | null | undefined,
    scale: number,
    visible: boolean,
  ): void {
    const shown: ShownRegion[] = [];
    if (visible) {
      for (const box of boxes) {
        for (const region of pageAt(box.index)?.regions ?? []) {
          const frame = this.frame(shown.length);
          shown.push({ index: box.index, region });
          frame.removeClass("is-hidden");
          frame.setCssStyles({
            left: `${(box.x + region.x) * scale}px`,
            top: `${(box.y + region.y) * scale}px`,
            width: `${region.w * scale}px`,
            height: `${region.h * scale}px`,
          });
          const name = frame.firstElementChild as HTMLElement | null;
          name?.querySelector(".goodobsidian-region-text")?.setText(region.name);
          name?.setAttribute("aria-label", region.name);
        }
      }
    }
    this.shown = shown;
    for (let i = shown.length; i < this.frames.length; i++) this.frames[i].addClass("is-hidden");
    this.el.toggleClass("is-hidden", shown.length === 0);
  }

  /** The pool's frame `i`, made the first time it is needed. */
  private frame(i: number): HTMLElement {
    const existing = this.frames[i];
    if (existing) return existing;
    const frame = this.el.createDiv({ cls: "goodobsidian-region-frame" });
    const name = frame.createEl("button", { cls: "goodobsidian-region-name" });
    const icon = name.createSpan({ cls: "goodobsidian-region-icon" });
    setIcon(icon, "frame");
    name.createSpan({ cls: "goodobsidian-region-text" });
    // The pool slot, not the region: what it stands for is read at tap time.
    onTap(name, () => {
      const target = this.shown[i];
      if (target) this.onTapName(target, name);
    });
    this.frames.push(frame);
    return frame;
  }
}
