/**
 * Erase on hover (FineNotes discussion #209): with the pen's side button
 * held and the tip just above the glass, not touching it, whatever the pen
 * passes over is erased, with the eraser's own mode and size. It is the
 * gesture Android leaves us: a S Pen touching down with its button held
 * never reaches the page (FineNotes#149), but its hovering moves do, with
 * the button in them (`stylus-click.ts`, {@link StylusClicks.barrelHeld}).
 *
 * One pass is one stroke of the eraser, so one undo step: it opens once the
 * pen has travelled {@link HOVER_ERASE_SLOP_PX} from where the button was
 * seen (so a click of the button, which hardly moves, erases nothing and
 * can still open the pen menu), from that first point, and ends when the
 * button is let go, the pen touches down or leaves the page. A pen that
 * went out of range and comes back elsewhere with the button still held
 * ({@link HOVER_GAP_MS}, {@link HOVER_JUMP_PX}) starts a new pass rather
 * than erasing the straight line between.
 *
 * Also a short log of the pen's hovering and button events, so a tester's
 * "Copy shape diagnostics" shows what the WebView reported when it fails.
 *
 * Pure: no DOM, no Obsidian.
 */

import { CLICK_SLOP_PX } from "./stylus-click";

/** Travel (screen px) with the button held before a pass opens: past a click's slop. */
export const HOVER_ERASE_SLOP_PX = CLICK_SLOP_PX;

/** A pause between hovering moves (ms) longer than this may be the pen out of range. */
export const HOVER_GAP_MS = 250;

/** After such a pause, a pen further than this (screen px) from where it was came back elsewhere. */
export const HOVER_JUMP_PX = 40;

/** A hovering pen's position, in client px, at a time (ms). */
export interface HoverPoint {
  x: number;
  y: number;
  t: number;
}

/**
 * What one hovering move does to the pass:
 * - `idle`: no button, nothing open;
 * - `wait`: the button is held, the pen has not travelled far enough yet;
 * - `start`: a pass opens at `from` (where the button was seen) and goes on to this move;
 * - `move`: the open pass goes on to this move;
 * - `end`: the open pass ends at `at` (its last point), and this move opens nothing;
 * - `restart`: the open pass ends at `at`, and this move waits as a new pass's first point.
 */
export type HoverStep =
  | { kind: "idle" }
  | { kind: "wait" }
  | { kind: "start"; from: HoverPoint }
  | { kind: "move" }
  | { kind: "end"; at: HoverPoint }
  | { kind: "restart"; at: HoverPoint };

/** A hovering move as {@link HoverErase.step} reads it. */
export interface HoverReading extends HoverPoint {
  /** The side button is held, the pen in the air (`StylusClicks.barrelHeld`). */
  barrel: boolean;
  /** Erasing on hover is wanted now (the setting, and no text being typed). */
  enabled: boolean;
}

/** One page's erase-on-hover passes. */
export class HoverErase {
  /** Where the button was first seen, while waiting for the pen to travel. */
  private anchor: HoverPoint | null = null;
  /** The open pass's last point; null while no pass is open. */
  private last: HoverPoint | null = null;

  /** A pass is open: a stroke of the eraser is under way. */
  get open(): boolean {
    return this.last !== null;
  }

  /** A hovering move: what it does to the pass ({@link HoverStep}). */
  step(r: HoverReading): HoverStep {
    const at: HoverPoint = { x: r.x, y: r.y, t: r.t };
    const last = this.last;
    if (!r.barrel || !r.enabled) {
      this.anchor = null;
      if (last === null) return { kind: "idle" };
      this.last = null;
      return { kind: "end", at: last };
    }
    if (last !== null) {
      if (r.t - last.t > HOVER_GAP_MS && distance(last, at) > HOVER_JUMP_PX) {
        this.last = null;
        this.anchor = at;
        return { kind: "restart", at: last };
      }
      this.last = at;
      return { kind: "move" };
    }
    const anchor = this.anchor;
    if (anchor === null || r.t - anchor.t > HOVER_GAP_MS * 4) {
      // A button held still a long while starts counting its travel afresh.
      this.anchor = at;
      return { kind: "wait" };
    }
    if (distance(anchor, at) <= HOVER_ERASE_SLOP_PX) return { kind: "wait" };
    this.anchor = null;
    this.last = at;
    return { kind: "start", from: anchor };
  }

  /**
   * The pen touched down, left the page, or the page went away: the open
   * pass's last point, to end it there, or null when none was open.
   */
  stop(): HoverPoint | null {
    const last = this.last;
    this.last = null;
    this.anchor = null;
    return last;
  }
}

function distance(a: HoverPoint, b: HoverPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** How many of the pen's hover and button events the log keeps. */
export const PEN_LOG_LENGTH = 40;

/** One of the pen's events, as the diagnostics keep it. */
export interface PenLogEntry {
  /** The event's type without "pointer" ("move", "down", "up", "leave", …), or a mark. */
  e: string;
  /** `buttons`, `button`, pressure to two places. */
  bs: number;
  b: number;
  p: number;
  /** Ms since the log's first entry. */
  t: number;
  /** What erase on hover made of it ({@link HoverStep} kind), when it was a hovering move. */
  h?: string;
}

/** The parts of a pointer event the log reads (its type is passed apart). */
export interface PenLogEvent {
  buttons: number;
  button: number;
  pressure: number;
  timeStamp: number;
}

/**
 * The pen's recent hover and button events. Runs of the same hovering move
 * (same buttons, same verdict) keep only their first and a count, so a
 * minute of hovering does not push out the moment the button went down.
 */
export class PenLog {
  private entries: Array<PenLogEntry & { n?: number }> = [];
  private origin: number | null = null;

  /** One event, of `type` ("pointermove", "contextmenu", …). */
  note(type: string, event: PenLogEvent, hover?: HoverStep["kind"]): void {
    if (this.origin === null) this.origin = event.timeStamp;
    const entry: PenLogEntry = {
      e: type.replace(/^pointer/, ""),
      bs: event.buttons,
      b: event.button,
      p: Math.round((Number.isFinite(event.pressure) ? event.pressure : 0) * 100) / 100,
      t: Math.round(event.timeStamp - this.origin),
    };
    if (hover !== undefined) entry.h = hover;
    const prev = this.entries.at(-1);
    if (
      prev &&
      entry.e === "move" &&
      prev.e === "move" &&
      prev.bs === entry.bs &&
      prev.h === entry.h &&
      (prev.p === 0) === (entry.p === 0)
    ) {
      prev.n = (prev.n ?? 1) + 1;
      return;
    }
    this.entries.push(entry);
    if (this.entries.length > PEN_LOG_LENGTH) this.entries.shift();
  }

  /** The log, oldest first, as JSON-ready objects. */
  report(): Array<PenLogEntry & { n?: number }> {
    return this.entries.map((entry) => ({ ...entry }));
  }
}
