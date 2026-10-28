/**
 * The press that closes a tool bar popover, by landing outside it. On the
 * page, a pen or the mouse's main button would write (or erase, or lasso)
 * as the popover goes, so that press does nothing more: the popover closes,
 * and the next press writes. A finger only scrolls the page, so it goes on
 * scrolling; a press anywhere else (the sidebar, a button) goes on to what
 * it landed on, as it always did.
 *
 * Pure: no DOM, no Obsidian.
 */

/** The parts of a `PointerEvent` this module reads. */
export interface ClosingPress {
  pointerType: string;
  /** The button that went down (0 contact or the main one, 2 barrel or right). */
  button: number;
}

/** Whether the press that closes a popover stops there, rather than going on to the page. */
export function closingPressStops(press: ClosingPress, onPage: boolean): boolean {
  if (!onPage) return false;
  if (press.pointerType === "pen") return true;
  return press.pointerType === "mouse" && press.button === 0;
}
