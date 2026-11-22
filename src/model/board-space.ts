/**
 * Insert space on an endless board (discussion #276): the notebook's
 * by-line insert space (`canvas/insert-space.ts`) for a page with no lines.
 * A press and a drag down push everything that starts below the pen's line
 * down, across the whole board; a drag right pushes everything that starts
 * right of it to the right. Dragged back (up or left), it closes empty space
 * up again, never over anything drawn.
 *
 * A board has no lines to keep ink on, so the step is the paper's own
 * spacing (dots, squares): ink pushed by whole steps stays on its dots.
 * The board grows to hold what was pushed past its edge by its usual rule
 * (`boardGrowth`, run after every step), so nothing here grows it.
 *
 * Every kind of thing on a board moves: ink, pictures, sticky notes (with
 * their ink and text), text boxes, tables, graphs, equations, and the pins
 * a selection never holds: comments, headings and named regions. Arrows
 * joining two shapes follow their shapes. A locked picture stays put. It is
 * all one {@link ShiftBoardSpace} command, so one undo puts it back.
 *
 * Pure: no DOM, no Obsidian. Page px throughout.
 */

import type { Command } from "./commands";
import {
  type Backdrop,
  type Bounds,
  type ImageElement,
  type InkDocument,
  type Page,
  type PageComment,
  type PageRegion,
  type PageSection,
  type ShapeKind,
  type Stroke,
  type TextBoxElement,
  POINT_STRIDE,
  pageById,
  strokeBounds,
} from "./document";
import { BOARD_BLOCK, BOARD_MAX_BLOCKS, textLinesHeight } from "./board";
import { graphBounds } from "./graph-element";
import { type ElementLists, TranslateElements } from "./selection-commands";
import { isNoteInk, noteIdsOf, withNoteInk, withNoteText } from "./sticky-notes";
import { tableFloorSize } from "./table";
import { resolveSpacing } from "../canvas/backdrop";
import { t } from "../i18n/translate";

/** Which way a board insert pushes: `y` down (a line across), `x` right (a line down). */
export type SpaceAxis = "x" | "y";

/** The step a board insert moves by on paper with no spacing of its own (blank), page px. */
export const BOARD_SPACE_STEP = 40;

/** An insert or a close-up on a board, worked out but not yet done. */
export interface BoardSpacePlan {
  /** The step to push, or null when nothing would move. */
  command: ShiftBoardSpace | null;
  /** How far it moves things, page px: positive pushes, negative closes up; 0 for nothing. */
  amount: number;
  /** Things moved, counted as the user sees them (a note with its ink is one). */
  moved: number;
}

/** Where something sits along one axis: its leading and trailing edge. */
interface Span {
  lead: number;
  trail: number;
}

function spanOf(bounds: Bounds, axis: SpaceAxis): Span {
  return axis === "y"
    ? { lead: bounds.minY, trail: bounds.maxY }
    : { lead: bounds.minX, trail: bounds.maxX };
}

/** A picture's box as it is turned, as `drawnBounds` takes it. */
function imageBounds(image: ImageElement): Bounds {
  const cx = image.x + image.w / 2;
  const cy = image.y + image.h / 2;
  const angle = image.rotation ?? 0;
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  const hx = (image.w * cos + image.h * sin) / 2;
  const hy = (image.w * sin + image.h * cos) / 2;
  return { minX: cx - hx, minY: cy - hy, maxX: cx + hx, maxY: cy + hy };
}

function box(x: number, y: number, w: number, h: number): Bounds {
  return { minX: x, minY: y, maxX: x + w, maxY: y + h };
}

/** What a plan moves, by identity, and what it leaves. */
interface Split {
  lists: ElementLists;
  comments: PageComment[];
  sections: PageSection[];
  regions: PageRegion[];
  /** Straight lines and arrows across the line: their ends past it move, so they stretch. */
  stretch: Stroke[];
  /** Things moved, as the user counts them. */
  count: number;
  /** The furthest trailing edge of what moves; -Infinity for nothing. */
  reach: number;
  /** The furthest trailing edge of what stays before the line; -Infinity for nothing. */
  before: number;
}

/** Shapes that stretch across an insert rather than stay: they join one thing to another. */
const STRETCHES: ReadonlySet<ShapeKind> = new Set<ShapeKind>(["line", "arrow"]);

/**
 * Split a board's things at the line `at` along `axis`: whatever starts at
 * or past it moves; whatever starts before it stays, even where it reaches
 * past (a frame round a group, handwriting), as a tall drawing on lined
 * paper stays when space is inserted inside it. A straight line or arrow
 * across the line stretches instead: its end past the line moves, so a
 * branch of a mind map stays joined to what it points at.
 */
function split(
  page: Page,
  axis: SpaceAxis,
  at: number,
  textHeight: (text: TextBoxElement) => number,
): Split {
  const out: Split = {
    lists: { strokes: [], images: [], textBoxes: [], tables: [], graphs: [], equations: [] },
    comments: [],
    sections: [],
    regions: [],
    stretch: [],
    count: 0,
    reach: -Infinity,
    before: -Infinity,
  };
  const take = <T>(list: T[], item: T, bounds: Bounds | null, pinned = false): void => {
    if (!bounds) return;
    const span = spanOf(bounds, axis);
    if (!pinned && span.lead >= at) {
      list.push(item);
      out.count++;
      out.reach = Math.max(out.reach, span.trail);
    } else if (span.lead < at) {
      out.before = Math.max(out.before, span.trail);
    }
  };
  // A note's ink and text go where the note goes, never on their own.
  const notes = noteIdsOf(page.images);
  for (const stroke of page.strokes) {
    if (isNoteInk(stroke, notes)) continue;
    const b = strokeBounds(stroke);
    const pad = Math.max(0, stroke.size) / 2;
    const span = b && spanOf(b, axis);
    if (span && stroke.shape && STRETCHES.has(stroke.shape) && span.lead < at && span.trail >= at) {
      out.stretch.push(stroke);
      out.count++;
      out.reach = Math.max(out.reach, span.trail + pad);
      // Its near end must stay before any space closed up.
      out.before = Math.max(out.before, span.lead + pad);
      continue;
    }
    take(
      out.lists.strokes,
      stroke,
      b && { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad },
    );
  }
  for (const image of page.images) {
    take(out.lists.images, image, imageBounds(image), image.locked === true);
  }
  for (const text of page.textBoxes) {
    if (text.onSticky !== undefined && notes?.has(text.onSticky)) continue;
    take(out.lists.textBoxes, text, box(text.x, text.y, text.w, text.h ?? textHeight(text)));
  }
  for (const table of page.tables ?? []) {
    const size = tableFloorSize(table);
    take(out.lists.tables as TableList, table, box(table.x, table.y, size.w, size.h));
  }
  for (const graph of page.graphs ?? []) {
    take(out.lists.graphs as GraphList, graph, graphBounds(graph));
  }
  for (const eq of page.equations ?? []) {
    take(out.lists.equations as EquationList, eq, box(eq.x, eq.y, eq.w, eq.h));
  }
  for (const comment of page.comments ?? []) {
    take(out.comments, comment, box(comment.x, comment.y, 0, 0));
  }
  for (const section of page.sections ?? []) {
    take(out.sections, section, box(section.x, section.y, 0, 0));
  }
  for (const region of page.regions ?? []) {
    take(out.regions, region, box(region.x, region.y, region.w, region.h));
  }
  out.lists.strokes = withNoteInk(page, out.lists);
  out.lists.textBoxes = withNoteText(page, out.lists);
  return out;
}

type TableList = NonNullable<ElementLists["tables"]>;
type GraphList = NonNullable<ElementLists["graphs"]>;
type EquationList = NonNullable<ElementLists["equations"]>;

/**
 * Plan pushing everything on a board's `page` that starts at or past `at`
 * along `axis` by `amount` page px (rounded to whole `step`s, toward zero),
 * or for a negative amount, closing up as much of that as is empty just
 * before the line. A push never takes anything past `limit` along the axis:
 * the largest board (`BOARD_MAX_BLOCKS`) by default, or a notebook page's
 * own edge on paper with no lines; a close-up never goes over anything
 * drawn, nor past the page's start.
 */
export function planBoardSpace(
  page: Page,
  axis: SpaceAxis,
  at: number,
  amount: number,
  step: number,
  textHeight: (text: TextBoxElement) => number = textLinesHeight,
  limit: number = BOARD_BLOCK * BOARD_MAX_BLOCKS,
): BoardSpacePlan {
  const none: BoardSpacePlan = { command: null, amount: 0, moved: 0 };
  if (![at, amount, step].every(Number.isFinite) || !(step > 0)) return none;
  const steps = Math.trunc(amount / step);
  if (steps === 0) return none;
  const parts = split(page, axis, at, textHeight);
  if (parts.count === 0) return none;
  let shift: number;
  if (steps > 0) {
    const room = Math.max(0, limit - parts.reach);
    shift = Math.min(steps, Math.floor(room / step)) * step;
  } else {
    // Empty from what stays (or the board's edge) to the line.
    // Something before the line reaching past it leaves none.
    const empty = Math.max(0, at - Math.max(0, parts.before));
    shift = -Math.min(-steps, Math.floor(empty / step)) * step;
  }
  if (!(Math.abs(shift) > 0)) return none;
  return {
    command: new ShiftBoardSpace(page.id, axis, at, shift, parts),
    amount: shift,
    moved: parts.count,
  };
}

/**
 * Move a board's things, picked by a plan, by `shift` along one axis: the
 * elements through the lasso's own move ({@link TranslateElements}), and
 * the comments, headings and named regions with them. Held by identity, as
 * the lasso's move is: ids can repeat within a file.
 */
export class ShiftBoardSpace implements Command {
  readonly label: string;
  private move: TranslateElements | null = null;
  private pins: Array<{ pin: { x: number; y: number }; x: number; y: number }> = [];
  private stretched: Array<{ stroke: Stroke; pts: number[] }> = [];

  constructor(
    readonly pageId: string,
    readonly axis: SpaceAxis,
    readonly at: number,
    readonly shift: number,
    private readonly parts: Pick<Split, "lists" | "comments" | "sections" | "regions" | "stretch">,
  ) {
    this.label = shift > 0 ? t("surface.command.insertSpace") : t("surface.command.removeSpace");
  }

  apply(doc: InkDocument): void {
    this.move = null;
    this.pins = [];
    this.stretched = [];
    const page = pageById(doc, this.pageId);
    if (!page) return;
    const dx = this.axis === "x" ? this.shift : 0;
    const dy = this.axis === "y" ? this.shift : 0;
    this.move = new TranslateElements(page.id, this.parts.lists, dx, dy);
    this.move.apply(doc);
    const { comments, sections, regions } = this.parts;
    const present = <T>(list: readonly T[] | undefined, chosen: readonly T[]): T[] => {
      const on = new Set(list ?? []);
      return chosen.filter((item) => on.has(item));
    };
    for (const pin of [
      ...present(page.comments, comments),
      ...present(page.sections, sections),
      ...present(page.regions, regions),
    ]) {
      this.pins.push({ pin, x: pin.x, y: pin.y });
      pin.x += dx;
      pin.y += dy;
    }
    // Every point at or past the line moves; a fresh array, so the path cache traces it again.
    const along = this.axis === "x" ? 0 : 1;
    for (const stroke of present(page.strokes, this.parts.stretch)) {
      const pts = stroke.pts;
      const next = pts.slice();
      const usable = next.length - (next.length % POINT_STRIDE);
      for (let i = 0; i < usable; i += POINT_STRIDE) {
        if (next[i + along] >= this.at) next[i + along] += this.shift;
      }
      this.stretched.push({ stroke, pts });
      stroke.pts = next;
    }
  }

  invert(doc: InkDocument): void {
    if (!this.move) return;
    this.move.invert(doc);
    this.move = null;
    for (const { pin, x, y } of this.pins) {
      pin.x = x;
      pin.y = y;
    }
    this.pins = [];
    for (const { stroke, pts } of this.stretched) stroke.pts = pts;
    this.stretched = [];
  }
}

/**
 * The band a drag would open (or close) on a board of `width` by `height`,
 * for drawing while it is dragged: from the line on by `amount`, the whole
 * board across.
 */
export function boardSpaceStrip(
  axis: SpaceAxis,
  at: number,
  amount: number,
  width: number,
  height: number,
): Bounds {
  const from = amount >= 0 ? at : at + amount;
  const to = amount >= 0 ? at + amount : at;
  return axis === "y"
    ? { minX: 0, maxX: width, minY: from, maxY: to }
    : { minX: from, maxX: to, minY: 0, maxY: height };
}

/**
 * The step a board insert moves by: the paper's own spacing, so ink stays
 * on its dots and squares; {@link BOARD_SPACE_STEP} on blank paper.
 */
export function boardSpaceStep(backdrop: Backdrop): number {
  if (backdrop.kind === "pdf" || backdrop.kind === "blank") return BOARD_SPACE_STEP;
  return resolveSpacing(backdrop.spacing, backdrop.kind);
}
