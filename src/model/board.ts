/**
 * Endless boards (FineNotes#46): a notebook kind for mind maps that is one
 * page which grows as you write near its edge. Its strokes keep fixed page
 * coordinates like any page's, so sync, undo and the drift fix hold; the
 * page itself just gets bigger, one {@link BOARD_BLOCK} at a time.
 *
 * Growing right or down only makes the page bigger. Growing left or up also
 * moves everything on it right or down by the same blocks, so the ink stays
 * where it was relative to the paper; the view moves along (`onShift`), so
 * the reader sees no jump. Both are one {@link GrowBoard} command, built on
 * the lasso's move ({@link TranslateElements}), which already covers every
 * kind of element. Pure.
 */

import { type Command } from "./commands";
import {
  type Bounds,
  type InkDocument,
  type Page,
  type PageComment,
  type PageGeometry,
  type PageSection,
  type Ruling,
  POINT_STRIDE,
  pageById,
} from "./document";
import { graphBounds } from "./graph-element";
import { TranslateElements } from "./selection-commands";
import { tableFloorSize } from "./table";
import { DEFAULT_LINE_HEIGHT } from "./text-style";

/**
 * The step a board grows by, page px (about 230 mm). A multiple of the dotted
 * (40) and squared (28) papers' spacing, so a shift by whole blocks keeps the
 * ink on the same dots and squares.
 */
export const BOARD_BLOCK = 1120;

/** A new board is this many blocks each way (about 1.1 m), the view in its middle. */
export const BOARD_START_BLOCKS = 5;

/**
 * A board stops growing at this many blocks each way (about 14 m). Well past
 * what anyone draws; it keeps a runaway (a stuck pen, a hand-edited file)
 * from making a page no device can hold. The notice on a full board is
 * FineNotes#46 phase 5.
 */
export const BOARD_MAX_BLOCKS = 60;

/** The papers a board offers: the three a mind map is drawn on. White, always. */
export const BOARD_RULINGS: readonly Ruling[] = ["blank", "dotted", "squared"];

/** Whether `doc` is an endless board. */
export function isBoard(doc: Pick<InkDocument, "endless">): boolean {
  return doc.endless === true;
}

/** The page a new board starts with: {@link BOARD_START_BLOCKS} blocks each way. */
export function boardStartGeometry(): PageGeometry {
  const side = BOARD_BLOCK * BOARD_START_BLOCKS;
  return { width: side, height: side };
}

// --- What is drawn -------------------------------------------------------------

/**
 * The box around everything on a board's page, page px: ink as far as it
 * reaches (half its width past the centreline), pictures as their turned
 * rectangles cover, text boxes, tables and graphs by their frames, comments
 * as points. `null` when the page is empty. A text box that sizes itself has
 * no stored height; one line of its font stands in for it, close enough to
 * decide when to grow.
 */
export function drawnBounds(page: Page): Bounds | null {
  const box: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const take = (minX: number, minY: number, maxX: number, maxY: number): void => {
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) return;
    box.minX = Math.min(box.minX, minX);
    box.minY = Math.min(box.minY, minY);
    box.maxX = Math.max(box.maxX, maxX);
    box.maxY = Math.max(box.maxY, maxY);
  };
  for (const stroke of page.strokes) {
    const pts = stroke.pts;
    const pad = Math.max(0, stroke.size) / 2;
    const usable = pts.length - (pts.length % POINT_STRIDE);
    for (let i = 0; i < usable; i += POINT_STRIDE) {
      take(pts[i] - pad, pts[i + 1] - pad, pts[i] + pad, pts[i + 1] + pad);
    }
  }
  for (const image of page.images) {
    const cx = image.x + image.w / 2;
    const cy = image.y + image.h / 2;
    const angle = image.rotation ?? 0;
    const cos = Math.abs(Math.cos(angle));
    const sin = Math.abs(Math.sin(angle));
    // Half the turned rectangle's extent along each axis.
    const hx = (image.w * cos + image.h * sin) / 2;
    const hy = (image.w * sin + image.h * cos) / 2;
    take(cx - hx, cy - hy, cx + hx, cy + hy);
  }
  for (const text of page.textBoxes) {
    const h = text.h ?? text.fontSize * (text.lineHeight ?? DEFAULT_LINE_HEIGHT);
    take(text.x, text.y, text.x + text.w, text.y + h);
  }
  for (const table of page.tables ?? []) {
    const size = tableFloorSize(table);
    take(table.x, table.y, table.x + size.w, table.y + size.h);
  }
  for (const graph of page.graphs ?? []) {
    const b = graphBounds(graph);
    take(b.minX, b.minY, b.maxX, b.maxY);
  }
  for (const comment of page.comments ?? []) take(comment.x, comment.y, comment.x, comment.y);
  return box.minX <= box.maxX && box.minY <= box.maxY ? box : null;
}

// --- The growth rule -----------------------------------------------------------

/** Blocks to add on each side of a board. All zero: it stays as it is. */
export interface BoardGrowth {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Whether a growth adds nothing. */
export function isNoGrowth(growth: BoardGrowth): boolean {
  return growth.left === 0 && growth.top === 0 && growth.right === 0 && growth.bottom === 0;
}

/**
 * How a board must grow so that what is drawn stays at least `reach` page px
 * from every edge: a screen of the view, so writing within a screen of an
 * edge adds paper there before the view can reach it. One block per side at
 * a time (writing on near the edge adds the next), except that ink already
 * past an edge gets as many blocks as it takes to hold it. Never past
 * {@link BOARD_MAX_BLOCKS} each way. Nothing drawn, or a reach that is no
 * length, grows nothing.
 */
export function boardGrowth(
  geometry: PageGeometry,
  drawn: Bounds | null,
  reach: { x: number; y: number },
): BoardGrowth {
  const none: BoardGrowth = { left: 0, top: 0, right: 0, bottom: 0 };
  if (!drawn) return none;
  const rx = Number.isFinite(reach.x) ? Math.max(0, reach.x) : 0;
  const ry = Number.isFinite(reach.y) ? Math.max(0, reach.y) : 0;
  // Blocks for a side whose drawing is `room` page px from its edge.
  const side = (room: number, near: number): number => {
    if (!(room < near)) return 0;
    return Math.max(1, Math.ceil(-room / BOARD_BLOCK));
  };
  const growth: BoardGrowth = {
    left: side(drawn.minX, rx),
    top: side(drawn.minY, ry),
    right: side(geometry.width - drawn.maxX, rx),
    bottom: side(geometry.height - drawn.maxY, ry),
  };
  const max = BOARD_BLOCK * BOARD_MAX_BLOCKS;
  const fit = (a: "left" | "top", b: "right" | "bottom", length: number): void => {
    let room = Math.floor((max - length) / BOARD_BLOCK);
    if (room <= 0) {
      growth[a] = 0;
      growth[b] = 0;
      return;
    }
    // The far side (right, down) gives way first: it needs no shift.
    growth[a] = Math.min(growth[a], room);
    room -= growth[a];
    growth[b] = Math.min(growth[b], room);
  };
  fit("left", "right", geometry.width);
  fit("top", "bottom", geometry.height);
  return growth;
}

// --- Growing ---------------------------------------------------------------------

/**
 * Grow a board's page by `growth` blocks, as one undo step. Left and top
 * blocks move everything on the page right and down by those blocks (the
 * lasso's {@link TranslateElements} over every element, plus the comments and
 * headings, which a selection never holds), so it all stays where it was on
 * the paper. `onShift` hears that move, page px, on every apply (`+`) and
 * invert (`-`): the view moves by it, so nothing on screen jumps.
 *
 * The page is held by id, as the other page commands hold it; an inverse
 * restores the exact geometry and positions it replaced.
 */
export class GrowBoard implements Command {
  readonly label = "Grow board";
  private applied: {
    geometry: PageGeometry;
    move: TranslateElements | null;
    comments: Array<{ comment: PageComment; x: number; y: number }>;
    sections: Array<{ section: PageSection; x: number; y: number }>;
  } | null = null;

  constructor(
    readonly pageId: string,
    readonly growth: BoardGrowth,
    private readonly onShift?: (dx: number, dy: number) => void,
  ) {}

  /** How far everything on the page moves, page px: right and down. */
  get shift(): { x: number; y: number } {
    return { x: this.growth.left * BOARD_BLOCK, y: this.growth.top * BOARD_BLOCK };
  }

  apply(doc: InkDocument): void {
    this.applied = null;
    const page = pageById(doc, this.pageId);
    if (!page) return;
    const { x: dx, y: dy } = this.shift;
    const geometry = page.geometry;
    page.geometry = {
      ...geometry,
      width: geometry.width + (this.growth.left + this.growth.right) * BOARD_BLOCK,
      height: geometry.height + (this.growth.top + this.growth.bottom) * BOARD_BLOCK,
    };
    let move: TranslateElements | null = null;
    const comments: Array<{ comment: PageComment; x: number; y: number }> = [];
    const sections: Array<{ section: PageSection; x: number; y: number }> = [];
    if (dx !== 0 || dy !== 0) {
      move = new TranslateElements(
        page.id,
        {
          strokes: page.strokes.slice(),
          images: page.images.slice(),
          textBoxes: page.textBoxes.slice(),
          tables: (page.tables ?? []).slice(),
          graphs: (page.graphs ?? []).slice(),
        },
        dx,
        dy,
      );
      move.apply(doc);
      for (const comment of page.comments ?? []) {
        comments.push({ comment, x: comment.x, y: comment.y });
        comment.x += dx;
        comment.y += dy;
      }
      for (const section of page.sections ?? []) {
        sections.push({ section, x: section.x, y: section.y });
        section.x += dx;
        section.y += dy;
      }
    }
    this.applied = { geometry, move, comments, sections };
    if (dx !== 0 || dy !== 0) this.onShift?.(dx, dy);
  }

  invert(doc: InkDocument): void {
    const applied = this.applied;
    const page = pageById(doc, this.pageId);
    if (!applied || !page) return;
    this.applied = null;
    page.geometry = applied.geometry;
    if (!applied.move) return;
    applied.move.invert(doc);
    // By identity, as the lasso's move restores: ids can repeat within a file.
    for (const { comment, x, y } of applied.comments) {
      comment.x = x;
      comment.y = y;
    }
    for (const { section, x, y } of applied.sections) {
      section.x = x;
      section.y = y;
    }
    const { x, y } = this.shift;
    this.onShift?.(-x, -y);
  }
}
