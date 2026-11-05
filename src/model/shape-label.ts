/**
 * Text typed inside a shape (discussion #148, Goodnotes' double tap): which
 * shapes take it, the area of the shape it wraps in, where the box sits so
 * the text is centred in that area, and how much taller the shape must grow
 * when the text no longer fits. The text is a text box tied to the shape by
 * `TextBoxElement.onShape`; its frame is derived from the shape whenever
 * either changes, so it follows a move, a resize or a turn.
 *
 * Pure: no DOM, no Obsidian. The view measures the text's height (as the
 * canvas lays it out) and hands it in.
 */

import { POINT_STRIDE, type Bounds, type Stroke, type TextBoxElement } from "./document";
import { canFill, isClosedLoop } from "./shape-style";

/** Room kept between a shape's edge and its text, page px, on a rectangle. */
export const LABEL_MARGIN = 8;

/** The least room a label area keeps, page px, so a tiny shape still has a caret. */
const MIN_AREA = 12;

/** The share of a circle's or ellipse's box the inscribed rectangle takes (1/√2). */
const INSCRIBED = Math.SQRT1_2;

/** Whether text can be typed in `stroke`: a closed shape with an inside (rect, circle, triangle, …). */
export function takesLabel(stroke: Stroke): boolean {
  return (
    stroke.tool === "pen" &&
    stroke.onSticky === undefined &&
    canFill(stroke.shape) &&
    isClosedLoop(stroke.pts)
  );
}

/** A stroke's bounds (its points, not its width). */
export function shapeBox(stroke: Stroke): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const usable = stroke.pts.length - (stroke.pts.length % POINT_STRIDE);
  for (let i = 0; i < usable; i += POINT_STRIDE) {
    const x = stroke.pts[i];
    const y = stroke.pts[i + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return minX <= maxX && minY <= maxY ? { minX, minY, maxX, maxY } : null;
}

/** An area inside a shape: where its text wraps, page px. */
export interface LabelArea {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where a shape's text wraps: inside the outline, clear of the line. A
 * rectangle's box less a margin; the rectangle inscribed in a circle or
 * ellipse; the middle half of a diamond; the lower middle of a triangle,
 * where it is wide enough; the inscribed share of any other shape's box.
 */
export function labelArea(stroke: Stroke): LabelArea | null {
  const box = shapeBox(stroke);
  if (!box) return null;
  const w = box.maxX - box.minX;
  const h = box.maxY - box.minY;
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const margin = LABEL_MARGIN + stroke.size / 2;
  let aw: number;
  let ah: number;
  let acy = cy;
  switch (stroke.shape) {
    case "rect":
      aw = w - 2 * margin;
      ah = h - 2 * margin;
      break;
    case "diamond":
      aw = w / 2 - margin;
      ah = h / 2 - margin;
      break;
    case "triangle":
      // The widest rectangle under an apex at the top: half the base, the lower half.
      aw = w / 2 - margin;
      ah = h / 2 - margin;
      acy = box.minY + (3 * h) / 4 - margin / 2;
      break;
    default:
      // Circles, ellipses and everything round or many-sided.
      aw = w * INSCRIBED - margin;
      ah = h * INSCRIBED - margin;
  }
  aw = Math.max(MIN_AREA, aw);
  ah = Math.max(MIN_AREA, ah);
  return { x: cx - aw / 2, y: acy - ah / 2, w: aw, h: ah };
}

/** A label box's frame in its shape: as wide as the area, its text centred in it. */
export function labelFrame(
  area: LabelArea,
  textHeight: number,
): { x: number; y: number; w: number } {
  return { x: area.x, y: area.y + (area.h - textHeight) / 2, w: area.w };
}

/**
 * The shape's points once it is tall enough for text `textHeight` high:
 * stretched downwards from its top, so its text area holds the text, or
 * `null` when it already fits. A shape only grows; it never shrinks back.
 * A fresh array, as every command that reshapes a stroke makes one.
 */
export function grownToFit(stroke: Stroke, textHeight: number): number[] | null {
  const area = labelArea(stroke);
  const box = shapeBox(stroke);
  if (!area || !box || !(textHeight > area.h + 0.5)) return null;
  const h = box.maxY - box.minY;
  if (!(h > 0)) return null;
  // The text area is a share of the shape's height less a margin; grow the
  // shape by what the area lacks, in the area's own proportion to the shape.
  const share = Math.max(0.1, (area.h + 2 * LABEL_MARGIN) / h);
  const growth = (textHeight - area.h) / share;
  const k = (h + growth) / h;
  const pts = stroke.pts.slice();
  const usable = pts.length - (pts.length % POINT_STRIDE);
  for (let i = 0; i < usable; i += POINT_STRIDE) {
    pts[i + 1] = box.minY + (pts[i + 1] - box.minY) * k;
  }
  return pts;
}

/** Whether page point (x, y) is inside a closed shape's outline (even-odd). */
export function insideShape(shape: Stroke, x: number, y: number): boolean {
  const pts = shape.pts;
  const n = Math.floor(pts.length / POINT_STRIDE);
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i * POINT_STRIDE];
    const yi = pts[i * POINT_STRIDE + 1];
    const xj = pts[j * POINT_STRIDE];
    const yj = pts[j * POINT_STRIDE + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The share of a stroke's points that must lie in a shape for it to be the shape's content. */
const CONTENT_SHARE = 0.9;

/**
 * Whether `stroke` is written in `shape` (discussion #148: "content moves
 * along the shape"): nearly all its points inside the outline, whichever was
 * drawn first. A shape is never its own content.
 */
export function holdsStroke(shape: Stroke, stroke: Stroke): boolean {
  if (stroke === shape || stroke.id === shape.id) return false;
  const n = Math.floor(stroke.pts.length / POINT_STRIDE);
  if (n === 0) return false;
  let inside = 0;
  for (let i = 0; i < n; i++) {
    if (insideShape(shape, stroke.pts[i * POINT_STRIDE], stroke.pts[i * POINT_STRIDE + 1])) {
      inside++;
    }
  }
  return inside >= Math.ceil(n * CONTENT_SHARE);
}

/** Whether a text box `h` page px tall is written in `shape`: its middle inside the outline. */
export function holdsBox(shape: Stroke, box: TextBoxElement, h: number): boolean {
  if (box.onShape === shape.id) return true;
  return insideShape(shape, box.x + box.w / 2, box.y + h / 2);
}

/** The text box typed in shape `strokeId` on a page, if there is one. */
export function labelOf(
  textBoxes: readonly TextBoxElement[],
  strokeId: string,
): TextBoxElement | undefined {
  return textBoxes.find((box) => box.onShape === strokeId && box.join === undefined);
}
