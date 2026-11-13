/**
 * The options pill docked as a row (PURE), after Goodnotes (discussion #43):
 * with "Dock tool options" on, a pill resting by the tool bar, wherever the
 * bar is, no longer floats over the page. The bar grows a row (a column, by a
 * bar at a side) of its own colour that holds the pill, and the page starts past it, so the first line
 * of writing is never under the pen's colours.
 *
 * The row is as tall as what it shows: the pill and a gap either side of it.
 * A tool with no pill, or a pill tucked away, gives the page its room back.
 * While the pill floats by a text box (`anchored`) the row keeps the room it
 * had, so tapping into a box does not move the page under the finger.
 *
 * Only by the bar: a pill at another edge than the bar's is one the user
 * carried away from it, and floats where it was left.
 *
 * A bar along the top or bottom with room to spare holds the pill itself,
 * after its tools, as Goodnotes does: no row at all ({@link pillFitsBar}).
 */

import type { BarDock } from "./bar-dock-model";
import type { PillDock } from "./pill-dock-model";

/** Which edge of the page the row takes, or none. */
export type PillRowEdge = "top" | "bottom" | "left" | "right" | null;

/**
 * The row as shown: the edge it takes from the page and how many px. Along
 * the top or bottom it is a row, as tall as `room`; at a side it is a column
 * of the same make, as wide.
 */
export interface PillRow {
  edge: PillRowEdge;
  room: number;
}

export const NO_PILL_ROW: PillRow = { edge: null, room: 0 };

/** A stored "Dock tool options", read back: on only when it was saved on. */
export function parsePillRowOn(raw: unknown): boolean {
  return raw === true || raw === "on";
}

/** The edge the row takes, when docking is on and the pill rests by the bar, wherever the bar is. */
export function pillRowEdge(on: boolean, pill: PillDock, bar: BarDock): PillRowEdge {
  return on && pill === bar ? bar : null;
}

/**
 * How the pen's widths show. `"one"`: a single button, the width in use,
 * whose tap lists them all, as Goodnotes and Notability keep it. That is
 * so upright beside the page when the pill is not docked in a column of
 * its own, and when it is docked along the top or bottom, where the bar's
 * room goes to the colours instead (discussion #200). Otherwise `"quick"`:
 * the three quick widths and a ⌄.
 */
export function penWidthsShown(input: {
  upright: boolean;
  /** Docked in a column of its own beside the page. */
  roomy: boolean;
  edge: PillRowEdge;
}): "one" | "quick" {
  if (input.upright) return input.roomy ? "quick" : "one";
  return input.edge === "top" || input.edge === "bottom" ? "one" : "quick";
}

/**
 * Whether a pill docked along the top or bottom goes inside the bar: all of
 * it (`need` px wide at its narrowest) fits the `room` left between the
 * bar's groups, and it is no taller than the bar. Otherwise it has a row.
 */
export function pillFitsBar(input: {
  edge: PillRowEdge;
  room: number;
  need: number;
  height: number;
  barHeight: number;
}): boolean {
  if (input.edge !== "top" && input.edge !== "bottom") return false;
  return input.room > 0 && input.need <= input.room + 1 && input.height <= input.barHeight;
}

/**
 * The row for a pill `height` px thick at its place (tall along the top or
 * bottom, wide at a side), `gap` px from the bar and from the page. `shown` is false while the pill is tucked away or has
 * nothing to show; `anchored` while it floats by a text box, when the row
 * keeps `previous` (as long as it is on the same edge).
 */
export function pillRow(input: {
  edge: PillRowEdge;
  shown: boolean;
  anchored: boolean;
  height: number;
  gap: number;
  previous: PillRow;
}): PillRow {
  const { edge, previous } = input;
  if (edge === null) return NO_PILL_ROW;
  if (input.anchored) return previous.edge === edge ? previous : NO_PILL_ROW;
  if (!input.shown || !(input.height > 0)) return NO_PILL_ROW;
  return { edge, room: Math.round(input.height + 2 * Math.max(0, input.gap)) };
}

/**
 * How far the page's top moves when the row changes from `before` to
 * `after`, px, down positive: only a row along the top moves it.
 */
export function pageTopShift(before: PillRow, after: PillRow): number {
  const top = (row: PillRow): number => (row.edge === "top" ? row.room : 0);
  return top(after) - top(before);
}

/**
 * The scroll offset that keeps the spot being read still on screen when the
 * page's top moves down by `shift` px (up when negative): the offset moves
 * with it. At the very start of the notebook (`y` at `minY`) the page stays
 * where it starts, so a row that appears pushes the first line clear of
 * itself instead of covering it.
 */
export function followTopShift(y: number, shift: number, minY: number): number {
  if (shift === 0 || y <= minY + 0.5) return y;
  return Math.max(minY, y + shift);
}

/**
 * What each tool's row needs inside the bar until it has been measured, px,
 * with the colours given way (measured in the UI gallery in English,
 * 2026-11-13). The bar decides from the widest, so these keep the first
 * decision close to the one measuring every row would make.
 */
export const ROW_NEED_SEEDS: Readonly<Record<string, number>> = {
  pen: 512,
  shape: 645,
  text: 625,
  tape: 573,
  select: 485,
  eraser: 469,
  fill: 427,
  laser: 262,
};

/**
 * The widest row any tool shows (docking design B, 2026-11-13): the bar holds
 * the rows only when this one fits beside its tools, so switching tools never
 * moves a button. A measured row replaces its seed, since a longer language or
 * a pinned pen changes it.
 */
export function widestRow(measured: ReadonlyMap<string, number>): number {
  const needs: Record<string, number> = { ...ROW_NEED_SEEDS };
  for (const [tool, need] of measured) needs[tool] = need;
  return Math.max(0, ...Object.values(needs));
}

/**
 * How many of the bar's buttons are folded into ⋯, as its badge shows it:
 * nothing at none.
 */
export function foldedBadge(count: number): string | null {
  return count > 0 ? String(count) : null;
}
