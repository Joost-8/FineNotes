/**
 * The textures and trims of the newer cover designs (contracts/api.md §6):
 * patterns that fill the cloth (polka, stripes, graph, waves, chevron,
 * mosaic, terrazzo, composition) and the trims of the classic ones (strap,
 * bound corners, frame, fade).
 *
 * Three rules every painter here keeps:
 *
 * - **Deterministic.** Tiles repaint a page piecemeal, so anything irregular
 *   comes from a fixed hash of a cell's index, never `Math.random`; a
 *   repaint draws exactly what the last one did, with no seams.
 * - **Inside the page.** Shapes that cross an edge are clipped here
 *   ({@link clipPolygon}), not left to a canvas clip, so a path never names a
 *   point off the page.
 * - **Sized by the page.** Every size is a fraction of the page's short side,
 *   so a pattern reads the same at A6 and A3 and still shows in a 56 px
 *   thumbnail. Colours come only from the cover's palette.
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

/** Add one polygon, clipped to the page, to the current path. */
function polygon(ctx: CanvasRenderingContext2D, g: PageGeometry, points: readonly Point[]): void {
  const clipped = clipPolygon(points, g.width, g.height);
  if (clipped.length < 3) return;
  ctx.moveTo(clipped[0][0], clipped[0][1]);
  for (let i = 1; i < clipped.length; i++) ctx.lineTo(clipped[i][0], clipped[i][1]);
  ctx.closePath();
}

/** A fixed hash of a cell, in [0, 1). Never `Math.random`: see the module note. */
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

function fillPath(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.fillStyle = color;
  ctx.fill();
}

function strokePath(ctx: CanvasRenderingContext2D, color: string, width: number): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

// --- Patterns -----------------------------------------------------------------

/** Polka: dots on a half-drop grid. */
export function polka(ctx: CanvasRenderingContext2D, c: CoverPaint): void {
  const g = c.geometry;
  const s = shortSide(g);
  const pitch = s * 0.075;
  const r = s * 0.017;
  ctx.beginPath();
  let row = 0;
  for (let y = pitch / 2; y + r <= g.height; y += pitch * 0.866, row++) {
    const offset = row % 2 === 0 ? pitch / 2 : pitch;
    for (let x = offset; x + r <= g.width; x += pitch) {
      if (x - r < 0 || y - r < 0) continue;
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
  }
  fillPath(ctx, c.palette.motif);
}

/** Stripes: broad diagonal bands, rising to the right. */
export function stripes(ctx: CanvasRenderingContext2D, c: CoverPaint): void {
  const g = c.geometry;
  const s = shortSide(g);
  const pitch = s * 0.085;
  const band = pitch * 0.38;
  ctx.beginPath();
  // Each band is a parallelogram between the lines x + y = k and k + band.
  for (let k = 0; k < g.width + g.height; k += pitch) {
    polygon(ctx, g, [
      [k, 0],
      [k + band, 0],
      [k + band - g.height, g.height],
      [k - g.height, g.height],
    ]);
  }
  fillPath(ctx, c.palette.motifSoft);
}

/** Graph: a fine grid with every fourth line heavier, as on engineering paper. */
export function graph(ctx: CanvasRenderingContext2D, c: CoverPaint): void {
  const g = c.geometry;
  const pitch = shortSide(g) * 0.028;
  for (const major of [false, true]) {
    ctx.beginPath();
    let i = 1;
    for (let x = pitch; x < g.width; x += pitch, i++) {
      if ((i % 4 === 0) !== major) continue;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, g.height);
    }
    i = 1;
    for (let y = pitch; y < g.height; y += pitch, i++) {
      if ((i % 4 === 0) !== major) continue;
      ctx.moveTo(0, y);
      ctx.lineTo(g.width, y);
    }
    const color = major ? c.palette.motif : c.palette.motifSoft;
    strokePath(ctx, color, (major ? 1.6 : 1) * c.weight);
  }
}

/** Waves: rows of gentle sine lines. */
export function waves(ctx: CanvasRenderingContext2D, c: CoverPaint): void {
  const g = c.geometry;
  const s = shortSide(g);
  const pitch = s * 0.05;
  const amp = s * 0.011;
  const length = s * 0.1;
  const step = length / 10;
  ctx.beginPath();
  let row = 0;
  for (let y = pitch / 2; y + amp <= g.height; y += pitch, row++) {
    const phase = row % 2 === 0 ? 0 : Math.PI;
    for (let x = 0; ; x = Math.min(g.width, x + step)) {
      const py = y + amp * Math.sin((x / length) * Math.PI * 2 + phase);
      if (x === 0) ctx.moveTo(x, py);
      else ctx.lineTo(x, py);
      if (x >= g.width) break;
    }
  }
  strokePath(ctx, c.palette.motif, Math.max(c.weight, s * 0.004));
}

/** Chevron: bold zigzag rows. */
export function chevron(ctx: CanvasRenderingContext2D, c: CoverPaint): void {
  const g = c.geometry;
  const s = shortSide(g);
  const pitch = s * 0.08;
  const half = s * 0.045;
  const amp = s * 0.022;
  ctx.beginPath();
  // Vertex k of a row sits at x = k·half, alternately below and above the
  // row's centre line; the last leg is cut where it meets the right edge.
  const zig = (k: number): number => (k % 2 === 0 ? amp : -amp);
  for (let y = pitch / 2; y + amp <= g.height; y += pitch) {
    ctx.moveTo(0, y + zig(0));
    for (let k = 1; ; k++) {
      const x = k * half;
      if (x >= g.width) {
        const t = (g.width - (k - 1) * half) / half;
        ctx.lineTo(g.width, y + zig(k - 1) + (zig(k) - zig(k - 1)) * t);
        break;
      }
      ctx.lineTo(x, y + zig(k));
    }
  }
  strokePath(ctx, c.palette.motifSoft, Math.max(c.weight, s * 0.016));
}

/** Mosaic: a grid of squares halved on the diagonal, each half one of three shades. */
export function mosaic(ctx: CanvasRenderingContext2D, c: CoverPaint): void {
  const g = c.geometry;
  const cell = shortSide(g) * 0.09;
  const groups: Array<{ color: string; shapes: Point[][] }> = [
    { color: c.palette.motifSoft, shapes: [] },
    { color: c.palette.motif, shapes: [] },
  ];
  for (let j = 0; j * cell < g.height; j++) {
    for (let i = 0; i * cell < g.width; i++) {
      const x = i * cell;
      const y = j * cell;
      const rising = cellHash(i, j, 0x3c) < 0.5;
      const halves: Point[][] = rising
        ? [
            [
              [x, y],
              [x + cell, y],
              [x, y + cell],
            ],
            [
              [x + cell, y],
              [x + cell, y + cell],
              [x, y + cell],
            ],
          ]
        : [
            [
              [x, y],
              [x + cell, y],
              [x + cell, y + cell],
            ],
            [
              [x, y],
              [x + cell, y + cell],
              [x, y + cell],
            ],
          ];
      halves.forEach((half, h) => {
        // Half of the triangles stay cloth; the rest split between two shades.
        const pick = cellHash(i * 2 + h, j, 0x91);
        if (pick < 0.5) return;
        groups[pick < 0.8 ? 0 : 1].shapes.push(half);
      });
    }
  }
  for (const group of groups) {
    ctx.beginPath();
    for (const shape of group.shapes) polygon(ctx, g, shape);
    fillPath(ctx, group.color);
  }
}

/** Irregular chips on a jittered grid, for terrazzo and the composition marble. */
function chips(
  ctx: CanvasRenderingContext2D,
  c: CoverPaint,
  pitch: number,
  sizes: readonly [number, number],
  shades: ReadonlyArray<{ color: string; share: number }>,
  seed: number,
): void {
  const g = c.geometry;
  const groups = shades.map((shade) => ({ ...shade, shapes: [] as Point[][] }));
  for (let j = 0; j * pitch < g.height; j++) {
    for (let i = 0; i * pitch < g.width; i++) {
      const pick = cellHash(i, j, seed);
      let acc = 0;
      const group = groups.find((grp) => (acc += grp.share) > pick);
      if (!group) continue;
      const cx = (i + cellHash(i, j, seed + 1)) * pitch;
      const cy = (j + cellHash(i, j, seed + 2)) * pitch;
      const r = sizes[0] + (sizes[1] - sizes[0]) * cellHash(i, j, seed + 3);
      const corners = 4 + Math.floor(cellHash(i, j, seed + 4) * 3);
      const turn = cellHash(i, j, seed + 5) * Math.PI * 2;
      const shape: Point[] = [];
      for (let k = 0; k < corners; k++) {
        const a = turn + (k / corners) * Math.PI * 2;
        const rk = r * (0.55 + 0.45 * cellHash(i * 7 + k, j, seed + 6));
        shape.push([cx + Math.cos(a) * rk, cy + Math.sin(a) * rk]);
      }
      group.shapes.push(shape);
    }
  }
  for (const group of groups) {
    ctx.beginPath();
    for (const shape of group.shapes) polygon(ctx, g, shape);
    fillPath(ctx, group.color);
  }
}

/** Terrazzo: scattered stone chips in two shades, a few bright ones. */
export function terrazzo(ctx: CanvasRenderingContext2D, c: CoverPaint): void {
  const s = shortSide(c.geometry);
  chips(
    ctx,
    c,
    s * 0.06,
    [s * 0.012, s * 0.032],
    [
      { color: c.palette.motifSoft, share: 0.35 },
      { color: c.palette.motif, share: 0.35 },
      { color: c.palette.fleck, share: 0.06 },
    ],
    0x5e,
  );
}

/** Composition: the dense mottled flecks of a classic school exercise book. */
export function composition(ctx: CanvasRenderingContext2D, c: CoverPaint): void {
  const s = shortSide(c.geometry);
  chips(
    ctx,
    c,
    s * 0.029,
    [s * 0.007, s * 0.021],
    [
      { color: c.palette.fleck, share: 0.55 },
      { color: c.palette.motif, share: 0.25 },
    ],
    0x7d,
  );
}

// --- Classic trims ------------------------------------------------------------

/** Strap: an elastic closure band running top to bottom near the right edge. */
export function strap(ctx: CanvasRenderingContext2D, c: CoverPaint): void {
  const band = c.layout.strap;
  if (!band) return;
  const { height } = c.geometry;
  ctx.fillStyle = c.palette.band;
  ctx.fillRect(band.x, 0, band.w, height);
  ctx.beginPath();
  for (const x of [band.x, band.x + band.w]) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  strokePath(ctx, c.palette.bandEdge, 1.5 * c.weight);
  // The elastic's woven rib, faint down its middle.
  ctx.beginPath();
  ctx.moveTo(band.x + band.w / 2, 0);
  ctx.lineTo(band.x + band.w / 2, height);
  strokePath(ctx, c.palette.motifSoft, c.weight);
}

/** Bound: the outer corners protected by darker triangles, as on a quarter-bound book. */
export function boundCorners(ctx: CanvasRenderingContext2D, c: CoverPaint): void {
  const g = c.geometry;
  const k = shortSide(g) * 0.17;
  const corners: Point[][] = [
    [
      [g.width - k, 0],
      [g.width, 0],
      [g.width, k],
    ],
    [
      [g.width, g.height - k],
      [g.width, g.height],
      [g.width - k, g.height],
    ],
  ];
  ctx.beginPath();
  for (const corner of corners) polygon(ctx, g, corner);
  fillPath(ctx, c.palette.band);
  ctx.beginPath();
  ctx.moveTo(g.width - k, 0);
  ctx.lineTo(g.width, k);
  ctx.moveTo(g.width, g.height - k);
  ctx.lineTo(g.width - k, g.height);
  strokePath(ctx, c.palette.bandEdge, 2 * c.weight);
}

/** Frame: a double border set in from the edge. */
export function frame(ctx: CanvasRenderingContext2D, c: CoverPaint): void {
  const g = c.geometry;
  const s = shortSide(g);
  const outer = s * 0.05;
  const inner = outer + s * 0.016;
  ctx.beginPath();
  ctx.rect(outer, outer, g.width - outer * 2, g.height - outer * 2);
  strokePath(ctx, c.palette.trim, Math.max(2.5 * c.weight, s * 0.005));
  ctx.beginPath();
  ctx.rect(inner, inner, g.width - inner * 2, g.height - inner * 2);
  strokePath(ctx, c.palette.trim, c.weight);
}

/** Fade: the cloth deepening toward the bottom, clear across the title. */
export function fade(ctx: CanvasRenderingContext2D, c: CoverPaint): void {
  const g = c.geometry;
  const gradient = ctx.createLinearGradient(0, 0, 0, g.height);
  gradient.addColorStop(0, withAlpha(c.palette.shade, 0));
  gradient.addColorStop(0.35, withAlpha(c.palette.shade, 0));
  gradient.addColorStop(1, withAlpha(c.palette.shade, 0.75));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, g.width, g.height);
}
