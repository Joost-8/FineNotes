/**
 * A text note drawn as pages, small, for Home: its first page is the
 * note's cover and the rest are the preview's page strip, as a notebook's
 * pages are (model/note-pages.ts cuts it into pages).
 *
 * A page is drawn on a canvas, so it can be kept as a small picture like a
 * notebook page: the text in the note's own sizes and styles (the
 * "Text notes" rules in styles.css, copied here because a canvas reads no
 * stylesheet), list and checklist marks, handwriting through the
 * notebook's ink pipeline (as note-ink.ts draws it) and pictures. The
 * paper is white whatever the theme, as notebook pages are on Home.
 */

import { DEFAULT_HIGHLIGHTER_ALPHA } from "../constants";
import { drawSyntheticRules, paperTheme } from "../canvas/backdrop";
import { paintInk, penFor } from "../canvas/renderer";
import { paintGraph } from "../canvas/graph-paint";
import { inkRuns } from "../ink/freehand";
import type { Stroke } from "../model/document";
import { makeGraph } from "../model/graph-element";
import { noteGraphHeight } from "./note-graph";
import {
  NOTE_CONTENT_HEIGHT,
  NOTE_PAGE_HEIGHT,
  NOTE_PAGE_MARGIN_TOP,
  NOTE_PAGE_MARGIN_X,
  NOTE_PAGE_WIDTH,
  type MeasuredBlock,
  type PageSlice,
  paginate,
  wrapRuns,
} from "../model/note-pages";
import {
  BOLD,
  HIGHLIGHT,
  INK_WIDTH,
  ITALIC,
  STRIKE,
  UNDERLINE,
  imageShare,
  isList,
  listMarkers,
  type ImageBlock,
  type GraphBlock,
  type InkBlock,
  type NoteBlock,
  type TextBlock,
  type TextKind,
  type TextNote,
  type TextRun,
} from "../model/text-note";

/** How one kind of paragraph looks: the note's own CSS, in page px. */
interface KindStyle {
  size: number;
  weight: number;
  lineHeight: number;
  /** Room above (margin and padding), and below. */
  before: number;
  after: number;
  mono?: true;
}

const BODY: KindStyle = { size: 17, weight: 400, lineHeight: 17 * 1.47, before: 1, after: 1 };
const STYLES: Readonly<Record<TextKind, KindStyle>> = {
  title: { size: 28, weight: 700, lineHeight: 28 * 1.2, before: 1, after: 7 },
  heading: { size: 22, weight: 700, lineHeight: 22 * 1.25, before: 15, after: 1 },
  subheading: { ...BODY, weight: 650, before: 9 },
  body: BODY,
  mono: { size: 14.5, weight: 400, lineHeight: 14.5 * 1.6, before: 1, after: 1, mono: true },
  bullet: BODY,
  dash: BODY,
  number: BODY,
  upper: BODY,
  lower: BODY,
  check: BODY,
  quote: BODY,
};
/** A run of monospaced lines sits in one rounded box, this much padding at its ends. */
const MONO_PAD = 8;
const MONO_GAP = 6;
const MONO_INSET = 14;
/** Room round a handwriting section or a picture. */
const SECTION_GAP = 8;
const RAW_HEIGHT = 34;
const LIST_INDENT = 26;
const LIST_TEXT = 30;
const QUOTE_TEXT = 16;

/** The colours a page is drawn in: paper-white, as Home's notebook pages. */
export interface NotePagePalette {
  text: string;
  muted: string;
  faint: string;
  accent: string;
  code: string;
}

export const DEFAULT_PALETTE: NotePagePalette = {
  text: "#222222",
  muted: "#6b6b6b",
  faint: "#a3a3a3",
  accent: "#7c5cff",
  code: "#f2f2f3",
};

export interface NoteFonts {
  text: string;
  mono: string;
}

const FALLBACK_FONTS: NoteFonts = {
  text: '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
};

/**
 * The fonts and accent Obsidian shows now, read off `el`: a canvas takes
 * no `var(--…)` (ledger, "CSS variables do not work in any canvas string
 * property").
 */
export function noteLook(el: HTMLElement): { fonts: NoteFonts; palette: NotePagePalette } {
  const style = getComputedStyle(el);
  const read = (name: string): string => style.getPropertyValue(name).trim();
  return {
    fonts: {
      text: read("--font-text") || FALLBACK_FONTS.text,
      mono: read("--font-monospace") || FALLBACK_FONTS.mono,
    },
    palette: { ...DEFAULT_PALETTE, accent: read("--interactive-accent") || DEFAULT_PALETTE.accent },
  };
}

/** A picture as the page shows it: its size on the page and what to draw, once decoded. */
export interface NotePicture {
  width: number;
  height: number;
  source: CanvasImageSource | null;
}

type Laid =
  | {
      type: "text";
      block: TextBlock;
      style: KindStyle;
      lines: TextRun[][];
      /** Where the text starts, from the column's left. */
      left: number;
      marker: string | null;
      /** A monospaced line: the box's extra room above and below this line. */
      padTop: number;
      padBottom: number;
    }
  | { type: "ink"; block: InkBlock }
  | { type: "image"; block: ImageBlock; picture: NotePicture }
  | { type: "table"; rows: readonly (readonly string[])[] }
  | { type: "graph"; block: GraphBlock; height: number }
  | { type: "raw"; text: string };

/** A table's row height on a page, and the most rows a preview draws. */
const TABLE_ROW = 30;

/** A note laid out on pages, ready to draw any of them. */
export interface NoteLayout {
  readonly laid: readonly Laid[];
  readonly pages: readonly PageSlice[][];
  readonly fonts: NoteFonts;
}

function font(style: KindStyle, marks: number, fonts: NoteFonts): string {
  const italic = marks & ITALIC ? "italic " : "";
  const weight = marks & BOLD ? Math.max(700, style.weight) : style.weight;
  return `${italic}${weight} ${style.size}px ${style.mono ? fonts.mono : fonts.text}`;
}

/**
 * `note` laid out on pages: each paragraph wrapped with `ctx`'s
 * measurements, `picture` telling each picture's size (null: none to show,
 * a placeholder the column's width).
 */
export function layoutNote(
  note: TextNote,
  ctx: CanvasRenderingContext2D,
  picture: (block: ImageBlock) => NotePicture | null,
  fonts: NoteFonts = FALLBACK_FONTS,
): NoteLayout {
  const markers = listMarkers(note.blocks);
  const laid: Laid[] = [];
  const measured: MeasuredBlock[] = [];
  const blocks = note.blocks;
  const isMono = (b: NoteBlock | undefined): boolean => b?.type === "text" && b.kind === "mono";
  blocks.forEach((block, i) => {
    if (block.type === "text") {
      const style = STYLES[block.kind] ?? BODY;
      const indent = block.indent ?? 0;
      const left = isList(block.kind)
        ? LIST_TEXT + indent * LIST_INDENT
        : block.kind === "quote"
          ? QUOTE_TEXT + 2
          : style.mono
            ? MONO_INSET
            : 0;
      const width = INK_WIDTH - left - (style.mono ? MONO_INSET : 0);
      const lines = wrapRuns(block.runs, width, (text, marks) => {
        ctx.font = font(style, marks, fonts);
        return ctx.measureText(text).width;
      });
      const padTop = style.mono && !isMono(blocks[i - 1]) ? MONO_PAD : 0;
      const padBottom = style.mono && !isMono(blocks[i + 1]) ? MONO_PAD : 0;
      laid.push({ type: "text", block, style, lines, left, marker: markers[i], padTop, padBottom });
      measured.push({
        before: style.before + padTop + (padTop ? MONO_GAP : 0),
        after: style.after + padBottom + (padBottom ? MONO_GAP : 0),
        lines: lines.map(() => style.lineHeight),
        whole: false,
        ...(block.kind === "title" || block.kind === "heading" || block.kind === "subheading"
          ? { keepWithNext: true }
          : {}),
      });
      return;
    }
    if (block.type === "ink") {
      laid.push({ type: "ink", block });
      measured.push({
        before: SECTION_GAP,
        after: SECTION_GAP,
        lines: [block.height],
        whole: true,
      });
      return;
    }
    if (block.type === "image") {
      const width = INK_WIDTH * imageShare(block);
      const shown = picture(block) ?? { width, height: width * 0.5625, source: null };
      laid.push({ type: "image", block, picture: shown });
      measured.push({
        before: SECTION_GAP,
        after: SECTION_GAP,
        lines: [shown.height],
        whole: true,
      });
      return;
    }
    if (block.type === "table") {
      laid.push({ type: "table", rows: block.rows });
      measured.push({
        before: SECTION_GAP,
        after: SECTION_GAP,
        lines: block.rows.map(() => TABLE_ROW),
        whole: false,
      });
      return;
    }
    if (block.type === "graph") {
      // As the note shows it: the column's width, its height the shape of its view.
      const height = noteGraphHeight(block, INK_WIDTH);
      laid.push({ type: "graph", block, height });
      measured.push({ before: SECTION_GAP, after: SECTION_GAP, lines: [height], whole: true });
      return;
    }
    if (block.type === "audio") {
      const name = block.path.split("/").pop() ?? block.path;
      laid.push({ type: "raw", text: name });
      measured.push({ before: SECTION_GAP, after: SECTION_GAP, lines: [RAW_HEIGHT], whole: true });
      return;
    }
    laid.push({ type: "raw", text: block.text.split("\n")[0] ?? "" });
    measured.push({ before: SECTION_GAP, after: SECTION_GAP, lines: [RAW_HEIGHT], whole: true });
  });
  return { laid, pages: paginate(measured, NOTE_CONTENT_HEIGHT), fonts };
}

export interface NotePageOptions {
  palette?: NotePagePalette;
  usePressure?: boolean;
  highlighterAlpha?: number;
  /** Draws a handwriting section in its own units; absent, through the canvas ink pipeline. */
  ink?: (ctx: CanvasRenderingContext2D, block: InkBlock) => void;
}

/** Page `index` of `layout` drawn into `canvas`, `cssWidth` CSS px wide at `dpr`. */
export function drawNotePage(
  canvas: HTMLCanvasElement,
  layout: NoteLayout,
  index: number,
  cssWidth: number,
  dpr: number,
  options: NotePageOptions = {},
): void {
  const k = (cssWidth * dpr) / NOTE_PAGE_WIDTH;
  canvas.width = Math.max(1, Math.round(NOTE_PAGE_WIDTH * k));
  canvas.height = Math.max(1, Math.round(NOTE_PAGE_HEIGHT * k));
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  paintNotePage(ctx, layout, index, k, options);
}

/**
 * Page `index` of `layout` painted into `ctx`, `k` device px a page px, from
 * the top-left: the paper, then each slice. A canvas, or a PDF page's
 * recorder (`export/pdf-page-canvas`).
 */
export function paintNotePage(
  ctx: CanvasRenderingContext2D,
  layout: NoteLayout,
  index: number,
  k: number,
  options: NotePageOptions = {},
): void {
  const palette = options.palette ?? DEFAULT_PALETTE;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, NOTE_PAGE_WIDTH * k, NOTE_PAGE_HEIGHT * k);
  for (const slice of layout.pages[index] ?? []) {
    const item = layout.laid[slice.block];
    if (!item) continue;
    ctx.save();
    ctx.setTransform(k, 0, 0, k, NOTE_PAGE_MARGIN_X * k, NOTE_PAGE_MARGIN_TOP * k);
    if (item.type === "text") drawText(ctx, item, slice, layout.fonts, palette);
    else {
      // Only the slice's part of the section: a section taller than a page is cut.
      ctx.beginPath();
      ctx.rect(-NOTE_PAGE_MARGIN_X, slice.y, NOTE_PAGE_WIDTH, slice.height);
      ctx.clip();
      // A table breaks between rows: a slice shows rows `from` to `to`.
      const into = item.type === "table" ? slice.from * TABLE_ROW : slice.offset;
      ctx.translate(0, slice.y - into);
      if (item.type === "ink") (options.ink ?? ((c, b) => drawInk(c, b, options)))(ctx, item.block);
      else if (item.type === "image") drawPicture(ctx, item.picture, palette);
      else if (item.type === "table") drawTable(ctx, item.rows, layout.fonts, palette);
      else if (item.type === "graph") drawGraph(ctx, item.block, item.height, k);
      else drawRaw(ctx, item.text, layout.fonts, palette);
    }
    ctx.restore();
  }
}

/** A graph, as the note draws it (`note-graph.ts`), on white paper. */
function drawGraph(
  ctx: CanvasRenderingContext2D,
  block: GraphBlock,
  height: number,
  k: number,
): void {
  const graph = makeGraph({ id: block.id, x: 0, y: 0, w: INK_WIDTH, h: height, spec: block.spec });
  paintGraph(ctx, graph, { level: Math.max(1, k), night: false, paper: "#ffffff" });
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: [number, number, number, number],
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawText(
  ctx: CanvasRenderingContext2D,
  item: Extract<Laid, { type: "text" }>,
  slice: PageSlice,
  fonts: NoteFonts,
  palette: NotePagePalette,
): void {
  const { block, style, lines, left } = item;
  const first = slice.from === 0;
  const last = slice.to === lines.length;
  if (style.mono) {
    const top = slice.y - 1 - (first ? item.padTop : 0);
    const bottom = slice.y + slice.height + 1 + (last ? item.padBottom : 0);
    const r1 = first && item.padTop ? 10 : 0;
    const r2 = last && item.padBottom ? 10 : 0;
    ctx.fillStyle = palette.code;
    roundedRect(ctx, 0, top, INK_WIDTH, bottom - top, [r1, r1, r2, r2]);
    ctx.fill();
  }
  if (block.kind === "quote") {
    ctx.fillStyle = palette.accent;
    ctx.fillRect(2, slice.y - 1, 3, slice.height + 2);
  }
  const checked = block.kind === "check" && block.checked === true;
  const colour =
    checked || block.kind === "quote" ? (checked ? palette.faint : palette.muted) : palette.text;
  if (first && isList(block.kind)) drawMarker(ctx, item, slice.y, fonts, palette);
  ctx.textBaseline = "middle";
  for (let i = slice.from; i < slice.to; i++) {
    const mid = slice.y + (i - slice.from) * style.lineHeight + style.lineHeight / 2;
    let x = left;
    for (const run of lines[i] ?? []) {
      ctx.font = font(style, run.marks, fonts);
      const w = ctx.measureText(run.text).width;
      if (run.marks & HIGHLIGHT) {
        ctx.fillStyle = "rgba(255, 212, 59, 0.48)";
        roundedRect(ctx, x, mid - style.size * 0.66, w, style.size * 1.32, [3, 3, 3, 3]);
        ctx.fill();
      }
      ctx.fillStyle = colour;
      ctx.fillText(run.text, x, mid);
      if (run.marks & (UNDERLINE | STRIKE)) {
        ctx.fillStyle = colour;
        const thick = Math.max(1, style.size / 16);
        if (run.marks & UNDERLINE) ctx.fillRect(x, mid + style.size * 0.42, w, thick);
        if (run.marks & STRIKE) ctx.fillRect(x, mid - thick / 2 + style.size * 0.04, w, thick);
      }
      x += w;
    }
  }
}

function drawMarker(
  ctx: CanvasRenderingContext2D,
  item: Extract<Laid, { type: "text" }>,
  y: number,
  fonts: NoteFonts,
  palette: NotePagePalette,
): void {
  const { block, style } = item;
  const start = (block.indent ?? 0) * LIST_INDENT;
  if (block.kind === "check") {
    const r = 10.5;
    const cx = start + 24 - r;
    const cy = y - 1 + 0.26 * style.size + r;
    ctx.beginPath();
    ctx.arc(cx, cy, r - 0.8, 0, Math.PI * 2);
    if (block.checked) {
      ctx.fillStyle = palette.accent;
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(cx - 3.8, cy + 0.3);
      ctx.lineTo(cx - 1.3, cy + 2.8);
      ctx.lineTo(cx + 3.8, cy - 2.8);
      ctx.stroke();
    } else {
      ctx.strokeStyle = palette.faint;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
    return;
  }
  const depth = block.indent ?? 0;
  if (block.kind === "bullet") {
    // Drawn, not typed: a ring for every other depth, as the note shows "◦" (not in every PDF font).
    const r = style.size * 0.17;
    ctx.beginPath();
    ctx.arc(start + 20 - r, y + style.lineHeight / 2, r, 0, Math.PI * 2);
    if (depth % 2 === 1) {
      ctx.strokeStyle = palette.muted;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    } else {
      ctx.fillStyle = palette.muted;
      ctx.fill();
    }
    return;
  }
  const mark = block.kind === "dash" ? "–" : (item.marker ?? "");
  const width = block.kind === "dash" ? 20 : 24;
  ctx.font = font(style, 0, fonts);
  ctx.fillStyle = palette.muted;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(mark, start + width, y + style.lineHeight / 2);
  ctx.textAlign = "left";
}

function drawInk(ctx: CanvasRenderingContext2D, block: InkBlock, options: NotePageOptions): void {
  if (block.paper && block.paper !== "blank") {
    drawSyntheticRules(
      ctx,
      { kind: block.paper },
      { width: INK_WIDTH, height: block.height },
      paperTheme(false),
    );
  }
  const paint = (stroke: Stroke): void => {
    const highlighter = stroke.tool === "highlighter";
    const pen = penFor({
      size: stroke.size,
      tool: stroke.tool,
      usePressure: options.usePressure ?? true,
      ...(stroke.nib !== undefined ? { nib: stroke.nib } : {}),
      ...(stroke.tip !== undefined ? { tip: stroke.tip } : {}),
    });
    const runs = inkRuns(stroke.pts, pen, stroke.shape !== undefined, stroke.tilt);
    if (runs.length === 0) return;
    ctx.globalAlpha = highlighter ? (options.highlighterAlpha ?? DEFAULT_HIGHLIGHTER_ALPHA) : 1;
    ctx.fillStyle = stroke.color;
    paintInk(ctx, runs);
    ctx.globalAlpha = 1;
  };
  // Highlights first: they sit under the writing, as in the note.
  for (const stroke of block.strokes) if (stroke.tool === "highlighter") paint(stroke);
  for (const stroke of block.strokes) if (stroke.tool !== "highlighter") paint(stroke);
}

function drawPicture(
  ctx: CanvasRenderingContext2D,
  picture: NotePicture,
  palette: NotePagePalette,
): void {
  roundedRect(ctx, 0, 0, picture.width, picture.height, [12, 12, 12, 12]);
  if (!picture.source) {
    ctx.fillStyle = palette.code;
    ctx.fill();
    return;
  }
  ctx.save();
  ctx.clip();
  ctx.drawImage(picture.source, 0, 0, picture.width, picture.height);
  ctx.restore();
}

/** A table: its grid, the header row shaded, each cell's text cut to fit. */
function drawTable(
  ctx: CanvasRenderingContext2D,
  rows: readonly (readonly string[])[],
  fonts: NoteFonts,
  palette: NotePagePalette,
): void {
  const columns = Math.max(1, rows[0]?.length ?? 1);
  const width = INK_WIDTH / columns;
  ctx.fillStyle = palette.code;
  ctx.fillRect(0, 0, INK_WIDTH, TABLE_ROW);
  ctx.strokeStyle = palette.faint;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let r = 0; r <= rows.length; r++) {
    ctx.moveTo(0, r * TABLE_ROW);
    ctx.lineTo(INK_WIDTH, r * TABLE_ROW);
  }
  for (let c = 0; c <= columns; c++) {
    ctx.moveTo(c * width, 0);
    ctx.lineTo(c * width, rows.length * TABLE_ROW);
  }
  ctx.stroke();
  ctx.textBaseline = "middle";
  rows.forEach((cells, r) => {
    ctx.font = `${r === 0 ? 650 : 400} 15px ${fonts.text}`;
    ctx.fillStyle = palette.text;
    cells.forEach((cell, c) => {
      let text = cell;
      while (text.length > 1 && ctx.measureText(text).width > width - 16) text = text.slice(0, -1);
      ctx.fillText(text === cell ? text : `${text}…`, c * width + 8, r * TABLE_ROW + TABLE_ROW / 2);
    });
  });
}

function drawRaw(
  ctx: CanvasRenderingContext2D,
  text: string,
  fonts: NoteFonts,
  palette: NotePagePalette,
): void {
  ctx.fillStyle = palette.code;
  roundedRect(ctx, 0, 0, INK_WIDTH, RAW_HEIGHT, [12, 12, 12, 12]);
  ctx.fill();
  ctx.font = `400 14.5px ${fonts.mono}`;
  ctx.fillStyle = palette.muted;
  ctx.textBaseline = "middle";
  ctx.fillText(text.length > 80 ? `${text.slice(0, 79)}…` : text, 14, RAW_HEIGHT / 2);
}
