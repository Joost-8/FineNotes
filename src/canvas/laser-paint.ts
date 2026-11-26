/**
 * Renders a {@link LaserFrame} with:
 * 1. A silky-smooth, consistent-size neon glow painted on a half-resolution
 *    offscreen canvas in ONE batched path per frame (1 Gaussian blur per width
 *    bucket instead of one per calligraphy/pressure segment -> stays fast on
 *    iPad, with a steady halo that never flickers with nib angle).
 * 2. A crisp, full-Retina white-hot core painted ON TOP of all glows using
 *    FineNotes' own `inkRuns` / `traceRun` engine (cached per stroke buffer) so
 *    every pen type renders 1:1 with zero duplicated pen math, and crossing
 *    strokes fuse seamlessly like interconnected neon tubes.
 * 3. Zero redundant repaints during stationary Sustain hold/fade: the caller
 *    fades the painted overlay canvas via GPU CSS `opacity`.
 */

import { type InkRun, inkRuns, radiusAt, traceRun } from "../ink/freehand";
import {
  LASER_GLOW_PX,
  LASER_WIDTH_PX,
  type LaserFrame,
  type LaserPoint,
  type LaserStroke,
  fade,
} from "./laser-trail";

export interface LaserPaintOptions {
  color: string;
  ratio: number;
  scale: number;
  offsetX: number;
  scrollY: number;
  cssW: number;
  cssH: number;
}

/** Offscreen half-resolution scale for the Gaussian neon glow (1/16th Retina pixels). */
const GLOW_SCALE = 0.5;
/** Number of smooth opacity buckets for continuous-fade (non-sustain) mode. */
const FADE_BUCKETS = 12;

interface PreparedStroke {
  stroke: LaserStroke;
  runs: readonly InkRun[] | null;
}

interface CachedRuns {
  flat: readonly number[];
  tilts: readonly number[] | undefined;
  runs: readonly InkRun[];
}

/** Stateful painter holding one reusable half-res offscreen glow canvas and run cache. */
export class LaserPainter {
  private glowCanvas: HTMLCanvasElement | null = null;
  private glowDoc: Document | null = null;
  private lastPaintKey = "";
  private readonly runCache = new WeakMap<LaserStroke, CachedRuns>();

  /** Drops cached frame key and offscreen glow canvas (e.g. on clear, swap, or window move). */
  reset(): void {
    this.lastPaintKey = "";
    this.glowCanvas = null;
    this.glowDoc = null;
  }

  /** Clears the overlay canvas pixels, inline opacity, and internal painter caches. */
  clear(canvas: HTMLCanvasElement): void {
    this.reset();
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    canvas.setCssStyles({ opacity: "" });
  }

  paint(ctx: CanvasRenderingContext2D, frame: LaserFrame, opts: LaserPaintOptions): void {
    const { strokes, alpha, tip, sustain } = frame;
    if (!(alpha > 0) || strokes.length === 0) {
      if (this.lastPaintKey !== "") {
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        this.lastPaintKey = "";
      }
      return;
    }

    if (sustain) {
      const key = `${frame.version}|${opts.color}|${opts.ratio}|${opts.scale}|${opts.offsetX}|${opts.scrollY}|${opts.cssW}|${opts.cssH}`;
      if (key === this.lastPaintKey) return;
      this.lastPaintKey = key;
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      const glow = this.ensureGlowCanvas(ctx.canvas, opts.cssW, opts.cssH);
      const gctx = glow?.getContext("2d") ?? null;
      const prepared = strokes.map((stroke) => ({ stroke, runs: this.runsOf(stroke) }));
      this.paintUnified(ctx, gctx, glow, prepared, tip, opts);
      return;
    }

    this.lastPaintKey = "";
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    const glow = this.ensureGlowCanvas(ctx.canvas, opts.cssW, opts.cssH);
    const gctx = glow?.getContext("2d") ?? null;
    this.paintContinuous(ctx, gctx, glow, strokes, tip, frame.now, opts);
  }

  private runsOf(stroke: LaserStroke): readonly InkRun[] | null {
    if (!stroke.pen || !stroke.flat || stroke.flat.length < 3) return null;
    const cached = this.runCache.get(stroke);
    if (cached && cached.flat === stroke.flat && cached.tilts === stroke.tilts) {
      return cached.runs;
    }
    const runs = inkRuns(stroke.flat, stroke.pen, false, stroke.tilts);
    this.runCache.set(stroke, { flat: stroke.flat, tilts: stroke.tilts, runs });
    return runs;
  }

  /**
   * Sustain mode: ALL glows painted in one batched path at a consistent halo
   * size on the half-res canvas, then ALL crisp Retina white cores at full
   * opacity (1.0) on top.
   */
  private paintUnified(
    ctx: CanvasRenderingContext2D,
    gctx: CanvasRenderingContext2D | null,
    glow: HTMLCanvasElement | null,
    prepared: readonly PreparedStroke[],
    tip: LaserFrame["tip"],
    opts: LaserPaintOptions,
  ): void {
    const { color, ratio, scale, offsetX, scrollY } = opts;

    if (gctx && glow) {
      gctx.clearRect(0, 0, glow.width, glow.height);
      gctx.save();
      gctx.lineCap = "round";
      gctx.lineJoin = "round";
      gctx.strokeStyle = color;
      gctx.fillStyle = color;
      gctx.shadowColor = color;
      const gx = (x: number): number => (x * scale + offsetX) * GLOW_SCALE;
      const gy = (y: number): number => (y - scrollY) * scale * GLOW_SCALE;

      const byHalo = new Map<number, LaserPoint[][]>();
      for (const { stroke } of prepared) {
        const haloW = Math.round(consistentHaloWidthPx(stroke, scale) * GLOW_SCALE * 2) / 2;
        let list = byHalo.get(haloW);
        if (!list) {
          list = [];
          byHalo.set(haloW, list);
        }
        list.push(stroke.points);
      }

      for (const [blurPx, minExtraPx, ratioExtra, passAlpha] of [
        [LASER_GLOW_PX, 5.5, 0.28, 0.72],
        [5.5, 3.2, 0.16, 0.92],
      ] as const) {
        gctx.globalAlpha = passAlpha;
        gctx.shadowBlur = blurPx * GLOW_SCALE;
        for (const [haloW, runs] of byHalo) {
          const extra = Math.max(minExtraPx * GLOW_SCALE, haloW * ratioExtra);
          gctx.lineWidth = Math.max(1, haloW + extra);
          strokeSmoothBatch(gctx, runs, gx, gy);
        }
        if (tip) {
          this.drawTip(
            gctx,
            tip,
            scale * GLOW_SCALE,
            GLOW_SCALE,
            minExtraPx * 0.5 * GLOW_SCALE,
            gx,
            gy,
          );
        }
      }
      gctx.restore();
      blitGlow(ctx, glow);
    }

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#ffffff";
    ctx.fillStyle = "#ffffff";
    const sx = (x: number): number => (x * scale + offsetX) * ratio;
    const sy = (y: number): number => (y - scrollY) * scale * ratio;
    for (const item of prepared) {
      this.drawCore(ctx, item, scale * ratio, ratio, sx, sy);
    }
    if (tip) this.drawTip(ctx, tip, scale * ratio, ratio, 0, sx, sy);
    ctx.restore();
  }

  /**
   * Continuous-fade mode (sustain OFF): bucket points by age so each fade step
   * strokes with flush `butt` caps (zero seam dots), preserving Brush tilt.
   */
  private paintContinuous(
    ctx: CanvasRenderingContext2D,
    gctx: CanvasRenderingContext2D | null,
    glow: HTMLCanvasElement | null,
    strokes: readonly LaserStroke[],
    tip: LaserFrame["tip"],
    nowMs: number,
    opts: LaserPaintOptions,
  ): void {
    const { color, ratio, scale, offsetX, scrollY } = opts;
    const buckets = new Map<number, Array<{ stroke: LaserStroke; pts: LaserPoint[] }>>();

    for (const stroke of strokes) {
      const pts = stroke.points;
      if (pts.length < 2) continue;
      let run: LaserPoint[] = [pts[0]];
      let runStep = bucketOf(fade(nowMs - pts[1].t));
      for (let i = 1; i < pts.length; i++) {
        const step = bucketOf(fade(nowMs - pts[i].t));
        if (step !== runStep) {
          if (runStep > 0 && run.length >= 2) pushBucket(buckets, runStep, stroke, run);
          run = [pts[i - 1], pts[i]];
          runStep = step;
        } else {
          run.push(pts[i]);
        }
      }
      if (runStep > 0 && run.length >= 2) pushBucket(buckets, runStep, stroke, run);
    }

    const ordered = [...buckets.entries()].sort(([a], [b]) => a - b);

    if (gctx && glow) {
      gctx.clearRect(0, 0, glow.width, glow.height);
      gctx.save();
      gctx.lineCap = "butt";
      gctx.lineJoin = "round";
      gctx.strokeStyle = color;
      gctx.fillStyle = color;
      const gx = (x: number): number => (x * scale + offsetX) * GLOW_SCALE;
      const gy = (y: number): number => (y - scrollY) * scale * GLOW_SCALE;

      for (const [extraPx, passStrength] of [
        [16, 0.22],
        [7.5, 0.55],
      ] as const) {
        for (const [step, items] of ordered) {
          gctx.globalAlpha = (step / FADE_BUCKETS) * passStrength;
          for (const { stroke, pts } of items) {
            const haloW = consistentHaloWidthPx(stroke, scale);
            gctx.lineWidth = Math.max(1, (haloW + extraPx) * GLOW_SCALE);
            strokeSmoothBatch(gctx, [pts], gx, gy);
          }
        }
      }
      if (tip) {
        const tipAlpha = fade(nowMs - tip.point.t);
        if (tipAlpha > 0) {
          gctx.globalAlpha = tipAlpha * 0.25;
          this.drawTip(gctx, tip, scale * GLOW_SCALE, GLOW_SCALE, 8 * GLOW_SCALE, gx, gy);
          gctx.globalAlpha = tipAlpha * 0.6;
          this.drawTip(gctx, tip, scale * GLOW_SCALE, GLOW_SCALE, 3.5 * GLOW_SCALE, gx, gy);
        }
      }
      gctx.restore();
      blitGlow(ctx, glow);
    }

    ctx.save();
    ctx.lineCap = "butt";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#ffffff";
    ctx.fillStyle = "#ffffff";
    const sx = (x: number): number => (x * scale + offsetX) * ratio;
    const sy = (y: number): number => (y - scrollY) * scale * ratio;

    for (const [step, items] of ordered) {
      ctx.globalAlpha = (step / FADE_BUCKETS) * 0.96;
      for (const { stroke, pts } of items) {
        const item = this.sliceForPts(stroke, pts);
        this.drawCore(ctx, item, scale * ratio, ratio, sx, sy);
      }
    }
    if (tip) {
      const tipAlpha = fade(nowMs - tip.point.t);
      if (tipAlpha > 0) {
        ctx.globalAlpha = tipAlpha * 0.96;
        this.drawTip(ctx, tip, scale * ratio, ratio, 0, sx, sy);
      }
    }
    ctx.restore();
  }

  private sliceForPts(stroke: LaserStroke, pts: LaserPoint[]): PreparedStroke {
    if (!stroke.pen) return { stroke: { ...stroke, points: pts }, runs: null };
    const flat: number[] = [];
    const hasTilt = stroke.tilts !== undefined;
    const tilts: number[] | undefined = hasTilt ? [] : undefined;
    for (const pt of pts) {
      flat.push(pt.x, pt.y, pt.p ?? 0.5);
      if (tilts) tilts.push(pt.a ?? Number.NaN);
    }
    return {
      stroke: { ...stroke, points: pts, flat, tilts },
      runs: inkRuns(flat, stroke.pen, false, tilts),
    };
  }

  private drawCore(
    ctx: CanvasRenderingContext2D,
    item: PreparedStroke,
    pxPerLayout: number,
    targetRatio: number,
    sx: (x: number) => number,
    sy: (y: number) => number,
  ): void {
    const { stroke, runs } = item;
    if (runs && runs.length > 0) {
      for (const run of runs) {
        this.drawInkRun(ctx, run, pxPerLayout, sx, sy);
      }
      return;
    }
    const w = stroke.pen
      ? Math.max(0.5, stroke.pen.size * pxPerLayout)
      : LASER_WIDTH_PX * targetRatio;
    ctx.lineWidth = Math.max(0.5, w);
    strokeSmoothBatch(ctx, [stroke.points], sx, sy);
  }

  private drawInkRun(
    ctx: CanvasRenderingContext2D,
    run: InkRun,
    pxPerLayout: number,
    sx: (x: number) => number,
    sy: (y: number) => number,
  ): void {
    const scaledPts = new Array<number>(run.pts.length);
    for (let i = 0; i + 1 < run.pts.length; i += 2) {
      scaledPts[i] = sx(run.pts[i]);
      scaledPts[i + 1] = sy(run.pts[i + 1]);
    }
    const scaledRun: InkRun = {
      ...run,
      width: run.width * pxPerLayout,
      pts: scaledPts,
    };
    ctx.beginPath();
    traceRun(ctx, scaledRun);
    if (scaledRun.chisel) {
      ctx.fill();
    } else {
      ctx.lineWidth = Math.max(0.5, scaledRun.width);
      ctx.stroke();
    }
  }

  private drawTip(
    ctx: CanvasRenderingContext2D,
    tip: NonNullable<LaserFrame["tip"]>,
    pxPerLayout: number,
    targetRatio: number,
    extraRadiusPx: number,
    sx: (x: number) => number,
    sy: (y: number) => number,
  ): void {
    const r = tip.pen
      ? radiusAt(tip.point.p ?? 0.5, tip.pen) * pxPerLayout + extraRadiusPx
      : LASER_WIDTH_PX * 0.5 * targetRatio + extraRadiusPx;
    ctx.beginPath();
    ctx.arc(sx(tip.point.x), sy(tip.point.y), Math.max(0.5, r), 0, Math.PI * 2);
    ctx.fill();
  }

  private ensureGlowCanvas(
    main: HTMLCanvasElement,
    cssW: number,
    cssH: number,
  ): HTMLCanvasElement | null {
    const w = Math.max(1, Math.round(cssW * GLOW_SCALE));
    const h = Math.max(1, Math.round(cssH * GLOW_SCALE));
    const doc = main.ownerDocument;
    if (!doc) return null;
    if (!this.glowCanvas || this.glowDoc !== doc) {
      const make = (doc as Document & { win?: { createEl?: typeof createEl } }).win?.createEl;
      this.glowCanvas =
        typeof make === "function"
          ? make("canvas")
          : typeof createEl === "function"
            ? createEl("canvas")
            : null;
      this.glowDoc = this.glowCanvas ? doc : null;
    }
    if (!this.glowCanvas) return null;
    if (this.glowCanvas.width !== w || this.glowCanvas.height !== h) {
      this.glowCanvas.width = w;
      this.glowCanvas.height = h;
    }
    return this.glowCanvas;
  }
}

function blitGlow(ctx: CanvasRenderingContext2D, glow: HTMLCanvasElement): void {
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.globalAlpha = 1;
  ctx.drawImage(glow, 0, 0, glow.width, glow.height, 0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}

/**
 * Consistent halo width (CSS px) for a stroke: steady across nib angles and
 * pressure changes so the glow never flickers or slows down on iPad.
 */
function consistentHaloWidthPx(stroke: LaserStroke, scale: number): number {
  if (!stroke.pen) return LASER_WIDTH_PX;
  const nominal = stroke.pen.thinning > 0 ? stroke.pen.size * 1.15 : stroke.pen.size;
  return Math.max(LASER_WIDTH_PX, nominal * scale);
}

function bucketOf(alpha: number): number {
  if (!(alpha > 0)) return 0;
  return Math.min(FADE_BUCKETS, Math.max(1, Math.round(alpha * FADE_BUCKETS)));
}

function pushBucket(
  buckets: Map<number, Array<{ stroke: LaserStroke; pts: LaserPoint[] }>>,
  step: number,
  stroke: LaserStroke,
  pts: LaserPoint[],
): void {
  let list = buckets.get(step);
  if (!list) {
    list = [];
    buckets.set(step, list);
  }
  list.push({ stroke, pts });
}

/** Batched smooth quadratic-Bezier stroke for one or more runs in a single draw call. */
function strokeSmoothBatch(
  ctx: CanvasRenderingContext2D,
  runs: readonly (readonly LaserPoint[])[],
  sx: (x: number) => number,
  sy: (y: number) => number,
): void {
  ctx.beginPath();
  for (const run of runs) {
    const first = run[0];
    if (!first) continue;
    const x0 = sx(first.x);
    const y0 = sy(first.y);
    if (run.length === 1) {
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0 + 0.01, y0);
    } else if (run.length === 2) {
      ctx.moveTo(x0, y0);
      ctx.lineTo(sx(run[1].x), sy(run[1].y));
    } else {
      ctx.moveTo(x0, y0);
      for (let i = 1; i < run.length - 1; i++) {
        const cx = sx(run[i].x);
        const cy = sy(run[i].y);
        const mx = (cx + sx(run[i + 1].x)) * 0.5;
        const my = (cy + sy(run[i + 1].y)) * 0.5;
        ctx.quadraticCurveTo(cx, cy, mx, my);
      }
      const last = run[run.length - 1];
      ctx.lineTo(sx(last.x), sy(last.y));
    }
  }
  ctx.stroke();
}
