/**
 * What a pen or mouse press does instead of the tool in hand (FineNotes#25):
 * a keyboard modifier held, a stylus button pressed, or a press beside the
 * pages. Every one of them lasts for that one press: the next press without
 * it uses the tool again, so nothing has to be switched back.
 *
 * - **Shift** erases, with the eraser's own settings.
 * - **Ctrl** (Windows, Linux) or **Cmd** (macOS, iPadOS) lassos. Not Ctrl on
 *   a Mac: there a Ctrl-click is the right click.
 * - **Alt** (Option) zooms: drawn up zooms in, down zooms out, about where
 *   the pen came down ({@link dragZoom}).
 * - A tablet pen's **eraser end** erases. It reports `buttons & 32`, and
 *   some drivers `button === 5` on the press.
 * - The pen's **barrel button** (`buttons & 2`) does what the settings say:
 *   erase, lasso, move the page, or nothing.
 * - A pen's **second barrel button**, where it has one, does what its own
 *   setting says (nothing, unless set). Browsers send it as the middle
 *   button: `buttons & 4`, and `button === 1` on the press.
 * - A pen or mouse pressed **beside the pages** (the margin or the gutter)
 *   moves the page, with a fling, as a finger does (rnote). Fingers are left
 *   to `palm-rejection.ts`.
 *
 * The stylus buttons win over the keys, and of the keys Alt over Cmd/Ctrl
 * over Shift, so a chord always means one thing.
 *
 * Pure: no DOM, no Obsidian.
 */

/** What the barrel button does, as the settings store it. */
export type BarrelAction = "erase" | "lasso" | "pan" | "none";

export const BARREL_ACTIONS: readonly BarrelAction[] = ["erase", "lasso", "pan", "none"];

/**
 * A stored barrel setting as one, or `fallback` when it is not one: erase
 * for the first barrel button, nothing for the second.
 */
export function barrelActionOf(value: unknown, fallback: BarrelAction = "erase"): BarrelAction {
  return (BARREL_ACTIONS as readonly unknown[]).includes(value)
    ? (value as BarrelAction)
    : fallback;
}

/**
 * What a press is for, when it is not for the tool in hand. `ignore` is a
 * barrel set to do nothing, pressed while the pen hovers: no stroke at all.
 */
export type PressOverride = "eraser" | "select" | "zoom" | "pan" | "ignore";

/** The parts of a `PointerEvent` this module reads. */
export interface PressInput {
  pointerType: string;
  /** The button that went down (0 contact or left, 1 second barrel, 2 barrel or right, 5 eraser end). */
  button: number;
  /** Every button held, as a bit set (1 contact, 2 barrel, 4 second barrel, 32 eraser end). */
  buttons: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/** What the press happens on. */
export interface PressContext {
  /** Cmd is the command key here (macOS, iPadOS), so Ctrl is not the lasso's. */
  mac: boolean;
  barrel: BarrelAction;
  /** What the second barrel button does; nothing when absent. */
  secondBarrel?: BarrelAction;
  /** The press landed on a page, not in the margin or the gutter around it. */
  onPage: boolean;
}

/** `buttons` bit of a pen touching the surface. */
const CONTACT_BIT = 1;
/** `buttons` bit of a pen's barrel (secondary) button. */
const BARREL_BIT = 2;
/** `buttons` bit of a pen's second barrel button (the middle button). */
const SECOND_BARREL_BIT = 4;
/** `button` of a pen's second barrel button, as the press reports it. */
const SECOND_BARREL_BUTTON = 1;
/** `buttons` bit of a pen's eraser end. */
const ERASER_BIT = 32;
/** `button` of a pen's eraser end, as some drivers report the press. */
const ERASER_BUTTON = 5;

/**
 * A stylus button's override, or `undefined` when no stylus button is down.
 * The eraser end wins over the barrel buttons, and the first over the second.
 */
function stylusOverride(
  press: PressInput,
  barrel: BarrelAction,
  secondBarrel: BarrelAction,
): PressOverride | null | undefined {
  if (press.pointerType !== "pen") return undefined;
  if ((press.buttons & ERASER_BIT) !== 0 || press.button === ERASER_BUTTON) return "eraser";
  if ((press.buttons & BARREL_BIT) !== 0 || press.button === 2) {
    return barrelOverride(press, barrel);
  }
  if ((press.buttons & SECOND_BARREL_BIT) !== 0 || press.button === SECOND_BARREL_BUTTON) {
    return barrelOverride(press, secondBarrel);
  }
  return undefined;
}

/** What a barrel button set to `action` makes of the press. */
function barrelOverride(press: PressInput, action: BarrelAction): PressOverride | null {
  switch (action) {
    case "erase":
      return "eraser";
    case "lasso":
      return "select";
    case "pan":
      return "pan";
    case "none":
      // Writing with the button held writes; the button alone, hovering, is no stroke.
      return (press.buttons & CONTACT_BIT) !== 0 ? null : "ignore";
  }
}

/**
 * What a pen or mouse press is for instead of the tool, or `null` for the
 * tool itself. A finger is never overridden.
 */
export function pressOverride(press: PressInput, context: PressContext): PressOverride | null {
  if (press.pointerType === "touch") return null;
  const stylus = stylusOverride(press, context.barrel, context.secondBarrel ?? "none");
  if (stylus !== undefined) return stylus;
  if (press.altKey) return "zoom";
  if (context.mac ? press.metaKey : press.ctrlKey) return "select";
  if (press.shiftKey) return "eraser";
  return context.onPage ? null : "pan";
}

/** Whether a barrel or eraser-end press is down, so the right-click menu it brings is not wanted. */
export function stylusButtonDown(press: PressInput): boolean {
  return press.pointerType === "pen" && stylusOverride(press, "erase", "erase") !== undefined;
}

/**
 * Screen px of travel that doubles (up) or halves (down) the zoom. 150 px
 * is a comfortable flick of the wrist on a tablet and still fine on a
 * phone-sized pane; the zoom is continuous in between.
 */
export const ZOOM_DOUBLING_PX = 150;

/**
 * The zoom for an Alt-drag that started at zoom `from` and has since moved
 * `dy` screen px down (negative: up), within `min`…`max`. Exponential in the
 * travel, so the same stroke length always zooms by the same factor.
 */
export function dragZoom(from: number, dy: number, min: number, max: number): number {
  const zoom = from * Math.pow(2, -dy / ZOOM_DOUBLING_PX);
  if (!Number.isFinite(zoom)) return from;
  return Math.min(max, Math.max(min, zoom));
}
