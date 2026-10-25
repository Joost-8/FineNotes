/**
 * Where the tool options pill rests (PURE), after GoodNotes: under the tool
 * bar, along the bottom, or upright along the left or right edge. The user
 * drags it there (`pill-drag.ts`) and it springs to the nearest place, which
 * every tool's pill then shares and each device remembers.
 *
 * Only these places, never a free position: the pill was draggable anywhere
 * until 0.3.1, and a stored position left it in the middle of the page on
 * every device it had been dragged on (toolbar.ts, `applyPosition`).
 */

export type PillDock = "top" | "bottom" | "left" | "right";

export const PILL_DOCKS: readonly PillDock[] = ["top", "bottom", "left", "right"];

/** Where the pill rests until the user moves it: under the tool bar, as it always has. */
export const DEFAULT_PILL_DOCK: PillDock = "top";

/** A stored place, read back; anything else is the default. */
export function parsePillDock(raw: unknown): PillDock {
  return typeof raw === "string" && (PILL_DOCKS as readonly string[]).includes(raw)
    ? (raw as PillDock)
    : DEFAULT_PILL_DOCK;
}

/**
 * The part of the view the pill can rest in, host px: below the tool bar
 * (`top`), right of a docked panel (`left`), above the keyboard (`bottom`).
 */
export interface PillArea {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The place nearest to a pill let go at (`x`, `y`), host px, among
 * `allowed`: the edge of `area` it is closest to. Ties keep `allowed`'s
 * order, so a pill let go dead centre goes back under the tool bar.
 */
export function nearestDock(
  area: PillArea,
  x: number,
  y: number,
  allowed: readonly PillDock[] = PILL_DOCKS,
): PillDock {
  const distance: Record<PillDock, number> = {
    top: Math.abs(y - area.top),
    bottom: Math.abs(area.bottom - y),
    left: Math.abs(x - area.left),
    right: Math.abs(area.right - x),
  };
  let best: PillDock = allowed[0] ?? DEFAULT_PILL_DOCK;
  for (const dock of allowed) if (distance[dock] < distance[best]) best = dock;
  return best;
}

/** Whether a pill at `dock` stands upright. */
export function isUpright(dock: PillDock): boolean {
  return dock === "left" || dock === "right";
}

/**
 * Where a pill of `width` × `height` rests at `dock`, host px, `inset` px
 * clear of the area's edges. Along the top and bottom it is centred; along
 * a side it starts near the top, as GoodNotes' does. It always stays inside
 * the area, so a pill wider than the area starts at its left.
 */
export function dockPlace(
  dock: PillDock,
  area: PillArea,
  width: number,
  height: number,
  inset: number,
): { left: number; top: number } {
  const clampLeft = (left: number): number =>
    Math.max(area.left + inset, Math.min(left, area.right - inset - width));
  const clampTop = (top: number): number =>
    Math.max(area.top, Math.min(top, area.bottom - inset - height));
  const centred = (area.left + area.right - width) / 2;
  switch (dock) {
    case "top":
      return { left: clampLeft(centred), top: area.top };
    case "bottom":
      return { left: clampLeft(centred), top: clampTop(area.bottom - inset - height) };
    case "left":
      return { left: area.left + inset, top: clampTop(area.top + inset) };
    case "right":
      return {
        left: Math.max(area.left + inset, area.right - inset - width),
        top: clampTop(area.top + inset),
      };
  }
}

/** Which way a popover opens from a control in the pill. */
export type PopoverSide = "down" | "up" | "right" | "left";

/**
 * A popover hanging from the pill opens away from the pill's edge, toward
 * the page: down from the top, up from the bottom, inwards from a side.
 */
export function popoverSide(dock: PillDock): PopoverSide {
  switch (dock) {
    case "top":
      return "down";
    case "bottom":
      return "up";
    case "left":
      return "right";
    case "right":
      return "left";
  }
}

/**
 * The first of `count` colours an upright pill shows out of a row of
 * `length`, so the chosen one (at `chosen`, -1 for none) is among them:
 * in the middle where it can be, never past either end.
 */
export function colorWindow(length: number, chosen: number, count: number): number {
  if (length <= count || chosen < 0) return 0;
  const middle = chosen - Math.floor((count - 1) / 2);
  return Math.max(0, Math.min(middle, length - count));
}

/** How far into the view, px, the pill reaches from each edge it rests on. */
export interface PillClearance {
  bottom: number;
  left: number;
  right: number;
}

/**
 * The room the pill takes from the view's bottom, left or right edge, so
 * what else sits there (the page counter, the zoom readout, the recording
 * pill, the audio player) can step aside: from the edge to the pill's far
 * side, plus `gap`. Nothing while it is not shown at its place (tucked
 * away, or floating by a text box), and nothing under the tool bar, where
 * none of those sit.
 */
export function pillClearance(
  dock: PillDock,
  pill: { left: number; top: number; right: number; bottom: number },
  host: { width: number; height: number },
  shown: boolean,
  gap: number,
): PillClearance {
  const none = { bottom: 0, left: 0, right: 0 };
  if (!shown || dock === "top") return none;
  const reach = (n: number): number => Math.max(0, Math.round(n + gap));
  if (dock === "bottom") return { ...none, bottom: reach(host.height - pill.top) };
  if (dock === "left") return { ...none, left: reach(pill.right) };
  return { ...none, right: reach(host.width - pill.left) };
}
