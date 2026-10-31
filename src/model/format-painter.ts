/**
 * The format painter, after Word's: the look of some ink, taken from a
 * selection, laid on other ink by tapping or sweeping over it.
 *
 * What it carries is how the ink looks, never where it is or what it says:
 * its colour, width, pen (pen or highlighter, and a calligraphy nib's
 * angle), and for a shape its line style, fill and corners. Not its points,
 * pressure or tilt (how the hand moved), and not a line's arrowheads (what
 * it points at is content, and a stored arrow keeps its head in its points).
 *
 * Painting over a sweep is one {@link PaintStyle}: strokes are painted as
 * the pen reaches them, so the page shows it at once, and the lift turns
 * the lot into one undo step.
 *
 * PURE: no DOM, no Obsidian.
 */

import type { Command } from "./commands";
import { type InkDocument, type Stroke, type Tool, pageById } from "./document";
import {
  type ShapeStyle,
  type StyleFields,
  TINT_ALPHA,
  applyShapeStyle,
  canFill,
  canRound,
  fillOf,
  restoreStyleFields,
  splitFill,
  styleFieldsOf,
} from "./shape-style";

/** The look of a piece of ink, as the format painter carries it. */
export interface InkStyle {
  color: string;
  /** Width, page px. */
  size: number;
  tool: Tool;
  /** A calligraphy nib's angle, degrees; absent for a round nib. */
  nib?: number;
  /**
   * When it was taken from a shape: the shape's line style, and its fill
   * and corners where its kind has them. Absent when taken from handwriting.
   */
  shape?: ShapeStyle;
}

/** The style of `stroke`, as the painter would carry it. */
export function inkStyleOf(stroke: Stroke): InkStyle {
  const style: InkStyle = { color: stroke.color, size: stroke.size, tool: stroke.tool };
  if (stroke.shape === undefined) {
    if (stroke.nib !== undefined) style.nib = stroke.nib;
    return style;
  }
  const shape: ShapeStyle = { dash: stroke.dash ?? null };
  if (canFill(stroke.shape)) shape.fill = stroke.fill ?? null;
  if (canRound(stroke.shape)) shape.radius = stroke.radius ?? null;
  style.shape = shape;
  return style;
}

/** A key two styles share exactly when they look the same. */
function styleKey(style: InkStyle): string {
  return JSON.stringify([
    style.color.toLowerCase(),
    style.size,
    style.tool,
    style.nib ?? null,
    style.shape ?? null,
  ]);
}

/**
 * The style a selection hands the painter: the look most of its strokes
 * share (a lasso round a word written in one pen gives that pen), the one
 * written first on a tie; `null` with no strokes.
 */
export function dominantInkStyle(strokes: readonly Stroke[]): InkStyle | null {
  let best: InkStyle | null = null;
  let bestCount = 0;
  const counts = new Map<string, number>();
  for (const stroke of strokes) {
    const style = inkStyleOf(stroke);
    const key = styleKey(style);
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    if (count > bestCount) {
      best = style;
      bestCount = count;
    }
  }
  return best;
}

/**
 * The fill mode a fill is of a line colour: a soft tint or solid of exactly
 * that colour, as the Shape tool fills; `null` for any other fill.
 */
function ownFillMode(fill: string, color: string): "soft" | "solid" | null {
  const { color: base, alpha } = splitFill(fill);
  if (base !== color.slice(0, 7).toLowerCase()) return null;
  if (alpha === 1) return "solid";
  return Math.abs(alpha - TINT_ALPHA) < 1 / 255 ? "soft" : null;
}

/**
 * Give `stroke` the look of `style`, in place, and say whether anything
 * changed. A shape takes the shape parts its kind has; a shape painted from
 * handwriting keeps its own line style, and a fill that was its own line
 * colour follows the new colour. A nib is for handwriting only: a shape is
 * drawn at one width.
 */
export function paintInkStyle(stroke: Stroke, style: InkStyle): boolean {
  const before = JSON.stringify(savedOf(stroke));
  const ownFill =
    stroke.shape !== undefined && stroke.fill !== undefined
      ? ownFillMode(stroke.fill, stroke.color)
      : null;
  stroke.color = style.color;
  stroke.size = style.size;
  stroke.tool = style.tool;
  if (stroke.shape === undefined) {
    if (style.nib !== undefined) stroke.nib = style.nib;
    else delete stroke.nib;
  } else if (style.shape) {
    applyShapeStyle(stroke, style.shape);
  } else if (ownFill) {
    stroke.fill = fillOf(stroke.color, ownFill);
  }
  return JSON.stringify(savedOf(stroke)) !== before;
}

/** Everything {@link paintInkStyle} can change on a stroke, for undo. */
interface Saved {
  color: string;
  size: number;
  tool: Tool;
  nib?: number;
  shape: StyleFields;
}

function savedOf(stroke: Stroke): Saved {
  const saved: Saved = {
    color: stroke.color,
    size: stroke.size,
    tool: stroke.tool,
    shape: styleFieldsOf(stroke),
  };
  if (stroke.nib !== undefined) saved.nib = stroke.nib;
  return saved;
}

function restore(stroke: Stroke, saved: Saved): void {
  stroke.color = saved.color;
  stroke.size = saved.size;
  stroke.tool = saved.tool;
  if (saved.nib !== undefined) stroke.nib = saved.nib;
  else delete stroke.nib;
  restoreStyleFields(stroke, saved.shape);
}

/**
 * One sweep of the format painter, as one undo step. {@link paint} lays the
 * style on a stroke as the pen reaches it; a host that painted live takes
 * the lot back with `invert` and pushes the command, whose `apply` paints
 * them all again, so the step holds exactly what the sweep changed. Strokes
 * are held by identity and restored to the values they had, so an undo
 * leaves the document as it was.
 */
export class PaintStyle implements Command {
  readonly label = "Paste style";
  private readonly targets: Array<{ pageId: string; stroke: Stroke }> = [];
  private readonly seen = new Set<Stroke>();
  private previous: Array<{ stroke: Stroke; saved: Saved }> = [];

  constructor(readonly style: InkStyle) {}

  /** The one page painted on, when there is exactly one. */
  get pageId(): string | undefined {
    const pages = this.pageIds;
    return pages.length === 1 ? pages[0] : undefined;
  }

  /** The pages painted on, first reached first. */
  get pageIds(): string[] {
    return [...new Set(this.targets.map((t) => t.pageId))];
  }

  /** The strokes painted, first reached first. */
  get strokes(): Stroke[] {
    return this.targets.map((t) => t.stroke);
  }

  /** Whether the sweep has changed anything. */
  get changed(): boolean {
    return this.targets.length > 0;
  }

  /**
   * Lay the style on `stroke`, of page `pageId`, now. False, and nothing
   * kept, when the stroke already looks so, was painted in this sweep, or is
   * not on that page.
   */
  paint(doc: InkDocument, pageId: string, stroke: Stroke): boolean {
    if (this.seen.has(stroke)) return false;
    this.seen.add(stroke);
    const page = pageById(doc, pageId);
    if (!page || !page.strokes.includes(stroke)) return false;
    const saved = savedOf(stroke);
    if (!paintInkStyle(stroke, this.style)) return false;
    this.targets.push({ pageId, stroke });
    this.previous.push({ stroke, saved });
    return true;
  }

  apply(doc: InkDocument): void {
    this.previous = [];
    for (const { pageId, stroke } of this.targets) {
      const page = pageById(doc, pageId);
      if (!page || !page.strokes.includes(stroke)) continue;
      const saved = savedOf(stroke);
      if (paintInkStyle(stroke, this.style)) this.previous.push({ stroke, saved });
    }
  }

  invert(_doc: InkDocument): void {
    for (let i = this.previous.length - 1; i >= 0; i--) {
      restore(this.previous[i].stroke, this.previous[i].saved);
    }
    this.previous = [];
  }
}
