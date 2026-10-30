/**
 * Mirrors: how a notebook with joined pages (`model/joined-pages.ts`) shows
 * an element that reaches over a join on the page beside it.
 *
 * Every element — ink, a picture, a sticky note and its ink, a text box, a
 * table, a graph — has one owner: the page that stores it, in that page's
 * space, which may run past the page's edge. Every other page its ink or
 * frame reaches stores a mirror: the same element moved into that page's
 * space, with `join` naming the owner (`<pageId>/<id>`) and an id made from
 * both. Every page is drawn clipped to its sheet, so each page shows exactly
 * its part, and the parts meet. A page never depends on the page beside it:
 * exported, set apart or opened by an older FineNotes, each shows its part.
 *
 * Mirrors are derived. {@link planMirrors} says what the mirrors of a whole
 * notebook should be, from the owners and the layout, and what must change
 * to get there; {@link MirrorSync} makes that change as a command, attached
 * to the edit that called for it, so one undo takes both back. Tools act on
 * owners only: a mirror is never selected, erased or moved itself.
 *
 * Pure: no DOM, no Obsidian.
 */

import type { Command } from "../model/commands";
import {
  type Bounds,
  type GraphElement,
  type ImageElement,
  type InkDocument,
  POINT_STRIDE,
  type Page,
  type Stroke,
  type TableElement,
  type TextBoxElement,
} from "../model/document";
import { inkReach, inkReachesPage, movePagePts } from "./page-join";
import type { DocumentLayout, PageBox } from "./page-layout";
import { HEAD_MAX } from "./shape-decor";

/** The element lists of a page that can hold mirrors. */
export type MirrorKind = "strokes" | "images" | "textBoxes" | "tables" | "graphs";

/** The kinds, in the order they are planned: notes before the ink on them. */
export const MIRROR_KINDS: readonly MirrorKind[] = [
  "images",
  "textBoxes",
  "tables",
  "graphs",
  "strokes",
];

export type MirrorElement = Stroke | ImageElement | TextBoxElement | TableElement | GraphElement;

/** Whether an element is a mirror of one on another page. */
export function isMirror(element: { join?: string }): boolean {
  return typeof element.join === "string" && element.join.length > 0;
}

/** How a mirror names its owner: its page and its id. */
export function ownerKey(pageId: string, id: string): string {
  return `${pageId}/${id}`;
}

/** A mirror's own id on page `pageId`: made from its owner's, so it is the same every time. */
export function mirrorId(key: string, pageId: string): string {
  return `${key}@${pageId}`;
}

/** The owner a mirror names: its page id and its id, or null for a malformed name. */
export function ownerOf(join: string): { pageId: string; id: string } | null {
  const slash = join.indexOf("/");
  if (slash <= 0 || slash === join.length - 1) return null;
  return { pageId: join.slice(0, slash), id: join.slice(slash + 1) };
}

/** The list of `kind` on a page, empty when the page has none. */
export function elementsOf(page: Page, kind: MirrorKind): MirrorElement[] {
  return page[kind] ?? [];
}

/** An estimate of a text box's height when it grows with its text, page px: generous. */
function textBoxHeight(box: TextBoxElement): number {
  if (typeof box.h === "number" && box.h > 0) return box.h;
  const line = box.fontSize * (box.lineHeight ?? 1.4) * 1.2;
  let lines = 0;
  for (const paragraph of box.text.split("\n")) {
    const wide = paragraph.length * box.fontSize * 0.62;
    lines += Math.max(1, Math.ceil(wide / Math.max(1, box.w)));
  }
  return Math.max(line, lines * line) + 16;
}

/** The bounds of ink along `pts`, reaching `reach` past its points, or null. */
function inkBounds(pts: readonly number[], reach: number): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const usable = pts.length - (pts.length % POINT_STRIDE);
  for (let i = 0; i < usable; i += POINT_STRIDE) {
    const x = pts[i];
    const y = pts[i + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX)) return null;
  return { minX: minX - reach, minY: minY - reach, maxX: maxX + reach, maxY: maxY + reach };
}

/** How far a stroke's ink reaches past its points. */
export function strokeReach(stroke: Stroke): number {
  return inkReach(stroke.size, stroke.heads ? HEAD_MAX : 0);
}

/** What an element covers in its page's space, as far as it can show; null for nothing. */
export function elementBounds(kind: MirrorKind, element: MirrorElement): Bounds | null {
  switch (kind) {
    case "strokes": {
      const stroke = element as Stroke;
      return inkBounds(stroke.pts, strokeReach(stroke));
    }
    case "images": {
      const image = element as ImageElement;
      const turn = ((image.rotation ?? 0) * Math.PI) / 180;
      const cos = Math.abs(Math.cos(turn));
      const sin = Math.abs(Math.sin(turn));
      const halfW = (image.w * cos + image.h * sin) / 2;
      const halfH = (image.w * sin + image.h * cos) / 2;
      const cx = image.x + image.w / 2;
      const cy = image.y + image.h / 2;
      return { minX: cx - halfW, minY: cy - halfH, maxX: cx + halfW, maxY: cy + halfH };
    }
    case "textBoxes": {
      const box = element as TextBoxElement;
      return { minX: box.x, minY: box.y, maxX: box.x + box.w, maxY: box.y + textBoxHeight(box) };
    }
    case "tables": {
      const table = element as TableElement;
      const w = table.cols.reduce((sum, c) => sum + c, 0);
      const h = table.rows.reduce((sum, r) => sum + r, 0);
      return { minX: table.x, minY: table.y, maxX: table.x + w, maxY: table.y + h };
    }
    case "graphs": {
      const graph = element as GraphElement;
      return { minX: graph.x, minY: graph.y, maxX: graph.x + graph.w, maxY: graph.y + graph.h };
    }
  }
}

/** Whether `bounds`, in page `from`'s space, overlaps page `to`'s sheet. */
function boundsReach(bounds: Bounds, from: PageBox, to: PageBox): boolean {
  const dx = from.x - to.x;
  const dy = from.y - to.y;
  return (
    bounds.maxX + dx > 0 &&
    bounds.minX + dx < to.width &&
    bounds.maxY + dy > 0 &&
    bounds.minY + dy < to.height
  );
}

/** `element` moved from page `from`'s space into page `to`'s. */
export function movedElement<T extends MirrorElement>(
  kind: MirrorKind,
  element: T,
  from: PageBox,
  to: PageBox,
): T {
  if (kind === "strokes") {
    const stroke = { ...(element as Stroke), pts: movePagePts((element as Stroke).pts, from, to) };
    return stroke as T;
  }
  const placed = element as T & { x: number; y: number };
  return { ...placed, x: placed.x + from.x - to.x, y: placed.y + from.y - to.y };
}

/** One change to a page's mirrors: put `element` (add, or replace the one with its id), or remove `id`. */
export interface MirrorOp {
  pageId: string;
  kind: MirrorKind;
  id: string;
  element?: MirrorElement;
}

export interface PlanOptions {
  /**
   * A stroke's bounds in its page's space, when the caller keeps them (the
   * surface's stroke index); otherwise they are read from its points.
   */
  strokeBounds?: (pageId: string, stroke: Stroke) => Bounds | null;
}

/**
 * The mirror of owner `element` (of `kind`, on the page at `from`) on the
 * page at `to`: moved there, named after its owner, without what only the
 * owner keeps (the pen's raw samples, the page clock's stamp).
 */
function mirrorOf(
  kind: MirrorKind,
  element: MirrorElement,
  key: string,
  from: PageBox,
  to: PageBox,
): MirrorElement {
  const mirror = movedElement(kind, element, from, to) as MirrorElement & {
    samples?: unknown;
    t0?: unknown;
  };
  mirror.id = mirrorId(key, to.id);
  mirror.join = key;
  delete mirror.samples;
  delete mirror.t0;
  return mirror;
}

/**
 * What must change for a notebook's mirrors to be what its owners and the
 * layout call for: every owner mirrored on every other page it reaches, and
 * nothing else. Empty when the pages are not joined (mirrors then stand as
 * they are), and empty when everything is in place, so it can run after
 * every edit.
 */
export function planMirrors(
  doc: InkDocument,
  layout: DocumentLayout,
  options: PlanOptions = {},
): MirrorOp[] {
  if (layout.joined !== true) return [];
  const boxes = layout.boxes;
  const wanted = new Map<string, MirrorElement>();
  const slot = (pageId: string, kind: MirrorKind, id: string): string => `${pageId}|${kind}|${id}`;
  // Sticky notes mirrored, owner key -> pages: their ink goes only where they go.
  const notesOn = new Map<string, Set<string>>();

  for (const kind of MIRROR_KINDS) {
    for (let p = 0; p < boxes.length; p++) {
      const from = boxes[p];
      const page = doc.pages[from.index];
      if (!page) continue;
      for (const element of elementsOf(page, kind)) {
        if (isMirror(element)) continue;
        const key = ownerKey(page.id, element.id);
        const stroke = kind === "strokes" ? (element as Stroke) : null;
        const bounds =
          stroke && options.strokeBounds
            ? options.strokeBounds(page.id, stroke)
            : elementBounds(kind, element);
        if (!bounds) continue;
        const note = stroke?.onSticky !== undefined ? ownerKey(page.id, stroke.onSticky) : null;
        for (const to of boxes) {
          if (to === from || !boundsReach(bounds, from, to)) continue;
          const toPage = doc.pages[to.index];
          if (!toPage) continue;
          if (stroke && !inkReachesPage(stroke.pts, from, to, strokeReach(stroke))) continue;
          // Ink on a sticky note shows only on the note: where the note has no mirror, it cannot show.
          if (note !== null && !notesOn.get(note)?.has(toPage.id)) continue;
          const mirror = mirrorOf(kind, element, key, from, to);
          if (note !== null) (mirror as Stroke).onSticky = mirrorId(note, toPage.id);
          if (kind === "images" && (element as ImageElement).sticky) {
            const pages = notesOn.get(key) ?? new Set<string>();
            pages.add(toPage.id);
            notesOn.set(key, pages);
          }
          wanted.set(slot(toPage.id, kind, mirror.id), mirror);
        }
      }
    }
  }

  const ops: MirrorOp[] = [];
  const kept = new Set<string>();
  for (const page of doc.pages) {
    for (const kind of MIRROR_KINDS) {
      for (const element of elementsOf(page, kind)) {
        if (!isMirror(element)) continue;
        const at = slot(page.id, kind, element.id);
        const want = wanted.get(at);
        if (!want) {
          ops.push({ pageId: page.id, kind, id: element.id });
          continue;
        }
        kept.add(at);
        if (!sameElement(element, want)) {
          ops.push({ pageId: page.id, kind, id: element.id, element: want });
        }
      }
    }
  }
  for (const [at, element] of wanted) {
    if (kept.has(at)) continue;
    const [pageId, kind] = at.split("|") as [string, MirrorKind];
    ops.push({ pageId, kind, id: element.id, element });
  }
  return ops;
}

/** Numbers this close are the same: a stored mirror is rounded as the file rounds. */
const SAME_EPSILON = 0.02;

/** Deep equality with numbers compared within {@link SAME_EPSILON}; the page clock's stamp and raw samples aside. */
export function sameElement(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) <= SAME_EPSILON || (Number.isNaN(a) && Number.isNaN(b));
  }
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => sameElement(item, b[i]));
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ra), ...Object.keys(rb)]);
  for (const key of keys) {
    if (key === "t0" || key === "samples") continue;
    if (ra[key] === undefined && rb[key] === undefined) continue;
    if (!sameElement(ra[key], rb[key])) return false;
  }
  return true;
}

/**
 * Make a plan's changes ({@link planMirrors}): one command, attached to the
 * edit that called for them (`History.attach`). Undo puts every list back
 * as it was, a list it had to create removed again.
 */
export class MirrorSync implements Command {
  readonly label = "Mirror over the join";
  private done: Array<{
    pageId: string;
    kind: MirrorKind;
    index: number;
    before?: MirrorElement;
    after?: MirrorElement;
    created: boolean;
  }> = [];

  constructor(readonly ops: readonly MirrorOp[]) {}

  apply(doc: InkDocument): void {
    this.done = [];
    for (const op of this.ops) {
      const page = doc.pages.find((candidate) => candidate.id === op.pageId);
      if (!page) continue;
      const record = page as unknown as Record<MirrorKind, MirrorElement[] | undefined>;
      const created = record[op.kind] === undefined;
      if (created && !op.element) continue;
      const list = (record[op.kind] ??= []);
      let index = list.findIndex((element) => element.id === op.id);
      const before = index >= 0 ? list[index] : undefined;
      if (op.element) {
        if (index >= 0) list[index] = op.element;
        else index = list.push(op.element) - 1;
      } else if (index >= 0) {
        list.splice(index, 1);
      } else {
        continue;
      }
      this.done.push({
        pageId: op.pageId,
        kind: op.kind,
        index,
        before,
        after: op.element,
        created,
      });
    }
  }

  invert(doc: InkDocument): void {
    for (let i = this.done.length - 1; i >= 0; i--) {
      const step = this.done[i];
      const page = doc.pages.find((candidate) => candidate.id === step.pageId);
      if (!page) continue;
      const record = page as unknown as Record<MirrorKind, MirrorElement[] | undefined>;
      const list = record[step.kind];
      if (!list) continue;
      if (step.after && step.before) list[step.index] = step.before;
      else if (step.after) list.splice(step.index, 1);
      else if (step.before) list.splice(step.index, 0, step.before);
      if (step.created && list.length === 0) delete record[step.kind];
    }
    this.done = [];
  }
}

/** The pages and regions a sync changed, each in its own page's space: what to repaint. */
export function mirrorRegions(
  ops: readonly MirrorOp[],
  before: ReadonlyMap<string, MirrorElement>,
): Array<{ pageId: string; bounds: Bounds }> {
  const out: Array<{ pageId: string; bounds: Bounds }> = [];
  for (const op of ops) {
    const old = before.get(`${op.pageId}|${op.kind}|${op.id}`);
    for (const element of [old, op.element]) {
      if (!element) continue;
      const bounds = elementBounds(op.kind, element);
      if (bounds) out.push({ pageId: op.pageId, bounds });
    }
  }
  return out;
}

/** The elements a plan will replace or remove, as they are now, by `page|kind|id`. */
export function mirrorsBefore(
  doc: InkDocument,
  ops: readonly MirrorOp[],
): Map<string, MirrorElement> {
  const out = new Map<string, MirrorElement>();
  for (const op of ops) {
    const page = doc.pages.find((candidate) => candidate.id === op.pageId);
    const element = page ? elementsOf(page, op.kind).find((e) => e.id === op.id) : undefined;
    if (element) out.set(`${op.pageId}|${op.kind}|${op.id}`, element);
  }
  return out;
}

/**
 * The owner a mirror names, found: its page, its index in the layout and
 * the element itself; null when it is gone.
 */
export function findOwner<T extends MirrorElement>(
  doc: InkDocument,
  layout: DocumentLayout,
  kind: MirrorKind,
  mirror: T,
): { page: Page; box: PageBox; element: T } | null {
  if (!mirror.join) return null;
  const owner = ownerOf(mirror.join);
  if (!owner) return null;
  const box = layout.boxes.find((b) => b.id === owner.pageId);
  const page = box ? doc.pages[box.index] : undefined;
  if (!box || !page || page.id !== owner.pageId) return null;
  const element = elementsOf(page, kind).find((e) => e.id === owner.id && !isMirror(e));
  return element ? { page, box, element: element as T } : null;
}

/** Elements of each kind, by id, as a command names them. */
export type ElementIds = Partial<Record<MirrorKind, readonly string[]>>;

/**
 * Move owners from page `fromPageId` onto page `toPageId`, into its space:
 * what a lasso drawn over a join picks up from the page beside it, so the
 * selection, which lives on one page, holds all of it. Nothing moves on
 * screen; the mirrors are rebuilt afterwards (`planMirrors`). An element
 * whose id the page already uses gets a fresh one, and the ink on a moved
 * sticky note follows its note's new id. It joins the next step
 * (`joinsNext`), so one undo takes back the move and what the selection did.
 */
export class MoveToPage implements Command {
  readonly label = "Pick up over the join";
  readonly joinsNext = true;
  /** What was moved, by kind: each original, where it was, and its copy on the new page. */
  private moved: Array<{
    kind: MirrorKind;
    index: number;
    from: MirrorElement;
    to: MirrorElement;
  }> = [];
  private created: MirrorKind[] = [];

  constructor(
    readonly fromPageId: string,
    readonly toPageId: string,
    readonly from: PageBox,
    readonly to: PageBox,
    readonly ids: ElementIds,
  ) {}

  /** The copies on the new page, of `kind`: what the selection holds now. */
  movedOf<K extends MirrorKind>(kind: K): Array<NonNullable<Page[K]>[number]> {
    return this.moved.filter((m) => m.kind === kind).map((m) => m.to);
  }

  apply(doc: InkDocument): void {
    this.moved = [];
    this.created = [];
    const source = doc.pages.find((page) => page.id === this.fromPageId);
    const target = doc.pages.find((page) => page.id === this.toPageId);
    if (!source || !target || source === target) return;
    const renamed = new Map<string, string>();
    const notes = new Set<string>();
    // Notes first: the ink on a moved note goes with it, under its new id.
    for (const kind of MIRROR_KINDS) {
      const wanted = new Set(this.ids[kind] ?? []);
      if (kind === "strokes") {
        for (const stroke of source.strokes) {
          if (stroke.onSticky !== undefined && notes.has(stroke.onSticky)) wanted.add(stroke.id);
        }
      }
      if (wanted.size === 0) continue;
      const record = target as unknown as Record<MirrorKind, MirrorElement[] | undefined>;
      if (record[kind] === undefined) {
        record[kind] = [];
        this.created.push(kind);
      }
      const into = record[kind];
      const taken = new Set(into.map((element) => element.id));
      const list = elementsOf(source, kind);
      for (let i = list.length - 1; i >= 0; i--) {
        const element = list[i];
        if (!wanted.has(element.id) || isMirror(element)) continue;
        list.splice(i, 1);
        const copy = movedElement(kind, element, this.from, this.to);
        if (kind === "images" && (element as ImageElement).sticky) notes.add(element.id);
        if (taken.has(copy.id)) {
          copy.id = freshId(copy.id, taken);
          if (kind === "images") renamed.set(element.id, copy.id);
        }
        taken.add(copy.id);
        if (kind === "strokes") {
          const stroke = copy as Stroke;
          if (stroke.onSticky !== undefined)
            stroke.onSticky = renamed.get(stroke.onSticky) ?? stroke.onSticky;
        }
        this.moved.unshift({ kind, index: i, from: element, to: copy });
      }
      for (const m of this.moved) if (m.kind === kind) into.push(m.to);
    }
  }

  invert(doc: InkDocument): void {
    const source = doc.pages.find((page) => page.id === this.fromPageId);
    const target = doc.pages.find((page) => page.id === this.toPageId);
    if (!source || !target) return;
    const record = target as unknown as Record<MirrorKind, MirrorElement[] | undefined>;
    const sourceRecord = source as unknown as Record<MirrorKind, MirrorElement[] | undefined>;
    for (const m of this.moved) {
      const into = record[m.kind];
      const at = into?.indexOf(m.to) ?? -1;
      if (into && at >= 0) into.splice(at, 1);
    }
    // Back where each was, the earliest first so later indices still hold.
    const back = [...this.moved].sort((a, b) => a.index - b.index);
    for (const m of back) (sourceRecord[m.kind] ??= []).splice(m.index, 0, m.from);
    for (const kind of this.created) {
      if (record[kind]?.length === 0) delete record[kind];
    }
    this.moved = [];
    this.created = [];
  }
}

/** An id like `id` that `taken` does not hold: its prefix and the next free number. */
function freshId(id: string, taken: ReadonlySet<string>): string {
  const prefix = /^[a-z]*/i.exec(id)?.[0] ?? "";
  let n = 1;
  while (taken.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}
