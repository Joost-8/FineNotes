/**
 * Where a finger may hold an upright toolbar to move it to another edge.
 *
 * Docked left or right, the bar's blank strips beside its buttons are a few
 * px wide, and Android's touch adjustment moves a press there onto the
 * nearest button, so the bar could not be grabbed with a finger. A finger
 * press this close to the bar's long sides counts as its blank space, button
 * rim or not; a press on a button's middle still drags the tool.
 */

/** How far in from an upright bar's long sides a finger holds the bar, CSS px. */
export const BAR_EDGE_HOLD_PX = 12;

export interface BarBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Whether a press at `x`, `y` holds the bar itself rather than the button under it. */
export function holdsBarEdge(
  x: number,
  y: number,
  bar: BarBox,
  upright: boolean,
  pointerType: string,
): boolean {
  if (!upright || pointerType !== "touch") return false;
  if (y < bar.top || y > bar.bottom || x < bar.left || x > bar.right) return false;
  // A bar narrower than both strips together has no middle to keep for buttons.
  if (bar.right - bar.left <= BAR_EDGE_HOLD_PX * 2) return false;
  return x < bar.left + BAR_EDGE_HOLD_PX || x > bar.right - BAR_EDGE_HOLD_PX;
}
