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
