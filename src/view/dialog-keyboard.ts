/**
 * Keeps the field being typed in a dialog above the iPad's on-screen
 * keyboard. Lifted out of the notebook settings dialog, where it was worked
 * out against Joost's recording (2026-09-22), so every dialog with a text
 * field behaves the same:
 *
 * - While a field has focus, Obsidian's keyboard cap on the app is lifted
 *   (the `goodobsidian-dialog-typing` body class, styles.css), or the app
 *   behind the dialog collapses to black.
 * - The dialog rises just far enough to keep the field's row — and anything
 *   listed under it — above the keyboard, and settles back when typing ends.
 * - The window scrolling iPadOS does to "reveal" a field is undone.
 *
 * The dialog's `modalEl` gets `goodobsidian-keyboard-lift`, whose CSS turns
 * the lift into a `translate`.
 */

import { keyboardHeight } from "./keyboard";
import { captureScroll, holdScroll, keyboardGone } from "./scroll-hold";

/** Lifts Obsidian's keyboard cap on the app (styles.css), as the New notebook dialog does. */
const TYPING_BODY_CLASS = "goodobsidian-dialog-typing";
/** How long after a field takes focus the dialog follows the keyboard as it slides in, ms. */
const FOLLOW_KEYBOARD_MS = 1200;
const POLL_MS = 50;
/** Longest the cap stays lifted after typing ends, waiting for the keyboard to go, ms. */
const CAP_RELEASE_MS = 1500;
/** Room kept between the field (or its list) and the keyboard, px. */
const KEYBOARD_GAP_PX = 12;

export class DialogKeyboard {
  /** The row being typed in, and an optional list under it that must stay visible too. */
  private typing: { row: HTMLElement; below: HTMLElement | null } | null = null;
  /** How far the dialog has risen above the keyboard, px. */
  private lift = 0;
  private followTimer = 0;
  private capTimer = 0;
  private stopHold: (() => void) | null = null;

  constructor(private readonly modalEl: HTMLElement) {
    modalEl.addClass("goodobsidian-keyboard-lift");
  }

  /**
   * Wire `field` so the dialog follows the keyboard while it has focus.
   * `row` is what must stay visible (the field's setting row, say).
   */
  watch(field: HTMLElement, row: HTMLElement, below: HTMLElement | null = null): void {
    field.addEventListener("pointerdown", () => {
      if (document.activeElement !== field) this.holdWindow(field);
    });
    field.addEventListener("focus", () => this.start(row, below));
    field.addEventListener("blur", () => this.endFor(row));
  }

  /**
   * The field in `row` lost focus: end typing on the next tick, unless focus
   * went straight into another field, whose `start` then takes over.
   */
  endFor(row: HTMLElement): void {
    window.setTimeout(() => {
      if (this.typing?.row === row) this.end();
    }, 0);
  }

  /** A field in `row` took focus. */
  start(row: HTMLElement, below: HTMLElement | null = null): void {
    this.typing = { row, below };
    window.clearTimeout(this.capTimer);
    this.capTimer = 0;
    document.body.addClass(TYPING_BODY_CLASS);
    // Follow the keyboard as it slides in; `keyboardHeight` reads 0 until then.
    window.clearInterval(this.followTimer);
    const until = performance.now() + FOLLOW_KEYBOARD_MS;
    this.followTimer = window.setInterval(() => {
      this.update();
      if (performance.now() >= until) {
        window.clearInterval(this.followTimer);
        this.followTimer = 0;
      }
    }, POLL_MS);
    this.update();
  }

  /** Nothing is being typed any more: settle the dialog back and put the cap back later. */
  end(): void {
    this.typing = null;
    window.clearInterval(this.followTimer);
    this.followTimer = 0;
    this.setLift(0);
    this.releaseCap();
  }

  /**
   * Raise the dialog until the row being typed in — its field and the list
   * under it — sits above the keyboard, and lower it again as far as that
   * allows. The row's top never goes above the screen. Call it again when
   * the row changes height.
   */
  update(): void {
    const typing = this.typing;
    if (!typing || !typing.row.isConnected) return;
    const keyboard = keyboardHeight();
    if (keyboard === 0) {
      this.setLift(0);
      return;
    }
    // Measured where the dialog would sit unlifted, never where it is now: the
    // lift glides (a CSS transition), and reading a half-moved dialog every
    // poll fed back into ever more lift. The row's offset within the dialog
    // does not move, and `offsetTop` ignores `translate`.
    const modalBox = this.modalEl.getBoundingClientRect();
    const parentTop = this.modalEl.offsetParent?.getBoundingClientRect().top ?? 0;
    const restingTop = parentTop + this.modalEl.offsetTop;
    const rowBox = typing.row.getBoundingClientRect();
    const below =
      typing.below && !typing.below.hasClass("is-hidden")
        ? typing.below.getBoundingClientRect()
        : null;
    const top = restingTop + (rowBox.top - modalBox.top);
    const bottom = restingTop + (Math.max(rowBox.bottom, below?.bottom ?? 0) - modalBox.top);
    const limit = window.innerHeight - keyboard - KEYBOARD_GAP_PX;
    // Only as far as the row needs, and never so far that its top leaves the screen.
    const next = Math.min(bottom - limit, top - KEYBOARD_GAP_PX);
    this.setLift(Math.max(0, next));
  }

  private setLift(px: number): void {
    const next = Math.round(px);
    if (next === this.lift) return;
    this.lift = next;
    this.modalEl.setCssProps({ "--goodobsidian-dialog-lift": `${next}px` });
  }

  /** Undo the window scrolling iPadOS does to "reveal" a field, while the keyboard comes up. */
  holdWindow(field: HTMLElement): void {
    this.stopHold?.();
    this.stopHold = holdScroll(captureScroll(field), { minMs: 600, maxMs: FOLLOW_KEYBOARD_MS });
  }

  /** Put Obsidian's keyboard cap back once the keyboard is down, when it changes nothing. */
  private releaseCap(): void {
    window.clearTimeout(this.capTimer);
    const deadline = performance.now() + CAP_RELEASE_MS;
    const attempt = (): void => {
      this.capTimer = 0;
      if (this.typing) return;
      if (keyboardGone() || performance.now() >= deadline) {
        document.body.removeClass(TYPING_BODY_CLASS);
        return;
      }
      this.capTimer = window.setTimeout(attempt, POLL_MS);
    };
    attempt();
  }
}
