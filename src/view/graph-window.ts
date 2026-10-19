/**
 * The graph window: the calculator's graph pane, popped out to float over
 * the notebook, as GeoGebra's graphics view does. Drag it by its title bar,
 * resize it from its corner, minimise it to a pill, close it. It stays open
 * while you write, so the graph and your notes sit side by side.
 *
 * It is the same `GraphPanel` as the pop-up's (`calculator-graph.ts`) on
 * the same notebook graph, so an edit in either shows in both; this file
 * adds only the frame. Costs:
 *
 * - Nothing while idle: the panel paints only when its graph or view
 *   changes (no animation frame at rest); the window listens to its own
 *   elements and, for the pen, to the document's pointer downs and ups.
 * - Nothing while writing: a pen down on the page outside the window
 *   pauses the panel's sampling and painting until the pen lifts.
 * - Pointer events inside the window stay there (they never reach the
 *   page's surface, which sits beside it, not under it in the DOM); the
 *   page's own pen and palm handling outside it is untouched. Obsidian's
 *   swipes are told to ignore it (`data-ignore-swipe`, CLAUDE.md).
 *
 * Its place (position, size, minimised) is kept per notebook and kept
 * inside the view through a split view or a rotation.
 */

import { setIcon } from "obsidian";
import type { AngleMode } from "../model/calculator";
import { WINDOW_PILL, type WindowPlace, clampPlace, defaultPlace } from "../model/calculator-store";
import type { GraphSpec } from "../model/graph";
import { GraphPanel, type GraphState } from "./calculator-graph";

export interface GraphWindowHost {
  /** The notebook view's content area: the window lives in it and stays inside it. */
  container: HTMLElement;
  state: GraphState;
  angle(): AngleMode;
  /** Edit a graph line on the calculator's keys (null: a new line). */
  editLine(id: string | null): void;
  /** Put a copy of the graph on the page; absent hides the button. */
  insertGraph?(spec: GraphSpec): boolean;
  drawMath(parent: HTMLElement, text: string): void;
  place(): WindowPlace | null;
  savePlace(place: WindowPlace): void;
  closed(): void;
}

export class GraphWindow {
  private readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private readonly panel: GraphPanel;
  private place: WindowPlace;
  private readonly dispose: Array<() => void> = [];
  private closedYet = false;

  constructor(private readonly host: GraphWindowHost) {
    const container = host.container;
    this.el = container.createDiv({ cls: "goodobsidian-graph-window" });
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-label", "Graph window");
    this.el.dataset.ignoreSwipe = "true";

    const bar = this.el.createDiv({ cls: "goodobsidian-graph-window-bar" });
    const title = bar.createSpan({ cls: "goodobsidian-graph-window-title", text: "Graph" });
    title.setAttribute("aria-hidden", "true");
    if (host.insertGraph) {
      this.barButton(bar, "copy-plus", "Insert graph: put a copy on the page", () => {
        const spec = this.panel.spec();
        if ((spec.lines ?? []).length > 0) host.insertGraph?.(spec);
      });
    }
    this.barButton(bar, "minus", "Minimise", () => this.setMinimised(!this.place.minimised));
    this.barButton(bar, "x", "Close the graph window", () => this.close()).addClass("is-close");

    this.body = this.el.createDiv({ cls: "goodobsidian-graph-window-body" });
    this.panel = new GraphPanel(this.body, host.state, {
      angle: () => host.angle(),
      editLine: (id) => host.editLine(id),
      changed: () => undefined,
      drawMath: (parent, text) => host.drawMath(parent, text),
    });
    const grip = this.el.createDiv({ cls: "goodobsidian-graph-window-grip" });
    grip.setAttribute("aria-label", "Resize");
    setIcon(grip, "move-diagonal-2");

    this.place = clampPlace(host.place() ?? defaultPlace(this.bounds()), this.bounds());
    this.apply();
    this.installDrag(bar, "move");
    this.installDrag(grip, "resize");
    this.installIsolation();
    this.installPenPause();
    this.installRefit();
    this.panel.paintNow();
  }

  get isOpen(): boolean {
    return !this.closedYet;
  }

  /** The graph panel (the gallery measures its frames). */
  get graphPanel(): GraphPanel {
    return this.panel;
  }

  close(): void {
    if (this.closedYet) return;
    this.closedYet = true;
    this.panel.destroy();
    for (const d of this.dispose) d();
    this.el.remove();
    this.host.closed();
  }

  /** Show it again where it was (opened from the calculator while already open). */
  raise(): void {
    if (this.place.minimised) this.setMinimised(false);
    this.el.addClass("is-raised");
    window.setTimeout(() => this.el.removeClass("is-raised"), 140);
  }

  // --- Frame --------------------------------------------------------------------

  private bounds(): { w: number; h: number } {
    return { w: this.host.container.clientWidth, h: this.host.container.clientHeight };
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
    this.place = clampPlace({ ...this.place, minimised: on ? true : undefined }, this.bounds());
    if (!on) delete this.place.minimised;
    this.apply();
    this.host.savePlace(this.place);
    if (!on) this.panel.refresh();
  }

  private barButton(
    bar: HTMLElement,
    icon: string,
    label: string,
    run: () => void,
  ): HTMLButtonElement {
    const button = bar.createEl("button", {
      cls: "clickable-icon goodobsidian-graph-window-button",
      attr: { "aria-label": label, title: label },
    });
    setIcon(button, icon);
    // Pointer events (a Pencil tap over the page may never become a click: CLAUDE.md).
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
      this.place = clampPlace(next, this.bounds());
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
      this.host.savePlace(this.place);
    };
    handle.addEventListener("pointerdown", down);
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  }

  /**
   * Nothing inside the window reaches the page or Obsidian behind it: its
   * pointer and touch events stop here (the panel's own listeners, on the
   * elements inside, have run by then).
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

  /**
   * The pen on the page outside the window pauses the graph: no sampling
   * or painting while a stroke is drawn, and one catch-up paint after.
   */
  private installPenPause(): void {
    const doc = this.host.container.ownerDocument;
    const down = (event: PointerEvent): void => {
      if (event.pointerType !== "pen" || this.el.contains(event.target as Node)) return;
      this.panel.setPaused(true);
    };
    const up = (event: PointerEvent): void => {
      if (event.pointerType === "pen") this.panel.setPaused(false);
    };
    doc.addEventListener("pointerdown", down, true);
    doc.addEventListener("pointerup", up, true);
    doc.addEventListener("pointercancel", up, true);
    this.dispose.push(() => {
      doc.removeEventListener("pointerdown", down, true);
      doc.removeEventListener("pointerup", up, true);
      doc.removeEventListener("pointercancel", up, true);
    });
  }

  /** A split view or a rotation reshapes the view: keep the window inside it. */
  private installRefit(): void {
    if (typeof ResizeObserver !== "function") return;
    let last = this.bounds();
    const observer = new ResizeObserver(() => {
      const now = this.bounds();
      if (now.w === last.w && now.h === last.h) return;
      last = now;
      this.place = clampPlace(this.place, now);
      this.apply();
    });
    observer.observe(this.host.container);
    this.dispose.push(() => observer.disconnect());
  }
}
