/**
 * Explore: a live canvas laid over one graph on the page, where the curve
 * can be dragged, pinched and traced. While it is open the graph is left out
 * of the page's tiles (the surface hides it) and only this canvas redraws;
 * the page itself costs nothing more per frame. Done hands back the view it
 * ended at, which the surface commits as one undo step, and the graph goes
 * back to the static tile drawing.
 *
 * One finger or a mouse drags the plot, two fingers pinch it (each axis by
 * its own spread, so a plot can be stretched one way), the wheel zooms about
 * the pointer, and the Pencil traces: a marker follows it with each curve's
 * value at that x.
 */

import type { GraphElement } from "../model/document";
import { type GraphView, panView, sameView, valueAt, zoomView } from "../model/graph-element";
import { paintGraph, sampleExpressionAt } from "../canvas/graph-paint";
import { frameX, frameY } from "../canvas/graph-geometry";
import { shownColor } from "../canvas/backdrop";
import { onTap } from "./selection-bar";
import { setIcon } from "obsidian";

export interface GraphExploreOptions {
  /** The card's fill and whether the page is a night page, as the tiles paint it. */
  paper: string;
  night: boolean;
  /** Called once, with the view to commit (null: unchanged or cancelled). */
  onClose: (view: GraphView | null) => void;
}

/** The fewest page px a spread of two fingers must have before it scales that axis. */
const MIN_SPREAD = 24;
/** A pinch is drawn at this share of full resolution while it moves. */
const MOVING_RESOLUTION = 0.5;

export class GraphExplorer {
  readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly readout: HTMLElement;
  /** A working copy: its ranges move; the page's graph is untouched until Done. */
  private readonly draft: GraphElement;
  private readonly start: GraphView;
  private scale = 1;
  private dpr = 1;
  private readonly pointers = new Map<number, { x: number; y: number; type: string }>();
  private gesture: {
    view: GraphView;
    points: Map<number, { x: number; y: number }>;
  } | null = null;
  private trace: number | null = null;
  private frame = 0;
  private moving = false;
  private closed = false;

  /** Draws since opening, for the harness. */
  draws = 0;

  constructor(
    host: HTMLElement,
    readonly graph: GraphElement,
    private readonly options: GraphExploreOptions,
  ) {
    this.draft = structuredClone(graph);
    this.start = { xRange: [...graph.xRange], yRange: [...graph.yRange] };
    this.root = host.createDiv({ cls: "goodobsidian-graph-explore" });
    // Obsidian's swipes stay out of the plot, as they do of the page.
    this.root.dataset.ignoreSwipe = "true";
    this.canvas = this.root.createEl("canvas", { cls: "goodobsidian-graph-explore-canvas" });
    this.ctx = this.canvas.getContext("2d");
    const bar = this.root.createDiv({ cls: "goodobsidian-graph-explore-bar" });
    this.readout = bar.createSpan({ cls: "goodobsidian-graph-explore-readout" });
    const reset = bar.createEl("button", {
      cls: "clickable-icon goodobsidian-graph-explore-button",
      attr: { "aria-label": "Reset view" },
    });
    setIcon(reset, "rotate-ccw");
    onTap(reset, () => this.reset());
    const done = bar.createEl("button", {
      cls: "clickable-icon goodobsidian-graph-explore-button mod-done",
      text: "Done",
    });
    onTap(done, () => this.close(true));
    for (const el of [bar]) {
      el.addEventListener("pointerdown", (event) => event.stopPropagation());
    }
    this.canvas.addEventListener("pointerdown", this.onDown);
    this.canvas.addEventListener("pointermove", this.onMove);
    this.canvas.addEventListener("pointerup", this.onUp);
    this.canvas.addEventListener("pointercancel", this.onUp);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    // WebKit's long press and Scribble must not claim a held Pencil or finger.
    this.canvas.addEventListener("touchstart", stopTouch, { passive: false });
    this.canvas.addEventListener("touchmove", stopTouch, { passive: false });
    this.showReadout();
  }

  /** The view now, as Done would commit it. */
  get view(): GraphView {
    return { xRange: [...this.draft.xRange], yRange: [...this.draft.yRange] };
  }

  /**
   * Put the canvas over the graph: its top-left and its CSS px per page px,
   * in the coordinates of the element it lives in. Redraws when the scale
   * changes (a page zoom), at the new resolution.
   */
  place(left: number, top: number, scale: number, dpr: number): void {
    const w = this.draft.w * scale;
    const h = this.draft.h * scale;
    this.root.setCssStyles({
      left: `${left}px`,
      top: `${top}px`,
      width: `${w}px`,
      height: `${h}px`,
    });
    if (scale === this.scale && dpr === this.dpr && this.canvas.width > 0) return;
    this.scale = scale;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.canvas.setCssStyles({ width: `${w}px`, height: `${h}px` });
    this.draw();
  }

  /** Close without committing: a tool change, an undo, the page going away. */
  cancel(): void {
    this.close(false);
  }

  /** Close, committing the view if `commit` and it moved. */
  close(commit: boolean): void {
    if (this.closed) return;
    this.closed = true;
    if (this.frame) window.cancelAnimationFrame(this.frame);
    this.root.remove();
    const view = this.view;
    this.options.onClose(commit && !sameView(view, this.start) ? view : null);
  }

  private reset(): void {
    this.draft.xRange = [...this.start.xRange];
    this.draft.yRange = [...this.start.yRange];
    this.gesture = null;
    this.draw();
    this.showReadout();
  }

  /** Page px of the frame under a client point. */
  private framePoint(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const k = rect.width > 0 ? this.draft.w / rect.width : 1 / this.scale;
    return { x: (clientX - rect.left) * k, y: (clientY - rect.top) * k };
  }

  private readonly onDown = (event: PointerEvent): void => {
    event.stopPropagation();
    event.preventDefault();
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      // A synthetic pointer (a harness) cannot be captured.
    }
    const p = this.framePoint(event.clientX, event.clientY);
    this.pointers.set(event.pointerId, { ...p, type: event.pointerType });
    if (event.pointerType === "pen") {
      this.trace = p.x;
      this.draw();
      return;
    }
    this.beginGesture();
  };

  private readonly onMove = (event: PointerEvent): void => {
    const known = this.pointers.get(event.pointerId);
    if (!known) return;
    event.stopPropagation();
    const p = this.framePoint(event.clientX, event.clientY);
    known.x = p.x;
    known.y = p.y;
    if (known.type === "pen") {
      this.trace = p.x;
      this.requestDraw();
      return;
    }
    this.applyGesture();
  };

  private readonly onUp = (event: PointerEvent): void => {
    const known = this.pointers.get(event.pointerId);
    if (!known) return;
    event.stopPropagation();
    this.pointers.delete(event.pointerId);
    if (known.type === "pen") {
      this.trace = null;
      this.showReadout();
      this.draw();
      return;
    }
    // The fingers left continue from where the view is now.
    this.beginGesture();
    if (!this.gesture) {
      this.moving = false;
      this.draw();
    }
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    const p = this.framePoint(event.clientX, event.clientY);
    const k = Math.exp(-event.deltaY * 0.002);
    const next = zoomView(this.view, k, k, p.x, p.y, this.draft.w, this.draft.h);
    this.setView(next);
    this.showReadout();
  };

  /** Start (or restart) a drag or pinch from the fingers down now. */
  private beginGesture(): void {
    const points = new Map<number, { x: number; y: number }>();
    for (const [id, p] of this.pointers) if (p.type !== "pen") points.set(id, { x: p.x, y: p.y });
    this.gesture = points.size > 0 ? { view: this.view, points } : null;
  }

  private applyGesture(): void {
    const g = this.gesture;
    if (!g) return;
    const now = [...g.points.keys()]
      .map((id) => ({ from: g.points.get(id)!, to: this.pointers.get(id) }))
      .filter(
        (
          pair,
        ): pair is { from: { x: number; y: number }; to: { x: number; y: number; type: string } } =>
          pair.to !== undefined,
      );
    if (now.length === 0) return;
    const { w, h } = this.draft;
    let view = g.view;
    if (now.length >= 2) {
      const [a, b] = now;
      const fromMid = { x: (a.from.x + b.from.x) / 2, y: (a.from.y + b.from.y) / 2 };
      const toMid = { x: (a.to.x + b.to.x) / 2, y: (a.to.y + b.to.y) / 2 };
      const kx = spreadRatio(a.from.x, b.from.x, a.to.x, b.to.x);
      const ky = spreadRatio(a.from.y, b.from.y, a.to.y, b.to.y);
      // Zoom about where the fingers started, then carry that point to where they are.
      view = zoomView(view, kx, ky, fromMid.x, fromMid.y, w, h);
      view = panView(view, toMid.x - fromMid.x, toMid.y - fromMid.y, w, h);
    } else {
      const { from, to } = now[0];
      view = panView(view, to.x - from.x, to.y - from.y, w, h);
    }
    this.moving = true;
    this.setView(view);
  }

  private setView(view: GraphView): void {
    this.draft.xRange = view.xRange;
    this.draft.yRange = view.yRange;
    this.requestDraw();
  }

  private requestDraw(): void {
    if (this.frame) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  /** Paint the plot (and the trace) into the canvas, at full resolution once at rest. */
  draw(): void {
    const ctx = this.ctx;
    if (!ctx || this.closed) return;
    this.draws++;
    const k = this.scale * this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(k, 0, 0, k, -this.draft.x * k, -this.draft.y * k);
    const level = this.moving ? k * MOVING_RESOLUTION : k;
    paintGraph(ctx, this.draft, { level, night: this.options.night, paper: this.options.paper });
    if (this.trace !== null) this.drawTrace(ctx, k);
  }

  private drawTrace(ctx: CanvasRenderingContext2D, k: number): void {
    const g = this.draft;
    const fx = Math.min(g.w, Math.max(0, this.trace ?? 0));
    const x = valueAt(this.view, fx, 0, g.w, g.h).x;
    const map = { xRange: g.xRange, yRange: g.yRange, w: g.w, h: g.h };
    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.strokeStyle = shownColor("#5b6270", this.options.night);
    ctx.lineWidth = 1 / k;
    ctx.setLineDash([4 / k, 4 / k]);
    ctx.beginPath();
    ctx.moveTo(fx, 0);
    ctx.lineTo(fx, g.h);
    ctx.stroke();
    ctx.setLineDash([]);
    const parts: string[] = [`x = ${formatNumber(x)}`];
    for (const expression of g.expressions) {
      const y = sampleExpressionAt(expression.text, x);
      if (!Number.isFinite(y)) continue;
      parts.push(`y = ${formatNumber(y)}`);
      const fy = frameY(map, y);
      if (fy < 0 || fy > g.h) continue;
      ctx.fillStyle = shownColor(expression.color, this.options.night);
      ctx.beginPath();
      ctx.arc(frameX(map, x), fy, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    this.readout.setText(parts.join("   "));
  }

  private showReadout(): void {
    const [x0, x1] = this.draft.xRange;
    const [y0, y1] = this.draft.yRange;
    this.readout.setText(
      `x ${formatNumber(x0)} … ${formatNumber(x1)}   y ${formatNumber(y0)} … ${formatNumber(y1)}`,
    );
  }
}

/** How much two fingers' spread along one axis grew; 1 when they are too close on it to say. */
function spreadRatio(a0: number, b0: number, a1: number, b1: number): number {
  const before = Math.abs(a0 - b0);
  const after = Math.abs(a1 - b1);
  if (before < MIN_SPREAD || after < MIN_SPREAD) return 1;
  return after / before;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "?";
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 1e6 || abs < 1e-4)) return value.toExponential(3);
  return String(Number(value.toPrecision(5)));
}

function stopTouch(event: TouchEvent): void {
  event.preventDefault();
}
