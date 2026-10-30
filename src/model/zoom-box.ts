/**
 * The Zoom box's geometry: the target box on the page, the magnified view in
 * the floating window, and the steps that move the box for continuous
 * writing. Pure page-space maths, kept out of the view.
 */

export interface ZoomRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ZoomHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

/** What a press on the target frame does: move it, resize from a handle, or draw. */
export type ZoomTargetPress = "move" | ZoomHandle | "draw";

/**
 * A press on the target frame. An unselected target is a picture of where the
 * box is, not a control: the page keeps the press, so drawing and panning
 * work. Once selected, a handle resizes and the body or badge moves it.
 */
export function zoomTargetPress(selected: boolean, handle: ZoomHandle | null): ZoomTargetPress {
  if (!selected) return "draw";
  return handle ?? "move";
}

/**
 * Whether this pointer may move (`part` "move", the bar) or resize ("resize",
 * the corner grip) the window. The pen and a mouse always may, and so may a
 * finger, except while the pen writes in the box (that finger is the writing
 * hand) and, in Stylus-only mode, on the grip: it sits in the window's
 * bottom-right corner, where a right hand rests to write.
 */
export function zoomWindowDragAllowed(
  pointerType: string,
  onlyStylus: boolean,
  part: "move" | "resize" = "move",
  penWriting = false,
): boolean {
  if (pointerType !== "touch") return true;
  if (penWriting) return false;
  return !(onlyStylus && part === "resize");
}

/**
 * Whether the first-drag catcher lies over the page while a Zoom box waits
 * for its target. It takes every pointer, fingers included, so it is only
 * put down in Stylus-only mode, where fingers do nothing on the page anyway:
 * otherwise a finger must still pan and pinch, and the pen and a mouse draw
 * the target through the page's own input.
 */
export function zoomCatcherWanted(armed: boolean, onlyStylus: boolean): boolean {
  return armed && onlyStylus;
}

/**
 * The page zoom a Zoom box's magnification amounts to: the `userZoom` at
 * which the page would show at `viewScale` CSS px per page px, the page's
 * own fit being `baseScale`. Gesture thresholds are screen lengths tuned at
 * fit zoom, so a stroke written in the box measures them by this. Null when
 * either scale is unusable.
 */
export function zoomBoxGestureZoom(viewScale: number, baseScale: number): number | null {
  if (!Number.isFinite(viewScale) || !Number.isFinite(baseScale)) return null;
  if (!(viewScale > 0) || !(baseScale > 0)) return null;
  return viewScale / baseScale;
}

/** How the Magnifier button reads while a target box may be open. */
export function zoomButtonState(
  tool: string,
  boxOpen: boolean,
): { highlighted: boolean; pressed: boolean } {
  return { highlighted: boxOpen, pressed: tool === "zoom" || boxOpen };
}

/**
 * What a tap on the Magnifier button does, Goodnotes' way (Joost,
 * 2026-10-30): in Zoom box mode one tap opens the box, the tool in hand
 * staying in hand, so the Pencil writes on at once. With the box open, a tap
 * picks the Magnifier (its pill: the mode switch, the zoom steps); a tap with
 * the Magnifier already in hand closes the box. In Page zoom mode it is a
 * tool like any other.
 */
export function magnifierTap(
  current: string,
  zoomBoxMode: boolean,
  boxOpen: boolean,
): "open" | "close" | "select" {
  if (boxOpen) return current === "zoom" ? "close" : "select";
  return zoomBoxMode && current !== "zoom" ? "open" : "select";
}

/** How far a Zoom box opened with one tap magnifies the page as it is shown. */
export const ZOOM_BOX_PLACED_MAGNIFICATION = 2.5;
/** A placed box's inset from the top left of the page in view, as a share of the smaller side. */
const ZOOM_BOX_PLACED_INSET = 0.06;

/** The window's first place in a surface `bounds` CSS px: at the bottom, above the options pill, centred. */
export function zoomWindowFirstPlace(bounds: { w: number; h: number }): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const w = Math.max(304, Math.min(420, Math.round(bounds.w * 0.6)));
  const h = Math.max(160, Math.min(280, Math.round(bounds.h * 0.35)));
  return {
    x: Math.max(0, Math.round((bounds.w - w) / 2)),
    y: Math.max(8, bounds.h - h - 92),
    w,
    h,
  };
}

/**
 * Where a Zoom box opened with one tap looks, so nothing has to be drawn
 * first: at the top left of the part of the page in view (`visible`, page
 * px, clipped to the page), as Goodnotes places its zoom window. It is the
 * window's shape (`windowW` x `windowH` CSS px), magnified
 * {@link ZOOM_BOX_PLACED_MAGNIFICATION} times over the page at `viewScale`
 * CSS px per page px, and never wider than what is in view. Null when there
 * is nothing to place it on.
 */
export function placedZoomBox(
  visible: { minX: number; minY: number; maxX: number; maxY: number },
  page: { width: number; height: number },
  windowW: number,
  windowH: number,
  viewScale: number,
  magnification = ZOOM_BOX_PLACED_MAGNIFICATION,
): ZoomRect | null {
  const vw = visible.maxX - visible.minX;
  const vh = visible.maxY - visible.minY;
  const k = viewScale * magnification;
  if (
    ![vw, vh, windowW, windowH, k, page.width, page.height].every(
      (n) => Number.isFinite(n) && n > 0,
    )
  ) {
    return null;
  }
  let w = windowW / k;
  let h = windowH / k;
  // Wider than the page in view (a phone, zoomed far out): shrunk, its shape kept.
  const fit = Math.min(1, (vw * (1 - 2 * ZOOM_BOX_PLACED_INSET)) / w);
  w *= fit;
  h *= fit;
  const inset = Math.min(vw, vh) * ZOOM_BOX_PLACED_INSET;
  return clampZoomBox(
    { x: visible.minX + inset, y: visible.minY + inset, w, h },
    page.width,
    page.height,
  );
}

/** The smallest target box a marquee or a resize may make, in page px. */
export const ZOOM_BOX_MIN = 24;
/** A step left or right moves the box this much of its own width. */
export const ZOOM_BOX_STEP = 0.7;
/** Auto-advance moves this much of the box width after a stroke reaches the trigger. */
export const ZOOM_AUTO_ADVANCE_STEP = 0.65;
/** A pause after the stroke, so dots and crosses can be finished first. */
export const ZOOM_AUTO_ADVANCE_DELAY_MS = 400;
/** One press of − or + changes the magnification by this factor. */
export const ZOOM_STEP = 1.25;

/** What the floating window shows: a uniform scale and its centred content. */
export interface ZoomView {
  /** CSS px per page px. */
  scale: number;
  /** Where the target box starts inside the window, in CSS px. */
  offsetX: number;
  offsetY: number;
  /** The target box's size inside the window, in CSS px. */
  width: number;
  height: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** A drag's two corners as a box inside the page, or null when it is too small. */
export function zoomBoxFromPoints(
  from: { x: number; y: number },
  to: { x: number; y: number },
  pageWidth: number,
  pageHeight: number,
  min = ZOOM_BOX_MIN,
): ZoomRect | null {
  const left = clamp(Math.min(from.x, to.x), 0, pageWidth);
  const top = clamp(Math.min(from.y, to.y), 0, pageHeight);
  const right = clamp(Math.max(from.x, to.x), 0, pageWidth);
  const bottom = clamp(Math.max(from.y, to.y), 0, pageHeight);
  const w = right - left;
  const h = bottom - top;
  if (w < min || h < min) return null;
  return { x: left, y: top, w, h };
}

/** The box kept inside the page: no larger than it, never off an edge. */
export function clampZoomBox(
  box: ZoomRect,
  pageWidth: number,
  pageHeight: number,
  min = ZOOM_BOX_MIN,
): ZoomRect {
  const w = clamp(box.w, Math.min(min, pageWidth), pageWidth);
  const h = clamp(box.h, Math.min(min, pageHeight), pageHeight);
  return {
    x: clamp(box.x, 0, pageWidth - w),
    y: clamp(box.y, 0, pageHeight - h),
    w,
    h,
  };
}

/** A whole box moved by a page-space delta, kept on the page. */
export function moveZoomBox(
  box: ZoomRect,
  dx: number,
  dy: number,
  pageWidth: number,
  pageHeight: number,
): ZoomRect {
  return clampZoomBox({ ...box, x: box.x + dx, y: box.y + dy }, pageWidth, pageHeight);
}

/**
 * A handle drag. An edge moves only that edge. A corner keeps the box's aspect
 * ratio, anchored on the opposite corner, as a picture's square handles do;
 * its magnification therefore changes while the shape of the view stays put.
 */
export function resizeZoomBox(
  box: ZoomRect,
  handle: ZoomHandle,
  dx: number,
  dy: number,
  pageWidth: number,
  pageHeight: number,
  min = ZOOM_BOX_MIN,
): ZoomRect {
  if (handle.length === 2) {
    const west = handle.includes("w");
    const north = handle.includes("n");
    const anchorX = west ? box.x + box.w : box.x;
    const anchorY = north ? box.y + box.h : box.y;
    const wantedW = Math.max(min, west ? box.w - dx : box.w + dx);
    const wantedH = Math.max(min, north ? box.h - dy : box.h + dy);
    // The axis that moved most decides the scale; a pure sideways or vertical
    // drag still resizes both sides together.
    const scale =
      Math.abs(wantedW / box.w - 1) >= Math.abs(wantedH / box.h - 1)
        ? wantedW / box.w
        : wantedH / box.h;
    const minScale = Math.max(min / box.w, min / box.h);
    const roomX = west ? anchorX : pageWidth - anchorX;
    const roomY = north ? anchorY : pageHeight - anchorY;
    const maxScale = Math.max(minScale, Math.min(roomX / box.w, roomY / box.h));
    const kept = clamp(scale, minScale, maxScale);
    const w = box.w * kept;
    const h = box.h * kept;
    return {
      x: west ? anchorX - w : anchorX,
      y: north ? anchorY - h : anchorY,
      w,
      h,
    };
  }
  let left = box.x;
  let top = box.y;
  let right = box.x + box.w;
  let bottom = box.y + box.h;
  if (handle.includes("w")) left = clamp(left + dx, 0, right - min);
  if (handle.includes("e")) right = clamp(right + dx, left + min, pageWidth);
  if (handle.includes("n")) top = clamp(top + dy, 0, bottom - min);
  if (handle.includes("s")) bottom = clamp(bottom + dy, top + min, pageHeight);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** Step the target box left or right by {@link ZOOM_BOX_STEP} of its width. */
export function stepZoomBox(
  box: ZoomRect,
  direction: -1 | 1,
  pageWidth: number,
  pageHeight: number,
): ZoomRect {
  return moveZoomBox(box, Math.round(box.w * ZOOM_BOX_STEP) * direction, 0, pageWidth, pageHeight);
}

/** Step back horizontally, or return to the end of the preceding line. */
export function previousZoomBox(
  box: ZoomRect,
  pageWidth: number,
  pageHeight: number,
  lineStepOffset = 0,
): ZoomRect {
  if (box.x > 0) return stepZoomBox(box, -1, pageWidth, pageHeight);
  const y = clamp(box.y - box.h - lineStepOffset, 0, pageHeight - box.h);
  return { ...box, x: pageWidth - box.w, y };
}

/**
 * Return to the line's left edge and move down one box height plus the user's
 * offset. A negative offset lets consecutive lines overlap a taller box.
 */
export function newLineZoomBox(
  box: ZoomRect,
  originX: number,
  pageWidth: number,
  pageHeight: number,
  lineStepOffset = 0,
): ZoomRect {
  const x = clamp(originX, 0, pageWidth - box.w);
  const y = clamp(box.y + box.h + lineStepOffset, 0, pageHeight - box.h);
  return { ...box, x, y };
}

/** Whether a stroke reached far enough right in the box to ask for more room. */
export function zoomAutoAdvanceDue(x: number, box: ZoomRect, threshold = 33): boolean {
  return x >= box.x + box.w * (1 - zoomAutoAdvanceThreshold(threshold) / 100);
}

/** Clamp the user setting for the portion of the box that triggers advance. */
export function zoomAutoAdvanceThreshold(value = 33): number {
  return Number.isFinite(value) ? Math.max(10, Math.min(50, value)) : 33;
}

/**
 * The auto-advance step: move right by part of a box while the line has room,
 * then wrap to the next line. The right edge is the last stop, so a partial
 * step clamps there rather than jumping past it.
 */
export function autoAdvanceZoomBox(
  box: ZoomRect,
  originX: number,
  pageWidth: number,
  pageHeight: number,
  lineStepOffset = 0,
): ZoomRect {
  const right = Math.max(0, pageWidth - box.w);
  if (box.x < right) {
    const step = Math.max(1, Math.round(box.w * ZOOM_AUTO_ADVANCE_STEP));
    return { ...box, x: Math.min(right, box.x + step) };
  }
  return newLineZoomBox(box, originX, pageWidth, pageHeight, lineStepOffset);
}

/** The desk inside the window, matching the page's workspace even off-page. */
export function zoomDeskColor(rendererDesk: string | null | undefined, workspace: string): string {
  return rendererDesk ?? workspace;
}

/**
 * The inverse of the zoom step: a larger factor makes the target box smaller,
 * so the same window shows the same box at a greater magnification.
 */
export function scaleZoomBox(
  box: ZoomRect,
  factor: number,
  pageWidth: number,
  pageHeight: number,
  min = ZOOM_BOX_MIN,
): ZoomRect {
  const w = clamp(box.w / factor, min, pageWidth);
  const h = clamp(box.h / factor, min, pageHeight);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  return clampZoomBox({ x: cx - w / 2, y: cy - h / 2, w, h }, pageWidth, pageHeight, min);
}

/** The uniform scale and centred box a target box gets in a window. */
export function zoomView(box: ZoomRect, width: number, height: number): ZoomView {
  const scale = Math.max(0.01, Math.min(width / box.w, height / box.h));
  const contentWidth = box.w * scale;
  const contentHeight = box.h * scale;
  return {
    scale,
    offsetX: (width - contentWidth) / 2,
    offsetY: (height - contentHeight) / 2,
    width: contentWidth,
    height: contentHeight,
  };
}

/** A point in the window, in page px; null in the margins around the content. */
export function zoomViewPoint(
  box: ZoomRect,
  view: ZoomView,
  x: number,
  y: number,
): { x: number; y: number } | null {
  if (x < view.offsetX || y < view.offsetY) return null;
  if (x > view.offsetX + view.width || y > view.offsetY + view.height) return null;
  return zoomViewPointFree(box, view, x, y);
}

/**
 * A point in the window, in page px, wherever it is: a pen that went down
 * inside the content keeps its stroke when it runs past the content's edge,
 * as it does past the edge of the pane on the page.
 */
export function zoomViewPointFree(
  box: ZoomRect,
  view: ZoomView,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: box.x + (x - view.offsetX) / view.scale,
    y: box.y + (y - view.offsetY) / view.scale,
  };
}

/**
 * How far to pan the page so `box` sits `margin` page px inside `view`, which
 * is the visible page-space rectangle. Zero when it already does; the smallest
 * move when it does not.
 */
export function panToShow(
  box: ZoomRect,
  view: { x: number; y: number; w: number; h: number },
  margin: number,
): { x: number; y: number } {
  const innerW = Math.max(0, view.w - 2 * margin);
  const innerH = Math.max(0, view.h - 2 * margin);
  const panAxis = (
    start: number,
    size: number,
    viewStart: number,
    viewSize: number,
    inner: number,
  ): number => {
    if (size >= inner) return start - (viewStart + margin);
    const before = viewStart + margin;
    const after = viewStart + viewSize - margin;
    if (start < before) return start - before;
    if (start + size > after) return start + size - after;
    return 0;
  };
  return {
    x: panAxis(box.x, box.w, view.x, view.w, innerW),
    y: panAxis(box.y, box.h, view.y, view.h, innerH),
  };
}
