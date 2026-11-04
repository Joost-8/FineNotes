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
