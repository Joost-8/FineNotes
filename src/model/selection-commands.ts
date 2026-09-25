/**
 * Commands on a lasso selection (0.5): move, delete, duplicate and recolour
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
  type TextBoxElement,
  POINT_STRIDE,
  pageById,
} from "./document";

/** The elements a selection holds on one page. */
export interface PageElements {
  strokes: readonly Stroke[];
  images: readonly ImageElement[];
  textBoxes: readonly TextBoxElement[];
}

/** The same elements as fresh, mutable lists. */
export interface ElementLists {
  strokes: Stroke[];
  images: ImageElement[];
  textBoxes: TextBoxElement[];
}

/** Which of `elements` are on `page` right now, in page order. */
export function elementsOnPage(page: Page, elements: PageElements): ElementLists {
  return {
    strokes: present(page.strokes, elements.strokes),
    images: present(page.images, elements.images),
    textBoxes: present(page.textBoxes, elements.textBoxes),
  };
}

/** Whether a selection holds nothing. */
export function isEmptySelection(elements: PageElements): boolean {
  return (
    elements.strokes.length === 0 && elements.images.length === 0 && elements.textBoxes.length === 0
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
    this.moved = null;
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
    };
  }

  invert(doc: InkDocument): void {
    const page = pageById(doc, this.pageId);
    const removed = this.removed;
    if (!page || !removed) return;
    restoreTo(page.strokes, removed.strokes);
    restoreTo(page.images, removed.images);
    restoreTo(page.textBoxes, removed.textBoxes);
    this.removed = null;
  }
}

/**
 * Put new elements on one page, above everything already there — a
 * duplicated selection. Undo takes exactly those objects away again.
 */
export class AddElements implements Command {
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
  }

  invert(doc: InkDocument): void {
    const page = pageById(doc, this.pageId);
    if (!page) return;
    removeFrom(page.strokes, this.elements.strokes);
    removeFrom(page.images, this.elements.images);
    removeFrom(page.textBoxes, this.elements.textBoxes);
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

/** Fresh ids for copied elements. */
export interface IdSource {
  stroke: () => string;
  image: () => string;
  textBox: () => string;
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
  };
}

// --- Helpers ----------------------------------------------------------------

interface Removed<T> {
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
function removeFrom<T>(list: T[], targets: readonly T[]): Array<Removed<T>> {
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
function restoreTo<T>(list: T[], removed: ReadonlyArray<Removed<T>>): void {
  for (let k = removed.length - 1; k >= 0; k--) {
    const { index, item } = removed[k];
    list.splice(Math.min(index, list.length), 0, item);
  }
}
