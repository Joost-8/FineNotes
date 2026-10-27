/**
 * Where the tool bar rests (PURE): along the top, as it always has, along
 * the bottom, or upright at the left or right edge of the notebook
 * (FineNotes#50). A setting chooses it (settings.ts, "Toolbar"), kept per
 * device as the pill's place is, since an iPad and a laptop want different
 * places; every open notebook follows. Only these places, never a free
 * position, for the pill's reason (`pill-dock-model.ts`).
 *
 * The bar takes its edge from the page: the page area is the view less the
 * bar's side, and the pill, the counter, the zoom readout and the toasts all
 * rest inside it, so nothing ever sits on the bar.
 */

import {
  type PillArea,
  type PillDock,
  type PopoverSide,
  PILL_DOCKS,
  popoverSide,
} from "./pill-dock-model";

/** The bar's places are the pill's four edges. */
export type BarDock = PillDock;

/** Where the bar rests until the user chooses otherwise: along the top. */
export const DEFAULT_BAR_DOCK: BarDock = "top";

/** A stored place, read back; anything else is the default. */
export function parseBarDock(raw: unknown): BarDock {
  return typeof raw === "string" && (PILL_DOCKS as readonly string[]).includes(raw)
    ? (raw as BarDock)
    : DEFAULT_BAR_DOCK;
}

/** A box, host or client px. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The page area, host px: where the pill rests, `gap` clear of the bar and
 * of the view's top. `bar` is the bar's box at `dock`; `view` is where the
 * view's page body runs: its sides inside the view's padding, its bottom
 * above Obsidian's foot padding and the keyboard. A panel docked at the
 * page's left (the page sidebar, the Ask chat) `leftInset` wide is kept
 * clear of, unless a pill of `pillWidth` would not fit beside it.
 */
export function pageArea(
  dock: BarDock,
  bar: Box,
  view: { left: number; right: number; bottom: number },
  gap: number,
  leftInset: number,
  pillWidth: number,
): PillArea {
  const left = dock === "left" ? bar.right : view.left;
  const right = dock === "right" ? bar.left : view.right;
  return {
    left: left + Math.min(leftInset, Math.max(0, right - left - pillWidth)),
    top: dock === "top" ? bar.bottom + gap : gap,
    right,
    // Under the iPad keyboard a bottom bar is covered, and the page ends above it.
    bottom: dock === "bottom" ? Math.min(bar.top, view.bottom) : view.bottom,
  };
}

/**
 * Where the pill goes when the bar moves from `from` to `to`: a pill resting
 * by the bar goes with it, as its options belong to the bar's tools; one the
 * user put at another edge stays there (beside the bar, should the bar come
 * to that edge).
 */
export function pillAfterBarMove(pill: PillDock, from: BarDock, to: BarDock): PillDock {
  return pill === from ? to : pill;
}

/** Which way a popover or menu opens from a bar button: toward the page. */
export function barMenuSide(dock: BarDock): PopoverSide {
  return popoverSide(dock);
}

/** Whether the bar at `dock` stands upright. */
export function isBarUpright(dock: BarDock): boolean {
  return dock === "left" || dock === "right";
}

/**
 * The tallest a menu can be that opens on `side` of a button at `anchor`,
 * in a window `room` high: from the button to the window's edge, `gap` from
 * the one and `margin` from the other; the whole window, less its margins,
 * beside the button.
 */
export function menuRoom(
  side: PopoverSide,
  anchor: Box,
  room: { height: number },
  gap: number,
  margin: number,
): number {
  switch (side) {
    case "down":
      return room.height - anchor.bottom - gap - margin;
    case "up":
      return anchor.top - gap - margin;
    default:
      return room.height - 2 * margin;
  }
}

/**
 * Where a menu of `size` opens on `side` of a bar button at `anchor`, client
 * px, inside a window of `room`, `gap` from the button and `margin` clear of
 * the window's edges:
 *
 * - below or above, along the button's left (`start`) or right (`end`) edge,
 *   on the other side when it has no room;
 * - beside, its top level with the button's, slid up to stay on screen, on
 *   the other side when it has no room.
 */
export function menuPlace(
  side: PopoverSide,
  anchor: Box,
  size: { width: number; height: number },
  room: { width: number; height: number },
  align: "start" | "end",
  gap: number,
  margin: number,
): { left: number; top: number } {
  const clamp = (value: number, max: number): number => Math.max(margin, Math.min(value, max));
  const maxLeft = room.width - size.width - margin;
  const maxTop = room.height - size.height - margin;
  if (side === "down" || side === "up") {
    const left = clamp(align === "start" ? anchor.left : anchor.right - size.width, maxLeft);
    const below = anchor.bottom + gap;
    const above = anchor.top - gap - size.height;
    const fitsBelow = below + size.height <= room.height - margin;
    const fitsAbove = above >= margin;
    const top =
      side === "down"
        ? fitsBelow || !fitsAbove
          ? below
          : above
        : fitsAbove || !fitsBelow
          ? above
          : below;
    return { left, top: clamp(top, maxTop) };
  }
  const after = anchor.right + gap;
  const before = anchor.left - gap - size.width;
  const fitsAfter = after + size.width <= room.width - margin;
  const fitsBefore = before >= margin;
  const left =
    side === "right"
      ? fitsAfter || !fitsBefore
        ? after
        : before
      : fitsBefore || !fitsAfter
        ? before
        : after;
  return { left: clamp(left, maxLeft), top: clamp(anchor.top, maxTop) };
}

/** What `menuAnchor` reads: the button, and the bar it sits in, if any. */
export interface MenuAnchor {
  getBoundingClientRect(): Box;
  closest(selector: string): {
    getAttribute(name: string): string | null;
    getBoundingClientRect(): Box;
  } | null;
}

/**
 * Which way a menu opens from `anchor`, and the box it opens from, client
 * px: toward the page from a button on the tool bar, as the bar's
 * `data-dock` says, `gap` measured from the bar's own edge rather than the
 * button's (which sits inside the bar's padding); down from the button
 * itself for anything else, and from the bar along the top as ever.
 */
export function menuAnchor(anchor: MenuAnchor): { side: PopoverSide; box: Box } {
  const at = anchor.getBoundingClientRect();
  const box = { left: at.left, top: at.top, right: at.right, bottom: at.bottom };
  const bar = anchor.closest(".goodobsidian-toolbar");
  if (!bar) return { side: "down", box };
  const side = barMenuSide(parseBarDock(bar.getAttribute("data-dock")));
  const edge = bar.getBoundingClientRect();
  if (side === "up") box.top = edge.top;
  else if (side === "right") box.right = edge.right;
  else if (side === "left") box.left = edge.left;
  return { side, box };
}
