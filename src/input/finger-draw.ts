/**
 * Drawing with a finger while the Pencil is away (discussion #107, point 9).
 *
 * The Pencil's battery runs out mid-lecture; until it writes again, one
 * finger writes with the tool in hand and two fingers pan and pinch, as
 * Notability's "Disconnect Apple Pencil" does. It is a mode, not a setting:
 * the first event from a pen ends it, so a Pencil that is charged again
 * simply writes and the fingers scroll as before.
 *
 * Palm rejection is off while it is on. A finger and a palm both arrive as
 * `touch` and nothing here can tell one from the other, so a palm that lands
 * alone writes as any finger would. What the mode does keep from the usual
 * rules: once a finger writes, every other touch is the hand beside it and
 * plays no part, as a palm beside the Pencil does (`palm-rejection.ts`).
 *
 * A lone finger cannot be told from the first finger of a pan or a pinch
 * when it lands, so it waits {@link FINGER_JOIN_MS} for a partner before it
 * writes. Its samples are kept meanwhile and drawn when it starts, so the
 * wait costs a moment's delay, never ink. A finger that lifts first was a
 * tap, and taps as the pen would.
 */

/** How long (ms) a lone finger waits for a second one before it writes. */
export const FINGER_JOIN_MS = 100;

/**
 * What a touch landing in finger drawing is for:
 *
 * - `wait`: a lone finger, held back until it writes or a second one joins;
 * - `pair`: the second finger beside a waiting one: the two pan and pinch;
 * - `finger`: one more finger for a pan or pinch already under way;
 * - `ignore`: the hand beside a finger that is writing.
 */
export type FingerDrawRole = "wait" | "pair" | "finger" | "ignore";

/** What is already on the glass when a touch lands. */
export interface FingerDrawState {
  /** A finger is waiting to write ({@link FINGER_JOIN_MS}). */
  waiting: boolean;
  /** Fingers are panning or pinching. */
  gesture: boolean;
  /** A stroke is open (a finger is writing, or a mouse is). */
  stroke: boolean;
}

/** The role of a touch going down while fingers draw. */
export function fingerDrawRole(state: FingerDrawState): FingerDrawRole {
  if (state.waiting) return "pair";
  if (state.gesture) return "finger";
  if (state.stroke) return "ignore";
  return "wait";
}

/**
 * Whether a finger that has waited `heldMs` (from landing to the event in
 * hand) writes now: once the wait is over, or as soon as it lifts.
 */
export function fingerWrites(heldMs: number, lifted: boolean): boolean {
  return lifted || heldMs >= FINGER_JOIN_MS;
}

/** Whether an event from a pointer of this type ends finger drawing: any from the pen does. */
export function endsFingerDrawing(pointerType: string): boolean {
  return pointerType === "pen";
}
