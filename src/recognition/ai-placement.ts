/**
 * Where an AI answer lands on the page when it is placed as a text box.
 * (A generated picture goes through the view's shared `insertImageBytes`,
 * like every other picture.) Everything is in page space (contracts/api.md §1);
 * the only view input is the rectangle of the page that is on screen, so the
 * result appears where the reader is looking and not at the top of a page
 * they have zoomed away from.
 *
 * No DOM, no Obsidian.
 */

import type { InkDocument, PageGeometry } from "../model/document";

export interface PageRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A text box for an answer: a readable column near the top of the part of the
 * page in view, horizontally centred there, kept on the page.
 */
export function textBoxFrame(page: PageGeometry, view: PageRect | null): PageRect {
  const w = Math.min(520, page.width * 0.8);
  const area = view ?? { x: 0, y: 0, w: page.width, h: page.height };
  const x = clamp(area.x + (area.w - w) / 2, 0, page.width - w);
  const y = clamp(area.y + Math.min(48, area.h * 0.1), 0, Math.max(0, page.height - 60));
  return { x, y, w, h: 0 };
}

/** Room kept between what is drawn and a text box placed under it, page px. */
export const BELOW_GAP = 24;
/** Least room a text box placed under the drawing needs above the page's foot, page px. */
const BELOW_ROOM = 60;

/**
 * A text box placed under what is drawn (a pasted transcript): the column
 * of {@link textBoxFrame}, moved down to {@link BELOW_GAP} under `drawnBottom`
 * (the lowest point of the page's content) while that is lower than the
 * view's own spot and leaves room on the page. Above the view, or with no
 * room left, it is the view's spot after all.
 */
export function textBoxBelow(
  page: PageGeometry,
  view: PageRect | null,
  drawnBottom: number | null,
): PageRect {
  const frame = textBoxFrame(page, view);
  if (drawnBottom === null) return frame;
  const y = drawnBottom + BELOW_GAP;
  if (y <= frame.y || y > page.height - BELOW_ROOM) return frame;
  return { ...frame, y };
}

function clamp(value: number, min: number, max: number): number {
  return max < min ? min : Math.min(max, Math.max(min, value));
}

/**
 * The next free `<prefix><N>` id across every page ("i" images, "t" text
 * boxes) — the same scheme `duplicatePageAfter` and the surface use, so a
 * placed element can never collide with one already in the notebook.
 */
export function nextElementId(doc: InkDocument, prefix: "i" | "t"): string {
  const pattern = new RegExp(`^${prefix}(\\d+)$`);
  let max = 0;
  for (const page of doc.pages) {
    const items = prefix === "i" ? page.images : page.textBoxes;
    for (const item of items) {
      const match = pattern.exec(item.id);
      if (match) max = Math.max(max, Number(match[1]));
    }
  }
  return `${prefix}${max + 1}`;
}
