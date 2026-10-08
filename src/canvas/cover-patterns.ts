/**
 * The cover designs the picker offers (contracts/api.md §6): soft gradient,
 * orb, duotone split, contour lines, glass label, big type and accent stripe.
 * Each paints over the cloth already filled with the cover colour, then
 * draws a narrow book spine down the left edge.
 *
 * Three rules every painter here keeps:
 *
 * - **Deterministic.** Tiles repaint a page piecemeal, so nothing here is
 *   random; a repaint draws exactly what the last one did, with no seams.
 * - **Inside the page.** Lines are clipped here ({@link clipSegment}), not left
 *   to a canvas clip, so a path never names a point off the page. Soft shapes
 *   are radial gradients filling the page rectangle, never a blur filter,
 *   which WebKit's canvas does not support.
 * - **Sized by the page.** Every position and size is a fraction of the page,
 *   so a design reads the same at A6 and A3 and still shows in a 56 px
 *   thumbnail. Colours come only from the cover's palette.
 *
 * The title is not painted: it is a text box placed by `coverTitleBox`
 * (`src/model/cover.ts`), and so is the big letter of the big-type design.
 *
 * Pure: no DOM, no Obsidian.
 */

import type { CoverLayout, CoverPalette } from "../model/cover";
import { withAlpha } from "../model/cover";
import type { PageGeometry } from "../model/document";

export interface CoverPaint {
  geometry: PageGeometry;
  palette: CoverPalette;
  layout: CoverLayout;
  /** Line-weight multiplier: 1 on the page, more in a small preview. */
  weight: number;
}

type Point = readonly [number, number];

// --- Geometry helpers ---------------------------------------------------------

/**
 * Sutherland–Hodgman: `points` clipped to the page rectangle. Empty when the
 * polygon lies wholly outside.
 */
export function clipPolygon(points: readonly Point[], width: number, height: number): Point[] {
  const edges: Array<{ inside: (p: Point) => boolean; cut: (a: Point, b: Point) => Point }> = [
    { inside: (p) => p[0] >= 0, cut: (a, b) => atX(a, b, 0) },
    { inside: (p) => p[0] <= width, cut: (a, b) => atX(a, b, width) },
    { inside: (p) => p[1] >= 0, cut: (a, b) => atY(a, b, 0) },
    { inside: (p) => p[1] <= height, cut: (a, b) => atY(a, b, height) },
  ];
  let out: Point[] = [...points];
  for (const edge of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      const curIn = edge.inside(cur);
      if (curIn) {
        if (!edge.inside(prev)) out.push(edge.cut(prev, cur));
        out.push(cur);
      } else if (edge.inside(prev)) {
        out.push(edge.cut(prev, cur));
      }
    }
    if (out.length === 0) return out;
  }
  return out;
}

function atX(a: Point, b: Point, x: number): Point {
  const t = (x - a[0]) / (b[0] - a[0]);
  return [x, a[1] + (b[1] - a[1]) * t];
}

function atY(a: Point, b: Point, y: number): Point {
  const t = (y - a[1]) / (b[1] - a[1]);
  return [a[0] + (b[0] - a[0]) * t, y];
}

/**
 * Liang–Barsky: the part of segment `a`–`b` inside the page rectangle, or
 * `null` when none of it is.
 */
export function clipSegment(
  a: Point,
  b: Point,
  width: number,
  height: number,
): [Point, Point] | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let t0 = 0;
  let t1 = 1;
  const checks: Array<[number, number]> = [
    [-dx, a[0]],
    [dx, width - a[0]],
    [-dy, a[1]],
    [dy, height - a[1]],
  ];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  // Clamped: a cut lands on the edge, not 1e-16 past it.
  const at = (t: number): Point => [
    Math.min(width, Math.max(0, a[0] + dx * t)),
    Math.min(height, Math.max(0, a[1] + dy * t)),
  ];
  return [at(t0), at(t1)];
}

/**
 * A fixed hash of a cell, in [0, 1). Never `Math.random`: see the module note.
 * Kept for future textures; the current designs need no irregularity.
 */
export function cellHash(i: number, j: number, seed: number): number {
  let h = Math.imul(i ^ Math.imul(j, 0x27d4eb2f) ^ seed, 0x9e3779b1) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  // `^` yields a signed int32: back to unsigned, or half the hashes go negative.
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 0x100000000;
}

function shortSide(g: PageGeometry): number {
  return Math.min(g.width, g.height);
}

/** Begin a new path holding one rounded rectangle. `arcTo`, not `roundRect`: iPadOS 15 lacks it. */
function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  const k = Math.max(0, Math.min(radius, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

/**
 * A soft round glow: a radial gradient from `color` at its centre to clear at
 * `radius`, filling the page. It stands in for a blurred circle.
 */
function glow(
  ctx: CanvasRenderingContext2D,
  g: PageGeometry,
  cx: number,
  cy: number,
  radius: number,
  color: string,
): void {
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  gradient.addColorStop(0, withAlpha(color, 1));
  gradient.addColorStop(0.55, withAlpha(color, 0.75));
  gradient.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, g.width, g.height);
}

// --- The spine every design shares --------------------------------------------

/** A narrow darker strip down the left edge with a lighter line beside it: the book's spine. */
export function bookSpine(ctx: CanvasRenderingContext2D, c: CoverPaint): void {
  const { width, height } = c.geometry;
  const w = width * 0.033;
  ctx.fillStyle = c.palette.spine;
  ctx.fillRect(0, 0, w, height);
  ctx.fillStyle = c.palette.spineEdge;
  ctx.fillRect(w, 0, Math.max(width * 0.003, c.weight), height);
}

// --- Designs ------------------------------------------------------------------

/** Soft gradient: two close tones of the cover colour, light at the top left. */
export function softGradient(ctx: CanvasRenderingContext2D, c: CoverPaint): void {
  const { width, height } = c.geometry;
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, c.palette.sheenLight);
  gradient.addColorStop(1, c.palette.sheenDark);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

/** Orb: one large soft circle, its middle catching the light, running off the top right. */
export function orb(ctx: CanvasRenderingContext2D, c: CoverPaint): void {
  const { width, height } = c.geometry;
  const r = shortSide(c.geometry) * 0.45;
  const cx = width * 0.77;
  const cy = height * 0.3;
  const gradient = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 0, cx, cy, r);
  gradient.addColorStop(0, withAlpha(c.palette.orbCore, 0.9));
  gradient.addColorStop(1, withAlpha(c.palette.orbRim, 0.9));
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();
}

/** Duotone split: the lower part a shade off the cloth, along a gentle diagonal. */
export function duotoneSplit(ctx: CanvasRenderingContext2D, c: CoverPaint): void {
  const { width, height } = c.geometry;
  ctx.beginPath();
  ctx.moveTo(0, height * 0.56);
  ctx.lineTo(width, height * 0.44);
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fillStyle = c.palette.splitLower;
  ctx.fill();
}

/** One closed contour ring around (cx, cy), of size `r`, as a polyline. */
function contourRing(cx: number, cy: number, r: number): Point[] {
  // Two cubic Béziers, tilted like a hill seen from above.
  const p0: Point = [cx - r * 1.3, cy + r * 0.15];
  const c1: Point = [cx - r * 1.2, cy - r * 1.05];
  const c2: Point = [cx + r * 1.25, cy - r * 0.95];
  const p1: Point = [cx + r * 1.25, cy + r * 0.1];
  // The second curve's first control mirrors c2 about p1 (an SVG "S").
  const c3: Point = [2 * p1[0] - c2[0], 2 * p1[1] - c2[1]];
  const c4: Point = [cx - r * 0.2, cy + r * 1.15];
  const points: Point[] = [];
  const steps = 48;
  for (const [a, b, d, e] of [
    [p0, c1, c2, p1],
    [p1, c3, c4, p0],
  ] as const) {
    for (let i = points.length === 0 ? 0 : 1; i <= steps; i++) {
      const t = i / steps;
      const u = 1 - t;
      points.push([
        u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * d[0] + t * t * t * e[0],
        u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * d[1] + t * t * t * e[1],
      ]);
    }
  }
  return points;
}

/** Contour lines: ten thin topographic rings in a tint of the cover colour. */
export function contourLines(ctx: CanvasRenderingContext2D, c: CoverPaint): void {
  const { width, height } = c.geometry;
  const unit = width / 1024;
  const cx = width * 0.74;
  const cy = height * 0.26;
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const ring = contourRing(cx, cy, (90 + k * 62) * unit);
    let open = false;
    for (let i = 1; i < ring.length; i++) {
      const seg = clipSegment(ring[i - 1], ring[i], width, height);
      if (!seg) {
        open = false;
        continue;
      }
      if (!open) ctx.moveTo(seg[0][0], seg[0][1]);
      ctx.lineTo(seg[1][0], seg[1][1]);
      // A segment cut short at an edge ends the run: the next one re-enters elsewhere.
      open = seg[1][0] === ring[i][0] && seg[1][1] === ring[i][1];
    }
  }
  ctx.strokeStyle = c.palette.contour;
  ctx.lineWidth = Math.max(c.weight, shortSide(c.geometry) * 0.003);
  ctx.stroke();
}

/** Glass label: soft blobs of the cover colour behind a frosted plate for the title. */
export function glassLabel(ctx: CanvasRenderingContext2D, c: CoverPaint): void {
  const g = c.geometry;
  const { width, height } = g;
  const s = shortSide(g);
  ctx.fillStyle = c.palette.glassGround;
  ctx.fillRect(0, 0, width, height);
  glow(ctx, g, width * 0.25, height * 0.29, s * 0.32, c.palette.glassHigh);
  glow(ctx, g, width * 0.8, height * 0.68, s * 0.38, c.palette.glassMid);
  glow(ctx, g, width * 0.68, height * 0.21, s * 0.24, c.palette.glassLow);
  const plate = c.layout.plate;
  if (!plate) return;
  roundedRect(ctx, plate.x, plate.y, plate.w, plate.h, plate.r);
  ctx.fillStyle = c.palette.glassPlate;
  ctx.fill();
  ctx.strokeStyle = c.palette.glassEdge;
  ctx.lineWidth = Math.max(c.weight, s * 0.003);
  ctx.stroke();
}

/** Accent stripe: one short bright bar above the title and a small dot grid in the top corner. */
export function accentStripe(ctx: CanvasRenderingContext2D, c: CoverPaint): void {
  const { width, height } = c.geometry;
  const s = shortSide(c.geometry);
  const barH = s * 0.0098;
  roundedRect(ctx, width * 0.107, height * 0.746, width * 0.156, barH, barH / 2);
  ctx.fillStyle = c.palette.accent;
  ctx.fill();
  const pitch = s * 0.041;
  const r = s * 0.0059;
  ctx.beginPath();
  for (let j = 0; j < 5; j++) {
    for (let i = 0; i < 5; i++) {
      const x = width * 0.723 + i * pitch;
      const y = height * 0.104 + j * pitch;
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
  }
  ctx.fillStyle = c.palette.accentDot;
  ctx.fill();
}
