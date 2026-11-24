/**
 * The slide chip on a snippet (`ImageElement.slide`, `model/snippet.ts`): a
 * small accent chip at the picture's top-right corner, turning with it, with
 * the slides icon and the slide's number, that opens the slide the snippet
 * came from. It is the only way back to the slide: a tap on the picture
 * itself is any picture's tap. Buttons in the paper, so they scroll with it;
 * `onTap` takes the finger, the Pencil and the mouse alike and keeps the pen
 * from writing under the chip (its target is 32 px or more). Only the live
 * view has them: exports and previews draw the picture, never the chip.
 *
 * While its snippet is selected or cropped the chip steps aside: the picture's
 * own action bar offers "Open slide" then, and the chip would sit over the
 * frame's top-right handle, where it took presses meant for a resize.
 */

import { setIcon } from "obsidian";
import type { ImageElement, Page, SlideRef } from "../model/document";
import type { PageBox } from "../canvas/page-layout";
import { fromImageLocal, transformOf } from "../canvas/image-geometry";
import { isMirror } from "../canvas/mirrors";
import { isFolded } from "../model/sticky-notes";
import { t } from "../i18n/translate";
import { onTap } from "./selection-bar";

/** How far inside the picture's corner the chip's centre sits, CSS px: across, and down. */
const CHIP_INSET_X_PX = 26;
const CHIP_INSET_Y_PX = 16;

export class SlideDots {
  private readonly el: HTMLElement;
  private readonly chips: Array<{ button: HTMLButtonElement; number: HTMLElement }> = [];
  /** What each pooled chip stands for now, read at tap time. */
  private targets: SlideRef[] = [];
  /** The picture whose chip steps aside (selected or cropped), if any. */
  private aside: ImageElement | null = null;
  /** The last sync's arguments, to sync again when `aside` changes. */
  private last: Parameters<SlideDots["sync"]> | null = null;

  constructor(
    parent: HTMLElement,
    private readonly open: (slide: SlideRef) => void,
    /** The name of tab `tab` (its PDF), for the chip's label. */
    private readonly tabName: (tab: string) => string = () => "PDF",
  ) {
    this.el = parent.createDiv({ cls: "goodobsidian-slide-dots is-hidden" });
  }

  /**
   * A chip on every snippet on `boxes`' pages (layout px × `scale` = CSS
   * px); none when `shown` is false (a PDF's tab, which holds no snippets).
   */
  sync(
    boxes: readonly PageBox[],
    pageAt: (index: number) => Page | null,
    scale: number,
    shown: boolean,
  ): void {
    this.last = [boxes, pageAt, scale, shown];
    const targets: SlideRef[] = [];
    if (shown) {
      const inset = { x: CHIP_INSET_X_PX / scale, y: CHIP_INSET_Y_PX / scale };
      for (const box of boxes) {
        for (const image of pageAt(box.index)?.images ?? []) {
          // A snippet across joined pages has a mirror on the next page, at the
          // same spot: the owner's chip is the only one (canvas/mirrors.ts).
          if (!image.slide || isFolded(image) || isMirror(image) || image === this.aside) continue;
          const at = chipPoint(image, inset);
          const chip = this.chip(targets.length);
          targets.push(image.slide);
          const number = String(image.slide.page + 1);
          if (chip.number.textContent !== number) chip.number.setText(number);
          chip.button.setAttribute(
            "aria-label",
            t("surface.snippet.openSlideOf", {
              page: image.slide.page + 1,
              name: this.tabName(image.slide.tab),
            }),
          );
          chip.button.removeClass("is-hidden");
          chip.button.setCssStyles({
            left: `${(box.x + at.x) * scale}px`,
            top: `${(box.y + at.y) * scale}px`,
          });
        }
      }
    }
    this.targets = targets;
    for (let i = targets.length; i < this.chips.length; i++)
      this.chips[i].button.addClass("is-hidden");
    this.el.toggleClass("is-hidden", targets.length === 0);
  }

  /**
   * The picture that is selected or cropped now, or `null`: its chip steps
   * aside until it is let go. Cheap when nothing changed.
   */
  setAside(image: ImageElement | null): void {
    if (image === this.aside) return;
    this.aside = image;
    if (this.last) this.sync(...this.last);
  }

  /** The pooled chip `i`, made on first use. */
  private chip(i: number): { button: HTMLButtonElement; number: HTMLElement } {
    const made = this.chips[i];
    if (made) return made;
    const button = this.el.createEl("button", {
      cls: "goodobsidian-slide-dot clickable-icon",
      attr: { "aria-label": t("surface.snippet.openSlide") },
    });
    const face = button.createSpan({ cls: "goodobsidian-slide-chip" });
    setIcon(face.createSpan({ cls: "goodobsidian-slide-chip-icon" }), "presentation");
    const number = face.createSpan({ cls: "goodobsidian-slide-chip-number" });
    onTap(button, () => {
      const target = this.targets[i];
      if (target) this.open(target);
    });
    const chip = { button, number };
    this.chips.push(chip);
    return chip;
  }
}

/** Page point of the chip's centre: just inside the top-right corner, turning with the picture. */
function chipPoint(image: ImageElement, inset: { x: number; y: number }): { x: number; y: number } {
  const box = transformOf(image);
  return fromImageLocal(box, {
    x: Math.max(0, box.w / 2 - inset.x),
    y: Math.min(0, inset.y - box.h / 2),
  });
}
