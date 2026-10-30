/**
 * Two fingers turning a lasso selection or a selected picture (discussion
 * #51). The fingers turn it about the middle of its bounds, as the rotate
 * knob does, and nothing else: no resize (that is the corner handles'),
 * no move (that is one finger's drag). Pure — no DOM, no canvas.
 *
 * The turn settles as the knob's does (`turn-snap.ts`: every 45° of the
 * page). A finger already dragging the selection when the second landed
 * keeps the move it made (`base`). On the lift the turn is one undo step,
 * `ReorientElements` plus that move as `TranslateElements`: a point p goes
 * to `centre + base + R(angle)·(p − centre)`.
 *
 * Until the fingers have turned {@link TURN_ENGAGE_DEG}° (`engaged`), it
 * turns nothing and commits nothing: a two-finger tap on a selection, or
 * the two-finger double tap that undoes, must not nudge it.
 */

import type { Command } from "../model/commands";
import type { Bounds, TableElement, TextBoxElement } from "../model/document";
import { CompositeCommand } from "../model/page-commands";
import {
  type PageElements,
  ReorientElements,
  TranslateElements,
} from "../model/selection-commands";
import type { Pt } from "./lasso";

/** The fingers must turn this far, degrees, before the selection turns. */
export const TURN_ENGAGE_DEG = 5;

export interface FingerTurn {
  /** What it turns about: the middle of the selection's bounds, page px. */
  centre: Pt;
  /** A move the selection already had when the second finger landed. */
  base: Pt;
  /** The fingers' turns added up, radians clockwise, unsnapped. */
  raw: number;
  /** The fingers have turned enough to count; it stays so. */
  engaged: boolean;
}

/** What the turn does to the selection: turned `angle` about `anchor`, then moved by (dx, dy). */
export interface TurnMotion {
  anchor: Pt;
  angle: number;
  dx: number;
  dy: number;
}

/** A turn about `centre` (page px) of a selection already moved by `base`. */
export function startFingerTurn(centre: Pt, base: Pt = { x: 0, y: 0 }): FingerTurn {
  return { centre: { ...centre }, base: { ...base }, raw: 0, engaged: false };
}

/** The turn after the fingers turned `rotation` more (radians); not a number is ignored. */
export function stepFingerTurn(turn: FingerTurn, rotation: number): FingerTurn {
  if (!Number.isFinite(rotation)) return turn;
  const raw = turn.raw + rotation;
  const engaged = turn.engaged || Math.abs(raw) >= (TURN_ENGAGE_DEG * Math.PI) / 180;
  return { ...turn, raw, engaged };
}

/**
 * What the turn does: its angle settled by `settle` (a `TurnSnap`'s
 * `turn`), or none until it is engaged; the move it began with either way.
 */
export function fingerTurnMotion(turn: FingerTurn, settle: (raw: number) => number): TurnMotion {
  return {
    anchor: turn.centre,
    angle: turn.engaged ? settle(turn.raw) : 0,
    dx: turn.base.x,
    dy: turn.base.y,
  };
}

/** Where page point `p` goes under `motion`. */
export function turnPoint(motion: TurnMotion, p: Pt): Pt {
  const { anchor, angle, dx, dy } = motion;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const x = p.x - anchor.x;
  const y = p.y - anchor.y;
  return { x: anchor.x + dx + x * c - y * s, y: anchor.y + dy + x * s + y * c };
}

/**
 * The selection's frame under `motion`, before its turn: `bounds` moved to
 * where their middle went. Turned by `motion.angle` about its own middle,
 * it is the frame of the turned selection, which is how the dashed frame
 * is drawn.
 */
export function turnFrame(bounds: Bounds, motion: TurnMotion): Bounds {
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const c = turnPoint(motion, { x: cx, y: cy });
  return {
    minX: bounds.minX + c.x - cx,
    minY: bounds.minY + c.y - cy,
    maxX: bounds.maxX + c.x - cx,
    maxY: bounds.maxY + c.y - cy,
  };
}

/** Whether `motion` leaves everything where it was. */
export function isStill(motion: TurnMotion): boolean {
  return motion.angle === 0 && motion.dx === 0 && motion.dy === 0;
}

/**
 * Whether two fingers whose midpoint landed at `at` turn the selection
 * framed by `frame` rather than zoom the page: the midpoint on the frame,
 * or within `margin` of it (page px). Fingers spread round a small shape
 * meet over it; two fingers beside the selection zoom the page.
 */
export function fingersOnSelection(frame: Bounds, at: Pt, margin: number): boolean {
  return (
    at.x >= frame.minX - margin &&
    at.x <= frame.maxX + margin &&
    at.y >= frame.minY - margin &&
    at.y <= frame.maxY + margin
  );
}

/**
 * The turn as one undo step: the selection's own turn, then the move a
 * finger made before it, so each stroke gets fresh point arrays (the path
 * cache keys on them). `heights` gives the measured height of text boxes
 * and tables without a fixed one. `null` when nothing changed.
 */
export function turnCommand(
  pageId: string,
  elements: PageElements,
  motion: TurnMotion,
  heights?: ReadonlyMap<TextBoxElement | TableElement, number>,
): Command | null {
  const { anchor, angle, dx, dy } = motion;
  const parts: Command[] = [];
  if (angle !== 0) {
    const turn = { kind: "rotate", angle } as const;
    parts.push(new ReorientElements(pageId, elements, turn, anchor.x, anchor.y, heights));
  }
  if (dx !== 0 || dy !== 0) parts.push(new TranslateElements(pageId, elements, dx, dy));
  if (parts.length <= 1) return parts[0] ?? null;
  return new CompositeCommand("Rotate selection", parts);
}
