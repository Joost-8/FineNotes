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

/** One SVG element of a glyph. `ink`: painted in the pen's ink colour, not the icon's. */
export interface GlyphPart {
  tag: "path" | "circle";
  attrs: Record<string, string>;
  ink?: boolean;
  /** Filled rather than outlined. */
  fill?: boolean;
}

/** The pen icons' view box: 24 × 24, outlined at 1.6 like the rest of the bar. */
export const PEN_ICON_BOX = 24;

/** Each pen type's outline icon, its tip in ink. Unknown types get the fountain pen's. */
export function penIconParts(pen: string): GlyphPart[] {
  switch (pen) {
    case "ball":
      return [
        { tag: "path", attrs: { d: "M9 3h6v9l-3 7-3-7z" } },
        { tag: "path", attrs: { d: "M9 12h6" } },
        { tag: "circle", attrs: { cx: "12", cy: "21", r: "1.3" }, ink: true, fill: true },
      ];
    case "brush":
      return [
        { tag: "path", attrs: { d: "M9 3h6v7H9z" } },
        { tag: "path", attrs: { d: "M9 10c0 5 2 8 3 11 1-3 3-6 3-11z" }, ink: true, fill: true },
      ];
    case "highlighter":
      return [
        { tag: "path", attrs: { d: "M7 3h10v9H7z" } },
        { tag: "path", attrs: { d: "M7 12h10l-2 6H9z" } },
        { tag: "path", attrs: { d: "M8 21h8", "stroke-width": "2.4" }, ink: true },
      ];
    default:
      return [
        { tag: "path", attrs: { d: "M12 3c3 4 5 7 5 10l-5 8-5-8c0-3 2-6 5-10z" } },
        { tag: "path", attrs: { d: "M12 14v7" }, ink: true },
        { tag: "circle", attrs: { cx: "12", cy: "12", r: "1.2" } },
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

/** The swoosh's centre line: a cubic from lower left to upper right. */
const P0 = [4, 19];
const P1 = [11, 19];
const P2 = [18, 8];
const P3 = [26, 5];

function at(t: number): { x: number; y: number; dx: number; dy: number } {
  const u = 1 - t;
  const x = u * u * u * P0[0] + 3 * u * u * t * P1[0] + 3 * u * t * t * P2[0] + t * t * t * P3[0];
  const y = u * u * u * P0[1] + 3 * u * u * t * P1[1] + 3 * u * t * t * P2[1] + t * t * t * P3[1];
  const dx =
    3 * u * u * (P1[0] - P0[0]) + 6 * u * t * (P2[0] - P1[0]) + 3 * t * t * (P3[0] - P2[0]);
  const dy =
    3 * u * u * (P1[1] - P0[1]) + 6 * u * t * (P2[1] - P1[1]) + 3 * t * t * (P3[1] - P2[1]);
  return { x, y, dx, dy };
}

const CENTRE = `M${P0.join(" ")}C${P1.join(" ")} ${P2.join(" ")} ${P3.join(" ")}`;

const n = (value: number): string => String(Math.round(value * 100) / 100);

/** A filled outline around the centre line, `half(t)` wide on each side. */
function outline(half: (t: number) => number): string {
  const left: string[] = [];
  const right: string[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const p = at(t);
    const length = Math.hypot(p.dx, p.dy) || 1;
    const nx = -p.dy / length;
    const ny = p.dx / length;
    const w = half(t);
    left.push(`${n(p.x + nx * w)} ${n(p.y + ny * w)}`);
    right.push(`${n(p.x - nx * w)} ${n(p.y - ny * w)}`);
  }
  return `M${left.join("L")}L${right.reverse().join("L")}Z`;
}

/** The width button for `size` (page px) with pen `pen`. */
export function swoosh(pen: string, size: number): Swoosh {
  const thick = glyphThickness(size);
  switch (pen) {
    case "ball":
      return { d: CENTRE, strokeWidth: thick, cap: "round" };
    case "highlighter":
      // A flat, translucent band, a little heavier: it is drawn wide.
      return {
        d: CENTRE,
        strokeWidth: Math.min(MAX_THICKNESS + 2, thick + 2),
        cap: "butt",
        opacity: 0.55,
      };
    case "brush":
      // Pressed down at the start, lifting off to a point.
      return {
        d: outline(
          (t) => (thick / 2) * (t < 0.12 ? 0.6 + (0.4 * t) / 0.12 : 1 - (0.9 * (t - 0.12)) / 0.88),
        ),
      };
    default:
      // A fountain pen's swell: fine at both ends, full in the middle.
      return { d: outline((t) => (thick / 2) * (0.2 + 0.8 * Math.sin(Math.PI * t))) };
  }
}
