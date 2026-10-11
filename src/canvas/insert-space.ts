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
import type { Command } from "../model/commands";
import {
  type Bounds,
  type ImageElement,
  type InkDocument,
  type Page,
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
import { MARGIN_SHARE, linedItems } from "./ruled-ink";
import {
  type LineBlock,
  type LineRef,
  lineAt,
  lineBand,
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
  const strip = width * MARGIN_SHARE;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    // A block with another block just left of it starts its strip at its
    // own edge; otherwise the whole margin to the page's edge is its own.
    const neighbour = blocks.some((o) => o !== b && Math.abs(o.x1 - b.x0) < 1);
    const left = neighbour ? b.x0 : 0;
    if (x < left || x >= b.x0 + strip) continue;
    const ref = lineAt([b], b.x0, y);
    if (ref) return { block: i, line: ref.line };
  }
  return null;
}

type Element =
  | { kind: "stroke"; el: Stroke }
  | { kind: "image"; el: ImageElement }
  | { kind: "textBox"; el: TextBoxElement };

interface Placed {
  element: Element;
  bounds: Bounds;
  line: LineRef | null;
}

/** Every element on a page, with the line it sits on. */
function placedOn(page: Page, blocks: readonly LineBlock[], layout: SpaceLayout): Placed[] {
  const strokes = linedItems(blocks, page.strokes, strokeBounds).map((l): Placed => ({
    element: { kind: "stroke", el: l.item },
    bounds: l.bounds,
    line: l.line,
  }));
  const framed = (element: Element, bounds: Bounds): Placed => ({
    element,
    bounds,
    line: lineOfBounds(blocks, bounds),
  });
  return [
    ...strokes,
    ...page.images.map((el) =>
      framed(
        { kind: "image", el },
        { minX: el.x, minY: el.y, maxX: el.x + el.w, maxY: el.y + el.h },
      ),
    ),
    ...page.textBoxes.map((el) => framed({ kind: "textBox", el }, layout.textBoxBounds(page, el))),
  ];
}

function listsOf(placed: readonly Placed[]): ElementLists {
  const lists: ElementLists = { strokes: [], images: [], textBoxes: [] };
  for (const { element } of placed) {
    if (element.kind === "stroke") lists.strokes.push(element.el);
    else if (element.kind === "image") lists.images.push(element.el);
    else lists.textBoxes.push(element.el);
  }
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
    (p) => p.line?.block === target.block && p.line.line >= target.line,
  );
  if (below.length === 0) return;
  const stay: Placed[] = [];
  const spill: Array<{ placed: Placed; from: number; to: number }> = [];
  for (const placed of below) {
    const from = (placed.line as LineRef).line;
    const to = from + count;
    if (to < n && placed.bounds.maxY + dy <= page.geometry.height) stay.push(placed);
    else spill.push({ placed, from, to: Math.max(0, to - n) });
  }
  if (stay.length > 0) {
    walk.moves.push(new TranslateElements(page.id, listsOf(stay), 0, dy));
    walk.moved += stay.length;
  }
  if (spill.length === 0) return;

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
    const room = Math.max(...spill.map((s) => s.to)) + 1;
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
    const lists = listsOf(group);
    walk.moves.push(
      new TranslateElements(page.id, lists, 0, shift),
      new RemoveElements(page.id, lists, "Insert space"),
      new AddElements(next.id, lists, "Insert space"),
    );
  }
  walk.moved += spill.length;
  walk.spilled += spill.length;
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
  let empty = 0;
  while (empty < count && target.line - empty - 1 >= 0 && !used.has(target.line - empty - 1)) {
    empty++;
  }
  const below = inBlock.filter((p) => (p.line as LineRef).line >= target.line);
  if (empty === 0 || below.length === 0) return 0;
  walk.moves.push(new TranslateElements(page.id, listsOf(below), 0, -empty * block.pitch));
  walk.moved += below.length;
  return empty;
}

/**
 * The strip a drag would open (or close), for drawing while it is dragged:
 * from the target line's top down `count` lines, or up for a close-up.
 */
export function spaceStrip(block: LineBlock, target: SpaceTarget, count: number): Bounds {
  const top = lineBand(block, target.line).top;
  const height = Math.abs(count) * block.pitch;
  return count >= 0
    ? { minX: block.x0, maxX: block.x1, minY: top, maxY: top + height }
    : { minX: block.x0, maxX: block.x1, minY: top - height, maxY: top };
}
