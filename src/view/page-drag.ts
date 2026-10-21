/**
 * Dragging page thumbnails to reorder pages, in the page sidebar and its
 * overview. The geometry is `page-drag-model.ts`; this is the input and the
 * drawing.
 *
 * - **Mouse and Pencil:** press on a page and move: it lifts at once.
 * - **Finger:** rest on a page for {@link HOLD_MS}, then move. A finger
 *   that moves sooner is a scroll, and the panel scrolls natively.
 *
 * While dragging, a copy of the page follows the pointer (lifted, with a
 * count when several selected pages move together), the pages being moved
 * fade where they were, an accent bar marks the gap the drop would land in,
 * and the panel scrolls when the pointer nears its top or bottom edge.
 * Letting go over the panel moves the pages (one undoable command, by the
 * host); letting go outside it, Escape, or a cancelled touch puts them back.
 *
 * iPad traps (CLAUDE.md ledger):
 * - The finger path runs on touch events, as Obsidian's own drag-to-reorder
 *   does (read from its `app.js`). A `touchstart` cannot be cancelled
 *   without stopping the scroll, so it is not; once the page has lifted,
 *   `touchmove` is cancelled instead, which stops the scroll from starting,
 *   and the long-press `contextmenu` is swallowed.
 * - A Pencil's `touchstart` on a page *is* cancelled: otherwise the Pencil
 *   scrolls the panel, and a held Pencil ends in `pointercancel` (WebKit's
 *   long press). That also means a Pencil tap never becomes a `click`, so
 *   the Pencil's taps are reported from `pointerup` ({@link PageDragHost.onPenTap}).
 */

import {
  type Box,
  type DropSlot,
  HOLD_MS,
  POINTER_SLOP_PX,
  TOUCH_SLOP_PX,
  dropSlotAt,
  edgeScrollSpeed,
  realGap,
} from "./page-drag-model";

export interface PageDragHost {
  /** Whether pages can be dragged now (an editable notebook of several pages). */
  canDrag(): boolean;
  /** The thumbnails shown, in order, each with its page's real index. */
  shown(): Array<{ root: HTMLElement; index: number }>;
  /** The pages that move when page `index` is dragged: the selection it is in, or itself. */
  moving(index: number): number[];
  /** The top of the panel's visible part, below its sticky header (client px). */
  visibleTop(): number;
  /** Move `indexes` to gap `gap` of the whole page list (page-order.ts). */
  onDrop(indexes: number[], gap: number): void;
  /** A Pencil tap on page `index`'s thumbnail, which no `click` follows. */
  onPenTap(index: number, target: Element, event: PointerEvent): void;
}

interface Press {
  kind: "pointer" | "touch";
  /** Pointer id, or touch identifier. */
  id: number;
  index: number;
  root: HTMLElement;
  /** What was pressed (the ribbon, or the page), for a tap. */
  target: Element;
  startX: number;
  startY: number;
  x: number;
  y: number;
  /** The finger's hold timer, while it runs. */
  timer: number;
}

interface Drag {
  indexes: number[];
  sources: HTMLElement[];
  ghost: HTMLElement;
  /** The drop bar: over the lifted page, which would otherwise hide it. */
  bar: HTMLElement;
  /** Where in the ghost the pointer holds it. */
  grabX: number;
  grabY: number;
  slot: DropSlot | null;
  frame: number;
}

/** A thumbnail's page frame (the button), and the thumbnail it belongs to. */
const FRAME = ".goodobsidian-thumb-frame";
const THUMB = ".goodobsidian-thumb";

export class PageDrag {
  private press: Press | null = null;
  private drag: Drag | null = null;
  /** A drag just ended with the mouse: the `click` that follows it is not a tap. */
  private swallowClickUntil = 0;
  private readonly cleanups: Array<() => void> = [];

  constructor(
    /** The scrolling panel. */
    private readonly scroller: HTMLElement,
    /** The thumbnails' container. */
    private readonly grid: HTMLElement,
    private readonly host: PageDragHost,
  ) {
    this.listen(grid, "pointerdown", (e) => this.onPointerDown(e));
    this.listen(grid, "touchstart", (e) => this.onTouchStart(e), { passive: false });
    // The long press's menu (and, on a desktop, a right-click) mid-drag.
    this.listen(grid, "contextmenu", (e) => {
      if (this.press?.kind === "touch" || this.drag) e.preventDefault();
    });
  }

  /** Whether a page is being dragged. */
  get active(): boolean {
    return this.drag !== null;
  }

  /**
   * True once for the `click` a mouse drag ends with, which must not open
   * the page it was let go over.
   */
  consumeClick(): boolean {
    return performance.now() < this.swallowClickUntil;
  }

  /** Put the pages back and stop (Escape, the panel closing, the document changing). */
  cancel(): void {
    this.finish(false);
  }

  destroy(): void {
    this.finish(false);
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups.length = 0;
  }

  // --- Input ----------------------------------------------------------------

  private listen<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, handler, options);
    this.cleanups.push(() => target.removeEventListener(type, handler, options));
  }

  /** The thumbnail whose page frame `target` is inside, and its page index. */
  private thumbAt(target: EventTarget | null): { root: HTMLElement; index: number } | null {
    if (!(target instanceof Element) || !target.closest(FRAME)) return null;
    const root = target.closest<HTMLElement>(THUMB);
    if (!root || !this.grid.contains(root)) return null;
    return this.host.shown().find((item) => item.root === root) ?? null;
  }

  private onPointerDown(event: PointerEvent): void {
    if (event.pointerType === "touch" || event.button !== 0 || this.press || this.drag) return;
    const thumb = this.thumbAt(event.target);
    if (!thumb || !(event.target instanceof Element)) return;
    this.press = {
      kind: "pointer",
      id: event.pointerId,
      index: thumb.index,
      root: thumb.root,
      target: event.target,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      timer: 0,
    };
    const win = this.grid.win;
    const move = (e: PointerEvent) => {
      if (e.pointerId !== this.press?.id || this.press.kind !== "pointer") return;
      this.press.x = e.clientX;
      this.press.y = e.clientY;
      if (!this.drag) {
        const moved = Math.hypot(e.clientX - this.press.startX, e.clientY - this.press.startY);
        if (moved < POINTER_SLOP_PX || !this.host.canDrag()) return;
        this.begin(this.press);
      }
      e.preventDefault();
      this.moveTo(e.clientX, e.clientY);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== this.press?.id) return;
      const press = this.press;
      done();
      const moved = Math.hypot(e.clientX - press.startX, e.clientY - press.startY);
      if (this.drag) {
        this.swallowClickUntil = performance.now() + 400;
        this.finish(true);
      } else if (e.pointerType === "pen" && moved < POINTER_SLOP_PX) {
        // No click follows a Pencil tap here: its touchstart was cancelled.
        this.swallowClickUntil = performance.now() + 400;
        this.host.onPenTap(press.index, press.target, e);
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
      if (this.thumbAt(event.target)) event.preventDefault();
      return;
    }
    if (event.touches.length > 1) {
      // A second finger: a pinch or a two-finger scroll, never a drag.
      const dragged = this.drag !== null;
      this.release();
      if (dragged) this.finish(false);
      return;
    }
    if (this.press || this.drag) return;
    const thumb = this.thumbAt(event.target);
    if (!thumb || !this.host.canDrag()) return;
    const win = this.grid.win;
    const press: Press = {
      kind: "touch",
      id: touch.identifier,
      index: thumb.index,
      root: thumb.root,
      target: thumb.root,
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
      this.begin(press);
      this.moveTo(press.x, press.y);
    }, HOLD_MS);
    this.press = press;
    const find = (e: TouchEvent) =>
      Array.from(e.changedTouches).find((t) => t.identifier === press.id) ?? null;
    const move = (e: TouchEvent) => {
      const t = find(e);
      if (!t || this.press !== press) return;
      press.x = t.clientX;
      press.y = t.clientY;
      if (!this.drag) {
        // Moved before it lifted: a scroll, which the panel already has.
        if (Math.hypot(t.clientX - press.startX, t.clientY - press.startY) > TOUCH_SLOP_PX) {
          done();
        }
        return;
      }
      if (e.cancelable) e.preventDefault();
      this.moveTo(t.clientX, t.clientY);
    };
    const end = (e: TouchEvent) => {
      if (!find(e) || this.press !== press) return;
      const dragged = this.drag !== null;
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

  /** Stop following the pointer or finger pressed on a page, if any. */
  private release: () => void = () => undefined;

  // --- Dragging ---------------------------------------------------------------

  private begin(press: Press): void {
    const moving = this.host.moving(press.index);
    const indexes = moving.includes(press.index) ? moving : [press.index];
    const shown = this.host.shown();
    const sources = shown.filter((item) => indexes.includes(item.index)).map((item) => item.root);
    const frame = press.root.querySelector<HTMLElement>(FRAME) ?? press.root;
    const rect = frame.getBoundingClientRect();
    const others = sources
      .filter((root) => root !== press.root)
      .map((root) => root.querySelector<HTMLElement>(FRAME))
      .filter((other): other is HTMLElement => other !== null);
    const ghost = liftedCopy(frame, rect, indexes.length, others);
    const body = press.root.doc.body;
    body.appendChild(ghost);
    const bar = body.createDiv({ cls: "goodobsidian-thumb-drop is-hidden" });
    for (const root of sources) root.addClass("is-drag-source");
    this.scroller.addClass("is-dragging-page");
    this.drag = {
      indexes,
      sources,
      ghost,
      bar,
      grabX: press.startX - rect.left,
      grabY: press.startY - rect.top,
      slot: null,
      frame: 0,
    };
    // A short buzz where the platform has one, as Obsidian gives its own lift.
    this.grid.win.navigator.vibrate?.(30);
    this.autoScroll();
  }

  private moveTo(x: number, y: number): void {
    const drag = this.drag;
    if (!drag) return;
    drag.ghost.setCssStyles({
      transform: `translate(${x - drag.grabX}px, ${y - drag.grabY}px) scale(1.06) rotate(-2deg)`,
    });
    this.updateSlot();
  }

  /** The gap under the pointer now, and the bar that shows it. */
  private updateSlot(): void {
    const drag = this.drag;
    const press = this.press;
    if (!drag || !press) return;
    const panel = this.scroller.getBoundingClientRect();
    const inside =
      press.x >= panel.left &&
      press.x <= panel.right &&
      press.y >= panel.top &&
      press.y <= panel.bottom;
    const boxes: Box[] = this.host.shown().map(({ root }) => {
      const r = root.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    });
    drag.slot = inside ? dropSlotAt(boxes, press.x, press.y) : null;
    const slot = drag.slot;
    // The bar floats over the page, so it is clipped to the panel's visible part by hand.
    const top = Math.max(panel.top, this.host.visibleTop());
    const y1 = Math.max(slot?.y1 ?? 0, top);
    const y2 = Math.min(slot?.y2 ?? 0, panel.bottom);
    const level = slot !== null && slot.y1 === slot.y2;
    drag.bar.toggleClass("is-hidden", !slot || (level ? y1 !== y2 : y2 <= y1));
    if (!slot) return;
    drag.bar.toggleClass("is-level", level);
    drag.bar.setCssStyles({
      left: `${level ? slot.x1 : slot.x1 - 2}px`,
      top: `${level ? y1 - 2 : y1}px`,
      width: level ? `${slot.x2 - slot.x1}px` : "",
      height: level ? "" : `${y2 - y1}px`,
    });
  }

  /** Scroll the panel while the pointer rests near its top or bottom edge. */
  private autoScroll(): void {
    const drag = this.drag;
    if (!drag) return;
    drag.frame = this.grid.win.requestAnimationFrame(() => {
      if (this.drag !== drag) return;
      const press = this.press;
      if (press) {
        const panel = this.scroller.getBoundingClientRect();
        const within = press.x >= panel.left && press.x <= panel.right;
        const top = Math.max(panel.top, this.host.visibleTop());
        const speed = within ? edgeScrollSpeed(press.y, top, panel.bottom) : 0;
        if (speed !== 0) {
          const before = this.scroller.scrollTop;
          this.scroller.scrollTop += speed;
          if (this.scroller.scrollTop !== before) this.updateSlot();
        }
      }
      this.autoScroll();
    });
  }

  /** End the drag: drop the pages where the bar shows (`drop`), or put them back. */
  private finish(drop: boolean): void {
    this.release();
    if (this.press) {
      this.grid.win.clearTimeout(this.press.timer);
      this.press = null;
    }
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    this.grid.win.cancelAnimationFrame(drag.frame);
    drag.ghost.remove();
    drag.bar.remove();
    for (const root of drag.sources) root.removeClass("is-drag-source");
    this.scroller.removeClass("is-dragging-page");
    if (!drop || !drag.slot) return;
    const shown = this.host.shown().map((item) => item.index);
    this.host.onDrop(drag.indexes, realGap(shown, drag.slot.gap));
  }
}

/** Whether a touch is the Pencil's. `touchType` is WebKit's; elsewhere there is none. */
function stylus(touch: Touch): boolean {
  return (touch as Touch & { touchType?: string }).touchType === "stylus";
}

/**
 * The page lifted off the panel: a copy of its thumbnail (pixels, not a
 * repaint) that follows the pointer, with the number of pages when several
 * move together.
 */
function liftedCopy(
  frame: HTMLElement,
  rect: DOMRect,
  count: number,
  /** The frames of the other pages moving too: the first few show as sheets underneath. */
  others: readonly HTMLElement[] = [],
): HTMLElement {
  const ghost = createDiv({ cls: "goodobsidian-thumb-ghost" });
  ghost.setCssStyles({
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    transform: `translate(${rect.left}px, ${rect.top}px)`,
  });
  if (count > 1) ghost.addClass("is-stack");
  // The pages beneath, fanned out behind the one grabbed, deepest first.
  const under = others.slice(0, MAX_SHEETS);
  under.forEach((other, i) => {
    const depth = under.length - i;
    const sheet = copyCanvas(ghost, other, "goodobsidian-thumb-ghost-sheet");
    sheet.setCssStyles({
      transform: `translate(${depth * 7}px, ${depth * 6}px) rotate(${depth % 2 === 0 ? -1 : 1}deg)`,
    });
  });
  if (count > 1 && under.length === 0) {
    copyCanvas(ghost, frame, "goodobsidian-thumb-ghost-sheet").setCssStyles({
      transform: "translate(7px, 7px) rotate(4deg)",
    });
  }
  copyCanvas(ghost, frame, "goodobsidian-thumb-ghost-canvas");
  if (count > 1) ghost.createSpan({ cls: "goodobsidian-thumb-ghost-count", text: String(count) });
  return ghost;
}

/** How many other pages show as sheets under the one grabbed. */
const MAX_SHEETS = 3;

/** A copy of a thumbnail's pixels (not a repaint), added to `parent`. */
function copyCanvas(parent: HTMLElement, frame: HTMLElement, cls: string): HTMLCanvasElement {
  const source = frame.querySelector("canvas");
  const copy = parent.createEl("canvas", { cls });
  if (source && source.width > 0 && source.height > 0) {
    copy.width = source.width;
    copy.height = source.height;
    copy.getContext("2d")?.drawImage(source, 0, 0);
  }
  return copy;
}
