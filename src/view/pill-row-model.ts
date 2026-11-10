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
 * A bar along the top or bottom with room for all of the pill holds it
 * itself, after its tools, as Goodnotes does: no row at all
 * ({@link pillFitsBar}). A pill that would be cut short there (the pen's
 * colours, on most iPads) gets the row instead, and keeps it at that bar
 * width ({@link keepsPillRow}).
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
 * Whether a pill docked along the top or bottom goes inside the bar: every
 * one of its options shows in the `room` left between the bar's groups,
 * nothing scrolled out of sight or shortened (`fitsAll`), and it is no
 * taller than the bar. Otherwise it has a row of its own, as wide as the
 * page, where the pen's colours have room to all show (discussion #200).
 * No button of the bar folds away to make the room.
 */
export function pillFitsBar(input: {
  edge: PillRowEdge;
  room: number;
  fitsAll: boolean;
  height: number;
  barHeight: number;
}): boolean {
  if (input.edge !== "top" && input.edge !== "bottom") return false;
  return input.room > 0 && input.fitsAll && input.height <= input.barHeight;
}

/**
 * Whether a docked pill keeps its row though it would fit inside the bar:
 * a pill already needed the row at this bar width (`rowWidth`, px; null when
 * none has). So the row does not come and go with every switch between the
 * pen (whose colours need the row) and a tool with a short pill, moving the
 * page each time. A new width (a rotation, Split View, the bar moved) asks
 * again.
 */
export function keepsPillRow(rowWidth: number | null, barWidth: number): boolean {
  return rowWidth !== null && Math.abs(rowWidth - barWidth) < 1;
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
