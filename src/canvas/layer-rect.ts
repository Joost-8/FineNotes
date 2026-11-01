/**
 * Where a stroke's ink lands on a canvas, in whole device px: the scratch
 * area a translucent stroke is drawn into opaque before it is laid down
 * once (FineNotes#85). PURE.
 */

import type { InkRun } from "../ink/freehand";

/** A 2D affine transform, as `CanvasRenderingContext2D.getTransform()` gives it. */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/** A rectangle of whole device px. */
export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The device-px rectangle the runs cover through `m` (each run's half width
 * and a pixel of anti-aliasing included), cut to the canvas's `width` and
 * `height`; null when nothing of it is on the canvas.
 */
export function inkPixelRect(
  runs: readonly InkRun[],
  m: Affine,
  width: number,
  height: number,
): PixelRect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const run of runs) {
    const r = run.width / 2;
    for (let i = 0; i + 1 < run.pts.length; i += 2) {
      const x = run.pts[i];
      const y = run.pts[i + 1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      minX = Math.min(minX, x - r);
      minY = Math.min(minY, y - r);
      maxX = Math.max(maxX, x + r);
      maxY = Math.max(maxY, y + r);
    }
  }
  if (!(minX <= maxX && minY <= maxY)) return null;
  // The box's corners through the transform: a turned page turns it too.
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [px, py] of [
    [minX, minY],
    [maxX, minY],
    [minX, maxY],
    [maxX, maxY],
  ]) {
    const dx = m.a * px + m.c * py + m.e;
    const dy = m.b * px + m.d * py + m.f;
    x0 = Math.min(x0, dx);
    y0 = Math.min(y0, dy);
    x1 = Math.max(x1, dx);
    y1 = Math.max(y1, dy);
  }
  if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
  const left = Math.max(0, Math.floor(x0) - 1);
  const top = Math.max(0, Math.floor(y0) - 1);
  const right = Math.min(width, Math.ceil(x1) + 1);
  const bottom = Math.min(height, Math.ceil(y1) + 1);
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, w: right - left, h: bottom - top };
}
