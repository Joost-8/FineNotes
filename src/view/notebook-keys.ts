/** A view-specific Obsidian scope keeps notebook keys ahead of application hotkeys. */
import { Scope } from "obsidian";

export function notebookKeyScope(
  root: HTMLElement,
  parent: Scope,
  active: () => boolean,
  handle: (event: KeyboardEvent) => boolean,
): Scope {
  const doc = root.ownerDocument;
  const scope = new Scope(parent);
  scope.register(null, null, (event) => {
    if (!active() || event.defaultPrevented || event.isComposing) return;
    // Other panes and host menus keep their own keyboard handling.
    if (doc.querySelector(".modal-container, .menu")) return;
    const target = event.target;
    if (
      target !== doc.defaultView &&
      target !== doc &&
      target !== doc.body &&
      !root.contains(target as Node)
    )
      return;
    if (!handle(event)) return;
    // A defined result stops the parent scope. Unlike false, true leaves the
    // browser default intact when needed (notably the native paste event),
    // and lets the key go on through the page: Obsidian's keymap listens on
    // the window in the capture phase, so stopping it here would keep it from
    // the popovers that close on Escape from their own keydown listeners
    // (image menu, AI menu, more panel, template picker, toolbar).
    return true;
  });
  return scope;
}
