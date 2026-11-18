/**
 * A stroke's look without its points, and the pen it is traced with: what
 * the canvas renderer and the PDF export's vector ink (`export/vector-ink`)
 * both draw a stored stroke from.
 *
 * PURE: no DOM, no Obsidian.
 */

import type { ArrowHeads, InkTip, ShapeDash, ShapeKind, Stroke, Tool } from "../model/document";
import { canFill, canRound } from "../model/shape-style";
import { type PenOptions, penOptions } from "../ink/freehand";

/** A stroke's look without its points: what the wet layer draws a stroke in progress with. */
export interface StrokeStyle {
  color: string;
  /** Nib width, in page px. */
  size: number;
  tool: Tool;
  /** Whether pressure varies the width. The highlighter ignores it and keeps one width. */
  usePressure: boolean;
  /** Clean shape geometry (a snapped or placed shape), not freehand ink. */
  shape?: boolean;
  /** A shape's fill, dash, corners and arrowheads, when it has any. */
  decor?: ShapeDecor | null;
  /** A flat calligraphy nib's angle, degrees; absent for a round nib. */
  nib?: number;
  /** A highlighter's flat chisel tip (`Stroke.tip`); absent for a round one. */
  tip?: InkTip;
  /** A stored stroke's Pencil altitude per point (`Stroke.tilt`); absent: upright. */
  tilt?: readonly number[];
}

/** What a shape is drawn with beyond its colour and width (`model/shape-style`). */
export interface ShapeDecor {
  kind: ShapeKind;
  fill?: string;
  dash?: ShapeDash;
  radius?: number;
  heads?: ArrowHeads;
  /** The outline is not drawn: only set with a fill. */
  noLine?: true;
}

/** A stroke's decor, or `null` when it is drawn as plain ink. */
export function decorOf(stroke: {
  shape?: ShapeKind;
  fill?: string;
  dash?: ShapeDash;
  radius?: number;
  heads?: ArrowHeads;
  noLine?: true;
}): ShapeDecor | null {
  const kind = stroke.shape;
  if (kind === undefined) return null;
  const fill = canFill(kind) ? stroke.fill : undefined;
  const radius =
    canRound(kind) && stroke.radius !== undefined && stroke.radius > 0 ? stroke.radius : undefined;
  const heads =
    (kind === "line" || kind === "path") && (stroke.heads?.start || stroke.heads?.end)
      ? stroke.heads
      : undefined;
  if (!fill && !stroke.dash && !radius && !heads) return null;
  return {
    kind,
    ...(fill ? { fill } : {}),
    ...(stroke.dash ? { dash: stroke.dash } : {}),
    ...(radius ? { radius } : {}),
    ...(heads ? { heads } : {}),
    // A shape is never drawn as nothing: no line only while it is filled.
    ...(fill && stroke.noLine ? { noLine: true as const } : {}),
  };
}

/** The style a stored stroke is drawn with, `pressure` being the user's setting. */
export function styleOf(stroke: Stroke, pressure: boolean): StrokeStyle {
  const { color, size, tool, shape } = stroke;
  return {
    color,
    size,
    tool,
    usePressure: pressure,
    shape: shape !== undefined,
    decor: decorOf(stroke),
    ...(stroke.nib !== undefined ? { nib: stroke.nib } : {}),
    ...(stroke.tip !== undefined ? { tip: stroke.tip } : {}),
    ...(stroke.tilt !== undefined ? { tilt: stroke.tilt } : {}),
  };
}

/** Highlighter ink keeps one width: pressure never thins it. */
export function pressureFor(tool: Tool, usePressure: boolean): boolean {
  return tool !== "highlighter" && usePressure;
}

/** The pen a stroke of this style is traced with. */
export function penFor(style: {
  size: number;
  tool: Tool;
  usePressure: boolean;
  nib?: number;
  tip?: InkTip;
}): PenOptions {
  return penOptions(style.size, pressureFor(style.tool, style.usePressure), style.nib, style.tip);
}
