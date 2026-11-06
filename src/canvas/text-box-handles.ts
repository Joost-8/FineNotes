/**
 * The handles of a selected text box (Goodnotes' layout, discussion with
 * Joost 2026-11-06): the box itself moves it, a pill on each side sets the
 * width (the text rewraps, the height keeps following the text), and a
 * square on each corner scales the text with the box about the opposite
 * corner. PURE: page-space geometry only.
 */

/** A side pill: the left or the right edge. */
export type TextSide = "w" | "e";
/** A corner square. */
export type TextCorner = "nw" | "ne" | "sw" | "se";

/** A text box's frame in page px; `h` is its height as drawn. */
export interface TextFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The box's new left edge and width when the `side` pill is dragged `dx`
 * page px: the other edge stays, the width stays at least `minW`, and the
 * box stays on the page (`pageW` wide). A box already narrower than `minW`
 * keeps its width rather than jumping.
 */
export function dragSide(
  start: Pick<TextFrame, "x" | "w">,
  side: TextSide,
  dx: number,
  pageW: number,
  minW: number,
): { x: number; w: number } {
  const floor = Math.min(minW, start.w);
  if (side === "e") {
    const room = Math.max(floor, pageW - start.x);
    return { x: start.x, w: clamp(start.w + dx, floor, room) };
  }
  const right = start.x + start.w;
  const x = clamp(start.x + dx, Math.min(0, right - floor), right - floor);
  return { x, w: right - x };
}

/** The corner a corner square scales about: the one across from it. */
export function anchorOf(frame: TextFrame, corner: TextCorner): { x: number; y: number } {
  return {
    x: corner === "nw" || corner === "sw" ? frame.x + frame.w : frame.x,
    y: corner === "nw" || corner === "ne" ? frame.y + frame.h : frame.y,
  };
}

/**
 * The scale a corner drag gives: the dragged corner follows the pointer's
 * travel projected on the box's diagonal, so the box keeps its shape. `k` is
 * kept so the font stays within `[minFont, maxFont]` and the scaled box
 * stays on the page (`pageW` × `pageH`); never below what keeps it there,
 * never negative.
 */
export function dragCorner(
  start: TextFrame,
  corner: TextCorner,
  dx: number,
  dy: number,
  fontSize: number,
  minFont: number,
  maxFont: number,
  pageW: number,
  pageH: number,
): { k: number; ax: number; ay: number } {
  const a = anchorOf(start, corner);
  const cx = corner === "nw" || corner === "sw" ? start.x : start.x + start.w;
  const cy = corner === "nw" || corner === "ne" ? start.y : start.y + start.h;
  const vx = cx - a.x;
  const vy = cy - a.y;
  const len2 = vx * vx + vy * vy;
  let k = len2 > 0 ? 1 + (dx * vx + dy * vy) / len2 : 1;
  if (!Number.isFinite(k)) k = 1;
  // How far the box may grow before it leaves the page, from its anchor.
  const roomX = vx > 0 ? (pageW - a.x) / start.w : vx < 0 ? a.x / start.w : Infinity;
  const roomY = vy > 0 ? (pageH - a.y) / start.h : vy < 0 ? a.y / start.h : Infinity;
  const fontMax = fontSize > 0 ? maxFont / fontSize : Infinity;
  const fontMin = fontSize > 0 ? minFont / fontSize : 0;
  const hi = Math.max(1, Math.min(roomX, roomY, fontMax));
  const lo = Math.min(1, Math.max(fontMin, 0.01));
  return { k: clamp(k, lo, hi), ax: a.x, ay: a.y };
}

// --- A turned box (`TextBoxElement.rotation`, about its top-left corner) ---

/** A vector turned by `r` radians (clockwise on the page, y down). */
export function turnVec(x: number, y: number, r: number): { x: number; y: number } {
  if (r === 0) return { x, y };
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: x * c - y * s, y: x * s + y * c };
}

/** Where the point at (`u`, `v`) of the unturned box lands once turned by `r`. */
export function turnedPoint(
  frame: TextFrame,
  r: number,
  u: number,
  v: number,
): { x: number; y: number } {
  const d = turnVec(u - frame.x, v - frame.y, r);
  return { x: frame.x + d.x, y: frame.y + d.y };
}

/** A page point in the unturned box's coordinates (page px, as `x`, `y`). */
export function unturnedPoint(
  frame: TextFrame,
  r: number,
  p: { x: number; y: number },
): { x: number; y: number } {
  const d = turnVec(p.x - frame.x, p.y - frame.y, -r);
  return { x: frame.x + d.x, y: frame.y + d.y };
}

/** Whether `p` is on the turned box. */
export function onTurnedBox(frame: TextFrame, r: number, p: { x: number; y: number }): boolean {
  const q = unturnedPoint(frame, r, p);
  return q.x >= frame.x && q.x <= frame.x + frame.w && q.y >= frame.y && q.y <= frame.y + frame.h;
}

/** The upright box around the turned one: what it covers on the page. */
export function turnedBounds(frame: TextFrame, r: number): TextFrame {
  if (r === 0) return { ...frame };
  const corners = [
    turnedPoint(frame, r, frame.x, frame.y),
    turnedPoint(frame, r, frame.x + frame.w, frame.y),
    turnedPoint(frame, r, frame.x, frame.y + frame.h),
    turnedPoint(frame, r, frame.x + frame.w, frame.y + frame.h),
  ];
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/**
 * Where a box's corner (`x`, `y`) must go for it to turn to `r` about its
 * middle rather than its corner: the knob turns a box as the eye expects,
 * while the stored turn stays about the corner.
 */
export function turnAboutMiddle(frame: TextFrame, r: number): { x: number; y: number } {
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;
  const half = turnVec(frame.w / 2, frame.h / 2, r);
  return { x: cx - half.x, y: cy - half.y };
}

/**
 * A side drag on a turned box: `dragSide` in the box's own axes, then the
 * corner moved so the edge that is not dragged stays where it was on the
 * page. `dx`, `dy` are page px.
 */
export function dragTurnedSide(
  start: TextFrame,
  r: number,
  side: TextSide,
  dx: number,
  dy: number,
  pageW: number,
  minW: number,
): { x: number; y: number; w: number } {
  const along = turnVec(dx, dy, -r).x;
  // Turned, the page's edge says nothing about the box's own axis.
  const room = r === 0 ? pageW : Infinity;
  const next = dragSide(start, side, along, room, minW);
  if (r === 0) return { x: next.x, y: start.y, w: next.w };
  // The left pill moves the corner along the box's own top edge.
  const shift = turnVec(next.x - start.x, 0, r);
  return { x: start.x + shift.x, y: start.y + shift.y, w: next.w };
}

/** Whether a press has travelled far enough (screen px) to be a drag, not a tap. */
export function isDrag(dx: number, dy: number, slop: number): boolean {
  return Math.hypot(dx, dy) > slop;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
