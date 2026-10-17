/**
 * The welcome notebook a new user is offered the first time FineNotes runs
 * in a vault: a tour of FineNotes made of FineNotes itself. Every page is
 * built from what a user can make with the tools (text boxes with links,
 * snapped shapes with fills, dashes and round corners, tables, highlighter
 * and pen strokes),
 * so each example can be selected, moved, recoloured or erased, and the
 * notebook teaches by being handled.
 *
 * - A contents page whose entries are links: a tap jumps to that page, and
 *   every page ends with links back to it and on to the next one.
 * - The essentials first (writing, the toolbar, pens, pages), then a page
 *   per feature with examples, then a page left free.
 * - Cards are rounded rectangles with a soft fill and a text box on them,
 *   as the Shape tool makes them: the shape is the card, the text stays
 *   plain text.
 * - "Try it" cards mark a space to practise in (a dashed, softly filled
 *   frame), with something to act on where the feature needs one (loops to
 *   erase, a house to lasso).
 * - Pictures drawn with the Shape tool's shapes (a toolbar, page
 *   thumbnails, devices, keys) and notes in pen, as a person would annotate
 *   a page, so it reads as a notebook rather than a manual.
 * - Every page has a title, so the sidebar's Contents tab lists the tour;
 *   the contents page is bookmarked and the links page has a heading in the
 *   contents, so both features show themselves.
 *
 * Every claim is in the README's How to use or the CHANGELOG.
 *
 * PURE: no DOM, no Obsidian.
 */

import { arrowPoints, cloudPoints, ellipsePoints, presetGeometry } from "../ink/shape-geometry";
import type { BoxPreset, Pt } from "../ink/shape-geometry";
import { tableHeaderRow, tableStrokes } from "../ink/table-geometry";
import type {
  ArrowHeads,
  AttachmentFolders,
  ImageElement,
  InkDocument,
  Page,
  PageGeometry,
  Ruling,
  ShapeKind,
  Stroke,
  TextBoxElement,
  TextFont,
} from "./document";
import { buildNewDocument, DEFAULT_NOTEBOOK_CHOICES, type NotebookChoices } from "./new-notebook";
import { DEFAULT_PALETTE } from "./palette";
import { fillOf, withAlpha } from "./shape-style";
import { stickerById, stickerFileName, stickerSvg } from "./stickers";
import { templateBackdrop } from "./templates";

/** The welcome notebook's name, and the title on its cover. */
export const WELCOME_TITLE = "Welcome to FineNotes";

/**
 * Whether to greet the user: only on a vault that had no FineNotes settings
 * yet and holds no notebook. A second device of a synced vault has both, so
 * it is not greeted again.
 */
export function shouldShowWelcome(firstInstall: boolean, hasNotebooks: boolean): boolean {
  return firstInstall && !hasNotebooks;
}

/** The cover: a design and colour the New notebook dialog offers. */
export const WELCOME_COVER: Pick<NotebookChoices, "cover" | "coverColor"> = {
  cover: "cover-orb",
  coverColor: "teal",
};

// --- Look ------------------------------------------------------------------------

/**
 * A section's colours: its accent, a pale tint, and the swash under a title.
 * A card is drawn in the swash: its outline, and the same as a soft fill.
 */
interface Tone {
  accent: string;
  tint: string;
  swash: string;
}

const INK = "#212529";
const BODY = "#343a40";
const MUTED = "#868e96";
/** Practice areas and quiet lines: a warm grey that sits on the ivory paper. */
const ZONE = "#d6cbb8";
/** Drawings of the app itself: the toolbar, devices, keys. */
const SKETCH = "#495057";

const TONES = {
  start: { accent: "#3b5bdb", tint: "#edf2ff", swash: "#bac8ff" },
  write: { accent: "#0c8599", tint: "#e3fafc", swash: "#99e9f2" },
  shape: { accent: "#7048e8", tint: "#f3f0ff", swash: "#d0bfff" },
  text: { accent: "#e8590c", tint: "#fff4e6", swash: "#ffc078" },
  find: { accent: "#2f9e44", tint: "#ebfbee", swash: "#b2f2bb" },
  more: { accent: "#c2255c", tint: "#fff0f6", swash: "#fcc2d7" },
} satisfies Record<string, Tone>;

/** "Try it" cards look the same in every section. */
const TRY: Tone = { accent: "#e67700", tint: "#fff9db", swash: "#ffe066" };

/**
 * Pen colours the examples write in: the notebook palette's own, so picking
 * other colours in the notebook's settings recolours the whole tour.
 */
const [PEN_BLACK, PEN_RED, PEN_BLUE, PEN_GREEN, PEN_ORANGE, PEN_PURPLE] = DEFAULT_PALETTE.colors;
const PEN = {
  black: PEN_BLACK,
  blue: PEN_BLUE,
  red: PEN_RED,
  green: PEN_GREEN,
  purple: PEN_PURPLE,
  orange: PEN_ORANGE,
};
const HIGHLIGHT = "#ffd43b";

/** The tour's paper: a warm ivory, one of the paper colours the template picker offers. */
const PAPER = "#fbf8ed";
/** Rules and dots on that paper: sepia, to go with it. */
const RULE = "#d9c7a8";
/** A calligraphy pen's nib angle, degrees, as the pen type holds it. */
const NIB = 40;

/** Layout, page px. Text starts below where the tool pill floats at fit zoom. */
const MARGIN = 72;
const TOP = 170;
/** Where the links at the foot of a page sit, from the bottom. */
const FOOT = 90;
const BODY_SIZE = 23;
const CARD_SIZE = 21;
const LINE_HEIGHT = 1.4;
/** Room between a card's edge and its text box. */
const CARD_PAD = 16;
/** A card's corners, and a practice area's. */
const CARD_RADIUS = 20;
const TITLE_SIZE = 52;

// --- Measuring ------------------------------------------------------------------

/**
 * Arial's advance widths, thousandths of an em, for the printable ASCII
 * characters from the space on (regular, then bold). The text boxes' sans
 * typeface is Arial first, on the iPad as on a computer.
 */
const ARIAL = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const ARIAL_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667,
  611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556,
  278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];
/** The rest the tour uses (others count as a lower-case letter); ⋯ and ● come from a fallback font. */
const ARIAL_OTHER: Record<string, number> = {
  "•": 350,
  "·": 278,
  "‹": 333,
  "›": 333,
  "×": 584,
  "⋯": 1000,
  "●": 800,
  "—": 1000,
};
/**
 * Lines wrap this much early, so a measure a little short of the browser's
 * still never counts fewer lines than it shows.
 */
const WRAP_MARGIN = 1.025;

/** `text`'s width in ems, by {@link ARIAL}'s advance widths. */
function emWidth(text: string, bold: boolean): number {
  const table = bold ? ARIAL_BOLD : ARIAL;
  let width = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    width += table[code - 32] ?? ARIAL_OTHER[ch] ?? table[97 - 32];
  }
  return width / 1000;
}

/** A text's shown words: links count as their text. */
function shownText(text: string): string {
  return text.replace(/\[\[[^|\]]*\|([^\]]*)\]\]/g, "$1").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
}

/**
 * Lines `text` wraps to in `width` at `size`, word by word as a text box
 * wraps, measured in Arial's own widths and wrapped a little early (see
 * {@link WRAP_MARGIN}): a box laid out too tall leaves a gap, one too short
 * overlaps what follows. Links count as their shown text.
 */
export function estimateLines(text: string, width: number, size: number, bold = false): number {
  const room = width / (size * WRAP_MARGIN);
  const space = emWidth(" ", bold);
  let lines = 0;
  for (const paragraph of shownText(text).split("\n")) {
    let line = -1;
    lines++;
    for (const word of paragraph.split(" ")) {
      const w = emWidth(word, bold);
      const next = line < 0 ? w : line + space + w;
      if (next > room && line >= 0) {
        lines++;
        line = w;
      } else line = next;
    }
  }
  return lines;
}

/** A one-line text's width at `size`, by the same measure as {@link estimateLines}. */
function estimateWidth(text: string, size: number, bold = false): number {
  return emWidth(shownText(text), bold) * size * WRAP_MARGIN;
}

/** Text box style beyond the defaults. */
interface BoxStyle {
  size?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  font?: TextFont;
  align?: "left" | "center" | "right";
  lineHeight?: number;
  fill?: string;
  border?: { width: number; color: string };
  radius?: number;
  /** Room between the text and the box's edge (or border), page px. */
  padding?: number;
  /** Shown in capitals, whatever case it is typed in. */
  caps?: boolean;
  /** As wide as its text instead of `w`. */
  fit?: boolean;
}

/** A box's height as laid out, estimated (see {@link estimateLines}). */
function boxHeight(text: string, w: number, style: BoxStyle): number {
  const size = style.size ?? BODY_SIZE;
  const inset = (style.border?.width ?? 0) + (style.padding ?? 0);
  const shown = style.caps ? text.toUpperCase() : text;
  const lines = estimateLines(shown, w - 2 * (4 + inset), size, style.bold);
  return lines * size * (style.lineHeight ?? LINE_HEIGHT) + 2 * (2 + inset);
}

/** A shape's style beyond its colour and width, as the Shape tool sets it. */
type Decor = Pick<Stroke, "fill" | "dash" | "radius" | "heads" | "nib">;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The pressure every example is drawn at: a middle reading, already in the
 * file's 255ths, so the notebook reads back exactly as it was built.
 */
const PRESSURE = 128 / 255;

function flat(points: readonly Pt[], pressure = PRESSURE): number[] {
  const out: number[] = [];
  for (const p of points) out.push(round2(p.x), round2(p.y), pressure);
  return out;
}

/** Points along a quadratic curve from `a` through the pull of `c` to `b`. */
function curve(a: Pt, c: Pt, b: Pt, steps = 24): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push({
      x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
      y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
    });
  }
  return out;
}

// --- Building a page --------------------------------------------------------------

/** Ids for the whole notebook, as the surface hands them out: `s<n>`, `t<n>`, `i<n>`. */
class Ids {
  private strokes = 0;
  private boxes = 0;
  private images = 0;
  stroke(): string {
    return `s${++this.strokes}`;
  }
  box(): string {
    return `t${++this.boxes}`;
  }
  image(): string {
    return `i${++this.images}`;
  }
}

// --- Stickers ---------------------------------------------------------------------

/** A sticker the tour places: which one, and in what colour. */
export interface WelcomeSticker {
  key: string;
  sticker: string;
  color: string;
}

/**
 * The stickers on the tour's pages. They are pictures, saved beside the
 * notebook as every sticker is ({@link welcomeStickerFiles}); a page leaves
 * out any whose file could not be saved.
 */
export const WELCOME_STICKERS: readonly WelcomeSticker[] = [
  { key: "tape", sticker: "tape-stripes", color: TONES.text.accent },
  { key: "pin", sticker: "icon-pin", color: PEN.red },
  { key: "sparkles", sticker: "doodle-sparkles", color: PEN.orange },
  { key: "banner", sticker: "label-banner", color: TONES.start.accent },
];

/** The files the tour's stickers are saved as: a name to save each under, and its SVG. */
export function welcomeStickerFiles(): Array<{ key: string; name: string; svg: string }> {
  const out: Array<{ key: string; name: string; svg: string }> = [];
  for (const { key, sticker, color } of WELCOME_STICKERS) {
    const found = stickerById(sticker);
    if (found)
      out.push({ key, name: stickerFileName(found, color), svg: stickerSvg(found, color) });
  }
  return out;
}

/** Where each sticker's file was saved, by its key. */
export type StickerPaths = Readonly<Record<string, string>>;

/** One page under construction, with a cursor that runs down it. */
class Sheet {
  y = TOP;
  readonly page: Page;

  constructor(
    private readonly ids: Ids,
    private readonly stickers: StickerPaths,
    index: number,
    geometry: PageGeometry,
    ruling: Ruling,
    readonly tone: Tone,
  ) {
    const backdrop = templateBackdrop(ruling, "white");
    backdrop.paperColor = PAPER;
    if (ruling !== "blank") backdrop.color = RULE;
    this.page = {
      id: `p${index}`,
      kind: "ink",
      geometry: { ...geometry },
      backdrop,
      strokes: [],
      images: [],
      textBoxes: [],
    };
  }

  get width(): number {
    return this.page.geometry.width - 2 * MARGIN;
  }

  get right(): number {
    return this.page.geometry.width - MARGIN;
  }

  /** The lowest the flow should reach: above the links at the foot. */
  get floor(): number {
    return this.page.geometry.height - FOOT - 40;
  }

  // --- Text ---

  /** A text box at (`x`, `y`), `w` wide; returns its estimated height. */
  box(x: number, y: number, w: number, text: string, style: BoxStyle = {}): number {
    const box: TextBoxElement = {
      id: this.ids.box(),
      x: round2(x),
      y: round2(y),
      w: round2(w),
      text,
      color: style.color ?? BODY,
      fontSize: style.size ?? BODY_SIZE,
      lineHeight: style.lineHeight ?? LINE_HEIGHT,
    };
    if (style.fit) box.fit = true;
    if (style.bold) box.bold = true;
    if (style.italic) box.italic = true;
    if (style.font && style.font !== "sans") box.font = style.font;
    if (style.align && style.align !== "left") box.align = style.align;
    if (style.fill) box.fill = style.fill;
    if (style.border) box.border = { ...style.border };
    if (style.radius) box.radius = style.radius;
    if (style.padding) box.padding = style.padding;
    if (style.caps) box.caps = true;
    this.page.textBoxes.push(box);
    return boxHeight(text, w, style);
  }

  /** A box in the flow, full width unless `w` is given, and the cursor moved past it. */
  flow(text: string, style: BoxStyle = {}, gap = 14, x = MARGIN, w = this.width): void {
    this.y += this.box(x, this.y, w, text, style) + gap;
  }

  /** A short label, as wide as its words. */
  label(x: number, y: number, text: string, style: BoxStyle = {}): void {
    const size = style.size ?? 16;
    const shown = style.caps ? text.toUpperCase() : text;
    this.box(x, y, estimateWidth(shown, size, style.bold) + 12, text, {
      size,
      color: MUTED,
      fit: true,
      ...style,
    });
  }

  /** The small coloured line over a title: the section. */
  kicker(text: string): void {
    const style = { size: 16, bold: true, caps: true, color: this.tone.accent };
    this.flow(
      text,
      { ...style, fit: true },
      2,
      MARGIN,
      estimateWidth(text.toUpperCase(), 16, true) + 12,
    );
  }

  /** The page's title, with a highlighter swash under its words. */
  title(text: string): void {
    this.page.title = text;
    // Bold Arial runs about 0.53 em a glyph; the swash spans the words.
    const words = text.length * TITLE_SIZE * 0.53;
    if (text && words <= this.width) {
      this.highlight(
        MARGIN - 4,
        MARGIN + words + 8,
        this.y + TITLE_SIZE * 0.95,
        this.tone.swash,
        22,
      );
    }
    const style = { size: TITLE_SIZE, bold: true, color: INK, lineHeight: 1.12 };
    // One line when it fits by that measure: the generous wrap estimate would add a gap.
    const h = words <= this.width ? TITLE_SIZE * 1.12 + 4 : boxHeight(text, this.width, style);
    this.box(MARGIN, this.y, this.width, text, style);
    this.y += h + 22;
  }

  para(text: string, w = this.width): void {
    this.flow(text, {}, 18, MARGIN, w);
  }

  /** A card: the text on a rounded, softly filled rectangle, under an optional label. */
  card(text: string, label?: string, tone: Tone = this.tone, x = MARGIN, w = this.width): number {
    const start = this.y;
    if (label) {
      const style = { size: 15, bold: true, caps: true, color: tone.accent, fit: true };
      this.flow(
        label,
        style,
        4,
        x + 4,
        Math.min(w - 4, estimateWidth(label.toUpperCase(), 15, true) + 12),
      );
    }
    this.y += this.onCard(x, this.y, w, text, { size: CARD_SIZE }, tone) + 24;
    return this.y - start;
  }

  /**
   * A text box on a card at (`x`, `y`), `w` wide: a rectangle in the tone's
   * swash with round corners and the same colour as a soft fill, as the Shape
   * tool draws one, and the text {@link CARD_PAD} inside it. Returns the card's height.
   */
  onCard(x: number, y: number, w: number, text: string, style: BoxStyle, tone: Tone): number {
    const inner = w - 2 * CARD_PAD;
    const h = boxHeight(text, inner, style) + 2 * CARD_PAD;
    // The tint as a solid fill: a see-through one turns muddy on the ivory paper.
    this.shape("rect", x, y, x + w, y + h, tone.swash, 2, {
      fill: fillOf(tone.tint, "solid"),
      radius: CARD_RADIUS,
    });
    this.box(x + CARD_PAD, y + CARD_PAD, inner, text, { color: BODY, ...style });
    return h;
  }

  /** A space to practise in: a dashed, rounded frame with a faint grey fill. */
  zone(x: number, y: number, w: number, h: number): void {
    this.shape("rect", x, y, x + w, y + h, ZONE, 2, {
      fill: fillOf(ZONE, "soft"),
      dash: "dash",
      radius: CARD_RADIUS,
    });
  }

  /**
   * "Try it": a yellow card, then a {@link zone} to practise in, down to the
   * page's floor, or `height` tall.
   */
  tryIt(text: string, height?: number): { x: number; y: number; w: number; h: number } {
    this.card(text, "Try it", TRY);
    const top = this.y - 8;
    const h = height ?? this.floor - top;
    const area = { x: MARGIN, y: top, w: this.width, h };
    if (h > 40) {
      this.zone(area.x, area.y, area.w, area.h);
      this.y = top + h + 22;
    }
    return area;
  }

  gap(px: number): void {
    this.y += px;
  }

  /** A coloured tab on the page's edge, labelled with its title: a binder's divider. */
  tab(color: string): void {
    this.page.tab = color;
  }

  /**
   * Sticker `key` (see {@link WELCOME_STICKERS}) at (x, y), `scale` times its
   * own size; nothing when its file was not saved.
   */
  sticker(
    key: string,
    x: number,
    y: number,
    options: { scale?: number; rotation?: number; front?: boolean; opacity?: number } = {},
  ): void {
    const path = this.stickers[key];
    const which = WELCOME_STICKERS.find((s) => s.key === key);
    const sticker = which && stickerById(which.sticker);
    if (!path || !sticker) return;
    const scale = options.scale ?? 1;
    const image: ImageElement = {
      id: this.ids.image(),
      path,
      x: round2(x),
      y: round2(y),
      w: round2(sticker.w * scale),
      h: round2(sticker.h * scale),
    };
    if (options.rotation) image.rotation = options.rotation;
    if (options.front) image.front = true;
    if (options.opacity !== undefined && options.opacity < 1) image.opacity = options.opacity;
    this.page.images.push(image);
  }

  // --- Ink ---

  stroke(
    pts: number[],
    color: string,
    size: number,
    shape?: ShapeKind,
    tool: "pen" | "highlighter" = "pen",
    decor: Decor = {},
  ): void {
    if (pts.length === 0) return;
    const stroke: Stroke = { id: this.ids.stroke(), color, size, tool, pts };
    if (shape) stroke.shape = shape;
    if (decor.fill) stroke.fill = decor.fill;
    if (decor.dash) stroke.dash = decor.dash;
    if (decor.radius) stroke.radius = decor.radius;
    if (decor.heads) stroke.heads = { ...decor.heads };
    if (decor.nib !== undefined) stroke.nib = decor.nib;
    this.page.strokes.push(stroke);
  }

  /** One of the Shape tool's presets, filling the box from (x0, y0) to (x1, y1). */
  shape(
    kind: BoxPreset,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    color: string,
    size = 3,
    decor: Decor = {},
  ): void {
    this.stroke(
      presetGeometry(kind, { x: x0, y: y0 }, { x: x1, y: y1 }, PRESSURE),
      color,
      size,
      kind,
      "pen",
      decor,
    );
  }

  /** A straight line; with `heads`, an arrow with a head at either end or both. */
  line(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    color: string,
    size = 3,
    heads?: ArrowHeads,
  ): void {
    this.stroke(
      flat([
        { x: x0, y: y0 },
        { x: x1, y: y1 },
      ]),
      color,
      size,
      "line",
      "pen",
      heads ? { heads } : {},
    );
  }

  arrow(x0: number, y0: number, x1: number, y1: number, color: string, size = 3): void {
    this.stroke(flat(arrowPoints({ x: x0, y: y0 }, { x: x1, y: y1 })), color, size, "arrow");
  }

  circle(cx: number, cy: number, r: number, color: string, size = 3): void {
    this.stroke(flat(ellipsePoints(cx, cy, r, r, 0, -Math.PI / 2, 1)), color, size, "circle");
  }

  cloud(x0: number, y0: number, w: number, h: number, color: string, size = 3): void {
    this.stroke(flat(cloudPoints(x0, y0, w, h, 9)), color, size, "cloud");
  }

  table(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    rows: number,
    cols: number,
    color: string,
    size = 2.5,
    header = false,
  ): void {
    const parts = tableStrokes({ x: x0, y: y0 }, { x: x1, y: y1 }, { rows, cols }, PRESSURE);
    // A header row, as the Shapes tool's switch makes one: a soft fill under the first row.
    const row = header ? tableHeaderRow(parts) : null;
    if (row) this.stroke(row, color, size, "rect", "pen", { fill: withAlpha(color, 0.16) });
    for (const t of parts) this.stroke(t.pts, color, size, t.shape);
  }

  /** A band of highlighter along y from x0 to x1, as a highlight drawn along a line. */
  highlight(x0: number, x1: number, y: number, color = HIGHLIGHT, size = 24): void {
    this.stroke(
      flat([
        { x: x0, y },
        { x: x1, y },
      ]),
      color,
      size,
      undefined,
      "highlighter",
    );
  }

  /** A curved arrow drawn by hand, from `a` to `b`, bowed by `bend` (page px, + to the left). */
  inkArrow(a: Pt, b: Pt, bend: number, color: string, size = 3): void {
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const c = { x: mx + (-(b.y - a.y) / len) * bend, y: my + ((b.x - a.x) / len) * bend };
    const path = curve(a, c, b);
    this.stroke(flat(path), color, size);
    // The head, along the curve's last stretch.
    const from = path[path.length - 4];
    const head = arrowPoints(from, b).slice(2);
    this.stroke(flat(head), color, size);
  }

  /** Handwriting-like loops, `count` of them from (x, y): something to erase or select. */
  loops(
    x: number,
    y: number,
    count: number,
    color: string,
    size = 2.5,
    height = 13,
    decor: Decor = {},
  ): void {
    const a = height * 0.46;
    const points: Pt[] = [];
    const end = count * 2 * Math.PI;
    for (let t = 0; t <= end + 1e-9; t += 0.18) {
      points.push({ x: x + a * t - height * Math.sin(t), y: y - height * Math.cos(t) });
    }
    this.stroke(flat(points), color, size, undefined, "pen", decor);
  }

  /** A wavy line from x0 to x1. */
  wave(
    x0: number,
    x1: number,
    y: number,
    color: string,
    size = 2.5,
    amplitude = 4,
    decor: Decor = {},
  ): void {
    const points: Pt[] = [];
    for (let x = x0; x <= x1 + 1e-9; x += 4)
      points.push({ x, y: y + amplitude * Math.sin((x - x0) / 9) });
    this.stroke(flat(points), color, size, undefined, "pen", decor);
  }

  /** A tick, as drawn by hand. */
  tick(x: number, y: number, color: string, size = 3.5): void {
    this.stroke(
      flat([
        { x, y },
        { x: x + 9, y: y + 10 },
        { x: x + 26, y: y - 14 },
      ]),
      color,
      size,
    );
  }

  /** A four-pointed sparkle: four curves bowed in towards its middle, in one stroke. */
  sparkle(cx: number, cy: number, r: number, color: string, size = 2.5): void {
    const c = { x: cx, y: cy };
    const tips = [
      { x: cx, y: cy - r },
      { x: cx + r * 0.75, y: cy },
      { x: cx, y: cy + r },
      { x: cx - r * 0.75, y: cy },
    ];
    const points: Pt[] = [];
    tips.forEach((tip, i) => {
      const next = tips[(i + 1) % tips.length];
      points.push(...curve(tip, c, next, 8).slice(i === 0 ? 0 : 1));
    });
    this.stroke(flat(points), color, size);
  }

  /** A page in miniature: a frame with a few lines of "writing", and a bookmark ribbon. */
  miniPage(x: number, y: number, w: number, h: number, color: string, ribbon = false): void {
    this.shape("rect", x, y, x + w, y + h, SKETCH, 2);
    for (let i = 0; i < 4; i++) {
      const ly = y + 22 + i * 16;
      if (ly > y + h - 14) break;
      this.wave(x + 10, x + w - 14 - (i % 2) * 18, ly, color, 1.5, 2);
    }
    if (ribbon) {
      const rx = x + w - 22;
      this.stroke(
        flat([
          { x: rx, y },
          { x: rx, y: y + 26 },
          { x: rx + 6, y: y + 20 },
          { x: rx + 12, y: y + 26 },
          { x: rx + 12, y },
        ]),
        PEN.red,
        2.5,
      );
    }
  }

  /** The links at the foot of the page: back to the contents, and on to `next`. */
  foot(next?: { page: number; title: string }): void {
    const y = this.page.geometry.height - FOOT;
    this.line(MARGIN, y - 16, this.right, y - 16, "#e9ecef", 2);
    this.box(MARGIN, y, 300, "[[#page=2|‹ Contents]]", { size: 18, fit: true, color: MUTED });
    if (next) {
      const text = `[[#page=${next.page}|Next: ${next.title} ›]]`;
      const w = Math.min(560, estimateWidth(`Next: ${next.title} ›`, 18) + 12);
      this.box(this.right - w, y, w, text, { size: 18, align: "right", color: MUTED });
    }
  }
}

// --- Drawings of the app ------------------------------------------------------------

/**
 * The toolbar, drawn: a bar with its three groups, an icon sketch for each
 * button. Returns the middle of each group, for arrows to point from.
 */
function drawToolbar(s: Sheet, y: number): number[] {
  const x0 = MARGIN;
  const x1 = s.right;
  const h = 64;
  s.shape("roundrect", x0, y, x1, y + h, SKETCH, 2.5);
  const slots = 17;
  const step = (x1 - x0) / slots;
  const cy = y + h / 2;
  const at = (i: number): number => x0 + step * (i + 0.5);
  const icon = 13;
  const c = SKETCH;
  // Left: sidebar, search, AI, undo, redo.
  s.shape("rect", at(0) - icon, cy - icon, at(0) + icon, cy + icon, c, 2);
  s.line(at(0) - 4, cy - icon, at(0) - 4, cy + icon, c, 2);
  s.circle(at(1) - 3, cy - 3, 9, c, 2);
  s.line(at(1) + 4, cy + 4, at(1) + 12, cy + 12, c, 2);
  s.sparkle(at(2), cy, 12, c, 2);
  s.arrow(at(3) + 10, cy, at(3) - 12, cy, c, 2);
  s.arrow(at(4) - 10, cy, at(4) + 12, cy, c, 2);
  s.line(at(5) - step / 2, y + 12, at(5) - step / 2, y + h - 12, ZONE, 2);
  // Middle: lasso, pen, eraser, text, shapes, picture, PDF, microphone.
  s.shape("ellipse", at(5) - icon, cy - 9, at(5) + icon, cy + 9, c, 2);
  s.line(at(6) - 10, cy + 12, at(6) + 10, cy - 12, TONES.shape.accent, 4);
  s.shape("roundrect", at(7) - 12, cy - 7, at(7) + 12, cy + 7, c, 2);
  s.line(at(8) - 9, cy - 11, at(8) + 9, cy - 11, c, 2.5);
  s.line(at(8), cy - 11, at(8), cy + 12, c, 2.5);
  s.shape("triangle", at(9) - 12, cy - 12, at(9) + 2, cy + 2, c, 2);
  s.circle(at(9) + 5, cy + 5, 7, c, 2);
  s.shape("rect", at(10) - icon, cy - 11, at(10) + icon, cy + 11, c, 2);
  s.shape("triangle", at(10) - 9, cy - 2, at(10) + 5, cy + 9, c, 1.5);
  s.shape("rect", at(11) - 10, cy - icon, at(11) + 10, cy + icon, c, 2);
  s.line(at(11) - 5, cy - 3, at(11) + 5, cy - 3, c, 1.5);
  s.line(at(11) - 5, cy + 4, at(11) + 5, cy + 4, c, 1.5);
  s.shape("roundrect", at(12) - 6, cy - 13, at(12) + 6, cy + 5, c, 2);
  s.line(at(12), cy + 8, at(12), cy + 14, c, 2);
  s.line(at(13) - step / 2, y + 12, at(13) - step / 2, y + h - 12, ZONE, 2);
  // Right: add page, share, more, settings.
  s.line(at(13) - 11, cy, at(13) + 11, cy, c, 2.5);
  s.line(at(13), cy - 11, at(13), cy + 11, c, 2.5);
  s.arrow(at(14), cy + 12, at(14), cy - 13, c, 2);
  for (const dx of [-9, 0, 9]) s.circle(at(15) + dx, cy, 2, c, 2.5);
  s.circle(at(16), cy, 11, c, 2);
  s.circle(at(16), cy, 4, c, 2);
  return [(at(0) + at(4)) / 2, (at(5) + at(12)) / 2, (at(13) + at(16)) / 2];
}

/** A tablet, a laptop and a phone with the same page on each, and sync between them. */
function drawDevices(s: Sheet, y: number): void {
  const page = (x: number, top: number, w: number, h: number): void => {
    s.shape("rect", x, top, x + w, top + h, ZONE, 1.5);
    s.wave(x + 8, x + w - 16, top + 18, PEN.blue, 1.5, 2);
    s.wave(x + 8, x + w - 30, top + 32, PEN.blue, 1.5, 2);
    s.circle(x + w - 22, top + h - 22, 9, PEN.red, 1.5);
  };
  const cx = MARGIN + s.width / 2;
  // Tablet, left.
  const tx = MARGIN + 20;
  s.shape("roundrect", tx, y, tx + 170, y + 220, SKETCH, 3);
  page(tx + 25, y + 30, 120, 160);
  // Laptop, middle.
  const lx = cx - 150;
  s.shape("roundrect", lx, y + 20, lx + 300, y + 200, SKETCH, 3);
  s.line(lx - 30, y + 215, lx + 330, y + 215, SKETCH, 4);
  page(cx - 60, y + 40, 120, 145);
  // Phone, right.
  const px = s.right - 120;
  s.shape("roundrect", px, y + 40, px + 95, y + 220, SKETCH, 3);
  page(px + 15, y + 65, 65, 120);
  // Sync between them, both ways: arrows with a head at each end.
  const both: ArrowHeads = { start: "filled", end: "filled" };
  // One length for both, so their heads (which grow with the arrow) match.
  const sync = (left: number, right: number, at: number): void => {
    const mid = (left + right) / 2;
    s.line(mid - 32, at, mid + 32, at, TONES.find.accent, 3, both);
    s.label(mid - 27, at - 34, "sync", {
      color: TONES.find.accent,
      size: 18,
      italic: true,
      bold: true,
    });
  };
  sync(tx + 170, lx, y + 110);
  sync(lx + 300, px, y + 130);
}

/** A key, drawn: a rounded square with its letter in the middle, and what it does under it. */
function drawKey(s: Sheet, x: number, y: number, key: string, what: string): void {
  s.shape("roundrect", x, y, x + 60, y + 60, SKETCH, 2.5);
  // 80 wide, centred on the key: the loader widens an unfitted box under 80 px.
  s.box(x - 10, y + 14, 80, key, { size: 24, bold: true, color: INK, align: "center" });
  s.box(x - 20, y + 70, 100, what, { size: 15, color: MUTED, align: "center" });
}

// --- The tour ---------------------------------------------------------------------

/** One page of the tour after the cover: its title, section and how it is drawn. */
interface TourPage {
  title: string;
  /** The contents page lists these under the section's heading. */
  section: "start" | "more" | "end";
  tone: Tone;
  ruling?: Ruling;
  draw: (sheet: Sheet) => void;
}

/** The pages after the cover and the contents page, in order. */
const TOUR: readonly TourPage[] = [
  {
    title: "Write, scroll and zoom",
    section: "start",
    tone: TONES.start,
    draw: (s) => {
      s.kicker("The essentials · 1");
      s.title("Write, scroll and zoom");
      s.para(
        "Write with your Apple Pencil or stylus. Your fingers move the page: one finger " +
          "scrolls, two fingers pinch to zoom.",
      );
      s.card(
        "• Double-tap with two fingers to undo, with three to redo.\n" +
          "• There is no save button: everything is saved as you write.\n" +
          "• Pull past the last page to add a new one.",
        "Good to know",
      );
      const area = s.tryIt(
        "Write your name in the space below. Then undo it with a two-finger double-tap.",
      );
      s.line(
        area.x + 40,
        area.y + area.h - 90,
        area.x + area.w - 40,
        area.y + area.h - 90,
        ZONE,
        2,
      );
      s.label(area.x + 40, area.y + area.h - 80, "your name", { italic: true });
      s.inkArrow(
        { x: area.x + area.w - 160, y: area.y + 58 },
        { x: area.x + area.w - 240, y: area.y + 200 },
        -40,
        PEN.orange,
      );
      s.label(area.x + area.w - 230, area.y + 26, "write here", {
        color: PEN.orange,
        italic: true,
        size: 18,
      });
      s.foot({ page: 4, title: "The toolbar" });
    },
  },
  {
    title: "The toolbar",
    section: "start",
    tone: TONES.start,
    draw: (s) => {
      s.kicker("The essentials · 2");
      s.title("The toolbar");
      s.para("The bar at the top of a notebook has three groups.");
      const bar = s.y + 4;
      const groups = drawToolbar(s, bar);
      s.y = bar + 64 + 70;
      const gap = 18;
      const w = (s.width - 2 * gap) / 3;
      const top = s.y;
      const cards = [
        ["Left", "Page thumbnails, search, AI, undo and redo."],
        [
          "Middle",
          "The tools: lasso, pen, eraser, text, shapes, pictures, PDFs and the microphone.",
        ],
        ["Right", "Add a page, share as PDF, More (⋯) and this notebook's settings."],
      ];
      let tallest = 0;
      cards.forEach(([label, text], i) => {
        s.y = top;
        const x = MARGIN + i * (w + gap);
        tallest = Math.max(tallest, s.card(text, label, TONES.start, x, w));
        s.inkArrow(
          { x: groups[i], y: bar + 72 },
          { x: x + w / 2, y: top - 4 },
          i === 1 ? 0 : 18,
          PEN.orange,
          2.5,
        );
      });
      s.y = top + tallest + 6;
      s.para(
        "Tap a tool to pick it, and tap it again to hide or show its options, such as the " +
          "pen's colours and widths.",
      );
      s.card(
        "Hold a finger on the page for Paste, Text box and Select all, whatever tool is in " +
          "hand. More (⋯) has the page's own actions: bookmark, copy a link, duplicate, change " +
          "the template, go to a page, and dark pages for writing at night.",
        "Also",
      );
      s.tryIt(
        "Tap the eraser, then the pen. Tap the pen once more to tuck its options away, and " +
          "again to bring them back.",
        0,
      );
      s.foot({ page: 5, title: "Pens and eraser" });
    },
  },
  {
    title: "Pens, highlighter and eraser",
    section: "start",
    tone: TONES.write,
    draw: (s) => {
      s.kicker("The essentials · 3");
      s.title("Pens, highlighter and eraser");
      s.para(
        "Tap the nib at the start of the pen's options for the fountain pen, ballpoint, brush, " +
          "calligraphy pen or highlighter. Widths are in millimetres, and any colour can be mixed.",
      );
      // The calligraphy pen: a flat nib, thick going down and thin going across.
      s.wave(MARGIN + 10, MARGIN + 250, s.y + 30, PEN.black, 7, 13, { nib: NIB });
      s.label(MARGIN + 280, s.y + 18, "calligraphy pen: thick one way, thin the other", {
        italic: true,
        size: 17,
      });
      s.y += 70;
      // A row of strokes in the pens' colours and widths, each labelled.
      const row = s.y + 28;
      const colors = [PEN.black, PEN.blue, PEN.red, PEN.green, PEN.purple, PEN.orange];
      const widths = [1.5, 2.5, 3.5, 4.5, 6, 8];
      const mm = ["0.3 mm", "0.5 mm", "0.7 mm", "0.9 mm", "1.2 mm", "1.6 mm"];
      const step = s.width / colors.length;
      colors.forEach((color, i) => {
        const x = MARGIN + i * step + 10;
        s.wave(x, x + step - 40, row, color, widths[i]);
        s.label(x + 10, row + 22, mm[i], { size: 15 });
      });
      s.y = row + 64;
      s.card(
        "Keep up to eight pens with their own type, colour and width, behind the star in the " +
          "pen's options, or press 1 to 8 on a keyboard. The eyedropper in each colour picker " +
          "takes a colour straight from the page.",
        "Saved pens",
      );
      s.highlight(MARGIN, MARGIN + 600, s.y + 16);
      s.flow("The highlighter goes under the ink, never over it.", { size: 23, color: INK }, 24);
      s.card(
        "• Standard rubs out only what it passes over.\n" +
          "• Whole stroke removes every stroke it touches.\n" +
          "• Erase by line takes whole words on lined paper.\n" +
          "It can also take only the highlighter, or only the pen.",
        "The eraser",
      );
      const area = s.tryIt("Rub out some of these loops with the eraser. Undo brings them back.");
      s.loops(area.x + 50, area.y + area.h / 2 - 20, 16, PEN.blue, 2.5, 16);
      s.loops(area.x + 50, area.y + area.h / 2 + 40, 12, PEN.red, 2.5, 16);
      s.foot({ page: 6, title: "Pages and notebooks" });
    },
  },
  {
    title: "Pages and notebooks",
    section: "start",
    tone: TONES.start,
    draw: (s) => {
      s.kicker("The essentials · 4");
      s.title("Pages and notebooks");
      // The page sidebar, drawn: four thumbnails, one bookmarked, and one dragged.
      const top = s.y + 6;
      const w = 110;
      const h = 150;
      for (let i = 0; i < 5; i++) {
        const x = MARGIN + 20 + i * (w + 50);
        s.miniPage(x, top, w, h, i === 0 ? TONES.start.accent : PEN.black, i === 1);
        s.label(x + w / 2 - 10, top + h + 8, String(i + 1), { size: 16 });
      }
      s.inkArrow(
        { x: MARGIN + 20 + 3 * (w + 50) + w / 2, y: top + h + 40 },
        { x: MARGIN + 20 + w + 25, y: top + h + 40 },
        -40,
        PEN.orange,
      );
      s.label(MARGIN + 20 + 2 * (w + 50) - 10, top + h + 84, "drag to reorder", {
        color: PEN.orange,
        italic: true,
        size: 18,
      });
      s.y = top + h + 130;
      s.card(
        "• + adds a page before or after this one, or at the end, on any paper.\n" +
          "• The page sidebar (top left) shows every page; drag them to reorder.\n" +
          "• Its grid button shows all pages at once, to move, export or delete several.\n" +
          "• Tap a page's ribbon to bookmark it, as this notebook's contents page is.\n" +
          "• A thumbnail's ⋯ gives its page a coloured tab, like the ones on this notebook's edge.",
        "Pages",
      );
      s.card(
        "Each notebook is a file in this vault, the folder Obsidian keeps your notes in. Its " +
          "notebook button makes a new one with a cover, a paper and a size of your choice; or " +
          "press and hold a folder and choose New notebook. Any paper can be any colour, with " +
          "its lines in their own colour, closer together or further apart.",
        "Notebooks",
      );
      s.card(
        "This notebook's settings (the gear) put page numbers on every page, as here, or a " +
          "header; and set its colours: choose Ocean or Berry, and the pen drawings in this " +
          "tour change colour with it.",
        "Make it yours",
      );
      s.tryIt(
        "Open the page sidebar and bookmark this page. Then find its title in the Contents tab.",
        0,
      );
      s.foot({ page: 7, title: "Shapes" });
    },
  },
  {
    title: "Shapes",
    section: "more",
    tone: TONES.shape,
    draw: (s) => {
      s.kicker("More · Shapes");
      s.title("Shapes");
      s.para(
        "Draw a shape in one stroke and keep the pen still. It snaps to a clean shape; keep " +
          "holding and move the pen to resize and turn it.",
      );
      const kinds: Array<[string, (x: number, y: number, w: number, h: number) => void]> = [
        ["Line", (x, y, w, h) => s.line(x, y + h, x + w, y, PEN.purple)],
        ["Arrow", (x, y, w, h) => s.arrow(x, y + h, x + w, y, PEN.purple)],
        [
          "Rectangle",
          (x, y, w, h) =>
            s.shape("rect", x, y, x + w, y + h, PEN.purple, 3, {
              fill: fillOf(PEN.purple, "soft"),
            }),
        ],
        ["Circle", (x, y, w, h) => s.circle(x + w / 2, y + h / 2, h / 2, PEN.purple)],
        [
          "Ellipse",
          (x, y, w, h) => s.shape("ellipse", x, y, x + w, y + h, PEN.purple, 3, { dash: "dot" }),
        ],
        [
          "Triangle",
          (x, y, w, h) =>
            s.shape("triangle", x, y, x + w, y + h, PEN.purple, 3, {
              radius: 10,
              fill: fillOf(PEN.purple, "soft"),
            }),
        ],
        [
          "Diamond",
          (x, y, w, h) => s.shape("diamond", x, y, x + w, y + h, PEN.purple, 3, { dash: "dash" }),
        ],
        [
          "Star",
          (x, y, w, h) =>
            s.shape("star", x + 8, y, x + w - 8, y + h, PEN.purple, 3, {
              fill: fillOf(PEN.purple, "solid"),
            }),
        ],
        ["Cloud", (x, y, w, h) => s.cloud(x, y, w, h, PEN.purple)],
        [
          "Rounded",
          (x, y, w, h) =>
            s.shape("rect", x, y, x + w, y + h, PEN.purple, 3, {
              radius: 18,
              fill: fillOf(PEN.purple, "soft"),
              dash: "dash",
            }),
        ],
      ];
      const cols = 5;
      const cell = s.width / cols;
      const shapeW = 120;
      const shapeH = 86;
      kinds.forEach(([label, draw], i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = MARGIN + col * cell + (cell - shapeW) / 2;
        const y = s.y + row * 160 + 10;
        draw(x, y, shapeW, shapeH);
        s.box(MARGIN + col * cell, y + shapeH + 12, cell, label, {
          size: 17,
          align: "center",
          color: MUTED,
        });
      });
      s.y += 2 * 160 + 16;
      s.card(
        "Auto shape, the last button in the pen's options, snaps a plain shape as you lift. " +
          "The Shapes tool places a shape, a line, an arrow or a table up to 8 × 8 with a drag, " +
          "and its style button fills, dashes and rounds them and puts heads on lines.",
        "Also",
      );
      // A small table, as the Shapes tool places one with Header row on, its headings typed in.
      const tx = MARGIN;
      const ty = s.y;
      s.table(tx, ty, tx + 420, ty + 150, 3, 3, PEN.purple, 2.5, true);
      ["Day", "Topic", "Done"].forEach((head, i) => {
        s.box(tx + 10 + i * 140, ty + 12, 120, head, { size: 18, bold: true, color: PEN.purple });
      });
      s.box(tx + 10, ty + 62, 120, "Mon", { size: 18 });
      s.box(tx + 150, ty + 62, 120, "Cells", { size: 18 });
      s.tick(tx + 300, ty + 80, PEN.green);
      const zone = { x: tx + 460, y: ty, w: s.width - 460, h: s.floor - ty };
      s.zone(zone.x, zone.y, zone.w, zone.h);
      s.label(zone.x + 18, zone.y + 14, "Try it", {
        size: 15,
        bold: true,
        caps: true,
        color: TRY.accent,
      });
      s.box(zone.x + 18, zone.y + 40, zone.w - 36, "Draw a circle here and hold the pen still.", {
        size: 19,
        color: BODY,
      });
      s.foot({ page: 8, title: "Pen gestures" });
    },
  },
  {
    title: "Pen gestures",
    section: "more",
    tone: TONES.shape,
    draw: (s) => {
      s.kicker("More · Pen gestures");
      s.title("Pen gestures");
      s.para("Two gestures save a trip to the toolbar. Both are on at first, in the pen's menu.");
      s.card(
        "Scribble back and forth over writing to rub it out. A scribble on empty paper stays " +
          "as ink.",
        "Scribble to erase",
      );
      let area = s.tryIt("Scribble over these loops.", 170);
      s.loops(area.x + 60, area.y + 70, 12, PEN.red, 2.5, 16);
      s.loops(area.x + 60, area.y + 125, 9, PEN.blue, 2.5, 16);
      s.card(
        "Draw a loop round something and lift, then press and hold the pen on the loop. What " +
          "it enclosed is selected, ready to drag.",
        "Circle to select",
      );
      area = s.tryIt("Circle the star, hold on your loop, then drag the star somewhere else.");
      const cx = area.x + area.w / 2;
      const cy = area.y + area.h / 2;
      s.shape("star", cx - 70, cy - 66, cx + 70, cy + 66, PEN.orange, 3.5);
      s.foot({ page: 9, title: "Select and change" });
    },
  },
  {
    title: "Select, move and change",
    section: "more",
    tone: TONES.shape,
    draw: (s) => {
      s.kicker("More · The lasso");
      s.title("Select, move and change");
      s.para(
        "With the lasso, draw round what you want, or tap one thing. Tap the lasso again for a " +
          "rectangle instead, or to pick only handwriting, pictures, shapes, arrows or text.",
      );
      s.card(
        "• Drag inside the frame to move it.\n" +
          "• Drag a corner to resize it, or the knob below to turn it.\n" +
          "• Its bar cuts, duplicates and deletes; ⋯ copies, pastes, flips and recolours.\n" +
          "• Copy and paste work between pages and between notebooks.",
        "A selection",
      );
      const area = s.tryIt(
        "Lasso the sun and move it. Then select the whole house, turn it and make it bigger.",
      );
      // A house, a sun and a cloud, all snapped shapes, on a line of grass.
      const ground = area.y + area.h - 70;
      const hx = area.x + 130;
      const hy = ground - 150;
      s.wave(area.x + 30, area.x + area.w - 30, ground + 4, PEN.green, 3, 3);
      s.shape("triangle", hx - 30, hy - 120, hx + 260, hy, PEN.red, 3.5);
      s.shape("rect", hx, hy, hx + 230, hy + 150, PEN.black, 3.5);
      s.shape("rect", hx + 95, hy + 65, hx + 145, hy + 150, PEN.blue);
      s.table(hx + 22, hy + 28, hx + 74, hy + 80, 2, 2, PEN.blue);
      s.table(hx + 160, hy + 28, hx + 212, hy + 80, 2, 2, PEN.blue);
      const sx = area.x + area.w - 140;
      const sy = area.y + 110;
      s.circle(sx, sy, 44, PEN.orange, 3.5);
      for (let i = 0; i < 8; i++) {
        const t = (i * Math.PI) / 4;
        s.line(
          sx + Math.cos(t) * 56,
          sy + Math.sin(t) * 56,
          sx + Math.cos(t) * 76,
          sy + Math.sin(t) * 76,
          PEN.orange,
          3,
        );
      }
      s.cloud(area.x + area.w - 420, area.y + 50, 170, 80, PEN.blue);
      s.foot({ page: 10, title: "Text boxes" });
    },
  },
  {
    title: "Text boxes",
    section: "more",
    tone: TONES.text,
    draw: (s) => {
      s.kicker("More · Typing");
      s.title("Text boxes");
      s.para(
        "With the Text tool, tap the page and type. The box grows as you type; drag its " +
          "handles to move or size it. Tap a box with the lasso to restyle it without the keyboard.",
      );
      const gap = 24;
      const w = (s.width - gap) / 2;
      const top = s.y + 6;
      let left = top;
      let right = top;
      const put = (column: 0 | 1, text: string, style: BoxStyle): void => {
        const x = MARGIN + column * (w + gap);
        const y = column === 0 ? left : right;
        const h = s.box(x, y, w, text, style);
        if (column === 0) left = y + h + 22;
        else right = y + h + 22;
      };
      put(0, "A bold heading", { size: 34, bold: true, color: INK });
      put(0, "Italic, in a serif typeface.", { italic: true, font: "serif", size: 24 });
      put(0, "Typewriter text, for code.", { font: "mono", size: 21 });
      put(0, "Any colour, any size.", { color: TONES.text.accent, size: 27, bold: true });
      put(0, "Capitals for labels", { caps: true, bold: true, size: 16, color: MUTED });
      put(1, "• Bullet points\n• that carry on\n• as you press Return", { size: 21 });
      put(1, "1. Numbered lists\n2. count for you", { size: 21 });
      put(1, "A fill, a border, padding and round corners make a card like this one.", {
        size: 20,
        fill: TONES.text.tint,
        border: { width: 2, color: TONES.text.accent },
        radius: 14,
        padding: 10,
      });
      put(1, "Centred, too.", { align: "center", size: 22, italic: true });
      s.y = Math.max(left, right) + 4;
      s.card(
        "The Style menu in the text options sets a whole look at once: Title, Heading, " +
          "Subheading, Body, Caption or Label. AA, beside bold and italic, shows a box in capitals.",
        "Styles",
      );
      s.card(
        "Type a link as Obsidian does, a note's name in double square brackets, or a web " +
          "address, and it opens on a tap. The links at the foot of each page are text boxes " +
          "like that.",
        "Links",
      );
      s.tryIt("Pick the Text tool, tap in the space below and type something.");
      s.foot({ page: 11, title: "Pictures and PDFs" });
    },
  },
  {
    title: "Pictures, scans and PDFs",
    section: "more",
    tone: TONES.text,
    draw: (s) => {
      s.kicker("More · Pictures and PDFs");
      s.title("Pictures, scans and PDFs");
      // A picture, drawn as one: a frame, two mountains and a sun.
      const fx = s.right - 240;
      const fy = s.y - 6;
      s.shape("rect", fx, fy, fx + 240, fy + 170, SKETCH, 3);
      s.shape("triangle", fx + 18, fy + 55, fx + 150, fy + 160, PEN.green);
      s.shape("triangle", fx + 100, fy + 85, fx + 222, fy + 160, PEN.green);
      s.circle(fx + 190, fy + 45, 20, PEN.orange);
      // Taped down, as in a scrapbook: stickers in front of the ink, the tape see-through.
      s.sticker("tape", fx - 40, fy + 14, {
        scale: 0.6,
        rotation: -0.55,
        front: true,
        opacity: 0.85,
      });
      s.sticker("pin", fx + 200, fy - 22, { scale: 0.7, front: true });
      s.para(
        "Insert image adds a photo, takes one with the camera, picks a picture from the " +
          "vault, or scans a sheet of paper straight onto a page.",
        s.width - 270,
      );
      s.para(
        "A picture can be moved, resized, turned, cropped, flipped and locked, so you can " +
          "write on a worksheet without moving it.",
        s.width - 270,
      );
      s.y = Math.max(s.y, fy + 200);
      s.card(
        "Insert PDF, next to Insert image, brings in lecture slides or a worksheet: every PDF " +
          "page becomes a page to write on. The PDF itself is never changed. The highlighter " +
          "snaps to a PDF's words, and Copy then gives you their text.",
        "PDFs",
      );
      s.card(
        "Stickers, in Insert image, add arrows, labels, tape and doodles in any colour, like " +
          "the tape and pin up there. Lasso a picture to make it see-through or put it in " +
          "front of the ink; lasso anything and choose Save as sticker to keep it.",
        "Stickers",
      );
      s.card(
        "A PDF in the vault has New notebook from PDF in its menu. On a computer, drop a " +
          "picture or a PDF onto the page.",
        "Also",
      );
      s.tryIt("Tap Insert image and add a photo, then lasso it and turn it a little.");
      s.foot({ page: 12, title: "Lined paper tools" });
    },
  },
  {
    title: "Lined paper tools",
    section: "more",
    tone: TONES.write,
    ruling: "ruled-wide",
    draw: (s) => {
      s.kicker("More · Lined paper");
      s.title("Lined paper tools");
      s.card(
        "This page is ruled, so three tools work here as they do in Stylus Labs Write:\n" +
          "• Erase by line, an eraser mode, takes whole words along a line.\n" +
          "• Select by line, a lasso type, selects from word to word, as you select text.\n" +
          "• Insert space: with Select by line, drag a line's margin arrow down to push " +
          "everything under it down, or up to close empty lines.",
        "Write on the lines",
      );
      s.card("Any page can be lined: + or More (⋯) › Change template.", undefined, TONES.write);
      s.card(
        "Write three lines below, then push the second one down with Insert space.",
        "Try it",
        TRY,
      );
      // Writing to try the tools on: three "lines" of loops sitting on the rules.
      const pitch = 40;
      const first = Math.ceil((s.y + 60) / pitch) * pitch;
      s.loops(MARGIN + 10, first - 14, 18, PEN.black, 2.5, 12);
      s.loops(MARGIN + 10, first + pitch - 14, 12, PEN.blue, 2.5, 12);
      s.loops(MARGIN + 10, first + 2 * pitch - 14, 15, PEN.black, 2.5, 12);
      s.foot({ page: 13, title: "Links and search" });
    },
  },
  {
    title: "Links, contents and search",
    section: "more",
    tone: TONES.find,
    draw: (s) => {
      s.kicker("More · Finding things");
      s.title("Links, contents and search");
      s.card(
        "Lasso some ink and choose Link to… in its ⋯ menu: a note, a heading, a page or a web " +
          "address. The ink gets an underline; tap it with a finger to follow it. A note's " +
          "name written by hand in double square brackets gets a dashed underline: tap it to " +
          "make it a link.",
        "Handwritten links",
      );
      const heading = s.y;
      s.card(
        "Give a page a title with Add to contents in More (⋯), or lasso a heading you wrote " +
          "and choose Add to contents. The sidebar's Contents tab lists them; tap one to go " +
          "there. This card's heading is in the contents too: see the ribbon in the margin.",
        "The contents",
      );
      s.page.sections = [{ id: "c1", x: MARGIN, y: round2(heading + 12), title: "The contents" }];
      s.card(
        "Search (the magnifier) finds typed text and your handwriting, which Grape reads on " +
          "this device a few seconds after you stop writing. Obsidian's own search finds it too. " +
          "AI › Teach it your handwriting makes Grape read yours much better.",
        "Search your handwriting",
      );
      s.card(
        "Copy link to page, in More (⋯), gives a link that opens this exact page. Paste it " +
          "into any note with an ! in front, and the note shows the page itself.",
        "Links to pages",
      );
      s.flow(
        "Try one: [[#page=7|go to Shapes]]   ·   [FineNotes on GitHub](https://github.com/Joost-8/FineNotes)",
        { size: 21, color: BODY },
        16,
      );
      s.foot({ page: 14, title: "Recordings" });
    },
  },
  {
    title: "Recordings",
    section: "more",
    tone: TONES.more,
    draw: (s) => {
      s.kicker("More · Audio");
      s.title("Recordings");
      s.para(
        "Tap the microphone to record a lecture or a meeting while you write. A red pill shows " +
          "the time; tap Stop to end.",
      );
      // A pill like the recording one, a sound wave, and the writing it lines up with.
      const top = s.y + 4;
      s.shape("rect", MARGIN, top, MARGIN + 230, top + 51, PEN.red, 2, {
        fill: fillOf(PEN.red, "solid"),
        radius: 26,
      });
      s.box(MARGIN + 10, top + 10, 210, "●  Recording  12:48", {
        size: 19,
        bold: true,
        color: "#ffffff",
      });
      const heights = [
        8, 18, 30, 14, 40, 26, 12, 34, 22, 44, 16, 28, 10, 36, 20, 30, 12, 24, 38, 14, 26, 8,
      ];
      heights.forEach((h, i) => {
        const x = MARGIN + 270 + i * 22;
        s.line(x, top + 26 - h / 2, x, top + 26 + h / 2, PEN.red, 4);
      });
      s.y = top + 90;
      s.loops(MARGIN + 10, s.y, 7, PEN.black, 2.5, 13);
      s.loops(MARGIN + 330, s.y, 5, PEN.black, 2.5, 13);
      s.inkArrow(
        { x: MARGIN + 560, y: s.y + 52 },
        { x: MARGIN + 430, y: s.y + 18 },
        -30,
        PEN.orange,
      );
      s.label(MARGIN + 575, s.y + 36, "tap your writing to hear that moment", {
        color: PEN.orange,
        italic: true,
        size: 18,
      });
      s.y += 100;
      s.card(
        "Open the recording from the page sidebar's Files tab and tap anything you wrote: it plays " +
          "from five seconds before you wrote it.",
        "Hear what was said",
      );
      s.card(
        "Keep the screen on while you record: recording stops if the iPad locks or you leave " +
          "Obsidian. A recording can also be transcribed, with your own AI key.",
        "Good to know",
      );
      s.tryIt(
        "Record a few seconds while you write a word here. Stop, open the recording, and tap the word.",
      );
      s.foot({ page: 15, title: "Export, sync and import" });
    },
  },
  {
    title: "Export, sync and import",
    section: "more",
    tone: TONES.find,
    draw: (s) => {
      s.kicker("More · Your files");
      s.title("Export, sync and import");
      s.y += 40;
      drawDevices(s, s.y);
      s.y += 250;
      s.card(
        "A notebook is a Markdown file in your vault, with its pictures and recordings beside " +
          "it. Sync the vault with Obsidian Sync, iCloud or any app that syncs a folder: every " +
          "device shows the same pages, with the ink exactly where you wrote it.",
        "Sync",
      );
      s.card(
        "Share (the arrow) exports the notebook, this page or the pages you choose as a PDF, " +
          "then opens or shares it.",
        "Export",
      );
      s.card(
        "• Goodnotes: in the library tap Select, pick notebooks or folders, tap Export and " +
          "choose the Goodnotes format. Several at once come as one .zip.\n" +
          "• Notability: share or export a note in the Note format.\n" +
          "• Noteful, Xournal++, Saber, reMarkable, Supernote and FreeNotes: their own " +
          "notebook files come over too.\n" +
          "• Anything else, such as Apple Notes: export a PDF, and write over its pages.\n" +
          "Then choose New notebook › Import from another app. Your handwriting stays editable.",
        "Bring your notebooks over",
      );
      s.card(
        "Save notebook as template, in the command palette, keeps a notebook's pages, papers " +
          "and stickers in one .finetemplate file, to start new notebooks from or to share.",
        "Templates",
      );
      s.foot({ page: 16, title: "AI with your own key" });
    },
  },
  {
    title: "AI with your own key",
    section: "more",
    tone: TONES.more,
    draw: (s) => {
      s.kicker("More · Optional");
      s.title("AI with your own key");
      s.sparkle(s.right - 120, TOP + 40, 26, TONES.more.accent, 3);
      s.sparkle(s.right - 70, TOP + 90, 16, TONES.more.accent, 3);
      s.sparkle(s.right - 160, TOP + 100, 12, TONES.more.accent, 3);
      s.para(
        "FineNotes works fully offline, with no account. If you want, it can use an AI " +
          "service with your own key: Claude, GPT, Gemini, OpenRouter or your own server.",
      );
      s.card(
        "• Transcribe a page or the whole notebook into text.\n" +
          "• Ask about this page or this notebook, and put the answer on the page.\n" +
          "• Generate a picture.\n" +
          "• Transcribe a recording.",
        "With a key, the AI button offers",
      );
      s.card(
        "Set it up in Settings › FineNotes › AI with your own key. Nothing is sent until you " +
          "agree, once, and then only to the service you chose. Your key stays in Obsidian's " +
          "keychain, not in the vault.",
        "Your choice",
      );
      s.card(
        "Reading your handwriting for search needs no key: Grape does it on this device, and " +
          "nothing leaves it.",
        "Without a key",
        TONES.find,
      );
      s.tryIt(
        "Write a word below, wait a moment, then tap AI › Read this page to see how Grape reads it.",
      );
      s.foot({ page: 17, title: "Keyboards and pen tablets" });
    },
  },
  {
    title: "Keyboards, pen tablets and more",
    section: "more",
    tone: TONES.more,
    draw: (s) => {
      s.kicker("More · Extras");
      s.title("Keyboards, pen tablets and more");
      const keys: Array<[string, string]> = [
        ["P", "pen"],
        ["H", "highlighter"],
        ["E", "eraser"],
        ["V", "lasso"],
        ["S", "shapes"],
        ["T", "text"],
        ["L", "laser"],
        ["?", "shortcuts"],
      ];
      const step = s.width / keys.length;
      const top = s.y + 4;
      keys.forEach(([key, what], i) =>
        drawKey(s, MARGIN + i * step + (step - 60) / 2, top, key, what),
      );
      s.y = top + 110;
      s.card(
        "1 to 8 pick your saved pens; Cmd/Ctrl+Z undoes; Page Up and Page Down turn pages. " +
          "Press ? for every shortcut, also in More (⋯).",
        "With a keyboard",
      );
      s.card(
        "Hold Shift while writing to erase, Ctrl (Cmd) to lasso, Alt and draw up or down to " +
          "zoom. A pen's eraser end erases, and its side button does what you set in Settings.",
        "With a pen tablet",
      );
      s.card(
        "• The laser pointer leaves a red trail that fades: for pointing, never kept.\n" +
          "• Dark pages, in More (⋯), for writing at night. Your ink keeps its true colour.",
        "And",
      );
      s.card(
        "Switch off Scribble in the iPad's Settings app (Apple Pencil › Scribble): it can take " +
          "a fast stroke for itself before FineNotes sees it.",
        "On an iPad",
        TONES.write,
      );
      const zone = s.tryIt(
        "Pick the laser in the pen type menu (or press L) and point at the star.",
      );
      s.shape(
        "star",
        zone.x + zone.w / 2 - 50,
        zone.y + zone.h / 2 - 48,
        zone.x + zone.w / 2 + 50,
        zone.y + zone.h / 2 + 48,
        PEN.orange,
        3.5,
      );
      s.foot({ page: 18, title: "Your turn" });
    },
  },
  {
    title: "Your turn",
    section: "end",
    tone: TONES.start,
    ruling: "dotted",
    draw: (s) => {
      s.page.title = "Your turn";
      // A banner sticker to write on, with a sparkle, at the top.
      const bx = MARGIN + s.width / 2 - 140;
      s.sticker("banner", bx, 60, { scale: 1.4 });
      s.box(bx + 40, 72, 200, "Your turn", { size: 26, bold: true, color: INK, align: "center" });
      s.sticker("sparkles", bx + 290, 50, { scale: 0.8 });
      // On a card of the paper's own colour, so the dots do not run through the words.
      const text =
        "This page is yours. Keep the notebook, change it, or delete it whenever you like.";
      const style = { size: 17, color: MUTED, align: "center" as const };
      const top = 160;
      const h = boxHeight(text, s.width - 12, style) + 12;
      s.shape("rect", MARGIN, top, s.right, top + h, PAPER, 2, {
        fill: fillOf(PAPER, "solid"),
        radius: 10,
      });
      s.box(MARGIN + 6, top + 6, s.width - 12, text, style);
      s.foot();
    },
  },
];

/** Page number (1-based) of the first tour page: after the cover and the contents. */
const FIRST_TOUR_PAGE = 3;

/** The tour's titles, in order (the contents page lists these). */
export const WELCOME_PAGE_TITLES: readonly string[] = TOUR.map((page) => page.title);

/** The contents page: what the notebook is, then every page as a link. */
function drawContents(s: Sheet): void {
  s.kicker("Start here");
  s.title(WELCOME_TITLE);
  s.page.title = "Contents";
  s.page.bookmarked = true;
  s.para(
    "Handwritten notebooks with real pages, as in Goodnotes, kept as files in your vault. " +
      "This notebook shows you around. Everything in it is made with FineNotes: select it, " +
      "move it, recolour it or erase it. Undo puts it back.",
  );
  // The lists on the left; a little stack of notebooks and a note on the right.
  const listW = 560;
  const side = MARGIN + listW + 40;
  const essentials = s.y + 22;
  const list = (heading: string, which: TourPage["section"], tone: Tone): void => {
    s.flow(
      heading,
      { size: 15, bold: true, caps: true, color: tone.accent, fit: true },
      4,
      MARGIN + 4,
      estimateWidth(heading.toUpperCase(), 15, true) + 12,
    );
    const lines = TOUR.map((page, i) => ({ page, number: i + FIRST_TOUR_PAGE }))
      .filter(({ page }) => page.section === which)
      .map(({ page, number }, i) => `${i + 1}.  [[#page=${number}|${page.title}]]`);
    s.y +=
      s.onCard(MARGIN, s.y, listW, lines.join("\n"), { size: 22, lineHeight: 1.65 }, tone) + 24;
  };
  list("The essentials", "start", TONES.start);
  list("More to discover", "more", TONES.shape);
  s.label(MARGIN, s.y, "Tap a title to go there. Each page ends with a link back here.");
  // The note and its arrow, pointing at the first title.
  s.label(side + 20, essentials + 150, "start here", { color: PEN.orange, italic: true, size: 20 });
  s.inkArrow(
    { x: side + 40, y: essentials + 140 },
    { x: MARGIN + listW + 10, y: essentials + 60 },
    30,
    PEN.orange,
  );
  // An open notebook: two pages side by side, one written on, one with a
  // shape and a bookmark, and a sparkle over it.
  const book = { x: side + 10, y: essentials + 270, w: 120, h: 170 };
  s.miniPage(book.x, book.y, book.w, book.h, TONES.start.accent);
  s.shape("rect", book.x + book.w, book.y, book.x + 2 * book.w, book.y + book.h, SKETCH, 2);
  s.shape(
    "star",
    book.x + book.w + 28,
    book.y + 46,
    book.x + 2 * book.w - 28,
    book.y + 116,
    PEN.orange,
    2.5,
  );
  s.stroke(
    flat([
      { x: book.x + 2 * book.w - 26, y: book.y },
      { x: book.x + 2 * book.w - 26, y: book.y + 30 },
      { x: book.x + 2 * book.w - 19, y: book.y + 23 },
      { x: book.x + 2 * book.w - 12, y: book.y + 30 },
      { x: book.x + 2 * book.w - 12, y: book.y },
    ]),
    PEN.red,
    2.5,
  );
  s.sparkle(book.x + 2 * book.w + 18, book.y - 18, 20, PEN.orange, 3);
  s.sparkle(book.x + 2 * book.w + 40, book.y + 22, 11, PEN.orange, 2.5);
  // A strip of tape holding the little notebook down: a sticker in front of the ink.
  s.sticker("tape", book.x - 34, book.y - 18, {
    scale: 0.5,
    rotation: -0.5,
    front: true,
    opacity: 0.85,
  });
}

/**
 * Pages that carry a tab on the notebook's edge, by title, in their
 * section's colour: the contents, where each section starts, and the end.
 */
const TABS: Readonly<Record<string, string>> = {
  Contents: TONES.start.accent,
  "Write, scroll and zoom": TONES.write.accent,
  Shapes: TONES.shape.accent,
  "Text boxes": TONES.text.accent,
  "Links, contents and search": TONES.find.accent,
  Recordings: TONES.more.accent,
};

/**
 * The welcome notebook: a cover titled `title`, the contents page, the tour
 * and a page left free, numbered at the foot of each page, with tabs on the
 * edge. `stickers` says where {@link welcomeStickerFiles} were saved; a
 * sticker without a file is left out.
 */
export function buildWelcomeNotebook(
  title: string = WELCOME_TITLE,
  attachments?: AttachmentFolders,
  stickers: StickerPaths = {},
): InkDocument {
  const doc = buildNewDocument(
    { ...DEFAULT_NOTEBOOK_CHOICES, ...WELCOME_COVER },
    title,
    attachments,
  );
  const cover = doc.pages[0];
  cover.title = "Cover";
  const ids = new Ids();
  // The cover's own boxes keep their ids (t0, t1); the tour's count on from them.
  ids.box();
  const contents = new Sheet(ids, stickers, 2, cover.geometry, "blank", TONES.start);
  drawContents(contents);
  const tour = TOUR.map((page, i) => {
    const sheet = new Sheet(
      ids,
      stickers,
      i + FIRST_TOUR_PAGE,
      cover.geometry,
      page.ruling ?? "blank",
      page.tone,
    );
    page.draw(sheet);
    return sheet.page;
  });
  doc.pages = [cover, contents.page, ...tour];
  for (const page of doc.pages) {
    const tab = page.title ? TABS[page.title] : undefined;
    if (tab) page.tab = tab;
  }
  doc.furniture = { numbers: "center" };
  return doc;
}
