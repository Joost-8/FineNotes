/**
 * When a pen that lifted never really left the glass.
 *
 * On 2026-10-01 a stretch of Joost's writing came apart: the "2" of "2n²"
 * was stored as eight strokes of two to twenty points, pen-downs 4-30 ms
 * apart, each starting within 0-7 page px of where the last one ended
 * (decoded from the synced notebook). No hand lifts and lands that fast;
 * the Pencil's contact flickered, and iPadOS reported each flicker as a
 * lift and a new pen-down. Every piece was then a stroke of its own: the
 * letters got gaps and dots, a fast line got a step, and hold-to-snap saw
 * only the last piece of an arrow (a triangle).
 *
 * So a pen-down this soon after a lift, this close to where it lifted,
 * carries the stroke on. A deliberate new stroke cannot meet both: lifting
 * the Pencil and setting it down again takes far longer, and one that lands
 * where the last stroke ended within that time continues it anyway.
 */

/** A pen-down at most this long (ms) after the lift... */
export const REJOIN_MS = 50;

/** ...and at most this far (screen px) from where the pen lifted, continues the stroke. */
export const REJOIN_PX = 16;

/**
 * Whether a pen-down `downMs` after a lift, `distance` from where it lifted,
 * is the same stroke going on. `maxDistance` is {@link REJOIN_PX} in the
 * caller's units (page px at the current zoom).
 */
export function rejoinsStroke(downMs: number, distance: number, maxDistance: number): boolean {
  return downMs >= 0 && downMs <= REJOIN_MS && distance <= maxDistance;
}
