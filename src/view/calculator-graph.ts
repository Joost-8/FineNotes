/**
 * The calculator's graph pane, Desmos-style: the list of lines (with their
 * sliders) above, the canvas below.
 *
 * - **List.** A dot per line in its colour (tap it to hide or show the
 *   line), the line as math (tap it to edit it on the keys), and ⋯ for its
 *   options: dashed, width, derivative, tangent, ∫ area, table, move up or
 *   down, delete. Any other letter in a line gets a slider row with a play
 *   button and editable min, step and max.
 * - **Canvas.** One finger (or the Pencil, or a mouse) pans, two pinch, a
 *   wheel zooms, a double tap fits the curves. A tap on a grey dot (a root,
 *   an extremum, an intercept, an intersection) or on a curve shows its
 *   point; tap and hold pins it, and a tap on a pin takes it away. ⚙ opens
 *   the view: grid, numbers, 1:1 axes, π ticks and the range.
 *
 * The maths is `model/graph-lines.ts` and `model/graph-sample.ts`, the
 * drawing `canvas/graph-painter.ts`; this file routes input and schedules
 * paints. Everything shown lives in one {@link GraphSpec}, the object a
 * graph on a page stores.
 *
 * Cost per frame is bounded: while a finger moves or a slider plays the
 * implicit grid is coarse and points of interest wait; they come back once
 * the view is still.
 */

import { setIcon } from "obsidian";
import { paintGraphGeometry, pointLabel, preparedOf } from "../canvas/graph-painter";
import type { AngleMode } from "../model/calculator";
import {
  type GraphRange,
  type GraphSpec,
  MAX_SPAN,
  MIN_SPAN,
  defaultRange,
  fitRange,
  panRange,
  toScreen,
  toValue,
  zoomRange,
} from "../model/graph";
import {
  type GraphLine,
  type GraphSlider,
  MAX_LINES,
  normalizeGraphSpec,
} from "../model/graph-lines";
import {
  type LineGeometry,
  type Poi,
  type PreparedGraph,
  pointsOfInterest,
  sampleGraphGeometry,
  tableOfValues,
  valueOfLine,
} from "../model/graph-sample";

/** Desmos' order of colours; lighter ones on dark paper. */
export const CURVES_LIGHT = ["#2d70b3", "#c74440", "#388c46", "#6042a6", "#e07400", "#1a1a1a"];
export const CURVES_DARK = ["#62a8ff", "#ff6b66", "#5cc46b", "#a487ff", "#ffa057", "#e6e6e6"];

/** A graph's state while the app runs: its spec (version 2) and whether its view was set yet. */
export interface GraphState {
  spec: GraphSpec;
  /** False until the canvas first has a size (the default view needs it). */
  placed: boolean;
  /**
   * The canvas size the view was last drawn at, in any panel: a new size
   * (the window resized, the graph popped out) keeps units per pixel, as
   * Desmos does, rather than stretching the graph.
   */
  drawn?: { w: number; h: number };
}

export function newGraphState(spec?: GraphSpec): GraphState {
  const base = spec ?? { xMin: -10, xMax: 10, yMin: -10, yMax: 10, expressions: [] };
  return { spec: normalizeGraphSpec(base), placed: spec !== undefined };
}

/** Panels showing a graph (the pop-up's pane and the graph window), told when another changes it. */
const watchers = new WeakMap<GraphState, Set<(source: unknown) => void>>();

/** Tell every panel showing `state` except `source` that it changed. */
export function graphChanged(state: GraphState, source?: unknown): void {
  for (const watch of watchers.get(state) ?? []) watch(source);
}

export interface GraphPanelHost {
  angle(): AngleMode;
  /** Edit a line on the keys (null: a new line). */
  editLine(id: string | null): void;
  /** Something about the graph changed (for Insert graph's state). */
  changed(): void;
  /** Lay a line's text out as math into `parent`. */
  drawMath(parent: HTMLElement, text: string): void;
}

const TAP_SLOP_PX = 8;
const TAP_MS = 300;
const HOLD_MS = 500;
const DOUBLE_TAP_MS = 320;
const FRAME_SAMPLES = 240;
/** Implicit grid cell: fine when still, coarse while moving. */
const CELL_STILL = 4;
const CELL_MOVING = 9;
/** The coarsest a moving frame's grid gets when frames run slow (a slower iPad, many implicit lines). */
const CELL_MOVING_MAX = 18;
/** A moving frame over this many ms coarsens the next; under half of it refines. */
const FRAME_BUDGET_MS = 10;
/** A slider at play sweeps its range in this many seconds. */
const SWEEP_SECONDS = 4;

interface Pointer {
  x: number;
  y: number;
}

type Marker = { x: number; y: number; color: string; label: string; line?: string };

export class GraphPanel {
  readonly el: HTMLElement;
  /** How long the last paints took (ms), newest last: the gallery measures these. */
  readonly frameTimes: number[] = [];
  private readonly list: HTMLElement;
  private readonly wrap: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly viewPanel: HTMLElement;
  private prepared: PreparedGraph | null = null;
  private geometry: LineGeometry[] = [];
  private pois: Poi[] = [];
  private poisKey = "";
  private poiTimer = 0;
  private marker: Marker | null = null;
  private frame = 0;
  private moving = false;
  /** The moving grid's cell, adapted to how long moving frames take. */
  private movingCell = CELL_MOVING;
  private openOptions: string | null = null;
  private playing: string | null = null;
  private playDir = 1;
  private playFrame = 0;
  private lastPlay = 0;
  private readonly pointers = new Map<number, Pointer>();
  private gesture: {
    start: Pointer;
    startTime: number;
    moved: boolean;
    pinch: { distance: number; mid: Pointer; range: GraphRange } | null;
    holdTimer: number;
    held: boolean;
  } | null = null;
  private lastTap = { time: 0, x: 0, y: 0 };
  private readonly dispose: Array<() => void> = [];
  /** No sampling while the pen writes on the page; what was asked for meanwhile is painted after. */
  private paused = false;
  private pending = false;

  constructor(
    parent: HTMLElement,
    private readonly state: GraphState,
    private readonly host: GraphPanelHost,
  ) {
    this.el = parent.createDiv({ cls: "goodobsidian-calc-graph" });
    this.list = this.el.createDiv({ cls: "goodobsidian-calc-functions" });
    this.wrap = this.el.createDiv({ cls: "goodobsidian-calc-canvas" });
    this.canvas = this.wrap.createEl("canvas");
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", "Graph");
    this.overlayButton("settings-2", "View: grid, numbers, axes, range", "is-view", () =>
      this.toggleView(),
    );
    this.overlayButton("maximize-2", "Fit the graph", "is-fit", () => this.reset());
    this.viewPanel = this.wrap.createDiv({ cls: "goodobsidian-calc-view is-hidden" });
    this.recompile();
    this.renderList();
    this.installGestures();
    const watch = (source: unknown): void => {
      if (source !== this) this.refresh();
    };
    const set = watchers.get(state) ?? new Set();
    set.add(watch);
    watchers.set(state, set);
    this.dispose.push(() => set.delete(watch));
    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(() => this.schedule());
      observer.observe(this.wrap);
      this.dispose.push(() => observer.disconnect());
    }
  }

  /** The graph as a plain object: lines, sliders, view and range. */
  spec(): GraphSpec {
    return normalizeGraphSpec({ ...this.state.spec, angle: this.host.angle() });
  }

  destroy(): void {
    window.cancelAnimationFrame(this.frame);
    window.cancelAnimationFrame(this.playFrame);
    window.clearTimeout(this.poiTimer);
    if (this.gesture) window.clearTimeout(this.gesture.holdTimer);
    this.playing = null;
    for (const d of this.dispose) d();
  }

  /** The lines changed (text, look or order): compile again and redraw the list and graph. */
  refresh(): void {
    this.recompile();
    this.renderList();
    this.schedule();
  }

  /**
   * Hold sampling and painting (the pen is down on the page): nothing runs
   * until it is released, and then one paint catches up if one was asked for.
   */
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (!paused && this.pending) {
      this.pending = false;
      this.schedule();
    }
  }

  /** The graph changed here: the host's own reaction, and every other panel showing it. */
  private changed(): void {
    this.host.changed();
    graphChanged(this.state, this);
  }

  colorOf(index: number): string {
    const line = this.state.spec.lines?.[index];
    const palette = this.palette();
    return line?.color ?? palette[index % palette.length];
  }

  // --- Painting ---------------------------------------------------------------

  /** Paint now, skipping the animation frame (and timing it). */
  paintNow(): void {
    this.frame = 0;
    if (this.paused) {
      this.pending = true;
      return;
    }
    const started = performance.now();
    const w = this.wrap.clientWidth;
    const h = this.wrap.clientHeight;
    const prepared = this.prepared;
    if (w === 0 || h === 0 || !prepared) return;
    const ratio = window.devicePixelRatio || 1;
    const pw = Math.round(w * ratio);
    const ph = Math.round(h * ratio);
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    const spec = this.state.spec;
    if (!this.state.placed) {
      this.state.placed = true;
      // Equal scales, as Desmos opens; fitting is the double tap's and the fit button's.
      this.setView(defaultRange(w, h, this.host.angle()), false);
    }
    // A new canvas size (the window resized, the pane rotated) keeps units
    // per pixel about the same middle, rather than stretching the graph.
    const last = this.state.drawn;
    if (last && (last.w !== w || last.h !== h)) {
      const r = this.range();
      const kx = (r.xMax - r.xMin) / last.w;
      const ky = (r.yMax - r.yMin) / last.h;
      const cx = (r.xMin + r.xMax) / 2;
      const cy = (r.yMin + r.yMax) / 2;
      this.setView(
        {
          xMin: cx - (kx * w) / 2,
          xMax: cx + (kx * w) / 2,
          yMin: cy - (ky * h) / 2,
          yMax: cy + (ky * h) / 2,
        },
        false,
      );
    }
    this.state.drawn = { w, h };
    if (spec.square) this.squareUp(w, h);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const range = this.range();
    const busy = this.moving || this.playing !== null;
    this.geometry = sampleGraphGeometry(prepared, range, w, h, {
      cell: busy ? this.movingCell : CELL_STILL,
    });
    const pins = (spec.pins ?? []).flatMap((pin) => {
      const index = spec.lines?.findIndex((l) => l.id === pin.line) ?? -1;
      const y = valueOfLine(prepared, pin.line, pin.x);
      if (index < 0 || !Number.isFinite(y)) return [];
      return [{ x: pin.x, y, color: this.colorOf(index), label: pointLabel(pin.x, y) }];
    });
    paintGraphGeometry(ctx, { x: 0, y: 0, w, h }, range, this.geometry, {
      colors: this.colors(),
      fontFamily: getComputedStyle(this.canvas).fontFamily || "sans-serif",
      grid: spec.grid !== false,
      labels: spec.labels !== false,
      piTicks: spec.piTicks === true,
      pois: busy ? [] : this.pois,
      pins,
      ...(this.marker ? { trace: this.marker } : {}),
    });
    const took = performance.now() - started;
    if (busy) {
      // Bounded per frame: a slow frame makes the next coarser, a quick one finer.
      if (took > FRAME_BUDGET_MS)
        this.movingCell = Math.min(CELL_MOVING_MAX, this.movingCell * 1.25);
      else if (took < FRAME_BUDGET_MS / 2)
        this.movingCell = Math.max(CELL_MOVING, this.movingCell / 1.1);
    }
    this.frameTimes.push(took);
    if (this.frameTimes.length > FRAME_SAMPLES) this.frameTimes.shift();
    this.schedulePois();
  }

  /** Points of interest once the view has been still for a moment (they take a few ms). */
  private schedulePois(): void {
    window.clearTimeout(this.poiTimer);
    if (this.moving || this.playing || !this.prepared) return;
    const key = JSON.stringify([this.range(), this.state.spec.lines, this.state.spec.sliders]);
    if (key === this.poisKey) return;
    this.poiTimer = window.setTimeout(() => {
      if (!this.prepared) return;
      this.pois = pointsOfInterest(this.prepared, this.range(), this.geometry);
      this.poisKey = key;
      this.schedule();
    }, 150);
  }

  private schedule(): void {
    if (this.paused) {
      this.pending = true;
      return;
    }
    if (this.frame) return;
    this.frame = window.requestAnimationFrame(() => this.paintNow());
  }

  private recompile(): void {
    const spec = this.state.spec;
    this.prepared = preparedOf({ ...spec, angle: this.host.angle() }, this.palette());
    // Sliders follow the letters the lines use; the prepared copy is the panel's own.
    this.prepared = { ...this.prepared, sliders: this.prepared.sliders.map((s) => ({ ...s })) };
    spec.sliders = this.prepared.sliders;
    this.poisKey = "";
    this.pois = [];
  }

  private dark(): boolean {
    return document.body.hasClass("theme-dark");
  }

  private palette(): string[] {
    return this.dark() ? CURVES_DARK : CURVES_LIGHT;
  }

  /** The page's colours, resolved: a canvas reads no CSS variables. */
  private colors(): {
    background: string;
    grid: string;
    axis: string;
    label: string;
    curves: string[];
    poi: string;
  } {
    const css = getComputedStyle(this.wrap);
    const read = (name: string, fallback: string): string =>
      css.getPropertyValue(name).trim() || fallback;
    return {
      background: read("--background-primary", this.dark() ? "#1e1e1e" : "#ffffff"),
      grid: read("--background-modifier-border", "#e0e0e0"),
      axis: read("--text-muted", "#888888"),
      label: read("--text-faint", "#999999"),
      curves: this.palette(),
      poi: read("--text-muted", "#888888"),
    };
  }

  // --- View -------------------------------------------------------------------

  private range(): GraphRange {
    const { xMin, xMax, yMin, yMax } = this.state.spec;
    return { xMin, xMax, yMin, yMax };
  }

  private setView(range: GraphRange, repaint = true): void {
    const spec = this.state.spec;
    spec.xMin = range.xMin;
    spec.xMax = range.xMax;
    spec.yMin = range.yMin;
    spec.yMax = range.yMax;
    if (repaint) this.schedule();
  }

  /** y fitted to the visible functions of x; other kinds keep the range given. */
  private fitted(range: GraphRange): GraphRange {
    const prepared = this.prepared;
    if (!prepared) return range;
    const fns = prepared.lines
      .filter((p) => !p.line.hidden && p.compiled.plot.kind === "function")
      .map((p) => (x: number) => valueOfLine(prepared, p.line.id, x));
    return fns.length > 0 ? fitRange(fns, range) : range;
  }

  /** With 1:1 axes on, y's span follows x's at the canvas's shape, about the same middle. */
  private squareUp(w: number, h: number): void {
    const r = this.range();
    const want = ((r.xMax - r.xMin) * h) / w;
    if (Math.abs(r.yMax - r.yMin - want) <= 1e-9 * want) return;
    const mid = (r.yMin + r.yMax) / 2;
    this.setView({ ...r, yMin: mid - want / 2, yMax: mid + want / 2 }, false);
  }

  /** Back to x from −10 to 10 (±360° in degrees), the curves fitted. */
  private reset(): void {
    const w = this.wrap.clientWidth;
    const h = this.wrap.clientHeight;
    this.setView(this.fitted(defaultRange(w, h, this.host.angle())));
    this.changed();
  }

  private overlayButton(icon: string, label: string, cls: string, run: () => void): void {
    const button = this.wrap.createEl("button", {
      cls: `clickable-icon goodobsidian-calc-overlay ${cls}`,
      attr: { "aria-label": label, title: label },
    });
    setIcon(button, icon);
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener("pointerup", (event) => {
      event.stopPropagation();
      run();
    });
    button.addEventListener("click", (event) => {
      if (event.detail === 0) run();
    });
  }

  private toggleView(): void {
    const open = this.viewPanel.hasClass("is-hidden");
    this.viewPanel.toggleClass("is-hidden", !open);
    if (open) this.renderView();
  }

  private renderView(): void {
    const panel = this.viewPanel;
    panel.empty();
    const spec = this.state.spec;
    const toggles: Array<[string, boolean, (on: boolean) => void]> = [
      ["Grid", spec.grid !== false, (on) => (on ? delete spec.grid : (spec.grid = false))],
      ["Numbers", spec.labels !== false, (on) => (on ? delete spec.labels : (spec.labels = false))],
      ["1:1 axes", spec.square === true, (on) => (on ? (spec.square = true) : delete spec.square)],
      [
        "π ticks",
        spec.piTicks === true,
        (on) => (on ? (spec.piTicks = true) : delete spec.piTicks),
      ],
    ];
    const chips = panel.createDiv({ cls: "goodobsidian-calc-chips" });
    for (const [label, on, set] of toggles) {
      this.chip(chips, label, on, () => {
        set(!on);
        this.renderView();
        this.schedule();
        this.changed();
      });
    }
    const fields = panel.createDiv({ cls: "goodobsidian-calc-range" });
    const r = this.range();
    const inputs = new Map<keyof GraphRange, HTMLInputElement>();
    for (const [key, label] of [
      ["xMin", "x from"],
      ["xMax", "to"],
      ["yMin", "y from"],
      ["yMax", "to"],
    ] as const) {
      const field = fields.createEl("label", { cls: "goodobsidian-calc-field" });
      field.createSpan({ text: label });
      inputs.set(key, this.numberInput(field, r[key], `${key}`));
    }
    const apply = panel.createEl("button", {
      cls: "clickable-icon goodobsidian-calc-apply",
      text: "Set range",
    });
    apply.addEventListener("click", () => {
      const read = (key: keyof GraphRange): number => Number(inputs.get(key)?.value);
      const next = {
        xMin: read("xMin"),
        xMax: read("xMax"),
        yMin: read("yMin"),
        yMax: read("yMax"),
      };
      const xs = next.xMax - next.xMin;
      const ys = next.yMax - next.yMin;
      const valid =
        Object.values(next).every(Number.isFinite) &&
        xs >= MIN_SPAN &&
        ys >= MIN_SPAN &&
        xs <= MAX_SPAN &&
        ys <= MAX_SPAN;
      apply.toggleClass("is-error", !valid);
      if (!valid) return;
      this.setView(next);
      this.changed();
    });
  }

  private chip(
    parent: HTMLElement,
    label: string,
    on: boolean,
    run: () => void,
  ): HTMLButtonElement {
    const chip = parent.createEl("button", {
      cls: "clickable-icon goodobsidian-calc-chip",
      text: label,
      attr: { "aria-pressed": String(on) },
    });
    chip.toggleClass("is-active", on);
    chip.addEventListener("click", run);
    return chip;
  }

  private numberInput(parent: HTMLElement, value: number, label: string): HTMLInputElement {
    const input = parent.createEl("input", {
      cls: "goodobsidian-calc-number",
      attr: { type: "text", inputmode: "decimal", "aria-label": label },
    });
    input.value = `${Number(value.toPrecision(6))}`;
    return input;
  }

  // --- The list -----------------------------------------------------------------

  private lines(): GraphLine[] {
    const spec = this.state.spec;
    if (!spec.lines) spec.lines = [];
    return spec.lines;
  }

  private renderList(): void {
    const list = this.list;
    list.empty();
    const lines = this.lines();
    this.prepared?.lines.forEach((entry, index) => {
      const line = lines[index];
      if (!line) return;
      const row = list.createDiv({ cls: "goodobsidian-calc-function" });
      row.toggleClass("is-hidden-line", line.hidden === true);
      const dot = row.createEl("button", {
        cls: "clickable-icon goodobsidian-calc-swatch",
        attr: {
          "aria-label": line.hidden ? "Show this line" : "Hide this line",
          title: line.hidden ? "Show" : "Hide",
        },
      });
      dot.setCssStyles({ color: entry.color });
      dot.addEventListener("click", () => {
        if (line.hidden) delete line.hidden;
        else line.hidden = true;
        this.changedLines();
      });
      const text = row.createEl("button", {
        cls: "clickable-icon goodobsidian-calc-function-text",
      });
      text.setAttribute("aria-label", `Edit ${line.text}`);
      this.host.drawMath(text.createDiv({ cls: "goodobsidian-calc-math" }), line.text);
      const plot = entry.compiled.plot;
      if (plot.kind === "error") {
        text.createDiv({ cls: "goodobsidian-calc-function-error", text: plot.error });
      }
      text.addEventListener("click", () => this.host.editLine(line.id));
      const more = row.createEl("button", {
        cls: "clickable-icon goodobsidian-calc-more",
        attr: {
          "aria-label": "Options for this line",
          "aria-expanded": String(this.openOptions === line.id),
        },
      });
      setIcon(more, "more-horizontal");
      more.addEventListener("click", () => {
        this.openOptions = this.openOptions === line.id ? null : line.id;
        this.renderList();
      });
      if (this.openOptions === line.id) {
        this.renderOptions(list, line, index, plot.kind === "function");
      }
      if (line.table && plot.kind === "function" && this.prepared) {
        const table = list.createDiv({ cls: "goodobsidian-calc-table" });
        const head = table.createDiv({ cls: "goodobsidian-calc-table-row is-head" });
        head.createSpan({ text: "x" });
        head.createSpan({ text: "y" });
        for (const { x, y } of tableOfValues(this.prepared, line.id, this.range())) {
          const tr = table.createDiv({ cls: "goodobsidian-calc-table-row" });
          tr.createSpan({ text: `${x}` });
          tr.createSpan({ text: Number.isFinite(y) ? `${Number(y.toPrecision(6))}` : "—" });
        }
      }
    });
    for (const slider of this.state.spec.sliders ?? []) this.renderSlider(list, slider);
    const add = list.createEl("button", {
      cls: "clickable-icon goodobsidian-calc-function goodobsidian-calc-add",
    });
    setIcon(add.createSpan({ cls: "goodobsidian-calc-add-icon" }), "plus");
    add.createSpan({
      text:
        lines.length === 0
          ? "Add a line: y = …, x² + y² = 25, (cos t, sin t), r = θ …"
          : "Add a line",
    });
    add.setAttribute("aria-label", "Add a line");
    add.disabled = lines.length >= MAX_LINES;
    add.addEventListener("click", () => this.host.editLine(null));
  }

  private renderOptions(
    list: HTMLElement,
    line: GraphLine,
    index: number,
    isFunction: boolean,
  ): void {
    const panel = list.createDiv({ cls: "goodobsidian-calc-options goodobsidian-calc-chips" });
    const toggle = (
      label: string,
      on: boolean,
      run: () => void,
      enabled = true,
    ): HTMLButtonElement => {
      const chip = this.chip(panel, label, on, () => {
        run();
        this.changedLines();
      });
      chip.disabled = !enabled;
      return chip;
    };
    toggle("Dashed", line.style === "dashed", () => {
      if (line.style === "dashed") delete line.style;
      else line.style = "dashed";
    });
    for (const [label, width] of [
      ["Thin", 1.25],
      ["Bold", 4],
    ] as const) {
      toggle(label, line.width === width, () => {
        if (line.width === width) delete line.width;
        else line.width = width;
      });
    }
    const view = this.range();
    const mid = Number(((view.xMin + view.xMax) / 2).toPrecision(3));
    toggle(
      "Derivative",
      line.derivative === true,
      () => {
        if (line.derivative) delete line.derivative;
        else line.derivative = true;
      },
      isFunction,
    );
    toggle(
      "Tangent",
      line.tangentAt !== undefined,
      () => {
        if (line.tangentAt !== undefined) delete line.tangentAt;
        else line.tangentAt = mid;
      },
      isFunction,
    );
    toggle(
      "∫ Area",
      line.area !== undefined,
      () => {
        if (line.area) delete line.area;
        else line.area = [0, Number((view.xMax / 2).toPrecision(2)) || 1];
      },
      isFunction,
    );
    toggle(
      "Table",
      line.table === true,
      () => {
        if (line.table) delete line.table;
        else line.table = true;
      },
      isFunction,
    );
    toggle("Up", false, () => this.move(index, -1), index > 0);
    toggle("Down", false, () => this.move(index, 1), index < this.lines().length - 1);
    const remove = toggle("Delete", false, () => {
      this.lines().splice(index, 1);
      this.openOptions = null;
    });
    remove.addClass("is-danger");
    // Where the tangent and the area sit: numbers to edit.
    const numberField = (label: string, value: number, set: (v: number) => void): void => {
      const field = panel.createEl("label", { cls: "goodobsidian-calc-field" });
      field.createSpan({ text: label });
      const input = this.numberInput(field, value, label);
      input.addEventListener("change", () => {
        const v = Number(input.value);
        if (!Number.isFinite(v)) return;
        set(v);
        this.changedLines(false);
      });
    };
    if (line.tangentAt !== undefined) {
      numberField("Tangent at x =", line.tangentAt, (v) => (line.tangentAt = v));
    }
    const area = line.area;
    if (area) {
      numberField("∫ from", area[0], (v) => (area[0] = v));
      numberField("to", area[1], (v) => (area[1] = v));
    }
  }

  private move(index: number, by: -1 | 1): void {
    const lines = this.lines();
    const [line] = lines.splice(index, 1);
    lines.splice(index + by, 0, line);
  }

  private changedLines(list = true): void {
    this.recompile();
    if (list) this.renderList();
    this.schedule();
    this.changed();
  }

  private renderSlider(list: HTMLElement, slider: GraphSlider): void {
    const row = list.createDiv({ cls: "goodobsidian-calc-slider" });
    row.dataset.slider = slider.name;
    const top = row.createDiv({ cls: "goodobsidian-calc-slider-top" });
    const value = top.createSpan({ cls: "goodobsidian-calc-slider-value" });
    const show = (): void =>
      value.setText(`${slider.name} = ${Number(slider.value.toPrecision(4))}`);
    show();
    const range = top.createEl("input", {
      cls: "goodobsidian-calc-slider-range",
      attr: {
        type: "range",
        min: `${slider.min}`,
        max: `${slider.max}`,
        step: slider.step > 0 ? `${slider.step}` : "any",
        "aria-label": `Slider ${slider.name}`,
      },
    });
    range.value = `${slider.value}`;
    range.addEventListener("input", () => {
      slider.value = Number(range.value);
      show();
      this.slid();
    });
    range.addEventListener("change", () => this.settled());
    const play = top.createEl("button", {
      cls: "clickable-icon goodobsidian-calc-play",
      attr: {
        "aria-label": this.playing === slider.name ? `Stop ${slider.name}` : `Play ${slider.name}`,
      },
    });
    setIcon(play, this.playing === slider.name ? "pause" : "play");
    play.addEventListener("click", () => this.togglePlay(slider.name));
    const bounds = row.createDiv({ cls: "goodobsidian-calc-slider-bounds" });
    for (const [key, label] of [
      ["min", "min"],
      ["step", "step"],
      ["max", "max"],
    ] as const) {
      const field = bounds.createEl("label", { cls: "goodobsidian-calc-field" });
      field.createSpan({ text: label });
      const input = this.numberInput(field, slider[key], `${slider.name} ${label}`);
      input.addEventListener("change", () => {
        const v = Number(input.value);
        if (!Number.isFinite(v) || (key === "step" && v < 0)) return;
        slider[key] = v;
        if (slider.min >= slider.max) slider.max = slider.min + 1;
        slider.value = Math.min(slider.max, Math.max(slider.min, slider.value));
        this.renderList();
        this.schedule();
        this.changed();
      });
    }
  }

  /** A slider moved: the same compiled lines, new values (the sliders are shared with the spec). */
  private slid(): void {
    this.moving = true;
    this.schedule();
  }

  private settled(): void {
    this.moving = false;
    this.schedule();
    this.changed();
  }

  /** Play a slider: it sweeps between its min and max, to and fro, until stopped. */
  togglePlay(name: string): void {
    this.playing = this.playing === name ? null : name;
    this.renderList();
    window.cancelAnimationFrame(this.playFrame);
    if (!this.playing) {
      this.settled();
      return;
    }
    this.lastPlay = performance.now();
    const step = (now: number): void => {
      this.playStep(now);
      if (this.playing) this.playFrame = window.requestAnimationFrame(step);
    };
    this.playFrame = window.requestAnimationFrame(step);
  }

  /** One frame of a playing slider (exposed for the gallery's timer-driven measurement). */
  playStep(now: number): void {
    if (this.paused) {
      this.lastPlay = now;
      return;
    }
    const slider = this.state.spec.sliders?.find((s) => s.name === this.playing);
    if (!slider || !this.el.isConnected) {
      this.playing = null;
      return;
    }
    const dt = Math.min(0.1, Math.max(0, (now - this.lastPlay) / 1000));
    this.lastPlay = now;
    let v = slider.value + (this.playDir * (slider.max - slider.min) * dt) / SWEEP_SECONDS;
    if (v >= slider.max || v <= slider.min) {
      this.playDir = -this.playDir;
      v = Math.min(slider.max, Math.max(slider.min, v));
    }
    slider.value = v;
    const row = this.list.querySelector(`[data-slider="${slider.name}"]`);
    const input = row?.querySelector<HTMLInputElement>("input[type=range]");
    if (input) input.value = `${v}`;
    row
      ?.querySelector(".goodobsidian-calc-slider-value")
      ?.setText(`${slider.name} = ${Number(v.toPrecision(4))}`);
    this.paintNow();
  }

  // --- Gestures ---------------------------------------------------------------

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
      if (this.gesture) window.clearTimeout(this.gesture.holdTimer);
      if (this.pointers.size === 1) {
        // "Nothing happened for HOLD_MS" is a timer, never a check in an event handler (ledger).
        const holdTimer = window.setTimeout(() => {
          if (this.gesture && !this.gesture.moved) {
            this.gesture.held = true;
            this.pin(this.gesture.start);
          }
        }, HOLD_MS);
        this.gesture = {
          start: p,
          startTime: event.timeStamp,
          moved: false,
          pinch: null,
          holdTimer,
          held: false,
        };
      } else if (this.pointers.size === 2) {
        const [a, b] = Array.from(this.pointers.values());
        this.gesture = {
          start: p,
          startTime: event.timeStamp,
          moved: true,
          pinch: {
            distance: Math.hypot(a.x - b.x, a.y - b.y),
            mid: midpoint(a, b),
            range: this.range(),
          },
          holdTimer: 0,
          held: false,
        };
      }
    };
    const move = (event: PointerEvent): void => {
      const before = this.pointers.get(event.pointerId);
      if (!before || !this.gesture) return;
      const p = this.local(event);
      this.pointers.set(event.pointerId, p);
      const w = this.wrap.clientWidth;
      const h = this.wrap.clientHeight;
      const pinch = this.gesture.pinch;
      if (pinch && this.pointers.size >= 2) {
        const [a, b] = Array.from(this.pointers.values());
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = midpoint(a, b);
        const factor = distance / Math.max(1, pinch.distance);
        const zoomed = zoomRange(pinch.range, w, h, factor, pinch.mid.x, pinch.mid.y);
        this.moving = true;
        this.setView(panRange(zoomed, w, h, mid.x - pinch.mid.x, mid.y - pinch.mid.y));
        return;
      }
      if (!this.gesture.moved) {
        const travelled = Math.hypot(p.x - this.gesture.start.x, p.y - this.gesture.start.y);
        if (travelled < TAP_SLOP_PX) return;
        this.gesture.moved = true;
        window.clearTimeout(this.gesture.holdTimer);
      }
      if (this.gesture.held) return;
      this.moving = true;
      this.setView(panRange(this.range(), w, h, p.x - before.x, p.y - before.y));
    };
    const up = (event: PointerEvent): void => {
      if (!this.pointers.delete(event.pointerId)) return;
      const gesture = this.gesture;
      if (this.pointers.size === 1) {
        const [rest] = Array.from(this.pointers.values());
        this.gesture = {
          start: rest,
          startTime: event.timeStamp,
          moved: true,
          pinch: null,
          holdTimer: 0,
          held: false,
        };
        return;
      }
      if (this.pointers.size > 0) return;
      this.gesture = null;
      if (gesture) window.clearTimeout(gesture.holdTimer);
      if (this.moving) {
        this.moving = false;
        this.schedule();
        this.changed();
      }
      if (!gesture || gesture.moved || gesture.held || event.type === "pointercancel") return;
      if (event.timeStamp - gesture.startTime > TAP_MS) return;
      this.tap(this.local(event), event.timeStamp);
    };
    const wheel = (event: WheelEvent): void => {
      event.preventDefault();
      const p = this.local(event);
      const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0025));
      const w = this.wrap.clientWidth;
      const h = this.wrap.clientHeight;
      this.setView(zoomRange(this.range(), w, h, factor, p.x, p.y));
    };
    // iOS takes a still finger for its own long press; the hold here is ours (ledger).
    const touch = (event: TouchEvent): void => event.preventDefault();
    c.addEventListener("pointerdown", down);
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", up);
    c.addEventListener("wheel", wheel, { passive: false });
    c.addEventListener("touchstart", touch, { passive: false });
    this.dispose.push(() => {
      c.removeEventListener("pointerdown", down);
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", up);
      c.removeEventListener("pointercancel", up);
      c.removeEventListener("wheel", wheel);
      c.removeEventListener("touchstart", touch);
    });
  }

  /** What is under a tap: a point of interest, else a function line's point at that x. */
  private hit(p: Pointer): Marker | null {
    const w = this.wrap.clientWidth;
    const h = this.wrap.clientHeight;
    const range = this.range();
    let best: Poi | null = null;
    let bestPx = 16;
    for (const poi of this.pois) {
      const s = toScreen(range, w, h, poi.x, poi.y);
      const d = Math.hypot(s.px - p.x, s.py - p.y);
      if (d <= bestPx) {
        bestPx = d;
        best = poi;
      }
    }
    if (best) {
      const label = `${poiName(best)} ${pointLabel(best.x, best.y)}`;
      return { x: best.x, y: best.y, color: this.colors().poi, label };
    }
    const prepared = this.prepared;
    if (!prepared) return null;
    const { x } = toValue(range, w, h, p.x, p.y);
    let found: Marker | null = null;
    let nearest = 24;
    prepared.lines.forEach((entry, index) => {
      if (entry.line.hidden || entry.compiled.plot.kind !== "function") return;
      const y = valueOfLine(prepared, entry.line.id, x);
      if (!Number.isFinite(y)) return;
      const d = Math.abs(toScreen(range, w, h, x, y).py - p.y);
      if (d <= nearest) {
        nearest = d;
        found = { x, y, color: this.colorOf(index), label: pointLabel(x, y), line: entry.line.id };
      }
    });
    return found;
  }

  /** A tap shows the point under it; a second tap close by fits the view. */
  private tap(p: Pointer, time: number): void {
    const double =
      time - this.lastTap.time < DOUBLE_TAP_MS &&
      Math.hypot(p.x - this.lastTap.x, p.y - this.lastTap.y) < 24;
    this.lastTap = double ? { time: 0, x: 0, y: 0 } : { time, x: p.x, y: p.y };
    if (double) {
      this.setView(this.fitted(this.range()));
      return;
    }
    // A tap on a pin takes it away.
    const pins = this.state.spec.pins ?? [];
    const w = this.wrap.clientWidth;
    const h = this.wrap.clientHeight;
    const range = this.range();
    const prepared = this.prepared;
    const onPin = pins.findIndex((pin) => {
      const y = prepared ? valueOfLine(prepared, pin.line, pin.x) : NaN;
      if (!Number.isFinite(y)) return false;
      const s = toScreen(range, w, h, pin.x, y);
      return Math.hypot(s.px - p.x, s.py - p.y) < 14;
    });
    if (onPin >= 0) {
      pins.splice(onPin, 1);
      this.marker = null;
      this.schedule();
      this.changed();
      return;
    }
    this.marker = this.hit(p);
    this.schedule();
  }

  /** Tap and hold on a curve pins its point, which stays with its label. */
  private pin(p: Pointer): void {
    const hit = this.hit(p);
    if (!hit?.line) return;
    const spec = this.state.spec;
    spec.pins = [...(spec.pins ?? []), { line: hit.line, x: hit.x }].slice(-12);
    this.marker = null;
    this.schedule();
    this.changed();
  }
}

function midpoint(a: Pointer, b: Pointer): Pointer {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function poiName(poi: Poi): string {
  switch (poi.kind) {
    case "root":
      return "Root";
    case "max":
      return "Max";
    case "min":
      return "Min";
    case "intercept":
      return "y-intercept";
    default:
      return "Crossing";
  }
}
