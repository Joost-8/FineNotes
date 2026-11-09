/**
 * The input side of dragging something out of a panel that scrolls: when a
 * press becomes a drag. What is dragged and how it is drawn is the host's.
 *
 * - **Mouse and Pencil:** press and move: it lifts at once.
 * - **Finger:** rest for {@link HOLD_MS}, then move. A finger that moves
 *   sooner is a scroll, and the panel scrolls natively.
 *
 * iPad traps (CLAUDE.md ledger):
 * - The finger path runs on touch events, as Obsidian's own drag-to-reorder
 *   does (read from its `app.js`). A `touchstart` cannot be cancelled
 *   without stopping the scroll, so it is not; once the item has lifted,
 *   `touchmove` is cancelled instead, which stops the scroll from starting,
 *   and the long-press `contextmenu` is swallowed.
 * - A Pencil's `touchstart` on an item *is* cancelled: otherwise the Pencil
 *   scrolls the panel, and a held Pencil ends in `pointercancel` (WebKit's
 *   long press). That also means a Pencil tap never becomes a `click`, so
 *   the Pencil's taps are reported from `pointerup` ({@link PressDragHost.onPenTap}).
 */

import { HOLD_MS, POINTER_SLOP_PX, TOUCH_SLOP_PX } from "./page-drag-model";

export interface PressDragHost<T> {
  /** Whether anything can be dragged now. */
  canDrag(): boolean;
  /** The draggable item `target` is inside, if any. */
  itemAt(target: EventTarget | null): T | null;
  /** The press became a drag. */
  begin(item: T, startX: number, startY: number): void;
  /** The drag moved. */
  moveTo(x: number, y: number): void;
  /** The drag ended: `drop` to land it, otherwise it goes back. */
  end(drop: boolean): void;
  /** A Pencil tap on `item`, which no `click` follows. */
  onPenTap(item: T, target: Element, event: PointerEvent): void;
}

interface Press<T> {
  kind: "pointer" | "touch";
  /** Pointer id, or touch identifier. */
  id: number;
  item: T;
  target: Element;
  startX: number;
  startY: number;
  x: number;
  y: number;
  /** The finger's hold timer, while it runs. */
  timer: number;
}

export class PressDrag<T> {
  private press: Press<T> | null = null;
  private dragging = false;
  /** A drag just ended with the mouse: the `click` that follows it is not a tap. */
  private swallowClickUntil = 0;
  private readonly cleanups: Array<() => void> = [];
  /** Stop following the pointer or finger pressed on an item, if any. */
  private release: () => void = () => undefined;

  constructor(
    private readonly el: HTMLElement,
    private readonly host: PressDragHost<T>,
  ) {
    this.listen(el, "pointerdown", (e) => this.onPointerDown(e));
    this.listen(el, "touchstart", (e) => this.onTouchStart(e), { passive: false });
    // The long press's menu (and, on a desktop, a right-click) mid-drag.
    this.listen(el, "contextmenu", (e) => {
      if (this.press?.kind === "touch" || this.dragging) e.preventDefault();
    });
  }

  /** Whether something is being dragged. */
  get active(): boolean {
    return this.dragging;
  }

  /** Where the pointer or finger is now, during a press. */
  get point(): { x: number; y: number } | null {
    return this.press;
  }

  /** True for the `click` a mouse drag ends with, which must not count as a tap. */
  consumeClick(): boolean {
    return performance.now() < this.swallowClickUntil;
  }

  /** Put it back and stop. */
  cancel(): void {
    this.finish(false);
  }

  destroy(): void {
    this.finish(false);
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups.length = 0;
  }

  private listen<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, handler, options);
    this.cleanups.push(() => target.removeEventListener(type, handler, options));
  }

  private lift(press: Press<T>): void {
    this.dragging = true;
    this.host.begin(press.item, press.startX, press.startY);
  }

  private onPointerDown(event: PointerEvent): void {
    if (event.pointerType === "touch" || event.button !== 0 || this.press || this.dragging) return;
    const item = this.host.itemAt(event.target);
    if (item === null || !(event.target instanceof Element)) return;
    this.press = {
      kind: "pointer",
      id: event.pointerId,
      item,
      target: event.target,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      timer: 0,
    };
    const win = this.el.win;
    const move = (e: PointerEvent) => {
      if (e.pointerId !== this.press?.id || this.press.kind !== "pointer") return;
      this.press.x = e.clientX;
      this.press.y = e.clientY;
      if (!this.dragging) {
        const moved = Math.hypot(e.clientX - this.press.startX, e.clientY - this.press.startY);
        if (moved < POINTER_SLOP_PX || !this.host.canDrag()) return;
        this.lift(this.press);
      }
      e.preventDefault();
      this.host.moveTo(e.clientX, e.clientY);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== this.press?.id) return;
      const press = this.press;
      done();
      const moved = Math.hypot(e.clientX - press.startX, e.clientY - press.startY);
      if (this.dragging) {
        this.swallowClickUntil = performance.now() + 400;
        this.finish(true);
      } else if (e.pointerType === "pen" && moved < POINTER_SLOP_PX) {
        // No click follows a Pencil tap here: its touchstart was cancelled.
        this.swallowClickUntil = performance.now() + 400;
        this.host.onPenTap(press.item, press.target, e);
      }
    };
    const cancel = (e: PointerEvent) => {
      if (e.pointerId !== this.press?.id) return;
      done();
      this.finish(false);
    };
    const done = () => {
      win.removeEventListener("pointermove", move);
      win.removeEventListener("pointerup", up);
      win.removeEventListener("pointercancel", cancel);
      if (this.press?.kind === "pointer") this.press = null;
      this.release = () => undefined;
    };
    this.release = done;
    win.addEventListener("pointermove", move);
    win.addEventListener("pointerup", up);
    win.addEventListener("pointercancel", cancel);
  }

  private onTouchStart(event: TouchEvent): void {
    const touch = event.changedTouches[0];
    if (!touch) return;
    // A stylus: no scrolling and no long press; the pointer path drags it.
    if (stylus(touch)) {
      if (this.host.itemAt(event.target) !== null) event.preventDefault();
      return;
    }
    if (event.touches.length > 1) {
      // A second finger: a pinch or a two-finger scroll, never a drag.
      const dragged = this.dragging;
      this.release();
      if (dragged) this.finish(false);
      return;
    }
    if (this.press || this.dragging) return;
    const item = this.host.itemAt(event.target);
    if (item === null || !this.host.canDrag() || !(event.target instanceof Element)) return;
    const win = this.el.win;
    const press: Press<T> = {
      kind: "touch",
      id: touch.identifier,
      item,
      target: event.target,
      startX: touch.clientX,
      startY: touch.clientY,
      x: touch.clientX,
      y: touch.clientY,
      timer: 0,
    };
    // "Nothing moved for N ms" is a timer, never a check in a move handler.
    press.timer = win.setTimeout(() => {
      press.timer = 0;
      if (this.press !== press) return;
      this.lift(press);
      this.host.moveTo(press.x, press.y);
    }, HOLD_MS);
    this.press = press;
    const find = (e: TouchEvent) =>
      Array.from(e.changedTouches).find((t) => t.identifier === press.id) ?? null;
    const move = (e: TouchEvent) => {
      const t = find(e);
      if (!t || this.press !== press) return;
      press.x = t.clientX;
      press.y = t.clientY;
      if (!this.dragging) {
        // Moved before it lifted: a scroll, which the panel already has.
        if (Math.hypot(t.clientX - press.startX, t.clientY - press.startY) > TOUCH_SLOP_PX) {
          done();
        }
        return;
      }
      if (e.cancelable) e.preventDefault();
      this.host.moveTo(t.clientX, t.clientY);
    };
    const end = (e: TouchEvent) => {
      if (!find(e) || this.press !== press) return;
      const dragged = this.dragging;
      done();
      if (!dragged) return;
      // Lifted and let go: no tap, and no click.
      if (e.cancelable) e.preventDefault();
      this.finish(e.type === "touchend");
    };
    const done = () => {
      win.clearTimeout(press.timer);
      win.removeEventListener("touchmove", move);
      win.removeEventListener("touchend", end);
      win.removeEventListener("touchcancel", end);
      if (this.press === press) this.press = null;
      this.release = () => undefined;
    };
    this.release = done;
    win.addEventListener("touchmove", move, { passive: false });
    win.addEventListener("touchend", end);
    win.addEventListener("touchcancel", end);
  }

  private finish(drop: boolean): void {
    this.release();
    if (this.press) {
      this.el.win.clearTimeout(this.press.timer);
      this.press = null;
    }
    if (!this.dragging) return;
    this.dragging = false;
    this.host.end(drop);
  }
}

/** Whether a touch is the Pencil's. `touchType` is WebKit's; elsewhere there is none. */
function stylus(touch: Touch): boolean {
  return (touch as Touch & { touchType?: string }).touchType === "stylus";
}
