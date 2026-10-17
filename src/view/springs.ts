/**
 * The chrome's house springs, as CSS `linear()` easings.
 *
 * Apple describes a spring by a perceived duration and a bounce (WWDC23
 * "Animate with springs"): with mass 1, stiffness = (2π / duration)² and
 * damping = 4π(1 − bounce) / duration, which makes the damping ratio
 * exactly 1 − bounce. Bounce 0 is smooth and the default; about 0.15 is
 * brisk. CSS cannot run a spring, but `linear()` can trace one point by
 * point, overshoot included (Baseline since December 2023; Safari 17.2).
 * The strings are precomputed here and copied into styles.css's tokens,
 * which a test keeps equal; the toolbar's Web Animations use them too.
 *
 * PURE: numbers and strings only.
 */

/** A spring as Apple specifies one: perceived duration (s) and bounce (0 to <1). */
export interface Spring {
  duration: number;
  bounce: number;
}

/** A popover growing from its anchor: smooth, no bounce. */
export const POPOVER_IN: Spring = { duration: 0.3, bounce: 0 };
/** A popover closing: quicker than it opened. */
export const POPOVER_OUT: Spring = { duration: 0.2, bounce: 0 };
/** The selected-tool indicator sliding between buttons: a touch of bounce. */
export const TOOL_INDICATOR: Spring = { duration: 0.35, bounce: 0.1 };

/** The fallbacks where `linear()` is unsupported: styles.css's --gob-ease-out and --gob-spring. */
export const EASE_OUT_FALLBACK = "cubic-bezier(0.25, 0.8, 0.3, 1)";
export const SPRING_FALLBACK = "cubic-bezier(0.34, 1.56, 0.64, 1)";

/**
 * How close to rest (a share of the travel) counts as settled. Half a
 * percent: a 100 px slide ends within half a pixel, and a 0.3 s spring
 * runs about 0.36 s.
 */
const SETTLED = 0.005;
/** `linear()` stops per second of animation: one a frame at 60 Hz. */
const STOPS_PER_SECOND = 60;

/** The spring's position at `t` seconds, from 0 at rest to 1 at its target. */
export function springAt(spring: Spring, t: number): number {
  if (t <= 0) return 0;
  const omega = (2 * Math.PI) / spring.duration;
  const zeta = 1 - clampBounce(spring.bounce);
  if (zeta >= 1) return 1 - (1 + omega * t) * Math.exp(-omega * t);
  const damped = omega * Math.sqrt(1 - zeta * zeta);
  const decay = Math.exp(-zeta * omega * t);
  return 1 - decay * (Math.cos(damped * t) + ((zeta * omega) / damped) * Math.sin(damped * t));
}

/**
 * When the spring settles, in seconds: the last moment it is further than
 * {@link SETTLED} from its target. This is the animation's real length;
 * the perceived duration is shorter.
 */
export function settleTime(spring: Spring): number {
  const step = 0.001;
  const end = spring.duration * 6;
  let last = 0;
  for (let t = 0; t <= end; t += step) {
    if (Math.abs(1 - springAt(spring, t)) > SETTLED) last = t;
  }
  return Math.round((last + step) * 1000) / 1000;
}

/** {@link settleTime} in whole milliseconds, for a Web Animation or a timer. */
export function springMs(spring: Spring): number {
  return Math.round(settleTime(spring) * 1000);
}

/**
 * The spring as a CSS easing: `linear()` with evenly spaced stops over its
 * {@link settleTime}, the last one exactly 1. Run it for {@link springMs}.
 */
export function springEasing(spring: Spring): string {
  const length = settleTime(spring);
  const stops = Math.max(2, Math.ceil(length * STOPS_PER_SECOND) + 1);
  const values: string[] = [];
  for (let i = 0; i < stops; i++) {
    const value = i === stops - 1 ? 1 : springAt(spring, (length * i) / (stops - 1));
    values.push(String(Math.round(value * 1000) / 1000));
  }
  return `linear(${values.join(", ")})`;
}

/** Bounce outside 0 to 0.95 would not settle (or would not move); keep it inside. */
function clampBounce(bounce: number): number {
  if (!Number.isFinite(bounce)) return 0;
  return Math.min(0.95, Math.max(0, bounce));
}
