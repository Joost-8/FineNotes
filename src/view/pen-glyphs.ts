/**
 * The pen pill's glyphs: an outline icon for each pen type, and the width
 * buttons drawn as a stroke in that pen's own character (the fountain pen
 * tapers at both ends, the ballpoint is even, the brush starts full and
 * thins, the highlighter is a flat band), so the widths read as what the
 * pen will write.
 *
 * PURE: shapes as SVG data; the toolbar makes the elements.
 */

import { relativeLuminance } from "../model/cover";

/** The pen types a glyph exists for (`PenTypeSpec.id`). */
export type GlyphPen = "fountain" | "ball" | "brush" | "calligraphy" | "highlighter";

/**
 * One SVG element of a glyph. `ink`: painted in the pen's ink colour, not the
 * icon's. An `attrs.stroke` of "none" keeps a filled part unoutlined.
 */
export interface GlyphPart {
  tag: "path" | "circle";
  attrs: Record<string, string>;
  ink?: boolean;
  /** Filled rather than outlined. */
  fill?: boolean;
}

/** The pen icons' view box: 24 × 24, outlined at 1.6 like the rest of the bar. */
export const PEN_ICON_BOX = 24;

/**
 * The pens lean 45° like a pen in the hand, tip at the lower left. Each is
 * drawn upright (tip down) and turned about the box's centre.
 */
const TILT = "rotate(45 12 12)";

const path = (d: string, extra: Partial<GlyphPart> = {}): GlyphPart => ({
  tag: "path",
  attrs: { d, transform: TILT },
  ...extra,
});

/** A tip filled with ink, unoutlined so it keeps its drawn size. */
const inkFill = (d: string): GlyphPart => ({
  tag: "path",
  attrs: { d, transform: TILT, stroke: "none" },
  ink: true,
  fill: true,
});

/** Each pen type's outline icon, its tip in ink. Unknown types get the fountain pen's. */
export function penIconParts(pen: string): GlyphPart[] {
  switch (pen) {
    case "ball":
      return [
        path("M9.8 1.5h4.4v11H9.8z"),
        // The clip.
        path("M14.2 3h1.3v6.5"),
        // The cone in ink, then the ball.
        inkFill("M9.4 12.5h5.2l-1.8 7.4h-1.6z"),
        {
          tag: "circle",
          attrs: { cx: "12", cy: "21.4", r: "1.2", transform: TILT, stroke: "none" },
          ink: true,
          fill: true,
        },
      ];
    case "brush":
      return [
        path("M10.6 1.5h2.8l.4 9h-3.6z"),
        // The ferrule, then the bristles.
        path("M9.6 10.5h4.8v3H9.6z"),
        inkFill("M9.6 13.5h4.8c0 3.6-1.4 6.2-2.4 9-1-2.8-2.4-5.4-2.4-9z"),
      ];
    case "calligraphy":
      return [
        // The holder, then the broad, square-cut nib.
        path("M10.6 1.5h2.8v9.5h-2.8z"),
        path("M9.8 11h4.4v2.5H9.8z"),
        inkFill("M9.2 13.5h5.6l-.4 6.5-4.8 2z"),
      ];
    case "highlighter":
      return [
        path("M8.5 1.5h7v10h-7z"),
        path("M9.2 11.5h5.6l-.6 3H9.8z"),
        // The chisel tip.
        inkFill("M9.8 14.5h4.4v3.2l-4.4 3.3z"),
      ];
    default:
      return [
        path("M10.2 1.5h3.6v7.5h-3.6z"),
        // The grip, then the nib in ink, its breather hole and slit in the icon's colour.
        path("M9.6 9h4.8v2.4H9.6z"),
        inkFill(
          "M12 22.5c-1.9-3.8-3-6.6-3-8.9 0-.9.3-1.6.8-2.2h4.4c.5.6.8 1.3.8 2.2 0 2.3-1.1 5.1-3 8.9z",
        ),
        {
          tag: "circle",
          attrs: { cx: "12", cy: "14.8", r: "0.75", transform: TILT, stroke: "none" },
          fill: true,
        },
        { tag: "path", attrs: { d: "M12 16.3v3.8", transform: TILT, "stroke-width": "0.9" } },
      ];
  }
}

/**
 * Whether ink of this colour would vanish into the bar behind it (black ink
 * on a dark theme, white or pale yellow on a light one). Its parts then get
 * a rim in the icon's own colour, so the pen's shape still reads.
 */
export function inkNeedsRim(ink: string, darkTheme: boolean): boolean {
  const luminance = relativeLuminance(ink);
  return darkTheme ? luminance < 0.06 : luminance > 0.75;
}

/** The width glyphs' view box. */
export const SWOOSH_WIDTH = 30;
export const SWOOSH_HEIGHT = 24;

/** A width button's stroke: a filled outline, or a path stroked at one width. */
export interface Swoosh {
  d: string;
  /** Stroked at this width (ballpoint, highlighter); absent for a filled outline. */
  strokeWidth?: number;
  cap?: "round" | "butt";
  opacity?: number;
}

/** Points along the stroke for a tapered outline. */
const SAMPLES = 20;

/** The thinnest a width mark is drawn, glyph px: below it a line is not there at all. */
const MIN_THICKNESS = 0.25;

/**
 * A width mark's thickness, glyph px (one is a screen px): the stroke's own
 * width on screen, so the mark is the line it writes. Past the glyph's
 * height it fills the glyph, which is as thick as it can show.
 */
export function glyphThickness(screenPx: number): number {
  if (!Number.isFinite(screenPx)) return 1.5;
  return Math.max(MIN_THICKNESS, Math.min(SWOOSH_HEIGHT, screenPx));
}

/** A cubic Bézier: start, two control points, end. */
type Curve = readonly [readonly number[], readonly number[], readonly number[], readonly number[]];

/** The swoosh's centre line: a cubic from lower left to upper right. */
const SWOOSH_CURVE: Curve = [
  [4, 19],
  [11, 19],
  [18, 8],
  [26, 5],
];

function at(curve: Curve, t: number): { x: number; y: number; dx: number; dy: number } {
  const [P0, P1, P2, P3] = curve;
  const u = 1 - t;
  const x = u * u * u * P0[0] + 3 * u * u * t * P1[0] + 3 * u * t * t * P2[0] + t * t * t * P3[0];
  const y = u * u * u * P0[1] + 3 * u * u * t * P1[1] + 3 * u * t * t * P2[1] + t * t * t * P3[1];
  const dx =
    3 * u * u * (P1[0] - P0[0]) + 6 * u * t * (P2[0] - P1[0]) + 3 * t * t * (P3[0] - P2[0]);
  const dy =
    3 * u * u * (P1[1] - P0[1]) + 6 * u * t * (P2[1] - P1[1]) + 3 * t * t * (P3[1] - P2[1]);
  return { x, y, dx, dy };
}

const n = (value: number): string => String(Math.round(value * 100) / 100);

/** A curve as an SVG path. */
function centre(curve: Curve): string {
  const [P0, P1, P2, P3] = curve.map((p) => `${n(p[0])} ${n(p[1])}`);
  return `M${P0}C${P1} ${P2} ${P3}`;
}

/** A filled outline around `curve`, `half(t)` wide on each side. */
function outline(curve: Curve, half: (t: number) => number): string {
  const left: string[] = [];
  const right: string[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const p = at(curve, t);
    const length = Math.hypot(p.dx, p.dy) || 1;
    const nx = -p.dy / length;
    const ny = p.dx / length;
    const w = half(t);
    left.push(`${n(p.x + nx * w)} ${n(p.y + ny * w)}`);
    right.push(`${n(p.x - nx * w)} ${n(p.y - ny * w)}`);
  }
  return `M${left.join("L")}L${right.reverse().join("L")}Z`;
}

/**
 * Each pen's thickness along a stroke, as a share of its full width at `t`
 * from 0 (pen down) to 1 (pen up). Null: one even width (the ballpoint and
 * the highlighter).
 */
function profile(pen: string): ((t: number) => number) | null {
  switch (pen) {
    case "ball":
    case "highlighter":
      return null;
    case "calligraphy":
      // A flat nib on a curve: thick across it, thin along it, twice over.
      return (t) => 0.2 + 0.8 * Math.abs(Math.sin(Math.PI * 2 * t + 0.6));
    case "brush":
      // Pressed down at the start, lifting off to a point.
      return (t) => (t < 0.12 ? 0.6 + (0.4 * t) / 0.12 : 1 - (0.9 * (t - 0.12)) / 0.88);
    default:
      // A fountain pen's swell: fine at both ends, full in the middle.
      return (t) => 0.2 + 0.8 * Math.sin(Math.PI * t);
  }
}

/** A stroke along `curve` in `pen`'s character, `thick` at its fullest. */
function penStroke(pen: string, curve: Curve, thick: number, highlighterOpacity: number): Swoosh {
  // The highlighter: a flat, translucent band.
  if (pen === "highlighter") {
    return { d: centre(curve), strokeWidth: thick, cap: "butt", opacity: highlighterOpacity };
  }
  const shape = profile(pen);
  if (!shape) return { d: centre(curve), strokeWidth: thick, cap: "round" };
  return { d: outline(curve, (t) => (thick / 2) * shape(t)) };
}

/** The highlighter's width mark: a level band across the glyph, as a highlight lies. */
const HIGHLIGHT_BAND = `M3 ${SWOOSH_HEIGHT / 2}H${SWOOSH_WIDTH - 3}`;

/** The width button for a stroke `thickness` screen px wide, with pen `pen`. */
export function swoosh(pen: string, thickness: number): Swoosh {
  // A highlight is wide: a level band shows its height whole up to the
  // glyph's, where a slanted one would be cut at its corners.
  if (pen === "highlighter") {
    return {
      d: HIGHLIGHT_BAND,
      strokeWidth: glyphThickness(thickness),
      cap: "butt",
      opacity: 0.55,
    };
  }
  return penStroke(pen, SWOOSH_CURVE, glyphThickness(thickness), 0.55);
}

/** How opaque the size preview draws the highlighter: the page's default. */
export const PREVIEW_HIGHLIGHTER_OPACITY = 0.4;

/**
 * The size preview's sample stroke: a wave across a `width` × `height` box
 * (screen px) in `pen`'s character, `thickness` screen px at its fullest,
 * the width it lays down on the page now. It stays inside the box while it
 * fits; a stroke thicker than the box is cut by it, which still reads as thick.
 */
export function sampleStroke(
  pen: string,
  thickness: number,
  width: number,
  height: number,
): Swoosh {
  const thick = Number.isFinite(thickness) && thickness > 0 ? thickness : 1;
  // Room for the caps at either end, and for the stroke above and below.
  const padX = Math.min(width / 4, thick / 2 + 10);
  const padY = Math.min(height / 2 - 1, thick / 2 + 3);
  const left = padX;
  const span = width - 2 * padX;
  const top = padY;
  const rise = height - 2 * padY;
  const curve: Curve = [
    [left, top + rise * 0.75],
    [left + span * 0.35, top - rise * 0.35],
    [left + span * 0.65, top + rise * 1.35],
    [left + span, top + rise * 0.25],
  ];
  return penStroke(pen, curve, thick, PREVIEW_HIGHLIGHTER_OPACITY);
}

/** The tool bar's width mark: thinnest and thickest, in screen px. */
const MARK_MIN = 1;
const MARK_MAX = 5;

/**
 * How thick the tool bar's pen button draws its width mark, in screen px,
 * for a stroke `width` page px wide (`strokeWidthFor`, so the highlighter's
 * fat nib reads fat). A square root, so the thin pens that are used most
 * stay apart while a highlighter still fits under a 24 px icon.
 */
export function widthMarkThickness(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return MARK_MIN;
  const px = 1.2 * Math.sqrt(width);
  return Math.round(Math.min(MARK_MAX, Math.max(MARK_MIN, px)) * 10) / 10;
}
