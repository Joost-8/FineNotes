/**
 * Page px ↔ millimetres ↔ the zoom a person reads. Pure.
 *
 * Page geometry is defined against A4: its 210 mm is `DEFAULT_PAPER_WIDTH`
 * page px (1024), so every paper size, pen width and zoom can be told in
 * real-world units without storing any.
 */

import { DEFAULT_PAPER_WIDTH } from "../constants";

/** Page px per millimetre: A4's 210 mm is 1024 page px. */
export const PAGE_PX_PER_MM = DEFAULT_PAPER_WIDTH / 210;

/** CSS px per millimetre at CSS's reference 96 px per inch. */
export const CSS_PX_PER_MM = 96 / 25.4;

/** A length in page px, in millimetres. */
export function pageToMm(px: number): number {
  return px / PAGE_PX_PER_MM;
}

/** A length in millimetres, in page px. */
export function mmToPage(mm: number): number {
  return mm * PAGE_PX_PER_MM;
}

/**
 * The zoom a person reads, in percent, for a view drawing one page px as
 * `scale` CSS px: 100% shows the page at its real size (at 96 CSS px per
 * inch), as GoodNotes' readout does. Rounded; 0 for nonsense.
 */
export function zoomPercent(scale: number): number {
  if (!(scale > 0) || !Number.isFinite(scale)) return 0;
  return Math.round((scale * PAGE_PX_PER_MM * 100) / CSS_PX_PER_MM);
}

/**
 * A pen width, as the width popover tells it: millimetres to two decimals
 * below 1 mm and one decimal above, as GoodNotes' "0.90 mm".
 */
export function formatMm(px: number): string {
  const mm = pageToMm(px);
  if (!(mm > 0) || !Number.isFinite(mm)) return "0 mm";
  return `${mm < 1 ? mm.toFixed(2) : mm.toFixed(1)} mm`;
}
