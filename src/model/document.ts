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
  | "star"
  | "cloud";

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
  "cloud",
];

/** How a shape's outline is drawn when it is not solid. */
export type ShapeDash = "dash" | "dot";

export const SHAPE_DASHES: readonly ShapeDash[] = ["dash", "dot"];

/** An arrowhead: an open V, or a filled triangle. */
export type ArrowHead = "open" | "filled";

export const ARROW_HEADS: readonly ArrowHead[] = ["open", "filled"];

/** The heads on a line's two ends; an end left out has none. */
export interface ArrowHeads {
  start?: ArrowHead;
  end?: ArrowHead;
}

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
  /**
   * A shape's inside colour, `#rrggbb` or `#rrggbbaa` (a soft tint keeps its
   * alpha). Painted under the outline, and only while the outline is closed:
   * a piece the eraser cut from a filled shape is not filled.
   */
  fill?: string;
  /** A shape's outline drawn dashed or dotted; absent is solid. */
  dash?: ShapeDash;
  /**
   * Corner radius, page px, for a shape with straight edges (rect, triangle,
   * diamond, polygon, star, line): each corner is rounded, never by more than
   * its edges allow. Scales with the shape.
   */
  radius?: number;
  /** Arrowheads drawn on a `line`'s ends. A stored `arrow` keeps its head in its points. */
  heads?: ArrowHeads;
  /**
   * Written with a flat calligraphy nib at this angle, degrees from the x
   * axis: the line's width follows the direction it was drawn in
   * (`ink/freehand` nibFactor). Absent: a round nib.
   */
  nib?: number;
  /**
   * The pen's samples as it reported them, before any smoothing or filling
   * in: x, y, pressure (0 when the device gave no reading), milliseconds
   * since the stroke's first sample, and so on. Kept only in practice files,
   * where the ink is training data for the handwriting reader.
   */
  samples?: number[];
  /**
   * The id of the sticky note (an {@link ImageElement} with `sticky`) this
   * ink was written on: it is drawn on the note, clipped to it, and moves,
   * turns, mirrors and copies with it (`model/sticky-notes.ts`). In memory
   * only: on disk such a stroke is kept inside its note, in the note's own
   * space (contracts/api.md, "Sticky notes"). A stroke whose note is gone is
   * plain page ink.
   */
  onSticky?: string;
}

/** Values per entry of {@link Stroke.samples}: x, y, pressure, time. */
export const SAMPLE_STRIDE = 4;

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
  | "two-column"
  | "margin-left"
  | "margin-right"
  | "handwriting"
  | "storyboard"
  | "meeting-notes"
  | "graph"
  | "isometric"
  | "isometric-dots"
  | "hexagon"
  | "daily-planner"
  | "habit-tracker"
  | "weekly-grid"
  | "music-tab"
  | CoverRuling
  | "lined"
  | "grid";

/**
 * A notebook cover is a page like any other (GoodNotes does the same), drawn
 * procedurally. Its colour is the backdrop's `paperColor`.
 */
export type CoverRuling =
  // Classic designs: no longer offered, still drawn so older notebooks open as they were.
  | "cover-plain"
  | "cover-label"
  | "cover-band"
  | "cover-linen"
  // The designs the picker offers since 2026-10-07.
  | "cover-gradient"
  | "cover-orb"
  | "cover-split"
  | "cover-contour"
  | "cover-glass"
  | "cover-monogram"
  | "cover-accent";

export const COVER_RULINGS: readonly CoverRuling[] = [
  "cover-plain",
  "cover-label",
  "cover-band",
  "cover-linen",
  "cover-gradient",
  "cover-orb",
  "cover-split",
  "cover-contour",
  "cover-glass",
  "cover-monogram",
  "cover-accent",
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
  "two-column",
  "margin-left",
  "margin-right",
  "handwriting",
  "storyboard",
  "meeting-notes",
  "graph",
  "isometric",
  "isometric-dots",
  "hexagon",
  "daily-planner",
  "habit-tracker",
  "weekly-grid",
  "music-tab",
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
  /**
   * Text printed on the paper: the practice file's cover and its prompts.
   * Part of the template, drawn with it, so it can be neither edited, moved
   * nor erased, and it is never read as a link.
   */
  printed?: PrintedText[];
  /**
   * A paper made in the paper designer (`model/paper-design.ts`) can carry
   * these four; contracts/api.md §1 "Designed paper". All page px, all
   * optional. An older FineNotes ignores them and draws the ruling across
   * the whole plain page.
   */
  /** Grain on the paper, drawn from a fixed seed. Absent: smooth. */
  texture?: PaperTexture;
  /** Bands along the edges where the ruling stops. A side left out is 0. */
  margins?: PaperMargins;
  /** One band, from one edge inwards, where the ruling stops too. */
  blankZone?: BlankZone;
  /** Vertical lines this far in from the left and/or right edge. */
  marginLines?: MarginLines;
}

export type PaperTexture = "fine" | "heavy";
export type PaperSide = "top" | "right" | "bottom" | "left";
export type PaperMargins = Partial<Record<PaperSide, number>>;
export interface BlankZone {
  side: PaperSide;
  size: number;
}
export interface MarginLines {
  left?: number;
  right?: number;
  /** Hex; default a soft red. */
  color?: string;
}

/** One line of text printed on the paper. */
export interface PrintedText {
  /** Where the line's text starts, and its baseline, page px. */
  x: number;
  y: number;
  text: string;
  /** Font size, page px. */
  size: number;
  bold?: boolean;
  /** Hex; default a muted grey. */
  color?: string;
  /**
   * Set on a practice prompt: its id. The writing line below it holds the
   * user's copy of `text`, which is that line's label for training.
   */
  prompt?: string;
}

/** A page of a PDF in the vault. The source file is never modified. */
export interface PdfBackdrop {
  kind: "pdf";
  /** Vault-relative path to the source PDF. */
  path: string;
  /** 0-based page index within that PDF. */
  page: number;
  /**
   * `false`: the PDF's own annotations are not drawn. A PDF imported from
   * another app has its ink annotations brought over as strokes, which would
   * otherwise show twice. Stored only as `false`; absent means drawn.
   */
  annotations?: false;
  /**
   * `true`: the PDF is a notebook's copy of a template from My templates, so
   * a page added after this one repeats it. Stored only as `true`.
   */
  template?: true;
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
  /**
   * Mirrored left to right (`flipX`) or top to bottom (`flipY`) in the
   * picture's own frame: the crop is taken from the source first, then
   * mirrored, then turned by `rotation`. Stored only as `true`.
   */
  flipX?: true;
  flipY?: true;
  /** A locked image cannot be selected, moved or erased until unlocked. Stored only as `true`. */
  locked?: boolean;
  /**
   * Drawn in front of the ink rather than under it: a sticker on
   * handwriting. Stored only as `true`. Text boxes stay above everything.
   */
  front?: true;
  /**
   * How see-through the picture is drawn, from {@link MIN_IMAGE_OPACITY} up
   * to but not including 1. Absent is fully opaque.
   */
  opacity?: number;
  /**
   * Set on a sticky note: paper painted in this colour rather than a picture
   * from the vault, so `path` is empty and `crop` unused. Ink written on it
   * is the strokes whose `onSticky` names this element.
   */
  sticky?: StickyPaper;
}

/** A sticky note's paper. Replaced as a whole, never edited in place. */
export interface StickyPaper {
  /** `#rrggbb`. */
  color: string;
}

/** The faintest a picture may be drawn: fainter would be a picture nobody can find. */
export const MIN_IMAGE_OPACITY = 0.1;

/** A stored opacity as the model keeps it: absent when it is not a real one below 1. */
export function readImageOpacity(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < MIN_IMAGE_OPACITY || value >= 1) return undefined;
  return value;
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
  /**
   * A line around the box, drawn inside its edge; the text keeps clear of it.
   * Absent means none. Replaced as a whole, never edited in place, so an undo
   * snapshot of the old object stays true.
   */
  border?: TextBorder;
  /** Corner radius of the fill and border, page px; absent means square corners. */
  radius?: number;
  /** Extra room between the text and the box's edge, page px; absent is none. */
  padding?: number;
  /** Shown in capitals (a label, a kicker); the typed text keeps its case. */
  caps?: true;
}

/** A text box's border: its width in page px and its colour (hex, as `fill`). */
export interface TextBorder {
  width: number;
  color: string;
}

/**
 * A table on a page (`model/table`): one object with rows, columns and typed
 * cells, drawn under the ink so a cell can be written in by hand — that ink
 * stays ordinary strokes, never part of the table. Cell text wraps as a text
 * box's does (`canvas/table-layout`).
 */
export interface TableElement {
  /** `g<N>`, unique on the page. */
  id: string;
  /** Top-left, page px. */
  x: number;
  y: number;
  /** Each column's width, page px, left to right. */
  cols: number[];
  /** Each row's least height, page px, top to bottom: a row grows with its text. */
  rows: number[];
  /** Typed text, `cells[row][col]`, every row as long as `cols`. */
  cells: string[][];
  /** The grid's line colour, hex, as a shape's ink. */
  color: string;
  /** The grid's line width, page px. */
  size: number;
  /** The cells' text colour, hex. */
  textColor: string;
  /** The cells' font size, page px at a 1:1 scale. */
  fontSize: number;
  /** Typeface; absent means `"sans"`. */
  font?: TextFont;
  /** The first row is a header: its text bold, its cells filled. Only stored as `true`. */
  header?: true;
  /** The header row's fill, `#rrggbb` or `#rrggbbaa`; absent: a soft tint of `color`. */
  headerFill?: string;
  /** Every other cell's fill; absent means none. */
  fill?: string;
  /** The grid drawn dashed or dotted; absent is solid. */
  dash?: ShapeDash;
  /**
   * Each cell's own look over the table's, `cellStyles[row][col]`, shaped
   * as `cells`; `null` where a cell has none. Absent when no cell has one,
   * so a table nobody styled is stored as it always was.
   */
  cellStyles?: Array<Array<TableCellStyle | null>>;
}

/** A table cell's own look: bold, and a text colour over the table's `textColor`. */
export interface TableCellStyle {
  /** Only stored as `true`. */
  bold?: true;
  /** `#rrggbb`. */
  color?: string;
}

/**
 * The calculator's graph (`model/graph`'s `GraphSpec`) as a page keeps it:
 * kept whole, every field it has, so whatever the calculator's graphs learn
 * later is saved, copied and undone without this file knowing. Only what the
 * page itself relies on is checked when a note is read: the expressions are
 * a list, and the view (`xMin < xMax`, `yMin < yMax`) is finite.
 */
export interface GraphSpecData {
  expressions: string[];
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  /** Trig in degrees or radians; absent means radians. */
  angle?: "deg" | "rad";
  /** Points pinned on function lines (by line id), kept with their labels. */
  pins?: Array<{ line: string; x: number; name?: string }>;
  [field: string]: unknown;
}

/**
 * A graph on a page (`model/graph-element`), from the calculator: only what
 * it shows is stored, never sampled points, so the curve is drawn again at
 * whatever resolution it is shown or printed at, by the calculator's own
 * sampler and painter. Drawn under the ink, like a table, and kept upright.
 */
export interface GraphElement {
  /** `f<N>`, unique on the page. */
  id: string;
  /** The frame's top-left and size, page px. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** What is plotted and the view, as the calculator gave it. */
  spec: GraphSpecData;
  /** Each expression's curve colour, hex, by position; a missing one takes the palette's. */
  colors: string[];
  /** Grid lines off. Only stored as `false`; absent means on. */
  grid?: false;
  /** Axis numbers off. Only stored as `false`; absent means on. */
  labels?: false;
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
  /** Tables, bottom to top. Absent when the page has none. */
  tables?: TableElement[];
  /** Graphs, bottom to top, drawn over the tables. Absent when the page has none. */
  graphs?: GraphElement[];
  /** Comments pinned to the page (`model/comments`). Absent when it has none. */
  comments?: PageComment[];
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
  /** A coloured tab the notebook can be opened at (`model/page-tabs`), `#rrggbb`. */
  tab?: string;
  /**
   * The page's line in the notebook's contents (the sidebar's Contents tab),
   * which starts a section there. Trimmed, one line, at most
   * `MAX_PAGE_TITLE_LENGTH`; absent means the page is not listed.
   */
  title?: string;
  /**
   * Headings inside the page that are listed in the contents under it, top
   * to bottom (FineNotes#20). Absent when there are none.
   */
  sections?: PageSection[];
  /** Ink on this page that links somewhere (FineNotes#20). Absent when there is none. */
  links?: InkLink[];
  /** Handwritten lines made checklist items (2.5). Absent when there are none. */
  tasks?: InkTask[];
}

/**
 * A handwritten line made a checklist item with the lasso (2.5): the ink, by
 * stroke id, what it says (read on the device, then confirmed), and whether
 * it is ticked. A box is drawn left of the ink; the item is also written into
 * the note as a `- [ ]` task, so Obsidian's Tasks plugin finds it
 * (`recognition/task-index.ts`).
 */
export interface InkTask {
  /** `ck<N>`, unique in the notebook. */
  id: string;
  strokes: string[];
  /** One line of text, trimmed. */
  text: string;
  done?: true;
}

/**
 * Ink that links to a note, a heading, a notebook page or a web address:
 * a set of strokes on the page, by id, and where they lead. `target` is
 * Obsidian link text (`Signals#FIR filters`, `Physics.notebook#page=3`) or
 * an address with a scheme (`https://…`). See `model/links.ts`.
 */
export interface InkLink {
  /** `l<N>`, unique in the notebook. */
  id: string;
  /** The linked strokes' ids; each stroke is in one link at most. */
  strokes: string[];
  target: string;
}

/**
 * A heading inside a page, listed in the notebook's contents: a title at a
 * point in page px, where the heading's ink was when it was added. The
 * contents goes to that point, and a ribbon marks it in the margin. Insert
 * space moves it with its line.
 */
/**
 * A comment pinned to a point on a page, by the user or by the AI (Ask's
 * `add_comment` tool): a short note about what is written there, shown as
 * a marker on the page that opens to its text. It is not ink: it is never
 * drawn into the page, its thumbnails or its exports.
 */
export interface PageComment {
  /** `cm<N>`, unique in the notebook. */
  id: string;
  /** Where it points, page px. */
  x: number;
  y: number;
  text: string;
  /** Who wrote it. */
  author: "you" | "ai";
  /** When, ms since the Unix epoch. */
  created: number;
  /** Dealt with: shown faded. Stored only as `true`. */
  resolved?: true;
}

export interface PageSection {
  /** `c<N>`, unique in the notebook. */
  id: string;
  /** The left of the heading. */
  x: number;
  /** The middle of the heading, top to bottom: the line it is on. */
  y: number;
  /** As a page title is: one line, trimmed, at most `MAX_PAGE_TITLE_LENGTH`. */
  title: string;
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

/**
 * A handwriting practice file: what it is, so the view can keep it to
 * writing, and so the file alone says how to read it as training data.
 */
export interface PracticeInfo {
  /** The layout's version, for whoever reads the file as training data. */
  format: number;
  /** Which set of lines it has (1-based). */
  set: number;
  /** What it was written on, filled in at the first stroke: "ipad", "android", "desktop"… */
  device?: string;
  /** How: "pen", "mouse" or "touch", from the last stroke written. */
  input?: string;
}

export interface InkDocument {
  version: number;
  view: ViewState;
  /** Set on a handwriting practice file. */
  practice?: PracticeInfo;
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
  /**
   * An endless board (FineNotes#46, `model/board.ts`): its one page grows as
   * it is written on, and the view scrolls freely across it. A board is
   * written with `single` too, so a build that knows no boards opens it as a
   * single page. Only ever stored as `true`, and only on a one-page document.
   */
  endless?: true;
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
  /**
   * The pen and every other edit leave the notebook alone (its "Read-only"
   * setting, `model/read-only.ts`). Only ever stored as `true`.
   */
  readOnly?: true;
  /**
   * The notebook's colours (`model/palette`): offered first in every colour
   * picker; choosing another recolours the notebook. Absent: the classic pen
   * colours.
   */
  palette?: { id: string; name: string; colors: string[] };
  /** A header and page numbers on every page (`model/furniture`). */
  furniture?: { header?: string; numbers?: "center" | "right" };
}

/** Which way a notebook's pages run: a column (the default) or a row. */
export type ScrollDirection = "vertical" | "horizontal";

/** The kinds of file a note saves beside itself. */
export type AttachmentKind = "images" | "audio" | "transcripts" | "chats" | "exports";

/**
 * Vault folder paths (`""` never stored). Absent: Obsidian's default for
 * pictures and recordings; beside the recording for its transcript; an
 * "AI chats" folder next to the note for saved Ask AI chats; next to the note
 * for PDF exports.
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
