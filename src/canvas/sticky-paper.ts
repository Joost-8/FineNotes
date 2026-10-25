/**
 * A sticky note's paper, painted rather than loaded: no file per colour in
 * the vault, any colour, crisp at every zoom and in a PDF, and nothing to
 * decode before it shows. Everything is drawn inside the note's own box, so
 * the tiles a note covers are exactly the tiles its bounds name (a drop
 * shadow outside it would outlive a move in the tiles beside it).
 *
 * No DOM beyond the canvas context it is handed.
 */

import type { ImageElement } from "../model/document";
import { type NoteFrame, applyAffine, noteToPage } from "../model/sticky-notes";

/** How much darker the glued band at the top is. */
const GLUE_SHADE = 0.05;
/** The glued band's share of the note's height. */
const GLUE_SHARE = 0.16;
/** The note's edge. */
const EDGE = "rgba(0, 0, 0, 0.12)";

/**
 * Paint the paper of a note `w` by `h` in its own space (origin top-left),
 * in `color`: the colour, a faintly darker glued band at the top, and a
 * hairline edge. Flat colours only, so a tile, a thumbnail and a PDF show
 * the same paper.
 */
export function paintStickyPaper(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  color: string,
): void {
  if (!(w > 0) || !(h > 0)) return;
  ctx.save();
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = `rgba(0, 0, 0, ${GLUE_SHADE})`;
  ctx.fillRect(0, 0, w, h * GLUE_SHARE);
  // Half a page px inside, so the line stays within the note's box.
  const line = Math.min(1, w / 4, h / 4);
  ctx.strokeStyle = EDGE;
  ctx.lineWidth = line;
  ctx.strokeRect(line / 2, line / 2, w - line, h - line);
  ctx.restore();
}

/** Add the note's outline (turned and mirrored as it is placed), in page space, to `ctx`'s path. */
export function traceNote(ctx: CanvasRenderingContext2D, frame: NoteFrame): void {
  const m = noteToPage(frame);
  const corners = [
    applyAffine(m, 0, 0),
    applyAffine(m, frame.w, 0),
    applyAffine(m, frame.w, frame.h),
    applyAffine(m, 0, frame.h),
  ];
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
  ctx.closePath();
}

/**
 * Paint `inkOnNote` clipped to `note`, in page space: what is written on a
 * note never shows past its edge, as on paper.
 */
export function withinNote(
  ctx: CanvasRenderingContext2D,
  note: ImageElement,
  inkOnNote: () => void,
): void {
  ctx.save();
  ctx.beginPath();
  traceNote(ctx, note);
  ctx.clip();
  inkOnNote();
  ctx.restore();
}
