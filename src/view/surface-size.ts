/**
 * Two decisions about sizing the drawing surface's canvases: how many
 * device pixels back each CSS pixel, and how long to wait for a pane that
 * has not been given a size yet.
 *
 * Pure: no DOM, no Obsidian.
 */

/**
 * The most device pixels per CSS pixel the canvases are backed at: a cap on
 * memory, since each of the three pane-sized canvases grows with the square
 * of it.
 */
export const MAX_BACKING_SCALE = 3;

/** The backing scale for a screen's `devicePixelRatio`: 1 when it reports none. */
export function backingScale(devicePixelRatio: number | undefined): number {
  if (devicePixelRatio === undefined || !(devicePixelRatio > 0)) return 1;
  return Math.min(devicePixelRatio, MAX_BACKING_SCALE);
}

/**
 * Frames a layout is retried for while the pane measures zero. When a note
 * first opens, the view may not be attached or measured yet, and canvases
 * sized then stay blank until something lays them out again. Anything
 * slower than this reaches the surface as a resize anyway.
 */
export const SIZE_WAIT_FRAMES = 60;

/**
 * `layout` now; `retry` on the next frame; `wait` for the resize observer,
 * the retries being spent.
 */
export type SizeCheck = "layout" | "retry" | "wait";

/** The bounded wait for a pane with no size. */
export class SizeWait {
  private retries = 0;

  constructor(private readonly maxRetries = SIZE_WAIT_FRAMES) {}

  /** The pane measured `width` × `height`. A pane that has a size resets the wait. */
  check(width: number, height: number): SizeCheck {
    if (width > 0 && height > 0) {
      this.retries = 0;
      return "layout";
    }
    if (this.retries >= this.maxRetries) return "wait";
    this.retries += 1;
    return "retry";
  }
}
