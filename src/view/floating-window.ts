/**
 * A window floating over the notebook: a title bar to drag it by, buttons
 * on the bar (always a close cross), a corner to resize it from, and an
 * optional minimise to a pill. The graph window (`graph-window.ts`) and the
 * calculator (`calculator-popover.ts`) are both one, so they move, size and
 * stay inside the view the same way.
 *
 * - Its place (position, size, minimised) is the host's to keep; the frame
 *   reads it once, keeps it inside the view through a split view or a
 *   rotation, and hands it back after every move and resize.
 * - Pointer and touch events inside stay inside: they never reach the page
 *   behind or Obsidian's swipes (`data-ignore-swipe`, CLAUDE.md).
 * - Bar buttons act on `pointerup` (a Pencil tap over the page may never
 *   become a click: CLAUDE.md); `click` only for keyboard activation.
 *
 * `cls` names the window's own class; its parts are `${cls}-bar`,
 * `${cls}-title`, `${cls}-button`, `${cls}-body` and `${cls}-grip`, so each
 * window keeps its own styles.
 */

import { setIcon } from "obsidian";
import {
  WINDOW_MIN,
  WINDOW_PILL,
  type WindowPlace,
  clampPlace,
  defaultPlace,
} from "../model/calculator-store";

/** Every floating window's class, for bringing one over the others. */
const FLOATING_WINDOWS =
  ".goodobsidian-graph-window, .goodobsidian-calc-window, .goodobsidian-zoombox-window";

export interface FloatingWindowButton {
  icon: string;
  label: string;
  run: () => void;
}

export interface FloatingWindowOptions {
  /** The notebook view's content area: the window lives in it and stays inside it. */
  container: HTMLElement;
  /** The window's class, and the stem of its parts' classes. */
  cls: string;
  title: string;
  /** The window's accessible name. */
  label: string;
  /** Bar buttons before Minimise and Close, left to right. */
  buttons?: FloatingWindowButton[];
  /** Offer Minimise (to a pill a tap opens again). */
  minimise?: boolean;
  /** The close cross's label. */
  closeLabel?: string;
  /** The smallest it may be sized to. */
  min?: { w: number; h: number };
  /** Where it opens the first time, for a view of `bounds`. */
  firstPlace?: (bounds: { w: number; h: number }) => WindowPlace;
  place(): WindowPlace | null;
  savePlace(place: WindowPlace): void;
  /** The cross was pressed (the owner closes the window). */
  onClose(): void;
  /** It was opened again from its pill. */
  onRestore?(): void;
}

export class FloatingWindow {
  readonly el: HTMLElement;
  readonly body: HTMLElement;
  private place: WindowPlace;
  private readonly min: { w: number; h: number };
  private readonly dispose: Array<() => void> = [];
  private closed = false;

  constructor(private readonly options: FloatingWindowOptions) {
    const { cls } = options;
    this.min = options.min ?? WINDOW_MIN;
    this.el = options.container.createDiv({ cls });
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-label", options.label);
    this.el.dataset.ignoreSwipe = "true";

    const bar = this.el.createDiv({ cls: `${cls}-bar` });
    const title = bar.createSpan({ cls: `${cls}-title`, text: options.title });
    title.setAttribute("aria-hidden", "true");
    for (const button of options.buttons ?? []) {
      this.barButton(bar, button.icon, button.label, button.run);
    }
    if (options.minimise) {
      this.barButton(bar, "minus", "Minimise", () => this.setMinimised(!this.place.minimised));
    }
    this.barButton(bar, "x", options.closeLabel ?? "Close", () => options.onClose()).addClass(
      "is-close",
    );

    this.body = this.el.createDiv({ cls: `${cls}-body` });
    const grip = this.el.createDiv({ cls: `${cls}-grip` });
    grip.setAttribute("aria-label", "Resize");
    setIcon(grip, "move-diagonal-2");

    const bounds = this.bounds();
    const first = options.firstPlace?.(bounds) ?? defaultPlace(bounds);
    this.place = clampPlace(options.place() ?? first, bounds, this.min);
    this.apply();
    this.installDrag(bar, "move");
    this.installDrag(grip, "resize");
    this.installIsolation();
    this.installRefit();
    this.bringToFront();
    // Capture: before anything inside stops the event.
    this.el.addEventListener("pointerdown", () => this.bringToFront(), true);
  }

  /** Over the other floating windows of the view (the last one touched is on top). */
  bringToFront(): void {
    const { container } = this.options;
    for (const other of Array.from(container.querySelectorAll(FLOATING_WINDOWS))) {
      if (other !== this.el) other.removeClass("is-front");
    }
    this.el.addClass("is-front");
  }

  get isMinimised(): boolean {
    return this.place.minimised === true;
  }

  /** Take the window away (its owner calls this; it does not call `onClose`). */
  destroy(): void {
    if (this.closed) return;
    this.closed = true;
    for (const d of this.dispose) d();
    this.el.remove();
  }

  /** Show it again where it was: out of its pill, with a small bump. */
  raise(): void {
    if (this.place.minimised) this.setMinimised(false);
    this.el.addClass("is-raised");
    window.setTimeout(() => this.el.removeClass("is-raised"), 140);
  }

  private bounds(): { w: number; h: number } {
    const { container } = this.options;
    return { w: container.clientWidth, h: container.clientHeight };
  }

  private apply(): void {
    const p = this.place;
    const min = p.minimised === true;
    this.el.toggleClass("is-minimised", min);
    this.el.setCssStyles({
      left: `${p.x}px`,
      top: `${p.y}px`,
      width: `${min ? WINDOW_PILL.w : p.w}px`,
      height: `${min ? WINDOW_PILL.h : p.h}px`,
    });
  }

  private setMinimised(on: boolean): void {
    this.place = clampPlace(
      { ...this.place, minimised: on ? true : undefined },
      this.bounds(),
      this.min,
    );
    if (!on) delete this.place.minimised;
    this.apply();
    this.options.savePlace(this.place);
    if (!on) this.options.onRestore?.();
  }

  private barButton(
    bar: HTMLElement,
    icon: string,
    label: string,
    run: () => void,
  ): HTMLButtonElement {
    const button = bar.createEl("button", {
      cls: `clickable-icon ${this.options.cls}-button`,
      attr: { "aria-label": label, title: label },
    });
    setIcon(button, icon);
    let down = false;
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      down = true;
    });
    button.addEventListener("pointerup", () => {
      if (down) run();
      down = false;
    });
    button.addEventListener("pointercancel", () => (down = false));
    button.addEventListener("click", (event) => {
      if (event.detail === 0) run();
    });
    return button;
  }

  /** Drag the title bar (or the pill) to move, the corner to resize. */
  private installDrag(handle: HTMLElement, mode: "move" | "resize"): void {
    let start: { x: number; y: number; place: WindowPlace; id: number } | null = null;
    let moved = false;
    const down = (event: PointerEvent): void => {
      if ((event.target as Element | null)?.closest("button")) return;
      event.preventDefault();
      try {
        handle.setPointerCapture(event.pointerId);
      } catch {
        // A synthetic pointer has nothing to capture.
      }
      start = { x: event.clientX, y: event.clientY, place: { ...this.place }, id: event.pointerId };
      moved = false;
    };
    const move = (event: PointerEvent): void => {
      if (!start || event.pointerId !== start.id) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (Math.hypot(dx, dy) > 4) moved = true;
      const from = start.place;
      const next =
        mode === "move"
          ? { ...from, x: from.x + dx, y: from.y + dy }
          : { ...from, w: from.w + dx, h: from.h + dy };
      this.place = clampPlace(next, this.bounds(), this.min);
      this.apply();
    };
    const up = (event: PointerEvent): void => {
      if (!start || event.pointerId !== start.id) return;
      start = null;
      // A tap on the pill (no drag) opens it again.
      if (!moved && mode === "move" && this.place.minimised) {
        this.setMinimised(false);
        return;
      }
      this.options.savePlace(this.place);
    };
    handle.addEventListener("pointerdown", down);
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  }

  /**
   * Nothing inside the window reaches the page or Obsidian behind it: its
   * pointer and touch events stop here (listeners on the elements inside,
   * and capturing ones on the document, have run by then).
   */
  private installIsolation(): void {
    const stop = (event: Event): void => event.stopPropagation();
    for (const type of [
      "pointerdown",
      "pointermove",
      "pointerup",
      "wheel",
      "touchstart",
      "touchmove",
      "contextmenu",
    ]) {
      this.el.addEventListener(type, stop);
    }
  }

  /** A split view or a rotation reshapes the view: keep the window inside it. */
  private installRefit(): void {
    if (typeof ResizeObserver !== "function") return;
    let last = this.bounds();
    const observer = new ResizeObserver(() => {
      const now = this.bounds();
      if (now.w === last.w && now.h === last.h) return;
      last = now;
      this.place = clampPlace(this.place, now, this.min);
      this.apply();
    });
    observer.observe(this.options.container);
    this.dispose.push(() => observer.disconnect());
  }
}
