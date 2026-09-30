/**
 * Which pointer writes and which scrolls: the pen-versus-finger rules.
 *
 * Anything that is not a finger writes: the Pencil, a mouse or trackpad, or
 * a pointer type the browser does not name. It writes at once, whatever the
 * fingers were doing.
 *
 * A touch is the side of the writing hand, not a finger that means to
 * scroll, when:
 *
 * - a stroke is open: it plays no part, and stays out after the pen lifts
 *   too, because the gesture only follows fingers it took in when they
 *   landed (`finger-gesture.ts`);
 * - the pen was on or over the glass a moment ago ({@link PEN_GRACE_MS}):
 *   between words and lines the hand lifts and lands again before the pen
 *   does, and that landing used to scroll the page (Joost, 2026-09-30). A
 *   hovering Pencil counts, where the iPad reports hover;
 * - its contact is wider than a fingertip ({@link PALM_CONTACT_PX}), where
 *   the browser reports contact size at all.
 *
 * A palm that lands before any of that applies still starts a scroll; when
 * the pen then lands the surface puts the page back ({@link undoesPalm}).
 */

/** What a pointer that has just gone down is for. */
export type PointerRole = "draw" | "finger" | "ignore";

/** Why a touch was left out, for the diagnostics HUD. */
export type PalmReason = "stroke" | "pen" | "contact";

/** How long after the pen was last seen a touch still counts as the palm, in ms. */
export const PEN_GRACE_MS = 700;

/**
 * A touch whose contact is wider than this (CSS px, the larger side) is a
 * palm. A fingertip on an iPad reports well under it; the browser reports 0
 * or 1 where it does not measure contact, which never rejects anything.
 */
export const PALM_CONTACT_PX = 80;

/** What is known about a pointer as it goes down. */
export interface PointerContext {
  /** Whether a stroke is still open. */
  strokeOpen: boolean;
  /** How long ago the pen was last down, moving, hovering or lifting, in ms; Infinity if never. */
  sincePen: number;
  /** The larger side of the contact area in CSS px; 0 when unknown. */
  contact: number;
}

/** The role of a pointer going down, and for an ignored touch, why. */
export function classify(
  pointerType: string,
  context: PointerContext,
): { role: PointerRole; reason?: PalmReason } {
  if (pointerType !== "touch") return { role: "draw" };
  if (context.strokeOpen) return { role: "ignore", reason: "stroke" };
  if (context.sincePen >= 0 && context.sincePen < PEN_GRACE_MS) {
    return { role: "ignore", reason: "pen" };
  }
  if (context.contact > PALM_CONTACT_PX) return { role: "ignore", reason: "contact" };
  return { role: "finger" };
}

/** The role of a pointer going down (see {@link classify}). */
export function roleOf(pointerType: string, context: PointerContext): PointerRole {
  return classify(pointerType, context).role;
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
