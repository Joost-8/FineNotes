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
> &
  Partial<
    Pick<PointerDebugRecord, "wholePixel" | "altitude" | "azimuth" | "tiltSource" | "ownTilts">
  >;

/** An upright reading this far (degrees) below the one before counts as a dropout. */
const TILT_DROPOUT = 10;

/** Which reading of a stroke the HUD sets against its first: estimated or not. */
const SETTLED_READING = 5;

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
  /** Whether its position was whole px (rounded input); undefined if unknown. */
  private wholePixel: boolean | undefined;

  // The Pencil's tilt over the stroke under way (Pencil tilt, discussion #51).
  private altitude = Number.NaN;
  private azimuth = Number.NaN;
  private tiltSource = "none";
  private lowAltitude = Number.NaN;
  private highAltitude = Number.NaN;
  /** The first few altitudes, to see whether the pen-down's was an estimate. */
  private firstAltitudes: number[] = [];
  /** The last move's coalesced samples, and how many altitudes they carried. */
  private ownTilts = 0;
  private coalescedTilts = 0;
  /** The pen-up's altitude against the last before it. */
  private upDelta = Number.NaN;
  /** Upright readings straight after a lean: the device dropping its tilt. */
  private dropouts = 0;

  record(event: HudEvent): void {
    this.pointerType = event.pointerType;
    this.pressure = event.pressure;
    this.wholePixel = event.wholePixel;
    if (event.type === "down") this.resetTilt();
    this.recordTilt(event);
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

  /**
   * The tilt line: the latest altitude and azimuth and where they came from,
   * the stroke's range, how many altitudes the last move's coalesced samples
   * carried, the pen-up's step from the reading before it, upright dropouts,
   * and the first reading against the fifth (an estimated pen-down shows as
   * a jump).
   */
  tilt(): string {
    if (this.tiltSource === "none") return "tilt - src=none";
    const deg = (n: number): string => (Number.isFinite(n) ? n.toFixed(1) : "-");
    const first = this.firstAltitudes[0];
    const settled = this.firstAltitudes[SETTLED_READING - 1];
    return (
      `tilt ${deg(this.altitude)}° az ${Number.isFinite(this.azimuth) ? Math.round(this.azimuth) : "-"}° ` +
      `src=${this.tiltSource} stroke ${deg(this.lowAltitude)}–${deg(this.highAltitude)}° ` +
      `own/co ${this.ownTilts}/${this.coalescedTilts} up Δ${deg(this.upDelta)}° ` +
      `zero ${this.dropouts} est? ${deg(first)}→${deg(settled)}`
    );
  }

  private resetTilt(): void {
    this.lowAltitude = Number.NaN;
    this.highAltitude = Number.NaN;
    this.firstAltitudes = [];
    this.ownTilts = 0;
    this.coalescedTilts = 0;
    this.upDelta = Number.NaN;
    this.dropouts = 0;
  }

  private recordTilt(event: HudEvent): void {
    if (event.tiltSource === undefined) return;
    this.tiltSource = event.tiltSource;
    const altitude = event.altitude ?? Number.NaN;
    const before = this.altitude;
    if (event.type === "up") this.upDelta = altitude - before;
    if (event.type === "move") {
      this.ownTilts = event.ownTilts ?? 0;
      this.coalescedTilts = event.coalesced;
    }
    if (!Number.isFinite(altitude)) return;
    if (event.type !== "up" && altitude >= 90 && before < 90 - TILT_DROPOUT) this.dropouts += 1;
    this.altitude = altitude;
    this.azimuth = event.azimuth ?? Number.NaN;
    if (event.type === "up") return;
    if (!(this.lowAltitude <= altitude)) this.lowAltitude = altitude;
    if (!(this.highAltitude >= altitude)) this.highAltitude = altitude;
    if (this.firstAltitudes.length < SETTLED_READING) this.firstAltitudes.push(altitude);
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

  /**
   * The latest event's pointer type ("-" before any) and pressure, and
   * whether its position was whole px (`xy=int`, rounded) or not (`xy=frac`).
   */
  pointer(): string {
    const xy = this.wholePixel === undefined ? "" : ` xy=${this.wholePixel ? "int" : "frac"}`;
    return `${this.pointerType || "-"} p=${this.pressure.toFixed(2)}${xy}`;
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
