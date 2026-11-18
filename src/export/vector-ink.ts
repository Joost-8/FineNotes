/**
 * A page's ink as PDF vector paths, the way Goodnotes exports it: each run
 * of the tracer (`ink/freehand`) stroked with round caps and joins at its
 * own width, a chisel tip's run filled, a highlighter laid on translucent
 * and multiplied into the paper. What the canvas renderer paints for a
 * stored stroke (`fillStroke` → `paintStroke` in `canvas/renderer.ts`), in
 * the same order and with the same geometry, so a page exported this way
 * looks like the page in the app and stays sharp at any zoom.
 *
 * The output is content-stream operators in **page px with y down**; the
 * caller maps them onto the PDF page with one `cm`. Graphics states (alpha
 * and blend) and transparency groups are returned by name for the caller to
 * put in the page's resources.
 *
 * PURE: no DOM, no Obsidian, no pdf-lib.
 */

import { type InkRun, type PathSink, inkRuns, traceRun } from "../ink/freehand";
import { type ShapeDecor, penFor, styleOf } from "../canvas/stroke-style";
import { type OutlineOp, type Pt, dashPattern, shapeGeometry } from "../canvas/shape-decor";
import { type InkShade, nightColor, nightHighlighter, parseCssColor } from "../canvas/night";
import { splitFill } from "../model/shape-style";
import type { Stroke } from "../model/document";

/** How the page's ink is shown: the user's pressure setting, the highlighter's alpha, the page's look. */
export interface VectorInkOptions {
  usePressure: boolean;
  highlighterAlpha: number;
  /** `canvas/backdrop`'s `inkShade` of the page's look. */
  shade: InkShade;
}

/** A PDF blend mode the ink uses. */
export type InkBlend = "Normal" | "Multiply" | "Screen";

/** An ExtGState: constant alpha for strokes and fills, and a blend mode. */
export interface InkGraphicsState {
  alpha: number;
  blend: InkBlend;
}

/**
 * A translucent stroke traced as several runs (a tilted highlighter): its
 * runs are drawn opaque into a transparency group, which is laid down once
 * with the state's alpha and blend, so where two runs overlap the ink is not
 * laid down twice (as `paintOnce` does on the canvas).
 */
export interface InkGroup {
  /** The group's own operators, page px, y down, opaque. */
  ops: string;
  /** Its bounding box, page px: `[x0, y0, x1, y1]`. */
  bbox: [number, number, number, number];
}

export interface VectorInk {
  /** Content-stream operators, page px with y down. Empty when nothing is drawn. */
  ops: string;
  /** Graphics states the operators name (`/Gs0 gs`), by name. */
  states: Map<string, InkGraphicsState>;
  /** Transparency groups the operators draw (`/Ink0 Do`), by name. */
  groups: Map<string, InkGroup>;
}

/** RGB, 0–1, and an alpha. */
interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };

/** A number as a content stream writes it: two decimals at most, no exponent, no `-0`. */
export function pdfNumber(n: number): string {
  if (!Number.isFinite(n)) return "0";
  // Far past any page: clamped, so it never prints with an exponent.
  const r = Math.round(Math.max(-1e9, Math.min(1e9, n)) * 100) / 100;
  return r === 0 ? "0" : String(r);
}

/** Three decimals for colour channels and alphas. */
function unit(n: number): string {
  const r = Math.round(Math.max(0, Math.min(1, n)) * 1000) / 1000;
  return r === 0 ? "0" : String(r);
}

/** Writes path operators: the tracer's runs through {@link PathSink}, and shape outlines. */
class PathWriter implements PathSink {
  readonly parts: string[] = [];
  private x = 0;
  private y = 0;

  moveTo(x: number, y: number): void {
    this.parts.push(`${pdfNumber(x)} ${pdfNumber(y)} m`);
    this.x = x;
    this.y = y;
  }

  lineTo(x: number, y: number): void {
    this.parts.push(`${pdfNumber(x)} ${pdfNumber(y)} l`);
    this.x = x;
    this.y = y;
  }

  closePath(): void {
    this.parts.push("h");
  }

  /** The canvas's `arcTo` from the current point: a line to the first tangent point, then a cubic arc. */
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void {
    const v1 = unitVector(this.x - x1, this.y - y1);
    const v2 = unitVector(x2 - x1, y2 - y1);
    if (!v1 || !v2 || !(r > 0)) {
      this.lineTo(x1, y1);
      return;
    }
    const cos = Math.max(-1, Math.min(1, v1.x * v2.x + v1.y * v2.y));
    const theta = Math.acos(cos);
    // Collinear: the canvas draws a straight line to the corner point.
    if (theta < 1e-6 || Math.PI - theta < 1e-6) {
      this.lineTo(x1, y1);
      return;
    }
    const d = r / Math.tan(theta / 2);
    const t1 = { x: x1 + v1.x * d, y: y1 + v1.y * d };
    const t2 = { x: x1 + v2.x * d, y: y1 + v2.y * d };
    this.lineTo(t1.x, t1.y);
    // A circular arc of sweep φ = π − θ as one cubic: handles k·r long.
    const k = (4 / 3) * Math.tan((Math.PI - theta) / 4);
    const c1 = { x: t1.x - v1.x * k * r, y: t1.y - v1.y * k * r };
    const c2 = { x: t2.x - v2.x * k * r, y: t2.y - v2.y * k * r };
    this.parts.push(
      `${pdfNumber(c1.x)} ${pdfNumber(c1.y)} ${pdfNumber(c2.x)} ${pdfNumber(c2.y)} ` +
        `${pdfNumber(t2.x)} ${pdfNumber(t2.y)} c`,
    );
    this.x = t2.x;
    this.y = t2.y;
  }

  outline(ops: readonly OutlineOp[]): void {
    for (const o of ops) {
      if (o.op === "M") this.moveTo(o.x, o.y);
      else if (o.op === "L") this.lineTo(o.x, o.y);
      else if (o.op === "A") this.arcTo(o.x1, o.y1, o.x2, o.y2, o.r);
      else this.closePath();
    }
  }

  points(points: readonly Pt[]): void {
    points.forEach((p, i) => (i === 0 ? this.moveTo(p.x, p.y) : this.lineTo(p.x, p.y)));
  }

  take(): string {
    const out = this.parts.join("\n");
    this.parts.length = 0;
    return out;
  }
}

function unitVector(x: number, y: number): Pt | null {
  const len = Math.hypot(x, y);
  return len > 1e-9 ? { x: x / len, y: y / len } : null;
}

/**
 * Tracks what the stream has set (colour, width, dash), so each operator is
 * written only when it changes; `q`/`Q` save and restore it with the stream's.
 */
class StreamState {
  stroke = "";
  fill = "";
  width = Number.NaN;
  private readonly saved: Array<[string, string, number]> = [];

  save(out: string[]): void {
    out.push("q");
    this.saved.push([this.stroke, this.fill, this.width]);
  }

  restore(out: string[]): void {
    out.push("Q");
    const top = this.saved.pop();
    if (top) [this.stroke, this.fill, this.width] = top;
  }

  setStroke(out: string[], c: Rgba): void {
    const value = `${unit(c.r)} ${unit(c.g)} ${unit(c.b)} RG`;
    if (value !== this.stroke) out.push((this.stroke = value));
  }

  setFill(out: string[], c: Rgba): void {
    const value = `${unit(c.r)} ${unit(c.g)} ${unit(c.b)} rg`;
    if (value !== this.fill) out.push((this.fill = value));
  }

  setWidth(out: string[], w: number): void {
    const rounded = Math.round(w * 100) / 100;
    if (rounded !== this.width) {
      out.push(`${pdfNumber(rounded)} w`);
      this.width = rounded;
    }
  }
}

/** A CSS colour as RGBA; black when it cannot be read (as a canvas keeps its last valid style, black by default). */
function rgbaOf(color: string): Rgba {
  return parseCssColor(color) ?? BLACK;
}

/**
 * The page's ink, in paint order, as vector operators. `strokes` are those
 * the renderer paints in its ink pass: the caller leaves out a sticky note's
 * ink (drawn with its note) and the cover tapes (drawn over everything).
 */
export function vectorInk(strokes: readonly Stroke[], options: VectorInkOptions): VectorInk {
  const out: string[] = [];
  const states = new Map<string, InkGraphicsState>();
  const groups = new Map<string, InkGroup>();
  const state = new StreamState();
  const path = new PathWriter();
  const stateName = (alpha: number, blend: InkBlend): string => {
    const a = Math.round(Math.max(0, Math.min(1, alpha)) * 1000) / 1000;
    for (const [name, s] of states) if (s.alpha === a && s.blend === blend) return name;
    const name = `Gs${states.size}`;
    states.set(name, { alpha: a, blend });
    return name;
  };
  const night = options.shade === "night";
  const blendOf = (highlighter: boolean): InkBlend =>
    !highlighter ? "Normal" : options.shade === "day" ? "Multiply" : "Screen";

  // Round caps and joins for every run and shape (the canvas's `paintInk`, `paintShape`).
  out.push("1 J 1 j");
  for (const stroke of strokes) {
    if (stroke.tool === "tape") continue;
    const style = styleOf(stroke, options.usePressure);
    const runs = inkRuns(stroke.pts, penFor(style), style.shape === true, style.tilt);
    if (runs.length === 0) continue;
    const highlighter = style.tool === "highlighter";
    const shown =
      highlighter && options.shade !== "day"
        ? nightHighlighter(style.color)
        : night
          ? nightColor(style.color)
          : style.color;
    const color = rgbaOf(shown);
    const alpha = (highlighter ? options.highlighterAlpha : 1) * color.a;
    const blend = blendOf(highlighter);
    const translucent = alpha < 1 || blend !== "Normal";
    const decor = style.decor ?? null;

    if (decor) {
      state.save(out);
      if (translucent) out.push(`/${stateName(alpha, blend)} gs`);
      writeShape(
        out,
        state,
        path,
        stroke.pts,
        runs[0].width,
        decor,
        color,
        night,
        alpha,
        blend,
        stateName,
      );
      state.restore(out);
      continue;
    }
    if (translucent && runs.length > 1 && !highlighter) {
      // Opaque ink is laid down run by run on the canvas too: an alpha colour's overlaps darken there as here.
      state.save(out);
      out.push(`/${stateName(alpha, blend)} gs`);
      writeRuns(out, state, path, runs, color);
      state.restore(out);
      continue;
    }
    if (translucent && runs.length > 1) {
      // `paintOnce`: the runs opaque in a group, the group laid down once.
      const inner: string[] = ["1 J 1 j"];
      writeRuns(inner, new StreamState(), new PathWriter(), runs, color);
      const name = `Ink${groups.size}`;
      groups.set(name, { ops: inner.join("\n"), bbox: runsBox(runs) });
      state.save(out);
      out.push(`/${stateName(alpha, blend)} gs`, `/${name} Do`);
      state.restore(out);
      continue;
    }
    if (translucent) {
      state.save(out);
      out.push(`/${stateName(alpha, blend)} gs`);
      writeRuns(out, state, path, runs, color);
      state.restore(out);
      continue;
    }
    writeRuns(out, state, path, runs, color);
  }
  const ops = out.length > 1 ? out.join("\n") : "";
  return { ops, states, groups };
}

/** `paintInk`: each run stroked at its width, a chisel run filled. */
function writeRuns(
  out: string[],
  state: StreamState,
  path: PathWriter,
  runs: readonly InkRun[],
  color: Rgba,
): void {
  for (const run of runs) {
    traceRun(path, run);
    const ops = path.take();
    if (!ops) continue;
    if (run.chisel) {
      state.setFill(out, color);
      out.push(ops, "f");
      continue;
    }
    state.setStroke(out, color);
    state.setWidth(out, run.width);
    out.push(ops, "S");
  }
}

/** `paintShape`: the fill under the outline, the outline (dashed or dotted), then the heads. */
function writeShape(
  out: string[],
  state: StreamState,
  path: PathWriter,
  pts: readonly number[],
  width: number,
  decor: ShapeDecor,
  ink: Rgba,
  night: boolean,
  alpha: number,
  blend: InkBlend,
  stateName: (alpha: number, blend: InkBlend) => string,
): void {
  const { outline, closed, heads } = shapeGeometry(pts, width, decor);
  path.outline(outline);
  const line = path.take();
  if (decor.fill && closed) {
    const { color, alpha: fillAlpha } = splitFill(decor.fill);
    const fill = rgbaOf(night ? nightColor(color) : color);
    const a = alpha * fillAlpha * fill.a;
    state.save(out);
    if (a < 1 || blend !== "Normal") out.push(`/${stateName(a, blend)} gs`);
    state.setFill(out, fill);
    out.push(line, "f");
    state.restore(out);
    if (decor.noLine) return;
  }
  state.setStroke(out, ink);
  state.setWidth(out, width);
  if (decor.dash) {
    const pattern = dashPattern(decor.dash, width).map(pdfNumber).join(" ");
    out.push(`[${pattern}] 0 d`, line, "S", "[] 0 d");
  } else if (line) {
    out.push(line, "S");
  }
  for (const head of heads) {
    path.points(head.points);
    if (head.filled) {
      path.closePath();
      state.setFill(out, ink);
      // Filled, then stroked with the line's round joins, as the canvas does.
      out.push(path.take(), "B");
    } else {
      out.push(path.take(), "S");
    }
  }
}

/** The runs' box, page px, grown by half the widest run and a pixel for anti-aliasing. */
function runsBox(runs: readonly InkRun[]): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let pad = 0;
  for (const run of runs) {
    pad = Math.max(pad, run.chisel ? run.width : run.width / 2);
    for (let i = 0; i + 1 < run.pts.length; i += 2) {
      x0 = Math.min(x0, run.pts[i]);
      x1 = Math.max(x1, run.pts[i]);
      y0 = Math.min(y0, run.pts[i + 1]);
      y1 = Math.max(y1, run.pts[i + 1]);
    }
  }
  pad += 1;
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
}
