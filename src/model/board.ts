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
 *
 * Export and what the AI reads take the drawing alone ({@link boardDrawing}),
 * Ask what is on screen; search and the contents go to the word or heading,
 * x and y. Still page-shaped, for phase 4 of the issue (each marked
 * `TODO(#46 phase 4)` where it lives): Grape's reading (by area, not the
 * whole page) and the home-screen thumbnail (the whole drawing).
 * Phase 5 measures a full board zoomed out on the iPad and adds the notice.
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
  type TextBoxElement,
  POINT_STRIDE,
  pageById,
} from "./document";
import { graphBounds } from "./graph-element";
import { TranslateElements } from "./selection-commands";
import { tableFloorSize } from "./table";
import { DEFAULT_LINE_HEIGHT } from "./text-style";
import { t } from "../i18n/translate";

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
 * no stored height: `textHeight` gives it. Measuring needs a canvas, so the
 * default ({@link textLinesHeight}) counts the text's lines without wrapping
 * them, close enough to decide when to grow; a cut for export measures.
 */
export function drawnBounds(
  page: Page,
  textHeight: (text: TextBoxElement) => number = textLinesHeight,
): Bounds | null {
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
    take(text.x, text.y, text.x + text.w, text.y + (text.h ?? textHeight(text)));
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

/**
 * A self-sizing text box's height without a canvas: one line of its font for
 * each line of its text, as if none wrapped. Never less than one line, as
 * the textarea is.
 */
export function textLinesHeight(text: TextBoxElement): number {
  const lines = Math.max(1, text.text.split("\n").length);
  return lines * text.fontSize * (text.lineHeight ?? DEFAULT_LINE_HEIGHT);
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
  readonly label = t("surface.command.growBoard");
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

// --- The drawing alone ---------------------------------------------------------

/**
 * The step a board's drawing is cut out at, page px: a multiple of the
 * dotted (40) and squared (28) papers' spacing, so the cut keeps the ink on
 * the same dots and squares.
 */
export const BOARD_CUT_STEP = 280;

/** Paper kept round the drawing when it is cut out, at least, page px (about 3 cm). */
export const BOARD_CUT_MARGIN = 160;

/**
 * The part of a board's page that holds its drawing, page px: what is drawn
 * with {@link BOARD_CUT_MARGIN} round it, out to whole
 * {@link BOARD_CUT_STEP}s, inside the page. An empty board gives one block
 * in its middle. `textHeight` measures self-sizing text boxes, as in
 * {@link drawnBounds}: pass the renderer's, or a long one is cut off.
 */
export function boardDrawingBox(
  page: Page,
  textHeight?: (text: TextBoxElement) => number,
): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const { width, height } = page.geometry;
  const down = (v: number): number => Math.floor(v / BOARD_CUT_STEP) * BOARD_CUT_STEP;
  const up = (v: number): number => Math.ceil(v / BOARD_CUT_STEP) * BOARD_CUT_STEP;
  const drawn = drawnBounds(page, textHeight) ?? {
    minX: width / 2 - BOARD_BLOCK / 2 + BOARD_CUT_MARGIN,
    minY: height / 2 - BOARD_BLOCK / 2 + BOARD_CUT_MARGIN,
    maxX: width / 2 + BOARD_BLOCK / 2 - BOARD_CUT_MARGIN,
    maxY: height / 2 + BOARD_BLOCK / 2 - BOARD_CUT_MARGIN,
  };
  const x = Math.max(0, down(drawn.minX - BOARD_CUT_MARGIN));
  const y = Math.max(0, down(drawn.minY - BOARD_CUT_MARGIN));
  const right = Math.max(x + BOARD_CUT_STEP, Math.min(width, up(drawn.maxX + BOARD_CUT_MARGIN)));
  const bottom = Math.max(y + BOARD_CUT_STEP, Math.min(height, up(drawn.maxY + BOARD_CUT_MARGIN)));
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * A board's page cut down to its drawing ({@link boardDrawingBox}), for an
 * export or for the AI to read: a copy, everything on it moved by the cut,
 * so a PDF page is the size of the drawing and not metres of empty paper.
 * `box` cuts another part out (what is on screen, for Ask). The page itself
 * is not touched.
 */
export function boardDrawing(
  page: Page,
  box: { x: number; y: number; width: number; height: number } = boardDrawingBox(page),
): Page {
  const { width, height } = page.geometry;
  if (box.x === 0 && box.y === 0 && box.width === width && box.height === height) return page;
  const copy = structuredClone(page);
  copy.geometry = { ...copy.geometry, width: box.width, height: box.height };
  if (box.x === 0 && box.y === 0) return copy;
  const doc = { pages: [copy] } as unknown as InkDocument;
  new TranslateElements(
    copy.id,
    {
      strokes: copy.strokes.slice(),
      images: copy.images.slice(),
      textBoxes: copy.textBoxes.slice(),
      tables: (copy.tables ?? []).slice(),
      graphs: (copy.graphs ?? []).slice(),
    },
    -box.x,
    -box.y,
  ).apply(doc);
  for (const item of [...(copy.comments ?? []), ...(copy.sections ?? [])]) {
    item.x -= box.x;
    item.y -= box.y;
  }
  return copy;
}
