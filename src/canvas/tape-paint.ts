/**
 * How a cover tape (`model/cover-tape`) is painted, in whatever space `ctx`
 * is in (page space everywhere it is used).
 *
 * Covered, it is a strip of masking tape: opaque in its colour, with faint
 * fibres along it and torn ends, so it reads as something laid on the page
 * and not as ink. Revealed (in the view only, never in a file or an export),
 * it is a faint wash of its colour inside a dashed outline: what is under it
 * shows, and so does where the tape is, to tap it covered again.
 *
 * Draws with canvas calls only (no `Path2D`), so the tests' stand-in context
 * records it.
 */

import { tapeCorners } from "../model/cover-tape";
import { nightColor } from "./night";

/** Teeth along each torn end, at least; a tall tape gets more. */
const MIN_TEETH = 5;
/** How deep a torn end's teeth bite, as a share of the tape's height. */
const TOOTH_DEPTH = 0.06;
/** The fibres' spacing across the tape, as a share of its height. */
const FIBRE_STEP = 0.22;
/** A revealed tape's wash, 0..1. */
const REVEALED_WASH = 0.16;

export interface TapeLook {
  /** Shown through (this session's view only). */
  revealed?: boolean;
  /** On a night page (`./night`): the colour is shown as the night shows ink. */
  night?: boolean;
  /** Times the outline's width, so it stays a hairline at any zoom: page px per device px. */
  hairline?: number;
}

/** A point, page px. */
interface P {
  x: number;
  y: number;
}

function lerp(a: P, b: P, t: number): P {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * The tape's outline, its two long edges straight and its ends torn: the
 * points round it, from the first corner. `corners` is `tapeCorners`' order
 * (a-left, b-left, b-right, a-right).
 */
export function tornOutline(corners: readonly P[], size: number): P[] {
  const [al, bl, br, ar] = corners;
  const teeth = Math.max(MIN_TEETH, Math.round(size / 8));
  const depth = size * TOOTH_DEPTH;
  // Inward along the tape, at each end.
  const length = Math.hypot(bl.x - al.x, bl.y - al.y) || 1;
  const ux = (bl.x - al.x) / length;
  const uy = (bl.y - al.y) / length;
  const bite = Math.min(depth, length / 4);
  const torn = (from: P, to: P, inward: number): P[] => {
    const out: P[] = [];
    for (let i = 1; i < teeth * 2; i++) {
      const p = lerp(from, to, i / (teeth * 2));
      const d = i % 2 === 1 ? bite * inward : 0;
      out.push({ x: p.x + ux * d, y: p.y + uy * d });
    }
    return out;
  };
  return [al, bl, ...torn(bl, br, -1), br, ar, ...torn(ar, al, 1)];
}

function tracePolygon(ctx: CanvasRenderingContext2D, points: readonly P[]): void {
  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
}

/**
 * Paint a tape from its stored points (first and last: the middles of its
 * ends) and height `size`, in `color`. Nothing for a tape with no points or
 * no height.
 */
export function paintTape(
  ctx: CanvasRenderingContext2D,
  pts: readonly number[],
  size: number,
  color: string,
  look: TapeLook = {},
): void {
  const corners = tapeCorners(pts, size);
  if (!corners) return;
  const fill = look.night ? nightColor(color) : color;
  const outline = tornOutline(corners, size);
  ctx.save();
  if (look.revealed) {
    tracePolygon(ctx, corners);
    ctx.globalAlpha *= REVEALED_WASH;
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.globalAlpha /= REVEALED_WASH;
    ctx.strokeStyle = fill;
    ctx.lineWidth = Math.max(1.5 * (look.hairline ?? 1), size * 0.04);
    ctx.setLineDash([size * 0.18, size * 0.12]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    return;
  }
  tracePolygon(ctx, outline);
  ctx.fillStyle = fill;
  ctx.fill();
  // Fibres: a few faint lines along the tape, inside it.
  ctx.clip();
  ctx.strokeStyle = look.night ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)";
  ctx.lineWidth = Math.max(0.5, size * 0.03);
  const [al, bl, br, ar] = corners;
  ctx.beginPath();
  for (let t = FIBRE_STEP / 2; t < 1; t += FIBRE_STEP) {
    const from = lerp(al, ar, t);
    const to = lerp(bl, br, t);
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
  }
  ctx.stroke();
  ctx.restore();
}
