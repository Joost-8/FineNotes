/**
 * Pointer events on the page, sorted into strokes and finger gestures.
 *
 * A pen or a mouse draws; `palm-rejection.ts` has the rules for who does
 * what. A stroke's moves carry every sample the hardware took since the last
 * event (`getCoalescedEvents`, which the Pencil fills at up to 240 Hz) and,
 * where WebKit offers them, a few predicted ones for the wet ink to run ahead
 * of the pen. All of them are mapped into the surface's space by the function
 * the surface passes in; nothing here knows the layout.
 *
 * Fingers scroll and zoom, through `FingerGesture`. The page has
 * `touch-action: none` because on iOS a Pencil drag over anything the browser
 * could scroll turns into a scroll, which cancels the stroke part-way; the
 * price is that the fingers' movement is ours to report.
 *
 * Two quirks of the iPad shape the stroke's lifecycle:
 *
 * - WebKit ends a pen it wants for a gesture of its own, a long press on a
 *   pen held still, in `pointercancel`. That goes to the surface as a cancel,
 *   never as an end, and the surface decides what the ink was (a hold).
 * - iOS now and then never sends the pointerup when the pen lifts and lands
 *   again quickly: the stem and then the bar of a "T". A pen-down that finds
 *   a stroke still open cancels that stroke before starting its own, and the
 *   surface keeps the cancelled stroke's ink.
 */

import { FingerGesture, type PinchInfo } from "./finger-gesture";
import { roleOf } from "./palm-rejection";

export type { PinchInfo };

export interface PointerSample {
  x: number;
  y: number;
  pressure: number;
  tiltX: number;
  tiltY: number;
}

export type PointerDebugType = "down" | "move" | "up" | "cancel";

export interface PointerDebugRecord {
  type: PointerDebugType;
  pointerType: string;
  pointerId: number;
  pressure: number;
  /** How many samples a move carried; 0 for the other types. */
  coalesced: number;
  /** The event's `timeStamp` (ms), for measuring the gaps between events. */
  timeStamp: number;
}

export interface PointerControllerCallbacks {
  onStart(sample: PointerSample): void;
  /** The samples since the last move, then the browser's guesses ahead of the pen (never kept). */
  onMove(coalesced: PointerSample[], predicted: PointerSample[]): void;
  onEnd(sample: PointerSample): void;
  onCancel(): void;
  /** A finger gesture began, or was re-anchored, at this client point. */
  onPanStart?(x: number, y: number, t: number): void;
  /** The gesture's focus moved. */
  onPanMove?(x: number, y: number, t: number): void;
  /** The last finger lifted. */
  onPanEnd?(t: number): void;
  /** Every finger gesture is void (a pen landed). */
  onPanCancel?(): void;
  /** A second finger landed: a pinch begins about the midpoint. */
  onPinchStart?(centerX: number, centerY: number): void;
  onPinch?(info: PinchInfo): void;
  /** Fewer than two fingers remain. */
  onPinchEnd?(): void;
  /** Each event of the drawing pointer as it arrived, for the debug HUD. */
  onDebug?(record: PointerDebugRecord): void;
}

const PHASES = ["pointerdown", "pointermove", "pointerup", "pointercancel"] as const;
type Phase = (typeof PHASES)[number];

export class PointerController {
  /** The pointer drawing the open stroke; null between strokes. */
  private stroke: number | null = null;
  private readonly fingers: FingerGesture;
  private readonly handlers: Record<Phase, (event: PointerEvent) => void>;

  constructor(
    private readonly element: HTMLElement,
    private readonly toLocal: (clientX: number, clientY: number) => { x: number; y: number },
    private readonly listener: PointerControllerCallbacks,
  ) {
    this.fingers = new FingerGesture(listener);
    this.handlers = {
      pointerdown: (event) => this.pressed(event),
      pointermove: (event) => this.moved(event),
      pointerup: (event) => this.released(event, false),
      pointercancel: (event) => this.released(event, true),
    };
  }

  attach(): void {
    for (const phase of PHASES) this.element.addEventListener(phase, this.handlers[phase]);
  }

  detach(): void {
    for (const phase of PHASES) this.element.removeEventListener(phase, this.handlers[phase]);
  }

  /** Whether a finger gesture is in progress. */
  get isTouching(): boolean {
    return this.fingers.active;
  }

  private pressed(event: PointerEvent): void {
    const { pointerId, clientX, clientY, timeStamp } = event;
    const role = roleOf(event.pointerType, this.stroke !== null);
    if (role === "draw") {
      this.beginStroke(event);
    } else if (role === "finger" && this.fingers.down(pointerId, clientX, clientY, timeStamp)) {
      // Capture, so a fast swipe that leaves the pane still scrolls it.
      this.element.setPointerCapture(pointerId);
    }
  }

  private beginStroke(event: PointerEvent): void {
    for (const finger of this.fingers.cancel()) this.releaseCapture(finger);
    if (this.stroke !== null) {
      // The last stroke's pointerup never came (see the top of the file).
      this.releaseCapture(this.stroke);
      this.stroke = null;
      this.listener.onCancel();
    }
    this.stroke = event.pointerId;
    this.element.setPointerCapture(event.pointerId);
    event.preventDefault();
    this.debug("down", event, 0);
    this.listener.onStart(this.sample(event));
  }

  private moved(event: PointerEvent): void {
    if (event.pointerId !== this.stroke) {
      this.fingers.move(event.pointerId, event.clientX, event.clientY, event.timeStamp);
      return;
    }
    event.preventDefault();
    const taken = event.getCoalescedEvents?.() ?? [];
    // Where the browser has no coalesced list, the event is the one sample.
    const samples = taken.length > 0 ? taken.map((e) => this.sample(e)) : [this.sample(event)];
    const predicted = (event.getPredictedEvents?.() ?? []).map((e) => this.sample(e));
    this.debug("move", event, samples.length);
    this.listener.onMove(samples, predicted);
  }

  private released(event: PointerEvent, cancelled: boolean): void {
    const id = event.pointerId;
    if (id !== this.stroke) {
      if (this.fingers.lift(id, event.timeStamp)) this.releaseCapture(id);
      return;
    }
    this.releaseCapture(id);
    this.stroke = null;
    if (cancelled) {
      this.debug("cancel", event, 0);
      this.listener.onCancel();
      return;
    }
    event.preventDefault();
    this.debug("up", event, 0);
    this.listener.onEnd(this.sample(event));
  }

  /** The event as a stroke sample, in the surface's space. */
  private sample(event: PointerEvent): PointerSample {
    const at = this.toLocal(event.clientX, event.clientY);
    const { pressure, tiltX, tiltY } = event;
    return { x: at.x, y: at.y, pressure, tiltX, tiltY };
  }

  private debug(type: PointerDebugType, event: PointerEvent, coalesced: number): void {
    const { pointerType, pointerId, pressure, timeStamp } = event;
    this.listener.onDebug?.({ type, pointerType, pointerId, pressure, coalesced, timeStamp });
  }

  /**
   * Release a capture only while the pointer still holds it: by the time a
   * stuck stroke is cancelled WebKit may have forgotten its pointer, and
   * releasing an unknown pointer throws.
   */
  private releaseCapture(id: number): void {
    if (this.element.hasPointerCapture(id)) this.element.releasePointerCapture(id);
  }
}
