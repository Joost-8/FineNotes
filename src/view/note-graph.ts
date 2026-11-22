/**
 * A graph in a text note: the calculator's graph on a line of its own, the
 * column's width, drawn by the notebook's own painter (`canvas/graph-paint`)
 * so it shows exactly what a graph on a notebook page shows. It is an
 * island like a picture: a tap selects it, and its bar edits or removes it.
 *
 * It paints only when its graph, its width or the theme changes.
 */

import type { GraphElement } from "../model/document";
import { graphFrameHeight, makeGraph } from "../model/graph-element";
import type { GraphBlock } from "../model/text-note";
import { paintGraph } from "../canvas/graph-paint";
import { watchSize } from "./host-window";

/** What a graph section needs from the editor. */
export interface NoteGraphHost {
  dark(): boolean;
}

/** A graph is never taller than this share of its width, nor shorter than half of it. */
const MAX_SHAPE = 0.75;
/** Nor taller than this, CSS px: on a wide pane it stays a figure in the text, not a page. */
const MAX_HEIGHT = 480;

/** The height a graph `width` CSS px wide is shown at: the shape of its view, within bounds. */
export function noteGraphHeight(block: GraphBlock, width: number): number {
  const fallback = Math.round(width * 0.6);
  const shaped = graphFrameHeight(block.spec, width, fallback);
  return Math.min(MAX_HEIGHT, Math.round(width * MAX_SHAPE), shaped);
}

export class NoteGraph {
  readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private block: GraphBlock;
  private graph: GraphElement | null = null;
  private readonly stopWatch: () => void;
  private width = 0;

  constructor(
    block: GraphBlock,
    private readonly host: NoteGraphHost,
  ) {
    this.block = block;
    this.el = createDiv({
      cls: "finenotes-note-graph",
      attr: { contenteditable: "false", "data-fn-id": block.id, "data-fn-island": "graph" },
    });
    this.canvas = this.el.createEl("canvas", { cls: "finenotes-note-graph-canvas" });
    this.el.setAttribute("aria-label", block.spec.expressions.join(", "));
    this.stopWatch = watchSize(this.el, () => this.layout());
  }

  setBlock(block: GraphBlock): void {
    if (block === this.block) return;
    this.block = block;
    this.graph = null;
    this.el.setAttribute("aria-label", block.spec.expressions.join(", "));
    this.layout(true);
  }

  /** The theme changed. */
  redraw(): void {
    this.layout(true);
  }

  destroy(): void {
    this.stopWatch();
    // iOS holds a canvas's memory until its size is given back.
    this.canvas.width = 0;
    this.canvas.height = 0;
    this.el.remove();
  }

  private layout(force = false): void {
    const width = Math.round(this.el.clientWidth);
    if (width <= 0 || (!force && width === this.width && this.graph)) return;
    this.width = width;
    const height = noteGraphHeight(this.block, width);
    this.el.setCssProps({ "--fn-graph-h": `${height}px` });
    if (!this.graph || this.graph.w !== width || this.graph.h !== height) {
      this.graph = makeGraph({
        id: this.block.id,
        x: 0,
        y: 0,
        w: width,
        h: height,
        spec: this.block.spec,
      });
    }
    this.paint();
  }

  private paint(): void {
    const graph = this.graph;
    if (!graph) return;
    const win = this.el.win;
    const ratio = win.devicePixelRatio || 1;
    this.canvas.width = Math.round(graph.w * ratio);
    this.canvas.height = Math.round(graph.h * ratio);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, graph.w, graph.h);
    // The card's fill is the note's own background: canvas takes no CSS variables.
    const paper =
      win.getComputedStyle(this.el).getPropertyValue("--background-primary").trim() ||
      (this.host.dark() ? "#1e1e1e" : "#ffffff");
    paintGraph(ctx, graph, { level: ratio, night: this.host.dark(), paper });
  }
}
