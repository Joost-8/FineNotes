/**
 * Shared timings for the chrome's motion, and the one question every
 * animation asks first. The numbers are GoodNotes', measured frame by frame
 * (research/goodnotes-smoothness): short, and only on chrome — the page
 * itself never animates into place except by gliding.
 */

import { type Spring, springEasing } from "./springs";

/** The page sidebar sliding in or out, and the page gliding beside it. */
export const PANEL_SLIDE_MS = 200;

/** Whether the person asked the system for less motion. */
export function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** Whether this browser runs CSS `linear()` easings (Safari 17.2, Chrome 113). */
let linearEasing: boolean | null = null;

/**
 * `spring` as an easing this browser can run, for a Web Animation: the
 * `linear()` trace (`springs.ts`), else `fallback`, one of the old
 * cubic-bézier tokens.
 */
export function springCurve(spring: Spring, fallback: string): string {
  linearEasing ??=
    typeof CSS !== "undefined" &&
    typeof CSS.supports === "function" &&
    CSS.supports("transition-timing-function", "linear(0, 1)");
  return linearEasing ? springEasing(spring) : fallback;
}
