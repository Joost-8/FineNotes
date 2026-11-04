/**
 * Putting a page's text lines in reading order: a recursive XY cut. A band
 * of the page that no line crosses splits it; columns are split off first
 * (a gutter at least {@link GUTTER} line heights wide), so a two-column
 * page reads down the left column, then the right, while a headline across
 * both columns comes before either. What cannot be cut reads top to bottom.
 *
 * Lines are compared in the page's own tilt: a page scanned crooked is
 * turned back by the lines' median angle first, and each line counts only
 * as the middle half of its height, so tight lines do not touch.
 *
 * PURE: no DOM, no Obsidian.
 */

import type { TextBox } from "./db";

/** A gutter this many line heights wide (the median) separates columns. */
export const GUTTER = 1.5;

interface Placed {
  box: TextBox;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)];
}

/**
 * Split `items` along an axis where nothing covers a band: at every band at
 * least `gap` wide (`all`), or at the widest one only.
 */
function split(items: Placed[], axis: "x" | "y", gap: number, all: boolean): Placed[][] {
  const lo = axis === "x" ? "x0" : "y0";
  const hi = axis === "x" ? "x1" : "y1";
  const sorted = [...items].sort((a, b) => a[lo] - b[lo]);
  // Where each band opens (the index of the item after it) and how wide it is.
  const bands: { at: number; width: number }[] = [];
  let reach = sorted[0][hi];
  for (let i = 1; i < sorted.length; i++) {
    const width = sorted[i][lo] - reach;
    if (width > gap) bands.push({ at: i, width });
    reach = Math.max(reach, sorted[i][hi]);
  }
  if (bands.length === 0) return [sorted];
  const cuts = all ? bands : [bands.reduce((best, b) => (b.width > best.width ? b : best))];
  const groups: Placed[][] = [];
  let from = 0;
  for (const cutAt of cuts) {
    groups.push(sorted.slice(from, cutAt.at));
    from = cutAt.at;
  }
  groups.push(sorted.slice(from));
  return groups;
}

function cut(items: Placed[], gutter: number): Placed[] {
  if (items.length < 2) return items;
  const columns = split(items, "x", gutter, true);
  if (columns.length > 1) return columns.flatMap((c) => cut(c, gutter));
  // Across the widest band first: a headline comes off before the columns below it.
  const rows = split(items, "y", 0, false);
  if (rows.length > 1) return rows.flatMap((r) => cut(r, gutter));
  return [...items].sort((a, b) => a.box.cy - b.box.cy || a.box.cx - b.box.cx);
}

/** The boxes in reading order. */
export function readingOrder(boxes: readonly TextBox[]): TextBox[] {
  if (boxes.length < 2) return [...boxes];
  const tilt = median(boxes.map((b) => b.angle));
  const cos = Math.cos(-tilt);
  const sin = Math.sin(-tilt);
  const gutter = GUTTER * median(boxes.map((b) => b.h));
  const placed: Placed[] = boxes.map((box) => {
    const x = box.cx * cos - box.cy * sin;
    const y = box.cx * sin + box.cy * cos;
    const hh = box.h / 4;
    return { box, x0: x - box.w / 2, x1: x + box.w / 2, y0: y - hh, y1: y + hh };
  });
  return cut(placed, gutter).map((p) => p.box);
}
