/**
 * The pen cursor drawn by the page while a tablet pen hovers over it, for
 * computers whose pen never wears the CSS cursor (FineNotes#266: a Linux
 * tablet under Wayland shows the system arrow, a mouse the ink dot).
 *
 * One light element over the page holds the same image the CSS cursor uses
 * (`pen-cursor.ts`), at its true size. Pointer handlers only note where the
 * pen is; the element moves in the next frame, which Chromium runs right
 * after the frame's pointer events, so it keeps up with the pen. While it
 * shows, the surface carries `is-pen-hovering` and the page's own cursor is
 * `none` (styles.css), so the two never stack where the system honours it.
 *
 * Which cursor style and tool wear it is left to the surface's classes, as
 * for the mouse: this only says a pen hovers, where, and with which image.
 */

import { type PenCursor, hoverCursorOffset, penHoverAction } from "./pen-cursor";

const EVENTS = [
  "pointermove",
  "pointerdown",
  "pointerup",
  "pointercancel",
  "pointerleave",
] as const;

export class PenHoverCursor {
  private readonly el: HTMLElement;
  private cursor: PenCursor | null = null;
  private shown = false;
  private clientX = 0;
  private clientY = 0;
  private frame = 0;
  private readonly onEvent = (event: PointerEvent): void => this.hear(event);

  /** `host` holds the drawn cursor (the surface); `target` is the page's scroll area. */
  constructor(
    private readonly host: HTMLElement,
    private readonly target: HTMLElement,
  ) {
    this.el = host.createDiv({ cls: "goodobsidian-pen-hover-cursor" });
    for (const type of EVENTS) {
      target.addEventListener(type, this.onEvent, { capture: true, passive: true });
    }
  }

  /** The image to draw: the pen's ink dot or the crosshair, or none. */
  setImage(cursor: PenCursor | null): void {
    this.cursor = cursor;
    if (!cursor) {
      this.setShown(false);
      return;
    }
    this.el.setCssStyles({
      width: `${cursor.width}px`,
      height: `${cursor.height}px`,
      backgroundImage: `url("${cursor.url}")`,
    });
    if (this.shown) this.place();
  }

  destroy(): void {
    for (const type of EVENTS) {
      this.target.removeEventListener(type, this.onEvent, { capture: true });
    }
    if (this.frame) this.host.win.cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.el.remove();
  }

  private hear(event: PointerEvent): void {
    // A capture listener also hears each child's own leave: only the page's counts.
    if (event.type === "pointerleave" && event.target !== this.target) return;
    const action = penHoverAction(event);
    if (action === "keep") return;
    if (action === "hide" || !this.cursor) {
      this.setShown(false);
      return;
    }
    this.clientX = event.clientX;
    this.clientY = event.clientY;
    this.setShown(true);
    if (!this.frame) this.frame = this.host.win.requestAnimationFrame(() => this.place());
  }

  private setShown(on: boolean): void {
    if (on === this.shown) return;
    this.shown = on;
    this.host.toggleClass("is-pen-hovering", on);
  }

  /** Move the element under the pen: one layout read, one transform. */
  private place(): void {
    this.frame = 0;
    const cursor = this.cursor;
    if (!this.shown || !cursor) return;
    const at = hoverCursorOffset(
      this.clientX,
      this.clientY,
      this.host.getBoundingClientRect(),
      cursor,
    );
    this.el.setCssStyles({ transform: `translate(${at.x}px, ${at.y}px)` });
  }
}
