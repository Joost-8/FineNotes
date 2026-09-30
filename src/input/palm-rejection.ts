/**
 * Which pointer writes and which scrolls: the pen-versus-finger rules.
 *
 * Anything that is not a finger writes: the Pencil, a mouse or trackpad, or
 * a pointer type the browser does not name. It writes at once, whatever the
 * fingers were doing.
 *
 * While a stroke is open, a finger that lands is the side of the writing hand
 * resting on the glass, so it plays no part. It stays out after the pen lifts
 * too, because the gesture only follows fingers it took in when they landed
 * (`finger-gesture.ts`).
 *
 * Every other touch scrolls or pinches. A palm that lands before the pen may
 * move the page a little; when the pen then lands the surface puts the page
 * back ({@link undoesPalm}). Ignoring touches outright was tried
 * (2026-09-30: any touch within 700 ms of the pen, or wider than a
 * fingertip) and left pinches and swipes dead now and then, since a touch
 * left out stays out until it lifts.
 */

/** What a pointer that has just gone down is for. */
export type PointerRole = "draw" | "finger" | "ignore";

/**
 * The role of a pointer going down, from its `PointerEvent.pointerType` and
 * whether a stroke is still open.
 */
export function roleOf(pointerType: string, strokeOpen: boolean): PointerRole {
  if (pointerType !== "touch") return "draw";
  return strokeOpen ? "ignore" : "finger";
}

/** A scroll that the pen interrupts within this long (ms) of its start is undone. */
export const PALM_UNDO_MS = 1500;

/** A scroll that the pen interrupts having moved at most this far (screen px) is undone. */
export const PALM_UNDO_PX = 120;

/**
 * Whether a finger scroll that a landing pen has just voided was the palm,
 * so the page goes back to where it was when the touch landed. Nobody
 * scrolls and writes at once: a touch still down when the pen lands is the
 * writing hand, unless it has plainly been scrolling for a while and far.
 */
export function undoesPalm(elapsedMs: number, movedPx: number): boolean {
  return elapsedMs <= PALM_UNDO_MS || movedPx <= PALM_UNDO_PX;
}
