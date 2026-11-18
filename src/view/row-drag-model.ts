/**
 * Dragging a row of a short vertical list to a new place (`row-drag.ts`):
 * where it would land, and how far the rows it passes step aside.
 *
 * PURE: no DOM, no Obsidian.
 */

/**
 * The place row `from` takes when dragged with its centre at `y`: as many
 * places down as there are other rows whose centre it has passed. `centres`
 * are the rows' centres where they rest, top to bottom.
 */
export function rowSlotAt(centres: readonly number[], from: number, y: number): number {
  let to = 0;
  centres.forEach((centre, i) => {
    if (i !== from && centre < y) to++;
  });
  return to;
}

/**
 * How far row `i` steps aside while row `from` is held over place `to`:
 * up one row's pitch for a row it passed going down, down one for a row it
 * passed going up, else nothing.
 */
export function rowShift(i: number, from: number, to: number, pitch: number): number {
  if (i === from) return 0;
  if (from < to && i > from && i <= to) return -pitch;
  if (to < from && i >= to && i < from) return pitch;
  return 0;
}

/** `items` with the one at `from` moved to place `to`; unchanged for a place out of range. */
export function moveTo<T>(items: readonly T[], from: number, to: number): T[] {
  const out = [...items];
  if (from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) return out;
  const [moved] = out.splice(from, 1);
  out.splice(to, 0, moved);
  return out;
}
