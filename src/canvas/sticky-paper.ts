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
import { type NoteFrame, applyAffine, foldedFrame, noteToPage } from "../model/sticky-notes";

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

/** How much of a folded note's icon its turned-down corner takes. */
const DOG_EAR = 0.3;

/**
 * Paint a folded note (page space): a small square of its paper at its
 * top-left corner, turned with it (`foldedFrame`), its corner turned down
 * and three short lines across it, as Goodnotes shows a collapsed note.
 * Flat colours, as the open paper.
 */
export function paintFoldedNote(
  ctx: CanvasRenderingContext2D,
  note: NoteFrame,
  color: string,
): void {
  const frame = foldedFrame(note);
  const s = frame.w;
  if (!(s > 0)) return;
  ctx.save();
  ctx.translate(frame.x + s / 2, frame.y + s / 2);
  const r = frame.rotation ?? 0;
  if (r !== 0) ctx.rotate(r);
  ctx.translate(-s / 2, -s / 2);
  const ear = s * DOG_EAR;
  // The paper, its bottom-right corner cut where it is turned down.
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(s, 0);
  ctx.lineTo(s, s - ear);
  ctx.lineTo(s - ear, s);
  ctx.lineTo(0, s);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  const line = Math.min(1, s / 20);
  ctx.lineWidth = line;
  ctx.strokeStyle = EDGE;
  ctx.stroke();
  // The turned-down corner, a shade darker.
  ctx.beginPath();
  ctx.moveTo(s, s - ear);
  ctx.lineTo(s - ear, s - ear);
  ctx.lineTo(s - ear, s);
  ctx.closePath();
  ctx.fillStyle = "rgba(0, 0, 0, 0.14)";
  ctx.fill();
  ctx.stroke();
  // Three lines of "writing".
  ctx.strokeStyle = "rgba(0, 0, 0, 0.32)";
  ctx.lineWidth = Math.max(line, s / 18);
  ctx.lineCap = "round";
  ctx.beginPath();
  for (const [y, end] of [
    [0.3, 0.74],
    [0.48, 0.74],
    [0.66, 0.5],
  ] as const) {
    ctx.moveTo(s * 0.22, s * y);
    ctx.lineTo(s * end, s * y);
  }
  ctx.stroke();
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
