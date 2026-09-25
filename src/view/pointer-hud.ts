/**
 * The pointer half of the diagnostics HUD. There is no console on iPadOS,
 * so a screen recording of the HUD is how a stroke that went wrong on the
 * iPad gets read: whether the pointer events came at all, how many and how
 * far apart, and whether the stroke ended in a lift or a cancel.
 *
 * It keeps a short log of the drawing pointer's events (a run of moves is
 * one entry with a count), the numbers of the stroke under way, and totals
 * since the HUD was switched on, and renders them as text.
 *
 * Pure: no DOM, no Obsidian.
 */

import type { PointerDebugRecord } from "../input/pointer-controller";

/** How many entries the log shows; older ones drop off the front. */
const LOG_LENGTH = 30;

/** A label (an event, or a marker the surface adds), or a run of moves. */
type LogEntry = string | { moves: number };

/** What the HUD reads of a pointer event. */
export type HudEvent = Pick<
  PointerDebugRecord,
  "type" | "pointerType" | "pressure" | "coalesced" | "timeStamp"
>;

export class PointerHud {
  private log: LogEntry[] = [];

  // The stroke under way, from its pen-down.
  private moves = 0;
  private samples = 0;
  private longestGap = 0;
  private lastEventAt = 0;
  private topPressure = 0;

  // Since the HUD was switched on.
  private downs = 0;
  private lifts = 0;
  private cancels = 0;

  // The latest event.
  private pointerType = "";
  private pressure = 0;

  record(event: HudEvent): void {
    this.pointerType = event.pointerType;
    this.pressure = event.pressure;
    switch (event.type) {
      case "down":
        this.downs += 1;
        this.moves = 0;
        this.samples = 0;
        this.longestGap = 0;
        this.topPressure = 0;
        this.lastEventAt = event.timeStamp;
        this.mark("dn");
        break;
      case "move":
        this.recordMove(event);
        break;
      case "up":
        this.lifts += 1;
        this.mark("up");
        break;
      case "cancel":
        this.cancels += 1;
        this.mark("cx");
        break;
    }
  }

  /** Put a label in the log: a hold firing, a verdict, an erase. */
  mark(label: string): void {
    this.append(label);
  }

  /** The HUD was just switched on: an empty log and zero totals; the stroke's numbers stay. */
  restart(): void {
    this.log = [];
    this.downs = 0;
    this.lifts = 0;
    this.cancels = 0;
  }

  /**
   * Three lines, each ending in a newline: the log; this stroke's moves,
   * samples, longest gap between events and top pressure; and the totals,
   * with `committed`, the strokes in the document.
   */
  summary(committed: number): string {
    const log = this.log.map((entry) => (typeof entry === "string" ? entry : `m·${entry.moves}`));
    const gap = Math.round(this.longestGap);
    return (
      `${log.join(" ")}\n` +
      `cur mv=${this.moves} pts=${this.samples} gap=${gap}ms maxP=${this.topPressure.toFixed(2)}\n` +
      `Σ dn=${this.downs} up=${this.lifts} cx=${this.cancels} commit=${committed}\n`
    );
  }

  /** The latest event's pointer type ("-" before any) and pressure. */
  pointer(): string {
    return `${this.pointerType || "-"} p=${this.pressure.toFixed(2)}`;
  }

  private recordMove(event: HudEvent): void {
    this.moves += 1;
    this.samples += event.coalesced;
    if (event.pressure > this.topPressure) this.topPressure = event.pressure;
    const gap = event.timeStamp - this.lastEventAt;
    if (gap > this.longestGap) this.longestGap = gap;
    this.lastEventAt = event.timeStamp;
    const last = this.log[this.log.length - 1];
    if (last !== undefined && typeof last !== "string") last.moves += 1;
    else this.append({ moves: 1 });
  }

  private append(entry: LogEntry): void {
    this.log.push(entry);
    if (this.log.length > LOG_LENGTH) this.log.shift();
  }
}
