/**
 * Dragging a row of a short vertical list to a new place: the saved pens'
 * list (FineNotes#211). When a press becomes a drag is `press-drag.ts`, as
 * for the page sidebar's thumbnails (mouse and Pencil at once, a finger after
 * a hold, so a finger swipe still scrolls the list); where the row lands and
 * how the others step aside is `row-drag-model.ts`.
 *
 * While dragging, the row follows the pointer up and down, lifted, and the
 * rows it passes slide out of its way, so the list shows the order it will
 * have. Letting go moves it there (the host keeps it); a cancelled touch, a
 * second finger or letting go where it started changes nothing.
 */

import { PressDrag } from "./press-drag";
import { rowShift, rowSlotAt } from "./row-drag-model";
import { isElement } from "./host-window";

export interface RowDragHost {
  /** Whether rows can be dragged now. */
  canDrag(): boolean;
  /** Row `from` was let go at place `to` (`from !== to`). */
  onMove(from: number, to: number): void;
  /** A Pencil tap on row `index`, which no `click` follows. */
  onPenTap(index: number): void;
}

interface Drag {
  from: number;
  to: number;
  rows: HTMLElement[];
  centres: number[];
  pitch: number;
  /** Where in the row the pointer holds it, from the row's centre. */
  grabY: number;
}

export class RowDrag {
  private readonly input: PressDrag<number>;
  private drag: Drag | null = null;

  constructor(
    /** The rows' container: its children with `selector` are the rows, in order. */
    private readonly list: HTMLElement,
    private readonly selector: string,
    private readonly host: RowDragHost,
  ) {
    this.input = new PressDrag<number>(list, {
      canDrag: () => host.canDrag(),
      itemAt: (target) => this.rowAt(target),
      begin: (index, _x, y) => this.begin(index, y),
      moveTo: (_x, y) => this.moveTo(y),
      end: (drop) => this.end(drop),
      onPenTap: (index) => host.onPenTap(index),
    });
  }

  /** True once for the `click` a mouse drag ends with, which must not pick the row. */
  consumeClick(): boolean {
    return this.input.consumeClick();
  }

  destroy(): void {
    this.input.destroy();
  }

  private rows(): HTMLElement[] {
    return Array.from(this.list.querySelectorAll<HTMLElement>(`:scope > ${this.selector}`));
  }

  private rowAt(target: EventTarget | null): number | null {
    if (!isElement(target)) return null;
    const row = target.closest<HTMLElement>(this.selector);
    if (!row || row.parentElement !== this.list) return null;
    const index = this.rows().indexOf(row);
    return index >= 0 ? index : null;
  }

  private begin(from: number, y: number): void {
    const rows = this.rows();
    const boxes = rows.map((row) => row.getBoundingClientRect());
    const centres = boxes.map((box) => box.top + box.height / 2);
    // One row's pitch: its height plus the gap to the next.
    const pitch = boxes.length > 1 ? Math.abs(centres[1] - centres[0]) : (boxes[0]?.height ?? 0);
    this.drag = { from, to: from, rows, centres, pitch, grabY: y - centres[from] };
    this.list.addClass("is-dragging-row");
    rows[from]?.addClass("is-drag-row");
    this.list.win.navigator.vibrate?.(30);
  }

  private moveTo(y: number): void {
    const drag = this.drag;
    if (!drag) return;
    const centre = y - drag.grabY;
    const first = drag.centres[0] ?? centre;
    const last = drag.centres[drag.centres.length - 1] ?? centre;
    const held = Math.min(last, Math.max(first, centre));
    drag.to = rowSlotAt(drag.centres, drag.from, held);
    drag.rows.forEach((row, i) => {
      const shift =
        i === drag.from ? held - drag.centres[i] : rowShift(i, drag.from, drag.to, drag.pitch);
      row.setCssStyles({ transform: shift ? `translateY(${Math.round(shift)}px)` : "" });
    });
  }

  private end(drop: boolean): void {
    const drag = this.drag;
    this.drag = null;
    if (!drag) return;
    this.list.removeClass("is-dragging-row");
    for (const row of drag.rows) {
      row.removeClass("is-drag-row");
      row.setCssStyles({ transform: "" });
    }
    if (drop && drag.to !== drag.from) this.host.onMove(drag.from, drag.to);
  }
}
