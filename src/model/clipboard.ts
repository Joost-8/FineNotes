/**
 * The in-plugin clipboard (0.5): Cut, Copy and Paste of strokes, pictures and
 * text boxes, shared by every notebook open in this Obsidian window. Pure —
 * the one instance lives in the view layer (`ink-surface.ts`), and nothing
 * here touches the system clipboard, which cannot carry ink anyway.
 *
 * What is held is a **deep copy** taken at the moment of copying, so editing
 * or deleting the originals afterwards changes nothing that is pasted, and
 * every paste mints fresh copies with fresh ids (`copyElements`). A paste is
 * one `AddElements` — one undo step.
 *
 * ## Where a paste lands (see {@link pastePlacement})
 *
 * 1. Pasted at a point (the lasso's tap-and-hold on paper): centred there.
 * 2. Otherwise, where the elements were on their own page, when that spot is
 *    on screen on the page being pasted into — so a Cut and Paste puts
 *    things back exactly, and a heading copied from one page lands in the
 *    same place on the next.
 * 3. Otherwise centred in the part of the page that is on screen.
 *
 * Then, while the spot already holds the same thing (a Copy pasted onto its
 * own page, or a second paste), the paste steps down and right by
 * {@link PASTE_OFFSET} page px until it finds room, as Duplicate does. The
 * result always keeps the pasted group's centre on the page.
 */

import type { Bounds, ImageElement, PageGeometry, Stroke, TextBoxElement } from "./document";
import { DUPLICATE_OFFSET } from "./images";
import {
  type ElementLists,
  type IdSource,
  type PageElements,
  copyElements,
  isEmptySelection,
} from "./selection-commands";

/** How far each cascaded paste steps down and right, page px (Duplicate's offset). */
export const PASTE_OFFSET = DUPLICATE_OFFSET;
/** Most cascade steps tried before a paste settles for a spot that is taken. */
export const PASTE_MAX_STEPS = 40;
/** Two coordinates this close (page px) are the same place, for "is this spot taken". */
const SAME_SPOT_EPS = 0.5;

export interface Pt {
  x: number;
  y: number;
}

/** What the clipboard holds: deep copies, and their bounds on the page they came from. */
export interface ClipboardEntry {
  elements: ElementLists;
  bounds: Bounds;
}

export class InkClipboard {
  private entry: ClipboardEntry | null = null;
  private left = false;
  private stamp = 0;

  /** Hold deep copies of `elements`. An empty selection clears the clipboard. */
  put(elements: PageElements, bounds: Bounds): void {
    this.left = false;
    this.stamp++;
    if (isEmptySelection(elements)) {
      this.entry = null;
      return;
    }
    this.entry = {
      elements: {
        strokes: elements.strokes.map((stroke) => structuredClone(stroke)),
        images: elements.images.map((image) => structuredClone(image)),
        textBoxes: elements.textBoxes.map((textBox) => structuredClone(textBox)),
      },
      bounds: { ...bounds },
    };
  }

  /** What is held, or `null`. Read-only: paste through {@link pasteCopies}. */
  get content(): Readonly<ClipboardEntry> | null {
    return this.entry;
  }

  /** Bumped by every {@link put}, so a menu can tell the clipboard changed. */
  get version(): number {
    return this.stamp;
  }

  /**
   * Whether there is anything to paste. `withImages: false` asks for a
   * surface that shows no pictures (the inline editor): pictures alone do
   * not count there.
   */
  canPaste(withImages = true): boolean {
    const e = this.entry?.elements;
    if (!e) return false;
    return e.strokes.length > 0 || e.textBoxes.length > 0 || (withImages && e.images.length > 0);
  }

  /**
   * The app lost focus (the window blurred or was hidden) since the last
   * copy: the user may have copied something elsewhere, so a picture on the
   * system clipboard is now likely the fresher of the two.
   */
  noteWindowLeft(): void {
    if (this.entry) this.left = true;
  }

  /** Whether the window was left since the last copy (see {@link noteWindowLeft}). */
  get leftSinceCopy(): boolean {
    return this.left;
  }

  clear(): void {
    this.entry = null;
    this.left = false;
    this.stamp++;
  }
}

/**
 * Fresh copies of what the clipboard holds, moved by (dx, dy), with fresh
 * ids — optionally without pictures (for a surface that cannot show them).
 * A pasted picture is never locked: a lock stays with the one it was set on.
 */
export function pasteCopies(
  entry: Readonly<ClipboardEntry>,
  ids: IdSource,
  dx: number,
  dy: number,
  withImages = true,
): ElementLists {
  const { strokes, images, textBoxes } = entry.elements;
  const copies = copyElements(
    { strokes, images: withImages ? images : [], textBoxes },
    ids,
    dx,
    dy,
  );
  for (const image of copies.images) delete image.locked;
  return copies;
}

export interface PastePlacementInput {
  /** The held elements' bounds, page space, where they were copied. */
  bounds: Bounds;
  /** The page pasted into. */
  page: PageGeometry;
  /** The part of that page on screen, page space; `null` when none is. */
  visible: Bounds | null;
  /** Paste centred on this page point instead (a tap-and-hold). */
  at?: Pt | null;
  /** Whether a paste moved by (dx, dy) would land exactly on the same thing already there. */
  taken: (dx: number, dy: number) => boolean;
  /** Cascade step, page px. Default {@link PASTE_OFFSET}. */
  step?: number;
}

/** How far to move the held elements for a paste; see the module notes for the rules. */
export function pastePlacement(input: PastePlacementInput): { dx: number; dy: number } {
  const { bounds, page, visible } = input;
  const step = input.step ?? PASTE_OFFSET;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  let base = { dx: 0, dy: 0 };
  if (input.at) {
    base = { dx: input.at.x - cx, dy: input.at.y - cy };
  } else if (visible && !containsPoint(visible, cx, cy)) {
    base = {
      dx: (visible.minX + visible.maxX) / 2 - cx,
      dy: (visible.minY + visible.maxY) / 2 - cy,
    };
  }
  for (let k = 0; ; k++) {
    const d = keepOnPage(bounds, base.dx + k * step, base.dy + k * step, page);
    if (k >= PASTE_MAX_STEPS || !input.taken(d.dx, d.dy)) return d;
  }
}

/**
 * Whether `page` already holds one of `copies`, moved by (dx, dy), in the
 * very same place: the same picture file with the same box, the same text at
 * the same spot, or a stroke with the same points count that starts and ends
 * at the same points. Any one match counts — the spot is taken.
 */
export function sameSpotTaken(
  page: PageElements,
  copies: PageElements,
  dx: number,
  dy: number,
): boolean {
  const near = (a: number, b: number): boolean => Math.abs(a - b) <= SAME_SPOT_EPS;
  const imageTaken = (c: ImageElement): boolean =>
    page.images.some(
      (e) =>
        e.path === c.path &&
        near(e.x, c.x + dx) &&
        near(e.y, c.y + dy) &&
        near(e.w, c.w) &&
        near(e.h, c.h),
    );
  const textTaken = (c: TextBoxElement): boolean =>
    page.textBoxes.some((e) => e.text === c.text && near(e.x, c.x + dx) && near(e.y, c.y + dy));
  const strokeTaken = (c: Stroke): boolean => {
    const n = c.pts.length;
    if (n < 3) return false;
    const last = n - (n % 3) - 3;
    return page.strokes.some(
      (e) =>
        e.pts.length === n &&
        near(e.pts[0], c.pts[0] + dx) &&
        near(e.pts[1], c.pts[1] + dy) &&
        near(e.pts[last], c.pts[last] + dx) &&
        near(e.pts[last + 1], c.pts[last + 1] + dy),
    );
  };
  return (
    copies.images.some(imageTaken) ||
    copies.textBoxes.some(textTaken) ||
    copies.strokes.some(strokeTaken)
  );
}

function containsPoint(b: Bounds, x: number, y: number): boolean {
  return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
}

/**
 * Clamp a move so the group's centre stays on the page — as a dragged
 * selection's does (`clampGroupDelta` in `src/canvas/lasso.ts`, which the
 * model may not import): it may hang off an edge, never vanish past it.
 */
function keepOnPage(
  bounds: Bounds,
  dx: number,
  dy: number,
  page: PageGeometry,
): { dx: number; dy: number } {
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const x = clamp(cx + dx, 0, Math.max(0, page.width));
  const y = clamp(cy + dy, 0, Math.max(0, page.height));
  return { dx: x - cx, dy: y - cy };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
