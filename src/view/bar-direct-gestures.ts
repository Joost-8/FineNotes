/**
 * Direct press-and-hold gestures on the main toolbar and More tools menu:
 *
 * 1. **Hold any toolbar icon ({@link HOLD_MS}) + drag** → lift into a floating
 *    ghost chip (reusing `ToolbarEditor`'s `.goodobsidian-edit-ghost`), live-
 *    reorder across `start` / `middle` / `end` via `toolbar-layout.ts`'s pure
 *    `moveTo` / `swapItems`, or drop any non-pinned icon onto the Toolbox
 *    button (or a pinned pen onto the open pen row) to tuck/unpin it.
 * 2. **Hold any item in the More tools menu ({@link HOLD_MS}) + drag** → lift
 *    out as a floating ghost chip, dismiss the menu, and drop directly into any
 *    slot on the main toolbar.
 * 3. **Hold blank space on the toolbar ({@link HOLD_MS}) + drag** → show a
 *    dock preview inheriting the bar's real shape & thickness only when aimed
 *    at a *different* edge (`candidateDock !== currentDock`), and dock on
 *    release via `onCommitDock`.
 *
 * Reuses FineNotes' own hold/slop constants (`page-drag-model.ts`), host
 * window helpers (`host-window.ts`), and layout/dock models, with full iPad
 * Safari / WebKit pointer + touch protections.
 */

import { setIcon } from "obsidian";
import { type BarDock, dockCandidate, isBarUpright } from "./bar-dock-model";
import { isElement, onWindowMoved, winOf } from "./host-window";
import { HOLD_MS, POINTER_SLOP_PX, TOUCH_SLOP_PX } from "./page-drag-model";
import {
  BAR_ITEM_ICONS,
  type BarItemId,
  type BarPreset,
  type ToolbarLayout,
  ZONES,
  type Zone,
  isFixedInPreset,
  isPenSlot,
  isPinnedIn,
  moveTo,
  sameLayout,
  slotAt,
  swapItems,
} from "./toolbar-layout";

export interface DirectBarGesturesHost {
  host: HTMLElement;
  barEl: HTMLElement;
  zones: () => Partial<Record<Zone, HTMLElement>>;
  accessoriesButton?: () => HTMLElement | null;
  /** Open pen-types row / pen pill drop target for unpinning a bar pen back into the pen row. */
  penRowTarget?: () => HTMLElement | null;
  barDock: () => BarDock;
  layout: () => ToolbarLayout;
  preset: () => BarPreset;
  canReorder: () => boolean;
  isEditing: () => boolean;
  onPreviewLayout?: (layout: ToolbarLayout) => void;
  onCommitLayout?: (layout: ToolbarLayout) => void;
  onCommitDock?: (dock: BarDock) => void;
}

export interface MoreToolsDragHost extends DirectBarGesturesHost {
  menuEl: HTMLElement;
  onDismissMenu: () => void;
}

export interface MoreToolsDragHandle {
  /** Cancel a pre-hold press if the menu closes before the hold fires. */
  cancelPending: () => void;
  /** Tear down both pending and active drags (toolbar destroy / window migration). */
  destroy: () => void;
}

interface StableSlot {
  id: BarItemId;
  centre: number;
}

const DRAG_START_PX = 6;
const SWALLOW_CLICK_MS = 450;
const BAR_HIT_PAD_PX = 28;

function vibrate(): void {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    try {
      navigator.vibrate(25);
    } catch {
      /* Haptics unsupported on this platform. */
    }
  }
}

export function pointInBox(x: number, y: number, r: DOMRect, pad = 0): boolean {
  return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
}

function createGhostChip(doc: Document, id: BarItemId, sourceEl?: HTMLElement | null): HTMLElement {
  const ghost = doc.body.createDiv({ cls: "goodobsidian-edit-ghost" });
  const svg = sourceEl?.querySelector("svg");
  if (svg) {
    ghost.appendChild(svg.cloneNode(true));
  } else {
    const iconName = (BAR_ITEM_ICONS as Partial<Record<BarItemId, string>>)[id];
    if (iconName) setIcon(ghost, iconName);
  }
  return ghost;
}

export function moveGhost(ghost: HTMLElement | null, x: number, y: number): void {
  if (!ghost) return;
  ghost.setCssStyles({ left: `${Math.round(x)}px`, top: `${Math.round(y)}px` });
}

/** Snapshot non-fixed bar button centres once per drag so Essentials swaps never oscillate. */
function captureEssentialsSlots(ctx: DirectBarGesturesHost, layout: ToolbarLayout): StableSlot[] {
  const zones = ctx.zones();
  const vertical = isBarUpright(ctx.barDock());
  const slots: StableSlot[] = [];
  for (const z of ["start", "middle"] as const) {
    const el = zones[z];
    if (!el) continue;
    const zoneIds = layout[z];
    for (const child of Array.from(el.children)) {
      if (!isElement(child) || child.tagName !== "BUTTON") continue;
      if (child.hasClass("is-overflowed") || child.hasClass("is-unlisted")) continue;
      const id = child.getAttribute("data-item") as BarItemId | null;
      if (!id || !zoneIds.includes(id) || isFixedInPreset(layout, id)) continue;
      const rect = child.getBoundingClientRect();
      slots.push({
        id,
        centre: vertical ? rect.top + rect.height / 2 : rect.left + rect.width / 2,
      });
    }
  }
  return slots;
}

export function computeBarPlacement(
  ctx: DirectBarGesturesHost,
  layout: ToolbarLayout,
  draggedId: BarItemId,
  clientX: number,
  clientY: number,
  essentialsSlots?: readonly StableSlot[],
  baseLayout?: ToolbarLayout,
): ToolbarLayout {
  const zones = ctx.zones();
  const vertical = isBarUpright(ctx.barDock());
  const coord = vertical ? clientY : clientX;

  if (ctx.preset() === "essentials") {
    const origin = baseLayout ?? layout;
    const slots = essentialsSlots ?? captureEssentialsSlots(ctx, origin);
    let nearest: BarItemId | null = null;
    let nearestDist = Infinity;
    for (const slot of slots) {
      const d = Math.abs(coord - slot.centre);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = slot.id;
      }
    }
    if (!nearest || nearest === draggedId) return origin;
    return swapItems(origin, draggedId, nearest);
  }

  let targetZone: Zone = "middle";
  let targetZoneEl: HTMLElement | null = zones.middle ?? null;
  let bestDist = Infinity;
  for (const z of ZONES) {
    const el = zones[z];
    if (!el) continue;
    const r = el.getBoundingClientRect();
    const lo = vertical ? r.top : r.left;
    const hi = vertical ? r.bottom : r.right;
    const d = coord < lo ? lo - coord : coord > hi ? coord - hi : 0;
    if (d < bestDist) {
      bestDist = d;
      targetZone = z;
      targetZoneEl = el;
    }
  }
  if (!targetZoneEl) return layout;

  const zoneIds = layout[targetZone];
  const siblings: Array<{ id: BarItemId; centre: number }> = [];
  for (const child of Array.from(targetZoneEl.children)) {
    if (!isElement(child) || child.tagName !== "BUTTON") continue;
    if (child.hasClass("is-overflowed") || child.hasClass("is-unlisted")) continue;
    const id = child.getAttribute("data-item") as BarItemId | null;
    if (!id || id === draggedId || !zoneIds.includes(id)) continue;
    const rect = child.getBoundingClientRect();
    siblings.push({
      id,
      centre: vertical ? rect.top + rect.height / 2 : rect.left + rect.width / 2,
    });
  }

  const visibleIndex = slotAt(
    siblings.map((s) => s.centre),
    coord,
  );
  const remaining = zoneIds.filter((id) => id !== draggedId);
  const beforeId = siblings[visibleIndex]?.id;
  const insertAt = beforeId ? remaining.indexOf(beforeId) : remaining.length;
  return moveTo(layout, draggedId, {
    zone: targetZone,
    index: insertAt < 0 ? remaining.length : insertAt,
  });
}

function syncDockPreviewShape(
  el: HTMLElement,
  barEl: HTMLElement,
  host: HTMLElement,
  currentDock: BarDock,
  candidate: BarDock,
): void {
  const win = winOf(barEl);
  const style = win.getComputedStyle(barEl);
  const hostStyle = win.getComputedStyle(host);
  const barBox = barEl.getBoundingClientRect();
  const hostBox = host.getBoundingClientRect();
  const pad = {
    top: Math.round(parseFloat(hostStyle.paddingTop) || 0),
    bottom: Math.round(parseFloat(hostStyle.paddingBottom) || 0),
    left: Math.round(parseFloat(hostStyle.paddingLeft) || 0),
    right: Math.round(parseFloat(hostStyle.paddingRight) || 0),
  };
  const thickness = Math.max(
    44,
    Math.round(isBarUpright(currentDock) ? barBox.width : barBox.height) || 52,
  );
  // Measure only the bar's own floating margin (subtracting the host's safe-area/status-bar
  // padding so dragging from a bottom-docked bar never offsets top/left/right previews).
  const rawGap =
    currentDock === "top"
      ? barBox.top - hostBox.top
      : currentDock === "bottom"
        ? hostBox.bottom - barBox.bottom
        : currentDock === "left"
          ? barBox.left - hostBox.left
          : hostBox.right - barBox.right;
  const floatMargin = Math.max(0, Math.round(rawGap - pad[currentDock]));
  const sideGap = floatMargin > 0 ? Math.max(8, floatMargin) : 0;
  const upright = isBarUpright(candidate);
  el.setCssProps({
    "--gob-dock-radius": style.borderRadius || "0px",
    "--gob-dock-size": `${thickness}px`,
    "--gob-dock-edge": `${pad[candidate] + floatMargin}px`,
    "--gob-dock-start": `${(upright ? pad.top : pad.left) + sideGap}px`,
    "--gob-dock-end": `${(upright ? pad.bottom : pad.right) + sideGap}px`,
  });
  el.removeClass("is-dock-top", "is-dock-bottom", "is-dock-left", "is-dock-right");
  el.addClass(`is-dock-${candidate}`);
}

/**
 * Bind direct press-and-hold icon reordering (including dropping onto More
 * tools / open pen row) and blank-space bar docking onto `barEl`. Returns a
 * cleanup disposer.
 */
export function bindDirectBarGestures(ctx: DirectBarGesturesHost): () => void {
  const { barEl, host } = ctx;

  let boundDoc: Document | null = null;
  let boundWin: Window | null = null;
  let activePointerId: number | null = null;
  let activePointerType = "mouse";
  let activeTouchId: number | null = null;
  let mode: "icon" | "dock" | null = null;
  let holdTimer: number | null = null;
  let holdTriggered = false;
  let hasDragged = false;
  let startX = 0;
  let startY = 0;
  let draggedButton: HTMLButtonElement | null = null;
  let draggedId: BarItemId | null = null;
  let startLayout: ToolbarLayout | null = null;
  let currentLayout: ToolbarLayout | null = null;
  let essentialsSlots: StableSlot[] | null = null;
  let ghostEl: HTMLElement | null = null;
  let penTargetEl: HTMLElement | null = null;
  let dockPreview: HTMLElement | null = null;
  let candidateDock: BarDock = ctx.barDock();
  let swallowClickUntil = 0;

  const setMoreToolsHighlight = (on: boolean): void => {
    ctx.accessoriesButton?.()?.toggleClass("is-drop-target", on);
  };

  const setPenRowHighlight = (el: HTMLElement | null): void => {
    if (penTargetEl && penTargetEl !== el) penTargetEl.removeClass("is-drop-target");
    penTargetEl = el;
    if (el) el.addClass("is-drop-target");
  };

  const syncDockPreview = (dock: BarDock): void => {
    const current = ctx.barDock();
    if (dock === current) {
      if (dockPreview) {
        dockPreview.remove();
        dockPreview = null;
      }
      return;
    }
    if (!dockPreview) {
      dockPreview = host.createDiv({ cls: "goodobsidian-dock-preview" });
    }
    syncDockPreviewShape(dockPreview, barEl, host, current, dock);
  };

  const cleanupActive = (): void => {
    if (holdTimer !== null) {
      (boundWin ?? winOf(barEl)).clearTimeout(holdTimer);
      holdTimer = null;
    }
    if (dockPreview) {
      dockPreview.remove();
      dockPreview = null;
    }
    if (ghostEl) {
      ghostEl.remove();
      ghostEl = null;
    }
    setMoreToolsHighlight(false);
    setPenRowHighlight(null);
    if (draggedButton) {
      draggedButton.removeClass("is-drag-held", "is-dragging");
    }
    barEl.removeClass("is-bar-held", "is-reordering");
    if (activePointerId !== null) {
      try {
        if (barEl.hasPointerCapture(activePointerId)) barEl.releasePointerCapture(activePointerId);
      } catch {
        /* Pointer capture already released. */
      }
    }
    if (boundDoc) {
      boundDoc.removeEventListener("pointermove", onDocMove);
      boundDoc.removeEventListener("pointerup", onDocUp);
      boundDoc.removeEventListener("pointercancel", onDocCancel);
      boundDoc.removeEventListener("touchstart", onTouchStart, true);
      boundDoc.removeEventListener("touchmove", onTouchMove, true);
      boundDoc = null;
    }
    if (boundWin) {
      boundWin.removeEventListener("keydown", onKeyDown, true);
      boundWin.removeEventListener("blur", cancelActive);
      boundWin = null;
    }
    barEl.removeEventListener("lostpointercapture", onLostCapture);
    activePointerId = null;
    activeTouchId = null;
    mode = null;
    holdTriggered = false;
    hasDragged = false;
    draggedButton = null;
    draggedId = null;
    startLayout = null;
    currentLayout = null;
    essentialsSlots = null;
  };

  const cancelActive = (): void => {
    const wasHeld = holdTriggered;
    const wasMode = mode;
    const before = startLayout;
    const after = currentLayout;
    cleanupActive();
    if (wasHeld) swallowClickUntil = Date.now() + SWALLOW_CLICK_MS;
    if (wasHeld && wasMode === "icon" && before && after && !sameLayout(before, after)) {
      ctx.onPreviewLayout?.(before);
    }
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      if (holdTriggered) e.preventDefault();
      cancelActive();
    }
  };

  const onLostCapture = (e: PointerEvent): void => {
    if (e.pointerId === activePointerId && holdTriggered) cancelActive();
  };

  const onTouchStart = (e: TouchEvent): void => {
    if (activePointerId === null) return;
    // Always check multi-touch first so a second finger cancels even after touchId is stored.
    if (e.touches.length > 1) {
      cancelActive();
      return;
    }
    if (activeTouchId !== null) return;
    const touch = Array.from(e.changedTouches).find(
      (t) => Math.abs(t.clientX - startX) < 16 && Math.abs(t.clientY - startY) < 16,
    );
    if (touch) activeTouchId = touch.identifier;
  };

  const onTouchMove = (e: TouchEvent): void => {
    if (
      holdTriggered &&
      activePointerId !== null &&
      activeTouchId !== null &&
      Array.from(e.changedTouches).some((t) => t.identifier === activeTouchId) &&
      e.cancelable
    ) {
      e.preventDefault();
    }
  };

  const onDocMove = (e: PointerEvent): void => {
    if (e.pointerId !== activePointerId) return;
    const dist = Math.hypot(e.clientX - startX, e.clientY - startY);
    if (!holdTriggered) {
      const slop = activePointerType === "touch" ? TOUCH_SLOP_PX : POINTER_SLOP_PX;
      if (dist > slop && holdTimer !== null) {
        (boundWin ?? winOf(barEl)).clearTimeout(holdTimer);
        holdTimer = null;
      }
      return;
    }
    if (e.cancelable) e.preventDefault();

    if (mode === "dock") {
      candidateDock = dockCandidate(
        e.clientX,
        e.clientY,
        host.getBoundingClientRect(),
        ctx.barDock(),
        startX,
        startY,
      );
      syncDockPreview(candidateDock);
    } else if (mode === "icon" && draggedButton && draggedId && startLayout && currentLayout) {
      moveGhost(ghostEl, e.clientX, e.clientY);
      if (dist > DRAG_START_PX) hasDragged = true;
      if (!hasDragged) return;
      draggedButton.addClass("is-dragging");

      // 1. Pinned pen dragged down onto open pen row/pill unpins back into the pen row.
      const penTarget = isPenSlot(draggedId) ? (ctx.penRowTarget?.() ?? null) : null;
      const hittingPenRow =
        penTarget !== null &&
        pointInBox(e.clientX, e.clientY, penTarget.getBoundingClientRect(), 8);
      setPenRowHighlight(hittingPenRow ? penTarget : null);
      if (hittingPenRow) {
        setMoreToolsHighlight(false);
        if (!sameLayout(currentLayout, startLayout)) {
          currentLayout = startLayout;
          ctx.onPreviewLayout?.(startLayout);
        }
        return;
      }

      // 2. Non-pinned button dragged onto Toolbox tucks into More tools.
      const accBtn = ctx.accessoriesButton?.() ?? null;
      const canTuckToMore =
        accBtn !== null &&
        ctx.preset() !== "essentials" &&
        draggedId !== "accessories" &&
        !isPinnedIn(startLayout, draggedId);
      const hittingMore =
        canTuckToMore && pointInBox(e.clientX, e.clientY, accBtn.getBoundingClientRect(), 6);
      setMoreToolsHighlight(hittingMore);
      if (hittingMore) {
        if (!sameLayout(currentLayout, startLayout)) {
          currentLayout = startLayout;
          ctx.onPreviewLayout?.(startLayout);
        }
        return;
      }

      // 3. Require the pointer to stay over the bar; releasing over the page cancels.
      if (!pointInBox(e.clientX, e.clientY, barEl.getBoundingClientRect(), BAR_HIT_PAD_PX)) {
        if (!sameLayout(currentLayout, startLayout)) {
          currentLayout = startLayout;
          ctx.onPreviewLayout?.(startLayout);
        }
        return;
      }

      const next = computeBarPlacement(
        ctx,
        currentLayout,
        draggedId,
        e.clientX,
        e.clientY,
        essentialsSlots ?? undefined,
        startLayout,
      );
      if (!sameLayout(currentLayout, next)) {
        currentLayout = next;
        ctx.onPreviewLayout?.(next);
      }
    }
  };

  const onDocUp = (e: PointerEvent): void => {
    if (e.pointerId !== activePointerId) return;
    const wasHeld = holdTriggered;
    const wasMode = mode;
    const didDrag = hasDragged;
    const nextDock = candidateDock;
    const before = startLayout;
    let after = currentLayout;
    const id = draggedId;
    const slots = essentialsSlots;
    let landedOnBar = false;
    let tuckedToMore = false;
    let returnedToPenRow = false;

    if (wasHeld && wasMode === "icon" && didDrag && before && id) {
      const penTarget = isPenSlot(id) ? (ctx.penRowTarget?.() ?? null) : null;
      returnedToPenRow =
        penTarget !== null &&
        pointInBox(e.clientX, e.clientY, penTarget.getBoundingClientRect(), 8);
      const accBtn = ctx.accessoriesButton?.() ?? null;
      const canTuckToMore =
        accBtn !== null &&
        ctx.preset() !== "essentials" &&
        id !== "accessories" &&
        !isPinnedIn(before, id);
      tuckedToMore =
        !returnedToPenRow &&
        canTuckToMore &&
        pointInBox(e.clientX, e.clientY, accBtn.getBoundingClientRect(), 6);
      landedOnBar =
        !returnedToPenRow &&
        !tuckedToMore &&
        pointInBox(e.clientX, e.clientY, barEl.getBoundingClientRect(), BAR_HIT_PAD_PX);
      if (landedOnBar && after) {
        after = computeBarPlacement(
          ctx,
          after,
          id,
          e.clientX,
          e.clientY,
          slots ?? undefined,
          before,
        );
      }
    }

    cleanupActive();

    if (!wasHeld) return;
    swallowClickUntil = Date.now() + SWALLOW_CLICK_MS;

    if (wasMode === "dock") {
      if (nextDock !== ctx.barDock()) ctx.onCommitDock?.(nextDock);
    } else if (wasMode === "icon" && didDrag && before && id) {
      if (tuckedToMore || returnedToPenRow) {
        const tucked = moveTo(before, id, "menu");
        if (!sameLayout(before, tucked)) ctx.onCommitLayout?.(tucked);
      } else if (landedOnBar && after && !sameLayout(before, after)) {
        ctx.onCommitLayout?.(after);
      } else if (after && !sameLayout(before, after)) {
        ctx.onPreviewLayout?.(before);
      }
    }
  };

  const onDocCancel = (e: PointerEvent): void => {
    if (e.pointerId === activePointerId) cancelActive();
  };

  const onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 || e.isPrimary === false) return;
    if (activePointerId !== null || ctx.isEditing()) return;

    const target = isElement(e.target) ? e.target : null;
    const button = target?.closest<HTMLButtonElement>("button[data-item]") ?? null;
    const interactive = target?.closest("button, input, select, textarea, [role='button']");

    if (button && barEl.contains(button) && ctx.onCommitLayout && ctx.canReorder()) {
      const id = button.getAttribute("data-item") as BarItemId | null;
      const layout = ctx.layout();
      if (!id) return;
      if (ctx.preset() === "essentials" && isFixedInPreset(layout, id)) return;
      mode = "icon";
      draggedButton = button;
      draggedId = id;
      startLayout = layout;
      currentLayout = layout;
    } else if (!interactive && ctx.onCommitDock) {
      mode = "dock";
      candidateDock = ctx.barDock();
    } else {
      return;
    }

    const doc = barEl.ownerDocument;
    const win = winOf(barEl);
    boundDoc = doc;
    boundWin = win;
    activePointerId = e.pointerId;
    activePointerType = e.pointerType || "mouse";
    startX = e.clientX;
    startY = e.clientY;
    holdTriggered = false;
    hasDragged = false;

    holdTimer = win.setTimeout(() => {
      holdTimer = null;
      if (
        !barEl.isConnected ||
        (mode === "icon" && (!draggedButton || !draggedButton.isConnected))
      ) {
        cleanupActive();
        return;
      }
      holdTriggered = true;
      vibrate();
      if (activePointerId !== null) {
        try {
          barEl.setPointerCapture(activePointerId);
        } catch {
          /* Pointer capture unsupported for synthetic events. */
        }
      }
      if (mode === "dock") {
        barEl.addClass("is-bar-held");
      } else if (mode === "icon" && draggedButton && draggedId && startLayout) {
        if (ctx.preset() === "essentials") {
          essentialsSlots = captureEssentialsSlots(ctx, startLayout);
        }
        barEl.addClass("is-reordering");
        draggedButton.addClass("is-drag-held");
        ghostEl = createGhostChip(doc, draggedId, draggedButton);
        moveGhost(ghostEl, startX, startY);
      }
    }, HOLD_MS);

    doc.addEventListener("pointermove", onDocMove);
    doc.addEventListener("pointerup", onDocUp);
    doc.addEventListener("pointercancel", onDocCancel);
    doc.addEventListener("touchstart", onTouchStart, true);
    doc.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
    win.addEventListener("keydown", onKeyDown, true);
    win.addEventListener("blur", cancelActive);
    barEl.addEventListener("lostpointercapture", onLostCapture);
  };

  const onContextMenu = (e: MouseEvent): void => {
    if (holdTriggered || holdTimer !== null) e.preventDefault();
  };

  const onClickCapture = (e: MouseEvent): void => {
    if (Date.now() < swallowClickUntil) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };

  const stopMove = onWindowMoved(barEl, cancelActive);
  barEl.addEventListener("pointerdown", onPointerDown);
  barEl.addEventListener("contextmenu", onContextMenu);
  barEl.addEventListener("click", onClickCapture, true);

  return () => {
    stopMove();
    cancelActive();
    barEl.removeEventListener("pointerdown", onPointerDown);
    barEl.removeEventListener("contextmenu", onContextMenu);
    barEl.removeEventListener("click", onClickCapture, true);
  };
}

/**
 * Bind press-and-hold on the More tools popover so any tool row can be dragged
 * straight onto the main toolbar without opening Customize toolbar.
 */
export function bindMoreToolsDrag(ctx: MoreToolsDragHost): MoreToolsDragHandle {
  const { menuEl, barEl } = ctx;
  let boundDoc: Document | null = null;
  let boundWin: Window | null = null;
  let activePointerId: number | null = null;
  let activePointerType = "mouse";
  let activeTouchId: number | null = null;
  let holdTimer: number | null = null;
  let holdTriggered = false;
  let startX = 0;
  let startY = 0;
  let draggedRow: HTMLButtonElement | null = null;
  let draggedId: BarItemId | null = null;
  let startLayout: ToolbarLayout | null = null;
  let currentLayout: ToolbarLayout | null = null;
  let ghostEl: HTMLElement | null = null;
  let swallowClickUntil = 0;

  const cleanup = (): void => {
    if (holdTimer !== null) {
      (boundWin ?? winOf(barEl)).clearTimeout(holdTimer);
      holdTimer = null;
    }
    if (ghostEl) {
      ghostEl.remove();
      ghostEl = null;
    }
    barEl.removeClass("is-reordering");
    if (activePointerId !== null) {
      try {
        if (barEl.hasPointerCapture(activePointerId)) barEl.releasePointerCapture(activePointerId);
      } catch {
        /* Pointer capture already released. */
      }
    }
    if (boundDoc) {
      boundDoc.removeEventListener("pointermove", onMove);
      boundDoc.removeEventListener("pointerup", onUp);
      boundDoc.removeEventListener("pointercancel", onCancel);
      boundDoc.removeEventListener("touchstart", onTouchStart, true);
      boundDoc.removeEventListener("touchmove", onTouchMove, true);
      boundDoc = null;
    }
    if (boundWin) {
      boundWin.removeEventListener("keydown", onKeyDown, true);
      boundWin.removeEventListener("blur", cancelAll);
      boundWin = null;
    }
    barEl.removeEventListener("lostpointercapture", onLostCapture);
    activePointerId = null;
    activeTouchId = null;
    holdTriggered = false;
    draggedRow = null;
    draggedId = null;
    startLayout = null;
    currentLayout = null;
  };

  const cancelAll = (): void => {
    const before = startLayout;
    const after = currentLayout;
    cleanup();
    if (before && after && !sameLayout(before, after)) {
      ctx.onPreviewLayout?.(before);
    }
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      if (holdTriggered) e.preventDefault();
      cancelAll();
    }
  };

  const onLostCapture = (e: PointerEvent): void => {
    if (e.pointerId === activePointerId && holdTriggered) cancelAll();
  };

  const onTouchStart = (e: TouchEvent): void => {
    if (activePointerId === null) return;
    if (e.touches.length > 1) {
      cancelAll();
      return;
    }
    if (activeTouchId !== null) return;
    const touch = Array.from(e.changedTouches).find(
      (t) => Math.abs(t.clientX - startX) < 16 && Math.abs(t.clientY - startY) < 16,
    );
    if (touch) activeTouchId = touch.identifier;
  };

  const onTouchMove = (e: TouchEvent): void => {
    if (
      holdTriggered &&
      activePointerId !== null &&
      activeTouchId !== null &&
      Array.from(e.changedTouches).some((t) => t.identifier === activeTouchId) &&
      e.cancelable
    ) {
      e.preventDefault();
    }
  };

  const onMove = (e: PointerEvent): void => {
    if (e.pointerId !== activePointerId) return;
    const dist = Math.hypot(e.clientX - startX, e.clientY - startY);
    if (!holdTriggered) {
      const slop = activePointerType === "touch" ? TOUCH_SLOP_PX : POINTER_SLOP_PX;
      if (dist > slop && holdTimer !== null) {
        (boundWin ?? winOf(barEl)).clearTimeout(holdTimer);
        holdTimer = null;
      }
      return;
    }
    if (e.cancelable) e.preventDefault();
    moveGhost(ghostEl, e.clientX, e.clientY);
    if (!draggedId || !startLayout || !currentLayout) return;

    if (!pointInBox(e.clientX, e.clientY, barEl.getBoundingClientRect(), BAR_HIT_PAD_PX)) {
      if (!sameLayout(currentLayout, startLayout)) {
        currentLayout = startLayout;
        ctx.onPreviewLayout?.(startLayout);
      }
      return;
    }
    const next = computeBarPlacement(ctx, currentLayout, draggedId, e.clientX, e.clientY);
    if (!sameLayout(currentLayout, next)) {
      currentLayout = next;
      ctx.onPreviewLayout?.(next);
    }
  };

  const onUp = (e: PointerEvent): void => {
    if (e.pointerId !== activePointerId) return;
    const wasHeld = holdTriggered;
    const before = startLayout;
    let after = currentLayout;
    const id = draggedId;
    const landed =
      wasHeld && pointInBox(e.clientX, e.clientY, barEl.getBoundingClientRect(), BAR_HIT_PAD_PX);
    if (landed && id && after) {
      after = computeBarPlacement(ctx, after, id, e.clientX, e.clientY);
    }
    cleanup();
    if (!wasHeld) return;
    swallowClickUntil = Date.now() + SWALLOW_CLICK_MS;
    if (landed && before && after && !sameLayout(before, after)) {
      ctx.onCommitLayout?.(after);
    } else if (before && after && !sameLayout(before, after)) {
      ctx.onPreviewLayout?.(before);
    }
  };

  const onCancel = (e: PointerEvent): void => {
    if (e.pointerId === activePointerId) cancelAll();
  };

  const onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 || e.isPrimary === false) return;
    if (activePointerId !== null || ctx.isEditing() || !ctx.canReorder() || !ctx.onCommitLayout) {
      return;
    }
    if (ctx.preset() === "essentials") return;
    const target = isElement(e.target) ? e.target : null;
    const row = target?.closest<HTMLButtonElement>("button[data-more-item]") ?? null;
    if (!row || !menuEl.contains(row)) return;
    const id = row.getAttribute("data-more-item") as BarItemId | null;
    if (!id) return;

    const doc = barEl.ownerDocument;
    const win = winOf(barEl);
    boundDoc = doc;
    boundWin = win;
    activePointerId = e.pointerId;
    activePointerType = e.pointerType || "mouse";
    startX = e.clientX;
    startY = e.clientY;
    draggedRow = row;
    draggedId = id;
    startLayout = ctx.layout();
    currentLayout = startLayout;
    holdTriggered = false;

    holdTimer = win.setTimeout(() => {
      holdTimer = null;
      if (!draggedRow?.isConnected || !menuEl.isConnected || !barEl.isConnected) {
        cleanup();
        return;
      }
      holdTriggered = true;
      vibrate();
      if (activePointerId !== null) {
        try {
          barEl.setPointerCapture(activePointerId);
        } catch {
          /* Pointer capture unsupported for synthetic events. */
        }
      }
      ghostEl = createGhostChip(doc, id, draggedRow);
      moveGhost(ghostEl, startX, startY);
      barEl.addClass("is-reordering");
      ctx.onDismissMenu();
    }, HOLD_MS);

    doc.addEventListener("pointermove", onMove);
    doc.addEventListener("pointerup", onUp);
    doc.addEventListener("pointercancel", onCancel);
    doc.addEventListener("touchstart", onTouchStart, true);
    doc.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
    win.addEventListener("keydown", onKeyDown, true);
    win.addEventListener("blur", cancelAll);
    barEl.addEventListener("lostpointercapture", onLostCapture);
  };

  const onClickCapture = (e: MouseEvent): void => {
    if (Date.now() < swallowClickUntil) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };

  const stopMove = onWindowMoved(barEl, cancelAll);
  menuEl.addEventListener("pointerdown", onPointerDown);
  menuEl.addEventListener("click", onClickCapture, true);

  return {
    cancelPending: () => {
      menuEl.removeEventListener("pointerdown", onPointerDown);
      menuEl.removeEventListener("click", onClickCapture, true);
      if (!holdTriggered) {
        stopMove();
        cleanup();
      }
    },
    destroy: () => {
      stopMove();
      menuEl.removeEventListener("pointerdown", onPointerDown);
      menuEl.removeEventListener("click", onClickCapture, true);
      cancelAll();
    },
  };
}
