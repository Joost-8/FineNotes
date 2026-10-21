/**
 * The graph window: the calculator's graph pane, popped out to float over
 * the notebook, as GeoGebra's graphics view does. Drag it by its title bar,
 * resize it from its corner, minimise it to a pill, close it. It stays open
 * while you write, so the graph and your notes sit side by side.
 *
 * It is the same `GraphPanel` as the pop-up's (`calculator-graph.ts`) on
 * the same notebook graph, so an edit in either shows in both. The frame
 * (drag, resize, minimise, close, kept inside the view) is the shared
 * `FloatingWindow`, which the calculator's window uses too. Costs:
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

import type { AngleMode } from "../model/calculator";
import type { WindowPlace } from "../model/calculator-store";
import type { GraphSpec } from "../model/graph";
import { GraphPanel, type GraphState } from "./calculator-graph";
import { FloatingWindow } from "./floating-window";

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
  private readonly frame: FloatingWindow;
  private readonly panel: GraphPanel;
  private readonly dispose: Array<() => void> = [];
  private closedYet = false;

  constructor(private readonly host: GraphWindowHost) {
    this.frame = new FloatingWindow({
      container: host.container,
      cls: "goodobsidian-graph-window",
      title: "Graph",
      label: "Graph window",
      buttons: host.insertGraph
        ? [
            {
              icon: "copy-plus",
              label: "Insert graph: put a copy on the page",
              run: () => {
                const spec = this.panel.spec();
                if ((spec.lines ?? []).length > 0) host.insertGraph?.(spec);
              },
            },
          ]
        : [],
      minimise: true,
      closeLabel: "Close the graph window",
      place: () => host.place(),
      savePlace: (place) => host.savePlace(place),
      onClose: () => this.close(),
      onRestore: () => this.panel.refresh(),
    });
    this.panel = new GraphPanel(this.frame.body, host.state, {
      angle: () => host.angle(),
      editLine: (id) => host.editLine(id),
      changed: () => undefined,
      drawMath: (parent, text) => host.drawMath(parent, text),
    });
    this.installPenPause();
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
    this.frame.destroy();
    this.host.closed();
  }

  /** Show it again where it was (opened from the calculator while already open). */
  raise(): void {
    this.frame.raise();
  }

  /**
   * The pen on the page outside the window pauses the graph: no sampling
   * or painting while a stroke is drawn, and one catch-up paint after.
   */
  private installPenPause(): void {
    const doc = this.host.container.ownerDocument;
    const down = (event: PointerEvent): void => {
      if (event.pointerType !== "pen" || this.frame.el.contains(event.target as Node)) return;
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
}
