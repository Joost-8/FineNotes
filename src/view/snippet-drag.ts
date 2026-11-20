/**
 * A snippet being dragged off a PDF's tab (`model/snippet.ts`): a ghost of
 * the picture follows the pen or the finger, over the tab strip and onto
 * the notes, until the lift.
 *
 * The drag outlives what it started on: the tab it came from gives way to
 * the notes halfway through, and the element pressed (the selection's frame,
 * a lassoed area) goes with it. So the pointer is captured by the ghost,
 * which hangs on the document's body, and the drag listens on the document
 * in the capture phase, before anything under the pointer: nothing else
 * hears this pointer until it lifts. The tab strip's tabs never see the
 * pointer enter them; the host hit-tests their rects on each move instead.
 */

import { swallowGhostClick } from "./ghost-click";
import { docOf } from "./host-window";

/** The ghost's long side at most, CSS px; a large area is shown smaller. */
const GHOST_MAX_PX = 220;
/** And at least, so a thin area still shows something to carry. */
const GHOST_MIN_PX = 40;

/** How far a press on a grip moves before it is a drag, CSS px. */
export const GRIP_DRAG_SLOP_PX = 3;

/** What a grip over a lassoed area does with a press (`bindSnippetGrip`). */
export interface SnippetGripActions {
  /** True while a press may not start: a drag is under way, or the notebook is locked. */
  blocked: () => boolean;
  /** The press moved past the slop: carry the area off from this move. */
  drag: (event: PointerEvent) => void;
  /** It lifted without moving: a tap. */
  tap: () => void;
}

/**
 * Make `grip` (a lassoed area, or its Drag to Notes chip) take a press from
 * any pointer, the finger as much as the Pencil and the mouse: the page
 * below never hears it (so a finger does not pan the page, and the area is
 * not let go of), a move past {@link GRIP_DRAG_SLOP_PX} drags, a lift
 * without one taps.
 */
export function bindSnippetGrip(grip: HTMLElement, actions: SnippetGripActions): void {
  let press: { id: number; x: number; y: number } | null = null;
  grip.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    event.preventDefault();
    if (press || actions.blocked()) return;
    press = { id: event.pointerId, x: event.clientX, y: event.clientY };
    try {
      grip.setPointerCapture(event.pointerId);
    } catch {
      // A synthetic pointer (a test harness) cannot be captured; moves still arrive.
    }
  });
  grip.addEventListener("pointermove", (event) => {
    if (!press || event.pointerId !== press.id) return;
    event.stopPropagation();
    event.preventDefault();
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < GRIP_DRAG_SLOP_PX) return;
    press = null;
    actions.drag(event);
  });
  const lift = (event: PointerEvent): void => {
    if (!press || event.pointerId !== press.id) return;
    event.stopPropagation();
    press = null;
    actions.tap();
  };
  grip.addEventListener("pointerup", lift);
  grip.addEventListener("pointercancel", lift);
}

export interface SnippetDragHost {
  /**
   * The pointer moved to client point (x, y). True when it is over a tab
   * the drag can go to: the ghost then hangs below the pointer, so the tab
   * shows lit.
   */
  move: (clientX: number, clientY: number) => boolean;
  /** It lifted at client point (x, y); `cancelled` for a pointercancel. */
  end: (clientX: number, clientY: number, cancelled: boolean) => void;
}

export class SnippetDrag {
  private readonly ghost: HTMLElement;
  private readonly doc: Document;
  private url: string | null = null;
  private done = false;
  /** The ghost's size now, CSS px. */
  private width: number;
  private height: number;

  /**
   * Start dragging for pointer `pointerId`, now at client point (x, y),
   * an area `width` × `height` CSS px on screen. `picture` fills the ghost
   * when it is drawn; until then it is an outline.
   */
  constructor(
    anchor: HTMLElement,
    readonly pointerId: number,
    x: number,
    y: number,
    width: number,
    height: number,
    picture: Promise<Blob | null> | null,
    private readonly host: SnippetDragHost,
  ) {
    this.doc = docOf(anchor);
    const k = Math.min(1, GHOST_MAX_PX / Math.max(width, height, 1));
    const w = Math.max(GHOST_MIN_PX, width * k);
    const h = Math.max(GHOST_MIN_PX, height * k);
    this.ghost = this.doc.body.createDiv({ cls: "goodobsidian-snippet-ghost" });
    this.width = w;
    this.height = h;
    this.ghost.setCssStyles({ width: `${w.toFixed(0)}px`, height: `${h.toFixed(0)}px` });
    this.place(x, y);
    this.doc.addEventListener("pointermove", this.onMove, true);
    this.doc.addEventListener("pointerup", this.onUp, true);
    this.doc.addEventListener("pointercancel", this.onUp, true);
    try {
      this.ghost.setPointerCapture(pointerId);
    } catch {
      // A synthetic pointer (a test harness) cannot be captured; the document still hears it.
    }
    void picture?.then((png) => this.show(png));
  }

  /** Whether the drag is over (lifted, or ended by its host). */
  get ended(): boolean {
    return this.done;
  }

  /**
   * Over the notes: the ghost takes the size the picture will land at
   * (CSS px), exactly, so what is carried is what lands. A small change is
   * left alone; the change itself eases (styles.css).
   */
  landingSize(width: number, height: number): void {
    if (this.done || !(width > 0) || !(height > 0)) return;
    if (Math.abs(width - this.width) < 0.5 && Math.abs(height - this.height) < 0.5) return;
    this.width = width;
    this.height = height;
    this.ghost.addClass("is-landing");
    this.ghost.setCssStyles({ width: `${width.toFixed(1)}px`, height: `${height.toFixed(1)}px` });
  }

  /** End the drag without a drop: the host is going away. */
  cancel(): void {
    if (this.done) return;
    this.finish();
  }

  private show(png: Blob | null): void {
    if (this.done || !png || typeof URL.createObjectURL !== "function") return;
    this.url = URL.createObjectURL(png);
    this.ghost.createEl("img", { attr: { src: this.url, alt: "" } });
    this.ghost.addClass("has-picture");
  }

  private place(x: number, y: number): void {
    // The ghost is centred on x (CSS translate -50%); keep it on screen, so
    // it stays whole over the Notes tab at the left edge.
    const half = this.width / 2;
    const room = this.doc.documentElement.clientWidth;
    const cx =
      half > 0 && room > 2 * half + 8 ? Math.min(Math.max(x, half + 4), room - half - 4) : x;
    this.ghost.setCssStyles({ left: `${cx}px`, top: `${y}px` });
  }

  private readonly onMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    event.stopPropagation();
    if (event.cancelable) event.preventDefault();
    this.place(event.clientX, event.clientY);
    this.ghost.toggleClass("is-hanging", this.host.move(event.clientX, event.clientY));
  };

  private readonly onUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointerId) return;
    event.stopPropagation();
    if (event.cancelable) event.preventDefault();
    this.finish();
    // Android follows the lift with a click at whatever is under it: not a tap.
    if (event.type === "pointerup") swallowGhostClick(this.doc, event);
    this.host.end(event.clientX, event.clientY, event.type === "pointercancel");
  };

  private finish(): void {
    this.done = true;
    this.doc.removeEventListener("pointermove", this.onMove, true);
    this.doc.removeEventListener("pointerup", this.onUp, true);
    this.doc.removeEventListener("pointercancel", this.onUp, true);
    try {
      if (this.ghost.hasPointerCapture(this.pointerId))
        this.ghost.releasePointerCapture(this.pointerId);
    } catch {
      // Not captured (a synthetic pointer).
    }
    this.ghost.remove();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
  }
}
