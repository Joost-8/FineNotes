/**
 * A click of a tablet pen's side (barrel) button with the pen in the air:
 * pressed and let go within {@link CLICK_MAX_MS}, without touching the glass
 * and without moving far. As on a Samsung tablet with Samsung Notes, the
 * click opens the pen menu, and the next one closes it. Holding the button
 * while writing still does what `pen-modifiers.ts` says (erase, lasso, move
 * the page or nothing): a press that touches down or travels becomes that
 * stroke.
 *
 * Browsers report the button three ways, and a click may come through more
 * than one of them, so {@link StylusClicks} hears all three and counts one:
 *
 * - **A press of its own.** Pointer Events put a pen whose button is pressed
 *   in the air in the "active buttons state": a `pointerdown` with button 2
 *   and no contact bit, `pointermove`s while it is held, and a `pointerup`
 *   when it is let go. Chromium on a computer does this. The press is held
 *   back ({@link StylusClicks.down}) until it is a click or a stroke.
 * - **Hovering moves.** A browser may only set the button's bit in the
 *   hovering `pointermove`s, with no press: the bit coming and going again
 *   is the click.
 * - **`contextmenu`.** A WebView may hand the button over as nothing but a
 *   right-click with `pointerType` "pen"; that counts when the pointer events
 *   saw no button.
 *
 * Pure: no DOM, no Obsidian.
 */

/** What a click of the pen's side button does, as the settings store it. */
export type StylusClickAction = "pen-menu" | "none";

export const STYLUS_CLICK_ACTIONS: readonly StylusClickAction[] = ["pen-menu", "none"];

/** A stored click setting as one, or the default (the pen menu) when it is not one. */
export function stylusClickActionOf(value: unknown): StylusClickAction {
  return (STYLUS_CLICK_ACTIONS as readonly unknown[]).includes(value)
    ? (value as StylusClickAction)
    : "pen-menu";
}

/** A press held longer than this (ms) is no click: the button was held for something else. */
export const CLICK_MAX_MS = 1500;

/** A press that travels further than this (screen px) is a hovering gesture, not a click. */
export const CLICK_SLOP_PX = 12;

/**
 * Two clicks through the same report closer than this (ms) are one: some
 * drivers bounce. Through two different reports, one click may be heard
 * twice as much as {@link CLICK_MAX_MS} apart, the press seen as it went down
 * and the `contextmenu` as it came up.
 */
export const CLICK_REPEAT_MS = 300;

/** The parts of a `PointerEvent` this module reads. */
export interface PenReading {
  pointerType: string;
  /** The button that changed (2 barrel, 5 eraser end; 0 contact). */
  button: number;
  /** Every button held, as a bit set (1 contact, 2 barrel, 32 eraser end). */
  buttons: number;
  clientX: number;
  clientY: number;
  /** The event's time stamp, ms. */
  timeStamp: number;
}

/**
 * What a held-back press's move means: wait on, the stroke it has become,
 * the click, or nothing at all (let go in the air, but too late or too far).
 */
export type HeldStep = "wait" | "stroke" | "click" | "over";

/** `buttons` bit of a pen touching the surface. */
const CONTACT_BIT = 1;
/** `buttons` bit of a pen's barrel (secondary) button. */
const BARREL_BIT = 2;
/** `buttons` bit of a pen's eraser end. */
const ERASER_BIT = 32;
/** `button` of a pen's eraser end, as some drivers report the press. */
const ERASER_BUTTON = 5;

type Report = "press" | "hover" | "menu";

interface Press {
  report: Exclude<Report, "menu">;
  x: number;
  y: number;
  t: number;
}

/**
 * Whether a `pointerdown` is the pen's side button pressed in the air: a pen,
 * the barrel down, not touching, and not the eraser end.
 */
export function isAirPress(e: PenReading): boolean {
  if (e.pointerType !== "pen") return false;
  const buttons = e.buttons ?? 0;
  if ((buttons & ERASER_BIT) !== 0 || e.button === ERASER_BUTTON) return false;
  if ((buttons & CONTACT_BIT) !== 0) return false;
  return (buttons & BARREL_BIT) !== 0 || e.button === 2;
}

/** The side-button clicks of one page's pen, whichever way the browser reports them. */
export class StylusClicks {
  private press: Press | null = null;
  private last: { report: Report; t: number } | null = null;

  /**
   * A `pointerdown`. True when it is the side button pressed in the air,
   * held back for {@link held} and {@link heldUp} to decide; any other press
   * ends a click being watched for (the pen came down to write).
   */
  down(e: PenReading): boolean {
    if (!isAirPress(e)) {
      this.press = null;
      return false;
    }
    this.press = { report: "press", x: e.clientX, y: e.clientY, t: e.timeStamp };
    return true;
  }

  /**
   * A move of the held-back press: it becomes a stroke once it touches the
   * glass or travels, and a click if the button is let go in the air (a
   * browser that ends the press with a move rather than a `pointerup`).
   */
  held(e: PenReading): HeldStep {
    const press = this.press;
    if (press?.report !== "press") return "over";
    const buttons = e.buttons ?? 0;
    if ((buttons & CONTACT_BIT) !== 0 || this.travelled(press, e)) {
      this.press = null;
      return "stroke";
    }
    if ((buttons & BARREL_BIT) === 0) return this.finish(e) ? "click" : "over";
    return "wait";
  }

  /** The held-back press let go: whether it was a click. */
  heldUp(e: PenReading): boolean {
    if (this.press?.report !== "press") return false;
    return this.finish(e);
  }

  /**
   * A hovering pen's move (no press under way): the button's bit coming is
   * a press, and going again in the air, soon and near, is the click.
   */
  hover(e: PenReading): boolean {
    if (e.pointerType !== "pen") return false;
    const buttons = e.buttons ?? 0;
    const barrel = (buttons & BARREL_BIT) !== 0;
    if ((buttons & (CONTACT_BIT | ERASER_BIT)) !== 0) {
      this.press = null;
      return false;
    }
    const press = this.press;
    if (barrel) {
      if (press === null)
        this.press = { report: "hover", x: e.clientX, y: e.clientY, t: e.timeStamp };
      else if (press.report === "hover" && this.travelled(press, e)) this.press = null;
      return false;
    }
    if (press?.report !== "hover") return false;
    return this.finish(e);
  }

  /**
   * A `pointerup` or `pointercancel` of a pen not held back: whatever the
   * hovering moves were watching is over, so the moves that follow it with
   * the button up are no click. (A press this page never heard of, as when a
   * popover took its `pointerdown`, still sends its `pointerup` here.)
   */
  lifted(): void {
    this.press = null;
  }

  /**
   * A `contextmenu` from a pen, the pen not writing: a click unless the
   * pointer events have the button in hand or heard this click already.
   */
  menu(t: number): boolean {
    if (this.press !== null) return false;
    if (this.heardAlready("menu", t)) return false;
    this.last = { report: "menu", t };
    return true;
  }

  /** Forget the press under way (the page went away, the setting changed). */
  reset(): void {
    this.press = null;
  }

  private finish(e: PenReading): boolean {
    const press = this.press;
    this.press = null;
    if (!press) return false;
    if (e.timeStamp - press.t > CLICK_MAX_MS || this.travelled(press, e)) return false;
    if (this.heardAlready(press.report, e.timeStamp)) return false;
    this.last = { report: press.report, t: e.timeStamp };
    return true;
  }

  private travelled(press: Press, e: PenReading): boolean {
    return Math.hypot(e.clientX - press.x, e.clientY - press.y) > CLICK_SLOP_PX;
  }

  /** The same click heard a second time: again through one report, or through another. */
  private heardAlready(report: Report, t: number): boolean {
    const last = this.last;
    if (!last) return false;
    const gap = t - last.t;
    return gap >= 0 && gap < (last.report === report ? CLICK_REPEAT_MS : CLICK_MAX_MS);
  }
}
