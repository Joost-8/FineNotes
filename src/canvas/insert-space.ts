/**
 * Insert space: move everything from one line down by whole lines, within
 * one block of lines (a column), and close empty lines up again
 * (FineNotes#20, after Stylus Labs Write's ruled insert space).
 *
 * Ink pushed past a page's last line flows onto the next page, as text
 * flows in a word processor: it lands on the next page's first lines, whose
 * own ink moves down to make room, and so on. When the next page is ruled
 * differently, or there is none, a new page with the same paper is put in
 * between, so ink never lands on lines that do not match. Closing up only
 * takes empty lines and never pulls ink back from the next page.
 *
 * Everything is one command, so one undo puts every page back.
 *
 * PURE: no DOM. Page px throughout.
 */

import { AddPage } from "../model/commands";
import { SetSection } from "../model/contents";
import { SetLink } from "../model/links";
import { SetTask } from "../model/tasks";
import type { Command } from "../model/commands";
import {
  type Bounds,
  type ImageElement,
  type InkDocument,
  type Page,
  type PageSection,
  type Stroke,
  type TextBoxElement,
  strokeBounds,
} from "../model/document";
import { CompositeCommand, nextPageId } from "../model/page-commands";
import {
  AddElements,
  type ElementLists,
  RemoveElements,
  TranslateElements,
} from "../model/selection-commands";
import { isNoteInk, noteIdsOf, withNoteInk } from "../model/sticky-notes";
import { DRAWING_PITCHES, MARGIN_SHARE, linedItems } from "./ruled-ink";
import {
  type LineBlock,
  type LineRef,
  lineAt,
  lineBand,
  ruleBand,
  lineOfBounds,
  sameLines,
} from "./writing-lines";

/**
 * A line counts as written on when ink covers more than this share of its
 * band: a descender reaching into the line below covers less.
 */
export const USED_SHARE = 0.25;

/** What the planner needs to know that only the view can say. */
export interface SpaceLayout {
  /** A page's lines (`writingLines` for its backdrop). */
  lines(page: Page): LineBlock[];
  /** A text box's frame, with its height measured. */
  textBoxBounds(page: Page, textBox: TextBoxElement): Bounds;
}

/** An insert or a close-up, worked out but not yet done. */
export interface SpacePlan {
  /** The step to push, or null when nothing would move. */
  command: Command | null;
  /** Lines inserted (positive) or closed up (negative); 0 when nothing happens. */
  lines: number;
  /** Elements moved, on any page. */
  moved: number;
  /** Elements carried onto a following page. */
  spilled: number;
  /** New pages put in for them. */
  addedPages: number;
}

/** Where an insert starts: a line in a block. */
export type SpaceTarget = LineRef;

/**
 * The line an insert-space drag starts from, when the pen goes down in a
 * block's margin: left of its lines (a page's margin, a column's own left
 * strip), next to a line. Null anywhere else.
 */
export function spaceTargetAt(
  blocks: readonly LineBlock[],
  width: number,
  x: number,
  y: number,
): SpaceTarget | null {
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const { left, right } = marginStrip(blocks, b, width);
    if (x < left || x >= right) continue;
    const ref = lineAt([b], b.x0, y);
    if (ref) return { block: i, line: ref.line };
  }
  return null;
}

/**
 * A block's strip in the margin, where a press starts an insert: a block
 * with another block just left of it starts its strip at its own edge;
 * otherwise the whole margin to the page's edge is its own.
 */
function marginStrip(
  blocks: readonly LineBlock[],
  block: LineBlock,
  width: number,
): { left: number; right: number } {
  const neighbour = blocks.some((o) => o !== block && Math.abs(o.x1 - block.x0) < 1);
  return { left: neighbour ? block.x0 : 0, right: block.x0 + width * MARGIN_SHARE };
}

/** Where a block's insert-space markers go: one per line, down the middle of its margin strip. */
export interface SpaceHandles {
  /** The strip's middle, page px. */
  x: number;
  /** The rule above the first line; one pitch per line from there. */
  top: number;
  pitch: number;
  lines: number;
}

/**
 * The markers that show where a press starts an insert: a column in each
 * block's margin strip, one level with each line (between its rule and the
 * rule above), so they line up with the paper.
 */
export function spaceHandles(blocks: readonly LineBlock[], width: number): SpaceHandles[] {
  return blocks
    .filter((b) => b.baselines.length > 0)
    .map((b) => {
      const { left, right } = marginStrip(blocks, b, width);
      return {
        x: (left + right) / 2,
        top: ruleBand(b, 0).top,
        pitch: b.pitch,
        lines: b.baselines.length,
      };
    });
}

type Element =
  | { kind: "stroke"; el: Stroke }
  | { kind: "image"; el: ImageElement }
  | { kind: "textBox"; el: TextBoxElement };

interface Placed {
  element: Element;
  bounds: Bounds;
  /** The line it moves with: where it sits, or for a drawing, where its top is. */
  line: LineRef | null;
  /** A locked picture: it holds its lines, but never moves. */
  pinned: boolean;
}

/**
 * Every element on a page, with the line it moves with. Writing moves with
 * the line it sits on. A drawing taller than {@link DRAWING_PITCHES} lines
 * moves with the line its top is on, so space inserted above it moves it
 * and space inserted inside it leaves it where it is; one whose top is
 * above the block never moves.
 */
function placedOn(page: Page, blocks: readonly LineBlock[], layout: SpaceLayout): Placed[] {
  const place = (element: Element, bounds: Bounds, sits: LineRef | null): Placed => {
    let line = sits;
    if (sits) {
      const block = blocks[sits.block];
      if (bounds.maxY - bounds.minY > block.pitch * DRAWING_PITCHES) {
        const top = Math.floor((bounds.minY - lineBand(block, 0).top) / block.pitch);
        line = top >= 0 ? { block: sits.block, line: top } : null;
      }
    }
    const pinned = element.kind === "image" && element.el.locked === true;
    return { element, bounds, line, pinned };
  };
  // A note's ink goes where its note goes (`listsOf`), never on its own.
  const notes = noteIdsOf(page.images);
  const ink = notes ? page.strokes.filter((stroke) => !isNoteInk(stroke, notes)) : page.strokes;
  return [
    ...linedItems(blocks, ink, strokeBounds).map((l) =>
      place({ kind: "stroke", el: l.item }, l.bounds, l.line),
    ),
    ...page.images.map((el) => {
      const bounds = { minX: el.x, minY: el.y, maxX: el.x + el.w, maxY: el.y + el.h };
      return place({ kind: "image", el }, bounds, lineOfBounds(blocks, bounds));
    }),
    ...page.textBoxes.map((el) => {
      const bounds = layout.textBoxBounds(page, el);
      return place({ kind: "textBox", el }, bounds, lineOfBounds(blocks, bounds));
    }),
  ];
}

function listsOf(page: Page, placed: readonly Placed[]): ElementLists {
  const lists: ElementLists = { strokes: [], images: [], textBoxes: [] };
  for (const { element } of placed) {
    if (element.kind === "stroke") lists.strokes.push(element.el);
    else if (element.kind === "image") lists.images.push(element.el);
    else lists.textBoxes.push(element.el);
  }
  lists.strokes = withNoteInk(page, lists);
  return lists;
}

/** What one plan collects as it walks down the pages. */
interface Walk {
  doc: InkDocument;
  layout: SpaceLayout;
  /** The pages as they will be, new ones included. */
  pages: Page[];
  added: Command[];
  moves: Command[];
  moved: number;
  spilled: number;
  nextId: () => string;
}

/**
 * Plan inserting `count` lines at `target` on page `pageIndex` (or, for a
 * negative count, closing up to that many empty lines just above it).
 */
export function planInsertSpace(
  doc: InkDocument,
  pageIndex: number,
  target: SpaceTarget,
  count: number,
  layout: SpaceLayout,
): SpacePlan {
  const none: SpacePlan = { command: null, lines: 0, moved: 0, spilled: 0, addedPages: 0 };
  const page = doc.pages[pageIndex];
  if (!page || !Number.isInteger(count) || count === 0) return none;
  const blocks = layout.lines(page);
  if (!blocks[target.block]) return none;
  let idNumber = Number(nextPageId(doc).slice(1));
  const walk: Walk = {
    doc,
    layout,
    pages: [...doc.pages],
    added: [],
    moves: [],
    moved: 0,
    spilled: 0,
    nextId: () => `p${idNumber++}`,
  };
  const lines = count > 0 ? count : -closeUp(walk, pageIndex, target, -count);
  if (count > 0) pushDown(walk, pageIndex, target, count);
  if (walk.moves.length === 0) return none;
  const label = count > 0 ? "Insert space" : "Remove space";
  return {
    command: new CompositeCommand(label, [...walk.added, ...walk.moves]),
    lines,
    moved: walk.moved,
    spilled: walk.spilled,
    addedPages: walk.added.length,
  };
}

/** Move everything on and below `target` down `count` lines, spilling onto the next page. */
function pushDown(walk: Walk, pageIndex: number, target: SpaceTarget, count: number): void {
  const page = walk.pages[pageIndex];
  const blocks = walk.layout.lines(page);
  const block = blocks[target.block];
  if (!block) return;
  const n = block.baselines.length;
  const dy = count * block.pitch;
  const below = placedOn(page, blocks, walk.layout).filter(
    (p) => !p.pinned && p.line?.block === target.block && p.line.line >= target.line,
  );
  const marks = sectionsFrom(page, blocks, target);
  if (below.length === 0 && marks.length === 0) return;
  const stay: Placed[] = [];
  const spill: Array<{ placed: Placed; from: number; to: number }> = [];
  for (const placed of below) {
    const from = (placed.line as LineRef).line;
    const to = from + count;
    if (to < n && placed.bounds.maxY + dy <= page.geometry.height) stay.push(placed);
    else spill.push({ placed, from, to: Math.max(0, to - n) });
  }
  const spillMarks: Array<{ section: PageSection; from: number; to: number }> = [];
  for (const { section, line } of marks) {
    const to = line + count;
    if (to < n) walk.moves.push(new SetSection(page, section.id, moved(section, dy)));
    else spillMarks.push({ section, from: line, to: to - n });
  }
  if (stay.length > 0) {
    walk.moves.push(new TranslateElements(page.id, listsOf(page, stay), 0, dy));
    walk.moved += stay.length;
  }
  if (spill.length === 0 && spillMarks.length === 0) return;

  // The page the spill lands on: the next one when it is ruled the same,
  // after its own ink has moved down out of the way; otherwise a new page.
  const nextIndex = pageIndex + 1;
  let next = walk.pages[nextIndex];
  const matches =
    next !== undefined &&
    next.geometry.width === page.geometry.width &&
    next.geometry.height === page.geometry.height &&
    sameLines(walk.layout.lines(next), blocks);
  if (matches) {
    const room = Math.max(...spill.map((s) => s.to), ...spillMarks.map((s) => s.to)) + 1;
    pushDown(walk, nextIndex, { block: target.block, line: 0 }, room);
  } else {
    next = {
      id: walk.nextId(),
      kind: "ink",
      geometry: { ...page.geometry },
      backdrop: { ...page.backdrop },
      strokes: [],
      images: [],
      textBoxes: [],
    };
    walk.pages.splice(nextIndex, 0, next);
    walk.added.push(new AddPage(nextIndex, next));
  }
  // Each element keeps its place relative to its line.
  const byShift = new Map<number, Placed[]>();
  for (const s of spill) {
    const shift = block.baselines[s.to] - block.baselines[s.from];
    const group = byShift.get(shift);
    if (group) group.push(s.placed);
    else byShift.set(shift, [s.placed]);
  }
  for (const [shift, group] of byShift) {
    const lists = listsOf(page, group);
    walk.moves.push(
      new TranslateElements(page.id, lists, 0, shift),
      new RemoveElements(page.id, lists, "Insert space"),
      new AddElements(next.id, lists, "Insert space"),
    );
  }
  // A link goes with most of its ink; strokes it leaves behind lose it.
  const carried = new Set(
    spill.flatMap((s) => (s.placed.element.kind === "stroke" ? [s.placed.element.el.id] : [])),
  );
  for (const link of page.links ?? []) {
    const moving = link.strokes.filter((id) => carried.has(id));
    if (moving.length * 2 <= link.strokes.length) continue;
    walk.moves.push(
      new SetLink(page, link.id, null, "Insert space"),
      new SetLink(next, link.id, { strokes: moving, target: link.target }, "Insert space"),
    );
  }
  // So does a checklist item made of handwriting.
  for (const task of page.tasks ?? []) {
    const moving = task.strokes.filter((id) => carried.has(id));
    if (moving.length * 2 <= task.strokes.length) continue;
    const { id: _id, ...rest } = task;
    walk.moves.push(
      new SetTask(page, task.id, null, "Insert space"),
      new SetTask(next, task.id, { ...rest, strokes: moving }, "Insert space"),
    );
  }
  // A section goes with its heading, keeping its place on the line.
  for (const { section, from, to } of spillMarks) {
    const shift = block.baselines[to] - block.baselines[from];
    walk.moves.push(
      new SetSection(page, section.id, null),
      new SetSection(next, section.id, moved(section, shift)),
    );
  }
  walk.moved += spill.length;
  walk.spilled += spill.length;
}

/** A page's sections on or below a line of one block, with their lines. */
function sectionsFrom(
  page: Page,
  blocks: readonly LineBlock[],
  target: SpaceTarget,
): Array<{ section: PageSection; line: number }> {
  const out: Array<{ section: PageSection; line: number }> = [];
  for (const section of page.sections ?? []) {
    // A heading that starts in the margin still belongs to the lines beside it.
    const beside = lineAt([blocks[target.block]], blocks[target.block].x0, section.y);
    const ref =
      lineAt(blocks, section.x, section.y) ??
      (beside ? { block: target.block, line: beside.line } : null);
    if (ref && ref.block === target.block && ref.line >= target.line) {
      out.push({ section, line: ref.line });
    }
  }
  return out;
}

/** A section's value, moved down by `dy`. */
function moved(section: PageSection, dy: number): Omit<PageSection, "id"> {
  // A full copy, so its level (and any later field) moves with it.
  return { ...section, y: section.y + dy };
}

/**
 * Close up as many as `count` empty lines just above `target`, moving
 * everything from it up. Returns how many it closed: never over ink.
 */
function closeUp(walk: Walk, pageIndex: number, target: SpaceTarget, count: number): number {
  const page = walk.pages[pageIndex];
  const blocks = walk.layout.lines(page);
  const block = blocks[target.block];
  if (!block) return 0;
  const placed = placedOn(page, blocks, walk.layout);
  const inBlock = placed.filter((p) => p.line?.block === target.block);
  // A line is used when ink covers a real part of it: a drawing over several
  // lines uses them all, a descender poking into the next line does not.
  const used = new Set<number>();
  for (const p of placed) {
    if (p.bounds.maxX < block.x0 || p.bounds.minX > block.x1) continue;
    for (let line = 0; line < block.baselines.length; line++) {
      const band = lineBand(block, line);
      const overlap = Math.min(p.bounds.maxY, band.bottom) - Math.max(p.bounds.minY, band.top);
      if (
        overlap > block.pitch * USED_SHARE ||
        (p.line?.block === target.block && p.line.line === line)
      ) {
        used.add(line);
      }
    }
  }
  // A section marks its line too: closing over it would stack two headings.
  for (const { line } of sectionsFrom(page, blocks, { block: target.block, line: 0 })) {
    used.add(line);
  }
  let empty = 0;
  while (empty < count && target.line - empty - 1 >= 0 && !used.has(target.line - empty - 1)) {
    empty++;
  }
  const below = inBlock.filter((p) => !p.pinned && (p.line as LineRef).line >= target.line);
  const marks = sectionsFrom(page, blocks, target);
  if (empty === 0 || (below.length === 0 && marks.length === 0)) return 0;
  const dy = -empty * block.pitch;
  if (below.length > 0)
    walk.moves.push(new TranslateElements(page.id, listsOf(page, below), 0, dy));
  for (const { section } of marks) {
    walk.moves.push(new SetSection(page, section.id, moved(section, dy)));
  }
  walk.moved += below.length;
  return empty;
}

/**
 * The strip a drag would open (or close), for drawing while it is dragged:
 * from the target line's top down `count` lines, or up for a close-up.
 */
export function spaceStrip(block: LineBlock, target: SpaceTarget, count: number): Bounds {
  const top = ruleBand(block, target.line).top;
  const height = Math.abs(count) * block.pitch;
  return count >= 0
    ? { minX: block.x0, maxX: block.x1, minY: top, maxY: top + height }
    : { minX: block.x0, maxX: block.x1, minY: top - height, maxY: top };
}
