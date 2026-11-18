/**
 * Dragging page thumbnails to reorder pages, in the page sidebar and its
 * overview. The geometry is `page-drag-model.ts`; this is the input and the
 * drawing.
 *
 * When a press becomes a drag is `press-drag.ts`.
 *
 * While dragging, a copy of the page follows the pointer (lifted, with a
 * count when several selected pages move together), the pages being moved
 * fade where they were, an accent bar marks the gap the drop would land in,
 * and the panel scrolls when the pointer nears its top or bottom edge.
 * Letting go over the panel moves the pages (one undoable command, by the
 * host); letting go outside it, Escape, or a cancelled touch puts them back.
 */

import { type Box, type DropSlot, dropSlotAt, edgeScrollSpeed, realGap } from "./page-drag-model";
import { PressDrag } from "./press-drag";
import { isElement } from "./host-window";

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

/** A pressed thumbnail. */
interface Item {
  root: HTMLElement;
  index: number;
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
  private readonly input: PressDrag<Item>;
  private drag: Drag | null = null;

  constructor(
    /** The scrolling panel. */
    private readonly scroller: HTMLElement,
    /** The thumbnails' container. */
    private readonly grid: HTMLElement,
    private readonly host: PageDragHost,
  ) {
    this.input = new PressDrag<Item>(grid, {
      canDrag: () => host.canDrag(),
      itemAt: (target) => this.thumbAt(target),
      begin: (item, x, y) => this.begin(item, x, y),
      moveTo: (x, y) => this.moveTo(x, y),
      end: (drop) => this.end(drop),
      onPenTap: (item, target, event) => host.onPenTap(item.index, target, event),
    });
  }

  /** Whether a page is being dragged. */
  get active(): boolean {
    return this.input.active;
  }

  /**
   * True once for the `click` a mouse drag ends with, which must not open
   * the page it was let go over.
   */
  consumeClick(): boolean {
    return this.input.consumeClick();
  }

  /** Put the pages back and stop (Escape, the panel closing, the document changing). */
  cancel(): void {
    this.input.cancel();
  }

  destroy(): void {
    this.input.destroy();
  }

  /** The thumbnail whose page frame `target` is inside, and its page index. */
  private thumbAt(target: EventTarget | null): Item | null {
    if (!isElement(target) || !target.closest(FRAME)) return null;
    const root = target.closest<HTMLElement>(THUMB);
    if (!root || !this.grid.contains(root)) return null;
    return this.host.shown().find((item) => item.root === root) ?? null;
  }

  // --- Dragging ---------------------------------------------------------------

  private begin(press: Item, startX: number, startY: number): void {
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
      grabX: startX - rect.left,
      grabY: startY - rect.top,
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
    const press = this.input.point;
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
      const press = this.input.point;
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
  private end(drop: boolean): void {
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
