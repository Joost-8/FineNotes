/**
 * Backdrop painting: the paper under the ink (contracts/api.md §4).
 *
 * Synthetic backdrops (`blank` / `lined` / `grid`) are drawn procedurally here
 * and are cheap enough to repaint on every scroll frame. PDF backdrops are
 * rasterised elsewhere (`src/view/pdf-backdrop.ts`) because they need the vault
 * and Obsidian's bundled pdf.js; this module stays free of both so it can be
 * unit-tested and reused from the inline-embed painter.
 *
 * Two rules from contracts/design-brief.md that this module exists to enforce:
 *
 * - **Pages are paper-white by default.** Paper colour is a property of the
 *   notebook, not of the Obsidian theme. A dark page is an explicit per-notebook
 *   override ({@link DARK_PAPER}), never something the app theme imposes.
 * - **Ink colour is absolute.** Nothing here touches stroke colour. The renderer
 *   paints `stroke.color` verbatim; a black stroke stays black on a dark page
 *   (the user is told to recolour, rather than having their ink changed under
 *   them).
 *
 * All drawing happens in **page space**: the caller has already translated the
 * context so `(0, 0)` is the page's top-left corner, and `geometry` is the full
 * extent to fill.
 */

import {
  type CoverPalette,
  type CoverRect,
  coverLayout,
  coverPalette,
  withAlpha,
} from "../model/cover";
import type {
  Backdrop,
  CoverRuling,
  PageGeometry,
  Ruling,
  SyntheticBackdrop,
} from "../model/document";

/** Colours a page is painted with. Chrome colours come from Obsidian's CSS vars;
 *  these are the *paper*, which is deliberately theme-independent. */
export interface PaperTheme {
  /** Page fill. */
  paper: string;
  /** Rule / grid line colour when the backdrop does not specify one. */
  rule: string;
  /** 1px page border, so a white page is visible against a white workspace. */
  edge: string;
  /** Drop shadow beneath the page. */
  shadow: string;
  /** Text/marker colour for the "missing source" placeholder. */
  marker: string;
  /**
   * The field the page floats on. The design brief asks for "a dark neutral
   * field with generous margins either side - the page is an object on a desk,
   * not a region that fills the pane", so this is deliberately NOT an Obsidian
   * theme variable: like the paper itself, it belongs to the page presentation
   * rather than to the chrome.
   */
  desk: string;
}

/** The default: real paper-white, whatever the Obsidian theme is doing. */
export const LIGHT_PAPER: PaperTheme = {
  paper: "#ffffff",
  rule: "#ccd5e0",
  edge: "rgba(16, 24, 40, 0.16)",
  shadow: "rgba(16, 24, 40, 0.35)",
  marker: "#8a94a6",
  desk: "#3b3e45",
};

/** The per-notebook dark override. Not automatic — the user asks for it. */
export const DARK_PAPER: PaperTheme = {
  paper: "#1c1d21",
  rule: "#383b44",
  edge: "rgba(0, 0, 0, 0.55)",
  shadow: "rgba(0, 0, 0, 0.55)",
  marker: "#7d848f",
  desk: "#1b1c1f",
};

export function paperTheme(dark: boolean): PaperTheme {
  return dark ? DARK_PAPER : LIGHT_PAPER;
}

/**
 * The paper rulings of contracts/api.md §1, taken from GoodNotes' own template
 * picker. Re-exported from the model so callers of this module keep working;
 * the model is the single definition.
 */
export type { Ruling } from "../model/document";

/**
 * A synthetic backdrop.
 *
 * The frontend agent declared a local copy of this plus an `asPaper()` cast,
 * because the model still carried the narrower v1 union while both sides were
 * built in parallel. The model caught up at integration (2026-09-20), so the
 * duplicate and the cast are gone and this is simply the model's type.
 */
export type SyntheticPaper = SyntheticBackdrop;

/** Paper colour presets named by the contract. */
export const PAPER_PRESETS = {
  white: "#ffffff",
  cream: "#fbf8ed",
  yellow: "#fdf6d8",
} as const;

/** Fallback pitch for an unknown ruling from a newer document. */
export const DEFAULT_SPACING = 40;

/** Smallest pitch we will honour, so a corrupt document cannot hang the paint loop. */
const MIN_SPACING = 4;

/** Rule width in page px. */
const RULE_WIDTH = 1;

/** Dot radius for `dotted`, in page px. */
const DOT_RADIUS = 1.5;

/**
 * The view-side backdrop resolver (contracts/api.md §4). Implementations draw
 * into `ctx`, filling exactly `geometry` in page space.
 */
export interface BackdropRenderer {
  draw(ctx: CanvasRenderingContext2D, backdrop: Backdrop, geometry: PageGeometry): Promise<void>;
}

/** Clamp a document-supplied spacing to something paintable. */
export function resolveSpacing(spacing: number | undefined, ruling?: Ruling): number {
  if (typeof spacing !== "number" || !Number.isFinite(spacing)) {
    return RULINGS[ruling as Ruling]?.spacing ?? DEFAULT_SPACING;
  }
  return Math.max(MIN_SPACING, spacing);
}

/**
 * Paint the page's base colour. Always the first thing drawn on a page.
 *
 * `paperColor` from the document wins when present — GoodNotes treats paper
 * colour as an axis of its own, and contract v2 §1 copies that. Otherwise the
 * notebook's own theme decides: paper-white by default, dark only as an
 * explicit per-notebook override. Never the Obsidian theme.
 */
export function fillPaper(
  ctx: CanvasRenderingContext2D,
  geometry: PageGeometry,
  theme: PaperTheme,
  paperColor?: string,
): void {
  ctx.save();
  ctx.fillStyle = paperColor ?? theme.paper;
  ctx.fillRect(0, 0, geometry.width, geometry.height);
  ctx.restore();
}

/** Crisp 1px line: half-pixel offsets stop a rule straddling two device rows. */
function crisp(v: number): number {
  return Math.round(v) + 0.5;
}

/** What a ruling painter is handed. Page space; the paper is already filled. */
export interface RulingContext {
  geometry: PageGeometry;
  /** Pitch in page px, already defaulted per ruling and clamped. */
  spacing: number;
  /** Rule colour, already defaulted from the document or the paper theme. */
  color: string;
  /** Line-weight multiplier: 1 on the page, more in a small preview. */
  weight: number;
  theme: PaperTheme;
  /**
   * The colour the paper was filled with: the backdrop's own, else the
   * theme's. A cover derives every colour it paints from this.
   */
  paper: string;
}

/**
 * One ruling's drawing routine.
 *
 * The context arrives with stroke/fill style and line width set and a path
 * already begun; a painter adds segments and the caller strokes once. A painter
 * that needs its own paint operation (dots) paints itself and returns
 * "painted" to tell the caller not to stroke.
 */
export type RulingPainter = (ctx: CanvasRenderingContext2D, c: RulingContext) => "painted" | void;

function horizontalRules(
  ctx: CanvasRenderingContext2D,
  c: RulingContext,
  x0 = 0,
  x1 = c.geometry.width,
): void {
  for (let y = c.spacing; y < c.geometry.height; y += c.spacing) {
    const py = crisp(y);
    ctx.moveTo(x0, py);
    ctx.lineTo(x1, py);
  }
}

function verticalRules(ctx: CanvasRenderingContext2D, c: RulingContext): void {
  for (let x = c.spacing; x < c.geometry.width; x += c.spacing) {
    const px = crisp(x);
    ctx.moveTo(px, 0);
    ctx.lineTo(px, c.geometry.height);
  }
}

function columnRule(ctx: CanvasRenderingContext2D, c: RulingContext, x: number): void {
  const px = crisp(x);
  ctx.moveTo(px, 0);
  ctx.lineTo(px, c.geometry.height);
}

function squaredPainter(ctx: CanvasRenderingContext2D, c: RulingContext): void {
  horizontalRules(ctx, c);
  verticalRules(ctx, c);
}

/**
 * **The ruling table** — contracts/api.md §1, "Ruling specifications".
 *
 * A table rather than a switch, on purpose: Planner templates are coming, and
 * adding one must mean adding one entry here and touching nothing else.
 * Anything a newer document names that is missing from this table falls back to
 * plain horizontal rules rather than to an empty page.
 */
export const RULINGS: Record<Ruling, { spacing: number; draw: RulingPainter }> = {
  blank: { spacing: 40, draw: () => undefined },

  dotted: {
    spacing: 40,
    draw: (ctx, c) => {
      for (let y = c.spacing; y < c.geometry.height; y += c.spacing) {
        for (let x = c.spacing; x < c.geometry.width; x += c.spacing) {
          const r = DOT_RADIUS * c.weight;
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, Math.PI * 2);
        }
      }
      ctx.fill();
      return "painted";
    },
  },

  "ruled-narrow": { spacing: 28, draw: horizontalRules },
  "ruled-wide": { spacing: 40, draw: horizontalRules },
  /** @deprecated alias of ruled-wide, kept so v1 fixtures stay valid */
  lined: { spacing: 40, draw: horizontalRules },

  squared: { spacing: 28, draw: squaredPainter },
  /** @deprecated alias of squared, kept so v1 fixtures stay valid */
  grid: { spacing: 28, draw: squaredPainter },

  cornell: {
    spacing: 40,
    draw: (ctx, c) => {
      horizontalRules(ctx, c);
      // Cue column at 25% of the width; summary band 20% up from the bottom.
      const cueX = crisp(c.geometry.width * 0.25);
      const summaryY = crisp(c.geometry.height * 0.8);
      ctx.moveTo(cueX, 0);
      ctx.lineTo(cueX, summaryY);
      ctx.moveTo(0, summaryY);
      ctx.lineTo(c.geometry.width, summaryY);
    },
  },

  legal: {
    spacing: 40,
    draw: (ctx, c) => {
      horizontalRules(ctx, c);
      // The double margin rule near the left edge, as on a legal pad.
      const m = c.geometry.width * 0.08;
      columnRule(ctx, c, m);
      columnRule(ctx, c, m + 6);
    },
  },

  "single-column": {
    spacing: 40,
    draw: (ctx, c) => {
      const inset = c.geometry.width * 0.18;
      horizontalRules(ctx, c, inset, c.geometry.width - inset);
      columnRule(ctx, c, inset);
      columnRule(ctx, c, c.geometry.width - inset);
    },
  },

  "three-column": {
    spacing: 40,
    draw: (ctx, c) => {
      const colW = c.geometry.width / 3;
      for (let i = 0; i < 3; i++) horizontalRules(ctx, c, i * colW, (i + 1) * colW);
      columnRule(ctx, c, colW);
      columnRule(ctx, c, colW * 2);
    },
  },

  // --- Planner and music templates, after GoodNotes' built-in set. ---------
  // All sizes are fractions of the page, so they work at every paper size.

  "single-column-mix": {
    spacing: 40,
    draw: (ctx, c) => {
      // A blank title band, closed by one full-width rule, over a single
      // ruled column.
      const { width, height } = c.geometry;
      const inset = width * 0.18;
      const band = height * 0.16;
      hLine(ctx, 0, width, band);
      for (let y = band + c.spacing; y < height; y += c.spacing)
        hLine(ctx, inset, width - inset, y);
      vLine(ctx, inset, band, height);
      vLine(ctx, width - inset, band, height);
    },
  },

  todos: {
    spacing: 48,
    draw: (ctx, c) => {
      const { width, height } = c.geometry;
      const margin = width * 0.07;
      const box = Math.max(6, c.spacing * 0.42);
      // Header row for a title, then one checkbox per ruled row.
      const header = c.spacing * 2;
      hLine(ctx, margin, width - margin, header);
      for (let y = header + c.spacing; y < height - c.spacing / 2; y += c.spacing) {
        hLine(ctx, margin, width - margin, y);
        ctx.rect(crisp(margin + 4), crisp(y - c.spacing / 2 - box / 2), box, box);
      }
    },
  },

  "weekly-planner": {
    spacing: 36,
    draw: (ctx, c) => {
      const { width, height } = c.geometry;
      const margin = width * 0.06;
      const top = height * 0.09;
      const bottom = height - margin;
      const labelW = width * 0.14;
      const day = (bottom - top) / 7;
      for (let i = 0; i <= 7; i++) hLine(ctx, margin, width - margin, top + i * day);
      vLine(ctx, margin + labelW, top, bottom);
      for (let i = 0; i < 7; i++) {
        const y0 = top + i * day;
        for (let y = y0 + c.spacing; y < y0 + day - 4; y += c.spacing) {
          hLine(ctx, margin + labelW, width - margin, y);
        }
      }
      ctx.stroke();
      const labels = WEEKDAYS.map((d, i) => ({ text: d, x: margin + 10, y: top + i * day + 12 }));
      paintLabels(ctx, c, labels, Math.min(22, day * 0.2), "left");
      return "painted";
    },
  },

  "monthly-planner": {
    spacing: 40,
    draw: (ctx, c) => {
      const { width, height } = c.geometry;
      const margin = width * 0.05;
      const top = height * 0.11;
      const head = height * 0.035;
      const bottom = height - margin;
      const colW = (width - margin * 2) / 7;
      const rowH = (bottom - top - head) / 6;
      hLine(ctx, margin, width - margin, top);
      for (let r = 0; r <= 6; r++) hLine(ctx, margin, width - margin, top + head + r * rowH);
      for (let col = 0; col <= 7; col++) vLine(ctx, margin + col * colW, top, bottom);
      ctx.stroke();
      const labels = WEEKDAYS.map((d, i) => ({
        text: d,
        x: margin + i * colW + colW / 2,
        y: top + head * 0.25,
      }));
      paintLabels(ctx, c, labels, Math.min(20, head * 0.55), "center");
      return "painted";
    },
  },

  accounting: {
    spacing: 32,
    draw: (ctx, c) => {
      const { width, height } = c.geometry;
      const margin = width * 0.05;
      const top = c.spacing * 3;
      // Date | description | debit | credit | balance.
      for (let y = top; y < height - c.spacing / 2; y += c.spacing) {
        hLine(ctx, margin, width - margin, y);
      }
      const span = width - margin * 2;
      for (const f of [0, 0.14, 0.58, 0.72, 0.86, 1]) vLine(ctx, margin + span * f, top, height);
    },
  },

  music: {
    spacing: 12,
    draw: (ctx, c) => {
      staves(ctx, c, 5, c.spacing * 7);
    },
  },

  "guitar-tab": {
    spacing: 14,
    draw: (ctx, c) => {
      const tops = staves(ctx, c, 6, c.spacing * 5);
      ctx.stroke();
      const size = Math.max(8, c.spacing * 1.2);
      const labels = tops.flatMap((y) =>
        ["T", "A", "B"].map((text, i) => ({
          text,
          x: c.geometry.width * 0.06 + size,
          y: y + c.spacing * (1 + i * 1.3),
        })),
      );
      paintLabels(ctx, c, labels, size, "center");
      return "painted";
    },
  },

  "title-date": {
    spacing: 40,
    draw: (ctx, c) => {
      // A header band: "Title" and a long writing rule, "Date" and a short
      // one on the right; a heavier rule closes it; ruled-wide body below.
      const { width, height } = c.geometry;
      const margin = width * 0.06;
      const size = Math.max(10, Math.min(22, c.spacing * 0.55));
      const writeY = c.spacing * 2;
      const header = c.spacing * 3;
      const dateX = width * 0.66;
      ctx.save();
      ctx.globalAlpha = 0.14;
      ctx.fillRect(0, 0, width, header);
      ctx.restore();
      // Rules start past their labels: ~3.2 and ~2.9 ems of 600-weight UI font.
      hLine(ctx, margin + size * 3.2, dateX - size, writeY);
      hLine(ctx, dateX + size * 2.9, width - margin, writeY);
      for (let y = header + c.spacing; y < height; y += c.spacing) hLine(ctx, 0, width, y);
      ctx.stroke();
      ctx.beginPath();
      hLine(ctx, 0, width, header);
      ctx.lineWidth = RULE_WIDTH * c.weight * 2;
      ctx.stroke();
      const y = writeY - size - 5;
      paintLabels(
        ctx,
        c,
        [
          { text: "Title", x: margin, y },
          { text: "Date", x: dateX, y },
        ],
        size,
        "left",
      );
      return "painted";
    },
  },

  // --- Covers (contracts/api.md §6). Pages, but not paper: no ruling, and
  // every colour derived from the backdrop's paperColor (`coverPalette`).
  "cover-plain": { spacing: 40, draw: coverPainter("cover-plain") },
  "cover-label": { spacing: 40, draw: coverPainter("cover-label") },
  "cover-band": { spacing: 40, draw: coverPainter("cover-band") },
  "cover-linen": { spacing: 40, draw: coverPainter("cover-linen") },
};

/**
 * One cover design. The cloth is already filled with `paperColor`. Drawn in
 * page space and deterministic, because tiles repaint a page piecemeal and a
 * random texture would show seams between them.
 */
function coverPainter(kind: CoverRuling): RulingPainter {
  return (ctx, c) => {
    const palette = coverPalette(c.paper);
    const layout = coverLayout(kind, c.geometry);
    if (kind === "cover-linen") weave(ctx, c, palette);
    vignette(ctx, c, palette);
    if (kind === "cover-plain") insetEdge(ctx, c, palette);
    if (kind === "cover-band") spine(ctx, c, palette, layout.band);
    if (layout.plate) labelPlate(ctx, c, palette, layout.plate);
    return "painted";
  };
}

/** Edges a shade darker than the middle, as cloth over board reads. */
function vignette(ctx: CanvasRenderingContext2D, c: RulingContext, p: CoverPalette): void {
  const { width, height } = c.geometry;
  const outer = Math.hypot(width, height) / 2;
  const gradient = ctx.createRadialGradient(
    width / 2,
    height / 2,
    outer * 0.45,
    width / 2,
    height / 2,
    outer,
  );
  gradient.addColorStop(0, withAlpha(p.shade, 0));
  gradient.addColorStop(1, withAlpha(p.shade, 0.32));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

/** The plain design's pressed border, a hairline set in from the edge. */
function insetEdge(ctx: CanvasRenderingContext2D, c: RulingContext, p: CoverPalette): void {
  const { width, height } = c.geometry;
  const inset = Math.round(Math.min(width, height) * 0.035);
  ctx.beginPath();
  ctx.rect(inset + 0.5, inset + 0.5, width - inset * 2 - 1, height - inset * 2 - 1);
  ctx.strokeStyle = p.edge;
  ctx.lineWidth = 1.5 * c.weight;
  ctx.stroke();
}

/** A darker spine band down the left edge, with a stitched line along it. */
function spine(
  ctx: CanvasRenderingContext2D,
  c: RulingContext,
  p: CoverPalette,
  band: number,
): void {
  const { height } = c.geometry;
  ctx.fillStyle = p.band;
  ctx.fillRect(0, 0, band, height);
  ctx.beginPath();
  vLine(ctx, band, 0, height);
  ctx.strokeStyle = p.bandEdge;
  ctx.lineWidth = 2 * c.weight;
  ctx.stroke();
  const dash = Math.max(8, 5 * c.weight);
  ctx.beginPath();
  vLine(ctx, band * 0.72, band * 0.4, height - band * 0.4);
  ctx.setLineDash([dash * 1.5, dash]);
  ctx.strokeStyle = p.stitch;
  ctx.lineWidth = 1.5 * c.weight;
  ctx.stroke();
  ctx.setLineDash([]);
}

/** The label plate: lighter, rounded, bordered, with a fine inner rule. */
function labelPlate(
  ctx: CanvasRenderingContext2D,
  c: RulingContext,
  p: CoverPalette,
  plate: CoverRect & { r: number },
): void {
  roundedRect(ctx, plate, plate.r);
  ctx.fillStyle = p.label;
  ctx.fill();
  ctx.strokeStyle = p.labelEdge;
  ctx.lineWidth = 2 * c.weight;
  ctx.stroke();
  const inset = Math.min(plate.w, plate.h) * 0.07;
  roundedRect(
    ctx,
    { x: plate.x + inset, y: plate.y + inset, w: plate.w - inset * 2, h: plate.h - inset * 2 },
    Math.max(0, plate.r - inset / 2),
  );
  ctx.lineWidth = c.weight;
  ctx.stroke();
}

/** Begin a new path holding one rounded rectangle. `arcTo`, not `roundRect`: iPadOS 15 lacks it. */
function roundedRect(ctx: CanvasRenderingContext2D, r: CoverRect, radius: number): void {
  const k = Math.max(0, Math.min(radius, r.w / 2, r.h / 2));
  ctx.beginPath();
  ctx.moveTo(r.x + k, r.y);
  ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, k);
  ctx.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, k);
  ctx.arcTo(r.x, r.y + r.h, r.x, r.y, k);
  ctx.arcTo(r.x, r.y, r.x + r.w, r.y, k);
  ctx.closePath();
}

/**
 * Linen: fine warp and weft threads a shade lighter and darker than the
 * cloth. Which threads show is a hash of their index, so the weave is
 * irregular and yet identical on every repaint. In a small preview the
 * threads spread out with the line weight rather than merging into a tint.
 */
function weave(ctx: CanvasRenderingContext2D, c: RulingContext, p: CoverPalette): void {
  const { width, height } = c.geometry;
  const pitch = Math.max(4, 3 * c.weight);
  ctx.lineWidth = c.weight;
  const shades: Array<[string, number]> = [
    [p.threadLight, 0],
    [p.threadDark, 1],
  ];
  for (const [color, pick] of shades) {
    ctx.beginPath();
    let i = 0;
    for (let x = pitch / 2; x < width; x += pitch, i++) {
      if (threadShade(i, 0x51) === pick) vLine(ctx, x, 0, height);
    }
    i = 0;
    for (let y = pitch / 2; y < height; y += pitch, i++) {
      if (threadShade(i, 0xa7) === pick) hLine(ctx, 0, width, y);
    }
    ctx.strokeStyle = color;
    ctx.stroke();
  }
}

/** 0 (light), 1 (dark) or 2 (not drawn) for thread `i`: a fixed hash, never `Math.random`. */
function threadShade(i: number, seed: number): number {
  let h = Math.imul(i ^ seed, 0x9e3779b1) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  return (h >>> 13) % 3;
}

const WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

/** One full-pixel horizontal rule from `x0` to `x1`. */
function hLine(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number): void {
  const py = crisp(y);
  ctx.moveTo(x0, py);
  ctx.lineTo(x1, py);
}

/** One full-pixel vertical rule from `y0` to `y1`. */
function vLine(ctx: CanvasRenderingContext2D, x: number, y0: number, y1: number): void {
  const px = crisp(x);
  ctx.moveTo(px, y0);
  ctx.lineTo(px, y1);
}

/**
 * Staves of `lines` rules, `c.spacing` apart, separated by `gap`, each closed
 * by a bar line at both ends. Returns each staff's top y.
 */
function staves(
  ctx: CanvasRenderingContext2D,
  c: RulingContext,
  lines: number,
  gap: number,
): number[] {
  const { width, height } = c.geometry;
  const margin = width * 0.06;
  const staff = c.spacing * (lines - 1);
  const tops: number[] = [];
  for (let y = margin * 1.5; y + staff < height - margin; y += staff + gap) {
    for (let i = 0; i < lines; i++) hLine(ctx, margin, width - margin, y + i * c.spacing);
    vLine(ctx, margin, y, y + staff);
    vLine(ctx, width - margin, y, y + staff);
    tops.push(y);
  }
  return tops;
}

/**
 * Printed labels on a planner page (weekday names, the TAB clef), in the
 * theme's marker colour. A real font stack: canvas `font` does not resolve
 * CSS variables.
 */
function paintLabels(
  ctx: CanvasRenderingContext2D,
  c: RulingContext,
  labels: readonly { text: string; x: number; y: number }[],
  size: number,
  align: CanvasTextAlign,
): void {
  ctx.save();
  ctx.fillStyle = c.theme.marker;
  ctx.font = `600 ${Math.round(size)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textBaseline = "top";
  ctx.textAlign = align;
  for (const label of labels) ctx.fillText(label.text, label.x, label.y);
  ctx.restore();
}

/** Ruling entry, or the plain-rules fallback for a ruling we do not know. */
function rulingEntry(ruling: Ruling): { spacing: number; draw: RulingPainter } {
  // Own-property check: `RULINGS["toString"]` returns the inherited function,
  // which is truthy, so `??` never fired and the caller threw
  // "entry.draw is not a function". Contract §4 says an unresolvable backdrop
  // degrades, never throws.
  const entry = Object.prototype.hasOwnProperty.call(RULINGS, ruling) ? RULINGS[ruling] : undefined;
  return entry ?? { spacing: DEFAULT_SPACING, draw: horizontalRules };
}

/**
 * Draw a synthetic backdrop's ruling on top of the already-filled paper.
 * `blank` draws nothing, by design.
 *
 * One beginPath/stroke pair for the whole page: a ruled page carries ~50 rules
 * and this runs on every scroll frame on an iPad.
 */
export function drawSyntheticRules(
  ctx: CanvasRenderingContext2D,
  backdrop: SyntheticBackdrop,
  geometry: PageGeometry,
  theme: PaperTheme,
  weight = 1,
): void {
  const paper = backdrop;
  const entry = rulingEntry(paper.kind);
  const spacing = resolveSpacing(paper.spacing, paper.kind);
  // A heavy preview weight must not fill the gaps of a dense ruling (music
  // staves are 12 px apart): keep a line under a quarter of its pitch.
  const requested = Number.isFinite(weight) && weight > 0 ? weight : 1;
  const context: RulingContext = {
    geometry,
    spacing,
    color: paper.color ?? theme.rule,
    weight: Math.max(1, Math.min(requested, spacing / 4)),
    theme,
    paper: paper.paperColor ?? theme.paper,
  };

  ctx.save();
  ctx.strokeStyle = context.color;
  ctx.fillStyle = context.color;
  ctx.lineWidth = RULE_WIDTH * context.weight;
  ctx.beginPath();
  if (entry.draw(ctx, context) !== "painted") ctx.stroke();
  ctx.restore();
}

/**
 * Paper + ruling in one call. `weight` thickens rules and dots for a small
 * preview, where a 1 page-px rule would shrink below a device pixel and vanish.
 */
export function drawSynthetic(
  ctx: CanvasRenderingContext2D,
  backdrop: SyntheticBackdrop,
  geometry: PageGeometry,
  theme: PaperTheme,
  weight = 1,
): void {
  fillPaper(ctx, geometry, theme, backdrop.paperColor);
  drawSyntheticRules(ctx, backdrop, geometry, theme, weight);
}

/**
 * Placeholder drawn when a PDF backdrop cannot be resolved (file missing,
 * page index out of range, pdf.js unavailable).
 *
 * The page is still a page and **the ink is still drawn on top** — losing a
 * user's annotations because a backdrop failed to resolve is never acceptable
 * (contracts/api.md §4).
 */
export function drawMissingSource(
  ctx: CanvasRenderingContext2D,
  geometry: PageGeometry,
  theme: PaperTheme,
  label: string,
): void {
  fillPaper(ctx, geometry, theme);

  const pad = 24;
  const boxH = 34;
  const boxW = Math.min(geometry.width - pad * 2, 520);

  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = theme.marker;
  ctx.globalAlpha = 0.12;
  ctx.fillRect(pad, pad, boxW, boxH);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = theme.marker;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(pad + 0.5, pad + 0.5, boxW, boxH);
  ctx.setLineDash([]);
  ctx.fillStyle = theme.marker;
  // Canvas `font` is a CSS font shorthand string, not a style declaration:
  // `var(--…)` does not resolve here, so name real families.
  ctx.font = '16px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.textBaseline = "middle";
  // Canvas has no text clipping; keep the label inside the marker box.
  ctx.save();
  ctx.beginPath();
  ctx.rect(pad, pad, boxW, boxH);
  ctx.clip();
  ctx.fillText(label, pad + 12, pad + boxH / 2);
  ctx.restore();
  ctx.restore();
}

/**
 * A {@link BackdropRenderer} that can only do synthetic paper. A `pdf` backdrop
 * falls back to the "missing source" placeholder, which is the honest result
 * when there is no vault to read the file from (inline embeds, tests).
 */
export class SyntheticBackdropRenderer implements BackdropRenderer {
  constructor(private theme: PaperTheme = LIGHT_PAPER) {}

  setTheme(theme: PaperTheme): void {
    this.theme = theme;
  }

  draw(ctx: CanvasRenderingContext2D, backdrop: Backdrop, geometry: PageGeometry): Promise<void> {
    if (backdrop.kind === "pdf") {
      drawMissingSource(ctx, geometry, this.theme, `PDF backdrop unavailable — ${backdrop.path}`);
    } else {
      drawSynthetic(ctx, backdrop, geometry, this.theme);
    }
    return Promise.resolve();
  }
}
