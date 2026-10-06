/**
 * The stroke-width slider's stops (FineNotes#7: "allow values below
 * 0.44 mm"). Above the thinnest preset the slider moves in half page px, as
 * it always has. The pens can also go below it, to {@link FINE_PEN_MIN_MM},
 * in steps fine enough that each one is a visible change. The highlighter
 * cannot: a hairline highlight is no highlight, and it is drawn four times
 * the width anyway.
 *
 * Why 0.2 mm: measured on canvas, a line narrower than about one device
 * pixel is drawn grey, not ink-coloured. 0.2 mm is 1.5 device px on an iPad
 * at fit-to-page (solid ink), and 0.8 px on a 1x desktop screen at fit
 * (greyish until zoomed in). Thinner would be grey on the iPad too.
 *
 * Pure: no DOM, no Obsidian.
 */

import { mmToPage } from "./units";

/** The thinnest pen the slider reaches, in mm. */
export const FINE_PEN_MIN_MM = 0.2;

/** The fine stops below the presets, in mm. */
const FINE_STOPS_MM = [0.2, 0.25, 0.3, 0.35];

/** The slider's step above the presets' minimum, in page px. */
const COARSE_STEP = 0.5;

/** `mm` as page px, to a hundredth: what a stroke stores. */
function fineWidth(mm: number): number {
  return Math.round(mmToPage(mm) * 100) / 100;
}

/** The thinnest pen width in page px. */
export const FINE_PEN_MIN = fineWidth(FINE_PEN_MIN_MM);

/**
 * Every width the slider stops at, thinnest first: the fine stops when
 * `fine` (the pens), then from the thinnest preset to the widest in half px.
 */
export function widthStops(presets: readonly number[], fine: boolean): number[] {
  const low = Math.min(...presets);
  const high = Math.max(...presets);
  const stops = fine ? FINE_STOPS_MM.map(fineWidth).filter((width) => width < low) : [];
  for (let width = low; width <= high + 1e-9; width += COARSE_STEP) {
    stops.push(Math.round(width * 100) / 100);
  }
  return stops;
}

/** The stop nearest `width` (the slider's thumb for a width set elsewhere). */
export function nearestStop(stops: readonly number[], width: number): number {
  let best = 0;
  for (let i = 1; i < stops.length; i++) {
    if (Math.abs(stops[i] - width) < Math.abs(stops[best] - width)) best = i;
  }
  return best;
}

/**
 * The width a stroke is drawn at before the pen type's multiplier: the
 * chosen one, but never under `floor` (the highlighter's thinnest preset,
 * when the pen was set thinner: pen and highlighter share one width).
 */
export function chosenWidth(size: number, floor: number): number {
  return Math.max(floor, size);
}
