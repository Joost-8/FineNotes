/**
 * Moving a note or folder with a finger. A touch has no drag-and-drop, so:
 * hold a row for 0.4 s and it is "armed"; let go and its menu opens; drag
 * from there and a copy of the row follows the finger over the sidebar (which
 * opens if it was closed), folders under it light up, and a folder held over
 * for 0.7 s opens. Letting go on a folder moves the item there.
 */

import { TFolder } from "obsidian";
import { folderKey } from "../../model/folder-paths";
import { t } from "../../i18n/translate";
import type { FolderSidebarController } from "./controller";

/** Hold this long to arm a row, ms. */
const HOLD_MS = 400;
/** Moving more than this before then cancels the hold, px. */
const HOLD_SLOP = 10;
/** Moving more than this once armed starts the drag, px. */
const DRAG_START = 8;
/** The click that follows a touch which armed a row is ignored for this long, ms. */
const SWALLOW_CLICK_MS = 600;
/** A folder held over for this long opens, ms. */
const HOVER_OPEN_MS = 700;
/** Near the top or bottom edge of the list (px) it scrolls. */
const EDGE = 40;
/** The scroll step, px per frame. */
const EDGE_STEP = 10;
/** How big the row's copy is, as a share of the row. */
const GHOST_SCALE = 0.6;

interface DragState {
  controller: FolderSidebarController;
  path: string;
  source: HTMLElement;
  ghost: HTMLElement;
  ghostW: number;
  ghostH: number;
  x: number;
  y: number;
  /** The sidebar was closed when the drag began, and is closed again after it. */
  openedDrawer: boolean;
  hoverEl: Element | null;
  hoverPath: string | null;
  hoverTimer: number | null;
  frame: number | null;
}

/** The drag under way, if any. */
let drag: DragState | null = null;
let hint: HTMLElement | null = null;

function showHint(): void {
  hideHint();
  const el = activeDocument.body.createDiv({ cls: "fl-drag-hint", attr: { role: "status" } });
  el.setText(t("view.folders.dragHint"));
  hint = el;
}

function hideHint(): void {
  hint?.remove();
  hint = null;
}

export interface TouchDragOptions {
  controller: FolderSidebarController;
  /** The vault path of the folder or note on this row. */
  path: string;
  /** Whether a drag may start now (the library does not drag while selecting). */
  canStart?: () => boolean;
  /** The row was held and let go: open its menu at this point. */
  onMenu: (at: { x: number; y: number }) => void;
}

/** Make `el` a row that can be held, dragged and dropped with a finger. */
export function attachTouchDrag(el: HTMLElement, options: TouchDragOptions): void {
  let timer: number | null = null;
  let armed = false;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let swallowClickUntil = 0;
  let removeDocumentListeners = (): void => {};

  const clearTimer = (): void => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };
  const reset = (): void => {
    hideHint();
    clearTimer();
    armed = false;
    dragging = false;
    el.removeClass("fl-touch-armed");
  };
  const finish = (dropped: boolean): void => {
    const wasArmed = armed;
    const wasDragging = dragging;
    reset();
    removeDocumentListeners();
    if (wasDragging) finishDrag(dropped);
    else if (wasArmed && dropped) options.onMenu({ x: startX, y: startY });
  };
  const onMove = (event: TouchEvent): void => {
    if (event.touches.length === 0) return;
    const touch = event.touches[0];
    if (dragging) {
      if (event.cancelable) event.preventDefault();
      moveDrag(touch.clientX, touch.clientY);
      return;
    }
    const moved = Math.hypot(touch.clientX - startX, touch.clientY - startY);
    if (armed) {
      if (event.cancelable) event.preventDefault();
      if (moved > DRAG_START && !drag) {
        dragging = true;
        hideHint();
        el.removeClass("fl-touch-armed");
        startDrag(options, el, touch.clientX, touch.clientY);
      }
      return;
    }
    if (timer !== null && moved > HOLD_SLOP) clearTimer();
  };
  const onEnd = (event: TouchEvent): void => {
    if (event.type === "touchend" && (armed || dragging)) {
      swallowClickUntil = Date.now() + SWALLOW_CLICK_MS;
      if (event.cancelable) event.preventDefault();
    }
    finish(event.type === "touchend");
  };
  const listenOnDocument = (): void => {
    removeDocumentListeners();
    const doc = activeDocument;
    doc.addEventListener("touchmove", onMove, { passive: false });
    doc.addEventListener("touchend", onEnd);
    doc.addEventListener("touchcancel", onEnd);
    removeDocumentListeners = () => {
      doc.removeEventListener("touchmove", onMove);
      doc.removeEventListener("touchend", onEnd);
      doc.removeEventListener("touchcancel", onEnd);
      removeDocumentListeners = () => {};
    };
  };

  el.addEventListener(
    "touchstart",
    (event) => {
      reset();
      if (event.touches.length !== 1 || drag) return;
      if (options.canStart && !options.canStart()) return;
      const touch = event.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      listenOnDocument();
      timer = window.setTimeout(() => {
        timer = null;
        armed = true;
        el.addClass("fl-touch-armed");
        showHint();
      }, HOLD_MS);
    },
    { passive: true },
  );
  el.addEventListener("touchmove", onMove, { passive: false });
  el.addEventListener("touchend", onEnd);
  el.addEventListener("touchcancel", onEnd);
  el.addEventListener(
    "click",
    (event) => {
      if (Date.now() < swallowClickUntil) {
        event.preventDefault();
        event.stopImmediatePropagation();
        swallowClickUntil = 0;
      }
    },
    true,
  );
}

function startDrag(options: TouchDragOptions, row: HTMLElement, x: number, y: number): void {
  const { controller } = options;
  const box = row.getBoundingClientRect();
  const ghost = row.cloneNode(true) as HTMLElement;
  ghost.removeClass("fl-touch-armed");
  ghost.addClass("fl-touch-ghost");
  ghost.removeAttribute("id");
  ghost.setCssProps({ width: `${box.width}px`, height: `${box.height}px` });
  activeDocument.body.appendChild(ghost);
  const state: DragState = {
    controller,
    path: options.path,
    source: row,
    ghost,
    ghostW: box.width,
    ghostH: box.height,
    x,
    y,
    openedDrawer: false,
    hoverEl: null,
    hoverPath: null,
    hoverTimer: null,
    frame: null,
  };
  drag = state;
  placeGhost(state);
  const split = controller.app.workspace.leftSplit;
  if (split.collapsed) {
    split.expand();
    state.openedDrawer = true;
  }
  void controller.showSidebar();
  const tick = (): void => {
    if (drag !== state) return;
    autoScroll(state);
    updateHover(state);
    state.frame = window.requestAnimationFrame(tick);
  };
  state.frame = window.requestAnimationFrame(tick);
  updateHover(state);
}

function moveDrag(x: number, y: number): void {
  if (!drag) return;
  drag.x = x;
  drag.y = y;
  placeGhost(drag);
  updateHover(drag);
}

function placeGhost(state: DragState): void {
  const x = state.x - state.ghostW / 2;
  const y = state.y - state.ghostH / 2;
  state.ghost.setCssProps({ transform: `translate(${x}px, ${y}px) scale(${GHOST_SCALE})` });
}

function sidebarList(): Element | null {
  return activeDocument.querySelector(".folder-sidebar-root .fs-list");
}

/** Light up the folder under the finger if the item may be dropped there. */
function updateHover(state: DragState): void {
  const under = activeDocument.elementFromPoint(state.x, state.y);
  const dropZone = under instanceof Element ? under.closest("[data-drop-path]") : null;
  let path: string | null = null;
  let element: Element | null = null;
  if (dropZone) {
    const target = folderKey(dropZone.getAttribute("data-drop-path"));
    if (state.controller.isValidMove(state.path, target)) {
      path = target;
      element = target === "" ? sidebarList() : dropZone;
    }
  }
  if (element !== state.hoverEl) {
    state.hoverEl?.removeClass("is-drop-target");
    element?.addClass("is-drop-target");
    state.hoverEl = element;
  }
  if (path !== state.hoverPath) {
    state.hoverPath = path;
    clearHoverTimer(state);
    if (path) openAfterHover(state, path);
  }
}

function clearHoverTimer(state: DragState): void {
  if (state.hoverTimer !== null) {
    window.clearTimeout(state.hoverTimer);
    state.hoverTimer = null;
  }
}

/** A closed folder with subfolders opens when the finger stays over it. */
function openAfterHover(state: DragState, path: string): void {
  if (!path || state.controller.isExpanded(path)) return;
  const folder = state.controller.app.vault.getAbstractFileByPath(path);
  if (!(folder instanceof TFolder) || !folder.children.some((child) => child instanceof TFolder)) {
    return;
  }
  state.hoverTimer = window.setTimeout(() => {
    state.hoverTimer = null;
    if (drag !== state || state.hoverPath !== path) return;
    state.controller.setExpanded(path, true);
    state.controller.notifyDataChanged();
    state.hoverEl = null;
  }, HOVER_OPEN_MS);
}

/** The element of the sidebar that scrolls, if one does. */
function scrollParent(): Element | null {
  const root = activeDocument.querySelector(".folder-sidebar-root");
  if (!root) return null;
  for (const candidate of [root.querySelector(".fs-list"), root.querySelector(".fs-pane"), root]) {
    if (!candidate) continue;
    const overflow = activeWindow.getComputedStyle(candidate).overflowY;
    if (
      (overflow === "auto" || overflow === "scroll") &&
      candidate.scrollHeight > candidate.clientHeight
    ) {
      return candidate;
    }
  }
  return null;
}

/** Scroll the list while the finger is near its top or bottom edge. */
function autoScroll(state: DragState): void {
  const parent = scrollParent();
  if (!parent) return;
  const box = parent.getBoundingClientRect();
  if (state.x < box.left || state.x > box.right) return;
  if (state.y < box.top + EDGE && state.y >= box.top - EDGE) parent.scrollTop -= EDGE_STEP;
  else if (state.y > box.bottom - EDGE && state.y <= box.bottom + EDGE)
    parent.scrollTop += EDGE_STEP;
}

function finishDrag(dropped: boolean): void {
  const state = drag;
  if (!state) return;
  drag = null;
  if (state.frame !== null) activeWindow.cancelAnimationFrame(state.frame);
  clearHoverTimer(state);
  state.ghost.remove();
  state.hoverEl?.removeClass("is-drop-target");
  activeDocument
    .querySelectorAll(".is-drop-target")
    .forEach((el) => el.classList.remove("is-drop-target"));
  const target = dropped ? state.hoverPath : null;
  const closeDrawer = (): void => {
    if (state.openedDrawer) state.controller.app.workspace.leftSplit.collapse();
  };
  if (target !== null) void state.controller.moveItem(state.path, target).finally(closeDrawer);
  else closeDrawer();
}
