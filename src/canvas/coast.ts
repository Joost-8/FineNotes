/**
 * The last pixels of a page turn. A turn settles on a critically damped
 * spring, which spends about a third of its time within a few px of where it
 * ends: the page moves a px or two a frame, and nothing new comes into view.
 * The pages the next swipe turns to were made only once the spring had
 * stopped, half a second after the finger lifted, so turning one page after
 * another left under 100 ms for it and the next page's ink was still being
 * drawn during the turn (FineNotes#201: 27-33 tiles made mid-turn over six
 * turns 0.6 s apart, none at 1.5 s).
 *
 * While the view coasts, a frame may make those tiles: a frame that runs
 * long there moves the page a px late, which nobody sees, where the same
 * tile made mid-turn is a missed frame at the turn's full speed.
 *
 * PURE: no DOM, no Obsidian.
 */

/**
 * A view this close to where its snap or glide ends is coasting, CSS px. At
 * 8 px the turn's spring moves about 2 px a 60 Hz frame and 1 px a 120 Hz
 * one, and it has about 170 ms left of a turn's 540.
 */
export const COAST_PX = 8;

/**
 * And no faster than this, px/ms. Near is not slow: a swipe let go fast and
 * close to the next page carries the spring past its end, through these 8 px
 * at 1 to 5 px/ms, and that frame is the middle of the turn. The spring
 * settling into the 8 px from either side never passes 0.15 (its rate times
 * the distance); 0.2 is 3.3 px a 60 Hz frame.
 */
export const COAST_SPEED = 0.2;

/** What a frame knows when it asks whether it may make tiles ahead. */
export interface CoastFrame {
  /** `KineticScroller.remaining`: px left to the snap's end, or `null`. */
  remaining: number | null;
  /** `KineticScroller.speed`, px/ms. */
  speed: number;
  /** The frame's own paint found every tile it needed. */
  complete: boolean;
  /** A finger, a pinch or the pen is on the page. */
  held: boolean;
  /** The zoom is changing, or something else moves the view besides the scroller. */
  zooming: boolean;
  /** A PDF is behind a page it would make tiles of. */
  pdf: boolean;
}

/**
 * Whether this frame may spend a prefetch budget: the view is on its way to
 * a known place, nearly there and slow, nothing else moves it, nobody is
 * touching it, and the paint left nothing undone that the budget should go
 * to first.
 *
 * Never over a PDF: its pages are drawn by a worker and land when they are
 * done, and everything about them waits for the view to rest. Measured on
 * the iPad with a 1,114-page book kept as a tab, read slide by slide: the
 * tiles were ready in time either way (none made mid-glide), and with this
 * on 22-29 frames of 830 ran late against 18-26 without. Nothing to gain
 * there, so a PDF's pages are made at rest, as before.
 */
export function coasting(frame: CoastFrame): boolean {
  if (frame.held || frame.zooming || frame.pdf || !frame.complete) return false;
  if (frame.remaining === null || frame.remaining > COAST_PX) return false;
  return frame.speed <= COAST_SPEED;
}
