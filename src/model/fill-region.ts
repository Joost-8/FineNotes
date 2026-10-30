/**
 * A bucket fill as the notebook stores it: an ordinary shape stroke (kind
 * `polygon`) round the filled region, filled solid with its own colour and
 * outlined at a hair's width in that colour. So it needs no new field: it
 * renders, exports, selects, moves and undoes as any filled shape does, and
 * an older build shows it as one. It lies behind the ink that bounds it:
 * fills go first in the page's strokes, the larger under the smaller, so a
 * shape filled inside a filled shape still shows.
 *
 * The region itself is `canvas/bucket-fill.ts`'s; this is what is kept.
 *
 * PURE: no DOM, no Obsidian.
 */

import type { Command } from "./commands";
import { POINT_STRIDE, type InkDocument, type Stroke, pageById } from "./document";

/** A fill's outline width, page px: thinner than any pen, under the ink round it. */
export const FILL_EDGE = 0.5;

/** How far a fill reaches past gaps in its outline. */
export type FillGap = "exact" | "small" | "large";

export const FILL_GAPS: readonly FillGap[] = ["exact", "small", "large"];

/** The gap a new install closes: a hand-drawn outline rarely meets itself exactly. */
export const DEFAULT_FILL_GAP: FillGap = "small";

/** Gaps up to this wide close, page px. */
export function fillGapPx(gap: FillGap): number {
  return gap === "exact" ? 0 : gap === "small" ? 8 : 20;
}

/** A stored gap choice; anything else is the default. */
export function readFillGap(raw: unknown): FillGap {
  return FILL_GAPS.includes(raw as FillGap) ? (raw as FillGap) : DEFAULT_FILL_GAP;
}

/** The pen colour a fill takes: `#rrggbb`, lower case; anything else is black. */
function fillColor(color: string): string {
  const hex = /^#[0-9a-f]{6}/i.exec(color)?.[0];
  return (hex ?? "#000000").toLowerCase();
}

/** Whether `stroke` is a bucket fill. */
export function isBucketFill(stroke: Stroke): boolean {
  return (
    stroke.shape === "polygon" &&
    stroke.size === FILL_EDGE &&
    stroke.fill !== undefined &&
    stroke.fill.toLowerCase() === stroke.color.toLowerCase()
  );
}

/** The stroke a fill of `outline` (flat `[x, y, …]`, closed) in `color` is stored as. */
export function fillStroke(id: string, color: string, outline: readonly number[]): Stroke {
  const hex = fillColor(color);
  const pts: number[] = [];
  for (let i = 0; i + 1 < outline.length; i += 2) {
    pts.push(Math.round(outline[i] * 100) / 100, Math.round(outline[i + 1] * 100) / 100, 0.5);
  }
  return { id, color: hex, size: FILL_EDGE, tool: "pen", pts, shape: "polygon", fill: hex };
}

/** The area a stroke's points enclose, page px² (0 for fewer than three). */
export function enclosedArea(pts: readonly number[]): number {
  const n = Math.floor(pts.length / POINT_STRIDE);
  let twice = 0;
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    const a = i * POINT_STRIDE;
    const b = j * POINT_STRIDE;
    twice += pts[b] * pts[a + 1] - pts[a] * pts[b + 1];
  }
  return Number.isFinite(twice) ? Math.abs(twice) / 2 : 0;
}

/**
 * Where a new fill enclosing `area` goes in a page's strokes: behind every
 * stroke that is not a fill, and behind every fill smaller than it.
 */
export function fillInsertIndex(strokes: readonly Stroke[], area: number): number {
  for (let i = 0; i < strokes.length; i++) {
    const stroke = strokes[i];
    if (!isBucketFill(stroke) || enclosedArea(stroke.pts) < area) return i;
  }
  return strokes.length;
}

/**
 * The fill already covering the region `pts` encloses (bounds within
 * `slack` page px, area within 5 %), so a second tap recolours it rather
 * than stacking another on it; `null` when there is none.
 */
export function sameFill(
  strokes: readonly Stroke[],
  pts: readonly number[],
  slack = 3,
): Stroke | null {
  const want = boundsOf(pts);
  const area = enclosedArea(pts);
  if (!want || !(area > 0)) return null;
  for (const stroke of strokes) {
    if (!isBucketFill(stroke)) continue;
    const have = boundsOf(stroke.pts);
    if (!have) continue;
    const near =
      Math.abs(have.minX - want.minX) <= slack &&
      Math.abs(have.minY - want.minY) <= slack &&
      Math.abs(have.maxX - want.maxX) <= slack &&
      Math.abs(have.maxY - want.maxY) <= slack;
    if (near && Math.abs(enclosedArea(stroke.pts) - area) <= 0.05 * area) return stroke;
  }
  return null;
}

function boundsOf(
  pts: readonly number[],
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < pts.length; i += POINT_STRIDE) {
    minX = Math.min(minX, pts[i]);
    maxX = Math.max(maxX, pts[i]);
    minY = Math.min(minY, pts[i + 1]);
    maxY = Math.max(maxY, pts[i + 1]);
  }
  return Number.isFinite(minX + minY + maxX + maxY) ? { minX, minY, maxX, maxY } : null;
}

/** Put a fill on a page, behind the ink (at `index` in its strokes). */
export class AddFill implements Command {
  readonly label = "Fill";
  constructor(
    readonly pageId: string,
    private readonly stroke: Stroke,
    private readonly index: number,
  ) {}

  apply(doc: InkDocument): void {
    const strokes = pageById(doc, this.pageId)?.strokes;
    if (!strokes) return;
    strokes.splice(Math.max(0, Math.min(strokes.length, this.index)), 0, this.stroke);
  }

  invert(doc: InkDocument): void {
    const strokes = pageById(doc, this.pageId)?.strokes;
    if (!strokes) return;
    const at = strokes.indexOf(this.stroke);
    if (at >= 0) strokes.splice(at, 1);
  }
}

/** Give a fill another colour, its outline and inside alike. */
export class RecolorFill implements Command {
  readonly label = "Fill";
  private previous: { color: string; fill: string | undefined } | null = null;
  constructor(
    readonly pageId: string,
    private readonly stroke: Stroke,
    private readonly color: string,
  ) {}

  apply(doc: InkDocument): void {
    const page = pageById(doc, this.pageId);
    if (!page || !page.strokes.includes(this.stroke)) return;
    this.previous = { color: this.stroke.color, fill: this.stroke.fill };
    const hex = fillColor(this.color);
    this.stroke.color = hex;
    this.stroke.fill = hex;
  }

  invert(): void {
    const before = this.previous;
    if (!before) return;
    this.stroke.color = before.color;
    if (before.fill === undefined) delete this.stroke.fill;
    else this.stroke.fill = before.fill;
    this.previous = null;
  }
}
