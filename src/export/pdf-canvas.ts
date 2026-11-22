/**
 * A stand-in for a canvas's 2D context that records what is drawn as PDF
 * content-stream operators, for the parts of a page that are only paths:
 * the paper's fill and its rulings, a cover's bands, a margin's lines. The
 * painters that draw them on screen (`canvas/backdrop`) draw them here, so
 * the PDF's paper is the app's paper, in vectors.
 *
 * It knows paths (lines, arcs, curves, rectangles), solid fills and strokes,
 * clips, transforms, alpha and dashes. Anything else (a picture, text, a
 * gradient or pattern, a blend, a shadow, reading pixels back) it cannot
 * write, and it says so in {@link PdfCanvasRecorder.unsupported}: the
 * caller then paints that layer as a picture instead, so a page never comes
 * out wrong, only bigger.
 *
 * Coordinates are the virtual canvas's device px, y down, as the painter's
 * own transforms put them; the caller maps them onto the page with one `cm`.
 *
 * PURE: no DOM, no Obsidian.
 */

import { parseCssColor } from "../canvas/night";
import type { InkGraphicsState, VectorInk } from "./vector-ink";
import { pdfNumber } from "./vector-ink";

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m: Matrix, n: Matrix): Matrix {
  // m × n: n applied first, as the canvas composes `transform` onto the current matrix.
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

interface DrawState {
  matrix: Matrix;
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  miterLimit: number;
  globalAlpha: number;
  globalCompositeOperation: string;
  dash: number[];
  lineDashOffset: number;
  shadowColor: string;
  shadowBlur: number;
  filter: string;
}

const CAPS: Record<string, number> = { butt: 0, round: 1, square: 2 };
const JOINS: Record<string, number> = { miter: 0, round: 1, bevel: 2 };

/**
 * A circular arc from angle `a0` to `a1` (radians, clockwise on screen as
 * the canvas measures), as cubic Béziers of at most a quarter turn each:
 * `[x1, y1, x2, y2, x, y]` per piece, in the circle's own space.
 */
export function arcCubics(
  cx: number,
  cy: number,
  r: number,
  a0: number,
  a1: number,
): Array<[number, number, number, number, number, number]> {
  const sweep = a1 - a0;
  const pieces = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
  const step = sweep / pieces;
  const k = (4 / 3) * Math.tan(step / 4);
  const out: Array<[number, number, number, number, number, number]> = [];
  for (let i = 0; i < pieces; i++) {
    const t0 = a0 + i * step;
    const t1 = t0 + step;
    const c0 = Math.cos(t0);
    const s0 = Math.sin(t0);
    const c1 = Math.cos(t1);
    const s1 = Math.sin(t1);
    out.push([
      cx + r * (c0 - k * s0),
      cy + r * (s0 + k * c0),
      cx + r * (c1 + k * s1),
      cy + r * (s1 - k * c1),
      cx + r * c1,
      cy + r * s1,
    ]);
  }
  return out;
}

/** The sweep `arc(…, start, end, anticlockwise)` draws, as the canvas spec normalises it. */
function arcSweep(start: number, end: number, anticlockwise: boolean): number {
  const tau = Math.PI * 2;
  if (!anticlockwise && end - start >= tau) return tau;
  if (anticlockwise && start - end >= tau) return -tau;
  let sweep = (end - start) % tau;
  if (!anticlockwise && sweep < 0) sweep += tau;
  if (anticlockwise && sweep > 0) sweep -= tau;
  return sweep;
}

export class PdfCanvasRecorder {
  /** The virtual canvas: painters read its size. */
  readonly canvas: { width: number; height: number };
  /** Why this layer cannot be written as vectors, or `null` while it can. */
  unsupported: string | null = null;
  /** Whether anything was painted. */
  painted = false;

  protected readonly out: string[] = [];
  private readonly states = new Map<string, InkGraphicsState>();
  private state: DrawState = {
    matrix: [...IDENTITY],
    fillStyle: "#000000",
    strokeStyle: "#000000",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    miterLimit: 10,
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    dash: [],
    lineDashOffset: 0,
    shadowColor: "rgba(0, 0, 0, 0)",
    shadowBlur: 0,
    filter: "none",
  };
  private readonly stack: DrawState[] = [];
  /** The current path, device px, as operators. */
  private path: string[] = [];
  private current: [number, number] | null = null;
  private start: [number, number] | null = null;
  // Accepted and ignored: they change nothing a path draws.
  font = "10px sans-serif";
  textAlign = "start";
  textBaseline = "alphabetic";
  imageSmoothingEnabled = true;
  imageSmoothingQuality = "low";

  constructor(width: number, height: number) {
    this.canvas = { width, height };
  }

  /** What was recorded, device px with y down, in {@link VectorInk}'s shape. */
  result(): VectorInk {
    return { ops: this.painted ? this.out.join("\n") : "", states: this.states, groups: new Map() };
  }

  /**
   * This recorder as a `CanvasRenderingContext2D`: a property or method it
   * does not have marks it unsupported instead of throwing or vanishing.
   */
  asContext(): CanvasRenderingContext2D {
    return new Proxy(this, {
      get: (target, key, receiver) => {
        if (typeof key === "string" && !(key in target)) {
          return (): undefined => {
            target.refuse(key);
            return undefined;
          };
        }
        const value: unknown = Reflect.get(target, key, receiver);
        if (typeof value !== "function") return value;
        const method = value as (...args: unknown[]) => unknown;
        return method.bind(target) as unknown;
      },
      set: (target, key, value: unknown) => {
        if (typeof key === "string" && !(key in target) && !(key in target.state)) {
          target.refuse(`${key} =`);
          return true;
        }
        return Reflect.set(target, key, value);
      },
    }) as unknown as CanvasRenderingContext2D;
  }

  private refuse(what: string): void {
    this.unsupported ??= what;
  }

  // ------------------------------------------------------------- styles
  get fillStyle(): unknown {
    return this.state.fillStyle;
  }
  set fillStyle(v: unknown) {
    this.state.fillStyle = v;
  }
  get strokeStyle(): unknown {
    return this.state.strokeStyle;
  }
  set strokeStyle(v: unknown) {
    this.state.strokeStyle = v;
  }
  get lineWidth(): number {
    return this.state.lineWidth;
  }
  set lineWidth(v: number) {
    if (Number.isFinite(v) && v > 0) this.state.lineWidth = v;
  }
  get lineCap(): string {
    return this.state.lineCap;
  }
  set lineCap(v: string) {
    if (v in CAPS) this.state.lineCap = v;
  }
  get lineJoin(): string {
    return this.state.lineJoin;
  }
  set lineJoin(v: string) {
    if (v in JOINS) this.state.lineJoin = v;
  }
  get miterLimit(): number {
    return this.state.miterLimit;
  }
  set miterLimit(v: number) {
    if (Number.isFinite(v) && v > 0) this.state.miterLimit = v;
  }
  get globalAlpha(): number {
    return this.state.globalAlpha;
  }
  set globalAlpha(v: number) {
    if (Number.isFinite(v) && v >= 0 && v <= 1) this.state.globalAlpha = v;
  }
  get globalCompositeOperation(): string {
    return this.state.globalCompositeOperation;
  }
  set globalCompositeOperation(v: string) {
    this.state.globalCompositeOperation = v;
  }
  get lineDashOffset(): number {
    return this.state.lineDashOffset;
  }
  set lineDashOffset(v: number) {
    if (Number.isFinite(v)) this.state.lineDashOffset = v;
  }
  get shadowColor(): string {
    return this.state.shadowColor;
  }
  set shadowColor(v: string) {
    this.state.shadowColor = v;
  }
  get shadowBlur(): number {
    return this.state.shadowBlur;
  }
  set shadowBlur(v: number) {
    this.state.shadowBlur = v;
  }
  get filter(): string {
    return this.state.filter;
  }
  set filter(v: string) {
    this.state.filter = v;
  }

  setLineDash(segments: number[]): void {
    if (segments.every((s) => Number.isFinite(s) && s >= 0)) {
      this.state.dash = segments.length % 2 ? [...segments, ...segments] : [...segments];
    }
  }

  getLineDash(): number[] {
    return [...this.state.dash];
  }

  // ---------------------------------------------------------- state
  save(): void {
    this.stack.push({ ...this.state, matrix: [...this.state.matrix], dash: [...this.state.dash] });
    this.out.push("q");
  }

  restore(): void {
    const top = this.stack.pop();
    if (!top) return;
    this.state = top;
    this.out.push("Q");
  }

  // ------------------------------------------------------- transforms
  translate(x: number, y: number): void {
    this.transform(1, 0, 0, 1, x, y);
  }

  scale(x: number, y: number): void {
    this.transform(x, 0, 0, y, 0, 0);
  }

  rotate(angle: number): void {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    this.transform(c, s, -s, c, 0, 0);
  }

  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.state.matrix = multiply(this.state.matrix, [a, b, c, d, e, f]);
  }

  setTransform(a: number | DOMMatrix2DInit = 1, b = 0, c = 0, d = 1, e = 0, f = 0): void {
    if (typeof a === "object") {
      this.state.matrix = [a.a ?? 1, a.b ?? 0, a.c ?? 0, a.d ?? 1, a.e ?? 0, a.f ?? 0];
      return;
    }
    this.state.matrix = [a, b, c, d, e, f];
  }

  resetTransform(): void {
    this.state.matrix = [...IDENTITY];
  }

  getTransform(): { a: number; b: number; c: number; d: number; e: number; f: number } {
    const [a, b, c, d, e, f] = this.state.matrix;
    return { a, b, c, d, e, f };
  }

  // ------------------------------------------------------------ paths
  private at(x: number, y: number): [number, number] {
    const [a, b, c, d, e, f] = this.state.matrix;
    return [a * x + c * y + e, b * x + d * y + f];
  }

  private xy(p: [number, number]): string {
    return `${pdfNumber(p[0])} ${pdfNumber(p[1])}`;
  }

  /** The current point in user space, by inverting the matrix. */
  private userPoint(): [number, number] | null {
    if (!this.current) return null;
    const [a, b, c, d, e, f] = this.state.matrix;
    const det = a * d - b * c;
    if (Math.abs(det) < 1e-12) return null;
    const x = this.current[0] - e;
    const y = this.current[1] - f;
    return [(d * x - c * y) / det, (-b * x + a * y) / det];
  }

  beginPath(): void {
    this.path = [];
    this.current = null;
    this.start = null;
  }

  moveTo(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const p = this.at(x, y);
    this.path.push(`${this.xy(p)} m`);
    this.current = p;
    this.start = p;
  }

  lineTo(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (!this.current) {
      this.moveTo(x, y);
      return;
    }
    const p = this.at(x, y);
    this.path.push(`${this.xy(p)} l`);
    this.current = p;
  }

  closePath(): void {
    if (!this.current) return;
    this.path.push("h");
    this.current = this.start;
  }

  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void {
    if (!this.current) this.moveTo(x1, y1);
    const p = this.at(x, y);
    this.path.push(`${this.xy(this.at(x1, y1))} ${this.xy(this.at(x2, y2))} ${this.xy(p)} c`);
    this.current = p;
  }

  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void {
    const from = this.userPoint();
    if (!from) {
      this.moveTo(cx, cy);
      this.lineTo(x, y);
      return;
    }
    this.bezierCurveTo(
      from[0] + (2 / 3) * (cx - from[0]),
      from[1] + (2 / 3) * (cy - from[1]),
      x + (2 / 3) * (cx - x),
      y + (2 / 3) * (cy - y),
      x,
      y,
    );
  }

  arc(cx: number, cy: number, r: number, start: number, end: number, anticlockwise = false): void {
    if (![cx, cy, r, start, end].every(Number.isFinite) || r < 0) return;
    const sweep = arcSweep(start, end, anticlockwise);
    const x0 = cx + r * Math.cos(start);
    const y0 = cy + r * Math.sin(start);
    if (this.current) this.lineTo(x0, y0);
    else this.moveTo(x0, y0);
    if (r === 0 || sweep === 0) return;
    for (const [x1, y1, x2, y2, x, y] of arcCubics(cx, cy, r, start, start + sweep)) {
      this.bezierCurveTo(x1, y1, x2, y2, x, y);
    }
  }

  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void {
    const from = this.userPoint();
    if (!from) {
      this.moveTo(x1, y1);
      return;
    }
    const v1 = unit(from[0] - x1, from[1] - y1);
    const v2 = unit(x2 - x1, y2 - y1);
    const theta =
      v1 && v2 ? Math.acos(Math.max(-1, Math.min(1, v1[0] * v2[0] + v1[1] * v2[1]))) : 0;
    if (!v1 || !v2 || !(r > 0) || theta < 1e-6 || Math.PI - theta < 1e-6) {
      this.lineTo(x1, y1);
      return;
    }
    const t = r / Math.tan(theta / 2);
    const k = (4 / 3) * Math.tan((Math.PI - theta) / 4) * r;
    const t1 = [x1 + v1[0] * t, y1 + v1[1] * t];
    const t2 = [x1 + v2[0] * t, y1 + v2[1] * t];
    this.lineTo(t1[0], t1[1]);
    this.bezierCurveTo(
      t1[0] - v1[0] * k,
      t1[1] - v1[1] * k,
      t2[0] - v2[0] * k,
      t2[1] - v2[1] * k,
      t2[0],
      t2[1],
    );
  }

  rect(x: number, y: number, w: number, h: number): void {
    if (![x, y, w, h].every(Number.isFinite)) return;
    this.moveTo(x, y);
    this.lineTo(x + w, y);
    this.lineTo(x + w, y + h);
    this.lineTo(x, y + h);
    this.closePath();
    this.moveTo(x, y);
  }

  // ---------------------------------------------------------- painting
  /** A colour this recorder can write, with its alpha, or `null` (and refused). */
  private paint(style: unknown): { rgb: string; alpha: number } | null {
    if (typeof style !== "string") {
      this.refuse("a gradient or pattern");
      return null;
    }
    const c = parseCssColor(style);
    if (!c) {
      this.refuse(`colour ${style}`);
      return null;
    }
    const u = (n: number): string => String(Math.round(n * 1000) / 1000);
    return { rgb: `${u(c.r)} ${u(c.g)} ${u(c.b)}`, alpha: c.a * this.state.globalAlpha };
  }

  /** Whether the current state is one a plain PDF fill or stroke reproduces. */
  private plain(): boolean {
    const s = this.state;
    if (s.globalCompositeOperation !== "source-over") this.refuse(s.globalCompositeOperation);
    else if (s.filter !== "none" && s.filter !== "") this.refuse("filter");
    else if (s.shadowBlur > 0 && parseCssColor(s.shadowColor)?.a) this.refuse("shadow");
    return this.unsupported === null;
  }

  protected alphaState(alpha: number): string | null {
    if (alpha >= 1) return null;
    const a = Math.round(Math.max(0, alpha) * 1000) / 1000;
    for (const [name, s] of this.states) if (s.alpha === a && s.blend === "Normal") return name;
    const name = `Gs${this.states.size}`;
    this.states.set(name, { alpha: a, blend: "Normal" });
    return name;
  }

  private emit(path: readonly string[], setup: string[], op: string, alpha: number): void {
    if (path.length === 0 || alpha <= 0) return;
    const gs = this.alphaState(alpha);
    this.out.push("q", ...(gs ? [`/${gs} gs`] : []), ...setup, ...path, op, "Q");
    this.painted = true;
  }

  fill(rule?: unknown, more?: unknown): void {
    if (typeof rule === "object" && rule !== null) {
      this.refuse("a Path2D");
      return;
    }
    void more;
    if (!this.plain()) return;
    const color = this.paint(this.state.fillStyle);
    if (!color) return;
    this.emit(this.path, [`${color.rgb} rg`], rule === "evenodd" ? "f*" : "f", color.alpha);
  }

  stroke(path?: unknown): void {
    if (path !== undefined) {
      this.refuse("a Path2D");
      return;
    }
    if (!this.plain()) return;
    const color = this.paint(this.state.strokeStyle);
    if (!color) return;
    const [a, b, c, d] = this.state.matrix;
    const det = Math.abs(a * d - b * c);
    const sx = Math.hypot(a, b);
    const sy = Math.hypot(c, d);
    // A stroke under a stretched or skewed matrix is not one width: refused, not guessed.
    if (
      det < 1e-12 ||
      Math.abs(sx - sy) > 0.01 * Math.max(sx, sy) ||
      Math.abs(a * c + b * d) > 1e-6 * sx * sy
    ) {
      this.refuse("a stretched stroke");
      return;
    }
    const s = Math.sqrt(det);
    const setup = [
      `${color.rgb} RG`,
      `${pdfNumber(this.state.lineWidth * s)} w`,
      `${CAPS[this.state.lineCap]} J`,
      `${JOINS[this.state.lineJoin]} j`,
      `${pdfNumber(this.state.miterLimit)} M`,
    ];
    if (this.state.dash.length > 0) {
      const dash = this.state.dash.map((v) => pdfNumber(v * s)).join(" ");
      setup.push(`[${dash}] ${pdfNumber(this.state.lineDashOffset * s)} d`);
    }
    this.emit(this.path, setup, "S", color.alpha);
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    const kept = { path: this.path, current: this.current, start: this.start };
    this.beginPath();
    this.rect(x, y, w, h);
    this.fill();
    ({ path: this.path, current: this.current, start: this.start } = kept);
  }

  strokeRect(x: number, y: number, w: number, h: number): void {
    const kept = { path: this.path, current: this.current, start: this.start };
    this.beginPath();
    this.rect(x, y, w, h);
    this.stroke();
    ({ path: this.path, current: this.current, start: this.start } = kept);
  }

  clearRect(x: number, y: number, w: number, h: number): void {
    // Clearing before anything is drawn clears nothing; afterwards it would need a knockout.
    if (this.painted) this.refuse("clearRect");
    void x;
    void y;
    void w;
    void h;
  }

  clip(rule?: unknown): void {
    if (typeof rule === "object" && rule !== null) {
      this.refuse("a Path2D clip");
      return;
    }
    // The canvas keeps the path after a clip; PDF ends it, so it is written as its own copy.
    // An empty path clips everything away, as the canvas does.
    const path = this.path.length > 0 ? this.path : ["0 0 0 0 re"];
    this.out.push(...path, rule === "evenodd" ? "W* n" : "W n");
  }
}

function unit(x: number, y: number): [number, number] | null {
  const len = Math.hypot(x, y);
  return len > 1e-9 ? [x / len, y / len] : null;
}
