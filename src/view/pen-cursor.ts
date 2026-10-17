/**
 * The mouse cursor over the page on a computer (FineNotes#27): a dot in the
 * ink colour, as wide as the pen writes at the zoom in use, in place of the
 * arrow. The highlighter shows a slim upright bar in its own see-through
 * colour, the laser a glowing red point, and while the pen is down any pen
 * shrinks to a 2 px dot so it never hides the ink being written, as rnote
 * does.
 *
 * Every shape has a white rim and a faint dark ring around it, so white ink
 * still shows on white paper and black ink on dark paper.
 *
 * PURE: no DOM, no Obsidian. The cursor is an SVG data URL for CSS `cursor`.
 */

import { parseCssColor } from "../canvas/night";

/** What the setting "Cursor over the page" shows while a pen is in hand. */
export type PenCursorStyle = "ink" | "crosshair" | "arrow";

export const PEN_CURSOR_STYLES: readonly PenCursorStyle[] = ["ink", "crosshair", "arrow"];

/**
 * A stored cursor setting as one. Before FineNotes#27 it was a boolean, "Crosshair
 * cursor": on becomes the ink dot (its successor), off stays the arrow.
 * Anything else is the default, the ink dot.
 */
export function penCursorStyleOf(value: unknown): PenCursorStyle {
  if (value === false) return "arrow";
  return (PEN_CURSOR_STYLES as readonly unknown[]).includes(value)
    ? (value as PenCursorStyle)
    : "ink";
}

/** The tools that wear a cursor of their own. */
export type CursorTool = "pen" | "highlighter" | "shape" | "laser";

/** The tool in hand as one that wears a cursor of its own, or `null` (the eraser, the lasso, text). */
export function cursorToolOf(tool: string): CursorTool | null {
  return tool === "pen" || tool === "highlighter" || tool === "shape" || tool === "laser"
    ? tool
    : null;
}

/** A CSS cursor image and its hotspot, in CSS px from the image's top left. */
export interface PenCursor {
  url: string;
  hotX: number;
  hotY: number;
}

/** The dot's diameter on screen, in CSS px: never a speck, never a disc that hides the page. */
export const MIN_CURSOR_PX = 6;
export const MAX_CURSOR_PX = 64;
/** The dot a pen shrinks to while it writes. */
export const DRAWING_DOT_PX = 2;

/** The white rim, and the faint dark ring outside it. */
const RIM_PX = 1.5;
const RING_PX = 1;
const RING = "rgba(0,0,0,0.35)";
/** Ink used when the colour given cannot be read: the default pen's soft black, `#1a1a1a`. */
const FALLBACK_INK = { r: 0x1a / 255, g: 0x1a / 255, b: 0x1a / 255, a: 1 };

/**
 * The cursor for `tool` writing in `color` (any colour the page can show:
 * hex, `rgb()` or `rgba()`) with a nib `widthPx` CSS px wide on screen.
 * `highlighterAlpha` is how see-through highlighter ink is drawn. With
 * `drawing`, a pen is down: a pen, highlighter or shape is a 2 px dot, the
 * laser stays as it is.
 */
export function cursorFor(
  tool: CursorTool,
  color: string,
  widthPx: number,
  options: { drawing?: boolean; highlighterAlpha?: number } = {},
): PenCursor {
  if (tool === "laser") return laserCursor();
  const ink = inkOf(color);
  if (options.drawing === true) return dotCursor(ink);
  const size = cursorSize(widthPx);
  if (tool === "highlighter") {
    const alpha = clamp(options.highlighterAlpha ?? 0.4, 0, 1);
    return barCursor({ ...ink, alpha: ink.alpha * alpha }, size);
  }
  return discCursor(ink, size);
}

/**
 * A nib width on screen as a cursor size: whole px between
 * {@link MIN_CURSOR_PX} and {@link MAX_CURSOR_PX}. Whole px, so a zoom that
 * changes the width by a fraction makes no new cursor; non-finite is the
 * smallest.
 */
export function cursorSize(widthPx: number): number {
  if (!Number.isFinite(widthPx)) return MIN_CURSOR_PX;
  return Math.round(clamp(widthPx, MIN_CURSOR_PX, MAX_CURSOR_PX));
}

/** A cursor as the value of CSS `cursor`, with `fallback` for a browser that refuses the image. */
export function cursorCss(cursor: PenCursor, fallback: string): string {
  return `url("${cursor.url}") ${cursor.hotX} ${cursor.hotY}, ${fallback}`;
}

// --- Shapes ----------------------------------------------------------------

interface Ink {
  hex: string;
  alpha: number;
}

/** A filled circle as wide as the nib, rimmed in white, ringed in faint dark. */
function discCursor(ink: Ink, size: number): PenCursor {
  const box = Math.ceil(size + 2 * (RIM_PX + RING_PX));
  const c = box / 2;
  const r = size / 2;
  return image(box, box, [
    circle(c, r + RIM_PX + RING_PX / 2, "none", RING, RING_PX),
    circle(c, r + RIM_PX / 2, "none", "#fff", RIM_PX),
    circle(c, r, ink.hex, "none", 0, ink.alpha),
  ]);
}

/**
 * A slim upright bar as tall as the highlighter's nib, its fill as
 * see-through as the highlighter ink, rimmed and ringed as the dot is.
 */
function barCursor(ink: Ink, size: number): PenCursor {
  const height = Math.max(size, 10);
  const width = Math.round(clamp(height / 4, 4, 10));
  const pad = RIM_PX + RING_PX;
  const boxW = Math.ceil(width + 2 * pad);
  const boxH = Math.ceil(height + 2 * pad);
  const x = (boxW - width) / 2;
  const y = (boxH - height) / 2;
  return image(boxW, boxH, [
    rect(
      x - RIM_PX - RING_PX / 2,
      y - RIM_PX - RING_PX / 2,
      width + 2 * RIM_PX + RING_PX,
      height + 2 * RIM_PX + RING_PX,
      "none",
      RING,
      RING_PX,
    ),
    rect(x - RIM_PX / 2, y - RIM_PX / 2, width + RIM_PX, height + RIM_PX, "none", "#fff", RIM_PX),
    rect(x, y, width, height, ink.hex, "none", 0, ink.alpha),
  ]);
}

/** The point a pen shrinks to while it writes: the ink colour, nothing around it. */
function dotCursor(ink: Ink): PenCursor {
  const box = DRAWING_DOT_PX + 2;
  return image(box, box, [circle(box / 2, DRAWING_DOT_PX / 2, ink.hex, "none", 0, ink.alpha)]);
}

/** The laser: a red point in a soft red glow, unlike any pen. */
function laserCursor(): PenCursor {
  const box = 24;
  const c = box / 2;
  const glow =
    "<defs><radialGradient id='g'><stop offset='0' stop-color='#ff3b30' stop-opacity='0.55'/>" +
    "<stop offset='1' stop-color='#ff3b30' stop-opacity='0'/></radialGradient></defs>" +
    `<circle cx='${c}' cy='${c}' r='${c}' fill='url(#g)'/>`;
  return image(box, box, [
    glow,
    circle(c, 4.5, "#fff", "none", 0),
    circle(c, 3.5, "#ff3b30", "none", 0),
  ]);
}

// --- SVG -------------------------------------------------------------------

function image(width: number, height: number, parts: string[]): PenCursor {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}' ` +
    `viewBox='0 0 ${width} ${height}'>${parts.join("")}</svg>`;
  return {
    url: `data:image/svg+xml,${escapeSvg(svg)}`,
    hotX: Math.floor(width / 2),
    hotY: Math.floor(height / 2),
  };
}

function circle(
  c: number,
  r: number,
  fill: string,
  stroke: string,
  strokeWidth: number,
  opacity = 1,
): string {
  const op = opacity < 1 ? ` fill-opacity='${num(opacity)}'` : "";
  const line = strokeWidth > 0 ? ` stroke-width='${num(strokeWidth)}'` : "";
  return `<circle cx='${num(c)}' cy='${num(c)}' r='${num(r)}' fill='${fill}'${op} stroke='${stroke}'${line}/>`;
}

function rect(
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  stroke: string,
  strokeWidth: number,
  opacity = 1,
): string {
  const op = opacity < 1 ? ` fill-opacity='${num(opacity)}'` : "";
  const line = strokeWidth > 0 ? ` stroke-width='${num(strokeWidth)}'` : "";
  const rx = num(Math.min(w, h) / 2);
  return (
    `<rect x='${num(x)}' y='${num(y)}' width='${num(w)}' height='${num(h)}' rx='${rx}' ` +
    `fill='${fill}'${op} stroke='${stroke}'${line}/>`
  );
}

/**
 * An SVG for a CSS `url("…")` data URL: the characters that would end the
 * string or the URL, or start a fragment (`#` in a colour), percent-encoded.
 * The SVG's own quotes are single, so the CSS string can be double.
 */
export function escapeSvg(svg: string): string {
  return svg.replace(
    /["%#<>{}\\\n\r]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
  );
}

/**
 * A colour as a six-digit hex and an opacity, which is all the SVG is ever
 * given: nothing from settings reaches the markup as written.
 */
function inkOf(color: string): Ink {
  const rgba = parseCssColor(color) ?? FALLBACK_INK;
  const byte = (v: number): string =>
    Math.round(clamp(v, 0, 1) * 255)
      .toString(16)
      .padStart(2, "0");
  return { hex: `#${byte(rgba.r)}${byte(rgba.g)}${byte(rgba.b)}`, alpha: clamp(rgba.a, 0, 1) };
}

function num(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
