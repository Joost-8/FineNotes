/**
 * The calculator's graph: y = f(x) curves on a canvas inside the pop-up,
 * with Desmos' gestures. One finger (or the Pencil, or a mouse) pans, two
 * fingers pinch, a wheel zooms, a double tap fits the curves, and a tap on a
 * curve traces it.
 *
 * All the maths is `model/graph.ts` and all the drawing is
 * `canvas/graph-painter.ts`; this file only routes pointers and schedules
 * paints. What is plotted lives in a {@link GraphSpec} (`spec()`), the plain
 * object a graph on a page will store.
 */

import { setIcon } from "obsidian";
import { type GraphColors, paintGraph } from "../canvas/graph-painter";
import type { AngleMode } from "../model/calculator";
import {
  type GraphRange,
  type GraphSpec,
  type RealFn,
  compileGraph,
  defaultRange,
  fitRange,
  panRange,
  sampleCurve,
  traceAt,
  zoomRange,
} from "../model/graph";

/** What is plotted, kept by the pop-up between openings. */
export interface GraphState {
  expressions: string[];
  /** Null until the canvas first has a size. */
  range: GraphRange | null;
}

/** Desmos' order of colours; lighter ones on dark paper. */
const CURVES_LIGHT = ["#2d70b3", "#c74440", "#388c46", "#6042a6", "#e07400", "#1a1a1a"];
const CURVES_DARK = ["#62a8ff", "#ff6b66", "#5cc46b", "#a487ff", "#ffa057", "#e6e6e6"];

const TAP_SLOP_PX = 8;
const TAP_MS = 300;
const DOUBLE_TAP_MS = 320;
/** Recent paint durations kept, for the gallery's frame-time measurement. */
const FRAME_SAMPLES = 240;

interface Pointer {
  x: number;
  y: number;
}

export class GraphPanel {
  readonly el: HTMLElement;
  /** How long the last paints took (ms), newest last. */
  readonly frameTimes: number[] = [];
  private readonly wrap: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private fns: Array<RealFn | null> = [];
  private trace: { curve: number; x: number } | null = null;
  private frame = 0;
  private readonly pointers = new Map<number, Pointer>();
  private gesture: {
    start: Pointer;
    startTime: number;
    moved: boolean;
    pinch: { distance: number; mid: Pointer; range: GraphRange } | null;
  } | null = null;
  private lastTap = { time: 0, x: 0, y: 0 };
  private readonly dispose: Array<() => void> = [];

  constructor(
    parent: HTMLElement,
    private readonly state: GraphState,
    private readonly angle: () => AngleMode,
  ) {
    this.el = parent.createDiv({ cls: "goodobsidian-calc-graph" });
    this.wrap = this.el.createDiv({ cls: "goodobsidian-calc-canvas" });
    this.canvas = this.wrap.createEl("canvas");
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", "Graph");
    const fit = this.wrap.createEl("button", {
      cls: "clickable-icon goodobsidian-calc-fit",
      attr: { "aria-label": "Fit the graph" },
    });
    setIcon(fit, "maximize-2");
    fit.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    fit.addEventListener("pointerup", (event) => {
      event.stopPropagation();
      this.reset();
    });
    fit.addEventListener("click", (event) => {
      if (event.detail === 0) this.reset();
    });
    this.compile();
    this.installGestures();
    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(() => this.schedule());
      observer.observe(this.wrap);
      this.dispose.push(() => observer.disconnect());
    }
  }

  /** The graph as a plain object: its expressions and the range in view. */
  spec(): GraphSpec {
    const range = this.state.range ?? defaultRange(this.width(), this.height(), this.angle());
    return { expressions: [...this.state.expressions], ...range, angle: this.angle() };
  }

  /** Compile again after the expressions or the angle changed. */
  refresh(): void {
    this.compile();
    if (this.trace && !this.fns[this.trace.curve]) this.trace = null;
    this.schedule();
  }

  /** Errors of the expressions, by index (null when it plots). */
  errors(): Array<string | null> {
    return compileGraph({ expressions: this.state.expressions, angle: this.angle() }).errors;
  }

  colorOf(index: number): string {
    const curves = this.dark() ? CURVES_DARK : CURVES_LIGHT;
    return curves[index % curves.length];
  }

  destroy(): void {
    window.cancelAnimationFrame(this.frame);
    for (const d of this.dispose) d();
  }

  /** Paint now, skipping the animation frame (and timing it). */
  paintNow(): void {
    this.frame = 0;
    const started = performance.now();
    const w = this.width();
    const h = this.height();
    if (w === 0 || h === 0) return;
    const ratio = window.devicePixelRatio || 1;
    const pw = Math.round(w * ratio);
    const ph = Math.round(h * ratio);
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    if (!this.state.range) this.state.range = fitRange(this.fns, defaultRange(w, h, this.angle()));
    const range = this.state.range;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const curves = this.fns.map((fn) => (fn ? sampleCurve(fn, range, w, h) : []));
    let trace: { x: number; y: number; curve: number; label: string } | undefined;
    if (this.trace) {
      const y = this.fns[this.trace.curve]?.(this.trace.x) ?? NaN;
      if (Number.isFinite(y)) {
        trace = {
          x: this.trace.x,
          y,
          curve: this.trace.curve,
          label: `(${short(this.trace.x)}, ${short(y)})`,
        };
      }
    }
    paintGraph(ctx, { x: 0, y: 0, w, h }, range, curves, {
      colors: this.colors(),
      fontFamily: getComputedStyle(this.canvas).fontFamily || "sans-serif",
      trace,
    });
    this.frameTimes.push(performance.now() - started);
    if (this.frameTimes.length > FRAME_SAMPLES) this.frameTimes.shift();
  }

  private compile(): void {
    this.fns = compileGraph({ expressions: this.state.expressions, angle: this.angle() }).fns;
  }

  private width(): number {
    return this.wrap.clientWidth;
  }

  private height(): number {
    return this.wrap.clientHeight;
  }

  private dark(): boolean {
    return document.body.hasClass("theme-dark");
  }

  /** The page's colours, resolved: a canvas reads no CSS variables. */
  private colors(): GraphColors {
    const css = getComputedStyle(this.wrap);
    const read = (name: string, fallback: string): string =>
      css.getPropertyValue(name).trim() || fallback;
    return {
      background: read("--background-primary", this.dark() ? "#1e1e1e" : "#ffffff"),
      grid: read("--background-modifier-border", "#e0e0e0"),
      axis: read("--text-muted", "#888888"),
      label: read("--text-faint", "#999999"),
      curves: this.dark() ? CURVES_DARK : CURVES_LIGHT,
    };
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = window.requestAnimationFrame(() => this.paintNow());
  }

  private setRange(range: GraphRange): void {
    this.state.range = range;
    this.schedule();
  }

  /** Back to x from −10 to 10, the curves fitted. */
  private reset(): void {
    this.state.range = fitRange(this.fns, defaultRange(this.width(), this.height(), this.angle()));
    this.schedule();
  }

  private local(event: PointerEvent | WheelEvent): Pointer {
    const r = this.canvas.getBoundingClientRect();
    return { x: event.clientX - r.left, y: event.clientY - r.top };
  }

  private installGestures(): void {
    const c = this.canvas;
    const down = (event: PointerEvent): void => {
      event.preventDefault();
      try {
        c.setPointerCapture(event.pointerId);
      } catch {
        // A synthetic pointer has nothing to capture.
      }
      const p = this.local(event);
      this.pointers.set(event.pointerId, p);
      if (this.pointers.size === 1) {
        this.gesture = { start: p, startTime: event.timeStamp, moved: false, pinch: null };
      } else if (this.pointers.size === 2 && this.state.range) {
        const [a, b] = Array.from(this.pointers.values());
        this.gesture = {
          start: p,
          startTime: event.timeStamp,
          moved: true,
          pinch: {
            distance: Math.hypot(a.x - b.x, a.y - b.y),
            mid: midpoint(a, b),
            range: this.state.range,
          },
        };
      }
    };
    const move = (event: PointerEvent): void => {
      const before = this.pointers.get(event.pointerId);
      if (!before || !this.gesture || !this.state.range) return;
      const p = this.local(event);
      this.pointers.set(event.pointerId, p);
      const w = this.width();
      const h = this.height();
      const pinch = this.gesture.pinch;
      if (pinch && this.pointers.size >= 2) {
        const [a, b] = Array.from(this.pointers.values());
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = midpoint(a, b);
        const zoomed = zoomRange(
          pinch.range,
          w,
          h,
          distance / Math.max(1, pinch.distance),
          pinch.mid.x,
          pinch.mid.y,
        );
        this.setRange(panRange(zoomed, w, h, mid.x - pinch.mid.x, mid.y - pinch.mid.y));
        return;
      }
      if (!this.gesture.moved) {
        const travelled = Math.hypot(p.x - this.gesture.start.x, p.y - this.gesture.start.y);
        if (travelled < TAP_SLOP_PX) return;
        this.gesture.moved = true;
      }
      this.setRange(panRange(this.state.range, w, h, p.x - before.x, p.y - before.y));
    };
    const up = (event: PointerEvent): void => {
      if (!this.pointers.delete(event.pointerId)) return;
      const gesture = this.gesture;
      if (this.pointers.size === 1) {
        // A pinch became a pan: start it from where the other finger is.
        const [rest] = Array.from(this.pointers.values());
        this.gesture = { start: rest, startTime: event.timeStamp, moved: true, pinch: null };
        return;
      }
      if (this.pointers.size > 0) return;
      this.gesture = null;
      if (!gesture || gesture.moved || event.type === "pointercancel") return;
      if (event.timeStamp - gesture.startTime > TAP_MS) return;
      this.tap(this.local(event), event.timeStamp);
    };
    const wheel = (event: WheelEvent): void => {
      if (!this.state.range) return;
      event.preventDefault();
      const p = this.local(event);
      const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0025));
      this.setRange(zoomRange(this.state.range, this.width(), this.height(), factor, p.x, p.y));
    };
    c.addEventListener("pointerdown", down);
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", up);
    c.addEventListener("wheel", wheel, { passive: false });
    this.dispose.push(() => {
      c.removeEventListener("pointerdown", down);
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", up);
      c.removeEventListener("pointercancel", up);
      c.removeEventListener("wheel", wheel);
    });
  }

  /** A tap traces the curve under it; a second tap close by fits the view. */
  private tap(p: Pointer, time: number): void {
    const range = this.state.range;
    if (!range) return;
    const double =
      time - this.lastTap.time < DOUBLE_TAP_MS &&
      Math.hypot(p.x - this.lastTap.x, p.y - this.lastTap.y) < 24;
    this.lastTap = double ? { time: 0, x: 0, y: 0 } : { time, x: p.x, y: p.y };
    if (double) {
      this.setRange(fitRange(this.fns, range));
      return;
    }
    const hit = traceAt(this.fns, range, this.width(), this.height(), p.x, p.y);
    // A tap away from every curve puts the trace away.
    this.trace = hit ? { curve: hit.index, x: hit.x } : null;
    this.schedule();
  }
}

function midpoint(a: Pointer, b: Pointer): Pointer {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** A traced coordinate, short: five significant digits, no float noise. */
function short(v: number): string {
  if (v === 0) return "0";
  const text =
    Math.abs(v) >= 1e6 || Math.abs(v) < 1e-4 ? v.toExponential(3) : `${Number(v.toPrecision(5))}`;
  return text.replace("-", "−");
}
