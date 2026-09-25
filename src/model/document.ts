/**
 * The notebook as the editor holds it: pages, and the strokes, pictures and
 * text boxes on them. These types are also the file format's shape (see
 * `serialize.ts`, which adds only point quantization on the way to disk).
 * Nothing here touches the DOM or Obsidian.
 *
 * A stroke's points are one flat number array, three numbers per point:
 * x, y, then pressure from 0 to 1. One array per stroke instead of an object
 * per point keeps a page of handwriting small in memory and on disk.
 *
 * Coordinates are **page-local**, not document-global. A page has a fixed
 * intrinsic size and the view scales it to fit, so a stroke
 * at (100, 200) on page 3 lands in the same physical place on a phone, an iPad
 * and a laptop. Nothing in this module may read viewport dimensions — that is
 * the whole reason pagination fixes cross-device ink drift. See PLAN.md.
 */

import { DEFAULT_PAGE_HEIGHT, DEFAULT_PAPER_WIDTH, SCHEMA_VERSION } from "../constants";

export type Tool = "pen" | "highlighter";

/**
 * Geometry a stroke was snapped to or placed as. Absent on freehand strokes.
 * `polygon` is any other closed straight-edged shape (a quad or a pentagon,
 * say) that hold-to-snap straightened.
 */
export type ShapeKind =
  | "line"
  | "circle"
  | "rect"
  | "arrow"
  | "ellipse"
  | "triangle"
  | "diamond"
  | "roundrect"
  | "polygon"
  | "star";

export const SHAPE_KINDS: readonly ShapeKind[] = [
  "line",
  "circle",
  "rect",
  "arrow",
  "ellipse",
  "triangle",
  "diamond",
  "roundrect",
  "polygon",
  "star",
];

export interface Stroke {
  id: string;
  color: string;
  size: number;
  tool: Tool;
  /** x, y, pressure, x, y, pressure, …: whole points only, so the length divides by 3. */
  pts: number[];
  /**
   * Milliseconds from this page's first pen-down to this stroke's pen-down.
   *
   * Absent on strokes written before schema v3, and absent is not zero — a
   * missing `t0` means "unknown", not "at the start". Added ahead of any audio
   * feature because GoodNotes has time-stamped strokes against recordings
   * since 2023 ("Note Replay"), and retrofitting a timestamp onto notebooks
   * that already exist is a migration nobody wants.
   */
  t0?: number;
  /**
   * Set when hold-to-snap replaced the freehand points with clean geometry.
   * A snapped shape is still an ordinary stroke — rendering, hit-testing,
   * erasing and lasso need no special case. See contracts/api.md §2.
   */
  shape?: ShapeKind;
}

/** A page's intrinsic coordinate space, in CSS px. Never viewport-derived. */
export interface PageGeometry {
  width: number;
  height: number;
}

/**
 * Paper ruling, taken from GoodNotes' own template picker (contracts/api.md §1).
 * `lined` and `grid` are retained aliases of `ruled-wide` and `squared` so v1
 * documents and the existing fixtures stay valid.
 */
export type Ruling =
  | "blank"
  | "dotted"
  | "ruled-narrow"
  | "ruled-wide"
  | "squared"
  | "cornell"
  | "legal"
  | "single-column"
  | "three-column"
  | "single-column-mix"
  | "todos"
  | "weekly-planner"
  | "monthly-planner"
  | "accounting"
  | "music"
  | "guitar-tab"
  | "title-date"
  | CoverRuling
  | "lined"
  | "grid";

/**
 * A notebook cover is a page like any other (GoodNotes does the same), drawn
 * procedurally. Its colour is the backdrop's `paperColor`.
 */
export type CoverRuling = "cover-plain" | "cover-label" | "cover-band" | "cover-linen";

export const COVER_RULINGS: readonly CoverRuling[] = [
  "cover-plain",
  "cover-label",
  "cover-band",
  "cover-linen",
];

/** Whether a ruling draws a cover rather than writing paper. */
export function isCoverRuling(kind: string): kind is CoverRuling {
  return (COVER_RULINGS as readonly string[]).includes(kind);
}

/** Every ruling a document may legally carry, for validation at load time. */
export const RULINGS: readonly Ruling[] = [
  "blank",
  "dotted",
  "ruled-narrow",
  "ruled-wide",
  "squared",
  "cornell",
  "legal",
  "single-column",
  "three-column",
  "single-column-mix",
  "todos",
  "weekly-planner",
  "monthly-planner",
  "accounting",
  "music",
  "guitar-tab",
  "title-date",
  ...COVER_RULINGS,
  "lined",
  "grid",
] as const;

/** Procedurally drawn paper. Cheap; redraw freely. */
export interface SyntheticBackdrop {
  kind: Ruling;
  /** Rule/grid pitch in page px. Ignored for "blank". Default per ruling. */
  spacing?: number;
  /** Rule colour, hex. Default per ruling. */
  color?: string;
  /**
   * Paper colour, hex — an axis of its own, as GoodNotes separates "Squared
   * Paper" from "Yellow Paper". Default white.
   */
  paperColor?: string;
}

/** A page of a PDF in the vault. The source file is never modified. */
export interface PdfBackdrop {
  kind: "pdf";
  /** Vault-relative path to the source PDF. */
  path: string;
  /** 0-based page index within that PDF. */
  page: number;
}

export type Backdrop = SyntheticBackdrop | PdfBackdrop;

export interface ImageElement {
  id: string;
  /** Vault-relative path to the image attachment. */
  path: string;
  /** Top-left and size, in page space. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Radians clockwise about the element centre. */
  rotation?: number;
  /**
   * The part of the source picture shown (0.5), as fractions of its natural
   * width and height: `{ x: 0.1, y: 0, w: 0.8, h: 1 }` trims a tenth off
   * each side. Absent means the whole picture. The file is never modified, so a
   * crop can always be undone or widened again.
   */
  crop?: ImageCrop;
  /** A locked image cannot be selected, moved or erased until unlocked. Stored only as `true`. */
  locked?: boolean;
}

/** A crop rectangle in fractions of the source picture: `0 ≤ x < x + w ≤ 1`, same for y. */
export interface ImageCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Text box typefaces. **Only families installed on iPadOS, macOS and Windows
 * alike**: a font that exists on one device and falls back on another wraps
 * differently, so typed text would shift against the ink around it — the
 * cross-device drift that fixed-geometry pages exist to prevent.
 */
export type TextFont = "sans" | "serif" | "times" | "mono" | "verdana" | "trebuchet";

export const TEXT_FONTS: readonly TextFont[] = [
  "sans",
  "serif",
  "times",
  "mono",
  "verdana",
  "trebuchet",
];

/** CSS / canvas font-family list per {@link TextFont}. Real families, never `var(--…)`. */
export const TEXT_FONT_STACKS: Readonly<Record<TextFont, string>> = {
  sans: "Arial, Helvetica, sans-serif",
  serif: "Georgia, serif",
  times: '"Times New Roman", Times, serif',
  mono: '"Courier New", Courier, monospace',
  verdana: "Verdana, Geneva, sans-serif",
  trebuchet: '"Trebuchet MS", sans-serif',
};

export type TextAlign = "left" | "center" | "right" | "justify";

export const TEXT_ALIGNS: readonly TextAlign[] = ["left", "center", "right", "justify"];

/** A typed note placed directly on a page, in the page's intrinsic space. */
export interface TextBoxElement {
  id: string;
  x: number;
  y: number;
  /** Width in page pixels. */
  w: number;
  /**
   * Height in page pixels, when the user sized the box by dragging. Absent
   * means the box grows with its text.
   */
  h?: number;
  /**
   * The box fits its text (GoodNotes' default): the view keeps `w` as wide
   * as the widest line, up to the page's edge. `w` is still stored, so every
   * reader wraps it as the editor did. Absent means `w` is the user's; a
   * resize drops the flag. Never stored as `false`.
   */
  fit?: true;
  text: string;
  color: string;
  /** CSS pixels at a 1:1 page scale. */
  fontSize: number;
  // --- Whole-box style (0.5). Every field is optional and absent means the
  // default, so boxes written before 0.5 load unchanged. `false` is never
  // stored: a style flag is either `true` or absent.
  /** Typeface; absent means `"sans"`. */
  font?: TextFont;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** Absent means `"left"`. */
  align?: TextAlign;
  /** Line height as a multiple of the font size; absent means 1.25. */
  lineHeight?: number;
  /** Background fill, `#rrggbb` or `#rrggbbaa`; absent means none. */
  fill?: string;
}

export type PageKind = "ink";

export interface Page {
  id: string;
  kind: PageKind;
  geometry: PageGeometry;
  backdrop: Backdrop;
  strokes: Stroke[];
  images: ImageElement[];
  textBoxes: TextBoxElement[];
  /**
   * Wall-clock time (ms since the Unix epoch) that this page's stroke `t0`
   * values count from: the pen-down of the first timestamped stroke. Absent
   * until a stroke is timestamped. `epoch + t0` is when a stroke began, which
   * is what lines ink up with an audio recording.
   */
  epoch?: number;
  /**
   * Bookmarked (GoodNotes' "Add to Favourites"): the page sidebar can show
   * bookmarked pages only. Stored only as `true`; absent means not.
   */
  bookmarked?: true;
}

/** An audio recording made while the note was open (0.5). */
export interface Recording {
  id: string;
  /** Vault-relative path of the audio file. */
  path: string;
  /** Wall-clock start, ms since the Unix epoch. */
  start: number;
  /** Length in ms, measured while recording (fragmented MP4 carries none). */
  duration: number;
  /** Vault-relative path of a transcript note, once one was made. */
  transcript?: string;
}

export interface ViewState {
  scrollY: number;
  width: number;
  scale: number;
}

export interface InkDocument {
  version: number;
  view: ViewState;
  /** Always at least one page. */
  pages: Page[];
  /**
   * Written by an older recognition feature. Nothing reads it now (clearing
   * a page's ink drops it); it is kept so a note that carries it saves back
   * byte for byte the same.
   */
  recognizedHash?: string;
  /**
   * A single page rather than a notebook: the view offers no "add page".
   * Only ever stored as `true`.
   */
  single?: boolean;
  /** Audio recorded against this note, oldest first. Absent when there are none. */
  recordings?: Recording[];
  /**
   * Where this note's new pictures and recordings are saved, chosen from the
   * toolbar's settings button. Absent (or a kind absent) means Obsidian's own
   * "Default location for new attachments".
   */
  folders?: AttachmentFolders;
  /**
   * Pages run across, one per screen, instead of down (the notebook's
   * "Scroll direction" setting). Only ever stored as `"horizontal"`.
   */
  scroll?: "horizontal";
}

/** Which way a notebook's pages run: a column (the default) or a row. */
export type ScrollDirection = "vertical" | "horizontal";

/** The kinds of file a note saves beside itself. */
export type AttachmentKind = "images" | "audio" | "exports";

/**
 * Vault folder paths (`""` never stored). Absent: Obsidian's default for
 * pictures and recordings; next to the note for PDF exports.
 */
export type AttachmentFolders = Partial<Record<AttachmentKind, string>>;

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** How many numbers make one point in `Stroke.pts`: x, y and pressure. */
export const POINT_STRIDE = 3;

export const DEFAULT_PAGE_GEOMETRY: PageGeometry = {
  width: DEFAULT_PAPER_WIDTH,
  height: DEFAULT_PAGE_HEIGHT,
};

/** A fresh blank page with the default geometry. */
export function blankPage(id = "p1", geometry: PageGeometry = DEFAULT_PAGE_GEOMETRY): Page {
  return {
    id,
    kind: "ink",
    geometry: { ...geometry },
    backdrop: { kind: "blank" },
    strokes: [],
    images: [],
    textBoxes: [],
  };
}

/**
 * A new note: one blank page `width` wide, scrolled to the top at 100 %.
 * The view's keys stay in this order: the encoder writes the view as it is.
 */
export function emptyDocument(width: number = DEFAULT_PAPER_WIDTH): InkDocument {
  const page = blankPage("p1", { width, height: DEFAULT_PAGE_HEIGHT });
  const view: ViewState = { scrollY: 0, width, scale: 1 };
  return { version: SCHEMA_VERSION, view, pages: [page] };
}

/** The first page, creating one if the document somehow has none. */
export function firstPage(doc: InkDocument): Page {
  let page = doc.pages[0];
  if (!page) {
    page = blankPage("p1");
    doc.pages.push(page);
  }
  return page;
}

/** Find a page by id, or `null`. */
export function pageById(doc: InkDocument, id: string): Page | null {
  return doc.pages.find((p) => p.id === id) ?? null;
}

/** Index of a page by id, or `-1`. */
export function pageIndexById(doc: InkDocument, id: string): number {
  return doc.pages.findIndex((p) => p.id === id);
}

/**
 * Insert a page, clamping `index` into `0..pages.length`. Returns the index it
 * actually landed at, which is what an inverse needs in order to undo exactly.
 */
export function insertPage(doc: InkDocument, index: number, page: Page): number {
  const at = Math.max(0, Math.min(doc.pages.length, Math.trunc(index)));
  doc.pages.splice(at, 0, page);
  return at;
}

/**
 * Remove the page at `index` and return it, or `null` if the index is out of
 * range **or it is the last remaining page** — a document always has at least
 * one page (contracts/api.md §3).
 */
export function removePageAt(doc: InkDocument, index: number): Page | null {
  if (doc.pages.length <= 1) return null;
  if (!Number.isInteger(index) || index < 0 || index >= doc.pages.length) return null;
  return doc.pages.splice(index, 1)[0] ?? null;
}

/** Find a stroke on a given page, or `null` if either id is unknown. */
export function strokeById(doc: InkDocument, pageId: string, strokeId: string): Stroke | null {
  const page = pageById(doc, pageId);
  if (!page) return null;
  return page.strokes.find((s) => s.id === strokeId) ?? null;
}

/** Find a placed image on a given page, or `null` if either id is unknown. */
export function imageById(doc: InkDocument, pageId: string, imageId: string): ImageElement | null {
  const page = pageById(doc, pageId);
  if (!page) return null;
  return page.images.find((img) => img.id === imageId) ?? null;
}

/** How many strokes the whole notebook holds. */
export function strokeCount(doc: InkDocument): number {
  return doc.pages.reduce((sum, page) => sum + page.strokes.length, 0);
}

/**
 * The smallest axis-aligned box around a stroke's points, pressure aside, or
 * `null` when it has no whole point. A NaN never widens the box (it compares
 * false), and a trailing partial point still counts with the x it has.
 */
export function strokeBounds(stroke: Stroke): Bounds | null {
  const points = stroke.pts;
  if (points.length < POINT_STRIDE) return null;
  const box: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (let at = 0; at < points.length; at += POINT_STRIDE) {
    widen(box, "minX", "maxX", points[at]);
    widen(box, "minY", "maxY", points[at + 1]);
  }
  return box;
}

function widen(box: Bounds, low: "minX" | "minY", high: "maxX" | "maxY", value: number): void {
  if (value < box[low]) box[low] = value;
  if (value > box[high]) box[high] = value;
}
