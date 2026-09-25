/**
 * Placed-image geometry: the rotated rectangle an `ImageElement` occupies,
 * hit-testing it and its selection handles, and the move / resize / rotate
 * maths a drag applies to it. Pure — no DOM, no canvas, no Obsidian.
 *
 * An image is stored as its **unrotated** box (`x, y` top-left, `w, h`) plus
 * a rotation in radians, clockwise about the box's centre (contracts/api.md
 * §1). Clockwise is with y pointing down, so it is the same sense as
 * `CanvasRenderingContext2D.rotate` and CSS `rotate()` — the three agree
 * without a sign flip anywhere.
 *
 * Everything here is in **page space**. The selection chrome is sized in
 * screen px so it stays usable at any zoom, so callers convert those sizes
 * first: `HANDLE_HIT_RADIUS_PX / viewScale` is the handle radius in page px.
 * The lasso (and anything else that selects images) should reuse these
 * functions rather than re-deriving rotated-rect maths.
 */

import type { Bounds } from "../model/document";
import type { ImageTransform } from "../model/commands";

export interface Pt {
  x: number;
  y: number;
}

export type ImageCorner = "nw" | "ne" | "se" | "sw";

/** The middle of one edge: GoodNotes' round handles, which stretch in one direction. */
export type ImageEdge = "n" | "e" | "s" | "w";

/** A resize handle: a corner (aspect kept) or an edge (stretch). */
export type ImageHandle = ImageCorner | ImageEdge;

/** What a press on a selected image grabbed. */
export type ImagePart = ImageHandle | "rotate" | "body";

export const IMAGE_CORNERS: readonly ImageCorner[] = ["nw", "ne", "se", "sw"];

export const IMAGE_EDGES: readonly ImageEdge[] = ["n", "e", "s", "w"];

/** Half of a 44 px touch target (Apple's minimum), in screen px. */
export const HANDLE_HIT_RADIUS_PX = 22;
/**
 * How far below the bottom edge the rotate knob's centre sits, in screen px
 * (GoodNotes hangs it there on a short stem). Twice the hit radius, so the
 * knob's 44 px target and the bottom edge handle's meet without overlapping.
 */
export const ROTATE_HANDLE_OFFSET_PX = 44;
/**
 * A pair of edge handles is offered only on an edge at least this many hit
 * radii long: on a shorter one they would crowd the corners out.
 */
export const EDGE_HANDLE_ROOM = 3;
/** Smallest a resize may make an image's shorter side, in page px. */
export const MIN_IMAGE_SIDE = 24;
/** A rotation this close to a quarter turn snaps onto it, in degrees. */
export const ROTATION_SNAP_DEG = 4;

/** Rotations smaller than this are "no rotation" and are not stored. */
const ROTATION_EPSILON = 1e-9;

/** Signs of each corner in the image's own frame: nw is (-1, -1). */
const CORNER_SIGNS: Readonly<Record<ImageCorner, readonly [number, number]>> = {
  nw: [-1, -1],
  ne: [1, -1],
  se: [1, 1],
  sw: [-1, 1],
};

/** The same for the middle of each edge: n is (0, -1). */
const EDGE_SIGNS: Readonly<Record<ImageEdge, readonly [number, number]>> = {
  n: [0, -1],
  e: [1, 0],
  s: [0, 1],
  w: [-1, 0],
};

/** Signs of any handle in the image's own frame. */
export function handleSigns(handle: ImageHandle): readonly [number, number] {
  return handle.length === 2
    ? CORNER_SIGNS[handle as ImageCorner]
    : EDGE_SIGNS[handle as ImageEdge];
}

/** Whether a handle is a corner (aspect kept) rather than an edge (stretch). */
export function isCorner(handle: ImageHandle): handle is ImageCorner {
  return handle.length === 2;
}

/** The rotation to draw with: 0 when absent or not a finite number. */
export function rotationOf(box: ImageTransform): number {
  const r = box.rotation;
  return typeof r === "number" && Number.isFinite(r) ? r : 0;
}

/** Wrap an angle into (-π, π]. */
export function normalizeAngle(angle: number): number {
  if (!Number.isFinite(angle)) return 0;
  const turn = Math.PI * 2;
  let a = angle % turn;
  if (a <= -Math.PI) a += turn;
  if (a > Math.PI) a -= turn;
  return a;
}

/** Snap onto the nearest quarter turn when within `snapDeg`; otherwise unchanged. */
export function snapAngle(angle: number, snapDeg = ROTATION_SNAP_DEG): number {
  const quarter = Math.PI / 2;
  const nearest = Math.round(angle / quarter) * quarter;
  const tolerance = (Math.abs(snapDeg) * Math.PI) / 180;
  return Math.abs(angle - nearest) <= tolerance ? normalizeAngle(nearest) : normalizeAngle(angle);
}

/**
 * A box with `rotation` set only when it is a real rotation. Keeping "no
 * rotation" absent rather than `0` is what lets an undo restore a document
 * `JSON.stringify`-identical (contracts/api.md §3).
 */
export function withRotation(
  box: { x: number; y: number; w: number; h: number },
  rotation: number,
): ImageTransform {
  const r = normalizeAngle(rotation);
  const out: ImageTransform = { x: box.x, y: box.y, w: box.w, h: box.h };
  if (Math.abs(r) > ROTATION_EPSILON) out.rotation = r;
  return out;
}

/** An element's geometry as a transform, dropping any id or path. */
export function transformOf(image: ImageTransform): ImageTransform {
  return withRotation(image, rotationOf(image));
}

/** Whether two boxes are the same geometry, to within `eps` page px / radians. */
export function sameTransform(a: ImageTransform, b: ImageTransform, eps = 1e-6): boolean {
  return (
    Math.abs(a.x - b.x) <= eps &&
    Math.abs(a.y - b.y) <= eps &&
    Math.abs(a.w - b.w) <= eps &&
    Math.abs(a.h - b.h) <= eps &&
    Math.abs(normalizeAngle(rotationOf(a) - rotationOf(b))) <= eps
  );
}

export function imageCentre(box: ImageTransform): Pt {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

/** Rotate a vector clockwise (y down) by `angle` radians. */
function rotate(v: Pt, angle: number): Pt {
  if (angle === 0) return { x: v.x, y: v.y };
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/** Page point -> the image's own frame: relative to its centre, rotation undone. */
export function toImageLocal(box: ImageTransform, p: Pt): Pt {
  const c = imageCentre(box);
  return rotate({ x: p.x - c.x, y: p.y - c.y }, -rotationOf(box));
}

/** The image's own frame -> page point. Inverse of {@link toImageLocal}. */
export function fromImageLocal(box: ImageTransform, local: Pt): Pt {
  const c = imageCentre(box);
  const v = rotate(local, rotationOf(box));
  return { x: c.x + v.x, y: c.y + v.y };
}

/** One corner of the rotated box, in page space. */
export function imageCorner(box: ImageTransform, corner: ImageCorner): Pt {
  const [sx, sy] = CORNER_SIGNS[corner];
  return fromImageLocal(box, { x: (sx * box.w) / 2, y: (sy * box.h) / 2 });
}

/** The four corners of the rotated box, nw · ne · se · sw, in page space. */
export function imageCorners(box: ImageTransform): Pt[] {
  return IMAGE_CORNERS.map((corner) => imageCorner(box, corner));
}

/** Axis-aligned bounds of the rotated box: what a tile or a cull must cover. */
export function imageBounds(box: ImageTransform): Bounds {
  const corners = imageCorners(box);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of corners) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

/** Whether a page point lies inside the rotated box, grown by `pad` on every side. */
export function pointInImage(box: ImageTransform, p: Pt, pad = 0): boolean {
  const local = toImageLocal(box, p);
  return Math.abs(local.x) <= box.w / 2 + pad && Math.abs(local.y) <= box.h / 2 + pad;
}

/**
 * The topmost image under a page point, or `null`. Images paint in array
 * order, so the last one hit is the one on top.
 */
export function topImageAt<T extends ImageTransform>(
  images: readonly T[],
  p: Pt,
  pad = 0,
): T | null {
  for (let i = images.length - 1; i >= 0; i--) {
    if (pointInImage(images[i], p, pad)) return images[i];
  }
  return null;
}

/** Where any resize handle sits on the rotated box, in page space. */
export function imageHandlePoint(box: ImageTransform, handle: ImageHandle): Pt {
  const [sx, sy] = handleSigns(handle);
  return fromImageLocal(box, { x: (sx * box.w) / 2, y: (sy * box.h) / 2 });
}

/**
 * Where the rotate knob sits: `offset` page px below the bottom edge's
 * middle, turning with the image (GoodNotes hangs it there, clear of the
 * action bar above the picture).
 */
export function rotateHandlePoint(box: ImageTransform, offset: number): Pt {
  return fromImageLocal(box, { x: 0, y: box.h / 2 + offset });
}

/**
 * Which pairs of edge handles a box offers at hit radius `radius` (page px):
 * `ns` the top and bottom ones, which sit on edges `w` long; `ew` the side
 * ones, on edges `h` long. An edge too short for three radii offers none.
 */
export function edgeHandlesFit(box: ImageTransform, radius: number): { ns: boolean; ew: boolean } {
  const room = EDGE_HANDLE_ROOM * Math.max(0, radius);
  return { ns: box.w >= room, ew: box.h >= room };
}

/**
 * What a press at page point `p` grabbed on a selected image: the rotate
 * knob, a corner or edge handle, the body, or nothing.
 *
 * `radius` and `offset` are the handle hit radius and the rotate knob's
 * distance below the image, already converted to page px; `offset: null`
 * means there is no knob (the crop frame). Outside the image a handle
 * answers across its whole radius (a 44 px target). Inside it, a handle
 * only claims the band of the image nearest to it — a corner its quarter, an
 * edge the strip along it — so the middle of even a small image can still be
 * grabbed to move it. Where two handles' targets meet, the nearer one wins.
 */
export function hitImagePart(
  box: ImageTransform,
  p: Pt,
  radius: number,
  offset: number | null,
): ImagePart | null {
  if (offset !== null) {
    const knob = rotateHandlePoint(box, offset);
    if (Math.hypot(p.x - knob.x, p.y - knob.y) <= radius) return "rotate";
  }

  const local = toImageLocal(box, p);
  const inside = Math.abs(local.x) <= box.w / 2 && Math.abs(local.y) <= box.h / 2;
  const qx = Math.min(radius, box.w / 4);
  const qy = Math.min(radius, box.h / 4);
  let best: ImageHandle | null = null;
  let bestDistance = Infinity;
  for (const handle of offeredHandles(box, radius)) {
    const c = imageHandlePoint(box, handle);
    const d = Math.hypot(p.x - c.x, p.y - c.y);
    if (d > radius || d >= bestDistance) continue;
    if (inside) {
      const [sx, sy] = handleSigns(handle);
      if (sx !== 0 && sx * local.x < box.w / 2 - qx) continue;
      if (sy !== 0 && sy * local.y < box.h / 2 - qy) continue;
    }
    best = handle;
    bestDistance = d;
  }
  if (best) return best;
  return inside ? "body" : null;
}

/** The handles a box offers at hit radius `radius`: every corner, and the edges that fit. */
export function offeredHandles(box: ImageTransform, radius: number): ImageHandle[] {
  const fit = edgeHandlesFit(box, radius);
  const handles: ImageHandle[] = [...IMAGE_CORNERS];
  if (fit.ns) handles.push("n", "s");
  if (fit.ew) handles.push("e", "w");
  return handles;
}

/**
 * Translate a box. With `page`, the move stops when the box's centre reaches
 * the page edge: an image may hang off the page, as ink may, but never so far
 * that nothing is left to grab.
 */
export function moveImage(
  start: ImageTransform,
  dx: number,
  dy: number,
  page?: { width: number; height: number },
): ImageTransform {
  let x = start.x + dx;
  let y = start.y + dy;
  if (page) {
    x = clamp(x + start.w / 2, 0, page.width) - start.w / 2;
    y = clamp(y + start.h / 2, 0, page.height) - start.h / 2;
  }
  return withRotation({ x, y, w: start.w, h: start.h }, rotationOf(start));
}

/**
 * Drag one corner: the opposite corner stays put and the aspect ratio is
 * kept. Works in the image's own frame, so a rotated image resizes along its
 * own edges. The pointer is projected onto the diagonal, which makes the
 * size follow the pen smoothly whichever way it strays; dragging across the
 * anchor stops at `minSide` rather than flipping the image.
 */
export function resizeImage(
  start: ImageTransform,
  corner: ImageCorner,
  pointer: Pt,
  minSide = MIN_IMAGE_SIDE,
): ImageTransform {
  const [sx, sy] = CORNER_SIGNS[corner];
  const angle = rotationOf(start);
  const { w, h } = start;
  if (!(w > 0) || !(h > 0)) return transformOf(start);
  const anchor = fromImageLocal(start, { x: (-sx * w) / 2, y: (-sy * h) / 2 });
  const d = rotate({ x: pointer.x - anchor.x, y: pointer.y - anchor.y }, -angle);
  const along = (d.x * sx * w + d.y * sy * h) / (w * w + h * h);
  const k = Math.max(along, Math.max(0, minSide) / Math.min(w, h));
  const nw = w * k;
  const nh = h * k;
  const offset = rotate({ x: (sx * nw) / 2, y: (sy * nh) / 2 }, angle);
  const cx = anchor.x + offset.x;
  const cy = anchor.y + offset.y;
  return withRotation({ x: cx - nw / 2, y: cy - nh / 2, w: nw, h: nh }, angle);
}

/**
 * Drag the middle of one edge: the picture stretches in that one direction
 * only (GoodNotes' round handles), the opposite edge stays put and the other
 * side keeps its length. Works in the image's own frame, so a rotated image
 * stretches along its own axis. Dragging across the opposite edge stops at
 * `minSide` rather than flipping the image.
 */
export function stretchImage(
  start: ImageTransform,
  edge: ImageEdge,
  pointer: Pt,
  minSide = MIN_IMAGE_SIDE,
): ImageTransform {
  const [sx, sy] = EDGE_SIGNS[edge];
  const angle = rotationOf(start);
  const { w, h } = start;
  if (!(w > 0) || !(h > 0)) return transformOf(start);
  const min = Math.max(0, minSide);
  // The middle of the opposite edge, which stays where it is.
  const anchor = fromImageLocal(start, { x: (-sx * w) / 2, y: (-sy * h) / 2 });
  const d = rotate({ x: pointer.x - anchor.x, y: pointer.y - anchor.y }, -angle);
  const nw = sx === 0 ? w : Math.max(min, sx * d.x);
  const nh = sy === 0 ? h : Math.max(min, sy * d.y);
  const offset = rotate({ x: (sx * nw) / 2, y: (sy * nh) / 2 }, angle);
  const cx = anchor.x + offset.x;
  const cy = anchor.y + offset.y;
  return withRotation({ x: cx - nw / 2, y: cy - nh / 2, w: nw, h: nh }, angle);
}

/** Drag any resize handle: a corner keeps the aspect, an edge stretches. */
export function dragImageHandle(
  start: ImageTransform,
  handle: ImageHandle,
  pointer: Pt,
  minSide = MIN_IMAGE_SIDE,
): ImageTransform {
  return isCorner(handle)
    ? resizeImage(start, handle, pointer, minSide)
    : stretchImage(start, handle, pointer, minSide);
}

/**
 * Turn a box about its centre by the angle the pointer swept from `from` to
 * `to`, snapping onto quarter turns (GoodNotes snaps an image square too).
 */
export function rotateImage(
  start: ImageTransform,
  from: Pt,
  to: Pt,
  snapDeg = ROTATION_SNAP_DEG,
): ImageTransform {
  const c = imageCentre(start);
  const a0 = Math.atan2(from.y - c.y, from.x - c.x);
  const a1 = Math.atan2(to.y - c.y, to.x - c.x);
  if (Math.hypot(to.x - c.x, to.y - c.y) < 1e-6 || Math.hypot(from.x - c.x, from.y - c.y) < 1e-6) {
    return transformOf(start);
  }
  return withRotation(start, snapAngle(rotationOf(start) + a1 - a0, snapDeg));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
