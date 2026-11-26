/**
 * The accent ring that pulses round a page (or the ink drawn on it) after
 * "Open in notebook" jumps there from a Handwrite here block. Where it goes
 * is `flashRing` (inline-surface-model.ts, pure); this draws it and takes
 * it away after a moment.
 */

import type { Page } from "../model/document";
import type { PageBox } from "../canvas/page-layout";
import { drawnBounds } from "../model/board";
import { flashRing } from "./inline-surface-model";

/** How long the ring shows, ms. */
const FLASH_MS = 1500;

/** Pulse a ring on `host` round `page`, laid out at `box`, as the surface shows it now. */
export function flashPageRing(
  host: HTMLElement,
  win: Window,
  box: PageBox,
  page: Page,
  view: { scale: number; offsetX: number; scrollY: number },
): void {
  if (!(view.scale > 0)) return;
  const at = flashRing(box, drawnBounds(page), view);
  const ring = host.createDiv({ cls: "goodobsidian-page-flash" });
  ring.setCssProps({
    left: `${at.left}px`,
    top: `${at.top}px`,
    width: `${at.width}px`,
    height: `${at.height}px`,
  });
  win.setTimeout(() => ring.remove(), FLASH_MS);
}
