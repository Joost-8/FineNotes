/**
 * Explore: a live canvas laid over one graph on the page, where the curve
 * can be dragged, pinched and traced, as in Desmos. While it is open the
 * graph is left out of the page's tiles (the surface hides it) and only this
 * canvas redraws; the page itself costs nothing more per frame. Done hands
 * back the view it ended at, which the surface commits as one undo step, and
 * the graph goes back to the static tile drawing.
 *
 * One finger or a mouse drags the plot and lets it coast on release, with
 * the page scroll's own deceleration (`scroll-physics`), so both feel alike;
 * two fingers pinch it (each axis by its own spread, so a plot can be
 * stretched one way); the wheel zooms about the pointer. A tap on a curve
 * traces it there (the calculator's marker and coordinates), a tap beside
 * the curves lets it go; the Pencil traces as it moves, along the curve
 * nearest it.
 *
 * Its bar is the selection bar's dark pill (the same classes), so it reads
 * as one of FineNotes' own bars.
 */

import type { GraphElement } from "../model/document";
import { type GraphView, panView, sameView, zoomView } from "../model/graph-element";
import { traceAt } from "../model/graph";
import { graphFunctions, paintGraph, rangeOf } from "../canvas/graph-paint";
import {
  DECELERATION_RATE,
  MAX_STEP_MS,
  MIN_FLING_SPEED,
  REST_SPEED,
  VelocityTracker,
} from "../canvas/scroll-physics";
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
/** The plot is drawn at this share of full resolution while it moves. */
const MOVING_RESOLUTION = 0.5;
/** A press that moves less than this (CSS px) and lifts within TAP_MS is a tap. */
const TAP_SLOP_PX = 8;
const TAP_MS = 350;
/** How far from a curve (CSS px) a tap still lands on it. */
const CURVE_HIT_PX = 22;

type Pointer = { x: number; y: number; type: string };

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
  private readonly pointers = new Map<number, Pointer>();
  private gesture: {
    view: GraphView;
    points: Map<number, { x: number; y: number }>;
  } | null = null;
  /** The traced point: its x value and which expression (a tap, or the Pencil). */
  private pinned: { x: number; index: number } | null = null;
  /** The press that may become a tap, in client px. */
  private tap: { id: number; x: number; y: number; t: number } | null = null;
  private readonly velocity = new VelocityTracker();
  /** A pan coasting after release: client px per ms. */
  private coast: { vx: number; vy: number; last: number } | null = null;
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
    const bar = this.root.createDiv({
      cls: "goodobsidian-selection-bar theme-dark goodobsidian-graph-explore-bar",
      attr: { role: "toolbar", "aria-label": "Explore graph" },
    });
    this.readout = bar.createSpan({ cls: "goodobsidian-graph-explore-readout" });
    bar.createDiv({ cls: "goodobsidian-selection-divider" });
    const reset = barButton(bar, "Reset view", "rotate-ccw");
    onTap(reset, () => this.reset());
    const done = barButton(bar, "Done", "check", true);
    onTap(done, () => this.close(true));
    bar.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      event.preventDefault();
    });
    this.canvas.addEventListener("pointerdown", this.onDown);
    this.canvas.addEventListener("pointermove", this.onMove);
    this.canvas.addEventListener("pointerup", this.onUp);
    this.canvas.addEventListener("pointercancel", this.onCancel);
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

  /** The point a tap pinned, if any: the harness reads this. */
  get pinnedPoint(): { x: number; index: number } | null {
    return this.pinned;
  }

  /** Whether the plot is still coasting after a release. */
  get coasting(): boolean {
    return this.coast !== null;
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
    this.coast = null;
    if (this.frame) window.cancelAnimationFrame(this.frame);
    this.root.remove();
    const view = this.view;
    this.options.onClose(commit && !sameView(view, this.start) ? view : null);
  }

  private reset(): void {
    this.coast = null;
    this.draft.xRange = [...this.start.xRange];
    this.draft.yRange = [...this.start.yRange];
    this.gesture = null;
    this.moving = false;
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
    // A press stops a coast where it is, as a finger stops a scroll.
    this.coast = null;
    const p = this.framePoint(event.clientX, event.clientY);
    this.pointers.set(event.pointerId, { ...p, type: event.pointerType });
    this.tap =
      this.pointers.size === 1
        ? { id: event.pointerId, x: event.clientX, y: event.clientY, t: event.timeStamp }
        : null;
    if (event.pointerType === "pen") {
      this.traceTo(p, Infinity);
      return;
    }
    this.velocity.reset();
    this.velocity.add(event.timeStamp, event.clientX, event.clientY);
    this.beginGesture();
  };

  private readonly onMove = (event: PointerEvent): void => {
    const known = this.pointers.get(event.pointerId);
    if (!known) return;
    event.stopPropagation();
    if (
      this.tap?.id === event.pointerId &&
      Math.hypot(event.clientX - this.tap.x, event.clientY - this.tap.y) > TAP_SLOP_PX
    ) {
      this.tap = null;
    }
    const p = this.framePoint(event.clientX, event.clientY);
    known.x = p.x;
    known.y = p.y;
    if (known.type === "pen") {
      this.traceTo(p, Infinity);
      return;
    }
    this.velocity.add(event.timeStamp, event.clientX, event.clientY);
    this.applyGesture();
  };

  private readonly onUp = (event: PointerEvent): void => {
    const known = this.pointers.get(event.pointerId);
    if (!known) return;
    event.stopPropagation();
    this.pointers.delete(event.pointerId);
    const tap = this.tap;
    this.tap = null;
    if (known.type === "pen") {
      // The point the Pencil left stays traced, as a tap's does.
      this.settle();
      return;
    }
    if (tap && tap.id === event.pointerId && event.timeStamp - tap.t <= TAP_MS) {
      this.gesture = null;
      this.traceTo(this.framePoint(event.clientX, event.clientY), CURVE_HIT_PX / this.scale);
      this.settle();
      return;
    }
    const wasPan = this.gesture?.points.size === 1;
    // The fingers left continue from where the view is now.
    this.beginGesture();
    if (this.gesture) return;
    const v = this.velocity.velocity(event.timeStamp);
    if (wasPan && Math.hypot(v.x, v.y) >= MIN_FLING_SPEED) {
      this.coast = { vx: v.x, vy: v.y, last: performance.now() };
      this.requestDraw();
      return;
    }
    this.settle();
  };

  private readonly onCancel = (event: PointerEvent): void => {
    if (!this.pointers.delete(event.pointerId)) return;
    this.tap = null;
    this.beginGesture();
    if (!this.gesture) this.settle();
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    this.coast = null;
    const p = this.framePoint(event.clientX, event.clientY);
    const k = Math.exp(-event.deltaY * 0.002);
    const next = zoomView(this.view, k, k, p.x, p.y, this.draft.w, this.draft.h);
    this.setView(next);
    this.showReadout();
  };

  /** Nothing moves any more: draw at full resolution. */
  private settle(): void {
    this.moving = false;
    this.showReadout();
    this.draw();
  }

  /**
   * Trace the curve nearest frame point `p` (page px) at its x, when one
   * passes within `reach` page px of it; else let the traced point go.
   */
  private traceTo(p: { x: number; y: number }, reach: number): void {
    const g = this.draft;
    const hit = traceAt(graphFunctions(g), rangeOf(g), g.w, g.h, p.x, p.y, reach);
    this.pinned = hit ? { x: hit.x, index: hit.index } : null;
    this.requestDraw();
  }

  /** Start (or restart) a drag or pinch from the fingers down now. */
  private beginGesture(): void {
    const points = new Map<number, { x: number; y: number }>();
    for (const [id, p] of this.pointers) if (p.type !== "pen") points.set(id, { x: p.x, y: p.y });
    this.gesture = points.size > 0 ? { view: this.view, points } : null;
  }

  private applyGesture(): void {
    const g = this.gesture;
    if (!g) return;
    const now: Array<{ from: { x: number; y: number }; to: Pointer }> = [];
    for (const [id, from] of g.points) {
      const to = this.pointers.get(id);
      if (to) now.push({ from, to });
    }
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
      if (this.coast) this.stepCoast();
      this.draw();
    });
  }

  /** One frame of a coast: move by the velocity, slow it as a page scroll slows. */
  private stepCoast(): void {
    const c = this.coast;
    if (!c) return;
    const now = performance.now();
    const dt = Math.min(MAX_STEP_MS, Math.max(0, now - c.last));
    c.last = now;
    const decay = Math.pow(DECELERATION_RATE, dt);
    c.vx *= decay;
    c.vy *= decay;
    const k = this.scale > 0 ? 1 / this.scale : 1;
    this.moving = true;
    this.draft.xRange = panView(this.view, c.vx * dt * k, 0, this.draft.w, this.draft.h).xRange;
    this.draft.yRange = panView(this.view, 0, c.vy * dt * k, this.draft.w, this.draft.h).yRange;
    if (Math.hypot(c.vx, c.vy) < REST_SPEED) {
      this.coast = null;
      this.moving = false;
      this.showReadout();
      return;
    }
    this.requestDraw();
  }

  /** Paint the plot and the traced point, at full resolution once at rest. */
  draw(): void {
    const ctx = this.ctx;
    if (!ctx || this.closed) return;
    this.draws++;
    const k = this.scale * this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(k, 0, 0, k, -this.draft.x * k, -this.draft.y * k);
    const level = this.moving ? k * MOVING_RESOLUTION : k;
    const trace = this.traced();
    paintGraph(ctx, this.draft, {
      level,
      night: this.options.night,
      paper: this.options.paper,
      ...(trace ? { trace } : {}),
    });
  }

  /** The traced point as the painter marks it, or null when it is undefined or out of view. */
  private traced(): { x: number; y: number; curve: number; label: string } | null {
    const pin = this.pinned;
    const fn = pin ? graphFunctions(this.draft)[pin.index] : null;
    if (!pin || !fn) return null;
    const y = fn(pin.x);
    const [y0, y1] = this.draft.yRange;
    const [x0, x1] = this.draft.xRange;
    if (!Number.isFinite(y) || y < y0 || y > y1 || pin.x < x0 || pin.x > x1) return null;
    const label = `(${formatNumber(pin.x)}, ${formatNumber(y)})`;
    this.readout.setText(label);
    return { x: pin.x, y, curve: pin.index, label };
  }

  private showReadout(): void {
    const [x0, x1] = this.draft.xRange;
    const [y0, y1] = this.draft.yRange;
    this.readout.setText(
      `x ${formatNumber(x0)} … ${formatNumber(x1)}   y ${formatNumber(y0)} … ${formatNumber(y1)}`,
    );
  }
}

/** A selection-bar button: `clickable-icon` keeps Obsidian's iPad padding off it. */
function barButton(
  bar: HTMLElement,
  label: string,
  icon: string,
  withLabel = false,
): HTMLButtonElement {
  const button = bar.createEl("button", {
    cls: `goodobsidian-selection-button clickable-icon${withLabel ? " has-label" : ""}`,
    attr: { "aria-label": label, title: label },
  });
  if (withLabel) {
    setIcon(button.createSpan({ cls: "goodobsidian-selection-button-icon" }), icon);
    button.createSpan({ cls: "goodobsidian-selection-button-label", text: label });
  } else {
    setIcon(button, icon);
  }
  return button;
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
