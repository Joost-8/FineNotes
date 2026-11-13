/**
 * Close an Obsidian `Menu` shown over the page on a press outside it.
 * Obsidian closes a menu on a click elsewhere, but the page cancels a
 * stylus's touchstart (and a finger's under some tools), so a tap there
 * never becomes a click and the menu stays until an option is chosen. As
 * with the tool bar's popovers (popover-dismiss.ts), the pen's press that
 * closes it does not also write.
 */

import type { Menu } from "obsidian";
import { closingPressStops } from "./popover-dismiss";

/** The menu Obsidian just drew: the last `.menu` in the document. */
function shownMenu(doc: Document): HTMLElement | null {
  const menus = doc.querySelectorAll<HTMLElement>(".menu");
  return menus.length > 0 ? menus[menus.length - 1] : null;
}

/**
 * Close `menu` (already shown) at the first press outside it in `doc`.
 * `onPage` says whether a press landed on the page, where a pen's press stops.
 */
export function closeMenuOnPressOutside(
  menu: Menu,
  doc: Document,
  onPage: (target: Element) => boolean,
): void {
  const el = shownMenu(doc);
  if (!el) return;
  const win = doc.defaultView;
  if (!win) return;
  const press = (event: PointerEvent): void => {
    const target = event.target;
    if (!(target instanceof win.Element) || el.contains(target)) return;
    if (closingPressStops(event, onPage(target))) {
      event.preventDefault();
      event.stopPropagation();
    }
    menu.hide();
  };
  // Capture, so the page's own handlers (which may stop it) come after.
  win.addEventListener("pointerdown", press, true);
  menu.onHide(() => win.removeEventListener("pointerdown", press, true));
}
