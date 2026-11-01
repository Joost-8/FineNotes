/**
 * A shape's style beyond its colour and width: fill, dashed or dotted
 * outline, rounded corners and arrowheads. Which kinds take which, how a
 * style is read from disk, and how one is applied to a stroke.
 *
 * Pure: no DOM, no Obsidian. The renderer draws these (`canvas/shape-decor`),
 * the same code for the page, its thumbnails and every export.
 */

import {
  ARROW_HEADS,
  POINT_STRIDE,
  SHAPE_DASHES,
  type ArrowHead,
  type ArrowHeads,
  type ShapeDash,
  type ShapeKind,
  type Stroke,
} from "./document";

/** What the Shape tool places with, and what a selection is restyled with. */
export interface ShapeStyle {
  /** `null` clears the fill; absent leaves it as it is. */
  fill?: string | null;
  /** `null` makes the outline solid. */
  dash?: ShapeDash | null;
  /** `0` or `null` makes the corners sharp. */
  radius?: number | null;
  /** `null` takes both heads off. */
  heads?: ArrowHeads | null;
  /**
   * Fill each shape with its own line colour, as a soft tint or solid, in
   * place of one colour for all (`fill`). Taken over `fill` when both are set.
   */
  fillFrom?: FillMode;
}

/** How the Shape tool fills: not at all, its colour as a soft tint, or solid. */
export type FillMode = "soft" | "solid";

/** The Shape tool's style choices, remembered between sessions. */
export interface ShapeToolStyle {
  /** Absent: no fill. */
  fill?: FillMode;
  dash?: ShapeDash;
  /** Round the corners of shapes that have them. */
  round?: boolean;
  /** The arrow preset's heads; absent counts as an open head at the end only. */
  heads?: ArrowHeads;
}

/** An arrow preset's heads when none were picked: GoodNotes' single open head. */
export const DEFAULT_ARROW_HEADS: ArrowHeads = { end: "open" };

/** A fill of `color` in `mode`. */
export function fillOf(color: string, mode: FillMode): string {
  return withAlpha(color, mode === "soft" ? TINT_ALPHA : 1);
}

/** A remembered tool style, each field kept only when it is readable. */
export function readShapeToolStyle(raw: unknown): ShapeToolStyle {
  if (typeof raw !== "object" || raw === null) return {};
  const r = raw as Record<string, unknown>;
  const out: ShapeToolStyle = {};
  if (r.fill === "soft" || r.fill === "solid") out.fill = r.fill;
  const dash = readDash(r.dash);
  if (dash) out.dash = dash;
  if (r.round === true) out.round = true;
  if (r.heads !== undefined) out.heads = readHeads(r.heads) ?? {};
  return out;
}

/**
 * Style a shape the Shape tool has just made, of `kind` in `color`: the
 * fields to set on it, and the kind and points it ends up with (an arrow
 * whose heads are not the default becomes a line with those heads).
 */
export function styleNewShape(stroke: Stroke, tool: ShapeToolStyle): void {
  const kind = stroke.shape;
  if (kind === undefined) return;
  if (tool.fill && canFill(kind)) stroke.fill = fillOf(stroke.color, tool.fill);
  if (tool.dash) stroke.dash = tool.dash;
  if (tool.round && canRound(kind)) stroke.radius = ROUND_RADIUS;
  if (kind === "arrow" || kind === "path") {
    const heads = tool.heads ?? DEFAULT_ARROW_HEADS;
    if (heads.start !== undefined || heads.end !== "open") {
      applyShapeStyle(stroke, { heads: heads.start || heads.end ? heads : null });
    }
  }
}

/** The largest corner radius kept, page px: past it a corner is all curve anyway. */
export const MAX_SHAPE_RADIUS = 500;

/** The corner radius the "rounded" choice gives, page px. */
export const ROUND_RADIUS = 14;

/** The alpha of a soft fill: the shape's colour as a tint, so ink on it still reads. */
export const TINT_ALPHA = 0.3;

const FILL = /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Kinds that close on themselves, so they have an inside to fill. */
export function canFill(kind: ShapeKind | undefined): boolean {
  return (
    kind !== undefined &&
    kind !== "line" &&
    kind !== "arrow" &&
    kind !== "arc" &&
    kind !== "angle" &&
    kind !== "path"
  );
}

/** Kinds made of straight edges whose corners can be rounded. */
export function canRound(kind: ShapeKind | undefined): boolean {
  return (
    kind === "rect" ||
    kind === "triangle" ||
    kind === "diamond" ||
    kind === "polygon" ||
    kind === "star" ||
    kind === "path"
  );
}

/**
 * Kinds that take arrowheads: a line, an arrow (which becomes a line with
 * heads) and a path, whose heads follow its first and last runs.
 */
export function canHaveHeads(kind: ShapeKind | undefined): boolean {
  return kind === "line" || kind === "arrow" || kind === "path";
}

/** A fill as stored: `#rrggbb` or `#rrggbbaa`, lower case; anything else is none. */
export function readFill(value: unknown): string | undefined {
  return typeof value === "string" && FILL.test(value) ? value.toLowerCase() : undefined;
}

export function readDash(value: unknown): ShapeDash | undefined {
  return SHAPE_DASHES.includes(value as ShapeDash) ? (value as ShapeDash) : undefined;
}

/** A radius as stored: positive and finite, at most {@link MAX_SHAPE_RADIUS}. */
export function readRadius(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.min(MAX_SHAPE_RADIUS, value);
}

function readHead(value: unknown): ArrowHead | undefined {
  return ARROW_HEADS.includes(value as ArrowHead) ? (value as ArrowHead) : undefined;
}

/** Heads as stored; `undefined` when neither end has one. */
export function readHeads(value: unknown): ArrowHeads | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const start = readHead(raw.start);
  const end = readHead(raw.end);
  if (!start && !end) return undefined;
  return { ...(start ? { start } : {}), ...(end ? { end } : {}) };
}

/** `#rrggbb` with `alpha` (0–1) as `#rrggbbaa`; an alpha of 1 gives `#rrggbb`. */
export function withAlpha(hex: string, alpha: number): string {
  const base = hex.slice(0, 7).toLowerCase();
  if (!(alpha < 1)) return base;
  const a = Math.round(Math.max(0, alpha) * 255);
  return `${base}${a.toString(16).padStart(2, "0")}`;
}

/** A fill's colour and alpha (0–1). */
export function splitFill(fill: string): { color: string; alpha: number } {
  const color = fill.slice(0, 7).toLowerCase();
  if (fill.length !== 9) return { color, alpha: 1 };
  return { color, alpha: Number.parseInt(fill.slice(7, 9), 16) / 255 };
}

/** Whether a polyline ends where it starts, so it has an inside. */
export function isClosedLoop(pts: readonly number[]): boolean {
  const n = pts.length - (pts.length % POINT_STRIDE);
  if (n < 3 * POINT_STRIDE) return false;
  const dx = pts[0] - pts[n - POINT_STRIDE];
  const dy = pts[1] - pts[n - POINT_STRIDE + 1];
  return Math.hypot(dx, dy) < 0.5;
}

/** A stroke's style fields, for undo. */
export interface StyleFields {
  fill?: string;
  dash?: ShapeDash;
  radius?: number;
  heads?: ArrowHeads;
  shape?: ShapeKind;
  pts: number[];
}

export function styleFieldsOf(stroke: Stroke): StyleFields {
  const out: StyleFields = { pts: stroke.pts };
  if (stroke.fill !== undefined) out.fill = stroke.fill;
  if (stroke.dash !== undefined) out.dash = stroke.dash;
  if (stroke.radius !== undefined) out.radius = stroke.radius;
  if (stroke.heads !== undefined) out.heads = { ...stroke.heads };
  if (stroke.shape !== undefined) out.shape = stroke.shape;
  return out;
}

/** Put back what {@link styleFieldsOf} took, keys absent then absent again. */
export function restoreStyleFields(stroke: Stroke, saved: StyleFields): void {
  stroke.pts = saved.pts;
  for (const key of ["fill", "dash", "radius", "heads", "shape"] as const) {
    if (saved[key] === undefined) delete stroke[key];
  }
  if (saved.fill !== undefined) stroke.fill = saved.fill;
  if (saved.dash !== undefined) stroke.dash = saved.dash;
  if (saved.radius !== undefined) stroke.radius = saved.radius;
  if (saved.heads !== undefined) stroke.heads = { ...saved.heads };
  if (saved.shape !== undefined) stroke.shape = saved.shape;
}

/**
 * Give a stroke the parts of `style` its kind takes, and say whether
 * anything changed. A freehand stroke takes none. An arrow given heads
 * becomes a line from its tail to its tip with those heads, since a stored
 * arrow's head is part of its points (contracts/api.md §2).
 */
export function applyShapeStyle(stroke: Stroke, style: ShapeStyle): boolean {
  const kind = stroke.shape;
  if (kind === undefined) return false;
  const before = JSON.stringify(styleFieldsOf(stroke));
  if (style.fillFrom !== undefined && canFill(kind)) {
    stroke.fill = fillOf(stroke.color, style.fillFrom);
  } else if (style.fill !== undefined && canFill(kind)) {
    const fill = style.fill === null ? undefined : readFill(style.fill);
    if (fill) stroke.fill = fill;
    else delete stroke.fill;
  }
  if (style.dash !== undefined) {
    const dash = style.dash === null ? undefined : readDash(style.dash);
    if (dash) stroke.dash = dash;
    else delete stroke.dash;
  }
  if (style.radius !== undefined && canRound(kind)) {
    const radius = style.radius === null ? undefined : readRadius(style.radius);
    if (radius) stroke.radius = radius;
    else delete stroke.radius;
  }
  if (style.heads !== undefined && canHaveHeads(kind)) {
    const heads = style.heads === null ? undefined : readHeads(style.heads);
    if (kind === "arrow" && stroke.pts.length >= 2 * POINT_STRIDE) {
      // [tail, tip, …the V]: keep the shaft, draw the heads instead.
      stroke.pts = stroke.pts.slice(0, 2 * POINT_STRIDE);
      stroke.shape = "line";
    }
    if (heads) stroke.heads = heads;
    else delete stroke.heads;
  }
  return JSON.stringify(styleFieldsOf(stroke)) !== before;
}

/**
 * The style a selection shows as its own: each field where every shape that
 * takes it agrees, otherwise left out (mixed). `kinds` says which choices
 * apply at all.
 */
export function commonShapeStyle(strokes: readonly Stroke[]): {
  style: ShapeStyle;
  fillable: boolean;
  roundable: boolean;
  headed: boolean;
  shapes: number;
} {
  const shapes = strokes.filter((s) => s.shape !== undefined);
  const agree = <T>(list: readonly Stroke[], get: (s: Stroke) => T): T | undefined => {
    if (list.length === 0) return undefined;
    const first = JSON.stringify(get(list[0]) ?? null);
    return list.every((s) => JSON.stringify(get(s) ?? null) === first) ? get(list[0]) : undefined;
  };
  const fillable = shapes.filter((s) => canFill(s.shape));
  const roundable = shapes.filter((s) => canRound(s.shape));
  const headed = shapes.filter((s) => canHaveHeads(s.shape));
  const style: ShapeStyle = {};
  if (fillable.length > 0 && agree(fillable, (s) => s.fill ?? null) !== undefined)
    style.fill = fillable[0].fill ?? null;
  if (shapes.length > 0 && agree(shapes, (s) => s.dash ?? null) !== undefined)
    style.dash = shapes[0].dash ?? null;
  if (roundable.length > 0 && agree(roundable, (s) => s.radius ?? null) !== undefined)
    style.radius = roundable[0].radius ?? null;
  if (headed.length > 0 && agree(headed, (s) => headsOf(s)) !== undefined)
    style.heads = headsOf(headed[0]);
  return {
    style,
    fillable: fillable.length > 0,
    roundable: roundable.length > 0,
    headed: headed.length > 0,
    shapes: shapes.length,
  };
}

/** The heads a line or arrow shows: a stored arrow has an open head at its end. */
export function headsOf(stroke: Stroke): ArrowHeads | null {
  if (stroke.shape === "arrow") return { end: "open" };
  return stroke.heads ? { ...stroke.heads } : null;
}
