/**
 * Sticky notes: paper placed on a page like a picture, that carries ink of
 * its own. A note is an {@link ImageElement} with `sticky` (its colour); the
 * ink written on it is ordinary page strokes whose `onSticky` names it. So
 * the eraser, the lasso, undo, the stroke caches, thumbnails and exports
 * reach that ink as they reach any other, and what is special is only this:
 *
 * - a pen or highlighter stroke that starts on a note belongs to it
 *   ({@link noteAt});
 * - whatever moves, resizes, turns or mirrors a note takes its ink along
 *   ({@link MoveNoteInk}, {@link noteMove}), and deleting or copying a note
 *   deletes or copies its ink ({@link withNoteInk}, {@link copyNoteInk});
 * - the ink is drawn with its note, clipped to it (`canvas/renderer`);
 * - on disk the ink lives inside its note, in the note's own space
 *   ({@link foldNoteInk}, {@link unfoldNoteInk}), and the notebook is
 *   labelled so an older FineNotes refuses it (`format-features.ts`).
 *
 * A note can also carry typed text, a text box whose `onSticky` names it
 * ({@link textOfNote}), kept in page space and moved with the note
 * ({@link noteTextMoved}); and it can be folded away to an icon at its
 * corner, hiding its ink and text until a tap opens it ({@link SetNoteFolded},
 * {@link foldedFrame}, {@link foldedNoteAt}), as Goodnotes collapses a note.
 *
 * A note's own space: note px, origin at its top-left, before it is turned
 * or mirrored, at its current size (contracts/api.md, "Sticky notes").
 *
 * Pure: no DOM, no Obsidian.
 */

import type { Command } from "./commands";
import {
  type ImageElement,
  type InkDocument,
  type Page,
  type StickyPaper,
  type Stroke,
  type TextBoxElement,
  POINT_STRIDE,
  pageById,
} from "./document";

/** A colour the sticky notes button offers a note in. */
export interface StickyColor {
  id: string;
  /** What the swatch is called (its tooltip). */
  label: string;
  /** `#rrggbb`. */
  color: string;
}

/**
 * The ten note colours offered, round the colour wheel as Goodnotes lays
 * its notes out, ending on grey and white. Yellow, pink, blue and green are
 * the colours notes were made in before, unchanged.
 */
export const STICKY_COLORS: readonly StickyColor[] = [
  { id: "red", label: "Red", color: "#fecaca" },
  { id: "orange", label: "Orange", color: "#fed7aa" },
  { id: "yellow", label: "Yellow", color: "#fde68a" },
  { id: "green", label: "Green", color: "#bbf7d0" },
  { id: "teal", label: "Teal", color: "#a5f3fc" },
  { id: "blue", label: "Blue", color: "#bfdbfe" },
  { id: "purple", label: "Purple", color: "#e9d5ff" },
  { id: "pink", label: "Pink", color: "#fbcfe8" },
  { id: "grey", label: "Grey", color: "#e5e7eb" },
  { id: "white", label: "White", color: "#ffffff" },
];

/** The colour a first note is offered in: the classic yellow. */
export const DEFAULT_STICKY_COLOR = "#fde68a";

/** A new note's side, page px: about 50 mm on an A4 page (a real 76 mm note leaves too little page). */
export const STICKY_SIDE = 240;

const HEX6 = /^#[0-9a-f]{6}$/i;

/** A stored note's paper, or `undefined` when it is not a readable one. */
export function readStickyPaper(raw: unknown): StickyPaper | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const color = (raw as { color?: unknown }).color;
  if (typeof color !== "string" || !HEX6.test(color)) return undefined;
  const folded = (raw as { folded?: unknown }).folded === true;
  return folded ? { color: color.toLowerCase(), folded: true } : { color: color.toLowerCase() };
}

/** Whether `image` is a sticky note. */
export function isStickyNote(image: ImageElement): image is ImageElement & { sticky: StickyPaper } {
  return image.sticky !== undefined;
}

/** The ids of the sticky notes among `images`, or `null` when there is none (the usual case). */
export function noteIdsOf(images: readonly ImageElement[]): ReadonlySet<string> | null {
  let ids: Set<string> | null = null;
  for (const image of images) {
    if (!isStickyNote(image)) continue;
    ids ??= new Set();
    ids.add(image.id);
  }
  return ids;
}

/** Whether `stroke` is ink on one of the notes in `ids` (from {@link noteIdsOf}). */
export function isNoteInk(stroke: Stroke, ids: ReadonlySet<string> | null): boolean {
  return ids !== null && stroke.onSticky !== undefined && ids.has(stroke.onSticky);
}

/** The ink on `note`, in page order. */
export function inkOfNote(page: Page, note: ImageElement): Stroke[] {
  if (!isStickyNote(note)) return [];
  return page.strokes.filter((stroke) => stroke.onSticky === note.id);
}

/** Whether `image` is a sticky note folded away to its icon. */
export function isFolded(image: ImageElement): boolean {
  return image.sticky?.folded === true;
}

/**
 * Whether `element` (a stroke or a text box) is on a note of `page` that is
 * folded away, so nothing but the note's own opening may reach it.
 */
export function foldedAway(page: Page, element: { onSticky?: string }): boolean {
  const owner = element.onSticky;
  if (owner === undefined) return false;
  return page.images.some((image) => image.id === owner && isFolded(image));
}

/** The typed text on `note`: the text boxes that name it, in page order. */
export function textOfNote(page: Page, note: ImageElement): TextBoxElement[] {
  if (!isStickyNote(note)) return [];
  return page.textBoxes.filter((box) => box.onSticky === note.id);
}

/** The sticky note `box` is the text of, or `null` for a box of its own (or one whose note is gone). */
export function noteOfText(page: Page, box: TextBoxElement): ImageElement | null {
  if (box.onSticky === undefined) return null;
  const note = page.images.find((image) => image.id === box.onSticky);
  return note && isStickyNote(note) ? note : null;
}

// --- Typed text ---------------------------------------------------------------

/** How far a note's text keeps from the paper's sides, page px. */
export const NOTE_TEXT_INSET = 12;

/**
 * Where a note's text box starts: inset from the sides, just below the
 * glued band at the top (its share of the height, as `canvas/sticky-paper`
 * paints it), as wide as the paper allows, growing with the text.
 */
export function noteTextFrame(note: NoteFrame): { x: number; y: number; w: number } {
  const inset = Math.min(NOTE_TEXT_INSET, note.w / 4);
  return {
    x: note.x + inset,
    y: note.y + note.h * 0.16 + inset / 2,
    w: Math.max(1, note.w - 2 * inset),
  };
}

/**
 * Where a note's text is drawn: from where it stands on the note unturned
 * to the page, turned about the note's centre with it. A mirror never
 * mirrors the letters, so `flipX`/`flipY` play no part.
 */
export function noteTextToPage(note: NoteFrame): Affine {
  const r = rotationOf(note);
  if (r === 0) return IDENTITY;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const cx = note.x + note.w / 2;
  const cy = note.y + note.h / 2;
  return [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
}

// --- Folding ------------------------------------------------------------------

/** The side of a folded note's icon, page px: about 8 mm on an A4 page. */
export const FOLDED_SIDE = 40;

/**
 * Where a folded note shows: a square icon at the note's top-left corner as
 * it stands, turned with it (and never mirrored, so the icon reads the same
 * way round). Within the note's own frame, so the tiles the note covers
 * cover its icon too.
 */
export function foldedFrame(note: NoteFrame): NoteFrame {
  const side = Math.max(1, Math.min(FOLDED_SIDE, note.w, note.h));
  const centre = applyAffine(noteTextToPage(note), note.x + side / 2, note.y + side / 2);
  const r = rotationOf(note);
  return {
    x: centre.x - side / 2,
    y: centre.y - side / 2,
    w: side,
    h: side,
    ...(r !== 0 ? { rotation: r } : {}),
  };
}

/**
 * The folded note whose icon is at page point (x, y), or `null`: the topmost
 * picture or open note there hides an icon under it, as it hides ink.
 */
export function foldedNoteAt(page: Page, x: number, y: number): ImageElement | null {
  for (const image of stackedFromTop(page)) {
    if (isFolded(image)) {
      if (onNote(foldedFrame(image), x, y)) return image;
      continue;
    }
    if (onNote(image, x, y)) return null;
  }
  return null;
}

/** A page's pictures and notes from the topmost down: those in front of the ink first. */
function stackedFromTop(page: Page): ImageElement[] {
  const front = page.images.filter((image) => image.front === true).reverse();
  const back = page.images.filter((image) => image.front !== true).reverse();
  return [...front, ...back];
}

// --- Frames ---------------------------------------------------------------------

/** What places a note on its page. */
export type NoteFrame = Pick<ImageElement, "x" | "y" | "w" | "h" | "rotation" | "flipX" | "flipY">;

/**
 * A 2-D affine map, as the canvas writes one: x' = a·x + c·y + e,
 * y' = b·x + d·y + f.
 */
export type Affine = readonly [number, number, number, number, number, number];

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

/** `m` after `n`: the map that applies `n` first. */
export function compose(m: Affine, n: Affine): Affine {
  const [a, b, c, d, e, f] = m;
  const [a2, b2, c2, d2, e2, f2] = n;
  return [
    a * a2 + c * b2,
    b * a2 + d * b2,
    a * c2 + c * d2,
    b * c2 + d * d2,
    a * e2 + c * f2 + e,
    b * e2 + d * f2 + f,
  ];
}

/** The inverse of `m`, or `null` when it has none. */
export function invert(m: Affine): Affine | null {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/** Where (x, y) goes under `m`. */
export function applyAffine(m: Affine, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/** How much `m` scales a length, on average over directions: the root of its area scale. */
export function lengthScale(m: Affine): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

function rotationOf(frame: NoteFrame): number {
  const r = frame.rotation;
  return typeof r === "number" && Number.isFinite(r) ? r : 0;
}

/**
 * From the note's own space to the page: mirrored in its frame, turned about
 * its centre, as the canvas draws a picture (`drawPlacedImage`).
 */
export function noteToPage(frame: NoteFrame): Affine {
  const r = rotationOf(frame);
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const sx = frame.flipX === true ? -1 : 1;
  const sy = frame.flipY === true ? -1 : 1;
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;
  // T(c) · R(r) · S(sx, sy) · T(-w/2, -h/2)
  const a = cos * sx;
  const b = sin * sx;
  const c = -sin * sy;
  const d = cos * sy;
  const hx = -frame.w / 2;
  const hy = -frame.h / 2;
  return [a, b, c, d, a * hx + c * hy + cx, b * hx + d * hy + cy];
}

/** From the page to the note's own space; the identity for a degenerate frame. */
export function pageToNote(frame: NoteFrame): Affine {
  return invert(noteToPage(frame)) ?? IDENTITY;
}

/**
 * Where ink on a note framed `before` lands when the note is framed `after`:
 * its place on the paper kept, as fractions of the note's width and height.
 * One map for a move, a resize (which stretches the ink with the paper), a
 * turn and a mirror.
 */
export function noteMove(before: NoteFrame, after: NoteFrame): Affine {
  const kx = before.w > 0 ? after.w / before.w : 1;
  const ky = before.h > 0 ? after.h / before.h : 1;
  return compose(noteToPage(after), compose([kx, 0, 0, ky, 0, 0], pageToNote(before)));
}

/** Whether `m` leaves every point where it was. */
export function isIdentity(m: Affine, eps = 1e-9): boolean {
  return m.every((value, i) => Math.abs(value - IDENTITY[i]) <= eps);
}

/** A copy of `pts` under `m`: whole points only, pressure kept, a ragged tail copied as is. */
export function mapPoints(pts: readonly number[], m: Affine): number[] {
  const out = pts.slice();
  const usable = out.length - (out.length % POINT_STRIDE);
  for (let i = 0; i < usable; i += POINT_STRIDE) {
    const p = applyAffine(m, out[i], out[i + 1]);
    out[i] = p.x;
    out[i + 1] = p.y;
  }
  return out;
}

/** Whether page point (x, y) is on `frame`'s paper. */
export function onNote(frame: NoteFrame, x: number, y: number): boolean {
  const local = applyAffine(pageToNote(frame), x, y);
  return local.x >= 0 && local.x <= frame.w && local.y >= 0 && local.y <= frame.h;
}

/**
 * The sticky note a stroke starting at page point (x, y) is written on, or
 * `null`: the topmost picture or note there decides, so a picture laid over a
 * note takes the stroke off it. Pictures in front of the ink stack above
 * those under it; later ones above earlier ones. A folded note is no paper
 * to write on: it is passed over, and what lies under it decides.
 */
export function noteAt(page: Page, x: number, y: number): ImageElement | null {
  for (const image of stackedFromTop(page)) {
    if (isFolded(image) || !onNote(image, x, y)) continue;
    return isStickyNote(image) ? image : null;
  }
  return null;
}

/**
 * Whether `stroke` shows at page point (x, y), as far as sticky notes
 * decide, so the eraser takes only what it is seen to touch: a note's ink
 * only on that note, where nothing lies over it; page ink not under a note
 * stuck on in front of the ink. `notes` is {@link noteIdsOf} the page's
 * images; without notes everything shows, as before.
 */
export function shownAt(
  page: Page,
  stroke: Stroke,
  x: number,
  y: number,
  notes: ReadonlySet<string> | null = noteIdsOf(page.images),
): boolean {
  if (!notes) return true;
  const top = noteAt(page, x, y);
  if (isNoteInk(stroke, notes)) return top !== null && top.id === stroke.onSticky;
  return top?.front !== true;
}

// --- Selections, copies, deletes ------------------------------------------------

/** The elements of a selection this module looks at. */
export interface StrokesAndImages {
  strokes: readonly Stroke[];
  images: readonly ImageElement[];
}

/**
 * `strokes` with the ink of every note in `images` added (once, in page
 * order), so a note never moves, turns, copies or goes without its ink.
 */
export function withNoteInk(page: Page, selection: StrokesAndImages): Stroke[] {
  const ids = noteIdsOf(selection.images);
  if (!ids) return [...selection.strokes];
  const chosen = new Set(selection.strokes);
  return page.strokes.filter((stroke) => chosen.has(stroke) || isNoteInk(stroke, ids));
}

/**
 * `textBoxes` with the text of every note in `images` added (once, in page
 * order), so a note never moves, copies or goes without its text.
 */
export function withNoteText(
  page: Page,
  selection: { textBoxes: readonly TextBoxElement[]; images: readonly ImageElement[] },
): TextBoxElement[] {
  const ids = noteIdsOf(selection.images);
  if (!ids) return [...selection.textBoxes];
  const chosen = new Set(selection.textBoxes);
  return page.textBoxes.filter(
    (box) => chosen.has(box) || (box.onSticky !== undefined && ids.has(box.onSticky)),
  );
}

/**
 * The note a selection holds alone, ink aside: one note, and no stroke that
 * is not its ink. Such a selection is shown as the note's own, with a
 * picture's handles.
 */
export function loneNote(selection: StrokesAndImages): ImageElement | null {
  if (selection.images.length !== 1) return null;
  const note = selection.images[0];
  if (!isStickyNote(note)) return null;
  return selection.strokes.every((stroke) => stroke.onSticky === note.id) ? note : null;
}

/**
 * Point copied strokes (or text boxes) at their notes' copies: `owners`
 * maps an original note's id to its copy's. One whose note was not copied
 * with it is plain ink (or a box of its own) from then on, never the
 * original note's.
 */
export function relinkNoteInk(
  strokes: ReadonlyArray<{ onSticky?: string }>,
  owners: ReadonlyMap<string, string>,
): void {
  for (const stroke of strokes) {
    if (stroke.onSticky === undefined) continue;
    const owner = owners.get(stroke.onSticky);
    if (owner === undefined) delete stroke.onSticky;
    else stroke.onSticky = owner;
  }
}

/**
 * Copies of `note`'s ink for its copy `copy`: fresh ids, owned by the copy,
 * moved with it (the copy may sit anywhere, turned or mirrored otherwise),
 * and without `t0`, as any duplicate (contracts/api.md §1b).
 */
export function copyNoteInk(
  page: Page,
  note: ImageElement,
  copy: ImageElement,
  nextId: () => string,
): Stroke[] {
  const m = noteMove(note, copy);
  return inkOfNote(page, note).map((stroke) => {
    const out = structuredClone(stroke);
    out.id = nextId();
    out.onSticky = copy.id;
    delete out.t0;
    moveStroke(out, m);
    return out;
  });
}

/**
 * Copies of `note`'s text for its copy `copy`: fresh ids, owned by the
 * copy, at the same place on its paper (`copy` may sit anywhere, and be
 * another size).
 */
export function copyNoteText(
  page: Page,
  note: ImageElement,
  copy: ImageElement,
  nextId: () => string,
): TextBoxElement[] {
  return textOfNote(page, note).map((box) => {
    const out = structuredClone(box);
    out.id = nextId();
    out.onSticky = copy.id;
    Object.assign(out, noteTextMoved(box, note, copy));
    return out;
  });
}

/**
 * Where a note's text box stands once its note goes from `before` to
 * `after`: the same place on the paper, as fractions of its width and
 * height, and as wide a share of it. The letters keep their size, and wrap
 * to the new width.
 */
export function noteTextMoved(
  box: Pick<TextBoxElement, "x" | "y" | "w" | "h">,
  before: NoteFrame,
  after: NoteFrame,
): { x: number; y: number; w: number; h?: number } {
  const kx = before.w > 0 ? after.w / before.w : 1;
  const ky = before.h > 0 ? after.h / before.h : 1;
  return {
    x: after.x + (box.x - before.x) * kx,
    y: after.y + (box.y - before.y) * ky,
    w: Math.max(1, box.w * kx),
    ...(box.h !== undefined ? { h: box.h * ky } : {}),
  };
}

/** Move a stroke by `m` in place: new points, and its width scaled as the map scales lengths. */
function moveStroke(stroke: Stroke, m: Affine): void {
  stroke.pts = mapPoints(stroke.pts, m);
  const k = lengthScale(m);
  if (Math.abs(k - 1) > 1e-9 && k > 0) {
    stroke.size *= k;
    if (stroke.radius !== undefined) stroke.radius *= k;
  }
}

// --- Commands ---------------------------------------------------------------------

/**
 * Take a note's ink along when the note goes from frame `before` to frame
 * `after` (a move, resize, turn or mirror of the note, which another command
 * makes). Each stroke gets a new points array, so the stroke path cache sees
 * the change (CLAUDE.md, "A stroke's end points cannot see a turn"); undo
 * puts the old arrays back.
 */
export class MoveNoteInk implements Command {
  readonly label = "Move sticky note";
  private saved: Array<{ stroke: Stroke; pts: number[]; size: number; radius?: number }> | null =
    null;
  /** The note's text boxes and where each stood, for the undo. */
  private savedText: Array<{ box: TextBoxElement; x: number; y: number; w: number; h?: number }> =
    [];

  constructor(
    readonly pageId: string,
    private readonly note: ImageElement,
    private readonly before: NoteFrame,
    private readonly after: NoteFrame,
  ) {}

  apply(doc: InkDocument): void {
    this.saved = null;
    this.savedText = [];
    const page = pageById(doc, this.pageId);
    if (!page || !page.images.includes(this.note)) return;
    const m = noteMove(this.before, this.after);
    if (isIdentity(m)) return;
    this.saved = inkOfNote(page, this.note).map((stroke) => {
      const saved = { stroke, pts: stroke.pts, size: stroke.size, radius: stroke.radius };
      moveStroke(stroke, m);
      return saved;
    });
    // A turn or a mirror leaves the text where it stands on the paper.
    this.savedText = textOfNote(page, this.note).map((box) => {
      const saved = { box, x: box.x, y: box.y, w: box.w, h: box.h };
      Object.assign(box, noteTextMoved(box, this.before, this.after));
      return saved;
    });
  }

  invert(doc: InkDocument): void {
    if (!this.saved || !pageById(doc, this.pageId)) return;
    for (const { stroke, pts, size, radius } of this.saved) {
      stroke.pts = pts;
      stroke.size = size;
      if (radius === undefined) delete stroke.radius;
      else stroke.radius = radius;
    }
    for (const { box, x, y, w, h } of this.savedText) {
      Object.assign(box, { x, y, w });
      if (h === undefined) delete box.h;
      else box.h = h;
    }
    this.saved = null;
    this.savedText = [];
  }
}

/**
 * Fold a note away to its icon, or open it again. Its own inverse; the
 * frame, the ink and the text stay as they are, only hidden.
 */
export class SetNoteFolded implements Command {
  readonly label: string;
  private previous: StickyPaper | null = null;

  constructor(
    readonly pageId: string,
    private readonly note: ImageElement,
    private readonly folded: boolean,
  ) {
    this.label = folded ? "Fold note" : "Open note";
  }

  apply(doc: InkDocument): void {
    this.previous = null;
    const page = pageById(doc, this.pageId);
    const paper = this.note.sticky;
    if (!page || !page.images.includes(this.note) || !paper) return;
    if ((paper.folded === true) === this.folded) return;
    this.previous = paper;
    this.note.sticky = this.folded ? { ...paper, folded: true } : { color: paper.color };
  }

  invert(doc: InkDocument): void {
    if (!this.previous || !pageById(doc, this.pageId)) return;
    this.note.sticky = this.previous;
    this.previous = null;
  }
}

/** Repaint a note in another colour. Its own inverse, through the paper it had. */
export class SetStickyColor implements Command {
  readonly label = "Note colour";
  private previous: StickyPaper | null = null;

  constructor(
    readonly pageId: string,
    private readonly note: ImageElement,
    private readonly color: string,
  ) {}

  apply(doc: InkDocument): void {
    this.previous = null;
    const page = pageById(doc, this.pageId);
    if (!page || !page.images.includes(this.note) || !this.note.sticky) return;
    this.previous = this.note.sticky;
    this.note.sticky = { ...this.note.sticky, color: this.color };
  }

  invert(doc: InkDocument): void {
    if (!this.previous || !pageById(doc, this.pageId)) return;
    this.note.sticky = this.previous;
    this.previous = null;
  }
}

/**
 * A new note: `color` paper, `STICKY_SIDE` square at `box`'s place, in front
 * of the ink (a note covers what it is stuck on), with the next free image
 * id. Its keys are in the order the loader gives them.
 */
export function newStickyNote(
  id: string,
  box: { x: number; y: number; w: number; h: number },
  color: string,
): ImageElement {
  return { id, path: "", x: box.x, y: box.y, w: box.w, h: box.h, front: true, sticky: { color } };
}

/**
 * Where a note of side `side` stuck at page point `at` goes: centred on it,
 * then slid inside a page `width` by `height` (a note larger than the page
 * sits at its corner).
 */
export function stickyBoxAt(
  at: { x: number; y: number },
  side: number,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } {
  const clamp = (v: number, room: number): number => Math.max(0, Math.min(room - side, v));
  return { x: clamp(at.x - side / 2, width), y: clamp(at.y - side / 2, height), w: side, h: side };
}

// --- On disk ----------------------------------------------------------------------

/** A page's ink as it is stored: the page's own, and each note's in the note's space. */
export interface FoldedInk {
  /** Strokes not on any note of the page, in page order, as they are. */
  pageInk: Stroke[];
  /** Each note's ink, by note id, in page order: copies in the note's space, without `onSticky`. */
  noteInk: Map<string, Stroke[]>;
}

/**
 * Split a page's strokes for storing. A stroke naming a note that is not on
 * the page stays page ink, and keeps nothing of the link.
 */
export function foldNoteInk(page: Page): FoldedInk {
  const ids = noteIdsOf(page.images);
  const noteInk = new Map<string, Stroke[]>();
  if (!ids) return { pageInk: page.strokes, noteInk };
  const toLocal = new Map<string, Affine>();
  for (const image of page.images) {
    if (ids.has(image.id) && !toLocal.has(image.id)) toLocal.set(image.id, pageToNote(image));
  }
  const pageInk: Stroke[] = [];
  for (const stroke of page.strokes) {
    const owner = stroke.onSticky;
    if (owner === undefined || !ids.has(owner)) {
      if (owner === undefined) pageInk.push(stroke);
      else {
        const plain = { ...stroke };
        delete plain.onSticky;
        pageInk.push(plain);
      }
      continue;
    }
    const local: Stroke = { ...stroke, pts: mapPoints(stroke.pts, toLocal.get(owner) ?? IDENTITY) };
    delete local.onSticky;
    const list = noteInk.get(owner);
    if (list) list.push(local);
    else noteInk.set(owner, [local]);
  }
  return { pageInk, noteInk };
}

/** A note's stored ink back on the page: page space, owned by `note`. */
export function unfoldNoteInk(note: ImageElement, ink: readonly Stroke[]): Stroke[] {
  const m = noteToPage(note);
  return ink.map((stroke) => ({ ...stroke, pts: mapPoints(stroke.pts, m), onSticky: note.id }));
}
