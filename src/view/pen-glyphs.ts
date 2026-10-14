/**
 * The pen pill's glyphs: an outline icon for each pen type, and the width
 * buttons drawn as a stroke in that pen's own character (the fountain pen
 * tapers at both ends, the ballpoint is even, the brush starts full and
 * thins, the highlighter is a flat band), so the widths read as what the
 * pen will write.
 *
 * PURE: shapes as SVG data; the toolbar makes the elements.
 */

/** The pen types a glyph exists for (`PenTypeSpec.id`). */
export type GlyphPen = "fountain" | "ball" | "brush" | "highlighter";

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
        path("M9.8 1.5h4.4v12H9.8z"),
        // The clip.
        path("M14.2 3h1.3v6.5"),
        path("M9.8 13.5h4.4l-1.4 6h-1.6z"),
        {
          tag: "circle",
          attrs: { cx: "12", cy: "21.3", r: "1.1", transform: TILT, stroke: "none" },
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
        // The grip, then the nib with its breather hole and slit in ink.
        path("M9.6 9h4.8v2.4H9.6z"),
        path(
          "M12 22.5c-1.9-3.8-3-6.6-3-8.9 0-.9.3-1.6.8-2.2h4.4c.5.6.8 1.3.8 2.2 0 2.3-1.1 5.1-3 8.9z",
        ),
        {
          tag: "circle",
          attrs: { cx: "12", cy: "14.8", r: "0.9", transform: TILT, stroke: "none" },
          ink: true,
          fill: true,
        },
        path("M12 16.3v6", { ink: true }),
      ];
  }
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

/** The thickest a glyph's stroke gets, in glyph px, so the heaviest still fits. */
const MAX_THICKNESS = 8;
/** Points along the stroke for a tapered outline. */
const SAMPLES = 20;

/** A pen width (page px) as the glyph's thickness, in glyph px. */
export function glyphThickness(size: number): number {
  return Math.max(1.5, Math.min(MAX_THICKNESS, Number.isFinite(size) ? size : 1.5));
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

/** The width button for `size` (page px) with pen `pen`. */
export function swoosh(pen: string, size: number): Swoosh {
  const thick = glyphThickness(size);
  // The highlighter's band is a little heavier there: it is drawn wide.
  if (pen === "highlighter") {
    return penStroke(pen, SWOOSH_CURVE, Math.min(MAX_THICKNESS + 2, thick + 2), 0.55);
  }
  return penStroke(pen, SWOOSH_CURVE, thick, 0.55);
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
