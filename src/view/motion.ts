/**
 * Shared timings for the chrome's motion, and the one question every
 * animation asks first. The numbers are GoodNotes', measured frame by frame
 * (research/goodnotes-smoothness): short, and only on chrome — the page
 * itself never animates into place except by gliding.
 */

/** The page sidebar sliding in or out, and the page gliding beside it. */
export const PANEL_SLIDE_MS = 200;

/** Whether the person asked the system for less motion. */
export function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}
