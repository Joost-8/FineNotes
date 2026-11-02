/**
 * Every slider is dragged by its own pointer events (FineNotes discussion
 * #107): a press anywhere on the bar puts the knob there, and it follows the
 * finger, Pencil or mouse until lifted (a press on the knob takes it where
 * it is, without a jump), firing `input` at each step and
 * `change` once at the end, as the browser's own slider does.
 *
 * Left to WebKit, a slider on the iPad only took a drag that started on its
 * 16 px knob, and a finger that rested a moment before moving was taken for
 * a long press and the drag went nowhere ("only sometimes"). So `touchstart`
 * is cancelled, as the page cancels it for the Pencil, and Obsidian's swipe
 * recogniser is told to leave the slider alone (`data-ignore-swipe`).
 */

import { rangeKnobX, rangeValueAt } from "./range-fill";

/**
 * The knob's width, as styles.css draws it. Not read from the page: WebKit
 * on the iPad answers `getComputedStyle(range, "::-webkit-slider-thumb")`
 * with the whole input's width, which left the knob no travel, and every
 * press snapped to min or max.
 */
const KNOB_PX = 16;

/** A press this close to the knob's centre takes the knob where it is, px. */
const GRAB_PX = 22;

/** Make `range` follow a press anywhere on its bar. Call it once per slider. */
export function dragRange(range: HTMLInputElement): void {
  range.dataset.ignoreSwipe = "true";
  range.addEventListener(
    "touchstart",
    (event) => {
      if (!range.disabled) event.preventDefault();
    },
    { passive: false },
  );

  let held: number | null = null;
  let startValue = "";
  /** How far from the knob's centre the press took it, so it does not jump. */
  let grab = 0;

  const moveTo = (x: number): void => {
    const box = range.getBoundingClientRect();
    const step = range.step === "any" ? 0 : Number(range.step || 1);
    const value = rangeValueAt(
      x,
      box.left,
      box.width,
      Number(range.min || 0),
      Number(range.max || 100),
      step,
      KNOB_PX,
    );
    const next = String(value);
    if (next === range.value) return;
    range.value = next;
    range.dispatchEvent(new Event("input", { bubbles: true }));
  };

  range.addEventListener("pointerdown", (event) => {
    if (range.disabled || held !== null || event.button !== 0) return;
    event.preventDefault();
    held = event.pointerId;
    startValue = range.value;
    const box = range.getBoundingClientRect();
    const knobX = rangeKnobX(
      Number(range.value),
      box.left,
      box.width,
      Number(range.min || 0),
      Number(range.max || 100),
      KNOB_PX,
    );
    // On the knob: it is held where it was touched. Elsewhere: it comes to the press.
    grab = Math.abs(event.clientX - knobX) <= GRAB_PX ? event.clientX - knobX : 0;
    try {
      range.setPointerCapture(event.pointerId);
    } catch {
      // A pointer the browser does not know (a synthetic one) cannot be captured.
    }
    moveTo(event.clientX - grab);
  });
  range.addEventListener("pointermove", (event) => {
    if (event.pointerId === held) moveTo(event.clientX - grab);
  });
  const end = (event: PointerEvent): void => {
    if (event.pointerId !== held) return;
    held = null;
    if (range.hasPointerCapture(event.pointerId)) range.releasePointerCapture(event.pointerId);
    if (range.value !== startValue) range.dispatchEvent(new Event("change", { bubbles: true }));
  };
  range.addEventListener("pointerup", end);
  range.addEventListener("pointercancel", end);
}
