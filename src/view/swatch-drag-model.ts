/**
 * The pen pill's colour row as geometry (PURE): where it fades, how far it
 * scrolls to show a swatch, and when a held swatch has been dragged off the
 * pill (which removes it, as an app leaves the Dock). `swatch-drag.ts` is the
 * input and the drawing.
 */

/** A box in client px. */
export interface ClientBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** How far past the pill a held swatch must be let go to leave the row, CSS px. */
export const OFF_BAR_PX = 28;

/** Whether a swatch let go at (`x`, `y`) has left the pill `bar`. */
export function offBar(bar: ClientBox, x: number, y: number, margin = OFF_BAR_PX): boolean {
  return (
    x < bar.left - margin ||
    x > bar.right + margin ||
    y < bar.top - margin ||
    y > bar.bottom + margin
  );
}

/** Which ends of a scrolled row hide more colours, and so fade. Half a px is rounding. */
export function hiddenEnds(
  scrollLeft: number,
  clientWidth: number,
  scrollWidth: number,
): { start: boolean; end: boolean } {
  return {
    start: scrollLeft > 0.5,
    end: scrollLeft + clientWidth < scrollWidth - 0.5,
  };
}

/**
 * The scroll that shows the item at [`itemLeft`, `itemLeft + itemWidth`]
 * (offsets inside the row) with as little movement as possible, keeping
 * `inset` px clear of a faded edge. Unchanged when it already shows.
 */
export function scrollToShow(
  scrollLeft: number,
  clientWidth: number,
  itemLeft: number,
  itemWidth: number,
  inset = 0,
): number {
  const start = itemLeft - inset;
  const end = itemLeft + itemWidth + inset;
  if (start < scrollLeft) return Math.max(0, start);
  if (end > scrollLeft + clientWidth) return end - clientWidth;
  return scrollLeft;
}
