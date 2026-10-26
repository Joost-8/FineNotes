/**
 * Pointer events on the page, sorted into strokes and finger gestures.
 *
 * A pen or a mouse draws; `palm-rejection.ts` has the rules for who does
 * what. A stroke's moves carry every sample the hardware took since the last
 * event (`getCoalescedEvents`, which the Pencil fills at up to 240 Hz),
 * mapped into the surface's space by the function the surface passes in;
 * nothing here knows the layout. WebKit's predicted samples are not passed
 * on: drawn, they made the ink swing (see `ink/freehand.ts`).
 *
 * Fingers scroll and zoom, through `FingerGesture`. The page has
 * `touch-action: none` because on iOS a Pencil drag over anything the browser
 * could scroll turns into a scroll, which cancels the stroke part-way; the
 * price is that the fingers' movement is ours to report. With Stylus-only
 * mode on, every pointer but the pen is ignored instead (`roleOf`), so a
 * resting hand has nothing to move.
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
 *
 * The pen's side button pressed with the pen in the air is held back until
 * it is a click (`stylus-click.ts`) or the stroke it would have been: it
 * touches down or travels, and only then starts, from where it was pressed.
 */

import { FingerGesture, type PinchInfo } from "./finger-gesture";
import { MultiFingerTap, type TapReport } from "./multi-finger-tap";
import { roleOf } from "./palm-rejection";
import type { PressInput } from "./pen-modifiers";
import { StylusClicks } from "./stylus-click";

export type { PinchInfo };

export interface PointerSample {
  x: number;
  y: number;
  pressure: number;
  tiltX: number;
  tiltY: number;
  /** The event's time stamp, ms (the page's clock). */
  t?: number;
  /** "pen", "mouse" or "touch". */
  pointerType?: string;
}

/**
 * What a pen or mouse coming down does: draw, move the page as a finger
 * would (FineNotes#7, #25), or nothing.
 */
export type PressRoute = "draw" | "pan" | "ignore";

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
  /** Its position is whole CSS px on both axes ({@link isWholePixel}). */
  wholePixel: boolean;
}

/**
 * Whether a pointer position is whole CSS px on both axes. WebKit before
 * Safari 26.2 (iPadOS 26.2) rounds every pointer and touch position to whole
 * px, so a Pencil's samples are each up to half a px off, and a stroke drawn
 * through them wobbles (FineNotes#1: every raw sample of the reporter's
 * notebook sat exactly on the screen-px grid). A pen that reports a position
 * with a fraction is not rounding.
 */
export function isWholePixel(position: { clientX: number; clientY: number }): boolean {
  return Number.isInteger(position.clientX) && Number.isInteger(position.clientY);
}

/**
 * Whether this browser hands over the samples a pointer took between two
 * events (`getCoalescedEvents`; WebKit from iOS 18.2). Without them a pen
 * arrives once a frame, and a stroke is filled in between its samples
 * (`StrokeBuilderOptions.densify`).
 */
export function deliversCoalescedSamples(): boolean {
  return (
    typeof PointerEvent !== "undefined" &&
    typeof PointerEvent.prototype.getCoalescedEvents === "function"
  );
}

export interface PointerControllerCallbacks {
  /** A stroke began; `press` has its buttons and the keys held (`pen-modifiers.ts`). */
  onStart(sample: PointerSample, press: PressInput): void;
  /** The samples since the last move. */
  onMove(coalesced: PointerSample[]): void;
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
  /** A double tap with two or three fingers (`multi-finger-tap.ts`). */
  onFingerDoubleTap?(fingers: number): void;
  /** Every touch of two or more fingers and what it counted as, for the debug HUD. */
  onFingerTapReport?(report: TapReport): void;
  /** A finger reported its contact size, CSS px (on landing and as it moves). */
  onFingerContact?(width: number, height: number): void;
  /**
   * A finger ended in `pointercancel`, just before the gesture hears of it
   * as a lift: WebKit's own long press takes a finger held still that way.
   */
  onFingerCancel?(t: number): void;
  /** Each event of the drawing pointer as it arrived, for the debug HUD. */
  onDebug?(record: PointerDebugRecord): void;
  /** The pen's side button was clicked in the air, here (client px; `stylus-click.ts`). */
  onStylusClick?(clientX: number, clientY: number): void;
}

/**
 * The controller's optional decisions. Each is read live, as the surface's
 * tools and the plugin's settings can change while a note is open.
 */
export interface PointerControllerOptions {
  /** Space is held: a pen or mouse coming down pans like a finger (FineNotes#7). */
  handHeld?: () => boolean;
  /** Where a pen or mouse press goes otherwise: the margin, a stylus button (FineNotes#25). */
  route?: (event: PointerEvent) => PressRoute;
  /** Stylus-only mode: every pointer but the pen is ignored on the page. */
  onlyStylus?: () => boolean;
  /** A click of the pen's side button is wanted: only then is a press of it in the air held back. */
  stylusClicks?: () => boolean;
}

const PHASES = ["pointerdown", "pointermove", "pointerup", "pointercancel"] as const;
type Phase = (typeof PHASES)[number];

export class PointerController {
  /** The pointer drawing the open stroke; null between strokes. */
  private stroke: number | null = null;
  /** A pen has reported a position with a fraction: this device does not round. */
  private penIsPrecise = false;
  /** See {@link strokeRounded}. */
  private rounded = false;
  /** See {@link lastPenAt}. */
  private penSeenAt: number | null = null;
  private readonly fingers: FingerGesture;
  /** Watches every finger, the third included, for undo and redo taps. */
  private readonly taps: MultiFingerTap;
  /** Hears the pen's side button clicked in the air, however it is reported. */
  private readonly clicks = new StylusClicks();
  /** A press of the side button in the air, held back until it is a click or a stroke. */
  private held: PointerEvent | null = null;
  private readonly handlers: Record<Phase, (event: PointerEvent) => void>;

  constructor(
    private readonly element: HTMLElement,
    private readonly toLocal: (clientX: number, clientY: number) => { x: number; y: number },
    private readonly listener: PointerControllerCallbacks,
    private readonly options: PointerControllerOptions = {},
  ) {
    this.fingers = new FingerGesture(listener);
    this.taps = new MultiFingerTap(
      (fingers) => listener.onFingerDoubleTap?.(fingers),
      (report) => listener.onFingerTapReport?.(report),
    );
    this.handlers = {
      pointerdown: (event) => this.down(event),
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

  /**
   * The stroke under way is a pen's, and this device's pen positions arrive
   * rounded to whole px: no pen event so far, its pen-down included, had a
   * fraction. Decided at the pen-down and kept for the stroke. A mouse is
   * never counted (desktop mice report whole px and need nothing smoothed).
   */
  get strokeRounded(): boolean {
    return this.rounded;
  }

  /**
   * When a pen last did anything on the page, hovering included (event time
   * stamps, ms); `null` before the first. A finger held just after it is the
   * writing hand (`finger-hold.ts`).
   */
  get lastPenAt(): number | null {
    return this.penSeenAt;
  }

  /** Space is held, so a pen or mouse press moves the page (FineNotes#7). */
  private handHeld(): boolean {
    return this.options.handHeld?.() === true;
  }

  /** Where a pen or mouse press goes otherwise (FineNotes#25). */
  private pressRoute(event: PointerEvent): PressRoute {
    return this.options.route?.(event) ?? "draw";
  }

  /** Only a pen acts on the page. */
  private onlyStylus(): boolean {
    return this.options.onlyStylus?.() === true;
  }

  /** A click of the pen's side button is wanted: only then is a press of it in the air held back. */
  private stylusClicks(): boolean {
    return this.options.stylusClicks?.() === true;
  }

  /**
   * A press. The pen's side button pressed in the air is held back: let go
   * soon and near, it is a click; once it touches down or travels, it is the
   * press it would have been (`stylus-click.ts`). Any other pen press ends a
   * click the hovering moves were watching for.
   */
  private down(event: PointerEvent): void {
    // A browser that sends the held press's touch-down as a press of its own: that one counts.
    if (this.held?.pointerId === event.pointerId) this.held = null;
    const pen = event.pointerType === "pen";
    if (pen && this.stroke === null && this.held === null && this.stylusClicks()) {
      if (this.clicks.down(event)) {
        this.notePenSeen(event);
        this.held = event;
        event.preventDefault();
        this.element.setPointerCapture(event.pointerId);
        return;
      }
    } else if (pen) {
      this.clicks.reset();
    }
    this.pressed(event);
  }

  /**
   * A `contextmenu` from the pen: whether it is the side button's click,
   * which a WebView may report this way alone. Never while the pen writes
   * (Chromium sends one for a long press too).
   */
  stylusMenu(timeStamp: number): boolean {
    if (!this.stylusClicks() || this.stroke !== null || this.held !== null) return false;
    return this.clicks.menu(timeStamp);
  }

  private pressed(event: PointerEvent): void {
    const { pointerId, clientX, clientY, timeStamp } = event;
    this.notePenSeen(event);
    const onlyStylus = this.onlyStylus();
    // The right mouse button opens the page's menu (`contextmenu`); it never draws.
    if (event.pointerType === "mouse" && event.button === 2) {
      if (onlyStylus) event.preventDefault();
      return;
    }
    const role = roleOf(event.pointerType, this.stroke !== null, onlyStylus);
    const free = role === "draw" && this.stroke === null;
    const route = free ? (this.handHeld() ? "pan" : this.pressRoute(event)) : "draw";
    if (route === "ignore" || role === "ignore") {
      // A palm that lands during a stroke leaves the browser's contact alone;
      // in Stylus-only mode the pointer is not the page's at all, so nothing
      // else may take it either.
      if (onlyStylus) event.preventDefault();
      return;
    }
    if (free && route === "pan") {
      // A stroke already under way is left to finish; only a new one pans.
      event.preventDefault();
      if (this.fingers.down(pointerId, clientX, clientY, timeStamp)) {
        this.element.setPointerCapture(pointerId);
      }
    } else if (role === "draw") {
      this.beginStroke(event);
    } else if (role === "finger") {
      // Every finger counts towards a tap, also one the scroll gesture leaves out.
      this.taps.down(pointerId, clientX, clientY, timeStamp);
      if (this.fingers.down(pointerId, clientX, clientY, timeStamp)) {
        // Capture, so a fast swipe that leaves the pane still scrolls it.
        this.element.setPointerCapture(pointerId);
      }
      // After the gesture has heard of the finger, so a hold it began counts it.
      this.listener.onFingerContact?.(event.width, event.height);
    }
  }

  private beginStroke(event: PointerEvent): void {
    for (const finger of this.fingers.cancel()) this.releaseCapture(finger);
    // A pen on the page means the fingers were the writing hand, not a tap.
    this.taps.penDown();
    if (this.stroke !== null) {
      // The last stroke's pointerup never came (see the top of the file).
      this.releaseCapture(this.stroke);
      this.stroke = null;
      this.listener.onCancel();
    }
    this.stroke = event.pointerId;
    this.element.setPointerCapture(event.pointerId);
    event.preventDefault();
    const pen = event.pointerType === "pen";
    if (pen) this.notePen(event);
    this.rounded = pen && !this.penIsPrecise;
    this.debug("down", event, 0);
    const { button, buttons, shiftKey, ctrlKey, metaKey, altKey, pointerType } = event;
    const press = { pointerType, button, buttons, shiftKey, ctrlKey, metaKey, altKey };
    this.listener.onStart(this.sample(event), press);
  }

  private moved(event: PointerEvent): void {
    this.notePenSeen(event);
    if (this.held?.pointerId === event.pointerId) {
      this.heldMoved(event);
      return;
    }
    if (event.pointerId !== this.stroke) {
      // Stylus-only mode: a finger already down when the mode came on must
      // not carry on moving the page; its lift still releases it.
      if (this.onlyStylus() && event.pointerType !== "pen") return;
      if (
        event.pointerType === "pen" &&
        this.stroke === null &&
        this.stylusClicks() &&
        this.clicks.hover(event)
      ) {
        this.listener.onStylusClick?.(event.clientX, event.clientY);
      }
      if (event.pointerType === "touch") this.listener.onFingerContact?.(event.width, event.height);
      this.taps.move(event.pointerId, event.clientX, event.clientY);
      this.fingers.move(event.pointerId, event.clientX, event.clientY, event.timeStamp);
      return;
    }
    event.preventDefault();
    const taken = event.getCoalescedEvents?.() ?? [];
    // Where the browser has no coalesced list, the event is the one sample.
    const samples = taken.length > 0 ? taken.map((e) => this.sample(e)) : [this.sample(event)];
    if (event.pointerType === "pen")
      for (const e of taken.length > 0 ? taken : [event]) this.notePen(e);
    this.debug("move", event, samples.length);
    this.listener.onMove(samples);
  }

  /** A move of the held-back press: wait on, become the press it was, or be the click. */
  private heldMoved(event: PointerEvent): void {
    const held = this.held;
    if (!held) return;
    const step = this.clicks.held(event);
    if (step === "wait") {
      event.preventDefault();
      return;
    }
    this.held = null;
    if (step === "stroke") {
      // It touched down or moved off: the press it began as, then this move.
      this.pressed(held);
      this.moved(event);
      return;
    }
    this.releaseCapture(event.pointerId);
    if (step === "click") this.listener.onStylusClick?.(event.clientX, event.clientY);
  }

  private released(event: PointerEvent, cancelled: boolean): void {
    const id = event.pointerId;
    this.notePenSeen(event);
    if (this.held?.pointerId === id) {
      this.held = null;
      this.releaseCapture(id);
      if (!cancelled && this.clicks.heldUp(event)) {
        this.listener.onStylusClick?.(event.clientX, event.clientY);
      } else {
        this.clicks.reset();
      }
      return;
    }
    if (event.pointerType === "pen") this.clicks.lifted();
    if (id !== this.stroke) {
      // A cancelled finger counts as lifted (`multi-finger-tap.ts` says why).
      if (cancelled) this.taps.cancel(id, event.timeStamp);
      else this.taps.up(id, event.timeStamp);
      if (cancelled && event.pointerType === "touch")
        this.listener.onFingerCancel?.(event.timeStamp);
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
    return {
      x: at.x,
      y: at.y,
      pressure,
      tiltX,
      tiltY,
      t: event.timeStamp,
      pointerType: event.pointerType,
    };
  }

  private notePenSeen(event: PointerEvent): void {
    if (event.pointerType === "pen") this.penSeenAt = event.timeStamp;
  }

  /** One position with a fraction is enough: this device's pen does not round. */
  private notePen(position: { clientX: number; clientY: number }): void {
    if (!this.penIsPrecise && !isWholePixel(position)) this.penIsPrecise = true;
  }

  private debug(type: PointerDebugType, event: PointerEvent, coalesced: number): void {
    const { pointerType, pointerId, pressure, timeStamp } = event;
    const wholePixel = isWholePixel(event);
    this.listener.onDebug?.({
      type,
      pointerType,
      pointerId,
      pressure,
      coalesced,
      timeStamp,
      wholePixel,
    });
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
