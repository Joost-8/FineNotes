/**
 * Every edit to a notebook is a {@link Command}: an object that can make its
 * change and take it back again. The undo stack (`history.ts`) keeps the
 * commands themselves, so it costs as much memory as the edits did, never a
 * copy of the notebook per step.
 *
 * The page, backdrop, image and snap commands live here; stroke and text box
 * commands have files of their own (`page-commands.ts`, `text-commands.ts`
 * and others). Nothing here touches the DOM or Obsidian.
 */

import {
  type Backdrop,
  type ImageElement,
  type InkDocument,
  type Page,
  type ShapeKind,
  imageById,
  insertPage,
  pageById,
  pageIndexById,
  removePageAt,
  strokeById,
} from "./document";

/**
 * One undoable edit. `apply` makes the change and `invert` takes it back;
 * after `apply` then `invert` the document should save exactly as it did
 * before, which means restoring key order and absent fields too, not only
 * values.
 */
export interface Command {
  /** A short name for the edit, as a person would say it ("Add page"). */
  readonly label: string;
  /**
   * The id of the one page this command changes, when it changes exactly one.
   * Undo and redo use it to show the change: a page off screen glides into
   * view. Absent for document-wide commands.
   */
  readonly pageId?: string;
  /** Make the change. Redo calls it again after an `invert`. */
  apply(doc: InkDocument): void;
  /** Take back what the last `apply` did. */
  invert(doc: InkDocument): void;
}

/* ------------------------------------------------------------------------ *
 * Pages, backdrops, images and shape snapping, specified in contracts/api.md
 * §3. Every one of these is its own inverse or has an exact counterpart.
 * ------------------------------------------------------------------------ */

/** Insert a page at `index`. Inverse: remove that same page. */
export class AddPage implements Command {
  readonly label = "Add page";

  constructor(
    private readonly index: number,
    private readonly page: Page,
  ) {}

  get pageId(): string {
    return this.page.id;
  }

  apply(doc: InkDocument): void {
    insertPage(doc, this.index, this.page);
  }

  invert(doc: InkDocument): void {
    // By identity first. Resolving by id removed the *first* page with that
    // id, so inserting a page whose id already existed and then undoing
    // deleted the original along with its ink. Ids are only unique per file
    // under schema v3, so a duplicate or an import can reintroduce a clash.
    // `index` is no good either: it is clamped on insert.
    let at = doc.pages.indexOf(this.page);
    if (at < 0) at = pageIndexById(doc, this.page.id);
    if (at >= 0) removePageAt(doc, at);
  }
}

/**
 * Remove the page at `index`.
 *
 * A no-op on the last remaining page: a document always has at least one page
 * (contracts/api.md §3). When it is a no-op, `invert()` is too.
 */
export class RemovePage implements Command {
  readonly label = "Remove page";
  private removed: Page | null = null;

  constructor(private readonly index: number) {}

  apply(doc: InkDocument): void {
    this.removed = removePageAt(doc, this.index);
  }

  invert(doc: InkDocument): void {
    if (!this.removed) return;
    insertPage(doc, this.index, this.removed);
    this.removed = null;
  }
}

/** Swap a page's backdrop (blank/lined/grid/PDF). Its own inverse. */
export class SetBackdrop implements Command {
  readonly label = "Change paper";
  private previous: Backdrop | null = null;

  constructor(
    readonly pageId: string,
    private readonly backdrop: Backdrop,
  ) {}

  apply(doc: InkDocument): void {
    const page = pageById(doc, this.pageId);
    if (!page) return;
    this.previous = page.backdrop;
    page.backdrop = this.backdrop;
  }

  invert(doc: InkDocument): void {
    const page = pageById(doc, this.pageId);
    if (!page || !this.previous) return;
    page.backdrop = this.previous;
    this.previous = null;
  }
}

/** Place an image on a page. Inverse: remove it again. */
export class InsertImage implements Command {
  readonly label = "Insert image";

  constructor(
    readonly pageId: string,
    private readonly image: ImageElement,
  ) {}

  apply(doc: InkDocument): void {
    const page = pageById(doc, this.pageId);
    if (!page) return;
    page.images.push(this.image);
  }

  invert(doc: InkDocument): void {
    const page = pageById(doc, this.pageId);
    if (!page) return;
    // Re-find exactly the element this command placed. An id is not unique in
    // a file that was merged or hand-edited, and removing the first match
    // would take away a different image (CLAUDE.md: "Resolve an inverse by
    // identity, not by a key that can repeat").
    let index = page.images.indexOf(this.image);
    if (index < 0) index = page.images.findIndex((img) => img.id === this.image.id);
    if (index >= 0) page.images.splice(index, 1);
  }
}

/** Geometry of a placed image. `rotation` is radians clockwise about its centre. */
export interface ImageTransform {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
}

/**
 * Move/resize/rotate a placed image. Its own inverse, via the saved previous box.
 *
 * Takes the geometry as one {@link ImageTransform}, per contracts/api.md §3 —
 * seven positional numbers were too easy to transpose at a call site.
 */
export class TransformImage implements Command {
  readonly label = "Transform image";
  private readonly next: ImageTransform;
  private previous: ImageTransform | null = null;

  constructor(
    readonly pageId: string,
    private readonly imageId: string,
    box: ImageTransform,
  ) {
    this.next = { ...box };
  }

  apply(doc: InkDocument): void {
    const image = imageById(doc, this.pageId, this.imageId);
    if (!image) return;
    this.previous = { x: image.x, y: image.y, w: image.w, h: image.h, rotation: image.rotation };
    assignTransform(image, this.next);
  }

  invert(doc: InkDocument): void {
    const image = imageById(doc, this.pageId, this.imageId);
    if (!image || !this.previous) return;
    assignTransform(image, this.previous);
    this.previous = null;
  }
}

function assignTransform(image: ImageElement, box: ImageTransform): void {
  image.x = box.x;
  image.y = box.y;
  image.w = box.w;
  image.h = box.h;
  // Undoing back to "no rotation recorded" must not leave `rotation: 0`
  // behind, or a round-trip through serialize.ts stops being identity.
  if (box.rotation === undefined) delete image.rotation;
  else image.rotation = box.rotation;
}

/** Remove a placed image, restoring its stacking position on undo. */
export class RemoveImage implements Command {
  readonly label = "Delete image";
  private removed: { index: number; image: ImageElement } | null = null;

  constructor(
    readonly pageId: string,
    private readonly imageId: string,
  ) {}

  apply(doc: InkDocument): void {
    const page = pageById(doc, this.pageId);
    if (!page) return;
    const index = page.images.findIndex((img) => img.id === this.imageId);
    if (index < 0) return;
    this.removed = { index, image: page.images[index] };
    page.images.splice(index, 1);
  }

  invert(doc: InkDocument): void {
    const page = pageById(doc, this.pageId);
    if (!page || !this.removed) return;
    page.images.splice(this.removed.index, 0, this.removed.image);
    this.removed = null;
  }
}

/**
 * Replace a stroke's freehand points with recognized geometry (hold-to-snap).
 *
 * A snapped shape stays an ordinary stroke — only `pts` and `shape` change, so
 * rendering, hit-testing, erasing, lasso and serialization need no special
 * case (contracts/api.md §2). Undo restores the original points **and clears
 * `shape`**, so an undone snap is indistinguishable from never having snapped.
 */
export class SnapStrokeToShape implements Command {
  readonly label = "Snap to shape";
  private previous: { pts: number[]; shape?: ShapeKind } | null = null;

  constructor(
    readonly pageId: string,
    private readonly strokeId: string,
    private readonly pts: number[],
    private readonly shape: ShapeKind,
  ) {}

  apply(doc: InkDocument): void {
    const stroke = strokeById(doc, this.pageId, this.strokeId);
    if (!stroke) return;
    this.previous = { pts: stroke.pts, shape: stroke.shape };
    stroke.pts = this.pts;
    stroke.shape = this.shape;
  }

  invert(doc: InkDocument): void {
    const stroke = strokeById(doc, this.pageId, this.strokeId);
    if (!stroke || !this.previous) return;
    stroke.pts = this.previous.pts;
    if (this.previous.shape === undefined) delete stroke.shape;
    else stroke.shape = this.previous.shape;
    this.previous = null;
  }
}
