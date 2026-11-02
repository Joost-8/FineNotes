/**
 * The chrome of a PDF text selection (`canvas/text-pick.ts`): a tint over
 * each selected line and a handle at either end, drawn as iPadOS draws
 * them, a thin bar the height of the line with a knob above the start and
 * below the end. The Copy bar is the surface's own action bar.
 *
 * The canvas has no DOM text, so this is drawn over the page in the
 * selection layer's px (`(box + page point) × scale`), and the handles act
 * on pointer events alone: the surface cancels a Pencil's touchstart over
 * the page, which also keeps the browser from synthesising clicks (see
 * `selection-bar.ts`).
 */

import type { PickEnd, TextPick } from "../canvas/text-pick";
import { pickHandles } from "../canvas/text-pick";

export interface TextPickCallbacks {
  /** A handle was taken at client px (`x`, `y`). */
  grab(end: PickEnd, x: number, y: number): void;
  /** The pointer holding it moved to client px (`x`, `y`). */
  drag(x: number, y: number): void;
  /** It let go (or the system took it). */
  release(): void;
}

export class TextPickView {
  private readonly tintEl: HTMLElement;
  private readonly handles: Record<PickEnd, HTMLElement>;
  private held: { pointerId: number; el: HTMLElement } | null = null;

  constructor(
    parent: HTMLElement,
    private readonly callbacks: TextPickCallbacks,
  ) {
    this.tintEl = parent.createDiv({ cls: "goodobsidian-text-pick is-hidden" });
    this.handles = {
      start: this.handle(parent, "start", "Start of selection"),
      end: this.handle(parent, "end", "End of selection"),
    };
  }

  /**
   * Draw `pick` on the page whose corner is (`ox`, `oy`) in layout px, at
   * `scale` layer px per layout px.
   */
  show(pick: TextPick, ox: number, oy: number, scale: number): void {
    const rects = pick.rects;
    while (this.tintEl.childElementCount < rects.length) {
      this.tintEl.createDiv({ cls: "goodobsidian-text-pick-line" });
    }
    while (this.tintEl.childElementCount > rects.length) this.tintEl.lastElementChild?.remove();
    rects.forEach((r, i) => {
      (this.tintEl.children[i] as HTMLElement).setCssStyles({
        left: `${(ox + r.x) * scale}px`,
        top: `${(oy + r.y) * scale}px`,
        width: `${r.w * scale}px`,
        height: `${r.h * scale}px`,
      });
    });
    this.tintEl.removeClass("is-hidden");
    const at = pickHandles(pick);
    for (const end of ["start", "end"] as const) {
      const el = this.handles[end];
      const h = at?.[end];
      el.toggleClass("is-hidden", !h);
      if (!h) continue;
      el.setCssStyles({
        left: `${(ox + h.x) * scale}px`,
        top: `${(oy + h.top) * scale}px`,
        height: `${(h.bottom - h.top) * scale}px`,
      });
    }
  }

  hide(): void {
    this.tintEl.addClass("is-hidden");
    this.handles.start.addClass("is-hidden");
    this.handles.end.addClass("is-hidden");
    this.letGo();
  }

  /** Whether a handle is being dragged. */
  get dragging(): boolean {
    return this.held !== null;
  }

  destroy(): void {
    this.letGo();
    this.tintEl.remove();
    this.handles.start.remove();
    this.handles.end.remove();
  }

  private handle(parent: HTMLElement, end: PickEnd, label: string): HTMLElement {
    const el = parent.createDiv({
      cls: `goodobsidian-text-pick-handle is-${end} is-hidden`,
      attr: { "aria-label": label, role: "slider" },
    });
    el.createDiv({ cls: "goodobsidian-text-pick-knob" });
    el.addEventListener("pointerdown", (event) => {
      // The page never sees the press: it would close the selection.
      event.stopPropagation();
      event.preventDefault();
      if (this.held || event.button > 0) return;
      this.held = { pointerId: event.pointerId, el };
      el.setPointerCapture?.(event.pointerId);
      el.addClass("is-dragging");
      this.callbacks.grab(end, event.clientX, event.clientY);
    });
    el.addEventListener("pointermove", (event) => {
      if (this.held?.pointerId !== event.pointerId) return;
      event.stopPropagation();
      event.preventDefault();
      this.callbacks.drag(event.clientX, event.clientY);
    });
    const up = (event: PointerEvent): void => {
      if (this.held?.pointerId !== event.pointerId) return;
      event.stopPropagation();
      this.letGo();
      this.callbacks.release();
    };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return el;
  }

  private letGo(): void {
    const held = this.held;
    if (!held) return;
    this.held = null;
    held.el.removeClass("is-dragging");
    if (held.el.hasPointerCapture?.(held.pointerId)) held.el.releasePointerCapture(held.pointerId);
  }
}
