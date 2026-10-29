/**
 * Arrows joining two shapes on a page (`ShapeConnector`, discussion #51):
 * what a page holds of them, how they are read and copied, and the two
 * edits that make and change linked shapes.
 *
 * A connector refers to its shapes by stroke id and draws only while both
 * are on its page (`liveConnectors`). Nothing removes a connector when one
 * of its shapes is erased or deleted: it simply stops being drawn and is
 * not saved, and the undo that brings the shape back brings the arrow back.
 * So no erase, cut or delete command needs to know about connectors, and
 * each stays one undo step.
 *
 * Pure: no DOM, no Obsidian.
 */

import type { Command } from "./commands";
import {
  CONNECTOR_SIDES,
  type ConnectorEnd,
  type ConnectorSide,
  type InkDocument,
  type Page,
  type ShapeConnector,
  type ShapeKind,
  type Stroke,
  pageById,
} from "./document";

/** The page's connectors whose two shapes are both on it, in order. */
export function liveConnectors(page: Page): ShapeConnector[] {
  const list = page.connectors;
  if (!list || list.length === 0) return [];
  const ids = new Set(page.strokes.map((stroke) => stroke.id));
  return list.filter((c) => ids.has(c.from.stroke) && ids.has(c.to.stroke));
}

/** The live connectors of `page` with an end on stroke `id`. */
export function connectorsOf(page: Page, id: string): ShapeConnector[] {
  return liveConnectors(page).filter((c) => c.from.stroke === id || c.to.stroke === id);
}

/** The next free `cn<N>` id in the notebook. */
export function nextConnectorId(doc: InkDocument): string {
  let max = 0;
  for (const page of doc.pages) {
    for (const c of page.connectors ?? []) {
      const match = /^cn(\d+)$/.exec(c.id);
      if (match) max = Math.max(max, Number(match[1]));
    }
  }
  return `cn${max + 1}`;
}

function isSide(value: unknown): value is ConnectorSide {
  return (CONNECTOR_SIDES as readonly unknown[]).includes(value);
}

function readEnd(raw: unknown, strokeIds: ReadonlySet<string>): ConnectorEnd | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { stroke, side } = raw as Record<string, unknown>;
  if (typeof stroke !== "string" || !strokeIds.has(stroke) || !isSide(side)) return null;
  return { stroke, side };
}

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * A page's stored connectors, checked: each needs a fresh id, two ends on
 * two different shapes of this page, a side for each, a `#rrggbb` colour
 * and a positive width. Anything else is dropped (a connector without its
 * shapes draws nothing anyway).
 */
export function readConnectors(
  raw: unknown,
  strokeIds: ReadonlySet<string>,
  seen: Set<string>,
): ShapeConnector[] {
  if (!Array.isArray(raw)) return [];
  const out: ShapeConnector[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const { id, from, to, color, size } = item as Record<string, unknown>;
    if (typeof id !== "string" || id === "" || seen.has(id)) continue;
    const a = readEnd(from, strokeIds);
    const b = readEnd(to, strokeIds);
    if (!a || !b || a.stroke === b.stroke) continue;
    if (typeof color !== "string" || !HEX.test(color)) continue;
    if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) continue;
    seen.add(id);
    out.push({ id, from: a, to: b, color, size });
  }
  return out;
}

/**
 * A copied page's connectors, following its strokes' new ids (`strokeIds`,
 * old to new) and renumbered from `nextId`; those whose shapes did not come
 * along are left behind.
 */
export function remapConnectors(
  list: readonly ShapeConnector[] | undefined,
  strokeIds: ReadonlyMap<string, string>,
  nextId: () => string,
): ShapeConnector[] {
  const out: ShapeConnector[] = [];
  for (const c of list ?? []) {
    const from = strokeIds.get(c.from.stroke);
    const to = strokeIds.get(c.to.stroke);
    if (!from || !to) continue;
    out.push({
      ...c,
      id: nextId(),
      from: { ...c.from, stroke: from },
      to: { ...c.to, stroke: to },
    });
  }
  return out;
}

/**
 * Add a linked copy: the copy of a shape, on top of the page's ink, and the
 * connector that joins the original to it, as one undo step. Both are held
 * by identity; undo takes out exactly these, and leaves a page that had no
 * connectors without the key.
 */
export class AddLinkedCopy implements Command {
  readonly label = "Add linked shape";
  private hadList = false;

  constructor(
    readonly pageId: string,
    private readonly copy: Stroke,
    private readonly connector: ShapeConnector,
  ) {}

  apply(doc: InkDocument): void {
    const page = pageById(doc, this.pageId);
    if (!page) return;
    page.strokes.push(this.copy);
    this.hadList = page.connectors !== undefined;
    (page.connectors ??= []).push(this.connector);
  }

  invert(doc: InkDocument): void {
    const page = pageById(doc, this.pageId);
    if (!page) return;
    const at = page.strokes.lastIndexOf(this.copy);
    if (at >= 0) page.strokes.splice(at, 1);
    const list = page.connectors;
    if (!list) return;
    const c = list.lastIndexOf(this.connector);
    if (c >= 0) list.splice(c, 1);
    if (list.length === 0 && !this.hadList) delete page.connectors;
  }
}

/**
 * Join two shapes already on the page with a connector (a side dot's arrow
 * dropped on another shape), as one undo step. Held by identity; undo
 * leaves a page that had no connectors without the key.
 */
export class AddConnector implements Command {
  readonly label = "Join shapes";
  private hadList = false;

  constructor(
    readonly pageId: string,
    private readonly connector: ShapeConnector,
  ) {}

  apply(doc: InkDocument): void {
    const page = pageById(doc, this.pageId);
    if (!page) return;
    this.hadList = page.connectors !== undefined;
    (page.connectors ??= []).push(this.connector);
  }

  invert(doc: InkDocument): void {
    const list = pageById(doc, this.pageId)?.connectors;
    const page = pageById(doc, this.pageId);
    if (!page || !list) return;
    const c = list.lastIndexOf(this.connector);
    if (c >= 0) list.splice(c, 1);
    if (list.length === 0 && !this.hadList) delete page.connectors;
  }
}

/**
 * Turn a shape into another kind in place (the bar beside a new linked
 * shape: rectangle, circle, triangle, diamond, rounded rectangle): new
 * points, a fresh array, and the new kind; its id, style and connectors
 * stay. Undo puts back the very array and kind it had.
 */
export class RetypeShape implements Command {
  readonly label = "Change shape";
  private previous: { pts: number[]; shape?: ShapeKind } | null = null;

  constructor(
    readonly pageId: string,
    private readonly stroke: Stroke,
    private readonly pts: number[],
    private readonly shape: ShapeKind,
  ) {}

  apply(doc: InkDocument): void {
    this.previous = null;
    const page = pageById(doc, this.pageId);
    if (!page?.strokes.includes(this.stroke)) return;
    this.previous = { pts: this.stroke.pts, shape: this.stroke.shape };
    this.stroke.pts = this.pts;
    this.stroke.shape = this.shape;
  }

  invert(): void {
    const previous = this.previous;
    if (!previous) return;
    this.stroke.pts = previous.pts;
    if (previous.shape === undefined) delete this.stroke.shape;
    else this.stroke.shape = previous.shape;
    this.previous = null;
  }
}
