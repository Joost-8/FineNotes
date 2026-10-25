/**
 * Commands on a lasso selection (0.5): move, resize, rotate, flip, delete, duplicate and recolour
 * strokes, images and text boxes on one page, each as **one** undo step.
 *
 * Every element is held by identity, not by id: ids are only unique per file,
 * and a hand-edited or merged note can repeat one (CLAUDE.md, "Resolve an
 * inverse by identity, not by a key that can repeat"). Each inverse restores
 * the exact values it replaced — the original point arrays, coordinates and
 * colours — rather than applying the opposite change, so an undo leaves the
 * document `JSON.stringify`-identical (`x + d - d` is not always `x` in
 * floating point). Pure, like the rest of `src/model/`.
 */

import type { Command } from "./commands";
import {
  type ImageElement,
  type InkDocument,
  type Page,
  type Stroke,
  type GraphElement,
  type TableElement,
  type TextBoxElement,
  POINT_STRIDE,
  pageById,
} from "./document";
import { scaleTable, tableFloorSize } from "./table";
import { restoreTable } from "./table-commands";
import { restoreGraph, scaleGraph } from "./graph-element";
import {
  MAX_BORDER_WIDTH,
  MAX_CORNER_RADIUS,
  MAX_TEXT_SIZE,
  MIN_TEXT_SIZE,
  roundTextSize,
} from "./text-style";
import {
  type ShapeStyle,
  type StyleFields,
  applyShapeStyle,
  restoreStyleFields,
  styleFieldsOf,
} from "./shape-style";

/** The elements a selection holds on one page. */
export interface PageElements {
  strokes: readonly Stroke[];
  images: readonly ImageElement[];
  textBoxes: readonly TextBoxElement[];
  /** Absent: none. Older callers that know no tables leave it out. */
  tables?: readonly TableElement[];
  /** Absent: none, as for tables. */
  graphs?: readonly GraphElement[];
}

/** The same elements as fresh, mutable lists. */
export interface ElementLists {
  strokes: Stroke[];
  images: ImageElement[];
  textBoxes: TextBoxElement[];
  tables?: TableElement[];
  graphs?: GraphElement[];
}

/** Which of `elements` are on `page` right now, in page order. */
export function elementsOnPage(page: Page, elements: PageElements): ElementLists {
  return {
    strokes: present(page.strokes, elements.strokes),
    images: present(page.images, elements.images),
    textBoxes: present(page.textBoxes, elements.textBoxes),
    tables: present(page.tables ?? [], elements.tables ?? []),
    graphs: present(page.graphs ?? [], elements.graphs ?? []),
  };
}

/** Whether a selection holds nothing. */
export function isEmptySelection(elements: PageElements): boolean {
  return (
    elements.strokes.length === 0 &&
    elements.images.length === 0 &&
    elements.textBoxes.length === 0 &&
    (elements.tables?.length ?? 0) === 0 &&
    (elements.graphs?.length ?? 0) === 0
  );
}

/** A copy of `pts` moved by (dx, dy); whole points only, the rest copied as is. */
export function translatePoints(pts: readonly number[], dx: number, dy: number): number[] {
  const out = pts.slice();
  const usable = out.length - (out.length % POINT_STRIDE);
  for (let i = 0; i < usable; i += POINT_STRIDE) {
    out[i] += dx;
    out[i + 1] += dy;
  }
  return out;
}

/**
 * Move everything selected on one page by (dx, dy), in page space. A stroke
 * gets a new points array and keeps the old one for the undo; images and
 * text boxes keep their size, rotation and style.
 */
export class TranslateElements implements Command {
  readonly label = "Move selection";
  private moved: {
    strokes: Array<{ stroke: Stroke; pts: number[] }>;
    images: Array<{ image: ImageElement; x: number; y: number }>;
    textBoxes: Array<{ textBox: TextBoxElement; x: number; y: number }>;
    tables: Array<{ table: TableElement; x: number; y: number }>;
    graphs: Array<{ graph: GraphElement; x: number; y: number }>;
  } | null = null;

  constructor(
    readonly pageId: string,
    private readonly elements: PageElements,
    private readonly dx: number,
    private readonly dy: number,
  ) {}

  apply(doc: InkDocument): void {
    this.moved = null;
    const page = pageById(doc, this.pageId);
    if (!page) return;
    const on = elementsOnPage(page, this.elements);
    const { dx, dy } = this;
    this.moved = {
      strokes: on.strokes.map((stroke) => {
        const pts = stroke.pts;
        stroke.pts = translatePoints(pts, dx, dy);
        return { stroke, pts };
      }),
      images: on.images.map((image) => {
        const saved = { image, x: image.x, y: image.y };
        image.x += dx;
        image.y += dy;
        return saved;
      }),
      textBoxes: on.textBoxes.map((textBox) => {
        const saved = { textBox, x: textBox.x, y: textBox.y };
        textBox.x += dx;
        textBox.y += dy;
        return saved;
      }),
      tables: (on.tables ?? []).map((table) => {
        const saved = { table, x: table.x, y: table.y };
        table.x += dx;
        table.y += dy;
        return saved;
      }),
      graphs: (on.graphs ?? []).map((graph) => {
        const saved = { graph, x: graph.x, y: graph.y };
        graph.x += dx;
        graph.y += dy;
        return saved;
      }),
    };
  }

  invert(doc: InkDocument): void {
    const moved = this.moved;
    if (!moved || !pageById(doc, this.pageId)) return;
    for (const { stroke, pts } of moved.strokes) stroke.pts = pts;
    for (const { image, x, y } of moved.images) {
      image.x = x;
      image.y = y;
    }
    for (const { textBox, x, y } of moved.textBoxes) {
      textBox.x = x;
      textBox.y = y;
    }
    for (const { table, x, y } of moved.tables) {
      table.x = x;
      table.y = y;
    }
    for (const { graph, x, y } of moved.graphs) {
      graph.x = x;
      graph.y = y;
    }
    this.moved = null;
  }
}

/** A copy of `pts` scaled by `k` about (ax, ay); pressure, and any ragged tail, copied as is. */
export function scalePoints(pts: readonly number[], ax: number, ay: number, k: number): number[] {
  const out = pts.slice();
  const usable = out.length - (out.length % POINT_STRIDE);
  for (let i = 0; i < usable; i += POINT_STRIDE) {
    out[i] = ax + (out[i] - ax) * k;
    out[i + 1] = ay + (out[i + 1] - ay) * k;
  }
  return out;
}

/**
 * How far a resize may scale `textBoxes`: no box's font below
 * `MIN_TEXT_SIZE`, which the loader would raise it back to (a size that
 * changes on the next open is a silent lie), nor above `MAX_TEXT_SIZE`, the
 * largest the style menu offers; and no border or corner past the most the
 * loader keeps, which would drop it. Without text boxes, anything goes.
 */
export function textScaleRange(textBoxes: readonly TextBoxElement[]): { min: number; max: number } {
  let min = 0;
  let max = Infinity;
  for (const { fontSize, border, radius } of textBoxes) {
    if (border && border.width > 0) max = Math.min(max, MAX_BORDER_WIDTH / border.width);
    if (radius !== undefined && radius > 0) max = Math.min(max, MAX_CORNER_RADIUS / radius);
    if (!(fontSize > 0) || !Number.isFinite(fontSize)) continue;
    min = Math.max(min, MIN_TEXT_SIZE / fontSize);
    max = Math.min(max, MAX_TEXT_SIZE / fontSize);
  }
  // A box already outside the range may stay as it is.
  return { min: Math.min(min, 1), max: Math.max(max, 1) };
}

/**
 * Resize everything selected on one page by `k` about the page point
 * (ax, ay) — the frame corner opposite the one dragged — as one undo step.
 * The scale is uniform, the aspect kept, as GoodNotes resizes a lasso
 * selection from its corners:
 *
 * - a stroke's points scale and so does its width, so the ink looks the
 *   same, only bigger or smaller; pressure is untouched, and a snapped
 *   shape keeps its `shape` (a uniformly scaled rectangle is still one);
 * - a picture's box scales about the anchor and keeps its rotation and
 *   crop (a uniform scale commutes with turning about the centre);
 * - a text box's frame and its font scale together, so it wraps at the
 *   same words; a fixed height scales, an auto height stays absent.
 *
 * A non-finite or non-positive `k`, or a non-finite anchor, changes nothing.
 * A stroke's `samples` (practice files' raw pen input) stay as recorded, as
 * they do under a move.
 */
export class ScaleElements implements Command {
  readonly label = "Resize selection";
  private scaled: {
    strokes: Array<{ stroke: Stroke; pts: number[]; size: number; radius: number | undefined }>;
    images: Array<{ image: ImageElement; x: number; y: number; w: number; h: number }>;
    textBoxes: Array<{
      textBox: TextBoxElement;
      x: number;
      y: number;
      w: number;
      h: number | undefined;
      fontSize: number;
      border: TextBoxElement["border"];
      radius: number | undefined;
    }>;
    tables: Array<{ table: TableElement; saved: TableElement }>;
    graphs: Array<{ graph: GraphElement; saved: GraphElement }>;
  } | null = null;

  constructor(
    readonly pageId: string,
    private readonly elements: PageElements,
    private readonly ax: number,
    private readonly ay: number,
    private readonly k: number,
  ) {}

  apply(doc: InkDocument): void {
    this.scaled = null;
    const { ax, ay, k } = this;
    if (!(k > 0) || !Number.isFinite(k) || !Number.isFinite(ax) || !Number.isFinite(ay)) return;
    const page = pageById(doc, this.pageId);
    if (!page) return;
    const on = elementsOnPage(page, this.elements);
    const sx = (x: number): number => ax + (x - ax) * k;
    const sy = (y: number): number => ay + (y - ay) * k;
    this.scaled = {
      strokes: on.strokes.map((stroke) => {
        const saved = { stroke, pts: stroke.pts, size: stroke.size, radius: stroke.radius };
        stroke.pts = scalePoints(stroke.pts, ax, ay, k);
        stroke.size *= k;
        // Rounded corners grow with the shape, as its width does.
        if (stroke.radius !== undefined) stroke.radius *= k;
        return saved;
      }),
      images: on.images.map((image) => {
        const { x, y, w, h } = image;
        image.x = sx(x);
        image.y = sy(y);
        image.w = w * k;
        image.h = h * k;
        return { image, x, y, w, h };
      }),
      textBoxes: on.textBoxes.map((textBox) => {
        const { x, y, w, h, fontSize, border, radius } = textBox;
        textBox.x = sx(x);
        textBox.y = sy(y);
        textBox.w = w * k;
        if (h !== undefined) textBox.h = h * k;
        // To one decimal: the size menu shows it, and 23.4000000001 is noise.
        textBox.fontSize = roundTextSize(fontSize * k);
        // The border and corners grow with the box, as a stroke's width does.
        if (border) textBox.border = { ...border, width: border.width * k };
        if (radius !== undefined) textBox.radius = radius * k;
        return { textBox, x, y, w, h, fontSize, border, radius };
      }),
      // A table's columns, rows, lines and font scale together, so its
      // cells wrap at the same words.
      tables: (on.tables ?? []).map((table) => {
        const saved = structuredClone(table);
        scaleTable(table, ax, ay, k);
        return { table, saved };
      }),
      // A graph's frame grows; its ranges stay, so the same curve shows larger.
      graphs: (on.graphs ?? []).map((graph) => {
        const saved = structuredClone(graph);
        scaleGraph(graph, ax, ay, k);
        return { graph, saved };
      }),
    };
  }

  invert(doc: InkDocument): void {
    const scaled = this.scaled;
    if (!scaled || !pageById(doc, this.pageId)) return;
    for (const { stroke, pts, size, radius } of scaled.strokes) {
      stroke.pts = pts;
      stroke.size = size;
      if (radius === undefined) delete stroke.radius;
      else stroke.radius = radius;
    }
    for (const { image, x, y, w, h } of scaled.images) {
      image.x = x;
      image.y = y;
      image.w = w;
      image.h = h;
    }
    for (const { textBox, x, y, w, h, fontSize, border, radius } of scaled.textBoxes) {
      textBox.x = x;
      textBox.y = y;
      textBox.w = w;
      // Assigned, never deleted and re-added: the key keeps its place.
      if (h !== undefined) textBox.h = h;
      textBox.fontSize = fontSize;
      if (border) textBox.border = border;
      if (radius !== undefined) textBox.radius = radius;
    }
    for (const { table, saved } of scaled.tables) restoreTable(table, saved);
    for (const { graph, saved } of scaled.graphs) restoreGraph(graph, saved);
    this.scaled = null;
  }
}

/**
 * A rigid turn or mirror of a selection about a page point: `rotate` turns
 * it `angle` radians clockwise (y down, as a picture's `rotation`); `flip`
 * mirrors it left to right (`x`) or top to bottom (`y`).
 */
export type Reorientation = { kind: "rotate"; angle: number } | { kind: "flip"; axis: "x" | "y" };

/** Where page point (x, y) goes under `motion` about (cx, cy). */
export function reorientPoint(
  motion: Reorientation,
  cx: number,
  cy: number,
  x: number,
  y: number,
): { x: number; y: number } {
  const dx = x - cx;
  const dy = y - cy;
  if (motion.kind === "flip") {
    return motion.axis === "x" ? { x: cx - dx, y } : { x, y: cy - dy };
  }
  const c = Math.cos(motion.angle);
  const s = Math.sin(motion.angle);
  return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
}

/** A copy of `pts` under `motion` about (cx, cy); pressure, and any ragged tail, copied as is. */
export function reorientPoints(
  pts: readonly number[],
  motion: Reorientation,
  cx: number,
  cy: number,
): number[] {
  const out = pts.slice();
  const usable = out.length - (out.length % POINT_STRIDE);
  for (let i = 0; i < usable; i += POINT_STRIDE) {
    const p = reorientPoint(motion, cx, cy, out[i], out[i + 1]);
    out[i] = p.x;
    out[i + 1] = p.y;
  }
  return out;
}

/** Rotations smaller than this are "no rotation", and the key is left absent. */
const ROTATION_EPSILON = 1e-9;

/** Wrap an angle into (-π, π]. */
function wrapAngle(angle: number): number {
  const turn = Math.PI * 2;
  let a = angle % turn;
  if (a <= -Math.PI) a += turn;
  if (a > Math.PI) a -= turn;
  return a;
}

/**
 * Turn or mirror everything selected on one page about the page point
 * (cx, cy) — the middle of the selection's bounds — as one undo step:
 *
 * - a stroke's points move and nothing else changes: its width, pressure
 *   and `shape` stay (a turned rectangle is still a rectangle);
 * - a picture's centre moves; a turn adds to its `rotation`, a mirror
 *   flips it in its own frame and negates its rotation, since mirroring a
 *   turned picture is mirroring it first and turning it the other way;
 * - a text box has no rotation, so it stays upright and only its middle
 *   moves (`heights` gives a box's measured height when it has none fixed).
 *
 * A non-finite angle or centre changes nothing. A stroke's `samples` stay as
 * recorded, as they do under a move.
 */
export class ReorientElements implements Command {
  readonly label: string;
  private saved: {
    strokes: Array<{ stroke: Stroke; pts: number[] }>;
    images: Array<{ image: ImageElement; saved: ImageElement }>;
    textBoxes: Array<{ textBox: TextBoxElement; x: number; y: number }>;
    tables: Array<{ table: TableElement; x: number; y: number }>;
    graphs: Array<{ graph: GraphElement; x: number; y: number }>;
  } | null = null;

  constructor(
    readonly pageId: string,
    private readonly elements: PageElements,
    private readonly motion: Reorientation,
    private readonly cx: number,
    private readonly cy: number,
    private readonly heights?: ReadonlyMap<TextBoxElement | TableElement, number>,
  ) {
    this.label =
      motion.kind === "rotate"
        ? "Rotate selection"
        : motion.axis === "x"
          ? "Flip horizontal"
          : "Flip vertical";
  }

  apply(doc: InkDocument): void {
    this.saved = null;
    const { motion, cx, cy } = this;
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;
    if (motion.kind === "rotate" && !Number.isFinite(motion.angle)) return;
    const page = pageById(doc, this.pageId);
    if (!page) return;
    const on = elementsOnPage(page, this.elements);
    this.saved = {
      strokes: on.strokes.map((stroke) => {
        const pts = stroke.pts;
        stroke.pts = reorientPoints(pts, motion, cx, cy);
        return { stroke, pts };
      }),
      images: on.images.map((image) => {
        const saved = { ...image };
        const c = reorientPoint(motion, cx, cy, image.x + image.w / 2, image.y + image.h / 2);
        image.x = c.x - image.w / 2;
        image.y = c.y - image.h / 2;
        const was =
          typeof image.rotation === "number" && Number.isFinite(image.rotation)
            ? image.rotation
            : 0;
        let turned: number;
        if (motion.kind === "rotate") {
          turned = wrapAngle(was + motion.angle);
        } else {
          turned = wrapAngle(-was);
          if (motion.axis === "x") {
            if (image.flipX === true) delete image.flipX;
            else image.flipX = true;
          } else if (image.flipY === true) delete image.flipY;
          else image.flipY = true;
        }
        if (Math.abs(turned) > ROTATION_EPSILON) image.rotation = turned;
        else delete image.rotation;
        return { image, saved };
      }),
      textBoxes: on.textBoxes.map((textBox) => {
        const { x, y, w } = textBox;
        const h = this.heights?.get(textBox) ?? textBox.h ?? 0;
        const c = reorientPoint(motion, cx, cy, x + w / 2, y + h / 2);
        textBox.x = c.x - w / 2;
        textBox.y = c.y - h / 2;
        return { textBox, x, y };
      }),
      // A table stays upright, as a text box does: only its middle moves.
      tables: (on.tables ?? []).map((table) => {
        const { x, y } = table;
        const floor = tableFloorSize(table);
        const h = this.heights?.get(table) ?? floor.h;
        const c = reorientPoint(motion, cx, cy, x + floor.w / 2, y + h / 2);
        table.x = c.x - floor.w / 2;
        table.y = c.y - h / 2;
        return { table, x, y };
      }),
      // So does a graph: its axes stay level.
      graphs: (on.graphs ?? []).map((graph) => {
        const { x, y } = graph;
        const c = reorientPoint(motion, cx, cy, x + graph.w / 2, y + graph.h / 2);
        graph.x = c.x - graph.w / 2;
        graph.y = c.y - graph.h / 2;
        return { graph, x, y };
      }),
    };
  }

  invert(doc: InkDocument): void {
    const saved = this.saved;
    if (!saved || !pageById(doc, this.pageId)) return;
    for (const { stroke, pts } of saved.strokes) stroke.pts = pts;
    for (const { image, saved: before } of saved.images) {
      const target = image as unknown as Record<string, unknown>;
      for (const key of Object.keys(target)) delete target[key];
      Object.assign(image, before);
    }
    for (const { textBox, x, y } of saved.textBoxes) {
      textBox.x = x;
      textBox.y = y;
    }
    for (const { table, x, y } of saved.tables) {
      table.x = x;
      table.y = y;
    }
    for (const { graph, x, y } of saved.graphs) {
      graph.x = x;
      graph.y = y;
    }
    this.saved = null;
  }
}

/**
 * Delete everything selected on one page; undo puts each element back where
 * it was. A Cut is the same step under its own label.
 */
export class RemoveElements implements Command {
  private removed: {
    strokes: Array<Removed<Stroke>>;
    images: Array<Removed<ImageElement>>;
    textBoxes: Array<Removed<TextBoxElement>>;
    tables: Array<Removed<TableElement>>;
    graphs: Array<Removed<GraphElement>>;
  } | null = null;

  constructor(
    readonly pageId: string,
    private readonly elements: PageElements,
    readonly label = "Delete selection",
  ) {}

  apply(doc: InkDocument): void {
    this.removed = null;
    const page = pageById(doc, this.pageId);
    if (!page) return;
    this.removed = {
      strokes: removeFrom(page.strokes, this.elements.strokes),
      images: removeFrom(page.images, this.elements.images),
      textBoxes: removeFrom(page.textBoxes, this.elements.textBoxes),
      tables: page.tables ? removeFrom(page.tables, this.elements.tables ?? []) : [],
      graphs: page.graphs ? removeFrom(page.graphs, this.elements.graphs ?? []) : [],
    };
  }

  invert(doc: InkDocument): void {
    const page = pageById(doc, this.pageId);
    const removed = this.removed;
    if (!page || !removed) return;
    restoreTo(page.strokes, removed.strokes);
    restoreTo(page.images, removed.images);
    restoreTo(page.textBoxes, removed.textBoxes);
    if (page.tables) restoreTo(page.tables, removed.tables);
    if (page.graphs) restoreTo(page.graphs, removed.graphs);
    this.removed = null;
  }
}

/**
 * Put new elements on one page, above everything already there — a
 * duplicated selection. Undo takes exactly those objects away again.
 */
export class AddElements implements Command {
  /** Whether the page had no `tables` list before, so undo leaves it without one. */
  private created = false;
  /** The same for `graphs`. */
  private createdGraphs = false;

  constructor(
    readonly pageId: string,
    private readonly elements: PageElements,
    readonly label = "Duplicate selection",
  ) {}

  apply(doc: InkDocument): void {
    const page = pageById(doc, this.pageId);
    if (!page) return;
    page.strokes.push(...this.elements.strokes);
    page.images.push(...this.elements.images);
    page.textBoxes.push(...this.elements.textBoxes);
    const tables = this.elements.tables ?? [];
    if (tables.length > 0) {
      this.created = page.tables === undefined;
      (page.tables ??= []).push(...tables);
    }
    const graphs = this.elements.graphs ?? [];
    if (graphs.length > 0) {
      this.createdGraphs = page.graphs === undefined;
      (page.graphs ??= []).push(...graphs);
    }
  }

  invert(doc: InkDocument): void {
    const page = pageById(doc, this.pageId);
    if (!page) return;
    removeFrom(page.strokes, this.elements.strokes);
    removeFrom(page.images, this.elements.images);
    removeFrom(page.textBoxes, this.elements.textBoxes);
    if (page.tables) {
      removeFrom(page.tables, this.elements.tables ?? []);
      if (this.created && page.tables.length === 0) delete page.tables;
    }
    if (page.graphs) {
      removeFrom(page.graphs, this.elements.graphs ?? []);
      if (this.createdGraphs && page.graphs.length === 0) delete page.graphs;
    }
    this.created = false;
    this.createdGraphs = false;
  }
}

/** Give selected strokes one colour; undo restores each stroke's own. */
export class RecolorStrokes implements Command {
  readonly label = "Change colour";
  private previous: Array<{ stroke: Stroke; color: string }> = [];

  constructor(
    readonly pageId: string,
    private readonly strokes: readonly Stroke[],
    private readonly color: string,
  ) {}

  apply(doc: InkDocument): void {
    this.previous = [];
    const page = pageById(doc, this.pageId);
    if (!page) return;
    for (const stroke of present(page.strokes, this.strokes)) {
      this.previous.push({ stroke, color: stroke.color });
      stroke.color = this.color;
    }
  }

  invert(doc: InkDocument): void {
    if (!pageById(doc, this.pageId)) return;
    for (const { stroke, color } of this.previous) stroke.color = color;
    this.previous = [];
  }
}

/**
 * Give the selected shapes a fill, line style, corners or arrowheads, each
 * shape taking the parts its kind can (`applyShapeStyle`); undo puts every
 * shape back as it was, points included (an arrow given heads became a line).
 */
export class RestyleShapes implements Command {
  readonly label = "Change shape style";
  private previous: Array<{ stroke: Stroke; saved: StyleFields }> = [];

  constructor(
    readonly pageId: string,
    private readonly strokes: readonly Stroke[],
    private readonly style: ShapeStyle,
  ) {}

  apply(doc: InkDocument): void {
    this.previous = [];
    const page = pageById(doc, this.pageId);
    if (!page) return;
    for (const stroke of present(page.strokes, this.strokes)) {
      const saved = styleFieldsOf(stroke);
      if (applyShapeStyle(stroke, this.style)) this.previous.push({ stroke, saved });
    }
  }

  /** Whether applying it changed anything. */
  get changed(): boolean {
    return this.previous.length > 0;
  }

  invert(doc: InkDocument): void {
    if (!pageById(doc, this.pageId)) return;
    for (const { stroke, saved } of this.previous) restoreStyleFields(stroke, saved);
    this.previous = [];
  }
}

/** Fresh ids for copied elements. */
export interface IdSource {
  stroke: () => string;
  image: () => string;
  textBox: () => string;
  table: () => string;
  graph: () => string;
}

/**
 * Deep copies of a selection with fresh ids, moved by (dx, dy): what
 * "Duplicate" places. A copied stroke loses its `t0` — it was not written at
 * the original's moment, and an absent `t0` means "unknown", which is the
 * truth (contracts/api.md §1b). A copied image shares its original's file.
 */
export function copyElements(
  elements: PageElements,
  ids: IdSource,
  dx: number,
  dy: number,
): ElementLists {
  return {
    strokes: elements.strokes.map((stroke) => {
      const copy = structuredClone(stroke);
      copy.id = ids.stroke();
      copy.pts = translatePoints(stroke.pts, dx, dy);
      delete copy.t0;
      return copy;
    }),
    images: elements.images.map((image) => {
      const copy = structuredClone(image);
      copy.id = ids.image();
      copy.x += dx;
      copy.y += dy;
      return copy;
    }),
    textBoxes: elements.textBoxes.map((textBox) => {
      const copy = structuredClone(textBox);
      copy.id = ids.textBox();
      copy.x += dx;
      copy.y += dy;
      return copy;
    }),
    tables: (elements.tables ?? []).map((table) => {
      const copy = structuredClone(table);
      copy.id = ids.table();
      copy.x += dx;
      copy.y += dy;
      return copy;
    }),
    // A full copy, so any field added later comes along (ledger: picked fields).
    graphs: (elements.graphs ?? []).map((graph) => {
      const copy = structuredClone(graph);
      copy.id = ids.graph();
      copy.x += dx;
      copy.y += dy;
      return copy;
    }),
  };
}

// --- Helpers ----------------------------------------------------------------

export interface Removed<T> {
  index: number;
  item: T;
}

/** The members of `wanted` found in `list`, in `list`'s order. */
function present<T>(list: readonly T[], wanted: readonly T[]): T[] {
  if (wanted.length === 0) return [];
  const set = new Set(wanted);
  return list.filter((item) => set.has(item));
}

/** Remove `targets` from `list` by identity, recording where each was (highest index first). */
export function removeFrom<T>(list: T[], targets: readonly T[]): Array<Removed<T>> {
  const removed: Array<Removed<T>> = [];
  if (targets.length === 0) return removed;
  const set = new Set(targets);
  // High to low, so a splice never shifts an index still to be visited.
  for (let i = list.length - 1; i >= 0; i--) {
    if (!set.has(list[i])) continue;
    removed.push({ index: i, item: list[i] });
    list.splice(i, 1);
  }
  return removed;
}

/** Undo {@link removeFrom}: reinsert lowest index first, so each lands where it was. */
export function restoreTo<T>(list: T[], removed: ReadonlyArray<Removed<T>>): void {
  for (let k = removed.length - 1; k >= 0; k--) {
    const { index, item } = removed[k];
    list.splice(Math.min(index, list.length), 0, item);
  }
}
