/**
 * A page's ink drawn on its own for a vision model, for when the view cannot
 * hand over the whole page: near-black on white whatever colours the pens
 * were, cropped to the ink with a margin, and scaled so its long edge is at
 * most 1568 px — beyond that the models charge more for no more detail. A
 * small sketch is enlarged up to 3x and no further, since more pixels would
 * add bytes, not legibility. It needs a canvas, and nothing from Obsidian.
 */

import { inkPath, penOptions } from "../ink/freehand";
import { paintInk } from "../canvas/renderer";
import { type Bounds, type Stroke, strokeBounds } from "../model/document";

export interface RenderOptions {
  /** The picture's longest edge in px, at most (default 1568). */
  maxEdge?: number;
  /** Blank margin around the ink, in page px (default 16). */
  pad?: number;
}

export interface RenderedInk {
  /** The PNG's bytes in base64, with no `data:` prefix. */
  base64: string;
  width: number;
  height: number;
}

const DEFAULT_MAX_EDGE = 1568;
const DEFAULT_PAD = 16;
const MAX_ENLARGEMENT = 3;

/** Pens in near-black; highlighters in a faint grey that leaves the pen under them readable. */
const PEN_INK = { color: "#111111", alpha: 1 };
const HIGHLIGHTER_INK = { color: "#888888", alpha: 0.25 };

/** The part of the page the picture shows, and how it is scaled into it. */
interface Frame {
  left: number;
  top: number;
  scale: number;
  width: number;
  height: number;
}

function frameAround(strokes: readonly Stroke[], maxEdge: number, pad: number): Frame | null {
  const boxes = strokes.map(strokeBounds).filter((box): box is Bounds => box !== null);
  if (boxes.length === 0) return null;
  const least = (values: number[]) => values.reduce((a, b) => Math.min(a, b));
  const most = (values: number[]) => values.reduce((a, b) => Math.max(a, b));
  const left = least(boxes.map((box) => box.minX)) - pad;
  const top = least(boxes.map((box) => box.minY)) - pad;
  const spanX = most(boxes.map((box) => box.maxX)) + pad - left;
  const spanY = most(boxes.map((box) => box.maxY)) + pad - top;
  const scale = Math.min(maxEdge / Math.max(spanX, spanY), MAX_ENLARGEMENT);
  return {
    left,
    top,
    scale,
    width: Math.max(1, Math.round(spanX * scale)),
    height: Math.max(1, Math.round(spanY * scale)),
  };
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  const ink = inkPath(stroke.pts, penOptions(stroke.size, true), true, stroke.shape !== undefined);
  if (!ink) return;
  const style = stroke.tool === "highlighter" ? HIGHLIGHTER_INK : PEN_INK;
  ctx.globalAlpha = style.alpha;
  ctx.fillStyle = style.color;
  paintInk(ctx, ink);
}

/** The strokes as a PNG for a vision model, or null when there is no ink to draw. */
export function renderStrokesForRecognition(
  strokes: readonly Stroke[],
  options: RenderOptions = {},
): RenderedInk | null {
  const frame = frameAround(
    strokes,
    options.maxEdge ?? DEFAULT_MAX_EDGE,
    options.pad ?? DEFAULT_PAD,
  );
  if (!frame) return null;

  // The canvas is never put in a document, so the main window's `createEl`
  // serves even when the note is open in a pop-out window.
  const canvas = createEl("canvas");
  canvas.width = frame.width;
  canvas.height = frame.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, frame.width, frame.height);
  const { scale } = frame;
  ctx.setTransform(scale, 0, 0, scale, -frame.left * scale, -frame.top * scale);
  for (const stroke of strokes) drawStroke(ctx, stroke);

  const png = canvas.toDataURL("image/png");
  return { base64: png.slice(png.indexOf(",") + 1), width: frame.width, height: frame.height };
}
