/**
 * Pinching a lasso selection with two fingers (discussion #51, as Notability
 * does): the pinch scales it, turns it and carries it at once, about the
 * point between the fingers where they landed. Pure — no DOM, no canvas.
 *
 * The motion is the one a selection drag already previews and commits: a
 * turn about `anchor`, a scale about the same point, then a move by
 * (`dx`, `dy`) — `ReorientElements`, `ScaleElements` and `TranslateElements`
 * in that order, as one undo step. A point p goes to
 * `anchor + (dx, dy) + k·R(angle)·(p − anchor)`. Text boxes, tables and
 * graphs stay upright under the turn (their middle goes round), as they do
 * under the knob's.
 *
 * Until the fingers have done something (`engaged`), the pinch moves
 * nothing and commits nothing: a two-finger tap on a selection, or the
 * two-finger double tap that undoes, must not nudge it by the jitter of
 * fingers landing.
 */

import type { Command } from "../model/commands";
import type { Bounds, TableElement, TextBoxElement } from "../model/document";
import { CompositeCommand } from "../model/page-commands";
import {
  type PageElements,
  ReorientElements,
  ScaleElements,
  TranslateElements,
} from "../model/selection-commands";
import { snapAngle } from "./image-geometry";
import { type Pt, boundsCentre, clampGroupDelta } from "./lasso";

/**
 * A pinch snaps onto quarter turns within this many degrees, so a pinch
 * meant only to scale does not tilt the selection by the turn of the hand.
 */
export const PINCH_SNAP_DEG = 6;
/** A pinch is one once it has scaled by this share (or turned, or moved its slop). */
export const PINCH_SCALE_SLOP = 0.04;

/** One report of the two fingers, as `FingerGesture` makes it, its centre in page px. */
export interface PinchStep {
  scaleFactor: number;
  /** Radians clockwise since the last step. */
  rotation: number;
  centre: Pt;
}

export interface SelectionPinch {
  /** Where the fingers' midpoint landed, page px. */
  from: Pt;
  /** Where it is now. */
  to: Pt;
  /** A move the selection already had when the pinch began: a finger was dragging it. */
  base: Pt;
  /** The steps' scale factors multiplied, unclamped. */
  k: number;
  /** The steps' turns added up, radians clockwise, unsnapped. */
  angle: number;
  /** The pinch has scaled, turned or moved enough to count; it stays so. */
  engaged: boolean;
}

/** The scale, turn and move a pinch gives a selection (see the top of the file). */
export interface PinchMotion {
  anchor: Pt;
  k: number;
  angle: number;
  dx: number;
  dy: number;
}

/** A pinch whose fingers' midpoint landed at `at` (page px), on a selection already moved by `base`. */
export function startPinch(at: Pt, base: Pt = { x: 0, y: 0 }): SelectionPinch {
  return { from: { ...at }, to: { ...at }, base: { ...base }, k: 1, angle: 0, engaged: false };
}

/**
 * The pinch after one more report of the fingers. `slop` is how far the
 * midpoint may wander, page px (the caller converts a screen length),
 * before a pinch that neither scaled nor turned counts as a move. A step
 * that is not finite is ignored.
 */
export function stepPinch(pinch: SelectionPinch, step: PinchStep, slop: number): SelectionPinch {
  const { scaleFactor, rotation, centre } = step;
  if (
    !(scaleFactor > 0) ||
    !Number.isFinite(scaleFactor) ||
    !Number.isFinite(rotation) ||
    !Number.isFinite(centre.x) ||
    !Number.isFinite(centre.y)
  ) {
    return pinch;
  }
  const k = pinch.k * scaleFactor;
  const angle = pinch.angle + rotation;
  const to = { x: centre.x, y: centre.y };
  const engaged =
    pinch.engaged ||
    Math.abs(k - 1) >= PINCH_SCALE_SLOP ||
    snapAngle(angle, PINCH_SNAP_DEG) !== 0 ||
    Math.hypot(to.x - pinch.from.x, to.y - pinch.from.y) >= slop;
  return { ...pinch, to, k, angle, engaged };
}

/**
 * What the pinch does to the selection: its scale kept within [`min`,
 * `max`] (as a corner resize keeps it), its turn snapped onto quarter turns.
 * Until it is engaged, only the move it began with.
 */
export function pinchMotion(
  pinch: SelectionPinch,
  min: number,
  max: number,
  snapDeg = PINCH_SNAP_DEG,
): PinchMotion {
  const { from, to, base } = pinch;
  // The anchor is where the fingers landed, in the selection's own (unmoved) place.
  const anchor = { x: from.x - base.x, y: from.y - base.y };
  if (!pinch.engaged) return { anchor, k: 1, angle: 0, dx: base.x, dy: base.y };
  const k = Math.min(Math.max(pinch.k, min), Math.max(min, max));
  return {
    anchor,
    k,
    angle: snapAngle(pinch.angle, snapDeg),
    dx: to.x - from.x + base.x,
    dy: to.y - from.y + base.y,
  };
}

/** Where page point `p` goes under `motion`. */
export function pinchPoint(motion: PinchMotion, p: Pt): Pt {
  const { anchor, k, angle, dx, dy } = motion;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const x = p.x - anchor.x;
  const y = p.y - anchor.y;
  return { x: anchor.x + dx + k * (x * c - y * s), y: anchor.y + dy + k * (x * s + y * c) };
}

/**
 * The selection's frame under `motion`, before its turn: `bounds` scaled by
 * `k` about their middle and centred where the middle went. Turned by
 * `motion.angle` about its own middle, it is the frame of the turned
 * selection, which is how the dashed frame is drawn.
 */
export function pinchFrame(bounds: Bounds, motion: PinchMotion): Bounds {
  const c = pinchPoint(motion, boundsCentre(bounds));
  const hw = ((bounds.maxX - bounds.minX) * motion.k) / 2;
  const hh = ((bounds.maxY - bounds.minY) * motion.k) / 2;
  return { minX: c.x - hw, minY: c.y - hh, maxX: c.x + hw, maxY: c.y + hh };
}

/**
 * `motion` with its move held so the selection's middle stays on the page,
 * as a drag of the selection is held (`clampGroupDelta`).
 */
export function clampPinch(
  motion: PinchMotion,
  bounds: Bounds,
  page: { width: number; height: number },
): PinchMotion {
  const still = pinchFrame(bounds, { ...motion, dx: 0, dy: 0 });
  const d = clampGroupDelta(still, motion.dx, motion.dy, page);
  return { ...motion, dx: d.dx, dy: d.dy };
}

/** Whether `motion` leaves everything where it was. */
export function isStill(motion: PinchMotion): boolean {
  return motion.k === 1 && motion.angle === 0 && motion.dx === 0 && motion.dy === 0;
}

/**
 * Whether two fingers whose midpoint landed at `at` pinch the selection
 * framed by `frame` rather than the page: the midpoint on the frame, or
 * within `margin` of it (page px). Fingers spread round a small shape meet
 * over it; two fingers beside the selection zoom the page.
 */
export function pinchOnSelection(frame: Bounds, at: Pt, margin: number): boolean {
  return (
    at.x >= frame.minX - margin &&
    at.x <= frame.maxX + margin &&
    at.y >= frame.minY - margin &&
    at.y <= frame.maxY + margin
  );
}

/**
 * The pinch as one undo step: the turn, the scale and the move it is made
 * of, each the selection's own command, so each stroke gets fresh point
 * arrays (the path cache keys on them). `heights` gives the measured height
 * of text boxes and tables without a fixed one, for the turn. `null` when
 * the pinch leaves everything where it was.
 */
export function pinchCommand(
  pageId: string,
  elements: PageElements,
  motion: PinchMotion,
  heights?: ReadonlyMap<TextBoxElement | TableElement, number>,
): Command | null {
  const { anchor, k, angle, dx, dy } = motion;
  const parts: Command[] = [];
  if (angle !== 0) {
    const turn = { kind: "rotate", angle } as const;
    parts.push(new ReorientElements(pageId, elements, turn, anchor.x, anchor.y, heights));
  }
  if (k !== 1) parts.push(new ScaleElements(pageId, elements, anchor.x, anchor.y, k));
  if (dx !== 0 || dy !== 0) parts.push(new TranslateElements(pageId, elements, dx, dy));
  if (parts.length <= 1) return parts[0] ?? null;
  // Named for the most it did, as the undo readout shows it.
  return new CompositeCommand(angle !== 0 ? "Rotate selection" : "Resize selection", parts);
}
