/**
 * The window an element is shown in. A plugin's code runs in Obsidian's main
 * window, so its globals (`window`, `document`, `ResizeObserver`) belong to
 * that window even for a tab moved to a new window. Anything tied to painting
 * must come from the element's own window: while the main window is covered
 * its `requestAnimationFrame` stops and its `ResizeObserver`s stay silent,
 * and the page in the other window freezes with them (FineNotes#199).
 */

export type HostWindow = typeof window;

export function winOf(node: Node | null | undefined): HostWindow {
  return node?.ownerDocument?.defaultView ?? window;
}

export function docOf(node: Node | null | undefined): Document {
  return node?.ownerDocument ?? document;
}

/** The document of the window being used: where a new popover belongs. */
export function shownDoc(): Document {
  return typeof activeDocument !== "undefined" && activeDocument.body ? activeDocument : document;
}

/** Call `moved` each time `el` is carried to another window. */
export function onWindowMoved(el: HTMLElement, moved: () => void): () => void {
  if (typeof el.onWindowMigrated !== "function") return () => {};
  return el.onWindowMigrated(() => moved());
}

/** A `ResizeObserver` that reports from the window `el` is shown in now. */
export function sizeObserver(el: Node, callback: ResizeObserverCallback): ResizeObserver {
  const Observer = winOf(el).ResizeObserver ?? ResizeObserver;
  return new Observer(callback);
}

/** Watch `el`'s size for as long as it lives, in whichever window it is. */
export function watchSize(el: HTMLElement, callback: ResizeObserverCallback): () => void {
  let observer: ResizeObserver;
  const start = (): void => {
    observer = sizeObserver(el, callback);
    observer.observe(el);
  };
  start();
  const stopMoves = onWindowMoved(el, () => {
    observer.disconnect();
    start();
  });
  return () => {
    stopMoves();
    observer.disconnect();
  };
}

// A node in another window is an instance of that window's classes, so
// `instanceof` against this window's says no. These ask the node itself.

export function isNode(value: unknown): value is Node {
  if (value === null || typeof value !== "object") return false;
  return (typeof Node !== "undefined" && value instanceof Node) || "nodeType" in value;
}

export function isElement(value: unknown): value is Element {
  if (value === null || typeof value !== "object") return false;
  if (typeof Element !== "undefined" && value instanceof Element) return true;
  return (value as Partial<Node>).nodeType === 1;
}

export function isHTMLElement(value: unknown): value is HTMLElement {
  if (value === null || typeof value !== "object") return false;
  if (typeof HTMLElement !== "undefined" && value instanceof HTMLElement) return true;
  return (value as Partial<Node>).nodeType === 1 && "dataset" in value;
}
