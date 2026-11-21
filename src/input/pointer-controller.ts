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
 * resting hand has nothing to move. While fingers draw (the Pencil is away,
 * `finger-draw.ts`), one finger writes and two pan and pinch, until the
 * first pen event.
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
 *
 * With erase on hover wanted (`hover-erase.ts`, discussion #209), hovering
 * moves with the side button held are a stroke of their own: the eraser's,
 * reported as one with the barrel's buttons, so the surface erases as for
 * any barrel stroke. Android's WebView shows the button only in those moves.
 */

import { altitudeOf } from "../ink/tilt";
import { endsFingerDrawing, fingerDrawRole, fingerWrites } from "./finger-draw";
import { FingerGesture, type PinchInfo } from "./finger-gesture";
import { HoverErase, type HoverStep, PenLog, type PenLogEvent } from "./hover-erase";
import { MultiFingerTap, type TapReport } from "./multi-finger-tap";
import { type PointerRole, roleOf } from "./palm-rejection";
import type { PressInput } from "./pen-modifiers";
import { freshSamples, type RawSample } from "./repeat-samples";
import { StylusClicks } from "./stylus-click";
import { type BridgePoint, StylusSelectBridge } from "./stylus-select-bridge";

export type { PinchInfo };

export interface PointerSample {
  x: number;
  y: number;
  pressure: number;
  tiltX: number;
  tiltY: number;
  /** Degrees above the screen, from `altitudeAngle` or the tilts (`ink/tilt`); NaN for none. */
  altitude: number;
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
  /** The pen's altitude, degrees above the screen; NaN for none (`ink/tilt`). */
  altitude: number;
  /** Its azimuth, degrees round the screen from +x; NaN for none. */
  azimuth: number;
  /** Where the altitude came from: `altitudeAngle`, `tiltX`/`tiltY`, or nowhere. */
  tiltSource: "angle" | "tilt" | "none";
  /**
   * A move: how many different altitudes its coalesced samples carried. As
   * many as `coalesced` means each sample has its own; 1, that they repeat
   * the event's.
   */
  ownTilts: number;
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

/** How far off the device-pixel grid still counts as on it, device px (float error). */
const GRID_TOLERANCE = 1e-3;

/**
 * Whether a pointer position lies on the screen's device-pixel grid on both
 * axes: whole multiples of `1 / pixelRatio` CSS px. An iPad Air M2 with a
 * Pencil Pro on iPadOS 27 reports the Pencil rounded so (FineNotes#179:
 * every point of the reporter's 20 strokes sat on the 0.375 page-px grid,
 * one device px at his zoom), half a CSS px apart at a ratio of 2. That is
 * not a fraction {@link isWholePixel} sees, and at 240 Hz samples ~1.5 px
 * apart it swings each step's direction as whole-px rounding did.
 */
export function isOnDevicePixel(
  position: { clientX: number; clientY: number },
  pixelRatio: number,
): boolean {
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  const on = (v: number): boolean => {
    const device = v * ratio;
    return Math.abs(device - Math.round(device)) < GRID_TOLERANCE;
  };
  return on(position.clientX) && on(position.clientY);
}

function rawOf(e: PointerEvent): RawSample {
  return { x: e.clientX, y: e.clientY, pressure: e.pressure, t: e.timeStamp };
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
  /** A second finger landed: a pinch begins about the midpoint, the fingers `spread` px apart. */
  onPinchStart?(centerX: number, centerY: number, spread: number): void;
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
  /** A pen event came while fingers draw: the Pencil is back, and finger drawing ends. */
  onPenReturned?(): void;
  /** An erase-on-hover pass opened, ended, or ended to start afresh, for the debug HUD. */
  onHoverErase?(kind: "start" | "end" | "restart"): void;
}

/**
 * The controller's optional decisions. Each is read live, as the surface's
 * tools and the plugin's settings can change while a note is open.
 */
export interface PointerControllerOptions {
  /** Space is held: a pen or mouse coming down pans like a finger (FineNotes#7). */
  handHeld?: () => boolean;
  /** Where a pen or mouse press goes otherwise: the margin, a stylus button (FineNotes#25). */
  route?: (event: PointerEvent, press: PressInput) => PressRoute;
  /** Stylus-only mode: every pointer but the pen is ignored on the page. */
  onlyStylus?: () => boolean;
  /** Fingers draw (`finger-draw.ts`): one finger writes, two pan and pinch. Wins over Stylus-only. */
  fingerDraws?: () => boolean;
  /** A touch point on a control layered over the page may still be handled. */
  touchTarget?: (event: PointerEvent) => boolean;
  /** A click of the pen's side button is wanted: only then is a press of it in the air held back. */
  stylusClicks?: () => boolean;
  /** The hovering pen with its side button held erases (`hover-erase.ts`, discussion #209). */
  hoverErase?: () => boolean;
  /** Android-only selection bridge for S-Pen hold-to-erase; enabled unless returning false. */
  stylusSelectBridge?: () => boolean;
  /** The screen's device px per CSS px; absent, the element's window's `devicePixelRatio`. */
  pixelRatio?: () => number;
}

const PHASES = [
  "pointerdown",
  "pointermove",
  "pointerup",
  "pointercancel",
  "pointerleave",
] as const;

/** `buttons` bit of a pen's barrel (secondary) button. */
const BARREL_BIT = 2;
/** `buttons` bit of a pen's eraser end. */
const ERASER_END_BIT = 32;
type Phase = (typeof PHASES)[number];

export class PointerController {
  /** The pointer drawing the open stroke; null between strokes. */
  private stroke: number | null = null;
  /** A pen has reported a position off the px and device-px grids: this device does not round. */
  private penIsPrecise = false;
  /** A pen position off whole CSS px but on the device-pixel grid was seen ({@link strokeGrid}). */
  private penOnDevicePx = false;
  /** See {@link strokeRounded}. */
  private rounded = false;
  /** See {@link lastPenAt}. */
  private penSeenAt: number | null = null;
  /** The raw samples the open stroke's last move carried. */
  private lastMove: RawSample[] = [];
  private readonly fingers: FingerGesture;
  /** Watches every finger, the third included, for undo and redo taps. */
  private readonly taps: MultiFingerTap;
  /** Hears the pen's side button clicked in the air, however it is reported. */
  private readonly clicks = new StylusClicks();
  /** Experimental bridge capturing Android WebView StylusTextSelector drags via selectionchange. */
  private readonly selectBridge: StylusSelectBridge;
  /** Erase on hover: the pass under way, if any (`hover-erase.ts`). */
  private readonly hover = new HoverErase();
  /** The pen's recent hover and button events, for the diagnostics. */
  private readonly penLog = new PenLog();
  /** Route chosen for the active selection-bridge stroke. */
  private bridgeRoute: PressRoute = "ignore";
  /** A press of the side button in the air, held back until it is a click or a stroke. */
  private held: PointerEvent | null = null;
  /** The pen's last press came down with the side button held in its hovering moves (`pressOf`). */
  private barrelAtDown = false;
  /**
   * While fingers draw, a lone finger held back until it writes or a second
   * joins it (`finger-draw.ts`), with each move it made and the samples it carried.
   */
  private waiting: { down: PointerEvent; moves: Array<[PointerEvent, PointerEvent[]]> } | null =
    null;
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
      pointerleave: (event) => this.left(event),
    };
    this.selectBridge = new StylusSelectBridge(this.element, {
      onStart: (pt) => this.bridgeStarted(pt),
      onMove: (pt) => this.bridgeMoved(pt),
      onEnd: (pt) => this.bridgeEnded(pt),
    });
  }

  attach(): void {
    for (const phase of PHASES) this.element.addEventListener(phase, this.handlers[phase]);
    if (this.options.stylusSelectBridge?.() !== false) this.selectBridge.attach();
  }

  detach(): void {
    this.hover.stop();
    this.selectBridge.detach();
    for (const phase of PHASES) this.element.removeEventListener(phase, this.handlers[phase]);
  }

  /** Whether a finger gesture is in progress. */
  get isTouching(): boolean {
    return this.fingers.active;
  }

  /**
   * The stroke under way is a pen's, and this device's pen positions arrive
   * rounded to whole px or whole device px: no pen event so far, its
   * pen-down included, lay off both grids ({@link isOnDevicePixel}). Decided at the pen-down and kept for the stroke. A mouse is
   * never counted (desktop mice report whole px and need nothing smoothed).
   */
  get strokeRounded(): boolean {
    return this.rounded;
  }

  /**
   * With {@link strokeRounded}, the grid the pen's positions are rounded to,
   * CSS px: one device px once a position between whole px has been seen on
   * that grid, else one whole px. Null when the stroke is not rounded.
   */
  get strokeGrid(): number | null {
    if (!this.rounded) return null;
    return this.penOnDevicePx ? 1 / this.pixelRatio() : 1;
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
    return this.options.route?.(event, this.pressOf(event)) ?? "draw";
  }

  /**
   * What a press says of its buttons and keys. A pen that touched down with
   * the side button held in the hovering moves just before has the barrel's
   * bit, though its own `buttons` lack it: Android's WebView reports the
   * button only while the pen hovers (FineNotes#149).
   */
  private pressOf(event: PointerEvent): PressInput {
    const { button, shiftKey, ctrlKey, metaKey, altKey, pointerType } = event;
    let buttons = event.buttons;
    if (this.barrelAtDown && (buttons & ERASER_END_BIT) === 0) buttons |= BARREL_BIT;
    return { pointerType, button, buttons, shiftKey, ctrlKey, metaKey, altKey };
  }

  /** Only a pen acts on the page; never while fingers draw. */
  private onlyStylus(): boolean {
    return this.options.onlyStylus?.() === true && !this.fingerDraws();
  }

  /** The Pencil is away: one finger writes, two pan and pinch. */
  private fingerDraws(): boolean {
    return this.options.fingerDraws?.() === true;
  }

  /** A touch point on a page control is allowed through Stylus-only mode. */
  private touchTarget(event: PointerEvent): boolean {
    return event.pointerType === "touch" && this.options.touchTarget?.(event) === true;
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
    if (event.pointerType === "pen") {
      this.penLog.note("pointerdown", event);
      // The pen touched down: the hovering pass is over, before the press begins.
      this.stopHover(event);
    }
    this.selectBridge.endStroke(event.timeStamp);
    this.selectBridge.setArmed(false);
    // A browser that sends the held press's touch-down as a press of its own: that one counts.
    if (this.held?.pointerId === event.pointerId) this.held = null;
    const pen = event.pointerType === "pen";
    // Read before anything below forgets the hovering moves.
    this.barrelAtDown = pen && this.clicks.barrelHeld;
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

  /**
   * A pen over the rest of the view, off this element: the tool bar, or the
   * popover the click opened. The side button's click is heard in its
   * hovering moves there too, so the click that closes the pen menu need not
   * find the page (the pen is often over the menu by then); and a pen pressed
   * there is down until it lifts, so its moves are no click.
   */
  penElsewhere(event: PointerEvent): void {
    this.notePenReturned(event);
    if (event.pointerType !== "pen" || this.held !== null) return;
    if (event.type === "pointermove") this.hearHover(event);
    else {
      this.selectBridge.endStroke(event.timeStamp);
      if (event.type === "pointerdown") {
        this.selectBridge.setArmed(false);
        this.clicks.landed();
      } else {
        this.selectBridge.setArmed(
          event.type !== "pointercancel",
          event.clientX,
          event.clientY,
          event.timeStamp,
          false,
        );
        this.clicks.lifted(event.timeStamp);
      }
    }
  }

  /** A hovering pen's move: the side button's click, if it makes one (`stylus-click.ts`). */
  private hearHover(event: PointerEvent): void {
    if (event.pointerType !== "pen" || this.stroke !== null) return;
    this.selectBridge.warmUp();
    if (this.selectBridge.isActive && event.pressure === 0) {
      this.selectBridge.endStroke(event.timeStamp);
    }
    // Always heard, so a pen touching down knows its side button is held
    // (`pressOf`); reported as a click only when a click is wanted.
    const click = this.clicks.hover(event);
    this.selectBridge.setArmed(
      true,
      event.clientX,
      event.clientY,
      event.timeStamp,
      this.clicks.barrelHeld,
    );
    if (click && this.stylusClicks()) this.listener.onStylusClick?.(event.clientX, event.clientY);
    const step = this.hover.step({
      x: event.clientX,
      y: event.clientY,
      t: event.timeStamp,
      barrel: this.clicks.barrelHeld,
      enabled: this.hoverErases(),
    });
    this.penLog.note("pointermove", event, step.kind);
    this.hovered(step, event);
  }

  /** The hovering pen erases with its side button held (discussion #209). */
  private hoverErases(): boolean {
    return this.options.hoverErase?.() === true;
  }

  /**
   * What a hovering move did to the erase-on-hover pass: a stroke of the
   * eraser begun, carried on or ended, as the barrel's (`bridgePress`).
   */
  private hovered(step: HoverStep, event: PointerEvent): void {
    switch (step.kind) {
      case "idle":
      case "wait":
        return;
      case "start": {
        const from = step.from;
        const { event: press, press: input } = this.bridgePress(
          { clientX: from.x, clientY: from.y, timeStamp: from.t },
          BARREL_BIT,
        );
        // Wherever the pen began, only the eraser may have it: not a pan, nor nothing.
        if ((this.options.route?.(press, input) ?? "draw") !== "draw") {
          this.hover.stop();
          return;
        }
        this.clearFingersForPen(true);
        this.rounded = false;
        this.debug("down", event, 0);
        this.listener.onStart(this.hoverSample(from.x, from.y, from.t), input);
        this.listener.onHoverErase?.("start");
        this.hoverMoved(event);
        return;
      }
      case "move":
        this.hoverMoved(event);
        return;
      case "end":
      case "restart":
        this.debug("up", event, 0);
        this.listener.onEnd(this.hoverSample(step.at.x, step.at.y, step.at.t));
        this.listener.onHoverErase?.(step.kind);
    }
  }

  /** A move of the open erase-on-hover pass: every sample it carried. */
  private hoverMoved(event: PointerEvent): void {
    const taken = event.getCoalescedEvents?.() ?? [];
    const events = taken.length > 0 ? taken : [event];
    this.debug("move", event, events.length, taken);
    this.listener.onMove(events.map((e) => this.hoverSample(e.clientX, e.clientY, e.timeStamp)));
  }

  /** The pen touched down or left: an open erase-on-hover pass ends where it last was. */
  private stopHover(event: PointerEvent): void {
    const at = this.hover.stop();
    if (at === null) return;
    this.debug("up", event, 0);
    this.listener.onEnd(this.hoverSample(at.x, at.y, at.t));
    this.listener.onHoverErase?.("end");
  }

  /** A hovering pen's point as a stroke sample: no pressure reading in the air, so a middling one. */
  private hoverSample(clientX: number, clientY: number, t: number): PointerSample {
    return this.bridgeSample({ clientX, clientY, timeStamp: t });
  }

  /** A pen left the page (out of range, or off over the tool bar): the pass ends there. */
  private left(event: PointerEvent): void {
    if (event.pointerType !== "pen") return;
    this.penLog.note("pointerleave", event);
    this.stopHover(event);
  }

  /**
   * A pen's event this controller does not see as a pointer event (its
   * `contextmenu`), for the pen log.
   */
  logPen(type: string, event: PenLogEvent): void {
    this.penLog.note(type, event);
  }

  /** The pen's recent hover and button events, oldest first (`hover-erase.ts`). */
  penReport(): ReturnType<PenLog["report"]> {
    return this.penLog.report();
  }

  private bridgePress(pt: BridgePoint, buttons = 3): { event: PointerEvent; press: PressInput } {
    const press: PressInput = {
      pointerType: "pen",
      button: 2,
      buttons,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
    };
    const event = {
      ...press,
      pointerId: -1,
      clientX: pt.clientX,
      clientY: pt.clientY,
      timeStamp: pt.timeStamp,
    } as unknown as PointerEvent;
    return { event, press };
  }

  private bridgeSample(pt: BridgePoint): PointerSample {
    const at = this.toLocal(pt.clientX, pt.clientY);
    return {
      x: at.x,
      y: at.y,
      pressure: 0.5,
      tiltX: 0,
      tiltY: 0,
      altitude: Number.NaN,
      t: pt.timeStamp,
      pointerType: "pen",
    };
  }

  private bridgeStarted(pt: BridgePoint): void {
    // The pen touched down after all: the hovering pass ends where it last was.
    const at = this.hover.stop();
    if (at !== null) {
      this.listener.onEnd(this.hoverSample(at.x, at.y, at.t));
      this.listener.onHoverErase?.("end");
    }
    this.clicks.touched();
    const { event, press } = this.bridgePress(pt);
    const route = this.options.route?.(event, press) ?? "draw";
    this.bridgeRoute = route;
    if (route === "ignore") return;
    this.clearFingersForPen(true);
    if (route === "pan") {
      this.listener.onPanStart?.(pt.clientX, pt.clientY, pt.timeStamp);
      return;
    }
    this.rounded = false;
    this.listener.onStart(this.bridgeSample(pt), press);
  }

  private bridgeMoved(pt: BridgePoint): void {
    if (this.bridgeRoute === "ignore") return;
    if (this.bridgeRoute === "pan") {
      this.listener.onPanMove?.(pt.clientX, pt.clientY, pt.timeStamp);
      return;
    }
    this.listener.onMove([this.bridgeSample(pt)]);
  }

  private bridgeEnded(pt: BridgePoint): void {
    const route = this.bridgeRoute;
    this.bridgeRoute = "ignore";
    if (route === "ignore") return;
    if (route === "pan") {
      this.listener.onPanEnd?.(pt.timeStamp);
      return;
    }
    this.listener.onEnd(this.bridgeSample(pt));
  }

  /**
   * A `contextmenu` with the side button held in the air: Android's WebView
   * sends one, as a mouse's right-click, for the pen touching down with the
   * button held (`stylus-click.ts`). True when it was that.
   */
  stylusTouched(): boolean {
    const touched = this.stylusClicks() && this.clicks.touched();
    return this.selectBridge.wasRecentlyActive || touched;
  }

  private pressed(event: PointerEvent): void {
    this.notePenSeen(event);
    if (event.pointerType === "pen") this.clicks.landed();
    const onlyStylus = this.onlyStylus() && !this.touchTarget(event);
    // The right mouse button opens the page's menu (`contextmenu`); it never draws.
    if (event.pointerType === "mouse" && event.button === 2) {
      if (onlyStylus) event.preventDefault();
      return;
    }
    if (event.pointerType === "touch" && this.fingerDraws() && !this.touchTarget(event)) {
      this.fingerDrawPressed(event);
      return;
    }
    this.take(event, roleOf(event.pointerType, this.stroke !== null, onlyStylus), onlyStylus);
  }

  /** A press, given its role: a stroke, a pan, a finger, or nothing. */
  private take(event: PointerEvent, role: PointerRole, onlyStylus: boolean): void {
    const { pointerId, clientX, clientY, timeStamp } = event;
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
      this.fingerDown(event, event);
    }
  }

  /** A finger joins the scroll and zoom gesture, at `at` (where it landed, or where it is now). */
  private fingerDown(event: PointerEvent, at: PointerEvent): void {
    const { pointerId } = event;
    // Every finger counts towards a tap, also one the scroll gesture leaves out.
    this.taps.down(pointerId, at.clientX, at.clientY, at.timeStamp);
    if (this.fingers.down(pointerId, at.clientX, at.clientY, at.timeStamp)) {
      // Capture, so a fast swipe that leaves the pane still scrolls it.
      this.element.setPointerCapture(pointerId);
    }
    // After the gesture has heard of the finger, so a hold it began counts it.
    this.listener.onFingerContact?.(event.width, event.height);
  }

  /**
   * A finger lands while fingers draw (`finger-draw.ts`): a lone one waits to
   * write; a second beside it makes the pair a pan or pinch; beside a finger
   * that writes it is the hand, and plays no part.
   */
  private fingerDrawPressed(event: PointerEvent): void {
    const waiting = this.waiting;
    const role = fingerDrawRole({
      waiting: waiting !== null,
      gesture: this.fingers.active,
      stroke: this.stroke !== null,
    });
    if (role === "ignore") return;
    if (role === "wait") {
      this.waiting = { down: event, moves: [] };
      event.preventDefault();
      this.element.setPointerCapture(event.pointerId);
      return;
    }
    if (waiting && role === "pair") {
      this.waiting = null;
      // The waiting finger joins from where it is now, so the page does not jump.
      this.fingerDown(waiting.down, waiting.moves.at(-1)?.[0] ?? waiting.down);
    }
    this.fingerDown(event, event);
  }

  /**
   * The waiting finger writes, as the pen would have from where it landed:
   * its press, then every move it made while it waited, drawn at once.
   */
  private writeWaiting(): void {
    const waiting = this.waiting;
    if (!waiting) return;
    this.waiting = null;
    // The press takes the pointer again if it draws or pans; otherwise it is let go.
    this.releaseCapture(waiting.down.pointerId);
    this.take(waiting.down, "draw", false);
    for (const [move, taken] of waiting.moves) this.moved(move, taken);
  }

  /** A pen landed on a finger still waiting: that was the hand, not a finger writing. */
  private dropWaiting(): void {
    const waiting = this.waiting;
    if (!waiting) return;
    this.waiting = null;
    this.releaseCapture(waiting.down.pointerId);
  }

  private clearFingersForPen(isPen: boolean): void {
    for (const finger of this.fingers.cancel()) this.releaseCapture(finger);
    if (isPen) this.dropWaiting();
    // A pen on the page means the fingers were the writing hand, not a tap.
    this.taps.penDown();
  }

  private beginStroke(event: PointerEvent): void {
    this.clearFingersForPen(event.pointerType === "pen");
    if (this.stroke !== null) {
      // The last stroke's pointerup never came (see the top of the file).
      this.releaseCapture(this.stroke);
      this.stroke = null;
      this.listener.onCancel();
    }
    this.stroke = event.pointerId;
    this.lastMove = [];
    this.element.setPointerCapture(event.pointerId);
    event.preventDefault();
    const pen = event.pointerType === "pen";
    if (pen) this.notePen(event);
    this.rounded = pen && !this.penIsPrecise;
    this.debug("down", event, 0);
    this.listener.onStart(this.sample(event), this.pressOf(event));
  }

  private moved(event: PointerEvent, taken = event.getCoalescedEvents?.() ?? []): void {
    this.notePenSeen(event);
    if (this.held?.pointerId === event.pointerId) {
      this.heldMoved(event);
      return;
    }
    const waiting = this.waiting;
    if (waiting?.down.pointerId === event.pointerId) {
      if (!fingerWrites(event.timeStamp - waiting.down.timeStamp, false)) {
        waiting.moves.push([event, taken]);
        event.preventDefault();
        return;
      }
      this.writeWaiting();
    }
    if (event.pointerId !== this.stroke) {
      // Stylus-only mode: a finger already down when the mode came on must
      // not carry on moving the page; its lift still releases it.
      if (this.onlyStylus() && event.pointerType !== "pen") return;
      this.hearHover(event);
      if (event.pointerType === "touch") this.listener.onFingerContact?.(event.width, event.height);
      this.taps.move(event.pointerId, event.clientX, event.clientY);
      this.fingers.move(event.pointerId, event.clientX, event.clientY, event.timeStamp);
      return;
    }
    event.preventDefault();
    // Where the browser has no coalesced list, the event is the one sample.
    const events = taken.length > 0 ? taken : [event];
    const raw = events.map(rawOf);
    // Samples the last move already handed over come again (`repeat-samples.ts`).
    const fresh = new Set(freshSamples(raw, this.lastMove));
    this.lastMove = raw;
    const samples = events.filter((_, i) => fresh.has(raw[i])).map((e) => this.sample(e));
    if (event.pointerType === "pen") for (const e of events) this.notePen(e);
    this.debug("move", event, samples.length, taken);
    if (samples.length > 0) this.listener.onMove(samples);
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
    if (event.pointerType === "pen") {
      this.penLog.note(cancelled ? "pointercancel" : "pointerup", event);
    }
    if (this.held?.pointerId === id) {
      this.held = null;
      this.releaseCapture(id);
      if (event.pointerType === "pen") this.selectBridge.setArmed(false);
      if (!cancelled && this.clicks.heldUp(event)) {
        this.listener.onStylusClick?.(event.clientX, event.clientY);
      } else {
        this.clicks.reset();
      }
      return;
    }
    if (event.pointerType === "pen") {
      this.clicks.lifted(event.timeStamp);
      this.selectBridge.setArmed(!cancelled, event.clientX, event.clientY, event.timeStamp, false);
    }
    if (this.waiting?.down.pointerId === id) {
      // Lifted before it wrote: a tap, as the pen's. Cancelled, it never was.
      if (cancelled) {
        this.dropWaiting();
        return;
      }
      this.writeWaiting();
    }
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
      altitude: altitudeOf(event),
      t: event.timeStamp,
      pointerType: event.pointerType,
    };
  }

  private notePenSeen(event: PointerEvent): void {
    if (event.pointerType === "pen") this.penSeenAt = event.timeStamp;
    this.notePenReturned(event);
  }

  /** Any pen event while fingers draw: the Pencil is back (`finger-draw.ts`). */
  private notePenReturned(event: PointerEvent): void {
    if (endsFingerDrawing(event.pointerType) && this.fingerDraws()) this.listener.onPenReturned?.();
  }

  /**
   * One position off both grids is enough: this device's pen does not round.
   * Whole CSS px stays a grid of its own (the old iPads), whatever the ratio.
   */
  private notePen(position: { clientX: number; clientY: number }): void {
    if (this.penIsPrecise || isWholePixel(position)) return;
    if (isOnDevicePixel(position, this.pixelRatio())) this.penOnDevicePx = true;
    else this.penIsPrecise = true;
  }

  private pixelRatio(): number {
    const own = this.options.pixelRatio;
    return own ? own() : (this.element.ownerDocument?.defaultView?.devicePixelRatio ?? 1);
  }

  private debug(
    type: PointerDebugType,
    event: PointerEvent,
    coalesced: number,
    taken: readonly PointerEvent[] = [],
  ): void {
    if (!this.listener.onDebug) return;
    const { pointerType, pointerId, pressure, timeStamp, altitudeAngle, azimuthAngle } = event;
    const wholePixel = isWholePixel(event);
    const angle = typeof altitudeAngle === "number" && Number.isFinite(altitudeAngle);
    const tilt = Number.isFinite(event.tiltX) && Number.isFinite(event.tiltY);
    this.listener.onDebug({
      type,
      pointerType,
      pointerId,
      pressure,
      coalesced,
      timeStamp,
      wholePixel,
      altitude: altitudeOf(event),
      azimuth:
        typeof azimuthAngle === "number" && Number.isFinite(azimuthAngle)
          ? (azimuthAngle * 180) / Math.PI
          : Number.NaN,
      tiltSource: angle ? "angle" : tilt ? "tilt" : "none",
      ownTilts: new Set(taken.map((e) => altitudeOf(e))).size,
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
