/**
 * Whether the view is moving, for work that should wait until it rests.
 * Pure: the caller passes the clock and owns any timer.
 *
 * Zoomed in on a PDF, each frame of a pan shows a new area, and rendering
 * that area in detail every frame (and cancelling the last) cost 143-214
 * pdf.js renders in a two-flick pan in the PDF harness, and four times the
 * dropped frames of 1.0.3. So detail waits until the view has been still for
 * `REST_MS`: one render, once.
 */

/** How long the view must stay still before it counts as resting, ms. */
export const REST_MS = 150;

export interface ViewPlace {
  x: number;
  y: number;
  zoom: number;
}

export class ViewRest {
  private movedAt = -Infinity;
  private last: ViewPlace | null = null;

  /**
   * Record one frame: where the view is, and whether something is moving it
   * (a finger, a fling, a pinch). Position and zoom are compared too, so a
   * wheel scroll counts though nothing animates. Returns whether it moved.
   */
  note(place: ViewPlace, busy: boolean, t: number): boolean {
    const last = this.last;
    const moved =
      busy || last === null || last.x !== place.x || last.y !== place.y || last.zoom !== place.zoom;
    this.last = { ...place };
    if (moved) this.movedAt = t;
    return moved;
  }

  /** Whether the view moved less than `REST_MS` before `t`. */
  moving(t: number): boolean {
    return t - this.movedAt < REST_MS;
  }
}
