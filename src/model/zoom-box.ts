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
 * A press on the target frame's badge, body or handles. The magnifier, the
 * badge and a finger always move the box, even with a writing tool in hand;
 * a pen or mouse on the body keeps drawing. A handle is a resize first.
 */
export function zoomTargetPress(
  magnifier: boolean,
  touch: boolean,
  handle: ZoomHandle | null,
  badge: boolean,
): ZoomTargetPress {
  if (handle) return handle;
  return badge || magnifier || touch ? "move" : "draw";
}

/** Whether the window may be dragged or resized by this pointer. */
export function zoomWindowDragAllowed(pointerType: string, onlyStylus: boolean): boolean {
  return !(onlyStylus && pointerType === "touch");
}

/** How the Magnifier button reads while a target box may be open. */
export function zoomButtonState(
  tool: string,
  boxOpen: boolean,
): { highlighted: boolean; pressed: boolean } {
  return { highlighted: boxOpen, pressed: tool === "zoom" || boxOpen };
}

/** A tap on the Magnifier button with a Zoom box open dismisses it. */
export function magnifierTapClosesZoomBox(tool: string, boxOpen: boolean): boolean {
  return tool === "zoom" && boxOpen;
}

/** The smallest target box a marquee or a resize may make, in page px. */
export const ZOOM_BOX_MIN = 24;
/** A step left or right moves the box this much of its own width. */
export const ZOOM_BOX_STEP = 0.7;
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
 * A handle drag: the grabbed edge or corner follows the pointer, with the box
 * at least `min` wide and tall and wholly on the page.
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

/** Return to the line's left edge and move down exactly one box height. */
export function newLineZoomBox(
  box: ZoomRect,
  originX: number,
  pageWidth: number,
  pageHeight: number,
): ZoomRect {
  const x = clamp(originX, 0, pageWidth - box.w);
  const y = clamp(box.y + box.h, 0, pageHeight - box.h);
  return { ...box, x, y };
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
