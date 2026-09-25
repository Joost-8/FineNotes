/**
 * The selection's action bar and its "…" menu, as data (0.5). Pure — no DOM,
 * no Obsidian — so what goes where, and where the bar floats, is tested;
 * `selection-bar.ts` draws it.
 *
 * After GoodNotes, from screenshots Joost supplied (2026-09-22): a dark
 * rounded pill floating centred above the selection (below it when there is
 * no room), icon-only buttons with a thin divider between groups, Delete as a
 * red trash can, and "…" last, opening a menu. That menu has a strip of
 * icon-over-label tiles at the top (GoodNotes' Cut · Front · Back) and then
 * rows (Copy, Duplicate, Paste, Lock image, …), grouped by dividers.
 *
 * Everything is one list of {@link SelectionAction} entries; each says
 * whether it appears in the bar, in the menu (as a row or a tile), or both.
 * Adding Cut, Copy, Paste, Bring to front or Crop is adding an entry.
 */

import type { Bounds } from "../model/document";

/** A row of colour swatches in the menu, in place of a single button. */
export interface ActionSwatches {
  colors: readonly string[];
  /** The colour to show as picked, or `null` when the selection mixes colours. */
  current: string | null;
  pick: (color: string) => void;
  /** Offer a custom colour, mixed from red, green and blue; this applies it. */
  custom?: (color: string) => void;
}

/** One thing the selection's bar or menu can do. */
export interface SelectionAction {
  /** Stable id. A tap finds its entry by id, so the list may be replaced at any time. */
  id: string;
  /** Lucide icon name, as `setIcon` takes it. */
  icon: string;
  label: string;
  /**
   * Entries with the same group sit together, and a thin divider separates
   * groups — in the bar and among the menu's rows alike. Groups keep the
   * order in which they first appear in the list.
   */
  group: string;
  /**
   * The group among the menu's rows, when it differs from the bar's: Delete
   * sits with Cut and Duplicate in the bar but at the foot of GoodNotes' menu.
   */
  menuGroup?: string;
  /** Default true. A disabled entry shows greyed and does nothing (GoodNotes greys Paste). */
  enabled?: boolean;
  /** Red, as GoodNotes draws Delete. */
  destructive?: boolean;
  /** Shown in the bar itself. Default false: menu only. */
  bar?: boolean;
  /**
   * In the bar, the label beside the icon. For a bar of a word or two where
   * an icon alone would be a riddle: crop mode's Cancel · Reset · Done, a
   * tap-and-hold's Paste or Unlock.
   */
  showLabel?: boolean;
  /**
   * How it shows in the "…" menu: a `row` (icon and label, the default), a
   * `tile` in the strip across the top (icon over label), or `none`.
   */
  menu?: "row" | "tile" | "none";
  /** Draw a row of colour swatches instead of a button (menu only). */
  swatches?: ActionSwatches;
  run?: () => void;
}

export type BarItem =
  { kind: "action"; action: SelectionAction } | { kind: "divider" } | { kind: "more" };

export type MenuRow = { kind: "action"; action: SelectionAction } | { kind: "divider" };

export interface MenuLayout {
  tiles: SelectionAction[];
  rows: MenuRow[];
}

/** Whether an entry can be used. */
export function isEnabled(action: SelectionAction): boolean {
  return action.enabled !== false;
}

function menuPlacement(action: SelectionAction): "row" | "tile" | "none" {
  return action.menu ?? "row";
}

/** Group names in the order they first appear. */
function groupOrder(
  actions: readonly SelectionAction[],
  groupOf: (action: SelectionAction) => string,
): string[] {
  const order: string[] = [];
  for (const action of actions) if (!order.includes(groupOf(action))) order.push(groupOf(action));
  return order;
}

const barGroup = (action: SelectionAction): string => action.group;
const menuGroup = (action: SelectionAction): string => action.menuGroup ?? action.group;

/** `items` of each group in group order, with a divider between non-empty groups. */
function grouped<T extends { kind: string }>(
  actions: readonly SelectionAction[],
  groupOf: (action: SelectionAction) => string,
  keep: (action: SelectionAction) => boolean,
  wrap: (action: SelectionAction) => T,
  divider: T,
): T[] {
  const out: T[] = [];
  for (const group of groupOrder(actions, groupOf)) {
    const members = actions.filter((a) => groupOf(a) === group && keep(a));
    if (members.length === 0) continue;
    if (out.length > 0) out.push(divider);
    for (const action of members) out.push(wrap(action));
  }
  return out;
}

/**
 * What the bar shows, left to right: its entries by group with dividers
 * between groups, then "…" when the menu has anything in it. "…" joins the
 * last group, as in GoodNotes, where it follows Delete without a divider.
 */
export function barItems(actions: readonly SelectionAction[]): BarItem[] {
  const items = grouped<BarItem>(
    actions,
    barGroup,
    (a) => a.bar === true && !a.swatches,
    (action) => ({ kind: "action", action }),
    { kind: "divider" },
  );
  if (actions.some((a) => menuPlacement(a) !== "none")) items.push({ kind: "more" });
  return items;
}

/** What the "…" menu shows: its tiles across the top, then its rows by group. */
export function menuLayout(actions: readonly SelectionAction[]): MenuLayout {
  return {
    tiles: actions.filter((a) => menuPlacement(a) === "tile" && !a.swatches),
    rows: grouped<MenuRow>(
      actions,
      menuGroup,
      (a) => menuPlacement(a) === "row",
      (action) => ({ kind: "action", action }),
      { kind: "divider" },
    ),
  };
}

/**
 * Everything about a list of entries that changes what is drawn. The bar is
 * rebuilt only when this changes, not on every zoom frame that re-places it.
 */
export function actionsKey(actions: readonly SelectionAction[]): string {
  return JSON.stringify(
    actions.map((a) => [
      a.id,
      a.icon,
      a.label,
      a.group,
      a.menuGroup ?? null,
      isEnabled(a),
      a.destructive === true,
      a.bar === true,
      a.showLabel === true,
      menuPlacement(a),
      a.swatches ? [a.swatches.colors, a.swatches.current] : null,
    ]),
  );
}

export interface FloatOptions {
  /** Space between the anchor (plus its clearance) and the floating element. */
  gap: number;
  /** Least distance kept from the visible area's edges. */
  margin: number;
  /** Extra room kept above the anchor (a handle that sticks out), and below it. */
  clearAbove?: number;
  clearBelow?: number;
  /** Which side to try first. Default above. */
  prefer?: "above" | "below";
}

/**
 * Where to put something `size` big next to `anchor`, all in one coordinate
 * space: centred on the anchor, on the preferred side when it fits inside
 * `visible`, else on the other side, else — the anchor fills the screen —
 * pinned inside the visible area on the preferred side. Horizontally it
 * slides to stay on screen. Returns the top-left corner and the side used.
 */
export function placeFloating(
  anchor: Bounds,
  size: { w: number; h: number },
  visible: Bounds,
  options: FloatOptions,
): { x: number; y: number; below: boolean } {
  const { gap, margin } = options;
  const clearAbove = options.clearAbove ?? 0;
  const clearBelow = options.clearBelow ?? 0;
  const cx = (anchor.minX + anchor.maxX) / 2;
  const minX = visible.minX + margin;
  const x = clamp(cx - size.w / 2, minX, Math.max(minX, visible.maxX - margin - size.w));

  const top = visible.minY + margin;
  const bottom = visible.maxY - margin;
  const above = anchor.minY - clearAbove - gap - size.h;
  const below = anchor.maxY + clearBelow + gap;
  const fitsAbove = above >= top;
  const fitsBelow = below + size.h <= bottom;
  const preferBelow = options.prefer === "below";
  if (preferBelow ? fitsBelow : fitsAbove) {
    return { x, y: preferBelow ? below : above, below: preferBelow };
  }
  if (preferBelow ? fitsAbove : fitsBelow) {
    return { x, y: preferBelow ? above : below, below: !preferBelow };
  }
  const y = clamp(preferBelow ? below : above, top, Math.max(top, bottom - size.h));
  return { x, y, below: preferBelow };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
