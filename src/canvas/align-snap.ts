/**
 * Alignment while a selection is moved, as Goodnotes does it
 * (research/goodnotes-shapes-2026-11-08.md): the selection's bounding box
 * lines up with the other items on the page when one of its lines comes
 * within a few screen px of one of theirs, and a guide shows each line it
 * lines up on.
 *
 * - **Lines.** Across: left, centre and right; down: top, middle and bottom.
 *   An edge snaps to any edge (a right edge onto a neighbour's left edge
 *   too); a centre only to a centre.
 * - **Axes apart.** Each axis snaps on its own, to its nearest line within
 *   the radius, so a box can line up across with one item and down with
 *   another at once.
 * - **Guides.** After the snap, every line of the box that meets a line of
 *   a target gets a guide: across all the boxes on it, overshooting each end
 *   a little. Edges are drawn solid, centres dashed with a dot at the box's
 *   centre (the caller draws them).
 * - **Targets** are the caller's: Goodnotes' are the page's shapes and
 *   objects, not its handwriting (the handwriting being moved is snapped,
 *   but a line of writing is not something to snap to).
 *
 * PURE: no DOM. Everything is page px; the caller turns its screen-px radius
 * and overshoot into page px at the current zoom.
 */

export interface AlignBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Snap within this many screen px: Goodnotes snapped at 10 and let go at 12. */
export const ALIGN_SNAP_PX = 10;

/** How far a guide runs past the boxes it joins, screen px (Goodnotes' ≈ 12). */
export const ALIGN_GUIDE_OVERSHOOT_PX = 12;

/** One guide: a line at `at` on `axis` ("x": an upright line at x = at), from `from` to `to`. */
export interface AlignGuide {
  axis: "x" | "y";
  at: number;
  from: number;
  to: number;
  /** A centre line (drawn dashed), not an edge. */
  centre: boolean;
}

export interface AlignResult {
  /** The move after snapping. */
  dx: number;
  dy: number;
  guides: AlignGuide[];
  /** The moved box's centre, when a centre guide shows (Goodnotes marks it with a dot). */
  dot: { x: number; y: number } | null;
}

/** Lines closer than this, page px, count as the same line when the guides are found. */
const SAME = 0.01;

type Axis = "x" | "y";

/** A box's three lines on an axis: low edge, centre, high edge. */
function linesOf(box: AlignBox, axis: Axis): [number, number, number] {
  const lo = axis === "x" ? box.minX : box.minY;
  const hi = axis === "x" ? box.maxX : box.maxY;
  return [lo, (lo + hi) / 2, hi];
}

/** Its extent across the other axis. */
function spanOf(box: AlignBox, axis: Axis): [number, number] {
  return axis === "x" ? [box.minY, box.maxY] : [box.minX, box.maxX];
}

function shifted(box: AlignBox, dx: number, dy: number): AlignBox {
  return { minX: box.minX + dx, minY: box.minY + dy, maxX: box.maxX + dx, maxY: box.maxY + dy };
}

function usable(box: AlignBox): boolean {
  return (
    Number.isFinite(box.minX) &&
    Number.isFinite(box.minY) &&
    Number.isFinite(box.maxX) &&
    Number.isFinite(box.maxY) &&
    box.maxX >= box.minX &&
    box.maxY >= box.minY
  );
}

/**
 * The shift on `axis` that brings the nearest of `moved`'s lines onto a
 * target's within `radius`, or 0 when none is that close. An edge pairs
 * with an edge, a centre with a centre.
 */
function snapAxis(
  moved: AlignBox,
  targets: readonly AlignBox[],
  axis: Axis,
  radius: number,
): number {
  const own = linesOf(moved, axis);
  let best = 0;
  let bestDistance = radius;
  let found = false;
  for (const target of targets) {
    const theirs = linesOf(target, axis);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        if ((i === 1) !== (j === 1)) continue;
        const shift = theirs[j] - own[i];
        const distance = Math.abs(shift);
        if (distance < bestDistance || (!found && distance <= radius)) {
          best = shift;
          bestDistance = distance;
          found = true;
        }
      }
    }
  }
  return found ? best : 0;
}

/** The guides on `axis` for a box already snapped: one per line of it that meets a target's. */
function guidesOn(
  moved: AlignBox,
  targets: readonly AlignBox[],
  axis: Axis,
  overshoot: number,
): AlignGuide[] {
  const own = linesOf(moved, axis);
  const out: AlignGuide[] = [];
  for (let i = 0; i < 3; i++) {
    const at = own[i];
    const centre = i === 1;
    let [from, to] = spanOf(moved, axis);
    let met = false;
    for (const target of targets) {
      const theirs = linesOf(target, axis);
      const meets = centre
        ? Math.abs(theirs[1] - at) <= SAME
        : Math.abs(theirs[0] - at) <= SAME || Math.abs(theirs[2] - at) <= SAME;
      if (!meets) continue;
      met = true;
      const [lo, hi] = spanOf(target, axis);
      from = Math.min(from, lo);
      to = Math.max(to, hi);
    }
    if (met) out.push({ axis, at, from: from - overshoot, to: to + overshoot, centre });
  }
  return out;
}

/**
 * Snap a selection whose bounds were `box` before a move of (`dx`, `dy`)
 * to `targets`, within `radius` page px, and say which guides to draw
 * (running `overshoot` page px past their ends).
 */
export function alignMove(
  box: AlignBox,
  dx: number,
  dy: number,
  targets: readonly AlignBox[],
  radius: number,
  overshoot = 0,
): AlignResult {
  const none: AlignResult = { dx, dy, guides: [], dot: null };
  if (!usable(box) || !Number.isFinite(dx) || !Number.isFinite(dy) || !(radius > 0)) return none;
  const live = targets.filter(usable);
  if (live.length === 0) return none;
  const moved = shifted(box, dx, dy);
  const sx = snapAxis(moved, live, "x", radius);
  const sy = snapAxis(moved, live, "y", radius);
  const snapped = shifted(moved, sx, sy);
  const guides = [
    ...guidesOn(snapped, live, "x", overshoot),
    ...guidesOn(snapped, live, "y", overshoot),
  ];
  const dot = guides.some((g) => g.centre)
    ? { x: (snapped.minX + snapped.maxX) / 2, y: (snapped.minY + snapped.maxY) / 2 }
    : null;
  return { dx: dx + sx, dy: dy + sy, guides, dot };
}
