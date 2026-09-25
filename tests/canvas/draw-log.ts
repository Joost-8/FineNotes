/**
 * A stand-in for canvas that writes down what ends up where, not how it got
 * there. Every draw (fill, stroke, clip, the rectangle calls, drawImage,
 * fillText) becomes one line: its geometry mapped to device pixels through
 * the transform in force, and every style property that differs from the
 * canvas default. Transforms, save/restore and property writes are not
 * lines of their own; they only show in the draws that follow them.
 *
 * That makes a log comparable across two implementations that set the same
 * state in a different order, or reach the same transform another way —
 * which is what a golden of the renderer needs. Canvas elements log their
 * size, style and class changes, and which context options they were asked
 * for (the renderer's iOS rule lives in those).
 */

import { createHash } from "node:crypto";

type Matrix = [number, number, number, number, number, number];

interface DrawState {
  matrix: Matrix;
  style: Record<string, unknown>;
}

/** The canvas defaults; a draw lists only what differs from these. */
const DEFAULT_STYLE: Record<string, unknown> = {
  fillStyle: "#000000",
  strokeStyle: "#000000",
  lineWidth: 1,
  lineCap: "butt",
  lineJoin: "miter",
  lineDash: [],
  globalAlpha: 1,
  globalCompositeOperation: "source-over",
  font: "10px sans-serif",
  textBaseline: "alphabetic",
  imageSmoothingEnabled: true,
  shadowColor: "rgba(0, 0, 0, 0)",
  shadowBlur: 0,
  shadowOffsetX: 0,
  shadowOffsetY: 0,
};

/** A number as the log prints it: to 1e-4, which hides float noise from reordered arithmetic. */
export function num(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const rounded = Math.round(value * 1e4) / 1e4;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function apply(m: Matrix, x: number, y: number): string {
  return `${num(m[0] * x + m[2] * y + m[4])},${num(m[1] * x + m[3] * y + m[5])}`;
}

/** `m` followed by `n`, as `ctx.transform` composes them. */
function compose(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function corners(m: Matrix, x: number, y: number, w: number, h: number): string {
  return [apply(m, x, y), apply(m, x + w, y), apply(m, x + w, y + h), apply(m, x, y + h)].join(" ");
}

function hash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

/** The `Path2D` stand-in: it only remembers its SVG data. */
export class LoggedPath2D {
  constructor(readonly d: string) {}
}

export class DrawLog {
  readonly lines: string[] = [];
  private readonly names = new WeakMap<object, string>();
  private readonly states = new WeakMap<object, DrawState>();
  private created = 0;

  write(line: string): void {
    this.lines.push(line);
  }

  nameOf(target: object): string {
    return this.names.get(target) ?? "?";
  }

  /** The transform a context is drawing with, for painters that log their own calls. */
  matrixOf(ctx: object): string {
    const state = this.states.get(ctx);
    return state ? state.matrix.map(num).join(",") : "?";
  }

  /** A canvas element named `name`; `null` names it by creation order (`el1`, `el2`, …). */
  canvas(name: string | null = null): HTMLCanvasElement {
    const label = name ?? `el${++this.created}`;
    const style = new Proxy({} as Record<string, string>, {
      set: (target, prop, value: string) => {
        target[String(prop)] = value;
        this.write(`${label}.style.${String(prop)} = ${value}`);
        return true;
      },
    });
    const classList = {
      add: (c: string) => this.write(`${label}.classList + ${c}`),
      remove: (c: string) => this.write(`${label}.classList - ${c}`),
    };
    let context: CanvasRenderingContext2D | null = null;
    const fields: Record<string, unknown> = { width: 300, height: 150, style, classList };
    fields.getContext = (kind: string, options?: unknown) => {
      this.write(`${label}.getContext ${kind} ${JSON.stringify(options ?? null)}`);
      context ??= this.context(label, canvas);
      return context;
    };
    const canvas = new Proxy(fields, {
      set: (target, prop, value: unknown) => {
        target[String(prop)] = value;
        this.write(`${label}.${String(prop)} = ${String(value)}`);
        return true;
      },
    }) as unknown as HTMLCanvasElement;
    this.names.set(canvas, label);
    return canvas;
  }

  private context(label: string, canvas: HTMLCanvasElement): CanvasRenderingContext2D {
    let state: DrawState = { matrix: [1, 0, 0, 1, 0, 0], style: { ...DEFAULT_STYLE } };
    const stack: DrawState[] = [];
    let path: string[] = [];

    const styleOf = (): string => {
      const out: string[] = [];
      for (const [key, value] of Object.entries(state.style)) {
        const fallback = DEFAULT_STYLE[key];
        if (JSON.stringify(value) === JSON.stringify(fallback)) continue;
        const shown = Array.isArray(value)
          ? `[${(value as number[]).map(num).join(",")}]`
          : typeof value === "number"
            ? num(value)
            : String(value);
        out.push(`${key}=${shown}`);
      }
      return out.length > 0 ? ` {${out.join(" ")}}` : "";
    };
    const draw = (what: string): void => this.write(`${label} ${what}${styleOf()}`);
    const transform = (n: Matrix): void => {
      state.matrix = compose(state.matrix, n);
    };
    const pathOf = (arg: unknown): string => {
      if (arg instanceof LoggedPath2D) {
        return `path2d#${hash(arg.d)} at ${state.matrix.map(num).join(",")}`;
      }
      return `[${path.join(" ")}]`;
    };

    const methods: Record<string, (...args: never[]) => unknown> = {
      save: () => {
        stack.push({ matrix: [...state.matrix] as Matrix, style: { ...state.style } });
      },
      restore: () => {
        const top = stack.pop();
        if (top) state = top;
      },
      setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => {
        state.matrix = [a, b, c, d, e, f];
      },
      resetTransform: () => {
        state.matrix = [1, 0, 0, 1, 0, 0];
      },
      transform: (a: number, b: number, c: number, d: number, e: number, f: number) =>
        transform([a, b, c, d, e, f]),
      translate: (x: number, y: number) => transform([1, 0, 0, 1, x, y]),
      scale: (x: number, y: number) => transform([x, 0, 0, y, 0, 0]),
      rotate: (angle: number) =>
        transform([Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0]),
      setLineDash: (segments: number[]) => {
        state.style.lineDash = [...segments];
      },
      getLineDash: () => [...(state.style.lineDash as number[])],
      beginPath: () => {
        path = [];
      },
      moveTo: (x: number, y: number) => void path.push(`M${apply(state.matrix, x, y)}`),
      lineTo: (x: number, y: number) => void path.push(`L${apply(state.matrix, x, y)}`),
      closePath: () => void path.push("Z"),
      rect: (x: number, y: number, w: number, h: number) =>
        void path.push(`R(${corners(state.matrix, x, y, w, h)})`),
      fill: (a?: unknown, b?: unknown) => {
        const rule = typeof a === "string" ? a : typeof b === "string" ? b : "nonzero";
        draw(`fill ${rule} ${pathOf(a)}`);
      },
      stroke: (a?: unknown) => draw(`stroke ${pathOf(a)}`),
      clip: (a?: unknown) => draw(`clip ${typeof a === "string" ? a : "nonzero"} ${pathOf(a)}`),
      fillRect: (x: number, y: number, w: number, h: number) =>
        draw(`fillRect ${corners(state.matrix, x, y, w, h)}`),
      strokeRect: (x: number, y: number, w: number, h: number) =>
        draw(`strokeRect ${corners(state.matrix, x, y, w, h)}`),
      clearRect: (x: number, y: number, w: number, h: number) =>
        draw(`clearRect ${corners(state.matrix, x, y, w, h)}`),
      drawImage: (image: object, ...args: number[]) => {
        const source = this.nameOf(image);
        if (args.length === 8) {
          const [sx, sy, sw, sh, dx, dy, dw, dh] = args;
          const from = [sx, sy, sw, sh].map(num).join(",");
          draw(`drawImage ${source}[${from}] -> ${corners(state.matrix, dx, dy, dw, dh)}`);
        } else {
          const [dx, dy, dw, dh] = args;
          const w = dw ?? (image as { width: number }).width;
          const h = dh ?? (image as { height: number }).height;
          draw(`drawImage ${source} -> ${corners(state.matrix, dx, dy, w, h)}`);
        }
      },
      fillText: (text: string, x: number, y: number) =>
        draw(`fillText ${JSON.stringify(text)} ${apply(state.matrix, x, y)}`),
      measureText: (text: string) => ({
        width: text.length * 6,
        fontBoundingBoxAscent: 9,
        fontBoundingBoxDescent: 3,
      }),
    };

    const ctx = new Proxy(methods, {
      get: (target, prop) => {
        if (prop === "canvas") return canvas;
        const key = String(prop);
        if (key in target) return target[key];
        if (key in state.style) return state.style[key];
        throw new Error(`draw-log: the context has no member "${key}"`);
      },
      set: (_target, prop, value: unknown) => {
        state.style[String(prop)] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    this.states.set(ctx, {
      get matrix() {
        return state.matrix;
      },
      get style() {
        return state.style;
      },
    });
    this.names.set(ctx, label);
    return ctx;
  }
}
