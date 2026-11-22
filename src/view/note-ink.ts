/**
 * One handwriting section of a text note: a strip of paper between the
 * paragraphs that the pen writes on.
 *
 * The section is {@link INK_WIDTH} units wide whatever the column's width;
 * the canvas scales it. Ink goes through the notebook's own pipeline (the
 * stroke builder, the tracer, `paintInk`), so a stroke looks the same here
 * as on a notebook page, and what is drawn while the pen moves is what
 * stays when it lifts.
 *
 * Fingers scroll the note and the pen writes, without a mode for it: the
 * section lets the browser pan (`touch-action: pan-y`) and cancels the
 * touch only when it is a stylus's, which stops the pan and nothing else
 * (pointer events are dispatched first). Where a pen is seen hovering, the
 * section stops panning altogether until it leaves: Chromium pans with a
 * pen where it has no touch events to cancel.
 */

import { FALLBACK_PRESSURE, MIN_SAMPLE_DISTANCE } from "../constants";
import { drawSyntheticRules, paperTheme } from "../canvas/backdrop";
import { nightColor } from "../canvas/night";
import { paintInk, penFor } from "../canvas/renderer";
import { inkRuns } from "../ink/freehand";
import { StrokeBuilder } from "../ink/stroke-builder";
import { swallowGhostClick } from "./ghost-click";
import type { InkAnswer } from "./note-ink-maths";
import { recognizeAtZoom, styleOfShape, type ShapeResult } from "../ink/shape-recognizer";
import { eraseCircleFromStroke } from "../ink/stroke-eraser";
import { deliversCoalescedSamples, isOnDevicePixel } from "../input/pointer-controller";
import type { Stroke } from "../model/document";
import {
  INK_GROW_MARGIN,
  INK_GROW_ROOM,
  INK_MIN_HEIGHT,
  INK_WIDTH,
  clampInkHeight,
  grownHeight,
  inkBottom,
  type InkBlock,
} from "../model/text-note";

export type NoteTool = "pen" | "highlighter" | "eraser";

/** The pen in hand. */
export interface NotePen {
  tool: NoteTool;
  color: string;
  /** The line's width, section units; the eraser's radius in CSS px (the same on screen at any width). */
  size: number;
}

/** A pen held still this long turns its stroke into the shape it drew (as in a notebook). */
const HOLD_MS = 500;
/** Moving further than this, CSS px, starts the wait again. */
const HOLD_RADIUS_PX = 6;
/** No canvas is backed by more device px per CSS px than this. */
const MAX_PIXEL_RATIO = 2;
/** The room kept under the lowest ink when a section's foot is dragged up. */
const RESIZE_ROOM = 6;

export interface InkSectionHost {
  pen(): NotePen;
  /** The eraser's radius, CSS px, for a pen's other end. */
  eraserSize(): number;
  /** Pens thin and swell with pressure (the plugin's setting). */
  pressure(): boolean;
  highlighterAlpha(): number;
  /** The note is shown dark: ink is drawn in its night colours. */
  dark(): boolean;
  /** The note is in drawing mode. */
  drawing(): boolean;
  /** A finger writes too (no stylus on this device, or the user's choice). */
  fingerDraws(): boolean;
  newStrokeId(): string;
  /** A pen touched a section while the note was not in drawing mode. */
  penArrived(): void;
  /** The section's block changed; `manual` when the user set its height by hand. */
  commit(id: string, next: InkBlock, manual?: boolean): void;
  /** The pen went to this section: it is the one that shows its edge. */
  touched(id: string): void;
  /** A stroke is open (or no longer): the note holds still under the hand meanwhile. */
  penDown(down: boolean): void;
  /** A pen stroke was added to the section (not a highlight, a shape or an erase). */
  strokeDrawn?(id: string): void;
}

/** A pen on this device has reported a position between whole px: it does not round. */
let penIsPrecise = false;

function touchIsStylus(event: TouchEvent): boolean {
  for (let i = 0; i < event.changedTouches.length; i++) {
    const touch = event.changedTouches[i] as Touch & { touchType?: string };
    if (touch.touchType === "stylus") return true;
  }
  return false;
}

export class InkSection {
  readonly el: HTMLElement;
  private block: InkBlock;
  private readonly dry: HTMLCanvasElement;
  private readonly wet: HTMLCanvasElement;
  private readonly edge: HTMLElement;
  private readonly observer: ResizeObserver;
  /** CSS px per section unit, and device px per CSS px, as last laid out. */
  private scale = 1;
  private ratio = 1;
  /** The pointer writing or erasing now. */
  private pointer: number | null = null;
  private builder: StrokeBuilder | null = null;
  private pen: NotePen | null = null;
  /** While erasing: the strokes as the eraser has left them so far. */
  private erased: Stroke[] | null = null;
  private eraserAt: { x: number; y: number } | null = null;
  /** The section's height while a stroke or a drag is changing it. */
  private liveHeight: number;
  private frame = 0;
  private lastDownType = "";
  private dragging: { pointer: number; startY: number; startHeight: number } | null = null;
  /** Where the pen last came to rest, and the timer that snaps the stroke if it stays. */
  private holdAt: { x: number; y: number } | null = null;
  private holdTimer = 0;
  /** The shape the held stroke became: drawn and kept instead of the ink. */
  private snapped: ShapeResult | null = null;
  /** Words a search found here, each its strokes' ids. */
  private hits: string[][] | null = null;
  /** The answer a handwritten sum shows after its "=" (`note-ink-maths.ts`). */
  private answer: { el: HTMLElement; spec: InkAnswer } | null = null;

  constructor(
    block: InkBlock,
    private readonly host: InkSectionHost,
  ) {
    this.block = block;
    this.liveHeight = block.height;
    this.el = createDiv({
      cls: "finenotes-note-ink",
      attr: { contenteditable: "false", "data-fn-id": block.id, "data-fn-island": "ink" },
    });
    this.dry = this.el.createEl("canvas", { cls: "finenotes-note-ink-layer" });
    this.wet = this.el.createEl("canvas", { cls: "finenotes-note-ink-layer is-wet" });
    this.edge = this.el.createDiv({ cls: "finenotes-note-ink-edge" });
    this.edge.createDiv({ cls: "finenotes-note-ink-grip" });
    this.applyHeight(block.height);
    this.showPaper();

    this.el.addEventListener("pointerdown", this.onDown);
    this.el.addEventListener("pointermove", this.onMove);
    this.el.addEventListener("pointerup", this.onUp);
    this.el.addEventListener("pointercancel", this.onUp);
    this.el.addEventListener("pointerover", this.onHover);
    this.el.addEventListener("pointerleave", this.onLeave);
    this.el.addEventListener("touchstart", this.onTouch, { passive: false });
    this.el.addEventListener("touchmove", this.onTouch, { passive: false });
    this.edge.addEventListener("pointerdown", this.onEdgeDown);
    this.edge.addEventListener("pointermove", this.onEdgeMove);
    this.edge.addEventListener("pointerup", this.onEdgeUp);
    this.edge.addEventListener("pointercancel", this.onEdgeUp);

    this.observer = new ResizeObserver(() => this.layout());
    this.observer.observe(this.el);
  }

  get id(): string {
    return this.block.id;
  }

  /** Whether a stroke, an erase or a resize is under way here. */
  get busy(): boolean {
    return this.pointer !== null || this.dragging !== null;
  }

  destroy(): void {
    this.observer.disconnect();
    this.el.win.clearTimeout(this.holdTimer);
    this.el.win.cancelAnimationFrame(this.frame);
    if (this.pointer !== null) this.host.penDown(false);
    // iOS holds a canvas's memory until its size is given back.
    for (const canvas of [this.dry, this.wet]) {
      canvas.width = 0;
      canvas.height = 0;
    }
    this.el.remove();
  }

  /** Show `next`. A stroke added to what is shown is painted alone; anything else repaints. */
  setBlock(next: InkBlock): void {
    const previous = this.block;
    this.block = next;
    this.el.toggleClass("is-empty", next.strokes.length === 0);
    this.showPaper();
    if (this.busy) return;
    const appended =
      next.height === previous.height &&
      next.height === this.liveHeight &&
      next.strokes.length === previous.strokes.length + 1 &&
      previous.strokes.every((stroke, i) => stroke === next.strokes[i]);
    if (appended) {
      const stroke = next.strokes[next.strokes.length - 1];
      // A highlight belongs under the pen's ink, so it cannot simply go on top.
      if (stroke.tool !== "highlighter") {
        const ctx = this.context(this.dry);
        if (ctx) this.paintStroke(ctx, stroke);
        return;
      }
    }
    if (next.height !== this.liveHeight) this.applyHeight(next.height);
    this.layout(true);
  }

  /** A section with paper of its own shows no other pattern behind it. */
  private showPaper(): void {
    const paper = this.block.paper;
    if (paper && paper !== "blank") this.el.dataset.paper = paper;
    else delete this.el.dataset.paper;
  }

  /** The theme or a pen setting changed: draw everything again. */
  redraw(): void {
    this.paintDry();
  }

  /**
   * Light up words a search found, each a group of stroke ids, as a
   * notebook lights them: a highlighter's tint under the ink. `null` clears.
   */
  /** Show the answer a handwritten sum works out to after its "=", or with null take it away. */
  showAnswer(spec: InkAnswer | null): void {
    this.answer?.el.remove();
    this.answer = null;
    if (!spec) return;
    const el = this.el.createEl("button", {
      cls: "finenotes-note-ink-answer clickable-icon",
      text: spec.label,
      attr: { type: "button", "data-ignore-swipe": "true" },
    });
    // The pen's own: a press here writes the answer, never a stroke under it.
    el.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      event.preventDefault();
    });
    el.addEventListener("pointerup", (event) => {
      event.stopPropagation();
      swallowGhostClick(el.doc, event);
      spec.write();
    });
    el.addEventListener("click", (event) => {
      // Keyboard only: a pointer acted on its pointerup (a Pencil tap makes no click).
      if (event.detail === 0) spec.write();
    });
    this.answer = { el, spec };
    this.placeAnswer();
  }

  private placeAnswer(): void {
    const answer = this.answer;
    if (!answer) return;
    const { x, baseline, height } = answer.spec;
    const s = this.scale;
    answer.el.setCssProps({
      "--fn-answer-x": `${x * s}px`,
      "--fn-answer-y": `${(baseline - height) * s}px`,
      "--fn-answer-h": `${Math.max(20, height * s)}px`,
    });
  }

  setHits(groups: readonly (readonly string[])[] | null): void {
    const next = groups && groups.length > 0 ? groups.map((g) => [...g]) : null;
    if (!next && !this.hits) return;
    this.hits = next;
    this.paintDry();
  }

  /** The search hits' boxes, under everything else. */
  private paintHits(ctx: CanvasRenderingContext2D): void {
    if (!this.hits) return;
    const byId = new Map(this.block.strokes.map((s) => [s.id, s]));
    // A canvas cannot read a CSS variable: resolve it first (ledger, 2026-09-20).
    const color =
      this.el.win.getComputedStyle(this.el).getPropertyValue("--text-highlight-bg").trim() ||
      "rgba(255, 208, 0, 0.4)";
    ctx.fillStyle = color;
    for (const group of this.hits) {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const id of group) {
        const stroke = byId.get(id);
        if (!stroke) continue;
        const pad = stroke.size / 2;
        const usable = stroke.pts.length - (stroke.pts.length % 3);
        for (let i = 0; i < usable; i += 3) {
          x0 = Math.min(x0, stroke.pts[i] - pad);
          x1 = Math.max(x1, stroke.pts[i] + pad);
          y0 = Math.min(y0, stroke.pts[i + 1] - pad);
          y1 = Math.max(y1, stroke.pts[i + 1] + pad);
        }
      }
      if (!Number.isFinite(x0)) continue;
      const margin = 4;
      ctx.beginPath();
      ctx.roundRect(x0 - margin, y0 - margin, x1 - x0 + 2 * margin, y1 - y0 + 2 * margin, 6);
      ctx.fill();
    }
  }

  /**
   * Start a stroke from a press that landed outside the section (the empty
   * space under the note, which the section has just grown into).
   */
  beginStroke(event: PointerEvent): void {
    this.layout();
    this.start(event);
  }

  // -------------------------------------------------------------- layout

  private applyHeight(height: number): void {
    this.liveHeight = height;
    this.el.setCssProps({ "--fn-ink-ratio": `${INK_WIDTH} / ${height}` });
  }

  /** Size the canvases to the section as it is laid out now, and repaint if they changed. */
  private layout(force = false): void {
    const width = this.el.clientWidth;
    if (width <= 0) return;
    const scale = width / INK_WIDTH;
    const ratio = Math.min(MAX_PIXEL_RATIO, this.el.win.devicePixelRatio || 1);
    const pxWidth = Math.round(width * ratio);
    const pxHeight = Math.round(this.liveHeight * scale * ratio);
    const same = this.dry.width === pxWidth && this.dry.height === pxHeight;
    this.scale = scale;
    this.ratio = ratio;
    this.placeAnswer();
    if (same && !force) return;
    for (const canvas of [this.dry, this.wet]) {
      if (canvas.width !== pxWidth) canvas.width = pxWidth;
      if (canvas.height !== pxHeight) canvas.height = pxHeight;
      canvas.setCssProps({
        "--fn-layer-w": `${pxWidth / ratio}px`,
        "--fn-layer-h": `${pxHeight / ratio}px`,
      });
    }
    this.paintDry();
    if (this.pointer !== null) this.paintWet();
  }

  /** A canvas's context, set to draw in section units. */
  private context(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const k = this.scale * this.ratio;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.globalAlpha = 1;
    return ctx;
  }

  private wipe(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return this.context(canvas);
  }

  // -------------------------------------------------------------- painting

  private paintStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
    const highlighter = stroke.tool === "highlighter";
    const pen = penFor({
      size: stroke.size,
      tool: stroke.tool,
      usePressure: this.host.pressure(),
      ...(stroke.nib !== undefined ? { nib: stroke.nib } : {}),
      ...(stroke.tip !== undefined ? { tip: stroke.tip } : {}),
    });
    const runs = inkRuns(stroke.pts, pen, stroke.shape !== undefined, stroke.tilt);
    if (runs.length === 0) return;
    const dark = this.host.dark();
    ctx.globalAlpha = highlighter ? this.host.highlighterAlpha() : 1;
    // A highlight is a tint laid over the note, light or dark; the pen's ink turns with the theme.
    ctx.fillStyle = dark && !highlighter ? nightColor(stroke.color) : stroke.color;
    paintInk(ctx, runs);
    ctx.globalAlpha = 1;
  }

  /** The section's paper: its rules, in the notebook's colours for the theme. */
  private paintPaper(ctx: CanvasRenderingContext2D): void {
    const paper = this.block.paper;
    if (!paper || paper === "blank") return;
    drawSyntheticRules(
      ctx,
      { kind: paper },
      { width: INK_WIDTH, height: this.liveHeight },
      paperTheme(this.host.dark()),
    );
  }

  private paintDry(): void {
    const ctx = this.wipe(this.dry);
    if (!ctx) return;
    this.paintPaper(ctx);
    this.paintHits(ctx);
    const strokes = this.erased ?? this.block.strokes;
    // Highlights first: they sit under the writing, which stays crisp.
    for (const stroke of strokes) if (stroke.tool === "highlighter") this.paintStroke(ctx, stroke);
    for (const stroke of strokes) if (stroke.tool !== "highlighter") this.paintStroke(ctx, stroke);
  }

  private paintWet(): void {
    const ctx = this.wipe(this.wet);
    if (!ctx) return;
    if (this.eraserAt) {
      const radius = this.eraserRadius();
      ctx.beginPath();
      ctx.arc(this.eraserAt.x, this.eraserAt.y, radius, 0, Math.PI * 2);
      ctx.lineWidth = 1 / this.scale;
      ctx.strokeStyle = this.host.dark() ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.45)";
      ctx.fillStyle = this.host.dark() ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.06)";
      ctx.fill();
      ctx.stroke();
      return;
    }
    const builder = this.builder;
    const pen = this.pen;
    if (!builder || !pen || pen.tool === "eraser") return;
    if (this.snapped) {
      this.paintStroke(ctx, {
        id: "",
        color: pen.color,
        size: pen.size,
        tool: pen.tool,
        pts: this.snapped.pts,
        shape: this.snapped.kind,
        ...styleOfShape(this.snapped),
      });
      return;
    }
    // The points kept, then the few still waiting to settle: drawn as the stroke will be kept.
    const pts = builder.view.slice();
    for (const point of builder.tail) pts.push(point[0], point[1], point[2]);
    this.paintStroke(ctx, { id: "", color: pen.color, size: pen.size, tool: pen.tool, pts });
  }

  private requestWet(): void {
    if (this.frame) return;
    this.frame = this.el.win.requestAnimationFrame(() => {
      this.frame = 0;
      if (this.erased) this.paintDry();
      this.paintWet();
    });
  }

  // -------------------------------------------------------------- input

  private local(event: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = this.el.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / this.scale,
      y: (event.clientY - rect.top) / this.scale,
    };
  }

  private readonly onHover = (event: PointerEvent): void => {
    if (event.pointerType === "pen") this.el.addClass("is-pen-near");
  };

  private readonly onLeave = (event: PointerEvent): void => {
    if (event.pointerType === "pen" && this.pointer === null) this.el.removeClass("is-pen-near");
  };

  private readonly onTouch = (event: TouchEvent): void => {
    // A stylus's touch never pans the note; a finger's does, unless fingers write.
    const stylus = touchIsStylus(event) || this.lastDownType === "pen";
    if (stylus || this.pointer !== null || (this.host.drawing() && this.host.fingerDraws())) {
      if (event.cancelable) event.preventDefault();
    }
  };

  private readonly onDown = (event: PointerEvent): void => {
    this.lastDownType = event.pointerType;
    if (this.busy || event.target === this.edge || this.edge.contains(event.target as Node)) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const pen = event.pointerType === "pen";
    if (event.pointerType === "touch" && !(this.host.drawing() && this.host.fingerDraws())) return;
    if (!this.host.drawing()) {
      if (!pen) return;
      this.host.penArrived();
    }
    event.preventDefault();
    event.stopPropagation();
    this.start(event);
  };

  private start(event: PointerEvent): void {
    this.pointer = event.pointerId;
    try {
      this.el.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that is already gone (or a synthetic one) cannot be captured.
    }
    this.host.touched(this.block.id);
    this.host.penDown(true);
    const pen = { ...this.host.pen() };
    // The other end of a pen that has one erases, whatever tool is picked.
    if ((event.buttons & 32) !== 0) {
      pen.tool = "eraser";
      pen.size = this.host.eraserSize();
    }
    this.pen = pen;
    const at = this.local(event);
    if (pen.tool === "eraser") {
      this.erased = this.block.strokes.slice();
      this.eraseAt(at);
      this.requestWet();
      return;
    }
    const isPen = event.pointerType === "pen";
    const ratio = this.el.win.devicePixelRatio || 1;
    if (isPen && !isOnDevicePixel(event, ratio)) penIsPrecise = true;
    const pressure = this.host.pressure() && pen.tool === "pen";
    this.builder = new StrokeBuilder({
      minDistance: MIN_SAMPLE_DISTANCE / this.scale,
      pressureEnabled: pressure,
      fallbackPressure: FALLBACK_PRESSURE,
      densify: isPen && !deliversCoalescedSamples(),
      smoothing: isPen && !penIsPrecise ? "centred" : "off",
    });
    this.builder.add({ ...at, pressure: event.pressure, t: event.timeStamp });
    this.snapped = null;
    this.holdAt = null;
    if (pen.tool === "pen") this.trackHold(at);
    this.requestWet();
  }

  /** "Nothing moved for a while" is a timer: a pen held still sends no events at all. */
  private trackHold(at: { x: number; y: number }): void {
    if (this.pen?.tool !== "pen") return;
    const radius = HOLD_RADIUS_PX / this.scale;
    if (this.holdAt && Math.hypot(at.x - this.holdAt.x, at.y - this.holdAt.y) <= radius) return;
    this.holdAt = at;
    const win = this.el.win;
    win.clearTimeout(this.holdTimer);
    this.holdTimer = win.setTimeout(() => this.snapHeld(), HOLD_MS);
  }

  private snapHeld(): void {
    const builder = this.builder;
    if (this.pointer === null || !builder || this.snapped) return;
    const pts = builder.points();
    if (pts.length < 6) return;
    // The recogniser's lengths were tuned where a page px is a screen px.
    const shape = recognizeAtZoom(pts, this.scale, { held: true });
    if (!shape) return;
    this.snapped = shape;
    this.requestWet();
  }

  private readonly onMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointer) return;
    event.preventDefault();
    const coalesced =
      typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
    const samples = coalesced.length > 0 ? coalesced : [event];
    const ratio = this.el.win.devicePixelRatio || 1;
    let lowest = 0;
    for (const sample of samples) {
      const at = this.local(sample);
      lowest = Math.max(lowest, at.y);
      if (this.erased) {
        this.eraseAt(at);
        continue;
      }
      if (event.pointerType === "pen" && !isOnDevicePixel(sample, ratio)) penIsPrecise = true;
      if (this.snapped) continue;
      this.builder?.add({ ...at, pressure: sample.pressure, t: sample.timeStamp });
      this.trackHold(at);
    }
    // Writing that reaches the foot gets more paper under it at once, not on lifting.
    if (!this.erased && lowest > this.liveHeight - INK_GROW_MARGIN / 2) {
      const grown = clampInkHeight(lowest + INK_GROW_ROOM);
      if (grown > this.liveHeight) {
        this.applyHeight(grown);
        this.layout(true);
      }
    }
    this.requestWet();
  };

  private readonly onUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.pointer) return;
    this.pointer = null;
    this.el.win.clearTimeout(this.holdTimer);
    this.holdAt = null;
    const snapped = this.snapped;
    this.snapped = null;
    this.host.penDown(false);
    if (event.pointerType !== "pen") this.el.removeClass("is-pen-near");
    const height = this.liveHeight;
    let next: InkBlock | null = null;
    let drawn = false;
    if (this.erased) {
      const strokes = this.erased;
      const changed =
        strokes.length !== this.block.strokes.length ||
        strokes.some((stroke, i) => stroke !== this.block.strokes[i]);
      if (changed) next = { ...this.block, strokes, height };
    } else if (snapped && this.pen) {
      const stroke: Stroke = {
        id: this.host.newStrokeId(),
        color: this.pen.color,
        size: this.pen.size,
        tool: "pen",
        pts: snapped.pts,
        shape: snapped.kind,
        ...styleOfShape(snapped),
      };
      next = {
        ...this.block,
        strokes: [...this.block.strokes, stroke],
        height: grownHeight(height, inkBottom([stroke])),
      };
    } else if (this.builder && this.pen) {
      // A pen that the system took away mid-stroke still wrote what it wrote.
      if (event.type === "pointerup") {
        this.builder.addFinal({
          ...this.local(event),
          pressure: event.pressure,
          t: event.timeStamp,
        });
      }
      const pts = this.builder.points();
      if (pts.length >= 3) {
        const stroke: Stroke = {
          id: this.host.newStrokeId(),
          color: this.pen.color,
          size: this.pen.size,
          tool: this.pen.tool === "highlighter" ? "highlighter" : "pen",
          pts,
        };
        drawn = stroke.tool === "pen";
        next = {
          ...this.block,
          strokes: [...this.block.strokes, stroke],
          height: grownHeight(height, inkBottom([stroke])),
        };
      }
    }
    this.builder = null;
    this.pen = null;
    this.erased = null;
    this.eraserAt = null;
    this.wipe(this.wet);
    if (next) {
      // Painted before the wet layer's stroke is missed: the commit comes straight back here.
      this.liveHeight = height;
      this.host.commit(this.block.id, next);
      if (drawn) this.host.strokeDrawn?.(this.block.id);
    } else if (height !== this.block.height) {
      this.host.commit(this.block.id, { ...this.block, height });
    } else {
      this.paintDry();
    }
  };

  /** The eraser's radius in section units: its size is CSS px, the same on screen at any width. */
  private eraserRadius(): number {
    const px = this.pen?.tool === "eraser" ? this.pen.size : this.host.pen().size;
    return Math.max(2, px) / this.scale;
  }

  private eraseAt(at: { x: number; y: number }): void {
    this.eraserAt = at;
    const strokes = this.erased;
    if (!strokes) return;
    const radius = this.eraserRadius();
    const out: Stroke[] = [];
    let changed = false;
    for (const stroke of strokes) {
      const pieces = eraseCircleFromStroke(stroke, at.x, at.y, radius, () =>
        this.host.newStrokeId(),
      );
      if (pieces === null) out.push(stroke);
      else {
        out.push(...pieces);
        changed = true;
      }
    }
    if (changed) this.erased = out;
  }

  // -------------------------------------------------------------- the foot

  private readonly onEdgeDown = (event: PointerEvent): void => {
    if (this.busy) return;
    event.preventDefault();
    event.stopPropagation();
    this.dragging = {
      pointer: event.pointerId,
      startY: event.clientY,
      startHeight: this.liveHeight,
    };
    try {
      this.edge.setPointerCapture(event.pointerId);
    } catch {
      // As above.
    }
    this.host.touched(this.block.id);
    this.el.addClass("is-resizing");
  };

  private readonly onEdgeMove = (event: PointerEvent): void => {
    const drag = this.dragging;
    if (!drag || event.pointerId !== drag.pointer) return;
    event.preventDefault();
    const least = Math.max(INK_MIN_HEIGHT, inkBottom(this.block.strokes) + RESIZE_ROOM);
    const wanted = drag.startHeight + (event.clientY - drag.startY) / this.scale;
    this.applyHeight(clampInkHeight(Math.max(least, wanted)));
  };

  private readonly onEdgeUp = (event: PointerEvent): void => {
    const drag = this.dragging;
    if (!drag || event.pointerId !== drag.pointer) return;
    this.dragging = null;
    this.el.removeClass("is-resizing");
    if (this.liveHeight !== this.block.height) {
      this.host.commit(this.block.id, { ...this.block, height: this.liveHeight }, true);
    }
    this.layout(true);
  };
}
