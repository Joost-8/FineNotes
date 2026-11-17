/**
 * The link dot on a snippet (`ImageElement.slide`, `model/snippet.ts`): a
 * small accent dot just inside the picture's top-right corner, turning with
 * it, that opens the slide the snippet came from. Buttons in the paper, so
 * they scroll with it; `onTap` takes the finger, the Pencil and the mouse
 * alike and keeps the pen from writing under the dot. Only the live view
 * has them: exports and previews draw the picture, never the dot.
 */

import type { ImageElement, Page, SlideRef } from "../model/document";
import type { PageBox } from "../canvas/page-layout";
import { fromImageLocal, transformOf } from "../canvas/image-geometry";
import { isFolded } from "../model/sticky-notes";
import { t } from "../i18n/translate";
import { onTap } from "./selection-bar";

/** How far inside the picture's corner the dot's centre sits, CSS px. */
const DOT_INSET_PX = 12;

export class SlideDots {
  private readonly el: HTMLElement;
  private readonly dots: HTMLButtonElement[] = [];
  /** What each pooled dot stands for now, read at tap time. */
  private targets: SlideRef[] = [];

  constructor(
    parent: HTMLElement,
    private readonly open: (slide: SlideRef) => void,
  ) {
    this.el = parent.createDiv({ cls: "goodobsidian-slide-dots is-hidden" });
  }

  /**
   * A dot on every snippet on `boxes`' pages (layout px × `scale` = CSS
   * px); none when `shown` is false (a PDF's tab, which holds no snippets).
   */
  sync(
    boxes: readonly PageBox[],
    pageAt: (index: number) => Page | null,
    scale: number,
    shown: boolean,
  ): void {
    const targets: SlideRef[] = [];
    if (shown) {
      const inset = DOT_INSET_PX / scale;
      for (const box of boxes) {
        for (const image of pageAt(box.index)?.images ?? []) {
          if (!image.slide || isFolded(image)) continue;
          const at = dotPoint(image, inset);
          const dot = this.dot(targets.length);
          targets.push(image.slide);
          dot.removeClass("is-hidden");
          dot.setCssStyles({
            left: `${(box.x + at.x) * scale}px`,
            top: `${(box.y + at.y) * scale}px`,
          });
        }
      }
    }
    this.targets = targets;
    for (let i = targets.length; i < this.dots.length; i++) this.dots[i].addClass("is-hidden");
    this.el.toggleClass("is-hidden", targets.length === 0);
  }

  /** The pooled dot `i`, made on first use. */
  private dot(i: number): HTMLButtonElement {
    const made = this.dots[i];
    if (made) return made;
    const dot = this.el.createEl("button", {
      cls: "goodobsidian-slide-dot clickable-icon",
      attr: { "aria-label": t("surface.snippet.openSlide") },
    });
    onTap(dot, () => {
      const target = this.targets[i];
      if (target) this.open(target);
    });
    this.dots.push(dot);
    return dot;
  }
}

/** Page point of the dot's centre: just inside the top-right corner, turning with the picture. */
function dotPoint(image: ImageElement, inset: number): { x: number; y: number } {
  const box = transformOf(image);
  return fromImageLocal(box, {
    x: Math.max(0, box.w / 2 - inset),
    y: Math.min(0, inset - box.h / 2),
  });
}
