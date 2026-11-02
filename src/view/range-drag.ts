/**
 * Every slider is dragged by its own pointer events (FineNotes discussion
 * #107): a press anywhere on the bar puts the knob there, and it follows the
 * finger, Pencil or mouse until lifted, firing `input` at each step and
 * `change` once at the end, as the browser's own slider does.
 *
 * Left to WebKit, a slider on the iPad only took a drag that started on its
 * 16 px knob, and a finger that rested a moment before moving was taken for
 * a long press and the drag went nowhere ("only sometimes"). So `touchstart`
 * is cancelled, as the page cancels it for the Pencil, and Obsidian's swipe
 * recogniser is told to leave the slider alone (`data-ignore-swipe`).
 */

import { rangeValueAt } from "./range-fill";

/** The knob's width when the stylesheet does not say: ours is 16 px. */
const DEFAULT_KNOB_PX = 16;

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
  let knob = DEFAULT_KNOB_PX;

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
      knob,
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
    const shown = parseFloat(range.win.getComputedStyle(range, "::-webkit-slider-thumb").width);
    knob = Number.isFinite(shown) && shown > 0 ? shown : DEFAULT_KNOB_PX;
    try {
      range.setPointerCapture(event.pointerId);
    } catch {
      // A pointer the browser does not know (a synthetic one) cannot be captured.
    }
    moveTo(event.clientX);
  });
  range.addEventListener("pointermove", (event) => {
    if (event.pointerId === held) moveTo(event.clientX);
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
