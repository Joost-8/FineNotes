/**
 * Notebook covers (contracts/api.md §6): the colours a cover design derives
 * from its one stored colour, where each design puts its label and title, and
 * the title text box a new notebook's cover carries.
 *
 * A cover stores nothing but its design (the ruling) and `paperColor`. Every
 * other colour on it — the label plate, the spine band, the stitching, the
 * linen threads, the patterns, the vignette and the title ink — is derived here, so a cover
 * can never carry a label that has drifted out of step with its cloth, and
 * the painter (`src/canvas/backdrop.ts`) and the notebook builder agree on
 * one layout. Pure: no DOM, no Obsidian.
 */

import type {
  CoverRuling,
  PageGeometry,
  SyntheticBackdrop,
  TextAlign,
  TextBoxElement,
  TextFont,
} from "./document";

// --- Colour -----------------------------------------------------------------

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * Parse `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` (alpha ignored). Anything
 * else — a CSS colour name, `rgb(…)`, a typo — is `null`: a cover colour
 * comes from a document, and a guess would paint a colour nobody chose.
 */
export function parseHexColor(value: string | undefined): Rgb | null {
  if (typeof value !== "string") return null;
  const match = HEX.exec(value.trim());
  if (!match) return null;
  let hex = match[1];
  if (hex.length <= 4) hex = [...hex].map((ch) => ch + ch).join("");
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

function channel(v: number): string {
  return Math.max(0, Math.min(255, Math.round(v)))
    .toString(16)
    .padStart(2, "0");
}

/** `#rrggbb`, channels rounded and clamped. */
export function toHexColor(rgb: Rgb): string {
  return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`;
}

/** Fallback for an unreadable colour: white paper, which every theme starts from. */
const FALLBACK: Rgb = { r: 255, g: 255, b: 255 };

function rgbOf(color: string): Rgb {
  return parseHexColor(color) ?? FALLBACK;
}

/** Linear blend from `a` (t = 0) to `b` (t = 1), in sRGB. `t` is clamped. */
export function mixColors(a: string, b: string, t: number): string {
  const k = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0;
  const x = rgbOf(a);
  const y = rgbOf(b);
  return toHexColor({
    r: x.r + (y.r - x.r) * k,
    g: x.g + (y.g - x.g) * k,
    b: x.b + (y.b - x.b) * k,
  });
}

/** Toward white by `t`. */
export function lighten(color: string, t: number): string {
  return mixColors(color, "#ffffff", t);
}

/** Toward black by `t`. */
export function darken(color: string, t: number): string {
  return mixColors(color, "#000000", t);
}

/** `rgba(r, g, b, a)` for a hex colour: canvas gradients need the alpha inline. */
export function withAlpha(color: string, alpha: number): string {
  const { r, g, b } = rgbOf(color);
  const a = Math.max(0, Math.min(1, Number.isFinite(alpha) ? alpha : 1));
  return `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})`;
}

/** WCAG 2 relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(color: string): number {
  const { r, g, b } = rgbOf(color);
  const lin = (v: number): number => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2 contrast ratio, 1 to 21. Symmetric. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Whether white reads better on `color` than black does. */
export function isDarkColor(color: string): boolean {
  return contrastRatio(color, "#ffffff") > contrastRatio(color, "#000000");
}

/** WCAG AA for body text. A title is large, but it must read in a thumbnail too. */
export const TITLE_MIN_CONTRAST = 4.5;

/** WCAG AAA, which a title reaches wherever the cloth allows. */
const TITLE_GOOD_CONTRAST = 7;

/**
 * An ink that reads on `background`: a pale tint of `tint` on a dark ground,
 * a deep shade of it on a light one — so a title on a label plate of a navy
 * notebook is a deep navy rather than a generic black. It takes the least
 * change of `tint` that reaches AAA contrast, else the least that reaches
 * {@link TITLE_MIN_CONTRAST}; pure white or black reach that on any ground
 * `isDarkColor` sorts them onto.
 */
export function readableOn(background: string, tint: string = background): string {
  const dark = isDarkColor(background);
  const steps = dark ? [0.85, 0.92, 1] : [0.5, 0.6, 0.7, 0.8, 0.9, 1];
  const candidates = steps.map((t) => (dark ? lighten(tint, t) : darken(tint, t)));
  for (const target of [TITLE_GOOD_CONTRAST, TITLE_MIN_CONTRAST]) {
    const found = candidates.find((c) => contrastRatio(c, background) >= target);
    if (found) return found;
  }
  return dark ? "#ffffff" : "#000000";
}

/** Every colour a cover design paints with, derived from its one stored colour. */
export interface CoverPalette {
  /** The cloth: the backdrop's `paperColor`. */
  base: string;
  /** Vignette colour at the edges (painted with alpha). */
  shade: string;
  /** The plain design's inset hairline. */
  edge: string;
  /** The label plate, lighter than the cloth. */
  label: string;
  /** The label plate's border. */
  labelEdge: string;
  /** The spine band, darker than the cloth (lighter, on near-black cloth). */
  band: string;
  /** Where the band meets the cloth. */
  bandEdge: string;
  /** The stitched line down the band. */
  stitch: string;
  /** Linen threads a shade lighter and a shade darker than the cloth. */
  threadLight: string;
  threadDark: string;
  /** Title ink on the cloth. */
  title: string;
  /** Title ink on the label plate. */
  labelTitle: string;
  /** The narrow book spine every current design draws, and the lighter line beside it. */
  spine: string;
  spineEdge: string;
  /** Soft gradient: its light (top left) and deep (bottom right) ends. */
  sheenLight: string;
  sheenDark: string;
  /** Orb: the lit middle and the rim (painted at 90% alpha). */
  orbCore: string;
  orbRim: string;
  /** Duotone split: the lower part. */
  splitLower: string;
  /** Contour lines. */
  contour: string;
  /** Glass label: the ground, three blob tints, the frosted plate and its edge (with alpha). */
  glassGround: string;
  glassHigh: string;
  glassMid: string;
  glassLow: string;
  glassPlate: string;
  glassEdge: string;
  /** Big type: the oversized letter, a tint of the cloth. */
  monogram: string;
  /** Accent stripe: the bar and the dot grid. */
  accent: string;
  accentDot: string;
}

/** Below this luminance there is no darker to go: the band turns lighter. */
const NEAR_BLACK = 0.02;

/** Above this luminance a tint goes darker than the cloth instead of lighter. */
const LIGHT_CLOTH = 0.33;

/** Above this luminance (ivory, blush) a lighter shape barely shows: go darker. */
const PALE_CLOTH = 0.6;

/** Below this luminance (ink, charcoal) shapes need a little more lift to show. */
const DEEP_CLOTH = 0.03;

export function coverPalette(paperColor: string | undefined): CoverPalette {
  const base = toHexColor(parseHexColor(paperColor) ?? FALLBACK);
  const dark = isDarkColor(base);
  const label = lighten(base, dark ? 0.84 : 0.72);
  const band = relativeLuminance(base) < NEAR_BLACK ? lighten(base, 0.16) : darken(base, 0.3);
  const lum = relativeLuminance(base);
  const light = lum > LIGHT_CLOTH;
  const pale = lum > PALE_CLOTH;
  const deep = lum < DEEP_CLOTH;
  /** A tint that reads on the cloth: deeper on light cloth, lighter on dark. */
  const tint = (t: number): string => (light ? darken(base, t * 0.7) : lighten(base, t));
  return {
    base,
    shade: darken(base, 0.65),
    edge: dark ? lighten(base, 0.22) : darken(base, 0.18),
    label,
    labelEdge: mixColors(label, base, 0.45),
    band,
    bandEdge: darken(band, 0.35),
    stitch: mixColors(band, readableOn(band), 0.6),
    threadLight: lighten(base, 0.12),
    threadDark: darken(base, 0.12),
    title: readableOn(base),
    labelTitle: readableOn(label, base),
    spine: lum < NEAR_BLACK ? lighten(base, 0.12) : darken(base, 0.18),
    spineEdge: lighten(base, 0.12),
    sheenLight: lighten(base, pale ? 0.25 : deep ? 0.16 : 0.22),
    sheenDark: darken(base, pale ? 0.14 : deep ? 0.05 : 0.28),
    orbCore: pale ? darken(base, 0.1) : lighten(base, light ? 0.4 : deep ? 0.2 : 0.35),
    orbRim: pale ? darken(base, 0.03) : lighten(base, light ? 0.1 : 0.07),
    splitLower: light ? darken(base, 0.14) : deep ? lighten(base, 0.07) : darken(base, 0.16),
    // The mock-up drew these at 60% opacity; mixing toward the cloth keeps the look opaque.
    contour: mixColors(tint(deep ? 0.22 : 0.3), base, 0.4),
    glassGround: darken(base, 0.08),
    glassHigh: lighten(base, deep ? 0.28 : 0.32),
    glassMid: lighten(base, deep ? 0.14 : 0.12),
    glassLow: darken(base, pale ? 0.22 : 0.28),
    glassPlate: withAlpha("#ffffff", light ? 0.38 : 0.16),
    glassEdge: withAlpha("#ffffff", 0.35),
    monogram: tint(deep ? 0.1 : 0.12),
    accent: light ? darken(base, 0.55) : lighten(base, 0.7),
    accentDot: tint(0.4),
  };
}

// --- Layout -----------------------------------------------------------------

export interface CoverRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CoverLayout {
  /** Width of the spine band down the left edge (`cover-band`); 0 elsewhere. */
  band: number;
  /** The label plate (`cover-label`, `cover-glass`); `null` elsewhere. `r` is its corner radius. */
  plate: (CoverRect & { r: number }) | null;
  /** Where the title sits: its horizontal span and the vertical centre of its first line. */
  title: { x: number; w: number; cy: number };
  /** How the title is set: the classic designs' centred serif, or the current designs' sans. */
  titleStyle: { font: TextFont; align: TextAlign };
}

/** The designs released before 2026-10-07. Still drawn, so older notebooks open as they were. */
const CLASSIC: ReadonlySet<CoverRuling> = new Set<CoverRuling>([
  "cover-plain",
  "cover-label",
  "cover-band",
  "cover-linen",
]);

/** Whether a design is one of the classic (pre-2026-10-07) ones the picker no longer offers. */
export function isClassicCover(kind: CoverRuling): boolean {
  return CLASSIC.has(kind);
}

/** Designs that set the title on a plate rather than on the cloth. */
const PLATED: ReadonlySet<CoverRuling> = new Set<CoverRuling>(["cover-label", "cover-glass"]);

/** Whether a design sets its title on a label plate rather than on the cloth. */
export function coverHasPlate(kind: CoverRuling): boolean {
  return PLATED.has(kind);
}

const CLASSIC_TITLE = { font: "serif", align: "center" } as const;
const SANS_LEFT = { font: "sans", align: "left" } as const;
const SANS_CENTRE = { font: "sans", align: "center" } as const;

/**
 * Where a design puts its plate, band and title, in page px. Every size is a
 * fraction of the page, so a cover works at A6 and at A3, in either
 * orientation. The classic designs share one title line (the label plate's
 * centre); the current ones set it bottom left, on the split's seam, or on
 * the glass plate.
 */
export function coverLayout(kind: CoverRuling, geometry: PageGeometry): CoverLayout {
  const { width, height } = geometry;
  const short = Math.min(width, height);
  if (!CLASSIC.has(kind)) {
    // Clear of the 3.3% spine, the same left margin on every current design.
    const left = width * 0.107;
    const span = width * 0.78;
    if (kind === "cover-glass") {
      const plate = { x: width * 0.137, y: height * 0.36, w: width * 0.727, h: height * 0.228 };
      return {
        band: 0,
        plate: { ...plate, r: short * 0.041 },
        title: { x: plate.x + plate.w * 0.06, w: plate.w * 0.88, cy: plate.y + plate.h / 2 },
        titleStyle: SANS_CENTRE,
      };
    }
    const cy = kind === "cover-split" ? height * 0.585 : height * 0.835;
    return { band: 0, plate: null, title: { x: left, w: span, cy }, titleStyle: SANS_LEFT };
  }
  const band = kind === "cover-band" ? Math.round(short * 0.12) : 0;
  const free = width - band;
  const plateW = Math.min(width * 0.6, free * 0.7);
  const plateH = Math.min(short * 0.2, height * 0.22);
  const plateX = band + (free - plateW) / 2;
  const plateY = height * 0.2;
  const cy = plateY + plateH / 2;
  if (PLATED.has(kind)) {
    return {
      band,
      plate: { x: plateX, y: plateY, w: plateW, h: plateH, r: plateH * 0.12 },
      title: { x: plateX + plateW * 0.06, w: plateW * 0.88, cy },
      titleStyle: CLASSIC_TITLE,
    };
  }
  if (band > 0) {
    const w = free * 0.72;
    return {
      band,
      plate: null,
      title: { x: band + (free - w) / 2, w, cy },
      titleStyle: CLASSIC_TITLE,
    };
  }
  return {
    band,
    plate: null,
    title: { x: width * 0.14, w: width * 0.72, cy },
    titleStyle: CLASSIC_TITLE,
  };
}

// --- The title --------------------------------------------------------------

/** Line height a cover title is laid out with: the text box default. */
const TITLE_LINE_HEIGHT = 1.25;

/** Rough advance of one bold serif character, in ems (Georgia Bold ≈ 0.56). */
const SERIF_BOLD_EM = 0.56;

/**
 * The title's font size: large, but shrunk (down to a floor) so a longer
 * title still fits the design on one line. Past the floor it wraps.
 */
export function coverTitleFontSize(
  title: string,
  areaWidth: number,
  geometry: PageGeometry,
): number {
  const short = Math.min(geometry.width, geometry.height);
  const max = short * 0.062;
  const min = short * 0.034;
  const chars = Math.max(1, Array.from(title.trim()).length);
  const fit = areaWidth / (chars * SERIF_BOLD_EM);
  return Math.round(Math.max(min, Math.min(max, fit)));
}

/** Where a title box of `fontSize` goes on a design: its first line centred on the title line. */
export function coverTitleFrame(
  kind: CoverRuling,
  geometry: PageGeometry,
  fontSize: number,
): { x: number; y: number; w: number } {
  const { title } = coverLayout(kind, geometry);
  return {
    x: Math.round(title.x),
    y: Math.round(title.cy - (fontSize * TITLE_LINE_HEIGHT) / 2),
    w: Math.round(title.w),
  };
}

/** The title ink a cover backdrop calls for: on the plate where the design has one, else on the cloth. */
export function coverTitleColor(backdrop: SyntheticBackdrop): string {
  const palette = coverPalette(backdrop.paperColor);
  // Only the label's plate is opaque; the glass plate lets the cloth through.
  return backdrop.kind === "cover-label" ? palette.labelTitle : palette.title;
}

/**
 * The notebook title as a text box on the cover, so it edits like any other
 * text: large and bold, in an ink chosen for contrast, set as the design asks
 * (centred serif on the classic designs, sans on the current ones).
 */
export function coverTitleBox(
  kind: CoverRuling,
  geometry: PageGeometry,
  paperColor: string,
  title: string,
  id: string,
): TextBoxElement {
  const layout = coverLayout(kind, geometry);
  const fontSize = coverTitleFontSize(title, layout.title.w, geometry);
  return {
    id,
    ...coverTitleFrame(kind, geometry, fontSize),
    text: title,
    color: coverTitleColor({ kind, paperColor }),
    fontSize,
    font: layout.titleStyle.font,
    bold: true,
    align: layout.titleStyle.align,
  };
}

/** The big letter's ink on a big-type cover: a quiet tint of the cloth. */
export function coverMonogramColor(backdrop: SyntheticBackdrop): string {
  return coverPalette(backdrop.paperColor).monogram;
}

/**
 * The big-type design's oversized first letter, as a text box behind the
 * title (the painter cannot know the title, so the letter is text, and the
 * user can change it like any other). `null` for every other design, or a
 * title with no letter to show.
 */
export function coverMonogramBox(
  kind: CoverRuling,
  geometry: PageGeometry,
  paperColor: string,
  title: string,
  id: string,
): TextBoxElement | null {
  if (kind !== "cover-monogram") return null;
  const first = Array.from(title.trim())[0];
  if (!first) return null;
  const { width, height } = geometry;
  return {
    id,
    x: Math.round(width * 0.02),
    y: Math.round(height * 0.03),
    w: Math.round(width * 0.96),
    text: first.toLocaleUpperCase(),
    color: coverMonogramColor({ kind, paperColor }),
    fontSize: Math.round(Math.min(width, height * 0.75) * 0.9),
    font: "sans",
    bold: true,
    align: "left",
  };
}
